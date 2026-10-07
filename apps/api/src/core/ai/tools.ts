import type { FeatureKey, PermissionCode } from '@erp/shared';
import type { ZodType, ZodTypeDef } from 'zod';
import { hasPermission, type Principal } from '../authz';
import { AppError } from '../http/errors';
import type { AiToolSpec } from './types';

export interface AiToolResult {
  /** One-line human summary (shown in the UI and used by the mock provider). */
  summary: string;
  /** Structured payload sent to the model (keep it small and free of secrets). */
  data: unknown;
}

/**
 * A READ-ONLY function the assistant may call. Tools run as the CALLING principal and must use
 * the owning module's scope-aware services so they can only see what the user can see.
 */
export interface AiToolDefinition<TArgs = Record<string, unknown>> {
  name: string;
  description: string;
  /** JSON schema of the arguments (sent to the model). */
  parameters: Record<string, unknown>;
  /** Re-validates model-supplied arguments (never trust the model). */
  argsSchema: ZodType<TArgs, ZodTypeDef, unknown>;
  /** The principal needs at least ONE of these permissions (checked when offering AND running). */
  anyPermission: readonly PermissionCode[];
  /** Module that must be enabled for the organization. */
  feature: FeatureKey;
  handler(args: TArgs): Promise<AiToolResult>;
  /** Mock-provider routing: questions matching `match` call this tool with `args(question)`. */
  mock?: { match: RegExp; priority?: number; args?(question: string): Record<string, unknown> };
}

const tools = new Map<string, AiToolDefinition<never>>();

export function registerAiTool<TArgs>(def: AiToolDefinition<TArgs>): void {
  tools.set(def.name, def as unknown as AiToolDefinition<never>);
}

export function getAiTool(name: string): AiToolDefinition<Record<string, unknown>> | undefined {
  return tools.get(name) as unknown as AiToolDefinition<Record<string, unknown>> | undefined;
}

function permitted(def: AiToolDefinition<never>, principal: Principal, features: Set<FeatureKey>) {
  return features.has(def.feature) && def.anyPermission.some((p) => hasPermission(principal, p));
}

/** Tools the principal may use given the organization's enabled modules. */
export function availableAiTools(principal: Principal, features: Iterable<FeatureKey>) {
  const enabled = new Set(features);
  return [...tools.values()]
    .filter((t) => permitted(t, principal, enabled))
    .map((t) => t as unknown as AiToolDefinition<Record<string, unknown>>);
}

export function toToolSpecs(defs: readonly AiToolDefinition<Record<string, unknown>>[]) {
  return defs.map((t): AiToolSpec => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

export interface AiToolExecution {
  name: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  summary: string;
  data: unknown;
}

/**
 * Execute a model-requested tool call. Authorization is checked AGAIN here (the model may ask for
 * a tool it was not offered); the handler's services then apply row-level scopes.
 */
export async function executeAiTool(
  name: string,
  rawArgs: Record<string, unknown>,
  principal: Principal,
  features: Iterable<FeatureKey>,
): Promise<AiToolExecution> {
  const def = tools.get(name) as unknown as AiToolDefinition<Record<string, unknown>> | undefined;
  const base = { name, arguments: rawArgs };
  if (!def) return { ...base, ok: false, summary: `Unknown tool "${name}"`, data: null };
  if (!permitted(def as unknown as AiToolDefinition<never>, principal, new Set(features))) {
    return {
      ...base,
      ok: false,
      summary: 'You do not have permission to access this information.',
      data: { error: 'PERMISSION_DENIED' },
    };
  }
  const parsed = def.argsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return { ...base, ok: false, summary: 'Invalid tool arguments', data: { error: 'BAD_ARGS' } };
  }
  try {
    const result = await def.handler(parsed.data);
    return { ...base, arguments: parsed.data, ok: true, ...result };
  } catch (err) {
    if (err instanceof AppError && err.expose) {
      return { ...base, ok: false, summary: err.message, data: { error: err.code } };
    }
    throw err;
  }
}
