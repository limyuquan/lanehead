#!/usr/bin/env node
/**
 * Checks a release zip before it ships: its manifest keeps the public `key`, so Chrome gives the
 * unpacked extension the fixed ID that the native host's `allowed_origins` names, and its version
 * matches package.json. Usage: node scripts/verify-zip.mjs .output/lanehead-<version>-chrome.zip
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const zip = process.argv[2];
if (!zip) {
  console.error('usage: node scripts/verify-zip.mjs <zip>');
  process.exit(2);
}
const fail = (message) => {
  console.error(`verify-zip: ${zip}: ${message}`);
  process.exit(1);
};

const manifest = JSON.parse(
  execFileSync('unzip', ['-p', zip, 'manifest.json'], { encoding: 'utf8' }),
);
const ids = readFileSync(new URL('../src/shared/ids.ts', import.meta.url), 'utf8');
const expected = /EXTENSION_ID\s*=\s*'([a-p]{32})'/.exec(ids)?.[1];
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

if (!expected) fail('could not read EXTENSION_ID from src/shared/ids.ts');
if (!manifest.key) fail('manifest.json has no "key" (built with `zip:store`?); use `pnpm zip`');
// Chrome's ID: the first 32 hex digits of SHA-256(public key), with 0-f written as a-p.
const id = [...createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex')]
  .slice(0, 32)
  .map((c) => 'abcdefghijklmnop'[Number.parseInt(c, 16)])
  .join('');
if (id !== expected) fail(`the key gives ID ${id}, not ${expected}`);
if (manifest.version !== version)
  fail(`manifest version ${manifest.version} is not package.json's ${version}`);
console.log(`${zip}: Lanehead ${manifest.version}, ID ${id}`);
