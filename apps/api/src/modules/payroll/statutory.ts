/*
 * India statutory rule packs (§19) — PF, ESI, Professional Tax, TDS (old / new regime) and LWF.
 * Tables are DATA: built-in defaults below are keyed by pack / financial year / region and can be
 * overridden per organization by versioned `statutory_rule_packs` rows (see payroll.masters.ts).
 * All functions are pure so they are unit-tested in isolation.
 */
import type { StatutoryPack, TaxRegime } from '@erp/shared';

export interface PfConfig {
  eeRate: number;
  erRate: number;
  /** Statutory wage ceiling (₹15,000); contributions are on min(basis, ceiling) when applied. */
  wageCeiling: number;
  applyCeiling: boolean;
  /** Earned components forming PF wages. */
  basisCodes: string[];
}

export interface EsiConfig {
  eeRate: number;
  erRate: number;
  /** Covered only while monthly gross (full rate) ≤ threshold. */
  grossThreshold: number;
}

export interface AmountSlab {
  from: number;
  to?: number | null;
  amount: number;
}

export interface PtConfig {
  slabs: AmountSlab[];
  /** Month (1-12) → replacement slabs (e.g. February ₹300 in Maharashtra / Karnataka). */
  monthOverrides?: Record<string, AmountSlab[]>;
}

export interface TaxSlab {
  from: number;
  to?: number | null;
  percent: number;
}

export interface RegimeConfig {
  standardDeduction: number;
  slabs: TaxSlab[];
  /** Section 87A: full rebate when taxable income ≤ rebateLimit (capped at rebateMax). */
  rebateLimit: number;
  rebateMax: number;
  /** Old regime only: deductions cap for 80C (PF + declarations placeholder). */
  section80cCap?: number;
}

export interface TdsConfig {
  cessPercent: number;
  regimes: Record<TaxRegime, RegimeConfig>;
}

export interface LwfConfig {
  eeAmount: number;
  erAmount: number;
  /** Months (1-12) in which LWF is deducted. */
  months: number[];
}

export type PackConfig = PfConfig | EsiConfig | PtConfig | TdsConfig | LwfConfig;

const DEFAULT_PF: PfConfig = {
  eeRate: 12,
  erRate: 12,
  wageCeiling: 15000,
  applyCeiling: true,
  basisCodes: ['BASIC', 'DA'],
};

const DEFAULT_ESI: EsiConfig = { eeRate: 0.75, erRate: 3.25, grossThreshold: 21000 };

const PT_TABLES: Record<string, PtConfig> = {
  KA: {
    slabs: [
      { from: 0, to: 24999.99, amount: 0 },
      { from: 25000, to: null, amount: 200 },
    ],
    monthOverrides: {
      '2': [
        { from: 0, to: 24999.99, amount: 0 },
        { from: 25000, to: null, amount: 300 },
      ],
    },
  },
  MH: {
    slabs: [
      { from: 0, to: 7500, amount: 0 },
      { from: 7500.01, to: 10000, amount: 175 },
      { from: 10000.01, to: null, amount: 200 },
    ],
    monthOverrides: {
      '2': [
        { from: 0, to: 7500, amount: 0 },
        { from: 7500.01, to: 10000, amount: 175 },
        { from: 10000.01, to: null, amount: 300 },
      ],
    },
  },
  TN: {
    slabs: [
      { from: 0, to: 3500, amount: 0 },
      { from: 3500.01, to: 5000, amount: 22.5 },
      { from: 5000.01, to: 7500, amount: 52.5 },
      { from: 7500.01, to: 10000, amount: 115 },
      { from: 10000.01, to: 12500, amount: 171 },
      { from: 12500.01, to: null, amount: 208 },
    ],
  },
};

const DEFAULT_TDS: TdsConfig = {
  cessPercent: 4,
  regimes: {
    NEW: {
      standardDeduction: 75000,
      slabs: [
        { from: 0, to: 400000, percent: 0 },
        { from: 400000, to: 800000, percent: 5 },
        { from: 800000, to: 1200000, percent: 10 },
        { from: 1200000, to: 1600000, percent: 15 },
        { from: 1600000, to: 2000000, percent: 20 },
        { from: 2000000, to: 2400000, percent: 25 },
        { from: 2400000, to: null, percent: 30 },
      ],
      rebateLimit: 1200000,
      rebateMax: 60000,
    },
    OLD: {
      standardDeduction: 50000,
      slabs: [
        { from: 0, to: 250000, percent: 0 },
        { from: 250000, to: 500000, percent: 5 },
        { from: 500000, to: 1000000, percent: 20 },
        { from: 1000000, to: null, percent: 30 },
      ],
      rebateLimit: 500000,
      rebateMax: 12500,
      section80cCap: 150000,
    },
  },
};

const LWF_TABLES: Record<string, LwfConfig> = {
  KA: { eeAmount: 20, erAmount: 40, months: [12] },
  MH: { eeAmount: 12, erAmount: 36, months: [6, 12] },
};

/** Financial years the built-in tables were authored for (newer FYs reuse the latest). */
export const BUILTIN_FINANCIAL_YEAR = '2025-26';

/** Built-in default for a pack / region (null when the region has no table, e.g. PT in a state without PT). */
export function builtinPack(pack: StatutoryPack, region: string): PackConfig | null {
  switch (pack) {
    case 'PF':
      return DEFAULT_PF;
    case 'ESI':
      return DEFAULT_ESI;
    case 'TDS':
      return DEFAULT_TDS;
    case 'PT':
      return PT_TABLES[region] ?? null;
    case 'LWF':
      return LWF_TABLES[region] ?? null;
    default:
      return null;
  }
}

export const BUILTIN_PT_STATES = Object.keys(PT_TABLES);
export const BUILTIN_LWF_STATES = Object.keys(LWF_TABLES);

/** Financial year (April–March) of a YYYY-MM-DD date → `2025-26`. */
export function financialYearOf(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

const r0 = (x: number) => Math.round(x + Number.EPSILON);

export interface StatutoryResult {
  amount: number;
  explanation: string;
  inputs: Record<string, number | string | boolean>;
}

export function computePf(cfg: PfConfig, earned: Record<string, number>) {
  const basis = cfg.basisCodes.reduce((s, c) => s + (earned[c] ?? 0), 0);
  const wages = cfg.applyCeiling ? Math.min(basis, cfg.wageCeiling) : basis;
  const ee = r0((wages * cfg.eeRate) / 100);
  const er = r0((wages * cfg.erRate) / 100);
  const inputs = { PF_BASIS: basis, PF_WAGES: wages, CEILING: cfg.wageCeiling };
  return {
    ee: {
      amount: ee,
      explanation: `${cfg.eeRate}% of PF wages ${wages} (${cfg.basisCodes.join('+')} = ${basis}${cfg.applyCeiling ? `, capped at ${cfg.wageCeiling}` : ''})`,
      inputs,
    } satisfies StatutoryResult,
    er: {
      amount: er,
      explanation: `${cfg.erRate}% employer share of PF wages ${wages}`,
      inputs,
    } satisfies StatutoryResult,
  };
}

/** ESI on earned gross, applicable while the full monthly gross is within the threshold. */
export function computeEsi(cfg: EsiConfig, fullGross: number, earnedGross: number) {
  const covered = fullGross <= cfg.grossThreshold;
  const ee = covered ? Math.ceil((earnedGross * cfg.eeRate) / 100 - 1e-9) : 0;
  const er = covered ? Math.ceil((earnedGross * cfg.erRate) / 100 - 1e-9) : 0;
  const inputs = { GROSS: fullGross, EARNED_GROSS: earnedGross, THRESHOLD: cfg.grossThreshold };
  const why = covered
    ? `of earned gross ${earnedGross} (gross ${fullGross} ≤ ${cfg.grossThreshold}), rounded up`
    : `not applicable: gross ${fullGross} > threshold ${cfg.grossThreshold}`;
  return {
    ee: { amount: ee, explanation: covered ? `${cfg.eeRate}% ${why}` : why, inputs },
    er: { amount: er, explanation: covered ? `${cfg.erRate}% ${why}` : why, inputs },
  };
}

function slabAmount(slabs: AmountSlab[], basis: number): number {
  const row = slabs.find((s) => basis >= s.from && (s.to == null || basis <= s.to));
  return row?.amount ?? 0;
}

/** Professional Tax by state slab on monthly earned gross. */
export function computePt(cfg: PtConfig, earnedGross: number, month: number): StatutoryResult {
  const slabs = cfg.monthOverrides?.[String(month)] ?? cfg.slabs;
  const amount = slabAmount(slabs, earnedGross);
  return {
    amount,
    explanation: `State slab for gross ${earnedGross}${cfg.monthOverrides?.[String(month)] ? ` (month ${month} table)` : ''}`,
    inputs: { GROSS: earnedGross, MONTH: month },
  };
}

/** Annual income tax for a taxable income under a regime (slabs + 87A rebate + cess). */
export function annualTax(cfg: TdsConfig, regime: TaxRegime, taxableIncome: number): number {
  const r = cfg.regimes[regime];
  let tax = 0;
  for (const s of r.slabs) {
    const upper = s.to ?? Number.POSITIVE_INFINITY;
    if (taxableIncome > s.from)
      tax += ((Math.min(taxableIncome, upper) - s.from) * s.percent) / 100;
  }
  if (taxableIncome <= r.rebateLimit) tax = Math.max(0, tax - r.rebateMax);
  return r0(tax * (1 + cfg.cessPercent / 100));
}

/**
 * Basic monthly TDS: annualize the monthly taxable salary, deduct the standard deduction (and,
 * in the old regime, 80C = PF + declarations up to the cap), compute annual tax, divide by 12.
 * Investment declarations are a placeholder input (`declarations`, default 0).
 */
export function computeTds(
  cfg: TdsConfig,
  regime: TaxRegime,
  monthlyTaxable: number,
  oneTimeTaxable: number,
  monthlyPfEe: number,
  declarations = 0,
): StatutoryResult {
  const r = cfg.regimes[regime];
  const gross = monthlyTaxable * 12 + oneTimeTaxable;
  const chapterVIA =
    regime === 'OLD' ? Math.min(monthlyPfEe * 12 + declarations, r.section80cCap ?? 0) : 0;
  const taxable = Math.max(0, gross - r.standardDeduction - chapterVIA);
  const annual = annualTax(cfg, regime, taxable);
  const amount = r0(annual / 12);
  return {
    amount,
    explanation: `${regime} regime: projected annual taxable ${taxable} (gross ${gross} − std ${r.standardDeduction}${chapterVIA ? ` − 80C ${chapterVIA}` : ''}) → annual tax ${annual} incl. ${cfg.cessPercent}% cess ÷ 12`,
    inputs: { ANNUAL_GROSS: gross, ANNUAL_TAXABLE: taxable, ANNUAL_TAX: annual, REGIME: regime },
  };
}

export function computeLwf(cfg: LwfConfig, month: number) {
  const due = cfg.months.includes(month);
  const inputs = { MONTH: month };
  return {
    ee: {
      amount: due ? cfg.eeAmount : 0,
      explanation: due ? 'LWF employee contribution' : `LWF not due in month ${month}`,
      inputs,
    },
    er: {
      amount: due ? cfg.erAmount : 0,
      explanation: due ? 'LWF employer contribution' : `LWF not due in month ${month}`,
      inputs,
    },
  };
}
