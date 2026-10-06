import type { AttendancePolicyDto, EmploymentType } from '@erp/shared';
import type { AttendancePeriodLock, AttendancePolicy, Employee } from '@prisma/client';
import { AppError } from '../../core/http/errors';
import { tenantDb } from '../../core/tenancy';
import { HolidayResolver } from '../holidays/holidays.resolver';
import { ShiftResolver } from '../shifts/shifts.resolver';
import { dateToStr } from './time';

/*
 * Request-scoped context shared by the attendance / leave / summary services: employee
 * assignment timelines (date-correct institution / department / employment type — a transferred
 * employee uses the right calendar, shift and policy on each date), attendance policies, period
 * locks and the holiday / shift resolvers, all cached for the lifetime of one operation.
 */

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

export interface Coordinates {
  groupId: string | null;
  institutionId: string;
  campusId: string | null;
  departmentId: string | null;
  employmentType: EmploymentType | null;
}

interface Slice<T> {
  from: string;
  to: string | null;
  value: T;
}

const sliceAt = <T>(slices: Slice<T>[], date: string): T | null => {
  let best: Slice<T> | null = null;
  for (const s of slices) {
    if (s.from <= date && (!s.to || s.to >= date) && (!best || s.from > best.from)) best = s;
  }
  return best ? best.value : null;
};

/** Effective-dated assignment history of one employee (from the Layer 6 history tables). */
export class EmployeeTimeline {
  constructor(
    readonly employee: Employee,
    private departments: Slice<Omit<Coordinates, 'employmentType'>>[],
    private positions: Slice<EmploymentType | null>[],
  ) {}

  /** Assignment on `date` (null before joining / after the history ends). */
  at(date: string): Coordinates | null {
    const dept = sliceAt(this.departments, date);
    if (!dept) return null;
    return { ...dept, employmentType: sliceAt(this.positions, date) };
  }

  /** Within joining date .. last working day / exit date, with an assignment. */
  employedOn(date: string): boolean {
    const e = this.employee;
    if (e.dateOfJoining && date < dateToStr(e.dateOfJoining)) return false;
    const end = e.lastWorkingDate ?? e.exitDate;
    if (end && date > dateToStr(end)) return false;
    return this.at(date) !== null;
  }
}

export const policyDto = (
  institutionId: string,
  p: AttendancePolicy | null | undefined,
): AttendancePolicyDto => ({
  institutionId,
  timezone: p?.timezone ?? DEFAULT_TIMEZONE,
  lateMarksPerHalfDay: p?.lateMarksPerHalfDay ?? null,
  absentIsLop: p?.absentIsLop ?? true,
  allowWebPunch: p?.allowWebPunch ?? true,
  allowMobilePunch: p?.allowMobilePunch ?? true,
  isDefault: !p,
});

export class AttendanceContext {
  readonly holidays = new HolidayResolver();
  readonly shifts = new ShiftResolver();
  private timelines = new Map<string, Promise<EmployeeTimeline | null>>();
  private policies?: Promise<Map<string, AttendancePolicy>>;
  private locks?: Promise<AttendancePeriodLock[]>;

  /** Pre-load timelines of many employees with three queries. */
  async preload(employeeIds: string[]): Promise<void> {
    const missing = employeeIds.filter((id) => !this.timelines.has(id));
    if (missing.length === 0) return;
    const db = tenantDb();
    const loading = Promise.all([
      db.employee.findMany({ where: { id: { in: missing } } }),
      db.employeeDepartment.findMany({ where: { employeeId: { in: missing }, isPrimary: true } }),
      db.employeePosition.findMany({ where: { employeeId: { in: missing } } }),
    ]);
    for (const id of missing) {
      this.timelines.set(
        id,
        loading.then(([employees, departments, positions]) => {
          const employee = employees.find((e) => e.id === id);
          if (!employee) return null;
          return new EmployeeTimeline(
            employee,
            departments
              .filter((d) => d.employeeId === id)
              .map((d) => ({
                from: dateToStr(d.effectiveFrom),
                to: d.effectiveTo ? dateToStr(d.effectiveTo) : null,
                value: {
                  groupId: d.groupId,
                  institutionId: d.institutionId,
                  campusId: d.campusId,
                  departmentId: d.departmentId,
                },
              })),
            positions
              .filter((p) => p.employeeId === id)
              .map((p) => ({
                from: dateToStr(p.effectiveFrom),
                to: p.effectiveTo ? dateToStr(p.effectiveTo) : null,
                value: p.employmentType,
              })),
          );
        }),
      );
    }
    await loading;
  }

  async timeline(employeeId: string): Promise<EmployeeTimeline | null> {
    await this.preload([employeeId]);
    return (await this.timelines.get(employeeId)) ?? null;
  }

  private allPolicies() {
    this.policies ??= tenantDb()
      .attendancePolicy.findMany()
      .then((rows) => new Map(rows.map((p) => [p.institutionId, p])));
    return this.policies;
  }

  async policy(institutionId: string): Promise<AttendancePolicyDto> {
    return policyDto(institutionId, (await this.allPolicies()).get(institutionId));
  }

  async timezone(institutionId: string): Promise<string> {
    return (await this.policy(institutionId)).timezone;
  }

  private activeLocks() {
    this.locks ??= tenantDb().attendancePeriodLock.findMany({ where: { status: 'LOCKED' } });
    return this.locks;
  }

  async lockFor(institutionId: string, date: string): Promise<AttendancePeriodLock | null> {
    return (
      (await this.activeLocks()).find(
        (l) =>
          l.institutionId === institutionId &&
          dateToStr(l.periodStart) <= date &&
          dateToStr(l.periodEnd) >= date,
      ) ?? null
    );
  }

  /** Throws 409 PERIOD_LOCKED when `date` lies in a locked period of the institution. */
  async assertUnlocked(institutionId: string, date: string): Promise<void> {
    const lock = await this.lockFor(institutionId, date);
    if (lock) {
      throw new AppError(
        409,
        'PERIOD_LOCKED',
        `Attendance for ${date} is locked (${dateToStr(lock.periodStart)} – ${dateToStr(
          lock.periodEnd,
        )}); unlock the period first`,
        { lockId: lock.id, date },
      );
    }
  }

  /** Invalidate cached locks (after lock / unlock in the same operation). */
  resetLocks(): void {
    this.locks = undefined;
  }
}
