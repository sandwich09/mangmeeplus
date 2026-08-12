#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
helper="$repo_root/infra/prod-ecs-express/cleanup-one-shot-task.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-bms-one-shot-cleanup-spec.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT

cat > "$work/aws" <<'AWS'
#!/usr/bin/env bash
set -euo pipefail
command="$1 $2"
shift 2
state="${ONE_SHOT_TEST_STATE:?}"
mkdir -p "$state"
value() {
  local wanted="$1"; shift
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "$wanted" ]; then printf '%s\n' "$2"; return 0; fi
    shift
  done
  return 1
}
next_count() {
  local name="$1" count=0
  [ ! -f "$state/$name" ] || count="$(<"$state/$name")"
  count=$((count+1))
  printf '%s\n' "$count" > "$state/$name"
  printf '%s\n' "$count"
}
family=watchdog-a5-production-apply-90-a1
definition="arn:aws:ecs:ap-southeast-1:311414082667:task-definition/$family:7"
near_definition="arn:aws:ecs:ap-southeast-1:311414082667:task-definition/${family}-other:1"
task="arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/task-1"
task_two="arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/task-2"
task_state() { [ -f "$state/stopped-$1" ] && printf STOPPED || printf RUNNING; }
definition_state() { [ -f "$state/deregistered" ] && printf INACTIVE || printf ACTIVE; }

case "$command" in
  'ecs list-tasks')
    [ "$ONE_SHOT_TEST_MODE" != denied ] || { echo 'AccessDenied: ListTasks' >&2; exit 254; }
    count="$(next_count list-task-count)"
    arns='[]'
    case "$ONE_SHOT_TEST_MODE" in
      accepted-lost)
        [ "$count" -lt 3 ] || arns="$(jq -cn --arg arn "$task" '[ $arn ]')" ;;
      known|collision|stop-response-lost|wrong-started-by|wrong-group|wrong-definition|malformed)
        arns="$(jq -cn --arg one "$task" --arg two "$task_two" \
          'if $ENV.ONE_SHOT_TEST_MODE=="collision" then [$one,$two] else [$one] end')" ;;
      invisible) ;;
      *) exit 90 ;;
    esac
    # Only the startedBy query discovers active tasks in this fixture. STOPPED-family queries are
    # empty because the exact task has not completed independently of this cleanup.
    if value --desired-status "$@" >/dev/null 2>&1; then arns='[]'; fi
    jq -cn --argjson arns "$arns" '{taskArns:$arns}' ;;
  'ecs describe-tasks')
    [ "$ONE_SHOT_TEST_MODE" != malformed ] || { printf '{}\n'; exit 0; }
    tasks='[]'
    while [ "$#" -gt 0 ]; do
      case "$1" in
        "$task"|"$task_two")
          status="$(task_state "${1##*-}")"
          started=a5apply-90-a1
          group=family:watchdog-a5-production-apply-90-a1
          described_definition="$definition"
          case "$ONE_SHOT_TEST_MODE" in
            wrong-started-by) started=foreign ;;
            wrong-group) group=family:watchdog-a5-production-apply-90-a1-other ;;
            wrong-definition) described_definition="${definition%:*}:8" ;;
          esac
          tasks="$(jq -cn --argjson current "$tasks" --arg arn "$1" --arg definition "$described_definition" \
            --arg status "$status" --arg started "$started" --arg group "$group" '$current+[{taskArn:$arn,
              clusterArn:"arn:aws:ecs:ap-southeast-1:311414082667:cluster/watchdog-bms-prod",
              startedBy:$started,group:$group,
              taskDefinitionArn:$definition,lastStatus:$status,desiredStatus:$status}]')" ;;
      esac
      shift
    done
    jq -cn --argjson tasks "$tasks" '{tasks:$tasks,failures:[]}' ;;
  'ecs stop-task')
    arn="$(value --task "$@")"
    touch "$state/stopped-${arn##*-}"
    printf '%s\n' "$arn" >> "$state/stopped"
    [ "$ONE_SHOT_TEST_MODE" != stop-response-lost ] \
      || { echo 'connection closed after StopTask acceptance' >&2; exit 255; }
    jq -cn --arg arn "$arn" '{task:{taskArn:$arn}}' ;;
  'ecs wait') exit 0 ;;
  'ecs list-task-definitions')
    count="$(next_count list-definition-count)"
    arns="$(jq -cn --arg near "$near_definition" '[ $near ]')"
    case "$ONE_SHOT_TEST_MODE" in
      accepted-lost) [ "$count" -lt 3 ] || [ -f "$state/deregistered" ] \
        || arns="$(jq -cn --arg exact "$definition" --arg near "$near_definition" '[$exact,$near]')" ;;
      known|collision|stop-response-lost|wrong-started-by|wrong-group|wrong-definition|malformed|denied) \
        [ -f "$state/deregistered" ] \
        || arns="$(jq -cn --arg exact "$definition" --arg near "$near_definition" '[$exact,$near]')" ;;
      invisible) ;;
    esac
    jq -cn --argjson arns "$arns" '{taskDefinitionArns:$arns}' ;;
  'ecs describe-task-definition')
    status="$(definition_state)"
    jq -cn --arg arn "$definition" --arg family "$family" --arg status "$status" \
      '{taskDefinition:{taskDefinitionArn:$arn,family:$family,status:$status}}' ;;
  'ecs deregister-task-definition')
    arn="$(value --task-definition "$@")"
    [ "$arn" = "$definition" ]
    touch "$state/deregistered"
    printf '%s\n' "$arn" >> "$state/deregistered-arns"
    jq -cn --arg arn "$arn" '{taskDefinition:{taskDefinitionArn:$arn,status:"INACTIVE"}}' ;;
  *) echo "unexpected fake AWS call: $command $*" >&2; exit 91 ;;
esac
AWS
chmod +x "$work/aws"

definition='arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-a5-production-apply-90-a1:7'
task='arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/task-1'
run_cleanup() {
  local mode="$1" definition_arn="$2" task_arn="$3" state
  state="$work/$mode-state"
  mkdir -p "$state"
  AWS_BIN="$work/aws" ONE_SHOT_TEST_MODE="$mode" ONE_SHOT_TEST_STATE="$state" \
  ONE_SHOT_CLEANUP_VISIBILITY_CHECKS=3 ONE_SHOT_CLEANUP_VISIBILITY_DELAY_SECONDS=0 \
  ONE_SHOT_CLEANUP_STABLE_EMPTY_CHECKS=3 ONE_SHOT_CLEANUP_STABLE_DELAY_SECONDS=0 \
    bash "$helper" 311414082667 ap-southeast-1 watchdog-bms-prod \
      watchdog-a5-production-apply-90-a1 a5apply-90-a1 true "$definition_arn" \
      true "$task_arn" production-a5-reviewed-apply-cleanup
}

# RunTask/RegisterTaskDefinition were accepted, but neither response returned an ARN. Cleanup must
# discover the mutating apply task only when it becomes visible later, stop it, and retire its family.
run_cleanup accepted-lost "$definition" -
test "$(wc -l < "$work/accepted-lost-state/stopped" | tr -d ' ')" = 1
test "$(wc -l < "$work/accepted-lost-state/deregistered-arns" | tr -d ' ')" = 1
test "$(<"$work/accepted-lost-state/list-task-count")" -ge 5

# RegisterTaskDefinition can be accepted while its response is lost before RunTask is attempted.
# With no possible task, cleanup must still reconcile and retire the exact family revision.
registration_state="$work/registration-only-state"
mkdir -p "$registration_state"
AWS_BIN="$work/aws" ONE_SHOT_TEST_MODE=accepted-lost ONE_SHOT_TEST_STATE="$registration_state" \
ONE_SHOT_CLEANUP_VISIBILITY_CHECKS=3 ONE_SHOT_CLEANUP_VISIBILITY_DELAY_SECONDS=0 \
ONE_SHOT_CLEANUP_STABLE_EMPTY_CHECKS=3 ONE_SHOT_CLEANUP_STABLE_DELAY_SECONDS=0 \
  bash "$helper" 311414082667 ap-southeast-1 watchdog-bms-prod \
    watchdog-a5-production-apply-90-a1 a5apply-90-a1 true - false - \
    production-a5-reviewed-apply-cleanup
test ! -e "$registration_state/stopped"
test "$(wc -l < "$registration_state/deregistered-arns" | tr -d ' ')" = 1

run_cleanup invisible "$definition" -
test ! -e "$work/invisible-state/stopped"
test "$(wc -l < "$work/invisible-state/deregistered-arns" | tr -d ' ')" = 1
test "$(<"$work/invisible-state/list-task-count")" = 12
test "$(<"$work/invisible-state/list-definition-count")" -ge 3

run_cleanup known "$definition" "$task"
test "$(wc -l < "$work/known-state/stopped" | tr -d ' ')" = 1
test "$(wc -l < "$work/known-state/deregistered-arns" | tr -d ' ')" = 1

if run_cleanup collision "$definition" "$task"; then
  echo 'ERROR: cleanup accepted more than one exact task for one logical request' >&2
  exit 1
fi
test "$(sort -u "$work/collision-state/stopped" | wc -l | tr -d ' ')" = 2
test "$(wc -l < "$work/collision-state/deregistered-arns" | tr -d ' ')" = 1

if run_cleanup stop-response-lost "$definition" "$task"; then
  echo 'ERROR: cleanup erased an accepted-but-response-lost StopTask failure' >&2
  exit 1
fi
test "$(wc -l < "$work/stop-response-lost-state/stopped" | tr -d ' ')" = 1
test "$(wc -l < "$work/stop-response-lost-state/deregistered-arns" | tr -d ' ')" = 1

for mode in wrong-started-by wrong-group wrong-definition malformed denied; do
  if run_cleanup "$mode" "$definition" "$task"; then
    echo "ERROR: cleanup accepted unavailable/foreign task identity: $mode" >&2
    exit 1
  fi
  test ! -e "$work/$mode-state/stopped"
  test ! -e "$work/$mode-state/deregistered-arns"
done

status_probe="$work/status-probe.sh"
cat > "$status_probe" <<'PROBE'
#!/usr/bin/env bash
set -euo pipefail
cleanup() {
  local status=$?
  AWS_BIN="$AWS_BIN" bash "$HELPER" 311414082667 ap-southeast-1 watchdog-bms-prod \
    watchdog-a5-production-apply-90-a1 a5apply-90-a1 false - false - \
    production-a5-reviewed-apply-cleanup || status=1
  exit "$status"
}
trap cleanup EXIT
exit 73
PROBE
chmod +x "$status_probe"
set +e
AWS_BIN="$work/aws" HELPER="$helper" bash "$status_probe"
probe_status=$?
set -e
test "$probe_status" = 73

bash -n "$helper"
echo 'one-shot ECS task cleanup specs passed'
