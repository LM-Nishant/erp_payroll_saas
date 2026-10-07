import { Queue, Worker, type Job } from 'bullmq';
import { env } from '../config/env';
import { logger } from '../logger';
import { getRedisConnection } from './redis';
import {
  DEFAULT_ATTEMPTS,
  DEFAULT_BACKOFF_MS,
  getJob,
  getRecurringJob,
  listRecurringJobs,
  type TenantJobData,
} from './registry';
import { runDetached, runJobInTenant } from './runner';

/** One shared BullMQ queue; the job NAME selects the processor. */
export const QUEUE_NAME = 'jobs';
const RECURRING_PREFIX = 'recurring:';

let queue: Queue | undefined;

export function getBullQueue(): Queue {
  queue ??= new Queue(QUEUE_NAME, { connection: getRedisConnection(), prefix: env.QUEUE_PREFIX });
  return queue;
}

export async function bullEnqueue(
  name: string,
  data: TenantJobData,
  delayMs = 0,
  jobId?: string,
): Promise<string> {
  const def = getJob(name);
  const job = await getBullQueue().add(name, data, {
    attempts: def?.attempts ?? DEFAULT_ATTEMPTS,
    backoff: { type: 'exponential', delay: def?.backoffMs ?? DEFAULT_BACKOFF_MS },
    delay: delayMs > 0 ? delayMs : undefined,
    jobId,
    removeOnComplete: { count: 1000, age: 24 * 3600 },
    removeOnFail: { count: 5000, age: 7 * 24 * 3600 },
  });
  return job.id ?? '';
}

async function process(job: Job): Promise<void> {
  if (job.name.startsWith(RECURRING_PREFIX)) {
    const def = getRecurringJob(job.name.slice(RECURRING_PREFIX.length));
    if (!def) throw new Error(`Unknown recurring job ${job.name}`);
    await runDetached(def.handler);
    return;
  }
  const def = getJob(job.name);
  if (!def) throw new Error(`Unknown job ${job.name}`);
  await runJobInTenant(def, job.data as TenantJobData, {
    jobId: job.id ?? '',
    attempt: job.attemptsMade + 1,
    maxAttempts: job.opts.attempts ?? DEFAULT_ATTEMPTS,
  });
}

/** Register recurring jobs with BullMQ's job schedulers (idempotent upsert). */
export async function registerBullSchedulers(): Promise<void> {
  const q = getBullQueue();
  for (const def of listRecurringJobs()) {
    await q.upsertJobScheduler(
      `${RECURRING_PREFIX}${def.name}`,
      def.pattern ? { pattern: def.pattern } : { every: def.everyMs! },
      { name: `${RECURRING_PREFIX}${def.name}`, data: {}, opts: { attempts: 1 } },
    );
  }
}

export function startBullWorker(): Worker {
  const worker = new Worker(QUEUE_NAME, process, {
    connection: getRedisConnection(),
    prefix: env.QUEUE_PREFIX,
    concurrency: env.QUEUE_CONCURRENCY,
  });
  worker.on('failed', (job, err) => {
    logger.warn(
      { job: job?.name, id: job?.id, attempt: job?.attemptsMade, err: err.message },
      'Job failed',
    );
  });
  worker.on('error', (err) => logger.error({ err: err.message }, 'Worker error'));
  return worker;
}

export async function closeBullQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}
