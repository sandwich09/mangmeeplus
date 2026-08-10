#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
runner="$repo_root/infra/prod-ecs-express/run-release-task.sh"
filter="$repo_root/infra/prod-ecs-express/release-task-network-failure.jq"

task_result() {
  jq -cn \
    --arg stop_code "${1:-TaskFailedToStart}" \
    --arg reason "${2:-ResourceInitializationError: unable to pull secrets or registry auth: There is a connection issue between the task and AWS Secrets Manager; canceled, context deadline exceeded}" \
    --argjson exit_code "${3:-null}" \
    '{tasks:[{stopCode:$stop_code,stoppedReason:$reason,containers:[{name:"release",exitCode:$exit_code}]}]}'
}

task_result | jq -e -f "$filter" >/dev/null
if task_result TaskFailedToStart \
  'ResourceInitializationError: unable to pull secrets or registry auth: AccessDeniedException' \
  null | jq -e -f "$filter" >/dev/null; then
  echo 'ERROR: permission failure was treated as a subnet failure' >&2
  exit 1
fi
if task_result EssentialContainerExited 'container failed' 1 | jq -e -f "$filter" >/dev/null; then
  echo 'ERROR: a started container failure was treated as safe to retry' >&2
  exit 1
fi

grep -Fq 'mapfile -t release_subnets' "$runner"
grep -Fq 'subnets:[$subnet]' "$runner"
grep -Fq 'release-task-network-failure.jq' "$runner"
grep -Fq 'trying the next public subnet' "$runner"
bash -n "$runner"

echo 'release-task network failover specs passed'
