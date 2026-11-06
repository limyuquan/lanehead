/** Lanes (saved presets; "lane" in everything the user reads): create, edit, delete, reorder,
 * import and export. */
import { type FormEvent, useRef, useState } from 'react';
import { deriveBadge, PALETTE } from '@/core/badge';
import { validatePreset } from '@/core/headers';
import type { Preset } from '@/core/types';
import { HeaderRows, useDraftRows } from '@/shared/HeaderRows';
import { call, uiText } from '@/shared/messages';
import { Name } from '@/shared/Name';
import { focusOnMount, laneStyle, nextColor } from '@/shared/ui';
import { type Data, SectionHead } from './Manage';

/** Names of PALETTE's colors, same order. */
const COLOR_NAMES = ['Blue', 'Green', 'Red', 'Amber', 'Purple', 'Teal', 'Pink', 'Indigo'];

export function Presets({ data }: { data: Data }) {
  const { presets, global } = data;
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const move = (from: number, to: number) => {
    const ids = presets.map((p) => p.id);
    ids.splice(to, 0, ...ids.splice(from, 1));
    call('preset.order', { ids }).catch((err: Error) =>
      setNote({ text: err.message, error: true }),
    );
  };

  const exportFile = () => {
    const json = JSON.stringify({ presets: presets.map(({ id: _, ...p }) => p) }, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`${json}\n`], { type: 'application/json' }));
    a.download = 'lanehead-lanes.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // A preset whose name exists already updates it; the rest are added. Every entry is checked
  // first, so a bad file imports nothing.
  const importFile = async (f: File) => {
    setNote(null);
    let list: unknown[];
    try {
      const json = JSON.parse(await f.text());
      list = Array.isArray(json) ? json : json?.presets;
      if (!Array.isArray(list)) throw new Error();
    } catch {
      setNote({ text: 'Choose a JSON file exported from Lanehead.', error: true });
      return;
    }
    const checked: Omit<Preset, 'id'>[] = [];
    for (const [i, entry] of list.entries()) {
      try {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
          throw new Error('It is not a lane.');
        }
        const p = entry as Partial<Preset>;
        const others = checked.map((c) => ({ ...c, id: '' }));
        checked.push(validatePreset({ ...p, domains: p.domains ?? [] } as Preset, others));
      } catch (err) {
        const name = (entry as Partial<Preset> | null)?.name;
        const which = typeof name === 'string' && name ? `"${name}"` : `Entry ${i + 1}`;
        setNote({
          text: `Nothing imported. ${which}: ${uiText((err as Error).message)}`,
          error: true,
        });
        return;
      }
    }
    let known = presets;
    for (const p of checked) {
      const same = known.find((k) => k.name.toLowerCase() === String(p.name).trim().toLowerCase());
      try {
        const saved = await call('preset.save', {
          preset: { ...p, domains: p.domains ?? [], ...(same && { id: same.id }) },
        });
        known = [...known.filter((k) => k.id !== saved.id), saved];
      } catch (err) {
        const text = `"${p.name}": ${(err as Error).message} Lanes above it in the file were imported.`;
        setNote({ text, error: true });
        return;
      }
    }
    setNote({
      text: `Imported ${checked.length === 1 ? '1 lane' : `${checked.length} lanes`}.`,
    });
  };

  const editor = (preset?: Preset) => (
    <Editor
      key={preset?.id ?? 'new'}
      preset={preset}
      color={nextColor(presets)}
      isGlobal={!!preset && preset.id === global}
      onDone={() => setEditing(null)}
    />
  );

  return (
    <section aria-labelledby="presets-heading">
      <SectionHead
        id="presets"
        title="Lanes"
        about="Named sets of headers. Put a tab in one from the popup, or let an agent do it."
      >
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
          New lane
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => file.current?.click()}>
          Import…
        </button>
        <button
          type="button"
          className="btn btn-quiet"
          onClick={exportFile}
          disabled={!presets.length}
        >
          Export
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          aria-label="Import lanes file"
          className="hidden"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (f) void importFile(f);
          }}
        />
      </SectionHead>
      {note && (
        <p role="status" className={`pb-4 ${note.error ? 'text-danger' : 'text-muted'}`}>
          {note.text}
        </p>
      )}

      {editing === 'new' && <div className="border-t border-line">{editor()}</div>}
      {presets.length ? (
        <table className="w-full table-fixed border-collapse text-left">
          <thead className="text-xs text-muted">
            {/* Editing the first lane: the form takes the column labels' place (collapsed, so
                the columns keep their widths). */}
            <tr className={`border-y border-line ${editing === presets[0]?.id ? 'collapse' : ''}`}>
              <th className="w-[40%] py-2 pr-4 font-normal sm:w-[30%]">Name</th>
              <th className="hidden w-[68px] py-2 pr-4 font-normal sm:table-cell">Badge</th>
              <th className="py-2 pr-4 font-normal">Headers</th>
              <th className="hidden w-[18%] py-2 pr-4 font-normal sm:table-cell">Sends to</th>
              <th className="w-[124px] py-2 font-normal">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {presets.map((p, i) =>
              editing === p.id ? (
                <tr key={p.id} className={`border-line ${i ? 'border-b' : 'border-y'}`}>
                  <td colSpan={5}>{editor(p)}</td>
                </tr>
              ) : (
                <tr
                  key={p.id}
                  className="border-b border-line align-top"
                  style={laneStyle(p.color)}
                >
                  <td className="py-3 pr-4">
                    <span className="flex items-center gap-2.5">
                      <span className="dot" />
                      <Name text={p.name} className="font-medium" />
                      {p.id === global && (
                        <span className="shrink-0 text-xs text-muted">all tabs</span>
                      )}
                    </span>
                  </td>
                  <td className="hidden py-3 pr-4 sm:table-cell">
                    <span className="badge">{p.badge ?? deriveBadge(p.name)}</span>
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs leading-6">
                    {p.headers.map((h) => (
                      <div key={h.name} className="break-all">
                        <span className="text-muted">{h.name}:</span> {h.value}
                      </div>
                    ))}
                  </td>
                  <td className="hidden py-3 pr-4 break-words text-muted sm:table-cell">
                    {p.domains.length ? p.domains.join(', ') : 'all sites'}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      className="btn text-muted hover:text-ink disabled:opacity-30"
                      aria-label={`Move ${p.name} up`}
                      disabled={i === 0}
                      onClick={() => move(i, i - 1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn text-muted hover:text-ink disabled:opacity-30"
                      aria-label={`Move ${p.name} down`}
                      disabled={i === presets.length - 1}
                      onClick={() => move(i, i + 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet ml-1"
                      aria-label={`Edit ${p.name}`}
                      onClick={() => setEditing(p.id)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      ) : (
        editing !== 'new' && (
          <p className="border-t border-line pt-4 text-muted">
            No lanes yet. Create one, or import a file exported from Lanehead.
          </p>
        )
      )}
    </section>
  );
}

type EditorProps = {
  preset: Preset | undefined;
  /** Color for a new lane. */
  color: string;
  isGlobal: boolean;
  onDone: () => void;
};

function Editor({ preset, color: initialColor, isGlobal, onDone }: EditorProps) {
  const [name, setName] = useState(preset?.name ?? '');
  const [color, setColor] = useState(preset?.color ?? initialColor);
  const [badge, setBadge] = useState(preset?.badge ?? '');
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const draft = useDraftRows(preset?.headers ?? []);
  const id = preset?.id ?? 'new';

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const headers = draft.submit();
    if (!headers) return setError('');
    try {
      const saved = await call('preset.save', {
        preset: {
          ...(preset && { id: preset.id }),
          name,
          color,
          badge,
          headers,
          domains: String(form.get('domains'))
            .split(/[\s,]+/)
            .filter(Boolean),
        },
      });
      const allTabs = form.get('allTabs') === 'on';
      if (allTabs !== isGlobal) await call('global', { preset: allTabs ? saved.id : null });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async () => {
    if (!preset) return;
    try {
      await call('preset.delete', { id: preset.id });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const row = 'grid gap-x-6 gap-y-1 py-2 sm:grid-cols-[130px_minmax(0,1fr)]';
  const label = 'pt-1.5 text-muted';
  return (
    <form
      onSubmit={save}
      aria-label={preset ? `Edit ${preset.name}` : 'New lane'}
      className="max-w-[720px] py-5"
      style={laneStyle(color)}
    >
      <div className={row}>
        <label htmlFor={`${id}-name`} className={label}>
          Name
        </label>
        <input
          id={`${id}-name`}
          className="input w-full max-w-[360px]"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="feature_login"
          ref={preset ? undefined : focusOnMount}
        />
      </div>
      <div className={row}>
        <span id={`${id}-color`} className={label}>
          Color
        </span>
        <div role="radiogroup" aria-labelledby={`${id}-color`} className="flex gap-3 pt-2">
          {PALETTE.map((c, i) => (
            <label key={c} className="swatch" style={laneStyle(c)}>
              <input type="radio" name="color" checked={color === c} onChange={() => setColor(c)} />
              <span className="sr-only">{COLOR_NAMES[i]}</span>
            </label>
          ))}
        </div>
      </div>
      <div className={row}>
        <label htmlFor={`${id}-badge`} className={label}>
          Badge
        </label>
        <div className="flex items-center gap-3">
          <input
            id={`${id}-badge`}
            className="input w-24 font-mono"
            maxLength={4}
            value={badge}
            onChange={(e) => setBadge(e.currentTarget.value)}
            placeholder={deriveBadge(name)}
          />
          <span className="badge">{badge.trim() || deriveBadge(name)}</span>
          <span className="text-xs text-muted">
            On the toolbar icon. Empty: made from the name.
          </span>
        </div>
      </div>
      <div className={row}>
        <span id={`${id}-headers`} className={label}>
          Headers
        </span>
        <div className="max-w-[520px]">
          <HeaderRows label="Headers" {...draft.editor} />
          <p className="pt-1 text-xs text-muted">Tip: paste name: value lines to add several.</p>
        </div>
      </div>
      <div className={row}>
        <label htmlFor={`${id}-domains`} className={label}>
          Only send to
        </label>
        <div>
          <input
            id={`${id}-domains`}
            name="domains"
            className="input w-full font-mono text-xs leading-5"
            defaultValue={preset?.domains.join(', ')}
            placeholder="all sites"
            spellCheck={false}
          />
          <p className="pt-1 text-xs text-muted">
            Hosts like example.com, comma separated; subdomains included. Empty: every site.
          </p>
        </div>
      </div>
      <div className={row}>
        <span className={label}>All tabs</span>
        <label className="flex items-center gap-2 pt-1.5">
          <input type="checkbox" name="allTabs" defaultChecked={isGlobal} />
          Send to every tab without a lane of its own
        </label>
      </div>
      {error && (
        <p role="alert" className="pt-2 text-danger sm:pl-[154px]">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-4 sm:pl-[154px]">
        <button type="submit" className="btn btn-primary">
          {preset ? 'Save' : 'Create lane'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onDone}>
          Cancel
        </button>
        {preset && (
          <span className="ml-auto flex items-center gap-2">
            {confirming ? (
              <>
                <span className="text-muted">Tabs in this lane lose its headers.</span>
                <button
                  type="button"
                  className="btn text-danger"
                  aria-label={`Delete ${preset.name}`}
                  onClick={remove}
                >
                  Delete
                </button>
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => setConfirming(false)}
                >
                  Keep
                </button>
              </>
            ) : (
              <button type="button" className="btn text-danger" onClick={() => setConfirming(true)}>
                Delete…
              </button>
            )}
          </span>
        )}
      </div>
    </form>
  );
}
