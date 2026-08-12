#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
builder="$root/infra/security/build-production-a5-stage-context.sh"
consumer="$root/infra/security/validate-production-a5-stage-context.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/production-a5-context-producer.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
source_sha="$(printf 'a%.0s' {1..40})"
controller="$(printf 'b%.0s' {1..40})"
workflow_blob="$(printf 'c%.0s' {1..40})"
hash64="$(printf 'd%.0s' {1..64})"
repository=MangmeeDev/mangmeeplus
parent_run=6001
parent_attempt=2
parent_started=1700000000
created=1700000100

fail() { echo "ERROR: $*" >&2; exit 1; }
expect_reject() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then fail "$label was accepted"; fi
}
sha_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

mkdir "$work/inputs"
jq -cnS -L "$root/infra/security" 'include "evidence-contracts.fixtures";
  e0_fixture_reviewed_manifest' > "$work/inputs/manifest.json"
jq -cnS --arg source "$source_sha" '[
  {service:"ai-gateway",sourceCommit:$source},{service:"api-web",sourceCommit:$source},
  {service:"workers",sourceCommit:$source}]' > "$work/inputs/serving.json"
jq -cnS -L "$root/infra/security" --arg source "$source_sha" '
  include "evidence-contracts.fixtures"; e0_fixture_reimbursement_quiesce("PRE_MUTATION";$source)
' > "$work/inputs/quiesce-pre.json"
jq -cnS -L "$root/infra/security" '
  include "evidence-contracts.fixtures"; {
    sourceAppliedMigrationsHash:e0_fixture_hash,cloneRehearsal:e0_fixture_clone_rehearsal,
    cloneRehearsalRef:e0_fixture_ref("PRODUCTION_A5_CLONE_REHEARSAL_V1")}
' > "$work/inputs/invariant-pre.json"
printf '%s\n' null > "$work/inputs/null.json"

build() {
  local output="$1" stage="$2" quiesce="$3" invariant="$4" pre="$5" post="$6"
  mkdir "$output"
  A5_CONTEXT_CREATED_AT_EPOCH="$created" bash "$builder" "$output" "$stage" "$source_sha" \
    "$repository" "$parent_run" "$parent_attempt" "$controller" "$workflow_blob" \
    "$parent_started" "$work/inputs/manifest.json" "$work/inputs/serving.json" "$quiesce" \
    "$invariant" "$pre" "$post"
}

pre="$work/pre"
pre_name="$(build "$pre" PRE_MUTATION "$work/inputs/quiesce-pre.json" \
  "$work/inputs/invariant-pre.json" "$work/inputs/null.json" "$work/inputs/null.json")"
[ "$pre_name" = "production-a5-stage-context-PRE_MUTATION-${source_sha}-production-${parent_run}-attempt-${parent_attempt}" ]
jq -e --arg hash "$(jq -cS 'del(.contentSha256)' "$pre/context.json" | {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'
  else shasum -a 256 | awk '{print $1}'; fi
})" '.contentSha256==$hash and .stage=="PRE_MUTATION" and .priorEvidence=={
  preMutationRef:null,postMigrationRef:null}' "$pre/context.json" >/dev/null

# Prove the producer bytes pass the independent artifact transport/parent consumer.
(cd "$pre" && zip -q -X "$work/pre.zip" context.json)
jq -cnS --arg name "$pre_name" --arg digest "sha256:$(sha_file "$work/pre.zip")" \
  --arg controller "$controller" --argjson size "$(wc -c < "$work/pre.zip" | tr -d '[:space:]')" '
    {total_count:1,artifacts:[{id:7,name:$name,expired:false,digest:$digest,size_in_bytes:$size,
      workflow_run:{id:6001,head_sha:$controller}}]}
' > "$work/pre-artifacts.json"
mkdir "$work/consumed"
bash "$consumer" "$work/pre.zip" "$work/pre-artifacts.json" "$work/consumed" PRE_MUTATION \
  "$source_sha" "$repository" "$parent_run" "$parent_attempt" "$controller" "$workflow_blob" \
  "$parent_started" 1700000200 "$work/inputs/null.json" "$work/inputs/null.json" >/dev/null
cmp -s "$pre/context.json" "$work/consumed/context.json"

pre_ref="$work/inputs/pre-ref.json"
post_ref="$work/inputs/post-ref.json"
jq -cnS -L "$root/infra/security" 'include "evidence-contracts.fixtures";
  e0_fixture_ref("PRODUCTION_A5_EVIDENCE_V1")' > "$pre_ref"
jq -cS '.producerRunId="7002" | .artifactName="post-migration"' "$pre_ref" > "$post_ref"
jq -cnS -L "$root/infra/security" --arg source "$source_sha" '
  include "evidence-contracts.fixtures";
  e0_fixture_reimbursement_quiesce("POST_MIGRATION";$source)
' > "$work/inputs/quiesce-post-migration.json"
jq -cnS -L "$root/infra/security" '
  include "evidence-contracts.fixtures"; {
    sourceAppliedMigrationsHash:e0_fixture_hash,executedMigrations:e0_fixture_executed_migrations,
    executionBudgetResults:e0_fixture_production_budget_results,
    productionApplyAuthority:(e0_fixture_h2("POST_MIGRATION";e0_fixture_sha)
      .migrationState.productionApplyAuthority)}
' > "$work/inputs/invariant-post-migration.json"
post_migration_name="$(build "$work/post-migration" POST_MIGRATION \
  "$work/inputs/quiesce-post-migration.json" "$work/inputs/invariant-post-migration.json" \
  "$pre_ref" "$work/inputs/null.json")"
[ "$post_migration_name" = "production-a5-stage-context-POST_MIGRATION-${source_sha}-production-${parent_run}-attempt-${parent_attempt}" ]

jq -cnS -L "$root/infra/security" --arg source "$source_sha" '
  include "evidence-contracts.fixtures";
  e0_fixture_reimbursement_quiesce("POST_DEPLOYMENT";$source)
' > "$work/inputs/quiesce-post-deployment.json"
jq -cnS -L "$root/infra/security" '
  include "evidence-contracts.fixtures"; {
    sourceAppliedMigrationsHash:e0_fixture_hash,
    productionApplyAuthority:(e0_fixture_h2("POST_DEPLOYMENT";e0_fixture_sha)
      .migrationState.productionApplyAuthority)}
' > "$work/inputs/invariant-post-deployment.json"
post_deployment_name="$(build "$work/post-deployment" POST_DEPLOYMENT \
  "$work/inputs/quiesce-post-deployment.json" "$work/inputs/invariant-post-deployment.json" \
  "$pre_ref" "$post_ref")"
[ "$post_deployment_name" = "production-a5-stage-context-POST_DEPLOYMENT-${source_sha}-production-${parent_run}-attempt-${parent_attempt}" ]

jq -cS 'del(.cloneRehearsalRef)' "$work/inputs/invariant-pre.json" > "$work/bad-invariant.json"
expect_reject missing-clone build "$work/reject-clone" PRE_MUTATION \
  "$work/inputs/quiesce-pre.json" "$work/bad-invariant.json" \
  "$work/inputs/null.json" "$work/inputs/null.json"
jq -cS '.unexpected="must-be-rejected"' "$work/inputs/invariant-pre.json" \
  > "$work/extra-invariant.json"
expect_reject extra-invariant build "$work/reject-extra-invariant" PRE_MUTATION \
  "$work/inputs/quiesce-pre.json" "$work/extra-invariant.json" \
  "$work/inputs/null.json" "$work/inputs/null.json"
jq -cS 'del(.productionApplyAuthority)' "$work/inputs/invariant-post-migration.json" \
  > "$work/bad-authority.json"
expect_reject missing-authority build "$work/reject-authority" POST_MIGRATION \
  "$work/inputs/quiesce-post-migration.json" "$work/bad-authority.json" \
  "$pre_ref" "$work/inputs/null.json"
expect_reject wrong-stage-ref build "$work/reject-ref" PRE_MUTATION \
  "$work/inputs/quiesce-pre.json" "$work/inputs/invariant-pre.json" "$pre_ref" "$work/inputs/null.json"
jq -cS '.unexpected="must-be-rejected"' "$pre_ref" > "$work/extra-pre-ref.json"
expect_reject extra-pre-ref build "$work/reject-extra-pre-ref" POST_MIGRATION \
  "$work/inputs/quiesce-post-migration.json" "$work/inputs/invariant-post-migration.json" \
  "$work/extra-pre-ref.json" "$work/inputs/null.json"
jq -cS '.unexpected="must-be-rejected"' "$post_ref" > "$work/extra-post-ref.json"
expect_reject extra-post-ref build "$work/reject-extra-post-ref" POST_DEPLOYMENT \
  "$work/inputs/quiesce-post-deployment.json" "$work/inputs/invariant-post-deployment.json" \
  "$pre_ref" "$work/extra-post-ref.json"
printf ' {"schemaVersion":3}\n' > "$work/noncanonical.json"
expect_reject noncanonical build "$work/reject-canonical" PRE_MUTATION \
  "$work/inputs/quiesce-pre.json" "$work/inputs/invariant-pre.json" \
  "$work/inputs/null.json" "$work/noncanonical.json"
mkdir "$work/not-empty"
printf x > "$work/not-empty/existing"
expect_reject nonempty env A5_CONTEXT_CREATED_AT_EPOCH="$created" bash "$builder" \
  "$work/not-empty" PRE_MUTATION "$source_sha" "$repository" "$parent_run" "$parent_attempt" \
  "$controller" "$workflow_blob" "$parent_started" "$work/inputs/manifest.json" \
  "$work/inputs/serving.json" "$work/inputs/quiesce-pre.json" "$work/inputs/invariant-pre.json" \
  "$work/inputs/null.json" "$work/inputs/null.json"

bash -n "$builder" "$consumer"
printf 'production-a5-stage-context-producer.spec: PASS\n'
