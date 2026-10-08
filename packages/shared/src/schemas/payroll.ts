import { z } from 'zod';
import { idSchema, nameSchema, paginationQuerySchema } from './common';
import { employmentTypeSchema, isoDateSchema } from './hr';

/*
 * Payroll rule engine (Layer 8). Amounts are monthly, in the salary currency (INR by default).
 * Component / variable codes are UPPER_SNAKE (`BASIC`, `HRA`, `PF_EE`); formulas use the safe
 * expression language of `modules/payroll/formula.ts` (arithmetic, comparisons, `&&` `||` `!`,
 * `?:`, min / max / round / floor / ceil / abs / if). All request schemas are `.strict()`.
 */

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).nullish();
const money = z.number().min(-1_000_000_000).max(1_000_000_000);
const positiveMoney = z.number().min(0).max(1_000_000_000);
const percent = z.number().min(0).max(1000);

export const payrollCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(32)
  .regex(/^[A-Z][A-Z0-9_]*$/, 'Code must be UPPER_SNAKE (letters, digits, "_")');

export const formulaSchema = z.string().trim().min(1).max(2000);

/** `YYYY-YY`, e.g. 2025-26 (April..March). */
export const financialYearSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}$/, 'Must be YYYY-YY (e.g. 2025-26)');

/* --------------------------------- Components ------------------------------------------- */

export const SALARY_COMPONENT_TYPES = [
  'EARNING',
  'DEDUCTION',
  'EMPLOYER_CONTRIBUTION',
  'REIMBURSEMENT',
  'STATUTORY',
] as const;
export const salaryComponentTypeSchema = z.enum(SALARY_COMPONENT_TYPES);
export type SalaryComponentType = z.infer<typeof salaryComponentTypeSchema>;

export const SALARY_CALC_TYPES = ['FIXED', 'PERCENTAGE', 'FORMULA', 'SLAB', 'STATUTORY'] as const;
export const salaryCalcTypeSchema = z.enum(SALARY_CALC_TYPES);
export type SalaryCalcType = z.infer<typeof salaryCalcTypeSchema>;

/** Statutory computations provided by the India rule packs (§19). */
export const STATUTORY_CODES = [
  'PF_EE',
  'PF_ER',
  'ESI_EE',
  'ESI_ER',
  'PT',
  'TDS',
  'LWF_EE',
  'LWF_ER',
] as const;
export const statutoryCodeSchema = z.enum(STATUTORY_CODES);
export type StatutoryCode = z.infer<typeof statutoryCodeSchema>;

export const ROUNDING_MODES = ['NONE', 'NEAREST', 'UP', 'DOWN'] as const;
export const roundingModeSchema = z.enum(ROUNDING_MODES);
export type RoundingMode = z.infer<typeof roundingModeSchema>;

export const slabRowSchema = z
  .object({
    /** Inclusive lower bound of the basis. */
    from: z.number().min(0),
    /** Inclusive upper bound (null = no upper bound). */
    to: z.number().min(0).nullish(),
    /** Flat amount for the slab … */
    amount: money.nullish(),
    /** … or a percentage of the basis. */
    percent: percent.nullish(),
  })
  .strict();
export type SlabRow = z.infer<typeof slabRowSchema>;

/** Calculation fields shared by components, salary rules and structure lines. */
export const calcFields = {
  calcType: salaryCalcTypeSchema.optional(),
  /** FIXED: default monthly amount (an employee's salary `amounts[CODE]` overrides it). */
  amount: money.nullish(),
  /** PERCENTAGE: `percentage` % of `percentOf` (CTC, BASIC, GROSS or a component code). */
  percentage: percent.nullish(),
  percentOf: payrollCodeSchema.nullish(),
  /** FORMULA: expression over variables / component codes. */
  formula: formulaSchema.nullish(),
  /** SLAB: basis variable / component + slab rows. */
  slabBasis: payrollCodeSchema.nullish(),
  slabs: z.array(slabRowSchema).max(50).nullish(),
};
const _calcObject = z.object(calcFields).strict();
export type CalcFields = z.infer<typeof _calcObject>;

export const createSalaryComponentSchema = z
  .object({
    /** null / omitted = organization-wide default; set = institution-specific policy. */
    institutionId: idSchema.nullish(),
    code: payrollCodeSchema,
    name: nameSchema,
    type: salaryComponentTypeSchema,
    ...calcFields,
    calcType: salaryCalcTypeSchema,
    statutoryCode: statutoryCodeSchema.nullish(),
    taxable: z.boolean().default(true),
    /** Multiply by payable days / calendar days (LOP, joiners, leavers, transfers). */
    proRated: z.boolean().default(true),
    rounding: roundingModeSchema.default('NEAREST'),
    roundingPrecision: z.number().int().min(0).max(2).default(0),
    displayOrder: z.number().int().min(0).max(9999).default(100),
    showOnPayslip: z.boolean().default(true),
    description: optionalText(500),
  })
  .strict();
export type CreateSalaryComponentInput = z.input<typeof createSalaryComponentSchema>;

export const updateSalaryComponentSchema = z
  .object({
    name: nameSchema.optional(),
    ...calcFields,
    statutoryCode: statutoryCodeSchema.nullish(),
    taxable: z.boolean().optional(),
    proRated: z.boolean().optional(),
    rounding: roundingModeSchema.optional(),
    roundingPrecision: z.number().int().min(0).max(2).optional(),
    displayOrder: z.number().int().min(0).max(9999).optional(),
    showOnPayslip: z.boolean().optional(),
    description: optionalText(500),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict();
export type UpdateSalaryComponentInput = z.input<typeof updateSalaryComponentSchema>;

export const listComponentsQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    type: salaryComponentTypeSchema.optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict();
export type ListComponentsQuery = z.infer<typeof listComponentsQuerySchema>;

export const seedDefaultComponentsSchema = z.object({ institutionId: idSchema.nullish() }).strict();

/* --------------------------------- Salary rules ----------------------------------------- */

/**
 * Effective-dated, versioned override of a component's calculation (per institution or org).
 * Precedence: structure line > institution rule > organization rule > component default.
 */
export const createSalaryRuleSchema = z
  .object({
    institutionId: idSchema.nullish(),
    componentCode: payrollCodeSchema,
    effectiveFrom: isoDateSchema,
    ...calcFields,
    calcType: salaryCalcTypeSchema,
    /** Optional boolean formula; the rule applies only when it evaluates truthy. */
    condition: formulaSchema.nullish(),
    notes: optionalText(500),
  })
  .strict();
export type CreateSalaryRuleInput = z.input<typeof createSalaryRuleSchema>;

export const listRulesQuerySchema = paginationQuerySchema
  .extend({ institutionId: idSchema.optional(), componentCode: payrollCodeSchema.optional() })
  .strict();

/* --------------------------------- Structures ------------------------------------------- */

export const structureLineSchema = z
  .object({
    componentCode: payrollCodeSchema,
    ...calcFields,
  })
  .strict();
export type StructureLine = z.infer<typeof structureLineSchema>;

export const structureVersionSchema = z
  .object({
    effectiveFrom: isoDateSchema,
    lines: z.array(structureLineSchema).min(1).max(100),
    notes: optionalText(500),
  })
  .strict();
export type StructureVersionInput = z.infer<typeof structureVersionSchema>;

export const createSalaryStructureSchema = z
  .object({
    institutionId: idSchema,
    code: payrollCodeSchema,
    name: nameSchema,
    employmentType: employmentTypeSchema.nullish(),
    grade: optionalText(64),
    description: optionalText(500),
    version: structureVersionSchema,
  })
  .strict();
export type CreateSalaryStructureInput = z.input<typeof createSalaryStructureSchema>;

export const updateSalaryStructureSchema = z
  .object({
    name: nameSchema.optional(),
    grade: optionalText(64),
    description: optionalText(500),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict();

export const listStructuresQuerySchema = paginationQuerySchema
  .extend({ institutionId: idSchema.optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional() })
  .strict();

/* --------------------------------- Settings & statutory --------------------------------- */

export const TAX_REGIMES = ['OLD', 'NEW'] as const;
export const taxRegimeSchema = z.enum(TAX_REGIMES);
export type TaxRegime = z.infer<typeof taxRegimeSchema>;

export const upsertPayrollSettingsSchema = z
  .object({
    institutionId: idSchema,
    /** State code for Professional Tax / LWF (e.g. KA, MH). */
    state: z.string().trim().toUpperCase().min(2).max(8).nullish(),
    pfEnabled: z.boolean().default(true),
    esiEnabled: z.boolean().default(true),
    ptEnabled: z.boolean().default(true),
    tdsEnabled: z.boolean().default(true),
    lwfEnabled: z.boolean().default(false),
    /** Require an attendance period lock covering the run period before computing. */
    requireAttendanceLock: z.boolean().default(true),
    payDay: z.number().int().min(1).max(31).nullish(),
  })
  .strict();
export type UpsertPayrollSettingsInput = z.input<typeof upsertPayrollSettingsSchema>;

export const STATUTORY_PACKS = ['PF', 'ESI', 'PT', 'TDS', 'LWF'] as const;
export const statutoryPackSchema = z.enum(STATUTORY_PACKS);
export type StatutoryPack = z.infer<typeof statutoryPackSchema>;

/** Versioned, data-driven rule pack (overrides the built-in defaults for a FY / region). */
export const createStatutoryRulePackSchema = z
  .object({
    pack: statutoryPackSchema,
    financialYear: financialYearSchema,
    /** `IN` for national packs, state code for PT / LWF. */
    region: z.string().trim().toUpperCase().min(2).max(8).default('IN'),
    config: z.record(z.unknown()),
    notes: optionalText(500),
  })
  .strict();
export type CreateStatutoryRulePackInput = z.input<typeof createStatutoryRulePackSchema>;

/* --------------------------------- Employee salary -------------------------------------- */

export const excludedComponentsSchema = z
  .array(payrollCodeSchema)
  .max(100)
  .transform((codes) => [...new Set(codes)]);

export const assignEmployeeSalarySchema = z
  .object({
    structureId: idSchema,
    effectiveFrom: isoDateSchema,
    annualCtc: positiveMoney,
    /**
     * Monthly amounts per component, e.g. `{ "BASIC": 30000 }`. Overrides the calc of a structure
     * component; a component that is not in the structure is added for this employee only.
     */
    amounts: z.record(payrollCodeSchema, positiveMoney).default({}),
    /** Component codes not applicable to this employee (e.g. `["PF_EE", "PF_ER"]`). */
    excludedComponents: excludedComponentsSchema.default([]),
    taxRegime: taxRegimeSchema.default('NEW'),
    reason: text(500).min(1).default('Salary assignment'),
  })
  .strict();
export type AssignEmployeeSalaryInput = z.input<typeof assignEmployeeSalarySchema>;

/** Salary revision (§16): approved via workflow `salary_revision`; back-dated → arrears. */
export const createSalaryRevisionRequestSchema = z
  .object({
    employeeId: idSchema,
    structureId: idSchema.nullish(),
    effectiveFrom: isoDateSchema,
    annualCtc: positiveMoney,
    amounts: z.record(payrollCodeSchema, positiveMoney).default({}),
    /** Omit / null to keep the current salary's excluded components. */
    excludedComponents: excludedComponentsSchema.nullish(),
    taxRegime: taxRegimeSchema.nullish(),
    reason: text(500).min(1),
  })
  .strict();
export type CreateSalaryRevisionRequestInput = z.input<typeof createSalaryRevisionRequestSchema>;

export const listRevisionsQuerySchema = paginationQuerySchema
  .extend({
    employeeId: idSchema.optional(),
    institutionId: idSchema.optional(),
    status: z.enum(['PENDING_APPROVAL', 'APPLIED', 'REJECTED', 'CANCELLED']).optional(),
  })
  .strict();

export const salaryPreviewSchema = z
  .object({
    employeeId: idSchema,
    periodStart: isoDateSchema,
    periodEnd: isoDateSchema,
    institutionId: idSchema.optional(),
  })
  .strict();
export type SalaryPreviewInput = z.infer<typeof salaryPreviewSchema>;

/* --------------------------------- Payroll runs ----------------------------------------- */

export const PAYROLL_RUN_STATUSES = [
  'DRAFT',
  'COMPUTING',
  'COMPUTED',
  'PENDING_APPROVAL',
  'APPROVED',
  'FINALIZED',
  'REOPENED',
  'CANCELLED',
] as const;
export const payrollRunStatusSchema = z.enum(PAYROLL_RUN_STATUSES);
export type PayrollRunStatus = z.infer<typeof payrollRunStatusSchema>;

const periodRefine = <T extends { periodStart: string; periodEnd: string }>(v: T) =>
  v.periodStart <= v.periodEnd && v.periodStart.slice(0, 7) === v.periodEnd.slice(0, 7);
const periodMessage = {
  message: 'periodEnd must be on/after periodStart and within the same month',
  path: ['periodEnd'],
};

export const createPayrollRunSchema = z
  .object({
    institutionId: idSchema,
    periodStart: isoDateSchema,
    periodEnd: isoDateSchema,
    label: optionalText(120),
  })
  .strict()
  .refine(periodRefine, periodMessage);
export type CreatePayrollRunInput = z.infer<typeof createPayrollRunSchema>;

/** Group-level batch (§53): one run per institution of the group, processed together. */
export const createPayrollBatchSchema = z
  .object({
    groupId: idSchema,
    periodStart: isoDateSchema,
    periodEnd: isoDateSchema,
    /** Subset of the group's institutions (default: all institutions the caller may process). */
    institutionIds: z.array(idSchema).max(200).optional(),
    label: optionalText(120),
  })
  .strict()
  .refine(periodRefine, periodMessage);
export type CreatePayrollBatchInput = z.infer<typeof createPayrollBatchSchema>;

export const listPayrollRunsQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    batchId: idSchema.optional(),
    status: payrollRunStatusSchema.optional(),
    periodStart: isoDateSchema.optional(),
  })
  .strict();
export type ListPayrollRunsQuery = z.infer<typeof listPayrollRunsQuerySchema>;

export const reopenPayrollRunSchema = z.object({ reason: text(500).min(5) }).strict();

export const PAYROLL_ADJUSTMENT_TYPES = [
  'EARNING',
  'DEDUCTION',
  'ARREAR',
  'LOAN_EMI',
  'REIMBURSEMENT',
  'ENCASHMENT',
] as const;
export const payrollAdjustmentTypeSchema = z.enum(PAYROLL_ADJUSTMENT_TYPES);
export type PayrollAdjustmentType = z.infer<typeof payrollAdjustmentTypeSchema>;

export const createPayrollAdjustmentSchema = z
  .object({
    employeeId: idSchema,
    type: z.enum(['EARNING', 'DEDUCTION', 'ARREAR', 'REIMBURSEMENT']),
    code: payrollCodeSchema.nullish(),
    amount: z.number().positive().max(100_000_000),
    taxable: z.boolean().default(true),
    description: text(300).min(1),
  })
  .strict();
export type CreatePayrollAdjustmentInput = z.input<typeof createPayrollAdjustmentSchema>;

export const markPaymentsPaidSchema = z
  .object({
    paymentIds: z.array(idSchema).max(5000).optional(),
    reference: text(120).min(1),
    paidOn: isoDateSchema.optional(),
  })
  .strict();

export const runItemsQuerySchema = z.object({ employeeId: idSchema.optional() }).strict();

/* --------------------------------- Loans & reimbursements ------------------------------- */

export const createLoanSchema = z
  .object({
    employeeId: idSchema,
    loanType: text(64).min(1).default('SALARY_ADVANCE'),
    principal: z.number().positive().max(100_000_000),
    emiAmount: z.number().positive().max(100_000_000),
    /** First month (any date in it) the EMI is deducted. */
    startMonth: isoDateSchema,
    reason: optionalText(500),
  })
  .strict();
export type CreateLoanInput = z.input<typeof createLoanSchema>;

export const listLoansQuerySchema = paginationQuerySchema
  .extend({
    employeeId: idSchema.optional(),
    status: z.enum(['ACTIVE', 'CLOSED', 'CANCELLED']).optional(),
  })
  .strict();

export const createReimbursementClaimSchema = z
  .object({
    category: text(64).min(1),
    amount: z.number().positive().max(10_000_000),
    claimDate: isoDateSchema,
    description: text(500).min(1),
    taxable: z.boolean().default(false),
  })
  .strict();
export type CreateReimbursementClaimInput = z.input<typeof createReimbursementClaimSchema>;

export const listReimbursementsQuerySchema = paginationQuerySchema
  .extend({
    employeeId: idSchema.optional(),
    status: z.enum(['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  })
  .strict();

/* --------------------------------- Payslips / Form 16 ----------------------------------- */

export const listPayslipsQuerySchema = paginationQuerySchema
  .extend({
    runId: idSchema.optional(),
    employeeId: idSchema.optional(),
    institutionId: idSchema.optional(),
  })
  .strict();

export const form16FieldsSchema = z
  .object({ employeeId: idSchema, financialYear: financialYearSchema })
  .strict();
export type Form16FieldsInput = z.infer<typeof form16FieldsSchema>;

export const salaryStatementQuerySchema = z.object({ fy: financialYearSchema.optional() }).strict();

export const listForm16QuerySchema = paginationQuerySchema
  .extend({
    employeeId: idSchema.optional(),
    financialYear: financialYearSchema.optional(),
  })
  .strict();

/* --------------------------------- Reports ---------------------------------------------- */

export const REPORT_FORMATS = ['json', 'csv', 'xlsx', 'pdf'] as const;
export const reportFormatSchema = z.enum(REPORT_FORMATS);
export type ReportFormat = z.infer<typeof reportFormatSchema>;

export const runReportQuerySchema = z
  .object({ format: reportFormatSchema.default('json') })
  .strict();

export const statutoryReportQuerySchema = z
  .object({
    runId: idSchema,
    pack: statutoryPackSchema,
    format: reportFormatSchema.default('json'),
  })
  .strict();

export const groupSummaryQuerySchema = z
  .object({
    periodStart: isoDateSchema,
    periodEnd: isoDateSchema,
    groupId: idSchema.optional(),
    /** Include runs that are not yet finalized (default: approved / finalized only). */
    includeUnapproved: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    format: reportFormatSchema.default('json'),
  })
  .strict();
export type GroupSummaryQuery = z.infer<typeof groupSummaryQuerySchema>;
