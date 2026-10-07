import type { Prisma } from '@prisma/client';
import type {
  BellPeriodDto,
  CreateSubstitutionInput,
  ReplaceBellScheduleInput,
  ReplaceTimetableInput,
  TimetableClashDto,
  TimetableEntryDto,
  TimetableSubstitutionDto,
  TimetableViewDto,
} from '@erp/shared';
import { isUniqueViolation } from '../../core/db/helpers';
import { audit } from '../../core/audit';
import { authorize, can, currentPrincipal, hierarchyResource, scopeWhere } from '../../core/authz';
import { emit } from '../../core/events';
import {
  AppError,
  ConflictError,
  InvalidReferenceError,
  NotFoundError,
} from '../../core/http/errors';
import { tenantDb, withTenant } from '../../core/tenancy';
import {
  assertInstitutionVisible,
  assertMemberUser,
  dateOnly,
  institutionWhere,
  loadSection,
  loadVisibleSection,
  notifyUsers,
  ownStudents,
  sectionCoords,
  sectionResource,
  toDate,
  userRefs,
} from '../academics/academics.access';
import { detectClashes, isoDayOfWeek } from './timetable.logic';

const entryInclude = {
  subject: { select: { id: true, name: true, code: true } },
  classSection: { select: { id: true, name: true, code: true } },
} as const;

type EntryRow = Prisma.TimetableEntryGetPayload<{ include: typeof entryInclude }>;

function toPeriodDto(p: {
  id: string;
  institutionId: string;
  seq: number;
  name: string;
  startTime: string;
  endTime: string;
  isBreak: boolean;
}): BellPeriodDto {
  return {
    id: p.id,
    institutionId: p.institutionId,
    seq: p.seq,
    name: p.name,
    startTime: p.startTime,
    endTime: p.endTime,
    isBreak: p.isBreak,
  };
}

async function entryDtos(rows: EntryRow[], date?: string): Promise<TimetableEntryDto[]> {
  const subs = date
    ? await tenantDb().timetableSubstitution.findMany({
        where: { entryId: { in: rows.map((r) => r.id) }, date: toDate(date) },
      })
    : [];
  const subByEntry = new Map(subs.map((s) => [s.entryId, s.substituteUserId]));
  const users = await userRefs([...rows.map((r) => r.teacherUserId), ...subByEntry.values()]);
  return rows.map((r) => ({
    id: r.id,
    classSectionId: r.classSectionId,
    dayOfWeek: r.dayOfWeek,
    periodId: r.periodId,
    subjectId: r.subjectId,
    teacherUserId: r.teacherUserId,
    room: r.room,
    subject: r.subject,
    classSection: r.classSection,
    teacher: r.teacherUserId ? (users.get(r.teacherUserId) ?? null) : null,
    ...(subByEntry.has(r.id) ? { substitute: users.get(subByEntry.get(r.id)!) ?? null } : {}),
  }));
}

async function loadInstitution(institutionId: string) {
  const inst = await tenantDb().institution.findUnique({ where: { id: institutionId } });
  if (!inst) throw new InvalidReferenceError('institutionId', 'Institution');
  return inst;
}

async function periodsOf(institutionIds: string[]) {
  return (
    await tenantDb().bellPeriod.findMany({
      where: { institutionId: { in: institutionIds } },
      orderBy: [{ institutionId: 'asc' }, { seq: 'asc' }],
    })
  ).map(toPeriodDto);
}

async function sectionView(classSectionId: string, date?: string): Promise<TimetableViewDto> {
  const cs = await tenantDb().classSection.findUniqueOrThrow({ where: { id: classSectionId } });
  const rows = await tenantDb().timetableEntry.findMany({
    where: { classSectionId, ...(date ? { dayOfWeek: isoDayOfWeek(date) } : {}) },
    include: entryInclude,
    orderBy: [{ dayOfWeek: 'asc' }],
  });
  return { periods: await periodsOf([cs.institutionId]), entries: await entryDtos(rows, date) };
}

export const timetableService = {
  async periods(institutionId: string) {
    await assertInstitutionVisible(institutionId, 'timetable.view');
    return periodsOf([institutionId]);
  },

  /** Replace the bell schedule of an institution (periods matched by `seq`). */
  async replacePeriods(input: ReplaceBellScheduleInput) {
    const inst = await loadInstitution(input.institutionId);
    await authorize(currentPrincipal(), 'timetable.manage', hierarchyResource.institution(inst));
    const before = await tenantDb().bellPeriod.findMany({
      where: { institutionId: inst.id },
      orderBy: { seq: 'asc' },
    });
    const keep = new Set(input.periods.map((p) => p.seq));
    const removed = before.filter((p) => !keep.has(p.seq));
    if (removed.length) {
      const used = await tenantDb().timetableEntry.count({
        where: { periodId: { in: removed.map((p) => p.id) } },
      });
      const marked = await tenantDb().studentAttendance.count({
        where: { periodId: { in: removed.map((p) => p.id) } },
      });
      if (used + marked > 0) {
        throw new ConflictError('Removed periods are used by timetable entries or attendance');
      }
    }
    await tenantDb().$transaction(async (tx) => {
      if (removed.length) {
        await tx.bellPeriod.deleteMany({ where: { id: { in: removed.map((p) => p.id) } } });
      }
      for (const p of input.periods) {
        const existing = before.find((b) => b.seq === p.seq);
        const data = {
          name: p.name,
          startTime: p.startTime,
          endTime: p.endTime,
          isBreak: p.isBreak,
        };
        if (existing) await tx.bellPeriod.update({ where: { id: existing.id }, data });
        else {
          await tx.bellPeriod.create({
            data: withTenant({
              groupId: inst.groupId,
              institutionId: inst.id,
              seq: p.seq,
              ...data,
            }),
          });
        }
      }
    });
    const after = await periodsOf([inst.id]);
    await audit.record({
      action: 'bell_schedule.replace',
      entityType: 'institution',
      entityId: inst.id,
      before: before.map(toPeriodDto),
      after,
    });
    return after;
  },

  async section(classSectionId: string, date?: string) {
    await loadVisibleSection(classSectionId, 'timetable.view');
    return sectionView(classSectionId, date);
  },

  async replaceSection(classSectionId: string, input: ReplaceTimetableInput) {
    const cs = await loadSection(classSectionId, 'id');
    await authorize(currentPrincipal(), 'timetable.manage', sectionResource(cs));
    const db = tenantDb();
    const [periods, subjects] = await Promise.all([
      db.bellPeriod.findMany({ where: { institutionId: cs.institutionId } }),
      db.subject.findMany({ where: { programId: cs.programId }, select: { id: true } }),
    ]);
    const periodById = new Map(periods.map((p) => [p.id, p]));
    const subjectIds = new Set(subjects.map((s) => s.id));
    const teachers = new Set<string>();
    for (const e of input.entries) {
      const period = periodById.get(e.periodId);
      if (!period) throw new InvalidReferenceError('entries.periodId', 'Bell period');
      if (period.isBreak) {
        throw new AppError(422, 'BREAK_PERIOD', `"${period.name}" is a break period`);
      }
      if (!subjectIds.has(e.subjectId)) {
        throw new InvalidReferenceError('entries.subjectId', 'Subject (of the section program)');
      }
      if (e.teacherUserId) teachers.add(e.teacherUserId);
    }
    for (const t of teachers) await assertMemberUser(t, 'entries.teacherUserId');

    const others = await db.timetableEntry.findMany({
      where: { institutionId: cs.institutionId, classSectionId: { not: cs.id } },
      select: {
        classSectionId: true,
        dayOfWeek: true,
        periodId: true,
        teacherUserId: true,
        room: true,
      },
    });
    const clashes = detectClashes([
      ...others,
      ...input.entries.map((e) => ({ ...e, classSectionId: cs.id })),
    ]).filter((c) => c.classSectionIds.includes(cs.id));
    if (clashes.length && !input.allowClashes) {
      throw new AppError(409, 'TIMETABLE_CLASH', 'Teacher or room double-booked', { clashes });
    }

    const existing = await db.timetableEntry.findMany({ where: { classSectionId: cs.id } });
    const key = (e: { dayOfWeek: number; periodId: string }) => `${e.dayOfWeek}:${e.periodId}`;
    const wanted = new Map(input.entries.map((e) => [key(e), e]));
    const removed = existing.filter((e) => !wanted.has(key(e)));
    await db.$transaction(async (tx) => {
      if (removed.length) {
        const ids = removed.map((r) => r.id);
        await tx.timetableSubstitution.deleteMany({ where: { entryId: { in: ids } } });
        await tx.timetableEntry.deleteMany({ where: { id: { in: ids } } });
      }
      for (const e of input.entries) {
        const prev = existing.find((x) => key(x) === key(e));
        const data = {
          subjectId: e.subjectId,
          teacherUserId: e.teacherUserId ?? null,
          room: e.room?.trim() || null,
        };
        if (prev) {
          if (
            prev.subjectId !== data.subjectId ||
            prev.teacherUserId !== data.teacherUserId ||
            prev.room !== data.room
          ) {
            await tx.timetableEntry.update({ where: { id: prev.id }, data });
          }
        } else {
          await tx.timetableEntry.create({
            data: withTenant({
              ...sectionCoords(cs),
              classSectionId: cs.id,
              dayOfWeek: e.dayOfWeek,
              periodId: e.periodId,
              ...data,
            }),
          });
        }
      }
    });
    await audit.record({
      action: 'timetable.replace',
      entityType: 'class_section',
      entityId: cs.id,
      before: { entries: existing.length },
      after: { entries: input.entries.length, clashes: clashes.length },
    });
    await emit(
      'timetable.updated',
      { classSectionId: cs.id, entries: input.entries.length },
      { institutionId: cs.institutionId },
    );
    return { ...(await sectionView(cs.id)), clashes: clashes as TimetableClashDto[] };
  },

  async clashes(institutionId: string): Promise<TimetableClashDto[]> {
    await assertInstitutionVisible(institutionId, 'timetable.view');
    const rows = await tenantDb().timetableEntry.findMany({
      where: { institutionId },
      select: {
        classSectionId: true,
        dayOfWeek: true,
        periodId: true,
        teacherUserId: true,
        room: true,
      },
    });
    return detectClashes(rows);
  },

  /** A teacher's weekly timetable (defaults to the current user), incl. substitutions. */
  async teacher(teacherUserId?: string, date?: string): Promise<TimetableViewDto> {
    const principal = currentPrincipal();
    const userId = teacherUserId ?? principal.userId;
    if (!userId) throw new NotFoundError('Teacher');
    const scope =
      userId === principal.userId
        ? {}
        : await scopeWhere(principal, 'timetable.view', 'academicUnit');
    const rows = await tenantDb().timetableEntry.findMany({
      where: { ...scope, teacherUserId: userId },
      include: entryInclude,
    });
    const subs = await tenantDb().timetableSubstitution.findMany({
      where: {
        substituteUserId: userId,
        ...(date
          ? { date: toDate(date) }
          : { date: { gte: toDate(new Date().toISOString().slice(0, 10)) } }),
      },
      include: { entry: { include: entryInclude } },
    });
    const institutionIds = [
      ...new Set([...rows, ...subs.map((s) => s.entry)].map((r) => r.institutionId)),
    ];
    const entries = await entryDtos(rows, date);
    const extra = await entryDtos(
      subs.map((s) => s.entry),
      date,
    );
    return {
      periods: await periodsOf(institutionIds),
      entries: [...entries, ...extra.filter((e) => !entries.some((x) => x.id === e.id))],
    };
  },

  /** Student / parent self-service timetable. */
  async own(studentId?: string, date?: string) {
    const [student] = await ownStudents(studentId);
    return {
      student: { id: student!.id, displayName: student!.displayName },
      ...(await sectionView(student!.classSectionId, date)),
    };
  },

  async substitutions(query: { institutionId?: string; date?: string }) {
    const where: Prisma.TimetableSubstitutionWhereInput = {
      ...(await institutionWhere('timetable.view')),
      ...(query.institutionId ? { institutionId: query.institutionId } : {}),
      ...(query.date ? { date: toDate(query.date) } : {}),
    };
    if (query.institutionId) await assertInstitutionVisible(query.institutionId, 'timetable.view');
    const rows = await tenantDb().timetableSubstitution.findMany({
      where,
      include: { entry: { include: entryInclude } },
      orderBy: [{ date: 'desc' }],
      take: 200,
    });
    const entries = await entryDtos(rows.map((r) => r.entry));
    const users = await userRefs(rows.map((r) => r.substituteUserId));
    return rows.map((r, i): TimetableSubstitutionDto => ({
      id: r.id,
      entryId: r.entryId,
      date: dateOnly(r.date),
      substituteUserId: r.substituteUserId,
      reason: r.reason,
      substitute: users.get(r.substituteUserId) ?? null,
      entry: entries[i] ?? null,
    }));
  },

  async createSubstitution(input: CreateSubstitutionInput) {
    const entry = await tenantDb().timetableEntry.findUnique({ where: { id: input.entryId } });
    if (!entry) throw new InvalidReferenceError('entryId', 'Timetable entry');
    await authorize(currentPrincipal(), 'timetable.manage', sectionResource(entry));
    if (isoDayOfWeek(input.date) !== entry.dayOfWeek) {
      throw new AppError(422, 'DAY_MISMATCH', 'Date does not fall on the entry weekday');
    }
    await assertMemberUser(input.substituteUserId, 'substituteUserId');
    const busy = await tenantDb().timetableEntry.findFirst({
      where: {
        teacherUserId: input.substituteUserId,
        dayOfWeek: entry.dayOfWeek,
        periodId: entry.periodId,
      },
    });
    if (busy) {
      throw new AppError(409, 'TIMETABLE_CLASH', 'Substitute teacher is busy in this period');
    }
    try {
      const row = await tenantDb().timetableSubstitution.create({
        data: withTenant({
          groupId: entry.groupId,
          institutionId: entry.institutionId,
          campusId: entry.campusId,
          departmentId: entry.departmentId,
          classSectionId: entry.classSectionId,
          entryId: entry.id,
          date: toDate(input.date),
          substituteUserId: input.substituteUserId,
          reason: input.reason ?? null,
          createdByUserId: currentPrincipal().userId,
        }),
      });
      await audit.record({
        action: 'timetable_substitution.create',
        entityType: 'timetable_substitution',
        entityId: row.id,
        after: input,
      });
      await emit(
        'timetable.substitution_created',
        { substitutionId: row.id, entryId: entry.id, date: input.date },
        { institutionId: entry.institutionId },
      );
      await notifyUsers('timetable.substitution_assigned', [input.substituteUserId], {
        title: `Substitution assigned on ${input.date}`,
        body: input.reason ?? undefined,
        link: '/academics/my-classes',
        institutionId: entry.institutionId,
        data: { substitutionId: row.id },
      });
      return (await timetableService.substitutions({ date: input.date })).find(
        (s) => s.id === row.id,
      )!;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError('A substitution already exists for this period and date');
      }
      throw err;
    }
  },

  async removeSubstitution(id: string) {
    const row = await tenantDb().timetableSubstitution.findUnique({ where: { id } });
    if (!row || !(await can(currentPrincipal(), 'timetable.view', sectionResource(row)))) {
      throw new NotFoundError('Substitution');
    }
    await authorize(currentPrincipal(), 'timetable.manage', sectionResource(row));
    await tenantDb().timetableSubstitution.delete({ where: { id } });
    await audit.record({
      action: 'timetable_substitution.delete',
      entityType: 'timetable_substitution',
      entityId: id,
      before: row,
    });
  },
};
