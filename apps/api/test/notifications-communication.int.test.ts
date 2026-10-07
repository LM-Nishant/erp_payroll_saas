import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { clearOutbox, messageOutbox, signDeliveryCallback } from '../src/core/communication';
import { prisma } from '../src/core/db/prisma';
import { periodKeyFor } from '../src/core/features/resolve';
import { publish, registerNotificationEvent } from '../src/core/notifications';
import { drainJobs, runAsSystem } from '../src/core/queue';
import supertest from 'supertest';
import {
  DEMO_PASSWORD,
  TEST_AUTH_RATE_LIMIT,
  hasTestDatabase,
  seedAccessFixture,
  signIn,
} from './helpers';

const EVENT = 'test.report_ready';

describe.skipIf(!hasTestDatabase)('notifications & communication engines', () => {
  const app = createApp({ authRateLimit: TEST_AUTH_RATE_LIMIT });
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
    registerNotificationEvent({
      key: EVENT,
      label: 'Test report ready',
      defaultChannels: ['in_app', 'email'],
    });
    await prisma.communicationProvider.deleteMany({});
    await prisma.messageTemplate.deleteMany({
      where: { organizationId: { in: Object.values(orgIds) } },
    });
  });

  beforeEach(() => clearOutbox());
  afterAll(async () => {
    await drainJobs();
  });

  async function publishTo(email: string, title: string) {
    await runAsSystem(abbs, () =>
      publish(EVENT, {
        recipients: [userIds[email]!],
        title,
        body: 'Your monthly report is ready.',
        link: '/reports/1',
        institutionId: eng,
      }),
    );
    await drainJobs();
  }

  it('publish -> in-app notification + email via the log provider; unread & mark read', async () => {
    await publishTo('eng.admin@abbs.test', 'Report ready #1');
    const engAdmin = await client('eng.admin@abbs.test');
    const list = (await engAdmin.get('/api/v1/notifications?unread=true').expect(200)).body;
    const note = list.data.find((n: { title: string }) => n.title === 'Report ready #1');
    expect(note).toMatchObject({ eventKey: EVENT, link: '/reports/1', readAt: null });
    const unread = (await engAdmin.get('/api/v1/notifications/unread-count').expect(200)).body.data
      .count;
    expect(unread).toBeGreaterThan(0);

    const mail = messageOutbox.find((m) => m.to === 'eng.admin@abbs.test');
    expect(mail).toBeDefined();
    expect(mail!.subject).toContain('Report ready #1');
    expect(mail!.html).toContain('<html');

    await engAdmin.post(`/api/v1/notifications/${note.id}/read`).expect(200);
    const after = (await engAdmin.get('/api/v1/notifications/unread-count').expect(200)).body.data
      .count;
    expect(after).toBe(unread - 1);
    await engAdmin.post('/api/v1/notifications/read-all').expect(200);
    expect(
      (await engAdmin.get('/api/v1/notifications/unread-count').expect(200)).body.data.count,
    ).toBe(0);

    // Other users never see someone else's notification.
    const owner = await client('owner@abbs.test');
    await owner.post(`/api/v1/notifications/${note.id}/read`).expect(404);
  });

  it('honours user channel preferences', async () => {
    const hod = await client('cse.hod@abbs.test');
    await hod
      .put('/api/v1/notifications/preferences', {
        preferences: [{ eventKey: EVENT, channel: 'email', enabled: false }],
      })
      .expect(200);
    await publishTo('cse.hod@abbs.test', 'Report ready #2');
    expect(messageOutbox.some((m) => m.to === 'cse.hod@abbs.test')).toBe(false);
    const list = (await hod.get('/api/v1/notifications').expect(200)).body.data;
    expect(list.some((n: { title: string }) => n.title === 'Report ready #2')).toBe(true);
  });

  it('renders templates with variables and branding (logo / name / colour)', async () => {
    const owner = await client('owner@abbs.test');
    await owner
      .put('/api/v1/branding/organization', {
        displayName: 'ABBS Education Trust',
        primaryColor: '#123456',
      })
      .expect(200);
    const tpl = (
      await owner
        .post('/api/v1/communication/templates', {
          key: 'test.welcome',
          channel: 'email',
          name: 'Welcome',
          subject: 'Welcome {{name}}',
          body: 'Hello {{name}}, your code is {{code}}.',
          htmlBody: '<p>Hello <b>{{name}}</b></p>',
        })
        .expect(201)
    ).body.data;
    expect(tpl.currentVersion).toMatchObject({ version: 1 });
    expect(tpl.currentVersion.variables).toEqual(expect.arrayContaining(['name', 'code']));

    const preview = (
      await owner
        .post(`/api/v1/communication/templates/${tpl.id}/preview`, {
          variables: { name: '<Asha>', code: 'X1' },
        })
        .expect(200)
    ).body.data;
    expect(preview.subject).toBe('Welcome <Asha>');
    expect(preview.text).toBe('Hello <Asha>, your code is X1.');
    expect(preview.html).toContain('&lt;Asha&gt;');
    expect(preview.html).not.toContain('<Asha>');
    expect(preview.html).toContain('ABBS Education Trust');
    expect(preview.html).toContain('#123456');

    const v2 = (
      await owner
        .post(`/api/v1/communication/templates/${tpl.id}/versions`, {
          subject: 'Hi {{name}}',
          body: 'Hi {{name}}',
        })
        .expect(201)
    ).body.data;
    expect(v2.currentVersion.version).toBe(2);
    const versions = (
      await owner.get(`/api/v1/communication/templates/${tpl.id}/versions`).expect(200)
    ).body.data;
    expect(versions).toHaveLength(2);

    // Send by template to a raw address -> log provider outbox.
    const sent = (
      await owner
        .post('/api/v1/communication/messages', {
          channel: 'email',
          templateKey: 'test.welcome',
          recipients: [{ address: 'parent@example.com', variables: { name: 'Ravi' } }],
        })
        .expect(202)
    ).body.data;
    expect(sent[0].status).toBe('QUEUED');
    await drainJobs();
    const mail = messageOutbox.find((m) => m.to === 'parent@example.com');
    expect(mail?.subject).toBe('Hi Ravi');
    const log = await prisma.messageLog.findUniqueOrThrow({ where: { id: sent[0].id } });
    expect(log).toMatchObject({ status: 'SENT', templateKey: 'test.welcome', templateVersion: 2 });
  });

  it('configured providers + signed delivery callbacks update message status', async () => {
    const owner = await client('owner@abbs.test');
    const provider = (
      await owner
        .post('/api/v1/communication/providers', {
          channel: 'email',
          providerType: 'log',
          name: 'Test log email',
          costPerMessage: 0.01,
        })
        .expect(201)
    ).body.data;
    expect(provider.webhookSigningSecret).toMatch(/.{20,}/);
    const listed = (await owner.get('/api/v1/communication/providers').expect(200)).body.data;
    expect(listed[0]).not.toHaveProperty('webhookSigningSecret');

    const sent = (
      await owner
        .post('/api/v1/communication/messages', {
          channel: 'email',
          subject: 'Fee reminder',
          body: 'Please pay',
          recipients: [{ address: 'payer@example.com' }],
        })
        .expect(202)
    ).body.data;
    await drainJobs();
    const log = await prisma.messageLog.findUniqueOrThrow({ where: { id: sent[0].id } });
    expect(log.providerId).toBe(provider.id);
    expect(log.status).toBe('SENT');

    const body = JSON.stringify({
      providerMessageId: log.providerMessageId,
      status: 'delivered',
      cost: 0.02,
    });
    const url = `/api/v1/communication/webhooks/${provider.id}`;
    await supertest(app)
      .post(url)
      .set('Content-Type', 'application/json')
      .set('X-Erp-Signature', 'sha256=deadbeef')
      .send(body)
      .expect(401);
    const ok = await supertest(app)
      .post(url)
      .set('Content-Type', 'application/json')
      .set('X-Erp-Signature', signDeliveryCallback(provider.webhookSigningSecret, body))
      .send(body)
      .expect(200);
    expect(ok.body.data).toEqual({ received: 1, updated: 1 });
    const after = await prisma.messageLog.findUniqueOrThrow({ where: { id: log.id } });
    expect(after.status).toBe('DELIVERED');
    expect(Number(after.cost)).toBeCloseTo(0.02);
    expect(await prisma.deliveryEvent.count({ where: { messageLogId: log.id } })).toBeGreaterThan(
      0,
    );

    const detail = (await owner.get(`/api/v1/communication/messages/${log.id}`).expect(200)).body
      .data;
    expect(detail.status).toBe('DELIVERED');
  });

  it('isolates providers, templates and logs between tenants', async () => {
    const bcc = await client('admin@bcc.test');
    const abbsProvider = await prisma.communicationProvider.findFirstOrThrow({
      where: { organizationId: abbs },
    });
    const abbsTemplate = await prisma.messageTemplate.findFirstOrThrow({
      where: { organizationId: abbs },
    });
    const abbsLog = await prisma.messageLog.findFirstOrThrow({ where: { organizationId: abbs } });
    await bcc.get(`/api/v1/communication/providers/${abbsProvider.id}`).expect(404);
    await bcc.get(`/api/v1/communication/templates/${abbsTemplate.id}`).expect(404);
    await bcc.get(`/api/v1/communication/messages/${abbsLog.id}`).expect(404);
    const logs = (await bcc.get('/api/v1/communication/messages').expect(200)).body.data;
    expect(logs.every((l: { id: string }) => l.id !== abbsLog.id)).toBe(true);
    const providers = (await bcc.get('/api/v1/communication/providers').expect(200)).body.data;
    expect(providers).toHaveLength(0);
    // BCC cannot use ABBS' template key.
    await bcc
      .post('/api/v1/communication/messages', {
        channel: 'email',
        institutionId: (
          await prisma.institution.findFirstOrThrow({ where: { organizationId: orgIds.bcc! } })
        ).id,
        templateKey: 'test.welcome',
        recipients: [{ address: 'x@example.com' }],
      })
      .expect(400);
  });

  it('respects channel feature flags and the communication_messages limit', async () => {
    const jp = await client('admin@jp-college.test');
    const jpc = (
      await prisma.institution.findFirstOrThrow({
        where: { organizationId: orgIds['jp-college']!, code: 'JPC' },
      })
    ).id;
    // Starter plan: no SMS.
    const sms = await jp
      .post('/api/v1/communication/messages', {
        channel: 'sms',
        institutionId: jpc,
        body: 'Hi',
        recipients: [{ address: '+919876543210' }],
      })
      .expect(403);
    expect(sms.body.error.code).toBe('FEATURE_DISABLED');

    const jpOrg = orgIds['jp-college']!;
    const periodKey = periodKeyFor('communication_messages');
    await prisma.usageCounter.upsert({
      where: {
        organizationId_limitKey_periodKey: {
          organizationId: jpOrg,
          limitKey: 'communication_messages',
          periodKey,
        },
      },
      create: { organizationId: jpOrg, limitKey: 'communication_messages', periodKey, used: 4999 },
      update: { used: 4999 },
    });
    try {
      const res = await jp
        .post('/api/v1/communication/messages', {
          channel: 'email',
          institutionId: jpc,
          body: 'Hi',
          recipients: [{ address: 'a@example.com' }, { address: 'b@example.com' }],
        })
        .expect(403);
      expect(res.body.error).toMatchObject({
        code: 'LIMIT_EXCEEDED',
        details: { limitKey: 'communication_messages', requested: 2 },
      });
      await jp
        .post('/api/v1/communication/messages', {
          channel: 'email',
          institutionId: jpc,
          body: 'Hi',
          recipients: [{ address: 'a@example.com' }],
        })
        .expect(202);
    } finally {
      await prisma.usageCounter.update({
        where: {
          organizationId_limitKey_periodKey: {
            organizationId: jpOrg,
            limitKey: 'communication_messages',
            periodKey,
          },
        },
        data: { used: 0 },
      });
    }
  });

  it('requires message.send in scope and communication.manage for settings', async () => {
    const hod = await client('cse.hod@abbs.test');
    await hod
      .post('/api/v1/communication/providers', {
        channel: 'email',
        providerType: 'log',
        name: 'Nope',
      })
      .expect(403);
    const engAdmin = await client('eng.admin@abbs.test');
    await engAdmin
      .post('/api/v1/communication/messages', {
        channel: 'email',
        institutionId: (
          await prisma.institution.findFirstOrThrow({
            where: { organizationId: abbs, code: 'ABBS-COM' },
          })
        ).id,
        body: 'Hi',
        recipients: [{ address: 'a@example.com' }],
      })
      .expect(403);
  });

  it('bulk campaigns send through the queue', async () => {
    const owner = await client('owner@abbs.test');
    const campaign = (
      await owner
        .post('/api/v1/communication/campaigns', {
          name: 'Exam notice',
          channel: 'email',
          subject: 'Exams',
          body: 'Dear {{name}}, exams start Monday.',
          recipients: [
            { address: 'p1@example.com', variables: { name: 'P1' } },
            { address: 'p2@example.com', variables: { name: 'P2' } },
            { userId: userIds['cse.hod@abbs.test']! },
          ],
        })
        .expect(201)
    ).body.data;
    await drainJobs({ includeDelayed: true });
    const done = (await owner.get(`/api/v1/communication/campaigns/${campaign.id}`).expect(200))
      .body.data;
    expect(done).toMatchObject({ status: 'COMPLETED', totalRecipients: 3, sentCount: 3 });
    expect(messageOutbox.find((m) => m.to === 'p2@example.com')?.text).toContain('Dear P2');
  });
});
