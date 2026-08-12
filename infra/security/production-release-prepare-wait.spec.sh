#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd -P)"
waiter="$root/infra/security/run-production-release-prepare.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/release-prepare-wait-spec.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT

task_one='arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
task_two='arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
fake_aws="$work/aws"
cat > "$fake_aws" <<'FAKE_AWS'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${FAKE_AWS_CALLS:?}"
if [ "$1 $2" != 'ecs describe-tasks' ]; then
  printf '{"forwarded":true}\n'
  exit 0
fi
count=0
[ ! -f "$FAKE_AWS_COUNT" ] || read -r count < "$FAKE_AWS_COUNT"
count=$((count + 1))
printf '%s\n' "$count" > "$FAKE_AWS_COUNT"
tasks_json="$(printf '%s\n' "$@" \
  | awk 'found && /^--/{exit} found{print} $0=="--tasks"{found=1}' \
  | jq -Rsc 'split("\n") | map(select(length > 0))')"
case "${FAKE_AWS_MODE:?}" in
  delayed-success)
    status=RUNNING
    [ "$count" -lt 3 ] || status=STOPPED
    jq -cn --arg status "$status" --argjson arns "$tasks_json" \
      '{tasks:[$arns[]|{taskArn:.,lastStatus:$status,containers:[{exitCode:0}]}],failures:[]}'
    ;;
  eventual-missing)
    if [ "$count" -eq 1 ]; then
      jq -cn --argjson arns "$tasks_json" \
        '{tasks:[],failures:[$arns[]|{arn:.,reason:"MISSING"}]}'
    else
      jq -cn --argjson arns "$tasks_json" \
        '{tasks:[$arns[]|{taskArn:.,lastStatus:"STOPPED",containers:[{exitCode:0}]}],failures:[]}'
    fi
    ;;
  lookup-failure)
    jq -cn --argjson arns "$tasks_json" \
      '{tasks:[],failures:[{arn:$arns[0],reason:"ACCESS_DENIED"}]}'
    ;;
  running)
    jq -cn --argjson arns "$tasks_json" \
      '{tasks:[$arns[]|{taskArn:.,lastStatus:"RUNNING",containers:[]}],failures:[]}'
    ;;
  stopped-nonzero)
    jq -cn --argjson arns "$tasks_json" \
      '{tasks:[$arns[]|{taskArn:.,lastStatus:"STOPPED",containers:[{exitCode:1}]}],failures:[]}'
    ;;
  bad-identity)
    jq -cn '{tasks:[{taskArn:"arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/cccccccccccccccccccccccccccccccc",lastStatus:"RUNNING"}],failures:[]}'
    ;;
  slow-call)
    while :; do :; done
    ;;
esac
FAKE_AWS
chmod +x "$fake_aws"

run_waiter() {
  local deadline="${WAIT_DEADLINE_EPOCH:-$(( $(date -u +%s) + 60 ))}"
  PRODUCTION_RELEASE_PREPARE_AWS_PROXY=true \
  PRODUCTION_RELEASE_PREPARE_REAL_AWS_BIN="$fake_aws" \
  RELEASE_PREPARE_WAIT_DEADLINE_EPOCH="$deadline" \
  RELEASE_PREPARE_WAIT_ATTEMPTS="${WAIT_ATTEMPTS:-4}" \
  RELEASE_PREPARE_WAIT_SECONDS="${WAIT_SECONDS:-0}" \
    bash "$waiter" ecs wait tasks-stopped --cluster watchdog-bms-prod \
      --tasks "$task_one" "$task_two" --region ap-southeast-1
}

export FAKE_AWS_CALLS="$work/calls" FAKE_AWS_COUNT="$work/count"
export FAKE_AWS_MODE=delayed-success
run_waiter
test "$(< "$FAKE_AWS_COUNT")" = 3

export FAKE_AWS_MODE=eventual-missing
: > "$FAKE_AWS_CALLS"; rm -f "$FAKE_AWS_COUNT"
run_waiter
test "$(< "$FAKE_AWS_COUNT")" = 2

export FAKE_AWS_MODE=lookup-failure
: > "$FAKE_AWS_CALLS"; rm -f "$FAKE_AWS_COUNT"
if run_waiter >"$work/lookup.out" 2>"$work/lookup.err"; then
  echo 'ERROR: terminal ECS lookup failure was accepted' >&2
  exit 1
fi
test "$(< "$FAKE_AWS_COUNT")" = 1
grep -Fq 'terminal or foreign task lookup failure' "$work/lookup.err"

export FAKE_AWS_MODE=bad-identity
: > "$FAKE_AWS_CALLS"; rm -f "$FAKE_AWS_COUNT"
if run_waiter >"$work/identity.out" 2>"$work/identity.err"; then
  echo 'ERROR: unexpected ECS task identity was accepted' >&2
  exit 1
fi
test "$(< "$FAKE_AWS_COUNT")" = 1
grep -Fq 'unexpected task identity or lifecycle status' "$work/identity.err"

# Every intercepted waiter in one release runner consumes the same wall-clock budget. A first
# invocation can exhaust it; a later detached/new/subnet waiter must fail before another AWS read.
export FAKE_AWS_MODE=running WAIT_ATTEMPTS=100 WAIT_SECONDS=1
export WAIT_DEADLINE_EPOCH="$(( $(date -u +%s) + 2 ))"
: > "$FAKE_AWS_CALLS"; rm -f "$FAKE_AWS_COUNT"
set +e
run_waiter >"$work/shared-first.out" 2>"$work/shared-first.err"
first_status=$?
set -e
test "$first_status" = 255
first_count="$(< "$FAKE_AWS_COUNT")"
set +e
run_waiter >"$work/shared-second.out" 2>"$work/shared-second.err"
second_status=$?
set -e
test "$second_status" = 255
test "$(< "$FAKE_AWS_COUNT")" = "$first_count"
grep -Fq 'shared 35-minute deadline' "$work/shared-second.err"

# The absolute deadline also terminates one stuck provider call; connect/read timeouts and retry
# bounds are explicit on every real DescribeTasks request.
export FAKE_AWS_MODE=slow-call WAIT_DEADLINE_EPOCH="$(( $(date -u +%s) + 1 ))"
: > "$FAKE_AWS_CALLS"; rm -f "$FAKE_AWS_COUNT"
started="$(date -u +%s)"
set +e
run_waiter >"$work/slow.out" 2>"$work/slow.err"
slow_status=$?
set -e
elapsed=$(( $(date -u +%s) - started ))
test "$slow_status" = 255
test "$elapsed" -le 2
grep -Fq -- '--cli-connect-timeout 5 --cli-read-timeout 10' "$FAKE_AWS_CALLS"
grep -Fq 'shared 35-minute deadline' "$work/slow.err"

unset WAIT_DEADLINE_EPOCH WAIT_SECONDS

export FAKE_AWS_MODE=running WAIT_ATTEMPTS=3
: > "$FAKE_AWS_CALLS"; rm -f "$FAKE_AWS_COUNT"
set +e
run_waiter >"$work/timeout.out" 2>"$work/timeout.err"
status=$?
set -e
test "$status" = 255
test "$(< "$FAKE_AWS_COUNT")" = 3
grep -Fq 'exceeded 3 checks at 0s intervals' "$work/timeout.err"

# STOPPED means the waiter is complete even when the container failed. The unchanged release-task
# runner performs the authoritative exit-code check for both a new and a detached task afterwards.
export FAKE_AWS_MODE=stopped-nonzero WAIT_ATTEMPTS=1
: > "$FAKE_AWS_CALLS"; rm -f "$FAKE_AWS_COUNT"
run_waiter
grep -Fq 'detached release operation failed or has no confirmed exit code' \
  "$root/infra/prod-ecs-express/run-release-task.sh"
grep -Fq 'if [ "$exit_code" != "0" ]' "$root/infra/prod-ecs-express/run-release-task.sh"

export FAKE_AWS_MODE=running
: > "$FAKE_AWS_CALLS"; rm -f "$FAKE_AWS_COUNT"
PRODUCTION_RELEASE_PREPARE_AWS_PROXY=true \
PRODUCTION_RELEASE_PREPARE_REAL_AWS_BIN="$fake_aws" \
  bash "$waiter" sts get-caller-identity > "$work/forward.json"
jq -e '.forwarded == true' "$work/forward.json" >/dev/null
grep -Fxq 'sts get-caller-identity' "$FAKE_AWS_CALLS"

# The controller wrapper must still invoke the unchanged, Passport-proven runner in release-prepare
# mode. Render-only exercises that boundary without any cloud call.
source_sha="$(git -C "$root" rev-parse HEAD)"
image="311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:$(printf 'c%.0s' {1..64})"
env GITHUB_ACTIONS=true GITHUB_RUN_ID=10001 GITHUB_RUN_ATTEMPT=1 \
  GITHUB_ACTOR=release-operator GITHUB_ACTOR_ID=12345 GITHUB_REPOSITORY=example/watchdog \
  GITHUB_WORKFLOW_REF=example/watchdog/.github/workflows/deploy-production-v2.yml@refs/heads/main \
  AWS_BIN="$fake_aws" AWS_ACCOUNT_ID=311414082667 DEPLOY_ENV=production \
  RELEASE_TASK_RENDER_ONLY=true \
  DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/database-url-aaaaaa \
  RELEASE_MODE=passport-promotion RELEASE_DEPLOY_TARGET=all \
  RELEASE_DATABASE_AUTHORITY=PRODUCTION_READY_V2 \
  PRODUCTION_READY_V2_SHA256="$(printf '1%.0s' {1..64})" \
  PRODUCTION_READY_REPOSITORY_CATALOG_HASH="$(printf '2%.0s' {1..64})" \
  PRODUCTION_READY_APPLIED_CATALOG_HASH="$(printf '3%.0s' {1..64})" \
  PRODUCTION_READY_PENDING_CATALOG_HASH="$(printf '4%.0s' {1..64})" \
  PRODUCTION_READY_PENDING_COUNT=2 \
  bash "$waiter" "$image" "$source_sha" > "$work/task.json"
jq -e '.containerDefinitions[0].name == "release-prepare"' "$work/task.json" >/dev/null

grep -Fq 'RELEASE_PREPARE_WAIT_ATTEMPTS:-421' "$waiter"
grep -Fq 'RELEASE_PREPARE_WAIT_SECONDS:-5' "$waiter"
grep -Fq 'AWS_RETRY_MODE=standard AWS_MAX_ATTEMPTS=2' "$waiter"
grep -Fq 'RELEASE_PREPARE_WAIT_DEADLINE_EPOCH="$(( $(date -u +%s) + 35 * 60 ))"' "$waiter"
test -x "$waiter"
bash -n "$waiter"
echo 'Production release-prepare long wait: PASS'
