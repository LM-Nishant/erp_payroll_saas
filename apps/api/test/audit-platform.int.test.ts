import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { audit } from '../src/core/audit';
import { prisma } from '../src/core/db/prisma';
import { runAsPlatform } from '../src/core/platform';
import { tenantDb } from '../src/core/tenancy';
import {
  DEMO_PASSWORD,
  TEST_AUTH_RATE_LIMIT,
  asBearer,
  hasTestDatabase,
  login,
  seedAccessFixture,
  signIn,
} from './helpers';

describe.skipIf(!hasTestDatabase)('audit engine', () => {
  const app = createApp({ authRateLimit: TEST_AUTH_RATE_LIMIT });
  let orgIds: Record<string, string>;

  beforeAll(async () => {
    ({ orgIds } = await seedAccessFixture());
  });

  afterAll(() => prisma.$disconnect());

  it('records auth events with request metadata', async () => {
    await supertest(app)
      .post('/api/v1/auth/login')
      .set('User-Agent', 'audit-test-agent')
      .send({ email: 'owner@abbs.test', password: DEMO_PASSWORD })
      .expect(200);
    const row = await prisma.auditLog.findFirst({
      where: { action: 'auth.login', organizationId: orgIds.abbs, userAgent: 'audit-test-agent' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).not.toBeNull();
    expect(row!.requestId).toBeTruthy();
    expect(row!.ip).toBeTruthy();
  });

  it('records hierarchy mutations with a before/after diff', async () => {
    const owner = await signIn(app, 'owner@abbs.test', DEMO_PASSWORD);
    const group = (await owner.get('/api/v1/groups').expect(200)).body.data[0];
    await owner.patch(`/api/v1/groups/${group.id}`, { name: 'ABBS Group (renamed)' }).expect(200);
    await owner.patch(`/api/v1/groups/${group.id}`, { name: group.name }).expect(200);
    const logs = await owner
      .get(`/api/v1/audit-logs?entityType=group&entityId=${group.id}&action=group.update`)
      .expect(200);
    expect(logs.body.meta.total).toBeGreaterThanOrEqual(2);
    const latest = logs.body.data[0];
    expect(latest.before).toEqual({ name: 'ABBS Group (renamed)' });
    expect(latest.after).toEqual({ name: group.name });
    expect(latest.actorEmail).toBe('owner@abbs.test');
  });

  it('redacts sensitive fields', async () => {
    await audit.record({
      organizationId: orgIds.abbs,
      action: 'test.redaction',
      entityType: 'test',
      after: { name: 'x', password: 'hunter2', nested: { apiKey: 'k', ok: 1 } },
      actorType: 'system',
    });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'test.redaction' } });
    expect(row.after).toEqual({
      name: 'x',
      password: '[REDACTED]',
      nested: { apiKey: '[REDACTED]', ok: 1 },
    });
  });

  it('is append-only at the database level', async () => {
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'test.redaction' } });
    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { action: 'tampered' } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRaw`DELETE FROM audit_logs`).rejects.toThrow(/append-only/);
  });

  it('exposes no mutation API and is permission-gated', async () => {
    const owner = await signIn(app, 'owner@abbs.test', DEMO_PASSWORD);
    await owner.delete('/api/v1/audit-logs').expect(404);
    const teacherless = await signIn(app, 'cse.hod@abbs.test', DEMO_PASSWORD);
    await teacherless.get('/api/v1/audit-logs').expect(403);
    // Tenants never see another tenant's audit trail.
    const bcc = await signIn(app, 'admin@bcc.test', DEMO_PASSWORD);
    const bccLogs = await bcc.get('/api/v1/audit-logs').expect(403);
    expect(bccLogs.body.error).toBeDefined();
    const ownerLogs = await owner.get('/api/v1/audit-logs?pageSize=100').expect(200);
    expect(
      ownerLogs.body.data.every(
        (l: { organizationId: string }) => l.organizationId === orgIds.abbs,
      ),
    ).toBe(true);
  });
});

describe.skipIf(!hasTestDatabase)('platform super admin', () => {
  const app = createApp({ authRateLimit: TEST_AUTH_RATE_LIMIT });
  let orgIds: Record<string, string>;

  beforeAll(async () => {
    ({ orgIds } = await seedAccessFixture());
  });

  it('has no tenant access without an explicit audited access session', async () => {
    const tokens = await login(app, 'platform@erp.test', DEMO_PASSWORD);
    const platform = asBearer(app, tokens.accessToken);
    const me = await platform.get('/api/v1/me').expect(200);
    expect(me.body.data.organization).toBeNull();
    expect(me.body.data.platformRoles).toEqual(['platform_super_admin']);
    await platform.get('/api/v1/institutions').expect(401);

    const orgs = await platform.get('/api/v1/platform/organizations').expect(200);
    expect(orgs.body.meta.total).toBeGreaterThanOrEqual(3);

    await platform
      .post(`/api/v1/platform/organizations/${orgIds.bcc}/access`, { reason: 'short' })
      .expect(400);
    const access = await platform
      .post(`/api/v1/platform/organizations/${orgIds.bcc}/access`, {
        reason: 'Support ticket #4521: verify institution setup',
      })
      .expect(201);
    const tenant = asBearer(app, access.body.data.accessToken);
    const institutions = await tenant.get('/api/v1/institutions').expect(200);
    expect(institutions.body.meta.total).toBe(2);
    const tenantMe = await tenant.get('/api/v1/me').expect(200);
    expect(tenantMe.body.data.platformAccess).toBe(true);

    const opened = await prisma.auditLog.findFirst({
      where: { action: 'platform.tenant_access_opened', organizationId: orgIds.bcc },
    });
    expect(opened).toMatchObject({ reason: 'Support ticket #4521: verify institution setup' });

    // Writes in the access session carry the reason in the audit metadata.
    const institution = institutions.body.data[0];
    await tenant
      .patch(`/api/v1/institutions/${institution.id}`, { name: `${institution.name} (checked)` })
      .expect(200);
    const write = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'institution.update', entityId: institution.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(write.actorType).toBe('platform');
    expect(write.metadata).toMatchObject({
      platformAccessReason: 'Support ticket #4521: verify institution setup',
    });

    const platformLogs = await platform
      .get('/api/v1/platform/audit-logs?organizationSlug=bcc&action=platform.tenant_access_opened')
      .expect(200);
    expect(platformLogs.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('tenant users cannot use platform endpoints', async () => {
    const owner = await signIn(app, 'owner@abbs.test', DEMO_PASSWORD);
    await owner.get('/api/v1/platform/organizations').expect(403);
  });

  it('runAsPlatform requires a reason and is always audited', async () => {
    await expect(
      runAsPlatform({ organizationId: orgIds['jp-college']!, reason: 'x' }, async () => 1),
    ).rejects.toThrow();
    const count = await runAsPlatform(
      { organizationId: orgIds['jp-college']!, reason: 'Nightly integrity check job' },
      () => tenantDb().institution.count(),
    );
    expect(count).toBe(1);
    const row = await prisma.auditLog.findFirst({
      where: { action: 'platform.run_as', organizationId: orgIds['jp-college'] },
    });
    expect(row).toMatchObject({ reason: 'Nightly integrity check job' });
  });
});
