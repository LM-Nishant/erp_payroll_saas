import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { setAiProviderOverride } from '../src/core/ai';
import { prisma } from '../src/core/db/prisma';
import { provisionOrganizationSubscription, syncPlanCatalog } from '../src/core/features';
import { DEMO_PASSWORD, hasTestDatabase, seedAccessFixture, signIn } from './helpers';

describe.skipIf(!hasTestDatabase)('AI gateway', () => {
  const app = createApp();
  const SELF = 'ai.self@abbs.test';
  let orgIds: Record<string, string>;
  let owner: Awaited<ReturnType<typeof signIn>>;
  let hr: Awaited<ReturnType<typeof signIn>>;
  let self: Awaited<ReturnType<typeof signIn>>;
  let bcc: Awaited<ReturnType<typeof signIn>>;

  beforeAll(async () => {
    const fixture = await seedAccessFixture();
    orgIds = fixture.orgIds as Record<string, string>;
    const { seedAccessControl } = await import('../prisma/seed-access');
    await seedAccessControl(prisma, fixture.orgIds, {
      password: DEMO_PASSWORD,
      users: [
        {
          email: SELF,
          name: 'AI Self Service',
          organization: 'abbs',
          role: 'employee',
          scope: { type: 'INSTITUTION', institution: 'ABBS-ENG' },
        },
      ],
    });
    await syncPlanCatalog();
    await provisionOrganizationSubscription(orgIds.abbs!, 'enterprise');
    await provisionOrganizationSubscription(orgIds.bcc!, 'professional');
    await provisionOrganizationSubscription(orgIds['jp-college']!, 'starter');
    owner = await signIn(app, 'owner@abbs.test', DEMO_PASSWORD, 'abbs');
    hr = await signIn(app, 'group.hr@abbs.test', DEMO_PASSWORD, 'abbs');
    self = await signIn(app, SELF, DEMO_PASSWORD, 'abbs');
    bcc = await signIn(app, 'admin@bcc.test', DEMO_PASSWORD, 'bcc');
  });
  afterAll(async () => {
    setAiProviderOverride(null);
    await prisma.$disconnect();
  });

  it('reports status with the mock provider when no key is configured', async () => {
    const status = (await owner.get('/api/v1/ai/status').expect(200)).body.data;
    expect(status).toMatchObject({
      enabled: true,
      effectiveProvider: 'mock',
      secretConfigured: false,
      canManage: true,
      canViewUsage: true,
    });
    expect(status.tokens.limit).toBeNull(); // enterprise = unlimited
  });

  it('is gated by the ai feature (plan) ', async () => {
    const jp = await signIn(app, 'admin@jp-college.test', DEMO_PASSWORD, 'jp-college');
    const res = await jp.get('/api/v1/ai/status').expect(403);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
  });

  it('only ai.manage can change settings; changes are audited', async () => {
    await hr.put('/api/v1/ai/settings', { maxTokensPerRequest: 512 }).expect(403);
    await owner.put('/api/v1/ai/settings', { organizationId: orgIds.bcc }).expect(400);
    const saved = (
      await owner
        .put('/api/v1/ai/settings', {
          provider: 'mock',
          maxTokensPerRequest: 800,
          dataSharing: false,
        })
        .expect(200)
    ).body.data;
    expect(saved).toMatchObject({ provider: 'mock', maxTokensPerRequest: 800 });
    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: orgIds.abbs, action: 'ai.settings.update' },
    });
    expect(audit).not.toBeNull();
    // Settings are per organization.
    expect((await bcc.get('/api/v1/ai/settings').expect(200)).body.data.maxTokensPerRequest).toBe(
      1024,
    );
  });

  it('assistant uses only tools the caller is permitted to use', async () => {
    const res = (
      await hr.post('/api/v1/ai/chat', { message: 'How many employees do we have?' }).expect(200)
    ).body.data;
    expect(res.messages).toHaveLength(2);
    const calls = res.messages[1].toolCalls as { name: string; ok: boolean }[];
    expect(calls.map((c) => c.name)).toContain('employee_headcount');
    expect(calls.every((c) => c.ok)).toBe(true);

    const denied = (
      await self.post('/api/v1/ai/chat', { message: 'How many employees do we have?' }).expect(200)
    ).body.data;
    const selfCalls = denied.messages[1].toolCalls as { name: string }[];
    expect(selfCalls.map((c) => c.name)).not.toContain('employee_headcount');
  });

  it('conversations are private to their owner and tenant', async () => {
    const first = (
      await owner.post('/api/v1/ai/chat', { message: 'Hello, what can you do?' }).expect(200)
    ).body.data;
    const id = first.conversation.id as string;
    await owner
      .post('/api/v1/ai/chat', { conversationId: id, message: 'How many students?' })
      .expect(200);
    const detail = (await owner.get(`/api/v1/ai/conversations/${id}`).expect(200)).body.data;
    expect(detail.messages).toHaveLength(4);
    expect(detail.messageCount).toBe(4);
    const list = (await owner.get('/api/v1/ai/conversations').expect(200)).body;
    expect(list.data.map((c: { id: string }) => c.id)).toContain(id);

    await hr.get(`/api/v1/ai/conversations/${id}`).expect(404);
    await hr.post('/api/v1/ai/chat', { conversationId: id, message: 'hi' }).expect(404);
    await bcc.get(`/api/v1/ai/conversations/${id}`).expect(404);
    await bcc.delete(`/api/v1/ai/conversations/${id}`).expect(404);

    await owner.delete(`/api/v1/ai/conversations/${id}`).expect(204);
    await owner.get(`/api/v1/ai/conversations/${id}`).expect(404);
    expect(await prisma.aiMessage.count({ where: { conversationId: id } })).toBe(0);
  });

  it('drafts documents and summarizes text', async () => {
    const draft = (
      await hr
        .post('/api/v1/ai/drafts', {
          kind: 'offer_letter',
          instructions: 'Probation period is six months.',
          variables: { name: 'Asha Rao', designation: 'Assistant Professor' },
        })
        .expect(200)
    ).body.data;
    expect(draft.subject).toContain('Assistant Professor');
    expect(draft.body).toContain('Dear Asha Rao');
    expect(draft.usage.provider).toBe('mock');

    const summary = (
      await hr
        .post('/api/v1/ai/summarize', {
          kind: 'resume',
          text: 'Experienced Java and Vue developer with 6 years at Infosys. Holds an MTech from NIT.',
        })
        .expect(200)
    ).body.data;
    expect(summary.summary).toMatch(/Candidate summary/);
    expect(summary.highlights.length).toBeGreaterThan(0);
  });

  it('student insights and payroll explanations respect permissions', async () => {
    const insight = (await owner.post('/api/v1/ai/students/insights', {}).expect(200)).body.data;
    expect(insight.dataSources).toContain('student records');
    await self.post('/api/v1/ai/students/insights', {}).expect(403);
    await self
      .post('/api/v1/ai/payroll/explain', { runId: '00000000-0000-4000-8000-000000000000' })
      .expect(403);
    await owner
      .post('/api/v1/ai/payroll/explain', { runId: '00000000-0000-4000-8000-000000000000' })
      .expect(404);
  });

  it('records redacted usage logs visible only to usage viewers of the same tenant', async () => {
    await owner
      .post('/api/v1/ai/chat', { message: 'Email ravi.k@abbs.test or call 9876543210 please' })
      .expect(200);
    const logs = (await owner.get('/api/v1/ai/usage/logs?pageSize=100').expect(200)).body;
    expect(logs.meta.total).toBeGreaterThan(0);
    const previews = logs.data
      .map((l: { promptPreview: string | null }) => l.promptPreview)
      .join('\n');
    expect(previews).toContain('[EMAIL]');
    expect(previews).not.toContain('ravi.k@abbs.test');
    expect(previews).not.toContain('9876543210');

    const dash = (await owner.get('/api/v1/ai/usage').expect(200)).body.data;
    expect(dash.totals.requests).toBe(logs.meta.total);
    expect(dash.byFeature.map((f: { feature: string }) => f.feature)).toEqual(
      expect.arrayContaining(['assistant', 'drafting']),
    );
    expect(dash.tokens.used).toBeGreaterThan(0);

    await self.get('/api/v1/ai/usage').expect(403);
    const bccLogs = (await bcc.get('/api/v1/ai/usage/logs').expect(200)).body;
    expect(bccLogs.meta.total).toBe(0);
  });

  it('consumes ai_tokens and refuses calls past the plan limit (logged as LIMITED)', async () => {
    await bcc.post('/api/v1/ai/chat', { message: 'hello' }).expect(200);
    const counter = await prisma.usageCounter.findFirstOrThrow({
      where: { organizationId: orgIds.bcc, limitKey: 'ai_tokens' },
    });
    expect(Number(counter.used)).toBeGreaterThan(0);
    await prisma.usageCounter.update({ where: { id: counter.id }, data: { used: 1_999_999n } });
    const res = await bcc.post('/api/v1/ai/chat', { message: 'hello again' }).expect(403);
    expect(res.body.error.code).toBe('LIMIT_EXCEEDED');
    const limited = await prisma.aiUsageLog.count({
      where: { organizationId: orgIds.bcc, status: 'LIMITED' },
    });
    expect(limited).toBe(1);
    await prisma.usageCounter.update({ where: { id: counter.id }, data: { used: 0n } });
  });

  it('provider failures are logged as errors and release the reservation', async () => {
    setAiProviderOverride({
      key: 'openai',
      complete: async () => {
        throw new Error('upstream down');
      },
    });
    try {
      await bcc.post('/api/v1/ai/drafts', { kind: 'notice', instructions: 'Holiday' }).expect(500);
    } finally {
      setAiProviderOverride(null);
    }
    const counter = await prisma.usageCounter.findFirstOrThrow({
      where: { organizationId: orgIds.bcc, limitKey: 'ai_tokens' },
    });
    expect(Number(counter.used)).toBe(0);
    expect(
      await prisma.aiUsageLog.count({ where: { organizationId: orgIds.bcc, status: 'ERROR' } }),
    ).toBe(1);
  });
});
