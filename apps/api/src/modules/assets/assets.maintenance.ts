import type { Prisma } from '@prisma/client';
import type {
  AssetMaintenanceType,
  AssetMaintenancePriority,
  AssetStatus,
  CreateAssetAuditInput,
  CreateAssetDisposalInput,
  CreateAssetMaintenanceInput,
  ListAssetAuditItemsQuery,
  ListAssetAuditsQuery,
  ListAssetDisposalsQuery,
  ListAssetMaintenanceQuery,
  UpdateAssetMaintenanceInput,
  VerifyAssetAuditItemInput,
} from '@erp/shared';
import { audit } from '../../core/audit';
import {
  andScope,
  authorize,
  can,
  currentPrincipal,
  hierarchyResource,
  scopeWhere,
} from '../../core/authz';
import { isUniqueViolation } from '../../core/db/helpers';
import { emit } from '../../core/events';
import { AppError, ConflictError, NotFoundError } from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { tenantDb, withTenant } from '../../core/tenancy';
import { submitWorkflow, type WorkflowInstanceRef } from '../../core/workflow';
import { addDays, bookValueAt, todayUtc } from './assets.logic';
import {
  assetRefSelect,
  depreciationParams,
  num,
  toAuditDto,
  toAuditItemDto,
  toDate,
  toDateOrNull,
  toDisposalDto,
  toMaintenanceDto,
} from './assets.mappers';
import { holders, notifyUsers } from './assets.notify';
import {
  assertAssetStatus,
  assetAuditView,
  loadAsset,
  loadAssetFor,
  resolvePlacement,
} from './assets.service';

export const DISPOSAL_WORKFLOW = 'asset_disposal';
/** Maintenance types that take the asset out of service while in progress. */
const OUT_OF_SERVICE: AssetMaintenanceType[] = ['REPAIR', 'WARRANTY_CLAIM'];

type Scoped = {
  groupId: string | null;
  institutionId: string;
  campusId: string | null;
  departmentId: string | null;
};

async function loadScoped<T extends Scoped>(
  row: T | null,
  label: string,
  permission?: string,
): Promise<T> {
  const principal = currentPrincipal();
  if (!row || !(await can(principal, 'asset.view', hierarchyResource.asset(row))))
    throw new NotFoundError(label);
  if (permission) await authorize(principal, permission, hierarchyResource.asset(row));
  return row;
}

/** Status the asset returns to after repair / a cancelled disposal. */
async function serviceableStatus(assetId: string): Promise<AssetStatus> {
  const active = await tenantDb().assetAssignment.count({ where: { assetId, status: 'ACTIVE' } });
  return active > 0 ? 'ASSIGNED' : 'IN_STOCK';
}

function ticketNo() {
  const d = new Date();
  const ymd = d.toISOString().slice(2, 10).replace(/-/g, '');
  return `MT-${ymd}-${Math.floor(Math.random() * 1e5)
    .toString()
    .padStart(5, '0')}`;
}

/* -------------------------------------- Maintenance ------------------------------------- */

export const maintenanceService = {
  async list(query: ListAssetMaintenanceQuery) {
    const { skip, take } = toPageWindow(query);
    const where = andScope<Prisma.AssetMaintenanceWhereInput>(
      {
        institutionId: query.institutionId,
        assetId: query.assetId,
        type: query.type,
        status:
          query.status ??
          (query.open === 'true'
            ? { in: ['OPEN', 'IN_PROGRESS'] }
            : query.open === 'false'
              ? { in: ['COMPLETED', 'CANCELLED'] }
              : undefined),
        ...(query.search
          ? {
              OR: [
                { ticketNo: { contains: query.search } },
                { title: { contains: query.search } },
                { asset: { assetTag: { contains: query.search } } },
                { asset: { name: { contains: query.search } } },
              ],
            }
          : {}),
      },
      await scopeWhere(currentPrincipal(), 'asset.view', 'asset'),
    );
    const db = tenantDb();
    const [items, total] = await Promise.all([
      db.assetMaintenance.findMany({
        where,
        include: { asset: { select: assetRefSelect } },
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take,
      }),
      db.assetMaintenance.count({ where }),
    ]);
    return { items: items.map(toMaintenanceDto), total };
  },

  async get(id: string) {
    const row = await loadScoped(
      await tenantDb().assetMaintenance.findUnique({
        where: { id },
        include: { asset: { select: assetRefSelect } },
      }),
      'Maintenance ticket',
    );
    return toMaintenanceDto(row);
  },

  create(input: CreateAssetMaintenanceInput) {
    return maintenanceService.createTicket(input.assetId, input, {});
  },

  /** Shared by the maintenance desk and the employee "raise issue" self-service action. */
  async createTicket(
    assetId: string,
    input: {
      type: AssetMaintenanceType;
      priority: AssetMaintenancePriority;
      title: string;
      description?: string | null;
      vendor?: string | null;
      scheduledDate?: string | null;
      cost?: number;
      underWarranty?: boolean;
    },
    opts: { reportedByEmployeeId?: string; selfService?: boolean },
  ) {
    const db = tenantDb();
    const asset = opts.selfService
      ? await db.asset.findUnique({ where: { id: assetId }, include: { category: true } })
      : await loadAssetFor(assetId, 'asset.maintain');
    if (!asset) throw new NotFoundError('Asset');
    assertAssetStatus(asset, ['IN_STOCK', 'ASSIGNED', 'UNDER_REPAIR'], 'raise maintenance for');
    const underWarranty =
      input.underWarranty ?? Boolean(asset.warrantyExpiry && asset.warrantyExpiry >= todayUtc());
    let created;
    for (let attempt = 0; ; attempt++) {
      try {
        created = await db.assetMaintenance.create({
          data: withTenant({
            assetId,
            groupId: asset.groupId,
            institutionId: asset.institutionId,
            campusId: asset.campusId,
            departmentId: asset.departmentId,
            ticketNo: ticketNo(),
            type: input.type,
            priority: input.priority,
            title: input.title,
            description: input.description ?? null,
            vendor: input.vendor ?? null,
            scheduledDate: toDateOrNull(input.scheduledDate) ?? null,
            cost: input.cost ?? 0,
            underWarranty,
            reportedByUserId: currentPrincipal().userId,
            reportedByEmployeeId: opts.reportedByEmployeeId ?? null,
          }),
        });
        break;
      } catch (err) {
        if (isUniqueViolation(err) && attempt < 5) continue;
        throw err;
      }
    }
    await audit.record({
      action: 'asset_maintenance.created',
      entityType: 'asset_maintenance',
      entityId: created.id,
      after: toMaintenanceDto(created),
    });
    await emit(
      'asset.maintenance_opened',
      { assetId, maintenanceId: created.id, ticketNo: created.ticketNo, type: created.type },
      { institutionId: asset.institutionId },
    );
    if (opts.selfService) {
      await notifyUsers(
        'asset.issue_reported',
        await holders('asset.maintain', hierarchyResource.asset(asset)),
        {
          title: `Issue reported: ${asset.name} (${asset.assetTag})`,
          body: input.title,
          link: `/assets/maintenance?search=${created.ticketNo}`,
          institutionId: asset.institutionId,
          data: { assetId, maintenanceId: created.id },
        },
      );
    }
    return toMaintenanceDto({
      ...created,
      asset: { id: asset.id, assetTag: asset.assetTag, name: asset.name, status: asset.status },
    });
  },

  async update(id: string, input: UpdateAssetMaintenanceInput) {
    const db = tenantDb();
    const before = await loadScoped(
      await db.assetMaintenance.findUnique({ where: { id } }),
      'Maintenance ticket',
      'asset.maintain',
    );
    const closing =
      input.status &&
      ['COMPLETED', 'CANCELLED'].includes(input.status) &&
      input.status !== before.status;
    if (
      ['COMPLETED', 'CANCELLED'].includes(before.status) &&
      input.status &&
      input.status !== before.status
    )
      throw new AppError(409, 'TICKET_CLOSED', 'Ticket is already closed');
    const asset = await db.asset.findUnique({ where: { id: before.assetId } });
    if (!asset) throw new NotFoundError('Asset');
    const takesOut =
      input.status === 'IN_PROGRESS' &&
      before.status === 'OPEN' &&
      OUT_OF_SERVICE.includes(before.type) &&
      asset.status !== 'UNDER_REPAIR' &&
      asset.status !== 'DISPOSED';
    const completedAt =
      input.status === 'COMPLETED'
        ? (toDateOrNull(input.completedAt) ?? todayUtc())
        : toDateOrNull(input.completedAt);
    let nextServiceDate = toDateOrNull(input.nextServiceDate);
    if (input.status === 'COMPLETED' && nextServiceDate === undefined && asset.serviceIntervalDays)
      nextServiceDate = addDays(completedAt ?? todayUtc(), asset.serviceIntervalDays);
    const updated = await db.$transaction(async (tx) => {
      const row = await tx.assetMaintenance.update({
        where: { id },
        data: {
          status: input.status,
          priority: input.priority,
          title: input.title,
          description: input.description,
          vendor: input.vendor,
          scheduledDate: toDateOrNull(input.scheduledDate),
          completedAt,
          cost: input.cost,
          underWarranty: input.underWarranty,
          resolution: input.resolution,
          nextServiceDate,
          ...(takesOut ? { statusBefore: asset.status, startedAt: new Date() } : {}),
          ...(input.status === 'IN_PROGRESS' && !before.startedAt ? { startedAt: new Date() } : {}),
        },
      });
      if (takesOut) {
        await tx.asset.update({ where: { id: asset.id }, data: { status: 'UNDER_REPAIR' } });
      }
      if (closing) {
        const restore = asset.status === 'UNDER_REPAIR' && before.statusBefore !== null;
        await tx.asset.update({
          where: { id: asset.id },
          data: {
            ...(restore ? { status: await serviceableStatus(asset.id) } : {}),
            ...(input.status === 'COMPLETED' && nextServiceDate !== undefined
              ? { nextServiceDate }
              : {}),
            ...(input.status === 'COMPLETED' && input.condition
              ? { condition: input.condition }
              : {}),
          },
        });
      }
      return row;
    });
    await audit.record({
      action: 'asset_maintenance.updated',
      entityType: 'asset_maintenance',
      entityId: id,
      before: toMaintenanceDto(before),
      after: toMaintenanceDto(updated),
    });
    if (input.status && input.status !== before.status) {
      await emit(
        input.status === 'COMPLETED' ? 'asset.maintenance_completed' : 'asset.maintenance_updated',
        { assetId: asset.id, maintenanceId: id, ticketNo: before.ticketNo, status: input.status },
        { institutionId: asset.institutionId },
      );
      if (before.reportedByUserId && closing) {
        await notifyUsers('asset.maintenance_closed', [before.reportedByUserId], {
          title: `Ticket ${before.ticketNo} ${input.status.toLowerCase()}`,
          body: input.resolution ?? undefined,
          link: '/my/assets',
          institutionId: asset.institutionId,
        });
      }
    }
    return toMaintenanceDto(updated);
  },
};

/* --------------------------------------- Disposal --------------------------------------- */

export const disposalService = {
  async list(query: ListAssetDisposalsQuery) {
    const { skip, take } = toPageWindow(query);
    const where = andScope<Prisma.AssetDisposalWhereInput>(
      {
        institutionId: query.institutionId,
        status: query.status,
        ...(query.search
          ? {
              OR: [
                { asset: { assetTag: { contains: query.search } } },
                { asset: { name: { contains: query.search } } },
              ],
            }
          : {}),
      },
      await scopeWhere(currentPrincipal(), 'asset.view', 'asset'),
    );
    const db = tenantDb();
    const [items, total] = await Promise.all([
      db.assetDisposal.findMany({
        where,
        include: { asset: { select: assetRefSelect } },
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take,
      }),
      db.assetDisposal.count({ where }),
    ]);
    return { items: items.map(toDisposalDto), total };
  },

  async create(input: CreateAssetDisposalInput) {
    const asset = await loadAssetFor(input.assetId, 'asset.dispose');
    assertAssetStatus(asset, ['IN_STOCK', 'UNDER_REPAIR', 'LOST'], 'dispose');
    const db = tenantDb();
    const pending = await db.assetDisposal.findFirst({
      where: { assetId: asset.id, status: 'PENDING_APPROVAL' },
    });
    if (pending) throw new ConflictError('A disposal request is already pending for this asset');
    const disposalDate = toDate(input.disposalDate);
    const bookValue = bookValueAt(
      num(asset.purchaseCost),
      asset.purchaseDate,
      depreciationParams(asset.category),
      disposalDate,
    );
    const disposal = await db.assetDisposal.create({
      data: withTenant({
        assetId: asset.id,
        groupId: asset.groupId,
        institutionId: asset.institutionId,
        campusId: asset.campusId,
        departmentId: asset.departmentId,
        method: input.method,
        disposalDate,
        bookValue,
        saleValue: input.saleValue ?? null,
        buyer: input.buyer ?? null,
        reason: input.reason,
        statusBefore: asset.status,
        requestedByUserId: currentPrincipal().userId,
      }),
    });
    await audit.record({
      action: 'asset_disposal.requested',
      entityType: 'asset_disposal',
      entityId: disposal.id,
      after: toDisposalDto(disposal),
      reason: input.reason,
    });
    const instance = await submitWorkflow({
      entityType: DISPOSAL_WORKFLOW,
      entityId: disposal.id,
      title: `Asset disposal: ${asset.name} (${asset.assetTag}) — ${input.method.toLowerCase()}`,
      institutionId: asset.institutionId,
      groupId: asset.groupId,
      departmentId: asset.departmentId,
      context: {
        assetId: asset.id,
        method: input.method,
        amount: bookValue,
        bookValue,
        purchaseCost: num(asset.purchaseCost),
        saleValue: input.saleValue ?? 0,
      },
    });
    const row = instance
      ? await db.assetDisposal.update({
          where: { id: disposal.id },
          data: { workflowInstanceId: instance.id },
        })
      : disposal;
    if (!instance) {
      await notifyUsers(
        'asset.disposal_requested',
        (await holders('asset.dispose', hierarchyResource.asset(asset))).filter(
          (u) => u !== currentPrincipal().userId,
        ),
        {
          title: `Disposal approval needed: ${asset.name} (${asset.assetTag})`,
          body: input.reason,
          link: '/assets/disposal',
          institutionId: asset.institutionId,
        },
      );
    }
    return toDisposalDto(row);
  },

  /** Manual decision, used when no approval workflow is configured for the scope. */
  async decide(id: string, approve: boolean, comment: string | null) {
    const before = await loadScoped(
      await tenantDb().assetDisposal.findUnique({ where: { id } }),
      'Disposal',
      'asset.dispose',
    );
    if (before.status !== 'PENDING_APPROVAL')
      throw new AppError(409, 'NOT_PENDING', 'Disposal is not pending approval');
    if (before.workflowInstanceId)
      throw new AppError(
        409,
        'WORKFLOW_PENDING',
        'This disposal is routed through an approval workflow; decide it from Approvals',
      );
    const row = approve
      ? await approveDisposal(id, comment)
      : await closeDisposal(id, 'REJECTED', comment);
    return toDisposalDto(row);
  },

  async cancel(id: string) {
    const before = await loadScoped(
      await tenantDb().assetDisposal.findUnique({ where: { id } }),
      'Disposal',
      'asset.dispose',
    );
    if (before.status !== 'PENDING_APPROVAL')
      throw new AppError(409, 'NOT_PENDING', 'Disposal is not pending approval');
    if (before.workflowInstanceId)
      throw new AppError(409, 'WORKFLOW_PENDING', 'Withdraw the approval request from Approvals');
    return toDisposalDto(await closeDisposal(id, 'CANCELLED', null));
  },
};

/** Approve + write the asset off (idempotent). */
export async function approveDisposal(id: string, comment: string | null) {
  const db = tenantDb();
  const disposal = await db.assetDisposal.findUnique({ where: { id } });
  if (!disposal) throw new NotFoundError('Disposal');
  if (disposal.status !== 'PENDING_APPROVAL') return disposal;
  const asset = await db.asset.findUnique({ where: { id: disposal.assetId } });
  if (!asset) throw new NotFoundError('Asset');
  if (asset.status === 'ASSIGNED')
    throw new AppError(409, 'INVALID_ASSET_STATE', 'Asset was assigned after the request');
  const updated = await db.$transaction(async (tx) => {
    await tx.asset.update({
      where: { id: asset.id },
      data: { status: 'DISPOSED', disposedAt: disposal.disposalDate, custodianEmployeeId: null },
    });
    await tx.assetMaintenance.updateMany({
      where: { assetId: asset.id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      data: { status: 'CANCELLED', resolution: 'Asset disposed' },
    });
    return tx.assetDisposal.update({
      where: { id },
      data: {
        status: 'APPROVED',
        decidedAt: new Date(),
        decidedByUserId: currentPrincipal().userId,
        decisionComment: comment,
      },
    });
  });
  await audit.record({
    action: 'asset.disposed',
    entityType: 'asset',
    entityId: asset.id,
    before: { status: asset.status },
    after: { status: 'DISPOSED', disposalId: id, method: disposal.method },
    reason: disposal.reason,
  });
  await emit(
    'asset.disposed',
    {
      assetId: asset.id,
      assetTag: asset.assetTag,
      disposalId: id,
      method: disposal.method,
      bookValue: num(disposal.bookValue),
      saleValue: disposal.saleValue === null ? null : num(disposal.saleValue),
    },
    { institutionId: asset.institutionId },
  );
  if (disposal.requestedByUserId)
    await notifyUsers('asset.disposal_decided', [disposal.requestedByUserId], {
      title: `Disposal approved: ${asset.name} (${asset.assetTag})`,
      link: '/assets/disposal',
      institutionId: asset.institutionId,
    });
  return updated;
}

export async function closeDisposal(
  id: string,
  status: 'REJECTED' | 'CANCELLED',
  comment: string | null,
) {
  const db = tenantDb();
  const disposal = await db.assetDisposal.findUnique({ where: { id } });
  if (!disposal) throw new NotFoundError('Disposal');
  if (disposal.status !== 'PENDING_APPROVAL') return disposal;
  const updated = await db.assetDisposal.update({
    where: { id },
    data: {
      status,
      decidedAt: new Date(),
      decidedByUserId: currentPrincipal().userId,
      decisionComment: comment,
    },
  });
  await audit.record({
    action: status === 'REJECTED' ? 'asset_disposal.rejected' : 'asset_disposal.cancelled',
    entityType: 'asset_disposal',
    entityId: id,
    before: { status: disposal.status },
    after: { status },
    reason: comment ?? undefined,
  });
  if (status === 'REJECTED' && disposal.requestedByUserId)
    await notifyUsers('asset.disposal_decided', [disposal.requestedByUserId], {
      title: 'Disposal request rejected',
      body: comment ?? undefined,
      link: '/assets/disposal',
      institutionId: disposal.institutionId,
    });
  return updated;
}

export const disposalWorkflowCallbacks = {
  onApproved: async (i: WorkflowInstanceRef) => {
    await approveDisposal(i.entityId, i.comment ?? null);
  },
  onRejected: async (i: WorkflowInstanceRef) => {
    await closeDisposal(i.entityId, 'REJECTED', i.comment ?? null);
  },
  onCancelled: async (i: WorkflowInstanceRef) => {
    await closeDisposal(i.entityId, 'CANCELLED', i.comment ?? null);
  },
};

/* ---------------------------------------- Audits ---------------------------------------- */

async function auditCounts(auditIds: string[]) {
  const groups = await tenantDb().assetAuditItem.groupBy({
    by: ['auditId', 'result'],
    where: { auditId: { in: auditIds } },
    _count: { _all: true },
  });
  const map = new Map<string, Record<string, number>>();
  for (const g of groups) {
    const m = map.get(g.auditId) ?? {};
    m[g.result] = g._count._all;
    map.set(g.auditId, m);
  }
  return map;
}

async function loadAudit(id: string, permission?: string) {
  return loadScoped(await tenantDb().assetAudit.findUnique({ where: { id } }), 'Audit', permission);
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

export const auditService = {
  async list(query: ListAssetAuditsQuery) {
    const { skip, take } = toPageWindow(query);
    const where = andScope<Prisma.AssetAuditWhereInput>(
      {
        institutionId: query.institutionId,
        status: query.status,
        ...(query.search ? { name: { contains: query.search } } : {}),
      },
      await scopeWhere(currentPrincipal(), 'asset.view', 'asset'),
    );
    const db = tenantDb();
    const [items, total] = await Promise.all([
      db.assetAudit.findMany({ where, orderBy: [{ createdAt: 'desc' }], skip, take }),
      db.assetAudit.count({ where }),
    ]);
    const counts = await auditCounts(items.map((a) => a.id));
    return { items: items.map((a) => toAuditDto(a, counts.get(a.id) ?? {})), total };
  },

  async get(id: string) {
    const row = await loadAudit(id);
    const counts = await auditCounts([id]);
    return toAuditDto(row, counts.get(id) ?? {});
  },

  async create(input: CreateAssetAuditInput) {
    const placement = await resolvePlacement(
      input.institutionId,
      input.campusId,
      input.departmentId,
    );
    await authorize(currentPrincipal(), 'asset.audit', placement);
    const db = tenantDb();
    const assets = await db.asset.findMany({
      where: {
        institutionId: placement.institutionId,
        ...(placement.campusId ? { campusId: placement.campusId } : {}),
        ...(placement.departmentId ? { departmentId: placement.departmentId } : {}),
        ...(input.categoryId ? { categoryId: input.categoryId } : {}),
        status: { notIn: ['DISPOSED', 'LOST'] },
      },
      select: { id: true, location: true, condition: true },
    });
    const created = await db.$transaction(async (tx) => {
      const row = await tx.assetAudit.create({
        data: withTenant({
          ...placement,
          categoryId: input.categoryId ?? null,
          name: input.name,
          notes: input.notes ?? null,
          startedByUserId: currentPrincipal().userId,
        }),
      });
      if (assets.length) {
        await tx.assetAuditItem.createMany({
          data: assets.map((a) =>
            withTenant({
              auditId: row.id,
              assetId: a.id,
              expectedLocation: a.location,
              expectedCondition: a.condition,
            }),
          ),
        });
      }
      return row;
    });
    await audit.record({
      action: 'asset_audit.created',
      entityType: 'asset_audit',
      entityId: created.id,
      after: { name: created.name, items: assets.length },
    });
    return toAuditDto(created, { PENDING: assets.length });
  },

  async listItems(id: string, query: ListAssetAuditItemsQuery) {
    await loadAudit(id);
    const { skip, take } = toPageWindow(query);
    const where: Prisma.AssetAuditItemWhereInput = {
      auditId: id,
      result: query.result,
      ...(query.search
        ? {
            OR: [
              { asset: { assetTag: { contains: query.search } } },
              { asset: { name: { contains: query.search } } },
            ],
          }
        : {}),
    };
    const db = tenantDb();
    const [items, total] = await Promise.all([
      db.assetAuditItem.findMany({
        where,
        include: { asset: { select: assetRefSelect } },
        orderBy: [{ asset: { assetTag: 'asc' } }],
        skip,
        take,
      }),
      db.assetAuditItem.count({ where }),
    ]);
    return { items: items.map(toAuditItemDto), total };
  },

  /** Scan / pick an asset and record the physical verification. */
  async verify(id: string, input: VerifyAssetAuditItemInput) {
    const auditRow = await loadAudit(id, 'asset.audit');
    if (auditRow.status !== 'OPEN') throw new AppError(409, 'AUDIT_CLOSED', 'Audit is closed');
    const db = tenantDb();
    const asset = input.assetId
      ? await db.asset.findUnique({ where: { id: input.assetId } })
      : await db.asset.findFirst({ where: { assetTag: input.assetTag! } });
    if (!asset) throw new NotFoundError('Asset');
    let item = await db.assetAuditItem.findUnique({
      where: { auditId_assetId: { auditId: id, assetId: asset.id } },
    });
    const foreign = !item;
    if (!item) {
      // Found but not expected in this audit's scope (wrong room / institution).
      if (!(await can(currentPrincipal(), 'asset.view', hierarchyResource.asset(asset))))
        throw new NotFoundError('Asset');
      item = await db.assetAuditItem.create({
        data: withTenant({
          auditId: id,
          assetId: asset.id,
          expectedLocation: asset.location,
          expectedCondition: asset.condition,
        }),
      });
    }
    const observedLocation = input.observedLocation ?? null;
    const observedCondition = input.observedCondition ?? null;
    let result = input.result;
    if (!result) {
      if (foreign) result = 'LOCATION_MISMATCH';
      else if (observedLocation && norm(observedLocation) !== norm(item.expectedLocation))
        result = 'LOCATION_MISMATCH';
      else if (observedCondition && observedCondition !== item.expectedCondition)
        result = 'CONDITION_MISMATCH';
      else result = 'VERIFIED';
    }
    const now = new Date();
    const updated = await db.assetAuditItem.update({
      where: { id: item.id },
      data: {
        result,
        observedLocation,
        observedCondition,
        notes: input.notes ?? null,
        verifiedAt: result === 'MISSING' ? null : now,
        verifiedByUserId: currentPrincipal().userId,
      },
      include: { asset: { select: assetRefSelect } },
    });
    if (result !== 'MISSING') {
      await db.asset.update({
        where: { id: asset.id },
        data: {
          lastVerifiedAt: now,
          ...(result === 'CONDITION_MISMATCH' && observedCondition
            ? { condition: observedCondition }
            : {}),
        },
      });
    }
    await audit.record({
      action: 'asset_audit.item_verified',
      entityType: 'asset_audit',
      entityId: id,
      after: { assetId: asset.id, result, observedLocation, observedCondition },
    });
    return toAuditItemDto(updated);
  },

  async complete(id: string) {
    const before = await loadAudit(id, 'asset.audit');
    if (before.status !== 'OPEN') throw new AppError(409, 'AUDIT_CLOSED', 'Audit is closed');
    const db = tenantDb();
    await db.assetAuditItem.updateMany({
      where: { auditId: id, result: 'PENDING' },
      data: { result: 'MISSING' },
    });
    const row = await db.assetAudit.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        completedByUserId: currentPrincipal().userId,
      },
    });
    const counts = (await auditCounts([id])).get(id) ?? {};
    const dto = toAuditDto(row, counts);
    await audit.record({
      action: 'asset_audit.completed',
      entityType: 'asset_audit',
      entityId: id,
      after: dto.counts,
    });
    await emit(
      'asset.audit_completed',
      { auditId: id, name: row.name, counts: dto.counts },
      { institutionId: row.institutionId },
    );
    const discrepancies = dto.counts.total - dto.counts.VERIFIED;
    if (discrepancies > 0) {
      await notifyUsers(
        'asset.audit_discrepancies',
        await holders('asset.manage', hierarchyResource.asset(row)),
        {
          title: `Asset audit "${row.name}": ${discrepancies} discrepanc${discrepancies === 1 ? 'y' : 'ies'}`,
          body: `${dto.counts.MISSING} missing, ${dto.counts.LOCATION_MISMATCH} location and ${dto.counts.CONDITION_MISMATCH} condition mismatches.`,
          link: `/assets/audit?audit=${id}`,
          institutionId: row.institutionId,
        },
      );
    }
    return dto;
  },

  async cancel(id: string) {
    const before = await loadAudit(id, 'asset.audit');
    if (before.status !== 'OPEN') throw new AppError(409, 'AUDIT_CLOSED', 'Audit is closed');
    const row = await tenantDb().assetAudit.update({
      where: { id },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
    await audit.record({
      action: 'asset_audit.cancelled',
      entityType: 'asset_audit',
      entityId: id,
      before: { status: before.status },
      after: { status: 'CANCELLED' },
    });
    const counts = (await auditCounts([id])).get(id) ?? {};
    return toAuditDto(row, counts);
  },
};

export { loadAsset, assetAuditView };
