/** Lanehead data model. */

/** One request header. `name` is a lowercase HTTP token; `value` is 1–4096 chars, no CR/LF/NUL. */
export type Header = { name: string; value: string };

export type Preset = {
  id: string;
  /** Unique (case-insensitive), 1–40 chars. */
  name: string;
  /** One of PALETTE. */
  color: string;
  /** ≤ 4 chars; derived from the name when absent. */
  badge?: string;
  /** ≥ 1, unique names, in the order the user wrote them. */
  headers: Header[];
  /** "Only send to" bare hosts (subdomains included); [] = every site. */
  domains: string[];
};

/**
 * A tab's own state. No state = default: no headers of its own, the global preset applies if on.
 * - `preset`: preset id
 * - `headers`: the tab's own headers; win over the preset's on the same name; sent where the
 *   preset is (its domains), or everywhere without a preset
 * - `off`: no headers and excluded from global; only with no preset and no headers
 */
export type TabState = { preset?: string; headers: Header[]; off?: true };

export type Settings = {
  inheritOnOpen: boolean;
  reloadOnChange: boolean;
  agentControl: boolean;
  /** This browser profile's name for agents; defaults to the browser's brand. */
  label: string;
};

export const DEFAULT_SETTINGS: Omit<Settings, 'label'> = {
  inheritOnOpen: true,
  reloadOnChange: false,
  agentControl: true,
};

/** What a tab sends, as reported by the API. */
export type TabInfo = {
  id: number;
  url: string;
  /** Cut to 80 chars. */
  title: string;
  /** Preset name, "custom" (own headers only), "off", or null (none). */
  lane: string | null;
  /** The headers come from the global preset. */
  global: boolean;
  /** Effective headers. */
  headers: Record<string, string>;
  /** Names of the tab's own headers (the ones `clear` can remove by name). */
  own: string[];
  /** The only sites `headers` go to (the preset's domains); absent = every site. */
  domains?: string[];
  /** The tab would send other headers than its current page loaded with: reload to apply. */
  stale?: true;
};

/** State of the native bridge. */
export type AgentState = 'connected' | 'connecting' | 'no-host' | 'off';

export type Status = {
  instance: string;
  label: string;
  version: string;
  browser: string;
  agent: AgentState;
  /** The control page for browser-only agents (served by the host), while connected. */
  ui?: string;
  /** Host of the focused window's active tab, to tell browsers apart. */
  active?: string;
};

/** Every API operation: `[args, result]`. */
export type Ops = {
  tabs: [{ url?: string }, { tabs: TabInfo[] }];
  get: [{ tab: number }, TabInfo];
  set: [
    {
      tab: number;
      headers?: Header[];
      preset?: string | null;
      replace?: boolean;
      off?: boolean;
      reload?: boolean;
    },
    TabInfo,
  ];
  clear: [{ tab: number; names?: string[]; reload?: boolean }, TabInfo];
  open: [{ url: string; headers?: Header[]; preset?: string; focus?: boolean }, TabInfo];
  reload: [{ tab: number }, TabInfo];
  presets: [Record<string, never>, { presets: Preset[]; global: string | null }];
  'preset.save': [{ preset: Omit<Preset, 'id'> & { id?: string } }, Preset];
  'preset.delete': [{ id: string }, Record<string, never>];
  'preset.order': [{ ids: string[] }, { presets: Preset[] }];
  global: [{ preset?: string | null }, { global: string | null }];
  settings: [{ patch?: Partial<Settings> }, Settings];
  status: [Record<string, never>, Status];
};
export type Op = keyof Ops;

export type ErrorCode =
  | 'NO_TAB'
  | 'BAD_HEADER'
  | 'NO_PRESET'
  | 'NOT_OWN'
  | 'BAD_URL'
  | 'RULES_FAILED'
  | 'BAD_REQUEST'
  | 'NOT_CONNECTED'
  | 'AMBIGUOUS_INSTANCE'
  | 'INTERNAL';

/** An expected failure. `message` is one short sentence that says what to do. */
export class LaneheadError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
