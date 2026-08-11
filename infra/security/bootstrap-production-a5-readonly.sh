#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
account_id=311414082667
region=ap-southeast-1
source_db_identifier=watchdog-bms-prod-db
controller_role=watchdog-bms-production-a5-readonly
reader_bootstrap_role=watchdog-bms-production-a5-reader-bootstrap
reader_execution_role=watchdog-bms-production-a5-readonly-execution
bootstrap_execution_role=watchdog-bms-production-a5-bootstrap-execution
apply_execution_role=watchdog-bms-production-a5-apply-execution
parameter_prefix=/watchdog-bms/production/a5-readonly-runtime
task_sg_name=watchdog-bms-production-a5-readonly-task
reader_log_group=/ecs/watchdog-bms-production-a5-readonly
bootstrap_log_group=/ecs/watchdog-bms-production-a5-bootstrap
apply_log_group=/ecs/watchdog-bms-production-a5-apply

controller_trust="$repo_root/infra/security/production-a5-readonly-trust.template.json"
controller_policy="$repo_root/infra/security/production-a5-readonly-policy.template.json"
reader_bootstrap_policy="$repo_root/infra/security/production-a5-reader-bootstrap-policy.template.json"
execution_trust="$repo_root/infra/security/production-a5-readonly-execution-trust.template.json"
reader_policy="$repo_root/infra/security/production-a5-readonly-execution-policy.template.json"
bootstrap_policy="$repo_root/infra/security/production-a5-bootstrap-execution-policy.template.json"
apply_policy="$repo_root/infra/security/production-a5-apply-execution-policy.template.json"
sg_validator="$repo_root/infra/security/validate-production-a5-readonly-security-groups.sh"
network_bootstrap="$repo_root/infra/security/bootstrap-production-a5-private-network.sh"
jq -e . "$controller_trust" "$controller_policy" "$reader_bootstrap_policy" "$execution_trust" \
  "$reader_policy" "$bootstrap_policy" "$apply_policy" >/dev/null

if [ "${1:-}" != --apply ]; then
  printf '%s\n' 'Dry run only. Re-run with --apply after reviewing the exact IAM/network templates.'
  printf '%s\n' "Controller: arn:aws:iam::$account_id:role/$controller_role (never reads a secret value)"
  printf '%s\n' "One-time reader bootstrap: arn:aws:iam::$account_id:role/$reader_bootstrap_role (self-revoked)"
  printf '%s\n' "Reader execution: arn:aws:iam::$account_id:role/$reader_execution_role"
  printf '%s\n' "Bootstrap execution: arn:aws:iam::$account_id:role/$bootstrap_execution_role"
  printf '%s\n' "Reviewed apply execution: arn:aws:iam::$account_id:role/$apply_execution_role"
  printf '%s\n' 'Network: private endpoints + read-only ECR S3 + tcp/5432 only to production DB SG'
  exit 0
fi

test "${AWS_ACCOUNT_ID:?AWS_ACCOUNT_ID is required}" = "$account_id"
test "$(aws sts get-caller-identity --region "$region" --query Account --output text)" = "$account_id"
AWS_ACCOUNT_ID="$account_id" bash "$network_bootstrap" --apply

ensure_role() {
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

assert_role() {
  local role="$1" trust="$2" policy="$3" role_json policy_json
  role_json="$(mktemp "${TMPDIR:-/tmp}/production-a5-role.XXXXXX")"
  policy_json="$(mktemp "${TMPDIR:-/tmp}/production-a5-policy.XXXXXX")"
  aws iam get-role --role-name "$role" --output json > "$role_json"
  aws iam get-role-policy --role-name "$role" --policy-name "$role" --output json > "$policy_json"
  jq -e --slurpfile expected "$trust" \
    '.Role.MaxSessionDuration==7200 and .Role.AssumeRolePolicyDocument==$expected[0]' \
    "$role_json" >/dev/null
  jq -e --slurpfile expected "$policy" --arg name "$role" \
    '.PolicyName==$name and .PolicyDocument==$expected[0]' "$policy_json" >/dev/null
  test "$(aws iam list-role-policies --role-name "$role" --output json | jq -cS '.PolicyNames|sort')" \
    = "$(jq -cnS --arg name "$role" '[$name]')"
  test "$(aws iam list-attached-role-policies --role-name "$role" --output json | jq -cS '.AttachedPolicies')" = '[]'
  rm -f -- "$role_json" "$policy_json"
}

source_db="$(aws rds describe-db-instances --region "$region" \
  --db-instance-identifier "$source_db_identifier" --query 'DBInstances[0]' --output json)"
jq -e --arg id "$source_db_identifier" '
  .DBInstanceIdentifier==$id and .Engine=="postgres" and .PubliclyAccessible==false
  and .DBInstanceStatus=="available"
  and ([.VpcSecurityGroups[]|select(.Status=="active")]|length)==1
' <<< "$source_db" >/dev/null
vpc_id="$(jq -er '.DBSubnetGroup.VpcId|select(test("^vpc-[0-9a-f]{8,17}$"))' <<< "$source_db")"
database_sg="$(jq -er '[.VpcSecurityGroups[]|select(.Status=="active")][0].VpcSecurityGroupId' <<< "$source_db")"

network_parameter() {
  aws ssm get-parameter --region "$region" --name "/watchdog-bms/production/a5-network/$1" \
    --query Parameter.Value --output text
}
test "$(network_parameter vpc-id)" = "$vpc_id"
test "$(network_parameter production-db-security-group-id)" = "$database_sg"
task_sg="$(network_parameter reader-task-security-group-id)"
endpoint_sg="$(network_parameter endpoint-security-group-id)"
s3_prefix_list="$(network_parameter s3-prefix-list-id)"
subnet_csv="$(network_parameter task-subnet-ids)"
task_exact="$(mktemp "${TMPDIR:-/tmp}/production-a5-task-sg.XXXXXX")"
db_exact="$(mktemp "${TMPDIR:-/tmp}/production-a5-db-sg.XXXXXX")"
trap 'rm -f -- "$task_exact" "$db_exact"' EXIT
aws ec2 describe-security-groups --region "$region" --group-ids "$task_sg" --output json > "$task_exact"
aws ec2 describe-security-groups --region "$region" --group-ids "$database_sg" --output json > "$db_exact"
bash "$sg_validator" "$task_exact" "$db_exact" "$task_sg" "$database_sg" \
  "$endpoint_sg" "$s3_prefix_list" exact
rm -f -- "$task_exact" "$db_exact"
trap - EXIT

ensure_role "$controller_role" "$controller_trust" "$controller_policy"
ensure_role "$reader_bootstrap_role" "$controller_trust" "$reader_bootstrap_policy"
ensure_role "$reader_execution_role" "$execution_trust" "$reader_policy"
ensure_role "$bootstrap_execution_role" "$execution_trust" "$bootstrap_policy"
ensure_role "$apply_execution_role" "$execution_trust" "$apply_policy"
for log_group in "$reader_log_group" "$bootstrap_log_group" "$apply_log_group"; do
  aws logs create-log-group --region "$region" --log-group-name "$log_group" >/dev/null 2>&1 || true
  aws logs put-retention-policy --region "$region" --log-group-name "$log_group" --retention-in-days 7
done

put_parameter() {
  aws ssm put-parameter --region "$region" --name "$parameter_prefix/$1" --type String \
    --value "$2" --overwrite >/dev/null
}
put_parameter db-instance-identifier "$source_db_identifier"
put_parameter db-security-group-id "$database_sg"
put_parameter task-security-group-id "$task_sg"
put_parameter task-subnet-ids "$subnet_csv"
put_parameter reader-execution-role-arn "arn:aws:iam::$account_id:role/$reader_execution_role"
put_parameter bootstrap-execution-role-arn "arn:aws:iam::$account_id:role/$bootstrap_execution_role"
put_parameter apply-execution-role-arn "arn:aws:iam::$account_id:role/$apply_execution_role"
put_parameter reader-log-group-name "$reader_log_group"
put_parameter bootstrap-log-group-name "$bootstrap_log_group"
put_parameter apply-log-group-name "$apply_log_group"

assert_role "$controller_role" "$controller_trust" "$controller_policy"
assert_role "$reader_bootstrap_role" "$controller_trust" "$reader_bootstrap_policy"
assert_role "$reader_execution_role" "$execution_trust" "$reader_policy"
assert_role "$bootstrap_execution_role" "$execution_trust" "$bootstrap_policy"
assert_role "$apply_execution_role" "$execution_trust" "$apply_policy"
parameters="$(aws ssm get-parameters --region "$region" --names \
  "$parameter_prefix/db-instance-identifier" "$parameter_prefix/db-security-group-id" \
  "$parameter_prefix/task-security-group-id" "$parameter_prefix/task-subnet-ids" \
  "$parameter_prefix/reader-execution-role-arn" "$parameter_prefix/bootstrap-execution-role-arn" \
  "$parameter_prefix/apply-execution-role-arn" "$parameter_prefix/reader-log-group-name" \
  "$parameter_prefix/bootstrap-log-group-name" "$parameter_prefix/apply-log-group-name" --output json)"
jq -e --arg prefix "$parameter_prefix" --arg db "$source_db_identifier" --arg dbSg "$database_sg" \
  --arg taskSg "$task_sg" --arg subnets "$subnet_csv" \
  --arg reader "arn:aws:iam::$account_id:role/$reader_execution_role" \
  --arg bootstrap "arn:aws:iam::$account_id:role/$bootstrap_execution_role" \
  --arg apply "arn:aws:iam::$account_id:role/$apply_execution_role" \
  --arg readerLog "$reader_log_group" --arg bootstrapLog "$bootstrap_log_group" \
  --arg applyLog "$apply_log_group" '
  .InvalidParameters==[] and (.Parameters|length)==10 and all(.Parameters[];.Type=="String")
  and (.Parameters|map({key:.Name,value:.Value})|from_entries)=={
    ($prefix+"/db-instance-identifier"):$db,($prefix+"/db-security-group-id"):$dbSg,
    ($prefix+"/task-security-group-id"):$taskSg,($prefix+"/task-subnet-ids"):$subnets,
    ($prefix+"/reader-execution-role-arn"):$reader,
    ($prefix+"/bootstrap-execution-role-arn"):$bootstrap,
    ($prefix+"/apply-execution-role-arn"):$apply,
    ($prefix+"/reader-log-group-name"):$readerLog,
    ($prefix+"/bootstrap-log-group-name"):$bootstrapLog,
    ($prefix+"/apply-log-group-name"):$applyLog}
' <<< "$parameters" >/dev/null

printf '%s\n' "Provisioned dedicated production A5 controller/execution roles and private reader network $task_sg -> $database_sg"
