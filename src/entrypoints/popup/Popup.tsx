/**
 * The popup: which lane this tab is on and what it sends, then a fast way to switch lanes.
 * The tab's extra headers and the less common actions are behind two disclosures, both closed
 * when the popup opens. Keys (outside text fields): 1–9 pick a lane, 0 turns the tab off, R or
 * Enter reloads. In the UI a saved preset is a "lane".
 */
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { type Browser, browser } from 'wxt/browser';
import { CUSTOM_COLOR } from '@/core/badge';
import type { AgentState, Header, Preset, TabInfo } from '@/core/types';
import { AGENT_STATES, readAgent } from '@/shared/agent';
import { Checkbox } from '@/shared/Checkbox';
import {
  checkRows,
  type Done,
  HeaderRows,
  isBlank,
  isEdited,
  isFilled,
  newRow,
  type Row,
  spareRow,
  useDraftRows,
} from '@/shared/HeaderRows';
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

/**
 * The own-header rows for `own`, keeping what the user is in the middle of: a row keeps its id
 * (and so its focus) while it stands for the same header, an edited row keeps its text, and rows
 * not stored (yet) stay at the end. `sending`: rows whose save is on its way, by row id, with the
 * header sent; they are left as they are (marked saved only when the request succeeds).
 */
function syncRows(prev: Row[], own: Header[], sending: Map<string, Header>): Row[] {
  // A row being renamed: its old name is still stored for a moment, but it is not a row.
  const leaving = new Set(
    prev.flatMap((r) => {
      const h = sending.get(r.id);
      return h && r.saved && r.saved.name !== h.name ? [r.saved.name] : [];
    }),
  );
  const used = new Set<string>();
  const key = (r: Row) => sending.get(r.id)?.name ?? r.saved?.name ?? r.name.trim().toLowerCase();
  const saved = own
    .filter((h) => !leaving.has(h.name))
    .map((h) => {
      const r = prev.find((p) => !used.has(p.id) && key(p) === h.name);
      if (!r) return newRow(h, h);
      used.add(r.id);
      if (sending.has(r.id)) return r;
      return isEdited(r) ? { ...r, saved: h } : { ...r, name: h.name, value: h.value, saved: h };
    });
  // Rows not stored (yet), but not the spare empty row once there are others.
  const rest = prev.filter(
    (p) =>
      !used.has(p.id) &&
      (sending.has(p.id) || (!p.saved && !(p.spare && isBlank(p) && saved.length))),
  );
  const rows = [...saved, ...rest];
  return rows.length ? rows : [spareRow()];
}

export function Popup({ initial, standalone }: Props) {
  const [view, setView] = useState(initial);
  // Error text by place: 'lane', 'save', 'create', or an own-header row id.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingAs, setSavingAs] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Closed whenever the popup opens: what the tab sends is in the summary above it.
  const [ownOpen, setOwnOpen] = useState(false);
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

  const setError = (at: string, message: string | null) =>
    setErrors(({ [at]: _, ...rest }) => (message ? { ...rest, [at]: message } : rest));

  useEffect(() => {
    const onChange = () =>
      refresh().catch((err: Error) => setErrors((e) => ({ ...e, lane: err.message })));
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
      setErrors(({ [at]: _, lane: __, ...rest }) => rest);
      return true;
    } catch (err) {
      setError(at, (err as Error).message);
      return false;
    }
  };

  // Off means "send nothing": with no all-tabs preset that is simply no state at all.
  const choose = (target: Preset | 'off' | 'follow') => {
    focusReload.current = true;
    // Off drops the extra headers too: nothing left to edit (with no lanes: back to creating one).
    if (target === 'off') setOwnOpen(false);
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
      setError('lane', (err as Error).message);
      return;
    }
    if (!standalone) window.close();
  };

  // After a lane switch, Enter reloads.
  useEffect(() => {
    if (focusReload.current && tab.stale) reloadButton.current?.focus();
    focusReload.current = false;
  });

  // Off is there whenever there is something to turn off, lanes or not.
  const sendsAny = Object.keys(tab.headers).length > 0;
  const showLanes = presets.length > 0 || sendsAny;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || target.closest('input, textarea, select')) return;
      const picked = /^[1-9]$/.test(e.key) ? presets[Number(e.key) - 1] : undefined;
      if (picked) void choose(picked);
      else if (e.key === '0' && showLanes) void choose('off');
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

  // ---- The tab's own headers, as rows that save themselves. ----
  const sending = useRef(new Map<string, Header>()).current;
  const ownKey = JSON.stringify(own);
  const latestOwn = useRef(own);
  latestOwn.current = own;
  const [rows, setRows] = useState<Row[]>(() => syncRows([], own, sending));
  useEffect(
    () => setRows((prev) => syncRows(prev, JSON.parse(ownKey), sending)),
    [ownKey, sending],
  );

  // "Saved" for a moment after a save, read out politely.
  const [status, setStatus] = useState('');
  const statusTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flash = (text: string) => {
    clearTimeout(statusTimer.current);
    setStatus(text);
    statusTimer.current = setTimeout(() => setStatus(''), 1600);
  };
  useEffect(() => () => clearTimeout(statusTimer.current), []);

  // Open the extra headers and put the cursor in one: a header's value, or a row to type into.
  const [focusOwn, setFocusOwn] = useState<string | null>(null);
  const editOwn = (name = '') => {
    setOwnOpen(true);
    setFocusOwn(name);
  };
  useEffect(() => {
    if (focusOwn === null) return;
    const panel = document.getElementById('own-panel');
    const fields = panel?.querySelectorAll<HTMLInputElement>(
      focusOwn ? `input[aria-label="Value of ${CSS.escape(focusOwn)}"]` : 'input',
    );
    (focusOwn ? fields?.[0] : fields?.[Math.max(0, fields.length - 2)])?.focus();
    setFocusOwn(null);
  }, [focusOwn]);

  // A tab on the all-tabs preset keeps it when it gets headers of its own (it would lose it).
  const keepGlobal = tab.global && global ? { preset: global } : {};
  const savedOthers = (except: Row[]) =>
    rows.flatMap((r) => (r.saved && !except.some((e) => e.id === r.id) ? [r.saved] : []));

  // Send only the rows that changed (merged by name): never the whole list, which may be out of
  // date. A renamed row then clears its old name. A row counts as saved only once the request
  // succeeded; when it fails the row keeps its text and its error, so Enter or leaving it again
  // sends it again. Resolves true when every row is valid and saved.
  const saveRows = async (changed: Row[]): Promise<boolean> => {
    const edited = changed.filter((r) => !isBlank(r) && isEdited(r));
    const { headers, errors: bad } = checkRows(edited, savedOthers(changed));
    for (const r of changed) setError(r.id, bad[r.id] ?? null);
    const valid = edited.filter((r) => !bad[r.id]);
    const sent = valid
      .map((row, i) => ({ row, h: headers[i] as Header }))
      // Already on its way (Enter, then leaving the row at once): not twice.
      .filter(({ row, h }) => {
        const was = sending.get(row.id);
        return !was || was.name !== h.name || was.value !== h.value;
      });
    if (!sent.length) return valid.length === edited.length;
    for (const { row, h } of sent) sending.set(row.id, h);
    const renamed = sent.flatMap(({ row, h }) =>
      row.saved && row.saved.name !== h.name ? [row.saved.name] : [],
    );
    const ok = await act(sent[0]?.row.id ?? 'lane', async () => {
      await call('set', { tab: tab.id, headers: sent.map((s) => s.h), ...keepGlobal });
      if (renamed.length) await call('clear', { tab: tab.id, names: renamed });
    });
    if (ok) {
      // Saved: shown as stored, unless the user typed on in the meantime.
      setRows((rs) =>
        rs.map((r) => {
          const s = sent.find((x) => x.row.id === r.id);
          if (!s) return r;
          const same = r.name === s.row.name && r.value === s.row.value;
          return same
            ? { ...r, name: s.h.name, value: s.h.value, saved: s.h }
            : { ...r, saved: s.h };
        }),
      );
    }
    for (const { row } of sent) sending.delete(row.id);
    if (ok) flash('Saved');
    else setRows((rs) => syncRows(rs, latestOwn.current, sending));
    return ok && valid.length === edited.length;
  };

  // Enter saves (or reports what is wrong). Leaving a row saves it only when both its name and
  // value are typed; anything less is a draft, kept without a word.
  const rowDone = async (row: Row, how: Done): Promise<boolean> => {
    if (!row.saved && isBlank(row)) return true;
    if (how === 'blur' && !isFilled(row)) {
      setError(row.id, null);
      return false;
    }
    if (isBlank(row)) return removeRow(row);
    if (!isEdited(row)) {
      setError(row.id, null);
      return true;
    }
    return saveRows([row]);
  };

  const removeRow = async (row: Row): Promise<boolean> => {
    setError(row.id, null);
    if (row.saved) {
      const name = row.saved.name;
      const ok = await act(row.id, () => call('clear', { tab: tab.id, names: [name] }));
      if (ok) flash('Removed');
      return ok;
    }
    setRows((rs) => {
      const rest = rs.filter((r) => r.id !== row.id);
      return rest.length ? rest : [spareRow()];
    });
    return true;
  };

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

  const createFirst = (name: string, headers: Header[]) =>
    act('create', async () => {
      const saved = await call('preset.save', {
        preset: { name, color: nextColor([]), headers, domains: [] },
      });
      await call('set', { tab: tab.id, preset: saved.id, headers: [], replace: true });
    });

  const errorAt = (at: string) =>
    errors[at] && (
      <p role="alert" className="text-xs text-danger">
        {errors[at]}
      </p>
    );

  const color = preset?.color ?? (tab.lane === 'custom' ? CUSTOM_COLOR : undefined);
  const allTabs = preset ?? globalPreset;
  const web = /^https?:/.test(tab.url);
  const canOpen = web && !tab.global && (preset || own.length > 0);
  const firstRun = !presets.length && !own.length;
  const hasMore = !!allTabs || !!canOpen || own.length > 0;
  const agentState = AGENT_STATES[agent];

  const ownEditor = (
    <Disclosure
      id="own"
      title="Extra headers for this tab"
      open={ownOpen}
      onToggle={() => setOwnOpen(!ownOpen)}
    >
      {(preset || tab.global) && (
        <p className="pb-2 text-xs text-muted">Added to the lane's headers; same name wins.</p>
      )}
      <HeaderRows
        live
        label="Extra headers for this tab"
        rows={rows}
        onRows={setRows}
        errors={errors}
        onRowDone={rowDone}
        onPasted={saveRows}
        onRemove={removeRow}
        status={
          <p role="status" aria-live="polite" className="text-xs text-muted">
            {status}
          </p>
        }
      />
      <p className="pt-1.5 text-xs text-muted">Saves on Enter or when you leave the row.</p>
      <PasteTip />
    </Disclosure>
  );

  return (
    <main
      className="w-[380px] text-[13px] leading-5"
      style={laneStyle(color)}
      data-stale={tab.stale ? 'true' : undefined}
    >
      <div
        className={`h-[3px] ${tab.global ? 'opacity-40' : ''}`}
        style={{ background: color ?? 'transparent' }}
      />

      <header className="px-4 pt-3 pb-3.5">
        <p
          className={`truncate text-[11px] text-muted ${web ? 'font-mono' : ''}`}
          title={web ? tab.url : 'Lanes apply to the websites this tab opens.'}
        >
          {web ? hostOf(tab.url) : "This page can't use headers"}
        </p>
        <h1
          className="flex items-center gap-2 text-[19px] font-semibold leading-7 tracking-[-0.01em]"
          data-testid="lane"
        >
          {color && <span className={`dot size-[9px]! ${tab.global ? 'hollow' : ''}`} />}
          <LaneTitle tab={tab} preset={preset} lanes={presets.length > 0} />
        </h1>
        <Sends tab={tab} onEdit={editOwn} />
        {tab.lane === 'off' && global && (
          <p className="pt-0.5 text-xs text-muted">Left out of the all-tabs lane.</p>
        )}
        {errors.lane && <div className="pt-1.5">{errorAt('lane')}</div>}
      </header>

      {tab.stale && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 bg-hover px-4 py-2"
          data-testid="stale"
        >
          <p className="text-xs text-muted">The page loaded with other headers.</p>
          <button
            ref={reloadButton}
            type="button"
            className="btn btn-primary flex items-center gap-2"
            title="Reload tab (R)"
            aria-keyshortcuts="R"
            onClick={reload}
          >
            Reload tab
            <span aria-hidden="true">
              <kbd className="on-primary">R</kbd>
            </span>
          </button>
        </div>
      )}

      {showLanes && (
        <section aria-labelledby="lanes-heading" className="border-t border-line pt-2 pb-1.5">
          {/* With no lanes saved there is only Off: no heading to show. */}
          <h2
            id="lanes-heading"
            className={presets.length ? 'px-4 pb-0.5 text-[11px] text-muted' : 'sr-only'}
          >
            Switch lane
          </h2>
          <ul>
            {presets.map((p, i) => (
              <li key={p.id}>
                <LaneRow
                  keys={i < 9 ? String(i + 1) : undefined}
                  color={p.color}
                  name={p.name}
                  current={!tab.global && preset?.id === p.id}
                  onClick={() => choose(p)}
                />
              </li>
            ))}
            {globalPreset && (
              <li>
                <LaneRow
                  color={globalPreset.color}
                  hollow
                  name="Follow all tabs"
                  current={tab.global}
                  onClick={() => choose('follow')}
                />
              </li>
            )}
            <li>
              <LaneRow
                keys="0"
                hollow
                name="Off"
                current={tab.lane === 'off' || (tab.lane === null && !tab.global)}
                onClick={() => choose('off')}
              />
            </li>
          </ul>
        </section>
      )}

      {/* First run: create a lane, or (one click away) headers for just this tab. */}
      {firstRun && !ownOpen ? (
        <FirstLane
          onCreate={createFirst}
          onJustThisTab={() => editOwn()}
          error={errorAt('create')}
        />
      ) : (
        ownEditor
      )}

      {hasMore && (
        <Disclosure
          id="more"
          title="More actions"
          open={moreOpen}
          onToggle={() => setMoreOpen(!moreOpen)}
        >
          {allTabs && (
            <div className="pb-1" style={laneStyle(allTabs.color)}>
              <label className="action">
                <Checkbox
                  checked={global === allTabs.id}
                  onChange={(on) =>
                    act('more', () => call('global', { preset: on ? allTabs.id : null }))
                  }
                />
                <span>Use this lane for all tabs</span>
              </label>
              {global === allTabs.id && (
                <p className="pl-[21px] text-xs text-muted">
                  Tabs without a lane of their own send its headers.
                </p>
              )}
            </div>
          )}
          {canOpen && (
            <button
              type="button"
              className="action"
              onClick={() =>
                act('more', () =>
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
          {own.length > 0 &&
            (savingAs ? (
              <SaveAs onSave={saveAs} onCancel={() => setSavingAs(false)} error={errorAt('save')} />
            ) : (
              <button type="button" className="action" onClick={() => setSavingAs(true)}>
                Save as new lane
              </button>
            ))}
          {errorAt('more')}
        </Disclosure>
      )}

      <footer className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs">
        <button type="button" className="link" onClick={() => openManage('presets')}>
          Manage
        </button>
        <button
          type="button"
          className="link flex items-center gap-1.5"
          title={`Agent bridge: ${agentState.label}`}
          onClick={() => openManage('agents')}
        >
          {/* Only a live bridge earns a dot: most people never install one. */}
          {agent === 'connected' && <span className="dot" style={{ background: agentState.dot }} />}
          Agents
          <span className="sr-only" data-testid="agent-state">
            {agentState.label}
          </span>
        </button>
      </footer>
    </main>
  );
}

/** "No headers" only before any lane exists; with lanes, a tab sending nothing is Off. */
function LaneTitle({
  tab,
  preset,
  lanes,
}: {
  tab: TabInfo;
  preset: Preset | undefined;
  lanes: boolean;
}) {
  if (preset) {
    return (
      <>
        {tab.global && (
          <span className="shrink-0 font-normal whitespace-pre text-muted">All tabs: </span>
        )}
        <Name text={preset.name} />
      </>
    );
  }
  if (tab.lane === 'custom') return 'Custom headers';
  return <span className="text-muted">{tab.lane === 'off' || lanes ? 'Off' : 'No headers'}</span>;
}

/**
 * What the tab sends, once: one line per header; its own ones marked when it also has a lane (the
 * mark opens them for editing). The name column has one width, so values line up between lanes.
 */
function Sends({ tab, onEdit }: { tab: TabInfo; onEdit: (name: string) => void }) {
  const headers = Object.entries(tab.headers);
  if (!headers.length) return null;
  const mark = tab.lane !== 'custom';
  return (
    <>
      <dl
        aria-label="Sends"
        className="mt-1.5 grid grid-cols-[96px_minmax(0,1fr)_auto] gap-x-4 font-mono text-xs leading-[22px]"
      >
        {headers.map(([name, value]) => (
          <div key={name} className="contents">
            <dt title={name} className="truncate text-muted">
              {name}
            </dt>
            <dd title={value} className="truncate">
              {value}
            </dd>
            <dd className="font-sans text-[11px]">
              {mark && tab.own.includes(name) && (
                <button
                  type="button"
                  className="mark"
                  title="Edit in Extra headers for this tab"
                  aria-label={`Edit ${name}, a header of this tab`}
                  onClick={() => onEdit(name)}
                >
                  this tab
                </button>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {tab.domains && (
        <p className="pt-1 text-xs break-words text-muted">Only sent to {tab.domains.join(', ')}</p>
      )}
    </>
  );
}

type LaneRowProps = {
  /** The key that picks it. */
  keys?: string | undefined;
  color?: string;
  hollow?: boolean;
  name: string;
  current: boolean;
  onClick: () => void;
};

function LaneRow({ keys, color, hollow, name, current, onClick }: LaneRowProps) {
  return (
    <button
      type="button"
      aria-current={current}
      aria-keyshortcuts={keys}
      title={keys ? `Press ${keys}` : undefined}
      onClick={onClick}
      style={laneStyle(color)}
      className={`grid h-8 w-full grid-cols-[8px_minmax(0,1fr)_16px] items-center gap-x-3 px-4 text-left hover:bg-hover ${current ? 'current-row' : ''}`}
    >
      <span className={`dot ${hollow ? 'hollow' : ''}`} />
      <Name text={name} className={current ? 'font-semibold' : ''} />
      {/* The row's key, or a check on the current row (its key is still in the title). */}
      <span aria-hidden="true" className="text-center">
        {current ? <span className="lane-text text-xs">✓</span> : keys && <kbd>{keys}</kbd>}
      </span>
    </button>
  );
}

function Disclosure({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-line">
      <button
        type="button"
        className="disclosure"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={onToggle}
      >
        <span>{title}</span>
        <svg className="chevron" viewBox="0 0 8 8" width="8" height="8" aria-hidden="true">
          <path d="M2.5 1l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
      {open && (
        <div id={`${id}-panel`} className="px-4 pb-3">
          {children}
        </div>
      )}
    </section>
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
    <form onSubmit={submit} className="space-y-1 pt-1">
      <div className="flex gap-2">
        <input
          name="name"
          aria-label="Lane name"
          placeholder="Lane name"
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

const PasteTip = () => (
  <p className="text-xs text-muted">Tip: paste name: value lines to add several.</p>
);

function FirstLane({
  onCreate,
  onJustThisTab,
  error,
}: {
  onCreate: (name: string, headers: Header[]) => void;
  onJustThisTab: () => void;
  error: ReactNode;
}) {
  const draft = useDraftRows([]);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const headers = draft.submit();
    if (headers) onCreate(String(new FormData(e.currentTarget).get('name')), headers);
  };
  return (
    <form
      onSubmit={submit}
      aria-labelledby="create-heading"
      className="border-t border-line px-4 pt-3 pb-4"
    >
      <h2 id="create-heading" className="font-medium">
        Create a lane
      </h2>
      <p className="pb-3 text-xs text-muted">A named set of headers you can switch any tab to.</p>
      <label htmlFor="lane-name" className="block pb-1 text-[11px] text-muted">
        Lane name
      </label>
      <input
        id="lane-name"
        name="name"
        placeholder="lane_a"
        className="input mb-3 block w-full"
        autoComplete="off"
        spellCheck={false}
      />
      <HeaderRows label="Headers" {...draft.editor} />
      <div className="pt-1">
        <PasteTip />
      </div>
      {error && <div className="pt-1">{error}</div>}
      <button type="submit" className="btn btn-primary mt-3">
        Create and use in this tab
      </button>
      <p className="pt-3 text-xs">
        <button type="button" className="link" onClick={onJustThisTab}>
          Or add headers just for this tab
        </button>
      </p>
    </form>
  );
}
