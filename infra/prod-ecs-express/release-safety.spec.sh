#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-release-safety.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

assert_exit() {
  local expected="$1" label="$2"
  shift 2
  local code=0
  "$@" >/dev/null 2>&1 || code=$?
  if [ "$code" -ne "$expected" ]; then
    echo "ERROR: $label exited $code, expected $expected" >&2
    exit 1
  fi
}

# A successful ECS deployment may briefly remain dual-active while the old revision drains. The
# waiter retries only that bounded settlement window; contradictory binding/history remains fatal.
# shellcheck source=infra/prod-ecs-express/lib-wait-for-service-url.sh
. "$repo_root/infra/prod-ecs-express/lib-wait-for-service-url.sh"
wait_fake="$fixture/wait-aws"
cat > "$wait_fake" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_WAIT_CALL_LOG"
next_payload() {
  local prefix="$1" count_file="$2" count file
  count="$(cat "$count_file" 2>/dev/null || printf 0)"
  count=$((count + 1))
  printf '%s' "$count" > "$count_file"
  file="${prefix}-${count}.json"
  [ -f "$file" ] || file="${prefix}-default.json"
  cat "$file"
}
case "$1 $2" in
  "ecs describe-express-gateway-service")
    if [[ "$*" == *"service.status.statusCode"* ]]; then
      printf '%s\n' "${FAKE_WAIT_OUTER_STATUS:-ACTIVE}"
    else
      next_payload "$FAKE_WAIT_SERVICE_PREFIX" "$FAKE_WAIT_SERVICE_COUNT"
    fi
    ;;
  "ecs describe-service-deployments") cat "$FAKE_WAIT_DEPLOYMENT" ;;
  "ecs list-service-deployments") next_payload "$FAKE_WAIT_HISTORY_PREFIX" "$FAKE_WAIT_HISTORY_COUNT" ;;
  *) echo "unexpected waiter AWS call: $*" >&2; exit 64 ;;
esac
FAKE
chmod +x "$wait_fake"
export FAKE_WAIT_CALL_LOG="$fixture/wait-calls"
export FAKE_WAIT_SERVICE_PREFIX="$fixture/wait-service"
export FAKE_WAIT_SERVICE_COUNT="$fixture/wait-service-count"
export FAKE_WAIT_HISTORY_PREFIX="$fixture/wait-history"
export FAKE_WAIT_HISTORY_COUNT="$fixture/wait-history-count"
export FAKE_WAIT_DEPLOYMENT="$fixture/wait-deployment.json"
wait_arn="arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-uat/watchdog-bms-uat-api-web"
wait_target="arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-uat/watchdog-bms-uat-api-web/target"
wait_old="arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-uat/watchdog-bms-uat-api-web/old"
wait_deployment="arn:aws:ecs:ap-southeast-1:311414082667:service-deployment/watchdog-bms-uat/watchdog-bms-uat-api-web/deploy"
wait_url="https://api.uat.example.invalid"
wait_service_state() {
  local revisions="$1" current="${2:-}" status="${3:-ACTIVE}"
  jq -cn --arg status "$status" --arg current "$current" --argjson revisions "$revisions" '
    {status:$status,currentDeployment:(if $current == "" then null else $current end),activeRevisions:$revisions}
  '
}
wait_history_state() {
  jq -cn --arg deployment "$wait_deployment" '
    {nextToken:null,serviceDeployments:[{deploymentArn:$deployment,createdAt:"2026-08-03T00:01:00Z"}]}
  '
}
wait_reset() {
  rm -f "$FAKE_WAIT_CALL_LOG" "$FAKE_WAIT_SERVICE_COUNT" "$FAKE_WAIT_HISTORY_COUNT" \
    "${FAKE_WAIT_SERVICE_PREFIX}-"*.json "${FAKE_WAIT_HISTORY_PREFIX}-"*.json
  jq -cn --arg status SUCCESSFUL --arg serviceArn "$wait_arn" --arg targetRevision "$wait_target" \
    '{status:$status,serviceArn:$serviceArn,targetRevision:$targetRevision}' > "$FAKE_WAIT_DEPLOYMENT"
  wait_service_state "[\"$wait_target\"]" > "${FAKE_WAIT_SERVICE_PREFIX}-default.json"
  wait_history_state > "${FAKE_WAIT_HISTORY_PREFIX}-default.json"
}
wait_run() (
  aws_cmd() { "$wait_fake" "$@"; }
  service_url() { [ "${FAKE_WAIT_NO_URL:-false}" = "true" ] || printf '%s' "$wait_url"; }
  sleep() { :; }
  AWS_BIN="$wait_fake"
  REGION=ap-southeast-1
  DEPLOYMENT_POLL_ATTEMPTS="${WAIT_POLL_ATTEMPTS:-3}"
  wait_for_service_url "$wait_arn" PUBLIC "$wait_deployment" "$wait_target"
)
wait_assert_one_poll() {
  test "$(grep -c 'describe-service-deployments' "$FAKE_WAIT_CALL_LOG")" -eq 1
}

wait_reset
test "$(wait_run)" = "$wait_url"

# AWS CLI commonly renders service-deployment datetimes with fractional seconds and an offset.
wait_reset
jq '.serviceDeployments[0].createdAt = "2026-08-03T07:01:00.123456+07:00"' \
  "${FAKE_WAIT_HISTORY_PREFIX}-default.json" > "$fixture/wait-history.tmp"
mv "$fixture/wait-history.tmp" "${FAKE_WAIT_HISTORY_PREFIX}-default.json"
test "$(wait_run)" = "$wait_url"

wait_reset
wait_service_state "[\"$wait_old\",\"$wait_target\"]" > "${FAKE_WAIT_SERVICE_PREFIX}-1.json"
wait_service_state "[\"$wait_old\",\"$wait_target\"]" > "${FAKE_WAIT_SERVICE_PREFIX}-2.json"
wait_service_state "[\"$wait_target\"]" > "${FAKE_WAIT_SERVICE_PREFIX}-3.json"
wait_service_state "[\"$wait_target\"]" > "${FAKE_WAIT_SERVICE_PREFIX}-4.json"
test "$(wait_run)" = "$wait_url"
test "$(grep -c 'describe-service-deployments' "$FAKE_WAIT_CALL_LOG")" -eq 2

wait_reset
wait_service_state "[\"$wait_old\",\"$wait_target\"]" > "${FAKE_WAIT_SERVICE_PREFIX}-1.json"
wait_service_state "[\"$wait_target\"]" > "${FAKE_WAIT_SERVICE_PREFIX}-2.json"
test "$(wait_run)" = "$wait_url"
test "$(grep -c 'describe-service-deployments' "$FAKE_WAIT_CALL_LOG")" -eq 2

wait_reset
wait_history_state | jq --arg old "${wait_deployment}-old" \
  '.serviceDeployments = [{deploymentArn:$old,createdAt:"2026-08-03T00:00:00Z"}] + .serviceDeployments' \
  > "${FAKE_WAIT_HISTORY_PREFIX}-1.json"
wait_history_state > "${FAKE_WAIT_HISTORY_PREFIX}-2.json"
test "$(wait_run)" = "$wait_url"
test "$(grep -c 'describe-service-deployments' "$FAKE_WAIT_CALL_LOG")" -eq 2

wait_reset
wait_history_state | jq --arg old "${wait_deployment}-old" \
  '.serviceDeployments = [{deploymentArn:$old,createdAt:"2026-08-03T00:00:00Z"}]' \
  > "${FAKE_WAIT_HISTORY_PREFIX}-1.json"
wait_history_state > "${FAKE_WAIT_HISTORY_PREFIX}-2.json"
test "$(wait_run)" = "$wait_url"
test "$(grep -c 'describe-service-deployments' "$FAKE_WAIT_CALL_LOG")" -eq 2

for wrong_field in serviceArn targetRevision; do
  wait_reset
  jq --arg field "$wrong_field" '.[$field] += "-wrong"' "$FAKE_WAIT_DEPLOYMENT" > "$fixture/wait-deployment.tmp"
  mv "$fixture/wait-deployment.tmp" "$FAKE_WAIT_DEPLOYMENT"
  assert_exit 1 "waiter wrong ${wrong_field}" wait_run
  wait_assert_one_poll
  if grep -q 'list-service-deployments' "$FAKE_WAIT_CALL_LOG"; then
    echo "ERROR: wrong waiter binding reached settlement history" >&2
    exit 1
  fi
done

wait_reset
jq '.nextToken = "more"' "${FAKE_WAIT_HISTORY_PREFIX}-default.json" > "$fixture/wait-history.tmp"
mv "$fixture/wait-history.tmp" "${FAKE_WAIT_HISTORY_PREFIX}-default.json"
assert_exit 1 'waiter paginated history' wait_run
wait_assert_one_poll

wait_reset
jq '.nextToken = "more"' "${FAKE_WAIT_HISTORY_PREFIX}-default.json" > "${FAKE_WAIT_HISTORY_PREFIX}-2.json"
wait_service_state "[\"$wait_old\",\"$wait_target\"]" > "${FAKE_WAIT_SERVICE_PREFIX}-1.json"
wait_service_state "[\"$wait_target\"]" > "${FAKE_WAIT_SERVICE_PREFIX}-2.json"
assert_exit 1 'waiter second-read paginated history' wait_run
wait_assert_one_poll

wait_reset
jq '.serviceDeployments = []' "${FAKE_WAIT_HISTORY_PREFIX}-default.json" > "$fixture/wait-history.tmp"
mv "$fixture/wait-history.tmp" "${FAKE_WAIT_HISTORY_PREFIX}-default.json"
assert_exit 1 'waiter missing expected deployment history' wait_run
wait_assert_one_poll

wait_reset
jq '.serviceDeployments += [.serviceDeployments[0]]' \
  "${FAKE_WAIT_HISTORY_PREFIX}-default.json" > "$fixture/wait-history.tmp"
mv "$fixture/wait-history.tmp" "${FAKE_WAIT_HISTORY_PREFIX}-default.json"
assert_exit 1 'waiter duplicate expected deployment history' wait_run
wait_assert_one_poll

wait_reset
jq --arg newer "${wait_deployment}-newer" \
  '.serviceDeployments += [{deploymentArn:$newer,createdAt:"2026-08-03T00:02:00Z"}]' \
  "${FAKE_WAIT_HISTORY_PREFIX}-default.json" > "$fixture/wait-history.tmp"
mv "$fixture/wait-history.tmp" "${FAKE_WAIT_HISTORY_PREFIX}-default.json"
assert_exit 1 'waiter newer deployment history' wait_run
wait_assert_one_poll

wait_reset
jq --arg tie "${wait_deployment}-tie" \
  '.serviceDeployments += [{deploymentArn:$tie,createdAt:"2026-08-03T00:01:00Z"}]' \
  "${FAKE_WAIT_HISTORY_PREFIX}-default.json" > "$fixture/wait-history.tmp"
mv "$fixture/wait-history.tmp" "${FAKE_WAIT_HISTORY_PREFIX}-default.json"
assert_exit 1 'waiter ambiguous newest deployment history' wait_run
wait_assert_one_poll

for malformed_timestamp in '' not-a-timestamp '2026-08-03T00:00:00+00:99'; do
  wait_reset
  jq --arg old "${wait_deployment}-old" --arg timestamp "$malformed_timestamp" \
    '.serviceDeployments = [{deploymentArn:$old,createdAt:$timestamp}] + .serviceDeployments' \
    "${FAKE_WAIT_HISTORY_PREFIX}-default.json" > "$fixture/wait-history.tmp"
  mv "$fixture/wait-history.tmp" "${FAKE_WAIT_HISTORY_PREFIX}-default.json"
  assert_exit 1 'waiter malformed deployment timestamp' wait_run
  wait_assert_one_poll
done

# Lexically the offset row looks older, but it is 30 minutes newer in UTC and must win.
wait_reset
jq --arg newer "${wait_deployment}-offset-newer" \
  '.serviceDeployments += [{deploymentArn:$newer,createdAt:"2026-08-02T23:30:00-02:00"}]' \
  "${FAKE_WAIT_HISTORY_PREFIX}-default.json" > "$fixture/wait-history.tmp"
mv "$fixture/wait-history.tmp" "${FAKE_WAIT_HISTORY_PREFIX}-default.json"
assert_exit 1 'waiter offset timestamp newer in absolute time' wait_run
wait_assert_one_poll

# Equivalent instants written with different valid offsets are an ambiguous newest tie.
wait_reset
jq --arg tie "${wait_deployment}-offset-tie" \
  '.serviceDeployments += [{deploymentArn:$tie,createdAt:"2026-08-03T01:01:00.000+01:00"}]' \
  "${FAKE_WAIT_HISTORY_PREFIX}-default.json" > "$fixture/wait-history.tmp"
mv "$fixture/wait-history.tmp" "${FAKE_WAIT_HISTORY_PREFIX}-default.json"
assert_exit 1 'waiter offset timestamp tie' wait_run
wait_assert_one_poll

wait_reset
wait_service_state "[\"$wait_target\"]" "${wait_deployment}-other" > "${FAKE_WAIT_SERVICE_PREFIX}-default.json"
assert_exit 1 'waiter foreign current deployment' wait_run
wait_assert_one_poll

for revisions in \
  "[\"$wait_target\",\"$wait_target\"]" \
  "[\"$wait_old\",\"$wait_target\",\"${wait_target}-three\"]" \
  "[\"$wait_target\",\"arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-uat/other-service/foreign\"]"; do
  wait_reset
  wait_service_state "$revisions" > "${FAKE_WAIT_SERVICE_PREFIX}-default.json"
  assert_exit 1 'waiter malformed active revisions' wait_run
  wait_assert_one_poll
done

for terminal in STOPPED ROLLBACK_SUCCESSFUL ROLLBACK_FAILED; do
  wait_reset
  jq --arg status "$terminal" '.status = $status' "$FAKE_WAIT_DEPLOYMENT" > "$fixture/wait-deployment.tmp"
  mv "$fixture/wait-deployment.tmp" "$FAKE_WAIT_DEPLOYMENT"
  assert_exit 1 "waiter terminal ${terminal}" wait_run
  wait_assert_one_poll
  if grep -q 'list-service-deployments' "$FAKE_WAIT_CALL_LOG"; then
    echo "ERROR: terminal waiter status reached settlement history" >&2
    exit 1
  fi
done

# Terminal rollout evidence is decisive even before the service becomes ACTIVE or publishes a URL.
for terminal_outer_state in DRAINING UPDATING; do
  wait_reset
  jq '.status = "ROLLBACK_SUCCESSFUL"' "$FAKE_WAIT_DEPLOYMENT" > "$fixture/wait-deployment.tmp"
  mv "$fixture/wait-deployment.tmp" "$FAKE_WAIT_DEPLOYMENT"
  FAKE_WAIT_OUTER_STATUS="$terminal_outer_state" FAKE_WAIT_NO_URL=true \
    assert_exit 1 "waiter terminal while ${terminal_outer_state} without URL" wait_run
  wait_assert_one_poll
done

test "$(grep -c -- '--no-paginate' "$repo_root/infra/prod-ecs-express/lib-wait-for-service-url.sh")" -eq 2

wait_reset
wait_service_state "[\"$wait_old\",\"$wait_target\"]" > "${FAKE_WAIT_SERVICE_PREFIX}-default.json"
assert_exit 1 'waiter persistent dual-active state' wait_run
test "$(grep -c 'describe-service-deployments' "$FAKE_WAIT_CALL_LOG")" -eq 3

for invalid_attempts in 0 00 invalid; do
  wait_reset
  WAIT_POLL_ATTEMPTS="$invalid_attempts"
  assert_exit 2 'waiter invalid poll attempts' wait_run
  unset WAIT_POLL_ATTEMPTS
  if [ -f "$FAKE_WAIT_CALL_LOG" ]; then
    echo "ERROR: invalid waiter poll attempts reached AWS" >&2
    exit 1
  fi
done

# Bash disables inherited errexit inside a function evaluated by `if`. The deployer's steady-state
# probe must therefore carry an explicit `|| return` on its SSM read; otherwise AccessDenied or an
# expired credential is misread as an empty bootstrap value and the sequential writer starts.
grep -Fq 'if ! value="$(get_param "$name")"; then' \
  "$repo_root/infra/prod-ecs-express/deploy.sh"
grep -A4 -F 'if ! value="$(get_param "$name")"; then' \
  "$repo_root/infra/prod-ecs-express/deploy.sh" | grep -Fq 'return 75'
conditional_read_failure() {
  local value
  if ! value="$(return 1)"; then
    return 75
  fi
  test -n "$value"
}
conditional_code=0
conditional_read_failure || conditional_code=$?
if [ "$conditional_code" -ne 75 ]; then
  echo "ERROR: operational parameter read failure was not separated from bootstrap" >&2
  exit 1
fi

# Exercise the exact helper used by deploy.sh: only status 1 may enter the bootstrap writer. An AWS
# failure must preserve its status and invoke neither deployment branch.
# shellcheck source=infra/prod-ecs-express/lib-rollout-waves.sh
. "$repo_root/infra/prod-ecs-express/lib-rollout-waves.sh"
mutation_calls=0
wave_probe_denied() { return 86; }
wave_probe_bootstrap() { return 1; }
wave_writer() { mutation_calls=$((mutation_calls + 1)); }
bootstrap_writer() { mutation_calls=$((mutation_calls + 1)); }
decision_code=0
run_rollout_by_readiness wave_probe_denied wave_writer bootstrap_writer || decision_code=$?
if [ "$decision_code" -ne 86 ] || [ "$mutation_calls" -ne 0 ]; then
  echo "ERROR: wave readiness failure reached a deployment writer" >&2
  exit 1
fi
run_rollout_by_readiness wave_probe_bootstrap wave_writer bootstrap_writer
if [ "$mutation_calls" -ne 1 ]; then
  echo "ERROR: intentional bootstrap did not run exactly one sequential writer" >&2
  exit 1
fi

# F2 may run after ECS has cleared currentDeployment. In that settled state the verifier must use
# one unpaginated, unique-newest successful deployment and obtain the same service/history twice.
serving_fake="$fixture/serving-aws"
cat > "$serving_fake" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  *" ssm get-parameter "*|"ssm get-parameter "*) printf '%s\n' "$FAKE_SERVING_SERVICE_ARN" ;;
  *" ecs describe-express-gateway-service "*|"ecs describe-express-gateway-service "*)
    count="$(cat "$FAKE_SERVING_COUNT" 2>/dev/null || printf 0)"
    count=$((count + 1))
    printf '%s' "$count" > "$FAKE_SERVING_COUNT"
    file="${FAKE_SERVING_SERVICE_PREFIX}-${count}.json"
    [ -f "$file" ] || file="${FAKE_SERVING_SERVICE_PREFIX}-1.json"
    cat "$file"
    ;;
  *" ecs list-service-deployments "*|"ecs list-service-deployments "*)
    count="$(cat "$FAKE_SERVING_COUNT")"
    file="${FAKE_SERVING_HISTORY_PREFIX}-${count}.json"
    [ -f "$file" ] || file="${FAKE_SERVING_HISTORY_PREFIX}-1.json"
    cat "$file"
    ;;
  *" ecs describe-service-deployments "*|"ecs describe-service-deployments "*)
    cat "$FAKE_SERVING_DEPLOYMENT"
    ;;
  *) echo "unexpected serving-build AWS call: $*" >&2; exit 64 ;;
esac
FAKE
chmod +x "$serving_fake"
export FAKE_SERVING_COUNT="$fixture/serving-count"
export FAKE_SERVING_SERVICE_PREFIX="$fixture/serving-service"
export FAKE_SERVING_HISTORY_PREFIX="$fixture/serving-history"
export FAKE_SERVING_DEPLOYMENT="$fixture/serving-deployment.json"
export FAKE_SERVING_SERVICE_ARN="arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-uat/watchdog-bms-uat-api-web"
serving_sha="$(printf 'c%.0s' {1..40})"
serving_revision="arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-uat/watchdog-bms-uat-api-web/123"
serving_deployment="arn:aws:ecs:ap-southeast-1:311414082667:service-deployment/watchdog-bms-uat/watchdog-bms-uat-api-web/abc"
serving_service() {
  jq -cn --arg arn "$FAKE_SERVING_SERVICE_ARN" --arg revision "$serving_revision" \
    --arg sha "$serving_sha" --argjson current "${1:-null}" '
    {service:{serviceArn:$arn,status:{statusCode:"ACTIVE"},currentDeployment:$current,
      activeConfigurations:[{serviceRevisionArn:$revision,
        primaryContainer:{environment:[{name:"GIT_SHA",value:$sha}]}}]}}'
}
serving_history() {
  jq -cn --arg arn "$FAKE_SERVING_SERVICE_ARN" --arg revision "$serving_revision" \
    --arg deployment "$serving_deployment" --arg token "${1:-}" --arg created "${2:-2026-08-02T01:00:00Z}" '
    {nextToken:(if $token == "" then null else $token end),serviceDeployments:[{
      serviceDeploymentArn:$deployment,serviceArn:$arn,status:"SUCCESSFUL",
      targetServiceRevisionArn:$revision,createdAt:$created}]}'
}
reset_serving_fixture() {
  rm -f "$FAKE_SERVING_COUNT"
  serving_service > "${FAKE_SERVING_SERVICE_PREFIX}-1.json"
  serving_history > "${FAKE_SERVING_HISTORY_PREFIX}-1.json"
}
verify_serving() {
  AWS_BIN="$serving_fake" SERVING_BUILD_STABILITY_SECONDS=0 \
    bash "$repo_root/infra/prod-ecs-express/verify-serving-api-build.sh" uat "$serving_sha"
}
reset_serving_fixture
test "$(verify_serving | jq -r '.buildReleaseId')" = "$serving_sha"
reset_serving_fixture
serving_history more > "${FAKE_SERVING_HISTORY_PREFIX}-1.json"
assert_exit 75 'paginated settled deployment history' verify_serving
reset_serving_fixture
jq --arg deployment "$serving_deployment" \
  '.serviceDeployments += [(.serviceDeployments[0] + {serviceDeploymentArn:($deployment + "-tie")})]' \
  "${FAKE_SERVING_HISTORY_PREFIX}-1.json" > "${FAKE_SERVING_HISTORY_PREFIX}-2.json"
mv "${FAKE_SERVING_HISTORY_PREFIX}-2.json" "${FAKE_SERVING_HISTORY_PREFIX}-1.json"
assert_exit 75 'ambiguous newest settled deployment' verify_serving
reset_serving_fixture
cp "${FAKE_SERVING_HISTORY_PREFIX}-1.json" "${FAKE_SERVING_HISTORY_PREFIX}-2.json"
jq '.serviceDeployments[0].createdAt = "2026-08-02T01:01:00Z"' \
  "${FAKE_SERVING_HISTORY_PREFIX}-2.json" > "${FAKE_SERVING_HISTORY_PREFIX}-3.json"
mv "${FAKE_SERVING_HISTORY_PREFIX}-3.json" "${FAKE_SERVING_HISTORY_PREFIX}-2.json"
assert_exit 75 'deployment history moving between stability reads' verify_serving

# ListTasks permits startedBy only as the sole server-side filter. Stopped tasks are removed only
# after DescribeTasks, never by adding desired-status to ListTasks.
active_fake="$fixture/active-aws"
cat > "$active_fake" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_CALL_LOG"
case "$*" in
  *" ecs list-tasks "*|"ecs list-tasks "*)
    [[ "$*" == *"--started-by watchdog-bms-uat-release"* ]]
    [[ "$*" != *"--desired-status"* ]]
    printf '["arn:task/running","arn:task/stopped"]\n'
    ;;
  *" ecs describe-tasks "*|"ecs describe-tasks "*)
    printf '{"tasks":[{"taskArn":"arn:task/running","lastStatus":"RUNNING","desiredStatus":"RUNNING"},{"taskArn":"arn:task/stopped","lastStatus":"STOPPED","desiredStatus":"STOPPED"}]}\n'
    ;;
  *) exit 64 ;;
esac
FAKE
chmod +x "$active_fake"
export FAKE_CALL_LOG="$fixture/active-calls"
active="$(AWS_BIN="$active_fake" bash "$repo_root/infra/prod-ecs-express/active-release-tasks.sh" \
  --cluster watchdog-bms-uat --started-by watchdog-bms-uat-release)"
test "$active" = '["arn:task/running"]'
test "$(grep -c 'list-tasks' "$FAKE_CALL_LOG")" -eq 1
if grep -q -- '--desired-status' "$FAKE_CALL_LOG"; then
  echo "ERROR: ListTasks combined startedBy with desired-status" >&2
  exit 1
fi

# Create has a different API shape from update: bind returned currentDeployment + the sole
# activeConfiguration, then corroborate that exact ARN through DescribeServiceDeployments.
create_fake="$fixture/create-aws"
cat > "$create_fake" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
cat "$FAKE_CREATE_DESCRIBE"
FAKE
chmod +x "$create_fake"
create_service="arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-uat/api-web"
create_deployment="arn:aws:ecs:ap-southeast-1:311414082667:service-deployment/watchdog-bms-uat/api-web/create-1"
create_revision="arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-uat/api-web/create-1"
jq -n --arg serviceArn "$create_service" --arg currentDeployment "$create_deployment" --arg revision "$create_revision" \
  '{serviceArn:$serviceArn,currentDeployment:$currentDeployment,activeRevisions:[$revision]}' > "$fixture/create-response.json"
export FAKE_CREATE_DESCRIBE="$fixture/create-described.json"
create_bind() {
  AWS_BIN="$create_fake" BIND_CREATE_POLL_ATTEMPTS=1 BIND_CREATE_POLL_SECONDS=0 \
    bash "$repo_root/infra/prod-ecs-express/bind-express-create.sh" \
      --response "$fixture/create-response.json" --cluster watchdog-bms-uat --service-name api-web \
      --region ap-southeast-1 --account 311414082667
}
jq -n --arg serviceArn "$create_service" --arg revision "$create_revision" \
  '[{serviceArn:$serviceArn,targetServiceRevision:{arn:$revision},status:"IN_PROGRESS"}]' > "$FAKE_CREATE_DESCRIBE"
test "$(create_bind | jq -r '.deploymentArn')" = "$create_deployment"
printf '[]\n' > "$FAKE_CREATE_DESCRIBE"
assert_exit 75 'create deployment absent from Describe' create_bind
jq -n '[{},{}]' > "$FAKE_CREATE_DESCRIBE"
assert_exit 76 'create deployment resolving to multiple records' create_bind
jq -n --arg serviceArn "$create_service" --arg revision "${create_revision}-wrong" \
  '[{serviceArn:$serviceArn,targetServiceRevision:{arn:$revision}}]' > "$FAKE_CREATE_DESCRIBE"
assert_exit 76 'create deployment with wrong target revision' create_bind
jq --arg revision "${create_revision}-two" '.activeRevisions += [$revision]' "$fixture/create-response.json" \
  > "$fixture/create-response.tmp" && mv "$fixture/create-response.tmp" "$fixture/create-response.json"
assert_exit 5 'create response with multiple active revisions' create_bind

# Causal deployment binding: exact one succeeds; zero, multiple, wrong, old and pre-existing
# candidates never guess. A late but in-window candidate may appear on a later bounded poll.
bind_fake="$fixture/bind-aws"
cat > "$bind_fake" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
count="$(cat "$FAKE_BIND_COUNT" 2>/dev/null || printf 0)"
count=$((count + 1))
printf '%s' "$count" > "$FAKE_BIND_COUNT"
file="${FAKE_BIND_PREFIX}-${count}.json"
[ -f "$file" ] || file="${FAKE_BIND_PREFIX}-1.json"
cat "$file"
FAKE
chmod +x "$bind_fake"
service="arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-uat/api-web"
target="arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-uat/api-web/rev-target"
deployment="arn:aws:ecs:ap-southeast-1:311414082667:service-deployment/watchdog-bms-uat/api-web/deploy-target"
now_epoch="$(date -u +%s)"
now_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
old_iso="$(node -e 'process.stdout.write(new Date((Number(process.argv[1]) - 120) * 1000).toISOString())' "$now_epoch")"
printf '[]\n' > "$fixture/before.json"
export FAKE_BIND_COUNT="$fixture/bind-count" FAKE_BIND_PREFIX="$fixture/bind"
bind_run() {
  rm -f "$FAKE_BIND_COUNT"
  AWS_BIN="$bind_fake" AWS_REGION=ap-southeast-1 BIND_DEPLOYMENT_POLL_ATTEMPTS="${BIND_ATTEMPTS:-1}" \
    BIND_DEPLOYMENT_POLL_SECONDS=0 bash "$repo_root/infra/prod-ecs-express/bind-express-deployment.sh" \
      --service-arn "$service" --target-revision "$target" --request-start-epoch "$now_epoch" \
      --before-file "$fixture/before.json"
}
deployment_row() {
  jq -cn --arg arn "$1" --arg targetRevisionArn "$2" --arg createdAt "$3" \
    '{serviceDeployments:[{serviceDeploymentArn:$arn,targetServiceRevisionArn:$targetRevisionArn,createdAt:$createdAt}]}'
}
deployment_row "$deployment" "$target" "$now_iso" > "$fixture/bind-1.json"
test "$(bind_run)" = "$deployment"
printf '{"serviceDeployments":[]}\n' > "$fixture/bind-1.json"
assert_exit 75 'zero causal deployment candidates' bind_run
jq -cn --arg arn "$deployment" --arg target "$target" --arg now "$now_iso" \
  '{serviceDeployments:[
    {serviceDeploymentArn:$arn,targetServiceRevisionArn:$target,createdAt:$now},
    {serviceDeploymentArn:($arn+"-two"),targetServiceRevisionArn:$target,createdAt:$now}
  ]}' > "$fixture/bind-1.json"
assert_exit 76 'two causal deployment candidates' bind_run
deployment_row "$deployment" "${target}-wrong" "$now_iso" > "$fixture/bind-1.json"
assert_exit 75 'wrong target revision' bind_run
deployment_row "$deployment" "$target" "$old_iso" > "$fixture/bind-1.json"
assert_exit 75 'deployment outside request window' bind_run
printf '{"serviceDeployments":[]}\n' > "$fixture/bind-1.json"
deployment_row "$deployment" "$target" "$now_iso" > "$fixture/bind-2.json"
BIND_ATTEMPTS=2
test "$(bind_run)" = "$deployment"
unset BIND_ATTEMPTS
printf '["%s"]\n' "$deployment" > "$fixture/before.json"
deployment_row "$deployment" "$target" "$now_iso" > "$fixture/bind-1.json"
assert_exit 75 'deployment that existed before the request' bind_run
printf '[]\n' > "$fixture/before.json"

# A no-op is stable only when the exact target was and remains the sole active revision, the current
# deployment is unchanged, and no deployment ARN appeared between either read.
noop_fake="$fixture/noop-aws"
cat > "$noop_fake" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  *list-service-deployments*)
    count="$(cat "$FAKE_NOOP_COUNT" 2>/dev/null || printf 0)"
    count=$((count + 1))
    printf '%s' "$count" > "$FAKE_NOOP_COUNT"
    file="${FAKE_NOOP_DEPLOYMENTS}-${count}.json"
    [ -f "$file" ] || file="${FAKE_NOOP_DEPLOYMENTS}-1.json"
    cat "$file"
    ;;
  *describe-express-gateway-service*)
    count="$(cat "$FAKE_NOOP_COUNT")"
    file="${FAKE_NOOP_SERVICE}-${count}.json"
    [ -f "$file" ] || file="${FAKE_NOOP_SERVICE}-1.json"
    cat "$file"
    ;;
  *) exit 64 ;;
esac
FAKE
chmod +x "$noop_fake"
current="arn:aws:ecs:ap-southeast-1:311414082667:service-deployment/watchdog-bms-uat/api-web/current"
printf '["%s"]\n' "$current" > "$fixture/noop-before-deployments.json"
jq -cn --arg current "$current" --arg target "$target" \
  '{currentDeployment:$current,activeRevisions:[$target]}' > "$fixture/noop-before-service.json"
export FAKE_NOOP_COUNT="$fixture/noop-count" FAKE_NOOP_DEPLOYMENTS="$fixture/noop-deployments" FAKE_NOOP_SERVICE="$fixture/noop-service"
noop_reset() { rm -f "$FAKE_NOOP_COUNT"; }
noop_run() {
  noop_reset
  AWS_BIN="$noop_fake" AWS_REGION=ap-southeast-1 NOOP_STABILITY_SECONDS=0 \
    bash "$repo_root/infra/prod-ecs-express/verify-express-noop.sh" \
      --service-arn "$service" --target-revision "$target" \
      --before-deployments "$fixture/noop-before-deployments.json" \
      --before-service "$fixture/noop-before-service.json"
}
jq -cn --arg current "$current" \
  '{nextToken:null,serviceDeployments:[{serviceDeploymentArn:$current}]}' > "$fixture/noop-deployments-1.json"
cp "$fixture/noop-deployments-1.json" "$fixture/noop-deployments-2.json"
cp "$fixture/noop-before-service.json" "$fixture/noop-service-1.json"
cp "$fixture/noop-before-service.json" "$fixture/noop-service-2.json"
noop_run >/dev/null
jq -cn --arg current "$current" --arg new "${current}-late" \
  '{nextToken:null,serviceDeployments:[{serviceDeploymentArn:$current},{serviceDeploymentArn:$new}]}' \
  > "$fixture/noop-deployments-2.json"
assert_exit 75 'late deployment during no-op verification' noop_run
cp "$fixture/noop-deployments-1.json" "$fixture/noop-deployments-2.json"
jq '.nextToken="more"' "$fixture/noop-deployments-2.json" > "$fixture/noop-deployments.tmp"
mv "$fixture/noop-deployments.tmp" "$fixture/noop-deployments-2.json"
assert_exit 75 'paginated no-op deployment history' noop_run
cp "$fixture/noop-deployments-1.json" "$fixture/noop-deployments-2.json"
jq -cn --arg current "${current}-new" --arg target "$target" \
  '{currentDeployment:$current,activeRevisions:[$target]}' > "$fixture/noop-service-2.json"
assert_exit 75 'new current deployment during no-op verification' noop_run
jq -cn --arg current "$current" --arg target "$target" --arg old "${target}-old" \
  '{currentDeployment:$current,activeRevisions:[$old,$target]}' > "$fixture/noop-before-service.json"
assert_exit 75 'target not sole active revision before request' noop_run

# Workflow evidence shapes are executable here: a true no-op has null deployment and skips; a
# rollout requires exact deployment/revision ARNs. Mixed or caller-mismatched evidence is rejected.
evidence_helper="$repo_root/infra/prod-ecs-express/retirement-evidence.sh"
sha="$(printf 'a%.0s' {1..40})"
revision="arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-uat/api-web/rev-1"
evidence_run() {
  bash "$evidence_helper" --file "$fixture/evidence.json" --service-arn "$service" --source-sha "$sha" \
    --region ap-southeast-1 --account 311414082667 --cluster watchdog-bms-uat
}
jq -n --arg serviceArn "$service" --arg sourceSha "$sha" --arg targetRevisionArn "$revision" \
  '{service:"api-web",serviceArn:$serviceArn,sourceSha:$sourceSha,noOp:true,deploymentArn:null,targetRevisionArn:$targetRevisionArn}' \
  > "$fixture/evidence.json"
test "$(evidence_run | jq -r '.noOp')" = true
jq --arg deploymentArn "$deployment" '.noOp=false | .deploymentArn=$deploymentArn' "$fixture/evidence.json" > "$fixture/evidence.tmp"
mv "$fixture/evidence.tmp" "$fixture/evidence.json"
test "$(evidence_run | jq -r '.deploymentArn')" = "$deployment"
jq '.noOp=true' "$fixture/evidence.json" > "$fixture/evidence.tmp" && mv "$fixture/evidence.tmp" "$fixture/evidence.json"
assert_exit 5 'no-op evidence carrying a deployment ARN' evidence_run
jq --arg sourceSha "$(printf 'b%.0s' {1..40})" '.noOp=false | .sourceSha=$sourceSha' "$fixture/evidence.json" \
  > "$fixture/evidence.tmp" && mv "$fixture/evidence.tmp" "$fixture/evidence.json"
assert_exit 5 'evidence from another source SHA' evidence_run

echo "release safety specs passed"
