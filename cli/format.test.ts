import { describe, expect, it } from 'vitest';
import type { TabInfo } from '../src/core/types';
import { isOwnPage, presetList, tabDetail, tabEntry, tabResult } from './format';

const tab: TabInfo = {
  id: 7,
  url: 'https://app.test/',
  title: 'App',
  lane: 'staging',
  global: false,
  headers: { 'x-env': 'staging' },
  own: [],
};
const plain: TabInfo = { ...tab, id: 8, lane: null, headers: {} };

describe('lean output', () => {
  it('tab results: id, lane, headers; flags only when true', () => {
    expect(tabResult(tab)).toEqual({ id: 7, lane: 'staging', headers: { 'x-env': 'staging' } });
    expect(tabResult({ ...tab, global: true, stale: true })).toEqual({
      id: 7,
      lane: 'staging',
      headers: { 'x-env': 'staging' },
      global: true,
      stale: true,
    });
    expect(tabResult(plain)).toEqual({ id: 8, lane: null, headers: {} });
    expect(tabDetail(tab)).toEqual({
      id: 7,
      url: 'https://app.test/',
      lane: 'staging',
      headers: { 'x-env': 'staging' },
    });
  });

  it('tabs entries: lane and headers only when set, instance only when given', () => {
    expect(tabEntry(plain)).toEqual({ id: 8, url: 'https://app.test/', title: 'App' });
    expect(tabEntry({ ...plain, lane: 'off' })).toEqual({
      id: 8,
      url: 'https://app.test/',
      title: 'App',
      lane: 'off',
    });
    expect(tabEntry({ ...tab, stale: true }, 'ab12')).toEqual({
      id: 7,
      url: 'https://app.test/',
      title: 'App',
      lane: 'staging',
      headers: { 'x-env': 'staging' },
      stale: true,
      i: 'ab12',
    });
  });

  it("Lanehead's own pages are not listed", () => {
    const page = (url: string) => isOwnPage({ ...tab, url });
    expect(page(`chrome-extension://${'a'.repeat(32)}/manage.html#tabs`)).toBe(true);
    expect(page(`chrome-extension://${'a'.repeat(32)}/popup.html?tab=1`)).toBe(true);
    expect(page(`chrome-extension://${'a'.repeat(32)}/other.html`)).toBe(false);
    expect(page('https://app.test/manage.html')).toBe(false);
  });

  it('presets: names and header maps, domains only when set, global by name', () => {
    const presets = [
      {
        id: 'p1',
        name: 'staging',
        color: '#000',
        headers: [{ name: 'x-env', value: 's' }],
        domains: [],
      },
      {
        id: 'p2',
        name: 'lane_a',
        color: '#000',
        headers: [{ name: 'x-env', value: 'a' }],
        domains: ['app.test'],
      },
    ];
    expect(presetList(presets, 'p2')).toEqual({
      presets: [
        { name: 'staging', headers: { 'x-env': 's' } },
        { name: 'lane_a', headers: { 'x-env': 'a' }, domains: ['app.test'] },
      ],
      global: 'lane_a',
    });
    expect(presetList([], null)).toEqual({ presets: [], global: null });
  });
});
