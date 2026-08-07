#!/usr/bin/env bash
set -euo pipefail

region="${AWS_REGION:-ap-southeast-1}"
aws_bin="${AWS_BIN:-aws}"

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy "$aws_bin" "$@"
}

account_id="$(aws_cmd sts get-caller-identity --query Account --output text --region "$region")"
if [[ ! "$account_id" =~ ^[0-9]{12}$ ]]; then
  echo "ERROR: AWS account ID is invalid" >&2
  exit 1
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-bms-uat-control.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

# A setup run is allowed to mutate IAM only after proving that the caller can read back the two
# policies which authorize the deploy controller and the fenced release task. Missing bootstrap
# roles/policies are safe (there is nothing to overwrite); AccessDenied and every other error stop
# here, before ensure_role/attach-role-policy/put-role-policy can change the account.
probe_inline_policy_read() {
  local role="$1" policy="$2"
  local error_file="$tmp_dir/get-role-policy-${role}.err"
  if aws_cmd iam get-role-policy --role-name "$role" --policy-name "$policy" \
    --query PolicyDocument --output json >/dev/null 2>"$error_file"; then
    return 0
  fi
  if grep -qE 'NoSuchEntity|cannot be found' "$error_file"; then
    return 0
  fi
  echo "ERROR: cannot preflight iam:GetRolePolicy for ${role}/${policy}; refusing every setup mutation" >&2
  cat "$error_file" >&2
  exit 1
}

render() {
  sed "s/<ACCOUNT_ID>/${account_id}/g" "$1" > "$2"
}

ensure_role() {
  local role="$1" trust="$2"
  if ! aws_cmd iam get-role --role-name "$role" >/dev/null 2>&1; then
    aws_cmd iam create-role --role-name "$role" --assume-role-policy-document "file://${trust}" >/dev/null
  fi
  aws_cmd iam get-role --role-name "$role" --query Role.AssumeRolePolicyDocument --output json | jq -S . > "$tmp_dir/${role}-actual-trust.json"
  jq -S . "$trust" > "$tmp_dir/${role}-expected-trust.json"
  if ! cmp -s "$tmp_dir/${role}-actual-trust.json" "$tmp_dir/${role}-expected-trust.json"; then
    echo "ERROR: trust policy drift for $role; review before granting iam:UpdateAssumeRolePolicy" >&2
    exit 1
  fi
}

task_trust="$tmp_dir/task-trust.json"
infra_trust="$tmp_dir/infra-trust.json"
github_trust="$tmp_dir/github-trust.json"
publish_policy="$tmp_dir/publish-policy.json"
deploy_policy="$tmp_dir/deploy-policy.json"

jq -n '{Version:"2012-10-17",Statement:[{Effect:"Allow",Principal:{Service:"ecs-tasks.amazonaws.com"},Action:"sts:AssumeRole"}]}' > "$task_trust"
jq -n '{Version:"2012-10-17",Statement:[{Sid:"AllowAccessInfrastructureForECSExpressServices",Effect:"Allow",Principal:{Service:"ecs.amazonaws.com"},Action:"sts:AssumeRole"}]}' > "$infra_trust"
render infra/uat/github-role-trust.template.json "$github_trust"
render infra/uat/github-publish-role-policy.template.json "$publish_policy"
render infra/uat/github-deploy-role-policy.template.json "$deploy_policy"

execution_role="watchdog-bms-uat-ecs-execution-role"
infra_role="watchdog-bms-uat-ecs-infrastructure-role"
api_role="watchdog-bms-uat-ecs-api-role"
ai_role="watchdog-bms-uat-ecs-ai-gateway-role"
workers_role="watchdog-bms-uat-ecs-workers-role"
release_role="watchdog-bms-uat-release-task-role"
publish_role="watchdog-bms-ci-uat"
deploy_role="watchdog-bms-deploy-uat"

# One-time bridge for a caller which can write the two policies but cannot yet read them back. It may
# create ONLY the missing release-task role (the deploy role must already exist), with the exact ECS
# task trust below. It never creates/updates any other role and never touches ECS/ECR/SSM. The next
# GitHub controller run must still pass exact policy readback before any environment mutation.
bootstrap_release_policy="$tmp_dir/bootstrap-release-policy.json"
jq -n --arg region "$region" --arg account "$account_id" '{
  Version:"2012-10-17",
  Statement:[
    {Effect:"Allow",Action:["ecs:DescribeExpressGatewayService","ecs:DescribeServiceDeployments","ecs:ListServiceDeployments"],Resource:"*"},
    {Effect:"Allow",Action:["ssm:GetParameter","ssm:PutParameter"],Resource:("arn:aws:ssm:"+$region+":"+$account+":parameter/watchdog-bms/uat/ecs-express-*-service-arn")}
  ]
}' > "$bootstrap_release_policy"
if [ "${UAT_IAM_BOOTSTRAP_APPLY_UNVERIFIED:-false}" = "true" ]; then
  deploy_role_error="$tmp_dir/bootstrap-deploy-role.err"
  if ! aws_cmd iam get-role --role-name "$deploy_role" --output json > "$tmp_dir/bootstrap-deploy-role.json" 2>"$deploy_role_error"; then
    echo "ERROR: one-shot bootstrap requires the existing ${deploy_role}; refusing to create or guess it" >&2
    cat "$deploy_role_error" >&2
    exit 1
  fi
  release_role_error="$tmp_dir/bootstrap-release-role.err"
  if aws_cmd iam get-role --role-name "$release_role" --output json > "$tmp_dir/bootstrap-release-role.json" 2>"$release_role_error"; then
    :
  elif grep -qE 'NoSuchEntity|cannot be found' "$release_role_error"; then
    aws_cmd iam create-role --role-name "$release_role" \
      --assume-role-policy-document "file://$task_trust" >/dev/null
    aws_cmd iam get-role --role-name "$release_role" --output json > "$tmp_dir/bootstrap-release-role.json"
  else
    echo "ERROR: cannot resolve exact ${release_role} state; refusing one-shot IAM mutation" >&2
    cat "$release_role_error" >&2
    exit 1
  fi
  jq -S '.Role.AssumeRolePolicyDocument' "$tmp_dir/bootstrap-release-role.json" \
    > "$tmp_dir/bootstrap-release-trust-actual.json"
  jq -S . "$task_trust" > "$tmp_dir/bootstrap-release-trust-expected.json"
  if ! cmp -s "$tmp_dir/bootstrap-release-trust-actual.json" "$tmp_dir/bootstrap-release-trust-expected.json"; then
    echo "ERROR: ${release_role} trust policy is not the exact ECS-task trust; refusing policy writes" >&2
    exit 1
  fi
  aws_cmd iam put-role-policy --role-name "$deploy_role" --policy-name watchdog-bms-uat-deploy \
    --policy-document "file://$deploy_policy"
  aws_cmd iam put-role-policy --role-name "$release_role" --policy-name watchdog-bms-uat-release-task-ecs-read \
    --policy-document "file://$bootstrap_release_policy"
  echo "APPLIED_BUT_UNVERIFIED: role=${deploy_role} policy=watchdog-bms-uat-deploy" >&2
  echo "APPLIED_BUT_UNVERIFIED: role=${release_role} policy=watchdog-bms-uat-release-task-ecs-read" >&2
  echo "NEXT: rerun without UAT_IAM_BOOTSTRAP_APPLY_UNVERIFIED; both inline policies must exact-read before any broader setup or deploy" >&2
  exit 75
fi

probe_inline_policy_read "$deploy_role" watchdog-bms-uat-deploy
probe_inline_policy_read "$release_role" watchdog-bms-uat-release-task-ecs-read

ensure_role "$execution_role" "$task_trust"
aws_cmd iam attach-role-policy --role-name "$execution_role" --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy >/dev/null
jq -n --arg region "$region" --arg account "$account_id" '{
  Version:"2012-10-17",
  Statement:[
    {Effect:"Allow",Action:["secretsmanager:GetSecretValue"],Resource:("arn:aws:secretsmanager:"+$region+":"+$account+":secret:watchdog-bms/uat/*")},
    {Effect:"Allow",Action:["ssm:GetParameters"],Resource:("arn:aws:ssm:"+$region+":"+$account+":parameter/watchdog-bms/uat/*")}
  ]
}' > "$tmp_dir/execution-policy.json"
aws_cmd iam put-role-policy --role-name "$execution_role" --policy-name watchdog-bms-uat-ecs-execution-secrets --policy-document "file://$tmp_dir/execution-policy.json"

ensure_role "$infra_role" "$infra_trust"
aws_cmd iam attach-role-policy --role-name "$infra_role" --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices >/dev/null

ensure_role "$api_role" "$task_trust"
jq -n --arg region "$region" --arg account "$account_id" '{
  Version:"2012-10-17",
  Statement:[
    {Effect:"Allow",Action:["secretsmanager:GetSecretValue"],Resource:("arn:aws:secretsmanager:"+$region+":"+$account+":secret:watchdog-bms/uat/*")},
    {Effect:"Allow",Action:["ssm:GetParameter"],Resource:("arn:aws:ssm:"+$region+":"+$account+":parameter/watchdog-bms/uat/*")},
    {Effect:"Allow",Action:["s3:GetObject","s3:GetObjectVersion","s3:PutObject","s3:DeleteObject","s3:DeleteObjectVersion"],Resource:("arn:aws:s3:::watchdog-bms-uat-"+$account+"/*")}
  ]
}' > "$tmp_dir/api-policy.json"
aws_cmd iam put-role-policy --role-name "$api_role" --policy-name watchdog-bms-uat-api-runtime --policy-document "file://$tmp_dir/api-policy.json"

ensure_role "$ai_role" "$task_trust"
# Both inference-profile families: UAT runs the regional profile by default and mirrors
# production's global one when an approval reference is supplied (see the DEPLOY_ENV
# branch in infra/prod-ecs-express/deploy.sh). Keep this in step with the AI policy
# there — deploy.sh rewrites this same policy name on every UAT deploy, so a narrower
# list here only bites in the window between bootstrap and first deploy.
jq -n --arg account "$account_id" '{
  Version:"2012-10-17",
  Statement:[{
    Effect:"Allow",
    Action:["bedrock:InvokeModel","bedrock:InvokeModelWithResponseStream"],
    Resource:["arn:aws:bedrock:*::foundation-model/anthropic.*",("arn:aws:bedrock:*:"+$account+":inference-profile/apac.anthropic.*"),("arn:aws:bedrock:*:"+$account+":inference-profile/global.anthropic.*")]
  }]
}' > "$tmp_dir/ai-policy.json"
aws_cmd iam put-role-policy --role-name "$ai_role" --policy-name watchdog-bms-uat-ai-gateway-runtime --policy-document "file://$tmp_dir/ai-policy.json"

ensure_role "$workers_role" "$task_trust"

# Release/F2/retirement tasks use a deliberately narrow task role. The retirement wrapper re-reads
# the exact ECS Express deployment and active revision manifest from inside the durable DB fence;
# without these two reads it records UNKNOWN and performs no authority mutation.
ensure_role "$release_role" "$task_trust"
cp "$bootstrap_release_policy" "$tmp_dir/release-policy.json"
aws_cmd iam put-role-policy \
  --role-name "$release_role" \
  --policy-name watchdog-bms-uat-release-task-ecs-read \
  --policy-document "file://$tmp_dir/release-policy.json"
if ! aws_cmd iam get-role-policy --role-name "$release_role" --policy-name watchdog-bms-uat-release-task-ecs-read \
  --query PolicyDocument --output json | jq -S . > "$tmp_dir/release-policy-actual.json"; then
  echo "APPLIED_BUT_UNVERIFIED: role=${release_role} policy=watchdog-bms-uat-release-task-ecs-read" >&2
  exit 1
fi
jq -S . "$tmp_dir/release-policy.json" > "$tmp_dir/release-policy-expected.json"
if ! cmp -s "$tmp_dir/release-policy-actual.json" "$tmp_dir/release-policy-expected.json"; then
  echo "APPLIED_BUT_UNVERIFIED: role=${release_role} policy=watchdog-bms-uat-release-task-ecs-read (readback mismatch)" >&2
  exit 1
fi

ensure_role "$publish_role" "$github_trust"
aws_cmd iam put-role-policy --role-name "$publish_role" --policy-name watchdog-bms-uat-ecr-publish --policy-document "file://$publish_policy"

ensure_role "$deploy_role" "$github_trust"
aws_cmd iam put-role-policy --role-name "$deploy_role" --policy-name watchdog-bms-uat-deploy --policy-document "file://$deploy_policy"
if ! aws_cmd iam get-role-policy --role-name "$deploy_role" --policy-name watchdog-bms-uat-deploy \
  --query PolicyDocument --output json | jq -S . > "$tmp_dir/deploy-policy-actual.json"; then
  echo "APPLIED_BUT_UNVERIFIED: role=${deploy_role} policy=watchdog-bms-uat-deploy" >&2
  exit 1
fi
jq -S . "$deploy_policy" > "$tmp_dir/deploy-policy-expected.json"
if ! cmp -s "$tmp_dir/deploy-policy-actual.json" "$tmp_dir/deploy-policy-expected.json"; then
  echo "APPLIED_BUT_UNVERIFIED: role=${deploy_role} policy=watchdog-bms-uat-deploy (readback mismatch)" >&2
  exit 1
fi

echo "AWS_ROLE_ARN=arn:aws:iam::${account_id}:role/${publish_role}"
echo "AWS_DEPLOY_ROLE_ARN=arn:aws:iam::${account_id}:role/${deploy_role}"
