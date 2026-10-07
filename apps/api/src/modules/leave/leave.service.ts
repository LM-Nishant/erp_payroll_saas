import type {
  CreateLeavePolicyInput,
  CreateLeaveTypeInput,
  LeaveAdjustmentInput,
  LeaveBalanceDto,
  LeavePolicyRuleInput,
  UpdateLeavePolicyInput,
  UpdateLeaveTypeInput,
} from '@erp/shared';
import type { LeavePolicy, LeavePolicyRule, Prisma } from '@prisma/client';
import { audit } from '../../core/audit';
import {
  accessFor,
  andScope,
  assertPermission,
  authorize,
  can,
  currentPrincipal,
  hasPermission,
  hierarchyResource,
  scopeWhere,
} from '../../core/authz';
import { DbNull, isUniqueViolation } from '../../core/db/helpers';
import {
  ConflictError,
  ForbiddenError,
  InvalidReferenceError,
  NotFoundError,
} from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { tenantDb, withTenant } from '../../core/tenancy';
import {
  institutionResource,
  institutionWhere,
  loadEmployeeWith,
} from '../attendance/attendance.access';
import { AttendanceContext } from '../attendance/attendance.context';
import { accrualCredit, accrualPeriods } from '../attendance/attendance.engine';
import { dateToStr, round2, strToDate } from '../attendance/time';
import { toLeavePolicyDto, toLeaveTypeDto, toLedgerDto } from './leave.mappers';
import { pickPolicy } from './leave.rules';

export { pickPolicy };

/*
 * Leave masters + balance ledger (Layer 7).
 * - Leave types are organization-wide masters (`leave.manage` at org level).
 * - Leave policies apply per institution, group or organization × employment type (null = all);
 *   the most specific ACTIVE policy for the employee's as-of assignment applies (see
 *   `pickPolicy`). Policy rules may override application rules (sandwich / notice / limits).
 * - Balances are derived from the append-only `leave_ledger_entries` ledger. The leave year is
 *   the calendar year: balance(year) = Σ entries effective in that year. Year-end closes a year
 *   with ENCASHMENT / LAPSE entries (effective Dec 31) and opens the next with a CARRY_FORWARD
 *   entry (effective Jan 1). System entries carry a `periodKey` so jobs are idempotent.
 */

const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
const policyInclude = { rules: true } as const;
type PolicyWithRules = LeavePolicy & { rules: LeavePolicyRule[] };

function assertAnyPermission(...permissions: string[]) {
  const principal = currentPrincipal();
  if (!permissions.some((p) => hasPermission(principal, p))) {
    throw new ForbiddenError(`Missing permission: ${permissions[0]}`, 'PERMISSION_DENIED');
  }
}

/** Org-level leave masters require an org-wide `leave.manage` grant. */
async function authorizeOrgManage() {
  await authorize(currentPrincipal(), 'leave.manage', {});
}

async function policyResource(scope: { groupId: string | null; institutionId: string | null }) {
  if (scope.institutionId) return institutionResource(scope.institutionId);
  return scope.groupId ? hierarchyResource.group({ id: scope.groupId }) : {};
}

async function validateGroup(groupId: string) {
  const g = await tenantDb().group.findFirst({
    where: { id: groupId, deletedAt: null },
    select: { id: true },
  });
  if (!g) throw new InvalidReferenceError('groupId', 'Group');
}

async function validateRules(rules: LeavePolicyRuleInput[]) {
  const ids = [...new Set(rules.map((r) => r.leaveTypeId))];
  if (ids.length !== rules.length) {
    throw new ConflictError('A leave type may appear only once per policy');
  }
  const db = tenantDb();
  const found = await db.leaveType.count({ where: { id: { in: ids } } });
  if (found !== ids.length) throw new InvalidReferenceError('rules.leaveTypeId', 'Leave type');
  const codes = [...new Set(rules.flatMap((r) => r.notClubbableWith ?? []))];
  if (codes.length) {
    const known = await db.leaveType.findMany({
      where: { code: { in: codes } },
      select: { code: true },
    });
    const upper = new Set(known.map((k) => k.code.toUpperCase()));
    if (codes.some((c) => !upper.has(c.toUpperCase()))) {
      throw new InvalidReferenceError('rules.notClubbableWith', 'Leave type');
    }
  }
}

const jsonOrNull = (v: unknown[] | null | undefined) =>
  v == null ? DbNull : (v as Prisma.InputJsonValue);

const ruleData = (r: LeavePolicyRuleInput) => ({
  leaveTypeId: r.leaveTypeId,
  accrualFrequency: r.accrualFrequency,
  annualQuota: r.annualQuota,
  proRataOnJoining: r.proRataOnJoining,
  maxCarryForward: r.maxCarryForward ?? null,
  sandwichMode: r.sandwichMode ?? null,
  sandwichMinDays: r.sandwichMinDays ?? null,
  sandwichAdjacent: r.sandwichAdjacent ?? null,
  minNoticeDays: r.minNoticeDays ?? null,
  noticeTiers: jsonOrNull(
    r.noticeTiers?.length ? [...r.noticeTiers].sort((a, b) => a.minDays - b.minDays) : null,
  ),
  maxAdvanceDays: r.maxAdvanceDays ?? null,
  allowBackdated: r.allowBackdated ?? null,
  backdatedMaxDays: r.backdatedMaxDays ?? null,
  minDaysPerRequest: r.minDaysPerRequest ?? null,
  maxConsecutiveDays: r.maxConsecutiveDays ?? null,
  maxRequestsPerMonth: r.maxRequestsPerMonth ?? null,
  maxDaysPerMonth: r.maxDaysPerMonth ?? null,
  notClubbableWith: jsonOrNull(
    r.notClubbableWith?.length ? r.notClubbableWith.map((c) => c.toUpperCase()) : null,
  ),
});

export async function activePolicies(): Promise<PolicyWithRules[]> {
  return tenantDb().leavePolicy.findMany({ where: { status: 'ACTIVE' }, include: policyInclude });
}

const yearBounds = (year: number) => ({
  gte: strToDate(`${year}-01-01`),
  lte: strToDate(`${year}-12-31`),
});

/** Balance per leave type for the leave year of `asOf` (ledger sum) plus pending requests. */
export async function computeBalances(
  employeeId: string,
  asOf: string,
  leaveTypeId?: string,
): Promise<LeaveBalanceDto[]> {
  const db = tenantDb();
  const year = Number(asOf.slice(0, 4));
  const [types, sums, pendings] = await Promise.all([
    db.leaveType.findMany({
      where: leaveTypeId ? { id: leaveTypeId } : { status: 'ACTIVE' },
      orderBy: { code: 'asc' },
    }),
    db.leaveLedgerEntry.groupBy({
      by: ['leaveTypeId', 'entryType'],
      where: { employeeId, effectiveDate: yearBounds(year) },
      _sum: { days: true },
    }),
    db.leaveRequest.groupBy({
      by: ['leaveTypeId'],
      where: {
        employeeId,
        status: 'PENDING_APPROVAL',
        fromDate: yearBounds(year),
      },
      _sum: { days: true },
    }),
  ]);
  return types.map((t) => {
    const mine = sums.filter((s) => s.leaveTypeId === t.id);
    const of = (...kinds: string[]) =>
      mine.filter((s) => kinds.includes(s.entryType)).reduce((a, s) => a + num(s._sum.days), 0);
    const balance = round2(mine.reduce((a, s) => a + num(s._sum.days), 0));
    const pending = t.isPaid
      ? round2(num(pendings.find((p) => p.leaveTypeId === t.id)?._sum.days))
      : 0;
    return {
      leaveTypeId: t.id,
      code: t.code,
      name: t.name,
      isPaid: t.isPaid,
      balance,
      pending,
      available: round2(balance - pending),
      accrued: round2(of('ACCRUAL', 'CARRY_FORWARD')),
      consumed: round2(-of('CONSUMPTION', 'REVERSAL')),
    };
  });
}

async function insertSystemEntry(data: {
  employeeId: string;
  leaveTypeId: string;
  entryType: 'ACCRUAL' | 'CARRY_FORWARD' | 'LAPSE' | 'ENCASHMENT';
  days: number;
  effectiveDate: string;
  periodKey: string;
  reason: string;
}): Promise<boolean> {
  try {
    await tenantDb().leaveLedgerEntry.create({
      data: withTenant({
        ...data,
        effectiveDate: strToDate(data.effectiveDate),
        createdByUserId: null,
      }),
    });
    return true;
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}

const ACCRUING_STATUSES = ['ACTIVE', 'ON_NOTICE'] as const;

/**
 * Credit every accrual period of `asOf`'s year that has started by `asOf` (credit in advance),
 * per the employee's policy as of the period start (or joining). Idempotent per period key.
 * No authorization — used by the daily job and the `leave.manage` endpoint.
 */
export async function runAccrual(
  asOf: string,
  employeeIds?: string[],
): Promise<{ employees: number; entries: number; days: number }> {
  const db = tenantDb();
  const employees = await db.employee.findMany({
    where: {
      status: { in: [...ACCRUING_STATUSES] },
      ...(employeeIds ? { id: { in: employeeIds } } : {}),
      dateOfJoining: { lte: strToDate(asOf) },
    },
  });
  const policies = await activePolicies();
  const ctx = new AttendanceContext();
  await ctx.preload(employees.map((e) => e.id));
  const year = Number(asOf.slice(0, 4));
  let entries = 0;
  let days = 0;
  for (const e of employees) {
    const timeline = await ctx.timeline(e.id);
    if (!timeline || !e.dateOfJoining) continue;
    const joining = dateToStr(e.dateOfJoining);
    for (const freq of ['MONTHLY', 'QUARTERLY', 'YEARLY'] as const) {
      for (const period of accrualPeriods(year, freq)) {
        if (period.start > asOf || period.end < joining) continue;
        const at = joining > period.start ? joining : period.start;
        const coords = timeline.at(at);
        if (!coords) continue;
        const policy = pickPolicy(policies, coords);
        for (const rule of policy?.rules ?? []) {
          if (rule.accrualFrequency !== freq) continue;
          const credit = accrualCredit({
            annualQuota: num(rule.annualQuota),
            periodsPerYear: accrualPeriods(year, freq).length,
            period,
            joiningDate: joining,
            proRata: rule.proRataOnJoining,
          });
          if (credit <= 0) continue;
          const created = await insertSystemEntry({
            employeeId: e.id,
            leaveTypeId: rule.leaveTypeId,
            entryType: 'ACCRUAL',
            days: credit,
            effectiveDate: at,
            periodKey: period.key,
            reason: `Accrual ${period.key} (${policy?.name ?? 'policy'})`,
          });
          if (created) {
            entries += 1;
            days += credit;
          }
        }
      }
    }
  }
  return { employees: employees.length, entries, days: round2(days) };
}

/**
 * Close leave year `year`: per employee × leave type with a positive balance, carry forward up
 * to the cap (policy rule cap, else leave type cap; null = unlimited), encash the excess up to
 * `maxEncashDays` when encashable, and lapse the rest. Idempotent via period key `YE-{year}`.
 */
export async function runYearEnd(
  year: number,
  employeeIds?: string[],
): Promise<{ employees: number; carriedForward: number; encashed: number; lapsed: number }> {
  const db = tenantDb();
  const key = `YE-${year}`;
  const sums = await db.leaveLedgerEntry.groupBy({
    by: ['employeeId', 'leaveTypeId'],
    where: {
      effectiveDate: yearBounds(year),
      ...(employeeIds ? { employeeId: { in: employeeIds } } : {}),
    },
    _sum: { days: true },
  });
  const [types, policies, done] = await Promise.all([
    db.leaveType.findMany(),
    activePolicies(),
    db.leaveLedgerEntry.findMany({
      where: { periodKey: key },
      select: { employeeId: true, leaveTypeId: true },
    }),
  ]);
  const closed = new Set(done.map((d) => `${d.employeeId}:${d.leaveTypeId}`));
  const ctx = new AttendanceContext();
  await ctx.preload([...new Set(sums.map((s) => s.employeeId))]);
  const totals = { employees: new Set<string>(), carriedForward: 0, encashed: 0, lapsed: 0 };
  for (const s of sums) {
    const balance = round2(num(s._sum.days));
    if (balance <= 0 || closed.has(`${s.employeeId}:${s.leaveTypeId}`)) continue;
    const type = types.find((t) => t.id === s.leaveTypeId);
    const timeline = await ctx.timeline(s.employeeId);
    if (!type || !timeline) continue;
    if (!(ACCRUING_STATUSES as readonly string[]).includes(timeline.employee.status)) continue;
    const coords = timeline.at(`${year}-12-31`);
    const rule = coords
      ? pickPolicy(policies, coords)?.rules.find((r) => r.leaveTypeId === type.id)
      : undefined;
    const capRaw = rule?.maxCarryForward ?? type.maxCarryForward;
    const cap = capRaw == null ? null : num(capRaw);
    const carry = cap == null ? balance : Math.min(balance, cap);
    const excess = round2(balance - carry);
    const encash = type.encashable
      ? Math.min(excess, type.maxEncashDays == null ? excess : num(type.maxEncashDays))
      : 0;
    const lapse = round2(excess - encash);
    const base = { employeeId: s.employeeId, leaveTypeId: type.id, periodKey: key };
    if (encash > 0) {
      await insertSystemEntry({
        ...base,
        entryType: 'ENCASHMENT',
        days: -encash,
        effectiveDate: `${year}-12-31`,
        reason: `Year-end ${year} encashment`,
      });
    }
    if (lapse > 0) {
      await insertSystemEntry({
        ...base,
        entryType: 'LAPSE',
        days: -lapse,
        effectiveDate: `${year}-12-31`,
        reason: `Year-end ${year} lapse`,
      });
    }
    if (carry > 0) {
      await insertSystemEntry({
        ...base,
        entryType: 'CARRY_FORWARD',
        days: carry,
        effectiveDate: `${year + 1}-01-01`,
        reason: `Carried forward from ${year}`,
      });
    }
    totals.employees.add(s.employeeId);
    totals.carriedForward += carry;
    totals.encashed += encash;
    totals.lapsed += lapse;
  }
  return {
    employees: totals.employees.size,
    carriedForward: round2(totals.carriedForward),
    encashed: round2(totals.encashed),
    lapsed: round2(totals.lapsed),
  };
}

export const leaveService = {
  /* ---- leave types ---- */

  async listTypes(includeInactive = false) {
    assertAnyPermission('leave.view', 'leave.view_own', 'leave.manage');
    const rows = await tenantDb().leaveType.findMany({
      where: includeInactive ? {} : { status: 'ACTIVE' },
      orderBy: { code: 'asc' },
    });
    return rows.map(toLeaveTypeDto);
  },

  async createType(input: CreateLeaveTypeInput) {
    await authorizeOrgManage();
    try {
      const t = await tenantDb().leaveType.create({
        data: withTenant({
          ...input,
          genders: input.genders ?? DbNull,
          employmentTypes: input.employmentTypes ?? DbNull,
          maxEncashDays: input.maxEncashDays ?? null,
          maxCarryForward: input.maxCarryForward ?? null,
        }),
      });
      await audit.record({
        action: 'leave_type.create',
        entityType: 'leave_type',
        entityId: t.id,
        after: toLeaveTypeDto(t),
      });
      return toLeaveTypeDto(t);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('Leave type code already exists');
      throw err;
    }
  },

  async updateType(id: string, input: UpdateLeaveTypeInput) {
    await authorizeOrgManage();
    const db = tenantDb();
    const before = await db.leaveType.findFirst({ where: { id } });
    if (!before) throw new NotFoundError('Leave type');
    const data: Prisma.LeaveTypeUpdateInput = { ...input } as Prisma.LeaveTypeUpdateInput;
    if (input.genders !== undefined) data.genders = input.genders ?? DbNull;
    if (input.employmentTypes !== undefined) {
      data.employmentTypes = input.employmentTypes ?? DbNull;
    }
    const after = await db.leaveType.update({ where: { id }, data });
    await audit.record({
      action: 'leave_type.update',
      entityType: 'leave_type',
      entityId: id,
      before: toLeaveTypeDto(before),
      after: toLeaveTypeDto(after),
    });
    return toLeaveTypeDto(after);
  },

  /* ---- policies ---- */

  async listPolicies() {
    const scope = await institutionWhere('leave.view');
    let where: Prisma.LeavePolicyWhereInput = {};
    if (scope) {
      // Org defaults, groups the caller covers (directly or through an institution) and
      // institutions in scope.
      const access = await accessFor(currentPrincipal(), 'leave.view');
      const groups = await tenantDb().institution.findMany({
        where: { id: { in: [...access.institutionIds] }, groupId: { not: null } },
        select: { groupId: true },
      });
      const groupIds = [
        ...new Set([...access.groupIds, ...groups.map((g) => g.groupId as string)]),
      ];
      where = {
        OR: [
          { institutionId: null, groupId: null },
          { institutionId: null, groupId: { in: groupIds } },
          scope,
        ],
      };
    }
    const rows = await tenantDb().leavePolicy.findMany({
      where,
      include: policyInclude,
      orderBy: [{ institutionId: 'asc' }, { groupId: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toLeavePolicyDto);
  },

  async getPolicy(id: string) {
    const p = await tenantDb().leavePolicy.findFirst({ where: { id }, include: policyInclude });
    if (!p || !(await can(currentPrincipal(), 'leave.view', await policyResource(p)))) {
      throw new NotFoundError('Leave policy');
    }
    return toLeavePolicyDto(p);
  },

  async createPolicy(input: CreateLeavePolicyInput) {
    const scope = {
      groupId: input.institutionId ? null : (input.groupId ?? null),
      institutionId: input.institutionId ?? null,
    };
    if (scope.groupId) await validateGroup(scope.groupId);
    await authorize(currentPrincipal(), 'leave.manage', await policyResource(scope));
    await validateRules(input.rules);
    const db = tenantDb();
    const dup = await db.leavePolicy.findFirst({
      where: { ...scope, employmentType: input.employmentType ?? null, status: 'ACTIVE' },
      select: { id: true },
    });
    if (dup) {
      throw new ConflictError('An active policy already exists for this scope / employment type', {
        policyId: dup.id,
      });
    }
    const p = await db.$transaction(async (tx) => {
      const created = await tx.leavePolicy.create({
        data: withTenant({
          name: input.name,
          ...scope,
          employmentType: input.employmentType ?? null,
        }),
      });
      await tx.leavePolicyRule.createMany({
        data: input.rules.map((r) => withTenant({ ...ruleData(r), policyId: created.id })),
      });
      return tx.leavePolicy.findFirstOrThrow({
        where: { id: created.id },
        include: policyInclude,
      });
    });
    await audit.record({
      action: 'leave_policy.create',
      entityType: 'leave_policy',
      entityId: p.id,
      after: toLeavePolicyDto(p),
    });
    return toLeavePolicyDto(p);
  },

  async updatePolicy(id: string, input: UpdateLeavePolicyInput) {
    const db = tenantDb();
    const before = await db.leavePolicy.findFirst({ where: { id }, include: policyInclude });
    if (!before) throw new NotFoundError('Leave policy');
    await authorize(currentPrincipal(), 'leave.manage', await policyResource(before));
    if (input.rules) await validateRules(input.rules);
    if (input.status === 'ACTIVE' && before.status !== 'ACTIVE') {
      const dup = await db.leavePolicy.findFirst({
        where: {
          id: { not: id },
          groupId: before.groupId,
          institutionId: before.institutionId,
          employmentType: before.employmentType,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      if (dup) throw new ConflictError('Another active policy exists', { policyId: dup.id });
    }
    const rules = input.rules;
    const after = await db.$transaction(async (tx) => {
      if (rules) {
        await tx.leavePolicyRule.deleteMany({ where: { policyId: id } });
        await tx.leavePolicyRule.createMany({
          data: rules.map((r) => withTenant({ ...ruleData(r), policyId: id })),
        });
      }
      await tx.leavePolicy.updateMany({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });
      return tx.leavePolicy.findFirstOrThrow({ where: { id }, include: policyInclude });
    });
    await audit.record({
      action: 'leave_policy.update',
      entityType: 'leave_policy',
      entityId: id,
      before: toLeavePolicyDto(before),
      after: toLeavePolicyDto(after),
    });
    return toLeavePolicyDto(after);
  },

  /* ---- balances / ledger ---- */

  async balances(employeeId: string, asOf?: string) {
    await loadEmployeeWith(employeeId, 'leave.view', 'leave.view_own');
    return computeBalances(employeeId, asOf ?? dateToStr(new Date()));
  },

  async ledger(query: {
    employeeId: string;
    leaveTypeId?: string;
    page: number;
    pageSize: number;
  }) {
    await loadEmployeeWith(query.employeeId, 'leave.view', 'leave.view_own');
    const where: Prisma.LeaveLedgerEntryWhereInput = {
      employeeId: query.employeeId,
      ...(query.leaveTypeId ? { leaveTypeId: query.leaveTypeId } : {}),
    };
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.leaveLedgerEntry.findMany({
        where,
        orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
        ...toPageWindow(query),
      }),
      db.leaveLedgerEntry.count({ where }),
    ]);
    return { items: rows.map(toLedgerDto), total };
  },

  /** Manual ledger entry (`leave.adjust` on the employee). ENCASHMENT debits the balance. */
  async adjust(input: LeaveAdjustmentInput) {
    const principal = currentPrincipal();
    const employee = await loadEmployeeWith(input.employeeId, 'leave.adjust');
    await authorize(principal, 'leave.adjust', hierarchyResource.employee(employee));
    const db = tenantDb();
    const type = await db.leaveType.findFirst({ where: { id: input.leaveTypeId } });
    if (!type) throw new InvalidReferenceError('leaveTypeId', 'Leave type');
    if (input.entryType === 'ENCASHMENT' && !type.encashable) {
      throw new ConflictError('This leave type is not encashable');
    }
    const days = input.entryType === 'ENCASHMENT' ? -input.days : input.days;
    const entry = await db.leaveLedgerEntry.create({
      data: withTenant({
        employeeId: employee.id,
        leaveTypeId: type.id,
        entryType: input.entryType,
        days,
        effectiveDate: strToDate(input.effectiveDate),
        reason: input.reason,
        createdByUserId: principal.userId,
      }),
    });
    await audit.record({
      action: `leave.${input.entryType.toLowerCase()}`,
      entityType: 'employee',
      entityId: employee.id,
      after: toLedgerDto(entry),
      reason: input.reason,
    });
    return toLedgerDto(entry);
  },

  /* ---- accrual / year-end (org-level leave.manage) ---- */

  async runAccrual(asOf?: string) {
    const principal = currentPrincipal();
    assertPermission(principal, 'leave.manage');
    const ids = await scopedEmployeeIds('leave.manage');
    const date = asOf ?? dateToStr(new Date());
    const result = await runAccrual(date, ids);
    await audit.record({
      action: 'leave.accrual_run',
      entityType: 'leave',
      entityId: date,
      after: result,
    });
    return result;
  },

  async runYearEnd(year: number) {
    await authorizeOrgManage();
    const result = await runYearEnd(year);
    await audit.record({
      action: 'leave.year_end',
      entityType: 'leave',
      entityId: String(year),
      after: result,
    });
    return result;
  },
};

/** Employees in the caller's scope for `permission` (undefined = all). */
async function scopedEmployeeIds(permission: string): Promise<string[] | undefined> {
  const scope = await scopeWhere(currentPrincipal(), permission, 'employee');
  if (!scope) return undefined;
  const rows = await tenantDb().employee.findMany({
    where: andScope<Prisma.EmployeeWhereInput>({}, scope),
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
