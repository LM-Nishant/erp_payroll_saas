import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { registerAiTool } from '../../core/ai';
import { andScope, currentPrincipal, hasPermission, scopeWhere } from '../../core/authz';
import { NotFoundError } from '../../core/http/errors';
import { tenantDb } from '../../core/tenancy';
import { attendanceSummaryService } from '../attendance/attendance.summary';
import { dateToStr } from '../attendance/time';
import { employeeService } from '../employees/employees.service';
import { leaveService } from '../leave/leave.service';
import { runService } from '../payroll/payroll.runs';
import { studentService } from '../students/students.service';

/*
 * READ-ONLY tools for the "Ask ERP" assistant. Every tool calls the owning module's
 * scope-aware service AS THE CALLING PRINCIPAL, so the model can only ever see rows the user
 * could see in the UI. The gateway re-checks `anyPermission` + module feature before each call.
 */

const uuid = z.string().uuid();
const employeeRefSchema = z
  .object({
    /** Employee code, name or work e-mail fragment; omitted = the caller's own record. */
    employee: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

const STOP_WORDS = new Set([
  'find',
  'search',
  'lookup',
  'look',
  'up',
  'for',
  'employee',
  'employees',
  'staff',
  'named',
  'called',
  'who',
  'is',
  'the',
  'details',
  'of',
  'show',
  'me',
  'a',
  'an',
  'about',
  'leave',
  'balance',
  'balances',
  'attendance',
  'summary',
  'please',
  'what',
  'my',
  'and',
  'with',
]);

/** Best-effort subject extraction for the mock provider ("find employee Priya" → "Priya"). */
export function extractSubject(question: string): string | undefined {
  const words = question
    .replace(/[?.!,;:"']/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w.toLowerCase()));
  const candidate = words.find((w) => /^[A-Z][a-zA-Z-]+$/.test(w) || /\d/.test(w));
  return candidate ?? undefined;
}

async function ownEmployeeId(): Promise<string> {
  const userId = currentPrincipal().userId;
  if (!userId) throw new NotFoundError('Employee record');
  const own = await tenantDb().employee.findFirst({ where: { userId }, select: { id: true } });
  if (!own) throw new NotFoundError('Your employee record');
  return own.id;
}

/** Resolve an employee reference through the scope-aware employee list (never bypasses scope). */
async function resolveEmployee(ref: string | undefined): Promise<{ id: string; label: string }> {
  if (!ref) return { id: await ownEmployeeId(), label: 'you' };
  if (!hasPermission(currentPrincipal(), 'employee.view')) {
    return { id: await ownEmployeeId(), label: 'you' };
  }
  const { items } = await employeeService.list({ page: 1, pageSize: 2, search: ref });
  const hit = items[0];
  if (!hit) throw new NotFoundError(`Employee "${ref}"`);
  return { id: hit.id, label: `${hit.displayName} (${hit.employeeCode})` };
}

function monthStart(d = new Date()) {
  return dateToStr(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
}

registerAiTool({
  name: 'employee_search',
  description: 'Search employees you can see by name, code or work e-mail (max 10 results).',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Name, employee code or e-mail fragment' },
      limit: { type: 'integer', minimum: 1, maximum: 10 },
    },
    required: ['query'],
    additionalProperties: false,
  },
  argsSchema: z
    .object({
      query: z.string().trim().min(1).max(100),
      limit: z.number().int().min(1).max(10).default(5),
    })
    .strict(),
  anyPermission: ['employee.view'],
  feature: 'hr',
  mock: {
    match: /\b(find|search|look ?up|who is|details of)\b/i,
    priority: 1,
    args: (q) => ({ query: extractSubject(q) ?? q.slice(0, 100) }),
  },
  async handler({ query, limit }) {
    const { items, total } = await employeeService.list({
      page: 1,
      pageSize: limit,
      search: query,
    });
    const rows = items.map((e) => ({
      code: e.employeeCode,
      name: e.displayName,
      status: e.status,
      designation: e.designation?.name ?? null,
      department: e.department?.name ?? null,
      institution: e.institution?.name ?? null,
      dateOfJoining: e.dateOfJoining,
    }));
    const summary =
      total === 0
        ? `No employees matching "${query}" in your scope.`
        : `${total} employee(s) match "${query}": ${rows
            .map(
              (r) =>
                `${r.name} (${r.code}, ${r.designation ?? 'no designation'}, ${r.institution ?? '-'})`,
            )
            .join('; ')}`;
    return { summary, data: { total, employees: rows } };
  },
});

registerAiTool({
  name: 'employee_headcount',
  description: 'Employee headcount in your scope, by status and by institution.',
  parameters: {
    type: 'object',
    properties: { institutionId: { type: 'string', format: 'uuid' } },
    additionalProperties: false,
  },
  argsSchema: z.object({ institutionId: uuid.optional() }).strict(),
  anyPermission: ['employee.view'],
  feature: 'hr',
  mock: {
    match:
      /\b(how many|count|number of|headcount|total)\b.*\b(employees?|staff|people|teachers?)\b|\bheadcount\b/i,
    priority: 3,
  },
  async handler({ institutionId }) {
    const where = andScope<Prisma.EmployeeWhereInput>(
      institutionId ? { institutionId } : {},
      await scopeWhere(currentPrincipal(), 'employee.view', 'employee'),
    );
    const db = tenantDb();
    const [byStatus, byInstitution] = await Promise.all([
      db.employee.groupBy({ by: ['status'], where, _count: { _all: true } }),
      db.employee.groupBy({
        by: ['institutionId'],
        where: andScope<Prisma.EmployeeWhereInput>(where, {
          status: { in: ['ACTIVE', 'ON_NOTICE'] },
        }),
        _count: { _all: true },
      }),
    ]);
    const institutions = await db.institution.findMany({
      where: { id: { in: byInstitution.map((r) => r.institutionId) } },
      select: { id: true, name: true },
    });
    const names = new Map(institutions.map((i) => [i.id, i.name]));
    const statusCounts = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all]));
    const active = (statusCounts.ACTIVE ?? 0) + (statusCounts.ON_NOTICE ?? 0);
    const total = byStatus.reduce((s, r) => s + r._count._all, 0);
    const perInstitution = byInstitution
      .map((r) => ({
        institution: names.get(r.institutionId) ?? r.institutionId,
        active: r._count._all,
      }))
      .sort((a, b) => b.active - a.active);
    return {
      summary: `Headcount: ${active} active employees (${total} records incl. exited/inactive)${
        perInstitution.length
          ? ` — ${perInstitution.map((p) => `${p.institution}: ${p.active}`).join(', ')}`
          : ''
      }.`,
      data: { active, total, byStatus: statusCounts, byInstitution: perInstitution },
    };
  },
});

registerAiTool({
  name: 'leave_balances',
  description:
    "Leave balances of an employee (by code/name) or, when omitted, of the caller's own record.",
  parameters: {
    type: 'object',
    properties: { employee: { type: 'string', description: 'Employee code or name' } },
    additionalProperties: false,
  },
  argsSchema: employeeRefSchema,
  anyPermission: ['leave.view', 'leave.view_own'],
  feature: 'hr',
  mock: {
    match: /\bleaves?\b/i,
    priority: 2,
    args: (q) => {
      const subject = /\bmy\b/i.test(q) ? undefined : extractSubject(q);
      return subject ? { employee: subject } : {};
    },
  },
  async handler({ employee }) {
    const target = await resolveEmployee(employee);
    const balances = await leaveService.balances(target.id);
    const rows = balances.map((b) => ({
      code: b.code,
      name: b.name,
      available: b.available,
      pending: b.pending,
      consumed: b.consumed,
    }));
    return {
      summary: rows.length
        ? `Leave balances for ${target.label}: ${rows.map((r) => `${r.code} ${r.available} available`).join(', ')}.`
        : `No leave types / balances found for ${target.label}.`,
      data: { employee: target.label, balances: rows },
    };
  },
});

registerAiTool({
  name: 'attendance_summary',
  description:
    'Attendance summary for a date range (default: this month to date) for an employee, or aggregated over everyone you can see.',
  parameters: {
    type: 'object',
    properties: {
      employee: {
        type: 'string',
        description: 'Employee code or name; omit for everyone in scope',
      },
      from: { type: 'string', format: 'date' },
      to: { type: 'string', format: 'date' },
    },
    additionalProperties: false,
  },
  argsSchema: z
    .object({
      employee: z.string().trim().min(1).max(100).optional(),
      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    })
    .strict(),
  anyPermission: ['attendance.view', 'attendance.view_own'],
  feature: 'hr',
  mock: {
    match: /\b(attendance|absent|absence|present|late comers?|latecomers?)\b/i,
    priority: 2,
    args: (q) => {
      const subject = /\bmy\b/i.test(q) ? undefined : extractSubject(q);
      return subject ? { employee: subject } : {};
    },
  },
  async handler({ employee, from, to }) {
    const today = dateToStr(new Date());
    const range = { from: from ?? monthStart(), to: to ?? today };
    if (range.from > range.to) range.from = range.to;
    const principal = currentPrincipal();
    let employeeId: string | undefined;
    let label = 'everyone in your scope';
    if (employee || !hasPermission(principal, 'attendance.view')) {
      const target = await resolveEmployee(employee);
      employeeId = target.id;
      label = target.label;
    }
    const rows = await attendanceSummaryService.summary({ ...range, employeeId });
    const totals = rows.reduce(
      (acc, r) => ({
        present: acc.present + r.presentDays,
        absent: acc.absent + r.absentDays,
        lop: acc.lop + r.lopDays,
        late: acc.late + r.lateCount,
        paidLeave: acc.paidLeave + r.paidLeaveDays,
      }),
      { present: 0, absent: 0, lop: 0, late: 0, paidLeave: 0 },
    );
    const topAbsent = [...rows]
      .filter((r) => r.absentDays > 0)
      .sort((a, b) => b.absentDays - a.absentDays)
      .slice(0, 5)
      .map((r) => ({
        employeeCode: r.employeeCode,
        absentDays: r.absentDays,
        lateCount: r.lateCount,
      }));
    return {
      summary: `Attendance ${range.from}..${range.to} for ${label} (${rows.length} employee(s)): ${totals.present} present days, ${totals.absent} absent, ${totals.paidLeave} paid leave, ${totals.lop} LOP, ${totals.late} late marks.`,
      data: { range, employees: rows.length, totals, topAbsent },
    };
  },
});

registerAiTool({
  name: 'payroll_run_totals',
  description: 'Recent payroll runs you can see with gross / deductions / net totals.',
  parameters: {
    type: 'object',
    properties: {
      periodStart: { type: 'string', format: 'date', description: 'First day of the month' },
      institutionId: { type: 'string', format: 'uuid' },
      limit: { type: 'integer', minimum: 1, maximum: 6 },
    },
    additionalProperties: false,
  },
  argsSchema: z
    .object({
      periodStart: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      institutionId: uuid.optional(),
      limit: z.number().int().min(1).max(6).default(3),
    })
    .strict(),
  anyPermission: ['payroll.view'],
  feature: 'payroll',
  mock: { match: /\b(payroll|salary|salaries|net pay|wage bill|ctc)\b/i, priority: 2 },
  async handler({ periodStart, institutionId, limit }) {
    const list = await runService.list({
      page: 1,
      pageSize: limit,
      ...(periodStart ? { periodStart } : {}),
      ...(institutionId ? { institutionId } : {}),
    });
    const runs = list.data.map((r) => ({
      label: r.label,
      institution: r.institutionName,
      periodStart: r.periodStart,
      status: r.status,
      employees: r.employeeCount,
      gross: r.grossTotal,
      deductions: r.deductionTotal,
      net: r.netTotal,
    }));
    return {
      summary: runs.length
        ? `Latest payroll runs: ${runs
            .map(
              (r) =>
                `${r.label} (${r.institution ?? '-'}, ${r.status}): ${r.employees} employees, net ₹${r.net.toLocaleString('en-IN')}`,
            )
            .join('; ')}.`
        : 'No payroll runs found in your scope.',
      data: { total: list.meta.total, runs },
    };
  },
});

registerAiTool({
  name: 'student_counts',
  description: 'Student counts by status and admissions pipeline counts in your scope.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  argsSchema: z.object({}).strict(),
  anyPermission: ['student.view'],
  feature: 'education',
  mock: { match: /\b(students?|admissions?|enrol(l)?(ed|ment)?|pupils?)\b/i, priority: 2 },
  async handler() {
    const stats = await studentService.stats();
    const total = stats.studentsByStatus.reduce((s, r) => s + r.count, 0);
    const active = stats.studentsByStatus.find((r) => r.status === 'ACTIVE')?.count ?? 0;
    const admissions = stats.admissionsByStatus.reduce((s, r) => s + r.count, 0);
    return {
      summary: `Students: ${active} active of ${total} total (${
        stats.studentsByStatus.map((r) => `${r.status} ${r.count}`).join(', ') || 'none'
      }); ${admissions} admission application(s).`,
      data: stats,
    };
  },
});
