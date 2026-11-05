/** Tab lifecycle: state follows tabs as they close, get replaced or open other tabs. */
import { browser } from 'wxt/browser';
import { badgeTab } from './badge';
import { current, markLoaded, update } from './store';

function logError(err: unknown) {
  console.error('[lanehead]', err);
}

export function installTabListeners(): void {
  // Chrome clears per-tab badges on every navigation, and new tabs start without one.
  const rebadge = (tabId: number) => {
    current()
      .then((state) => badgeTab(tabId, state))
      .catch(logError);
  };
  browser.tabs.onCreated.addListener((tab) => tab.id !== undefined && rebadge(tab.id));
  browser.webNavigation.onCommitted.addListener(({ frameId, tabId }) => {
    if (frameId !== 0) return;
    rebadge(tabId);
    // A new page: it loaded with what the tab sends now, so the tab is no longer stale.
    markLoaded(tabId).catch(logError);
  });

  /**
   * A tab opened by a page (target=_blank link, ⌘/Ctrl-click, `window.open`) gets a copy of its
   * source tab's state, if `inheritOnOpen`. Best effort: the first request can beat the copy.
   *
   * Only `webNavigation.onCreatedNavigationTarget` names the real source. `tabs.onCreated`'s
   * `openerTabId` is the active tab, even for tabs the page did not open (measured: a CDP-created
   * blank tab, and a `window.open` from a background tab, both got the wrong opener).
   */
  browser.webNavigation.onCreatedNavigationTarget.addListener(({ sourceTabId, tabId }) => {
    current()
      .then(({ settings, tabs }) => {
        // Most sources have no state: skip the rules rewrite.
        if (!settings.inheritOnOpen || !tabs[sourceTabId]) return;
        // Re-check inside the writer: the new tab may have been set (or the source cleared) meanwhile.
        return update((draft) => {
          const source = draft.tabs[sourceTabId];
          if (draft.settings.inheritOnOpen && source && !draft.tabs[tabId]) {
            draft.tabs[tabId] = structuredClone(source);
          }
        });
      })
      .catch(logError);
  });

  // Always queued, even for tabs with no state: a `set` on this tab may still be in the queue.
  browser.tabs.onRemoved.addListener((tabId) => {
    update((draft) => {
      delete draft.tabs[tabId];
      delete draft.loaded[tabId];
    }).catch(logError);
  });

  browser.tabs.onReplaced.addListener((addedId, removedId) => {
    update((draft) => {
      for (const map of [draft.tabs, draft.loaded] as Record<number, unknown>[]) {
        if (!(removedId in map)) continue;
        map[addedId] = map[removedId];
        delete map[removedId];
      }
    }).catch(logError);
  });
}

/** Service worker start: drop states of tabs that are gone, reinstall rules, refresh badges. */
export async function reconcile(): Promise<void> {
  const open = new Set((await browser.tabs.query({})).map((t) => t.id));
  await update((draft) => {
    for (const map of [draft.tabs, draft.loaded]) {
      for (const id of Object.keys(map).map(Number)) {
        if (!open.has(id)) delete map[id];
      }
    }
  });
}
