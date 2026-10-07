import { z } from 'zod';
import { emailSchema, slugSchema } from './auth';
import { idSchema, nameSchema, paginationQuerySchema } from './common';

export const ORGANIZATION_STATUSES = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];
export const organizationStatusSchema = z.enum(ORGANIZATION_STATUSES);

/** EDUCATION shows school/college menus and labels; COMPANY uses corporate terminology. */
export const ORGANIZATION_KINDS = ['EDUCATION', 'COMPANY'] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];
export const organizationKindSchema = z.enum(ORGANIZATION_KINDS);

/** Tenant roles a platform admin may grant to an organization's first owner. */
export const ORGANIZATION_OWNER_ROLES = ['group_owner', 'institution_owner'] as const;

const platformReason = z.string().trim().min(10).max(500);

/** An organization-wide owner (invited by e-mail; the token is never returned). */
export const inviteOrganizationOwnerSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    role: z.enum(ORGANIZATION_OWNER_ROLES).default('group_owner'),
  })
  .strict();
export type InviteOrganizationOwnerInput = z.infer<typeof inviteOrganizationOwnerSchema>;

/**
 * Platform: onboard a new organization (tenant). Creates the organization, its default roles,
 * its subscription and invites the first owner (organization-wide scope).
 */
export const createOrganizationSchema = z
  .object({
    name: nameSchema,
    slug: slugSchema,
    kind: organizationKindSchema.default('EDUCATION'),
    planId: idSchema,
    subscriptionStatus: z.enum(['TRIAL', 'ACTIVE']).default('TRIAL'),
    owner: inviteOrganizationOwnerSchema,
  })
  .strict();
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z
  .object({ name: nameSchema, kind: organizationKindSchema.optional(), reason: platformReason })
  .strict();
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

/** Suspended / archived organizations reject every tenant-scoped request (TENANT_INACTIVE). */
export const setOrganizationStatusSchema = z
  .object({ status: organizationStatusSchema, reason: platformReason })
  .strict();
export type SetOrganizationStatusInput = z.infer<typeof setOrganizationStatusSchema>;

export const listOrganizationsQuerySchema = paginationQuerySchema
  .extend({ status: organizationStatusSchema.optional() })
  .strict();
export type ListOrganizationsQuery = z.infer<typeof listOrganizationsQuerySchema>;

export interface PlatformOrganizationDto {
  id: string;
  slug: string;
  name: string;
  status: OrganizationStatus;
  kind: OrganizationKind;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformOrganizationDetailDto extends PlatformOrganizationDto {
  counts: { groups: number; institutions: number; users: number; employees: number };
  owners: Array<{ id: string; name: string; email: string; membershipStatus: string }>;
}

export interface CreatedOrganizationDto extends PlatformOrganizationDto {
  owner: { id: string; email: string; inviteDeliveryStatus: string | null };
}
