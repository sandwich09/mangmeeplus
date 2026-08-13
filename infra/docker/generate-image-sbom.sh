#!/usr/bin/env bash
set -euo pipefail

image="${1:?image digest reference is required}"
output="${2:?SBOM output path is required}"

[[ "$image" =~ @sha256:[0-9a-f]{64}$ || "$image" =~ :ci$ ]]
test "$(uname -s)" = Linux
test "$(uname -m)" = x86_64

syft_version=1.42.3
syft_url=https://github.com/anchore/syft/releases/download/v1.42.3/syft_1.42.3_linux_amd64.tar.gz
syft_sha256=0d6be741479eddd2c8644a288990c04f3df0d609bbc1599a005532a9dff63509
work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/watchdog-syft.XXXXXX")"
partial="$output.partial"
cleanup() {
  rm -rf -- "$work"
  rm -f -- "$partial"
}
trap cleanup EXIT

timeout 300 curl --fail --silent --show-error --location \
  --connect-timeout 10 --max-time 60 \
  --retry 4 --retry-all-errors --retry-delay 2 \
  "$syft_url" \
  --output "$work/syft.tar.gz"
printf '%s  %s\n' "$syft_sha256" "$work/syft.tar.gz" | sha256sum --check --status
tar -xzf "$work/syft.tar.gz" -C "$work" syft
test "$("$work/syft" version -o json | jq -er '.version')" = "$syft_version"

mkdir -p "$(dirname "$output")"
SYFT_CHECK_FOR_APP_UPDATE=false "$work/syft" scan "$image" -o spdx-json > "$partial"
jq -e '.spdxVersion | startswith("SPDX-")' "$partial" >/dev/null
mv "$partial" "$output"
