import { describe, expect, it } from 'vitest';
import {
  FormulaError,
  evaluateFormula,
  evaluateNumber,
  formulaError,
  formulaVariables,
} from './formula';
import {
  computePayroll,
  topoSort,
  validateComponentGraph,
  PayrollEngineError,
  type EngineComponent,
  type EngineInput,
} from './engine';
import {
  annualTax,
  builtinPack,
  computeEsi,
  computePf,
  computePt,
  computeTds,
  financialYearOf,
  type EsiConfig,
  type PfConfig,
  type PtConfig,
  type TdsConfig,
} from './statutory';

describe('formula evaluator', () => {
  it('evaluates arithmetic, precedence and functions', () => {
    expect(evaluateNumber('1 + 2 * 3', {})).toBe(7);
    expect(evaluateNumber('(1 + 2) * 3', {})).toBe(9);
    expect(evaluateNumber('-2 * -3 + 10 % 4', {})).toBe(8);
    expect(evaluateNumber('min(5, 3, 9) + max(1, 2)', {})).toBe(5);
    expect(evaluateNumber('round(2.345, 2) + floor(1.9) + ceil(1.1) + abs(-1)', {})).toBeCloseTo(
      6.35,
    );
    expect(evaluateNumber('round(BASIC * 0.4)', { BASIC: 30001 })).toBe(12000);
  });

  it('supports comparisons, logic, ternary, if() and string equality', () => {
    const vars = { GROSS: 20000, EMPLOYMENT_TYPE: 'CONTRACT' };
    expect(evaluateFormula('GROSS <= 21000 && GROSS > 0', vars)).toBe(true);
    expect(evaluateNumber('GROSS > 25000 ? 200 : 0', vars)).toBe(0);
    expect(evaluateNumber('if(EMPLOYMENT_TYPE == "CONTRACT", 0, 1800)', vars)).toBe(0);
    expect(evaluateFormula("!(EMPLOYMENT_TYPE != 'CONTRACT')", vars)).toBe(true);
    expect(evaluateNumber('1e3 + .5', {})).toBe(1000.5);
  });

  it('extracts variables (dependencies)', () => {
    expect(
      [...formulaVariables('max(BASIC, CTC * 0.4) + HRA + if(LOP_DAYS > 0, 1, 0)')].sort(),
    ).toEqual(['BASIC', 'CTC', 'HRA', 'LOP_DAYS']);
  });

  it('rejects anything outside the safe grammar', () => {
    const bad = [
      'process.exit(1)',
      'constructor.constructor("return 1")()',
      'BASIC; 1',
      'a = 1',
      'eval("1")',
      'Function("x")',
      '[1,2]',
      '`x`',
      'BASIC.toString',
      '1 +',
      '((1)',
      'require("fs")',
    ];
    for (const src of bad) expect(formulaError(src), src).not.toBeNull();
    expect(() => evaluateFormula('__proto__', {})).toThrow(FormulaError);
    expect(() => evaluateFormula('constructor', {})).toThrow(/Unknown variable/);
    expect(() => evaluateFormula('toString', { BASIC: 1 })).toThrow(/Unknown variable/);
    expect(() => evaluateNumber('1 / 0', {})).toThrow(/Division by zero/);
    expect(() => evaluateNumber('"a" + 1', {})).toThrow(FormulaError);
    expect(formulaError('('.repeat(200) + '1' + ')'.repeat(200))).toMatch(/nested too deeply/);
    expect(formulaError('1+'.repeat(1500) + '1')).not.toBeNull();
  });
});

describe('dependency graph', () => {
  it('orders dependencies and detects cycles', () => {
    const deps = new Map([
      ['HRA', new Set(['BASIC'])],
      ['SPECIAL', new Set(['CTC', 'BASIC', 'HRA'])],
      ['BASIC', new Set(['CTC'])],
    ]);
    const order = topoSort(['SPECIAL', 'HRA', 'BASIC'], deps);
    expect(order.indexOf('BASIC')).toBeLessThan(order.indexOf('HRA'));
    expect(order.indexOf('HRA')).toBeLessThan(order.indexOf('SPECIAL'));
    deps.set('BASIC', new Set(['SPECIAL']));
    expect(() => topoSort(['SPECIAL', 'HRA', 'BASIC'], deps)).toThrow(/Circular dependency/);
  });

  it('rejects an earning that references GROSS (GROSS depends on all earnings)', () => {
    const comps = [
      comp('BASIC', 'EARNING', { calcType: 'PERCENTAGE', percentage: 50, percentOf: 'CTC' }),
      comp('BONUS', 'EARNING', { calcType: 'FORMULA', formula: 'GROSS * 0.1' }),
    ];
    expect(() => validateComponentGraph(comps)).toThrow(PayrollEngineError);
    expect(() => validateComponentGraph(comps)).toThrow(/BONUS|GROSS/);
  });
});

function comp(
  code: string,
  type: EngineComponent['type'],
  calc: Partial<EngineComponent['candidates'][number]>,
  extra: Partial<EngineComponent> = {},
): EngineComponent {
  return {
    code,
    name: code,
    type,
    taxable: true,
    proRated: true,
    rounding: 'NEAREST',
    roundingPrecision: 0,
    displayOrder: 10,
    showOnPayslip: true,
    candidates: [{ calcType: 'FIXED', source: 'component', ...calc }],
    ...extra,
  };
}

const fullMonth = {
  calendarDays: 30,
  employedDays: 30,
  payableDays: 30,
  lopDays: 0,
  presentDays: 26,
  overtimeHours: 0,
  encashmentDays: 0,
};

function baseInput(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    components: [
      comp('BASIC', 'EARNING', { calcType: 'PERCENTAGE', percentage: 50, percentOf: 'CTC' }),
      comp('HRA', 'EARNING', { calcType: 'PERCENTAGE', percentage: 40, percentOf: 'BASIC' }),
      comp('SPECIAL', 'EARNING', { calcType: 'FORMULA', formula: 'CTC - BASIC - HRA' }),
      comp('WELFARE', 'DEDUCTION', {
        calcType: 'SLAB',
        slabBasis: 'GROSS',
        slabs: [
          { from: 0, to: 20000, amount: 50 },
          { from: 20000.01, to: null, amount: 100 },
        ],
      }),
    ],
    annualCtc: 600000,
    amounts: {},
    attendance: fullMonth,
    factor: 1,
    statutory: { month: 5, regime: 'NEW' },
    adjustments: [],
    ...overrides,
  };
}

describe('payroll engine', () => {
  it('computes percentage, formula and slab components with a trace', () => {
    const r = computePayroll(baseInput());
    const amt = (c: string) => r.lines.find((l) => l.code === c)?.amount;
    expect(amt('BASIC')).toBe(25000);
    expect(amt('HRA')).toBe(10000);
    expect(amt('SPECIAL')).toBe(15000);
    expect(amt('WELFARE')).toBe(100);
    expect(r.gross).toBe(50000);
    expect(r.net).toBe(49900);
    expect(r.trace.find((t) => t.code === 'HRA')?.expression).toBe('40% of BASIC');
  });

  it('pro-rates by payable days (LOP) and honours employee amount overrides', () => {
    const r = computePayroll(
      baseInput({
        attendance: { ...fullMonth, payableDays: 27, lopDays: 3 },
        factor: 27 / 30,
        amounts: { BASIC: 20000 },
      }),
    );
    const amt = (c: string) => r.lines.find((l) => l.code === c)?.amount;
    expect(amt('BASIC')).toBe(18000);
    expect(amt('HRA')).toBe(7200);
    expect(r.lines.find((l) => l.code === 'BASIC')?.explanation).toMatch(/27\/30/);
  });

  it('uses the first applicable candidate (conditions) per precedence', () => {
    const input = baseInput();
    input.components[1] = {
      ...input.components[1]!,
      candidates: [
        {
          calcType: 'FIXED',
          amount: 0,
          source: 'rule:institution@v1',
          condition: 'EMPLOYMENT_TYPE == "CONTRACT"',
        },
        { calcType: 'PERCENTAGE', percentage: 50, percentOf: 'BASIC', source: 'rule:org@v1' },
      ],
    };
    const contract = computePayroll({ ...input, employmentType: 'CONTRACT' });
    const teaching = computePayroll({ ...input, employmentType: 'TEACHING' });
    expect(contract.lines.find((l) => l.code === 'HRA')?.amount).toBe(0);
    expect(teaching.lines.find((l) => l.code === 'HRA')?.amount).toBe(12500);
  });

  it('applies statutory packs on earned values and adjustments', () => {
    const pack = <T>(p: Parameters<typeof builtinPack>[0], region = 'IN') =>
      builtinPack(p, region) as T;
    const r = computePayroll(
      baseInput({
        components: [
          ...baseInput().components,
          comp('PF_EE', 'STATUTORY', { calcType: 'STATUTORY' }, { statutoryCode: 'PF_EE' }),
          comp(
            'PF_ER',
            'EMPLOYER_CONTRIBUTION',
            { calcType: 'STATUTORY' },
            { statutoryCode: 'PF_ER' },
          ),
          comp('PT', 'STATUTORY', { calcType: 'STATUTORY' }, { statutoryCode: 'PT' }),
          comp('TDS', 'STATUTORY', { calcType: 'STATUTORY' }, { statutoryCode: 'TDS' }),
        ],
        statutory: {
          month: 5,
          regime: 'NEW',
          pf: pack<PfConfig>('PF'),
          pt: pack<PtConfig>('PT', 'KA'),
          tds: pack<TdsConfig>('TDS'),
        },
        adjustments: [
          { type: 'LOAN_EMI', code: 'LOAN', amount: 2000, taxable: false, description: 'Loan EMI' },
          { type: 'ARREAR', code: 'ARREAR', amount: 3000, taxable: true, description: 'Arrears' },
        ],
      }),
    );
    const amt = (c: string) => r.lines.find((l) => l.code === c)?.amount;
    expect(amt('PF_EE')).toBe(1800);
    expect(amt('PF_ER')).toBe(1800);
    expect(r.employerContributions).toBe(1800);
    expect(amt('PT')).toBe(200);
    expect(amt('LOAN')).toBe(2000);
    expect(r.gross).toBe(53000);
    // annual gross 50000*12 + 3000 = 603000 − 75000 → 528000 ≤ 12L → rebate → 0
    expect(amt('TDS')).toBe(0);
    expect(r.deductions).toBe(100 + 1800 + 200 + 2000);
  });
});

describe('statutory packs', () => {
  const pf = builtinPack('PF', 'IN') as PfConfig;
  const esi = builtinPack('ESI', 'IN') as EsiConfig;
  const tds = builtinPack('TDS', 'IN') as TdsConfig;

  it('PF: 12% capped at the wage ceiling (configurable)', () => {
    expect(computePf(pf, { BASIC: 25000 }).ee.amount).toBe(1800);
    expect(computePf(pf, { BASIC: 10000, DA: 2000 }).ee.amount).toBe(1440);
    expect(computePf({ ...pf, applyCeiling: false }, { BASIC: 25000 }).er.amount).toBe(3000);
  });

  it('ESI: only within the gross threshold; employee share rounded up', () => {
    expect(computeEsi(esi, 18000, 18000).ee.amount).toBe(135);
    expect(computeEsi(esi, 18000, 18000).er.amount).toBe(585);
    expect(computeEsi(esi, 15001, 15001).ee.amount).toBe(113);
    expect(computeEsi(esi, 22000, 22000).ee.amount).toBe(0);
  });

  it('PT: state slabs incl. February table', () => {
    const ka = builtinPack('PT', 'KA') as PtConfig;
    const mh = builtinPack('PT', 'MH') as PtConfig;
    expect(computePt(ka, 24000, 5).amount).toBe(0);
    expect(computePt(ka, 30000, 5).amount).toBe(200);
    expect(computePt(mh, 9000, 5).amount).toBe(175);
    expect(computePt(mh, 12000, 2).amount).toBe(300);
    expect(builtinPack('PT', 'XX')).toBeNull();
  });

  it('TDS: new vs old regime with rebate and cess', () => {
    expect(annualTax(tds, 'NEW', 1200000)).toBe(0);
    // 1,300,000 new regime: 20000 + 40000 + 15000 = 75000 × 1.04
    expect(annualTax(tds, 'NEW', 1300000)).toBe(78000);
    // old regime 1,000,000: 12500 + 100000 = 112500 × 1.04
    expect(annualTax(tds, 'OLD', 1000000)).toBe(117000);
    const monthly = computeTds(tds, 'NEW', 115000, 0, 0);
    // 1,380,000 − 75,000 = 1,305,000 → 20000+40000+15750 = 75750 ×1.04 = 78780 /12
    expect(monthly.amount).toBe(6565);
    expect(computeTds(tds, 'OLD', 100000, 0, 1800).inputs.ANNUAL_TAXABLE).toBe(
      1200000 - 50000 - 21600,
    );
  });

  it('financial year of a date', () => {
    expect(financialYearOf('2025-04-01')).toBe('2025-26');
    expect(financialYearOf('2026-03-31')).toBe('2025-26');
    expect(financialYearOf('2099-12-01')).toBe('2099-00');
  });
});
