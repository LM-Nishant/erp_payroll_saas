import { execSync } from 'node:child_process';

/**
 * Resets the integration test database (TEST_DATABASE_URL) and applies all migrations.
 * When no test database is configured the integration suite is skipped locally, but CI
 * (CI=true) fails loudly so isolation tests can never be silently skipped.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    if (process.env.CI) throw new Error('TEST_DATABASE_URL must be set in CI');
    console.warn(
      '\n[integration] TEST_DATABASE_URL not set — integration tests will be skipped.\n',
    );
    return;
  }
  if (!/test/i.test(url)) {
    throw new Error('Refusing to reset a database whose URL does not contain "test"');
  }
  execSync('pnpm exec prisma migrate reset --force --skip-seed --skip-generate', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
