import type { AttendanceRecordDto, AttendanceStatus, WeeklyOffRule } from '@erp/shared';
import { label } from './useHrOptions';

/** Formatting helpers shared by the attendance / leave / holiday / shift pages (Layer 7). */

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Minute of day → `HH:MM`. */
export const hhmm = (minute: number | null | undefined) => {
  if (minute === null || minute === undefined) return '—';
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** `HH:MM` → minute of day (null when blank / invalid). */
export const toMinute = (value: string | null | undefined): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec((value ?? '').trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h < 24 && m < 60 ? h * 60 + m : null;
};

export const weeklyOffsText = (rules: WeeklyOffRule[] | null | undefined) =>
  rules === null || rules === undefined
    ? 'Inherited'
    : rules.length === 0
      ? 'None'
      : rules
          .map((r) =>
            r.weeks?.length
              ? `${r.weeks.map((w) => ['1st', '2nd', '3rd', '4th', '5th'][w - 1]).join('/')} ${WEEKDAYS[r.weekday]}`
              : WEEKDAYS[r.weekday],
          )
          .join(', ');

export const ATTENDANCE_COLORS: Partial<Record<AttendanceStatus, string>> = {
  PRESENT: 'success',
  LATE: 'warning',
  HALF_DAY: 'amber',
  ABSENT: 'error',
  LOP: 'error',
  ON_LEAVE: 'info',
  HOLIDAY: 'purple',
  WEEKLY_OFF: 'grey',
  ON_DUTY: 'teal',
};

/**
 * Status chip for a day record. Today's incomplete day is not shown as absent: it reads
 * "In progress" once punched in, or "Not punched yet".
 */
export const recordStatus = (
  r: Pick<AttendanceRecordDto, 'status' | 'inProgress' | 'firstIn'>,
): { text: string; color: string | undefined } =>
  r.inProgress
    ? r.firstIn
      ? { text: 'In progress', color: 'info' }
      : { text: 'Not punched yet', color: 'grey' }
    : { text: label(r.status), color: ATTENDANCE_COLORS[r.status] };

export const REQUEST_COLORS: Record<string, string> = {
  PENDING_APPROVAL: 'warning',
  APPROVED: 'success',
  REJECTED: 'error',
  CANCELLED: 'default',
  WITHDRAWN: 'default',
};

export const monthRange = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
};

export const currentMonth = () => new Date().toISOString().slice(0, 7);
