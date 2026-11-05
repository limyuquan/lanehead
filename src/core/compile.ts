/** Tab state → effective headers and DNR session rules. See docs/CONTRACTS.md section 2. */
import type { Browser } from 'wxt/browser';
import { mergeHeaders } from './headers';
import type { Header, Preset, TabState } from './types';

type Rule = Browser.declarativeNetRequest.Rule;

/** Every DNR resource type. `main_frame` must be listed explicitly or it is not matched. */
const RESOURCE_TYPES = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other',
] as const satisfies `${Browser.declarativeNetRequest.ResourceType}`[];

/**
 * What a tab sends and why.
 * - `lane`: preset name, "custom" (own headers only), "off", or null (none)
 * - `global`: the headers come from the global preset
 * - `headers`: effective headers (preset's, then own on top)
 * - `preset`: the tab's preset, or the global preset when `global`
 */
export type Lane = { lane: string | null; global: boolean; headers: Header[]; preset?: Preset };

export function laneOf(
  state: TabState | undefined,
  presets: Preset[],
  global: string | null,
): Lane {
  if (!state) {
    const preset = presets.find((p) => p.id === global);
    return preset
      ? { lane: preset.name, global: true, headers: preset.headers, preset }
      : { lane: null, global: false, headers: [] };
  }
  if (state.off) return { lane: 'off', global: false, headers: [] };
  const preset = presets.find((p) => p.id === state.preset);
  const headers = mergeHeaders(preset?.headers ?? [], state.headers);
  const lane = preset?.name ?? (headers.length ? 'custom' : null);
  return { lane, global: false, headers, ...(preset && { preset }) };
}

/**
 * The complete session ruleset:
 *
 * | rule              | id          | priority | condition                                  | headers                       |
 * |-------------------|-------------|----------|--------------------------------------------|-------------------------------|
 * | global            | 1           | 1        | excludedTabIds: every tab with a state     | global preset                 |
 * | tab, preset part  | 2·tabId + 2 | 2        | tabIds: [tabId], preset's requestDomains   | preset's, minus own names     |
 * | tab, own part     | 2·tabId + 3 | 3        | tabIds: [tabId]                            | own                           |
 *
 * Off tabs and empty parts get no rule. Each header name is set by one rule per tab, so
 * priorities never decide a conflict.
 */
export function compile(
  presets: Preset[],
  tabs: Record<number, TabState>,
  global: string | null,
): Rule[] {
  const rule = (
    id: number,
    priority: number,
    headers: Header[],
    condition: Rule['condition'],
    domains: string[] = [],
  ): Rule => ({
    id,
    priority,
    action: {
      type: 'modifyHeaders',
      requestHeaders: headers.map(({ name, value }) => ({ header: name, operation: 'set', value })),
    },
    condition: {
      ...condition,
      resourceTypes: [...RESOURCE_TYPES],
      ...(domains.length && { requestDomains: domains }),
    },
  });

  const rules: Rule[] = [];
  const states = Object.entries(tabs).map(([id, state]) => [Number(id), state] as const);
  const globalPreset = presets.find((p) => p.id === global);
  if (globalPreset) {
    const excluded = states.length ? { excludedTabIds: states.map(([id]) => id) } : {};
    rules.push(rule(1, 1, globalPreset.headers, excluded, globalPreset.domains));
  }
  for (const [tabId, state] of states) {
    if (state.off) continue;
    const own = new Set(state.headers.map((h) => h.name));
    const preset = presets.find((p) => p.id === state.preset);
    const presetPart = preset?.headers.filter((h) => !own.has(h.name)) ?? [];
    if (preset && presetPart.length) {
      rules.push(rule(2 * tabId + 2, 2, presetPart, { tabIds: [tabId] }, preset.domains));
    }
    if (state.headers.length)
      rules.push(rule(2 * tabId + 3, 3, state.headers, { tabIds: [tabId] }));
  }
  return rules;
}
