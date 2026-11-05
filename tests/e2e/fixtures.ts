/**
 * Playwright fixtures for Lanehead e2e tests. Import `test` and `expect` from here.
 *
 * - `context`: persistent headless Chromium context with the e2e build loaded (fresh profile).
 * - `serviceWorker`: the extension's service worker.
 * - `lh`: helpers. `lh.api` calls the dispatcher through runtime messages from an extension page,
 *   the same path the popup uses (and it wakes a stopped worker).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  type BrowserContext,
  test as base,
  chromium,
  type Page,
  type Worker,
} from '@playwright/test';
import type { Browser } from 'wxt/browser';
import type { Op, Ops } from '@/core/types';
import { EXTENSION_ID } from '@/shared/ids';
import type { Request, Response } from '@/shared/messages';
import { ORIGIN_A } from '../../playwright.config';

/** The e2e build; `EXTENSION_PATH` points at a copy (parallel runs while the tree rebuilds). */
export const EXTENSION_PATH = path.resolve(process.env.EXTENSION_PATH ?? '.output/chrome-mv3-e2e');

/** `chrome` inside `evaluate` callbacks. */
export type ChromeGlobal = { chrome: typeof Browser };

export interface Lanehead {
  /** Runs a dispatcher op. Rejects with `CODE: message` when it fails. */
  api<K extends Op>(op: K, args: Ops[K][0]): Promise<Ops[K][1]>;
  /** A fixture page URL. `id` is made unique per test; read its requests with `log(id)`. */
  url(
    id: string,
    opts?: { origin?: string; frame?: string; fetch?: string; link?: string },
  ): string;
  /** An echo URL (for fetch) on `origin`. */
  echo(id: string, origin?: string): string;
  /** The popup as a page, showing tab `tab` (`popup.html?tab=<id>`). */
  popup(tab: number): Promise<Page>;
  /** Opens `url` in a new tab and waits for load. */
  open(url: string): Promise<Page>;
  /** Chrome tab id of a page (matched by its unique URL). */
  tabId(page: Page): Promise<number>;
  /** Headers of every request the server saw for `id`, oldest first. */
  log(id: string): Promise<Record<string, string>[]>;
  /** Session rules installed right now. */
  rules(): Promise<Browser.declarativeNetRequest.Rule[]>;
  /** Stops the extension's service worker (the next event or message starts a fresh one). */
  stopWorker(): Promise<void>;
}

interface Fixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  lh: Lanehead;
}

export const test = base.extend<Fixtures>({
  context: async ({ deviceScaleFactor }, use) => {
    if (!existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
      throw new Error(`No e2e build at ${EXTENSION_PATH}. Run \`pnpm build:e2e\` first.`);
    }
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      // New headless mode: the full browser, with extensions. Never a visible window.
      headless: true,
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
      ...(deviceScaleFactor && { deviceScaleFactor }),
    });
    await use(context);
    await context.close();
  },

  serviceWorker: async ({ context }, use) => {
    const isOurs = (w: Worker) => w.url() === `chrome-extension://${EXTENSION_ID}/background.js`;
    const sw =
      context.serviceWorkers().find(isOurs) ??
      (await context.waitForEvent('serviceworker', { predicate: isOurs }));
    await use(sw);
  },

  lh: async ({ context, serviceWorker }, use, testInfo) => {
    const prefix = `${testInfo.testId}-${testInfo.repeatEachIndex}-${testInfo.retry}`;
    const unique = (id: string) => `${prefix}-${id}`;
    const ui = await context.newPage();
    await ui.goto(`chrome-extension://${EXTENSION_ID}/manage.html`);

    const lh: Lanehead = {
      async api(op, args) {
        const res = await ui.evaluate(
          (req) => (globalThis as unknown as ChromeGlobal).chrome.runtime.sendMessage(req),
          { op, args } satisfies Request,
        );
        const r = res as Response;
        if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
        return r.result as never;
      },
      url(id, { origin = ORIGIN_A, ...params } = {}) {
        const query = new URLSearchParams({ id: unique(id), ...params });
        return `${origin}/page?${query}`;
      },
      echo(id, origin = ORIGIN_A) {
        return `${origin}/echo?id=${encodeURIComponent(unique(id))}`;
      },
      async popup(tab) {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${EXTENSION_ID}/popup.html?tab=${tab}`);
        await page.getByTestId('lane').waitFor();
        return page;
      },
      async open(url) {
        const page = await context.newPage();
        await page.goto(url);
        return page;
      },
      async tabId(page) {
        const { tabs } = await lh.api('tabs', { url: page.url() });
        const tab = tabs.find((t) => t.url === page.url());
        if (!tab) throw new Error(`No tab for ${page.url()}`);
        return tab.id;
      },
      async log(id) {
        const res = await fetch(`${ORIGIN_A}/log?id=${encodeURIComponent(unique(id))}`);
        return res.json();
      },
      rules() {
        return serviceWorker.evaluate(() =>
          (globalThis as unknown as ChromeGlobal).chrome.declarativeNetRequest.getSessionRules(),
        );
      },
      async stopWorker() {
        const cdp = await context.newCDPSession(ui);
        await cdp.send('ServiceWorker.enable');
        const stopped = new Promise<void>((resolve) => {
          cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
            const ours = versions.find((v) =>
              v.scriptURL.startsWith(`chrome-extension://${EXTENSION_ID}/`),
            );
            if (ours?.runningStatus === 'stopped') resolve();
          });
        });
        await cdp.send('ServiceWorker.stopAllWorkers');
        await stopped;
        await cdp.detach();
      },
    };
    await use(lh);
  },
});

export const expect = test.expect;
