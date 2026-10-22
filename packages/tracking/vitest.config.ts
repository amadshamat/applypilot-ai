import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'tracking',
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
