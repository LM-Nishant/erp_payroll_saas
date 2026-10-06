import { z } from 'zod';
import { codeSchema, idSchema, nameSchema, paginationQuerySchema } from './common';

/*
 * Request schemas are `.strict()`: unknown keys (including organizationId / tenant ids)
 * are rejected with a 400 so clients can never smuggle tenant identifiers into writes.
 */

export const institutionTypeSchema = z.enum(['SCHOOL', 'COLLEGE', 'UNIVERSITY', 'INSTITUTE']);
export type InstitutionType = z.infer<typeof institutionTypeSchema>;

export const statusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export type EntityStatus = z.infer<typeof statusSchema>;

const optionalText = (max: number) => z.string().trim().max(max).nullish();

// Groups
export const createGroupSchema = z
  .object({
    name: nameSchema,
    code: codeSchema,
    description: optionalText(1000),
    status: statusSchema.default('ACTIVE'),
  })
  .strict();
export const updateGroupSchema = createGroupSchema.partial().strict();
export const listGroupsQuerySchema = paginationQuerySchema.strict();
export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

// Institutions
export const createInstitutionSchema = z
  .object({
    groupId: idSchema.nullish(),
    name: nameSchema,
    code: codeSchema,
    type: institutionTypeSchema.default('COLLEGE'),
    status: statusSchema.default('ACTIVE'),
    email: z.string().trim().email().max(200).nullish(),
    phone: optionalText(32),
    address: optionalText(500),
  })
  .strict();
export const updateInstitutionSchema = createInstitutionSchema.partial().strict();
export const listInstitutionsQuerySchema = paginationQuerySchema
  .extend({
    groupId: idSchema.optional(),
    independent: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
  })
  .strict();
export type CreateInstitutionInput = z.infer<typeof createInstitutionSchema>;
export type UpdateInstitutionInput = z.infer<typeof updateInstitutionSchema>;

// Campuses
export const createCampusSchema = z
  .object({
    institutionId: idSchema,
    name: nameSchema,
    code: codeSchema,
    address: optionalText(500),
    isMain: z.boolean().default(false),
    status: statusSchema.default('ACTIVE'),
  })
  .strict();
export const updateCampusSchema = createCampusSchema
  .omit({ institutionId: true })
  .partial()
  .strict();
export const listCampusesQuerySchema = paginationQuerySchema
  .extend({ institutionId: idSchema.optional() })
  .strict();
export type CreateCampusInput = z.infer<typeof createCampusSchema>;
export type UpdateCampusInput = z.infer<typeof updateCampusSchema>;

// Departments
export const createDepartmentSchema = z
  .object({
    institutionId: idSchema,
    campusId: idSchema.nullish(),
    name: nameSchema,
    code: codeSchema,
    description: optionalText(1000),
    status: statusSchema.default('ACTIVE'),
  })
  .strict();
export const updateDepartmentSchema = createDepartmentSchema
  .omit({ institutionId: true })
  .partial()
  .strict();
export const listDepartmentsQuerySchema = paginationQuerySchema
  .extend({ institutionId: idSchema.optional(), campusId: idSchema.optional() })
  .strict();
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

// Programs
export const programLevelSchema = z.enum([
  'PRE_PRIMARY',
  'PRIMARY',
  'SECONDARY',
  'HIGHER_SECONDARY',
  'DIPLOMA',
  'UNDERGRADUATE',
  'POSTGRADUATE',
  'DOCTORATE',
  'CERTIFICATE',
  'OTHER',
]);
export type ProgramLevel = z.infer<typeof programLevelSchema>;

export const createProgramSchema = z
  .object({
    departmentId: idSchema,
    name: nameSchema,
    code: codeSchema,
    level: programLevelSchema.default('UNDERGRADUATE'),
    durationMonths: z.number().int().min(1).max(240).nullish(),
    status: statusSchema.default('ACTIVE'),
  })
  .strict();
export const updateProgramSchema = createProgramSchema
  .omit({ departmentId: true })
  .partial()
  .strict();
export const listProgramsQuerySchema = paginationQuerySchema
  .extend({ institutionId: idSchema.optional(), departmentId: idSchema.optional() })
  .strict();
export type CreateProgramInput = z.infer<typeof createProgramSchema>;
export type UpdateProgramInput = z.infer<typeof updateProgramSchema>;

// Class sections
export const createClassSectionSchema = z
  .object({
    programId: idSchema,
    campusId: idSchema.nullish(),
    name: nameSchema,
    code: codeSchema,
    academicYear: z
      .string()
      .trim()
      .regex(/^\d{4}(-\d{2,4})?$/, 'Expected e.g. 2025 or 2025-26')
      .nullish(),
    capacity: z.number().int().min(1).max(10000).nullish(),
    status: statusSchema.default('ACTIVE'),
  })
  .strict();
export const updateClassSectionSchema = createClassSectionSchema
  .omit({ programId: true })
  .partial()
  .strict();
export const listClassSectionsQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    departmentId: idSchema.optional(),
    programId: idSchema.optional(),
    campusId: idSchema.optional(),
    academicYear: z.string().trim().max(9).optional(),
  })
  .strict();
export type CreateClassSectionInput = z.infer<typeof createClassSectionSchema>;
export type UpdateClassSectionInput = z.infer<typeof updateClassSectionSchema>;
