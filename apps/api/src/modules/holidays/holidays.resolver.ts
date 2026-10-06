import type { HolidayType, WeeklyOffRule } from '@erp/shared';
import type { Holiday, HolidayCalendar } from '@prisma/client';
import { tenantDb } from '../../core/tenancy';
import { dateToStr, DEFAULT_WEEKLY_OFFS, isWeeklyOff } from '../attendance/time';

/*
 * Holiday calendar resolution (Layer 7). Calendars exist per year at four levels:
 *   ORGANIZATION (default) → GROUP → INSTITUTION → CAMPUS
 * For a date the MOST SPECIFIC calendar with an entry for that date wins (an entry with
 * `removed = true` suppresses an inherited holiday); the weekly-off pattern comes from the
 * most specific calendar that defines one (else every Sunday). Each institution can therefore
 * have its own calendar while sharing group / organization defaults (acceptance criterion 6).
 */

export interface CalendarCoordinates {
  groupId: string | null;
  institutionId: string | null;
  campusId: string | null;
}

export interface ResolvedHoliday {
  name: string;
  type: HolidayType;
  calendarId: string;
}

export interface ResolvedCalendarDay {
  /** PUBLIC holiday (day off), if any. */
  holiday: ResolvedHoliday | null;
  /** RESTRICTED / OPTIONAL holiday listed for the date (not a day off). */
  optional: ResolvedHoliday | null;
  weeklyOff: boolean;
  /** Weekly-off pattern in force (for shift-level override decisions). */
  weeklyOffs: WeeklyOffRule[];
  weeklyOffCalendarId: string | null;
}

type CalendarWithHolidays = HolidayCalendar & { holidays: Holiday[] };

const chainKeys = (c: CalendarCoordinates) =>
  [c.campusId, c.institutionId, c.groupId, 'ORG'].filter((k): k is string => !!k);

/**
 * Request-scoped resolver: caches calendar chains per (coordinates, year), so resolving a
 * month for hundreds of employees costs a handful of queries.
 */
export class HolidayResolver {
  private chains = new Map<string, Promise<CalendarWithHolidays[]>>();

  private chain(coords: CalendarCoordinates, year: number): Promise<CalendarWithHolidays[]> {
    const keys = chainKeys(coords);
    const cacheKey = `${keys.join('|')}@${year}`;
    let chain = this.chains.get(cacheKey);
    if (!chain) {
      chain = tenantDb()
        .holidayCalendar.findMany({
          where: { year, scopeKey: { in: keys } },
          include: { holidays: true },
        })
        .then((rows) =>
          keys
            .map((k) => rows.find((r) => r.scopeKey === k))
            .filter((r): r is CalendarWithHolidays => !!r),
        );
      this.chains.set(cacheKey, chain);
    }
    return chain;
  }

  async resolve(coords: CalendarCoordinates, date: string): Promise<ResolvedCalendarDay> {
    const chain = await this.chain(coords, Number(date.slice(0, 4)));
    let holiday: ResolvedHoliday | null = null;
    let optional: ResolvedHoliday | null = null;
    for (const calendar of chain) {
      const entry = calendar.holidays.find((h) => dateToStr(h.date) === date);
      if (!entry) continue;
      if (!entry.removed) {
        const resolved = { name: entry.name, type: entry.type, calendarId: calendar.id };
        if (entry.type === 'PUBLIC') holiday = resolved;
        else optional = resolved;
      }
      break;
    }
    const weeklySource = chain.find((c) => Array.isArray(c.weeklyOffs));
    const weeklyOffs = weeklySource
      ? (weeklySource.weeklyOffs as unknown as WeeklyOffRule[])
      : DEFAULT_WEEKLY_OFFS;
    return {
      holiday,
      optional,
      weeklyOff: isWeeklyOff(weeklyOffs, date),
      weeklyOffs,
      weeklyOffCalendarId: weeklySource?.id ?? null,
    };
  }
}
