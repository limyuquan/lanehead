/**
 * The popup: the current tab's lane and headers.
 * Keys (outside text fields): 1–9 pick a preset, 0 turns the tab off, R or Enter reloads.
 */
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { type Browser, browser } from 'wxt/browser';
import { CUSTOM_COLOR } from '@/core/badge';
import { parseHeaderLines, validateHeader } from '@/core/headers';
import type { AgentState, Header, Preset, TabInfo } from '@/core/types';
import { AGENT_STATES, readAgent } from '@/shared/agent';
import { Checkbox } from '@/shared/Checkbox';
import { call } from '@/shared/messages';
import { Name } from '@/shared/Name';
import { focusOnMount, hostOf, laneStyle, nextColor, openManage } from '@/shared/ui';

export type View = { tab: TabInfo; presets: Preset[]; global: string | null; agent: AgentState };

/** Everything the popup shows, read in parallel. */
export async function loadView(tab: number): Promise<View> {
  const [info, { presets, global }, agent] = await Promise.all([
    call('get', { tab }),
    call('presets', {}),
    readAgent(),
  ]);
  return { tab: info, presets, global, agent };
}

type Props = {
  initial: View;
  /** Opened as a page (`popup.html?tab=<id>`): stay open after reloading. */
  standalone: boolean;
};

export function Popup({ initial, standalone }: Props) {
  const [view, setView] = useState(initial);
  const [error, setError] = useState<{ at: string; message: string } | null>(null);
  const [savingAs, setSavingAs] = useState(false);
  const reloadButton = useRef<HTMLButtonElement>(null);
  const focusReload = useRef(false);

  const { tab, presets, global, agent } = view;
  const preset = presets.find((p) => p.name === tab.lane);
  const globalPreset = presets.find((p) => p.id === global);
  const own: Header[] = tab.own.map((name) => ({ name, value: tab.headers[name] ?? '' }));

  // Re-read on every change from anywhere (an agent, the manage page, a navigation), so the popup
  // never acts on an old picture. Only the latest of overlapping reads is shown.
  const latest = useRef(0);
  const tabId = initial.tab.id;
  const refresh = useCallback(async () => {
    const n = ++latest.current;
    const next = await loadView(tabId);
    if (n === latest.current) setView(next);
  }, [tabId]);

  useEffect(() => {
    const onChange = () =>
      refresh().catch((err: Error) => setError({ at: 'lane', message: err.message }));
    const onTab = (id: number, info: Browser.tabs.OnUpdatedInfo) =>
      id === tabId && (info.url || info.title) && onChange();
    browser.storage.onChanged.addListener(onChange);
    browser.tabs.onUpdated.addListener(onTab);
    return () => {
      browser.storage.onChanged.removeListener(onChange);
      browser.tabs.onUpdated.removeListener(onTab);
    };
  }, [refresh, tabId]);

  /** Runs a change and re-reads the view. On failure shows the error at `at` and returns false. */
  const act = async (at: string, work: () => Promise<unknown>): Promise<boolean> => {
    try {
      await work();
      await refresh();
      setError(null);
      return true;
    } catch (err) {
      setError({ at, message: (err as Error).message });
      return false;
    }
  };

  // Off means "send nothing": with no all-tabs preset that is simply no state at all.
  const choose = (target: Preset | 'off' | 'follow') => {
    focusReload.current = true;
    return act('lane', () =>
      target === 'follow' || (target === 'off' && !global)
        ? call('clear', { tab: tab.id })
        : target === 'off'
          ? call('set', { tab: tab.id, off: true })
          : call('set', { tab: tab.id, preset: target.id }),
    );
  };

  const reload = async () => {
    try {
      await call('reload', { tab: tab.id });
    } catch (err) {
      setError({ at: 'lane', message: (err as Error).message });
      return;
    }
    if (!standalone) window.close();
  };

  // After a lane switch, Enter reloads.
  useEffect(() => {
    if (focusReload.current && tab.stale) reloadButton.current?.focus();
    focusReload.current = false;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || target.closest('input, textarea, select')) return;
      const picked = /^[1-9]$/.test(e.key) ? presets[Number(e.key) - 1] : undefined;
      if (picked) void choose(picked);
      else if (e.key === '0' && presets.length) void choose('off');
      else if (
        tab.stale &&
        (e.key.toLowerCase() === 'r' || (e.key === 'Enter' && target === document.body))
      )
        void reload();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Send only the edited header (merged by name): never the whole list, which may be out of date.
  const editOwn = (old: Header, next: Header, at: string) =>
    act(at, async () => {
      const h = validateHeader(next);
      await call('set', { tab: tab.id, headers: [h] });
      if (h.name !== old.name) await call('clear', { tab: tab.id, names: [old.name] });
    });

  // A tab on the all-tabs preset keeps it when it gets headers of its own (it would lose it).
  const addHeaders = (text: string) =>
    act('add', () =>
      call('set', {
        tab: tab.id,
        headers: parseHeaderLines(text),
        ...(tab.global && global && { preset: global }),
      }),
    );

  const saveAs = (name: string) =>
    act('save', async () => {
      const saved = await call('preset.save', {
        preset: {
          name,
          color: nextColor(presets),
          headers: Object.entries(tab.headers).map(([n, value]) => ({ name: n, value })),
          // Never broader than what the tab sent.
          domains: preset?.domains ?? [],
        },
      });
      await call('set', { tab: tab.id, preset: saved.id, headers: [], replace: true });
      setSavingAs(false);
    });

  const createFirst = (name: string, text: string) =>
    act('create', async () => {
      const saved = await call('preset.save', {
        preset: { name, color: nextColor([]), headers: parseHeaderLines(text), domains: [] },
      });
      await call('set', { tab: tab.id, preset: saved.id, headers: [], replace: true });
    });

  const errorAt = (at: string) =>
    error?.at === at && (
      <p role="alert" className="text-xs text-danger">
        {error.message}
      </p>
    );

  const barColor = preset?.color ?? (tab.lane === 'custom' ? CUSTOM_COLOR : undefined);
  const allTabs = preset ?? globalPreset;
  const http = /^https?:/.test(tab.url);
  const canOpen = http && !tab.global && (preset || own.length > 0);
  const agentState = AGENT_STATES[agent];

  return (
    <main className="w-[380px] text-[13px] leading-5">
      <div
        className={`h-[3px] ${tab.global ? 'opacity-40' : ''}`}
        style={{ background: barColor ?? 'transparent' }}
      />
      <header className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-3">
        <div className="min-w-0">
          <h1
            className="flex text-[19px] font-semibold leading-7 tracking-[-0.01em]"
            data-testid="lane"
          >
            <LaneTitle tab={tab} preset={preset} />
          </h1>
          <p className="truncate font-mono text-[11px] text-muted">{hostOf(tab.url)}</p>
        </div>
        {tab.stale && (
          <button
            ref={reloadButton}
            type="button"
            className="btn btn-primary mt-1 flex items-center gap-2"
            onClick={reload}
          >
            Reload tab <kbd className="text-current opacity-60">↵</kbd>
          </button>
        )}
      </header>
      {errorAt('lane') && <div className="px-4 pb-2">{errorAt('lane')}</div>}

      {presets.length ? (
        <section aria-labelledby="lane-heading" className="border-t border-line pt-2.5 pb-2">
          <h2 id="lane-heading" className="px-4 pb-1 text-[11px] text-muted">
            Lane
          </h2>
          <ul>
            {presets.map((p, i) => (
              <li key={p.id}>
                <LaneRow
                  kbd={i < 9 ? String(i + 1) : ''}
                  color={p.color}
                  name={p.name}
                  summary={summary(p)}
                  current={!tab.global && preset?.id === p.id}
                  onClick={() => choose(p)}
                />
              </li>
            ))}
            {globalPreset && (
              <li>
                <LaneRow
                  kbd=""
                  color={globalPreset.color}
                  hollow
                  name="Follow all tabs"
                  summary={globalPreset.name}
                  current={tab.global}
                  onClick={() => choose('follow')}
                />
              </li>
            )}
            <li>
              <LaneRow
                kbd="0"
                hollow
                name="Off"
                summary="no headers"
                current={tab.lane === 'off' || (tab.lane === null && !tab.global)}
                onClick={() => choose('off')}
              />
            </li>
          </ul>
        </section>
      ) : (
        <FirstLane own={own} onCreate={createFirst} error={errorAt('create')} />
      )}

      {(presets.length > 0 || own.length > 0) && (
        <section
          aria-labelledby="headers-heading"
          className="border-t border-line px-4 pt-2.5 pb-3"
        >
          <h2 id="headers-heading" className="pb-1 text-[11px] text-muted">
            Headers
          </h2>
          {preset && (
            <div style={laneStyle(preset.color)} className="pb-1.5">
              <p className="flex items-center gap-1.5 pb-0.5 text-[11px] text-muted">
                <span className="dot" />
                <span className="shrink-0">from</span>
                <Name text={preset.name} />
                {tab.global && <span className="shrink-0">(all tabs)</span>}
              </p>
              <dl className="grid grid-cols-[minmax(0,40%)_minmax(0,1fr)] font-mono text-xs">
                {preset.headers.map((h) => {
                  const overridden = tab.own.includes(h.name);
                  return (
                    <div key={h.name} className="contents">
                      <dt
                        title={h.name}
                        className={`truncate px-[7px] py-[3px] ${overridden ? 'text-faint line-through' : 'text-muted'}`}
                      >
                        {h.name}
                      </dt>
                      <dd
                        title={h.value}
                        className={`truncate px-[7px] py-[3px] ${overridden ? 'text-faint line-through' : ''}`}
                      >
                        {h.value}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          )}
          {own.length > 0 && (
            <div className="pb-1">
              {(preset || tab.global) && <p className="pb-0.5 text-[11px] text-muted">this tab</p>}
              <ul>
                {own.map((h, i) => (
                  <li key={`${h.name}=${h.value}`}>
                    <OwnRow
                      header={h}
                      onCommit={(next) => editOwn(h, next, `own-${i}`)}
                      onDelete={() =>
                        act(`own-${i}`, () => call('clear', { tab: tab.id, names: [h.name] }))
                      }
                    />
                    {errorAt(`own-${i}`)}
                  </li>
                ))}
              </ul>
              {preset && preset.domains.length > 0 && (
                <p className="px-[7px] pt-0.5 text-[11px] break-words text-muted">
                  Sent only to {preset.domains.join(', ')}, like the preset.
                </p>
              )}
            </div>
          )}
          {tab.lane === 'off' && (
            <p className="pb-1 text-xs text-muted">
              This tab sends no headers{global && ', not even the all-tabs ones'}.
            </p>
          )}
          <AddHeaders onAdd={addHeaders} onEmptyEnter={tab.stale ? reload : undefined} />
          {errorAt('add')}
        </section>
      )}

      {(allTabs || canOpen || own.length > 0) && (
        <section className="space-y-2 border-t border-line px-4 py-3">
          {allTabs && (
            <div>
              <label className="flex items-center gap-2" style={laneStyle(allTabs.color)}>
                <Checkbox
                  checked={global === allTabs.id}
                  onChange={(on) =>
                    act('lane', () => call('global', { preset: on ? allTabs.id : null }))
                  }
                />
                <span className="flex min-w-0 gap-[0.3em]">
                  <span className="shrink-0">Use</span>
                  <Name text={allTabs.name} className="lane-text font-medium" />
                  <span className="shrink-0">for all tabs</span>
                </span>
              </label>
              {global === allTabs.id && (
                <p className="pl-[21px] text-xs text-muted">
                  Tabs without a lane of their own send its headers.
                </p>
              )}
            </div>
          )}
          {savingAs ? (
            <SaveAs onSave={saveAs} onCancel={() => setSavingAs(false)} error={errorAt('save')} />
          ) : (
            (canOpen || own.length > 0) && (
              <div className="flex gap-4 text-xs">
                {canOpen && (
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      act('lane', () =>
                        call('open', {
                          url: tab.url,
                          headers: own,
                          ...(preset && { preset: preset.id }),
                          focus: true,
                        }),
                      )
                    }
                  >
                    Open new tab in this lane
                  </button>
                )}
                {own.length > 0 && (
                  <button type="button" className="link" onClick={() => setSavingAs(true)}>
                    Save as preset
                  </button>
                )}
              </div>
            )
          )}
        </section>
      )}

      <footer className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs">
        <nav className="flex gap-4">
          <button type="button" className="link" onClick={() => openManage('presets')}>
            Manage
          </button>
          <button type="button" className="link" onClick={() => openManage('tabs')}>
            All tabs
          </button>
          <button
            type="button"
            className="link flex items-center gap-1.5"
            title={`Agent bridge: ${agentState.label}`}
            onClick={() => openManage('agents')}
          >
            <span className="dot" style={{ background: agentState.dot }} />
            Agents
            <span className="sr-only" data-testid="agent-state">
              {agentState.label}
            </span>
          </button>
        </nav>
        {presets.length > 0 && (
          <span className="text-faint">
            <kbd>1–9</kbd> lane · <kbd>R</kbd> reload
          </span>
        )}
      </footer>
    </main>
  );
}

/** The headers that say more than the name, then the sites it is limited to. */
function summary(p: Preset): string {
  const headers = p.headers.filter((h) => h.value !== p.name).map((h) => `${h.name}=${h.value}`);
  const only = p.domains.length ? [`only ${p.domains.join(', ')}`] : [];
  return [...headers, ...only].join('  ');
}

function LaneTitle({ tab, preset }: { tab: TabInfo; preset: Preset | undefined }) {
  if (preset) {
    return (
      <>
        {tab.global && (
          <span className="shrink-0 font-normal whitespace-pre text-muted">All tabs: </span>
        )}
        <Name text={preset.name} className="lane-text" />
      </>
    );
  }
  if (tab.lane === 'custom') return 'Custom headers';
  return <span className="text-muted">{tab.lane === 'off' ? 'Off' : 'No headers'}</span>;
}

type LaneRowProps = {
  kbd: string;
  color?: string;
  hollow?: boolean;
  name: string;
  summary: string;
  current: boolean;
  onClick: () => void;
};

function LaneRow({ kbd, color, hollow, name, summary, current, onClick }: LaneRowProps) {
  return (
    <button
      type="button"
      aria-current={current}
      onClick={onClick}
      style={laneStyle(color)}
      className={`grid h-8 w-full grid-cols-[10px_8px_minmax(0,1fr)_auto_12px] items-center gap-x-3 px-4 text-left hover:bg-hover ${current ? 'current-row' : ''}`}
    >
      <kbd>{kbd}</kbd>
      <span className={`dot ${hollow ? 'hollow' : ''}`} />
      <Name text={name} className={current ? 'font-semibold' : ''} />
      <span title={summary} className="max-w-[140px] truncate font-mono text-[11px] text-muted">
        {summary}
      </span>
      <span aria-hidden="true" className="lane-text text-xs">
        {current ? '✓' : ''}
      </span>
    </button>
  );
}

function OwnRow({
  header,
  onCommit,
  onDelete,
}: {
  header: Header;
  onCommit: (next: Header) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(header.name);
  const [value, setValue] = useState(header.value);
  const commit = () => {
    if (name !== header.name || value !== header.value) onCommit({ name, value });
  };
  const keys = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') {
      e.preventDefault();
      setName(header.name);
      setValue(header.value);
    }
  };
  return (
    <div className="group grid grid-cols-[minmax(0,40%)_minmax(0,1fr)_20px] items-center font-mono text-xs">
      <input
        aria-label="Header name"
        className="field"
        value={name}
        title={name}
        onChange={(e) => setName(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={keys}
        spellCheck={false}
      />
      <input
        aria-label={`Value of ${header.name}`}
        className="field"
        value={value}
        title={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={keys}
        spellCheck={false}
      />
      <button
        type="button"
        aria-label={`Remove ${header.name}`}
        title="Remove"
        onClick={onDelete}
        className="text-faint opacity-0 hover:text-ink focus:opacity-100 group-hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}

function AddHeaders({
  onAdd,
  onEmptyEnter,
}: {
  onAdd: (text: string) => Promise<boolean>;
  onEmptyEnter: (() => void) | undefined;
}) {
  const [text, setText] = useState('');
  const submit = async (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    if (!text.trim()) onEmptyEnter?.();
    else if (await onAdd(text)) setText('');
  };
  return (
    <div>
      <textarea
        aria-label="Add headers"
        aria-describedby="add-hint"
        className="peer field mt-0.5 block w-full resize-none font-mono text-xs"
        rows={Math.min(6, text.split('\n').length)}
        placeholder="+ name: value  (paste several lines)"
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={submit}
        spellCheck={false}
      />
      <p
        id="add-hint"
        className={`px-[7px] pt-0.5 text-[11px] text-faint ${text ? '' : 'hidden peer-focus:block'}`}
      >
        <kbd>Enter</kbd> to add · <kbd>Shift+Enter</kbd> for a new line
      </p>
    </div>
  );
}

function SaveAs({
  onSave,
  onCancel,
  error,
}: {
  onSave: (name: string) => void;
  onCancel: () => void;
  error: ReactNode;
}) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSave(String(new FormData(e.currentTarget).get('name')));
  };
  return (
    <form onSubmit={submit} className="space-y-1">
      <div className="flex gap-2">
        <input
          name="name"
          aria-label="Preset name"
          placeholder="Preset name"
          className="input flex-1"
          ref={focusOnMount}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
        />
        <button type="submit" className="btn btn-primary">
          Save
        </button>
        <button type="button" className="btn btn-quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error}
    </form>
  );
}

function FirstLane({
  own,
  onCreate,
  error,
}: {
  own: Header[];
  onCreate: (name: string, headers: string) => void;
  error: ReactNode;
}) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    onCreate(String(form.get('name')), String(form.get('headers')));
  };
  return (
    <form onSubmit={submit} className="space-y-2 border-t border-line px-4 pt-3 pb-4">
      <div>
        <h2 className="font-medium">Create a lane</h2>
        <p className="text-xs text-muted">A named set of headers you can switch any tab to.</p>
      </div>
      <input
        name="name"
        aria-label="Lane name"
        placeholder="Name, e.g. feature_login"
        className="input block w-full"
      />
      <textarea
        name="headers"
        aria-label="Headers"
        rows={3}
        defaultValue={own.map((h) => `${h.name}: ${h.value}`).join('\n')}
        placeholder={'x-env: feature_login\nx-canary: 1'}
        className="input block w-full resize-none font-mono text-xs"
        spellCheck={false}
      />
      {error}
      <button type="submit" className="btn btn-primary">
        Create and use in this tab
      </button>
    </form>
  );
}
