#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
source_script="$repo_root/infra/uat/bootstrap-a5-readonly.sh"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-a5-bootstrap-spec.XXXXXX")"
trap 'rm -rf -- "$fixture"' EXIT

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

assert_contains() {
  grep -Fq -- "$2" "$1" || fail "expected '$2' in $1"
}

assert_not_contains() {
  if grep -Fq -- "$2" "$1"; then
    fail "did not expect '$2' in $1"
  fi
}

mkdir -p "$fixture/tree/infra/uat" "$fixture/tree/infra/prod-ecs-express" "$fixture/bin" "$fixture/cases"
cp "$source_script" "$fixture/tree/infra/uat/bootstrap-a5-readonly.sh"
cmp -s "$source_script" "$fixture/tree/infra/uat/bootstrap-a5-readonly.sh" \
  || fail "fixture is not an exact copy of bootstrap-a5-readonly.sh"
bash -n "$source_script"

cat > "$fixture/tree/infra/prod-ecs-express/verify-serving-api-build.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[ "$#" -eq 2 ]
[ "$1" = "uat" ]
[ "$2" = "$FAKE_EXPECTED_COMMIT" ]
EOF

cat > "$fixture/tree/infra/prod-ecs-express/run-release-task.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" > "$FAKE_RUNNER_MARKER"
[ "${DEPLOY_ENV:-}" = "uat" ]
[ "${AWS_ACCOUNT_ID:-}" = "311414082667" ]
[ "${DATABASE_URL_SECRET_ARN:-}" = "arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/database-url-AbCd12" ]
[ "${A5_READONLY_DATABASE_URL_SECRET_ARN:-}" = "arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/a5-readonly-database-url-EfGh34" ]
[ "$1" = "$FAKE_EXPECTED_IMAGE" ]
[ "$2" = "$FAKE_EXPECTED_COMMIT" ]
[ "$3" = "a5-bootstrap" ]
EOF

cat > "$fixture/bin/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  fetch) exit 0 ;;
  merge-base) exit 0 ;;
  *) echo "unexpected git call: $*" >&2; exit 90 ;;
esac
EOF

cat > "$fixture/bin/aws" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_AWS_LOG"
service="${1:-}"
operation="${2:-}"

case "$service/$operation" in
  sts/get-caller-identity)
    printf '%s\n' '311414082667'
    ;;
  ecr/describe-images)
    printf '%s\n' "sha256:${FAKE_EXPECTED_DIGEST}"
    ;;
  ecr/get-login-password)
    printf '%s\n' 'fake-ecr-password'
    ;;
  secretsmanager/describe-secret)
    secret_id=""
    while [ "$#" -gt 0 ]; do
      if [ "$1" = "--secret-id" ]; then
        secret_id="$2"
        break
      fi
      shift
    done
    if [ "$secret_id" = "watchdog-bms/uat/database-url" ]; then
      printf '%s\n' 'arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/database-url-AbCd12'
      exit 0
    fi
    case "$FAKE_A5_MODE" in
      resource_not_found|resource_not_found_create_ok)
        echo 'An error occurred (ResourceNotFoundException) when calling the DescribeSecret operation: secret not found' >&2
        exit 254
        ;;
      access_denied)
        echo 'An error occurred (AccessDeniedException) when calling the DescribeSecret operation: denied by policy' >&2
        exit 254
        ;;
      throttled)
        echo 'An error occurred (ThrottlingException) when calling the DescribeSecret operation: rate exceeded' >&2
        exit 254
        ;;
      wrong_arn)
        printf '%s\n' '{"arn":"arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/not-a5-readonly-EfGh34","description":"UAT-only SELECT credential for A5/F2 read paths"}'
        ;;
      wrong_description)
        printf '%s\n' '{"arn":"arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/a5-readonly-database-url-EfGh34","description":"wrong purpose"}'
        ;;
      *)
        printf '%s\n' '{"arn":"arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/a5-readonly-database-url-EfGh34","description":"UAT-only SELECT credential for A5/F2 read paths"}'
        ;;
    esac
    ;;
  secretsmanager/get-secret-value)
    printf '%s\n' 'postgresql://writer:password@db.example/watchdog'
    ;;
  secretsmanager/create-secret)
    if [ "$FAKE_A5_MODE" = "resource_not_found_create_ok" ]; then
      printf '%s\n' 'arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/a5-readonly-database-url-EfGh34'
      exit 0
    fi
    echo 'An error occurred (ServiceUnavailableException) when calling the CreateSecret operation: CreateSecretFailure' >&2
    exit 43
    ;;
  *)
    echo "unexpected aws call: $*" >&2
    exit 91
    ;;
esac
EOF

cat > "$fixture/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
docker_config="${DOCKER_CONFIG:-${HOME:?}/.docker}"
printf '%s|%s\n' "$docker_config" "$*" >> "$FAKE_DOCKER_LOG"
case "${1:-}" in
  login)
    IFS= read -r _password || true
    mkdir -p "$docker_config/cache/nested"
    printf '%s\n' '{"auths":{"fixture":{}}}' > "$docker_config/config.json"
    printf '%s\n' 'cosign-cache' > "$docker_config/cache/nested/state"
    if [ "$FAKE_A5_MODE" = "docker_login_fail" ]; then
      echo 'DockerLoginFailure' >&2
      exit 44
    fi
    ;;
  pull)
    ;;
  inspect)
    printf '%s\n' "$FAKE_EXPECTED_COMMIT"
    ;;
  *)
    echo "unexpected docker call: $*" >&2
    exit 92
    ;;
esac
EOF

cat > "$fixture/bin/cosign" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s|%s\n' "${DOCKER_CONFIG:-}" "$*" >> "$FAKE_COSIGN_LOG"
if [ "$FAKE_A5_MODE" = "cosign_fail" ]; then
  echo 'CosignFailure' >&2
  exit 45
fi
EOF

cat > "$fixture/bin/openssl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' 'deterministic-readonly-password'
EOF

cat > "$fixture/bin/node" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' 'postgresql://watchdog_a5_ro:deterministic-readonly-password@db.example/watchdog'
EOF

chmod +x "$fixture/tree/infra/prod-ecs-express/verify-serving-api-build.sh" \
  "$fixture/tree/infra/prod-ecs-express/run-release-task.sh" "$fixture/bin/"*

commit="cccccccccccccccccccccccccccccccccccccccc"
digest="dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
image="311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:$digest"

run_case() {
  local mode="$1"
  local case_tmp_env
  CASE_DIR="$fixture/cases/$mode"
  CASE_TMP="$CASE_DIR/tmp"
  mkdir -p "$CASE_TMP" "$CASE_DIR/home/.docker"
  CASE_TMP="$(cd -P -- "$CASE_TMP" && pwd)"
  case_tmp_env="$CASE_TMP"
  # macOS supplies TMPDIR with a trailing slash; exercise the exact cleanup shape.
  if [ "$mode" = "existing_ok" ]; then
    case_tmp_env="$CASE_TMP/"
  fi
  CASE_OUTPUT="$CASE_DIR/output"
  CASE_AWS_LOG="$CASE_DIR/aws.log"
  CASE_DOCKER_LOG="$CASE_DIR/docker.log"
  CASE_COSIGN_LOG="$CASE_DIR/cosign.log"
  CASE_RUNNER_MARKER="$CASE_DIR/release-task.called"
  printf '%s\n' '{"auths":{"user-owned":{"auth":"must-not-change"}}}' > "$CASE_DIR/home/.docker/config.json"
  cp "$CASE_DIR/home/.docker/config.json" "$CASE_DIR/user-docker-config.before"
  : > "$CASE_AWS_LOG"
  : > "$CASE_DOCKER_LOG"
  : > "$CASE_COSIGN_LOG"

  set +e
  PATH="$fixture/bin:$PATH" \
    AWS_BIN="$fixture/bin/aws" \
    AWS_REGION="ap-southeast-1" \
    HOME="$CASE_DIR/home" \
    TMPDIR="$case_tmp_env" \
    FAKE_A5_MODE="$mode" \
    FAKE_AWS_LOG="$CASE_AWS_LOG" \
    FAKE_DOCKER_LOG="$CASE_DOCKER_LOG" \
    FAKE_COSIGN_LOG="$CASE_COSIGN_LOG" \
    FAKE_RUNNER_MARKER="$CASE_RUNNER_MARKER" \
    FAKE_EXPECTED_COMMIT="$commit" \
    FAKE_EXPECTED_DIGEST="$digest" \
    FAKE_EXPECTED_IMAGE="$image" \
    bash "$fixture/tree/infra/uat/bootstrap-a5-readonly.sh" "$image" "$commit" \
      > "$CASE_OUTPUT" 2>&1
  CASE_STATUS=$?
  set -e

  cmp -s "$CASE_DIR/user-docker-config.before" "$CASE_DIR/home/.docker/config.json" \
    || fail "$mode changed the user's Docker config"
  while IFS='|' read -r used_config _command; do
    [ -n "$used_config" ] || continue
    case "$used_config" in
      "$CASE_TMP"/watchdog-a5-docker.*) ;;
      *) fail "$mode used Docker config outside its owned temporary directory: $used_config" ;;
    esac
    [ ! -e "$used_config" ] || fail "$mode left its temporary Docker config behind: $used_config"
  done < "$CASE_DOCKER_LOG"
  while IFS='|' read -r used_config _command; do
    [ -n "$used_config" ] || continue
    case "$used_config" in
      "$CASE_TMP"/watchdog-a5-docker.*) ;;
      *) fail "$mode gave cosign an unexpected Docker config: $used_config" ;;
    esac
  done < "$CASE_COSIGN_LOG"
  leftover="$(find "$CASE_TMP" -maxdepth 1 -name 'watchdog-a5-*' -print -quit)"
  [ -z "$leftover" ] || fail "$mode left a bootstrap secret or Docker directory behind: $leftover"
}

expect_failure_before_release() {
  local mode="$1"
  local message="$2"
  run_case "$mode"
  [ "$CASE_STATUS" -ne 0 ] || fail "$mode unexpectedly succeeded"
  assert_contains "$CASE_OUTPUT" "$message"
  [ ! -e "$CASE_RUNNER_MARKER" ] || fail "$mode reached the release task"
}

run_case existing_ok
[ "$CASE_STATUS" -eq 0 ] || fail "matching A5 secret metadata did not complete"
[ -e "$CASE_RUNNER_MARKER" ] || fail "matching A5 secret metadata did not reach the release task"
assert_contains "$CASE_OUTPUT" '[a5-bootstrap] complete secretCreated=false role=watchdog_a5_ro'

run_case resource_not_found_create_ok
[ "$CASE_STATUS" -eq 0 ] || fail "missing A5 secret was not created successfully"
[ -e "$CASE_RUNNER_MARKER" ] || fail "created A5 secret did not reach the release task"
assert_contains "$CASE_OUTPUT" '[a5-bootstrap] complete secretCreated=true role=watchdog_a5_ro'
assert_contains "$CASE_AWS_LOG" 'secretsmanager get-secret-value'
assert_contains "$CASE_AWS_LOG" 'secretsmanager create-secret'

expect_failure_before_release resource_not_found 'CreateSecretFailure'
assert_contains "$CASE_AWS_LOG" 'secretsmanager get-secret-value'
assert_contains "$CASE_AWS_LOG" 'secretsmanager create-secret'

expect_failure_before_release access_denied 'AccessDeniedException'
assert_not_contains "$CASE_AWS_LOG" 'secretsmanager get-secret-value'
assert_not_contains "$CASE_AWS_LOG" 'secretsmanager create-secret'

expect_failure_before_release throttled 'ThrottlingException'
assert_not_contains "$CASE_AWS_LOG" 'secretsmanager get-secret-value'
assert_not_contains "$CASE_AWS_LOG" 'secretsmanager create-secret'

expect_failure_before_release wrong_arn 'UAT A5 secret identity mismatch'
assert_not_contains "$CASE_AWS_LOG" 'secretsmanager get-secret-value'
assert_not_contains "$CASE_AWS_LOG" 'secretsmanager create-secret'

expect_failure_before_release wrong_description 'UAT A5 secret description mismatch'
assert_not_contains "$CASE_AWS_LOG" 'secretsmanager get-secret-value'
assert_not_contains "$CASE_AWS_LOG" 'secretsmanager create-secret'

expect_failure_before_release docker_login_fail 'DockerLoginFailure'
assert_not_contains "$CASE_AWS_LOG" 'secretsmanager'

expect_failure_before_release cosign_fail 'CosignFailure'
assert_not_contains "$CASE_AWS_LOG" 'secretsmanager'

echo "bootstrap-a5-readonly executable spec passed"
