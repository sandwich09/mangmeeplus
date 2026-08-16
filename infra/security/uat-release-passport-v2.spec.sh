#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
validator="$repo_root/infra/security/validate-uat-release-passport-v2.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/uat-passport-v2-spec.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
root="$work/artifact"
mkdir -p "$root/release/agentcore" "$root/tools"

source_sha="$(printf 'a%.0s' {1..40})"
controller_sha="$(printf 'b%.0s' {1..40})"
account=311414082667
region=ap-southeast-1
run_id=12345
attempt=2
now=2000000000

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}';
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}
sha256_stream() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}';
  else shasum -a 256 | awk '{print $1}'; fi
}

for service in api-web ai-gateway workers; do
  printf '{"spdxVersion":"SPDX-2.3","name":"%s"}\n' "$service" > "$root/release/sbom-$service.spdx.json"
  printf '[{"critical":{"identity":{"docker-reference":"%s"}}}]\n' "$service" \
    > "$root/release/cosign-$service.json"
done
printf '[{"critical":{"identity":{"docker-reference":"release"}}}]\n' > "$root/tools/cosign-release-task.json"
printf '[{"critical":{"identity":{"docker-reference":"migration"}}}]\n' > "$root/tools/cosign-migration-tool.json"
printf '{"spdxVersion":"SPDX-2.3","name":"release-task"}\n' > "$root/tools/sbom-release-task.spdx.json"
printf '{"spdxVersion":"SPDX-2.3","name":"migration-tool"}\n' > "$root/tools/sbom-migration-tool.spdx.json"

api_digest="sha256:$(printf '1%.0s' {1..64})"
ai_digest="sha256:$(printf '2%.0s' {1..64})"
workers_digest="sha256:$(printf '3%.0s' {1..64})"
release_digest="sha256:$(printf '4%.0s' {1..64})"
migration_digest="sha256:$(printf '5%.0s' {1..64})"
jq -cS -n --arg source "$source_sha" --arg run "$run_id" \
  --arg api "$account.dkr.ecr.$region.amazonaws.com/watchdog-bms-api@$api_digest" \
  --arg ai "$account.dkr.ecr.$region.amazonaws.com/watchdog-bms-ai-gateway@$ai_digest" \
  --arg workers "$account.dkr.ecr.$region.amazonaws.com/watchdog-bms-workers@$workers_digest" \
  --arg apiDigest "$api_digest" --arg aiDigest "$ai_digest" --arg workersDigest "$workers_digest" '
  {schemaVersion:1,sourceCommit:$source,workflowRunId:$run,validationRunId:"99",images:[
    {service:"ai-gateway",repository:"watchdog-bms-ai-gateway",image:$ai,digest:$aiDigest,sourceCommit:$source,sbom:"sbom-ai-gateway.spdx.json"},
    {service:"api-web",repository:"watchdog-bms-api",image:$api,digest:$apiDigest,sourceCommit:$source,sbom:"sbom-api-web.spdx.json"},
    {service:"workers",repository:"watchdog-bms-workers",image:$workers,digest:$workersDigest,sourceCommit:$source,sbom:"sbom-workers.spdx.json"}]}
' > "$root/release/production-image-manifest.json"

printf 'agentcore-candidate' > "$root/release/agentcore/agentcore.zip"
agentcore_sha="$(sha256_file "$root/release/agentcore/agentcore.zip")"
jq -cnS --arg source "$source_sha" --arg sha "$agentcore_sha" \
  '{schemaVersion:1,sourceCommit:$source,artifact:"agentcore.zip",sha256:$sha}' \
  > "$root/release/agentcore/agentcore-artifact.json"
cp "$repo_root/packages/contracts/src/line-ai.ts" "$root/release/line-ai-contract.ts"
bash "$repo_root/infra/ai-gateway/build-line-ai-release-manifest.sh" \
  "$root/release/line-ai-release-manifest.json" "$root/release/production-image-manifest.json" \
  "$root/release/agentcore" "$root/release/line-ai-contract.ts" "$run_id" 99
jq -cnS --arg source "$source_sha" --arg artifact "$agentcore_sha" '
  {schemaVersion:1,environment:"uat",sourceCommit:$source,
   artifact:{sha256:$artifact,bucket:"watchdog-bms-agentcore-artifacts-311414082667",
     prefix:("agentcore/watchdog_orchestrator_uat_candidate-"+$source+"-"+$artifact+".zip"),objectVersionId:"version-1"},
   runtime:{arn:"arn:aws:bedrock-agentcore:ap-southeast-1:311414082667:runtime/watchdog_orchestrator_uat_candidate-AbCdEf1234",
     id:"watchdog_orchestrator_uat_candidate-AbCdEf1234",version:"7",status:"READY"},
   endpoint:{arn:"arn:aws:bedrock-agentcore:ap-southeast-1:311414082667:runtime/watchdog_orchestrator_uat_candidate-AbCdEf1234/runtime-endpoint/candidate_uat_aaaaaaaaaaaa",
     name:"candidate_uat_aaaaaaaaaaaa",version:"7",status:"READY"},
   bindingStrategy:"isolated_runtime_pinned_endpoint",configurationSha256:("e"*64),contractVersion:1}
' > "$root/agentcore-binding.json"

jq -cS -n --arg source "$source_sha" --arg checksum "$(printf '6%.0s' {1..64})" '
  {schemaVersion:1,sourceCommit:$source,migrations:[{name:"20260101000000_first",checksum:$checksum}],
   repositoryCatalogHash:"",prismaSchemaSha256:("7"*64)}
' > "$work/catalog-body.json"
catalog_hash="$(jq -cjS '.migrations | map({name,checksum})' "$work/catalog-body.json" | sha256_stream)"
jq -cS --arg hash "$catalog_hash" '.repositoryCatalogHash=$hash' "$work/catalog-body.json" > "$root/migration-catalog.json"

manifest_hash="$(sha256_file "$root/release/production-image-manifest.json")"
line_ai_manifest_hash="$(sha256_file "$root/release/line-ai-release-manifest.json")"
agentcore_artifact_manifest_hash="$(sha256_file "$root/release/agentcore/agentcore-artifact.json")"
agentcore_binding_hash="$(sha256_file "$root/agentcore-binding.json")"
catalog_file_hash="$(sha256_file "$root/migration-catalog.json")"
jq -cS -n \
  --arg repository example/watchdog --arg run "$run_id" --argjson attempt "$attempt" \
  --arg controller "$controller_sha" --arg source "$source_sha" --arg manifestHash "$manifest_hash" \
  --arg lineAiManifestHash "$line_ai_manifest_hash" \
  --arg agentcoreArtifactManifestHash "$agentcore_artifact_manifest_hash" \
  --arg agentcoreBindingHash "$agentcore_binding_hash" \
  --arg catalogFileHash "$catalog_file_hash" --arg catalogHash "$catalog_hash" \
  --arg account "$account" --arg region "$region" \
  --arg apiDigest "$api_digest" --arg aiDigest "$ai_digest" --arg workersDigest "$workers_digest" \
  --arg releaseDigest "$release_digest" --arg migrationDigest "$migration_digest" \
  --argjson issued "$((now - 60))" --argjson expires "$((now - 60 + 86400))" \
  --arg releaseSbom "$(sha256_file "$root/tools/sbom-release-task.spdx.json")" \
  --arg releaseSig "$(sha256_file "$root/tools/cosign-release-task.json")" \
  --arg migrationSbom "$(sha256_file "$root/tools/sbom-migration-tool.spdx.json")" \
  --arg migrationSig "$(sha256_file "$root/tools/cosign-migration-tool.json")" '
  def image($service;$repository;$digest):
    {service:$service,repository:$repository,image:($account+".dkr.ecr."+$region+".amazonaws.com/"+$repository+"@"+$digest),digest:$digest,sourceCommit:$source,
     sbom:{path:("release/sbom-"+$service+".spdx.json"),sha256:""},
     signature:{path:("release/cosign-"+$service+".json"),sha256:""},
     attestations:{provenance:"BUILDKIT_MAX",sbom:"BUILDKIT_REGISTRY_NATIVE"}};
  def tool($purpose;$repository;$digest;$sbomPath;$sbomHash;$sigPath;$sigHash):
    {purpose:$purpose,repository:$repository,image:($account+".dkr.ecr."+$region+".amazonaws.com/"+$repository+"@"+$digest),digest:$digest,sourceCommit:$source,
     sbom:{path:$sbomPath,sha256:$sbomHash},signature:{path:$sigPath,sha256:$sigHash},
     attestations:{provenance:"BUILDKIT_MAX",sbom:"BUILDKIT_REGISTRY_NATIVE"}};
  {schemaVersion:2,artifactKind:"UAT_RELEASE_PASSPORT_V2",environment:"uat",repository:$repository,
   workflow:{path:".github/workflows/deploy-uat.yml",runId:$run,runAttempt:$attempt,controllerRef:"refs/heads/main",controllerCommit:$controller},
   sourceCommit:$source,requestedTarget:"auto",resolvedTarget:"all",issuedAtEpoch:$issued,expiresAtEpoch:$expires,
   validatedCiRunId:"99",release:{artifactName:("uat-accepted-release-"+$source+"-attempt-"+($attempt|tostring)),
     manifestPath:"release/production-image-manifest.json",manifestSha256:$manifestHash,
     images:[image("ai-gateway";"watchdog-bms-ai-gateway";$aiDigest),image("api-web";"watchdog-bms-api";$apiDigest),image("workers";"watchdog-bms-workers";$workersDigest)]},
   lineAiCandidate:{manifestPath:"release/line-ai-release-manifest.json",manifestSha256:$lineAiManifestHash,
     artifactManifestPath:"release/agentcore/agentcore-artifact.json",artifactManifestSha256:$agentcoreArtifactManifestHash,
     artifactPath:"release/agentcore/agentcore.zip",contractPath:"release/line-ai-contract.ts",
     bindingPath:"agentcore-binding.json",bindingSha256:$agentcoreBindingHash},
   tools:[tool("migration-tool";"watchdog-bms-migration-tool";$migrationDigest;"tools/sbom-migration-tool.spdx.json";$migrationSbom;"tools/cosign-migration-tool.json";$migrationSig),
     tool("release-task";"watchdog-bms-api";$releaseDigest;"tools/sbom-release-task.spdx.json";$releaseSbom;"tools/cosign-release-task.json";$releaseSig)],
   migrationCatalog:{path:"migration-catalog.json",sha256:$catalogFileHash,migrationCount:1,repositoryCatalogHash:$catalogHash,prismaSchemaSha256:("7"*64)},
   uatProof:{ciVerified:true,healthVerified:true,imageScanVerified:true,releaseFinalized:true}}
' > "$work/passport-body.json"
jq -cS '
  .release.images |= map(
    .sbom.sha256=(if .service=="api-web" then $apiSbom elif .service=="ai-gateway" then $aiSbom else $workersSbom end)
    |.signature.sha256=(if .service=="api-web" then $apiSig elif .service=="ai-gateway" then $aiSig else $workersSig end))
' --arg apiSbom "$(sha256_file "$root/release/sbom-api-web.spdx.json")" \
  --arg aiSbom "$(sha256_file "$root/release/sbom-ai-gateway.spdx.json")" \
  --arg workersSbom "$(sha256_file "$root/release/sbom-workers.spdx.json")" \
  --arg apiSig "$(sha256_file "$root/release/cosign-api-web.json")" \
  --arg aiSig "$(sha256_file "$root/release/cosign-ai-gateway.json")" \
  --arg workersSig "$(sha256_file "$root/release/cosign-workers.json")" \
  "$work/passport-body.json" > "$work/passport-with-runtime.json"
mv "$work/passport-with-runtime.json" "$work/passport-body.json"
content_hash="$(jq -cjS . "$work/passport-body.json" | sha256_stream)"
jq -cS --arg hash "$content_hash" '. + {contentSha256:$hash}' "$work/passport-body.json" > "$root/passport.json"

bash "$validator" "$root/passport.json" "$root" "$source_sha" "$run_id" "$attempt" \
  "$controller_sha" example/watchdog "$account" "$region" "$now" >/dev/null

reject() {
  local name="$1" filter="$2"
  jq -cS "$filter" "$root/passport.json" > "$work/$name.json"
  if bash "$validator" "$work/$name.json" "$root" "$source_sha" "$run_id" "$attempt" \
      "$controller_sha" example/watchdog "$account" "$region" "$now" >/dev/null 2>&1; then
    echo "ERROR: passport validator accepted $name" >&2
    exit 1
  fi
}
reject wrong-source '.sourceCommit=("f"*40)'
reject extra-key '.unexpected=true'
reject wrong-tool '.tools[0].image=.tools[1].image'
reject stale '.expiresAtEpoch=1999999999'
reject path-traversal '.tools[0].sbom.path="../secret"'

cp "$root/migration-catalog.json" "$work/catalog.good"
jq -cS '.migrations[0].checksum=("8"*64)' "$work/catalog.good" > "$root/migration-catalog.json"
if bash "$validator" "$root/passport.json" "$root" "$source_sha" "$run_id" "$attempt" \
    "$controller_sha" example/watchdog "$account" "$region" "$now" >/dev/null 2>&1; then
  echo 'ERROR: passport validator accepted a tampered migration catalog' >&2
  exit 1
fi
mv "$work/catalog.good" "$root/migration-catalog.json"

cp "$root/agentcore-binding.json" "$work/agentcore-binding.good"
jq -cS '.endpoint.version="8"' "$work/agentcore-binding.good" > "$root/agentcore-binding.json"
if bash "$validator" "$root/passport.json" "$root" "$source_sha" "$run_id" "$attempt" \
    "$controller_sha" example/watchdog "$account" "$region" "$now" >/dev/null 2>&1; then
  echo 'ERROR: passport validator accepted a tampered AgentCore binding' >&2
  exit 1
fi
mv "$work/agentcore-binding.good" "$root/agentcore-binding.json"

bash -n "$validator"
echo 'UAT release passport V2 contract: PASS'
