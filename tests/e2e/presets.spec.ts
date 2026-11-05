import type { Page } from '@playwright/test';
import { PALETTE } from '@/core/badge';
import type { Header } from '@/core/types';
import { ORIGIN_B } from '../../playwright.config';
import { type ChromeGlobal, expect, type Lanehead, test } from './fixtures';

const preset = (name: string, headers: Record<string, string>, domains: string[] = []) => ({
  name,
  color: PALETTE[1] as string,
  headers: Object.entries(headers).map(([n, value]): Header => ({ name: n, value })),
  domains,
});

/** Navigate `page` to a new fixture URL and return the headers of that request. */
const visit = async (lh: Lanehead, page: Page, id: string) => {
  await page.goto(lh.url(id));
  return (await lh.log(id))[0];
};

test('global preset: unassigned and new tabs get it; tabs with own state or off do not', async ({
  context,
  lh,
  serviceWorker,
}) => {
  await lh.api('preset.save', {
    preset: preset('everyone', { 'x-env': 'global', 'x-global': '1' }),
  });
  const plain = await lh.open(lh.url('plain0'));
  const own = await lh.open(lh.url('own0'));
  const off = await lh.open(lh.url('off0'));
  await lh.api('set', { tab: await lh.tabId(own), headers: [{ name: 'x-env', value: 'mine' }] });
  await lh.api('set', { tab: await lh.tabId(off), off: true });
  await lh.api('global', { preset: 'Everyone' });

  expect(await visit(lh, plain, 'plain')).toMatchObject({ 'x-env': 'global', 'x-global': '1' });
  const fresh = await context.newPage();
  expect(await visit(lh, fresh, 'fresh')).toMatchObject({ 'x-env': 'global' });
  const ownHeaders = await visit(lh, own, 'own');
  expect(ownHeaders?.['x-env']).toBe('mine');
  expect(ownHeaders?.['x-global']).toBeUndefined();
  expect((await visit(lh, off, 'off'))?.['x-env']).toBeUndefined();

  const badge = async (page: Page) => {
    const tabId = await lh.tabId(page);
    return serviceWorker.evaluate(
      (id) => (globalThis as unknown as ChromeGlobal).chrome.action.getBadgeText({ tabId: id }),
      tabId,
    );
  };
  expect(await badge(plain)).toBe('eve•');
  expect(await badge(fresh)).toBe('eve•');
  expect(await badge(own)).toBe('mine');
  expect(await badge(off)).toBe('');

  await lh.api('global', { preset: null });
  expect((await visit(lh, plain, 'plain-after'))?.['x-env']).toBeUndefined();
});

test('preset domains scope the preset part; own headers go everywhere', async ({ lh }) => {
  await lh.api('preset.save', {
    preset: preset('scoped', { 'x-env': 'scoped' }, ['localhost']),
  });
  const page = await lh.open(lh.url('d0'));
  await lh.api('set', {
    tab: await lh.tabId(page),
    preset: 'scoped',
    headers: [{ name: 'x-own', value: '1' }],
  });
  await page.goto(lh.url('d', { frame: lh.url('d-frame', { origin: ORIGIN_B }) }));

  const [main] = await lh.log('d');
  expect(main?.['x-env']).toBeUndefined();
  expect(main?.['x-own']).toBe('1');
  expect((await lh.log('d-frame'))[0]).toMatchObject({ 'x-env': 'scoped', 'x-own': '1' });
});

test('editing a preset updates tabs using it; deleting it drops it from them', async ({ lh }) => {
  const saved = await lh.api('preset.save', { preset: preset('lane_edit', { 'x-env': 'v1' }) });
  const page = await lh.open(lh.url('e0'));
  const tab = await lh.tabId(page);
  await lh.api('set', { tab, preset: saved.id });
  expect((await visit(lh, page, 'e1'))?.['x-env']).toBe('v1');

  await lh.api('preset.save', {
    preset: { ...saved, headers: [{ name: 'x-env', value: 'v2' }] },
  });
  expect((await visit(lh, page, 'e2'))?.['x-env']).toBe('v2');
  expect((await lh.api('get', { tab })).headers).toEqual({ 'x-env': 'v2' });

  await lh.api('preset.delete', { id: saved.id });
  expect((await lh.api('get', { tab })).lane).toBeNull();
  expect((await visit(lh, page, 'e3'))?.['x-env']).toBeUndefined();
});

test('open with a preset by name', async ({ lh }) => {
  await lh.api('preset.save', { preset: preset('Lane_B', { 'x-env': 'lane_b' }) });
  const info = await lh.api('open', { url: lh.url('ob'), preset: 'lane_b' });
  expect(info.lane).toBe('Lane_B');
  await expect.poll(async () => (await lh.log('ob'))[0]?.['x-env']).toBe('lane_b');
});
