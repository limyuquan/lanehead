# Lanehead

Per-tab request headers for Chrome. Give each tab its own lane, and let your coding agent switch
them.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/popup-dark.png">
  <img src="docs/images/popup-light.png" width="380" alt="Lanehead's popup on shop.example.com: the tab uses the feature_checkout preset (x-env: feature_checkout, x-canary: 1) plus its own x-debug: 1, with Reload tab offered because the page loaded with other headers">
</picture>

## Why

Header extensions such as [chrome-header-mod](https://github.com/openhoangnc/chrome-header-mod)
apply your headers to every tab at once. If your backend routes on a header (`x-env: lane_a`
reaches the `lane_a` deployment), you can only look at one lane at a time, and switching it
changes every open tab.

Lanehead scopes headers to a tab. One tab sends `x-env: lane_a`, the tab next to it sends
`x-env: lane_b`, and the rest send nothing. A `lanehead` CLI lets Claude Code, Codex or any agent
with a shell do the same.

## Features

- **Per-tab headers.** A new tab starts with none. Assign a preset, add the tab's own headers, or
  both (its own headers win on the same name).
- **Presets.** A named, colored set of headers, optionally sent only to some domains
  (`example.com` includes its subdomains). Editing a preset updates every tab that uses it.
- **Inheritance.** Links, `⌘`-clicks and `window.open` from a tab with headers open in the same
  lane (can be turned off).
- **All tabs mode.** Turn one preset on for every tab that has no lane of its own, the way global
  header extensions work. A tab you set yourself, or set to Off, is left out of it.
- **Visible state.** The toolbar badge shows each tab's lane in its preset's color. When a page
  loaded with other headers than it sends now, the popup offers **Reload tab**.
- **Keyboard first.** `Alt+Shift+H` opens the popup, `1`–`9` pick a lane, `0` is Off, `R` reloads.
- **Agent control.** `lanehead set <tab> -H 'x-env: lane_a'`, `lanehead open <url> -p staging`,
  and so on. Each command prints one line of JSON.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/manage-tabs-dark.png">
  <img src="docs/images/manage-tabs-light.png" alt="The manage page's Tabs view: five tabs on example.com sites, each with its lane (feature_checkout, feature_search, staging, Off, Custom headers) and the headers it sends">
</picture>

## Install

Lanehead isn't on the Chrome Web Store yet.

1. Download `lanehead-<version>-chrome.zip` from the
   [latest release](https://github.com/limyuquan/lanehead/releases/latest) and unzip it somewhere
   permanent. Chrome loads the extension from that folder.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the
   folder.
3. Pin Lanehead to the toolbar.

Or build it from source with Node.js 22+:

```sh
git clone https://github.com/limyuquan/lanehead.git && cd lanehead
corepack enable && pnpm i && pnpm build
```

Then load `.output/chrome-mv3` the same way. On a Mac, `⌘⇧.` shows hidden folders in the picker.

The unpacked build always has the extension ID `nofaceocfeacnlfmhhfhgjifeeeidkmh` (the manifest
carries a fixed `key`), so the agent bridge knows which extension it may talk to. Lanehead works in
Chrome 120+ and other Chromium browsers (Edge, Brave).

## Agent setup

Once, on the machine where the browser runs (macOS or Linux):

```sh
npx lanehead install          # registers the bridge with Chrome; or --browser chromium|edge|brave|cft
lanehead skill --install      # teaches Claude Code and Codex the commands (skill/SKILL.md)
lanehead status               # shows the connected browsers
```

`npx lanehead` works once the package is on npm. Until then, from a clone:

```sh
pnpm build:cli && node dist/lanehead.js install
```

`install` copies the bridge to `~/.lanehead/` and puts `lanehead` in `~/.local/bin` when that's on
your `PATH`. Agent control can be turned off on Lanehead's settings page; `lanehead uninstall`
removes everything `install` wrote. Store builds have a different ID: pass
`--extension-id <id>`.

## Agent usage

An agent with only a shell can open a tab that already has the headers on its first request:

```sh
lanehead open https://app.example.com -H 'x-env: lane_a'
lanehead open https://app.example.com -p lane_b     # a saved preset
```

Or change a tab you already have open:

```sh
lanehead tabs --url app.example.com                 # {"tabs":[{"id":123456,"url":…,"title":…}]}
lanehead set 123456 -H 'x-env: lane_a' --reload
lanehead get 123456                                 # what the tab sends now
```

With **Claude in Chrome**, tab ids are real Chrome tab ids, so the two work together:

1. `tabs_context_mcp` (or `tabs_create_mcp`) gives the tab id.
2. `lanehead set <tabId> -H 'x-env: lane_a'`, and wait for it to return. It returns once Chrome
   has the rule.
3. `navigate` that tab. Every request from it now carries the header.

An agent that has browser tools but no shell can use the control page the bridge serves at
`http://127.0.0.1:47823`: a plain form page listing tabs and presets, which runs the same
operations as the CLI. See [docs/AGENTS.md](docs/AGENTS.md) for the full command reference and the
security model.

## How it works

Each tab's headers become
[`declarativeNetRequest`](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
session rules with a `tabIds` condition, so Chrome adds them to that tab's requests itself. Nothing
intercepts or reads your traffic. The all-tabs preset is one rule with `excludedTabIds` for every
tab that has its own state.

```
popup / manage page ─┐
                     ├─▶ service worker ─▶ DNR session rules (tabIds: [123456])
lanehead CLI ─▶ native host ─┘
```

The CLI reaches the extension through a native messaging host over a Unix socket that only your
OS user can open. Web pages cannot talk to Lanehead.

## Limitations

- **Service workers and shared workers.** A page's service worker sends its requests without a
  tab, so per-tab headers don't reach them. Use **All tabs** mode for those, or bypass the service
  worker (DevTools → Application → Service workers → *Bypass for network*).
- **The HTTP cache is shared.** Chrome doesn't keep a separate cache per lane. Backends should
  send `Vary: x-env` (or whichever header picks the lane), or avoid caching those responses.
- **Changes apply from the next request.** A page that already loaded keeps what it has; reload
  it (the popup and `--reload` offer this).
- **State ends with the browser session.** Tab ids change after a restart, so tab lanes are not
  restored. Presets are kept.
- **Request headers only**, set only: no response headers, no removing headers.
- **Cookies and storage are shared** between tabs, as always in one profile.
- **No Windows CLI yet.** The extension works on Windows; `lanehead install` refuses there.

## Privacy

Lanehead makes no network requests and has no telemetry, accounts or sync. Presets are stored in
the extension's local storage; tab state lives in session storage and goes away when the browser
closes. The agent bridge only listens on a local socket (and `127.0.0.1` for the control page).
Store permission justifications: [docs/STORE.md](docs/STORE.md).

## Development

```sh
pnpm i
pnpm dev            # WXT dev build
pnpm check          # typecheck, lint, unit tests
pnpm test:e2e       # builds, then runs Playwright against headless Chromium
```

Every browser the tests start is headless. `LANEHEAD_SHOTS=1 pnpm exec playwright test shots`
refreshes the screenshots in `docs/images/`, and `pnpm icons` renders `public/icon/` from
`assets/icon.svg`. Design and interfaces: [docs/PLAN.md](docs/PLAN.md),
[docs/CONTRACTS.md](docs/CONTRACTS.md). See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

Inspired by [openhoangnc/chrome-header-mod](https://github.com/openhoangnc/chrome-header-mod).

## License

[MIT](LICENSE)
