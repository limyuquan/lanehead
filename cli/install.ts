/** `install`, `uninstall`, `skill --install`: the files Lanehead puts on this machine. */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTENSION_ID, HOST_NAME } from '../src/shared/ids';
import { type BrowserName, CliError } from './args';
import { hint, type Instance, instances, live } from './client';
import { home, hostScript } from './home';

/** Per-user browser data dirs: [macOS under ~/Library/Application Support, Linux under ~/.config]. */
const DATA_DIRS: Record<BrowserName, [string, string]> = {
  chrome: ['Google/Chrome', 'google-chrome'],
  chromium: ['Chromium', 'chromium'],
  edge: ['Microsoft Edge', 'microsoft-edge'],
  brave: ['BraveSoftware/Brave-Browser', 'BraveSoftware/Brave-Browser'],
  cft: ['Google/ChromeForTesting', 'google-chrome-for-testing'],
};

/** Marks files install writes, so nothing else is overwritten or removed. */
const MARK = '# Written by `lanehead install`.';

/** What install wrote, for uninstall: `<home>/install.json`. */
type Installed = { manifests: string[]; shim?: string };
const recordFile = () => path.join(home(), 'install.json');
const readRecord = (): Installed =>
  existsSync(recordFile()) ? JSON.parse(readFileSync(recordFile(), 'utf8')) : { manifests: [] };

/** A shell script that runs the installed CLI with this node and this home. */
const launcher = (...args: string[]) => {
  const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
  const command = [q(nodePath()), q(hostScript()), ...args, '"$@"'].join(' ');
  return `#!/bin/sh\n${MARK}\nLANEHEAD_HOME=${q(home())} exec ${command}\n`;
};

/**
 * This node, preferably by its name on PATH (e.g. /opt/homebrew/bin/node), which survives
 * upgrades; `process.execPath` is the versioned real path.
 */
function nodePath(): string {
  const real = realpathSync(process.execPath);
  const onPath = (process.env.PATH ?? '')
    .split(':')
    .map((dir) => path.join(dir, 'node'))
    .find((p) => existsSync(p) && realpathSync(p) === real);
  return onPath ?? process.execPath;
}

export async function install(opts: {
  browser: BrowserName;
  userDataDir?: string;
  extensionIds: string[];
}): Promise<{ manifest: string; shim: string | null; instances: Instance[]; hint?: string }> {
  if (process.platform === 'win32') {
    const message = 'Agent control needs macOS or Linux; on Windows, use the Lanehead popup.';
    throw new CliError('BAD_REQUEST', message, 1);
  }
  const before = new Set(await live());
  // The host is this very file, copied so it survives package updates and moves.
  const self = fileURLToPath(import.meta.url);
  mkdirSync(path.dirname(hostScript()), { recursive: true });
  if (self !== hostScript()) copyFileSync(self, hostScript());
  const wrapper = wrapperPath();
  writeFileSync(wrapper, launcher('host'), { mode: 0o755 });

  const [mac, linux] = DATA_DIRS[opts.browser];
  const dataDir = opts.userDataDir
    ? path.resolve(opts.userDataDir)
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', mac)
      : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), linux);
  const manifest = path.join(dataDir, 'NativeMessagingHosts', `${HOST_NAME}.json`);
  mkdirSync(path.dirname(manifest), { recursive: true });
  const origins = [...new Set([EXTENSION_ID, ...opts.extensionIds])].map(
    (id) => `chrome-extension://${id}/`,
  );
  const body = {
    name: HOST_NAME,
    description: 'Lanehead agent bridge',
    path: wrapper,
    type: 'stdio',
    allowed_origins: origins,
  };
  writeFileSync(manifest, `${JSON.stringify(body, null, 2)}\n`);

  // `lanehead` on PATH: only in ~/.local/bin, only if it is on PATH, never over someone else's.
  const bin = path.join(os.homedir(), '.local', 'bin');
  const shim = path.join(bin, 'lanehead');
  const onPath = (process.env.PATH ?? '').split(':').includes(bin);
  const ours = !existsSync(shim) || readFileSync(shim, 'utf8').includes(MARK);
  const placed = existsSync(bin) && onPath && ours;
  if (placed) writeFileSync(shim, launcher(), { mode: 0o755 });

  const record = readRecord();
  writeFileSync(
    recordFile(),
    JSON.stringify({
      manifests: [...new Set([...record.manifests, manifest])],
      ...(placed || record.shim ? { shim } : {}),
    }),
  );

  // The browser retries every 30 s, so a running one connects within that: wait for a browser
  // that was not connected before.
  const deadline = Date.now() + 35_000;
  const fresh = (list: Instance[]) => list.some((i) => !before.has(i.instance));
  let found = await instances();
  while (!fresh(found) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    found = await instances();
  }
  const hints = [
    !placed && `For a \`lanehead\` command, create ${bin}, add it to PATH, and rerun install.`,
    !fresh(found) && hint('No new browser is'),
  ].filter(Boolean);
  return {
    manifest,
    shim: placed ? shim : null,
    instances: found,
    ...(hints.length ? { hint: hints.join(' ') } : {}),
  };
}

const wrapperPath = () => path.join(home(), 'host', 'lanehead-host');

/** Whether `file` is a file whose text passes `test`. */
function holds(file: string, test: (text: string) => boolean): boolean {
  try {
    return test(readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Removes what install wrote, and only while it is still ours: manifests naming our host and
 * wrapper, a launcher with our mark running our host. Recursive only for `<home>/host`. The
 * sockets belong to running hosts and go with them.
 */
export function uninstall(): { removed: string[] } {
  const { manifests, shim } = readRecord();
  const ours = [
    ...manifests.filter((f) =>
      holds(f, (text) => {
        const { name, path: host } = JSON.parse(text);
        return name === HOST_NAME && host === wrapperPath();
      }),
    ),
    ...(shim && holds(shim, (text) => text.includes(MARK) && text.includes(hostScript()))
      ? [shim]
      : []),
  ];
  for (const f of ours) rmSync(f);
  const hostDir = path.dirname(hostScript());
  const removed = existsSync(hostDir) ? [...ours, hostDir] : ours;
  rmSync(hostDir, { recursive: true, force: true });
  rmSync(recordFile(), { force: true });
  return { removed };
}

/** Writes the skill for each agent whose config dir exists: Claude Code, Codex. */
export function installSkill(text: string): { installed: string[] } {
  const installed = ['.claude', '.codex']
    .map((dir) => path.join(os.homedir(), dir))
    .filter((dir) => existsSync(dir))
    .map((dir) => path.join(dir, 'skills', 'lanehead', 'SKILL.md'));
  if (!installed.length) {
    const message =
      'Found neither ~/.claude nor ~/.codex; save the output of `lanehead skill` where your agent reads skills.';
    throw new CliError('BAD_REQUEST', message, 1);
  }
  for (const file of installed) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return { installed };
}
