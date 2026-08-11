#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
validator="$root/infra/security/validate-production-release-ready-v2.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/production-ready-v2-spec.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
source="$(printf 'a%.0s' {1..40})"; controller="$(printf 'b%.0s' {1..40})"
now=2000000000
sha_file() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"|awk '{print $1}'; else shasum -a 256 "$1"|awk '{print $1}'; fi; }
sha_stream() { if command -v sha256sum >/dev/null 2>&1; then sha256sum|awk '{print $1}'; else shasum -a 256|awk '{print $1}'; fi; }
jq -cnS --arg source "$source" --argjson expires "$((now+86400))" '
 {sourceCommit:$source,expiresAtEpoch:$expires,tools:[{purpose:"migration-tool",
  image:"311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-migration-tool@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}]}' \
  > "$work/passport.json"
jq -cnS --arg source "$source" '{schemaVersion:1,sourceCommit:$source,status:"EXACT_MATCH",
  migrationCount:1,appliedMigrationCount:1,pendingMigrationCount:0,
  repositoryCatalogHash:("1"*64),appliedCatalogHash:("2"*64),pendingCatalogHash:("3"*64)}' > "$work/catalog-result.json"
jq -cnS --arg source "$source" --arg image "$(jq -r '.tools[0].image' "$work/passport.json")" '
  {schemaVersion:2,sourceCommit:$source,migrationImage:$image,taskRoleArn:null,
   network:{assignPublicIp:"DISABLED"}}' > "$work/catalog-runtime.json"

services="$work/services.json"
jq -cnS --arg source "$source" '["ai-gateway","api-web","workers"]|map(. as $service|
  {service:$service,image:("repo/"+$service+"@sha256:"+("4"*64)),sourceCommit:$source,
   servingMode:"maintenance_only",
   serviceRevisionArn:("arn:aws:ecs:ap-southeast-1:311414082667:service-revision/"+$service+"/1"),
   taskDefinitionArn:("arn:aws:ecs:ap-southeast-1:311414082667:task-definition/"+$service+":1")})' > "$services"
jq -cnS --slurpfile services "$services" '
 {status:"PASS",services:($services[0]|map(. as $s|{service:$s.service,
   serviceRevisionArn:$s.serviceRevisionArn,taskDefinition:{arn:$s.taskDefinitionArn},
   rawEvidence:{describeExpressGatewayService:{raw:{second:{service:{activeConfigurations:[{
     primaryContainer:{image:$s.image,environment:[{name:"GIT_SHA",value:$s.sourceCommit},
       {name:"PRODUCTION_SERVING_MODE",value:$s.servingMode}]}}]}}}}}}))}' > "$work/production-health.json"
jq -cnS --argjson now "$now" '
 {schemaVersion:2,observedAtEpoch:$now,a5PolicySha256:("5"*64),clonePolicySha256:null,
  securityPolicySha256:("7"*64),rds:{status:"available",storageEncrypted:true,multiAZ:true,
    deletionProtection:true,backupRetentionDays:35},redis:{status:"available",atRestEncryptionEnabled:true,
    transitEncryptionEnabled:true,authTokenEnabled:true,automaticFailover:"enabled",nodeCount:2,
    snapshotRetentionDays:35}}
' > "$work/production-runtime.json"
passport_hash="$(sha_file "$work/passport.json")"
jq -cnS --arg source "$source" --arg controller "$controller" --arg passport "$passport_hash" \
  --arg health "$(sha_file "$work/production-health.json")" \
  --arg catalog "$(sha_file "$work/catalog-result.json")" \
  --arg runtime "$(sha_file "$work/catalog-runtime.json")" --slurpfile services "$services" \
  --arg runtimeBaseline "$(sha_file "$work/production-runtime.json")" \
  --argjson issued "$((now-60))" --argjson expires "$((now-60+86400))" '
  {schemaVersion:2,artifactKind:"PRODUCTION_RELEASE_READY_V2",environment:"production",
   repository:"example/watchdog",workflow:{path:".github/workflows/production-readiness.yml",runId:"9001",
    runAttempt:1,controllerRef:"refs/heads/main",controllerCommit:$controller},sourceCommit:$source,
   passportRef:{runId:"8001",runAttempt:2,contentSha256:$passport,expiresAtEpoch:($expires+60)},
   serving:{requestedMode:"maintenance_closed",effectiveTarget:"all"},
   aws:{accountId:"311414082667",region:"ap-southeast-1"},issuedAtEpoch:$issued,expiresAtEpoch:$expires,
   productionBaseline:{path:"production-health.json",sha256:$health,services:$services[0]},
   runtimeBaseline:{path:"production-runtime.json",sha256:$runtimeBaseline},
   migration:{classificationPath:"catalog-result.json",classificationSha256:$catalog,
    runtimePath:"catalog-runtime.json",runtimeSha256:$runtime,status:"EXACT_MATCH",pendingMigrationCount:0,clone:null},
   checks:{a5Reader:"PASS",artifactIntegrity:"PASS",awsPolicies:"PASS",imageSignatures:"PASS",
    legalMode:"PASS",productionRuntime:"PASS",serviceStability:"PASS"}}
' > "$work/body.json"
hash="$(jq -cjS . "$work/body.json"|sha_stream)"
jq -cS --arg hash "$hash" '.+{contentSha256:$hash}' "$work/body.json" > "$work/ready.json"
bash "$validator" "$work/ready.json" "$work" "$work/passport.json" "$source" 8001 2 9001 1 \
  "$controller" example/watchdog "$now" >/dev/null
# A READY run starts after its Passport, so its normal expiry is capped by the Passport's
# remaining lifetime rather than receiving a fresh replayable 24-hour window.
jq -cS --argjson expiry "$((now+600))" '.expiresAtEpoch=$expiry' \
  "$work/passport.json" > "$work/capped-passport.json"
jq -cS --argjson expiry "$((now+600))" \
  --arg passport "$(sha_file "$work/capped-passport.json")" '
  .passportRef.contentSha256=$passport|.passportRef.expiresAtEpoch=$expiry
  |.expiresAtEpoch=$expiry|del(.contentSha256)
' "$work/ready.json" > "$work/capped-body.json"
capped_hash="$(jq -cjS . "$work/capped-body.json"|sha_stream)"
jq -cS --arg hash "$capped_hash" '.+{contentSha256:$hash}' \
  "$work/capped-body.json" > "$work/capped.json"
bash "$validator" "$work/capped.json" "$work" "$work/capped-passport.json" "$source" 8001 2 9001 1 \
  "$controller" example/watchdog "$now" >/dev/null
reject() {
  jq -cS "$2" "$work/ready.json" > "$work/$1.json"
  if bash "$validator" "$work/$1.json" "$work" "$work/passport.json" "$source" 8001 2 9001 1 \
      "$controller" example/watchdog "$now" >/dev/null 2>&1; then
    echo "ERROR: READY validator accepted $1" >&2; exit 1
  fi
}
reject stale '.expiresAtEpoch=1999999999'
reject changed-baseline '.productionBaseline.services[0].sourceCommit=("f"*40)'
reject missing-clone '.migration.status="APPEND_ONLY_PENDING"|.migration.pendingMigrationCount=1'
reject failed-check '.checks.a5Reader="FAIL"'

rewrite() {
  local filter="$1" output="$2" body="$work/rewrite-body.json" digest
  shift 2
  jq -cS "$@" "$filter|del(.contentSha256)" "$work/ready.json" > "$body"
  digest="$(jq -cjS . "$body"|sha_stream)"
  jq -cS --arg hash "$digest" '.+{contentSha256:$hash}' "$body" > "$output"
}
cp "$work/production-health.json" "$work/production-health-closed.json"
jq -cS '(.services[].rawEvidence.describeExpressGatewayService.raw.second.service
  .activeConfigurations[0].primaryContainer.environment[]
  |select(.name=="PRODUCTION_SERVING_MODE")|.value)="live"' \
  "$work/production-health.json" > "$work/production-health-live.json"
mv "$work/production-health-live.json" "$work/production-health.json"
rewrite '.serving={requestedMode:"live",effectiveTarget:"api-web"}
  |.productionBaseline.sha256=$health
  |.productionBaseline.services|=map(.servingMode="live")' "$work/live-selective.json" \
  --arg health "$(sha_file "$work/production-health.json")"
bash "$validator" "$work/live-selective.json" "$work" "$work/passport.json" "$source" 8001 2 9001 1 \
  "$controller" example/watchdog "$now" >/dev/null
mv "$work/production-health-closed.json" "$work/production-health.json"
rewrite '.serving.effectiveTarget="api-web"' "$work/closed-selective.json"
if bash "$validator" "$work/closed-selective.json" "$work" "$work/passport.json" "$source" \
    8001 2 9001 1 "$controller" example/watchdog "$now" >/dev/null 2>&1; then
  echo 'ERROR: READY validator accepted selective maintenance closure' >&2; exit 1
fi
rewrite '.serving={requestedMode:"live",effectiveTarget:"api-web"}
  |.productionBaseline.services|=map(.servingMode="live")
  |.productionBaseline.services[0].sourceCommit=("f"*40)' "$work/split-selective.json"
if bash "$validator" "$work/split-selective.json" "$work" "$work/passport.json" "$source" \
    8001 2 9001 1 "$controller" example/watchdog "$now" >/dev/null 2>&1; then
  echo 'ERROR: READY validator accepted a selective split baseline' >&2; exit 1
fi
bash -n "$validator"
echo 'production release READY V2 contract: PASS'
