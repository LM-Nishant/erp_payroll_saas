import type {
  CreateShiftAssignmentInput,
  CreateShiftInput,
  ListShiftAssignmentsQuery,
  ListShiftsQuery,
  ResolvedShiftDto,
  ShiftAssignmentDto,
  ShiftDto,
  UpdateShiftInput,
} from '@erp/shared';
import type { Prisma, Shift, ShiftAssignment } from '@prisma/client';
import { audit } from '../../core/audit';
import {
  andScope,
  authorize,
  can,
  currentPrincipal,
  hierarchyResource,
  scopeWhere,
} from '../../core/authz';
import { DbNull } from '../../core/db/helpers';
import {
  ConflictError,
  InvalidReferenceError,
  NotFoundError,
  ValidationError,
} from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { tenantDb, withTenant } from '../../core/tenancy';
import {
  institutionResource,
  institutionWhere,
  loadEmployeeWith,
} from '../attendance/attendance.access';
import { shiftCrossesMidnight } from '../attendance/attendance.engine';
import { AttendanceContext } from '../attendance/attendance.context';
import { dateToStr, strToDate } from '../attendance/time';
import { shiftWeeklyOffs } from './shifts.resolver';

/* Shifts and effective-dated shift assignments (Layer 7). Resolution: shifts.resolver.ts. */

export const toShiftDto = (s: Shift): ShiftDto => ({
  id: s.id,
  institutionId: s.institutionId,
  code: s.code,
  name: s.name,
  startMinute: s.startMinute,
  endMinute: s.endMinute,
  crossesMidnight: s.crossesMidnight,
  graceInMinutes: s.graceInMinutes,
  graceOutMinutes: s.graceOutMinutes,
  breakMinutes: s.breakMinutes,
  halfDayMinutes: s.halfDayMinutes,
  fullDayMinutes: s.fullDayMinutes,
  overtimeAfterMinutes: s.overtimeAfterMinutes,
  weeklyOffs: shiftWeeklyOffs(s),
  isDefault: s.isDefault,
  status: s.status,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

type EmployeeLabel = { employeeCode: string; displayName: string } | null;

export const toAssignmentDto = (
  a: ShiftAssignment & { employee?: EmployeeLabel },
): ShiftAssignmentDto => ({
  id: a.id,
  institutionId: a.institutionId,
  employeeId: a.employeeId,
  ...(a.employee
    ? { employeeCode: a.employee.employeeCode, employeeName: a.employee.displayName }
    : {}),
  departmentId: a.departmentId,
  shiftId: a.shiftId,
  rotationShiftIds: Array.isArray(a.rotationShiftIds) ? (a.rotationShiftIds as string[]) : null,
  rotationDays: a.rotationDays,
  effectiveFrom: dateToStr(a.effectiveFrom),
  effectiveTo: a.effectiveTo ? dateToStr(a.effectiveTo) : null,
  createdAt: a.createdAt.toISOString(),
});

const shiftAudit = (s: Shift) => {
  const { createdAt: _c, updatedAt: _u, organizationId: _o, ...rest } = s;
  return rest;
};

async function loadShift(id: string, permission = 'shift.view'): Promise<Shift> {
  const s = await tenantDb().shift.findFirst({ where: { id } });
  if (
    !s ||
    !(await can(currentPrincipal(), 'shift.view', await institutionResource(s.institutionId)))
  ) {
    throw new NotFoundError('Shift');
  }
  if (permission !== 'shift.view') {
    await authorize(currentPrincipal(), permission, await institutionResource(s.institutionId));
  }
  return s;
}

/** Only one default shift per institution. */
async function clearOtherDefaults(institutionId: string, keepId: string) {
  await tenantDb().shift.updateMany({
    where: { institutionId, isDefault: true, id: { not: keepId } },
    data: { isDefault: false },
  });
}

export const shiftService = {
  async list(query: ListShiftsQuery) {
    const where = andScope<Prisma.ShiftWhereInput>(
      query.institutionId ? { institutionId: query.institutionId } : {},
      await institutionWhere('shift.view'),
    );
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.shift.findMany({
        where,
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        ...toPageWindow(query),
      }),
      db.shift.count({ where }),
    ]);
    return { items: rows.map(toShiftDto), total };
  },

  async get(id: string) {
    return toShiftDto(await loadShift(id));
  },

  async create(input: CreateShiftInput) {
    await authorize(
      currentPrincipal(),
      'shift.manage',
      await institutionResource(input.institutionId),
    );
    const db = tenantDb();
    if (
      await db.shift.findFirst({ where: { institutionId: input.institutionId, code: input.code } })
    ) {
      throw new ConflictError('Shift code already exists in this institution', { field: 'code' });
    }
    const s = await db.shift.create({
      data: withTenant({
        ...input,
        crossesMidnight: shiftCrossesMidnight(input.startMinute, input.endMinute),
        weeklyOffs: input.weeklyOffs ? (input.weeklyOffs as Prisma.InputJsonValue) : DbNull,
      }),
    });
    if (s.isDefault) await clearOtherDefaults(s.institutionId, s.id);
    await audit.record({
      action: 'shift.create',
      entityType: 'shift',
      entityId: s.id,
      after: shiftAudit(s),
    });
    return toShiftDto(s);
  },

  async update(id: string, input: UpdateShiftInput) {
    const before = await loadShift(id, 'shift.manage');
    const start = input.startMinute ?? before.startMinute;
    const end = input.endMinute ?? before.endMinute;
    const half = input.halfDayMinutes ?? before.halfDayMinutes;
    const full = input.fullDayMinutes ?? before.fullDayMinutes;
    if (start === end) {
      throw new ValidationError('Start and end must differ', {
        fields: [{ path: 'endMinute', message: 'Start and end must differ' }],
      });
    }
    if (half > full) {
      throw new ValidationError('Half-day minutes must not exceed full-day minutes', {
        fields: [{ path: 'halfDayMinutes', message: 'Must not exceed full-day minutes' }],
      });
    }
    const { weeklyOffs, ...rest } = input;
    const after = await tenantDb().shift.update({
      where: { id },
      data: {
        ...rest,
        crossesMidnight: shiftCrossesMidnight(start, end),
        ...(weeklyOffs !== undefined
          ? { weeklyOffs: weeklyOffs ? (weeklyOffs as Prisma.InputJsonValue) : DbNull }
          : {}),
      },
    });
    if (after.isDefault) await clearOtherDefaults(after.institutionId, after.id);
    await audit.record({
      action: 'shift.update',
      entityType: 'shift',
      entityId: id,
      before: shiftAudit(before),
      after: shiftAudit(after),
    });
    return toShiftDto(after);
  },

  async remove(id: string) {
    const before = await loadShift(id, 'shift.manage');
    const db = tenantDb();
    const used =
      (await db.shiftAssignment.count({ where: { shiftId: id } })) +
      (await db.attendanceRecord.count({ where: { shiftId: id } }));
    if (used > 0) {
      throw new ConflictError('Shift is in use; mark it inactive instead', { references: used });
    }
    await db.shift.delete({ where: { id } });
    await audit.record({
      action: 'shift.delete',
      entityType: 'shift',
      entityId: id,
      before: shiftAudit(before),
    });
  },

  /* ---- assignments ---- */

  async listAssignments(query: ListShiftAssignmentsQuery) {
    const where = andScope<Prisma.ShiftAssignmentWhereInput>(
      {
        ...(query.institutionId ? { institutionId: query.institutionId } : {}),
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      },
      await scopeWhere(currentPrincipal(), 'shift.view', 'program'),
    );
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.shiftAssignment.findMany({
        where,
        include: { employee: { select: { employeeCode: true, displayName: true } } },
        orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
        ...toPageWindow(query),
      }),
      db.shiftAssignment.count({ where }),
    ]);
    return { items: rows.map(toAssignmentDto), total };
  },

  async createAssignment(input: CreateShiftAssignmentInput) {
    const principal = currentPrincipal();
    const db = tenantDb();
    let institutionId: string;
    if (input.employeeId) {
      const e = await loadEmployeeWith(input.employeeId, 'shift.manage');
      await authorize(principal, 'shift.manage', hierarchyResource.employee(e));
      institutionId = e.institutionId;
    } else {
      const d = await db.department.findFirst({
        where: { id: input.departmentId as string },
        select: { id: true, institutionId: true, campusId: true },
      });
      if (!d) throw new InvalidReferenceError('departmentId', 'Department');
      await authorize(principal, 'shift.manage', hierarchyResource.department(d));
      institutionId = d.institutionId;
    }
    const shiftIds = [input.shiftId, ...(input.rotationShiftIds ?? [])];
    const shifts = await db.shift.findMany({ where: { id: { in: shiftIds } } });
    for (const id of shiftIds) {
      const s = shifts.find((x) => x.id === id);
      if (!s || s.institutionId !== institutionId) {
        throw new InvalidReferenceError(
          id === input.shiftId ? 'shiftId' : 'rotationShiftIds',
          'Shift',
        );
      }
    }
    // Close the open-ended assignment of the same target the day before the new one starts.
    const target = input.employeeId
      ? { employeeId: input.employeeId }
      : { departmentId: input.departmentId as string };
    const from = strToDate(input.effectiveFrom);
    const overlapping = await db.shiftAssignment.findMany({
      where: {
        ...target,
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
      },
    });
    for (const o of overlapping) {
      if (o.effectiveFrom >= from) {
        throw new ConflictError('An assignment already starts on or after this date', {
          assignmentId: o.id,
        });
      }
      await db.shiftAssignment.update({
        where: { id: o.id },
        data: { effectiveTo: new Date(from.getTime() - 86_400_000) },
      });
    }
    const a = await db.shiftAssignment.create({
      data: withTenant({
        institutionId,
        employeeId: input.employeeId ?? null,
        departmentId: input.departmentId ?? null,
        shiftId: input.shiftId,
        rotationShiftIds: input.rotationShiftIds
          ? (input.rotationShiftIds as Prisma.InputJsonValue)
          : DbNull,
        rotationDays: input.rotationDays ?? null,
        effectiveFrom: from,
        effectiveTo: input.effectiveTo ? strToDate(input.effectiveTo) : null,
        createdByUserId: principal.userId,
      }),
    });
    await audit.record({
      action: 'shift_assignment.create',
      entityType: 'shift_assignment',
      entityId: a.id,
      after: toAssignmentDto(a),
      metadata: { closed: overlapping.map((o) => o.id) },
    });
    return toAssignmentDto(a);
  },

  async removeAssignment(id: string) {
    const a = await tenantDb().shiftAssignment.findFirst({ where: { id } });
    if (!a) throw new NotFoundError('Shift assignment');
    await authorize(currentPrincipal(), 'shift.manage', await institutionResource(a.institutionId));
    await tenantDb().shiftAssignment.delete({ where: { id } });
    await audit.record({
      action: 'shift_assignment.delete',
      entityType: 'shift_assignment',
      entityId: id,
      before: toAssignmentDto(a),
    });
  },

  async resolve(employeeId: string, date: string): Promise<ResolvedShiftDto> {
    await loadEmployeeWith(employeeId, 'shift.view', 'attendance.view_own');
    const ctx = new AttendanceContext();
    const coords = (await ctx.timeline(employeeId))?.at(date) ?? null;
    const r = await ctx.shifts.resolve(employeeId, coords, date);
    return {
      employeeId,
      date,
      institutionId: coords?.institutionId ?? null,
      source: r.source,
      assignmentId: r.assignmentId,
      shift: r.shift ? toShiftDto(r.shift) : null,
    };
  },
};
