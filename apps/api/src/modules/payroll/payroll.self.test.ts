import type { PayrollLineDto } from '@erp/shared';
import { describe, expect, it } from 'vitest';
import {
  componentsByCategory,
  financialYearMonths,
  financialYearOf,
  financialYearRange,
} from './payroll.self';

const line = (
  code: string,
  category: PayrollLineDto['category'],
  amount: number,
  displayOrder = 100,
): PayrollLineDto => ({
  code,
  name: code,
  type: 'FIXED' as PayrollLineDto['type'],
  category,
  statutoryCode: null,
  amount,
  fullAmount: amount,
  taxable: true,
  showOnPayslip: true,
  displayOrder,
  explanation: '',
});

describe('financial year helpers', () => {
  it('maps dates to the April–March financial year', () => {
    expect(financialYearOf('2026-04-01')).toBe('2026-27');
    expect(financialYearOf('2026-09-15')).toBe('2026-27');
    expect(financialYearOf('2027-03-31')).toBe('2026-27');
    expect(financialYearOf('2026-01-10')).toBe('2025-26');
    expect(financialYearOf('2099-06-01')).toBe('2099-00');
  });

  it('returns the range and the twelve months in order', () => {
    expect(financialYearRange('2025-26')).toEqual({ from: '2025-04-01', to: '2026-03-31' });
    const months = financialYearMonths('2025-26');
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2025-04');
    expect(months[8]).toBe('2025-12');
    expect(months[9]).toBe('2026-01');
    expect(months[11]).toBe('2026-03');
  });
});

describe('componentsByCategory', () => {
  it('groups lines, drops zero amounts and annualises', () => {
    const groups = componentsByCategory([
      line('HRA', 'EARNING', 13600, 20),
      line('BASIC', 'EARNING', 34000, 10),
      line('PF_EE', 'DEDUCTION', 1800),
      line('ESI_EE', 'DEDUCTION', 0),
      line('PF_ER', 'EMPLOYER_CONTRIBUTION', 1800),
    ]);
    expect(groups.earnings.map((e) => e.code)).toEqual(['BASIC', 'HRA']);
    expect(groups.earnings[0]).toMatchObject({ monthly: 34000, annual: 408000 });
    expect(groups.deductions.map((d) => d.code)).toEqual(['PF_EE']);
    expect(groups.employerContributions).toHaveLength(1);
  });
});
