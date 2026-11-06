import { describe, expect, it } from 'vitest';
import { PALETTE } from '@/core/badge';
import {
  mergeHeaders,
  parseHeaderLines,
  splitHeaderLines,
  validateDomains,
  validateHeader,
  validateHeaders,
  validatePreset,
} from '@/core/headers';
import type { Preset } from '@/core/types';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as { code: string }).code;
  }
  return 'no error';
};

describe('validateHeader', () => {
  it('trims both parts and lowercases the name', () => {
    expect(validateHeader({ name: ' X-Env ', value: ' lane_a ' })).toEqual({
      name: 'x-env',
      value: 'lane_a',
    });
  });

  it.each([
    ['empty name', { name: '', value: 'v' }],
    ['space in name', { name: 'x env', value: 'v' }],
    ['colon in name', { name: ':authority', value: 'v' }],
    ['empty value', { name: 'x', value: '  ' }],
    ['too long value', { name: 'x', value: 'v'.repeat(4097) }],
    ['line break in value', { name: 'x', value: 'a\r\nb' }],
    ['NUL in value', { name: 'x', value: 'a\0b' }],
  ])('rejects %s', (_, header) => {
    expect(code(() => validateHeader(header))).toBe('BAD_HEADER');
  });

  it('accepts a 4096-char value', () => {
    expect(validateHeader({ name: 'x', value: 'v'.repeat(4096) }).value).toHaveLength(4096);
  });
});

describe('validateHeaders', () => {
  it('rejects the same name twice, in any case', () => {
    const headers = [
      { name: 'X-A', value: '1' },
      { name: 'x-a', value: '2' },
    ];
    expect(code(() => validateHeaders(headers))).toBe('BAD_HEADER');
  });
});

describe('parseHeaderLines', () => {
  it('reads pasted lines: first colon splits, blank lines and curl -H wrappers are fine', () => {
    const text = "X-Env: lane_a\n\n  -H 'x-trace: a:b'\r\nx-canary:1\n";
    expect(parseHeaderLines(text)).toEqual([
      { name: 'x-env', value: 'lane_a' },
      { name: 'x-trace', value: 'a:b' },
      { name: 'x-canary', value: '1' },
    ]);
  });

  it('rejects a line without a name and colon, and bad headers', () => {
    expect(code(() => parseHeaderLines('x-env lane_a'))).toBe('BAD_HEADER');
    expect(code(() => parseHeaderLines(': value'))).toBe('BAD_HEADER');
    expect(code(() => parseHeaderLines('bad name: 1'))).toBe('BAD_HEADER');
  });
});

describe('splitHeaderLines', () => {
  it('splits pasted lines like parseHeaderLines, without validating', () => {
    expect(splitHeaderLines("X-Env: lane_a\n\n-H 'x-trace: a:b'\nx-canary\nbad name: 1")).toEqual([
      { name: 'X-Env', value: ' lane_a' },
      { name: 'x-trace', value: ' a:b' },
      { name: 'x-canary', value: '' },
      { name: 'bad name', value: ' 1' },
    ]);
  });
});

describe('mergeHeaders', () => {
  it('replaces same names in place and appends new ones', () => {
    const base = [
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
    ];
    const over = [
      { name: 'c', value: '3' },
      { name: 'a', value: 'x' },
    ];
    expect(mergeHeaders(base, over)).toEqual([
      { name: 'a', value: 'x' },
      { name: 'b', value: '2' },
      { name: 'c', value: '3' },
    ]);
  });
});

describe('validateDomains', () => {
  it('trims, lowercases and dedupes bare hosts and IPs', () => {
    expect(validateDomains([' Example.com', 'example.com', '127.0.0.1', 'localhost'])).toEqual([
      'example.com',
      '127.0.0.1',
      'localhost',
    ]);
  });

  it.each(['https://example.com', 'example.com/path', 'example.com:8080', '*.example.com', ''])(
    'rejects %j',
    (domain) => {
      expect(code(() => validateDomains([domain]))).toBe('BAD_REQUEST');
    },
  );
});

describe('validatePreset', () => {
  const input = {
    name: ' team_checkout ',
    color: PALETTE[0] as string,
    badge: '',
    headers: [{ name: 'X-Env', value: 'team_checkout' }],
    domains: [],
  };
  const other: Preset = { ...input, id: 'p1', name: 'staging' };

  it('normalizes name, headers and an empty badge', () => {
    expect(validatePreset(input, [other])).toEqual({
      name: 'team_checkout',
      color: PALETTE[0],
      headers: [{ name: 'x-env', value: 'team_checkout' }],
      domains: [],
    });
  });

  it.each([
    ['a taken name (any case)', { name: 'STAGING' }],
    ['an empty name', { name: ' ' }],
    ['a 41-char name', { name: 'n'.repeat(41) }],
    ['a reserved lane name', { name: 'Off' }],
    ['a color outside the palette', { color: '#123456' }],
    ['a 5-char badge', { badge: 'abcde' }],
  ])('rejects %s', (_, patch) => {
    expect(code(() => validatePreset({ ...input, ...patch }, [other]))).toBe('BAD_REQUEST');
  });

  it('rejects a preset without headers', () => {
    expect(code(() => validatePreset({ ...input, headers: [] }, []))).toBe('BAD_HEADER');
  });
});
