/**
 * Stand-in for `wxt/browser` on the website (aliased in site/vite.config.ts): just enough of
 * Chrome's extension APIs, in memory, for Lanehead's real service worker code and real popup to
 * run inside a web page. Tabs here are the demo's pretend tabs; `declarativeNetRequest` only
 * stores the session rules (the demo reads them to show what a request would carry). Nothing
 * leaves the page.
 */

type Fn = (...args: never[]) => unknown;

/** A Chrome-style event: addListener / removeListener / hasListener, plus `emit` for the demo. */
function event<L extends Fn>() {
  const listeners = new Set<L>();
  return {
    addListener: (l: L) => void listeners.add(l),
    removeListener: (l: L) => void listeners.delete(l),
    hasListener: (l: L) => listeners.has(l),
    emit: (...args: Parameters<L>) => {
      for (const l of [...listeners]) (l as (...a: Parameters<L>) => unknown)(...args);
    },
  };
}

// ---- storage ----

type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>;
const storageChanged = event<(changes: Changes, area: string) => void>();

function area(name: 'local' | 'session') {
  const data = new Map<string, unknown>();
  return {
    async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
      const list = keys == null ? [...data.keys()] : Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) if (data.has(k)) out[k] = structuredClone(data.get(k));
      return out;
    },
    async set(items: Record<string, unknown>): Promise<void> {
      const changes: Changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: data.get(k), newValue: structuredClone(v) };
        data.set(k, structuredClone(v));
      }
      // Chrome fires onChanged after the write, asynchronously.
      queueMicrotask(() => storageChanged.emit(changes, name));
    },
  };
}

// ---- tabs ----

export type FakeTab = {
  id: number;
  windowId: number;
  index: number;
  url: string;
  title: string;
  active: boolean;
  status: 'complete';
};

const WINDOW = 1;
const tabs = new Map<number, FakeTab>();
let nextId = 1841;

/** Page titles of the pretend sites. */
const titleOf = (url: string) => {
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname === 'shop.example.com') {
      if (pathname.startsWith('/checkout')) return 'Checkout · Example Shop';
      if (pathname.startsWith('/search')) return 'Search · Example Shop';
      return 'Example Shop';
    }
    return hostname || url;
  } catch {
    return url;
  }
};

const onCreated = event<(tab: FakeTab) => void>();
const onUpdated =
  event<(id: number, info: { url?: string; title?: string }, tab: FakeTab) => void>();
const onRemoved = event<(id: number, info: { windowId: number }) => void>();
const onReplaced = event<(added: number, removed: number) => void>();
const onActivated = event<(info: { tabId: number; windowId: number }) => void>();
const onCommitted = event<(d: { tabId: number; frameId: number; url: string }) => void>();
const onCreatedNavigationTarget =
  event<(d: { sourceTabId: number; tabId: number; url: string }) => void>();

function need(id: number): FakeTab {
  const t = tabs.get(id);
  if (!t) throw new Error(`No tab with id: ${id}.`);
  return t;
}

function reindex() {
  [...tabs.values()].forEach((t, i) => {
    t.index = i;
  });
}

function activate(id: number) {
  for (const t of tabs.values()) t.active = t.id === id;
  onActivated.emit({ tabId: id, windowId: WINDOW });
}

/** The main frame commits a page (a navigation or a reload). */
function commit(t: FakeTab) {
  onCommitted.emit({ tabId: t.id, frameId: 0, url: t.url });
  onUpdated.emit(t.id, { url: t.url, title: t.title }, { ...t });
}

function navigate(t: FakeTab, url: string) {
  t.url = url;
  t.title = titleOf(url);
  if (/^https?:/.test(url)) commit(t);
  else onUpdated.emit(t.id, { url, title: t.title }, { ...t });
}

/** Lanehead's manage page isn't part of the demo; the page listens for this to say so. */
export const MANAGE_EVENT = 'lanehead-demo:manage';

const tabsApi = {
  async query(q: { active?: boolean; url?: string } = {}): Promise<FakeTab[]> {
    return [...tabs.values()]
      .filter((t) => q.active === undefined || t.active === q.active)
      .map((t) => ({ ...t }));
  },
  async get(id: number): Promise<FakeTab> {
    return { ...need(id) };
  },
  async create({ url = 'about:blank', active = true }: { url?: string; active?: boolean }) {
    if (url.startsWith('chrome-extension:')) {
      window.dispatchEvent(new CustomEvent(MANAGE_EVENT, { detail: url }));
      return { id: -1 };
    }
    const t: FakeTab = {
      id: nextId++,
      windowId: WINDOW,
      index: tabs.size,
      url: 'about:blank',
      title: 'about:blank',
      active: false,
      status: 'complete',
    };
    tabs.set(t.id, t);
    onCreated.emit({ ...t });
    if (active) activate(t.id);
    if (url !== 'about:blank') navigate(t, url);
    return { ...t };
  },
  async update(id: number, { url, active }: { url?: string; active?: boolean }) {
    const t = need(id);
    if (active) activate(id);
    if (url !== undefined) navigate(t, url);
    return { ...t };
  },
  async reload(id: number) {
    commit(need(id));
  },
  async remove(id: number) {
    const t = need(id);
    tabs.delete(id);
    reindex();
    onRemoved.emit(id, { windowId: WINDOW });
    if (t.active) {
      const next = [...tabs.values()][Math.min(t.index, tabs.size - 1)];
      if (next) activate(next.id);
    }
  },
  onCreated,
  onUpdated,
  onRemoved,
  onReplaced,
  onActivated,
};

// ---- declarativeNetRequest, action ----

export type Rule = {
  id: number;
  priority?: number;
  action: {
    type: string;
    requestHeaders?: { header: string; operation: string; value?: string }[];
  };
  condition: {
    tabIds?: number[];
    excludedTabIds?: number[];
    requestDomains?: string[];
    resourceTypes?: string[];
  };
};

let sessionRules: Rule[] = [];
const rulesChanged = event<(rules: Rule[]) => void>();

const badges = new Map<number, { text: string; color: string; title: string }>();
const badgeChanged = event<(tabId: number) => void>();
const badge = (tabId: number) => {
  let b = badges.get(tabId);
  if (!b) {
    b = { text: '', color: '#5f6368', title: 'Lanehead' };
    badges.set(tabId, b);
  }
  return b;
};

// ---- storage-free bits ----

const noop = async () => undefined;

export const browser = {
  storage: {
    local: area('local'),
    session: area('session'),
    onChanged: storageChanged,
  },
  tabs: tabsApi,
  windows: {
    getLastFocused: async () => ({ id: WINDOW }),
    update: async () => ({ id: WINDOW }),
  },
  webNavigation: { onCommitted, onCreatedNavigationTarget },
  declarativeNetRequest: {
    getSessionRules: async () => structuredClone(sessionRules),
    async updateSessionRules({
      removeRuleIds = [],
      addRules = [],
    }: {
      removeRuleIds?: number[];
      addRules?: Rule[];
    }) {
      sessionRules = [
        ...sessionRules.filter((r) => !removeRuleIds.includes(r.id)),
        ...structuredClone(addRules),
      ];
      rulesChanged.emit(sessionRules);
    },
  },
  action: {
    async setBadgeText({ tabId, text }: { tabId: number; text: string }) {
      badge(tabId).text = text;
      badgeChanged.emit(tabId);
    },
    async setBadgeBackgroundColor({ tabId, color }: { tabId: number; color: string }) {
      badge(tabId).color = color;
      badgeChanged.emit(tabId);
    },
    setBadgeTextColor: noop,
    async setTitle({ tabId, title }: { tabId: number; title: string }) {
      badge(tabId).title = title;
      badgeChanged.emit(tabId);
    },
  },
  alarms: {
    onAlarm: event<(alarm: { name: string }) => void>(),
    get: noop,
    create: noop,
    clear: noop,
  },
  runtime: {
    id: 'nofaceocfeacnlfmhhfhgjifeeeidkmh',
    lastError: undefined,
    getURL: (path: string) => `chrome-extension://nofaceocfeacnlfmhhfhgjifeeeidkmh${path}`,
    getManifest: () => ({ version: __VERSION__ }),
    /** Popup → service worker: answered by the dispatcher the demo registers. */
    sendMessage: (message: { op: string; args: unknown }) => {
      if (!worker) return Promise.reject(new Error('Could not establish connection.'));
      return worker(message);
    },
  },
};

type Worker = (message: { op: string; args: unknown }) => Promise<unknown>;
let worker: Worker | undefined;

/** The demo's hooks into the pretend browser. */
export const demo = {
  /** Plays the service worker's `runtime.onMessage` listener. */
  serve(handler: Worker) {
    worker = handler;
  },
  tabs: () => [...tabs.values()].map((t) => ({ ...t })),
  activate,
  /** A link with target=_blank: a new tab, opened by `sourceTabId`'s page. */
  async openFromPage(sourceTabId: number, url: string) {
    const t = await tabsApi.create({ url: 'about:blank', active: true });
    onCreatedNavigationTarget.emit({ sourceTabId, tabId: t.id, url });
    // The new tab's first request goes out a moment later, as in Chrome.
    await new Promise((r) => setTimeout(r, 40));
    navigate(need(t.id), url);
  },
  rules: () => sessionRules,
  onRules: rulesChanged,
  badge: (tabId: number) => badges.get(tabId),
  onBadge: badgeChanged,
  onActivated,
  onCreated,
  onRemoved,
  onCommitted,
};
