#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
reconstruct="$repo_root/infra/security/reconstruct-production-a5-result.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/production-a5-result-spec.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
marker=a5-prod-7001-a2-pre
payload='{"passed":true,"stage":"PRE_MUTATION"}'$'\n'
if command -v sha256sum >/dev/null 2>&1; then
  digest="$(printf '%s' "$payload" | sha256sum | awk '{print $1}')"
else
  digest="$(printf '%s' "$payload" | shasum -a 256 | awk '{print $1}')"
fi
encoded="$(printf '%s' "$payload" | base64 | tr -d '\n')"
split_at=$(( ${#encoded} / 2 ))
first="${encoded:0:$split_at}"
second="${encoded:$split_at}"

make_events() {
  jq -cnS --arg one "$1" --arg two "$2" '{events:[
    {eventId:"1",ingestionTime:1,message:$one,timestamp:1},
    {eventId:"2",ingestionTime:2,message:$two,timestamp:2}]}'
}
make_events \
  "A5_PRODUCTION_RESULT $marker 1/2 $digest $first" \
  "A5_PRODUCTION_RESULT $marker 2/2 $digest $second" > "$work/good.json"
bash "$reconstruct" "$work/good.json" "$marker" "$work/payload.json"
cmp -s <(printf '%s' "$payload") "$work/payload.json"

expect_reject() {
  local name="$1"
  if bash "$reconstruct" "$work/$name.json" "$marker" "$work/$name.out" >/dev/null 2>&1; then
    echo "ERROR: $name was accepted" >&2
    exit 1
  fi
}
make_events \
  "A5_PRODUCTION_RESULT $marker 1/2 $digest $first" \
  "A5_PRODUCTION_RESULT $marker 1/2 $digest $first" > "$work/duplicate.json"
expect_reject duplicate
make_events \
  "A5_PRODUCTION_RESULT $marker 1/3 $digest $first" \
  "A5_PRODUCTION_RESULT $marker 2/3 $digest $second" > "$work/truncated.json"
expect_reject truncated
make_events \
  "A5_PRODUCTION_RESULT a5-prod-6999-a1-pre 1/2 $digest $first" \
  "A5_PRODUCTION_RESULT $marker 2/2 $digest $second" > "$work/replay.json"
expect_reject replay
make_events \
  "A5_PRODUCTION_RESULT $marker 1/2 $(printf '0%.0s' {1..64}) $first" \
  "A5_PRODUCTION_RESULT $marker 2/2 $(printf '0%.0s' {1..64}) $second" > "$work/wrong-digest.json"
expect_reject wrong-digest

bash -n "$reconstruct"
echo 'production A5 result reconstruction spec: PASS'
