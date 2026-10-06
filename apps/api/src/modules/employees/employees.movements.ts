import { randomUUID } from 'node:crypto';
import type { CreateEmployeeMovementInput } from '@erp/shared';
import type { Employee, EmployeeMovement } from '@prisma/client';
import { audit } from '../../core/audit';
import { authorize, currentPrincipal, tryGetPrincipal } from '../../core/authz';
import { emit } from '../../core/events';
import { AppError, ConflictError, NotFoundError } from '../../core/http/errors';
import { tenantDb, withTenant } from '../../core/tenancy';
import { submitWorkflow, type WorkflowInstanceRef } from '../../core/workflow';
import { resolveAssignment } from './employees.assignment';
import { dateStr, dayBefore, toDate, toMovementDto, todayStr } from './employees.mappers';
import {
  assignmentResource,
  hrRecipients,
  loadEmployeeFor,
  loadVisibleEmployee,
  managerUserId,
  notify,
} from './employees.service';

export const TRANSFER_WORKFLOW = 'employee_transfer';
const MOVABLE: Employee['status'][] = ['ONBOARDING', 'ACTIVE', 'ON_NOTICE'];

const EVENT_FOR: Record<EmployeeMovement['type'], string> = {
  TRANSFER: 'employee.transferred',
  PROMOTION: 'employee.promoted',
  DESIGNATION_CHANGE: 'employee.promoted',
  DEPARTMENT_CHANGE: 'employee.reassigned',
  REPORTING_CHANGE: 'employee.reassigned',
  REHIRE: 'employee.rehired',
};

/** Latest open primary assignment start: movements must be effective strictly after it. */
async function currentStart(employeeId: string): Promise<Date | null> {
  const db = tenantDb();
  const rows = await Promise.all([
    db.employeeDepartment.findFirst({
      where: { employeeId, effectiveTo: null },
      orderBy: { effectiveFrom: 'desc' },
      select: { effectiveFrom: true },
    }),
    db.employeePosition.findFirst({
      where: { employeeId, effectiveTo: null },
      orderBy: { effectiveFrom: 'desc' },
      select: { effectiveFrom: true },
    }),
    db.employeeReportingLine.findFirst({
      where: { employeeId, effectiveTo: null },
      orderBy: { effectiveFrom: 'desc' },
      select: { effectiveFrom: true },
    }),
  ]);
  const dates = rows.filter((r) => !!r).map((r) => r!.effectiveFrom.getTime());
  return dates.length ? new Date(Math.max(...dates)) : null;
}

/**
 * Apply a movement: close the affected open history rows the day before the effective date,
 * open new rows, update the employee's current assignment. Idempotent (APPLIED → no-op). Runs
 * WITHOUT a permission check — callers (request / workflow callback / scheduler) authorize.
 */
export async function applyMovement(movementId: string): Promise<EmployeeMovement | null> {
  const db = tenantDb();
  const movement = await db.employeeMovement.findUnique({ where: { id: movementId } });
  if (!movement || movement.status === 'APPLIED') return movement;
  if (movement.status === 'REJECTED' || movement.status === 'CANCELLED') return movement;
  const employee = await db.employee.findUnique({ where: { id: movement.employeeId } });
  if (!employee || !MOVABLE.includes(employee.status)) {
    await db.employeeMovement.update({
      where: { id: movementId },
      data: { status: 'CANCELLED', decidedComment: 'Employee is no longer active' },
    });
    return null;
  }
  const d = movement.effectiveDate;
  const end = dayBefore(d);
  const institutionChanged = movement.toInstitutionId !== employee.institutionId;
  const unitChanged =
    institutionChanged ||
    movement.toCampusId !== employee.campusId ||
    movement.toDepartmentId !== employee.departmentId;
  const designationChanged = movement.toDesignationId !== employee.designationId;
  const managerChanged = movement.toReportingManagerId !== employee.reportingManagerId;

  const applied = await db.$transaction(async (tx) => {
    if (unitChanged) {
      const openRows = await tx.employeeDepartment.findMany({
        where: {
          employeeId: employee.id,
          effectiveTo: null,
          // Secondary departments belong to the institution: close them on a transfer.
          ...(institutionChanged ? {} : { isPrimary: true }),
        },
      });
      for (const row of openRows) {
        await tx.employeeDepartment.update({ where: { id: row.id }, data: { effectiveTo: end } });
      }
      await tx.employeeDepartment.create({
        data: withTenant({
          employeeId: employee.id,
          groupId: movement.toGroupId,
          institutionId: movement.toInstitutionId,
          campusId: movement.toCampusId,
          departmentId: movement.toDepartmentId,
          isPrimary: true,
          effectiveFrom: d,
          movementId,
        }),
      });
    }
    if (designationChanged || institutionChanged) {
      const open = await tx.employeePosition.findMany({
        where: { employeeId: employee.id, effectiveTo: null },
      });
      for (const row of open) {
        await tx.employeePosition.update({ where: { id: row.id }, data: { effectiveTo: end } });
      }
      await tx.employeePosition.create({
        data: withTenant({
          employeeId: employee.id,
          groupId: movement.toGroupId,
          institutionId: movement.toInstitutionId,
          designationId: movement.toDesignationId,
          employmentType: employee.employmentType,
          effectiveFrom: d,
          reason: movement.reason,
          movementId,
        }),
      });
    }
    if (managerChanged) {
      await tx.employeeReportingLine.updateMany({
        where: { employeeId: employee.id, effectiveTo: null },
        data: { effectiveTo: end },
      });
      if (movement.toReportingManagerId) {
        await tx.employeeReportingLine.create({
          data: withTenant({
            employeeId: employee.id,
            managerId: movement.toReportingManagerId,
            effectiveFrom: d,
            movementId,
          }),
        });
      }
    }
    await tx.employee.update({
      where: { id: employee.id },
      data: {
        groupId: movement.toGroupId,
        institutionId: movement.toInstitutionId,
        campusId: movement.toCampusId,
        departmentId: movement.toDepartmentId,
        designationId: movement.toDesignationId,
        reportingManagerId: movement.toReportingManagerId,
      },
    });
    return tx.employeeMovement.update({
      where: { id: movementId },
      data: { status: 'APPLIED', appliedAt: new Date() },
    });
  });

  await audit.record({
    action: 'employee.movement.apply',
    entityType: 'employee',
    entityId: employee.id,
    before: {
      institutionId: employee.institutionId,
      campusId: employee.campusId,
      departmentId: employee.departmentId,
      designationId: employee.designationId,
      reportingManagerId: employee.reportingManagerId,
    },
    after: {
      institutionId: movement.toInstitutionId,
      campusId: movement.toCampusId,
      departmentId: movement.toDepartmentId,
      designationId: movement.toDesignationId,
      reportingManagerId: movement.toReportingManagerId,
    },
    metadata: { movementId, type: movement.type, effectiveDate: dateStr(d) },
  });
  await emit(
    EVENT_FOR[movement.type],
    {
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      movementId,
      type: movement.type,
      effectiveDate: dateStr(d),
      fromInstitutionId: movement.fromInstitutionId,
      toInstitutionId: movement.toInstitutionId,
      fromDepartmentId: movement.fromDepartmentId,
      toDepartmentId: movement.toDepartmentId,
      fromDesignationId: movement.fromDesignationId,
      toDesignationId: movement.toDesignationId,
    },
    { institutionId: movement.toInstitutionId },
  );
  if (movement.type === 'TRANSFER') {
    const recipients = [
      employee.userId,
      ...(await hrRecipients({
        groupId: movement.fromGroupId,
        institutionId: movement.fromInstitutionId,
      })),
      ...(institutionChanged
        ? await hrRecipients({
            groupId: movement.toGroupId,
            institutionId: movement.toInstitutionId,
          })
        : []),
      await managerUserId(movement.toReportingManagerId),
    ];
    await notify('employee.transferred', recipients, {
      title: `${employee.displayName} (${employee.employeeCode}) transferred`,
      body: `Effective ${dateStr(d)}.`,
      link: `/hr/employees/${employee.id}`,
      institutionId: movement.toInstitutionId,
      data: { employeeId: employee.id, movementId },
    });
  }
  return applied;
}

/** Approved (or no workflow): apply now when effective, else schedule for the daily job. */
async function approveMovement(movementId: string, comment?: string | null) {
  const db = tenantDb();
  const movement = await db.employeeMovement.findUnique({ where: { id: movementId } });
  if (!movement || movement.status !== 'PENDING_APPROVAL') return;
  await db.employeeMovement.update({
    where: { id: movementId },
    data: {
      ...(dateStr(movement.effectiveDate) <= todayStr() ? {} : { status: 'SCHEDULED' }),
      decidedComment: comment ?? null,
    },
  });
  if (dateStr(movement.effectiveDate) <= todayStr()) await applyMovement(movementId);
}

async function closeMovement(ref: WorkflowInstanceRef, status: 'REJECTED' | 'CANCELLED') {
  const db = tenantDb();
  const movement = await db.employeeMovement.findUnique({ where: { id: ref.entityId } });
  if (!movement || movement.status !== 'PENDING_APPROVAL') return;
  await db.employeeMovement.update({
    where: { id: movement.id },
    data: { status, decidedComment: ref.comment ?? null },
  });
  await audit.record({
    action: status === 'REJECTED' ? 'employee.movement.reject' : 'employee.movement.cancel',
    entityType: 'employee',
    entityId: movement.employeeId,
    reason: ref.comment ?? null,
    metadata: { movementId: movement.id, workflowInstanceId: ref.id },
  });
}

/** Workflow callbacks for `employee_transfer` (registered in employees.registrations). */
export const transferWorkflowCallbacks = {
  onApproved: (ref: WorkflowInstanceRef) => approveMovement(ref.entityId, ref.comment),
  onRejected: (ref: WorkflowInstanceRef) => closeMovement(ref, 'REJECTED'),
  onCancelled: (ref: WorkflowInstanceRef) => closeMovement(ref, 'CANCELLED'),
};

/** Daily job body: apply SCHEDULED movements whose effective date has arrived. */
export async function applyDueMovements(today = todayStr()): Promise<number> {
  const due = await tenantDb().employeeMovement.findMany({
    where: { status: 'SCHEDULED', effectiveDate: { lte: toDate(today) } },
    orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  for (const m of due) await applyMovement(m.id);
  return due.length;
}

export const movementService = {
  async list(employeeId: string) {
    await loadVisibleEmployee(employeeId);
    const rows = await tenantDb().employeeMovement.findMany({
      where: { employeeId },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(toMovementDto);
  },

  /**
   * Request a transfer / promotion / designation, department or reporting change. Routed through
   * the `employee_transfer` workflow when a definition exists (submitted at the SOURCE
   * institution); applied immediately (or scheduled) otherwise.
   */
  async request(employeeId: string, input: CreateEmployeeMovementInput) {
    const employee = await loadEmployeeFor(employeeId, 'employee.transfer');
    if (!MOVABLE.includes(employee.status)) {
      throw new AppError(
        409,
        'INVALID_STATE',
        `Cannot move an employee in status ${employee.status}`,
      );
    }
    const db = tenantDb();
    const open = await db.employeeMovement.findFirst({
      where: { employeeId, status: { in: ['PENDING_APPROVAL', 'SCHEDULED'] } },
      select: { id: true },
    });
    if (open) throw new ConflictError('This employee already has a pending movement');

    const target = targetOf(employee, input);
    const assignment = await resolveAssignment(target, employeeId);
    const changed =
      assignment.institutionId !== employee.institutionId ||
      assignment.campusId !== employee.campusId ||
      assignment.departmentId !== employee.departmentId ||
      assignment.designationId !== employee.designationId ||
      assignment.reportingManagerId !== employee.reportingManagerId;
    if (!changed) {
      throw new AppError(422, 'VALIDATION_ERROR', 'The movement does not change anything');
    }
    await authorize(currentPrincipal(), 'employee.transfer', assignmentResource(assignment));
    const effective = toDate(input.effectiveDate);
    const start = await currentStart(employeeId);
    if (start && effective <= start) {
      throw new AppError(
        422,
        'VALIDATION_ERROR',
        `effectiveDate must be after the current assignment start (${dateStr(start)})`,
      );
    }

    const id = randomUUID();
    const movement = await db.employeeMovement.create({
      data: withTenant({
        id,
        employeeId,
        type: input.type,
        status: 'PENDING_APPROVAL' as const,
        effectiveDate: effective,
        fromGroupId: employee.groupId,
        fromInstitutionId: employee.institutionId,
        fromCampusId: employee.campusId,
        fromDepartmentId: employee.departmentId,
        fromDesignationId: employee.designationId,
        fromReportingManagerId: employee.reportingManagerId,
        toGroupId: assignment.groupId,
        toInstitutionId: assignment.institutionId,
        toCampusId: assignment.campusId,
        toDepartmentId: assignment.departmentId,
        toDesignationId: assignment.designationId,
        toReportingManagerId: assignment.reportingManagerId,
        reason: input.reason,
        requestedByUserId: tryGetPrincipal()?.userId ?? null,
      }),
    });
    await audit.record({
      action: 'employee.movement.request',
      entityType: 'employee',
      entityId: employeeId,
      after: toMovementDto(movement),
      reason: input.reason,
    });
    const instance = await submitWorkflow({
      entityType: TRANSFER_WORKFLOW,
      entityId: id,
      title: `${input.type.replace(/_/g, ' ').toLowerCase()}: ${employee.displayName} (${employee.employeeCode})`,
      institutionId: employee.institutionId,
      groupId: employee.groupId,
      departmentId: employee.departmentId,
      context: {
        type: input.type,
        employeeId,
        employmentType: employee.employmentType,
        fromInstitutionId: employee.institutionId,
        toInstitutionId: assignment.institutionId,
        crossInstitution: assignment.institutionId !== employee.institutionId,
      },
    });
    if (instance) {
      await db.employeeMovement.update({
        where: { id },
        data: { workflowInstanceId: instance.id },
      });
    } else {
      await approveMovement(id);
    }
    const row = await db.employeeMovement.findUniqueOrThrow({ where: { id } });
    return toMovementDto(row);
  },

  /** Cancel a SCHEDULED movement (pending approvals are cancelled through the workflow). */
  async cancel(employeeId: string, movementId: string) {
    await loadEmployeeFor(employeeId, 'employee.transfer');
    const db = tenantDb();
    const movement = await db.employeeMovement.findFirst({ where: { id: movementId, employeeId } });
    if (!movement) throw new NotFoundError('Movement');
    if (movement.status === 'PENDING_APPROVAL' && movement.workflowInstanceId) {
      throw new AppError(
        409,
        'INVALID_STATE',
        'This movement awaits approval; cancel the approval request instead',
      );
    }
    if (movement.status !== 'SCHEDULED' && movement.status !== 'PENDING_APPROVAL') {
      throw new AppError(409, 'INVALID_STATE', `Cannot cancel a ${movement.status} movement`);
    }
    const row = await db.employeeMovement.update({
      where: { id: movementId },
      data: { status: 'CANCELLED' },
    });
    await audit.record({
      action: 'employee.movement.cancel',
      entityType: 'employee',
      entityId: employeeId,
      metadata: { movementId },
    });
    return toMovementDto(row);
  },
};

function targetOf(employee: Employee, input: CreateEmployeeMovementInput) {
  const keep = <T>(v: T | undefined, current: T) => (v === undefined ? current : v);
  switch (input.type) {
    case 'TRANSFER': {
      const toInstitution = input.toInstitutionId ?? employee.institutionId;
      const crosses = toInstitution !== employee.institutionId;
      if (
        input.toInstitutionId === undefined &&
        input.toCampusId === undefined &&
        input.toDepartmentId === undefined
      ) {
        throw new AppError(
          422,
          'VALIDATION_ERROR',
          'A transfer needs toInstitutionId, toCampusId or toDepartmentId',
        );
      }
      return {
        institutionId: toInstitution,
        campusId: keep(input.toCampusId, crosses ? null : employee.campusId),
        departmentId: keep(input.toDepartmentId, crosses ? null : employee.departmentId),
        designationId: keep(input.toDesignationId, employee.designationId),
        reportingManagerId: keep(input.toReportingManagerId, employee.reportingManagerId),
      };
    }
    case 'PROMOTION':
    case 'DESIGNATION_CHANGE':
      if (!input.toDesignationId) {
        throw new AppError(422, 'VALIDATION_ERROR', `${input.type} needs toDesignationId`);
      }
      return {
        institutionId: employee.institutionId,
        campusId: employee.campusId,
        departmentId: employee.departmentId,
        designationId: input.toDesignationId,
        reportingManagerId: keep(input.toReportingManagerId, employee.reportingManagerId),
      };
    case 'DEPARTMENT_CHANGE':
      if (!input.toDepartmentId) {
        throw new AppError(422, 'VALIDATION_ERROR', 'DEPARTMENT_CHANGE needs toDepartmentId');
      }
      return {
        institutionId: employee.institutionId,
        campusId: keep(input.toCampusId, employee.campusId),
        departmentId: input.toDepartmentId,
        designationId: employee.designationId,
        reportingManagerId: keep(input.toReportingManagerId, employee.reportingManagerId),
      };
    case 'REPORTING_CHANGE':
      if (input.toReportingManagerId === undefined) {
        throw new AppError(422, 'VALIDATION_ERROR', 'REPORTING_CHANGE needs toReportingManagerId');
      }
      return {
        institutionId: employee.institutionId,
        campusId: employee.campusId,
        departmentId: employee.departmentId,
        designationId: employee.designationId,
        reportingManagerId: input.toReportingManagerId,
      };
  }
}
