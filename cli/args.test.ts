import { describe, expect, it } from 'vitest';
import { CliError, parse, withScheme } from './args';

const fails = (argv: string[]) => {
  try {
    parse(argv);
  } catch (err) {
    return err as CliError;
  }
  throw new Error('parsed');
};

describe('parse', () => {
  it('maps commands to ops, with common options anywhere', () => {
    expect(parse(['-i', 'ab12', 'tabs', '--url', 'Example', '--pretty'])).toEqual({
      kind: 'op',
      op: 'tabs',
      args: { url: 'Example' },
      timeout: 10_000,
      instance: 'ab12',
      pretty: true,
    });
    expect(parse(['global', 'off'])).toMatchObject({ args: { preset: null } });
    expect(parse(['global', 'lane_a'])).toMatchObject({ args: { preset: 'lane_a' } });
    expect(parse(['global'])).toMatchObject({ op: 'global', args: {} });
    expect(parse(['clear', '7', 'a', 'b'])).toMatchObject({ args: { tab: 7, names: ['a', 'b'] } });
    expect(parse(['clear', '7'])).toMatchObject({ args: { tab: 7, names: undefined } });
  });

  it('-H splits on the first colon and validates with the core rules', () => {
    const cmd = parse(['set', '12', '-H', 'X-Env:  lane_a ', '-H', 'url: http://a:1', '-p', 'p']);
    expect(cmd).toMatchObject({
      args: {
        tab: 12,
        preset: 'p',
        headers: [
          { name: 'x-env', value: 'lane_a' },
          { name: 'url', value: 'http://a:1' },
        ],
      },
    });
    expect(fails(['set', '1', '-H', 'a: 1', '-H', 'A: 2'])).toMatchObject({
      code: 'BAD_HEADER',
      exit: 2,
    });
  });

  it('a -H without a colon is a usage error that shows the corrected form', () => {
    expect(fails(['set', '1', '-H', 'x-env=lane_a'])).toMatchObject({
      code: 'BAD_HEADER',
      exit: 2,
      message: `Write "x-env=lane_a" as -H 'x-env: lane_a'.`,
    });
    expect(fails(['open', 'x.test', '-H', 'x-env lane_a']).message).toContain("-H 'x-env: lane_a'");
    expect(fails(['set', '1', '-H', 'novalue']).message).toContain("-H 'novalue: <value>'");
  });

  it('set: --no-preset is preset null; it needs something to do', () => {
    expect(parse(['set', '3', '--no-preset'])).toMatchObject({ args: { tab: 3, preset: null } });
    expect(parse(['set', '3', '--off'])).toMatchObject({ args: { off: true } });
    expect(fails(['set', '3'])).toMatchObject({
      code: 'BAD_REQUEST',
      exit: 2,
      message: 'Pass -H, -p, --no-preset or --off.',
    });
    expect(fails(['set', '3', '--reload', '--replace']).message).toBe(
      'Pass -H, -p, --no-preset or --off.',
    );
    expect(fails(['set', '3', '-p', 'a', '--no-preset'])).toMatchObject({ exit: 2 });
  });

  it('reload takes a tab', () => {
    expect(parse(['reload', '4'])).toMatchObject({ op: 'reload', args: { tab: 4 } });
  });

  it('open gets the longer timeout and a default scheme', () => {
    expect(parse(['open', 'https://x.test', '--focus'])).toMatchObject({
      op: 'open',
      args: { url: 'https://x.test', focus: true },
      timeout: 30_000,
    });
    expect(parse(['open', 'localhost:3000/a'])).toMatchObject({
      args: { url: 'http://localhost:3000/a' },
    });
  });

  it('usage errors exit 2 and say how to run the command', () => {
    for (const argv of [
      ['set', 'abc'],
      ['get'],
      ['tabs', 'extra'],
      ['set', '1', '--focus'],
      ['tabs', '--nope'],
      ['frobnicate'],
      ['install', '--browser', 'safari'],
      ['install', '--extension-id', 'not-an-id'],
    ]) {
      const err = fails(argv);
      expect(err).toBeInstanceOf(CliError);
      expect(err).toMatchObject({ code: 'BAD_REQUEST', exit: 2 });
      expect(err.message).toMatch(/lanehead/);
    }
  });

  it('local commands', () => {
    expect(parse([])).toMatchObject({ kind: 'help' });
    expect(parse(['status'])).toMatchObject({ kind: 'status' });
    expect(parse(['skill', '--install'])).toMatchObject({ kind: 'skill', install: true });
    expect(
      parse(['install', '--user-data-dir', '/p', '--extension-id', 'a'.repeat(32)]),
    ).toMatchObject({
      kind: 'install',
      browser: 'chrome',
      userDataDir: '/p',
      extensionIds: ['a'.repeat(32)],
    });
  });
});

describe('withScheme', () => {
  it.each([
    ['localhost', 'http://localhost'],
    ['localhost:5173/x?y=1', 'http://localhost:5173/x?y=1'],
    ['127.0.0.1:8080', 'http://127.0.0.1:8080'],
    ['[::1]:3000', 'http://[::1]:3000'],
    ['example.com/a', 'https://example.com/a'],
    ['localhost.example.com', 'https://localhost.example.com'],
    ['http://example.com', 'http://example.com'],
    ['ftp://x', 'ftp://x'],
  ])('%s → %s', (url, expected) => {
    expect(withScheme(url)).toBe(expected);
  });

  it.each([
    'hello world',
    'exa<mple.com',
    'foo|bar.com',
    'staging',
    'devbox:3000',
    'https://foo bar',
    '',
  ])('rejects %j', (url) => {
    expect(() => withScheme(url)).toThrow('Pass a URL like https://example.com.');
  });

  it('open: BAD_URL is a usage error', () => {
    expect(fails(['open', 'staging'])).toMatchObject({
      code: 'BAD_URL',
      message: 'Pass a URL like https://example.com.',
      exit: 2,
    });
  });
});
