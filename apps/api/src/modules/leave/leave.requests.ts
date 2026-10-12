import type {
  ApplyLeaveInput,
  LeavePreviewDto,
  LeaveRuleViolationDto,
  LeavePreviewInput,
  ListLeaveRequestsQuery,
} from '@erp/shared';
import type { Employee, LeaveRequest, LeaveType, Prisma } from '@prisma/client';
import { audit } from '../../core/audit';
import {
  andScope,
  authorize,
  can,
  currentPrincipal,
  hasPermission,
  hierarchyResource,
  scopeWhere,
} from '../../core/authz';
import { emit } from '../../core/events';
import {
  AppError,
  ConflictError,
  InvalidReferenceError,
  NotFoundError,
  ValidationError,
} from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { tenantDb, withTenant } from '../../core/tenancy';
import { submitWorkflow, type WorkflowInstanceRef } from '../../core/workflow';
import { cancelWorkflow } from '../../core/workflow/engine';
import { assertActionable, loadEmployeeWith, ownEmployee } from '../attendance/attendance.access';
import { computeAttendance } from '../attendance/attendance.compute';
import { AttendanceContext } from '../attendance/attendance.context';
import { calculateLeaveDays, type LeaveCalendarDay } from '../attendance/attendance.engine';
import {
  addDays,
  dateToStr,
  eachDate,
  isWeeklyOff,
  localToday,
  strToDate,
} from '../attendance/time';
import { managerUserId, notify } from '../employees/employees.service';
import { shiftWeeklyOffs } from '../shifts/shifts.resolver';
import { toLeaveRequestDto } from './leave.mappers';
import {
  checkRules,
  describeRules,
  effectiveRules,
  pickPolicy,
  type EffectiveLeaveRules,
} from './leave.rules';
import { activePolicies, computeBalances } from './leave.service';

/*
 * Leave requests (workflow `leave_request`, requester = the employee's user so
 * `reporting_manager` steps route to their manager; auto-approved without a definition).
 * Day count honours the employee's as-of holiday calendar, shift / calendar weekly offs, half
 * days and the sandwich rule (policy rule override, else leave type). Policy rules (notice,
 * limits, clubbing) are enforced on apply (422) unless HR overrides with an audited reason. Approval posts a CONSUMPTION ledger entry (paid
 * types) and recomputes attendance; cancelling an approved request posts a REVERSAL.
 */

export const LEAVE_WORKFLOW = 'leave_request';
const MAX_LEAVE_SPAN_DAYS = 180;
const requestInclude = {
  employee: { select: { employeeCode: true, displayName: true } },
  leaveType: { select: { code: true } },
} as const;

interface Computed {
  type: LeaveType;
  /** Effective range (may include charged adjacent sandwich days). */
  fromDate: string;
  toDate: string;
  days: number;
  breakdown: (LeaveCalendarDay & { days: number; sandwiched: boolean })[];
  institutionId: string;
  coords: { groupId: string | null; campusId: string | null; departmentId: string | null };
  requiresDocument: boolean;
  rules: EffectiveLeaveRules;
  violations: LeaveRuleViolationDto[];
}

/** Max non-working days walked to find leave adjacent to a request (long holiday breaks). */
const ADJACENT_GAP_LIMIT = 14;
const ACTIVE_REQUEST_STATUSES = ['PENDING_APPROVAL', 'APPROVED'] as const;
type DayBreakdown = { date: string; days: number }[];

const monthEnd = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

/** Leave-day calculation, eligibility and policy rule checks for `employee` (no persistence). */
async function computeRequest(
  employee: Employee,
  input: Pick<ApplyLeaveInput, 'leaveTypeId' | 'fromDate' | 'toDate' | 'startHalf' | 'endHalf'>,
  ctx: AttendanceContext,
): Promise<Computed> {
  const db = tenantDb();
  const type = await db.leaveType.findFirst({
    where: { id: input.leaveTypeId, status: 'ACTIVE' },
  });
  if (!type) throw new InvalidReferenceError('leaveTypeId', 'Leave type');
  const dates = eachDate(input.fromDate, input.toDate);
  if (dates.length > MAX_LEAVE_SPAN_DAYS) {
    throw new ValidationError(`A request may span at most ${MAX_LEAVE_SPAN_DAYS} days`);
  }
  if (input.fromDate === input.toDate && input.startHalf && input.endHalf) {
    throw new ValidationError('A single day cannot be both a second and a first half', {
      fields: [{ path: 'endHalf', message: 'Use either startHalf or endHalf for one day' }],
    });
  }
  if ((input.startHalf || input.endHalf) && !type.allowHalfDay) {
    throw new ValidationError('This leave type does not allow half days', {
      fields: [{ path: 'startHalf', message: 'Half days are not allowed' }],
    });
  }
  const timeline = await ctx.timeline(employee.id);
  /** Calendar kind of a date; null when not employed / no assignment. */
  const resolveDay = async (date: string): Promise<LeaveCalendarDay | null> => {
    const coords = timeline?.at(date);
    if (!coords || !timeline?.employedOn(date)) return null;
    const day = await ctx.holidays.resolve(coords, date);
    const shift = await ctx.shifts.resolve(employee.id, coords, date);
    const shiftOffs = shiftWeeklyOffs(shift.shift);
    if (day.holiday) return { date, kind: 'HOLIDAY', name: day.holiday.name };
    if (shiftOffs ? isWeeklyOff(shiftOffs, date) : day.weeklyOff) {
      return { date, kind: 'WEEKLY_OFF', name: 'Weekly off' };
    }
    return { date, kind: 'WORKING' };
  };
  const calendar: LeaveCalendarDay[] = [];
  for (const date of dates) {
    const day = await resolveDay(date);
    if (!day) {
      throw new ValidationError('The leave falls outside the employment period', {
        fields: [{ path: 'toDate', message: `Not employed on ${date}` }],
      });
    }
    calendar.push(day);
  }
  const first = timeline?.at(input.fromDate);
  if (!first) throw new ValidationError('No assignment on the start date');
  // Eligibility (as of the start date).
  const types = type.employmentTypes as string[] | null;
  if (types && (!first.employmentType || !types.includes(first.employmentType))) {
    throw new AppError(
      422,
      'LEAVE_NOT_ELIGIBLE',
      'Not eligible for this leave type (employment type)',
    );
  }
  const genders = type.genders as string[] | null;
  if (genders) {
    const profile = await db.employeeProfile.findFirst({
      where: { employeeId: employee.id },
      select: { gender: true },
    });
    if (!profile?.gender || !genders.includes(profile.gender)) {
      throw new AppError(422, 'LEAVE_NOT_ELIGIBLE', 'Not eligible for this leave type (gender)');
    }
  }

  // Policy rules in force (as of the start date).
  const policy = pickPolicy(await activePolicies(), first);
  const rules = effectiveRules(
    type,
    policy?.rules.find((r) => r.leaveTypeId === type.id),
    policy,
  );

  // Existing leave around the request: adjacency (clubbing / cross-request sandwich).
  const nearby = await db.leaveRequest.findMany({
    where: {
      employeeId: employee.id,
      status: { in: [...ACTIVE_REQUEST_STATUSES] },
      fromDate: { lte: strToDate(addDays(input.toDate, ADJACENT_GAP_LIMIT + 1)) },
      toDate: { gte: strToDate(addDays(input.fromDate, -(ADJACENT_GAP_LIMIT + 1))) },
    },
    include: { leaveType: { select: { code: true } } },
  });
  const coveringCode = (date: string) =>
    nearby.find((r) => dateToStr(r.fromDate) <= date && dateToStr(r.toDate) >= date)?.leaveType
      .code ?? null;
  /** Walk non-working days away from the request; stop at the first working / leave day. */
  const walk = async (from: string, step: 1 | -1) => {
    const gap: LeaveCalendarDay[] = [];
    let d = addDays(from, step);
    for (let i = 0; i <= ADJACENT_GAP_LIMIT; i += 1) {
      const code = coveringCode(d);
      if (code) return { gap, adjacentCode: code };
      const day = await resolveDay(d);
      if (!day || day.kind === 'WORKING') break;
      gap.push(day);
      d = addDays(d, step);
    }
    return { gap, adjacentCode: null as string | null };
  };
  const before = await walk(input.fromDate, -1);
  const after = await walk(input.toDate, 1);
  const adjacent = rules.sandwichAdjacent && rules.sandwichMode !== 'NONE';
  const linkedBefore = adjacent && !!before.adjacentCode && before.gap.length > 0;
  const linkedAfter = adjacent && !!after.adjacentCode && after.gap.length > 0;
  const prefix = linkedBefore ? [...before.gap].reverse() : [];
  const suffix = linkedAfter ? after.gap : [];
  const computed = calculateLeaveDays([...prefix, ...calendar, ...suffix], {
    startHalf: input.startHalf,
    endHalf: input.endHalf,
    sandwich: rules.sandwichMode,
    sandwichMinDays: rules.sandwichMinDays,
    linkedBefore,
    linkedAfter,
    range: { start: prefix.length, end: prefix.length + calendar.length - 1 },
  });
  // Drop linked gap days that were not charged (e.g. holidays under WEEKLY_OFFS mode).
  let lo = 0;
  let hi = computed.breakdown.length - 1;
  while (lo < prefix.length && computed.breakdown[lo]?.days === 0) lo += 1;
  while (hi > prefix.length + calendar.length - 1 && computed.breakdown[hi]?.days === 0) hi -= 1;
  const breakdown = computed.breakdown.slice(lo, hi + 1);
  const days = computed.days;
  const fromDate = breakdown[0]?.date ?? input.fromDate;
  const toDate = breakdown[breakdown.length - 1]?.date ?? input.toDate;

  // Monthly usage of this leave type (pending + approved) for the months touched.
  const months = [...new Set(breakdown.map((d) => d.date.slice(0, 7)))];
  const firstMonth = months[0] ?? fromDate.slice(0, 7);
  const lastMonth = months[months.length - 1] ?? firstMonth;
  const monthly =
    rules.maxRequestsPerMonth != null || rules.maxDaysPerMonth != null
      ? await db.leaveRequest.findMany({
          where: {
            employeeId: employee.id,
            leaveTypeId: type.id,
            status: { in: [...ACTIVE_REQUEST_STATUSES] },
            fromDate: { lte: strToDate(monthEnd(lastMonth)) },
            toDate: { gte: strToDate(`${firstMonth}-01`) },
          },
          select: { fromDate: true, breakdown: true },
        })
      : [];
  const monthUsage = months.map((month) => ({
    month,
    existingRequests: monthly.filter((r) => dateToStr(r.fromDate).startsWith(month)).length,
    existingDays: monthly
      .flatMap((r) => r.breakdown as DayBreakdown)
      .filter((d) => d.date.startsWith(month))
      .reduce((a, d) => a + d.days, 0),
    newDays: breakdown.filter((d) => d.date.startsWith(month)).reduce((a, d) => a + d.days, 0),
  }));

  const today = localToday(await ctx.timezone(first.institutionId));
  const violations = checkRules(rules, {
    typeCode: type.code,
    fromDate,
    today,
    days,
    months: monthUsage,
    adjacentCodes: [before.adjacentCode, after.adjacentCode].filter(
      (c): c is string => !!c && c !== type.code,
    ),
  });
  return {
    type,
    fromDate,
    toDate,
    days,
    breakdown,
    institutionId: first.institutionId,
    coords: { groupId: first.groupId, campusId: first.campusId, departmentId: first.departmentId },
    requiresDocument: type.requiresDocument && days > Number(type.documentAfterDays),
    rules,
    violations,
  };
}

async function assertDatesUnlocked(ctx: AttendanceContext, employeeId: string, dates: string[]) {
  const timeline = await ctx.timeline(employeeId);
  for (const date of dates) {
    const coords = timeline?.at(date);
    if (coords) await ctx.assertUnlocked(coords.institutionId, date);
  }
}

const leaveDates = (r: LeaveRequest) =>
  (r.breakdown as { date: string; days: number }[]).filter((d) => d.days > 0).map((d) => d.date);

async function recompute(r: LeaveRequest, ctx = new AttendanceContext()) {
  await computeAttendance([r.employeeId], dateToStr(r.fromDate), dateToStr(r.toDate), ctx);
}

async function approveLeave(id: string, comment?: string | null) {
  const db = tenantDb();
  const r = await db.leaveRequest.findUnique({ where: { id }, include: { leaveType: true } });
  if (!r || r.status !== 'PENDING_APPROVAL') return;
  const ctx = new AttendanceContext();
  await assertDatesUnlocked(ctx, r.employeeId, leaveDates(r));
  await db.leaveRequest.update({
    where: { id },
    data: { status: 'APPROVED', decidedComment: comment ?? null },
  });
  if (r.leaveType.isPaid) {
    await db.leaveLedgerEntry.create({
      data: withTenant({
        employeeId: r.employeeId,
        leaveTypeId: r.leaveTypeId,
        entryType: 'CONSUMPTION',
        days: -Number(r.days),
        effectiveDate: r.fromDate,
        leaveRequestId: r.id,
        reason: `Leave ${dateToStr(r.fromDate)}..${dateToStr(r.toDate)}`,
      }),
    });
  }
  await recompute(r, ctx);
  await audit.record({
    action: 'leave.approved',
    entityType: 'leave_request',
    entityId: id,
    after: { status: 'APPROVED', days: Number(r.days) },
    reason: comment ?? null,
  });
  const employee = await db.employee.findUnique({ where: { id: r.employeeId } });
  await emit(
    'leave.approved',
    {
      leaveRequestId: id,
      employeeId: r.employeeId,
      leaveTypeId: r.leaveTypeId,
      fromDate: dateToStr(r.fromDate),
      toDate: dateToStr(r.toDate),
      days: Number(r.days),
    },
    { institutionId: r.institutionId },
  );
  await notify('leave.approved', [employee?.userId], {
    title: `Your ${r.leaveType.code} leave was approved`,
    body: `${dateToStr(r.fromDate)} to ${dateToStr(r.toDate)} (${Number(r.days)} day(s))`,
    link: '/me/leave',
    institutionId: r.institutionId,
    data: { leaveRequestId: id },
  });
}

async function closeLeave(
  id: string,
  comment: string | null | undefined,
  status: 'REJECTED' | 'CANCELLED',
) {
  const db = tenantDb();
  const r = await db.leaveRequest.findUnique({ where: { id }, include: { leaveType: true } });
  if (!r || r.status !== 'PENDING_APPROVAL') return;
  await db.leaveRequest.update({
    where: { id },
    data:
      status === 'REJECTED'
        ? { status, decidedComment: comment ?? null }
        : { status, cancelReason: comment ?? null, cancelledAt: new Date() },
  });
  await audit.record({
    action: `leave.${status.toLowerCase()}`,
    entityType: 'leave_request',
    entityId: id,
    before: { status: 'PENDING_APPROVAL' },
    after: { status },
    reason: comment ?? null,
  });
  const key = status === 'REJECTED' ? 'leave.rejected' : 'leave.cancelled';
  await emit(
    key,
    { leaveRequestId: id, employeeId: r.employeeId, leaveTypeId: r.leaveTypeId },
    { institutionId: r.institutionId },
  );
  if (status === 'REJECTED') {
    const employee = await db.employee.findUnique({ where: { id: r.employeeId } });
    await notify('leave.rejected', [employee?.userId], {
      title: `Your ${r.leaveType.code} leave was rejected`,
      body: comment ?? undefined,
      link: '/me/leave',
      institutionId: r.institutionId,
      data: { leaveRequestId: id },
    });
  }
}

export const leaveWorkflowCallbacks = {
  onApproved: (ref: WorkflowInstanceRef) => approveLeave(ref.entityId, ref.comment),
  onRejected: (ref: WorkflowInstanceRef) => closeLeave(ref.entityId, ref.comment, 'REJECTED'),
  onCancelled: (ref: WorkflowInstanceRef) => closeLeave(ref.entityId, ref.comment, 'CANCELLED'),
};

async function reload(id: string) {
  return toLeaveRequestDto(
    await tenantDb().leaveRequest.findUniqueOrThrow({ where: { id }, include: requestInclude }),
  );
}

async function apply(employee: Employee, input: ApplyLeaveInput, onBehalf: boolean) {
  const principal = currentPrincipal();
  assertActionable(employee);
  const ctx = new AttendanceContext();
  const c = await computeRequest(employee, input, ctx);
  if (c.days <= 0) {
    throw new AppError(422, 'NO_LEAVE_DAYS', 'The selected dates contain no working days');
  }
  let ruleOverrideReason: string | null = null;
  const [violation] = c.violations;
  if (violation) {
    if (!input.ruleOverrideReason) {
      throw new AppError(422, violation.code, violation.message, { violations: c.violations });
    }
    // Only HR (leave.manage on the employee) may apply despite policy rule violations.
    await authorize(principal, 'leave.manage', hierarchyResource.employee(employee));
    ruleOverrideReason = input.ruleOverrideReason;
  }
  if (c.requiresDocument && !input.documentId) {
    throw new ValidationError('A supporting document is required', {
      fields: [{ path: 'documentId', message: 'Required for this leave' }],
    });
  }
  const db = tenantDb();
  if (input.documentId) {
    const doc = await db.document.findFirst({
      where: { id: input.documentId },
      select: { id: true },
    });
    if (!doc) throw new InvalidReferenceError('documentId', 'Document');
  }
  const overlap = await db.leaveRequest.findFirst({
    where: {
      employeeId: employee.id,
      status: { in: ['PENDING_APPROVAL', 'APPROVED'] },
      fromDate: { lte: strToDate(c.toDate) },
      toDate: { gte: strToDate(c.fromDate) },
    },
  });
  if (overlap) {
    // Two half days of the same date (first half + second half) may coexist.
    const mine = new Map(c.breakdown.filter((d) => d.days > 0).map((d) => [d.date, d.days]));
    const theirs = (overlap.breakdown as { date: string; days: number }[]).filter(
      (d) => d.days > 0 && mine.has(d.date),
    );
    if (theirs.some((d) => d.days + (mine.get(d.date) ?? 0) > 1)) {
      throw new ConflictError('The request overlaps another leave request', {
        leaveRequestId: overlap.id,
      });
    }
  }
  await assertDatesUnlocked(
    ctx,
    employee.id,
    c.breakdown.filter((d) => d.days > 0).map((d) => d.date),
  );
  if (c.type.isPaid && !c.type.allowNegativeBalance) {
    const [balance] = await computeBalances(employee.id, c.fromDate, c.type.id);
    if (!balance || balance.available < c.days) {
      throw new AppError(422, 'INSUFFICIENT_LEAVE_BALANCE', 'Insufficient leave balance', {
        available: balance?.available ?? 0,
        requested: c.days,
      });
    }
  }
  const r = await db.leaveRequest.create({
    data: withTenant({
      employeeId: employee.id,
      leaveTypeId: c.type.id,
      institutionId: c.institutionId,
      ...c.coords,
      fromDate: strToDate(c.fromDate),
      toDate: strToDate(c.toDate),
      startHalf: input.startHalf,
      endHalf: input.endHalf,
      days: c.days,
      breakdown: c.breakdown as unknown as Prisma.InputJsonValue,
      reason: input.reason,
      documentId: input.documentId ?? null,
      appliedByUserId: principal.userId,
      ruleOverrideReason,
    }),
  });
  await audit.record({
    action: 'leave.apply',
    entityType: 'leave_request',
    entityId: r.id,
    after: {
      employeeId: employee.id,
      leaveTypeId: c.type.id,
      fromDate: c.fromDate,
      toDate: c.toDate,
      days: c.days,
      onBehalf,
    },
    reason: input.reason,
  });
  if (ruleOverrideReason) {
    await audit.record({
      action: 'leave.rules_override',
      entityType: 'leave_request',
      entityId: r.id,
      after: { violations: c.violations, policyId: c.rules.policyId },
      reason: ruleOverrideReason,
    });
  }
  await emit(
    'leave.applied',
    {
      leaveRequestId: r.id,
      employeeId: employee.id,
      leaveTypeId: c.type.id,
      fromDate: c.fromDate,
      toDate: c.toDate,
      days: c.days,
    },
    { institutionId: c.institutionId },
  );
  await notify('leave.applied', [await managerUserId(employee.reportingManagerId)], {
    title: `${employee.displayName} applied for ${c.type.code} leave`,
    body: `${c.fromDate} to ${c.toDate} (${c.days} day(s))`,
    link: '/hr/leave',
    institutionId: c.institutionId,
    data: { leaveRequestId: r.id },
  });
  const instance = await submitWorkflow({
    entityType: LEAVE_WORKFLOW,
    entityId: r.id,
    title: `${c.type.code} leave ${c.fromDate}..${c.toDate}: ${employee.displayName} (${employee.employeeCode})`,
    requesterUserId: employee.userId ?? principal.userId,
    institutionId: c.institutionId,
    groupId: c.coords.groupId,
    departmentId: c.coords.departmentId,
    context: {
      employeeId: employee.id,
      leaveTypeId: c.type.id,
      leaveTypeCode: c.type.code,
      days: c.days,
      fromDate: c.fromDate,
      toDate: c.toDate,
    },
  });
  if (instance) {
    await db.leaveRequest.update({
      where: { id: r.id },
      data: { workflowInstanceId: instance.id },
    });
  } else {
    await approveLeave(r.id);
  }
  return reload(r.id);
}

async function loadRequest(id: string) {
  const r = await tenantDb().leaveRequest.findFirst({
    where: { id },
    include: { leaveType: true, employee: true },
  });
  if (!r) throw new NotFoundError('Leave request');
  return r;
}

export const leaveRequestService = {
  async preview(input: LeavePreviewInput): Promise<LeavePreviewDto> {
    const employee = input.employeeId
      ? await loadEmployeeWith(input.employeeId, 'leave.view', 'leave.view_own')
      : await ownEmployee('leave.view_own');
    const c = await computeRequest(employee, input, new AttendanceContext());
    const [balance] = await computeBalances(employee.id, c.fromDate, c.type.id);
    return {
      employeeId: employee.id,
      leaveTypeId: c.type.id,
      fromDate: c.fromDate,
      toDate: c.toDate,
      days: c.days,
      breakdown: c.breakdown,
      balance: balance ?? null,
      requiresDocument: c.requiresDocument,
      rules: { ...c.rules, hints: describeRules(c.rules, c.type.code) },
      violations: c.violations,
    };
  },

  async applyOwn(input: ApplyLeaveInput) {
    return apply(await ownEmployee('leave.apply_own'), input, false);
  },

  async applyFor(input: ApplyLeaveInput & { employeeId: string }) {
    const employee = await loadEmployeeWith(input.employeeId, 'leave.apply');
    await authorize(currentPrincipal(), 'leave.apply', hierarchyResource.employee(employee));
    const { employeeId: _ignored, ...rest } = input;
    return apply(employee, rest, true);
  },

  async get(id: string) {
    const r = await loadRequest(id);
    const principal = currentPrincipal();
    const own = !!principal.userId && r.employee.userId === principal.userId;
    const visible =
      (own && hasPermission(principal, 'leave.view_own')) ||
      (await can(principal, 'leave.view', {
        groupId: r.groupId,
        institutionId: r.institutionId,
        campusId: r.campusId,
        departmentId: r.departmentId,
      }));
    if (!visible) throw new NotFoundError('Leave request');
    return reload(id);
  },

  async list(query: ListLeaveRequestsQuery) {
    const where = andScope<Prisma.LeaveRequestWhereInput>(
      {
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(query.institutionId ? { institutionId: query.institutionId } : {}),
        ...(query.leaveTypeId ? { leaveTypeId: query.leaveTypeId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.to ? { fromDate: { lte: strToDate(query.to) } } : {}),
        ...(query.from ? { toDate: { gte: strToDate(query.from) } } : {}),
      },
      await scopeWhere(currentPrincipal(), 'leave.view', 'employee'),
    );
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.leaveRequest.findMany({
        where,
        include: requestInclude,
        orderBy: [{ fromDate: 'desc' }, { createdAt: 'desc' }],
        ...toPageWindow(query),
      }),
      db.leaveRequest.count({ where }),
    ]);
    return { items: rows.map(toLeaveRequestDto), total };
  },

  async mine() {
    const employee = await ownEmployee('leave.view_own');
    const rows = await tenantDb().leaveRequest.findMany({
      where: { employeeId: employee.id },
      include: requestInclude,
      orderBy: [{ fromDate: 'desc' }],
      take: 200,
    });
    return rows.map(toLeaveRequestDto);
  },

  async myBalances(asOf?: string) {
    const employee = await ownEmployee('leave.view_own');
    return computeBalances(employee.id, asOf ?? dateToStr(new Date()));
  },

  /**
   * Withdraw a pending request or cancel an approved one. The employee may cancel their own
   * (approved only before it starts); HR with `leave.manage` on the employee may cancel any.
   * Approved cancellation posts a REVERSAL entry and recomputes attendance; locked dates → 409.
   */
  async cancel(id: string, reason: string) {
    const principal = currentPrincipal();
    const r = await loadRequest(id);
    const own = !!principal.userId && r.employee.userId === principal.userId;
    const hr = await can(principal, 'leave.manage', hierarchyResource.employee(r.employee));
    if (!hr && !(own && hasPermission(principal, 'leave.apply_own'))) {
      if (!(await can(principal, 'leave.view', hierarchyResource.employee(r.employee)))) {
        throw new NotFoundError('Leave request');
      }
      await authorize(principal, 'leave.manage', hierarchyResource.employee(r.employee));
    }
    const db = tenantDb();
    if (r.status === 'PENDING_APPROVAL') {
      const instance = r.workflowInstanceId
        ? await db.workflowInstance.findFirst({ where: { id: r.workflowInstanceId } })
        : null;
      if (instance && (instance.status === 'PENDING' || instance.status === 'SENT_BACK')) {
        await cancelWorkflow(instance, reason);
      }
      await closeLeave(r.id, reason, 'CANCELLED');
      return reload(r.id);
    }
    if (r.status !== 'APPROVED') {
      throw new AppError(409, 'INVALID_STATE', `Request is ${r.status.toLowerCase()}`);
    }
    const ctx = new AttendanceContext();
    const timeline = await ctx.timeline(r.employeeId);
    const tz = await ctx.timezone(
      timeline?.at(dateToStr(r.fromDate))?.institutionId ?? r.institutionId,
    );
    if (!hr && dateToStr(r.fromDate) <= localToday(tz)) {
      throw new AppError(
        409,
        'LEAVE_STARTED',
        'Leave that has started can only be cancelled by HR',
      );
    }
    await assertDatesUnlocked(ctx, r.employeeId, leaveDates(r));
    await db.leaveRequest.update({
      where: { id: r.id },
      data: { status: 'CANCELLED', cancelReason: reason, cancelledAt: new Date() },
    });
    if (r.leaveType.isPaid) {
      await db.leaveLedgerEntry.create({
        data: withTenant({
          employeeId: r.employeeId,
          leaveTypeId: r.leaveTypeId,
          entryType: 'REVERSAL',
          days: Number(r.days),
          effectiveDate: r.fromDate,
          leaveRequestId: r.id,
          reason: `Cancelled: ${reason}`,
          createdByUserId: principal.userId,
        }),
      });
    }
    await recompute(r, ctx);
    await audit.record({
      action: 'leave.cancelled',
      entityType: 'leave_request',
      entityId: r.id,
      before: { status: 'APPROVED' },
      after: { status: 'CANCELLED', reversedDays: r.leaveType.isPaid ? Number(r.days) : 0 },
      reason,
    });
    await emit(
      'leave.cancelled',
      { leaveRequestId: r.id, employeeId: r.employeeId, leaveTypeId: r.leaveTypeId },
      { institutionId: r.institutionId },
    );
    if (!own) {
      await notify('leave.cancelled', [r.employee.userId], {
        title: `Your ${r.leaveType.code} leave was cancelled`,
        body: reason,
        link: '/me/leave',
        institutionId: r.institutionId,
        data: { leaveRequestId: r.id },
      });
    }
    return reload(r.id);
  },
};
