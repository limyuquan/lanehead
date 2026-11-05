import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

/** Unit tests: Node, fast. Files: tests/unit/**\/*.test.ts. */
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
