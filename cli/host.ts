/**
 * The native host, started by the browser through the wrapper `lanehead install` writes. It
 * listens on `<home>/run/<instance>.sock` and forwards each CLI request line to the browser and
 * the reply back. stdout carries native frames only; diagnostics go to stderr.
 * See docs/CONTRACTS.md section 5.
 */
import { chmodSync, rmSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import { decoder, encode } from './frames';
import { runDir } from './home';

/** Chrome drops the port on a host → browser message over 1 MB. */
const MAX_LINE = 1 << 20;

type Reply = { id: number; ok: boolean; result?: unknown; error?: unknown };

export function host(): void {
  const send = (message: object) => process.stdout.write(encode({ v: 1, ...message }));
  const waiting = new Map<number, (reply: Reply) => void>();
  let nextId = 1;
  let socketPath: string | undefined;
  let inode: number | undefined;

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
    net.createServer(serve).listen(file, () => {
      chmodSync(file, 0o600);
      inode = statSync(file).ino;
      send({ ready: true });
    });
  }

  function serve(socket: net.Socket) {
    socket.on('error', () => {}); // the CLI gave up (timeout, Ctrl-C)
    const answer = (id: unknown, reply: object) =>
      socket.write(`${JSON.stringify({ v: 1, ...reply, id })}\n`);
    readline.createInterface({ input: socket }).on('line', (line) => {
      let req: { id?: unknown; op?: unknown; args?: unknown };
      try {
        if (line.length > MAX_LINE) throw new Error();
        req = JSON.parse(line);
      } catch {
        const message = 'Send one JSON request per line, under 1 MB.';
        answer(null, { ok: false, error: { code: 'BAD_REQUEST', message } });
        return;
      }
      // Ids are the host's own: several CLIs may use the same ones at once.
      const id = nextId++;
      waiting.set(id, ({ ok, result, error }) => answer(req.id, { ok, result, error }));
      send({ id, op: req.op, args: req.args });
    });
  }
}
