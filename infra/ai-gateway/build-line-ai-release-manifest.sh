#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 5 ] || [ "$#" -gt 6 ]; then
  echo "Usage: $0 <output.json> <production-image-manifest.json> <agentcore-dir> <line-ai-contract.ts> <producer-run-id> [validation-run-id]" >&2
  exit 2
fi

output="$1"
image_manifest="$2"
agentcore_dir="$3"
contract_file="$4"
producer_run_id="$5"
validation_run_id="${6:-}"
artifact_manifest="$agentcore_dir/agentcore-artifact.json"
artifact="$agentcore_dir/agentcore.zip"

[ ! -e "$output" ]
for file in "$image_manifest" "$artifact_manifest" "$artifact" "$contract_file"; do
  [ -f "$file" ] || { echo "ERROR: required release input is absent: $file" >&2; exit 1; }
done
[[ "$producer_run_id" =~ ^[0-9]+$ ]]
[[ -z "$validation_run_id" || "$validation_run_id" =~ ^[0-9]+$ ]]

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

source_commit="$(jq -er '.sourceCommit|select(test("^[0-9a-f]{40}$"))' "$image_manifest")"
test "$(jq -er '.sourceCommit' "$artifact_manifest")" = "$source_commit"
test "$(jq -er '.artifact' "$artifact_manifest")" = agentcore.zip
artifact_sha="$(sha256_file "$artifact")"
test "$(jq -er '.sha256' "$artifact_manifest")" = "$artifact_sha"
contract_sha="$(sha256_file "$contract_file")"
image_manifest_sha="$(sha256_file "$image_manifest")"

jq -cS -n \
  --arg source "$source_commit" \
  --arg producer "$producer_run_id" \
  --arg validation "$validation_run_id" \
  --arg imageManifestSha "$image_manifest_sha" \
  --arg artifactSha "$artifact_sha" \
  --arg contractSha "$contract_sha" \
  --slurpfile images "$image_manifest" '
  {
    schemaVersion: 1,
    artifactKind: "LINE_AI_RELEASE_CANDIDATE",
    sourceCommit: $source,
    producerRunId: $producer,
    validationRunId: $validation,
    bindingStrategy: "isolated_runtime_pinned_endpoint",
    imageManifest: {
      path: "production-image-manifest.json",
      sha256: $imageManifestSha,
      images: ($images[0].images | map({service,repository,image,digest,sourceCommit}) | sort_by(.service))
    },
    agentCore: {
      artifactPath: "agentcore/agentcore.zip",
      artifactManifestPath: "agentcore/agentcore-artifact.json",
      artifactSha256: $artifactSha,
      sourceCommit: $source
    },
    contract: {
      path: "line-ai-contract.ts",
      sha256: $contractSha,
      runtimeContractVersion: 1
    }
  }
' > "$output"
