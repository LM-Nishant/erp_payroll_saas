import { Redis } from 'ioredis';
import { env } from '../config/env';

let connection: Redis | undefined;

/** Shared ioredis connection (BullMQ, Redis rate-limit store). Lazily connects. */
export function getRedisConnection(): Redis {
  connection ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  return connection;
}

export async function closeRedis(): Promise<void> {
  if (connection) {
    const c = connection;
    connection = undefined;
    await c.quit().catch(() => c.disconnect());
  }
}
