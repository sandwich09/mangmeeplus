#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
# shellcheck source=infra/security/validate-production-security-preflight.sh
source "$repo_root/infra/security/validate-production-security-preflight.sh"
workflow="$repo_root/.github/workflows/production-security-preflight.yml"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/production-security-spec.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

expect_reject() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "ERROR: $label was accepted" >&2
    exit 1
  fi
}

hash_value() { jq -cjS "$2" "$1" | signed_evidence_sha256_stream; }
set_hash() {
  local file="$1" path="$2" filter="$3" value tmp
  value="$(hash_value "$file" "$filter")"
  tmp="$(mktemp "$fixture/hash.XXXXXX")"
  jq -cS --arg value "$value" "$path=\$value" "$file" > "$tmp"
  mv "$tmp" "$file"
}
set_raw_hash() {
  local file="$1" path="$2" filter="$3" value tmp
  value="$(jq -erj "$filter" "$file" | signed_evidence_sha256_stream)"
  tmp="$(mktemp "$fixture/hash.XXXXXX")"
  jq -cS --arg value "$value" "$path=\$value" "$file" > "$tmp"
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

rehash_h2() {
  local file="$1" result status tmp service_index raw_name
  for service_index in 0 1 2; do
    for raw_name in describeExpressGatewayService describeServiceRevisions listTasks describeTasks \
      describeNetworkInterfaces describeTargetGroups describeTargetHealth ssmParameter publicHealth; do
      set_hash "$file" ".payload.currentHealth.services[$service_index].rawEvidence.${raw_name}.sha256" \
        ".payload.currentHealth.services[$service_index].rawEvidence.${raw_name}.raw"
    done
  done
  set_hash "$file" '.payload.currentHealth.servicesHash' '.payload.currentHealth.services'
  set_hash "$file" '.payload.migrationState.reviewedMigrationOperationsHash' \
    '.payload.migrationState.reviewedManifest.reviewedMigrationManifest'
  set_hash "$file" '.payload.migrationState.candidateMigrationSetHash' \
    '.payload.migrationState.reviewedManifest.reviewedMigrationManifest
      | map({relativePath,migrationName,checksumSha256})'
  set_hash "$file" '.payload.migrationState.expectedDataTransformHash' \
    '.payload.migrationState.reviewedManifest.reviewedMigrationManifest
      | map(select(.operationClass=="DATA_BACKFILL")|{relativePath,checksumSha256,invariants:.postDataInvariants})'
  set_hash "$file" '.payload.migrationState.preflightCatalogHash' \
    '.payload.migrationState.reviewedManifest.reviewedMigrationManifest|map({relativePath,preconditions})'
  set_hash "$file" '.payload.migrationState.lockBudgetPolicyHash' \
    '.payload.migrationState.reviewedManifest.reviewedMigrationManifest|map({relativePath,executionBudget})'
  set_hash "$file" '.payload.migrationState.expectedSeededRouteHash' \
    '.payload.migrationState.reviewedManifest.expectedSeededRoutes'
  set_hash "$file" '.payload.migrationState.expectedClosedWhtRouteHash' \
    '.payload.migrationState.reviewedManifest.expectedClosedWhtRoutes'
  set_hash "$file" '.payload.migrationState.expectedSchemaDeltaHash' \
    '.payload.migrationState.reviewedManifest as $m
      | ($m.preSchemaCatalogObjects | map({key:([.kind,.schema,(.relation // ""),.name]|join("\u0000")),value:.}) | from_entries) as $before
      | ($m.postSchemaCatalogObjects | map({key:([.kind,.schema,(.relation // ""),.name]|join("\u0000")),value:.}) | from_entries) as $after
      | (($before|keys)+($after|keys)|unique|sort)
      | map(select(($before[.] // null) != ($after[.] // null))
          | {key:.,before:($before[.] // null),after:($after[.] // null)})'
  for result in preconditionResults postSchemaResults postDataResults; do
    status="$(jq -r --arg result "$result" '.payload.migrationState.verificationEvidence[$result].status' "$file")"
    if [ "$status" = VERIFIED ]; then
      set_hash "$file" ".payload.migrationState.verificationEvidence.${result}.resultsHash" \
        ".payload.migrationState.verificationEvidence.${result}.results"
    fi
  done
  set_hash "$file" '.payload.migrationState.verificationEvidence.preconditionResults.resultsHash' \
    '.payload.migrationState.verificationEvidence.preconditionResults.results'
  if [ "$(jq -r '.payload.migrationState.verificationEvidence.executedMigrations.status' "$file")" = VERIFIED ]; then
    set_hash "$file" '.payload.migrationState.verificationEvidence.executedMigrations.migrationsHash' \
      '.payload.migrationState.verificationEvidence.executedMigrations.migrations'
  fi
  set_hash "$file" '.payload.migrationState.verificationEvidence.executionBudgetResultsHash' \
    '.payload.migrationState.verificationEvidence.executionBudgetResults'
  for result in preconditionResults postSchemaResults postDataResults; do
    set_hash "$file" ".payload.migrationState.verificationEvidence.cloneRehearsal.${result}.resultsHash" \
      ".payload.migrationState.verificationEvidence.cloneRehearsal.${result}.results"
  done
  set_hash "$file" \
    '.payload.migrationState.verificationEvidence.cloneRehearsal.executedMigrations.migrationsHash' \
    '.payload.migrationState.verificationEvidence.cloneRehearsal.executedMigrations.migrations'
  set_hash "$file" \
    '.payload.migrationState.verificationEvidence.cloneRehearsal.executionBudgetResultsHash' \
    '.payload.migrationState.verificationEvidence.cloneRehearsal.executionBudgetResults'
  set_hash "$file" \
    '.payload.migrationState.verificationEvidence.cloneRehearsal.sourceSchemaCatalogFingerprint' \
    '.payload.migrationState.reviewedManifest.preSchemaCatalogObjects'
  set_hash "$file" \
    '.payload.migrationState.verificationEvidence.cloneRehearsal.resultSchemaCatalogFingerprint' \
    '.payload.migrationState.reviewedManifest.postSchemaCatalogObjects'
  tmp="$(mktemp "$fixture/h2.XXXXXX")"
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
  set_hash "$file" '.payload.migrationState.verificationEvidence.cloneRehearsal.resultHash' \
    '.payload.migrationState.verificationEvidence.cloneRehearsal|del(.resultHash)'
  set_reader_payload_binding "$file"
  local content_hash
  content_hash="$(jq -cS 'del(.contentSha256)' "$file" | signed_evidence_sha256_stream)"
  tmp="$(mktemp "$fixture/content.XXXXXX")"
  jq -cS --arg value "$content_hash" '.contentSha256=$value' "$file" > "$tmp"
  mv "$tmp" "$file"
}

rehash_clone() {
  local file="$1" result tmp network_member
  set_hash "$file" '.payload.sourceAppliedMigrationsHash' '.payload.sourceAppliedMigrations'
  set_hash "$file" '.payload.reviewedMigrationOperationsHash' \
    '.payload.reviewedManifest.reviewedMigrationManifest'
  set_hash "$file" '.payload.candidateMigrationSetHash' \
    '.payload.reviewedManifest.reviewedMigrationManifest|map({relativePath,migrationName,checksumSha256})'
  set_hash "$file" '.payload.expectedDataTransformHash' \
    '.payload.reviewedManifest.reviewedMigrationManifest
      | map(select(.operationClass=="DATA_BACKFILL")|{relativePath,checksumSha256,invariants:.postDataInvariants})'
  set_hash "$file" '.payload.preflightCatalogHash' \
    '.payload.reviewedManifest.reviewedMigrationManifest|map({relativePath,preconditions})'
  set_hash "$file" '.payload.lockBudgetPolicyHash' \
    '.payload.reviewedManifest.reviewedMigrationManifest|map({relativePath,executionBudget})'
  set_hash "$file" '.payload.expectedSeededRouteHash' '.payload.reviewedManifest.expectedSeededRoutes'
  set_hash "$file" '.payload.expectedClosedWhtRouteHash' '.payload.reviewedManifest.expectedClosedWhtRoutes'
  set_hash "$file" '.payload.expectedSchemaDeltaHash' \
    '.payload.reviewedManifest as $m
      | ($m.preSchemaCatalogObjects | map({key:([.kind,.schema,(.relation // ""),.name]|join("\u0000")),value:.}) | from_entries) as $before
      | ($m.postSchemaCatalogObjects | map({key:([.kind,.schema,(.relation // ""),.name]|join("\u0000")),value:.}) | from_entries) as $after
      | (($before|keys)+($after|keys)|unique|sort)
      | map(select(($before[.] // null) != ($after[.] // null))
          | {key:.,before:($before[.] // null),after:($after[.] // null)})'
  for result in preconditionResults postSchemaResults postDataResults; do
    set_hash "$file" ".payload.cloneRehearsal.${result}.resultsHash" \
      ".payload.cloneRehearsal.${result}.results"
  done
  set_hash "$file" '.payload.cloneRehearsal.executedMigrations.migrationsHash' \
    '.payload.cloneRehearsal.executedMigrations.migrations'
  set_hash "$file" '.payload.cloneRehearsal.executionBudgetResultsHash' \
    '.payload.cloneRehearsal.executionBudgetResults'
  set_hash "$file" '.payload.cloneRehearsal.sourceSchemaCatalogFingerprint' \
    '.payload.reviewedManifest.preSchemaCatalogObjects'
  set_hash "$file" '.payload.cloneRehearsal.resultSchemaCatalogFingerprint' \
    '.payload.reviewedManifest.postSchemaCatalogObjects'
  tmp="$(mktemp "$fixture/clone.XXXXXX")"
  jq -cS '
    .payload.cloneRehearsal.sourceAppliedMigrationsHash=.payload.sourceAppliedMigrationsHash
    | .payload.cloneRehearsal.reviewedMigrationOperationsHash=.payload.reviewedMigrationOperationsHash
    | .payload.cloneRehearsal.expectedSchemaDeltaHash=.payload.expectedSchemaDeltaHash
    | .payload.cloneRehearsal.expectedDataTransformHash=.payload.expectedDataTransformHash
    | .payload.migrationTool.migrationCatalogHash=.payload.candidateMigrationSetHash
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
  set_hash "$file" '.payload.cloneRehearsal.resultHash' '.payload.cloneRehearsal|del(.resultHash)'
  for network_member in describeDbInstances describeNetworkInterfaces describeSecret describeSecurityGroups \
    describeSubnets describeTaskDefinition describeTasks; do
    set_hash "$file" ".payload.cloneInfrastructure.networkEvidence.${network_member}.sha256" \
      ".payload.cloneInfrastructure.networkEvidence.${network_member}.raw"
  done
  set_raw_hash "$file" '.payload.reimbursementCompatibility.commandSha256' \
    '.payload.reimbursementCompatibility.command'
  local content_hash
  content_hash="$(jq -cS 'del(.contentSha256)' "$file" | signed_evidence_sha256_stream)"
  tmp="$(mktemp "$fixture/content.XXXXXX")"
  jq -cS --arg value "$content_hash" '.contentSha256=$value' "$file" > "$tmp"
  mv "$tmp" "$file"
}

source_sha="$(printf 'b%.0s' {1..40})"
zero="$(printf '0%.0s' {1..64})"
baseline="$fixture/runtime-security-baseline.json"
jq -cnS -L "$repo_root/infra/security" --arg source "$source_sha" '
  include "evidence-contracts.fixtures"; e0_fixture_h3_runtime($source)
' > "$baseline"
bash "$repo_root/infra/security/verify-production-security-baseline.sh" validate \
  "$baseline" "$fixture/runtime-security-validated.json" 1699999900
cmp -s "$baseline" "$fixture/runtime-security-validated.json"
baseline_mutate_reject() {
  local label filter mutated
  label="$1"
  filter="$2"
  mutated="$fixture/runtime-$label.json"
  jq -cS "$filter" "$baseline" > "$mutated"
  expect_reject "runtime-$label" \
    bash "$repo_root/infra/security/verify-production-security-baseline.sh" validate \
      "$mutated" "$fixture/runtime-rejected.json" 1699999900
}
baseline_mutate_reject rds-single-az '.rds.multiAZ=false'
baseline_mutate_reject rds-no-deletion-protection '.rds.deletionProtection=false'
baseline_mutate_reject rds-seven-day-backup '.rds.backupRetentionDays=7'
baseline_mutate_reject redis-no-encryption '.redis.atRestEncryptionEnabled=false'
baseline_mutate_reject redis-no-auth '.redis.authTokenEnabled=false'
baseline_mutate_reject redis-single-node '.redis.nodeCount=1'
baseline_mutate_reject redis-seven-day-snapshot '.redis.snapshotRetentionDays=7'
baseline_mutate_reject sns-wrong-owner '.alerting.ownerAccount="000000000000"'
baseline_mutate_reject sns-no-actionable-alarm '.alerting.actionableAlarmNames=[]'
baseline_mutate_reject sns-no-human-subscription '.alerting.confirmedHumanSubscriptions=[]'
baseline_mutate_reject sns-no-delivery '.alerting.deliveredNotificationCount=0'
baseline_mutate_reject sns-no-human-ack '.alerting.acknowledgement.recipientAcknowledged=false'
baseline_mutate_reject clamav-clean-failed '.clamavCandidate.cleanVerdict="FAILED"'
baseline_mutate_reject clamav-eicar-clean '.clamavCandidate.eicarVerdict="CLEAN"'
baseline_mutate_reject clamav-wrong-image '.clamavCandidate.apiImage=("evil.invalid/api@"+.clamavCandidate.apiDigest)'
baseline_mutate_reject log-retention-short '.logMonitoring.groups[0].retentionDays=7'
baseline_mutate_reject log-no-filter '.logMonitoring.groups[0].metricFilterCount=0'
baseline_mutate_reject extra-key '.unexpected="must-be-rejected"'
clone="$fixture/clone.json"
jq -cnS -L "$repo_root/infra/security" --arg source "$source_sha" --arg zero "$zero" '
  include "evidence-contracts.fixtures";
  {schemaVersion:1,artifactKind:"PRODUCTION_A5_CLONE_REHEARSAL_V1",
   repository:"MangmeeDev/mangmeeplus",environment:"production",sourceCommit:$source,
   producer:{workflowPath:".github/workflows/production-a5-clone.yml",workflowRef:"refs/heads/main",
     controllerCommit:$source,workflowBlob:("a"*40),runId:"7001",runAttempt:1,
     event:"workflow_dispatch",actor:"MangmeeDev",triggeringActor:"MangmeeDev"},
   parentProductionRun:{workflowPath:".github/workflows/deploy-production.yml",
     controllerCommit:("e"*40),workflowBlob:("f"*40),runId:"8001",runAttempt:1},
   issuedAtEpoch:1700000000,expiresAtEpoch:1700007200,
   payload:(e0_fixture_clone_payload($source)
     | walk(if type=="string" then gsub("example/repo";"MangmeeDev/mangmeeplus") else . end)),
   contentSha256:$zero}
' > "$clone"
rehash_clone "$clone"
signed_evidence_validate_payload_contract "$clone"
clone_ref="$fixture/clone-ref.json"
jq -cnS --slurpfile clone "$clone" '
  {artifactKind:"PRODUCTION_A5_CLONE_REHEARSAL_V1",producerRunId:$clone[0].producer.runId,
   producerRunAttempt:$clone[0].producer.runAttempt,artifactName:"clone-fixture",
   contentSha256:$clone[0].contentSha256,artifactDigest:("sha256:"+("8"*64))}
' > "$clone_ref"
h2="$fixture/h2.json"
jq -cnS -L "$repo_root/infra/security" --arg source "$source_sha" --arg zero "$zero" \
  --slurpfile clone "$clone" --slurpfile cloneRef "$clone_ref" '
  include "evidence-contracts.fixtures";
  {schemaVersion:1,artifactKind:"PRODUCTION_A5_EVIDENCE_V1",repository:"MangmeeDev/mangmeeplus",
   environment:"production",sourceCommit:$source,
   producer:{workflowPath:".github/workflows/production-a5.yml",workflowRef:"refs/heads/main",
     controllerCommit:("c"*40),workflowBlob:("d"*40),runId:"7201",runAttempt:1,
     event:"workflow_dispatch",actor:"MangmeeDev",triggeringActor:"MangmeeDev"},
   parentProductionRun:{workflowPath:".github/workflows/deploy-production.yml",
     controllerCommit:("e"*40),workflowBlob:("f"*40),runId:"8001",runAttempt:1},
   issuedAtEpoch:1700000000,expiresAtEpoch:1700003600,
   payload:(e0_fixture_h2("PRE_MUTATION";$source)
     | .readerRuntime.taskDefinition.family="watchdog-a5-production-reader-7201-a1-pre"
     | .readerRuntime.taskDefinition.arn=("arn:aws:ecs:ap-southeast-1:311414082667:"
       +"task-definition/watchdog-a5-production-reader-7201-a1-pre:1")
     | .readerRuntime.task.startedBy="a5r-7201-a1-p"
     | .readerRuntime.output.marker="a5-prod-7201-a1-pre"
     | .migrationState.appliedMigrationsHash=$clone[0].payload.sourceAppliedMigrationsHash
     | .migrationState.reviewedManifest=$clone[0].payload.reviewedManifest
     | .migrationState.verificationEvidence.cloneRehearsalRef=$cloneRef[0]
     | .migrationState.verificationEvidence.cloneRehearsal=$clone[0].payload.cloneRehearsal),
   contentSha256:$zero}
' > "$h2"
rehash_h2 "$h2"
security_preflight_validate_h2_bytes "$h2"

facts="$fixture/facts.json"
jq -cnS -L "$repo_root/infra/security" --arg source "$source_sha" --slurpfile h2 "$h2" '
  include "evidence-contracts.fixtures";
  (e0_fixture_h3($source)
    | walk(if type=="string" then gsub("example/repo";"MangmeeDev/mangmeeplus") else . end)) as $h3
  | {schemaVersion:1,sourceCommit:$source,uatAcceptanceRef:$h3.uatAcceptanceRef,
     productionA5PreMutationRef:($h3.verificationEvidence.migrationReview.productionA5PreMutationRef
       + {contentSha256:$h2[0].contentSha256,producerRunId:$h2[0].producer.runId,
          producerRunAttempt:$h2[0].producer.runAttempt}),
     productionA5CloneRef:$h2[0].payload.migrationState.verificationEvidence.cloneRehearsalRef,
     controllerTrust:$h3.verificationEvidence.controllerTrust,
     artifactIntegrity:$h3.verificationEvidence.artifactIntegrity,
     migrationToolVerification:$h3.verificationEvidence.migrationReview.migrationToolVerification,
     rollbackRecovery:($h3.verificationEvidence.rollbackRecovery|del(.commandListSha256,.combinedOutputSha256)),
     protectedMainPolicy:$h3.verificationEvidence.protectedMainPolicy,
     productionEnvironmentPolicy:$h3.verificationEvidence.productionEnvironmentPolicy,
     runtimeSecurityBaseline:$h3.verificationEvidence.runtimeSecurityBaseline,
     awsIdentityBoundary:($h3.verificationEvidence.awsIdentityBoundary
       | del(.observedTrustPolicySha256,.observedInlinePolicySha256))}
' > "$facts"
trust_hash="$(hash_value "$facts" '.awsIdentityBoundary.trustPolicy')"
policy_hash="$(hash_value "$facts" '.awsIdentityBoundary.inlinePolicy')"
jq -cS --arg trust "$trust_hash" --arg policy "$policy_hash" '
  .awsIdentityBoundary.trustTemplateSha256=$trust
  | .awsIdentityBoundary.inlinePolicyTemplateSha256=$policy
' "$facts" > "$fixture/facts-hashed.json"
mv "$fixture/facts-hashed.json" "$facts"

payload="$fixture/payload.json"
security_preflight_build_payload "$facts" "$h2" "$clone" "$clone_ref" "$payload"
jq -e '.passed == true and .checks.migrationReview.candidateCount == 1
  and .checks.productionEnvironmentPolicy.nativeReviewerRule == "NOT_CONFIGURED"
  and .verificationEvidence.migrationReview.productionA5PreMutationPayload.stage == "PRE_MUTATION"' \
  "$payload" >/dev/null

synthetic="$fixture/synthetic.json"
jq -cnS --arg source "$source_sha" --slurpfile payload "$payload" '
  {artifactKind:"PRODUCTION_SECURITY_PREFLIGHT_V1",repository:"MangmeeDev/mangmeeplus",
   sourceCommit:$source,issuedAtEpoch:1700000000,
   producer:{controllerCommit:$payload[0].verificationEvidence.controllerTrust.producerControllerCommit,
     workflowBlob:$payload[0].verificationEvidence.controllerTrust.securityPreflightWorkflowBlob},
   parentProductionRun:{controllerCommit:$payload[0].verificationEvidence.controllerTrust.parentControllerCommit,
     workflowBlob:$payload[0].verificationEvidence.controllerTrust.productionDeployWorkflowBlob},
   payload:$payload[0]}
' > "$synthetic"
signed_evidence_validate_payload_contract "$synthetic"

mutate_facts() {
  local label="$1" filter="$2" mutated
  mutated="$fixture/${label}.json"
  jq -cS "$filter" "$facts" > "$mutated"
  test -s "$mutated"
  expect_reject "$label" security_preflight_build_payload "$mutated" "$h2" "$clone" "$clone_ref" \
    "$fixture/rejected.json"
}
mutate_facts scan-high '.artifactIntegrity.services[0].high=1'
mutate_facts wrong-oci '.artifactIntegrity.services[0].ociRevision=("9"*40)'
mutate_facts wrong-registry '.artifactIntegrity.services[0].image=("evil.invalid/"
  + .artifactIntegrity.services[0].repository + "@" + .artifactIntegrity.services[0].digest)'
mutate_facts invalid-sbom-version '.artifactIntegrity.services[0].sbomSpdxVersion="SPDX-evil"'
mutate_facts stale-scan '.artifactIntegrity.services[0].scanCompletedAtEpoch=999'
active_facts="$fixture/active-continuous-scan.json"
jq -cS '.artifactIntegrity.services[0].scanProviderStatus="ACTIVE"
  | .artifactIntegrity.services[0].scanProviderDescription="Continuous scan is selected for image."
  | .artifactIntegrity.services[0].scanEnhancedFindingsArray=true' "$facts" > "$active_facts"
security_preflight_build_payload "$active_facts" "$h2" "$clone" "$clone_ref" \
  "$fixture/active-payload.json"
complete_without_description="$fixture/complete-without-description.json"
jq -cS '.artifactIntegrity.services[0].scanProviderDescription=null' "$facts" \
  > "$complete_without_description"
security_preflight_build_payload "$complete_without_description" "$h2" "$clone" "$clone_ref" \
  "$fixture/complete-without-description-payload.json"
mutate_facts active-wrong-description '.artifactIntegrity.services[0].scanProviderStatus="ACTIVE"
  | .artifactIntegrity.services[0].scanProviderDescription="Scanning is active"
  | .artifactIntegrity.services[0].scanEnhancedFindingsArray=true'
mutate_facts active-without-enhanced-findings '.artifactIntegrity.services[0].scanProviderStatus="ACTIVE"
  | .artifactIntegrity.services[0].scanProviderDescription="Continuous scan is selected for image."
  | .artifactIntegrity.services[0].scanEnhancedFindingsArray=false'
mutate_facts nonterminal-scan-provider '.artifactIntegrity.services[0].scanProviderStatus="PENDING"'
mutate_facts mismatched-scan-counts '.artifactIntegrity.services[0].scanSeverityCounts.HIGH=1'
mutate_facts unknown-scan-severity '.artifactIntegrity.services[0].scanSeverityCounts.UNKNOWN=1'
mutate_facts runtime-rds-single-az '.runtimeSecurityBaseline.rds.multiAZ=false'
mutate_facts runtime-redis-single-node '.runtimeSecurityBaseline.redis.nodeCount=1'
mutate_facts runtime-no-human-delivery '.runtimeSecurityBaseline.alerting.deliveredNotificationCount=0'
mutate_facts runtime-no-human-ack '.runtimeSecurityBaseline.alerting.acknowledgement.recipientAcknowledged=false'
mutate_facts runtime-clamav-eicar-clean '.runtimeSecurityBaseline.clamavCandidate.eicarVerdict="CLEAN"'
mutate_facts runtime-clamav-wrong-candidate '.runtimeSecurityBaseline.clamavCandidate.apiDigest=("sha256:"+("9"*64))
  | .runtimeSecurityBaseline.clamavCandidate.apiImage=("311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/"
    +"watchdog-bms-api@"+.runtimeSecurityBaseline.clamavCandidate.apiDigest)'
mutate_facts five-contexts '.protectedMainPolicy.requiredStatusContexts|=.[0:5]'
mutate_facts wrong-six-contexts '.protectedMainPolicy.requiredStatusContexts[0]="Irrelevant Check"'
mutate_facts permissive-main '.protectedMainPolicy.forcePushAllowed=true'
mutate_facts fabricated-reviewer '.productionEnvironmentPolicy.nativeReviewerRule="UNAVAILABLE_BILLING_PLAN"
  | .productionEnvironmentPolicy.lastConfigurationHttpStatus=422'
mutate_facts non-main-env '.productionEnvironmentPolicy.branchPolicies=[{name:"develop",type:"branch"}]'
mutate_facts writer-role '.awsIdentityBoundary.expectedRoleArn="arn:aws:iam::311414082667:role/writer"'
mutate_facts rollback-claim '.rollbackRecovery.mode="LIVE_ROLLBACK"'
mutate_facts wrong-h2-ref '.productionA5PreMutationRef.contentSha256=("9"*64)'
mutate_facts wrong-clone-ref '.productionA5CloneRef.contentSha256=("9"*64)'
mutate_facts migration-tool-ref-only 'del(.migrationToolVerification)'
mutate_facts migration-tool-forged-provenance \
  '.migrationToolVerification.provenance.sha256=("9"*64)'
mutate_facts migration-tool-forged-subject \
  '.migrationToolVerification.registryBinding.runnableDigest=("sha256:"+("9"*64))
   | .migrationToolVerification.provenance.subjectDigest=.migrationToolVerification.registryBinding.runnableDigest
   | .migrationToolVerification.scan.resolvedDigest=.migrationToolVerification.registryBinding.runnableDigest'
mutate_facts migration-tool-wrong-signer \
  '.migrationToolVerification.signature.identity="https://github.com/attacker/repo/.github/workflows/x.yml@refs/heads/main"'
mutate_facts migration-tool-scan-high \
  '.migrationToolVerification.scan.high=1 | .migrationToolVerification.scan.severityCounts.HIGH=1'
mutate_facts extra-field '.unknown=true'

jq -cS '.payload.migrationTool.digest=("sha256:"+("9"*64))' "$clone" \
  > "$fixture/clone-tool-tampered.json"
expect_reject clone-tool-tamper security_preflight_build_payload "$facts" "$h2" \
  "$fixture/clone-tool-tampered.json" "$clone_ref" "$fixture/rejected.json"

jq -cS '.payload.migrationState.migrationRiskSummary.additiveCount=0' "$h2" > "$fixture/h2-risk.json"
expect_reject h2-risk-not-derived security_preflight_build_payload "$facts" "$fixture/h2-risk.json" \
  "$clone" "$clone_ref" "$fixture/rejected.json"
jq -cS '.payload.migrationState.verificationEvidence.executionBudgetResults[0].effectiveLockTimeoutMs=5001' \
  "$h2" > "$fixture/h2-budget.json"
expect_reject h2-budget-cap security_preflight_build_payload "$facts" "$fixture/h2-budget.json" \
  "$clone" "$clone_ref" "$fixture/rejected.json"

jq -cS '.payload.verificationEvidence.protectedMainPolicy.enforceAdmins=false' "$synthetic" \
  > "$fixture/tampered-payload.json"
expect_reject raw-summary-tamper signed_evidence_validate_payload_contract "$fixture/tampered-payload.json"
jq -cS '.payload.checks.artifactIntegrity.evidenceSha256=("1"*64)' "$synthetic" \
  > "$fixture/tampered-subset-hash.json"
expect_reject subset-hash-tamper signed_evidence_validate_payload_contract "$fixture/tampered-subset-hash.json"

mkdir -p "$fixture/acceptance"
printf '%s\n' '{}' > "$fixture/acceptance/uat-deployment-acceptance.json"
printf '%s\n' '{}' > "$fixture/acceptance/uat-deployment-acceptance.bundle"
(cd "$fixture/acceptance" && zip -q -X "$fixture/acceptance.zip" \
  uat-deployment-acceptance.json uat-deployment-acceptance.bundle)
archive_digest="sha256:$(_signed_evidence_sha256_file "$fixture/acceptance.zip")"
archive_size="$(_signed_evidence_file_size "$fixture/acceptance.zip")"
jq -cnS --arg digest "$archive_digest" --argjson size "$archive_size" --arg head "$source_sha" '
  {total_count:1,artifacts:[{id:123,name:"uat-acceptance",expired:false,digest:$digest,
    size_in_bytes:$size,workflow_run:{id:456,head_sha:$head}}]}
' > "$fixture/artifacts.json"
security_preflight_validate_artifact_metadata "$fixture/artifacts.json" "$fixture/acceptance.zip" \
  uat-acceptance 456 "$source_sha" >/dev/null
extracted="$(security_preflight_extract_artifact acceptance "$fixture/acceptance.zip")"
test -f "$extracted/uat-deployment-acceptance.json"
rm -rf "$extracted"
jq -cS '.total_count=2' "$fixture/artifacts.json" > "$fixture/artifacts-duplicate.json"
expect_reject duplicate-artifact security_preflight_validate_artifact_metadata \
  "$fixture/artifacts-duplicate.json" "$fixture/acceptance.zip" uat-acceptance 456 "$source_sha"
printf '%s\n' extra > "$fixture/acceptance/extra"
(cd "$fixture/acceptance" && zip -q -X "$fixture/acceptance-extra.zip" \
  uat-deployment-acceptance.json uat-deployment-acceptance.bundle extra)
expect_reject extra-archive-member security_preflight_extract_artifact acceptance "$fixture/acceptance-extra.zip"

make_profile_archive() {
  local profile="$1" directory="$2" archive="$3" member
  mkdir -p "$directory"
  while IFS= read -r member; do
    mkdir -p "$(dirname "$directory/$member")"
    printf '%s\n' '{}' > "$directory/$member"
  done < <(security_preflight_expected_members "$profile")
  (
    cd "$directory"
    find . -type f -print | sed 's#^\./##' | LC_ALL=C sort | zip -q -X "$archive" -@
  )
}

passport_dir="$fixture/passport-v2"
passport_archive="$fixture/passport-v2.zip"
make_profile_archive passport-v2 "$passport_dir" "$passport_archive"
passport_extracted="$(security_preflight_extract_artifact passport-v2 "$passport_archive")"
test -f "$passport_extracted/release/production-image-manifest.json"
test -f "$passport_extracted/tools/image-migration-tool.json"
rm -rf "$passport_extracted"
printf '%s\n' '{}' > "$passport_dir/unexpected.json"
(
  cd "$passport_dir"
  find . -type f -print | sed 's#^\./##' | LC_ALL=C sort | zip -q -X "$fixture/passport-v2-extra.zip" -@
)
expect_reject passport-extra-member security_preflight_extract_artifact \
  passport-v2 "$fixture/passport-v2-extra.zip"

ready_quick_dir="$fixture/ready-v2-quick"
ready_quick_archive="$fixture/ready-v2-quick.zip"
make_profile_archive ready-v2-quick "$ready_quick_dir" "$ready_quick_archive"
ready_quick_extracted="$(security_preflight_extract_artifact ready-v2-quick "$ready_quick_archive")"
test -f "$ready_quick_extracted/ready.bundle"
test -f "$ready_quick_extracted/promotion-prerequisites.json"
test ! -e "$ready_quick_extracted/clone-result.json"
rm -rf "$ready_quick_extracted"

ready_migration_dir="$fixture/ready-v2-migration"
ready_migration_archive="$fixture/ready-v2-migration.zip"
make_profile_archive ready-v2-migration "$ready_migration_dir" "$ready_migration_archive"
ready_migration_extracted="$(security_preflight_extract_artifact ready-v2-migration "$ready_migration_archive")"
test -f "$ready_migration_extracted/clone-result.json"
test -f "$ready_migration_extracted/clone-infrastructure.json"
test -f "$ready_migration_extracted/promotion-prerequisites.json"
rm -rf "$ready_migration_extracted"
rm "$ready_migration_dir/clone-result.json"
(
  cd "$ready_migration_dir"
  find . -type f -print | sed 's#^\./##' | LC_ALL=C sort | zip -q -X "$fixture/ready-v2-missing.zip" -@
)
expect_reject ready-missing-member security_preflight_extract_artifact \
  ready-v2-migration "$fixture/ready-v2-missing.zip"

bash -n "$repo_root/infra/security/signed-evidence.sh" \
  "$repo_root/infra/security/validate-production-security-preflight.sh" \
  "$repo_root/infra/security/bootstrap-production-security-readonly.sh" "$0"
jq -e . "$repo_root/infra/security/production-security-readonly-trust.template.json" \
  "$repo_root/infra/security/production-security-readonly-policy.template.json" >/dev/null
grep -Fq 'DenyOutsideReadOnly' "$repo_root/infra/security/production-security-readonly-policy.template.json"
for read_action in rds:DescribeDBInstances rds:DescribeAccountAttributes \
  rds:DescribeDBParameterGroups rds:DescribeDBSubnetGroups rds:DescribeOptionGroups \
  rds:DescribeOrderableDBInstanceOptions bedrock-agentcore:GetAgentRuntime \
  elasticache:DescribeReplicationGroups \
  elasticache:DescribeCacheClusters sns:GetTopicAttributes sns:ListSubscriptionsByTopic \
  cloudwatch:DescribeAlarms cloudwatch:GetMetricStatistics logs:DescribeLogGroups \
  logs:DescribeMetricFilters; do
  jq -e --arg action "$read_action" '
    any(.Statement[]; ((.Action // []) | if type=="array" then . else [.] end | index($action)) != null)
    and (.Statement[]|select(.Sid=="DenyOutsideReadOnly")|.NotAction|index($action)) != null
  ' "$repo_root/infra/security/production-security-readonly-policy.template.json" >/dev/null
done
grep -Fq 'refs/heads/main' "$workflow"
grep -Fq 'signed_evidence_verify_artifact' "$workflow"
grep -Fq 'signed_evidence_validate_payload_contract' "$workflow"
grep -Fq 'cosign verify-blob' "$workflow"
grep -Fq 'cosign verify --certificate-identity' "$workflow"
grep -Fq 'collect-production-a5-migration-tool-registry-evidence.sh' "$workflow"
grep -Fq 'verify-production-a5-migration-tool.sh "$tool_image" "$SOURCE_SHA"' "$workflow"
grep -Fq 'describe-image-scan-findings --repository-name watchdog-bms-migration-tool' "$workflow"
grep -Fq '.payload.migrationTool as $expected | $observed[0] as $live' "$workflow"
grep -Fq 'aws ecr describe-image-scan-findings' "$workflow"
grep -Fq -- '--image-ids "imageDigest=$scan_digest" --output json > "$pushed"' "$workflow"
grep -Fq '.imageDetails[0].imageDigest == $digest' "$workflow"
grep -Fq '.imageId.imageDigest == $digest' "$workflow"
grep -Fq "severity_counts=\"\$(jq -cer '.imageScanFindings.findingSeverityCounts|select(type==\"object\")'" "$workflow"
grep -Fq "test \"\$scan_provider_description\" = 'Continuous scan is selected for image.'" "$workflow"
grep -Fq 'test "$scan_enhanced_findings_array" = true' "$workflow"
grep -Fq 'aws iam get-role-policy' "$workflow"
grep -Fq 'verify-production-security-baseline.sh clamav' "$workflow"
grep -Fq 'verify-production-security-baseline.sh collect' "$workflow"
grep -Fq 'docs/security-evidence/production-security-alert-delivery-ack.json' "$workflow"
grep -Fq 'REDIS_REPLICATION_GROUP_ID: ${{ vars.REDIS_REPLICATION_GROUP_ID }}' "$workflow"
grep -Fq 'SECURITY_ALERT_TOPIC_ARN: ${{ vars.SECURITY_ALERT_TOPIC_ARN }}' "$workflow"
grep -Fq 'GH_POLICY_READ_TOKEN: ${{ secrets.PRODUCTION_POLICY_READ_TOKEN }}' "$workflow"
test "$(grep -Fc 'PRODUCTION_POLICY_READ_TOKEN' "$workflow")" -eq 1
grep -Fq "'.login == \$owner'" "$workflow"
test "$(grep -Fc 'github_get "$GH_POLICY_READ_TOKEN"' "$workflow")" -eq 1
test "$(grep -Fc 'github_get "$GH_ACTIONS_READ_TOKEN"' "$workflow")" -eq 2
grep -Fq 'nativeReviewerRule:"NOT_CONFIGURED"' "$workflow"
grep -Fq 'lastConfigurationHttpStatus:null' "$workflow"
grep -Fq 'role-to-assume: arn:aws:iam::311414082667:role/watchdog-bms-production-security-readonly' "$workflow"
test "$(grep -Ec '^      [a-z0-9_]+_run_id:$' "$workflow")" -eq 4
if grep -Eq 'aws (ecr start-image-scan|ecs |rds |secretsmanager |iam (create|update|put|delete))' "$workflow"; then
  echo "ERROR: production security workflow contains an AWS mutation" >&2
  exit 1
fi
if grep -Eq '(curl|gh api).*(--request|-X| -X )(PUT|POST|PATCH|DELETE)' "$workflow"; then
  echo "ERROR: production security workflow contains a GitHub mutation" >&2
  exit 1
fi
if grep -Eq 'uses: .+@(main|v[0-9]+)$' "$workflow"; then
  echo "ERROR: production security workflow contains a mutable action reference" >&2
  exit 1
fi

printf '%s\n' 'production security preflight E2 specs passed'
