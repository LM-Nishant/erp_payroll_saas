import type { AttendanceStatus, WeeklyOffRule } from '@erp/shared';

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
              ? `${WEEKDAYS[r.weekday]} (wk ${r.weeks.join(',')})`
              : WEEKDAYS[r.weekday],
          )
          .join(', ');

/** Parse `weekday[:weeks]` tokens separated by `;` — e.g. "0; 6:2,4" = Sundays + 2nd/4th Saturdays. */
export const parseWeeklyOffs = (text: string): WeeklyOffRule[] =>
  text
    .split(';')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const [day, weeks] = t.split(':');
      const weekday = Number(day);
      const list = (weeks ?? '')
        .split(',')
        .map((w) => Number(w.trim()))
        .filter((w) => w >= 1 && w <= 5);
      return list.length ? { weekday, weeks: list } : { weekday };
    });

export const formatWeeklyOffsInput = (rules: WeeklyOffRule[] | null | undefined) =>
  (rules ?? [])
    .map((r) => (r.weeks?.length ? `${r.weekday}:${r.weeks.join(',')}` : `${r.weekday}`))
    .join('; ');

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
