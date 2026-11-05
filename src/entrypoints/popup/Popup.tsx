/** Placeholder popup for the current tab. Phase 2 replaces it. */
import { type FormEvent, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { Ops, Preset, TabInfo } from '@/core/types';
import { call } from '@/shared/messages';

export function Popup() {
  const [tab, setTab] = useState<TabInfo | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [error, setError] = useState('');

  const run = (work: Promise<TabInfo>) => {
    setError('');
    work.then(setTab, (err: Error) => setError(err.message));
  };

  useEffect(() => {
    browser.tabs
      .query({ active: true, currentWindow: true })
      .then(([active]) => {
        if (active?.id !== undefined) return call('get', { tab: active.id }).then(setTab);
      })
      .catch((err: Error) => setError(err.message));
    call('presets', {}).then(
      (r) => setPresets(r.presets),
      (err: Error) => setError(err.message),
    );
  }, []);

  if (!tab) return <p className="p-3 w-72">{error || 'Loading…'}</p>;
  const set = (args: Omit<Ops['set'][0], 'tab'>) => run(call('set', { tab: tab.id, ...args }));

  const addHeader = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    set({ headers: [{ name: String(form.get('name')), value: String(form.get('value')) }] });
  };

  return (
    <main className="p-3 w-72 space-y-2 text-sm">
      <p>
        Lane: <b>{tab.lane ?? 'none'}</b>
        {tab.global && ' (all tabs)'}
      </p>
      <ul>
        {Object.entries(tab.headers).map(([name, value]) => (
          <li key={name}>
            {name}: {value}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-1">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            className="border px-1"
            onClick={() => set({ preset: p.id })}
          >
            {p.name}
          </button>
        ))}
        <button type="button" className="border px-1" onClick={() => set({ off: true })}>
          Off
        </button>
      </div>
      <form onSubmit={addHeader} className="flex gap-1">
        <input name="name" placeholder="name" className="border w-24 px-1" />
        <input name="value" placeholder="value" className="border w-24 px-1" />
        <button type="submit" className="border px-1">
          Add
        </button>
      </form>
      <div className="flex gap-1">
        <button
          type="button"
          className="border px-1"
          onClick={() => run(call('clear', { tab: tab.id }))}
        >
          Clear
        </button>
        <button
          type="button"
          className="border px-1"
          onClick={() => run(call('reload', { tab: tab.id }))}
        >
          Reload
        </button>
        <button
          type="button"
          className="border px-1"
          onClick={() => browser.runtime.openOptionsPage()}
        >
          Manage
        </button>
      </div>
      {error && <p className="text-red-600">{error}</p>}
    </main>
  );
}
