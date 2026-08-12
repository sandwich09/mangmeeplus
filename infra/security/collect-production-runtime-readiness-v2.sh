#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <redis-replication-group-id> <output.json>" >&2
  exit 2
fi
redis_id="$1" output="$2"
[[ "$redis_id" =~ ^[a-z][a-z0-9-]{0,39}$ ]]
[ ! -e "$output" ]
prerequisites="$(dirname "$output")/promotion-prerequisites.json"
[ ! -e "$prerequisites" ]
root="$(cd "$(dirname "$0")/../.." && pwd -P)"
region=ap-southeast-1
account=311414082667
role=watchdog-bms-production-security-readonly
test "$(aws sts get-caller-identity --region "$region" --query Account --output text)" = "$account"
identity="$(aws sts get-caller-identity --region "$region" --query Arn --output text)"
[[ "$identity" =~ :assumed-role/watchdog-bms-production-security-readonly/ ]]

work="$(mktemp -d "${TMPDIR:-/tmp}/production-runtime-readiness.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
if command -v sha256sum >/dev/null 2>&1; then sha256_cmd=(sha256sum); else sha256_cmd=(shasum -a 256); fi
sha_json() {
  jq -cjS . "$1" | "${sha256_cmd[@]}" | awk '{print $1}'
}
sha_file() { "${sha256_cmd[@]}" "$1" | awk '{print $1}'; }
sha_stream() { "${sha256_cmd[@]}" | awk '{print $1}'; }

bash "$root/infra/security/validate-production-promotion-environment.sh" \
  "$work/promotion-environment.json"

render() {
  sed "s|<ACCOUNT_ID>|$account|g;s|<S3_BUCKET>|watchdog-bms-prod-$account|g;s|<AGENTCORE_RUNTIME_ARN>|$AGENTCORE_RUNTIME_ARN|g" \
    "$1" > "$2"
}
render "$root/infra/prod-ecs-express/github-deploy-role-trust.template.json" "$work/deploy-trust.json"
render "$root/infra/prod-ecs-express/github-deploy-role-policy.template.json" "$work/deploy-policy.json"
render "$root/infra/security/object-version-cleanup-worker-policy.template.json" "$work/workers-policy.json"
render "$root/infra/security/production-ecs-execution-policy.template.json" "$work/execution-policy.json"
render "$root/infra/security/production-release-task-policy.template.json" "$work/release-policy.json"
render "$root/infra/security/production-api-task-policy.template.json" "$work/api-policy.json"
render "$root/infra/security/production-ai-task-policy.template.json" "$work/ai-policy.json"
render "$root/infra/ai-gateway/agentcore-execution-role-trust.template.json" \
  "$work/agentcore-trust.json"
agentcore_ai_secret_arn="$(aws secretsmanager describe-secret --region "$region" \
  --secret-id watchdog-bms/production/ai-gateway-internal-secret --query ARN --output text)"
agentcore_jwt_secret_arn="$(aws secretsmanager describe-secret --region "$region" \
  --secret-id watchdog-bms/production/watchdog-jwt-secret --query ARN --output text)"
sed -e "s|<ACCOUNT_ID>|$account|g" \
  -e "s|<AI_GATEWAY_SECRET_ARN>|$agentcore_ai_secret_arn|g" \
  -e "s|<WATCHDOG_JWT_SECRET_SOURCE_ARN>|$agentcore_jwt_secret_arn|g" \
  "$root/infra/ai-gateway/agentcore-execution-role-policy.json" \
  > "$work/agentcore-policy.json"
roles="$work/promotion-roles.ndjson"
: > "$roles"
record_exact_role() {
  local name="$1" policy_name="$2" trust="$3" policy="$4" expected_max="$5"
  local state="${6:-READY}"
  local role_state="$work/$name-role.json" policy_state="$work/$name-policy.json"
  aws iam get-role --role-name "$name" --output json | jq -cS . > "$role_state"
  aws iam get-role-policy --role-name "$name" --policy-name "$policy_name" --output json \
    | jq -cS . > "$policy_state"
  jq -e --arg arn "arn:aws:iam::$account:role/$name" --slurpfile expected "$trust" '
    .Role.Arn==$arn and (.Role|has("PermissionsBoundary")|not)
    and .Role.AssumeRolePolicyDocument==$expected[0]' "$role_state" >/dev/null
  [ -z "$expected_max" ] || test "$(jq -r '.Role.MaxSessionDuration' "$role_state")" = "$expected_max"
  jq -e --arg name "$policy_name" --slurpfile expected "$policy" '
    .PolicyName==$name and .PolicyDocument==$expected[0]' "$policy_state" >/dev/null
  test "$(aws iam list-role-policies --role-name "$name" --output json | jq -cS '.PolicyNames|sort')" \
    = "$(jq -cnS --arg name "$policy_name" '[$name]')"
  test "$(aws iam list-attached-role-policies --role-name "$name" --output json | jq -cS '.AttachedPolicies')" = '[]'
  jq -cnS --arg name "$name" --arg arn "arn:aws:iam::$account:role/$name" \
    --arg policy "$policy_name" --arg trustHash "$(jq -cjS '.Role.AssumeRolePolicyDocument' "$role_state"|sha_stream)" \
    --arg policyHash "$(jq -cjS '.PolicyDocument' "$policy_state"|sha_stream)" \
    --arg state "$state" \
    --argjson max "$(jq -r '.Role.MaxSessionDuration' "$role_state")" \
    '{roleName:$name,roleArn:$arn,state:$state,maxSessionDuration:$max,inlinePolicyName:$policy,
      trustSha256:$trustHash,policySha256:$policyHash,attachedPolicies:[]}' >> "$roles"
}
require_absent_role() {
  local name="$1" error="$work/$name-absent.err"
  if aws iam get-role --role-name "$name" >/dev/null 2> "$error"; then
    echo "ERROR: one-time role $name still exists after reader bootstrap" >&2
    exit 1
  fi
  grep -F NoSuchEntity "$error" >/dev/null
  jq -cnS --arg name "$name" --arg arn "arn:aws:iam::$account:role/$name" \
    '{roleName:$name,roleArn:$arn,state:"ABSENT",maxSessionDuration:null,
      inlinePolicyName:null,trustSha256:null,policySha256:null,attachedPolicies:[]}' >> "$roles"
}
record_runtime_role() {
  local name="$1" policy_name="$2" trust="$3" policy="$4" expected_attached="$5"
  local role_state="$work/$name-role.json" policy_state="$work/$name-policy.json"
  aws iam get-role --role-name "$name" --output json | jq -cS . > "$role_state"
  jq -e --arg arn "arn:aws:iam::$account:role/$name" --slurpfile expected "$trust" '
    .Role.Arn==$arn and (.Role|has("PermissionsBoundary")|not)
    and .Role.AssumeRolePolicyDocument==$expected[0]' "$role_state" >/dev/null
  if [ -n "$policy_name" ]; then
    aws iam get-role-policy --role-name "$name" --policy-name "$policy_name" --output json \
      | jq -cS . > "$policy_state"
    jq -e --arg name "$policy_name" --slurpfile expected "$policy" '
      .PolicyName==$name and .PolicyDocument==$expected[0]' "$policy_state" >/dev/null
    expected_inline="$(jq -cnS --arg name "$policy_name" '[$name]')"
    policy_hash="$(jq -cjS '.PolicyDocument' "$policy_state"|sha_stream)"
  else
    expected_inline='[]'; policy_hash=''
  fi
  test "$(aws iam list-role-policies --role-name "$name" --output json | jq -cS '.PolicyNames|sort')" \
    = "$expected_inline"
  attached="$(aws iam list-attached-role-policies --role-name "$name" --output json \
    | jq -cS '[.AttachedPolicies[].PolicyArn]|sort')"
  test "$attached" = "$expected_attached"
  jq -cnS --arg name "$name" --arg arn "arn:aws:iam::$account:role/$name" \
    --arg policy "$policy_name" --arg policyHash "$policy_hash" \
    --arg trustHash "$(jq -cjS '.Role.AssumeRolePolicyDocument' "$role_state"|sha_stream)" \
    --argjson max "$(jq -r '.Role.MaxSessionDuration' "$role_state")" \
    --argjson attached "$attached" '
    {roleName:$name,roleArn:$arn,state:"READY",maxSessionDuration:$max,
     inlinePolicyName:(if $policy=="" then null else $policy end),
     trustSha256:$trustHash,policySha256:(if $policyHash=="" then null else $policyHash end),
     attachedPolicies:$attached}' >> "$roles"
}
record_service_linked_role() {
  local name="$1" path="$2" service="$3" policy_arn="$4"
  local role_state="$work/$name-role.json"
  aws iam get-role --role-name "$name" --output json | jq -cS . > "$role_state"
  jq -e --arg arn "arn:aws:iam::$account:role/aws-service-role/$path/$name" \
    --arg path "/aws-service-role/$path/" --arg service "$service" '
    .Role.Arn==$arn and .Role.Path==$path
    and (.Role|has("PermissionsBoundary")|not)
    and .Role.AssumeRolePolicyDocument=={Version:"2012-10-17",Statement:[{
      Effect:"Allow",Principal:{Service:$service},Action:"sts:AssumeRole"}]}' "$role_state" >/dev/null
  test "$(aws iam list-role-policies --role-name "$name" --output json | jq -cS '.PolicyNames')" = '[]'
  attached="$(aws iam list-attached-role-policies --role-name "$name" --output json \
    | jq -cS '[.AttachedPolicies[].PolicyArn]|sort')"
  test "$attached" = "$(jq -cnS --arg arn "$policy_arn" '[$arn]')"
  jq -cnS --arg name "$name" --arg arn "arn:aws:iam::$account:role/aws-service-role/$path/$name" \
    --arg trustHash "$(jq -cjS '.Role.AssumeRolePolicyDocument' "$role_state"|sha_stream)" \
    --argjson max "$(jq -r '.Role.MaxSessionDuration' "$role_state")" \
    --argjson attached "$attached" '
    {roleName:$name,roleArn:$arn,state:"READY",maxSessionDuration:$max,
     inlinePolicyName:null,trustSha256:$trustHash,policySha256:null,
     attachedPolicies:$attached}' >> "$roles"
}

record_exact_role watchdog-bms-deploy-production watchdog-bms-production-deploy \
  "$work/deploy-trust.json" "$work/deploy-policy.json" 7200
record_exact_role watchdog-bms-agentcore-execution-role watchdog-bms-agentcore-permissions \
  "$work/agentcore-trust.json" "$work/agentcore-policy.json" 3600
record_exact_role watchdog-bms-production-security-readonly watchdog-bms-production-security-readonly \
  "$root/infra/security/production-security-readonly-trust.template.json" \
  "$root/infra/security/production-security-readonly-policy.template.json" 3600
record_exact_role watchdog-bms-production-a5-readonly watchdog-bms-production-a5-readonly \
  "$root/infra/security/production-a5-readonly-trust.template.json" \
  "$root/infra/security/production-a5-readonly-policy.template.json" 7200
record_exact_role watchdog-bms-production-a5-reader-bootstrap \
  watchdog-bms-production-a5-reader-bootstrap \
  "$root/infra/security/production-a5-readonly-trust.template.json" \
  "$root/infra/security/production-a5-reader-bootstrap-revoked-policy.template.json" 7200 REVOKED
record_exact_role watchdog-bms-production-a5-clone watchdog-bms-production-a5-clone \
  "$root/infra/security/production-a5-clone-trust.template.json" \
  "$root/infra/security/production-a5-clone-policy.template.json" 7200
record_exact_role watchdog-bms-production-a5-readonly-execution \
  watchdog-bms-production-a5-readonly-execution \
  "$root/infra/security/production-a5-readonly-execution-trust.template.json" \
  "$root/infra/security/production-a5-readonly-execution-policy.template.json" 7200
record_exact_role watchdog-bms-production-a5-apply-execution \
  watchdog-bms-production-a5-apply-execution \
  "$root/infra/security/production-a5-readonly-execution-trust.template.json" \
  "$root/infra/security/production-a5-apply-execution-policy.template.json" 7200
record_exact_role watchdog-bms-production-a5-clone-execution \
  watchdog-bms-production-a5-clone-execution \
  "$root/infra/security/production-a5-clone-execution-trust.template.json" \
  "$root/infra/security/production-a5-clone-execution-policy.template.json" 7200
require_absent_role watchdog-bms-production-a5-bootstrap-execution

record_runtime_role ecsTaskExecutionRole watchdog-bms-ecs-execution-secrets \
  "$root/infra/security/production-ecs-task-trust.template.json" "$work/execution-policy.json" \
  '["arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"]'
record_runtime_role watchdog-bms-release-task-role watchdog-bms-release-task-ecs-read \
  "$root/infra/security/production-ecs-task-trust.template.json" "$work/release-policy.json" '[]'
record_runtime_role ecsInfrastructureRoleForExpressServices '' \
  "$root/infra/security/production-ecs-infrastructure-trust.template.json" '' \
  '["arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices"]'
record_runtime_role watchdog-bms-ecs-express-api-role watchdog-bms-prod-api-runtime \
  "$root/infra/security/production-ecs-task-trust.template.json" "$work/api-policy.json" '[]'
record_runtime_role watchdog-bms-ecs-express-ai-gateway-role watchdog-bms-ai-gateway-runtime \
  "$root/infra/security/production-ecs-task-trust.template.json" "$work/ai-policy.json" '[]'
record_service_linked_role AWSServiceRoleForECS ecs.amazonaws.com ecs.amazonaws.com \
  arn:aws:iam::aws:policy/aws-service-role/AmazonECSServiceRolePolicy
record_service_linked_role AWSServiceRoleForElasticLoadBalancing elasticloadbalancing.amazonaws.com \
  elasticloadbalancing.amazonaws.com \
  arn:aws:iam::aws:policy/aws-service-role/AWSElasticLoadBalancingServiceRolePolicy
record_service_linked_role AWSServiceRoleForApplicationAutoScaling_ECSService \
  ecs.application-autoscaling.amazonaws.com ecs.application-autoscaling.amazonaws.com \
  arn:aws:iam::aws:policy/aws-service-role/AWSApplicationAutoscalingECSServicePolicy
record_service_linked_role AWSServiceRoleForRDS rds.amazonaws.com rds.amazonaws.com \
  arn:aws:iam::aws:policy/aws-service-role/AmazonRDSServiceRolePolicy
record_service_linked_role AWSServiceRoleForElastiCache elasticache.amazonaws.com \
  elasticache.amazonaws.com \
  arn:aws:iam::aws:policy/aws-service-role/ElastiCacheServiceRolePolicy

workers_role="$work/workers-role.json"; workers_policy="$work/workers-role-policy.json"
aws iam get-role --role-name watchdog-bms-ecs-express-workers-role --output json | jq -cS . > "$workers_role"
aws iam get-role-policy --role-name watchdog-bms-ecs-express-workers-role \
  --policy-name watchdog-bms-prod-workers-object-version-cleanup --output json | jq -cS . > "$workers_policy"
jq -e '
  .Role.Arn=="arn:aws:iam::311414082667:role/watchdog-bms-ecs-express-workers-role"
  and (.Role|has("PermissionsBoundary")|not)
  and .Role.AssumeRolePolicyDocument=={Version:"2012-10-17",Statement:[{Effect:"Allow",
    Principal:{Service:"ecs-tasks.amazonaws.com"},Action:"sts:AssumeRole"}]}' "$workers_role" >/dev/null
jq -e --slurpfile expected "$work/workers-policy.json" '
  .PolicyName=="watchdog-bms-prod-workers-object-version-cleanup"
  and .PolicyDocument==$expected[0]' "$workers_policy" >/dev/null
test "$(aws iam list-role-policies --role-name watchdog-bms-ecs-express-workers-role --output json \
  | jq -cS '.PolicyNames|sort')" = '["watchdog-bms-prod-workers-object-version-cleanup"]'
test "$(aws iam list-attached-role-policies --role-name watchdog-bms-ecs-express-workers-role --output json \
  | jq -cS '.AttachedPolicies')" = '[]'
jq -cnS --arg trustHash "$(jq -cjS '.Role.AssumeRolePolicyDocument' "$workers_role"|sha_stream)" \
  --arg policyHash "$(jq -cjS '.PolicyDocument' "$workers_policy"|sha_stream)" \
  --argjson max "$(jq -r '.Role.MaxSessionDuration' "$workers_role")" '
  {roleName:"watchdog-bms-ecs-express-workers-role",
   roleArn:"arn:aws:iam::311414082667:role/watchdog-bms-ecs-express-workers-role",
   state:"READY",maxSessionDuration:$max,inlinePolicyName:"watchdog-bms-prod-workers-object-version-cleanup",
   trustSha256:$trustHash,policySha256:$policyHash,attachedPolicies:[]}' >> "$roles"

jq -cnS --arg deployRole "$AWS_DEPLOY_ROLE_ARN" \
  --slurpfile github "$work/promotion-environment.json" \
  --argjson roles "$(jq -csS 'sort_by(.roleName)' "$roles")" '
  {schemaVersion:1,deployRoleArn:$deployRole,
   github:$github[0],
   roles:$roles}' > "$work/iam-prerequisites.json"
bash "$root/infra/security/collect-production-promotion-resources.sh" \
  "$work/promotion-resources.json"
jq -cnS --slurpfile iam "$work/iam-prerequisites.json" \
  --slurpfile resources "$work/promotion-resources.json" \
  '$iam[0]+{resources:$resources[0]}' > "$prerequisites"
promotion_prerequisites_hash="$(sha_file "$prerequisites")"

role_json="$work/$role-role.json"; policy_json="$work/$role-policy.json"
policy_hash="$(jq -cnS --slurpfile role "$role_json" --slurpfile policy "$policy_json" \
  '{trust:$role[0].Role.AssumeRolePolicyDocument,policy:$policy[0].PolicyDocument}' | {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'
    else shasum -a 256 | awk '{print $1}'; fi
  })"

rds="$work/rds.json"; redis="$work/redis.json"; primary="$work/primary.json"
aws rds describe-db-instances --region "$region" --db-instance-identifier watchdog-bms-prod-db \
  --output json | jq -cS . > "$rds"
aws elasticache describe-replication-groups --region "$region" --replication-group-id "$redis_id" \
  --output json | jq -cS . > "$redis"
primary_id="$(jq -er '[.ReplicationGroups[0].NodeGroups[].NodeGroupMembers[]
  |select(.CurrentRole=="primary")|.CacheClusterId]|select(length==1)|.[0]' "$redis")"
aws elasticache describe-cache-clusters --region "$region" --cache-cluster-id "$primary_id" \
  --output json | jq -cS . > "$primary"
now="$(date -u +%s)"
jq -cnS --argjson now "$now" --arg security "$policy_hash" \
  --arg promotion "$promotion_prerequisites_hash" --arg redisId "$redis_id" \
  --slurpfile rds "$rds" --arg rdsHash "$(sha_json "$rds")" \
  --slurpfile redis "$redis" --arg redisHash "$(sha_json "$redis")" \
  --slurpfile primary "$primary" --arg primaryHash "$(sha_json "$primary")" '
  ($rds[0].DBInstances|select(length==1)|.[0]) as $db
  | ($redis[0].ReplicationGroups|select(length==1)|.[0]) as $rg
  | ($primary[0].CacheClusters|select(length==1)|.[0]) as $node
  | {schemaVersion:2,observedAtEpoch:$now,securityPolicySha256:$security,
     promotionPrerequisitesSha256:$promotion,
     a5PolicySha256:null,clonePolicySha256:null,
     rds:{identifier:$db.DBInstanceIdentifier,status:$db.DBInstanceStatus,
       storageEncrypted:$db.StorageEncrypted,multiAZ:$db.MultiAZ,
       deletionProtection:$db.DeletionProtection,backupRetentionDays:$db.BackupRetentionPeriod,
       rawSha256:$rdsHash},
     redis:{replicationGroupId:$rg.ReplicationGroupId,status:$rg.Status,
       atRestEncryptionEnabled:$rg.AtRestEncryptionEnabled,
       transitEncryptionEnabled:$rg.TransitEncryptionEnabled,
       authTokenEnabled:$rg.AuthTokenEnabled,automaticFailover:$rg.AutomaticFailover,
       nodeCount:([$rg.NodeGroups[].NodeGroupMembers[]]|length),
       snapshotRetentionDays:$rg.SnapshotRetentionLimit,engine:$node.Engine,
       rawReplicationGroupSha256:$redisHash,rawPrimarySha256:$primaryHash}}
' > "$output"
jq -e --arg redis "$redis_id" '
  .rds.identifier=="watchdog-bms-prod-db" and .rds.status=="available"
  and .rds.storageEncrypted==true and .rds.multiAZ==true and .rds.deletionProtection==true
  and .rds.backupRetentionDays>=35 and .redis.replicationGroupId==$redis
  and .redis.status=="available" and .redis.engine=="redis"
  and .redis.atRestEncryptionEnabled==true and .redis.transitEncryptionEnabled==true
  and .redis.authTokenEnabled==true and .redis.automaticFailover=="enabled"
  and .redis.nodeCount>=2 and .redis.snapshotRetentionDays>=35
' "$output" >/dev/null
