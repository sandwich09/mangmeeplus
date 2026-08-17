#!/usr/bin/env bash
# Must be the first AWS action after GitHub assumes watchdog-bms-deploy-uat.
set -euo pipefail

region="${AWS_REGION:-ap-southeast-1}"
aws_bin="${AWS_BIN:-aws}"
aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy "$aws_bin" "$@"
}
account_id="$(aws_cmd sts get-caller-identity --query Account --output text --region "$region")"
[[ "$account_id" =~ ^[0-9]{12}$ ]]
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-uat-policy-preflight.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

sed "s/<ACCOUNT_ID>/${account_id}/g" infra/uat/github-deploy-role-policy.template.json \
  | jq -S . > "$tmp_dir/deploy-expected.json"
jq -n --arg region "$region" --arg account "$account_id" '{
  Version:"2012-10-17",
  Statement:[
    {Effect:"Allow",Action:["ecs:DescribeExpressGatewayService","ecs:DescribeServiceDeployments","ecs:ListServiceDeployments"],Resource:"*"},
    {Effect:"Allow",Action:["ssm:GetParameter","ssm:PutParameter"],Resource:("arn:aws:ssm:"+$region+":"+$account+":parameter/watchdog-bms/uat/ecs-express-*-service-arn")}
  ]
}' | jq -S . > "$tmp_dir/release-expected.json"
runtime_list="$(aws_cmd bedrock-agentcore-control list-agent-runtimes --region "$region" --output json)"
runtime_count="$(jq '[.agentRuntimes[]? | select(.agentRuntimeName=="watchdog_orchestrator_uat_candidate")]|length' <<< "$runtime_list")"
case "$runtime_count" in
  0) agentcore_runtime_arn="arn:aws:bedrock-agentcore:${region}:${account_id}:runtime/watchdog_orchestrator_uat_candidate-*" ;;
  1)
    agentcore_runtime_arn="$(jq -er '
      .agentRuntimes[] | select(.agentRuntimeName=="watchdog_orchestrator_uat_candidate")
      | select(.status=="READY") | .agentRuntimeArn
      | select(test("^arn:aws:bedrock-agentcore:[a-z0-9-]+:[0-9]{12}:runtime/watchdog_orchestrator_uat_candidate-[A-Za-z0-9]{10}$"))
    ' <<< "$runtime_list")" ;;
  *) echo "ERROR: more than one UAT AgentCore candidate runtime exists" >&2; exit 1 ;;
esac

sed -e "s|<ACCOUNT_ID>|${account_id}|g" \
  -e "s|<AGENTCORE_RUNTIME_ARN>|${agentcore_runtime_arn}|g" \
  infra/uat/ai-task-policy.template.json | jq -S . > "$tmp_dir/ai-expected.json"
sed -e "s|<ACCOUNT_ID>|${account_id}|g" \
  -e "s|<AGENTCORE_RUNTIME_ARN>|${agentcore_runtime_arn}|g" \
  infra/ai-gateway/agentcore-execution-role-trust.template.json \
  | jq -S . > "$tmp_dir/agentcore-trust-expected.json"

secret_arn() {
  local name="$1" arn
  arn="$(aws_cmd secretsmanager describe-secret --region "$region" --secret-id "$name" \
    --query ARN --output text)"
  [[ "$arn" == arn:aws:secretsmanager:"${region}":"${account_id}":secret:"${name}"-* ]] || return 1
  printf '%s' "$arn"
}
agentcore_ai_secret_arn="$(secret_arn watchdog-bms/uat/ai-gateway-internal-secret)"
agentcore_jwt_secret_arn="$(secret_arn watchdog-bms/uat/watchdog-jwt-secret)"
sed -e "s|<ACCOUNT_ID>|${account_id}|g" \
  -e "s|<AI_GATEWAY_SECRET_ARN>|${agentcore_ai_secret_arn}|g" \
  -e "s|<WATCHDOG_JWT_SECRET_SOURCE_ARN>|${agentcore_jwt_secret_arn}|g" \
  infra/ai-gateway/agentcore-execution-role-policy.json \
  | jq -S . > "$tmp_dir/agentcore-policy-expected.json"

verify() {
  local role="$1" policy="$2" expected="$3"
  local actual="$tmp_dir/${role}-actual.json"
  if ! aws_cmd iam get-role-policy --role-name "$role" --policy-name "$policy" \
    --query PolicyDocument --output json --region "$region" | jq -S . > "$actual"; then
    echo "ERROR: control-plane preflight cannot read role=${role} policy=${policy}; no environment mutation is allowed" >&2
    exit 1
  fi
  if ! cmp -s "$actual" "$expected"; then
    echo "ERROR: control-plane policy drift role=${role} policy=${policy}; no environment mutation is allowed" >&2
    exit 1
  fi
}

verify_exact_role() {
  local role="$1" policy="$2" trust="$3" expected_policy="$4"
  local role_json="$tmp_dir/${role}-role.json"
  local actual_policy="$tmp_dir/${role}-policy.json"
  aws_cmd iam get-role --role-name "$role" --output json > "$role_json"
  aws_cmd iam get-role-policy --role-name "$role" --policy-name "$policy" \
    --output json > "$actual_policy"
  jq -e --arg arn "arn:aws:iam::${account_id}:role/${role}" --slurpfile expected "$trust" '
    .Role.Arn==$arn and .Role.Path=="/" and .Role.MaxSessionDuration==3600
    and (.Role|has("PermissionsBoundary")|not)
    and .Role.AssumeRolePolicyDocument==$expected[0]
  ' "$role_json" >/dev/null
  jq -e --arg name "$policy" --slurpfile expected "$expected_policy" '
    .PolicyName==$name and .PolicyDocument==$expected[0]
  ' "$actual_policy" >/dev/null
  test "$(aws_cmd iam list-role-policies --role-name "$role" --output json | jq -cS '.PolicyNames|sort')" \
    = "$(jq -cnS --arg name "$policy" '[$name]')"
  test "$(aws_cmd iam list-attached-role-policies --role-name "$role" --output json | jq -cS '.AttachedPolicies')" = '[]'
}

verify watchdog-bms-deploy-uat watchdog-bms-uat-deploy "$tmp_dir/deploy-expected.json"
verify watchdog-bms-uat-release-task-role watchdog-bms-uat-release-task-ecs-read "$tmp_dir/release-expected.json"
printf '%s\n' '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
  | jq -S . > "$tmp_dir/task-trust-expected.json"
verify_exact_role watchdog-bms-uat-ecs-ai-gateway-role watchdog-bms-uat-ai-gateway-runtime \
  "$tmp_dir/task-trust-expected.json" "$tmp_dir/ai-expected.json"
verify_exact_role watchdog-bms-uat-agentcore-execution-role watchdog-bms-agentcore-permissions \
  "$tmp_dir/agentcore-trust-expected.json" "$tmp_dir/agentcore-policy-expected.json"
test "$(aws_cmd s3api get-bucket-versioning --region "$region" \
  --bucket "watchdog-bms-agentcore-artifacts-${account_id}" --query Status --output text)" = Enabled
echo "UAT control-plane, AgentCore role, secrets, and artifact bucket verified before mutation"
