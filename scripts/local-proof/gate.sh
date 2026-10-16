#!/usr/bin/env bash
# Usage: gate.sh <tag> — prepare/restart trial → suites → real-DB → proof build/reset/start/journeys.
# Safety: one heavy lock for the gate, local URL guards, recorded-group-only stops.
# Safety: fail closed at the first RED stage (including API health); never bless an old build.
set -u
CURRENT_STAGE=settings; OUT=/dev/null
# Even a settings/guard failure has a final RED line and a failing exit status.
trap 'rc=$?; if [ "$rc" -ne 0 ]; then printf "GATE RED (%s)\n" "$CURRENT_STAGE" | tee -a "$OUT"; fi' EXIT
source "$(dirname "$0")/common.sh"
lp_tag "${1:-}"; lp_heavy "$@"
TAG="$1"; OUT="$LP_RESULTS/$TAG.gate"; : > "$OUT"
say() { echo "$*" | tee -a "$OUT"; }
say "HEAD $(git rev-parse --short HEAD) start $(date +%H:%M)"
stage() {
  local name="$1"; shift
  CURRENT_STAGE="$name"
  local log="$LP_LOGS/$TAG.gate-$name.log" rc line
  "$@" > "$log" 2>&1; rc=$?
  line=$(bash "$LOCAL_PROOF_DIR/result.sh" "$name" "$rc" "$log") || {
    say "$name RED tests=n/a first=summary-failed log=$log"
    exit 1
  }
  say "$line"
  if [ "$rc" -ne 0 ]; then
    # Health timeout diagnostics and unmanaged port/PID remain visible at the gate's terminal.
    tail -60 "$log" >&2
    exit 1
  fi
}
stage trial-prepare bash "$LOCAL_PROOF_DIR/trial-after-merge.sh" "$TAG"
stage trial-stop bash "$LOCAL_PROOF_DIR/stack.sh" trial stop api
stage trial-start bash "$LOCAL_PROOF_DIR/trial-start.sh"
stage suites bash "$LOCAL_PROOF_DIR/verify.sh" "$TAG"
stage real-db bash "$LOCAL_PROOF_DIR/realpg.sh" "$TAG"
stage proof-stop bash "$LOCAL_PROOF_DIR/proof-stop.sh" api
stage proof-build bash "$LOCAL_PROOF_DIR/stack.sh" proof build
stage proof-reset bash "$LOCAL_PROOF_DIR/proof-reset.sh"
stage proof-start bash "$LOCAL_PROOF_DIR/proof-start.sh"
stage journeys bash "$LOCAL_PROOF_DIR/proof-journeys.sh" "$TAG-journeys"
say 'GATE GREEN'
