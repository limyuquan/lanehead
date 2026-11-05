/** UI ↔ service worker protocol: extension pages call the dispatcher with `call`. */
import { browser } from 'wxt/browser';
import { type ErrorCode, LaneheadError, type Op, type Ops } from '@/core/types';

export type Request = { op: Op; args: unknown };
export type Response =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: ErrorCode; message: string } };

/** Runs `op` in the service worker. Throws a LaneheadError when it fails. */
export async function call<K extends Op>(op: K, args: Ops[K][0]): Promise<Ops[K][1]> {
  const res: Response = await browser.runtime.sendMessage({ op, args } satisfies Request);
  if (!res.ok) throw new LaneheadError(res.error.code, res.error.message);
  return res.result as Ops[K][1];
}
