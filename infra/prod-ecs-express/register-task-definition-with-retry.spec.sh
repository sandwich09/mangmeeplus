#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
helper="$repo_root/infra/prod-ecs-express/register-task-definition-with-retry.sh"
runner="$repo_root/infra/prod-ecs-express/run-release-task.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-bms-register-task-spec.XXXXXX")"
trap 'rm -rf "$work"' EXIT
family=watchdog-bms-uat-release-task
arn="arn:aws:ecs:ap-southeast-1:311414082667:task-definition/$family:99"
jq -cnS --arg family "$family" '{family:$family,networkMode:"awsvpc",
  containerDefinitions:[{name:"release",image:("example.invalid/image@sha256:"+("a"*64)),essential:true}]}' \
  > "$work/task.json"

cat > "$work/aws" <<'AWS'
#!/usr/bin/env bash
set -euo pipefail
test "$1" = ecs
operation="$2"
case "$operation" in
  list-task-definitions)
    if [ "$AWS_REGISTER_TEST_MODE" = list-denied ]; then
      echo 'aws: [ERROR]: AccessDeniedException: denied' >&2
      exit 254
    fi
    if [ -e "$AWS_REGISTER_TEST_RECOVERED" ]; then
      jq -cn --arg arn "$AWS_REGISTER_TEST_ARN" '[$arn]'
    else
      printf '[]\n'
    fi
    ;;
  describe-task-definition)
    if [ "$AWS_REGISTER_TEST_MODE" = preexisting-extra ]; then
      jq -c --arg arn "$AWS_REGISTER_TEST_ARN" '
        .containerDefinitions += [{name:"unexpected",image:"malicious"}]
        |{taskDefinition:(. + {taskDefinitionArn:$arn,revision:99,status:"ACTIVE"})}
      ' "$AWS_REGISTER_TEST_INPUT"
    elif [ "$AWS_REGISTER_TEST_MODE" = preexisting-task-role ]; then
      jq -c --arg arn "$AWS_REGISTER_TEST_ARN" '
        {taskDefinition:(. + {taskRoleArn:"arn:aws:iam::311414082667:role/unexpected",
          taskDefinitionArn:$arn,revision:99,status:"ACTIVE"})}
      ' "$AWS_REGISTER_TEST_INPUT"
    elif [ "$AWS_REGISTER_TEST_MODE" = preexisting-tagged ]; then
      jq -c --arg arn "$AWS_REGISTER_TEST_ARN" \
        '{taskDefinition:(. + {taskDefinitionArn:$arn,revision:99,status:"ACTIVE"}),
          tags:[{key:"provenance",value:"wrong"}]}' "$AWS_REGISTER_TEST_INPUT"
    else
      jq -c --arg arn "$AWS_REGISTER_TEST_ARN" \
        '{taskDefinition:(. + {taskDefinitionArn:$arn,revision:99,status:"ACTIVE",
          requiresAttributes:[],compatibilities:["FARGATE"],enableFaultInjection:false}
          |.containerDefinitions[0] += {cpu:0,memory:0,memoryReservation:0,
            versionConsistency:"enabled",
            disableNetworking:false,privileged:false,readonlyRootFilesystem:false,
            interactive:false,pseudoTerminal:false,portMappings:[],environment:[],
            environmentFiles:[],mountPoints:[],volumesFrom:[],ulimits:[],systemControls:[]})}' \
        "$AWS_REGISTER_TEST_INPUT"
    fi
    ;;
  register-task-definition)
    count=0
    [ ! -f "$AWS_REGISTER_TEST_COUNT" ] || count="$(cat "$AWS_REGISTER_TEST_COUNT")"
    count=$((count + 1))
    printf '%s\n' "$count" > "$AWS_REGISTER_TEST_COUNT"
    case "$AWS_REGISTER_TEST_MODE" in
      transient-then-success)
        if [ "$count" -lt 3 ]; then
          echo 'aws: [ERROR]: An error occurred (ClientException) when calling the RegisterTaskDefinition operation: Too many concurrent attempts to create a new revision of the specified family.' >&2
          exit 254
        fi
        printf '%s\n' "$AWS_REGISTER_TEST_ARN"
        ;;
      accepted-lost)
        touch "$AWS_REGISTER_TEST_RECOVERED"
        echo 'connection closed after request acceptance' >&2
        exit 255
        ;;
      immediate-success|preexisting-extra|preexisting-task-role|preexisting-tagged)
        printf '%s\n' "$AWS_REGISTER_TEST_ARN"
        ;;
      invalid-success)
        printf 'None\n'
        ;;
      transient-always)
        echo 'aws: [ERROR]: An error occurred (ClientException) when calling the RegisterTaskDefinition operation: Too many concurrent attempts to create a new revision of the specified family.' >&2
        exit 254
        ;;
      permanent)
        echo 'aws: [ERROR]: An error occurred (AccessDeniedException) when calling the RegisterTaskDefinition operation: denied' >&2
        exit 254
        ;;
      wrong-exception)
        echo 'aws: [ERROR]: An error occurred (ServiceException) when calling the RegisterTaskDefinition operation: Too many concurrent attempts to create a new revision of the specified family.' >&2
        exit 42
        ;;
      *) exit 99 ;;
    esac
    ;;
  *) exit 98 ;;
esac
AWS
chmod +x "$work/aws"

cat > "$work/sleep" <<'SLEEP'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$1" >> "$AWS_REGISTER_TEST_SLEEP_LOG"
SLEEP
chmod +x "$work/sleep"

reset_case() {
  rm -f "$work/count" "$work/sleeps" "$work/recovered"
}
run_helper() {
  AWS_BIN="$work/aws" \
  AWS_REGISTER_TEST_MODE="$1" \
  AWS_REGISTER_TEST_COUNT="$work/count" \
  AWS_REGISTER_TEST_SLEEP_LOG="$work/sleeps" \
  AWS_REGISTER_TEST_RECOVERED="$work/recovered" \
  AWS_REGISTER_TEST_INPUT="$work/task.json" \
  AWS_REGISTER_TEST_ARN="$arn" \
  REGISTER_TASK_RECOVERY_ATTEMPTS=1 \
  REGISTER_TASK_RECOVERY_DELAY_SECONDS=0 \
  PATH="$work:$PATH" \
    bash "$helper" "$work/task.json" ap-southeast-1
}

reset_case
test "$(run_helper transient-then-success)" = "$arn"
test "$(cat "$work/count")" = 3
test "$(tr '\n' ',' < "$work/sleeps")" = '1,2,'

reset_case
test "$(run_helper immediate-success)" = "$arn"
test "$(cat "$work/count")" = 1
test ! -e "$work/sleeps"

reset_case
test "$(run_helper accepted-lost 2> "$work/accepted.err")" = "$arn"
test "$(cat "$work/count")" = 1
grep -Fq 'connection closed after request acceptance' "$work/accepted.err"

reset_case
touch "$work/recovered"
test "$(run_helper immediate-success)" = "$arn"
test ! -e "$work/count"

reset_case
touch "$work/recovered"
test "$(run_helper preexisting-extra)" = "$arn"
test "$(cat "$work/count")" = 1

reset_case
touch "$work/recovered"
test "$(run_helper preexisting-tagged)" = "$arn"
test "$(cat "$work/count")" = 1

reset_case
touch "$work/recovered"
test "$(run_helper preexisting-task-role)" = "$arn"
test "$(cat "$work/count")" = 1

reset_case
set +e
run_helper list-denied > "$work/list-denied.out" 2> "$work/list-denied.err"
status=$?
set -e
test "$status" = 2
test ! -e "$work/count"
grep -Fq 'reconciliation authority is unavailable before registration' "$work/list-denied.err"

for mode in permanent wrong-exception; do
  reset_case
  set +e
  run_helper "$mode" > "$work/$mode.out" 2> "$work/$mode.err"
  status=$?
  set -e
  if [ "$mode" = permanent ]; then test "$status" = 254; else test "$status" = 42; fi
  test "$(cat "$work/count")" = 1
  test ! -e "$work/sleeps"
grep -Fq 'outcome remains unknown after exact reconciliation' "$work/$mode.err"
done

# Reconciliation work stays bounded as a fixed family accumulates revisions over time.
grep -Fq -- '--max-items "$scan_limit"' "$helper"
grep -Fq 'REGISTER_TASK_SCAN_LIMIT:-20' "$helper"
grep -Fq 'versionConsistency=="enabled"' "$helper"

reset_case
if run_helper invalid-success > "$work/invalid.out" 2> "$work/invalid.err"; then
  echo 'ERROR: invalid RegisterTaskDefinition ARN was accepted' >&2
  exit 1
fi
grep -Fq 'returned an invalid task-definition ARN' "$work/invalid.err"

reset_case
set +e
run_helper transient-always > "$work/exhausted.out" 2> "$work/exhausted.err"
status=$?
set -e
test "$status" = 254
test "$(cat "$work/count")" = 5
test "$(tr '\n' ',' < "$work/sleeps")" = '1,2,4,8,'
grep -Fq 'remained after 5 attempts' "$work/exhausted.err"

grep -Fq 'register-task-definition-with-retry.sh' "$runner"
grep -Fq 'run-task-idempotently.sh' "$runner"
for policy in \
  "$repo_root/infra/uat/github-deploy-role-policy.template.json" \
  "$repo_root/infra/prod-ecs-express/github-deploy-role-policy.template.json" \
  "$repo_root/infra/prod-ecs-express/deploy-principal-policy.template.json" \
  "$repo_root/infra/security/production-a5-readonly-policy.template.json"; do
  jq -e 'any(.Statement[];
    ((.Action|if type=="array" then . else [.] end)|index("ecs:ListTaskDefinitions"))!=null
    and .Resource=="*")' "$policy" >/dev/null
done
bash -n "$helper" "$runner"
echo 'register-task-definition retry specs passed'
