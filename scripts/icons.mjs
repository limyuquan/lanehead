/**
 * Renders assets/icon.svg to public/icon/{16,32,48,128}.png with headless Chromium.
 * Run after editing the SVG: `pnpm icons`. The PNGs are committed.
 * 128 px is the store/install icon: 96 px of art in 16 px of transparent padding, as the Chrome Web
 * Store asks. The toolbar sizes use the full square.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const SIZES = [16, 32, 48, 128];
const PADDING = { 128: 16 };
const svg = readFileSync(new URL('../assets/icon.svg', import.meta.url), 'utf8');

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const pngs = await page.evaluate(
    async ({ svg, sizes }) => {
      const img = new Image();
      img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      await img.decode();
      return sizes.map(([size, pad]) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        canvas.getContext('2d').drawImage(img, pad, pad, size - 2 * pad, size - 2 * pad);
        return canvas.toDataURL('image/png').split(',')[1];
      });
    },
    { svg, sizes: SIZES.map((size) => [size, PADDING[size] ?? 0]) },
  );
  SIZES.forEach((size, i) => {
    const out = new URL(`../public/icon/${size}.png`, import.meta.url);
    writeFileSync(out, Buffer.from(pngs[i], 'base64'));
    console.log(`public/icon/${size}.png`);
  });
} finally {
  await browser.close();
}
