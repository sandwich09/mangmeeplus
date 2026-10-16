#!/usr/bin/env bash
# Internal settings/guards shared by every entry point. Never prints database credentials.
# Safety: reject non-local PostgreSQL/Redis URLs and shared trial/proof Redis databases before any job.
# Safety: paths come from this file, not the caller's current directory or a machine's worktree.
LOCAL_PROOF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_PROOF_ROOT="$(cd "$LOCAL_PROOF_DIR/../.." && pwd)"
if [ ! -f "$LOCAL_PROOF_DIR/settings.local.sh" ]; then
  echo 'Copy scripts/local-proof/settings.example.sh to settings.local.sh and fill it first.' >&2
  exit 2
fi
set -a
# shellcheck source=/dev/null
source "$LOCAL_PROOF_DIR/settings.local.sh"
set +a

python3 - <<'PY' || exit 2
import os, re, sys
from urllib.parse import urlsplit, parse_qsl, unquote
names = ['TRIAL_DATABASE_URL', 'PROOF_DATABASE_URL', 'REALPG_DATABASE_URL']
names += [key for key in os.environ if key.endswith('DATABASE_URL') and key not in names and os.environ[key]]
for name in names:
    try:
        url = urlsplit(os.environ[name])
        if url.scheme not in ('postgres', 'postgresql') or url.hostname not in ('localhost', '127.0.0.1', '::1'):
            raise ValueError()
        if not url.path.strip('/') or url.fragment or url.port == 0:
            raise ValueError()
        # A local URI with ?host=remote (or an alternate service) is not a local connection.
        if any(key.lower() in ('host', 'hostaddr', 'port', 'service', 'servicefile', 'dbname') for key, _ in parse_qsl(url.query)):
            raise ValueError()
    except (KeyError, ValueError):
        sys.exit(f'REFUSING: {name} must be a PostgreSQL URL on localhost, 127.0.0.1 or [::1], without routing overrides.')
redis_targets = []
for name in ('TRIAL_REDIS_URL', 'PROOF_REDIS_URL'):
    try:
        url = urlsplit(os.environ[name])
        if url.scheme not in ('redis', 'rediss') or url.hostname not in ('localhost', '127.0.0.1', '::1'):
            raise ValueError()
        if not re.fullmatch(r'/[0-9]+', url.path) or url.query or url.fragment or url.port == 0:
            raise ValueError()
        # Loopback aliases or forwarded ports may reach the same server; require distinct indices.
        redis_targets.append(int(url.path[1:]))
    except (KeyError, ValueError):
        sys.exit(f'REFUSING: set {name} to a local Redis URL with an explicit database index and no query/fragment.')
if redis_targets[0] == redis_targets[1]:
    sys.exit('REFUSING: trial and proof Redis database indices must be different.')
proof = os.environ.get('PROOF_DATABASE_NAME', '')
if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,62}', proof):
    sys.exit('REFUSING: PROOF_DATABASE_NAME must be a simple PostgreSQL identifier (up to 63 characters).')
if any(unquote(urlsplit(os.environ[name]).path[1:]) == proof for name in ('TRIAL_DATABASE_URL', 'REALPG_DATABASE_URL')):
    sys.exit('REFUSING: trial and real-database names must be different from PROOF_DATABASE_NAME.')
PY
# libpq must not inherit an alternate address or service alongside the checked URL.
unset PGHOST PGHOSTADDR PGPORT PGSERVICE PGSERVICEFILE PGDATABASE
# Relative settings paths belong to this checkout, regardless of where the command was invoked.
case "$LOCAL_PROOF_OUTPUT_DIR" in /*) ;; *) LOCAL_PROOF_OUTPUT_DIR="$LOCAL_PROOF_ROOT/$LOCAL_PROOF_OUTPUT_DIR";; esac
case "$HEAVY_LOCK_DIR" in /*) ;; *) HEAVY_LOCK_DIR="$LOCAL_PROOF_ROOT/$HEAVY_LOCK_DIR";; esac
case "$TSC_LOCK_DIR" in /*) ;; *) TSC_LOCK_DIR="$LOCAL_PROOF_ROOT/$TSC_LOCK_DIR";; esac
mkdir -p "$LOCAL_PROOF_OUTPUT_DIR/logs" "$LOCAL_PROOF_OUTPUT_DIR/results" "$LOCAL_PROOF_OUTPUT_DIR/pids" || exit 2
LP_LOGS="$LOCAL_PROOF_OUTPUT_DIR/logs"
LP_RESULTS="$LOCAL_PROOF_OUTPUT_DIR/results"
cd "$LOCAL_PROOF_ROOT" || exit 2

lp_tag() {
  case "${1:-}" in ''|*[!a-zA-Z0-9_.-]*|.|..) echo 'Use a tag containing only letters, numbers, dots, underscores and hyphens.' >&2; exit 2;; esac
}
lp_env() {
  local stack="$1"
  case "$stack" in
    proof) export REDIS_URL="$PROOF_REDIS_URL" DATABASE_URL="$PROOF_DATABASE_URL" API_PORT="$PROOF_API_PORT" WEB_PORT="$PROOF_WEB_PORT" API_DIST_DIR="$PROOF_API_DIST_DIR" NEXT_DIST_DIR="$PROOF_NEXT_DIST_DIR"
      export LINE_WEB_HANDOFF_ENABLED="$PROOF_LINE_WEB_HANDOFF_ENABLED" LINE_LIFF_ID="$PROOF_LINE_LIFF_ID";;
    trial) export REDIS_URL="$TRIAL_REDIS_URL" DATABASE_URL="$TRIAL_DATABASE_URL" API_PORT="$TRIAL_API_PORT" WEB_PORT="$TRIAL_WEB_PORT" API_DIST_DIR="$TRIAL_API_DIST_DIR" NEXT_DIST_DIR="$TRIAL_NEXT_DIST_DIR";;
    *) echo "Unknown stack: $stack" >&2; exit 2;;
  esac
  export NODE_ENV=development APP_ENV=local SERVICE_NAME=api SERVICE_VERSION=e2e GIT_SHA=local
  export HOST=127.0.0.1 PORT="$API_PORT" AUTH_PROVIDER=dev DEV_AUTH_ENABLED=true
  export WATCHDOG_JWT_ISSUER="http://127.0.0.1:$API_PORT"
  export WEB_BASE_URL="http://127.0.0.1:$WEB_PORT" CORS_ALLOWED_ORIGINS="http://127.0.0.1:$WEB_PORT,http://localhost:$WEB_PORT"
  export NEXT_PUBLIC_API_URL="http://127.0.0.1:$API_PORT/v1" NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:$API_PORT/v1"
  export E2E_API_BASE_URL="http://127.0.0.1:$API_PORT/v1" E2E_WEB_BASE_URL="http://127.0.0.1:$WEB_PORT"
}
# An explicit caller URL has already passed the guard; never fall through to an unchecked .env URL.
export DATABASE_URL="${DATABASE_URL:-$REALPG_DATABASE_URL}"
# Standalone verification must never inherit the trial cache. Stack commands select explicitly.
export REDIS_URL="$PROOF_REDIS_URL"
lp_holds_heavy_lock() {
  [[ "${LOCAL_PROOF_HEAVY_OWNER:-}" =~ ^[0-9]+$ ]] &&
    [ "$(cat "$HEAVY_LOCK_DIR/owner.pid" 2>/dev/null)" = "$LOCAL_PROOF_HEAVY_OWNER" ] &&
    kill -0 "$LOCAL_PROOF_HEAVY_OWNER" 2>/dev/null
}
lp_heavy() {
  if ! lp_holds_heavy_lock; then exec bash "$LOCAL_PROOF_DIR/heavy.sh" bash "$LOCAL_PROOF_DIR/$(basename "$0")" "$@"; fi
}
