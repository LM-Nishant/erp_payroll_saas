import { z } from 'zod';

export const idSchema = z.string().uuid();

export const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Code may contain letters, digits, "-" and "_"');

export const nameSchema = z.string().trim().min(1).max(200);

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).max(100).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * Opt-in paging for list endpoints whose existing callers (pickers, setup screens) expect the full
 * list: rows are paged only when `page` or `pageSize` is sent; otherwise everything is returned.
 */
export const optionalPaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
export type OptionalPaginationQuery = z.infer<typeof optionalPaginationQuerySchema>;

export const idParamSchema = z.object({ id: idSchema });

/** Fields that are always derived server-side and must never be accepted from clients. */
export const SERVER_CONTROLLED_FIELDS = [
  'id',
  'organizationId',
  'tenantId',
  'createdAt',
  'updatedAt',
  'deletedAt',
] as const;
