/**
 * The service worker's state and its single writer.
 *
 * - `storage.local`: presets, global, settings, instanceId (per profile, survive restarts)
 * - `storage.session`: tabs, and `loaded`: the fingerprint of what each tab's current page loaded
 *   with (die with the browser session, like the session rules)
 *
 * Every change goes through `update`, one at a time: the new state is compiled into the complete
 * session ruleset, installed, then saved and badged. If installing fails, nothing changes.
 */
import { browser } from 'wxt/browser';
import { compile, fingerprint, laneOf } from '@/core/compile';
import {
  DEFAULT_SETTINGS,
  LaneheadError,
  type Preset,
  type Settings,
  type TabState,
} from '@/core/types';
import { refreshBadges } from './badge';

export type State = {
  presets: Preset[];
  global: string | null;
  settings: Settings;
  instanceId: string;
  tabs: Record<number, TabState>;
  /** Tab id → fingerprint of the headers its current page loaded with. */
  loaded: Record<number, string>;
};

/** This browser's brand: Chrome, Edge, Brave or Chromium. */
export function brand(): string {
  const { userAgentData } = navigator as { userAgentData?: { brands: { brand: string }[] } };
  const brands = userAgentData?.brands.map((b) => b.brand) ?? [];
  if (brands.includes('Google Chrome')) return 'Chrome';
  if (brands.includes('Microsoft Edge')) return 'Edge';
  if (brands.includes('Brave')) return 'Brave';
  return 'Chromium';
}

/** Fingerprint of what tab `tabId` sends now (see `fingerprint`). */
export function sends(state: State, tabId: number): string {
  return fingerprint(laneOf(state.tabs[tabId], state.presets, state.global));
}

let published: Promise<State> | undefined;
let queue: Promise<unknown> = Promise.resolve();

/** The current state. Read-only: change it with `update`. */
export function current(): Promise<State> {
  published ??= load();
  return published;
}

async function load(): Promise<State> {
  const local = await browser.storage.local.get(['presets', 'global', 'settings', 'instanceId']);
  const { tabs = {}, loaded = {} } = await browser.storage.session.get(['tabs', 'loaded']);
  let instanceId = local.instanceId as string | undefined;
  if (!instanceId) {
    instanceId = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) =>
      'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(b % 36),
    ).join('');
    await browser.storage.local.set({ instanceId });
  }
  return {
    presets: (local.presets as Preset[] | undefined) ?? [],
    global: (local.global as string | null | undefined) ?? null,
    settings: {
      ...DEFAULT_SETTINGS,
      label: brand(),
      ...(local.settings as Partial<Settings> | undefined),
    },
    instanceId,
    tabs: tabs as Record<number, TabState>,
    loaded: loaded as Record<number, string>,
  };
}

/**
 * Runs `change` on a copy of the state, then installs the rules, saves and refreshes badges.
 * Serialized: each call waits for the previous one.
 */
export function update<T>(change: (draft: State) => T | Promise<T>): Promise<T> {
  return enqueue(async () => {
    const draft = structuredClone(await current());
    const result = await change(draft);
    const rules = compile(draft.presets, draft.tabs, draft.global);
    try {
      const old = await browser.declarativeNetRequest.getSessionRules();
      await browser.declarativeNetRequest.updateSessionRules({
        removeRuleIds: old.map((r) => r.id),
        addRules: rules,
      });
    } catch (err) {
      throw new LaneheadError('RULES_FAILED', `Chrome rejected the header rules: ${String(err)}`);
    }
    // Reads see the new state before storage.onChanged tells pages to re-read.
    published = Promise.resolve(draft);
    const { presets, global, settings, tabs, loaded } = draft;
    await browser.storage.local.set({ presets, global, settings });
    await browser.storage.session.set({ tabs, loaded });
    await refreshBadges(draft);
    return result;
  });
}

/**
 * Records that tab `tabId`'s page loaded with what the tab sends now (on its main-frame commit,
 * or when Lanehead reloads it). Queued after pending changes; installs no rules.
 */
export function markLoaded(tabId: number): Promise<void> {
  return enqueue(async () => {
    const state = await current();
    const now = sends(state, tabId);
    if (state.loaded[tabId] === now) return;
    const loaded = { ...state.loaded, [tabId]: now };
    published = Promise.resolve({ ...state, loaded });
    await browser.storage.session.set({ loaded });
  });
}

/** Runs `work` after every earlier change. */
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work);
  queue = run.catch(() => {});
  return run;
}
