import type { AiPayrollOutlierDto } from '@erp/shared';

/** Pure helpers of the AI module (unit-tested without a database). */

export interface RunTotals {
  gross: number;
  deductions: number;
  net: number;
  employees: number;
}

export interface RunEmployeeLike {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  status: 'OK' | 'ERROR' | 'SKIPPED';
  error?: string | null;
  net: number;
  lopDays: number;
  warnings: string[];
}

/** Rounded percentage change; null when there is no meaningful base. */
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export const OUTLIER_CHANGE_PERCENT = 20;
const Z_THRESHOLD = 2.5;

/**
 * Flag employees whose pay needs review: >20% net change vs previous month, new joiners /
 * leavers, LOP, calculation errors/warnings, and statistical outliers (|z| > 2.5) in this run.
 */
export function findPayrollOutliers(
  current: readonly RunEmployeeLike[],
  previous: readonly RunEmployeeLike[] | null,
): AiPayrollOutlierDto[] {
  const prevById = new Map((previous ?? []).map((p) => [p.employeeId, p]));
  const ok = current.filter((c) => c.status === 'OK');
  const mean = ok.reduce((s, c) => s + c.net, 0) / (ok.length || 1);
  const sd = Math.sqrt(ok.reduce((s, c) => s + (c.net - mean) ** 2, 0) / (ok.length || 1));

  const out: AiPayrollOutlierDto[] = [];
  for (const c of current) {
    const prev = prevById.get(c.employeeId) ?? null;
    const reasons: string[] = [];
    const change = prev ? percentChange(c.net, prev.net) : null;
    if (c.status === 'ERROR') reasons.push(`Calculation error${c.error ? `: ${c.error}` : ''}`);
    if (previous && !prev && c.status === 'OK') reasons.push('Not in previous month (new joiner?)');
    if (change !== null && Math.abs(change) > OUTLIER_CHANGE_PERCENT) {
      reasons.push(`Net pay ${change > 0 ? 'up' : 'down'} ${Math.abs(change)}% vs previous month`);
    }
    if (c.lopDays > 0) reasons.push(`${c.lopDays} LOP day(s)`);
    if (c.warnings.length) reasons.push(...c.warnings.slice(0, 3));
    if (c.status === 'OK' && sd > 0 && ok.length >= 5) {
      const z = (c.net - mean) / sd;
      if (Math.abs(z) > Z_THRESHOLD)
        reasons.push(`Unusual net pay for this run (z=${z.toFixed(1)})`);
    }
    if (reasons.length) {
      out.push({
        employeeId: c.employeeId,
        employeeCode: c.employeeCode,
        employeeName: c.employeeName,
        currentNet: c.net,
        previousNet: prev?.net ?? null,
        changePercent: change,
        lopDays: c.lopDays,
        reasons,
      });
    }
  }
  if (previous) {
    const currentIds = new Set(current.map((c) => c.employeeId));
    for (const p of previous) {
      if (currentIds.has(p.employeeId) || p.status !== 'OK') continue;
      out.push({
        employeeId: p.employeeId,
        employeeCode: p.employeeCode,
        employeeName: p.employeeName,
        currentNet: 0,
        previousNet: p.net,
        changePercent: -100,
        lopDays: 0,
        reasons: ['Paid last month but missing from this run (exit / hold?)'],
      });
    }
  }
  return out.sort(
    (a, b) =>
      b.reasons.length - a.reasons.length ||
      Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0),
  );
}
