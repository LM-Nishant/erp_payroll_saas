/**
 * Registry of Prisma models and how the tenancy engine treats them.
 *
 * EVERY model with an `organizationId` column MUST be listed in TENANT_SCOPED_MODELS.
 * A unit test (tenant-models.test.ts) fails the build if a model is missing.
 */

/** Models owned by a tenant: all queries are filtered by organization_id. */
export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set([
  'Group',
  'Institution',
  'Campus',
  'Department',
  'Program',
  'ClassSection',
]);

/** Models with a `deletedAt` column whose soft-deleted rows are hidden by default. */
export const SOFT_DELETE_MODELS: ReadonlySet<string> = new Set([
  'Organization',
  'Group',
  'Institution',
  'Campus',
  'Department',
  'Program',
  'ClassSection',
]);

/** The tenant root. Through the tenant client it is read-only and limited to the current org. */
export const TENANT_ROOT_MODEL = 'Organization';

/** Models that are platform-global (not tenant data). Must be listed explicitly. */
export const GLOBAL_MODELS: ReadonlySet<string> = new Set([TENANT_ROOT_MODEL]);
