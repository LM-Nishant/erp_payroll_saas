import type { Prisma } from '@prisma/client';
import type { AssetReportQuery } from '@erp/shared';
import ExcelJS from 'exceljs';
import { audit } from '../../core/audit';
import { andScope, currentPrincipal, scopeWhere } from '../../core/authz';
import { renderPdfTemplate } from '../../core/pdf';
import { tenantDb } from '../../core/tenancy';
import { addYears, bookValueAt, dateOnly, round2, todayUtc } from './assets.logic';
import { dateStr, depreciationParams, num, toDate } from './assets.mappers';
import { assetListWhere } from './assets.service';

/*
 * Asset reports (register, depreciation, assignments, maintenance cost, disposals) as JSON or
 * CSV / Excel / PDF downloads. PDF uses the module's own `asset_report` template.
 */

export const REPORT_TEMPLATE = 'asset_report';
const MAX_ROWS = 20_000;

export interface AssetTabularReport {
  title: string;
  subtitle?: string;
  columns: string[];
  rows: Array<Array<string | number>>;
}

export interface ReportFile {
  fileName: string;
  contentType: string;
  body: Buffer;
}

const csvCell = (v: string | number) => {
  const s = typeof v === 'number' ? v.toFixed(2) : v;
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v !== 'number' ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function reportToCsv(report: AssetTabularReport): string {
  return (
    [report.columns, ...report.rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
  );
}

async function reportToXlsx(report: AssetTabularReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ERP Assets';
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

const s = (v: string | null | undefined) => v ?? '';

async function childWhere(query: AssetReportQuery) {
  return andScope<Record<string, unknown>>(
    {
      institutionId: query.institutionId,
      ...(query.categoryId ? { asset: { categoryId: query.categoryId } } : {}),
    },
    await scopeWhere(currentPrincipal(), 'asset.view', 'asset'),
  );
}

async function registerReport(query: AssetReportQuery, asOf: Date): Promise<AssetTabularReport> {
  const where = await assetListWhere({
    institutionId: query.institutionId,
    categoryId: query.categoryId,
  });
  const rows = await tenantDb().asset.findMany({
    where,
    include: {
      category: true,
      institution: { select: { name: true } },
      department: { select: { name: true } },
      custodian: { select: { displayName: true, employeeCode: true } },
    },
    orderBy: [{ assetTag: 'asc' }],
    take: MAX_ROWS,
  });
  return {
    title: 'Asset register',
    subtitle: `As of ${dateOnly(asOf)} · ${rows.length} assets`,
    columns: [
      'Tag',
      'Name',
      'Category',
      'Institution',
      'Department',
      'Location',
      'Make / model',
      'Serial no',
      'Vendor',
      'Invoice no',
      'Purchase date',
      'Warranty expiry',
      'Status',
      'Condition',
      'Custodian',
      'Cost',
      'Book value',
    ],
    rows: rows.map((a) => [
      a.assetTag,
      a.name,
      a.category.name,
      a.institution.name,
      s(a.department?.name),
      s(a.location),
      [a.make, a.model].filter(Boolean).join(' '),
      s(a.serialNo),
      s(a.vendor),
      s(a.invoiceNo),
      s(dateStr(a.purchaseDate)),
      s(dateStr(a.warrantyExpiry)),
      a.status,
      a.condition,
      a.custodian ? `${a.custodian.displayName} (${a.custodian.employeeCode})` : '',
      num(a.purchaseCost),
      a.status === 'DISPOSED'
        ? 0
        : bookValueAt(num(a.purchaseCost), a.purchaseDate, depreciationParams(a.category), asOf),
    ]),
  };
}

async function depreciationReport(
  query: AssetReportQuery,
  asOf: Date,
): Promise<AssetTabularReport> {
  const where = await assetListWhere({
    institutionId: query.institutionId,
    categoryId: query.categoryId,
  });
  const rows = await tenantDb().asset.findMany({
    where: { AND: [where, { status: { not: 'DISPOSED' } }] },
    include: { category: true },
    orderBy: [{ assetTag: 'asc' }],
    take: MAX_ROWS,
  });
  const yearStart = addYears(asOf, -1);
  let totals = { cost: 0, opening: 0, charge: 0, closing: 0 };
  const body = rows.map((a) => {
    const p = depreciationParams(a.category);
    const cost = num(a.purchaseCost);
    const opening =
      a.purchaseDate && a.purchaseDate > yearStart
        ? cost
        : bookValueAt(cost, a.purchaseDate, p, yearStart);
    const closing = bookValueAt(cost, a.purchaseDate, p, asOf);
    const charge = round2(Math.max(0, opening - closing));
    totals = {
      cost: totals.cost + cost,
      opening: totals.opening + opening,
      charge: totals.charge + charge,
      closing: totals.closing + closing,
    };
    return [
      a.assetTag,
      a.name,
      a.category.name,
      p.method,
      p.ratePercent ?? '',
      p.usefulLifeYears ?? '',
      s(dateStr(a.purchaseDate)),
      cost,
      opening,
      charge,
      round2(cost - closing),
      closing,
    ] as Array<string | number>;
  });
  body.push([
    'TOTAL',
    '',
    '',
    '',
    '',
    '',
    '',
    round2(totals.cost),
    round2(totals.opening),
    round2(totals.charge),
    round2(totals.cost - totals.closing),
    round2(totals.closing),
  ]);
  return {
    title: 'Depreciation register',
    subtitle: `Year ending ${dateOnly(asOf)} (from ${dateOnly(yearStart)})`,
    columns: [
      'Tag',
      'Name',
      'Category',
      'Method',
      'Rate %',
      'Life (yrs)',
      'Purchase date',
      'Cost',
      'Opening value',
      'Depreciation for year',
      'Accumulated depreciation',
      'Closing value',
    ],
    rows: body,
  };
}

async function assignmentsReport(query: AssetReportQuery): Promise<AssetTabularReport> {
  const rows = await tenantDb().assetAssignment.findMany({
    where: {
      AND: [(await childWhere(query)) as Prisma.AssetAssignmentWhereInput, { status: 'ACTIVE' }],
    },
    include: {
      asset: { select: { assetTag: true, name: true, category: { select: { name: true } } } },
      employee: { select: { displayName: true, employeeCode: true } },
    },
    orderBy: [{ assignedAt: 'desc' }],
    take: MAX_ROWS,
  });
  return {
    title: 'Assets in custody',
    subtitle: `${rows.length} active assignments`,
    columns: [
      'Tag',
      'Asset',
      'Category',
      'Assigned to',
      'Employee code',
      'Assigned on',
      'Expected return',
      'Acknowledged',
      'Condition out',
    ],
    rows: rows.map((r) => [
      r.asset.assetTag,
      r.asset.name,
      r.asset.category.name,
      r.employee?.displayName ?? (r.location || r.targetType),
      s(r.employee?.employeeCode),
      s(dateStr(r.assignedAt)),
      s(dateStr(r.expectedReturnDate)),
      r.acknowledgedAt ? dateOnly(r.acknowledgedAt) : 'Pending',
      r.conditionOut,
    ]),
  };
}

async function maintenanceReport(query: AssetReportQuery): Promise<AssetTabularReport> {
  const rows = await tenantDb().assetMaintenance.findMany({
    where: (await childWhere(query)) as Prisma.AssetMaintenanceWhereInput,
    include: { asset: { select: { assetTag: true, name: true } } },
    orderBy: [{ createdAt: 'desc' }],
    take: MAX_ROWS,
  });
  const total = rows.reduce((sum, r) => sum + num(r.cost), 0);
  return {
    title: 'Maintenance & service history',
    subtitle: `${rows.length} tickets · total cost ${total.toFixed(2)}`,
    columns: [
      'Ticket',
      'Tag',
      'Asset',
      'Type',
      'Priority',
      'Status',
      'Title',
      'Vendor',
      'Raised on',
      'Completed on',
      'Under warranty',
      'Cost',
    ],
    rows: [
      ...rows.map((r) => [
        r.ticketNo,
        r.asset.assetTag,
        r.asset.name,
        r.type,
        r.priority,
        r.status,
        r.title,
        s(r.vendor),
        dateOnly(r.createdAt),
        s(dateStr(r.completedAt)),
        r.underWarranty ? 'Yes' : 'No',
        num(r.cost),
      ]),
      ['TOTAL', '', '', '', '', '', '', '', '', '', '', round2(total)],
    ],
  };
}

async function disposalsReport(query: AssetReportQuery): Promise<AssetTabularReport> {
  const rows = await tenantDb().assetDisposal.findMany({
    where: (await childWhere(query)) as Prisma.AssetDisposalWhereInput,
    include: { asset: { select: { assetTag: true, name: true, purchaseCost: true } } },
    orderBy: [{ disposalDate: 'desc' }],
    take: MAX_ROWS,
  });
  return {
    title: 'Disposals & write-offs',
    subtitle: `${rows.length} requests`,
    columns: [
      'Tag',
      'Asset',
      'Method',
      'Disposal date',
      'Status',
      'Cost',
      'Book value',
      'Sale value',
      'Gain / (loss)',
      'Buyer',
      'Reason',
    ],
    rows: rows.map((r) => {
      const sale = r.saleValue === null ? 0 : num(r.saleValue);
      return [
        r.asset.assetTag,
        r.asset.name,
        r.method,
        s(dateStr(r.disposalDate)),
        r.status,
        num(r.asset.purchaseCost),
        num(r.bookValue),
        sale,
        round2(sale - num(r.bookValue)),
        s(r.buyer),
        r.reason,
      ];
    }),
  };
}

export async function buildAssetReport(query: AssetReportQuery): Promise<AssetTabularReport> {
  const asOf = query.asOf ? toDate(query.asOf) : todayUtc();
  switch (query.type) {
    case 'depreciation':
      return depreciationReport(query, asOf);
    case 'assignments':
      return assignmentsReport(query);
    case 'maintenance':
      return maintenanceReport(query);
    case 'disposals':
      return disposalsReport(query);
    default:
      return registerReport(query, asOf);
  }
}

export async function exportAssetReport(
  query: AssetReportQuery,
): Promise<AssetTabularReport | ReportFile> {
  const report = await buildAssetReport(query);
  if (query.format === 'json') return report;
  const base = slug(report.title);
  let file: ReportFile;
  if (query.format === 'csv') {
    file = {
      fileName: `${base}.csv`,
      contentType: 'text/csv; charset=utf-8',
      body: Buffer.from(reportToCsv(report), 'utf8'),
    };
  } else if (query.format === 'xlsx') {
    file = {
      fileName: `${base}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: await reportToXlsx(report),
    };
  } else {
    let groupId: string | null = null;
    if (query.institutionId) {
      const inst = await tenantDb().institution.findUnique({
        where: { id: query.institutionId },
        select: { groupId: true },
      });
      groupId = inst?.groupId ?? null;
    }
    const rendered = await renderPdfTemplate(
      REPORT_TEMPLATE,
      {
        title: report.title,
        ...(report.subtitle ? { subtitle: report.subtitle } : {}),
        columns: report.columns,
        rows: report.rows.map((r) => r.map((v) => (typeof v === 'number' ? v.toFixed(2) : v))),
      },
      { groupId, institutionId: query.institutionId ?? null, campusId: null, departmentId: null },
    );
    file = { fileName: `${base}.pdf`, contentType: 'application/pdf', body: rendered.body };
  }
  await audit.record({
    action: 'asset_report.exported',
    entityType: 'asset_report',
    entityId: query.type,
    after: { type: query.type, format: query.format, rows: report.rows.length },
  });
  return file;
}
