import { randomUUID } from 'node:crypto';
import { logger } from '../logger';
import {
  backoffDelay,
  DEFAULT_ATTEMPTS,
  DEFAULT_BACKOFF_MS,
  getJob,
  type TenantJobData,
} from './registry';
import { runJobInTenant } from './runner';

interface PendingJob {
  id: string;
  name: string;
  data: TenantJobData;
  attempt: number;
  runAt: number;
}

/**
 * In-process queue driver (tests, Redis-less dev). Jobs run asynchronously on the next tick in
 * a fresh tenant context (so they never see uncommitted request transactions). Failed jobs are
 * re-scheduled with exponential backoff. Tests call `drainJobs()` to wait for completion.
 */
class InlineDriver {
  private queue: PendingJob[] = [];
  private running: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  readonly failed: Array<{ name: string; data: TenantJobData; error: string }> = [];
  /** When true, delayed jobs are not run by timers; only by `drain({ includeDelayed })`. */
  manualDelays = process.env.NODE_ENV === 'test';

  add(name: string, data: TenantJobData, delayMs = 0, jobId?: string): string {
    const id = jobId ?? randomUUID();
    if (jobId && this.queue.some((j) => j.id === jobId)) return id;
    this.queue.push({ id, name, data, attempt: 1, runAt: Date.now() + delayMs });
    this.schedule();
    return id;
  }

  private schedule() {
    if (this.running) return;
    const now = Date.now();
    const due = this.queue.some((j) => j.runAt <= now);
    if (due) {
      this.running = new Promise<void>((resolve) => setImmediate(resolve))
        .then(() => this.processDue())
        .finally(() => {
          this.running = null;
          this.schedule();
        });
      return;
    }
    if (this.manualDelays || this.queue.length === 0) return;
    const next = Math.min(...this.queue.map((j) => j.runAt));
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.schedule();
      },
      Math.max(0, next - now),
    );
    this.timer.unref();
  }

  private async processDue(now = Date.now()): Promise<void> {
    for (;;) {
      const index = this.queue.findIndex((j) => j.runAt <= now);
      if (index < 0) return;
      const [job] = this.queue.splice(index, 1);
      await this.runOne(job!);
    }
  }

  private async runOne(job: PendingJob): Promise<void> {
    const def = getJob(job.name);
    if (!def) {
      logger.error({ job: job.name }, 'Unknown job');
      return;
    }
    const maxAttempts = def.attempts ?? DEFAULT_ATTEMPTS;
    try {
      await runJobInTenant(def, job.data, { jobId: job.id, attempt: job.attempt, maxAttempts });
    } catch (err) {
      const error = (err as Error).message;
      if (job.attempt < maxAttempts) {
        logger.warn({ job: job.name, attempt: job.attempt, err: error }, 'Job failed; retrying');
        this.queue.push({
          ...job,
          attempt: job.attempt + 1,
          runAt: Date.now() + backoffDelay(def.backoffMs ?? DEFAULT_BACKOFF_MS, job.attempt),
        });
      } else {
        logger.error({ job: job.name, err: error }, 'Job failed permanently');
        this.failed.push({ name: job.name, data: job.data, error });
      }
    }
  }

  /** Run everything currently due (and, optionally, delayed retries) until the queue settles. */
  async drain(options: { includeDelayed?: boolean; maxRounds?: number } = {}): Promise<void> {
    const maxRounds = options.maxRounds ?? 50;
    for (let round = 0; round < maxRounds; round++) {
      if (this.running) await this.running;
      const horizon = options.includeDelayed ? Number.MAX_SAFE_INTEGER : Date.now();
      if (!this.queue.some((j) => j.runAt <= horizon)) {
        if (this.running) continue;
        return;
      }
      const run = this.processDue(horizon);
      this.running = run.finally(() => {
        this.running = null;
      });
      await this.running;
    }
  }

  pending(): ReadonlyArray<Pick<PendingJob, 'name' | 'data' | 'attempt' | 'runAt'>> {
    return this.queue;
  }

  reset() {
    this.queue = [];
    this.failed.length = 0;
  }
}

export const inlineDriver = new InlineDriver();
