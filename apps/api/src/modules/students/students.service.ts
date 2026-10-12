import type { Prisma } from '@prisma/client';
import type {
  AddGuardianInput,
  CreateStudentInput,
  LifecycleStudentInput,
  LinkUserInput,
  ListStudentsQuery,
  PromoteStudentsInput,
  UpdateStudentInput,
} from '@erp/shared';
import { DbNull, isUniqueViolation } from '../../core/db/helpers';
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
import { releaseLimit, withLimit } from '../../core/features';
import { ConflictError, InvalidReferenceError, NotFoundError } from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { currentOrganizationId, tenantDb, withTenant } from '../../core/tenancy';
import {
  displayName,
  toDate,
  toDateOrNull,
  toEnrollmentDto,
  toStudentDetailDto,
  toStudentDto,
  type StudentWithRefs,
} from './students.mappers';
import { formatStudentNumber } from './students.logic';

type Db = ReturnType<typeof tenantDb>;
type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];

const studentInclude = {
  institution: { select: { id: true, name: true, code: true } },
  program: { select: { id: true, name: true, code: true } },
  classSection: { select: { id: true, name: true, code: true, academicYear: true } },
} as const;

async function resolveClassSection(classSectionId: string, db: Db | Tx = tenantDb()) {
  const cs = await db.classSection.findUnique({
    where: { id: classSectionId },
    include: { institution: { select: { groupId: true, id: true } }, program: true },
  });
  if (!cs) throw new InvalidReferenceError('classSectionId', 'Class section');
  return cs;
}

async function nextAdmissionNo(tx: Tx, institutionId: string, academicYear: string) {
  let seq = await tx.studentCodeSequence.findFirst({ where: { institutionId, academicYear } });
  if (!seq) {
    const inst = await tx.institution.findUnique({
      where: { id: institutionId },
      select: { code: true },
    });
    try {
      seq = await tx.studentCodeSequence.create({
        data: withTenant({
          institutionId,
          academicYear,
          prefix: `${(inst?.code ?? 'STU').toUpperCase()}-${academicYear.slice(0, 4)}-`,
          padding: 4,
        }),
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      seq = await tx.studentCodeSequence.findFirstOrThrow({
        where: { institutionId, academicYear },
      });
    }
  }
  const updated = await tx.studentCodeSequence.update({
    where: { id: seq.id },
    data: { nextNumber: { increment: 1 } },
  });
  return formatStudentNumber(updated.prefix, updated.padding, updated.nextNumber - 1);
}

function studentData(
  input: CreateStudentInput | UpdateStudentInput,
  cs: Awaited<ReturnType<typeof resolveClassSection>>,
) {
  const name = input.firstName
    ? displayName(input.firstName, input.middleName, input.lastName)
    : undefined;
  return {
    groupId: cs.institution.groupId,
    institutionId: cs.institutionId,
    campusId: cs.campusId,
    departmentId: cs.departmentId,
    programId: cs.programId,
    classSectionId: cs.id,
    academicYear: input.academicYear ?? cs.academicYear ?? new Date().getFullYear().toString(),
    rollNo: input.rollNo,
    userId: input.userId,
    status: input.status,
    firstName: input.firstName,
    middleName: input.middleName,
    lastName: input.lastName,
    displayName: name,
    dateOfBirth: toDateOrNull(input.dateOfBirth),
    gender: input.gender,
    bloodGroup: input.bloodGroup,
    email: input.email,
    phone: input.phone,
    address:
      input.address === undefined ? undefined : input.address === null ? DbNull : input.address,
    admissionDate: toDateOrNull(input.admissionDate),
    category: input.category,
    quota: input.quota,
    previousSchool: input.previousSchool,
    notes: input.notes,
  };
}

async function addGuardianInTx(
  tx: Tx,
  student: { id: string; groupId: string | null; institutionId: string },
  input: AddGuardianInput,
) {
  let guardianId = input.id;
  if (guardianId) {
    const existing = await tx.guardian.findUnique({ where: { id: guardianId } });
    if (!existing || existing.institutionId !== student.institutionId)
      throw new InvalidReferenceError('guardianId', 'Guardian');
  } else {
    const existing = input.email
      ? await tx.guardian.findFirst({ where: { email: input.email } })
      : null;
    const guardian =
      existing ??
      (await tx.guardian.create({
        data: withTenant({
          groupId: student.groupId,
          institutionId: student.institutionId,
          name: input.name!,
          phone: input.phone,
          email: input.email,
          occupation: input.occupation,
        }),
      }));
    guardianId = guardian.id;
  }
  const link = await tx.studentGuardian.upsert({
    where: {
      organizationId_studentId_guardianId: {
        organizationId: currentOrganizationId(),
        studentId: student.id,
        guardianId,
      },
    },
    update: { relation: input.relation, isPrimary: input.isPrimary, canPickup: input.canPickup },
    create: withTenant({
      studentId: student.id,
      guardianId,
      groupId: student.groupId,
      institutionId: student.institutionId,
      relation: input.relation,
      isPrimary: input.isPrimary,
      canPickup: input.canPickup,
    }),
  });
  return link;
}

async function loadVisible(id: string, permission = 'student.view') {
  const student = await tenantDb().student.findUnique({ where: { id }, include: studentInclude });
  if (!student || !(await can(currentPrincipal(), permission, hierarchyResource.student(student))))
    throw new NotFoundError('Student');
  return student as StudentWithRefs;
}

async function detailFor(student: StudentWithRefs) {
  const [guardians, enrollments] = await Promise.all([
    tenantDb().studentGuardian.findMany({
      where: { studentId: student.id },
      include: { guardian: true },
      orderBy: [{ isPrimary: 'desc' }],
    }),
    tenantDb().studentEnrollment.findMany({
      where: { studentId: student.id },
      orderBy: [{ fromDate: 'desc' }],
    }),
  ]);
  return toStudentDetailDto(student, guardians, enrollments, await sectionNamesOf(enrollments));
}

/** Class-section names for enrollment history rows (sections are not a Prisma relation). */
async function sectionNamesOf(enrollments: { classSectionId: string }[]) {
  const ids = [...new Set(enrollments.map((e) => e.classSectionId))];
  if (ids.length === 0) return new Map<string, string>();
  const sections = await tenantDb().classSection.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(sections.map((cs) => [cs.id, cs.name]));
}

export const studentService = {
  async list(query: ListStudentsQuery) {
    const { skip, take } = toPageWindow(query);
    const where = andScope(
      {
        groupId: query.groupId,
        institutionId: query.institutionId,
        departmentId: query.departmentId,
        programId: query.programId,
        classSectionId: query.classSectionId,
        academicYear: query.academicYear,
        status: query.status,
        ...(query.search
          ? {
              OR: [
                { displayName: { contains: query.search } },
                { admissionNo: { contains: query.search } },
                { rollNo: { contains: query.search } },
              ],
            }
          : {}),
      },
      await scopeWhere(currentPrincipal(), 'student.view', 'student'),
    );
    const [items, total] = await Promise.all([
      tenantDb().student.findMany({
        where,
        include: studentInclude,
        orderBy: [{ displayName: 'asc' }],
        skip,
        take,
      }),
      tenantDb().student.count({ where }),
    ]);
    return { items: items.map((s) => toStudentDto(s as StudentWithRefs)), total };
  },

  async get(id: string) {
    const student = await loadVisible(id);
    return detailFor(student);
  },

  async create(input: CreateStudentInput) {
    const cs = await resolveClassSection(input.classSectionId);
    await authorize(currentPrincipal(), 'student.create', hierarchyResource.classSection(cs));
    return withLimit('students', 1, async () => {
      const created = await tenantDb().$transaction(async (tx) => {
        const admissionNo =
          input.admissionNo ??
          (await nextAdmissionNo(
            tx,
            cs.institutionId,
            input.academicYear ?? cs.academicYear ?? new Date().getFullYear().toString(),
          ));
        const student = await tx.student.create({
          data: withTenant({
            ...studentData(input, cs),
            admissionNo,
          } as Prisma.StudentUncheckedCreateInput),
          include: studentInclude,
        });
        await tx.studentEnrollment.create({
          data: withTenant({
            studentId: student.id,
            groupId: student.groupId,
            institutionId: student.institutionId,
            campusId: student.campusId,
            departmentId: student.departmentId,
            programId: student.programId,
            classSectionId: student.classSectionId,
            academicYear: student.academicYear,
            rollNo: student.rollNo,
            fromDate: student.admissionDate ?? new Date(),
            status: 'ENROLLED',
          }),
        });
        for (const g of input.guardians ?? []) await addGuardianInTx(tx, student, g);
        return student;
      });
      await audit.record({
        action: 'student.created',
        entityType: 'student',
        entityId: created.id,
        after: toStudentDto(created as StudentWithRefs),
      });
      await emit(
        'student.created',
        { studentId: created.id },
        { institutionId: created.institutionId },
      );
      return toStudentDto(created as StudentWithRefs);
    });
  },

  async update(id: string, input: UpdateStudentInput) {
    const before = await loadVisible(id);
    const cs = input.classSectionId
      ? await resolveClassSection(input.classSectionId)
      : await resolveClassSection(before.classSectionId);
    await authorize(currentPrincipal(), 'student.update', hierarchyResource.student(before));
    await authorize(currentPrincipal(), 'student.update', hierarchyResource.classSection(cs));
    const updated = await tenantDb().student.update({
      where: { id },
      data: studentData(input, cs),
      include: studentInclude,
    });
    await audit.record({
      action: 'student.updated',
      entityType: 'student',
      entityId: id,
      before: toStudentDto(before),
      after: toStudentDto(updated as StudentWithRefs),
    });
    await emit('student.updated', { studentId: id }, { institutionId: updated.institutionId });
    return toStudentDto(updated as StudentWithRefs);
  },

  async remove(id: string) {
    const before = await loadVisible(id);
    await authorize(currentPrincipal(), 'student.delete', hierarchyResource.student(before));
    await tenantDb().student.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });
    await releaseLimit('students', 1);
    await audit.record({
      action: 'student.deleted',
      entityType: 'student',
      entityId: id,
      before: toStudentDto(before),
    });
  },

  async addGuardian(id: string, input: AddGuardianInput) {
    const student = await loadVisible(id);
    await authorize(currentPrincipal(), 'guardian.manage', hierarchyResource.student(student));
    await tenantDb().$transaction((tx) => addGuardianInTx(tx, student, input));
    await audit.record({
      action: 'student.guardian_linked',
      entityType: 'student',
      entityId: id,
      after: input,
    });
    return this.get(id);
  },

  async linkUser(id: string, input: LinkUserInput) {
    const before = await loadVisible(id);
    await authorize(currentPrincipal(), 'student.update', hierarchyResource.student(before));
    const updated = await tenantDb().student.update({
      where: { id },
      data: { userId: input.userId },
      include: studentInclude,
    });
    await audit.record({
      action: 'student.login_linked',
      entityType: 'student',
      entityId: id,
      before: { userId: before.userId },
      after: { userId: updated.userId },
    });
    return toStudentDto(updated as StudentWithRefs);
  },

  async linkGuardianUser(guardianId: string, input: LinkUserInput) {
    const g = await tenantDb().guardian.findUnique({ where: { id: guardianId } });
    if (
      !g ||
      !(await can(
        currentPrincipal(),
        'guardian.manage',
        hierarchyResource.student({ ...g, campusId: null, departmentId: null }),
      ))
    )
      throw new NotFoundError('Guardian');
    const updated = await tenantDb().guardian.update({
      where: { id: guardianId },
      data: { userId: input.userId },
    });
    await audit.record({
      action: 'guardian.login_linked',
      entityType: 'guardian',
      entityId: guardianId,
      before: { userId: g.userId },
      after: { userId: updated.userId },
    });
    return updated;
  },

  async promote(input: PromoteStudentsInput) {
    const [from, to] = await Promise.all([
      resolveClassSection(input.fromClassSectionId),
      resolveClassSection(input.toClassSectionId),
    ]);
    await authorize(currentPrincipal(), 'student.lifecycle', hierarchyResource.classSection(from));
    await authorize(currentPrincipal(), 'student.lifecycle', hierarchyResource.classSection(to));
    const where = {
      classSectionId: from.id,
      status: 'ACTIVE' as const,
      ...(input.studentIds?.length ? { id: { in: input.studentIds } } : {}),
    };
    const students = await tenantDb().student.findMany({ where });
    const result = await tenantDb().$transaction(async (tx) => {
      const out: string[] = [];
      for (const s of students) {
        await tx.studentEnrollment.updateMany({
          where: { studentId: s.id, toDate: null },
          data: { toDate: toDate(input.fromDate), status: 'PROMOTED' },
        });
        await tx.student.update({
          where: { id: s.id },
          data: {
            groupId: to.institution.groupId,
            institutionId: to.institutionId,
            campusId: to.campusId,
            departmentId: to.departmentId,
            programId: to.programId,
            classSectionId: to.id,
            academicYear: input.academicYear,
          },
        });
        await tx.studentEnrollment.create({
          data: withTenant({
            studentId: s.id,
            groupId: to.institution.groupId,
            institutionId: to.institutionId,
            campusId: to.campusId,
            departmentId: to.departmentId,
            programId: to.programId,
            classSectionId: to.id,
            academicYear: input.academicYear,
            rollNo: s.rollNo,
            fromDate: toDate(input.fromDate),
            status: 'ENROLLED',
          }),
        });
        out.push(s.id);
      }
      return out;
    });
    await audit.record({
      action: 'student.promoted',
      entityType: 'class_section',
      entityId: from.id,
      after: { toClassSectionId: to.id, academicYear: input.academicYear, studentIds: result },
    });
    await emit(
      'student.promoted',
      { fromClassSectionId: from.id, toClassSectionId: to.id, studentIds: result },
      { institutionId: to.institutionId },
    );
    return { count: result.length };
  },

  async lifecycle(id: string, action: 'withdrawn' | 'graduated', input: LifecycleStudentInput) {
    const before = await loadVisible(id);
    await authorize(currentPrincipal(), 'student.lifecycle', hierarchyResource.student(before));
    // Withdrawn / graduated / alumni records are final: re-running would rewrite the history.
    if (!['ACTIVE', 'INACTIVE'].includes(before.status))
      throw new ConflictError(`The student is already ${before.status.toLowerCase()}`);
    const status = action === 'withdrawn' ? 'WITHDRAWN' : 'GRADUATED';
    const enrollmentStatus = action === 'withdrawn' ? 'WITHDRAWN' : 'GRADUATED';
    const updated = await tenantDb().$transaction(async (tx) => {
      await tx.studentEnrollment.updateMany({
        where: { studentId: id, toDate: null },
        data: { toDate: toDate(input.date), status: enrollmentStatus },
      });
      return tx.student.update({ where: { id }, data: { status }, include: studentInclude });
    });
    await audit.record({
      action: `student.${action}`,
      entityType: 'student',
      entityId: id,
      before: toStudentDto(before),
      after: { status, reason: input.reason },
    });
    await emit(`student.${action}`, { studentId: id }, { institutionId: updated.institutionId });
    return toStudentDto(updated as StudentWithRefs);
  },

  async me() {
    const userId = currentPrincipal().userId;
    if (!userId) throw new NotFoundError('Student');
    const student = await tenantDb().student.findFirst({
      where: { userId },
      include: studentInclude,
    });
    if (!student) throw new NotFoundError('Student');
    return detailFor(student as StudentWithRefs);
  },

  async myWards() {
    const userId = currentPrincipal().userId;
    if (!userId) return [];
    const links = await tenantDb().studentGuardian.findMany({
      where: { guardian: { userId } },
      include: { student: { include: studentInclude }, guardian: true },
      orderBy: { createdAt: 'asc' },
    });
    return links.map((l) => toStudentDto(l.student as StudentWithRefs));
  },

  async myWard(id: string) {
    const userId = currentPrincipal().userId;
    const link = userId
      ? await tenantDb().studentGuardian.findFirst({
          where: { studentId: id, guardian: { userId } },
        })
      : null;
    if (!link) throw new NotFoundError('Student');
    const student = await tenantDb().student.findUnique({ where: { id }, include: studentInclude });
    if (!student) throw new NotFoundError('Student');
    return detailFor(student as StudentWithRefs);
  },

  async enrollments(id: string) {
    await loadVisible(id);
    const rows = await tenantDb().studentEnrollment.findMany({
      where: { studentId: id },
      orderBy: { fromDate: 'desc' },
    });
    const names = await sectionNamesOf(rows);
    return rows.map((e) => toEnrollmentDto(e, names));
  },

  async stats() {
    const scope = await scopeWhere(currentPrincipal(), 'student.view', 'student');
    const [byStatus, admissions] = await Promise.all([
      tenantDb().student.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
      tenantDb()
        .admissionApplication.groupBy({
          by: ['status'],
          where: await scopeWhere(currentPrincipal(), 'admission.view', 'admission'),
          _count: { _all: true },
        })
        .catch(() => []),
    ]);
    return {
      studentsByStatus: byStatus.map((r) => ({ status: r.status, count: r._count._all })),
      admissionsByStatus: admissions.map((r) => ({ status: r.status, count: r._count._all })),
    };
  },
};
