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
   endpoint:{arn:("arn:aws:bedrock-agentcore:ap-southeast-1:123456789012:runtime/watchdog_orchestrator_uat_candidate-AbCdEf1234/runtime-endpoint/candidate_uat_aaaaaaaaaaaa_bbbbbbbb"),
     name:"candidate_uat_aaaaaaaaaaaa_bbbbbbbb",version:"7",status:"READY"},
   bindingStrategy:"isolated_runtime_pinned_endpoint",configurationSha256:("e"*64),contractVersion:1}
' > "$work/binding.json"
test "$(bash "$root/infra/ai-gateway/validate-agentcore-candidate-binding.sh" \
  "$work/binding.json" "$work/release.json" uat)" = candidate_uat_aaaaaaaaaaaa_bbbbbbbb

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
reject endpoint-not-under-runtime '.endpoint.arn="arn:aws:bedrock-agentcore:ap-southeast-1:123456789012:runtime/watchdog_orchestrator_uat_candidate-ZzYyXx9876/runtime-endpoint/candidate_uat_aaaaaaaaaaaa_bbbbbbbb"'
reject source-only-endpoint '.endpoint.name="candidate_uat_aaaaaaaaaaaa"|.endpoint.arn=(.runtime.arn+"/runtime-endpoint/"+.endpoint.name)'
reject wrong-artifact-endpoint '.endpoint.name="candidate_uat_aaaaaaaaaaaa_ffffffff"|.endpoint.arn=(.runtime.arn+"/runtime-endpoint/"+.endpoint.name)'
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

runtime_arn='arn:aws:bedrock-agentcore:ap-southeast-1:123456789012:runtime/watchdog_orchestrator_uat_candidate-AbCdEf1234'
endpoint_name='candidate_uat_aaaaaaaaaaaa_bbbbbbbb'
endpoint_arn="$runtime_arn/runtime-endpoint/$endpoint_name"
endpoint_validator="$root/infra/ai-gateway/validate-agentcore-endpoint-readback.sh"
jq -cnS --arg arn "$runtime_arn" --arg endpointArn "$endpoint_arn" --arg name "$endpoint_name" \
  '{agentRuntimeArn:$arn,agentRuntimeEndpointArn:$endpointArn,name:$name,status:"READY",liveVersion:"7"}' \
  > "$work/endpoint-ready.json"
bash "$endpoint_validator" "$work/endpoint-ready.json" "$runtime_arn" "$endpoint_name" 7 intended
bash "$endpoint_validator" "$work/endpoint-ready.json" "$runtime_arn" "$endpoint_name" 7 ready

jq '.status="UPDATING"|.targetVersion="7"|.liveVersion="6"' "$work/endpoint-ready.json" \
  > "$work/endpoint-updating.json"
bash "$endpoint_validator" "$work/endpoint-updating.json" "$runtime_arn" "$endpoint_name" 7 intended
if bash "$endpoint_validator" "$work/endpoint-updating.json" \
    "$runtime_arn" "$endpoint_name" 7 ready >/dev/null 2>&1; then
  echo 'ERROR: endpoint validator accepted an unsettled endpoint as READY' >&2; exit 1
fi

reject_endpoint() {
  jq "$2" "$work/endpoint-ready.json" > "$work/endpoint-$1.json"
  if bash "$endpoint_validator" "$work/endpoint-$1.json" \
      "$runtime_arn" "$endpoint_name" 7 "$3" >/dev/null 2>&1; then
    echo "ERROR: endpoint validator accepted $1" >&2; exit 1
  fi
}
reject_endpoint wrong-live-version '.liveVersion="8"' ready
reject_endpoint conflicting-settled-target '.targetVersion="8"' ready
reject_endpoint conflicting-intended-target '.targetVersion="8"' intended
reject_endpoint wrong-endpoint-arn '.agentRuntimeEndpointArn="arn:aws:bedrock-agentcore:ap-southeast-1:123456789012:runtime/other/runtime-endpoint/other"' ready

echo 'AgentCore candidate binding specs passed'
