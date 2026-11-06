/**
 * Renders site/public/og.png (1200×630, the link preview) from the built site's hero, headless:
 *   pnpm site:build && pnpm exec vite preview --config site/vite.config.ts &   (serves on :4191)
 *   node site/scripts/og.mjs [url]
 * The headline over the hero's routing picture (two tabs, two headers, two backends), still.
 */
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://127.0.0.1:4191/lanehead/';
const out = fileURLToPath(new URL('../public/og.png', import.meta.url));

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    // 1000×525 at 1.2×: 1200×630, with the picture large enough to read in a link preview.
    viewport: { width: 1000, height: 525 },
    deviceScaleFactor: 1.2,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  // The headline over the routing picture; nav, copy and the clip below are left out.
  await page.addStyleTag({
    content: `.top, .hero-side, .proof, main > :not(.hero), .foot { display: none !important; }
      .hero-head { padding-top: 70px !important; display: block !important; }
      .hero h1 { font-size: 58px !important; }
      .hero h1 .nb { display: inline !important; }
      .routes { margin-top: 56px !important; }`,
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('[data-routes] [data-testid="route-backend"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: out });
  console.log(out);
} finally {
  await browser.close();
}
