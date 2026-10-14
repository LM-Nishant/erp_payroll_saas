import type { Prisma } from '@prisma/client';
import QRCode from 'qrcode';
import type {
  AssetDashboardDto,
  AssetDashboardQuery,
  AssetDepreciationScheduleDto,
  AssetLabelsInput,
  AssetStatus,
  CreateAssetCategoryInput,
  CreateAssetInput,
  ListAssetCategoriesQuery,
  ListAssetsQuery,
  UpdateAssetCategoryInput,
  UpdateAssetInput,
} from '@erp/shared';
import { audit } from '../../core/audit';
import {
  andScope,
  authorize,
  can,
  currentPrincipal,
  hierarchyResource,
  scopeWhere,
  type ResourceScope,
} from '../../core/authz';
import { DbNull, isUniqueViolation } from '../../core/db/helpers';
import { documentEngine } from '../../core/documents';
import { emit } from '../../core/events';
import {
  AppError,
  ConflictError,
  InvalidReferenceError,
  NotFoundError,
} from '../../core/http/errors';
import type { MultipartFile } from '../../core/http/multipart';
import { toPageWindow } from '../../core/http/pagination';
import { renderPdfTemplate } from '../../core/pdf';
import { tenantDb, withTenant } from '../../core/tenancy';
import {
  addDays,
  bookValueAt,
  dateOnly,
  depreciationSchedule,
  formatAssetTag,
  todayUtc,
} from './assets.logic';
import {
  assetInclude,
  depreciationParams,
  num,
  toAssetDto,
  toAssignmentDto,
  toCategoryDto,
  toDateOrNull,
  toDisposalDto,
  toMaintenanceDto,
  toTransferDto,
  employeeRefSelect,
  type AssetWithRefs,
} from './assets.mappers';

/*
 * Asset register: categories (depreciation + tag series), assets, invoices, QR labels,
 * depreciation schedules and the dashboard. Custody, maintenance, disposal, audits, inventory
 * and reports live in sibling files and reuse the helpers exported here.
 */

export type Db = ReturnType<typeof tenantDb>;
export type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];

export const LABEL_TEMPLATE = 'asset_labels';
export const INVOICE_MAX_BYTES = 10 * 1024 * 1024;

/** Placement of an asset / audit / stock item inside the hierarchy (validated). */
export interface Placement {
  groupId: string | null;
  institutionId: string;
  campusId: string | null;
  departmentId: string | null;
}

export async function resolvePlacement(
  institutionId: string,
  campusId?: string | null,
  departmentId?: string | null,
  db: Db | Tx = tenantDb(),
): Promise<Placement> {
  const inst = await db.institution.findUnique({
    where: { id: institutionId },
    select: { id: true, groupId: true },
  });
  if (!inst) throw new InvalidReferenceError('institutionId', 'Institution');
  let resolvedCampus = campusId ?? null;
  if (campusId) {
    const campus = await db.campus.findUnique({ where: { id: campusId } });
    if (!campus || campus.institutionId !== inst.id)
      throw new InvalidReferenceError('campusId', 'Campus');
  }
  if (departmentId) {
    const dept = await db.department.findUnique({ where: { id: departmentId } });
    if (!dept || dept.institutionId !== inst.id)
      throw new InvalidReferenceError('departmentId', 'Department');
    resolvedCampus = resolvedCampus ?? dept.campusId;
  }
  return {
    groupId: inst.groupId,
    institutionId: inst.id,
    campusId: resolvedCampus,
    departmentId: departmentId ?? null,
  };
}

export const placementOf = (row: Placement): Placement => ({
  groupId: row.groupId,
  institutionId: row.institutionId,
  campusId: row.campusId,
  departmentId: row.departmentId,
});

export async function loadAsset(id: string, permission = 'asset.view'): Promise<AssetWithRefs> {
  const asset = await tenantDb().asset.findUnique({ where: { id }, include: assetInclude });
  if (!asset || !(await can(currentPrincipal(), permission, hierarchyResource.asset(asset))))
    throw new NotFoundError('Asset');
  return asset as AssetWithRefs;
}

/** Load a visible asset and require `permission` on it (404 when invisible, 403 otherwise). */
export async function loadAssetFor(id: string, permission: string): Promise<AssetWithRefs> {
  const asset = await loadAsset(id);
  await authorize(currentPrincipal(), permission, hierarchyResource.asset(asset));
  return asset;
}

export function assertAssetStatus(
  asset: { status: AssetStatus },
  allowed: AssetStatus[],
  action: string,
) {
  if (!allowed.includes(asset.status)) {
    throw new AppError(
      409,
      'INVALID_ASSET_STATE',
      `Cannot ${action} an asset that is ${asset.status.replace(/_/g, ' ').toLowerCase()}`,
    );
  }
}

async function resolveCategory(
  categoryId: string,
  institutionId: string,
  db: Db | Tx = tenantDb(),
) {
  const category = await db.assetCategory.findUnique({ where: { id: categoryId } });
  if (!category || (category.institutionId && category.institutionId !== institutionId))
    throw new InvalidReferenceError('categoryId', 'Asset category');
  return category;
}

async function nextAssetTag(tx: Tx, categoryId: string) {
  const updated = await tx.assetCategory.update({
    where: { id: categoryId },
    data: { tagNextNumber: { increment: 1 } },
  });
  return formatAssetTag(updated.tagPrefix, updated.tagPadding, updated.tagNextNumber - 1);
}

const categoryResource = (c: {
  groupId: string | null;
  institutionId: string | null;
}): ResourceScope =>
  c.institutionId ? { groupId: c.groupId, institutionId: c.institutionId } : {};

async function loadCategory(id: string) {
  const category = await tenantDb().assetCategory.findUnique({ where: { id } });
  if (
    !category ||
    (category.institutionId &&
      !(await can(currentPrincipal(), 'asset.view', categoryResource(category))))
  )
    throw new NotFoundError('Asset category');
  return category;
}

function assetData(input: CreateAssetInput | UpdateAssetInput) {
  return {
    name: input.name,
    make: input.make,
    model: input.model,
    serialNo: input.serialNo,
    attributes:
      input.attributes === undefined
        ? undefined
        : input.attributes === null
          ? DbNull
          : (input.attributes as Prisma.InputJsonValue),
    vendor: input.vendor,
    invoiceNo: input.invoiceNo,
    purchaseDate: toDateOrNull(input.purchaseDate),
    purchaseCost: input.purchaseCost,
    warrantyExpiry: toDateOrNull(input.warrantyExpiry),
    amcVendor: input.amcVendor,
    amcExpiry: toDateOrNull(input.amcExpiry),
    serviceIntervalDays: input.serviceIntervalDays,
    nextServiceDate: toDateOrNull(input.nextServiceDate),
    location: input.location,
    condition: input.condition,
    notes: input.notes,
  };
}

const auditView = (a: AssetWithRefs) => {
  const dto = toAssetDto(a);
  return {
    assetTag: dto.assetTag,
    name: dto.name,
    categoryId: dto.categoryId,
    institutionId: dto.institutionId,
    departmentId: dto.departmentId,
    status: dto.status,
    condition: dto.condition,
    location: dto.location,
    custodianEmployeeId: dto.custodianEmployeeId,
    purchaseCost: dto.purchaseCost,
  };
};
export { auditView as assetAuditView };

export async function assetListWhere(
  query: Partial<ListAssetsQuery>,
  permission = 'asset.view',
): Promise<Prisma.AssetWhereInput> {
  const today = todayUtc();
  const horizon =
    query.expiringWithinDays !== undefined ? addDays(today, query.expiringWithinDays) : null;
  return andScope<Prisma.AssetWhereInput>(
    {
      groupId: query.groupId,
      institutionId: query.institutionId,
      campusId: query.campusId,
      departmentId: query.departmentId,
      categoryId: query.categoryId,
      status: query.status,
      condition: query.condition,
      custodianEmployeeId: query.custodianEmployeeId,
      assetTag: query.assetTag,
      ...(query.kind ? { category: { kind: query.kind } } : {}),
      ...(horizon
        ? {
            OR: [{ warrantyExpiry: { lte: horizon } }, { amcExpiry: { lte: horizon } }],
          }
        : {}),
      ...(query.search
        ? {
            AND: [
              {
                OR: [
                  { name: { contains: query.search } },
                  { assetTag: { contains: query.search } },
                  { serialNo: { contains: query.search } },
                  { make: { contains: query.search } },
                  { model: { contains: query.search } },
                  { location: { contains: query.search } },
                ],
              },
            ],
          }
        : {}),
    },
    await scopeWhere(currentPrincipal(), permission, 'asset'),
  );
}

/* --------------------------------------- Categories ------------------------------------- */

export const categoryService = {
  async list(query: ListAssetCategoriesQuery) {
    const { skip, take } = toPageWindow(query);
    const scope = await scopeWhere(currentPrincipal(), 'asset.view', 'assetCategory');
    const where: Prisma.AssetCategoryWhereInput = {
      kind: query.kind,
      ...(query.institutionId
        ? { OR: [{ institutionId: null }, { institutionId: query.institutionId }] }
        : {}),
      ...(query.search
        ? {
            AND: [
              { OR: [{ name: { contains: query.search } }, { code: { contains: query.search } }] },
            ],
          }
        : {}),
      ...(scope ? { AND: [{ OR: [{ institutionId: null }, scope] }] } : {}),
    };
    if (query.search && scope) {
      where.AND = [
        { OR: [{ name: { contains: query.search } }, { code: { contains: query.search } }] },
        { OR: [{ institutionId: null }, scope] },
      ];
    }
    const [items, total] = await Promise.all([
      tenantDb().assetCategory.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip,
        take,
      }),
      tenantDb().assetCategory.count({ where }),
    ]);
    const counts = await tenantDb().asset.groupBy({
      by: ['categoryId'],
      where: { categoryId: { in: items.map((c) => c.id) }, status: { not: 'DISPOSED' } },
      _count: { _all: true },
    });
    const byId = new Map(counts.map((c) => [c.categoryId, c._count._all]));
    return { items: items.map((c) => toCategoryDto(c, byId.get(c.id) ?? 0)), total };
  },

  async get(id: string) {
    return toCategoryDto(await loadCategory(id));
  },

  async create(input: CreateAssetCategoryInput) {
    const placement = input.institutionId ? await resolvePlacement(input.institutionId) : null;
    await authorize(
      currentPrincipal(),
      'asset.manage',
      placement ? { groupId: placement.groupId, institutionId: placement.institutionId } : {},
    );
    try {
      const created = await tenantDb().assetCategory.create({
        data: withTenant({
          groupId: placement?.groupId ?? null,
          institutionId: placement?.institutionId ?? null,
          code: input.code.toUpperCase(),
          name: input.name,
          kind: input.kind,
          description: input.description ?? null,
          attributes: input.attributes as unknown as Prisma.InputJsonValue,
          depreciationMethod: input.depreciationMethod,
          depreciationRate: input.depreciationRate ?? null,
          usefulLifeYears: input.usefulLifeYears ?? null,
          residualPercent: input.residualPercent,
          tagPrefix: input.tagPrefix,
          tagPadding: input.tagPadding,
        }),
      });
      await audit.record({
        action: 'asset_category.created',
        entityType: 'asset_category',
        entityId: created.id,
        after: toCategoryDto(created),
      });
      return toCategoryDto(created);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError(`Category code ${input.code} exists`);
      throw err;
    }
  },

  async update(id: string, input: UpdateAssetCategoryInput) {
    const before = await loadCategory(id);
    await authorize(currentPrincipal(), 'asset.manage', categoryResource(before));
    const updated = await tenantDb().assetCategory.update({
      where: { id },
      data: {
        name: input.name,
        kind: input.kind,
        description: input.description,
        attributes:
          input.attributes === undefined
            ? undefined
            : (input.attributes as unknown as Prisma.InputJsonValue),
        depreciationMethod: input.depreciationMethod,
        depreciationRate: input.depreciationRate,
        usefulLifeYears: input.usefulLifeYears,
        residualPercent: input.residualPercent,
        tagPrefix: input.tagPrefix,
        tagPadding: input.tagPadding,
        tagNextNumber: input.tagNextNumber,
      },
    });
    await audit.record({
      action: 'asset_category.updated',
      entityType: 'asset_category',
      entityId: id,
      before: toCategoryDto(before),
      after: toCategoryDto(updated),
    });
    return toCategoryDto(updated);
  },

  async remove(id: string) {
    const before = await loadCategory(id);
    await authorize(currentPrincipal(), 'asset.manage', categoryResource(before));
    const inUse = await tenantDb().asset.count({ where: { categoryId: id } });
    if (inUse > 0) throw new ConflictError('Category has assets; move or delete them first');
    await tenantDb().assetCategory.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit.record({
      action: 'asset_category.deleted',
      entityType: 'asset_category',
      entityId: id,
      before: toCategoryDto(before),
    });
  },
};

/* ----------------------------------------- Assets --------------------------------------- */

export const assetService = {
  async list(query: ListAssetsQuery) {
    const { skip, take } = toPageWindow(query);
    const where = await assetListWhere(query);
    const [items, total] = await Promise.all([
      tenantDb().asset.findMany({
        where,
        include: assetInclude,
        orderBy: [{ assetTag: 'asc' }],
        skip,
        take,
      }),
      tenantDb().asset.count({ where }),
    ]);
    return { items: items.map((a) => toAssetDto(a as AssetWithRefs)), total };
  },

  async get(id: string) {
    const asset = await loadAsset(id);
    const db = tenantDb();
    const [assignments, maintenance, transfers, disposals] = await Promise.all([
      db.assetAssignment.findMany({
        where: { assetId: id },
        include: { employee: { select: employeeRefSelect } },
        orderBy: [{ assignedAt: 'desc' }, { createdAt: 'desc' }],
        take: 50,
      }),
      db.assetMaintenance.findMany({
        where: { assetId: id },
        orderBy: [{ createdAt: 'desc' }],
        take: 50,
      }),
      db.assetTransfer.findMany({ where: { assetId: id }, orderBy: [{ createdAt: 'desc' }] }),
      db.assetDisposal.findMany({ where: { assetId: id }, orderBy: [{ createdAt: 'desc' }] }),
    ]);
    const mapped = assignments.map(toAssignmentDto);
    return {
      ...toAssetDto(asset),
      activeAssignment: mapped.find((a) => a.status === 'ACTIVE') ?? null,
      assignments: mapped,
      maintenance: maintenance.map((m) => toMaintenanceDto(m)),
      transfers: transfers.map((t) => toTransferDto(t)),
      disposals: disposals.map((d) => toDisposalDto(d)),
      categoryAttributes: toCategoryDto(asset.category).attributes,
    };
  },

  async create(input: CreateAssetInput) {
    const placement = await resolvePlacement(
      input.institutionId,
      input.campusId,
      input.departmentId,
    );
    await authorize(currentPrincipal(), 'asset.manage', placement);
    const category = await resolveCategory(input.categoryId, placement.institutionId);
    let created: AssetWithRefs;
    try {
      created = (await tenantDb().$transaction(async (tx) => {
        const assetTag = input.assetTag ?? (await nextAssetTag(tx, category.id));
        return tx.asset.create({
          data: withTenant({
            ...assetData(input),
            ...placement,
            categoryId: category.id,
            assetTag,
            status: input.status,
            name: input.name,
          } as Prisma.AssetUncheckedCreateInput),
          include: assetInclude,
        });
      })) as AssetWithRefs;
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictError(`Asset tag ${input.assetTag ?? ''} already exists`.trim());
      throw err;
    }
    await audit.record({
      action: 'asset.created',
      entityType: 'asset',
      entityId: created.id,
      after: auditView(created),
    });
    await emit(
      'asset.created',
      { assetId: created.id, assetTag: created.assetTag, categoryId: created.categoryId },
      { institutionId: created.institutionId },
    );
    return toAssetDto(created);
  },

  async update(id: string, input: UpdateAssetInput) {
    const before = await loadAssetFor(id, 'asset.manage');
    const placement =
      input.campusId !== undefined || input.departmentId !== undefined
        ? await resolvePlacement(
            before.institutionId,
            input.campusId === undefined ? before.campusId : input.campusId,
            input.departmentId === undefined ? before.departmentId : input.departmentId,
          )
        : null;
    if (placement) await authorize(currentPrincipal(), 'asset.manage', placement);
    if (input.categoryId && input.categoryId !== before.categoryId)
      await resolveCategory(input.categoryId, before.institutionId);
    if (input.status && input.status !== before.status)
      assertAssetStatus(before, ['IN_STOCK', 'LOST'], `mark ${input.status.toLowerCase()}`);
    const updated = (await tenantDb().asset.update({
      where: { id },
      data: {
        ...assetData(input),
        ...(placement
          ? { campusId: placement.campusId, departmentId: placement.departmentId }
          : {}),
        categoryId: input.categoryId,
        status: input.status,
      },
      include: assetInclude,
    })) as AssetWithRefs;
    await audit.record({
      action: 'asset.updated',
      entityType: 'asset',
      entityId: id,
      before: auditView(before),
      after: auditView(updated),
    });
    if (input.status === 'LOST' && before.status !== 'LOST')
      await emit('asset.lost', { assetId: id }, { institutionId: updated.institutionId });
    return toAssetDto(updated);
  },

  async remove(id: string) {
    const before = await loadAssetFor(id, 'asset.manage');
    assertAssetStatus(before, ['IN_STOCK', 'LOST', 'DISPOSED'], 'delete');
    await tenantDb().asset.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit.record({
      action: 'asset.deleted',
      entityType: 'asset',
      entityId: id,
      before: auditView(before),
    });
  },

  async uploadInvoice(id: string, file: MultipartFile) {
    const asset = await loadAssetFor(id, 'asset.manage');
    const doc = await documentEngine.attach({
      ownerType: 'asset',
      ownerId: asset.id,
      module: 'assets',
      metadata: {
        title: `Purchase invoice — ${asset.assetTag}${asset.invoiceNo ? ` (${asset.invoiceNo})` : ''}`,
        category: 'asset',
        documentType: 'purchase_invoice',
        confidentiality: 'INTERNAL',
      },
      file,
      authorization: 'caller',
    });
    await tenantDb().asset.update({ where: { id }, data: { invoiceDocumentId: doc.id } });
    await audit.record({
      action: 'asset.invoice_uploaded',
      entityType: 'asset',
      entityId: id,
      before: { invoiceDocumentId: asset.invoiceDocumentId },
      after: { invoiceDocumentId: doc.id },
    });
    return { invoiceDocumentId: doc.id };
  },

  async invoiceUrl(id: string) {
    const asset = await loadAsset(id);
    if (!asset.invoiceDocumentId) throw new NotFoundError('Invoice');
    const url = await documentEngine.currentVersionUrl(asset.invoiceDocumentId, 'attachment');
    if (!url) throw new NotFoundError('Invoice');
    return url;
  },

  async depreciation(id: string, asOf = todayUtc()): Promise<AssetDepreciationScheduleDto> {
    const asset = await loadAsset(id);
    const params = depreciationParams(asset.category);
    const cost = num(asset.purchaseCost);
    const bookValue =
      asset.status === 'DISPOSED' ? 0 : bookValueAt(cost, asset.purchaseDate, params, asOf);
    return {
      assetId: asset.id,
      method: params.method,
      rate: params.ratePercent,
      usefulLifeYears: params.usefulLifeYears,
      residualValue: Math.round(cost * params.residualPercent) / 100,
      cost,
      bookValue,
      accumulatedDepreciation: Math.round((cost - bookValue) * 100) / 100,
      rows: depreciationSchedule(cost, asset.purchaseDate, params),
    };
  },

  /** QR label sheet (PDF) for the given assets or an institution / category. */
  async labels(input: AssetLabelsInput) {
    const where = input.assetIds?.length
      ? andScope<Prisma.AssetWhereInput>(
          { id: { in: input.assetIds } },
          await scopeWhere(currentPrincipal(), 'asset.view', 'asset'),
        )
      : await assetListWhere({ institutionId: input.institutionId, categoryId: input.categoryId });
    const assets = await tenantDb().asset.findMany({
      where: { AND: [where, { status: { not: 'DISPOSED' } }] },
      include: { institution: { select: { id: true, name: true, groupId: true } } },
      orderBy: [{ assetTag: 'asc' }],
      take: 500,
    });
    if (assets.length === 0) throw new NotFoundError('Assets');
    const labels = await Promise.all(
      assets.map(async (a) => ({
        tag: a.assetTag,
        name: a.name,
        location: a.location ?? '',
        qr: (await QRCode.toBuffer(a.assetTag, { margin: 1, width: 160 })).toString('base64'),
      })),
    );
    const first = assets[0]!;
    const rendered = await renderPdfTemplate(
      LABEL_TEMPLATE,
      { title: `Asset labels — ${first.institution.name}`, labels },
      {
        groupId: first.groupId,
        institutionId: first.institutionId,
        campusId: null,
        departmentId: null,
      },
    );
    await audit.record({
      action: 'asset.labels_printed',
      entityType: 'asset',
      entityId: first.id,
      after: { count: assets.length },
    });
    return { fileName: 'asset-labels.pdf', contentType: 'application/pdf', body: rendered.body };
  },

  async dashboard(query: AssetDashboardQuery): Promise<AssetDashboardDto> {
    const db = tenantDb();
    const principal = currentPrincipal();
    const scope = await scopeWhere(principal, 'asset.view', 'asset');
    const base = andScope<Prisma.AssetWhereInput>(
      { institutionId: query.institutionId, groupId: query.groupId },
      scope,
    );
    const childScope = andScope<Record<string, unknown>>(
      { institutionId: query.institutionId, groupId: query.groupId },
      scope,
    );
    const today = todayUtc();
    const in30 = addDays(today, 30);
    const live: Prisma.AssetWhereInput = { AND: [base, { status: { not: 'DISPOSED' } }] };
    const [
      statusGroups,
      rows,
      categories,
      warranty,
      amc,
      service,
      openMt,
      pendingAck,
      pd,
      pt,
      stock,
    ] = await Promise.all([
      db.asset.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      db.asset.findMany({
        where: live,
        select: { categoryId: true, purchaseCost: true, purchaseDate: true },
      }),
      db.assetCategory.findMany(),
      db.asset.count({
        where: { AND: [live, { warrantyExpiry: { gte: today, lte: in30 } }] },
      }),
      db.asset.count({ where: { AND: [live, { amcExpiry: { gte: today, lte: in30 } }] } }),
      db.asset.count({ where: { AND: [live, { nextServiceDate: { lte: addDays(today, 7) } }] } }),
      db.assetMaintenance.count({
        where: { AND: [childScope, { status: { in: ['OPEN', 'IN_PROGRESS'] } }] },
      }),
      db.assetAssignment.count({
        where: {
          AND: [childScope, { status: 'ACTIVE', targetType: 'EMPLOYEE', acknowledgedAt: null }],
        },
      }),
      db.assetDisposal.count({ where: { AND: [childScope, { status: 'PENDING_APPROVAL' }] } }),
      db.assetTransfer.count({ where: { AND: [childScope, { status: 'PENDING_APPROVAL' }] } }),
      db.inventoryItem.findMany({
        where: childScope,
        select: { quantity: true, reorderLevel: true },
      }),
    ]);
    const catById = new Map(categories.map((c) => [c.id, c]));
    const byCategory = new Map<string, { count: number; cost: number }>();
    let cost = 0;
    let bookValue = 0;
    for (const r of rows) {
      const c = num(r.purchaseCost);
      cost += c;
      const cat = catById.get(r.categoryId);
      bookValue += cat ? bookValueAt(c, r.purchaseDate, depreciationParams(cat), today) : c;
      const agg = byCategory.get(r.categoryId) ?? { count: 0, cost: 0 };
      agg.count += 1;
      agg.cost += c;
      byCategory.set(r.categoryId, agg);
    }
    const byStatus = {
      IN_STOCK: 0,
      ASSIGNED: 0,
      UNDER_REPAIR: 0,
      LOST: 0,
      DISPOSED: 0,
    } as AssetDashboardDto['byStatus'];
    for (const g of statusGroups) byStatus[g.status] = g._count._all;
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      totals: { count: rows.length, cost: round(cost), bookValue: round(bookValue) },
      byStatus,
      byCategory: [...byCategory.entries()]
        .map(([categoryId, v]) => ({
          categoryId,
          name: catById.get(categoryId)?.name ?? '—',
          kind: catById.get(categoryId)?.kind ?? 'OTHER',
          count: v.count,
          cost: round(v.cost),
        }))
        .sort((a, b) => b.count - a.count),
      warrantyExpiring: warranty,
      amcExpiring: amc,
      serviceDue: service,
      openMaintenance: openMt,
      pendingAcknowledgements: pendingAck,
      pendingDisposals: pd,
      pendingTransfers: pt,
      lowStockItems: stock.filter(
        (s) => num(s.reorderLevel) > 0 && num(s.quantity) <= num(s.reorderLevel),
      ).length,
    };
  },
};

export { dateOnly };
