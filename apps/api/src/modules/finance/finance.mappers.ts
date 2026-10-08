import type {
  AccountType,
  ExpenseDto,
  JournalVoucherDto,
  LedgerAccountDto,
  PaymentMode,
  VendorDto,
  VoucherStatus,
  VoucherType,
} from '@erp/shared';
import type { Expense, JournalLine, JournalVoucher, LedgerAccount, Vendor } from '@prisma/client';

export const num = (v: { toString(): string } | number | null | undefined): number =>
  v === null || v === undefined ? 0 : Number(v.toString());
export const numOrNull = (v: { toString(): string } | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v.toString());
export const dateStr = (d: Date): string => d.toISOString().slice(0, 10);
export const toDate = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
export const today = (): string => new Date().toISOString().slice(0, 10);

export function toAccountDto(a: LedgerAccount): LedgerAccountDto {
  return {
    id: a.id,
    parentId: a.parentId,
    code: a.code,
    name: a.name,
    type: a.type as AccountType,
    isGroup: a.isGroup,
    systemKey: a.systemKey,
    description: a.description,
    active: a.active,
  };
}

export function toVoucherDto(
  v: JournalVoucher & {
    lines?: Array<JournalLine & { account?: Pick<LedgerAccount, 'code' | 'name'> | null }>;
  },
): JournalVoucherDto {
  return {
    id: v.id,
    institutionId: v.institutionId,
    number: v.number,
    voucherDate: dateStr(v.voucherDate),
    type: v.type as VoucherType,
    narration: v.narration,
    status: v.status as VoucherStatus,
    totalAmount: num(v.totalAmount),
    sourceType: v.sourceType,
    sourceId: v.sourceId,
    cancelReason: v.cancelReason,
    ...(v.lines
      ? {
          lines: [...v.lines]
            .sort((a, b) => a.lineNo - b.lineNo)
            .map((l) => ({
              id: l.id,
              accountId: l.accountId,
              accountCode: l.account?.code,
              accountName: l.account?.name,
              debit: num(l.debit),
              credit: num(l.credit),
              narration: l.narration,
            })),
        }
      : {}),
  };
}

export function toVendorDto(v: Vendor): VendorDto {
  return {
    id: v.id,
    institutionId: v.institutionId,
    code: v.code,
    name: v.name,
    gstin: v.gstin,
    phone: v.phone,
    email: v.email,
    address: v.address,
    active: v.active,
  };
}

export function toExpenseDto(
  e: Expense & { vendor?: Pick<Vendor, 'name'> | null },
  accountNames: Map<string, string> = new Map(),
): ExpenseDto {
  return {
    id: e.id,
    institutionId: e.institutionId,
    number: e.number,
    expenseDate: dateStr(e.expenseDate),
    vendorId: e.vendorId,
    vendorName: e.vendor?.name ?? null,
    expenseAccountId: e.expenseAccountId,
    expenseAccountName: accountNames.get(e.expenseAccountId) ?? null,
    paymentAccountId: e.paymentAccountId,
    amount: num(e.amount),
    mode: e.mode as PaymentMode,
    reference: e.reference,
    description: e.description,
    status: e.status,
    voucherId: e.voucherId,
  };
}
