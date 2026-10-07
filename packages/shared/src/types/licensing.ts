import type {
  FeatureKey,
  InvoiceStatus,
  LimitKey,
  PlanLimits,
  SettingScopeType,
  SubscriptionStatus,
} from '../licensing/features';

export interface PlanDto {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  priceCents: number;
  currency: string;
  billingInterval: 'MONTHLY' | 'YEARLY';
  trialDays: number;
  features: FeatureKey[];
  limits: PlanLimits;
}

export interface LimitUsageDto {
  key: LimitKey;
  period: 'gauge' | 'monthly';
  /** `null` = unlimited. */
  limit: number | null;
  used: number;
}

export interface SubscriptionDto {
  id: string;
  organizationId: string;
  status: SubscriptionStatus;
  /** True when the subscription currently licenses modules (see docs/ARCHITECTURE.md §6.1). */
  active: boolean;
  trialEndsAt: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string | null;
  cancelledAt: string | null;
  plan: PlanDto;
  addOnFeatures: FeatureKey[];
  limitOverrides: PlanLimits;
  /** Plan features ∪ add-ons (empty when the subscription is not active). */
  licensedFeatures: FeatureKey[];
  limits: LimitUsageDto[];
}

export interface InvoiceDto {
  id: string;
  number: string;
  subscriptionId: string;
  periodStart: string;
  periodEnd: string;
  amountCents: number;
  currency: string;
  status: InvoiceStatus;
  issuedAt: string | null;
  dueAt: string;
  paidAt: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  notes: string | null;
  createdAt: string;
}

export interface FeatureOverrideDto {
  id: string;
  scopeType: SettingScopeType;
  targetId: string;
  featureKey: FeatureKey;
  enabled: boolean;
  updatedAt: string;
}

export interface FeatureStateDto {
  key: FeatureKey;
  description: string;
  licensed: boolean;
  enabled: boolean;
  /** Where the decision came from. */
  source: 'license' | 'dependency' | SettingScopeType | 'default';
  dependsOn: FeatureKey[];
}

export interface FeaturesOverviewDto {
  licensedFeatures: FeatureKey[];
  /** Enabled at the organization level (before group / institution overrides). */
  features: FeatureStateDto[];
  overrides: FeatureOverrideDto[];
}

export interface EffectiveFeaturesDto {
  target: { scopeType: SettingScopeType; id: string };
  features: FeatureStateDto[];
}

export const BRANDING_FIELDS = [
  'displayName',
  'shortName',
  'logoStorageKey',
  'logoFileId',
  'primaryColor',
  'secondaryColor',
  'accentColor',
  'letterheadText',
  'footerText',
  'address',
  'contactEmail',
  'contactPhone',
  'website',
  'customDomain',
  'subdomain',
] as const;
export type BrandingField = (typeof BRANDING_FIELDS)[number];

export type BrandingValues = Record<BrandingField, string | null>;

export interface BrandingProfileDto extends BrandingValues {
  id: string | null;
  scopeType: SettingScopeType;
  targetId: string;
  updatedAt: string | null;
}

export interface ResolvedBrandingDto extends BrandingValues {
  target: { scopeType: SettingScopeType; id: string };
  /** Which level each value came from (`PLATFORM` = built-in default). */
  sources: Record<BrandingField, SettingScopeType | 'PLATFORM' | null>;
}

/** Masked secret metadata. The secret value itself is NEVER part of any response. */
export interface SecretDto {
  id: string;
  scopeType: SettingScopeType;
  targetId: string;
  kind: string;
  name: string;
  description: string | null;
  metadata: Record<string, string | number | boolean> | null;
  /** e.g. `••••••••abcd` (last 4 only for values ≥ 12 chars). */
  masked: string;
  fingerprint: string;
  version: number;
  keyVersion: number;
  createdAt: string;
  updatedAt: string;
  rotatedAt: string | null;
  createdBy: { id: string; name: string } | null;
}
