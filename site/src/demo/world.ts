/**
 * The demo's world: Lanehead's real service worker code (dispatcher, store, tab listeners) running
 * against the in-page browser stand-in, two pretend tabs on shop.example.com, and a pretend
 * server that answers each page load with the headers it received.
 */
import { dispatch, errorOf } from '@/background/api';
import { installTabListeners } from '@/background/tabs';
import { PALETTE } from '@/core/badge';
import type { Preset } from '@/core/types';
import { browser, demo, type Rule } from './browserShim';

export const SITE = 'https://shop.example.com';

/**
 * The headers Chrome would add to a top-level request from `tabId` to `url` under `rules`: every
 * matching modifyHeaders rule, highest priority first; for the same header the first one wins.
 * (The subset of declarativeNetRequest that Lanehead's rules use.)
 */
export function requestHeaders(rules: Rule[], tabId: number, url: string): [string, string][] {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return [];
  }
  const out = new Map<string, string>();
  const matching = rules
    .filter(({ condition: c, action }) => {
      if (action.type !== 'modifyHeaders') return false;
      if (c.tabIds && !c.tabIds.includes(tabId)) return false;
      if (c.excludedTabIds?.includes(tabId)) return false;
      if (c.resourceTypes && !c.resourceTypes.includes('main_frame')) return false;
      if (c.requestDomains && !c.requestDomains.some((d) => host === d || host.endsWith(`.${d}`)))
        return false;
      return true;
    })
    .sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1));
  for (const rule of matching) {
    for (const h of rule.action.requestHeaders ?? []) {
      if (h.operation === 'set' && !out.has(h.header)) out.set(h.header, h.value ?? '');
    }
  }
  return [...out];
}

/** What each tab's current page was loaded with: the pretend server's view. */
const loads = new Map<number, [string, string][]>();
const loaded = new Set<() => void>();
export const pageLoads = {
  get: (tabId: number) => loads.get(tabId),
  subscribe(l: () => void) {
    loaded.add(l);
    return () => void loaded.delete(l);
  },
};

let booted: Promise<void> | undefined;

/** Starts the pretend browser once: lanes, two tabs on two lanes, both loaded. */
export function boot(): Promise<void> {
  booted ??= start();
  return booted;
}

async function start() {
  // Service worker: same wiring as src/entrypoints/background.ts, minus the native bridge.
  installTabListeners();
  demo.serve(async ({ op, args }) => {
    try {
      return { ok: true, result: await dispatch(op, args) };
    } catch (err) {
      return { ok: false, error: errorOf(err) };
    }
  });
  // The terminal next to the browser plays the agent, so the bridge reads as connected.
  await browser.storage.session.set({ agent: 'connected' });

  demo.onCommitted.addListener(({ tabId, frameId, url }) => {
    if (frameId !== 0) return;
    loads.set(tabId, requestHeaders(demo.rules(), tabId, url));
    for (const l of [...loaded]) l();
  });
  demo.onRemoved.addListener((tabId) => loads.delete(tabId));

  const lanes: Omit<Preset, 'id'>[] = [
    lane('feature_checkout', PALETTE[0]),
    lane('feature_search', PALETTE[4]),
    {
      name: 'staging',
      color: PALETTE[1] as string,
      headers: [h('x-env', 'staging'), h('x-canary', '1')],
      domains: [],
    },
  ];
  const saved: Preset[] = [];
  for (const preset of lanes) saved.push((await dispatch('preset.save', { preset })) as Preset);

  const a = await browser.tabs.create({ url: `${SITE}/checkout`, active: true });
  const b = await browser.tabs.create({ url: `${SITE}/search`, active: false });
  await dispatch('set', { tab: a.id, preset: saved[0]?.id, reload: true });
  await dispatch('set', { tab: b.id, preset: saved[1]?.id, reload: true });
}

function lane(name: string, color = PALETTE[0]): Omit<Preset, 'id'> {
  return { name, color: color as string, headers: [h('x-env', name)], domains: [] };
}

function h(name: string, value: string) {
  return { name, value };
}
