#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
validator="$root/infra/security/compare-production-ready-baseline-v2.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/production-ready-baseline-v2.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
source_sha="$(printf 'a%.0s' {1..40})"

jq -cnS --arg source "$source_sha" '
 {sourceCommit:$source,productionBaseline:{services:["ai-gateway","api-web","workers"]|map(. as $s|
  {service:$s,image:("repo/"+$s+"@sha256:"+("1"*64)),sourceCommit:(if $s=="workers" then "b"*40 else $source end),
   servingMode:"maintenance_only",serviceRevisionArn:("revision/"+$s),taskDefinitionArn:("task/"+$s)})}}' \
  > "$work/ready.json"
jq -cnS --slurpfile ready "$work/ready.json" '
 {status:"PASS",services:($ready[0].productionBaseline.services|map(. as $s|{service:$s.service,
  servingMode:$s.servingMode,serviceRevisionArn:$s.serviceRevisionArn,taskDefinition:{arn:$s.taskDefinitionArn},
  rawEvidence:{describeExpressGatewayService:{raw:{second:{service:{activeConfigurations:[{
   primaryContainer:{image:$s.image,environment:[{name:"GIT_SHA",value:$s.sourceCommit},
    {name:"PRODUCTION_SERVING_MODE",value:$s.servingMode}]}}]}}}}}}))}' > "$work/health.json"
jq -cnS '{schemaVersion:2,observedAtEpoch:1,securityPolicySha256:("2"*64),a5PolicySha256:("3"*64),
 promotionPrerequisitesSha256:("4"*64),clonePolicySha256:null,
 rds:{identifier:"db",status:"available",rawSha256:("4"*64)},
 redis:{replicationGroupId:"redis",status:"available",rawReplicationGroupSha256:("5"*64),
 rawPrimarySha256:("6"*64)}}' > "$work/runtime-ready.json"
jq -cS '.observedAtEpoch=2|.rds.rawSha256=("7"*64)|.redis.rawPrimarySha256=("8"*64)' \
  "$work/runtime-ready.json" > "$work/runtime-current.json"
jq -cnS --arg source "$source_sha" '{schemaVersion:1,sourceCommit:$source,status:"EXACT_MATCH",
 migrationCount:2,appliedMigrationCount:2,pendingMigrationCount:0,repositoryCatalogHash:("9"*64),
 appliedCatalogHash:("a"*64),pendingCatalogHash:("b"*64)}' > "$work/catalog-ready.json"
cp "$work/catalog-ready.json" "$work/catalog-current.json"

bash "$validator" "$work/ready.json" "$work/runtime-ready.json" "$work/catalog-ready.json" \
  "$work/health.json" "$work/runtime-current.json" "$work/catalog-current.json" >/dev/null

# Promotion prerequisites are freshly exact-validated before this comparison. Their evidence hash
# includes live capacity counters, so a changed hash with otherwise valid current evidence is not
# baseline drift (for example, another DB was created while at least one quota slot remains).
jq -cS '.promotionPrerequisitesSha256=("c"*64)' "$work/runtime-current.json" \
  > "$work/runtime-current-capacity-changed.json"
bash "$validator" "$work/ready.json" "$work/runtime-ready.json" "$work/catalog-ready.json" \
  "$work/health.json" "$work/runtime-current-capacity-changed.json" \
  "$work/catalog-current.json" >/dev/null

jq -cS '.services[0].rawEvidence.describeExpressGatewayService.raw.second.service.activeConfigurations[0].primaryContainer.image="drift"' \
  "$work/health.json" > "$work/health-drift.json"
if bash "$validator" "$work/ready.json" "$work/runtime-ready.json" "$work/catalog-ready.json" \
  "$work/health-drift.json" "$work/runtime-current.json" "$work/catalog-current.json" >/dev/null 2>&1; then
  echo 'ERROR: baseline validator accepted service drift' >&2; exit 1
fi
jq -cS '.rds.status="modifying"' "$work/runtime-current.json" > "$work/runtime-drift.json"
if bash "$validator" "$work/ready.json" "$work/runtime-ready.json" "$work/catalog-ready.json" \
  "$work/health.json" "$work/runtime-drift.json" "$work/catalog-current.json" >/dev/null 2>&1; then
  echo 'ERROR: baseline validator accepted runtime drift' >&2; exit 1
fi
jq -cS '.appliedCatalogHash=("f"*64)' "$work/catalog-current.json" > "$work/catalog-drift.json"
if bash "$validator" "$work/ready.json" "$work/runtime-ready.json" "$work/catalog-ready.json" \
  "$work/health.json" "$work/runtime-current.json" "$work/catalog-drift.json" >/dev/null 2>&1; then
  echo 'ERROR: baseline validator accepted migration drift' >&2; exit 1
fi
bash -n "$validator"
echo 'production READY baseline recheck V2: PASS'
