import type { Prisma } from '@prisma/client';
import type {
  CreateAdmissionInput,
  EnrollAdmissionInput,
  ListAdmissionsQuery,
  TransitionAdmissionInput,
  UpdateAdmissionInput,
} from '@erp/shared';
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
import {
  ConflictError,
  InvalidReferenceError,
  NotFoundError,
  ValidationError,
} from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { tenantDb, withTenant } from '../../core/tenancy';
import { displayName, toAdmissionDto, toDateOrNull } from './students.mappers';
import { studentService } from './students.service';
import { canTransitionAdmission } from './students.logic';

type Db = ReturnType<typeof tenantDb>;
type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];

async function resolveAdmissionRefs(
  input: { institutionId?: string; programId?: string; classSectionId?: string | null },
  db: Db | Tx = tenantDb(),
) {
  if (!input.programId) throw new InvalidReferenceError('programId', 'Program');
  const program = await db.program.findUnique({
    where: { id: input.programId },
    include: { institution: { select: { groupId: true, id: true } } },
  });
  if (!program) throw new InvalidReferenceError('programId', 'Program');
  if (input.institutionId && input.institutionId !== program.institutionId)
    throw new InvalidReferenceError('institutionId', 'Program');
  let classSection = null;
  if (input.classSectionId) {
    classSection = await db.classSection.findUnique({ where: { id: input.classSectionId } });
    if (!classSection || classSection.programId !== program.id)
      throw new InvalidReferenceError('classSectionId', 'Class section');
  }
  return {
    program,
    classSection,
    groupId: program.institution.groupId,
    institutionId: program.institutionId,
    departmentId: program.departmentId,
  };
}

async function nextApplicationNo(tx: Tx, institutionId: string) {
  const year = new Date().getFullYear();
  const count = await tx.admissionApplication.count({ where: { institutionId } });
  const inst = await tx.institution.findUnique({
    where: { id: institutionId },
    select: { code: true },
  });
  return `${inst?.code ?? 'APP'}-${year}-A${String(count + 1).padStart(4, '0')}`;
}

function admissionData(
  input: CreateAdmissionInput | UpdateAdmissionInput,
  refs: Awaited<ReturnType<typeof resolveAdmissionRefs>>,
) {
  const first = input.applicantFirstName;
  return {
    groupId: refs.groupId,
    institutionId: refs.institutionId,
    departmentId: refs.departmentId,
    programId: refs.program.id,
    classSectionId: refs.classSection?.id ?? input.classSectionId ?? null,
    academicYear: input.academicYear,
    status: input.status,
    applicantFirstName: first,
    applicantMiddleName: input.applicantMiddleName,
    applicantLastName: input.applicantLastName,
    applicantDisplayName: first
      ? displayName(first, input.applicantMiddleName, input.applicantLastName)
      : undefined,
    dateOfBirth: toDateOrNull(input.dateOfBirth),
    gender: input.gender,
    email: input.email,
    phone: input.phone,
    previousSchool: input.previousSchool,
    marksPercent: input.marksPercent,
    guardianName: input.guardianName,
    guardianRelation: input.guardianRelation,
    guardianPhone: input.guardianPhone,
    guardianEmail: input.guardianEmail,
    submittedAt: input.status && input.status !== 'DRAFT' ? new Date() : undefined,
  };
}

async function loadVisible(id: string) {
  const row = await tenantDb().admissionApplication.findUnique({ where: { id } });
  if (!row || !(await can(currentPrincipal(), 'admission.view', hierarchyResource.admission(row))))
    throw new NotFoundError('Admission application');
  return row;
}

export const admissionsService = {
  async list(query: ListAdmissionsQuery) {
    const { skip, take } = toPageWindow(query);
    const where = andScope(
      {
        institutionId: query.institutionId,
        programId: query.programId,
        classSectionId: query.classSectionId,
        academicYear: query.academicYear,
        status: query.status,
        ...(query.search
          ? {
              OR: [
                { applicantDisplayName: { contains: query.search } },
                { applicationNo: { contains: query.search } },
                { guardianName: { contains: query.search } },
              ],
            }
          : {}),
      },
      await scopeWhere(currentPrincipal(), 'admission.view', 'admission'),
    );
    const [items, total] = await Promise.all([
      tenantDb().admissionApplication.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      tenantDb().admissionApplication.count({ where }),
    ]);
    return { items: items.map(toAdmissionDto), total };
  },

  async get(id: string) {
    return toAdmissionDto(await loadVisible(id));
  },

  async create(input: CreateAdmissionInput) {
    const refs = await resolveAdmissionRefs(input);
    await authorize(currentPrincipal(), 'admission.manage', hierarchyResource.admission(refs));
    const created = await tenantDb().$transaction(async (tx) => {
      const applicationNo =
        input.applicationNo ?? (await nextApplicationNo(tx, refs.institutionId));
      return tx.admissionApplication.create({
        data: withTenant({
          ...admissionData(input, refs),
          applicationNo,
        } as Prisma.AdmissionApplicationUncheckedCreateInput),
      });
    });
    await audit.record({
      action: 'admission.submitted',
      entityType: 'admission_application',
      entityId: created.id,
      after: toAdmissionDto(created),
    });
    if (created.status !== 'DRAFT')
      await emit(
        'admission.submitted',
        { applicationId: created.id },
        { institutionId: created.institutionId },
      );
    return toAdmissionDto(created);
  },

  async update(id: string, input: UpdateAdmissionInput) {
    const before = await loadVisible(id);
    if (before.status === 'ENROLLED')
      throw new ConflictError('Enrolled applications cannot be edited');
    const refs = input.programId
      ? await resolveAdmissionRefs({
          institutionId: input.institutionId ?? before.institutionId,
          programId: input.programId,
          classSectionId: input.classSectionId,
        })
      : ({
          program: {
            id: before.programId,
            institutionId: before.institutionId,
            departmentId: before.departmentId,
          },
          classSection: input.classSectionId
            ? await tenantDb().classSection.findUnique({ where: { id: input.classSectionId } })
            : null,
          groupId: before.groupId,
          institutionId: before.institutionId,
          departmentId: before.departmentId,
        } as Awaited<ReturnType<typeof resolveAdmissionRefs>>);
    await authorize(currentPrincipal(), 'admission.manage', hierarchyResource.admission(before));
    const updated = await tenantDb().admissionApplication.update({
      where: { id },
      data: admissionData(input, refs),
    });
    await audit.record({
      action: 'admission.updated',
      entityType: 'admission_application',
      entityId: id,
      before: toAdmissionDto(before),
      after: toAdmissionDto(updated),
    });
    return toAdmissionDto(updated);
  },

  async transition(id: string, input: TransitionAdmissionInput) {
    const before = await loadVisible(id);
    await authorize(currentPrincipal(), 'admission.manage', hierarchyResource.admission(before));
    if (!canTransitionAdmission(before.status, input.status))
      throw new ValidationError(`Cannot move admission from ${before.status} to ${input.status}`);
    const updated = await tenantDb().admissionApplication.update({
      where: { id },
      data: {
        status: input.status,
        decisionComment: input.comment,
        decidedAt: ['APPROVED', 'REJECTED', 'WAITLISTED'].includes(input.status)
          ? new Date()
          : before.decidedAt,
        submittedAt: input.status === 'SUBMITTED' ? new Date() : before.submittedAt,
      },
    });
    const action =
      input.status === 'APPROVED'
        ? 'admission.approved'
        : input.status === 'REJECTED'
          ? 'admission.rejected'
          : input.status === 'WAITLISTED'
            ? 'admission.waitlisted'
            : 'admission.updated';
    await audit.record({
      action,
      entityType: 'admission_application',
      entityId: id,
      before: toAdmissionDto(before),
      after: toAdmissionDto(updated),
    });
    if (['APPROVED', 'REJECTED'].includes(input.status))
      await emit(action, { applicationId: id }, { institutionId: updated.institutionId });
    return toAdmissionDto(updated);
  },

  async enroll(id: string, input: EnrollAdmissionInput) {
    const app = await loadVisible(id);
    await authorize(currentPrincipal(), 'admission.manage', hierarchyResource.admission(app));
    if (app.status !== 'APPROVED')
      throw new ConflictError('Only approved applications can be enrolled');
    const classSectionId = input.classSectionId ?? app.classSectionId;
    if (!classSectionId) throw new InvalidReferenceError('classSectionId', 'Class section');
    const student = await studentService.create({
      classSectionId,
      academicYear: app.academicYear,
      status: 'ACTIVE',
      rollNo: input.rollNo,
      firstName: app.applicantFirstName,
      middleName: app.applicantMiddleName,
      lastName: app.applicantLastName,
      dateOfBirth: app.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      gender: app.gender as never,
      email: app.email,
      phone: app.phone,
      previousSchool: app.previousSchool,
      admissionDate: input.admissionDate ?? new Date().toISOString().slice(0, 10),
      guardians: [
        {
          name: app.guardianName,
          relation: app.guardianRelation as never,
          phone: app.guardianPhone,
          email: app.guardianEmail,
          isPrimary: true,
          canPickup: true,
        },
      ],
    });
    const updated = await tenantDb().admissionApplication.update({
      where: { id },
      data: { status: 'ENROLLED', studentId: student.id, enrolledAt: new Date() },
    });
    await audit.record({
      action: 'admission.enrolled',
      entityType: 'admission_application',
      entityId: id,
      after: { studentId: student.id },
    });
    await emit(
      'admission.enrolled',
      { applicationId: id, studentId: student.id },
      { institutionId: updated.institutionId },
    );
    return { application: toAdmissionDto(updated), student };
  },
};
