import type {
  AttendanceRegisterDto,
  MarkStudentAttendanceInput,
  OwnAttendanceDto,
  SectionAttendanceDto,
  StudentAttendanceStatus,
} from '@erp/shared';
import { audit } from '../../core/audit';
import { can, currentPrincipal } from '../../core/authz';
import { emit } from '../../core/events';
import { AppError, InvalidReferenceError } from '../../core/http/errors';
import { tenantDb, withTenant } from '../../core/tenancy';
import {
  assertSectionActor,
  dateOnly,
  guardianUserIds,
  loadSection,
  loadVisibleSection,
  notifyUsers,
  ownStudents,
  sectionCoords,
  sectionResource,
  toDate,
  todayIso,
} from './academics.access';
import {
  collapseDay,
  daysOfMonth,
  summarizeAttendance,
  withinEditWindow,
} from './attendance.logic';

/** Teachers may (re)mark attendance up to this many days back; managers any time. */
export const STUDENT_ATTENDANCE_EDIT_WINDOW_DAYS = 3;

async function sectionStudents(classSectionId: string) {
  return tenantDb().student.findMany({
    where: { classSectionId, status: 'ACTIVE' },
    select: { id: true, rollNo: true, displayName: true, admissionNo: true, userId: true },
    orderBy: [{ rollNo: 'asc' }, { displayName: 'asc' }],
  });
}

async function validatePeriod(periodId: string | null | undefined, institutionId: string) {
  if (!periodId) return null;
  const period = await tenantDb().bellPeriod.findUnique({ where: { id: periodId } });
  if (!period || period.institutionId !== institutionId) {
    throw new InvalidReferenceError('periodId', 'Bell period');
  }
  return period;
}

/** Map studentId → date → { daily, periods[] } for the given rows. */
function groupMarks(
  rows: { studentId: string; date: Date; periodKey: string; status: StudentAttendanceStatus }[],
) {
  const map = new Map<
    string,
    Map<string, { daily?: StudentAttendanceStatus; periods: StudentAttendanceStatus[] }>
  >();
  for (const r of rows) {
    const byDate = map.get(r.studentId) ?? new Map();
    const day = dateOnly(r.date);
    const cell = byDate.get(day) ?? { periods: [] };
    if (r.periodKey === '') cell.daily = r.status;
    else cell.periods.push(r.status);
    byDate.set(day, cell);
    map.set(r.studentId, byDate);
  }
  return map;
}

function dayStatuses(
  byDate:
    | Map<string, { daily?: StudentAttendanceStatus; periods: StudentAttendanceStatus[] }>
    | undefined,
  days?: string[],
) {
  const out: { date: string; status: StudentAttendanceStatus }[] = [];
  if (!byDate) return out;
  const keys = days ?? [...byDate.keys()].sort();
  for (const d of keys) {
    const cell = byDate.get(d);
    if (!cell) continue;
    const status = collapseDay(cell.daily, cell.periods);
    if (status) out.push({ date: d, status });
  }
  return out;
}

export const studentAttendanceService = {
  async sectionDay(query: {
    classSectionId: string;
    date: string;
    periodId?: string;
  }): Promise<SectionAttendanceDto> {
    const cs = await loadVisibleSection(query.classSectionId, 'student_attendance.view');
    await validatePeriod(query.periodId, cs.institutionId);
    const [students, marks] = await Promise.all([
      sectionStudents(cs.id),
      tenantDb().studentAttendance.findMany({
        where: {
          classSectionId: cs.id,
          date: toDate(query.date),
          periodKey: query.periodId ?? '',
        },
      }),
    ]);
    const byStudent = new Map(marks.map((m) => [m.studentId, m]));
    const manager = await can(currentPrincipal(), 'student_attendance.manage', sectionResource(cs));
    return {
      classSectionId: cs.id,
      date: query.date,
      periodId: query.periodId ?? null,
      editable:
        manager || withinEditWindow(query.date, todayIso(), STUDENT_ATTENDANCE_EDIT_WINDOW_DAYS),
      rows: students.map((s) => ({
        studentId: s.id,
        rollNo: s.rollNo,
        displayName: s.displayName,
        admissionNo: s.admissionNo,
        status: byStudent.get(s.id)?.status ?? null,
        remarks: byStudent.get(s.id)?.remarks ?? null,
      })),
    };
  },

  async mark(input: MarkStudentAttendanceInput) {
    const cs = await loadSection(input.classSectionId);
    const { manager } = await assertSectionActor(
      cs,
      'student_attendance.mark',
      'student_attendance.manage',
    );
    const today = todayIso();
    if (input.date > today) {
      throw new AppError(422, 'FUTURE_DATE', 'Attendance cannot be marked for a future date');
    }
    if (!manager && !withinEditWindow(input.date, today, STUDENT_ATTENDANCE_EDIT_WINDOW_DAYS)) {
      throw new AppError(
        422,
        'EDIT_WINDOW_CLOSED',
        `Attendance older than ${STUDENT_ATTENDANCE_EDIT_WINDOW_DAYS} days can only be changed by a manager`,
      );
    }
    const period = await validatePeriod(input.periodId, cs.institutionId);
    const students = await sectionStudents(cs.id);
    const known = new Map(students.map((s) => [s.id, s]));
    for (const r of input.records) {
      if (!known.has(r.studentId)) {
        throw new InvalidReferenceError('records.studentId', 'Student (of this section)');
      }
    }
    const date = toDate(input.date);
    const periodKey = period?.id ?? '';
    const userId = currentPrincipal().userId;
    const newlyAbsent: string[] = [];
    let created = 0;
    let updated = 0;
    await tenantDb().$transaction(async (tx) => {
      const existing = await tx.studentAttendance.findMany({
        where: {
          studentId: { in: input.records.map((r) => r.studentId) },
          date,
          periodKey,
        },
      });
      const byStudent = new Map(existing.map((e) => [e.studentId, e]));
      for (const r of input.records) {
        const prev = byStudent.get(r.studentId);
        if (r.status === 'ABSENT' && prev?.status !== 'ABSENT') newlyAbsent.push(r.studentId);
        if (prev) {
          if (prev.status === r.status && (prev.remarks ?? null) === (r.remarks ?? null)) continue;
          await tx.studentAttendance.update({
            where: { id: prev.id },
            data: { status: r.status, remarks: r.remarks ?? null, markedByUserId: userId },
          });
          updated++;
        } else {
          await tx.studentAttendance.create({
            data: withTenant({
              ...sectionCoords(cs),
              classSectionId: cs.id,
              studentId: r.studentId,
              date,
              periodId: period?.id ?? null,
              periodKey,
              status: r.status,
              remarks: r.remarks ?? null,
              markedByUserId: userId,
            }),
          });
          created++;
        }
      }
    });
    const summary = summarizeAttendance(input.records.map((r) => r.status));
    await audit.record({
      action: 'student_attendance.mark',
      entityType: 'class_section',
      entityId: cs.id,
      after: { date: input.date, periodId: period?.id ?? null, created, updated, summary },
    });
    await emit(
      'student_attendance.marked',
      { classSectionId: cs.id, date: input.date, periodId: period?.id ?? null, summary },
      { institutionId: cs.institutionId },
    );
    if (input.notifyGuardians && newlyAbsent.length) {
      const guardians = await guardianUserIds(newlyAbsent);
      for (const studentId of newlyAbsent) {
        const s = known.get(studentId)!;
        await notifyUsers('student_attendance.absent', guardians.get(studentId) ?? [], {
          title: `${s.displayName} was marked absent on ${input.date}`,
          body: period ? `Period: ${period.name}` : 'Daily attendance',
          link: '/portal/attendance',
          institutionId: cs.institutionId,
          data: { studentId, date: input.date, periodId: period?.id ?? null },
        });
      }
    }
    return { created, updated, absentNotified: input.notifyGuardians ? newlyAbsent.length : 0 };
  },

  async register(query: { classSectionId: string; month: string }): Promise<AttendanceRegisterDto> {
    const cs = await loadVisibleSection(query.classSectionId, 'student_attendance.view');
    const days = daysOfMonth(query.month);
    const [students, rows] = await Promise.all([
      sectionStudents(cs.id),
      tenantDb().studentAttendance.findMany({
        where: {
          classSectionId: cs.id,
          date: { gte: toDate(days[0]!), lte: toDate(days[days.length - 1]!) },
        },
        select: { studentId: true, date: true, periodKey: true, status: true },
      }),
    ]);
    const grouped = groupMarks(rows);
    const markedDays = days.filter((d) => [...grouped.values()].some((byDate) => byDate.has(d)));
    return {
      classSectionId: cs.id,
      month: query.month,
      days: markedDays,
      students: students.map((s) => {
        const statuses = dayStatuses(grouped.get(s.id), markedDays);
        return {
          studentId: s.id,
          rollNo: s.rollNo,
          displayName: s.displayName,
          marks: Object.fromEntries(statuses.map((x) => [x.date, x.status])),
          summary: summarizeAttendance(statuses.map((x) => x.status)),
        };
      }),
    };
  },

  /** Student / parent self-service: own (or a ward's) attendance for a month + overall %. */
  async own(query: { studentId?: string; month?: string }): Promise<OwnAttendanceDto> {
    const [student] = await ownStudents(query.studentId);
    const month = query.month ?? todayIso().slice(0, 7);
    const days = daysOfMonth(month);
    const rows = await tenantDb().studentAttendance.findMany({
      where: { studentId: student!.id },
      select: { studentId: true, date: true, periodKey: true, status: true },
    });
    const grouped = groupMarks(rows).get(student!.id);
    const monthDays = dayStatuses(grouped, days);
    const all = dayStatuses(grouped);
    return {
      student: { id: student!.id, displayName: student!.displayName },
      month,
      days: monthDays,
      summary: summarizeAttendance(monthDays.map((d) => d.status)),
      overall: summarizeAttendance(all.map((d) => d.status)),
    };
  },

  /** Attendance % of students over a date range (used by report cards). */
  async percentFor(studentIds: string[], from?: Date | null, to?: Date | null) {
    const rows = await tenantDb().studentAttendance.findMany({
      where: {
        studentId: { in: studentIds },
        ...(from || to
          ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
      },
      select: { studentId: true, date: true, periodKey: true, status: true },
    });
    const grouped = groupMarks(rows);
    return new Map(
      studentIds.map((id) => [
        id,
        summarizeAttendance(dayStatuses(grouped.get(id)).map((d) => d.status)).percentage,
      ]),
    );
  },
};
