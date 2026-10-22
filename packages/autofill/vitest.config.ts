import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'autofill',
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'test/**/*.test.{ts,tsx}'],
  },
});
