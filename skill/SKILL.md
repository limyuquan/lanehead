---
name: lanehead
description: Send custom request headers from one Chrome tab (e.g. x-env to route to a lane, staging or branch backend) with the `lanehead` CLI. Use when testing a backend environment in the browser or asked to set headers for a tab.
---

# Lanehead: per-tab request headers

`lanehead` gives one Chrome tab its own request headers; other tabs are untouched. Tab ids are
real Chrome tab ids. Every command prints one JSON line.

```
lanehead tabs [--url <text>]                 # id, url, title (+ lane, headers when set)
lanehead get <tab>                           # what the tab sends now
lanehead set <tab> -H 'x-env: lane_a' [-H 'name: value']... [--reload]
lanehead set <tab> -p <preset>               # a saved preset (`lanehead presets`)
lanehead set <tab> --no-preset               # drop the preset, keep own headers
lanehead set <tab> --off                     # nothing, not even an all-tabs preset
lanehead open <url> [-H 'name: value'] [-p <preset>]   # new tab; first request has them
lanehead clear <tab> [<name>...] [--reload]  # drop all (or the named) own headers
lanehead reload <tab>
lanehead global [<preset>|off]               # preset for every tab without its own headers
```

- `headers` is exactly what the tab sends — to every site, or only to `domains` when present.
- `set` merges by name. `-p` replaces the tab's headers of the same names (the preset wins);
  `-H` in the same call still wins over the preset. `--replace`: only what this call gives.
- Changes apply from the next request. `"stale":true` = the page loaded with other headers:
  pass `--reload`, `lanehead reload <tab>`, or navigate.
- Headers last until the tab closes; tabs it opens inherit them.

With Claude in Chrome:
1. `tabs_context_mcp` → the tabId (fresh tab: `tabs_create_mcp`).
2. `lanehead set <tabId> -H 'x-env: lane_a'`, and wait for it to return.
3. `navigate` that tab. Never navigate before `set` returns.

Errors print `{"error":{"code","message"}}`.
- Exit 2: fix the command as the message shows.
- Exit 1 (NO_TAB, NO_PRESET, NOT_OWN): do what the message says. NO_TAB: run `lanehead tabs` again.
- Exit 3 (NOT_CONNECTED): tell the user the message; do not retry in a loop.
- Several browsers: `tabs` marks each tab with `"i"`; pass `-i <i>` when asked to.
