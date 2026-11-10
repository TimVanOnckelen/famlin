import { defineConfig, devices } from '@playwright/test'

// Smoke tests against an already running Famlin instance (CI starts the
// freshly built Docker image with the real docker-compose.yml first, see the
// `docker` job in .github/workflows/ci.yml). They expect a fresh database:
// the first test runs the one-time admin setup.
export default defineConfig({
  testDir: './tests',
  // One shared instance whose state builds up test by test.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.FAMLIN_URL ?? 'http://localhost:3000',
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', testMatch: 'smoke.spec.ts', use: { ...devices['Desktop Chrome'] } },
    // Runs after the smoke suite, which creates the admin account it signs in with.
    {
      name: 'admin-mobile',
      testMatch: 'admin-mobile.spec.ts',
      dependencies: ['chromium'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true },
    },
  ],
})
