/*
 * Payroll calculation engine (pure). Given resolved components (with precedence-ordered calc
 * candidates), the employee's salary inputs, the attendance summary and statutory settings it
 * produces earned amounts per component plus a human-readable calc trace.
 *
 * Model:
 *  - Non-statutory components are evaluated in "rate space" (full-month values) in dependency
 *    order (topological sort; cycles are rejected). Variables: CTC (monthly), ANNUAL_CTC, GROSS
 *    (sum of full-rate EARNING components), every component code, PAYABLE_DAYS, CALENDAR_DAYS,
 *    LOP_DAYS, OT_HOURS, PRESENT_DAYS, EMPLOYED_DAYS, ENCASHMENT_DAYS, FACTOR, EMPLOYMENT_TYPE.
 *  - Earned amount = full × FACTOR for pro-rated components (FACTOR = payable days attributed to
 *    the institution ÷ calendar days), then rounded per the component rule.
 *  - Statutory components (PF / ESI / PT / TDS / LWF) are computed last on EARNED values.
 *  - One-time adjustments (arrears, reimbursements, loan EMIs, encashment …) are added on top.
 */
import type {
  CalcTraceEntry,
  PayrollAdjustmentType,
  PayrollLineDto,
  RoundingMode,
  SalaryCalcType,
  SalaryComponentType,
  SlabRow,
  StatutoryCode,
  TaxRegime,
} from '@erp/shared';
import { evaluateFormula, evaluateNumber, formulaVariables, type FormulaValue } from './formula';
import {
  computeEsi,
  computeLwf,
  computePf,
  computePt,
  computeTds,
  type EsiConfig,
  type LwfConfig,
  type PfConfig,
  type PtConfig,
  type StatutoryResult,
  type TdsConfig,
} from './statutory';

export class PayrollEngineError extends Error {
  constructor(
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PayrollEngineError';
  }
}

export interface CalcSpec {
  calcType: SalaryCalcType;
  amount?: number | null;
  percentage?: number | null;
  percentOf?: string | null;
  formula?: string | null;
  slabBasis?: string | null;
  slabs?: SlabRow[] | null;
}

export interface CalcCandidate extends CalcSpec {
  /** Where the calc came from: `structure:<code>@v2`, `rule:institution@v3`, `component` … */
  source: string;
  /** Boolean formula over base variables; candidate applies only when truthy. */
  condition?: string | null;
}

export interface EngineComponent {
  code: string;
  name: string;
  type: SalaryComponentType;
  statutoryCode?: StatutoryCode | null;
  taxable: boolean;
  proRated: boolean;
  rounding: RoundingMode;
  roundingPrecision: number;
  displayOrder: number;
  showOnPayslip: boolean;
  /** Precedence order: first applicable candidate wins. */
  candidates: CalcCandidate[];
}

export interface EngineAttendance {
  calendarDays: number;
  employedDays: number;
  payableDays: number;
  lopDays: number;
  presentDays: number;
  overtimeHours: number;
  encashmentDays: number;
}

export interface EngineAdjustment {
  type: PayrollAdjustmentType;
  code: string;
  amount: number;
  taxable: boolean;
  description: string;
}

export interface StatutoryContext {
  month: number;
  regime: TaxRegime;
  pf?: PfConfig | null;
  esi?: EsiConfig | null;
  pt?: PtConfig | null;
  tds?: TdsConfig | null;
  lwf?: LwfConfig | null;
  /** Placeholder for investment declarations (old regime 80C). */
  declarations?: number;
}

export interface EngineInput {
  components: EngineComponent[];
  annualCtc: number;
  /** Employee-specific monthly amounts (override the calc of the matching component). */
  amounts: Record<string, number>;
  /** Component codes switched off for this employee (treated as 0 and left off the payslip). */
  excludedComponents?: string[];
  attendance: EngineAttendance;
  /** Pro-ration factor (0..1). */
  factor: number;
  employmentType?: string | null;
  statutory: StatutoryContext;
  adjustments: EngineAdjustment[];
}

export interface EngineResult {
  lines: PayrollLineDto[];
  trace: CalcTraceEntry[];
  gross: number;
  deductions: number;
  net: number;
  employerContributions: number;
  taxableEarnings: number;
  fullGross: number;
  warnings: string[];
}

export const BASE_VARIABLES = [
  'CTC',
  'ANNUAL_CTC',
  'GROSS',
  'PAYABLE_DAYS',
  'CALENDAR_DAYS',
  'LOP_DAYS',
  'OT_HOURS',
  'PRESENT_DAYS',
  'EMPLOYED_DAYS',
  'ENCASHMENT_DAYS',
  'FACTOR',
  'EMPLOYMENT_TYPE',
] as const;

const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

export function applyRounding(x: number, mode: RoundingMode, precision: number): number {
  const f = 10 ** precision;
  switch (mode) {
    case 'NONE':
      return round2(x);
    case 'UP':
      return Math.ceil(x * f - 1e-9) / f;
    case 'DOWN':
      return Math.floor(x * f + 1e-9) / f;
    default:
      return Math.round((x + Number.EPSILON) * f) / f;
  }
}

/** Codes a calc spec depends on. */
export function calcDependencies(spec: CalcSpec): Set<string> {
  const deps = new Set<string>();
  switch (spec.calcType) {
    case 'PERCENTAGE':
      if (spec.percentOf) deps.add(spec.percentOf);
      break;
    case 'FORMULA':
      if (spec.formula) formulaVariables(spec.formula).forEach((v) => deps.add(v));
      break;
    case 'SLAB':
      if (spec.slabBasis) deps.add(spec.slabBasis);
      break;
    default:
      break;
  }
  return deps;
}

/**
 * Topological order of `nodes` given `deps` (node → nodes it depends on). Throws with the cycle
 * path when the graph is cyclic. Dependencies on non-nodes are ignored (base variables).
 */
export function topoSort(nodes: string[], deps: Map<string, Set<string>>): string[] {
  const state = new Map<string, 1 | 2>();
  const order: string[] = [];
  const nodeSet = new Set(nodes);
  const visit = (n: string, path: string[]) => {
    const s = state.get(n);
    if (s === 2) return;
    if (s === 1) {
      const cycle = [...path.slice(path.indexOf(n)), n];
      throw new PayrollEngineError(`Circular dependency: ${cycle.join(' → ')}`, { cycle });
    }
    state.set(n, 1);
    for (const d of [...(deps.get(n) ?? [])].sort()) {
      if (nodeSet.has(d)) visit(d, [...path, n]);
    }
    state.set(n, 2);
    order.push(n);
  };
  for (const n of nodes) visit(n, []);
  return order;
}

function slabValue(slabs: SlabRow[], basis: number): { value: number; row: string } {
  const row = slabs.find((s) => basis >= s.from && (s.to == null || basis <= s.to));
  if (!row) return { value: 0, row: 'no slab' };
  const value = row.amount ?? (row.percent != null ? (basis * row.percent) / 100 : 0);
  return { value, row: `${row.from}–${row.to ?? '∞'}` };
}

const STATUTORY_DEDUCTIONS = new Set<StatutoryCode>(['PF_EE', 'ESI_EE', 'PT', 'TDS', 'LWF_EE']);

function categoryOf(c: EngineComponent): PayrollLineDto['category'] {
  if (c.statutoryCode) {
    return STATUTORY_DEDUCTIONS.has(c.statutoryCode) ? 'DEDUCTION' : 'EMPLOYER_CONTRIBUTION';
  }
  if (c.type === 'STATUTORY') return 'DEDUCTION';
  return c.type;
}

function isStatutory(c: EngineComponent): boolean {
  return Boolean(c.statutoryCode) || c.candidates[0]?.calcType === 'STATUTORY';
}

/** Validate that a set of components forms an acyclic graph (used when saving masters). */
export function validateComponentGraph(components: EngineComponent[]): void {
  const regular = components.filter((c) => !isStatutory(c));
  const codes = new Set(regular.map((c) => c.code));
  const deps = new Map<string, Set<string>>();
  for (const c of regular) {
    const d = new Set<string>();
    for (const cand of c.candidates) calcDependencies(cand).forEach((x) => d.add(x));
    deps.set(c.code, d);
  }
  deps.set('GROSS', new Set(regular.filter((c) => c.type === 'EARNING').map((c) => c.code)));
  topoSort([...codes, 'GROSS'], deps);
}

export function computePayroll(input: EngineInput): EngineResult {
  const { attendance: att, factor } = input;
  const warnings: string[] = [];
  const trace: CalcTraceEntry[] = [];
  const base: Record<string, FormulaValue> = {
    CTC: round2(input.annualCtc / 12),
    ANNUAL_CTC: input.annualCtc,
    PAYABLE_DAYS: att.payableDays,
    CALENDAR_DAYS: att.calendarDays,
    LOP_DAYS: att.lopDays,
    OT_HOURS: att.overtimeHours,
    PRESENT_DAYS: att.presentDays,
    EMPLOYED_DAYS: att.employedDays,
    ENCASHMENT_DAYS: att.encashmentDays,
    FACTOR: factor,
    EMPLOYMENT_TYPE: input.employmentType ?? '',
  };

  const excluded = new Set(input.excludedComponents ?? []);
  const components = input.components.filter((c) => !excluded.has(c.code));
  const excludedStatutory = new Set(
    input.components
      .filter((c) => excluded.has(c.code) && c.statutoryCode)
      .map((c) => c.statutoryCode!),
  );
  const regular = components.filter((c) => !isStatutory(c));
  const statutory = components.filter(isStatutory);

  // 1. choose the applicable calc candidate per component (conditions see base variables only)
  const chosen = new Map<string, CalcCandidate | 'EMPLOYEE_AMOUNT'>();
  for (const c of regular) {
    if (input.amounts[c.code] !== undefined) {
      chosen.set(c.code, 'EMPLOYEE_AMOUNT');
      continue;
    }
    const cand = c.candidates.find((x) => {
      if (!x.condition) return true;
      try {
        const v = evaluateFormula(x.condition, base);
        return typeof v === 'string' ? v.length > 0 : Boolean(v);
      } catch (e) {
        throw new PayrollEngineError(`${c.code}: invalid condition (${(e as Error).message})`, {
          component: c.code,
        });
      }
    });
    if (!cand) {
      warnings.push(`${c.code}: no applicable calculation rule; treated as 0`);
      continue;
    }
    chosen.set(c.code, cand);
  }

  // 2. dependency graph + topological order (GROSS is a virtual node over EARNING components)
  const deps = new Map<string, Set<string>>();
  for (const [code, cand] of chosen) {
    deps.set(code, cand === 'EMPLOYEE_AMOUNT' ? new Set() : calcDependencies(cand));
  }
  const earningCodes = regular.filter((c) => c.type === 'EARNING').map((c) => c.code);
  deps.set('GROSS', new Set(earningCodes));
  const order = topoSort([...chosen.keys(), 'GROSS'], deps);

  // 3. evaluate in rate space
  const full: Record<string, number> = {};
  const vars: Record<string, FormulaValue> = { ...base };
  for (const c of regular) if (!chosen.has(c.code)) vars[c.code] = 0;
  for (const c of input.components) {
    if (excluded.has(c.code) && !isStatutory(c)) vars[c.code] = 0;
  }
  const explanations = new Map<
    string,
    { source: string; expression: string; inputs: Record<string, FormulaValue> }
  >();
  for (const code of order) {
    if (code === 'GROSS') {
      vars.GROSS = round2(earningCodes.reduce((s, k) => s + (full[k] ?? 0), 0));
      continue;
    }
    const cand = chosen.get(code)!;
    const pick = (names: Iterable<string>) => {
      const out: Record<string, FormulaValue> = {};
      for (const n of names) if (n in vars) out[n] = vars[n]!;
      return out;
    };
    let value: number;
    let expression: string;
    let source: string;
    let inputs: Record<string, FormulaValue> = {};
    try {
      if (cand === 'EMPLOYEE_AMOUNT') {
        value = input.amounts[code]!;
        expression = `${value}`;
        source = 'employee salary amount';
      } else {
        source = cand.source;
        const missing = [...calcDependencies(cand)].filter((d) => !(d in vars));
        if (missing.length) {
          throw new PayrollEngineError(`Unknown variable(s): ${missing.join(', ')}`);
        }
        switch (cand.calcType) {
          case 'FIXED':
            value = cand.amount ?? 0;
            expression = `fixed ${value}`;
            break;
          case 'PERCENTAGE': {
            const of = cand.percentOf ?? 'CTC';
            const basis = Number(vars[of] ?? 0);
            value = (basis * (cand.percentage ?? 0)) / 100;
            expression = `${cand.percentage ?? 0}% of ${of}`;
            inputs = { [of]: basis };
            break;
          }
          case 'FORMULA':
            value = evaluateNumber(cand.formula ?? '0', vars);
            expression = cand.formula ?? '0';
            inputs = pick(formulaVariables(expression));
            break;
          case 'SLAB': {
            const of = cand.slabBasis ?? 'GROSS';
            const basis = Number(vars[of] ?? 0);
            const s = slabValue(cand.slabs ?? [], basis);
            value = s.value;
            expression = `slab on ${of} (${s.row})`;
            inputs = { [of]: basis };
            break;
          }
          default:
            value = 0;
            expression = 'n/a';
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new PayrollEngineError(`${code}: ${msg}`, { component: code });
    }
    if (!Number.isFinite(value)) throw new PayrollEngineError(`${code}: result is not finite`);
    full[code] = round2(value);
    vars[code] = full[code]!;
    explanations.set(code, { source, expression, inputs });
  }

  // 4. pro-rate + round → earned
  const lines: PayrollLineDto[] = [];
  const earned: Record<string, number> = {};
  for (const c of regular) {
    const f = full[c.code] ?? 0;
    const k = c.proRated ? factor : 1;
    const amount = applyRounding(f * k, c.rounding, c.roundingPrecision);
    earned[c.code] = amount;
    const ex = explanations.get(c.code);
    const explanation = ex
      ? `${ex.expression} = ${f}${c.proRated && factor !== 1 ? ` × ${round2(factor)} (payable ${att.payableDays}/${att.calendarDays} days)` : ''} → ${amount}`
      : 'no applicable rule → 0';
    trace.push({
      code: c.code,
      name: c.name,
      type: c.type,
      source: ex?.source ?? 'none',
      expression: ex?.expression ?? '',
      inputs: (ex?.inputs ?? {}) as Record<string, number | string | boolean>,
      rate: f,
      factor: c.proRated ? factor : 1,
      amount,
    });
    lines.push({
      code: c.code,
      name: c.name,
      type: c.type,
      category: categoryOf(c),
      statutoryCode: null,
      amount,
      fullAmount: f,
      taxable: c.taxable,
      showOnPayslip: c.showOnPayslip,
      displayOrder: c.displayOrder,
      explanation,
    });
  }

  // 5. adjustments
  const earningAdj = new Set<PayrollAdjustmentType>(['EARNING', 'ARREAR', 'ENCASHMENT']);
  let oneTimeTaxable = 0;
  let adjEarningsForStat = 0;
  for (const [i, a] of input.adjustments.entries()) {
    const category: PayrollLineDto['category'] =
      a.type === 'REIMBURSEMENT'
        ? 'REIMBURSEMENT'
        : a.type === 'DEDUCTION' || a.type === 'LOAN_EMI'
          ? 'DEDUCTION'
          : 'EARNING';
    if (earningAdj.has(a.type)) {
      adjEarningsForStat += a.amount;
      if (a.taxable) oneTimeTaxable += a.amount;
    } else if (a.type === 'REIMBURSEMENT' && a.taxable) {
      oneTimeTaxable += a.amount;
    }
    lines.push({
      code: a.code,
      name: a.description,
      type: 'ADJUSTMENT',
      category,
      statutoryCode: null,
      amount: round2(a.amount),
      fullAmount: round2(a.amount),
      taxable: a.taxable,
      showOnPayslip: true,
      displayOrder: 5000 + i,
      explanation: `${a.type.toLowerCase().replace('_', ' ')} adjustment: ${a.description}`,
    });
    trace.push({
      code: a.code,
      name: a.description,
      type: 'ADJUSTMENT',
      source: `adjustment:${a.type}`,
      expression: `${a.amount}`,
      inputs: {},
      rate: a.amount,
      factor: 1,
      amount: round2(a.amount),
    });
  }

  // 6. statutory on earned values
  const fullGross = round2(earningCodes.reduce((s, k) => s + (full[k] ?? 0), 0));
  const earnedGross = round2(
    earningCodes.reduce((s, k) => s + (earned[k] ?? 0), 0) + adjEarningsForStat,
  );
  const monthlyTaxableFull = round2(
    regular
      .filter((c) => c.type === 'EARNING' && c.taxable)
      .reduce((s, c) => s + (full[c.code] ?? 0), 0),
  );
  const st = input.statutory;
  const results = new Map<StatutoryCode, StatutoryResult>();
  const notConfigured = (why: string): StatutoryResult => ({
    amount: 0,
    explanation: why,
    inputs: {},
  });
  const codes = new Set(statutory.map((c) => c.statutoryCode).filter(Boolean) as StatutoryCode[]);
  if (codes.has('PF_EE') || codes.has('PF_ER') || codes.has('TDS')) {
    if (st.pf) {
      const pf = computePf(st.pf, earned);
      results.set('PF_EE', pf.ee);
      results.set('PF_ER', pf.er);
    } else {
      results.set('PF_EE', notConfigured('PF disabled'));
      results.set('PF_ER', notConfigured('PF disabled'));
    }
  }
  if (st.esi) {
    const esi = computeEsi(st.esi, fullGross, earnedGross);
    results.set('ESI_EE', esi.ee);
    results.set('ESI_ER', esi.er);
  } else {
    results.set('ESI_EE', notConfigured('ESI disabled'));
    results.set('ESI_ER', notConfigured('ESI disabled'));
  }
  results.set(
    'PT',
    st.pt ? computePt(st.pt, earnedGross, st.month) : notConfigured('PT disabled / no state table'),
  );
  if (st.lwf) {
    const lwf = computeLwf(st.lwf, st.month);
    results.set('LWF_EE', lwf.ee);
    results.set('LWF_ER', lwf.er);
  } else {
    results.set('LWF_EE', notConfigured('LWF disabled'));
    results.set('LWF_ER', notConfigured('LWF disabled'));
  }
  results.set(
    'TDS',
    st.tds
      ? computeTds(
          st.tds,
          st.regime,
          monthlyTaxableFull,
          oneTimeTaxable,
          excludedStatutory.has('PF_EE') ? 0 : (results.get('PF_EE')?.amount ?? 0),
          st.declarations ?? 0,
        )
      : notConfigured('TDS disabled'),
  );
  for (const c of statutory) {
    const code = c.statutoryCode;
    const r = code ? results.get(code) : undefined;
    const amount = r ? applyRounding(r.amount, c.rounding, c.roundingPrecision) : 0;
    const explanation = r?.explanation ?? 'no statutory code';
    trace.push({
      code: c.code,
      name: c.name,
      type: c.type,
      source: `statutory:${code ?? 'none'}`,
      expression: explanation,
      inputs: r?.inputs ?? {},
      rate: amount,
      factor: 1,
      amount,
    });
    lines.push({
      code: c.code,
      name: c.name,
      type: c.type,
      category: categoryOf(c),
      statutoryCode: code ?? null,
      amount,
      fullAmount: amount,
      taxable: false,
      showOnPayslip: c.showOnPayslip,
      displayOrder: c.displayOrder,
      explanation,
    });
  }

  lines.sort((a, b) => a.displayOrder - b.displayOrder || a.code.localeCompare(b.code));
  const sum = (cat: PayrollLineDto['category']) =>
    round2(lines.filter((l) => l.category === cat).reduce((s, l) => s + l.amount, 0));
  const gross = round2(sum('EARNING') + sum('REIMBURSEMENT'));
  const deductions = sum('DEDUCTION');
  const taxableEarnings = round2(
    lines
      .filter((l) => (l.category === 'EARNING' || l.category === 'REIMBURSEMENT') && l.taxable)
      .reduce((s, l) => s + l.amount, 0),
  );
  const net = round2(gross - deductions);
  if (net < 0) warnings.push(`Net pay is negative (${net})`);
  return {
    lines,
    trace,
    gross,
    deductions,
    net,
    employerContributions: sum('EMPLOYER_CONTRIBUTION'),
    taxableEarnings,
    fullGross,
    warnings,
  };
}
