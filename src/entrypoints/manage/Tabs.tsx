/** Tabs: every open tab, grouped by window, with its lane and headers. */
import { useState } from 'react';
import { CUSTOM_COLOR } from '@/core/badge';
import type { TabInfo } from '@/core/types';
import { call } from '@/shared/messages';
import { hostOf, laneStyle } from '@/shared/ui';
import { type Data, SectionHead } from './Manage';

export function Tabs({ data }: { data: Data }) {
  const { presets, global, windows } = data;
  const globalPreset = presets.find((p) => p.id === global);
  const [error, setError] = useState<{ tab: number; message: string } | null>(null);

  const run = async (tab: number, work: Promise<unknown>) => {
    try {
      await work;
      setError(null);
    } catch (err) {
      setError({ tab, message: (err as Error).message });
    }
  };

  // Same choices as the popup. Off means "send nothing": with no all-tabs preset, no state at all.
  const choose = (tab: TabInfo, value: string) =>
    run(
      tab.id,
      value === 'follow' || (value === 'off' && !global)
        ? call('clear', { tab: tab.id })
        : value === 'off'
          ? call('set', { tab: tab.id, off: true })
          : call('set', { tab: tab.id, preset: value }),
    );

  const laneValue = (tab: TabInfo) =>
    tab.global
      ? 'follow'
      : tab.lane === 'custom'
        ? 'custom'
        : (presets.find((p) => p.name === tab.lane)?.id ?? 'off');

  return (
    <section aria-labelledby="tabs-heading">
      <SectionHead
        id="tabs"
        title="Tabs"
        about="Every open tab and the headers it sends. Changes apply to the next request."
      />
      {windows.map((tabs, w) => (
        <div key={tabs[0]?.id ?? w} className="pb-8">
          <h3 className="pb-2 text-xs text-muted">Window {w + 1}</h3>
          <table className="w-full table-fixed border-collapse text-left">
            <thead className="sr-only">
              <tr>
                <th>Tab</th>
                <th>Lane</th>
                <th>Headers</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody className="border-t border-line">
              {tabs.map((tab) => {
                const preset = presets.find((p) => p.name === tab.lane);
                const headers = Object.entries(tab.headers);
                return (
                  <tr key={tab.id} className="border-b border-line align-top">
                    <td className="w-[34%] py-3 pr-6">
                      <div className="truncate" title={tab.title}>
                        {tab.title || tab.url}
                      </div>
                      <div className="truncate font-mono text-xs text-muted">{hostOf(tab.url)}</div>
                    </td>
                    <td className="w-[24%] py-3 pr-6">
                      <div
                        className="flex items-center gap-2"
                        style={laneStyle(
                          preset?.color ?? (tab.lane === 'custom' ? CUSTOM_COLOR : undefined),
                        )}
                      >
                        <span
                          className={`dot ${preset || tab.lane === 'custom' ? '' : 'hollow'}`}
                        />
                        <select
                          aria-label={`Lane of ${tab.title || tab.url}`}
                          className="field -ml-1.5 max-w-full py-1"
                          value={laneValue(tab)}
                          onChange={(e) => choose(tab, e.currentTarget.value)}
                        >
                          {presets.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                          {globalPreset && (
                            <option value="follow">Follow all tabs ({globalPreset.name})</option>
                          )}
                          <option value="off">Off</option>
                          {tab.lane === 'custom' && (
                            <option value="custom" disabled>
                              Custom headers
                            </option>
                          )}
                        </select>
                      </div>
                      {error?.tab === tab.id && (
                        <p role="alert" className="pt-1 text-xs text-danger">
                          {error.message}
                        </p>
                      )}
                    </td>
                    <td
                      className={`py-3 pr-6 font-mono text-xs leading-6 ${tab.global ? 'text-muted' : ''}`}
                    >
                      {headers.length ? (
                        headers.map(([name, value]) => (
                          <div key={name} className="truncate" title={`${name}: ${value}`}>
                            <span className="text-muted">{name}:</span> {value}
                          </div>
                        ))
                      ) : (
                        <span className="text-muted">none</span>
                      )}
                    </td>
                    <td className="w-[150px] py-2 text-right whitespace-nowrap">
                      {tab.stale && (
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => run(tab.id, call('reload', { tab: tab.id }))}
                        >
                          Reload
                        </button>
                      )}
                      {tab.lane !== null && !tab.global && (
                        <button
                          type="button"
                          className="btn btn-quiet ml-2"
                          aria-label={`Clear ${tab.title || tab.url}`}
                          onClick={() => run(tab.id, call('clear', { tab: tab.id }))}
                        >
                          Clear
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
