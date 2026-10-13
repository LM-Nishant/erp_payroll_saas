import type { FeePayment, Prisma, Student } from '@prisma/client';
import type { FeeCancelInput, RecordPaymentInput, RefundPaymentInput } from '@erp/shared';
import { audit } from '../../core/audit';
import { andScope, authorize, can, currentPrincipal, scopeWhere } from '../../core/authz';
import { emit } from '../../core/events';
import {
  ConflictError,
  InvalidReferenceError,
  NotFoundError,
  ValidationError,
} from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { publish } from '../../core/notifications';
import { renderPdfTemplate } from '../../core/pdf';
import { tenantDb, withTenant } from '../../core/tenancy';
import {
  accountFor,
  cancelVoucherInTx,
  ensureChartOfAccounts,
  moneyAccountKey,
  nextNumbers,
  postVoucher,
} from '../finance/finance.ledger';
import { fromPaise, toPaise } from '../finance/finance.logic';
import { dateStr, num, toDate, today } from '../finance/finance.mappers';
import { loadFeeStudent } from './fees.access';
import type { GatewayWebhookEvent } from './fees.gateway';
import { allocateOldestFirst, invoiceStatus } from './fees.logic';
import { toPaymentDto, type PaymentWithRefs } from './fees.mappers';

const p = () => currentPrincipal();

export const FEE_RECEIPT_TEMPLATE = 'fee_receipt';

const studentScope = (s: Student) => ({
  groupId: s.groupId,
  institutionId: s.institutionId,
  campusId: s.campusId,
  departmentId: s.departmentId,
});

const paymentInclude = {
  allocations: { include: { invoice: { select: { number: true } } } },
  refunds: { orderBy: { createdAt: 'asc' } },
} as const;

async function studentRef(id: string) {
  return tenantDb().student.findUnique({
    where: { id },
    select: { id: true, displayName: true, admissionNo: true },
  });
}

export async function loadPayment(id: string, perm = 'fee.view') {
  const pay = await tenantDb().feePayment.findUnique({ where: { id }, include: paymentInclude });
  if (!pay) throw new NotFoundError('Payment');
  if (!(await can(p(), perm, pay))) {
    if (perm !== 'fee.view') throw new NotFoundError('Payment');
    await loadFeeStudent(pay.studentId);
  }
  return pay as PaymentWithRefs;
}

/** User ids to notify about a student's fees: the student login + linked guardian logins. */
export async function feeRecipients(studentId: string): Promise<string[]> {
  const db = tenantDb();
  const [student, links] = await Promise.all([
    db.student.findUnique({ where: { id: studentId }, select: { userId: true } }),
    db.studentGuardian.findMany({
      where: { studentId },
      include: { guardian: { select: { userId: true } } },
    }),
  ]);
  return [
    ...new Set(
      [student?.userId, ...links.map((l) => l.guardian.userId)].filter((v): v is string => !!v),
    ),
  ];
}

interface PaymentData {
  amount: number;
  paidOn: string;
  mode: string;
  reference?: string | null;
  instrumentDate?: string | null;
  bankName?: string | null;
  remarks?: string | null;
  allocations?: Array<{ invoiceId: string; amount: number }>;
  gatewayOrderId?: string | null;
}

/** Records a receipt for `student` (no permission checks — callers authorise). */
export async function recordPaymentInternal(student: Student, data: PaymentData) {
  const db = tenantDb();
  const open = await db.feeInvoice.findMany({
    where: { studentId: student.id, status: { in: ['UNPAID', 'PARTIAL'] } },
    orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
  });
  const balances = new Map(
    open.map((i) => [i.id, fromPaise(toPaise(i.netAmount) - toPaise(i.paidAmount))]),
  );
  let allocations: Array<{ invoiceId: string; amount: number }>;
  if (data.allocations && data.allocations.length > 0) {
    const seen = new Set<string>();
    let sum = 0;
    for (const a of data.allocations) {
      const bal = balances.get(a.invoiceId);
      if (bal === undefined || seen.has(a.invoiceId)) {
        throw new InvalidReferenceError('allocations.invoiceId', 'Open invoice of the student');
      }
      if (toPaise(a.amount) > toPaise(bal)) {
        throw new ValidationError('Allocation exceeds the invoice balance');
      }
      seen.add(a.invoiceId);
      sum += toPaise(a.amount);
    }
    if (sum > toPaise(data.amount)) {
      throw new ValidationError('Allocations exceed the payment amount');
    }
    allocations = data.allocations;
  } else {
    allocations = allocateOldestFirst(
      open.map((i) => ({ id: i.id, dueDate: i.dueDate, balance: balances.get(i.id) ?? 0 })),
      data.amount,
    ).allocations;
  }
  const allocated = allocations.reduce((s, a) => s + toPaise(a.amount), 0);
  const unallocated = toPaise(data.amount) - allocated;
  const keys = await ensureChartOfAccounts();
  const scope = studentScope(student);
  const payment = await db.$transaction(async (tx) => {
    const [number] = await nextNumbers(tx, student.institutionId, 'RECEIPT');
    const row = await tx.feePayment.create({
      data: withTenant({
        ...scope,
        studentId: student.id,
        number: number as string,
        paidOn: toDate(data.paidOn),
        mode: data.mode,
        reference: data.reference ?? null,
        instrumentDate: data.instrumentDate ? toDate(data.instrumentDate) : null,
        bankName: data.bankName ?? null,
        amount: data.amount,
        allocatedAmount: fromPaise(allocated),
        status: 'ACTIVE',
        gatewayOrderId: data.gatewayOrderId ?? null,
        remarks: data.remarks ?? null,
        collectedByUserId: p().userId ?? null,
      }),
    });
    if (allocations.length > 0) {
      await tx.feePaymentAllocation.createMany({
        data: allocations.map((a) =>
          withTenant({ paymentId: row.id, invoiceId: a.invoiceId, amount: a.amount }),
        ),
      });
    }
    for (const a of allocations) {
      const inv = await tx.feeInvoice.update({
        where: { id: a.invoiceId },
        data: { paidAmount: { increment: a.amount } },
      });
      if (toPaise(inv.paidAmount) > toPaise(inv.netAmount) || inv.status === 'CANCELLED') {
        throw new ConflictError('Invoice changed concurrently; retry the payment');
      }
      await tx.feeInvoice.update({
        where: { id: inv.id },
        data: { status: invoiceStatus(num(inv.netAmount), num(inv.paidAmount)) },
      });
    }
    const voucher = await postVoucher(tx, {
      scope,
      voucherDate: toDate(data.paidOn),
      type: 'RECEIPT',
      narration: `Fee receipt ${row.number} — ${student.displayName} (${data.mode})`,
      sourceType: 'FEE_PAYMENT',
      sourceId: row.id,
      sourceKey: `fee_payment:${row.id}`,
      lines: [
        {
          accountId: accountFor(
            keys,
            data.gatewayOrderId ? 'gateway_clearing' : moneyAccountKey(data.mode),
          ),
          debit: data.amount,
          credit: 0,
        },
        { accountId: accountFor(keys, 'fee_receivable'), debit: 0, credit: fromPaise(allocated) },
        { accountId: accountFor(keys, 'fee_advance'), debit: 0, credit: fromPaise(unallocated) },
      ],
    });
    return tx.feePayment.update({ where: { id: row.id }, data: { voucherId: voucher.id } });
  });
  const full = await tenantDb().feePayment.findUniqueOrThrow({
    where: { id: payment.id },
    include: paymentInclude,
  });
  const dto = toPaymentDto(full, await studentRef(student.id));
  await audit.record({
    action: 'fee_payment.recorded',
    entityType: 'fee_payment',
    entityId: payment.id,
    after: dto,
  });
  await emit(
    'fee.payment_received',
    {
      paymentId: payment.id,
      number: payment.number,
      studentId: student.id,
      amount: data.amount,
      mode: data.mode,
    },
    { institutionId: student.institutionId },
  );
  const recipients = await feeRecipients(student.id);
  if (recipients.length > 0) {
    await publish('fee.payment_received', {
      recipients,
      title: `Fee payment received: ₹${data.amount.toFixed(2)}`,
      body: `Receipt ${payment.number} for ${student.displayName} (${data.mode}).`,
      link: '/portal/fees',
      data: { paymentId: payment.id, studentId: student.id },
      institutionId: student.institutionId,
    });
  }
  return dto;
}

/** Recomputes invoice paid amounts after allocations are removed (inside tx). */
async function reverseAllocations(
  tx: Parameters<Parameters<ReturnType<typeof tenantDb>['$transaction']>[0]>[0],
  paymentId: string,
) {
  const allocations = await tx.feePaymentAllocation.findMany({ where: { paymentId } });
  for (const a of allocations) {
    const inv = await tx.feeInvoice.update({
      where: { id: a.invoiceId },
      data: { paidAmount: { decrement: a.amount } },
    });
    if (inv.status !== 'CANCELLED') {
      await tx.feeInvoice.update({
        where: { id: inv.id },
        data: { status: invoiceStatus(num(inv.netAmount), num(inv.paidAmount)) },
      });
    }
  }
  await tx.feePaymentAllocation.deleteMany({ where: { paymentId } });
  return allocations;
}

export const feePaymentService = {
  async record(input: RecordPaymentInput) {
    const { student } = await loadFeeStudent(input.studentId, 'fee.collect');
    await authorize(p(), 'fee.collect', studentScope(student));
    const reference = input.reference.toUpperCase();
    const duplicate = await tenantDb().feePayment.findFirst({
      where: { reference, status: { not: 'CANCELLED' } },
      select: { number: true },
    });
    if (duplicate) throw new ConflictError(`UTR already recorded on receipt ${duplicate.number}`);
    return recordPaymentInternal(student, {
      ...input,
      mode: 'UPI',
      reference,
      paidOn: input.paidOn ?? today(),
    });
  },

  async list(query: {
    page: number;
    pageSize: number;
    search?: string;
    institutionId?: string;
    studentId?: string;
    mode?: string;
    status?: string;
    from?: string;
    to?: string;
  }) {
    const where: Prisma.FeePaymentWhereInput = {
      ...(query.institutionId ? { institutionId: query.institutionId } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.mode ? { mode: query.mode } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            paidOn: {
              ...(query.from ? { gte: toDate(query.from) } : {}),
              ...(query.to ? { lte: toDate(query.to) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [{ number: { contains: query.search } }, { reference: { contains: query.search } }],
          }
        : {}),
    };
    const scoped = andScope(where, await scopeWhere(p(), 'fee.view', 'finance'));
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.feePayment.findMany({
        where: scoped,
        orderBy: [{ paidOn: 'desc' }, { number: 'desc' }],
        ...toPageWindow(query),
      }),
      db.feePayment.count({ where: scoped }),
    ]);
    const students = await db.student.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.studentId))] } },
      select: { id: true, displayName: true, admissionNo: true },
    });
    const refs = new Map(students.map((s) => [s.id, s]));
    return { items: rows.map((r) => toPaymentDto(r, refs.get(r.studentId))), total };
  },

  async get(id: string) {
    const pay = await loadPayment(id);
    return toPaymentDto(pay, await studentRef(pay.studentId));
  },

  async cancel(id: string, input: FeeCancelInput) {
    const before = await loadPayment(id, 'fee.refund');
    await authorize(p(), 'fee.refund', before);
    if (before.status === 'CANCELLED') throw new ConflictError('Payment is already cancelled');
    if (toPaise(before.refundedAmount) > 0) {
      throw new ConflictError('Payment has refunds and cannot be cancelled');
    }
    await tenantDb().$transaction(async (tx) => {
      await reverseAllocations(tx, id);
      await tx.feePayment.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelReason: input.reason,
          cancelledByUserId: p().userId ?? null,
        },
      });
      await cancelVoucherInTx(
        tx,
        before.voucherId,
        `Receipt ${before.number} cancelled: ${input.reason}`,
      );
    });
    const after = await loadPayment(id);
    const dto = toPaymentDto(after, await studentRef(after.studentId));
    await audit.record({
      action: 'fee_payment.cancelled',
      entityType: 'fee_payment',
      entityId: id,
      before: toPaymentDto(before),
      after: dto,
      reason: input.reason,
    });
    await emit(
      'fee.payment_cancelled',
      { paymentId: id, number: before.number, studentId: before.studentId, reason: input.reason },
      { institutionId: before.institutionId },
    );
    return dto;
  },

  async refund(id: string, input: RefundPaymentInput) {
    const before = await loadPayment(id, 'fee.refund');
    await authorize(p(), 'fee.refund', before);
    if (before.status === 'CANCELLED') throw new ConflictError('Payment is cancelled');
    const refundable = toPaise(before.amount) - toPaise(before.refundedAmount);
    if (toPaise(input.amount) > refundable) {
      throw new ValidationError(`At most ₹${fromPaise(refundable).toFixed(2)} can be refunded`);
    }
    const keys = await ensureChartOfAccounts();
    const advanceLeft = Math.max(
      0,
      toPaise(before.amount) - toPaise(before.allocatedAmount) - toPaise(before.refundedAmount),
    );
    const fromAdvance = Math.min(advanceLeft, toPaise(input.amount));
    const fromIncome = toPaise(input.amount) - fromAdvance;
    const refundedOn = input.refundedOn ?? today();
    const refund = await tenantDb().$transaction(async (tx) => {
      const [number] = await nextNumbers(tx, before.institutionId, 'REFUND');
      const row = await tx.feeRefund.create({
        data: withTenant({
          groupId: before.groupId,
          institutionId: before.institutionId,
          campusId: before.campusId,
          departmentId: before.departmentId,
          paymentId: before.id,
          studentId: before.studentId,
          number: number as string,
          refundedOn: toDate(refundedOn),
          amount: input.amount,
          mode: 'UPI',
          reference: input.reference.toUpperCase(),
          reason: input.reason,
          refundedByUserId: p().userId ?? null,
        }),
      });
      const updated = await tx.feePayment.update({
        where: { id: before.id },
        data: { refundedAmount: { increment: input.amount } },
      });
      if (toPaise(updated.refundedAmount) > toPaise(updated.amount)) {
        throw new ConflictError('Payment changed concurrently; retry the refund');
      }
      await tx.feePayment.update({
        where: { id: before.id },
        data: {
          status:
            toPaise(updated.refundedAmount) >= toPaise(updated.amount)
              ? 'REFUNDED'
              : 'PARTIALLY_REFUNDED',
        },
      });
      const voucher = await postVoucher(tx, {
        scope: before,
        voucherDate: toDate(refundedOn),
        type: 'PAYMENT',
        narration: `Fee refund ${row.number} against receipt ${before.number}: ${input.reason}`,
        sourceType: 'FEE_REFUND',
        sourceId: row.id,
        sourceKey: `fee_refund:${row.id}`,
        lines: [
          { accountId: accountFor(keys, 'fee_advance'), debit: fromPaise(fromAdvance), credit: 0 },
          { accountId: accountFor(keys, 'fee_refunds'), debit: fromPaise(fromIncome), credit: 0 },
          {
            accountId: accountFor(keys, moneyAccountKey('UPI')),
            debit: 0,
            credit: input.amount,
          },
        ],
      });
      return tx.feeRefund.update({ where: { id: row.id }, data: { voucherId: voucher.id } });
    });
    const after = await loadPayment(id);
    const dto = toPaymentDto(after, await studentRef(after.studentId));
    await audit.record({
      action: 'fee_payment.refunded',
      entityType: 'fee_payment',
      entityId: id,
      before: toPaymentDto(before),
      after: dto,
      reason: input.reason,
      metadata: { refundId: refund.id, number: refund.number, amount: input.amount },
    });
    await emit(
      'fee.refund_issued',
      {
        paymentId: id,
        refundId: refund.id,
        studentId: before.studentId,
        amount: input.amount,
      },
      { institutionId: before.institutionId },
    );
    return dto;
  },

  /** Branded receipt PDF (template `fee_receipt`). */
  async receiptPdf(id: string) {
    const pay = await loadPayment(id);
    const db = tenantDb();
    const [student, inst] = await Promise.all([
      db.student.findUniqueOrThrow({
        where: { id: pay.studentId },
        include: { classSection: { select: { name: true } } },
      }),
      db.institution.findUniqueOrThrow({
        where: { id: pay.institutionId },
        select: { name: true },
      }),
    ]);
    const money = (v: number) =>
      `Rs. ${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const rendered = await renderPdfTemplate(
      FEE_RECEIPT_TEMPLATE,
      {
        receiptNo: pay.number,
        date: dateStr(pay.paidOn),
        institution: inst.name,
        studentName: student.displayName,
        admissionNo: student.admissionNo,
        classSection: student.classSection?.name ?? '',
        mode: pay.mode,
        reference: pay.reference ?? '',
        amount: money(num(pay.amount)),
        allocations: (pay.allocations ?? []).map((a) => [
          a.invoice?.number ?? a.invoiceId,
          money(num(a.amount)),
        ]),
        advance: money(fromPaise(toPaise(pay.amount) - toPaise(pay.allocatedAmount))),
        status: pay.status,
        refunded: money(num(pay.refundedAmount)),
      },
      {
        groupId: pay.groupId,
        institutionId: pay.institutionId,
        campusId: pay.campusId,
        departmentId: pay.departmentId,
      },
    );
    return { body: rendered.body, fileName: `receipt-${pay.number}.pdf` };
  },
};

/**
 * Marks a legacy gateway order paid and records the ONLINE receipt (idempotent). New checkouts
 * are no longer created — fees are paid via UPI — but webhooks for orders already in flight
 * still settle.
 */
export async function completeOrder(orderId: string, providerPaymentId: string | null) {
  const db = tenantDb();
  // Claim the order atomically so the callback and the webhook cannot both record a receipt.
  const claimed = await db.paymentGatewayOrder.updateMany({
    where: { id: orderId, status: { in: ['CREATED', 'FAILED'] } },
    data: { status: 'PROCESSING', providerPaymentId },
  });
  const order = await db.paymentGatewayOrder.findUniqueOrThrow({ where: { id: orderId } });
  if (claimed.count === 0) {
    if (order.paymentId) return feePaymentService.get(order.paymentId).catch(() => null);
    return null;
  }
  try {
    const student = await db.student.findUniqueOrThrow({ where: { id: order.studentId } });
    const invoiceIds = (order.invoiceIds as string[]) ?? [];
    const open = await db.feeInvoice.findMany({
      where: { id: { in: invoiceIds }, status: { in: ['UNPAID', 'PARTIAL'] } },
      orderBy: { dueDate: 'asc' },
    });
    let left = toPaise(order.amount);
    const allocations: Array<{ invoiceId: string; amount: number }> = [];
    for (const inv of open) {
      const take = Math.min(left, toPaise(inv.netAmount) - toPaise(inv.paidAmount));
      if (take <= 0) continue;
      allocations.push({ invoiceId: inv.id, amount: fromPaise(take) });
      left -= take;
    }
    const dto = await recordPaymentInternal(student, {
      amount: num(order.amount),
      paidOn: today(),
      mode: 'ONLINE',
      reference: providerPaymentId ?? order.providerOrderId,
      remarks: `Online payment via ${order.provider} (order ${order.providerOrderId})`,
      allocations,
      gatewayOrderId: order.id,
    });
    await db.paymentGatewayOrder.update({
      where: { id: order.id },
      data: { status: 'PAID', paymentId: dto.id, completedAt: new Date() },
    });
    return dto;
  } catch (err) {
    await db.paymentGatewayOrder.update({
      where: { id: order.id },
      data: { status: 'FAILED', failureReason: String((err as Error).message).slice(0, 500) },
    });
    throw err;
  }
}

/** Handles a verified gateway webhook event (runs as system in the order's tenant). */
export async function handleGatewayEvent(event: GatewayWebhookEvent): Promise<FeePayment | null> {
  const order = await tenantDb().paymentGatewayOrder.findFirst({
    where: { providerOrderId: event.providerOrderId },
  });
  if (!order) return null;
  if (event.type === 'payment.failed') {
    await tenantDb().paymentGatewayOrder.updateMany({
      where: { id: order.id, status: 'CREATED' },
      data: { status: 'FAILED', failureReason: (event.reason ?? 'Payment failed').slice(0, 500) },
    });
    return null;
  }
  if (event.type !== 'payment.captured') return null;
  const dto = await completeOrder(order.id, event.providerPaymentId);
  return dto ? tenantDb().feePayment.findUnique({ where: { id: dto.id } }) : null;
}
