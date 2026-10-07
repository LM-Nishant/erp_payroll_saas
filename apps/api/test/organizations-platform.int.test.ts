import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { messageOutbox } from '../src/core/communication';
import { prisma } from '../src/core/db/prisma';
import {
  DEMO_PASSWORD,
  TEST_AUTH_RATE_LIMIT,
  asBearer,
  asTenant,
  hasTestDatabase,
  login,
  seedAccessFixture,
  signIn,
} from './helpers';

function inviteToken(to: string): string {
  const mail = [...messageOutbox]
    .reverse()
    .find((m) => m.to === to && m.text.includes('accept-invite'));
  const match = mail?.text.match(/token=([A-Za-z0-9_%.-]+)/);
  if (!match?.[1]) throw new Error(`No invite e-mail for ${to}`);
  return decodeURIComponent(match[1]);
}

describe.skipIf(!hasTestDatabase)('platform organization management', () => {
  const app = createApp({ authRateLimit: TEST_AUTH_RATE_LIMIT });
  const http = () => supertest(app);
  const stamp = Date.now().toString(36);
  const slug = `acme-${stamp}`;
  const ownerEmail = `owner-${stamp}@acme.test`;
  let platform: Awaited<ReturnType<typeof signIn>>;
  let planId: string;
  let orgId: string;

  beforeAll(async () => {
    await seedAccessFixture();
    platform = await signIn(app, 'platform@erp.test', DEMO_PASSWORD);
    const plans = await platform.get('/api/v1/platform/plans').expect(200);
    planId = plans.body.data.find((p: { key: string }) => p.key === 'professional').id;
  });

  afterAll(() => prisma.$disconnect());

  it('rejects tenant users and invalid input', async () => {
    const owner = await signIn(app, 'owner@abbs.test', DEMO_PASSWORD);
    await owner
      .post('/api/v1/platform/organizations', {
        name: 'X',
        slug: 'x-org',
        planId,
        owner: { name: 'X', email: 'x@x.test' },
      })
      .expect(403);
    await platform
      .post('/api/v1/platform/organizations', {
        name: 'Bad',
        slug: 'Bad Slug!',
        planId,
        owner: { name: 'X', email: 'x@x.test' },
      })
      .expect(400);
    await platform
      .post('/api/v1/platform/organizations', {
        name: 'Taken',
        slug: 'abbs',
        planId,
        owner: { name: 'X', email: 'x@x.test' },
      })
      .expect(409);
  });

  it('onboards an organization with roles, subscription and an invited owner', async () => {
    const res = await platform
      .post('/api/v1/platform/organizations', {
        name: 'Acme Education Trust',
        slug,
        planId,
        subscriptionStatus: 'TRIAL',
        owner: { name: 'Acme Owner', email: ownerEmail },
      })
      .expect(201);
    orgId = res.body.data.id;
    expect(res.body.data).toMatchObject({ slug, status: 'ACTIVE' });
    expect(res.body.data.owner.email).toBe(ownerEmail);
    expect(JSON.stringify(res.body)).not.toMatch(/token=/);

    expect(await prisma.role.count({ where: { organizationId: orgId } })).toBeGreaterThan(10);
    const sub = await platform.get(`/api/v1/platform/organizations/${orgId}/subscription`);
    expect(sub.body.data).toMatchObject({ status: 'TRIAL', plan: { key: 'professional' } });

    const detail = await platform.get(`/api/v1/platform/organizations/${orgId}`).expect(200);
    expect(detail.body.data.counts.users).toBe(1);
    expect(detail.body.data.owners).toEqual([
      expect.objectContaining({ email: ownerEmail, membershipStatus: 'INVITED' }),
    ]);

    const audits = await prisma.auditLog.findMany({
      where: { organizationId: orgId },
      select: { action: true, actorType: true },
    });
    const actions = audits.map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['organization.create', 'platform.run_as', 'user.create']),
    );

    // The owner accepts the e-mailed invite and gets organization-wide owner access.
    await http()
      .post('/api/v1/auth/accept-invite')
      .send({ token: inviteToken(ownerEmail), password: 'Acme-Passw0rd!' })
      .expect(204);
    const tokens = await login(app, ownerEmail, 'Acme-Passw0rd!');
    const me = await asBearer(app, tokens.accessToken).get('/api/v1/me').expect(200);
    expect(me.body.data.organization.slug).toBe(slug);
    expect(me.body.data.roles[0].key).toBe('group_owner');
  });

  it('lists, filters and renames organizations', async () => {
    const list = await platform.get(`/api/v1/platform/organizations?search=${slug}`).expect(200);
    expect(list.body.data.map((o: { id: string }) => o.id)).toEqual([orgId]);
    await platform
      .patch(`/api/v1/platform/organizations/${orgId}`, { name: 'Acme', reason: 'short' })
      .expect(400);
    const renamed = await platform
      .patch(`/api/v1/platform/organizations/${orgId}`, {
        name: 'Acme Trust',
        reason: 'Legal name change requested by customer',
      })
      .expect(200);
    expect(renamed.body.data.name).toBe('Acme Trust');
  });

  it('suspends (revoking sessions) and re-activates an organization', async () => {
    const tokens = await login(app, ownerEmail, 'Acme-Passw0rd!');
    const owner = asBearer(app, tokens.accessToken);
    await owner.get('/api/v1/me').expect(200);

    const suspended = await platform
      .post(`/api/v1/platform/organizations/${orgId}/status`, {
        status: 'SUSPENDED',
        reason: 'Unpaid invoices for three months',
      })
      .expect(200);
    expect(suspended.body.data.status).toBe('SUSPENDED');
    await owner.get('/api/v1/me').expect(401);
    const inactive = await asTenant(app, slug).get('/api/v1/groups');
    expect(inactive.status).toBe(403);
    expect(inactive.body.error.code).toBe('TENANT_INACTIVE');

    const filtered = await platform
      .get('/api/v1/platform/organizations?status=SUSPENDED')
      .expect(200);
    expect(filtered.body.data.map((o: { id: string }) => o.id)).toContain(orgId);

    await platform
      .post(`/api/v1/platform/organizations/${orgId}/status`, {
        status: 'ACTIVE',
        reason: 'Payment received, restoring access',
      })
      .expect(200);
    const again = await login(app, ownerEmail, 'Acme-Passw0rd!');
    await asBearer(app, again.accessToken).get('/api/v1/me').expect(200);

    const actions = (
      await prisma.auditLog.findMany({
        where: { organizationId: orgId, entityType: 'organization' },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['organization.suspend', 'organization.activate']),
    );
  });

  it('invites an additional owner', async () => {
    const email = `co-owner-${stamp}@acme.test`;
    await platform
      .post(`/api/v1/platform/organizations/${orgId}/owners`, {
        name: 'Co Owner',
        email,
        role: 'institution_owner',
      })
      .expect(201);
    const detail = await platform.get(`/api/v1/platform/organizations/${orgId}`).expect(200);
    expect(detail.body.data.owners.map((o: { email: string }) => o.email)).toEqual(
      expect.arrayContaining([ownerEmail, email]),
    );
  });
});
