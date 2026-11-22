import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    allowOnly: false,
    include: ['tests/capacity/**/*.test.ts'],
    environment: 'node',
    maxWorkers: 1,
  },
});
