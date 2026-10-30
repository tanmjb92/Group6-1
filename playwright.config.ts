import { defineConfig, devices } from '@playwright/test';

const sessionSecret = 'playwright-only-session-secret-32-bytes-minimum';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:3101',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --hostname localhost --port 3101',
    url: 'http://localhost:3101',
    reuseExistingServer: false,
    env: {
      SESSION_SECRET: sessionSecret,
      RP_NAME: 'Todo App',
      RP_ID: 'localhost',
      RP_ORIGIN: 'http://localhost:3101',
      DATABASE_PATH: 'playwright-auth.db',
    },
    timeout: 120_000,
  },
});
