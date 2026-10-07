import { describe, expect, it } from 'vitest';
import {
  assertBalanced,
  formatDocNumber,
  incomeExpenditure,
  runningBalance,
  trialBalance,
  UnbalancedVoucherError,
} from './finance.logic';

describe('assertBalanced', () => {
  it('accepts balanced vouchers and drops zero lines', () => {
    const r = assertBalanced([
      { accountId: 'cash', debit: 0.1 + 0.2, credit: 0 },
      { accountId: 'fees', debit: 0, credit: 0.3 },
      { accountId: 'x', debit: 0, credit: 0 },
    ]);
    expect(r.total).toBe(0.3);
    expect(r.lines).toHaveLength(2);
  });
  it('rejects unbalanced, one-sided, negative and mixed lines', () => {
    expect(() =>
      assertBalanced([
        { accountId: 'a', debit: 10, credit: 0 },
        { accountId: 'b', debit: 0, credit: 9 },
      ]),
    ).toThrow(UnbalancedVoucherError);
    expect(() => assertBalanced([{ accountId: 'a', debit: 10, credit: 0 }])).toThrow();
    expect(() =>
      assertBalanced([
        { accountId: 'a', debit: -5, credit: 0 },
        { accountId: 'b', debit: 0, credit: -5 },
      ]),
    ).toThrow();
    expect(() =>
      assertBalanced([
        { accountId: 'a', debit: 5, credit: 5 },
        { accountId: 'b', debit: 0, credit: 0 },
      ]),
    ).toThrow();
  });
});

describe('reports', () => {
  const rows = [
    { accountId: '1', code: '1100', name: 'Cash', type: 'ASSET', debit: 1500, credit: 200 },
    { accountId: '2', code: '4100', name: 'Fees', type: 'INCOME', debit: 0, credit: 1500 },
    { accountId: '3', code: '5100', name: 'Rent', type: 'EXPENSE', debit: 200, credit: 0 },
    { accountId: '4', code: '9999', name: 'Idle', type: 'ASSET', debit: 0, credit: 0 },
  ];
  it('trial balance is balanced and omits idle accounts', () => {
    const tb = trialBalance(rows);
    expect(tb.rows.map((r) => r.code)).toEqual(['1100', '4100', '5100']);
    expect(tb).toMatchObject({ totalDebit: 1500, totalCredit: 1500, balanced: true });
  });
  it('income & expenditure surplus', () => {
    expect(incomeExpenditure(rows)).toMatchObject({
      totalIncome: 1500,
      totalExpense: 200,
      surplus: 1300,
    });
  });
  it('running balance follows the normal side', () => {
    expect(
      runningBalance('ASSET', 100, [
        { debit: 50, credit: 0 },
        { debit: 0, credit: 20 },
      ]),
    ).toEqual([150, 130]);
    expect(runningBalance('INCOME', 0, [{ debit: 0, credit: 70 }])).toEqual([70]);
  });
  it('formats document numbers', () => {
    expect(formatDocNumber('RCT-AEC-', 42, 5)).toBe('RCT-AEC-00042');
  });
});
