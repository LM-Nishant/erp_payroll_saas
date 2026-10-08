import type { Prisma } from '@prisma/client';
import { isUniqueViolation } from '../../core/db/helpers';
import { InvalidReferenceError } from '../../core/http/errors';
import { currentPrincipal } from '../../core/authz';
import { tenantDb, withTenant } from '../../core/tenancy';
import { assertBalanced, formatDocNumber, type DraftLine } from './finance.logic';

/*
 * Finance posting engine shared by fees, expenses and the payroll listener: default chart of
 * accounts, per-institution document number series and idempotent double-entry posting.
 */

export type Db = ReturnType<typeof tenantDb>;
export type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];

type AccountSeed = {
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  systemKey: string;
  parent?: string;
  isGroup?: boolean;
};

/** Default chart of accounts (seeded per organization on first use). */
export const DEFAULT_ACCOUNTS: AccountSeed[] = [
  { code: '1000', name: 'Assets', type: 'ASSET', systemKey: 'assets', isGroup: true },
  { code: '1100', name: 'Cash in hand', type: 'ASSET', systemKey: 'cash', parent: 'assets' },
  { code: '1200', name: 'Bank accounts', type: 'ASSET', systemKey: 'bank', parent: 'assets' },
  {
    code: '1300',
    name: 'Fee receivable',
    type: 'ASSET',
    systemKey: 'fee_receivable',
    parent: 'assets',
  },
  {
    code: '1400',
    name: 'Payment gateway clearing',
    type: 'ASSET',
    systemKey: 'gateway_clearing',
    parent: 'assets',
  },
  { code: '2000', name: 'Liabilities', type: 'LIABILITY', systemKey: 'liabilities', isGroup: true },
  {
    code: '2100',
    name: 'Fees received in advance',
    type: 'LIABILITY',
    systemKey: 'fee_advance',
    parent: 'liabilities',
  },
  {
    code: '2200',
    name: 'Salary payable',
    type: 'LIABILITY',
    systemKey: 'salary_payable',
    parent: 'liabilities',
  },
  {
    code: '2300',
    name: 'Statutory dues payable',
    type: 'LIABILITY',
    systemKey: 'statutory_payable',
    parent: 'liabilities',
  },
  {
    code: '2400',
    name: 'GST payable',
    type: 'LIABILITY',
    systemKey: 'tax_payable',
    parent: 'liabilities',
  },
  {
    code: '2500',
    name: 'Sundry creditors',
    type: 'LIABILITY',
    systemKey: 'creditors',
    parent: 'liabilities',
  },
  { code: '3000', name: 'Funds', type: 'EQUITY', systemKey: 'funds', isGroup: true },
  { code: '3100', name: 'Corpus fund', type: 'EQUITY', systemKey: 'corpus_fund', parent: 'funds' },
  { code: '4000', name: 'Income', type: 'INCOME', systemKey: 'income', isGroup: true },
  {
    code: '4100',
    name: 'Fee income',
    type: 'INCOME',
    systemKey: 'fee_income',
    parent: 'income',
    isGroup: true,
  },
  {
    code: '4110',
    name: 'Tuition fee',
    type: 'INCOME',
    systemKey: 'income_tuition',
    parent: 'fee_income',
  },
  {
    code: '4120',
    name: 'Transport fee',
    type: 'INCOME',
    systemKey: 'income_transport',
    parent: 'fee_income',
  },
  {
    code: '4130',
    name: 'Hostel fee',
    type: 'INCOME',
    systemKey: 'income_hostel',
    parent: 'fee_income',
  },
  {
    code: '4140',
    name: 'Library fee & fines',
    type: 'INCOME',
    systemKey: 'income_library',
    parent: 'fee_income',
  },
  {
    code: '4150',
    name: 'Exam fee',
    type: 'INCOME',
    systemKey: 'income_exam',
    parent: 'fee_income',
  },
  {
    code: '4160',
    name: 'Admission fee',
    type: 'INCOME',
    systemKey: 'income_admission',
    parent: 'fee_income',
  },
  {
    code: '4190',
    name: 'Other fees',
    type: 'INCOME',
    systemKey: 'income_misc',
    parent: 'fee_income',
  },
  {
    code: '4200',
    name: 'Late fee income',
    type: 'INCOME',
    systemKey: 'late_fee_income',
    parent: 'income',
  },
  {
    code: '4900',
    name: 'Other income',
    type: 'INCOME',
    systemKey: 'other_income',
    parent: 'income',
  },
  { code: '5000', name: 'Expenses', type: 'EXPENSE', systemKey: 'expenses', isGroup: true },
  {
    code: '5100',
    name: 'Salaries & wages',
    type: 'EXPENSE',
    systemKey: 'salary_expense',
    parent: 'expenses',
  },
  {
    code: '5200',
    name: 'Employer contributions',
    type: 'EXPENSE',
    systemKey: 'employer_contribution',
    parent: 'expenses',
  },
  {
    code: '5300',
    name: 'Fee concessions & scholarships',
    type: 'EXPENSE',
    systemKey: 'concession_expense',
    parent: 'expenses',
  },
  {
    code: '5400',
    name: 'Fee refunds',
    type: 'EXPENSE',
    systemKey: 'fee_refunds',
    parent: 'expenses',
  },
  {
    code: '5500',
    name: 'Electricity & utilities',
    type: 'EXPENSE',
    systemKey: 'utilities',
    parent: 'expenses',
  },
  {
    code: '5600',
    name: 'Repairs & maintenance',
    type: 'EXPENSE',
    systemKey: 'maintenance',
    parent: 'expenses',
  },
  {
    code: '5700',
    name: 'Office & administration',
    type: 'EXPENSE',
    systemKey: 'admin_expense',
    parent: 'expenses',
  },
  {
    code: '5800',
    name: 'Transport running',
    type: 'EXPENSE',
    systemKey: 'transport_expense',
    parent: 'expenses',
  },
  {
    code: '5900',
    name: 'General expenses',
    type: 'EXPENSE',
    systemKey: 'general_expense',
    parent: 'expenses',
  },
];

/** Income account system key for a fee-head category. */
export const incomeKeyForCategory = (category: string) =>
  `income_${category.toLowerCase()}` as const;

/** Creates any missing default accounts (idempotent). Returns systemKey → account id. */
export async function ensureChartOfAccounts(
  db: Db | Tx = tenantDb(),
): Promise<Map<string, string>> {
  const existing = await db.ledgerAccount.findMany({
    where: { systemKey: { not: null } },
    select: { id: true, systemKey: true },
  });
  const byKey = new Map(existing.map((a) => [a.systemKey as string, a.id]));
  if (DEFAULT_ACCOUNTS.every((a) => byKey.has(a.systemKey))) return byKey;
  for (const seed of DEFAULT_ACCOUNTS) {
    if (byKey.has(seed.systemKey)) continue;
    const parentId = seed.parent ? (byKey.get(seed.parent) ?? null) : null;
    try {
      const created = await db.ledgerAccount.create({
        data: withTenant({
          parentId,
          code: seed.code,
          name: seed.name,
          type: seed.type,
          isGroup: seed.isGroup ?? false,
          systemKey: seed.systemKey,
        }),
        select: { id: true },
      });
      byKey.set(seed.systemKey, created.id);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Concurrent seeding or a user-created account with the same code: adopt / skip.
      const row = await db.ledgerAccount.findFirst({
        where: { OR: [{ systemKey: seed.systemKey }, { code: seed.code }] },
        select: { id: true },
      });
      if (row) byKey.set(seed.systemKey, row.id);
    }
  }
  return byKey;
}

export function accountFor(keys: Map<string, string>, key: string): string {
  const id = keys.get(key);
  if (!id) throw new Error(`Ledger account ${key} is missing`);
  return id;
}

export type SeriesKind = 'INVOICE' | 'RECEIPT' | 'REFUND' | 'VOUCHER' | 'EXPENSE';
const SERIES_PREFIX: Record<SeriesKind, string> = {
  INVOICE: 'INV',
  RECEIPT: 'RCT',
  REFUND: 'RFD',
  VOUCHER: 'JV',
  EXPENSE: 'EXP',
};

/** Allocates `count` consecutive numbers from the institution's series (row lock in the tx). */
export async function nextNumbers(
  tx: Tx,
  institutionId: string,
  kind: SeriesKind,
  count = 1,
): Promise<string[]> {
  let series = await tx.financeNumberSeries.findFirst({ where: { institutionId, kind } });
  if (!series) {
    const inst = await tx.institution.findUnique({
      where: { id: institutionId },
      select: { code: true },
    });
    try {
      series = await tx.financeNumberSeries.create({
        data: withTenant({
          institutionId,
          kind,
          prefix: `${SERIES_PREFIX[kind]}-${(inst?.code ?? 'X').toUpperCase()}-`,
          nextValue: 1,
          padding: 5,
        }),
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      series = await tx.financeNumberSeries.findFirstOrThrow({ where: { institutionId, kind } });
    }
  }
  const updated = await tx.financeNumberSeries.update({
    where: { id: series.id },
    data: { nextValue: { increment: count } },
  });
  const first = updated.nextValue - count;
  return Array.from({ length: count }, (_, i) =>
    formatDocNumber(updated.prefix, first + i, updated.padding),
  );
}

export interface InstitutionScope {
  groupId: string | null;
  institutionId: string;
  campusId?: string | null;
  departmentId?: string | null;
}

export async function institutionScope(
  institutionId: string,
  db: Db | Tx = tenantDb(),
): Promise<InstitutionScope> {
  const inst = await db.institution.findUnique({
    where: { id: institutionId },
    select: { id: true, groupId: true },
  });
  if (!inst) throw new InvalidReferenceError('institutionId', 'Institution');
  return { groupId: inst.groupId, institutionId: inst.id };
}

export interface PostVoucherInput {
  scope: InstitutionScope;
  voucherDate: Date;
  type?: 'JOURNAL' | 'RECEIPT' | 'PAYMENT' | 'CONTRA';
  narration: string;
  sourceType: string;
  sourceId?: string | null;
  /** Idempotency key: an existing voucher with the key is returned instead of re-posting. */
  sourceKey?: string | null;
  lines: DraftLine[];
  status?: 'DRAFT' | 'POSTED';
}

/** Creates (and by default posts) a balanced voucher inside `tx`. */
export async function postVoucher(tx: Tx, input: PostVoucherInput) {
  if (input.sourceKey) {
    const existing = await tx.journalVoucher.findFirst({ where: { sourceKey: input.sourceKey } });
    if (existing) return existing;
  }
  const { lines, total } = assertBalanced(input.lines);
  const [number] = await nextNumbers(tx, input.scope.institutionId, 'VOUCHER');
  const status = input.status ?? 'POSTED';
  const userId = currentPrincipal().userId ?? null;
  const voucher = await tx.journalVoucher.create({
    data: withTenant({
      groupId: input.scope.groupId,
      institutionId: input.scope.institutionId,
      campusId: input.scope.campusId ?? null,
      departmentId: input.scope.departmentId ?? null,
      number: number as string,
      voucherDate: input.voucherDate,
      type: input.type ?? 'JOURNAL',
      narration: input.narration.slice(0, 1000),
      status,
      totalAmount: total,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      sourceKey: input.sourceKey ?? null,
      postedAt: status === 'POSTED' ? new Date() : null,
      postedByUserId: status === 'POSTED' ? userId : null,
      createdByUserId: userId,
    } as Prisma.JournalVoucherUncheckedCreateInput),
  });
  await tx.journalLine.createMany({
    data: lines.map((l, i) =>
      withTenant({
        voucherId: voucher.id,
        accountId: l.accountId,
        lineNo: i + 1,
        debit: l.debit,
        credit: l.credit,
        narration: l.narration ?? null,
      }),
    ),
  });
  return voucher;
}

/** Marks a voucher cancelled (excluded from books). No-op for missing / already cancelled. */
export async function cancelVoucherInTx(tx: Tx, voucherId: string | null, reason: string) {
  if (!voucherId) return;
  await tx.journalVoucher.updateMany({
    where: { id: voucherId, status: { not: 'CANCELLED' } },
    data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason.slice(0, 500) },
  });
}

/** Cash for cash payments, bank (or the gateway clearing account) for everything else. */
export function moneyAccountKey(mode: string): string {
  return mode === 'CASH' ? 'cash' : 'bank';
}
