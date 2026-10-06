import './engines';
import { syncPermissionCatalog } from './core/authz';
import { env } from './core/config/env';
import { prisma } from './core/db/prisma';
import { logger } from './core/logger';
import { closeQueue, startInlineScheduler } from './core/queue';
import { registerBullSchedulers, startBullWorker } from './core/queue/bullmq-driver';

/*
 * Background worker: processes queued jobs (BullMQ) and owns the recurring-job schedulers.
 * Run alongside the API: `pnpm --filter @erp/api worker` (dev) / `start:worker` (built).
 */

await syncPermissionCatalog();

let stop: () => Promise<void>;
if (env.QUEUE_DRIVER === 'bullmq') {
  await registerBullSchedulers();
  const worker = startBullWorker();
  logger.info('Worker started (bullmq)');
  stop = async () => {
    await worker.close();
  };
} else {
  // Inline driver: jobs run inside the process that enqueues them; only recurring jobs here.
  startInlineScheduler();
  logger.info('Worker started (inline scheduler only)');
  stop = async () => undefined;
}

async function shutdown(signal: string) {
  logger.info({ signal }, 'Worker shutting down');
  await stop();
  await Promise.allSettled([closeQueue(), prisma.$disconnect()]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
