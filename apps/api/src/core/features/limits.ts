import { LIMITS, LIMIT_KEYS, type LimitKey, type LimitUsageDto } from '@erp/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { AppError } from '../http/errors';
import { logger } from '../logger';
import { currentOrganizationId } from '../tenancy/context';
import { loadLicense } from './license';
import { limitValue, periodKeyFor } from './resolve';

/** Thrown when an operation would exceed a plan limit. */
export class LimitExceededError extends AppError {
  constructor(key: LimitKey, details: { limit: number; used: number; requested: number }) {
    super(403, 'LIMIT_EXCEEDED', `Plan limit reached for "${LIMITS[key].label}"`, {
      limitKey: key,
      ...details,
    });
  }
}

export interface LimitOptions {
  /** Defaults to the current tenant. */
  organizationId?: string;
  now?: Date;
}

const orgOf = (o?: LimitOptions) => o?.organizationId ?? currentOrganizationId();

async function readUsed(organizationId: string, key: LimitKey, periodKey: string) {
  const row = await prisma.usageCounter.findUnique({
    where: { organizationId_limitKey_periodKey: { organizationId, limitKey: key, periodKey } },
    select: { used: true },
  });
  return Number(row?.used ?? 0n);
}

async function ensureCounter(organizationId: string, key: LimitKey, periodKey: string) {
  try {
    await prisma.usageCounter.upsert({
      where: { organizationId_limitKey_periodKey: { organizationId, limitKey: key, periodKey } },
      create: { organizationId, limitKey: key, periodKey, used: 0n },
      update: {},
    });
  } catch (err) {
    // Concurrent creation of the same counter: the row exists now, which is all we need.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
  }
}

/** Current limit and usage. */
export async function getLimitUsage(key: LimitKey, options?: LimitOptions): Promise<LimitUsageDto> {
  const organizationId = orgOf(options);
  const license = await loadLicense(organizationId);
  return {
    key,
    period: LIMITS[key].period,
    limit: limitValue(license.limits, key),
    used: await readUsed(organizationId, key, periodKeyFor(key, options?.now)),
  };
}

export const getAllLimitUsage = (options?: LimitOptions) =>
  Promise.all(LIMIT_KEYS.map((k) => getLimitUsage(k, options)));

/** Throws 403 LIMIT_EXCEEDED if `delta` more units would exceed the limit (no reservation). */
export async function assertWithinLimit(key: LimitKey, delta = 1, options?: LimitOptions) {
  const { limit, used } = await getLimitUsage(key, options);
  if (limit !== null && used + delta > limit) {
    throw new LimitExceededError(key, { limit, used, requested: delta });
  }
}

/**
 * Atomically reserve `delta` units (check + increment in ONE conditional UPDATE, so concurrent
 * requests cannot overshoot). Throws 403 LIMIT_EXCEEDED when the limit would be exceeded.
 */
export async function consumeLimit(key: LimitKey, delta = 1, options?: LimitOptions) {
  if (!Number.isInteger(delta) || delta < 0) throw new Error('delta must be a positive integer');
  const organizationId = orgOf(options);
  const periodKey = periodKeyFor(key, options?.now);
  const limit = limitValue((await loadLicense(organizationId)).limits, key);
  await ensureCounter(organizationId, key, periodKey);
  const where = { organizationId, limitKey: key, periodKey };
  const { count } = await prisma.usageCounter.updateMany({
    where: limit === null ? where : { ...where, used: { lte: BigInt(limit - delta) } },
    data: { used: { increment: BigInt(delta) } },
  });
  if (count === 0) {
    throw new LimitExceededError(key, {
      limit: limit ?? 0,
      used: await readUsed(organizationId, key, periodKey),
      requested: delta,
    });
  }
}

/** Give back `delta` units (deletes, failed operations). Never goes below 0. */
export async function releaseLimit(key: LimitKey, delta = 1, options?: LimitOptions) {
  const organizationId = orgOf(options);
  const periodKey = periodKeyFor(key, options?.now);
  const where = { organizationId, limitKey: key, periodKey };
  const { count } = await prisma.usageCounter.updateMany({
    where: { ...where, used: { gte: BigInt(delta) } },
    data: { used: { decrement: BigInt(delta) } },
  });
  if (count === 0) await prisma.usageCounter.updateMany({ where, data: { used: 0n } });
}

/** Reserve, run `fn`, and release the reservation again if `fn` throws. */
export async function withLimit<T>(
  key: LimitKey,
  delta: number,
  fn: () => Promise<T>,
  options?: LimitOptions,
): Promise<T> {
  await consumeLimit(key, delta, options);
  try {
    return await fn();
  } catch (err) {
    await releaseLimit(key, delta, options).catch((releaseErr: unknown) =>
      logger.error({ err: releaseErr, limit: key }, 'Failed to release usage reservation'),
    );
    throw err;
  }
}

/** Source of truth for a GAUGE counter (used by `reconcileUsage`). */
export type UsageSource = (organizationId: string) => Promise<number>;
const sources = new Map<LimitKey, UsageSource>();

/**
 * Register how to recount a gauge limit from the real tables. Each module that consumes a gauge
 * limit registers its source (e.g. HR registers `employees`).
 */
export function registerUsageSource(key: LimitKey, source: UsageSource): void {
  if (LIMITS[key].period !== 'gauge') throw new Error(`${key} is not a gauge limit`);
  sources.set(key, source);
}

/** Recompute gauge counters from their registered sources (seeds, repair jobs). */
export async function reconcileUsage(organizationId: string): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const [key, source] of sources) {
    const used = await source(organizationId);
    await prisma.usageCounter.upsert({
      where: {
        organizationId_limitKey_periodKey: { organizationId, limitKey: key, periodKey: 'total' },
      },
      create: { organizationId, limitKey: key, periodKey: 'total', used: BigInt(used) },
      update: { used: BigInt(used) },
    });
    result[key] = used;
  }
  return result;
}

registerUsageSource('institutions', (organizationId) =>
  prisma.institution.count({ where: { organizationId, deletedAt: null } }),
);
