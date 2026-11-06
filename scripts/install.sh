#!/bin/sh
# Lanehead installer for macOS and Linux: the `lanehead` CLI, its browser bridge, the agent skill,
# and the extension unpacked into a permanent folder, ready for Load unpacked.
#
#   curl -fsSL https://github.com/limyuquan/lanehead/releases/latest/download/install.sh | sh
#
# Flags after `sh -s --` go to `lanehead install`, e.g. `... | sh -s -- --browser brave`.
# Safe to run again: that is how you update.
#
# Environment:
#   LANEHEAD_VERSION      a release tag such as v0.1.0 (default: the latest release)
#   LANEHEAD_RELEASE_URL  where lanehead.js and lanehead-chrome.zip are (overrides the version;
#                         file:// works, for testing a local build)
#   LANEHEAD_HOME         where Lanehead keeps its files (default: ~/.lanehead)
#   LANEHEAD_NO_SKILL=1   don't install the agent skill into ~/.claude or ~/.codex
#
# Everything is wrapped in main() so a partly downloaded script does nothing.

set -eu

REPO=https://github.com/limyuquan/lanehead

say() { printf '%s\n' "$*"; }
fail() {
  printf 'lanehead install: %s\n' "$*" >&2
  exit 1
}

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 2 "$1" -o "$2" || fail "could not download $1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$1" -O "$2" || fail "could not download $1"
  else
    fail "needs curl or wget."
  fi
}

unpack() {
  if command -v unzip >/dev/null 2>&1; then
    unzip -q "$1" -d "$2"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -I -m zipfile -e "$1" "$2"
  else
    fail "needs unzip (or python3) to unpack the extension."
  fi
}

main() {
  case "$(uname -s)" in
    Darwin | Linux) ;;
    MINGW* | MSYS* | CYGWIN* | Windows*)
      fail "agent control needs macOS or Linux. On Windows the extension still works: download
lanehead-chrome.zip from $REPO/releases/latest, unzip it and use Load unpacked."
      ;;
    *) fail "unsupported system $(uname -s); Lanehead's CLI runs on macOS and Linux." ;;
  esac

  command -v node >/dev/null 2>&1 ||
    fail "needs Node.js 22 or newer, and \`node\` was not found. Install it (https://nodejs.org,
\`brew install node\`, or your package manager), then run this again."
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 22 ] 2>/dev/null ||
    fail "needs Node.js 22 or newer; this is $(node -v). Upgrade it, then run this again."

  if [ -n "${LANEHEAD_RELEASE_URL:-}" ]; then
    base="${LANEHEAD_RELEASE_URL%/}"
  elif [ -n "${LANEHEAD_VERSION:-}" ]; then
    base="$REPO/releases/download/v${LANEHEAD_VERSION#v}"
  else
    base="$REPO/releases/latest/download"
  fi

  lh_home="${LANEHEAD_HOME:-$HOME/.lanehead}"
  ext="$lh_home/extension"
  mkdir -p "$lh_home"
  tmp="$(mktemp -d "$lh_home/.install.XXXXXX")"
  trap 'rm -rf "$tmp"' EXIT
  trap 'exit 1' HUP INT TERM

  say "Downloading Lanehead from $base"
  fetch "$base/lanehead.js" "$tmp/lanehead.js"
  fetch "$base/lanehead-chrome.zip" "$tmp/lanehead-chrome.zip"

  # The extension: check it, then swap it in whole, so the folder is never half old, half new.
  unpack "$tmp/lanehead-chrome.zip" "$tmp/extension" || fail "the extension zip is damaged."
  id="$(node -e '
    const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    if (m.name !== "Lanehead" || !m.key) process.exit(1);
    const h = require("crypto").createHash("sha256").update(Buffer.from(m.key, "base64"));
    console.log([...h.digest("hex").slice(0, 32)].map((c) => "abcdefghijklmnop"[parseInt(c, 16)]).join(""), m.version);
  ' "$tmp/extension/manifest.json")" ||
    fail "the downloaded zip is not the Lanehead build that keeps its fixed extension ID."
  version="${id#* }"
  id="${id%% *}"
  if [ -e "$ext" ]; then
    # Replace only a folder this script made (or an empty one), never something else.
    if ! grep -q '"name": *"Lanehead"' "$ext/manifest.json" 2>/dev/null &&
      [ -n "$(ls -A "$ext" 2>/dev/null)" ]; then
      fail "$ext exists and is not a Lanehead extension folder; move it away and run this again."
    fi
    mv "$ext" "$tmp/extension.old"
  fi
  mv "$tmp/extension" "$ext"

  # The CLI and the native host. `lanehead install` copies the CLI to $lh_home/host/ and puts a
  # `lanehead` launcher in ~/.local/bin when that folder is on PATH; make sure it exists.
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) mkdir -p "$HOME/.local/bin" ;;
  esac
  # --no-wait: the extension is usually not loaded yet; the step for that is printed below.
  say "Registering the browser bridge"
  result="$(LANEHEAD_HOME="$lh_home" node "$tmp/lanehead.js" install --no-wait "$@")" ||
    fail "\`lanehead install\` failed: $result"
  cli="$lh_home/host/lanehead.js"

  skill=""
  if [ "${LANEHEAD_NO_SKILL:-}" != 1 ]; then
    skill="$(node "$cli" skill --install 2>/dev/null || true)"
  fi

  # Summarise install's JSON output for a person. (The ${...} below is JavaScript, not shell.)
  # shellcheck disable=SC2016
  RESULT="$result" SKILL="$skill" EXT="$ext" VERSION="$version" ID="$id" CLI="$cli" node -e '
    const e = process.env;
    const r = JSON.parse(e.RESULT);
    let s = {};
    try { s = JSON.parse(e.SKILL); } catch {}
    const lines = [
      "",
      `Installed Lanehead ${e.VERSION}`,
      `  extension   ${e.EXT}  (ID ${e.ID})`,
      `  bridge      ${r.manifest}`,
      r.shim
        ? `  command     ${r.shim}`
        : `  command     node ${e.CLI}  (no \`lanehead\` on PATH: put ~/.local/bin on your PATH and run this again)`,
    ];
    if (s.installed) for (const f of s.installed) lines.push(`  skill       ${f}`);
    lines.push("");
    if (r.instances.length) {
      lines.push(
        "A browser with Lanehead is already connected. If you updated, open chrome://extensions",
        "and click the reload arrow on the Lanehead card to run the new version.",
      );
    } else {
      lines.push(
        "One step is left, in the browser (Chrome, Edge, Brave or Chromium):",
        "  1. Open chrome://extensions and turn on Developer mode (top right).",
        `  2. Click Load unpacked and choose ${e.EXT}`,
        "     (in the Mac file picker, press Cmd+Shift+G and paste that path).",
        "  3. Pin Lanehead to the toolbar.",
        "Already loaded from this folder? Click the reload arrow on its card instead.",
        "Then `lanehead status` lists the browser.",
      );
    }
    console.log(lines.join("\n"));
  '
}

main "$@"
