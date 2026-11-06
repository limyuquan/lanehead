/**
 * Product media for the README and the site, captured from the real extension and the real CLI:
 *
 *   pnpm media
 *
 * Writes docs/media/ (see docs/media/README.md). Skipped unless LANEHEAD_MEDIA=1; the normal
 * `playwright test` (testDir tests/e2e) never sees this folder.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';
import type { Ops } from '@/core/types';
import { EXTENSION_ID } from '@/shared/ids';
import type { ChromeGlobal, Lanehead } from '../../tests/e2e/fixtures';
import { Film, FPS, OUT_DIR, type Point, shoot, type Tab } from './film';
import { type Cli, expect, seedLanes, test } from './fixtures';

test.skip(!process.env.LANEHEAD_MEDIA, 'Set LANEHEAD_MEDIA=1 (or run `pnpm media`).');
test.describe.configure({ mode: 'parallel' });

const CART = 'https://shop.example.com/cart';
const SEARCH = 'https://shop.example.com/search?q=lamp';

/** The toolbar badge Chrome shows for `tab`: the extension's real text and color. */
async function badge(sw: Worker, tab: number) {
  return sw.evaluate(async (tabId) => {
    const { action } = (globalThis as unknown as ChromeGlobal).chrome;
    const text = await action.getBadgeText({ tabId });
    if (!text) return null;
    const [r, g, b] = await action.getBadgeBackgroundColor({ tabId });
    return { text, color: `rgb(${r}, ${g}, ${b})` };
  }, tab);
}

/** A site tab, sized to the stage's page area. */
interface SiteTab {
  page: Page;
  id: number;
  title: string;
}

async function openTab(lh: Lanehead, film: Film, url: string): Promise<SiteTab> {
  const page = await lh.open(url);
  await page.setViewportSize({ width: film.g.content.w, height: film.g.content.h });
  return { page, id: await lh.tabId(page), title: await page.title() };
}

/** The browser's first blank tab is not part of the picture. */
async function closeBlank(context: BrowserContext) {
  for (const page of context.pages()) if (page.url() === 'about:blank') await page.close();
}

const strip = (tabs: SiteTab[], active: SiteTab): Tab[] =>
  tabs.map((t) => ({ title: t.title, active: t === active }));

/** Puts tab `t` on stage: strip, address bar, badge, page. */
async function showTab(film: Film, sw: Worker, tabs: SiteTab[], t: SiteTab) {
  await t.page.bringToFront();
  film.set({
    tabs: strip(tabs, t),
    url: t.page.url(),
    badge: await badge(sw, t.id),
    page: await film.capture(await shoot(t.page)),
  });
}

/** The popup page for a tab, sized like the real popup. */
async function popupFor(lh: Lanehead, tab: number) {
  const popup = await lh.popup(tab);
  await popup.setViewportSize({ width: 420, height: 720 });
  await popup.mouse.move(415, 715);
  return popup;
}

/** Captures the popup onto the stage; returns the capture's origin in popup coordinates. */
async function snapPopup(film: Film, popup: Page): Promise<Point> {
  const main = popup.locator('main');
  const box = await main.boundingBox();
  if (!box) throw new Error('No popup <main>');
  const img = await film.capture(await shoot(main));
  film.set({ popup: film.popupAt(img, box.width, box.height) });
  return box;
}

/** Glides to `target` in the popup, hovers it for real, then clicks it for real. */
async function clickInPopup(film: Film, popup: Page, target: Locator, after: () => Promise<void>) {
  const origin = await snapPopup(film, popup);
  const box = await target.boundingBox();
  if (!box) throw new Error(`Not visible: ${target}`);
  await film.move(film.popupPoint(box, origin));
  await popup.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await snapPopup(film, popup);
  await film.hold(0.15);
  await film.click(async () => {
    await target.click();
    await after();
  });
}

/** The page's x-env as the server received it. */
const sent = (page: Page, name = 'x-env') => page.locator(`[data-h="${name}"] .v`);

function report(name: string, film: Film, files: { file: string; bytes: number }[]) {
  const line = files
    .map((f) => `${path.basename(f.file)} ${(f.bytes / 1024).toFixed(0)} KB`)
    .join(', ');
  console.log(`${name}: ${film.seconds.toFixed(1)} s @ ${FPS} fps; ${line}`);
}

test('hero: two tabs, two lanes', async ({ context, lh, serviceWorker: sw, stageBrowser }) => {
  const film = await Film.open(stageBrowser, 'hero', 'browser');
  const [checkout, search] = await seedLanes(lh);
  const a = await openTab(lh, film, CART);
  const b = await openTab(lh, film, SEARCH);
  await closeBlank(context);
  await lh.api('set', { tab: a.id, preset: checkout.id, reload: true });
  await lh.api('set', { tab: b.id, preset: search.id, reload: true });
  await expect(sent(a.page)).toHaveText('feature_checkout');
  await expect(sent(b.page)).toHaveText('feature_search');
  const tabs = [a, b];
  const popups = new Map([
    [a, await popupFor(lh, a.id)],
    [b, await popupFor(lh, b.id)],
  ]);

  const show = async (t: SiteTab, popup: boolean) => {
    await showTab(film, sw, tabs, t);
    if (popup) await snapPopup(film, popups.get(t) as Page);
    else film.set({ popup: null });
  };
  await show(a, true);
  film.set({ cursor: { x: 640, y: 560 } });
  await film.hold(2.4);
  for (const [i, t] of [
    [1, b],
    [0, a],
  ] as const) {
    await film.move(film.tabPoint(i), 0.75);
    await film.click(() => show(t, false));
    await film.hold(0.9);
    await film.move(film.extButton, 0.6);
    await film.click(() => show(t, true));
    await film.hold(i === 1 ? 2.4 : 0.9);
  }
  await film.loopBack();
  report('hero', film, await film.finish());
});

test('switch: pick a lane, reload, the page has the new header', async ({
  context,
  lh,
  serviceWorker: sw,
  stageBrowser,
}) => {
  const film = await Film.open(stageBrowser, 'switch', 'browser');
  const [checkout, search] = await seedLanes(lh);
  const a = await openTab(lh, film, CART);
  const b = await openTab(lh, film, SEARCH);
  await closeBlank(context);
  await lh.api('set', { tab: a.id, preset: checkout.id, reload: true });
  await lh.api('set', { tab: b.id, preset: search.id, reload: true });
  await expect(sent(a.page)).toHaveText('feature_checkout');
  const popup = await popupFor(lh, a.id);
  const tabs = [a, b];
  const stale = popup.getByTestId('stale');

  await showTab(film, sw, tabs, a);
  await snapPopup(film, popup);
  film.set({ cursor: { x: 560, y: 600 } });
  await film.hold(1.6);

  // Click a lane: the popup asks to reload; the page still has the old header.
  await clickInPopup(film, popup, popup.getByRole('button', { name: /feature_search/ }), () =>
    expect(stale).toBeVisible(),
  );
  await snapPopup(film, popup);
  film.set({ badge: await badge(sw, a.id) });
  await film.hold(1.7);

  // Reload tab: the page now shows the new lane's header.
  await clickInPopup(film, popup, popup.getByRole('button', { name: /Reload tab/ }), async () => {
    await expect(sent(a.page)).toHaveText('feature_search');
    await expect(stale).toBeHidden();
  });
  await snapPopup(film, popup);
  await film.load(await film.capture(await shoot(a.page)));
  await film.hold(1.6);

  // The same with keys: 1 picks the first lane, R reloads.
  await popup.mouse.move(415, 715);
  await film.move({ x: 470, y: 640 }, 0.5);
  await snapPopup(film, popup);
  let done = await film.key('1', 'feature_checkout', async () => {
    await popup.keyboard.press('1');
    await expect(stale).toBeVisible();
    await snapPopup(film, popup);
    film.set({ badge: await badge(sw, a.id) });
  });
  await done();
  done = await film.key('R', 'Reload tab', async () => {
    await popup.keyboard.press('r');
    await expect(sent(a.page)).toHaveText('feature_checkout');
    await expect(stale).toBeHidden();
    await snapPopup(film, popup);
    await film.load(await film.capture(await shoot(a.page)));
  });
  await done();
  await film.hold(0.8);
  await film.loopBack();
  report('switch', film, await film.finish());
});

test('edit: add a header to the lane', async ({ context, lh, serviceWorker: sw, stageBrowser }) => {
  const film = await Film.open(stageBrowser, 'edit', 'browser');
  const [checkout, search] = await seedLanes(lh);
  const a = await openTab(lh, film, CART);
  const b = await openTab(lh, film, SEARCH);
  await closeBlank(context);
  await lh.api('set', { tab: a.id, preset: checkout.id, reload: true });
  await lh.api('set', { tab: b.id, preset: search.id, reload: true });
  await expect(sent(a.page)).toHaveText('feature_checkout');
  const popup = await popupFor(lh, a.id);
  const stale = popup.getByTestId('stale');

  await showTab(film, sw, [a, b], a);
  await snapPopup(film, popup);
  film.set({ cursor: { x: 560, y: 600 } });
  await film.hold(1.4);

  await clickInPopup(
    film,
    popup,
    popup.getByRole('button', { name: 'Add header', exact: true }),
    async () => {
      await expect(popup.getByLabel('Header name').last()).toBeFocused();
    },
  );
  await popup.mouse.move(415, 715);
  await snapPopup(film, popup);
  // Out of the way of the new row.
  await film.move({ x: 600, y: 560 }, 0.45);

  const type = async (text: string) => {
    for (const ch of text) {
      await popup.keyboard.type(ch);
      await snapPopup(film, popup);
      await film.hold(0.11);
    }
  };
  await type('x-debug');
  await film.hold(0.3);
  let done = await film.key('Tab', 'value', async () => {
    await popup.keyboard.press('Tab');
    await snapPopup(film, popup);
  });
  await done();
  await type('1');
  await film.hold(0.3);
  done = await film.key('Enter', 'save to the lane', async () => {
    await popup.keyboard.press('Enter');
    await expect(stale).toBeVisible();
    await expect
      .poll(async () => (await lh.api('presets', {})).presets[0]?.headers.map((h) => h.name))
      .toContain('x-debug');
    await snapPopup(film, popup);
  });
  await done();
  await film.hold(0.8);

  await clickInPopup(film, popup, popup.getByRole('button', { name: /Reload tab/ }), async () => {
    await expect(sent(a.page, 'x-debug')).toHaveText('1');
    await expect(stale).toBeHidden();
  });
  await snapPopup(film, popup);
  await film.load(await film.capture(await shoot(a.page)));
  await film.move({ x: 600, y: 600 }, 0.5);
  await film.hold(2);
  await film.loopBack();
  report('edit', film, await film.finish());
});

test.describe('agent', () => {
  test.use({ agent: true });

  test('agent: the CLI switches a tab', async ({
    context,
    lh,
    serviceWorker: sw,
    cli,
    stageBrowser,
  }) => {
    const film = await Film.open(stageBrowser, 'agent', 'agent');
    await expect
      .poll(async () => JSON.parse((await cli('status')).out).instances.length, { timeout: 15_000 })
      .toBe(1);
    const [, search] = await seedLanes(lh);
    const a = await openTab(lh, film, CART);
    const b = await openTab(lh, film, SEARCH);
    await closeBlank(context);
    await lh.api('set', { tab: b.id, preset: search.id, reload: true });
    const tabs = [a, b];
    await showTab(film, sw, tabs, a);
    await expect(a.page.locator('[data-h="none"]')).toBeVisible();
    film.set({
      termTitle: 'agent — zsh',
      terminal: [{ comment: '# a coding agent, in its shell' }],
      prompt: true,
    });
    await film.hold(1);

    /** Types `args` as `lanehead …`, runs the real CLI, shows its real output. */
    const run = async (args: string[], shown: string) => {
      const cmd = `lanehead ${shown}`;
      const done = film.state.terminal;
      film.set({ prompt: false });
      for (let i = 1; i <= cmd.length; i++) {
        film.set({ terminal: [...done, { cmd: cmd.slice(0, i), typing: true }] });
        await film.hold(i < 9 ? 0.05 : 0.035);
      }
      await film.hold(0.35);
      const { code, out } = await (cli as Cli)(...args);
      expect(code, out).toBe(0);
      film.set({ terminal: [...done, { cmd, out }], prompt: true });
      return JSON.parse(out);
    };

    const listed = await run(['tabs', '--url', 'shop.example.com'], 'tabs --url shop.example.com');
    const cart = listed.tabs.find((t: { url: string }) => t.url === CART);
    expect(cart?.id).toBe(a.id);
    await film.hold(1.8);

    const set = await run(
      ['set', String(cart.id), '-p', 'feature_checkout', '--reload'],
      `set ${cart.id} -p feature_checkout --reload`,
    );
    expect(set.lane).toBe('feature_checkout');
    await expect(sent(a.page)).toHaveText('feature_checkout');
    film.set({ badge: await badge(sw, a.id) });
    await film.load(await film.capture(await shoot(a.page)));
    // Poster: both commands, their output, and the page with the new headers.
    film.poster();
    await film.hold(3);
    await film.loopBack();
    report('agent', film, await film.finish());
  });
});

test('stills: popup and manage, dark and light, 2x', async ({ context, lh }) => {
  const [checkout, search, staging] = await seedLanes(lh);
  const open = async (url: string, state?: Omit<Ops['set'][0], 'tab'>) => {
    const page = await lh.open(url);
    const tab = await lh.tabId(page);
    if (state) await lh.api('set', { tab, ...state, reload: true });
    return tab;
  };
  const cart = await open(CART, {
    preset: checkout.id,
    headers: [{ name: 'x-debug', value: '1' }],
  });
  await open(SEARCH, { preset: search.id });
  await open('https://admin.example.com/orders', { preset: staging.id });
  await open('https://docs.example.com/api');
  await open('https://shop.example.com/account', {
    headers: [{ name: 'x-env', value: 'feature_profile' }],
  });
  await closeBlank(context);
  mkdirSync(OUT_DIR, { recursive: true });

  const popup = await popupFor(lh, cart);
  await expect(popup.getByTestId('stale')).toBeHidden();
  const manage = await context.newPage();
  await manage.setViewportSize({ width: 1080, height: 560 });
  await manage.goto(`chrome-extension://${EXTENSION_ID}/manage.html#tabs`);
  await manage.getByRole('heading', { level: 2 }).first().waitFor();
  await manage.mouse.move(0, 0);
  for (const scheme of ['dark', 'light'] as const) {
    await popup.emulateMedia({ colorScheme: scheme });
    writeFileSync(path.join(OUT_DIR, `popup-${scheme}.png`), await shoot(popup.locator('main')));
    await manage.emulateMedia({ colorScheme: scheme });
    await manage.screenshot({
      path: path.join(OUT_DIR, `manage-${scheme}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
});
