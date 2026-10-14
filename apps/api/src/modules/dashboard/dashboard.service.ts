import type { DashboardOverviewDto, DashboardOverviewQuery, FeatureKey } from '@erp/shared';
import {
  accessFor,
  currentPrincipal,
  hasPermission,
  scopeWhere,
  type ScopedModel,
} from '../../core/authz';
import { currentFeatureContext, enabledFeaturesAnywhere } from '../../core/features';
import { InvalidReferenceError } from '../../core/http/errors';
import { tenantDb } from '../../core/tenancy';

const TREND_MAX_DAYS = 62;
const DAY_MS = 86_400_000;

type Where = Record<string, unknown>;
type Num = { toString(): string } | number | null | undefined;

const num = (v: Num) => (v === null || v === undefined ? 0 : Number(v));
const round = (v: number) => Math.round(v * 100) / 100;
const dateStr = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** AND-combine where fragments, dropping empty ones. */
const and = (...parts: (Where | undefined)[]): Where => {
  const list = parts.filter((p): p is Where => Boolean(p) && Object.keys(p as Where).length > 0);
  return list.length === 0 ? {} : list.length === 1 ? list[0]! : { AND: list };
};

interface Ctx {
  /** Inclusive start / exclusive end of the range (UTC midnight). */
  gte: Date;
  lt: Date;
  from: string;
  to: string;
  days: number;
  inst: Where;
  features: Set<FeatureKey>;
}

const p = () => currentPrincipal();

/** Section is shown only with the permission and its module enabled somewhere in the tenant. */
const allowed = (ctx: Ctx, permission: string, feature: FeatureKey) =>
  ctx.features.has(feature) && hasPermission(p(), permission);

const scoped = (permission: string, model: ScopedModel) => scopeWhere(p(), permission, model);

/** Institution-only scoping (payroll, hostel, transport rows). */
async function institutionScope(permission: string): Promise<Where> {
  const access = await accessFor(p(), permission);
  return access.all ? {} : { institutionId: { in: [...access.institutionIds] } };
}

async function fees(ctx: Ctx): Promise<NonNullable<DashboardOverviewDto['fees']>> {
  const db = tenantDb();
  const scope = await scoped('fee.view', 'finance');
  const base = and(scope, ctx.inst);
  const inRange = { gte: ctx.gte, lt: ctx.lt };
  const open = { status: { in: ['UNPAID', 'PARTIAL'] } };
  const [paid, refunds, upi, dueRows, outstandingRows] = await Promise.all([
    db.feePayment.aggregate({
      where: and(base, { paidOn: inRange, status: { not: 'CANCELLED' } }),
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.feeRefund.aggregate({ where: and(base, { refundedOn: inRange }), _sum: { amount: true } }),
    db.feeUpiPayment.aggregate({
      where: and(base, { status: 'PENDING' }),
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.feeInvoice.aggregate({
      where: and(base, open, { dueDate: inRange }),
      _sum: { netAmount: true, paidAmount: true },
    }),
    db.feeInvoice.aggregate({
      where: and(base, open, { dueDate: { lt: ctx.lt } }),
      _sum: { netAmount: true, paidAmount: true },
    }),
  ]);
  const collected = num(paid._sum.amount);
  const refunded = num(refunds._sum.amount);
  return {
    collected: round(collected),
    receipts: paid._count._all,
    refunded: round(refunded),
    netCollected: round(collected - refunded),
    upiPending: { count: upi._count._all, amount: round(num(upi._sum.amount)) },
    dueInRange: round(num(dueRows._sum.netAmount) - num(dueRows._sum.paidAmount)),
    outstanding: round(num(outstandingRows._sum.netAmount) - num(outstandingRows._sum.paidAmount)),
  };
}

async function expenses(ctx: Ctx): Promise<NonNullable<DashboardOverviewDto['expenses']>> {
  const agg = await tenantDb().expense.aggregate({
    where: and(await scoped('finance.view', 'finance'), ctx.inst, {
      expenseDate: { gte: ctx.gte, lt: ctx.lt },
      status: { not: 'CANCELLED' },
    }),
    _sum: { amount: true },
    _count: { _all: true },
  });
  return { total: round(num(agg._sum.amount)), count: agg._count._all };
}

async function payroll(ctx: Ctx): Promise<NonNullable<DashboardOverviewDto['payroll']>> {
  const db = tenantDb();
  const scope = and(await institutionScope('payroll.view'), ctx.inst);
  const [finalized, runs] = await Promise.all([
    db.payrollRun.aggregate({
      where: and(scope, { status: 'FINALIZED', finalizedAt: { gte: ctx.gte, lt: ctx.lt } }),
      _sum: { netTotal: true },
      _count: { _all: true },
    }),
    db.payrollRun.findMany({ where: and(scope, { status: 'FINALIZED' }), select: { id: true } }),
  ]);
  const runIds = runs.map((r) => r.id);
  const [paid, pending] = await Promise.all([
    db.payrollPayment.aggregate({
      where: { runId: { in: runIds }, status: 'PAID', paidAt: { gte: ctx.gte, lt: ctx.lt } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.payrollPayment.aggregate({
      where: { runId: { in: runIds }, status: 'PENDING' },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);
  return {
    finalizedNet: round(num(finalized._sum.netTotal)),
    finalizedRuns: finalized._count._all,
    paid: round(num(paid._sum.amount)),
    paidCount: paid._count._all,
    pendingPayout: round(num(pending._sum.amount)),
    pendingPayoutCount: pending._count._all,
  };
}

async function students(ctx: Ctx): Promise<NonNullable<DashboardOverviewDto['students']>> {
  const db = tenantDb();
  const active = await db.student.count({
    where: and(await scoped('student.view', 'student'), ctx.inst, { status: 'ACTIVE' }),
  });
  const out: NonNullable<DashboardOverviewDto['students']> = { active };
  if (hasPermission(p(), 'student_attendance.view')) {
    const rows = await db.studentAttendance.groupBy({
      by: ['status'],
      where: and(await scoped('student_attendance.view', 'academicUnit'), ctx.inst, {
        date: { gte: ctx.gte, lt: ctx.lt },
        periodKey: '',
      }),
      _count: { _all: true },
    });
    const c = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
    out.attendance = {
      marked: rows.reduce((t, r) => t + r._count._all, 0),
      present: c('PRESENT'),
      absent: c('ABSENT'),
      late: c('LATE'),
      leave: c('LEAVE'),
      halfDay: c('HALF_DAY'),
    };
  }
  return out;
}

async function employees(ctx: Ctx): Promise<NonNullable<DashboardOverviewDto['employees']>> {
  const db = tenantDb();
  const active = await db.employee.count({
    where: and(await scoped('employee.view', 'employee'), ctx.inst, {
      status: { in: ['ACTIVE', 'ON_NOTICE'] },
    }),
  });
  const out: NonNullable<DashboardOverviewDto['employees']> = { active };
  if (hasPermission(p(), 'attendance.view')) {
    const rows = await db.attendanceRecord.groupBy({
      by: ['status', 'overrideStatus'],
      where: and(await scoped('attendance.view', 'employee'), ctx.inst, {
        date: { gte: ctx.gte, lt: ctx.lt },
      }),
      _count: { _all: true },
    });
    const totals: Record<string, number> = {};
    for (const r of rows) {
      const s = r.overrideStatus ?? r.status;
      totals[s] = (totals[s] ?? 0) + r._count._all;
    }
    const c = (...s: string[]) => s.reduce((t, k) => t + (totals[k] ?? 0), 0);
    out.attendance = {
      present: c('PRESENT', 'ON_DUTY'),
      absent: c('ABSENT', 'LOP'),
      late: c('LATE'),
      halfDay: c('HALF_DAY'),
      onLeave: c('ON_LEAVE'),
      offOrHoliday: c('HOLIDAY', 'WEEKLY_OFF'),
    };
  }
  if (hasPermission(p(), 'leave.view')) {
    const scope = and(await scoped('leave.view', 'employee'), ctx.inst);
    const [onLeave, pendingRequests] = await Promise.all([
      db.leaveRequest.findMany({
        where: and(scope, {
          status: 'APPROVED',
          fromDate: { lt: ctx.lt },
          toDate: { gte: ctx.gte },
        }),
        select: { employeeId: true },
        distinct: ['employeeId'],
      }),
      db.leaveRequest.count({ where: and(scope, { status: 'PENDING_APPROVAL' }) }),
    ]);
    out.leave = { onApprovedLeave: onLeave.length, pendingRequests };
  }
  return out;
}

async function hostel(ctx: Ctx): Promise<NonNullable<DashboardOverviewDto['hostel']>> {
  const db = tenantDb();
  const scope = and(await institutionScope('hostel.view'), ctx.inst);
  const [hostels, beds] = await Promise.all([
    db.hostel.count({ where: and(scope, { status: 'ACTIVE' }) }),
    db.hostelBed.groupBy({
      by: ['status'],
      where: and(scope, { hostel: { status: 'ACTIVE' } }),
      _count: { _all: true },
    }),
  ]);
  const c = (s: string) => beds.find((b) => b.status === s)?._count._all ?? 0;
  return {
    hostels,
    beds: beds.reduce((t, b) => t + b._count._all, 0),
    occupied: c('OCCUPIED'),
    available: c('AVAILABLE'),
    blocked: c('BLOCKED'),
  };
}

async function transport(ctx: Ctx): Promise<NonNullable<DashboardOverviewDto['transport']>> {
  const db = tenantDb();
  const scope = and(await institutionScope('transport.view'), ctx.inst);
  const [vehicles, routes, allocated] = await Promise.all([
    db.transportVehicle.aggregate({
      where: and(scope, { status: 'ACTIVE' }),
      _sum: { capacity: true },
      _count: { _all: true },
    }),
    db.transportRoute.count({ where: and(scope, { status: 'ACTIVE' }) }),
    db.transportAllocation.count({
      where: and(scope, {
        status: 'ACTIVE',
        effectiveFrom: { lt: ctx.lt },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: ctx.gte } }],
      }),
    }),
  ]);
  const capacity = vehicles._sum.capacity ?? 0;
  return {
    vehicles: vehicles._count._all,
    capacity,
    allocated,
    available: Math.max(0, capacity - allocated),
    routes,
  };
}

async function trend(
  ctx: Ctx,
  withFees: boolean,
  withExpenses: boolean,
): Promise<NonNullable<DashboardOverviewDto['trend']>> {
  const db = tenantDb();
  const range = { gte: ctx.gte, lt: ctx.lt };
  const [paid, spent] = await Promise.all([
    withFees
      ? db.feePayment.groupBy({
          by: ['paidOn'],
          where: and(await scoped('fee.view', 'finance'), ctx.inst, {
            paidOn: range,
            status: { not: 'CANCELLED' },
          }),
          _sum: { amount: true },
        })
      : [],
    withExpenses
      ? db.expense.groupBy({
          by: ['expenseDate'],
          where: and(await scoped('finance.view', 'finance'), ctx.inst, {
            expenseDate: range,
            status: { not: 'CANCELLED' },
          }),
          _sum: { amount: true },
        })
      : [],
  ]);
  const byDay = new Map<string, { collected: number; expenses: number }>();
  for (let t = ctx.gte.getTime(); t < ctx.lt.getTime(); t += DAY_MS) {
    byDay.set(dateStr(new Date(t)), { collected: 0, expenses: 0 });
  }
  for (const r of paid) {
    const d = byDay.get(dateStr(r.paidOn));
    if (d) d.collected = round(d.collected + num(r._sum.amount));
  }
  for (const r of spent) {
    const d = byDay.get(dateStr(r.expenseDate));
    if (d) d.expenses = round(d.expenses + num(r._sum.amount));
  }
  return [...byDay].map(([date, v]) => ({ date, ...v }));
}

export const dashboardService = {
  async overview(query: DashboardOverviewQuery): Promise<DashboardOverviewDto> {
    if (query.institutionId) {
      const inst = await tenantDb().institution.findUnique({ where: { id: query.institutionId } });
      if (!inst) throw new InvalidReferenceError('institutionId', 'Institution');
    }
    const gte = utc(query.from);
    const lt = new Date(utc(query.to).getTime() + DAY_MS);
    const ctx: Ctx = {
      gte,
      lt,
      from: query.from,
      to: query.to,
      days: Math.round((lt.getTime() - gte.getTime()) / DAY_MS),
      inst: query.institutionId ? { institutionId: query.institutionId } : {},
      features: new Set(await enabledFeaturesAnywhere(currentFeatureContext())),
    };
    const show = {
      fees: allowed(ctx, 'fee.view', 'finance'),
      expenses: allowed(ctx, 'finance.view', 'finance'),
      payroll: allowed(ctx, 'payroll.view', 'payroll'),
      students: allowed(ctx, 'student.view', 'education'),
      employees: allowed(ctx, 'employee.view', 'hr'),
      hostel: allowed(ctx, 'hostel.view', 'hostel'),
      transport: allowed(ctx, 'transport.view', 'transport'),
    };
    const [f, e, pay, s, emp, h, t, tr] = await Promise.all([
      show.fees ? fees(ctx) : undefined,
      show.expenses ? expenses(ctx) : undefined,
      show.payroll ? payroll(ctx) : undefined,
      show.students ? students(ctx) : undefined,
      show.employees ? employees(ctx) : undefined,
      show.hostel ? hostel(ctx) : undefined,
      show.transport ? transport(ctx) : undefined,
      (show.fees || show.expenses) && ctx.days <= TREND_MAX_DAYS
        ? trend(ctx, show.fees, show.expenses)
        : undefined,
    ]);
    const dto: DashboardOverviewDto = {
      range: { from: ctx.from, to: ctx.to, days: ctx.days },
      institutionId: query.institutionId ?? null,
    };
    if (f) dto.fees = f;
    if (e) dto.expenses = e;
    if (pay) dto.payroll = pay;
    if (f && e) {
      const outflow = e.total + (pay?.paid ?? 0);
      dto.cashFlow = {
        inflow: f.netCollected,
        outflow: round(outflow),
        net: round(f.netCollected - outflow),
      };
    }
    if (s) dto.students = s;
    if (emp) dto.employees = emp;
    if (h) dto.hostel = h;
    if (t) dto.transport = t;
    if (tr) dto.trend = tr;
    return dto;
  },
};
