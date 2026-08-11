#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "Usage: $0 <source-sha> <api-web-active-sha> <ai-gateway-active-sha> <workers-active-sha>" >&2
  exit 2
fi

source_sha="$1"
api_sha="$2"
ai_sha="$3"
workers_sha="$4"

impact_for_path() {
  case "$1" in
    docs/*|outputs/*|*.md|LICENSE) echo ignore ;;
    apps/api/prisma/*|apps/api/Dockerfile|packages/config/*|packages/contracts/*) echo all ;;
    package.json|pnpm-lock.yaml|pnpm-workspace.yaml|turbo.json|tsconfig.base.json) echo all ;;
    .github/workflows/ci.yml|.github/workflows/deploy-uat.yml) echo all ;;
    infra/prod-ecs-express/*|infra/docker/*|infra/uat/*) echo all ;;
    apps/api/*|apps/web/*|infra/api-web/*|packages/design-tokens/*) echo api-web ;;
    apps/ai-gateway/*) echo ai-gateway ;;
    apps/workers/*) echo workers ;;
    *) echo all ;;
  esac
}

service_affected() {
  local service="$1" base_sha="$2" path impact
  [[ "$base_sha" =~ ^[0-9a-f]{40}$ ]] || return 2
  git cat-file -e "$base_sha^{commit}" 2>/dev/null || return 2
  git merge-base --is-ancestor "$base_sha" "$source_sha" 2>/dev/null || return 2
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    impact="$(impact_for_path "$path")"
    case "$impact" in
      ignore) ;;
      all|"$service") return 0 ;;
    esac
  done < <(git diff --name-only --no-renames "$base_sha" "$source_sha" --)
  return 1
}

[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || { echo all; exit 0; }
git cat-file -e "$source_sha^{commit}" 2>/dev/null || { echo all; exit 0; }

affected=()
for spec in "api-web:$api_sha" "ai-gateway:$ai_sha" "workers:$workers_sha"; do
  service="${spec%%:*}"
  base_sha="${spec#*:}"
  rc=0
  service_affected "$service" "$base_sha" || rc=$?
  case "$rc" in
    0) affected+=("$service") ;;
    1) ;;
    *) echo all; exit 0 ;;
  esac
done

if [ "${#affected[@]}" -eq 1 ]; then
  echo "${affected[0]}"
else
  # Zero impact means there is no runtime release to perform; keeping the existing
  # workflow contract fail-safe is cheaper than inventing a fourth `none` target.
  echo all
fi
