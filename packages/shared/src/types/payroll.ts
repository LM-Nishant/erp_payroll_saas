import type {
  PayrollAdjustmentType,
  PayrollRunStatus,
  RoundingMode,
  SalaryCalcType,
  SalaryComponentType,
  SlabRow,
  StatutoryCode,
  StatutoryPack,
  StructureLine,
  TaxRegime,
} from '../schemas/payroll';
import type { EmploymentType } from '../schemas/hr';

/* Payroll rule engine DTOs (Layer 8). */

export interface SalaryComponentDto {
  id: string;
  institutionId: string | null;
  code: string;
  name: string;
  type: SalaryComponentType;
  calcType: SalaryCalcType;
  amount: number | null;
  percentage: number | null;
  percentOf: string | null;
  formula: string | null;
  slabBasis: string | null;
  slabs: SlabRow[] | null;
  statutoryCode: StatutoryCode | null;
  taxable: boolean;
  proRated: boolean;
  rounding: RoundingMode;
  roundingPrecision: number;
  displayOrder: number;
  showOnPayslip: boolean;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface SalaryRuleDto {
  id: string;
  institutionId: string | null;
  componentCode: string;
  effectiveFrom: string;
  version: number;
  calcType: SalaryCalcType;
  amount: number | null;
  percentage: number | null;
  percentOf: string | null;
  formula: string | null;
  slabBasis: string | null;
  slabs: SlabRow[] | null;
  condition: string | null;
  notes: string | null;
  createdAt: string;
}

export interface SalaryStructureVersionDto {
  id: string;
  structureId: string;
  version: number;
  effectiveFrom: string;
  lines: StructureLine[];
  notes: string | null;
  createdAt: string;
}

export interface SalaryStructureDto {
  id: string;
  institutionId: string;
  code: string;
  name: string;
  employmentType: EmploymentType | null;
  grade: string | null;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  versions: SalaryStructureVersionDto[];
  createdAt: string;
  updatedAt: string;
}

export interface PayrollSettingsDto {
  id: string | null;
  institutionId: string;
  state: string | null;
  pfEnabled: boolean;
  esiEnabled: boolean;
  ptEnabled: boolean;
  tdsEnabled: boolean;
  lwfEnabled: boolean;
  requireAttendanceLock: boolean;
  payDay: number | null;
}

export interface StatutoryRulePackDto {
  id: string | null;
  pack: StatutoryPack;
  financialYear: string;
  region: string;
  version: number;
  config: Record<string, unknown>;
  source: 'builtin' | 'custom';
  notes: string | null;
}

export interface EmployeeSalaryDto {
  id: string;
  employeeId: string;
  institutionId: string;
  structureId: string;
  salaryHistoryId: string;
  effectiveFrom: string;
  annualCtc: number;
  amounts: Record<string, number>;
  taxRegime: TaxRegime;
  createdAt: string;
}

export interface SalaryRevisionDto {
  id: string;
  employeeId: string;
  employeeCode: string | null;
  employeeName: string | null;
  institutionId: string;
  structureId: string | null;
  effectiveFrom: string;
  annualCtc: number;
  previousAnnualCtc: number | null;
  amounts: Record<string, number>;
  taxRegime: TaxRegime | null;
  reason: string;
  status: 'PENDING_APPROVAL' | 'APPLIED' | 'REJECTED' | 'CANCELLED';
  workflowInstanceId: string | null;
  salaryHistoryId: string | null;
  arrearsAmount: number;
  arrears: Array<{ runId: string; periodStart: string; periodEnd: string; amount: number }>;
  decidedComment: string | null;
  createdAt: string;
}

/** One step of the calculation trace (explains how an amount was derived). */
export interface CalcTraceEntry {
  code: string;
  name: string;
  type: SalaryComponentType | 'ADJUSTMENT';
  source: string;
  expression: string;
  inputs: Record<string, number | string | boolean>;
  rate: number;
  factor: number;
  amount: number;
  note?: string;
}

export interface PayrollLineDto {
  code: string;
  name: string;
  type: SalaryComponentType | 'ADJUSTMENT';
  category: 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIBUTION' | 'REIMBURSEMENT';
  statutoryCode: StatutoryCode | null;
  amount: number;
  fullAmount: number;
  taxable: boolean;
  showOnPayslip: boolean;
  displayOrder: number;
  explanation: string;
}

export interface PayrollComputationDto {
  employeeId: string;
  institutionId: string;
  periodStart: string;
  periodEnd: string;
  salaryHistoryId: string | null;
  structureId: string | null;
  structureVersionId: string | null;
  attendance: {
    calendarDays: number;
    employedDays: number;
    payableDays: number;
    lopDays: number;
    institutionDays: number;
    overtimeHours: number;
    locked: boolean;
  };
  factor: number;
  lines: PayrollLineDto[];
  gross: number;
  deductions: number;
  net: number;
  employerContributions: number;
  taxableEarnings: number;
  trace: CalcTraceEntry[];
  warnings: string[];
}

export interface PayrollRunDto {
  id: string;
  institutionId: string;
  institutionName: string | null;
  groupId: string | null;
  batchId: string | null;
  periodStart: string;
  periodEnd: string;
  label: string;
  status: PayrollRunStatus;
  revision: number;
  previousRunId: string | null;
  attendanceLocked: boolean;
  employeeCount: number;
  errorCount: number;
  grossTotal: number;
  deductionTotal: number;
  netTotal: number;
  employerTotal: number;
  workflowInstanceId: string | null;
  computedAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  finalizedAt: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  payslipsPublishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollRunEmployeeDto {
  id: string;
  runId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  institutionId: string;
  departmentId: string | null;
  status: 'OK' | 'ERROR' | 'SKIPPED';
  error: string | null;
  calendarDays: number;
  payableDays: number;
  lopDays: number;
  institutionDays: number;
  factor: number;
  gross: number;
  deductions: number;
  net: number;
  employerContributions: number;
  lines: PayrollLineDto[];
  trace: CalcTraceEntry[];
  warnings: string[];
}

export interface PayrollAdjustmentDto {
  id: string;
  runId: string | null;
  employeeId: string;
  institutionId: string;
  type: PayrollAdjustmentType;
  code: string;
  amount: number;
  taxable: boolean;
  description: string;
  source: string;
  sourceId: string | null;
  status: 'PENDING' | 'APPLIED' | 'CANCELLED';
  createdAt: string;
}

export interface PayrollBatchDto {
  id: string;
  groupId: string;
  periodStart: string;
  periodEnd: string;
  label: string;
  runs: PayrollRunDto[];
  createdAt: string;
}

export interface PayrollPaymentDto {
  id: string;
  runId: string;
  employeeId: string;
  employeeCode: string | null;
  amount: number;
  method: string;
  status: 'PENDING' | 'EXPORTED' | 'PAID' | 'FAILED' | 'CANCELLED';
  bankAccountMasked: string | null;
  reference: string | null;
  paidAt: string | null;
}

export interface PayslipDto {
  id: string;
  runId: string;
  employeeId: string;
  employeeCode: string | null;
  employeeName: string | null;
  institutionId: string;
  periodStart: string;
  periodEnd: string;
  revision: number;
  documentId: string | null;
  net: number;
  status: 'PUBLISHED' | 'SUPERSEDED';
  publishedAt: string;
}

export interface Form16RecordDto {
  id: string;
  employeeId: string;
  employeeCode: string | null;
  institutionId: string;
  financialYear: string;
  documentId: string;
  status: 'DRAFT' | 'PUBLISHED';
  publishedAt: string | null;
  createdAt: string;
}

export interface LoanDto {
  id: string;
  employeeId: string;
  institutionId: string;
  loanType: string;
  principal: number;
  emiAmount: number;
  outstanding: number;
  startMonth: string;
  tenureMonths: number;
  status: 'ACTIVE' | 'CLOSED' | 'CANCELLED';
  reason: string | null;
  installments: Array<{
    id: string;
    dueMonth: string;
    amount: number;
    status: 'DUE' | 'DEDUCTED' | 'SKIPPED';
    runId: string | null;
  }>;
  createdAt: string;
}

export interface ReimbursementClaimDto {
  id: string;
  employeeId: string;
  institutionId: string;
  category: string;
  amount: number;
  claimDate: string;
  description: string;
  taxable: boolean;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  workflowInstanceId: string | null;
  adjustmentId: string | null;
  decidedComment: string | null;
  createdAt: string;
}

export interface PayrollRegisterDto {
  run: PayrollRunDto;
  columns: Array<{ code: string; name: string; category: string }>;
  rows: Array<{
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    payableDays: number;
    lopDays: number;
    amounts: Record<string, number>;
    gross: number;
    deductions: number;
    net: number;
  }>;
  totals: Record<string, number>;
}

export interface GroupPayrollSummaryDto {
  periodStart: string;
  periodEnd: string;
  institutions: Array<{
    institutionId: string;
    institutionName: string;
    runIds: string[];
    status: string;
    employeeCount: number;
    grossTotal: number;
    deductionTotal: number;
    netTotal: number;
    employerTotal: number;
  }>;
  totals: {
    employeeCount: number;
    grossTotal: number;
    deductionTotal: number;
    netTotal: number;
    employerTotal: number;
  };
}

/* ---------------------------- Employee self-service: my salary ---------------------------- */

export interface MySalaryComponentDto {
  code: string;
  name: string;
  category: PayrollLineDto['category'];
  monthly: number;
  annual: number;
}

export interface MySalaryRevisionDto {
  effectiveFrom: string;
  annualCtc: number;
  reason: string;
}

export interface MySalaryDto {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  designation: string | null;
  department: string | null;
  institution: string | null;
  dateOfJoining: string | null;
  effectiveFrom: string;
  structureName: string | null;
  taxRegime: TaxRegime;
  annualCtc: number;
  monthlyCtc: number;
  earnings: MySalaryComponentDto[];
  deductions: MySalaryComponentDto[];
  employerContributions: MySalaryComponentDto[];
  grossMonthly: number;
  deductionsMonthly: number;
  netMonthly: number;
  employerMonthly: number;
  revisions: MySalaryRevisionDto[];
  warnings: string[];
}

export interface SalaryStatementMonthDto {
  month: string;
  label: string;
  payableDays: number;
  lopDays: number;
  gross: number;
  deductions: number;
  net: number;
  tds: number;
}

export interface SalaryStatementRowDto {
  code: string;
  name: string;
  category: PayrollLineDto['category'];
  amounts: Record<string, number>;
  total: number;
}

export interface SalaryStatementDto {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  financialYear: string;
  months: SalaryStatementMonthDto[];
  rows: SalaryStatementRowDto[];
  totals: { gross: number; deductions: number; net: number; tds: number; employer: number };
  availableYears: string[];
}
