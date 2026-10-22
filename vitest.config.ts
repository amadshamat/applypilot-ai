import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/*/vitest.config.ts',
      'services/*/vitest.config.ts',
      'apps/*/vitest.config.ts',
      'infra/vitest.config.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**', 'services/*/src/**', 'apps/*/src/**', 'infra/lib/**'],
      exclude: ['**/*.test.{ts,tsx}', '**/test/**'],
    },
  },
});
