import type {
  AssetAssignmentTarget,
  AssetAttributeDef,
  AssetAuditResult,
  AssetAuditStatus,
  AssetCategoryKind,
  AssetCondition,
  AssetDisposalMethod,
  AssetDisposalStatus,
  AssetMaintenancePriority,
  AssetMaintenanceStatus,
  AssetMaintenanceType,
  AssetReturnStatus,
  AssetStatus,
  AssetTransferStatus,
  DepreciationMethod,
  InventoryTransactionType,
} from '../schemas/assets';

type Ref = { id: string; name: string; code: string } | null;

export interface AssetCategoryDto {
  id: string;
  groupId: string | null;
  institutionId: string | null;
  code: string;
  name: string;
  kind: AssetCategoryKind;
  description: string | null;
  attributes: AssetAttributeDef[];
  depreciationMethod: DepreciationMethod;
  depreciationRate: number | null;
  usefulLifeYears: number | null;
  residualPercent: number;
  tagPrefix: string;
  tagPadding: number;
  tagNextNumber: number;
  assetCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AssetEmployeeRef {
  id: string;
  employeeCode: string;
  displayName: string;
  userId?: string | null;
}

export interface AssetDto {
  id: string;
  assetTag: string;
  name: string;
  groupId: string | null;
  institutionId: string;
  campusId: string | null;
  departmentId: string | null;
  categoryId: string;
  make: string | null;
  model: string | null;
  serialNo: string | null;
  attributes: Record<string, unknown> | null;
  vendor: string | null;
  invoiceNo: string | null;
  purchaseDate: string | null;
  purchaseCost: number;
  warrantyExpiry: string | null;
  invoiceDocumentId: string | null;
  amcVendor: string | null;
  amcExpiry: string | null;
  serviceIntervalDays: number | null;
  nextServiceDate: string | null;
  location: string | null;
  condition: AssetCondition;
  status: AssetStatus;
  custodianEmployeeId: string | null;
  lastVerifiedAt: string | null;
  disposedAt: string | null;
  notes: string | null;
  /** Book value as of today (per the category's depreciation method). */
  bookValue: number;
  category?: { id: string; name: string; code: string; kind: AssetCategoryKind } | null;
  institution?: Ref;
  campus?: Ref;
  department?: Ref;
  custodian?: AssetEmployeeRef | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssetAssignmentDto {
  id: string;
  assetId: string;
  institutionId: string;
  targetType: AssetAssignmentTarget;
  employeeId: string | null;
  assignedDepartmentId: string | null;
  location: string | null;
  assignedAt: string;
  expectedReturnDate: string | null;
  accessories: string[];
  conditionOut: AssetCondition;
  notes: string | null;
  status: 'ACTIVE' | 'RETURNED';
  acknowledgedAt: string | null;
  acknowledgementNote: string | null;
  handoverDocumentId: string | null;
  returnedAt: string | null;
  returnStatus: AssetReturnStatus | null;
  conditionIn: AssetCondition | null;
  recoveryAmount: number | null;
  returnNotes: string | null;
  asset?: { id: string; assetTag: string; name: string; status: AssetStatus } | null;
  employee?: AssetEmployeeRef | null;
  createdAt: string;
}

export interface AssetTransferDto {
  id: string;
  assetId: string;
  institutionId: string;
  departmentId: string | null;
  toInstitutionId: string;
  toCampusId: string | null;
  toDepartmentId: string | null;
  fromLocation: string | null;
  toLocation: string | null;
  reason: string | null;
  status: AssetTransferStatus;
  workflowInstanceId: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  asset?: { id: string; assetTag: string; name: string } | null;
  createdAt: string;
}

export interface AssetMaintenanceDto {
  id: string;
  ticketNo: string;
  assetId: string;
  institutionId: string;
  type: AssetMaintenanceType;
  priority: AssetMaintenancePriority;
  status: AssetMaintenanceStatus;
  title: string;
  description: string | null;
  vendor: string | null;
  scheduledDate: string | null;
  completedAt: string | null;
  cost: number;
  underWarranty: boolean;
  resolution: string | null;
  nextServiceDate: string | null;
  reportedByEmployeeId: string | null;
  asset?: { id: string; assetTag: string; name: string; status: AssetStatus } | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssetDisposalDto {
  id: string;
  assetId: string;
  institutionId: string;
  method: AssetDisposalMethod;
  disposalDate: string;
  bookValue: number;
  saleValue: number | null;
  buyer: string | null;
  reason: string;
  status: AssetDisposalStatus;
  workflowInstanceId: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  asset?: { id: string; assetTag: string; name: string; status: AssetStatus } | null;
  createdAt: string;
}

export interface AssetAuditDto {
  id: string;
  institutionId: string;
  campusId: string | null;
  departmentId: string | null;
  categoryId: string | null;
  name: string;
  status: AssetAuditStatus;
  notes: string | null;
  completedAt: string | null;
  counts: Record<AssetAuditResult, number> & { total: number };
  createdAt: string;
}

export interface AssetAuditItemDto {
  id: string;
  auditId: string;
  assetId: string;
  expectedLocation: string | null;
  expectedCondition: AssetCondition | null;
  result: AssetAuditResult;
  observedLocation: string | null;
  observedCondition: AssetCondition | null;
  notes: string | null;
  verifiedAt: string | null;
  asset?: { id: string; assetTag: string; name: string; status: AssetStatus } | null;
}

export interface InventoryItemDto {
  id: string;
  institutionId: string;
  campusId: string | null;
  departmentId: string | null;
  sku: string;
  name: string;
  category: string | null;
  unit: string;
  quantity: number;
  reorderLevel: number;
  unitCost: number | null;
  location: string | null;
  notes: string | null;
  lowStock: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryTransactionDto {
  id: string;
  itemId: string;
  type: InventoryTransactionType;
  quantity: number;
  balanceAfter: number;
  unitCost: number | null;
  date: string;
  reference: string | null;
  issuedToEmployeeId: string | null;
  notes: string | null;
  createdAt: string;
}

export interface DepreciationRow {
  year: number;
  fromDate: string;
  toDate: string;
  openingValue: number;
  depreciation: number;
  closingValue: number;
}

export interface AssetDepreciationScheduleDto {
  assetId: string;
  method: DepreciationMethod;
  rate: number | null;
  usefulLifeYears: number | null;
  residualValue: number;
  cost: number;
  bookValue: number;
  accumulatedDepreciation: number;
  rows: DepreciationRow[];
}

export interface AssetDashboardDto {
  totals: { count: number; cost: number; bookValue: number };
  byStatus: Record<AssetStatus, number>;
  byCategory: { categoryId: string; name: string; kind: string; count: number; cost: number }[];
  warrantyExpiring: number;
  amcExpiring: number;
  serviceDue: number;
  openMaintenance: number;
  pendingAcknowledgements: number;
  pendingDisposals: number;
  pendingTransfers: number;
  lowStockItems: number;
}

export interface MyAssetDto {
  assignment: AssetAssignmentDto;
  asset: AssetDto;
}
