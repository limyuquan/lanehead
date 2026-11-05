/** Toolbar badge and tooltip for a tab. See docs/CONTRACTS.md section 4. */
import type { Lane } from './compile';

/** Preset colors. Each reads well as the background of white badge text. */
export const PALETTE = [
  '#1a73e8', // blue
  '#188038', // green
  '#c5221f', // red
  '#b06000', // amber
  '#8430ce', // purple
  '#00796b', // teal
  '#c2185b', // pink
  '#3949ab', // indigo
];

/** Badge color of a tab with own headers only. */
export const CUSTOM_COLOR = '#5f6368';

/**
 * Short badge text for a name or value:
 * 1. drop everything up to the first `_` or `-` if ≥ 3 letters/digits remain
 * 2. keep letters/digits, lowercased; ≤ 4 chars → done
 * 3. longer: the first 4, except that a short ending that tells lanes apart (`_a`, `-2`, `v12`)
 *    is kept, so `lane_a` and `lane_b` differ
 *
 * `lane_a` → `claw`, `lane_a` → `lana`, `env12` → `en12`, `dev` → `dev`.
 */
export function deriveBadge(text: string): string {
  const alnum = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  const cut = text.search(/[_-]/);
  const base = cut >= 0 && alnum(text.slice(cut + 1)).length >= 3 ? text.slice(cut + 1) : text;
  const s = alnum(base);
  if (s.length <= 4) return s;
  const end = base.match(/[_-]([\p{L}\p{N}]{1,2})$|(\p{N}{1,2})$/u);
  const tail = end ? alnum(end[1] ?? end[2] ?? '') : '';
  return s.slice(0, 4 - tail.length) + tail;
}

/**
 * - preset: its badge (or derived from its name), its color
 * - custom: derived from the first own header's value, CUSTOM_COLOR
 * - global only: the global preset's badge cut to 3 chars + `•`, its color
 * - off or none: no badge
 */
export function badgeOf(lane: Lane): { text: string; color: string } | null {
  const { preset } = lane;
  if (preset) {
    const text = preset.badge ?? deriveBadge(preset.name);
    return lane.global
      ? { text: `${text.slice(0, 3)}•`, color: preset.color }
      : { text, color: preset.color };
  }
  const first = lane.headers[0];
  return first ? { text: deriveBadge(first.value), color: CUSTOM_COLOR } : null;
}

/** `Lanehead — <lane>: name=value, …` or `Lanehead — no headers`. */
export function titleOf(lane: Lane): string {
  if (!lane.headers.length) return 'Lanehead — no headers';
  return `Lanehead — ${lane.lane}: ${lane.headers.map((h) => `${h.name}=${h.value}`).join(', ')}`;
}
