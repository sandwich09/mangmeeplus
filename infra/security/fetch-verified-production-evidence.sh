#!/usr/bin/env bash
set -euo pipefail

fetch_evidence_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
# shellcheck source=infra/security/signed-evidence.sh
source "$fetch_evidence_root/infra/security/signed-evidence.sh"

if [ "$#" -ne 5 ]; then
  echo "Usage: $0 <kind> <producer-run-id> <parent-production-run-id> <expected-stage> <empty-output-dir>" >&2
  exit 2
fi

kind="$1"
producer_run_id="$2"
parent_run_id="$3"
expected_stage="$4"
output_dir="$5"

case "$kind" in
  PRODUCTION_A5_EVIDENCE_V1) workflow=.github/workflows/production-a5.yml ;;
  PRODUCTION_A5_CLONE_REHEARSAL_V1) workflow=.github/workflows/production-a5-clone.yml ;;
  PRODUCTION_SECURITY_PREFLIGHT_V1) workflow=.github/workflows/production-security-preflight.yml ;;
  U5_SHADOW_AGGREGATE_V1) workflow=.github/workflows/u5-shadow-evidence.yml ;;
  OWNER_U5E_APPROVAL_V1) workflow=.github/workflows/u5-owner-approval.yml ;;
  *) echo "ERROR: unsupported H1 evidence kind" >&2; exit 1 ;;
esac
[[ "$producer_run_id" =~ ^[1-9][0-9]*$ && "$parent_run_id" =~ ^[1-9][0-9]*$ ]] \
  || { echo "ERROR: evidence run IDs must be positive decimal strings" >&2; exit 1; }
test "$producer_run_id" != "$parent_run_id"
test -n "${GITHUB_REPOSITORY:-}" && test -n "${GITHUB_WORKSPACE:-}" && test -n "${GH_TOKEN:-}"
if [ -e "$output_dir" ]; then
  [ -d "$output_dir" ] && [ ! -L "$output_dir" ] \
    && [ -z "$(find "$output_dir" -mindepth 1 -maxdepth 1 -print -quit)" ] \
    || { echo "ERROR: evidence output directory must be an empty non-link directory" >&2; exit 1; }
else
  mkdir -m 700 "$output_dir"
fi

parent_json="$output_dir/parent-run.json"
producer_json="$output_dir/producer-run.json"
all_artifacts="$output_dir/all-artifacts.json"
artifact_json="$output_dir/artifact.json"
archive="$output_dir/artifact.zip"
expected="$output_dir/expected.json"
reference="$output_dir/ref.json"

gh api "repos/$GITHUB_REPOSITORY/actions/runs/$parent_run_id" > "$parent_json"
gh api "repos/$GITHUB_REPOSITORY/actions/runs/$producer_run_id" > "$producer_json"
jq -e --arg repository "$GITHUB_REPOSITORY" --arg run "$parent_run_id" '
  (.id|tostring) == $run and .status == "in_progress" and .conclusion == null
  and .event == "workflow_dispatch" and .path == ".github/workflows/deploy-production.yml"
  and .head_branch == "main" and .repository.full_name == $repository
' "$parent_json" >/dev/null
jq -e --arg repository "$GITHUB_REPOSITORY" --arg run "$producer_run_id" --arg workflow "$workflow" '
  (.id|tostring) == $run and .status == "completed" and .conclusion == "success"
  and .event == "workflow_dispatch" and .path == $workflow
  and .head_branch == "main" and .repository.full_name == $repository
' "$producer_json" >/dev/null

parent_attempt="$(jq -er '.run_attempt|select(type=="number" and .>=1 and floor==.)' "$parent_json")"
producer_attempt="$(jq -er '.run_attempt|select(type=="number" and .>=1 and floor==.)' "$producer_json")"
source_sha="$(jq -er '.head_sha|select(test("^[0-9a-f]{40}$"))' "$parent_json")"
parent_controller="$source_sha"
producer_controller="$(jq -er '.head_sha|select(test("^[0-9a-f]{40}$"))' "$producer_json")"
test "$producer_controller" = "$source_sha" || {
  echo "ERROR: producer and waiting production controller are not the exact same protected-main commit" >&2
  exit 1
}
artifact_name="${kind}-${source_sha}-production-${parent_run_id}-attempt-${parent_attempt}-producer-${producer_run_id}-attempt-${producer_attempt}"

gh api "repos/$GITHUB_REPOSITORY/actions/runs/$producer_run_id/artifacts?per_page=100" > "$all_artifacts"
jq -e --arg name "$artifact_name" '
  .total_count == (.artifacts|length)
  and ([.artifacts[]|select(.name == $name and .expired == false)]|length) == 1
  and ([.artifacts[]|select(.name != $name)]|length) == 0
' "$all_artifacts" >/dev/null || {
  echo "ERROR: producer artifact set is not the one exact attempt-bound evidence artifact" >&2
  exit 1
}
gh api -X GET "repos/$GITHUB_REPOSITORY/actions/runs/$producer_run_id/artifacts" \
  -f name="$artifact_name" -f per_page=100 > "$artifact_json"
artifact_id="$(jq -er '.artifacts[0].id|select(type=="number" and .>=1 and floor==.)' "$artifact_json")"
gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$artifact_id/zip" > "$archive"

producer_blob="$(git -C "$GITHUB_WORKSPACE" rev-parse "$producer_controller:$workflow")"
parent_blob="$(git -C "$GITHUB_WORKSPACE" rev-parse "$parent_controller:.github/workflows/deploy-production.yml")"
jq -cnS --arg kind "$kind" --arg repository "$GITHUB_REPOSITORY" --arg source "$source_sha" \
  --arg workflow "$workflow" --arg producerController "$producer_controller" \
  --arg producerBlob "$producer_blob" --arg producerRun "$producer_run_id" \
  --argjson producerAttempt "$producer_attempt" \
  --arg actor "$(jq -er '.actor.login' "$producer_json")" \
  --arg triggeringActor "$(jq -er '.triggering_actor.login' "$producer_json")" \
  --argjson producerStarted "$(jq -er '.run_started_at|fromdateiso8601' "$producer_json")" \
  --arg parentController "$parent_controller" --arg parentBlob "$parent_blob" \
  --arg parentRun "$parent_run_id" --argjson parentAttempt "$parent_attempt" \
  --argjson parentStarted "$(jq -er '.run_started_at|fromdateiso8601' "$parent_json")" '
    {artifactKind:$kind,repository:$repository,environment:"production",sourceCommit:$source,
     producer:{workflowPath:$workflow,controllerCommit:$producerController,workflowBlob:$producerBlob,
       runId:$producerRun,runAttempt:$producerAttempt,actor:$actor,
       triggeringActor:$triggeringActor,startedAtEpoch:$producerStarted},
     parentProductionRun:{controllerCommit:$parentController,workflowBlob:$parentBlob,
       runId:$parentRun,runAttempt:$parentAttempt,startedAtEpoch:$parentStarted},
     lifetimeSeconds:(if ($kind == "PRODUCTION_SECURITY_PREFLIGHT_V1"
       or $kind == "PRODUCTION_A5_CLONE_REHEARSAL_V1") then 7200
       elif $kind == "OWNER_U5E_APPROVAL_V1" then 1800 else 3600 end)}
  ' > "$expected"

extracted="$(signed_evidence_extract_zip "$archive")"
trap 'rm -rf "$extracted"' EXIT
content="$(jq -er '.contentSha256|select(test("^[0-9a-f]{64}$"))' "$extracted/evidence.json")"
digest="$(jq -er '.artifacts[0].digest|select(test("^sha256:[0-9a-f]{64}$"))' "$artifact_json")"
jq -cnS --arg kind "$kind" --arg run "$producer_run_id" --argjson attempt "$producer_attempt" \
  --arg name "$artifact_name" --arg content "$content" --arg digest "$digest" '
    {artifactKind:$kind,producerRunId:$run,producerRunAttempt:$attempt,
     artifactName:$name,contentSha256:$content,artifactDigest:$digest}
  ' > "$reference"
signed_evidence_verify_artifact "$archive" "$artifact_json" "$producer_json" "$parent_json" \
  "$expected" "$reference" "$GITHUB_WORKSPACE" "$(date -u +%s)"

case "$kind" in
  PRODUCTION_A5_EVIDENCE_V1)
    jq -e --arg stage "$expected_stage" '.payload.stage == $stage and .payload.passed == true' \
      "$extracted/evidence.json" >/dev/null ;;
  PRODUCTION_A5_CLONE_REHEARSAL_V1)
    test "$expected_stage" = CLONE
    jq -e '.payload.passed == true' "$extracted/evidence.json" >/dev/null ;;
  PRODUCTION_SECURITY_PREFLIGHT_V1)
    test "$expected_stage" = PRE_MUTATION
    jq -e '.payload.passed == true' "$extracted/evidence.json" >/dev/null ;;
  U5_SHADOW_AGGREGATE_V1)
    jq -e --arg stage "$expected_stage" \
      '.payload.stage == $stage and .payload.shadowOnlyReady == true' "$extracted/evidence.json" >/dev/null ;;
  OWNER_U5E_APPROVAL_V1) test "$expected_stage" = APPROVAL ;;
esac
cp "$extracted/evidence.json" "$output_dir/evidence.json"
cp "$extracted/evidence.bundle" "$output_dir/evidence.bundle"
chmod 600 "$output_dir/evidence.json" "$output_dir/evidence.bundle"
printf '%s\n' "$artifact_name"
