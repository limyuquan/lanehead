/**
 * README screenshots, written to docs/images/ at 2x. Not part of the normal run:
 *
 *   LANEHEAD_SHOTS=1 pnpm exec playwright test shots
 *
 * Pages are served by Playwright routes, so URLs look real and nothing leaves the machine.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { PALETTE } from '@/core/badge';
import type { Ops } from '@/core/types';
import { EXTENSION_ID } from '@/shared/ids';
import { type Lanehead, test } from './fixtures';

test.skip(!process.env.LANEHEAD_SHOTS, 'Set LANEHEAD_SHOTS=1 to refresh docs/images.');
test.use({ deviceScaleFactor: 2 });

const shot = (name: string) => `docs/images/${name}.png`;

/** Serves `https://*.example.com/<path>` with the given titles. */
const fakeSites = (context: BrowserContext) =>
  context.route(/^https:\/\/[a-z.]*example\.com\//, (route) => {
    const title = new URL(route.request().url()).searchParams.get('t') ?? 'Example';
    return route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<title>${title}</title>`,
    });
  });

const site = (host: string, path: string, title: string) =>
  `https://${host}/${path}?t=${encodeURIComponent(title)}`;

async function seedPresets(lh: Lanehead) {
  const save = (name: string, color: number, headers: [string, string][], domains: string[] = []) =>
    lh.api('preset.save', {
      preset: {
        name,
        color: PALETTE[color] as string,
        headers: headers.map(([n, value]) => ({ name: n, value })),
        domains,
      },
    });
  const checkout = await save('feature_checkout', 0, [
    ['x-env', 'feature_checkout'],
    ['x-canary', '1'],
  ]);
  const search = await save('feature_search', 4, [['x-env', 'feature_search']]);
  const staging = await save('staging', 1, [['x-env', 'staging']], ['example.com']);
  return [checkout, search, staging] as const;
}

async function popupShots(page: Page, name: string) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.locator('main').screenshot({ path: shot(`${name}-${scheme}`) });
  }
}

test('popup', async ({ context, lh }) => {
  await fakeSites(context);
  const [, search] = await seedPresets(lh);
  const cart = await lh.open(site('shop.example.com', 'cart', 'Cart — Example Shop'));
  const tab = await lh.tabId(cart);
  await lh.api('set', { tab, preset: search.id, headers: [{ name: 'x-debug', value: '1' }] });
  const popup = await lh.popup(tab);
  await popup.keyboard.press('1');
  await popup.getByRole('button', { name: /Reload tab/ }).waitFor();
  await popupShots(popup, 'popup');
});

// Not for the README: a check that long names stay inside the popup and the presets table.
test('long names', async ({ context, lh }) => {
  await fakeSites(context);
  await seedPresets(lh);
  const save = (name: string, color: number, value: string) =>
    lh.api('preset.save', {
      preset: {
        name,
        color: PALETTE[color] as string,
        headers: [{ name: 'x-env', value }],
        domains: [],
      },
    });
  for (const n of [10, 11, 12]) await save(`lane_backend_feature_${n}`, n % 8, `v${n}`.repeat(30));
  const wide = await save('W'.repeat(40), 6, 'wide');
  const cart = await lh.open(site('shop.example.com', 'cart', 'Cart — Example Shop'));
  const tab = await lh.tabId(cart);
  await lh.api('set', {
    tab,
    preset: wide.id,
    headers: [{ name: 'x-trace', value: 't'.repeat(120) }],
  });
  const popup = await lh.popup(tab);
  for (const scheme of ['light', 'dark'] as const) {
    await popup.emulateMedia({ colorScheme: scheme });
    await popup
      .locator('main')
      .screenshot({ path: test.info().outputPath(`popup-long-${scheme}.png`) });
  }
  const manage = await context.newPage();
  await manage.setViewportSize({ width: 1080, height: 720 });
  await manage.goto(`chrome-extension://${EXTENSION_ID}/manage.html#presets`);
  await manage.getByRole('heading', { level: 2 }).first().waitFor();
  await manage.screenshot({ path: test.info().outputPath('manage-long.png'), fullPage: true });
  // Viewport, not fullPage: headless full-page captures of a narrow page come out tiled.
  await manage.setViewportSize({ width: 380, height: 1500 });
  await manage.screenshot({ path: test.info().outputPath('manage-long-380.png') });
});

test('popup first run', async ({ context, lh }) => {
  await fakeSites(context);
  const page = await lh.open(site('shop.example.com', 'cart', 'Cart — Example Shop'));
  await popupShots(await lh.popup(await lh.tabId(page)), 'popup-first-run');
});

test('manage', async ({ context, lh }) => {
  await fakeSites(context);
  const [checkout, search, staging] = await seedPresets(lh);
  const tabs: [string, Omit<Ops['set'][0], 'tab'> | undefined][] = [
    [site('shop.example.com', 'cart', 'Cart — Example Shop'), { preset: checkout.id }],
    [site('shop.example.com', 'search', 'Search: lamp — Example Shop'), { preset: search.id }],
    [site('admin.example.com', 'orders', 'Orders · Admin'), { preset: staging.id }],
    [site('docs.example.com', 'api', 'API reference'), undefined],
    [
      site('shop.example.com', 'account', 'Your account — Example Shop'),
      { headers: [{ name: 'x-env', value: 'feature_profile' }] },
    ],
  ];
  // Reloaded after the change, except the first: one Reload button shows how a stale tab looks.
  for (const [i, [url, state]] of tabs.entries()) {
    const page = await lh.open(url);
    if (state) await lh.api('set', { tab: await lh.tabId(page), ...state, reload: i > 0 });
  }
  // The browser's first blank tab is not part of the picture.
  for (const page of context.pages()) if (page.url() === 'about:blank') await page.close();
  const manage = await context.newPage();
  await manage.setViewportSize({ width: 1080, height: 720 });
  for (const section of ['presets', 'tabs', 'agents']) {
    await manage.goto(`chrome-extension://${EXTENSION_ID}/manage.html#${section}`);
    await manage.getByRole('heading', { level: 2 }).first().waitFor();
    for (const scheme of ['light', 'dark'] as const) {
      await manage.emulateMedia({ colorScheme: scheme });
      await manage.screenshot({ path: shot(`manage-${section}-${scheme}`), fullPage: true });
    }
  }
  await manage.goto(`chrome-extension://${EXTENSION_ID}/manage.html#presets`);
  await manage.getByRole('button', { name: 'Edit staging' }).click();
  await manage.emulateMedia({ colorScheme: 'light' });
  await manage.screenshot({ path: shot('manage-preset-edit-light'), fullPage: true });
});
