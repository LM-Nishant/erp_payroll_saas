import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { logger } from '../logger';
import { bullEnqueue, closeBullQueue } from './bullmq-driver';
import { inlineDriver } from './inline-driver';
import { getRecurringJob, listRecurringJobs, type TenantJobData } from './registry';
import { runDetached } from './runner';
import { closeRedis as closeRedisConnection } from './redis';

/*
 * Background jobs (core/queue).
 *
 *   const sendJob = defineJob<{ organizationId: string; logId: string }>({
 *     name: 'communication.send', attempts: 5, backoffMs: 5000,
 *     handler: async ({ logId }) => { ... },   // runs in runWithTenant + system principal
 *   });
 *   await enqueue('communication.send', { organizationId, logId }, { delayMs: 0 });
 *
 * Drivers: `bullmq` (Redis, processed by `src/worker.ts`) or `inline` (in-process; tests).
 * Recurring jobs (`defineRecurringJob`) run platform-level and fan out per tenant with
 * `forEachActiveOrganization` + `enqueue`.
 */

export * from './registry';
export { getRedisConnection } from './redis';
export { runAsSystem, runDetached } from './runner';

export interface EnqueueOptions {
  delayMs?: number;
  /** Idempotency key: a job with the same id is not added twice. */
  jobId?: string;
}

export async function enqueue<T extends TenantJobData>(
  name: string,
  data: T,
  options: EnqueueOptions = {},
): Promise<string> {
  if (!data.organizationId) throw new Error(`Job ${name} requires organizationId`);
  if (env.QUEUE_DRIVER === 'inline') {
    return inlineDriver.add(name, data, options.delayMs, options.jobId);
  }
  return bullEnqueue(name, data, options.delayMs, options.jobId);
}

/** Inline driver only: wait until queued (and optionally delayed/retry) jobs have run. */
export async function drainJobs(options: { includeDelayed?: boolean } = {}): Promise<void> {
  if (env.QUEUE_DRIVER === 'inline') await inlineDriver.drain(options);
}

/** Inline driver introspection for tests. */
export const inlineQueue = inlineDriver;

/** Run a recurring job's handler now (tests, admin tooling). */
export async function runRecurringJobNow(name: string): Promise<void> {
  const def = getRecurringJob(name);
  if (!def) throw new Error(`Unknown recurring job ${name}`);
  await runDetached(def.handler);
}

/** Iterate non-deleted, active organizations (platform-level, for recurring fan-out). */
export async function forEachActiveOrganization(
  fn: (organizationId: string) => Promise<void>,
): Promise<void> {
  const orgs = await prisma.organization.findMany({
    where: { deletedAt: null, status: 'ACTIVE' },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  for (const org of orgs) {
    try {
      await fn(org.id);
    } catch (err) {
      logger.error({ organizationId: org.id, err: (err as Error).message }, 'Fan-out failed');
    }
  }
}

let inlineTimers: NodeJS.Timeout[] = [];

/** Inline driver: run recurring jobs on in-process intervals (dev without Redis). */
export function startInlineScheduler(): void {
  for (const def of listRecurringJobs()) {
    const every = def.everyMs ?? 60 * 60 * 1000;
    const timer = setInterval(() => {
      runDetached(def.handler).catch((err: Error) =>
        logger.error({ job: def.name, err: err.message }, 'Recurring job failed'),
      );
    }, every);
    timer.unref();
    inlineTimers.push(timer);
  }
}

export async function closeQueue(): Promise<void> {
  inlineTimers.forEach(clearInterval);
  inlineTimers = [];
  await closeBullQueue();
  await closeRedisConnection();
}

/** @deprecated use closeQueue (kept for Layer 1 callers). */
export const closeRedis = closeQueue;
