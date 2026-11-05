/** Where Lanehead keeps its files: `$LANEHEAD_HOME`, default `~/.lanehead`. */
import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const home = (): string => process.env.LANEHEAD_HOME || path.join(os.homedir(), '.lanehead');

/** The installed CLI copy that the browser runs as the native host. */
export const hostScript = (): string => path.join(home(), 'host', 'lanehead.js');

/**
 * The socket directory, created if missing. It must be a real directory owned by this user; it is
 * kept at 0700 so other users can neither reach nor plant sockets.
 */
export function runDir(): string {
  const dir = path.join(home(), 'run');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || stat.uid !== process.getuid?.()) {
    throw new Error(`${dir} must be a directory owned by you; remove it and retry.`);
  }
  chmodSync(dir, 0o700);
  return dir;
}
