import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'resume-parser',
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
