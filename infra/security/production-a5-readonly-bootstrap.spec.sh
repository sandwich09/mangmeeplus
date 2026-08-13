#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
validator="$repo_root/infra/security/validate-production-a5-readonly-security-groups.sh"
bootstrap="$repo_root/infra/security/bootstrap-production-a5-readonly.sh"
database_bootstrap="$repo_root/infra/security/bootstrap-production-a5-database-reader.sh"
bootstrap_workflow="$repo_root/.github/workflows/production-a5-reader-bootstrap.yml"
controller_policy="$repo_root/infra/security/production-a5-readonly-policy.template.json"
reader_bootstrap_policy="$repo_root/infra/security/production-a5-reader-bootstrap-policy.template.json"
revoked_bootstrap_policy="$repo_root/infra/security/production-a5-reader-bootstrap-revoked-policy.template.json"
reader_policy="$repo_root/infra/security/production-a5-readonly-execution-policy.template.json"
bootstrap_policy="$repo_root/infra/security/production-a5-bootstrap-execution-policy.template.json"
controller_trust="$repo_root/infra/security/production-a5-readonly-trust.template.json"
execution_trust="$repo_root/infra/security/production-a5-readonly-execution-trust.template.json"
migration_tool_validator="$repo_root/infra/security/verify-production-a5-migration-tool.sh"
readonly_runner="$repo_root/infra/security/run-production-a5-readonly.sh"
apply_runner="$repo_root/infra/security/run-production-a5-reviewed-migration.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/production-a5-readonly-bootstrap-spec.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
task_sg=sg-0123456789abcdef0
db_sg=sg-0fedcba9876543210
endpoint_sg=sg-01111111111111111
s3_prefix=pl-0123456789abcdef0

cat > "$work/task.json" <<JSON
{"SecurityGroups":[{"GroupId":"$task_sg","IpPermissions":[],"IpPermissionsEgress":[
 {"IpProtocol":"tcp","FromPort":5432,"ToPort":5432,"UserIdGroupPairs":[{"GroupId":"$db_sg"}],"IpRanges":[],"Ipv6Ranges":[],"PrefixListIds":[]},
 {"IpProtocol":"tcp","FromPort":443,"ToPort":443,"UserIdGroupPairs":[{"GroupId":"$endpoint_sg"}],"IpRanges":[],"Ipv6Ranges":[],"PrefixListIds":[]},
 {"IpProtocol":"tcp","FromPort":443,"ToPort":443,"UserIdGroupPairs":[],"IpRanges":[],"Ipv6Ranges":[],"PrefixListIds":[{"PrefixListId":"$s3_prefix"}]}
]}]}
JSON
cat > "$work/database.json" <<JSON
{"SecurityGroups":[{"GroupId":"$db_sg","IpPermissions":[
 {"IpProtocol":"tcp","FromPort":5432,"ToPort":5432,"UserIdGroupPairs":[{"GroupId":"$task_sg"}],"IpRanges":[],"Ipv6Ranges":[],"PrefixListIds":[]},
 {"IpProtocol":"tcp","FromPort":5432,"ToPort":5432,"UserIdGroupPairs":[{"GroupId":"sg-aaaaaaaaaaaaaaaaa"}],"IpRanges":[],"Ipv6Ranges":[],"PrefixListIds":[]}
],"IpPermissionsEgress":[{"IpProtocol":"-1","IpRanges":[{"CidrIp":"0.0.0.0/0"}],"Ipv6Ranges":[],"PrefixListIds":[],"UserIdGroupPairs":[]}]}]}
JSON
bash "$validator" "$work/task.json" "$work/database.json" "$task_sg" "$db_sg" \
  "$endpoint_sg" "$s3_prefix" exact
jq --arg endpoint "$endpoint_sg" --arg prefix "$s3_prefix" '
  .SecurityGroups[0].IpPermissionsEgress =
    ([.SecurityGroups[0].IpPermissionsEgress[] | select(.FromPort!=443)] +
      [{IpProtocol:"tcp",FromPort:443,ToPort:443,IpRanges:[],Ipv6Ranges:[],
        UserIdGroupPairs:[{GroupId:$endpoint}],PrefixListIds:[{PrefixListId:$prefix}]}])' \
  "$work/task.json" > "$work/task-canonical.json"
bash "$validator" "$work/task-canonical.json" "$work/database.json" "$task_sg" "$db_sg" \
  "$endpoint_sg" "$s3_prefix" exact

expect_reject() {
  local label="$1" task="$2" database="$3"
  if bash "$validator" "$task" "$database" "$task_sg" "$db_sg" \
      "$endpoint_sg" "$s3_prefix" exact >/dev/null 2>&1; then
    echo "ERROR: $label was accepted" >&2
    exit 1
  fi
}
jq '.SecurityGroups[0].IpPermissions=[{"IpProtocol":"tcp","FromPort":22,"ToPort":22,
  "UserIdGroupPairs":[],"IpRanges":[{"CidrIp":"0.0.0.0/0"}],"Ipv6Ranges":[],"PrefixListIds":[]}]' \
  "$work/task.json" > "$work/task-ingress.json"
expect_reject task-ingress "$work/task-ingress.json" "$work/database.json"
jq '.SecurityGroups[0].IpPermissionsEgress[0].UserIdGroupPairs=[]
  | .SecurityGroups[0].IpPermissionsEgress[0].IpRanges=[{"CidrIp":"0.0.0.0/0"}]' \
  "$work/task.json" > "$work/public-db-egress.json"
expect_reject public-db-egress "$work/public-db-egress.json" "$work/database.json"
jq '.SecurityGroups[0].IpPermissions[0].FromPort=0' "$work/database.json" > "$work/wide-db.json"
expect_reject wide-db "$work/task.json" "$work/wide-db.json"
jq '.SecurityGroups[0].IpPermissions += [.SecurityGroups[0].IpPermissions[0]]' \
  "$work/database.json" > "$work/duplicate-db.json"
expect_reject duplicate-db "$work/task.json" "$work/duplicate-db.json"

jq -e '
  ([.Statement[]|.Action?|if type=="array" then .[] else . end]
    | index("secretsmanager:GetSecretValue")) == null
  and any(.Statement[]; .Action=="iam:PassRole"
    and .Resource=="arn:aws:iam::311414082667:role/watchdog-bms-production-a5-readonly-execution")
  and all(.Statement[]|select(.Action=="iam:PassRole");
    (.Resource|tostring|contains("bootstrap-execution")|not))
' "$controller_policy" >/dev/null
jq -e '
  any(.Statement[]; (.Resource|tostring)|contains("a5-readonly-database-url-"))
  and all(.Statement[]; ((.Resource|tostring)|contains("/database-url-"))|not)
' "$reader_policy" >/dev/null
jq -e '
  any(.Statement[]; (.Resource|tostring)|contains("watchdog-bms/production/database-url-"))
  and any(.Statement[]; (.Resource|tostring)|contains("a5-readonly-database-url-"))
' "$bootstrap_policy" >/dev/null
jq -e '
  any(.Statement[]; .Sid=="ManageExactReaderSecret"
    and (.Action|index("secretsmanager:CreateSecret"))!=null
    and (.Action|index("secretsmanager:GetSecretValue"))==null)
  and any(.Statement[]; .Sid=="RegisterBootstrapTask"
    and (.Action|sort)==["ecs:DescribeTaskDefinition","ecs:RegisterTaskDefinition"]
    and .Resource=="*")
  and any(.Statement[]; .Sid=="RunBootstrapTask" and .Action=="ecs:RunTask"
    and (.Resource|contains("task-definition/watchdog-a5-production-bootstrap-")))
  and any(.Statement[]; .Sid=="StopBootstrapTask" and .Action=="ecs:StopTask"
    and (.Resource|contains("task/watchdog-bms-prod/")))
  and any(.Statement[]; .Sid=="SelfRevokeBootstrapController"
    and (.Action|index("iam:PutRolePolicy"))!=null)
' "$reader_bootstrap_policy" >/dev/null
jq -e '
  any(.Statement[]; .Sid=="ListBootstrapTasksInExactCluster"
    and .Action=="ecs:ListTasks" and .Resource=="*"
    and .Condition.ArnEquals["ecs:cluster"]
      =="arn:aws:ecs:ap-southeast-1:311414082667:cluster/watchdog-bms-prod")
  and any(.Statement[]; .Sid=="ReconcileBootstrapTaskDefinitions"
    and (.Action|sort)==["ecs:DeregisterTaskDefinition","ecs:DescribeTaskDefinition","ecs:ListTaskDefinitions"]
    and .Resource=="*")
  and all(.Statement[]|select(
    (.Action|if type=="array" then index("ecs:DeregisterTaskDefinition")
      else .=="ecs:DeregisterTaskDefinition" end)); .Resource=="*")
  and any(.Statement[]; .Sid=="DenyOutsideOneTimeReaderBootstrap"
    and (.NotAction|index("ecs:ListTasks"))!=null
    and (.NotAction|index("ecs:ListTaskDefinitions"))!=null
    and (.NotAction|index("ecs:DescribeTaskDefinition"))!=null
    and (.NotAction|index("ecs:DeregisterTaskDefinition"))!=null)
' "$reader_bootstrap_policy" >/dev/null
kms_key=arn:aws:kms:ap-southeast-1:311414082667:key/b2e68e7f-e098-4b88-a92a-5a0f4fe2924a
jq -e --arg key "$kms_key" '
  any(.Statement[]; .Sid=="EncryptReaderSecretThroughSecretsManagerOnly"
    and (.Action|sort)==["kms:Decrypt","kms:GenerateDataKey"] and .Resource==$key
    and .Condition.StringEquals=={
      "kms:CallerAccount":"311414082667",
      "kms:ViaService":"secretsmanager.ap-southeast-1.amazonaws.com"})
  and ([.Statement[]|select(has("Action"))|.Action
    |if type=="array" then .[] else . end|select(startswith("kms:"))]|sort)
    ==["kms:Decrypt","kms:GenerateDataKey"]
  and any(.Statement[]; .Sid=="DenyOutsideOneTimeReaderBootstrap"
    and (.NotAction|index("kms:Decrypt"))!=null
    and (.NotAction|index("kms:GenerateDataKey"))!=null)
' "$reader_bootstrap_policy" >/dev/null
for execution_policy in "$reader_policy" "$bootstrap_policy" \
    "$repo_root/infra/security/production-a5-apply-execution-policy.template.json" \
    "$repo_root/infra/security/production-a5-clone-execution-policy.template.json"; do
  jq -e --arg key "$kms_key" '
    any(.Statement[]; (.Sid|startswith("Decrypt")) and .Action=="kms:Decrypt"
      and .Resource==$key and .Condition.StringEquals=={
        "kms:CallerAccount":"311414082667",
        "kms:ViaService":"secretsmanager.ap-southeast-1.amazonaws.com"})
    and ([.Statement[]|select(has("Action"))|.Action
      |if type=="array" then .[] else . end|select(startswith("kms:"))])==["kms:Decrypt"]
    and any(.Statement[]; has("NotAction") and (.NotAction|index("kms:Decrypt"))!=null)
  ' "$execution_policy" >/dev/null
done
jq -e '
  .Statement==[{
    Sid:"ExactProductionAccountEcsTasksOnly",Effect:"Allow",
    Principal:{Service:"ecs-tasks.amazonaws.com"},Action:"sts:AssumeRole",
    Condition:{StringEquals:{"aws:SourceAccount":"311414082667"},
      ArnLike:{"aws:SourceArn":"arn:aws:ecs:ap-southeast-1:311414082667:*"}}
  }]
' "$execution_trust" >/dev/null

for file in "$bootstrap" "$database_bootstrap" "$validator"; do bash -n "$file"; done
for file in "$database_bootstrap" "$readonly_runner" "$apply_runner"; do
  grep -Fq 'all(.Subnets[];.State=="available" and .MapPublicIpOnLaunch==false)' "$file"
  if grep -Fq 'all(.[];.State=="available"' "$file"; then
    echo "ERROR: subnet validator iterates the AWS response object instead of .Subnets[]: $file" >&2
    exit 1
  fi
done
jq -e '
  (.Subnets|length)==2
  and all(.Subnets[];.State=="available" and .MapPublicIpOnLaunch==false)
  and ([.Subnets[].SubnetId]|sort)==["subnet-0123456789abcdef0","subnet-0fedcba9876543210"]
' <<'JSON' >/dev/null
{"Subnets":[
  {"SubnetId":"subnet-0fedcba9876543210","State":"available","MapPublicIpOnLaunch":false},
  {"SubnetId":"subnet-0123456789abcdef0","State":"available","MapPublicIpOnLaunch":false}
]}
JSON
if grep -En 'ecsTaskExecutionRole|assignPublicIp:"ENABLED"|taskRoleArn[[:space:]]*:' \
    "$bootstrap" "$database_bootstrap" "$controller_policy" "$reader_bootstrap_policy" \
    "$reader_policy" "$bootstrap_policy" "$execution_trust"; then
  echo 'ERROR: shared/public/task role leaked into production A5 reader path' >&2
  exit 1
fi
if grep -En 'secretsmanager get-secret-value' "$bootstrap" "$database_bootstrap"; then
  echo 'ERROR: bootstrap controller reads a secret value locally' >&2
  exit 1
fi
if grep -En 'authorize-security-group-egress.*0\.0\.0\.0/0|--cidr 0\.0\.0\.0/0' "$bootstrap"; then
  echo 'ERROR: read-only bootstrap still permits public task egress' >&2
  exit 1
fi
grep -Eq 'watchdog-bms-production-a5-readonly-execution' "$bootstrap" "$reader_policy"
grep -Eq 'watchdog-bms-production-a5-bootstrap-execution' "$bootstrap" "$database_bootstrap"
grep -Eq 'assignPublicIp:"DISABLED"' "$database_bootstrap"
grep -Eq '\$\{reader_arn\}:::\$\{reader_version\}' "$database_bootstrap"
grep -Eq 'verify-production-a5-migration-tool.sh' "$database_bootstrap"
grep -Eq '"--tsconfig"' "$database_bootstrap"
grep -Eq '"/app/apps/api/tsconfig.json"' "$database_bootstrap"
grep -Eq 'delete-role-policy.*bootstrap_execution_role_name' "$database_bootstrap"
grep -Eq 'delete-role.*bootstrap_execution_role_name' "$database_bootstrap"
grep -Fq 'production-a5-reader-bootstrap-revoked-policy.template.json' "$database_bootstrap"
grep -Fq -- 'list-task-definitions --region "$region"' "$database_bootstrap"
if grep -Fq -- '--family-prefix "$bootstrap_family_prefix"' "$database_bootstrap"; then
  echo 'ERROR: ECS family-prefix requires a full family name and cannot discover bootstrap families' >&2
  exit 1
fi
grep -Fq -- '--started-by "$started_by" --query taskArns' "$database_bootstrap"
grep -Fq -- '--desired-status RUNNING --query taskArns' "$database_bootstrap"
grep -Fq -- '--started-by "$started_by"' "$database_bootstrap"
grep -Fq 'register-task-definition-with-retry.sh' "$database_bootstrap"
grep -Fq 'run-task-idempotently.sh' "$database_bootstrap"
grep -Fq '"$run_client_token" -- ecs run-task' "$database_bootstrap"
grep -Fq 'for check in {1..64}' "$database_bootstrap"
grep -Fq 'minimum_check=61' "$database_bootstrap"
grep -Fq 'preserving bootstrap secret/authority because task absence was not proved' \
  "$database_bootstrap"
grep -Fq 'runner/process loss can leave the secret and execution authority' "$database_bootstrap"
grep -Fq 'bootstrap execution role changed after pre-image state classification' "$database_bootstrap"
grep -Fq 'execution_lookup="$(aws iam get-role --role-name "$bootstrap_execution_role_name"' \
  "$database_bootstrap"
jq -e '
  ([.Statement[]|select(.Effect=="Allow")|.Action|if type=="array" then .[] else . end]|sort)==[
    "ecs:DescribeTasks","ecs:ListTaskDefinitions","ecs:ListTasks","iam:GetRole",
    "iam:GetRolePolicy","iam:ListAttachedRolePolicies","iam:ListRolePolicies",
    "secretsmanager:DescribeSecret","sts:GetCallerIdentity"]
  and any(.Statement[]; .Sid=="ReadRevokedReaderSecretMetadata"
    and .Resource=="arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/a5-readonly-database-url-*")
  and any(.Statement[]; .Sid=="ListRevokedBootstrapTasks" and .Action=="ecs:ListTasks"
    and .Condition.ArnEquals["ecs:cluster"]
      =="arn:aws:ecs:ap-southeast-1:311414082667:cluster/watchdog-bms-prod")
  and any(.Statement[]; .Sid=="DescribeRevokedBootstrapTasks" and .Action=="ecs:DescribeTasks"
    and .Resource=="arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/*"
    and .Condition.ArnEquals["ecs:cluster"]
      =="arn:aws:ecs:ap-southeast-1:311414082667:cluster/watchdog-bms-prod")
  and any(.Statement[]; .Sid=="DenyOutsideRevokedBootstrapMetadataRead"
    and .Effect=="Deny" and (.NotAction|sort)==[
      "ecs:DescribeTasks","ecs:ListTaskDefinitions","ecs:ListTasks","iam:GetRole",
      "iam:GetRolePolicy","iam:ListAttachedRolePolicies","iam:ListRolePolicies",
      "secretsmanager:DescribeSecret","sts:GetCallerIdentity"] and .Resource=="*")
  and ([.Statement[]|select(.Effect=="Allow")|.Action
    |if type=="array" then .[] else . end
    |select(test("^(ecs:(RunTask|StopTask|RegisterTaskDefinition|DeregisterTaskDefinition)|iam:(Put|Delete|Create|Update|Attach|Detach)|secretsmanager:(Create|Delete|Put|Update|Restore|Tag|Untag))"))]
    |length)==0
' "$revoked_bootstrap_policy" >/dev/null
grep -Eq 'put-role-policy.*bootstrap_controller_role_name' "$database_bootstrap"
grep -Fq 'role-to-assume: ${{ env.A5_READER_BOOTSTRAP_ROLE_ARN }}' "$bootstrap_workflow"
grep -Fq 'assumed-role/watchdog-bms-production-a5-reader-bootstrap/' "$bootstrap_workflow"
credentials_line="$(grep -nF 'name: Configure one-time A5 reader controller' "$bootstrap_workflow" | cut -d: -f1)"
bootstrap_line="$(grep -nF 'bash infra/security/bootstrap-production-a5-database-reader.sh' \
  "$bootstrap_workflow" | cut -d: -f1)"
[[ "$credentials_line" =~ ^[0-9]+$ && "$bootstrap_line" =~ ^[0-9]+$ ]]
(( credentials_line < bootstrap_line ))
if grep -Eq 'aws ecr get-login-password|cosign verify .+MIGRATION_IMAGE' "$bootstrap_workflow"; then
  echo 'ERROR: workflow performs migration image access before the replay-aware bootstrap script' >&2
  exit 1
fi
test "$(grep -cF 'verify-production-a5-migration-tool.sh' "$database_bootstrap")" = 1
if grep -Fq 'role-to-assume: ${{ env.A5_READER_ROLE_ARN }}' "$bootstrap_workflow"; then
  echo 'ERROR: the mutating one-time bootstrap assumes the durable read-only controller' >&2
  exit 1
fi

mkdir "$work/bin"
cat > "$work/bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [ "$1 $2" = 'image inspect' ]; then
  jq -cn --arg source "${MOCK_IMAGE_SOURCE:?}" '[{Config:{User:"node",WorkingDir:"/app",
    ExposedPorts:{},Volumes:{"/tmp":{}},Labels:{"org.opencontainers.image.revision":$source,
      "com.watchdog-bms.image-purpose":"production-a5-migration-tool"}}}]'
elif [ "$1" = run ]; then
  [[ "$*" == *'/app/apps/api/node_modules/.bin/prisma'* ]]
  [[ "$*" != *'/app/node_modules/.bin/prisma'* ]]
  exit 0
else
  exit 2
fi
SH
chmod +x "$work/bin/docker"
source_sha="$(printf 'a%.0s' {1..40})"
image="311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-migration-tool@sha256:$(printf 'b%.0s' {1..64})"
PATH="$work/bin:$PATH" MOCK_IMAGE_SOURCE="$source_sha" \
  bash "$migration_tool_validator" "$image" "$source_sha" >/dev/null
if PATH="$work/bin:$PATH" MOCK_IMAGE_SOURCE="$source_sha" \
    bash "$migration_tool_validator" "watchdog-bms-migration-tool:latest" \
      "$source_sha" >/dev/null 2>&1; then
  echo 'ERROR: mutable migration-tool image reference was accepted' >&2
  exit 1
fi
if PATH="$work/bin:$PATH" MOCK_IMAGE_SOURCE="$source_sha" \
    bash "$migration_tool_validator" "$image" "${source_sha:0:39}" >/dev/null 2>&1; then
  echo 'ERROR: truncated migration-tool source revision was accepted' >&2
  exit 1
fi
if PATH="$work/bin:$PATH" MOCK_IMAGE_SOURCE="$(printf 'c%.0s' {1..40})" \
    bash "$migration_tool_validator" "$image" "$source_sha" >/dev/null 2>&1; then
  echo 'ERROR: signed migration-tool with the wrong source revision was accepted' >&2
  exit 1
fi

# Execute the real reconciliation state machines with a fake AWS CLI. This proves exact-prefix
# filtering, stable empty readback, startedBy cleanup and the post-self-revoke no-cloud EXIT path.
fake_calls="$work/aws-calls"
fake_definitions="$work/aws-definitions"
fake_task_state="$work/aws-task-state"
fake_secret_state="$work/aws-secret-state"
fake_execution_state="$work/aws-execution-state"
fake_delete_counter="$work/aws-delete-counter"
exact_definition_one="arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-a5-production-bootstrap-${source_sha:0:12}:1"
exact_definition_two="arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-a5-production-bootstrap-${source_sha:0:12}:2"
near_prefix_definition="arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-a5-production-bootstrap-not-a-sha:7"
fake_task_arn="arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/$(printf 'd%.0s' {1..32})"
printf '%s\n' "$exact_definition_one" "$exact_definition_two" "$near_prefix_definition" \
  > "$fake_definitions"
printf '1\n' > "$fake_task_state"
printf '1\n' > "$fake_secret_state"
printf 'ABSENT\n' > "$fake_execution_state"
printf '0\n' > "$fake_delete_counter"
cat > "$work/bin/aws" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${FAKE_AWS_CALLS:?}"
service="$1"
operation="$2"
shift 2
argument() {
  local wanted="$1"
  shift
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "$wanted" ]; then printf '%s\n' "$2"; return 0; fi
    shift
  done
  return 1
}
execution_state() {
  if [ -n "${FAKE_AWS_EXECUTION_STATE_FILE:-}" ]; then
    cat "$FAKE_AWS_EXECUTION_STATE_FILE"
  elif [ "${FAKE_AWS_EXECUTION_PRESENT:-false}" = true ]; then
    printf 'FULL\n'
  else
    printf 'ABSENT\n'
  fi
}
case "$service $operation" in
  'sts get-caller-identity')
    test "${FAKE_AWS_REVOKED_REPLAY:-false}" = true
    printf '311414082667\n'
    ;;
  'secretsmanager describe-secret')
    if [ "${FAKE_AWS_REVOKED_REPLAY:-false}" != true ]; then
      if [ "$(<"${FAKE_AWS_SECRET_STATE:?}")" = 0 ]; then
        echo 'ResourceNotFoundException: secret is absent' >&2
        exit 254
      fi
      jq -cn '{Name:"watchdog-bms/production/a5-readonly-database-url"}'
    elif [ "${FAKE_AWS_READER_ABSENT:-false}" = true ]; then
      echo 'ResourceNotFoundException: secret is absent' >&2
      exit 254
    elif [ "${FAKE_AWS_READER_EXTRA_CURRENT:-false}" = true ]; then
      jq -cn --arg version "${FAKE_AWS_READER_VERSION:?}" '{
        Name:"watchdog-bms/production/a5-readonly-database-url",
        ARN:"arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/a5-readonly-database-url-Ab12Cd",
        Description:"Production-only SELECT credential for signed A5 evidence",DeletedDate:null,
        Tags:[{Key:"purpose",Value:"production-a5-readonly"}],
        VersionIdsToStages:{($version):["AWSCURRENT"],("e"*32):["AWSCURRENT"]}}
      '
    else
      jq -cn --arg version "${FAKE_AWS_READER_VERSION:?}" '{
        Name:"watchdog-bms/production/a5-readonly-database-url",
        ARN:"arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/a5-readonly-database-url-Ab12Cd",
        Description:"Production-only SELECT credential for signed A5 evidence",DeletedDate:null,
        Tags:[{Key:"purpose",Value:"production-a5-readonly"}],
        VersionIdsToStages:{($version):["AWSCURRENT"]}}
      '
    fi
    ;;
  'secretsmanager delete-secret')
    case "${FAKE_AWS_SECRET_DELETE_FAIL:-none}" in
      none) printf '0\n' > "${FAKE_AWS_SECRET_STATE:?}" ;;
      ambiguous)
        printf '0\n' > "${FAKE_AWS_SECRET_STATE:?}"
        echo 'connection closed after request' >&2
        exit 255
        ;;
      denied)
        echo 'AccessDeniedException: delete denied' >&2
        exit 254
        ;;
      *) exit 2 ;;
    esac
    jq -cn '{ARN:"arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:fixture"}'
    ;;
  'ecs list-task-definitions')
    case "${FAKE_AWS_DEFINITION_READ_ERROR:-none}" in
      denied) echo 'AccessDeniedException: list task definitions denied' >&2; exit 254 ;;
      malformed) printf '{"taskDefinitionArns":"not-an-array"}\n'; exit 0 ;;
      none) ;;
      *) exit 2 ;;
    esac
    family_filter=''
    if [[ " $* " == *' --family-prefix '* ]]; then
      family_filter="$(argument --family-prefix "$@")"
    fi
    jq -Rn --arg family "$family_filter" '
      [inputs
        | select(length>0)
        | select($family=="" or test(":task-definition/"+$family+":[1-9][0-9]*$"))]
      | {taskDefinitionArns:.}
    ' "${FAKE_AWS_DEFINITIONS:?}"
    ;;
  'ecs deregister-task-definition')
    arn="$(argument --task-definition "$@")"
    awk -v arn="$arn" '$0!=arn' "$FAKE_AWS_DEFINITIONS" > "$FAKE_AWS_DEFINITIONS.next"
    mv "$FAKE_AWS_DEFINITIONS.next" "$FAKE_AWS_DEFINITIONS"
    jq -cn --arg arn "$arn" '{taskDefinition:{taskDefinitionArn:$arn,status:"INACTIVE"}}'
    ;;
  'ecs list-tasks')
    case "${FAKE_AWS_TASK_READ_ERROR:-none}" in
      denied) echo 'AccessDeniedException: list tasks denied' >&2; exit 254 ;;
      malformed) printf '"not-an-array"\n'; exit 0 ;;
      none) ;;
      *) exit 2 ;;
    esac
    if [[ " $* " == *' --started-by '* ]] \
        && [ "${FAKE_AWS_EXACT_VISIBLE:-true}" != true ]; then
      printf '[]\n'
    elif [ "$(<"${FAKE_AWS_TASK_STATE:?}")" = 1 ]; then
      jq -cn --arg arn "${FAKE_AWS_TASK_ARN:?}" '[$arn]'
    else
      printf '[]\n'
    fi
    ;;
  'ecs describe-tasks')
    status=STOPPED
    desired=STOPPED
    if [ "$(<"${FAKE_AWS_TASK_STATE:?}")" = 1 ]; then status=RUNNING; desired=RUNNING; fi
    jq -cn --arg arn "${FAKE_AWS_TASK_ARN:?}" --arg status "$status" --arg desired "$desired" \
      --arg cluster 'arn:aws:ecs:ap-southeast-1:311414082667:cluster/watchdog-bms-prod' \
      --arg started "${FAKE_AWS_STARTED_BY:?}" --arg group "family:${FAKE_AWS_FAMILY:?}" \
      --arg subnet "${FAKE_AWS_TASK_SUBNET:-subnet-0123456789abcdef0}" \
      --arg sg "${FAKE_AWS_TASK_SECURITY_GROUP:-sg-0123456789abcdef0}" \
      '{failures:[],tasks:[{taskArn:$arn,clusterArn:$cluster,startedBy:$started,group:$group,
        lastStatus:$status,desiredStatus:$desired,attachments:[{type:"ElasticNetworkInterface",
          details:[{name:"subnetId",value:$subnet},{name:"securityGroupId",value:$sg}]}]}]}'
    ;;
  'ecs stop-task')
    printf '0\n' > "$FAKE_AWS_TASK_STATE"
    jq -cn '{task:{lastStatus:"STOPPED",desiredStatus:"STOPPED"}}'
    ;;
  'ecs wait')
    test "$1" = tasks-stopped
    test "$(<"${FAKE_AWS_TASK_STATE:?}")" = 0
    ;;
  'iam get-role')
    role="$(argument --role-name "$@")"
    if { [ "${FAKE_AWS_REVOKED_REPLAY:-false}" = true ] \
          || [ "${FAKE_AWS_CONTROLLER_PRESENT:-false}" = true ]; } \
        && [ "$role" = watchdog-bms-production-a5-reader-bootstrap ]; then
      if [ "${FAKE_AWS_CONTROLLER_TRUST_MISMATCH:-false}" = true ]; then
        jq -cn --arg role "$role" '{Role:{RoleName:$role,Path:"/",
          Arn:("arn:aws:iam::311414082667:role/"+$role),MaxSessionDuration:7200,
          AssumeRolePolicyDocument:{Version:"2012-10-17",Statement:[]}}}'
      else
        jq -cn --arg role "$role" --slurpfile trust "${FAKE_AWS_CONTROLLER_TRUST:?}" \
          '{Role:{RoleName:$role,Path:"/",Arn:("arn:aws:iam::311414082667:role/"+$role),
            MaxSessionDuration:7200,AssumeRolePolicyDocument:$trust[0]}}'
      fi
    elif [ "${FAKE_AWS_REVOKED_REPLAY:-false}" = true ] \
        && [ "$role" = watchdog-bms-production-a5-bootstrap-execution ] \
        && [ "$(execution_state)" != ABSENT ]; then
      if [ "${FAKE_AWS_EXECUTION_TRUST_MISMATCH:-false}" = true ]; then
        jq -cn --arg role "$role" '{Role:{RoleName:$role,Path:"/",
          Arn:("arn:aws:iam::311414082667:role/"+$role),MaxSessionDuration:7200,
          AssumeRolePolicyDocument:{Version:"2012-10-17",Statement:[]}}}'
      else
        jq -cn --arg role "$role" --slurpfile trust "${FAKE_AWS_EXECUTION_TRUST:?}" \
          '{Role:{RoleName:$role,Path:"/",Arn:("arn:aws:iam::311414082667:role/"+$role),
            MaxSessionDuration:7200,AssumeRolePolicyDocument:$trust[0]}}'
      fi
    else
      echo 'NoSuchEntity: role is absent' >&2
      exit 254
    fi
    ;;
  'iam list-attached-role-policies')
    role="$(argument --role-name "$@")"
    if [ "${FAKE_AWS_REVOKED_REPLAY:-false}" = true ] \
        && { { [ "$role" = watchdog-bms-production-a5-reader-bootstrap ] \
          && [ "${FAKE_AWS_ATTACHED_POLICY:-false}" = true ]; } \
          || { [ "$role" = watchdog-bms-production-a5-bootstrap-execution ] \
          && [ "${FAKE_AWS_EXECUTION_ATTACHED_POLICY:-false}" = true ]; }; }; then
      jq -cn '{AttachedPolicies:[{PolicyName:"unexpected",PolicyArn:"arn:aws:iam::aws:policy/ReadOnlyAccess"}]}'
    else
      jq -cn '{AttachedPolicies:[]}'
    fi
    ;;
  'iam list-role-policies')
    role="$(argument --role-name "$@")"
    if [ "$role" = watchdog-bms-production-a5-bootstrap-execution ] \
        && [ "$(execution_state)" = CLEANUP_ONLY ]; then
      jq -cn '{PolicyNames:[]}'
    else
      jq -cn --arg name "$role" '{PolicyNames:[$name]}'
    fi
    ;;
  'iam put-role-policy')
    if [ "${FAKE_AWS_REVOKED_REPLAY:-false}" = true ]; then
      test "${FAKE_AWS_CONTROLLER_FULL:-false}" = true
    fi
    if [ "${FAKE_IAM_SELF_REVOKE_FAIL:-false}" = true ]; then exit 255; fi
    jq -cn '{}'
    ;;
  'iam get-role-policy')
    role="$(argument --role-name "$@")"
    if [ "$role" = watchdog-bms-production-a5-bootstrap-execution ]; then
      test "${FAKE_AWS_REVOKED_REPLAY:-false}" = true
      test "$(execution_state)" = FULL
      if [ "${FAKE_AWS_EXECUTION_POLICY_MISMATCH:-false}" = true ]; then
        jq -cn --arg name "$role" \
          '{RoleName:$name,PolicyName:$name,PolicyDocument:{Version:"2012-10-17",Statement:[]}}'
      else
        jq -cn --arg name "$role" --slurpfile policy "${FAKE_AWS_EXECUTION_POLICY:?}" \
          '{RoleName:$name,PolicyName:$name,PolicyDocument:$policy[0]}'
      fi
    elif [ "${FAKE_AWS_POLICY_MISMATCH:-false}" = true ]; then
      test "${FAKE_AWS_REVOKED_REPLAY:-false}" = true \
        || test "${FAKE_AWS_CONTROLLER_PRESENT:-false}" = true
      jq -cn --arg name 'watchdog-bms-production-a5-reader-bootstrap' \
        '{RoleName:$name,PolicyName:$name,PolicyDocument:{Version:"2012-10-17",Statement:[]}}'
    elif [ "${FAKE_AWS_CONTROLLER_FULL:-false}" = true ]; then
      test "${FAKE_AWS_REVOKED_REPLAY:-false}" = true \
        || test "${FAKE_AWS_CONTROLLER_PRESENT:-false}" = true
      jq -cn --arg name 'watchdog-bms-production-a5-reader-bootstrap' \
        --slurpfile policy "${FAKE_AWS_ACTIVE_POLICY:?}" \
        '{RoleName:$name,PolicyName:$name,PolicyDocument:$policy[0]}'
    else
      test "${FAKE_AWS_REVOKED_REPLAY:-false}" = true
      jq -cn --arg name 'watchdog-bms-production-a5-reader-bootstrap' \
        --slurpfile policy "${FAKE_AWS_REVOKED_POLICY:?}" \
        '{RoleName:$name,PolicyName:$name,PolicyDocument:$policy[0]}'
    fi
    ;;
  'iam delete-role-policy')
    test "$(argument --role-name "$@")" = watchdog-bms-production-a5-bootstrap-execution
    test "$(execution_state)" = FULL
    printf 'CLEANUP_ONLY\n' > "${FAKE_AWS_EXECUTION_STATE_FILE:?}"
    if [ "${FAKE_AWS_DELETE_POLICY_MODE:-success}" = accepted_lost ]; then
      echo 'connection closed after accepted DeleteRolePolicy' >&2
      exit 255
    fi
    jq -cn '{}'
    ;;
  'iam delete-role')
    test "$(argument --role-name "$@")" = watchdog-bms-production-a5-bootstrap-execution
    test "$(execution_state)" = CLEANUP_ONLY
    count="$(<"${FAKE_AWS_DELETE_COUNTER:?}")"
    printf '%s\n' "$((count+1))" > "$FAKE_AWS_DELETE_COUNTER"
    case "${FAKE_AWS_DELETE_ROLE_MODE:-success}" in
      transient)
        if [ "$count" -eq 0 ]; then
          echo 'ConcurrentModification: retry role deletion' >&2
          exit 254
        fi
        printf 'ABSENT\n' > "${FAKE_AWS_EXECUTION_STATE_FILE:?}"
        ;;
      accepted_lost)
        printf 'ABSENT\n' > "${FAKE_AWS_EXECUTION_STATE_FILE:?}"
        echo 'connection closed after accepted DeleteRole' >&2
        exit 255
        ;;
      success) printf 'ABSENT\n' > "${FAKE_AWS_EXECUTION_STATE_FILE:?}" ;;
      *) exit 2 ;;
    esac
    jq -cn '{}'
    ;;
  *)
    printf 'unexpected fake AWS call: %s %s %s\n' "$service" "$operation" "$*" >&2
    exit 90
    ;;
esac
SH
chmod +x "$work/bin/aws"
cat > "$work/bin/sleep" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$work/bin/sleep"
fake_git_calls="$work/git-calls"
: > "$fake_git_calls"
cat > "$work/bin/git" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${FAKE_GIT_CALLS:?}"
exit 91
SH
chmod +x "$work/bin/git"
export PATH="$work/bin:$PATH" FAKE_AWS_CALLS="$fake_calls" \
  FAKE_AWS_DEFINITIONS="$fake_definitions" FAKE_AWS_TASK_STATE="$fake_task_state" \
  FAKE_AWS_SECRET_STATE="$fake_secret_state" \
  FAKE_AWS_TASK_ARN="$fake_task_arn" FAKE_AWS_STARTED_BY="a5-bootstrap-${source_sha:0:12}" \
  FAKE_AWS_FAMILY="watchdog-a5-production-bootstrap-${source_sha:0:12}" \
  FAKE_AWS_ACTIVE_POLICY="$reader_bootstrap_policy" FAKE_AWS_CONTROLLER_TRUST="$controller_trust" \
  FAKE_AWS_EXECUTION_TRUST="$execution_trust" FAKE_AWS_EXECUTION_POLICY="$bootstrap_policy" \
  FAKE_GIT_CALLS="$fake_git_calls" FAKE_AWS_DELETE_COUNTER="$fake_delete_counter"

# Execute the full entrypoint under the post-success revoked authority. The script must produce
# EXISTING from metadata-only stable readback before git/ECR/cosign and make no AWS mutation.
replay_calls="$work/replay-aws-calls"
replay_definitions="$work/replay-aws-definitions"
: > "$replay_calls"
: > "$replay_definitions"
printf '0\n' > "$fake_task_state"
reader_version="$(printf 'f%.0s' {1..32})"
run_revoked_replay() {
  env AWS_ACCOUNT_ID=311414082667 FAKE_AWS_CALLS="$replay_calls" \
    FAKE_AWS_DEFINITIONS="$replay_definitions" FAKE_AWS_REVOKED_REPLAY=true \
    FAKE_AWS_REVOKED_POLICY="$revoked_bootstrap_policy" FAKE_AWS_READER_VERSION="$reader_version" \
    "$@" bash "$database_bootstrap" "$image" "$source_sha" F1_CURRENT
}
replay_output="$(run_revoked_replay)"
test "$replay_output" = "{\"artifact\":\"production-a5-reader-bootstrap\",\"state\":\"EXISTING\",\"readerRole\":\"watchdog_a5_prod_ro\",\"readerSecretVersionId\":\"$reader_version\"}"
test "$(grep -c '^ecs list-tasks ' "$replay_calls")" = 6
test "$(grep -c '^ecs list-task-definitions ' "$replay_calls")" = 3
test "$(grep -c '^iam get-role --role-name watchdog-bms-production-a5-bootstrap-execution' \
  "$replay_calls")" = 2
test "$(grep -c '^iam get-role --role-name watchdog-bms-production-a5-reader-bootstrap' \
  "$replay_calls")" = 2
test "$(grep -c '^iam list-attached-role-policies --role-name watchdog-bms-production-a5-reader-bootstrap' \
  "$replay_calls")" = 2
test "$(grep -c '^iam list-role-policies --role-name watchdog-bms-production-a5-reader-bootstrap' \
  "$replay_calls")" = 2
test "$(grep -c '^iam get-role-policy --role-name watchdog-bms-production-a5-reader-bootstrap' \
  "$replay_calls")" = 2
test "$(grep -c '^secretsmanager describe-secret ' "$replay_calls")" = 2
if grep -Eq '^(ecr |ec2 |rds |ssm |kms |ecs (run-task|stop-task|register-task-definition|deregister-task-definition)|iam (put|delete|create|update|attach|detach)|secretsmanager (create|delete|put|update|restore|tag|untag))' \
    "$replay_calls"; then
  echo 'ERROR: revoked-state replay reached image/runtime APIs or mutated AWS' >&2
  exit 1
fi

for unsafe_state in FAKE_AWS_READER_EXTRA_CURRENT=true FAKE_AWS_ATTACHED_POLICY=true \
    FAKE_AWS_POLICY_MISMATCH=true FAKE_AWS_CONTROLLER_TRUST_MISMATCH=true; do
  : > "$replay_calls"
  if run_revoked_replay "$unsafe_state" >/dev/null 2>&1; then
    echo "ERROR: revoked-state replay accepted $unsafe_state" >&2
    exit 1
  fi
done

# Exact role drift must be rejected by the executable classifier before git/image access. Cover
# controller trust and every execution authority surface that could make a later ECS task unsafe.
for unsafe_role_state in FAKE_AWS_CONTROLLER_TRUST_MISMATCH=true \
    FAKE_AWS_EXECUTION_TRUST_MISMATCH=true FAKE_AWS_EXECUTION_POLICY_MISMATCH=true \
    FAKE_AWS_EXECUTION_ATTACHED_POLICY=true; do
  : > "$replay_calls"
  : > "$fake_git_calls"
  if run_revoked_replay FAKE_AWS_CONTROLLER_FULL=true FAKE_AWS_EXECUTION_PRESENT=true \
      "$unsafe_role_state" >/dev/null 2>&1; then
    echo "ERROR: pre-image classifier accepted $unsafe_role_state" >&2
    exit 1
  fi
  test ! -s "$fake_git_calls"
  if grep -Eq '^(ecr |ecs (run-task|register-task-definition)|iam:PassRole)' "$replay_calls"; then
    echo "ERROR: $unsafe_role_state reached image/task access" >&2
    exit 1
  fi
done

# A FULL tuple with execution present takes the normal path only after exact execution role trust,
# attachment, inline-policy-name and inline-policy-document reads. It then spends the bounded
# accepted-lost reconciliation window before the fake git sentinel.
: > "$replay_calls"
: > "$fake_git_calls"
if run_revoked_replay FAKE_AWS_CONTROLLER_FULL=true FAKE_AWS_EXECUTION_PRESENT=true \
    >/dev/null 2>&1; then
  echo 'ERROR: normal-path fixture unexpectedly passed the post-classifier git sentinel' >&2
  exit 1
fi
test "$(cat "$fake_git_calls")" = 'fetch --quiet origin main --force'
for exact_execution_read in \
    'iam list-attached-role-policies --role-name watchdog-bms-production-a5-bootstrap-execution' \
    'iam list-role-policies --role-name watchdog-bms-production-a5-bootstrap-execution' \
    'iam get-role-policy --role-name watchdog-bms-production-a5-bootstrap-execution --policy-name watchdog-bms-production-a5-bootstrap-execution --output json'; do
  grep -Fq "$exact_execution_read" "$replay_calls"
done

# A stale prior-source task/definition is stopped, waited and deregistered before git/ECR or a new
# RunTask even when its recorded network attachment uses a different security group and subnet.
prior_source="$(printf 'e%.0s' {1..12})"
prior_definition="arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-a5-production-bootstrap-${prior_source}:9"
: > "$replay_calls"
: > "$fake_git_calls"
printf '%s\n' "$prior_definition" > "$replay_definitions"
printf '1\n' > "$fake_task_state"
if run_revoked_replay FAKE_AWS_CONTROLLER_FULL=true FAKE_AWS_EXECUTION_PRESENT=true \
    FAKE_AWS_STARTED_BY="a5-bootstrap-${prior_source}" \
    FAKE_AWS_FAMILY="watchdog-a5-production-bootstrap-${prior_source}" \
    FAKE_AWS_TASK_SUBNET=subnet-0fedcba9876543210 \
    FAKE_AWS_TASK_SECURITY_GROUP=sg-0fedcba9876543210 >/dev/null 2>&1; then
  echo 'ERROR: stale-network fixture unexpectedly passed the post-clean git sentinel' >&2
  exit 1
fi
stop_line="$(grep -n '^ecs stop-task ' "$replay_calls" | head -1 | cut -d: -f1)"
wait_line="$(grep -n '^ecs wait tasks-stopped ' "$replay_calls" | head -1 | cut -d: -f1)"
deregister_line="$(grep -nF "ecs deregister-task-definition --region ap-southeast-1 --task-definition $prior_definition" \
  "$replay_calls" | cut -d: -f1)"
[[ "$stop_line" =~ ^[0-9]+$ && "$wait_line" =~ ^[0-9]+$ && "$deregister_line" =~ ^[0-9]+$ ]]
(( stop_line < wait_line && wait_line < deregister_line ))
test "$(cat "$fake_git_calls")" = 'fetch --quiet origin main --force'
test "$(<"$fake_task_state")" = 0
test ! -s "$replay_definitions"
if grep -Eq '^(ecr |ecs run-task )' "$replay_calls"; then
  echo 'ERROR: stale bootstrap residue reached image access or a new RunTask' >&2
  exit 1
fi

# Provider denial or malformed cleanup reads fail before git/ECR/new RunTask. EXIT may retry the
# same read-only reconciliation but cannot cross the boundary or mutate the reader/IAM tuple.
for read_failure in FAKE_AWS_TASK_READ_ERROR=denied FAKE_AWS_TASK_READ_ERROR=malformed \
    FAKE_AWS_DEFINITION_READ_ERROR=denied FAKE_AWS_DEFINITION_READ_ERROR=malformed; do
  : > "$replay_calls"
  : > "$fake_git_calls"
  : > "$replay_definitions"
  printf '0\n' > "$fake_task_state"
  if run_revoked_replay FAKE_AWS_CONTROLLER_FULL=true FAKE_AWS_EXECUTION_PRESENT=true \
      "$read_failure" >/dev/null 2>&1; then
    echo "ERROR: pre-clean accepted $read_failure" >&2
    exit 1
  fi
  test ! -s "$fake_git_calls"
  if grep -Eq '^(ecr |ecs run-task |secretsmanager (create-secret|delete-secret)|iam (delete-role|delete-role-policy|put-role-policy))' \
      "$replay_calls"; then
    echo "ERROR: $read_failure crossed the fail-before-image boundary" >&2
    exit 1
  fi
done
: > "$replay_definitions"
printf '0\n' > "$fake_task_state"
: > "$replay_calls"
printf '%s\n' "$exact_definition_one" > "$replay_definitions"
if run_revoked_replay >/dev/null 2>&1; then
  echo 'ERROR: revoked-state replay accepted an active bootstrap task definition' >&2
  exit 1
fi
: > "$replay_definitions"
: > "$replay_calls"
printf '1\n' > "$fake_task_state"
if run_revoked_replay >/dev/null 2>&1; then
  echo 'ERROR: revoked-state replay accepted an active bootstrap task' >&2
  exit 1
fi
if grep -Eq '^(ecs (run-task|stop-task|register-task-definition|deregister-task-definition)|iam (put|delete|create|update|attach|detach)|secretsmanager (create|delete|put|update|restore|tag|untag))' \
    "$replay_calls"; then
  echo 'ERROR: rejected revoked-state replay mutated AWS' >&2
  exit 1
fi
printf '1\n' > "$fake_task_state"

# shellcheck disable=SC1090 # source the production state machines with validated fixture inputs.
source "$database_bootstrap" "$image" "$source_sha" F1_CURRENT
sleep() { :; }
export FAKE_AWS_READER_VERSION="$reader_version" \
  FAKE_AWS_REVOKED_POLICY="$revoked_bootstrap_policy"

# All eight controller/secret/execution tuples are classified before image access. Only the two
# fresh/incomplete FULL states continue, FULL+complete performs the final revoke, and RECOVERY+
# complete emits existing evidence. Every other tuple fails without mutation.
tuple_status() {
  local controller="$1" secret="$2" execution="$3" status=0
  : > "$fake_calls"
  : > "$fake_definitions"
  printf '0\n' > "$fake_task_state"
  export FAKE_AWS_REVOKED_REPLAY=true
  if [ "$controller" = FULL ]; then export FAKE_AWS_CONTROLLER_FULL=true
  else unset FAKE_AWS_CONTROLLER_FULL; fi
  if [ "$secret" = ABSENT ]; then export FAKE_AWS_READER_ABSENT=true
  else unset FAKE_AWS_READER_ABSENT; fi
  if [ "$execution" = PRESENT ]; then export FAKE_AWS_EXECUTION_PRESENT=true
  else unset FAKE_AWS_EXECUTION_PRESENT; fi
  bootstrap_cleanup_armed=false
  bootstrap_authority_revoked=false
  completed=false
  emit_revoked_bootstrap_replay_if_complete >/dev/null 2>&1 || status=$?
  printf '%s\n' "$status"
}

test "$(tuple_status FULL ABSENT PRESENT)" = 10
test "$(tuple_status FULL PRESENT PRESENT)" = 10
test "$(tuple_status FULL ABSENT ABSENT)" = 1
test "$(tuple_status RECOVERY ABSENT ABSENT)" = 1
test "$(tuple_status RECOVERY ABSENT PRESENT)" = 1
test "$(tuple_status RECOVERY PRESENT PRESENT)" = 1
test "$(tuple_status RECOVERY PRESENT ABSENT)" = 0
test "$(tuple_status FULL PRESENT ABSENT)" = 0
test "$(tail -n 1 "$fake_calls")" = "iam put-role-policy --role-name watchdog-bms-production-a5-reader-bootstrap --policy-name watchdog-bms-production-a5-reader-bootstrap --policy-document file://$revoked_bootstrap_policy"
unset FAKE_AWS_REVOKED_REPLAY FAKE_AWS_CONTROLLER_FULL FAKE_AWS_READER_ABSENT \
  FAKE_AWS_EXECUTION_PRESENT
bootstrap_cleanup_armed=false
bootstrap_authority_revoked=false
completed=false

# IAM deletion is an idempotent state machine. A lost DeleteRolePolicy response plus transient
# DeleteRole is reconciled from exact FULL -> CLEANUP_ONLY -> three stable NoSuchEntity reads.
: > "$fake_calls"
printf 'FULL\n' > "$fake_execution_state"
printf '0\n' > "$fake_delete_counter"
export FAKE_AWS_REVOKED_REPLAY=true FAKE_AWS_CONTROLLER_FULL=true \
  FAKE_AWS_EXECUTION_STATE_FILE="$fake_execution_state" \
  FAKE_AWS_DELETE_POLICY_MODE=accepted_lost FAKE_AWS_DELETE_ROLE_MODE=transient
bootstrap_cleanup_armed=true
bootstrap_authority_revoked=false
remove_bootstrap_execution_authority
test "$(<"$fake_execution_state")" = ABSENT
test "$(grep -c '^iam delete-role-policy ' "$fake_calls")" = 1
test "$(grep -c '^iam delete-role ' "$fake_calls")" = 2
test "$(grep -c '^iam get-role --role-name watchdog-bms-production-a5-bootstrap-execution' \
  "$fake_calls")" -ge 6
grep -q '^iam put-role-policy ' "$fake_calls"

# A lost DeleteRole response is likewise recovered without retrying policy deletion.
: > "$fake_calls"
printf 'CLEANUP_ONLY\n' > "$fake_execution_state"
printf '0\n' > "$fake_delete_counter"
export FAKE_AWS_DELETE_POLICY_MODE=success FAKE_AWS_DELETE_ROLE_MODE=accepted_lost
bootstrap_authority_revoked=false
remove_bootstrap_execution_authority
test "$(<"$fake_execution_state")" = ABSENT
test "$(grep -c '^iam delete-role-policy ' "$fake_calls" || true)" = 0
test "$(grep -c '^iam delete-role ' "$fake_calls")" = 1
grep -q '^iam put-role-policy ' "$fake_calls"

# An interrupted cleanup with the exact reader secret and CLEANUP_ONLY execution role resumes
# entirely before git/image access, finishes role deletion, self-revokes and emits EXISTING.
: > "$replay_calls"
: > "$fake_git_calls"
: > "$replay_definitions"
printf '0\n' > "$fake_task_state"
printf 'CLEANUP_ONLY\n' > "$fake_execution_state"
printf '0\n' > "$fake_delete_counter"
partial_output="$(run_revoked_replay FAKE_AWS_CONTROLLER_FULL=true \
  FAKE_AWS_EXECUTION_STATE_FILE="$fake_execution_state" \
  FAKE_AWS_DELETE_ROLE_MODE=accepted_lost)"
test "$partial_output" = "{\"artifact\":\"production-a5-reader-bootstrap\",\"state\":\"EXISTING\",\"readerRole\":\"watchdog_a5_prod_ro\",\"readerSecretVersionId\":\"$reader_version\"}"
test "$(<"$fake_execution_state")" = ABSENT
test ! -s "$fake_git_calls"
if grep -Eq '^(ecr |ecs (run-task|register-task-definition)|secretsmanager (create-secret|delete-secret))' \
    "$replay_calls"; then
  echo 'ERROR: interrupted IAM cleanup reached image/runtime mutation' >&2
  exit 1
fi

# Partial state never weakens role validation.
: > "$replay_calls"
: > "$fake_git_calls"
printf 'CLEANUP_ONLY\n' > "$fake_execution_state"
if run_revoked_replay FAKE_AWS_CONTROLLER_FULL=true \
    FAKE_AWS_EXECUTION_STATE_FILE="$fake_execution_state" \
    FAKE_AWS_EXECUTION_TRUST_MISMATCH=true >/dev/null 2>&1; then
  echo 'ERROR: cleanup-only execution role with wrong trust was accepted' >&2
  exit 1
fi
test ! -s "$fake_git_calls"
unset FAKE_AWS_REVOKED_REPLAY FAKE_AWS_CONTROLLER_FULL FAKE_AWS_EXECUTION_STATE_FILE \
  FAKE_AWS_DELETE_POLICY_MODE FAKE_AWS_DELETE_ROLE_MODE
bootstrap_cleanup_armed=false
bootstrap_authority_revoked=false
printf '%s\n' "$exact_definition_one" "$exact_definition_two" "$near_prefix_definition" \
  > "$fake_definitions"
printf '1\n' > "$fake_task_state"

# Incomplete cleanup handles both a newly-created and a pre-existing reader identically: secret
# absence must be stable before execution/controller authority is removed. An ambiguous accepted
# delete is reconciled; a denied delete preserves authority and fails closed.
: > "$fake_calls"
printf '1\n' > "$fake_secret_state"
export FAKE_AWS_SECRET_DELETE_FAIL=ambiguous
delete_incomplete_reader_secret_and_prove_absent
test "$(<"$fake_secret_state")" = 0
test "$(grep -c '^secretsmanager describe-secret ' "$fake_calls")" = 3
unset FAKE_AWS_SECRET_DELETE_FAIL

: > "$fake_calls"
: > "$fake_definitions"
printf '0\n' > "$fake_task_state"
printf '1\n' > "$fake_secret_state"
export FAKE_AWS_SECRET_DELETE_FAIL=ambiguous
export FAKE_AWS_CONTROLLER_PRESENT=true FAKE_AWS_CONTROLLER_FULL=true
bootstrap_cleanup_armed=true
bootstrap_authority_revoked=false
run_task_requested=false
completed=false
task_arn=''
task_definition_arn=''
(cleanup) >/dev/null
delete_line="$(grep -n '^secretsmanager delete-secret ' "$fake_calls" | cut -d: -f1)"
revoke_line="$(grep -n '^iam put-role-policy ' "$fake_calls" | cut -d: -f1)"
[[ "$delete_line" =~ ^[0-9]+$ && "$revoke_line" =~ ^[0-9]+$ ]]
(( delete_line < revoke_line ))
test "$(<"$fake_secret_state")" = 0
unset FAKE_AWS_SECRET_DELETE_FAIL FAKE_AWS_CONTROLLER_PRESENT FAKE_AWS_CONTROLLER_FULL

: > "$fake_calls"
: > "$fake_definitions"
printf '0\n' > "$fake_task_state"
printf '1\n' > "$fake_secret_state"
export FAKE_AWS_SECRET_DELETE_FAIL=denied
bootstrap_cleanup_armed=true
bootstrap_authority_revoked=false
run_task_requested=false
completed=false
task_arn=''
task_definition_arn=''
if (cleanup) >/dev/null 2>&1; then
  echo 'ERROR: incomplete pre-existing reader survived while authority was revoked' >&2
  exit 1
fi
grep -q '^secretsmanager delete-secret ' "$fake_calls"
if grep -Eq '^iam (delete-role-policy|delete-role|put-role-policy) ' "$fake_calls"; then
  echo 'ERROR: cleanup removed bootstrap authority before reader-secret absence' >&2
  exit 1
fi
test "$(<"$fake_secret_state")" = 1
unset FAKE_AWS_SECRET_DELETE_FAIL
bootstrap_cleanup_armed=false
printf '%s\n' "$exact_definition_one" "$exact_definition_two" "$near_prefix_definition" \
  > "$fake_definitions"
printf '1\n' > "$fake_task_state"

: > "$fake_calls"
retire_bootstrap_task_definitions
test "$(grep -c '^ecs list-task-definitions ' "$fake_calls")" = 4
grep -Fq "ecs deregister-task-definition --region ap-southeast-1 --task-definition $exact_definition_one" \
  "$fake_calls"
grep -Fq "ecs deregister-task-definition --region ap-southeast-1 --task-definition $exact_definition_two" \
  "$fake_calls"
if grep -Fq -- "--task-definition $near_prefix_definition" "$fake_calls"; then
  echo 'ERROR: near-prefix task definition escaped the exact bootstrap-family filter' >&2
  exit 1
fi
grep -Fxq "$near_prefix_definition" "$fake_definitions"

: > "$fake_calls"
task_arn=''
stop_bootstrap_tasks_and_prove_absent false
test "$(grep -c '^ecs list-tasks ' "$fake_calls")" = 8
grep -Fq "ecs stop-task --region ap-southeast-1 --cluster watchdog-bms-prod --task $fake_task_arn" \
  "$fake_calls"
test "$(<"$fake_task_state")" = 0

# Cluster-wide reconciliation catches a prior source even when the current startedBy query is empty.
: > "$fake_calls"
printf '1\n' > "$fake_task_state"
export FAKE_AWS_EXACT_VISIBLE=false
export FAKE_AWS_STARTED_BY="a5-bootstrap-$(printf 'e%.0s' {1..12})"
export FAKE_AWS_FAMILY="watchdog-a5-production-bootstrap-$(printf 'e%.0s' {1..12})"
stop_bootstrap_tasks_and_prove_absent false
test "$(grep -c '^ecs list-tasks ' "$fake_calls")" = 8
grep -Fq "ecs stop-task --region ap-southeast-1 --cluster watchdog-bms-prod --task $fake_task_arn" \
  "$fake_calls"
test "$(<"$fake_task_state")" = 0
export FAKE_AWS_EXACT_VISIBLE=true
export FAKE_AWS_STARTED_BY="a5-bootstrap-${source_sha:0:12}"
export FAKE_AWS_FAMILY="watchdog-a5-production-bootstrap-${source_sha:0:12}"

# An ambiguous RunTask response observes the complete 61-read visibility window even when empty.
: > "$fake_calls"
task_arn=''
stop_bootstrap_tasks_and_prove_absent true
test "$(grep -c '^ecs list-tasks ' "$fake_calls")" = 122

# Once self-revocation succeeds, EXIT may remove local files but must make no AWS call.
: > "$fake_calls"
bootstrap_cleanup_armed=true
bootstrap_authority_revoked=true
task_arn=''
task_definition_arn=''
completed=true
run_error=''
secret_file=''
docker_config=''
(cleanup)
test ! -s "$fake_calls"

# A lost response to the final metadata-only PutRolePolicy is treated as possibly applied. EXIT
# must not probe IAM or any other AWS API because mutation authority may already be revoked.
: > "$fake_calls"
bootstrap_cleanup_armed=true
bootstrap_authority_revoked=false
task_arn=''
task_definition_arn=''
export FAKE_IAM_SELF_REVOKE_FAIL=true
export FAKE_AWS_CONTROLLER_PRESENT=true FAKE_AWS_CONTROLLER_FULL=true
if remove_bootstrap_execution_authority; then
  echo 'ERROR: ambiguous self-revoke response was accepted as success' >&2
  exit 1
fi
$bootstrap_authority_revoked
calls_after_revoke_attempt="$(wc -l < "$fake_calls" | tr -d ' ')"
(cleanup)
test "$(wc -l < "$fake_calls" | tr -d ' ')" = "$calls_after_revoke_attempt"
unset FAKE_IAM_SELF_REVOKE_FAIL FAKE_AWS_CONTROLLER_PRESENT FAKE_AWS_CONTROLLER_FULL

# If task ownership cannot be proved, cleanup must fail closed and preserve both the reader secret
# and temporary IAM authority for an administrator to reconcile; it must not guess and delete them.
: > "$fake_calls"
printf '1\n' > "$fake_task_state"
export FAKE_AWS_EXACT_VISIBLE=true
export FAKE_AWS_STARTED_BY=unexpected-owner
export FAKE_AWS_FAMILY="watchdog-a5-production-bootstrap-${source_sha:0:12}"
bootstrap_cleanup_armed=true
bootstrap_authority_revoked=false
run_task_requested=true
task_arn=''
task_definition_arn=''
completed=false
if (cleanup) >/dev/null 2>&1; then
  echo 'ERROR: ambiguous bootstrap task ownership was accepted as clean' >&2
  exit 1
fi
if grep -Eq '^(secretsmanager|iam) ' "$fake_calls"; then
  echo 'ERROR: bootstrap secret or authority changed before task absence was proved' >&2
  exit 1
fi
printf '0\n' > "$fake_task_state"

echo 'production A5 read-only bootstrap spec: PASS'
