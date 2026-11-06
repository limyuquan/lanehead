/**
 * Headers edited as key/value rows: [Name] [Value] [×] per header, then "Add header". The popup
 * (the current lane's headers, saved row by row) and the forms (create a lane, the manage page's
 * preset editor) all use it, so headers are edited the same way everywhere.
 *
 * Pasting `name: value` lines (one or many, curl `-H` too) into a Name field splits them into
 * rows. Validation is core's (`validateHeader`, `validateHeaders`); `checkRows` maps its errors to
 * the rows, which show them inline.
 *
 * A row missing its name or value is a draft: leaving it is not "done" (no save, no error). Enter
 * is (live editors): it saves the row, and on the last row then opens a new one. Removing a row
 * moves focus to the next row's name (else the previous row's, else "Add header").
 */
import {
  type ClipboardEvent,
  type Dispatch,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { splitHeaderLines, validateHeader, validateHeaders } from '@/core/headers';
import type { Header } from '@/core/types';

/**
 * One row as typed. `saved`: the header this row stands for in storage (live editors). `spare`:
 * the empty row shown when there are no others (not one the user added).
 */
export type Row = { id: string; name: string; value: string; saved?: Header; spare?: true };

let seq = 0;
export const newRow = (h: Partial<Header> = {}, saved?: Header): Row => ({
  id: `row${++seq}`,
  name: h.name ?? '',
  value: h.value ?? '',
  ...(saved && { saved }),
});

export const isBlank = (r: Row) => !r.name.trim() && !r.value.trim();

/** The empty row an editor shows when it has no others. */
export const spareRow = (): Row => ({ ...newRow(), spare: true });

/** Both name and value typed: leaving the row means it is done. */
export const isFilled = (r: Row) => !!r.name.trim() && !!r.value.trim();

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
      errors[r.id] = rowError(r, (err as Error).message);
    }
  }
  return { headers, errors };
}

/** Core's message, said plainer where a row shows what went wrong. */
const rowError = (r: Row, message: string) =>
  !r.name.trim()
    ? 'Give this header a name.'
    : /\s/.test(r.name.trim())
      ? "Header names can't contain spaces."
      : message;

/** How a row was finished: Enter in it (live editors), or focus left it. */
export type Done = 'enter' | 'blur';

type Props = {
  rows: Row[];
  /** A state setter: rows change through updates, so a late change never undoes a newer one. */
  onRows: Dispatch<SetStateAction<Row[]>>;
  /** Error text by row id, shown under that row. */
  errors?: Record<string, string>;
  /**
   * Focus left a row, or Enter was pressed in it (when `live`). Resolving true after Enter on the
   * last row opens a new row.
   */
  onRowDone?: (row: Row, how: Done) => unknown;
  /** Rows a paste changed or added, after `onRows`. */
  onPasted?: (rows: Row[]) => void;
  /**
   * Remove a row; default: drop it from `rows` (keeping one blank row). Resolving false means it
   * failed: focus stays on its × button.
   */
  onRemove?: (row: Row) => unknown;
  /** Escape put a row back to its saved header. */
  onRestored?: (row: Row) => void;
  /**
   * Rows save themselves: Enter saves the row (on the last row it then opens a new one), Escape
   * restores its saved header; Enter or Escape on an empty new row removes it.
   */
  live?: boolean;
  /** Shown under the rows, next to "Add header" (a save status). */
  status?: ReactNode;
  /** Accessible name of the whole editor. */
  label: string;
  placeholder?: Header;
  /**
   * Rows that read as plain text until hovered or focused, in the popup's name/value columns, with
   * no column labels.
   */
  compact?: boolean;
  /** Tooltip of "Add header". */
  addTitle?: string;
  /** Shown after the rows, before "Add header" (rows the editor does not own). */
  extra?: ReactNode;
};

export function HeaderRows({
  rows,
  onRows,
  errors = {},
  onRowDone,
  onPasted,
  onRemove,
  onRestored,
  live = false,
  status,
  label,
  placeholder = { name: 'x-env', value: 'lane_a' },
  compact = false,
  addTitle,
  extra,
}: Props) {
  const base = useId();
  const fieldId = (row: Row, part: 'name' | 'value') => `${base}${row.id}-${part}`;
  const addButton = useRef<HTMLButtonElement>(null);
  // Focus to move after the next render: a field's id, or 'add' for "Add header".
  const [focusNext, setFocusNext] = useState<string | null>(null);
  useEffect(() => {
    if (focusNext === 'add') addButton.current?.focus();
    else if (focusNext) document.getElementById(focusNext)?.focus();
    setFocusNext(null);
  }, [focusNext]);

  const update = (id: string, patch: Partial<Row>) =>
    onRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const remove = (row: Row) => {
    if (onRemove) return onRemove(row);
    onRows((rs) => {
      const rest = rs.filter((r) => r.id !== row.id);
      return rest.length ? rest : [spareRow()];
    });
  };

  // The × button: once the row is gone, focus the next row's name, else the previous one's, else
  // "Add header". When removing fails, focus stays on ×.
  const removeAndFocus = async (row: Row) => {
    const i = rows.findIndex((r) => r.id === row.id);
    const near = rows[i + 1] ?? rows[i - 1];
    if ((await remove(row)) === false) return;
    setFocusNext(near ? fieldId(near, 'name') : 'add');
  };

  const add = () => {
    const row = newRow();
    onRows((rs) => [...rs, row]);
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
    // A line without a value pastes as a name with no value (a draft), never borrowing the old one.
    const changed = { ...row, name: first.name, value: first.value };
    const added = more.map((h) => newRow(h));
    onRows((rs) => rs.flatMap((r) => (r.id === row.id ? [changed, ...added] : [r])));
    onPasted?.([changed, ...added]);
    const last = added.at(-1) ?? changed;
    setFocusNext(fieldId(last, last.value ? 'name' : 'value'));
  };

  const keys = (row: Row, e: KeyboardEvent<HTMLInputElement>) => {
    if (!live || (e.key !== 'Enter' && e.key !== 'Escape')) return;
    // An empty row nobody saved: Enter or Escape drops it (the last one stays, to type into).
    if (!row.saved && isBlank(row)) {
      e.preventDefault();
      if (rows.length > 1) {
        void remove(row);
        addButton.current?.focus();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const last = rows.at(-1)?.id === row.id;
      void Promise.resolve(onRowDone?.(row, 'enter')).then((ok) => ok === true && last && add());
    } else if (row.saved && isEdited(row)) {
      e.preventDefault();
      update(row.id, { name: row.saved.name, value: row.saved.value });
      onRestored?.(row);
    }
  };

  // Done with a row when focus leaves it, not when it moves from its name to its value.
  const blur = (row: Row, e: FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onRowDone?.(row, 'blur');
  };

  return (
    <fieldset aria-label={label} className="min-w-0">
      {/* Visual column labels: each field already has its own accessible name. */}
      {!compact && (
        <div aria-hidden="true" className="kv-grid pb-0.5 text-[11px] text-muted">
          <span className="px-2">Header</span>
          <span className="px-2">Value</span>
        </div>
      )}
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
            className={`min-w-0 ${compact ? '' : 'pb-1'}`}
          >
            <div className={`group ${compact ? 'kv-grid kv-compact' : 'kv-grid'}`}>
              <input
                id={fieldId(row, 'name')}
                aria-label="Header name"
                aria-invalid={badName || undefined}
                aria-describedby={error ? errorId : undefined}
                className={compact ? 'kv kv-quiet kv-name' : 'kv'}
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
                className={compact ? 'kv kv-quiet' : 'kv'}
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
                onClick={() => void removeAndFocus(row)}
              >
                <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
                  <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </button>
            </div>
            {error && (
              <p
                id={errorId}
                role="alert"
                className={`pt-0.5 text-[11px] text-danger ${compact ? 'pb-1' : 'px-2'}`}
              >
                {error}
              </p>
            )}
          </fieldset>
        );
      })}
      {extra}
      <div className="flex items-center justify-between gap-3">
        <button
          ref={addButton}
          type="button"
          className={compact ? 'kv-add kv-add-compact' : 'kv-add'}
          title={addTitle}
          onClick={add}
        >
          <span aria-hidden="true">+</span> Add header
        </button>
        {status}
      </div>
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
 * Rows for a form that saves all headers at once. A row shows its error once focus left it with
 * both fields typed (or it was pasted); `submit` shows every error and returns the headers, or
 * null when a row is bad.
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
      onRowDone: (row: Row) => isFilled(row) && show([row.id]),
      // A pasted line without a value is a draft, like one typed.
      onPasted: (pasted: Row[]) => show(pasted.filter(isFilled).map((r) => r.id)),
    },
    submit(): Header[] | null {
      setShown('all');
      return Object.keys(errors).length ? null : headers;
    },
  };
}
