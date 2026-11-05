# Contributing

Issues and pull requests are welcome. For anything larger than a fix, open an issue first so we
can agree on the shape. Lanehead stays small on purpose (see "Not doing" in
[docs/PLAN.md](docs/PLAN.md)).

## Setup

Node.js 22+ and pnpm (`corepack enable`), then `pnpm i`.

## Before you open a PR

```sh
pnpm check      # typecheck, Biome lint/format, unit tests
pnpm test:e2e   # extension + CLI in headless Chromium
```

- Run `pnpm format` to fix formatting, including `pnpm-lock.yaml` after a dependency change.
- Tests and scripts run headless. Don't add anything that opens a visible browser window.
- Keep the extension offline: no network requests, no telemetry.
- Dependencies are pinned to exact versions; don't bump them in unrelated changes.
- If you change an operation, message or CLI output, update [docs/CONTRACTS.md](docs/CONTRACTS.md),
  and [skill/SKILL.md](skill/SKILL.md) when agents need to know.
- Use generic names in code, tests and docs: `x-env`, `lane_a`, `example.com`.

By contributing you agree that your work is released under the [MIT License](LICENSE).
