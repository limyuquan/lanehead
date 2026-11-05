/**
 * The service worker's state and its single writer.
 *
 * - `storage.local`: presets, global, settings, instanceId (per profile, survive restarts)
 * - `storage.session`: tabs (die with the browser session, like the session rules)
 *
 * Every change goes through `update`, one at a time: the new state is compiled into the complete
 * session ruleset, installed, then saved and badged. If installing fails, nothing changes.
 */
import { browser } from 'wxt/browser';
import { compile } from '@/core/compile';
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
};

let loaded: Promise<State> | undefined;
let queue: Promise<unknown> = Promise.resolve();

/** The current state. Read-only: change it with `update`. */
export function current(): Promise<State> {
  loaded ??= load();
  return loaded;
}

async function load(): Promise<State> {
  const local = await browser.storage.local.get(['presets', 'global', 'settings', 'instanceId']);
  const { tabs = {} } = await browser.storage.session.get('tabs');
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
    settings: { ...DEFAULT_SETTINGS, ...(local.settings as Partial<Settings> | undefined) },
    instanceId,
    tabs: tabs as Record<number, TabState>,
  };
}

/**
 * Runs `change` on a copy of the state, then installs the rules, saves and refreshes badges.
 * Serialized: each call waits for the previous one.
 */
export function update<T>(change: (draft: State) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
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
    loaded = Promise.resolve(draft);
    const { presets, global, settings, tabs } = draft;
    await browser.storage.local.set({ presets, global, settings });
    await browser.storage.session.set({ tabs });
    await refreshBadges(draft);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}
