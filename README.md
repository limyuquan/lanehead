# Lanehead

Test two backends side by side in Chrome. Point one tab at your feature branch and the next at
staging, at the same time, and let your coding agent switch them for you.

<img src="media/hero.gif" width="900" alt="Two tabs of the same site side by side: the left tab is on lane feature_checkout and the right on feature_search; each page shows the x-env header it received, and Lanehead's popup shows each tab's lane">

Website: [limyuquan.github.io/lanehead](https://limyuquan.github.io/lanehead/)

## For humans

**What it does**

- **Headers per tab, not per browser.** Header extensions usually apply your headers to every tab.
  Lanehead scopes them to one tab, so two tabs of the same site can reach two backend lanes at
  once, and tabs you didn't touch send nothing.
- **Lanes you pick with one key.** A lane is a named, colored set of headers, optionally sent only
  to some domains. Open the popup, press `1`–`9`, reload. The toolbar badge shows each tab's lane.
- **Tabs you open follow.** Links, `⌘`-clicks and `window.open` from a tab on a lane open on the
  same lane (you can turn this off).
- **Edit a lane once.** Add or change a header in the popup and every tab on that lane gets it.
- **Your agent can drive it.** Claude Code, Codex or any agent with a shell uses the `lanehead`
  command to read tabs, set headers and open new tabs that send them from the first request.
- **Stays on your machine.** No account, no telemetry, no network requests. Headers are applied by
  Chrome's own `declarativeNetRequest` rules; nothing reads your traffic.

<table>
  <tr>
    <td width="50%"><img src="media/switch.gif" alt="In the popup, picking another lane; a Reload tab band appears, and after reloading the page shows the new header"></td>
    <td width="50%"><img src="media/edit.gif" alt="In the popup, + Add header, typing a name and value, Enter: the header joins the lane"></td>
  </tr>
  <tr>
    <td>Switch a tab's lane, then reload to apply it.</td>
    <td>Add a header to the lane; every tab on it sends it.</td>
  </tr>
</table>

<a id="install"></a>**Install** (not on the Chrome Web Store)

1. Download `lanehead-chrome.zip` from the
   [latest release](https://github.com/limyuquan/lanehead/releases/latest) and unzip it. Keep the
   folder somewhere permanent: Chrome loads the extension from it.
2. Open `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked** and
   choose the unzipped folder.
3. Pin Lanehead to the toolbar.

To update, download the new zip, replace the folder's contents, then click ↻ on Lanehead's card in
`chrome://extensions`. Works in Chrome 120+ and other Chromium browsers (Edge, Brave).

**Using a coding agent?** Ask it to *"set up Lanehead from github.com/limyuquan/lanehead"*. The
[For LLMs](#for-llms) section tells it how: it installs the `lanehead` command and unzips the
extension to `~/.lanehead/extension`, and you only click **Load unpacked**.

<details>
<summary>Or build it from source</summary>

Install [Node.js](https://nodejs.org) 22 or newer, then:

```sh
git clone https://github.com/limyuquan/lanehead.git && cd lanehead
corepack enable && pnpm install && pnpm build
```

Load `lanehead/.output/chrome-mv3` the same way. On a Mac, press `⌘⇧.` in the file picker to show
the hidden `.output` folder. To update: `git pull && pnpm build`, then ↻.

</details>

**Use**

| | |
|---|---|
| Open the popup | Click the toolbar icon, or press `Alt+Shift+H` (change it at `chrome://extensions/shortcuts`) |
| Put this tab on a lane | `1`–`9`, or click the lane |
| No headers for this tab | `0` (Off) |
| Apply to the loaded page | `R` reloads the tab (the popup offers it when the page loaded with other headers) |
| Edit the lane | **+ Add header** in the popup; the change is saved to the lane |
| New lanes, all tabs at once, settings | **Manage** in the popup |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/manage-dark.png">
  <img src="media/manage-light.png" alt="Lanehead's manage page: lanes with their headers, the tabs on each lane, and settings">
</picture>

**Let your agent drive it**

<img src="media/agent.gif" width="900" alt="A terminal runs lanehead tabs, then lanehead set with -H 'x-env: feature_search'; the command prints JSON and the browser tab next to it changes lane">

```sh
lanehead tabs --url example.com                  # find the tab
lanehead set 123456 -H 'x-env: lane_a' --reload  # that tab sends it from now on
lanehead open https://example.com -p staging     # a new tab on a saved lane
```

Every command prints one line of JSON. Setup and the rest are in [For LLMs](#for-llms).

**Limits**

- **Service workers** send requests without a tab, so per-tab headers don't reach them. Use the
  **All tabs** lane for those, or DevTools → Application → Service workers → *Bypass for network*.
- **The HTTP cache is shared.** Backends should send `Vary: x-env` (or whichever header picks the
  lane), or not cache those responses.
- **Changes apply from the next request.** Reload a page that already loaded.
- **Tab lanes end with the browser session.** Tab ids change after a restart, so lanes aren't
  restored on tabs. Lanes themselves are kept.
- **Request headers only**, set only. Cookies and storage stay shared between tabs, as always.
- **No Windows CLI yet.** The extension works on Windows; agent control needs macOS or Linux.

---

## For LLMs

This section is for coding agents (Claude Code, Codex, Cursor and others). Lanehead has two
halves: a Chrome extension the person loads once, and a `lanehead` CLI you use. The sections below
cover setting it up and using it for someone. To work on the repo itself, see
[CONTRIBUTING.md](CONTRIBUTING.md).

### 1. Is it set up?

```sh
command -v lanehead || ls ~/.lanehead/host/lanehead.js   # is the CLI installed?
lanehead status                                         # which browsers are connected?
```

| What you see | Meaning | Do |
|---|---|---|
| Neither the command nor the file | Not installed | Section 2 |
| No `lanehead` on PATH, but the file exists | Installed, no launcher | Use `node ~/.lanehead/host/lanehead.js` wherever this says `lanehead` |
| `{"installed":true,"instances":[{…}]}` | Ready | Section 4 |
| `{"installed":false,"instances":[],"hint":…}` | Bridge not registered | Section 2 |
| `{"installed":true,"instances":[],"hint":…}` | Bridge installed, no browser connected | Section 3 |

`status` exits 0 whenever it runs. `installed` says whether the bridge is registered. Each
instance has `instance`, `label`, `browser`, `version` (the extension's), `ui` (the control page)
and `active` (the focused tab). Compare `version` with
`~/.lanehead/extension/manifest.json`: if the folder is newer, the person still has to click ↻.

### 2. Install it

Needs macOS or Linux and Node.js 22+ (`node -v`). No npm package; everything comes from the
GitHub release.

```sh
curl -fsSL https://github.com/limyuquan/lanehead/releases/latest/download/install.sh | sh
```

To read it first: `curl -fsSLO …/install.sh`, read it, `sh install.sh`. Release assets are listed
in `SHA256SUMS`. The script is idempotent and:

1. downloads `lanehead.js` and `lanehead-chrome.zip` from the release (`LANEHEAD_VERSION=v0.1.0`
   pins one);
2. checks the zip keeps the fixed extension ID `nofaceocfeacnlfmhhfhgjifeeeidkmh`, then swaps it
   in whole as `~/.lanehead/extension` (it refuses to replace a folder that isn't Lanehead's);
3. runs `lanehead install`: copies the CLI to `~/.lanehead/host/`, registers the native messaging
   host with Chrome, and puts a `lanehead` launcher in `~/.local/bin` when that is on `PATH`.
   It doesn't wait for a browser (`lanehead install` alone waits up to 35 s; `--no-wait` skips that);
4. runs `lanehead skill --install` (skip with `LANEHEAD_NO_SKILL=1`);
5. prints what it wrote and the step left for the person.

Another browser: `… | sh -s -- --browser edge` (`chromium`, `edge`, `brave`, `cft`), or
`--user-data-dir <dir>` for a custom profile directory. From a clone instead: `pnpm build &&
pnpm build:cli && node dist/lanehead.js install`, and the folder to load is `.output/chrome-mv3`.

### 3. The one step only the person can do

You cannot load an unpacked extension into their browser, and must not drive their
`chrome://extensions`. Send this, with the real absolute path (`echo ~/.lanehead/extension`):

> Lanehead is installed. One step needs you, in Chrome:
> 1. Open `chrome://extensions` and turn on **Developer mode** (top right).
> 2. Click **Load unpacked** and choose `/Users/you/.lanehead/extension`
>    (on a Mac, press ⌘⇧G in the file picker and paste the path).
> 3. Pin Lanehead to the toolbar.
>
> If another extension sets the same request header, turn it off so the two don't fight.
> Tell me when it's done.

Then run `lanehead status` every few seconds for up to a minute; the extension connects as soon
as it loads, and retries every 30 s. Still `"instances":[]`? Ask once, then wait for an answer:

- Does Lanehead's card in `chrome://extensions` show an error? Is the browser running?
- The popup's **Agents** link opens the bridge state. **Off**: click **Turn on** there (agent
  control is on by default). **Bridge not installed**: the bridge was registered for another
  browser or profile; rerun section 2 with `--browser` or `--user-data-dir`.

Don't retry in a loop or reinstall repeatedly.

### 4. Use it

**The skill.** `skill/SKILL.md` is the command reference for agents. The installer
copied it to `~/.claude/skills/lanehead/` and/or `~/.codex/skills/lanehead/` when those folders
exist; `lanehead skill --install` does it again. For other agents, `lanehead skill` prints it:
save it where your agent reads instructions.

```sh
lanehead tabs [--url <text>]                       # {"tabs":[{"id":123456,"url":…,"title":…}]}
lanehead get <tab>                                 # what the tab sends now
lanehead set <tab> -H 'x-env: lane_a' [--reload]   # merges by header name
lanehead set <tab> -p staging                      # a saved lane (`lanehead presets`)
lanehead open <url> -H 'x-env: lane_a'             # new tab; its first request has it
lanehead clear <tab> [--reload]
```

- **A new page: `open`.** It creates a blank tab, waits for its rules, then navigates, so the
  first request already has the headers.
- **A tab that exists: `set`, then navigate or reload.** `set` returns once Chrome has the rules.
  `"stale":true` means the loaded page used other headers: pass `--reload`, run
  `lanehead reload <tab>`, or navigate.
- **With Claude in Chrome**, tab ids are real Chrome tab ids: `tabs_context_mcp` (or
  `tabs_create_mcp`) → `lanehead set <tabId> -H …` and wait for it → `navigate`. Never navigate
  before `set` returns.
- **Errors** print `{"error":{"code","message"}}`. Exit 2 (`BAD_HEADER`, `BAD_URL`, `BAD_REQUEST`,
  `AMBIGUOUS_INSTANCE`): fix the command as the message says. Exit 1 (`NO_TAB`, `NO_PRESET`,
  `NOT_OWN`, `INTERNAL`): do what it says; for `NO_TAB` run `lanehead tabs` again. Exit 3
  (`NOT_CONNECTED`): tell the person the message (section 3); don't loop.
- **Several browsers** or profiles: `tabs` marks each tab with `"i"`. Ops on a tab find its
  browser; anything else needs `-i <instance>` (or `LANEHEAD_INSTANCE`).
- **No shell?** An agent with only browser tools uses the control page the bridge serves, the `ui`
  URL from `status` (usually `http://127.0.0.1:47823/`, `?tab=<id>` for one tab): plain HTML forms
  that run the same operations.

**Security.** The CLI talks to the extension through a socket in `~/.lanehead/run/` that only
your OS user can open (folder 0700, socket 0600). Web pages can't reach Lanehead: it has no
content scripts and no `externally_connectable`. The control page listens on `127.0.0.1` only,
checks `Host` and `Origin`, sends no CORS headers and can't be framed; on a machine shared with
other OS users, turn agent control off when you don't need it. The bridge forwards only
Lanehead's own operations, and nothing leaves the machine.

### 5. Update or remove

- **Update:** run the installer again. It replaces `~/.lanehead/extension` and the CLI; then ask
  the person to click ↻ on Lanehead's card in `chrome://extensions` (that also restarts the
  bridge on the new CLI). Check with `lanehead status` that `version` is the new one.
- **Remove:** `lanehead uninstall` removes what `install` wrote (only files that are still its
  own). The person removes the extension in `chrome://extensions`; then `rm -rf
  ~/.lanehead/extension`.

## Credits

Inspired by [openhoangnc/chrome-header-mod](https://github.com/openhoangnc/chrome-header-mod).

## License

[MIT](LICENSE)
