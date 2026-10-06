import type { AttendanceStatus } from '@erp/shared';

/*
 * Pure daily attendance computation (no I/O) — unit tested in attendance.engine.test.ts.
 *
 * Every computed day carries weights that sum to exactly 1:
 *   presentDays + paidLeaveDays + unpaidLeaveDays + absentDays + offDays = 1
 * so payroll can aggregate days without re-interpreting statuses.
 */

export interface ShiftTimes {
  startMinute: number;
  endMinute: number;
  crossesMidnight: boolean;
  graceInMinutes: number;
  graceOutMinutes: number;
  breakMinutes: number;
  halfDayMinutes: number;
  fullDayMinutes: number;
  overtimeAfterMinutes: number;
}

/** Defaults when an employee has no shift: no lateness, 4h half day, 8h full day. */
export const NO_SHIFT_HALF_DAY_MINUTES = 240;
export const NO_SHIFT_FULL_DAY_MINUTES = 480;

/** How long after a cross-midnight shift's end a next-day punch still belongs to it. */
export const CROSS_MIDNIGHT_WINDOW_MINUTES = 240;

export const shiftCrossesMidnight = (startMinute: number, endMinute: number) =>
  endMinute <= startMinute;

/** End minute relative to the shift day's local midnight (> 1440 when crossing midnight). */
export const shiftEndRelative = (s: Pick<ShiftTimes, 'startMinute' | 'endMinute'>) =>
  shiftCrossesMidnight(s.startMinute, s.endMinute) ? s.endMinute + 1440 : s.endMinute;

export const scheduledMinutes = (s: ShiftTimes) =>
  Math.max(0, shiftEndRelative(s) - s.startMinute - s.breakMinutes);

/**
 * Which local shift day a punch at local `minute` of `date` belongs to: the previous day when
 * the previous day's shift crosses midnight and the punch falls before its end (+ window).
 */
export function attributePunchDate(
  minute: number,
  previousDayShift: Pick<ShiftTimes, 'startMinute' | 'endMinute'> | null,
): 'SAME_DAY' | 'PREVIOUS_DAY' {
  if (
    previousDayShift &&
    shiftCrossesMidnight(previousDayShift.startMinute, previousDayShift.endMinute) &&
    minute <= previousDayShift.endMinute + CROSS_MIDNIGHT_WINDOW_MINUTES
  ) {
    return 'PREVIOUS_DAY';
  }
  return 'SAME_DAY';
}

/** Rotation: index of the shift used `daysSinceStart` days after the assignment started. */
export function rotationIndex(daysSinceStart: number, rotationDays: number, length: number) {
  if (length <= 0) return 0;
  const cycle = Math.floor(Math.max(0, daysSinceStart) / Math.max(1, rotationDays));
  return cycle % length;
}

export interface DayLeave {
  /** 0.5 or 1. */
  days: number;
  isPaid: boolean;
  leaveTypeId: string;
  leaveRequestId: string;
}

export interface DayInput {
  shift: ShiftTimes | null;
  /** Punch times as minutes from the local midnight of the attendance date, ascending. */
  punchMinutes: number[];
  holidayName: string | null;
  weeklyOff: boolean;
  leave: DayLeave | null;
  /** HR override / approved regularization. */
  overrideStatus: AttendanceStatus | null;
}

export interface DayResult {
  status: AttendanceStatus;
  firstInMinute: number | null;
  lastOutMinute: number | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyExitMinutes: number;
  overtimeMinutes: number;
  isLate: boolean;
  missingPunch: boolean;
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  offDays: number;
}

const ZERO = {
  presentDays: 0,
  paidLeaveDays: 0,
  unpaidLeaveDays: 0,
  absentDays: 0,
  offDays: 0,
};

export function computeDay(input: DayInput): DayResult {
  const { shift, punchMinutes, leave } = input;
  const first = punchMinutes.length > 0 ? (punchMinutes[0] ?? null) : null;
  const last = punchMinutes.length > 1 ? (punchMinutes[punchMinutes.length - 1] ?? null) : null;
  const span = first !== null && last !== null ? last - first : 0;
  const workedMinutes = Math.max(
    0,
    span - (shift && span > shift.breakMinutes ? shift.breakMinutes : 0),
  );
  const missingPunch = punchMinutes.length === 1;
  const halfDay = shift?.halfDayMinutes ?? NO_SHIFT_HALF_DAY_MINUTES;
  const fullDay = shift?.fullDayMinutes ?? NO_SHIFT_FULL_DAY_MINUTES;

  let lateMinutes = 0;
  let earlyExitMinutes = 0;
  let overtimeMinutes = 0;
  if (shift && first !== null) {
    if (first > shift.startMinute + shift.graceInMinutes) lateMinutes = first - shift.startMinute;
    const end = shiftEndRelative(shift);
    if (last !== null && last < end - shift.graceOutMinutes) earlyExitMinutes = end - last;
    const scheduled = scheduledMinutes(shift);
    if (workedMinutes > scheduled + shift.overtimeAfterMinutes) {
      overtimeMinutes = workedMinutes - scheduled;
    }
  }
  const base = {
    firstInMinute: first,
    lastOutMinute: last,
    workedMinutes,
    lateMinutes: 0,
    earlyExitMinutes: 0,
    overtimeMinutes: 0,
    isLate: false,
    missingPunch,
  };
  const leaveHalf = leave && leave.days < 1 ? leave : null;
  const leaveWeights = (days: number) =>
    leave ? (leave.isPaid ? { paidLeaveDays: days } : { unpaidLeaveDays: days }) : {};

  const override = input.overrideStatus;
  if (override) {
    const presence =
      override === 'PRESENT' || override === 'ON_DUTY' || override === 'LATE'
        ? 1
        : override === 'HALF_DAY'
          ? 0.5
          : 0;
    if (override === 'HOLIDAY' || override === 'WEEKLY_OFF') {
      return { ...base, status: override, ...ZERO, offDays: 1 };
    }
    if ((override === 'ON_LEAVE' || override === 'LOP') && leave) {
      return { ...base, status: override, ...ZERO, ...leaveWeights(1) };
    }
    const leaveDays = leaveHalf ? 0.5 : 0;
    const presentDays = Math.min(presence, 1 - leaveDays);
    return {
      ...base,
      lateMinutes,
      earlyExitMinutes,
      overtimeMinutes,
      status: leaveHalf && override !== 'ON_DUTY' && presentDays < 1 ? 'HALF_DAY' : override,
      ...ZERO,
      presentDays,
      ...leaveWeights(leaveDays),
      absentDays: 1 - presentDays - leaveDays,
    };
  }

  // Full-day leave wins (including sandwiched holidays / weekly offs counted as leave).
  if (leave && leave.days >= 1) {
    return {
      ...base,
      status: leave.isPaid ? 'ON_LEAVE' : 'LOP',
      ...ZERO,
      ...leaveWeights(1),
    };
  }

  // Non-working day: worked time (if any) is overtime.
  if (input.holidayName || input.weeklyOff) {
    return {
      ...base,
      overtimeMinutes: workedMinutes,
      status: input.holidayName ? 'HOLIDAY' : 'WEEKLY_OFF',
      ...ZERO,
      offDays: 1,
    };
  }

  const presence = workedMinutes >= fullDay ? 1 : workedMinutes >= halfDay ? 0.5 : 0;
  if (leaveHalf) {
    const presentDays = Math.min(presence, 0.5);
    return {
      ...base,
      overtimeMinutes,
      status: 'HALF_DAY',
      ...ZERO,
      presentDays,
      ...leaveWeights(0.5),
      absentDays: 0.5 - presentDays,
    };
  }
  const isLate = presence > 0 && lateMinutes > 0;
  const status: AttendanceStatus =
    presence === 1 ? (isLate ? 'LATE' : 'PRESENT') : presence === 0.5 ? 'HALF_DAY' : 'ABSENT';
  return {
    ...base,
    lateMinutes: presence > 0 ? lateMinutes : 0,
    earlyExitMinutes: presence > 0 ? earlyExitMinutes : 0,
    overtimeMinutes,
    isLate,
    status,
    ...ZERO,
    presentDays: presence,
    absentDays: 1 - presence,
  };
}

/* --------------------------------- Leave day calculation -------------------------------- */

export interface LeaveCalendarDay {
  date: string;
  kind: 'WORKING' | 'HOLIDAY' | 'WEEKLY_OFF';
  name?: string;
}

export interface LeaveDay extends LeaveCalendarDay {
  days: number;
  sandwiched: boolean;
}

/**
 * Leave days of a request: working days count 1 (first / last 0.5 with `startHalf` /
 * `endHalf`); holidays and weekly offs count 0 — unless `sandwich` is on and they lie BETWEEN
 * two leave days of the request, in which case they count 1.
 */
export function calculateLeaveDays(
  calendar: LeaveCalendarDay[],
  options: { startHalf: boolean; endHalf: boolean; sandwich: boolean },
): { days: number; breakdown: LeaveDay[] } {
  const n = calendar.length;
  const breakdown: LeaveDay[] = calendar.map((d, i) => {
    if (d.kind !== 'WORKING') return { ...d, days: 0, sandwiched: false };
    let days = 1;
    if (i === 0 && options.startHalf) days = 0.5;
    if (i === n - 1 && options.endHalf) days = 0.5;
    return { ...d, days, sandwiched: false };
  });
  if (options.sandwich) {
    const working = breakdown.map((d, i) => (d.kind === 'WORKING' ? i : -1)).filter((i) => i >= 0);
    if (working.length >= 2) {
      const firstWorking = working[0] ?? 0;
      const lastWorking = working[working.length - 1] ?? 0;
      for (let i = firstWorking + 1; i < lastWorking; i += 1) {
        const d = breakdown[i];
        if (d && d.kind !== 'WORKING') {
          breakdown[i] = { ...d, days: 1, sandwiched: true };
        }
      }
    }
  }
  const days = breakdown.reduce((sum, d) => sum + d.days, 0);
  return { days, breakdown };
}

/* --------------------------------- Accrual ---------------------------------------------- */

export type AccrualPeriod = { key: string; start: string; end: string };

/** Accrual periods of `year` for a frequency (MONTHLY → 12, QUARTERLY → 4, YEARLY → 1). */
export function accrualPeriods(
  year: number,
  frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY',
): AccrualPeriod[] {
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = (m: number) => new Date(Date.UTC(year, m, 0)).getUTCDate();
  if (frequency === 'YEARLY')
    return [{ key: `${year}`, start: `${year}-01-01`, end: `${year}-12-31` }];
  if (frequency === 'QUARTERLY') {
    return [1, 2, 3, 4].map((q) => {
      const endMonth = q * 3;
      return {
        key: `${year}-Q${q}`,
        start: `${year}-${pad(endMonth - 2)}-01`,
        end: `${year}-${pad(endMonth)}-${pad(lastDay(endMonth))}`,
      };
    });
  }
  return Array.from({ length: 12 }, (_, i) => ({
    key: `${year}-${pad(i + 1)}`,
    start: `${year}-${pad(i + 1)}-01`,
    end: `${year}-${pad(i + 1)}-${pad(lastDay(i + 1))}`,
  }));
}

/**
 * Credit of one accrual period: `annualQuota / periodsPerYear`, pro-rated by the employed share
 * of the period when the employee joined inside it (rounded to 0.25 day, never above the full
 * credit). 0 when the employee joined after the period.
 */
export function accrualCredit(input: {
  annualQuota: number;
  periodsPerYear: number;
  period: AccrualPeriod;
  joiningDate: string | null;
  proRata: boolean;
}): number {
  const full = input.annualQuota / input.periodsPerYear;
  const { period, joiningDate } = input;
  if (joiningDate && joiningDate > period.end) return 0;
  if (!joiningDate || joiningDate <= period.start || !input.proRata) return roundQuarter(full);
  const total = dayDiff(period.start, period.end) + 1;
  const employed = dayDiff(joiningDate, period.end) + 1;
  return roundQuarter((full * employed) / total);
}

const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export const roundQuarter = (n: number) => Math.round(n * 4) / 4;
