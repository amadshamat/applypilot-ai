import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'infra',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Synthesizing a stack takes a few seconds.
    testTimeout: 60_000,
  },
});
