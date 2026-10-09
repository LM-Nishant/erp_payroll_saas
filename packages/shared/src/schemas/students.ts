import { z } from 'zod';
import { idSchema, paginationQuerySchema } from './common';
import { isoDateSchema, genderSchema } from './hr';

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).nullish();
const phoneSchema = z
  .string()
  .trim()
  .max(32)
  .regex(/^[+0-9][0-9 ()-]{3,31}$/, 'Invalid phone number');
const emailSchema = z.string().trim().email().max(254);

export const STUDENT_STATUSES = ['ACTIVE', 'INACTIVE', 'GRADUATED', 'WITHDRAWN', 'ALUMNI'] as const;
export const studentStatusSchema = z.enum(STUDENT_STATUSES);
export type StudentStatus = z.infer<typeof studentStatusSchema>;

export const ENROLLMENT_STATUSES = [
  'ENROLLED',
  'PROMOTED',
  'DETAINED',
  'WITHDRAWN',
  'GRADUATED',
] as const;
export const enrollmentStatusSchema = z.enum(ENROLLMENT_STATUSES);
export type StudentEnrollmentStatus = z.infer<typeof enrollmentStatusSchema>;

export const GUARDIAN_RELATIONS = ['FATHER', 'MOTHER', 'GUARDIAN', 'OTHER'] as const;
export const guardianRelationSchema = z.enum(GUARDIAN_RELATIONS);
export type GuardianRelation = z.infer<typeof guardianRelationSchema>;

export const ADMISSION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'WAITLISTED',
  'ENROLLED',
] as const;
export const admissionStatusSchema = z.enum(ADMISSION_STATUSES);
export type AdmissionStatus = z.infer<typeof admissionStatusSchema>;

/**
 * Allowed admission status moves (shared so the UI only offers what the API accepts).
 * A rejection can be reopened back to review; ENROLLED is final.
 */
export const ADMISSION_TRANSITIONS: Record<AdmissionStatus, readonly AdmissionStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WAITLISTED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'WAITLISTED'],
  WAITLISTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED'],
  APPROVED: ['ENROLLED', 'REJECTED'],
  REJECTED: ['UNDER_REVIEW'],
  ENROLLED: [],
};

export const addressJsonSchema = z.record(z.string(), z.unknown()).nullish();

export const guardianInputSchema = z
  .object({
    id: idSchema.optional(),
    name: text(200).min(1).optional(),
    relation: guardianRelationSchema.default('GUARDIAN'),
    phone: phoneSchema.nullish(),
    email: emailSchema.nullish(),
    occupation: optionalText(120),
    isPrimary: z.boolean().default(false),
    canPickup: z.boolean().default(true),
  })
  .strict()
  .refine((v) => v.id || v.name, 'Provide guardian id or name');
export type GuardianInput = z.infer<typeof guardianInputSchema>;

export const createStudentSchema = z
  .object({
    admissionNo: text(40).min(1).optional(),
    rollNo: optionalText(40),
    userId: idSchema.nullish(),
    classSectionId: idSchema,
    academicYear: text(9).min(4),
    status: studentStatusSchema.default('ACTIVE'),
    firstName: text(100).min(1),
    middleName: optionalText(100),
    lastName: optionalText(100),
    dateOfBirth: isoDateSchema.nullish(),
    gender: genderSchema.nullish(),
    bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).nullish(),
    email: emailSchema.nullish(),
    phone: phoneSchema.nullish(),
    address: addressJsonSchema,
    admissionDate: isoDateSchema.nullish(),
    category: optionalText(64),
    quota: optionalText(64),
    previousSchool: optionalText(200),
    notes: optionalText(2000),
    guardians: z.array(guardianInputSchema).max(6).default([]),
  })
  .strict();
export type CreateStudentInput = z.infer<typeof createStudentSchema>;

export const updateStudentSchema = createStudentSchema
  .omit({ guardians: true, classSectionId: true, academicYear: true })
  .partial()
  .extend({
    classSectionId: idSchema.optional(),
    academicYear: text(9).min(4).optional(),
  })
  .strict();
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;

export const listStudentsQuerySchema = paginationQuerySchema
  .extend({
    groupId: idSchema.optional(),
    institutionId: idSchema.optional(),
    departmentId: idSchema.optional(),
    programId: idSchema.optional(),
    classSectionId: idSchema.optional(),
    academicYear: z.string().trim().max(9).optional(),
    status: studentStatusSchema.optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict();
export type ListStudentsQuery = z.infer<typeof listStudentsQuerySchema>;

export const addGuardianSchema = guardianInputSchema;
export type AddGuardianInput = z.infer<typeof addGuardianSchema>;

export const linkUserSchema = z.object({ userId: idSchema.nullable() }).strict();
export type LinkUserInput = z.infer<typeof linkUserSchema>;

export const promoteStudentsSchema = z
  .object({
    fromClassSectionId: idSchema,
    toClassSectionId: idSchema,
    academicYear: text(9).min(4),
    fromDate: isoDateSchema,
    studentIds: z.array(idSchema).optional(),
  })
  .strict();
export type PromoteStudentsInput = z.infer<typeof promoteStudentsSchema>;

export const lifecycleStudentSchema = z
  .object({ date: isoDateSchema, reason: optionalText(1000) })
  .strict();
export type LifecycleStudentInput = z.infer<typeof lifecycleStudentSchema>;

export const createAdmissionSchema = z
  .object({
    applicationNo: text(40).min(1).optional(),
    institutionId: idSchema,
    programId: idSchema,
    classSectionId: idSchema.nullish(),
    academicYear: text(9).min(4),
    status: admissionStatusSchema.default('SUBMITTED'),
    applicantFirstName: text(100).min(1),
    applicantMiddleName: optionalText(100),
    applicantLastName: optionalText(100),
    dateOfBirth: isoDateSchema.nullish(),
    gender: genderSchema.nullish(),
    email: emailSchema.nullish(),
    phone: phoneSchema.nullish(),
    previousSchool: optionalText(200),
    marksPercent: z.number().min(0).max(100).nullish(),
    guardianName: text(200).min(1),
    guardianRelation: guardianRelationSchema.default('GUARDIAN'),
    guardianPhone: phoneSchema.nullish(),
    guardianEmail: emailSchema.nullish(),
  })
  .strict();
export type CreateAdmissionInput = z.infer<typeof createAdmissionSchema>;

export const updateAdmissionSchema = createAdmissionSchema
  .partial()
  .omit({ applicationNo: true })
  .strict();
export type UpdateAdmissionInput = z.infer<typeof updateAdmissionSchema>;

export const listAdmissionsQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    programId: idSchema.optional(),
    classSectionId: idSchema.optional(),
    academicYear: z.string().trim().max(9).optional(),
    status: admissionStatusSchema.optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict();
export type ListAdmissionsQuery = z.infer<typeof listAdmissionsQuerySchema>;

export const transitionAdmissionSchema = z
  .object({
    status: z.enum(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WAITLISTED']),
    comment: optionalText(1000),
  })
  .strict();
export type TransitionAdmissionInput = z.infer<typeof transitionAdmissionSchema>;

export const enrollAdmissionSchema = z
  .object({
    classSectionId: idSchema.optional(),
    rollNo: optionalText(40),
    admissionDate: isoDateSchema.optional(),
  })
  .strict();
export type EnrollAdmissionInput = z.infer<typeof enrollAdmissionSchema>;
