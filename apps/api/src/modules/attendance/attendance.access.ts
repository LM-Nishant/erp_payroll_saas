import type { Employee } from '@prisma/client';
import {
  accessFor,
  assertPermission,
  can,
  currentPrincipal,
  hasPermission,
  hierarchyResource,
  type ResourceScope,
} from '../../core/authz';
import { AppError, InvalidReferenceError, NotFoundError } from '../../core/http/errors';
import { tenantDb } from '../../core/tenancy';

/* Shared access helpers of the time-office modules (attendance / leave / holidays / shifts). */

/** Only these employees can punch, apply leave or request regularization (SPEC §5). */
export const ACTIONABLE_STATUSES = ['ACTIVE', 'ON_NOTICE'] as const;

export function assertActionable(e: Pick<Employee, 'status'>): void {
  if (!(ACTIONABLE_STATUSES as readonly string[]).includes(e.status)) {
    throw new AppError(
      409,
      'EMPLOYEE_NOT_ACTIVE',
      'Only active or on-notice employees can perform this action',
    );
  }
}

/** The caller's own employee record (404 when the user is not an employee). */
export async function ownEmployee(permission: string): Promise<Employee> {
  const principal = currentPrincipal();
  assertPermission(principal, permission);
  if (!principal.userId) throw new NotFoundError('Employee');
  const employee = await tenantDb().employee.findFirst({ where: { userId: principal.userId } });
  if (!employee) throw new NotFoundError('Employee');
  return employee;
}

/** Resource coordinates of an institution (422 when it does not exist in the tenant). */
export async function institutionResource(
  institutionId: string,
  field = 'institutionId',
): Promise<ResourceScope> {
  const inst = await tenantDb().institution.findFirst({
    where: { id: institutionId },
    select: { id: true, groupId: true },
  });
  if (!inst) throw new InvalidReferenceError(field, 'Institution');
  return hierarchyResource.institution(inst);
}

/**
 * Load an employee the caller may act on with `permission` (scope = the employee's CURRENT
 * assignment), or — when `selfPermission` is given — the caller's own employee record.
 * 404 when neither applies (no existence leak).
 */
export async function loadEmployeeWith(
  employeeId: string,
  permission: string,
  selfPermission?: string,
): Promise<Employee> {
  const principal = currentPrincipal();
  const employee = await tenantDb().employee.findFirst({ where: { id: employeeId } });
  if (!employee) throw new NotFoundError('Employee');
  if (
    selfPermission &&
    principal.userId &&
    employee.userId === principal.userId &&
    hasPermission(principal, selfPermission)
  ) {
    return employee;
  }
  if (!(await can(principal, permission, hierarchyResource.employee(employee)))) {
    throw new NotFoundError('Employee');
  }
  return employee;
}

/** Rows of institutions where the caller holds `permission` (institution-level masters). */
export async function institutionWhere(
  permission: string,
): Promise<Record<string, unknown> | undefined> {
  const principal = currentPrincipal();
  assertPermission(principal, permission);
  const access = await accessFor(principal, permission);
  if (access.all) return undefined;
  return { institutionId: { in: [...access.institutionIds] } };
}
