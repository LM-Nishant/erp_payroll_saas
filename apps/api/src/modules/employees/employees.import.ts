import {
  createEmployeeSchema,
  EMPLOYEE_IMPORT_COLUMNS,
  type EmployeeImportJobDto,
  type EmployeeImportRowReport,
  type ListEmployeesQuery,
} from '@erp/shared';
import type { EmployeeImportJob, Prisma } from '@prisma/client';
import { audit } from '../../core/audit';
import {
  andScope,
  assertPermission,
  authorize,
  createPrincipal,
  currentPrincipal,
  loadUserGrants,
  runWithPrincipal,
  scopeWhere,
  systemPrincipal,
  type Principal,
} from '../../core/authz';
import { AppError, NotFoundError, ValidationError } from '../../core/http/errors';
import { parseInput } from '../../core/http/validation';
import { defineJob, enqueue } from '../../core/queue';
import { currentOrganizationId, tenantDb, withTenant } from '../../core/tenancy';
import { resolveAssignment } from './employees.assignment';
import { dateStrOrNull, employeeInclude } from './employees.mappers';
import { assignmentResource, employeeService } from './employees.service';

/* --------------------------------- CSV helpers ------------------------------------------ */

/** RFC 4180 parser (quoted fields, escaped quotes, CRLF / LF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/** Quote a CSV cell; neutralises spreadsheet formula injection (=, +, -, @ prefixes). */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const toCsv = (rows: unknown[][]) =>
  rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/* --------------------------------- Import ----------------------------------------------- */

export const IMPORT_JOB = 'hr.employee_import';
const MAX_ROWS = 5000;
type Column = (typeof EMPLOYEE_IMPORT_COLUMNS)[number];

function toJobDto(j: EmployeeImportJob): EmployeeImportJobDto {
  return {
    id: j.id,
    status: j.status,
    fileName: j.fileName,
    dryRun: j.dryRun,
    totalRows: j.totalRows,
    createdCount: j.createdCount,
    errorCount: j.errorCount,
    report: (j.report ?? null) as EmployeeImportRowReport[] | null,
    createdAt: j.createdAt.toISOString(),
    completedAt: j.completedAt?.toISOString() ?? null,
  };
}

function errorsOf(err: unknown): { field: string; message: string }[] {
  if (err instanceof AppError) {
    const details = err.details as
      { issues?: { path: string; message: string }[]; field?: string } | undefined;
    if (details?.issues?.length) {
      return details.issues.map((i) => ({ field: i.path || 'row', message: i.message }));
    }
    return [{ field: details?.field ?? 'row', message: err.message }];
  }
  return [{ field: 'row', message: (err as Error).message ?? 'Unexpected error' }];
}

/** Map a CSV record to a create-employee body (codes → ids). Throws on invalid references. */
async function rowToInput(rec: Partial<Record<Column, string>>) {
  const db = tenantDb();
  const v = (k: Column) => {
    const s = rec[k]?.trim();
    return s ? s : undefined;
  };
  const errors: { field: string; message: string }[] = [];
  const institution = v('institutionCode')
    ? await db.institution.findFirst({
        where: { code: v('institutionCode') },
        select: { id: true },
      })
    : null;
  if (!institution) errors.push({ field: 'institutionCode', message: 'Unknown institution code' });
  const lookup = async (
    field: Column,
    find: (code: string) => Promise<{ id: string } | null>,
  ): Promise<string | undefined> => {
    const code = v(field);
    if (!code) return undefined;
    const row = await find(code);
    if (!row) errors.push({ field, message: `Unknown ${field.replace(/Code$/, '')} code` });
    return row?.id;
  };
  const instId = institution?.id;
  const campusId = instId
    ? await lookup('campusCode', (code) =>
        db.campus.findFirst({ where: { institutionId: instId, code }, select: { id: true } }),
      )
    : undefined;
  const departmentId = instId
    ? await lookup('departmentCode', (code) =>
        db.department.findFirst({ where: { institutionId: instId, code }, select: { id: true } }),
      )
    : undefined;
  const designationId = await lookup('designationCode', (code) =>
    db.designation.findFirst({ where: { code }, select: { id: true } }),
  );
  const reportingManagerId = await lookup('reportingManagerCode', (code) =>
    db.employee.findFirst({ where: { employeeCode: code }, select: { id: true } }),
  );
  if (errors.length)
    throw new ValidationError('Invalid references', {
      issues: errors.map((e) => ({ path: e.field, message: e.message })),
    });
  const personal = Object.fromEntries(
    (['dateOfBirth', 'gender', 'personalEmail', 'personalPhone'] as const)
      .filter((k) => v(k) !== undefined)
      .map((k) => [k, k === 'gender' ? v(k)!.toUpperCase() : v(k)]),
  );
  const sensitive = Object.fromEntries(
    (['pan', 'aadhaar', 'uan'] as const).filter((k) => v(k) !== undefined).map((k) => [k, v(k)]),
  );
  return parseInput(createEmployeeSchema, {
    ...(v('employeeCode') ? { employeeCode: v('employeeCode') } : {}),
    firstName: v('firstName'),
    ...(v('middleName') ? { middleName: v('middleName') } : {}),
    ...(v('lastName') ? { lastName: v('lastName') } : {}),
    institutionId: instId,
    ...(campusId ? { campusId } : {}),
    ...(departmentId ? { departmentId } : {}),
    ...(designationId ? { designationId } : {}),
    ...(reportingManagerId ? { reportingManagerId } : {}),
    employmentType: v('employmentType')?.toUpperCase().replace(/[\s-]/g, '_'),
    ...(v('status') ? { status: v('status')!.toUpperCase() } : {}),
    ...(v('workEmail') ? { workEmail: v('workEmail') } : {}),
    ...(v('workPhone') ? { workPhone: v('workPhone') } : {}),
    ...(v('dateOfJoining') ? { dateOfJoining: v('dateOfJoining') } : {}),
    ...(Object.keys(personal).length ? { personal } : {}),
    ...(Object.keys(sensitive).length ? { sensitive } : {}),
  });
}

/** Process an import: validate every row; create employees unless dry-run. */
export async function processImport(jobId: string): Promise<void> {
  const db = tenantDb();
  const job = await db.employeeImportJob.findUnique({ where: { id: jobId } });
  if (!job || job.status === 'COMPLETED') return;
  await db.employeeImportJob.update({
    where: { id: jobId },
    data: { status: 'PROCESSING', startedAt: new Date() },
  });
  const report: EmployeeImportRowReport[] = [];
  let created = 0;
  try {
    const rows = parseCsv(job.input ?? '');
    const header = (rows.shift() ?? []).map((h) => h.trim());
    const known = new Set<string>(EMPLOYEE_IMPORT_COLUMNS);
    const unknown = header.filter((h) => !known.has(h));
    if (unknown.length || !header.includes('firstName') || !header.includes('institutionCode')) {
      throw new ValidationError(
        unknown.length
          ? `Unknown column(s): ${unknown.join(', ')}`
          : 'Header must include firstName, institutionCode and employmentType',
      );
    }
    if (rows.length > MAX_ROWS) throw new ValidationError(`At most ${MAX_ROWS} rows per import`);
    // Run as the requesting user so scope, limits and audit actor apply per row.
    const principal = await requesterPrincipal(job);
    await runWithPrincipal(principal, async () => {
      const seenCodes = new Set<string>();
      for (const [index, cells] of rows.entries()) {
        const rec = Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])) as Partial<
          Record<Column, string>
        >;
        const entry: EmployeeImportRowReport = {
          row: index + 2,
          employeeCode: rec.employeeCode?.trim() || null,
          errors: [],
        };
        try {
          if (entry.employeeCode && seenCodes.has(entry.employeeCode)) {
            throw new ValidationError('Duplicate employeeCode in file', {
              field: 'employeeCode',
            });
          }
          if (entry.employeeCode) seenCodes.add(entry.employeeCode);
          const input = await rowToInput(rec);
          if (input.employeeCode) {
            const dup = await tenantDb().employee.findFirst({
              where: { employeeCode: input.employeeCode },
              select: { id: true },
            });
            if (dup) {
              throw new ValidationError('employeeCode already exists', { field: 'employeeCode' });
            }
          }
          if (job.dryRun) {
            const assignment = await resolveAssignment(input);
            await authorize(currentPrincipal(), 'employee.create', assignmentResource(assignment));
          } else {
            const dto = await employeeService.create(input);
            entry.employeeId = dto.id;
            entry.employeeCode = dto.employeeCode;
            created += 1;
          }
        } catch (err) {
          entry.errors = errorsOf(err);
        }
        report.push(entry);
      }
    });
    const errorCount = report.filter((r) => r.errors.length).length;
    await db.employeeImportJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        totalRows: report.length,
        createdCount: created,
        errorCount,
        report: report as unknown as Prisma.InputJsonValue,
        input: null,
        completedAt: new Date(),
      },
    });
  } catch (err) {
    await db.employeeImportJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        totalRows: report.length,
        createdCount: created,
        errorCount: report.filter((r) => r.errors.length).length + 1,
        report: [
          ...report,
          { row: 0, employeeCode: null, errors: errorsOf(err) },
        ] as unknown as Prisma.InputJsonValue,
        input: null,
        completedAt: new Date(),
      },
    });
  }
  await audit.record({
    action: 'employee.import.complete',
    entityType: 'employee_import_job',
    entityId: jobId,
    metadata: { createdCount: created, rows: report.length, dryRun: job.dryRun },
  });
}

async function requesterPrincipal(job: EmployeeImportJob): Promise<Principal> {
  const organizationId = currentOrganizationId();
  if (!job.requestedByUserId) return systemPrincipal(organizationId);
  return createPrincipal({
    actorType: 'user',
    userId: job.requestedByUserId,
    sessionId: null,
    organizationId,
    grants: await loadUserGrants(job.requestedByUserId, organizationId),
  });
}

defineJob<{ organizationId: string; jobId: string }>({
  name: IMPORT_JOB,
  attempts: 1,
  handler: async ({ jobId }) => {
    await processImport(jobId);
  },
});

export const importService = {
  async start(file: { fileName: string; body: Buffer }, dryRun: boolean) {
    const principal = currentPrincipal();
    assertPermission(principal, 'employee.import');
    const text = file.body.toString('utf8');
    if (!/\.csv$/i.test(file.fileName)) throw new ValidationError('Upload a .csv file');
    const job = await tenantDb().employeeImportJob.create({
      data: withTenant({
        fileName: file.fileName.slice(0, 255),
        dryRun,
        input: text,
        requestedByUserId: principal.userId,
      }),
    });
    await audit.record({
      action: 'employee.import.start',
      entityType: 'employee_import_job',
      entityId: job.id,
      metadata: { fileName: job.fileName, dryRun, bytes: file.body.length },
    });
    await enqueue(
      IMPORT_JOB,
      { organizationId: currentOrganizationId(), jobId: job.id },
      { jobId: `${IMPORT_JOB}:${job.id}` },
    );
    return importService.get(job.id);
  },

  async get(id: string) {
    const principal = currentPrincipal();
    assertPermission(principal, 'employee.import');
    const job = await tenantDb().employeeImportJob.findUnique({ where: { id } });
    if (
      !job ||
      (job.requestedByUserId &&
        job.requestedByUserId !== principal.userId &&
        principal.actorType === 'user')
    ) {
      throw new NotFoundError('Import job');
    }
    return toJobDto(job);
  },

  async list() {
    const principal = currentPrincipal();
    assertPermission(principal, 'employee.import');
    const rows = await tenantDb().employeeImportJob.findMany({
      where: principal.actorType === 'user' ? { requestedByUserId: principal.userId } : {},
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map(toJobDto);
  },

  template(): string {
    return toCsv([[...EMPLOYEE_IMPORT_COLUMNS]]);
  },

  /** Scope-filtered CSV export (no sensitive values). */
  async exportCsv(query: Omit<ListEmployeesQuery, 'page' | 'pageSize'>): Promise<string> {
    const principal = currentPrincipal();
    assertPermission(principal, 'employee.export');
    const where = andScope(
      {
        ...(query.search
          ? {
              OR: [
                { displayName: { contains: query.search } },
                { employeeCode: { contains: query.search } },
              ],
            }
          : {}),
        ...(query.groupId ? { groupId: query.groupId } : {}),
        ...(query.institutionId ? { institutionId: query.institutionId } : {}),
        ...(query.campusId ? { campusId: query.campusId } : {}),
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(query.designationId ? { designationId: query.designationId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.employmentType ? { employmentType: query.employmentType } : {}),
      } satisfies Prisma.EmployeeWhereInput,
      await scopeWhere(principal, 'employee.export', 'employee'),
    ) as Prisma.EmployeeWhereInput;
    const rows = await tenantDb().employee.findMany({
      where,
      include: employeeInclude,
      orderBy: [{ employeeCode: 'asc' }],
      take: 50_000,
    });
    await audit.record({
      action: 'employee.export',
      entityType: 'employee',
      entityId: null,
      metadata: { rows: rows.length, filters: query },
    });
    return toCsv([
      [
        'employeeCode',
        'displayName',
        'firstName',
        'middleName',
        'lastName',
        'institutionCode',
        'campusCode',
        'departmentCode',
        'designationCode',
        'employmentType',
        'status',
        'workEmail',
        'workPhone',
        'dateOfJoining',
        'exitDate',
        'reportingManagerCode',
      ],
      ...rows.map((e) => [
        e.employeeCode,
        e.displayName,
        e.firstName,
        e.middleName,
        e.lastName,
        e.institution.code,
        e.campus?.code,
        e.department?.code,
        e.designation?.code,
        e.employmentType,
        e.status,
        e.workEmail,
        e.workPhone,
        dateStrOrNull(e.dateOfJoining),
        dateStrOrNull(e.exitDate),
        e.reportingManager?.employeeCode,
      ]),
    ]);
  },
};
