import type { FeeUpiPayment, Prisma, Student } from '@prisma/client';
import type {
  FeeUpiPaymentDto,
  FeeUpiSettingDto,
  FeeUpiSettingInput,
  RejectUpiPaymentInput,
  SubmitUpiPaymentInput,
  UpiIntentDto,
  UpiIntentInput,
} from '@erp/shared';
import QRCode from 'qrcode';
import { audit } from '../../core/audit';
import {
  andScope,
  authorize,
  can,
  completeResource,
  currentPrincipal,
  findScopeHolders,
  scopeWhere,
} from '../../core/authz';
import { ConflictError, NotFoundError, ValidationError } from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { publish } from '../../core/notifications';
import { tenantDb, withTenant } from '../../core/tenancy';
import { institutionScope } from '../finance/finance.ledger';
import { fromPaise, toPaise } from '../finance/finance.logic';
import { dateStr, num, toDate, today } from '../finance/finance.mappers';
import { loadFeeStudent } from './fees.access';
import { recordPaymentInternal } from './fees.payments.service';

/*
 * UPI-only fee collection: each institution configures its UPI ID; the payer scans the QR
 * (or opens the upi:// link), pays in any UPI app and submits the UTR; an accountant with
 * fee.collect verifies it against the bank statement, which records the receipt.
 */

const p = () => currentPrincipal();

const studentScope = (s: Student) => ({
  groupId: s.groupId,
  institutionId: s.institutionId,
  campusId: s.campusId,
  departmentId: s.departmentId,
});

function toSettingDto(
  row: {
    id: string;
    institutionId: string;
    upiId: string;
    payeeName: string;
    active: boolean;
    updatedAt: Date;
  },
  institutionName?: string,
): FeeUpiSettingDto {
  return {
    id: row.id,
    institutionId: row.institutionId,
    ...(institutionName ? { institutionName } : {}),
    upiId: row.upiId,
    payeeName: row.payeeName,
    active: row.active,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toUpiPaymentDto(
  row: FeeUpiPayment,
  refs: {
    student?: { id: string; displayName: string; admissionNo: string } | null;
    invoiceNumbers?: Map<string, string>;
    receiptNumber?: string | null;
  } = {},
): FeeUpiPaymentDto {
  const invoiceIds = (row.invoiceIds as string[]) ?? [];
  return {
    id: row.id,
    institutionId: row.institutionId,
    studentId: row.studentId,
    ...(refs.student !== undefined ? { student: refs.student } : {}),
    invoiceIds,
    ...(refs.invoiceNumbers
      ? { invoiceNumbers: invoiceIds.map((id) => refs.invoiceNumbers?.get(id) ?? id) }
      : {}),
    amount: num(row.amount),
    utr: row.utr,
    paidOn: dateStr(row.paidOn),
    upiId: row.upiId,
    status: row.status as FeeUpiPaymentDto['status'],
    paymentId: row.paymentId,
    ...(refs.receiptNumber !== undefined ? { receiptNumber: refs.receiptNumber } : {}),
    remarks: row.remarks,
    rejectReason: row.rejectReason,
    submittedAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
  };
}

/** DTOs with student, invoice and receipt references resolved. */
async function withRefs(rows: FeeUpiPayment[]): Promise<FeeUpiPaymentDto[]> {
  if (rows.length === 0) return [];
  const db = tenantDb();
  const invoiceIds = [...new Set(rows.flatMap((r) => (r.invoiceIds as string[]) ?? []))];
  const paymentIds = rows.map((r) => r.paymentId).filter((v): v is string => !!v);
  const [students, invoices, payments] = await Promise.all([
    db.student.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.studentId))] } },
      select: { id: true, displayName: true, admissionNo: true },
    }),
    db.feeInvoice.findMany({
      where: { id: { in: invoiceIds } },
      select: { id: true, number: true },
    }),
    paymentIds.length
      ? db.feePayment.findMany({
          where: { id: { in: paymentIds } },
          select: { id: true, number: true },
        })
      : Promise.resolve([]),
  ]);
  const studentRefs = new Map(students.map((s) => [s.id, s]));
  const invoiceNumbers = new Map(invoices.map((i) => [i.id, i.number]));
  const receipts = new Map(payments.map((x) => [x.id, x.number]));
  return rows.map((r) =>
    toUpiPaymentDto(r, {
      student: studentRefs.get(r.studentId) ?? null,
      invoiceNumbers,
      receiptNumber: r.paymentId ? (receipts.get(r.paymentId) ?? null) : null,
    }),
  );
}

/** Active UPI account of the institution (null when not configured). */
export async function activeUpiSetting(institutionId: string) {
  return tenantDb().feeUpiSetting.findFirst({ where: { institutionId, active: true } });
}

/** NPCI UPI deep link (`upi://pay`). */
export function feeUpiUri(input: {
  upiId: string;
  payeeName: string;
  amount: number;
  note: string;
}): string {
  const params = new URLSearchParams({
    pa: input.upiId,
    pn: input.payeeName,
    am: input.amount.toFixed(2),
    cu: 'INR',
    tn: input.note.slice(0, 80),
  });
  return `upi://pay?${params.toString().replace(/\+/g, '%20')}`;
}

/** Open invoices of the student among `invoiceIds` and their outstanding total. */
async function payableInvoices(student: Student, invoiceIds: string[]) {
  const unique = [...new Set(invoiceIds)];
  const invoices = await tenantDb().feeInvoice.findMany({
    where: { id: { in: unique }, studentId: student.id, status: { in: ['UNPAID', 'PARTIAL'] } },
    orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
  });
  if (invoices.length !== unique.length) {
    throw new ValidationError('Select open invoices of the student');
  }
  const amount = fromPaise(
    invoices.reduce((s, i) => s + toPaise(i.netAmount) - toPaise(i.paidAmount), 0),
  );
  if (amount <= 0) throw new ValidationError('Nothing to pay');
  return { invoices, amount };
}

async function requireUpi(institutionId: string) {
  const setting = await activeUpiSetting(institutionId);
  if (!setting) {
    throw new ConflictError(
      'UPI payment is not set up for this institution yet. Please contact the accounts office.',
    );
  }
  return setting;
}

async function loadUpiPayment(id: string) {
  const row = await tenantDb().feeUpiPayment.findUnique({ where: { id } });
  if (!row) throw new NotFoundError('UPI payment');
  if (!(await can(p(), 'fee.collect', row))) throw new NotFoundError('UPI payment');
  await authorize(p(), 'fee.collect', row);
  return row;
}

export const feeUpiService = {
  /* ------------------------------- Institution settings ------------------------------- */

  async listSettings(query: { institutionId?: string }): Promise<FeeUpiSettingDto[]> {
    const db = tenantDb();
    const institutions = await db.institution.findMany({
      where: andScope(
        query.institutionId ? { id: query.institutionId } : {},
        await scopeWhere(p(), 'fee.view', 'institution'),
      ),
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const names = new Map(institutions.map((i) => [i.id, i.name]));
    const rows = await db.feeUpiSetting.findMany({
      where: { institutionId: { in: [...names.keys()] } },
    });
    return rows
      .map((r) => toSettingDto(r, names.get(r.institutionId)))
      .sort((a, b) => (a.institutionName ?? '').localeCompare(b.institutionName ?? ''));
  },

  async saveSetting(input: FeeUpiSettingInput): Promise<FeeUpiSettingDto> {
    const scope = await institutionScope(input.institutionId);
    await authorize(p(), 'fee.manage', scope);
    const db = tenantDb();
    const existing = await db.feeUpiSetting.findFirst({
      where: { institutionId: input.institutionId },
    });
    const data = {
      upiId: input.upiId,
      payeeName: input.payeeName,
      active: input.active,
      updatedByUserId: p().userId ?? null,
    };
    const row = existing
      ? await db.feeUpiSetting.update({ where: { id: existing.id }, data })
      : await db.feeUpiSetting.create({
          data: withTenant({ ...scope, ...data }),
        });
    await audit.record({
      action: existing ? 'fee_upi_setting.updated' : 'fee_upi_setting.created',
      entityType: 'fee_upi_setting',
      entityId: row.id,
      before: existing ? toSettingDto(existing) : undefined,
      after: toSettingDto(row),
    });
    const inst = await db.institution.findUnique({
      where: { id: row.institutionId },
      select: { name: true },
    });
    return toSettingDto(row, inst?.name);
  },

  /* ---------------------------------- Payer (portal) ---------------------------------- */

  /** QR + upi:// link for the selected invoices (student, guardian or staff). */
  async intent(input: UpiIntentInput): Promise<UpiIntentDto> {
    const { student } = await loadFeeStudent(input.studentId, 'fee.collect');
    const setting = await requireUpi(student.institutionId);
    const { invoices, amount } = await payableInvoices(student, input.invoiceIds);
    const note = `Fees ${student.admissionNo} ${invoices.map((i) => i.number).join(',')}`;
    const upiUri = feeUpiUri({
      upiId: setting.upiId,
      payeeName: setting.payeeName,
      amount,
      note,
    });
    return {
      studentId: student.id,
      invoiceIds: invoices.map((i) => i.id),
      amount,
      upiId: setting.upiId,
      payeeName: setting.payeeName,
      note: note.slice(0, 80),
      upiUri,
      qrDataUrl: await QRCode.toDataURL(upiUri, { margin: 1, width: 280 }),
    };
  },

  /** Payer reports a completed UPI transfer; the accountant verifies it. */
  async submit(input: SubmitUpiPaymentInput): Promise<FeeUpiPaymentDto> {
    const { student } = await loadFeeStudent(input.studentId, 'fee.collect');
    const setting = await requireUpi(student.institutionId);
    const { invoices, amount } = await payableInvoices(student, input.invoiceIds);
    const db = tenantDb();
    const utr = input.utr.toUpperCase();
    const [dupSubmission, dupReceipt, pendingForInvoice] = await Promise.all([
      db.feeUpiPayment.findFirst({
        where: { utr, status: { in: ['PENDING', 'VERIFIED'] } },
        select: { id: true },
      }),
      db.feePayment.findFirst({
        where: { reference: utr, status: { not: 'CANCELLED' } },
        select: { id: true },
      }),
      db.feeUpiPayment.findMany({
        where: { studentId: student.id, status: 'PENDING' },
        select: { invoiceIds: true },
      }),
    ]);
    if (dupSubmission || dupReceipt) {
      throw new ConflictError('This UTR has already been submitted');
    }
    const pendingIds = new Set(pendingForInvoice.flatMap((r) => (r.invoiceIds as string[]) ?? []));
    if (invoices.some((i) => pendingIds.has(i.id))) {
      throw new ConflictError('A UPI payment for these invoices is already awaiting verification');
    }
    const paidOn = input.paidOn ?? today();
    if (paidOn > today()) throw new ValidationError('Payment date cannot be in the future');
    const row = await db.feeUpiPayment.create({
      data: withTenant({
        ...studentScope(student),
        studentId: student.id,
        invoiceIds: invoices.map((i) => i.id),
        amount,
        utr,
        paidOn: toDate(paidOn),
        upiId: setting.upiId,
        status: 'PENDING',
        remarks: input.remarks ?? null,
        submittedByUserId: p().userId ?? null,
      }),
    });
    const [dto] = await withRefs([row]);
    await audit.record({
      action: 'fee_upi_payment.submitted',
      entityType: 'fee_upi_payment',
      entityId: row.id,
      after: dto,
    });
    const reviewers = (
      await findScopeHolders({
        permission: 'fee.collect',
        resource: await completeResource(studentScope(student)),
      })
    ).filter((id) => id !== p().userId);
    if (reviewers.length > 0) {
      await publish('fee.upi_submitted', {
        recipients: reviewers,
        title: `UPI payment to verify: ₹${amount.toFixed(2)}`,
        body: `${student.displayName} (${student.admissionNo}) reported UTR ${utr}.`,
        link: '/institution/fees/upi',
        data: { upiPaymentId: row.id, studentId: student.id },
        institutionId: student.institutionId,
      });
    }
    return dto as FeeUpiPaymentDto;
  },

  /** The current user's own / wards' submissions. */
  async forStudent(studentId: string): Promise<FeeUpiPaymentDto[]> {
    const rows = await tenantDb().feeUpiPayment.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return withRefs(rows);
  },

  /* ---------------------------------- Accountant ------------------------------------- */

  async list(query: {
    page: number;
    pageSize: number;
    search?: string;
    institutionId?: string;
    studentId?: string;
    status?: string;
  }) {
    const where: Prisma.FeeUpiPaymentWhereInput = {
      ...(query.institutionId ? { institutionId: query.institutionId } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { utr: { contains: query.search } } : {}),
    };
    const scoped = andScope(where, await scopeWhere(p(), 'fee.collect', 'finance'));
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.feeUpiPayment.findMany({
        where: scoped,
        orderBy: [{ createdAt: 'desc' }],
        ...toPageWindow(query),
      }),
      db.feeUpiPayment.count({ where: scoped }),
    ]);
    return { items: await withRefs(rows), total };
  },

  async verify(id: string): Promise<FeeUpiPaymentDto> {
    const row = await loadUpiPayment(id);
    const db = tenantDb();
    const claimed = await db.feeUpiPayment.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'VERIFYING' },
    });
    if (claimed.count === 0) throw new ConflictError(`UPI payment is already ${row.status}`);
    try {
      const student = await db.student.findUniqueOrThrow({ where: { id: row.studentId } });
      const open = await db.feeInvoice.findMany({
        where: {
          id: { in: (row.invoiceIds as string[]) ?? [] },
          status: { in: ['UNPAID', 'PARTIAL'] },
        },
        orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
      });
      let left = toPaise(row.amount);
      const allocations: Array<{ invoiceId: string; amount: number }> = [];
      for (const inv of open) {
        const take = Math.min(left, toPaise(inv.netAmount) - toPaise(inv.paidAmount));
        if (take <= 0) continue;
        allocations.push({ invoiceId: inv.id, amount: fromPaise(take) });
        left -= take;
      }
      const payment = await recordPaymentInternal(student, {
        amount: num(row.amount),
        paidOn: dateStr(row.paidOn),
        mode: 'UPI',
        reference: row.utr,
        remarks: `UPI to ${row.upiId}${row.remarks ? ` — ${row.remarks}` : ''}`,
        allocations,
      });
      const updated = await db.feeUpiPayment.update({
        where: { id },
        data: {
          status: 'VERIFIED',
          paymentId: payment.id,
          reviewedByUserId: p().userId ?? null,
          reviewedAt: new Date(),
        },
      });
      const [dto] = await withRefs([updated]);
      await audit.record({
        action: 'fee_upi_payment.verified',
        entityType: 'fee_upi_payment',
        entityId: id,
        after: dto,
        metadata: { paymentId: payment.id, receipt: payment.number },
      });
      return dto as FeeUpiPaymentDto;
    } catch (err) {
      await db.feeUpiPayment.updateMany({
        where: { id, status: 'VERIFYING' },
        data: { status: 'PENDING' },
      });
      throw err;
    }
  },

  async reject(id: string, input: RejectUpiPaymentInput): Promise<FeeUpiPaymentDto> {
    const row = await loadUpiPayment(id);
    const db = tenantDb();
    const claimed = await db.feeUpiPayment.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: 'REJECTED',
        rejectReason: input.reason,
        reviewedByUserId: p().userId ?? null,
        reviewedAt: new Date(),
      },
    });
    if (claimed.count === 0) throw new ConflictError(`UPI payment is already ${row.status}`);
    const updated = await db.feeUpiPayment.findUniqueOrThrow({ where: { id } });
    const [dto] = await withRefs([updated]);
    await audit.record({
      action: 'fee_upi_payment.rejected',
      entityType: 'fee_upi_payment',
      entityId: id,
      after: dto,
      reason: input.reason,
    });
    const recipients = [row.submittedByUserId].filter((v): v is string => !!v);
    if (recipients.length > 0) {
      await publish('fee.upi_rejected', {
        recipients,
        title: `UPI payment not verified: ₹${num(row.amount).toFixed(2)}`,
        body: `UTR ${row.utr} was rejected: ${input.reason}`,
        link: '/portal/fees',
        data: { upiPaymentId: id, studentId: row.studentId },
        institutionId: row.institutionId,
      });
    }
    return dto as FeeUpiPaymentDto;
  },
};
