/** The human flows: popup (as a page, `popup.html?tab=<id>`) and manage page. */
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { PALETTE } from '@/core/badge';
import { EXTENSION_ID } from '@/shared/ids';
import { expect, type Lanehead, test } from './fixtures';

const preset = (name: string, value: string) => ({
  name,
  color: PALETTE[0] as string,
  headers: [{ name: 'x-env', value }],
  domains: [],
});

/** `x-env` of the latest request the server saw for `id`. */
const lastEnv = async (lh: Lanehead, id: string) => (await lh.log(id)).at(-1)?.['x-env'];

/** Waits until the server has seen `n` requests for `id`. */
const requests = (lh: Lanehead, id: string, n: number) =>
  expect.poll(async () => (await lh.log(id)).length).toBe(n);

test('popup: switch lanes by click and number keys, reload with Enter and R', async ({ lh }) => {
  await lh.api('preset.save', { preset: preset('lane_a', 'a') });
  await lh.api('preset.save', { preset: preset('lane_b', 'b') });
  const page = await lh.open(lh.url('p'));
  const popup = await lh.popup(await lh.tabId(page));
  const lane = popup.getByTestId('lane');
  await expect(lane).toHaveText('No headers');

  await popup.getByRole('button', { name: /lane_a/ }).click();
  await expect(lane).toHaveText('lane_a');
  await expect(popup.getByRole('button', { name: /lane_a/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await popup.keyboard.press('Enter'); // focus moved to Reload
  await requests(lh, 'p', 2);
  expect(await lastEnv(lh, 'p')).toBe('a');
  await expect(popup.getByRole('button', { name: /Reload tab/ })).toBeHidden();

  await popup.keyboard.press('2');
  await expect(lane).toHaveText('lane_b');
  await popup.keyboard.press('r');
  await requests(lh, 'p', 3);
  expect(await lastEnv(lh, 'p')).toBe('b');

  await popup.keyboard.press('0');
  await expect(lane).toHaveText('No headers');
  await popup.keyboard.press('r');
  await requests(lh, 'p', 4);
  expect(await lastEnv(lh, 'p')).toBeUndefined();
});

test('popup: paste headers, edit and remove them inline, errors shown inline', async ({ lh }) => {
  await lh.api('preset.save', { preset: preset('lane_a', 'a') });
  const page = await lh.open(lh.url('h'));
  const tab = await lh.tabId(page);
  await lh.api('set', { tab, preset: 'lane_a' });
  const popup = await lh.popup(tab);
  const add = popup.getByLabel('Add headers');

  await add.fill('nonsense');
  await add.press('Enter');
  await expect(popup.getByRole('alert')).toHaveText('Write "nonsense" as name: value.');

  await add.fill("X-Debug: 1\n-H 'x-env: mine'");
  await add.press('Enter');
  await expect(add).toHaveValue('');
  await expect(popup.getByRole('alert')).toBeHidden();
  // Own x-env overrides the preset's; the preset's is shown struck through.
  expect(await lh.api('get', { tab })).toMatchObject({
    lane: 'lane_a',
    headers: { 'x-env': 'mine', 'x-debug': '1' },
    own: ['x-debug', 'x-env'],
  });
  await expect(popup.locator('dd.line-through')).toHaveText('a');

  const value = popup.getByLabel('Value of x-debug');
  await value.fill('2');
  await value.press('Enter');
  await expect.poll(async () => (await lh.api('get', { tab })).headers['x-debug']).toBe('2');

  await popup.getByLabel('Value of x-env').fill('');
  await popup.getByLabel('Value of x-env').press('Enter');
  await expect(popup.getByRole('alert')).toHaveText('Give header "x-env" a value.');

  await popup.getByRole('button', { name: 'Remove x-env' }).click();
  await expect.poll(async () => (await lh.api('get', { tab })).own).toEqual(['x-debug']);

  await popup.keyboard.press('r');
  await requests(lh, 'h', 2);
  expect((await lh.log('h')).at(-1)).toMatchObject({ 'x-env': 'a', 'x-debug': '2' });
});

test('popup: save the tab as a preset, and use it for all tabs', async ({ lh }) => {
  await lh.api('preset.save', { preset: preset('lane_a', 'a') });
  const page = await lh.open(lh.url('s'));
  const tab = await lh.tabId(page);
  await lh.api('set', { tab, preset: 'lane_a', headers: [{ name: 'x-debug', value: '1' }] });
  const popup = await lh.popup(tab);

  await popup.getByRole('button', { name: 'Save as preset' }).click();
  await popup.getByLabel('Preset name').fill('lane_a');
  await popup.getByLabel('Preset name').press('Enter');
  await expect(popup.getByRole('alert')).toHaveText('Pick another name: "lane_a" is taken.');
  await popup.getByLabel('Preset name').fill('lane_a_debug');
  await popup.getByLabel('Preset name').press('Enter');
  await expect(popup.getByTestId('lane')).toHaveText('lane_a_debug');

  const { presets } = await lh.api('presets', {});
  expect(presets.map((p) => [p.name, p.headers])).toEqual([
    ['lane_a', [{ name: 'x-env', value: 'a' }]],
    [
      'lane_a_debug',
      [
        { name: 'x-env', value: 'a' },
        { name: 'x-debug', value: '1' },
      ],
    ],
  ]);
  expect(await lh.api('get', { tab })).toMatchObject({ lane: 'lane_a_debug', own: [] });

  await popup.getByLabel(/for all tabs/).check();
  await expect.poll(async () => (await lh.api('presets', {})).global).toBe(presets[1]?.id);
  const other = await lh.open(lh.url('s-other'));
  expect((await lh.log('s-other'))[0]).toMatchObject({ 'x-env': 'a', 'x-debug': '1' });
  await expect((await lh.popup(await lh.tabId(other))).getByTestId('lane')).toHaveText(
    'All tabs: lane_a_debug',
  );
});

test('popup first run: create a lane and use it in one step', async ({ lh }) => {
  const page = await lh.open(lh.url('f'));
  const tab = await lh.tabId(page);
  const popup = await lh.popup(tab);
  await popup.getByLabel('Lane name').fill('mine');
  await popup.getByLabel('Headers').fill('x-env: first\nx-canary: 1');
  await popup.getByRole('button', { name: 'Create and use in this tab' }).click();
  await expect(popup.getByTestId('lane')).toHaveText('mine');
  expect((await lh.api('get', { tab })).headers).toEqual({ 'x-env': 'first', 'x-canary': '1' });
});

const manage = async (page: Page, section: string) => {
  await page.goto(`chrome-extension://${EXTENSION_ID}/manage.html#${section}`);
  await page.getByRole('heading', { level: 2 }).waitFor();
};

test('manage: create, edit, reorder, delete presets; export and import round trip', async ({
  context,
  lh,
}) => {
  const page = await context.newPage();
  await manage(page, 'presets');

  await page.getByRole('button', { name: 'New preset' }).click();
  const form = page.getByRole('form', { name: 'New preset' });
  await form.getByLabel('Name').fill('lane_a');
  await form.getByLabel('Headers').fill('x-env: a\nx-use-canary: 1');
  await form.getByLabel('Only send to').fill('example.com, Api.Example.org');
  await form.getByRole('radio', { name: 'Green' }).check();
  await form.getByRole('button', { name: 'Create preset' }).click();
  await expect(form).toBeHidden();

  await page.getByRole('button', { name: 'New preset' }).click();
  await form.getByLabel('Name').fill('lane_b');
  await form.getByLabel('Headers').fill('x-env b');
  await form.getByRole('button', { name: 'Create preset' }).click();
  await expect(form.getByRole('alert')).toHaveText('Write "x-env b" as name: value.');
  await form.getByLabel('Headers').fill('x-env: b');
  await form.getByRole('button', { name: 'Create preset' }).click();

  const rows = page.getByRole('row');
  await expect(rows.nth(1)).toContainText('lane_a');
  await expect(rows.nth(1)).toContainText('example.com, api.example.org');
  await expect(rows.nth(1)).toContainText('lana'); // derived badges differ
  await expect(rows.nth(2)).toContainText('lanb');

  await page.getByRole('button', { name: 'Edit lane_b' }).click();
  const edit = page.getByRole('form', { name: 'Edit lane_b' });
  await edit.getByLabel('Headers').fill('x-env: b2');
  await edit.getByLabel('Badge').fill('B');
  await edit.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Move lane_b up' }).click();
  await expect(rows.nth(1)).toContainText('lane_b');

  const before = (await lh.api('presets', {})).presets;
  expect(before.map((p) => [p.name, p.badge, p.color, p.headers, p.domains])).toEqual([
    ['lane_b', 'B', PALETTE[0], [{ name: 'x-env', value: 'b2' }], []],
    [
      'lane_a',
      undefined,
      PALETTE[1],
      [
        { name: 'x-env', value: 'a' },
        { name: 'x-use-canary', value: '1' },
      ],
      ['example.com', 'api.example.org'],
    ],
  ]);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export' }).click(),
  ]);
  const file = test.info().outputPath('presets.json');
  await download.saveAs(file);
  expect(JSON.parse(await readFile(file, 'utf8')).presets).toHaveLength(2);

  for (const name of ['lane_a', 'lane_b']) {
    await page.getByRole('button', { name: `Edit ${name}` }).click();
    await page.getByRole('button', { name: 'Delete…' }).click();
    await page.getByRole('button', { name: `Delete ${name}` }).click();
    await expect(page.getByRole('button', { name: `Edit ${name}` })).toBeHidden();
  }
  await expect(page.getByText('No presets yet.')).toBeVisible();

  await page.getByLabel('Import presets file').setInputFiles(file);
  await expect(page.getByRole('status')).toHaveText('Imported 2 presets.');
  const strip = ({ id: _, ...p }: (typeof before)[number]) => p;
  expect((await lh.api('presets', {})).presets.map(strip)).toEqual(before.map(strip));

  // Importing again updates by name instead of duplicating.
  await page.getByLabel('Import presets file').setInputFiles(file);
  await expect.poll(async () => (await lh.api('presets', {})).presets.length).toBe(2);
});

test('manage: tabs change lane inline and clear', async ({ context, lh }) => {
  await lh.api('preset.save', { preset: preset('lane_a', 'a') });
  const web = await lh.open(lh.url('t'));
  const tab = await lh.tabId(web);
  const page = await context.newPage();
  await manage(page, 'tabs');

  const select = page.getByLabel(`Lane of ${await web.title()}`);
  await select.selectOption({ label: 'lane_a' });
  await expect.poll(async () => (await lh.api('get', { tab })).lane).toBe('lane_a');
  await page.getByRole('button', { name: 'Reload' }).click();
  await requests(lh, 't', 2);
  expect(await lastEnv(lh, 't')).toBe('a');

  // Live: a change from elsewhere (an agent) shows up without a refresh.
  await lh.api('set', { tab, headers: [{ name: 'x-agent', value: '1' }] });
  await expect(page.getByRole('row', { name: /x-agent/ })).toBeVisible();
  await page.getByRole('button', { name: `Clear ${await web.title()}` }).click();
  await expect.poll(async () => (await lh.api('get', { tab })).lane).toBeNull();
  await expect(select).toHaveValue('off');
});

test('manage: agents shows the bridge state, instance and an editable label', async ({
  context,
  lh,
}) => {
  const page = await context.newPage();
  await manage(page, 'agents');
  const { instance, agent } = await lh.api('status', {});
  await expect(page.getByText(instance, { exact: true })).toBeVisible();
  await expect(page.getByTestId('agent-state')).toHaveText(
    {
      connected: 'Connected',
      connecting: 'Connecting…',
      'no-host': 'Bridge not installed',
      off: 'Off',
    }[agent],
  );
  await expect(page.getByText('npx lanehead install')).toBeVisible();

  await page.getByLabel('Label').fill('Work Chrome');
  await page.getByLabel('Label').press('Enter');
  await expect.poll(async () => (await lh.api('status', {})).label).toBe('Work Chrome');

  await manage(page, 'settings');
  await page.getByLabel(/Agent control/).uncheck();
  await expect.poll(async () => (await lh.api('settings', {})).agentControl).toBe(false);
  await manage(page, 'agents');
  await expect(page.getByTestId('agent-state')).toHaveText('Off');
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect.poll(async () => (await lh.api('settings', {})).agentControl).toBe(true);
});
