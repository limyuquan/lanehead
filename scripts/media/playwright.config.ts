import { defineConfig } from '@playwright/test';

/**
 * Media captures (`pnpm media`): media/ from the real extension and CLI. Separate from the
 * e2e config, whose testDir (tests/e2e) never includes this folder; the spec also skips itself
 * unless LANEHEAD_MEDIA=1. Paths in the specs are relative to the repo root, where pnpm runs.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // Not test-results/: the e2e run empties that when it starts.
  outputDir: '../../test-results-media',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 5,
  reporter: 'list',
});
