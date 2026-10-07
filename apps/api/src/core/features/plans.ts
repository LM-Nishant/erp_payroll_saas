import type { FeatureKey, PlanLimits } from '@erp/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';

export interface DefaultPlan {
  key: string;
  name: string;
  description: string;
  priceCents: number;
  trialDays: number;
  features: FeatureKey[];
  limits: PlanLimits;
}

const STARTER_FEATURES: FeatureKey[] = ['education', 'documents', 'communication', 'email'];
const PROFESSIONAL_FEATURES: FeatureKey[] = [
  ...STARTER_FEATURES,
  'hr',
  'payroll',
  'assets',
  'library',
  'transport',
  'hostel',
  'finance',
  'sms',
  'ai',
];

/** Example plans from SPEC §63. Created once; platform admins edit them afterwards. */
export const DEFAULT_PLANS: readonly DefaultPlan[] = [
  {
    key: 'starter',
    name: 'Starter',
    description: 'Single institution with core academics and email',
    priceCents: 0,
    trialDays: 30,
    features: STARTER_FEATURES,
    limits: {
      institutions: 1,
      students: 1_000,
      employees: 100,
      storage_bytes: 5 * 1024 ** 3,
      ai_tokens: 0,
      communication_messages: 5_000,
    },
  },
  {
    key: 'professional',
    name: 'Professional',
    description: 'Multi-institution groups with HR, payroll, SMS and AI',
    priceCents: 4_999_00,
    trialDays: 14,
    features: PROFESSIONAL_FEATURES,
    limits: {
      institutions: 10,
      students: 20_000,
      employees: 2_000,
      storage_bytes: 100 * 1024 ** 3,
      ai_tokens: 2_000_000,
      communication_messages: 100_000,
    },
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    description: 'Unlimited institutions and every module',
    priceCents: 19_999_00,
    trialDays: 14,
    features: [...PROFESSIONAL_FEATURES, 'whatsapp'],
    limits: {
      institutions: null,
      students: null,
      employees: null,
      storage_bytes: null,
      ai_tokens: null,
      communication_messages: null,
    },
  },
];

/** Create missing default plans (never overwrites platform edits). Idempotent. */
export async function syncPlanCatalog(): Promise<void> {
  for (const plan of DEFAULT_PLANS) {
    await prisma.subscriptionPlan.upsert({
      where: { key: plan.key },
      create: {
        ...plan,
        features: plan.features as Prisma.InputJsonValue,
        limits: plan.limits as Prisma.InputJsonValue,
      },
      update: {},
    });
  }
}

/**
 * Give an organization a subscription if it has none (seeds / org onboarding). Existing
 * subscriptions are left untouched. Core/system code — no principal required.
 */
export async function provisionOrganizationSubscription(
  organizationId: string,
  planKey: string,
  status: 'TRIAL' | 'ACTIVE' = 'ACTIVE',
): Promise<void> {
  const plan = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { key: planKey } });
  await prisma.organizationSubscription.upsert({
    where: { organizationId },
    create: {
      organizationId,
      planId: plan.id,
      status,
      trialEndsAt: status === 'TRIAL' ? new Date(Date.now() + plan.trialDays * 86_400_000) : null,
      addOnFeatures: [],
      limitOverrides: {},
    },
    update: {},
  });
}
