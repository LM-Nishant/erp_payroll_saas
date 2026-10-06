import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';
import { logger } from '../logger';

/**
 * Base (UNSCOPED) Prisma client.
 *
 * Only `src/core/**` and platform-level code may import this directly. Feature modules
 * must use `tenantDb()` from `core/tenancy`, which enforces organization isolation.
 * This is enforced by ESLint (`no-restricted-imports`).
 */
export const prisma = new PrismaClient({
  datasourceUrl: env.DATABASE_URL,
  log: [
    { level: 'warn', emit: 'event' },
    { level: 'error', emit: 'event' },
  ],
});

prisma.$on('warn', (e) => logger.warn({ prisma: e }, 'prisma warning'));
prisma.$on('error', (e) => logger.error({ prisma: e }, 'prisma error'));

export type BasePrismaClient = typeof prisma;
