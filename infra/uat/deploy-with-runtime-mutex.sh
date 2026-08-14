#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"

target="${1:-all}"
region="${AWS_REGION:-ap-southeast-1}"
AWS_BIN="${AWS_BIN:-aws}"

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
    "$AWS_BIN" "$@"
}

# shellcheck source=infra/uat/lib-runtime-mutex.sh
. "$(dirname "$0")/lib-runtime-mutex.sh"
trap uat_runtime_mutex_release EXIT

uat_runtime_mutex_acquire "deploy-${target}-${GITHUB_RUN_ID:-manual}" || {
  echo "ERROR: UAT Redis migration/deploy mutex is active or cannot be acquired; no service mutation is allowed" >&2
  exit 1
}

export DEPLOY_ENV=uat
bash infra/prod-ecs-express/deploy.sh "$target"
