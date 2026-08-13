#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
account=311414082667
region=ap-southeast-1
deploy_role=watchdog-bms-deploy-production
uat_deploy_role=watchdog-bms-deploy-uat
security_role=watchdog-bms-production-security-readonly
workers_role=watchdog-bms-ecs-express-workers-role
agentcore_role=watchdog-bms-agentcore-execution-role
deploy_policy_name=watchdog-bms-production-deploy
uat_deploy_policy_name=watchdog-bms-uat-deploy
security_policy_name=watchdog-bms-production-security-readonly
workers_policy_name=watchdog-bms-prod-workers-object-version-cleanup
deploy_trust="$root/infra/prod-ecs-express/github-deploy-role-trust.template.json"
deploy_policy="$root/infra/prod-ecs-express/github-deploy-role-policy.template.json"
uat_deploy_policy="$root/infra/uat/github-deploy-role-policy.template.json"
security_trust="$root/infra/security/production-security-readonly-trust.template.json"
security_policy="$root/infra/security/production-security-readonly-policy.template.json"
execution_trust="$root/infra/security/production-a5-readonly-execution-trust.template.json"
clone_trust="$root/infra/security/production-a5-clone-execution-trust.template.json"
workers_policy="$root/infra/security/object-version-cleanup-worker-policy.template.json"
task_trust="$root/infra/security/production-ecs-task-trust.template.json"
infra_trust="$root/infra/security/production-ecs-infrastructure-trust.template.json"
agentcore_trust="$root/infra/ai-gateway/agentcore-execution-role-trust.template.json"
agentcore_policy="$root/infra/ai-gateway/agentcore-execution-role-policy.json"
ecr_endpoint_policy="$root/infra/security/production-a5-ecr-endpoint-policy.template.json"
logs_endpoint_policy="$root/infra/security/production-a5-logs-endpoint-policy.template.json"
secrets_endpoint_policy="$root/infra/security/production-a5-secretsmanager-endpoint-policy.template.json"
bootstrap_role=watchdog-bms-production-promotion-bootstrap
agentcore_runtime_arn=arn:aws:bedrock-agentcore:ap-southeast-1:311414082667:runtime/watchdog_orchestrator-6xOx1tCbz0

controller_roles=(
  watchdog-bms-production-a5-readonly
  watchdog-bms-production-a5-reader-bootstrap
  watchdog-bms-production-a5-clone
)
controller_trusts=(
  "$root/infra/security/production-a5-readonly-trust.template.json"
  "$root/infra/security/production-a5-readonly-trust.template.json"
  "$root/infra/security/production-a5-clone-trust.template.json"
)
controller_policies=(
  "$root/infra/security/production-a5-readonly-policy.template.json"
  "$root/infra/security/production-a5-reader-bootstrap-policy.template.json"
  "$root/infra/security/production-a5-clone-policy.template.json"
)
execution_roles=(
  watchdog-bms-production-a5-readonly-execution
  watchdog-bms-production-a5-bootstrap-execution
  watchdog-bms-production-a5-apply-execution
  watchdog-bms-production-a5-clone-execution
)
execution_policies=(
  "$root/infra/security/production-a5-readonly-execution-policy.template.json"
  "$root/infra/security/production-a5-bootstrap-execution-policy.template.json"
  "$root/infra/security/production-a5-apply-execution-policy.template.json"
  "$root/infra/security/production-a5-clone-execution-policy.template.json"
)

jq -e . "$deploy_trust" "$deploy_policy" "$uat_deploy_policy" "$security_trust" "$security_policy" \
  "$execution_trust" "$clone_trust" "$workers_policy" "${controller_trusts[@]}" \
  "${controller_policies[@]}" "${execution_policies[@]}" "$task_trust" "$infra_trust" \
  "$agentcore_trust" "$agentcore_policy" "$ecr_endpoint_policy" "$logs_endpoint_policy" \
  "$secrets_endpoint_policy" \
  "$root/infra/security/production-ecs-execution-policy.template.json" \
  "$root/infra/security/production-release-task-policy.template.json" \
  "$root/infra/security/production-api-task-policy.template.json" \
  "$root/infra/security/production-ai-task-policy.template.json" >/dev/null
mode="${1:-}"
if [ "$mode" != --apply ] && [ "$mode" != --apply-clone-controller ] \
    && [ "$mode" != --apply-private-endpoints ]; then
  echo 'Dry run only. An owner must create the temporary exact bootstrap role and assume-role bridge; then rerun with --apply under AWS_PROFILE=watchdog-bedrock.'
  echo 'This helper rejects the AWS root principal, changes only seventeen durable IAM roles, and read-checks five service-linked roles.'
  echo 'Use --apply-clone-controller to update and exact-read only the existing clone controller policy.'
  echo 'Use --apply-private-endpoints to update and exact-read only the four existing interface endpoint policies.'
  exit 0
fi

test "${AWS_ACCOUNT_ID:?AWS_ACCOUNT_ID is required}" = "$account"
caller="$(aws sts get-caller-identity --region "$region" --query Arn --output text)"
if [ "$caller" = "arn:aws:iam::$account:user/watchdog-bedrock-dev" ]; then
  session="$(aws sts assume-role --role-arn "arn:aws:iam::$account:role/$bootstrap_role" \
    --role-session-name production-promotion-prerequisites --duration-seconds 3600 --output json)"
  AWS_ACCESS_KEY_ID="$(jq -er '.Credentials.AccessKeyId' <<< "$session")" \
  AWS_SECRET_ACCESS_KEY="$(jq -er '.Credentials.SecretAccessKey' <<< "$session")" \
  AWS_SESSION_TOKEN="$(jq -er '.Credentials.SessionToken' <<< "$session")" \
    exec "$0" "$mode"
fi
[[ "$caller" =~ ^arn:aws:sts::311414082667:assumed-role/watchdog-bms-production-promotion-bootstrap/ ]] || {
  echo 'ERROR: promotion prerequisite bootstrap requires the temporary non-root bootstrap role' >&2
  exit 2
}

work="$(mktemp -d "${TMPDIR:-/tmp}/production-promotion-bootstrap.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
retry_exact() {
  local attempt max="${PROMOTION_IAM_MAX_ATTEMPTS:-12}" delay="${PROMOTION_IAM_RETRY_SECONDS:-5}"
  [[ "$max" =~ ^[1-9][0-9]*$ && "$delay" =~ ^[0-9]+$ ]] || return 1
  for ((attempt=1; attempt<=max; attempt++)); do
    "$@" && return 0
    [ "$attempt" -eq "$max" ] || sleep "$delay"
  done
  echo "ERROR: exact prerequisite readback did not converge after $max attempts: $*" >&2
  return 1
}
retry_mutation() {
  local attempt max="${PROMOTION_IAM_MAX_ATTEMPTS:-12}" delay="${PROMOTION_IAM_RETRY_SECONDS:-5}"
  [[ "$max" =~ ^[1-9][0-9]*$ && "$delay" =~ ^[0-9]+$ ]] || return 1
  for ((attempt=1; attempt<=max; attempt++)); do
    "$@" && return 0
    [ "$attempt" -eq "$max" ] || sleep "$delay"
  done
  echo "ERROR: idempotent prerequisite mutation did not converge after $max attempts: $*" >&2
  return 1
}

if [ "$mode" = --apply-private-endpoints ]; then
  endpoint_ids=(
    vpce-044085e7ad8749ca4
    vpce-0b9af85905e446695
    vpce-098bd832f02b47922
    vpce-07f6ed4632f468c4b
  )
  endpoint_services=(ecr.api ecr.dkr logs secretsmanager)
  endpoint_policies=(
    "$ecr_endpoint_policy"
    "$ecr_endpoint_policy"
    "$logs_endpoint_policy"
    "$secrets_endpoint_policy"
  )
  assert_endpoint_identity() {
    local id="$1" service="$2" output="$work/$1.json"
    aws ec2 describe-vpc-endpoints --region "$region" --vpc-endpoint-ids "$id" \
      --output json > "$output" || return 1
    jq -e --arg id "$id" --arg service "com.amazonaws.$region.$service" '
      .VpcEndpoints|length==1 and .[0].VpcEndpointId==$id
      and .[0].VpcId=="vpc-0da727984eee92f96" and .[0].ServiceName==$service
      and .[0].VpcEndpointType=="Interface" and .[0].State=="available"
      and .[0].PrivateDnsEnabled==true
    ' "$output" >/dev/null
  }
  assert_endpoint_policy() {
    local id="$1" service="$2" policy="$3" output="$work/$1.json"
    assert_endpoint_identity "$id" "$service" || return 1
    jq -e --slurpfile expected "$policy" '
      .VpcEndpoints[0].PolicyDocument
      |(if type=="string" then fromjson else . end)==$expected[0]
    ' "$output" >/dev/null
  }
  for index in "${!endpoint_ids[@]}"; do
    retry_exact assert_endpoint_identity "${endpoint_ids[$index]}" "${endpoint_services[$index]}"
  done
  for index in "${!endpoint_ids[@]}"; do
    retry_mutation aws ec2 modify-vpc-endpoint --region "$region" \
      --vpc-endpoint-id "${endpoint_ids[$index]}" \
      --policy-document "file://${endpoint_policies[$index]}" >/dev/null
  done
  for index in "${!endpoint_ids[@]}"; do
    retry_exact assert_endpoint_policy "${endpoint_ids[$index]}" "${endpoint_services[$index]}" \
      "${endpoint_policies[$index]}"
  done
  echo 'Production interface endpoint policies applied and exact-read back under a scoped non-root principal.'
  exit 0
fi

assert_clone_controller_shape() {
  local role=watchdog-bms-production-a5-clone
  local role_json="$work/clone-controller-role.json"
  local policy_json="$work/clone-controller-policy.json"
  aws iam get-role --role-name "$role" --output json > "$role_json" || return 1
  aws iam get-role-policy --role-name "$role" --policy-name "$role" \
    --output json > "$policy_json" || return 1
  jq -e --slurpfile trust "$root/infra/security/production-a5-clone-trust.template.json" '
    .Role.Arn=="arn:aws:iam::311414082667:role/watchdog-bms-production-a5-clone"
    and .Role.Path=="/" and .Role.MaxSessionDuration==7200
    and (.Role|has("PermissionsBoundary")|not)
    and .Role.AssumeRolePolicyDocument==$trust[0]
  ' "$role_json" >/dev/null || return 1
  jq -e --arg role "$role" '.RoleName==$role and .PolicyName==$role' \
    "$policy_json" >/dev/null || return 1
  test "$(aws iam list-role-policies --role-name "$role" --output json | jq -cS '.PolicyNames|sort')" \
    = '["watchdog-bms-production-a5-clone"]' || return 1
  test "$(aws iam list-attached-role-policies --role-name "$role" --output json \
    | jq -cS '.AttachedPolicies')" = '[]'
}

assert_clone_controller_exact() {
  assert_clone_controller_shape || return 1
  jq -e --slurpfile expected "$root/infra/security/production-a5-clone-policy.template.json" \
    '.PolicyDocument==$expected[0]' "$work/clone-controller-policy.json" >/dev/null
}

if [ "$mode" = --apply-clone-controller ]; then
  retry_exact assert_clone_controller_shape
  retry_mutation aws iam put-role-policy --role-name watchdog-bms-production-a5-clone \
    --policy-name watchdog-bms-production-a5-clone \
    --policy-document "file://$root/infra/security/production-a5-clone-policy.template.json"
  retry_exact assert_clone_controller_exact
  echo 'Production A5 clone controller policy applied and exact-read back under a scoped non-root principal.'
  exit 0
fi

read_source_db_configuration() {
  aws rds describe-db-instances --region "$region" \
    --db-instance-identifier watchdog-bms-prod-db --query 'DBInstances[0]' --output json \
    > "$work/source-db.json" || return 1
  jq -e 'type=="object" and .DBInstanceIdentifier=="watchdog-bms-prod-db"
    and (.DBSubnetGroup.DBSubnetGroupName|type)=="string"
    and (.DBParameterGroups|length)==1 and (.OptionGroupMemberships|length)==1' \
    "$work/source-db.json" >/dev/null
}
retry_exact read_source_db_configuration
source_db="$(<"$work/source-db.json")"
clone_subnet_group="$(jq -er '.DBSubnetGroup.DBSubnetGroupName|select(length>0)' <<< "$source_db")"
clone_parameter_group="$(jq -er '
  .DBParameterGroups|select(length==1)|.[0]
  |select(.ParameterApplyStatus=="in-sync")|.DBParameterGroupName|select(length>0)' <<< "$source_db")"
clone_option_group="$(jq -er '
  .OptionGroupMemberships|select(length==1)|.[0]
  |select(.Status=="in-sync")|.OptionGroupName|select(length>0)' <<< "$source_db")"
expected_clone_restore_resources="$(jq -cnS \
  --arg target "arn:aws:rds:$region:$account:db:watchdog-a5-clone-*" \
  --arg snapshot "arn:aws:rds:$region:$account:snapshot:rds:watchdog-bms-prod-db-*" \
  --arg subnet "arn:aws:rds:$region:$account:subgrp:$clone_subnet_group" \
  --arg parameter "arn:aws:rds:$region:$account:pg:$clone_parameter_group" \
  --arg option "arn:aws:rds:$region:$account:og:$clone_option_group" \
  '[$target,$snapshot,$subnet,$parameter,$option]|sort')"
test "$(jq -cS '[.Statement[]|select(.Sid=="AllowTaggedCloneRestore")][0].Resource|sort' \
  "$root/infra/security/production-a5-clone-policy.template.json")" \
  = "$expected_clone_restore_resources"
sed "s/<ACCOUNT_ID>/$account/g" "$deploy_trust" > "$work/deploy-trust.json"
sed "s/<ACCOUNT_ID>/$account/g" "$deploy_policy" > "$work/deploy-policy.json"
sed "s/<ACCOUNT_ID>/$account/g" "$uat_deploy_policy" > "$work/uat-deploy-policy.json"
sed "s/<S3_BUCKET>/watchdog-bms-prod-$account/g" "$workers_policy" > "$work/workers-policy.json"
render() {
  sed "s|<ACCOUNT_ID>|$account|g;s|<S3_BUCKET>|watchdog-bms-prod-$account|g;s|<AGENTCORE_RUNTIME_ARN>|$agentcore_runtime_arn|g" \
    "$1" > "$2"
}
render "$root/infra/security/production-ecs-execution-policy.template.json" "$work/execution-policy.json"
render "$root/infra/security/production-release-task-policy.template.json" "$work/release-policy.json"
render "$root/infra/security/production-api-task-policy.template.json" "$work/api-policy.json"
render "$root/infra/security/production-ai-task-policy.template.json" "$work/ai-policy.json"
render "$agentcore_trust" "$work/agentcore-trust.json"
read_secret_metadata() {
  local name="$1" output="$2"
  aws secretsmanager describe-secret --region "$region" --secret-id "$name" --output json \
    > "$output" || return 1
  jq -e --arg name "$name" --arg prefix "arn:aws:secretsmanager:$region:$account:secret:$name-" '
    .Name==$name and (.ARN|startswith($prefix)) and (.ARN|length)==($prefix|length)+6
    and (has("DeletedDate")|not)
  ' "$output" >/dev/null
}
retry_exact read_secret_metadata watchdog-bms/production/ai-gateway-internal-secret \
  "$work/agentcore-ai-secret.json"
retry_exact read_secret_metadata watchdog-bms/production/watchdog-jwt-secret \
  "$work/agentcore-jwt-secret.json"
agentcore_ai_secret_arn="$(jq -er .ARN "$work/agentcore-ai-secret.json")"
agentcore_jwt_secret_arn="$(jq -er .ARN "$work/agentcore-jwt-secret.json")"
sed -e "s|<ACCOUNT_ID>|$account|g" \
  -e "s|<AI_GATEWAY_SECRET_ARN>|$agentcore_ai_secret_arn|g" \
  -e "s|<WATCHDOG_JWT_SECRET_SOURCE_ARN>|$agentcore_jwt_secret_arn|g" \
  "$agentcore_policy" > "$work/agentcore-policy.json"

is_creatable_a5_role() {
  case "$1" in
    watchdog-bms-production-a5-readonly|watchdog-bms-production-a5-reader-bootstrap|\
    watchdog-bms-production-a5-clone|watchdog-bms-production-a5-readonly-execution|\
    watchdog-bms-production-a5-bootstrap-execution|watchdog-bms-production-a5-apply-execution|\
    watchdog-bms-production-a5-clone-execution) return 0 ;;
    *) return 1 ;;
  esac
}

preflight_role_metadata() {
  local role="$1" error="$work/preflight-$1.err"
  if ! aws iam get-role --role-name "$role" > /dev/null 2> "$error"; then
    is_creatable_a5_role "$role" && grep -Fq NoSuchEntity "$error" && return 0
    return 1
  fi
  aws iam list-role-policies --role-name "$role" > /dev/null \
    && aws iam list-attached-role-policies --role-name "$role" > /dev/null
}

for preflight_role in \
  "$deploy_role" "$uat_deploy_role" "$security_role" "$agentcore_role" "$workers_role" \
  ecsTaskExecutionRole watchdog-bms-release-task-role ecsInfrastructureRoleForExpressServices \
  watchdog-bms-ecs-express-api-role watchdog-bms-ecs-express-ai-gateway-role \
  "${controller_roles[@]}" "${execution_roles[@]}" \
  AWSServiceRoleForECS AWSServiceRoleForElasticLoadBalancing \
  AWSServiceRoleForApplicationAutoScaling_ECSService AWSServiceRoleForRDS \
  AWSServiceRoleForElastiCache; do
  retry_exact preflight_role_metadata "$preflight_role"
done

preflight_clone_parameters() {
  aws ssm get-parameters --region "$region" --names \
    /watchdog-bms/production/a5-clone/db-subnet-group-name \
    /watchdog-bms/production/a5-clone/db-parameter-group-name \
    /watchdog-bms/production/a5-clone/option-group-name --output json \
    > "$work/preflight-clone-parameters.json" || return 1
  jq -e '((.Parameters|length)+(.InvalidParameters|length))==3' \
    "$work/preflight-clone-parameters.json" >/dev/null
}
retry_exact preflight_clone_parameters

preflight_bucket_lifecycle() {
  local error="$work/preflight-lifecycle.err"
  if aws s3api get-bucket-lifecycle-configuration --region "$region" \
      --bucket watchdog-bms-prod-$account > /dev/null 2> "$error"; then
    return 0
  fi
  grep -Fq NoSuchLifecycleConfiguration "$error"
}
retry_exact preflight_bucket_lifecycle

ensure_existing_role() {
  local role="$1"
  aws iam get-role --role-name "$role" >/dev/null
}

ensure_a5_role() {
  local role="$1" trust="$2" policy="$3"
  if aws iam get-role --role-name "$role" >/dev/null 2>&1; then
    retry_mutation aws iam update-assume-role-policy --role-name "$role" --policy-document "file://$trust"
  else
    create_a5_role() {
      local status=0 error="$work/create-$role.err"
      aws iam create-role --role-name "$role" --max-session-duration 7200 \
        --assume-role-policy-document "file://$trust" >/dev/null 2> "$error" || status=$?
      [ "$status" -eq 0 ] || grep -Fq EntityAlreadyExists "$error" || return "$status"
    }
    retry_mutation create_a5_role
  fi
  retry_mutation aws iam update-assume-role-policy --role-name "$role" \
    --policy-document "file://$trust"
  retry_mutation aws iam update-role --role-name "$role" --max-session-duration 7200 >/dev/null
  retry_mutation aws iam put-role-policy --role-name "$role" --policy-name "$role" \
    --policy-document "file://$policy"
}

ensure_existing_role "$deploy_role"
retry_mutation aws iam update-assume-role-policy --role-name "$deploy_role" \
  --policy-document "file://$work/deploy-trust.json"
retry_mutation aws iam update-role --role-name "$deploy_role" --max-session-duration 7200 >/dev/null
retry_mutation aws iam put-role-policy --role-name "$deploy_role" --policy-name "$deploy_policy_name" \
  --policy-document "file://$work/deploy-policy.json"

ensure_existing_role "$uat_deploy_role"
retry_mutation aws iam put-role-policy --role-name "$uat_deploy_role" --policy-name "$uat_deploy_policy_name" \
  --policy-document "file://$work/uat-deploy-policy.json"

ensure_existing_role "$security_role"
retry_mutation aws iam update-assume-role-policy --role-name "$security_role" \
  --policy-document "file://$security_trust"
retry_mutation aws iam put-role-policy --role-name "$security_role" --policy-name "$security_policy_name" \
  --policy-document "file://$security_policy"
retry_mutation aws iam update-role --role-name "$security_role" --max-session-duration 3600 >/dev/null

ensure_existing_role "$agentcore_role"
retry_mutation aws iam update-assume-role-policy --role-name "$agentcore_role" \
  --policy-document "file://$work/agentcore-trust.json"
retry_mutation aws iam update-role --role-name "$agentcore_role" --max-session-duration 3600 >/dev/null
retry_mutation aws iam put-role-policy --role-name "$agentcore_role" \
  --policy-name watchdog-bms-agentcore-permissions \
  --policy-document "file://$work/agentcore-policy.json"

ensure_existing_role "$workers_role"
retry_mutation aws iam update-assume-role-policy --role-name "$workers_role" --policy-document "file://$task_trust"
retry_mutation aws iam put-role-policy --role-name "$workers_role" --policy-name "$workers_policy_name" \
  --policy-document "file://$work/workers-policy.json"

ensure_existing_role ecsTaskExecutionRole
retry_mutation aws iam update-assume-role-policy --role-name ecsTaskExecutionRole --policy-document "file://$task_trust"
retry_mutation aws iam put-role-policy --role-name ecsTaskExecutionRole \
  --policy-name watchdog-bms-ecs-execution-secrets \
  --policy-document "file://$work/execution-policy.json"
retry_mutation aws iam attach-role-policy --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy

ensure_existing_role watchdog-bms-release-task-role
retry_mutation aws iam update-assume-role-policy --role-name watchdog-bms-release-task-role \
  --policy-document "file://$task_trust"
retry_mutation aws iam put-role-policy --role-name watchdog-bms-release-task-role \
  --policy-name watchdog-bms-release-task-ecs-read \
  --policy-document "file://$work/release-policy.json"

ensure_existing_role ecsInfrastructureRoleForExpressServices
retry_mutation aws iam update-assume-role-policy --role-name ecsInfrastructureRoleForExpressServices \
  --policy-document "file://$infra_trust"
retry_mutation aws iam attach-role-policy --role-name ecsInfrastructureRoleForExpressServices \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices

ensure_existing_role watchdog-bms-ecs-express-api-role
retry_mutation aws iam update-assume-role-policy --role-name watchdog-bms-ecs-express-api-role \
  --policy-document "file://$task_trust"
retry_mutation aws iam put-role-policy --role-name watchdog-bms-ecs-express-api-role \
  --policy-name watchdog-bms-prod-api-runtime --policy-document "file://$work/api-policy.json"

ensure_existing_role watchdog-bms-ecs-express-ai-gateway-role
retry_mutation aws iam update-assume-role-policy --role-name watchdog-bms-ecs-express-ai-gateway-role \
  --policy-document "file://$task_trust"
retry_mutation aws iam put-role-policy --role-name watchdog-bms-ecs-express-ai-gateway-role \
  --policy-name watchdog-bms-ai-gateway-runtime --policy-document "file://$work/ai-policy.json"

for index in "${!controller_roles[@]}"; do
  ensure_a5_role "${controller_roles[$index]}" "${controller_trusts[$index]}" \
    "${controller_policies[$index]}"
done
for index in "${!execution_roles[@]}"; do
  trust="$execution_trust"
  [ "${execution_roles[$index]}" != watchdog-bms-production-a5-clone-execution ] || trust="$clone_trust"
  ensure_a5_role "${execution_roles[$index]}" "$trust" "${execution_policies[$index]}"
done

clone_parameter_prefix=/watchdog-bms/production/a5-clone
retry_mutation aws ssm put-parameter --region "$region" --name "$clone_parameter_prefix/db-subnet-group-name" \
  --type String --value "$clone_subnet_group" --overwrite >/dev/null
retry_mutation aws ssm put-parameter --region "$region" --name "$clone_parameter_prefix/db-parameter-group-name" \
  --type String --value "$clone_parameter_group" --overwrite >/dev/null
retry_mutation aws ssm put-parameter --region "$region" --name "$clone_parameter_prefix/option-group-name" \
  --type String --value "$clone_option_group" --overwrite >/dev/null
assert_clone_parameters() {
  local clone_parameters
  clone_parameters="$(aws ssm get-parameters --region "$region" --names \
    "$clone_parameter_prefix/db-subnet-group-name" \
    "$clone_parameter_prefix/db-parameter-group-name" \
    "$clone_parameter_prefix/option-group-name" --output json)" || return 1
  jq -e --arg prefix "$clone_parameter_prefix" --arg subnet "$clone_subnet_group" \
    --arg parameter "$clone_parameter_group" --arg option "$clone_option_group" '
    .InvalidParameters==[] and (.Parameters|length)==3
    and (all(.Parameters[];.Type=="String"))
    and (.Parameters|map({key:.Name,value:.Value})|from_entries)=={
      ($prefix+"/db-subnet-group-name"):$subnet,
      ($prefix+"/db-parameter-group-name"):$parameter,
      ($prefix+"/option-group-name"):$option}' <<< "$clone_parameters" >/dev/null || return 1
}
retry_exact assert_clone_parameters

# The deploy path rewrites this exact lifecycle before rollout. Repair/read it back here so a
# known stale bucket contract cannot consume a Production deploy attempt.
retry_mutation aws s3api put-bucket-lifecycle-configuration --region "$region" \
  --bucket watchdog-bms-prod-$account \
  --lifecycle-configuration "file://$root/infra/object-storage-lifecycle.json"
jq -cS '{Rules:(.Rules|sort_by(.ID))}' "$root/infra/object-storage-lifecycle.json" \
  > "$work/expected-lifecycle.json"
assert_lifecycle() {
  aws s3api get-bucket-lifecycle-configuration --region "$region" \
    --bucket watchdog-bms-prod-$account --output json \
    | jq -cS '{Rules:(.Rules|sort_by(.ID))}' > "$work/live-lifecycle.json" || return 1
  cmp -s "$work/live-lifecycle.json" "$work/expected-lifecycle.json" || return 1
}
retry_exact assert_lifecycle

assert_exact_role() {
  local role="$1" policy_name="$2" trust="$3" policy="$4" max="$5"
  local expected_attached="${6:-[]}"
  local role_json="$work/$role.json" policy_json="$work/$role-policy.json"
  aws iam get-role --role-name "$role" --output json > "$role_json" || return 1
  aws iam get-role-policy --role-name "$role" --policy-name "$policy_name" \
    --output json > "$policy_json" || return 1
  jq -e --arg arn "arn:aws:iam::$account:role/$role" --argjson max "$max" \
    --slurpfile expected "$trust" '
    .Role.Arn==$arn and .Role.MaxSessionDuration==$max
    and (.Role|has("PermissionsBoundary")|not)
    and .Role.AssumeRolePolicyDocument==$expected[0]' "$role_json" >/dev/null || return 1
  jq -e --arg name "$policy_name" --slurpfile expected "$policy" \
    '.PolicyName==$name and .PolicyDocument==$expected[0]' "$policy_json" >/dev/null || return 1
  test "$(aws iam list-role-policies --role-name "$role" --output json | jq -cS '.PolicyNames|sort')" \
    = "$(jq -cnS --arg name "$policy_name" '[$name]')" || return 1
  test "$(aws iam list-attached-role-policies --role-name "$role" --output json \
    | jq -cS '[.AttachedPolicies[].PolicyArn]|sort')" = "$expected_attached" || return 1
}
assert_exact_policy_role() {
  local role="$1" policy_name="$2" policy="$3"
  local role_json="$work/$role.json" policy_json="$work/$role-policy.json"
  aws iam get-role --role-name "$role" --output json > "$role_json" || return 1
  aws iam get-role-policy --role-name "$role" --policy-name "$policy_name" \
    --output json > "$policy_json" || return 1
  jq -e --arg arn "arn:aws:iam::$account:role/$role" '
    .Role.Arn==$arn and (.Role|has("PermissionsBoundary")|not)' "$role_json" >/dev/null || return 1
  jq -e --arg name "$policy_name" --slurpfile expected "$policy" '
    .PolicyName==$name and .PolicyDocument==$expected[0]' "$policy_json" >/dev/null || return 1
  test "$(aws iam list-role-policies --role-name "$role" --output json | jq -cS '.PolicyNames|sort')" \
    = "$(jq -cnS --arg name "$policy_name" '[$name]')" || return 1
  test "$(aws iam list-attached-role-policies --role-name "$role" --output json \
    | jq -cS '.AttachedPolicies')" = '[]' || return 1
}

retry_exact assert_exact_role "$deploy_role" "$deploy_policy_name" "$work/deploy-trust.json" \
  "$work/deploy-policy.json" 7200
retry_exact assert_exact_policy_role "$uat_deploy_role" "$uat_deploy_policy_name" \
  "$work/uat-deploy-policy.json"
retry_exact assert_exact_role "$security_role" "$security_policy_name" "$security_trust" "$security_policy" 3600
retry_exact assert_exact_role "$agentcore_role" watchdog-bms-agentcore-permissions \
  "$work/agentcore-trust.json" "$work/agentcore-policy.json" 3600
for index in "${!controller_roles[@]}"; do
  retry_exact assert_exact_role "${controller_roles[$index]}" "${controller_roles[$index]}" \
    "${controller_trusts[$index]}" "${controller_policies[$index]}" 7200
done

retry_exact assert_exact_role ecsTaskExecutionRole watchdog-bms-ecs-execution-secrets "$task_trust" \
  "$work/execution-policy.json" 3600 \
  '["arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"]'
retry_exact assert_exact_role watchdog-bms-release-task-role watchdog-bms-release-task-ecs-read "$task_trust" \
  "$work/release-policy.json" 3600
retry_exact assert_exact_role watchdog-bms-ecs-express-api-role watchdog-bms-prod-api-runtime "$task_trust" \
  "$work/api-policy.json" 3600
retry_exact assert_exact_role watchdog-bms-ecs-express-ai-gateway-role watchdog-bms-ai-gateway-runtime \
  "$task_trust" "$work/ai-policy.json" 3600

assert_infrastructure_role() {
  local infra_json="$work/ecs-infrastructure-role.json"
  aws iam get-role --role-name ecsInfrastructureRoleForExpressServices \
    --output json > "$infra_json" || return 1
  jq -e --slurpfile trust "$infra_trust" '
    .Role.Arn=="arn:aws:iam::311414082667:role/ecsInfrastructureRoleForExpressServices"
    and (.Role|has("PermissionsBoundary")|not)
    and .Role.AssumeRolePolicyDocument==$trust[0]' "$infra_json" >/dev/null || return 1
  test "$(aws iam list-role-policies --role-name ecsInfrastructureRoleForExpressServices \
    --output json | jq -cS '.PolicyNames')" = '[]' || return 1
  test "$(aws iam list-attached-role-policies --role-name ecsInfrastructureRoleForExpressServices \
    --output json | jq -cS '[.AttachedPolicies[].PolicyArn]|sort')" = \
    '["arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices"]' \
    || return 1
}
retry_exact assert_infrastructure_role

assert_service_linked_role() {
  local role="$1" path="$2" service="$3" policy="$4"
  local json="$work/$role-service-role.json"
  aws iam get-role --role-name "$role" --output json > "$json"
  jq -e --arg arn "arn:aws:iam::$account:role/aws-service-role/$path/$role" \
    --arg path "/aws-service-role/$path/" --arg service "$service" '
    .Role.Arn==$arn and .Role.Path==$path and .Role.AssumeRolePolicyDocument=={
      Version:"2012-10-17",Statement:[{Effect:"Allow",Principal:{Service:$service},
        Action:"sts:AssumeRole"}]}' "$json" >/dev/null
  test "$(aws iam list-role-policies --role-name "$role" --output json | jq -cS '.PolicyNames')" = '[]'
  test "$(aws iam list-attached-role-policies --role-name "$role" --output json \
    | jq -cS '[.AttachedPolicies[].PolicyArn]|sort')" = "$(jq -cnS --arg policy "$policy" '[$policy]')"
}
assert_service_linked_role AWSServiceRoleForECS ecs.amazonaws.com ecs.amazonaws.com \
  arn:aws:iam::aws:policy/aws-service-role/AmazonECSServiceRolePolicy
assert_service_linked_role AWSServiceRoleForElasticLoadBalancing elasticloadbalancing.amazonaws.com \
  elasticloadbalancing.amazonaws.com \
  arn:aws:iam::aws:policy/aws-service-role/AWSElasticLoadBalancingServiceRolePolicy
assert_service_linked_role AWSServiceRoleForApplicationAutoScaling_ECSService \
  ecs.application-autoscaling.amazonaws.com ecs.application-autoscaling.amazonaws.com \
  arn:aws:iam::aws:policy/aws-service-role/AWSApplicationAutoscalingECSServicePolicy
assert_service_linked_role AWSServiceRoleForRDS rds.amazonaws.com rds.amazonaws.com \
  arn:aws:iam::aws:policy/aws-service-role/AmazonRDSServiceRolePolicy
assert_service_linked_role AWSServiceRoleForElastiCache elasticache.amazonaws.com \
  elasticache.amazonaws.com \
  arn:aws:iam::aws:policy/aws-service-role/ElastiCacheServiceRolePolicy
for index in "${!execution_roles[@]}"; do
  trust="$execution_trust"
  [ "${execution_roles[$index]}" != watchdog-bms-production-a5-clone-execution ] || trust="$clone_trust"
  retry_exact assert_exact_role "${execution_roles[$index]}" "${execution_roles[$index]}" "$trust" \
    "${execution_policies[$index]}" 7200
done

assert_workers_role() {
  local workers_role_json="$work/workers-role.json"
  local workers_policy_json="$work/workers-role-policy.json"
  aws iam get-role --role-name "$workers_role" --output json > "$workers_role_json" || return 1
  aws iam get-role-policy --role-name "$workers_role" --policy-name "$workers_policy_name" \
    --output json > "$workers_policy_json" || return 1
  jq -e --arg arn "arn:aws:iam::$account:role/$workers_role" '
    .Role.Arn==$arn and (.Role|has("PermissionsBoundary")|not)
    and .Role.AssumeRolePolicyDocument=={
      Version:"2012-10-17",Statement:[{Effect:"Allow",Principal:{Service:"ecs-tasks.amazonaws.com"},
        Action:"sts:AssumeRole"}]}' "$workers_role_json" >/dev/null || return 1
  jq -e --arg name "$workers_policy_name" --slurpfile expected "$work/workers-policy.json" \
    '.PolicyName==$name and .PolicyDocument==$expected[0]' "$workers_policy_json" >/dev/null || return 1
  test "$(aws iam list-role-policies --role-name "$workers_role" --output json \
    | jq -cS '.PolicyNames|sort')" = \
    "$(jq -cnS --arg name "$workers_policy_name" '[$name]')" || return 1
  test "$(aws iam list-attached-role-policies --role-name "$workers_role" --output json \
    | jq -cS '.AttachedPolicies')" = '[]' || return 1
}
retry_exact assert_workers_role

echo 'Production promotion IAM prerequisites applied and exact-read back under a non-root principal.'
