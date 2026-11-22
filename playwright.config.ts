import { defineConfig } from '@playwright/test';

// The controller and its test workers have distinct PIDs. Do not take a cleanup
// target from the caller's environment (Playwright clears its own output dir).
const run = process.pid;
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: `tmp/poll-test-results/${run}`,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  use: {
    browserName: 'chromium',
    serviceWorkers: 'block',
    launchOptions: { args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] },
    viewport: { width: 390, height: 844 },
    screenshot: 'only-on-failure',
  },
});
