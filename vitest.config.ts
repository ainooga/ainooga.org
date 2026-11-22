import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';
import { availableParallelism } from 'node:os';

const dom = [
  'tests/components/**/*.test.ts',
  'tests/unit/{poll-api,poll-state,turnstile}.test.ts',
];

export default defineConfig({
  plugins: [svelte()],
  resolve: { alias: { $lib: resolve('./src/lib') } },
  test: {
    globals: true,
    allowOnly: false,
    maxWorkers: Math.min(8, availableParallelism()),
    projects: [
      {
        extends: true,
        test: {
          name: 'db',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts', 'tests/cli/**/*.test.ts'],
          exclude: dom,
        },
      },
      {
        extends: true,
        resolve: { conditions: ['browser'] },
        test: { name: 'dom', environment: 'jsdom', include: dom },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'scripts/**/*.ts', 'db/**/*.ts', 'worker/src/**/*.ts'],
      thresholds: { lines: 80, branches: 70, functions: 80, statements: 80 },
    },
  },
});
