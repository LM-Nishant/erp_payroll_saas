import type {
  SalaryPreviewInput,
  SalaryRevisionDto,
  TaxRegime,
  assignEmployeeSalarySchema,
  createSalaryRevisionRequestSchema,
  listRevisionsQuerySchema,
} from '@erp/shared';
import type { Prisma, SalaryRevision } from '@prisma/client';
import type { z } from 'zod';
import { audit } from '../../core/audit';
import { currentPrincipal, hasPermission, tryGetPrincipal } from '../../core/authz';
import { emit } from '../../core/events';
import { AppError, InvalidReferenceError, NotFoundError } from '../../core/http/errors';
import { toListResponse, toPageWindow } from '../../core/http/pagination';
import { tenantDb, withTenant } from '../../core/tenancy';
import { submitWorkflow, type WorkflowInstanceRef } from '../../core/workflow';
import { cancelWorkflow } from '../../core/workflow/engine';
import { eachDate, round2 } from '../attendance/time';
import { employeeAssignmentAsOf } from '../employees/employees.assignment';
import { notify } from '../employees/employees.service';
import { dateStr, toDate } from '../employees/employees.mappers';
import { PayrollEngineError } from './engine';
import {
  ComputeCache,
  computeEmployee,
  previewEmployee,
  type SalarySnapshot,
} from './payroll.compute';
import {
  assertInstitutionVisible,
  institutionFilter,
  institutionIdsFor,
  payrollEmployee,
} from './payroll.access';
import { num, toEmployeeSalaryDto, toRevisionDto } from './payroll.mappers';

/*
 * Employee salary (payroll side). An assignment = an immutable `employee_salary_history` row
 * (`salaryStructureId` = the payroll structure) + an `employee_salaries` row carrying the
 * structure / tax regime. Revisions (§16) go through workflow `salary_revision`; approval writes a
 * NEW history row (history is never edited — acceptance 10) and, when back-dated into finalized
 * payroll periods, computes arrears that are paid as pending ARREAR adjustments in the next run.
 */

export const SALARY_REVISION_WORKFLOW = 'salary_revision';
const db = () => tenantDb();
const userId = () => tryGetPrincipal()?.userId ?? null;
const json = (v: unknown) => v as Prisma.InputJsonValue;

type AssignInput = z.output<typeof assignEmployeeSalarySchema>;
type RevisionInput = z.output<typeof createSalaryRevisionRequestSchema>;
type ListRevisionsQuery = z.output<typeof listRevisionsQuerySchema>;

async function loadStructureFor(structureId: string, institutionId: string, field = 'structureId') {
  const s = await db().salaryStructure.findFirst({ where: { id: structureId } });
  if (!s || s.status !== 'ACTIVE') throw new InvalidReferenceError(field, 'Salary structure');
  if (s.institutionId && s.institutionId !== institutionId) {
    throw new AppError(
      422,
      'VALIDATION_ERROR',
      'The salary structure belongs to a different institution',
    );
  }
  return s;
}

async function latestHistory(employeeId: string) {
  return db().employeeSalaryHistory.findFirst({
    where: { employeeId },
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
  });
}

function assertNotBeforeLatest(latest: { effectiveFrom: Date } | null, effectiveFrom: string) {
  if (latest && toDate(effectiveFrom) < latest.effectiveFrom) {
    throw new AppError(
      422,
      'VALIDATION_ERROR',
      `effectiveFrom must not be before the latest salary revision (${dateStr(latest.effectiveFrom)})`,
    );
  }
}

/** Write history + assignment rows (scalar FKs, one transaction). */
async function writeSalary(args: {
  employeeId: string;
  effectiveFrom: string;
  annualCtc: number;
  amounts: Record<string, number>;
  excludedComponents: string[];
  structureId: string | null;
  taxRegime: TaxRegime;
  reason: string;
  previousId: string | null;
}) {
  const assignment = await employeeAssignmentAsOf(args.employeeId, args.effectiveFrom);
  const employee = await db().employee.findFirstOrThrow({ where: { id: args.employeeId } });
  const institutionId = assignment?.institutionId ?? employee.institutionId;
  const groupId = assignment?.groupId ?? employee.groupId;
  return db().$transaction(async (tx) => {
    const history = await tx.employeeSalaryHistory.create({
      data: withTenant({
        employeeId: args.employeeId,
        groupId,
        institutionId,
        effectiveFrom: toDate(args.effectiveFrom),
        currency: 'INR',
        annualCtc: args.annualCtc,
        amounts: json(args.amounts),
        salaryStructureId: args.structureId,
        revisionReason: args.reason,
        previousId: args.previousId,
        createdByUserId: userId(),
      }),
    });
    const salary = args.structureId
      ? await tx.employeeSalary.create({
          data: withTenant({
            employeeId: args.employeeId,
            institutionId,
            structureId: args.structureId,
            salaryHistoryId: history.id,
            effectiveFrom: toDate(args.effectiveFrom),
            annualCtc: args.annualCtc,
            amounts: json(args.amounts),
            excludedComponents: json(args.excludedComponents),
            taxRegime: args.taxRegime,
            createdByUserId: userId(),
          }),
        })
      : null;
    return { history, salary, institutionId, groupId };
  });
}

/* --------------------------------- Arrears --------------------------------------------- */

interface ArrearLine {
  runId: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
}

/**
 * Arrears of a back-dated revision: for every FINALIZED run of the employee whose period ends
 * on/after `effectiveFrom`, recompute the regular earnings with the new salary on the run's
 * stored attendance basis and take the difference (pro-rated for a mid-period effective date).
 */
export async function computeArrears(
  employeeId: string,
  effectiveFrom: string,
  salary: SalarySnapshot,
): Promise<ArrearLine[]> {
  const rows = await db().payrollRunEmployee.findMany({
    where: {
      employeeId,
      status: 'OK',
      run: { status: 'FINALIZED', periodEnd: { gte: toDate(effectiveFrom) } },
    },
    include: { run: true },
  });
  const cache = new ComputeCache();
  const out: ArrearLine[] = [];
  for (const re of rows) {
    const periodStart = dateStr(re.run.periodStart);
    const periodEnd = dateStr(re.run.periodEnd);
    const items = await db().payrollItem.findMany({
      where: { runEmployeeId: re.id, category: 'EARNING', type: { not: 'ADJUSTMENT' } },
    });
    const paid = items.reduce((a, i) => a + num(i.amount), 0);
    const assignment = await employeeAssignmentAsOf(employeeId, periodEnd);
    const calendarDays = num(re.calendarDays);
    const { result } = await computeEmployee(
      {
        institutionId: re.institutionId,
        periodStart,
        periodEnd,
        salary,
        basis: {
          calendarDays,
          employedDays: calendarDays,
          payableDays: num(re.payableDays),
          lopDays: num(re.lopDays),
          presentDays: num(re.payableDays),
          overtimeHours: 0,
          institutionDays: num(re.institutionDays),
          locked: true,
          factor: num(re.factor),
          warnings: [],
        },
        employmentType: assignment?.employmentType ?? null,
        adjustments: [],
      },
      cache,
    );
    const due = result.lines
      .filter((l) => l.category === 'EARNING' && l.type !== 'ADJUSTMENT')
      .reduce((a, l) => a + l.amount, 0);
    let diff = due - paid;
    if (effectiveFrom > periodStart) {
      const days = eachDate(effectiveFrom, periodEnd).length;
      diff = (diff * days) / eachDate(periodStart, periodEnd).length;
    }
    diff = round2(diff);
    if (diff > 0) out.push({ runId: re.runId, periodStart, periodEnd, amount: diff });
  }
  return out.sort((a, b) => a.periodStart.localeCompare(b.periodStart));
}

/* --------------------------------- Revisions ------------------------------------------- */

async function reloadRevision(id: string): Promise<SalaryRevisionDto> {
  const r = await db().salaryRevision.findFirstOrThrow({ where: { id } });
  const e = await db().employee.findFirst({
    where: { id: r.employeeId },
    select: { employeeCode: true, displayName: true },
  });
  return toRevisionDto(r, e);
}

/** Apply an approved revision (idempotent): new history row + arrears adjustment. */
async function applyRevision(id: string, comment?: string | null) {
  const r = await db().salaryRevision.findFirst({ where: { id } });
  if (!r || r.status !== 'PENDING_APPROVAL') return;
  const latest = await latestHistory(r.employeeId);
  const current = await db().employeeSalary.findFirst({
    where: { employeeId: r.employeeId },
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
  });
  const effectiveFrom = dateStr(r.effectiveFrom);
  const structureId = r.structureId ?? current?.structureId ?? latest?.salaryStructureId ?? null;
  const taxRegime = (r.taxRegime ?? current?.taxRegime ?? 'NEW') as TaxRegime;
  const amounts = (r.amounts as Record<string, number>) ?? {};
  const excludedComponents =
    (r.excludedComponents as string[] | null) ??
    (current?.excludedComponents as string[] | null) ??
    [];
  const snapshot: SalarySnapshot = {
    salaryHistoryId: null,
    structureId,
    annualCtc: num(r.annualCtc),
    amounts,
    excludedComponents,
    taxRegime,
  };
  let arrears: ArrearLine[] = [];
  try {
    arrears = await computeArrears(r.employeeId, effectiveFrom, snapshot);
  } catch (e) {
    if (!(e instanceof PayrollEngineError)) throw e;
  }
  const total = round2(arrears.reduce((a, l) => a + l.amount, 0));
  const written = await writeSalary({
    employeeId: r.employeeId,
    effectiveFrom,
    annualCtc: num(r.annualCtc),
    amounts,
    excludedComponents,
    structureId,
    taxRegime,
    reason: r.reason,
    previousId: latest?.id ?? null,
  });
  await db().salaryRevision.update({
    where: { id },
    data: {
      status: 'APPLIED',
      salaryHistoryId: written.history.id,
      arrearsAmount: total,
      arrears: json(arrears),
      decidedComment: comment ?? null,
      decidedAt: new Date(),
    },
  });
  if (total > 0) {
    const assignment = await employeeAssignmentAsOf(r.employeeId, new Date());
    await db().payrollAdjustment.create({
      data: withTenant({
        employeeId: r.employeeId,
        institutionId: assignment?.institutionId ?? written.institutionId,
        type: 'ARREAR',
        code: 'ARREARS',
        amount: total,
        taxable: true,
        description: `Arrears: salary revision effective ${effectiveFrom} (${arrears.length} period(s))`,
        source: 'arrear',
        sourceId: r.id,
        status: 'PENDING',
        createdByUserId: userId(),
      }),
    });
  }
  await audit.record({
    action: 'payroll.salary_revision.apply',
    entityType: 'salary_revision',
    entityId: id,
    before: latest ? { annualCtc: num(latest.annualCtc) } : undefined,
    after: { annualCtc: num(r.annualCtc), effectiveFrom, arrearsAmount: total },
    reason: r.reason,
    metadata: { employeeId: r.employeeId, salaryHistoryId: written.history.id },
  });
  await emit(
    'employee.salary_revised',
    {
      employeeId: r.employeeId,
      revisionId: written.history.id,
      effectiveFrom,
      salaryStructureId: structureId,
      arrearsAmount: total,
    },
    { institutionId: written.institutionId },
  );
  const employee = await db().employee.findFirst({ where: { id: r.employeeId } });
  await notify('payroll.salary_revised', [employee?.userId], {
    title: `Your salary has been revised effective ${effectiveFrom}`,
    body: total > 0 ? `Arrears of INR ${total} will be paid in the next payroll.` : undefined,
    link: '/me/payslips',
    institutionId: written.institutionId,
  });
}

async function closeRevision(id: string, comment: string | null | undefined, status: string) {
  const r = await db().salaryRevision.findFirst({ where: { id } });
  if (!r || r.status !== 'PENDING_APPROVAL') return;
  await db().salaryRevision.update({
    where: { id },
    data: { status, decidedComment: comment ?? null, decidedAt: new Date() },
  });
  await audit.record({
    action: `payroll.salary_revision.${status.toLowerCase()}`,
    entityType: 'salary_revision',
    entityId: id,
    reason: comment ?? undefined,
  });
}

export const salaryRevisionWorkflowCallbacks = {
  onApproved: (ref: WorkflowInstanceRef) => applyRevision(ref.entityId, ref.comment),
  onRejected: (ref: WorkflowInstanceRef) => closeRevision(ref.entityId, ref.comment, 'REJECTED'),
  onCancelled: (ref: WorkflowInstanceRef) => closeRevision(ref.entityId, ref.comment, 'CANCELLED'),
};

export const salaryService = {
  /** Payroll salary assignments of an employee (newest first). */
  async list(employeeId: string) {
    await payrollEmployee(employeeId, 'salary.view');
    const rows = await db().employeeSalary.findMany({
      where: { employeeId },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(toEmployeeSalaryDto);
  },

  /** Initial assignment of a structure + CTC (later changes go through revisions). */
  async assign(employeeId: string, input: AssignInput) {
    const employee = await payrollEmployee(employeeId, 'salary.update');
    if (employee.status === 'EXITED') {
      throw new AppError(409, 'INVALID_STATE', 'Cannot assign salary to an exited employee');
    }
    const existing = await db().employeeSalary.findFirst({ where: { employeeId } });
    if (existing) {
      throw new AppError(
        409,
        'SALARY_ALREADY_ASSIGNED',
        'The employee already has a payroll salary; submit a salary revision instead',
      );
    }
    const assignment = await employeeAssignmentAsOf(employeeId, input.effectiveFrom);
    await loadStructureFor(input.structureId, assignment?.institutionId ?? employee.institutionId);
    const latest = await latestHistory(employeeId);
    assertNotBeforeLatest(latest, input.effectiveFrom);
    const written = await writeSalary({
      employeeId,
      effectiveFrom: input.effectiveFrom,
      annualCtc: input.annualCtc,
      amounts: input.amounts,
      excludedComponents: input.excludedComponents,
      structureId: input.structureId,
      taxRegime: input.taxRegime,
      reason: input.reason,
      previousId: latest?.id ?? null,
    });
    await audit.record({
      action: 'payroll.salary.assign',
      entityType: 'employee',
      entityId: employeeId,
      before: latest ? { annualCtc: num(latest.annualCtc) } : undefined,
      after: {
        annualCtc: input.annualCtc,
        structureId: input.structureId,
        effectiveFrom: input.effectiveFrom,
        taxRegime: input.taxRegime,
        excludedComponents: input.excludedComponents,
      },
      reason: input.reason,
      metadata: { salaryHistoryId: written.history.id },
    });
    return toEmployeeSalaryDto(written.salary!);
  },

  async preview(input: SalaryPreviewInput) {
    const employee = await payrollEmployee(input.employeeId, 'salary.view');
    if (input.institutionId) {
      await assertInstitutionVisible(input.institutionId, 'salary.view', 'Institution');
    }
    try {
      return await previewEmployee(
        employee.id,
        input.institutionId,
        input.periodStart,
        input.periodEnd,
      );
    } catch (e) {
      if (e instanceof PayrollEngineError) {
        throw new AppError(422, 'PAYROLL_COMPUTE_FAILED', e.message);
      }
      throw e;
    }
  },
};

export const revisionService = {
  async list(query: ListRevisionsQuery) {
    const ids = await institutionIdsFor('salary.view');
    const where: Prisma.SalaryRevisionWhereInput = {
      ...institutionFilter(ids),
      ...(query.institutionId ? { institutionId: query.institutionId } : {}),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const window = toPageWindow(query);
    const [rows, total] = await Promise.all([
      db().salaryRevision.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: window.skip,
        take: window.take,
      }),
      db().salaryRevision.count({ where }),
    ]);
    const emps = await db().employee.findMany({
      where: { id: { in: rows.map((r) => r.employeeId) } },
      select: { id: true, employeeCode: true, displayName: true },
    });
    const byId = new Map(emps.map((e) => [e.id, e]));
    return toListResponse(
      rows.map((r) => toRevisionDto(r, byId.get(r.employeeId))),
      total,
      query,
    );
  },

  async get(id: string) {
    const r = await loadRevision(id, 'salary.view');
    return reloadRevision(r.id);
  },

  async request(input: RevisionInput) {
    const principal = currentPrincipal();
    const employee = await payrollEmployee(input.employeeId, 'salary.update');
    if (employee.status === 'EXITED') {
      throw new AppError(409, 'INVALID_STATE', 'Cannot revise the salary of an exited employee');
    }
    const assignment = await employeeAssignmentAsOf(employee.id, input.effectiveFrom);
    const institutionId = assignment?.institutionId ?? employee.institutionId;
    if (input.structureId) await loadStructureFor(input.structureId, institutionId);
    const latest = await latestHistory(employee.id);
    if (!latest) {
      throw new AppError(
        409,
        'NO_SALARY',
        'The employee has no salary yet; assign a salary structure first',
      );
    }
    assertNotBeforeLatest(latest, input.effectiveFrom);
    const pending = await db().salaryRevision.findFirst({
      where: { employeeId: employee.id, status: 'PENDING_APPROVAL' },
    });
    if (pending) {
      throw new AppError(409, 'REVISION_PENDING', 'A salary revision is already pending approval');
    }
    const row = await db().salaryRevision.create({
      data: withTenant({
        employeeId: employee.id,
        institutionId,
        groupId: assignment?.groupId ?? employee.groupId,
        structureId: input.structureId ?? null,
        effectiveFrom: toDate(input.effectiveFrom),
        annualCtc: input.annualCtc,
        previousAnnualCtc: latest.annualCtc,
        amounts: json(input.amounts),
        excludedComponents: input.excludedComponents ? json(input.excludedComponents) : undefined,
        taxRegime: input.taxRegime ?? null,
        reason: input.reason,
        status: 'PENDING_APPROVAL',
        requestedByUserId: principal.userId,
      }),
    });
    await audit.record({
      action: 'payroll.salary_revision.request',
      entityType: 'salary_revision',
      entityId: row.id,
      before: { annualCtc: num(latest.annualCtc), effectiveFrom: dateStr(latest.effectiveFrom) },
      after: { annualCtc: input.annualCtc, effectiveFrom: input.effectiveFrom },
      reason: input.reason,
      metadata: { employeeId: employee.id },
    });
    const instance = await submitWorkflow({
      entityType: SALARY_REVISION_WORKFLOW,
      entityId: row.id,
      title: `Salary revision ${employee.displayName} (${employee.employeeCode}) from ${input.effectiveFrom}`,
      requesterUserId: principal.userId,
      institutionId,
      groupId: assignment?.groupId ?? employee.groupId,
      departmentId: assignment?.departmentId ?? null,
      context: {
        employeeId: employee.id,
        annualCtc: input.annualCtc,
        previousAnnualCtc: num(latest.annualCtc),
        effectiveFrom: input.effectiveFrom,
        backDated: input.effectiveFrom < dateStr(new Date()),
      },
    });
    if (instance) {
      await db().salaryRevision.update({
        where: { id: row.id },
        data: { workflowInstanceId: instance.id },
      });
    } else {
      await applyRevision(row.id, null);
    }
    return reloadRevision(row.id);
  },

  async cancel(id: string) {
    const r = await loadRevision(id, 'salary.update');
    if (r.status !== 'PENDING_APPROVAL') {
      throw new AppError(409, 'INVALID_STATE', `Revision is ${r.status.toLowerCase()}`);
    }
    if (r.workflowInstanceId) {
      const instance = await db().workflowInstance.findFirst({
        where: { id: r.workflowInstanceId },
      });
      if (instance && (instance.status === 'PENDING' || instance.status === 'SENT_BACK')) {
        await cancelWorkflow(instance, 'Withdrawn');
      }
    }
    await closeRevision(id, 'Withdrawn', 'CANCELLED');
    return reloadRevision(id);
  },
};

async function loadRevision(id: string, permission: string): Promise<SalaryRevision> {
  const r = await db().salaryRevision.findFirst({ where: { id } });
  if (!r) throw new NotFoundError('Salary revision');
  if (!hasPermission(currentPrincipal(), permission)) throw new NotFoundError('Salary revision');
  await assertInstitutionVisible(r.institutionId, permission, 'Salary revision');
  return r;
}
