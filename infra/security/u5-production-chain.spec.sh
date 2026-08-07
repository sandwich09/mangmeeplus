#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
# shellcheck source=infra/security/validate-u5-production-chain.sh
source "$repo_root/infra/security/validate-u5-production-chain.sh"

fixture="$(mktemp -d "${TMPDIR:-/tmp}/u5-chain-spec.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

expect_reject() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "ERROR: $label was accepted" >&2
    exit 1
  fi
}

approval="$fixture/approval.json"
pre="$fixture/pre.json"
pre_ref="$fixture/pre-ref.json"
clone="$fixture/clone.json"
clone_ref="$fixture/clone-ref.json"
h3="$fixture/h3.json"
h3_ref="$fixture/h3-ref.json"
approval_ref="$fixture/approval-ref.json"
jq -cnS -L "$repo_root/infra/security" --arg source "$(printf 'b%.0s' {1..40})" '
  include "evidence-contracts.fixtures";
  {artifactKind:"OWNER_U5E_APPROVAL_V1",repository:"example/repo",environment:"production",
   sourceCommit:$source,issuedAtEpoch:1700000000,expiresAtEpoch:1700001800,
   producer:{workflowPath:".github/workflows/u5-owner-approval.yml",runId:"7001",runAttempt:1,
     actor:"MangmeeDev",triggeringActor:"MangmeeDev"},
   parentProductionRun:{runId:"8001",runAttempt:1},payload:e0_fixture_h5($source)}
' > "$approval"
jq -cnS -L "$repo_root/infra/security" --arg source "$(printf 'b%.0s' {1..40})" '
  include "evidence-contracts.fixtures";
  {repository:"example/repo",environment:"production",sourceCommit:$source,
   parentProductionRun:{runId:"8001",runAttempt:1},payload:e0_fixture_h2("PRE_MUTATION";$source)}
' > "$pre"
jq -cnS -L "$repo_root/infra/security" --arg source "$(printf 'b%.0s' {1..40})" '
  include "evidence-contracts.fixtures";
  {repository:"example/repo",environment:"production",sourceCommit:$source,
   parentProductionRun:{runId:"8001",runAttempt:1},payload:e0_fixture_clone_payload($source)}
' > "$clone"
jq -cnS -L "$repo_root/infra/security" --arg source "$(printf 'b%.0s' {1..40})" '
  include "evidence-contracts.fixtures";
  {repository:"example/repo",environment:"production",sourceCommit:$source,
   parentProductionRun:{runId:"8001",runAttempt:1},payload:e0_fixture_h3($source)}
' > "$h3"
jq -cnS -L "$repo_root/infra/security" '
  include "evidence-contracts.fixtures"; e0_fixture_ref("PRODUCTION_A5_EVIDENCE_V1")
' > "$pre_ref"
jq -cnS -L "$repo_root/infra/security" '
  include "evidence-contracts.fixtures"; e0_fixture_ref("PRODUCTION_A5_CLONE_REHEARSAL_V1")
' > "$clone_ref"
jq -cnS -L "$repo_root/infra/security" '
  include "evidence-contracts.fixtures"; e0_fixture_ref("PRODUCTION_SECURITY_PREFLIGHT_V1")
' > "$h3_ref"
jq -cnS --arg content "$(signed_evidence_content_sha256 "$approval")" \
  --arg source "$(jq -er '.sourceCommit' "$approval")" '{
    artifactKind:"OWNER_U5E_APPROVAL_V1",producerRunId:"7001",producerRunAttempt:1,
    artifactName:("OWNER_U5E_APPROVAL_V1-"+$source+"-production-8001-attempt-1-producer-7001-attempt-1"),
    contentSha256:$content,artifactDigest:("sha256:"+("8"*64))
  }' > "$approval_ref"

u5_chain_assert_approval_current "$approval" 1700000000
u5_chain_assert_approval_current "$approval" 1700001799
expect_reject expired-approval u5_chain_assert_approval_current "$approval" 1700001800
expect_reject pre-window-approval u5_chain_assert_approval_current "$approval" 1699999999
u5_chain_assert_approval_binds_chain "$pre" "$pre_ref" "$clone" "$clone_ref" \
  "$h3" "$h3_ref" "$approval"
u5_chain_assert_ref "$approval_ref" "$approval" OWNER_U5E_APPROVAL_V1
u5_chain_assert_same_lineage "$pre" "$clone" "$h3" "$approval"

jq -cS '.producerRunId="7999"' "$approval_ref" > "$fixture/forged-owner-ref.json"
expect_reject forged-owner-ref u5_chain_assert_ref "$fixture/forged-owner-ref.json" \
  "$approval" OWNER_U5E_APPROVAL_V1
jq -cS '.parentProductionRun.runAttempt=2' "$approval" > "$fixture/wrong-parent-attempt.json"
expect_reject wrong-parent-attempt u5_chain_assert_same_lineage "$pre" "$clone" "$h3" \
  "$fixture/wrong-parent-attempt.json"

jq -cS '.payload.migrationTool.digest=("sha256:"+("9"*64))' "$approval" \
  > "$fixture/approval-tool-drift.json"
expect_reject approval-tool-drift u5_chain_assert_approval_binds_chain \
  "$pre" "$pre_ref" "$clone" "$clone_ref" "$h3" "$h3_ref" \
  "$fixture/approval-tool-drift.json"
jq -cS '.payload.productionA5CloneRef.producerRunId="9999"' "$approval" \
  > "$fixture/approval-clone-drift.json"
expect_reject approval-clone-drift u5_chain_assert_approval_binds_chain \
  "$pre" "$pre_ref" "$clone" "$clone_ref" "$h3" "$h3_ref" \
  "$fixture/approval-clone-drift.json"

jq -cS '.payload.maintenanceWindow.endsAtEpochMs+=1' "$approval" > "$fixture/drifted-window.json"
expect_reject drifted-window signed_evidence_validate_payload_contract "$fixture/drifted-window.json"

grep -Fq 'production_a5_clone_run_id:' "$repo_root/.github/workflows/production-security-preflight.yml"
grep -Fq 'production_a5_clone_run_id:' "$repo_root/.github/workflows/u5-shadow-evidence.yml"
grep -Fq 'owner_approval_run_id:' "$repo_root/.github/workflows/u5-shadow-evidence.yml"
grep -Fq 'OWNER_U5E_APPROVAL_V1' "$repo_root/.github/workflows/u5-shadow-evidence.yml"
grep -Fq 'issued_at + 1800' "$repo_root/.github/workflows/u5-owner-approval.yml"
grep -Fq 'LEAVE_REIMBURSEMENT_QUIESCED_REQUIRE_FRESH_APPROVAL' \
  "$repo_root/infra/security/validate-u5-production-chain.sh"
grep -Fq '.payload.verificationEvidence.migrationReview.migrationTool == $clone[0].payload.migrationTool' \
  "$repo_root/infra/security/validate-u5-production-chain.sh"
grep -Fq '.source.marker==$marker' "$repo_root/infra/uat/validate-u5-capacity-result.sh"

bash -n "$repo_root/infra/security/validate-u5-production-chain.sh" \
  "$repo_root/infra/security/fetch-verified-production-evidence.sh" \
  "$repo_root/infra/security/fetch-verified-u5-capacity.sh" "$0"

printf '%s\n' 'U5 production evidence-chain specs passed'
