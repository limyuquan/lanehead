/** Command line → command. See docs/CONTRACTS.md section 6. */
import { parseArgs } from 'node:util';
import { parseHeaderLines } from '../src/core/headers';
import type { Op } from '../src/core/types';

/** A failure and its exit status: 1 operation error, 2 usage error, 3 not connected. */
export class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exit: 1 | 2 | 3,
    readonly extra?: object,
  ) {
    super(message);
  }
}

export const BROWSERS = ['chrome', 'chromium', 'edge', 'brave', 'cft'] as const;
export type BrowserName = (typeof BROWSERS)[number];

export type Command = { instance?: string; pretty: boolean } & (
  | { kind: 'op'; op: Op; args: object; timeout: number }
  | { kind: 'status' | 'uninstall' | 'help' }
  | { kind: 'install'; browser: BrowserName; userDataDir?: string; extensionIds: string[] }
  | { kind: 'skill'; install: boolean }
);

const OPTIONS = {
  instance: { type: 'string', short: 'i' },
  pretty: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  url: { type: 'string' },
  header: { type: 'string', short: 'H', multiple: true },
  preset: { type: 'string', short: 'p' },
  replace: { type: 'boolean' },
  off: { type: 'boolean' },
  reload: { type: 'boolean' },
  focus: { type: 'boolean' },
  browser: { type: 'string' },
  'user-data-dir': { type: 'string' },
  'extension-id': { type: 'string', multiple: true },
  install: { type: 'boolean' },
} as const;
const COMMON = ['instance', 'pretty', 'help'];

/** Per command: usage line, its options, min and max positionals. */
const SPECS: Record<string, [usage: string, options: string[], min: number, max: number]> = {
  tabs: ['tabs [--url <text>]', ['url'], 0, 0],
  get: ['get <tab>', [], 1, 1],
  set: [
    "set <tab> [-H 'name: value']... [-p <preset>] [--replace] [--off] [--reload]",
    ['header', 'preset', 'replace', 'off', 'reload'],
    1,
    1,
  ],
  clear: ['clear <tab> [<name>...] [--reload]', ['reload'], 1, Infinity],
  open: [
    "open <url> [-H 'name: value']... [-p <preset>] [--focus]",
    ['header', 'preset', 'focus'],
    1,
    1,
  ],
  presets: ['presets', [], 0, 0],
  global: ['global <preset|off>', [], 1, 1],
  status: ['status', [], 0, 0],
  install: [
    `install [--browser ${BROWSERS.join('|')}] [--user-data-dir <dir>] [--extension-id <id>]`,
    ['browser', 'user-data-dir', 'extension-id'],
    0,
    0,
  ],
  uninstall: ['uninstall', [], 0, 0],
  skill: ['skill [--install]', ['install'], 0, 0],
};

export const HELP = `${Object.values(SPECS)
  .map(([usage]) => `lanehead ${usage}`)
  .join('\n')}\ncommon: -i <instance>, --pretty\n`;

const usageError = (message: string) => new CliError('BAD_REQUEST', message, 2);

export function parse(argv: string[]): Command {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (err) {
    // Node's message: "Unknown option '--x'. To specify a positional …": keep the first sentence.
    const first = (err as Error).message.split('. ')[0]?.replace(/\.$/, '');
    throw usageError(`${first}; see \`lanehead help\`.`);
  }
  const { values: v, positionals } = parsed;
  const [name = 'help', ...rest] = positionals;
  const common = { pretty: !!v.pretty, ...(v.instance !== undefined && { instance: v.instance }) };
  if (v.help || name === 'help') return { ...common, kind: 'help' };

  const spec = SPECS[name];
  if (!spec) throw usageError(`Unknown command "${name}"; see \`lanehead help\`.`);
  const [usage, options, min, max] = spec;
  const fail = (why: string) => usageError(`${why}; run it as: lanehead ${usage}`);
  const stray = Object.keys(v).find((k) => !COMMON.includes(k) && !options.includes(k));
  if (stray) throw fail(`${name} takes no --${stray}`);
  if (rest.length < min || rest.length > max) throw fail(`Wrong number of arguments`);

  const [first = ''] = rest;
  const tab = () => {
    if (!/^\d+$/.test(first)) throw fail(`"${first}" is not a tab id (a number from \`tabs\`)`);
    return Number(first);
  };
  const headers = v.header && parseHeaderLines(v.header.join('\n'));
  const op = (op: Op, args: object, timeout = 10_000): Command => ({
    ...common,
    kind: 'op',
    op,
    args,
    timeout,
  });

  switch (name) {
    case 'tabs':
      return op('tabs', { url: v.url });
    case 'get':
      return op('get', { tab: tab() });
    case 'set':
      return op('set', {
        tab: tab(),
        headers,
        preset: v.preset,
        replace: v.replace,
        off: v.off,
        reload: v.reload,
      });
    case 'clear':
      return op('clear', {
        tab: tab(),
        names: rest.length > 1 ? rest.slice(1) : undefined,
        reload: v.reload,
      });
    case 'open':
      return op('open', { url: first, headers, preset: v.preset, focus: v.focus }, 30_000);
    case 'presets':
      return op('presets', {});
    case 'global':
      return op('global', { preset: first === 'off' ? null : first });
    case 'install': {
      const browser = (v.browser ?? 'chrome') as BrowserName;
      if (!BROWSERS.includes(browser)) throw fail(`Unknown browser "${browser}"`);
      const extensionIds = v['extension-id'] ?? [];
      const bad = extensionIds.find((id) => !/^[a-p]{32}$/.test(id));
      if (bad !== undefined) throw fail(`"${bad}" is not an extension id (32 letters a–p)`);
      const userDataDir = v['user-data-dir'];
      return {
        ...common,
        kind: 'install',
        browser,
        extensionIds,
        ...(userDataDir !== undefined && { userDataDir }),
      };
    }
    case 'skill':
      return { ...common, kind: 'skill', install: !!v.install };
    default:
      return { ...common, kind: name as 'status' | 'uninstall' };
  }
}
