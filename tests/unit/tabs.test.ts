import { describe, expect, it } from 'vitest';
import { applySet } from '@/core/tabs';
import type { Preset, TabState } from '@/core/types';

const staging: Preset = {
  id: 'staging',
  name: 'staging',
  color: '#188038',
  headers: [
    { name: 'x-env', value: 'staging' },
    { name: 'x-canary', value: '1' },
  ],
  domains: [],
};
const h = (name: string, value: string) => ({ name, value });
const cur: TabState = { preset: 'other', headers: [h('x-env', 'mine'), h('x-debug', '1')] };

describe('applySet', () => {
  it('merges headers by name and keeps the preset when none is given', () => {
    expect(applySet(cur, { headers: [h('x-debug', '2'), h('x-new', 'a')] })).toEqual({
      preset: 'other',
      headers: [h('x-env', 'mine'), h('x-debug', '2'), h('x-new', 'a')],
    });
  });

  it('preset choice wins: own headers the preset also sets are dropped', () => {
    expect(applySet(cur, { preset: staging })).toEqual({
      preset: 'staging',
      headers: [h('x-debug', '1')],
    });
  });

  it('headers from the same call still win over the new preset', () => {
    expect(applySet(cur, { preset: staging, headers: [h('x-env', 'call')] })).toEqual({
      preset: 'staging',
      headers: [h('x-debug', '1'), h('x-env', 'call')],
    });
  });

  it('preset null removes the preset and keeps own headers', () => {
    expect(applySet(cur, { preset: null })).toEqual({ headers: cur.headers });
  });

  it('replace: only what the call gives, no preset unless given', () => {
    expect(applySet(cur, { replace: true, headers: [h('a', '1')] })).toEqual({
      headers: [h('a', '1')],
    });
    expect(applySet(cur, { replace: true, preset: staging })).toEqual({
      preset: 'staging',
      headers: [],
    });
    expect(applySet(cur, { replace: true })).toEqual({ headers: [] });
  });

  it('clears off and starts from nothing for a tab without state', () => {
    expect(applySet({ headers: [], off: true }, { headers: [h('a', '1')] })).toEqual({
      headers: [h('a', '1')],
    });
    expect(applySet(undefined, { preset: staging })).toEqual({ preset: 'staging', headers: [] });
  });
});
