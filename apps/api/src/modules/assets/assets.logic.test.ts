import { describe, expect, it } from 'vitest';
import {
  annualRate,
  bookValueAt,
  depreciationSchedule,
  formatAssetTag,
  isDueWithin,
  parseDate,
  type DepreciationParams,
} from './assets.logic';

const slm: DepreciationParams = {
  method: 'SLM',
  ratePercent: null,
  usefulLifeYears: 5,
  residualPercent: 5,
};
const wdv: DepreciationParams = {
  method: 'WDV',
  ratePercent: 40,
  usefulLifeYears: null,
  residualPercent: 5,
};

describe('asset tags', () => {
  it('pads the series number and adds a separator when needed', () => {
    expect(formatAssetTag('LAP', 5, 42)).toBe('LAP-00042');
    expect(formatAssetTag('ABBS/IT/', 4, 7)).toBe('ABBS/IT/0007');
    expect(formatAssetTag('F-', 3, 1234)).toBe('F-1234');
  });
});

describe('depreciation', () => {
  it('derives rates from the useful life', () => {
    expect(annualRate(slm)).toBeCloseTo(0.19, 5);
    expect(annualRate({ ...slm, method: 'WDV' })).toBeCloseTo(1 - 0.05 ** (1 / 5), 5);
    expect(annualRate({ ...slm, method: 'NONE' })).toBe(0);
  });

  it('computes straight-line book value with a residual floor', () => {
    const purchased = parseDate('2024-01-01');
    expect(bookValueAt(100000, purchased, slm, parseDate('2024-01-01'))).toBe(100000);
    expect(bookValueAt(100000, purchased, slm, parseDate('2024-12-31'))).toBeCloseTo(81000, -1);
    expect(bookValueAt(100000, purchased, slm, parseDate('2035-01-01'))).toBe(5000);
    expect(bookValueAt(100000, null, slm, parseDate('2030-01-01'))).toBe(100000);
  });

  it('computes written-down value', () => {
    const v = bookValueAt(100000, parseDate('2024-01-01'), wdv, parseDate('2025-12-31'));
    expect(v).toBeCloseTo(36000, -2);
  });

  it('builds a straight-line schedule ending at the residual value', () => {
    const rows = depreciationSchedule(100000, parseDate('2024-04-01'), slm);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      year: 1,
      fromDate: '2024-04-01',
      toDate: '2025-03-31',
      openingValue: 100000,
      depreciation: 19000,
      closingValue: 81000,
    });
    expect(rows[4]!.closingValue).toBe(5000);
  });

  it('builds a WDV schedule until the residual value', () => {
    const rows = depreciationSchedule(100000, parseDate('2024-04-01'), wdv);
    expect(rows[0]!.depreciation).toBe(40000);
    expect(rows[1]!.depreciation).toBe(24000);
    expect(rows.at(-1)!.closingValue).toBe(5000);
    expect(depreciationSchedule(100000, null, wdv)).toEqual([]);
  });

  it('flags due dates', () => {
    const today = parseDate('2026-01-10');
    expect(isDueWithin(parseDate('2026-01-20'), today, 30)).toBe(true);
    expect(isDueWithin(parseDate('2026-03-20'), today, 30)).toBe(false);
    expect(isDueWithin(parseDate('2025-12-20'), today, 30)).toBe(true);
    expect(isDueWithin(null, today, 30)).toBe(false);
  });
});
