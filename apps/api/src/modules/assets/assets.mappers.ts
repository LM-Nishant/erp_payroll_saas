import type {
  Asset,
  AssetAssignment,
  AssetAudit,
  AssetAuditItem,
  AssetCategory,
  AssetDisposal,
  AssetMaintenance,
  AssetTransfer,
  InventoryItem,
  InventoryTransaction,
  Prisma,
} from '@prisma/client';
import type {
  AssetAssignmentDto,
  AssetAttributeDef,
  AssetAuditDto,
  AssetAuditItemDto,
  AssetAuditResult,
  AssetCategoryDto,
  AssetDisposalDto,
  AssetDto,
  AssetEmployeeRef,
  AssetMaintenanceDto,
  AssetTransferDto,
  InventoryItemDto,
  InventoryTransactionDto,
} from '@erp/shared';
import { bookValueAt, todayUtc, type DepreciationParams } from './assets.logic';

export const dateStr = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
export const toDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const toDateOrNull = (s: string | null | undefined) =>
  s === undefined ? undefined : s ? toDate(s) : null;
export const num = (d: Prisma.Decimal | number | null | undefined) =>
  d === null || d === undefined ? 0 : Number(d);
export const numOrNull = (d: Prisma.Decimal | number | null | undefined) =>
  d === null || d === undefined ? null : Number(d);

type Ref = { id: string; name: string; code: string } | null;

export function depreciationParams(c: AssetCategory): DepreciationParams {
  return {
    method: c.depreciationMethod,
    ratePercent: numOrNull(c.depreciationRate),
    usefulLifeYears: c.usefulLifeYears,
    residualPercent: num(c.residualPercent),
  };
}

export function toCategoryDto(c: AssetCategory, assetCount?: number): AssetCategoryDto {
  return {
    id: c.id,
    groupId: c.groupId,
    institutionId: c.institutionId,
    code: c.code,
    name: c.name,
    kind: c.kind as AssetCategoryDto['kind'],
    description: c.description,
    attributes: Array.isArray(c.attributes) ? (c.attributes as unknown as AssetAttributeDef[]) : [],
    depreciationMethod: c.depreciationMethod,
    depreciationRate: numOrNull(c.depreciationRate),
    usefulLifeYears: c.usefulLifeYears,
    residualPercent: num(c.residualPercent),
    tagPrefix: c.tagPrefix,
    tagPadding: c.tagPadding,
    tagNextNumber: c.tagNextNumber,
    ...(assetCount !== undefined ? { assetCount } : {}),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export const employeeRefSelect = {
  id: true,
  employeeCode: true,
  displayName: true,
  userId: true,
} as const;

export const assetInclude = {
  category: true,
  institution: { select: { id: true, name: true, code: true } },
  campus: { select: { id: true, name: true, code: true } },
  department: { select: { id: true, name: true, code: true } },
  custodian: { select: employeeRefSelect },
} as const;

export type AssetWithRefs = Asset & {
  category: AssetCategory;
  institution?: Ref;
  campus?: Ref;
  department?: Ref;
  custodian?: AssetEmployeeRef | null;
};

export function assetBookValue(a: AssetWithRefs, asOf = todayUtc()) {
  if (a.status === 'DISPOSED') return 0;
  return bookValueAt(num(a.purchaseCost), a.purchaseDate, depreciationParams(a.category), asOf);
}

export function toAssetDto(a: AssetWithRefs): AssetDto {
  return {
    id: a.id,
    assetTag: a.assetTag,
    name: a.name,
    groupId: a.groupId,
    institutionId: a.institutionId,
    campusId: a.campusId,
    departmentId: a.departmentId,
    categoryId: a.categoryId,
    make: a.make,
    model: a.model,
    serialNo: a.serialNo,
    attributes: (a.attributes as Record<string, unknown> | null) ?? null,
    vendor: a.vendor,
    invoiceNo: a.invoiceNo,
    purchaseDate: dateStr(a.purchaseDate),
    purchaseCost: num(a.purchaseCost),
    warrantyExpiry: dateStr(a.warrantyExpiry),
    invoiceDocumentId: a.invoiceDocumentId,
    amcVendor: a.amcVendor,
    amcExpiry: dateStr(a.amcExpiry),
    serviceIntervalDays: a.serviceIntervalDays,
    nextServiceDate: dateStr(a.nextServiceDate),
    location: a.location,
    condition: a.condition,
    status: a.status,
    custodianEmployeeId: a.custodianEmployeeId,
    lastVerifiedAt: iso(a.lastVerifiedAt),
    disposedAt: dateStr(a.disposedAt),
    notes: a.notes,
    bookValue: assetBookValue(a),
    category: a.category
      ? {
          id: a.category.id,
          name: a.category.name,
          code: a.category.code,
          kind: a.category.kind as AssetCategoryDto['kind'],
        }
      : null,
    institution: a.institution ?? null,
    campus: a.campus ?? null,
    department: a.department ?? null,
    custodian: a.custodian ?? null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

/** Compact asset reference embedded in child rows. */
export const assetRefSelect = { id: true, assetTag: true, name: true, status: true } as const;
type AssetRef = { id: string; assetTag: string; name: string; status: Asset['status'] };

export function toAssignmentDto(
  a: AssetAssignment & { asset?: AssetRef | null; employee?: AssetEmployeeRef | null },
): AssetAssignmentDto {
  return {
    id: a.id,
    assetId: a.assetId,
    institutionId: a.institutionId,
    targetType: a.targetType,
    employeeId: a.employeeId,
    assignedDepartmentId: a.assignedDepartmentId,
    location: a.location,
    assignedAt: dateStr(a.assignedAt)!,
    expectedReturnDate: dateStr(a.expectedReturnDate),
    accessories: Array.isArray(a.accessories) ? (a.accessories as string[]) : [],
    conditionOut: a.conditionOut,
    notes: a.notes,
    status: a.status,
    acknowledgedAt: iso(a.acknowledgedAt),
    acknowledgementNote: a.acknowledgementNote,
    handoverDocumentId: a.handoverDocumentId,
    returnedAt: dateStr(a.returnedAt),
    returnStatus: a.returnStatus,
    conditionIn: a.conditionIn,
    recoveryAmount: numOrNull(a.recoveryAmount),
    returnNotes: a.returnNotes,
    asset: a.asset ?? null,
    employee: a.employee ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

export function toTransferDto(
  t: AssetTransfer & { asset?: { id: string; assetTag: string; name: string } | null },
): AssetTransferDto {
  return {
    id: t.id,
    assetId: t.assetId,
    institutionId: t.institutionId,
    departmentId: t.departmentId,
    toInstitutionId: t.toInstitutionId,
    toCampusId: t.toCampusId,
    toDepartmentId: t.toDepartmentId,
    fromLocation: t.fromLocation,
    toLocation: t.toLocation,
    reason: t.reason,
    status: t.status,
    workflowInstanceId: t.workflowInstanceId,
    decidedAt: iso(t.decidedAt),
    decisionComment: t.decisionComment,
    asset: t.asset ? { id: t.asset.id, assetTag: t.asset.assetTag, name: t.asset.name } : null,
    createdAt: t.createdAt.toISOString(),
  };
}

export function toMaintenanceDto(
  m: AssetMaintenance & { asset?: AssetRef | null },
): AssetMaintenanceDto {
  return {
    id: m.id,
    ticketNo: m.ticketNo,
    assetId: m.assetId,
    institutionId: m.institutionId,
    type: m.type,
    priority: m.priority,
    status: m.status,
    title: m.title,
    description: m.description,
    vendor: m.vendor,
    scheduledDate: dateStr(m.scheduledDate),
    completedAt: dateStr(m.completedAt),
    cost: num(m.cost),
    underWarranty: m.underWarranty,
    resolution: m.resolution,
    nextServiceDate: dateStr(m.nextServiceDate),
    reportedByEmployeeId: m.reportedByEmployeeId,
    asset: m.asset ?? null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

export function toDisposalDto(d: AssetDisposal & { asset?: AssetRef | null }): AssetDisposalDto {
  return {
    id: d.id,
    assetId: d.assetId,
    institutionId: d.institutionId,
    method: d.method,
    disposalDate: dateStr(d.disposalDate)!,
    bookValue: num(d.bookValue),
    saleValue: numOrNull(d.saleValue),
    buyer: d.buyer,
    reason: d.reason,
    status: d.status,
    workflowInstanceId: d.workflowInstanceId,
    decidedAt: iso(d.decidedAt),
    decisionComment: d.decisionComment,
    asset: d.asset ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

export function toAuditDto(
  a: AssetAudit,
  counts: Partial<Record<AssetAuditResult, number>>,
): AssetAuditDto {
  const full = {
    PENDING: counts.PENDING ?? 0,
    VERIFIED: counts.VERIFIED ?? 0,
    MISSING: counts.MISSING ?? 0,
    LOCATION_MISMATCH: counts.LOCATION_MISMATCH ?? 0,
    CONDITION_MISMATCH: counts.CONDITION_MISMATCH ?? 0,
  };
  return {
    id: a.id,
    institutionId: a.institutionId,
    campusId: a.campusId,
    departmentId: a.departmentId,
    categoryId: a.categoryId,
    name: a.name,
    status: a.status,
    notes: a.notes,
    completedAt: iso(a.completedAt),
    counts: { ...full, total: Object.values(full).reduce((s, n) => s + n, 0) },
    createdAt: a.createdAt.toISOString(),
  };
}

export function toAuditItemDto(i: AssetAuditItem & { asset?: AssetRef | null }): AssetAuditItemDto {
  return {
    id: i.id,
    auditId: i.auditId,
    assetId: i.assetId,
    expectedLocation: i.expectedLocation,
    expectedCondition: i.expectedCondition,
    result: i.result,
    observedLocation: i.observedLocation,
    observedCondition: i.observedCondition,
    notes: i.notes,
    verifiedAt: iso(i.verifiedAt),
    asset: i.asset ?? null,
  };
}

export function toInventoryItemDto(i: InventoryItem): InventoryItemDto {
  const quantity = num(i.quantity);
  const reorderLevel = num(i.reorderLevel);
  return {
    id: i.id,
    institutionId: i.institutionId,
    campusId: i.campusId,
    departmentId: i.departmentId,
    sku: i.sku,
    name: i.name,
    category: i.category,
    unit: i.unit,
    quantity,
    reorderLevel,
    unitCost: numOrNull(i.unitCost),
    location: i.location,
    notes: i.notes,
    lowStock: reorderLevel > 0 && quantity <= reorderLevel,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

export function toInventoryTxnDto(t: InventoryTransaction): InventoryTransactionDto {
  return {
    id: t.id,
    itemId: t.itemId,
    type: t.type,
    quantity: num(t.quantity),
    balanceAfter: num(t.balanceAfter),
    unitCost: numOrNull(t.unitCost),
    date: dateStr(t.date)!,
    reference: t.reference,
    issuedToEmployeeId: t.issuedToEmployeeId,
    notes: t.notes,
    createdAt: t.createdAt.toISOString(),
  };
}
