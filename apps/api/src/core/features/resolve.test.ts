import { describe, expect, it } from 'vitest';
import type { FeatureKey } from '@erp/shared';
import {
  isSubscriptionActive,
  limitValue,
  mergeLimits,
  periodKeyFor,
  resolveFeatureStates,
} from './resolve';

const state = (licensed: FeatureKey[], layers: Parameters<typeof resolveFeatureStates>[1]) =>
  Object.fromEntries(
    resolveFeatureStates(new Set(licensed), layers).map((s) => [s.key, s]),
  ) as Record<FeatureKey, ReturnType<typeof resolveFeatureStates>[number]>;

describe('feature resolution', () => {
  it('only licensed features are enabled; default on', () => {
    const s = state(['education', 'hr'], {});
    expect(s.education).toMatchObject({ enabled: true, source: 'default', licensed: true });
    expect(s.payroll).toMatchObject({ enabled: false, source: 'license', licensed: false });
  });

  it('most specific override wins', () => {
    const s = state(['education', 'hr', 'library'], {
      ORGANIZATION: { library: false, hr: false },
      GROUP: { library: true },
      INSTITUTION: { hr: true },
    });
    expect(s.library).toMatchObject({ enabled: true, source: 'GROUP' });
    expect(s.hr).toMatchObject({ enabled: true, source: 'INSTITUTION' });
  });

  it('an institution override cannot exceed the plan', () => {
    const s = state(['education'], { INSTITUTION: { payroll: true }, ORGANIZATION: { ai: true } });
    expect(s.payroll).toMatchObject({ enabled: false, source: 'license' });
    expect(s.ai.enabled).toBe(false);
  });

  it('applies dependencies (payroll requires hr)', () => {
    const s = state(['hr', 'payroll'], { ORGANIZATION: { hr: false } });
    expect(s.payroll).toMatchObject({ enabled: false, source: 'dependency' });
  });
});

describe('subscription + limits', () => {
  const now = new Date('2026-05-10T12:00:00Z');
  it('treats active, past-due and running trials as licensed', () => {
    expect(isSubscriptionActive(null, now)).toBe(false);
    expect(isSubscriptionActive({ status: 'ACTIVE', trialEndsAt: null }, now)).toBe(true);
    expect(isSubscriptionActive({ status: 'PAST_DUE', trialEndsAt: null }, now)).toBe(true);
    expect(isSubscriptionActive({ status: 'CANCELLED', trialEndsAt: null }, now)).toBe(false);
    expect(
      isSubscriptionActive({ status: 'TRIAL', trialEndsAt: new Date('2026-05-11') }, now),
    ).toBe(true);
    expect(
      isSubscriptionActive({ status: 'TRIAL', trialEndsAt: new Date('2026-05-01') }, now),
    ).toBe(false);
  });

  it('merges overrides; missing = 0, null = unlimited', () => {
    const merged = mergeLimits({ institutions: 1, employees: 50 }, { employees: null });
    expect(limitValue(merged, 'institutions')).toBe(1);
    expect(limitValue(merged, 'employees')).toBeNull();
    expect(limitValue(merged, 'students')).toBe(0);
  });

  it('uses monthly period keys for metered limits', () => {
    expect(periodKeyFor('institutions', now)).toBe('total');
    expect(periodKeyFor('ai_tokens', now)).toBe('2026-05');
  });
});
