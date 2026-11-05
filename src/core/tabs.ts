/** How `set` changes a tab's state. See docs/CONTRACTS.md section 3. */
import { mergeHeaders } from './headers';
import type { Header, Preset, TabState } from './types';

/**
 * The tab's state after a `set` that does not turn it off:
 * - `replace`: exactly the call's `headers`, and its `preset` if given (else none)
 * - else a new preset first drops the own headers it also sets (the preset choice wins), then
 *   `headers` merge in by name; `preset: null` removes the preset, omitted keeps it
 */
export function applySet(
  cur: TabState | undefined,
  change: {
    headers?: Header[] | undefined;
    preset?: Preset | null | undefined;
    replace?: boolean | undefined;
  },
): TabState {
  const { headers = [], preset, replace } = change;
  const presetId = preset === undefined ? (replace ? undefined : cur?.preset) : preset?.id;
  const kept = replace ? [] : (cur?.headers ?? []);
  const own = preset ? kept.filter((h) => !preset.headers.some((p) => p.name === h.name)) : kept;
  return { ...(presetId && { preset: presetId }), headers: mergeHeaders(own, headers) };
}
