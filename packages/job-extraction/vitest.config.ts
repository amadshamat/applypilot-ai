import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'job-extraction',
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
