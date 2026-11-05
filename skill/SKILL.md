---
name: lanehead
description: Send custom request headers (e.g. x-env to route to a lane, staging or branch backend) from one Chrome tab with the `lanehead` CLI. Use when testing a backend environment in the browser or asked to set headers for a tab.
---

# Lanehead: per-tab request headers

`lanehead` gives one Chrome tab its own headers; other tabs are untouched. Tab ids are real Chrome
tab ids. Every command prints one JSON line.

```
lanehead status                          # connected browsers
lanehead tabs [--url <text>]             # tabs: id, url, lane, headers
lanehead set <tab> -H 'x-env: lane_a' [-H 'name: value']... [--reload]
lanehead set <tab> -p <preset>           # a saved preset (`lanehead presets`)
lanehead open <url> -H 'name: value'     # new tab; its first request already has the headers
lanehead clear <tab> [<name>...]         # drop all (or the named) headers of the tab
lanehead global <preset|off>             # preset for every tab without its own
```

`set` merges by name (`--replace` replaces). Headers apply from the next request: navigate or
pass `--reload`. They last until the tab closes; tabs it opens inherit them.

With Claude in Chrome:
1. `tabs_context_mcp` → the tabId (fresh tab: `tabs_create_mcp` → its tabId).
2. `lanehead set <tabId> -H 'x-env: lane_a'`, and wait for it to return.
3. `navigate` that tab. Never navigate before `set` returns.

Shell-only: `lanehead open <url> -H '...'`.

Errors print `{"error":{"code","message"}}`; the message says what to do.
- Exit 3 (NOT_CONNECTED): ask the user to run `lanehead install` and enable the Lanehead
  extension with agent control on. Do not retry in a loop.
- Exit 2: fix the command (AMBIGUOUS_INSTANCE: add `-i <instance>`).
- NO_TAB: the tab closed; list tabs again.
