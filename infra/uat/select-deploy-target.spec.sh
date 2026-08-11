#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
selector="$repo_root/infra/uat/select-deploy-target.sh"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-uat-selector.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

git -C "$fixture" init -q
git -C "$fixture" config user.name selector-spec
git -C "$fixture" config user.email selector@example.invalid
mkdir -p "$fixture/apps/api/src" "$fixture/apps/ai-gateway/src" \
  "$fixture/apps/workers/src" "$fixture/packages/config/src" "$fixture/docs"
printf 'base\n' > "$fixture/README"
git -C "$fixture" add .
git -C "$fixture" commit -qm base
base="$(git -C "$fixture" rev-parse HEAD)"

commit_path() {
  local path="$1" text="$2"
  mkdir -p "$fixture/$(dirname "$path")"
  printf '%s\n' "$text" > "$fixture/$path"
  git -C "$fixture" add "$path"
  git -C "$fixture" commit -qm "$path"
  git -C "$fixture" rev-parse HEAD
}

select_target() (
  cd "$fixture"
  bash "$selector" "$@"
)

workers="$(commit_path apps/workers/src/job.ts workers)"
test "$(select_target "$workers" "$base" "$base" "$base")" = workers

# workers is already current while API is still at the original base. The selector
# must compare every service with its own active SHA and select only the cumulative API change.
api="$(commit_path apps/api/src/main.ts api)"
test "$(select_target "$api" "$base" "$base" "$workers")" = api-web

ai="$(commit_path apps/ai-gateway/src/main.ts ai)"
test "$(select_target "$ai" "$api" "$api" "$workers")" = ai-gateway

shared="$(commit_path packages/config/src/index.ts shared)"
test "$(select_target "$shared" "$api" "$ai" "$workers")" = all

unknown="$(commit_path scripts/unknown.sh unknown)"
test "$(select_target "$unknown" "$shared" "$shared" "$shared")" = all
test "$(select_target "$unknown" not-a-sha "$shared" "$shared")" = all
test "$(select_target "$unknown" "$unknown" "$unknown" "$unknown")" = all

echo "UAT selective target: pass"
