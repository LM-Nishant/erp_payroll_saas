import type { StudentAttendanceSummaryDto, StudentAttendanceStatus } from '@erp/shared';

/** Pure student-attendance helpers. */

/** Weight of each status towards attendance % (late counts present, half-day counts half). */
const WEIGHT: Record<StudentAttendanceStatus, number> = {
  PRESENT: 1,
  LATE: 1,
  HALF_DAY: 0.5,
  ABSENT: 0,
  LEAVE: 0,
};

export function summarizeAttendance(
  statuses: readonly StudentAttendanceStatus[],
): StudentAttendanceSummaryDto {
  const count = (s: StudentAttendanceStatus) => statuses.filter((x) => x === s).length;
  const attended = statuses.reduce((sum, s) => sum + WEIGHT[s], 0);
  return {
    workingDays: statuses.length,
    present: count('PRESENT'),
    absent: count('ABSENT'),
    late: count('LATE'),
    leave: count('LEAVE'),
    halfDay: count('HALF_DAY'),
    percentage: statuses.length ? Math.round((attended / statuses.length) * 10000) / 100 : 0,
  };
}

/**
 * Teachers may edit attendance only within `windowDays` days of the attendance date (and never
 * for future dates). `today` and `date` are YYYY-MM-DD.
 */
export function withinEditWindow(date: string, today: string, windowDays: number): boolean {
  if (date > today) return false;
  const diff = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000;
  return diff <= windowDays;
}

/** All YYYY-MM-DD dates of a YYYY-MM month. */
export function daysOfMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/**
 * Day status of a student: the daily mark when present, otherwise derived from period marks
 * (all absent → ABSENT, all present/late → PRESENT, otherwise HALF_DAY).
 */
export function collapseDay(
  daily: StudentAttendanceStatus | undefined,
  periods: readonly StudentAttendanceStatus[],
): StudentAttendanceStatus | null {
  if (daily) return daily;
  if (!periods.length) return null;
  if (periods.every((p) => p === 'ABSENT')) return 'ABSENT';
  if (periods.every((p) => p === 'LEAVE')) return 'LEAVE';
  if (periods.every((p) => p === 'PRESENT' || p === 'LATE')) return 'PRESENT';
  return 'HALF_DAY';
}
