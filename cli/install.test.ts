import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOST_NAME } from '../src/shared/ids';
import { install, installed, uninstall } from './install';

// A scratch LANEHEAD_HOME with what install writes, and files beside it that are not ours.
let dir: string;
let home: string;
const write = (file: string, text: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
};
const manifest = (file: string, host: string, name = HOST_NAME) =>
  write(file, JSON.stringify({ name, path: host }));

const realHome = process.env.HOME;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'lh-uninstall-'));
  home = path.join(dir, 'home');
  process.env.LANEHEAD_HOME = home;
  // The browsers' per-user dirs live under HOME: never the real one.
  process.env.HOME = path.join(dir, 'user');
  write(path.join(home, 'host', 'lanehead.js'), '// host');
  write(path.join(home, 'host', 'lanehead-host'), '#!/bin/sh');
});
afterEach(() => {
  delete process.env.LANEHEAD_HOME;
  process.env.HOME = realHome;
  rmSync(dir, { recursive: true, force: true });
});

describe('uninstall', () => {
  it('removes what install wrote while it is still ours, and only that', () => {
    const wrapper = path.join(home, 'host', 'lanehead-host');
    const ours = manifest(path.join(dir, 'a', `${HOST_NAME}.json`), wrapper);
    const replaced = manifest(path.join(dir, 'b', `${HOST_NAME}.json`), '/elsewhere/host');
    const renamed = manifest(path.join(dir, 'c', `${HOST_NAME}.json`), wrapper, 'other.host');
    const broken = write(path.join(dir, 'd', `${HOST_NAME}.json`), 'not json');
    const folder = path.join(dir, 'e');
    write(path.join(folder, 'keep.txt'), 'keep');
    const shim = write(
      path.join(dir, 'bin', 'lanehead'),
      `#!/bin/sh\n# Written by \`lanehead install\`.\nexec node '${path.join(home, 'host', 'lanehead.js')}' "$@"\n`,
    );
    write(
      path.join(home, 'install.json'),
      JSON.stringify({ manifests: [ours, replaced, renamed, broken, folder], shim }),
    );

    expect(uninstall()).toEqual({ removed: [ours, shim, path.join(home, 'host')] });
    for (const kept of [replaced, renamed, broken, path.join(folder, 'keep.txt')]) {
      expect(readFileSync(kept, 'utf8')).toBeTruthy();
    }
  });

  it("keeps a launcher that someone else's file or link replaced", () => {
    const other = write(path.join(dir, 'other-lanehead'), '#!/bin/sh\necho mine\n');
    const shim = path.join(dir, 'bin', 'lanehead');
    mkdirSync(path.dirname(shim));
    symlinkSync(other, shim);
    write(path.join(home, 'install.json'), JSON.stringify({ manifests: [], shim }));
    expect(uninstall()).toEqual({ removed: [path.join(home, 'host')] });
    expect(readFileSync(shim, 'utf8')).toContain('echo mine');
  });
});

describe('installed', () => {
  const wrapper = () => path.join(home, 'host', 'lanehead-host');
  const chromeDir = () =>
    process.platform === 'darwin'
      ? path.join(dir, 'user', 'Library', 'Application Support', 'Google', 'Chrome')
      : path.join(dir, 'user', '.config', 'google-chrome');

  it('is false with no manifest, or one that names another host', () => {
    expect(installed()).toBe(false);
    manifest(path.join(chromeDir(), 'NativeMessagingHosts', `${HOST_NAME}.json`), '/elsewhere');
    expect(installed()).toBe(false);
  });

  it("is true when a browser's manifest names our wrapper, until the host is gone", () => {
    manifest(path.join(chromeDir(), 'NativeMessagingHosts', `${HOST_NAME}.json`), wrapper());
    expect(installed()).toBe(true);
    rmSync(path.join(home, 'host'), { recursive: true });
    expect(installed()).toBe(false);
  });

  it('finds a manifest install recorded for a custom --user-data-dir', () => {
    const custom = manifest(
      path.join(dir, 'p', 'NativeMessagingHosts', `${HOST_NAME}.json`),
      wrapper(),
    );
    expect(installed()).toBe(false);
    write(path.join(home, 'install.json'), JSON.stringify({ manifests: [custom] }));
    expect(installed()).toBe(true);
  });
});

describe('install --no-wait', () => {
  it('registers and returns at once with the no-browser hint', async () => {
    const started = Date.now();
    const out = await install({
      browser: 'chromium',
      userDataDir: path.join(dir, 'profile'),
      extensionIds: [],
      noWait: true,
    });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(out).toEqual({
      manifest: path.join(dir, 'profile', 'NativeMessagingHosts', `${HOST_NAME}.json`),
      shim: null,
      instances: [],
      hint: expect.stringContaining('No new browser is connected'),
    });
    expect(installed()).toBe(true);
  });
});
