import { describe, expect, it } from 'vitest';
import {
  agingBucket,
  allocateOldestFirst,
  computeInvoice,
  daysOverdue,
  invoiceStatus,
  lateFee,
  siblingRanks,
} from './fees.logic';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('computeInvoice', () => {
  it('applies percent then amount concessions, never below zero, tax after concession', () => {
    const r = computeInvoice(
      [
        { feeHeadId: 'tuition', amount: 10000, taxRate: 0 },
        { feeHeadId: 'transport', amount: 2000, taxRate: 18 },
      ],
      [
        { id: 'c1', feeHeadId: 'tuition', valueType: 'PERCENT', value: 10 },
        { id: 'c2', feeHeadId: null, valueType: 'AMOUNT', value: 9500 },
      ],
    );
    expect(r.lines[0]).toMatchObject({ amount: 10000, concessionAmount: 10000, netAmount: 0 });
    expect(r.lines[1]).toMatchObject({ concessionAmount: 500, taxAmount: 270, netAmount: 1770 });
    expect(r).toMatchObject({
      grossAmount: 12000,
      concessionAmount: 10500,
      taxAmount: 270,
      netAmount: 1770,
    });
    expect(r.appliedConcessionIds.sort()).toEqual(['c1', 'c2']);
  });

  it('ignores concessions for other heads', () => {
    const r = computeInvoice(
      [{ feeHeadId: 'a', amount: 100.55, taxRate: 0 }],
      [{ id: 'x', feeHeadId: 'b', valueType: 'PERCENT', value: 50 }],
    );
    expect(r.netAmount).toBe(100.55);
    expect(r.appliedConcessionIds).toEqual([]);
  });
});

describe('late fees & aging', () => {
  it('respects grace days, per-day and cap', () => {
    const rule = { mode: 'PER_DAY', amount: 10, graceDays: 5, maxAmount: 100 };
    expect(daysOverdue(d('2026-05-10'), d('2026-05-01'))).toBe(0);
    expect(lateFee(rule, d('2026-05-01'), d('2026-05-06'))).toBe(0);
    expect(lateFee(rule, d('2026-05-01'), d('2026-05-09'))).toBe(30);
    expect(lateFee(rule, d('2026-05-01'), d('2026-07-01'))).toBe(100);
    expect(
      lateFee(
        { mode: 'FLAT', amount: 250, graceDays: 0, maxAmount: null },
        d('2026-05-01'),
        d('2026-05-02'),
      ),
    ).toBe(250);
  });
  it('buckets aging', () => {
    expect([0, 30, 31, 61, 91].map(agingBucket)).toEqual(['0-30', '0-30', '31-60', '61-90', '90+']);
  });
});

describe('allocation & status', () => {
  it('allocates oldest first and returns the advance', () => {
    const r = allocateOldestFirst(
      [
        { id: 'b', dueDate: d('2026-06-01'), balance: 500 },
        { id: 'a', dueDate: d('2026-04-01'), balance: 300.5 },
      ],
      1000,
    );
    expect(r.allocations).toEqual([
      { invoiceId: 'a', amount: 300.5 },
      { invoiceId: 'b', amount: 500 },
    ]);
    expect(r.unallocated).toBe(199.5);
  });
  it('derives invoice status', () => {
    expect(invoiceStatus(100, 0)).toBe('UNPAID');
    expect(invoiceStatus(100, 40)).toBe('PARTIAL');
    expect(invoiceStatus(100, 100)).toBe('PAID');
    expect(invoiceStatus(0, 0)).toBe('PAID');
  });
});

describe('siblingRanks', () => {
  it('ranks siblings sharing a guardian by order', () => {
    const ranks = siblingRanks(
      [
        { studentId: 's1', guardianId: 'g1' },
        { studentId: 's2', guardianId: 'g1' },
        { studentId: 's3', guardianId: 'g1' },
        { studentId: 's4', guardianId: 'g2' },
      ],
      ['s1', 's2', 's3', 's4'],
    );
    expect([...ranks.entries()]).toEqual([
      ['s1', 1],
      ['s2', 2],
      ['s3', 3],
      ['s4', 1],
    ]);
  });
});
