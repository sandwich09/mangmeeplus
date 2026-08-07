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

verify watchdog-bms-deploy-uat watchdog-bms-uat-deploy "$tmp_dir/deploy-expected.json"
verify watchdog-bms-uat-release-task-role watchdog-bms-uat-release-task-ecs-read "$tmp_dir/release-expected.json"
echo "UAT control-plane policies verified before mutation"
