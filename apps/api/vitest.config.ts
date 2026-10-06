import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';

const fileEnv: Record<string, string | undefined> = existsSync('.env')
  ? parseEnv(readFileSync('.env', 'utf8'))
  : {};
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? fileEnv.TEST_DATABASE_URL;
// Expose to globalSetup (runs in this process; project `env` only reaches test workers).
if (testDatabaseUrl) process.env.TEST_DATABASE_URL = testDatabaseUrl;

const sharedEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  TENANT_RESOLVER: 'dev-header',
  STORAGE_DRIVER: 'memory',
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          environment: 'node',
          // Unit tests never touch the database; the URL only satisfies env validation.
          env: { ...sharedEnv, DATABASE_URL: 'mysql://unit:unit@127.0.0.1:1/unit' },
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/**/*.int.test.ts'],
          environment: 'node',
          globalSetup: ['test/global-setup.ts'],
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 30_000,
          hookTimeout: 120_000,
          env: {
            ...sharedEnv,
            DATABASE_URL: testDatabaseUrl ?? '',
            TEST_DATABASE_URL: testDatabaseUrl ?? '',
          },
        },
      },
    ],
  },
});
