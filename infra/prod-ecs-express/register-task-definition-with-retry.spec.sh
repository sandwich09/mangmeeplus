#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
helper="$repo_root/infra/prod-ecs-express/register-task-definition-with-retry.sh"
runner="$repo_root/infra/prod-ecs-express/run-release-task.sh"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-bms-register-task-spec.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

printf '{}\n' > "$tmp_dir/task.json"

cat > "$tmp_dir/aws" <<'AWS'
#!/usr/bin/env bash
set -euo pipefail
test "$1" = ecs
test "$2" = register-task-definition
count=0
[ ! -f "$AWS_REGISTER_TEST_STATE" ] || count="$(cat "$AWS_REGISTER_TEST_STATE")"
count=$((count + 1))
printf '%s\n' "$count" > "$AWS_REGISTER_TEST_STATE"
case "$AWS_REGISTER_TEST_MODE" in
  transient-then-success)
    if [ "$count" -lt 3 ]; then
      echo 'aws: [ERROR]: An error occurred (ClientException) when calling the RegisterTaskDefinition operation: Too many concurrent attempts to create a new revision of the specified family.' >&2
      exit 254
    fi
    echo 'arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-bms-uat-release-task:99'
    ;;
  immediate-success)
    echo 'arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-bms-uat-release-task:100'
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
AWS
chmod +x "$tmp_dir/aws"

cat > "$tmp_dir/sleep" <<'SLEEP'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$1" >> "$AWS_REGISTER_TEST_SLEEP_LOG"
SLEEP
chmod +x "$tmp_dir/sleep"

run_helper() {
  AWS_BIN="$tmp_dir/aws" \
  AWS_REGISTER_TEST_STATE="$tmp_dir/count" \
  AWS_REGISTER_TEST_SLEEP_LOG="$tmp_dir/sleeps" \
  AWS_REGISTER_TEST_MODE="$1" \
  PATH="$tmp_dir:$PATH" \
    bash "$helper" "$tmp_dir/task.json" ap-southeast-1
}

rm -f "$tmp_dir/count" "$tmp_dir/sleeps"
arn="$(run_helper transient-then-success)"
test "$arn" = 'arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-bms-uat-release-task:99'
test "$(cat "$tmp_dir/count")" = 3
test "$(tr '\n' ',' < "$tmp_dir/sleeps")" = '1,2,'

rm -f "$tmp_dir/count" "$tmp_dir/sleeps"
test "$(run_helper immediate-success)" = 'arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-bms-uat-release-task:100'
test "$(cat "$tmp_dir/count")" = 1
test ! -e "$tmp_dir/sleeps"

rm -f "$tmp_dir/count" "$tmp_dir/sleeps"
set +e
run_helper permanent >"$tmp_dir/permanent.out" 2>"$tmp_dir/permanent.err"
status=$?
set -e
test "$status" = 254
test "$(cat "$tmp_dir/count")" = 1
test ! -e "$tmp_dir/sleeps"
grep -Fq 'AccessDeniedException' "$tmp_dir/permanent.err"

rm -f "$tmp_dir/count" "$tmp_dir/sleeps"
set +e
run_helper wrong-exception >"$tmp_dir/wrong-exception.out" 2>"$tmp_dir/wrong-exception.err"
status=$?
set -e
test "$status" = 42
test "$(cat "$tmp_dir/count")" = 1
test ! -e "$tmp_dir/sleeps"

rm -f "$tmp_dir/count" "$tmp_dir/sleeps"
set +e
run_helper transient-always >"$tmp_dir/exhausted.out" 2>"$tmp_dir/exhausted.err"
status=$?
set -e
test "$status" = 254
test "$(cat "$tmp_dir/count")" = 5
test "$(tr '\n' ',' < "$tmp_dir/sleeps")" = '1,2,4,8,'
grep -Fq 'remained after 5 attempts' "$tmp_dir/exhausted.err"

grep -Fq 'register-task-definition-with-retry.sh' "$runner"
grep -Fq 'aws_cmd ecs run-task' "$runner"
bash -n "$helper"
bash -n "$runner"
echo 'register-task-definition retry specs passed'
