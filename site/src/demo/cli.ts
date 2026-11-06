/**
 * The demo terminal's `lanehead`: the CLI's own parser (cli/args.ts) and output shapes
 * (cli/format.ts), run against the in-page service worker instead of a native bridge. Prints what
 * the real CLI prints: one line of JSON, or `{"error":{code,message}}`.
 */

import { dispatch } from '@/background/api';
import { LaneheadError, type Preset, type TabInfo } from '@/core/types';
import { CliError, HELP, parse } from '../../../cli/args';
import { isOwnPage, nameOf, presetList, tabDetail, tabEntry, tabResult } from '../../../cli/format';

/** Splits a command line like a POSIX shell would for simple input: quotes and backslashes. */
export function words(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let any = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < line.length) cur += line[++i];
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      any = true;
    } else if (c === '\\' && i + 1 < line.length) {
      cur += line[++i];
      any = true;
    } else if (/\s/.test(c)) {
      if (cur || any) out.push(cur);
      cur = '';
      any = false;
    } else {
      cur += c;
      any = true;
    }
  }
  if (quote) throw new Error('unexpected end of input: unclosed quote');
  if (cur || any) out.push(cur);
  return out;
}

export type Output = { text: string; error?: boolean };

/** Runs one command line. */
export async function run(line: string): Promise<Output> {
  let argv: string[];
  try {
    argv = words(line.trim());
  } catch (err) {
    return { text: `sh: ${(err as Error).message}`, error: true };
  }
  if (!argv.length) return { text: '' };
  const [bin, ...rest] = argv;
  if (bin === 'clear') return { text: '\f' };
  if (bin !== 'lanehead') {
    return { text: `sh: ${bin}: not in this demo (try lanehead help)`, error: true };
  }
  let pretty = false;
  const json = (value: unknown) => JSON.stringify(value, null, pretty ? 2 : 0);
  try {
    const cmd = parse(rest);
    pretty = cmd.pretty;
    switch (cmd.kind) {
      case 'help':
        return { text: HELP.trimEnd() };
      case 'op':
        return { text: json(await runOp(cmd.op, cmd.args)) };
      default:
        return {
          text: `lanehead ${cmd.kind} works on your computer, not in this page. Here the CLI talks to the Lanehead in this page.`,
          error: true,
        };
    }
  } catch (err) {
    const known = err instanceof CliError || err instanceof LaneheadError;
    const { code, message } = known ? err : { code: 'INTERNAL', message: String(err) };
    return { text: json({ error: { code, message } }), error: true };
  }
}

/** cli/client.ts `runOp`, for one connected browser. */
async function runOp(op: string, args: object): Promise<unknown> {
  const result = await dispatch(op, args);
  switch (op) {
    case 'tabs':
      return {
        tabs: (result as { tabs: TabInfo[] }).tabs
          .filter((t) => !isOwnPage(t))
          .map((t) => tabEntry(t)),
      };
    case 'get':
      return tabDetail(result as TabInfo);
    case 'set':
    case 'clear':
    case 'open':
    case 'reload':
      return tabResult(result as TabInfo);
    case 'presets': {
      const { presets, global } = result as { presets: Preset[]; global: string | null };
      return presetList(presets, global);
    }
    case 'global': {
      const { presets } = (await dispatch('presets', {})) as { presets: Preset[] };
      return { global: nameOf(presets, (result as { global: string | null }).global) };
    }
    default:
      return result;
  }
}
