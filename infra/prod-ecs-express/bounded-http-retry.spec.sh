#!/usr/bin/env bash
set -euo pipefail

work="$(mktemp -d "${TMPDIR:-/tmp}/bounded-http-retry.XXXXXX")"
trap 'test -z "${server_pid:-}" || kill "$server_pid" 2>/dev/null || true; rm -rf "$work"' EXIT

python3 - "$work/port" "$work/counts.json" <<'PY' &
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

port_file, counts_file = sys.argv[1:]
counts = {"transient": 0, "unauthorized": 0, "malformed": 0}

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        name = self.path.removeprefix("/")
        counts[name] += 1
        with open(counts_file, "w", encoding="utf-8") as output:
            json.dump(counts, output)
        status = 200
        body = b'{"service":"api","status":"ok","db":"ok"}'
        if name == "transient" and counts[name] == 1:
            status, body = 503, b'{"status":"unavailable"}'
        elif name == "unauthorized":
            status, body = 401, b'{"status":"unauthorized"}'
        elif name == "malformed":
            body = b'{"service":"api","status":"wrong"}'
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format, *_args):
        pass

server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
with open(port_file, "w", encoding="utf-8") as output:
    output.write(str(server.server_port))
server.serve_forever()
PY
server_pid=$!
for _ in {1..40}; do [ ! -s "$work/port" ] || break; sleep 0.05; done
port="$(cat "$work/port")"
[[ "$port" =~ ^[1-9][0-9]*$ ]]
retry=(--retry 2 --retry-delay 2 --retry-max-time 70 --retry-all-errors)

status="$(curl --silent --show-error "${retry[@]}" --max-time 20 --max-filesize 16384 \
  --output "$work/transient.json" --write-out '%{http_code}' "http://127.0.0.1:$port/transient")"
test "$status" = 200
jq -e '.service=="api" and .status=="ok" and .db=="ok"' "$work/transient.json" >/dev/null
test "$(jq -r '.transient' "$work/counts.json")" = 2

status="$(curl --silent --show-error "${retry[@]}" --max-time 20 --max-filesize 16384 \
  --output "$work/unauthorized.json" --write-out '%{http_code}' "http://127.0.0.1:$port/unauthorized")"
test "$status" = 401
test "$(jq -r '.unauthorized' "$work/counts.json")" = 1

status="$(curl --silent --show-error "${retry[@]}" --max-time 20 --max-filesize 16384 \
  --output "$work/malformed.json" --write-out '%{http_code}' "http://127.0.0.1:$port/malformed")"
test "$status" = 200
if jq -e '.service=="api" and .status=="ok" and .db=="ok"' "$work/malformed.json" >/dev/null; then
  echo 'ERROR: malformed success passed the application-level readiness contract' >&2
  exit 1
fi
test "$(jq -r '.malformed' "$work/counts.json")" = 1

kill "$server_pid" 2>/dev/null || true
wait "$server_pid" 2>/dev/null || true
server_pid=''
echo 'bounded HTTP retry contract: PASS'
