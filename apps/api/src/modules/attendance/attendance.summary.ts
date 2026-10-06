import type { AttendanceSummaryDto, AttendanceSummaryQuery } from '@erp/shared';
import type { AttendanceRecord, Prisma } from '@prisma/client';
import {
  andScope,
  authorize,
  currentPrincipal,
  hierarchyResource,
  scopeWhere,
} from '../../core/authz';
import { InvalidReferenceError } from '../../core/http/errors';
import { tenantDb } from '../../core/tenancy';
import { institutionResource, loadEmployeeWith } from './attendance.access';
import { computeAttendance, recordWeights } from './attendance.compute';
import { AttendanceContext } from './attendance.context';
import { dateToStr, eachDate, round2, strToDate } from './time';

/*
 * Payroll feed (Layer 7 → Layer 8). `attendanceSummaryForPeriod` is the single, stable contract
 * payroll consumes; see docs/ARCHITECTURE.md "Payroll feed". It recomputes every non-locked day of
 * the period (locked days are frozen), then aggregates the per-day weights of the employment window.
 * Every employed, processed day contributes exactly 1 day split across
 * present / paid leave / unpaid leave / absent / off, so
 *   processedDays = present + paidLeave + unpaidLeave + absent + holidays + weeklyOffs
 *   payableDays   = present + paidLeave + holidays + weeklyOffs
 *                   + (absentIsLop ? 0 : absent) − lateDeduction
 *   lopDays       = unpaidLeave + (absentIsLop ? absent : 0) + lateDeduction
 * where lateDeduction = floor(lateCount / policy.lateMarksPerHalfDay) × 0.5 (0 when unset), capped
 * at presentDays. The policy is the attendance policy of the institution the employee belongs to
 * at the end of the period (last employed day).
 */

/** Who to summarise: one employee, or every employee assigned to an institution / department. */
export type SummaryTarget =
  string | { employeeIds: string[] } | { institutionId: string; departmentId?: string | null };

async function targetEmployeeIds(target: SummaryTarget, from: string, to: string) {
  if (typeof target === 'string') return [target];
  if ('employeeIds' in target) return [...new Set(target.employeeIds)];
  const rows = await tenantDb().employeeDepartment.findMany({
    where: {
      institutionId: target.institutionId,
      ...(target.departmentId ? { departmentId: target.departmentId } : {}),
      isPrimary: true,
      effectiveFrom: { lte: strToDate(to) },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: strToDate(from) } }],
    },
    select: { employeeId: true },
  });
  return [...new Set(rows.map((r) => r.employeeId))];
}

/**
 * Attendance summary for payroll. No authorization: callers (payroll engine, jobs) run in a
 * tenant context and decide access themselves. Use `attendanceSummaryService.summary` for HTTP.
 */
export async function attendanceSummaryForPeriod(
  target: SummaryTarget,
  periodStart: string,
  periodEnd: string,
  ctx: AttendanceContext = new AttendanceContext(),
): Promise<AttendanceSummaryDto[]> {
  const ids = await targetEmployeeIds(target, periodStart, periodEnd);
  if (ids.length === 0) return [];
  await computeAttendance(ids, periodStart, periodEnd, ctx);
  const db = tenantDb();
  const [records, leaveTypes] = await Promise.all([
    db.attendanceRecord.findMany({
      where: {
        employeeId: { in: ids },
        date: { gte: strToDate(periodStart), lte: strToDate(periodEnd) },
      },
      orderBy: { date: 'asc' },
    }),
    db.leaveType.findMany({ select: { id: true, code: true } }),
  ]);
  const codes = new Map(leaveTypes.map((t) => [t.id, t.code]));
  const byEmployee = new Map<string, AttendanceRecord[]>();
  for (const r of records) {
    const list = byEmployee.get(r.employeeId) ?? [];
    list.push(r);
    byEmployee.set(r.employeeId, list);
  }
  const days = eachDate(periodStart, periodEnd);
  const out: AttendanceSummaryDto[] = [];
  for (const id of ids) {
    const timeline = await ctx.timeline(id);
    if (!timeline) continue;
    const employed = days.filter((d) => timeline.employedOn(d));
    if (employed.length === 0 && typeof target !== 'string') continue;
    const recs = (byEmployee.get(id) ?? []).filter((r) => timeline.employedOn(dateToStr(r.date)));
    const s = {
      present: 0,
      onDuty: 0,
      paid: 0,
      unpaid: 0,
      absent: 0,
      holidays: 0,
      weeklyOffs: 0,
      late: 0,
      early: 0,
      overtime: 0,
    };
    const paidByType = new Map<string, number>();
    const perInstitution = new Map<string, number>();
    let lockedDays = 0;
    for (const r of recs) {
      const w = recordWeights(r);
      s.present += w.presentDays;
      s.paid += w.paidLeaveDays;
      s.unpaid += w.unpaidLeaveDays;
      s.absent += w.absentDays;
      if (r.status === 'HOLIDAY') s.holidays += w.offDays;
      else s.weeklyOffs += w.offDays;
      if (r.status === 'ON_DUTY') s.onDuty += 1;
      if (r.isLate && w.presentDays > 0) s.late += 1;
      if (r.earlyExitMinutes > 0 && w.presentDays > 0) s.early += 1;
      s.overtime += r.overtimeMinutes;
      if (w.paidLeaveDays > 0 && r.leaveTypeId) {
        paidByType.set(r.leaveTypeId, (paidByType.get(r.leaveTypeId) ?? 0) + w.paidLeaveDays);
      }
      perInstitution.set(r.institutionId, (perInstitution.get(r.institutionId) ?? 0) + 1);
      if (await ctx.lockFor(r.institutionId, dateToStr(r.date))) lockedDays += 1;
    }
    const lastDay = employed[employed.length - 1];
    const policyInstitution =
      (lastDay ? timeline.at(lastDay)?.institutionId : undefined) ??
      timeline.employee.institutionId;
    const policy = await ctx.policy(policyInstitution);
    const lateDeduction = policy.lateMarksPerHalfDay
      ? Math.min(Math.floor(s.late / policy.lateMarksPerHalfDay) * 0.5, s.present)
      : 0;
    const absentLop = policy.absentIsLop ? s.absent : 0;
    out.push({
      employeeId: id,
      employeeCode: timeline.employee.employeeCode,
      periodStart,
      periodEnd,
      calendarDays: days.length,
      employedDays: employed.length,
      pendingDays: employed.length - recs.length,
      payableDays: round2(
        s.present + s.paid + s.holidays + s.weeklyOffs + (s.absent - absentLop) - lateDeduction,
      ),
      presentDays: round2(s.present),
      onDutyDays: s.onDuty,
      paidLeaveDays: round2(s.paid),
      paidLeaveByType: [...paidByType.entries()].map(([leaveTypeId, d]) => ({
        leaveTypeId,
        code: codes.get(leaveTypeId) ?? leaveTypeId,
        days: round2(d),
      })),
      unpaidLeaveDays: round2(s.unpaid),
      absentDays: round2(s.absent),
      lateDeductionDays: lateDeduction,
      lopDays: round2(s.unpaid + absentLop + lateDeduction),
      holidays: round2(s.holidays),
      weeklyOffs: round2(s.weeklyOffs),
      lateCount: s.late,
      earlyExitCount: s.early,
      overtimeMinutes: s.overtime,
      overtimeHours: round2(s.overtime / 60),
      locked: employed.length > 0 && lockedDays === employed.length,
      institutionDays: [...perInstitution.entries()].map(([institutionId, d]) => ({
        institutionId,
        days: d,
      })),
    });
  }
  return out;
}

export const attendanceSummaryService = {
  /** HTTP: one employee (`attendance.view` on them, or own with `attendance.view_own`) or a unit. */
  async summary(query: AttendanceSummaryQuery): Promise<AttendanceSummaryDto[]> {
    const principal = currentPrincipal();
    if (query.employeeId) {
      await loadEmployeeWith(query.employeeId, 'attendance.view', 'attendance.view_own');
      return attendanceSummaryForPeriod(query.employeeId, query.from, query.to);
    }
    if (query.departmentId) {
      const d = await tenantDb().department.findFirst({ where: { id: query.departmentId } });
      if (!d) throw new InvalidReferenceError('departmentId', 'Department');
      await authorize(principal, 'attendance.view', hierarchyResource.department(d));
      return attendanceSummaryForPeriod(
        { institutionId: d.institutionId, departmentId: d.id },
        query.from,
        query.to,
      );
    }
    if (query.institutionId) {
      await authorize(principal, 'attendance.view', await institutionResource(query.institutionId));
      return attendanceSummaryForPeriod(
        { institutionId: query.institutionId },
        query.from,
        query.to,
      );
    }
    const rows = await tenantDb().employee.findMany({
      where: andScope<Prisma.EmployeeWhereInput>(
        { status: { in: ['ACTIVE', 'ON_NOTICE', 'EXITED'] } },
        await scopeWhere(principal, 'attendance.view', 'employee'),
      ),
      select: { id: true },
      take: 2000,
    });
    return attendanceSummaryForPeriod({ employeeIds: rows.map((r) => r.id) }, query.from, query.to);
  },
};
