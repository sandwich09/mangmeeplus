#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd -P)"
work="$(mktemp -d "${TMPDIR:-/tmp}/agentcore-binding.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
source_sha="$(printf a%.0s {1..40})"
artifact_sha="$(printf b%.0s {1..64})"
jq -cnS --arg source "$source_sha" --arg artifact "$artifact_sha" '
  {schemaVersion:1,artifactKind:"LINE_AI_RELEASE_CANDIDATE",sourceCommit:$source,
   producerRunId:"42",validationRunId:"41",bindingStrategy:"isolated_runtime_pinned_endpoint",
   imageManifest:{path:"production-image-manifest.json",sha256:("c"*64),images:[]},
   agentCore:{artifactPath:"agentcore/agentcore.zip",artifactManifestPath:"agentcore/agentcore-artifact.json",
     artifactSha256:$artifact,sourceCommit:$source},
   contract:{path:"line-ai-contract.ts",sha256:("d"*64),runtimeContractVersion:1}}
' > "$work/release.json"
jq -cnS --arg source "$source_sha" --arg artifact "$artifact_sha" '
  {schemaVersion:1,environment:"uat",sourceCommit:$source,
   executionRoleArn:"arn:aws:iam::123456789012:role/watchdog-bms-uat-agentcore-execution-role",
   artifact:{sha256:$artifact,bucket:"watchdog-bms-agentcore-artifacts-123456789012",
     prefix:("agentcore/watchdog_orchestrator_uat_candidate-"+$source+"-"+$artifact+".zip"),objectVersionId:"version-1"},
   runtime:{arn:"arn:aws:bedrock-agentcore:ap-southeast-1:123456789012:runtime/watchdog_orchestrator_uat_candidate-AbCdEf1234",
     id:"watchdog_orchestrator_uat_candidate-AbCdEf1234",version:"7",status:"READY"},
   endpoint:{arn:("arn:aws:bedrock-agentcore:ap-southeast-1:123456789012:runtime/watchdog_orchestrator_uat_candidate-AbCdEf1234/runtime-endpoint/candidate_uat_aaaaaaaaaaaa"),
     name:"candidate_uat_aaaaaaaaaaaa",version:"7",status:"READY"},
   bindingStrategy:"isolated_runtime_pinned_endpoint",configurationSha256:("e"*64),contractVersion:1}
' > "$work/binding.json"
test "$(bash "$root/infra/ai-gateway/validate-agentcore-candidate-binding.sh" \
  "$work/binding.json" "$work/release.json" uat)" = candidate_uat_aaaaaaaaaaaa

reject() {
  jq "$2" "$work/binding.json" > "$work/$1.json"
  if bash "$root/infra/ai-gateway/validate-agentcore-candidate-binding.sh" \
    "$work/$1.json" "$work/release.json" uat >/dev/null 2>&1; then
    echo "ERROR: binding validator accepted $1" >&2; exit 1
  fi
}
reject default-endpoint '.endpoint.name="DEFAULT"'
reject wrong-version '.endpoint.version="8"'
reject wrong-artifact '.artifact.sha256=("f"*64)'
reject wrong-source '.sourceCommit=("f"*40)'
reject wrong-execution-role '.executionRoleArn="arn:aws:iam::123456789012:role/watchdog-bms-agentcore-execution-role"'
reject source-not-in-object-key '.artifact.prefix=("agentcore/watchdog_orchestrator_uat_candidate-"+("f"*40)+"-"+.artifact.sha256+".zip")'
reject endpoint-not-under-runtime '.endpoint.arn="arn:aws:bedrock-agentcore:ap-southeast-1:123456789012:runtime/watchdog_orchestrator_uat_candidate-ZzYyXx9876/runtime-endpoint/candidate_uat_aaaaaaaaaaaa"'
reject missing-object-version '.artifact.objectVersionId=""'
reject extra-field '.rawPrompt="must-not-exist"'

ecs_source=3c8de8777ce1f85f7a3c1c0518c81154ab6eedf1
stale_agentcore_source=eaa9005a1857b3cd582ceda743977496ed955110
jq -cS --arg source "$ecs_source" \
  '.sourceCommit=$source|.agentCore.sourceCommit=$source' "$work/release.json" \
  > "$work/known-split-release.json"
jq -cS --arg source "$stale_agentcore_source" '
  .sourceCommit=$source
  |.artifact.prefix=("agentcore/watchdog_orchestrator_uat_candidate-"+$source+"-"+.artifact.sha256+".zip")
' "$work/binding.json" > "$work/known-split-binding.json"
if bash "$root/infra/ai-gateway/validate-agentcore-candidate-binding.sh" \
    "$work/known-split-binding.json" "$work/known-split-release.json" uat >/dev/null 2>&1; then
  echo 'ERROR: binding validator accepted the known ECS/AgentCore split-source pair' >&2
  exit 1
fi
echo 'AgentCore candidate binding specs passed'
