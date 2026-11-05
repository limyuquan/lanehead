import { describe, expect, it } from 'vitest';
import { badgeOf, CUSTOM_COLOR, deriveBadge, titleOf } from '@/core/badge';
import type { Lane } from '@/core/compile';
import type { Preset } from '@/core/types';

describe('deriveBadge', () => {
  it.each([
    ['lane_a', 'claw'], // prefix dropped
    ['staging-x1-feature', 'x1fe'], // up to the first separator only
    ['lane_a', 'lane'], // too little left after the separator: keep the prefix
    ['Staging', 'stag'], // no separator
    ['ab', 'ab'],
  ])('%s → %s', (text, badge) => {
    expect(deriveBadge(text)).toBe(badge);
  });
});

describe('badgeOf / titleOf', () => {
  const preset: Preset = {
    id: 'p1',
    name: 'lane_a',
    color: '#188038',
    headers: [{ name: 'x-env', value: 'lane_a' }],
    domains: [],
  };
  const lane = (l: Partial<Lane>): Lane => ({ lane: null, global: false, headers: [], ...l });

  it('preset: derived badge in its color, or its own badge', () => {
    const l = lane({ lane: preset.name, headers: preset.headers, preset });
    expect(badgeOf(l)).toEqual({ text: 'claw', color: '#188038' });
    expect(badgeOf({ ...l, preset: { ...preset, badge: 'staging' } })?.text).toBe('staging');
  });

  it('global only: 3 chars and a dot', () => {
    const l = lane({ lane: preset.name, global: true, headers: preset.headers, preset });
    expect(badgeOf(l)).toEqual({ text: 'cla•', color: '#188038' });
  });

  it('custom: derived from the first own value, grey', () => {
    const l = lane({ lane: 'custom', headers: [{ name: 'x-env', value: 'lane_feed' }] });
    expect(badgeOf(l)).toEqual({ text: 'feed', color: CUSTOM_COLOR });
  });

  it('off and none: no badge', () => {
    expect(badgeOf(lane({ lane: 'off' }))).toBeNull();
    expect(badgeOf(lane({}))).toBeNull();
  });

  it('title lists the headers, or says there are none', () => {
    const headers = [
      { name: 'x-env', value: 'lane_a' },
      { name: 'x-canary', value: '1' },
    ];
    expect(titleOf(lane({ lane: 'custom', headers }))).toBe(
      'Lanehead — custom: x-env=lane_a, x-canary=1',
    );
    expect(titleOf(lane({ lane: 'off' }))).toBe('Lanehead — no headers');
  });
});
