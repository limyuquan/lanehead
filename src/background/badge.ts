/** Per-tab toolbar badge and tooltip. */
import { browser } from 'wxt/browser';
import { badgeOf, titleOf } from '@/core/badge';
import { laneOf } from '@/core/compile';
import type { State } from './store';

export async function badgeTab(tabId: number, state: State): Promise<void> {
  const lane = laneOf(state.tabs[tabId], state.presets, state.global);
  const badge = badgeOf(lane);
  await Promise.all([
    browser.action.setBadgeText({ tabId, text: badge?.text ?? '' }),
    badge && browser.action.setBadgeBackgroundColor({ tabId, color: badge.color }),
    badge && browser.action.setBadgeTextColor({ tabId, color: '#ffffff' }),
    browser.action.setTitle({ tabId, title: titleOf(lane) }),
  ]).catch(() => {
    // The tab closed meanwhile.
  });
}

export async function refreshBadges(state: State): Promise<void> {
  const tabs = await browser.tabs.query({});
  await Promise.all(tabs.map((t) => t.id !== undefined && badgeTab(t.id, state)));
}
