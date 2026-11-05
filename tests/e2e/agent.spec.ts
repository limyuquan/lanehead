/**
 * Agent bridge end to end: the real `lanehead` binary (dist/lanehead.js, `pnpm build:cli`) drives
 * headless Chromium through the native host.
 *
 * Each test gets a scratch LANEHEAD_HOME (also its HOME, so the CLI never sees the real
 * ~/.local/bin or ~/.claude) and scratch user-data-dirs, which `install --user-data-dir` registers
 * the host in. Chromium reads `<user-data-dir>/NativeMessagingHosts` (checked on macOS, v156).
 * The browser gets no LANEHEAD_HOME: the installed wrapper carries it. It gets LANEHEAD_PORT, so
 * each worker's hosts serve their control pages on ports of their own.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { type BrowserContext, chromium } from '@playwright/test';
import { PALETTE } from '@/core/badge';
import { ORIGIN_A } from '../../playwright.config';
import { test as base, EXTENSION_PATH, expect } from './fixtures';

/** `LANEHEAD_CLI` points at a copy (parallel runs while the tree rebuilds). */
const CLI = path.resolve(process.env.LANEHEAD_CLI ?? 'dist/lanehead.js');

// biome-ignore lint/suspicious/noExplicitAny: the CLI's JSON, checked with expect.
type Run = { code: number; out: any };

interface Agent {
  home: string;
  /** Runs `lanehead <args>`. */
  cli(...args: string[]): Promise<Run>;
  /** Installs the host into a new profile, starts a browser on it; resolves with install's output. */
  launch(profile: string): Promise<{ context: BrowserContext; install: Run }>;
  /** The test's own browser (also the `context` fixture) and the output of its install. */
  context: BrowserContext;
  install: Run;
  /** Kills the hosts the browsers started. */
  killHosts(): Promise<void>;
}

const test = base.extend<{ agent: Agent }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright needs a destructuring pattern.
  agent: async ({}, use, testInfo) => {
    // Short: a socket path must fit in 104 bytes.
    const home = mkdtempSync(path.join(os.tmpdir(), 'lh-'));
    const env = { ...process.env, LANEHEAD_HOME: home, HOME: home };
    const contexts: BrowserContext[] = [];
    const agent = {
      home,
      cli: (...args) =>
        new Promise((resolve) => {
          execFile(process.execPath, [CLI, ...args], { env }, (err, stdout) => {
            const code = typeof err?.code === 'number' ? err.code : 0;
            resolve({ code, out: stdout.startsWith('{') ? JSON.parse(stdout) : stdout });
          });
        }),
      async launch(profile) {
        const dir = path.join(home, profile);
        const installing = agent.cli('install', '--browser', 'chromium', '--user-data-dir', dir);
        // Start the browser once the manifest is there, so the worker's first connect finds it.
        const manifest = path.join(dir, 'NativeMessagingHosts', 'dev.lanehead.bridge.json');
        await expect.poll(() => existsSync(manifest)).toBe(true);
        const context = await chromium.launchPersistentContext(dir, {
          channel: 'chromium',
          headless: true,
          env: { ...process.env, LANEHEAD_PORT: String(47900 + testInfo.parallelIndex * 8) },
          args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
          ],
        });
        contexts.push(context);
        return { context, install: await installing };
      },
      killHosts: () =>
        new Promise((resolve) => {
          execFile('pkill', ['-KILL', '-f', `${home}/host/lanehead.js host`], () => resolve());
        }),
    } as Agent;
    Object.assign(agent, await agent.launch('profile'));
    await use(agent);
    for (const context of contexts) await context.close();
    rmSync(home, { recursive: true, force: true });
  },

  context: async ({ agent }, use) => use(agent.context),
});

/** Instances `lanehead status` lists, once there are `n`. */
async function waitForInstances(agent: Agent, n: number, timeout = 10_000) {
  await expect
    .poll(async () => (await agent.cli('status')).out.instances.length, { timeout })
    .toBe(n);
  return (await agent.cli('status')).out.instances;
}

test('install waits for the browser; status and tabs', async ({ agent, lh }) => {
  const instance = {
    instance: expect.stringMatching(/^[a-z0-9]{4}$/),
    label: 'Chromium',
    browser: expect.stringMatching(/^Chromium \d+$/),
    version: '0.1.0',
    ui: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/$/),
  };
  expect(agent.install).toEqual({
    code: 0,
    out: {
      manifest: path.join(
        agent.home,
        'profile',
        'NativeMessagingHosts',
        'dev.lanehead.bridge.json',
      ),
      shim: null,
      instances: [instance],
      hint: expect.stringContaining('PATH'),
    },
  });
  expect(await agent.cli('status')).toEqual({ code: 0, out: { instances: [instance] } });
  expect(await lh.api('status', {})).toMatchObject({ agent: 'connected' });

  const page = await lh.open(lh.url('t'));
  const id = await lh.tabId(page);
  const { code, out } = await agent.cli('tabs');
  expect(code).toBe(0);
  // Lean: no lane or headers while there are none; Lanehead's own manage page is left out.
  expect(out.tabs).toContainEqual({ id, url: page.url(), title: expect.any(String) });
  expect(out.tabs.filter((t: { url: string }) => t.url.startsWith('chrome-extension:'))).toEqual(
    [],
  );
  await agent.cli('set', `${id}`, '-H', 'x-env: a');
  expect((await agent.cli('tabs', '--url', page.url())).out).toEqual({
    tabs: [
      {
        id,
        url: page.url(),
        title: expect.any(String),
        lane: 'custom',
        headers: { 'x-env': 'a' },
        stale: true,
      },
    ],
  });
});

test('set, then navigate: the server sees the headers', async ({ agent, lh }) => {
  const page = await lh.open(lh.url('s0'));
  const tab = await lh.tabId(page);
  const set = await agent.cli('set', `${tab}`, '-H', 'x-env: lane_cli', '-H', 'X-Extra:1');
  expect(set).toEqual({
    code: 0,
    out: { id: tab, lane: 'custom', headers: { 'x-env': 'lane_cli', 'x-extra': '1' }, stale: true },
  });
  await page.goto(lh.url('s'));
  expect((await lh.log('s'))[0]).toMatchObject({ 'x-env': 'lane_cli', 'x-extra': '1' });
  expect((await agent.cli('get', `${tab}`)).out).toEqual({
    id: tab,
    url: page.url(),
    lane: 'custom',
    headers: { 'x-env': 'lane_cli', 'x-extra': '1' },
  });

  // A preset choice wins over own headers of the same name; its headers are not the tab's own.
  await lh.api('preset.save', {
    preset: {
      name: 'staging',
      color: PALETTE[0] as string,
      headers: [
        { name: 'x-env', value: 'staging' },
        { name: 'x-canary', value: '1' },
      ],
      domains: [],
    },
  });
  expect((await agent.cli('set', `${tab}`, '-p', 'staging', '--reload')).out).toEqual({
    id: tab,
    lane: 'staging',
    headers: { 'x-env': 'staging', 'x-canary': '1', 'x-extra': '1' },
  });
  expect(await agent.cli('clear', `${tab}`, 'x-canary')).toEqual({
    code: 1,
    out: {
      error: {
        code: 'NOT_OWN',
        message: `"x-canary" comes from preset staging; run \`lanehead set ${tab} --no-preset\` to drop the preset.`,
      },
    },
  });
  expect((await agent.cli('set', `${tab}`, '--no-preset')).out).toMatchObject({
    lane: 'custom',
    headers: { 'x-extra': '1' },
  });

  // clear by name, then everything.
  await agent.cli('set', `${tab}`, '-H', 'x-env: again');
  expect((await agent.cli('clear', `${tab}`, 'x-extra')).out).toMatchObject({
    headers: { 'x-env': 'again' },
  });
  expect((await agent.cli('clear', `${tab}`)).out).toMatchObject({ lane: null, headers: {} });
  await page.goto(lh.url('c'));
  expect((await lh.log('c'))[0]?.['x-env']).toBeUndefined();
});

test('open: the very first main-frame request carries the headers', async ({ agent, lh }) => {
  // No scheme: 127.* gets http://.
  const url = lh.url('o').replace('http://', '');
  const opened = await agent.cli('open', url, '-H', 'x-env: lane_open');
  expect(opened.out).toEqual({
    id: expect.any(Number),
    lane: 'custom',
    headers: { 'x-env': 'lane_open' },
  });
  await expect.poll(async () => (await lh.log('o')).length).toBe(1);
  expect((await lh.log('o'))[0]).toMatchObject({ 'x-env': 'lane_open' });
});

test('two tabs, two lanes, through the CLI', async ({ agent, lh }) => {
  const pages = [await lh.open(lh.url('a0')), await lh.open(lh.url('b0'))];
  for (const [i, page] of pages.entries()) {
    const set = await agent.cli('set', `${await lh.tabId(page)}`, '-H', `x-env: lane_${i}`);
    expect(set.code).toBe(0);
  }
  await Promise.all(pages.map((page, i) => page.goto(lh.url(`p${i}`))));
  expect((await lh.log('p0'))[0]?.['x-env']).toBe('lane_0');
  expect((await lh.log('p1'))[0]?.['x-env']).toBe('lane_1');
});

test('presets and global', async ({ agent, lh }) => {
  const preset = (name: string, domains: string[]) => ({
    name,
    color: PALETTE[0] as string,
    headers: [{ name: 'x-g', value: name }],
    domains,
  });
  await lh.api('preset.save', { preset: preset('lane_g', []) });
  await lh.api('preset.save', { preset: preset('scoped', ['app.test']) });
  expect((await agent.cli('presets')).out).toEqual({
    presets: [
      { name: 'lane_g', headers: { 'x-g': 'lane_g' } },
      { name: 'scoped', headers: { 'x-g': 'scoped' }, domains: ['app.test'] },
    ],
    global: null,
  });
  expect(await agent.cli('global', 'LANE_G')).toEqual({ code: 0, out: { global: 'lane_g' } });
  expect((await agent.cli('presets')).out.global).toBe('lane_g');
  const page = await lh.open(lh.url('g'));
  expect((await lh.log('g'))[0]).toMatchObject({ 'x-g': 'lane_g' });
  expect((await agent.cli('get', `${await lh.tabId(page)}`)).out).toMatchObject({
    lane: 'lane_g',
    global: true,
  });
  expect((await agent.cli('global', 'off')).out).toEqual({ global: null });
  await page.goto(lh.url('g2'));
  expect((await lh.log('g2'))[0]?.['x-g']).toBeUndefined();
});

test('errors: one JSON line and the exit code', async ({ agent }) => {
  expect(await agent.cli('get', '999999999')).toEqual({
    code: 1,
    out: { error: { code: 'NO_TAB', message: 'No tab 999999999; run `lanehead tabs`.' } },
  });
  expect(await agent.cli('open', 'app.test', '-p', 'nope')).toEqual({
    code: 1,
    out: { error: { code: 'NO_PRESET', message: 'No preset "nope"; run `lanehead presets`.' } },
  });
  expect(await agent.cli('set', 'abc')).toMatchObject({
    code: 2,
    out: { error: { code: 'BAD_REQUEST' } },
  });
  expect(await agent.cli('set', '1')).toEqual({
    code: 2,
    out: { error: { code: 'BAD_REQUEST', message: 'Pass -H, -p, --no-preset or --off.' } },
  });
  expect(await agent.cli('set', '1', '-H', 'x-env=lane_a')).toEqual({
    code: 2,
    out: { error: { code: 'BAD_HEADER', message: `Write "x-env=lane_a" as -H 'x-env: lane_a'.` } },
  });
  // Usage errors from the browser exit 2 too.
  expect(await agent.cli('open', 'ftp://x')).toMatchObject({
    code: 2,
    out: { error: { code: 'BAD_URL' } },
  });
  expect(await agent.cli('get', '1', '-i', 'zzzz')).toMatchObject({
    code: 3,
    out: { error: { code: 'NOT_CONNECTED' } },
  });
});

test('the host survives bad and abandoned requests', async ({ agent, lh }) => {
  const { instance } = await lh.api('status', {});
  const connect = () => net.connect(path.join(agent.home, 'run', `${instance}.sock`));
  const bad = connect();
  const lines = readline.createInterface({ input: bad })[Symbol.asyncIterator]();
  const reply = async () => JSON.parse((await lines.next()).value as string);
  for (const line of ['not json', 'null', '[]', '{"id":1,"op":"tabs","args":null}']) {
    bad.write(`${line}\n`);
    expect(await reply()).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
  }
  // Still serving on the same connection.
  bad.write(`${JSON.stringify({ v: 1, id: 9, op: 'status', args: {} })}\n`);
  expect(await reply()).toMatchObject({ id: 9, ok: true });
  bad.destroy();
  const abandoned = connect();
  abandoned.end(`${JSON.stringify({ v: 1, id: 1, op: 'tabs', args: {} })}\n`);
  abandoned.destroy();
  await new Promise((r) => setTimeout(r, 500));
  expect((await agent.cli('status')).out.instances).toHaveLength(1);
});

test('two browsers: tabs lists both, a tab id finds its browser, the rest needs -i', async ({
  agent,
  lh,
}) => {
  const { context: second, install } = await agent.launch('second');
  // install waited for the new browser, though another one was already connected.
  expect(install.out.instances).toHaveLength(2);
  expect(install.out.hint).not.toContain('No new browser');
  const instances = await waitForInstances(agent, 2);
  const { instance: first } = await lh.api('status', {});
  const other = instances.find((i: { instance: string }) => i.instance !== first).instance;

  const mine = await lh.open(lh.url('m0'));
  const theirs = await second.newPage();
  await theirs.goto(lh.url('t0'));
  const { out } = await agent.cli('tabs', '--url', `${ORIGIN_A}/page`);
  expect(out.tabs).toHaveLength(2);
  expect(out.tabs).toContainEqual({
    id: await lh.tabId(mine),
    url: mine.url(),
    title: expect.any(String),
    i: first,
  });
  const { id } = out.tabs.find((t: { i: string }) => t.i === other);
  expect(out.tabs).toContainEqual({ id, url: theirs.url(), title: expect.any(String), i: other });

  // A raw tab id goes to the browser that has it.
  expect((await agent.cli('set', `${id}`, '-H', 'x-env: second')).out).toMatchObject({ id });
  await theirs.goto(lh.url('t1'));
  expect((await lh.log('t1'))[0]?.['x-env']).toBe('second');
  expect((await agent.cli('get', '999999999')).out.error.code).toBe('NO_TAB');

  const ambiguous = await agent.cli('presets');
  expect(ambiguous).toMatchObject({ code: 2, out: { error: { code: 'AMBIGUOUS_INSTANCE' } } });
  expect(ambiguous.out.error.instances).toHaveLength(2);
  expect((await agent.cli('presets', '-i', other)).code).toBe(0);
});

test('reconnects after the host is killed', async ({ agent, lh }) => {
  await agent.killHosts();
  await waitForInstances(agent, 1);
  const page = await lh.open(lh.url('k0'));
  expect((await agent.cli('set', `${await lh.tabId(page)}`, '-H', 'x-k: 1')).code).toBe(0);
});

test('reconnects after the worker stops, on its alarm', async ({ agent, lh }) => {
  test.setTimeout(90_000);
  await lh.stopWorker();
  // The port closed with the worker, so the host exits.
  await waitForInstances(agent, 0);
  // Nothing wakes the worker but the 30 s alarm.
  await waitForInstances(agent, 1, 45_000);
});

test('agent control off and on; no host after uninstall', async ({ agent, lh }) => {
  await lh.api('settings', { patch: { agentControl: false } });
  await waitForInstances(agent, 0);
  expect(await lh.api('status', {})).toMatchObject({ agent: 'off' });
  expect(await agent.cli('tabs')).toMatchObject({
    code: 3,
    out: { error: { code: 'NOT_CONNECTED', message: expect.stringContaining('agent control') } },
  });

  await lh.api('settings', { patch: { agentControl: true } });
  await waitForInstances(agent, 1);
  expect(await lh.api('status', {})).toMatchObject({ agent: 'connected' });

  const { out } = await agent.cli('uninstall');
  expect(out.removed).toEqual([agent.install.out.manifest, path.join(agent.home, 'host')]);
  await agent.killHosts();
  await expect.poll(async () => (await lh.api('status', {})).agent).toBe('no-host');
  expect((await agent.cli('status')).out).toEqual({
    instances: [],
    hint: expect.stringContaining('lanehead install'),
  });
});

test('control page: a browser-only agent switches a tab with the forms', async ({
  agent,
  lh,
  context,
}) => {
  const [{ ui }] = await waitForInstances(agent, 1);
  expect(await lh.api('status', {})).toMatchObject({ ui });
  await lh.api('preset.save', {
    preset: {
      name: 'staging',
      color: PALETTE[0] as string,
      headers: [{ name: 'x-env', value: 'staging' }],
      domains: [],
    },
  });
  const target = await lh.open(lh.url('u0'));
  const tab = await lh.tabId(target);

  // The full list leaves out the control page and Lanehead's own pages.
  const control = await context.newPage();
  await control.goto(ui);
  await expect(
    control.getByRole('region', { name: `Tab ${tab} · ${await target.title()}` }),
  ).toBeVisible();
  await expect(control.getByRole('region', { name: /· Lanehead$/ })).toHaveCount(0);

  // ?tab=<id>: only that tab, as an agent would open it from tabs_context_mcp.
  await control.goto(`${ui}?tab=${tab}`);
  await expect(control.getByRole('heading', { level: 2 })).toHaveText([
    `Tab ${tab} · ${await target.title()}`,
    'Open new tab',
  ]);
  // Named "Tab <id> · <title>"; the title changes as the tab navigates.
  const section = control.getByRole('region', { name: new RegExp(`^Tab ${tab} · `) });
  const status = control.getByRole('status');
  await section.getByLabel('Headers').fill('X-Env: lane_ui\nx-extra: 1');
  await section.getByRole('button', { name: 'Set headers' }).click();
  await expect(status).toHaveText(
    `Tab ${tab} → custom: x-env=lane_ui, x-extra=1 (reload to apply)`,
  );
  expect(new URL(control.url()).searchParams.get('tab')).toBe(String(tab));
  // The form now shows the tab's own headers.
  await expect(section.getByLabel('Headers')).toHaveValue('x-env: lane_ui\nx-extra: 1');

  await section.getByRole('button', { name: 'Reload' }).click();
  await expect(status).toHaveText(`Reloaded tab ${tab} → custom: x-env=lane_ui, x-extra=1`);
  expect((await lh.log('u0')).at(-1)).toMatchObject({ 'x-env': 'lane_ui', 'x-extra': '1' });

  // Set makes the tab exactly what the form shows: the preset, no own headers.
  await section.getByLabel('Headers').fill('');
  await section.getByLabel('Preset').selectOption('staging');
  await section.getByRole('button', { name: 'Set headers' }).click();
  await expect(status).toHaveText(`Tab ${tab} → staging: x-env=staging (reload to apply)`);
  await target.goto(lh.url('u1'));
  expect((await lh.log('u1'))[0]).toMatchObject({ 'x-env': 'staging' });
  expect((await lh.log('u1'))[0]?.['x-extra']).toBeUndefined();

  // Errors land in the same status line; nothing changes.
  await section.getByLabel('Headers').fill('x-env=lane_b');
  await section.getByRole('button', { name: 'Set headers' }).click();
  await expect(status).toHaveText('Error: Write "x-env=lane_b" as name: value.');
  expect(await lh.api('get', { tab })).toMatchObject({ lane: 'staging' });

  await section.getByRole('button', { name: 'Clear' }).click();
  await expect(status).toHaveText(`Tab ${tab} → no headers (reload to apply)`);

  // Open: the new tab's very first request has the headers.
  const open = control.getByRole('region', { name: 'Open new tab' });
  await open.getByLabel('URL').fill(lh.url('u2'));
  await open.getByLabel('Headers').fill('x-env: opened');
  await open.getByRole('button', { name: 'Open new tab' }).click();
  await expect(status).toHaveText(/^Opened tab \d+ → custom: x-env=opened$/);
  await expect.poll(async () => (await lh.log('u2')).length).toBe(1);
  expect((await lh.log('u2'))[0]).toMatchObject({ 'x-env': 'opened' });
});

test('control page: other origins cannot post, other host names get nothing', async ({
  agent,
  lh,
}) => {
  const [{ ui }] = await waitForInstances(agent, 1);
  const tab = await lh.tabId(await lh.open(lh.url('x0')));

  // A page on another origin (the fixture server) submits a form to the control page.
  const evil = await lh.open(lh.url('x1'));
  const response = evil.waitForResponse(`${ui}set`);
  await evil.evaluate(
    ({ action, tab }) => {
      const form = Object.assign(document.createElement('form'), { method: 'post', action });
      for (const [name, value] of Object.entries({ tab, headers: 'x-env: evil' })) {
        form.append(Object.assign(document.createElement('input'), { name, value }));
      }
      document.body.append(form);
      form.submit();
    },
    { action: `${ui}set`, tab: String(tab) },
  );
  expect((await response).status()).toBe(403);
  expect(await lh.api('get', { tab })).toMatchObject({ lane: null, headers: {} });

  // DNS rebinding: the right address under another name.
  const get = (host: string) =>
    new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
      const { port } = new URL(ui);
      http
        .get({ host: '127.0.0.1', port, path: '/', headers: { host } }, (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => resolve({ status: res.statusCode, body }));
        })
        .on('error', reject);
    });
  const { port } = new URL(ui);
  const rebound = await get(`evil.test:${port}`);
  expect(rebound.status).toBe(421);
  expect(rebound.body).not.toContain('Tab ');
  const ok = await get(`localhost:${port}`);
  expect(ok.status).toBe(200);
  expect(ok.body).toContain(`Tab ${tab} `);
});
