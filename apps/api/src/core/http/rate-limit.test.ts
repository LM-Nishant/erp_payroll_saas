import express from 'express';
import supertest from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from './error-handler';
import { memoryRateLimitStore, rateLimit } from './rate-limit';

describe('rateLimit', () => {
  it('returns 429 with Retry-After after max hits per window', async () => {
    const app = express();
    app.post(
      '/x',
      rateLimit({ name: 't', windowMs: 60_000, max: 2, store: memoryRateLimitStore() }),
      (_req, res) => {
        res.json({ ok: true });
      },
    );
    app.use(errorHandler);
    const agent = supertest(app);
    expect((await agent.post('/x')).status).toBe(200);
    expect((await agent.post('/x')).status).toBe(200);
    const limited = await agent.post('/x');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });
});
