import { describe, expect, it } from 'vitest';
import { CliError, parse } from './args';

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
    expect(parse(['clear', '7', 'a', 'b'])).toMatchObject({ args: { tab: 7, names: ['a', 'b'] } });
    expect(parse(['clear', '7'])).toMatchObject({ args: { tab: 7, names: undefined } });
  });

  it('-H splits on the first colon and validates with the core rules', () => {
    const cmd = parse([
      'set',
      '12',
      '-H',
      'x-env:  lane_a ',
      '-H',
      'url: http://a:1',
      '-p',
      'p',
    ]);
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
    expect(fails(['set', '1', '-H', 'novalue'])).toMatchObject({ code: 'BAD_HEADER' });
    expect(fails(['set', '1', '-H', 'a: 1', '-H', 'A: 2'])).toMatchObject({ code: 'BAD_HEADER' });
  });

  it('open gets the longer timeout', () => {
    expect(parse(['open', 'https://x.test', '--focus'])).toMatchObject({
      op: 'open',
      args: { url: 'https://x.test', focus: true },
      timeout: 30_000,
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
