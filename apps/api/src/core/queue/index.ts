import { Queue, type QueueOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env';

/*
 * Redis + BullMQ wiring (configuration only in Layer 1; queues are used by later layers).
 * Convention: every job payload MUST include `organizationId`, and workers MUST wrap
 * processing in `runWithTenant({ organizationId, source: 'system' }, ...)`.
 */

let connection: Redis | undefined;

export function getRedisConnection(): Redis {
  connection ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  return connection;
}

export interface TenantJobData {
  organizationId: string;
}

export function createQueue<T extends TenantJobData>(
  name: string,
  options: Partial<QueueOptions> = {},
): Queue<T> {
  return new Queue<T>(name, {
    connection: getRedisConnection(),
    prefix: env.QUEUE_PREFIX,
    ...options,
  });
}

export async function closeRedis(): Promise<void> {
  if (connection) {
    await connection.quit();
    connection = undefined;
  }
}
