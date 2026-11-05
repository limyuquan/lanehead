/**
 * The control page: a plain HTML page the native host serves on 127.0.0.1, so agents that only
 * have browser tools (no shell) can switch tab headers by filling in forms. No JavaScript; every
 * action is a form POST that runs the same `dispatch` op as the CLI, then redirects back.
 * See docs/CONTRACTS.md section 7.
 */
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { parseHeaderLines } from '../src/core/headers';
import { LaneheadError, type Preset, type Status, type TabInfo } from '../src/core/types';
import { withScheme } from './args';
import { isOwnPage } from './format';

/** Runs a dispatcher op in the browser; rejects with its `{code, message}`. */
export type Run = (op: string, args: object) => Promise<unknown>;

/** First port tried (`LANEHEAD_PORT` overrides it); one per connected browser, up to 8. */
const FIRST_PORT = 47823;
const PORTS = 8;
export const MAX_BODY = 16 * 1024;

/**
 * Serves the page on the first free port from `LANEHEAD_PORT` (default 47823) on. Resolves with
 * its URL, or undefined when all 8 are taken.
 */
export async function startUi(run: Run): Promise<string | undefined> {
  const first = Number(process.env.LANEHEAD_PORT) || FIRST_PORT;
  for (let port = first; port < Math.min(first + PORTS, 65536); port++) {
    const server = http.createServer((req, res) => {
      handle(req, res, port, run).catch((err) => {
        console.error('[lanehead host] ui', err);
        if (!res.headersSent) plain(res, 500, 'Something went wrong; reload the page.');
      });
    });
    const ok = await new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (ok) return `http://127.0.0.1:${port}/`;
  }
  console.error(`[lanehead host] ports ${first}–${first + PORTS - 1} are taken; no control page`);
  return undefined;
}

/** Only our own names for the page: another name means DNS rebinding. */
export const allowedHost = (host: string | undefined, port: number) =>
  host === `127.0.0.1:${port}` || host === `localhost:${port}`;

/** A POST from our own page, or from a client that sends no Origin (not a browser form). */
export const allowedOrigin = (origin: string | undefined, port: number) =>
  origin === undefined ||
  origin === `http://127.0.0.1:${port}` ||
  origin === `http://localhost:${port}`;

/** The body as text; undefined when it is over `limit` bytes. */
export async function readBody(
  body: AsyncIterable<Buffer>,
  limit = MAX_BODY,
): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > limit) return undefined;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

type Action = 'set' | 'clear' | 'reload' | 'open';
const ACTIONS: Action[] = ['set', 'clear', 'reload', 'open'];

/**
 * A submitted form → the op's args. `set` makes the tab exactly what the form shows (its
 * headers, and the chosen preset or none). Throws a LaneheadError for bad headers or no URL.
 */
export function formArgs(action: Action, form: URLSearchParams): object {
  const tab = Number(form.get('tab'));
  const headers = () => parseHeaderLines(form.get('headers') ?? '');
  const preset = form.get('preset') || null;
  switch (action) {
    case 'set':
      return { tab, headers: headers(), preset, replace: true };
    case 'clear':
    case 'reload':
      return { tab };
    case 'open': {
      const url = form.get('url')?.trim();
      if (!url) throw new LaneheadError('BAD_URL', 'Enter a URL to open.');
      return { url: withScheme(url), headers: headers(), ...(preset && { preset }) };
    }
  }
}

/** `Tab 123 → lane_a: x-env=lane_a`, the one-line result of an action. */
export function describeTab(t: TabInfo, prefix = 'Tab'): string {
  const headers = Object.entries(t.headers).map(([n, v]) => `${n}=${v}`);
  const lane = t.lane === null ? 'no headers' : `${t.lane}${t.global ? ' (all tabs)' : ''}`;
  const sends = headers.length && t.lane !== null ? `${lane}: ${headers.join(', ')}` : lane;
  return `${prefix} ${t.id} → ${sends}${t.stale ? ' (reload to apply)' : ''}`;
}

/** Results shown once after the redirect, by id, so a link cannot put text on the page. */
const results = new Map<string, { text: string; error: boolean }>();
function remember(text: string, error: boolean): string {
  const id = randomUUID().slice(0, 8);
  results.set(id, { text, error });
  // Keep the newest 50.
  for (const old of results.keys()) {
    if (results.size <= 50) break;
    results.delete(old);
  }
  return id;
}

const SECURITY = {
  'cache-control': 'no-store',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  // Not no-referrer: Chrome would then send `Origin: null` with our own forms.
  'referrer-policy': 'same-origin',
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

function plain(res: http.ServerResponse, status: number, text: string) {
  res.writeHead(status, { ...SECURITY, 'content-type': 'text/plain; charset=utf-8' });
  res.end(`${text}\n`);
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  port: number,
  run: Run,
): Promise<void> {
  if (!allowedHost(req.headers.host, port)) {
    return plain(res, 421, `Open this page at http://127.0.0.1:${port}/.`);
  }
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  const view = url.searchParams.get('tab');
  if (url.pathname === '/' && (req.method === 'GET' || req.method === 'HEAD')) {
    const result = results.get(url.searchParams.get('r') ?? '');
    const body = await page(run, port, view, result);
    res.writeHead(200, { ...SECURITY, 'content-type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }
  const action = ACTIONS.find((a) => url.pathname === `/${a}`);
  if (!action) return plain(res, 404, `Not found; open http://127.0.0.1:${port}/.`);
  if (req.method !== 'POST') return plain(res, 405, 'Use the forms on the page.');
  if (!allowedOrigin(req.headers.origin, port)) {
    return plain(res, 403, 'Only the Lanehead page itself can submit these forms.');
  }
  if (!/^application\/x-www-form-urlencoded\s*(;|$)/i.test(req.headers['content-type'] ?? '')) {
    return plain(res, 415, 'Send a form (application/x-www-form-urlencoded).');
  }
  const body = await readBody(req);
  if (body === undefined) {
    res.setHeader('connection', 'close');
    return plain(res, 413, `Send under ${MAX_BODY / 1024} KiB.`);
  }

  let id: string;
  try {
    const tab = (await run(action, formArgs(action, new URLSearchParams(body)))) as TabInfo;
    const prefix = { set: 'Tab', clear: 'Tab', reload: 'Reloaded tab', open: 'Opened tab' };
    id = remember(describeTab(tab, prefix[action]), false);
  } catch (err) {
    id = remember(`Error: ${(err as { message?: string }).message ?? String(err)}`, true);
  }
  const back = new URLSearchParams({ ...(view && { tab: view }), r: id });
  res.writeHead(303, { ...SECURITY, location: `/?${back}` });
  res.end();
}

/** Text and attribute values. */
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

const hostOf = (url: string) => {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

async function page(
  run: Run,
  port: number,
  view: string | null,
  result: { text: string; error: boolean } | undefined,
): Promise<string> {
  const [status, { tabs }, { presets }] = (await Promise.all([
    run('status', {}),
    run('tabs', {}),
    run('presets', {}),
  ])) as [Status, { tabs: TabInfo[] }, { presets: Preset[] }];
  const self = [`http://127.0.0.1:${port}/`, `http://localhost:${port}/`];
  const shown = tabs.filter(
    (t) =>
      !isOwnPage(t) &&
      !self.some((s) => t.url.startsWith(s)) &&
      (view === null || String(t.id) === view),
  );
  const query = view === null ? '' : `?tab=${encodeURIComponent(view)}`;
  // The label only when the user renamed it from the brand ("Chromium" in "Chromium 156").
  const named = status.browser.startsWith(`${status.label} `) ? '' : `${status.label} · `;
  const about = `Tabs of ${named}${status.browser}, instance ${status.instance}`;

  const options = (selected: string | null) =>
    [
      `<option value=""${selected === null ? ' selected' : ''}>none</option>`,
      ...presets.map(
        (p) =>
          `<option value="${esc(p.name)}"${p.name === selected ? ' selected' : ''}>${esc(p.name)}</option>`,
      ),
    ].join('');

  const tabSection = (t: TabInfo) => {
    const own = t.own.map((n) => `${n}: ${t.headers[n] ?? ''}`).join('\n');
    // The tab's own preset; an all-tabs preset is not the tab's choice.
    const preset = !t.global && presets.find((p) => p.name === t.lane);
    const sends = Object.entries(t.headers)
      .map(([n, v]) => `<code>${esc(n)}: ${esc(v)}</code>`)
      .join(', ');
    const lane = t.lane === null ? 'no headers' : `${esc(t.lane)}${t.global ? ' (all tabs)' : ''}`;
    return `<section aria-labelledby="t${t.id}">
<h2 id="t${t.id}">Tab ${t.id} · ${esc(t.title || 'Untitled')}</h2>
<p class="meta">${esc(hostOf(t.url))} · ${lane}${sends ? ` · ${sends}` : ''}${t.stale ? ' · <strong>reload to apply</strong>' : ''}</p>
<form method="post" action="/set${query}">
<input type="hidden" name="tab" value="${t.id}">
<label for="h${t.id}">Headers</label>
<textarea id="h${t.id}" name="headers" rows="2" placeholder="x-env: lane_a">${esc(own)}</textarea>
<label for="p${t.id}">Preset</label>
<select id="p${t.id}" name="preset">${options(preset ? preset.name : null)}</select>
<div class="buttons"><button class="primary">Set headers</button>
<button formaction="/clear${query}">Clear</button>
<button formaction="/reload${query}">Reload</button></div>
</form>
</section>`;
  };

  const list = shown.length
    ? shown.map(tabSection).join('\n')
    : `<p>${view === null ? 'No tabs.' : `No tab ${esc(view)}.`}</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lanehead</title>
<style>${CSS}</style>
</head>
<body>
<header>
<h1>Lanehead</h1>
<p class="meta">${esc(about)}. Set a tab's headers, then reload it or navigate.</p>
${view === null ? '' : '<p><a href="/">All tabs</a></p>'}
</header>
${result ? `<p role="status" class="${result.error ? 'error' : 'done'}">${esc(result.text)}</p>` : ''}
<main>
${list}
<section aria-labelledby="open">
<h2 id="open">Open new tab</h2>
<form method="post" action="/open${query}">
<label for="url">URL</label>
<input id="url" name="url" placeholder="https://example.com" autocomplete="off">
<label for="oh">Headers</label>
<textarea id="oh" name="headers" rows="2" placeholder="x-env: lane_a"></textarea>
<label for="op">Preset</label>
<select id="op" name="preset">${options(null)}</select>
<div class="buttons"><button class="primary">Open new tab</button></div>
</form>
</section>
</main>
</body>
</html>
`;
}

/** The extension's calm neutrals (src/styles/app.css), light and dark. */
const CSS = `
:root{color-scheme:light dark;--bg:#fcfcfb;--ink:#1d1d1f;--muted:#6c6c70;--line:#e7e7e4;--hover:#f2f2ef;--focus:#2f6fde;--danger:#b3261e;--ok:#188038}
@media (prefers-color-scheme:dark){:root{--bg:#1c1c1e;--ink:#ececee;--muted:#9b9ba1;--line:#2f2f32;--hover:#27272a;--focus:#7ea6ff;--danger:#ff8a80;--ok:#81c995}}
*{box-sizing:border-box}
body{margin:0 auto;max-width:720px;padding:32px 24px 64px;background:var(--bg);color:var(--ink);font:14px/1.5 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
h1{font-size:15px;font-weight:600;margin:0 0 4px}
h2{font-size:14px;font-weight:600;margin:0 0 2px;overflow-wrap:anywhere}
header{border-bottom:1px solid var(--line);padding-bottom:16px}
section{border-bottom:1px solid var(--line);padding:20px 0}
p{margin:0}
.meta{color:var(--muted);overflow-wrap:anywhere}
code,textarea{font:13px/1.45 ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace}
code{color:var(--ink)}
a{color:var(--muted);text-underline-offset:3px}
a:hover{color:var(--ink)}
[role=status]{margin-top:16px;padding:8px 12px;border-left:3px solid var(--ok);background:var(--hover);overflow-wrap:anywhere}
[role=status].error{border-color:var(--danger);color:var(--danger)}
form{display:grid;grid-template-columns:72px minmax(0,1fr);gap:8px 12px;align-items:start;margin-top:12px}
label{color:var(--muted);padding-top:5px}
input,textarea,select{width:100%;padding:5px 8px;border:1px solid var(--line);border-radius:4px;background:var(--bg);color:var(--ink);font-size:13px}
select{width:auto;min-width:160px;justify-self:start}
textarea{resize:vertical}
input:focus,textarea:focus,select:focus{outline:none;border-color:var(--focus)}
.buttons{grid-column:2;display:flex;gap:8px;flex-wrap:wrap}
button{padding:4px 10px;border:1px solid var(--line);border-radius:4px;background:transparent;color:var(--ink);font:inherit;font-size:13px;font-weight:500;cursor:pointer}
button:hover{background:var(--hover)}
button.primary{background:var(--ink);border-color:var(--ink);color:var(--bg)}
:focus-visible{outline:2px solid var(--focus);outline-offset:1px}
`;
