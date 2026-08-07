#!/usr/bin/env bash
set -euo pipefail

uat_fetch_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
# shellcheck source=infra/security/validate-production-security-preflight.sh
source "$uat_fetch_root/infra/security/validate-production-security-preflight.sh"

if [ "$#" -lt 3 ] || [ "$#" -gt 4 ]; then
  echo "Usage: $0 <uat-run-id> <parent-production-run-id> <empty-output-dir> [expected-source-sha]" >&2
  exit 2
fi
uat_run_id="$1"
parent_run_id="$2"
output_dir="$3"
expected_source_sha="${4:-}"
[[ "$uat_run_id" =~ ^[1-9][0-9]*$ && "$parent_run_id" =~ ^[1-9][0-9]*$ ]] \
  || { echo "ERROR: UAT/parent run IDs must be positive decimal strings" >&2; exit 1; }
test -n "${GITHUB_REPOSITORY:-}" && test -n "${GITHUB_WORKSPACE:-}" && test -n "${GH_TOKEN:-}"
if [ -n "$expected_source_sha" ] && [[ ! "$expected_source_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "ERROR: explicit UAT source must be one lowercase full SHA" >&2
  exit 1
fi
if [ -e "$output_dir" ]; then
  [ -d "$output_dir" ] && [ ! -L "$output_dir" ] \
    && [ -z "$(find "$output_dir" -mindepth 1 -maxdepth 1 -print -quit)" ] \
    || { echo "ERROR: UAT output directory must be empty and non-linked" >&2; exit 1; }
else
  mkdir -m 700 "$output_dir"
fi

parent_json="$output_dir/parent-run.json"
uat_json="$output_dir/uat-run.json"
gh api "repos/$GITHUB_REPOSITORY/actions/runs/$parent_run_id" > "$parent_json"
gh api "repos/$GITHUB_REPOSITORY/actions/runs/$uat_run_id" > "$uat_json"
jq -e --arg repository "$GITHUB_REPOSITORY" --arg run "$parent_run_id" '
  (.id|tostring) == $run and .status == "in_progress" and .conclusion == null
  and .event == "workflow_dispatch" and .path == ".github/workflows/deploy-production.yml"
  and .head_branch == "main" and .repository.full_name == $repository
' "$parent_json" >/dev/null
jq -e --arg repository "$GITHUB_REPOSITORY" --arg run "$uat_run_id" '
  (.id|tostring) == $run and .status == "completed" and .conclusion == "success"
  and .event == "workflow_dispatch" and .path == ".github/workflows/deploy-uat.yml"
  and .head_branch == "main" and .repository.full_name == $repository
' "$uat_json" >/dev/null

source_sha="$expected_source_sha"
if [ -z "$source_sha" ]; then
  source_sha="$(jq -er '.head_sha|select(test("^[0-9a-f]{40}$"))' "$parent_json")"
else
  git -C "$GITHUB_WORKSPACE" cat-file -e "${source_sha}^{commit}"
  git -C "$GITHUB_WORKSPACE" merge-base --is-ancestor "$source_sha" refs/heads/main
fi
uat_controller="$(jq -er '.head_sha|select(test("^[0-9a-f]{40}$"))' "$uat_json")"
uat_attempt="$(jq -er '.run_attempt|select(type=="number" and .>=1 and floor==.)' "$uat_json")"
acceptance_name="uat-deployment-acceptance-${source_sha}-attempt-${uat_attempt}"
release_name="uat-accepted-release-${source_sha}-attempt-${uat_attempt}"

for profile in acceptance release; do
  name="$acceptance_name"
  [ "$profile" = release ] && name="$release_name"
  metadata="$output_dir/${profile}-artifacts.json"
  archive="$output_dir/${profile}.zip"
  gh api -X GET "repos/$GITHUB_REPOSITORY/actions/runs/$uat_run_id/artifacts" \
    -f name="$name" -f per_page=100 > "$metadata"
  artifact_id="$(jq -er '.artifacts[0].id|select(type=="number" and .>=1 and floor==.)' "$metadata")"
  gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$artifact_id/zip" > "$archive"
  security_preflight_validate_artifact_metadata "$metadata" "$archive" "$name" \
    "$uat_run_id" "$uat_controller" >/dev/null
  extracted="$(security_preflight_extract_artifact "$profile" "$archive")"
  cp -R "$extracted/." "$output_dir/$profile"
  rm -rf "$extracted"
done

ci_blob="$(git -C "$GITHUB_WORKSPACE" rev-parse "$uat_controller:.github/workflows/ci.yml")"
uat_blob="$(git -C "$GITHUB_WORKSPACE" rev-parse "$uat_controller:.github/workflows/deploy-uat.yml")"
validator_hash="$(_signed_evidence_sha256_file "$GITHUB_WORKSPACE/infra/docker/validate-uat-deployment-acceptance.sh")"
cosign verify-blob \
  --bundle "$output_dir/acceptance/uat-deployment-acceptance.bundle" \
  --certificate-identity "https://github.com/${GITHUB_REPOSITORY}/.github/workflows/deploy-uat.yml@refs/heads/main" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-github-workflow-repository "$GITHUB_REPOSITORY" \
  --certificate-github-workflow-ref refs/heads/main \
  --certificate-github-workflow-sha "$uat_controller" \
  --certificate-github-workflow-trigger workflow_dispatch \
  "$output_dir/acceptance/uat-deployment-acceptance.json" >/dev/null
bash "$GITHUB_WORKSPACE/infra/docker/validate-uat-deployment-acceptance.sh" \
  "$output_dir/acceptance/uat-deployment-acceptance.json" \
  "$output_dir/release/production-image-manifest.json" "$source_sha" "$uat_run_id" \
  "$uat_attempt" "$uat_controller" "$GITHUB_REPOSITORY" "$ci_blob" "$uat_blob" \
  "$validator_hash" "$(date -u +%s)"

acceptance_digest="$(jq -er '.artifacts[0].digest|select(test("^sha256:[0-9a-f]{64}$"))' \
  "$output_dir/acceptance-artifacts.json")"
jq -cnS --arg run "$uat_run_id" --argjson attempt "$uat_attempt" --arg name "$acceptance_name" \
  --arg content "$(jq -er '.contentSha256|select(test("^[0-9a-f]{64}$"))' \
    "$output_dir/acceptance/uat-deployment-acceptance.json")" --arg digest "$acceptance_digest" '
  {artifactKind:"UAT_DEPLOYMENT_ACCEPTANCE",producerRunId:$run,producerRunAttempt:$attempt,
   artifactName:$name,contentSha256:$content,artifactDigest:$digest}
' > "$output_dir/uat-ref.json"
printf '%s\n' "$source_sha"
