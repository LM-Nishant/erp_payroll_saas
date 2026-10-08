import type { Prisma } from '@prisma/client';
import type {
  AcknowledgeAssignmentInput,
  CheckinAssetInput,
  CheckoutAssetInput,
  CreateAssetTransferInput,
  ListAssetAssignmentsQuery,
  ListAssetTransfersQuery,
  MyAssetDto,
  ReportAssetIssueInput,
} from '@erp/shared';
import { audit } from '../../core/audit';
import {
  accessFor,
  andScope,
  authorize,
  can,
  currentPrincipal,
  hierarchyResource,
  scopeWhere,
} from '../../core/authz';
import { documentEngine } from '../../core/documents';
import { emit } from '../../core/events';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  InvalidReferenceError,
  NotFoundError,
} from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { logger } from '../../core/logger';
import { renderPdfTemplate, storedPdfMetadata } from '../../core/pdf';
import { tenantDb, withTenant } from '../../core/tenancy';
import { submitWorkflow, type WorkflowInstanceRef } from '../../core/workflow';
import { completeChecklistItem } from '../../modules/employees/employees.lifecycle';
import { dateOnly, todayUtc } from './assets.logic';
import {
  assetInclude,
  assetRefSelect,
  employeeRefSelect,
  toAssetDto,
  toAssignmentDto,
  toDate,
  toTransferDto,
  type AssetWithRefs,
} from './assets.mappers';
import { holders, notifyUsers } from './assets.notify';
import {
  assertAssetStatus,
  assetAuditView,
  loadAsset,
  loadAssetFor,
  resolvePlacement,
} from './assets.service';
import { maintenanceService } from './assets.maintenance';

export const HANDOVER_TEMPLATE = 'asset_handover';
export const TRANSFER_WORKFLOW = 'asset_transfer';
export const EXIT_CHECKLIST_KEY = 'asset_recovery';
const ACTIVE_EMPLOYEE = ['ONBOARDING', 'ACTIVE', 'ON_NOTICE'];

/** The employee record linked to the signed-in user (self-service). */
export async function currentEmployee() {
  const userId = currentPrincipal().userId;
  if (!userId) throw new ForbiddenError('No employee profile linked to this account');
  const employee = await tenantDb().employee.findFirst({
    where: { userId },
    select: {
      id: true,
      userId: true,
      employeeCode: true,
      displayName: true,
      institutionId: true,
    },
  });
  if (!employee) throw new NotFoundError('Employee profile');
  return employee;
}

/** Number of assets an employee still holds. */
export async function activeAssignmentCount(employeeId: string) {
  return tenantDb().assetAssignment.count({ where: { employeeId, status: 'ACTIVE' } });
}

/** Mark the exit checklist item done once nothing is outstanding (no-op without a checklist). */
export async function syncExitChecklist(employeeId: string) {
  if ((await activeAssignmentCount(employeeId)) > 0) return;
  await completeChecklistItem(
    employeeId,
    'EXIT',
    EXIT_CHECKLIST_KEY,
    'DONE',
    'All assigned assets returned',
  );
}

async function generateHandover(
  asset: AssetWithRefs,
  assignment: { id: string; assignedAt: Date; accessories: unknown; conditionOut: string },
  employee: { displayName: string; employeeCode: string } | null,
  target: string,
) {
  try {
    const input = {
      assetTag: asset.assetTag,
      assetName: asset.name,
      category: asset.category.name,
      makeModel: [asset.make, asset.model].filter(Boolean).join(' ') || '—',
      serialNo: asset.serialNo ?? '—',
      institution: asset.institution?.name ?? '',
      assignedTo: employee ? `${employee.displayName} (${employee.employeeCode})` : target,
      assignedAt: dateOnly(assignment.assignedAt),
      condition: assignment.conditionOut,
      accessories: Array.isArray(assignment.accessories)
        ? (assignment.accessories as string[]).join(', ') || '—'
        : '—',
    };
    const rendered = await renderPdfTemplate(HANDOVER_TEMPLATE, input, {
      groupId: asset.groupId,
      institutionId: asset.institutionId,
      campusId: asset.campusId,
      departmentId: asset.departmentId,
    });
    const doc = await documentEngine.attach({
      ownerType: 'asset',
      ownerId: asset.id,
      module: 'assets',
      metadata: {
        title: `Handover — ${asset.assetTag} to ${employee?.displayName ?? target}`,
        category: 'asset',
        documentType: 'asset_handover',
        confidentiality: 'INTERNAL',
      },
      file: {
        fileName: `handover-${asset.assetTag}.pdf`,
        mimeType: 'application/pdf',
        body: rendered.body,
      },
      extra: storedPdfMetadata(HANDOVER_TEMPLATE, rendered, input),
      authorization: 'caller',
    });
    await tenantDb().assetAssignment.update({
      where: { id: assignment.id },
      data: { handoverDocumentId: doc.id },
    });
    return doc.id;
  } catch (err) {
    logger.warn({ err, assetId: asset.id }, 'assets: handover PDF generation failed');
    return null;
  }
}

/* --------------------------------------- Custody ---------------------------------------- */

export const custodyService = {
  async checkout(assetId: string, input: CheckoutAssetInput) {
    const asset = await loadAssetFor(assetId, 'asset.assign');
    assertAssetStatus(asset, ['IN_STOCK'], 'assign');
    const db = tenantDb();
    let employee: {
      id: string;
      userId: string | null;
      displayName: string;
      employeeCode: string;
      status: string;
    } | null = null;
    if (input.targetType === 'EMPLOYEE') {
      employee = await db.employee.findUnique({
        where: { id: input.employeeId! },
        select: { ...employeeRefSelect, status: true },
      });
      if (!employee) throw new InvalidReferenceError('employeeId', 'Employee');
      if (!ACTIVE_EMPLOYEE.includes(employee.status))
        throw new AppError(
          409,
          'EMPLOYEE_NOT_ACTIVE',
          'Assets can only be assigned to active employees',
        );
    }
    if (input.targetType === 'DEPARTMENT') {
      const dept = await db.department.findUnique({ where: { id: input.departmentId! } });
      if (!dept || dept.institutionId !== asset.institutionId)
        throw new InvalidReferenceError('departmentId', 'Department');
    }
    const assignedAt = input.assignedAt ? toDate(input.assignedAt) : todayUtc();
    const assignment = await db.$transaction(async (tx) => {
      const fresh = await tx.asset.updateMany({
        where: { id: asset.id, status: 'IN_STOCK' },
        data: {
          status: 'ASSIGNED',
          custodianEmployeeId: employee?.id ?? null,
          condition: input.condition ?? asset.condition,
          ...(input.targetType === 'LOCATION' && input.location
            ? { location: input.location }
            : {}),
        },
      });
      if (fresh.count !== 1) throw new ConflictError('Asset was assigned concurrently');
      return tx.assetAssignment.create({
        data: withTenant({
          assetId: asset.id,
          groupId: asset.groupId,
          institutionId: asset.institutionId,
          campusId: asset.campusId,
          departmentId: asset.departmentId,
          targetType: input.targetType,
          employeeId: employee?.id ?? null,
          assignedDepartmentId: input.targetType === 'DEPARTMENT' ? input.departmentId! : null,
          location: input.location ?? null,
          assignedAt,
          expectedReturnDate: input.expectedReturnDate ? toDate(input.expectedReturnDate) : null,
          accessories: input.accessories as Prisma.InputJsonValue,
          conditionOut: input.condition ?? asset.condition,
          notes: input.notes ?? null,
          assignedByUserId: currentPrincipal().userId,
        }),
      });
    });
    const handoverDocumentId = await generateHandover(
      asset,
      assignment,
      employee,
      input.location ?? input.targetType.toLowerCase(),
    );
    await audit.record({
      action: 'asset.assigned',
      entityType: 'asset',
      entityId: asset.id,
      before: assetAuditView(asset),
      after: {
        assignmentId: assignment.id,
        targetType: input.targetType,
        employeeId: employee?.id,
      },
    });
    await emit(
      'asset.assigned',
      {
        assetId: asset.id,
        assetTag: asset.assetTag,
        assignmentId: assignment.id,
        employeeId: employee?.id ?? null,
      },
      { institutionId: asset.institutionId },
    );
    if (employee?.userId) {
      await notifyUsers('asset.assigned', [employee.userId], {
        title: `Asset assigned: ${asset.name} (${asset.assetTag})`,
        body: 'Please review and acknowledge receipt in My assets.',
        link: '/my/assets',
        institutionId: asset.institutionId,
        data: { assetId: asset.id, assignmentId: assignment.id },
      });
    }
    return toAssignmentDto({
      ...assignment,
      handoverDocumentId,
      asset: { id: asset.id, assetTag: asset.assetTag, name: asset.name, status: 'ASSIGNED' },
      employee: employee
        ? {
            id: employee.id,
            employeeCode: employee.employeeCode,
            displayName: employee.displayName,
            userId: employee.userId,
          }
        : null,
    });
  },

  async checkin(assetId: string, input: CheckinAssetInput) {
    const asset = await loadAssetFor(assetId, 'asset.return');
    assertAssetStatus(asset, ['ASSIGNED', 'UNDER_REPAIR'], 'check in');
    const db = tenantDb();
    const active = await db.assetAssignment.findFirst({
      where: { assetId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    if (!active) throw new AppError(409, 'NOT_ASSIGNED', 'Asset has no active assignment');
    const returnedAt = input.returnedAt ? toDate(input.returnedAt) : todayUtc();
    if (returnedAt < active.assignedAt)
      throw new AppError(422, 'INVALID_DATE', 'Return date is before the assignment date');
    const conditionIn =
      input.returnStatus === 'DAMAGED' ? (input.condition ?? 'DAMAGED') : (input.condition ?? null);
    const nextStatus =
      input.returnStatus === 'MISSING'
        ? 'LOST'
        : asset.status === 'UNDER_REPAIR'
          ? 'UNDER_REPAIR'
          : 'IN_STOCK';
    const updated = await db.$transaction(async (tx) => {
      const row = await tx.assetAssignment.update({
        where: { id: active.id },
        data: {
          status: 'RETURNED',
          returnedAt,
          returnStatus: input.returnStatus,
          conditionIn,
          recoveryAmount: input.recoveryAmount ?? null,
          returnNotes: input.notes ?? null,
          returnedByUserId: currentPrincipal().userId,
        },
      });
      await tx.asset.update({
        where: { id: assetId },
        data: {
          status: nextStatus,
          custodianEmployeeId: null,
          ...(conditionIn ? { condition: conditionIn } : {}),
        },
      });
      return row;
    });
    await audit.record({
      action: 'asset.returned',
      entityType: 'asset',
      entityId: assetId,
      before: assetAuditView(asset),
      after: { assignmentId: active.id, returnStatus: input.returnStatus, status: nextStatus },
    });
    await emit(
      'asset.returned',
      {
        assetId,
        assetTag: asset.assetTag,
        assignmentId: active.id,
        employeeId: active.employeeId,
        returnStatus: input.returnStatus,
      },
      { institutionId: asset.institutionId },
    );
    if (active.employeeId) await syncExitChecklist(active.employeeId);
    return toAssignmentDto({
      ...updated,
      asset: { id: asset.id, assetTag: asset.assetTag, name: asset.name, status: nextStatus },
    });
  },

  async listAssignments(query: ListAssetAssignmentsQuery) {
    const { skip, take } = toPageWindow(query);
    const where = andScope<Prisma.AssetAssignmentWhereInput>(
      {
        institutionId: query.institutionId,
        assetId: query.assetId,
        employeeId: query.employeeId,
        status: query.status,
        ...(query.acknowledged === 'true'
          ? { acknowledgedAt: { not: null } }
          : query.acknowledged === 'false'
            ? { acknowledgedAt: null, targetType: 'EMPLOYEE' }
            : {}),
        ...(query.search
          ? {
              OR: [
                { asset: { assetTag: { contains: query.search } } },
                { asset: { name: { contains: query.search } } },
                { employee: { displayName: { contains: query.search } } },
                { employee: { employeeCode: { contains: query.search } } },
              ],
            }
          : {}),
      },
      await scopeWhere(currentPrincipal(), 'asset.view', 'asset'),
    );
    const db = tenantDb();
    const [items, total] = await Promise.all([
      db.assetAssignment.findMany({
        where,
        include: {
          asset: { select: assetRefSelect },
          employee: { select: employeeRefSelect },
        },
        orderBy: [{ assignedAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
      }),
      db.assetAssignment.count({ where }),
    ]);
    return { items: items.map(toAssignmentDto), total };
  },

  async handoverUrl(assignmentId: string) {
    const assignment = await tenantDb().assetAssignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) throw new NotFoundError('Assignment');
    const own = assignment.employeeId
      ? await tenantDb().employee.findFirst({
          where: { id: assignment.employeeId, userId: currentPrincipal().userId ?? '__none__' },
          select: { id: true },
        })
      : null;
    if (!own && !(await can(currentPrincipal(), 'asset.view', hierarchyResource.asset(assignment))))
      throw new NotFoundError('Assignment');
    if (!assignment.handoverDocumentId) throw new NotFoundError('Handover document');
    const url = await documentEngine.currentVersionUrl(assignment.handoverDocumentId, 'attachment');
    if (!url) throw new NotFoundError('Handover document');
    return url;
  },

  /* ------------------------------------ Self-service ------------------------------------ */

  async myAssets(): Promise<MyAssetDto[]> {
    const employee = await currentEmployee();
    const rows = await tenantDb().assetAssignment.findMany({
      where: { employeeId: employee.id, status: 'ACTIVE' },
      include: { asset: { include: assetInclude } },
      orderBy: [{ assignedAt: 'desc' }],
    });
    return rows.map(({ asset, ...a }) => ({
      assignment: toAssignmentDto({
        ...a,
        asset: { id: asset.id, assetTag: asset.assetTag, name: asset.name, status: asset.status },
      }),
      asset: toAssetDto(asset as AssetWithRefs),
    }));
  },

  async acknowledge(assignmentId: string, input: AcknowledgeAssignmentInput) {
    const employee = await currentEmployee();
    const assignment = await tenantDb().assetAssignment.findUnique({ where: { id: assignmentId } });
    if (!assignment || assignment.employeeId !== employee.id) throw new NotFoundError('Assignment');
    if (assignment.status !== 'ACTIVE')
      throw new AppError(409, 'NOT_ACTIVE', 'Assignment is no longer active');
    if (assignment.acknowledgedAt) return toAssignmentDto(assignment);
    const updated = await tenantDb().assetAssignment.update({
      where: { id: assignmentId },
      data: {
        acknowledgedAt: new Date(),
        acknowledgedByUserId: currentPrincipal().userId,
        acknowledgementNote: input.note ?? null,
      },
    });
    await audit.record({
      action: 'asset_assignment.acknowledged',
      entityType: 'asset_assignment',
      entityId: assignmentId,
      after: { acknowledgedAt: updated.acknowledgedAt, note: input.note ?? null },
    });
    await emit(
      'asset.acknowledged',
      { assetId: assignment.assetId, assignmentId, employeeId: employee.id },
      { institutionId: assignment.institutionId },
    );
    return toAssignmentDto(updated);
  },

  async reportIssue(assignmentId: string, input: ReportAssetIssueInput) {
    const employee = await currentEmployee();
    const assignment = await tenantDb().assetAssignment.findUnique({ where: { id: assignmentId } });
    if (!assignment || assignment.employeeId !== employee.id || assignment.status !== 'ACTIVE')
      throw new NotFoundError('Assignment');
    return maintenanceService.createTicket(
      assignment.assetId,
      {
        type: 'REPAIR',
        priority: input.priority,
        title: input.title,
        description: input.description ?? null,
      },
      { reportedByEmployeeId: employee.id, selfService: true },
    );
  },

  /* -------------------------------------- Transfers ------------------------------------- */

  async listTransfers(query: ListAssetTransfersQuery) {
    const { skip, take } = toPageWindow(query);
    const principal = currentPrincipal();
    const scope = await scopeWhere(principal, 'asset.view', 'asset');
    const access = await accessFor(principal, 'asset.view');
    const base: Prisma.AssetTransferWhereInput = {
      assetId: query.assetId,
      status: query.status,
      ...(query.institutionId
        ? { OR: [{ institutionId: query.institutionId }, { toInstitutionId: query.institutionId }] }
        : {}),
    };
    // Visible from the source scope, or to the receiving institution's managers.
    const where: Prisma.AssetTransferWhereInput = scope
      ? { AND: [base, { OR: [scope, { toInstitutionId: { in: [...access.institutionIds] } }] }] }
      : base;
    const db = tenantDb();
    const [items, total] = await Promise.all([
      db.assetTransfer.findMany({
        where,
        include: { asset: { select: { id: true, assetTag: true, name: true } } },
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take,
      }),
      db.assetTransfer.count({ where }),
    ]);
    return { items: items.map(toTransferDto), total };
  },

  async requestTransfer(assetId: string, input: CreateAssetTransferInput) {
    const asset = await loadAssetFor(assetId, 'asset.manage');
    assertAssetStatus(asset, ['IN_STOCK'], 'transfer');
    const db = tenantDb();
    const pending = await db.assetTransfer.findFirst({
      where: { assetId, status: 'PENDING_APPROVAL' },
    });
    if (pending) throw new ConflictError('A transfer is already pending for this asset');
    const to = await resolvePlacement(
      input.toInstitutionId,
      input.toCampusId,
      input.toDepartmentId,
    );
    if (
      to.institutionId === asset.institutionId &&
      to.departmentId === asset.departmentId &&
      to.campusId === asset.campusId &&
      (input.toLocation ?? null) === asset.location
    )
      throw new AppError(422, 'NO_CHANGE', 'Transfer destination matches the current placement');
    const transfer = await db.assetTransfer.create({
      data: withTenant({
        assetId,
        groupId: asset.groupId,
        institutionId: asset.institutionId,
        campusId: asset.campusId,
        departmentId: asset.departmentId,
        toGroupId: to.groupId,
        toInstitutionId: to.institutionId,
        toCampusId: to.campusId,
        toDepartmentId: to.departmentId,
        fromLocation: asset.location,
        toLocation: input.toLocation ?? null,
        reason: input.reason ?? null,
        requestedByUserId: currentPrincipal().userId,
      }),
    });
    await audit.record({
      action: 'asset_transfer.requested',
      entityType: 'asset_transfer',
      entityId: transfer.id,
      after: toTransferDto(transfer),
      reason: input.reason ?? undefined,
    });
    const instance = await submitWorkflow({
      entityType: TRANSFER_WORKFLOW,
      entityId: transfer.id,
      title: `Asset transfer: ${asset.name} (${asset.assetTag})`,
      institutionId: asset.institutionId,
      groupId: asset.groupId,
      departmentId: asset.departmentId,
      context: {
        assetId,
        categoryKind: asset.category.kind,
        purchaseCost: Number(asset.purchaseCost),
        crossInstitution: to.institutionId !== asset.institutionId,
        toInstitutionId: to.institutionId,
      },
    });
    if (instance) {
      const row = await db.assetTransfer.update({
        where: { id: transfer.id },
        data: { workflowInstanceId: instance.id },
      });
      return toTransferDto(row);
    }
    // No approval workflow configured for this scope → the transfer takes effect immediately.
    return toTransferDto(await completeTransfer(transfer.id, null));
  },

  async cancelTransfer(transferId: string) {
    const transfer = await tenantDb().assetTransfer.findUnique({ where: { id: transferId } });
    if (
      !transfer ||
      !(await can(currentPrincipal(), 'asset.view', hierarchyResource.asset(transfer)))
    )
      throw new NotFoundError('Transfer');
    await authorize(currentPrincipal(), 'asset.manage', hierarchyResource.asset(transfer));
    if (transfer.status !== 'PENDING_APPROVAL')
      throw new AppError(409, 'NOT_PENDING', 'Only pending transfers can be cancelled');
    if (transfer.workflowInstanceId)
      throw new AppError(409, 'WORKFLOW_PENDING', 'Withdraw the approval request from Approvals');
    return toTransferDto(await closeTransfer(transferId, 'CANCELLED', null));
  },
};

/** Apply an approved transfer (idempotent). */
export async function completeTransfer(transferId: string, comment: string | null) {
  const db = tenantDb();
  const transfer = await db.assetTransfer.findUnique({ where: { id: transferId } });
  if (!transfer) throw new NotFoundError('Transfer');
  if (transfer.status !== 'PENDING_APPROVAL') return transfer;
  const asset = await db.asset.findUnique({ where: { id: transfer.assetId } });
  if (!asset) throw new NotFoundError('Asset');
  const updated = await db.$transaction(async (tx) => {
    await tx.asset.update({
      where: { id: asset.id },
      data: {
        groupId: transfer.toGroupId,
        institutionId: transfer.toInstitutionId,
        campusId: transfer.toCampusId,
        departmentId: transfer.toDepartmentId,
        location:
          transfer.toLocation ??
          (transfer.toInstitutionId === asset.institutionId ? asset.location : null),
      },
    });
    return tx.assetTransfer.update({
      where: { id: transferId },
      data: {
        status: 'COMPLETED',
        decidedAt: new Date(),
        decidedByUserId: currentPrincipal().userId,
        decisionComment: comment,
      },
    });
  });
  await audit.record({
    action: 'asset.transferred',
    entityType: 'asset',
    entityId: asset.id,
    before: {
      institutionId: asset.institutionId,
      departmentId: asset.departmentId,
      location: asset.location,
    },
    after: {
      institutionId: transfer.toInstitutionId,
      departmentId: transfer.toDepartmentId,
      location: updated.toLocation,
      transferId,
    },
  });
  await emit(
    'asset.transferred',
    {
      assetId: asset.id,
      transferId,
      fromInstitutionId: asset.institutionId,
      toInstitutionId: transfer.toInstitutionId,
    },
    { institutionId: transfer.toInstitutionId },
  );
  return updated;
}

export async function closeTransfer(
  transferId: string,
  status: 'REJECTED' | 'CANCELLED',
  comment: string | null,
) {
  const db = tenantDb();
  const transfer = await db.assetTransfer.findUnique({ where: { id: transferId } });
  if (!transfer) throw new NotFoundError('Transfer');
  if (transfer.status !== 'PENDING_APPROVAL') return transfer;
  const updated = await db.assetTransfer.update({
    where: { id: transferId },
    data: {
      status,
      decidedAt: new Date(),
      decidedByUserId: currentPrincipal().userId,
      decisionComment: comment,
    },
  });
  await audit.record({
    action: status === 'REJECTED' ? 'asset_transfer.rejected' : 'asset_transfer.cancelled',
    entityType: 'asset_transfer',
    entityId: transferId,
    before: { status: transfer.status },
    after: { status },
  });
  if (transfer.requestedByUserId && status === 'REJECTED') {
    await notifyUsers('asset.transfer_decided', [transfer.requestedByUserId], {
      title: 'Asset transfer rejected',
      body: comment ?? undefined,
      link: `/assets/${transfer.assetId}`,
      institutionId: transfer.institutionId,
    });
  }
  return updated;
}

export const transferWorkflowCallbacks = {
  onApproved: async (i: WorkflowInstanceRef) => {
    const row = await completeTransfer(i.entityId, i.comment ?? null);
    if (i.requesterUserId)
      await notifyUsers('asset.transfer_decided', [i.requesterUserId], {
        title: 'Asset transfer approved',
        link: `/assets/${row.assetId}`,
        institutionId: row.toInstitutionId,
      });
  },
  onRejected: async (i: WorkflowInstanceRef) => {
    await closeTransfer(i.entityId, 'REJECTED', i.comment ?? null);
  },
  onCancelled: async (i: WorkflowInstanceRef) => {
    await closeTransfer(i.entityId, 'CANCELLED', i.comment ?? null);
  },
};

/** Users who should hear about asset issues for an asset's scope. */
export async function assetManagers(asset: {
  groupId: string | null;
  institutionId: string;
  campusId: string | null;
  departmentId: string | null;
}) {
  return holders('asset.maintain', hierarchyResource.asset(asset));
}

export { loadAsset };
