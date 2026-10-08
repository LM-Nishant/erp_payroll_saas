import { randomUUID } from 'node:crypto';
import type {
  CreatePayrollBatchInput,
  CreatePayrollRunInput,
  ListPayrollRunsQuery,
  PayrollBatchDto,
  PayrollRunDto,
  PayrollRunEmployeeDto,
  createPayrollAdjustmentSchema,
  markPaymentsPaidSchema,
  paginationQuerySchema,
} from '@erp/shared';
import type { Employee, PayrollRun, Prisma } from '@prisma/client';
import type { z } from 'zod';
import { audit } from '../../core/audit';
import { currentPrincipal, hasPermission, tryGetPrincipal } from '../../core/authz';
import { emit } from '../../core/events';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  InvalidReferenceError,
  NotFoundError,
} from '../../core/http/errors';
import { toListResponse, toPageWindow } from '../../core/http/pagination';
import { enqueue, type TenantJobData } from '../../core/queue';
import { currentOrganizationId, tenantDb, withTenant } from '../../core/tenancy';
import { submitWorkflow, type WorkflowInstanceRef } from '../../core/workflow';
import { attendanceSummaryForPeriod } from '../attendance/attendance.summary';
import { round2, strToDate } from '../attendance/time';
import { employeeAssignmentAsOf } from '../employees/employees.assignment';
import { dateStr } from '../employees/employees.mappers';
import { decryptSensitive } from '../employees/employees.sensitive';
import { notify } from '../employees/employees.service';
import { PayrollEngineError, type EngineAdjustment } from './engine';
import {
  ComputeCache,
  attendanceBasis,
  computeEmployee,
  encashmentDaysFor,
  salarySnapshot,
} from './payroll.compute';
import {
  CLOSED_RUN_STATUSES,
  COMPUTE_BATCH_JOB,
  COMPUTE_BATCH_SIZE,
  GENERATE_PAYSLIPS_JOB,
  PAYROLL_EVENTS,
  PAYROLL_NOTIFICATIONS,
  PAYROLL_RUN_WORKFLOW,
} from './payroll.constants';
import {
  assertInstitutionVisible,
  authorizeInstitution,
  institutionFilter,
  institutionIdsFor,
} from './payroll.access';
import { settingsFor } from './payroll.masters';
import { num, toAdjustmentDto, toPaymentDto, toRunDto, toRunEmployeeDto } from './payroll.mappers';

/*
 * Payroll runs (§17). Lifecycle:
 *   DRAFT → (attendance lock check) → COMPUTING (queue jobs per employee batch) → COMPUTED
 *   → PENDING_APPROVAL (workflow `payroll_run`) → APPROVED → FINALIZED (payments + payslips)
 *   → REOPENED (explicit, audited, with reason) ⇒ new DRAFT run with revision + 1.
 * Re-compute is only possible before submission; once submitted the DB triggers reject any
 * change to items / run employees / run adjustments / run figures (acceptance 14-15).
 */

const db = () => tenantDb();
const userId = () => tryGetPrincipal()?.userId ?? null;
const json = (v: unknown) => v as Prisma.InputJsonValue;

type AdjustmentInput = z.output<typeof createPayrollAdjustmentSchema>;
type MarkPaidInput = z.output<typeof markPaymentsPaidSchema>;
type PageQuery = z.output<typeof paginationQuerySchema>;

export interface ComputeBatchJob extends TenantJobData {
  runId: string;
  token: string;
  employeeIds: string[];
}

export interface PayslipJob extends TenantJobData {
  runId: string;
}

export interface PayslipRefreshJob extends TenantJobData {
  runId: string;
  requestedByUserId: string | null;
}

const RELEASABLE_SOURCES = ['manual', 'arrear', 'reimbursement'];
const PAYABLE_EMPLOYEE_STATUSES = ['ACTIVE', 'ON_NOTICE', 'EXITED'] as const;

const ADJUSTMENT_DEFAULT_CODES: Record<string, string> = {
  EARNING: 'ADHOC_EARN',
  DEDUCTION: 'ADHOC_DED',
  ARREAR: 'ARREARS',
  REIMBURSEMENT: 'REIMB',
};

function invalidState(run: PayrollRun, action: string): AppError {
  return new AppError(
    409,
    'INVALID_STATE',
    `Cannot ${action} a payroll run that is ${run.status.toLowerCase().replace('_', ' ')}`,
  );
}

async function institutionNames(ids: string[]): Promise<Map<string, string>> {
  const rows = await db().institution.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function runDto(run: PayrollRun): Promise<PayrollRunDto> {
  const names = await institutionNames([run.institutionId]);
  return toRunDto(run, names.get(run.institutionId));
}

/** Load a run visible to the caller under `permission` (404 otherwise). */
export async function loadRun(id: string, permission: string): Promise<PayrollRun> {
  const run = await db().payrollRun.findFirst({ where: { id } });
  if (!run || !hasPermission(currentPrincipal(), permission)) {
    throw new NotFoundError('Payroll run');
  }
  await assertInstitutionVisible(run.institutionId, permission, 'Payroll run');
  return run;
}

/** Authorize `permission` on an already loaded run (403 when visible but not allowed). */
async function requireOnRun(run: PayrollRun, permission: string): Promise<void> {
  await authorizeInstitution(run.institutionId, permission);
}

async function assertNoActiveRun(
  institutionId: string,
  periodStart: string,
  periodEnd: string,
): Promise<void> {
  const existing = await db().payrollRun.findFirst({
    where: {
      institutionId,
      status: { notIn: CLOSED_RUN_STATUSES },
      periodStart: { lte: strToDate(periodEnd) },
      periodEnd: { gte: strToDate(periodStart) },
    },
  });
  if (existing) {
    throw new ConflictError('A payroll run already exists for this institution and period', {
      code: 'PAYROLL_RUN_EXISTS',
      runId: existing.id,
    });
  }
}

const defaultLabel = (periodStart: string) => {
  const d = strToDate(periodStart);
  return `Payroll ${d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
};

/* --------------------------------- Compute ---------------------------------------------- */

/** Employees assigned to the institution at any time in the period (payable statuses). */
async function candidateEmployeeIds(run: PayrollRun): Promise<string[]> {
  const rows = await db().employeeDepartment.findMany({
    where: {
      institutionId: run.institutionId,
      isPrimary: true,
      effectiveFrom: { lte: run.periodEnd },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: run.periodStart } }],
    },
    select: { employeeId: true },
  });
  const ids = [...new Set(rows.map((r) => r.employeeId))];
  if (ids.length === 0) return [];
  const employees = await db().employee.findMany({
    where: { id: { in: ids }, status: { in: [...PAYABLE_EMPLOYEE_STATUSES] } },
    select: { id: true },
    orderBy: { employeeCode: 'asc' },
  });
  return employees.map((e) => e.id);
}

/** Drop computed data of a not-yet-submitted run and release claimed adjustments. */
type Tx = Parameters<Parameters<ReturnType<typeof tenantDb>['$transaction']>[0]>[0];

async function resetRunData(tx: Tx, runId: string): Promise<void> {
  await tx.payrollItem.deleteMany({ where: { runId } });
  await tx.payrollRunEmployee.deleteMany({ where: { runId } });
  await tx.payrollAdjustment.deleteMany({
    where: { runId, source: { in: ['loan', 'encashment'] } },
  });
  await tx.payrollAdjustment.updateMany({
    where: { runId, status: 'APPLIED' },
    data: { runId: null, status: 'PENDING' },
  });
  await tx.payrollAdjustment.updateMany({
    where: { runId, status: 'CANCELLED' },
    data: { runId: null },
  });
}

async function startCompute(run: PayrollRun): Promise<void> {
  const settings = await settingsFor(run.institutionId);
  const lock = await db().attendancePeriodLock.findFirst({
    where: {
      institutionId: run.institutionId,
      status: 'LOCKED',
      periodStart: { lte: run.periodStart },
      periodEnd: { gte: run.periodEnd },
    },
  });
  if (settings.requireAttendanceLock && !lock) {
    throw new AppError(
      409,
      'ATTENDANCE_NOT_LOCKED',
      `Attendance for ${dateStr(run.periodStart)}..${dateStr(run.periodEnd)} must be locked before payroll is computed`,
    );
  }
  const employeeIds = await candidateEmployeeIds(run);
  const batches: string[][] = [];
  for (let i = 0; i < employeeIds.length; i += COMPUTE_BATCH_SIZE) {
    batches.push(employeeIds.slice(i, i + COMPUTE_BATCH_SIZE));
  }
  const token = randomUUID();
  await db().$transaction(async (tx) => {
    await resetRunData(tx, run.id);
    await tx.payrollRun.update({
      where: { id: run.id },
      data: {
        status: batches.length ? 'COMPUTING' : 'COMPUTED',
        computeToken: token,
        pendingBatches: batches.length,
        attendanceLocked: !!lock,
        employeeCount: 0,
        errorCount: 0,
        grossTotal: 0,
        deductionTotal: 0,
        netTotal: 0,
        employerTotal: 0,
        computedAt: batches.length ? null : new Date(),
      },
    });
  });
  await audit.record({
    action: 'payroll.run.compute',
    entityType: 'payroll_run',
    entityId: run.id,
    metadata: { employees: employeeIds.length, batches: batches.length, attendanceLocked: !!lock },
  });
  if (!batches.length) {
    await emitRun(PAYROLL_EVENTS.runComputed, run.id);
    return;
  }
  const organizationId = currentOrganizationId();
  for (const [i, ids] of batches.entries()) {
    await enqueue<ComputeBatchJob>(
      COMPUTE_BATCH_JOB,
      { organizationId, runId: run.id, token, employeeIds: ids },
      { jobId: `${run.id}:${token}:${i}` },
    );
  }
}

/** Queue job: compute one batch of employees of a COMPUTING run. */
export async function computeBatchJob(data: ComputeBatchJob): Promise<void> {
  const run = await db().payrollRun.findFirst({
    where: { id: data.runId, computeToken: data.token, status: 'COMPUTING' },
  });
  if (!run) return; // superseded by a newer compute / cancelled
  const periodStart = dateStr(run.periodStart);
  const periodEnd = dateStr(run.periodEnd);
  const [summaries, employees, encashment] = await Promise.all([
    attendanceSummaryForPeriod({ employeeIds: data.employeeIds }, periodStart, periodEnd),
    db().employee.findMany({ where: { id: { in: data.employeeIds } } }),
    encashmentDaysFor(data.employeeIds, periodStart, periodEnd),
  ]);
  const summaryById = new Map(summaries.map((s) => [s.employeeId, s]));
  const cache = new ComputeCache();
  // Already written employees (job retry) are skipped.
  const done = new Set(
    (
      await db().payrollRunEmployee.findMany({
        where: { runId: run.id, employeeId: { in: data.employeeIds } },
        select: { employeeId: true },
      })
    ).map((r) => r.employeeId),
  );
  for (const employee of employees) {
    if (done.has(employee.id)) continue;
    await computeRunEmployee(run, employee, summaryById.get(employee.id), encashment, cache);
  }
  await finishBatch(run.id, data.token);
}

async function computeRunEmployee(
  run: PayrollRun,
  employee: Employee,
  summary: Awaited<ReturnType<typeof attendanceSummaryForPeriod>>[number] | undefined,
  encashment: Map<string, number>,
  cache: ComputeCache,
): Promise<void> {
  const periodStart = dateStr(run.periodStart);
  const periodEnd = dateStr(run.periodEnd);
  if (!summary || summary.employedDays <= 0) return;
  const assignment =
    (await employeeAssignmentAsOf(employee.id, periodEnd)) ??
    (await employeeAssignmentAsOf(employee.id, periodStart));
  const endInstitution = assignment?.institutionId ?? null;
  const basis = attendanceBasis(summary, run.institutionId, endInstitution);
  if (basis.institutionDays <= 0) return;

  const base = {
    runId: run.id,
    employeeId: employee.id,
    institutionId: run.institutionId,
    departmentId: assignment?.institutionId === run.institutionId ? assignment.departmentId : null,
    employeeCode: employee.employeeCode,
    employeeName: employee.displayName,
    calendarDays: basis.calendarDays,
    payableDays: basis.payableDays,
    lopDays: basis.lopDays,
    institutionDays: basis.institutionDays,
    factor: basis.factor,
  };
  const salary = await salarySnapshot(employee.id, periodEnd);
  if (!salary) {
    await db().payrollRunEmployee.create({
      data: withTenant({
        ...base,
        status: 'SKIPPED',
        error: `No salary is assigned as of ${periodEnd}`,
        trace: json([]),
        warnings: json(basis.warnings),
      }),
    });
    return;
  }

  // Loan EMIs are deducted by the institution the employee belongs to at period end.
  const loanAdjustments: Prisma.PayrollAdjustmentCreateManyInput[] = [];
  if (endInstitution === run.institutionId) {
    const monthStart = strToDate(`${periodStart.slice(0, 7)}-01`);
    const installments = await db().loanInstallment.findMany({
      where: {
        employeeId: employee.id,
        status: 'DUE',
        dueMonth: { gte: monthStart, lte: run.periodEnd },
      },
    });
    const loans = installments.length
      ? await db().loan.findMany({
          where: { id: { in: installments.map((i) => i.loanId) }, status: 'ACTIVE' },
        })
      : [];
    const loanById = new Map(loans.map((l) => [l.id, l]));
    for (const inst of installments) {
      const loan = loanById.get(inst.loanId);
      if (!loan) continue;
      loanAdjustments.push(
        withTenant({
          runId: run.id,
          employeeId: employee.id,
          institutionId: run.institutionId,
          type: 'LOAN_EMI',
          code: 'LOAN_EMI',
          amount: inst.amount,
          taxable: false,
          description: `${loan.loanType} EMI (${dateStr(inst.dueMonth).slice(0, 7)})`,
          source: 'loan',
          sourceId: inst.id,
          status: 'APPLIED',
          createdByUserId: null,
        }),
      );
    }
  }
  const pending = await db().payrollAdjustment.findMany({
    where: {
      employeeId: employee.id,
      institutionId: run.institutionId,
      runId: null,
      status: 'PENDING',
    },
  });
  const engineAdjustments: EngineAdjustment[] = [...pending, ...loanAdjustments].map((a) => ({
    type: a.type as EngineAdjustment['type'],
    code: a.code,
    amount: Number(a.amount),
    taxable: a.taxable ?? true,
    description: a.description,
  }));

  try {
    const { result, structureVersionId, encashmentAmount } = await computeEmployee(
      {
        institutionId: run.institutionId,
        periodStart,
        periodEnd,
        salary,
        basis,
        employmentType: assignment?.employmentType ?? null,
        adjustments: engineAdjustments,
        encashmentDays: endInstitution === run.institutionId ? encashment.get(employee.id) : 0,
      },
      cache,
    );
    await db().$transaction(async (tx) => {
      const re = await tx.payrollRunEmployee.create({
        data: withTenant({
          ...base,
          status: 'OK',
          gross: result.gross,
          deductions: result.deductions,
          net: result.net,
          employerContributions: result.employerContributions,
          salaryHistoryId: salary.salaryHistoryId,
          structureVersionId,
          trace: json(result.trace),
          warnings: json(result.warnings),
        }),
      });
      if (result.lines.length) {
        await tx.payrollItem.createMany({
          data: result.lines.map((l) =>
            withTenant({
              runId: run.id,
              runEmployeeId: re.id,
              employeeId: employee.id,
              code: l.code,
              name: l.name,
              type: l.type,
              category: l.category,
              statutoryCode: l.statutoryCode,
              amount: l.amount,
              fullAmount: l.fullAmount,
              taxable: l.taxable,
              showOnPayslip: l.showOnPayslip,
              displayOrder: l.displayOrder,
              explanation: l.explanation.slice(0, 1000),
            }),
          ),
        });
      }
      if (pending.length) {
        await tx.payrollAdjustment.updateMany({
          where: { id: { in: pending.map((p) => p.id) }, runId: null, status: 'PENDING' },
          data: { runId: run.id, status: 'APPLIED' },
        });
      }
      if (loanAdjustments.length) await tx.payrollAdjustment.createMany({ data: loanAdjustments });
      if (encashmentAmount > 0) {
        await tx.payrollAdjustment.create({
          data: withTenant({
            runId: run.id,
            employeeId: employee.id,
            institutionId: run.institutionId,
            type: 'ENCASHMENT',
            code: 'LEAVE_ENCASH',
            amount: encashmentAmount,
            taxable: true,
            description: 'Leave encashment',
            source: 'encashment',
            status: 'APPLIED',
          }),
        });
      }
    });
  } catch (err) {
    if (!(err instanceof PayrollEngineError)) throw err;
    await db().payrollRunEmployee.create({
      data: withTenant({
        ...base,
        status: 'ERROR',
        error: err.message.slice(0, 1000),
        salaryHistoryId: salary.salaryHistoryId,
        trace: json([]),
        warnings: json(basis.warnings),
      }),
    });
  }
}

async function finishBatch(runId: string, token: string): Promise<void> {
  const dec = await db().payrollRun.updateMany({
    where: { id: runId, computeToken: token, status: 'COMPUTING', pendingBatches: { gt: 0 } },
    data: { pendingBatches: { decrement: 1 } },
  });
  if (dec.count === 0) return;
  const run = await db().payrollRun.findFirst({ where: { id: runId } });
  if (!run || run.pendingBatches > 0) return;
  const [ok, errors, employees] = await Promise.all([
    db().payrollRunEmployee.aggregate({
      where: { runId, status: 'OK' },
      _sum: { gross: true, deductions: true, net: true, employerContributions: true },
    }),
    db().payrollRunEmployee.count({ where: { runId, status: 'ERROR' } }),
    db().payrollRunEmployee.count({ where: { runId } }),
  ]);
  const done = await db().payrollRun.updateMany({
    where: { id: runId, computeToken: token, status: 'COMPUTING', pendingBatches: 0 },
    data: {
      status: 'COMPUTED',
      computedAt: new Date(),
      employeeCount: employees,
      errorCount: errors,
      grossTotal: round2(num(ok._sum.gross)),
      deductionTotal: round2(num(ok._sum.deductions)),
      netTotal: round2(num(ok._sum.net)),
      employerTotal: round2(num(ok._sum.employerContributions)),
    },
  });
  if (done.count) await emitRun(PAYROLL_EVENTS.runComputed, runId);
}

async function emitRun(event: string, runId: string, extra: Record<string, unknown> = {}) {
  const run = await db().payrollRun.findFirst({ where: { id: runId } });
  if (!run) return;
  await emit(
    event,
    {
      runId: run.id,
      institutionId: run.institutionId,
      periodStart: dateStr(run.periodStart),
      periodEnd: dateStr(run.periodEnd),
      revision: run.revision,
      status: run.status,
      employeeCount: run.employeeCount,
      netTotal: num(run.netTotal),
      ...extra,
    },
    { institutionId: run.institutionId },
  );
}

/* --------------------------------- Approval callbacks ----------------------------------- */

async function decide(
  ref: Pick<WorkflowInstanceRef, 'entityId' | 'comment'>,
  approved: boolean,
): Promise<void> {
  const run = await db().payrollRun.findFirst({ where: { id: ref.entityId } });
  if (!run || run.status !== 'PENDING_APPROVAL') return;
  await db().payrollRun.update({
    where: { id: run.id },
    data: approved
      ? { status: 'APPROVED', approvedAt: new Date() }
      : { status: 'COMPUTED', submittedAt: null, workflowInstanceId: null },
  });
  await audit.record({
    action: approved ? 'payroll.run.approve' : 'payroll.run.reject',
    entityType: 'payroll_run',
    entityId: run.id,
    before: { status: run.status },
    after: { status: approved ? 'APPROVED' : 'COMPUTED' },
    reason: ref.comment ?? undefined,
  });
  if (approved) await emitRun(PAYROLL_EVENTS.runApproved, run.id);
}

export const payrollRunWorkflowCallbacks = {
  linkFor: (ref: { entityId: string }) => `/payroll/runs/${ref.entityId}`,
  onApproved: (ref: WorkflowInstanceRef) => decide(ref, true),
  onRejected: (ref: WorkflowInstanceRef) => decide(ref, false),
  onCancelled: (ref: WorkflowInstanceRef) => decide(ref, false),
};

/* --------------------------------- Service ---------------------------------------------- */

export const runService = {
  async list(query: ListPayrollRunsQuery) {
    const ids = await institutionIdsFor('payroll.view');
    const where: Prisma.PayrollRunWhereInput = {
      ...institutionFilter(ids),
      ...(query.institutionId ? { institutionId: query.institutionId } : {}),
      ...(query.batchId ? { batchId: query.batchId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.periodStart ? { periodStart: strToDate(query.periodStart) } : {}),
    };
    const [rows, total] = await Promise.all([
      db().payrollRun.findMany({
        where,
        orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
        ...toPageWindow(query),
      }),
      db().payrollRun.count({ where }),
    ]);
    const names = await institutionNames(rows.map((r) => r.institutionId));
    return toListResponse(
      rows.map((r) => toRunDto(r, names.get(r.institutionId))),
      total,
      query,
    );
  },

  async get(id: string): Promise<PayrollRunDto> {
    return runDto(await loadRun(id, 'payroll.view'));
  },

  async create(input: CreatePayrollRunInput): Promise<PayrollRunDto> {
    const inst = await authorizeInstitution(input.institutionId, 'payroll.process');
    await assertNoActiveRun(inst.id, input.periodStart, input.periodEnd);
    const run = await db().payrollRun.create({
      data: withTenant({
        institutionId: inst.id,
        groupId: inst.groupId,
        periodStart: strToDate(input.periodStart),
        periodEnd: strToDate(input.periodEnd),
        label: input.label ?? defaultLabel(input.periodStart),
        createdByUserId: userId(),
      }),
    });
    await audit.record({
      action: 'payroll.run.create',
      entityType: 'payroll_run',
      entityId: run.id,
      after: { institutionId: inst.id, periodStart: input.periodStart, periodEnd: input.periodEnd },
    });
    return toRunDto(run, inst.name);
  },

  async compute(id: string): Promise<PayrollRunDto> {
    const run = await loadRun(id, 'payroll.view');
    await requireOnRun(run, 'payroll.process');
    if (run.status !== 'DRAFT' && run.status !== 'COMPUTED') throw invalidState(run, 'compute');
    await startCompute(run);
    return runDto(await db().payrollRun.findFirstOrThrow({ where: { id } }));
  },

  async employees(id: string, query: PageQuery & { status?: string }) {
    const run = await loadRun(id, 'payroll.view');
    const where: Prisma.PayrollRunEmployeeWhereInput = {
      runId: run.id,
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      db().payrollRunEmployee.findMany({
        where,
        orderBy: { employeeCode: 'asc' },
        ...toPageWindow(query),
      }),
      db().payrollRunEmployee.count({ where }),
    ]);
    const items = await db().payrollItem.findMany({
      where: { runEmployeeId: { in: rows.map((r) => r.id) } },
    });
    return toListResponse(
      rows.map((r) =>
        toRunEmployeeDto(
          r,
          items.filter((i) => i.runEmployeeId === r.id),
        ),
      ),
      total,
      query,
    );
  },

  /** Per-employee drill-down with the full calculation trace. */
  async employee(id: string, employeeId: string): Promise<PayrollRunEmployeeDto> {
    const run = await loadRun(id, 'payroll.view');
    const re = await db().payrollRunEmployee.findFirst({ where: { runId: run.id, employeeId } });
    if (!re) throw new NotFoundError('Payroll run employee');
    const items = await db().payrollItem.findMany({ where: { runEmployeeId: re.id } });
    return toRunEmployeeDto(re, items, true);
  },

  async items(id: string, employeeId?: string) {
    const run = await loadRun(id, 'payroll.view');
    const items = await db().payrollItem.findMany({
      where: { runId: run.id, ...(employeeId ? { employeeId } : {}) },
      orderBy: [{ employeeId: 'asc' }, { displayOrder: 'asc' }],
    });
    return items.map((i) => ({
      employeeId: i.employeeId,
      code: i.code,
      name: i.name,
      type: i.type,
      category: i.category,
      amount: num(i.amount),
      fullAmount: num(i.fullAmount),
      explanation: i.explanation,
    }));
  },

  async submit(id: string): Promise<PayrollRunDto> {
    const run = await loadRun(id, 'payroll.view');
    await requireOnRun(run, 'payroll.process');
    if (run.status !== 'COMPUTED') throw invalidState(run, 'submit');
    if (run.errorCount > 0) {
      throw new AppError(
        409,
        'PAYROLL_HAS_ERRORS',
        `${run.errorCount} employee(s) failed to compute; fix and re-compute before submitting`,
      );
    }
    if (run.employeeCount === 0) {
      throw new AppError(409, 'PAYROLL_EMPTY', 'The payroll run has no employees');
    }
    const principal = currentPrincipal();
    await db().payrollRun.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL', submittedAt: new Date() },
    });
    await audit.record({
      action: 'payroll.run.submit',
      entityType: 'payroll_run',
      entityId: id,
      before: { status: run.status },
      after: { status: 'PENDING_APPROVAL', netTotal: num(run.netTotal) },
    });
    const instance = await submitWorkflow({
      entityType: PAYROLL_RUN_WORKFLOW,
      entityId: id,
      title: `${run.label} (revision ${run.revision})`,
      requesterUserId: principal.userId,
      institutionId: run.institutionId,
      groupId: run.groupId,
      context: {
        institutionId: run.institutionId,
        periodStart: dateStr(run.periodStart),
        periodEnd: dateStr(run.periodEnd),
        employeeCount: run.employeeCount,
        netTotal: num(run.netTotal),
        grossTotal: num(run.grossTotal),
      },
    });
    if (instance) {
      await db().payrollRun.updateMany({
        where: { id, workflowInstanceId: null },
        data: { workflowInstanceId: instance.id },
      });
    }
    return runDto(await db().payrollRun.findFirstOrThrow({ where: { id } }));
  },

  /** Direct approval — only when no workflow definition governs `payroll_run`. */
  async approve(id: string, approved: boolean, comment?: string): Promise<PayrollRunDto> {
    const run = await loadRun(id, 'payroll.view');
    await requireOnRun(run, 'payroll.approve');
    if (run.status !== 'PENDING_APPROVAL') throw invalidState(run, approved ? 'approve' : 'reject');
    if (run.workflowInstanceId) {
      throw new AppError(
        409,
        'WORKFLOW_MANAGED',
        'This payroll run is approved through its workflow; act on the workflow instance',
      );
    }
    if (approved && run.createdByUserId && run.createdByUserId === userId()) {
      // Maker-checker: the preparer cannot approve their own payroll (unless org owner).
      if (!hasPermission(currentPrincipal(), 'organization.update')) {
        throw new ForbiddenError(
          'The preparer of a payroll run cannot approve it',
          'MAKER_CHECKER',
        );
      }
    }
    await decide({ entityId: id, comment: comment ?? null }, approved);
    return runDto(await db().payrollRun.findFirstOrThrow({ where: { id } }));
  },

  async finalize(id: string): Promise<PayrollRunDto> {
    const run = await loadRun(id, 'payroll.view');
    await requireOnRun(run, 'payroll.lock');
    if (run.status !== 'APPROVED') throw invalidState(run, 'finalize');
    const ok = await db().payrollRunEmployee.findMany({ where: { runId: id, status: 'OK' } });
    const loanAdjustments = await db().payrollAdjustment.findMany({
      where: { runId: id, source: 'loan', status: 'APPLIED' },
    });
    await db().$transaction(async (tx) => {
      await tx.payrollRun.update({
        where: { id },
        data: { status: 'FINALIZED', finalizedAt: new Date(), finalizedByUserId: userId() },
      });
      const payable = ok.filter((e) => num(e.net) > 0);
      if (payable.length) {
        await tx.payrollPayment.createMany({
          data: payable.map((e) =>
            withTenant({ runId: id, employeeId: e.employeeId, amount: e.net }),
          ),
          skipDuplicates: true,
        });
      }
      for (const adj of loanAdjustments) {
        if (!adj.sourceId) continue;
        const inst = await tx.loanInstallment.findFirst({ where: { id: adj.sourceId } });
        if (!inst || inst.status !== 'DUE') continue;
        await tx.loanInstallment.update({
          where: { id: inst.id },
          data: { status: 'DEDUCTED', runId: id },
        });
        const loan = await tx.loan.findFirstOrThrow({ where: { id: inst.loanId } });
        const outstanding = Math.max(0, round2(num(loan.outstanding) - num(inst.amount)));
        await tx.loan.update({
          where: { id: loan.id },
          data: { outstanding, status: outstanding <= 0 ? 'CLOSED' : loan.status },
        });
      }
    });
    await audit.record({
      action: 'payroll.run.finalize',
      entityType: 'payroll_run',
      entityId: id,
      before: { status: run.status },
      after: { status: 'FINALIZED', netTotal: num(run.netTotal), employees: ok.length },
    });
    await enqueue<PayslipJob>(
      GENERATE_PAYSLIPS_JOB,
      { organizationId: currentOrganizationId(), runId: id },
      { jobId: `payslips:${id}` },
    );
    await emitRun(PAYROLL_EVENTS.runFinalized, id);
    await notify(PAYROLL_NOTIFICATIONS.runFinalized, [run.createdByUserId], {
      title: `${run.label} finalized`,
      body: `Net payout ${num(run.netTotal).toFixed(2)} for ${ok.length} employee(s).`,
      link: `/payroll/runs/${id}`,
      institutionId: run.institutionId,
    });
    return runDto(await db().payrollRun.findFirstOrThrow({ where: { id } }));
  },

  /**
   * Explicit, audited reopen of a FINALIZED run (acceptance 15). The finalized run is kept
   * read-only (status REOPENED); corrections happen on a NEW draft run with revision + 1.
   */
  async reopen(id: string, reason: string): Promise<PayrollRunDto> {
    const run = await loadRun(id, 'payroll.view');
    await requireOnRun(run, 'payroll.reopen');
    if (run.status !== 'FINALIZED') throw invalidState(run, 'reopen');
    const carry = await db().payrollAdjustment.findMany({
      where: { runId: id, status: 'APPLIED', source: { in: RELEASABLE_SOURCES } },
    });
    const deducted = await db().loanInstallment.findMany({
      where: { runId: id, status: 'DEDUCTED' },
    });
    const now = new Date();
    const next = await db().$transaction(async (tx) => {
      await tx.payrollRun.update({
        where: { id },
        data: {
          status: 'REOPENED',
          reopenedAt: now,
          reopenReason: reason,
          reopenedByUserId: userId(),
        },
      });
      const created = await tx.payrollRun.create({
        data: withTenant({
          institutionId: run.institutionId,
          groupId: run.groupId,
          batchId: run.batchId,
          periodStart: run.periodStart,
          periodEnd: run.periodEnd,
          label: run.label,
          revision: run.revision + 1,
          previousRunId: run.id,
          createdByUserId: userId(),
        }),
      });
      if (carry.length) {
        await tx.payrollAdjustment.createMany({
          data: carry.map((a) =>
            withTenant({
              employeeId: a.employeeId,
              institutionId: a.institutionId,
              type: a.type,
              code: a.code,
              amount: a.amount,
              taxable: a.taxable,
              description: a.description,
              source: a.source,
              sourceId: a.sourceId,
              status: 'PENDING',
              createdByUserId: a.createdByUserId,
            }),
          ),
        });
      }
      for (const inst of deducted) {
        await tx.loanInstallment.update({
          where: { id: inst.id },
          data: { status: 'DUE', runId: null },
        });
        const loan = await tx.loan.findFirstOrThrow({ where: { id: inst.loanId } });
        await tx.loan.update({
          where: { id: loan.id },
          data: {
            outstanding: round2(num(loan.outstanding) + num(inst.amount)),
            status: loan.status === 'CLOSED' ? 'ACTIVE' : loan.status,
          },
        });
      }
      await tx.payslip.updateMany({ where: { runId: id }, data: { status: 'SUPERSEDED' } });
      await tx.payrollPayment.updateMany({
        where: { runId: id, status: { in: ['PENDING', 'EXPORTED'] } },
        data: { status: 'CANCELLED' },
      });
      return created;
    });
    await audit.record({
      action: 'payroll.run.reopen',
      entityType: 'payroll_run',
      entityId: id,
      before: { status: 'FINALIZED', revision: run.revision },
      after: { status: 'REOPENED', newRunId: next.id, newRevision: next.revision },
      reason,
    });
    await emitRun(PAYROLL_EVENTS.runReopened, id, { reason, newRunId: next.id });
    return runDto(next);
  },

  async cancel(id: string): Promise<PayrollRunDto> {
    const run = await loadRun(id, 'payroll.view');
    await requireOnRun(run, 'payroll.process');
    if (!['DRAFT', 'COMPUTED', 'COMPUTING'].includes(run.status)) throw invalidState(run, 'cancel');
    await db().$transaction(async (tx) => {
      await resetRunData(tx, id);
      await tx.payrollRun.update({
        where: { id },
        data: { status: 'CANCELLED', computeToken: null, pendingBatches: 0 },
      });
    });
    await audit.record({
      action: 'payroll.run.cancel',
      entityType: 'payroll_run',
      entityId: id,
      before: { status: run.status },
      after: { status: 'CANCELLED' },
    });
    return runDto(await db().payrollRun.findFirstOrThrow({ where: { id } }));
  },
};

/* --------------------------------- Group batches (§53) ---------------------------------- */

export const batchService = {
  async create(input: CreatePayrollBatchInput): Promise<PayrollBatchDto> {
    const group = await db().group.findFirst({ where: { id: input.groupId } });
    if (!group) throw new InvalidReferenceError('groupId', 'Group');
    const allowed = await institutionIdsFor('payroll.process');
    const institutions = await db().institution.findMany({
      where: {
        groupId: group.id,
        status: 'ACTIVE',
        ...(input.institutionIds ? { id: { in: input.institutionIds } } : {}),
        ...institutionFilter(allowed, 'id'),
      },
      orderBy: { code: 'asc' },
    });
    if (input.institutionIds && institutions.length !== new Set(input.institutionIds).size) {
      throw new ForbiddenError(
        'Some institutions are outside the group or your payroll scope',
        'SCOPE_DENIED',
      );
    }
    if (!institutions.length) {
      throw new ForbiddenError('No institution of this group is within your payroll scope');
    }
    for (const inst of institutions) {
      await assertNoActiveRun(inst.id, input.periodStart, input.periodEnd);
    }
    const label = input.label ?? `${group.name} ${defaultLabel(input.periodStart)}`;
    const batch = await db().$transaction(async (tx) => {
      const b = await tx.payrollBatch.create({
        data: withTenant({
          groupId: group.id,
          periodStart: strToDate(input.periodStart),
          periodEnd: strToDate(input.periodEnd),
          label,
          createdByUserId: userId(),
        }),
      });
      for (const inst of institutions) {
        await tx.payrollRun.create({
          data: withTenant({
            institutionId: inst.id,
            groupId: group.id,
            batchId: b.id,
            periodStart: strToDate(input.periodStart),
            periodEnd: strToDate(input.periodEnd),
            label: `${inst.code} ${defaultLabel(input.periodStart)}`,
            createdByUserId: userId(),
          }),
        });
      }
      return b;
    });
    await audit.record({
      action: 'payroll.batch.create',
      entityType: 'payroll_batch',
      entityId: batch.id,
      after: { groupId: group.id, institutions: institutions.map((i) => i.code), label },
    });
    return this.get(batch.id);
  },

  async get(id: string): Promise<PayrollBatchDto> {
    const batch = await db().payrollBatch.findFirst({ where: { id } });
    if (!batch) throw new NotFoundError('Payroll batch');
    const ids = await institutionIdsFor('payroll.view');
    const runs = await db().payrollRun.findMany({
      where: { batchId: id, ...institutionFilter(ids) },
      orderBy: [{ institutionId: 'asc' }, { revision: 'asc' }],
    });
    if (!runs.length) throw new NotFoundError('Payroll batch');
    const names = await institutionNames(runs.map((r) => r.institutionId));
    return {
      id: batch.id,
      groupId: batch.groupId,
      periodStart: dateStr(batch.periodStart),
      periodEnd: dateStr(batch.periodEnd),
      label: batch.label,
      runs: runs.map((r) => toRunDto(r, names.get(r.institutionId))),
      createdAt: batch.createdAt.toISOString(),
    };
  },

  /** Compute every draft / computed run of the batch the caller may process. */
  async compute(id: string): Promise<PayrollBatchDto> {
    const dto = await this.get(id);
    const allowed = await institutionIdsFor('payroll.process');
    for (const r of dto.runs) {
      if (r.status !== 'DRAFT' && r.status !== 'COMPUTED') continue;
      if (allowed && !allowed.includes(r.institutionId)) continue;
      await startCompute(await db().payrollRun.findFirstOrThrow({ where: { id: r.id } }));
    }
    return this.get(id);
  },
};

/* --------------------------------- Adjustments ------------------------------------------ */

export const adjustmentService = {
  async list(runId: string) {
    const run = await loadRun(runId, 'payroll.view');
    const rows = await db().payrollAdjustment.findMany({
      where: {
        institutionId: run.institutionId,
        OR: [
          { runId: run.id },
          ...(['DRAFT', 'COMPUTED'].includes(run.status)
            ? [{ runId: null, status: 'PENDING' }]
            : []),
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toAdjustmentDto);
  },

  /**
   * One-time earning / deduction / arrear / reimbursement for the run's institution. Stored as
   * PENDING; it is applied by the next compute of the run (re-compute to see the effect).
   */
  async create(runId: string, input: AdjustmentInput) {
    const run = await loadRun(runId, 'payroll.view');
    await requireOnRun(run, 'payroll.process');
    if (run.status !== 'DRAFT' && run.status !== 'COMPUTED') {
      throw invalidState(run, 'add adjustments to');
    }
    const employee = await db().employee.findFirst({ where: { id: input.employeeId } });
    if (!employee) throw new InvalidReferenceError('employeeId', 'Employee');
    const row = await db().payrollAdjustment.create({
      data: withTenant({
        employeeId: employee.id,
        institutionId: run.institutionId,
        type: input.type,
        code: input.code ?? ADJUSTMENT_DEFAULT_CODES[input.type]!,
        amount: input.amount,
        taxable: input.taxable,
        description: input.description,
        source: 'manual',
        status: 'PENDING',
        createdByUserId: userId(),
      }),
    });
    await audit.record({
      action: 'payroll.adjustment.create',
      entityType: 'payroll_adjustment',
      entityId: row.id,
      after: { runId, employeeId: employee.id, type: input.type, amount: input.amount },
    });
    return toAdjustmentDto(row);
  },

  async cancel(id: string) {
    const row = await db().payrollAdjustment.findFirst({ where: { id } });
    if (!row || !hasPermission(currentPrincipal(), 'payroll.process')) {
      throw new NotFoundError('Payroll adjustment');
    }
    await assertInstitutionVisible(row.institutionId, 'payroll.process', 'Payroll adjustment');
    if (row.status === 'CANCELLED') return toAdjustmentDto(row);
    if (row.source === 'loan' || row.source === 'encashment') {
      throw new AppError(409, 'INVALID_STATE', 'System adjustments are recomputed automatically');
    }
    if (row.runId) {
      const run = await db().payrollRun.findFirstOrThrow({ where: { id: row.runId } });
      if (run.status !== 'DRAFT' && run.status !== 'COMPUTED') {
        throw invalidState(run, 'change adjustments of');
      }
    }
    const updated = await db().payrollAdjustment.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    await audit.record({
      action: 'payroll.adjustment.cancel',
      entityType: 'payroll_adjustment',
      entityId: id,
      before: { status: row.status },
      after: { status: 'CANCELLED' },
    });
    return toAdjustmentDto(updated);
  },
};

/* --------------------------------- Payments --------------------------------------------- */

const csvCell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const maskAccount = (n: string) => `XXXX${n.slice(-4)}`;

export const paymentService = {
  async list(runId: string) {
    const run = await loadRun(runId, 'payroll.view');
    const rows = await db().payrollPayment.findMany({
      where: { runId: run.id },
      orderBy: { createdAt: 'asc' },
    });
    const employees = await db().employee.findMany({
      where: { id: { in: rows.map((r) => r.employeeId) } },
      select: { id: true, employeeCode: true },
    });
    const codes = new Map(employees.map((e) => [e.id, e.employeeCode]));
    return rows
      .map((p) => toPaymentDto(p, codes.get(p.employeeId)))
      .sort((a, b) => (a.employeeCode ?? '').localeCompare(b.employeeCode ?? ''));
  },

  /** Bank transfer file (CSV placeholder format). Decrypts bank details server-side; audited. */
  async exportBankFile(runId: string): Promise<{ fileName: string; content: string }> {
    const run = await loadRun(runId, 'payroll.view');
    await requireOnRun(run, 'payroll.disburse');
    if (run.status !== 'FINALIZED') throw invalidState(run, 'export payments of');
    const payments = await db().payrollPayment.findMany({
      where: { runId, status: { in: ['PENDING', 'EXPORTED'] } },
    });
    const ids = payments.map((p) => p.employeeId);
    const [employees, profiles] = await Promise.all([
      db().employee.findMany({ where: { id: { in: ids } } }),
      db().employeeProfile.findMany({ where: { employeeId: { in: ids } } }),
    ]);
    const empById = new Map(employees.map((e) => [e.id, e]));
    const profileById = new Map(profiles.map((p) => [p.employeeId, p]));
    const orgId = currentOrganizationId();
    const lines = [
      [
        'EmployeeCode',
        'EmployeeName',
        'AccountHolder',
        'AccountNumber',
        'IFSC',
        'BankName',
        'Amount',
        'Narration',
      ].join(','),
    ];
    let missing = 0;
    const period = dateStr(run.periodStart).slice(0, 7);
    for (const p of payments.sort((a, b) =>
      (empById.get(a.employeeId)?.employeeCode ?? '').localeCompare(
        empById.get(b.employeeId)?.employeeCode ?? '',
      ),
    )) {
      const e = empById.get(p.employeeId);
      const sensitive = await decryptSensitive(
        orgId,
        p.employeeId,
        profileById.get(p.employeeId) ?? null,
      );
      const bank = sensitive.bankAccount;
      if (!bank) missing += 1;
      lines.push(
        [
          e?.employeeCode,
          e?.displayName,
          bank?.accountHolderName,
          bank?.accountNumber,
          bank?.ifsc,
          bank?.bankName,
          num(p.amount).toFixed(2),
          `SALARY ${period}`,
        ]
          .map(csvCell)
          .join(','),
      );
      await db().payrollPayment.update({
        where: { id: p.id },
        data: {
          status: 'EXPORTED',
          bankAccountMasked: bank ? maskAccount(bank.accountNumber) : null,
        },
      });
    }
    await audit.record({
      action: 'payroll.bank_file.export',
      entityType: 'payroll_run',
      entityId: runId,
      metadata: { payments: payments.length, missingBankDetails: missing, sensitive: true },
    });
    return { fileName: `bank-transfer-${period}-r${run.revision}.csv`, content: lines.join('\n') };
  },

  async markPaid(runId: string, input: MarkPaidInput) {
    const run = await loadRun(runId, 'payroll.view');
    await requireOnRun(run, 'payroll.disburse');
    if (run.status !== 'FINALIZED') throw invalidState(run, 'pay');
    const res = await db().payrollPayment.updateMany({
      where: {
        runId,
        status: { in: ['PENDING', 'EXPORTED'] },
        ...(input.paymentIds ? { id: { in: input.paymentIds } } : {}),
      },
      data: {
        status: 'PAID',
        reference: input.reference,
        paidAt: input.paidOn ? strToDate(input.paidOn) : new Date(),
      },
    });
    await audit.record({
      action: 'payroll.payments.mark_paid',
      entityType: 'payroll_run',
      entityId: runId,
      metadata: { count: res.count, reference: input.reference },
    });
    return this.list(runId);
  },
};
