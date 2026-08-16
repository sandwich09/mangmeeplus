#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 5 ]; then
  echo "Usage: $0 <line-ai-manifest.json> <production-image-manifest.json> <agentcore-dir> <line-ai-contract.ts> <expected-source-sha>" >&2
  exit 2
fi

manifest="$1"
image_manifest="$2"
agentcore_dir="$3"
contract_file="$4"
expected_source="$5"
artifact_manifest="$agentcore_dir/agentcore-artifact.json"
artifact="$agentcore_dir/agentcore.zip"

for file in "$manifest" "$image_manifest" "$artifact_manifest" "$artifact" "$contract_file"; do
  [ -f "$file" ] || { echo "ERROR: required release evidence is absent: $file" >&2; exit 1; }
done
[[ "$expected_source" =~ ^[0-9a-f]{40}$ ]]

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

image_manifest_sha="$(sha256_file "$image_manifest")"
artifact_sha="$(sha256_file "$artifact")"
contract_sha="$(sha256_file "$contract_file")"

jq -e \
  --arg source "$expected_source" \
  --arg imageManifestSha "$image_manifest_sha" \
  --arg artifactSha "$artifact_sha" \
  --arg contractSha "$contract_sha" \
  --slurpfile images "$image_manifest" \
  --slurpfile artifactManifest "$artifact_manifest" '
  def exact($expected): (keys | sort) == ($expected | sort);
  exact(["agentCore","artifactKind","bindingStrategy","contract","imageManifest","producerRunId",
    "schemaVersion","sourceCommit","validationRunId"])
  and .schemaVersion == 1
  and .artifactKind == "LINE_AI_RELEASE_CANDIDATE"
  and .sourceCommit == $source
  and (.producerRunId | test("^[0-9]+$"))
  and (.validationRunId == "" or (.validationRunId | test("^[0-9]+$")))
  and .bindingStrategy == "isolated_runtime_pinned_endpoint"
  and (.imageManifest | exact(["images","path","sha256"]))
  and .imageManifest.path == "production-image-manifest.json"
  and .imageManifest.sha256 == $imageManifestSha
  and .imageManifest.images == ($images[0].images
    | map({service,repository,image,digest,sourceCommit}) | sort_by(.service))
  and all(.imageManifest.images[]; .sourceCommit == $source)
  and (.agentCore | exact(["artifactManifestPath","artifactPath","artifactSha256","sourceCommit"]))
  and .agentCore.artifactPath == "agentcore/agentcore.zip"
  and .agentCore.artifactManifestPath == "agentcore/agentcore-artifact.json"
  and .agentCore.sourceCommit == $source
  and .agentCore.artifactSha256 == $artifactSha
  and $artifactManifest[0] == {
    schemaVersion: 1, sourceCommit: $source, artifact: "agentcore.zip", sha256: $artifactSha
  }
  and (.contract | exact(["path","runtimeContractVersion","sha256"]))
  and .contract.path == "line-ai-contract.ts"
  and .contract.sha256 == $contractSha
  and .contract.runtimeContractVersion == 1
' "$manifest" >/dev/null

printf '%s\n' "$expected_source"
