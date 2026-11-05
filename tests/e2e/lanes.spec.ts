import { PALETTE } from '@/core/badge';
import { ORIGIN_B } from '../../playwright.config';
import { expect, type Lanehead, test } from './fixtures';

const lane = (value: string) => [{ name: 'x-env', value }];
/** `x-env` of the first request the server saw for `id`, once there is one. */
const firstEnv = async (lh: Lanehead, id: string) => {
  await expect.poll(async () => (await lh.log(id)).length).toBeGreaterThan(0);
  return (await lh.log(id))[0]?.['x-env'];
};

test('two tabs send different lanes at the same time: main frame, iframe and fetch', async ({
  lh,
}) => {
  const a = await lh.open(lh.url('a0'));
  const b = await lh.open(lh.url('b0'));
  const plain = await lh.open(lh.url('p0'));
  await lh.api('set', { tab: await lh.tabId(a), headers: lane('lane_a') });
  await lh.api('set', { tab: await lh.tabId(b), headers: lane('lane_b') });

  const visit = (id: string) =>
    lh.url(id, {
      frame: lh.url(`${id}-frame`, { origin: ORIGIN_B }),
      fetch: lh.echo(`${id}-fetch`, ORIGIN_B),
    });
  await Promise.all([a.goto(visit('a')), b.goto(visit('b')), plain.goto(visit('p'))]);

  for (const [id, env] of [
    ['a', 'lane_a'],
    ['b', 'lane_b'],
    ['p', undefined],
  ] as const) {
    expect(await firstEnv(lh, id)).toBe(env);
    expect(await firstEnv(lh, `${id}-frame`)).toBe(env);
    expect(await firstEnv(lh, `${id}-fetch`)).toBe(env);
  }
});

test('open: the very first main-frame request carries the headers', async ({ lh }) => {
  const info = await lh.api('open', { url: lh.url('opened'), headers: lane('lane_o') });
  expect(info).toMatchObject({ lane: 'custom', headers: { 'x-env': 'lane_o' } });
  expect(await firstEnv(lh, 'opened')).toBe('lane_o');
  expect(await lh.log('opened')).toHaveLength(1);
});

/** Saves a preset `name` that sets `x-env: <name>` and `x-canary: 1`. */
const savePreset = (lh: Lanehead, name: string, domains: string[] = []) =>
  lh.api('preset.save', {
    preset: {
      name,
      color: PALETTE[0] as string,
      headers: [...lane(name), { name: 'x-canary', value: '1' }],
      domains,
    },
  });

test('set merges, replaces, turns off; clear removes own headers or everything', async ({ lh }) => {
  const page = await lh.open(lh.url('s'));
  const tab = await lh.tabId(page);
  await savePreset(lh, 'staging');
  await lh.api('set', { tab, headers: [{ name: 'A', value: '1' }, ...lane('mine')] });
  let info = await lh.api('set', { tab, headers: [{ name: 'b', value: '2' }] });
  expect(info.headers).toEqual({ a: '1', 'x-env': 'mine', b: '2' });
  // The preset choice wins over an own header of the same name.
  info = await lh.api('set', { tab, preset: 'staging' });
  expect(info).toMatchObject({ lane: 'staging', own: ['a', 'b'] });
  expect(info.headers).toEqual({ 'x-env': 'staging', 'x-canary': '1', a: '1', b: '2' });
  await expect(lh.api('clear', { tab, names: ['x-canary'] })).rejects.toThrow(
    'NOT_OWN: "x-canary" comes from preset staging; run `lanehead set',
  );
  // Replace drops the preset too.
  info = await lh.api('set', { tab, headers: [{ name: 'c', value: '3' }], replace: true });
  expect(info).toMatchObject({ lane: 'custom', headers: { c: '3' } });
  await expect(lh.api('clear', { tab, names: ['a'] })).rejects.toThrow('NOT_OWN');
  await expect(lh.api('set', { tab, headers: [{ name: 'bad name', value: '1' }] })).rejects.toThrow(
    'BAD_HEADER',
  );
  expect((await lh.api('set', { tab, off: true })).lane).toBe('off');
  expect((await lh.api('set', { tab, headers: lane('x') })).lane).toBe('custom');
  expect((await lh.api('clear', { tab, names: ['x-env'] })).lane).toBeNull();
  expect(await lh.rules()).toEqual([]);
});

test("own headers go only to the preset's domains", async ({ lh }) => {
  await savePreset(lh, 'scoped', ['localhost']);
  const page = await lh.open(lh.url('d0'));
  const tab = await lh.tabId(page);
  await lh.api('set', { tab, preset: 'scoped', headers: [{ name: 'x-own', value: '1' }] });
  await page.goto(lh.url('d', { frame: lh.url('d-frame', { origin: ORIGIN_B }) }));
  await expect.poll(async () => (await lh.log('d-frame')).length).toBe(1);
  expect((await lh.log('d-frame'))[0]).toMatchObject({ 'x-env': 'scoped', 'x-own': '1' });
  const outside = (await lh.log('d'))[0];
  expect(outside?.['x-env']).toBeUndefined();
  expect(outside?.['x-own']).toBeUndefined();
});

test('stale: a change after the page loaded, until it loads again; survives a worker restart', async ({
  lh,
}) => {
  const page = await lh.open(lh.url('st'));
  const tab = await lh.tabId(page);
  expect(await lh.api('get', { tab })).not.toHaveProperty('stale');
  expect(await lh.api('set', { tab, headers: lane('a') })).toMatchObject({ stale: true });
  await lh.stopWorker();
  expect(await lh.api('get', { tab })).toMatchObject({ stale: true });

  await page.reload();
  await expect.poll(async () => (await lh.api('get', { tab })).stale).toBeUndefined();
  // Back to what the page loaded with: not stale.
  await lh.api('set', { tab, headers: lane('b') });
  expect(await lh.api('set', { tab, headers: lane('a') })).not.toHaveProperty('stale');

  // A preset edit makes its tabs stale; the reload op and open never leave a tab stale.
  const { id } = await savePreset(lh, 'edited');
  await lh.api('set', { tab, preset: 'edited' });
  expect(await lh.api('reload', { tab })).not.toHaveProperty('stale');
  await lh.api('preset.save', {
    preset: { id, name: 'edited', color: PALETTE[0] as string, headers: lane('v2'), domains: [] },
  });
  expect(await lh.api('get', { tab })).toMatchObject({ stale: true });
  expect(await lh.api('open', { url: lh.url('st-open'), preset: 'edited' })).not.toHaveProperty(
    'stale',
  );
});

test('reloadOnChange reloads exactly the web tabs a change made stale', async ({ lh }) => {
  await lh.api('settings', { patch: { reloadOnChange: true } });
  const { id } = await savePreset(lh, 'shared');
  const using = await lh.open(lh.url('ro-using'));
  const other = await lh.open(lh.url('ro-other'));
  await lh.open(lh.url('ro-plain'));
  await lh.api('set', { tab: await lh.tabId(using), preset: 'shared' });
  await lh.api('set', { tab: await lh.tabId(other), headers: lane('own') });
  // Each set reloaded its own tab only.
  await expect.poll(async () => (await lh.log('ro-using')).at(-1)?.['x-env']).toBe('shared');
  await expect
    .poll(async () => (await lh.log('ro-other')).map((h) => h['x-env']))
    .toEqual([undefined, 'own']);

  await lh.api('preset.save', {
    preset: { id, name: 'shared', color: PALETTE[0] as string, headers: lane('v2'), domains: [] },
  });
  await expect.poll(async () => (await lh.log('ro-using')).at(-1)?.['x-env']).toBe('v2');
  expect(await lh.log('ro-using')).toHaveLength(3);
  expect(await lh.log('ro-other')).toHaveLength(2);
  expect(await lh.log('ro-plain')).toHaveLength(1);
  expect(await lh.api('get', { tab: await lh.tabId(using) })).not.toHaveProperty('stale');

  // Global reaches the plain tab only.
  await lh.api('global', { preset: 'shared' });
  await expect.poll(async () => (await lh.log('ro-plain')).at(-1)?.['x-env']).toBe('v2');
  expect(await lh.log('ro-using')).toHaveLength(3);
  expect(await lh.log('ro-other')).toHaveLength(2);
});

test('closing a tab removes its rules', async ({ lh }) => {
  const page = await lh.open(lh.url('c'));
  const tab = await lh.tabId(page);
  await lh.api('set', { tab, headers: lane('lane_c') });
  expect((await lh.rules()).map((r) => r.condition.tabIds)).toEqual([[tab]]);
  await page.close();
  await expect.poll(() => lh.rules()).toEqual([]);
  await expect(lh.api('get', { tab })).rejects.toThrow('NO_TAB');
});

test('after a service worker restart, tabs keep their headers and state', async ({
  lh,
  serviceWorker,
}) => {
  const page = await lh.open(lh.url('r0'));
  const tab = await lh.tabId(page);
  await lh.api('set', { tab, headers: lane('lane_r') });
  const started = () => serviceWorker.evaluate(() => performance.timeOrigin);
  const before = await started();

  await lh.stopWorker();
  await page.goto(lh.url('r1'));
  expect(await firstEnv(lh, 'r1')).toBe('lane_r');

  expect((await lh.api('get', { tab })).headers).toEqual({ 'x-env': 'lane_r' });
  expect(await started()).not.toBe(before);
  await lh.api('set', { tab, headers: lane('lane_r2') });
  await page.goto(lh.url('r2'));
  expect(await firstEnv(lh, 'r2')).toBe('lane_r2');
});
