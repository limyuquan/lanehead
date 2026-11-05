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

test('set merges, replaces, turns off; clear removes own headers or everything', async ({ lh }) => {
  const page = await lh.open(lh.url('s'));
  const tab = await lh.tabId(page);
  await lh.api('set', { tab, headers: [{ name: 'A', value: '1' }] });
  let info = await lh.api('set', { tab, headers: [{ name: 'b', value: '2' }] });
  expect(info.headers).toEqual({ a: '1', b: '2' });
  info = await lh.api('set', { tab, headers: [{ name: 'c', value: '3' }], replace: true });
  expect(info.headers).toEqual({ c: '3' });
  await expect(lh.api('clear', { tab, names: ['a'] })).rejects.toThrow('NOT_OWN');
  await expect(lh.api('set', { tab, headers: [{ name: 'bad name', value: '1' }] })).rejects.toThrow(
    'BAD_HEADER',
  );
  expect((await lh.api('set', { tab, off: true })).lane).toBe('off');
  expect((await lh.api('set', { tab, headers: lane('x') })).lane).toBe('custom');
  expect((await lh.api('clear', { tab, names: ['x-env'] })).lane).toBeNull();
  expect(await lh.rules()).toEqual([]);
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
