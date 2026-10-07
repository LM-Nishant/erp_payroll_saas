import type {
  AdmissionStatus,
  GuardianRelation,
  StudentEnrollmentStatus,
  StudentStatus,
} from '../schemas/students';

export interface StudentDto {
  id: string;
  admissionNo: string;
  rollNo: string | null;
  userId: string | null;
  groupId: string | null;
  institutionId: string;
  campusId: string | null;
  departmentId: string;
  programId: string;
  classSectionId: string;
  academicYear: string;
  status: StudentStatus;
  firstName: string;
  middleName: string | null;
  lastName: string | null;
  displayName: string;
  dateOfBirth: string | null;
  gender: string | null;
  bloodGroup: string | null;
  email: string | null;
  phone: string | null;
  address: Record<string, unknown> | null;
  admissionDate: string | null;
  category: string | null;
  quota: string | null;
  previousSchool: string | null;
  notes: string | null;
  institution?: { id: string; name: string; code: string } | null;
  program?: { id: string; name: string; code: string } | null;
  classSection?: { id: string; name: string; code: string; academicYear: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export interface GuardianDto {
  id: string;
  userId: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  occupation: string | null;
}

export interface StudentGuardianDto {
  id: string;
  studentId: string;
  guardianId: string;
  relation: GuardianRelation;
  isPrimary: boolean;
  canPickup: boolean;
  guardian: GuardianDto;
}

export interface StudentEnrollmentDto {
  id: string;
  studentId: string;
  academicYear: string;
  programId: string;
  classSectionId: string;
  rollNo: string | null;
  fromDate: string;
  toDate: string | null;
  status: StudentEnrollmentStatus;
}

export interface StudentDetailDto extends StudentDto {
  guardians: StudentGuardianDto[];
  enrollments: StudentEnrollmentDto[];
}

export interface AdmissionApplicationDto {
  id: string;
  applicationNo: string;
  groupId: string | null;
  institutionId: string;
  departmentId: string;
  programId: string;
  classSectionId: string | null;
  academicYear: string;
  status: AdmissionStatus;
  applicantFirstName: string;
  applicantMiddleName: string | null;
  applicantLastName: string | null;
  applicantDisplayName: string;
  dateOfBirth: string | null;
  gender: string | null;
  email: string | null;
  phone: string | null;
  previousSchool: string | null;
  marksPercent: number | null;
  guardianName: string;
  guardianRelation: GuardianRelation;
  guardianPhone: string | null;
  guardianEmail: string | null;
  decisionComment: string | null;
  studentId: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  enrolledAt: string | null;
  createdAt: string;
  updatedAt: string;
}
