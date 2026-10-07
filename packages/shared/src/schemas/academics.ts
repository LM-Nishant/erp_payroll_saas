import { z } from 'zod';
import { idSchema, paginationQuerySchema } from './common';
import { isoDateSchema } from './hr';

/*
 * Academics, timetable, student attendance & exams. All request schemas are `.strict()`.
 */

const text = (max: number) => z.string().trim().max(max);
const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, 'Use letters, digits, "-", "_" or "."');
const nameSchema = z.string().trim().min(1).max(200);
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');
const academicYearSchema = z
  .string()
  .regex(/^\d{4}(-\d{2,4})?$/, 'Use e.g. 2026-27')
  .max(9);

export const SUBJECT_TYPES = ['THEORY', 'PRACTICAL', 'ELECTIVE'] as const;
export const subjectTypeSchema = z.enum(SUBJECT_TYPES);
export type SubjectType = z.infer<typeof subjectTypeSchema>;

export const STUDENT_ATTENDANCE_STATUSES = [
  'PRESENT',
  'ABSENT',
  'LATE',
  'LEAVE',
  'HALF_DAY',
] as const;
export const studentAttendanceStatusSchema = z.enum(STUDENT_ATTENDANCE_STATUSES);
export type StudentAttendanceStatus = z.infer<typeof studentAttendanceStatusSchema>;

export const EXAM_TERM_TYPES = ['UNIT_TEST', 'MID_TERM', 'FINAL', 'OTHER'] as const;
export const examTermTypeSchema = z.enum(EXAM_TERM_TYPES);
export type ExamTermType = z.infer<typeof examTermTypeSchema>;

export const EXAM_TERM_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'MARKS_ENTRY',
  'RESULTS_COMPUTED',
  'PUBLISHED',
] as const;
export const examTermStatusSchema = z.enum(EXAM_TERM_STATUSES);
export type ExamTermStatus = z.infer<typeof examTermStatusSchema>;

export const EXAM_MARKS_STATUSES = ['OPEN', 'LOCKED'] as const;
export type ExamMarksStatus = (typeof EXAM_MARKS_STATUSES)[number];

/* ---------- Subjects & allocations ---------- */

export const createSubjectSchema = z
  .object({
    programId: idSchema,
    code: codeSchema,
    name: nameSchema,
    type: subjectTypeSchema.default('THEORY'),
    credits: z.number().min(0).max(99).nullish(),
    maxMarks: z.number().int().min(1).max(1000).default(100),
    passMarks: z.number().int().min(0).max(1000).default(35),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict()
  .refine((v) => v.passMarks <= v.maxMarks, {
    message: 'Pass marks cannot exceed max marks',
    path: ['passMarks'],
  });
export type CreateSubjectInput = z.infer<typeof createSubjectSchema>;

export const updateSubjectSchema = z
  .object({
    code: codeSchema.optional(),
    name: nameSchema.optional(),
    type: subjectTypeSchema.optional(),
    credits: z.number().min(0).max(99).nullish(),
    maxMarks: z.number().int().min(1).max(1000).optional(),
    passMarks: z.number().int().min(0).max(1000).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict();
export type UpdateSubjectInput = z.infer<typeof updateSubjectSchema>;

export const listSubjectsQuerySchema = paginationQuerySchema.extend({
  programId: idSchema.optional(),
  institutionId: idSchema.optional(),
  classSectionId: idSchema.optional(),
});
export type ListSubjectsQuery = z.infer<typeof listSubjectsQuerySchema>;

export const upsertAllocationSchema = z
  .object({ classSectionId: idSchema, subjectId: idSchema, teacherUserId: idSchema })
  .strict();
export type UpsertAllocationInput = z.infer<typeof upsertAllocationSchema>;

export const setClassTeacherSchema = z
  .object({ classSectionId: idSchema, teacherUserId: idSchema.nullable() })
  .strict();
export type SetClassTeacherInput = z.infer<typeof setClassTeacherSchema>;

export const listAllocationsQuerySchema = paginationQuerySchema.extend({
  classSectionId: idSchema.optional(),
  institutionId: idSchema.optional(),
  teacherUserId: idSchema.optional(),
});
export type ListAllocationsQuery = z.infer<typeof listAllocationsQuerySchema>;

export const teacherOptionsQuerySchema = z
  .object({ institutionId: idSchema, q: text(100).optional() })
  .strict();

/* ---------- Timetable ---------- */

export const bellPeriodInputSchema = z
  .object({
    seq: z.number().int().min(1).max(30),
    name: z.string().trim().min(1).max(64),
    startTime: timeSchema,
    endTime: timeSchema,
    isBreak: z.boolean().default(false),
  })
  .strict()
  .refine((v) => v.startTime < v.endTime, {
    message: 'End time must be after start time',
    path: ['endTime'],
  });

export const replaceBellScheduleSchema = z
  .object({ institutionId: idSchema, periods: z.array(bellPeriodInputSchema).min(1).max(30) })
  .strict()
  .refine((v) => new Set(v.periods.map((p) => p.seq)).size === v.periods.length, {
    message: 'Period sequence numbers must be unique',
    path: ['periods'],
  });
export type ReplaceBellScheduleInput = z.infer<typeof replaceBellScheduleSchema>;

export const dayOfWeekSchema = z.number().int().min(1).max(7);

export const timetableCellInputSchema = z
  .object({
    dayOfWeek: dayOfWeekSchema,
    periodId: idSchema,
    subjectId: idSchema,
    teacherUserId: idSchema.nullish(),
    room: text(64).nullish(),
  })
  .strict();
export type TimetableCellInput = z.infer<typeof timetableCellInputSchema>;

/** Replace the whole weekly timetable of a section (clash-checked against other sections). */
export const replaceTimetableSchema = z
  .object({
    entries: z.array(timetableCellInputSchema).max(7 * 30),
    /** Save even if teacher / room clashes are detected. */
    allowClashes: z.boolean().default(false),
  })
  .strict()
  .refine(
    (v) => new Set(v.entries.map((e) => `${e.dayOfWeek}:${e.periodId}`)).size === v.entries.length,
    { message: 'Duplicate day/period cell', path: ['entries'] },
  );
export type ReplaceTimetableInput = z.infer<typeof replaceTimetableSchema>;

export const createSubstitutionSchema = z
  .object({
    entryId: idSchema,
    date: isoDateSchema,
    substituteUserId: idSchema,
    reason: text(500).nullish(),
  })
  .strict();
export type CreateSubstitutionInput = z.infer<typeof createSubstitutionSchema>;

export const listSubstitutionsQuerySchema = z
  .object({ institutionId: idSchema.optional(), date: isoDateSchema.optional() })
  .strict();

export const teacherTimetableQuerySchema = z
  .object({ teacherUserId: idSchema.optional(), date: isoDateSchema.optional() })
  .strict();

/** `date` resolves substitutions for that day (and limits entries to its weekday). */
export const timetableViewQuerySchema = z
  .object({ date: isoDateSchema.optional(), studentId: idSchema.optional() })
  .strict();

export const institutionQuerySchema = z.object({ institutionId: idSchema }).strict();

/* ---------- Student attendance ---------- */

export const markStudentAttendanceSchema = z
  .object({
    classSectionId: idSchema,
    date: isoDateSchema,
    /** Omit / null for daily attendance; set for period-wise attendance. */
    periodId: idSchema.nullish(),
    records: z
      .array(
        z
          .object({
            studentId: idSchema,
            status: studentAttendanceStatusSchema,
            remarks: text(500).nullish(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
    /** Send absent notifications to guardians (default true). */
    notifyGuardians: z.boolean().default(true),
  })
  .strict();
export type MarkStudentAttendanceInput = z.infer<typeof markStudentAttendanceSchema>;

export const sectionAttendanceQuerySchema = z
  .object({
    classSectionId: idSchema,
    date: isoDateSchema,
    periodId: idSchema.optional(),
  })
  .strict();

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

export const attendanceRegisterQuerySchema = z
  .object({ classSectionId: idSchema, month: monthSchema })
  .strict();

export const ownAttendanceQuerySchema = z
  .object({ studentId: idSchema.optional(), month: monthSchema.optional() })
  .strict();

/* ---------- Exams ---------- */

export const gradeBandSchema = z
  .object({
    grade: z.string().trim().min(1).max(8),
    minPercent: z.number().min(0).max(100),
    points: z.number().min(0).max(10),
    isPass: z.boolean().default(true),
  })
  .strict();
export type GradeBand = z.infer<typeof gradeBandSchema>;

export const createGradingScaleSchema = z
  .object({
    institutionId: idSchema,
    name: z.string().trim().min(1).max(120),
    bands: z.array(gradeBandSchema).min(1).max(20),
    isDefault: z.boolean().default(false),
  })
  .strict()
  .refine((v) => new Set(v.bands.map((b) => b.grade)).size === v.bands.length, {
    message: 'Grades must be unique',
    path: ['bands'],
  });
export type CreateGradingScaleInput = z.infer<typeof createGradingScaleSchema>;

export const createExamTermSchema = z
  .object({
    institutionId: idSchema,
    name: z.string().trim().min(1).max(120),
    type: examTermTypeSchema.default('UNIT_TEST'),
    academicYear: academicYearSchema,
    startDate: isoDateSchema.nullish(),
    endDate: isoDateSchema.nullish(),
    gradingScaleId: idSchema.nullish(),
  })
  .strict();
export type CreateExamTermInput = z.infer<typeof createExamTermSchema>;

export const updateExamTermSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    type: examTermTypeSchema.optional(),
    startDate: isoDateSchema.nullish(),
    endDate: isoDateSchema.nullish(),
    gradingScaleId: idSchema.nullish(),
    status: z.enum(['DRAFT', 'SCHEDULED', 'MARKS_ENTRY']).optional(),
  })
  .strict();
export type UpdateExamTermInput = z.infer<typeof updateExamTermSchema>;

export const listExamTermsQuerySchema = paginationQuerySchema.extend({
  institutionId: idSchema.optional(),
  academicYear: academicYearSchema.optional(),
  status: examTermStatusSchema.optional(),
});
export type ListExamTermsQuery = z.infer<typeof listExamTermsQuerySchema>;

export const examScheduleInputSchema = z
  .object({
    classSectionId: idSchema,
    subjectId: idSchema,
    examDate: isoDateSchema,
    startTime: timeSchema.nullish(),
    endTime: timeSchema.nullish(),
    room: text(64).nullish(),
    /** Defaults to the subject's max / pass marks. */
    maxMarks: z.number().int().min(1).max(1000).optional(),
    passMarks: z.number().int().min(0).max(1000).optional(),
  })
  .strict();
export type ExamScheduleInput = z.infer<typeof examScheduleInputSchema>;

export const upsertExamSchedulesSchema = z
  .object({ schedules: z.array(examScheduleInputSchema).min(1).max(500) })
  .strict();
export type UpsertExamSchedulesInput = z.infer<typeof upsertExamSchedulesSchema>;

export const listExamSchedulesQuerySchema = z
  .object({
    classSectionId: idSchema.optional(),
    /** Only papers the current user may enter marks for. */
    mine: z.enum(['true', 'false']).optional(),
  })
  .strict();

export const enterMarksSchema = z
  .object({
    marks: z
      .array(
        z
          .object({
            studentId: idSchema,
            marks: z.number().min(0).max(1000).nullable(),
            isAbsent: z.boolean().default(false),
            remarks: text(500).nullish(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export type EnterMarksInput = z.infer<typeof enterMarksSchema>;

export const lockMarksSchema = z.object({ locked: z.boolean() }).strict();

export const listResultsQuerySchema = z.object({ classSectionId: idSchema.optional() }).strict();

export const computeResultsSchema = z.object({ classSectionId: idSchema.optional() }).strict();

export const listGradingScalesQuerySchema = z
  .object({ institutionId: idSchema.optional() })
  .strict();

export const ownResultsQuerySchema = z.object({ studentId: idSchema.optional() }).strict();
