import type { WeeklyOffRule } from '@erp/shared';

/*
 * Pure date / time helpers for the attendance + leave engines. Calendar dates are `YYYY-MM-DD`
 * strings (UTC-midnight `Date`s in the database); local times are computed with `Intl` in the
 * institution's attendance time zone.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const dateToStr = (d: Date): string => d.toISOString().slice(0, 10);
export const strToDate = (s: string): Date => new Date(`${s.slice(0, 10)}T00:00:00.000Z`);

export function addDays(date: string, n: number): string {
  return dateToStr(new Date(strToDate(date).getTime() + n * DAY_MS));
}

/** Inclusive list of dates from `from` to `to`. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((strToDate(to).getTime() - strToDate(from).getTime()) / DAY_MS);
}

/** 0 = Sunday .. 6 = Saturday. */
export const weekdayOf = (date: string): number => strToDate(date).getUTCDay();

/** 1-based occurrence of the date's weekday within its month (e.g. 2 = second Saturday). */
export const weekOfMonth = (date: string): number =>
  Math.floor((strToDate(date).getUTCDate() - 1) / 7) + 1;

export function isWeeklyOff(rules: readonly WeeklyOffRule[], date: string): boolean {
  const weekday = weekdayOf(date);
  const nth = weekOfMonth(date);
  return rules.some((r) => r.weekday === weekday && (!r.weeks || r.weeks.includes(nth)));
}

/** Built-in weekly off when no calendar / shift defines one: every Sunday. */
export const DEFAULT_WEEKLY_OFFS: WeeklyOffRule[] = [{ weekday: 0 }];

/* --------------------------------- Time zones ------------------------------------------- */

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Local calendar date + minute of day of an instant in `timeZone`. */
export function localParts(instant: Date, timeZone: string): { date: string; minute: number } {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Offset (minutes, local − UTC) of `timeZone` at `instant`. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const { date, minute } = localParts(instant, timeZone);
  const localMs = strToDate(date).getTime() + minute * 60_000;
  const instantMinuteMs = Math.floor(instant.getTime() / 60_000) * 60_000;
  return Math.round((localMs - instantMinuteMs) / 60_000);
}

/** Instant of local `date` + `minute` (may exceed 1440 for next-day times) in `timeZone`. */
export function localToInstant(date: string, minute: number, timeZone: string): Date {
  const naive = strToDate(date).getTime() + minute * 60_000;
  const first = naive - offsetMinutes(new Date(naive), timeZone) * 60_000;
  const second = naive - offsetMinutes(new Date(first), timeZone) * 60_000;
  return new Date(second);
}

/** Minutes of `instant` relative to local midnight of `date` (can be < 0 or ≥ 1440). */
export function minutesFromLocalMidnight(instant: Date, date: string, timeZone: string): number {
  return Math.round((instant.getTime() - localToInstant(date, 0, timeZone).getTime()) / 60_000);
}

/** Today's date in `timeZone`. */
export const localToday = (timeZone: string, now = new Date()): string =>
  localParts(now, timeZone).date;

export const round2 = (n: number): number => Math.round(n * 100) / 100;
