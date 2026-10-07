import type {
  GroupPayrollSummaryDto,
  GroupSummaryQuery,
  PayrollRegisterDto,
  ReportFormat,
  StatutoryPack,
} from '@erp/shared';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { audit } from '../../core/audit';
import { AppError } from '../../core/http/errors';
import { registerPdfTemplate, renderPdfTemplate } from '../../core/pdf';
import { tenantDb } from '../../core/tenancy';
import { strToDate } from '../attendance/time';
import { dateStr } from '../employees/employees.mappers';
import { CLOSED_RUN_STATUSES } from './payroll.constants';
import { institutionFilter, institutionIdsFor, loadInstitution } from './payroll.access';
import { num, toRunDto } from './payroll.mappers';
import { loadRun } from './payroll.runs';

/*
 * Payroll reports: run register, component summary, statutory summaries (PF / ESI / PT / TDS /
 * LWF) and the group-level consolidated summary (§53). Every report is available as JSON or
 * exported as CSV, Excel (exceljs) or a branded PDF table.
 */

const db = () => tenantDb();

export interface ReportFile {
  fileName: string;
  contentType: string;
  body: Buffer;
}

export interface TabularReport {
  title: string;
  subtitle?: string;
  columns: string[];
  rows: Array<Array<string | number>>;
}

const REPORT_TEMPLATE = 'payroll_report';

registerPdfTemplate({
  key: REPORT_TEMPLATE,
  version: 1,
  name: 'Payroll report',
  description: 'Tabular payroll report (register, component / statutory / group summaries).',
  inputSchema: z
    .object({
      title: z.string(),
      subtitle: z.string().optional(),
      columns: z.array(z.string()),
      rows: z.array(z.array(z.string())),
    })
    .strict(),
  defaultCategory: 'payroll',
  defaultDocumentType: 'payroll_report',
  title: (i) => i.title,
  build: (i) => [
    { type: 'heading', level: 1, text: i.title },
    ...(i.subtitle ? [{ type: 'paragraph' as const, text: i.subtitle }] : []),
    { type: 'table', columns: i.columns, rows: i.rows },
  ],
});

/* --------------------------------- Exporters -------------------------------------------- */

const csvCell = (v: string | number) => {
  const s = typeof v === 'number' ? v.toFixed(2) : v;
  // Neutralise spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v !== 'number' ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(report: TabularReport): string {
  return (
    [report.columns, ...report.rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
  );
}

export async function toXlsx(report: TabularReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ERP Payroll';
  const ws = wb.addWorksheet(report.title.slice(0, 31).replace(/[\\/*?:[\]]/g, '-'));
  ws.addRow([report.title]).font = { bold: true, size: 13 };
  if (report.subtitle) ws.addRow([report.subtitle]);
  ws.addRow([]);
  ws.addRow(report.columns).font = { bold: true };
  for (const row of report.rows) {
    const r = ws.addRow(row);
    row.forEach((v, i) => {
      if (typeof v === 'number') r.getCell(i + 1).numFmt = '#,##0.00';
    });
  }
  ws.columns.forEach((c) => {
    c.width = 16;
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'report';

export async function exportReport(
  report: TabularReport,
  format: Exclude<ReportFormat, 'json'>,
  scope: { groupId: string | null; institutionId: string | null },
): Promise<ReportFile> {
  const base = slug(report.title);
  if (format === 'csv') {
    return {
      fileName: `${base}.csv`,
      contentType: 'text/csv; charset=utf-8',
      body: Buffer.from(toCsv(report), 'utf8'),
    };
  }
  if (format === 'xlsx') {
    return {
      fileName: `${base}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: await toXlsx(report),
    };
  }
  const rendered = await renderPdfTemplate(
    REPORT_TEMPLATE,
    {
      title: report.title,
      ...(report.subtitle ? { subtitle: report.subtitle } : {}),
      columns: report.columns,
      rows: report.rows.map((r) => r.map((v) => (typeof v === 'number' ? v.toFixed(2) : v))),
    },
    { ...scope, campusId: null, departmentId: null },
  );
  return { fileName: `${base}.pdf`, contentType: 'application/pdf', body: rendered.body };
}

/* --------------------------------- Reports ---------------------------------------------- */

async function reportRun(runId: string) {
  const run = await loadRun(runId, 'payroll.report');
  const inst = await loadInstitution(run.institutionId);
  return { run, inst };
}

const periodText = (start: Date, end: Date) => `${dateStr(start)} to ${dateStr(end)}`;

const CATEGORY_ORDER: Record<string, number> = {
  EARNING: 0,
  REIMBURSEMENT: 1,
  DEDUCTION: 2,
  EMPLOYER_CONTRIBUTION: 3,
};

async function recordExport(kind: string, entityId: string, format: ReportFormat) {
  if (format === 'json') return;
  await audit.record({
    action: 'payroll.report.export',
    entityType: 'payroll_report',
    entityId,
    after: { kind, format },
  });
}

export const reportService = {
  /** Payroll register: one row per employee, one column per component. */
  async register(runId: string): Promise<PayrollRegisterDto> {
    const { run, inst } = await reportRun(runId);
    const [employees, items] = await Promise.all([
      db().payrollRunEmployee.findMany({
        where: { runId, status: 'OK' },
        orderBy: { employeeCode: 'asc' },
      }),
      db().payrollItem.findMany({ where: { runId } }),
    ]);
    const columnMap = new Map<
      string,
      { code: string; name: string; category: string; order: number }
    >();
    for (const i of items) {
      if (!columnMap.has(i.code)) {
        columnMap.set(i.code, {
          code: i.code,
          name: i.name,
          category: i.category,
          order: i.displayOrder,
        });
      }
    }
    const columns = [...columnMap.values()]
      .sort(
        (a, b) =>
          (CATEGORY_ORDER[a.category] ?? 9) - (CATEGORY_ORDER[b.category] ?? 9) ||
          a.order - b.order ||
          a.code.localeCompare(b.code),
      )
      .map(({ code, name, category }) => ({ code, name, category }));
    const totals: Record<string, number> = { gross: 0, deductions: 0, net: 0 };
    const rows = employees.map((e) => {
      const amounts: Record<string, number> = {};
      for (const i of items) {
        if (i.runEmployeeId !== e.id) continue;
        amounts[i.code] = Math.round(((amounts[i.code] ?? 0) + num(i.amount)) * 100) / 100;
      }
      for (const [code, v] of Object.entries(amounts)) {
        totals[code] = Math.round(((totals[code] ?? 0) + v) * 100) / 100;
      }
      totals.gross = Math.round((totals.gross! + num(e.gross)) * 100) / 100;
      totals.deductions = Math.round((totals.deductions! + num(e.deductions)) * 100) / 100;
      totals.net = Math.round((totals.net! + num(e.net)) * 100) / 100;
      return {
        employeeId: e.employeeId,
        employeeCode: e.employeeCode,
        employeeName: e.employeeName,
        payableDays: num(e.payableDays),
        lopDays: num(e.lopDays),
        amounts,
        gross: num(e.gross),
        deductions: num(e.deductions),
        net: num(e.net),
      };
    });
    return { run: toRunDto(run, inst.name), columns, rows, totals };
  },

  registerTable(reg: PayrollRegisterDto): TabularReport {
    return {
      title: `Payroll register - ${reg.run.label}`,
      subtitle: `${reg.run.institutionName ?? ''} | ${reg.run.periodStart} to ${reg.run.periodEnd} | revision ${reg.run.revision} | ${reg.run.status}`,
      columns: [
        'Code',
        'Employee',
        'Payable days',
        'LOP days',
        ...reg.columns.map((c) => c.code),
        'Gross',
        'Deductions',
        'Net',
      ],
      rows: [
        ...reg.rows.map((r) => [
          r.employeeCode,
          r.employeeName,
          r.payableDays,
          r.lopDays,
          ...reg.columns.map((c) => r.amounts[c.code] ?? 0),
          r.gross,
          r.deductions,
          r.net,
        ]),
        [
          'TOTAL',
          '',
          '',
          '',
          ...reg.columns.map((c) => reg.totals[c.code] ?? 0),
          reg.totals.gross ?? 0,
          reg.totals.deductions ?? 0,
          reg.totals.net ?? 0,
        ],
      ],
    };
  },

  /** Totals per component for a run. */
  async componentSummary(runId: string) {
    const { run, inst } = await reportRun(runId);
    const items = await db().payrollItem.findMany({ where: { runId } });
    interface SummaryRow {
      code: string;
      name: string;
      category: string;
      employees: Set<string>;
      total: number;
      order: number;
    }
    const map = new Map<string, SummaryRow>();
    for (const i of items) {
      const row: SummaryRow = map.get(i.code) ?? {
        code: i.code,
        name: i.name,
        category: i.category,
        employees: new Set<string>(),
        total: 0,
        order: i.displayOrder,
      };
      row.employees.add(i.employeeId);
      row.total = Math.round((row.total + num(i.amount)) * 100) / 100;
      map.set(i.code, row);
    }
    const rows = [...map.values()]
      .sort(
        (a, b) =>
          (CATEGORY_ORDER[a.category] ?? 9) - (CATEGORY_ORDER[b.category] ?? 9) ||
          a.order - b.order,
      )
      .map((r) => ({
        code: r.code,
        name: r.name,
        category: r.category,
        employeeCount: r.employees.size,
        total: r.total,
      }));
    const table: TabularReport = {
      title: `Component summary - ${run.label}`,
      subtitle: `${inst.name} | ${periodText(run.periodStart, run.periodEnd)}`,
      columns: ['Code', 'Component', 'Category', 'Employees', 'Total'],
      rows: rows.map((r) => [r.code, r.name, r.category, String(r.employeeCount), r.total]),
    };
    return { run: toRunDto(run, inst.name), rows, table, scope: inst };
  },

  /** Statutory summary for one pack (employee + employer shares per employee). */
  async statutory(runId: string, pack: StatutoryPack) {
    const { run, inst } = await reportRun(runId);
    const codes = {
      PF: ['PF_EE', 'PF_ER'],
      ESI: ['ESI_EE', 'ESI_ER'],
      PT: ['PT'],
      TDS: ['TDS'],
      LWF: ['LWF_EE', 'LWF_ER'],
    }[pack];
    const [employees, items] = await Promise.all([
      db().payrollRunEmployee.findMany({
        where: { runId, status: 'OK' },
        orderBy: { employeeCode: 'asc' },
      }),
      db().payrollItem.findMany({ where: { runId, statutoryCode: { in: codes } } }),
    ]);
    const basisCode = pack === 'PF' ? 'BASIC' : null;
    const basicItems = basisCode
      ? await db().payrollItem.findMany({ where: { runId, code: basisCode } })
      : [];
    const rows = employees
      .map((e) => {
        const mine = items.filter((i) => i.runEmployeeId === e.id);
        const employee = mine
          .filter((i) => i.category === 'DEDUCTION')
          .reduce((s, i) => s + num(i.amount), 0);
        const employer = mine
          .filter((i) => i.category === 'EMPLOYER_CONTRIBUTION')
          .reduce((s, i) => s + num(i.amount), 0);
        const wages = basisCode
          ? basicItems
              .filter((i) => i.runEmployeeId === e.id)
              .reduce((s, i) => s + num(i.amount), 0)
          : num(e.gross);
        return {
          employeeId: e.employeeId,
          employeeCode: e.employeeCode,
          employeeName: e.employeeName,
          wages: Math.round(wages * 100) / 100,
          employeeShare: Math.round(employee * 100) / 100,
          employerShare: Math.round(employer * 100) / 100,
        };
      })
      .filter((r) => r.employeeShare !== 0 || r.employerShare !== 0);
    const totals = rows.reduce(
      (t, r) => ({
        wages: Math.round((t.wages + r.wages) * 100) / 100,
        employeeShare: Math.round((t.employeeShare + r.employeeShare) * 100) / 100,
        employerShare: Math.round((t.employerShare + r.employerShare) * 100) / 100,
      }),
      { wages: 0, employeeShare: 0, employerShare: 0 },
    );
    const table: TabularReport = {
      title: `${pack} summary - ${run.label}`,
      subtitle: `${inst.name} | ${periodText(run.periodStart, run.periodEnd)}`,
      columns: [
        'Code',
        'Employee',
        pack === 'PF' ? 'PF wages' : 'Gross wages',
        'Employee share',
        'Employer share',
      ],
      rows: [
        ...rows.map((r) => [
          r.employeeCode,
          r.employeeName,
          r.wages,
          r.employeeShare,
          r.employerShare,
        ]),
        ['TOTAL', '', totals.wages, totals.employeeShare, totals.employerShare],
      ],
    };
    return { run: toRunDto(run, inst.name), pack, rows, totals, table, scope: inst };
  },

  /**
   * Group-level consolidated summary (§53) across institutions for a period, limited to the
   * institutions where the caller holds `payroll.report` (group_finance / group_hr see their
   * group; tenant isolation keeps other organizations out).
   */
  async groupSummary(query: GroupSummaryQuery): Promise<GroupPayrollSummaryDto> {
    if (query.periodEnd < query.periodStart) {
      throw new AppError(422, 'VALIDATION_ERROR', 'periodEnd must not be before periodStart');
    }
    const ids = await institutionIdsFor('payroll.report');
    const statuses = query.includeUnapproved
      ? undefined
      : { in: ['APPROVED', 'FINALIZED'] as string[] };
    const runs = await db().payrollRun.findMany({
      where: {
        ...institutionFilter(ids),
        ...(query.groupId ? { groupId: query.groupId } : {}),
        periodStart: { lte: strToDate(query.periodEnd) },
        periodEnd: { gte: strToDate(query.periodStart) },
        status: statuses ?? { notIn: [...CLOSED_RUN_STATUSES] },
      },
      orderBy: { periodStart: 'asc' },
    });
    const institutions = await db().institution.findMany({
      where: { id: { in: [...new Set(runs.map((r) => r.institutionId))] } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(institutions.map((i) => [i.id, i.name]));
    const byInst = new Map<string, GroupPayrollSummaryDto['institutions'][number]>();
    for (const r of runs) {
      const row = byInst.get(r.institutionId) ?? {
        institutionId: r.institutionId,
        institutionName: nameOf.get(r.institutionId) ?? r.institutionId,
        runIds: [],
        status: r.status,
        employeeCount: 0,
        grossTotal: 0,
        deductionTotal: 0,
        netTotal: 0,
        employerTotal: 0,
      };
      row.runIds.push(r.id);
      if (row.status !== r.status) row.status = 'MIXED';
      row.employeeCount += r.employeeCount;
      row.grossTotal = Math.round((row.grossTotal + num(r.grossTotal)) * 100) / 100;
      row.deductionTotal = Math.round((row.deductionTotal + num(r.deductionTotal)) * 100) / 100;
      row.netTotal = Math.round((row.netTotal + num(r.netTotal)) * 100) / 100;
      row.employerTotal = Math.round((row.employerTotal + num(r.employerTotal)) * 100) / 100;
      byInst.set(r.institutionId, row);
    }
    const rows = [...byInst.values()].sort((a, b) =>
      a.institutionName.localeCompare(b.institutionName),
    );
    const totals = rows.reduce(
      (t, r) => ({
        employeeCount: t.employeeCount + r.employeeCount,
        grossTotal: Math.round((t.grossTotal + r.grossTotal) * 100) / 100,
        deductionTotal: Math.round((t.deductionTotal + r.deductionTotal) * 100) / 100,
        netTotal: Math.round((t.netTotal + r.netTotal) * 100) / 100,
        employerTotal: Math.round((t.employerTotal + r.employerTotal) * 100) / 100,
      }),
      { employeeCount: 0, grossTotal: 0, deductionTotal: 0, netTotal: 0, employerTotal: 0 },
    );
    return {
      periodStart: query.periodStart,
      periodEnd: query.periodEnd,
      institutions: rows,
      totals,
    };
  },

  groupTable(s: GroupPayrollSummaryDto): TabularReport {
    return {
      title: 'Group payroll summary',
      subtitle: `${s.periodStart} to ${s.periodEnd}`,
      columns: [
        'Institution',
        'Status',
        'Employees',
        'Gross',
        'Deductions',
        'Net',
        'Employer cost',
      ],
      rows: [
        ...s.institutions.map((r) => [
          r.institutionName,
          r.status,
          String(r.employeeCount),
          r.grossTotal,
          r.deductionTotal,
          r.netTotal,
          r.employerTotal,
        ]),
        [
          'TOTAL',
          '',
          String(s.totals.employeeCount),
          s.totals.grossTotal,
          s.totals.deductionTotal,
          s.totals.netTotal,
          s.totals.employerTotal,
        ],
      ],
    };
  },

  recordExport,
};
