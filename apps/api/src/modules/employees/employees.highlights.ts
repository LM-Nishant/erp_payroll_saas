import type { EmployeeHighlightsDto, HighlightLeaveDto, HighlightPersonDto } from '@erp/shared';
import { currentPrincipal, hasPermission, scopeWhere } from '../../core/authz';
import { ForbiddenError } from '../../core/http/errors';
import { tenantDb } from '../../core/tenancy';
import { addDays, dateToStr, localParts, strToDate } from '../attendance/time';

/*
 * Dashboard highlights: upcoming holidays, own / team leave, new joiners, work anniversaries and
 * birthdays. HR-type users (employee.view) see their permission scope; a plain employee sees the
 * colleagues of their own company. Only directory data is returned (name, designation, dates;
 * birthdays without the year).
 */

const WINDOW_DAYS = 30;
const LIMIT = 12;
const ACTIVE = ['ACTIVE', 'ON_NOTICE'] as const;

/** Next occurrence (>= today) of a month/day, as YYYY-MM-DD, or null if beyond the window. */
export function nextOccurrence(source: Date, today: string, end: string): string | null {
  const md = dateToStr(source).slice(5);
  const year = Number(today.slice(0, 4));
  for (const y of [year, year + 1]) {
    // 29 Feb in a non-leap year is celebrated on 28 Feb.
    let candidate = `${y}-${md}`;
    if (md === '02-29' && dateToStr(strToDate(candidate)).slice(5) !== '02-29') {
      candidate = `${y}-02-28`;
    }
    if (candidate >= today) return candidate <= end ? candidate : null;
  }
  return null;
}

export async function employeeHighlights(): Promise<EmployeeHighlightsDto> {
  const principal = currentPrincipal();
  const db = tenantDb();
  const own = principal.userId
    ? await db.employee.findFirst({ where: { userId: principal.userId } })
    : null;

  let visibility: Record<string, unknown>;
  if (hasPermission(principal, 'employee.view')) {
    visibility = (await scopeWhere(principal, 'employee.view', 'employee')) ?? {};
  } else if (own) {
    visibility = { institutionId: own.institutionId };
  } else {
    throw new ForbiddenError('Your login is not linked to an employee record');
  }

  const today = localParts(new Date(), 'Asia/Kolkata').date;
  const end = addDays(today, WINDOW_DAYS);
  const people = await db.employee.findMany({
    where: { AND: [visibility, { status: { in: [...ACTIVE] } }] },
    select: {
      id: true,
      displayName: true,
      dateOfJoining: true,
      designation: { select: { name: true } },
      department: { select: { name: true } },
      institution: { select: { name: true } },
      profile: { select: { dateOfBirth: true } },
    },
  });
  const person = (p: (typeof people)[number], date: string): HighlightPersonDto => ({
    employeeId: p.id,
    name: p.displayName,
    designation: p.designation?.name ?? null,
    department: p.department?.name ?? null,
    institution: p.institution?.name ?? null,
    date,
  });

  const newJoiners = people
    .filter((p) => p.dateOfJoining && dateToStr(p.dateOfJoining) >= addDays(today, -WINDOW_DAYS))
    .filter((p) => dateToStr(p.dateOfJoining!) <= end)
    .map((p) => person(p, dateToStr(p.dateOfJoining!)))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, LIMIT);

  const workAnniversaries: HighlightPersonDto[] = [];
  const birthdays: HighlightPersonDto[] = [];
  for (const p of people) {
    if (p.dateOfJoining) {
      const date = nextOccurrence(p.dateOfJoining, today, end);
      const years = date ? Number(date.slice(0, 4)) - p.dateOfJoining.getUTCFullYear() : 0;
      if (date && years >= 1) workAnniversaries.push({ ...person(p, date), years });
    }
    if (p.profile?.dateOfBirth) {
      const date = nextOccurrence(p.profile.dateOfBirth, today, end);
      if (date) birthdays.push(person(p, date));
    }
  }
  const byDate = (a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date);

  // Holidays: own calendar chain (campus → institution → group → org), else every visible one.
  const coords = own
    ? [own.campusId, own.institutionId, own.groupId, 'ORG'].filter((k): k is string => !!k)
    : null;
  const holidays = await db.holiday.findMany({
    where: {
      removed: false,
      date: { gte: strToDate(today), lte: strToDate(addDays(today, 120)) },
      ...(coords ? { calendar: { scopeKey: { in: coords } } } : {}),
    },
    orderBy: { date: 'asc' },
    take: 50,
  });
  const seen = new Set<string>();
  const upcomingHolidays = holidays
    .map((h) => ({ date: dateToStr(h.date), name: h.name, type: h.type }))
    .filter((h) => {
      const key = `${h.date}|${h.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);

  const leaveRows = await db.leaveRequest.findMany({
    where: {
      status: { in: ['APPROVED', 'PENDING_APPROVAL'] },
      toDate: { gte: strToDate(today) },
      fromDate: { lte: strToDate(end) },
      OR: [{ employeeId: own?.id ?? '-' }, { employee: visibility, status: 'APPROVED' }],
    },
    include: {
      leaveType: { select: { name: true } },
      employee: { select: { displayName: true } },
    },
    orderBy: { fromDate: 'asc' },
    take: 200,
  });
  const leave = (l: (typeof leaveRows)[number]): HighlightLeaveDto => ({
    employeeId: l.employeeId,
    name: l.employee.displayName,
    leaveType: l.leaveType.name,
    fromDate: dateToStr(l.fromDate),
    toDate: dateToStr(l.toDate),
    days: Number(l.days),
    status: l.status,
  });
  const others = leaveRows.filter((l) => l.employeeId !== own?.id && l.status === 'APPROVED');

  return {
    asOf: today,
    headcount: people.length,
    upcomingHolidays,
    myUpcomingLeaves: leaveRows.filter((l) => l.employeeId === own?.id).map(leave),
    onLeaveToday: others
      .filter((l) => dateToStr(l.fromDate) <= today)
      .map(leave)
      .slice(0, LIMIT),
    upcomingTeamLeaves: others
      .filter((l) => dateToStr(l.fromDate) > today)
      .map(leave)
      .slice(0, LIMIT),
    newJoiners,
    workAnniversaries: workAnniversaries.sort(byDate).slice(0, LIMIT),
    birthdays: birthdays.sort(byDate).slice(0, LIMIT),
  };
}
