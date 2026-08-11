#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 6 ]; then
  echo "Usage: $0 <release-root> <live|maintenance_only> <source-sha> <api-active-sha> <ai-active-sha> <workers-active-sha>" >&2
  exit 2
fi

release_root="$1"
serving_mode="$2"
source_sha="$3"
api_active_sha="$4"
ai_active_sha="$5"
workers_active_sha="$6"
case "$serving_mode" in live|maintenance_only) ;; *)
  echo "ERROR: Production serving mode is invalid" >&2
  exit 2
esac
[ -d "$release_root/.git" ] || {
  echo "ERROR: release root is not a Git checkout" >&2
  exit 2
}
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] && [[ "$api_active_sha" =~ ^[0-9a-f]{40}$ ]] || {
  echo "ERROR: fast promotion cannot prove the Production database-code baseline; use explicit target=all" >&2
  exit 1
}

selector="$(cd "$(dirname "${BASH_SOURCE[0]}")/../uat" && pwd -P)/select-deploy-target.sh"
resolved_target="$(cd "$release_root" && bash "$selector" \
  "$source_sha" "$api_active_sha" "$ai_active_sha" "$workers_active_sha")"
effective_release_mode=fast-promotion

if ! git -C "$release_root" cat-file -e "$api_active_sha^{commit}" \
  || ! git -C "$release_root" merge-base --is-ancestor "$api_active_sha" "$source_sha"; then
  echo "ERROR: fast promotion cannot prove the Production database-code baseline; use explicit target=all" >&2
  exit 1
fi
if ! git -C "$release_root" diff --quiet --no-renames \
  "$api_active_sha" "$source_sha" -- apps/api/prisma; then
  if [ "$serving_mode" = maintenance_only ]; then
    echo "::notice::Pending Prisma changes require a read-only maintenance bootstrap; no migration will run." >&2
    effective_release_mode=maintenance-bootstrap
    resolved_target=all
  else
    echo "ERROR: fast promotion detected Prisma/schema/migration support changes; use explicit target=all" >&2
    exit 1
  fi
fi
if [ "$serving_mode" = maintenance_only ]; then
  resolved_target=all
fi
case "$resolved_target" in api-web|ai-gateway|workers|all) ;; *) exit 2 ;; esac
printf '%s %s\n' "$resolved_target" "$effective_release_mode"
