#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
account_id=311414082667
region=ap-southeast-1
source_db_identifier=watchdog-bms-prod-db
controller_role=watchdog-bms-production-a5-clone
execution_role=watchdog-bms-production-a5-clone-execution
controller_policy=watchdog-bms-production-a5-clone
execution_policy=watchdog-bms-production-a5-clone-execution
repository=watchdog-bms-migration-tool
log_group=/ecs/watchdog-bms-production-a5-clone
parameter_prefix=/watchdog-bms/production/a5-clone
task_sg_name=watchdog-bms-production-a5-clone-task
db_sg_name=watchdog-bms-production-a5-clone-db

controller_trust="$repo_root/infra/security/production-a5-clone-trust.template.json"
controller_policy_file="$repo_root/infra/security/production-a5-clone-policy.template.json"
execution_trust="$repo_root/infra/security/production-a5-clone-execution-trust.template.json"
execution_policy_file="$repo_root/infra/security/production-a5-clone-execution-policy.template.json"
sg_validator="$repo_root/infra/security/validate-production-a5-clone-security-groups.sh"
network_bootstrap="$repo_root/infra/security/bootstrap-production-a5-private-network.sh"

jq -e . "$controller_trust" "$controller_policy_file" "$execution_trust" "$execution_policy_file" >/dev/null
if [ "${1:-}" != --apply ]; then
  printf '%s\n' "Dry run only. Re-run with --apply after reviewing the four exact IAM templates."
  printf '%s\n' "Controller: arn:aws:iam::$account_id:role/$controller_role"
  printf '%s\n' "Execution: arn:aws:iam::$account_id:role/$execution_role"
  printf '%s\n' "Network: shared private endpoints + read-only ECR S3 + dedicated clone DB tcp/5432"
  exit 0
fi

test "${AWS_ACCOUNT_ID:?AWS_ACCOUNT_ID is required}" = "$account_id"
test "$(aws sts get-caller-identity --query Account --output text)" = "$account_id"

ensure_role() {
  local name="$1" trust="$2" policy_name="$3" policy_file="$4"
  if aws iam get-role --role-name "$name" >/dev/null 2>&1; then
    aws iam update-assume-role-policy --role-name "$name" --policy-document "file://$trust"
  else
    aws iam create-role --role-name "$name" --max-session-duration 7200 \
      --assume-role-policy-document "file://$trust" >/dev/null
  fi
  aws iam update-role --role-name "$name" --max-session-duration 7200 >/dev/null
  aws iam put-role-policy --role-name "$name" --policy-name "$policy_name" \
    --policy-document "file://$policy_file"
}

assert_role_exact() {
  local name="$1" trust="$2" policy_name="$3" policy_file="$4" observed_role observed_policy
  observed_role="$(mktemp "${TMPDIR:-/tmp}/a5-clone-role.XXXXXX")"
  observed_policy="$(mktemp "${TMPDIR:-/tmp}/a5-clone-policy.XXXXXX")"
  aws iam get-role --role-name "$name" --output json > "$observed_role"
  aws iam get-role-policy --role-name "$name" --policy-name "$policy_name" --output json \
    > "$observed_policy"
  jq -e --slurpfile expected "$trust" '
    .Role.MaxSessionDuration == 7200
    and .Role.AssumeRolePolicyDocument == $expected[0]
  ' "$observed_role" >/dev/null
  jq -e --slurpfile expected "$policy_file" --arg name "$policy_name" '
    .PolicyName == $name and .PolicyDocument == $expected[0]
  ' "$observed_policy" >/dev/null
  test "$(aws iam list-role-policies --role-name "$name" --output json \
    | jq -cS '.PolicyNames|sort')" = "$(jq -cnS --arg name "$policy_name" '[$name]')"
  test "$(aws iam list-attached-role-policies --role-name "$name" --output json \
    | jq -cS '.AttachedPolicies')" = '[]'
  rm -f -- "$observed_role" "$observed_policy"
}

source_db="$(aws rds describe-db-instances --region "$region" \
  --db-instance-identifier "$source_db_identifier" --query 'DBInstances[0]' --output json)"
vpc_id="$(jq -er '.DBSubnetGroup.VpcId|select(test("^vpc-[0-9a-f]{8,17}$"))' <<< "$source_db")"
db_subnet_group="$(jq -er '.DBSubnetGroup.DBSubnetGroupName|select(length>0)' <<< "$source_db")"
db_parameter_group="$(jq -er '
  .DBParameterGroups | select(length==1) | .[0]
  | select(.ParameterApplyStatus=="in-sync") | .DBParameterGroupName
' <<< "$source_db")"
option_group="$(jq -er '
  .OptionGroupMemberships | select(length==1) | .[0]
  | select(.Status=="in-sync") | .OptionGroupName
' <<< "$source_db")"
restore_resources="$(jq -cS --arg target "arn:aws:rds:$region:$account_id:db:watchdog-a5-clone-*" \
  --arg snapshot "arn:aws:rds:$region:$account_id:snapshot:rds:$source_db_identifier-*" \
  --arg subnet "arn:aws:rds:$region:$account_id:subgrp:$db_subnet_group" \
  --arg parameter "arn:aws:rds:$region:$account_id:pg:$db_parameter_group" \
  --arg option "arn:aws:rds:$region:$account_id:og:$option_group" \
  '[$target,$snapshot,$subnet,$parameter,$option]|sort' <<< '{}')"
test "$(jq -cS '
  [.Statement[] | select(.Sid=="AllowTaggedCloneRestore")][0].Resource | sort
' "$controller_policy_file")" = "$restore_resources"

# Do not mutate the shared private-network prerequisites until the live source configuration and
# the reviewed restore policy are proved to describe the same five provider resources.
AWS_ACCOUNT_ID="$account_id" bash "$network_bootstrap" --apply
network_parameter() {
  aws ssm get-parameter --region "$region" --name "/watchdog-bms/production/a5-network/$1" \
    --query Parameter.Value --output text
}
test "$(network_parameter vpc-id)" = "$vpc_id"
task_sg="$(network_parameter clone-task-security-group-id)"
db_sg="$(network_parameter clone-db-security-group-id)"
endpoint_sg="$(network_parameter endpoint-security-group-id)"
s3_prefix_list="$(network_parameter s3-prefix-list-id)"

task_sg_before="$(mktemp "${TMPDIR:-/tmp}/a5-clone-task-sg.XXXXXX")"
db_sg_before="$(mktemp "${TMPDIR:-/tmp}/a5-clone-db-sg.XXXXXX")"
trap 'rm -f -- "$task_sg_before" "$db_sg_before"' EXIT
aws ec2 describe-security-groups --region "$region" --group-ids "$task_sg" --output json \
  > "$task_sg_before"
aws ec2 describe-security-groups --region "$region" --group-ids "$db_sg" --output json \
  > "$db_sg_before"

bash "$sg_validator" "$task_sg_before" "$db_sg_before" "$task_sg" "$db_sg" \
  "$endpoint_sg" "$s3_prefix_list" exact

ensure_role "$controller_role" "$controller_trust" "$controller_policy" "$controller_policy_file"
ensure_role "$execution_role" "$execution_trust" "$execution_policy" "$execution_policy_file"

if ! aws ecr describe-repositories --region "$region" --repository-names "$repository" >/dev/null 2>&1; then
  aws ecr create-repository --region "$region" --repository-name "$repository" \
    --image-tag-mutability IMMUTABLE --image-scanning-configuration scanOnPush=true \
    --encryption-configuration encryptionType=AES256 >/dev/null
fi
aws ecr put-image-tag-mutability --region "$region" --repository-name "$repository" \
  --image-tag-mutability IMMUTABLE >/dev/null
aws ecr put-image-scanning-configuration --region "$region" --repository-name "$repository" \
  --image-scanning-configuration scanOnPush=true >/dev/null

aws logs create-log-group --region "$region" --log-group-name "$log_group" >/dev/null 2>&1 || true
aws logs put-retention-policy --region "$region" --log-group-name "$log_group" \
  --retention-in-days 7

rm -f -- "$task_sg_before" "$db_sg_before"
trap - EXIT

subnet_csv="$(network_parameter task-subnet-ids)"

put_parameter() {
  aws ssm put-parameter --region "$region" --name "$parameter_prefix/$1" --type String \
    --value "$2" --overwrite >/dev/null
}
put_parameter source-db-identifier "$source_db_identifier"
put_parameter db-subnet-group-name "$db_subnet_group"
put_parameter db-parameter-group-name "$db_parameter_group"
put_parameter option-group-name "$option_group"
put_parameter db-security-group-id "$db_sg"
put_parameter task-security-group-id "$task_sg"
put_parameter task-subnet-ids "$subnet_csv"
put_parameter db-instance-class db.t4g.medium
put_parameter execution-role-arn "arn:aws:iam::$account_id:role/$execution_role"
put_parameter log-group-name "$log_group"

assert_role_exact "$controller_role" "$controller_trust" "$controller_policy" "$controller_policy_file"
assert_role_exact "$execution_role" "$execution_trust" "$execution_policy" "$execution_policy_file"

repository_state="$(aws ecr describe-repositories --region "$region" \
  --repository-names "$repository" --output json)"
jq -e --arg name "$repository" --arg account "$account_id" '
  .repositories|length == 1 and .[0].repositoryName == $name
  and .[0].registryId == $account and .[0].imageTagMutability == "IMMUTABLE"
  and .[0].imageScanningConfiguration.scanOnPush == true
  and .[0].encryptionConfiguration.encryptionType == "AES256"
' <<< "$repository_state" >/dev/null

log_state="$(aws logs describe-log-groups --region "$region" \
  --log-group-name-prefix "$log_group" --output json)"
jq -e --arg name "$log_group" '
  [.logGroups[]|select(.logGroupName==$name)] as $exact
  | ($exact|length)==1 and $exact[0].retentionInDays==7
' <<< "$log_state" >/dev/null

parameters="$(aws ssm get-parameters --region "$region" --names \
  "$parameter_prefix/source-db-identifier" "$parameter_prefix/db-subnet-group-name" \
  "$parameter_prefix/db-parameter-group-name" "$parameter_prefix/option-group-name" \
  "$parameter_prefix/db-security-group-id" "$parameter_prefix/task-security-group-id" \
  "$parameter_prefix/task-subnet-ids" "$parameter_prefix/db-instance-class" \
  "$parameter_prefix/execution-role-arn" "$parameter_prefix/log-group-name" --output json)"
jq -e --arg prefix "$parameter_prefix" --arg source "$source_db_identifier" \
  --arg subnetGroup "$db_subnet_group" --arg parameterGroup "$db_parameter_group" \
  --arg optionGroup "$option_group" --arg dbSg "$db_sg" --arg taskSg "$task_sg" \
  --arg subnets "$subnet_csv" --arg execution "arn:aws:iam::$account_id:role/$execution_role" \
  --arg logGroup "$log_group" '
  .InvalidParameters == [] and (.Parameters|length)==10
  and (all(.Parameters[]; .Type=="String"))
  and (.Parameters|map({key:.Name,value:.Value})|from_entries) == {
    ($prefix+"/source-db-identifier"):$source,
    ($prefix+"/db-subnet-group-name"):$subnetGroup,
    ($prefix+"/db-parameter-group-name"):$parameterGroup,
    ($prefix+"/option-group-name"):$optionGroup,
    ($prefix+"/db-security-group-id"):$dbSg,
    ($prefix+"/task-security-group-id"):$taskSg,
    ($prefix+"/task-subnet-ids"):$subnets,
    ($prefix+"/db-instance-class"):"db.t4g.medium",
    ($prefix+"/execution-role-arn"):$execution,
    ($prefix+"/log-group-name"):$logGroup
  }
' <<< "$parameters" >/dev/null

printf '%s\n' "Provisioned arn:aws:iam::$account_id:role/$controller_role"
printf '%s\n' "Provisioned arn:aws:iam::$account_id:role/$execution_role"
printf '%s\n' "Provisioned isolated clone network $task_sg -> $db_sg"
