import type {
  ExamMarksStatus,
  ExamTermStatus,
  ExamTermType,
  GradeBand,
  StudentAttendanceStatus,
  SubjectType,
} from '../schemas/academics';

export interface RefDto {
  id: string;
  name: string;
  code?: string | null;
}

export interface SubjectDto {
  id: string;
  groupId: string | null;
  institutionId: string;
  departmentId: string;
  programId: string;
  code: string;
  name: string;
  type: SubjectType;
  credits: number | null;
  maxMarks: number;
  passMarks: number;
  status: 'ACTIVE' | 'INACTIVE';
  program?: RefDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeacherRefDto {
  id: string;
  name: string;
  email: string;
}

export interface SubjectAllocationDto {
  id: string;
  institutionId: string;
  classSectionId: string;
  subjectId: string;
  teacherUserId: string;
  subject?: RefDto | null;
  classSection?: RefDto | null;
  teacher?: TeacherRefDto | null;
}

export interface ClassTeacherDto {
  classSectionId: string;
  teacherUserId: string;
  teacher?: TeacherRefDto | null;
}

/** "My classes" for a teacher: sections with allocated subjects / class-teacher flag. */
export interface MyClassDto {
  classSection: RefDto & { institutionId: string; academicYear: string | null };
  isClassTeacher: boolean;
  subjects: RefDto[];
  studentCount: number;
}

export interface BellPeriodDto {
  id: string;
  institutionId: string;
  seq: number;
  name: string;
  startTime: string;
  endTime: string;
  isBreak: boolean;
}

export interface TimetableEntryDto {
  id: string;
  classSectionId: string;
  dayOfWeek: number;
  periodId: string;
  subjectId: string;
  teacherUserId: string | null;
  room: string | null;
  subject?: RefDto | null;
  teacher?: TeacherRefDto | null;
  classSection?: RefDto | null;
  /** Present when viewing a specific date with a substitution. */
  substitute?: TeacherRefDto | null;
}

export interface TimetableClashDto {
  kind: 'TEACHER' | 'ROOM';
  dayOfWeek: number;
  periodId: string;
  /** Teacher user id or room name. */
  key: string;
  classSectionIds: string[];
}

export interface TimetableViewDto {
  periods: BellPeriodDto[];
  entries: TimetableEntryDto[];
}

export interface TimetableSubstitutionDto {
  id: string;
  entryId: string;
  date: string;
  substituteUserId: string;
  reason: string | null;
  substitute?: TeacherRefDto | null;
  entry?: TimetableEntryDto | null;
}

export interface StudentAttendanceRowDto {
  studentId: string;
  rollNo: string | null;
  displayName: string;
  admissionNo: string;
  status: StudentAttendanceStatus | null;
  remarks: string | null;
}

export interface SectionAttendanceDto {
  classSectionId: string;
  date: string;
  periodId: string | null;
  editable: boolean;
  rows: StudentAttendanceRowDto[];
}

export interface StudentAttendanceSummaryDto {
  workingDays: number;
  present: number;
  absent: number;
  late: number;
  leave: number;
  halfDay: number;
  percentage: number;
}

export interface AttendanceRegisterDto {
  classSectionId: string;
  month: string;
  days: string[];
  students: {
    studentId: string;
    rollNo: string | null;
    displayName: string;
    /** date → status code (P/A/L/LV/H) */
    marks: Record<string, StudentAttendanceStatus>;
    summary: StudentAttendanceSummaryDto;
  }[];
}

export interface OwnAttendanceDto {
  student: { id: string; displayName: string };
  month: string;
  days: { date: string; status: StudentAttendanceStatus }[];
  summary: StudentAttendanceSummaryDto;
  overall: StudentAttendanceSummaryDto;
}

export interface GradingScaleDto {
  id: string;
  institutionId: string;
  name: string;
  bands: GradeBand[];
  isDefault: boolean;
}

export interface ExamTermDto {
  id: string;
  institutionId: string;
  groupId: string | null;
  name: string;
  type: ExamTermType;
  academicYear: string;
  startDate: string | null;
  endDate: string | null;
  gradingScaleId: string | null;
  status: ExamTermStatus;
  publishedAt: string | null;
  institution?: RefDto | null;
  scheduleCount?: number;
  createdAt: string;
}

export interface ExamScheduleDto {
  id: string;
  termId: string;
  classSectionId: string;
  subjectId: string;
  examDate: string;
  startTime: string | null;
  endTime: string | null;
  room: string | null;
  maxMarks: number;
  passMarks: number;
  marksStatus: ExamMarksStatus;
  lockedAt: string | null;
  subject?: RefDto | null;
  classSection?: RefDto | null;
  term?: RefDto | null;
  marksEntered?: number;
}

export interface ExamMarkRowDto {
  studentId: string;
  rollNo: string | null;
  displayName: string;
  marks: number | null;
  isAbsent: boolean;
  remarks: string | null;
}

export interface ExamMarksSheetDto {
  schedule: ExamScheduleDto;
  editable: boolean;
  rows: ExamMarkRowDto[];
}

export interface ExamResultSubjectDto {
  subjectId: string;
  code: string;
  name: string;
  maxMarks: number;
  passMarks: number;
  marks: number | null;
  isAbsent: boolean;
  grade: string | null;
  passed: boolean;
}

export interface ExamResultDto {
  id: string;
  termId: string;
  studentId: string;
  classSectionId: string;
  totalMarks: number;
  maxTotal: number;
  percentage: number;
  grade: string | null;
  gpa: number | null;
  rank: number | null;
  passed: boolean;
  subjects: ExamResultSubjectDto[];
  publishedAt: string | null;
  student?: { id: string; displayName: string; rollNo: string | null; admissionNo: string };
  term?: RefDto & { type: ExamTermType; academicYear: string };
}

export interface OwnResultsDto {
  student: { id: string; displayName: string };
  results: ExamResultDto[];
  cgpa: number | null;
}
