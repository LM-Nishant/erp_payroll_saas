import {
  FEATURE_DEPENDENCIES,
  FEATURE_KEYS,
  FEATURES,
  LIMITS,
  type FeatureKey,
  type FeatureStateDto,
  type LimitKey,
  type PlanLimits,
  type SettingScopeType,
  type SubscriptionStatus,
} from '@erp/shared';

/*
 * Pure licensing rules (no I/O) — unit tested in resolve.test.ts.
 */

export interface SubscriptionLike {
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
}

/**
 * A subscription licenses modules while ACTIVE, PAST_DUE (grace period; billing is chased
 * separately) or in an unexpired TRIAL. CANCELLED / expired trial / no subscription → nothing.
 */
export function isSubscriptionActive(sub: SubscriptionLike | null, now = new Date()): boolean {
  if (!sub) return false;
  switch (sub.status) {
    case 'ACTIVE':
    case 'PAST_DUE':
      return true;
    case 'TRIAL':
      return sub.trialEndsAt === null || sub.trialEndsAt > now;
    case 'CANCELLED':
      return false;
  }
}

/** Plan limits with per-organization overrides merged on top (`null` = unlimited, missing = 0). */
export function mergeLimits(plan: PlanLimits, overrides: PlanLimits): PlanLimits {
  return { ...plan, ...overrides };
}

export function limitValue(limits: PlanLimits, key: LimitKey): number | null {
  if (!Object.prototype.hasOwnProperty.call(limits, key)) return 0;
  const v = limits[key];
  return v === undefined ? 0 : v;
}

/** Counter period for a limit: `total` for gauges, `YYYY-MM` (UTC) for monthly limits. */
export function periodKeyFor(key: LimitKey, now = new Date()): string {
  if (LIMITS[key].period === 'gauge') return 'total';
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Feature overrides that apply to one target, by level. */
export interface OverrideLayers {
  ORGANIZATION?: Partial<Record<FeatureKey, boolean>>;
  GROUP?: Partial<Record<FeatureKey, boolean>>;
  INSTITUTION?: Partial<Record<FeatureKey, boolean>>;
}

/**
 * Effective module state for a target:
 *   enabled = licensed AND (most specific override: institution ?? group ?? organization ?? on)
 *             AND every dependency is enabled.
 * An override can only switch a LICENSED feature off/on — never grant one the plan lacks.
 */
export function resolveFeatureStates(
  licensed: ReadonlySet<FeatureKey>,
  layers: OverrideLayers,
): FeatureStateDto[] {
  const raw = new Map<FeatureKey, { enabled: boolean; source: FeatureStateDto['source'] }>();
  for (const key of FEATURE_KEYS) {
    if (!licensed.has(key)) {
      raw.set(key, { enabled: false, source: 'license' });
      continue;
    }
    let decided: { enabled: boolean; source: FeatureStateDto['source'] } = {
      enabled: true,
      source: 'default',
    };
    for (const level of ['INSTITUTION', 'GROUP', 'ORGANIZATION'] as SettingScopeType[]) {
      const value = layers[level]?.[key];
      if (value !== undefined) {
        decided = { enabled: value, source: level };
        break;
      }
    }
    raw.set(key, decided);
  }
  const effective = new Map<FeatureKey, boolean>();
  const visiting = new Set<FeatureKey>();
  const isOn = (key: FeatureKey): boolean => {
    const cached = effective.get(key);
    if (cached !== undefined) return cached;
    if (visiting.has(key)) return false;
    visiting.add(key);
    const on = raw.get(key)!.enabled && (FEATURE_DEPENDENCIES[key] ?? []).every((dep) => isOn(dep));
    visiting.delete(key);
    effective.set(key, on);
    return on;
  };
  return FEATURE_KEYS.map((key) => {
    const r = raw.get(key)!;
    const enabled = isOn(key);
    return {
      key,
      description: FEATURES[key],
      licensed: licensed.has(key),
      enabled,
      source: r.enabled && !enabled ? 'dependency' : r.source,
      dependsOn: [...(FEATURE_DEPENDENCIES[key] ?? [])],
    };
  });
}
