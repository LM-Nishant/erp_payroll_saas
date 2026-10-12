import type {
  AdmissionApplication,
  Guardian,
  Student,
  StudentEnrollment,
  StudentGuardian,
} from '@prisma/client';
import type {
  AdmissionApplicationDto,
  GuardianDto,
  StudentDetailDto,
  StudentDto,
  StudentEnrollmentDto,
  StudentGuardianDto,
} from '@erp/shared';

export const dateStr = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
export const toDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const toDateOrNull = (s: string | null | undefined) => (s ? toDate(s) : null);
export const displayName = (first: string, middle?: string | null, last?: string | null) =>
  [first, middle, last].filter(Boolean).join(' ');

export type StudentWithRefs = Student & {
  institution?: { id: string; name: string; code: string } | null;
  program?: { id: string; name: string; code: string } | null;
  classSection?: { id: string; name: string; code: string; academicYear: string | null } | null;
};

export function toStudentDto(s: StudentWithRefs): StudentDto {
  return {
    id: s.id,
    admissionNo: s.admissionNo,
    rollNo: s.rollNo,
    userId: s.userId,
    groupId: s.groupId,
    institutionId: s.institutionId,
    campusId: s.campusId,
    departmentId: s.departmentId,
    programId: s.programId,
    classSectionId: s.classSectionId,
    academicYear: s.academicYear,
    status: s.status as StudentDto['status'],
    firstName: s.firstName,
    middleName: s.middleName,
    lastName: s.lastName,
    displayName: s.displayName,
    dateOfBirth: dateStr(s.dateOfBirth),
    gender: s.gender,
    bloodGroup: s.bloodGroup,
    email: s.email,
    phone: s.phone,
    address: (s.address ?? null) as Record<string, unknown> | null,
    admissionDate: dateStr(s.admissionDate),
    category: s.category,
    quota: s.quota,
    previousSchool: s.previousSchool,
    notes: s.notes,
    institution: s.institution ?? null,
    program: s.program ?? null,
    classSection: s.classSection ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function toGuardianDto(g: Guardian): GuardianDto {
  return {
    id: g.id,
    userId: g.userId,
    name: g.name,
    phone: g.phone,
    email: g.email,
    occupation: g.occupation,
  };
}

export type LinkWithGuardian = StudentGuardian & { guardian: Guardian };
export function toStudentGuardianDto(l: LinkWithGuardian): StudentGuardianDto {
  return {
    id: l.id,
    studentId: l.studentId,
    guardianId: l.guardianId,
    relation: l.relation as StudentGuardianDto['relation'],
    isPrimary: l.isPrimary,
    canPickup: l.canPickup,
    guardian: toGuardianDto(l.guardian),
  };
}

export function toEnrollmentDto(
  e: StudentEnrollment,
  sectionNames: ReadonlyMap<string, string> = new Map(),
): StudentEnrollmentDto {
  return {
    id: e.id,
    studentId: e.studentId,
    academicYear: e.academicYear,
    programId: e.programId,
    classSectionId: e.classSectionId,
    classSectionName: sectionNames.get(e.classSectionId) ?? null,
    rollNo: e.rollNo,
    fromDate: dateStr(e.fromDate)!,
    toDate: dateStr(e.toDate),
    status: e.status as StudentEnrollmentDto['status'],
  };
}

export function toStudentDetailDto(
  s: StudentWithRefs,
  guardians: LinkWithGuardian[],
  enrollments: StudentEnrollment[],
  sectionNames: ReadonlyMap<string, string> = new Map(),
): StudentDetailDto {
  return {
    ...toStudentDto(s),
    guardians: guardians.map(toStudentGuardianDto),
    enrollments: enrollments.map((e) => toEnrollmentDto(e, sectionNames)),
  };
}

export function toAdmissionDto(a: AdmissionApplication): AdmissionApplicationDto {
  return {
    id: a.id,
    applicationNo: a.applicationNo,
    groupId: a.groupId,
    institutionId: a.institutionId,
    departmentId: a.departmentId,
    programId: a.programId,
    classSectionId: a.classSectionId,
    academicYear: a.academicYear,
    status: a.status as AdmissionApplicationDto['status'],
    applicantFirstName: a.applicantFirstName,
    applicantMiddleName: a.applicantMiddleName,
    applicantLastName: a.applicantLastName,
    applicantDisplayName: a.applicantDisplayName,
    dateOfBirth: dateStr(a.dateOfBirth),
    gender: a.gender,
    email: a.email,
    phone: a.phone,
    previousSchool: a.previousSchool,
    marksPercent: a.marksPercent === null ? null : Number(a.marksPercent),
    guardianName: a.guardianName,
    guardianRelation: a.guardianRelation as AdmissionApplicationDto['guardianRelation'],
    guardianPhone: a.guardianPhone,
    guardianEmail: a.guardianEmail,
    decisionComment: a.decisionComment,
    studentId: a.studentId,
    submittedAt: iso(a.submittedAt),
    decidedAt: iso(a.decidedAt),
    enrolledAt: iso(a.enrolledAt),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}
