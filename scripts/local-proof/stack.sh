#!/usr/bin/env bash
# Internal: stack.sh proof|trial start|stop|run-api|run-web|build [api|web|all]
# Safety: every server gets its own POSIX session; only its recorded process group is stopped.
# Safety: unmanaged occupied ports are refused with their PID; never adopted or killed.
# Safety: start fails unless the built API answers /v1/health within 180 seconds.
source "$(dirname "$0")/common.sh"
STACK="${1:?stack required}"; ACTION="${2:?action required}"; WHAT="${3:-all}"
lp_env "$STACK"
command -v lsof >/dev/null || { echo 'lsof is required to check listener ownership.' >&2; exit 2; }
listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
check_port() {
  local service="$1" port="$2" record="$LOCAL_PROOF_OUTPUT_DIR/pids/$STACK-$1.pid" pid listener
  pid=$(cat "$record" 2>/dev/null || true)
  if [ -n "$pid" ] && { ! [[ "$pid" =~ ^[0-9]+$ ]] || [ "$pid" -le 1 ]; }; then
    echo "REFUSING: invalid process group in $record" >&2; return 1
  fi
  for listener in $(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null); do
    if [ -z "$pid" ] || [ "$(ps -o pgid= -p "$listener" | tr -d ' ')" != "$pid" ]; then
      echo "REFUSING: $STACK $service port $port is occupied by unmanaged PID $listener; stop it yourself before retrying. No process was killed." >&2
      return 1
    fi
  done
}
start_one() {
  local service="$1" port="$2" record="$LOCAL_PROOF_OUTPUT_DIR/pids/$STACK-$1.pid" pid
  check_port "$service" "$port" || return 1
  if ! listening "$port"; then
    pid=$(cat "$record" 2>/dev/null || true)
    if [ -n "$pid" ] && kill -0 -- "-$pid" 2>/dev/null; then
      echo "$service recorded group $pid is still starting; waiting for readiness"
      return 0
    fi
    nohup perl -e 'use POSIX; my $sid = POSIX::setsid(); defined($sid) && $sid == $$ or die "setsid: $!"; my $record = shift @ARGV; open(my $f, ">", $record) or die "pid file: $!"; print $f $$; close($f); exec @ARGV or die "exec: $!";' \
      "$record" bash "$LOCAL_PROOF_DIR/stack.sh" "$STACK" "run-$service" >> "$LP_LOGS/$STACK-$service.log" 2>&1 < /dev/null &
    echo "$service started"
  fi
}
stop_one() {
  local service="$1" port="$2" record="$LOCAL_PROOF_OUTPUT_DIR/pids/$STACK-$1.pid" pid i
  check_port "$service" "$port" || return 1
  [ -f "$record" ] || return 0
  pid=$(cat "$record")
  if listening "$port"; then
    kill -TERM -- "-$pid" 2>/dev/null || return 1
    for i in 1 2 3 4 5 6 7 8; do sleep 1; listening "$port" || break; done
    if listening "$port"; then
      echo "REFUSING: $STACK $service still listens on port $port; recorded group $pid did not stop." >&2
      return 1
    fi
    echo "$service stopped"
  fi
  rm -f "$record"
}
wait_api() {
  # A listening socket is not enough: the built API must answer its public health route.
  if python3 - "$API_PORT" <<'PY_HEALTH'
import sys, time, urllib.request
url = f'http://127.0.0.1:{sys.argv[1]}/v1/health'
# Never follow a redirect or an inherited HTTP proxy to a different service.
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args): return None
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
deadline = time.monotonic() + 180
while time.monotonic() < deadline:
    try:
        with opener.open(url, timeout=min(3, max(0.1, deadline - time.monotonic()))) as response:
            if response.status == 200:
                print(f'API healthy: {url}')
                sys.exit(0)
    except (OSError, ValueError):
        pass
    time.sleep(min(2, max(0, deadline - time.monotonic())))
sys.exit(1)
PY_HEALTH
  then
    check_port api "$API_PORT"
  else
    echo "API health failed within 180s: $STACK port $API_PORT; last API log lines:" >&2
    tail -60 "$LP_LOGS/$STACK-api.log" >&2
    return 1
  fi
}
case "$ACTION" in
  run-api) exec node "apps/api/$API_DIST_DIR/apps/api/src/main.js";;
  run-web)
    export SERVICE_NAME=web PORT="$WEB_PORT" HOST=127.0.0.1
    if [ "$STACK" = trial ]; then export HOST="$WEB_HOST"; fi
    exec corepack pnpm --filter @watchdog-bms/web dev;;
  build)
    lp_heavy "$@"
    set -e
    if [ "$STACK" = trial ]; then
      corepack pnpm --filter @watchdog-bms/config build
      corepack pnpm --filter @watchdog-bms/contracts build
    fi
    corepack pnpm --filter @watchdog-bms/api build
    echo BUILD_DONE;;
  start)
    # Preflight both ports before launching either service; never adopt someone else's stack.
    check_port api "$API_PORT" && check_port web "$WEB_PORT" || exit 1
    start_one api "$API_PORT" || exit 1
    wait_api || exit 1
    start_one web "$WEB_PORT" || exit 1
    for ((i=0; i<60; i++)); do listening "$WEB_PORT" && break; sleep 3; done
    check_port web "$WEB_PORT" || exit 1
    listening "$WEB_PORT" || { echo "WEB NOT UP: $STACK port $WEB_PORT" >&2; tail -60 "$LP_LOGS/$STACK-web.log" >&2; exit 1; }
    echo 'web up';;
  stop)
    case "$WHAT" in api|web|all) ;; *) echo 'Expected api, web or all' >&2; exit 2;; esac
    if [ "$WHAT" = api ] || [ "$WHAT" = all ]; then check_port api "$API_PORT" || exit 1; fi
    if [ "$WHAT" = web ] || [ "$WHAT" = all ]; then check_port web "$WEB_PORT" || exit 1; fi
    if [ "$WHAT" = api ] || [ "$WHAT" = all ]; then stop_one api "$API_PORT" || exit 1; fi
    if [ "$WHAT" = web ] || [ "$WHAT" = all ]; then stop_one web "$WEB_PORT" || exit 1; fi;;
  *) echo "Unknown action: $ACTION" >&2; exit 2;;
esac
