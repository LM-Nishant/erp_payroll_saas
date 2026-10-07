import type { InvoiceDto, PlanDto, SubscriptionDto, LimitUsageDto } from '@erp/shared';
import type { Invoice, OrganizationSubscription, SubscriptionPlan } from '@prisma/client';
import { asFeatures, asLimits } from './license';
import { isSubscriptionActive } from './resolve';

export function toPlanDto(plan: SubscriptionPlan): PlanDto {
  return {
    id: plan.id,
    key: plan.key,
    name: plan.name,
    description: plan.description,
    status: plan.status,
    priceCents: plan.priceCents,
    currency: plan.currency,
    billingInterval: plan.billingInterval,
    trialDays: plan.trialDays,
    features: asFeatures(plan.features),
    limits: asLimits(plan.limits),
  };
}

export function toSubscriptionDto(
  sub: OrganizationSubscription & { plan: SubscriptionPlan },
  licensedFeatures: SubscriptionDto['licensedFeatures'],
  limits: LimitUsageDto[],
): SubscriptionDto {
  return {
    id: sub.id,
    organizationId: sub.organizationId,
    status: sub.status,
    active: isSubscriptionActive(sub),
    trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
    currentPeriodStart: sub.currentPeriodStart.toISOString(),
    currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
    cancelledAt: sub.cancelledAt?.toISOString() ?? null,
    plan: toPlanDto(sub.plan),
    addOnFeatures: asFeatures(sub.addOnFeatures),
    limitOverrides: asLimits(sub.limitOverrides),
    licensedFeatures,
    limits,
  };
}

function asLineItems(value: unknown): InvoiceDto['lineItems'] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is InvoiceDto['lineItems'][number] =>
      !!v &&
      typeof v === 'object' &&
      typeof (v as { description?: unknown }).description === 'string',
  );
}

export function toInvoiceDto(inv: Invoice): InvoiceDto {
  return {
    id: inv.id,
    number: inv.number,
    subscriptionId: inv.subscriptionId,
    periodStart: inv.periodStart.toISOString(),
    periodEnd: inv.periodEnd.toISOString(),
    amountCents: inv.amountCents,
    currency: inv.currency,
    status: inv.status,
    issuedAt: inv.issuedAt?.toISOString() ?? null,
    dueAt: inv.dueAt.toISOString(),
    paidAt: inv.paidAt?.toISOString() ?? null,
    paymentMethod: inv.paymentMethod,
    paymentReference: inv.paymentReference,
    notes: inv.notes,
    lineItems: asLineItems(inv.lineItems),
    subtotalCents: inv.subtotalCents,
    taxRateBps: inv.taxRateBps,
    taxCents: inv.taxCents,
    submittedReference: inv.submittedReference,
    submittedNote: inv.submittedNote,
    submittedAt: inv.submittedAt?.toISOString() ?? null,
    createdAt: inv.createdAt.toISOString(),
  };
}
