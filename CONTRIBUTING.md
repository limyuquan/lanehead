# Contributing

Issues and pull requests are welcome. For anything larger than a fix, open an issue first so we
can agree on the shape. Lanehead stays small on purpose.

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
- If you change an operation, message or CLI output, update [skill/SKILL.md](skill/SKILL.md)
  when agents need to know.
- Use generic names in code, tests and docs: `x-env`, `lane_a`, `example.com`.
- After a UI change, run `pnpm media` and commit the refreshed `media/` (the README and the
  website use it).
- If you change `scripts/install.sh`, keep it POSIX `sh` and clean under `shellcheck -s sh`, and
  try it against a local build in a throwaway `HOME` (below). Never point it at your real
  `~/.lanehead`.

## Builds and releases

Every push to `main` uploads a build as a workflow artifact (`lanehead-<sha>`: the extension zip,
`lanehead.js`, `install.sh`), so you can try a change without a release. To try the installer
locally:

```sh
pnpm zip && pnpm build:cli
mkdir -p /tmp/lh-rel && cp dist/lanehead.js scripts/install.sh /tmp/lh-rel/
cp .output/lanehead-*-chrome.zip /tmp/lh-rel/lanehead-chrome.zip
HOME="$(mktemp -d)" LANEHEAD_RELEASE_URL=file:///tmp/lh-rel sh scripts/install.sh
```

Releases are cut by the maintainer: bump `version` in `package.json`, commit, tag `v<version>`
and push the tag. `.github/workflows/release.yml` checks, builds and attaches
`lanehead-chrome.zip`, `lanehead-<version>-chrome.zip`, `lanehead.js`, `install.sh` and
`SHA256SUMS`, so `releases/latest/download/<name>` always serves the newest. Release zips come
from `pnpm zip`, which keeps the manifest `key` (fixed extension ID, which the native host
requires); `node scripts/verify-zip.mjs <zip>` checks that. `pnpm zip:store` drops the key and is
only for a store upload.

By contributing you agree that your work is released under the [MIT License](LICENSE).
