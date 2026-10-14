import { defineConfig } from '@playwright/test';

const port = Number(process.env.FIXTURE_PORT ?? 4173);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
  webServer: {
    command: `node tests/e2e/fixture-server.mjs`,
    url: `http://127.0.0.1:${port}/jobs/README.md`,
    env: { FIXTURE_PORT: String(port) },
    reuseExistingServer: !process.env.CI,
  },
});
