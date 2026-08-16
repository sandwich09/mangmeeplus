#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd -P)"
work="$(mktemp -d "${TMPDIR:-/tmp}/line-ai-release-manifest.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
source_sha="$(printf a%.0s {1..40})"
mkdir -p "$work/agentcore"
printf 'immutable-agentcore-bytes' > "$work/agentcore/agentcore.zip"
artifact_sha="$(sha256sum "$work/agentcore/agentcore.zip" | awk '{print $1}')"
jq -cnS --arg source "$source_sha" --arg sha "$artifact_sha" \
  '{schemaVersion:1,sourceCommit:$source,artifact:"agentcore.zip",sha256:$sha}' \
  > "$work/agentcore/agentcore-artifact.json"

jq -cnS --arg source "$source_sha" '
  {schemaVersion:1,sourceCommit:$source,workflowRunId:"42",validationRunId:"41",images:[
    {service:"api-web",repository:"watchdog-bms-api",image:("registry/api@sha256:"+("1"*64)),digest:("sha256:"+("1"*64)),sourceCommit:$source,sbom:"sbom-api-web.spdx.json"},
    {service:"ai-gateway",repository:"watchdog-bms-ai-gateway",image:("registry/ai@sha256:"+("2"*64)),digest:("sha256:"+("2"*64)),sourceCommit:$source,sbom:"sbom-ai-gateway.spdx.json"},
    {service:"workers",repository:"watchdog-bms-workers",image:("registry/workers@sha256:"+("3"*64)),digest:("sha256:"+("3"*64)),sourceCommit:$source,sbom:"sbom-workers.spdx.json"}
  ]}' > "$work/production-image-manifest.json"
cp "$root/packages/contracts/src/line-ai.ts" "$work/line-ai.ts"

bash "$root/infra/ai-gateway/build-line-ai-release-manifest.sh" \
  "$work/line-ai-release-manifest.json" "$work/production-image-manifest.json" \
  "$work/agentcore" "$work/line-ai.ts" 42 41
test "$(bash "$root/infra/ai-gateway/validate-line-ai-release-manifest.sh" \
  "$work/line-ai-release-manifest.json" "$work/production-image-manifest.json" \
  "$work/agentcore" "$work/line-ai.ts" "$source_sha")" = "$source_sha"

reject() {
  local name="$1" filter="$2"
  jq "$filter" "$work/line-ai-release-manifest.json" > "$work/$name.json"
  if bash "$root/infra/ai-gateway/validate-line-ai-release-manifest.sh" \
    "$work/$name.json" "$work/production-image-manifest.json" "$work/agentcore" \
    "$work/line-ai.ts" "$source_sha" >/dev/null 2>&1; then
    echo "ERROR: validator accepted $name" >&2
    exit 1
  fi
}

reject split-source '.agentCore.sourceCommit=("e"*40)'
reject rebuilt-agentcore '.agentCore.artifactSha256=("f"*64)'
reject split-image '.imageManifest.images[0].sourceCommit=("e"*40)'
reject changed-contract '.contract.sha256=("f"*64)'
reject default-binding '.bindingStrategy="mutable_default"'
reject extra-field '.unexpected="accepted"'

printf 'tamper' >> "$work/agentcore/agentcore.zip"
if bash "$root/infra/ai-gateway/validate-line-ai-release-manifest.sh" \
  "$work/line-ai-release-manifest.json" "$work/production-image-manifest.json" \
  "$work/agentcore" "$work/line-ai.ts" "$source_sha" >/dev/null 2>&1; then
  echo 'ERROR: validator accepted changed AgentCore bytes' >&2
  exit 1
fi

echo 'line AI release manifest specs passed'
