#!/bin/sh
set -eu

CLAMD_PID=""
FRESHCLAM_PID=""

clamav_ready() {
  env -i PATH="$PATH" CLAMAV_PORT="${CLAMAV_PORT:-3310}" node -e '
    const net = require("net");
    const socket = net.createConnection({
      host: "127.0.0.1",
      port: Number(process.env.CLAMAV_PORT),
    });
    let finished = false;
    const finish = (code) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      process.exit(code);
    };
    socket.setTimeout(1000);
    socket.on("connect", () => socket.write("nPING\n"));
    socket.on("data", (data) => finish(data.toString().includes("PONG") ? 0 : 1));
    socket.on("timeout", () => finish(1));
    socket.on("error", () => finish(1));
  '
}

if [ "${CLAMAV_HOST:-}" = "127.0.0.1" ]; then
  # A failed refresh is acceptable only while the baked database is still fresh;
  # clamd's age gate below keeps stale signatures fail-closed.
  env -i PATH="$PATH" freshclam --stdout --user=node || true
  env -i PATH="$PATH" clamd --foreground=true --fail-if-cvd-older-than=7 &
  CLAMD_PID="$!"

  attempts=0
  until clamav_ready; do
    if ! kill -0 "$CLAMD_PID" 2>/dev/null; then
      wait "$CLAMD_PID"
      exit 1
    fi
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 60 ]; then
      echo "ERROR: clamd did not become ready within 120 seconds" >&2
      exit 1
    fi
    sleep 2
  done

  env -i PATH="$PATH" freshclam --daemon --foreground --stdout --user=node \
    --checks=12 --daemon-notify=/usr/local/etc/clamd.conf &
  FRESHCLAM_PID="$!"
fi

HOST=0.0.0.0 PORT="${API_PORT:-3001}" node /app/api-runtime/apps/api/dist/apps/api/src/main.js &
API_PID="$!"

# M-01: only the already-forked API process keeps the delegation signing key.
unset AI_ACTOR_DELEGATION_SIGNING_KEY

HOSTNAME=0.0.0.0 PORT="${WEB_PORT:-3002}" node /app/web-runtime/apps/web/server.js &
WEB_PID="$!"

node /app/runtime/web-api-proxy.mjs &
PROXY_PID="$!"

PIDS="$API_PID $WEB_PID $PROXY_PID"
[ -z "$CLAMD_PID" ] || PIDS="$PIDS $CLAMD_PID"
[ -z "$FRESHCLAM_PID" ] || PIDS="$PIDS $FRESHCLAM_PID"

shutdown() {
  kill $PIDS 2>/dev/null || true
}

all_alive() {
  for pid in $PIDS; do
    kill -0 "$pid" 2>/dev/null || return 1
  done
}

trap shutdown INT TERM EXIT

while all_alive; do
  sleep 2
done

exit 1
