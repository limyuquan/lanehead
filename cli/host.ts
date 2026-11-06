/**
 * The native host, started by the browser through the wrapper `lanehead install` writes. It
 * listens on `<home>/run/<instance>.sock` and forwards each CLI request line to the browser and
 * the reply back, and serves the control page for browser-only agents (cli/ui.ts). stdout
 * carries native frames only; diagnostics go to stderr.
 */
import { chmodSync, rmSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import { decoder, encode } from './frames';
import { runDir } from './home';
import { startUi } from './ui';

/** Chrome drops the port on a host → browser message over 1 MB. */
const MAX_LINE = 1 << 20;

type Reply = { id: number; ok: boolean; result?: unknown; error?: unknown };

export function host(): void {
  const send = (message: object) => process.stdout.write(encode({ v: 1, ...message }));
  const waiting = new Map<number, (reply: Reply) => void>();
  let nextId = 1;
  let socketPath: string | undefined;
  let inode: number | undefined;

  /** Runs an op in the browser. Ids are the host's own: several clients may reuse theirs. */
  const call = (op: string, args?: object) =>
    new Promise<Reply>((resolve) => {
      const id = nextId++;
      waiting.set(id, resolve);
      send({ id, op, args });
    });
  /** The same, for the control page: resolves with the result, rejects with `{code, message}`. */
  const run = async (op: string, args: object) => {
    const { ok, result, error } = await call(op, args);
    if (!ok) throw error;
    return result;
  };

  const decode = decoder();
  process.stdin.on('data', (chunk: Buffer) => {
    for (const msg of decode(chunk) as (Reply & { hello?: { instance: string } })[]) {
      if (msg.hello) listen(msg.hello.instance);
      else {
        waiting.get(msg.id)?.(msg);
        waiting.delete(msg.id);
      }
    }
  });
  // The browser closed the port (worker stopped, agent control off, browser quit).
  const exit = () => {
    // A newer host may already own the path: remove the socket only if it is still ours.
    if (socketPath && statSync(socketPath, { throwIfNoEntry: false })?.ino === inode) {
      rmSync(socketPath);
    }
    process.exit(0);
  };
  process.stdin.on('end', exit);
  process.on('SIGTERM', exit);

  function listen(instance: string) {
    if (socketPath) return;
    if (!/^[a-z0-9]{1,16}$/.test(instance)) {
      console.error(`[lanehead host] bad instance id ${JSON.stringify(instance)}`);
      process.exit(1);
    }
    const file = path.join(runDir(), `${instance}.sock`);
    socketPath = file;
    // Left by a killed host, or by the one this replaces, which is exiting: the newest wins.
    rmSync(file, { force: true });
    net.createServer(serve).listen(file, async () => {
      chmodSync(file, 0o600);
      inode = statSync(file).ino;
      // The page is optional: the socket keeps working without it.
      const ui = await startUi(run).catch((err) => void console.error('[lanehead host] ui', err));
      send({ ready: true, ...(ui && { ui }) });
    });
  }

  function serve(socket: net.Socket) {
    const answer = (id: unknown, reply: object) =>
      socket.write(`${JSON.stringify({ v: 1, ...reply, id })}\n`);
    const lines = readline.createInterface({ input: socket });
    lines.on('error', () => {}); // the socket's, re-emitted: the CLI gave up (timeout, Ctrl-C)
    lines.on('line', (line) => {
      const req = parseRequest(line);
      if (!req) {
        const message =
          'Send one JSON request per line, under 1 MB: {"v":1,"id":1,"op":"tabs","args":{}}.';
        answer(null, { ok: false, error: { code: 'BAD_REQUEST', message } });
        return;
      }
      void call(req.op, req.args).then(({ ok, result, error }) =>
        answer(req.id, { ok, result, error }),
      );
    });
  }
}

type Request = { id?: unknown; op: string; args?: object };

/** A request line → `{id, op, args}`; undefined unless it is a JSON object with a string op and object args. */
export function parseRequest(line: string): Request | undefined {
  if (line.length > MAX_LINE) return undefined;
  let req: unknown;
  try {
    req = JSON.parse(line);
  } catch {
    return undefined;
  }
  const isObject = (x: unknown): x is Record<string, unknown> =>
    typeof x === 'object' && x !== null && !Array.isArray(x);
  if (!isObject(req) || typeof req.op !== 'string') return undefined;
  if (req.args !== undefined && !isObject(req.args)) return undefined;
  return req as Request;
}
