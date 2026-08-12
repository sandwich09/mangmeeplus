#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
account=311414082667
region=ap-southeast-1
deploy_role=watchdog-bms-deploy-production
security_role=watchdog-bms-production-security-readonly
workers_role=watchdog-bms-ecs-express-workers-role
deploy_policy_name=watchdog-bms-production-deploy
security_policy_name=watchdog-bms-production-security-readonly
workers_policy_name=watchdog-bms-prod-workers-object-version-cleanup
deploy_trust="$root/infra/prod-ecs-express/github-deploy-role-trust.template.json"
deploy_policy="$root/infra/prod-ecs-express/github-deploy-role-policy.template.json"
security_trust="$root/infra/security/production-security-readonly-trust.template.json"
security_policy="$root/infra/security/production-security-readonly-policy.template.json"
execution_trust="$root/infra/security/production-a5-readonly-execution-trust.template.json"
clone_trust="$root/infra/security/production-a5-clone-execution-trust.template.json"
workers_policy="$root/infra/security/object-version-cleanup-worker-policy.template.json"
task_trust="$root/infra/security/production-ecs-task-trust.template.json"
infra_trust="$root/infra/security/production-ecs-infrastructure-trust.template.json"
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

jq -e . "$deploy_trust" "$deploy_policy" "$security_trust" "$security_policy" \
  "$execution_trust" "$clone_trust" "$workers_policy" "${controller_trusts[@]}" \
  "${controller_policies[@]}" "${execution_policies[@]}" "$task_trust" "$infra_trust" \
  "$root/infra/security/production-ecs-execution-policy.template.json" \
  "$root/infra/security/production-release-task-policy.template.json" \
  "$root/infra/security/production-api-task-policy.template.json" \
  "$root/infra/security/production-ai-task-policy.template.json" >/dev/null
if [ "${1:-}" != --apply ]; then
  echo 'Dry run only. An owner must create the temporary exact bootstrap role and assume-role bridge; then rerun with --apply under AWS_PROFILE=watchdog-bedrock.'
  echo 'This helper rejects the AWS root principal, changes only fifteen durable IAM roles, and read-checks three service-linked roles.'
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
    exec "$0" --apply
fi
[[ "$caller" =~ ^arn:aws:sts::311414082667:assumed-role/watchdog-bms-production-promotion-bootstrap/ ]] || {
  echo 'ERROR: promotion prerequisite bootstrap requires the temporary non-root bootstrap role' >&2
  exit 2
}

work="$(mktemp -d "${TMPDIR:-/tmp}/production-promotion-bootstrap.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
sed "s/<ACCOUNT_ID>/$account/g" "$deploy_trust" > "$work/deploy-trust.json"
sed "s/<ACCOUNT_ID>/$account/g" "$deploy_policy" > "$work/deploy-policy.json"
sed "s/<S3_BUCKET>/watchdog-bms-prod-$account/g" "$workers_policy" > "$work/workers-policy.json"
render() {
  sed "s|<ACCOUNT_ID>|$account|g;s|<S3_BUCKET>|watchdog-bms-prod-$account|g;s|<AGENTCORE_RUNTIME_ARN>|$agentcore_runtime_arn|g" \
    "$1" > "$2"
}
render "$root/infra/security/production-ecs-execution-policy.template.json" "$work/execution-policy.json"
render "$root/infra/security/production-release-task-policy.template.json" "$work/release-policy.json"
render "$root/infra/security/production-api-task-policy.template.json" "$work/api-policy.json"
render "$root/infra/security/production-ai-task-policy.template.json" "$work/ai-policy.json"

ensure_existing_role() {
  local role="$1"
  aws iam get-role --role-name "$role" >/dev/null
}

ensure_a5_role() {
  local role="$1" trust="$2" policy="$3"
  if aws iam get-role --role-name "$role" >/dev/null 2>&1; then
    aws iam update-assume-role-policy --role-name "$role" --policy-document "file://$trust"
  else
    aws iam create-role --role-name "$role" --max-session-duration 7200 \
      --assume-role-policy-document "file://$trust" >/dev/null
  fi
  aws iam update-role --role-name "$role" --max-session-duration 7200 >/dev/null
  aws iam put-role-policy --role-name "$role" --policy-name "$role" \
    --policy-document "file://$policy"
}

ensure_existing_role "$deploy_role"
aws iam update-assume-role-policy --role-name "$deploy_role" \
  --policy-document "file://$work/deploy-trust.json"
aws iam update-role --role-name "$deploy_role" --max-session-duration 7200 >/dev/null
aws iam put-role-policy --role-name "$deploy_role" --policy-name "$deploy_policy_name" \
  --policy-document "file://$work/deploy-policy.json"

ensure_existing_role "$security_role"
aws iam update-assume-role-policy --role-name "$security_role" \
  --policy-document "file://$security_trust"
aws iam put-role-policy --role-name "$security_role" --policy-name "$security_policy_name" \
  --policy-document "file://$security_policy"

ensure_existing_role "$workers_role"
aws iam update-assume-role-policy --role-name "$workers_role" --policy-document "file://$task_trust"
aws iam put-role-policy --role-name "$workers_role" --policy-name "$workers_policy_name" \
  --policy-document "file://$work/workers-policy.json"

ensure_existing_role ecsTaskExecutionRole
aws iam update-assume-role-policy --role-name ecsTaskExecutionRole --policy-document "file://$task_trust"
aws iam put-role-policy --role-name ecsTaskExecutionRole \
  --policy-name watchdog-bms-ecs-execution-secrets \
  --policy-document "file://$work/execution-policy.json"
aws iam attach-role-policy --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy

ensure_existing_role watchdog-bms-release-task-role
aws iam update-assume-role-policy --role-name watchdog-bms-release-task-role \
  --policy-document "file://$task_trust"
aws iam put-role-policy --role-name watchdog-bms-release-task-role \
  --policy-name watchdog-bms-release-task-ecs-read \
  --policy-document "file://$work/release-policy.json"

ensure_existing_role ecsInfrastructureRoleForExpressServices
aws iam update-assume-role-policy --role-name ecsInfrastructureRoleForExpressServices \
  --policy-document "file://$infra_trust"
aws iam attach-role-policy --role-name ecsInfrastructureRoleForExpressServices \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices

ensure_existing_role watchdog-bms-ecs-express-api-role
aws iam update-assume-role-policy --role-name watchdog-bms-ecs-express-api-role \
  --policy-document "file://$task_trust"
aws iam put-role-policy --role-name watchdog-bms-ecs-express-api-role \
  --policy-name watchdog-bms-prod-api-runtime --policy-document "file://$work/api-policy.json"

ensure_existing_role watchdog-bms-ecs-express-ai-gateway-role
aws iam update-assume-role-policy --role-name watchdog-bms-ecs-express-ai-gateway-role \
  --policy-document "file://$task_trust"
aws iam put-role-policy --role-name watchdog-bms-ecs-express-ai-gateway-role \
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

# The deploy path rewrites this exact lifecycle before rollout. Repair/read it back here so a
# known stale bucket contract cannot consume a Production deploy attempt.
aws s3api put-bucket-lifecycle-configuration --region "$region" \
  --bucket watchdog-bms-prod-$account \
  --lifecycle-configuration "file://$root/infra/object-storage-lifecycle.json"
aws s3api get-bucket-lifecycle-configuration --region "$region" \
  --bucket watchdog-bms-prod-$account --output json \
  | jq -cS '{Rules:(.Rules|sort_by(.ID))}' > "$work/live-lifecycle.json"
jq -cS '{Rules:(.Rules|sort_by(.ID))}' "$root/infra/object-storage-lifecycle.json" \
  > "$work/expected-lifecycle.json"
cmp -s "$work/live-lifecycle.json" "$work/expected-lifecycle.json"

assert_exact_role() {
  local role="$1" policy_name="$2" trust="$3" policy="$4" max="$5"
  local expected_attached="${6:-[]}"
  local role_json="$work/$role.json" policy_json="$work/$role-policy.json"
  aws iam get-role --role-name "$role" --output json > "$role_json"
  aws iam get-role-policy --role-name "$role" --policy-name "$policy_name" --output json > "$policy_json"
  jq -e --arg arn "arn:aws:iam::$account:role/$role" --argjson max "$max" \
    --slurpfile expected "$trust" '
    .Role.Arn==$arn and .Role.MaxSessionDuration==$max
    and .Role.AssumeRolePolicyDocument==$expected[0]' "$role_json" >/dev/null
  jq -e --arg name "$policy_name" --slurpfile expected "$policy" \
    '.PolicyName==$name and .PolicyDocument==$expected[0]' "$policy_json" >/dev/null
  test "$(aws iam list-role-policies --role-name "$role" --output json | jq -cS '.PolicyNames|sort')" \
    = "$(jq -cnS --arg name "$policy_name" '[$name]')"
  test "$(aws iam list-attached-role-policies --role-name "$role" --output json \
    | jq -cS '[.AttachedPolicies[].PolicyArn]|sort')" = "$expected_attached"
}

assert_exact_role "$deploy_role" "$deploy_policy_name" "$work/deploy-trust.json" \
  "$work/deploy-policy.json" 7200
security_max="$(aws iam get-role --role-name "$security_role" --query Role.MaxSessionDuration --output text)"
assert_exact_role "$security_role" "$security_policy_name" "$security_trust" "$security_policy" "$security_max"
for index in "${!controller_roles[@]}"; do
  assert_exact_role "${controller_roles[$index]}" "${controller_roles[$index]}" \
    "${controller_trusts[$index]}" "${controller_policies[$index]}" 7200
done

assert_exact_role ecsTaskExecutionRole watchdog-bms-ecs-execution-secrets "$task_trust" \
  "$work/execution-policy.json" 3600 \
  '["arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"]'
assert_exact_role watchdog-bms-release-task-role watchdog-bms-release-task-ecs-read "$task_trust" \
  "$work/release-policy.json" 3600
assert_exact_role watchdog-bms-ecs-express-api-role watchdog-bms-prod-api-runtime "$task_trust" \
  "$work/api-policy.json" 3600
assert_exact_role watchdog-bms-ecs-express-ai-gateway-role watchdog-bms-ai-gateway-runtime \
  "$task_trust" "$work/ai-policy.json" 3600

infra_json="$work/ecs-infrastructure-role.json"
aws iam get-role --role-name ecsInfrastructureRoleForExpressServices --output json > "$infra_json"
jq -e --slurpfile trust "$infra_trust" '
  .Role.Arn=="arn:aws:iam::311414082667:role/ecsInfrastructureRoleForExpressServices"
  and .Role.AssumeRolePolicyDocument==$trust[0]' "$infra_json" >/dev/null
test "$(aws iam list-role-policies --role-name ecsInfrastructureRoleForExpressServices \
  --output json | jq -cS '.PolicyNames')" = '[]'
test "$(aws iam list-attached-role-policies --role-name ecsInfrastructureRoleForExpressServices \
  --output json | jq -cS '[.AttachedPolicies[].PolicyArn]|sort')" = \
  '["arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices"]'

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
for index in "${!execution_roles[@]}"; do
  trust="$execution_trust"
  [ "${execution_roles[$index]}" != watchdog-bms-production-a5-clone-execution ] || trust="$clone_trust"
  assert_exact_role "${execution_roles[$index]}" "${execution_roles[$index]}" "$trust" \
    "${execution_policies[$index]}" 7200
done

workers_role_json="$work/workers-role.json"
workers_policy_json="$work/workers-role-policy.json"
aws iam get-role --role-name "$workers_role" --output json > "$workers_role_json"
aws iam get-role-policy --role-name "$workers_role" --policy-name "$workers_policy_name" \
  --output json > "$workers_policy_json"
jq -e --arg arn "arn:aws:iam::$account:role/$workers_role" '
  .Role.Arn==$arn and .Role.AssumeRolePolicyDocument=={
    Version:"2012-10-17",Statement:[{Effect:"Allow",Principal:{Service:"ecs-tasks.amazonaws.com"},
      Action:"sts:AssumeRole"}]}' "$workers_role_json" >/dev/null
jq -e --arg name "$workers_policy_name" --slurpfile expected "$work/workers-policy.json" \
  '.PolicyName==$name and .PolicyDocument==$expected[0]' "$workers_policy_json" >/dev/null
test "$(aws iam list-role-policies --role-name "$workers_role" --output json | jq -cS '.PolicyNames|sort')" \
  = "$(jq -cnS --arg name "$workers_policy_name" '[$name]')"
test "$(aws iam list-attached-role-policies --role-name "$workers_role" --output json | jq -cS '.AttachedPolicies')" = '[]'

echo 'Production promotion IAM prerequisites applied and exact-read back under a non-root principal.'
