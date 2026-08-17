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
artifact_sha="$(printf '8%.0s' {1..64})"
jq -cnS --arg source "$source" --arg artifact "$artifact_sha" '
  {schemaVersion:1,artifactKind:"LINE_AI_RELEASE_CANDIDATE",sourceCommit:$source,
   producerRunId:"7001",validationRunId:"7000",bindingStrategy:"isolated_runtime_pinned_endpoint",
   imageManifest:{path:"production-image-manifest.json",sha256:("9"*64),images:[]},
   agentCore:{artifactPath:"agentcore/agentcore.zip",artifactManifestPath:"agentcore/agentcore-artifact.json",
     artifactSha256:$artifact,sourceCommit:$source},
   contract:{path:"line-ai-contract.ts",sha256:("d"*64),runtimeContractVersion:1}}
' > "$work/line-ai-release-manifest.json"
jq -cnS --arg source "$source" --arg artifact "$artifact_sha" '
  {schemaVersion:1,environment:"production",sourceCommit:$source,
   executionRoleArn:"arn:aws:iam::311414082667:role/watchdog-bms-production-agentcore-candidate-execution-role",
   artifact:{sha256:$artifact,bucket:"watchdog-bms-agentcore-artifacts-311414082667",
     prefix:("agentcore/watchdog_orchestrator_production_candidate-"+$source+"-"+$artifact+".zip"),
     objectVersionId:"fixture-version-001"},
   runtime:{arn:"arn:aws:bedrock-agentcore:ap-southeast-1:311414082667:runtime/watchdog_orchestrator_production_candidate-AbCdEf1234",
     id:"watchdog_orchestrator_production_candidate-AbCdEf1234",version:"14",status:"READY"},
   endpoint:{arn:("arn:aws:bedrock-agentcore:ap-southeast-1:311414082667:runtime/watchdog_orchestrator_production_candidate-AbCdEf1234/runtime-endpoint/candidate_production_"+($source[0:12])+"_"+($artifact[0:8])),
     name:("candidate_production_"+($source[0:12])+"_"+($artifact[0:8])),version:"14",status:"READY"},
   bindingStrategy:"isolated_runtime_pinned_endpoint",configurationSha256:("e"*64),contractVersion:1}
' > "$work/agentcore-production-binding.json"
jq -cnS --arg source "$source" --argjson expires "$((now+86400))" \
  --arg lineManifest "$(sha_file "$work/line-ai-release-manifest.json")" '
 {sourceCommit:$source,expiresAtEpoch:$expires,
  lineAiCandidate:{manifestSha256:$lineManifest},tools:[{purpose:"migration-tool",
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
   taskDefinitionArn:("arn:aws:ecs:ap-southeast-1:311414082667:task-definition/"+$service+":1"),
   lineAiBinding:(if $service=="ai-gateway" then
     {runtime:"agentcore",runtimeArn:"arn:aws:bedrock-agentcore:ap-southeast-1:311414082667:runtime/watchdog_orchestrator-6xOx1tCbz0",qualifier:"DEFAULT",
      expectedSourceCommit:$source,expectedArtifactSha256:("f"*64),expectedContractVersion:"1"}
     else null end)})' > "$services"
jq -cnS --slurpfile services "$services" '
 {status:"PASS",services:($services[0]|map(. as $s|{service:$s.service,
   servingMode:$s.servingMode,serviceRevisionArn:$s.serviceRevisionArn,taskDefinition:{arn:$s.taskDefinitionArn},
   rawEvidence:{describeExpressGatewayService:{raw:{second:{service:{activeConfigurations:[{
     primaryContainer:{image:$s.image,environment:([{name:"GIT_SHA",value:$s.sourceCommit},
       {name:"PRODUCTION_SERVING_MODE",value:$s.servingMode}]
       +(if $s.service=="ai-gateway" then [
         {name:"LINE_AI_AGENT_RUNTIME",value:$s.lineAiBinding.runtime},
         {name:"AGENTCORE_RUNTIME_ARN",value:$s.lineAiBinding.runtimeArn},
         {name:"AGENTCORE_RUNTIME_QUALIFIER",value:$s.lineAiBinding.qualifier},
         {name:"AGENTCORE_EXPECTED_SOURCE_COMMIT",value:$s.lineAiBinding.expectedSourceCommit},
         {name:"AGENTCORE_EXPECTED_ARTIFACT_SHA256",value:$s.lineAiBinding.expectedArtifactSha256},
         {name:"AGENTCORE_EXPECTED_CONTRACT_VERSION",value:$s.lineAiBinding.expectedContractVersion}] else [] end))}}]}}}}}}))}' > "$work/production-health.json"
jq -cnS --argjson now "$now" '
 {schemaVersion:2,observedAtEpoch:$now,a5PolicySha256:("5"*64),clonePolicySha256:null,
  promotionPrerequisitesSha256:("6"*64),securityPolicySha256:("7"*64),
  rds:{status:"available",storageEncrypted:true,multiAZ:true,
    deletionProtection:true,backupRetentionDays:35},redis:{status:"available",atRestEncryptionEnabled:true,
    transitEncryptionEnabled:true,authTokenEnabled:true,automaticFailover:"enabled",nodeCount:2,
    snapshotRetentionDays:35}}
' > "$work/production-runtime.json"
lifecycle_sha="$(jq -cS '{Rules:(.Rules|sort_by(.ID))}' \
  "$root/infra/object-storage-lifecycle.json" | sha_stream)"
api=https://wa-11111111111111111111111111111111.ecs.ap-southeast-1.on.aws
ai=https://wa-22222222222222222222222222222222.ecs.ap-southeast-1.on.aws
workers=https://wa-33333333333333333333333333333333.ecs.ap-southeast-1.on.aws
jq -cnS --arg lifecycle "$lifecycle_sha" --arg api "$api" --arg ai "$ai" \
  --arg workers "$workers" --slurpfile binding "$work/agentcore-production-binding.json" '
  def names:[
    "AWSServiceRoleForApplicationAutoScaling_ECSService","AWSServiceRoleForECS",
    "AWSServiceRoleForElastiCache","AWSServiceRoleForElasticLoadBalancing","AWSServiceRoleForRDS",
    "ecsInfrastructureRoleForExpressServices","ecsTaskExecutionRole",
    "watchdog-bms-agentcore-execution-role",
    "watchdog-bms-deploy-production","watchdog-bms-ecs-express-ai-gateway-role",
    "watchdog-bms-ecs-express-api-role","watchdog-bms-ecs-express-workers-role",
    "watchdog-bms-production-a5-apply-execution","watchdog-bms-production-a5-bootstrap-execution",
    "watchdog-bms-production-a5-clone","watchdog-bms-production-a5-clone-execution",
    "watchdog-bms-production-a5-reader-bootstrap","watchdog-bms-production-a5-readonly",
    "watchdog-bms-production-a5-readonly-execution",
    "watchdog-bms-production-agentcore-candidate-execution-role",
    "watchdog-bms-production-security-readonly",
    "watchdog-bms-release-task-role"];
  def role_arn($name):
    if $name=="AWSServiceRoleForApplicationAutoScaling_ECSService" then
      "arn:aws:iam::311414082667:role/aws-service-role/ecs.application-autoscaling.amazonaws.com/"+$name
    elif $name=="AWSServiceRoleForECS" then
      "arn:aws:iam::311414082667:role/aws-service-role/ecs.amazonaws.com/"+$name
    elif $name=="AWSServiceRoleForElastiCache" then
      "arn:aws:iam::311414082667:role/aws-service-role/elasticache.amazonaws.com/"+$name
    elif $name=="AWSServiceRoleForElasticLoadBalancing" then
      "arn:aws:iam::311414082667:role/aws-service-role/elasticloadbalancing.amazonaws.com/"+$name
    elif $name=="AWSServiceRoleForRDS" then
      "arn:aws:iam::311414082667:role/aws-service-role/rds.amazonaws.com/"+$name
    else "arn:aws:iam::311414082667:role/"+$name end;
  def inline($name):
    if $name=="watchdog-bms-production-a5-bootstrap-execution" then null
    elif $name=="watchdog-bms-agentcore-execution-role"
      or $name=="watchdog-bms-production-agentcore-candidate-execution-role"
      then "watchdog-bms-agentcore-permissions"
    elif $name=="watchdog-bms-deploy-production" then "watchdog-bms-production-deploy"
    elif $name=="ecsTaskExecutionRole" then "watchdog-bms-ecs-execution-secrets"
    elif $name=="watchdog-bms-release-task-role" then "watchdog-bms-release-task-ecs-read"
    elif $name=="watchdog-bms-ecs-express-api-role" then "watchdog-bms-prod-api-runtime"
    elif $name=="watchdog-bms-ecs-express-ai-gateway-role" then "watchdog-bms-ai-gateway-runtime"
    elif $name=="watchdog-bms-ecs-express-workers-role" then
      "watchdog-bms-prod-workers-object-version-cleanup"
    elif $name=="watchdog-bms-production-security-readonly"
      or ($name|startswith("watchdog-bms-production-a5-")) then $name
    else null end;
  def attached($name):
    if $name=="ecsInfrastructureRoleForExpressServices" then
      ["arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices"]
    elif $name=="ecsTaskExecutionRole" then
      ["arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"]
    elif $name=="AWSServiceRoleForApplicationAutoScaling_ECSService" then
      ["arn:aws:iam::aws:policy/aws-service-role/AWSApplicationAutoscalingECSServicePolicy"]
    elif $name=="AWSServiceRoleForECS" then
      ["arn:aws:iam::aws:policy/aws-service-role/AmazonECSServiceRolePolicy"]
    elif $name=="AWSServiceRoleForElastiCache" then
      ["arn:aws:iam::aws:policy/aws-service-role/ElastiCacheServiceRolePolicy"]
    elif $name=="AWSServiceRoleForElasticLoadBalancing" then
      ["arn:aws:iam::aws:policy/aws-service-role/AWSElasticLoadBalancingServiceRolePolicy"]
    elif $name=="AWSServiceRoleForRDS" then
      ["arn:aws:iam::aws:policy/aws-service-role/AmazonRDSServiceRolePolicy"]
    else [] end;
  def required_secrets:["ai-actor-delegation-signing-key","ai-gateway-internal-secret",
    "credential-encryption-key","database-url","line-login-channel-secret",
    "line-messaging-channel-access-token","line-messaging-channel-secret",
    "pdpa-pseudonymization-key","pdpa-pseudonymization-previous-keys","redis-url",
    "watchdog-jwt-secret","worker-internal-token"];
  def secret($short;$required):
    ("watchdog-bms/production/"+$short) as $name
    |{name:$name,arn:("arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:"+$name+"-aaaaaa"),
      required:$required,hasCurrentVersion:true,kms:{usesDefaultAwsManagedKey:true,keyArn:null,
        keyManager:"AWS",keyState:"Enabled"}};
  def parameter($name;$value):
    {name:("/watchdog-bms/production/"+$name),type:"String",value:$value,version:1};
  {schemaVersion:1,
   deployRoleArn:"arn:aws:iam::311414082667:role/watchdog-bms-deploy-production",
   github:{allConfigured:true,requiredSecrets:["PRODUCTION_POLICY_READ_TOKEN"],
     requiredVariableValuesSha256:("1"*64),requiredVariables:["AWS_DEPLOY_ROLE_ARN",
       "PUBLIC_DOMAIN_URL","WORKFLOW_WEBHOOK_ALLOWED_HOSTS","CLAMAV_HOST","LOG_KMS_KEY_ID",
       "SECURITY_ALERT_TOPIC_ARN","LINE_LOGIN_CHANNEL_ID","LINE_LIFF_ID",
       "LINE_MESSAGING_CHANNEL_ID","LINE_AI_AGENT_RUNTIME","AGENTCORE_REGION"],valuesExposed:false},
   roles:(names|map(. as $name|{roleName:$name,roleArn:role_arn($name),
     state:(if $name=="watchdog-bms-production-a5-bootstrap-execution" then "ABSENT"
       elif $name=="watchdog-bms-production-a5-reader-bootstrap" then "REVOKED" else "READY" end),
     maxSessionDuration:(if $name=="watchdog-bms-production-a5-bootstrap-execution" then null
       elif ($name|startswith("watchdog-bms-production-a5-")) or $name=="watchdog-bms-deploy-production"
       then 7200 else 3600 end),inlinePolicyName:inline($name),
     trustSha256:(if $name=="watchdog-bms-production-a5-bootstrap-execution" then null else "2"*64 end),
     policySha256:(if inline($name)==null then null else "3"*64 end),
     attachedPolicies:attached($name)})),
   resources:{secrets:((required_secrets|map(secret(.;true)))
       +[secret("typhoon-ocr-api-key";false)]|sort_by(.name)),
     typhoon:{enabled:true,configurationSha256:("3"*64)},
     parameters:([parameter("ai-gateway-internal-url";$ai+"/v1"),
       parameter("ecs-express-ai-gateway-service-arn";
         "arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-ai-gateway-v2"),
       parameter("ecs-express-ai-gateway-url";$ai),
       parameter("ecs-express-api-web-service-arn";
         "arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-api-web-pub"),
       parameter("ecs-express-api-web-url";$api),
       parameter("ecs-express-workers-service-arn";
         "arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-workers"),
       parameter("ecs-express-workers-url";$workers),parameter("erp-core-internal-url";$api+"/v1"),
       parameter("s3-bucket";"watchdog-bms-prod-311414082667")]|sort_by(.name)),
     ecs:{clusterArn:"arn:aws:ecs:ap-southeast-1:311414082667:cluster/watchdog-bms-prod",status:"ACTIVE"},
     network:{defaultVpcId:"vpc-0123456789abcdef0",
       publicSubnetIds:["subnet-0123456789abcdef0","subnet-1123456789abcdef0"],
       securityGroups:[{name:"watchdog-bms-prod-ai-egress-sg",id:"sg-0123456789abcdef0"},
         {name:"watchdog-bms-prod-app-egress-sg",id:"sg-1123456789abcdef0"}]},
     s3:{bucket:"watchdog-bms-prod-311414082667",region:"ap-southeast-1",
       versioning:"Enabled",lifecycleSha256:$lifecycle},
     monitoring:{logGroups:["/ecs/watchdog-bms-prod-ai-gateway","/ecs/watchdog-bms-prod-api-web",
       "/ecs/watchdog-bms-prod-workers"],retentionDays:14,
       kmsKeyArn:"arn:aws:kms:ap-southeast-1:311414082667:key/11111111-1111-1111-1111-111111111111",
       alertTopicArn:"arn:aws:sns:ap-southeast-1:311414082667:watchdog-alerts"},
     rdsCapacity:{engine:"postgres",engineVersion:"18.3",dbInstanceClass:"db.t4g.medium",
       orderableOptionCount:1,quotaName:"DBInstances",quotaMax:40,quotaUsed:2,quotaHeadroom:38,
       sourceDbSubnetGroup:"watchdog-bms-prod-db-subnets",
       sourceDbParameterGroup:"watchdog-bms-prod-pg18",sourceDbOptionGroup:"default:postgres-18",
       recentEncryptedAutomatedSnapshotAvailable:true,snapshotMaxAgeSeconds:129600,
       recentAutomatedSnapshotArn:"arn:aws:rds:ap-southeast-1:311414082667:snapshot:rds:watchdog-bms-prod-db-2026-08-12-00-00",
       recentAutomatedSnapshotCreateTime:"2026-08-12T00:00:00.000+00:00",
       recentAutomatedSnapshotAgeSeconds:3600,
       snapshotKmsKeyArn:"arn:aws:kms:ap-southeast-1:311414082667:key/52b4943e-e9d7-4fae-b71c-c13b0b157b27",
       managedSecretKmsKeyArn:"arn:aws:kms:ap-southeast-1:311414082667:key/b2e68e7f-e098-4b88-a92a-5a0f4fe2924a"},
     agentCore:{runtimeArn:$binding[0].runtime.arn,
       runtimeId:$binding[0].runtime.id,runtimeVersion:$binding[0].runtime.version,status:"READY",
       networkMode:"PUBLIC",artifactRuntime:"NODE_22",serverProtocol:"HTTP",appEnv:"production",
       deployEnvironment:"production",requireMMDSV2:true,
       executionRoleArn:$binding[0].executionRoleArn,gitSha:$binding[0].sourceCommit,
       artifactSha256:$binding[0].artifact.sha256,artifactBucket:$binding[0].artifact.bucket,
       artifactPrefix:$binding[0].artifact.prefix,artifactVersionId:$binding[0].artifact.objectVersionId,
       entryPoint:["runtime.js"],endpointArn:$binding[0].endpoint.arn,
       endpointName:$binding[0].endpoint.name,endpointStatus:"READY",
       endpointVersion:$binding[0].endpoint.version,bindingStrategy:$binding[0].bindingStrategy,
       configurationSha256:$binding[0].configurationSha256,contractVersion:$binding[0].contractVersion}}}
' > "$work/promotion-prerequisites.json"
jq -cS --arg hash "$(sha_file "$work/promotion-prerequisites.json")" \
  '.promotionPrerequisitesSha256=$hash' "$work/production-runtime.json" \
  > "$work/production-runtime.tmp"
mv "$work/production-runtime.tmp" "$work/production-runtime.json"
passport_hash="$(sha_file "$work/passport.json")"
jq -cnS --arg source "$source" --arg controller "$controller" --arg passport "$passport_hash" \
  --arg health "$(sha_file "$work/production-health.json")" \
  --arg catalog "$(sha_file "$work/catalog-result.json")" \
  --arg runtime "$(sha_file "$work/catalog-runtime.json")" --slurpfile services "$services" \
  --arg runtimeBaseline "$(sha_file "$work/production-runtime.json")" \
  --arg lineManifest "$(sha_file "$work/line-ai-release-manifest.json")" \
  --arg candidateBinding "$(sha_file "$work/agentcore-production-binding.json")" \
  --argjson issued "$((now-60))" --argjson expires "$((now-60+86400))" '
  {schemaVersion:2,artifactKind:"PRODUCTION_RELEASE_READY_V2",environment:"production",
   repository:"example/watchdog",workflow:{path:".github/workflows/production-readiness.yml",runId:"9001",
    runAttempt:1,controllerRef:"refs/heads/main",controllerCommit:$controller},sourceCommit:$source,
   passportRef:{runId:"8001",runAttempt:2,contentSha256:$passport,expiresAtEpoch:($expires+60)},
   serving:{requestedMode:"maintenance_closed",effectiveTarget:"all"},
   legal:{mode:"NOT_APPLICABLE",ownerApprovalRef:null,approvedBy:null},
   aws:{accountId:"311414082667",region:"ap-southeast-1"},issuedAtEpoch:$issued,expiresAtEpoch:$expires,
   productionBaseline:{path:"production-health.json",sha256:$health,services:$services[0]},
   runtimeBaseline:{path:"production-runtime.json",sha256:$runtimeBaseline},
   lineAiCandidate:{releaseManifestPath:"line-ai-release-manifest.json",releaseManifestSha256:$lineManifest,
     bindingPath:"agentcore-production-binding.json",bindingSha256:$candidateBinding},
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
reject changed-previous-agentcore '.productionBaseline.services[]|select(.service=="ai-gateway")|.lineAiBinding.qualifier="candidate_production_ffffffffffff"'
reject missing-clone '.migration.status="APPEND_ONLY_PENDING"|.migration.pendingMigrationCount=1'
reject failed-check '.checks.a5Reader="FAIL"'
reject closed-owner-override '.legal={mode:"OWNER_OVERRIDE",ownerApprovalRef:"BOARD-2026-08-15",approvedBy:"MangmeeDev"}|.checks.legalMode="OWNER_OVERRIDE"'

reject_prerequisite() {
  local name="$1" filter="$2" original_hash mutated_hash
  cp "$work/promotion-prerequisites.json" "$work/promotion-prerequisites.valid.json"
  jq -cS "$filter" "$work/promotion-prerequisites.valid.json" > "$work/promotion-prerequisites.json"
  mutated_hash="$(sha_file "$work/promotion-prerequisites.json")"
  jq -cS --arg hash "$mutated_hash" '.promotionPrerequisitesSha256=$hash' \
    "$work/production-runtime.json" > "$work/production-runtime.mutated.json"
  mv "$work/production-runtime.mutated.json" "$work/production-runtime.json"
  rewrite '.runtimeBaseline.sha256=$runtime' "$work/$name-ready.json" \
    --arg runtime "$(sha_file "$work/production-runtime.json")"
  if bash "$validator" "$work/$name-ready.json" "$work" "$work/passport.json" "$source" \
      8001 2 9001 1 "$controller" example/watchdog "$now" >/dev/null 2>&1; then
    echo "ERROR: READY validator accepted $name prerequisite" >&2; exit 1
  fi
  mv "$work/promotion-prerequisites.valid.json" "$work/promotion-prerequisites.json"
  original_hash="$(sha_file "$work/promotion-prerequisites.json")"
  jq -cS --arg hash "$original_hash" '.promotionPrerequisitesSha256=$hash' \
    "$work/production-runtime.json" > "$work/production-runtime.restored.json"
  mv "$work/production-runtime.restored.json" "$work/production-runtime.json"
}
rewrite() {
  local filter="$1" output="$2" body="$work/rewrite-body.json" digest
  shift 2
  jq -cS "$@" "$filter|del(.contentSha256)" "$work/ready.json" > "$body"
  digest="$(jq -cjS . "$body"|sha_stream)"
  jq -cS --arg hash "$digest" '.+{contentSha256:$hash}' "$body" > "$output"
}
reject_prerequisite missing-rds-capacity 'del(.resources.rdsCapacity)'
reject_prerequisite no-rds-headroom '.resources.rdsCapacity.quotaHeadroom=0'
reject_prerequisite string-rds-count '.resources.rdsCapacity.orderableOptionCount="1"'
reject_prerequisite inconsistent-rds-arithmetic '.resources.rdsCapacity.quotaHeadroom=37'
reject_prerequisite wrong-source-db-version '.resources.rdsCapacity.engineVersion="18.2"'
reject_prerequisite stale-snapshot '.resources.rdsCapacity.recentAutomatedSnapshotAgeSeconds=129601'
reject_prerequisite wrong-snapshot-kms '.resources.rdsCapacity.snapshotKmsKeyArn|="wrong"'
reject_prerequisite wrong-secret-kms '.resources.rdsCapacity.managedSecretKmsKeyArn|="wrong"'
reject_prerequisite stale-agentcore '.resources.agentCore.status="UPDATING"'
reject_prerequisite wrong-agentcore-environment '.resources.agentCore.deployEnvironment="uat"'
reject_prerequisite agentcore-mmds-disabled '.resources.agentCore.requireMMDSV2=false'
reject_prerequisite wrong-agentcore-role '.resources.agentCore.executionRoleArn|="wrong"'
reject_prerequisite wrong-agentcore-source '.resources.agentCore.gitSha=("f"*40)'
reject_prerequisite mutable-agentcore-artifact '.resources.agentCore.artifactVersionId=""'
reject_prerequisite wrong-agentcore-entry '.resources.agentCore.entryPoint=["other.js"]'
reject_prerequisite typhoon-secret-while-disabled '.resources.typhoon={enabled:false,configurationSha256:null}'
reject_prerequisite typhoon-secret-missing-while-enabled \
  '.resources.secrets|=map(select(.name!="watchdog-bms/production/typhoon-ocr-api-key"))'
reject_prerequisite wrong-parameter-value \
  '(.resources.parameters[]|select(.name|endswith("s3-bucket"))).value="wrong"'
reject_prerequisite wrong-security-group '.resources.network.securityGroups[0].name="wrong"'
reject_prerequisite wrong-lifecycle '.resources.s3.lifecycleSha256=("f"*64)'
reject_prerequisite wrong-role-arn '.roles[0].roleArn="arn:aws:iam::311414082667:role/wrong"'
reject_prerequisite hidden-role-boundary \
  '(.roles[]|select(.roleName=="watchdog-bms-agentcore-execution-role")).permissionsBoundary
    ="arn:aws:iam::aws:policy/ReadOnlyAccess"'
reject_prerequisite missing-rds-service-role \
  '.roles|=map(select(.roleName!="AWSServiceRoleForRDS"))'

cp "$work/promotion-prerequisites.json" "$work/promotion-prerequisites.typhoon-enabled.json"
jq -cS '.resources.typhoon={enabled:false,configurationSha256:null}
  |.resources.secrets|=map(select(.name!="watchdog-bms/production/typhoon-ocr-api-key"))' \
  "$work/promotion-prerequisites.json" > "$work/promotion-prerequisites.typhoon-disabled.json"
mv "$work/promotion-prerequisites.typhoon-disabled.json" "$work/promotion-prerequisites.json"
jq -cS --arg hash "$(sha_file "$work/promotion-prerequisites.json")" \
  '.promotionPrerequisitesSha256=$hash' "$work/production-runtime.json" \
  > "$work/production-runtime.typhoon-disabled.json"
mv "$work/production-runtime.typhoon-disabled.json" "$work/production-runtime.json"
rewrite '.runtimeBaseline.sha256=$runtime' "$work/typhoon-disabled-ready.json" \
  --arg runtime "$(sha_file "$work/production-runtime.json")"
bash "$validator" "$work/typhoon-disabled-ready.json" "$work" "$work/passport.json" "$source" \
  8001 2 9001 1 "$controller" example/watchdog "$now" >/dev/null
mv "$work/promotion-prerequisites.typhoon-enabled.json" "$work/promotion-prerequisites.json"
jq -cS --arg hash "$(sha_file "$work/promotion-prerequisites.json")" \
  '.promotionPrerequisitesSha256=$hash' "$work/production-runtime.json" \
  > "$work/production-runtime.typhoon-restored.json"
mv "$work/production-runtime.typhoon-restored.json" "$work/production-runtime.json"

cp "$work/production-health.json" "$work/production-health-closed.json"
jq -cS '(.services[].rawEvidence.describeExpressGatewayService.raw.second.service
  .activeConfigurations[0].primaryContainer.environment[]
  |select(.name=="PRODUCTION_SERVING_MODE")|.value)="live"
  |.services[].servingMode="live"' \
  "$work/production-health.json" > "$work/production-health-live.json"
mv "$work/production-health-live.json" "$work/production-health.json"
rewrite '.serving={requestedMode:"live",effectiveTarget:"api-web"}
  |.legal={mode:"VERIFIED_BUNDLE",ownerApprovalRef:null,approvedBy:null}
  |.productionBaseline.sha256=$health
  |.productionBaseline.services|=map(.servingMode="live")' "$work/live-selective.json" \
  --arg health "$(sha_file "$work/production-health.json")"
bash "$validator" "$work/live-selective.json" "$work" "$work/passport.json" "$source" 8001 2 9001 1 \
  "$controller" example/watchdog "$now" >/dev/null
rewrite '.serving={requestedMode:"live",effectiveTarget:"api-web"}
  |.legal={mode:"OWNER_OVERRIDE",ownerApprovalRef:"BOARD-2026-08-15",approvedBy:"MangmeeDev"}
  |.checks.legalMode="OWNER_OVERRIDE"
  |.productionBaseline.sha256=$health
  |.productionBaseline.services|=map(.servingMode="live")' "$work/live-owner-override.json" \
  --arg health "$(sha_file "$work/production-health.json")"
bash "$validator" "$work/live-owner-override.json" "$work" "$work/passport.json" "$source" \
  8001 2 9001 1 "$controller" example/watchdog "$now" >/dev/null
rewrite '.serving={requestedMode:"live",effectiveTarget:"api-web"}
  |.legal={mode:"OWNER_OVERRIDE",ownerApprovalRef:"BOARD-2026-08-15",approvedBy:"other"}
  |.checks.legalMode="OWNER_OVERRIDE"
  |.productionBaseline.sha256=$health
  |.productionBaseline.services|=map(.servingMode="live")' "$work/live-owner-override-wrong-actor.json" \
  --arg health "$(sha_file "$work/production-health.json")"
if bash "$validator" "$work/live-owner-override-wrong-actor.json" "$work" \
    "$work/passport.json" "$source" 8001 2 9001 1 "$controller" example/watchdog "$now" \
    >/dev/null 2>&1; then
  echo 'ERROR: READY validator accepted a foreign owner override' >&2; exit 1
fi
rewrite '.serving={requestedMode:"live",effectiveTarget:"api-web"}
  |.legal={mode:"OWNER_OVERRIDE",ownerApprovalRef:"short",approvedBy:"MangmeeDev"}
  |.checks.legalMode="OWNER_OVERRIDE"
  |.productionBaseline.sha256=$health
  |.productionBaseline.services|=map(.servingMode="live")' "$work/live-owner-override-bad-ref.json" \
  --arg health "$(sha_file "$work/production-health.json")"
if bash "$validator" "$work/live-owner-override-bad-ref.json" "$work" \
    "$work/passport.json" "$source" 8001 2 9001 1 "$controller" example/watchdog "$now" \
    >/dev/null 2>&1; then
  echo 'ERROR: READY validator accepted an invalid owner override reference' >&2; exit 1
fi
mv "$work/production-health-closed.json" "$work/production-health.json"
rewrite '.serving.effectiveTarget="api-web"' "$work/closed-selective.json"
if bash "$validator" "$work/closed-selective.json" "$work" "$work/passport.json" "$source" \
    8001 2 9001 1 "$controller" example/watchdog "$now" >/dev/null 2>&1; then
  echo 'ERROR: READY validator accepted selective maintenance closure' >&2; exit 1
fi
rewrite '.serving={requestedMode:"live",effectiveTarget:"api-web"}
  |.legal={mode:"VERIFIED_BUNDLE",ownerApprovalRef:null,approvedBy:null}
  |.productionBaseline.services|=map(.servingMode="live")
  |.productionBaseline.services[0].sourceCommit=("f"*40)' "$work/split-selective.json"
if bash "$validator" "$work/split-selective.json" "$work" "$work/passport.json" "$source" \
    8001 2 9001 1 "$controller" example/watchdog "$now" >/dev/null 2>&1; then
  echo 'ERROR: READY validator accepted a selective split baseline' >&2; exit 1
fi

# Execute the pending-migration branch against the exact fresh-snapshot cleanup contract.
jq -cS '.status="APPEND_ONLY_PENDING"|.appliedMigrationCount=0|.pendingMigrationCount=1' \
  "$work/catalog-result.json" > "$work/catalog-pending.json"
mv "$work/catalog-pending.json" "$work/catalog-result.json"
jq -cnS --arg source "$source" '
  {schemaVersion:2,sourceCommit:$source,status:"PASSED",engine:"PostgreSQL",
   pendingCatalogHash:("3"*64),pendingMigrations:[{name:"20260815120000_dashboard_scope_branch"}],
   executedMigrations:[{name:"20260815120000_dashboard_scope_branch"}],
   schemaValidation:{status:"PASSED"},compatibility:{status:"PASSED"}}
' > "$work/clone-result.json"
temporary=watchdog-a5-clone-9001-a1-aaaaaaaa
jq -cnS --arg source "$source" --arg temporary "$temporary" \
  --arg image "$(jq -r '.tools[0].image' "$work/passport.json")" '
  {migrationSourceCommit:$source,migrationImage:$image,rehearsalProfile:"readiness-v2",
   temporaryDbIdentifier:$temporary,snapshotType:"manual",
   snapshotArn:("arn:aws:rds:ap-southeast-1:311414082667:snapshot:"+$temporary+"-source"),
   cleanup:{deleteRequestedAtEpoch:1,deleteCompletedAtEpoch:2,instanceAbsent:true,
     secretDeleted:true,snapshotDeleted:true,taskStopped:true,residualResourceCount:0}}
' > "$work/clone-infrastructure.json"
jq -cS '.clonePolicySha256=("8"*64)' "$work/production-runtime.json" \
  > "$work/production-runtime.pending.json"
mv "$work/production-runtime.pending.json" "$work/production-runtime.json"
make_clone_ready() {
  local output="$1" infrastructure_hash="$2"
  rewrite '.runtimeBaseline.sha256=$runtime
    |.migration={classificationPath:"catalog-result.json",classificationSha256:$catalog,
      runtimePath:"catalog-runtime.json",runtimeSha256:$catalogRuntime,
      status:"APPEND_ONLY_PENDING",pendingMigrationCount:1,
      clone:{resultPath:"clone-result.json",resultSha256:$result,
        infrastructurePath:"clone-infrastructure.json",infrastructureSha256:$infrastructure}}' \
    "$output" --arg runtime "$(sha_file "$work/production-runtime.json")" \
    --arg catalog "$(sha_file "$work/catalog-result.json")" \
    --arg catalogRuntime "$(sha_file "$work/catalog-runtime.json")" \
    --arg result "$(sha_file "$work/clone-result.json")" \
    --arg infrastructure "$infrastructure_hash"
}
make_clone_ready "$work/pending-ready.json" "$(sha_file "$work/clone-infrastructure.json")"
bash "$validator" "$work/pending-ready.json" "$work" "$work/passport.json" "$source" \
  8001 2 9001 1 "$controller" example/watchdog "$now" >/dev/null

for mutation in automated-snapshot retained-snapshot; do
  cp "$work/clone-infrastructure.json" "$work/clone-infrastructure.valid.json"
  case "$mutation" in
    automated-snapshot) jq -cS '.snapshotType="automated"' \
      "$work/clone-infrastructure.valid.json" > "$work/clone-infrastructure.json" ;;
    retained-snapshot) jq -cS '.cleanup.snapshotDeleted=false' \
      "$work/clone-infrastructure.valid.json" > "$work/clone-infrastructure.json" ;;
  esac
  make_clone_ready "$work/$mutation-ready.json" "$(sha_file "$work/clone-infrastructure.json")"
  if bash "$validator" "$work/$mutation-ready.json" "$work" "$work/passport.json" "$source" \
      8001 2 9001 1 "$controller" example/watchdog "$now" >/dev/null 2>&1; then
    echo "ERROR: READY validator accepted $mutation clone evidence" >&2; exit 1
  fi
  mv "$work/clone-infrastructure.valid.json" "$work/clone-infrastructure.json"
done
bash -n "$validator"
echo 'production release READY V2 contract: PASS'
