/** The human flows: popup (as a page, `popup.html?tab=<id>`) and manage page. */
import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { PALETTE } from '@/core/badge';
import { EXTENSION_ID } from '@/shared/ids';
import { type ChromeGlobal, expect, type Lanehead, test } from './fixtures';

const preset = (name: string, value: string) => ({
  name,
  color: PALETTE[0] as string,
  headers: [{ name: 'x-env', value }],
  domains: [],
});

/** `x-env` of the latest request the server saw for `id`. */
const lastEnv = async (lh: Lanehead, id: string) => (await lh.log(id)).at(-1)?.['x-env'];

/** Pastes `text` into `field` as a user would (a paste event with clipboard data). */
const paste = (field: Locator, text: string) =>
  field.evaluate((el, t) => {
    const data = new DataTransfer();
    data.setData('text/plain', t);
    (el as HTMLElement).focus();
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, text);

/** Waits until the server has seen `n` requests for `id`. */
const requests = (lh: Lanehead, id: string, n: number) =>
  expect.poll(async () => (await lh.log(id)).length).toBe(n);

test('popup: switch lanes by click and number keys, reload with Enter and R', async ({ lh }) => {
  await lh.api('preset.save', { preset: preset('lane_a', 'a') });
  await lh.api('preset.save', { preset: preset('lane_b', 'b') });
  const page = await lh.open(lh.url('p'));
  const popup = await lh.popup(await lh.tabId(page));
  const lane = popup.getByTestId('lane');
  // With lanes saved, a tab sending nothing is Off, like the Off row.
  await expect(lane).toHaveText('Off');
  await expect(popup.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-current', 'true');
  // Each lane shows its key; the current row shows a check too.
  await expect(popup.getByRole('button', { name: /lane_b/ }).locator('kbd')).toHaveText('2');
  await expect(popup.getByRole('button', { name: /lane_b/ })).toHaveAttribute(
    'aria-keyshortcuts',
    '2',
  );
  await expect(popup.getByRole('button', { name: 'Off' })).toContainText('✓');
  await expect(popup.getByRole('button', { name: 'Off' }).locator('kbd')).toHaveText('0');

  await popup.getByRole('button', { name: /lane_a/ }).click();
  await expect(lane).toHaveText('lane_a');
  await expect(popup.getByRole('button', { name: /lane_a/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(popup.getByRole('button', { name: /lane_b/ }).locator('kbd')).toHaveText('2');
  await expect(popup.getByRole('button', { name: /lane_a/ }).locator('kbd')).toHaveText('1');
  await expect(popup.getByRole('button', { name: /lane_a/ })).toContainText('✓');
  await expect(popup.getByRole('button', { name: /lane_b/ })).not.toContainText('✓');
  // Stale: the band says so (a status), the Reload button shows its key, and main is marked.
  await expect(popup.getByRole('status').filter({ hasText: 'other headers' })).toBeVisible();
  await expect(popup.locator('main')).toHaveAttribute('data-stale', 'true');
  await expect(popup.getByRole('button', { name: 'Reload tab' }).locator('kbd')).toHaveText('R');
  await popup.keyboard.press('Enter'); // focus moved to Reload
  await requests(lh, 'p', 2);
  expect(await lastEnv(lh, 'p')).toBe('a');
  await expect(popup.getByRole('button', { name: /Reload tab/ })).toBeHidden();
  await expect(popup.locator('main')).not.toHaveAttribute('data-stale');

  await popup.keyboard.press('2');
  await expect(lane).toHaveText('lane_b');
  await popup.keyboard.press('r');
  await requests(lh, 'p', 3);
  expect(await lastEnv(lh, 'p')).toBe('b');
  // Wait for the page to commit: it records what the page loaded with.
  await expect(popup.getByRole('button', { name: /Reload tab/ })).toBeHidden();

  await popup.keyboard.press('0');
  await expect(lane).toHaveText('Off');
  await popup.keyboard.press('r');
  await requests(lh, 'p', 4);
  expect(await lastEnv(lh, 'p')).toBeUndefined();
});

/** `lane_a`'s headers as stored. */
const laneHeaders = async (lh: Lanehead, name = 'lane_a') =>
  (await lh.api('presets', {})).presets.find((p) => p.name === name)?.headers;

test('popup: the lane headers are key/value rows saved to the lane: add, invalid name, paste, edit, remove', async ({
  lh,
}) => {
  await lh.api('preset.save', { preset: preset('lane_a', 'a') });
  const page = await lh.open(lh.url('h'));
  const tab = await lh.tabId(page);
  await lh.api('set', { tab, preset: 'lane_a', reload: true });
  // Another tab on the same lane gets every edit.
  const other = await lh.open(lh.url('h-other'));
  await lh.api('set', { tab: await lh.tabId(other), preset: 'lane_a', reload: true });
  await requests(lh, 'h-other', 2);
  const popup = await lh.popup(tab);

  // No extra headers for this tab in the popup any more, nor their help line.
  await expect(popup.getByText(/Extra headers/)).toHaveCount(0);
  await expect(popup.getByText(/paste name: value/)).toHaveCount(0);
  const editor = popup.getByRole('group', { name: 'Lane headers', exact: true });
  await expect(editor.getByLabel('Value of x-env')).toHaveValue('a');
  const add = editor.getByRole('button', { name: 'Add header' });
  await expect(add).toHaveAttribute(
    'title',
    'Saved to the lane lane_a; every tab on this lane gets it.',
  );

  // Add a row; Enter saves it to the lane ("Saved", read out politely) and opens a new row.
  await add.click();
  await expect(editor.getByLabel('Header name').last()).toBeFocused();
  await popup.keyboard.type('x-debug');
  await popup.keyboard.press('Tab');
  await popup.keyboard.type('1');
  await popup.keyboard.press('Enter');
  await expect
    .poll(() => laneHeaders(lh))
    .toEqual([
      { name: 'x-env', value: 'a' },
      { name: 'x-debug', value: '1' },
    ]);
  await expect(popup.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await expect(editor.getByLabel('Header name')).toHaveCount(3);
  await expect(editor.getByLabel('Header name').last()).toBeFocused();
  // Not a header of this tab: the lane's.
  expect((await lh.api('get', { tab })).own).toEqual([]);
  await other.reload();
  await requests(lh, 'h-other', 3);
  expect((await lh.log('h-other')).at(-1)).toMatchObject({ 'x-env': 'a', 'x-debug': '1' });

  // A bad name is shown at its row and nothing is saved.
  await popup.keyboard.type('bad name');
  await popup.keyboard.press('Tab');
  await popup.keyboard.type('1');
  await popup.keyboard.press('Enter');
  const bad = editor.getByRole('group', { name: 'Header bad name' });
  await expect(bad.getByRole('alert')).toHaveText("Header names can't contain spaces.");
  await expect(bad.getByLabel('Header name')).toHaveAttribute('aria-invalid', 'true');
  expect(await laneHeaders(lh)).toHaveLength(2);
  // Remove the row: it was never saved, so it just goes.
  await bad.getByRole('button', { name: 'Remove bad name' }).click();
  await expect(bad).toBeHidden();
  await expect(popup.getByRole('alert')).toBeHidden();

  // Pasting name: value lines into a Name field still splits them into rows, saved in one go.
  await add.click();
  await paste(editor.getByLabel('Header name').last(), "X-Trace: t1\n-H 'x-canary: yes'");
  await expect(editor.getByLabel('Value of x-trace')).toHaveValue('t1');
  await expect(editor.getByLabel('Value of x-canary')).toHaveValue('yes');
  await expect
    .poll(() => laneHeaders(lh))
    .toEqual([
      { name: 'x-env', value: 'a' },
      { name: 'x-debug', value: '1' },
      { name: 'x-trace', value: 't1' },
      { name: 'x-canary', value: 'yes' },
    ]);

  // Edit a value.
  await editor.getByLabel('Value of x-debug').fill('2');
  await editor.getByLabel('Value of x-debug').press('Enter');
  await expect
    .poll(async () => (await laneHeaders(lh))?.[1])
    .toEqual({ name: 'x-debug', value: '2' });

  await editor.getByLabel('Value of x-env').fill('');
  await editor.getByLabel('Value of x-env').press('Enter');
  await expect(popup.getByRole('alert')).toHaveText('Give header "x-env" a value.');
  await editor.getByLabel('Value of x-env').press('Escape');
  await expect(popup.getByRole('alert')).toBeHidden();

  // Remove a lane header.
  await editor.getByRole('button', { name: 'Remove x-trace' }).click();
  await expect
    .poll(() => laneHeaders(lh))
    .toEqual([
      { name: 'x-env', value: 'a' },
      { name: 'x-debug', value: '2' },
      { name: 'x-canary', value: 'yes' },
    ]);
  // Focus moved to the next row's name: R outside the fields reloads.
  await expect(editor.getByLabel('Header name').last()).toBeFocused();
  await popup.evaluate(() => (document.activeElement as HTMLElement).blur());
  await popup.keyboard.press('r');
  await requests(lh, 'h', 3);
  const last = (await lh.log('h')).at(-1);
  expect(last).toMatchObject({ 'x-env': 'a', 'x-debug': '2', 'x-canary': 'yes' });
  expect(last).not.toHaveProperty('x-trace');
});

test('popup: a row missing its value is a draft; Enter adds rows and drops empty ones', async ({
  lh,
}) => {
  await lh.api('preset.save', { preset: preset('lane_a', 'a') });
  const page = await lh.open(lh.url('dr'));
  const tab = await lh.tabId(page);
  await lh.api('set', { tab, preset: 'lane_a' });
  const popup = await lh.popup(tab);
  const names = async () => (await laneHeaders(lh))?.map((h) => h.name);
  const editor = popup.getByRole('group', { name: 'Lane headers', exact: true });
  const away = () => popup.getByRole('button', { name: 'More actions' }).focus();

  // Name typed, value empty, focus moves away: kept as typed, nothing saved, no error.
  await editor.getByRole('button', { name: 'Add header' }).click();
  await editor.getByLabel('Header name').last().fill('x-draft');
  await editor.getByLabel('Value of x-draft').focus();
  await away();
  await expect(editor.getByLabel('Header name').last()).toHaveValue('x-draft');
  await expect(popup.getByRole('alert')).toHaveCount(0);
  expect(await names()).toEqual(['x-env']);

  // Both typed: leaving the row saves it.
  await editor.getByLabel('Value of x-draft').fill('1');
  await away();
  await expect.poll(names).toEqual(['x-env', 'x-draft']);
  await expect(popup.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

  // Enter on the last row (saved already) opens a new row; Enter on that empty row drops it.
  await editor.getByLabel('Value of x-draft').press('Enter');
  await expect(editor.getByLabel('Header name')).toHaveCount(3);
  await expect(editor.getByLabel('Header name').last()).toBeFocused();
  await popup.keyboard.press('Enter');
  await expect(editor.getByLabel('Header name')).toHaveCount(2);
  await expect(editor.getByRole('button', { name: 'Add header' })).toBeFocused();
  // So does Escape.
  await editor.getByRole('button', { name: 'Add header' }).click();
  await expect(editor.getByLabel('Header name')).toHaveCount(3);
  await popup.keyboard.press('Escape');
  await expect(editor.getByLabel('Header name')).toHaveCount(2);

  // Enter (not leaving) checks a draft: a name without a value says so at its row.
  await editor.getByRole('button', { name: 'Add header' }).click();
  await popup.keyboard.type('x-two');
  await popup.keyboard.press('Enter');
  await expect(editor.getByRole('alert')).toHaveText('Give header "x-two" a value.');
  await expect(editor.getByLabel('Header name')).toHaveCount(3);
  expect(await names()).toEqual(['x-env', 'x-draft']);
});

test('popup: a failed save keeps the row and its error; Enter or leaving it sends it again', async ({
  lh,
}) => {
  await lh.api('preset.save', { preset: preset('lane_a', 'a') });
  const page = await lh.open(lh.url('fail'));
  const tab = await lh.tabId(page);
  await lh.api('set', { tab, preset: 'lane_a' });
  const popup = await lh.popup(tab);
  // The next lane saves fail as if the service worker said no; each attempt is counted.
  await popup.evaluate(() => {
    const w = window as unknown as ChromeGlobal & { failSets: number; sets: number };
    const send = w.chrome.runtime.sendMessage.bind(w.chrome.runtime);
    w.failSets = 2;
    w.sets = 0;
    // biome-ignore lint/suspicious/noExplicitAny: a stub of an overloaded function
    (w.chrome.runtime as any).sendMessage = (msg: { op: string }) => {
      if (msg.op !== 'preset.save') return send(msg);
      w.sets++;
      if (w.failSets-- > 0) {
        return Promise.resolve({ ok: false, error: { code: 'INTERNAL', message: 'No luck.' } });
      }
      return send(msg);
    };
  });
  const sets = () => popup.evaluate(() => (window as unknown as { sets: number }).sets);
  const editor = popup.getByRole('group', { name: 'Lane headers', exact: true });
  const away = () => popup.getByRole('button', { name: 'More actions' }).focus();

  await editor.getByRole('button', { name: 'Add header' }).click();
  await editor.getByLabel('Header name').last().fill('x-retry');
  await editor.getByLabel('Value of x-retry').fill('1');
  await editor.getByLabel('Value of x-retry').press('Enter');
  const row = editor.getByRole('group', { name: 'Header x-retry' });
  await expect(row.getByRole('alert')).toHaveText('No luck.');
  // Still the row as typed, not marked saved, and no new row opened.
  await expect(editor.getByLabel('Header name')).toHaveCount(2);
  await expect(editor.getByLabel('Value of x-retry')).toHaveValue('1');
  expect(await sets()).toBe(1);

  // Enter again sends it again (and fails again).
  await editor.getByLabel('Value of x-retry').press('Enter');
  await expect.poll(sets).toBe(2);
  await expect(row.getByRole('alert')).toHaveText('No luck.');

  // Leaving the row sends it again; this time it works.
  await away();
  await expect.poll(sets).toBe(3);
  await expect
    .poll(() => laneHeaders(lh))
    .toEqual([
      { name: 'x-env', value: 'a' },
      { name: 'x-retry', value: '1' },
    ]);
  await expect(popup.getByRole('alert')).toHaveCount(0);
  await expect(popup.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  // Saved now: leaving it again sends nothing.
  await editor.getByLabel('Value of x-retry').focus();
  await away();
  await popup.waitForTimeout(200);
  expect(await sets()).toBe(3);
});

test('popup: headers set for this tab only show read-only, marked, and × takes them away', async ({
  lh,
}) => {
  await lh.api('preset.save', { preset: preset('lane_a', 'a') });
  const page = await lh.open(lh.url('to'));
  const tab = await lh.tabId(page);
  // An agent adds a header for this tab only, and one that replaces the lane's x-env.
  await lh.api('set', {
    tab,
    preset: 'lane_a',
    headers: [
      { name: 'x-debug', value: '1' },
      { name: 'x-env', value: 'mine' },
    ],
  });
  const popup = await lh.popup(tab);
  const debug = popup.getByRole('group', { name: 'Header x-debug, this tab only' });
  await expect(debug).toHaveText(/x-debug\s*1\s*this tab/);
  await expect(debug).toHaveAttribute('title', 'Set for this tab only (e.g. by an agent)');
  // Read-only: no fields to type in; the lane's x-env stays the lane's row.
  await expect(debug.getByRole('textbox')).toHaveCount(0);
  await expect(popup.getByText('this tab', { exact: true })).toHaveCount(2);
  await expect(popup.getByLabel('Value of x-env')).toHaveValue('a');

  // A failed removal says so and keeps focus on ×.
  await failNext(popup, 'clear', 1);
  const remove = popup.getByRole('button', { name: 'Remove x-debug from this tab' });
  await remove.click();
  await expect(debug.getByRole('alert')).toHaveText('No luck.');
  await expect(remove).toBeFocused();
  await remove.click();
  await expect.poll(async () => (await lh.api('get', { tab })).own).toEqual(['x-env']);
  await expect(debug).toBeHidden();
  await expect(popup.getByRole('button', { name: 'Remove x-env from this tab' })).toBeFocused();
  await popup.getByRole('button', { name: 'Remove x-env from this tab' }).click();
  await expect.poll(async () => (await lh.api('get', { tab })).headers).toEqual({ 'x-env': 'a' });
  await expect(popup.getByText('this tab', { exact: true })).toHaveCount(0);
  await expect(popup.getByRole('button', { name: 'Add header' })).toBeFocused();
  // The lane itself never changed.
  expect(await laneHeaders(lh)).toEqual([{ name: 'x-env', value: 'a' }]);
});

test("popup with no lanes: an agent's headers for this tab show read-only, and Off drops them", async ({
  lh,
}) => {
  const page = await lh.open(lh.url('co'));
  const tab = await lh.tabId(page);
  const popup = await lh.popup(tab);
  await expect(popup.getByTestId('lane')).toHaveText('No headers');
  await expect(popup.getByRole('button', { name: 'Off' })).toHaveCount(0);
  // Only creating a lane: no headers just for this tab from the popup.
  await expect(popup.getByRole('heading', { name: 'Create a lane' })).toBeVisible();
  await expect(popup.getByText(/just for this tab/)).toHaveCount(0);
  await expect(popup.getByText(/paste name: value/)).toHaveCount(0);

  await lh.api('set', { tab, headers: [{ name: 'x-env', value: 'mine' }] });
  await expect(popup.getByTestId('lane')).toHaveText('Custom headers');
  await expect(popup.getByRole('group', { name: 'Header x-env, this tab only' })).toBeVisible();
  await expect(popup.getByRole('group', { name: 'Lane headers' })).toHaveCount(0);
  await expect(popup.getByRole('heading', { name: 'Create a lane' })).toHaveCount(0);

  // No lanes, but something to turn off: Off is there (and 0).
  const off = popup.getByRole('button', { name: 'Off' });
  await expect(off).toBeVisible();
  await expect(off).toHaveAttribute('aria-current', 'false');
  await off.click();
  await expect.poll(async () => (await lh.api('get', { tab })).headers).toEqual({});
  await expect(popup.getByTestId('lane')).toHaveText('No headers');
  await expect(popup.getByRole('heading', { name: 'Create a lane' })).toBeVisible();

  await lh.api('set', { tab, headers: [{ name: 'x-env', value: 'again' }] });
  await expect(popup.getByTestId('lane')).toHaveText('Custom headers');
  await popup.locator('body').focus();
  await popup.keyboard.press('0');
  await expect.poll(async () => (await lh.api('get', { tab })).headers).toEqual({});
});

test('popup: save the tab as a preset, and use it for all tabs', async ({ lh }) => {
  await lh.api('preset.save', { preset: preset('lane_a', 'a') });
  const page = await lh.open(lh.url('s'));
  const tab = await lh.tabId(page);
  await lh.api('set', { tab, preset: 'lane_a', headers: [{ name: 'x-debug', value: '1' }] });
  const popup = await lh.popup(tab);
  await expect(popup.getByRole('group', { name: 'Header x-debug, this tab only' })).toBeVisible();

  await popup.getByRole('button', { name: 'More actions' }).click();
  await popup.getByRole('button', { name: 'Save as new lane' }).click();
  await popup.getByLabel('Lane name').fill('lane_a');
  await popup.getByLabel('Lane name').press('Enter');
  await expect(popup.getByRole('alert')).toHaveText('Pick another name: "lane_a" is taken.');
  await popup.getByLabel('Lane name').fill('lane_a_debug');
  await popup.getByLabel('Lane name').press('Enter');
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

test('popup: own headers on a scoped preset say where they go; save as preset keeps the domains', async ({
  lh,
}) => {
  await lh.api('preset.save', {
    preset: { ...preset('scoped', 'a'), domains: ['example.com'] },
  });
  const page = await lh.open(lh.url('sd'));
  const tab = await lh.tabId(page);
  await lh.api('set', { tab, preset: 'scoped', headers: [{ name: 'x-debug', value: '1' }] });
  const popup = await lh.popup(tab);
  await expect(popup.getByText('Only sent to example.com')).toBeVisible();

  await popup.getByRole('button', { name: 'More actions' }).click();
  await popup.getByRole('button', { name: 'Save as new lane' }).click();
  await popup.getByLabel('Lane name').fill('scoped_debug');
  await popup.getByLabel('Lane name').press('Enter');
  await expect(popup.getByTestId('lane')).toHaveText('scoped_debug');
  const saved = (await lh.api('presets', {})).presets.find((p) => p.name === 'scoped_debug');
  expect(saved?.domains).toEqual(['example.com']);
});

test('popup: Reload tab shows while the page is out of date, also after reopening', async ({
  lh,
}) => {
  await lh.api('preset.save', { preset: preset('lane_a', 'a') });
  const page = await lh.open(lh.url('st'));
  const tab = await lh.tabId(page);
  let popup = await lh.popup(tab);
  const reload = () => popup.getByRole('button', { name: /Reload tab/ });
  await expect(reload()).toBeHidden();

  await popup.getByRole('button', { name: /lane_a/ }).click();
  await expect(reload()).toBeVisible();
  await popup.close();
  popup = await lh.popup(tab);
  await expect(reload()).toBeVisible();

  await reload().click();
  await requests(lh, 'st', 2);
  expect(await lastEnv(lh, 'st')).toBe('a');
  await expect(reload()).toBeHidden();
  // A reload from elsewhere (here: the page itself) counts too.
  await lh.api('set', { tab, headers: [{ name: 'x-debug', value: '1' }] });
  await expect(reload()).toBeVisible();
  await page.reload();
  await expect(reload()).toBeHidden();
});

test('popup: follows changes made elsewhere and edits only the header it changed', async ({
  lh,
}) => {
  await lh.api('preset.save', { preset: preset('lane_a', 'a') });
  await lh.api('preset.save', { preset: preset('lane_b', 'b') });
  const page = await lh.open(lh.url('live'));
  const tab = await lh.tabId(page);
  await lh.api('set', { tab, preset: 'lane_a' });
  const popup = await lh.popup(tab);
  const editor = popup.getByRole('group', { name: 'Lane headers', exact: true });

  // An agent switches the tab while the popup is open: the popup edits lane_b now.
  await lh.api('set', { tab, preset: 'lane_b', headers: [{ name: 'x-agent', value: '1' }] });
  await expect(popup.getByTestId('lane')).toHaveText('lane_b');
  await expect(editor.getByLabel('Value of x-env')).toHaveValue('b');
  await expect(popup.getByRole('group', { name: 'Header x-agent, this tab only' })).toBeVisible();

  await editor.getByRole('button', { name: 'Add header' }).click();
  await popup.keyboard.type('x-mine');
  await popup.keyboard.press('Tab');
  await popup.keyboard.type('1');
  await popup.keyboard.press('Enter');
  await expect
    .poll(() => laneHeaders(lh, 'lane_b'))
    .toEqual([
      { name: 'x-env', value: 'b' },
      { name: 'x-mine', value: '1' },
    ]);

  // Someone else edits lane_b meanwhile (the manage page, say); the popup keeps their change.
  const stored = (await lh.api('presets', {})).presets.find((p) => p.name === 'lane_b');
  if (!stored) throw new Error('no lane_b');
  await lh.api('preset.save', {
    preset: { ...stored, headers: [...stored.headers, { name: 'x-other', value: 'o' }] },
  });
  await expect(editor.getByLabel('Value of x-other')).toHaveValue('o');
  const mine = editor.getByLabel('Value of x-mine');
  await mine.fill('2');
  await mine.press('Enter');
  await expect
    .poll(() => laneHeaders(lh, 'lane_b'))
    .toEqual([
      { name: 'x-env', value: 'b' },
      { name: 'x-mine', value: '2' },
      { name: 'x-other', value: 'o' },
    ]);

  // Renaming a header keeps its value and place, and leaves the others alone.
  await editor.getByRole('textbox', { name: 'Header name' }).nth(1).fill('X-Renamed');
  await editor.getByRole('textbox', { name: 'Header name' }).nth(1).press('Enter');
  await expect
    .poll(() => laneHeaders(lh, 'lane_b'))
    .toEqual([
      { name: 'x-env', value: 'b' },
      { name: 'x-renamed', value: '2' },
      { name: 'x-other', value: 'o' },
    ]);
  // lane_a and the tab's own header are untouched.
  expect(await laneHeaders(lh, 'lane_a')).toEqual([{ name: 'x-env', value: 'a' }]);
  expect((await lh.api('get', { tab })).own).toEqual(['x-agent']);
});

test('popup: a tab following the all-tabs lane edits that lane', async ({ lh }) => {
  const staging = await lh.api('preset.save', { preset: preset('staging', 's') });
  await lh.api('global', { preset: staging.id });
  const page = await lh.open(lh.url('gl'));
  const popup = await lh.popup(await lh.tabId(page));
  await expect(popup.getByTestId('lane')).toHaveText('All tabs: staging');
  const editor = popup.getByRole('group', { name: 'Lane headers', exact: true });
  await expect(editor.getByRole('button', { name: 'Add header' })).toHaveAttribute(
    'title',
    'Saved to the lane staging; every tab on this lane gets it.',
  );
  await editor.getByLabel('Value of x-env').fill('s2');
  await editor.getByLabel('Value of x-env').press('Enter');
  await expect.poll(() => laneHeaders(lh, 'staging')).toEqual([{ name: 'x-env', value: 's2' }]);
  // Still following all tabs, not put on the lane itself.
  await expect(popup.getByTestId('lane')).toHaveText('All tabs: staging');
});

test('popup: Off with lanes shows no header editor', async ({ lh }) => {
  await lh.api('preset.save', { preset: preset('lane_a', 'a') });
  const page = await lh.open(lh.url('of'));
  const popup = await lh.popup(await lh.tabId(page));
  await expect(popup.getByTestId('lane')).toHaveText('Off');
  await expect(popup.getByRole('group', { name: 'Lane headers' })).toHaveCount(0);
  await expect(popup.getByRole('button', { name: 'Add header' })).toHaveCount(0);
  await expect(popup.getByRole('heading', { name: 'Create a lane' })).toHaveCount(0);
});

test('long names and values never widen the popup or push manage actions away', async ({
  context,
  lh,
}) => {
  const long = 'lane_backend_feature_login_redirect_12';
  const wide = 'W'.repeat(40);
  const value = 'v'.repeat(192);
  await lh.api('preset.save', { preset: preset(long, value) });
  await lh.api('preset.save', { preset: preset(wide, 'w') });
  const page = await lh.open(lh.url('long'));
  const tab = await lh.tabId(page);
  await lh.api('set', { tab, preset: wide, headers: [{ name: 'x-long', value }] });
  const popup = await lh.popup(tab);
  await popup.setViewportSize({ width: 380, height: 600 });
  await lh.api('global', { preset: wide });

  await popup.getByRole('button', { name: 'More actions' }).click();
  await expect(popup.getByText(/for all tabs/)).toBeVisible();
  expect(await popup.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(380);
  // Cut in the middle: the end (where lanes differ) stays visible; the full name is the title.
  const row = popup.getByRole('button', { name: new RegExp(long) });
  await expect(row.getByTitle(long)).toBeVisible();
  await expect(row.getByText('irect_12', { exact: true })).toBeVisible();
  await expect(popup.getByTitle(value).first()).toBeVisible();

  const manage = await context.newPage();
  await manage.setViewportSize({ width: 1080, height: 720 });
  await manage.goto(`chrome-extension://${EXTENSION_ID}/manage.html#presets`);
  const edit = manage.getByRole('button', { name: `Edit ${wide}` });
  await expect(edit).toBeInViewport();
  expect(await manage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    1080,
  );
});

test('popup first run: create a lane from key/value rows and use it in one step', async ({
  lh,
}) => {
  const page = await lh.open(lh.url('f'));
  const tab = await lh.tabId(page);
  const popup = await lh.popup(tab);
  await popup.getByLabel('Lane name').fill('mine');
  const rows = popup.getByRole('group', { name: 'Headers', exact: true });

  // Paste several lines into the Name field: one row each; a bad one shows its error there.
  await paste(rows.getByLabel('Header name'), 'x-env: first\nX-Canary: 1\nbad name: 2');
  await expect(rows.getByLabel('Header name')).toHaveCount(3);
  await expect(rows.getByLabel('Value of x-canary')).toHaveValue('1');
  await expect(rows.getByRole('alert')).toHaveText("Header names can't contain spaces.");
  await rows.getByRole('button', { name: 'Remove bad name' }).click();
  await expect(rows.getByRole('alert')).toBeHidden();

  // A row missing its value stops the form at that row.
  await rows.getByRole('button', { name: 'Add header' }).click();
  await rows.getByLabel('Header name').last().fill('x-extra');
  await popup.getByRole('button', { name: 'Create and use in this tab' }).click();
  await expect(rows.getByRole('alert')).toHaveText('Give header "x-extra" a value.');
  expect((await lh.api('presets', {})).presets).toEqual([]);
  await rows.getByLabel('Value of x-extra').fill('yes');

  await popup.getByRole('button', { name: 'Create and use in this tab' }).click();
  await expect(popup.getByTestId('lane')).toHaveText('mine');
  expect((await lh.api('get', { tab })).headers).toEqual({
    'x-env': 'first',
    'x-canary': '1',
    'x-extra': 'yes',
  });
});

test('popup on a page that is not a website says so instead of showing its URL', async ({
  context,
  lh,
}) => {
  const blank = await context.newPage();
  const { tabs } = await lh.api('tabs', {});
  const tab = tabs.find((t) => t.url === 'about:blank');
  if (!tab) throw new Error('no blank tab');
  const popup = await lh.popup(tab.id);
  await expect(popup.getByText("This page can't use headers")).toBeVisible();
  await blank.close();
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

  await page.getByRole('button', { name: 'New lane' }).click();
  const form = page.getByRole('form', { name: 'New lane' });
  await form.getByLabel('Name', { exact: true }).fill('lane_a');
  await paste(form.getByLabel('Header name'), 'x-env: a\nx-canary: 1');
  await form.getByLabel('Only send to').fill('example.com, Api.Example.org');
  await form.getByRole('radio', { name: 'Green' }).check();
  await form.getByRole('button', { name: 'Create lane' }).click();
  await expect(form).toBeHidden();

  await page.getByRole('button', { name: 'New lane' }).click();
  await form.getByLabel('Name', { exact: true }).fill('lane_b');
  await form.getByLabel('Header name').fill('x-env b');
  await form.getByLabel('Value of x-env b').fill('b');
  await form.getByRole('button', { name: 'Create lane' }).click();
  await expect(form.getByRole('alert')).toHaveText("Header names can't contain spaces.");
  await form.getByLabel('Header name').fill('x-env');
  await expect(form.getByRole('alert')).toBeHidden();
  await form.getByRole('button', { name: 'Create lane' }).click();

  const rows = page.getByRole('row');
  await expect(rows.nth(1)).toContainText('lane_a');
  await expect(rows.nth(1)).toContainText('example.com, api.example.org');
  await expect(rows.nth(1)).toContainText('lana'); // derived badges differ
  await expect(rows.nth(2)).toContainText('lanb');

  await page.getByRole('button', { name: 'Edit lane_b' }).click();
  const edit = page.getByRole('form', { name: 'Edit lane_b' });
  await expect(edit.getByLabel('Header name')).toHaveValue('x-env');
  await edit.getByLabel('Value of x-env').fill('b2');
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
        { name: 'x-canary', value: '1' },
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
  await expect(page.getByText('No lanes yet.')).toBeVisible();

  await page.getByLabel('Import lanes file').setInputFiles(file);
  await expect(page.getByRole('status')).toHaveText('Imported 2 lanes.');
  const strip = ({ id: _, ...p }: (typeof before)[number]) => p;
  expect((await lh.api('presets', {})).presets.map(strip)).toEqual(before.map(strip));

  // Importing again updates by name instead of duplicating.
  await page.getByLabel('Import lanes file').setInputFiles(file);
  await expect.poll(async () => (await lh.api('presets', {})).presets.length).toBe(2);
});

test('manage: typing in the badge of a new preset stays in the badge', async ({ context, lh }) => {
  const page = await context.newPage();
  await manage(page, 'presets');
  await page.getByRole('button', { name: 'New lane' }).click();
  const form = page.getByRole('form', { name: 'New lane' });
  await expect(form.getByLabel('Name', { exact: true })).toBeFocused();
  await page.keyboard.type('lane_kb');
  await form.getByLabel('Badge').click();
  await page.keyboard.type('TEST');
  await form.getByRole('radio', { name: 'Teal' }).check();
  await page.keyboard.type('x');
  await expect(form.getByLabel('Name', { exact: true })).toHaveValue('lane_kb');
  await expect(form.getByLabel('Badge')).toHaveValue('TEST');
  await form.getByLabel('Header name').fill('x-env');
  await form.getByLabel('Value of x-env').fill('kb');
  await form.getByRole('button', { name: 'Create lane' }).click();
  await expect
    .poll(async () => (await lh.api('presets', {})).presets.map((p) => [p.name, p.badge]))
    .toEqual([['lane_kb', 'TEST']]);
});

test('manage: a malformed import file shows an error and imports nothing', async ({
  context,
  lh,
}) => {
  const errors: Error[] = [];
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e));
  await manage(page, 'presets');
  const input = page.getByLabel('Import lanes file');
  const note = page.getByRole('status');
  const upload = (json: unknown) =>
    input.setInputFiles({
      name: 'presets.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(json)),
    });

  await upload({ presets: [preset('lane_a', 'a')] });
  await expect(note).toHaveText('Imported 1 lane.');

  await upload({ presets: [null] });
  await expect(note).toHaveText('Nothing imported. Entry 1: It is not a lane.');
  await upload({ presets: [preset('lane_b', 'b'), { ...preset('lane_c', 'c'), headers: 'x' }] });
  await expect(note).toHaveText('Nothing imported. "lane_c": Pass headers as a list.');
  await upload({ presets: [{ ...preset('lane_d', 'd'), color: 7 }] });
  await expect(note).toContainText('Nothing imported. "lane_d": Pick a color');
  await upload('nope');
  await expect(note).toHaveText('Choose a JSON file exported from Lanehead.');

  expect((await lh.api('presets', {})).presets.map((p) => p.name)).toEqual(['lane_a']);
  expect(errors).toEqual([]);
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
  await expect(page.getByText('npm i -g lanehead && lanehead install')).toBeVisible();

  await page.getByLabel('Label').fill('Work Chrome');
  await page.getByLabel('Label').press('Enter');
  await expect.poll(async () => (await lh.api('status', {})).label).toBe('Work Chrome');

  // The state follows the bridge live, here and in the popup (this profile has no host).
  const web = await lh.open(lh.url('ag'));
  const popup = await lh.popup(await lh.tabId(web));
  await lh.api('settings', { patch: { agentControl: false } });
  await expect(page.getByTestId('agent-state')).toHaveText('Off');
  await expect(popup.getByTestId('agent-state')).toHaveText('Off');
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByTestId('agent-state')).toHaveText('Bridge not installed');
  await expect(popup.getByTestId('agent-state')).toHaveText('Bridge not installed');
  expect((await lh.api('settings', {})).agentControl).toBe(true);
});

/** The popup's next `n` messages for `op` fail as if the service worker said no. */
const failNext = (popup: Page, op: string, n: number) =>
  popup.evaluate(
    ([op, n]) => {
      const w = window as unknown as ChromeGlobal & { fails: Record<string, number> };
      if (!w.fails) {
        w.fails = {};
        const send = w.chrome.runtime.sendMessage.bind(w.chrome.runtime);
        // biome-ignore lint/suspicious/noExplicitAny: a stub of an overloaded function
        (w.chrome.runtime as any).sendMessage = (msg: { op: string }) => {
          if ((w.fails[msg.op] ?? 0) > 0) {
            w.fails[msg.op] = (w.fails[msg.op] ?? 0) - 1;
            return Promise.resolve({ ok: false, error: { code: 'INTERNAL', message: 'No luck.' } });
          }
          return send(msg);
        };
      }
      w.fails[op] = n;
    },
    [op, n] as const,
  );

/** A tab on `lane_a` with the headers `headers`, its popup open. */
async function lanePopup(lh: Lanehead, id: string, headers: [string, string][]) {
  await lh.api('preset.save', {
    preset: {
      ...preset('lane_a', 'a'),
      headers: headers.map(([name, value]) => ({ name, value })),
    },
  });
  const page = await lh.open(lh.url(id));
  const tab = await lh.tabId(page);
  await lh.api('set', { tab, preset: 'lane_a' });
  const popup = await lh.popup(tab);
  const editor = popup.getByRole('group', { name: 'Lane headers', exact: true });
  const stored = async () =>
    Object.fromEntries(((await laneHeaders(lh)) ?? []).map((h) => [h.name, h.value]));
  return { popup, editor, stored };
}

test('popup: an incomplete saved row says so; a pasted line without a value stays a draft', async ({
  lh,
}) => {
  const { popup, editor, stored } = await lanePopup(lh, 'inc', [['x-env', 'staging']]);
  const away = () => popup.getByRole('button', { name: 'More actions' }).focus();

  // `x-debug:` pasted over a saved row: no value borrowed, nothing saved, the cursor in the value.
  await paste(editor.getByLabel('Header name'), 'x-debug:');
  await expect(editor.getByLabel('Header name')).toHaveValue('x-debug');
  await expect(editor.getByLabel('Value of x-debug')).toHaveValue('');
  await expect(editor.getByLabel('Value of x-debug')).toBeFocused();
  await expect(popup.getByRole('alert')).toHaveCount(0);
  await popup.waitForTimeout(200);
  expect(await stored()).toEqual({ 'x-env': 'staging' });
  // Escape brings the saved header back.
  await popup.keyboard.press('Escape');
  await expect(editor.getByLabel('Value of x-env')).toHaveValue('staging');

  // A saved row left without its value: the error shows, the row stays as typed, nothing changes.
  await editor.getByLabel('Value of x-env').fill('');
  await away();
  await expect(popup.getByRole('alert')).toHaveText('Give header "x-env" a value.');
  await expect(editor.getByLabel('Value of x-env')).toHaveValue('');
  expect(await stored()).toEqual({ 'x-env': 'staging' });
  await editor.getByLabel('Value of x-env').press('Escape');
  await expect(editor.getByLabel('Value of x-env')).toHaveValue('staging');
  await expect(popup.getByRole('alert')).toHaveCount(0);

  // A pasted batch that fails to save: every row in it says so.
  await failNext(popup, 'preset.save', 1);
  await editor.getByRole('button', { name: 'Add header' }).click();
  await paste(editor.getByLabel('Header name').last(), 'x-one: 1\nx-two: 2');
  for (const name of ['x-one', 'x-two']) {
    await expect(
      editor.getByRole('group', { name: `Header ${name}` }).getByRole('alert'),
    ).toHaveText('No luck.');
  }
  expect(await stored()).toEqual({ 'x-env': 'staging' });
});

test('removing a header row moves focus to the next row, the previous one, then Add header', async ({
  context,
  lh,
}) => {
  const { popup, editor, stored } = await lanePopup(lh, 'rm', [
    ['x-env', 'a'],
    ['x-two', '2'],
    ['x-three', '3'],
  ]);
  const nameOf = (value: string) =>
    editor.getByRole('group', { name: `Header ${value}` }).getByLabel('Header name');

  await editor.getByRole('button', { name: 'Remove x-two' }).click();
  await expect(nameOf('x-three')).toBeFocused();
  await editor.getByRole('button', { name: 'Remove x-three' }).click();
  await expect(nameOf('x-env')).toBeFocused();
  await expect.poll(stored).toEqual({ 'x-env': 'a' });
  // A removal that fails keeps focus on ×: here a lane's last header, which it can't lose.
  const remove = editor.getByRole('button', { name: 'Remove x-env' });
  await remove.click();
  await expect(editor.getByRole('alert')).toHaveText('Give the lane at least one header.');
  await expect(remove).toBeFocused();
  expect(await stored()).toEqual({ 'x-env': 'a' });
  // A new row nobody saved just goes; focus moves to the previous row.
  // (Keyboard: the error above it goes when focus leaves ×, which moves "Add header" up.)
  await editor.getByRole('button', { name: 'Add header' }).focus();
  await popup.keyboard.press('Enter');
  await editor.getByRole('button', { name: 'Remove header' }).click();
  await expect(nameOf('x-env')).toBeFocused();

  // Same in the manage page's lane editor.
  const page = await context.newPage();
  await manage(page, 'presets');
  await page.getByRole('button', { name: 'New lane' }).click();
  const form = page.getByRole('form', { name: 'New lane' });
  await paste(form.getByLabel('Header name'), 'x-one: 1\nx-two: 2');
  await form.getByRole('button', { name: 'Remove x-one' }).click();
  await expect(form.getByLabel('Header name')).toHaveValue('x-two');
  await expect(form.getByLabel('Header name')).toBeFocused();
  await form.getByRole('button', { name: 'Remove x-two' }).click();
  await expect(form.getByRole('button', { name: 'Add header' })).toBeFocused();
});

test('popup fits Chrome popup height: 3 lanes, 4 lane headers, stale and a row error', async ({
  lh,
}) => {
  for (const name of ['lane_a', 'lane_b', 'lane_c']) {
    await lh.api('preset.save', {
      preset: {
        ...preset(name, name),
        headers: [
          { name: 'x-env', value: name },
          { name: 'x-canary', value: '1' },
          { name: 'x-region', value: 'eu' },
          { name: 'x-feature', value: 'checkout_v2' },
        ],
      },
    });
  }
  const page = await lh.open(lh.url('fit'));
  const tab = await lh.tabId(page);
  await lh.api('set', { tab, preset: 'lane_a' });
  const popup = await lh.popup(tab);
  await expect(popup.getByRole('button', { name: 'Reload tab' })).toBeVisible();
  await popup.setViewportSize({ width: 380, height: 100 });
  const editor = popup.getByRole('group', { name: 'Lane headers', exact: true });
  await editor.getByRole('button', { name: 'Add header' }).click();
  await popup.keyboard.type('x trace');
  await popup.keyboard.press('Tab');
  await popup.keyboard.type('abc');
  await popup.keyboard.press('Enter');
  await expect(editor.getByRole('alert')).toHaveText("Header names can't contain spaces.");
  expect(await popup.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
    600,
  );
  expect(await popup.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(380);
});

test('popup: the all-tabs lane names itself in the Follow all tabs row', async ({ lh }) => {
  await lh.api('preset.save', { preset: preset('lane_a', 'a') });
  const staging = await lh.api('preset.save', { preset: preset('staging', 's') });
  await lh.api('global', { preset: staging.id });
  const page = await lh.open(lh.url('fol'));
  const popup = await lh.popup(await lh.tabId(page));
  await expect(popup.getByTestId('lane')).toHaveText('All tabs: staging');
  const follow = popup.getByRole('button', { name: 'Follow all tabs (staging)' });
  await expect(follow).toHaveAttribute('aria-current', 'true');
  await expect(follow).toHaveText(/Follow all tabs \(staging\)/);
  await expect(popup.getByRole('button', { name: 'staging', exact: true })).toHaveAttribute(
    'aria-current',
    'false',
  );
});
