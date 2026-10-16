#!/usr/bin/env bash
# Usage: heavy.sh <command...>
# Safety: one heavy job across sessions/worktrees, using an atomic mkdir lock released by its owner.
# Nested toolkit commands reuse the living owner's lock; stale locks are never stolen automatically.
# Preserve the caller's directory for this general command wrapper.
LOCAL_PROOF_CALLER_DIR="$PWD"
source "$(dirname "$0")/common.sh"
cd "$LOCAL_PROOF_CALLER_DIR" || exit 2
[ "$#" -gt 0 ] || { echo 'Usage: heavy.sh <command...>' >&2; exit 2; }
if lp_holds_heavy_lock; then exec "$@"; fi
mkdir -p "$(dirname "$HEAVY_LOCK_DIR")" || exit 2
until mkdir "$HEAVY_LOCK_DIR" 2>/dev/null; do sleep 15; done
printf '%s\n' "$$" > "$HEAVY_LOCK_DIR/owner.pid"
printf 'heavy %s %s\n' "$$" "$(date +%H:%M:%S)" > "$HEAVY_LOCK_DIR/owner"
trap 'rm -f "$HEAVY_LOCK_DIR/owner" "$HEAVY_LOCK_DIR/owner.pid"; rmdir "$HEAVY_LOCK_DIR" 2>/dev/null' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
export LOCAL_PROOF_HEAVY_OWNER=$$
"$@"
