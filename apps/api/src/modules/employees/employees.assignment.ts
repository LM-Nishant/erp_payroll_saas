import type { EmploymentType } from '@erp/shared';
import { AppError, InvalidReferenceError } from '../../core/http/errors';
import { tenantDb } from '../../core/tenancy';
import { toDate } from './employees.mappers';

/*
 * Assignment helpers shared by the employee services and later HR layers (attendance, leave,
 * payroll). Everything runs inside the current tenant context through tenantDb().
 */

export interface AssignmentInput {
  institutionId: string;
  campusId?: string | null;
  departmentId?: string | null;
  designationId?: string | null;
  reportingManagerId?: string | null;
}

export interface ResolvedAssignment {
  groupId: string | null;
  institutionId: string;
  campusId: string | null;
  departmentId: string | null;
  designationId: string | null;
  reportingManagerId: string | null;
}

/**
 * Validate an assignment inside the tenant: campus / department belong to the institution, the
 * designation is usable there, and the reporting manager exists, is not exited and does not
 * create a reporting cycle. Returns the assignment with the institution's group id.
 */
export async function resolveAssignment(
  input: AssignmentInput,
  employeeId?: string,
): Promise<ResolvedAssignment> {
  const db = tenantDb();
  const institution = await db.institution.findUnique({
    where: { id: input.institutionId },
    select: { id: true, groupId: true },
  });
  if (!institution) throw new InvalidReferenceError('institutionId', 'Institution');
  if (input.campusId) {
    const campus = await db.campus.findUnique({
      where: { id: input.campusId },
      select: { institutionId: true },
    });
    if (!campus || campus.institutionId !== institution.id) {
      throw new InvalidReferenceError('campusId', 'Campus');
    }
  }
  if (input.departmentId) {
    const department = await db.department.findUnique({
      where: { id: input.departmentId },
      select: { institutionId: true, campusId: true },
    });
    if (!department || department.institutionId !== institution.id) {
      throw new InvalidReferenceError('departmentId', 'Department');
    }
  }
  if (input.designationId) {
    const designation = await db.designation.findUnique({
      where: { id: input.designationId },
      select: { groupId: true, institutionId: true, status: true },
    });
    if (
      !designation ||
      designation.status !== 'ACTIVE' ||
      (designation.institutionId && designation.institutionId !== institution.id) ||
      (designation.groupId && designation.groupId !== institution.groupId)
    ) {
      throw new InvalidReferenceError('designationId', 'Designation');
    }
  }
  if (input.reportingManagerId) {
    await assertReportingManager(input.reportingManagerId, employeeId);
  }
  return {
    groupId: institution.groupId,
    institutionId: institution.id,
    campusId: input.campusId ?? null,
    departmentId: input.departmentId ?? null,
    designationId: input.designationId ?? null,
    reportingManagerId: input.reportingManagerId ?? null,
  };
}

async function assertReportingManager(managerId: string, employeeId?: string): Promise<void> {
  if (managerId === employeeId) {
    throw new AppError(422, 'REPORTING_CYCLE', 'An employee cannot report to themselves');
  }
  const db = tenantDb();
  const manager = await db.employee.findUnique({
    where: { id: managerId },
    select: { status: true },
  });
  if (!manager || manager.status === 'EXITED') {
    throw new InvalidReferenceError('reportingManagerId', 'Employee');
  }
  if (!employeeId) return;
  // Walk up from the new manager: reaching the employee would create a cycle.
  const seen = new Set<string>();
  let cursor: string | null = managerId;
  while (cursor && !seen.has(cursor)) {
    if (cursor === employeeId) {
      throw new AppError(
        422,
        'REPORTING_CYCLE',
        'Reporting manager would create a reporting cycle',
      );
    }
    seen.add(cursor);
    const row: { reportingManagerId: string | null } | null = await db.employee.findUnique({
      where: { id: cursor },
      select: { reportingManagerId: true },
    });
    cursor = row?.reportingManagerId ?? null;
  }
}

export async function assertDepartmentsInInstitution(ids: string[], institutionId: string) {
  if (ids.length === 0) return;
  const found = await tenantDb().department.count({
    where: { id: { in: ids }, institutionId },
  });
  if (found !== new Set(ids).size) {
    throw new InvalidReferenceError('secondaryDepartmentIds', 'Department');
  }
}

/** Assignment of an employee on a given date, reconstructed from the history tables. */
export interface EmployeeAssignment {
  employeeId: string;
  asOf: string;
  groupId: string | null;
  institutionId: string;
  campusId: string | null;
  departmentId: string | null;
  secondaryDepartmentIds: string[];
  designationId: string | null;
  employmentType: EmploymentType | null;
  reportingManagerId: string | null;
}

const activeOn = (d: Date) => ({
  effectiveFrom: { lte: d },
  OR: [{ effectiveTo: null }, { effectiveTo: { gte: d } }],
});

/**
 * Where an employee was assigned ON `date` (YYYY-MM-DD or Date): institution / campus /
 * department (primary + secondary), designation and reporting manager, from the effective-dated
 * history rows. Returns null when the employee had no assignment that day (before joining).
 * Layers 7-8 use this for attendance / leave approvers and payroll institution attribution.
 */
export async function employeeAssignmentAsOf(
  employeeId: string,
  date: Date | string,
): Promise<EmployeeAssignment | null> {
  const d = typeof date === 'string' ? toDate(date) : date;
  const db = tenantDb();
  const [departments, position, line] = await Promise.all([
    db.employeeDepartment.findMany({
      where: { employeeId, ...activeOn(d) },
      orderBy: [{ isPrimary: 'desc' }, { effectiveFrom: 'desc' }],
    }),
    db.employeePosition.findFirst({
      where: { employeeId, ...activeOn(d) },
      orderBy: { effectiveFrom: 'desc' },
    }),
    db.employeeReportingLine.findFirst({
      where: { employeeId, ...activeOn(d) },
      orderBy: { effectiveFrom: 'desc' },
    }),
  ]);
  const primary = departments.find((r) => r.isPrimary);
  if (!primary) return null;
  return {
    employeeId,
    asOf: d.toISOString().slice(0, 10),
    groupId: primary.groupId,
    institutionId: primary.institutionId,
    campusId: primary.campusId,
    departmentId: primary.departmentId,
    secondaryDepartmentIds: departments
      .filter((r) => !r.isPrimary && r.departmentId)
      .map((r) => r.departmentId as string),
    designationId: position?.designationId ?? null,
    employmentType: position?.employmentType ?? null,
    reportingManagerId: line?.managerId ?? null,
  };
}

/** Employee ids linked to a user in the current tenant (normally 0 or 1). */
export async function employeeIdsForUser(userId: string): Promise<string[]> {
  const rows = await tenantDb().employee.findMany({ where: { userId }, select: { id: true } });
  return rows.map((r) => r.id);
}

/**
 * Reporting-manager resolver for the workflow engine: the users of the first `levels` managers
 * up the requester's CURRENT reporting chain (1 = direct manager only, 2 = manager and
 * skip-level, ...). Managers without a linked user, or exited ones, contribute no approver.
 */
export async function reportingManagerUserIds(userId: string, levels: number): Promise<string[]> {
  const db = tenantDb();
  const self = await db.employee.findFirst({
    where: { userId },
    select: { id: true, reportingManagerId: true },
  });
  if (!self) return [];
  const seen = new Set<string>([self.id]);
  let cursor = self.reportingManagerId;
  const result: string[] = [];
  let level = 0;
  while (cursor && !seen.has(cursor) && level < levels) {
    seen.add(cursor);
    const manager: {
      userId: string | null;
      status: string;
      reportingManagerId: string | null;
    } | null = await db.employee.findUnique({
      where: { id: cursor },
      select: { userId: true, status: true, reportingManagerId: true },
    });
    if (!manager) break;
    level += 1;
    if (manager.userId && manager.status !== 'EXITED') result.push(manager.userId);
    cursor = manager.reportingManagerId;
  }
  return result;
}
