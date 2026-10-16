#!/usr/bin/env bash
# Usage: trial-after-merge.sh <tag> — migrate trial/real-DB, regenerate, rebuild trial API.
# Safety: checked explicit local URLs (no database-name string replacement), shared heavy lock.
# Stops at the first failed preparation step; the gate must not restart a stale build.
set -u
source "$(dirname "$0")/common.sh"
lp_tag "${1:-}"; lp_heavy "$@"
lp_env trial
TAG="$1"; OUT="$LP_RESULTS/$TAG.after"; : > "$OUT"
step() {
  local name="$1"; shift
  local log="$LP_LOGS/$TAG.$name.log" rc
  "$@" > "$log" 2>&1; rc=$?
  bash "$LOCAL_PROOF_DIR/result.sh" "$name" "$rc" "$log" >> "$OUT"
  if [ "$rc" -ne 0 ]; then cat "$OUT"; exit "$rc"; fi
}
step migrate-trial env DATABASE_URL="$TRIAL_DATABASE_URL" corepack pnpm --filter @watchdog-bms/api exec prisma migrate deploy
step migrate-land env DATABASE_URL="$REALPG_DATABASE_URL" corepack pnpm --filter @watchdog-bms/api exec prisma migrate deploy
step generate corepack pnpm --filter @watchdog-bms/api exec prisma generate
step build bash "$LOCAL_PROOF_DIR/stack.sh" trial build
echo DONE >> "$OUT"
cat "$OUT"
