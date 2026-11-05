#!/usr/bin/env node
/**
 * Header-recording server for e2e tests, on two loopback origins with one port:
 * http://127.0.0.1:<port> and http://localhost:<port> (::1). No dependencies.
 *
 *   GET /page?id=<id>[&frame=<url>][&fetch=<url>][&link=<url>]
 *       Records the request, returns a page that loads `frame` in an iframe, fetches `fetch`, and
 *       links to `link` with target=_blank (#link).
 *   GET /echo?id=<id>   Records the request, returns its headers as JSON (CORS open).
 *   GET /log?id=<id>    The headers of every recorded request with that id, oldest first.
 *
 *   FIXTURE_PORT=5000 node scripts/serve-fixtures.mjs
 */
import { createServer } from 'node:http';

const port = Number(process.env.FIXTURE_PORT ?? 4391);
/** id → headers of each request. */
const seen = new Map();

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const id = url.searchParams.get('id') ?? '';
  const record = () => seen.set(id, [...(seen.get(id) ?? []), req.headers]);
  const send = (type, body) => {
    res.writeHead(200, {
      'content-type': type,
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    res.end(body);
  };
  const attr = (s) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

  if (url.pathname === '/page') {
    record();
    const frame = url.searchParams.get('frame');
    const fetchUrl = url.searchParams.get('fetch');
    const link = url.searchParams.get('link');
    send(
      'text/html; charset=utf-8',
      [
        `<!doctype html><title>${id}</title><h1>${id}</h1>`,
        link && `<a id="link" target="_blank" href="${attr(link)}">link</a>`,
        frame && `<iframe src="${attr(frame)}"></iframe>`,
        fetchUrl && `<script>fetch(${JSON.stringify(fetchUrl)})</script>`,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  } else if (url.pathname === '/echo') {
    record();
    send('application/json', JSON.stringify(req.headers));
  } else if (url.pathname === '/log') {
    send('application/json', JSON.stringify(seen.get(id) ?? []));
  } else {
    send('text/plain', 'ok');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`fixtures: http://127.0.0.1:${port}/ and http://localhost:${port}/`);
});
// A second listener on ::1 so `localhost` is a second origin on the same port.
createServer((req, res) => server.emit('request', req, res)).listen(port, '::1');
