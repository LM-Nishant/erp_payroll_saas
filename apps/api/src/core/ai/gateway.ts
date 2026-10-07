import type { AiFeature, AiProviderKey, AiUsageSummaryDto, FeatureKey } from '@erp/shared';
import { currentPrincipal, type Principal } from '../authz';
import {
  consumeLimit,
  currentFeatureContext,
  enabledFeaturesAnywhere,
  LimitExceededError,
  releaseLimit,
} from '../features';
import { AppError } from '../http/errors';
import { logger } from '../logger';
import { getSecret } from '../secrets';
import { tenantDb, withTenant } from '../tenancy';
import { mockAiProvider } from './mock-provider';
import { openAiProvider } from './openai-provider';
import { getAiPrompt } from './prompts';
import { promptPreview, redactPii, truncate } from './redact';
import { loadAiSettings } from './settings';
import { executeAiTool, toToolSpecs, type AiToolDefinition, type AiToolExecution } from './tools';
import {
  estimateMessagesTokens,
  type AiChatMessage,
  type AiCompletionRequest,
  type AiProvider,
  type AiProviderCredentials,
} from './types';

export const AI_SECRET_KIND = 'ai.openai';
const MAX_TOOL_ROUNDS = 3;
const MAX_TOOL_PAYLOAD_CHARS = 8_000;

export class AiDisabledError extends AppError {
  constructor(message = 'AI is disabled for this organization', code = 'AI_DISABLED') {
    super(403, code, message);
  }
}

/* ---------------------------------------------------------------- provider resolution */

let providerOverride: AiProvider | null = null;

/** Tests: force a provider (e.g. one that fails). Pass null to restore. */
export function setAiProviderOverride(provider: AiProvider | null): void {
  providerOverride = provider;
}

export interface ResolvedAiProvider {
  provider: AiProvider;
  credentials: AiProviderCredentials | null;
  model: string;
  /** Data leaves the platform (anything but the mock provider). */
  external: boolean;
}

function metaString(meta: Record<string, unknown> | null | undefined, key: string) {
  const v = meta?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Is an `ai.openai` secret configured (any level)? Never decrypts. */
export async function aiSecretConfigured(): Promise<boolean> {
  return (await tenantDb().tenantSecret.count({ where: { kind: AI_SECRET_KIND } })) > 0;
}

/**
 * The provider for a call: OpenAI-compatible when the organization chose `openai` AND an
 * `ai.openai` secret exists (metadata `{ model?, baseUrl?, apiVersion? }`); otherwise the
 * deterministic mock provider.
 */
export async function resolveAiProvider(
  settings: { provider: AiProviderKey; defaultModel: string },
  purpose: string,
  institutionId?: string | null,
): Promise<ResolvedAiProvider> {
  if (providerOverride) {
    return {
      provider: providerOverride,
      credentials: null,
      model: settings.defaultModel,
      external: providerOverride.key !== 'mock',
    };
  }
  if (settings.provider === 'openai') {
    const secret = await getSecret({ kind: AI_SECRET_KIND, institutionId, purpose });
    if (secret) {
      const meta = secret.meta.metadata;
      return {
        provider: openAiProvider,
        credentials: {
          apiKey: secret.reveal(),
          baseUrl: metaString(meta, 'baseUrl'),
          apiVersion: metaString(meta, 'apiVersion'),
        },
        model: metaString(meta, 'model') ?? settings.defaultModel,
        external: true,
      };
    }
  }
  return {
    provider: mockAiProvider,
    credentials: null,
    model: settings.defaultModel,
    external: false,
  };
}

/* ---------------------------------------------------------------- gateway */

export interface AiRunOptions {
  feature: AiFeature;
  messages: AiChatMessage[];
  /** Tools offered to the model (already filtered by `availableAiTools`). */
  tools?: AiToolDefinition<Record<string, unknown>>[];
  /** Prompt-template context (key + validated input). */
  prompt?: { key: string; input: unknown };
  conversationId?: string | null;
  institutionId?: string | null;
  /** Text stored (redacted, truncated) in the usage log; defaults to the last user message. */
  logText?: string;
}

export interface AiRunResult {
  content: string;
  toolExecutions: AiToolExecution[];
  usage: AiUsageSummaryDto;
}

interface UsageRow {
  principal: Principal;
  feature: AiFeature;
  provider: AiProviderKey;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  status: 'OK' | 'ERROR' | 'LIMITED';
  errorCode: string | null;
  text: string;
  conversationId: string | null;
}

async function logUsage(row: UsageRow): Promise<void> {
  try {
    await tenantDb().aiUsageLog.create({
      data: withTenant({
        userId: row.principal.userId,
        feature: row.feature,
        provider: row.provider,
        model: truncate(row.model, 100),
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        totalTokens: row.promptTokens + row.completionTokens,
        latencyMs: row.latencyMs,
        status: row.status,
        errorCode: row.errorCode,
        promptRedacted: row.text ? promptPreview(row.text) : null,
        conversationId: row.conversationId,
      }),
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Failed to record AI usage');
  }
}

function lastUserText(messages: readonly AiChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') return messages[i]!.content;
  }
  return '';
}

function outgoing(messages: AiChatMessage[], redact: boolean): AiChatMessage[] {
  if (!redact) return messages;
  return messages.map((m) => ({ ...m, content: redactPii(m.content) }));
}

/** Assert AI + the given AI feature are enabled in the organization's AI settings. */
export async function assertAiFeatureEnabled(feature: AiFeature) {
  const settings = await loadAiSettings();
  if (!settings.enabled) throw new AiDisabledError();
  if (!settings.enabledFeatures.includes(feature)) {
    throw new AiDisabledError(`AI feature "${feature}" is disabled`, 'AI_FEATURE_DISABLED');
  }
  return settings;
}

/**
 * THE AI gateway. Every model call goes through here: settings / feature gate, provider
 * resolution (secrets only via getSecret), `ai_tokens` limit reservation and settlement,
 * redaction for external providers without data sharing, bounded tool calling (tools run as the
 * calling principal and re-check authorization), and an `ai_usage_logs` row per call.
 */
export async function runAi(options: AiRunOptions): Promise<AiRunResult> {
  const principal = currentPrincipal();
  const settings = await assertAiFeatureEnabled(options.feature);
  const resolved = await resolveAiProvider(
    settings,
    `ai.${options.feature}`,
    options.institutionId ?? null,
  );
  const redact = resolved.external && !settings.dataSharing;
  const tools = options.tools ?? [];
  const toolSpecs = toToolSpecs(tools);
  const features: FeatureKey[] = tools.length
    ? await enabledFeaturesAnywhere(currentFeatureContext())
    : [];
  const messages = [...options.messages];
  const toolExecutions: AiToolExecution[] = [];
  const started = Date.now();
  let promptTokens = 0;
  let completionTokens = 0;
  let model = resolved.model;
  const logBase = {
    principal,
    feature: options.feature,
    provider: resolved.provider.key,
    text: options.logText ?? lastUserText(options.messages),
    conversationId: options.conversationId ?? null,
  };

  try {
    for (let round = 0; ; round++) {
      const offerTools = toolSpecs.length > 0 && round < MAX_TOOL_ROUNDS;
      const req: AiCompletionRequest = {
        model: resolved.model,
        messages: outgoing(messages, redact),
        ...(offerTools ? { tools: toolSpecs } : {}),
        maxTokens: settings.maxTokensPerRequest,
        temperature: settings.temperature,
        ...(options.prompt ? { prompt: options.prompt } : {}),
      };
      const reserved = estimateMessagesTokens(req.messages) + req.maxTokens;
      await consumeLimit('ai_tokens', reserved);
      let completion;
      try {
        completion = await resolved.provider.complete(req, resolved.credentials);
      } catch (err) {
        await releaseLimit('ai_tokens', reserved);
        throw err;
      }
      const used = completion.usage.promptTokens + completion.usage.completionTokens;
      if (used < reserved) await releaseLimit('ai_tokens', reserved - used);
      else if (used > reserved) await consumeLimit('ai_tokens', used - reserved).catch(() => {});
      promptTokens += completion.usage.promptTokens;
      completionTokens += completion.usage.completionTokens;
      model = completion.model || model;

      if (!offerTools || completion.toolCalls.length === 0) {
        const usage: AiUsageSummaryDto = {
          provider: resolved.provider.key,
          model,
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          latencyMs: Date.now() - started,
        };
        await logUsage({
          ...logBase,
          model,
          promptTokens,
          completionTokens,
          latencyMs: usage.latencyMs,
          status: 'OK',
          errorCode: null,
        });
        return { content: completion.content.trim(), toolExecutions, usage };
      }

      messages.push({
        role: 'assistant',
        content: completion.content,
        toolCalls: completion.toolCalls,
      });
      for (const call of completion.toolCalls) {
        const exec = await executeAiTool(call.name, call.arguments, principal, features);
        toolExecutions.push(exec);
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: truncate(
            JSON.stringify({ ok: exec.ok, summary: exec.summary, data: exec.data }),
            MAX_TOOL_PAYLOAD_CHARS,
          ),
        });
      }
    }
  } catch (err) {
    const limited = err instanceof LimitExceededError;
    await logUsage({
      ...logBase,
      model,
      promptTokens,
      completionTokens,
      latencyMs: Date.now() - started,
      status: limited ? 'LIMITED' : 'ERROR',
      errorCode: err instanceof AppError ? err.code : 'INTERNAL',
    });
    throw err;
  }
}

/** Run a registered prompt template: validates input, renders messages, calls the gateway. */
export async function runAiPrompt<TInput>(
  key: string,
  input: TInput,
  options: Pick<AiRunOptions, 'conversationId' | 'institutionId'> = {},
): Promise<AiRunResult & { promptVersion: number }> {
  const def = getAiPrompt<TInput>(key);
  const parsed = def.inputSchema.parse(input);
  const user = def.render(parsed);
  const result = await runAi({
    feature: def.feature,
    messages: [
      { role: 'system', content: def.system },
      { role: 'user', content: user },
    ],
    prompt: { key, input: parsed },
    logText: `[${key}@v${def.version}] ${user}`,
    ...options,
  });
  return { ...result, promptVersion: def.version };
}
