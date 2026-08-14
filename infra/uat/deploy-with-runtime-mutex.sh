#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"

# Compatibility entrypoint used by the workflow and runbook. deploy.sh owns the one shared
# Redis/deploy mutex so direct and wrapped callers cannot accidentally acquire it twice.
export DEPLOY_ENV=uat
exec bash infra/prod-ecs-express/deploy.sh "${1:-all}"
