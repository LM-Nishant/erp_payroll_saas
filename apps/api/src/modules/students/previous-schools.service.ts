import type { AdmissionApplication, Student, StudentPreviousSchool } from '@prisma/client';
import type {
  PreviousSchoolInput,
  StudentPreviousSchoolDto,
  UpdatePreviousSchoolInput,
} from '@erp/shared';
import { audit } from '../../core/audit';
import { authorize, can, currentPrincipal, hierarchyResource } from '../../core/authz';
import { documentEngine } from '../../core/documents';
import { NotFoundError } from '../../core/http/errors';
import type { MultipartFile } from '../../core/http/multipart';
import { tenantDb, withTenant } from '../../core/tenancy';
import { dateStr, toDateOrNull } from './students.mappers';

/**
 * Previous-school records (schools attended before joining). A record belongs to an admission
 * application and/or a student: applicants' records are linked to the student on enrollment.
 * Access follows the owner — `student.view` / `student.update` for student records,
 * `admission.view` / `admission.manage` for records of applicants not yet enrolled.
 */

type Owner =
  { kind: 'student'; student: Student } | { kind: 'admission'; admission: AdmissionApplication };

type RecordWithFile = StudentPreviousSchool & {
  tcDocument?: { currentVersion: { fileName: string } | null } | null;
};

const withFile = {
  tcDocument: { select: { currentVersion: { select: { fileName: true } } } },
} as const;

export function toPreviousSchoolDto(r: RecordWithFile): StudentPreviousSchoolDto {
  return {
    id: r.id,
    institutionId: r.institutionId,
    studentId: r.studentId,
    admissionApplicationId: r.admissionApplicationId,
    schoolName: r.schoolName,
    board: r.board,
    location: r.location,
    lastClass: r.lastClass,
    lastAcademicYear: r.lastAcademicYear,
    marksPercent: r.marksPercent === null ? null : Number(r.marksPercent),
    grade: r.grade,
    tcNumber: r.tcNumber,
    tcDate: dateStr(r.tcDate),
    tcDocumentId: r.tcDocumentId,
    tcFileName: r.tcDocument?.currentVersion?.fileName ?? null,
    remarks: r.remarks,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

const ownerScope = (o: Owner) =>
  o.kind === 'student'
    ? hierarchyResource.student(o.student)
    : hierarchyResource.admission(o.admission);

const permissionFor = (o: Owner, write: boolean) =>
  o.kind === 'student'
    ? write
      ? 'student.update'
      : 'student.view'
    : write
      ? 'admission.manage'
      : 'admission.view';

async function loadStudentOwner(id: string): Promise<Owner> {
  const student = await tenantDb().student.findUnique({ where: { id } });
  if (!student || !(await can(currentPrincipal(), 'student.view', ownerScopeOf(student))))
    throw new NotFoundError('Student');
  return { kind: 'student', student };
}

async function loadAdmissionOwner(id: string): Promise<Owner> {
  const admission = await tenantDb().admissionApplication.findUnique({ where: { id } });
  if (
    !admission ||
    !(await can(currentPrincipal(), 'admission.view', hierarchyResource.admission(admission)))
  )
    throw new NotFoundError('Admission application');
  return { kind: 'admission', admission };
}

const ownerScopeOf = (s: Student) => hierarchyResource.student(s);

/** Loads a record and its owner (the student once linked, else the application). */
async function loadRecord(id: string, write: boolean) {
  const record = await tenantDb().studentPreviousSchool.findUnique({
    where: { id },
    include: withFile,
  });
  if (!record) throw new NotFoundError('Previous school record');
  let owner: Owner | null = null;
  if (record.studentId) {
    const student = await tenantDb().student.findUnique({ where: { id: record.studentId } });
    if (student) owner = { kind: 'student', student };
  } else if (record.admissionApplicationId) {
    const admission = await tenantDb().admissionApplication.findUnique({
      where: { id: record.admissionApplicationId },
    });
    if (admission) owner = { kind: 'admission', admission };
  }
  if (!owner || !(await can(currentPrincipal(), permissionFor(owner, false), ownerScope(owner))))
    throw new NotFoundError('Previous school record');
  if (write) await authorize(currentPrincipal(), permissionFor(owner, true), ownerScope(owner));
  return { record, owner };
}

function recordData(input: PreviousSchoolInput | UpdatePreviousSchoolInput) {
  return {
    schoolName: input.schoolName,
    board: input.board,
    location: input.location,
    lastClass: input.lastClass,
    lastAcademicYear: input.lastAcademicYear,
    marksPercent: input.marksPercent,
    grade: input.grade,
    tcNumber: input.tcNumber,
    tcDate: input.tcDate === undefined ? undefined : toDateOrNull(input.tcDate),
    remarks: input.remarks,
  };
}

/** Keeps the legacy free-text `previousSchool` column in sync with the latest record. */
async function syncLegacyText(owner: Owner) {
  const db = tenantDb();
  const where =
    owner.kind === 'student'
      ? { studentId: owner.student.id }
      : { admissionApplicationId: owner.admission.id };
  const latest = await db.studentPreviousSchool.findFirst({
    where,
    orderBy: [{ lastAcademicYear: 'desc' }, { createdAt: 'desc' }],
    select: { schoolName: true, marksPercent: true },
  });
  if (owner.kind === 'student') {
    await db.student.update({
      where: { id: owner.student.id },
      data: { previousSchool: latest?.schoolName ?? null },
    });
  } else {
    await db.admissionApplication.update({
      where: { id: owner.admission.id },
      data: {
        previousSchool: latest?.schoolName ?? null,
        ...(latest?.marksPercent != null ? { marksPercent: latest.marksPercent } : {}),
      },
    });
  }
}

async function listFor(owner: Owner) {
  const rows = await tenantDb().studentPreviousSchool.findMany({
    where:
      owner.kind === 'student'
        ? { studentId: owner.student.id }
        : { admissionApplicationId: owner.admission.id },
    include: withFile,
    orderBy: [{ lastAcademicYear: 'desc' }, { createdAt: 'desc' }],
  });
  return rows.map(toPreviousSchoolDto);
}

async function createFor(owner: Owner, input: PreviousSchoolInput) {
  await authorize(currentPrincipal(), permissionFor(owner, true), ownerScope(owner));
  const base =
    owner.kind === 'student'
      ? {
          groupId: owner.student.groupId,
          institutionId: owner.student.institutionId,
          studentId: owner.student.id,
        }
      : {
          groupId: owner.admission.groupId,
          institutionId: owner.admission.institutionId,
          admissionApplicationId: owner.admission.id,
          studentId: owner.admission.studentId,
        };
  const created = await tenantDb().studentPreviousSchool.create({
    data: withTenant({
      ...base,
      ...recordData(input),
      schoolName: input.schoolName,
      createdById: currentPrincipal().userId,
    }),
    include: withFile,
  });
  await syncLegacyText(owner);
  const dto = toPreviousSchoolDto(created);
  await audit.record({
    action: 'student.previous_school_added',
    entityType: 'student_previous_school',
    entityId: created.id,
    after: dto,
  });
  return dto;
}

export const previousSchoolService = {
  async listForStudent(studentId: string) {
    return listFor(await loadStudentOwner(studentId));
  },

  async listForAdmission(admissionId: string) {
    return listFor(await loadAdmissionOwner(admissionId));
  },

  async createForStudent(studentId: string, input: PreviousSchoolInput) {
    return createFor(await loadStudentOwner(studentId), input);
  },

  async createForAdmission(admissionId: string, input: PreviousSchoolInput) {
    return createFor(await loadAdmissionOwner(admissionId), input);
  },

  async update(id: string, input: UpdatePreviousSchoolInput) {
    const { record, owner } = await loadRecord(id, true);
    const updated = await tenantDb().studentPreviousSchool.update({
      where: { id },
      data: recordData(input),
      include: withFile,
    });
    await syncLegacyText(owner);
    const dto = toPreviousSchoolDto(updated);
    await audit.record({
      action: 'student.previous_school_updated',
      entityType: 'student_previous_school',
      entityId: id,
      before: toPreviousSchoolDto(record),
      after: dto,
    });
    return dto;
  },

  async remove(id: string) {
    const { record, owner } = await loadRecord(id, true);
    await tenantDb().studentPreviousSchool.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await syncLegacyText(owner);
    await audit.record({
      action: 'student.previous_school_deleted',
      entityType: 'student_previous_school',
      entityId: id,
      before: toPreviousSchoolDto(record),
    });
  },

  /** Upload (or replace) the scanned TC issued by the previous school. */
  async uploadTc(id: string, file: MultipartFile) {
    const { record, owner } = await loadRecord(id, true);
    const meta = {
      title: `Previous school TC — ${record.schoolName}`.slice(0, 255),
      category: 'student',
      documentType: 'previous_school_tc',
      confidentiality: 'INTERNAL',
    };
    let documentId = record.tcDocumentId;
    if (documentId) {
      await documentEngine.addVersion(
        documentId,
        { fileName: file.fileName, mimeType: file.mimeType, body: file.body },
        { authorization: 'caller', reason: 'Replaced previous-school TC' },
      );
    } else {
      const doc = await documentEngine.attach({
        ownerType: owner.kind === 'student' ? 'student' : 'admission_application',
        ownerId: owner.kind === 'student' ? owner.student.id : owner.admission.id,
        module: 'students',
        metadata: meta,
        file,
        extra: { previousSchoolId: record.id },
        authorization: 'caller',
      });
      documentId = doc.id;
    }
    const updated = await tenantDb().studentPreviousSchool.update({
      where: { id },
      data: { tcDocumentId: documentId },
      include: withFile,
    });
    const dto = toPreviousSchoolDto(updated);
    await audit.record({
      action: 'student.previous_school_tc_uploaded',
      entityType: 'student_previous_school',
      entityId: id,
      after: { tcDocumentId: documentId, fileName: dto.tcFileName },
    });
    return dto;
  },

  /** Bytes of the uploaded previous-school TC. */
  async downloadTc(id: string) {
    const { record } = await loadRecord(id, false);
    if (!record.tcDocumentId) throw new NotFoundError('Previous school TC file');
    const file = await documentEngine.readCurrentVersion(record.tcDocumentId);
    if (!file) throw new NotFoundError('Previous school TC file');
    await audit.record({
      action: 'student.previous_school_tc_downloaded',
      entityType: 'student_previous_school',
      entityId: id,
      metadata: { documentId: record.tcDocumentId },
    });
    return { body: file.body, fileName: file.version.fileName, mimeType: file.version.mimeType };
  },

  /** On enrollment, the applicant's records follow the new student. */
  async linkAdmissionToStudent(admissionId: string, studentId: string) {
    const db = tenantDb();
    const { count } = await db.studentPreviousSchool.updateMany({
      where: { admissionApplicationId: admissionId, studentId: null },
      data: { studentId },
    });
    return count;
  },
};
