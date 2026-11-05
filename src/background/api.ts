/**
 * The one dispatcher. The popup and manage page call it through runtime messages, the native
 * host (phase 3) through the native port: same validation, same results. See docs/CONTRACTS.md
 * section 3.
 *
 * A mutation resolves only after the session rules are installed (and tabs reloaded, if asked or
 * if reloadOnChange is on).
 */
import { type Browser, browser } from 'wxt/browser';
import { fingerprint, laneOf } from '@/core/compile';
import { validateHeaders, validatePreset } from '@/core/headers';
import { applySet } from '@/core/tabs';
import {
  type ErrorCode,
  LaneheadError,
  type Op,
  type Ops,
  type Preset,
  type Settings,
  type TabInfo,
  type TabState,
} from '@/core/types';
import { agentState, syncBridge } from './native';
import { brand, current, markLoaded, type State, sends, update } from './store';

/** Runs `op`. Throws a LaneheadError for anything the caller can fix. */
export async function dispatch(op: string, args: unknown): Promise<unknown> {
  if (!Object.hasOwn(handlers, op)) {
    throw new LaneheadError(
      'BAD_REQUEST',
      `Use one of these ops: ${Object.keys(handlers).join(', ')}.`,
    );
  }
  if (args !== undefined && (typeof args !== 'object' || args === null)) {
    throw new LaneheadError('BAD_REQUEST', 'Pass args as an object.');
  }
  const handler = handlers[op as Op] as (args: object) => Promise<unknown>;
  return handler(args ?? {});
}

/** The wire form of any error thrown by `dispatch`. */
export function errorOf(err: unknown): { code: ErrorCode; message: string } {
  if (err instanceof LaneheadError) return { code: err.code, message: err.message };
  return { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) };
}

type Handlers = { [K in Op]: (args: Ops[K][0]) => Promise<Ops[K][1]> };

const handlers: Handlers = {
  async tabs({ url }) {
    const state = await current();
    const needle = url?.toLowerCase() ?? '';
    const tabs = await browser.tabs.query({});
    return {
      tabs: tabs
        .filter((t) => [t.url, t.title].some((s) => s?.toLowerCase().includes(needle)))
        .map((t) => info(t, state)),
    };
  },

  async get({ tab }) {
    return info(await getTab(tab), await current());
  },

  async set({ tab, headers, preset, replace, off, reload }) {
    const t = await getTab(tab);
    const own = headers === undefined ? undefined : validateHeaders(headers);
    const state = await mutate((draft) => {
      if (off) {
        if (own?.length || preset) {
          throw new LaneheadError('BAD_REQUEST', 'Turn a tab off without headers or a preset.');
        }
        draft.tabs[t.id] = { headers: [], off: true };
        return;
      }
      const found = preset == null ? preset : findPreset(draft.presets, preset);
      put(draft, t.id, applySet(draft.tabs[t.id], { headers: own, preset: found, replace }));
    }, reload && t.id);
    return info(t, state);
  },

  async clear({ tab, names, reload }) {
    const t = await getTab(tab);
    if (names !== undefined && !Array.isArray(names)) {
      throw new LaneheadError('BAD_REQUEST', 'Pass names as a list.');
    }
    const state = await mutate((draft) => {
      const cur = draft.tabs[t.id];
      if (!names) {
        delete draft.tabs[t.id];
        return;
      }
      const drop = new Set(names.map((n) => String(n).trim().toLowerCase()));
      for (const name of drop) {
        if (!cur?.headers.some((h) => h.name === name)) throw notOwn(draft, t.id, name);
      }
      if (cur) put(draft, t.id, { ...cur, headers: cur.headers.filter((h) => !drop.has(h.name)) });
    }, reload && t.id);
    return info(t, state);
  },

  // about:blank first, rules second, navigation last: the first request already has the headers.
  async open({ url, headers, preset, focus }) {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      throw new LaneheadError('BAD_URL', 'Pass a full URL like https://example.com.');
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw new LaneheadError('BAD_URL', 'Open an http or https URL.');
    }
    const own = validateHeaders(headers ?? []);
    // Fail fast before creating a tab; re-resolved in the writer in case it was deleted meanwhile.
    if (preset !== undefined) findPreset((await current()).presets, preset);
    const win = await browser.windows
      .getLastFocused({ windowTypes: ['normal'] })
      .catch(() => undefined);
    const blank = await browser.tabs.create({
      url: 'about:blank',
      active: !!focus,
      ...(win?.id !== undefined && { windowId: win.id }),
    });
    const id = blank.id ?? -1;
    let state: State;
    try {
      state = await update((draft) => {
        const presetId = preset === undefined ? undefined : findPreset(draft.presets, preset).id;
        put(draft, id, { ...(presetId && { preset: presetId }), headers: own });
        // Its page loads only after this, with these headers.
        draft.loaded[id] = sends(draft, id);
        return draft;
      });
    } catch (err) {
      await browser.tabs.remove(id);
      throw err;
    }
    await browser.tabs.update(id, { url: target.href });
    return info({ ...blank, pendingUrl: target.href }, state);
  },

  async reload({ tab }) {
    const t = await getTab(tab);
    await reloadTab(t.id);
    return info(t, await current());
  },

  async presets() {
    const { presets, global } = await current();
    return { presets, global };
  },

  async 'preset.save'({ preset }) {
    let saved: Preset | undefined;
    await mutate((draft) => {
      const id = preset?.id;
      const index = draft.presets.findIndex((p) => p.id === id);
      if (id !== undefined && index < 0) {
        throw new LaneheadError('NO_PRESET', 'Save without an id to create a new preset.');
      }
      const others = draft.presets.filter((p) => p.id !== id);
      saved = { id: id ?? crypto.randomUUID(), ...validatePreset(preset, others) };
      if (index < 0) draft.presets.push(saved);
      else draft.presets[index] = saved;
    });
    return saved as Preset;
  },

  async 'preset.delete'({ id }) {
    await mutate((draft) => {
      const gone = findPreset(draft.presets, id).id;
      draft.presets = draft.presets.filter((p) => p.id !== gone);
      if (draft.global === gone) draft.global = null;
      for (const [tabId, { preset, ...rest }] of Object.entries(draft.tabs)) {
        if (preset === gone) put(draft, Number(tabId), rest);
      }
    });
    return {};
  },

  async 'preset.order'({ ids }) {
    return update((draft) => {
      const byId = new Map(draft.presets.map((p) => [p.id, p]));
      const ordered = Array.isArray(ids) ? ids.map((id) => byId.get(id)) : [];
      if (
        ordered.length !== byId.size ||
        new Set(ordered).size !== byId.size ||
        !ordered.every(Boolean)
      ) {
        throw new LaneheadError('BAD_REQUEST', 'Pass every preset id exactly once.');
      }
      draft.presets = ordered as Preset[];
      return { presets: draft.presets };
    });
  },

  async global({ preset }) {
    const { global } = await mutate((draft) => {
      draft.global = preset === null ? null : findPreset(draft.presets, preset).id;
    });
    return { global };
  },

  async settings({ patch }) {
    if (patch === undefined) return (await current()).settings;
    const { settings } = await update((draft) => {
      draft.settings = validSettings({ ...draft.settings, ...patch });
      return draft;
    });
    syncBridge();
    return settings;
  },

  async status() {
    const { instanceId, settings } = await current();
    const [, major = '?'] = /Chrome\/(\d+)/.exec(navigator.userAgent) ?? [];
    return {
      instance: instanceId,
      label: settings.label,
      version: browser.runtime.getManifest().version,
      browser: `${brand()} ${major}`,
      agent: agentState(),
    };
  },
};

type Tab = Browser.tabs.Tab & { id: number };

async function getTab(tab: unknown): Promise<Tab> {
  if (!Number.isInteger(tab) || (tab as number) < 0) {
    throw new LaneheadError('BAD_REQUEST', 'Pass a tab id from `lanehead tabs`.');
  }
  try {
    return (await browser.tabs.get(tab as number)) as Tab;
  } catch {
    throw new LaneheadError('NO_TAB', `No tab ${tab}; run \`lanehead tabs\`.`);
  }
}

/** A preset by id or name (case-insensitive). */
function findPreset(presets: Preset[], key: unknown): Preset {
  const lower = String(key).toLowerCase();
  const found = presets.find((p) => p.id === key || p.name.toLowerCase() === lower);
  if (!found) throw new LaneheadError('NO_PRESET', `No preset "${key}"; run \`lanehead presets\`.`);
  return found;
}

/** Store a tab's state; one with no preset, no headers and no off is deleted. */
function put(draft: State, tabId: number, state: TabState) {
  if (state.preset || state.headers.length || state.off) draft.tabs[tabId] = state;
  else delete draft.tabs[tabId];
}

/** Why `name` is not an own header of the tab: it comes from a preset, or the tab lacks it. */
function notOwn(state: State, tabId: number, name: string): LaneheadError {
  const { preset, global } = laneOf(state.tabs[tabId], state.presets, state.global);
  const message = !preset?.headers.some((h) => h.name === name)
    ? `Tab ${tabId} has no header "${name}"; run \`lanehead get ${tabId}\`.`
    : global
      ? `"${name}" comes from the all-tabs preset ${preset.name}; run \`lanehead set ${tabId} --off\` to stop it for this tab.`
      : `"${name}" comes from preset ${preset.name}; run \`lanehead set ${tabId} --no-preset\` to drop the preset.`;
  return new LaneheadError('NOT_OWN', message);
}

/** What a tab with no recorded page load loaded with: nothing. */
const NOTHING = fingerprint({ lane: null, global: false, headers: [] });

/** Headers only matter to web pages. */
const isWeb = (url = '') => /^https?:/.test(url);

/** The tab would send other headers than its current page loaded with. */
function isStale(tab: Browser.tabs.Tab, state: State): boolean {
  const id = tab.id ?? -1;
  return isWeb(tab.url) && sends(state, id) !== (state.loaded[id] ?? NOTHING);
}

/**
 * Runs `change` in the writer, then reloads tab `reload` (if given) and, with reloadOnChange,
 * every web tab the change made stale. Resolves with the newest state.
 */
async function mutate(change: (draft: State) => void, reload?: number | false): Promise<State> {
  let before: State | undefined;
  const after = await update((draft) => {
    before = structuredClone(draft);
    change(draft);
    return draft;
  });
  const changed = (t: Browser.tabs.Tab) =>
    before && sends(before, t.id ?? -1) !== sends(after, t.id ?? -1) && isStale(t, after);
  const ids = (await browser.tabs.query({}))
    .filter((t) => t.id === reload || (after.settings.reloadOnChange && changed(t)))
    .map((t) => t.id as number);
  await Promise.all(ids.map(reloadTab));
  return ids.length ? current() : after;
}

/** Reloads a tab; its new page loads with what the tab sends now. */
async function reloadTab(tabId: number): Promise<void> {
  await browser.tabs.reload(tabId);
  await markLoaded(tabId);
}

function info(tab: Browser.tabs.Tab, state: State): TabInfo {
  const id = tab.id ?? -1;
  const lane = laneOf(state.tabs[id], state.presets, state.global);
  return {
    id,
    url: tab.pendingUrl || tab.url || '',
    title: (tab.title ?? '').slice(0, 80),
    lane: lane.lane,
    global: lane.global,
    headers: Object.fromEntries(lane.headers.map((h) => [h.name, h.value])),
    own: state.tabs[id]?.headers.map((h) => h.name) ?? [],
    ...(isStale(tab, state) && { stale: true }),
  };
}

/**
 * - inheritOnOpen, reloadOnChange, agentControl: booleans
 * - label: trimmed, 1–40 chars
 */
function validSettings(s: Settings): Settings {
  const { inheritOnOpen, reloadOnChange, agentControl } = s;
  const label = String(s.label).trim();
  const flags = [inheritOnOpen, reloadOnChange, agentControl];
  if (flags.some((f) => typeof f !== 'boolean') || !label || label.length > 40) {
    throw new LaneheadError(
      'BAD_REQUEST',
      'Use true/false for the switches and a label of 1–40 characters.',
    );
  }
  return { inheritOnOpen, reloadOnChange, agentControl, label };
}
