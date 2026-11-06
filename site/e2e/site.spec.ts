/**
 * The website renders, and its demo runs Lanehead's real popup and service worker code in the
 * page: switching tabs and picking lanes change what the active tab sends, the terminal's
 * `lanehead` commands change the same state, and nothing is fetched from anywhere else.
 */
import { expect, type Page, test } from '@playwright/test';

/** Loads the page, recording console errors and requests to other origins. */
async function open(page: Page) {
  const errors: string[] = [];
  const foreign: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol !== 'data:') {
      foreign.push(r.url());
    }
  });
  await page.goto('./');
  const demo = page.getByTestId('demo');
  await expect(demo.getByTestId('popup').locator('main')).toBeVisible();
  return { demo, errors, foreign };
}

const sent = (page: Page) => page.getByTestId('sent');

test('renders the page and the demo, with no errors and no outside requests', async ({ page }) => {
  const { demo, errors, foreign } = await open(page);
  await expect(page.locator('#hero-title')).toHaveText('Every tab, its own backend.');
  for (const id of ['try', 'agents', 'install'])
    await expect(page.locator(`#${id}`)).toBeAttached();
  await expect(page.getByRole('link', { name: 'Download for Chrome' })).toHaveAttribute(
    'href',
    'https://github.com/limyuquan/lanehead/releases/latest',
  );
  await expect(demo.getByText('Runs entirely in this page. Nothing is sent.')).toBeVisible();
  // The hero's lanes, each named at its start.
  await expect(page.locator('[data-road] .lane-label')).toHaveText([
    'feature_checkout',
    'feature_search',
    'staging',
    'off',
  ]);
  // Both tabs, on two lanes. (The popup's lane title is checked by its accessible name: a long
  // name is drawn in two parts, src/shared/Name.tsx.)
  await expect(demo.getByRole('tab')).toHaveCount(2);
  await expect(demo.getByTestId('lane')).toHaveAccessibleName('feature_checkout');
  await expect(sent(page)).toContainText('x-envfeature_checkout');
  // Walk the page so every lazy clip gets a chance to load.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 50));
    }
  });
  await page.waitForTimeout(1000);
  expect(errors).toEqual([]);
  expect(foreign).toEqual([]);
});

test('switching tabs shows the other tab in the popup and in the headers panel', async ({
  page,
}) => {
  const { demo } = await open(page);
  await demo.getByTestId('tab-1').click();
  await expect(demo.getByTestId('tab-1')).toHaveAttribute('aria-selected', 'true');
  await expect(demo.getByTestId('lane')).toHaveAccessibleName('feature_search');
  await expect(sent(page)).toContainText('x-envfeature_search');
  await expect(demo.getByTestId('served-by')).toHaveText('the feature_search backend');
  await demo.getByTestId('tab-0').click();
  await expect(sent(page)).toContainText('x-envfeature_checkout');
});

test('choosing a lane in the popup changes what the tab sends; reload applies it', async ({
  page,
}) => {
  const { demo } = await open(page);
  const popup = demo.getByTestId('popup');
  await popup.getByRole('button', { name: 'staging' }).click();
  await expect(demo.getByTestId('lane')).toHaveAccessibleName('staging');
  await expect(sent(page)).toContainText('x-envstaging');
  await expect(sent(page)).toContainText('x-canary1');
  // The page still has what it loaded with, until a reload.
  await expect(demo.getByTestId('served-by')).toHaveText('the feature_checkout backend');
  await expect(popup.getByTestId('stale')).toBeVisible();
  // The tab's lane line follows; the other tab's stays.
  await expect(demo.getByTestId('lane-0').locator('.lane-label')).toHaveText('staging');
  await expect(demo.getByTestId('lane-1').locator('.lane-label')).toHaveText('feature_search');
  await popup.getByRole('button', { name: /Reload tab/ }).click();
  await expect(demo.getByTestId('served-by')).toHaveText('the staging backend');
  await expect(popup.getByTestId('stale')).toBeHidden();
  // The other tab is untouched.
  await demo.getByTestId('tab-1').click();
  await expect(sent(page)).toContainText('x-envfeature_search');
  await expect(sent(page)).not.toContainText('x-canary');
});

test('the popup keys work inside the demo and not elsewhere on the page', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'keyboard');
  const { demo } = await open(page);
  await page.locator('#hero-title').click();
  await page.keyboard.press('3');
  await expect(demo.getByTestId('lane')).toHaveAccessibleName('feature_checkout');
  await demo.getByTestId('page').click();
  await page.keyboard.press('3');
  await expect(demo.getByTestId('lane')).toHaveAccessibleName('staging');
  await page.keyboard.press('0');
  await expect(demo.getByTestId('lane')).toHaveAccessibleName('Off');
  await expect(sent(page)).toContainText('No extra headers');
  await expect(demo.getByTestId('lane-0').locator('.lane-label')).toHaveText('off');
});

test('the terminal runs lanehead commands against the same tabs', async ({ page }) => {
  const { demo } = await open(page);
  const out = demo.getByTestId('term-out');
  // It opens with `lanehead tabs`, in the CLI's JSON.
  await expect(out.first()).toContainText(
    '{"tabs":[{"id":1841,"url":"https://shop.example.com/checkout"',
  );
  const input = demo.getByTestId('term-input');
  await input.fill("lanehead set 1841 -H 'x-debug: 1'");
  await input.press('Enter');
  await expect(out.last()).toHaveText(
    '{"id":1841,"lane":"feature_checkout","headers":{"x-env":"feature_checkout","x-debug":"1"},"stale":true}',
  );
  await expect(sent(page)).toContainText('x-debug1');
  await expect(demo.getByTestId('popup')).toContainText('this tab');
  await input.fill('lanehead set 1841 -p nope');
  await input.press('Enter');
  await expect(out.last()).toHaveText(
    '{"error":{"code":"NO_PRESET","message":"No preset \\"nope\\"; run `lanehead presets`."}}',
  );
  await input.fill('lanehead set 1842 --off --reload');
  await input.press('Enter');
  await demo.getByTestId('tab-1').click();
  await expect(demo.getByTestId('lane')).toHaveAccessibleName('Off');
  await expect(demo.getByTestId('served-by')).toHaveText('production');
});
