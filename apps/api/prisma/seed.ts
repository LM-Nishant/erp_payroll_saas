import { env } from '../src/core/config/env';
import { prisma } from '../src/core/db/prisma';
import { logger } from '../src/core/logger';
import { DEV_DEMO_PASSWORD, seedAccessControl } from './seed-access';
import { seedDemoData } from './seed-data';

async function main() {
  const organizations = await seedDemoData(prisma);
  const password = process.env.SEED_DEMO_PASSWORD ?? DEV_DEMO_PASSWORD;
  if (env.NODE_ENV === 'production' && password === DEV_DEMO_PASSWORD) {
    throw new Error('Set SEED_DEMO_PASSWORD to seed demo users in production');
  }
  const users = await seedAccessControl(prisma, organizations, { password });
  logger.info({ organizations, users: Object.keys(users) }, 'Seed complete');
}

main()
  .catch((err: unknown) => {
    logger.error({ err }, 'Seed failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
