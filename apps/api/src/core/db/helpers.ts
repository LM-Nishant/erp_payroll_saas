import { Prisma } from '@prisma/client';

/**
 * Runtime Prisma helpers for feature modules (which may only `import type` from
 * `@prisma/client`).
 */

/** Stores SQL NULL in a nullable Json column. */
export const DbNull = Prisma.DbNull;

/** True for a unique-constraint violation (P2002). */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
