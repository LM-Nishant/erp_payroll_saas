import { getAiPrompt } from './prompts';
import { getAiTool } from './tools';
import {
  estimateMessagesTokens,
  estimateTokens,
  type AiChatMessage,
  type AiCompletion,
  type AiCompletionRequest,
  type AiProvider,
  type AiToolCall,
} from './types';

/*
 * Deterministic provider used when no `ai.openai` secret is configured and in tests. It never
 * calls the network: tool routing is keyword based (each tool's `mock.match`) and prompt
 * templates supply their own `mock()` output, so the demo UI is fully functional without keys.
 */

function lastUserIndex(messages: readonly AiChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.role === 'user') return i;
  return -1;
}

function toolSummary(m: AiChatMessage): string {
  try {
    const parsed = JSON.parse(m.content) as { summary?: unknown };
    if (typeof parsed.summary === 'string') return parsed.summary;
  } catch {
    // fall through
  }
  return m.content.slice(0, 300);
}

function routeTools(req: AiCompletionRequest, question: string): AiToolCall[] {
  const candidates = (req.tools ?? [])
    .map((spec) => getAiTool(spec.name))
    .filter((t): t is NonNullable<typeof t> => Boolean(t?.mock?.match.test(question)))
    .sort((a, b) => (b.mock?.priority ?? 0) - (a.mock?.priority ?? 0))
    .slice(0, 2);
  return candidates.map((t, i) => ({
    id: `mock_call_${i + 1}`,
    name: t.name,
    arguments: t.mock?.args?.(question) ?? {},
  }));
}

function helpText(req: AiCompletionRequest): string {
  const names = (req.tools ?? []).map((t) => `- ${t.description}`);
  if (names.length === 0) {
    return "I'm the ERP assistant (demo mode). You don't currently have access to any data tools, but I can help with general questions about using the ERP.";
  }
  return [
    "I'm the ERP assistant (demo mode). I can answer questions using these read-only tools:",
    ...names,
    'Try: "How many employees do we have?", "Find employee Priya", "Show payroll run totals" or "How many students are enrolled?"',
  ].join('\n');
}

function respond(req: AiCompletionRequest): { content: string; toolCalls: AiToolCall[] } {
  if (req.prompt) {
    const def = getAiPrompt(req.prompt.key);
    if (def.mock)
      return { content: def.mock(req.prompt.input as never, req.messages), toolCalls: [] };
  }
  const idx = lastUserIndex(req.messages);
  const question = idx >= 0 ? req.messages[idx]!.content : '';
  const toolResults = req.messages.slice(idx + 1).filter((m) => m.role === 'tool');
  if (toolResults.length > 0) {
    return {
      content: [
        "Here's what I found (only data you're allowed to see is included):",
        ...toolResults.map((m) => `- ${toolSummary(m)}`),
      ].join('\n'),
      toolCalls: [],
    };
  }
  if (req.tools && req.tools.length > 0) {
    const calls = routeTools(req, question);
    if (calls.length > 0) return { content: '', toolCalls: calls };
  }
  if (/^(hi|hello|hey|help)\b/i.test(question.trim()) || req.tools) {
    return { content: helpText(req), toolCalls: [] };
  }
  return {
    content: `(demo mode) I received: "${question.slice(0, 200)}". Configure an OpenAI key in Secrets to get real answers.`,
    toolCalls: [],
  };
}

export const mockAiProvider: AiProvider = {
  key: 'mock',
  async complete(req: AiCompletionRequest): Promise<AiCompletion> {
    const { content, toolCalls } = respond(req);
    const completionTokens = Math.min(
      req.maxTokens,
      estimateTokens(content) + (toolCalls.length ? estimateTokens(JSON.stringify(toolCalls)) : 0),
    );
    return {
      content,
      toolCalls,
      model: `mock:${req.model}`,
      usage: { promptTokens: estimateMessagesTokens(req.messages), completionTokens },
    };
  },
};
