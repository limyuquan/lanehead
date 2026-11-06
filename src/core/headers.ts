/**
 * Validation and normalization: the only copy (UI, service worker and CLI all use it). Keep this
 * file free of dependencies other than ./types and ./badge: the CLI bundles it.
 *
 * Every function returns the normalized value or throws a LaneheadError.
 */
import { PALETTE } from './badge';
import { type Header, LaneheadError, type Preset } from './types';

/** HTTP token characters (RFC 9110 `tchar`), lowercase. */
const TOKEN = /^[!#$%&'*+.^_`|~0-9a-z-]+$/;
/** A bare host: DNS labels or an IPv4 address, lowercase, no scheme, port or path. */
const HOST =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

export const MAX_VALUE = 4096;

/**
 * - name: trimmed, lowercased, must be an HTTP token
 * - value: trimmed, 1–4096 chars, no CR, LF or NUL
 */
export function validateHeader(header: Header): Header {
  const name = String(header?.name ?? '')
    .trim()
    .toLowerCase();
  const value = String(header?.value ?? '').trim();
  if (!TOKEN.test(name)) {
    throw new LaneheadError('BAD_HEADER', `Use a valid header name instead of "${name}".`);
  }
  if (!value) throw new LaneheadError('BAD_HEADER', `Give header "${name}" a value.`);
  if (value.length > MAX_VALUE) {
    throw new LaneheadError('BAD_HEADER', `Shorten the value of "${name}" to ${MAX_VALUE} chars.`);
  }
  if (/[\r\n\0]/.test(value)) {
    throw new LaneheadError('BAD_HEADER', `Remove line breaks from the value of "${name}".`);
  }
  return { name, value };
}

/** Each header validated; names must be unique. */
export function validateHeaders(headers: Header[]): Header[] {
  if (!Array.isArray(headers)) throw new LaneheadError('BAD_HEADER', 'Pass headers as a list.');
  const out = headers.map(validateHeader);
  const seen = new Set<string>();
  for (const { name } of out) {
    if (seen.has(name)) throw new LaneheadError('BAD_HEADER', `Set header "${name}" only once.`);
    seen.add(name);
  }
  return out;
}

/** Pasted text → its header lines: trimmed, blank lines skipped, curl's `-H '…'` unwrapped. */
function headerLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) =>
      l
        .trim()
        .replace(/^-H\s+/, '')
        .replace(/^(['"])(.*)\1$/, '$2'),
    )
    .filter(Boolean);
}

/**
 * Pasted `name: value` lines → name/value pairs, not validated (the UI's key/value rows check each
 * one with validateHeader). Splits each line on its first `:`; a line without one is all name.
 */
export function splitHeaderLines(text: string): Header[] {
  return headerLines(text).map((line) => {
    const colon = line.indexOf(':');
    return colon < 1
      ? { name: line, value: '' }
      : { name: line.slice(0, colon), value: line.slice(colon + 1) };
  });
}

/**
 * Pasted `name: value` lines → validated headers. Splits each line on its first `:`; skips blank
 * lines; accepts curl's `-H 'name: value'` form.
 */
export function parseHeaderLines(text: string): Header[] {
  for (const line of headerLines(text)) {
    if (line.indexOf(':') < 1)
      throw new LaneheadError('BAD_HEADER', `Write "${line}" as name: value.`);
  }
  return validateHeaders(splitHeaderLines(text));
}

/** `base` with `over` on top: same name → `over`'s value in `base`'s position; new names appended. */
export function mergeHeaders(base: Header[], over: Header[]): Header[] {
  const byName = new Map(over.map((h) => [h.name, h]));
  const merged = base.map((h) => byName.get(h.name) ?? h);
  const kept = new Set(base.map((h) => h.name));
  return [...merged, ...over.filter((h) => !kept.has(h.name))];
}

/** Trimmed, lowercased, deduplicated bare hosts. */
export function validateDomains(domains: string[]): string[] {
  if (!Array.isArray(domains)) throw new LaneheadError('BAD_REQUEST', 'Pass domains as a list.');
  const out = domains.map((d) => String(d).trim().toLowerCase());
  for (const d of out) {
    if (!HOST.test(d)) {
      throw new LaneheadError('BAD_REQUEST', `Use a bare host like example.com instead of "${d}".`);
    }
  }
  return [...new Set(out)];
}

/**
 * A preset as saved:
 * - name: trimmed, 1–40 chars, unique among `others` (case-insensitive), not "custom" or "off"
 *   (those are lanes of their own in TabInfo)
 * - color: one of PALETTE
 * - badge: trimmed, ≤ 4 chars; empty → derived (omitted)
 * - headers: ≥ 1, see validateHeaders
 * - domains: see validateDomains
 */
export function validatePreset(preset: Omit<Preset, 'id'>, others: Preset[]): Omit<Preset, 'id'> {
  if (typeof preset !== 'object' || preset === null) {
    throw new LaneheadError('BAD_REQUEST', 'Pass a preset object.');
  }
  const name = String(preset.name ?? '').trim();
  if (!name || name.length > 40) {
    throw new LaneheadError('BAD_REQUEST', 'Give the preset a name of 1–40 characters.');
  }
  if (['custom', 'off'].includes(name.toLowerCase())) {
    throw new LaneheadError('BAD_REQUEST', `Pick another name: "${name}" is reserved.`);
  }
  if (others.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    throw new LaneheadError('BAD_REQUEST', `Pick another name: "${name}" is taken.`);
  }
  if (!PALETTE.includes(preset.color)) {
    throw new LaneheadError('BAD_REQUEST', `Pick a color from the palette: ${PALETTE.join(', ')}.`);
  }
  const badge = String(preset.badge ?? '').trim();
  if (badge.length > 4) throw new LaneheadError('BAD_REQUEST', 'Shorten the badge to 4 chars.');
  const headers = validateHeaders(preset.headers);
  if (!headers.length)
    throw new LaneheadError('BAD_HEADER', 'Give the preset at least one header.');
  return {
    name,
    color: preset.color,
    ...(badge && { badge }),
    headers,
    domains: validateDomains(preset.domains),
  };
}
