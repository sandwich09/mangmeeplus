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
controller_root="$(cd "$(dirname "$0")/../.." && pwd -P)"

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
  def exact($wanted):(keys|sort)==($wanted|sort);
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
    | {service:$s.service,image:$a.primaryContainer.image,sourceCommit:$source[0],
       servingMode:$s.servingMode,serviceRevisionArn:$s.serviceRevisionArn,
       taskDefinitionArn:$s.taskDefinition.arn}] | sort_by(.service))
    == ($ready[0].productionBaseline.services|sort_by(.service))
' "$health" >/dev/null

runtime_baseline="$(safe "$(jq -er '.runtimeBaseline.path' "$ready")" 1048576)"
test "$(sha_file "$runtime_baseline")" = "$(jq -er '.runtimeBaseline.sha256' "$ready")"
jq -e --slurpfile ready "$ready" '
  (keys|sort)==(["a5PolicySha256","clonePolicySha256","observedAtEpoch",
    "promotionPrerequisitesSha256","rds","redis","schemaVersion","securityPolicySha256"]|sort)
  and .schemaVersion==2
  and (.observedAtEpoch|type)=="number" and .observedAtEpoch>=1
  and (.rds.status=="available" and .rds.storageEncrypted==true and .rds.multiAZ==true
    and .rds.deletionProtection==true and .rds.backupRetentionDays>=35)
  and (.redis.status=="available" and .redis.atRestEncryptionEnabled==true
    and .redis.transitEncryptionEnabled==true and .redis.authTokenEnabled==true
    and .redis.automaticFailover=="enabled" and .redis.nodeCount>=2
    and .redis.snapshotRetentionDays>=35)
  and all(.a5PolicySha256,.promotionPrerequisitesSha256,.securityPolicySha256;
    type=="string" and test("^[0-9a-f]{64}$"))
  and ((.clonePolicySha256==null and $ready[0].migration.status=="EXACT_MATCH")
    or ((.clonePolicySha256|type)=="string" and (.clonePolicySha256|test("^[0-9a-f]{64}$"))))
' "$runtime_baseline" >/dev/null
promotion_prerequisites="$(safe "promotion-prerequisites.json" 1048576)"
test "$(sha_file "$promotion_prerequisites")" = \
  "$(jq -er '.promotionPrerequisitesSha256' "$runtime_baseline")"
expected_lifecycle_sha="$(jq -cS '{Rules:(.Rules|sort_by(.ID))}' \
  "$controller_root/infra/object-storage-lifecycle.json" | sha_stream)"
jq -e --arg lifecycle "$expected_lifecycle_sha" '
  def exact($wanted):(keys|sort)==($wanted|sort);
  def hash:type=="string" and test("^[0-9a-f]{64}$");
  def integer:type=="number" and floor==.;
  def required_secret_names:[
    "watchdog-bms/production/ai-actor-delegation-signing-key",
    "watchdog-bms/production/ai-gateway-internal-secret",
    "watchdog-bms/production/credential-encryption-key",
    "watchdog-bms/production/database-url",
    "watchdog-bms/production/line-login-channel-secret",
    "watchdog-bms/production/line-messaging-channel-access-token",
    "watchdog-bms/production/line-messaging-channel-secret",
    "watchdog-bms/production/pdpa-pseudonymization-key",
    "watchdog-bms/production/pdpa-pseudonymization-previous-keys",
    "watchdog-bms/production/redis-url",
    "watchdog-bms/production/watchdog-jwt-secret",
    "watchdog-bms/production/worker-internal-token"];
  def parameter_names:[
    "/watchdog-bms/production/ai-gateway-internal-url",
    "/watchdog-bms/production/ecs-express-ai-gateway-service-arn",
    "/watchdog-bms/production/ecs-express-ai-gateway-url",
    "/watchdog-bms/production/ecs-express-api-web-service-arn",
    "/watchdog-bms/production/ecs-express-api-web-url",
    "/watchdog-bms/production/ecs-express-workers-service-arn",
    "/watchdog-bms/production/ecs-express-workers-url",
    "/watchdog-bms/production/erp-core-internal-url",
    "/watchdog-bms/production/s3-bucket"];
  def p($parameters;$suffix):
    [$parameters[]|select(.name==("/watchdog-bms/production/"+$suffix))|.value][0];
  def role_names:[
    "AWSServiceRoleForApplicationAutoScaling_ECSService","AWSServiceRoleForECS",
    "AWSServiceRoleForElastiCache","AWSServiceRoleForElasticLoadBalancing","AWSServiceRoleForRDS",
    "ecsInfrastructureRoleForExpressServices","ecsTaskExecutionRole",
    "watchdog-bms-agentcore-execution-role",
    "watchdog-bms-deploy-production","watchdog-bms-ecs-express-ai-gateway-role",
    "watchdog-bms-ecs-express-api-role","watchdog-bms-ecs-express-workers-role",
    "watchdog-bms-production-a5-apply-execution","watchdog-bms-production-a5-bootstrap-execution",
    "watchdog-bms-production-a5-clone","watchdog-bms-production-a5-clone-execution",
    "watchdog-bms-production-a5-reader-bootstrap","watchdog-bms-production-a5-readonly",
    "watchdog-bms-production-a5-readonly-execution","watchdog-bms-production-security-readonly",
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
  def role_state($name):
    if $name=="watchdog-bms-production-a5-bootstrap-execution" then "ABSENT"
    elif $name=="watchdog-bms-production-a5-reader-bootstrap" then "REVOKED"
    else "READY" end;
  def role_max($name):
    if $name=="watchdog-bms-production-a5-bootstrap-execution" then null
    elif $name=="watchdog-bms-deploy-production"
      or ($name|startswith("watchdog-bms-production-a5-")) then 7200
    else 3600 end;
  def inline_name($name):
    if $name=="watchdog-bms-production-a5-bootstrap-execution" then null
    elif $name=="watchdog-bms-agentcore-execution-role" then "watchdog-bms-agentcore-permissions"
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
  exact(["deployRoleArn","github","resources","roles","schemaVersion"])
  and .schemaVersion==1
  and .deployRoleArn=="arn:aws:iam::311414082667:role/watchdog-bms-deploy-production"
  and (.github|exact(["allConfigured","requiredSecrets","requiredVariableValuesSha256",
      "requiredVariables","valuesExposed"])
    and .allConfigured==true and .valuesExposed==false
    and .requiredSecrets==["PRODUCTION_POLICY_READ_TOKEN"]
    and .requiredVariables==["AWS_DEPLOY_ROLE_ARN","PUBLIC_DOMAIN_URL",
      "WORKFLOW_WEBHOOK_ALLOWED_HOSTS","CLAMAV_HOST","LOG_KMS_KEY_ID",
      "SECURITY_ALERT_TOPIC_ARN","LINE_LOGIN_CHANNEL_ID","LINE_LIFF_ID",
      "LINE_MESSAGING_CHANNEL_ID","LINE_AI_AGENT_RUNTIME","AGENTCORE_REGION",
      "AGENTCORE_RUNTIME_ARN","AGENTCORE_RUNTIME_QUALIFIER"]
    and (.requiredVariableValuesSha256|hash))
  and (.roles|type=="array" and length==21 and .==sort_by(.roleName)
    and map(.roleName)==role_names
    and all(.[];. as $role|exact(["attachedPolicies","inlinePolicyName","maxSessionDuration",
        "policySha256","roleArn","roleName","state","trustSha256"])
      and $role.roleArn==role_arn($role.roleName)
      and $role.state==role_state($role.roleName)
      and $role.maxSessionDuration==role_max($role.roleName)
      and $role.inlinePolicyName==inline_name($role.roleName)
      and $role.attachedPolicies==attached($role.roleName)
      and (if $role.state=="ABSENT" then
        $role.policySha256==null and $role.trustSha256==null
      else ($role.trustSha256|hash)
        and (if $role.inlinePolicyName==null then $role.policySha256==null
          else ($role.policySha256|hash) end)
      end)))
  and (.resources|exact(["agentCore","ecs","monitoring","network","parameters",
      "rdsCapacity","s3","secrets","typhoon"])
    and (.typhoon|exact(["configurationSha256","enabled"])
      and (.enabled|type)=="boolean"
      and (if .enabled then (.configurationSha256|hash) else .configurationSha256==null end))
    and (.secrets as $secrets
      | ($secrets|type)=="array" and $secrets==($secrets|sort_by(.name))
      and ($secrets|map(.name))==(required_secret_names
        + (if .typhoon.enabled then ["watchdog-bms/production/typhoon-ocr-api-key"] else [] end)|sort)
      and all($secrets[];. as $secret
        | exact(["arn","hasCurrentVersion","kms","name","required"])
        and ($secret.name|type)=="string" and $secret.hasCurrentVersion==true
        and $secret.required==($secret.name!="watchdog-bms/production/typhoon-ocr-api-key")
        and ($secret.arn|startswith("arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:"+$secret.name+"-"))
        and ($secret.arn|test("-[A-Za-z0-9]{6}$"))
        and ($secret.kms|exact(["keyArn","keyManager","keyState","usesDefaultAwsManagedKey"])
          and .keyManager=="AWS" and .keyState=="Enabled"
          and (.usesDefaultAwsManagedKey|type)=="boolean"
          and (if .usesDefaultAwsManagedKey then .keyArn==null
            else (.keyArn|type=="string"
              and test("^arn:aws:kms:ap-southeast-1:311414082667:key/[0-9a-f-]{36}$")) end))))
    and (.parameters as $parameters
      | ($parameters|type)=="array" and $parameters==($parameters|sort_by(.name))
      and ($parameters|map(.name))==parameter_names
      and all($parameters[];exact(["name","type","value","version"])
        and .type=="String" and (.value|type)=="string" and (.value|length)>0
        and (.version|integer and .>=1))
      and p($parameters;"ecs-express-api-web-service-arn")
        =="arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-api-web-pub"
      and p($parameters;"ecs-express-ai-gateway-service-arn")
        =="arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-ai-gateway-v2"
      and p($parameters;"ecs-express-workers-service-arn")
        =="arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-workers"
      and p($parameters;"s3-bucket")=="watchdog-bms-prod-311414082667"
      and (p($parameters;"ecs-express-api-web-url")
        |test("^https://wa-[0-9a-f]{32}\\.ecs\\.ap-southeast-1\\.on\\.aws$"))
      and p($parameters;"erp-core-internal-url")==p($parameters;"ecs-express-api-web-url")+"/v1"
      and (p($parameters;"ecs-express-ai-gateway-url")
        |test("^https://wa-[0-9a-f]{32}\\.ecs\\.ap-southeast-1\\.on\\.aws$"))
      and p($parameters;"ai-gateway-internal-url")
        ==p($parameters;"ecs-express-ai-gateway-url")+"/v1"
      and (p($parameters;"ecs-express-workers-url")
        |test("^https://wa-[0-9a-f]{32}\\.ecs\\.ap-southeast-1\\.on\\.aws$")))
    and .ecs=={clusterArn:"arn:aws:ecs:ap-southeast-1:311414082667:cluster/watchdog-bms-prod",
      status:"ACTIVE"}
    and (.network|exact(["defaultVpcId","publicSubnetIds","securityGroups"])
      and (.defaultVpcId|type=="string" and test("^vpc-[0-9a-f]{8,17}$"))
      and (.publicSubnetIds|type=="array" and length>=2 and .==sort
        and length==(unique|length))
      and all(.publicSubnetIds[];test("^subnet-[0-9a-f]{8,17}$"))
      and (.securityGroups|type=="array" and .==sort_by(.name)
        and map(.name)==["watchdog-bms-prod-ai-egress-sg","watchdog-bms-prod-app-egress-sg"]
        and all(.[];exact(["id","name"]) and (.id|test("^sg-[0-9a-f]{8,17}$")))))
    and .s3=={bucket:"watchdog-bms-prod-311414082667",lifecycleSha256:$lifecycle,
      region:"ap-southeast-1",versioning:"Enabled"}
    and (.monitoring|exact(["alertTopicArn","kmsKeyArn","logGroups","retentionDays"])
      and .logGroups==["/ecs/watchdog-bms-prod-ai-gateway","/ecs/watchdog-bms-prod-api-web",
        "/ecs/watchdog-bms-prod-workers"] and .retentionDays==14
      and (.kmsKeyArn|test("^arn:aws:kms:ap-southeast-1:311414082667:key/[0-9a-f-]{36}$"))
      and (.alertTopicArn|test("^arn:aws:sns:ap-southeast-1:311414082667:[A-Za-z0-9_-]+$")))
    and (.rdsCapacity|exact(["dbInstanceClass","engine","engineVersion","managedSecretKmsKeyArn",
        "orderableOptionCount","quotaHeadroom","quotaMax","quotaName","quotaUsed",
        "recentAutomatedSnapshotAgeSeconds","recentAutomatedSnapshotArn",
        "recentAutomatedSnapshotCreateTime","recentEncryptedAutomatedSnapshotAvailable",
        "snapshotKmsKeyArn",
        "snapshotMaxAgeSeconds","sourceDbOptionGroup","sourceDbParameterGroup",
        "sourceDbSubnetGroup"])
      and .engine=="postgres" and .engineVersion=="18.3" and .dbInstanceClass=="db.t4g.medium"
      and (.orderableOptionCount|integer and .>=1) and .quotaName=="DBInstances"
      and (.quotaMax|integer and .>=1) and (.quotaUsed|integer and .>=0)
      and (.quotaHeadroom|integer and .>=1) and .quotaHeadroom==(.quotaMax-.quotaUsed)
      and .quotaMax>.quotaUsed and .sourceDbSubnetGroup=="watchdog-bms-prod-db-subnets"
      and .sourceDbParameterGroup=="watchdog-bms-prod-pg18"
      and .sourceDbOptionGroup=="default:postgres-18"
      and .recentEncryptedAutomatedSnapshotAvailable==true and .snapshotMaxAgeSeconds==129600
      and (.recentAutomatedSnapshotAgeSeconds|integer and .>=0 and .<=129600)
      and (.recentAutomatedSnapshotArn|test(
        "^arn:aws:rds:ap-southeast-1:311414082667:snapshot:rds:watchdog-bms-prod-db-[A-Za-z0-9-]+$"))
      and (.recentAutomatedSnapshotCreateTime|type=="string"
        and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|\\+00:00)$"))
      and .snapshotKmsKeyArn
        =="arn:aws:kms:ap-southeast-1:311414082667:key/52b4943e-e9d7-4fae-b71c-c13b0b157b27"
      and .managedSecretKmsKeyArn
        =="arn:aws:kms:ap-southeast-1:311414082667:key/b2e68e7f-e098-4b88-a92a-5a0f4fe2924a")
    and (.agentCore as $agent
    | ($agent|exact(["appEnv","artifactBucket","artifactPrefix","artifactRuntime",
        "artifactVersionId","deployEnvironment","entryPoint","executionRoleArn","gitSha",
        "networkMode","requireMMDSV2","runtimeArn","runtimeId","runtimeVersion",
        "serverProtocol","status"]))
    and $agent=={appEnv:"production",
      artifactBucket:"watchdog-bms-agentcore-artifacts-311414082667",
      artifactPrefix:$agent.artifactPrefix,artifactRuntime:"NODE_22",
      artifactVersionId:$agent.artifactVersionId,deployEnvironment:"production",
      entryPoint:["runtime.js"],
      executionRoleArn:"arn:aws:iam::311414082667:role/watchdog-bms-agentcore-execution-role",
      gitSha:"eaa9005a1857b3cd582ceda743977496ed955110",networkMode:"PUBLIC",requireMMDSV2:true,
      runtimeArn:"arn:aws:bedrock-agentcore:ap-southeast-1:311414082667:runtime/watchdog_orchestrator-6xOx1tCbz0",
      runtimeId:"watchdog_orchestrator-6xOx1tCbz0",runtimeVersion:$agent.runtimeVersion,
      serverProtocol:"HTTP",status:"READY"}
    and ($agent.runtimeVersion|type=="string" and test("^[1-9][0-9]{0,4}$"))
    and ($agent.artifactPrefix|test(
      "^agentcore/watchdog_orchestrator-eaa9005a1857b3cd582ceda743977496ed955110-[0-9a-f]{64}\\.zip$"))
    and ($agent.artifactVersionId|type=="string" and length>0)))
' "$promotion_prerequisites" >/dev/null

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
