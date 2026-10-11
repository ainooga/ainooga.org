import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'tmp/poll-test-results',
  testMatch: 'polls.test.ts',
  timeout: 30000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4179',
    headless: true,
    viewport: { width: 390, height: 844 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm exec tsx tests/helpers/poll-browser-server.ts',
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
