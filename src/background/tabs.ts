/** Tab lifecycle: state follows tabs as they close, get replaced or open other tabs. */
import { browser } from 'wxt/browser';
import { badgeTab } from './badge';
import { current, update } from './store';

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
  browser.webNavigation.onCommitted.addListener((nav) => nav.frameId === 0 && rebadge(nav.tabId));

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
        return update((draft) => {
          const source = draft.tabs[sourceTabId];
          if (source) draft.tabs[tabId] = structuredClone(source);
        });
      })
      .catch(logError);
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    current()
      .then((state) => {
        if (state.tabs[tabId]) return update((draft) => void delete draft.tabs[tabId]);
      })
      .catch(logError);
  });

  browser.tabs.onReplaced.addListener((addedId, removedId) => {
    update((draft) => {
      const moved = draft.tabs[removedId];
      if (!moved) return;
      delete draft.tabs[removedId];
      draft.tabs[addedId] = moved;
    }).catch(logError);
  });
}

/** Service worker start: drop states of tabs that are gone, reinstall rules, refresh badges. */
export async function reconcile(): Promise<void> {
  const open = new Set((await browser.tabs.query({})).map((t) => t.id));
  await update((draft) => {
    for (const id of Object.keys(draft.tabs).map(Number)) {
      if (!open.has(id)) delete draft.tabs[id];
    }
  });
}
