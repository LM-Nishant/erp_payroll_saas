import type { Employee } from '@prisma/client';
import {
  accessFor,
  assertPermission,
  authorize,
  currentPrincipal,
  hierarchyResource,
  type ResourceScope,
} from '../../core/authz';
import { ForbiddenError, InvalidReferenceError, NotFoundError } from '../../core/http/errors';
import { tenantDb } from '../../core/tenancy';
import { loadEmployeeWith } from '../attendance/attendance.access';

/*
 * Payroll access helpers. Payroll data is scoped by INSTITUTION (the run / structure / salary
 * institution); group-scoped grants (group_finance, group_hr) expand to the group's
 * institutions through `accessFor`.
 */

export interface InstitutionRef {
  id: string;
  groupId: string | null;
  name: string;
  code: string;
}

export async function loadInstitution(
  institutionId: string,
  field = 'institutionId',
): Promise<InstitutionRef> {
  const inst = await tenantDb().institution.findFirst({
    where: { id: institutionId },
    select: { id: true, groupId: true, name: true, code: true },
  });
  if (!inst) throw new InvalidReferenceError(field, 'Institution');
  return inst;
}

export const institutionScope = (i: { id: string; groupId: string | null }): ResourceScope =>
  hierarchyResource.institution(i);

/** Load an institution and require `permission` in its scope. */
export async function authorizeInstitution(
  institutionId: string,
  permission: string,
  field = 'institutionId',
): Promise<InstitutionRef> {
  const inst = await loadInstitution(institutionId, field);
  await authorize(currentPrincipal(), permission, institutionScope(inst));
  return inst;
}

/** Organization-wide grant of `permission` (needed for org-level masters). */
export async function assertOrgWide(permission: string): Promise<void> {
  const principal = currentPrincipal();
  assertPermission(principal, permission);
  const access = await accessFor(principal, permission);
  if (!access.all) {
    throw new ForbiddenError(
      `Organization-wide "${permission}" is required for organization-level payroll masters`,
      'SCOPE_DENIED',
    );
  }
}

/**
 * Institution ids where the caller holds `permission` (`undefined` = all institutions).
 * Throws 403 when the permission is not held at all.
 */
export async function institutionIdsFor(permission: string): Promise<string[] | undefined> {
  const principal = currentPrincipal();
  assertPermission(principal, permission);
  const access = await accessFor(principal, permission);
  if (access.all) return undefined;
  return [...access.institutionIds];
}

export function institutionFilter(ids: string[] | undefined, field = 'institutionId') {
  return ids === undefined ? {} : { [field]: { in: ids } };
}

/** Is a row of `institutionId` within the caller's `permission` scope? (404 otherwise). */
export async function assertInstitutionVisible(
  institutionId: string,
  permission: string,
  resource = 'Resource',
): Promise<void> {
  const ids = await institutionIdsFor(permission);
  if (ids !== undefined && !ids.includes(institutionId)) throw new NotFoundError(resource);
}

/** Employee the caller may manage payroll for (scope = current assignment). */
export function payrollEmployee(employeeId: string, permission: string): Promise<Employee> {
  return loadEmployeeWith(employeeId, permission);
}
