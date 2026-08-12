#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
bootstrap="$repo_root/infra/security/bootstrap-production-a5-clone.sh"
controller_policy="$repo_root/infra/security/production-a5-clone-policy.template.json"
controller_trust="$repo_root/infra/security/production-a5-clone-trust.template.json"
execution_policy="$repo_root/infra/security/production-a5-clone-execution-policy.template.json"
execution_trust="$repo_root/infra/security/production-a5-clone-execution-trust.template.json"
sg_validator="$repo_root/infra/security/validate-production-a5-clone-security-groups.sh"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/production-a5-clone-bootstrap.XXXXXX")"
trap 'rm -rf -- "$fixture"' EXIT

bash -n "$bootstrap" "$sg_validator"
jq -e . "$controller_policy" "$controller_trust" "$execution_policy" "$execution_trust" >/dev/null

jq -e '
  .Statement[] | select(.Sid == "GitHubProductionA5Clone")
  | .Principal.Federated
      == "arn:aws:iam::311414082667:oidc-provider/token.actions.githubusercontent.com"
    and .Condition.StringEquals["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com"
    and .Condition.StringEquals["token.actions.githubusercontent.com:sub"]
      == "repo:MangmeeDev@314278152/mangmeeplus@1326789216:environment:production"
' "$controller_trust" >/dev/null

jq -e '
  .Statement[] | select(.Sid == "ExactProductionAccountEcsTasksOnly")
  | .Principal.Service == "ecs-tasks.amazonaws.com"
    and .Condition.StringEquals["aws:SourceAccount"] == "311414082667"
    and .Condition.ArnLike["aws:SourceArn"]
      == "arn:aws:ecs:ap-southeast-1:311414082667:*"
' "$execution_trust" >/dev/null

jq -e '
  ([.Statement[] | select(.Sid == "AllowExactExecutionRolePass")][0]) as $pass
  | ([.Statement[] | select(.Sid == "AllowTaggedCloneManagedPassword")][0]) as $modify
  | ([.Statement[] | select(.Sid == "AllowRdsManagedCloneSecretCreation")][0]) as $secret_create
  | ([.Statement[] | select(.Sid == "AllowCloneTaskDefinitionLifecycle")][0]) as $definitions
  | ([.Statement[] | select(.Sid == "DenyOutsideCloneController")][0]) as $boundary
  | $pass.Action == "iam:PassRole"
    and $pass.Resource
      == "arn:aws:iam::311414082667:role/watchdog-bms-production-a5-clone-execution"
    and $pass.Condition.StringEquals["iam:PassedToService"] == "ecs-tasks.amazonaws.com"
    and ([.Statement[] | select(.Sid == "DenyProductionDatabaseMutation")][0].Effect == "Deny")
    and ([.Statement[] | select(.Sid == "AllowExactCloneTaskRun")][0].Resource
      | all(.[]; contains("watchdog-a5-clone-") or contains("watchdog-bms-prod")))
    and ([.Statement[] | select(.Effect=="Allow") | .Action] | tostring
      | contains("secretsmanager:GetSecretValue") | not)
    and ([.Statement[] | select(.Sid == "AllowCloneManagedSecretMetadata")][0].Action
      == "secretsmanager:DescribeSecret")
    and $modify.Action == "rds:ModifyDBInstance"
    and $modify.Resource
      == "arn:aws:rds:ap-southeast-1:311414082667:db:watchdog-a5-clone-*"
    and $modify.Condition.StringEquals["rds:db-tag/purpose"] == "production-a5-clone"
    and $modify.Condition.Bool["rds:ManageMasterUserPassword"] == "true"
    and ($secret_create.Action|sort)
      == ["secretsmanager:CreateSecret","secretsmanager:TagResource"]
    and $secret_create.Resource
      == "arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:rds!db-*"
    and ($definitions.Action|index("ecs:ListTaskDefinitions")) != null
    and ($boundary.NotAction|index("rds:ModifyDBInstance")) != null
    and ($boundary.NotAction|index("secretsmanager:CreateSecret")) != null
    and ($boundary.NotAction|index("secretsmanager:TagResource")) != null
    and ($boundary.NotAction|index("ecs:ListTaskDefinitions")) != null
' "$controller_policy" >/dev/null

# The managed-password grant is intentionally one-way: turning management off must not match it.
jq -e '
  [.Statement[] | select(.Effect=="Allow" and
    ((.Action|if type=="array" then .[] else . end)=="rds:ModifyDBInstance"))]
  == [{Sid:"AllowTaggedCloneManagedPassword",Effect:"Allow",Action:"rds:ModifyDBInstance",
    Resource:"arn:aws:rds:ap-southeast-1:311414082667:db:watchdog-a5-clone-*",
    Condition:{StringEquals:{"rds:db-tag/purpose":"production-a5-clone"},
      Bool:{"rds:ManageMasterUserPassword":"true"}}}]
' "$controller_policy" >/dev/null

jq -e '
  ([.Statement[] | select(.Sid == "ReadOnlyRdsManagedCloneSecret")][0]) as $secret
  | ([.Statement[] | select(.Sid == "DecryptCloneSecretThroughSecretsManagerOnly")][0]) as $kms
  | $secret.Resource
      == "arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:rds!db-*"
    and ($secret.Action | sort) == ["secretsmanager:DescribeSecret","secretsmanager:GetSecretValue"]
    and $secret.Condition.StringLike["secretsmanager:ResourceTag/aws:rds:primaryDBInstanceArn"]
      == "arn:aws:rds:ap-southeast-1:311414082667:db:watchdog-a5-clone-*"
    and ([.Statement[] | select(.Sid == "PullExactMigrationToolRepository")][0].Resource
      == "arn:aws:ecr:ap-southeast-1:311414082667:repository/watchdog-bms-migration-tool")
    and ([.Statement[] | select(.Sid == "WriteOnlyCloneTaskLogs")][0].Resource
      == "arn:aws:logs:ap-southeast-1:311414082667:log-group:/ecs/watchdog-bms-production-a5-clone:log-stream:*")
    and ([.Statement[] | select(.Sid == "DenyOutsideCloneTaskBootstrap")][0].Effect == "Deny")
    and $kms.Resource
      == "arn:aws:kms:ap-southeast-1:311414082667:key/b2e68e7f-e098-4b88-a92a-5a0f4fe2924a"
    and $kms.Condition.StringEquals["kms:ViaService"]
      == "secretsmanager.ap-southeast-1.amazonaws.com"
' "$execution_policy" >/dev/null

if grep -En 'ecsTaskExecutionRole|watchdog-bms/production/\*|watchdog-bms-prod-db' \
  "$execution_policy" >/dev/null; then
  echo 'ERROR: clone execution policy can reach a shared execution role or production secret/database' >&2
  exit 1
fi

dry_output="$(AWS_ACCOUNT_ID=311414082667 "$bootstrap")"
grep -F 'Dry run only.' <<< "$dry_output" >/dev/null
grep -F 'watchdog-bms-production-a5-clone-execution' <<< "$dry_output" >/dev/null

task_sg=sg-0123456789abcdef0
db_sg=sg-0fedcba9876543210
endpoint_sg=sg-01111111111111111
s3_prefix=pl-0123456789abcdef0
jq -cnS --arg id "$task_sg" --arg db "$db_sg" --arg endpoint "$endpoint_sg" \
  --arg prefix "$s3_prefix" '{SecurityGroups:[{
  GroupId:$id,GroupName:"watchdog-bms-production-a5-clone-task",VpcId:"vpc-0123456789abcdef0",
  IpPermissions:[],IpPermissionsEgress:[
    {IpProtocol:"tcp",FromPort:443,ToPort:443,UserIdGroupPairs:[{GroupId:$endpoint}]},
    {IpProtocol:"tcp",FromPort:443,ToPort:443,PrefixListIds:[{PrefixListId:$prefix}]},
    {IpProtocol:"tcp",FromPort:5432,ToPort:5432,UserIdGroupPairs:[{GroupId:$db}]}
  ]}]}' > "$fixture/task.json"
jq -cnS --arg id "$db_sg" --arg task "$task_sg" '{SecurityGroups:[{
  GroupId:$id,GroupName:"watchdog-bms-production-a5-clone-db",VpcId:"vpc-0123456789abcdef0",
  IpPermissions:[{IpProtocol:"tcp",FromPort:5432,ToPort:5432,
    UserIdGroupPairs:[{GroupId:$task}]}],IpPermissionsEgress:[]}]}' > "$fixture/db.json"
bash "$sg_validator" "$fixture/task.json" "$fixture/db.json" "$task_sg" "$db_sg" \
  "$endpoint_sg" "$s3_prefix" exact
jq --arg endpoint "$endpoint_sg" --arg prefix "$s3_prefix" '
  .SecurityGroups[0].IpPermissionsEgress =
    ([.SecurityGroups[0].IpPermissionsEgress[] | select(.FromPort!=443)] +
      [{IpProtocol:"tcp",FromPort:443,ToPort:443,IpRanges:[],Ipv6Ranges:[],
        UserIdGroupPairs:[{GroupId:$endpoint}],PrefixListIds:[{PrefixListId:$prefix}]}])' \
  "$fixture/task.json" > "$fixture/task-canonical.json"
bash "$sg_validator" "$fixture/task-canonical.json" "$fixture/db.json" "$task_sg" "$db_sg" \
  "$endpoint_sg" "$s3_prefix" exact

expect_sg_reject() {
  local task="$1" db="$2" mode="${3:-exact}"
  if bash "$sg_validator" "$task" "$db" "$task_sg" "$db_sg" \
      "$endpoint_sg" "$s3_prefix" "$mode" >/dev/null 2>&1; then
    echo 'ERROR: adversarial security-group fixture was accepted' >&2
    exit 1
  fi
}

jq '.SecurityGroups[0].IpPermissions=[{IpProtocol:"tcp",FromPort:22,ToPort:22,
  IpRanges:[{CidrIp:"0.0.0.0/0"}]}]' "$fixture/task.json" > "$fixture/task-ingress.json"
expect_sg_reject "$fixture/task-ingress.json" "$fixture/db.json"
jq '.SecurityGroups[0].IpPermissionsEgress += [{IpProtocol:"tcp",FromPort:443,ToPort:443,
  Ipv6Ranges:[{CidrIpv6:"::/0"}]}]' "$fixture/task.json" > "$fixture/task-ipv6.json"
expect_sg_reject "$fixture/task-ipv6.json" "$fixture/db.json"
jq '.SecurityGroups[0].IpPermissions=[{IpProtocol:"tcp",FromPort:5432,ToPort:5432,
  IpRanges:[{CidrIp:"10.0.0.0/8"}]}]' "$fixture/db.json" > "$fixture/db-cidr.json"
expect_sg_reject "$fixture/task.json" "$fixture/db-cidr.json"
jq '.SecurityGroups[0].IpPermissionsEgress=[{IpProtocol:"-1",IpRanges:[{CidrIp:"0.0.0.0/0"}]}]' \
  "$fixture/db.json" > "$fixture/db-egress.json"
expect_sg_reject "$fixture/task.json" "$fixture/db-egress.json"
expect_sg_reject "$fixture/task-ipv6.json" "$fixture/db.json" preflight

if grep -En 'authorize-security-group-egress.*0\.0\.0\.0/0|--cidr 0\.0\.0\.0/0' "$bootstrap"; then
  echo 'ERROR: clone bootstrap still permits public task egress' >&2
  exit 1
fi

for required in \
  'list-role-policies' 'list-attached-role-policies' 'AssumeRolePolicyDocument' \
  'imageTagMutability == "IMMUTABLE"' 'imageScanningConfiguration.scanOnPush == true' \
  'encryptionConfiguration.encryptionType == "AES256"' 'retentionInDays==7' \
  '.InvalidParameters == [] and (.Parameters|length)==8'; do
  grep -F "$required" "$bootstrap" >/dev/null
done

echo 'production A5 clone bootstrap boundary spec: PASS'
