import type { Prisma } from '@prisma/client';
import type {
  CreateSubjectInput,
  ListAllocationsQuery,
  ListSubjectsQuery,
  MyClassDto,
  SetClassTeacherInput,
  SubjectAllocationDto,
  SubjectDto,
  UpdateSubjectInput,
  UpsertAllocationInput,
} from '@erp/shared';
import { isUniqueViolation } from '../../core/db/helpers';
import { audit } from '../../core/audit';
import {
  andScope,
  authorize,
  can,
  currentPrincipal,
  hierarchyResource,
  scopeWhere,
} from '../../core/authz';
import { emit } from '../../core/events';
import { ConflictError, InvalidReferenceError, NotFoundError } from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { tenantDb, withTenant } from '../../core/tenancy';
import {
  assertMemberUser,
  loadSection,
  loadVisibleSection,
  sectionCoords,
  sectionResource,
  userRefs,
} from './academics.access';

type SubjectRow = Prisma.SubjectGetPayload<{
  include: { program: { select: { id: true; name: true; code: true } } };
}>;

export function toSubjectDto(s: SubjectRow): SubjectDto {
  return {
    id: s.id,
    groupId: s.groupId,
    institutionId: s.institutionId,
    departmentId: s.departmentId,
    programId: s.programId,
    code: s.code,
    name: s.name,
    type: s.type,
    credits: s.credits === null ? null : Number(s.credits),
    maxMarks: s.maxMarks,
    passMarks: s.passMarks,
    status: s.status,
    program: s.program ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

const subjectInclude = { program: { select: { id: true, name: true, code: true } } } as const;

async function loadVisibleSubject(id: string) {
  const s = await tenantDb().subject.findUnique({ where: { id }, include: subjectInclude });
  if (!s || !(await can(currentPrincipal(), 'subject.view', sectionResource(s)))) {
    throw new NotFoundError('Subject');
  }
  return s;
}

export const subjectService = {
  async list(query: ListSubjectsQuery) {
    const where: Prisma.SubjectWhereInput = andScope(
      {
        ...(query.programId ? { programId: query.programId } : {}),
        ...(query.institutionId ? { institutionId: query.institutionId } : {}),
        ...(query.search
          ? { OR: [{ name: { contains: query.search } }, { code: { contains: query.search } }] }
          : {}),
      },
      await scopeWhere(currentPrincipal(), 'subject.view', 'academicUnit'),
    );
    if (query.classSectionId) {
      const cs = await tenantDb().classSection.findUnique({
        where: { id: query.classSectionId },
        select: { programId: true },
      });
      where.programId = cs?.programId ?? '-';
    }
    const [rows, total] = await Promise.all([
      tenantDb().subject.findMany({
        where,
        include: subjectInclude,
        orderBy: [{ programId: 'asc' }, { code: 'asc' }],
        ...toPageWindow(query),
      }),
      tenantDb().subject.count({ where }),
    ]);
    return { items: rows.map(toSubjectDto), total };
  },

  async get(id: string) {
    return toSubjectDto(await loadVisibleSubject(id));
  },

  async create(input: CreateSubjectInput) {
    const program = await tenantDb().program.findUnique({
      where: { id: input.programId },
      include: { institution: { select: { groupId: true } } },
    });
    if (!program) throw new InvalidReferenceError('programId', 'Program');
    await authorize(currentPrincipal(), 'subject.manage', hierarchyResource.program(program));
    try {
      const row = await tenantDb().subject.create({
        data: withTenant({
          groupId: program.institution.groupId,
          institutionId: program.institutionId,
          departmentId: program.departmentId,
          programId: program.id,
          code: input.code.toUpperCase(),
          name: input.name,
          type: input.type,
          credits: input.credits ?? null,
          maxMarks: input.maxMarks,
          passMarks: input.passMarks,
          status: input.status,
        }),
        include: subjectInclude,
      });
      const dto = toSubjectDto(row);
      await audit.record({
        action: 'subject.create',
        entityType: 'subject',
        entityId: row.id,
        after: dto,
      });
      await emit('subject.created', { subjectId: row.id }, { institutionId: row.institutionId });
      return dto;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('Subject code already exists in program');
      throw err;
    }
  },

  async update(id: string, input: UpdateSubjectInput) {
    const before = await loadVisibleSubject(id);
    await authorize(currentPrincipal(), 'subject.manage', sectionResource(before));
    const maxMarks = input.maxMarks ?? before.maxMarks;
    const passMarks = input.passMarks ?? before.passMarks;
    if (passMarks > maxMarks) {
      throw new InvalidReferenceError('passMarks', 'Pass marks (cannot exceed max marks)');
    }
    try {
      const row = await tenantDb().subject.update({
        where: { id },
        data: {
          code: input.code?.toUpperCase(),
          name: input.name,
          type: input.type,
          credits: input.credits === undefined ? undefined : input.credits,
          maxMarks: input.maxMarks,
          passMarks: input.passMarks,
          status: input.status,
        },
        include: subjectInclude,
      });
      const dto = toSubjectDto(row);
      await audit.record({
        action: 'subject.update',
        entityType: 'subject',
        entityId: id,
        before: toSubjectDto(before),
        after: dto,
      });
      return dto;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('Subject code already exists in program');
      throw err;
    }
  },

  async remove(id: string) {
    const before = await loadVisibleSubject(id);
    await authorize(currentPrincipal(), 'subject.manage', sectionResource(before));
    const db = tenantDb();
    const [allocations, entries, schedules] = await Promise.all([
      db.subjectAllocation.count({ where: { subjectId: id } }),
      db.timetableEntry.count({ where: { subjectId: id } }),
      db.examSchedule.count({ where: { subjectId: id } }),
    ]);
    if (allocations + entries + schedules > 0) {
      throw new ConflictError('Subject is used by allocations, timetable entries or exams');
    }
    await db.subject.delete({ where: { id } });
    await audit.record({
      action: 'subject.delete',
      entityType: 'subject',
      entityId: id,
      before: toSubjectDto(before),
    });
  },
};

async function allocationDtos(
  rows: Prisma.SubjectAllocationGetPayload<{
    include: {
      subject: { select: { id: true; name: true; code: true } };
      classSection: { select: { id: true; name: true; code: true } };
    };
  }>[],
): Promise<SubjectAllocationDto[]> {
  const users = await userRefs(rows.map((r) => r.teacherUserId));
  return rows.map((r) => ({
    id: r.id,
    institutionId: r.institutionId,
    classSectionId: r.classSectionId,
    subjectId: r.subjectId,
    teacherUserId: r.teacherUserId,
    subject: r.subject,
    classSection: r.classSection,
    teacher: users.get(r.teacherUserId) ?? null,
  }));
}

const allocationInclude = {
  subject: { select: { id: true, name: true, code: true } },
  classSection: { select: { id: true, name: true, code: true } },
} as const;

export const allocationService = {
  async list(query: ListAllocationsQuery) {
    const where: Prisma.SubjectAllocationWhereInput = andScope(
      {
        ...(query.classSectionId ? { classSectionId: query.classSectionId } : {}),
        ...(query.institutionId ? { institutionId: query.institutionId } : {}),
        ...(query.teacherUserId ? { teacherUserId: query.teacherUserId } : {}),
      },
      await scopeWhere(currentPrincipal(), 'subject.view', 'academicUnit'),
    );
    const [rows, total] = await Promise.all([
      tenantDb().subjectAllocation.findMany({
        where,
        include: allocationInclude,
        orderBy: [{ classSectionId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        ...toPageWindow(query),
      }),
      tenantDb().subjectAllocation.count({ where }),
    ]);
    return { items: await allocationDtos(rows), total };
  },

  /** Create or replace the teacher of (section, subject). */
  async upsert(input: UpsertAllocationInput) {
    const cs = await loadSection(input.classSectionId);
    await authorize(currentPrincipal(), 'subject.manage', sectionResource(cs));
    const subject = await tenantDb().subject.findUnique({ where: { id: input.subjectId } });
    if (!subject || subject.programId !== cs.programId) {
      throw new InvalidReferenceError('subjectId', 'Subject (of the section program)');
    }
    await assertMemberUser(input.teacherUserId, 'teacherUserId');
    const existing = await tenantDb().subjectAllocation.findFirst({
      where: { classSectionId: cs.id, subjectId: subject.id },
    });
    const row = existing
      ? await tenantDb().subjectAllocation.update({
          where: { id: existing.id },
          data: { teacherUserId: input.teacherUserId },
          include: allocationInclude,
        })
      : await tenantDb().subjectAllocation.create({
          data: withTenant({
            ...sectionCoords(cs),
            classSectionId: cs.id,
            subjectId: subject.id,
            teacherUserId: input.teacherUserId,
          }),
          include: allocationInclude,
        });
    const [dto] = await allocationDtos([row]);
    await audit.record({
      action: existing ? 'subject_allocation.update' : 'subject_allocation.create',
      entityType: 'subject_allocation',
      entityId: row.id,
      before: existing ?? undefined,
      after: dto,
    });
    await emit(
      'subject_allocation.changed',
      { allocationId: row.id, classSectionId: cs.id, subjectId: subject.id },
      { institutionId: cs.institutionId },
    );
    return dto!;
  },

  async remove(id: string) {
    const row = await tenantDb().subjectAllocation.findUnique({ where: { id } });
    if (!row || !(await can(currentPrincipal(), 'subject.view', sectionResource(row)))) {
      throw new NotFoundError('Allocation');
    }
    await authorize(currentPrincipal(), 'subject.manage', sectionResource(row));
    await tenantDb().subjectAllocation.delete({ where: { id } });
    await audit.record({
      action: 'subject_allocation.delete',
      entityType: 'subject_allocation',
      entityId: id,
      before: row,
    });
  },

  async classTeacher(classSectionId: string) {
    await loadVisibleSection(classSectionId, 'subject.view');
    const row = await tenantDb().classTeacherAssignment.findFirst({ where: { classSectionId } });
    if (!row) return null;
    const users = await userRefs([row.teacherUserId]);
    return {
      classSectionId,
      teacherUserId: row.teacherUserId,
      teacher: users.get(row.teacherUserId) ?? null,
    };
  },

  async setClassTeacher(input: SetClassTeacherInput) {
    const cs = await loadSection(input.classSectionId);
    await authorize(currentPrincipal(), 'subject.manage', sectionResource(cs));
    const existing = await tenantDb().classTeacherAssignment.findFirst({
      where: { classSectionId: cs.id },
    });
    if (input.teacherUserId === null) {
      if (existing) await tenantDb().classTeacherAssignment.delete({ where: { id: existing.id } });
    } else {
      await assertMemberUser(input.teacherUserId, 'teacherUserId');
      if (existing) {
        await tenantDb().classTeacherAssignment.update({
          where: { id: existing.id },
          data: { teacherUserId: input.teacherUserId },
        });
      } else {
        await tenantDb().classTeacherAssignment.create({
          data: withTenant({
            ...sectionCoords(cs),
            classSectionId: cs.id,
            teacherUserId: input.teacherUserId,
          }),
        });
      }
    }
    await audit.record({
      action: 'class_teacher.set',
      entityType: 'class_section',
      entityId: cs.id,
      before: existing ? { teacherUserId: existing.teacherUserId } : undefined,
      after: { teacherUserId: input.teacherUserId },
    });
    return allocationService.classTeacher(cs.id);
  },

  /** Staff who can teach in an institution (hold attendance-marking / marks-entry roles there). */
  async teacherOptions(institutionId: string, search?: string) {
    const inst = await tenantDb().institution.findUnique({ where: { id: institutionId } });
    if (
      !inst ||
      !(await can(currentPrincipal(), 'subject.view', hierarchyResource.institution(inst)))
    ) {
      throw new NotFoundError('Institution');
    }
    const departments = await tenantDb().department.findMany({
      where: { institutionId },
      select: { id: true },
    });
    const scopes = await tenantDb().userScope.findMany({
      where: {
        OR: [
          { institutionId },
          { departmentId: { in: departments.map((d) => d.id) } },
          ...(inst.groupId ? [{ groupId: inst.groupId, institutionId: null }] : []),
        ],
        userRole: {
          role: {
            rolePermissions: {
              some: {
                permission: { code: { in: ['exam.marks_entry', 'student_attendance.mark'] } },
              },
            },
          },
        },
      },
      select: { userId: true },
      take: 1000,
    });
    const users = await userRefs(scopes.map((s) => s.userId));
    const needle = search?.toLowerCase();
    return [...users.values()]
      .filter(
        (u) =>
          !needle ||
          u.name.toLowerCase().includes(needle) ||
          u.email.toLowerCase().includes(needle),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  /** Teacher workspace: sections the current user teaches or is class teacher of. */
  async myClasses(): Promise<MyClassDto[]> {
    const userId = currentPrincipal().userId;
    if (!userId) return [];
    const db = tenantDb();
    const [allocations, classTeacherOf] = await Promise.all([
      db.subjectAllocation.findMany({
        where: { teacherUserId: userId },
        include: {
          subject: { select: { id: true, name: true, code: true } },
          classSection: true,
        },
      }),
      db.classTeacherAssignment.findMany({
        where: { teacherUserId: userId },
        include: { classSection: true },
      }),
    ]);
    const map = new Map<string, MyClassDto>();
    const ensure = (cs: (typeof allocations)[number]['classSection']) => {
      const existing = map.get(cs.id);
      if (existing) return existing;
      const created: MyClassDto = {
        classSection: {
          id: cs.id,
          name: cs.name,
          code: cs.code,
          institutionId: cs.institutionId,
          academicYear: cs.academicYear,
        },
        isClassTeacher: false,
        subjects: [],
        studentCount: 0,
      };
      map.set(cs.id, created);
      return created;
    };
    for (const a of allocations) ensure(a.classSection).subjects.push(a.subject);
    for (const c of classTeacherOf) ensure(c.classSection).isClassTeacher = true;
    const counts = await db.student.groupBy({
      by: ['classSectionId'],
      where: { classSectionId: { in: [...map.keys()] }, status: 'ACTIVE' },
      _count: { _all: true },
    });
    for (const c of counts) {
      const entry = map.get(c.classSectionId);
      if (entry) entry.studentCount = c._count._all;
    }
    return [...map.values()].sort((a, b) => a.classSection.name.localeCompare(b.classSection.name));
  },
};
