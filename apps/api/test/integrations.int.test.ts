import { createHmac } from 'node:crypto';
import supertest from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { tryGetPrincipal } from '../src/core/authz/principal';
import { prisma } from '../src/core/db/prisma';
import { emit, registerEventType } from '../src/core/events';
import {
  resetOutboundTransport,
  setOutboundTransport,
  type OutboundRequest,
} from '../src/core/http/outbound';
import { getIntegrationCredential } from '../src/core/integrations';
import {
  defineJob,
  drainJobs,
  enqueue,
  inlineQueue,
  runAsSystem,
  runRecurringJobNow,
} from '../src/core/queue';
import { tryGetTenantContext } from '../src/core/tenancy/context';
import {
  DEMO_PASSWORD,
  TEST_AUTH_RATE_LIMIT,
  hasTestDatabase,
  login,
  seedAccessFixture,
  signIn,
} from './helpers';

const isoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!hasTestDatabase)('integration framework & queue', () => {
  const app = createApp({ authRateLimit: TEST_AUTH_RATE_LIMIT });
  const http = () => supertest(app);
  let orgIds: Record<string, string>;
  let userIds: Record<string, string>;
  let abbs: string;
  let eng: string;
  const client = (email: string) => signIn(app, email, DEMO_PASSWORD);

  beforeAll(async () => {
    ({ orgIds, userIds } = await seedAccessFixture());
    abbs = orgIds.abbs!;
    eng = (
      await prisma.institution.findFirstOrThrow({
        where: { organizationId: abbs, code: 'ABBS-ENG' },
      })
    ).id;
    registerEventType({ key: 'test.thing_happened', label: 'Test thing happened' });
    registerEventType({ key: 'test.internal_only', label: 'Internal', webhook: false });
  });
  afterEach(() => resetOutboundTransport());
  afterAll(async () => {
    await drainJobs({ includeDelayed: true });
  });

  /* ------------------------------------ API clients ------------------------------------ */

  describe('API clients (client credentials)', () => {
    function token(clientId: string, secret: string, scope?: string) {
      return http()
        .post('/api/v1/oauth/token')
        .send({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: secret,
          ...(scope ? { scope } : {}),
        });
    }

    it('issues scoped tokens and enforces the client scopes', async () => {
      const owner = await client('owner@abbs.test');
      const created = (
        await owner
          .post('/api/v1/integrations/api-clients', {
            name: 'HR sync',
            scopes: ['institution.view', 'department.view'],
          })
          .expect(201)
      ).body.data;
      expect(created.clientId).toMatch(/^erp_/);
      expect(created.clientSecret).toMatch(/^erpsec_/);
      const stored = await prisma.apiClient.findUniqueOrThrow({ where: { id: created.id } });
      expect(JSON.stringify(stored)).not.toContain(created.clientSecret);
      const listed = (await owner.get(`/api/v1/integrations/api-clients/${created.id}`).expect(200))
        .body.data;
      expect(listed).not.toHaveProperty('clientSecret');

      await token(created.clientId, 'erpsec_wrong').expect(401);
      const tok = (await token(created.clientId, created.clientSecret).expect(200)).body;
      expect(tok.token_type).toBe('Bearer');
      expect(tok.scope.split(' ').sort()).toEqual(['department.view', 'institution.view']);

      // Basic auth works too.
      const basic = Buffer.from(`${created.clientId}:${created.clientSecret}`).toString('base64');
      await http()
        .post('/api/v1/oauth/token')
        .set('Authorization', `Basic ${basic}`)
        .type('form')
        .send({ grant_type: 'client_credentials' })
        .expect(200);

      const bearer = `Bearer ${tok.access_token}`;
      const insts = await http()
        .get('/api/v1/institutions')
        .set('Authorization', bearer)
        .expect(200);
      expect(
        insts.body.data.every(
          (i: { organizationId?: string }) => !i.organizationId || i.organizationId === abbs,
        ),
      ).toBe(true);
      await http()
        .post('/api/v1/institutions')
        .set('Authorization', bearer)
        .send({ name: 'Nope', code: 'NOPE' })
        .expect(403);
      await http().get('/api/v1/users').set('Authorization', bearer).expect(403);

      // Narrower token: only institution.view.
      const narrow = (
        await token(created.clientId, created.clientSecret, 'institution.view').expect(200)
      ).body;
      expect(narrow.scope).toBe('institution.view');
      await http()
        .get('/api/v1/departments')
        .set('Authorization', `Bearer ${narrow.access_token}`)
        .expect(403);
      await token(created.clientId, created.clientSecret, 'user.view').expect(400);

      // Usage is logged.
      await drainJobs();
      const usage = (
        await owner.get(`/api/v1/integrations/api-clients/${created.id}/usage`).expect(200)
      ).body.data;
      expect(usage.length).toBeGreaterThan(0);
      expect(
        (await prisma.apiClient.findUniqueOrThrow({ where: { id: created.id } })).lastUsedAt,
      ).not.toBeNull();

      // Revoke: existing tokens and new token requests fail.
      await owner.post(`/api/v1/integrations/api-clients/${created.id}/revoke`).expect(200);
      await http().get('/api/v1/institutions').set('Authorization', bearer).expect(401);
      await token(created.clientId, created.clientSecret).expect(401);
    });

    it('refuses dangerous scopes and scopes the creator does not hold', async () => {
      const owner = await client('owner@abbs.test');
      await owner
        .post('/api/v1/integrations/api-clients', { name: 'Bad', scopes: ['secret.view'] })
        .expect(400);
      await owner
        .post('/api/v1/integrations/api-clients', { name: 'Bad', scopes: ['user.create'] })
        .expect(400);
      const groupAdmin = await client('group.admin@abbs.test');
      await groupAdmin
        .post('/api/v1/integrations/api-clients', { name: 'Bad', scopes: ['institution.view'] })
        .expect(403);
    });

    it('isolates API clients between tenants', async () => {
      const owner = await client('owner@abbs.test');
      const created = (
        await owner
          .post('/api/v1/integrations/api-clients', { name: 'Iso', scopes: ['institution.view'] })
          .expect(201)
      ).body.data;
      const tok = (await token(created.clientId, created.clientSecret).expect(200)).body
        .access_token;
      const bccInst = await prisma.institution.findFirstOrThrow({
        where: { organizationId: orgIds.bcc! },
      });
      await http()
        .get(`/api/v1/institutions/${bccInst.id}`)
        .set('Authorization', `Bearer ${tok}`)
        .expect(404);
      const bcc = await client('admin@bcc.test');
      await bcc.get(`/api/v1/integrations/api-clients/${created.id}`).expect(404);
    });
  });

  /* -------------------------------------- Webhooks -------------------------------------- */

  describe('outbound webhooks', () => {
    it('delivers signed events, retries with backoff, fails, and replays', async () => {
      const sent: OutboundRequest[] = [];
      let respond = 500;
      setOutboundTransport(async (req) => {
        sent.push(req);
        return { status: respond, headers: {}, body: respond === 200 ? 'ok' : 'boom' };
      });
      const owner = await client('owner@abbs.test');
      await owner
        .post('/api/v1/integrations/webhooks', {
          name: 'Bad events',
          url: 'https://hooks.example.com/erp',
          events: ['test.internal_only'],
        })
        .expect(400);
      const hook = (
        await owner
          .post('/api/v1/integrations/webhooks', {
            name: 'Test hook',
            url: 'https://hooks.example.com/erp',
            events: ['test.*'],
          })
          .expect(201)
      ).body.data;
      expect(hook.signingSecret).toMatch(/.{20,}/);

      respond = 200;
      await runAsSystem(abbs, () =>
        emit('test.thing_happened', { thingId: 't1' }, { institutionId: eng }),
      );
      await drainJobs();
      expect(sent).toHaveLength(1);
      const req = sent[0]!;
      expect(req.url).toBe('https://hooks.example.com/erp');
      expect(req.headers!['x-erp-event']).toBe('test.thing_happened');
      const sig = req.headers!['x-erp-signature']!;
      const ts = req.headers!['x-erp-timestamp']!;
      const expected = createHmac('sha256', hook.signingSecret)
        .update(`${ts}.${req.body}`)
        .digest('hex');
      expect(sig).toBe(`t=${ts},v1=${expected}`);
      const payload = JSON.parse(req.body!);
      expect(payload).toMatchObject({
        event: 'test.thing_happened',
        organizationId: abbs,
        institutionId: eng,
        data: { thingId: 't1' },
      });

      // Internal-only events never go out.
      await runAsSystem(abbs, () => emit('test.internal_only', {}));
      await drainJobs();
      expect(sent).toHaveLength(1);

      // Failures retry with backoff until exhausted.
      respond = 500;
      await runAsSystem(abbs, () => emit('test.thing_happened', { thingId: 't2' }));
      await drainJobs();
      let deliveries = (
        await owner.get(`/api/v1/integrations/webhooks/${hook.id}/deliveries`).expect(200)
      ).body.data;
      const failing = deliveries.find((d: { status: string }) => d.status === 'RETRYING');
      expect(failing).toMatchObject({ attempts: 1, lastStatusCode: 500 });
      expect(new Date(failing.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
      for (let i = 0; i < 6; i += 1) await drainJobs({ includeDelayed: true });
      deliveries = (
        await owner.get(`/api/v1/integrations/webhooks/${hook.id}/deliveries`).expect(200)
      ).body.data;
      const failed = deliveries.find((d: { id: string }) => d.id === failing.id);
      expect(failed).toMatchObject({ status: 'FAILED', attempts: 6 });
      expect(
        (await owner.get(`/api/v1/integrations/webhooks/${hook.id}`).expect(200)).body.data
          .consecutiveFailures,
      ).toBeGreaterThanOrEqual(6);

      // Replay once the receiver is healthy again.
      respond = 200;
      const replay = (
        await owner
          .post(`/api/v1/integrations/webhooks/${hook.id}/deliveries/${failing.id}/replay`)
          .expect(202)
      ).body.data;
      expect(replay.replayOfId).toBe(failing.id);
      await drainJobs();
      const replayed = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: replay.id } });
      expect(replayed.status).toBe('DELIVERED');

      // Other tenants cannot see it.
      const bcc = await client('admin@bcc.test');
      await bcc.get(`/api/v1/integrations/webhooks/${hook.id}`).expect(403);
      await owner.delete(`/api/v1/integrations/webhooks/${hook.id}`).expect(204);
    });

    it('rejects private / insecure URLs unless explicitly allowed', async () => {
      const owner = await client('owner@abbs.test');
      // Test env sets WEBHOOK_ALLOW_INSECURE? Only https public hosts are always accepted.
      const res = await owner.post('/api/v1/integrations/webhooks', {
        name: 'Internal',
        url: 'ftp://hooks.example.com/x',
        events: ['*'],
      });
      expect(res.status).toBe(400);
    });
  });

  /* --------------------------------- Integration credentials ---------------------------- */

  it('stores integration credentials as secrets and resolves them server-side', async () => {
    const owner = await client('owner@abbs.test');
    const cred = (
      await owner
        .post('/api/v1/integrations/credentials', {
          provider: 'tally',
          credentials: 'super-secret-key',
          config: { host: 'tally.example.com' },
        })
        .expect(201)
    ).body.data;
    expect(JSON.stringify(cred)).not.toContain('super-secret-key');
    const value = await runAsSystem(abbs, async () =>
      (
        await getIntegrationCredential({ provider: 'tally', purpose: 'test.sync' })
      )?.secret.reveal(),
    );
    expect(value).toBe('super-secret-key');
    const bcc = await client('admin@bcc.test');
    await bcc.get(`/api/v1/integrations/credentials/${cred.id}`).expect(404);
  });

  /* ---------------------------------------- Queue ---------------------------------------- */

  describe('queue', () => {
    const seen: Array<{ org: string | undefined; actor: string | undefined; attempt: number }> = [];
    let failuresLeft = 2;
    defineJob<{ organizationId: string }>({
      name: 'test.context_probe',
      attempts: 4,
      backoffMs: 1000,
      handler: async (_data, info) => {
        seen.push({
          org: tryGetTenantContext()?.organizationId,
          actor: tryGetPrincipal()?.actorType,
          attempt: info.attempt,
        });
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          throw new Error('transient');
        }
      },
    });

    it('runs jobs in the tenant context of the payload, retrying with backoff', async () => {
      await enqueue('test.context_probe', { organizationId: orgIds.bcc! });
      await drainJobs();
      expect(seen).toHaveLength(1);
      expect(inlineQueue.pending().length).toBe(1);
      await drainJobs({ includeDelayed: true });
      await drainJobs({ includeDelayed: true });
      expect(seen.map((s) => s.attempt)).toEqual([1, 2, 3]);
      expect(seen.every((s) => s.org === orgIds.bcc && s.actor === 'system')).toBe(true);
    });

    it('rejects payloads without an organizationId', async () => {
      await expect(
        enqueue('test.context_probe', {} as { organizationId: string }),
      ).rejects.toThrow();
    });

    it('scheduled document expiry reminders notify in tenant context', async () => {
      const { accessToken } = await login(app, 'eng.admin@abbs.test', DEMO_PASSWORD);
      const doc = (
        await http()
          .post('/api/v1/documents/files')
          .set('Authorization', `Bearer ${accessToken}`)
          .field(
            'metadata',
            JSON.stringify({
              ownerType: 'institution',
              ownerId: eng,
              title: 'Fire NOC queue test',
              category: 'institution',
              expiryDate: isoDay(1),
              reminderDays: [1],
            }),
          )
          .attach('file', Buffer.from('%PDF-1.4\n% q\n%%EOF\n'), {
            filename: 'noc.pdf',
            contentType: 'application/pdf',
          })
          .expect(201)
      ).body.data;
      await runRecurringJobNow('documents.expiry_reminders.schedule');
      await drainJobs();
      const notes = await prisma.notification.findMany({
        where: { organizationId: abbs, eventKey: 'document.expiring' },
      });
      expect(notes.some((n) => n.title.includes('Fire NOC queue test'))).toBe(true);
      expect(notes.some((n) => n.userId === userIds['eng.admin@abbs.test'])).toBe(true);
      const reminder = await prisma.documentExpiryReminder.findFirstOrThrow({
        where: { documentId: doc.id },
      });
      expect(reminder.sentAt).not.toBeNull();
    });
  });
});
