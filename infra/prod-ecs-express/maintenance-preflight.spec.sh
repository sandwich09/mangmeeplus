#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runner="$repo_root/infra/prod-ecs-express/run-release-task.sh"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-maintenance-preflight.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

commit=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
image="311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:$(printf 'c%.0s' {1..64})"
readonly_secret=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/a5-readonly-database-url-aaaaaa

render() {
  local target="$1" deploy_env="${2:-production}" workflow=deploy-production.yml
  shift 2 || true
  [ "$deploy_env" = production ] || workflow=deploy-uat.yml
  env \
    DEPLOY_ENV="$deploy_env" AWS_ACCOUNT_ID=311414082667 RELEASE_TASK_RENDER_ONLY=true \
    A5_READONLY_DATABASE_URL_SECRET_ARN="$readonly_secret" RELEASE_DEPLOY_TARGET="$target" \
    GITHUB_ACTIONS=true GITHUB_RUN_ID=123 GITHUB_RUN_ATTEMPT=1 \
    GITHUB_ACTOR=operator GITHUB_ACTOR_ID=456 GITHUB_REPOSITORY=example/watchdog \
    GITHUB_WORKFLOW_REF="example/watchdog/.github/workflows/${workflow}@refs/heads/main" \
    "$@" bash "$runner" "$image" "$commit" maintenance-preflight
}

assert_rejected() {
  local label="$1" expected="$2"
  shift 2
  if "$@" >"$tmp_dir/$label.out" 2>"$tmp_dir/$label.err"; then
    echo "ERROR: maintenance-preflight accepted $label" >&2
    exit 1
  fi
  grep -Fq "$expected" "$tmp_dir/$label.err"
}

bash -n "$runner"
render all production > "$tmp_dir/task.json"
jq -e '
  .taskRoleArn == null
  and .containerDefinitions[0].name == "maintenance-preflight"
  and ([.containerDefinitions[0].secrets[].name] == ["DATABASE_URL"])
  and (.containerDefinitions[0].secrets[0].valueFrom | contains(":secret:watchdog-bms/production/a5-readonly-database-url-"))
  and ([.containerDefinitions[0].environment[] | select(.name == "PGOPTIONS") | .value]
    == ["-c default_transaction_read_only=on"])
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_OPERATION_ID" or .name == "RELEASE_PARENT_OPERATION_ID")]
    == [])
  and (.containerDefinitions[0].command[2] | contains("REQUIRE_NO_AWS_CREDENTIALS=true"))
  and (.containerDefinitions[0].command[2] | contains("verify-applied-migration-catalog.ts"))
  and (.containerDefinitions[0].command[2] | contains("verify-feature-launch-build-authority.ts") | not)
  and (.containerDefinitions[0].command[2] | contains("attest-feature-launch-build.ts") | not)
  and (.containerDefinitions[0].command[2] | contains("prisma migrate deploy") | not)
  and (.containerDefinitions[0].command[2] | contains("sync-") | not)
  and (.containerDefinitions[0].command[2] | contains("run-exclusive-release-operation.ts") | not)
' "$tmp_dir/task.json" >/dev/null

for target in api-web ai-gateway workers; do
  assert_rejected "target-$target" 'maintenance-preflight requires target=all' render "$target" production
done
assert_rejected uat 'maintenance-preflight is production read-only' render all uat
assert_rejected writer-secret 'rejects DATABASE_URL_SECRET_ARN' \
  render all production DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/database-url-aaaaaa

grep -Fq "if [ \"\$mode\" = maintenance-preflight ]" "$runner"
grep -Fq "printf 'RELEASE_DATABASE_COMPATIBILITY_PROVED_SHA=%s\\n' \"\$commit\"" "$runner"
grep -Fq "printf 'MAINTENANCE_BOOTSTRAP_READONLY_PROVED_SHA=%s\\n' \"\$commit\"" "$runner"

echo 'maintenance preflight release-task contract: PASS'
