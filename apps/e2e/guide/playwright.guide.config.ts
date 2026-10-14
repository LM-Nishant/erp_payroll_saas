import { defineConfig, devices } from '@playwright/test';

/** Screenshot crawler for the user guide (not part of the e2e suite). */
export default defineConfig({
  testDir: '.',
  testMatch: /crawl\.ts$/,
  outputDir: '../test-results/guide',
  fullyParallel: true,
  workers: Number(process.env.E2E_WORKERS ?? 3),
  timeout: 45 * 60_000,
  reporter: [['line']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5180',
    actionTimeout: 8_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1366, height: 820 },
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
        },
      },
    },
  ],
});
