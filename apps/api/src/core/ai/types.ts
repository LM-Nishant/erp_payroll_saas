import type { AiProviderKey } from '@erp/shared';

/** Provider-agnostic chat message (OpenAI-compatible shape). */
export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** For `tool` messages: the id of the call being answered. */
  toolCallId?: string;
  /** For `tool` messages: the tool name. */
  name?: string;
  /** For `assistant` messages that requested tool calls. */
  toolCalls?: AiToolCall[];
}

export interface AiToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** JSON-schema description of a tool offered to the model. */
export interface AiToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AiCompletionRequest {
  model: string;
  messages: AiChatMessage[];
  tools?: AiToolSpec[];
  maxTokens: number;
  temperature: number;
  /** Prompt-template context: lets the mock provider produce deterministic, useful output. */
  prompt?: { key: string; input: unknown };
}

export interface AiTokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface AiCompletion {
  content: string;
  toolCalls: AiToolCall[];
  usage: AiTokenUsage;
  model: string;
}

/** Credentials resolved for one call (never logged / persisted). */
export interface AiProviderCredentials {
  apiKey: string;
  /** OpenAI-compatible base URL (Azure OpenAI deployment URL, self-hosted gateway…). */
  baseUrl?: string;
  /** Azure OpenAI `api-version` query parameter (switches to the `api-key` header). */
  apiVersion?: string;
}

export interface AiProvider {
  key: AiProviderKey;
  complete(
    req: AiCompletionRequest,
    credentials: AiProviderCredentials | null,
  ): Promise<AiCompletion>;
}

/** Rough token estimate (~4 chars/token) used for reservations and providers without usage. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateMessagesTokens(messages: readonly AiChatMessage[]): number {
  return messages.reduce(
    (sum, m) =>
      sum +
      4 +
      estimateTokens(m.content) +
      (m.toolCalls ? estimateTokens(JSON.stringify(m.toolCalls)) : 0),
    0,
  );
}
