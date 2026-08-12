#!/usr/bin/env bash
set -euo pipefail

security_preflight_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
# shellcheck source=infra/security/signed-evidence.sh
source "$security_preflight_root/infra/security/signed-evidence.sh"

security_preflight_hash_value() {
  jq -cjS "$2" "$1" | signed_evidence_sha256_stream
}

security_preflight_validate_artifact_metadata() {
  [ "$#" -eq 5 ] || { echo "Usage: metadata <api.json> <archive.zip> <name> <run-id> <head-sha>" >&2; return 2; }
  local api="$1" archive="$2" name="$3" run_id="$4" head_sha="$5" digest size
  _signed_evidence_regular_file "$api" 2097152
  _signed_evidence_single_json_object "$api"
  _signed_evidence_regular_file "$archive" 134217728
  [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$ ]]
  [[ "$run_id" =~ ^[1-9][0-9]*$ ]]
  [[ "$head_sha" =~ ^[0-9a-f]{40}$ ]]
  digest="sha256:$(_signed_evidence_sha256_file "$archive")"
  size="$(_signed_evidence_file_size "$archive")"
  jq -e --arg name "$name" --arg run "$run_id" --arg head "$head_sha" \
    --arg digest "$digest" --argjson size "$size" '
      (keys | sort) == ["artifacts","total_count"]
      and .total_count == 1 and (.artifacts | type == "array" and length == 1)
      and .artifacts[0].name == $name and .artifacts[0].expired == false
      and .artifacts[0].digest == $digest and .artifacts[0].size_in_bytes == $size
      and (.artifacts[0].id | type == "number" and . >= 1 and floor == .)
      and (.artifacts[0].workflow_run.id | tostring) == $run
      and .artifacts[0].workflow_run.head_sha == $head
    ' "$api" >/dev/null || {
      echo "ERROR: artifact metadata is missing, ambiguous, expired or byte-mismatched" >&2
      return 1
    }
  printf '%s\n' "$digest"
}

security_preflight_expected_members() {
  case "$1" in
    acceptance) printf '%s\n' uat-deployment-acceptance.bundle uat-deployment-acceptance.json ;;
    release) printf '%s\n' \
      cosign-ai-gateway.json cosign-api-web.json cosign-workers.json \
      production-image-manifest.json sbom-ai-gateway.spdx.json \
      sbom-api-web.spdx.json sbom-workers.spdx.json ;;
    passport-v2) printf '%s\n' \
      migration-catalog.json passport.bundle passport.json \
      release/cosign-ai-gateway.json release/cosign-api-web.json release/cosign-workers.json \
      release/production-image-manifest.json release/sbom-ai-gateway.spdx.json \
      release/sbom-api-web.spdx.json release/sbom-workers.spdx.json \
      tools/cosign-migration-tool.json tools/cosign-release-task.json \
      tools/image-migration-tool.json tools/image-release-task.json \
      tools/sbom-migration-tool.spdx.json tools/sbom-release-task.spdx.json ;;
    ready-v2-quick) printf '%s\n' \
      catalog-result.json catalog-runtime.json migration-catalog.json passport.json \
      production-health.json production-runtime.json promotion-prerequisites.json \
      ready.bundle ready.json ;;
    ready-v2-migration) printf '%s\n' \
      catalog-result.json catalog-runtime.json clone-infrastructure.json clone-result.json \
      migration-catalog.json passport.json production-health.json production-runtime.json \
      promotion-prerequisites.json ready.bundle ready.json ;;
    *) echo "ERROR: unknown artifact extraction profile" >&2; return 2 ;;
  esac
}

# Returns a new private directory. The caller owns cleanup of that exact path.
security_preflight_extract_artifact() (
  trap - EXIT
  [ "$#" -eq 2 ] || { echo "Usage: extract <acceptance|release|passport-v2|ready-v2-quick|ready-v2-migration> <archive.zip>" >&2; exit 2; }
  local profile="$1" source="$2" copy destination names expected metadata sorted cleanup
  local mode size name member_limit=16777216
  case "$profile" in passport-v2) member_limit=67108864 ;; esac
  copy="$(mktemp "${TMPDIR:-/tmp}/production-security-archive.XXXXXX")"
  destination="$(mktemp -d "${TMPDIR:-/tmp}/production-security-extracted.XXXXXX")"
  names="$(mktemp "${TMPDIR:-/tmp}/production-security-names.XXXXXX")"
  expected="$(mktemp "${TMPDIR:-/tmp}/production-security-expected.XXXXXX")"
  metadata="$(mktemp "${TMPDIR:-/tmp}/production-security-metadata.XXXXXX")"
  sorted="$(mktemp "${TMPDIR:-/tmp}/production-security-sorted.XXXXXX")"
  printf -v cleanup 'rm -f -- %q %q %q %q %q; rm -rf -- %q' \
    "$copy" "$names" "$expected" "$metadata" "$sorted" "$destination"
  trap "$cleanup" EXIT
  _signed_evidence_copy_file "$source" "$copy" 134217728 || exit 1
  security_preflight_expected_members "$profile" > "$expected"
  zipinfo -1 "$copy" > "$names" 2>/dev/null || exit 1
  LC_ALL=C sort "$names" > "$sorted"
  cmp -s "$sorted" "$expected" || { echo "ERROR: artifact member set is not exact" >&2; exit 1; }
  test "$(wc -l < "$names" | tr -d '[:space:]')" = "$(wc -l < "$expected" | tr -d '[:space:]')"
  zipinfo -l "$copy" 2>/dev/null \
    | awk '$1 ~ /^[-dlcbps?]/ { print $1 "\t" $4 "\t" $NF }' > "$metadata"
  test "$(wc -l < "$metadata" | tr -d '[:space:]')" = "$(wc -l < "$expected" | tr -d '[:space:]')"
  while IFS=$'\t' read -r mode size name; do
    [[ "$mode" == -* ]] || { echo "ERROR: artifact contains a non-regular member" >&2; exit 1; }
    [[ "$size" =~ ^[0-9]+$ ]] && [ "$size" -gt 0 ] && [ "$size" -le "$member_limit" ] \
      || { echo "ERROR: artifact member exceeds the output bound" >&2; exit 1; }
    grep -Fxq "$name" "$expected" || exit 1
    mkdir -p "$(dirname "$destination/$name")"
    _signed_evidence_extract_member "$copy" "$name" "$destination/$name" "$member_limit" || exit 1
  done < "$metadata"
  printf '%s\n' "$destination"
  trap - EXIT
  rm -f "$copy" "$names" "$expected" "$metadata" "$sorted"
)

security_preflight_validate_h2_bytes() (
  trap - EXIT
  local evidence="$1" canonical actual
  _signed_evidence_regular_file "$evidence" 1048576
  _signed_evidence_single_json_object "$evidence"
  canonical="$(mktemp "${TMPDIR:-/tmp}/production-security-h2.XXXXXX")"
  trap 'rm -f "$canonical"' EXIT
  signed_evidence_canonicalize "$evidence" > "$canonical"
  cmp -s "$evidence" "$canonical" || { echo "ERROR: H2 evidence bytes are not canonical" >&2; return 1; }
  actual="$(signed_evidence_content_sha256 "$evidence")"
  test "$actual" = "$(jq -er '.contentSha256' "$evidence")" || {
    echo "ERROR: H2 evidence content hash is invalid" >&2
    return 1
  }
  jq -e '
    .artifactKind == "PRODUCTION_A5_EVIDENCE_V1"
    and .environment == "production" and .payload.stage == "PRE_MUTATION"
    and .payload.targetEnvironment == "production"
  ' "$evidence" >/dev/null
  signed_evidence_validate_payload_contract "$evidence"
)

security_preflight_build_payload() (
  trap - EXIT
  [ "$#" -eq 5 ] || {
    echo "Usage: build <facts.json> <verified-h2-evidence.json> <verified-clone-evidence.json> <clone-ref.json> <payload.json>" >&2
    exit 2
  }
  local facts="$1" h2="$2" clone="$3" clone_ref="$4" output="$5"
  local workspace verification synthetic cleanup
  local rollback_commands rollback_output trust_hash policy_hash
  local controller_hash artifact_hash migration_hash rollback_hash branch_hash environment_hash aws_hash
  local runtime_hash
  local validator_hash contexts_hash
  _signed_evidence_regular_file "$facts" 1048576 || exit 1
  _signed_evidence_single_json_object "$facts" || exit 1
  security_preflight_validate_h2_bytes "$h2" || exit 1
  _signed_evidence_regular_file "$clone" 1048576 || exit 1
  _signed_evidence_single_json_object "$clone" || exit 1
  signed_evidence_validate_payload_contract "$clone" || exit 1
  _signed_evidence_regular_file "$clone_ref" 65536 || exit 1
  _signed_evidence_single_json_object "$clone_ref" || exit 1
  jq -e --slurpfile h2 "$h2" --slurpfile clone "$clone" --slurpfile cloneRef "$clone_ref" '
    (keys | sort) == ["artifactIntegrity","awsIdentityBoundary","controllerTrust","migrationToolVerification",
      "productionA5CloneRef","productionA5PreMutationRef","productionEnvironmentPolicy","protectedMainPolicy",
      "rollbackRecovery","runtimeSecurityBaseline","schemaVersion","sourceCommit","uatAcceptanceRef"]
    and .schemaVersion == 1 and .sourceCommit == $h2[0].sourceCommit
    and (.productionA5PreMutationRef | keys | sort) == ["artifactDigest","artifactKind",
      "artifactName","contentSha256","producerRunAttempt","producerRunId"]
    and .productionA5PreMutationRef.artifactKind == "PRODUCTION_A5_EVIDENCE_V1"
    and .productionA5PreMutationRef.contentSha256 == $h2[0].contentSha256
    and .productionA5PreMutationRef.producerRunId == $h2[0].producer.runId
    and .productionA5PreMutationRef.producerRunAttempt == $h2[0].producer.runAttempt
    and .productionA5CloneRef == $cloneRef[0]
    and .productionA5CloneRef == $h2[0].payload.migrationState.verificationEvidence.cloneRehearsalRef
    and $clone[0].artifactKind == "PRODUCTION_A5_CLONE_REHEARSAL_V1"
    and $clone[0].sourceCommit == $h2[0].sourceCommit
    and $clone[0].parentProductionRun == $h2[0].parentProductionRun
    and $clone[0].payload.cloneRehearsal
      == $h2[0].payload.migrationState.verificationEvidence.cloneRehearsal
    and $clone[0].payload.reviewedManifest == $h2[0].payload.migrationState.reviewedManifest
    and $clone[0].payload.sourceAppliedMigrationsHash
      == $h2[0].payload.migrationState.appliedMigrationsHash
    and .migrationToolVerification.image == $clone[0].payload.migrationTool.image
    and .migrationToolVerification.digest == $clone[0].payload.migrationTool.digest
    and .migrationToolVerification.sourceCommit == $clone[0].payload.migrationTool.sourceCommit
    and .migrationToolVerification.registryBinding == $clone[0].payload.migrationTool.registryBinding
    and .migrationToolVerification.sbom == $clone[0].payload.migrationTool.sbom
    and .migrationToolVerification.provenance == $clone[0].payload.migrationTool.provenance
    and .migrationToolVerification.signature.signedDigest == $clone[0].payload.migrationTool.signature.signedDigest
    and .migrationToolVerification.signature.identity == $clone[0].payload.migrationTool.signature.identity
    and .migrationToolVerification.signature.issuer == $clone[0].payload.migrationTool.signature.issuer
    and .runtimeSecurityBaseline.rds.instanceIdentifier
      == $clone[0].payload.cloneInfrastructure.sourceDbIdentifier
    and .runtimeSecurityBaseline.rds.instanceArn
      == $clone[0].payload.cloneInfrastructure.sourceDbInstanceArn
    and ((.artifactIntegrity.services[] | select(.service == "api-web")) as $api
      | .runtimeSecurityBaseline.clamavCandidate.apiImage == $api.image
        and .runtimeSecurityBaseline.clamavCandidate.apiDigest == $api.digest
        and .runtimeSecurityBaseline.clamavCandidate.sourceCommit == $api.sourceCommit)
  ' "$facts" >/dev/null || { echo "ERROR: security preflight fact set is not exact" >&2; exit 1; }

  workspace="$(mktemp -d "${TMPDIR:-/tmp}/production-security-build.XXXXXX")"
  printf -v cleanup 'rm -rf -- %q' "$workspace"
  trap "$cleanup" EXIT
  verification="$workspace/verification.json"
  synthetic="$workspace/synthetic.json"

  rollback_commands="$(security_preflight_hash_value "$facts" '.rollbackRecovery.commands | map(.command)')"
  rollback_output="$(security_preflight_hash_value "$facts" \
    '.rollbackRecovery.commands | map({command,outputSha256})')"
  trust_hash="$(security_preflight_hash_value "$facts" '.awsIdentityBoundary.trustPolicy')"
  policy_hash="$(security_preflight_hash_value "$facts" '.awsIdentityBoundary.inlinePolicy')"
  jq -cS --arg commandHash "$rollback_commands" --arg outputHash "$rollback_output" \
    --arg trustHash "$trust_hash" --arg policyHash "$policy_hash" \
    --slurpfile h2 "$h2" --slurpfile clone "$clone" '
      {
        controllerTrust,
        artifactIntegrity,
        migrationReview:{productionA5PreMutationRef,productionA5CloneRef,
          migrationTool:$clone[0].payload.migrationTool,
          migrationToolVerification,
          productionA5PreMutationPayload:$h2[0].payload},
        rollbackRecovery:(.rollbackRecovery + {commandListSha256:$commandHash,
          combinedOutputSha256:$outputHash}),
        protectedMainPolicy,
        productionEnvironmentPolicy,
        runtimeSecurityBaseline,
        awsIdentityBoundary:(.awsIdentityBoundary + {observedTrustPolicySha256:$trustHash,
          observedInlinePolicySha256:$policyHash})
      }
    ' "$facts" > "$verification"

  controller_hash="$(security_preflight_hash_value "$verification" '.controllerTrust')"
  artifact_hash="$(security_preflight_hash_value "$verification" '.artifactIntegrity')"
  migration_hash="$(security_preflight_hash_value "$verification" '.migrationReview')"
  rollback_hash="$(security_preflight_hash_value "$verification" '.rollbackRecovery')"
  branch_hash="$(security_preflight_hash_value "$verification" '.protectedMainPolicy')"
  environment_hash="$(security_preflight_hash_value "$verification" '.productionEnvironmentPolicy')"
  runtime_hash="$(security_preflight_hash_value "$verification" '.runtimeSecurityBaseline')"
  aws_hash="$(security_preflight_hash_value "$verification" '.awsIdentityBoundary')"
  validator_hash="$(security_preflight_hash_value "$verification" '.controllerTrust.validators')"
  contexts_hash="$(security_preflight_hash_value "$verification" '.protectedMainPolicy.requiredStatusContexts')"

  jq -cnS --slurpfile facts "$facts" --slurpfile h2 "$h2" --slurpfile verification "$verification" \
    --arg controllerHash "$controller_hash" --arg artifactHash "$artifact_hash" \
    --arg migrationHash "$migration_hash" --arg rollbackHash "$rollback_hash" \
    --arg branchHash "$branch_hash" --arg environmentHash "$environment_hash" \
    --arg runtimeHash "$runtime_hash" --arg awsHash "$aws_hash" \
    --arg validatorHash "$validator_hash" --arg contextsHash "$contexts_hash" '
      ($h2[0].payload.migrationState) as $migration
      | ($migration.migrationRiskSummary) as $risk
      | ($verification[0]) as $raw
      | {
          uatAcceptanceRef:$facts[0].uatAcceptanceRef,
          releaseManifestSha256:$raw.artifactIntegrity.releaseManifestSha256,
          candidateMigrationSetHash:$migration.candidateMigrationSetHash,
          reviewedMigrationOperationsHash:$migration.reviewedMigrationOperationsHash,
          expectedSchemaDeltaHash:$migration.expectedSchemaDeltaHash,
          expectedDataTransformHash:$migration.expectedDataTransformHash,
          preflightCatalogHash:$migration.preflightCatalogHash,
          lockBudgetPolicyHash:$migration.lockBudgetPolicyHash,
          expectedSeededRouteHash:$migration.expectedSeededRouteHash,
          expectedClosedWhtRouteHash:$migration.expectedClosedWhtRouteHash,
          services:($raw.artifactIntegrity.services | map({service,image,digest,ociRevision,
            ciSignatureVerified:true,ciSignerIdentity:.liveSignerIdentity,sbomSha256,
            scanStatus,critical,high})),
          checks:{
            controllerTrust:{status:"PASS",ciWorkflowBlob:$raw.controllerTrust.ciWorkflowBlob,
              uatDeployWorkflowBlob:$raw.controllerTrust.uatDeployWorkflowBlob,
              productionDeployWorkflowBlob:$raw.controllerTrust.productionDeployWorkflowBlob,
              validatorSetHash:$validatorHash,evidenceSha256:$controllerHash},
            artifactIntegrity:{status:"PASS",evidenceSha256:$artifactHash},
            migrationReview:{status:"PASS",candidateCount:$risk.candidateCount,
              additiveCount:$risk.additiveCount,
              backwardCompatibleNonadditiveCount:$risk.backwardCompatibleNonadditiveCount,
              dataBackfillCount:$risk.dataBackfillCount,blockingContractCount:$risk.blockingContractCount,
              destructiveCustomerDataLossCount:$risk.destructiveCustomerDataLossCount,
              manualCustomerInputCount:$risk.manualCustomerInputCount,unreviewedCount:$risk.unreviewedCount,
              allPreconditionsPass:true,productionCloneRehearsalPass:true,
              boundedTimeoutPolicyVerified:true,legacyExpectedAbsentProfileVerified:true,
              evidenceSha256:$migrationHash},
            rollbackRecovery:{status:"PASS",evidenceSha256:$rollbackHash},
            protectedMainPolicy:{status:"PASS",strictRequiredChecks:$raw.protectedMainPolicy.strictRequiredChecks,
              requiredStatusContextCount:($raw.protectedMainPolicy.requiredStatusContexts|length),
              requiredStatusContextsHash:$contextsHash,enforceAdmins:$raw.protectedMainPolicy.enforceAdmins,
              requiredPullRequestApprovals:$raw.protectedMainPolicy.requiredPullRequestApprovals,
              dismissStaleReviews:$raw.protectedMainPolicy.dismissStaleReviews,
              requireLastPushApproval:$raw.protectedMainPolicy.requireLastPushApproval,
              forcePushAllowed:$raw.protectedMainPolicy.forcePushAllowed,
              deletionAllowed:$raw.protectedMainPolicy.deletionAllowed,evidenceSha256:$branchHash},
            productionEnvironmentPolicy:{status:"PASS",mainOnly:true,
              nativeReviewerRule:$raw.productionEnvironmentPolicy.nativeReviewerRule,
              nativeRequiredReviewerCount:$raw.productionEnvironmentPolicy.nativeRequiredReviewerCount,
              nativeSelfReviewPrevented:$raw.productionEnvironmentPolicy.nativeSelfReviewPrevented,
              lastConfigurationHttpStatus:$raw.productionEnvironmentPolicy.lastConfigurationHttpStatus,
              evidenceSha256:$environmentHash},
            runtimeSecurityBaseline:{status:"PASS",evidenceSha256:$runtimeHash},
            awsIdentityBoundary:{status:"PASS",evidenceSha256:$awsHash}
          },
          verificationEvidence:$raw,
          passed:true
        }
    ' > "$output"
  jq -cnS --slurpfile payload "$output" --slurpfile facts "$facts" --slurpfile h2 "$h2" '
    {artifactKind:"PRODUCTION_SECURITY_PREFLIGHT_V1",repository:$h2[0].repository,
      sourceCommit:$facts[0].sourceCommit,issuedAtEpoch:$h2[0].issuedAtEpoch,
      producer:{controllerCommit:$facts[0].controllerTrust.producerControllerCommit,
        workflowBlob:$facts[0].controllerTrust.securityPreflightWorkflowBlob},
      parentProductionRun:{controllerCommit:$facts[0].controllerTrust.parentControllerCommit,
        workflowBlob:$facts[0].controllerTrust.productionDeployWorkflowBlob},payload:$payload[0]}
  ' > "$synthetic"
  signed_evidence_validate_payload_contract "$synthetic" || exit 1
)

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  command_name="${1:-}"
  shift || true
  case "$command_name" in
    build) security_preflight_build_payload "$@" ;;
    extract) security_preflight_extract_artifact "$@" ;;
    metadata) security_preflight_validate_artifact_metadata "$@" ;;
    *) echo "Usage: $0 <build|extract|metadata> ..." >&2; exit 2 ;;
  esac
fi
