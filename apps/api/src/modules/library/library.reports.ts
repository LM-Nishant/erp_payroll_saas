import type { Prisma } from '@prisma/client';
import {
  createLibraryBookSchema,
  type CreateStockVerificationInput,
  type LibraryDashboardDto,
  type LibraryImportResultDto,
  type LibraryLabelsInput,
  type LibraryReportDto,
  type LibraryReportKey,
  type LibraryReportQuery,
  type LibraryStockVerificationDto,
  type ScanStockVerificationInput,
} from '@erp/shared';
import ExcelJS from 'exceljs';
import QRCode from 'qrcode';
import { z } from 'zod';
import { audit } from '../../core/audit';
import { andScope, authorize, currentPrincipal } from '../../core/authz';
import { AppError, ConflictError, NotFoundError } from '../../core/http/errors';
import { registerPdfTemplate, renderPdfTemplate } from '../../core/pdf';
import { tenantDb, withTenant } from '../../core/tenancy';
import { toCsv, toXlsx, type ReportFile } from '../payroll/payroll.reports';
import { canLib, libResource, libScope, resolveInstitution } from './library.access';
import { createCopiesInTx, withAccessionRetry } from './library.catalogue';
import { LIBRARY_LABELS_TEMPLATE, LIBRARY_REPORT_TEMPLATE } from './library.constants';
import { circulationService } from './library.circulation';
import {
  computeOverdueFine,
  dateStr,
  mapImportRow,
  overdueDays,
  parseCsv,
  splitList,
  toDate,
} from './library.logic';
import { num } from './library.mappers';
import { policyFor } from './library.access';

const db = () => tenantDb();

/* ------------------------------------ PDF templates -------------------------------------- */

const labelSchema = z
  .object({
    title: z.string(),
    labels: z
      .array(
        z
          .object({
            accessionNo: z.string(),
            title: z.string(),
            callNumber: z.string().optional(),
            qr: z.string(),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();

registerPdfTemplate({
  key: LIBRARY_LABELS_TEMPLATE,
  version: 1,
  name: 'Library barcode labels',
  description: 'Spine / accession labels with a scannable QR code of the copy barcode.',
  inputSchema: labelSchema,
  defaultCategory: 'other',
  defaultDocumentType: 'library_labels',
  title: (i) => i.title,
  build: (i) => [
    { type: 'heading', level: 2, text: i.title },
    ...i.labels.map((l) => ({
      type: 'image' as const,
      data: Buffer.from(l.qr, 'base64'),
      width: 80,
      align: 'left' as const,
      caption: `${l.accessionNo}  ·  ${l.title.slice(0, 70)}${l.callNumber ? `  ·  ${l.callNumber}` : ''}`,
    })),
  ],
});

registerPdfTemplate({
  key: LIBRARY_REPORT_TEMPLATE,
  version: 1,
  name: 'Library report',
  description: 'Tabular library report (issued, overdue, most borrowed, fines).',
  inputSchema: z
    .object({
      title: z.string(),
      subtitle: z.string().optional(),
      columns: z.array(z.string()),
      rows: z.array(z.array(z.string())),
    })
    .strict(),
  defaultCategory: 'other',
  defaultDocumentType: 'library_report',
  title: (i) => i.title,
  build: (i) => [
    { type: 'heading', level: 1, text: i.title },
    ...(i.subtitle ? [{ type: 'paragraph' as const, text: i.subtitle }] : []),
    { type: 'table', columns: i.columns, rows: i.rows },
  ],
});

/* -------------------------------------- Dashboard ---------------------------------------- */

export async function dashboard(institutionId?: string): Promise<LibraryDashboardDto> {
  const scope = await libScope();
  const base = andScope<{ institutionId?: string }>({ institutionId }, scope) as Record<
    string,
    unknown
  >;
  const today = toDate(dateStr(new Date()));
  const [titles, copies, available, issued, overdue, waiting, ready, fines] = await Promise.all([
    db().libraryBook.count({ where: base }),
    db().libraryCopy.count({ where: { ...base, status: { not: 'WITHDRAWN' } } }),
    db().libraryCopy.count({ where: { ...base, status: 'AVAILABLE' } }),
    db().libraryLoan.count({ where: { ...base, status: 'ISSUED' } }),
    db().libraryLoan.count({ where: { ...base, status: 'ISSUED', dueDate: { lt: today } } }),
    db().libraryReservation.count({ where: { ...base, status: 'WAITING' } }),
    db().libraryReservation.count({ where: { ...base, status: 'READY' } }),
    db().libraryFine.aggregate({
      where: { ...base, status: 'PENDING' },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);
  const [issuedToday, returnedToday] = await Promise.all([
    db().libraryLoan.count({ where: { ...base, issuedAt: { gte: today } } }),
    db().libraryLoan.count({ where: { ...base, returnedAt: { gte: today } } }),
  ]);
  const recent = await circulationService.listLoans({
    page: 1,
    pageSize: 10,
    institutionId,
  } as Parameters<typeof circulationService.listLoans>[0]);
  return {
    titles,
    copies,
    available,
    issued,
    overdue,
    reservationsWaiting: waiting,
    reservationsReady: ready,
    pendingFines: fines._count._all,
    pendingFineAmount: num(fines._sum.amount),
    issuedToday,
    returnedToday,
    recentLoans: recent.items,
  };
}

/* --------------------------------------- Reports ----------------------------------------- */

const REPORT_TITLES: Record<LibraryReportKey, string> = {
  issued: 'Books issued',
  overdue: 'Overdue books',
  most_borrowed: 'Most borrowed titles',
  fines: 'Library fines',
};

export async function buildReport(
  key: LibraryReportKey,
  q: LibraryReportQuery,
): Promise<LibraryReportDto> {
  const scope = await libScope();
  const base = andScope<Record<string, unknown>>({ institutionId: q.institutionId }, scope);
  const range =
    q.from || q.to
      ? {
          ...(q.from ? { gte: toDate(q.from) } : {}),
          ...(q.to ? { lt: new Date(toDate(q.to).getTime() + 86_400_000) } : {}),
        }
      : undefined;
  const todayStr = dateStr(new Date());
  const title = REPORT_TITLES[key];
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  switch (key) {
    case 'issued':
    case 'overdue': {
      const where: Prisma.LibraryLoanWhereInput =
        key === 'issued'
          ? { ...base, ...(range ? { issuedAt: range } : {}) }
          : { ...base, status: 'ISSUED', dueDate: { lt: toDate(todayStr) } };
      const loans = await db().libraryLoan.findMany({
        where,
        include: { book: { select: { title: true } }, copy: { select: { accessionNo: true } } },
        orderBy: key === 'issued' ? { issuedAt: 'desc' } : { dueDate: 'asc' },
        take: q.limit,
      });
      const policies = new Map<string, Awaited<ReturnType<typeof policyFor>>>();
      const rows: Array<Array<string | number>> = [];
      for (const l of loans) {
        const pk = `${l.institutionId}:${l.memberType}`;
        if (!policies.has(pk))
          policies.set(pk, await policyFor(l.institutionId, l.memberType as 'STUDENT'));
        const due = dateStr(l.dueDate);
        const base = [
          s(l.copy?.accessionNo),
          s(l.book?.title),
          l.memberName,
          l.memberType,
          dateStr(l.issuedAt),
          due,
        ];
        rows.push(
          key === 'issued'
            ? [...base, l.returnedAt ? dateStr(l.returnedAt) : '', l.status, num(l.fineAmount)]
            : [
                ...base,
                String(overdueDays(due, todayStr)),
                computeOverdueFine(due, todayStr, policies.get(pk)!),
              ],
        );
      }
      return {
        key,
        title,
        columns:
          key === 'issued'
            ? [
                'Accession',
                'Title',
                'Member',
                'Type',
                'Issued',
                'Due',
                'Returned',
                'Status',
                'Fine',
              ]
            : [
                'Accession',
                'Title',
                'Member',
                'Type',
                'Issued',
                'Due',
                'Days overdue',
                'Fine so far',
              ],
        rows,
      };
    }
    case 'most_borrowed': {
      const grouped = await db().libraryLoan.groupBy({
        by: ['bookId'],
        where: { ...base, ...(range ? { issuedAt: range } : {}) },
        _count: { _all: true },
        orderBy: { _count: { bookId: 'desc' } },
        take: Math.min(q.limit, 200),
      });
      const books = await db().libraryBook.findMany({
        where: { id: { in: grouped.map((g) => g.bookId) } },
        select: { id: true, title: true, authorText: true, category: true },
      });
      const byId = new Map(books.map((b) => [b.id, b]));
      return {
        key,
        title,
        columns: ['#', 'Title', 'Authors', 'Category', 'Loans'],
        rows: grouped.map((g, i) => {
          const b = byId.get(g.bookId);
          return [
            String(i + 1),
            s(b?.title),
            s(b?.authorText),
            s(b?.category),
            String(g._count._all),
          ];
        }),
      };
    }
    case 'fines': {
      const fines = await db().libraryFine.findMany({
        where: { ...base, ...(range ? { createdAt: range } : {}) },
        include: { loan: { select: { book: { select: { title: true } } } } },
        orderBy: { createdAt: 'desc' },
        take: q.limit,
      });
      return {
        key,
        title,
        columns: ['Date', 'Member', 'Type', 'Book', 'Reason', 'Status', 'Settled', 'Amount'],
        rows: fines.map((f) => [
          dateStr(f.createdAt),
          f.memberName,
          f.memberType,
          s(f.loan?.book?.title),
          f.reason,
          f.status,
          f.settledAt ? dateStr(f.settledAt) : '',
          num(f.amount),
        ]),
      };
    }
  }
}

export async function exportReport(
  report: LibraryReportDto,
  format: 'csv' | 'xlsx' | 'pdf',
): Promise<ReportFile> {
  const base = `library-${report.key}-${dateStr(new Date())}`;
  const tab = { title: report.title, columns: report.columns, rows: report.rows };
  if (format === 'csv')
    return { fileName: `${base}.csv`, contentType: 'text/csv', body: Buffer.from(toCsv(tab)) };
  if (format === 'xlsx')
    return {
      fileName: `${base}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: await toXlsx(tab),
    };
  throw new AppError(400, 'UNSUPPORTED_FORMAT', 'Unsupported format');
}

/* ---------------------------------------- Labels ----------------------------------------- */

export async function labelsPdf(input: LibraryLabelsInput) {
  const where = andScope<Prisma.LibraryCopyWhereInput>(
    {
      ...(input.copyIds ? { id: { in: input.copyIds } } : {}),
      bookId: input.bookId,
      institutionId: input.institutionId,
      status: { not: 'WITHDRAWN' },
    },
    await libScope(),
  );
  const copies = await db().libraryCopy.findMany({
    where,
    include: { book: { select: { title: true, callNumber: true } } },
    orderBy: { accessionNo: 'asc' },
    take: 500,
  });
  if (!copies.length) throw new NotFoundError('Library copies');
  const first = copies[0]!;
  const labels = [];
  for (const c of copies) {
    const qr = await QRCode.toBuffer(c.barcode, { type: 'png', margin: 1, width: 240 });
    labels.push({
      accessionNo: c.accessionNo,
      title: c.book.title,
      ...(c.book.callNumber ? { callNumber: c.book.callNumber } : {}),
      qr: qr.toString('base64'),
    });
  }
  const rendered = await renderPdfTemplate(
    LIBRARY_LABELS_TEMPLATE,
    { title: `Library labels (${copies.length})`, labels },
    {
      groupId: first.groupId,
      institutionId: first.institutionId,
      campusId: null,
      departmentId: null,
    },
  );
  await audit.record({
    action: 'library_copy.labels_printed',
    entityType: 'institution',
    entityId: first.institutionId,
    after: { count: copies.length },
  });
  return { fileName: `library-labels-${dateStr(new Date())}.pdf`, body: rendered.body };
}

/* ---------------------------------------- Import ----------------------------------------- */

async function readRows(file: { fileName: string; body: Buffer }) {
  const name = file.fileName.toLowerCase();
  let matrix: string[][];
  if (name.endsWith('.xlsx')) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.body as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new AppError(422, 'EMPTY_FILE', 'The workbook has no sheets');
    matrix = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = (row.values as unknown[]).slice(1);
      matrix.push(
        values.map((v) => {
          if (v === null || v === undefined) return '';
          if (typeof v === 'object' && 'text' in (v as object))
            return String((v as { text: unknown }).text);
          if (typeof v === 'object' && 'result' in (v as object))
            return String((v as { result: unknown }).result);
          return String(v);
        }),
      );
    });
  } else if (name.endsWith('.csv') || name.endsWith('.txt')) {
    matrix = parseCsv(file.body.toString('utf8').replace(/^\uFEFF/, ''));
  } else {
    throw new AppError(422, 'UNSUPPORTED_FILE', 'Upload a .csv or .xlsx file');
  }
  const [header, ...rest] = matrix;
  if (!header) throw new AppError(422, 'EMPTY_FILE', 'The file has no header row');
  return rest
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

/**
 * Bulk import titles (CSV / XLSX). Rows match existing titles of the institution by ISBN, else
 * by exact title; matches are updated and topped up to the requested number of copies, so
 * re-importing the same file is idempotent.
 */
export async function importBooks(
  institutionId: string,
  file: { fileName: string; body: Buffer },
): Promise<LibraryImportResultDto> {
  const inst = await resolveInstitution(institutionId);
  const scope = { groupId: inst.groupId, institutionId: inst.id, campusId: null };
  await authorize(currentPrincipal(), 'library.manage', libResource(scope));
  const rows = await readRows(file);
  if (rows.length > 5000) throw new AppError(422, 'TOO_MANY_ROWS', 'Import at most 5000 rows');
  const result: LibraryImportResultDto = { created: 0, updated: 0, copiesCreated: 0, errors: [] };
  for (const [i, raw] of rows.entries()) {
    const mapped = mapImportRow(raw);
    const parsed = createLibraryBookSchema.safeParse({
      ...mapped,
      institutionId,
      authors: splitList(mapped.authors),
      tags: splitList(mapped.tags),
      ...(mapped.itemType ? { itemType: String(mapped.itemType).toUpperCase() } : {}),
    });
    if (!parsed.success) {
      result.errors.push({
        row: i + 2,
        message: parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
      });
      continue;
    }
    const { copies, shelf, rack, institutionId: _inst, campusId: _campus, ...fields } = parsed.data;
    try {
      const outcome = await withAccessionRetry(() =>
        db().$transaction(async (tx) => {
          const existing = await tx.libraryBook.findFirst({
            where: {
              institutionId,
              ...(fields.isbn ? { isbn: fields.isbn } : { title: fields.title, isbn: null }),
            },
          });
          const data = {
            ...fields,
            authorText: fields.authors.join('; ').slice(0, 1000) || null,
          };
          const book = existing
            ? await tx.libraryBook.update({ where: { id: existing.id }, data })
            : await tx.libraryBook.create({ data: withTenant({ ...scope, ...data }) });
          const have = await tx.libraryCopy.count({ where: { bookId: book.id } });
          const add = Math.max(0, copies - have);
          if (add) await createCopiesInTx(tx, book, inst.code, add, { shelf, rack });
          return { created: !existing, added: add };
        }),
      );
      if (outcome.created) result.created++;
      else result.updated++;
      result.copiesCreated += outcome.added;
    } catch (err) {
      result.errors.push({ row: i + 2, message: err instanceof Error ? err.message : 'Failed' });
    }
  }
  await audit.record({
    action: 'library_book.imported',
    entityType: 'institution',
    entityId: institutionId,
    after: { ...result, errors: result.errors.length, fileName: file.fileName },
  });
  return result;
}

/* ---------------------------------- Stock verification ----------------------------------- */

type StockRow = Prisma.LibraryStockVerificationGetPayload<object>;

function toStockDto(r: StockRow): LibraryStockVerificationDto {
  const scanned = Array.isArray(r.scannedBarcodes) ? r.scannedBarcodes.length : 0;
  return {
    id: r.id,
    institutionId: r.institutionId,
    name: r.name,
    status: r.status as 'OPEN' | 'COMPLETED',
    scannedCount: scanned,
    result: (r.result as LibraryStockVerificationDto['result']) ?? null,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

async function loadStock(id: string, permission = 'library.view') {
  const row = await db().libraryStockVerification.findUnique({ where: { id } });
  if (!row || !(await canLib(permission, row))) throw new NotFoundError('Stock verification');
  return row;
}

export const stockService = {
  async list(institutionId?: string) {
    const rows = await db().libraryStockVerification.findMany({
      where: andScope({ institutionId }, await libScope()),
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(toStockDto);
  },

  async get(id: string) {
    return toStockDto(await loadStock(id));
  },

  async create(input: CreateStockVerificationInput) {
    const inst = await resolveInstitution(input.institutionId);
    const scope = { groupId: inst.groupId, institutionId: inst.id, campusId: null };
    await authorize(currentPrincipal(), 'library.manage', libResource(scope));
    const row = await db().libraryStockVerification.create({
      data: withTenant({
        ...scope,
        name: input.name,
        status: 'OPEN',
        scannedBarcodes: [],
        startedByUserId: currentPrincipal().userId ?? null,
      }),
    });
    await audit.record({
      action: 'library_stock_verification.created',
      entityType: 'library_stock_verification',
      entityId: row.id,
      after: { name: row.name },
    });
    return toStockDto(row);
  },

  async scan(id: string, input: ScanStockVerificationInput) {
    const row = await loadStock(id);
    await authorize(currentPrincipal(), 'library.manage', libResource(row));
    if (row.status !== 'OPEN') throw new ConflictError('Stock verification is completed');
    const set = new Set(
      Array.isArray(row.scannedBarcodes) ? (row.scannedBarcodes as string[]) : [],
    );
    for (const b of input.barcodes) set.add(b.trim());
    if (set.size > 50_000) throw new AppError(422, 'TOO_MANY_SCANS', 'Too many barcodes');
    const updated = await db().libraryStockVerification.update({
      where: { id },
      data: { scannedBarcodes: [...set] },
    });
    return toStockDto(updated);
  },

  /** Compare scanned barcodes with on-shelf stock (AVAILABLE / RESERVED / DAMAGED copies). */
  async complete(id: string) {
    const row = await loadStock(id);
    await authorize(currentPrincipal(), 'library.manage', libResource(row));
    if (row.status !== 'OPEN') throw new ConflictError('Stock verification is completed');
    const scanned = new Set(
      Array.isArray(row.scannedBarcodes) ? (row.scannedBarcodes as string[]) : [],
    );
    const copies = await db().libraryCopy.findMany({
      where: { institutionId: row.institutionId, status: { not: 'WITHDRAWN' } },
      include: { book: { select: { title: true } } },
    });
    const shelfStatuses = new Set(['AVAILABLE', 'RESERVED', 'DAMAGED']);
    const expected = copies.filter((c) => shelfStatuses.has(c.status));
    const known = new Map(copies.map((c) => [c.barcode, c]));
    const result = {
      expected: expected.length,
      found: expected.filter((c) => scanned.has(c.barcode)).length,
      missing: expected
        .filter((c) => !scanned.has(c.barcode))
        .slice(0, 2000)
        .map((c) => ({ barcode: c.barcode, title: c.book.title, accessionNo: c.accessionNo })),
      unexpected: [...scanned].filter((b) => !known.has(b)).slice(0, 2000),
      misplacedStatus: [...scanned]
        .map((b) => known.get(b))
        .filter((c): c is NonNullable<typeof c> => !!c && !shelfStatuses.has(c.status))
        .map((c) => ({ barcode: c.barcode, status: c.status })),
    };
    const updated = await db().libraryStockVerification.update({
      where: { id },
      data: { status: 'COMPLETED', result, completedAt: new Date() },
    });
    await audit.record({
      action: 'library_stock_verification.completed',
      entityType: 'library_stock_verification',
      entityId: id,
      after: { expected: result.expected, found: result.found, missing: result.missing.length },
    });
    return toStockDto(updated);
  },
};
