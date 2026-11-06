/**
 * Headers edited as key/value rows: [Name] [Value] [×] per header, then "Add header". The popup
 * (a tab's own headers, saved row by row) and the forms (create a lane, the manage page's preset
 * editor) all use it, so headers are edited the same way everywhere.
 *
 * Pasting `name: value` lines (one or many, curl `-H` too) into a Name field splits them into
 * rows. Validation is core's (`validateHeader`, `validateHeaders`); `checkRows` maps its errors to
 * the rows, which show them inline.
 */
import {
  type ClipboardEvent,
  type FocusEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useState,
} from 'react';
import { splitHeaderLines, validateHeader, validateHeaders } from '@/core/headers';
import type { Header } from '@/core/types';

/** One row as typed. `saved`: the header this row stands for in storage (live editors). */
export type Row = { id: string; name: string; value: string; saved?: Header };

let seq = 0;
export const newRow = (h: Partial<Header> = {}, saved?: Header): Row => ({
  id: `row${++seq}`,
  name: h.name ?? '',
  value: h.value ?? '',
  ...(saved && { saved }),
});

export const isBlank = (r: Row) => !r.name.trim() && !r.value.trim();

/** A row differs from what it stands for (a row never saved always does). */
export const isEdited = (r: Row) =>
  !r.saved || r.name !== r.saved.name || r.value !== r.saved.value;

/**
 * The validated headers of the non-blank rows, and each bad row's error (core's message) by row
 * id. `others`: headers that exist besides these rows; a row may not repeat their names.
 */
export function checkRows(rows: Row[], others: Header[] = []) {
  const headers: Header[] = [];
  const errors: Record<string, string> = {};
  for (const r of rows) {
    if (isBlank(r)) continue;
    try {
      const h = validateHeader(r);
      validateHeaders([...others, ...headers, h]);
      headers.push(h);
    } catch (err) {
      errors[r.id] = (err as Error).message;
    }
  }
  return { headers, errors };
}

type Props = {
  rows: Row[];
  onRows: (rows: Row[]) => void;
  /** Error text by row id, shown under that row. */
  errors?: Record<string, string>;
  /** Focus left a row, or Enter was pressed in it (when `live`). */
  onRowDone?: (row: Row) => void;
  /** Rows a paste changed or added, after `onRows`. */
  onPasted?: (rows: Row[]) => void;
  /** Remove a row; default: drop it from `rows` (keeping one blank row). */
  onRemove?: (row: Row) => void;
  /** Rows save themselves: Enter saves the row, Escape restores its saved header. */
  live?: boolean;
  /** Accessible name of the whole editor. */
  label: string;
  placeholder?: Header;
};

export function HeaderRows({
  rows,
  onRows,
  errors = {},
  onRowDone,
  onPasted,
  onRemove,
  live = false,
  label,
  placeholder = { name: 'x-env', value: 'lane_a' },
}: Props) {
  const base = useId();
  const fieldId = (row: Row, part: 'name' | 'value') => `${base}${row.id}-${part}`;
  // Focus to move after the next render (a row just added).
  const [focusNext, setFocusNext] = useState<string | null>(null);
  useEffect(() => {
    if (focusNext) document.getElementById(focusNext)?.focus();
    setFocusNext(null);
  }, [focusNext]);

  const update = (id: string, patch: Partial<Row>) =>
    onRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const remove = (row: Row) => {
    if (onRemove) return onRemove(row);
    const rest = rows.filter((r) => r.id !== row.id);
    onRows(rest.length ? rest : [newRow()]);
  };

  const add = () => {
    const row = newRow();
    onRows([...rows, row]);
    setFocusNext(fieldId(row, 'name'));
  };

  // `x-env: a` (or several lines) pasted into a Name field becomes rows; a bare name pastes as is.
  const paste = (row: Row, e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!/[:\n]/.test(text.trim())) return;
    const [first, ...more] = splitHeaderLines(text).map((h) => ({
      name: h.name.trim(),
      value: h.value.trim(),
    }));
    if (!first) return;
    e.preventDefault();
    const changed = { ...row, name: first.name, value: first.value || row.value };
    const added = more.map((h) => newRow(h));
    const i = rows.findIndex((r) => r.id === row.id);
    onRows([...rows.slice(0, i), changed, ...added, ...rows.slice(i + 1)]);
    onPasted?.([changed, ...added]);
    const last = added.at(-1) ?? changed;
    setFocusNext(fieldId(last, last.value ? 'name' : 'value'));
  };

  const keys = (row: Row, e: KeyboardEvent<HTMLInputElement>) => {
    if (!live) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      onRowDone?.(row);
    } else if (e.key === 'Escape' && row.saved && isEdited(row)) {
      e.preventDefault();
      update(row.id, { name: row.saved.name, value: row.saved.value });
    }
  };

  // Done with a row when focus leaves it, not when it moves from its name to its value.
  const blur = (row: Row, e: FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onRowDone?.(row);
  };

  return (
    <fieldset aria-label={label} className="min-w-0">
      <div aria-hidden="true" className="kv-grid pb-0.5 text-[11px] text-faint">
        <span className="px-2">Header</span>
        <span className="px-2">Value</span>
      </div>
      {rows.map((row) => {
        const error = errors[row.id];
        const errorId = `${base}${row.id}-error`;
        const name = row.name.trim().toLowerCase();
        // Which field the error is about: the name, if it alone fails validation.
        const badName = !!error && !nameIsValid(row.name);
        return (
          <fieldset
            key={row.id}
            aria-label={name ? `Header ${name}` : 'New header'}
            onBlur={(e) => blur(row, e)}
            className="min-w-0 pb-1"
          >
            <div className="kv-grid group">
              <input
                id={fieldId(row, 'name')}
                aria-label="Header name"
                aria-invalid={badName || undefined}
                aria-describedby={error ? errorId : undefined}
                className="kv"
                value={row.name}
                title={row.name || undefined}
                placeholder={placeholder.name}
                onChange={(e) => update(row.id, { name: e.currentTarget.value })}
                onPaste={(e) => paste(row, e)}
                onKeyDown={(e) => keys(row, e)}
                spellCheck={false}
                autoComplete="off"
              />
              <input
                id={fieldId(row, 'value')}
                aria-label={name ? `Value of ${name}` : 'Header value'}
                aria-invalid={(!!error && !badName) || undefined}
                aria-describedby={error ? errorId : undefined}
                className="kv"
                value={row.value}
                title={row.value || undefined}
                placeholder={placeholder.value}
                onChange={(e) => update(row.id, { value: e.currentTarget.value })}
                onKeyDown={(e) => keys(row, e)}
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="button"
                aria-label={name ? `Remove ${name}` : 'Remove header'}
                title="Remove"
                className="kv-remove"
                onClick={() => remove(row)}
              >
                <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
                  <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </button>
            </div>
            {error && (
              <p id={errorId} role="alert" className="px-2 pt-0.5 text-[11px] text-danger">
                {error}
              </p>
            )}
          </fieldset>
        );
      })}
      <button type="button" className="kv-add" onClick={add}>
        <span aria-hidden="true">+</span> Add header
      </button>
    </fieldset>
  );
}

const nameIsValid = (name: string) => {
  try {
    validateHeader({ name, value: 'v' });
    return true;
  } catch {
    return false;
  }
};

/**
 * Rows for a form that saves all headers at once. A row shows its error once focus left it (or it
 * was pasted); `submit` shows every error and returns the headers, or null when a row is bad.
 */
export function useDraftRows(initial: Header[]) {
  const [rows, setRows] = useState(() =>
    initial.length ? initial.map((h) => newRow(h)) : [newRow()],
  );
  const [shown, setShown] = useState<'all' | Set<string>>(() => new Set());
  const { headers, errors } = checkRows(rows);
  const show = (ids: string[]) => setShown((s) => (s === 'all' ? s : new Set([...s, ...ids])));
  return {
    editor: {
      rows,
      onRows: setRows,
      errors:
        shown === 'all'
          ? errors
          : Object.fromEntries(Object.entries(errors).filter(([id]) => shown.has(id))),
      onRowDone: (row: Row) => show([row.id]),
      onPasted: (pasted: Row[]) => show(pasted.map((r) => r.id)),
    },
    submit(): Header[] | null {
      setShown('all');
      return Object.keys(errors).length ? null : headers;
    },
  };
}
