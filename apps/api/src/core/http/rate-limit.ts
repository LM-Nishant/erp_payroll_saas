import type { Request, RequestHandler } from 'express';
import { AppError } from './errors';

export interface RateLimitStore {
  /** Increment the counter for `key` in the current window; returns the new count and reset time. */
  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
  reset(): Promise<void>;
}

/**
 * In-memory fixed-window store. Fine for a single API instance and tests; swap for a Redis
 * store when running several instances (same interface).
 */
export function memoryRateLimitStore(): RateLimitStore {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    async hit(key, windowMs) {
      const now = Date.now();
      let entry = windows.get(key);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs };
        windows.set(key, entry);
        if (windows.size > 10_000) {
          for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
        }
      }
      entry.count += 1;
      return { ...entry };
    },
    async reset() {
      windows.clear();
    },
  };
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  store: RateLimitStore;
  /** Bucket name, combined with the client key. */
  name: string;
  key?: (req: Request) => string;
}

export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds: number) {
    super(429, 'RATE_LIMITED', 'Too many requests, please try again later', {
      retryAfterSeconds,
    });
  }
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  return async (req, res, next) => {
    const clientKey = options.key ? options.key(req) : (req.ip ?? 'unknown');
    const { count, resetAt } = await options.store.hit(
      `${options.name}:${clientKey}`,
      options.windowMs,
    );
    const remaining = Math.max(0, options.max - count);
    res.setHeader('RateLimit-Limit', String(options.max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    if (count > options.max) {
      const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      throw new RateLimitedError(retryAfter);
    }
    next();
  };
}
