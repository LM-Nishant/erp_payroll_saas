import type { AiFeature } from '@erp/shared';
import type { ZodType, ZodTypeDef } from 'zod';
import type { AiChatMessage } from './types';

/**
 * Versioned prompt templates. Modules register them (in `<module>.registrations.ts`) and run
 * them through the gateway by key, so prompts are reviewable, testable and auditable (the key +
 * version is recorded with each usage log).
 */
export interface AiPromptDefinition<TInput = unknown> {
  key: string;
  version: number;
  feature: AiFeature;
  /** System instructions. */
  system: string;
  /** Validates the input before anything is sent to a provider. */
  inputSchema: ZodType<TInput, ZodTypeDef, unknown>;
  /** Renders the user message from validated input. */
  render(input: TInput): string;
  /** Deterministic output for the mock provider (demo + tests). */
  mock?(input: TInput, messages: readonly AiChatMessage[]): string;
}

const prompts = new Map<string, AiPromptDefinition<never>>();

export function registerAiPrompt<TInput>(def: AiPromptDefinition<TInput>): void {
  const existing = prompts.get(def.key);
  if (existing && existing.version > def.version) return;
  prompts.set(def.key, def as unknown as AiPromptDefinition<never>);
}

export function getAiPrompt<TInput = unknown>(key: string): AiPromptDefinition<TInput> {
  const def = prompts.get(key);
  if (!def) throw new Error(`AI prompt "${key}" is not registered`);
  return def as unknown as AiPromptDefinition<TInput>;
}

export function listAiPrompts(): { key: string; version: number; feature: AiFeature }[] {
  return [...prompts.values()].map((p) => ({ key: p.key, version: p.version, feature: p.feature }));
}
