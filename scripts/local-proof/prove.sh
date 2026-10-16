#!/usr/bin/env bash
# Usage: prove.sh <tag> — the gate WITHOUT the trial stages, for an integration checkout:
#   real-DB migrate + generate + shared builds → suites → real-DB → proof build/reset/start/journeys.
# Use it in a checkout that holds work not yet on the served branch. The proof stack then serves THIS
# checkout, and the owner's trial stack keeps serving the served one until the work is proven and merged.
# Safety: never migrates, builds, starts or stops the trial stack; one heavy lock; fail closed at the first RED stage.
# Before the first run here: stop the proof stack from the checkout that started it (proof-stop.sh there);
# stack.sh refuses a port held by a process this checkout did not start.
set -u
CURRENT_STAGE=settings; OUT=/dev/null
trap 'rc=$?; if [ "$rc" -ne 0 ]; then printf "PROVE RED (%s)\n" "$CURRENT_STAGE" | tee -a "$OUT"; fi' EXIT
source "$(dirname "$0")/common.sh"
lp_tag "${1:-}"; lp_heavy "$@"
TAG="$1"; OUT="$LP_RESULTS/$TAG.prove"; : > "$OUT"
say() { echo "$*" | tee -a "$OUT"; }
say "HEAD $(git rev-parse --short HEAD) start $(date +%H:%M)"
stage() {
  local name="$1"; shift
  CURRENT_STAGE="$name"
  local log="$LP_LOGS/$TAG.prove-$name.log" rc line
  "$@" > "$log" 2>&1; rc=$?
  line=$(bash "$LOCAL_PROOF_DIR/result.sh" "$name" "$rc" "$log") || { say "$name RED tests=n/a first=summary-failed log=$log"; exit 1; }
  say "$line"
  if [ "$rc" -ne 0 ]; then tail -60 "$log" >&2; exit 1; fi
}
prepare() {
  set -e
  env DATABASE_URL="$REALPG_DATABASE_URL" corepack pnpm --filter @watchdog-bms/api exec prisma migrate deploy
  corepack pnpm --filter @watchdog-bms/api exec prisma generate
  corepack pnpm --filter @watchdog-bms/config build
  corepack pnpm --filter @watchdog-bms/contracts build
}
stage prepare prepare
stage suites bash "$LOCAL_PROOF_DIR/verify.sh" "$TAG"
stage real-db bash "$LOCAL_PROOF_DIR/realpg.sh" "$TAG"
stage proof-stop bash "$LOCAL_PROOF_DIR/proof-stop.sh" api
stage proof-build bash "$LOCAL_PROOF_DIR/stack.sh" proof build
stage proof-reset bash "$LOCAL_PROOF_DIR/proof-reset.sh"
stage proof-start bash "$LOCAL_PROOF_DIR/proof-start.sh"
stage journeys bash "$LOCAL_PROOF_DIR/proof-journeys.sh" "$TAG-journeys"
say 'PROVE GREEN'
