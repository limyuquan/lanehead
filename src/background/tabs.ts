/** Tab lifecycle: state follows tabs as they close, get replaced or open other tabs. */
import { browser } from 'wxt/browser';
import { badgeTab } from './badge';
import { current, update } from './store';

/**
 * Give a new tab a copy of its opener's state, if `inheritOnOpen` and the opener has one.
 * Called from both `tabs.onCreated` and `webNavigation.onCreatedNavigationTarget`; whichever
 * comes second finds the state already there and does nothing.
 */
async function inherit(tabId: number, openerId: number): Promise<void> {
  const { settings, tabs } = await current();
  // Most openers have no state: skip the rules rewrite.
  if (!settings.inheritOnOpen || !tabs[openerId]) return;
  await update((draft) => {
    const opener = draft.tabs[openerId];
    if (opener && !draft.tabs[tabId]) draft.tabs[tabId] = structuredClone(opener);
  });
}

function logError(err: unknown) {
  console.error('[lanehead]', err);
}

export function installTabListeners(): void {
  browser.tabs.onCreated.addListener((tab) => {
    const { id: tabId, openerTabId } = tab;
    if (tabId === undefined) return;
    // A tab from the New Tab button (Ctrl/Cmd+T) can carry the active tab as its opener;
    // only link-opened tabs inherit.
    const url = tab.pendingUrl || tab.url || '';
    const fromLink = openerTabId !== undefined && !url.startsWith('chrome://');
    (fromLink ? inherit(tabId, openerTabId) : Promise.resolve())
      .then(async () => badgeTab(tabId, await current()))
      .catch(logError);
  });

  browser.webNavigation.onCreatedNavigationTarget.addListener(({ sourceTabId, tabId }) => {
    inherit(tabId, sourceTabId).catch(logError);
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
