import { isFeatureKey, type FeatureKey, type PlanLimits } from '@erp/shared';
import type { OrganizationSubscription, SubscriptionPlan } from '@prisma/client';
import { tryGetPrincipal } from '../authz/principal';
import { prisma } from '../db/prisma';
import { isSubscriptionActive, mergeLimits } from './resolve';

/** What an organization is licensed for right now. */
export interface License {
  organizationId: string;
  subscription: (OrganizationSubscription & { plan: SubscriptionPlan }) | null;
  active: boolean;
  /** Plan features ∪ add-ons (plan `education` ignored for COMPANY orgs); empty when inactive. */
  features: ReadonlySet<FeatureKey>;
  /** Effective limits; all 0 when the subscription is not active. */
  limits: PlanLimits;
}

const asFeatures = (value: unknown): FeatureKey[] =>
  Array.isArray(value)
    ? value.filter((v): v is FeatureKey => typeof v === 'string' && isFeatureKey(v))
    : [];
const asLimits = (value: unknown): PlanLimits =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as PlanLimits) : {};

export const LICENSE_CACHE_PREFIX = 'license:';

/**
 * Load the license of an organization. Core code: reads through the base client with an explicit
 * organization predicate, memoized per request on the principal cache.
 */
export async function loadLicense(organizationId: string): Promise<License> {
  const cache = tryGetPrincipal()?.cache;
  const cacheKey = `${LICENSE_CACHE_PREFIX}${organizationId}`;
  const cached = cache?.get(cacheKey) as License | undefined;
  if (cached) return cached;

  const [subscription, organization] = await Promise.all([
    prisma.organizationSubscription.findUnique({
      where: { organizationId },
      include: { plan: true },
    }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { kind: true } }),
  ]);
  const active = isSubscriptionActive(subscription);
  // Plans bundle `education`; a company org gets it only when explicitly licensed as an add-on.
  const planFeatures = asFeatures(subscription?.plan.features).filter(
    (f) => f !== 'education' || organization?.kind !== 'COMPANY',
  );
  const license: License = {
    organizationId,
    subscription,
    active,
    features: new Set(
      active && subscription ? [...planFeatures, ...asFeatures(subscription.addOnFeatures)] : [],
    ),
    limits:
      active && subscription
        ? mergeLimits(asLimits(subscription.plan.limits), asLimits(subscription.limitOverrides))
        : {},
  };
  cache?.set(cacheKey, license);
  return license;
}

/** Drop memoized licensing data after a mutation within the same request. */
export function invalidateLicenseCache(): void {
  const cache = tryGetPrincipal()?.cache;
  if (!cache) return;
  for (const key of [...cache.keys()]) {
    if (key.startsWith(LICENSE_CACHE_PREFIX) || key.startsWith('features:')) cache.delete(key);
  }
}

export { asFeatures, asLimits };
