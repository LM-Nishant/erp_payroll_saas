import type {
  MySalaryComponentDto,
  MySalaryDto,
  PayrollLineDto,
  SalaryStatementDto,
  SalaryStatementMonthDto,
  SalaryStatementRowDto,
} from '@erp/shared';
import { currentPrincipal, hasPermission } from '../../core/authz';
import { AppError, NotFoundError } from '../../core/http/errors';
import { tenantDb } from '../../core/tenancy';
import { round2 } from '../attendance/time';
import { employeeAssignmentAsOf, employeeIdsForUser } from '../employees/employees.assignment';
import { dateStr } from '../employees/employees.mappers';
import { PayrollEngineError } from './engine';
import { computeEmployee, salarySnapshot } from './payroll.compute';
import { num } from './payroll.mappers';

/*
 * Employee self-service "My salary": the salary structure in force today (monthly + annual per
 * component, computed by the payroll engine for a full month) and the financial-year statement
 * built from the employee's own PUBLISHED payslips. Only the caller's own employee records are
 * ever read; without payroll.view_own the endpoints answer 404.
 */

const db = () => tenantDb();

/** Indian financial year (April–March) of a YYYY-MM-DD date, e.g. 2026-09-15 → "2026-27". */
export function financialYearOf(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** First / last day of a "YYYY-YY" financial year. */
export function financialYearRange(fy: string): { from: string; to: string } {
  const start = Number(fy.slice(0, 4));
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

/** Months of a financial year in order (YYYY-MM). */
export function financialYearMonths(fy: string): string[] {
  const start = Number(fy.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((i + 3) % 12) + 1;
    const y = i < 9 ? start : start + 1;
    return `${y}-${String(m).padStart(2, '0')}`;
  });
}

const monthLabel = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

export function componentsByCategory(lines: PayrollLineDto[]) {
  const pick = (cat: PayrollLineDto['category']): MySalaryComponentDto[] =>
    lines
      .filter((l) => l.category === cat && l.amount !== 0)
      .sort((a, b) => a.displayOrder - b.displayOrder || a.code.localeCompare(b.code))
      .map((l) => ({
        code: l.code,
        name: l.name,
        category: l.category,
        monthly: round2(l.amount),
        annual: round2(l.amount * 12),
      }));
  return {
    earnings: [...pick('EARNING'), ...pick('REIMBURSEMENT')],
    deductions: pick('DEDUCTION'),
    employerContributions: pick('EMPLOYER_CONTRIBUTION'),
  };
}

async function myEmployee() {
  const principal = currentPrincipal();
  if (!principal.userId || !hasPermission(principal, 'payroll.view_own')) {
    throw new NotFoundError('Employee');
  }
  const ids = await employeeIdsForUser(principal.userId);
  if (!ids.length) throw new NotFoundError('Employee');
  const rows = await db().employee.findMany({ where: { id: { in: ids } } });
  // Prefer an active record when the user has several (rehire / multiple institutions).
  const employee = rows.find((e) => e.status === 'ACTIVE') ?? rows[0];
  if (!employee) throw new NotFoundError('Employee');
  return employee;
}

const nameOf = async (
  model: 'designation' | 'department' | 'institution',
  id: string | null | undefined,
): Promise<string | null> => {
  if (!id) return null;
  const where = { where: { id }, select: { name: true } };
  const row =
    model === 'designation'
      ? await db().designation.findFirst(where)
      : model === 'department'
        ? await db().department.findFirst(where)
        : await db().institution.findFirst(where);
  return row?.name ?? null;
};

export const selfSalaryService = {
  async mySalary(today = dateStr(new Date())): Promise<MySalaryDto> {
    const employee = await myEmployee();
    const salary = await salarySnapshot(employee.id, today);
    if (!salary) throw new NotFoundError('Salary');
    const assignment = await employeeAssignmentAsOf(employee.id, today);
    const institutionId = assignment?.institutionId ?? employee.institutionId;
    const ym = today.slice(0, 7);
    const periodStart = `${ym}-01`;
    const end = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0));
    const periodEnd = dateStr(end);
    const days = end.getUTCDate();
    let lines: PayrollLineDto[];
    let warnings: string[] = [];
    try {
      const { result } = await computeEmployee({
        institutionId,
        periodStart,
        periodEnd,
        salary,
        basis: {
          calendarDays: days,
          employedDays: days,
          payableDays: days,
          lopDays: 0,
          presentDays: days,
          overtimeHours: 0,
          institutionDays: days,
          locked: false,
          factor: 1,
          warnings: [],
        },
        employmentType: assignment?.employmentType ?? null,
        adjustments: [],
      });
      lines = result.lines;
      warnings = result.warnings;
    } catch (e) {
      if (e instanceof PayrollEngineError) {
        throw new AppError(422, 'PAYROLL_COMPUTE_FAILED', e.message);
      }
      throw e;
    }
    const groups = componentsByCategory(lines);
    const sum = (xs: MySalaryComponentDto[]) => round2(xs.reduce((a, x) => a + x.monthly, 0));
    const grossMonthly = sum(groups.earnings);
    const deductionsMonthly = sum(groups.deductions);
    const [structure, history, designation, department, institution] = await Promise.all([
      salary.structureId
        ? db().salaryStructure.findFirst({
            where: { id: salary.structureId },
            select: { name: true },
          })
        : null,
      db().employeeSalaryHistory.findMany({
        where: { employeeId: employee.id },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      }),
      nameOf('designation', assignment?.designationId ?? employee.designationId),
      nameOf('department', assignment?.departmentId ?? employee.departmentId),
      nameOf('institution', institutionId),
    ]);
    const current = history.find((h) => h.id === salary.salaryHistoryId);
    return {
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      employeeName: employee.displayName,
      designation,
      department,
      institution,
      dateOfJoining: employee.dateOfJoining ? dateStr(employee.dateOfJoining) : null,
      effectiveFrom: current ? dateStr(current.effectiveFrom) : today,
      structureName: structure?.name ?? null,
      taxRegime: salary.taxRegime,
      annualCtc: round2(salary.annualCtc),
      monthlyCtc: round2(salary.annualCtc / 12),
      ...groups,
      grossMonthly,
      deductionsMonthly,
      netMonthly: round2(grossMonthly - deductionsMonthly),
      employerMonthly: sum(groups.employerContributions),
      revisions: history.map((h) => ({
        effectiveFrom: dateStr(h.effectiveFrom),
        annualCtc: num(h.annualCtc),
        reason: h.revisionReason,
      })),
      warnings,
    };
  },

  async statement(fy?: string, today = dateStr(new Date())): Promise<SalaryStatementDto> {
    const employee = await myEmployee();
    const year = fy ?? financialYearOf(today);
    const { from, to } = financialYearRange(year);
    const allSlips = await db().payslip.findMany({
      where: { employeeId: employee.id, status: 'PUBLISHED' },
      orderBy: [{ periodStart: 'asc' }, { revision: 'desc' }],
    });
    const availableYears = [
      ...new Set([
        financialYearOf(today),
        ...allSlips.map((s) => financialYearOf(dateStr(s.periodStart))),
      ]),
    ].sort((a, b) => b.localeCompare(a));
    // One payslip per month: the highest revision wins.
    const byMonth = new Map<string, (typeof allSlips)[number]>();
    for (const s of allSlips) {
      const d = dateStr(s.periodStart);
      if (d < from || d > to) continue;
      const ym = d.slice(0, 7);
      if (!byMonth.has(ym)) byMonth.set(ym, s);
    }
    const runEmployees = byMonth.size
      ? await db().payrollRunEmployee.findMany({
          where: {
            employeeId: employee.id,
            runId: { in: [...byMonth.values()].map((s) => s.runId) },
          },
        })
      : [];
    const reByRun = new Map(runEmployees.map((r) => [r.runId, r]));
    const items = runEmployees.length
      ? await db().payrollItem.findMany({
          where: { runEmployeeId: { in: runEmployees.map((r) => r.id) } },
          orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
        })
      : [];
    const months: SalaryStatementMonthDto[] = [];
    const rows = new Map<string, SalaryStatementRowDto>();
    for (const ym of financialYearMonths(year)) {
      const slip = byMonth.get(ym);
      const re = slip ? reByRun.get(slip.runId) : undefined;
      if (!re) continue;
      const own = items.filter((i) => i.runEmployeeId === re.id);
      let tds = 0;
      for (const i of own) {
        const amount = num(i.amount);
        if (amount === 0) continue;
        if (i.statutoryCode === 'TDS') tds += amount;
        const key = `${i.category}:${i.code}`;
        const row = rows.get(key) ?? {
          code: i.code,
          name: i.name,
          category: i.category as PayrollLineDto['category'],
          amounts: {},
          total: 0,
        };
        row.amounts[ym] = round2((row.amounts[ym] ?? 0) + amount);
        row.total = round2(row.total + amount);
        rows.set(key, row);
      }
      months.push({
        month: ym,
        label: monthLabel(ym),
        payableDays: num(re.payableDays),
        lopDays: num(re.lopDays),
        gross: num(re.gross),
        deductions: num(re.deductions),
        net: num(re.net),
        tds: round2(tds),
      });
    }
    const total = (k: 'gross' | 'deductions' | 'net' | 'tds') =>
      round2(months.reduce((a, m) => a + m[k], 0));
    const order = ['EARNING', 'REIMBURSEMENT', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION'];
    return {
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      employeeName: employee.displayName,
      financialYear: year,
      months,
      rows: [...rows.values()].sort(
        (a, b) => order.indexOf(a.category) - order.indexOf(b.category),
      ),
      totals: {
        gross: total('gross'),
        deductions: total('deductions'),
        net: total('net'),
        tds: total('tds'),
        employer: round2(
          [...rows.values()]
            .filter((r) => r.category === 'EMPLOYER_CONTRIBUTION')
            .reduce((a, r) => a + r.total, 0),
        ),
      },
      availableYears,
    };
  },
};
