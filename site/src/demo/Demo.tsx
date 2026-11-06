/**
 * "Try it": two tabs in two lanes (drawn as the page's lane lines, live), a pretend Chrome window
 * with those tabs, Lanehead's real popup (src/entrypoints/popup) for the active tab, what that
 * tab's next request carries, and a terminal running `lanehead` commands. All of it runs on
 * Lanehead's real service worker code inside this page (world.ts).
 */
import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { loadView, Popup, type View } from '@/entrypoints/popup/Popup';
import { hostOf } from '@/shared/ui';
import { browser, demo, type FakeTab, MANAGE_EVENT } from './browserShim';
import { Terminal } from './Terminal';
import { boot, pageLoads, requestHeaders, SITE } from './world';

/** Re-renders on every change the pretend browser reports. */
function useBrowser() {
  const [, bump] = useState(0);
  useEffect(() => {
    const again = () => bump((n) => n + 1);
    const events = [demo.onRules, demo.onBadge, demo.onActivated, demo.onCreated, demo.onRemoved];
    const commit = () => again();
    for (const e of events) e.addListener(again);
    demo.onCommitted.addListener(commit);
    const off = pageLoads.subscribe(again);
    return () => {
      for (const e of events) e.removeListener(again);
      demo.onCommitted.removeListener(commit);
      off();
    };
  }, []);
  const tabs = demo.tabs();
  return { tabs, active: tabs.find((t) => t.active) };
}

export function Demo() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    boot().then(
      () => setReady(true),
      (err) => console.error('[demo]', err),
    );
  }, []);
  const root = useRef<HTMLDivElement>(null);
  useKeysStayInDemo(root);
  const [note, setNote] = useState('');
  useEffect(() => {
    const onManage = () =>
      setNote("The manage page is part of the extension; it isn't in this demo.");
    window.addEventListener(MANAGE_EVENT, onManage);
    return () => window.removeEventListener(MANAGE_EVENT, onManage);
  }, []);

  return (
    // Focusable (not tabbable), so a click anywhere in the demo keeps the popup's keys working.
    <div
      ref={root}
      className="demo"
      data-testid="demo"
      data-ready={ready || undefined}
      tabIndex={-1}
    >
      {ready ? <Stage onNote={setNote} /> : <div className="demo-loading" aria-hidden="true" />}
      <p className="demo-note" role="status" aria-live="polite">
        {note || 'Runs entirely in this page. Nothing is sent.'}
      </p>
    </div>
  );
}

function Stage({ onNote }: { onNote: (text: string) => void }) {
  const { tabs, active } = useBrowser();
  if (!active) return null;
  return (
    <div className="stage">
      <TabLanes tabs={tabs} active={active} />
      <section className="win browser" aria-label="Pretend browser window">
        <TabStrip tabs={tabs} active={active} onNote={onNote} />
        <Toolbar tab={active} />
        <div className="browser-body">
          <Page tab={active} />
          <div className="popup-anchor">
            <div className="popup-surface" data-testid="popup">
              <PopupFor tabId={active.id} />
            </div>
          </div>
        </div>
        <Sent tab={active} />
      </section>
      <Terminal tabs={tabs.map((t) => t.id)} />
    </div>
  );
}

/** A tab's lane, as its badge shows it: name and color, or none when it sends nothing extra. */
function laneOf(tab: FakeTab): { name: string; color?: string } {
  const badge = demo.badge(tab.id);
  const name = /^Lanehead — (.+?):/.exec(badge?.title ?? '')?.[1];
  return name && badge?.text ? { name, color: badge.color } : { name: 'off' };
}

const laneStyle = (color?: string) => (color ? ({ '--lane': color } as CSSProperties) : undefined);

/** Each tab on its own lane line, the way the hero draws them. */
function TabLanes({ tabs, active }: { tabs: FakeTab[]; active: FakeTab }) {
  return (
    <ul className="lanes demo-lanes" aria-label="Lanes" data-testid="lanes">
      {tabs.map((t) => {
        const lane = laneOf(t);
        return (
          <li
            key={t.id}
            className={lane.color ? 'lane' : 'lane lane-off'}
            style={laneStyle(lane.color)}
            data-active={t.id === active.id || undefined}
            data-testid={`lane-${t.index}`}
          >
            <span className="lane-label">{lane.name}</span>
            <span className="chip">
              <i className="chip-fav" aria-hidden="true" />
              <span className="chip-title">{t.title}</span>
              <span className="chip-id">tab {t.id}</span>
            </span>
            <span className="lane-line" aria-hidden="true" />
          </li>
        );
      })}
    </ul>
  );
}

function TabStrip({
  tabs,
  active,
  onNote,
}: {
  tabs: FakeTab[];
  active: FakeTab;
  onNote: (text: string) => void;
}) {
  return (
    <div className="tabstrip">
      <span className="lights" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <div className="tabs" role="tablist" aria-label="Tabs">
        {tabs.map((t) => (
          <div
            key={t.id}
            className="tab"
            style={laneStyle(laneOf(t).color)}
            data-active={t.id === active.id || undefined}
          >
            <button
              type="button"
              role="tab"
              aria-selected={t.id === active.id}
              data-testid={`tab-${t.index}`}
              title={`${t.title} (tab ${t.id})`}
              onClick={() => demo.activate(t.id)}
            >
              <span className="favicon" aria-hidden="true" />
              <span className="tab-title">{t.title}</span>
            </button>
            {tabs.length > 1 && (
              <button
                type="button"
                className="tab-close"
                aria-label={`Close ${t.title}`}
                onClick={() => {
                  void browser.tabs.remove(t.id);
                  onNote('');
                }}
              >
                <svg viewBox="0 0 10 10" width="8" height="8" aria-hidden="true">
                  <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>
      {tabs.length < 5 && (
        <button
          type="button"
          className="tab-new"
          aria-label="New tab"
          onClick={() => void browser.tabs.create({ url: `${SITE}/`, active: true })}
        >
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
            <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
      )}
    </div>
  );
}

function Toolbar({ tab }: { tab: FakeTab }) {
  const badge = demo.badge(tab.id);
  const url = new URL(tab.url);
  return (
    <div className="toolbar">
      <span className="nav-icons" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            d="M12.5 8a4.5 4.5 0 1 1-1.3-3.2M12.5 2.5v2.8H9.7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          />
        </svg>
      </span>
      <span className="omnibox" data-testid="url">
        <span className="dim">{`${url.protocol}//`}</span>
        {url.host}
        <span className="dim">{url.pathname === '/' ? '' : url.pathname}</span>
      </span>
      <span className="ext" title={badge?.title ?? 'Lanehead'}>
        <img src={`${import.meta.env.BASE_URL}icon/32.png`} alt="" width="16" height="16" />
        {badge?.text && (
          <span className="ext-badge" style={{ background: badge.color }} data-testid="badge">
            {badge.text}
          </span>
        )}
        <span className="sr-only">Lanehead{badge?.text ? `, lane ${badge.text}` : ''}</span>
      </span>
    </div>
  );
}

/** The pretend site: it shows the headers its page load arrived with. */
function Page({ tab }: { tab: FakeTab }) {
  const got = pageLoads.get(tab.id) ?? [];
  const env = got.find(([n]) => n === 'x-env')?.[1];
  const path = new URL(tab.url).pathname;
  const go = (to: string) => void browser.tabs.update(tab.id, { url: `${SITE}${to}` });
  return (
    <div className="page" data-testid="page">
      <div className="page-nav">
        <span className="page-logo">Example Shop</span>
        <nav aria-label="Example Shop">
          <button type="button" aria-current={path === '/' || undefined} onClick={() => go('/')}>
            Home
          </button>
          <button
            type="button"
            aria-current={path.startsWith('/checkout') || undefined}
            onClick={() => go('/checkout')}
          >
            Checkout
          </button>
        </nav>
      </div>
      <p className="page-kicker">This page was served by</p>
      <p className="page-backend" data-testid="served-by">
        {env ? `the ${env} backend` : 'production'}
      </p>
      <p className="page-kicker">Its request carried</p>
      {got.length ? (
        <dl className="hdrs">
          {got.map(([n, v]) => (
            <div key={n}>
              <dt>{n}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="hdrs-none">No extra headers</p>
      )}
      <button
        type="button"
        className="page-link"
        onClick={() => void demo.openFromPage(tab.id, `${SITE}/search`)}
      >
        Open search in a new tab ↗
      </button>
    </div>
  );
}

/** What the active tab's next request to its site carries, from the installed session rules. */
function Sent({ tab }: { tab: FakeTab }) {
  const sent = requestHeaders(demo.rules(), tab.id, tab.url);
  return (
    <div className="sent" data-testid="sent">
      <p className="sent-head">
        <span>Request headers sent</span>
        <span className="dim">
          next request from this tab · GET {hostOf(tab.url)}
          {new URL(tab.url).pathname}
        </span>
      </p>
      {sent.length ? (
        <dl className="hdrs">
          {sent.map(([n, v]) => (
            <div key={n}>
              <dt>{n}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="hdrs-none">No extra headers</p>
      )}
    </div>
  );
}

/** The real popup for `tabId`, read the way the extension opens it: everything first. */
function PopupFor({ tabId }: { tabId: number }) {
  const [shown, setShown] = useState<{ id: number; view: View } | null>(null);
  useEffect(() => {
    let live = true;
    loadView(tabId).then(
      (view) => live && setShown({ id: tabId, view }),
      (err) => console.error('[demo] popup', err),
    );
    return () => {
      live = false;
    };
  }, [tabId]);
  if (!shown) return null;
  return <Popup key={shown.id} initial={shown.view} standalone />;
}

/**
 * The popup's keys (1–9, 0, R) listen on the whole window, as they do in the extension. On this
 * page they only act while focus is inside the demo, so typing elsewhere changes nothing.
 */
function useKeysStayInDemo(root: RefObject<HTMLDivElement | null>) {
  const guard = useCallback(
    (e: KeyboardEvent) => {
      const el = root.current;
      const target = e.target as Node | null;
      if (!el || (target && el.contains(target))) return;
      e.stopImmediatePropagation();
    },
    [root],
  );
  useEffect(() => {
    window.addEventListener('keydown', guard, true);
    return () => window.removeEventListener('keydown', guard, true);
  }, [guard]);
}
