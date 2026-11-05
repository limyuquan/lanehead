import { expect, test } from './fixtures';

const lane = [{ name: 'x-env', value: 'lane_a' }];

test('a tab opened from a lane tab inherits it: target=_blank link and window.open', async ({
  context,
  lh,
}) => {
  const parent = await lh.open(lh.url('parent', { link: lh.url('linked') }));
  await lh.api('set', { tab: await lh.tabId(parent), headers: lane });

  const [linked] = await Promise.all([context.waitForEvent('page'), parent.click('#link')]);
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    parent.evaluate((url) => window.open(url), lh.url('opened')),
  ]);
  for (const [page, id] of [
    [linked, 'linked'],
    [popup, 'opened'],
  ] as const) {
    await page.waitForLoadState();
    const tab = await lh.tabId(page);
    await expect
      .poll(async () => (await lh.api('get', { tab })).headers)
      .toEqual({
        'x-env': 'lane_a',
      });
    // The first request races the copy (best effort); later ones always carry it.
    await page.reload();
    expect((await lh.log(id)).at(-1)?.['x-env']).toBe('lane_a');
  }
});

test('no inheritance for tabs the page did not open, or with inheritOnOpen off', async ({
  context,
  lh,
}) => {
  const parent = await lh.open(lh.url('parent', { link: lh.url('child') }));
  await lh.api('set', { tab: await lh.tabId(parent), headers: lane });
  // Opened while the lane tab is active, but not by it (Chrome still reports it as the opener).
  const fresh = await lh.open(lh.url('fresh'));
  await lh.api('settings', { patch: { inheritOnOpen: false } });

  const [child] = await Promise.all([context.waitForEvent('page'), parent.click('#link')]);
  await child.waitForLoadState();
  expect((await lh.api('get', { tab: await lh.tabId(child) })).lane).toBeNull();
  expect((await lh.api('get', { tab: await lh.tabId(fresh) })).lane).toBeNull();
  expect((await lh.log('child'))[0]?.['x-env']).toBeUndefined();
});
