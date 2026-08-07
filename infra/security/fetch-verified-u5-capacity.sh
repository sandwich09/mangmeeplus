#!/usr/bin/env bash
set -euo pipefail

capacity_fetch_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
# shellcheck source=infra/security/signed-evidence.sh
source "$capacity_fetch_root/infra/security/signed-evidence.sh"

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 <capacity-run-id> <expected-source-sha> <empty-output-dir>" >&2
  exit 2
fi

run_id="$1"
expected_source="$2"
output_dir="$3"
[[ "$run_id" =~ ^[1-9][0-9]*$ && "$expected_source" =~ ^[0-9a-f]{40}$ ]] \
  || { echo 'ERROR: malformed U5-C run/source binding' >&2; exit 1; }
test -n "${GITHUB_REPOSITORY:-}" && test -n "${GITHUB_WORKSPACE:-}" && test -n "${GH_TOKEN:-}"
if [ -e "$output_dir" ]; then
  [ -d "$output_dir" ] && [ ! -L "$output_dir" ] \
    && [ -z "$(find "$output_dir" -mindepth 1 -maxdepth 1 -print -quit)" ] \
    || { echo 'ERROR: U5-C output directory must be empty and non-linked' >&2; exit 1; }
else
  mkdir -m 700 "$output_dir"
fi

run_json="$output_dir/run.json"
artifacts_json="$output_dir/artifacts.json"
archive="$output_dir/artifact.zip"
gh api "repos/$GITHUB_REPOSITORY/actions/runs/$run_id" > "$run_json"
jq -e --arg repository "$GITHUB_REPOSITORY" --arg run "$run_id" --arg source "$expected_source" '
  (.id|tostring) == $run and .run_attempt >= 1
  and .status == "completed" and .conclusion == "success"
  and .event == "workflow_dispatch" and .path == ".github/workflows/a5-capacity-uat.yml"
  and .head_branch == "main" and .head_sha == $source
  and .repository.full_name == $repository
  and .actor.login == "MangmeeDev" and .triggering_actor.login == "MangmeeDev"
' "$run_json" >/dev/null
run_attempt="$(jq -er '.run_attempt|select(type=="number" and .>=1 and floor==.)' "$run_json")"
artifact_name="u5-capacity-result-${run_id}-${run_attempt}"
raw_name="u5-capacity-raw-${run_id}-${run_attempt}"
gh api "repos/$GITHUB_REPOSITORY/actions/runs/$run_id/artifacts?per_page=100" > "$artifacts_json"
jq -e --arg result "$artifact_name" --arg raw "$raw_name" --argjson run "$run_id" \
  --arg source "$expected_source" '
    .total_count == 2 and (.artifacts|length) == 2
    and ([.artifacts[].name]|sort) == ([$raw,$result]|sort)
    and all(.artifacts[]; .expired == false and .workflow_run.id == $run
      and .workflow_run.head_sha == $source)
  ' "$artifacts_json" >/dev/null || {
  echo 'ERROR: U5-C producer artifact set is not the exact result plus diagnostics pair' >&2
  exit 1
}
artifact_id="$(jq -er --arg name "$artifact_name" \
  '.artifacts[]|select(.name==$name)|.id|select(type=="number" and .>=1 and floor==.)' \
  "$artifacts_json")"
gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$artifact_id/zip" > "$archive"

archive_hash="$(_signed_evidence_sha256_file "$archive")"
archive_size="$(_signed_evidence_file_size "$archive")"
artifact_digest="$(jq -er --arg name "$artifact_name" \
  '.artifacts[]|select(.name==$name)|.digest|select(test("^sha256:[0-9a-f]{64}$"))' \
  "$artifacts_json")"
jq -e --arg name "$artifact_name" --arg digest "$artifact_digest" \
  --arg hash "$archive_hash" --argjson size "$archive_size" '
    [.artifacts[]|select(.name==$name)] as $matches
    | ($matches|length)==1 and $matches[0].digest==$digest
      and $digest==("sha256:"+$hash) and $matches[0].size_in_bytes==$size
  ' "$artifacts_json" >/dev/null

extracted="$(signed_evidence_extract_zip "$archive")"
trap 'rm -rf "$extracted"' EXIT
evidence="$extracted/evidence.json"
bundle="$extracted/evidence.bundle"
workflow_sha="$(jq -er '.head_sha|select(test("^[0-9a-f]{40}$"))' "$run_json")"
raw_marker="$(jq -er '.source.marker|select(test("^U5C-[0-9A-F]{12,32}$"))' "$evidence")"
release_image="$(jq -er '.source.releaseImage' "$evidence")"
manifest="$output_dir/workload.tsv"
bash "$GITHUB_WORKSPACE/infra/uat/build-u5-capacity-workload-manifest.sh" \
  "$expected_source" "$manifest"
manifest_hash="$(_signed_evidence_sha256_file "$manifest")"

cosign verify-blob --bundle "$bundle" \
  --certificate-identity \
    "https://github.com/${GITHUB_REPOSITORY}/.github/workflows/a5-capacity-uat.yml@refs/heads/main" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-github-workflow-repository "$GITHUB_REPOSITORY" \
  --certificate-github-workflow-ref refs/heads/main \
  --certificate-github-workflow-sha "$workflow_sha" \
  --certificate-github-workflow-trigger workflow_dispatch "$evidence" >/dev/null
bash "$GITHUB_WORKSPACE/infra/uat/validate-u5-capacity-result.sh" "$evidence" \
  "$expected_source" "$release_image" "$raw_marker" "$manifest_hash" "$workflow_sha" \
  "$run_id" "$run_attempt" "$(jq -er '.actor.login' "$run_json")" \
  "$(jq -er '.triggering_actor.login' "$run_json")" >/dev/null

content_hash="$(_signed_evidence_sha256_file "$evidence")"
jq -cnS --arg run "$run_id" --argjson attempt "$run_attempt" --arg name "$artifact_name" \
  --arg content "$content_hash" --arg digest "$artifact_digest" '
    {artifactKind:"U5_CAPACITY_RESULT_V1",producerRunId:$run,producerRunAttempt:$attempt,
     artifactName:$name,contentSha256:$content,artifactDigest:$digest}
  ' > "$output_dir/ref.json"
cp "$evidence" "$output_dir/evidence.json"
cp "$bundle" "$output_dir/evidence.bundle"
chmod 600 "$output_dir/evidence.json" "$output_dir/evidence.bundle" "$output_dir/ref.json"
printf '%s\n' "$artifact_name"
