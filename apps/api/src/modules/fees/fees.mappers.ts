import type {
  FeeConcessionDto,
  FeeHeadCategory,
  FeeHeadDto,
  FeeInvoiceDto,
  FeeInvoiceStatus,
  FeeLateRuleDto,
  FeePaymentDto,
  FeeStructureDto,
  PaymentMode,
} from '@erp/shared';
import type {
  FeeConcession,
  FeeHead,
  FeeInstallment,
  FeeInvoice,
  FeeInvoiceLine,
  FeeLateRule,
  FeePayment,
  FeePaymentAllocation,
  FeeRefund,
  FeeStructure,
  FeeStructureItem,
} from '@prisma/client';
import { fromPaise, toPaise } from '../finance/finance.logic';
import { dateStr, num, numOrNull } from '../finance/finance.mappers';

type StudentRef = { id: string; displayName: string; admissionNo: string } | null | undefined;

export function toFeeHeadDto(h: FeeHead): FeeHeadDto {
  return {
    id: h.id,
    institutionId: h.institutionId,
    code: h.code,
    name: h.name,
    category: h.category as FeeHeadCategory,
    refundable: h.refundable,
    taxRate: num(h.taxRate),
    incomeAccountId: h.incomeAccountId,
    sortOrder: h.sortOrder,
    active: h.active,
  };
}

export function toLateRuleDto(r: FeeLateRule): FeeLateRuleDto {
  return {
    id: r.id,
    institutionId: r.institutionId,
    name: r.name,
    mode: r.mode as 'FLAT' | 'PER_DAY',
    amount: num(r.amount),
    graceDays: r.graceDays,
    maxAmount: numOrNull(r.maxAmount),
    active: r.active,
  };
}

export type StructureWithInstallments = FeeStructure & {
  installments?: Array<
    FeeInstallment & { items: Array<FeeStructureItem & { feeHead?: Pick<FeeHead, 'name'> }> }
  >;
};

export function toStructureDto(s: StructureWithInstallments): FeeStructureDto {
  return {
    id: s.id,
    institutionId: s.institutionId,
    programId: s.programId,
    classSectionId: s.classSectionId,
    academicYear: s.academicYear,
    code: s.code,
    name: s.name,
    status: s.status,
    lateRuleId: s.lateRuleId,
    totalAmount: num(s.totalAmount),
    notes: s.notes,
    ...(s.installments
      ? {
          installments: [...s.installments]
            .sort((a, b) => a.seq - b.seq)
            .map((i) => ({
              id: i.id,
              seq: i.seq,
              label: i.label,
              dueDate: dateStr(i.dueDate),
              total: fromPaise(i.items.reduce((sum, it) => sum + toPaise(it.amount), 0)),
              items: i.items.map((it) => ({
                id: it.id,
                feeHeadId: it.feeHeadId,
                feeHeadName: it.feeHead?.name,
                amount: num(it.amount),
              })),
            })),
        }
      : {}),
  };
}

export function toConcessionDto(c: FeeConcession, studentName?: string | null): FeeConcessionDto {
  return {
    id: c.id,
    institutionId: c.institutionId,
    name: c.name,
    kind: c.kind,
    appliesTo: c.appliesTo as FeeConcessionDto['appliesTo'],
    studentId: c.studentId,
    studentName: studentName ?? null,
    category: c.category,
    feeHeadId: c.feeHeadId,
    valueType: c.valueType as 'PERCENT' | 'AMOUNT',
    value: num(c.value),
    academicYear: c.academicYear,
    reason: c.reason,
    active: c.active,
  };
}

export type InvoiceWithRefs = FeeInvoice & {
  lines?: Array<FeeInvoiceLine & { feeHead?: Pick<FeeHead, 'name'> | null }>;
};

export function toInvoiceDto(i: InvoiceWithRefs, student?: StudentRef): FeeInvoiceDto {
  const net = num(i.netAmount);
  const paid = num(i.paidAmount);
  return {
    id: i.id,
    number: i.number,
    institutionId: i.institutionId,
    classSectionId: i.classSectionId,
    studentId: i.studentId,
    student: student ?? null,
    academicYear: i.academicYear,
    structureId: i.structureId,
    installmentId: i.installmentId,
    sourceType: i.sourceType,
    sourceId: i.sourceId,
    description: i.description,
    issueDate: dateStr(i.issueDate),
    dueDate: dateStr(i.dueDate),
    grossAmount: num(i.grossAmount),
    concessionAmount: num(i.concessionAmount),
    taxAmount: num(i.taxAmount),
    lateFeeAmount: num(i.lateFeeAmount),
    netAmount: net,
    paidAmount: paid,
    balance: i.status === 'CANCELLED' ? 0 : fromPaise(Math.max(0, toPaise(net) - toPaise(paid))),
    status: i.status as FeeInvoiceStatus,
    cancelReason: i.cancelReason,
    ...(i.lines
      ? {
          lines: i.lines.map((l) => ({
            id: l.id,
            feeHeadId: l.feeHeadId,
            feeHeadName: l.feeHead?.name,
            description: l.description,
            amount: num(l.amount),
            concessionAmount: num(l.concessionAmount),
            taxAmount: num(l.taxAmount),
            netAmount: num(l.netAmount),
          })),
        }
      : {}),
  };
}

export type PaymentWithRefs = FeePayment & {
  allocations?: Array<FeePaymentAllocation & { invoice?: Pick<FeeInvoice, 'number'> | null }>;
  refunds?: FeeRefund[];
};

export function toPaymentDto(p: PaymentWithRefs, student?: StudentRef): FeePaymentDto {
  return {
    id: p.id,
    number: p.number,
    institutionId: p.institutionId,
    studentId: p.studentId,
    student: student ?? null,
    paidOn: dateStr(p.paidOn),
    mode: p.mode as PaymentMode,
    reference: p.reference,
    amount: num(p.amount),
    allocatedAmount: num(p.allocatedAmount),
    refundedAmount: num(p.refundedAmount),
    status: p.status,
    remarks: p.remarks,
    cancelReason: p.cancelReason,
    voucherId: p.voucherId,
    ...(p.allocations
      ? {
          allocations: p.allocations.map((a) => ({
            invoiceId: a.invoiceId,
            invoiceNumber: a.invoice?.number,
            amount: num(a.amount),
          })),
        }
      : {}),
    ...(p.refunds
      ? {
          refunds: p.refunds.map((r) => ({
            id: r.id,
            number: r.number,
            amount: num(r.amount),
            refundedOn: dateStr(r.refundedOn),
            reason: r.reason,
          })),
        }
      : {}),
  };
}
