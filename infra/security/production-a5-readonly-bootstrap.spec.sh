#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
validator="$repo_root/infra/security/validate-production-a5-readonly-security-groups.sh"
bootstrap="$repo_root/infra/security/bootstrap-production-a5-readonly.sh"
database_bootstrap="$repo_root/infra/security/bootstrap-production-a5-database-reader.sh"
bootstrap_workflow="$repo_root/.github/workflows/production-a5-reader-bootstrap.yml"
controller_policy="$repo_root/infra/security/production-a5-readonly-policy.template.json"
reader_bootstrap_policy="$repo_root/infra/security/production-a5-reader-bootstrap-policy.template.json"
reader_policy="$repo_root/infra/security/production-a5-readonly-execution-policy.template.json"
bootstrap_policy="$repo_root/infra/security/production-a5-bootstrap-execution-policy.template.json"
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
  and any(.Statement[]; .Sid=="RunBootstrapTask" and .Action=="ecs:RunTask"
    and (.Resource|contains("task-definition/watchdog-a5-production-bootstrap-")))
  and any(.Statement[]; .Sid=="StopBootstrapTask" and .Action=="ecs:StopTask"
    and (.Resource|contains("task/watchdog-bms-prod/")))
  and any(.Statement[]; .Sid=="SelfRevokeBootstrapController"
    and (.Action|index("iam:PutRolePolicy"))!=null)
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
    "$reader_policy" "$bootstrap_policy"; then
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
grep -Eq 'BootstrapRevoked' "$database_bootstrap"
grep -Eq 'put-role-policy.*bootstrap_controller_role_name' "$database_bootstrap"
grep -Fq 'role-to-assume: ${{ env.A5_READER_BOOTSTRAP_ROLE_ARN }}' "$bootstrap_workflow"
grep -Fq 'assumed-role/watchdog-bms-production-a5-reader-bootstrap/' "$bootstrap_workflow"
credentials_line="$(grep -nF 'name: Configure one-time A5 reader controller' "$bootstrap_workflow" | cut -d: -f1)"
login_line="$(grep -nF 'aws ecr get-login-password' "$bootstrap_workflow" | cut -d: -f1)"
image_verify_line="$(grep -nF -- '--certificate-oidc-issuer https://token.actions.githubusercontent.com "$MIGRATION_IMAGE"' \
  "$bootstrap_workflow" | cut -d: -f1)"
[[ "$credentials_line" =~ ^[0-9]+$ && "$login_line" =~ ^[0-9]+$ && "$image_verify_line" =~ ^[0-9]+$ ]]
(( credentials_line < login_line && login_line < image_verify_line ))
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
    ExposedPorts:{},Labels:{"org.opencontainers.image.revision":$source,
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
if PATH="$work/bin:$PATH" MOCK_IMAGE_SOURCE="$(printf 'c%.0s' {1..40})" \
    bash "$migration_tool_validator" "$image" "$source_sha" >/dev/null 2>&1; then
  echo 'ERROR: signed migration-tool with the wrong source revision was accepted' >&2
  exit 1
fi

echo 'production A5 read-only bootstrap spec: PASS'
