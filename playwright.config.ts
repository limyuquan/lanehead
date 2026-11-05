import { defineConfig } from '@playwright/test';

export const FIXTURE_PORT = Number(process.env.FIXTURE_PORT ?? 4391);
/** Two origins served by scripts/serve-fixtures.mjs. */
export const ORIGIN_A = `http://127.0.0.1:${FIXTURE_PORT}`;
export const ORIGIN_B = `http://localhost:${FIXTURE_PORT}`;

/**
 * E2E: the extension (built by `pnpm build:e2e` into .output/chrome-mv3-e2e) is loaded into
 * Playwright's bundled Chromium, headless. `pnpm test:e2e` builds first; `playwright test` alone
 * reuses the last build.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
  webServer: {
    command: 'node scripts/serve-fixtures.mjs',
    url: `${ORIGIN_A}/`,
    reuseExistingServer: !process.env.CI,
    env: { FIXTURE_PORT: String(FIXTURE_PORT) },
  },
});
