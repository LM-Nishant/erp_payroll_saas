import { z } from 'zod';
import {
  FEATURE_KEYS,
  INVOICE_STATUSES,
  SETTING_SCOPE_TYPES,
  SUBSCRIPTION_STATUSES,
  type FeatureKey,
} from '../licensing/features';
import { idSchema, nameSchema, paginationQuerySchema } from './common';

/*
 * Subscription / module licensing request schemas. All `.strict()` (unknown keys → 400).
 */

export const featureKeySchema = z.enum(FEATURE_KEYS as [FeatureKey, ...FeatureKey[]]);
export const settingScopeTypeSchema = z.enum(SETTING_SCOPE_TYPES);

const limitValue = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional();

/** Plan limits; `null` = unlimited, omitted = 0. */
export const planLimitsSchema = z
  .object({
    institutions: limitValue,
    students: limitValue,
    employees: limitValue,
    storage_bytes: limitValue,
    ai_tokens: limitValue,
    communication_messages: limitValue,
  })
  .strict();

const reasonSchema = z.string().trim().min(10).max(500);
const currencySchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, 'ISO 4217 currency code');

export const planStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export const billingIntervalSchema = z.enum(['MONTHLY', 'YEARLY']);

export const createPlanSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,63}$/, 'Key must be lower snake_case'),
    name: nameSchema,
    description: z.string().trim().max(1000).nullish(),
    status: planStatusSchema.default('ACTIVE'),
    priceCents: z.number().int().min(0).default(0),
    currency: currencySchema.default('INR'),
    billingInterval: billingIntervalSchema.default('MONTHLY'),
    trialDays: z.number().int().min(0).max(365).default(14),
    features: z.array(featureKeySchema).max(100).default([]),
    limits: planLimitsSchema.default({}),
  })
  .strict();
export const updatePlanSchema = createPlanSchema.omit({ key: true }).partial().strict();
export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

export const subscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);

/** Platform: assign / change an organization's subscription. */
export const setSubscriptionSchema = z
  .object({
    planId: idSchema,
    status: subscriptionStatusSchema,
    /** Defaults to now + plan.trialDays for TRIAL. */
    trialEndsAt: z.coerce.date().nullish(),
    currentPeriodStart: z.coerce.date().optional(),
    currentPeriodEnd: z.coerce.date().nullish(),
    /** Extra modules licensed on top of the plan (add-ons). */
    addOnFeatures: z.array(featureKeySchema).max(100).default([]),
    /** Per-organization limit overrides (negotiated deals); merged over the plan limits. */
    limitOverrides: planLimitsSchema.default({}),
    reason: reasonSchema,
  })
  .strict();
export type SetSubscriptionInput = z.infer<typeof setSubscriptionSchema>;

export const invoiceStatusSchema = z.enum(INVOICE_STATUSES);

export const createInvoiceSchema = z
  .object({
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
    dueAt: z.coerce.date(),
    /** Defaults to the plan price. */
    amountCents: z.number().int().min(0).optional(),
    currency: currencySchema.optional(),
    notes: z.string().trim().max(1000).nullish(),
    reason: reasonSchema,
  })
  .strict()
  .refine((v) => v.periodEnd > v.periodStart, {
    path: ['periodEnd'],
    message: 'periodEnd must be after periodStart',
  });
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const updateInvoiceSchema = z
  .object({
    status: invoiceStatusSchema,
    paidAt: z.coerce.date().nullish(),
    paymentMethod: z.string().trim().max(64).nullish(),
    paymentReference: z.string().trim().max(128).nullish(),
    notes: z.string().trim().max(1000).nullish(),
    reason: reasonSchema,
  })
  .strict();
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;

export const listInvoicesQuerySchema = paginationQuerySchema
  .omit({ search: true })
  .extend({ status: invoiceStatusSchema.optional() })
  .strict();
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;

export const platformReasonSchema = z.object({ reason: reasonSchema }).strict();

/** ORGANIZATION targets have no id; GROUP / INSTITUTION targets require one. */
export const refineSettingTarget = (
  v: { scopeType: (typeof SETTING_SCOPE_TYPES)[number]; targetId?: string | undefined },
  ctx: z.RefinementCtx,
) => {
  if (v.scopeType === 'ORGANIZATION' && v.targetId) {
    ctx.addIssue({ code: 'custom', path: ['targetId'], message: 'Not allowed for ORGANIZATION' });
  }
  if (v.scopeType !== 'ORGANIZATION' && !v.targetId) {
    ctx.addIssue({ code: 'custom', path: ['targetId'], message: 'Required' });
  }
};

export const setFeatureOverrideSchema = z
  .object({
    scopeType: settingScopeTypeSchema,
    targetId: idSchema.optional(),
    featureKey: featureKeySchema,
    enabled: z.boolean(),
  })
  .strict()
  .superRefine(refineSettingTarget);
export type SetFeatureOverrideInput = z.infer<typeof setFeatureOverrideSchema>;

export const effectiveFeaturesQuerySchema = z
  .object({ groupId: idSchema.optional(), institutionId: idSchema.optional() })
  .strict();
export type EffectiveFeaturesQuery = z.infer<typeof effectiveFeaturesQuerySchema>;
