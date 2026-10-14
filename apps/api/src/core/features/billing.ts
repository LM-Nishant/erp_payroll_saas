import { randomBytes } from 'node:crypto';
import {
  FEATURE_KEYS,
  type SubscriptionDto,
  type CreateInvoiceInput,
  type CreatePlanInput,
  type ListInvoicesQuery,
  type ListPlansQuery,
  type PlatformInvoiceDto,
  type PlatformInvoicesQuery,
  type SetSubscriptionInput,
  type UpdateInvoiceInput,
  type UpdatePlanInput,
} from '@erp/shared';
import type { Prisma } from '@prisma/client';
import { audit } from '../audit';
import { prisma } from '../db/prisma';
import { NotFoundError, ValidationError } from '../http/errors';
import {
  toListResponse,
  toOptionalListResponse,
  toOptionalPageWindow,
  toPageWindow,
} from '../http/pagination';
import { runAsPlatform } from '../platform';
import { keyProvider, rewrapOrganizationSecrets } from '../secrets';
import { currentOrganizationId } from '../tenancy/context';
import { tenantDb, withTenant } from '../tenancy/tenant-db';
import { resolveBranding } from '../branding';
import { getBillingSettings, invoiceTotals, renderInvoicePdf } from './invoicing';
import { invalidateLicenseCache, loadLicense } from './license';
import { getAllLimitUsage } from './limits';
import { toInvoiceDto, toPlanDto, toSubscriptionDto } from './mappers';

/** Subscription summary of an organization (no authorization — callers authorize). */
export async function subscriptionSummary(organizationId: string): Promise<SubscriptionDto | null> {
  const license = await loadLicense(organizationId);
  if (!license.subscription) return null;
  return toSubscriptionDto(
    license.subscription,
    FEATURE_KEYS.filter((k) => license.features.has(k)),
    await getAllLimitUsage({ organizationId }),
  );
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

export interface PlatformActor {
  userId: string | null;
}

/** Run tenant-scoped billing work as the platform (audited `platform.run_as`). */
const asPlatform = <T>(
  actor: PlatformActor,
  organizationId: string,
  reason: string,
  fn: () => Promise<T>,
) => runAsPlatform({ organizationId, reason, actorUserId: actor.userId }, fn);

function invoiceNumber(now = new Date()) {
  const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `INV-${ym}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * Platform-admin billing management. Plans are GLOBAL rows (audited with organizationId null);
 * everything touching an organization runs through `runAsPlatform` (reason required).
 */
export const platformBillingService = {
  async listPlans(query: ListPlansQuery = {}) {
    const [plans, total] = await prisma.$transaction([
      prisma.subscriptionPlan.findMany({
        orderBy: [{ priceCents: 'asc' }, { id: 'asc' }],
        ...toOptionalPageWindow(query),
      }),
      prisma.subscriptionPlan.count(),
    ]);
    return toOptionalListResponse(plans.map(toPlanDto), total, query);
  },

  async createPlan(input: CreatePlanInput) {
    const plan = await prisma.subscriptionPlan.create({
      data: { ...input, features: json(input.features), limits: json(input.limits) },
    });
    await audit.record({
      action: 'subscription_plan.create',
      entityType: 'subscription_plan',
      entityId: plan.id,
      organizationId: null,
      after: toPlanDto(plan),
    });
    return toPlanDto(plan);
  },

  async updatePlan(id: string, input: UpdatePlanInput) {
    const before = await prisma.subscriptionPlan.findUnique({ where: { id } });
    if (!before) throw new NotFoundError('Plan');
    const { features, limits, ...rest } = input;
    const after = await prisma.subscriptionPlan.update({
      where: { id },
      data: {
        ...rest,
        ...(features ? { features: json(features) } : {}),
        ...(limits ? { limits: json(limits) } : {}),
      },
    });
    await audit.record({
      action: 'subscription_plan.update',
      entityType: 'subscription_plan',
      entityId: id,
      organizationId: null,
      before: toPlanDto(before),
      after: toPlanDto(after),
    });
    return toPlanDto(after);
  },

  getSubscription: async (organizationId: string) => {
    const org = await prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!org) throw new NotFoundError('Organization');
    return subscriptionSummary(organizationId);
  },

  setSubscription(actor: PlatformActor, organizationId: string, input: SetSubscriptionInput) {
    return asPlatform(actor, organizationId, input.reason, async () => {
      const plan = await prisma.subscriptionPlan.findUnique({ where: { id: input.planId } });
      if (!plan) throw new ValidationError('Unknown plan', { field: 'planId' });
      const db = tenantDb();
      const before = await db.organizationSubscription.findFirst({});
      const now = new Date();
      const data = {
        planId: plan.id,
        status: input.status,
        trialEndsAt:
          input.status === 'TRIAL'
            ? (input.trialEndsAt ?? new Date(now.getTime() + plan.trialDays * 86_400_000))
            : (input.trialEndsAt ?? null),
        currentPeriodStart: input.currentPeriodStart ?? before?.currentPeriodStart ?? now,
        currentPeriodEnd: input.currentPeriodEnd ?? null,
        cancelledAt: input.status === 'CANCELLED' ? (before?.cancelledAt ?? now) : null,
        addOnFeatures: json(input.addOnFeatures),
        limitOverrides: json(input.limitOverrides),
      };
      const after = before
        ? await db.organizationSubscription.update({ where: { id: before.id }, data })
        : await db.organizationSubscription.create({ data: withTenant(data) });
      invalidateLicenseCache();
      await audit.record({
        action: before ? 'subscription.update' : 'subscription.create',
        entityType: 'organization_subscription',
        entityId: after.id,
        before,
        after,
        reason: input.reason,
      });
      return subscriptionSummary(currentOrganizationId());
    });
  },

  async listInvoices(organizationId: string, query: ListInvoicesQuery) {
    const where = { organizationId, ...(query.status ? { status: query.status } : {}) };
    const [rows, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy: [{ periodStart: 'desc' }, { id: 'desc' }],
        ...toPageWindow(query),
      }),
      prisma.invoice.count({ where }),
    ]);
    return toListResponse(rows.map(toInvoiceDto), total, query);
  },

  createInvoice(actor: PlatformActor, organizationId: string, input: CreateInvoiceInput) {
    return asPlatform(actor, organizationId, input.reason, async () => {
      const db = tenantDb();
      const sub = await db.organizationSubscription.findFirst({ include: { plan: true } });
      if (!sub) throw new ValidationError('Organization has no subscription');
      const settings = await getBillingSettings();
      const lineItems = input.lineItems ?? [
        {
          description: `${sub.plan.name} subscription`,
          quantity: 1,
          unitCents: input.amountCents ?? sub.plan.priceCents,
        },
      ];
      const taxRateBps = input.taxRateBps ?? settings.defaultTaxRateBps;
      const totals = invoiceTotals(lineItems, taxRateBps);
      const invoice = await db.invoice.create({
        data: withTenant({
          subscriptionId: sub.id,
          number: invoiceNumber(),
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          lineItems: json(lineItems),
          subtotalCents: totals.subtotalCents,
          taxRateBps,
          taxCents: totals.taxCents,
          amountCents: totals.amountCents,
          currency: input.currency ?? sub.plan.currency,
          status: input.status,
          issuedAt: input.status === 'OPEN' ? new Date() : null,
          dueAt: input.dueAt,
          notes: input.notes ?? null,
        }),
      });
      await audit.record({
        action: 'invoice.create',
        entityType: 'invoice',
        entityId: invoice.id,
        after: toInvoiceDto(invoice),
        reason: input.reason,
      });
      return toInvoiceDto(invoice);
    });
  },

  /** Record payment status changes (no gateway: manual reconciliation by platform finance). */
  updateInvoice(
    actor: PlatformActor,
    organizationId: string,
    invoiceId: string,
    input: UpdateInvoiceInput,
  ) {
    return asPlatform(actor, organizationId, input.reason, async () => {
      const db = tenantDb();
      const before = await db.invoice.findFirst({ where: { id: invoiceId } });
      if (!before) throw new NotFoundError('Invoice');
      const { reason, ...fields } = input;
      if (before.status === 'VOID' && fields.status !== 'VOID')
        throw new ValidationError('A void invoice cannot be reopened');
      const paid = fields.status === 'PAID';
      const after = await db.invoice.update({
        where: { id: invoiceId },
        data: {
          ...fields,
          issuedAt: before.issuedAt ?? (fields.status !== 'DRAFT' ? new Date() : null),
          // Verified UPI payment: default method/reference from the organization's submission.
          paymentMethod: paid
            ? (fields.paymentMethod ??
              before.paymentMethod ??
              (before.submittedReference ? 'UPI' : null))
            : fields.paymentMethod,
          paymentReference: paid
            ? (fields.paymentReference ?? before.paymentReference ?? before.submittedReference)
            : fields.paymentReference,
          paidAt:
            fields.status === 'PAID'
              ? (fields.paidAt ?? before.paidAt ?? new Date())
              : (fields.paidAt ?? null),
        },
      });
      await audit.record({
        action: 'invoice.update',
        entityType: 'invoice',
        entityId: invoiceId,
        before: toInvoiceDto(before),
        after: toInvoiceDto(after),
        reason,
      });
      return toInvoiceDto(after);
    });
  },

  /** All invoices across organizations (platform finance view). */
  async listAllInvoices(query: PlatformInvoicesQuery) {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      organization: { deletedAt: null },
    };
    const [rows, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: { organization: { select: { id: true, name: true, slug: true } } },
        orderBy: [{ createdAt: 'desc' }],
        ...toPageWindow(query),
      }),
      prisma.invoice.count({ where }),
    ]);
    return toListResponse(
      rows.map((r): PlatformInvoiceDto => ({ ...toInvoiceDto(r), organization: r.organization })),
      total,
      query,
    );
  },

  async invoicePdf(organizationId: string, invoiceId: string) {
    const inv = await prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: { subscription: { include: { plan: true } } },
    });
    if (!inv) throw new NotFoundError('Invoice');
    return { number: inv.number, pdf: await invoicePdfFor(organizationId, inv) };
  },

  /** Master key rotation: re-wrap every organization's data keys to the active key version. */
  async rewrapAllSecrets(actor: PlatformActor, reason: string) {
    const orgs = await prisma.organization.findMany({
      where: { deletedAt: null, secrets: { some: {} } },
      select: { id: true },
    });
    const results: Array<{ organizationId: string; rewrapped: number; total: number }> = [];
    for (const org of orgs) {
      const r = await asPlatform(actor, org.id, reason, () => rewrapOrganizationSecrets());
      results.push({ organizationId: org.id, ...r });
    }
    return {
      activeKeyVersion: keyProvider().activeVersion,
      rewrapped: results.reduce((n, r) => n + r.rewrapped, 0),
      organizations: results,
    };
  },
};

/** Invoice PDF with the organization (org-level branding contact details) as the buyer. */
export async function invoicePdfFor(
  organizationId: string,
  inv: Parameters<typeof toInvoiceDto>[0] & { subscription?: { plan: { name: string } } | null },
) {
  const buyer = await resolveBranding(organizationId, {
    scopeType: 'ORGANIZATION',
    targetId: organizationId,
    groupId: null,
    institutionId: null,
  });
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });
  return renderInvoicePdf(
    toInvoiceDto(inv),
    {
      name: buyer.displayName || org?.name || 'Customer',
      address: buyer.address,
      email: buyer.contactEmail,
    },
    inv.subscription?.plan.name ?? null,
  );
}
