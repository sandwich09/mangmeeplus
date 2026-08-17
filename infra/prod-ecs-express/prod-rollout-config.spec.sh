#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
# shellcheck source=infra/prod-ecs-express/lib-uat-fast-rollout.sh
. "$repo_root/infra/prod-ecs-express/lib-uat-fast-rollout.sh"
# shellcheck source=infra/prod-ecs-express/lib-prod-rollout-config.sh
. "$repo_root/infra/prod-ecs-express/lib-prod-rollout-config.sh"
# shellcheck source=infra/prod-ecs-express/lib-wait-for-service-url.sh
. "$repo_root/infra/prod-ecs-express/lib-wait-for-service-url.sh"

fixture="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-prod-rollout-config.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT
calls="$fixture/calls"
reads="$fixture/reads"
service=watchdog-bms-api-web-pub
export DEPLOY_ENV=production CLUSTER_NAME=watchdog-bms-prod REGION=ap-southeast-1 \
  RESOURCE_PREFIX=watchdog-bms-prod
expect_bake=0
expect_canary_bake=0

snapshot() {
  local bake="$1" canary_bake="$2" state="${3:-COMPLETED}"
  jq -cn --arg service "$service" --arg alarm "watchdog-bms-prod/${service}/RollbackAlarm" \
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
      snapshot "$expect_bake" "$expect_canary_bake" | jq '.services[0].deploymentConfiguration'
      snapshot "$expect_bake" "$expect_canary_bake" > "$fixture/describe.json"
      ;;
    "ecs wait") ;;
    *) echo "unexpected AWS call: $*" >&2; return 64 ;;
  esac
}

sleep() { :; }

assert_refused() {
  local label="$1" expected="$2"
  shift 2
  if "$@" >"$fixture/$label.log" 2>&1; then
    echo "ERROR: $label was accepted" >&2
    exit 1
  fi
  grep -Fq "$expected" "$fixture/$label.log"
  if grep -q 'ecs update-service' "$calls"; then
    echo "ERROR: $label still mutated rollout timing" >&2
    exit 1
  fi
}

# Live read-back (2026-08-17): all three production services sit at canaryBake=3, bake=3. Live keeps
# the only bake with real detection power and drops the canary bake.
expect_bake=3
expect_canary_bake=0
export PRODUCTION_SERVING_MODE=live
snapshot 3 3 > "$fixture/describe.json"
: > "$calls"
: > "$reads"
ensure_prod_rollout_configuration "$service"
grep -q 'ecs update-service' "$calls"
grep -q 'ecs wait services-stable' "$calls"
test "$(jq '.services[0].deploymentConfiguration.bakeTimeInMinutes' "$fixture/describe.json")" = 3
test "$(jq '.services[0].deploymentConfiguration.canaryConfiguration.canaryBakeTimeInMinutes' "$fixture/describe.json")" = 0
test "$(jq -c '.services[0].deploymentConfiguration.alarms' "$fixture/describe.json")" = \
  '{"alarmNames":["watchdog-bms-prod/watchdog-bms-api-web-pub/RollbackAlarm"],"rollback":true,"enable":true}'
test "$(jq -c '.services[0].deploymentConfiguration.deploymentCircuitBreaker' "$fixture/describe.json")" = \
  '{"enable":true,"rollback":true,"resetOnHealthyTask":true,"thresholdConfiguration":{"type":"BOUNDED_PERCENT","value":50}}'
test "$(jq '.services[0].deploymentConfiguration.canaryConfiguration.canaryPercent' "$fixture/describe.json")" = 5
test "$(jq -r '.services[0].deploymentConfiguration.strategy' "$fixture/describe.json")" = CANARY

# Already at the desired timing: read and verify, never write.
: > "$calls"
: > "$reads"
ensure_prod_rollout_configuration "$service"
! grep -q 'ecs update-service' "$calls"
grep -q 'ecs wait services-stable' "$calls"

# No customer traffic in either maintenance shape: both bakes go to zero.
for mode in maintenance_only maintenance_closed; do
  expect_bake=0
  expect_canary_bake=0
  PRODUCTION_SERVING_MODE="$mode"
  snapshot 3 3 > "$fixture/describe.json"
  : > "$calls"
  : > "$reads"
  ensure_prod_rollout_configuration "$service"
  grep -q 'ecs update-service' "$calls"
  test "$(jq '.services[0].deploymentConfiguration.bakeTimeInMinutes' "$fixture/describe.json")" = 0
  test "$(jq '.services[0].deploymentConfiguration.canaryConfiguration.canaryBakeTimeInMinutes' "$fixture/describe.json")" = 0
done
PRODUCTION_SERVING_MODE=live

# A wrong or missing mode silently changes the safety posture, so it is never defaulted.
for bad_mode in '' maintenance closed LIVE; do
  snapshot 3 3 > "$fixture/describe.json"
  : > "$calls"
  : > "$reads"
  PRODUCTION_SERVING_MODE="$bad_mode" assert_refused "mode-${bad_mode:-unset}" \
    'PRODUCTION_SERVING_MODE must be maintenance_closed, maintenance_only or live' \
    ensure_prod_rollout_configuration "$service"
done

# Reviewed canary/rollback controls are a precondition for touching timing at all.
snapshot 3 3 | jq 'del(.services[0].deploymentConfiguration.alarms)' > "$fixture/describe.json"
: > "$calls"
: > "$reads"
assert_refused missing-alarm \
  'refusing to change rollout timing for an unstable or drifted production service' \
  ensure_prod_rollout_configuration "$service"

snapshot 3 3 | jq '.services[0].deploymentConfiguration.strategy="ROLLING"' > "$fixture/describe.json"
: > "$calls"
: > "$reads"
assert_refused wrong-strategy \
  'refusing to change rollout timing for an unstable or drifted production service' \
  ensure_prod_rollout_configuration "$service"

snapshot 3 3 IN_PROGRESS > "$fixture/describe.json"
: > "$calls"
: > "$reads"
assert_refused moving-service \
  'refusing to change rollout timing for an unstable or drifted production service' \
  ensure_prod_rollout_configuration "$service"

# ECS Express and the standard waiter may finish before describe-services removes the draining
# deployment. Verification must require two agreeing stable reads after that race.
snapshot 3 0 > "$fixture/describe.json"
snapshot 3 0 | jq '.services[0].deployments += [{status:"ACTIVE",rolloutState:"IN_PROGRESS"}]' \
  > "$fixture/describe-1.json"
: > "$calls"
: > "$reads"
verify_prod_rollout_configuration "$service"
grep -q 'ecs wait services-stable' "$calls"
test "$(cat "$reads")" -eq 3
rm -f "$fixture/describe-1.json"

# Timing that did not persist is decisive, and retrying cannot hide it.
snapshot 3 3 > "$fixture/describe.json"
: > "$calls"
: > "$reads"
if verify_prod_rollout_configuration "$service" >/dev/null 2>&1; then
  echo "ERROR: unpersisted rollout timing was accepted" >&2
  exit 1
fi
test "$(cat "$reads")" -eq 1

# UAT runs the fast-rollout helper instead; this one must stay inert outside production.
snapshot 3 3 > "$fixture/describe.json"
: > "$calls"
DEPLOY_ENV=uat ensure_prod_rollout_configuration "$service"
DEPLOY_ENV=uat verify_prod_rollout_configuration "$service"
test ! -s "$calls"

# Poll cadence: 5s through the first two minutes, 15s after, same attempts x 20s ceiling.
test "$(deployment_poll_delay 0)" = 5
test "$(deployment_poll_delay 115)" = 5
test "$(deployment_poll_delay 120)" = 15
test "$(deployment_poll_delay 1485)" = 15
poll_schedule() {
  local ceiling="$1" elapsed=0 delay count=0 fast=0
  while [ "$elapsed" -lt "$ceiling" ]; do
    delay="$(deployment_poll_delay "$elapsed")"
    if [ "$delay" -eq 5 ]; then fast=$((fast + 1)); fi
    elapsed=$((elapsed + delay))
    count=$((count + 1))
  done
  printf '%s %s %s' "$count" "$elapsed" "$fast"
}
# Production: DEPLOYMENT_POLL_ATTEMPTS=75 keeps the 1500s (25m) ceiling exactly.
test "$(poll_schedule $((75 * 20)))" = "116 1500 24"
# UAT default: DEPLOYMENT_POLL_ATTEMPTS=90 keeps the 1800s ceiling exactly.
test "$(poll_schedule $((90 * 20)))" = "136 1800 24"
# The shortest legal ceiling still polls.
test "$(poll_schedule $((1 * 20)))" = "4 20 4"

echo "Production rollout config: pass"
