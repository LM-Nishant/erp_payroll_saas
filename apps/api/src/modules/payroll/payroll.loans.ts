import type {
  CreateLoanInput,
  CreateReimbursementClaimInput,
  LoanDto,
  ReimbursementClaimDto,
  createLoanSchema,
  createReimbursementClaimSchema,
  listLoansQuerySchema,
  listReimbursementsQuerySchema,
} from '@erp/shared';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { audit } from '../../core/audit';
import { currentPrincipal, hasPermission, tryGetPrincipal } from '../../core/authz';
import { AppError, ForbiddenError, NotFoundError } from '../../core/http/errors';
import { toListResponse, toPageWindow } from '../../core/http/pagination';
import { tenantDb, withTenant } from '../../core/tenancy';
import { submitWorkflow, type WorkflowInstanceRef } from '../../core/workflow';
import { cancelWorkflow } from '../../core/workflow/engine';
import { round2, strToDate } from '../attendance/time';
import { employeeAssignmentAsOf, employeeIdsForUser } from '../employees/employees.assignment';
import { dateStr } from '../employees/employees.mappers';
import { notify } from '../employees/employees.service';
import { PAYROLL_NOTIFICATIONS, REIMBURSEMENT_WORKFLOW } from './payroll.constants';
import {
  assertInstitutionVisible,
  authorizeInstitution,
  institutionFilter,
  institutionIdsFor,
} from './payroll.access';
import { num, toClaimDto, toLoanDto } from './payroll.mappers';

/*
 * Loans / salary advances (EMIs auto-deducted by payroll runs as LOAN_EMI adjustments; marked
 * DEDUCTED on finalize, restored on reopen) and reimbursement claims (workflow
 * `reimbursement_claim`; approval creates a PENDING REIMBURSEMENT adjustment for the next run).
 */

const db = () => tenantDb();
const userId = () => tryGetPrincipal()?.userId ?? null;

type LoanInput = z.output<typeof createLoanSchema>;
type ClaimInput = z.output<typeof createReimbursementClaimSchema>;
type ListLoansQuery = z.output<typeof listLoansQuerySchema>;
type ListClaimsQuery = z.output<typeof listReimbursementsQuerySchema>;

const MAX_TENURE = 120;

const monthStart = (d: string) => strToDate(`${d.slice(0, 7)}-01`);
const addMonths = (d: Date, n: number) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));

/** EMI schedule: ceil(principal / emi) installments, the last one carries the remainder. */
export function loanSchedule(principal: number, emi: number, start: string) {
  const tenure = Math.ceil(round2(principal) / round2(emi) - 1e-9);
  if (tenure > MAX_TENURE) {
    throw new AppError(
      422,
      'VALIDATION_ERROR',
      `EMI is too small: the loan would run ${tenure} months (max ${MAX_TENURE})`,
    );
  }
  const first = monthStart(start);
  const out: { dueMonth: Date; amount: number }[] = [];
  let left = round2(principal);
  for (let i = 0; i < tenure; i += 1) {
    const amount = round2(Math.min(emi, left));
    out.push({ dueMonth: addMonths(first, i), amount });
    left = round2(left - amount);
  }
  return out;
}

async function currentInstitution(employeeId: string) {
  const employee = await db().employee.findFirst({ where: { id: employeeId } });
  if (!employee) throw new NotFoundError('Employee');
  const assignment = await employeeAssignmentAsOf(employeeId, new Date());
  return {
    employee,
    institutionId: assignment?.institutionId ?? employee.institutionId,
    groupId: assignment?.groupId ?? employee.groupId,
    departmentId: assignment?.departmentId ?? null,
  };
}

async function loanDto(id: string): Promise<LoanDto> {
  const loan = await db().loan.findFirstOrThrow({ where: { id } });
  const installments = await db().loanInstallment.findMany({
    where: { loanId: id },
    orderBy: { dueMonth: 'asc' },
  });
  return toLoanDto({ ...loan, installments });
}

async function myEmployeeIds(): Promise<string[]> {
  const principal = currentPrincipal();
  return principal.userId ? employeeIdsForUser(principal.userId) : [];
}

export const loanService = {
  async list(query: ListLoansQuery) {
    const ids = await institutionIdsFor('payroll.view');
    const where: Prisma.LoanWhereInput = {
      ...institutionFilter(ids),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      db().loan.findMany({ where, orderBy: { createdAt: 'desc' }, ...toPageWindow(query) }),
      db().loan.count({ where }),
    ]);
    const installments = await db().loanInstallment.findMany({
      where: { loanId: { in: rows.map((r) => r.id) } },
      orderBy: { dueMonth: 'asc' },
    });
    return toListResponse(
      rows.map((l) =>
        toLoanDto({ ...l, installments: installments.filter((i) => i.loanId === l.id) }),
      ),
      total,
      query,
    );
  },

  async get(id: string): Promise<LoanDto> {
    const loan = await db().loan.findFirst({ where: { id } });
    if (!loan) throw new NotFoundError('Loan');
    const own = (await myEmployeeIds()).includes(loan.employeeId);
    if (!own) {
      if (!hasPermission(currentPrincipal(), 'payroll.view')) throw new NotFoundError('Loan');
      await assertInstitutionVisible(loan.institutionId, 'payroll.view', 'Loan');
    }
    return loanDto(id);
  },

  async create(input: CreateLoanInput | LoanInput): Promise<LoanDto> {
    const data = input as LoanInput;
    const { employee, institutionId } = await currentInstitution(data.employeeId);
    await authorizeInstitution(institutionId, 'payroll.process');
    if (employee.status !== 'ACTIVE' && employee.status !== 'ON_NOTICE') {
      throw new AppError(409, 'EMPLOYEE_NOT_ACTIVE', 'Loans can be given to active employees only');
    }
    if (data.emiAmount > data.principal) {
      throw new AppError(422, 'VALIDATION_ERROR', 'EMI cannot exceed the principal');
    }
    const schedule = loanSchedule(data.principal, data.emiAmount, data.startMonth);
    const loan = await db().$transaction(async (tx) => {
      const l = await tx.loan.create({
        data: withTenant({
          employeeId: employee.id,
          institutionId,
          loanType: data.loanType,
          principal: data.principal,
          emiAmount: data.emiAmount,
          outstanding: data.principal,
          startMonth: monthStart(data.startMonth),
          tenureMonths: schedule.length,
          reason: data.reason ?? null,
          createdByUserId: userId(),
        }),
      });
      await tx.loanInstallment.createMany({
        data: schedule.map((s) =>
          withTenant({
            loanId: l.id,
            employeeId: employee.id,
            dueMonth: s.dueMonth,
            amount: s.amount,
          }),
        ),
      });
      return l;
    });
    await audit.record({
      action: 'payroll.loan.create',
      entityType: 'loan',
      entityId: loan.id,
      after: {
        employeeId: employee.id,
        principal: data.principal,
        emiAmount: data.emiAmount,
        tenureMonths: schedule.length,
      },
    });
    return loanDto(loan.id);
  },

  async cancel(id: string, reason: string): Promise<LoanDto> {
    const loan = await db().loan.findFirst({ where: { id } });
    if (!loan || !hasPermission(currentPrincipal(), 'payroll.view')) {
      throw new NotFoundError('Loan');
    }
    await assertInstitutionVisible(loan.institutionId, 'payroll.view', 'Loan');
    await authorizeInstitution(loan.institutionId, 'payroll.process');
    if (loan.status !== 'ACTIVE') {
      throw new AppError(409, 'INVALID_STATE', `Loan is ${loan.status.toLowerCase()}`);
    }
    await db().$transaction(async (tx) => {
      await tx.loanInstallment.updateMany({
        where: { loanId: id, status: 'DUE' },
        data: { status: 'SKIPPED' },
      });
      await tx.loan.update({ where: { id }, data: { status: 'CANCELLED' } });
    });
    await audit.record({
      action: 'payroll.loan.cancel',
      entityType: 'loan',
      entityId: id,
      before: { status: loan.status, outstanding: num(loan.outstanding) },
      after: { status: 'CANCELLED' },
      reason,
    });
    return loanDto(id);
  },

  async mine(): Promise<LoanDto[]> {
    const ids = await myEmployeeIds();
    if (!ids.length || !hasPermission(currentPrincipal(), 'payroll.view_own')) return [];
    const loans = await db().loan.findMany({
      where: { employeeId: { in: ids } },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(loans.map((l) => loanDto(l.id)));
  },
};

/* --------------------------------- Reimbursements --------------------------------------- */

async function decideClaim(
  ref: Pick<WorkflowInstanceRef, 'entityId' | 'comment'>,
  status: 'APPROVED' | 'REJECTED' | 'CANCELLED',
): Promise<void> {
  const claim = await db().reimbursementClaim.findFirst({ where: { id: ref.entityId } });
  if (!claim || claim.status !== 'PENDING_APPROVAL') return;
  let adjustmentId: string | null = null;
  await db().$transaction(async (tx) => {
    if (status === 'APPROVED') {
      const adj = await tx.payrollAdjustment.create({
        data: withTenant({
          employeeId: claim.employeeId,
          institutionId: claim.institutionId,
          type: 'REIMBURSEMENT',
          code: 'REIMB',
          amount: claim.amount,
          taxable: claim.taxable,
          description: `Reimbursement: ${claim.category} (${dateStr(claim.claimDate)})`,
          source: 'reimbursement',
          sourceId: claim.id,
          status: 'PENDING',
          createdByUserId: claim.requestedByUserId,
        }),
      });
      adjustmentId = adj.id;
    }
    await tx.reimbursementClaim.update({
      where: { id: claim.id },
      data: {
        status,
        adjustmentId,
        decidedComment: ref.comment ?? null,
        decidedAt: new Date(),
      },
    });
  });
  await audit.record({
    action: `payroll.reimbursement.${status.toLowerCase()}`,
    entityType: 'reimbursement_claim',
    entityId: claim.id,
    before: { status: claim.status },
    after: { status, adjustmentId },
    reason: ref.comment ?? undefined,
  });
  if (status !== 'CANCELLED') {
    await notify(PAYROLL_NOTIFICATIONS.reimbursementDecided, [claim.requestedByUserId], {
      title: `Reimbursement claim ${status === 'APPROVED' ? 'approved' : 'rejected'}`,
      body: `${claim.category}: ${num(claim.amount).toFixed(2)}${status === 'APPROVED' ? ' will be paid with the next payroll.' : ''}`,
      link: '/me/reimbursements',
      institutionId: claim.institutionId,
    });
  }
}

export const reimbursementWorkflowCallbacks = {
  linkFor: (ref: { entityId: string }) => `/payroll/reimbursements/${ref.entityId}`,
  onApproved: (ref: WorkflowInstanceRef) => decideClaim(ref, 'APPROVED'),
  onRejected: (ref: WorkflowInstanceRef) => decideClaim(ref, 'REJECTED'),
  onCancelled: (ref: WorkflowInstanceRef) => decideClaim(ref, 'CANCELLED'),
};

async function loadClaim(id: string) {
  const claim = await db().reimbursementClaim.findFirst({ where: { id } });
  if (!claim) throw new NotFoundError('Reimbursement claim');
  return claim;
}

export const reimbursementService = {
  async list(query: ListClaimsQuery) {
    const ids = await institutionIdsFor('payroll.view');
    const where: Prisma.ReimbursementClaimWhereInput = {
      ...institutionFilter(ids),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      db().reimbursementClaim.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...toPageWindow(query),
      }),
      db().reimbursementClaim.count({ where }),
    ]);
    return toListResponse(rows.map(toClaimDto), total, query);
  },

  async mine(): Promise<ReimbursementClaimDto[]> {
    const ids = await myEmployeeIds();
    if (!ids.length) return [];
    const rows = await db().reimbursementClaim.findMany({
      where: { employeeId: { in: ids } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toClaimDto);
  },

  /** Employee self-service claim (permission `reimbursement.claim_own`). */
  async claim(input: CreateReimbursementClaimInput | ClaimInput): Promise<ReimbursementClaimDto> {
    const data = input as ClaimInput;
    const principal = currentPrincipal();
    if (!hasPermission(principal, 'reimbursement.claim_own')) {
      throw new ForbiddenError('Missing permission reimbursement.claim_own');
    }
    const [employeeId] = await myEmployeeIds();
    if (!employeeId) {
      throw new AppError(409, 'NO_EMPLOYEE_PROFILE', 'Your user is not linked to an employee');
    }
    const { employee, institutionId, groupId, departmentId } = await currentInstitution(employeeId);
    if (employee.status !== 'ACTIVE' && employee.status !== 'ON_NOTICE') {
      throw new AppError(409, 'EMPLOYEE_NOT_ACTIVE', 'Only active employees can claim');
    }
    const claim = await db().reimbursementClaim.create({
      data: withTenant({
        employeeId,
        institutionId,
        groupId,
        category: data.category,
        amount: data.amount,
        claimDate: strToDate(data.claimDate),
        description: data.description,
        taxable: data.taxable,
        requestedByUserId: principal.userId,
      }),
    });
    await audit.record({
      action: 'payroll.reimbursement.claim',
      entityType: 'reimbursement_claim',
      entityId: claim.id,
      after: { employeeId, category: data.category, amount: data.amount },
    });
    const instance = await submitWorkflow({
      entityType: REIMBURSEMENT_WORKFLOW,
      entityId: claim.id,
      title: `Reimbursement ${data.category} ${data.amount.toFixed(2)} - ${employee.displayName} (${employee.employeeCode})`,
      requesterUserId: principal.userId,
      institutionId,
      groupId,
      departmentId,
      context: { employeeId, amount: data.amount, category: data.category },
    });
    if (instance) {
      await db().reimbursementClaim.updateMany({
        where: { id: claim.id, workflowInstanceId: null },
        data: { workflowInstanceId: instance.id },
      });
    }
    return toClaimDto(await loadClaim(claim.id));
  },

  /** Direct decision when no workflow definition governs `reimbursement_claim`. */
  async decide(id: string, approved: boolean, comment?: string): Promise<ReimbursementClaimDto> {
    const claim = await loadClaim(id);
    if (!hasPermission(currentPrincipal(), 'payroll.view')) {
      throw new NotFoundError('Reimbursement claim');
    }
    await assertInstitutionVisible(claim.institutionId, 'payroll.view', 'Reimbursement claim');
    await authorizeInstitution(claim.institutionId, 'payroll.process');
    if (claim.status !== 'PENDING_APPROVAL') {
      throw new AppError(409, 'INVALID_STATE', `Claim is ${claim.status.toLowerCase()}`);
    }
    if (claim.workflowInstanceId) {
      throw new AppError(409, 'WORKFLOW_MANAGED', 'Act on the workflow instance of this claim');
    }
    if (claim.requestedByUserId && claim.requestedByUserId === userId()) {
      throw new ForbiddenError('You cannot decide your own claim', 'MAKER_CHECKER');
    }
    await decideClaim(
      { entityId: id, comment: comment ?? null },
      approved ? 'APPROVED' : 'REJECTED',
    );
    return toClaimDto(await loadClaim(id));
  },

  async cancelOwn(id: string): Promise<ReimbursementClaimDto> {
    const claim = await loadClaim(id);
    if (!(await myEmployeeIds()).includes(claim.employeeId)) {
      throw new NotFoundError('Reimbursement claim');
    }
    if (claim.status !== 'PENDING_APPROVAL') {
      throw new AppError(409, 'INVALID_STATE', `Claim is ${claim.status.toLowerCase()}`);
    }
    if (claim.workflowInstanceId) {
      const instance = await db().workflowInstance.findFirst({
        where: { id: claim.workflowInstanceId },
      });
      if (instance && (instance.status === 'PENDING' || instance.status === 'SENT_BACK')) {
        await cancelWorkflow(instance, 'Withdrawn by employee');
      }
    }
    await decideClaim({ entityId: id, comment: 'Withdrawn by employee' }, 'CANCELLED');
    return toClaimDto(await loadClaim(id));
  },
};
