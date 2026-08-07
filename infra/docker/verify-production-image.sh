#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <image> [docker-bin] | $0 --root <exported-root>" >&2
  exit 2
}

root=""
container=""
tmp=""

if [ "${1:-}" = "--root" ]; then
  [ "$#" -eq 2 ] || usage
  root="$2"
else
  [ "$#" -ge 1 ] && [ "$#" -le 2 ] || usage
  image="$1"
  docker_bin="${2:-docker}"
  "$docker_bin" image inspect "$image" >/dev/null
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-bms-image-root.XXXXXX")"
  container="$($docker_bin create "$image")"
  cleanup() {
    "$docker_bin" rm -f "$container" >/dev/null 2>&1 || true
    rm -rf "$tmp"
  }
  trap cleanup EXIT
  "$docker_bin" export "$container" | tar -xf - -C "$tmp"
  root="$tmp"
fi

app="$root/app"
if [ ! -d "$app" ]; then
  echo "ERROR: production image has no /app directory" >&2
  exit 1
fi

violations="$(
  find "$app" \
    -path '*/node_modules' -prune -o \
    -type f \( \
      -name '.env' -o -name '.env.*' -o -name '*.ts' -o -name '*.tsx' -o \
      -name '*.map' -o -name '*.d.ts' -o -name '*.spec.js' -o \
      -name '*-smoke.js' -o -name '*.md' \
    \) -print
  find "$app" -type f \( \
    -path '*/node_modules/.bin/prisma' -o \
    -path '*/node_modules/.bin/tsx' -o \
    -path '*/node_modules/.bin/tsc' -o \
    -path '*/node_modules/.bin/tsserver' -o \
    -path '*/node_modules/.bin/swc' -o \
    -path '*/node_modules/.bin/swcx' -o \
    -path '*/node_modules/.bin/turbo' \
  \) -print
  find "$app" -type d \( \
    -path '*/node_modules/.pnpm/prisma@*' -o \
    -path '*/node_modules/.pnpm/tsx@*' -o \
    -path '*/node_modules/.pnpm/typescript@*' -o \
    -path '*/node_modules/.pnpm/@swc+cli@*' -o \
    -path '*/node_modules/.pnpm/@swc+core@*' -o \
    -path '*/node_modules/.pnpm/turbo@*' \
  \) -prune -print
)"

if [ -n "$violations" ]; then
  echo "ERROR: forbidden source, configuration, or build/admin tooling in production image:" >&2
  printf '%s\n' "$violations" >&2
  exit 1
fi

echo "[production-image] filesystem allowlist passed"
