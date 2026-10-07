import { logger } from '../logger';

/** Every tenant job payload carries the tenant id; processors run inside that tenant. */
export interface TenantJobData {
  organizationId: string;
}

export interface JobRunInfo {
  jobId: string;
  /** 1-based attempt number. */
  attempt: number;
  maxAttempts: number;
}

export interface JobDefinition<T extends TenantJobData = TenantJobData> {
  /** Unique, dotted name, e.g. `communication.send`. */
  name: string;
  handler: (data: T, info: JobRunInfo) => Promise<void>;
  /** Total attempts including the first (default 5). */
  attempts?: number;
  /** Base delay of the exponential backoff in ms (default 2000). */
  backoffMs?: number;
}

/** Platform-level recurring job (no tenant). Typically fans out per-org tenant jobs. */
export interface RecurringJobDefinition {
  name: string;
  /** Interval in ms (or a cron `pattern`). */
  everyMs?: number;
  pattern?: string;
  handler: () => Promise<void>;
}

const jobs = new Map<string, JobDefinition>();
const recurring = new Map<string, RecurringJobDefinition>();

export function defineJob<T extends TenantJobData>(def: JobDefinition<T>): JobDefinition<T> {
  if (jobs.has(def.name) && jobs.get(def.name) !== def) {
    logger.warn({ job: def.name }, 'Job redefined');
  }
  jobs.set(def.name, def as unknown as JobDefinition);
  return def;
}

export function defineRecurringJob(def: RecurringJobDefinition): RecurringJobDefinition {
  if (!def.everyMs && !def.pattern) throw new Error(`Recurring job ${def.name} needs a schedule`);
  recurring.set(def.name, def);
  return def;
}

export function getJob(name: string): JobDefinition | undefined {
  return jobs.get(name);
}

export function listRecurringJobs(): RecurringJobDefinition[] {
  return [...recurring.values()];
}

export function getRecurringJob(name: string): RecurringJobDefinition | undefined {
  return recurring.get(name);
}

export const DEFAULT_ATTEMPTS = 5;
export const DEFAULT_BACKOFF_MS = 2000;

/** Exponential backoff: base * 2^(attempt-1), capped at 1h. */
export function backoffDelay(baseMs: number, attempt: number): number {
  return Math.min(baseMs * 2 ** Math.max(0, attempt - 1), 3_600_000);
}
