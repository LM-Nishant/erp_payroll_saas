import type { WeeklyOffRule } from '@erp/shared';
import type { Shift, ShiftAssignment } from '@prisma/client';
import { tenantDb } from '../../core/tenancy';
import type { ShiftTimes } from '../attendance/attendance.engine';
import { rotationIndex } from '../attendance/attendance.engine';
import { dateToStr, daysBetween } from '../attendance/time';

/*
 * Shift resolution for an employee on a date (Layer 7):
 *   1. the employee's own assignment active that day (latest effectiveFrom wins);
 *   2. else the assignment of the employee's as-of department;
 *   3. else the institution's active default shift (`isDefault`);
 *   4. else none (attendance uses 4h / 8h half / full-day thresholds, no lateness).
 * Assignments with `rotationShiftIds` cycle through those shifts every `rotationDays` days
 * counted from `effectiveFrom`.
 */

export type ShiftSource = 'EMPLOYEE' | 'DEPARTMENT' | 'INSTITUTION_DEFAULT' | 'NONE';

export interface ResolvedShift {
  shift: Shift | null;
  source: ShiftSource;
  assignmentId: string | null;
}

export const shiftTimes = (s: Shift): ShiftTimes => ({
  startMinute: s.startMinute,
  endMinute: s.endMinute,
  crossesMidnight: s.crossesMidnight,
  graceInMinutes: s.graceInMinutes,
  graceOutMinutes: s.graceOutMinutes,
  breakMinutes: s.breakMinutes,
  halfDayMinutes: s.halfDayMinutes,
  fullDayMinutes: s.fullDayMinutes,
  overtimeAfterMinutes: s.overtimeAfterMinutes,
});

export const shiftWeeklyOffs = (s: Shift | null): WeeklyOffRule[] | null =>
  s && Array.isArray(s.weeklyOffs) ? (s.weeklyOffs as unknown as WeeklyOffRule[]) : null;

const activeOn = (a: ShiftAssignment, date: string) =>
  dateToStr(a.effectiveFrom) <= date && (!a.effectiveTo || dateToStr(a.effectiveTo) >= date);

/** Request-scoped resolver with caches (shifts and department assignments are small masters). */
export class ShiftResolver {
  private shifts?: Promise<Map<string, Shift>>;
  private departmentAssignments?: Promise<ShiftAssignment[]>;
  private employeeAssignments = new Map<string, Promise<ShiftAssignment[]>>();

  private allShifts() {
    this.shifts ??= tenantDb()
      .shift.findMany()
      .then((rows) => new Map(rows.map((s) => [s.id, s])));
    return this.shifts;
  }

  private forDepartments() {
    this.departmentAssignments ??= tenantDb().shiftAssignment.findMany({
      where: { departmentId: { not: null } },
      orderBy: { effectiveFrom: 'desc' },
    });
    return this.departmentAssignments;
  }

  private forEmployee(employeeId: string) {
    let rows = this.employeeAssignments.get(employeeId);
    if (!rows) {
      rows = tenantDb().shiftAssignment.findMany({
        where: { employeeId },
        orderBy: { effectiveFrom: 'desc' },
      });
      this.employeeAssignments.set(employeeId, rows);
    }
    return rows;
  }

  async shift(id: string): Promise<Shift | null> {
    return (await this.allShifts()).get(id) ?? null;
  }

  private async pick(a: ShiftAssignment, date: string): Promise<Shift | null> {
    const rotation = Array.isArray(a.rotationShiftIds) ? (a.rotationShiftIds as string[]) : null;
    if (rotation && rotation.length > 0) {
      const idx = rotationIndex(
        daysBetween(dateToStr(a.effectiveFrom), date),
        a.rotationDays ?? 1,
        rotation.length,
      );
      return this.shift(rotation[idx] ?? a.shiftId);
    }
    return this.shift(a.shiftId);
  }

  async resolve(
    employeeId: string,
    coords: { institutionId: string; departmentId: string | null } | null,
    date: string,
  ): Promise<ResolvedShift> {
    const own = (await this.forEmployee(employeeId)).find((a) => activeOn(a, date));
    if (own) return { shift: await this.pick(own, date), source: 'EMPLOYEE', assignmentId: own.id };
    if (!coords) return { shift: null, source: 'NONE', assignmentId: null };
    if (coords.departmentId) {
      const dept = (await this.forDepartments()).find(
        (a) => a.departmentId === coords.departmentId && activeOn(a, date),
      );
      if (dept) {
        return { shift: await this.pick(dept, date), source: 'DEPARTMENT', assignmentId: dept.id };
      }
    }
    const fallback = [...(await this.allShifts()).values()].find(
      (s) => s.institutionId === coords.institutionId && s.isDefault && s.status === 'ACTIVE',
    );
    return fallback
      ? { shift: fallback, source: 'INSTITUTION_DEFAULT', assignmentId: null }
      : { shift: null, source: 'NONE', assignmentId: null };
  }
}
