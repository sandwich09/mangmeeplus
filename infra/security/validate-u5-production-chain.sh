#!/usr/bin/env bash
set -euo pipefail

u5_chain_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
# shellcheck source=infra/security/signed-evidence.sh
source "$u5_chain_root/infra/security/signed-evidence.sh"

u5_chain_fail() {
  echo "ERROR: $*" >&2
  return 1
}

u5_chain_assert_evidence() {
  [ "$#" -eq 3 ] || { u5_chain_fail "assert-evidence expects file, kind and stage"; return 2; }
  local file="$1" kind="$2" stage="$3"
  _signed_evidence_regular_file "$file" 1048576
  _signed_evidence_single_json_object "$file"
  signed_evidence_validate_payload_contract "$file"
  jq -e --arg kind "$kind" --arg stage "$stage" '
    .artifactKind == $kind and .environment == "production"
    and (if $kind == "PRODUCTION_A5_EVIDENCE_V1" then
      .payload.stage == $stage and .payload.passed == true
    elif $kind == "PRODUCTION_SECURITY_PREFLIGHT_V1" then
      $stage == "PRE_MUTATION" and .payload.passed == true
    elif $kind == "PRODUCTION_A5_CLONE_REHEARSAL_V1" then
      $stage == "CLONE" and .payload.passed == true
    elif $kind == "U5_SHADOW_AGGREGATE_V1" then
      .payload.stage == $stage and .payload.shadowOnlyReady == true
    else $stage == "APPROVAL" end)
  ' "$file" >/dev/null || u5_chain_fail "$kind $stage evidence is not an exact passing stage"
}

u5_chain_assert_ref() {
  [ "$#" -eq 3 ] || { u5_chain_fail "assert-ref expects ref, evidence and kind"; return 2; }
  local ref="$1" evidence="$2" kind="$3" expected_name content
  _signed_evidence_regular_file "$ref" 65536
  _signed_evidence_single_json_object "$ref"
  content="$(signed_evidence_content_sha256 "$evidence")"
  expected_name="$(jq -er '[.artifactKind,.sourceCommit,"production",.parentProductionRun.runId,
    "attempt",(.parentProductionRun.runAttempt|tostring),"producer",.producer.runId,
    "attempt",(.producer.runAttempt|tostring)] | join("-")' "$evidence")"
  jq -e --arg kind "$kind" --arg name "$expected_name" --arg content "$content" \
    --arg run "$(jq -er '.producer.runId' "$evidence")" \
    --argjson attempt "$(jq -er '.producer.runAttempt' "$evidence")" '
      (keys | sort) == ["artifactDigest","artifactKind","artifactName","contentSha256",
        "producerRunAttempt","producerRunId"]
      and .artifactKind == $kind and .artifactName == $name
      and .producerRunId == $run and .producerRunAttempt == $attempt
      and .contentSha256 == $content
      and (.artifactDigest | test("^sha256:[0-9a-f]{64}$"))
    ' "$ref" >/dev/null || u5_chain_fail "$kind child reference does not bind the verified bytes"
}

u5_chain_assert_same_lineage() {
  [ "$#" -ge 2 ] || { u5_chain_fail "same-lineage expects at least two evidence files"; return 2; }
  local first="$1" file
  shift
  for file in "$@"; do
    jq -e --slurpfile first "$first" '
      .repository == $first[0].repository
      and .environment == $first[0].environment
      and .sourceCommit == $first[0].sourceCommit
      and .parentProductionRun == $first[0].parentProductionRun
    ' "$file" >/dev/null || u5_chain_fail "evidence lineage/source/parent mismatch"
  done
}

u5_chain_assert_h3_binds_h2() {
  [ "$#" -eq 6 ] || {
    u5_chain_fail "H3 binding expects H2/ref, clone/ref and H3/ref"; return 2
  }
  local h2="$1" h2_ref="$2" clone="$3" clone_ref="$4" h3="$5" h3_ref="$6"
  u5_chain_assert_evidence "$h2" PRODUCTION_A5_EVIDENCE_V1 PRE_MUTATION
  u5_chain_assert_ref "$h2_ref" "$h2" PRODUCTION_A5_EVIDENCE_V1
  u5_chain_assert_evidence "$clone" PRODUCTION_A5_CLONE_REHEARSAL_V1 CLONE
  u5_chain_assert_ref "$clone_ref" "$clone" PRODUCTION_A5_CLONE_REHEARSAL_V1
  u5_chain_assert_evidence "$h3" PRODUCTION_SECURITY_PREFLIGHT_V1 PRE_MUTATION
  u5_chain_assert_ref "$h3_ref" "$h3" PRODUCTION_SECURITY_PREFLIGHT_V1
  u5_chain_assert_same_lineage "$h2" "$clone" "$h3"
  jq -e --slurpfile h2 "$h2" --slurpfile h2ref "$h2_ref" \
    --slurpfile clone "$clone" --slurpfile cloneRef "$clone_ref" '
    .payload.verificationEvidence.migrationReview.productionA5PreMutationPayload == $h2[0].payload
    and .payload.verificationEvidence.migrationReview.productionA5PreMutationRef == $h2ref[0]
    and $h2[0].payload.migrationState.verificationEvidence.cloneRehearsalRef == $cloneRef[0]
    and .payload.verificationEvidence.migrationReview.productionA5CloneRef == $cloneRef[0]
    and .payload.verificationEvidence.migrationReview.migrationTool == $clone[0].payload.migrationTool
    and $h2[0].payload.readerRuntime.migrationImage == $clone[0].payload.migrationTool.image
    and $clone[0].payload.cloneRehearsal
      == $h2[0].payload.migrationState.verificationEvidence.cloneRehearsal
    and $clone[0].payload.reviewedManifest == $h2[0].payload.migrationState.reviewedManifest
    and $clone[0].payload.sourceAppliedMigrationsHash
      == $h2[0].payload.migrationState.appliedMigrationsHash
    and .payload.candidateMigrationSetHash == $h2[0].payload.migrationState.candidateMigrationSetHash
    and .payload.reviewedMigrationOperationsHash == $h2[0].payload.migrationState.reviewedMigrationOperationsHash
    and .payload.expectedSchemaDeltaHash == $h2[0].payload.migrationState.expectedSchemaDeltaHash
    and .payload.expectedDataTransformHash == $h2[0].payload.migrationState.expectedDataTransformHash
    and .payload.preflightCatalogHash == $h2[0].payload.migrationState.preflightCatalogHash
    and .payload.lockBudgetPolicyHash == $h2[0].payload.migrationState.lockBudgetPolicyHash
    and .payload.expectedSeededRouteHash == $h2[0].payload.migrationState.expectedSeededRouteHash
    and .payload.expectedClosedWhtRouteHash == $h2[0].payload.migrationState.expectedClosedWhtRouteHash
    and $h2[0].payload.reimbursementWriteQuiesce.acceptedFinalSourceCommit == .sourceCommit
    and $h2[0].payload.reimbursementWriteQuiesce.acceptedFinalApiImage
      == (.payload.services[]|select(.service == "api-web")|.image)
  ' "$h3" >/dev/null || u5_chain_fail \
    "security preflight does not bind the exact verified H2 PRE/clone/migration tool"
}

u5_chain_assert_approval_binds_chain() {
  [ "$#" -eq 7 ] || {
    u5_chain_fail "approval binding expects H2/ref, clone/ref, H3/ref and approval"; return 2
  }
  local pre="$1" pre_ref="$2" clone="$3" clone_ref="$4" h3="$5" h3_ref="$6" approval="$7"
  jq -e --slurpfile pre "$pre" --slurpfile preRef "$pre_ref" \
    --slurpfile clone "$clone" --slurpfile cloneRef "$clone_ref" \
    --slurpfile h3 "$h3" --slurpfile h3Ref "$h3_ref" '
    ($pre[0].payload.migrationState) as $migration
    | .payload.productionA5PreMutationRef == $preRef[0]
    and .payload.productionA5CloneRef == $cloneRef[0]
    and .payload.securityPreflightRef == $h3Ref[0]
    and .payload.uatAcceptanceRef == $h3[0].payload.uatAcceptanceRef
    and .payload.migrationTool == $clone[0].payload.migrationTool
    and .payload.migrationTool
      == $h3[0].payload.verificationEvidence.migrationReview.migrationTool
    and .payload.candidateMigrationSetHash == $migration.candidateMigrationSetHash
    and .payload.reviewedMigrationOperationsHash == $migration.reviewedMigrationOperationsHash
    and .payload.expectedSchemaDeltaHash == $migration.expectedSchemaDeltaHash
    and .payload.expectedDataTransformHash == $migration.expectedDataTransformHash
    and .payload.preflightCatalogHash == $migration.preflightCatalogHash
    and .payload.lockBudgetPolicyHash == $migration.lockBudgetPolicyHash
    and .payload.expectedSeededRouteHash == $migration.expectedSeededRouteHash
    and .payload.expectedClosedWhtRouteHash == $migration.expectedClosedWhtRouteHash
  ' "$approval" >/dev/null || u5_chain_fail \
    "owner approval does not bind the exact H2/clone/security/migration-tool chain"
}

u5_chain_assert_h2_post_chain() {
  [ "$#" -eq 8 ] || {
    u5_chain_fail "H2 POST chain expects PRE/ref, POST_MIGRATION/ref, POST_DEPLOYMENT/ref, approval/ref"
    return 2
  }
  local pre="$1" pre_ref="$2" post_migration="$3" post_migration_ref="$4"
  local post_deployment="$5" post_deployment_ref="$6" approval="$7" approval_ref="$8"
  u5_chain_assert_evidence "$pre" PRODUCTION_A5_EVIDENCE_V1 PRE_MUTATION
  u5_chain_assert_evidence "$post_migration" PRODUCTION_A5_EVIDENCE_V1 POST_MIGRATION
  u5_chain_assert_evidence "$post_deployment" PRODUCTION_A5_EVIDENCE_V1 POST_DEPLOYMENT
  u5_chain_assert_ref "$pre_ref" "$pre" PRODUCTION_A5_EVIDENCE_V1
  u5_chain_assert_ref "$post_migration_ref" "$post_migration" PRODUCTION_A5_EVIDENCE_V1
  u5_chain_assert_ref "$post_deployment_ref" "$post_deployment" PRODUCTION_A5_EVIDENCE_V1
  u5_chain_assert_evidence "$approval" OWNER_U5E_APPROVAL_V1 APPROVAL
  u5_chain_assert_ref "$approval_ref" "$approval" OWNER_U5E_APPROVAL_V1
  u5_chain_assert_same_lineage "$pre" "$post_migration" "$post_deployment" "$approval"
  jq -e --slurpfile pre "$pre" --slurpfile preRef "$pre_ref" \
    --slurpfile migration "$post_migration" --slurpfile migrationRef "$post_migration_ref" \
    --slurpfile approval "$approval" --slurpfile approvalRef "$approval_ref" '
    def migration_hashes: .payload.migrationState | {
      candidateMigrationSetHash,reviewedMigrationOperationsHash,expectedSchemaDeltaHash,
      expectedDataTransformHash,preflightCatalogHash,lockBudgetPolicyHash,
      expectedSeededRouteHash,expectedClosedWhtRouteHash
    };
    .payload.baselineRefs.preMutationRef == $preRef[0]
    and .payload.baselineRefs.postMigrationRef == $migrationRef[0]
    and migration_hashes == ($pre[0] | migration_hashes)
    and migration_hashes == ($migration[0] | migration_hashes)
    and $migration[0].payload.migrationState.productionApplyAuthority.ownerApprovalRef
      == $approvalRef[0]
    and .payload.migrationState.productionApplyAuthority.ownerApprovalRef == $approvalRef[0]
    and $migration[0].payload.migrationState.productionApplyAuthority.maintenanceWindow
      == $approval[0].payload.maintenanceWindow
    and .payload.migrationState.productionApplyAuthority.maintenanceWindow
      == $approval[0].payload.maintenanceWindow
    and .payload.authoritySnapshot.preexistingEntitlementStateHash
      == $pre[0].payload.authoritySnapshot.preexistingEntitlementStateHash
    and .payload.authoritySnapshot.preexistingAuthorityStateHash
      == $pre[0].payload.authoritySnapshot.preexistingAuthorityStateHash
    and .payload.authoritySnapshot.effectiveOpenPolicyHash
      == $pre[0].payload.authoritySnapshot.effectiveOpenPolicyHash
    and .payload.authoritySnapshot.safeOffAdmissionHash
      == $pre[0].payload.authoritySnapshot.safeOffAdmissionHash
    and .payload.authoritySnapshot.allowListHash
      == $pre[0].payload.authoritySnapshot.allowListHash
    and .payload.authoritySnapshot.featureLaunchStateHash
      == $migration[0].payload.authoritySnapshot.featureLaunchStateHash
    and .payload.authoritySnapshot.whtMaterialization.actualCounts == {total:3,open:0,closed:3}
    and .payload.authoritySnapshot.whtMaterialization.actualRoutes
      == $migration[0].payload.authoritySnapshot.whtMaterialization.actualRoutes
    and $migration[0].payload.reimbursementWriteQuiesce.bridgeProof
      == $pre[0].payload.reimbursementWriteQuiesce.bridgeProof
    and $migration[0].payload.reimbursementWriteQuiesce.acceptedFinalSourceCommit
      == $pre[0].payload.reimbursementWriteQuiesce.acceptedFinalSourceCommit
    and $migration[0].payload.reimbursementWriteQuiesce.acceptedFinalApiImage
      == $pre[0].payload.reimbursementWriteQuiesce.acceptedFinalApiImage
    and $migration[0].payload.reimbursementWriteQuiesce.quiesceStartedAtEpoch
      == $pre[0].payload.reimbursementWriteQuiesce.quiesceStartedAtEpoch
    and .payload.reimbursementWriteQuiesce.bridgeProof
      == $pre[0].payload.reimbursementWriteQuiesce.bridgeProof
    and .payload.reimbursementWriteQuiesce.acceptedFinalSourceCommit
      == $pre[0].payload.reimbursementWriteQuiesce.acceptedFinalSourceCommit
    and .payload.reimbursementWriteQuiesce.acceptedFinalApiImage
      == $pre[0].payload.reimbursementWriteQuiesce.acceptedFinalApiImage
    and .payload.reimbursementWriteQuiesce.quiesceStartedAtEpoch
      == $pre[0].payload.reimbursementWriteQuiesce.quiesceStartedAtEpoch
    and .payload.reimbursementWriteQuiesce.reimbursementInvariantHash
      == $migration[0].payload.reimbursementWriteQuiesce.reimbursementInvariantHash
    and .payload.servingBuilds == [
      {service:"ai-gateway",sourceCommit:.sourceCommit},
      {service:"api-web",sourceCommit:.sourceCommit},
      {service:"workers",sourceCommit:.sourceCommit}
    ]
    and (.payload.comparisons | all(.[]; . == true))
  ' "$post_deployment" >/dev/null || u5_chain_fail "H2 POST chain changed authority, migration or CLOSED launch state"
}

u5_chain_pending_json() {
  local capacity="$1"
  jq -cnS --arg capacity "$capacity" '
    ["ACCESSIBILITY","ACTIONABLE_WORK_CARD","ASYNC_SHADOW_OR_ROUTE_JOURNEY",
     "MODERATED_USABILITY_2X5","NON_REPORTS_SAFE_OFF",
     "VAT_NATURALLY_ELIGIBLE_UAT_JOURNEY","WHT_STATUTORY_ACCEPTANCE"]
    + (if $capacity == "PENDING" then ["U5_CAPACITY_RESULT"] else [] end) | sort
  '
}

u5_chain_build_aggregate() {
  [ "$#" -eq 15 ] || {
    u5_chain_fail "build-aggregate expects stage, PRE/ref, clone/ref, H3/ref, POST_MIG/ref, POST_DEP/ref, capacity-ref-or-, approval/ref-or-, output"
    return 2
  }
  local stage="$1" pre="$2" pre_ref="$3" clone="$4" clone_ref="$5" h3="$6" h3_ref="$7"
  local post_migration="$8" post_migration_ref="$9" post_deployment="${10}"
  local post_deployment_ref="${11}" capacity_ref="${12}" approval="${13}"
  local approval_ref="${14}" output="${15}"
  local capacity_status=PENDING capacity_json=null pending
  u5_chain_assert_h3_binds_h2 "$pre" "$pre_ref" "$clone" "$clone_ref" "$h3" "$h3_ref"
  case "$capacity_ref" in
    -) ;;
    *)
      _signed_evidence_regular_file "$capacity_ref" 65536
      jq -e '.artifactKind == "U5_CAPACITY_RESULT_V1"' "$capacity_ref" >/dev/null
      capacity_status=PASS
      capacity_json="$(jq -cS . "$capacity_ref")"
      ;;
  esac
  pending="$(u5_chain_pending_json "$capacity_status")"

  if [ "$stage" = POST_DEPLOYMENT ]; then
    u5_chain_assert_approval_binds_chain "$pre" "$pre_ref" "$clone" "$clone_ref" \
      "$h3" "$h3_ref" "$approval"
    u5_chain_assert_h2_post_chain "$pre" "$pre_ref" "$post_migration" \
      "$post_migration_ref" "$post_deployment" "$post_deployment_ref" "$approval" "$approval_ref"
  elif [ "$stage" != PRE_AUTHORIZATION ]; then
    u5_chain_fail "aggregate stage must be PRE_AUTHORIZATION or POST_DEPLOYMENT"
    return 1
  fi

  jq -cnS --slurpfile pre "$pre" --slurpfile preRef "$pre_ref" \
    --slurpfile cloneRef "$clone_ref" --slurpfile h3 "$h3" --slurpfile h3Ref "$h3_ref" \
    --arg stage "$stage" --arg capacityStatus "$capacity_status" \
    --argjson capacityRef "$capacity_json" --argjson pending "$pending" \
    --argfile postMigrationRef <(if [ "$stage" = POST_DEPLOYMENT ]; then cat "$post_migration_ref"; else echo null; fi) \
    --argfile postDeploymentRef <(if [ "$stage" = POST_DEPLOYMENT ]; then cat "$post_deployment_ref"; else echo null; fi) \
    --argfile ownerApprovalRef <(if [ "$stage" = POST_DEPLOYMENT ]; then cat "$approval_ref"; else echo null; fi) \
    --slurpfile postMigration <(if [ "$stage" = POST_DEPLOYMENT ]; then cat "$post_migration"; else echo '{}'; fi) '
      ($pre[0].payload.migrationState) as $migration
      | ($pre[0].payload.authoritySnapshot) as $authority
      | ($h3[0].payload.uatAcceptanceRef) as $uat
      | {stage:$stage,deploymentClass:"PRODUCTION_SHADOW_ONLY",uatAcceptanceRef:$uat,
         securityPreflightRef:$h3Ref[0],
         ownerApprovalRef:$ownerApprovalRef,
         productionA5:{preMutationRef:$preRef[0],cloneRehearsalRef:$cloneRef[0],
           migrationTool:$h3[0].payload.verificationEvidence.migrationReview.migrationTool,
           postMigrationRef:$postMigrationRef,postDeploymentRef:$postDeploymentRef},
         u5Capacity:(if $capacityStatus == "PASS"
           then {status:"PASS",resultRef:$capacityRef,restriction:null}
           else {status:"PENDING",resultRef:null,restriction:"NO_BATCH_OR_ENFORCEMENT"} end),
         wht:{status:(if $stage == "PRE_AUTHORIZATION"
             then "PLANNED_CLOSED_MATERIALIZATION" else "MATERIALIZED_CLOSED" end),
           reviewedExpectedAfterMigration:{total:3,open:0,closed:3,
             routeHash:$migration.expectedClosedWhtRouteHash,
             routes:["cap.wht50bis/SYSTEM_CONTENT_CORRECTION",
               "cap.wht50bis/SYSTEM_INITIAL_ISSUE","cap.wht50bis/SYSTEM_REPLACEMENT_COPY"]},
           actual:(if $stage == "POST_DEPLOYMENT" then {total:3,open:0,closed:3,
             routeHash:$migration.expectedClosedWhtRouteHash,
             routes:["cap.wht50bis/SYSTEM_CONTENT_CORRECTION",
               "cap.wht50bis/SYSTEM_INITIAL_ISSUE","cap.wht50bis/SYSTEM_REPLACEMENT_COPY"]}
             else null end)},
         enforcement:{baseline:{preexistingEntitlementStateHash:$authority.preexistingEntitlementStateHash,
             preexistingAuthorityStateHash:$authority.preexistingAuthorityStateHash,
             effectiveOpenPolicyHash:$authority.effectiveOpenPolicyHash},
           reviewedMigrationMaterialization:{candidateMigrationSetHash:$migration.candidateMigrationSetHash,
             reviewedMigrationOperationsHash:$migration.reviewedMigrationOperationsHash,
             expectedSchemaDeltaHash:$migration.expectedSchemaDeltaHash,
             expectedDataTransformHash:$migration.expectedDataTransformHash,
             preflightCatalogHash:$migration.preflightCatalogHash,
             lockBudgetPolicyHash:$migration.lockBudgetPolicyHash,
             expectedSeededRouteHash:$migration.expectedSeededRouteHash,
             expectedClosedWhtRouteHash:$migration.expectedClosedWhtRouteHash},
           requestedEntitlementTransitions:[],requestedLaunchGateTransitions:[],
           requestedSafeOffAdmissions:[],requestedAllowListChanges:[],
           result:(if $stage == "PRE_AUTHORIZATION"
             then "PLANNED_CLOSED_REVIEWED_MATERIALIZATION" else "UNCHANGED" end)},
         humanEvidence:{claimed:false,usabilityReports:[],specialistApprovals:[],
           restriction:"NOT_GA_OR_WHT_OPEN_AUTHORITY"},pending:$pending,shadowOnlyReady:true}
    ' > "$output"
  jq -cnS --arg source "$(jq -er '.sourceCommit' "$pre")" --slurpfile payload "$output" \
    '{artifactKind:"U5_SHADOW_AGGREGATE_V1",sourceCommit:$source,payload:$payload[0]}' \
    | signed_evidence_validate_payload_contract /dev/stdin
}

u5_chain_build_approval() {
  [ "$#" -eq 8 ] || {
    u5_chain_fail "build-approval expects PRE/ref, owner, producer run/attempt, parent attempt, issued epoch and output"
    return 2
  }
  local aggregate="$1" aggregate_ref="$2" owner="$3" producer_run="$4"
  local producer_attempt="$5" parent_attempt="$6" issued_at="$7" output="$8"
  u5_chain_assert_evidence "$aggregate" U5_SHADOW_AGGREGATE_V1 PRE_AUTHORIZATION
  u5_chain_assert_ref "$aggregate_ref" "$aggregate" U5_SHADOW_AGGREGATE_V1
  [[ "$owner" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$ ]] || u5_chain_fail "repository owner login is invalid"
  [[ "$producer_run" =~ ^[1-9][0-9]*$ ]] || u5_chain_fail "approval producer run is invalid"
  [[ "$producer_attempt" =~ ^[1-9][0-9]*$ ]] || u5_chain_fail "approval attempt is invalid"
  [[ "$parent_attempt" =~ ^[1-9][0-9]*$ ]] || u5_chain_fail "parent attempt is invalid"
  [[ "$issued_at" =~ ^[1-9][0-9]*$ ]] || u5_chain_fail "approval issued epoch is invalid"
  jq -cnS --slurpfile aggregate "$aggregate" --slurpfile aggregateRef "$aggregate_ref" \
    --arg owner "$owner" --arg producerRun "$producer_run" \
    --argjson producerAttempt "$producer_attempt" --argjson parentAttempt "$parent_attempt" \
    --argjson issued "$issued_at" '
      ($aggregate[0].payload) as $pre
      | ($pre.enforcement.reviewedMigrationMaterialization) as $migration
      | {approvalScope:"PRODUCTION_SHADOW_ONLY",
         approver:{authority:"GITHUB_REPOSITORY_OWNER",login:$owner},
         preAggregateRef:$aggregateRef[0],uatAcceptanceRef:$pre.uatAcceptanceRef,
         productionA5PreMutationRef:$pre.productionA5.preMutationRef,
         productionA5CloneRef:$pre.productionA5.cloneRehearsalRef,
         migrationTool:$pre.productionA5.migrationTool,
         securityPreflightRef:$pre.securityPreflightRef,
         candidateMigrationSetHash:$migration.candidateMigrationSetHash,
         reviewedMigrationOperationsHash:$migration.reviewedMigrationOperationsHash,
         expectedSchemaDeltaHash:$migration.expectedSchemaDeltaHash,
         expectedDataTransformHash:$migration.expectedDataTransformHash,
         preflightCatalogHash:$migration.preflightCatalogHash,
         lockBudgetPolicyHash:$migration.lockBudgetPolicyHash,
         expectedSeededRouteHash:$migration.expectedSeededRouteHash,
         expectedClosedWhtRouteHash:$migration.expectedClosedWhtRouteHash,
         maintenanceWindow:{windowId:("u5e-"+$aggregate[0].parentProductionRun.runId
             +"-a"+($parentAttempt|tostring)+"-"+$producerRun+"-a"+($producerAttempt|tostring)),
           startsAtEpochMs:($issued*1000),endsAtEpochMs:(($issued+1800)*1000),
           failurePolicy:"LEAVE_REIMBURSEMENT_QUIESCED_REQUIRE_FRESH_APPROVAL"},
         authorizedActions:{applyExactReviewedMigrationSet:true,
           materializeExactReviewedClosedFeatureLaunchObjects:true,
           deployExactAcceptedImages:true,entitlementTransitions:[],launchGateTransitions:[],
           safeOffAdmissions:[],allowListChanges:[]}}
    ' > "$output"
  jq -cnS --arg owner "$owner" --arg run "$producer_run" \
    --argjson attempt "$producer_attempt" --argjson parentAttempt "$parent_attempt" \
    --argjson issued "$issued_at" --slurpfile aggregate "$aggregate" --slurpfile payload "$output" \
    '{artifactKind:"OWNER_U5E_APPROVAL_V1",repository:$aggregate[0].repository,
      sourceCommit:$aggregate[0].sourceCommit,issuedAtEpoch:$issued,expiresAtEpoch:($issued+1800),
      producer:{workflowPath:".github/workflows/u5-owner-approval.yml",runId:$run,
        runAttempt:$attempt,actor:$owner,triggeringActor:$owner},
      parentProductionRun:{runId:$aggregate[0].parentProductionRun.runId,runAttempt:$parentAttempt},
      payload:$payload[0]}' \
    | signed_evidence_validate_payload_contract /dev/stdin
}

u5_chain_assert_approval_current() {
  [ "$#" -eq 2 ] || { u5_chain_fail "approval-current expects evidence and epoch"; return 2; }
  local approval="$1" now="$2"
  [[ "$now" =~ ^[1-9][0-9]*$ ]] || u5_chain_fail "current epoch is invalid"
  u5_chain_assert_evidence "$approval" OWNER_U5E_APPROVAL_V1 APPROVAL
  jq -e --argjson now "$now" '
    .issuedAtEpoch <= $now and $now < .expiresAtEpoch
    and ($now * 1000) >= .payload.maintenanceWindow.startsAtEpochMs
    and ($now * 1000) < .payload.maintenanceWindow.endsAtEpochMs
  ' "$approval" >/dev/null || u5_chain_fail \
    "owner approval expired; keep reimbursement quiesced and obtain a fresh approval"
}

u5_chain_validate_pre_authority() {
  [ "$#" -eq 12 ] || {
    u5_chain_fail "validate-pre expects H2/ref, clone/ref, H3/ref, aggregate/ref, approval/ref, owner and epoch"
    return 2
  }
  local h2="$1" h2_ref="$2" clone="$3" clone_ref="$4" h3="$5" h3_ref="$6"
  local aggregate="$7" aggregate_ref="$8" approval="$9" approval_ref="${10}"
  local repository_owner="${11}" now="${12}" expected_aggregate expected_approval capacity_ref capacity_tmp
  u5_chain_assert_h3_binds_h2 "$h2" "$h2_ref" "$clone" "$clone_ref" "$h3" "$h3_ref"
  u5_chain_assert_evidence "$aggregate" U5_SHADOW_AGGREGATE_V1 PRE_AUTHORIZATION
  u5_chain_assert_ref "$aggregate_ref" "$aggregate" U5_SHADOW_AGGREGATE_V1
  u5_chain_assert_same_lineage "$h2" "$clone" "$h3" "$aggregate" "$approval"
  expected_aggregate="$(mktemp "${TMPDIR:-/tmp}/u5-pre-aggregate.XXXXXX")"
  expected_approval="$(mktemp "${TMPDIR:-/tmp}/u5-pre-approval.XXXXXX")"
  capacity_tmp="$(mktemp "${TMPDIR:-/tmp}/u5-capacity-ref.XXXXXX")"
  capacity_ref="$capacity_tmp"
  trap 'rm -f "$expected_aggregate" "$expected_approval" "$capacity_tmp"' RETURN
  jq -cS '.payload.u5Capacity.resultRef' "$aggregate" > "$capacity_tmp"
  if [ "$(jq -r '.payload.u5Capacity.status' "$aggregate")" = PENDING ]; then
    capacity_ref=-
  fi
  u5_chain_build_aggregate PRE_AUTHORIZATION "$h2" "$h2_ref" "$clone" "$clone_ref" \
    "$h3" "$h3_ref" - - - - "$capacity_ref" - - "$expected_aggregate"
  cmp -s "$expected_aggregate" <(jq -cS '.payload' "$aggregate") \
    || u5_chain_fail "PRE aggregate contains self-authored or drifted facts"
  u5_chain_assert_evidence "$approval" OWNER_U5E_APPROVAL_V1 APPROVAL
  u5_chain_assert_ref "$approval_ref" "$approval" OWNER_U5E_APPROVAL_V1
  u5_chain_assert_approval_current "$approval" "$now"
  u5_chain_assert_approval_binds_chain "$h2" "$h2_ref" "$clone" "$clone_ref" \
    "$h3" "$h3_ref" "$approval"
  u5_chain_build_approval "$aggregate" "$aggregate_ref" "$repository_owner" \
    "$(jq -er '.producer.runId' "$approval")" "$(jq -er '.producer.runAttempt' "$approval")" \
    "$(jq -er '.parentProductionRun.runAttempt' "$approval")" \
    "$(jq -er '.issuedAtEpoch' "$approval")" "$expected_approval"
  cmp -s "$expected_approval" <(jq -cS '.payload' "$approval") \
    || u5_chain_fail "owner approval does not authorize the exact PRE aggregate"
  jq -e --arg owner "$repository_owner" '
    .producer.actor == $owner and .producer.triggeringActor == $owner
    and .payload.approver.login == $owner
  ' "$approval" >/dev/null || u5_chain_fail "owner approval actor is not the repository owner"
}

u5_chain_validate_post() {
  [ "$#" -eq 14 ] || {
    u5_chain_fail "validate-post expects PRE/ref, clone/ref, H3/ref, POST_MIG/ref, POST_DEP/ref, approval/ref, aggregate/ref"
    return 2
  }
  local pre="$1" pre_ref="$2" clone="$3" clone_ref="$4" h3="$5" h3_ref="$6"
  local post_migration="$7" post_migration_ref="$8" post_deployment="$9"
  local post_deployment_ref="${10}" approval="${11}" approval_ref="${12}"
  local aggregate="${13}" aggregate_ref="${14}" expected capacity_tmp capacity_ref="-"
  expected="$(mktemp "${TMPDIR:-/tmp}/u5-post-aggregate.XXXXXX")"
  capacity_tmp="$(mktemp "${TMPDIR:-/tmp}/u5-post-capacity.XXXXXX")"
  trap 'rm -f "$expected" "$capacity_tmp"' RETURN
  u5_chain_assert_evidence "$aggregate" U5_SHADOW_AGGREGATE_V1 POST_DEPLOYMENT
  u5_chain_assert_ref "$aggregate_ref" "$aggregate" U5_SHADOW_AGGREGATE_V1
  u5_chain_assert_same_lineage "$pre" "$clone" "$h3" "$post_migration" \
    "$post_deployment" "$approval" "$aggregate"
  if [ "$(jq -r '.payload.u5Capacity.status' "$aggregate")" = PASS ]; then
    jq -cS '.payload.u5Capacity.resultRef' "$aggregate" > "$capacity_tmp"
    capacity_ref="$capacity_tmp"
  fi
  u5_chain_build_aggregate POST_DEPLOYMENT "$pre" "$pre_ref" "$clone" "$clone_ref" \
    "$h3" "$h3_ref" "$post_migration" "$post_migration_ref" "$post_deployment" \
    "$post_deployment_ref" "$capacity_ref" "$approval" "$approval_ref" "$expected"
  cmp -s "$expected" <(jq -cS '.payload' "$aggregate") \
    || u5_chain_fail "POST aggregate contains self-authored or drifted facts"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  command_name="${1:-}"
  shift || true
  case "$command_name" in
    aggregate) u5_chain_build_aggregate "$@" ;;
    approval) u5_chain_build_approval "$@" ;;
    validate-pre) u5_chain_validate_pre_authority "$@" ;;
    validate-post) u5_chain_validate_post "$@" ;;
    validate-approval-current) u5_chain_assert_approval_current "$@" ;;
    *)
      echo "Usage: $0 <aggregate|approval|validate-pre|validate-post|validate-approval-current> ..." >&2
      exit 2
      ;;
  esac
fi
