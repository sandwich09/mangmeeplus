#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
resolver="$repo_root/infra/docker/resolve-production-fast-mode.sh"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/production-fast-mode.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

git -C "$fixture" init -q
git -C "$fixture" config user.email release-spec@example.invalid
git -C "$fixture" config user.name release-spec
mkdir -p "$fixture/apps/api/prisma/migrations/20260101000000_base" "$fixture/apps/web"
printf 'base\n' > "$fixture/apps/api/prisma/migrations/20260101000000_base/migration.sql"
printf 'web-v1\n' > "$fixture/apps/web/page.tsx"
git -C "$fixture" add .
git -C "$fixture" commit -qm base
base="$(git -C "$fixture" rev-parse HEAD)"

printf 'web-v2\n' > "$fixture/apps/web/page.tsx"
git -C "$fixture" add .
git -C "$fixture" commit -qm web
web="$(git -C "$fixture" rev-parse HEAD)"

mkdir -p "$fixture/apps/api/prisma/migrations/20260102000000_pending"
printf 'pending\n' > "$fixture/apps/api/prisma/migrations/20260102000000_pending/migration.sql"
git -C "$fixture" add .
git -C "$fixture" commit -qm pending
pending="$(git -C "$fixture" rev-parse HEAD)"

test "$(bash "$resolver" "$fixture" live "$web" "$base" "$base" "$base")" = 'api-web fast-promotion'
test "$(bash "$resolver" "$fixture" maintenance_only "$web" "$base" "$base" "$base")" = 'all fast-promotion'
test "$(bash "$resolver" "$fixture" maintenance_only "$pending" "$base" "$base" "$base" 2>/dev/null)" = 'all maintenance-bootstrap'
if bash "$resolver" "$fixture" live "$pending" "$base" "$base" "$base" \
  >"$fixture/live.out" 2>"$fixture/live.err"; then
  echo 'ERROR: live fast promotion accepted pending Prisma changes' >&2
  exit 1
fi
grep -Fq 'fast promotion detected Prisma/schema/migration support changes' "$fixture/live.err"
test "$(bash "$resolver" "$fixture" live "$web" "$base" malformed "$base")" = 'all fast-promotion'
if bash "$resolver" "$fixture" live "$base" "$web" "$web" "$web" \
  >"$fixture/ancestor.out" 2>"$fixture/ancestor.err"; then
  echo 'ERROR: fast promotion accepted a non-ancestor API baseline' >&2
  exit 1
fi
grep -Fq 'cannot prove the Production database-code baseline' "$fixture/ancestor.err"

echo 'production fast mode resolver: PASS'
