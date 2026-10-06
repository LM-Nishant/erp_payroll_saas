import { prisma } from '../src/core/db/prisma';
import { logger } from '../src/core/logger';
import { seedDemoData } from './seed-data';

seedDemoData(prisma)
  .then((ids) => logger.info({ organizations: ids }, 'Seed complete'))
  .catch((err: unknown) => {
    logger.error({ err }, 'Seed failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
