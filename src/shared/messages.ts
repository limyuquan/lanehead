/** UI ↔ service worker protocol: extension pages call the dispatcher with `call`. */
import { browser } from 'wxt/browser';
import { type ErrorCode, LaneheadError, type Op, type Ops } from '@/core/types';

export type Request = { op: Op; args: unknown };
export type Response =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: ErrorCode; message: string } };

/**
 * An error message as the UI says it: a saved preset is a "lane" there. (Core and the CLI keep
 * "preset"; `lanehead presets` and other command names stay as they are.)
 */
export const uiText = (message: string) => message.replace(/\bpreset\b/g, 'lane');

/** Runs `op` in the service worker. Throws a LaneheadError (its message in UI words) when it fails. */
export async function call<K extends Op>(op: K, args: Ops[K][0]): Promise<Ops[K][1]> {
  const res: Response = await browser.runtime.sendMessage({ op, args } satisfies Request);
  if (!res.ok) throw new LaneheadError(res.error.code, uiText(res.error.message));
  return res.result as Ops[K][1];
}
