#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
workflow="$repo_root/.github/workflows/deploy-production.yml"
runner="$repo_root/infra/prod-ecs-express/run-release-task.sh"
intent="$repo_root/infra/docker/validate-production-release-intent.sh"
resolver="$repo_root/infra/docker/resolve-production-fast-mode.sh"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/production-fast-promotion.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

bash -n "$runner"
bash -n "$intent"
bash -n "$resolver"
bash "$repo_root/infra/docker/resolve-production-fast-mode.spec.sh" >/dev/null

grep -Fq 'default: auto' "$workflow"
grep -Fq 'needs.resolve-release.outputs.release_mode == '\''fast-promotion'\''' "$workflow"
grep -Fq 'bash infra/docker/resolve-production-fast-mode.sh "$GITHUB_WORKSPACE"' "$workflow"
grep -Fq 'diff --quiet --no-renames' "$resolver"
grep -Fq 'fast promotion cannot prove the Production database-code baseline' "$resolver"
grep -Fq 'fast promotion detected Prisma/schema/migration support changes' "$resolver"
grep -Fq 'effective_release_mode=maintenance-bootstrap' "$resolver"
grep -Fq 'release_mode=$effective_release_mode' "$workflow"
grep -Fq 'RELEASE_MODE: ${{ steps.production-target.outputs.release_mode }}' "$workflow"
grep -Fq 'RELEASE_DEPLOY_TARGET: ${{ steps.production-target.outputs.target }}' "$workflow"
grep -Fq 'TARGET: ${{ steps.production-target.outputs.target }}' "$workflow"
grep -Fq 'RELEASE_DATABASE_AUTHORITY=UAT_ACCEPTED_NO_MIGRATION' "$workflow"
grep -Fq 'RELEASE_DATABASE_AUTHORITY=U5_REVIEWED_APPLY' "$workflow"
grep -Fq 'needs.resolve-release.outputs.release_mode == '\''promotion'\''' "$workflow"
if grep -Fq 'test "$BRIDGE_SOURCE" != "$SOURCE_SHA"' "$workflow"; then
  echo 'ERROR: reviewed promotion still requires a synthetic different bridge source' >&2
  exit 1
fi

# Application publication is incident-only. Both coordinated promotion modes consume
# the exact signed UAT artifact and therefore cannot start reusable source CI.
build_job="$(sed -n '/^  build_and_publish:/,/^  deploy:/p' "$workflow")"
grep -Fq "if: needs.resolve-release.outputs.release_mode == 'partial-incident'" <<< "$build_job"
if grep -Fq 'fast-promotion' <<< "$build_job"; then
  echo 'ERROR: fast promotion may not enter source CI/image publication' >&2
  exit 1
fi

fast_command="$(sed -n '/UAT_ACCEPTED_NO_MIGRATION)/,/^[[:space:]]*;;/p' "$runner")"
grep -Fq 'verify-applied-migration-catalog.ts' <<< "$fast_command"
grep -Fq 'sync-permissions.ts' <<< "$fast_command"
grep -Fq 'sync-workflow-templates.ts' <<< "$fast_command"
grep -Fq 'sync-thai-address-master.ts' <<< "$fast_command"
grep -Fq 'normalize-entitlements.ts --dry-run --allow-exceptions' <<< "$fast_command"
if grep -Fq 'prisma migrate deploy' <<< "$fast_command"; then
  echo 'ERROR: fast promotion may not run a migration writer' >&2
  exit 1
fi

verify_line="$(grep -n -m1 'verify-applied-migration-catalog.ts; ./node_modules/.bin/tsx prisma/sync-permissions.ts' "$runner" | cut -d: -f1)"
sync_line="$(grep -n -m1 'UAT_ACCEPTED_NO_MIGRATION requires the verified fast-promotion acceptance' "$runner" | cut -d: -f1)"
test "$sync_line" -lt "$verify_line"

source_sha="$(git rev-parse HEAD)"
image="311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:$(printf 'c%.0s' {1..64})"
render_fast() {
  env GITHUB_ACTIONS=true GITHUB_RUN_ID=12345 GITHUB_RUN_ATTEMPT=1 \
    GITHUB_ACTOR=release-operator GITHUB_ACTOR_ID=67890 GITHUB_REPOSITORY=example/watchdog \
    GITHUB_WORKFLOW_REF=example/watchdog/.github/workflows/deploy-production.yml@refs/heads/main \
    AWS_ACCOUNT_ID=311414082667 DEPLOY_ENV=production \
    DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/database-url-aaaaaa \
    RELEASE_TASK_RENDER_ONLY=true RELEASE_DEPLOY_TARGET=api-web \
    RELEASE_DATABASE_AUTHORITY=UAT_ACCEPTED_NO_MIGRATION RELEASE_MODE=fast-promotion \
    UAT_ACCEPTANCE_SHA256="${UAT_ACCEPTANCE_SHA256:-$(printf 'a%.0s' {1..64})}" \
    RELEASE_MANIFEST_SHA256="${RELEASE_MANIFEST_SHA256:-$(printf 'b%.0s' {1..64})}" \
    bash "$runner" "$image" "$source_sha" release-prepare
}

render_fast > "$fixture/task.json"
jq -e '
  .containerDefinitions[0].name == "release-prepare"
  and .containerDefinitions[0].command[2] == "./node_modules/.bin/tsx prisma/run-exclusive-release-operation.ts"
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_DEPLOY_TARGET") | .value] == ["api-web"])
  and ([.containerDefinitions[0].environment[] | select(.name == "RELEASE_OPERATION_COMMAND") | .value][0] as $command
    | ($command | startswith("set -eu; ./node_modules/.bin/tsx prisma/verify-applied-migration-catalog.ts;"))
    and ($command | contains("prisma/sync-permissions.ts"))
    and ($command | contains("prisma/attest-feature-launch-build.ts"))
    and ($command | contains("prisma migrate deploy") | not))
' "$fixture/task.json" >/dev/null

if UAT_ACCEPTANCE_SHA256=bad render_fast >/dev/null 2>&1; then
  echo 'ERROR: fast release accepted a malformed UAT acceptance hash' >&2
  exit 1
fi

echo 'production fast promotion: PASS'
