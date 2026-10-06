import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const base = { DATABASE_URL: 'mysql://u:p@localhost:3306/db' };

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.TENANT_RESOLVER).toBe('jwt');
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(env.JWT_ACCESS_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it('parses CORS origins list', () => {
    const env = parseEnv({ ...base, CORS_ORIGINS: 'http://a.test, http://b.test' });
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('requires a mysql DATABASE_URL', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ DATABASE_URL: 'postgres://x' })).toThrow(/mysql/);
  });

  it('forbids the dev-header tenant resolver in production', () => {
    expect(() =>
      parseEnv({ ...base, NODE_ENV: 'production', TENANT_RESOLVER: 'dev-header' }),
    ).toThrow(/not allowed in production/);
  });

  it('requires real secrets in production', () => {
    expect(() => parseEnv({ ...base, NODE_ENV: 'production' })).toThrow(/JWT_ACCESS_SECRET/);
    const env = parseEnv({
      ...base,
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'x'.repeat(40),
      DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    });
    expect(env.JWT_ACCESS_SECRET).toBe('x'.repeat(40));
  });

  it('validates the data encryption key length', () => {
    expect(() => parseEnv({ ...base, DATA_ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrow(/32 bytes/);
  });
});
