import { AppError } from '../http/errors';
import { assertSafeOutboundUrl, outboundRequest } from '../http/outbound';
import type {
  AiChatMessage,
  AiCompletion,
  AiCompletionRequest,
  AiProvider,
  AiProviderCredentials,
  AiToolCall,
} from './types';

/*
 * OpenAI-compatible Chat Completions adapter. Works with OpenAI, Azure OpenAI (set `baseUrl` to
 * the deployment URL and `apiVersion` in the secret metadata) and any OpenAI-compatible gateway.
 * Uses the injectable outbound transport (core/http/outbound) so tests never hit the network.
 */

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

export class AiProviderError extends AppError {
  constructor(message: string, code = 'AI_PROVIDER_ERROR', status = 502) {
    super(status, code, message);
  }
}

interface OpenAiResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{ id: string; function?: { name?: string; arguments?: string } }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: string };
}

function toWireMessage(m: AiChatMessage): Record<string, unknown> {
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return {
      role: 'assistant',
      content: m.content || null,
      tool_calls: m.toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: JSON.stringify(c.arguments) },
      })),
    };
  }
  return { role: m.role, content: m.content };
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function buildOpenAiRequest(req: AiCompletionRequest, creds: AiProviderCredentials) {
  const base = (creds.baseUrl || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '');
  const url = assertSafeOutboundUrl(`${base}/chat/completions`, 'baseUrl');
  if (creds.apiVersion) url.searchParams.set('api-version', creds.apiVersion);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (creds.apiVersion) headers['api-key'] = creds.apiKey;
  else headers.authorization = `Bearer ${creds.apiKey}`;
  const body = {
    model: req.model,
    messages: req.messages.map(toWireMessage),
    max_tokens: req.maxTokens,
    temperature: req.temperature,
    ...(req.tools?.length
      ? {
          tools: req.tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
          tool_choice: 'auto',
        }
      : {}),
  };
  return { url: url.toString(), headers, body: JSON.stringify(body) };
}

export function parseOpenAiResponse(raw: string, fallbackModel: string): AiCompletion {
  let json: OpenAiResponse;
  try {
    json = JSON.parse(raw) as OpenAiResponse;
  } catch {
    throw new AiProviderError('AI provider returned an invalid response');
  }
  const message = json.choices?.[0]?.message;
  if (!message) throw new AiProviderError('AI provider returned no choices');
  const toolCalls: AiToolCall[] = (message.tool_calls ?? [])
    .filter((c) => c.function?.name)
    .map((c) => ({
      id: c.id,
      name: c.function!.name!,
      arguments: parseArgs(c.function?.arguments),
    }));
  return {
    content: message.content ?? '',
    toolCalls,
    model: json.model ?? fallbackModel,
    usage: {
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
    },
  };
}

export const openAiProvider: AiProvider = {
  key: 'openai',
  async complete(req, creds): Promise<AiCompletion> {
    if (!creds) throw new AiProviderError('No AI credentials configured', 'AI_NOT_CONFIGURED', 409);
    const wire = buildOpenAiRequest(req, creds);
    const res = await outboundRequest({ method: 'POST', ...wire, timeoutMs: 60_000 });
    if (res.status === 429)
      throw new AiProviderError('AI provider rate limit reached', 'AI_RATE_LIMITED', 429);
    if (res.status === 401 || res.status === 403) {
      throw new AiProviderError(
        'AI provider rejected the configured credentials',
        'AI_AUTH_FAILED',
      );
    }
    if (res.status < 200 || res.status >= 300) {
      throw new AiProviderError(`AI provider request failed (HTTP ${res.status})`);
    }
    return parseOpenAiResponse(res.body, req.model);
  },
};
