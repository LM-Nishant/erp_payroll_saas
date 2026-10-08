import type { AttendanceSummaryDto, PayrollComputationDto, TaxRegime } from '@erp/shared';
import { tenantDb } from '../../core/tenancy';
import { attendanceSummaryForPeriod } from '../attendance/attendance.summary';
import { round2, strToDate } from '../attendance/time';
import { employeeAssignmentAsOf } from '../employees/employees.assignment';
import { salaryAsOf } from '../employees/employees.salary';
import {
  PayrollEngineError,
  computePayroll,
  type EngineAdjustment,
  type EngineComponent,
  type EngineResult,
  type StatutoryContext,
} from './engine';
import { resolveComponents, statutoryContextFor, structureVersionAsOf } from './payroll.masters';

/*
 * Per-employee payroll computation shared by runs, previews and arrears. Attendance comes ONLY
 * from `attendanceSummaryForPeriod` (payable / LOP days, employed days for joiners / leavers and
 * `institutionDays` for mid-period transfers); salary from the immutable salary history
 * (`salaryAsOf`) + the payroll `employee_salaries` assignment (structure + tax regime).
 */

export interface SalarySnapshot {
  salaryHistoryId: string | null;
  structureId: string | null;
  annualCtc: number;
  amounts: Record<string, number>;
  excludedComponents: string[];
  taxRegime: TaxRegime;
}

/** Salary in force on `date`: history row + its payroll assignment (structure / regime). */
export async function salarySnapshot(
  employeeId: string,
  date: string,
): Promise<SalarySnapshot | null> {
  const history = await salaryAsOf(employeeId, date);
  if (!history) return null;
  const db = tenantDb();
  const assignment = await db.employeeSalary.findFirst({
    where: { salaryHistoryId: history.id },
  });
  let structureId = assignment?.structureId ?? null;
  if (!structureId && history.salaryStructureId) {
    const s = await db.salaryStructure.findFirst({
      where: { id: history.salaryStructureId },
      select: { id: true },
    });
    structureId = s?.id ?? null;
  }
  return {
    salaryHistoryId: history.id,
    structureId,
    annualCtc: history.annualCtc,
    amounts: history.amounts ?? {},
    excludedComponents: (assignment?.excludedComponents as string[] | null) ?? [],
    taxRegime: (assignment?.taxRegime as TaxRegime | undefined) ?? 'NEW',
  };
}

export interface AttendanceBasis {
  calendarDays: number;
  employedDays: number;
  payableDays: number;
  lopDays: number;
  presentDays: number;
  overtimeHours: number;
  /** Days attributed to this institution (mid-period transfer split). */
  institutionDays: number;
  locked: boolean;
  factor: number;
  warnings: string[];
}

/**
 * Pro-ration basis for one institution: factor = payableDays × institutionShare / calendarDays,
 * where institutionShare = institutionDays / Σ institutionDays. Joiners / leavers are pro-rated
 * because payable days only cover employed days. Not-yet-recorded (future) days count as payable.
 */
export function attendanceBasis(
  s: AttendanceSummaryDto,
  institutionId: string,
  assignedInstitutionAtEnd: string | null,
): AttendanceBasis {
  const warnings: string[] = [];
  const totalInst = s.institutionDays.reduce((a, d) => a + d.days, 0);
  const instDays = s.institutionDays.find((d) => d.institutionId === institutionId)?.days ?? 0;
  let share: number;
  let attributedDays: number;
  if (totalInst > 0) {
    // Days without a record yet (future) belong to the institution assigned at period end.
    const pending = assignedInstitutionAtEnd === institutionId ? s.pendingDays : 0;
    attributedDays = instDays + pending;
    share = attributedDays / (totalInst + s.pendingDays);
  } else {
    share = assignedInstitutionAtEnd === institutionId ? 1 : 0;
    attributedDays = share ? s.employedDays : 0;
  }
  let payable = s.payableDays;
  if (s.pendingDays > 0) {
    payable += s.pendingDays;
    warnings.push(`${s.pendingDays} day(s) have no attendance yet and were treated as payable`);
  }
  if (share < 1 && share > 0) {
    warnings.push(
      `Mid-period transfer: ${round2(share * 100)}% of the period attributed to this institution`,
    );
  }
  const calendar = s.calendarDays || 1;
  const factor = Math.max(0, Math.min(1, (payable * share) / calendar));
  return {
    calendarDays: s.calendarDays,
    employedDays: s.employedDays,
    payableDays: round2(payable * share),
    lopDays: round2(s.lopDays * share),
    presentDays: round2(s.presentDays * share),
    overtimeHours: round2(s.overtimeHours * share),
    institutionDays: attributedDays,
    locked: s.locked,
    factor: Math.round(factor * 1e6) / 1e6,
    warnings,
  };
}

/** Memo of components / statutory context shared by every employee of one compute pass. */
export class ComputeCache {
  private readonly components = new Map<string, Promise<EngineComponent[]>>();
  private readonly statutory = new Map<string, Promise<StatutoryContext>>();
  private readonly structures = new Map<string, Promise<{ code: string } | null>>();

  async componentsFor(
    institutionId: string,
    periodEnd: string,
    structureId: string | null,
  ): Promise<{ components: EngineComponent[]; structureVersionId: string | null }> {
    if (!structureId) {
      const key = `${institutionId}:none`;
      if (!this.components.has(key)) {
        this.components.set(key, resolveComponents(institutionId, strToDate(periodEnd)));
      }
      return { components: await this.components.get(key)!, structureVersionId: null };
    }
    if (!this.structures.has(structureId)) {
      this.structures.set(
        structureId,
        tenantDb().salaryStructure.findFirst({
          where: { id: structureId },
          select: { code: true },
        }),
      );
    }
    const structure = await this.structures.get(structureId);
    if (!structure) throw new PayrollEngineError('The assigned salary structure no longer exists');
    const version = await structureVersionAsOf(structureId, strToDate(periodEnd));
    if (!version) {
      throw new PayrollEngineError(
        `Salary structure ${structure.code} has no version effective on ${periodEnd}`,
      );
    }
    const key = `${institutionId}:${version.id}`;
    if (!this.components.has(key)) {
      this.components.set(
        key,
        resolveComponents(institutionId, strToDate(periodEnd), version, structure.code),
      );
    }
    return { components: await this.components.get(key)!, structureVersionId: version.id };
  }

  statutoryFor(institutionId: string, periodEnd: string, regime: TaxRegime) {
    const key = `${institutionId}:${periodEnd}:${regime}`;
    if (!this.statutory.has(key)) {
      this.statutory.set(key, statutoryContextFor(institutionId, periodEnd, regime));
    }
    return this.statutory.get(key)!;
  }
}

export interface EmployeeComputeInput {
  institutionId: string;
  periodStart: string;
  periodEnd: string;
  salary: SalarySnapshot;
  basis: AttendanceBasis;
  employmentType: string | null;
  adjustments: EngineAdjustment[];
  /** Leave encashment days (paid at BASIC full rate / 30 per day). */
  encashmentDays?: number;
}

export interface EmployeeComputeResult {
  result: EngineResult;
  structureVersionId: string | null;
  encashmentAmount: number;
}

export async function computeEmployee(
  input: EmployeeComputeInput,
  cache = new ComputeCache(),
): Promise<EmployeeComputeResult> {
  const resolved = await cache.componentsFor(
    input.institutionId,
    input.periodEnd,
    input.salary.structureId,
  );
  const { structureVersionId } = resolved;
  let components = resolved.components;
  // Employee-level extras: an amount for a component outside the structure adds that component.
  const present = new Set(components.map((c) => c.code));
  const extraCodes = Object.keys(input.salary.amounts).filter((code) => !present.has(code));
  if (extraCodes.length) {
    const all = (await cache.componentsFor(input.institutionId, input.periodEnd, null)).components;
    components = [...components, ...all.filter((c) => extraCodes.includes(c.code))];
  }
  const statutory = await cache.statutoryFor(
    input.institutionId,
    input.periodEnd,
    input.salary.taxRegime,
  );
  const encashmentDays = input.encashmentDays ?? 0;
  const run = (adjustments: EngineAdjustment[]) =>
    computePayroll({
      components,
      annualCtc: input.salary.annualCtc,
      amounts: input.salary.amounts,
      excludedComponents: input.salary.excludedComponents,
      attendance: {
        calendarDays: input.basis.calendarDays,
        employedDays: input.basis.employedDays,
        payableDays: input.basis.payableDays,
        lopDays: input.basis.lopDays,
        presentDays: input.basis.presentDays,
        overtimeHours: input.basis.overtimeHours,
        encashmentDays,
      },
      factor: input.basis.factor,
      employmentType: input.employmentType,
      statutory,
      adjustments,
    });
  let result = run(input.adjustments);
  let encashmentAmount = 0;
  if (encashmentDays > 0) {
    const basic = result.lines.find((l) => l.code === 'BASIC')?.fullAmount ?? result.fullGross;
    encashmentAmount = round2((encashmentDays * basic) / 30);
    if (encashmentAmount > 0) {
      result = run([
        ...input.adjustments,
        {
          type: 'ENCASHMENT',
          code: 'LEAVE_ENCASH',
          amount: encashmentAmount,
          taxable: true,
          description: `Leave encashment: ${encashmentDays} day(s) at BASIC / 30`,
        },
      ]);
    }
  }
  result.warnings.unshift(...input.basis.warnings);
  return { result, structureVersionId, encashmentAmount };
}

/** Leave encashment days posted (ENCASHMENT ledger rows) within the period. */
export async function encashmentDaysFor(
  employeeIds: string[],
  periodStart: string,
  periodEnd: string,
): Promise<Map<string, number>> {
  const rows = await tenantDb().leaveLedgerEntry.findMany({
    where: {
      employeeId: { in: employeeIds },
      entryType: 'ENCASHMENT',
      effectiveDate: { gte: strToDate(periodStart), lte: strToDate(periodEnd) },
    },
    select: { employeeId: true, days: true },
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    out.set(r.employeeId, round2((out.get(r.employeeId) ?? 0) + Math.abs(Number(r.days))));
  }
  return out;
}

/** Ad-hoc (non-persisted) computation for one employee — salary preview / what-if. */
export async function previewEmployee(
  employeeId: string,
  institutionId: string | undefined,
  periodStart: string,
  periodEnd: string,
  salaryOverride?: SalarySnapshot,
): Promise<PayrollComputationDto> {
  const [summary] = await attendanceSummaryForPeriod(employeeId, periodStart, periodEnd);
  const assignment = await employeeAssignmentAsOf(employeeId, periodEnd);
  const inst = institutionId ?? assignment?.institutionId;
  if (!summary || !inst) {
    throw new PayrollEngineError('The employee is not employed in this period');
  }
  const salary = salaryOverride ?? (await salarySnapshot(employeeId, periodEnd));
  if (!salary) throw new PayrollEngineError(`No salary is assigned as of ${periodEnd}`);
  const basis = attendanceBasis(summary, inst, assignment?.institutionId ?? null);
  const encash = await encashmentDaysFor([employeeId], periodStart, periodEnd);
  const { result, structureVersionId } = await computeEmployee({
    institutionId: inst,
    periodStart,
    periodEnd,
    salary,
    basis,
    employmentType: assignment?.employmentType ?? null,
    adjustments: [],
    encashmentDays: encash.get(employeeId) ?? 0,
  });
  return {
    employeeId,
    institutionId: inst,
    periodStart,
    periodEnd,
    salaryHistoryId: salary.salaryHistoryId,
    structureId: salary.structureId,
    structureVersionId,
    attendance: {
      calendarDays: basis.calendarDays,
      employedDays: basis.employedDays,
      payableDays: basis.payableDays,
      lopDays: basis.lopDays,
      institutionDays: basis.institutionDays,
      overtimeHours: basis.overtimeHours,
      locked: basis.locked,
    },
    factor: basis.factor,
    lines: result.lines,
    gross: result.gross,
    deductions: result.deductions,
    net: result.net,
    employerContributions: result.employerContributions,
    taxableEarnings: result.taxableEarnings,
    trace: result.trace,
    warnings: result.warnings,
  };
}
