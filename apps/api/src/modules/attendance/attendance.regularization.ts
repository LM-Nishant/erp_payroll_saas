import type { CreateRegularizationInput, ListRegularizationsQuery } from '@erp/shared';
import type { AttendanceRegularization, Prisma } from '@prisma/client';
import { audit } from '../../core/audit';
import { andScope, currentPrincipal, scopeWhere } from '../../core/authz';
import { emit } from '../../core/events';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { tenantDb, withTenant } from '../../core/tenancy';
import { submitWorkflow, type WorkflowInstanceRef } from '../../core/workflow';
import { cancelWorkflow } from '../../core/workflow/engine';
import { notify } from '../employees/employees.service';
import { assertActionable, ownEmployee } from './attendance.access';
import { computeAttendance } from './attendance.compute';
import { AttendanceContext } from './attendance.context';
import { toRegularizationDto } from './attendance.mappers';
import { insertManualPunch } from './attendance.service';
import { dateToStr, localToday, localToInstant } from './time';

/*
 * Attendance regularization: an employee asks to correct a day (missed punch / wrong time / on
 * duty). Routed through the `attendance_regularization` workflow with the employee as requester
 * (so `reporting_manager` steps resolve to their manager); applied immediately when no
 * definition is active. Approval inserts MANUAL punches and/or a status override, then
 * recomputes the day. Locked periods reject both submission and application (409 PERIOD_LOCKED).
 */

export const REGULARIZATION_WORKFLOW = 'attendance_regularization';

async function applyRegularization(id: string, comment?: string | null) {
  const db = tenantDb();
  const reg = await db.attendanceRegularization.findUnique({ where: { id } });
  if (!reg || reg.status !== 'PENDING_APPROVAL') return;
  const employee = await db.employee.findUniqueOrThrow({ where: { id: reg.employeeId } });
  const date = dateToStr(reg.date);
  const ctx = new AttendanceContext();
  await ctx.assertUnlocked(reg.institutionId, date);
  const tz = await ctx.timezone(reg.institutionId);
  if (reg.inMinute != null) {
    await insertManualPunch(employee, date, localToInstant(date, reg.inMinute, tz), 'IN');
  }
  if (reg.outMinute != null) {
    await insertManualPunch(employee, date, localToInstant(date, reg.outMinute, tz), 'OUT');
  }
  await computeAttendance([employee.id], date, date, ctx);
  if (reg.requestedStatus) {
    const record = await db.attendanceRecord.findFirst({
      where: { employeeId: employee.id, date: reg.date },
    });
    if (record) {
      await db.attendanceRecord.update({
        where: { id: record.id },
        data: {
          overrideStatus: reg.requestedStatus,
          overrideReason: `Regularization: ${reg.reason}`,
        },
      });
      await computeAttendance([employee.id], date, date, ctx);
    }
  }
  await db.attendanceRegularization.update({
    where: { id },
    data: { status: 'APPROVED', decidedComment: comment ?? null },
  });
  await audit.record({
    action: 'attendance.regularization_approved',
    entityType: 'employee',
    entityId: employee.id,
    after: {
      date,
      inMinute: reg.inMinute,
      outMinute: reg.outMinute,
      requestedStatus: reg.requestedStatus,
    },
    reason: comment ?? null,
    metadata: { regularizationId: id },
  });
  await emit(
    'attendance.regularized',
    { regularizationId: id, employeeId: employee.id, date },
    { institutionId: reg.institutionId },
  );
  await notify('attendance.regularization_decided', [employee.userId], {
    title: `Attendance regularization for ${date} approved`,
    link: '/me/attendance',
    institutionId: reg.institutionId,
    data: { regularizationId: id, status: 'APPROVED' },
  });
}

async function closeRegularization(
  id: string,
  comment: string | null | undefined,
  status: 'REJECTED' | 'CANCELLED',
) {
  const db = tenantDb();
  const reg = await db.attendanceRegularization.findUnique({ where: { id } });
  if (!reg || reg.status !== 'PENDING_APPROVAL') return;
  await db.attendanceRegularization.update({
    where: { id: reg.id },
    data: { status, decidedComment: comment ?? null },
  });
  await audit.record({
    action: `attendance.regularization_${status.toLowerCase()}`,
    entityType: 'employee',
    entityId: reg.employeeId,
    reason: comment ?? null,
    metadata: { regularizationId: reg.id },
  });
  if (status === 'REJECTED') {
    const employee = await db.employee.findUnique({ where: { id: reg.employeeId } });
    await notify('attendance.regularization_decided', [employee?.userId], {
      title: `Attendance regularization for ${dateToStr(reg.date)} rejected`,
      body: comment ?? undefined,
      link: '/me/attendance',
      institutionId: reg.institutionId,
      data: { regularizationId: reg.id, status },
    });
  }
}

export const regularizationWorkflowCallbacks = {
  onApproved: (ref: WorkflowInstanceRef) => applyRegularization(ref.entityId, ref.comment),
  onRejected: (ref: WorkflowInstanceRef) =>
    closeRegularization(ref.entityId, ref.comment, 'REJECTED'),
  onCancelled: (ref: WorkflowInstanceRef) =>
    closeRegularization(ref.entityId, ref.comment, 'CANCELLED'),
};

async function reload(id: string): Promise<AttendanceRegularization> {
  return tenantDb().attendanceRegularization.findUniqueOrThrow({ where: { id } });
}

export const regularizationService = {
  async request(input: CreateRegularizationInput) {
    const principal = currentPrincipal();
    const employee = await ownEmployee('attendance.regularize_own');
    assertActionable(employee);
    const ctx = new AttendanceContext();
    const timeline = await ctx.timeline(employee.id);
    const coords = timeline?.at(input.date);
    if (!coords || !timeline?.employedOn(input.date)) {
      throw new AppError(409, 'NO_ASSIGNMENT', 'You were not employed on this date');
    }
    if (input.date > localToday(await ctx.timezone(coords.institutionId))) {
      throw new ValidationError('Date must not be in the future', {
        fields: [{ path: 'date', message: 'Must not be in the future' }],
      });
    }
    if (input.inMinute != null && input.outMinute != null && input.outMinute <= input.inMinute) {
      const resolved = await ctx.shifts.resolve(employee.id, coords, input.date);
      if (!resolved.shift || resolved.shift.endMinute > resolved.shift.startMinute) {
        throw new ValidationError('Out time must be after in time', {
          fields: [{ path: 'outMinute', message: 'Must be after the in time' }],
        });
      }
    }
    await ctx.assertUnlocked(coords.institutionId, input.date);
    const db = tenantDb();
    const open = await db.attendanceRegularization.findFirst({
      where: {
        employeeId: employee.id,
        date: new Date(`${input.date}T00:00:00.000Z`),
        status: 'PENDING_APPROVAL',
      },
      select: { id: true },
    });
    if (open) throw new ConflictError('A regularization for this date is already pending');
    const reg = await db.attendanceRegularization.create({
      data: withTenant({
        employeeId: employee.id,
        date: new Date(`${input.date}T00:00:00.000Z`),
        groupId: coords.groupId,
        institutionId: coords.institutionId,
        campusId: coords.campusId,
        departmentId: coords.departmentId,
        inMinute: input.inMinute ?? null,
        outMinute: input.outMinute ?? null,
        requestedStatus: input.requestedStatus ?? null,
        reason: input.reason,
        requestedByUserId: principal.userId,
      }),
    });
    await audit.record({
      action: 'attendance.regularization_request',
      entityType: 'employee',
      entityId: employee.id,
      after: toRegularizationDto(reg),
      reason: input.reason,
      metadata: { regularizationId: reg.id },
    });
    await emit(
      'attendance.regularization_requested',
      { regularizationId: reg.id, employeeId: employee.id, date: input.date },
      { institutionId: coords.institutionId },
    );
    const instance = await submitWorkflow({
      entityType: REGULARIZATION_WORKFLOW,
      entityId: reg.id,
      title: `Attendance regularization ${input.date}: ${employee.displayName} (${employee.employeeCode})`,
      requesterUserId: principal.userId,
      institutionId: coords.institutionId,
      groupId: coords.groupId,
      departmentId: coords.departmentId,
      context: { employeeId: employee.id, date: input.date },
    });
    if (instance) {
      await db.attendanceRegularization.update({
        where: { id: reg.id },
        data: { workflowInstanceId: instance.id },
      });
    } else {
      await applyRegularization(reg.id);
    }
    return toRegularizationDto(await reload(reg.id));
  },

  async mine() {
    const employee = await ownEmployee('attendance.view_own');
    const rows = await tenantDb().attendanceRegularization.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(toRegularizationDto);
  },

  /** Withdraw an own pending request (cancels the workflow instance). */
  async cancelOwn(id: string) {
    const employee = await ownEmployee('attendance.regularize_own');
    const db = tenantDb();
    const reg = await db.attendanceRegularization.findFirst({
      where: { id, employeeId: employee.id },
    });
    if (!reg) throw new NotFoundError('Attendance regularization');
    if (reg.status !== 'PENDING_APPROVAL') {
      throw new AppError(409, 'INVALID_STATE', 'Only pending requests can be withdrawn');
    }
    const instance = reg.workflowInstanceId
      ? await db.workflowInstance.findFirst({ where: { id: reg.workflowInstanceId } })
      : null;
    if (instance && (instance.status === 'PENDING' || instance.status === 'SENT_BACK')) {
      await cancelWorkflow(instance, 'Withdrawn by employee');
    }
    await closeRegularization(reg.id, 'Withdrawn by employee', 'CANCELLED');
    return toRegularizationDto(await reload(reg.id));
  },

  async list(query: ListRegularizationsQuery) {
    const where = andScope<Prisma.AttendanceRegularizationWhereInput>(
      {
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      await scopeWhere(currentPrincipal(), 'attendance.view', 'employee'),
    );
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.attendanceRegularization.findMany({
        where,
        include: { employee: { select: { employeeCode: true, displayName: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toPageWindow(query),
      }),
      db.attendanceRegularization.count({ where }),
    ]);
    return { items: rows.map(toRegularizationDto), total };
  },
};
