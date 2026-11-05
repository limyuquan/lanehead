import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { TabInfo } from '../src/core/types';
import { allowedHost, allowedOrigin, describeTab, formArgs, MAX_BODY, readBody } from './ui';

describe('allowedHost', () => {
  it('accepts only our loopback names with our port', () => {
    expect(allowedHost('127.0.0.1:47823', 47823)).toBe(true);
    expect(allowedHost('localhost:47823', 47823)).toBe(true);
  });

  it.each([
    undefined,
    '',
    '127.0.0.1',
    'localhost',
    '127.0.0.1:47824',
    'evil.test:47823',
    'localhost.evil.test:47823',
    '[::1]:47823',
    '0.0.0.0:47823',
    'LOCALHOST:47823x',
  ])('rejects %s', (host) => {
    expect(allowedHost(host, 47823)).toBe(false);
  });
});

describe('allowedOrigin', () => {
  it('accepts our own page and clients that send no Origin', () => {
    expect(allowedOrigin(undefined, 47823)).toBe(true);
    expect(allowedOrigin('http://127.0.0.1:47823', 47823)).toBe(true);
    expect(allowedOrigin('http://localhost:47823', 47823)).toBe(true);
  });

  it.each([
    'null',
    '',
    'http://127.0.0.1:4391',
    'https://127.0.0.1:47823',
    'http://evil.test',
    'http://127.0.0.1:47823/',
  ])('rejects %s', (origin) => {
    expect(allowedOrigin(origin, 47823)).toBe(false);
  });
});

describe('readBody', () => {
  const body = (...parts: string[]) => Readable.from(parts.map((p) => Buffer.from(p)));

  it('joins the chunks', async () => {
    expect(await readBody(body('tab=1&', 'headers=x'))).toBe('tab=1&headers=x');
  });

  it('gives up over the limit', async () => {
    expect(await readBody(body('a'.repeat(MAX_BODY)))).toBe('a'.repeat(MAX_BODY));
    expect(await readBody(body('a'.repeat(MAX_BODY), 'b'))).toBeUndefined();
  });
});

describe('formArgs', () => {
  const form = (fields: Record<string, string>) => new URLSearchParams(fields);

  it('set: exactly the headers and preset the form shows', () => {
    expect(
      formArgs('set', form({ tab: '12', headers: 'X-Env: lane_a\r\n\r\nx-b:1', preset: '' })),
    ).toEqual({
      tab: 12,
      headers: [
        { name: 'x-env', value: 'lane_a' },
        { name: 'x-b', value: '1' },
      ],
      preset: null,
      replace: true,
    });
    expect(formArgs('set', form({ tab: '12', headers: '', preset: 'staging' }))).toEqual({
      tab: 12,
      headers: [],
      preset: 'staging',
      replace: true,
    });
  });

  it('clear and reload: the tab only', () => {
    expect(formArgs('clear', form({ tab: '5', headers: 'junk' }))).toEqual({ tab: 5 });
    expect(formArgs('reload', form({ tab: '5' }))).toEqual({ tab: 5 });
  });

  it('open: a scheme is added; empty preset is left out', () => {
    expect(
      formArgs('open', form({ url: ' localhost:3000 ', headers: 'x: 1', preset: '' })),
    ).toEqual({ url: 'http://localhost:3000', headers: [{ name: 'x', value: '1' }] });
    expect(formArgs('open', form({ url: 'app.test', preset: 'staging' }))).toEqual({
      url: 'https://app.test',
      headers: [],
      preset: 'staging',
    });
  });

  it('bad headers and a missing URL throw with what to do', () => {
    expect(() => formArgs('set', form({ tab: '1', headers: 'x-env=lane_a' }))).toThrow(
      'Write "x-env=lane_a" as name: value.',
    );
    expect(() => formArgs('open', form({ url: ' ' }))).toThrow('Enter a URL to open.');
  });
});

describe('describeTab', () => {
  const tab = (t: Partial<TabInfo>): TabInfo => ({
    id: 7,
    url: 'https://app.test/',
    title: '',
    lane: null,
    global: false,
    headers: {},
    own: [],
    ...t,
  });

  it('says what the tab sends', () => {
    expect(describeTab(tab({ lane: 'lane_a', headers: { 'x-env': 'lane_a', y: '1' } }))).toBe(
      'Tab 7 → lane_a: x-env=lane_a, y=1',
    );
    expect(describeTab(tab({}))).toBe('Tab 7 → no headers');
    expect(describeTab(tab({ lane: 'off' }))).toBe('Tab 7 → off');
    expect(
      describeTab(
        tab({ lane: 'g', global: true, headers: { x: '1' }, stale: true }),
        'Reloaded tab',
      ),
    ).toBe('Reloaded tab 7 → g (all tabs): x=1 (reload to apply)');
  });
});
