import { z } from 'zod';
import { codeSchema, idSchema, nameSchema, paginationQuerySchema } from './common';
import { statusSchema } from './hierarchy';

/*
 * HR employee master (Layer 6). All request schemas are `.strict()`.
 *
 * Assignment fields (institution / campus / department / designation / reporting manager) of a
 * non-draft employee change ONLY through movements (effective-dated, workflow
 * `employee_transfer`) so history stays intact. Statutory ids and bank details are
 * "sensitive": encrypted at rest, masked in every response, revealed only via the audited
 * reveal endpoint (`employee.view_sensitive`).
 */

export const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).nullish();

export const EMPLOYMENT_TYPES = ['TEACHING', 'NON_TEACHING', 'CONTRACT', 'VISITING'] as const;
export const employmentTypeSchema = z.enum(EMPLOYMENT_TYPES);
export type EmploymentType = z.infer<typeof employmentTypeSchema>;

export const EMPLOYEE_STATUSES = ['DRAFT', 'ONBOARDING', 'ACTIVE', 'ON_NOTICE', 'EXITED'] as const;
export const employeeStatusSchema = z.enum(EMPLOYEE_STATUSES);
export type EmployeeStatus = z.infer<typeof employeeStatusSchema>;

export const EMPLOYEE_MOVEMENT_TYPES = [
  'TRANSFER',
  'PROMOTION',
  'DESIGNATION_CHANGE',
  'DEPARTMENT_CHANGE',
  'REPORTING_CHANGE',
  'REHIRE',
] as const;
export type EmployeeMovementType = (typeof EMPLOYEE_MOVEMENT_TYPES)[number];
/** Movement types a client can request (REHIRE is produced by the rehire lifecycle action). */
export const requestableMovementTypeSchema = z.enum([
  'TRANSFER',
  'PROMOTION',
  'DESIGNATION_CHANGE',
  'DEPARTMENT_CHANGE',
  'REPORTING_CHANGE',
]);

export const EMPLOYEE_MOVEMENT_STATUSES = [
  'PENDING_APPROVAL',
  'SCHEDULED',
  'APPLIED',
  'REJECTED',
  'CANCELLED',
] as const;
export type EmployeeMovementStatus = (typeof EMPLOYEE_MOVEMENT_STATUSES)[number];

export const EXIT_TYPES = [
  'RESIGNATION',
  'TERMINATION',
  'RETIREMENT',
  'CONTRACT_END',
  'DEATH',
  'OTHER',
] as const;
export const exitTypeSchema = z.enum(EXIT_TYPES);
export type ExitType = z.infer<typeof exitTypeSchema>;

export const genderSchema = z.enum(['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED']);
export const maritalStatusSchema = z.enum(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'OTHER']);

const phoneSchema = z
  .string()
  .trim()
  .max(32)
  .regex(/^[+0-9][0-9 ()-]{3,31}$/, 'Invalid phone number');

/* --------------------------------- Profile ---------------------------------------------- */

export const addressSchema = z
  .object({
    type: z.enum(['CURRENT', 'PERMANENT', 'OTHER']),
    line1: text(200).min(1),
    line2: optionalText(200),
    city: text(100).min(1),
    state: optionalText(100),
    postalCode: optionalText(20),
    country: text(100).min(1).default('India'),
  })
  .strict();

export const emergencyContactSchema = z
  .object({ name: nameSchema, relation: text(50).min(1), phone: phoneSchema })
  .strict();

export const familyMemberSchema = z
  .object({
    name: nameSchema,
    relation: text(50).min(1),
    dateOfBirth: isoDateSchema.nullish(),
    occupation: optionalText(100),
    dependent: z.boolean().default(false),
  })
  .strict();

export const qualificationSchema = z
  .object({
    degree: text(150).min(1),
    institution: text(200).min(1),
    year: z.number().int().min(1900).max(2200).nullish(),
    grade: optionalText(30),
    specialization: optionalText(150),
  })
  .strict();

export const experienceSchema = z
  .object({
    organization: text(200).min(1),
    role: text(150).min(1),
    from: isoDateSchema,
    to: isoDateSchema.nullish(),
    reasonForLeaving: optionalText(300),
  })
  .strict();

/** Personal (non-sensitive) profile fields. */
export const employeePersonalSchema = z
  .object({
    dateOfBirth: isoDateSchema.nullish(),
    gender: genderSchema.nullish(),
    maritalStatus: maritalStatusSchema.nullish(),
    bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).nullish(),
    nationality: optionalText(64),
    personalEmail: z.string().trim().email().max(254).nullish(),
    personalPhone: phoneSchema.nullish(),
    addresses: z.array(addressSchema).max(5).nullish(),
    emergencyContacts: z.array(emergencyContactSchema).max(5).nullish(),
    family: z.array(familyMemberSchema).max(20).nullish(),
    qualifications: z.array(qualificationSchema).max(20).nullish(),
    experience: z.array(experienceSchema).max(30).nullish(),
  })
  .strict();
export type EmployeePersonalInput = z.infer<typeof employeePersonalSchema>;

export const bankAccountSchema = z
  .object({
    accountHolderName: nameSchema,
    accountNumber: z
      .string()
      .trim()
      .regex(/^[0-9]{6,20}$/, 'Account number must be 6-20 digits'),
    ifsc: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC'),
    bankName: optionalText(120),
    branch: optionalText(120),
  })
  .strict();

/**
 * Statutory ids + bank details. Encrypted at rest; `null` clears a field, omitted keeps it.
 */
export const employeeSensitiveSchema = z
  .object({
    pan: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Invalid PAN')
      .nullish(),
    aadhaar: z
      .string()
      .trim()
      .regex(/^[0-9]{12}$/, 'Aadhaar must be 12 digits')
      .nullish(),
    uan: z
      .string()
      .trim()
      .regex(/^[0-9]{12}$/, 'UAN must be 12 digits')
      .nullish(),
    esicNumber: z
      .string()
      .trim()
      .regex(/^[0-9]{10,17}$/, 'ESIC number must be 10-17 digits')
      .nullish(),
    pfNumber: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9/]{5,30}$/, 'Invalid PF number')
      .nullish(),
    bankAccount: bankAccountSchema.nullish(),
  })
  .strict();
export type EmployeeSensitiveInput = z.infer<typeof employeeSensitiveSchema>;
export const SENSITIVE_FIELDS = [
  'pan',
  'aadhaar',
  'uan',
  'esicNumber',
  'pfNumber',
  'bankAccount',
] as const;

export const updateEmployeeProfileSchema = z
  .object({
    personal: employeePersonalSchema.optional(),
    sensitive: employeeSensitiveSchema.optional(),
  })
  .strict();
export type UpdateEmployeeProfileInput = z.infer<typeof updateEmployeeProfileSchema>;

/* --------------------------------- Employee --------------------------------------------- */

const employeeCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9][A-Za-z0-9/_-]*$/, 'Code may contain letters, digits, "/", "-" and "_"');

export const createEmployeeSchema = z
  .object({
    /** Omit to generate from the institution's numbering sequence. */
    employeeCode: employeeCodeSchema.optional(),
    institutionId: idSchema,
    campusId: idSchema.nullish(),
    departmentId: idSchema.nullish(),
    secondaryDepartmentIds: z.array(idSchema).max(10).optional(),
    designationId: idSchema.nullish(),
    reportingManagerId: idSchema.nullish(),
    userId: idSchema.nullish(),
    employmentType: employmentTypeSchema,
    /** New employees start as DRAFT (default) or ONBOARDING / ACTIVE directly. */
    status: z.enum(['DRAFT', 'ONBOARDING', 'ACTIVE']).default('DRAFT'),
    firstName: text(100).min(1),
    middleName: optionalText(100),
    lastName: optionalText(100),
    workEmail: z.string().trim().email().max(254).nullish(),
    workPhone: phoneSchema.nullish(),
    dateOfJoining: isoDateSchema.nullish(),
    probationEndDate: isoDateSchema.nullish(),
    noticePeriodDays: z.number().int().min(0).max(365).nullish(),
    personal: employeePersonalSchema.optional(),
    sensitive: employeeSensitiveSchema.optional(),
  })
  .strict();
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

/**
 * Updates of core fields. Assignment fields are accepted ONLY while the employee is DRAFT;
 * afterwards use movements (`POST /employees/:id/movements`).
 */
export const updateEmployeeSchema = z
  .object({
    employeeCode: employeeCodeSchema.optional(),
    institutionId: idSchema.optional(),
    campusId: idSchema.nullish(),
    departmentId: idSchema.nullish(),
    secondaryDepartmentIds: z.array(idSchema).max(10).optional(),
    designationId: idSchema.nullish(),
    reportingManagerId: idSchema.nullish(),
    userId: idSchema.nullish(),
    employmentType: employmentTypeSchema.optional(),
    firstName: text(100).min(1).optional(),
    middleName: optionalText(100),
    lastName: optionalText(100),
    workEmail: z.string().trim().email().max(254).nullish(),
    workPhone: phoneSchema.nullish(),
    dateOfJoining: isoDateSchema.nullish(),
    probationEndDate: isoDateSchema.nullish(),
    noticePeriodDays: z.number().int().min(0).max(365).nullish(),
  })
  .strict();
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const listEmployeesQuerySchema = paginationQuerySchema
  .extend({
    groupId: idSchema.optional(),
    institutionId: idSchema.optional(),
    campusId: idSchema.optional(),
    departmentId: idSchema.optional(),
    designationId: idSchema.optional(),
    status: employeeStatusSchema.optional(),
    employmentType: employmentTypeSchema.optional(),
  })
  .strict();
export type ListEmployeesQuery = z.infer<typeof listEmployeesQuerySchema>;
export const exportEmployeesQuerySchema = listEmployeesQuerySchema
  .omit({ page: true, pageSize: true })
  .strict();

/* --------------------------------- Movements -------------------------------------------- */

export const createEmployeeMovementSchema = z
  .object({
    type: requestableMovementTypeSchema,
    effectiveDate: isoDateSchema,
    toInstitutionId: idSchema.optional(),
    toCampusId: idSchema.nullish(),
    toDepartmentId: idSchema.nullish(),
    toDesignationId: idSchema.nullish(),
    toReportingManagerId: idSchema.nullish(),
    reason: text(1000).min(1),
  })
  .strict();
export type CreateEmployeeMovementInput = z.infer<typeof createEmployeeMovementSchema>;

/* --------------------------------- Salary history --------------------------------------- */

export const createSalaryRevisionSchema = z
  .object({
    effectiveFrom: isoDateSchema,
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .default('INR'),
    annualCtc: z.number().nonnegative().max(1_000_000_000_000),
    /** Monthly component amounts, e.g. `{ "basic": 30000, "hra": 12000 }`. */
    amounts: z
      .record(
        z
          .string()
          .trim()
          .regex(/^[a-z][a-z0-9_]{0,49}$/),
        z.number().nonnegative(),
      )
      .default({}),
    /** Layer 8 payroll salary-structure reference (nullable placeholder until then). */
    salaryStructureId: z.string().trim().min(1).max(64).nullish(),
    revisionReason: text(500).min(1),
  })
  .strict();
export type CreateSalaryRevisionInput = z.infer<typeof createSalaryRevisionSchema>;

/* --------------------------------- Lifecycle -------------------------------------------- */

export const onboardEmployeeSchema = z.object({ dateOfJoining: isoDateSchema.optional() }).strict();
export const activateEmployeeSchema = z
  .object({
    dateOfJoining: isoDateSchema.optional(),
    probationEndDate: isoDateSchema.nullish(),
  })
  .strict();
export const confirmEmployeeSchema = z.object({ confirmationDate: isoDateSchema }).strict();
export const resignEmployeeSchema = z
  .object({
    resignationDate: isoDateSchema,
    lastWorkingDate: isoDateSchema,
    reason: text(1000).min(1),
  })
  .strict()
  .refine((v) => v.lastWorkingDate >= v.resignationDate, {
    message: 'lastWorkingDate must not be before resignationDate',
    path: ['lastWorkingDate'],
  });
export const withdrawResignationSchema = z.object({ reason: optionalText(1000) }).strict();
export const exitEmployeeSchema = z
  .object({
    exitDate: isoDateSchema,
    exitType: exitTypeSchema,
    reason: optionalText(1000),
    /** Exit even though exit-checklist items are still pending. */
    force: z.boolean().default(false),
  })
  .strict();
export const rehireEmployeeSchema = z
  .object({
    dateOfJoining: isoDateSchema,
    institutionId: idSchema.optional(),
    campusId: idSchema.nullish(),
    departmentId: idSchema.nullish(),
    designationId: idSchema.nullish(),
    reportingManagerId: idSchema.nullish(),
    employmentType: employmentTypeSchema.optional(),
    reason: optionalText(1000),
  })
  .strict();
export type ResignEmployeeInput = z.infer<typeof resignEmployeeSchema>;
export type ExitEmployeeInput = z.infer<typeof exitEmployeeSchema>;
export type RehireEmployeeInput = z.infer<typeof rehireEmployeeSchema>;

export const EMPLOYEE_CHECKLIST_KINDS = ['ONBOARDING', 'EXIT'] as const;
export const checklistKindSchema = z.enum(EMPLOYEE_CHECKLIST_KINDS);
export const checklistStatusSchema = z.enum(['PENDING', 'DONE', 'WAIVED']);
export const createChecklistItemSchema = z
  .object({ kind: checklistKindSchema, title: text(200).min(1) })
  .strict();
export const updateChecklistItemSchema = z
  .object({ status: checklistStatusSchema, notes: optionalText(1000) })
  .strict();

/* --------------------------------- Letters ---------------------------------------------- */

export const EMPLOYEE_LETTER_TYPES = ['offer', 'experience', 'relieving'] as const;
export const employeeLetterSchema = z
  .object({
    type: z.enum(EMPLOYEE_LETTER_TYPES),
    /** Letter date (defaults to today). */
    date: isoDateSchema.optional(),
    /** Offer letter: annual CTC (defaults to the latest salary revision). */
    annualCtc: z.number().nonnegative().optional(),
    /** Offer letter: response deadline. */
    acceptBy: isoDateSchema.optional(),
    signatoryName: text(200).min(1).optional(),
    signatoryTitle: text(200).min(1).optional(),
    remarks: optionalText(1000),
  })
  .strict();
export type EmployeeLetterInput = z.infer<typeof employeeLetterSchema>;

/* --------------------------------- Designations / numbering ----------------------------- */

export const createDesignationSchema = z
  .object({
    code: codeSchema,
    name: nameSchema,
    groupId: idSchema.nullish(),
    institutionId: idSchema.nullish(),
    category: employmentTypeSchema.nullish(),
    level: z.number().int().min(0).max(100).nullish(),
    description: optionalText(1000),
    status: statusSchema.default('ACTIVE'),
  })
  .strict();
export const updateDesignationSchema = createDesignationSchema
  .omit({ groupId: true, institutionId: true })
  .partial()
  .strict();
export const listDesignationsQuerySchema = paginationQuerySchema
  .extend({ institutionId: idSchema.optional(), status: statusSchema.optional() })
  .strict();
export type CreateDesignationInput = z.infer<typeof createDesignationSchema>;
export type UpdateDesignationInput = z.infer<typeof updateDesignationSchema>;

/** Employee code numbering for one institution (or the org default when null). */
export const upsertEmployeeCodeSequenceSchema = z
  .object({
    institutionId: idSchema.nullable(),
    prefix: z
      .string()
      .trim()
      .max(20)
      .regex(/^[A-Za-z0-9/_-]*$/, 'Prefix may contain letters, digits, "/", "-" and "_"'),
    padding: z.number().int().min(1).max(10).default(4),
    nextNumber: z.number().int().min(1).max(999_999_999).optional(),
  })
  .strict();
export type UpsertEmployeeCodeSequenceInput = z.infer<typeof upsertEmployeeCodeSequenceSchema>;

/* --------------------------------- Self-service ----------------------------------------- */

/** Personal fields an employee may change about themselves (via `employee_profile_change`). */
export const SELF_SERVICE_PROFILE_FIELDS = [
  'maritalStatus',
  'bloodGroup',
  'personalEmail',
  'personalPhone',
  'addresses',
  'emergencyContacts',
  'family',
  'qualifications',
] as const;
export const selfServiceChangesSchema = employeePersonalSchema
  .pick({
    maritalStatus: true,
    bloodGroup: true,
    personalEmail: true,
    personalPhone: true,
    addresses: true,
    emergencyContacts: true,
    family: true,
    qualifications: true,
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'At least one change is required');
export const createProfileChangeRequestSchema = z
  .object({ changes: selfServiceChangesSchema, reason: optionalText(1000) })
  .strict();
export type CreateProfileChangeRequestInput = z.infer<typeof createProfileChangeRequestSchema>;

/* --------------------------------- Import ----------------------------------------------- */

export const EMPLOYEE_IMPORT_COLUMNS = [
  'employeeCode',
  'firstName',
  'middleName',
  'lastName',
  'institutionCode',
  'campusCode',
  'departmentCode',
  'designationCode',
  'employmentType',
  'status',
  'workEmail',
  'workPhone',
  'dateOfJoining',
  'dateOfBirth',
  'gender',
  'personalEmail',
  'personalPhone',
  'pan',
  'aadhaar',
  'uan',
  'reportingManagerCode',
] as const;
export const employeeImportOptionsSchema = z
  .object({
    dryRun: z
      .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
      .default(false),
  })
  .strict();

/* --------------------------------- Route params / misc ---------------------------------- */

export const revealEmployeeSensitiveSchema = z.object({ reason: optionalText(500) }).strict();
export const employeeMovementParamsSchema = z
  .object({ id: idSchema, movementId: idSchema })
  .strict();
export const employeeChecklistParamsSchema = z.object({ id: idSchema, itemId: idSchema }).strict();
export const employeeImportJobParamsSchema = z.object({ jobId: idSchema }).strict();
