import { randomUUID } from 'node:crypto';
import type { ExitEmployeeInput, RehireEmployeeInput, ResignEmployeeInput } from '@erp/shared';
import type { Employee, EmployeeChecklistKind, EmployeeChecklistStatus } from '@prisma/client';
import { audit } from '../../core/audit';
import { authorize, currentPrincipal, tryGetPrincipal } from '../../core/authz';
import { emit } from '../../core/events';
import { releaseLimit, withLimit } from '../../core/features';
import { AppError, NotFoundError } from '../../core/http/errors';
import { tenantDb, withTenant } from '../../core/tenancy';
import { resolveAssignment } from './employees.assignment';
import {
  dateStr,
  employeeAuditView,
  toChecklistDto,
  toDate,
  toDateOrNull,
  todayStr,
} from './employees.mappers';
import {
  assignmentResource,
  hrRecipients,
  loadEmployeeFor,
  loadVisibleEmployee,
  managerUserId,
  notify,
  notifyJoining,
} from './employees.service';

/* --------------------------------- Checklist hooks -------------------------------------- */

export interface ChecklistHook {
  /** Stable key, unique per kind (e.g. `asset_recovery`). */
  key: string;
  title: string;
  /** Module that contributes the item (shown in the UI; defaults to the key). */
  source?: string;
  /** Return false to skip the item for this employee. */
  appliesTo?: (employee: Employee) => boolean | Promise<boolean>;
}

const DEFAULT_ITEMS: Record<EmployeeChecklistKind, ChecklistHook[]> = {
  ONBOARDING: [
    { key: 'documents_collected', title: 'Joining documents collected' },
    { key: 'statutory_ids', title: 'Statutory ids & bank details captured' },
    { key: 'user_account', title: 'User account / system access created' },
    { key: 'induction', title: 'Induction completed' },
  ],
  EXIT: [
    { key: 'handover', title: 'Work handover completed' },
    { key: 'access_revoked', title: 'System access revoked' },
    { key: 'clearance', title: 'Department clearance' },
    { key: 'final_settlement', title: 'Full & final settlement initiated' },
  ],
};

const hooks: Record<EmployeeChecklistKind, Map<string, ChecklistHook>> = {
  ONBOARDING: new Map(),
  EXIT: new Map(),
};

/**
 * Contribute an item to every new onboarding / exit checklist. Future modules plug in here —
 * e.g. the assets module registers `{ kind: 'EXIT', key: 'asset_recovery', ... }` and marks the
 * item DONE (via `completeChecklistItem`) once all assets are returned.
 */
export function registerChecklistHook(kind: EmployeeChecklistKind, hook: ChecklistHook): void {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(hook.key))
    throw new Error(`Invalid checklist key ${hook.key}`);
  hooks[kind].set(hook.key, hook);
}

/** Shorthand for exit hooks (asset recovery, library clearance…). */
export const registerExitChecklistHook = (hook: ChecklistHook) =>
  registerChecklistHook('EXIT', hook);

/** Create the default + hooked items for an employee (idempotent: existing keys are kept). */
export async function ensureChecklist(employee: Employee, kind: EmployeeChecklistKind) {
  const db = tenantDb();
  const existing = new Set(
    (
      await db.employeeChecklistItem.findMany({
        where: { employeeId: employee.id, kind },
        select: { key: true },
      })
    ).map((r) => r.key),
  );
  const items = [...DEFAULT_ITEMS[kind], ...hooks[kind].values()];
  for (const item of items) {
    if (existing.has(item.key)) continue;
    if (item.appliesTo && !(await item.appliesTo(employee))) continue;
    await db.employeeChecklistItem.create({
      data: withTenant({
        employeeId: employee.id,
        kind,
        key: item.key,
        title: item.title,
        source: item.source ?? (hooks[kind].has(item.key) ? item.key : 'default'),
      }),
    });
  }
}

/** Reset an exit checklist (used on rehire so a later exit starts fresh). */
async function clearChecklist(employeeId: string, kind: EmployeeChecklistKind) {
  await tenantDb().employeeChecklistItem.deleteMany({ where: { employeeId, kind } });
}

/**
 * Mark a checklist item by key — for modules completing their hook item (runs without an HR
 * permission check; callers authorize their own action).
 */
export async function completeChecklistItem(
  employeeId: string,
  kind: EmployeeChecklistKind,
  key: string,
  status: EmployeeChecklistStatus = 'DONE',
  notes?: string | null,
) {
  const db = tenantDb();
  const item = await db.employeeChecklistItem.findFirst({ where: { employeeId, kind, key } });
  if (!item) return null;
  return db.employeeChecklistItem.update({
    where: { id: item.id },
    data: {
      status,
      notes: notes ?? item.notes,
      completedAt: status === 'PENDING' ? null : new Date(),
      completedByUserId: status === 'PENDING' ? null : (tryGetPrincipal()?.userId ?? null),
    },
  });
}

/* --------------------------------- Lifecycle service ------------------------------------ */

function assertStatus(employee: Employee, allowed: Employee['status'][], action: string) {
  if (!allowed.includes(employee.status)) {
    throw new AppError(
      409,
      'INVALID_STATE',
      `Cannot ${action} an employee in status ${employee.status}`,
    );
  }
}

async function transition(
  before: Employee,
  data: Parameters<ReturnType<typeof tenantDb>['employee']['update']>[0]['data'],
  action: string,
  event: string | null,
  reason?: string | null,
) {
  const after = await tenantDb().employee.update({ where: { id: before.id }, data });
  await audit.record({
    action: `employee.${action}`,
    entityType: 'employee',
    entityId: before.id,
    before: employeeAuditView(before),
    after: employeeAuditView(after),
    reason: reason ?? null,
  });
  if (event) {
    await emit(
      event,
      {
        employeeId: after.id,
        employeeCode: after.employeeCode,
        institutionId: after.institutionId,
        status: after.status,
      },
      { institutionId: after.institutionId },
    );
  }
  return after;
}

export const lifecycleService = {
  async checklist(id: string) {
    await loadVisibleEmployee(id);
    const rows = await tenantDb().employeeChecklistItem.findMany({
      where: { employeeId: id },
      orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toChecklistDto);
  },

  async addChecklistItem(id: string, input: { kind: EmployeeChecklistKind; title: string }) {
    await loadEmployeeFor(id, 'employee.lifecycle');
    const row = await tenantDb().employeeChecklistItem.create({
      data: withTenant({
        employeeId: id,
        kind: input.kind,
        key: `custom_${randomUUID().slice(0, 8)}`,
        title: input.title,
        source: 'custom',
      }),
    });
    await audit.record({
      action: 'employee.checklist.create',
      entityType: 'employee',
      entityId: id,
      after: { kind: row.kind, key: row.key, title: row.title },
    });
    return toChecklistDto(row);
  },

  async updateChecklistItem(
    id: string,
    itemId: string,
    input: { status: EmployeeChecklistStatus; notes?: string | null },
  ) {
    await loadEmployeeFor(id, 'employee.lifecycle');
    const db = tenantDb();
    const item = await db.employeeChecklistItem.findFirst({
      where: { id: itemId, employeeId: id },
    });
    if (!item) throw new NotFoundError('Checklist item');
    const row = await completeChecklistItem(id, item.kind, item.key, input.status, input.notes);
    await audit.record({
      action: 'employee.checklist.update',
      entityType: 'employee',
      entityId: id,
      before: { key: item.key, status: item.status },
      after: { key: item.key, status: input.status, notes: input.notes ?? null },
    });
    return toChecklistDto(row!);
  },

  /** DRAFT → ONBOARDING (creates the onboarding checklist). */
  async onboard(id: string, input: { dateOfJoining?: string }) {
    const before = await loadEmployeeFor(id, 'employee.lifecycle');
    assertStatus(before, ['DRAFT'], 'onboard');
    const after = await transition(
      before,
      {
        status: 'ONBOARDING',
        ...(input.dateOfJoining ? { dateOfJoining: toDate(input.dateOfJoining) } : {}),
      },
      'onboard',
      'employee.updated',
    );
    await syncJoiningHistory(after);
    await ensureChecklist(after, 'ONBOARDING');
    await notifyJoining(after);
    return after.id;
  },

  /** DRAFT / ONBOARDING → ACTIVE. */
  async activate(id: string, input: { dateOfJoining?: string; probationEndDate?: string | null }) {
    const before = await loadEmployeeFor(id, 'employee.lifecycle');
    assertStatus(before, ['DRAFT', 'ONBOARDING'], 'activate');
    const joining = input.dateOfJoining ?? dateStrOr(before.dateOfJoining) ?? todayStr();
    const after = await transition(
      before,
      {
        status: 'ACTIVE',
        dateOfJoining: toDate(joining),
        ...(input.probationEndDate !== undefined
          ? { probationEndDate: toDateOrNull(input.probationEndDate) }
          : {}),
      },
      'activate',
      'employee.activated',
    );
    await syncJoiningHistory(after);
    if (before.status === 'DRAFT') await notifyJoining(after);
    return after.id;
  },

  /** Probation confirmation. */
  async confirm(id: string, input: { confirmationDate: string }) {
    const before = await loadEmployeeFor(id, 'employee.lifecycle');
    assertStatus(before, ['ACTIVE'], 'confirm');
    await transition(
      before,
      { confirmationDate: toDate(input.confirmationDate) },
      'confirm',
      'employee.confirmed',
    );
    return id;
  },

  /** ACTIVE / ONBOARDING → ON_NOTICE; opens the exit checklist. */
  async resign(id: string, input: ResignEmployeeInput) {
    const before = await loadEmployeeFor(id, 'employee.lifecycle');
    assertStatus(before, ['ACTIVE', 'ONBOARDING'], 'record a resignation for');
    const after = await transition(
      before,
      {
        status: 'ON_NOTICE',
        resignationDate: toDate(input.resignationDate),
        lastWorkingDate: toDate(input.lastWorkingDate),
        exitReason: input.reason,
      },
      'resign',
      'employee.resigned',
      input.reason,
    );
    await ensureChecklist(after, 'EXIT');
    await notify(
      'employee.exiting',
      [...(await hrRecipients(after)), await managerUserId(after.reportingManagerId)],
      {
        title: `${after.displayName} (${after.employeeCode}) has resigned`,
        body: `Last working day: ${input.lastWorkingDate}.`,
        link: `/hr/employees/${after.id}`,
        institutionId: after.institutionId,
        data: { employeeId: after.id },
      },
    );
    return id;
  },

  async withdrawResignation(id: string, input: { reason?: string | null }) {
    const before = await loadEmployeeFor(id, 'employee.lifecycle');
    assertStatus(before, ['ON_NOTICE'], 'withdraw the resignation of');
    await transition(
      before,
      { status: 'ACTIVE', resignationDate: null, lastWorkingDate: null, exitReason: null },
      'resignation_withdrawn',
      'employee.updated',
      input.reason,
    );
    await clearChecklist(id, 'EXIT');
    return id;
  },

  /**
   * → EXITED. Closes open history rows at the exit date, unlinks nothing (the user keeps
   * self-service access to their documents), releases the employee limit slot. Pending exit
   * checklist items block the exit unless `force`.
   */
  async exit(id: string, input: ExitEmployeeInput) {
    const before = await loadEmployeeFor(id, 'employee.lifecycle');
    assertStatus(before, ['ACTIVE', 'ONBOARDING', 'ON_NOTICE'], 'exit');
    await ensureChecklist(before, 'EXIT');
    const db = tenantDb();
    const pending = await db.employeeChecklistItem.count({
      where: { employeeId: id, kind: 'EXIT', status: 'PENDING' },
    });
    if (pending > 0 && !input.force) {
      throw new AppError(
        409,
        'EXIT_CHECKLIST_PENDING',
        `${pending} exit checklist item(s) are still pending; complete them or pass force=true`,
        { pending },
      );
    }
    const exitDate = toDate(input.exitDate);
    const after = await db.$transaction(async (tx) => {
      const where = { employeeId: id, effectiveTo: null };
      await tx.employeeDepartment.updateMany({ where, data: { effectiveTo: exitDate } });
      await tx.employeePosition.updateMany({ where, data: { effectiveTo: exitDate } });
      await tx.employeeReportingLine.updateMany({ where, data: { effectiveTo: exitDate } });
      await tx.employeeMovement.updateMany({
        where: { employeeId: id, status: { in: ['PENDING_APPROVAL', 'SCHEDULED'] } },
        data: { status: 'CANCELLED', decidedComment: 'Employee exited' },
      });
      return tx.employee.update({
        where: { id },
        data: {
          status: 'EXITED',
          exitDate,
          exitType: input.exitType,
          exitReason: input.reason ?? before.exitReason,
          lastWorkingDate: before.lastWorkingDate ?? exitDate,
        },
      });
    });
    await releaseLimit('employees', 1);
    await audit.record({
      action: 'employee.exit',
      entityType: 'employee',
      entityId: id,
      before: employeeAuditView(before),
      after: employeeAuditView(after),
      reason: input.reason ?? null,
      metadata: { exitType: input.exitType, forced: pending > 0 },
    });
    await emit(
      'employee.exited',
      {
        employeeId: id,
        employeeCode: after.employeeCode,
        institutionId: after.institutionId,
        exitDate: input.exitDate,
        exitType: input.exitType,
      },
      { institutionId: after.institutionId },
    );
    await notify(
      'employee.exited',
      [...(await hrRecipients(after)), await managerUserId(after.reportingManagerId)],
      {
        title: `${after.displayName} (${after.employeeCode}) has exited`,
        body: `Exit date: ${input.exitDate} (${input.exitType.toLowerCase()}).`,
        link: `/hr/employees/${id}`,
        institutionId: after.institutionId,
        data: { employeeId: id },
      },
    );
    return id;
  },

  /**
   * EXITED → ONBOARDING on the SAME employee record (code, documents and history are kept). New
   * history rows open at the new joining date — possibly at another institution of the org.
   */
  async rehire(id: string, input: RehireEmployeeInput) {
    const before = await loadEmployeeFor(id, 'employee.lifecycle');
    assertStatus(before, ['EXITED'], 'rehire');
    const joining = toDate(input.dateOfJoining);
    if (before.exitDate && joining <= before.exitDate) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Rehire date must be after the exit date');
    }
    const changesInstitution = input.institutionId && input.institutionId !== before.institutionId;
    const assignment = await resolveAssignment(
      {
        institutionId: input.institutionId ?? before.institutionId,
        campusId:
          input.campusId !== undefined
            ? input.campusId
            : changesInstitution
              ? null
              : before.campusId,
        departmentId:
          input.departmentId !== undefined
            ? input.departmentId
            : changesInstitution
              ? null
              : before.departmentId,
        designationId:
          input.designationId !== undefined ? input.designationId : before.designationId,
        reportingManagerId:
          input.reportingManagerId !== undefined ? input.reportingManagerId : null,
      },
      id,
    );
    await authorize(currentPrincipal(), 'employee.lifecycle', assignmentResource(assignment));
    const employmentType = input.employmentType ?? before.employmentType;
    const movementId = randomUUID();
    const after = await withLimit('employees', 1, () =>
      tenantDb().$transaction(async (tx) => {
        await tx.employeeMovement.create({
          data: withTenant({
            id: movementId,
            employeeId: id,
            type: 'REHIRE' as const,
            status: 'APPLIED' as const,
            effectiveDate: joining,
            fromGroupId: before.groupId,
            fromInstitutionId: before.institutionId,
            fromCampusId: before.campusId,
            fromDepartmentId: before.departmentId,
            fromDesignationId: before.designationId,
            fromReportingManagerId: before.reportingManagerId,
            toGroupId: assignment.groupId,
            toInstitutionId: assignment.institutionId,
            toCampusId: assignment.campusId,
            toDepartmentId: assignment.departmentId,
            toDesignationId: assignment.designationId,
            toReportingManagerId: assignment.reportingManagerId,
            reason: input.reason ?? 'Rehire',
            requestedByUserId: tryGetPrincipal()?.userId ?? null,
            appliedAt: new Date(),
          }),
        });
        await tx.employeeDepartment.create({
          data: withTenant({
            employeeId: id,
            groupId: assignment.groupId,
            institutionId: assignment.institutionId,
            campusId: assignment.campusId,
            departmentId: assignment.departmentId,
            isPrimary: true,
            effectiveFrom: joining,
            movementId,
          }),
        });
        await tx.employeePosition.create({
          data: withTenant({
            employeeId: id,
            groupId: assignment.groupId,
            institutionId: assignment.institutionId,
            designationId: assignment.designationId,
            employmentType,
            effectiveFrom: joining,
            reason: 'Rehire',
            movementId,
          }),
        });
        if (assignment.reportingManagerId) {
          await tx.employeeReportingLine.create({
            data: withTenant({
              employeeId: id,
              managerId: assignment.reportingManagerId,
              effectiveFrom: joining,
              movementId,
            }),
          });
        }
        return tx.employee.update({
          where: { id },
          data: {
            ...assignment,
            employmentType,
            status: 'ONBOARDING',
            dateOfJoining: joining,
            probationEndDate: null,
            confirmationDate: null,
            resignationDate: null,
            lastWorkingDate: null,
            exitDate: null,
            exitType: null,
            exitReason: null,
            rehireCount: { increment: 1 },
          },
        });
      }),
    );
    await clearChecklist(id, 'EXIT');
    await clearChecklist(id, 'ONBOARDING');
    await ensureChecklist(after, 'ONBOARDING');
    await audit.record({
      action: 'employee.rehire',
      entityType: 'employee',
      entityId: id,
      before: employeeAuditView(before),
      after: employeeAuditView(after),
      reason: input.reason ?? null,
      metadata: { movementId },
    });
    await emit(
      'employee.rehired',
      {
        employeeId: id,
        employeeCode: after.employeeCode,
        institutionId: after.institutionId,
        dateOfJoining: input.dateOfJoining,
      },
      { institutionId: after.institutionId },
    );
    await notifyJoining(after);
    return id;
  },
};

const dateStrOr = (d: Date | null) => (d ? dateStr(d) : null);

/**
 * Before activation the initial history rows start at the (possibly unknown) planned joining
 * date; align them with the actual joining date when it is set.
 */
async function syncJoiningHistory(employee: Employee) {
  if (!employee.dateOfJoining || employee.rehireCount > 0) return;
  const db = tenantDb();
  const where = { employeeId: employee.id, movementId: null };
  const first = await db.employeeDepartment.findFirst({
    where,
    orderBy: { effectiveFrom: 'asc' },
  });
  if (!first || first.effectiveFrom.getTime() === employee.dateOfJoining.getTime()) return;
  // Only re-date the opening rows (no movements applied yet).
  const moved = await db.employeeMovement.count({
    where: { employeeId: employee.id, status: 'APPLIED' },
  });
  if (moved > 0) return;
  const data = { effectiveFrom: employee.dateOfJoining };
  await db.employeeDepartment.updateMany({ where, data });
  await db.employeePosition.updateMany({ where, data });
  await db.employeeReportingLine.updateMany({ where, data });
}
