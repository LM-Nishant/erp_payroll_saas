import { AI_FEATURES, type AiSettingsDto } from '@erp/shared';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrincipal, runWithPrincipal, type Grant } from '../authz/principal';
import { consumeLimit, LimitExceededError, releaseLimit } from '../features';
import { tenantDb } from '../tenancy';
import { loadAiSettings } from './settings';
import { AiDisabledError, runAi, runAiPrompt, setAiProviderOverride } from './gateway';
import { mockAiProvider } from './mock-provider';
import { registerAiPrompt } from './prompts';
import { availableAiTools, executeAiTool, registerAiTool } from './tools';
import type { AiCompletionRequest, AiProvider } from './types';
import type * as FeaturesModuleNs from '../features';
import type * as TenancyModuleNs from '../tenancy';
import type * as SettingsModuleNs from './settings';

type FeaturesModule = typeof FeaturesModuleNs;
type TenancyModule = typeof TenancyModuleNs;
type SettingsModule = typeof SettingsModuleNs;

vi.mock('../features', async (importOriginal) => ({
  ...(await importOriginal<FeaturesModule>()),
  consumeLimit: vi.fn(async () => 0),
  releaseLimit: vi.fn(async () => undefined),
  enabledFeaturesAnywhere: vi.fn(async () => ['hr', 'ai']),
  currentFeatureContext: vi.fn(() => ({})),
}));
const usageCreate = vi.fn(async (_args: { data: Record<string, unknown> }) => ({}));
vi.mock('../tenancy', async (importOriginal) => ({
  ...(await importOriginal<TenancyModule>()),
  tenantDb: vi.fn(() => ({
    aiUsageLog: { create: usageCreate },
    tenantSecret: { count: vi.fn(async () => 0) },
  })),
  withTenant: (data: Record<string, unknown>) => ({ ...data, organizationId: 'org-1' }),
}));
vi.mock('./settings', async (importOriginal) => ({
  ...(await importOriginal<SettingsModule>()),
  loadAiSettings: vi.fn(),
}));

const SETTINGS: AiSettingsDto = {
  enabled: true,
  provider: 'mock',
  defaultModel: 'gpt-4o-mini',
  maxTokensPerRequest: 100,
  temperature: 0.2,
  enabledFeatures: [...AI_FEATURES],
  dataSharing: false,
  updatedAt: null,
};

const grant = (permissions: string[]): Grant => ({
  roleKey: 'r',
  permissions: new Set(permissions),
  scopes: [{ type: 'ORGANIZATION', id: null }],
});
const principal = (...permissions: string[]) =>
  createPrincipal({
    actorType: 'user',
    userId: 'user-1',
    sessionId: 's',
    organizationId: 'org-1',
    grants: [grant(permissions)],
  });

const handler = vi.fn(async () => ({ summary: '42 employees', data: { total: 42 } }));
registerAiTool({
  name: 'test_headcount',
  description: 'Test headcount',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  argsSchema: z.object({}).strict(),
  anyPermission: ['employee.view'],
  feature: 'hr',
  handler,
  mock: { match: /how many employees/i, priority: 9 },
});
registerAiPrompt({
  key: 'test.prompt',
  version: 2,
  feature: 'drafting',
  system: 'sys',
  inputSchema: z.object({ name: z.string() }),
  render: (i) => `Write to ${i.name}`,
  mock: (i) => `Subject: Hello\n\nDear ${i.name}`,
});

describe('AI gateway', () => {
  beforeEach(() => {
    vi.mocked(loadAiSettings).mockResolvedValue({ ...SETTINGS });
    vi.mocked(consumeLimit).mockClear();
    vi.mocked(releaseLimit).mockClear();
    usageCreate.mockClear();
    handler.mockClear();
  });
  afterEach(() => setAiProviderOverride(null));

  it('reserves ai_tokens per call, releases the unused part and logs usage', async () => {
    const result = await runWithPrincipal(principal('ai.use'), () =>
      runAiPrompt('test.prompt', { name: 'Asha' }),
    );
    expect(result.content).toBe('Subject: Hello\n\nDear Asha');
    expect(result.promptVersion).toBe(2);
    const reserved = vi.mocked(consumeLimit).mock.calls[0]!;
    expect(reserved[0]).toBe('ai_tokens');
    expect(reserved[1]).toBeGreaterThanOrEqual(100);
    const released = vi.mocked(releaseLimit).mock.calls[0]![1] as number;
    expect((reserved[1] as number) - released).toBe(result.usage.totalTokens);
    expect(usageCreate).toHaveBeenCalledTimes(1);
    const row = usageCreate.mock.calls[0]![0].data;
    expect(row).toMatchObject({
      status: 'OK',
      feature: 'drafting',
      provider: 'mock',
      userId: 'user-1',
    });
    expect(row.promptRedacted).toContain('test.prompt@v2');
  });

  it('logs LIMITED and fails when the token limit is exhausted', async () => {
    vi.mocked(consumeLimit).mockRejectedValueOnce(
      new LimitExceededError('ai_tokens', { limit: 10, used: 10, requested: 5 }),
    );
    await expect(
      runWithPrincipal(principal('ai.use'), () => runAiPrompt('test.prompt', { name: 'x' })),
    ).rejects.toBeInstanceOf(LimitExceededError);
    expect(usageCreate.mock.calls[0]![0].data).toMatchObject({
      status: 'LIMITED',
      errorCode: 'LIMIT_EXCEEDED',
    });
  });

  it('refuses disabled AI features', async () => {
    vi.mocked(loadAiSettings).mockResolvedValue({ ...SETTINGS, enabledFeatures: ['assistant'] });
    await expect(
      runWithPrincipal(principal('ai.use'), () => runAiPrompt('test.prompt', { name: 'x' })),
    ).rejects.toBeInstanceOf(AiDisabledError);
    vi.mocked(loadAiSettings).mockResolvedValue({ ...SETTINGS, enabled: false });
    await expect(
      runWithPrincipal(principal('ai.use'), () => runAiPrompt('test.prompt', { name: 'x' })),
    ).rejects.toBeInstanceOf(AiDisabledError);
  });

  it('runs permitted tools through the mock provider', async () => {
    const p = principal('ai.use', 'employee.view');
    const tools = availableAiTools(p, ['hr']).filter((t) => t.name === 'test_headcount');
    const result = await runWithPrincipal(p, () =>
      runAi({
        feature: 'assistant',
        messages: [{ role: 'user', content: 'How many employees do we have?' }],
        tools,
      }),
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.toolExecutions[0]).toMatchObject({ name: 'test_headcount', ok: true });
    expect(result.content).toContain('42 employees');
    // One reservation per model round (tool call + final answer).
    expect(vi.mocked(consumeLimit)).toHaveBeenCalledTimes(2);
  });

  it('never offers or executes tools the principal lacks permission for', async () => {
    const p = principal('ai.use');
    expect(availableAiTools(p, ['hr']).map((t) => t.name)).not.toContain('test_headcount');
    expect(
      availableAiTools(principal('employee.view'), ['payroll']).map((t) => t.name),
    ).not.toContain('test_headcount');
    const denied = await executeAiTool('test_headcount', {}, p, ['hr']);
    expect(denied).toMatchObject({ ok: false, data: { error: 'PERMISSION_DENIED' } });
    expect(handler).not.toHaveBeenCalled();
    const badArgs = await executeAiTool('test_headcount', { x: 1 }, principal('employee.view'), [
      'hr',
    ]);
    expect(badArgs.ok).toBe(false);
  });

  it('redacts PII sent to an external provider when data sharing is off', async () => {
    const seen: AiCompletionRequest[] = [];
    const external: AiProvider = {
      key: 'openai',
      async complete(req) {
        seen.push(req);
        return {
          content: 'ok',
          toolCalls: [],
          model: 'gpt',
          usage: { promptTokens: 5, completionTokens: 1 },
        };
      },
    };
    setAiProviderOverride(external);
    const ask = () =>
      runWithPrincipal(principal('ai.use'), () =>
        runAi({ feature: 'assistant', messages: [{ role: 'user', content: 'mail ravi@x.com' }] }),
      );
    await ask();
    expect(seen[0]!.messages[0]!.content).toBe('mail [EMAIL]');
    vi.mocked(loadAiSettings).mockResolvedValue({ ...SETTINGS, dataSharing: true });
    await ask();
    expect(seen[1]!.messages[0]!.content).toBe('mail ravi@x.com');
    // The usage log is always redacted.
    expect(usageCreate.mock.calls[1]![0].data.promptRedacted).toBe('mail [EMAIL]');
  });

  it('releases the reservation when the provider fails and logs ERROR', async () => {
    setAiProviderOverride({
      key: 'openai',
      complete: async () => {
        throw new Error('boom');
      },
    });
    await expect(
      runWithPrincipal(principal('ai.use'), () =>
        runAi({ feature: 'assistant', messages: [{ role: 'user', content: 'hi' }] }),
      ),
    ).rejects.toThrow('boom');
    expect(vi.mocked(releaseLimit)).toHaveBeenCalledWith(
      'ai_tokens',
      vi.mocked(consumeLimit).mock.calls[0]![1],
    );
    expect(usageCreate.mock.calls[0]![0].data).toMatchObject({ status: 'ERROR' });
  });

  it('mock provider is deterministic', async () => {
    const req: AiCompletionRequest = {
      model: 'm',
      messages: [{ role: 'user', content: 'hello' }],
      maxTokens: 50,
      temperature: 0,
    };
    const a = await mockAiProvider.complete(req, null);
    const b = await mockAiProvider.complete(req, null);
    expect(a).toEqual(b);
    expect(tenantDb).toBeDefined();
  });
});
