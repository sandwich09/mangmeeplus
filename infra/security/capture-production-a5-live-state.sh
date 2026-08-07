#!/usr/bin/env bash
set -euo pipefail

mode="${1:-}"
shift || true
library="$(cd "$(dirname "$0")" && pwd -P)"

fail() { echo "ERROR: production A5 live-state capture: $*" >&2; exit 1; }
regular_json() {
  [ -f "$1" ] && [ ! -L "$1" ] && jq -e -s 'length==1' "$1" >/dev/null \
    || fail "$2 is not one regular JSON value"
}
sha64() { [[ "$1" =~ ^[0-9a-f]{64}$ ]]; }
full_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }
api_image() {
  [[ "$1" =~ ^311414082667\.dkr\.ecr\.ap-southeast-1\.amazonaws\.com/watchdog-bms-api@sha256:[0-9a-f]{64}$ ]]
}
empty_dir() {
  [ -d "$1" ] && [ ! -L "$1" ] && [ -z "$(find "$1" -mindepth 1 -print -quit)" ] \
    || fail "output directory must exist and be empty"
}

proof_from_health() {
  local health="$1" expected_source="$2" expected_image="$3" expected_flag="$4" output="$5"
  jq -cS --arg source "$expected_source" --arg image "$expected_image" \
    --arg flag "$expected_flag" '
      .services[] | select(.service=="api-web")
      | . as $service
      | .rawEvidence.describeExpressGatewayService.raw.second.service.activeConfigurations[0]
        as $active
      | ([$active.primaryContainer.environment[]?
          | select(.name=="GIT_SHA") | .value]) as $sources
      | ([$active.primaryContainer.environment[]?
          | select(.name=="REIMBURSEMENT_WRITE_QUIESCE") | .value]) as $flags
      | select($sources==[$source] and $flags==[$flag]
          and $active.primaryContainer.image==$image
          and $active.serviceRevisionArn==$service.serviceRevisionArn)
      | {sourceCommit:$source,image:$image,serviceRevisionArn:$service.serviceRevisionArn,
         activeTaskArns:$service.runningTaskArns,
         quiesceEnabled:($flag=="true"),observedAtEpoch:$service.observedAtEpoch}
    ' "$health" > "$output"
  [ -s "$output" ] || fail "live api-web source/image/quiesce does not match the required state"
  jq -e -L "$library" --argjson flag "$expected_flag" '
    include "evidence-contracts"; e0_reimbursement_revision_proof($flag=="true")
  ' "$output" >/dev/null || fail "captured revision proof is invalid"
}

serving_from_health() {
  local health="$1" output="$2"
  jq -cS '[.services[]
    | . as $service
    | .rawEvidence.describeExpressGatewayService.raw.second.service.activeConfigurations[0]
      as $active
    | ([$active.primaryContainer.environment[]?|select(.name=="GIT_SHA")|.value]) as $sources
    | select($sources|length==1)
    | {service:$service.service,sourceCommit:$sources[0]}] | sort_by(.service)' "$health" > "$output"
  jq -e 'length==3 and map(.service)==["ai-gateway","api-web","workers"]' "$output" >/dev/null \
    || fail "live serving-build identities are incomplete"
}

case "$mode" in
  pre)
    [ "$#" -eq 6 ] || fail "usage: pre <health.json> <bridge-source> <bridge-image> <final-source> <final-image> <empty-output-dir>"
    health="$1"; bridge_source="$2"; bridge_image="$3"; final_source="$4"; final_image="$5"; output="$6"
    regular_json "$health" health; full_sha "$bridge_source" && full_sha "$final_source" || fail "source SHA is invalid"
    api_image "$bridge_image" && api_image "$final_image" || fail "API image is invalid"
    [ "$bridge_source" != "$final_source" ] && [ "$bridge_image" != "$final_image" ] \
      || fail "bridge and final identities must be distinct"
    empty_dir "$output"
    jq -e -L "$library" --argjson now "$(date -u +%s)" '
      include "evidence-contracts"; e0_current_health($now)
    ' "$health" >/dev/null || fail "current health contract is invalid or stale"
    proof="$output/bridge-proof.json"
    proof_from_health "$health" "$bridge_source" "$bridge_image" true "$proof"
    serving_from_health "$health" "$output/serving-builds.json"
    bridge_created="$(jq -er '.services[]|select(.service=="api-web")
      | .rawEvidence.describeExpressGatewayService.raw.second.service.activeConfigurations[0].createdAt
      | select(type=="string" and length>0)' "$health")"
    quiesce_start="$(BRIDGE_CREATED="$bridge_created" node -e '
      const value = Date.parse(process.env.BRIDGE_CREATED || "");
      if (!Number.isFinite(value) || value % 1000 !== 0) process.exit(1);
      process.stdout.write(String(value / 1000));
    ')" || fail "bridge revision creation time is invalid"
    now="$(date -u +%s)"
    [ "$quiesce_start" -le "$now" ] && [ $((now-quiesce_start)) -le 1800 ] \
      || fail "bridge quiesce is already outside the 30-minute U5 window"
    jq -cnS --arg finalSource "$final_source" --arg finalImage "$final_image" \
      --slurpfile bridge "$proof" --argjson started "$quiesce_start" '
      {status:"BRIDGE_ONLY_QUIESCED",acceptedFinalSourceCommit:$finalSource,
       acceptedFinalApiImage:$finalImage,bridgeProof:$bridge[0],finalQuiescedProof:null,
       finalUnquiescedProof:null,quiesceStartedAtEpoch:$started,quiesceEndedAtEpoch:null,
       durationSeconds:null,blockedMutations:{status:"NOT_AVAILABLE",count:null},
       reimbursementInvariantHash:null,allActiveTasksGuarded:true,
       allPreBridgeTasksRetired:true,allBridgeTasksRetired:null,
       sameFinalImageAcrossUnquiesce:null,failurePolicy:"LEAVE_QUIESCED"}
    ' > "$output/reimbursement-quiesce.json"
    rm -f -- "$proof"
    jq -e -L "$library" --arg source "$final_source" '
      include "evidence-contracts"; e0_serving_builds("PRE_MUTATION";$source)
    ' "$output/serving-builds.json" >/dev/null
    jq -e -L "$library" --arg source "$final_source" '
      include "evidence-contracts"; e0_reimbursement_quiesce("PRE_MUTATION";$source)
    ' "$output/reimbursement-quiesce.json" >/dev/null
    ;;
  post-migration)
    [ "$#" -eq 4 ] || fail "usage: post-migration <health.json> <pre-quiesce.json> <invariant-hash> <empty-output-dir>"
    health="$1"; previous="$2"; invariant="$3"; output="$4"
    regular_json "$health" health; regular_json "$previous" PRE-quiesce; sha64 "$invariant" || fail "invariant hash is invalid"
    empty_dir "$output"
    final_source="$(jq -er '.acceptedFinalSourceCommit' "$previous")"
    bridge_source="$(jq -er '.bridgeProof.sourceCommit' "$previous")"
    bridge_image="$(jq -er '.bridgeProof.image' "$previous")"
    proof="$output/current-bridge-proof.json"
    proof_from_health "$health" "$bridge_source" "$bridge_image" true "$proof"
    cmp -s "$proof" <(jq -cS '.bridgeProof' "$previous") \
      || fail "live bridge proof moved after PRE"
    serving_from_health "$health" "$output/serving-builds.json"
    jq -cS --arg invariant "$invariant" '
      .status="BRIDGE_ONLY_QUIESCED_POST_MIGRATION"
      | .reimbursementInvariantHash=$invariant
    ' "$previous" > "$output/reimbursement-quiesce.json"
    rm -f -- "$proof"
    jq -e -L "$library" --arg source "$final_source" '
      include "evidence-contracts";
      e0_serving_builds("POST_MIGRATION";$source)
    ' "$output/serving-builds.json" >/dev/null
    jq -e -L "$library" --arg source "$final_source" '
      include "evidence-contracts";
      e0_reimbursement_quiesce("POST_MIGRATION";$source)
    ' "$output/reimbursement-quiesce.json" >/dev/null
    ;;
  final-quiesced)
    [ "$#" -eq 5 ] || fail "usage: final-quiesced <health.json> <post-quiesce.json> <final-source> <final-image> <output-state.json>"
    health="$1"; previous="$2"; final_source="$3"; final_image="$4"; state="$5"
    regular_json "$health" health; regular_json "$previous" POST-quiesce
    full_sha "$final_source" && api_image "$final_image" || fail "final identity is invalid"
    [ ! -e "$state" ] || fail "final-quiesced state already exists"
    proof="${state}.proof"
    proof_from_health "$health" "$final_source" "$final_image" true "$proof"
    jq -e --slurpfile final "$proof" '
      ([.bridgeProof.activeTaskArns[], $final[0].activeTaskArns[]] | length)
        == ([.bridgeProof.activeTaskArns[], $final[0].activeTaskArns[]] | unique | length)
    ' "$previous" >/dev/null || fail "a bridge task is still active after final quiesced rollout"
    jq -cnS --slurpfile previous "$previous" --slurpfile proof "$proof" \
      '{schemaVersion:1,postMigrationQuiesce:$previous[0],finalQuiescedProof:$proof[0]}' > "$state"
    rm -f -- "$proof"
    ;;
  post-deployment)
    [ "$#" -eq 3 ] || fail "usage: post-deployment <health.json> <final-quiesced-state.json> <empty-output-dir>"
    health="$1"; state="$2"; output="$3"
    regular_json "$health" health; regular_json "$state" final-quiesced-state; empty_dir "$output"
    final_source="$(jq -er '.postMigrationQuiesce.acceptedFinalSourceCommit' "$state")"
    final_image="$(jq -er '.postMigrationQuiesce.acceptedFinalApiImage' "$state")"
    proof="$output/final-unquiesced-proof.json"
    proof_from_health "$health" "$final_source" "$final_image" false "$proof"
    jq -e --slurpfile current "$proof" '
      .finalQuiescedProof.sourceCommit==$current[0].sourceCommit
      and .finalQuiescedProof.image==$current[0].image
      and .finalQuiescedProof.serviceRevisionArn!=$current[0].serviceRevisionArn
      and ([.finalQuiescedProof.activeTaskArns[], $current[0].activeTaskArns[]] | length)
        == ([.finalQuiescedProof.activeTaskArns[], $current[0].activeTaskArns[]] | unique | length)
    ' "$state" >/dev/null || fail "unquiesce did not replace the exact final-quiesced revision"
    serving_from_health "$health" "$output/serving-builds.json"
    ended="$(date -u +%s)"
    jq -cS --slurpfile state "$state" --slurpfile current "$proof" --argjson ended "$ended" '
      $state[0].postMigrationQuiesce
      | .status="FINAL_ONLY_UNQUIESCED"
      | .finalQuiescedProof=$state[0].finalQuiescedProof
      | .finalUnquiescedProof=$current[0]
      | .quiesceEndedAtEpoch=$ended
      | .durationSeconds=($ended-.quiesceStartedAtEpoch)
      | .allBridgeTasksRetired=true
      | .sameFinalImageAcrossUnquiesce=true
    ' > "$output/reimbursement-quiesce.json"
    rm -f -- "$proof"
    jq -e -L "$library" --arg source "$final_source" '
      include "evidence-contracts";
      e0_serving_builds("POST_DEPLOYMENT";$source)
    ' "$output/serving-builds.json" >/dev/null || fail "not every service serves the exact final source"
    jq -e -L "$library" --arg source "$final_source" '
      include "evidence-contracts";
      e0_reimbursement_quiesce("POST_DEPLOYMENT";$source)
    ' "$output/reimbursement-quiesce.json" >/dev/null || fail "final quiesce contract is invalid"
    ;;
  *) fail "mode must be pre, post-migration, final-quiesced or post-deployment" ;;
esac
