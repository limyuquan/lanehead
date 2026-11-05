import { describe, expect, it } from 'vitest';
import { compile, laneOf } from '@/core/compile';
import type { Preset, TabState } from '@/core/types';

const staging: Preset = {
  id: 'staging',
  name: 'lane_a',
  color: '#188038',
  headers: [
    { name: 'x-env', value: 'lane_a' },
    { name: 'x-canary', value: '1' },
  ],
  domains: [],
};
const scoped: Preset = { ...staging, id: 'scoped', name: 'scoped', domains: ['example.com'] };
const set = (headers: Record<string, string>) =>
  Object.entries(headers).map(([header, value]) => ({ header, operation: 'set', value }));

describe('compile', () => {
  it('no global and no tabs: no rules', () => {
    expect(compile([staging], {}, null)).toEqual([]);
  });

  it('global only: rule 1 at priority 1 for every request, main frame included', () => {
    const [rule, ...rest] = compile([staging], {}, 'staging');
    expect(rest).toEqual([]);
    expect(rule).toMatchObject({
      id: 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: set({ 'x-env': 'lane_a', 'x-canary': '1' }),
      },
    });
    expect(rule?.condition).not.toHaveProperty('excludedTabIds');
    expect(rule?.condition).not.toHaveProperty('requestDomains');
    expect(rule?.condition.resourceTypes).toContain('main_frame');
    expect(rule?.condition.resourceTypes).toHaveLength(15);
  });

  it('tab with own headers: one rule for that tab only, all sites', () => {
    const tabs: Record<number, TabState> = {
      7: { headers: [{ name: 'x-env', value: 'lane_a' }] },
    };
    expect(compile([], tabs, null)).toMatchObject([
      {
        id: 1,
        priority: 3,
        condition: { tabIds: [7] },
        action: { requestHeaders: set({ 'x-env': 'lane_a' }) },
      },
    ]);
    expect(compile([], tabs, null)[0]?.condition).not.toHaveProperty('requestDomains');
  });

  it('preset + own: preset part without overridden names, scoped to its domains', () => {
    const tabs = { 7: { preset: 'scoped', headers: [{ name: 'x-env', value: 'mine' }] } };
    expect(compile([scoped], tabs, null)).toMatchObject([
      {
        id: 1,
        priority: 2,
        condition: { tabIds: [7], requestDomains: ['example.com'] },
        action: { requestHeaders: set({ 'x-canary': '1' }) },
      },
      { id: 2, priority: 3, action: { requestHeaders: set({ 'x-env': 'mine' }) } },
    ]);
  });

  it('own headers overriding every preset header: no preset part', () => {
    const own = staging.headers.map((h) => ({ ...h, value: 'x' }));
    expect(
      compile([staging], { 7: { preset: 'staging', headers: own } }, null).map((r) => r.priority),
    ).toEqual([3]);
  });

  it('rule ids are 1, 2, 3… even for tab ids past 2^30', () => {
    const tabs = { 1102822209: { preset: 'staging', headers: [{ name: 'a', value: '1' }] } };
    expect(compile([staging], tabs, 'staging').map((r) => [r.id, r.priority])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it('a domain-scoped global preset keeps its domains', () => {
    expect(compile([scoped], {}, 'scoped')[0]?.condition.requestDomains).toEqual(['example.com']);
  });

  it('tabs with state, off included, are excluded from global; off gets no rule', () => {
    const tabs: Record<number, TabState> = {
      3: { headers: [], off: true },
      5: { preset: 'staging', headers: [] },
    };
    const rules = compile([staging], tabs, 'staging');
    expect(rules.map((r) => [r.priority, r.condition.tabIds])).toEqual([
      [1, undefined],
      [2, [5]],
    ]);
    expect(rules[0]?.condition.excludedTabIds).toEqual([3, 5]);
  });

  it('a tab pointing at a deleted preset gets only its own headers', () => {
    const tabs = { 5: { preset: 'gone', headers: [{ name: 'a', value: '1' }] } };
    expect(compile([staging], tabs, null).map((r) => r.priority)).toEqual([3]);
  });
});

describe('laneOf', () => {
  it('no state: the global preset, or nothing', () => {
    expect(laneOf(undefined, [staging], 'staging')).toMatchObject({ lane: 'lane_a', global: true });
    expect(laneOf(undefined, [staging], null)).toEqual({ lane: null, global: false, headers: [] });
  });

  it('off: no headers even with global on', () => {
    expect(laneOf({ headers: [], off: true }, [staging], 'staging')).toEqual({
      lane: 'off',
      global: false,
      headers: [],
    });
  });

  it('preset + own: preset name, own values win', () => {
    const lane = laneOf(
      { preset: 'staging', headers: [{ name: 'x-env', value: 'mine' }] },
      [staging],
      null,
    );
    expect(lane.lane).toBe('lane_a');
    expect(lane.headers).toEqual([
      { name: 'x-env', value: 'mine' },
      { name: 'x-canary', value: '1' },
    ]);
  });

  it('own headers only: custom', () => {
    expect(laneOf({ headers: [{ name: 'a', value: '1' }] }, [], null).lane).toBe('custom');
  });
});
