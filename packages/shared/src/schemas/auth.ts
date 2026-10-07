import { z } from 'zod';
import { PERMISSION_CODE_PATTERN, SCOPE_TYPES } from '../auth/permissions';
import { PASSWORD_MAX_LENGTH } from '../auth/password-policy';
import { idSchema, nameSchema, paginationQuerySchema } from './common';

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
/** Length bound only; the full policy (incl. email check) is enforced by the API. */
export const passwordInputSchema = z.string().min(1).max(PASSWORD_MAX_LENGTH);
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'Invalid organization slug');

/**
 * `body` returns the refresh token in the JSON response (mobile/API clients).
 * `cookie` sets it as an httpOnly, SameSite=Strict cookie scoped to /api/v1/auth (web).
 */
export const tokenDeliverySchema = z.enum(['body', 'cookie']).default('body');
export type TokenDelivery = z.infer<typeof tokenDeliverySchema>;

const totpCodeSchema = z.string().regex(/^\d{6}$/, 'Code must be 6 digits');
const recoveryCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}$/, 'Invalid recovery code');
const opaqueTokenSchema = z.string().min(20).max(512);

export const loginSchema = z
  .object({
    email: emailSchema,
    password: passwordInputSchema,
    /** Organization to sign in to (validated against the user's memberships). */
    organization: slugSchema.optional(),
    tokenDelivery: tokenDeliverySchema,
    deviceName: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
export type LoginInput = z.infer<typeof loginSchema>;

export const mfaVerifySchema = z
  .object({
    mfaToken: opaqueTokenSchema,
    code: totpCodeSchema.optional(),
    recoveryCode: recoveryCodeSchema.optional(),
  })
  .strict()
  .refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), {
    message: 'Provide exactly one of code or recoveryCode',
  });
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

export const refreshSchema = z
  .object({ refreshToken: opaqueTokenSchema.optional(), tokenDelivery: tokenDeliverySchema })
  .strict();

export const logoutSchema = z.object({ refreshToken: opaqueTokenSchema.optional() }).strict();

export const mfaCodeSchema = z.object({ code: totpCodeSchema }).strict();
export const mfaDisableSchema = z
  .object({ password: passwordInputSchema, code: totpCodeSchema })
  .strict();

export const changePasswordSchema = z
  .object({ currentPassword: passwordInputSchema, newPassword: passwordInputSchema })
  .strict();

export const acceptInviteSchema = z
  .object({ token: opaqueTokenSchema, password: passwordInputSchema, name: nameSchema.optional() })
  .strict();

export const resetPasswordSchema = z
  .object({ token: opaqueTokenSchema, newPassword: passwordInputSchema })
  .strict();

// ---------------------------------------------------------------------------
// Users, roles & scopes
// ---------------------------------------------------------------------------

export const scopeTypeSchema = z.enum(SCOPE_TYPES);

/** A scope target. ORGANIZATION has no id; the others reference a hierarchy entity. */
export const scopeInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ORGANIZATION') }).strict(),
  z.object({ type: z.literal('GROUP'), id: idSchema }).strict(),
  z.object({ type: z.literal('INSTITUTION'), id: idSchema }).strict(),
  z.object({ type: z.literal('CAMPUS'), id: idSchema }).strict(),
  z.object({ type: z.literal('DEPARTMENT'), id: idSchema }).strict(),
]);
export type ScopeInput = z.infer<typeof scopeInputSchema>;

export const roleAssignmentSchema = z
  .object({ roleId: idSchema, scopes: z.array(scopeInputSchema).min(1).max(50) })
  .strict();
export type RoleAssignmentInput = z.infer<typeof roleAssignmentSchema>;

export const createUserSchema = z
  .object({
    email: emailSchema,
    name: nameSchema,
    /** Optional initial password. Without it an invite token is issued. */
    password: passwordInputSchema.optional(),
    roles: z.array(roleAssignmentSchema).max(20).default([]),
  })
  .strict();
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({ name: nameSchema }).partial().strict();
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const setUserRolesSchema = z
  .object({ roles: z.array(roleAssignmentSchema).max(20) })
  .strict();
export type SetUserRolesInput = z.infer<typeof setUserRolesSchema>;

export const membershipStatusSchema = z.enum(['INVITED', 'ACTIVE', 'DISABLED']);

export const listUsersQuerySchema = paginationQuerySchema
  .extend({ status: membershipStatusSchema.optional() })
  .strict();
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const permissionCodeSchema = z.string().regex(PERMISSION_CODE_PATTERN).max(100);

export const createRoleSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,63}$/, 'Key must be lower snake_case'),
    name: nameSchema,
    description: z.string().trim().max(1000).nullish(),
    permissions: z.array(permissionCodeSchema).max(500),
  })
  .strict();
export const updateRoleSchema = createRoleSchema.omit({ key: true }).partial().strict();
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

// ---------------------------------------------------------------------------
// Audit & platform
// ---------------------------------------------------------------------------

export const listAuditLogsQuerySchema = paginationQuerySchema
  .omit({ search: true })
  .extend({
    action: z.string().trim().min(1).max(100).optional(),
    entityType: z.string().trim().min(1).max(64).optional(),
    entityId: z.string().trim().min(1).max(64).optional(),
    actorUserId: idSchema.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict();
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;

export const platformAccessSchema = z
  .object({ reason: z.string().trim().min(10).max(500) })
  .strict();

export const listPlatformAuditLogsQuerySchema = listAuditLogsQuerySchema
  .extend({ organizationSlug: slugSchema.optional() })
  .strict();
