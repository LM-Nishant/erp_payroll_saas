/*
 * Pure asset helpers: tag series formatting and depreciation (straight line / written down
 * value). Depreciation is computed on the fly from the asset cost, purchase date and category
 * settings — nothing is posted, so changing a category's method re-states every schedule.
 */

export type DepreciationMethodCode = 'NONE' | 'SLM' | 'WDV';

export interface DepreciationParams {
  method: DepreciationMethodCode;
  /** Annual rate as a percentage (SLM: of cost; WDV: of opening value). */
  ratePercent: number | null;
  usefulLifeYears: number | null;
  residualPercent: number;
}

export interface ScheduleRow {
  year: number;
  fromDate: string;
  toDate: string;
  openingValue: number;
  depreciation: number;
  closingValue: number;
}

const DAY_MS = 86_400_000;
export const round2 = (n: number) => Math.round(n * 100) / 100;

export const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
export const parseDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS);
export const addYears = (d: Date, years: number) => {
  const r = new Date(d.getTime());
  r.setUTCFullYear(r.getUTCFullYear() + years);
  return r;
};
export const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY_MS);
export const todayUtc = () => parseDate(dateOnly(new Date()));

/** `LAP` + 5 + 42 → `LAP-00042`; prefixes ending in `-` or `/` are used as is. */
export function formatAssetTag(prefix: string, padding: number, n: number): string {
  const sep = /[-/]$/.test(prefix) ? '' : '-';
  return `${prefix}${sep}${String(n).padStart(padding, '0')}`;
}

/** Effective annual rate as a fraction, deriving it from the useful life when not given. */
export function annualRate(p: DepreciationParams): number {
  if (p.method === 'NONE') return 0;
  if (p.ratePercent != null && p.ratePercent > 0) return p.ratePercent / 100;
  const life = p.usefulLifeYears ?? 0;
  if (life <= 0) return 0;
  if (p.method === 'SLM') return (1 - p.residualPercent / 100) / life;
  // WDV rate that reaches the residual value at the end of the useful life.
  const residual = Math.max(p.residualPercent, 1) / 100;
  return 1 - residual ** (1 / life);
}

/** Annual straight-line charge: `rate × cost` when a rate is set, else `(cost − residual) / life`. */
export function annualSlmCharge(cost: number, p: DepreciationParams): number {
  return cost * annualRate({ ...p, method: 'SLM' });
}

/** Book value of an asset on `asOf` (never below the residual value, never above cost). */
export function bookValueAt(
  cost: number,
  purchaseDate: Date | null,
  p: DepreciationParams,
  asOf: Date,
): number {
  if (!purchaseDate || cost <= 0 || p.method === 'NONE') return round2(cost);
  const rate = annualRate(p);
  if (rate <= 0) return round2(cost);
  const residual = (cost * p.residualPercent) / 100;
  const years = Math.max(0, daysBetween(purchaseDate, asOf)) / 365;
  const value =
    p.method === 'SLM' ? cost - annualSlmCharge(cost, p) * years : cost * (1 - rate) ** years;
  return round2(Math.min(cost, Math.max(residual, value)));
}

/**
 * Year-by-year schedule from the purchase date (anniversary years) until the asset reaches its
 * residual value / end of its useful life (capped at `maxYears`).
 */
export function depreciationSchedule(
  cost: number,
  purchaseDate: Date | null,
  p: DepreciationParams,
  maxYears = 40,
): ScheduleRow[] {
  if (!purchaseDate || cost <= 0 || p.method === 'NONE' || annualRate(p) <= 0) return [];
  const residual = round2((cost * p.residualPercent) / 100);
  const life = p.usefulLifeYears && p.usefulLifeYears > 0 ? p.usefulLifeYears : maxYears;
  const rows: ScheduleRow[] = [];
  let opening = round2(cost);
  for (let y = 0; y < Math.min(life, maxYears) && opening > residual; y++) {
    const charge = p.method === 'SLM' ? annualSlmCharge(cost, p) : opening * annualRate(p);
    // The last year of a declared useful life writes the asset down to its residual value.
    const lastYear = !!p.usefulLifeYears && y === life - 1;
    const closing = round2(lastYear ? residual : Math.max(residual, opening - charge));
    rows.push({
      year: y + 1,
      fromDate: dateOnly(addYears(purchaseDate, y)),
      toDate: dateOnly(addDays(addYears(purchaseDate, y + 1), -1)),
      openingValue: opening,
      depreciation: round2(opening - closing),
      closingValue: closing,
    });
    opening = closing;
  }
  return rows;
}

/** Whether a date falls within `days` from `today` (or is already past). */
export function isDueWithin(date: Date | null, today: Date, days: number): boolean {
  return !!date && daysBetween(today, date) <= days;
}
