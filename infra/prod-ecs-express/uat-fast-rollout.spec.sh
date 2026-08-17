#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
# shellcheck source=infra/prod-ecs-express/lib-uat-fast-rollout.sh
. "$repo_root/infra/prod-ecs-express/lib-uat-fast-rollout.sh"

fixture="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-uat-fast-rollout.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT
calls="$fixture/calls"
reads="$fixture/reads"
service=watchdog-bms-uat-api-web
export DEPLOY_ENV=uat CLUSTER_NAME=watchdog-bms-uat REGION=ap-southeast-1 RESOURCE_PREFIX=watchdog-bms-uat

snapshot() {
  local bake="$1" canary_bake="$2" state="${3:-COMPLETED}"
  jq -cn --arg service "$service" --arg alarm "watchdog-bms-uat/${service}/RollbackAlarm" \
    --arg state "$state" --argjson bake "$bake" --argjson canaryBake "$canary_bake" '{
      failures:[], services:[{
        serviceName:$service,status:"ACTIVE",deploymentController:{type:"ECS"},
        deployments:[{status:"PRIMARY",rolloutState:$state}],
        deploymentConfiguration:{
          deploymentCircuitBreaker:{enable:true,rollback:true,resetOnHealthyTask:true,thresholdConfiguration:{type:"BOUNDED_PERCENT",value:50}},
          maximumPercent:200,minimumHealthyPercent:100,
          alarms:{alarmNames:[$alarm],rollback:true,enable:true},
          strategy:"CANARY",bakeTimeInMinutes:$bake,
          canaryConfiguration:{canaryPercent:5,canaryBakeTimeInMinutes:$canaryBake}
        }
      }]
    }'
}

aws_cmd() {
  printf '%s\n' "$*" >> "$calls"
  case "$1 $2" in
    "ecs describe-services")
      read_count="$(( $(cat "$reads" 2>/dev/null || echo 0) + 1 ))"
      printf '%s\n' "$read_count" > "$reads"
      if [ -f "$fixture/describe-$read_count.json" ]; then
        cat "$fixture/describe-$read_count.json"
      else
        cat "$fixture/describe.json"
      fi
      ;;
    "ecs update-service")
      snapshot 0 0 | jq '.services[0].deploymentConfiguration'
      snapshot 0 0 > "$fixture/describe.json"
      ;;
    "ecs wait") ;;
    *) echo "unexpected AWS call: $*" >&2; return 64 ;;
  esac
}

sleep() { :; }

snapshot 3 3 > "$fixture/describe.json"
: > "$reads"
ensure_uat_fast_rollout_configuration "$service"
grep -q 'ecs update-service' "$calls"
grep -q 'ecs wait services-stable' "$calls"
test "$(jq '.services[0].deploymentConfiguration.bakeTimeInMinutes' "$fixture/describe.json")" = 0
test "$(jq '.services[0].deploymentConfiguration.canaryConfiguration.canaryBakeTimeInMinutes' "$fixture/describe.json")" = 0
test "$(jq -c '.services[0].deploymentConfiguration.alarms' "$fixture/describe.json")" = \
  '{"alarmNames":["watchdog-bms-uat/watchdog-bms-uat-api-web/RollbackAlarm"],"rollback":true,"enable":true}'
test "$(jq -c '.services[0].deploymentConfiguration.deploymentCircuitBreaker' "$fixture/describe.json")" = \
  '{"enable":true,"rollback":true,"resetOnHealthyTask":true,"thresholdConfiguration":{"type":"BOUNDED_PERCENT","value":50}}'

: > "$calls"
: > "$reads"
ensure_uat_fast_rollout_configuration "$service"
! grep -q 'ecs update-service' "$calls"
grep -q 'ecs wait services-stable' "$calls"

# ECS Express and the standard waiter may finish before describe-services removes the
# draining deployment. Verification must require two agreeing stable reads after that race.
snapshot 0 0 > "$fixture/describe.json"
snapshot 0 0 | jq '.services[0].deployments += [{status:"ACTIVE",rolloutState:"IN_PROGRESS"}]' \
  > "$fixture/describe-1.json"
: > "$calls"
: > "$reads"
verify_uat_fast_rollout_configuration "$service"
grep -q 'ecs wait services-stable' "$calls"
test "$(cat "$reads")" -eq 3
rm -f "$fixture/describe-1.json"

# A persistent transition exhausts the bounded window; it is never accepted as stable.
snapshot 0 0 | jq '.services[0].deployments += [{status:"ACTIVE",rolloutState:"IN_PROGRESS"}]' \
  > "$fixture/describe.json"
: > "$reads"
if UAT_FAST_ROLLOUT_POLL_ATTEMPTS=3 UAT_FAST_ROLLOUT_POLL_SECONDS=0 \
  verify_uat_fast_rollout_configuration "$service" >/dev/null 2>&1; then
  echo "ERROR: persistent transition was accepted" >&2
  exit 1
fi
test "$(cat "$reads")" -eq 3

# Reviewed-control drift is decisive and must not be hidden by retrying it.
snapshot 0 0 | jq '.services[0].deploymentConfiguration.strategy="ROLLING"' > "$fixture/describe.json"
: > "$reads"
if verify_uat_fast_rollout_configuration "$service" >/dev/null 2>&1; then
  echo "ERROR: rollout-control drift was accepted" >&2
  exit 1
fi
test "$(cat "$reads")" -eq 1

snapshot 3 3 IN_PROGRESS > "$fixture/describe.json"
: > "$reads"
if ensure_uat_fast_rollout_configuration "$service" >/dev/null 2>&1; then
  echo "ERROR: moving service was accepted" >&2
  exit 1
fi

: > "$calls"
DEPLOY_ENV=production ensure_uat_fast_rollout_configuration "$service"
test ! -s "$calls"

echo "UAT fast rollout: pass"
