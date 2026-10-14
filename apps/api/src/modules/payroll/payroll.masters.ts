import type {
  CalcFields,
  CreateSalaryRuleInput,
  CreateSalaryStructureInput,
  CreateStatutoryRulePackInput,
  ListComponentsQuery,
  PayrollSettingsDto,
  SalaryComponentType,
  StatutoryPack,
  StatutoryRulePackDto,
  StructureLine,
  StructureVersionInput,
  UpdateSalaryComponentInput,
  createSalaryComponentSchema,
  listRulesQuerySchema,
  listStructuresQuerySchema,
  updateSalaryStructureSchema,
  upsertPayrollSettingsSchema,
} from '@erp/shared';
import { DbNull } from '../../core/db/helpers';
import {
  type Prisma,
  type PayrollSetting,
  type SalaryComponent,
  type SalaryRule,
  type SalaryStructureVersion,
} from '@prisma/client';
import type { z } from 'zod';
import { audit } from '../../core/audit';
import { tryGetPrincipal } from '../../core/authz';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../core/http/errors';
import { toListResponse, toPageWindow } from '../../core/http/pagination';
import { tenantDb, withTenant } from '../../core/tenancy';
import { dateStr, toDate } from '../employees/employees.mappers';
import {
  BASE_VARIABLES,
  PayrollEngineError,
  calcDependencies,
  validateComponentGraph,
  type CalcCandidate,
  type CalcSpec,
  type EngineComponent,
  type StatutoryContext,
} from './engine';
import { FormulaError, parseFormula } from './formula';
import {
  assertOrgWide,
  authorizeInstitution,
  institutionFilter,
  institutionIdsFor,
} from './payroll.access';
import {
  ORG_SCOPE,
  scopeKeyOf,
  toComponentDto,
  toRuleDto,
  toStructureDto,
  toStructureVersionDto,
} from './payroll.mappers';
import {
  BUILTIN_FINANCIAL_YEAR,
  builtinPack,
  financialYearOf,
  type EsiConfig,
  type LwfConfig,
  type PackConfig,
  type PfConfig,
  type PtConfig,
  type TdsConfig,
} from './statutory';

/*
 * Payroll masters: salary components, versioned salary rules, salary structures (effective-dated
 * immutable versions), per-institution payroll settings and statutory rule packs. Every
 * institution can carry its own policy (acceptance 7): institution components / rules override
 * organization-level ones with the same code.
 */

const db = () => tenantDb();
const userId = () => tryGetPrincipal()?.userId ?? null;
const json = (v: unknown) => v as Prisma.InputJsonValue;

/* --------------------------------- Validation ------------------------------------------- */

function fieldError(path: string, message: string): never {
  throw new ValidationError(message, { fields: [{ path, message }] });
}

/** Validate a calc spec's own fields (formula syntax, required params). */
export function validateCalc(spec: CalcFields & { calcType?: string | null }, path = ''): void {
  const p = (k: string) => (path ? `${path}.${k}` : k);
  switch (spec.calcType) {
    case 'FIXED':
      break;
    case 'PERCENTAGE':
      if (spec.percentage === null || spec.percentage === undefined) {
        fieldError(p('percentage'), 'percentage is required for PERCENTAGE components');
      }
      break;
    case 'FORMULA':
      if (!spec.formula) fieldError(p('formula'), 'formula is required for FORMULA components');
      try {
        parseFormula(spec.formula);
      } catch (e) {
        if (e instanceof FormulaError) fieldError(p('formula'), e.message);
        throw e;
      }
      break;
    case 'SLAB':
      if (!spec.slabs?.length) fieldError(p('slabs'), 'slabs are required for SLAB components');
      break;
    default:
      break;
  }
}

function validateCondition(condition: string | null | undefined, path: string): void {
  if (!condition) return;
  try {
    parseFormula(condition);
  } catch (e) {
    if (e instanceof FormulaError) fieldError(path, e.message);
    throw e;
  }
}

/** Throw a 422 for engine graph errors (cycles, unknown references). */
function graphCheck(components: EngineComponent[]): void {
  try {
    validateComponentGraph(components);
  } catch (e) {
    if (e instanceof PayrollEngineError || e instanceof FormulaError) {
      throw new AppError(422, 'INVALID_SALARY_GRAPH', e.message);
    }
    throw e;
  }
  // Statutory amounts are computed last, so regular components cannot reference them.
  const known = new Set<string>([
    ...BASE_VARIABLES,
    ...components.filter((c) => !c.statutoryCode).map((c) => c.code),
  ]);
  for (const c of components) {
    for (const cand of c.candidates) {
      const unknown = [...calcDependencies(cand)].filter((d) => !known.has(d));
      if (unknown.length) {
        throw new AppError(
          422,
          'INVALID_SALARY_GRAPH',
          `${c.code} references unknown variable(s): ${unknown.join(', ')}`,
        );
      }
    }
  }
}

const decimalOrNull = (n: number | null | undefined) => (n === undefined ? undefined : n);

function calcData(spec: CalcFields & { calcType?: string | null }) {
  return {
    amount: decimalOrNull(spec.amount),
    percentage: decimalOrNull(spec.percentage),
    percentOf: spec.percentOf,
    formula: spec.formula,
    slabBasis: spec.slabBasis,
    slabs: spec.slabs === undefined ? undefined : spec.slabs === null ? DbNull : json(spec.slabs),
  };
}

const specOf = (r: {
  calcType: string;
  amount: Prisma.Decimal | number | null;
  percentage: Prisma.Decimal | number | null;
  percentOf: string | null;
  formula: string | null;
  slabBasis: string | null;
  slabs: unknown;
}): CalcSpec => ({
  calcType: r.calcType as CalcSpec['calcType'],
  amount: r.amount === null ? null : Number(r.amount),
  percentage: r.percentage === null ? null : Number(r.percentage),
  percentOf: r.percentOf,
  formula: r.formula,
  slabBasis: r.slabBasis,
  slabs: (r.slabs as CalcSpec['slabs']) ?? null,
});

/* --------------------------------- Component resolution --------------------------------- */

/** Active components effective for an institution (institution overrides org by code). */
export async function effectiveComponents(institutionId: string): Promise<SalaryComponent[]> {
  const rows = await db().salaryComponent.findMany({
    where: { scopeKey: { in: [ORG_SCOPE, institutionId] }, status: 'ACTIVE' },
  });
  const byCode = new Map<string, SalaryComponent>();
  for (const r of rows.filter((x) => x.scopeKey === ORG_SCOPE)) byCode.set(r.code, r);
  for (const r of rows.filter((x) => x.scopeKey !== ORG_SCOPE)) byCode.set(r.code, r);
  return [...byCode.values()].sort((a, b) => a.displayOrder - b.displayOrder);
}

/** Latest rule per scope + component effective on `date`. */
async function effectiveRules(institutionId: string, date: Date) {
  const rows = await db().salaryRule.findMany({
    where: { scopeKey: { in: [ORG_SCOPE, institutionId] }, effectiveFrom: { lte: date } },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
  });
  const latest = new Map<string, SalaryRule>();
  for (const r of rows) {
    const key = `${r.scopeKey}:${r.componentCode}`;
    if (!latest.has(key)) latest.set(key, r);
  }
  return latest;
}

/** Structure version in force on `date` (latest effectiveFrom ≤ date). */
export async function structureVersionAsOf(
  structureId: string,
  date: Date,
): Promise<SalaryStructureVersion | null> {
  return db().salaryStructureVersion.findFirst({
    where: { structureId, effectiveFrom: { lte: date } },
    orderBy: { effectiveFrom: 'desc' },
  });
}

/**
 * Build engine components for an institution on `date`. With a structure version, the component
 * set = the structure's lines + every active statutory component; otherwise all active
 * components. Candidate precedence: structure line > institution rule > org rule > component.
 */
export async function resolveComponents(
  institutionId: string,
  date: Date,
  version?: Pick<SalaryStructureVersion, 'version' | 'lines'> | null,
  structureCode?: string,
  extraLines?: StructureLine[],
): Promise<EngineComponent[]> {
  const comps = await effectiveComponents(institutionId);
  const rules = await effectiveRules(institutionId, date);
  const lines = new Map<string, StructureLine>();
  for (const l of (version?.lines as StructureLine[] | undefined) ?? [])
    lines.set(l.componentCode, l);
  for (const l of extraLines ?? []) lines.set(l.componentCode, l);
  const out: EngineComponent[] = [];
  for (const c of comps) {
    const statutory = Boolean(c.statutoryCode) || c.calcType === 'STATUTORY';
    if (version && !statutory && !lines.has(c.code)) continue;
    const candidates: CalcCandidate[] = [];
    if (!statutory) {
      const line = lines.get(c.code);
      if (line?.calcType) {
        candidates.push({
          ...specOf({
            calcType: line.calcType,
            amount: line.amount ?? null,
            percentage: line.percentage ?? null,
            percentOf: line.percentOf ?? null,
            formula: line.formula ?? null,
            slabBasis: line.slabBasis ?? null,
            slabs: line.slabs ?? null,
          }),
          source: `structure:${structureCode ?? '?'}@v${version?.version ?? '?'}`,
        });
      }
      for (const [scope, label] of [
        [institutionId, 'institution'],
        [ORG_SCOPE, 'organization'],
      ] as const) {
        const r = rules.get(`${scope}:${c.code}`);
        if (r) {
          candidates.push({
            ...specOf(r),
            condition: r.condition,
            source: `rule:${label}@v${r.version} (from ${dateStr(r.effectiveFrom)})`,
          });
        }
      }
    }
    candidates.push({
      ...specOf(c),
      source: `component:${c.scopeKey === ORG_SCOPE ? 'organization' : 'institution'}`,
    });
    out.push({
      code: c.code,
      name: c.name,
      type: c.type as SalaryComponentType,
      statutoryCode: c.statutoryCode as EngineComponent['statutoryCode'],
      taxable: c.taxable,
      proRated: c.proRated,
      rounding: c.rounding as EngineComponent['rounding'],
      roundingPrecision: c.roundingPrecision,
      displayOrder: c.displayOrder,
      showOnPayslip: c.showOnPayslip,
      candidates,
    });
  }
  return out;
}

/* --------------------------------- Statutory context ------------------------------------ */

export const DEFAULT_SETTINGS: Omit<PayrollSettingsDto, 'institutionId' | 'id'> = {
  state: null,
  pfEnabled: true,
  esiEnabled: true,
  ptEnabled: true,
  tdsEnabled: true,
  lwfEnabled: false,
  requireAttendanceLock: true,
  payDay: null,
};

const toSettingsDto = (institutionId: string, s: PayrollSetting | null): PayrollSettingsDto =>
  s
    ? {
        id: s.id,
        institutionId,
        state: s.state,
        pfEnabled: s.pfEnabled,
        esiEnabled: s.esiEnabled,
        ptEnabled: s.ptEnabled,
        tdsEnabled: s.tdsEnabled,
        lwfEnabled: s.lwfEnabled,
        requireAttendanceLock: s.requireAttendanceLock,
        payDay: s.payDay,
      }
    : { id: null, institutionId, ...DEFAULT_SETTINGS };

export async function settingsFor(institutionId: string): Promise<PayrollSettingsDto> {
  return toSettingsDto(
    institutionId,
    await db().payrollSetting.findFirst({ where: { institutionId } }),
  );
}

/** Rule pack: latest org override for the FY / region, else the built-in table. */
export async function loadPack(
  pack: StatutoryPack,
  financialYear: string,
  region: string,
): Promise<{ config: PackConfig | null; dto: StatutoryRulePackDto | null }> {
  const row = await db().statutoryRulePack.findFirst({
    where: { pack, financialYear, region },
    orderBy: { version: 'desc' },
  });
  if (row) {
    return {
      config: row.config as unknown as PackConfig,
      dto: {
        id: row.id,
        pack,
        financialYear,
        region,
        version: row.version,
        config: row.config as Record<string, unknown>,
        source: 'custom',
        notes: row.notes,
      },
    };
  }
  const config = builtinPack(pack, region);
  return {
    config,
    dto: config
      ? {
          id: null,
          pack,
          financialYear: BUILTIN_FINANCIAL_YEAR,
          region,
          version: 0,
          config: config as unknown as Record<string, unknown>,
          source: 'builtin',
          notes: 'Built-in default',
        }
      : null,
  };
}

/** Statutory configuration for an institution's run in `periodEnd`'s month. */
export async function statutoryContextFor(
  institutionId: string,
  periodEnd: string,
  regime: 'OLD' | 'NEW',
): Promise<StatutoryContext> {
  const s = await settingsFor(institutionId);
  const fy = financialYearOf(periodEnd);
  const pack = async <T>(p: StatutoryPack, enabled: boolean, region: string | null) =>
    enabled && region ? ((await loadPack(p, fy, region)).config as T | null) : null;
  return {
    month: Number(periodEnd.slice(5, 7)),
    regime,
    pf: await pack<PfConfig>('PF', s.pfEnabled, 'IN'),
    esi: await pack<EsiConfig>('ESI', s.esiEnabled, 'IN'),
    pt: await pack<PtConfig>('PT', s.ptEnabled, s.state),
    tds: await pack<TdsConfig>('TDS', s.tdsEnabled, 'IN'),
    lwf: await pack<LwfConfig>('LWF', s.lwfEnabled, s.state),
    declarations: 0,
  };
}

/* --------------------------------- Default components ----------------------------------- */

type ComponentSeed = z.input<typeof createSalaryComponentSchema>;
const DEFAULT_COMPONENTS: Omit<ComponentSeed, 'institutionId'>[] = [
  {
    code: 'BASIC',
    name: 'Basic',
    type: 'EARNING',
    calcType: 'PERCENTAGE',
    percentage: 50,
    percentOf: 'CTC',
    displayOrder: 10,
  },
  {
    code: 'HRA',
    name: 'House rent allowance',
    type: 'EARNING',
    calcType: 'PERCENTAGE',
    percentage: 40,
    percentOf: 'BASIC',
    displayOrder: 20,
  },
  {
    code: 'SPECIAL',
    name: 'Special allowance',
    type: 'EARNING',
    calcType: 'FORMULA',
    formula: 'max(CTC - BASIC - HRA, 0)',
    displayOrder: 30,
  },
  {
    code: 'PF_EE',
    name: 'Provident fund (employee)',
    type: 'DEDUCTION',
    calcType: 'STATUTORY',
    statutoryCode: 'PF_EE',
    taxable: false,
    proRated: false,
    displayOrder: 110,
  },
  {
    code: 'ESI_EE',
    name: 'ESI (employee)',
    type: 'DEDUCTION',
    calcType: 'STATUTORY',
    statutoryCode: 'ESI_EE',
    taxable: false,
    proRated: false,
    displayOrder: 120,
  },
  {
    code: 'PT',
    name: 'Professional tax',
    type: 'DEDUCTION',
    calcType: 'STATUTORY',
    statutoryCode: 'PT',
    taxable: false,
    proRated: false,
    displayOrder: 130,
  },
  {
    code: 'TDS',
    name: 'Income tax (TDS)',
    type: 'DEDUCTION',
    calcType: 'STATUTORY',
    statutoryCode: 'TDS',
    taxable: false,
    proRated: false,
    displayOrder: 140,
  },
  {
    code: 'PF_ER',
    name: 'Provident fund (employer)',
    type: 'EMPLOYER_CONTRIBUTION',
    calcType: 'STATUTORY',
    statutoryCode: 'PF_ER',
    taxable: false,
    proRated: false,
    displayOrder: 210,
  },
  {
    code: 'ESI_ER',
    name: 'ESI (employer)',
    type: 'EMPLOYER_CONTRIBUTION',
    calcType: 'STATUTORY',
    statutoryCode: 'ESI_ER',
    taxable: false,
    proRated: false,
    displayOrder: 220,
  },
];

/* --------------------------------- Services --------------------------------------------- */

async function authorizeScope(institutionId: string | null | undefined, permission: string) {
  if (institutionId) await authorizeInstitution(institutionId, permission);
  else await assertOrgWide(permission);
}

async function loadComponent(id: string, permission: string) {
  const row = await db().salaryComponent.findFirst({ where: { id } });
  if (!row) throw new NotFoundError('Salary component');
  const ids = await institutionIdsFor(permission);
  if (row.institutionId && ids !== undefined && !ids.includes(row.institutionId)) {
    throw new NotFoundError('Salary component');
  }
  return row;
}

/** Re-validate the graph of an institution (or every institution for org-level changes). */
async function validateScopeGraph(institutionId: string | null) {
  const institutions = institutionId
    ? [institutionId]
    : (await db().institution.findMany({ select: { id: true } })).map((i) => i.id);
  const today = new Date();
  for (const id of institutions) graphCheck(await resolveComponents(id, today));
}

function statutoryShape(input: { calcType?: string | null; statutoryCode?: string | null }) {
  if (input.calcType === 'STATUTORY' && !input.statutoryCode) {
    fieldError('statutoryCode', 'statutoryCode is required for STATUTORY components');
  }
}

export const componentService = {
  async list(query: ListComponentsQuery) {
    const ids = await institutionIdsFor('payroll.view');
    const where: Prisma.SalaryComponentWhereInput = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? { OR: [{ code: { contains: query.search } }, { name: { contains: query.search } }] }
        : {}),
      AND: [
        query.institutionId
          ? { OR: [{ institutionId: null }, { institutionId: query.institutionId }] }
          : {},
        ids === undefined ? {} : { OR: [{ institutionId: null }, { institutionId: { in: ids } }] },
      ],
    };
    const [rows, total] = await Promise.all([
      db().salaryComponent.findMany({
        where,
        orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }, { id: 'asc' }],
        ...toPageWindow(query),
      }),
      db().salaryComponent.count({ where }),
    ]);
    return toListResponse(rows.map(toComponentDto), total, query);
  },

  async get(id: string) {
    return toComponentDto(await loadComponent(id, 'payroll.view'));
  },

  async create(input: z.output<typeof createSalaryComponentSchema>) {
    await authorizeScope(input.institutionId, 'payroll.manage');
    validateCalc(input);
    statutoryShape(input);
    const scopeKey = scopeKeyOf(input.institutionId);
    const dup = await db().salaryComponent.findFirst({ where: { scopeKey, code: input.code } });
    if (dup) throw new ConflictError(`Component ${input.code} already exists in this scope`);
    const row = await db().$transaction(async (tx) => {
      const created = await tx.salaryComponent.create({
        data: withTenant({
          institutionId: input.institutionId ?? null,
          scopeKey,
          code: input.code,
          name: input.name,
          type: input.type,
          calcType: input.calcType,
          ...calcData(input),
          statutoryCode: input.statutoryCode ?? null,
          taxable: input.taxable,
          proRated: input.proRated,
          rounding: input.rounding,
          roundingPrecision: input.roundingPrecision,
          displayOrder: input.displayOrder,
          showOnPayslip: input.showOnPayslip,
          description: input.description ?? null,
        }),
      });
      return created;
    });
    try {
      await validateScopeGraph(input.institutionId ?? null);
    } catch (e) {
      await db().salaryComponent.delete({ where: { id: row.id } });
      throw e;
    }
    await audit.record({
      action: 'payroll.component.create',
      entityType: 'salary_component',
      entityId: row.id,
      after: toComponentDto(row),
    });
    return toComponentDto(row);
  },

  async update(id: string, input: UpdateSalaryComponentInput) {
    const before = await loadComponent(id, 'payroll.manage');
    await authorizeScope(before.institutionId, 'payroll.manage');
    const merged = {
      calcType: input.calcType ?? before.calcType,
      amount: input.amount === undefined ? numberOrNull(before.amount) : input.amount,
      percentage:
        input.percentage === undefined ? numberOrNull(before.percentage) : input.percentage,
      percentOf: input.percentOf === undefined ? before.percentOf : input.percentOf,
      formula: input.formula === undefined ? before.formula : input.formula,
      slabBasis: input.slabBasis === undefined ? before.slabBasis : input.slabBasis,
      slabs: input.slabs === undefined ? (before.slabs as CalcFields['slabs']) : input.slabs,
      statutoryCode: input.statutoryCode === undefined ? before.statutoryCode : input.statutoryCode,
    };
    validateCalc(merged as CalcFields & { calcType: string });
    statutoryShape(merged);
    const row = await db().salaryComponent.update({
      where: { id },
      data: {
        name: input.name,
        calcType: input.calcType,
        ...calcData(input),
        statutoryCode: input.statutoryCode,
        taxable: input.taxable,
        proRated: input.proRated,
        rounding: input.rounding,
        roundingPrecision: input.roundingPrecision,
        displayOrder: input.displayOrder,
        showOnPayslip: input.showOnPayslip,
        description: input.description,
        status: input.status,
      },
    });
    try {
      await validateScopeGraph(before.institutionId);
    } catch (e) {
      const { id: _id, organizationId: _o, createdAt: _c, updatedAt: _u, ...restore } = before;
      await db().salaryComponent.update({
        where: { id },
        data: { ...restore, slabs: before.slabs === null ? undefined : json(before.slabs) },
      });
      throw e;
    }
    await audit.record({
      action: 'payroll.component.update',
      entityType: 'salary_component',
      entityId: id,
      before: toComponentDto(before),
      after: toComponentDto(row),
    });
    return toComponentDto(row);
  },

  /** Create the default component set (BASIC / HRA / SPECIAL + statutory) when missing. */
  async seedDefaults(institutionId: string | null | undefined) {
    await authorizeScope(institutionId, 'payroll.manage');
    const scopeKey = scopeKeyOf(institutionId);
    const existing = new Set(
      (await db().salaryComponent.findMany({ where: { scopeKey }, select: { code: true } })).map(
        (r) => r.code,
      ),
    );
    const created: string[] = [];
    for (const seed of DEFAULT_COMPONENTS) {
      if (existing.has(seed.code)) continue;
      await db().salaryComponent.create({
        data: withTenant({
          institutionId: institutionId ?? null,
          scopeKey,
          code: seed.code,
          name: seed.name,
          type: seed.type,
          calcType: seed.calcType,
          ...calcData(seed),
          statutoryCode: seed.statutoryCode ?? null,
          taxable: seed.taxable ?? true,
          proRated: seed.proRated ?? true,
          displayOrder: seed.displayOrder ?? 100,
        }),
      });
      created.push(seed.code);
    }
    await audit.record({
      action: 'payroll.component.seed_defaults',
      entityType: 'salary_component',
      entityId: null,
      after: { scopeKey, created },
    });
    return componentService.list({
      page: 1,
      pageSize: 100,
      ...(institutionId ? { institutionId } : {}),
    } as ListComponentsQuery);
  },
};

function numberOrNull(d: Prisma.Decimal | null): number | null {
  return d === null ? null : Number(d);
}

/* --------------------------------- Rules ------------------------------------------------ */

export const ruleService = {
  async list(query: z.output<typeof listRulesQuerySchema>) {
    const ids = await institutionIdsFor('payroll.view');
    const where: Prisma.SalaryRuleWhereInput = {
      ...(query.componentCode ? { componentCode: query.componentCode } : {}),
      AND: [
        query.institutionId
          ? { OR: [{ institutionId: null }, { institutionId: query.institutionId }] }
          : {},
        ids === undefined ? {} : { OR: [{ institutionId: null }, { institutionId: { in: ids } }] },
      ],
    };
    const [rows, total] = await Promise.all([
      db().salaryRule.findMany({
        where,
        orderBy: [{ componentCode: 'asc' }, { version: 'desc' }],
        ...toPageWindow(query),
      }),
      db().salaryRule.count({ where }),
    ]);
    return toListResponse(rows.map(toRuleDto), total, query);
  },

  /** Rules are immutable: a change is a new version effective from a date. */
  async create(input: CreateSalaryRuleInput & { calcType: CalcSpec['calcType'] }) {
    await authorizeScope(input.institutionId, 'payroll.manage');
    if (input.calcType === 'STATUTORY') {
      fieldError('calcType', 'Statutory components are configured through rule packs');
    }
    validateCalc(input);
    validateCondition(input.condition, 'condition');
    const scopeKey = scopeKeyOf(input.institutionId);
    const comp = await db().salaryComponent.findFirst({
      where: { code: input.componentCode, scopeKey: { in: [ORG_SCOPE, scopeKey] } },
    });
    if (!comp) fieldError('componentCode', `Unknown component ${input.componentCode}`);
    const last = await db().salaryRule.findFirst({
      where: { scopeKey, componentCode: input.componentCode },
      orderBy: { version: 'desc' },
    });
    const row = await db().salaryRule.create({
      data: withTenant({
        institutionId: input.institutionId ?? null,
        scopeKey,
        componentCode: input.componentCode,
        effectiveFrom: toDate(input.effectiveFrom),
        version: (last?.version ?? 0) + 1,
        calcType: input.calcType,
        ...calcData(input),
        condition: input.condition ?? null,
        notes: input.notes ?? null,
        createdByUserId: userId(),
      }),
    });
    // Validate with the new rule in force (it may introduce a dependency cycle).
    try {
      const institutions = input.institutionId
        ? [input.institutionId]
        : (await db().institution.findMany({ select: { id: true } })).map((i) => i.id);
      for (const id of institutions) {
        graphCheck(await resolveComponents(id, row.effectiveFrom));
      }
    } catch (e) {
      // Rules are immutable at the DB level (UPDATE blocked) but a just-created invalid one is
      // removed before it is ever used.
      await db().salaryRule.delete({ where: { id: row.id } });
      throw e;
    }
    await audit.record({
      action: 'payroll.rule.create',
      entityType: 'salary_rule',
      entityId: row.id,
      after: toRuleDto(row),
    });
    return toRuleDto(row);
  },
};

/* --------------------------------- Structures ------------------------------------------- */

async function validateLines(institutionId: string, lines: StructureLine[], effectiveFrom: Date) {
  const comps = new Map((await effectiveComponents(institutionId)).map((c) => [c.code, c]));
  const seen = new Set<string>();
  lines.forEach((l, i) => {
    if (seen.has(l.componentCode)) {
      fieldError(`version.lines.${i}.componentCode`, `Duplicate component ${l.componentCode}`);
    }
    seen.add(l.componentCode);
    const c = comps.get(l.componentCode);
    if (!c) {
      fieldError(`version.lines.${i}.componentCode`, `Unknown component ${l.componentCode}`);
    }
    if (l.calcType === 'STATUTORY' || c.statutoryCode || c.calcType === 'STATUTORY') {
      fieldError(
        `version.lines.${i}.componentCode`,
        'Statutory components are applied automatically; do not list them in a structure',
      );
    }
    if (l.calcType) validateCalc(l, `version.lines.${i}`);
  });
  graphCheck(
    await resolveComponents(institutionId, effectiveFrom, {
      version: 0,
      lines: lines as unknown as Prisma.JsonValue,
    }),
  );
}

async function loadStructure(id: string, permission: string) {
  const row = await db().salaryStructure.findFirst({ where: { id }, include: { versions: true } });
  if (!row) throw new NotFoundError('Salary structure');
  const ids = await institutionIdsFor(permission);
  if (ids !== undefined && !ids.includes(row.institutionId)) {
    throw new NotFoundError('Salary structure');
  }
  return row;
}

export const structureService = {
  async list(query: z.output<typeof listStructuresQuerySchema>) {
    const ids = await institutionIdsFor('payroll.view');
    const where: Prisma.SalaryStructureWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? { OR: [{ code: { contains: query.search } }, { name: { contains: query.search } }] }
        : {}),
      AND: [
        query.institutionId ? { institutionId: query.institutionId } : {},
        institutionFilter(ids),
      ],
    };
    const [rows, total] = await Promise.all([
      db().salaryStructure.findMany({
        where,
        include: { versions: true },
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        ...toPageWindow(query),
      }),
      db().salaryStructure.count({ where }),
    ]);
    return toListResponse(rows.map(toStructureDto), total, query);
  },

  async get(id: string) {
    return toStructureDto(await loadStructure(id, 'payroll.view'));
  },

  async create(input: CreateSalaryStructureInput) {
    await authorizeInstitution(input.institutionId, 'payroll.manage');
    const effectiveFrom = toDate(input.version.effectiveFrom);
    await validateLines(input.institutionId, input.version.lines, effectiveFrom);
    const dup = await db().salaryStructure.findFirst({
      where: { institutionId: input.institutionId, code: input.code },
    });
    if (dup) throw new ConflictError(`Structure ${input.code} already exists in this institution`);
    const id = await db().$transaction(async (tx) => {
      const s = await tx.salaryStructure.create({
        data: withTenant({
          institutionId: input.institutionId,
          code: input.code,
          name: input.name,
          employmentType: input.employmentType ?? null,
          grade: input.grade ?? null,
          description: input.description ?? null,
        }),
      });
      await tx.salaryStructureVersion.create({
        data: withTenant({
          structureId: s.id,
          version: 1,
          effectiveFrom,
          lines: json(input.version.lines),
          notes: input.version.notes ?? null,
          createdByUserId: userId(),
        }),
      });
      return s.id;
    });
    const dto = toStructureDto(await loadStructure(id, 'payroll.manage'));
    await audit.record({
      action: 'payroll.structure.create',
      entityType: 'salary_structure',
      entityId: id,
      after: dto,
    });
    return dto;
  },

  async update(id: string, input: z.output<typeof updateSalaryStructureSchema>) {
    const before = await loadStructure(id, 'payroll.manage');
    await authorizeInstitution(before.institutionId, 'payroll.manage');
    await db().salaryStructure.update({
      where: { id },
      data: {
        name: input.name,
        grade: input.grade,
        description: input.description,
        status: input.status,
      },
    });
    const dto = toStructureDto(await loadStructure(id, 'payroll.manage'));
    await audit.record({
      action: 'payroll.structure.update',
      entityType: 'salary_structure',
      entityId: id,
      before: toStructureDto(before),
      after: dto,
    });
    return dto;
  },

  /** Add an immutable version effective from a date (history preserved). */
  async addVersion(id: string, input: StructureVersionInput) {
    const s = await loadStructure(id, 'payroll.manage');
    await authorizeInstitution(s.institutionId, 'payroll.manage');
    const effectiveFrom = toDate(input.effectiveFrom);
    if (s.versions.some((v) => v.effectiveFrom.getTime() === effectiveFrom.getTime())) {
      throw new ConflictError(`A version effective ${input.effectiveFrom} already exists`);
    }
    await validateLines(s.institutionId, input.lines, effectiveFrom);
    const version = Math.max(0, ...s.versions.map((v) => v.version)) + 1;
    const row = await db().salaryStructureVersion.create({
      data: withTenant({
        structureId: id,
        version,
        effectiveFrom,
        lines: json(input.lines),
        notes: input.notes ?? null,
        createdByUserId: userId(),
      }),
    });
    await audit.record({
      action: 'payroll.structure.version_create',
      entityType: 'salary_structure',
      entityId: id,
      after: toStructureVersionDto(row),
    });
    return toStructureDto(await loadStructure(id, 'payroll.manage'));
  },
};

/* --------------------------------- Settings & packs ------------------------------------- */

export const settingsService = {
  async get(institutionId: string) {
    await authorizeInstitution(institutionId, 'payroll.view');
    return settingsFor(institutionId);
  },

  async upsert(input: z.output<typeof upsertPayrollSettingsSchema>) {
    await authorizeInstitution(input.institutionId, 'payroll.manage');
    const before = await settingsFor(input.institutionId);
    const data = {
      state: input.state ?? null,
      pfEnabled: input.pfEnabled,
      esiEnabled: input.esiEnabled,
      ptEnabled: input.ptEnabled,
      tdsEnabled: input.tdsEnabled,
      lwfEnabled: input.lwfEnabled,
      requireAttendanceLock: input.requireAttendanceLock,
      payDay: input.payDay ?? null,
    };
    if (before.id) {
      await db().payrollSetting.update({ where: { id: before.id }, data });
    } else {
      await db().payrollSetting.create({
        data: withTenant({ institutionId: input.institutionId, ...data }),
      });
    }
    const after = await settingsFor(input.institutionId);
    await audit.record({
      action: 'payroll.settings.update',
      entityType: 'institution',
      entityId: input.institutionId,
      before,
      after,
    });
    return after;
  },
};

export const statutoryPackService = {
  /** Effective packs (custom override or built-in) for a financial year. */
  async list(financialYear: string, region?: string) {
    await institutionIdsFor('payroll.view');
    const regions = ['IN', ...(region ? [region] : [])];
    const out: StatutoryRulePackDto[] = [];
    for (const p of ['PF', 'ESI', 'TDS'] as const) {
      const { dto } = await loadPack(p, financialYear, 'IN');
      if (dto) out.push(dto);
    }
    const states = new Set<string>(regions.filter((r) => r !== 'IN'));
    const custom = await db().statutoryRulePack.findMany({
      where: { financialYear, pack: { in: ['PT', 'LWF'] } },
      select: { region: true },
    });
    custom.forEach((c) => states.add(c.region));
    for (const st of states) {
      for (const p of ['PT', 'LWF'] as const) {
        const { dto } = await loadPack(p, financialYear, st);
        if (dto) out.push(dto);
      }
    }
    return out;
  },

  /** Add a new version of a pack for a FY / region (data-driven override). */
  async create(input: CreateStatutoryRulePackInput & { region: string }) {
    await assertOrgWide('payroll.manage');
    validatePackConfig(input.pack, input.config);
    const last = await db().statutoryRulePack.findFirst({
      where: { pack: input.pack, financialYear: input.financialYear, region: input.region },
      orderBy: { version: 'desc' },
    });
    const row = await db().statutoryRulePack.create({
      data: withTenant({
        pack: input.pack,
        financialYear: input.financialYear,
        region: input.region,
        version: (last?.version ?? 0) + 1,
        config: json(input.config),
        notes: input.notes ?? null,
        createdByUserId: userId(),
      }),
    });
    await audit.record({
      action: 'payroll.statutory_pack.create',
      entityType: 'statutory_rule_pack',
      entityId: row.id,
      after: {
        pack: row.pack,
        financialYear: row.financialYear,
        region: row.region,
        version: row.version,
        config: input.config,
      },
    });
    return (await loadPack(input.pack, input.financialYear, input.region)).dto!;
  },
};

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isSlabs = (v: unknown, amountKey: string) =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.every(
    (s) =>
      s &&
      typeof s === 'object' &&
      isNum((s as Record<string, unknown>).from) &&
      isNum((s as Record<string, unknown>)[amountKey]),
  );

/** Shape-check a pack config before it can reach the calculators. */
function validatePackConfig(pack: StatutoryPack, config: Record<string, unknown>): void {
  const bad = (msg: string) => fieldError('config', msg);
  switch (pack) {
    case 'PF':
      if (!isNum(config.eeRate) || !isNum(config.erRate) || !isNum(config.wageCeiling)) {
        bad('PF config needs eeRate, erRate, wageCeiling, applyCeiling, basisCodes');
      }
      if (typeof config.applyCeiling !== 'boolean' || !Array.isArray(config.basisCodes)) {
        bad('PF config needs applyCeiling (boolean) and basisCodes (array)');
      }
      break;
    case 'ESI':
      if (!isNum(config.eeRate) || !isNum(config.erRate) || !isNum(config.grossThreshold)) {
        bad('ESI config needs eeRate, erRate, grossThreshold');
      }
      break;
    case 'PT':
      if (!isSlabs(config.slabs, 'amount')) bad('PT config needs slabs [{from, to, amount}]');
      break;
    case 'LWF':
      if (!isNum(config.eeAmount) || !isNum(config.erAmount) || !Array.isArray(config.months)) {
        bad('LWF config needs eeAmount, erAmount, months');
      }
      break;
    case 'TDS': {
      const regimes = config.regimes as Record<string, Record<string, unknown>> | undefined;
      if (!isNum(config.cessPercent) || !regimes?.NEW || !regimes.OLD) {
        bad('TDS config needs cessPercent and regimes.NEW / regimes.OLD');
      }
      for (const r of ['NEW', 'OLD']) {
        if (!isSlabs(regimes![r]!.slabs, 'percent')) bad(`TDS regimes.${r}.slabs is invalid`);
      }
      break;
    }
  }
}
