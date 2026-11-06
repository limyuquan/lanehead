/**
 * Headless screenshots of the built site, for design review:
 *   pnpm site:build && pnpm exec vite preview --config site/vite.config.ts &   (serves on :4191)
 *   node site/scripts/shots.mjs [outDir] [url]
 * Full-page and first-screen shots at 390 and 1440 wide. Never headed.
 */
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? 'test-results-site/shots';
const url = process.argv[3] ?? 'http://127.0.0.1:4191/lanehead/';
const SIZES = [
  { name: '1440', width: 1440, height: 900, mobile: false },
  { name: '390', width: 390, height: 844, mobile: true },
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const s of SIZES) {
    const ctx = await browser.newContext({
      viewport: { width: s.width, height: s.height },
      deviceScaleFactor: s.mobile ? 2 : 1,
      isMobile: s.mobile,
      hasTouch: s.mobile,
      colorScheme: 'dark',
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="demo"][data-ready] [data-testid="popup"] main');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/${s.name}-top.png` });
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < h; y += s.height * 0.7) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(800);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${s.name}-full.png`, fullPage: true });
    // One screen at a time, for a closer look.
    for (let y = 0, n = 1; y < h; y += s.height - 120, n++) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${out}/${s.name}-screen-${String(n).padStart(2, '0')}.png` });
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
