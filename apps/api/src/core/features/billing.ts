import { randomBytes } from 'node:crypto';
import {
  FEATURE_KEYS,
  type SubscriptionDto,
  type CreateInvoiceInput,
  type CreatePlanInput,
  type ListInvoicesQuery,
  type SetSubscriptionInput,
  type UpdateInvoiceInput,
  type UpdatePlanInput,
} from '@erp/shared';
import type { Prisma } from '@prisma/client';
import { audit } from '../audit';
import { prisma } from '../db/prisma';
import { NotFoundError, ValidationError } from '../http/errors';
import { toListResponse, toPageWindow } from '../http/pagination';
import { runAsPlatform } from '../platform';
import { keyProvider, rewrapOrganizationSecrets } from '../secrets';
import { currentOrganizationId } from '../tenancy/context';
import { tenantDb, withTenant } from '../tenancy/tenant-db';
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
  async listPlans() {
    const plans = await prisma.subscriptionPlan.findMany({ orderBy: { priceCents: 'asc' } });
    return plans.map(toPlanDto);
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
      prisma.invoice.findMany({ where, orderBy: { periodStart: 'desc' }, ...toPageWindow(query) }),
      prisma.invoice.count({ where }),
    ]);
    return toListResponse(rows.map(toInvoiceDto), total, query);
  },

  createInvoice(actor: PlatformActor, organizationId: string, input: CreateInvoiceInput) {
    return asPlatform(actor, organizationId, input.reason, async () => {
      const db = tenantDb();
      const sub = await db.organizationSubscription.findFirst({ include: { plan: true } });
      if (!sub) throw new ValidationError('Organization has no subscription');
      const invoice = await db.invoice.create({
        data: withTenant({
          subscriptionId: sub.id,
          number: invoiceNumber(),
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          amountCents: input.amountCents ?? sub.plan.priceCents,
          currency: input.currency ?? sub.plan.currency,
          status: 'OPEN' as const,
          issuedAt: new Date(),
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
      const after = await db.invoice.update({
        where: { id: invoiceId },
        data: {
          ...fields,
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
