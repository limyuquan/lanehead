/** Talking to connected browsers through their hosts' sockets. */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import type { Preset, Status, TabInfo } from '../src/core/types';
import { CliError, type Command } from './args';
import { isOwnPage, nameOf, presetList, tabDetail, tabEntry, tabResult } from './format';
import { hostScript, runDir } from './home';

export type Instance = Pick<Status, 'instance' | 'label' | 'browser' | 'version'>;

/** "<who> connected; <what to do>." */
export function hint(who = 'No browser is'): string {
  return existsSync(hostScript())
    ? `${who} connected; ask the user to open the browser with the Lanehead extension and its agent control on, then run \`lanehead status\`.`
    : `${who} connected; run \`lanehead install\`, then ask the user to enable the Lanehead extension in the browser.`;
}

/** Errors the caller fixes by changing the command: exit 2. */
const USAGE = new Set(['BAD_HEADER', 'BAD_URL', 'BAD_REQUEST', 'AMBIGUOUS_INSTANCE']);

const socketOf = (instance: string) => path.join(runDir(), `${instance}.sock`);

/** Ids of connected browsers. Sockets nobody listens on are left over from killed hosts: deleted. */
export async function live(): Promise<string[]> {
  const ids = readdirSync(runDir())
    .filter((f) => f.endsWith('.sock'))
    .map((f) => f.slice(0, -5));
  const alive = await Promise.all(
    ids.map(
      (id) =>
        new Promise<boolean>((resolve) => {
          const file = socketOf(id);
          const inode = statSync(file, { throwIfNoEntry: false })?.ino;
          const socket = net.connect(file, () => {
            socket.end();
            resolve(true);
          });
          socket.on('error', (err: NodeJS.ErrnoException) => {
            // Unless a new host has just replaced it.
            const same = statSync(file, { throwIfNoEntry: false })?.ino === inode;
            if (err.code === 'ECONNREFUSED' && same) rmSync(file, { force: true });
            resolve(false);
          });
        }),
    ),
  );
  return ids.filter((_, i) => alive[i]);
}

/** Runs `op` in the browser `instance`. Rejects with a CliError. */
export function request(instance: string, op: string, args: object, timeout = 10_000) {
  return new Promise<unknown>((resolve, reject) => {
    const socket = net.connect(socketOf(instance));
    const fail = (err: CliError) => {
      socket.destroy();
      reject(err);
    };
    const timer = setTimeout(() => {
      const message = `The browser did not answer within ${timeout / 1000} s; retry once, then ask the user to check the browser.`;
      fail(new CliError('INTERNAL', message, 1));
    }, timeout);
    // readline re-emits the socket's errors.
    const lines = readline.createInterface({ input: socket });
    lines.on('error', () => {
      clearTimeout(timer);
      fail(new CliError('NOT_CONNECTED', hint(`Browser ${instance} is not`), 3));
    });
    socket.write(`${JSON.stringify({ v: 1, id: 1, op, args })}\n`);
    lines.once('line', (line) => {
      clearTimeout(timer);
      socket.end();
      const reply = JSON.parse(line);
      if (reply.ok) resolve(reply.result);
      else {
        const { code, message } = reply.error;
        reject(new CliError(code, message, USAGE.has(code) ? 2 : 1));
      }
    });
  });
}

/** Every connected browser, described. */
export async function instances(): Promise<Instance[]> {
  return Promise.all(
    (await live()).map(async (id) => {
      const { instance, label, browser, version } = (await request(id, 'status', {})) as Status;
      return { instance, label, browser, version };
    }),
  );
}

type OpCommand = Extract<Command, { kind: 'op' }>;

/**
 * Runs an op in the browser it belongs to and returns the lean output (cli/format.ts):
 * - `-i`, else `LANEHEAD_INSTANCE`, else the only connected browser;
 * - several connected: `tabs` lists them all, an op on a tab goes to the browser that has the
 *   tab, anything else needs `-i`.
 */
export async function runOp(cmd: OpCommand): Promise<unknown> {
  const { op, args, timeout } = cmd;
  const instance = cmd.instance ?? process.env.LANEHEAD_INSTANCE;
  const ids = instance ? [instance] : await live();
  if (!ids.length) throw new CliError('NOT_CONNECTED', hint(), 3);
  if (op === 'tabs') {
    const lists = await Promise.all(ids.map((id) => request(id, op, args, timeout)));
    const several = ids.length > 1;
    return {
      tabs: (lists as { tabs: TabInfo[] }[]).flatMap(({ tabs }, n) =>
        tabs.filter((t) => !isOwnPage(t)).map((t) => tabEntry(t, several ? ids[n] : undefined)),
      ),
    };
  }
  const target =
    ids.length === 1
      ? (ids[0] as string)
      : 'tab' in args
        ? await holder(ids, args.tab)
        : await ambiguous(ids);
  const result = await request(target, op, args, timeout);
  switch (op) {
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
      const { presets } = (await request(target, 'presets', {})) as { presets: Preset[] };
      return { global: nameOf(presets, (result as { global: string | null }).global) };
    }
    default:
      return result;
  }
}

/** The one browser among `ids` that has tab `tab`. */
async function holder(ids: string[], tab: unknown): Promise<string> {
  const has = await Promise.all(
    ids.map((id) =>
      request(id, 'get', { tab }).then(
        () => true,
        (err: CliError) => {
          if (err.code === 'NO_TAB') return false;
          throw err;
        },
      ),
    ),
  );
  const found = ids.filter((_, n) => has[n]);
  if (found.length === 1) return found[0] as string;
  if (!found.length) throw new CliError('NO_TAB', `No tab ${tab}; run \`lanehead tabs\`.`, 1);
  return ambiguous(found);
}

/** Throws AMBIGUOUS_INSTANCE listing `ids` with their labels. */
async function ambiguous(ids: string[]): Promise<never> {
  const list = (await instances()).filter((i) => ids.includes(i.instance));
  const message = `Several browsers are connected; pass -i <instance>: ${list.map((i) => `${i.instance} (${i.label})`).join(', ')}.`;
  throw new CliError('AMBIGUOUS_INSTANCE', message, 2, {
    instances: list.map(({ instance, label }) => ({ instance, label })),
  });
}
