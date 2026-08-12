#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
helper="$repo_root/infra/prod-ecs-express/run-task-idempotently.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-bms-run-task-spec.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT

cat > "$work/aws" <<'AWS'
#!/usr/bin/env bash
set -euo pipefail
command="$1 $2"
shift 2
value() {
  local wanted="$1"; shift
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "$wanted" ]; then printf '%s\n' "$2"; return 0; fi
    shift
  done
  return 1
}
task_arn="arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/task-1"
task_arn_two="arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/task-2"
definition="arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-task:7"
subnet="${RUN_TASK_TEST_TASK_SUBNET:-subnet-11111111}"
case "$command" in
  'ecs list-tasks')
    if [ "$RUN_TASK_TEST_MODE" = reconciliation-denied ]; then
      echo 'AccessDenied: ListTasks' >&2; exit 254
    fi
    started_by="$(value --started-by "$@" 2>/dev/null || true)"
    desired_status="$(value --desired-status "$@" 2>/dev/null || true)"
    arns='[]'
    if [ "$started_by" = stable-start ]; then
      case "$RUN_TASK_TEST_MODE" in
        preexisting|collision) arns="$(jq -cn --arg one "$task_arn" --arg two "$task_arn_two" \
          'if $ENV.RUN_TASK_TEST_MODE=="collision" then [$one,$two] else [$one] end')" ;;
        accepted-lost)
          [ -e "$RUN_TASK_TEST_ACCEPTED" ] && arns="$(jq -cn --arg arn "$task_arn" '[$arn]')" ;;
      esac
    elif [ "$desired_status" = STOPPED ] && [ "$RUN_TASK_TEST_MODE" = preexisting-stopped ]; then
      arns="$(jq -cn --arg arn "$task_arn" '[$arn]')"
    fi
    jq -cn --argjson arns "$arns" '{taskArns:$arns}' ;;
  'ecs describe-tasks')
    tasks='[]'
    while [ "$#" -gt 0 ]; do
      if [[ "$1" == arn:aws:ecs:*:task/* ]]; then
        tasks="$(jq -cn --argjson current "$tasks" --arg arn "$1" --arg definition "$definition" \
          --arg subnet "$subnet" \
          '$current+[{taskArn:$arn,startedBy:"stable-start",taskDefinitionArn:$definition,
            attachments:[{type:"ElasticNetworkInterface",details:[{name:"subnetId",value:$subnet}]}]}]')"
      fi
      shift
    done
    jq -cn --argjson tasks "$tasks" '{tasks:$tasks,failures:[]}' ;;
  'ecs run-task')
    token="$(value --client-token "$@")"
    printf '%s\n' "$token" >> "$RUN_TASK_TEST_TOKENS"
    case "$RUN_TASK_TEST_MODE" in
      accepted-lost)
        printf '%s\n' "$token" > "$RUN_TASK_TEST_ACCEPTED"
        echo 'connection closed after request acceptance' >&2
        exit 255 ;;
      immediate-success|preexisting) ;;
      malformed) printf '{}\n'; exit 0 ;;
      always-fail|accepted-invisible)
        [ "$RUN_TASK_TEST_MODE" != accepted-invisible ] || printf '%s\n' "$token" > "$RUN_TASK_TEST_ACCEPTED"
        echo 'aws: [ERROR]: unavailable' >&2
        exit 254 ;;
      *) exit 90 ;;
    esac
    jq -cn --arg arn "$task_arn" '{tasks:[{taskArn:$arn}],failures:[]}' ;;
  *) echo "unexpected fake AWS call: $command $*" >&2; exit 91 ;;
esac
AWS
chmod +x "$work/aws"

definition='arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-task:7'
run_helper() {
  AWS_BIN="$work/aws" \
  RUN_TASK_TEST_MODE="$1" \
  RUN_TASK_TEST_TOKENS="$work/tokens" \
  RUN_TASK_TEST_ACCEPTED="$work/accepted" \
  RUN_TASK_IDEMPOTENT_ATTEMPTS="${2:-3}" \
  RUN_TASK_IDEMPOTENT_INITIAL_DELAY_SECONDS=0 \
  RUN_TASK_IDEMPOTENT_MAX_DELAY_SECONDS=0 \
    bash "$helper" stable_token_1 -- ecs run-task --cluster watchdog-bms-prod \
      --task-definition "$definition" --started-by stable-start --launch-type FARGATE \
      --network-configuration '{"awsvpcConfiguration":{"subnets":["subnet-11111111"]}}' \
      --region ap-southeast-1
}
run_helper_two_subnets() {
  AWS_BIN="$work/aws" RUN_TASK_TEST_MODE="$1" RUN_TASK_TEST_TOKENS="$work/tokens" \
  RUN_TASK_TEST_ACCEPTED="$work/accepted" RUN_TASK_IDEMPOTENT_INITIAL_DELAY_SECONDS=0 \
  RUN_TASK_IDEMPOTENT_MAX_DELAY_SECONDS=0 \
    bash "$helper" stable_token_1 -- ecs run-task --cluster watchdog-bms-prod \
      --task-definition "$definition" --started-by stable-start --launch-type FARGATE \
      --network-configuration '{"awsvpcConfiguration":{"subnets":["subnet-11111111","subnet-22222222"]}}' \
      --region ap-southeast-1
}

reset_fixture() { rm -f "$work/tokens" "$work/accepted"; }

reset_fixture
run_helper accepted-lost > "$work/accepted-result.json" 2> "$work/accepted.err"
jq -e '.failures==[] and (.tasks|length)==1 and .tasks[0].startedBy=="stable-start"' \
  "$work/accepted-result.json" >/dev/null
test "$(wc -l < "$work/tokens" | tr -d ' ')" = 1

for mode in preexisting preexisting-stopped; do
  reset_fixture
  run_helper "$mode" > "$work/$mode.json"
  jq -e '.failures==[] and (.tasks|length)==1' "$work/$mode.json" >/dev/null
  test ! -e "$work/tokens"
done

reset_fixture
RUN_TASK_TEST_TASK_SUBNET=subnet-22222222 run_helper_two_subnets preexisting \
  > "$work/preexisting-subnet-set.json"
jq -e '.failures==[] and (.tasks|length)==1' "$work/preexisting-subnet-set.json" >/dev/null
test ! -e "$work/tokens"

reset_fixture
RUN_TASK_TEST_TASK_SUBNET=subnet-22222222 run_helper preexisting > "$work/other-subnet.json"
jq -e '.failures==[] and (.tasks|length)==1' "$work/other-subnet.json" >/dev/null
test "$(wc -l < "$work/tokens" | tr -d ' ')" = 1

reset_fixture
run_helper immediate-success > "$work/success.json"
jq -e '.failures==[] and (.tasks|length)==1' "$work/success.json" >/dev/null
test "$(wc -l < "$work/tokens" | tr -d ' ')" = 1

reset_fixture
if run_helper malformed 2 > "$work/malformed.out" 2> "$work/malformed.err"; then
  echo 'ERROR: malformed RunTask result was accepted' >&2
  exit 1
fi
grep -Fq 'returned malformed JSON; reconciling' "$work/malformed.err"

for mode in always-fail accepted-invisible; do
  reset_fixture
  set +e
  run_helper "$mode" 2 > "$work/$mode.out" 2> "$work/$mode.err"
  status=$?
  set -e
  test "$status" = 254
  test "$(wc -l < "$work/tokens" | tr -d ' ')" = 2
  test "$(sort -u "$work/tokens" | wc -l | tr -d ' ')" = 1
  grep -Fq 'did not return its result after 2 attempts' "$work/$mode.err"
done

for mode in reconciliation-denied collision; do
  reset_fixture
  if run_helper "$mode" > /dev/null 2> "$work/$mode.err"; then
    echo "ERROR: $mode reconciliation was accepted" >&2
    exit 1
  fi
  test ! -e "$work/tokens"
  grep -Fq 'reconciliation authority or identity is unavailable before RunTask' "$work/$mode.err"
done

if bash "$helper" 'bad token' -- ecs run-task >/dev/null 2>&1; then
  echo 'ERROR: unsafe client token was accepted' >&2
  exit 1
fi
if bash "$helper" stable_token -- ecs run-task --client-token duplicate >/dev/null 2>&1; then
  echo 'ERROR: duplicate client token was accepted' >&2
  exit 1
fi

bash -n "$helper"
grep -Fq 'AWS_RETRY_MODE=standard AWS_MAX_ATTEMPTS=2' "$helper"
grep -Fq -- '--cli-connect-timeout 5 --cli-read-timeout 10' "$helper"
grep -Fq 'RUN_TASK_IDEMPOTENT_DEADLINE_SECONDS:-300' "$helper"
grep -Fq -- '--desired-status STOPPED' "$helper"
echo 'idempotent ECS RunTask specs passed'
