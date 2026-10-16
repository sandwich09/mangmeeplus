#!/usr/bin/env bash
# Usage: tsc.sh [api|web|both] — native TypeScript compiler, default both.
# Safety: shared heavy lock plus the original cross-session TypeScript mkdir lock; local DB guard.
# Typegen rc is not propagated separately, matching the source; compiler rc is reported and returned.
source "$(dirname "$0")/common.sh"
WHAT="${1:-both}"
case "$WHAT" in api|web|both) ;; *) echo 'Usage: tsc.sh [api|web|both]' >&2; exit 2;; esac
lp_heavy "$@"
mkdir -p "$(dirname "$TSC_LOCK_DIR")" || exit 2
until mkdir "$TSC_LOCK_DIR" 2>/dev/null; do sleep 10; done
trap 'rmdir "$TSC_LOCK_DIR" 2>/dev/null' EXIT
RC=0; TAG=$(basename "$LOCAL_PROOF_ROOT")
run() {
  local log="$LP_LOGS/tsc-$TAG-$2.log" r
  packages/typescript-native/node_modules/.bin/tsc -p "$1" --singleThreaded > "$log" 2>&1; r=$?
  echo "TSC_$2_EXIT=$r errors=$(grep -cE 'error TS[0-9]+' "$log") log=$log"
  if [ "$r" -ne 0 ]; then grep -E 'error TS[0-9]+' "$log" | head -40; RC=1; fi
}
if [ "$WHAT" = api ] || [ "$WHAT" = both ]; then run apps/api/tsconfig.typecheck.json api; fi
if [ "$WHAT" = web ] || [ "$WHAT" = both ]; then
  corepack pnpm --filter @watchdog-bms/web exec next typegen > "$LP_LOGS/tsc-$TAG-typegen.log" 2>&1
  run apps/web/tsconfig.typecheck.json web
fi
exit "$RC"
