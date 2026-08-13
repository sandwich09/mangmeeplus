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
  | ([.Statement[] | select(.Sid == "AllowRdsGrantOnSnapshotKey")][0]) as $rds_grant
  | ([.Statement[] | select(.Sid == "DenyOutsideCloneController")][0]) as $boundary
  | $pass.Action == "iam:PassRole"
    and $pass.Resource
      == "arn:aws:iam::311414082667:role/watchdog-bms-production-a5-clone-execution"
    and $pass.Condition.StringEquals["iam:PassedToService"] == "ecs-tasks.amazonaws.com"
    and ([.Statement[] | select(.Sid == "DenyProductionDatabaseMutation")][0].Effect == "Deny")
    and ([.Statement[] | select(.Sid == "AllowExactCloneTaskRun")][0].Resource
      == "arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-a5-clone-*:*")
    and ([.Statement[] | select(.Effect=="Allow") | .Action] | tostring
      | contains("secretsmanager:GetSecretValue") | not)
    and ([.Statement[] | select(.Sid == "AllowCloneManagedSecretMetadata")][0].Action
      == "secretsmanager:DescribeSecret")
    and ([.Statement[] | select(.Sid == "AllowCloneManagedSecretMetadata")][0]
      == {Sid:"AllowCloneManagedSecretMetadata",Effect:"Allow",
        Action:"secretsmanager:DescribeSecret",
        Resource:"arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:rds!db-*"})
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
    and $rds_grant.Action == "kms:CreateGrant"
    and $rds_grant.Resource
      == "arn:aws:kms:ap-southeast-1:311414082667:key/52b4943e-e9d7-4fae-b71c-c13b0b157b27"
    and $rds_grant.Condition.StringEquals["kms:ViaService"]
      == "rds.ap-southeast-1.amazonaws.com"
    and $rds_grant.Condition.Bool["kms:GrantIsForAWSResource"] == "true"
    and ($boundary.NotAction|index("kms:CreateGrant")) != null
    and ($boundary.NotAction|index("rds:ModifyDBInstance")) != null
    and ($boundary.NotAction|index("secretsmanager:CreateSecret")) != null
    and ($boundary.NotAction|index("secretsmanager:TagResource")) != null
    and ($boundary.NotAction|index("ecs:ListTaskDefinitions")) != null
' "$controller_policy" >/dev/null

validate_rds_grant_contract() {
  jq -e '
    [.Statement[] | select(.Sid=="AllowRdsGrantOnSnapshotKey")]
    == [{Sid:"AllowRdsGrantOnSnapshotKey",Effect:"Allow",Action:"kms:CreateGrant",
      Resource:"arn:aws:kms:ap-southeast-1:311414082667:key/52b4943e-e9d7-4fae-b71c-c13b0b157b27",
      Condition:{StringEquals:{"kms:ViaService":"rds.ap-southeast-1.amazonaws.com"},
        Bool:{"kms:GrantIsForAWSResource":"true"}}}]
    and ([.Statement[] | select(.Sid=="DenyOutsideCloneController")][0].NotAction
      | index("kms:CreateGrant")) != null
  ' "$1" >/dev/null
}
validate_rds_grant_contract "$controller_policy"

validate_managed_secret_cleanup_contract() {
  jq -e '
    [.Statement[] | select(.Sid=="AllowCloneManagedSecretMetadata")]
      == [{Sid:"AllowCloneManagedSecretMetadata",Effect:"Allow",
        Action:"secretsmanager:DescribeSecret",
        Resource:"arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:rds!db-*"}]
    and ([.Statement[] | select(.Effect=="Allow") | .Action] | tostring
      | contains("secretsmanager:GetSecretValue") | not)
  ' "$1" >/dev/null
}
validate_managed_secret_cleanup_contract "$controller_policy"

jq '(.Statement[]|select(.Sid=="AllowCloneManagedSecretMetadata")).Condition={
  StringLike:{"secretsmanager:ResourceTag/aws:rds:primaryDBInstanceArn":
    "arn:aws:rds:ap-southeast-1:311414082667:db:watchdog-a5-clone-*"}}' \
  "$controller_policy" > "$fixture/policy-stale-secret-tag-condition.json"
if validate_managed_secret_cleanup_contract "$fixture/policy-stale-secret-tag-condition.json"; then
  echo 'ERROR: managed-secret cleanup policy still depends on the tag RDS removes during delete' >&2
  exit 1
fi

for mutation in grant-key-wildcard grant-missing-service grant-wrong-service \
    grant-missing-aws-resource grant-direct-user; do
  mutated="$fixture/policy-$mutation.json"
  case "$mutation" in
    grant-key-wildcard)
      jq '(.Statement[]|select(.Sid=="AllowRdsGrantOnSnapshotKey").Resource)=
        "arn:aws:kms:ap-southeast-1:311414082667:key/*"' "$controller_policy" > "$mutated" ;;
    grant-missing-service)
      jq 'del(.Statement[]|select(.Sid=="AllowRdsGrantOnSnapshotKey")
        .Condition.StringEquals["kms:ViaService"])' "$controller_policy" > "$mutated" ;;
    grant-wrong-service)
      jq '(.Statement[]|select(.Sid=="AllowRdsGrantOnSnapshotKey")
        .Condition.StringEquals["kms:ViaService"])="ec2.ap-southeast-1.amazonaws.com"' \
        "$controller_policy" > "$mutated" ;;
    grant-missing-aws-resource)
      jq 'del(.Statement[]|select(.Sid=="AllowRdsGrantOnSnapshotKey")
        .Condition.Bool["kms:GrantIsForAWSResource"])' "$controller_policy" > "$mutated" ;;
    grant-direct-user)
      jq '(.Statement[]|select(.Sid=="AllowRdsGrantOnSnapshotKey")
        .Condition.Bool["kms:GrantIsForAWSResource"])="false"' "$controller_policy" > "$mutated" ;;
  esac
  if validate_rds_grant_contract "$mutated"; then
    echo "ERROR: unsafe RDS KMS grant policy was accepted: $mutation" >&2
    exit 1
  fi
done

validate_provider_resource_contract() {
  jq -e '
    ([.Statement[] | select(.Sid=="AllowTaggedCloneRestore")][0]) as $restore
    | ([.Statement[] | select(.Sid=="AllowTaggedCloneInitialTags")][0]) as $tags
    | ([.Statement[] | select(.Sid=="AllowExactCloneTaskList")][0]) as $list
    | ([.Statement[] | select(.Sid=="AllowExactCloneTaskRun")][0]) as $run
    | ([.Statement[] | select(.Sid=="AllowExactCloneTaskDescribeStop")][0]) as $observe
    | {StringEquals:{"aws:RequestTag/purpose":"production-a5-clone"},
        "ForAllValues:StringEquals":{"aws:TagKeys":["parentRunAttempt","parentRunId",
          "producerRunAttempt","producerRunId","purpose","sourceCommit"]},
        Null:{"aws:RequestTag/parentRunAttempt":"false","aws:RequestTag/parentRunId":"false",
          "aws:RequestTag/producerRunAttempt":"false","aws:RequestTag/producerRunId":"false",
          "aws:RequestTag/purpose":"false","aws:RequestTag/sourceCommit":"false"}} as $tag_condition
    | {ArnEquals:{"ecs:cluster":
        "arn:aws:ecs:ap-southeast-1:311414082667:cluster/watchdog-bms-prod"}} as $cluster
    | $restore.Action=="rds:RestoreDBInstanceFromDBSnapshot"
      and ($restore.Resource|sort)==([
        "arn:aws:rds:ap-southeast-1:311414082667:db:watchdog-a5-clone-*",
        "arn:aws:rds:ap-southeast-1:311414082667:snapshot:rds:watchdog-bms-prod-db-*",
        "arn:aws:rds:ap-southeast-1:311414082667:subgrp:watchdog-bms-prod-db-subnets",
        "arn:aws:rds:ap-southeast-1:311414082667:pg:watchdog-bms-prod-pg18",
        "arn:aws:rds:ap-southeast-1:311414082667:og:default:postgres-18"]|sort)
      and $restore.Condition==$tag_condition
      and $tags.Action=="rds:AddTagsToResource"
      and $tags.Resource=="arn:aws:rds:ap-southeast-1:311414082667:db:watchdog-a5-clone-*"
      and $tags.Condition==$tag_condition
      and $list.Action=="ecs:ListTasks" and $list.Resource=="*" and $list.Condition==$cluster
      and $run.Action=="ecs:RunTask"
      and $run.Resource==
        "arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-a5-clone-*:*"
      and $run.Condition==$cluster
      and ($observe.Action|sort)==["ecs:DescribeTasks","ecs:StopTask"]
      and $observe.Resource==
        "arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/*"
      and $observe.Condition==$cluster
      and ([.Statement[] | select(.Effect=="Allow")
        | select((.Action|if type=="array" then . else [.] end)|index("ecs:ListTasks"))]
        | length)==1
  ' "$1" >/dev/null
}
validate_provider_resource_contract "$controller_policy"

for mutation in restore-snapshot-wildcard restore-option-wildcard restore-missing-tag \
    list-resource list-cluster; do
  mutated="$fixture/policy-$mutation.json"
  case "$mutation" in
    restore-snapshot-wildcard)
      jq '(.Statement[]|select(.Sid=="AllowTaggedCloneRestore").Resource[]
        | select(contains(":snapshot:")))="arn:aws:rds:ap-southeast-1:311414082667:snapshot:rds:*"' \
        "$controller_policy" > "$mutated" ;;
    restore-option-wildcard)
      jq '(.Statement[]|select(.Sid=="AllowTaggedCloneRestore").Resource[]
        | select(contains(":og:")))="arn:aws:rds:ap-southeast-1:311414082667:og:*"' \
        "$controller_policy" > "$mutated" ;;
    restore-missing-tag)
      jq 'del(.Statement[]|select(.Sid=="AllowTaggedCloneRestore")
        .Condition.Null["aws:RequestTag/sourceCommit"])' "$controller_policy" > "$mutated" ;;
    list-resource)
      jq '(.Statement[]|select(.Sid=="AllowExactCloneTaskList").Resource)=
        "arn:aws:ecs:ap-southeast-1:311414082667:cluster/watchdog-bms-prod"' \
        "$controller_policy" > "$mutated" ;;
    list-cluster)
      jq '(.Statement[]|select(.Sid=="AllowExactCloneTaskList").Condition.ArnEquals["ecs:cluster"])=
        "arn:aws:ecs:ap-southeast-1:311414082667:cluster/*"' \
        "$controller_policy" > "$mutated" ;;
  esac
  if validate_provider_resource_contract "$mutated"; then
    echo "ERROR: widened clone provider policy was accepted: $mutation" >&2
    exit 1
  fi
done

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
  'db-parameter-group-name' 'option-group-name' \
  '.InvalidParameters == [] and (.Parameters|length)==10'; do
  grep -F "$required" "$bootstrap" >/dev/null
done

echo 'production A5 clone bootstrap boundary spec: PASS'
