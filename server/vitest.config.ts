import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // One embedded-postgres instance; keep tests in a single worker.
    maxWorkers: 1,
    minWorkers: 1
  }
});
