import {
  importPunchSchema,
  type ImportPunchesInput,
  type ListAttendanceQuery,
  type LockAttendancePeriodInput,
  type OverrideAttendanceInput,
  type RecomputeAttendanceInput,
  type SelfPunchInput,
  type UpsertAttendancePolicyInput,
  type MyAttendanceDto,
} from '@erp/shared';
import type { Employee, Prisma } from '@prisma/client';
import { audit } from '../../core/audit';
import {
  andScope,
  authorize,
  can,
  currentPrincipal,
  hierarchyResource,
  scopeWhere,
} from '../../core/authz';
import { isUniqueViolation } from '../../core/db/helpers';
import { emit } from '../../core/events';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { tenantDb, withTenant } from '../../core/tenancy';
import { parseCsv } from '../employees/employees.import';
import { faceDistance, storedDescriptor } from '../employees/employees.photo';
import { resolveDaysForEmployee } from '../holidays/holidays.service';
import {
  assertActionable,
  institutionResource,
  institutionWhere,
  loadEmployeeWith,
  ownEmployee,
} from './attendance.access';
import { issueLivenessChallenge, verifyLivenessProof } from './attendance.liveness';
import {
  computeAttendance,
  COMPUTABLE_STATUSES,
  employeeIdsInInstitution,
} from './attendance.compute';
import { AttendanceContext, policyDto } from './attendance.context';
import { attributePunchDate } from './attendance.engine';
import { toImportDto, toLockDto, toPunchDto, toRecordDto } from './attendance.mappers';
import { addDays, dateToStr, isValidTimeZone, localParts, localToday, strToDate } from './time';

/*
 * Attendance (Layer 7): raw punches (self-service web / mobile, biometric CSV, integration API),
 * computed daily records, HR overrides, recomputation, period locks and the per-institution
 * attendance policy. Records are scoped by their as-of coordinates (`scopeWhere(..., 'employee')`).
 */

type Geo = {
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
  deviceId?: string | null;
};

/**
 * Attribute an instant to its shift day (cross-midnight shifts keep early-morning punches on
 * the previous day) using the institution time zone of the employee's as-of assignment.
 */
export async function punchDay(
  ctx: AttendanceContext,
  employee: Employee,
  instant: Date,
): Promise<{ date: string; institutionId: string } | null> {
  const timeline = await ctx.timeline(employee.id);
  if (!timeline) return null;
  const guess = localParts(instant, await ctx.timezone(employee.institutionId));
  const coords = timeline.at(guess.date) ?? timeline.at(addDays(guess.date, -1));
  if (!coords) return null;
  const local = localParts(instant, await ctx.timezone(coords.institutionId));
  let date = local.date;
  const prevDate = addDays(local.date, -1);
  const prevCoords = timeline.at(prevDate);
  if (prevCoords) {
    const prev = await ctx.shifts.resolve(employee.id, prevCoords, prevDate);
    if (prev.shift && attributePunchDate(local.minute, prev.shift) === 'PREVIOUS_DAY') {
      date = prevDate;
    }
  }
  const final = timeline.at(date);
  return final ? { date, institutionId: final.institutionId } : null;
}

/** Max euclidean distance (face-api.js descriptors) accepted as the same person. */
export const FACE_MATCH_THRESHOLD = 0.5;

/**
 * Selfie punch check: the browser runs a server-issued liveness challenge (blink + head turn in
 * random order) and sends only face descriptors; the server checks the signed challenge and that
 * every frame matches the descriptor stored from the profile photo. Selfie images are never
 * uploaded or stored — only the match distance is kept on the punch. Descriptors are computed
 * client-side, so this deters proxy punching with photos or recordings rather than proving
 * identity cryptographically.
 */
async function verifySelfie(
  employee: Employee,
  descriptor: number[] | undefined,
  liveness: SelfPunchInput['liveness'],
) {
  const stored = storedDescriptor(employee);
  if (!stored) {
    throw new AppError(
      409,
      'PROFILE_PHOTO_REQUIRED',
      'Upload a clear profile photo before punching with a selfie',
    );
  }
  if (!descriptor) {
    throw new AppError(400, 'SELFIE_REQUIRED', 'A selfie is required to punch');
  }
  if (!liveness) {
    throw new AppError(
      400,
      'LIVENESS_REQUIRED',
      'Complete the blink and head-turn check before punching',
    );
  }
  const distance = Math.round(faceDistance(stored, descriptor) * 10_000) / 10_000;
  const mismatch = async (d: number) => {
    await audit.record({
      action: 'attendance.face_mismatch',
      entityType: 'employee',
      entityId: employee.id,
      metadata: { distance: d },
    });
    throw new AppError(422, 'FACE_MISMATCH', 'The selfie does not match your profile photo', {
      distance: d,
      threshold: FACE_MATCH_THRESHOLD,
    });
  };
  if (distance > FACE_MATCH_THRESHOLD) await mismatch(distance);
  let live;
  try {
    live = verifyLivenessProof(liveness, employee.id, stored, FACE_MATCH_THRESHOLD);
  } catch (e) {
    if (e instanceof AppError && e.code === 'FACE_MISMATCH') {
      await mismatch((e.details as { distance: number }).distance);
    }
    if (e instanceof AppError) {
      await audit.record({
        action: 'attendance.liveness_failed',
        entityType: 'employee',
        entityId: employee.id,
        metadata: { reason: e.message },
      });
    }
    throw e;
  }
  return { distance, livenessSteps: live.steps };
}

async function insertPunch(
  employee: Employee,
  instant: Date,
  date: string,
  data: {
    source: 'WEB' | 'MOBILE' | 'BIOMETRIC' | 'API' | 'MANUAL';
    direction: 'IN' | 'OUT' | 'UNKNOWN';
    importJobId?: string | null;
    selfieDocumentId?: string | null;
    faceDistance?: number | null;
  } & Geo,
) {
  try {
    return await tenantDb().attendancePunch.create({
      data: withTenant({
        employeeId: employee.id,
        punchedAt: instant,
        attendanceDate: strToDate(date),
        direction: data.direction,
        source: data.source,
        deviceId: data.deviceId ?? null,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        accuracyMeters: data.accuracyMeters ?? null,
        importJobId: data.importJobId ?? null,
        selfieDocumentId: data.selfieDocumentId ?? null,
        faceDistance: data.faceDistance ?? null,
        createdByUserId: currentPrincipal().userId,
      }),
    });
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

/** Insert a MANUAL punch (approved regularization) at local `minute` of `date`. */
export async function insertManualPunch(
  employee: Employee,
  date: string,
  instant: Date,
  direction: 'IN' | 'OUT',
) {
  return insertPunch(employee, instant, date, { source: 'MANUAL', direction });
}

interface ImportRow {
  row: number;
  value: unknown;
}

async function importRows(rows: ImportRow[], source: 'BIOMETRIC' | 'API', fileName: string | null) {
  const principal = currentPrincipal();
  const db = tenantDb();
  const job = await db.attendanceImportJob.create({
    data: withTenant({
      source,
      fileName,
      status: 'PROCESSING',
      totalRows: rows.length,
      requestedByUserId: principal.userId,
    }),
  });
  const ctx = new AttendanceContext();
  const errors: { row: number; message: string }[] = [];
  let imported = 0;
  let duplicates = 0;
  const byCode = new Map<string, Employee | null>();
  const allowed = new Map<string, boolean>();
  const touched = new Map<string, { employee: Employee; from: string; to: string }>();
  for (const { row, value } of rows) {
    const parsed = importPunchSchema.safeParse(value);
    if (!parsed.success) {
      errors.push({ row, message: parsed.error.issues.map((i) => i.message).join('; ') });
      continue;
    }
    const p = parsed.data;
    const key = p.employeeId ? `id:${p.employeeId}` : `code:${p.employeeCode}`;
    if (!byCode.has(key)) {
      byCode.set(
        key,
        await db.employee.findFirst({
          where: p.employeeId ? { id: p.employeeId } : { employeeCode: p.employeeCode as string },
        }),
      );
    }
    const employee = byCode.get(key);
    if (!employee) {
      errors.push({ row, message: 'Employee not found' });
      continue;
    }
    if (!allowed.has(employee.id)) {
      allowed.set(
        employee.id,
        await can(principal, 'attendance.import', hierarchyResource.employee(employee)),
      );
    }
    if (!allowed.get(employee.id)) {
      errors.push({ row, message: 'Employee is outside your scope' });
      continue;
    }
    const instant = new Date(p.punchedAt);
    const day = await punchDay(ctx, employee, instant);
    if (!day) {
      errors.push({ row, message: 'Employee has no assignment on the punch date' });
      continue;
    }
    if (await ctx.lockFor(day.institutionId, day.date)) {
      errors.push({ row, message: `Attendance for ${day.date} is locked` });
      continue;
    }
    const created = await insertPunch(employee, instant, day.date, {
      source,
      direction: p.direction,
      importJobId: job.id,
      latitude: p.latitude,
      longitude: p.longitude,
      accuracyMeters: p.accuracyMeters,
      deviceId: p.deviceId,
    });
    if (!created) {
      duplicates += 1;
      continue;
    }
    imported += 1;
    const t = touched.get(employee.id);
    touched.set(employee.id, {
      employee,
      from: t && t.from < day.date ? t.from : day.date,
      to: t && t.to > day.date ? t.to : day.date,
    });
  }
  for (const t of touched.values()) {
    await computeAttendance([t.employee.id], t.from, t.to, ctx);
  }
  const done = await db.attendanceImportJob.update({
    where: { id: job.id },
    data: {
      status: 'COMPLETED',
      importedRows: imported,
      duplicateRows: duplicates,
      failedRows: errors.length,
      errors: errors.slice(0, 500) as Prisma.InputJsonValue,
    },
  });
  await audit.record({
    action: 'attendance.import',
    entityType: 'attendance_import',
    entityId: job.id,
    after: { source, fileName, total: rows.length, imported, duplicates, failed: errors.length },
  });
  return toImportDto(done);
}

/** Ensure `date` is not in the future for the employee's as-of institution. */
/** Record DTO with its lock state and whether it is today's still-incomplete day. */
async function recordDto(r: Parameters<typeof toRecordDto>[0], ctx: AttendanceContext) {
  const date = dateToStr(r.date);
  return toRecordDto(
    r,
    !!(await ctx.lockFor(r.institutionId, date)),
    localToday(await ctx.timezone(r.institutionId)),
  );
}

async function assertNotFuture(ctx: AttendanceContext, institutionId: string, date: string) {
  if (date > localToday(await ctx.timezone(institutionId))) {
    throw new ValidationError('Date must not be in the future', {
      fields: [{ path: 'date', message: 'Must not be in the future' }],
    });
  }
}

export const attendanceService = {
  /* ---- punches ---- */

  /** Starts a selfie liveness check for the caller (only meaningful when face match is on). */
  async livenessChallenge() {
    const employee = await ownEmployee('attendance.punch_own');
    assertActionable(employee);
    return issueLivenessChallenge(employee.id);
  },

  async selfPunch(input: SelfPunchInput) {
    const employee = await ownEmployee('attendance.punch_own');
    assertActionable(employee);
    const ctx = new AttendanceContext();
    const instant = new Date();
    const day = await punchDay(ctx, employee, instant);
    if (!day) throw new AppError(409, 'NO_ASSIGNMENT', 'You have no active assignment today');
    const policy = await ctx.policy(day.institutionId);
    if (
      (input.source === 'WEB' && !policy.allowWebPunch) ||
      (input.source === 'MOBILE' && !policy.allowMobilePunch)
    ) {
      throw new ForbiddenError(`${input.source} punches are disabled`, 'PUNCH_SOURCE_DISABLED');
    }
    await ctx.assertUnlocked(day.institutionId, day.date);
    const face = policy.requireFaceMatch
      ? await verifySelfie(employee, input.faceDescriptor, input.liveness)
      : null;
    const punch = await insertPunch(employee, instant, day.date, {
      ...input,
      faceDistance: face?.distance ?? null,
    });
    if (!punch) throw new ConflictError('Punch already recorded');
    await computeAttendance([employee.id], day.date, day.date, ctx);
    await audit.record({
      action: 'attendance.punch',
      entityType: 'employee',
      entityId: employee.id,
      after: {
        punchedAt: instant.toISOString(),
        date: day.date,
        source: input.source,
        ...(face ? { faceDistance: face.distance, liveness: face.livenessSteps } : {}),
      },
    });
    const record = await tenantDb().attendanceRecord.findFirst({
      where: { employeeId: employee.id, date: strToDate(day.date) },
    });
    return {
      punch: toPunchDto(punch),
      record: record ? await recordDto(record, new AttendanceContext()) : null,
    };
  },

  async importJson(input: ImportPunchesInput) {
    return importRows(
      input.punches.map((value, i) => ({ row: i + 1, value })),
      input.source,
      null,
    );
  },

  /** Biometric CSV: columns employeeCode, punchedAt (ISO with offset), direction, deviceId. */
  async importCsv(file: { fileName: string; body: Buffer }) {
    const table = parseCsv(file.body.toString('utf8')).filter((r) => r.some((c) => c.trim()));
    if (table.length < 2) throw new ValidationError('The file has no data rows');
    const header = (table[0] ?? []).map((h) => h.trim());
    if (!header.includes('employeeCode') || !header.includes('punchedAt')) {
      throw new ValidationError('CSV must have employeeCode and punchedAt columns');
    }
    if (table.length - 1 > 5000) throw new ValidationError('At most 5000 rows per import');
    const rows = table.slice(1).map((cells, i) => {
      const obj: Record<string, unknown> = {};
      header.forEach((h, idx) => {
        const v = (cells[idx] ?? '').trim();
        if (v && ['employeeCode', 'punchedAt', 'direction', 'deviceId'].includes(h)) {
          obj[h] = h === 'direction' ? v.toUpperCase() : v;
        }
      });
      return { row: i + 2, value: obj };
    });
    return importRows(rows, 'BIOMETRIC', file.fileName);
  },

  async listImports() {
    const rows = await tenantDb().attendanceImportJob.findMany({
      where: { requestedByUserId: currentPrincipal().userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map(toImportDto);
  },

  async listPunches(employeeId: string, from: string, to: string) {
    await loadEmployeeWith(employeeId, 'attendance.view', 'attendance.view_own');
    const rows = await tenantDb().attendancePunch.findMany({
      where: { employeeId, attendanceDate: { gte: strToDate(from), lte: strToDate(to) } },
      orderBy: { punchedAt: 'asc' },
      take: 2000,
    });
    return rows.map(toPunchDto);
  },

  /* ---- records ---- */

  async list(query: ListAttendanceQuery) {
    const where = andScope<Prisma.AttendanceRecordWhereInput>(
      {
        date: { gte: strToDate(query.from), lte: strToDate(query.to) },
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(query.institutionId ? { institutionId: query.institutionId } : {}),
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      await scopeWhere(currentPrincipal(), 'attendance.view', 'employee'),
    );
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.attendanceRecord.findMany({
        where,
        include: { employee: { select: { employeeCode: true, displayName: true } } },
        orderBy: [{ date: 'asc' }, { employeeId: 'asc' }],
        ...toPageWindow(query),
      }),
      db.attendanceRecord.count({ where }),
    ]);
    const ctx = new AttendanceContext();
    const items = [];
    for (const r of rows) {
      items.push(await recordDto(r, ctx));
    }
    return { items, total };
  },

  async recompute(input: RecomputeAttendanceInput) {
    const principal = currentPrincipal();
    let ids: string[];
    if (input.employeeId) {
      const e = await loadEmployeeWith(input.employeeId, 'attendance.manage');
      await authorize(principal, 'attendance.manage', hierarchyResource.employee(e));
      ids = [e.id];
    } else if (input.institutionId) {
      await authorize(
        principal,
        'attendance.manage',
        await institutionResource(input.institutionId),
      );
      ids = await employeeIdsInInstitution(input.institutionId, input.from, input.to);
    } else {
      const rows = await tenantDb().employee.findMany({
        where: andScope<Prisma.EmployeeWhereInput>(
          { status: { in: [...COMPUTABLE_STATUSES] } },
          await scopeWhere(principal, 'attendance.manage', 'employee'),
        ),
        select: { id: true },
      });
      ids = rows.map((r) => r.id);
    }
    const result = await computeAttendance(ids, input.from, input.to);
    await audit.record({
      action: 'attendance.recompute',
      entityType: 'attendance',
      entityId: input.employeeId ?? input.institutionId ?? 'scope',
      after: { from: input.from, to: input.to, employees: ids.length, ...result },
    });
    return { employees: ids.length, ...result };
  },

  /** HR correction of one day (status forced; null clears). Blocked inside locked periods. */
  async override(input: OverrideAttendanceInput) {
    const employee = await loadEmployeeWith(input.employeeId, 'attendance.manage');
    await authorize(currentPrincipal(), 'attendance.manage', hierarchyResource.employee(employee));
    const ctx = new AttendanceContext();
    const timeline = await ctx.timeline(employee.id);
    const coords = timeline?.at(input.date);
    if (!coords || !timeline?.employedOn(input.date)) {
      throw new AppError(409, 'NO_ASSIGNMENT', 'Employee was not employed on this date');
    }
    await assertNotFuture(ctx, coords.institutionId, input.date);
    await ctx.assertUnlocked(coords.institutionId, input.date);
    await computeAttendance([employee.id], input.date, input.date, ctx);
    const db = tenantDb();
    const before = await db.attendanceRecord.findFirst({
      where: { employeeId: employee.id, date: strToDate(input.date) },
    });
    if (!before) throw new NotFoundError('Attendance record');
    await db.attendanceRecord.update({
      where: { id: before.id },
      data: { overrideStatus: input.status, overrideReason: input.status ? input.reason : null },
    });
    await computeAttendance([employee.id], input.date, input.date, ctx);
    const after = await db.attendanceRecord.findUniqueOrThrow({ where: { id: before.id } });
    await audit.record({
      action: 'attendance.override',
      entityType: 'employee',
      entityId: employee.id,
      before: { date: input.date, status: before.status, overrideStatus: before.overrideStatus },
      after: { date: input.date, status: after.status, overrideStatus: after.overrideStatus },
      reason: input.reason,
    });
    return toRecordDto(after);
  },

  /* ---- period locks ---- */

  async listLocks(query: { institutionId?: string; page: number; pageSize: number }) {
    const where = andScope<Prisma.AttendancePeriodLockWhereInput>(
      query.institutionId ? { institutionId: query.institutionId } : {},
      await institutionWhere('attendance.view'),
    );
    const [rows, total] = await Promise.all([
      tenantDb().attendancePeriodLock.findMany({
        where,
        orderBy: [{ periodStart: 'desc' }, { id: 'asc' }],
        ...toPageWindow(query),
      }),
      tenantDb().attendancePeriodLock.count({ where }),
    ]);
    return { items: rows.map(toLockDto), total };
  },

  /**
   * Lock [periodStart, periodEnd] for an institution: recompute it once more, then freeze. Locked
   * days are skipped by recomputation, and punches / overrides / regularizations / leave
   * decisions touching them fail with 409 PERIOD_LOCKED until unlocked (`attendance.unlock`).
   */
  async lock(input: LockAttendancePeriodInput) {
    const principal = currentPrincipal();
    await authorize(principal, 'attendance.lock', await institutionResource(input.institutionId));
    const db = tenantDb();
    const overlap = await db.attendancePeriodLock.findFirst({
      where: {
        institutionId: input.institutionId,
        status: 'LOCKED',
        periodStart: { lte: strToDate(input.periodEnd) },
        periodEnd: { gte: strToDate(input.periodStart) },
      },
    });
    if (overlap) {
      throw new ConflictError('The period overlaps an existing lock', { lockId: overlap.id });
    }
    const ids = await employeeIdsInInstitution(
      input.institutionId,
      input.periodStart,
      input.periodEnd,
    );
    await computeAttendance(ids, input.periodStart, input.periodEnd);
    const lock = await db.attendancePeriodLock.create({
      data: withTenant({
        institutionId: input.institutionId,
        periodStart: strToDate(input.periodStart),
        periodEnd: strToDate(input.periodEnd),
        reason: input.reason ?? null,
        lockedByUserId: principal.userId,
      }),
    });
    await audit.record({
      action: 'attendance.period_lock',
      entityType: 'attendance_period_lock',
      entityId: lock.id,
      after: toLockDto(lock),
      reason: input.reason ?? null,
    });
    await emit(
      'attendance.period_locked',
      {
        lockId: lock.id,
        institutionId: lock.institutionId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      },
      { institutionId: lock.institutionId },
    );
    return toLockDto(lock);
  },

  async unlock(id: string, reason: string) {
    const principal = currentPrincipal();
    const db = tenantDb();
    const lock = await db.attendancePeriodLock.findFirst({ where: { id } });
    if (
      !lock ||
      !(await can(principal, 'attendance.view', await institutionResource(lock.institutionId)))
    ) {
      throw new NotFoundError('Attendance period lock');
    }
    await authorize(principal, 'attendance.unlock', await institutionResource(lock.institutionId));
    if (lock.status !== 'LOCKED') throw new AppError(409, 'INVALID_STATE', 'Period is not locked');
    const after = await db.attendancePeriodLock.update({
      where: { id },
      data: {
        status: 'UNLOCKED',
        unlockedAt: new Date(),
        unlockedByUserId: principal.userId,
        unlockReason: reason,
      },
    });
    await audit.record({
      action: 'attendance.period_unlock',
      entityType: 'attendance_period_lock',
      entityId: id,
      before: toLockDto(lock),
      after: toLockDto(after),
      reason,
    });
    await emit(
      'attendance.period_unlocked',
      {
        lockId: id,
        institutionId: lock.institutionId,
        periodStart: dateToStr(lock.periodStart),
        periodEnd: dateToStr(lock.periodEnd),
        reason,
      },
      { institutionId: lock.institutionId },
    );
    return toLockDto(after);
  },

  /* ---- policy ---- */

  async getPolicy(institutionId: string) {
    await authorize(
      currentPrincipal(),
      'attendance.view',
      await institutionResource(institutionId),
    );
    const p = await tenantDb().attendancePolicy.findFirst({ where: { institutionId } });
    return policyDto(institutionId, p);
  },

  async upsertPolicy(institutionId: string, input: UpsertAttendancePolicyInput) {
    await authorize(
      currentPrincipal(),
      'attendance.manage',
      await institutionResource(institutionId),
    );
    if (!isValidTimeZone(input.timezone)) {
      throw new ValidationError('Unknown time zone', {
        fields: [{ path: 'timezone', message: 'Unknown IANA time zone' }],
      });
    }
    const db = tenantDb();
    const before = await db.attendancePolicy.findFirst({ where: { institutionId } });
    const data = {
      timezone: input.timezone,
      lateMarksPerHalfDay: input.lateMarksPerHalfDay ?? null,
      absentIsLop: input.absentIsLop,
      allowWebPunch: input.allowWebPunch,
      allowMobilePunch: input.allowMobilePunch,
      requireFaceMatch: input.requireFaceMatch,
    };
    const after = before
      ? await db.attendancePolicy.update({ where: { id: before.id }, data })
      : await db.attendancePolicy.create({ data: withTenant({ institutionId, ...data }) });
    await audit.record({
      action: 'attendance.policy_update',
      entityType: 'institution',
      entityId: institutionId,
      before: before ? policyDto(institutionId, before) : null,
      after: policyDto(institutionId, after),
    });
    return policyDto(institutionId, after);
  },

  /* ---- self-service ---- */

  async mine(from: string, to: string): Promise<MyAttendanceDto> {
    const employee = await ownEmployee('attendance.view_own');
    const db = tenantDb();
    const ctx = new AttendanceContext();
    // Bring the visible range up to date (cheap: a month of one employee).
    await computeAttendance([employee.id], from, to, ctx);
    const [records, punches] = await Promise.all([
      db.attendanceRecord.findMany({
        where: { employeeId: employee.id, date: { gte: strToDate(from), lte: strToDate(to) } },
        orderBy: { date: 'asc' },
      }),
      db.attendancePunch.findMany({
        where: {
          employeeId: employee.id,
          attendanceDate: { gte: strToDate(from), lte: strToDate(to) },
        },
        orderBy: { punchedAt: 'asc' },
      }),
    ]);
    const items = [];
    for (const r of records) {
      items.push(await recordDto(r, ctx));
    }
    const today = await punchDay(ctx, employee, new Date());
    return {
      employeeId: employee.id,
      from,
      to,
      faceMatchRequired: today ? (await ctx.policy(today.institutionId)).requireFaceMatch : false,
      records: items,
      punches: punches.map(toPunchDto),
      days: await resolveDaysForEmployee(employee.id, from, to, ctx),
    };
  },
};
