import { describe, expect, it } from 'vitest';
import {
  accrualCredit,
  accrualPeriods,
  attributePunchDate,
  calculateLeaveDays,
  computeDay,
  rotationIndex,
  scheduledMinutes,
  type DayInput,
  type LeaveCalendarDay,
  type ShiftTimes,
} from './attendance.engine';
import { addDays, eachDate, isWeeklyOff, localParts, localToInstant, weekOfMonth } from './time';

const DAY_SHIFT: ShiftTimes = {
  startMinute: 9 * 60,
  endMinute: 17 * 60,
  crossesMidnight: false,
  graceInMinutes: 10,
  graceOutMinutes: 10,
  breakMinutes: 30,
  halfDayMinutes: 240,
  fullDayMinutes: 420,
  overtimeAfterMinutes: 30,
};
const NIGHT_SHIFT: ShiftTimes = {
  ...DAY_SHIFT,
  startMinute: 22 * 60,
  endMinute: 6 * 60,
  crossesMidnight: true,
};

const day = (over: Partial<DayInput>): DayInput => ({
  shift: DAY_SHIFT,
  punchMinutes: [],
  holidayName: null,
  weeklyOff: false,
  leave: null,
  overrideStatus: null,
  ...over,
});

describe('time helpers', () => {
  it('iterates dates and weeks of month', () => {
    expect(eachDate('2026-02-27', '2026-03-02')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(weekOfMonth('2026-03-14')).toBe(2);
  });

  it('matches 2nd / 4th Saturday weekly-off patterns', () => {
    const rules = [{ weekday: 0 }, { weekday: 6, weeks: [2, 4] }];
    expect(isWeeklyOff(rules, '2026-03-01')).toBe(true); // Sunday
    expect(isWeeklyOff(rules, '2026-03-07')).toBe(false); // 1st Saturday
    expect(isWeeklyOff(rules, '2026-03-14')).toBe(true); // 2nd Saturday
    expect(isWeeklyOff(rules, '2026-03-21')).toBe(false); // 3rd Saturday
    expect(isWeeklyOff(rules, '2026-03-28')).toBe(true); // 4th Saturday
  });

  it('converts local time in a timezone both ways', () => {
    const instant = localToInstant('2026-03-10', 9 * 60 + 30, 'Asia/Kolkata');
    expect(instant.toISOString()).toBe('2026-03-10T04:00:00.000Z');
    expect(localParts(instant, 'Asia/Kolkata')).toEqual({ date: '2026-03-10', minute: 570 });
  });
});

describe('shift helpers', () => {
  it('computes scheduled minutes incl. cross-midnight', () => {
    expect(scheduledMinutes(DAY_SHIFT)).toBe(450);
    expect(scheduledMinutes(NIGHT_SHIFT)).toBe(450);
  });

  it('attributes early-morning punches to the previous day of a night shift', () => {
    expect(attributePunchDate(6 * 60 + 5, NIGHT_SHIFT)).toBe('PREVIOUS_DAY');
    expect(attributePunchDate(11 * 60, NIGHT_SHIFT)).toBe('SAME_DAY');
    expect(attributePunchDate(6 * 60, DAY_SHIFT)).toBe('SAME_DAY');
    expect(attributePunchDate(60, null)).toBe('SAME_DAY');
  });

  it('rotates shifts every N days', () => {
    expect([0, 6, 7, 13, 14, 21].map((d) => rotationIndex(d, 7, 2))).toEqual([0, 0, 1, 1, 0, 1]);
    expect(rotationIndex(5, 1, 3)).toBe(2);
    expect(rotationIndex(3, 7, 0)).toBe(0);
  });
});

describe('computeDay', () => {
  it('marks a full on-time day present', () => {
    const r = computeDay(day({ punchMinutes: [9 * 60, 17 * 60] }));
    expect(r).toMatchObject({
      status: 'PRESENT',
      presentDays: 1,
      workedMinutes: 450,
      isLate: false,
    });
  });

  it('marks late beyond grace', () => {
    const within = computeDay(day({ punchMinutes: [9 * 60 + 10, 17 * 60] }));
    expect(within.status).toBe('PRESENT');
    const late = computeDay(day({ punchMinutes: [9 * 60 + 20, 17 * 60 + 10] }));
    expect(late).toMatchObject({ status: 'LATE', isLate: true, lateMinutes: 20, presentDays: 1 });
  });

  it('half day and absent by worked hours; single punch is missing', () => {
    expect(computeDay(day({ punchMinutes: [9 * 60, 14 * 60] }))).toMatchObject({
      status: 'HALF_DAY',
      presentDays: 0.5,
      absentDays: 0.5,
    });
    expect(computeDay(day({ punchMinutes: [] }))).toMatchObject({
      status: 'ABSENT',
      absentDays: 1,
    });
    expect(computeDay(day({ punchMinutes: [9 * 60] }))).toMatchObject({
      status: 'ABSENT',
      missingPunch: true,
    });
  });

  it('computes a cross-midnight shift from relative minutes', () => {
    const r = computeDay(day({ shift: NIGHT_SHIFT, punchMinutes: [22 * 60, 30 * 60] }));
    expect(r).toMatchObject({ status: 'PRESENT', workedMinutes: 450, earlyExitMinutes: 0 });
  });

  it('holidays / weekly offs win over absence, leave wins over holidays', () => {
    expect(computeDay(day({ holidayName: 'Diwali' }))).toMatchObject({
      status: 'HOLIDAY',
      offDays: 1,
    });
    expect(computeDay(day({ weeklyOff: true }))).toMatchObject({
      status: 'WEEKLY_OFF',
      offDays: 1,
    });
    const leave = { days: 1, isPaid: true, leaveTypeId: 't', leaveRequestId: 'r' };
    expect(computeDay(day({ holidayName: 'X', leave }))).toMatchObject({
      status: 'ON_LEAVE',
      paidLeaveDays: 1,
    });
    expect(computeDay(day({ leave: { ...leave, isPaid: false } }))).toMatchObject({
      status: 'LOP',
      unpaidLeaveDays: 1,
    });
  });

  it('combines a half-day leave with half-day presence', () => {
    const leave = { days: 0.5, isPaid: true, leaveTypeId: 't', leaveRequestId: 'r' };
    expect(computeDay(day({ leave, punchMinutes: [13 * 60, 17 * 60 + 30] }))).toMatchObject({
      status: 'HALF_DAY',
      presentDays: 0.5,
      paidLeaveDays: 0.5,
      absentDays: 0,
    });
    expect(computeDay(day({ leave }))).toMatchObject({ paidLeaveDays: 0.5, absentDays: 0.5 });
  });

  it('honours a regularization override', () => {
    expect(computeDay(day({ overrideStatus: 'ON_DUTY' }))).toMatchObject({
      status: 'ON_DUTY',
      presentDays: 1,
      absentDays: 0,
    });
  });
});

describe('calculateLeaveDays', () => {
  const cal: LeaveCalendarDay[] = [
    { date: '2026-03-13', kind: 'WORKING' }, // Fri
    { date: '2026-03-14', kind: 'WEEKLY_OFF' },
    { date: '2026-03-15', kind: 'WEEKLY_OFF' },
    { date: '2026-03-16', kind: 'HOLIDAY', name: 'Festival' },
    { date: '2026-03-17', kind: 'WORKING' },
  ];

  it('skips holidays / weekly offs without the sandwich rule', () => {
    expect(
      calculateLeaveDays(cal, { startHalf: false, endHalf: false, sandwich: false }).days,
    ).toBe(2);
  });

  it('counts enclosed non-working days with the sandwich rule', () => {
    const r = calculateLeaveDays(cal, { startHalf: false, endHalf: false, sandwich: true });
    expect(r.days).toBe(5);
    expect(r.breakdown.filter((d) => d.sandwiched)).toHaveLength(3);
  });

  it('does not sandwich edges and honours half days', () => {
    const edge = cal.slice(0, 3);
    expect(
      calculateLeaveDays(edge, { startHalf: false, endHalf: false, sandwich: true }).days,
    ).toBe(1);
    expect(calculateLeaveDays(cal, { startHalf: true, endHalf: true, sandwich: false }).days).toBe(
      1,
    );
    expect(
      calculateLeaveDays([{ date: '2026-03-13', kind: 'WORKING' }], {
        startHalf: true,
        endHalf: false,
        sandwich: false,
      }).days,
    ).toBe(0.5);
  });
});

describe('accrual', () => {
  it('builds periods per frequency', () => {
    expect(accrualPeriods(2026, 'MONTHLY')).toHaveLength(12);
    expect(accrualPeriods(2026, 'MONTHLY')[1]).toEqual({
      key: '2026-02',
      start: '2026-02-01',
      end: '2026-02-28',
    });
    expect(accrualPeriods(2026, 'QUARTERLY')[3]).toEqual({
      key: '2026-Q4',
      start: '2026-10-01',
      end: '2026-12-31',
    });
    expect(accrualPeriods(2026, 'YEARLY')).toEqual([
      { key: '2026', start: '2026-01-01', end: '2026-12-31' },
    ]);
  });

  it('credits full periods and pro-rates the joining period', () => {
    const [jan] = accrualPeriods(2026, 'MONTHLY');
    const base = { annualQuota: 12, periodsPerYear: 12, period: jan!, proRata: true };
    expect(accrualCredit({ ...base, joiningDate: null })).toBe(1);
    expect(accrualCredit({ ...base, joiningDate: '2025-06-01' })).toBe(1);
    expect(accrualCredit({ ...base, joiningDate: '2026-01-16' })).toBe(0.5);
    expect(accrualCredit({ ...base, joiningDate: '2026-02-01' })).toBe(0);
    expect(accrualCredit({ ...base, joiningDate: '2026-01-16', proRata: false })).toBe(1);
    const year = accrualPeriods(2026, 'YEARLY')[0]!;
    expect(
      accrualCredit({
        annualQuota: 24,
        periodsPerYear: 1,
        period: year,
        joiningDate: '2026-07-02',
        proRata: true,
      }),
    ).toBe(12);
  });
});
