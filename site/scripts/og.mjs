/**
 * Renders site/public/og.png (1200×630, the link preview) from the built site's hero, headless:
 *   pnpm site:build && pnpm exec vite preview --config site/vite.config.ts &   (serves on :4191)
 *   node site/scripts/og.mjs [url]
 * Uses the hero clip's poster (reduced motion), so run it after `pnpm media`.
 */
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://127.0.0.1:4191/lanehead/';
const out = fileURLToPath(new URL('../public/og.png', import.meta.url));

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  // The headline over the lanes, with the window across them.
  await page.addStyleTag({
    content: `.top, .hero-side { display: none !important; }
      .hero-head { padding-top: 52px !important; display: block !important; }
      .hero h1 { font-size: 64px !important; }
      .hero h1 .nb { display: inline !important; }
      .road { margin-top: 6px !important; }`,
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('[data-road] [data-media-frame][data-ready]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: out });
  console.log(out);
} finally {
  await browser.close();
}
