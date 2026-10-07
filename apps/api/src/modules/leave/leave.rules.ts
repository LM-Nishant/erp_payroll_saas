import type {
  EffectiveLeaveRulesDto,
  LeaveNoticeTier,
  LeaveRuleViolationDto,
  SandwichMode,
} from '@erp/shared';

/*
 * Leave policy rules (pure — no database). A policy rule (policy × leave type) may override the
 * leave type's application rules; null = inherit. Leave types only carry a sandwich default
 * (`sandwichRule` true → BOTH); every other rule defaults to "no restriction".
 */

type Num = number | { toString(): string } | null | undefined;
const numOrNull = (v: Num) => (v == null ? null : Number(v));

/** Policy-rule columns relevant to application rules (Prisma row or DTO). */
export interface RuleOverrides {
  sandwichMode: string | null;
  sandwichMinDays: Num;
  sandwichAdjacent: boolean | null;
  minNoticeDays: number | null;
  noticeTiers: unknown;
  maxAdvanceDays: number | null;
  allowBackdated: boolean | null;
  backdatedMaxDays: number | null;
  minDaysPerRequest: Num;
  maxConsecutiveDays: Num;
  maxRequestsPerMonth: number | null;
  maxDaysPerMonth: Num;
  notClubbableWith: unknown;
}

export type EffectiveLeaveRules = Omit<EffectiveLeaveRulesDto, 'hints'>;

interface PolicyScope {
  groupId: string | null;
  institutionId: string | null;
  employmentType: string | null;
}

/**
 * Most specific ACTIVE policy for the employee's coordinates:
 * institution+type (5) > institution (4) > group+type (3) > group (2) > org+type (1) > org (0).
 */
export function pickPolicy<P extends PolicyScope>(
  policies: P[],
  coords: { groupId?: string | null; institutionId: string; employmentType: string | null },
): P | null {
  const rank = (p: P) => {
    if (p.institutionId && p.institutionId !== coords.institutionId) return -1;
    if (!p.institutionId && p.groupId && p.groupId !== coords.groupId) return -1;
    if (p.employmentType && p.employmentType !== coords.employmentType) return -1;
    const level = p.institutionId ? 4 : p.groupId ? 2 : 0;
    return level + (p.employmentType ? 1 : 0);
  };
  let best: P | null = null;
  let bestRank = -1;
  for (const p of policies) {
    const r = rank(p);
    if (r > bestRank) {
      best = p;
      bestRank = r;
    }
  }
  return best;
}

const asTiers = (v: unknown): LeaveNoticeTier[] =>
  Array.isArray(v)
    ? (v as LeaveNoticeTier[])
        .filter((t) => typeof t?.minDays === 'number' && typeof t?.noticeDays === 'number')
        .sort((a, b) => a.minDays - b.minDays)
    : [];
const asCodes = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string') : [];

/** Merge policy-rule overrides over the leave type defaults. */
export function effectiveRules(
  type: { sandwichRule: boolean },
  rule?: RuleOverrides | null,
  policy?: { id: string; name: string } | null,
): EffectiveLeaveRules {
  const sandwichMode = (rule?.sandwichMode ??
    (type.sandwichRule ? 'BOTH' : 'NONE')) as SandwichMode;
  return {
    policyId: rule ? (policy?.id ?? null) : null,
    policyName: rule ? (policy?.name ?? null) : null,
    sandwichMode,
    sandwichMinDays: numOrNull(rule?.sandwichMinDays),
    sandwichAdjacent: rule?.sandwichAdjacent ?? false,
    minNoticeDays: rule?.minNoticeDays ?? null,
    noticeTiers: asTiers(rule?.noticeTiers),
    maxAdvanceDays: rule?.maxAdvanceDays ?? null,
    allowBackdated: rule?.allowBackdated ?? true,
    backdatedMaxDays: rule?.backdatedMaxDays ?? null,
    minDaysPerRequest: numOrNull(rule?.minDaysPerRequest),
    maxConsecutiveDays: numOrNull(rule?.maxConsecutiveDays),
    maxRequestsPerMonth: rule?.maxRequestsPerMonth ?? null,
    maxDaysPerMonth: numOrNull(rule?.maxDaysPerMonth),
    notClubbableWith: asCodes(rule?.notClubbableWith).map((c) => c.toUpperCase()),
  };
}

/** Notice (calendar days in advance) required for a request of `days` leave days. */
export function requiredNotice(rules: EffectiveLeaveRules, days: number): number {
  let notice = rules.minNoticeDays ?? 0;
  for (const t of rules.noticeTiers) {
    if (days >= t.minDays) notice = Math.max(notice, t.noticeDays);
  }
  return notice;
}

const dayMs = 86_400_000;
/** Whole calendar days from `a` to `b` (YYYY-MM-DD; negative when b < a). */
export const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / dayMs);

const plural = (n: number, unit = 'day') => `${n} ${unit}${n === 1 ? '' : 's'}`;

export interface RuleCheckInput {
  typeCode: string;
  /** Effective start (after adjacent-sandwich extension) and the employee's local today. */
  fromDate: string;
  today: string;
  /** Leave days counted for the request (incl. sandwiched days). */
  days: number;
  /** Per calendar month (YYYY-MM) touched by the request: existing pending/approved usage. */
  months: { month: string; existingRequests: number; existingDays: number; newDays: number }[];
  /** Codes of leave types taken directly adjacent (only non-working days in between). */
  adjacentCodes: string[];
}

/** All rule violations of a request (empty = allowed). */
export function checkRules(
  rules: EffectiveLeaveRules,
  input: RuleCheckInput,
): LeaveRuleViolationDto[] {
  const out: LeaveRuleViolationDto[] = [];
  const code = input.typeCode;
  const lead = daysBetween(input.today, input.fromDate);
  if (lead >= 0) {
    const notice = requiredNotice(rules, input.days);
    if (lead < notice) {
      out.push({
        code: 'LEAVE_NOTICE_REQUIRED',
        message: `${code} of ${plural(input.days)} must be applied at least ${plural(notice)} in advance`,
      });
    }
    if (rules.maxAdvanceDays != null && lead > rules.maxAdvanceDays) {
      out.push({
        code: 'LEAVE_ADVANCE_LIMIT',
        message: `${code} cannot be applied more than ${plural(rules.maxAdvanceDays)} in advance`,
      });
    }
  } else if (!rules.allowBackdated) {
    out.push({
      code: 'LEAVE_BACKDATED_NOT_ALLOWED',
      message: `${code} cannot be applied for past dates`,
    });
  } else if (rules.backdatedMaxDays != null && -lead > rules.backdatedMaxDays) {
    out.push({
      code: 'LEAVE_BACKDATED_LIMIT',
      message: `${code} can be applied at most ${plural(rules.backdatedMaxDays)} after the leave date`,
    });
  }
  if (rules.minDaysPerRequest != null && input.days < rules.minDaysPerRequest) {
    out.push({
      code: 'LEAVE_MIN_DAYS',
      message: `${code} must be at least ${plural(rules.minDaysPerRequest)} per request`,
    });
  }
  if (rules.maxConsecutiveDays != null && input.days > rules.maxConsecutiveDays) {
    out.push({
      code: 'LEAVE_MAX_CONSECUTIVE',
      message: `${code} cannot exceed ${plural(rules.maxConsecutiveDays)} at a stretch`,
    });
  }
  const startMonth = input.fromDate.slice(0, 7);
  for (const m of input.months) {
    if (
      rules.maxRequestsPerMonth != null &&
      m.month === startMonth &&
      m.existingRequests + 1 > rules.maxRequestsPerMonth
    ) {
      out.push({
        code: 'LEAVE_MONTHLY_REQUEST_LIMIT',
        message: `Only ${plural(rules.maxRequestsPerMonth, 'request')} of ${code} allowed per month (${m.month})`,
      });
    }
    if (
      rules.maxDaysPerMonth != null &&
      m.newDays > 0 &&
      m.existingDays + m.newDays > rules.maxDaysPerMonth
    ) {
      out.push({
        code: 'LEAVE_MONTHLY_DAYS_LIMIT',
        message: `At most ${plural(rules.maxDaysPerMonth)} of ${code} allowed per month (${m.month}: ${m.existingDays} already taken)`,
      });
    }
  }
  const clash = [...new Set(input.adjacentCodes.map((c) => c.toUpperCase()))].filter((c) =>
    rules.notClubbableWith.includes(c),
  );
  if (clash.length) {
    out.push({
      code: 'LEAVE_NOT_CLUBBABLE',
      message: `${code} cannot be clubbed with ${clash.join(', ')}`,
    });
  }
  return out;
}

const SANDWICH_TEXT: Record<SandwichMode, string> = {
  NONE: '',
  WEEKLY_OFFS: 'weekly offs',
  HOLIDAYS: 'holidays',
  BOTH: 'weekly offs and holidays',
};

/** Human-readable summary of the rules (for the apply form). */
export function describeRules(rules: EffectiveLeaveRules, code: string): string[] {
  const out: string[] = [];
  if (rules.minNoticeDays || rules.noticeTiers.length) {
    const parts: string[] = [];
    if (rules.minNoticeDays) parts.push(`at least ${plural(rules.minNoticeDays)}`);
    for (const t of rules.noticeTiers) {
      parts.push(`${plural(t.noticeDays)} for ${t.minDays}+ day leave`);
    }
    out.push(`Apply ${code} in advance: ${parts.join('; ')}`);
  }
  if (rules.maxAdvanceDays != null) {
    out.push(`Apply no more than ${plural(rules.maxAdvanceDays)} ahead`);
  }
  if (!rules.allowBackdated) out.push('Past-dated requests are not allowed');
  else if (rules.backdatedMaxDays != null) {
    out.push(`Past-dated requests allowed up to ${plural(rules.backdatedMaxDays)} back`);
  }
  if (rules.sandwichMode !== 'NONE') {
    const when = rules.sandwichMinDays ? ` when the leave is ${rules.sandwichMinDays}+ days` : '';
    const adj = rules.sandwichAdjacent ? ' (also across adjacent requests)' : '';
    out.push(
      `Sandwich rule: ${SANDWICH_TEXT[rules.sandwichMode]} between leave days are counted${when}${adj}`,
    );
  }
  if (rules.minDaysPerRequest != null) {
    out.push(`Minimum ${plural(rules.minDaysPerRequest)} per request`);
  }
  if (rules.maxConsecutiveDays != null) {
    out.push(`Maximum ${plural(rules.maxConsecutiveDays)} at a stretch`);
  }
  if (rules.maxRequestsPerMonth != null) {
    out.push(`Maximum ${plural(rules.maxRequestsPerMonth, 'request')} per month`);
  }
  if (rules.maxDaysPerMonth != null) {
    out.push(`Maximum ${plural(rules.maxDaysPerMonth)} per month`);
  }
  if (rules.notClubbableWith.length) {
    out.push(`Cannot be clubbed with ${rules.notClubbableWith.join(', ')}`);
  }
  return out;
}
