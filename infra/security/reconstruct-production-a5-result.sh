#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 <cloudwatch-events.json> <exact-result-marker> <payload.json>" >&2
  exit 2
fi

events="$1"
marker="$2"
output="$3"
[[ "$marker" =~ ^a5-prod-[1-9][0-9]*-a[1-9][0-9]*-(pre|post-migration|post-deployment)$ ]]
[ -f "$events" ] && [ ! -L "$events" ] && [ ! -e "$output" ]
work="$(mktemp -d "${TMPDIR:-/tmp}/production-a5-result.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT

jq -e --arg marker "$marker" '
  (keys|sort)==["events"] and (.events|type)=="array" and (.events|length)>=1
  and all(.events[]; (keys|sort)==["eventId","ingestionTime","message","timestamp"])
  and all(.events[];
    (.message|startswith("A5_PRODUCTION_RESULT ")|not)
    or (.message|test("^A5_PRODUCTION_RESULT "+$marker+
      " [1-9][0-9]*/[1-9][0-9]* [0-9a-f]{64} [A-Za-z0-9+/]+={0,2}$")))
' "$events" >/dev/null

jq -cS --arg marker "$marker" '[.events[]
  | select(.message|startswith("A5_PRODUCTION_RESULT "))
  | .message | capture("^A5_PRODUCTION_RESULT "+$marker+
      " (?<index>[1-9][0-9]*)/(?<total>[1-9][0-9]*) (?<digest>[0-9a-f]{64}) (?<chunk>[A-Za-z0-9+/]+={0,2})$")
  | .index=(.index|tonumber) | .total=(.total|tonumber)]' "$events" > "$work/frames.json"

jq -e '
  length>=1 and length<=256
  and (map(.total)|unique|length)==1 and (map(.digest)|unique|length)==1
  and (.[0].total==length) and (.[0].total<=256)
  and (map(.index)|sort)==([range(1;length+1)])
  and (map(.index)|unique|length)==length
' "$work/frames.json" >/dev/null

jq -jr 'sort_by(.index)|map(.chunk)|join("")' "$work/frames.json" > "$work/result.base64"
if base64 --decode < "$work/result.base64" > "$work/result.json" 2>/dev/null; then :
else base64 -D < "$work/result.base64" > "$work/result.json"; fi
size="$(wc -c < "$work/result.json" | tr -d '[:space:]')"
[[ "$size" =~ ^[1-9][0-9]*$ ]] && [ "$size" -le 700000 ]
expected="$(jq -er '.[0].digest' "$work/frames.json")"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$work/result.json" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "$work/result.json" | awk '{print $1}')"
fi
[ "$actual" = "$expected" ]
jq -cS . "$work/result.json" > "$work/canonical.json"
cmp -s "$work/result.json" "$work/canonical.json"
install -m 600 "$work/result.json" "$output"
