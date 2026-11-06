import { defineConfig } from '@playwright/test';

/**
 * Website smoke test (`pnpm site:test`): builds the site, serves the build with `vite preview` and
 * drives the demo in headless Chromium at desktop and phone sizes. Separate from the extension's
 * e2e suite (tests/e2e).
 */
const PORT = Number(process.env.SITE_PORT ?? 4193);

export default defineConfig({
  testDir: 'e2e',
  outputDir: '../test-results-site',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}/lanehead/`, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    {
      name: 'phone',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: `pnpm site:build && pnpm exec vite preview --config site/vite.config.ts --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: '..',
    env: { SITE_BASE: '/lanehead/' },
    url: `http://127.0.0.1:${PORT}/lanehead/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
