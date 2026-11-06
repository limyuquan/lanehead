/**
 * The header echo page for media captures: a real HTTPS server on loopback that renders, for any
 * `*.example.com` URL, the request headers it received. The browser reaches it through
 * `--host-resolver-rules`, so the headers on screen are exactly what Lanehead's rules sent
 * (Playwright routes would show headers from before the extension's rules apply).
 *
 * The certificate is self-signed, made with `openssl` per run; the browser runs with
 * `--ignore-certificate-errors`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

/** Page titles by path; anything else is titled after its path. */
const TITLES: Record<string, string> = {
  '/cart': 'Cart — Example Shop',
  '/search': 'Search: lamp — Example Shop',
  '/account': 'Your account — Example Shop',
  '/orders': 'Orders · Admin',
  '/api': 'API reference',
};

/** Headers the browser always sends that say nothing here. */
const NOISE = new Set(['connection', 'upgrade-insecure-requests', 'cache-control', 'priority']);

const esc = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function page(url: URL, headers: Record<string, string>): string {
  const title = TITLES[url.pathname] ?? url.pathname;
  const names = Object.keys(headers).filter((n) => !NOISE.has(n));
  // x- headers in the order they arrived (a lane's own order); the rest alphabetically.
  const custom = names.filter((n) => n.startsWith('x-'));
  const rest = names.filter((n) => !n.startsWith('x-')).sort();
  const row = (n: string, cls: string) =>
    `<div class="row ${cls}" data-h="${esc(n)}"><span class="n">${esc(n)}</span><span class="v">${esc(headers[n] ?? '')}</span></div>`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width">
<link rel="icon" href="data:,">
<style>
  :root { color-scheme: dark light; --bg:#121110; --ink:#ecebe8; --muted:#8f8b85; --faint:#5f5b56;
    --line:#2a2825; --hi:#1d1b19; --mark:#e9b872; }
  @media (prefers-color-scheme: light) { :root { --bg:#fbfaf8; --ink:#1d1c1a; --muted:#6f6b65;
    --faint:#a5a19b; --line:#e8e5e0; --hi:#f3f0eb; --mark:#a8661a; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font: 14px/1.45 ui-sans-serif, -apple-system, system-ui, sans-serif; }
  main { padding: 34px 40px; max-width: 680px; }
  .where { font: 12px ui-monospace, "SF Mono", Menlo, monospace; color: var(--muted); margin:0; }
  h1 { font-size: 22px; font-weight: 600; letter-spacing: -0.01em; margin: 6px 0 2px; }
  .sub { color: var(--muted); margin: 0 0 22px; }
  .rows { font: 13px/1.5 ui-monospace, "SF Mono", Menlo, monospace; }
  .row { display:flex; gap: 16px; padding: 5px 0; border-top: 1px solid var(--line); min-width:0; }
  .n { flex: 0 0 150px; color: var(--muted); }
  .v { flex: 1; min-width:0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .custom .row { font-size: 17px; padding: 10px 14px; border: 0; background: var(--hi);
    border-left: 3px solid var(--mark); margin-bottom: 6px; border-radius: 0 6px 6px 0; }
  .custom .n { color: var(--mark); flex-basis: 136px; }
  .custom .v { font-weight: 600; }
  .none { color: var(--faint); font: 15px ui-monospace, "SF Mono", Menlo, monospace;
    padding: 12px 14px; border: 1px dashed var(--line); border-radius: 6px; }
  .label { font-size: 11px; color: var(--faint); text-transform: uppercase; letter-spacing: .06em;
    margin: 0 0 8px; }
  .rest { margin-top: 26px; }
  .rest .row { color: var(--muted); }
  .rest .v { color: color-mix(in oklab, var(--ink) 70%, var(--bg)); }
</style></head>
<body><main>
  <p class="where">GET ${esc(url.pathname + url.search)}</p>
  <h1>${esc(url.host)}</h1>
  <p class="sub">The request headers this server just received.</p>
  <div class="custom rows" data-testid="custom">${
    custom.length
      ? custom.map((n) => row(n, '')).join('')
      : '<div class="none" data-h="none">no x- headers</div>'
  }</div>
  <div class="rest rows"><p class="label">Everything else</p>${rest.map((n) => row(n, '')).join('')}</div>
</main></body></html>`;
}

export interface Echo {
  /** Loopback port the server listens on (HTTPS). */
  port: number;
  close(): Promise<void>;
}

export async function startEcho(): Promise<Echo> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lh-media-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '2',
        '-subj',
        '/CN=example.com',
        '-keyout',
        key,
        '-out',
        cert,
      ],
      { stdio: 'ignore' },
    );
  } catch {
    throw new Error('pnpm media needs `openssl` on PATH (for the echo server certificate).');
  }
  const server = https.createServer(
    { key: readFileSync(key), cert: readFileSync(cert) },
    (req, res) => {
      const url = new URL(req.url ?? '/', `https://${req.headers.host ?? 'example.com'}`);
      if (url.pathname === '/favicon.ico') {
        res.writeHead(204).end();
        return;
      }
      const headers = Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [
          k,
          Array.isArray(v) ? v.join(', ') : (v ?? ''),
        ]),
      );
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(page(url, headers));
    },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  rmSync(dir, { recursive: true, force: true });
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
