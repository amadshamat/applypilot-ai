import { defineConfig } from '@playwright/test';

const port = Number(process.env.FIXTURE_PORT ?? 4173);
const apiPort = Number(process.env.E2E_API_PORT ?? 8799);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
  webServer: [
    {
      command: `node tests/e2e/fixture-server.mjs`,
      url: `http://127.0.0.1:${port}/jobs/README.md`,
      env: { FIXTURE_PORT: String(port) },
      reuseExistingServer: !process.env.CI,
    },
    {
      // The real ApplyPilot API in mock mode: free, offline, no API key.
      command: 'pnpm --filter @applypilot/api exec tsx src/main.ts',
      url: `http://127.0.0.1:${apiPort}/v1/health`,
      env: {
        APPLYPILOT_PROVIDER: 'mock',
        APPLYPILOT_PORT: String(apiPort),
        APPLYPILOT_LOCAL_TOKEN: 'e2e-local-token-0123456789abcdef',
        ANTHROPIC_API_KEY: '',
      },
      reuseExistingServer: false,
    },
  ],
});
