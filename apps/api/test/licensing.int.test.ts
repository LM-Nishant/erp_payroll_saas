import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/core/db/prisma';
import {
  DEMO_PASSWORD,
  TEST_AUTH_RATE_LIMIT,
  asTenant,
  hasTestDatabase,
  seedAccessFixture,
  signIn,
} from './helpers';

const REASON = 'Billing ticket #881: plan change for test';

describe.skipIf(!hasTestDatabase)('module licensing + subscriptions', () => {
  const app = createApp({ authRateLimit: TEST_AUTH_RATE_LIMIT });
  let orgIds: Record<string, string>;

  beforeAll(async () => {
    ({ orgIds } = await seedAccessFixture());
  });
  afterAll(() => prisma.$disconnect());

  it('exposes the plan, limits and enabled features', async () => {
    const owner = await signIn(app, 'owner@abbs.test', DEMO_PASSWORD);
    const sub = (await owner.get('/api/v1/subscription').expect(200)).body.data;
    expect(sub.plan.key).toBe('enterprise');
    expect(sub.status).toBe('ACTIVE');
    const institutions = sub.limits.find((l: { key: string }) => l.key === 'institutions');
    expect(institutions).toMatchObject({ used: 4, limit: null });

    const me = (await owner.get('/api/v1/me').expect(200)).body.data;
    expect(me.features).toEqual(expect.arrayContaining(['education', 'hr', 'payroll', 'whatsapp']));

    const jp = await signIn(app, 'admin@jp-college.test', DEMO_PASSWORD);
    const jpMe = (await jp.get('/api/v1/me').expect(200)).body.data;
    expect(jpMe.features).toContain('education');
    expect(jpMe.features).not.toContain('payroll');
    // institution_owner has no subscription.view
    await jp.get('/api/v1/subscription').expect(403);
  });

  it('blocks disabled module routes with 403 FEATURE_DISABLED', async () => {
    const owner = await signIn(app, 'owner@abbs.test', DEMO_PASSWORD);
    await owner.get('/api/v1/programs').expect(200);
    const override = (
      await owner
        .put('/api/v1/features/overrides', {
          scopeType: 'ORGANIZATION',
          featureKey: 'education',
          enabled: false,
        })
        .expect(200)
    ).body.data;
    try {
      const res = await owner.get('/api/v1/programs').expect(403);
      expect(res.body.error).toMatchObject({
        code: 'FEATURE_DISABLED',
        details: { feature: 'education' },
      });
      await owner.get('/api/v1/class-sections').expect(403);
      const me = (await owner.get('/api/v1/me').expect(200)).body.data;
      expect(me.features).not.toContain('education');
    } finally {
      await owner.delete(`/api/v1/features/overrides/${override.id}`).expect(204);
    }
    await owner.get('/api/v1/programs').expect(200);
    const logs = await prisma.auditLog.findMany({
      where: { organizationId: orgIds.abbs, entityId: override.id },
    });
    expect(logs.map((l) => l.action).sort()).toEqual([
      'feature_override.create',
      'feature_override.delete',
    ]);
  });

  it('disables modules when the platform downgrades the plan', async () => {
    const platform = await signIn(app, 'platform@erp.test', DEMO_PASSWORD);
    const plans = (await platform.get('/api/v1/platform/plans').expect(200)).body.data;
    const starter = plans.find((p: { key: string }) => p.key === 'starter');
    const professional = plans.find((p: { key: string }) => p.key === 'professional');
    const bccAdmin = await signIn(app, 'admin@bcc.test', DEMO_PASSWORD);
    expect((await bccAdmin.get('/api/v1/me')).body.data.features).toContain('hr');

    await platform
      .put(`/api/v1/platform/organizations/${orgIds.bcc}/subscription`, {
        planId: starter.id,
        status: 'ACTIVE',
        reason: REASON,
      })
      .expect(200);
    try {
      expect((await bccAdmin.get('/api/v1/me')).body.data.features).not.toContain('hr');
      // Cancelled → nothing is licensed.
      await platform
        .put(`/api/v1/platform/organizations/${orgIds.bcc}/subscription`, {
          planId: starter.id,
          status: 'CANCELLED',
          reason: REASON,
        })
        .expect(200);
      const res = await bccAdmin.get('/api/v1/programs').expect(403);
      expect(res.body.error.code).toBe('FEATURE_DISABLED');
    } finally {
      await platform
        .put(`/api/v1/platform/organizations/${orgIds.bcc}/subscription`, {
          planId: professional.id,
          status: 'ACTIVE',
          reason: REASON,
        })
        .expect(200);
    }
    await bccAdmin.get('/api/v1/programs').expect(200);
    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: orgIds.bcc, action: 'subscription.update' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toMatchObject({ actorType: 'platform', reason: REASON });
    // Tenant users cannot change plans.
    await bccAdmin.get('/api/v1/platform/plans').expect(403);
  });

  it('an institution override cannot exceed the plan', async () => {
    const bccAdmin = await signIn(app, 'admin@bcc.test', DEMO_PASSWORD);
    const inst = (await bccAdmin.get('/api/v1/institutions').expect(200)).body.data[0];
    const res = await bccAdmin
      .put('/api/v1/features/overrides', {
        scopeType: 'INSTITUTION',
        targetId: inst.id,
        featureKey: 'whatsapp',
        enabled: true,
      })
      .expect(422);
    expect(res.body.error.code).toBe('FEATURE_NOT_LICENSED');

    // Switching a licensed module off for one institution only.
    const off = (
      await bccAdmin
        .put('/api/v1/features/overrides', {
          scopeType: 'INSTITUTION',
          targetId: inst.id,
          featureKey: 'hr',
          enabled: false,
        })
        .expect(200)
    ).body.data;
    try {
      const eff = (
        await bccAdmin.get(`/api/v1/features/effective?institutionId=${inst.id}`).expect(200)
      ).body.data;
      const state = (k: string) => eff.features.find((f: { key: string }) => f.key === k);
      expect(state('hr')).toMatchObject({ enabled: false, source: 'INSTITUTION' });
      expect(state('payroll')).toMatchObject({ enabled: false, source: 'dependency' });
      expect(state('whatsapp')).toMatchObject({ enabled: false, licensed: false });
      const org = (await bccAdmin.get('/api/v1/features').expect(200)).body.data;
      expect(org.features.find((f: { key: string }) => f.key === 'hr').enabled).toBe(true);
    } finally {
      await bccAdmin.delete(`/api/v1/features/overrides/${off.id}`).expect(204);
    }
  });

  it('a group admin cannot set organization-wide overrides', async () => {
    const bccAdmin = await signIn(app, 'admin@bcc.test', DEMO_PASSWORD);
    await bccAdmin
      .put('/api/v1/features/overrides', {
        scopeType: 'ORGANIZATION',
        featureKey: 'library',
        enabled: false,
      })
      .expect(403);
  });

  it('enforces plan limits (starter: 1 institution)', async () => {
    const jp = asTenant(app, 'jp-college');
    const res = await jp
      .post('/api/v1/institutions', { name: 'JP Second Campus College', code: 'JP2' })
      .expect(403);
    expect(res.body.error).toMatchObject({
      code: 'LIMIT_EXCEEDED',
      details: { limitKey: 'institutions', limit: 1, used: 1, requested: 1 },
    });
    expect(
      await prisma.institution.count({ where: { organizationId: orgIds['jp-college'] } }),
    ).toBe(1);
    const counter = await prisma.usageCounter.findFirst({
      where: { organizationId: orgIds['jp-college'], limitKey: 'institutions' },
    });
    expect(Number(counter!.used)).toBe(1);
  });

  it('platform limit overrides raise the limit; create + delete keep usage in sync', async () => {
    const platform = await signIn(app, 'platform@erp.test', DEMO_PASSWORD);
    const sub = (
      await platform
        .get(`/api/v1/platform/organizations/${orgIds['jp-college']}/subscription`)
        .expect(200)
    ).body.data;
    await platform
      .put(`/api/v1/platform/organizations/${orgIds['jp-college']}/subscription`, {
        planId: sub.plan.id,
        status: 'ACTIVE',
        limitOverrides: { institutions: 2 },
        reason: REASON,
      })
      .expect(200);
    const jp = asTenant(app, 'jp-college');
    try {
      const inst = (
        await jp
          .post('/api/v1/institutions', { name: 'JP Second Campus College', code: 'JP2' })
          .expect(201)
      ).body.data;
      await jp
        .post('/api/v1/institutions', { name: 'JP Third Campus College', code: 'JP3' })
        .expect(403);
      await jp.delete(`/api/v1/institutions/${inst.id}`).expect(204);
      const counter = await prisma.usageCounter.findFirst({
        where: { organizationId: orgIds['jp-college'], limitKey: 'institutions' },
      });
      expect(Number(counter!.used)).toBe(1);
    } finally {
      await platform
        .put(`/api/v1/platform/organizations/${orgIds['jp-college']}/subscription`, {
          planId: sub.plan.id,
          status: 'ACTIVE',
          reason: REASON,
        })
        .expect(200);
    }
  });

  it('platform admins manage invoices; finance can read them', async () => {
    const platform = await signIn(app, 'platform@erp.test', DEMO_PASSWORD);
    const invoice = (
      await platform
        .post(`/api/v1/platform/organizations/${orgIds.abbs}/invoices`, {
          periodStart: '2026-01-01',
          periodEnd: '2026-02-01',
          dueAt: '2026-02-10',
          reason: REASON,
        })
        .expect(201)
    ).body.data;
    expect(invoice).toMatchObject({ status: 'OPEN' });
    expect(invoice.amountCents).toBeGreaterThan(0);
    const paid = (
      await platform
        .patch(`/api/v1/platform/organizations/${orgIds.abbs}/invoices/${invoice.id}`, {
          status: 'PAID',
          paymentReference: 'NEFT-123',
          reason: REASON,
        })
        .expect(200)
    ).body.data;
    expect(paid.status).toBe('PAID');
    expect(paid.paidAt).toBeTruthy();

    const owner = await signIn(app, 'owner@abbs.test', DEMO_PASSWORD);
    const list = (await owner.get('/api/v1/subscription/invoices').expect(200)).body;
    expect(list.data.map((i: { id: string }) => i.id)).toContain(invoice.id);
    // Group admin (no billing.view) → 403; BCC never sees ABBS invoices.
    const bccAdmin = await signIn(app, 'admin@bcc.test', DEMO_PASSWORD);
    await bccAdmin.get('/api/v1/subscription/invoices').expect(403);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: orgIds.abbs, entityId: invoice.id },
      }),
    ).toBeGreaterThanOrEqual(2);
  });

  it('UPI billing: GST line items, PDF, UTR submission and platform verification', async () => {
    const platform = await signIn(app, 'platform@erp.test', DEMO_PASSWORD);
    // Without a UPI ID, payment instructions are unavailable.
    await platform
      .put('/api/v1/platform/billing-settings', {
        sellerName: 'ERP Cloud Pvt Ltd',
        gstin: '29ABCDE1234F1Z5',
        upiId: '',
        defaultTaxRateBps: 1800,
      })
      .expect(200);
    const invoice = (
      await platform
        .post(`/api/v1/platform/organizations/${orgIds.abbs}/invoices`, {
          periodStart: '2026-03-01',
          periodEnd: '2026-03-31',
          dueAt: '2026-04-10',
          lineItems: [
            { description: 'Enterprise plan', quantity: 1, unitCents: 1_000_000 },
            { description: 'Extra SMS pack', quantity: 2, unitCents: 50_050 },
          ],
          reason: REASON,
        })
        .expect(201)
    ).body.data;
    expect(invoice).toMatchObject({
      status: 'OPEN',
      subtotalCents: 1_100_100,
      taxRateBps: 1800,
      taxCents: 198_018,
      amountCents: 1_298_118,
    });
    expect(invoice.lineItems).toHaveLength(2);

    const owner = await signIn(app, 'owner@abbs.test', DEMO_PASSWORD);
    const noUpi = await owner.get(`/api/v1/subscription/invoices/${invoice.id}/upi`).expect(400);
    expect(noUpi.body.error.message).toMatch(/not configured/);

    await platform
      .put('/api/v1/platform/billing-settings', {
        sellerName: 'ERP Cloud Pvt Ltd',
        upiId: 'erpcloud@okhdfcbank',
        upiPayeeName: 'ERP Cloud',
        defaultTaxRateBps: 1800,
      })
      .expect(200);
    const upi = (await owner.get(`/api/v1/subscription/invoices/${invoice.id}/upi`).expect(200))
      .body.data;
    expect(upi.upiUri).toContain('upi://pay?pa=erpcloud%40okhdfcbank');
    expect(upi.upiUri).toContain('am=12981.18');
    expect(upi.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    const pdf = await owner.get(`/api/v1/subscription/invoices/${invoice.id}/pdf`).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');

    // Other tenants cannot see it; users without billing permissions cannot pay.
    const bccAdmin = await signIn(app, 'admin@bcc.test', DEMO_PASSWORD);
    await bccAdmin
      .post(`/api/v1/subscription/invoices/${invoice.id}/payment`, { reference: 'UTR123456789' })
      .expect(403);
    const groupAdmin = await signIn(app, 'group.admin@abbs.test', DEMO_PASSWORD);
    await groupAdmin
      .post(`/api/v1/subscription/invoices/${invoice.id}/payment`, { reference: 'UTR123456789' })
      .expect(403);

    const submitted = (
      await owner
        .post(`/api/v1/subscription/invoices/${invoice.id}/payment`, {
          reference: 'utr123456789',
          note: 'Paid from HDFC',
        })
        .expect(200)
    ).body.data;
    expect(submitted).toMatchObject({
      status: 'PAYMENT_SUBMITTED',
      submittedReference: 'UTR123456789',
    });
    // Cannot submit twice.
    await owner
      .post(`/api/v1/subscription/invoices/${invoice.id}/payment`, { reference: 'UTR999999999' })
      .expect(409);

    const queue = (
      await platform.get('/api/v1/platform/invoices?status=PAYMENT_SUBMITTED').expect(200)
    ).body.data;
    const row = queue.find((i: { id: string }) => i.id === invoice.id);
    expect(row.organization.id).toBe(orgIds.abbs);

    const paid = (
      await platform
        .patch(`/api/v1/platform/organizations/${orgIds.abbs}/invoices/${invoice.id}`, {
          status: 'PAID',
          reason: 'UPI payment verified in bank statement',
        })
        .expect(200)
    ).body.data;
    expect(paid).toMatchObject({
      status: 'PAID',
      paymentMethod: 'UPI',
      paymentReference: 'UTR123456789',
    });
    await owner.get(`/api/v1/subscription/invoices/${invoice.id}/upi`).expect(400);
    const platformPdf = await platform
      .get(`/api/v1/platform/organizations/${orgIds.abbs}/invoices/${invoice.id}/pdf`)
      .expect(200);
    expect(platformPdf.headers['content-type']).toContain('application/pdf');
    expect(
      await prisma.auditLog.count({
        where: { entityId: invoice.id, action: 'invoice.payment_submitted' },
      }),
    ).toBe(1);
  });

  it('hides draft invoices from the organization', async () => {
    const platform = await signIn(app, 'platform@erp.test', DEMO_PASSWORD);
    const draft = (
      await platform
        .post(`/api/v1/platform/organizations/${orgIds.abbs}/invoices`, {
          periodStart: '2026-05-01',
          periodEnd: '2026-05-31',
          dueAt: '2026-06-10',
          status: 'DRAFT',
          reason: REASON,
        })
        .expect(201)
    ).body.data;
    expect(draft.issuedAt).toBeNull();
    const owner = await signIn(app, 'owner@abbs.test', DEMO_PASSWORD);
    const list = (await owner.get('/api/v1/subscription/invoices').expect(200)).body.data;
    expect(list.map((i: { id: string }) => i.id)).not.toContain(draft.id);
    await owner.get(`/api/v1/subscription/invoices/${draft.id}/pdf`).expect(404);
  });
});
