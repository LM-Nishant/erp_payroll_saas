import type {
  CalcTraceEntry,
  EmployeeSalaryDto,
  Form16RecordDto,
  LoanDto,
  PayrollAdjustmentDto,
  PayrollLineDto,
  PayrollPaymentDto,
  PayrollRunDto,
  PayrollRunEmployeeDto,
  PayslipDto,
  ReimbursementClaimDto,
  SalaryComponentDto,
  SalaryRevisionDto,
  SalaryRuleDto,
  SalaryStructureDto,
  SalaryStructureVersionDto,
  SlabRow,
  StructureLine,
} from '@erp/shared';
import type {
  EmployeeSalary,
  Form16Record,
  Loan,
  LoanInstallment,
  PayrollAdjustment,
  PayrollItem,
  PayrollPayment,
  PayrollRun,
  PayrollRunEmployee,
  Payslip,
  Prisma,
  ReimbursementClaim,
  SalaryComponent,
  SalaryRevision,
  SalaryRule,
  SalaryStructure,
  SalaryStructureVersion,
} from '@prisma/client';
import { dateStr } from '../employees/employees.mappers';

/* Prisma row → DTO mappers of the payroll module (Decimal → number, Date → ISO strings). */

export const num = (d: Prisma.Decimal | number | null | undefined): number =>
  d === null || d === undefined ? 0 : Number(d);
export const numOrNull = (d: Prisma.Decimal | number | null | undefined): number | null =>
  d === null || d === undefined ? null : Number(d);
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export const ORG_SCOPE = 'ORG';
export const scopeKeyOf = (institutionId: string | null | undefined) => institutionId ?? ORG_SCOPE;

export function toComponentDto(r: SalaryComponent): SalaryComponentDto {
  return {
    id: r.id,
    institutionId: r.institutionId,
    code: r.code,
    name: r.name,
    type: r.type as SalaryComponentDto['type'],
    calcType: r.calcType as SalaryComponentDto['calcType'],
    amount: numOrNull(r.amount),
    percentage: numOrNull(r.percentage),
    percentOf: r.percentOf,
    formula: r.formula,
    slabBasis: r.slabBasis,
    slabs: (r.slabs as SlabRow[] | null) ?? null,
    statutoryCode: r.statutoryCode as SalaryComponentDto['statutoryCode'],
    taxable: r.taxable,
    proRated: r.proRated,
    rounding: r.rounding as SalaryComponentDto['rounding'],
    roundingPrecision: r.roundingPrecision,
    displayOrder: r.displayOrder,
    showOnPayslip: r.showOnPayslip,
    description: r.description,
    status: r.status as SalaryComponentDto['status'],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toRuleDto(r: SalaryRule): SalaryRuleDto {
  return {
    id: r.id,
    institutionId: r.institutionId,
    componentCode: r.componentCode,
    effectiveFrom: dateStr(r.effectiveFrom),
    version: r.version,
    calcType: r.calcType as SalaryRuleDto['calcType'],
    amount: numOrNull(r.amount),
    percentage: numOrNull(r.percentage),
    percentOf: r.percentOf,
    formula: r.formula,
    slabBasis: r.slabBasis,
    slabs: (r.slabs as SlabRow[] | null) ?? null,
    condition: r.condition,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
  };
}

export function toStructureVersionDto(v: SalaryStructureVersion): SalaryStructureVersionDto {
  return {
    id: v.id,
    structureId: v.structureId,
    version: v.version,
    effectiveFrom: dateStr(v.effectiveFrom),
    lines: v.lines as StructureLine[],
    notes: v.notes,
    createdAt: v.createdAt.toISOString(),
  };
}

export function toStructureDto(
  s: SalaryStructure & { versions: SalaryStructureVersion[] },
): SalaryStructureDto {
  return {
    id: s.id,
    institutionId: s.institutionId,
    code: s.code,
    name: s.name,
    employmentType: s.employmentType as SalaryStructureDto['employmentType'],
    grade: s.grade,
    description: s.description,
    status: s.status as SalaryStructureDto['status'],
    versions: [...s.versions].sort((a, b) => b.version - a.version).map(toStructureVersionDto),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function toEmployeeSalaryDto(r: EmployeeSalary): EmployeeSalaryDto {
  return {
    id: r.id,
    employeeId: r.employeeId,
    institutionId: r.institutionId,
    structureId: r.structureId,
    salaryHistoryId: r.salaryHistoryId,
    effectiveFrom: dateStr(r.effectiveFrom),
    annualCtc: num(r.annualCtc),
    amounts: (r.amounts as Record<string, number>) ?? {},
    excludedComponents: (r.excludedComponents as string[] | null) ?? [],
    taxRegime: r.taxRegime as EmployeeSalaryDto['taxRegime'],
    createdAt: r.createdAt.toISOString(),
  };
}

export function toRevisionDto(
  r: SalaryRevision,
  employee?: { employeeCode: string; displayName: string } | null,
): SalaryRevisionDto {
  return {
    id: r.id,
    employeeId: r.employeeId,
    employeeCode: employee?.employeeCode ?? null,
    employeeName: employee?.displayName ?? null,
    institutionId: r.institutionId,
    structureId: r.structureId,
    effectiveFrom: dateStr(r.effectiveFrom),
    annualCtc: num(r.annualCtc),
    previousAnnualCtc: numOrNull(r.previousAnnualCtc),
    amounts: (r.amounts as Record<string, number>) ?? {},
    excludedComponents: (r.excludedComponents as string[] | null) ?? null,
    taxRegime: r.taxRegime as SalaryRevisionDto['taxRegime'],
    reason: r.reason,
    status: r.status as SalaryRevisionDto['status'],
    workflowInstanceId: r.workflowInstanceId,
    salaryHistoryId: r.salaryHistoryId,
    arrearsAmount: num(r.arrearsAmount),
    arrears: (r.arrears as SalaryRevisionDto['arrears'] | null) ?? [],
    decidedComment: r.decidedComment,
    createdAt: r.createdAt.toISOString(),
  };
}

export function toRunDto(r: PayrollRun, institutionName?: string | null): PayrollRunDto {
  return {
    id: r.id,
    institutionId: r.institutionId,
    institutionName: institutionName ?? null,
    groupId: r.groupId,
    batchId: r.batchId,
    periodStart: dateStr(r.periodStart),
    periodEnd: dateStr(r.periodEnd),
    label: r.label,
    status: r.status as PayrollRunDto['status'],
    revision: r.revision,
    previousRunId: r.previousRunId,
    attendanceLocked: r.attendanceLocked,
    employeeCount: r.employeeCount,
    errorCount: r.errorCount,
    grossTotal: num(r.grossTotal),
    deductionTotal: num(r.deductionTotal),
    netTotal: num(r.netTotal),
    employerTotal: num(r.employerTotal),
    workflowInstanceId: r.workflowInstanceId,
    computedAt: iso(r.computedAt),
    submittedAt: iso(r.submittedAt),
    approvedAt: iso(r.approvedAt),
    finalizedAt: iso(r.finalizedAt),
    reopenedAt: iso(r.reopenedAt),
    reopenReason: r.reopenReason,
    payslipsPublishedAt: iso(r.payslipsPublishedAt),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toLineDto(i: PayrollItem): PayrollLineDto {
  return {
    code: i.code,
    name: i.name,
    type: i.type as PayrollLineDto['type'],
    category: i.category as PayrollLineDto['category'],
    statutoryCode: i.statutoryCode as PayrollLineDto['statutoryCode'],
    amount: num(i.amount),
    fullAmount: num(i.fullAmount),
    taxable: i.taxable,
    showOnPayslip: i.showOnPayslip,
    displayOrder: i.displayOrder,
    explanation: i.explanation,
  };
}

export function toRunEmployeeDto(
  e: PayrollRunEmployee,
  items: PayrollItem[] = [],
  withTrace = false,
): PayrollRunEmployeeDto {
  return {
    id: e.id,
    runId: e.runId,
    employeeId: e.employeeId,
    employeeCode: e.employeeCode,
    employeeName: e.employeeName,
    institutionId: e.institutionId,
    departmentId: e.departmentId,
    status: e.status as PayrollRunEmployeeDto['status'],
    error: e.error,
    calendarDays: num(e.calendarDays),
    payableDays: num(e.payableDays),
    lopDays: num(e.lopDays),
    institutionDays: num(e.institutionDays),
    factor: num(e.factor),
    gross: num(e.gross),
    deductions: num(e.deductions),
    net: num(e.net),
    employerContributions: num(e.employerContributions),
    lines: items
      .sort((a, b) => a.displayOrder - b.displayOrder || a.code.localeCompare(b.code))
      .map(toLineDto),
    trace: withTrace ? ((e.trace as unknown as CalcTraceEntry[]) ?? []) : [],
    warnings: (e.warnings as string[]) ?? [],
  };
}

export function toAdjustmentDto(a: PayrollAdjustment): PayrollAdjustmentDto {
  return {
    id: a.id,
    runId: a.runId,
    employeeId: a.employeeId,
    institutionId: a.institutionId,
    type: a.type as PayrollAdjustmentDto['type'],
    code: a.code,
    amount: num(a.amount),
    taxable: a.taxable,
    description: a.description,
    source: a.source,
    sourceId: a.sourceId,
    status: a.status as PayrollAdjustmentDto['status'],
    createdAt: a.createdAt.toISOString(),
  };
}

export function toPaymentDto(p: PayrollPayment, employeeCode?: string | null): PayrollPaymentDto {
  return {
    id: p.id,
    runId: p.runId,
    employeeId: p.employeeId,
    employeeCode: employeeCode ?? null,
    amount: num(p.amount),
    method: p.method,
    status: p.status as PayrollPaymentDto['status'],
    bankAccountMasked: p.bankAccountMasked,
    reference: p.reference,
    paidAt: iso(p.paidAt),
  };
}

export function toPayslipDto(
  p: Payslip,
  employee?: { employeeCode: string; displayName: string } | null,
): PayslipDto {
  return {
    id: p.id,
    runId: p.runId,
    employeeId: p.employeeId,
    employeeCode: employee?.employeeCode ?? null,
    employeeName: employee?.displayName ?? null,
    institutionId: p.institutionId,
    periodStart: dateStr(p.periodStart),
    periodEnd: dateStr(p.periodEnd),
    revision: p.revision,
    documentId: p.documentId,
    net: num(p.net),
    status: p.status as PayslipDto['status'],
    publishedAt: p.publishedAt.toISOString(),
  };
}

export function toForm16Dto(
  r: Form16Record,
  employee?: { employeeCode: string } | null,
): Form16RecordDto {
  return {
    id: r.id,
    employeeId: r.employeeId,
    employeeCode: employee?.employeeCode ?? null,
    institutionId: r.institutionId,
    financialYear: r.financialYear,
    documentId: r.documentId,
    status: r.status as Form16RecordDto['status'],
    publishedAt: iso(r.publishedAt),
    createdAt: r.createdAt.toISOString(),
  };
}

export function toLoanDto(l: Loan & { installments: LoanInstallment[] }): LoanDto {
  return {
    id: l.id,
    employeeId: l.employeeId,
    institutionId: l.institutionId,
    loanType: l.loanType,
    principal: num(l.principal),
    emiAmount: num(l.emiAmount),
    outstanding: num(l.outstanding),
    startMonth: dateStr(l.startMonth),
    tenureMonths: l.tenureMonths,
    status: l.status as LoanDto['status'],
    reason: l.reason,
    installments: [...l.installments]
      .sort((a, b) => a.dueMonth.getTime() - b.dueMonth.getTime())
      .map((i) => ({
        id: i.id,
        dueMonth: dateStr(i.dueMonth),
        amount: num(i.amount),
        status: i.status as LoanDto['installments'][number]['status'],
        runId: i.runId,
      })),
    createdAt: l.createdAt.toISOString(),
  };
}

export function toClaimDto(c: ReimbursementClaim): ReimbursementClaimDto {
  return {
    id: c.id,
    employeeId: c.employeeId,
    institutionId: c.institutionId,
    category: c.category,
    amount: num(c.amount),
    claimDate: dateStr(c.claimDate),
    description: c.description,
    taxable: c.taxable,
    status: c.status as ReimbursementClaimDto['status'],
    workflowInstanceId: c.workflowInstanceId,
    adjustmentId: c.adjustmentId,
    decidedComment: c.decidedComment,
    createdAt: c.createdAt.toISOString(),
  };
}
