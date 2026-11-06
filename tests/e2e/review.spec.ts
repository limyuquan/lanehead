/**
 * Design review screenshots of every popup state and the preset editor, light and dark, at 2x.
 * Not part of the normal run:
 *
 *   LANEHEAD_REVIEW_DIR=/some/dir pnpm exec playwright test review
 *
 * Pages are served by Playwright routes, so URLs look real and nothing leaves the machine.
 */
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { PALETTE } from '@/core/badge';
import { EXTENSION_ID } from '@/shared/ids';
import { expect, type Lanehead, test } from './fixtures';

const dir = process.env.LANEHEAD_REVIEW_DIR ?? '';
test.skip(!dir, 'Set LANEHEAD_REVIEW_DIR=<dir> to write review screenshots.');
test.use({ deviceScaleFactor: 2 });

const fakeSites = (context: BrowserContext) =>
  context.route(/^https:\/\/[a-z.]*example\.com\//, (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<title>Example Shop</title>' }),
  );
const CART = 'https://shop.example.com/cart';

async function seed(lh: Lanehead) {
  const save = (name: string, color: number, headers: [string, string][], domains: string[] = []) =>
    lh.api('preset.save', {
      preset: {
        name,
        color: PALETTE[color] as string,
        headers: headers.map(([n, value]) => ({ name: n, value })),
        domains,
      },
    });
  return [
    await save('feature_checkout', 0, [
      ['x-env', 'feature_checkout'],
      ['x-canary', '1'],
    ]),
    await save('feature_search', 4, [['x-env', 'feature_search']]),
    await save('staging', 1, [['x-env', 'staging']], ['example.com']),
  ] as const;
}

async function shots(page: Page, name: string, target = page.locator('main')) {
  await page.mouse.move(0, 0);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await target.screenshot({
      path: path.join(dir, `${name}-${scheme}.png`),
      animations: 'disabled',
    });
  }
}

/** A tab on shop.example.com whose page loaded with what it sends now (not stale). */
async function cartTab(lh: Lanehead, preset?: string) {
  const page = await lh.open(CART);
  const tab = await lh.tabId(page);
  if (preset) await lh.api('set', { tab, preset, reload: true });
  return tab;
}

/** Focus leaves whatever has it (a draft row stays a draft). */
const blur = (popup: Page) =>
  popup.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

const fresh = (popup: Page) =>
  expect(popup.getByRole('button', { name: 'Reload tab' })).toBeHidden();

test('popup, no lanes: create form empty and filled', async ({ context, lh }) => {
  await fakeSites(context);
  const popup = await lh.popup(await cartTab(lh));
  await shots(popup, '01-first-run-create-empty');
  await popup.getByLabel('Lane name').fill('feature_checkout');
  await popup.getByLabel('Header name').fill('x-env');
  await popup.getByLabel('Value of x-env').fill('feature_checkout');
  await popup.getByRole('button', { name: 'Add header', exact: true }).click();
  await popup.getByLabel('Header name').last().fill('x-canary');
  await popup.getByLabel('Value of x-canary').fill('1');
  await popup.getByLabel('Lane name').focus();
  await shots(popup, '02-first-run-create-filled');
});

test('popup, lanes but tab off', async ({ context, lh }) => {
  await fakeSites(context);
  await seed(lh);
  const popup = await lh.popup(await cartTab(lh));
  await expect(popup.getByTestId('lane')).toHaveText('Off');
  await shots(popup, '03-off-with-lanes');
});

test('popup, lane chosen; editing; adding; row error; tab-only header; More', async ({
  context,
  lh,
}) => {
  await fakeSites(context);
  const [checkout] = await seed(lh);
  const tab = await cartTab(lh, checkout.id);
  const popup = await lh.popup(tab);
  await fresh(popup);
  await shots(popup, '04-lane-chosen');

  await popup.getByLabel('Value of x-canary').click();
  await shots(popup, '05-editing-header');

  await popup.getByRole('button', { name: 'Add header', exact: true }).click();
  await popup.keyboard.type('x-trace');
  await shots(popup, '06-adding-row');

  await popup.keyboard.type(' id');
  await popup.keyboard.press('Tab');
  await popup.keyboard.type('abc');
  await popup.keyboard.press('Enter');
  await popup.getByRole('alert').waitFor();
  await shots(popup, '07-row-validation-error');
  await popup.getByRole('button', { name: 'Remove x-trace id' }).click();

  await lh.api('set', { tab, headers: [{ name: 'x-debug', value: '1' }], reload: true });
  await popup.getByText('this tab', { exact: true }).waitFor();
  await fresh(popup);
  await blur(popup);
  await shots(popup, '08-tab-only-header');

  await popup.getByRole('button', { name: 'More actions' }).click();
  await shots(popup, '10-more-open');
});

test('popup, stale tab', async ({ context, lh }) => {
  await fakeSites(context);
  const [, search] = await seed(lh);
  const tab = await cartTab(lh);
  await lh.api('set', { tab, preset: search.id });
  const popup = await lh.popup(tab);
  await popup.getByRole('button', { name: 'Reload tab' }).waitFor();
  await shots(popup, '09-stale-tab');
});

test('manage, lane editor', async ({ context, lh }) => {
  await fakeSites(context);
  await seed(lh);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1080, height: 820 });
  await page.goto(`chrome-extension://${EXTENSION_ID}/manage.html#presets`);
  await page.getByRole('button', { name: 'Edit feature_checkout' }).click();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: path.join(dir, `11-manage-lane-editor-${scheme}.png`) });
  }
});

test('popup, turned off from a lane (title Off)', async ({ context, lh }) => {
  await fakeSites(context);
  const [checkout] = await seed(lh);
  const popup = await lh.popup(await cartTab(lh, checkout.id));
  await fresh(popup);
  await popup.keyboard.press('0');
  await expect(popup.getByTestId('lane')).toHaveText('Off');
  await blur(popup);
  await shots(popup, '12-turned-off-from-lane');
});

test('popup, custom headers and no lanes', async ({ context, lh }) => {
  await fakeSites(context);
  const tab = await cartTab(lh);
  await lh.api('set', {
    tab,
    headers: [
      { name: 'x-env', value: 'feature_profile' },
      { name: 'x-debug', value: '1' },
    ],
    reload: true,
  });
  const popup = await lh.popup(tab);
  await expect(popup.getByTestId('lane')).toHaveText('Custom headers');
  await fresh(popup);
  await shots(popup, '13-custom-only-no-lanes');
});

test('popup, all-tabs mode on', async ({ context, lh }) => {
  await fakeSites(context);
  const [, , staging] = await seed(lh);
  await lh.api('global', { preset: staging.id });
  const tab = await cartTab(lh);
  const popup = await lh.popup(tab);
  await expect(popup.getByTestId('lane')).toHaveText('All tabs: staging');
  await fresh(popup);
  await shots(popup, '14-all-tabs-on');
});
