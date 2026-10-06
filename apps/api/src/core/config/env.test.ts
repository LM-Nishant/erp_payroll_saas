import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const base = { DATABASE_URL: 'mysql://u:p@localhost:3306/db' };

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.TENANT_RESOLVER).toBe('none');
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
});
