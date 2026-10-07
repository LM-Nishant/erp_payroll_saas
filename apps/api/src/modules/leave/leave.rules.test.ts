import { describe, expect, it } from 'vitest';
import {
  checkRules,
  daysBetween,
  describeRules,
  effectiveRules,
  pickPolicy,
  requiredNotice,
  type RuleCheckInput,
  type RuleOverrides,
} from './leave.rules';

const blank: RuleOverrides = {
  sandwichMode: null,
  sandwichMinDays: null,
  sandwichAdjacent: null,
  minNoticeDays: null,
  noticeTiers: null,
  maxAdvanceDays: null,
  allowBackdated: null,
  backdatedMaxDays: null,
  minDaysPerRequest: null,
  maxConsecutiveDays: null,
  maxRequestsPerMonth: null,
  maxDaysPerMonth: null,
  notClubbableWith: null,
};

describe('pickPolicy', () => {
  const p = (
    id: string,
    groupId: string | null,
    institutionId: string | null,
    et: string | null,
  ) => ({
    id,
    groupId,
    institutionId,
    employmentType: et,
  });
  const all = [
    p('org', null, null, null),
    p('org-ft', null, null, 'FULL_TIME'),
    p('grp', 'g1', null, null),
    p('grp-ft', 'g1', null, 'FULL_TIME'),
    p('inst', null, 'i1', null),
    p('inst-ft', null, 'i1', 'FULL_TIME'),
    p('other-grp', 'g2', null, null),
    p('other-inst', null, 'i2', null),
  ];
  const coords = { groupId: 'g1', institutionId: 'i1', employmentType: 'FULL_TIME' };

  it('prefers the most specific scope', () => {
    expect(pickPolicy(all, coords)?.id).toBe('inst-ft');
    expect(pickPolicy(all, { ...coords, employmentType: 'CONTRACT' })?.id).toBe('inst');
    expect(pickPolicy(all.slice(0, 4), coords)?.id).toBe('grp-ft');
    expect(pickPolicy(all.slice(0, 3), coords)?.id).toBe('grp');
    expect(pickPolicy(all.slice(0, 2), coords)?.id).toBe('org-ft');
    expect(pickPolicy(all.slice(0, 1), coords)?.id).toBe('org');
  });

  it('ignores policies of other groups / institutions', () => {
    expect(pickPolicy(all, { groupId: 'g3', institutionId: 'i3', employmentType: null })?.id).toBe(
      'org',
    );
    expect(pickPolicy(all.slice(6), coords)).toBeNull();
  });
});

describe('effectiveRules', () => {
  it('falls back to the leave type sandwich default', () => {
    expect(effectiveRules({ sandwichRule: true }).sandwichMode).toBe('BOTH');
    expect(effectiveRules({ sandwichRule: false }).sandwichMode).toBe('NONE');
    const r = effectiveRules({ sandwichRule: false }, blank, { id: 'p', name: 'P' });
    expect(r).toMatchObject({ sandwichMode: 'NONE', allowBackdated: true, policyId: 'p' });
  });

  it('applies overrides and normalises values', () => {
    const r = effectiveRules(
      { sandwichRule: true },
      {
        ...blank,
        sandwichMode: 'HOLIDAYS',
        sandwichMinDays: { toString: () => '3.00' },
        noticeTiers: [
          { minDays: 3, noticeDays: 10 },
          { minDays: 1, noticeDays: 5 },
        ],
        notClubbableWith: ['sl'],
        allowBackdated: false,
      },
    );
    expect(r.sandwichMode).toBe('HOLIDAYS');
    expect(r.sandwichMinDays).toBe(3);
    expect(r.noticeTiers.map((t) => t.minDays)).toEqual([1, 3]);
    expect(r.notClubbableWith).toEqual(['SL']);
    expect(r.allowBackdated).toBe(false);
  });
});

describe('notice tiers', () => {
  const rules = effectiveRules(
    { sandwichRule: false },
    {
      ...blank,
      noticeTiers: [
        { minDays: 1, noticeDays: 5 },
        { minDays: 3, noticeDays: 10 },
      ],
    },
  );

  it('picks the strictest matching tier', () => {
    expect(requiredNotice(rules, 0.5)).toBe(0);
    expect(requiredNotice(rules, 2)).toBe(5);
    expect(requiredNotice(rules, 3)).toBe(10);
    expect(requiredNotice({ ...rules, minNoticeDays: 7 }, 2)).toBe(7);
  });

  it('reports insufficient notice', () => {
    const base = { typeCode: 'CL', today: '2026-03-01', months: [], adjacentCodes: [] };
    expect(checkRules(rules, { ...base, fromDate: '2026-03-06', days: 2 })).toEqual([]);
    const v = checkRules(rules, { ...base, fromDate: '2026-03-04', days: 2 });
    expect(v.map((x) => x.code)).toEqual(['LEAVE_NOTICE_REQUIRED']);
    expect(v[0]?.message).toBe('CL of 2 days must be applied at least 5 days in advance');
    expect(
      checkRules(rules, { ...base, fromDate: '2026-03-08', days: 3 }).map((x) => x.code),
    ).toEqual(['LEAVE_NOTICE_REQUIRED']);
    expect(checkRules(rules, { ...base, fromDate: '2026-03-11', days: 3 })).toEqual([]);
  });
});

describe('checkRules limits', () => {
  const base: RuleCheckInput = {
    typeCode: 'CL',
    today: '2026-03-10',
    fromDate: '2026-03-12',
    days: 2,
    months: [],
    adjacentCodes: [],
  };
  const codes = (r: RuleOverrides, input: Partial<RuleCheckInput> = {}) =>
    checkRules(effectiveRules({ sandwichRule: false }, r), { ...base, ...input }).map(
      (v) => v.code,
    );

  it('enforces advance and backdated windows', () => {
    expect(codes({ ...blank, maxAdvanceDays: 30 }, { fromDate: '2026-04-20' })).toEqual([
      'LEAVE_ADVANCE_LIMIT',
    ]);
    expect(codes({ ...blank, allowBackdated: false }, { fromDate: '2026-03-09' })).toEqual([
      'LEAVE_BACKDATED_NOT_ALLOWED',
    ]);
    expect(codes({ ...blank, backdatedMaxDays: 3 }, { fromDate: '2026-03-05' })).toEqual([
      'LEAVE_BACKDATED_LIMIT',
    ]);
    expect(
      codes({ ...blank, backdatedMaxDays: 3, minNoticeDays: 5 }, { fromDate: '2026-03-08' }),
    ).toEqual([]);
  });

  it('enforces per-request and monthly limits', () => {
    expect(codes({ ...blank, minDaysPerRequest: 3 })).toEqual(['LEAVE_MIN_DAYS']);
    expect(codes({ ...blank, maxConsecutiveDays: 1 })).toEqual(['LEAVE_MAX_CONSECUTIVE']);
    const months = [{ month: '2026-03', existingRequests: 2, existingDays: 3, newDays: 2 }];
    expect(codes({ ...blank, maxRequestsPerMonth: 2 }, { months })).toEqual([
      'LEAVE_MONTHLY_REQUEST_LIMIT',
    ]);
    expect(codes({ ...blank, maxRequestsPerMonth: 3, maxDaysPerMonth: 4 }, { months })).toEqual([
      'LEAVE_MONTHLY_DAYS_LIMIT',
    ]);
    expect(codes({ ...blank, maxDaysPerMonth: 5 }, { months })).toEqual([]);
  });

  it('blocks clubbing with listed leave types', () => {
    expect(codes({ ...blank, notClubbableWith: ['EL'] }, { adjacentCodes: ['el'] })).toEqual([
      'LEAVE_NOT_CLUBBABLE',
    ]);
    expect(codes({ ...blank, notClubbableWith: ['EL'] }, { adjacentCodes: ['SL'] })).toEqual([]);
  });
});

describe('helpers', () => {
  it('counts calendar days and describes rules', () => {
    expect(daysBetween('2026-02-27', '2026-03-02')).toBe(3);
    const hints = describeRules(
      effectiveRules(
        { sandwichRule: false },
        {
          ...blank,
          sandwichMode: 'BOTH',
          sandwichMinDays: 3,
          noticeTiers: [{ minDays: 1, noticeDays: 5 }],
        },
      ),
      'CL',
    );
    expect(hints[0]).toBe('Apply CL in advance: 5 days for 1+ day leave');
    expect(hints[1]).toContain('when the leave is 3+ days');
  });
});
