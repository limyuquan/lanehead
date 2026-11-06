/**
 * Fixtures for the media captures, on top of tests/e2e/fixtures.ts (its `lh` helpers and
 * extension build). Here the extension's browser:
 * - resolves every *.example.com to the echo server (echo.ts), so pages show real headers;
 * - is dark and 2x;
 * - with `agent: true`, runs on a profile the real `lanehead install` registered the native host
 *   in, with a scratch LANEHEAD_HOME, as tests/e2e/agent.spec.ts does; `cli` runs dist/lanehead.js.
 * The stage (film.ts) runs in a second, plain headless browser.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type Browser, chromium } from '@playwright/test';
import { PALETTE } from '@/core/badge';
import type { Preset } from '@/core/types';
import { test as base, EXTENSION_PATH, expect, type Lanehead } from '../../tests/e2e/fixtures';
import { type Echo, startEcho } from './echo';
import { ffmpeg } from './film';

const CLI = path.resolve('dist/lanehead.js');

/** Runs `lanehead <args>`; resolves with its stdout line (trimmed) and exit code. */
export type Cli = (...args: string[]) => Promise<{ code: number; out: string }>;

interface Options {
  agent: boolean;
}

interface Fixtures {
  cli: Cli;
  home: string;
}

interface Workers {
  echo: Echo;
  stageBrowser: Browser;
}

export const test = base.extend<Fixtures & Options, Workers>({
  agent: [false, { option: true }],

  echo: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright needs a destructuring pattern.
    async ({}, use) => {
      ffmpeg(); // fail fast, before any capture
      const echo = await startEcho();
      await use(echo);
      await echo.close();
    },
    { scope: 'worker' },
  ],

  stageBrowser: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright needs a destructuring pattern.
    async ({}, use) => {
      const browser = await chromium.launch({ channel: 'chromium', headless: true });
      await use(browser);
      await browser.close();
    },
    { scope: 'worker' },
  ],

  // biome-ignore lint/correctness/noEmptyPattern: Playwright needs a destructuring pattern.
  home: async ({}, use) => {
    // Short: the host's socket path must fit in 104 bytes.
    const home = mkdtempSync(path.join(os.tmpdir(), 'lhm-'));
    await use(home);
    execFile('pkill', ['-KILL', '-f', `${home}/host/lanehead.js host`], () => {});
    rmSync(home, { recursive: true, force: true });
  },

  cli: async ({ home }, use) => {
    const env = { ...process.env, LANEHEAD_HOME: home, HOME: home };
    await use(
      (...args) =>
        new Promise((resolve) => {
          execFile(process.execPath, [CLI, ...args], { env }, (err, stdout) => {
            resolve({ code: typeof err?.code === 'number' ? err.code : 0, out: stdout.trim() });
          });
        }),
    );
  },

  context: async ({ echo, agent, home, cli }, use, testInfo) => {
    if (!existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
      throw new Error(`No e2e build at ${EXTENSION_PATH}. Run \`pnpm build:e2e\` first.`);
    }
    let dir = '';
    let installing: ReturnType<Cli> | undefined;
    if (agent) {
      if (!existsSync(CLI)) throw new Error('No dist/lanehead.js. Run `pnpm build:cli` first.');
      dir = path.join(home, 'profile');
      installing = cli('install', '--browser', 'chromium', '--user-data-dir', dir);
      // Start the browser once the manifest is there, so the worker's first connect finds it.
      const manifest = path.join(dir, 'NativeMessagingHosts', 'dev.lanehead.bridge.json');
      await expect.poll(() => existsSync(manifest)).toBe(true);
    }
    const context = await chromium.launchPersistentContext(dir, {
      channel: 'chromium',
      // New headless mode: the full browser, with extensions. Never a visible window.
      headless: true,
      colorScheme: 'dark',
      deviceScaleFactor: 2,
      env: { ...process.env, LANEHEAD_PORT: String(48100 + testInfo.parallelIndex * 8) },
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        `--host-resolver-rules=MAP *.example.com:443 127.0.0.1:${echo.port}`,
        '--ignore-certificate-errors',
      ],
    });
    if (installing) {
      const { code, out } = await installing;
      if (code !== 0) throw new Error(`lanehead install failed: ${out}`);
    }
    await use(context);
    await context.close();
  },
});

export { expect };

/** The three generic lanes every capture uses. */
export async function seedLanes(lh: Lanehead): Promise<[Preset, Preset, Preset]> {
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
  ];
}
