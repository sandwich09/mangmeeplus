#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
runner="$root/infra/prod-ecs-express/run-release-task.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/production-ready-release-task.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
source_sha="$(git -C "$root" rev-parse HEAD)"
image="311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:$(printf 'c%.0s' {1..64})"

render() {
  env GITHUB_ACTIONS=true GITHUB_RUN_ID=10001 GITHUB_RUN_ATTEMPT=1 \
    GITHUB_ACTOR=release-operator GITHUB_ACTOR_ID=12345 GITHUB_REPOSITORY=example/watchdog \
    GITHUB_WORKFLOW_REF="${CONTROLLER_WORKFLOW:-example/watchdog/.github/workflows/deploy-production-v2.yml@refs/heads/main}" \
    AWS_ACCOUNT_ID=311414082667 DEPLOY_ENV=production RELEASE_TASK_RENDER_ONLY=true \
    DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/database-url-aaaaaa \
    RELEASE_MODE=passport-promotion RELEASE_DEPLOY_TARGET="${RELEASE_DEPLOY_TARGET:-all}" \
    RELEASE_DATABASE_AUTHORITY=PRODUCTION_READY_V2 \
    PRODUCTION_READY_V2_SHA256="${PRODUCTION_READY_V2_SHA256:-$(printf '1%.0s' {1..64})}" \
    PRODUCTION_READY_REPOSITORY_CATALOG_HASH="${PRODUCTION_READY_REPOSITORY_CATALOG_HASH:-$(printf '2%.0s' {1..64})}" \
    PRODUCTION_READY_APPLIED_CATALOG_HASH="${PRODUCTION_READY_APPLIED_CATALOG_HASH:-$(printf '3%.0s' {1..64})}" \
    PRODUCTION_READY_PENDING_CATALOG_HASH="${PRODUCTION_READY_PENDING_CATALOG_HASH:-$(printf '4%.0s' {1..64})}" \
    PRODUCTION_READY_PENDING_COUNT="${PRODUCTION_READY_PENDING_COUNT:-2}" \
    bash "$runner" "$image" "$source_sha" release-prepare
}
render > "$work/task.json"
jq -e '
  .containerDefinitions[0].name=="release-prepare"
  and ([.containerDefinitions[0].environment[]|select(.name=="PRODUCTION_READY_V2_SHA256")|.value]
    ==[("1"*64)])
  and ([.containerDefinitions[0].environment[]|select(.name=="PRODUCTION_READY_PENDING_COUNT")|.value]
    ==["2"])
  and ([.containerDefinitions[0].environment[]|select(.name=="RELEASE_OPERATION_COMMAND")|.value][0] as $c
    | ($c|startswith("set -eu; ./node_modules/.bin/tsx prisma/verify-production-ready-migration.ts;"))
    and ($c|contains("prisma migrate deploy"))
    and ($c|contains("verify-applied-migration-catalog.ts"))
    and ($c|contains("attest-feature-launch-build.ts")))
' "$work/task.json" >/dev/null

reject() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then echo "ERROR: READY release task accepted $label" >&2; exit 1; fi
}
PRODUCTION_READY_V2_SHA256=bad reject malformed-ready-hash render
PRODUCTION_READY_PENDING_COUNT=-1 reject negative-pending-count render
reject ready-values-without-authority env GITHUB_ACTIONS=true GITHUB_RUN_ID=1 GITHUB_RUN_ATTEMPT=1 \
  GITHUB_ACTOR=x GITHUB_ACTOR_ID=1 GITHUB_REPOSITORY=example/watchdog \
  GITHUB_WORKFLOW_REF=example/watchdog/.github/workflows/deploy-production-v2.yml@refs/heads/main \
  AWS_ACCOUNT_ID=311414082667 DEPLOY_ENV=production RELEASE_TASK_RENDER_ONLY=true \
  DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/database-url-aaaaaa \
  PRODUCTION_READY_V2_SHA256="$(printf '1%.0s' {1..64})" bash "$runner" "$image" "$source_sha" release
CONTROLLER_WORKFLOW=example/watchdog/.github/workflows/arbitrary.yml@refs/heads/main \
  reject arbitrary-controller render
bash -n "$runner"
echo 'production READY release-task authority: PASS'
