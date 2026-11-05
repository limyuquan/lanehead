import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { dispatch, errorOf } from '@/background/api';
import { installTabListeners, reconcile } from '@/background/tabs';
import type { Request, Response } from '@/shared/messages';

/** Wires every listener synchronously, so Chrome can wake the worker for any of them. */
export default defineBackground(() => {
  reconcile().catch((err) => console.error('[lanehead] reconcile failed', err));
  installTabListeners();

  // Popup and manage page → dispatch.
  browser.runtime.onMessage.addListener((message: Request, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return;
    dispatch(message.op, message.args).then(
      (result): void => sendResponse({ ok: true, result } satisfies Response),
      (err): void => sendResponse({ ok: false, error: errorOf(err) } satisfies Response),
    );
    return true;
  });

  // Native bridge (phase 3): src/background/native.ts connects to the host and calls `dispatch`.
});
