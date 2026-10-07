import { afterEach, describe, expect, it } from 'vitest';
import { resetOutboundTransport, setOutboundTransport } from '../http/outbound';
import { buildOpenAiRequest, openAiProvider, parseOpenAiResponse } from './openai-provider';
import type { AiCompletionRequest } from './types';

const req: AiCompletionRequest = {
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'How many employees?' },
  ],
  tools: [{ name: 'employee_headcount', description: 'Headcount', parameters: { type: 'object' } }],
  maxTokens: 256,
  temperature: 0.2,
};

describe('OpenAI-compatible provider', () => {
  afterEach(() => resetOutboundTransport());

  it('builds an OpenAI request with bearer auth and tools', () => {
    const wire = buildOpenAiRequest(req, { apiKey: 'sk-test-123456789012' });
    expect(wire.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(wire.headers.authorization).toBe('Bearer sk-test-123456789012');
    const body = JSON.parse(wire.body);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.tools[0].function.name).toBe('employee_headcount');
  });

  it('supports Azure OpenAI (api-key header + api-version)', () => {
    const wire = buildOpenAiRequest(req, {
      apiKey: 'azure-key',
      baseUrl: 'https://acme.openai.azure.com/openai/deployments/gpt4o/',
      apiVersion: '2024-06-01',
    });
    expect(wire.url).toBe(
      'https://acme.openai.azure.com/openai/deployments/gpt4o/chat/completions?api-version=2024-06-01',
    );
    expect(wire.headers['api-key']).toBe('azure-key');
    expect(wire.headers.authorization).toBeUndefined();
  });

  it('validates the base URL (outbound URL policy)', () => {
    expect(() =>
      buildOpenAiRequest(req, { apiKey: 'k', baseUrl: 'https://user:pass@api.example.com/v1' }),
    ).toThrow();
    expect(() => buildOpenAiRequest(req, { apiKey: 'k', baseUrl: 'ftp://example.com' })).toThrow();
  });

  it('parses content, tool calls and usage', () => {
    const parsed = parseOpenAiResponse(
      JSON.stringify({
        model: 'gpt-4o-mini-2024',
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'c1',
                  function: { name: 'employee_headcount', arguments: '{"by":"status"}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 3 },
      }),
      'fallback',
    );
    expect(parsed.toolCalls).toEqual([
      { id: 'c1', name: 'employee_headcount', arguments: { by: 'status' } },
    ]);
    expect(parsed.usage).toEqual({ promptTokens: 12, completionTokens: 3 });
    expect(parsed.model).toBe('gpt-4o-mini-2024');
  });

  it('maps HTTP failures to safe errors (never echoing the key)', async () => {
    setOutboundTransport(async () => ({
      status: 401,
      headers: {},
      body: '{"error":"bad key sk-x"}',
    }));
    await expect(
      openAiProvider.complete(req, { apiKey: 'sk-secret-000000000000' }),
    ).rejects.toMatchObject({
      code: 'AI_AUTH_FAILED',
    });
    setOutboundTransport(async () => ({ status: 429, headers: {}, body: '' }));
    await expect(openAiProvider.complete(req, { apiKey: 'k' })).rejects.toMatchObject({
      code: 'AI_RATE_LIMITED',
    });
  });
});
