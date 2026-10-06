import { createApp } from './app';
import { syncPermissionCatalog } from './core/authz';
import { env } from './core/config/env';
import { prisma } from './core/db/prisma';
import { logger } from './core/logger';
import { closeRedis } from './core/queue';

// Keep the DB permission catalog in sync with @erp/shared before serving requests.
await syncPermissionCatalog();

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, tenantResolver: env.TENANT_RESOLVER }, 'API listening');
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  server.close();
  await Promise.allSettled([prisma.$disconnect(), closeRedis()]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
