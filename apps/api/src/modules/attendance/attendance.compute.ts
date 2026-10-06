import type { AttendanceStatus } from '@erp/shared';
import type { AttendancePunch, AttendanceRecord, Prisma } from '@prisma/client';
import { tenantDb, withTenant } from '../../core/tenancy';
import { shiftTimes, shiftWeeklyOffs } from '../shifts/shifts.resolver';
import { computeDay, type DayLeave } from './attendance.engine';
import { AttendanceContext } from './attendance.context';
import {
  dateToStr,
  eachDate,
  isWeeklyOff,
  localToday,
  minutesFromLocalMidnight,
  strToDate,
} from './time';

/*
 * Daily attendance computation: combines punches + resolved shift + holiday calendar + approved
 * leave (+ HR override / approved regularization) into one `attendance_records` row per
 * employee per processed date. Idempotent — safe to re-run any time (recompute job, after a
 * punch, leave decision or regularization). Never touches dates inside a LOCKED period, never
 * persists future dates, and removes rows outside the employment window.
 */

/** Employees whose attendance is computed (historical exits keep their records). */
export const COMPUTABLE_STATUSES = ['ACTIVE', 'ON_NOTICE', 'EXITED'] as const;

export interface ComputeResult {
  computed: number;
  skippedLocked: number;
  removed: number;
}

/** Approved leave per date for an employee, from the stored day breakdowns. */
export async function approvedLeaveByDate(
  employeeId: string,
  from: string,
  to: string,
): Promise<Map<string, DayLeave>> {
  const rows = await tenantDb().leaveRequest.findMany({
    where: {
      employeeId,
      status: 'APPROVED',
      fromDate: { lte: strToDate(to) },
      toDate: { gte: strToDate(from) },
    },
    include: { leaveType: { select: { isPaid: true } } },
  });
  const map = new Map<string, DayLeave>();
  for (const r of rows) {
    for (const d of r.breakdown as { date: string; days: number }[]) {
      if (d.days <= 0 || d.date < from || d.date > to) continue;
      const prev = map.get(d.date);
      map.set(d.date, {
        days: Math.min(1, d.days + (prev?.days ?? 0)),
        isPaid: r.leaveType.isPaid,
        leaveTypeId: r.leaveTypeId,
        leaveRequestId: r.id,
      });
    }
  }
  return map;
}

const num = (d: Prisma.Decimal | number) => Number(d);

export async function computeAttendance(
  employeeIds: string[],
  from: string,
  to: string,
  ctx: AttendanceContext = new AttendanceContext(),
): Promise<ComputeResult> {
  const result: ComputeResult = { computed: 0, skippedLocked: 0, removed: 0 };
  const db = tenantDb();
  await ctx.preload(employeeIds);
  for (const employeeId of employeeIds) {
    const timeline = await ctx.timeline(employeeId);
    if (!timeline) continue;
    if (!(COMPUTABLE_STATUSES as readonly string[]).includes(timeline.employee.status)) continue;
    // Punches are attributed to their shift day on insert; widen by a day for safety.
    const [punches, leaves, existing] = await Promise.all([
      db.attendancePunch.findMany({
        where: {
          employeeId,
          attendanceDate: { gte: strToDate(from), lte: strToDate(to) },
        },
        orderBy: { punchedAt: 'asc' },
      }),
      approvedLeaveByDate(employeeId, from, to),
      db.attendanceRecord.findMany({
        where: { employeeId, date: { gte: strToDate(from), lte: strToDate(to) } },
      }),
    ]);
    const punchesByDate = new Map<string, AttendancePunch[]>();
    for (const p of punches) {
      const key = dateToStr(p.attendanceDate);
      punchesByDate.set(key, [...(punchesByDate.get(key) ?? []), p]);
    }
    const existingByDate = new Map<string, AttendanceRecord>(
      existing.map((r) => [dateToStr(r.date), r]),
    );

    for (const date of eachDate(from, to)) {
      const record = existingByDate.get(date);
      const coords = timeline.at(date);
      const recordLock = record ? await ctx.lockFor(record.institutionId, date) : null;
      if (recordLock) {
        result.skippedLocked += 1;
        continue;
      }
      const tz = coords ? await ctx.timezone(coords.institutionId) : null;
      if (!coords || !timeline.employedOn(date) || !tz || date > localToday(tz)) {
        if (record) {
          await db.attendanceRecord.delete({ where: { id: record.id } });
          result.removed += 1;
        }
        continue;
      }
      if (await ctx.lockFor(coords.institutionId, date)) {
        result.skippedLocked += 1;
        continue;
      }
      const resolved = await ctx.shifts.resolve(employeeId, coords, date);
      const calendar = await ctx.holidays.resolve(coords, date);
      const shiftOffs = shiftWeeklyOffs(resolved.shift);
      const weeklyOff = shiftOffs ? isWeeklyOff(shiftOffs, date) : calendar.weeklyOff;
      const dayPunches = punchesByDate.get(date) ?? [];
      const leave = leaves.get(date) ?? null;
      const outcome = computeDay({
        shift: resolved.shift ? shiftTimes(resolved.shift) : null,
        punchMinutes: dayPunches.map((p) => minutesFromLocalMidnight(p.punchedAt, date, tz)),
        holidayName: calendar.holiday?.name ?? null,
        weeklyOff,
        leave,
        overrideStatus: (record?.overrideStatus as AttendanceStatus | null) ?? null,
      });
      const data = {
        groupId: coords.groupId,
        institutionId: coords.institutionId,
        campusId: coords.campusId,
        departmentId: coords.departmentId,
        shiftId: resolved.shift?.id ?? null,
        status: outcome.status,
        firstIn: dayPunches[0]?.punchedAt ?? null,
        lastOut:
          dayPunches.length > 1 ? (dayPunches[dayPunches.length - 1]?.punchedAt ?? null) : null,
        workedMinutes: outcome.workedMinutes,
        lateMinutes: outcome.lateMinutes,
        earlyExitMinutes: outcome.earlyExitMinutes,
        overtimeMinutes: outcome.overtimeMinutes,
        isLate: outcome.isLate,
        missingPunch: outcome.missingPunch,
        presentDays: outcome.presentDays,
        paidLeaveDays: outcome.paidLeaveDays,
        unpaidLeaveDays: outcome.unpaidLeaveDays,
        absentDays: outcome.absentDays,
        offDays: outcome.offDays,
        leaveTypeId: leave?.leaveTypeId ?? null,
        leaveRequestId: leave?.leaveRequestId ?? null,
        holidayName: calendar.holiday?.name ?? null,
        computedAt: new Date(),
      };
      if (record) {
        await db.attendanceRecord.update({ where: { id: record.id }, data });
      } else {
        await db.attendanceRecord.create({
          data: withTenant({ employeeId, date: strToDate(date), ...data }),
        });
      }
      result.computed += 1;
    }
  }
  return result;
}

/** Ids of employees with a primary assignment in `institutionId` overlapping [from, to]. */
export async function employeeIdsInInstitution(
  institutionId: string,
  from: string,
  to: string,
): Promise<string[]> {
  const rows = await tenantDb().employeeDepartment.findMany({
    where: {
      institutionId,
      isPrimary: true,
      effectiveFrom: { lte: strToDate(to) },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: strToDate(from) } }],
    },
    select: { employeeId: true },
  });
  return [...new Set(rows.map((r) => r.employeeId))];
}

export const recordWeights = (r: AttendanceRecord) => ({
  presentDays: num(r.presentDays),
  paidLeaveDays: num(r.paidLeaveDays),
  unpaidLeaveDays: num(r.unpaidLeaveDays),
  absentDays: num(r.absentDays),
  offDays: num(r.offDays),
});
