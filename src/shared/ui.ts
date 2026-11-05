/** Small helpers shared by the popup and the manage page. */
import type { CSSProperties } from 'react';
import { browser } from 'wxt/browser';
import { PALETTE } from '@/core/badge';
import type { Preset } from '@/core/types';

/** Host of a URL, or the URL itself when it has none (about:blank, chrome://newtab). */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** Inline style that sets `--lane`, read by `.lane-text` and `.dot`. */
export function laneStyle(color: string | undefined): CSSProperties {
  return { '--lane': color ?? 'var(--color-faint)' } as CSSProperties;
}

/** Focuses the manage page at `section` (opening it if needed). */
export async function openManage(section: string): Promise<void> {
  const base = browser.runtime.getURL('/manage.html');
  const url = `${base}#${section}`;
  const [open] = (await browser.tabs.query({})).filter((t) => t.url?.startsWith(base));
  if (open?.id === undefined) {
    await browser.tabs.create({ url });
    return;
  }
  await browser.tabs.update(open.id, { url, active: true });
  if (open.windowId !== undefined) await browser.windows.update(open.windowId, { focused: true });
}

/** The first palette color no preset uses yet (cycling once all are taken). */
export function nextColor(presets: Preset[]): string {
  const free = PALETTE.find((c) => !presets.some((p) => p.color === c));
  return free ?? (PALETTE[presets.length % PALETTE.length] as string);
}
