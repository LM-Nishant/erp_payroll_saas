import type { CreateProfileChangeRequestInput, MyEmployeeDto } from '@erp/shared';
import { audit } from '../../core/audit';
import { assertPermission, currentPrincipal } from '../../core/authz';
import { emit } from '../../core/events';
import { AppError, ConflictError, NotFoundError } from '../../core/http/errors';
import { tenantDb, withTenant } from '../../core/tenancy';
import { submitWorkflow, type WorkflowInstanceRef } from '../../core/workflow';
import { employeeInclude, toChangeRequestDto } from './employees.mappers';
import {
  employeeDetail,
  loadVisibleEmployee,
  notify,
  personalData,
  toPersonal,
} from './employees.service';
import type { Prisma } from '@prisma/client';

/*
 * Employee self-service: `/employees/me` (own record, sensitive values masked) and personal
 * profile change requests. A change request goes through the `employee_profile_change` workflow
 * with the employee as requester (so `reporting_manager` approvers resolve to their manager);
 * without an active definition it is applied immediately.
 */

export const PROFILE_CHANGE_WORKFLOW = 'employee_profile_change';

async function ownEmployee() {
  const principal = currentPrincipal();
  assertPermission(principal, 'employee.view_own');
  if (!principal.userId) throw new NotFoundError('Employee');
  const employee = await tenantDb().employee.findFirst({
    where: { userId: principal.userId },
    include: employeeInclude,
  });
  if (!employee) throw new NotFoundError('Employee');
  return employee;
}

/** Apply an approved change request to the profile (idempotent). */
async function applyChangeRequest(requestId: string, comment?: string | null) {
  const db = tenantDb();
  const request = await db.employeeProfileChangeRequest.findUnique({ where: { id: requestId } });
  if (!request || request.status !== 'PENDING_APPROVAL') return;
  const changes = request.changes as Record<string, unknown>;
  const profile = await db.employeeProfile.findFirst({ where: { employeeId: request.employeeId } });
  const before = toPersonal(profile) as Record<string, unknown>;
  const data = personalData(changes);
  if (profile) {
    await db.employeeProfile.update({ where: { id: profile.id }, data });
  } else {
    await db.employeeProfile.create({
      data: withTenant({
        employeeId: request.employeeId,
        ...(data as object),
      }) as Prisma.EmployeeProfileUncheckedCreateInput,
    });
  }
  await db.employeeProfileChangeRequest.update({
    where: { id: requestId },
    data: { status: 'APPLIED', appliedAt: new Date(), decidedComment: comment ?? null },
  });
  await audit.record({
    action: 'employee.profile.change_applied',
    entityType: 'employee',
    entityId: request.employeeId,
    before: Object.fromEntries(Object.keys(changes).map((k) => [k, before[k] ?? null])),
    after: changes,
    metadata: { changeRequestId: requestId },
  });
  const employee = await db.employee.findUnique({ where: { id: request.employeeId } });
  if (employee) {
    await emit(
      'employee.updated',
      { employeeId: employee.id, employeeCode: employee.employeeCode, profile: true },
      { institutionId: employee.institutionId },
    );
    await notify('employee.profile_change_decided', [employee.userId], {
      title: 'Your profile change was applied',
      link: '/me/employee',
      institutionId: employee.institutionId,
      data: { changeRequestId: requestId, status: 'APPLIED' },
    });
  }
}

async function closeChangeRequest(ref: WorkflowInstanceRef, status: 'REJECTED' | 'CANCELLED') {
  const db = tenantDb();
  const request = await db.employeeProfileChangeRequest.findUnique({ where: { id: ref.entityId } });
  if (!request || request.status !== 'PENDING_APPROVAL') return;
  await db.employeeProfileChangeRequest.update({
    where: { id: request.id },
    data: { status, decidedComment: ref.comment ?? null },
  });
  await audit.record({
    action: `employee.profile.change_${status.toLowerCase()}`,
    entityType: 'employee',
    entityId: request.employeeId,
    reason: ref.comment ?? null,
    metadata: { changeRequestId: request.id },
  });
  if (status === 'REJECTED') {
    const employee = await db.employee.findUnique({ where: { id: request.employeeId } });
    await notify('employee.profile_change_decided', [employee?.userId], {
      title: 'Your profile change was rejected',
      body: ref.comment ?? undefined,
      link: '/me/employee',
      institutionId: employee?.institutionId,
      data: { changeRequestId: request.id, status },
    });
  }
}

export const profileChangeWorkflowCallbacks = {
  onApproved: (ref: WorkflowInstanceRef) => applyChangeRequest(ref.entityId, ref.comment),
  onRejected: (ref: WorkflowInstanceRef) => closeChangeRequest(ref, 'REJECTED'),
  onCancelled: (ref: WorkflowInstanceRef) => closeChangeRequest(ref, 'CANCELLED'),
};

export const selfService = {
  async me(): Promise<MyEmployeeDto> {
    const employee = await ownEmployee();
    const pending = await tenantDb().employeeProfileChangeRequest.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return {
      ...(await employeeDetail(employee)),
      pendingChangeRequests: pending.map(toChangeRequestDto),
    };
  },

  async requestChange(input: CreateProfileChangeRequestInput) {
    const principal = currentPrincipal();
    assertPermission(principal, 'employee.update_own');
    const employee = await ownEmployee();
    if (employee.status === 'EXITED') {
      throw new AppError(409, 'INVALID_STATE', 'Exited employees cannot change their profile');
    }
    const db = tenantDb();
    const open = await db.employeeProfileChangeRequest.findFirst({
      where: { employeeId: employee.id, status: 'PENDING_APPROVAL' },
      select: { id: true },
    });
    if (open) throw new ConflictError('A profile change request is already pending');
    const request = await db.employeeProfileChangeRequest.create({
      data: withTenant({
        employeeId: employee.id,
        changes: input.changes as Prisma.InputJsonValue,
        reason: input.reason ?? null,
        requestedByUserId: principal.userId,
      }),
    });
    await audit.record({
      action: 'employee.profile.change_request',
      entityType: 'employee',
      entityId: employee.id,
      after: { fields: Object.keys(input.changes) },
      reason: input.reason ?? null,
      metadata: { changeRequestId: request.id },
    });
    const instance = await submitWorkflow({
      entityType: PROFILE_CHANGE_WORKFLOW,
      entityId: request.id,
      title: `Profile change: ${employee.displayName} (${employee.employeeCode})`,
      requesterUserId: principal.userId,
      institutionId: employee.institutionId,
      groupId: employee.groupId,
      departmentId: employee.departmentId,
      context: { employeeId: employee.id, fields: Object.keys(input.changes) },
    });
    if (instance) {
      await db.employeeProfileChangeRequest.update({
        where: { id: request.id },
        data: { workflowInstanceId: instance.id },
      });
    } else {
      await applyChangeRequest(request.id);
    }
    return toChangeRequestDto(
      await db.employeeProfileChangeRequest.findUniqueOrThrow({ where: { id: request.id } }),
    );
  },

  /** HR view of an employee's change requests. */
  async listFor(employeeId: string) {
    await loadVisibleEmployee(employeeId);
    const rows = await tenantDb().employeeProfileChangeRequest.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toChangeRequestDto);
  },
};
