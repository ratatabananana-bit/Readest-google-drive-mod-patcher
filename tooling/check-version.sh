#!/usr/bin/env bash
#
# check-version.sh — non-destructive "will the mod still apply?" check.
#
# Simulates replaying the mod onto a target upstream tag WITHOUT touching the
# working tree, branch, or index (uses `git merge-tree`). Prints whether it's a
# clean apply and, if not, which files a human would need to merge. Use before
# committing to an update.
#
# Usage: tooling/check-version.sh <upstream-tag-or-commit>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)/readest-src"
MOD_BRANCH="cloud-sync-mod"

TARGET="${1:-}"
[ -n "$TARGET" ] || { echo "usage: check-version.sh <tag-or-commit>"; exit 2; }
cd "$REPO_DIR"

if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  echo "Repo is shallow — run once: git -C readest-src fetch --unshallow --tags upstream"
  exit 3
fi

git fetch upstream --tags >/dev/null 2>&1 || true
git rev-parse --verify --quiet "${TARGET}^{commit}" >/dev/null \
  || { echo "Target '$TARGET' not found."; exit 4; }

BASE="$(git merge-base "$MOD_BRANCH" "$TARGET")"
AHEAD="$(git rev-list --count "$BASE..$TARGET")"
echo "Target:            $TARGET"
echo "Common base:       $(git rev-parse --short "$BASE")"
echo "Upstream commits ahead of our base: $AHEAD"
echo

OUT="$(git merge-tree --write-tree --name-only "$TARGET" "$MOD_BRANCH" 2>&1)" && STATUS=0 || STATUS=$?
if [ "$STATUS" = "0" ]; then
  echo "RESULT: CLEAN — the mod applies onto $TARGET with no conflicts."
  exit 0
fi

# merge-tree prints the tree oid on line 1, then conflicted paths.
CONFLICTS="$(printf '%s\n' "$OUT" | tail -n +2 | grep -v '^$' | grep -vE '^(Auto-merging|CONFLICT)' | sort -u)"
CODE_CONFLICTS="$(printf '%s\n' "$CONFLICTS" | grep -vE 'public/locales/' || true)"
echo "RESULT: NEEDS MERGE — upstream changed lines the mod also touches."
echo
echo "Locale files (trivial, auto-resolved by re-running i18n):"
printf '%s\n' "$CONFLICTS" | grep -E 'public/locales/' | sed 's/^/  /' || echo "  (none)"
echo
echo "Code files (a developer must merge these):"
if [ -n "$CODE_CONFLICTS" ]; then printf '%s\n' "$CODE_CONFLICTS" | sed 's/^/  /'; else echo "  (none)"; fi
exit 1
