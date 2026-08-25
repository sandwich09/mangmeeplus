#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runner="$repo_root/infra/prod-ecs-express/run-release-task.sh"
workflow="$repo_root/.github/workflows/system-admin-cutover.yml"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-system-admin-cutover.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

commit=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
image="311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:$(printf 'c%.0s' {1..64})"
database_secret=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/database-url-aaaaaa
password_secret=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/system-admin-cutover-password-bbbbbb

render_add() {
  env \
    DEPLOY_ENV=production AWS_ACCOUNT_ID=311414082667 RELEASE_TASK_RENDER_ONLY=true \
    DATABASE_URL_SECRET_ARN="$database_secret" SYSTEM_ADMIN_PASSWORD_SECRET_ARN="$password_secret" \
    SYSTEM_ADMIN_CUTOVER_API_BASE_URL=https://example.ecs.ap-southeast-1.on.aws/v1 \
    ADMIN_USERNAME=prodmangmeeplus ADMIN_DISPLAY_NAME='Production System Admin' \
    SYSTEM_ADMIN_CUTOVER_APPROVAL_REF=owner-approved:2026-08-25:system-admin-cutover \
    GITHUB_ACTIONS=true GITHUB_RUN_ID=123 GITHUB_RUN_ATTEMPT=1 \
    GITHUB_ACTOR=MangmeeDev GITHUB_ACTOR_ID=456 GITHUB_REPOSITORY=MangmeeDev/mangmeeplus \
    GITHUB_WORKFLOW_REF=MangmeeDev/mangmeeplus/.github/workflows/system-admin-cutover.yml@refs/heads/main \
    "$@" bash "$runner" "$image" "$commit" system-admin-add
}

render_revoke() {
  env \
    DEPLOY_ENV=production AWS_ACCOUNT_ID=311414082667 RELEASE_TASK_RENDER_ONLY=true \
    DATABASE_URL_SECRET_ARN="$database_secret" \
    ADMIN_USERNAME=prodmangmeeplus ADMIN_DISPLAY_NAME='Production System Admin' \
    ADMIN_SOURCE_USERNAME=thawatchai.watchdog \
    SYSTEM_ADMIN_CUTOVER_APPROVAL_REF=owner-approved:2026-08-25:system-admin-cutover \
    GITHUB_ACTIONS=true GITHUB_RUN_ID=124 GITHUB_RUN_ATTEMPT=1 \
    GITHUB_ACTOR=MangmeeDev GITHUB_ACTOR_ID=456 GITHUB_REPOSITORY=MangmeeDev/mangmeeplus \
    GITHUB_WORKFLOW_REF=MangmeeDev/mangmeeplus/.github/workflows/system-admin-cutover.yml@refs/heads/main \
    "$@" bash "$runner" "$image" "$commit" system-admin-revoke
}

reject() {
  local label="$1" expected="$2"
  shift 2
  if "$@" >"$tmp_dir/$label.out" 2>"$tmp_dir/$label.err"; then
    echo "ERROR: cutover accepted $label" >&2
    exit 1
  fi
  grep -Fq "$expected" "$tmp_dir/$label.err"
}

bash -n "$runner"
ruby -e 'require "yaml"; YAML.safe_load(File.read(ARGV.fetch(0)), aliases: true)' "$workflow"

render_add > "$tmp_dir/add.json"
jq -e --arg database "$database_secret" --arg password "$password_secret" '
  .taskRoleArn == null
  and .containerDefinitions[0].name == "system-admin-add"
  and .containerDefinitions[0].command == ["/bin/sh","-lc",
    "set -eu; ./node_modules/.bin/tsx prisma/system-admin-cutover.ts"]
  and .containerDefinitions[0].secrets == [
    {name:"DATABASE_URL",valueFrom:$database},
    {name:"ADMIN_PASSWORD",valueFrom:$password}]
  and ([.containerDefinitions[0].environment[]|select(.name=="SYSTEM_ADMIN_CUTOVER_MODE")|.value]==["ADD"])
  and ([.containerDefinitions[0].environment[]|select(.name=="ADMIN_USERNAME")|.value]==["prodmangmeeplus"])
  and ([.containerDefinitions[0].environment[]|select(.name=="SYSTEM_ADMIN_CUTOVER_REQUEST_ID")|.value]
    ==["system-admin-cutover:123:system-admin-add"])
  and ([.containerDefinitions[0].environment[]|select(.name=="SYSTEM_ADMIN_CUTOVER_API_BASE_URL")|.value]
    ==["https://example.ecs.ap-southeast-1.on.aws/v1"])
  and ([.containerDefinitions[0].environment[]|select(.name=="ADMIN_PASSWORD")]|length)==0
  and ([.containerDefinitions[0].environment[]|select(.value|contains("temporary"))]|length)==0
' "$tmp_dir/add.json" >/dev/null

render_revoke > "$tmp_dir/revoke.json"
jq -e --arg database "$database_secret" '
  .taskRoleArn == null
  and .containerDefinitions[0].name == "system-admin-revoke"
  and .containerDefinitions[0].secrets == [{name:"DATABASE_URL",valueFrom:$database}]
  and ([.containerDefinitions[0].environment[]|select(.name=="SYSTEM_ADMIN_CUTOVER_MODE")|.value]==["REVOKE"])
  and ([.containerDefinitions[0].environment[]|select(.name=="ADMIN_SOURCE_USERNAME")|.value]==["thawatchai.watchdog"])
  and ([.containerDefinitions[0].environment[]|select(.name=="SYSTEM_ADMIN_CUTOVER_API_BASE_URL")]|length)==0
' "$tmp_dir/revoke.json" >/dev/null

reject uat 'System Admin cutover is Production-only' render_add DEPLOY_ENV=uat
reject username 'ADMIN_USERNAME has an invalid username shape' render_add ADMIN_USERNAME='Bad Name'
reject plaintext 'plaintext ADMIN_PASSWORD is forbidden' render_add ADMIN_PASSWORD=not-allowed
reject source 'system-admin-add rejects ADMIN_SOURCE_USERNAME' render_add ADMIN_SOURCE_USERNAME=thawatchai.watchdog
reject secret 'not the fixed Production cutover secret' render_add \
  SYSTEM_ADMIN_PASSWORD_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/other-aaaaaa
reject workflow 'must be controlled by' render_add \
  GITHUB_WORKFLOW_REF=MangmeeDev/mangmeeplus/.github/workflows/deploy-production-v2.yml@refs/heads/main
reject revoke-source 'requires a different valid ADMIN_SOURCE_USERNAME' render_revoke ADMIN_SOURCE_USERNAME=prodmangmeeplus
reject revoke-secret 'system-admin-revoke rejects SYSTEM_ADMIN_PASSWORD_SECRET_ARN' render_revoke \
  SYSTEM_ADMIN_PASSWORD_SECRET_ARN="$password_secret"

grep -Fq 'group: watchdog-bms-production-deploy' "$workflow"
grep -Fq 'test "$GITHUB_ACTOR" = "$owner"' "$workflow"
grep -Fq 'validate-uat-release-passport-v2.sh' "$workflow"
grep -Fq 'purpose=="release-task"' "$workflow"
grep -Fq 'system-admin-cutover-password' "$workflow"
if grep -Eq 'secretsmanager (get-secret-value|create-secret|put-secret-value)' "$workflow"; then
  echo 'ERROR: GitHub controller can read or write the temporary password value' >&2
  exit 1
fi

echo 'Production System Admin cutover contract: PASS'
