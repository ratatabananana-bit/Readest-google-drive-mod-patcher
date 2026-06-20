#!/usr/bin/env bash
#
# build-mod.sh — build the Drive-sync-modded Readest from the CURRENT source tree.
#
# This is the second half of the "patcher" pipeline: it does NOT touch git or
# pull new versions (that's update-to-version.sh). It takes whatever is checked
# out right now and produces a runnable app, encoding the exact, fiddly Windows
# build recipe that took a long time to work out (submodules + manual vendoring
# + cargo PATH + the tauri debug/no-bundle flags).
#
# Usage:
#   tooling/build-mod.sh            # debug build → target/debug/readest.exe (fast, default)
#   tooling/build-mod.sh --release  # NSIS installer (build-win-x64; needs .env.tauri.local)
#
# Exit non-zero on the first failing stage with a clear message.

set -euo pipefail

# --- locate the fork's app dir relative to this script (tooling lives OUTSIDE
#     the fork so it never collides with upstream files on rebase) -------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPO_DIR="$WORKSPACE_DIR/readest-src"
APP_DIR="$REPO_DIR/apps/readest-app"

MODE="${1:-debug}"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mBUILD FAILED: %s\033[0m\n' "$*" >&2; exit 1; }

[ -d "$APP_DIR" ] || fail "app dir not found at $APP_DIR (is the fork at $REPO_DIR?)"

# cargo is not on the PATH the tauri CLI inherits on this machine; prepend it.
export PATH="$HOME/.cargo/bin:$PATH"
command -v cargo >/dev/null 2>&1 || fail "cargo not found (install Rust, or fix ~/.cargo/bin)"
command -v pnpm  >/dev/null 2>&1 || fail "pnpm not found"

# The heavy Rust submodules are required for the native build; init is idempotent.
SUBMODULES=(
  packages/foliate-js
  packages/js-mdict
  packages/simplecc-wasm
  packages/tauri
  packages/tauri-plugins
  packages/qcms
  apps/readest-app/src-tauri/plugins/tauri-plugin-turso
  apps/readest-app/src-tauri/plugins/tauri-plugin-webview-upgrade
)

log "Init submodules (idempotent)"
cd "$REPO_DIR"
for sm in "${SUBMODULES[@]}"; do
  git submodule update --init "$sm" >/dev/null 2>&1 || fail "submodule init failed: $sm"
done

log "Install JS dependencies"
cd "$REPO_DIR"
pnpm install || fail "pnpm install failed"

# Stop a running instance first — on Windows the linker fails with
# "os error 5 (access denied)" if readest.exe still holds the output binary.
if command -v taskkill >/dev/null 2>&1; then
  taskkill //F //IM readest.exe >/dev/null 2>&1 || true
fi

# Vendoring: `pnpm setup-vendors` chains nested `pnpm` calls that hit a Windows
# PATH bug, so run the LEAF scripts directly (each calls mkdirp/cpx/postcss, no
# nested pnpm). Required or the build/tests fail with simplecc/jieba/pdfjs
# "module not found".
log "Vendor wasm/pdfjs artifacts"
cd "$APP_DIR"
for leaf in \
  prepare-public-vendor \
  copy-pdfjs-js copy-pdfjs-wasm copy-pdfjs-fonts \
  copy-flatten-pdfjs-annotation-layer-css copy-flatten-pdfjs-text-layer-css \
  copy-simplecc copy-jieba
do
  pnpm run "$leaf" || fail "vendoring step failed: $leaf"
done

if [ "$MODE" = "--release" ] || [ "$MODE" = "release" ]; then
  log "Release build (NSIS installer)"
  # build-win-x64 runs its own next build via beforeBuildCommand; needs
  # .env.tauri.local with signing/updater config.
  [ -f "$APP_DIR/.env.tauri.local" ] || fail "release build needs apps/readest-app/.env.tauri.local"
  pnpm run build-win-x64 || fail "release tauri build failed"
  log "Done. Installer under $REPO_DIR/target/**/bundle/nsis/"
  exit 0
fi

log "Build frontend (next → out/)"
pnpm build || fail "next build failed"

log "Build native app (tauri debug, no bundle)"
# beforeBuildCommand emptied: tauri's nested `pnpm build` hits the same Windows
# nested-pnpm PATH bug; we already ran `pnpm build` above.
pnpm exec dotenv -e .env.tauri -- tauri build --debug --no-bundle \
  --config '{"build":{"beforeBuildCommand":""}}' || fail "tauri build failed"

EXE="$REPO_DIR/target/debug/readest.exe"
[ -f "$EXE" ] || fail "expected exe not found at $EXE"
log "Done. Built: $EXE"
