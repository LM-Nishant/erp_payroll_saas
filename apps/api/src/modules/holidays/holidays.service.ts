import type {
  CreateHolidayCalendarInput,
  HolidayCalendarDetailDto,
  HolidayCalendarDto,
  HolidayDto,
  ListHolidayCalendarsQuery,
  ResolvedDayDto,
  UpdateHolidayCalendarInput,
  UpsertHolidayInput,
  WeeklyOffRule,
} from '@erp/shared';
import type { Holiday, HolidayCalendar, Prisma } from '@prisma/client';
import { audit } from '../../core/audit';
import {
  accessFor,
  authorize,
  can,
  currentPrincipal,
  hasPermission,
  resolveScopeTarget,
  scopeAsResource,
  type ResourceScope,
} from '../../core/authz';
import { DbNull } from '../../core/db/helpers';
import { ConflictError, NotFoundError, ValidationError } from '../../core/http/errors';
import { tenantDb, withTenant } from '../../core/tenancy';
import { loadEmployeeWith } from '../attendance/attendance.access';
import { AttendanceContext } from '../attendance/attendance.context';
import { dateToStr, eachDate, isWeeklyOff, strToDate } from '../attendance/time';
import { shiftWeeklyOffs } from '../shifts/shifts.resolver';

/*
 * Holiday calendars (Layer 7): one calendar per (level, year) — organization default, group,
 * institution or campus — with PUBLIC / RESTRICTED / OPTIONAL holidays and an optional
 * weekly-off pattern (e.g. Sundays + 2nd / 4th Saturdays). Resolution: holidays.resolver.ts.
 */

type CalendarWithCount = HolidayCalendar & { _count?: { holidays: number } };

const weeklyOffsOf = (c: HolidayCalendar) =>
  Array.isArray(c.weeklyOffs) ? (c.weeklyOffs as unknown as WeeklyOffRule[]) : null;

export const toHolidayDto = (h: Holiday): HolidayDto => ({
  id: h.id,
  calendarId: h.calendarId,
  date: dateToStr(h.date),
  name: h.name,
  type: h.type,
  removed: h.removed,
});

export const toCalendarDto = (c: CalendarWithCount): HolidayCalendarDto => ({
  id: c.id,
  scope: c.scope,
  groupId: c.groupId,
  institutionId: c.institutionId,
  campusId: c.campusId,
  year: c.year,
  name: c.name,
  weeklyOffs: weeklyOffsOf(c),
  holidayCount: c._count?.holidays ?? 0,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

const resourceOf = (c: Pick<HolidayCalendar, 'groupId' | 'institutionId' | 'campusId'>) =>
  ({ groupId: c.groupId, institutionId: c.institutionId, campusId: c.campusId }) as ResourceScope;

/**
 * Organization calendars are the inherited default and visible to every `holiday.view` holder;
 * group calendars also to holders scoped to an institution inside the group (they inherit it).
 */
async function visible(c: HolidayCalendar): Promise<boolean> {
  const principal = currentPrincipal();
  if (!hasPermission(principal, 'holiday.view')) return false;
  if (c.scope === 'ORGANIZATION') return true;
  if (await can(principal, 'holiday.view', resourceOf(c))) return true;
  if (c.scope !== 'GROUP' || !c.groupId) return false;
  const access = await accessFor(principal, 'holiday.view');
  if (access.institutionIds.size === 0) return false;
  const inGroup = await tenantDb().institution.count({
    where: { groupId: c.groupId, id: { in: [...access.institutionIds] } },
  });
  return inGroup > 0;
}

async function load(id: string): Promise<HolidayCalendar> {
  const c = await tenantDb().holidayCalendar.findFirst({ where: { id } });
  if (!c || !(await visible(c))) throw new NotFoundError('Holiday calendar');
  return c;
}

async function loadForManage(id: string): Promise<HolidayCalendar> {
  const c = await load(id);
  await authorize(currentPrincipal(), 'holiday.manage', resourceOf(c));
  return c;
}

const calendarAudit = (c: HolidayCalendar) => ({
  scope: c.scope,
  scopeKey: c.scopeKey,
  year: c.year,
  name: c.name,
  weeklyOffs: c.weeklyOffs,
});

export const holidayService = {
  async list(query: ListHolidayCalendarsQuery) {
    const where: Prisma.HolidayCalendarWhereInput = {
      ...(query.year ? { year: query.year } : {}),
      ...(query.scope ? { scope: query.scope } : {}),
      ...(query.institutionId ? { institutionId: query.institutionId } : {}),
    };
    const rows = await tenantDb().holidayCalendar.findMany({
      where,
      include: { _count: { select: { holidays: true } } },
      orderBy: [{ year: 'desc' }, { scope: 'asc' }, { name: 'asc' }],
      take: 2000,
    });
    const allowed: CalendarWithCount[] = [];
    for (const c of rows) if (await visible(c)) allowed.push(c);
    const start = (query.page - 1) * query.pageSize;
    return {
      items: allowed.slice(start, start + query.pageSize).map(toCalendarDto),
      total: allowed.length,
    };
  },

  async get(id: string): Promise<HolidayCalendarDetailDto> {
    const c = await load(id);
    const holidays = await tenantDb().holiday.findMany({
      where: { calendarId: id },
      orderBy: { date: 'asc' },
    });
    return {
      ...toCalendarDto({ ...c, _count: { holidays: holidays.length } }),
      holidays: holidays.map(toHolidayDto),
    };
  },

  async create(input: CreateHolidayCalendarInput) {
    if (input.scope !== 'ORGANIZATION' && !input.targetId) {
      throw new ValidationError('targetId is required for this scope', {
        fields: [{ path: 'targetId', message: 'Required' }],
      });
    }
    const target = await resolveScopeTarget(
      (input.scope === 'ORGANIZATION'
        ? { type: 'ORGANIZATION' }
        : { type: input.scope, id: input.targetId as string }) as Parameters<
        typeof resolveScopeTarget
      >[0],
    );
    await authorize(currentPrincipal(), 'holiday.manage', scopeAsResource(target));
    const scopeKey = input.scope === 'ORGANIZATION' ? 'ORG' : (input.targetId as string);
    const db = tenantDb();
    if (await db.holidayCalendar.findFirst({ where: { scopeKey, year: input.year } })) {
      throw new ConflictError('A holiday calendar already exists for this level and year');
    }
    const c = await db.holidayCalendar.create({
      data: withTenant({
        scope: input.scope,
        scopeKey,
        groupId: target.groupId,
        institutionId: target.institutionId,
        campusId: target.campusId,
        year: input.year,
        name: input.name,
        weeklyOffs: input.weeklyOffs ? (input.weeklyOffs as Prisma.InputJsonValue) : DbNull,
      }),
    });
    await audit.record({
      action: 'holiday_calendar.create',
      entityType: 'holiday_calendar',
      entityId: c.id,
      after: calendarAudit(c),
    });
    return toCalendarDto(c);
  },

  async update(id: string, input: UpdateHolidayCalendarInput) {
    const before = await loadForManage(id);
    const after = await tenantDb().holidayCalendar.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.weeklyOffs !== undefined
          ? {
              weeklyOffs: input.weeklyOffs ? (input.weeklyOffs as Prisma.InputJsonValue) : DbNull,
            }
          : {}),
      },
    });
    await audit.record({
      action: 'holiday_calendar.update',
      entityType: 'holiday_calendar',
      entityId: id,
      before: calendarAudit(before),
      after: calendarAudit(after),
    });
    return toCalendarDto(after);
  },

  async remove(id: string) {
    const before = await loadForManage(id);
    await tenantDb().holiday.deleteMany({ where: { calendarId: id } });
    await tenantDb().holidayCalendar.delete({ where: { id } });
    await audit.record({
      action: 'holiday_calendar.delete',
      entityType: 'holiday_calendar',
      entityId: id,
      before: calendarAudit(before),
    });
  },

  /** Add or replace the entry for a date (`removed: true` suppresses an inherited holiday). */
  async upsertHoliday(calendarId: string, input: UpsertHolidayInput) {
    const c = await loadForManage(calendarId);
    if (Number(input.date.slice(0, 4)) !== c.year) {
      throw new ValidationError('Holiday date must fall in the calendar year', {
        fields: [{ path: 'date', message: `Expected a date in ${c.year}` }],
      });
    }
    const db = tenantDb();
    const existing = await db.holiday.findFirst({
      where: { calendarId, date: strToDate(input.date) },
    });
    const data = { name: input.name, type: input.type, removed: input.removed };
    const h = existing
      ? await db.holiday.update({ where: { id: existing.id }, data })
      : await db.holiday.create({
          data: withTenant({ calendarId, date: strToDate(input.date), ...data }),
        });
    await audit.record({
      action: existing ? 'holiday.update' : 'holiday.create',
      entityType: 'holiday_calendar',
      entityId: calendarId,
      before: existing ? toHolidayDto(existing) : null,
      after: toHolidayDto(h),
    });
    return toHolidayDto(h);
  },

  async removeHoliday(calendarId: string, holidayId: string) {
    await loadForManage(calendarId);
    const h = await tenantDb().holiday.findFirst({ where: { id: holidayId, calendarId } });
    if (!h) throw new NotFoundError('Holiday');
    await tenantDb().holiday.delete({ where: { id: h.id } });
    await audit.record({
      action: 'holiday.delete',
      entityType: 'holiday_calendar',
      entityId: calendarId,
      before: toHolidayDto(h),
    });
  },

  /** Holidays / weekly offs of an employee for a range, per date-correct assignment. */
  async resolveForEmployee(employeeId: string, from: string, to: string) {
    await loadEmployeeWith(employeeId, 'holiday.view', 'attendance.view_own');
    return resolveDaysForEmployee(employeeId, from, to);
  },
};

/**
 * Non-working (and optional) days of an employee in [from, to]: each date uses the employee's
 * as-of institution / campus calendar chain and the as-of shift's weekly offs (if the shift
 * defines its own pattern). Dates without an assignment are skipped.
 */
export async function resolveDaysForEmployee(
  employeeId: string,
  from: string,
  to: string,
  ctx: AttendanceContext = new AttendanceContext(),
): Promise<ResolvedDayDto[]> {
  const timeline = await ctx.timeline(employeeId);
  if (!timeline) return [];
  const out: ResolvedDayDto[] = [];
  for (const date of eachDate(from, to)) {
    const coords = timeline.at(date);
    if (!coords) continue;
    const day = await ctx.holidays.resolve(coords, date);
    const shift = await ctx.shifts.resolve(employeeId, coords, date);
    const shiftOffs = shiftWeeklyOffs(shift.shift);
    if (day.holiday) {
      out.push({
        date,
        institutionId: coords.institutionId,
        kind: 'HOLIDAY',
        name: day.holiday.name,
        calendarId: day.holiday.calendarId,
      });
    } else if (shiftOffs ? isWeeklyOff(shiftOffs, date) : day.weeklyOff) {
      out.push({
        date,
        institutionId: coords.institutionId,
        kind: 'WEEKLY_OFF',
        name: 'Weekly off',
        calendarId: shiftOffs ? null : day.weeklyOffCalendarId,
      });
    }
    if (day.optional) {
      out.push({
        date,
        institutionId: coords.institutionId,
        kind: day.optional.type === 'RESTRICTED' ? 'RESTRICTED' : 'OPTIONAL',
        name: day.optional.name,
        calendarId: day.optional.calendarId,
      });
    }
  }
  return out;
}
