import type { CreateSalaryRevisionInput } from '@erp/shared';
import type { Prisma } from '@prisma/client';
import { audit } from '../../core/audit';
import { can, currentPrincipal, hierarchyResource, tryGetPrincipal } from '../../core/authz';
import { emit } from '../../core/events';
import { AppError, NotFoundError } from '../../core/http/errors';
import { tenantDb, withTenant } from '../../core/tenancy';
import { dateStr, toDate, toSalaryDto } from './employees.mappers';
import { loadEmployeeFor, loadVisibleEmployee } from './employees.service';
import { employeeAssignmentAsOf } from './employees.assignment';

/*
 * Effective-dated salary history. Rows are IMMUTABLE (DB triggers reject UPDATE / DELETE); a
 * correction is a new revision. Layer 8 payroll attaches `salaryStructureId` and reads
 * `salaryAsOf()`; `amounts` is a free-form `{ component: monthlyAmount }` map.
 */

/** The salary revision in force on `date` (latest effectiveFrom ≤ date), or null. */
export async function salaryAsOf(employeeId: string, date: Date | string) {
  const d = typeof date === 'string' ? toDate(date) : date;
  const row = await tenantDb().employeeSalaryHistory.findFirst({
    where: { employeeId, effectiveFrom: { lte: d } },
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
  });
  return row ? toSalaryDto(row) : null;
}

export const salaryService = {
  async list(employeeId: string) {
    const employee = await loadVisibleEmployee(employeeId);
    if (!(await can(currentPrincipal(), 'salary.view', hierarchyResource.employee(employee)))) {
      throw new NotFoundError('Employee');
    }
    const rows = await tenantDb().employeeSalaryHistory.findMany({
      where: { employeeId },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(toSalaryDto);
  },

  async revise(employeeId: string, input: CreateSalaryRevisionInput) {
    const employee = await loadEmployeeFor(employeeId, 'salary.update');
    if (employee.status === 'EXITED') {
      throw new AppError(409, 'INVALID_STATE', 'Cannot revise the salary of an exited employee');
    }
    const db = tenantDb();
    const effective = toDate(input.effectiveFrom);
    const previous = await db.employeeSalaryHistory.findFirst({
      where: { employeeId },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    if (previous && effective < previous.effectiveFrom) {
      throw new AppError(
        422,
        'VALIDATION_ERROR',
        `effectiveFrom must not be before the latest revision (${dateStr(previous.effectiveFrom)})`,
      );
    }
    // Attribute the revision to the institution the employee belongs to on that date.
    const assignment = await employeeAssignmentAsOf(employeeId, effective);
    const row = await db.employeeSalaryHistory.create({
      data: withTenant({
        employeeId,
        groupId: assignment?.groupId ?? employee.groupId,
        institutionId: assignment?.institutionId ?? employee.institutionId,
        effectiveFrom: effective,
        currency: input.currency,
        annualCtc: input.annualCtc,
        amounts: input.amounts as Prisma.InputJsonValue,
        salaryStructureId: input.salaryStructureId ?? null,
        revisionReason: input.revisionReason,
        previousId: previous?.id ?? null,
        createdByUserId: tryGetPrincipal()?.userId ?? null,
      }),
    });
    const dto = toSalaryDto(row);
    await audit.record({
      action: 'employee.salary.revise',
      entityType: 'employee',
      entityId: employeeId,
      before: previous
        ? { annualCtc: Number(previous.annualCtc), effectiveFrom: dateStr(previous.effectiveFrom) }
        : undefined,
      after: { annualCtc: dto.annualCtc, effectiveFrom: dto.effectiveFrom, currency: dto.currency },
      reason: input.revisionReason,
      metadata: { revisionId: row.id },
    });
    await emit(
      'employee.salary_revised',
      {
        employeeId,
        employeeCode: employee.employeeCode,
        revisionId: row.id,
        effectiveFrom: dto.effectiveFrom,
        salaryStructureId: dto.salaryStructureId,
      },
      { institutionId: row.institutionId },
    );
    return dto;
  },
};
