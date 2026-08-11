#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 11 ]; then
  echo "Usage: $0 <ready.json> <evidence-root> <passport.json> <source> <uat-run> <uat-attempt> <ready-run> <ready-attempt> <controller> <repository> <now>" >&2
  exit 2
fi
ready="$1" root="$2" passport="$3" source="$4" uat_run="$5" uat_attempt="$6"
ready_run="$7" ready_attempt="$8" controller="$9" repository="${10}" now="${11}"
[[ "$source" =~ ^[0-9a-f]{40}$ && "$controller" =~ ^[0-9a-f]{40}$ ]]
[[ "$uat_run" =~ ^[1-9][0-9]*$ && "$uat_attempt" =~ ^[1-9][0-9]*$ ]]
[[ "$ready_run" =~ ^[1-9][0-9]*$ && "$ready_attempt" =~ ^[1-9][0-9]*$ && "$now" =~ ^[1-9][0-9]*$ ]]
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]
[ -d "$root" ] && [ ! -L "$root" ] && [ -f "$ready" ] && [ ! -L "$ready" ]
[ -f "$passport" ] && [ ! -L "$passport" ]
root="$(cd "$root" && pwd -P)"

sha_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}
sha_stream() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'
  else shasum -a 256 | awk '{print $1}'; fi
}
safe() {
  local relative="$1" limit="$2" file
  [[ "$relative" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]]
  [[ "$relative" != /* && "$relative" != *".."* && "$relative" != *"//"* ]]
  file="$root/$relative"
  [ -f "$file" ] && [ ! -L "$file" ] && [ "$(wc -c < "$file")" -le "$limit" ]
  printf '%s' "$file"
}

work="$(mktemp -d "${TMPDIR:-/tmp}/production-ready-v2.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
jq -cS . "$ready" > "$work/ready.json"
cmp -s "$ready" "$work/ready.json"
content="$(jq -cjS 'del(.contentSha256)' "$ready" | sha_stream)"
passport_hash="$(sha_file "$passport")"
passport_source="$(jq -er '.sourceCommit|select(test("^[0-9a-f]{40}$"))' "$passport")"
passport_expiry="$(jq -er '.expiresAtEpoch|select(type=="number" and floor==. and .>=1)' "$passport")"
test "$passport_source" = "$source"
jq -e --arg source "$source" --arg uat "$uat_run" --argjson uatAttempt "$uat_attempt" \
  --arg run "$ready_run" --argjson attempt "$ready_attempt" --arg controller "$controller" \
  --arg repository "$repository" --arg passportHash "$passport_hash" --arg content "$content" \
  --argjson passportExpiry "$passport_expiry" --argjson now "$now" '
  def exact($keys):(keys|sort)==($keys|sort);
  def hash:type=="string" and test("^[0-9a-f]{64}$");
  def sha:type=="string" and test("^[0-9a-f]{40}$");
  exact(["artifactKind","aws","checks","contentSha256","environment","expiresAtEpoch",
    "issuedAtEpoch","migration","passportRef","productionBaseline","repository","schemaVersion",
    "runtimeBaseline","serving","sourceCommit","workflow"])
  and .schemaVersion==2 and .artifactKind=="PRODUCTION_RELEASE_READY_V2"
  and .environment=="production" and .repository==$repository and .sourceCommit==$source
  and (.workflow|exact(["controllerCommit","controllerRef","path","runAttempt","runId"]))
  and .workflow=={path:".github/workflows/production-readiness.yml",runId:$run,
    runAttempt:$attempt,controllerRef:"refs/heads/main",controllerCommit:$controller}
  and (.passportRef|exact(["contentSha256","expiresAtEpoch","runAttempt","runId"]))
  and .passportRef.runId==$uat and .passportRef.runAttempt==$uatAttempt
  and .passportRef.contentSha256==$passportHash and (.passportRef.contentSha256|hash)
  and .passportRef.expiresAtEpoch==$passportExpiry and .passportRef.expiresAtEpoch>$now
  and (.issuedAtEpoch|type)=="number" and .issuedAtEpoch<=$now
  and .expiresAtEpoch==([(.issuedAtEpoch+86400),.passportRef.expiresAtEpoch]|min)
  and .expiresAtEpoch>$now
  and .expiresAtEpoch<=.passportRef.expiresAtEpoch
  and (.serving|exact(["effectiveTarget","requestedMode"]))
  and (.serving.requestedMode=="maintenance_closed" or .serving.requestedMode=="live")
  and (.serving.effectiveTarget=="all" or .serving.effectiveTarget=="api-web"
    or .serving.effectiveTarget=="ai-gateway" or .serving.effectiveTarget=="workers")
  and .aws=={accountId:"311414082667",region:"ap-southeast-1"}
  and (.productionBaseline|exact(["path","services","sha256"]))
  and .productionBaseline.path=="production-health.json" and (.productionBaseline.sha256|hash)
  and (.productionBaseline.services|type)=="array" and (.productionBaseline.services|length)==3
  and ([.productionBaseline.services[].service]|sort)==["ai-gateway","api-web","workers"]
  and all(.productionBaseline.services[];
    exact(["image","service","serviceRevisionArn","servingMode","sourceCommit","taskDefinitionArn"])
    and (.sourceCommit|sha) and (.image|test("@sha256:[0-9a-f]{64}$"))
    and (.serviceRevisionArn|test("^arn:aws:ecs:ap-southeast-1:311414082667:service-revision/"))
    and (.taskDefinitionArn|test("^arn:aws:ecs:ap-southeast-1:311414082667:task-definition/"))
    and (.servingMode=="maintenance_only" or .servingMode=="live"))
  and (.runtimeBaseline|exact(["path","sha256"]))
  and .runtimeBaseline.path=="production-runtime.json" and (.runtimeBaseline.sha256|hash)
  and (.migration|exact(["classificationPath","classificationSha256","clone",
    "pendingMigrationCount","runtimePath","runtimeSha256","status"]))
  and .migration.classificationPath=="catalog-result.json"
  and .migration.runtimePath=="catalog-runtime.json"
  and (.migration.classificationSha256|hash) and (.migration.runtimeSha256|hash)
  and (.migration.status=="EXACT_MATCH" or .migration.status=="APPEND_ONLY_PENDING")
  and (.migration.pendingMigrationCount|type)=="number" and .migration.pendingMigrationCount>=0
  and ((.migration.status=="EXACT_MATCH" and .migration.pendingMigrationCount==0 and .migration.clone==null)
    or (.migration.status=="APPEND_ONLY_PENDING" and .migration.pendingMigrationCount>=1
      and (.migration.clone|exact(["infrastructurePath","infrastructureSha256","resultPath","resultSha256"]))))
  and (if .serving.requestedMode=="maintenance_closed"
      or .migration.status=="APPEND_ONLY_PENDING"
      or ([.productionBaseline.services[].sourceCommit]|unique|length)!=1
      or ([.productionBaseline.services[].servingMode]|unique)!=["live"]
    then .serving.effectiveTarget=="all" else true end)
  and (.checks|exact(["a5Reader","artifactIntegrity","awsPolicies","imageSignatures",
    "legalMode","productionRuntime","serviceStability"]))
  and all(.checks[];.=="PASS")
  and .contentSha256==$content and (.contentSha256|hash)
' "$ready" >/dev/null

health="$(safe "$(jq -er '.productionBaseline.path' "$ready")" 16777216)"
test "$(sha_file "$health")" = "$(jq -er '.productionBaseline.sha256' "$ready")"
jq -e --slurpfile ready "$ready" '
  .status=="PASS" and (.services|length)==3
  and ([.services[].service]|sort)==["ai-gateway","api-web","workers"]
  and ([.services[] | . as $s
    | .rawEvidence.describeExpressGatewayService.raw.second.service.activeConfigurations[0] as $a
    | ([$a.primaryContainer.environment[]?|select(.name=="GIT_SHA")|.value]) as $source
    | ([$a.primaryContainer.environment[]?|select(.name=="PRODUCTION_SERVING_MODE")|.value]) as $mode
    | {service:$s.service,image:$a.primaryContainer.image,sourceCommit:$source[0],
       servingMode:$mode[0],serviceRevisionArn:$s.serviceRevisionArn,
       taskDefinitionArn:$s.taskDefinition.arn}] | sort_by(.service))
    == ($ready[0].productionBaseline.services|sort_by(.service))
' "$health" >/dev/null

runtime_baseline="$(safe "$(jq -er '.runtimeBaseline.path' "$ready")" 1048576)"
test "$(sha_file "$runtime_baseline")" = "$(jq -er '.runtimeBaseline.sha256' "$ready")"
jq -e --slurpfile ready "$ready" '
  (keys|sort)==(["a5PolicySha256","clonePolicySha256","observedAtEpoch","rds","redis",
    "schemaVersion","securityPolicySha256"]|sort)
  and .schemaVersion==2
  and (.observedAtEpoch|type)=="number" and .observedAtEpoch>=1
  and (.rds.status=="available" and .rds.storageEncrypted==true and .rds.multiAZ==true
    and .rds.deletionProtection==true and .rds.backupRetentionDays>=35)
  and (.redis.status=="available" and .redis.atRestEncryptionEnabled==true
    and .redis.transitEncryptionEnabled==true and .redis.authTokenEnabled==true
    and .redis.automaticFailover=="enabled" and .redis.nodeCount>=2
    and .redis.snapshotRetentionDays>=35)
  and all(.a5PolicySha256,.securityPolicySha256;
    type=="string" and test("^[0-9a-f]{64}$"))
  and ((.clonePolicySha256==null and $ready[0].migration.status=="EXACT_MATCH")
    or ((.clonePolicySha256|type)=="string" and (.clonePolicySha256|test("^[0-9a-f]{64}$"))))
' "$runtime_baseline" >/dev/null

classification="$(safe "$(jq -er '.migration.classificationPath' "$ready")" 1048576)"
runtime="$(safe "$(jq -er '.migration.runtimePath' "$ready")" 1048576)"
test "$(sha_file "$classification")" = "$(jq -er '.migration.classificationSha256' "$ready")"
test "$(sha_file "$runtime")" = "$(jq -er '.migration.runtimeSha256' "$ready")"
jq -e --arg source "$source" --slurpfile ready "$ready" '
  .sourceCommit==$source and .status==$ready[0].migration.status
  and .pendingMigrationCount==$ready[0].migration.pendingMigrationCount
' "$classification" >/dev/null
jq -e --arg source "$source" --arg image "$(jq -er '.tools[]|select(.purpose=="migration-tool")|.image' "$passport")" '
  .schemaVersion==2 and .sourceCommit==$source and .migrationImage==$image
  and .taskRoleArn==null and .network.assignPublicIp=="DISABLED"
' "$runtime" >/dev/null

if [ "$(jq -r '.migration.clone==null' "$ready")" = false ]; then
  result="$(safe "$(jq -er '.migration.clone.resultPath' "$ready")" 1048576)"
  infrastructure="$(safe "$(jq -er '.migration.clone.infrastructurePath' "$ready")" 16777216)"
  test "$(sha_file "$result")" = "$(jq -er '.migration.clone.resultSha256' "$ready")"
  test "$(sha_file "$infrastructure")" = "$(jq -er '.migration.clone.infrastructureSha256' "$ready")"
  jq -e --arg source "$source" \
    --arg pendingHash "$(jq -er '.pendingCatalogHash' "$classification")" \
    --argjson pending "$(jq -er '.pendingMigrationCount' "$classification")" '
    .schemaVersion==2 and .sourceCommit==$source and .status=="PASSED"
    and .engine=="PostgreSQL" and .pendingCatalogHash==$pendingHash
    and (.pendingMigrations|length)==$pending
    and ([.pendingMigrations[].name])==([.executedMigrations[].name])
    and .schemaValidation.status=="PASSED" and .compatibility.status=="PASSED"
  ' "$result" >/dev/null
  jq -e --arg source "$source" --arg image "$(jq -er '.tools[]|select(.purpose=="migration-tool")|.image' "$passport")" '
    .migrationSourceCommit==$source and .migrationImage==$image
    and .rehearsalProfile=="readiness-v2"
    and .cleanup=={deleteRequestedAtEpoch:.cleanup.deleteRequestedAtEpoch,
      deleteCompletedAtEpoch:.cleanup.deleteCompletedAtEpoch,instanceAbsent:true,secretDeleted:true,
      taskStopped:true,residualResourceCount:0}
    and .cleanup.deleteRequestedAtEpoch>=1
    and .cleanup.deleteCompletedAtEpoch>=.cleanup.deleteRequestedAtEpoch
  ' "$infrastructure" >/dev/null
fi
printf '%s\n' "$source"
