import { z } from 'zod';
import { idSchema, paginationQuerySchema } from './common';
import { isoDateSchema } from './hr';

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).nullish();
const money = z.number().min(0).max(1e12);

export const ASSET_CATEGORY_KINDS = [
  'IT',
  'FURNITURE',
  'LAB_EQUIPMENT',
  'VEHICLE',
  'AV',
  'SPORTS',
  'ELECTRICAL',
  'MOBILE',
  'OTHER',
] as const;
export const assetCategoryKindSchema = z.enum(ASSET_CATEGORY_KINDS);
export type AssetCategoryKind = z.infer<typeof assetCategoryKindSchema>;

export const DEPRECIATION_METHODS = ['NONE', 'SLM', 'WDV'] as const;
export const depreciationMethodSchema = z.enum(DEPRECIATION_METHODS);
export type DepreciationMethod = z.infer<typeof depreciationMethodSchema>;

export const ASSET_STATUSES = ['IN_STOCK', 'ASSIGNED', 'UNDER_REPAIR', 'LOST', 'DISPOSED'] as const;
export const assetStatusSchema = z.enum(ASSET_STATUSES);
export type AssetStatus = z.infer<typeof assetStatusSchema>;

export const ASSET_CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED'] as const;
export const assetConditionSchema = z.enum(ASSET_CONDITIONS);
export type AssetCondition = z.infer<typeof assetConditionSchema>;

export const ASSET_ASSIGNMENT_TARGETS = ['EMPLOYEE', 'DEPARTMENT', 'LOCATION'] as const;
export const assetAssignmentTargetSchema = z.enum(ASSET_ASSIGNMENT_TARGETS);
export type AssetAssignmentTarget = z.infer<typeof assetAssignmentTargetSchema>;

export const ASSET_RETURN_STATUSES = ['RETURNED', 'DAMAGED', 'MISSING'] as const;
export const assetReturnStatusSchema = z.enum(ASSET_RETURN_STATUSES);
export type AssetReturnStatus = z.infer<typeof assetReturnStatusSchema>;

export const ASSET_TRANSFER_STATUSES = [
  'PENDING_APPROVAL',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
] as const;
export type AssetTransferStatus = (typeof ASSET_TRANSFER_STATUSES)[number];

export const ASSET_MAINTENANCE_TYPES = [
  'REPAIR',
  'PREVENTIVE',
  'AMC_VISIT',
  'WARRANTY_CLAIM',
  'INSPECTION',
] as const;
export const assetMaintenanceTypeSchema = z.enum(ASSET_MAINTENANCE_TYPES);
export type AssetMaintenanceType = z.infer<typeof assetMaintenanceTypeSchema>;

export const ASSET_MAINTENANCE_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
export const assetMaintenanceStatusSchema = z.enum(ASSET_MAINTENANCE_STATUSES);
export type AssetMaintenanceStatus = z.infer<typeof assetMaintenanceStatusSchema>;

export const ASSET_MAINTENANCE_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const assetMaintenancePrioritySchema = z.enum(ASSET_MAINTENANCE_PRIORITIES);
export type AssetMaintenancePriority = z.infer<typeof assetMaintenancePrioritySchema>;

export const ASSET_DISPOSAL_METHODS = [
  'SOLD',
  'SCRAPPED',
  'DONATED',
  'WRITTEN_OFF',
  'LOST',
] as const;
export const assetDisposalMethodSchema = z.enum(ASSET_DISPOSAL_METHODS);
export type AssetDisposalMethod = z.infer<typeof assetDisposalMethodSchema>;

export const ASSET_DISPOSAL_STATUSES = [
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;
export type AssetDisposalStatus = (typeof ASSET_DISPOSAL_STATUSES)[number];

export const ASSET_AUDIT_STATUSES = ['OPEN', 'COMPLETED', 'CANCELLED'] as const;
export type AssetAuditStatus = (typeof ASSET_AUDIT_STATUSES)[number];

export const ASSET_AUDIT_RESULTS = [
  'PENDING',
  'VERIFIED',
  'MISSING',
  'LOCATION_MISMATCH',
  'CONDITION_MISMATCH',
] as const;
export const assetAuditResultSchema = z.enum(ASSET_AUDIT_RESULTS);
export type AssetAuditResult = z.infer<typeof assetAuditResultSchema>;

export const INVENTORY_TRANSACTION_TYPES = ['IN', 'OUT', 'ADJUST'] as const;
export const inventoryTransactionTypeSchema = z.enum(INVENTORY_TRANSACTION_TYPES);
export type InventoryTransactionType = z.infer<typeof inventoryTransactionTypeSchema>;

/* -------------------------------------- Categories -------------------------------------- */

export const assetAttributeDefSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-zA-Z0-9_]{0,39}$/, 'Attribute key must be camelCase / snake_case'),
    label: text(80).min(1),
    type: z.enum(['text', 'number', 'date', 'boolean', 'select']).default('text'),
    options: z.array(text(80).min(1)).max(50).optional(),
    required: z.boolean().default(false),
  })
  .strict();
export type AssetAttributeDef = z.infer<typeof assetAttributeDefSchema>;

export const createAssetCategorySchema = z
  .object({
    institutionId: idSchema.nullish(),
    code: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Code may contain letters, digits, "-" and "_"'),
    name: text(120).min(1),
    kind: assetCategoryKindSchema.default('OTHER'),
    description: optionalText(1000),
    attributes: z.array(assetAttributeDefSchema).max(30).default([]),
    depreciationMethod: depreciationMethodSchema.default('SLM'),
    depreciationRate: z.number().min(0).max(100).nullish(),
    usefulLifeYears: z.number().int().min(1).max(100).nullish(),
    residualPercent: z.number().min(0).max(100).default(5),
    tagPrefix: z
      .string()
      .trim()
      .min(1)
      .max(24)
      .regex(/^[A-Z0-9][A-Z0-9/-]*$/, 'Tag prefix may contain A-Z, digits, "-" and "/"'),
    tagPadding: z.number().int().min(2).max(10).default(5),
  })
  .strict();
export type CreateAssetCategoryInput = z.infer<typeof createAssetCategorySchema>;

export const updateAssetCategorySchema = createAssetCategorySchema
  .omit({ institutionId: true, code: true })
  .partial()
  .extend({ tagNextNumber: z.number().int().min(1).max(1e9).optional() })
  .strict();
export type UpdateAssetCategoryInput = z.infer<typeof updateAssetCategorySchema>;

export const listAssetCategoriesQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    kind: assetCategoryKindSchema.optional(),
  })
  .strict();
export type ListAssetCategoriesQuery = z.infer<typeof listAssetCategoriesQuerySchema>;

/* ---------------------------------------- Assets ---------------------------------------- */

const assetAttributesSchema = z
  .record(z.string().max(40), z.union([z.string().max(500), z.number(), z.boolean(), z.null()]))
  .nullish();

export const createAssetSchema = z
  .object({
    institutionId: idSchema,
    campusId: idSchema.nullish(),
    departmentId: idSchema.nullish(),
    categoryId: idSchema,
    assetTag: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[A-Za-z0-9][A-Za-z0-9/_-]*$/, 'Invalid asset tag')
      .optional(),
    name: text(200).min(1),
    make: optionalText(120),
    model: optionalText(120),
    serialNo: optionalText(120),
    attributes: assetAttributesSchema,
    vendor: optionalText(200),
    invoiceNo: optionalText(80),
    purchaseDate: isoDateSchema.nullish(),
    purchaseCost: money.default(0),
    warrantyExpiry: isoDateSchema.nullish(),
    amcVendor: optionalText(200),
    amcExpiry: isoDateSchema.nullish(),
    serviceIntervalDays: z.number().int().min(1).max(3650).nullish(),
    nextServiceDate: isoDateSchema.nullish(),
    location: optionalText(200),
    condition: assetConditionSchema.default('NEW'),
    status: z.enum(['IN_STOCK', 'UNDER_REPAIR', 'LOST']).default('IN_STOCK'),
    notes: optionalText(2000),
  })
  .strict();
export type CreateAssetInput = z.infer<typeof createAssetSchema>;

/** Institution moves go through a transfer; status moves through check-out / repair / disposal. */
export const updateAssetSchema = createAssetSchema
  .omit({ institutionId: true, assetTag: true, status: true })
  .partial()
  .extend({ status: z.enum(['IN_STOCK', 'LOST']).optional() })
  .strict();
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;

export const listAssetsQuerySchema = paginationQuerySchema
  .extend({
    groupId: idSchema.optional(),
    institutionId: idSchema.optional(),
    campusId: idSchema.optional(),
    departmentId: idSchema.optional(),
    categoryId: idSchema.optional(),
    kind: assetCategoryKindSchema.optional(),
    status: assetStatusSchema.optional(),
    condition: assetConditionSchema.optional(),
    custodianEmployeeId: idSchema.optional(),
    assetTag: z.string().trim().max(40).optional(),
    /** Warranty or AMC expiring within N days (or already expired when 0). */
    expiringWithinDays: z.coerce.number().int().min(0).max(3650).optional(),
  })
  .strict();
export type ListAssetsQuery = z.infer<typeof listAssetsQuerySchema>;

export const assetLabelsSchema = z
  .object({
    assetIds: z.array(idSchema).min(1).max(500).optional(),
    institutionId: idSchema.optional(),
    categoryId: idSchema.optional(),
  })
  .strict()
  .refine((v) => v.assetIds?.length || v.institutionId, 'Provide assetIds or institutionId');
export type AssetLabelsInput = z.infer<typeof assetLabelsSchema>;

/* -------------------------------------- Assignments ------------------------------------- */

export const checkoutAssetSchema = z
  .object({
    targetType: assetAssignmentTargetSchema.default('EMPLOYEE'),
    employeeId: idSchema.nullish(),
    departmentId: idSchema.nullish(),
    location: optionalText(200),
    assignedAt: isoDateSchema.optional(),
    expectedReturnDate: isoDateSchema.nullish(),
    accessories: z.array(text(120).min(1)).max(20).default([]),
    condition: assetConditionSchema.optional(),
    notes: optionalText(1000),
  })
  .strict()
  .refine((v) => v.targetType !== 'EMPLOYEE' || v.employeeId, {
    message: 'employeeId is required for employee assignments',
    path: ['employeeId'],
  })
  .refine((v) => v.targetType !== 'DEPARTMENT' || v.departmentId, {
    message: 'departmentId is required for department assignments',
    path: ['departmentId'],
  })
  .refine((v) => v.targetType !== 'LOCATION' || v.location, {
    message: 'location is required for location assignments',
    path: ['location'],
  });
export type CheckoutAssetInput = z.infer<typeof checkoutAssetSchema>;

export const checkinAssetSchema = z
  .object({
    returnedAt: isoDateSchema.optional(),
    returnStatus: assetReturnStatusSchema.default('RETURNED'),
    condition: assetConditionSchema.optional(),
    recoveryAmount: money.nullish(),
    notes: optionalText(1000),
  })
  .strict();
export type CheckinAssetInput = z.infer<typeof checkinAssetSchema>;

export const acknowledgeAssignmentSchema = z.object({ note: optionalText(1000) }).strict();
export type AcknowledgeAssignmentInput = z.infer<typeof acknowledgeAssignmentSchema>;

export const listAssetAssignmentsQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    assetId: idSchema.optional(),
    employeeId: idSchema.optional(),
    status: z.enum(['ACTIVE', 'RETURNED']).optional(),
    acknowledged: z.enum(['true', 'false']).optional(),
  })
  .strict();
export type ListAssetAssignmentsQuery = z.infer<typeof listAssetAssignmentsQuerySchema>;

/* --------------------------------------- Transfers -------------------------------------- */

export const createAssetTransferSchema = z
  .object({
    toInstitutionId: idSchema,
    toCampusId: idSchema.nullish(),
    toDepartmentId: idSchema.nullish(),
    toLocation: optionalText(200),
    reason: optionalText(1000),
  })
  .strict();
export type CreateAssetTransferInput = z.infer<typeof createAssetTransferSchema>;

export const listAssetTransfersQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    assetId: idSchema.optional(),
    status: z.enum(ASSET_TRANSFER_STATUSES).optional(),
  })
  .strict();
export type ListAssetTransfersQuery = z.infer<typeof listAssetTransfersQuerySchema>;

/* -------------------------------------- Maintenance ------------------------------------- */

export const createAssetMaintenanceSchema = z
  .object({
    assetId: idSchema,
    type: assetMaintenanceTypeSchema.default('REPAIR'),
    priority: assetMaintenancePrioritySchema.default('MEDIUM'),
    title: text(200).min(1),
    description: optionalText(2000),
    vendor: optionalText(200),
    scheduledDate: isoDateSchema.nullish(),
    cost: money.optional(),
    underWarranty: z.boolean().optional(),
  })
  .strict();
export type CreateAssetMaintenanceInput = z.infer<typeof createAssetMaintenanceSchema>;

export const updateAssetMaintenanceSchema = z
  .object({
    status: assetMaintenanceStatusSchema.optional(),
    priority: assetMaintenancePrioritySchema.optional(),
    title: text(200).min(1).optional(),
    description: optionalText(2000),
    vendor: optionalText(200),
    scheduledDate: isoDateSchema.nullish(),
    completedAt: isoDateSchema.nullish(),
    cost: money.optional(),
    underWarranty: z.boolean().optional(),
    resolution: optionalText(2000),
    nextServiceDate: isoDateSchema.nullish(),
    condition: assetConditionSchema.optional(),
  })
  .strict();
export type UpdateAssetMaintenanceInput = z.infer<typeof updateAssetMaintenanceSchema>;

export const listAssetMaintenanceQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    assetId: idSchema.optional(),
    type: assetMaintenanceTypeSchema.optional(),
    status: assetMaintenanceStatusSchema.optional(),
    open: z.enum(['true', 'false']).optional(),
  })
  .strict();
export type ListAssetMaintenanceQuery = z.infer<typeof listAssetMaintenanceQuerySchema>;

/** Employee self-service: report a problem with an asset in their custody. */
export const reportAssetIssueSchema = z
  .object({
    title: text(200).min(1),
    description: optionalText(2000),
    priority: assetMaintenancePrioritySchema.default('MEDIUM'),
  })
  .strict();
export type ReportAssetIssueInput = z.infer<typeof reportAssetIssueSchema>;

/* --------------------------------------- Disposal --------------------------------------- */

export const createAssetDisposalSchema = z
  .object({
    assetId: idSchema,
    method: assetDisposalMethodSchema,
    disposalDate: isoDateSchema,
    saleValue: money.nullish(),
    buyer: optionalText(200),
    reason: text(1000).min(1),
  })
  .strict();
export type CreateAssetDisposalInput = z.infer<typeof createAssetDisposalSchema>;

export const listAssetDisposalsQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    status: z.enum(ASSET_DISPOSAL_STATUSES).optional(),
  })
  .strict();
export type ListAssetDisposalsQuery = z.infer<typeof listAssetDisposalsQuerySchema>;

/** Direct approve / reject (only when no approval workflow is configured). */
export const decideAssetDisposalSchema = z.object({ comment: optionalText(1000) }).strict();
export type DecideAssetDisposalInput = z.infer<typeof decideAssetDisposalSchema>;

export const assetDepreciationQuerySchema = z.object({ asOf: isoDateSchema.optional() }).strict();
export type AssetDepreciationQuery = z.infer<typeof assetDepreciationQuerySchema>;

/* ---------------------------------------- Audits ---------------------------------------- */

export const createAssetAuditSchema = z
  .object({
    institutionId: idSchema,
    campusId: idSchema.nullish(),
    departmentId: idSchema.nullish(),
    categoryId: idSchema.nullish(),
    name: text(200).min(1),
    notes: optionalText(2000),
  })
  .strict();
export type CreateAssetAuditInput = z.infer<typeof createAssetAuditSchema>;

export const listAssetAuditsQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    status: z.enum(ASSET_AUDIT_STATUSES).optional(),
  })
  .strict();
export type ListAssetAuditsQuery = z.infer<typeof listAssetAuditsQuerySchema>;

export const listAssetAuditItemsQuerySchema = paginationQuerySchema
  .extend({ result: assetAuditResultSchema.optional() })
  .strict();
export type ListAssetAuditItemsQuery = z.infer<typeof listAssetAuditItemsQuerySchema>;

/** Scan (by tag) or pick (by id) an asset and record what was found. */
export const verifyAssetAuditItemSchema = z
  .object({
    assetId: idSchema.optional(),
    assetTag: z.string().trim().min(1).max(40).optional(),
    result: assetAuditResultSchema.exclude(['PENDING']).optional(),
    observedLocation: optionalText(200),
    observedCondition: assetConditionSchema.nullish(),
    notes: optionalText(1000),
  })
  .strict()
  .refine((v) => v.assetId || v.assetTag, 'Provide assetId or assetTag');
export type VerifyAssetAuditItemInput = z.infer<typeof verifyAssetAuditItemSchema>;

/* --------------------------------------- Inventory -------------------------------------- */

export const createInventoryItemSchema = z
  .object({
    institutionId: idSchema,
    campusId: idSchema.nullish(),
    departmentId: idSchema.nullish(),
    sku: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[A-Za-z0-9][A-Za-z0-9/_-]*$/, 'Invalid SKU'),
    name: text(200).min(1),
    category: optionalText(80),
    unit: text(24).min(1).default('pcs'),
    reorderLevel: z.number().min(0).max(1e9).default(0),
    unitCost: money.nullish(),
    location: optionalText(200),
    notes: optionalText(1000),
    openingQuantity: z.number().min(0).max(1e9).default(0),
  })
  .strict();
export type CreateInventoryItemInput = z.infer<typeof createInventoryItemSchema>;

export const updateInventoryItemSchema = createInventoryItemSchema
  .omit({ institutionId: true, sku: true, openingQuantity: true })
  .partial()
  .strict();
export type UpdateInventoryItemInput = z.infer<typeof updateInventoryItemSchema>;

export const listInventoryItemsQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    lowStock: z.enum(['true', 'false']).optional(),
  })
  .strict();
export type ListInventoryItemsQuery = z.infer<typeof listInventoryItemsQuerySchema>;

export const inventoryTransactionSchema = z
  .object({
    type: inventoryTransactionTypeSchema,
    /** IN/OUT: positive quantity; ADJUST: the counted balance. */
    quantity: z.number().min(0).max(1e9),
    date: isoDateSchema.optional(),
    unitCost: money.nullish(),
    reference: optionalText(120),
    issuedToEmployeeId: idSchema.nullish(),
    notes: optionalText(1000),
  })
  .strict();
export type InventoryTransactionInput = z.infer<typeof inventoryTransactionSchema>;

/* ---------------------------------------- Reports --------------------------------------- */

export const ASSET_REPORT_TYPES = [
  'register',
  'depreciation',
  'assignments',
  'maintenance',
  'disposals',
] as const;
export const assetReportQuerySchema = z
  .object({
    type: z.enum(ASSET_REPORT_TYPES).default('register'),
    format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json'),
    institutionId: idSchema.optional(),
    categoryId: idSchema.optional(),
    asOf: isoDateSchema.optional(),
  })
  .strict();
export type AssetReportQuery = z.infer<typeof assetReportQuerySchema>;

export const assetDashboardQuerySchema = z
  .object({ institutionId: idSchema.optional(), groupId: idSchema.optional() })
  .strict();
export type AssetDashboardQuery = z.infer<typeof assetDashboardQuerySchema>;
