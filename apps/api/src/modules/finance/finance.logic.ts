/*
 * Pure finance helpers (no I/O): money rounding, double-entry validation and report math.
 * Money is handled in integer paise internally to avoid floating point drift.
 */

export const toPaise = (v: number | string | { toString(): string } | null | undefined): number =>
  v === null || v === undefined ? 0 : Math.round(Number(v.toString()) * 100);
export const fromPaise = (p: number): number => Math.round(p) / 100;
export const round2 = (v: number): number => fromPaise(toPaise(v));

export interface DraftLine {
  accountId: string;
  debit: number;
  credit: number;
  narration?: string | null;
}

export class UnbalancedVoucherError extends Error {
  constructor(
    readonly debit: number,
    readonly credit: number,
  ) {
    super(`Voucher is not balanced: debit ${debit.toFixed(2)} ≠ credit ${credit.toFixed(2)}`);
  }
}

/**
 * Normalises voucher lines (rounds to paise, drops zero lines) and verifies the voucher is
 * balanced (total debit = total credit > 0). Returns the kept lines and the voucher total.
 */
export function assertBalanced(lines: DraftLine[]): { lines: DraftLine[]; total: number } {
  const kept = lines
    .map((l) => ({ ...l, debit: round2(l.debit), credit: round2(l.credit) }))
    .filter((l) => l.debit !== 0 || l.credit !== 0);
  for (const l of kept) {
    if (l.debit < 0 || l.credit < 0) throw new UnbalancedVoucherError(l.debit, l.credit);
    if (l.debit > 0 && l.credit > 0) throw new UnbalancedVoucherError(l.debit, l.credit);
  }
  const dr = kept.reduce((s, l) => s + toPaise(l.debit), 0);
  const cr = kept.reduce((s, l) => s + toPaise(l.credit), 0);
  if (kept.length < 2 || dr !== cr || dr === 0) {
    throw new UnbalancedVoucherError(fromPaise(dr), fromPaise(cr));
  }
  return { lines: kept, total: fromPaise(dr) };
}

/** Debit-normal account types: balance = debit − credit; others credit − debit. */
export const isDebitNormal = (type: string) => type === 'ASSET' || type === 'EXPENSE';

export interface BalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
}

/** Trial balance: closing Dr / Cr per account plus grand totals (Dr total must equal Cr total). */
export function trialBalance(rows: BalanceRow[]) {
  const out = rows
    .filter((r) => r.debit !== 0 || r.credit !== 0)
    .map((r) => {
      const net = toPaise(r.debit) - toPaise(r.credit);
      return {
        ...r,
        closingDebit: net > 0 ? fromPaise(net) : 0,
        closingCredit: net < 0 ? fromPaise(-net) : 0,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
  const totalDebit = fromPaise(out.reduce((s, r) => s + toPaise(r.closingDebit), 0));
  const totalCredit = fromPaise(out.reduce((s, r) => s + toPaise(r.closingCredit), 0));
  return { rows: out, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

/** Income & expenditure: income (credit-normal) vs expenses (debit-normal); surplus = I − E. */
export function incomeExpenditure(rows: BalanceRow[]) {
  const income = rows
    .filter((r) => r.type === 'INCOME')
    .map((r) => ({ ...r, amount: fromPaise(toPaise(r.credit) - toPaise(r.debit)) }))
    .filter((r) => r.amount !== 0)
    .sort((a, b) => a.code.localeCompare(b.code));
  const expense = rows
    .filter((r) => r.type === 'EXPENSE')
    .map((r) => ({ ...r, amount: fromPaise(toPaise(r.debit) - toPaise(r.credit)) }))
    .filter((r) => r.amount !== 0)
    .sort((a, b) => a.code.localeCompare(b.code));
  const totalIncome = fromPaise(income.reduce((s, r) => s + toPaise(r.amount), 0));
  const totalExpense = fromPaise(expense.reduce((s, r) => s + toPaise(r.amount), 0));
  return {
    income,
    expense,
    totalIncome,
    totalExpense,
    surplus: fromPaise(toPaise(totalIncome) - toPaise(totalExpense)),
  };
}

/** Running balance of a ledger in the account's normal direction. */
export function runningBalance(
  type: string,
  opening: number,
  entries: Array<{ debit: number; credit: number }>,
): number[] {
  let bal = toPaise(opening);
  const sign = isDebitNormal(type) ? 1 : -1;
  return entries.map((e) => {
    bal += sign * (toPaise(e.debit) - toPaise(e.credit));
    return fromPaise(bal);
  });
}

/** `RCT-AEC-00042` style document numbers. */
export function formatDocNumber(prefix: string, value: number, padding: number): string {
  return `${prefix}${String(value).padStart(padding, '0')}`;
}
