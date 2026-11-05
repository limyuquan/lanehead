/**
 * The manage page: Presets, Tabs, Agents, Settings, one section at a time (`#presets`, …).
 * Live: it re-reads everything when storage or tabs change, so agent changes show up at once.
 */
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { type Browser, browser } from 'wxt/browser';
import type { Preset, Settings, Status, TabInfo } from '@/core/types';
import { call } from '@/shared/messages';
import { Agents } from './Agents';
import { Presets } from './Presets';
import { Tabs } from './Tabs';

export type Data = {
  presets: Preset[];
  global: string | null;
  settings: Settings;
  status: Status;
  /** Open web tabs grouped by window, in tab-strip order. */
  windows: TabInfo[][];
};

async function load(): Promise<Data> {
  const [{ presets, global }, settings, status, { tabs }, chromeTabs] = await Promise.all([
    call('presets', {}),
    call('settings', {}),
    call('status', {}),
    call('tabs', {}),
    browser.tabs.query({}),
  ]);
  // The extension's own pages never send headers; leave them out.
  const ours = browser.runtime.getURL('/');
  const byId = new Map(tabs.filter((t) => !t.url.startsWith(ours)).map((t) => [t.id, t]));
  const windows = new Map<number, TabInfo[]>();
  for (const t of chromeTabs.sort((a, b) => a.windowId - b.windowId || a.index - b.index)) {
    const info = t.id !== undefined && byId.get(t.id);
    if (info) windows.set(t.windowId, [...(windows.get(t.windowId) ?? []), info]);
  }
  return { presets, global, settings, status, windows: [...windows.values()] };
}

const SECTIONS = [
  ['presets', 'Presets'],
  ['tabs', 'Tabs'],
  ['agents', 'Agents'],
  ['settings', 'Settings'],
] as const;
type Section = (typeof SECTIONS)[number][0];

const fromHash = (): Section =>
  SECTIONS.find(([id]) => `#${id}` === location.hash)?.[0] ?? 'presets';

export function Manage() {
  const [data, setData] = useState<Data>();
  const [error, setError] = useState('');
  const [section, setSection] = useState(fromHash);

  const refresh = useCallback(() => {
    load().then(setData, (err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    refresh();
    const onTab = (_: number, info: Browser.tabs.OnUpdatedInfo) =>
      (info.url || info.title) && refresh();
    const onHash = () => setSection(fromHash());
    browser.storage.onChanged.addListener(refresh);
    browser.tabs.onCreated.addListener(refresh);
    browser.tabs.onRemoved.addListener(refresh);
    browser.tabs.onMoved.addListener(refresh);
    browser.tabs.onAttached.addListener(refresh);
    browser.tabs.onUpdated.addListener(onTab);
    window.addEventListener('hashchange', onHash);
    return () => {
      browser.storage.onChanged.removeListener(refresh);
      browser.tabs.onCreated.removeListener(refresh);
      browser.tabs.onRemoved.removeListener(refresh);
      browser.tabs.onMoved.removeListener(refresh);
      browser.tabs.onAttached.removeListener(refresh);
      browser.tabs.onUpdated.removeListener(onTab);
      window.removeEventListener('hashchange', onHash);
    };
  }, [refresh]);

  return (
    <div className="mx-auto max-w-[960px] px-6 pt-8 pb-24 text-sm leading-6 sm:px-10">
      <header className="flex flex-wrap items-end gap-x-12 gap-y-2 border-b border-line">
        <h1 className="pb-3 text-[15px] font-semibold tracking-[-0.01em]">Lanehead</h1>
        <nav aria-label="Sections" className="flex gap-7">
          {SECTIONS.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={section === id ? 'page' : undefined}
              className={`-mb-px border-b-2 pb-3 ${
                section === id
                  ? 'border-ink font-medium text-ink'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {label}
            </a>
          ))}
        </nav>
      </header>
      {error && (
        <p role="alert" className="pt-6 text-danger">
          {error}
        </p>
      )}
      {data && (
        <main className="pt-9">
          {section === 'presets' && <Presets data={data} />}
          {section === 'tabs' && <Tabs data={data} />}
          {section === 'agents' && <Agents data={data} />}
          {section === 'settings' && <SettingsSection settings={data.settings} />}
        </main>
      )}
    </div>
  );
}

/** A section's heading and one line about it, with optional actions on the right. */
export function SectionHead({
  id,
  title,
  about,
  children,
}: {
  /** Section id; the heading gets `<id>-heading`. */
  id: string;
  title: string;
  about: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div>
        <h2 id={`${id}-heading`} className="text-xl font-semibold tracking-[-0.015em]">
          {title}
        </h2>
        <p className="text-muted">{about}</p>
      </div>
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  );
}

const SWITCHES: [keyof Settings, string, string][] = [
  [
    'inheritOnOpen',
    'Inherit the lane on open',
    'A tab opened from a tab with headers (a link, ⌘-click, window.open) starts in the same lane.',
  ],
  [
    'reloadOnChange',
    'Reload the tab after a change',
    'Reload right after its lane or headers change, instead of offering a Reload button.',
  ],
  [
    'agentControl',
    'Agent control',
    'Connect to the Lanehead bridge so the lanehead CLI can read and switch tabs.',
  ],
];

function SettingsSection({ settings }: { settings: Settings }) {
  const [error, setError] = useState('');
  return (
    <section aria-labelledby="settings-heading">
      <SectionHead id="settings" title="Settings" about="Stored in this browser profile." />
      <ul className="border-t border-line">
        {SWITCHES.map(([key, label, about]) => (
          <li key={key} className="border-b border-line py-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1.5"
                checked={settings[key] as boolean}
                onChange={(e) =>
                  call('settings', { patch: { [key]: e.currentTarget.checked } }).catch(
                    (err: Error) => setError(err.message),
                  )
                }
              />
              <span>
                <span className="block font-medium">{label}</span>
                <span className="block text-muted">{about}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="pt-3 text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
