import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'ai-core',
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
