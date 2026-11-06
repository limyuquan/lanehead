/**
 * Native bridge to the `lanehead` CLI: the host (registered by `lanehead install`) forwards CLI
 * requests to `dispatch`.
 *
 * While agent control is on, the worker connects at start, when the setting is turned on, and on
 * a 30 s alarm whenever it has no port. An open port keeps the worker alive; the alarm brings a
 * stopped worker back, so a shell-only agent never needs the user to wake the browser.
 */
import { type Browser, browser } from 'wxt/browser';
import type { AgentState } from '@/core/types';
import { HOST_NAME } from '@/shared/ids';
import { dispatch, errorOf } from './api';
import { current } from './store';

const ALARM = 'bridge';
type HostMessage = { ready?: true; ui?: string; id: number; op: string; args: unknown };
let port: Browser.runtime.Port | undefined;
let state: AgentState | undefined;
/** The host's control page for browser-only agents, while connected. */
let ui: string | undefined;

export function agentState(): AgentState {
  return state ?? 'off';
}

export function agentUi(): string | undefined {
  return ui;
}

/** Pages follow the state through `storage.session` key `agent`. */
function setState(next: AgentState) {
  if (next === state) return;
  state = next;
  browser.storage.session
    .set({ agent: next })
    .catch((err) => console.error('[lanehead] bridge', err));
}

export function installBridge(): void {
  browser.alarms.onAlarm.addListener(({ name }) => name === ALARM && syncBridge());
  syncBridge();
}

/** Connects or disconnects to match the agentControl setting. */
export function syncBridge(): void {
  sync().catch((err) => console.error('[lanehead] bridge', err));
}

async function sync(): Promise<void> {
  const { settings } = await current();
  if (!settings.agentControl) {
    port?.disconnect();
    port = undefined;
    ui = undefined;
    setState('off');
    await browser.alarms.clear(ALARM);
    return;
  }
  if (!(await browser.alarms.get(ALARM))) {
    await browser.alarms.create(ALARM, { periodInMinutes: 0.5 });
  }
  const hello = await dispatch('status', {});
  if (port) return;
  if (agentState() === 'off') setState('connecting');

  const p = browser.runtime.connectNative(HOST_NAME);
  port = p;
  const reply = (frame: object) => port === p && p.postMessage({ v: 1, ...frame });
  p.onMessage.addListener((msg: HostMessage) => {
    // The host sends `ready` once its socket listens, with its page's URL if it could serve one.
    if (msg.ready) {
      ui = /^http:\/\/127\.0\.0\.1:\d+\/$/.test(msg.ui ?? '') ? msg.ui : undefined;
      setState('connected');
      return;
    }
    dispatch(msg.op, msg.args).then(
      (result) => reply({ id: msg.id, ok: true, result }),
      (err) => reply({ id: msg.id, ok: false, error: errorOf(err) }),
    );
  });
  p.onDisconnect.addListener(() => {
    // Read lastError here, or Chrome logs it as unchecked.
    const error = browser.runtime.lastError?.message ?? '';
    if (port !== p) return;
    const wasConnected = state === 'connected';
    port = undefined;
    ui = undefined;
    // "Specified native messaging host not found." / "Access to … is forbidden.": run `install`.
    setState(/not found|forbidden/i.test(error) ? 'no-host' : 'connecting');
    // A host that ran fine and died (killed, crashed) is retried now, not at the next alarm.
    if (wasConnected) setTimeout(syncBridge, 1000);
  });
  p.postMessage({ v: 1, hello });
}
