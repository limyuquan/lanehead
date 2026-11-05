/**
 * Lean CLI output: only what an agent needs, so it spends few tokens. The API keeps the full
 * TabInfo for the UI. See docs/CONTRACTS.md section 6.
 */
import type { Preset, Status, TabInfo } from '../src/core/types';

/** `domains` only when the headers go only there; `global` and `stale` only when true. */
const flags = (t: TabInfo) => ({
  ...(t.domains && { domains: t.domains }),
  ...(t.global && { global: true }),
  ...(t.stale && { stale: true }),
});

/** set, clear, open, reload: the tab's lane and what it sends. */
export const tabResult = (t: TabInfo) => ({
  id: t.id,
  lane: t.lane,
  headers: t.headers,
  ...flags(t),
});

/** get: the same, with the URL. */
export const tabDetail = (t: TabInfo) => ({
  id: t.id,
  url: t.url,
  lane: t.lane,
  headers: t.headers,
  ...flags(t),
});

/** One `tabs` entry; `instance` only when several browsers are connected. */
export const tabEntry = (t: TabInfo, instance?: string) => ({
  id: t.id,
  url: t.url,
  title: t.title,
  ...(t.lane !== null && { lane: t.lane }),
  ...(Object.keys(t.headers).length && { headers: t.headers }),
  ...flags(t),
  ...(instance && { i: instance }),
});

/** Lanehead's own popup and manage pages: not tabs an agent works with. */
export const isOwnPage = (t: TabInfo) =>
  /^chrome-extension:\/\/[a-p]{32}\/(manage|popup)\.html/.test(t.url);

/** presets: names, headers as an object, domains only when set; global by name. */
export function presetList(presets: Preset[], global: string | null) {
  return {
    presets: presets.map((p) => ({
      name: p.name,
      headers: Object.fromEntries(p.headers.map((h) => [h.name, h.value])),
      ...(p.domains.length && { domains: p.domains }),
    })),
    global: nameOf(presets, global),
  };
}

/** A preset id → its name (null for none). */
export const nameOf = (presets: Preset[], id: string | null) =>
  presets.find((p) => p.id === id)?.name ?? null;

/** `Several browsers are connected; pass -i <instance>: ab12 (Chrome, active tab: example.com), …` */
export function ambiguousMessage(list: Pick<Status, 'instance' | 'label' | 'active'>[]): string {
  const each = list.map(
    (i) => `${i.instance} (${i.label}${i.active ? `, active tab: ${i.active}` : ''})`,
  );
  return `Several browsers are connected; pass -i <instance>: ${each.join(', ')}. Name them in Lanehead → Agents.`;
}
