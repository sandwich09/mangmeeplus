#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
# shellcheck source=infra/security/signed-evidence.sh
source "$repo_root/infra/security/signed-evidence.sh"

fixture="$(mktemp -d "${TMPDIR:-/tmp}/signed-evidence-spec.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

fail() { echo "ERROR: $*" >&2; exit 1; }
expect_reject() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then fail "$label was accepted"; fi
}
expect_zip_reject() {
  local label="$1" archive="$2"
  local extracted
  expect_reject "$label-inspect" signed_evidence_inspect_zip "$archive"
  if extracted="$(signed_evidence_extract_zip "$archive" 2>/dev/null)"; then
    rm -rf "$extracted"
    fail "$label-extract was accepted"
  fi
}

source_sha="$(printf '1%.0s' {1..40})"
controller_sha="$(printf '2%.0s' {1..40})"
workflow_blob="$(printf '3%.0s' {1..40})"
parent_controller="$(printf '4%.0s' {1..40})"
parent_blob="$(printf '5%.0s' {1..40})"
issued=1700000000
expires=1700003600
now=1700000100
producer_started=1699999950
parent_started=1699999900
producer_started_iso="$(jq -nr --argjson epoch "$producer_started" '$epoch | todateiso8601')"
parent_started_iso="$(jq -nr --argjson epoch "$parent_started" '$epoch | todateiso8601')"

expected="$fixture/expected.json"
jq -cnS \
  --arg source "$source_sha" --arg controller "$controller_sha" \
  --arg workflowBlob "$workflow_blob" --arg parentController "$parent_controller" \
  --arg parentBlob "$parent_blob" --argjson producerStarted "$producer_started" \
  --argjson parentStarted "$parent_started" '
  {
    artifactKind:"PRODUCTION_A5_EVIDENCE_V1",
    repository:"MangmeeDev/mangmeeplus",
    environment:"production",
    sourceCommit:$source,
    producer:{
      workflowPath:".github/workflows/production-a5.yml",
      controllerCommit:$controller,
      workflowBlob:$workflowBlob,
      runId:"9001",
      runAttempt:2,
      actor:"MangmeeDev",
      triggeringActor:"MangmeeDev",
      startedAtEpoch:$producerStarted
    },
    parentProductionRun:{
      controllerCommit:$parentController,
      workflowBlob:$parentBlob,
      runId:"8001",
      runAttempt:3,
      startedAtEpoch:$parentStarted
    },
    lifetimeSeconds:3600
  }
' > "$expected"

base="$fixture/base.json"
jq -cnS \
  --arg source "$source_sha" --arg controller "$controller_sha" \
  --arg workflowBlob "$workflow_blob" --arg parentController "$parent_controller" \
  --arg parentBlob "$parent_blob" --arg zero "$(printf '0%.0s' {1..64})" \
  --argjson issued "$issued" --argjson expires "$expires" '
  {
    schemaVersion:1,
    artifactKind:"PRODUCTION_A5_EVIDENCE_V1",
    repository:"MangmeeDev/mangmeeplus",
    environment:"production",
    sourceCommit:$source,
    producer:{
      workflowPath:".github/workflows/production-a5.yml",
      workflowRef:"refs/heads/main",
      controllerCommit:$controller,
      workflowBlob:$workflowBlob,
      runId:"9001",
      runAttempt:2,
      event:"workflow_dispatch",
      actor:"MangmeeDev",
      triggeringActor:"MangmeeDev"
    },
    parentProductionRun:{
      workflowPath:".github/workflows/deploy-production.yml",
      controllerCommit:$parentController,
      workflowBlob:$parentBlob,
      runId:"8001",
      runAttempt:3
    },
    issuedAtEpoch:$issued,
    expiresAtEpoch:$expires,
    payload:{stage:"PRE_MUTATION"},
    contentSha256:$zero
  }
' > "$base"

contract_hash() {
  jq -cjS "$2" "$1" | signed_evidence_sha256_stream
}
set_contract_hash() {
  local file="$1" path="$2" value_filter="$3" value tmp
  value="$(contract_hash "$file" "$value_filter")"
  tmp="$(mktemp "$fixture/contract-hash.XXXXXX")"
  jq -cS --arg value "$value" "$path = \$value" "$file" > "$tmp"
  mv "$tmp" "$file"
}
set_raw_string_hash() {
  local file="$1" path="$2" value_filter="$3" value tmp
  value="$(jq -erj "$value_filter" "$file" | signed_evidence_sha256_stream)"
  tmp="$(mktemp "$fixture/contract-string-hash.XXXXXX")"
  jq -cS --arg value "$value" "$path = \$value" "$file" > "$tmp"
  mv "$tmp" "$file"
}
set_reader_payload_binding() {
  local file="$1" canonical hash bytes tmp
  canonical="$(mktemp "$fixture/reader-payload.XXXXXX")"
  jq -cS '.payload | del(.currentHealth,.readerRuntime)
    | .migrationState |= del(.productionApplyAuthority)' "$file" > "$canonical"
  hash="$(_signed_evidence_sha256_file "$canonical")"
  bytes="$(_signed_evidence_file_size "$canonical")"
  tmp="$(mktemp "$fixture/reader-binding.XXXXXX")"
  jq -cS --arg hash "$hash" --argjson bytes "$bytes" '
    .payload.readerRuntime.output.payloadSha256=$hash
    | .payload.readerRuntime.output.payloadBytes=$bytes
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
  rm -f -- "$canonical"
}
rehash_h2_contract() {
  local file="$1" result status tmp service_index raw_name
  for service_index in 0 1 2; do
    for raw_name in describeExpressGatewayService describeServiceRevisions listTasks describeTasks \
      describeNetworkInterfaces describeTargetGroups describeTargetHealth ssmParameter publicHealth; do
      set_contract_hash "$file" \
        ".payload.currentHealth.services[$service_index].rawEvidence.${raw_name}.sha256" \
        ".payload.currentHealth.services[$service_index].rawEvidence.${raw_name}.raw"
    done
  done
  set_contract_hash "$file" '.payload.currentHealth.servicesHash' '.payload.currentHealth.services'
  set_contract_hash "$file" '.payload.migrationState.reviewedMigrationOperationsHash' \
    '.payload.migrationState.reviewedManifest.reviewedMigrationManifest'
  set_contract_hash "$file" '.payload.migrationState.candidateMigrationSetHash' \
    '.payload.migrationState.reviewedManifest.reviewedMigrationManifest
      | map({relativePath,migrationName,checksumSha256})'
  set_contract_hash "$file" '.payload.migrationState.expectedDataTransformHash' \
    '.payload.migrationState.reviewedManifest.reviewedMigrationManifest
      | map(select(.operationClass == "DATA_BACKFILL")
        | {relativePath,checksumSha256,invariants:.postDataInvariants})'
  set_contract_hash "$file" '.payload.migrationState.preflightCatalogHash' \
    '.payload.migrationState.reviewedManifest.reviewedMigrationManifest | map({relativePath,preconditions})'
  set_contract_hash "$file" '.payload.migrationState.lockBudgetPolicyHash' \
    '.payload.migrationState.reviewedManifest.reviewedMigrationManifest | map({relativePath,executionBudget})'
  set_contract_hash "$file" '.payload.migrationState.expectedSeededRouteHash' \
    '.payload.migrationState.reviewedManifest.expectedSeededRoutes'
  set_contract_hash "$file" '.payload.migrationState.expectedClosedWhtRouteHash' \
    '.payload.migrationState.reviewedManifest.expectedClosedWhtRoutes'
  set_contract_hash "$file" '.payload.migrationState.expectedSchemaDeltaHash' \
    '.payload.migrationState.reviewedManifest as $m
      | ($m.preSchemaCatalogObjects | map({key:([.kind,.schema,(.relation // ""),.name]|join("\u0000")),value:.}) | from_entries) as $before
      | ($m.postSchemaCatalogObjects | map({key:([.kind,.schema,(.relation // ""),.name]|join("\u0000")),value:.}) | from_entries) as $after
      | (($before|keys) + ($after|keys) | unique | sort)
      | map(select(($before[.] // null) != ($after[.] // null))
          | {key:.,before:($before[.] // null),after:($after[.] // null)})'
  for result in preconditionResults postSchemaResults postDataResults; do
    status="$(jq -r --arg result "$result" \
      '.payload.migrationState.verificationEvidence[$result].status' "$file")"
    if [ "$status" = VERIFIED ]; then
      set_contract_hash "$file" \
        ".payload.migrationState.verificationEvidence.${result}.resultsHash" \
        ".payload.migrationState.verificationEvidence.${result}.results"
    fi
  done
  set_contract_hash "$file" \
    '.payload.migrationState.verificationEvidence.preconditionResults.resultsHash' \
    '.payload.migrationState.verificationEvidence.preconditionResults.results'
  if [ "$(jq -r '.payload.migrationState.verificationEvidence.executedMigrations.status' "$file")" = VERIFIED ]; then
    set_contract_hash "$file" \
      '.payload.migrationState.verificationEvidence.executedMigrations.migrationsHash' \
      '.payload.migrationState.verificationEvidence.executedMigrations.migrations'
  fi
  set_contract_hash "$file" '.payload.migrationState.verificationEvidence.executionBudgetResultsHash' \
    '.payload.migrationState.verificationEvidence.executionBudgetResults'
  for result in preconditionResults postSchemaResults postDataResults; do
    set_contract_hash "$file" \
      ".payload.migrationState.verificationEvidence.cloneRehearsal.${result}.resultsHash" \
      ".payload.migrationState.verificationEvidence.cloneRehearsal.${result}.results"
  done
  set_contract_hash "$file" \
    '.payload.migrationState.verificationEvidence.cloneRehearsal.executedMigrations.migrationsHash' \
    '.payload.migrationState.verificationEvidence.cloneRehearsal.executedMigrations.migrations'
  set_contract_hash "$file" \
    '.payload.migrationState.verificationEvidence.cloneRehearsal.executionBudgetResultsHash' \
    '.payload.migrationState.verificationEvidence.cloneRehearsal.executionBudgetResults'
  set_contract_hash "$file" \
    '.payload.migrationState.verificationEvidence.cloneRehearsal.sourceSchemaCatalogFingerprint' \
    '.payload.migrationState.reviewedManifest.preSchemaCatalogObjects'
  set_contract_hash "$file" \
    '.payload.migrationState.verificationEvidence.cloneRehearsal.resultSchemaCatalogFingerprint' \
    '.payload.migrationState.reviewedManifest.postSchemaCatalogObjects'
  tmp="$(mktemp "$fixture/contract-h2.XXXXXX")"
  jq -cS '
    .payload.migrationState.verificationEvidence.cloneRehearsal.reviewedMigrationOperationsHash=
        .payload.migrationState.reviewedMigrationOperationsHash
    | .payload.migrationState.verificationEvidence.cloneRehearsal.expectedSchemaDeltaHash=
        .payload.migrationState.expectedSchemaDeltaHash
    | .payload.migrationState.verificationEvidence.cloneRehearsal.expectedDataTransformHash=
        .payload.migrationState.expectedDataTransformHash
    | .payload.migrationState.verificationEvidence.cloneRehearsal.sourceAppliedMigrationsHash=
        .payload.migrationState.appliedMigrationsHash
    | if .payload.stage == "PRE_MUTATION" then
        .payload.migrationState.verificationEvidence.preconditionResults=
          .payload.migrationState.verificationEvidence.cloneRehearsal.preconditionResults
        | .payload.migrationState.verificationEvidence.executionBudgetResults=
          .payload.migrationState.verificationEvidence.cloneRehearsal.executionBudgetResults
        | .payload.migrationState.verificationEvidence.executionBudgetResultsHash=
          .payload.migrationState.verificationEvidence.cloneRehearsal.executionBudgetResultsHash
      else . end
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
  set_contract_hash "$file" '.payload.migrationState.verificationEvidence.cloneRehearsal.resultHash' \
    '.payload.migrationState.verificationEvidence.cloneRehearsal | del(.resultHash)'
  set_reader_payload_binding "$file"
}
rehash_clone_contract() {
  local file="$1" result tmp network_member
  set_contract_hash "$file" '.payload.sourceAppliedMigrationsHash' \
    '.payload.sourceAppliedMigrations'
  for pair in \
    'reviewedMigrationOperationsHash|.payload.reviewedManifest.reviewedMigrationManifest' \
    'candidateMigrationSetHash|.payload.reviewedManifest.reviewedMigrationManifest | map({relativePath,migrationName,checksumSha256})' \
    'expectedDataTransformHash|.payload.reviewedManifest.reviewedMigrationManifest | map(select(.operationClass == "DATA_BACKFILL") | {relativePath,checksumSha256,invariants:.postDataInvariants})' \
    'preflightCatalogHash|.payload.reviewedManifest.reviewedMigrationManifest | map({relativePath,preconditions})' \
    'lockBudgetPolicyHash|.payload.reviewedManifest.reviewedMigrationManifest | map({relativePath,executionBudget})' \
    'expectedSeededRouteHash|.payload.reviewedManifest.expectedSeededRoutes' \
    'expectedClosedWhtRouteHash|.payload.reviewedManifest.expectedClosedWhtRoutes'; do
    set_contract_hash "$file" ".payload.${pair%%|*}" "${pair#*|}"
  done
  set_contract_hash "$file" '.payload.expectedSchemaDeltaHash' \
    '.payload.reviewedManifest as $m
      | ($m.preSchemaCatalogObjects | map({key:([.kind,.schema,(.relation // ""),.name]|join("\u0000")),value:.}) | from_entries) as $before
      | ($m.postSchemaCatalogObjects | map({key:([.kind,.schema,(.relation // ""),.name]|join("\u0000")),value:.}) | from_entries) as $after
      | (($before|keys) + ($after|keys) | unique | sort)
      | map(select(($before[.] // null) != ($after[.] // null))
          | {key:.,before:($before[.] // null),after:($after[.] // null)})'
  for result in preconditionResults postSchemaResults postDataResults; do
    set_contract_hash "$file" ".payload.cloneRehearsal.${result}.resultsHash" \
      ".payload.cloneRehearsal.${result}.results"
  done
  set_contract_hash "$file" '.payload.cloneRehearsal.executedMigrations.migrationsHash' \
    '.payload.cloneRehearsal.executedMigrations.migrations'
  set_contract_hash "$file" '.payload.cloneRehearsal.executionBudgetResultsHash' \
    '.payload.cloneRehearsal.executionBudgetResults'
  set_contract_hash "$file" '.payload.cloneRehearsal.sourceSchemaCatalogFingerprint' \
    '.payload.reviewedManifest.preSchemaCatalogObjects'
  set_contract_hash "$file" '.payload.cloneRehearsal.resultSchemaCatalogFingerprint' \
    '.payload.reviewedManifest.postSchemaCatalogObjects'
  tmp="$(mktemp "$fixture/contract-clone.XXXXXX")"
  jq -cS '
    .payload.cloneRehearsal.sourceAppliedMigrationsHash=.payload.sourceAppliedMigrationsHash
    | .payload.cloneRehearsal.reviewedMigrationOperationsHash=.payload.reviewedMigrationOperationsHash
    | .payload.cloneRehearsal.expectedSchemaDeltaHash=.payload.expectedSchemaDeltaHash
    | .payload.cloneRehearsal.expectedDataTransformHash=.payload.expectedDataTransformHash
    | .payload.migrationTool.migrationCatalogHash=.payload.candidateMigrationSetHash
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
  set_contract_hash "$file" '.payload.cloneRehearsal.resultHash' \
    '.payload.cloneRehearsal | del(.resultHash)'
  for network_member in describeDbInstances describeNetworkInterfaces describeSecret describeSecurityGroups \
    describeSubnets describeTaskDefinition describeTasks; do
    set_contract_hash "$file" ".payload.cloneInfrastructure.networkEvidence.${network_member}.sha256" \
      ".payload.cloneInfrastructure.networkEvidence.${network_member}.raw"
  done
  set_raw_string_hash "$file" '.payload.reimbursementCompatibility.commandSha256' \
    '.payload.reimbursementCompatibility.command'
}
rehash_h3_contract() {
  local file="$1" nested tmp section field
  nested="$(mktemp "$fixture/contract-h3-nested.XXXXXX")"
  jq -cS '{artifactKind:"PRODUCTION_A5_EVIDENCE_V1",sourceCommit,
    payload:.payload.verificationEvidence.migrationReview.productionA5PreMutationPayload}' \
    "$file" > "$nested"
  rehash_h2_contract "$nested"
  tmp="$(mktemp "$fixture/contract-h3.XXXXXX")"
  jq -cS --slurpfile nested "$nested" '
    .payload.verificationEvidence.migrationReview.productionA5PreMutationPayload=$nested[0].payload
    | .payload.candidateMigrationSetHash=$nested[0].payload.migrationState.candidateMigrationSetHash
    | .payload.reviewedMigrationOperationsHash=$nested[0].payload.migrationState.reviewedMigrationOperationsHash
    | .payload.expectedSchemaDeltaHash=$nested[0].payload.migrationState.expectedSchemaDeltaHash
    | .payload.expectedDataTransformHash=$nested[0].payload.migrationState.expectedDataTransformHash
    | .payload.preflightCatalogHash=$nested[0].payload.migrationState.preflightCatalogHash
    | .payload.lockBudgetPolicyHash=$nested[0].payload.migrationState.lockBudgetPolicyHash
    | .payload.expectedSeededRouteHash=$nested[0].payload.migrationState.expectedSeededRouteHash
    | .payload.expectedClosedWhtRouteHash=$nested[0].payload.migrationState.expectedClosedWhtRouteHash
    | .payload.verificationEvidence.migrationReview.migrationTool.migrationCatalogHash
        =$nested[0].payload.migrationState.candidateMigrationSetHash
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
  set_contract_hash "$file" \
    '.payload.verificationEvidence.rollbackRecovery.commandListSha256' \
    '.payload.verificationEvidence.rollbackRecovery.commands | map(.command)'
  set_contract_hash "$file" \
    '.payload.verificationEvidence.rollbackRecovery.combinedOutputSha256' \
    '.payload.verificationEvidence.rollbackRecovery.commands | map({command,outputSha256})'
  set_contract_hash "$file" \
    '.payload.verificationEvidence.awsIdentityBoundary.observedTrustPolicySha256' \
    '.payload.verificationEvidence.awsIdentityBoundary.trustPolicy'
  field="$(jq -r '.payload.verificationEvidence.awsIdentityBoundary.observedTrustPolicySha256' "$file")"
  tmp="$(mktemp "$fixture/contract-h3.XXXXXX")"
  jq -cS --arg field "$field" '.payload.verificationEvidence.awsIdentityBoundary.trustTemplateSha256=$field' \
    "$file" > "$tmp"
  mv "$tmp" "$file"
  set_contract_hash "$file" \
    '.payload.verificationEvidence.awsIdentityBoundary.observedInlinePolicySha256' \
    '.payload.verificationEvidence.awsIdentityBoundary.inlinePolicy'
  field="$(jq -r '.payload.verificationEvidence.awsIdentityBoundary.observedInlinePolicySha256' "$file")"
  tmp="$(mktemp "$fixture/contract-h3.XXXXXX")"
  jq -cS --arg field "$field" '.payload.verificationEvidence.awsIdentityBoundary.inlinePolicyTemplateSha256=$field' \
    "$file" > "$tmp"
  mv "$tmp" "$file"
  set_contract_hash "$file" '.payload.checks.controllerTrust.validatorSetHash' \
    '.payload.verificationEvidence.controllerTrust.validators'
  set_contract_hash "$file" '.payload.checks.protectedMainPolicy.requiredStatusContextsHash' \
    '.payload.verificationEvidence.protectedMainPolicy.requiredStatusContexts'
  for section in controllerTrust artifactIntegrity migrationReview rollbackRecovery \
    protectedMainPolicy productionEnvironmentPolicy runtimeSecurityBaseline awsIdentityBoundary; do
    set_contract_hash "$file" ".payload.checks.${section}.evidenceSha256" \
      ".payload.verificationEvidence.${section}"
  done
}
rehash_contract_hashes() {
  case "$(jq -r '.artifactKind' "$1")" in
    PRODUCTION_A5_EVIDENCE_V1) rehash_h2_contract "$1" ;;
    PRODUCTION_A5_CLONE_REHEARSAL_V1) rehash_clone_contract "$1" ;;
    PRODUCTION_SECURITY_PREFLIGHT_V1) rehash_h3_contract "$1" ;;
  esac
}

contract_base="$fixture/contract-base.json"
jq -cS -L "$repo_root/infra/security" --arg source "$source_sha" '
  include "evidence-contracts.fixtures";
  .payload = e0_fixture_payload("PRODUCTION_A5_EVIDENCE_V1";"PRE_MUTATION";$source)
  | .payload.readerRuntime.taskDefinition.family="watchdog-a5-production-reader-9001-a2-pre"
  | .payload.readerRuntime.taskDefinition.arn=("arn:aws:ecs:ap-southeast-1:311414082667:task-definition/"
      + .payload.readerRuntime.taskDefinition.family + ":1")
  | .payload.readerRuntime.task.startedBy="a5r-9001-a2-p"
  | .payload.readerRuntime.output.marker="a5-prod-9001-a2-pre"
' "$base" > "$contract_base"
rehash_contract_hashes "$contract_base"
mv "$contract_base" "$base"

rehash() {
  local input="$1" output="$2" hash
  hash="$(jq -cS 'del(.contentSha256)' "$input" | signed_evidence_sha256_stream)"
  jq -cS --arg hash "$hash" '.contentSha256=$hash' "$input" > "$output"
}
mutate_and_rehash() {
  local output="$1" filter="$2" mutated="$fixture/mutated.json"
  jq -cS "$filter" "$evidence" > "$mutated"
  rehash "$mutated" "$output"
}

evidence="$fixture/evidence.json"
rehash "$base" "$evidence"
signed_evidence_canonicalize "$evidence" > "$fixture/canonicalized.json"
cmp -s "$evidence" "$fixture/canonicalized.json"
test "$(signed_evidence_content_sha256 "$evidence")" = "$(jq -r '.contentSha256' "$evidence")"
signed_evidence_validate_envelope "$evidence" "$expected" "$now"

contract_fixture() {
  local kind="$1" stage="$2" output="$3"
  jq -cnS -L "$repo_root/infra/security" --arg kind "$kind" --arg stage "$stage" \
    --arg source "$source_sha" '
      include "evidence-contracts.fixtures";
      (e0_fixture_payload($kind;$stage;$source)) as $payload
      | {artifactKind:$kind,repository:"example/repo",environment:"production",
        sourceCommit:$source,issuedAtEpoch:1700000000,expiresAtEpoch:1700001800,
        producer:{actor:"MangmeeDev",triggeringActor:"MangmeeDev",
          runId:"7001",runAttempt:1,
          workflowPath:(if $kind == "PRODUCTION_A5_CLONE_REHEARSAL_V1"
            then ".github/workflows/production-a5-clone.yml" else ".github/workflows/fixture.yml" end),
          controllerCommit:(if $kind == "PRODUCTION_SECURITY_PREFLIGHT_V1"
            then $payload.verificationEvidence.controllerTrust.producerControllerCommit else $source end),
          workflowBlob:(if $kind == "PRODUCTION_SECURITY_PREFLIGHT_V1"
            then $payload.verificationEvidence.controllerTrust.securityPreflightWorkflowBlob else $source end)},
        parentProductionRun:{
          runId:"8001",runAttempt:1,
          controllerCommit:(if $kind == "PRODUCTION_SECURITY_PREFLIGHT_V1"
            then $payload.verificationEvidence.controllerTrust.parentControllerCommit else $source end),
          workflowBlob:(if $kind == "PRODUCTION_SECURITY_PREFLIGHT_V1"
            then $payload.verificationEvidence.controllerTrust.productionDeployWorkflowBlob else $source end)},
        payload:$payload}
    ' > "$output"
  rehash_contract_hashes "$output"
}

contract_cases=(
  'PRODUCTION_A5_EVIDENCE_V1 PRE_MUTATION'
  'PRODUCTION_A5_EVIDENCE_V1 POST_MIGRATION'
  'PRODUCTION_A5_EVIDENCE_V1 POST_DEPLOYMENT'
  'PRODUCTION_A5_CLONE_REHEARSAL_V1 CLONE'
  'PRODUCTION_SECURITY_PREFLIGHT_V1 NONE'
  'U5_SHADOW_AGGREGATE_V1 PRE_AUTHORIZATION'
  'U5_SHADOW_AGGREGATE_V1 POST_DEPLOYMENT'
  'OWNER_U5E_APPROVAL_V1 NONE'
)
for contract_case in "${contract_cases[@]}"; do
  read -r contract_kind contract_stage <<< "$contract_case"
  contract_file="$fixture/contract-$contract_kind-$contract_stage.json"
  contract_fixture "$contract_kind" "$contract_stage" "$contract_file"
  signed_evidence_validate_payload_contract "$contract_file"
  jq -cS '.payload.unknown=true' "$contract_file" > "$fixture/contract-invalid.json"
  expect_reject "$contract_kind-$contract_stage-unknown" \
    signed_evidence_validate_payload_contract "$fixture/contract-invalid.json"
done

contract_fixture PRODUCTION_A5_CLONE_REHEARSAL_V1 CLONE "$fixture/clone-adversarial.json"
jq -cS '.payload.cloneInfrastructure.temporaryDatabaseSecretArn=
  "arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog/clone-AbCdEf"' \
  "$fixture/clone-adversarial.json" > "$fixture/clone-non-rds-secret.json"
expect_reject clone-non-rds-secret signed_evidence_validate_payload_contract \
  "$fixture/clone-non-rds-secret.json"
jq -cS '.payload.cloneInfrastructure.temporaryDatabaseSecretVersionId=("f"*36)' \
  "$fixture/clone-adversarial.json" > "$fixture/clone-version-drift.json"
expect_reject clone-version-drift signed_evidence_validate_payload_contract \
  "$fixture/clone-version-drift.json"
jq -cS '.payload.cloneInfrastructure.networkEvidence.describeSecret.raw.VersionIdsToStages
  = {("f"*36):["AWSCURRENT"]}' \
  "$fixture/clone-adversarial.json" > "$fixture/clone-current-version-drift.json"
expect_reject clone-current-version-drift signed_evidence_validate_payload_contract \
  "$fixture/clone-current-version-drift.json"
jq -cS '.payload.cloneInfrastructure.networkEvidence.describeTaskDefinition.raw.taskDefinition
  .containerDefinitions[0].secrets=[{name:"DATABASE_URL",valueFrom:
    .payload.cloneInfrastructure.temporaryDatabaseSecretArn}]' \
  "$fixture/clone-adversarial.json" > "$fixture/clone-single-url-secret.json"
expect_reject clone-single-url-secret signed_evidence_validate_payload_contract \
  "$fixture/clone-single-url-secret.json"
jq -cS '.payload.reimbursementCompatibility.tests=12' \
  "$fixture/clone-adversarial.json" > "$fixture/clone-reimbursement-tests-drift.json"
expect_reject clone-reimbursement-tests-drift signed_evidence_validate_payload_contract \
  "$fixture/clone-reimbursement-tests-drift.json"
jq -cS '.payload.reimbursementCompatibility.pass=12' \
  "$fixture/clone-adversarial.json" > "$fixture/clone-reimbursement-pass-drift.json"
expect_reject clone-reimbursement-pass-drift signed_evidence_validate_payload_contract \
  "$fixture/clone-reimbursement-pass-drift.json"
jq -cS '.payload.reimbursementCompatibility.skipped=1' \
  "$fixture/clone-adversarial.json" > "$fixture/clone-reimbursement-skipped.json"
expect_reject clone-reimbursement-skipped signed_evidence_validate_payload_contract \
  "$fixture/clone-reimbursement-skipped.json"

contract_fixture PRODUCTION_A5_EVIDENCE_V1 PRE_MUTATION "$fixture/h2-adversarial.json"
mutate_h2_and_expect_reject() {
  local label filter output
  label="$1"
  filter="$2"
  output="$fixture/h2-$label.json"
  jq -cS "$filter" "$fixture/h2-adversarial.json" > "$output"
  rehash_h2_contract "$output"
  expect_reject "$label" signed_evidence_validate_payload_contract "$output"
}
mutate_h2_and_expect_reject h2-service-set \
  '.payload.currentHealth.services[2].service="worker-typo"'
mutate_h2_and_expect_reject h2-deployment-in-flight '
  .payload.currentHealth.services[0].currentDeployment="arn:aws:ecs:ap-southeast-1:311414082667:service-deployment/watchdog-bms-prod/watchdog-bms-ai-gateway-v2/1"
  | .payload.currentHealth.services[0].rawEvidence.describeExpressGatewayService.raw.first.service.currentDeployment=.payload.currentHealth.services[0].currentDeployment
  | .payload.currentHealth.services[0].rawEvidence.describeExpressGatewayService.raw.second.service.currentDeployment=.payload.currentHealth.services[0].currentDeployment'
mutate_h2_and_expect_reject h2-unstable-service-read '
  .payload.currentHealth.services[0].rawEvidence.describeExpressGatewayService.raw.second.service.activeConfigurations[0].serviceRevisionArn |= sub("/1$";"/2")'
mutate_h2_and_expect_reject h2-minimum-zero '
  .payload.currentHealth.services[0].scalingTarget.minTaskCount=0
  | .payload.currentHealth.services[0].rawEvidence.describeExpressGatewayService.raw.first.service.activeConfigurations[0].scalingTarget.minTaskCount=0
  | .payload.currentHealth.services[0].rawEvidence.describeExpressGatewayService.raw.second.service.activeConfigurations[0].scalingTarget.minTaskCount=0
  | .payload.currentHealth.services[0].rawEvidence.describeServiceRevisions.raw.serviceRevisions[0].resolvedConfiguration.scalingTarget.minTaskCount=0'
mutate_h2_and_expect_reject h2-scaling-policy-drift '
  .payload.currentHealth.services[0].scalingTarget.autoScalingTargetValue=71
  | .payload.currentHealth.services[0].rawEvidence.describeExpressGatewayService.raw.first.service.activeConfigurations[0].scalingTarget.autoScalingTargetValue=71
  | .payload.currentHealth.services[0].rawEvidence.describeExpressGatewayService.raw.second.service.activeConfigurations[0].scalingTarget.autoScalingTargetValue=71
  | .payload.currentHealth.services[0].rawEvidence.describeServiceRevisions.raw.serviceRevisions[0].resolvedConfiguration.scalingTarget.autoScalingTargetValue=71'
mutate_h2_and_expect_reject h2-task-target-ip-drift \
  '.payload.currentHealth.services[0].targetHealth[0].privateIp="10.0.0.99"'
mutate_h2_and_expect_reject h2-task-service-group-drift \
  '.payload.currentHealth.services[0].rawEvidence.describeTasks.raw.tasks[0].group="service:wrong"'
mutate_h2_and_expect_reject h2-ssm-ingress-drift \
  '.payload.currentHealth.services[0].rawEvidence.ssmParameter.raw.Parameter.Value="https://wrong.example.com"'
mutate_h2_and_expect_reject h2-health-non-200 '
  .payload.currentHealth.services[0].httpStatus=503
  | .payload.currentHealth.services[0].rawEvidence.publicHealth.raw.httpStatus=503'
mutate_h2_and_expect_reject h2-health-status-string '
  .payload.currentHealth.services[0].httpStatus="ok"
  | .payload.currentHealth.services[0].rawEvidence.publicHealth.raw.httpStatus="ok"'
mutate_h2_and_expect_reject h2-target-port-drift '
  .payload.currentHealth.services[0].targetHealth[0].port=3001
  | .payload.currentHealth.services[0].rawEvidence.describeTargetHealth.raw.TargetHealthDescriptions[0].Target.Port=3001'
mutate_h2_and_expect_reject h2-load-balancer-port-drift \
  '.payload.currentHealth.services[0].rawEvidence.describeServiceRevisions.raw.serviceRevisions[0].loadBalancers[0].containerPort=3001'
mutate_h2_and_expect_reject h2-reader-task-role \
  '.payload.readerRuntime.taskDefinition.taskRoleArn="arn:aws:iam::311414082667:role/forbidden"'
mutate_h2_and_expect_reject h2-reader-public-ip \
  '.payload.readerRuntime.network.assignPublicIp="ENABLED"'
mutate_h2_and_expect_reject h2-reader-wrong-producer \
  '.payload.readerRuntime.task.startedBy="a5r-9999-a1-p"'
mutate_h2_and_expect_reject h2-reimbursement-missing-hash \
  '.payload.reimbursementApprovalSnapshots.missingHash=1 | .payload.reimbursementApprovalSnapshots.total=3'
mutate_h2_and_expect_reject h2-reimbursement-invalid \
  '.payload.reimbursementApprovalSnapshots.invalid=1 | .payload.reimbursementApprovalSnapshots.total=3'
mutate_h2_and_expect_reject h2-reimbursement-wrong-total \
  '.payload.reimbursementApprovalSnapshots.total=3'
mutate_h2_and_expect_reject h2-reimbursement-partial-approved '
  .payload.reimbursementApprovalSnapshots.currentStepPending=1
  | .payload.reimbursementApprovalSnapshots.legacyPartialApproved=1'
mutate_h2_and_expect_reject h2-reimbursement-partial-rejected '
  .payload.reimbursementApprovalSnapshots.currentStepPending=1
  | .payload.reimbursementApprovalSnapshots.legacyPartialRejected=1'
mutate_h2_and_expect_reject h2-reimbursement-invalid-step '
  .payload.reimbursementApprovalSnapshots.currentStepPending=1
  | .payload.reimbursementApprovalSnapshots.invalidCurrentStep=1'
jq -cS '.payload.queryCatalogHash=("9"*64)' \
  "$fixture/h2-adversarial.json" > "$fixture/h2-reader-payload-drift.json"
expect_reject h2-reader-payload-drift signed_evidence_validate_payload_contract \
  "$fixture/h2-reader-payload-drift.json"
jq -cS '.payload.migrationState.expectedDataTransformHash="bad"' \
  "$fixture/h2-adversarial.json" > "$fixture/h2-bad-five-hash.json"
expect_reject h2-five-hash signed_evidence_validate_payload_contract "$fixture/h2-bad-five-hash.json"
jq -cS '.payload.migrationState.verificationEvidence.cloneRehearsal={
    result:"PASSED",sourceDatabaseFingerprint:("a"*64),reviewedMigrationOperationsHash:("a"*64),
    expectedSchemaDeltaHash:("a"*64),expectedDataTransformHash:("a"*64),
    preconditionResultsHash:("a"*64),postSchemaResultsHash:("a"*64),
    postDataResultsHash:("a"*64),executionBudgetResultsHash:("a"*64),resultHash:("a"*64)
  }' "$fixture/h2-adversarial.json" > "$fixture/h2-compact-clone.json"
expect_reject h2-compact-clone signed_evidence_validate_payload_contract "$fixture/h2-compact-clone.json"
jq -cS '.payload.migrationState.verificationEvidence.cloneRehearsal.unknown=true' \
  "$fixture/h2-adversarial.json" > "$fixture/h2-extra-clone.json"
expect_reject h2-extra-clone signed_evidence_validate_payload_contract "$fixture/h2-extra-clone.json"
jq -cS 'del(.payload.migrationState.verificationEvidence.cloneRehearsal.engineVersion)' \
  "$fixture/h2-adversarial.json" > "$fixture/h2-missing-clone.json"
expect_reject h2-missing-clone signed_evidence_validate_payload_contract "$fixture/h2-missing-clone.json"
jq -cS '
  .payload.migrationState.reviewedManifest.reviewedMigrationManifest[0].postSchemaInvariants += [{
    id:"fixture:post-schema-2",queryHash:("a"*64),expectedResultHash:("a"*64)}]
  | .payload.migrationState.verificationEvidence.cloneRehearsal.postSchemaResults.results += [{
    migrationName:"20260801000000_fixture",id:"fixture:post-schema-2",queryHash:("a"*64),
    expectedResultHash:("a"*64),actualResultHash:("a"*64)}]
' "$fixture/h2-adversarial.json" > "$fixture/h2-multi-clone.json"
rehash_h2_contract "$fixture/h2-multi-clone.json"
signed_evidence_validate_payload_contract "$fixture/h2-multi-clone.json"
jq -cS '.payload.migrationState.verificationEvidence.cloneRehearsal.postSchemaResults.results |= reverse' \
  "$fixture/h2-multi-clone.json" > "$fixture/h2-reordered-clone.json"
set_contract_hash "$fixture/h2-reordered-clone.json" \
  '.payload.migrationState.verificationEvidence.cloneRehearsal.postSchemaResults.resultsHash' \
  '.payload.migrationState.verificationEvidence.cloneRehearsal.postSchemaResults.results'
set_contract_hash "$fixture/h2-reordered-clone.json" \
  '.payload.migrationState.verificationEvidence.cloneRehearsal.resultHash' \
  '.payload.migrationState.verificationEvidence.cloneRehearsal | del(.resultHash)'
expect_reject h2-reordered-clone signed_evidence_validate_payload_contract "$fixture/h2-reordered-clone.json"
contract_fixture PRODUCTION_SECURITY_PREFLIGHT_V1 NONE "$fixture/h3-adversarial.json"
jq -cS '.payload.checks.migrationReview.candidateCount=5' \
  "$fixture/h3-adversarial.json" > "$fixture/h3-count-mismatch.json"
expect_reject h3-recomputed-count signed_evidence_validate_payload_contract "$fixture/h3-count-mismatch.json"
jq -cS '.payload.verificationEvidence.migrationReview.migrationTool.digest=("sha256:"+("9"*64))' \
  "$fixture/h3-adversarial.json" > "$fixture/h3-tool-digest-mismatch.json"
expect_reject h3-tool-digest signed_evidence_validate_payload_contract \
  "$fixture/h3-tool-digest-mismatch.json"
jq -cS '.payload.verificationEvidence.migrationReview.productionA5PreMutationPayload
    .readerRuntime.migrationImage=("311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/"
      + "watchdog-bms-migration-tool@sha256:" + ("9"*64))' \
  "$fixture/h3-adversarial.json" > "$fixture/h3-reader-tool-mismatch.json"
expect_reject h3-reader-tool signed_evidence_validate_payload_contract \
  "$fixture/h3-reader-tool-mismatch.json"
contract_fixture U5_SHADOW_AGGREGATE_V1 PRE_AUTHORIZATION "$fixture/h4-adversarial.json"
jq -cS '.payload.pending=[]' "$fixture/h4-adversarial.json" > "$fixture/h4-capacity-mismatch.json"
expect_reject h4-capacity-pending signed_evidence_validate_payload_contract "$fixture/h4-capacity-mismatch.json"
contract_fixture OWNER_U5E_APPROVAL_V1 NONE "$fixture/h5-adversarial.json"
jq -cS '.payload.authorizedActions.deployExactAcceptedImages=false' \
  "$fixture/h5-adversarial.json" > "$fixture/h5-action-mismatch.json"
expect_reject h5-authority signed_evidence_validate_payload_contract "$fixture/h5-action-mismatch.json"
jq -cS '.payload.maintenanceWindow.endsAtEpochMs+=1' \
  "$fixture/h5-adversarial.json" > "$fixture/h5-window-mismatch.json"
expect_reject h5-window signed_evidence_validate_payload_contract "$fixture/h5-window-mismatch.json"
jq -cS '.payload.productionA5CloneRef.producerRunId="9999"' \
  "$fixture/h5-adversarial.json" > "$fixture/h5-clone-mismatch.json"
expect_reject h5-clone signed_evidence_validate_payload_contract "$fixture/h5-clone-mismatch.json"

{ jq -cS . "$evidence"; jq -cS . "$evidence"; } > "$fixture/multiple-roots.json"
expect_reject multiple-json-roots signed_evidence_validate_envelope \
  "$fixture/multiple-roots.json" "$expected" "$now"

cp "$expected" "$fixture/oversized-expected.json"
dd if=/dev/zero bs=65537 count=1 2>/dev/null \
  | tr '\000' ' ' >> "$fixture/oversized-expected.json"
expect_reject oversized-expected signed_evidence_artifact_name "$fixture/oversized-expected.json"
{ jq -cS . "$expected"; jq -cS . "$expected"; } > "$fixture/multiple-expected-roots.json"
expect_reject multiple-expected-roots signed_evidence_artifact_name "$fixture/multiple-expected-roots.json"

jq . "$evidence" > "$fixture/noncanonical.json"
expect_reject noncanonical signed_evidence_validate_envelope "$fixture/noncanonical.json" "$expected" "$now"

mutate_and_rehash "$fixture/unknown-root.json" '.unknown=true'
expect_reject unknown-root signed_evidence_validate_envelope "$fixture/unknown-root.json" "$expected" "$now"
mutate_and_rehash "$fixture/unknown-producer.json" '.producer.unknown=true'
expect_reject unknown-producer signed_evidence_validate_envelope "$fixture/unknown-producer.json" "$expected" "$now"
mutate_and_rehash "$fixture/unknown-payload.json" '.payload.unknown=true'
expect_reject unknown-payload signed_evidence_validate_envelope "$fixture/unknown-payload.json" "$expected" "$now"

jq -cS '.contentSha256="ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"' \
  "$evidence" > "$fixture/wrong-hash.json"
expect_reject wrong-self-hash signed_evidence_validate_envelope "$fixture/wrong-hash.json" "$expected" "$now"

mutate_and_rehash "$fixture/wrong-source.json" '.sourceCommit="ffffffffffffffffffffffffffffffffffffffff"'
expect_reject wrong-source signed_evidence_validate_envelope "$fixture/wrong-source.json" "$expected" "$now"
mutate_and_rehash "$fixture/wrong-env.json" '.environment="uat"'
expect_reject wrong-environment signed_evidence_validate_envelope "$fixture/wrong-env.json" "$expected" "$now"
mutate_and_rehash "$fixture/wrong-controller.json" '.producer.controllerCommit="ffffffffffffffffffffffffffffffffffffffff"'
expect_reject wrong-controller signed_evidence_validate_envelope "$fixture/wrong-controller.json" "$expected" "$now"
mutate_and_rehash "$fixture/wrong-workflow.json" '.producer.workflowPath=".github/workflows/evil.yml"'
expect_reject wrong-workflow signed_evidence_validate_envelope "$fixture/wrong-workflow.json" "$expected" "$now"
jq -cS '.producer.workflowPath=".github/workflows/evil.yml"' "$expected" > "$fixture/evil-expected.json"
expect_reject untrusted-workflow-map signed_evidence_validate_envelope "$fixture/wrong-workflow.json" "$fixture/evil-expected.json" "$now"
mutate_and_rehash "$fixture/wrong-blob.json" '.producer.workflowBlob="ffffffffffffffffffffffffffffffffffffffff"'
expect_reject wrong-blob signed_evidence_validate_envelope "$fixture/wrong-blob.json" "$expected" "$now"
mutate_and_rehash "$fixture/wrong-run.json" '.producer.runId="9002"'
expect_reject wrong-run signed_evidence_validate_envelope "$fixture/wrong-run.json" "$expected" "$now"
mutate_and_rehash "$fixture/wrong-attempt.json" '.producer.runAttempt=3'
expect_reject wrong-attempt signed_evidence_validate_envelope "$fixture/wrong-attempt.json" "$expected" "$now"
mutate_and_rehash "$fixture/wrong-parent-run.json" '.parentProductionRun.runId="8002"'
expect_reject wrong-parent-run signed_evidence_validate_envelope "$fixture/wrong-parent-run.json" "$expected" "$now"
mutate_and_rehash "$fixture/wrong-parent-attempt.json" '.parentProductionRun.runAttempt=4'
expect_reject wrong-parent-attempt signed_evidence_validate_envelope "$fixture/wrong-parent-attempt.json" "$expected" "$now"
mutate_and_rehash "$fixture/wrong-parent-blob.json" '.parentProductionRun.workflowBlob="ffffffffffffffffffffffffffffffffffffffff"'
expect_reject wrong-parent-blob signed_evidence_validate_envelope "$fixture/wrong-parent-blob.json" "$expected" "$now"
mutate_and_rehash "$fixture/expired.json" '.expiresAtEpoch=1700000100'
expect_reject expired signed_evidence_validate_envelope "$fixture/expired.json" "$expected" "$now"
expect_reject expiry-boundary signed_evidence_validate_envelope "$evidence" "$expected" "$expires"
mutate_and_rehash "$fixture/before-parent.json" '.issuedAtEpoch=1699999899 | .expiresAtEpoch=1700003499'
expect_reject before-parent signed_evidence_validate_envelope "$fixture/before-parent.json" "$expected" "$now"

artifact="$fixture/artifact"
mkdir -p "$artifact"
cp "$evidence" "$artifact/evidence.json"
printf '%s\n' '{"fake":"offline-bundle-fixture"}' > "$artifact/evidence.bundle"
signed_evidence_validate_extracted_dir "$artifact"

printf 'extra\n' > "$artifact/extra.txt"
expect_reject extra-member signed_evidence_validate_extracted_dir "$artifact"
rm "$artifact/extra.txt"
mv "$artifact/evidence.bundle" "$fixture/bundle-target"
ln -s "$fixture/bundle-target" "$artifact/evidence.bundle"
expect_reject symlink-member signed_evidence_validate_extracted_dir "$artifact"
rm "$artifact/evidence.bundle"
cp "$fixture/bundle-target" "$artifact/evidence.bundle"
signed_evidence_validate_extracted_dir "$artifact"
rm "$artifact/evidence.bundle"
ln "$fixture/bundle-target" "$artifact/evidence.bundle"
expect_reject hardlink-member signed_evidence_validate_extracted_dir "$artifact"
rm "$artifact/evidence.bundle"
cp "$fixture/bundle-target" "$artifact/evidence.bundle"

archive="$fixture/artifact.zip"
(cd "$artifact" && zip -q -X "$archive" evidence.json evidence.bundle)
signed_evidence_inspect_zip "$archive"
extracted="$(signed_evidence_extract_zip "$archive")"
cmp -s "$artifact/evidence.json" "$extracted/evidence.json"
cmp -s "$artifact/evidence.bundle" "$extracted/evidence.bundle"
rm -rf "$extracted"

zip_cases="$fixture/zip-cases"
mkdir -p "$zip_cases/source"
printf 'json\n' > "$zip_cases/source/evidence.json"
printf 'bundle\n' > "$zip_cases/source/evidence.bundle"
printf 'extra\n' > "$zip_cases/source/extra.txt"
(cd "$zip_cases/source" && zip -q -X "$zip_cases/extra.zip" evidence.json evidence.bundle extra.txt)
expect_zip_reject extra-zip "$zip_cases/extra.zip"
(cd "$zip_cases/source" && zip -q -X "$zip_cases/missing.zip" evidence.json)
expect_zip_reject missing-zip "$zip_cases/missing.zip"

mkdir -p "$zip_cases/source/nested"
cp "$zip_cases/source/evidence.json" "$zip_cases/source/nested/evidence.json"
(cd "$zip_cases/source" && zip -q -X "$zip_cases/nested.zip" nested/evidence.json evidence.bundle)
expect_zip_reject nested-path "$zip_cases/nested.zip"
(cd "$zip_cases/source/nested" && zip -q -X "$zip_cases/traversal.zip" ../evidence.json ../evidence.bundle)
expect_zip_reject traversal-path "$zip_cases/traversal.zip"
(cd "$zip_cases/source" && zip -q -X "$zip_cases/dot-path.zip" nested/../evidence.json evidence.bundle)
expect_zip_reject dot-path "$zip_cases/dot-path.zip"

printf 'slash\n' > "$zip_cases/source/a\\b"
(cd "$zip_cases/source" && zip -q -X "$zip_cases/backslash.zip" 'a\b' evidence.bundle)
expect_zip_reject backslash-path "$zip_cases/backslash.zip"

mkdir -p "$zip_cases/source/ABSROOT"
cp "$zip_cases/source/evidence.json" "$zip_cases/source/ABSROOT/evidence.json"
(cd "$zip_cases/source" && zip -q -X "$zip_cases/absolute.zip" ABSROOT/evidence.json evidence.bundle)
perl -0pi -e 's{ABSROOT}{///////}g' "$zip_cases/absolute.zip"
expect_zip_reject absolute-path "$zip_cases/absolute.zip"

printf 'other\n' > "$zip_cases/source/evidencf.json"
(cd "$zip_cases/source" && zip -q -X "$zip_cases/duplicate.zip" evidence.json evidencf.json evidence.bundle)
perl -0pi -e 's{evidencf[.]json}{evidence.json}g' "$zip_cases/duplicate.zip"
expect_zip_reject duplicate-name "$zip_cases/duplicate.zip"

printf 'target\n' > "$zip_cases/source/link-target"
ln -s link-target "$zip_cases/source/evidencf.bundle"
(cd "$zip_cases/source" && zip -q -X -y "$zip_cases/symlink.zip" evidence.json evidencf.bundle)
perl -0pi -e 's{evidencf[.]bundle}{evidence.bundle}g' "$zip_cases/symlink.zip"
expect_zip_reject symlink-mode "$zip_cases/symlink.zip"

mkdir -p "$zip_cases/source/nonregular"
(cd "$zip_cases/source" && zip -q -X -r "$zip_cases/nonregular.zip" evidence.json nonregular)
expect_zip_reject nonregular-mode "$zip_cases/nonregular.zip"

dd if=/dev/zero of="$zip_cases/source/oversize.json" bs=1048577 count=1 2>/dev/null
(cd "$zip_cases/source" && zip -q -X "$zip_cases/oversized-member.zip" oversize.json evidence.bundle)
perl -0pi -e 's{oversize[.]json}{evidence.json}g' "$zip_cases/oversized-member.zip"
expect_zip_reject oversized-member "$zip_cases/oversized-member.zip"
cp "$zip_cases/oversized-member.zip" "$zip_cases/forged-small-header.zip"
perl -0pi -e 's/\x01\x00\x10\x00/\x01\x00\x00\x00/g' "$zip_cases/forged-small-header.zip"
expect_zip_reject actual-output-cap "$zip_cases/forged-small-header.zip"
dd if=/dev/zero of="$zip_cases/oversized-archive.zip" bs=2097153 count=1 2>/dev/null
expect_zip_reject oversized-archive "$zip_cases/oversized-archive.zip"

artifact_name="$(signed_evidence_artifact_name "$expected")"
content_hash="$(signed_evidence_content_sha256 "$evidence")"
archive_hash="$(_signed_evidence_sha256_file "$archive")"
archive_size="$(_signed_evidence_file_size "$archive")"
api_json="$fixture/artifacts.json"
jq -cnS --arg name "$artifact_name" --arg digest "sha256:$archive_hash" \
  --arg controller "$controller_sha" --argjson size "$archive_size" '{total_count:1,artifacts:[{
    id:7001,
    name:$name,
    size_in_bytes:$size,
    expired:false,
    digest:$digest,
    workflow_run:{id:9001,head_sha:$controller}
  }]}' > "$api_json"
test "$(signed_evidence_validate_artifact_metadata "$api_json" "$expected" "$archive")" = "sha256:$archive_hash"
{ jq -cS . "$api_json"; jq -cS . "$api_json"; } > "$fixture/artifacts-multiple-roots.json"
expect_reject artifact-multiple-roots signed_evidence_validate_artifact_metadata \
  "$fixture/artifacts-multiple-roots.json" "$expected" "$archive"
cp "$api_json" "$fixture/oversized-api.json"
dd if=/dev/zero bs=2097153 count=1 2>/dev/null \
  | tr '\000' ' ' >> "$fixture/oversized-api.json"
expect_reject oversized-api signed_evidence_validate_artifact_metadata \
  "$fixture/oversized-api.json" "$expected" "$archive"

child="$fixture/child.json"
jq -cnS --arg name "$artifact_name" --arg contentHash "$content_hash" \
  --arg artifactDigest "sha256:$archive_hash" '{
  artifactKind:"PRODUCTION_A5_EVIDENCE_V1",
  producerRunId:"9001",
  producerRunAttempt:2,
  artifactName:$name,
  contentSha256:$contentHash,
  artifactDigest:$artifactDigest
}' > "$child"
signed_evidence_validate_child_ref "$child" "$expected" "$evidence" "$api_json" "$archive"
{ jq -cS . "$child"; jq -cS . "$child"; } > "$fixture/child-multiple-roots.json"
expect_reject child-multiple-roots signed_evidence_validate_child_ref \
  "$fixture/child-multiple-roots.json" "$expected" "$evidence" "$api_json" "$archive"
cp "$child" "$fixture/oversized-child.json"
dd if=/dev/zero bs=65537 count=1 2>/dev/null \
  | tr '\000' ' ' >> "$fixture/oversized-child.json"
expect_reject oversized-child signed_evidence_validate_child_ref \
  "$fixture/oversized-child.json" "$expected" "$evidence" "$api_json" "$archive"
jq -cS '.uri="approval://owner"' "$child" > "$fixture/child-extra.json"
expect_reject child-extra signed_evidence_validate_child_ref "$fixture/child-extra.json" "$expected" "$evidence" "$api_json" "$archive"
printf '%s\n' '"approval://owner/free-text"' > "$fixture/child-free-text.json"
expect_reject child-free-text signed_evidence_validate_child_ref "$fixture/child-free-text.json" "$expected" "$evidence" "$api_json" "$archive"
jq -cS '.artifactName="gh-actions://runs/9001/artifacts/fake"' "$child" > "$fixture/child-uri.json"
expect_reject child-uri signed_evidence_validate_child_ref "$fixture/child-uri.json" "$expected" "$evidence" "$api_json" "$archive"
jq -cS '.artifactName="forged-name"' "$child" > "$fixture/child-wrong-name.json"
expect_reject child-name signed_evidence_validate_child_ref "$fixture/child-wrong-name.json" "$expected" "$evidence" "$api_json" "$archive"
jq -cS '.contentSha256="ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"' \
  "$child" > "$fixture/child-wrong-content-hash.json"
expect_reject child-content-hash signed_evidence_validate_child_ref \
  "$fixture/child-wrong-content-hash.json" "$expected" "$evidence" "$api_json" "$archive"
jq -cS '.total_count=2 | .artifacts += [.artifacts[0]]' "$api_json" > "$fixture/artifacts-duplicate.json"
expect_reject artifact-duplicate signed_evidence_validate_artifact_metadata "$fixture/artifacts-duplicate.json" "$expected" "$archive"
jq -cS 'del(.total_count)' "$api_json" > "$fixture/artifacts-unpaged.json"
expect_reject artifact-unpaged signed_evidence_validate_artifact_metadata \
  "$fixture/artifacts-unpaged.json" "$expected" "$archive"
jq -cS '.artifacts[0].digest="sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"' \
  "$api_json" > "$fixture/artifacts-wrong-digest.json"
expect_reject artifact-digest signed_evidence_validate_artifact_metadata "$fixture/artifacts-wrong-digest.json" "$expected" "$archive"
jq -cS '.artifacts[0].workflow_run.id=9999' "$api_json" > "$fixture/artifacts-wrong-run.json"
expect_reject artifact-run signed_evidence_validate_artifact_metadata "$fixture/artifacts-wrong-run.json" "$expected" "$archive"
jq -cS '.artifacts[0].workflow_run.head_sha="ffffffffffffffffffffffffffffffffffffffff"' \
  "$api_json" > "$fixture/artifacts-wrong-head.json"
expect_reject artifact-head signed_evidence_validate_artifact_metadata "$fixture/artifacts-wrong-head.json" "$expected" "$archive"

run_json="$fixture/run.json"
jq -cnS --arg controller "$controller_sha" --arg started "$producer_started_iso" '{
  id:9001,
  run_attempt:2,
  status:"completed",
  conclusion:"success",
  event:"workflow_dispatch",
  path:".github/workflows/production-a5.yml",
  head_branch:"main",
  head_sha:$controller,
  repository:{full_name:"MangmeeDev/mangmeeplus"},
  actor:{login:"MangmeeDev"},
  triggering_actor:{login:"MangmeeDev"},
  run_started_at:$started
}' > "$run_json"
signed_evidence_validate_github_run "$run_json" "$expected"
{ jq -cS . "$run_json"; jq -cS . "$run_json"; } > "$fixture/run-multiple-roots.json"
expect_reject run-multiple-roots signed_evidence_validate_github_run \
  "$fixture/run-multiple-roots.json" "$expected"
cp "$run_json" "$fixture/oversized-run.json"
dd if=/dev/zero bs=2097153 count=1 2>/dev/null \
  | tr '\000' ' ' >> "$fixture/oversized-run.json"
expect_reject oversized-run signed_evidence_validate_github_run "$fixture/oversized-run.json" "$expected"
jq -cS '.run_attempt=3' "$run_json" > "$fixture/run-wrong-attempt.json"
expect_reject github-attempt signed_evidence_validate_github_run "$fixture/run-wrong-attempt.json" "$expected"
jq -cS '.path=".github/workflows/evil.yml"' "$run_json" > "$fixture/run-wrong-path.json"
expect_reject github-path signed_evidence_validate_github_run "$fixture/run-wrong-path.json" "$expected"

parent_run_json="$fixture/parent-run.json"
jq -cnS --arg controller "$parent_controller" --arg started "$parent_started_iso" '{
  id:8001,
  run_attempt:3,
  status:"in_progress",
  conclusion:null,
  event:"workflow_dispatch",
  path:".github/workflows/deploy-production.yml",
  head_branch:"main",
  head_sha:$controller,
  repository:{full_name:"MangmeeDev/mangmeeplus"},
  run_started_at:$started
}' > "$parent_run_json"
signed_evidence_validate_parent_github_run "$parent_run_json" "$expected"
jq -cS '.run_attempt=4' "$parent_run_json" > "$fixture/parent-run-wrong-attempt.json"
expect_reject parent-attempt signed_evidence_validate_parent_github_run "$fixture/parent-run-wrong-attempt.json" "$expected"
jq -cS '.status="completed" | .conclusion="success"' "$parent_run_json" > "$fixture/parent-run-completed.json"
expect_reject parent-not-current signed_evidence_validate_parent_github_run "$fixture/parent-run-completed.json" "$expected"

# This stub proves exact command construction only; it is not signer verification evidence.
mkdir -p "$fixture/bin"
cat > "$fixture/bin/cosign" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$COSIGN_LOG"
[ "${COSIGN_SHOULD_FAIL:-false}" != true ]
EOF
chmod +x "$fixture/bin/cosign"
export COSIGN_LOG="$fixture/cosign.args"
export PATH="$fixture/bin:$PATH"
signed_evidence_verify_cosign "$artifact/evidence.json" "$artifact/evidence.bundle" "$expected"
printf '%s\n' \
  verify-blob \
  --bundle "$artifact/evidence.bundle" \
  --certificate-identity \
  'https://github.com/MangmeeDev/mangmeeplus/.github/workflows/production-a5.yml@refs/heads/main' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  --certificate-github-workflow-repository 'MangmeeDev/mangmeeplus' \
  --certificate-github-workflow-ref 'refs/heads/main' \
  --certificate-github-workflow-sha "$controller_sha" \
  --certificate-github-workflow-trigger 'workflow_dispatch' \
  "$artifact/evidence.json" > "$fixture/cosign.expected.args"
cmp -s "$COSIGN_LOG" "$fixture/cosign.expected.args"

trust_repo="$fixture/trust-repo"
git init -q -b main "$trust_repo"
git -C "$trust_repo" config user.name 'E0 Test'
git -C "$trust_repo" config user.email 'e0@example.invalid'
git -C "$trust_repo" config commit.gpgsign false
git -C "$trust_repo" config tag.gpgsign false
mkdir -p "$trust_repo/.github/workflows"
printf '%s\n' 'name: production-a5' > "$trust_repo/.github/workflows/production-a5.yml"
printf '%s\n' 'name: deploy-production' > "$trust_repo/.github/workflows/deploy-production.yml"
git -C "$trust_repo" add .github/workflows/production-a5.yml .github/workflows/deploy-production.yml
git -C "$trust_repo" commit -qm 'trusted controllers'
trust_sha="$(git -C "$trust_repo" rev-parse HEAD)"
trust_workflow_blob="$(git -C "$trust_repo" rev-parse "$trust_sha:.github/workflows/production-a5.yml")"
trust_parent_blob="$(git -C "$trust_repo" rev-parse "$trust_sha:.github/workflows/deploy-production.yml")"

orchestrator_expected="$fixture/orchestrator-expected.json"
jq -cnS --arg source "$trust_sha" --arg workflowBlob "$trust_workflow_blob" \
  --arg parentBlob "$trust_parent_blob" --argjson producerStarted "$producer_started" \
  --argjson parentStarted "$parent_started" '{
  artifactKind:"PRODUCTION_A5_EVIDENCE_V1",
  repository:"MangmeeDev/mangmeeplus",
  environment:"production",
  sourceCommit:$source,
  producer:{
    workflowPath:".github/workflows/production-a5.yml",
    controllerCommit:$source,
    workflowBlob:$workflowBlob,
    runId:"9101",
    runAttempt:1,
    actor:"MangmeeDev",
    triggeringActor:"MangmeeDev",
    startedAtEpoch:$producerStarted
  },
  parentProductionRun:{
    controllerCommit:$source,
    workflowBlob:$parentBlob,
    runId:"8101",
    runAttempt:1,
    startedAtEpoch:$parentStarted
  },
  lifetimeSeconds:3600
}' > "$orchestrator_expected"

orchestrator_base="$fixture/orchestrator-base.json"
jq -cnS --arg source "$trust_sha" --arg workflowBlob "$trust_workflow_blob" \
  --arg parentBlob "$trust_parent_blob" --arg zero "$(printf '0%.0s' {1..64})" \
  --argjson issued "$issued" --argjson expires "$expires" '{
  schemaVersion:1,
  artifactKind:"PRODUCTION_A5_EVIDENCE_V1",
  repository:"MangmeeDev/mangmeeplus",
  environment:"production",
  sourceCommit:$source,
  producer:{
    workflowPath:".github/workflows/production-a5.yml",
    workflowRef:"refs/heads/main",
    controllerCommit:$source,
    workflowBlob:$workflowBlob,
    runId:"9101",
    runAttempt:1,
    event:"workflow_dispatch",
    actor:"MangmeeDev",
    triggeringActor:"MangmeeDev"
  },
  parentProductionRun:{
    workflowPath:".github/workflows/deploy-production.yml",
    controllerCommit:$source,
    workflowBlob:$parentBlob,
    runId:"8101",
    runAttempt:1
  },
  issuedAtEpoch:$issued,
  expiresAtEpoch:$expires,
  payload:{routes:["a","b"]},
  contentSha256:$zero
}' > "$orchestrator_base"
orchestrator_contract_base="$fixture/orchestrator-contract-base.json"
jq -cS -L "$repo_root/infra/security" --arg source "$trust_sha" '
  include "evidence-contracts.fixtures";
  .payload = e0_fixture_payload("PRODUCTION_A5_EVIDENCE_V1";"PRE_MUTATION";$source)
  | .payload.readerRuntime.taskDefinition.family="watchdog-a5-production-reader-9101-a1-pre"
  | .payload.readerRuntime.taskDefinition.arn=("arn:aws:ecs:ap-southeast-1:311414082667:task-definition/"
      + .payload.readerRuntime.taskDefinition.family + ":1")
  | .payload.readerRuntime.task.startedBy="a5r-9101-a1-p"
  | .payload.readerRuntime.output.marker="a5-prod-9101-a1-pre"
' "$orchestrator_base" > "$orchestrator_contract_base"
rehash_contract_hashes "$orchestrator_contract_base"
mv "$orchestrator_contract_base" "$orchestrator_base"
orchestrator_evidence="$fixture/orchestrator-evidence.json"
rehash "$orchestrator_base" "$orchestrator_evidence"

build_transport() {
  local prefix="$1" input_evidence="$2" input_expected="$3"
  local directory="$fixture/$prefix-dir" zip_file="$fixture/$prefix.zip"
  local api_file="$fixture/$prefix-api.json" child_file="$fixture/$prefix-child.json"
  local name content digest size kind run_id run_attempt controller
  mkdir -p "$directory"
  cp "$input_evidence" "$directory/evidence.json"
  printf '%s\n' '{"fake":"offline-bundle-fixture"}' > "$directory/evidence.bundle"
  (cd "$directory" && zip -q -X "$zip_file" evidence.json evidence.bundle)
  name="$(signed_evidence_artifact_name "$input_expected")"
  content="$(signed_evidence_content_sha256 "$input_evidence")"
  digest="sha256:$(_signed_evidence_sha256_file "$zip_file")"
  size="$(_signed_evidence_file_size "$zip_file")"
  kind="$(jq -r '.artifactKind' "$input_expected")"
  run_id="$(jq -r '.producer.runId' "$input_expected")"
  run_attempt="$(jq -r '.producer.runAttempt' "$input_expected")"
  controller="$(jq -r '.producer.controllerCommit' "$input_expected")"
  jq -cnS --arg name "$name" --arg digest "$digest" --arg controller "$controller" \
    --argjson size "$size" --argjson runId "$run_id" '{total_count:1,artifacts:[{
      id:7201,name:$name,size_in_bytes:$size,expired:false,digest:$digest,
      workflow_run:{id:$runId,head_sha:$controller}
    }]}' > "$api_file"
  jq -cnS --arg kind "$kind" --arg runId "$run_id" --argjson attempt "$run_attempt" \
    --arg name "$name" --arg content "$content" --arg digest "$digest" '{
      artifactKind:$kind,producerRunId:$runId,producerRunAttempt:$attempt,
      artifactName:$name,contentSha256:$content,artifactDigest:$digest
    }' > "$child_file"
}
build_transport orchestrator "$orchestrator_evidence" "$orchestrator_expected"

orchestrator_run="$fixture/orchestrator-run.json"
jq -cnS --arg sha "$trust_sha" --arg started "$producer_started_iso" '{
  id:9101,run_attempt:1,status:"completed",conclusion:"success",event:"workflow_dispatch",
  path:".github/workflows/production-a5.yml",head_branch:"main",head_sha:$sha,
  repository:{full_name:"MangmeeDev/mangmeeplus"},actor:{login:"MangmeeDev"},
  triggering_actor:{login:"MangmeeDev"},run_started_at:$started
}' > "$orchestrator_run"
orchestrator_parent="$fixture/orchestrator-parent.json"
jq -cnS --arg sha "$trust_sha" --arg started "$parent_started_iso" '{
  id:8101,run_attempt:1,status:"in_progress",conclusion:null,event:"workflow_dispatch",
  path:".github/workflows/deploy-production.yml",head_branch:"main",head_sha:$sha,
  repository:{full_name:"MangmeeDev/mangmeeplus"},run_started_at:$started
}' > "$orchestrator_parent"

signed_evidence_validate_git_trust "$trust_repo" "$orchestrator_expected"
signed_evidence_verify_artifact \
  "$fixture/orchestrator.zip" "$fixture/orchestrator-api.json" \
  "$orchestrator_run" "$orchestrator_parent" "$orchestrator_expected" \
  "$fixture/orchestrator-child.json" "$trust_repo" "$now"

jq -cS '.producer.workflowBlob="ffffffffffffffffffffffffffffffffffffffff"' \
  "$orchestrator_expected" > "$fixture/git-wrong-blob.json"
expect_reject git-workflow-blob signed_evidence_validate_git_trust \
  "$trust_repo" "$fixture/git-wrong-blob.json"
tree="$(git -C "$trust_repo" rev-parse HEAD^{tree})"
untrusted_sha="$(printf '%s\n' untrusted | git -C "$trust_repo" commit-tree "$tree")"
jq -cS --arg source "$untrusted_sha" '.sourceCommit=$source' \
  "$orchestrator_expected" > "$fixture/git-untrusted-source.json"
expect_reject git-main-ancestry signed_evidence_validate_git_trust \
  "$trust_repo" "$fixture/git-untrusted-source.json"

export COSIGN_SHOULD_FAIL=true
expect_reject cosign-failure signed_evidence_verify_artifact \
  "$fixture/orchestrator.zip" "$fixture/orchestrator-api.json" \
  "$orchestrator_run" "$orchestrator_parent" "$orchestrator_expected" \
  "$fixture/orchestrator-child.json" "$trust_repo" "$now"
unset COSIGN_SHOULD_FAIL
expect_reject arbitrary-payload-callback signed_evidence_verify_artifact \
  "$fixture/orchestrator.zip" "$fixture/orchestrator-api.json" \
  "$orchestrator_run" "$orchestrator_parent" "$orchestrator_expected" \
  "$fixture/orchestrator-child.json" "$trust_repo" "$now" arbitrary_callback

jq -cS '.payload.servingBuilds |= reverse' "$orchestrator_evidence" > "$fixture/array-order-base.json"
array_order_evidence="$fixture/array-order-evidence.json"
rehash "$fixture/array-order-base.json" "$array_order_evidence"
build_transport array-order "$array_order_evidence" "$orchestrator_expected"
expect_reject array-order-contract signed_evidence_verify_artifact \
  "$fixture/array-order.zip" "$fixture/array-order-api.json" \
  "$orchestrator_run" "$orchestrator_parent" "$orchestrator_expected" \
  "$fixture/array-order-child.json" "$trust_repo" "$now"

echo 'signed evidence E0 specs passed'
