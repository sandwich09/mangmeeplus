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
grep -Fq 'run_identity="$reconcile_operation_id"' "$runner"
grep -Fq 'run_identity="${mutation_intent_id:-${operation_id:-${parent_operation_id:-${GITHUB_RUN_ID:-manual}-${GITHUB_RUN_ATTEMPT:-1}}}}"' "$runner"
grep -Fq 'release_task_request_id="$(printf '\''%s'\'' "$deploy_env:$mode:$commit:$run_identity:$network_boundary" | sha256_text)"' "$runner"
grep -Fq 'dockerLabels: {"com.watchdog-bms.release-request":$releaseTaskRequestId}' "$runner"
grep -Fq '"$release_task_request_id:$task_definition_arn:$network"' "$runner"
grep -Fq 'started_by="watchdog-bms-${resource_stage}-release"' "$runner"
grep -Fq -- '--started-by "$started_by"' "$runner"
grep -Fq 'started_by="u5c-${capacity_marker#U5C-}"' "$runner"
grep -Fq 'capacity_started_by="u5c-${marker#U5C-}"' \
  "$repo_root/infra/uat/run-a5-capacity-mutating.sh"
if grep -Fq 'launch_started_by=' "$runner"; then
  echo 'ERROR: exact recovery identity replaced the generic active-task fence' >&2
  exit 1
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/release-task-request-identity.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
commit=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
image="311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:$(printf 'c%.0s' {1..64})"
readonly_secret=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/a5-readonly-database-url-aaaaaa
boundary_a='{"awsvpcConfiguration":{"assignPublicIp":"ENABLED","securityGroups":["sg-11111111"],"subnets":["subnet-22222222","subnet-11111111"]}}'
boundary_reordered='{"awsvpcConfiguration":{"subnets":["subnet-11111111","subnet-22222222"],"securityGroups":["sg-11111111"],"assignPublicIp":"ENABLED"}}'
boundary_subnets='{"awsvpcConfiguration":{"assignPublicIp":"ENABLED","securityGroups":["sg-11111111"],"subnets":["subnet-11111111","subnet-33333333"]}}'
boundary_sg='{"awsvpcConfiguration":{"assignPublicIp":"ENABLED","securityGroups":["sg-22222222"],"subnets":["subnet-11111111","subnet-22222222"]}}'
boundary_private='{"awsvpcConfiguration":{"assignPublicIp":"DISABLED","securityGroups":["sg-11111111"],"subnets":["subnet-11111111","subnet-22222222"]}}'
network_a='{"awsvpcConfiguration":{"assignPublicIp":"ENABLED","securityGroups":["sg-11111111"],"subnets":["subnet-11111111"]}}'
network_b='{"awsvpcConfiguration":{"assignPublicIp":"ENABLED","securityGroups":["sg-11111111"],"subnets":["subnet-22222222"]}}'
network_sg='{"awsvpcConfiguration":{"assignPublicIp":"ENABLED","securityGroups":["sg-22222222"],"subnets":["subnet-11111111"]}}'

render_request() {
  local run_id="$1" run_attempt="$2" boundary="$3"
  env DEPLOY_ENV=production AWS_ACCOUNT_ID=311414082667 RELEASE_TASK_RENDER_ONLY=true \
    RELEASE_TASK_RENDER_NETWORK_JSON="$boundary" A5_READONLY_DATABASE_URL_SECRET_ARN="$readonly_secret" \
    RELEASE_DEPLOY_TARGET=all GITHUB_ACTIONS=true GITHUB_RUN_ID="$run_id" \
    GITHUB_RUN_ATTEMPT="$run_attempt" GITHUB_ACTOR=operator GITHUB_ACTOR_ID=456 \
    GITHUB_REPOSITORY=example/watchdog \
    GITHUB_WORKFLOW_REF='example/watchdog/.github/workflows/deploy-production.yml@refs/heads/main' \
    bash "$runner" "$image" "$commit" maintenance-preflight
}
request_id() {
  render_request "$@" | jq -er '.containerDefinitions[0].dockerLabels["com.watchdog-bms.release-request"]'
}

request_a="$(request_id 100 1 "$boundary_a")"
test "$request_a" = "$(request_id 100 1 "$boundary_a")"
test "$request_a" = "$(request_id 100 1 "$boundary_reordered")"
request_run="$(request_id 101 1 "$boundary_a")"
request_attempt="$(request_id 100 2 "$boundary_a")"
request_subnets="$(request_id 100 1 "$boundary_subnets")"
request_sg="$(request_id 100 1 "$boundary_sg")"
test "$request_a" != "$request_run"
test "$request_a" != "$request_attempt"
test "$request_a" != "$request_subnets"
test "$request_a" != "$request_sg"
[[ "$request_a" =~ ^[0-9a-f]{64}$ ]]
if render_request 100 1 "$boundary_private" >"$work/private.out" 2>"$work/private.err"; then
  echo 'ERROR: release request accepted a network boundary with assignPublicIp disabled' >&2
  exit 1
fi
jq -e --arg request "$request_a" \
  '.containerDefinitions[0].dockerLabels["com.watchdog-bms.release-request"]==$request' \
  <(render_request 100 1 "$boundary_a") >/dev/null

# Exercise the shared reconciler through the release caller's exact identity. Fake ECS accepts
# RunTask but loses every response: only the same logical request may recover that task.
cat > "$work/aws" <<'AWS'
#!/usr/bin/env bash
set -euo pipefail
command="$1 $2"
shift 2
records="$REQUEST_IDENTITY_STATE/records.json"
[ -f "$records" ] || printf '[]\n' > "$records"
value() {
  local wanted="$1"; shift
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "$wanted" ]; then printf '%s\n' "$2"; return 0; fi
    shift
  done
  return 1
}
case "$command" in
  'ecs list-tasks')
    started="$(value --started-by "$@" 2>/dev/null || true)"
    if [ -n "$started" ]; then
      jq -cn --argjson records "$(<"$records")" --arg started "$started" \
        '{taskArns:[$records[]|select(.startedBy==$started)|.taskArn]}'
    else
      jq -cn --argjson records "$(<"$records")" '{taskArns:[$records[].taskArn]}'
    fi
    ;;
  'ecs describe-tasks')
    requested='[]'
    while [ "$#" -gt 0 ]; do
      if [[ "$1" == arn:aws:ecs:*:task/* ]]; then
        requested="$(jq -cn --argjson current "$requested" --arg arn "$1" '$current+[$arn]')"
      fi
      shift
    done
    jq -cn --argjson records "$(<"$records")" --argjson requested "$requested" \
      '{tasks:[$records[]|select(.taskArn as $arn|any($requested[];.==$arn))],failures:[]}'
    ;;
  'ecs run-task')
    started="$(value --started-by "$@")"
    definition="$(value --task-definition "$@")"
    network="$(value --network-configuration "$@")"
    subnet="$(jq -er '.awsvpcConfiguration.subnets[0]' <<< "$network")"
    count="$(( $(jq 'length' "$records") + 1 ))"
    arn="arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/task-$count"
    jq -cn --argjson records "$(<"$records")" --arg arn "$arn" --arg started "$started" \
      --arg definition "$definition" --arg subnet "$subnet" '$records+[{
        taskArn:$arn,startedBy:$started,taskDefinitionArn:$definition,
        attachments:[{type:"ElasticNetworkInterface",details:[{name:"subnetId",value:$subnet}]}]}]' \
      > "$records.next"
    mv "$records.next" "$records"
    echo 'connection closed after RunTask acceptance' >&2
    exit 255
    ;;
  *) echo "unexpected fake AWS call: $command $*" >&2; exit 91 ;;
esac
AWS
chmod +x "$work/aws"
sha_text() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'
  else shasum -a 256 | awk '{print $1}'; fi
}
run_request() {
  local request="$1" revision="$2" network="$3" token definition
  definition="arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-task:$revision"
  token="$(printf '%s' "$request:$definition:$network" | sha_text)"
  AWS_BIN="$work/aws" REQUEST_IDENTITY_STATE="$work" RUN_TASK_IDEMPOTENT_ATTEMPTS=2 \
  RUN_TASK_IDEMPOTENT_INITIAL_DELAY_SECONDS=0 RUN_TASK_IDEMPOTENT_MAX_DELAY_SECONDS=0 \
    bash "$repo_root/infra/prod-ecs-express/run-task-idempotently.sh" "$token" -- ecs run-task \
      --cluster watchdog-bms-prod --task-definition "$definition" \
      --started-by watchdog-bms-prod-release \
      --launch-type FARGATE --network-configuration "$network" --region ap-southeast-1
}
run_request "$request_a" 7 "$network_a" > "$work/same-first.json" 2> "$work/same-first.err"
run_request "$request_a" 7 "$network_a" > "$work/same-retry.json"
test "$(jq 'length' "$work/records.json")" = 1
cmp -s "$work/same-first.json" "$work/same-retry.json"
run_request "$request_run" 8 "$network_a" >/dev/null 2> "$work/run-id.err"
run_request "$request_attempt" 9 "$network_a" >/dev/null 2> "$work/attempt.err"
# The changed full boundary still tries an overlapping subnet; the request-bound definition must
# prevent recovery of the previous task even though startedBy and the attempted subnet are equal.
run_request "$request_subnets" 10 "$network_a" >/dev/null 2> "$work/subnet-boundary.err"
run_request "$request_sg" 11 "$network_sg" >/dev/null 2> "$work/security-group.err"
# A later subnet attempt in the same reviewed boundary remains a separate RunTask request.
run_request "$request_a" 7 "$network_b" >/dev/null 2> "$work/subnet-attempt.err"
test "$(jq 'length' "$work/records.json")" = 6
jq -e '[.[].startedBy]|unique==["watchdog-bms-prod-release"]' "$work/records.json" >/dev/null
test "$(jq '[.[].taskDefinitionArn]|unique|length' "$work/records.json")" = 5
bash -n "$runner"

echo 'release-task network failover specs passed'
