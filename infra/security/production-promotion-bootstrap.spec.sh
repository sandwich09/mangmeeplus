#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
bootstrap="$root/infra/security/bootstrap-production-promotion-prerequisites.sh"
ceremony="$root/infra/security/run-production-promotion-prerequisite-ceremony.sh"
principal="$root/infra/security/production-promotion-bootstrap-principal-policy.template.json"
trust="$root/infra/security/production-promotion-bootstrap-trust.template.json"
user_bridge="$root/infra/security/production-promotion-bootstrap-user-policy.template.json"
deploy="$root/infra/prod-ecs-express/github-deploy-role-policy.template.json"
uat_deploy="$root/infra/uat/github-deploy-role-policy.template.json"
security="$root/infra/security/production-security-readonly-policy.template.json"
reader_bootstrap="$root/infra/security/production-a5-reader-bootstrap-policy.template.json"

bash -n "$bootstrap" "$ceremony"
jq -e . "$principal" "$trust" "$user_bridge" "$deploy" "$uat_deploy" "$security" "$reader_bootstrap" \
  >/dev/null

jq -e '
  ([.Statement[]|select(.Effect=="Allow")|.Action|if type=="array" then .[] else . end]|unique|sort)
  == ["iam:AttachRolePolicy","iam:CreateRole","iam:GetRole","iam:GetRolePolicy","iam:ListAttachedRolePolicies",
      "iam:ListRolePolicies","iam:PutRolePolicy","iam:UpdateAssumeRolePolicy","iam:UpdateRole",
      "rds:DescribeDBInstances","s3:GetLifecycleConfiguration","s3:PutLifecycleConfiguration",
      "secretsmanager:DescribeSecret","ssm:GetParameters","ssm:PutParameter"]
  and ([.Statement[]|select(.Sid|IN("RepairExactProductionBucketLifecycle",
        "ReadExactProductionDatabaseConfiguration",
        "ReadExactAgentCorePolicySecrets","RepairExactCloneDatabaseConfigurationPointers")|not)|.Resource
      |if type=="array" then .[] else . end]
    |all(test("^arn:aws:iam::311414082667:role/[A-Za-z0-9_./+=,@-]+$")))
  and (.Statement[]|select(.Sid=="RepairExactProductionBucketLifecycle")
    |.Resource=="arn:aws:s3:::watchdog-bms-prod-311414082667"
    and (.Action|sort)==["s3:GetLifecycleConfiguration","s3:PutLifecycleConfiguration"])
  and (.Statement[]|select(.Sid=="ReadExactProductionDatabaseConfiguration")
    |.Action=="rds:DescribeDBInstances" and .Resource=="*")
  and (.Statement[]|select(.Sid=="ReadExactAgentCorePolicySecrets")
    |.Action=="secretsmanager:DescribeSecret" and (.Resource|length)==2
    and all(.Resource[];startswith("arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/")))
  and (.Statement[]|select(.Sid=="RepairExactCloneDatabaseConfigurationPointers")
    |(.Action|sort)==["ssm:GetParameters","ssm:PutParameter"]
    and (.Resource|sort)==[
      "arn:aws:ssm:ap-southeast-1:311414082667:parameter/watchdog-bms/production/a5-clone/db-parameter-group-name",
      "arn:aws:ssm:ap-southeast-1:311414082667:parameter/watchdog-bms/production/a5-clone/db-subnet-group-name",
      "arn:aws:ssm:ap-southeast-1:311414082667:parameter/watchdog-bms/production/a5-clone/option-group-name"])
  and ([.Statement[]|select(has("NotAction") or has("NotResource"))]|length)==0
' "$principal" >/dev/null

jq -e '.Statement==[{Sid:"ExactNonRootBootstrapOperator",Effect:"Allow",
  Principal:{AWS:"arn:aws:iam::311414082667:user/watchdog-bedrock-dev"},Action:"sts:AssumeRole"}]' \
  "$trust" >/dev/null
jq -e '.Statement==[{Effect:"Allow",Action:"sts:AssumeRole",
  Resource:"arn:aws:iam::311414082667:role/watchdog-bms-production-promotion-bootstrap"}]' \
  "$user_bridge" >/dev/null

jq -e '
  any(.Statement[]; .Sid=="ListBootstrapTasksInExactCluster"
    and .Action=="ecs:ListTasks" and .Resource=="*"
    and .Condition.ArnEquals["ecs:cluster"]
      =="arn:aws:ecs:ap-southeast-1:311414082667:cluster/watchdog-bms-prod")
  and any(.Statement[]; .Sid=="ReconcileBootstrapTaskDefinitions"
    and (.Action|sort)==["ecs:DeregisterTaskDefinition","ecs:DescribeTaskDefinition","ecs:ListTaskDefinitions"]
    and .Resource=="*")
  and any(.Statement[]; .Sid=="DenyOutsideOneTimeReaderBootstrap"
    and (.NotAction|index("ecs:ListTasks"))!=null
    and (.NotAction|index("ecs:ListTaskDefinitions"))!=null
    and (.NotAction|index("ecs:DescribeTaskDefinition"))!=null)
' "$reader_bootstrap" >/dev/null

jq -e '
  any(.Statement[];.Sid=="ReadExactWorkerHealthToken"
    and .Action=="secretsmanager:GetSecretValue"
    and .Resource=="arn:aws:secretsmanager:ap-southeast-1:<ACCOUNT_ID>:secret:watchdog-bms/production/worker-internal-token-*")
  and ([.Statement[]|select(.Effect=="Allow")
    |select((.Action|if type=="array" then index("secretsmanager:GetSecretValue") else .=="secretsmanager:GetSecretValue" end))
    |.Resource] | all(.=="arn:aws:secretsmanager:ap-southeast-1:<ACCOUNT_ID>:secret:watchdog-bms/production/worker-internal-token-*") )
  and any(.Statement[];.Sid=="NetworkRead"
    and (.Action|index("ec2:DescribeNetworkInterfaces"))!=null)
  and any(.Statement[];.Sid=="LoadBalancerHealthRead"
    and (.Action|sort)==["elasticloadbalancing:DescribeTargetGroups","elasticloadbalancing:DescribeTargetHealth"])
' "$deploy" >/dev/null
jq -e '
  any(.Statement[];.Sid=="RegisterAndReadTaskDefinitions"
    and (.Action|index("ecs:ListTaskDefinitions"))!=null)
' "$uat_deploy" >/dev/null
jq -e '
  any(.Statement[];.Sid=="ReadExactPromotionRoles"
    and (.Resource|index("arn:aws:iam::311414082667:role/watchdog-bms-deploy-uat"))!=null)
  and any(.Statement[];.Sid=="WriteExactPromotionPolicies"
    and (.Resource|index("arn:aws:iam::311414082667:role/watchdog-bms-deploy-uat"))!=null)
  and all(.Statement[]|select(.Sid|IN("ConfigureExactPromotionTrust",
    "ConfigureExactPromotionDuration","CreateOnlyMissingA5Roles"));
    (.Resource|index("arn:aws:iam::311414082667:role/watchdog-bms-deploy-uat"))==null)
' "$principal" >/dev/null

for role in ecsInfrastructureRoleForExpressServices ecsTaskExecutionRole \
  watchdog-bms-agentcore-execution-role \
  watchdog-bms-deploy-production watchdog-bms-ecs-express-ai-gateway-role \
  watchdog-bms-ecs-express-api-role watchdog-bms-ecs-express-workers-role \
  watchdog-bms-release-task-role \
  watchdog-bms-production-security-readonly watchdog-bms-production-a5-readonly \
  watchdog-bms-production-a5-reader-bootstrap watchdog-bms-production-a5-clone \
  watchdog-bms-production-a5-readonly-execution watchdog-bms-production-a5-bootstrap-execution \
  watchdog-bms-production-a5-apply-execution watchdog-bms-production-a5-clone-execution; do
  jq -e --arg arn "arn:aws:iam::311414082667:role/$role" '
    any(.Statement[];.Sid=="AllowSelfInspection" and (.Resource|index($arn))!=null)
  ' "$security" >/dev/null
  grep -Fq "$role" "$bootstrap"
done
for arn in \
  arn:aws:iam::311414082667:role/aws-service-role/rds.amazonaws.com/AWSServiceRoleForRDS \
  arn:aws:iam::311414082667:role/aws-service-role/elasticache.amazonaws.com/AWSServiceRoleForElastiCache; do
  jq -e --arg arn "$arn" '
    any(.Statement[];.Sid=="AllowSelfInspection" and (.Resource|index($arn))!=null)
  ' "$security" >/dev/null
  jq -e --arg arn "$arn" '
    any(.Statement[];.Sid=="ReadExactPromotionRoles" and (.Resource|index($arn))!=null)
  ' "$principal" >/dev/null
done
grep -Fq 'assert_service_linked_role AWSServiceRoleForRDS' "$bootstrap"
grep -Fq 'assert_service_linked_role AWSServiceRoleForElastiCache' "$bootstrap"

grep -Fq 'arn:aws:iam::$account:role/$bootstrap_role' "$bootstrap"
grep -Fq 'assumed-role/watchdog-bms-production-promotion-bootstrap/' "$bootstrap"
grep -Fq -- '--max-session-duration 7200' "$bootstrap"
grep -Fq 'update-role --role-name "$deploy_role" --max-session-duration 7200' "$bootstrap"
grep -Fq 'agentcore_runtime_arn=arn:aws:bedrock-agentcore:ap-southeast-1:311414082667:runtime/watchdog_orchestrator-6xOx1tCbz0' "$bootstrap"
grep -Fq 'put-bucket-lifecycle-configuration' "$bootstrap"
grep -Fq 'get-bucket-lifecycle-configuration' "$bootstrap"
grep -Fq 'watchdog-bms-prod-$account' "$bootstrap"
grep -Fq 'expected_clone_restore_resources' "$bootstrap"
grep -Fq '.DBParameterGroups|select(length==1)|.[0]' "$bootstrap"
grep -Fq '.OptionGroupMemberships|select(length==1)|.[0]' "$bootstrap"
grep -Fq 'db-parameter-group-name' "$bootstrap"
grep -Fq 'option-group-name' "$bootstrap"
grep -Fq 'aws ssm put-parameter' "$bootstrap"
grep -Fq 'aws ssm get-parameters' "$bootstrap"
if grep -Fq 'AGENTCORE_RUNTIME_ARN:?' "$bootstrap"; then
  echo 'ERROR: bootstrap still depends on a manually supplied AgentCore ARN' >&2; exit 1
fi
grep -Fq 'changes only seventeen durable IAM roles, and read-checks five service-linked roles' "$bootstrap"
grep -Fq 'uat_deploy_role=watchdog-bms-deploy-uat' "$bootstrap"
grep -Fq 'uat_deploy_policy_name=watchdog-bms-uat-deploy' "$bootstrap"
grep -Fq 'retry_exact assert_exact_policy_role "$uat_deploy_role"' "$bootstrap"
grep -Fq 'PROMOTION_IAM_RETRY_SECONDS:-5' "$bootstrap"
grep -Fq 'retry_mutation()' "$bootstrap"
grep -Fq 'retry_admin_mutation()' "$ceremony"
grep -Fq 'has("PermissionsBoundary")|not' "$bootstrap"
grep -Fq 'attach-role-policy --role-name ecsTaskExecutionRole' "$bootstrap"
grep -Fq 'attach-role-policy --role-name ecsInfrastructureRoleForExpressServices' "$bootstrap"
if grep -Eq 'delete-role|delete-role-policy|detach-role-policy' "$bootstrap"; then
  echo 'ERROR: promotion prerequisite bootstrap contains destructive IAM mutation' >&2
  exit 1
fi
grep -Fq 'PROMOTION_ROOT_EXCEPTION_APPROVAL_REF' "$ceremony"
grep -Fq 'prove_exact_authority' "$ceremony"
grep -Fq 'trap cleanup EXIT' "$ceremony"
grep -Fq 'wait_absent bridge' "$ceremony"
grep -Fq 'wait_absent role-policy' "$ceremony"
grep -Fq 'wait_absent role iam get-role' "$ceremony"
grep -Fq 'env -u AWS_PROFILE -u AWS_DEFAULT_PROFILE bash "$helper" --apply' "$ceremony"

dry="$("$bootstrap")"
grep -Fq 'Dry run only.' <<< "$dry"
grep -Fq 'rejects the AWS root principal' <<< "$dry"
ceremony_dry="$(bash "$ceremony")"
grep -Fq 'creates, proves, uses, retires, and proves absence' <<< "$ceremony_dry"

fixture="$(mktemp -d "${TMPDIR:-/tmp}/promotion-ceremony-spec.XXXXXX")"
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/repo/infra/security" "$fixture/bin" "$fixture/state"
cp "$ceremony" "$fixture/repo/infra/security/run-production-promotion-prerequisite-ceremony.sh"
cp "$trust" "$fixture/repo/infra/security/production-promotion-bootstrap-trust.template.json"
cp "$principal" "$fixture/repo/infra/security/production-promotion-bootstrap-principal-policy.template.json"
cp "$user_bridge" "$fixture/repo/infra/security/production-promotion-bootstrap-user-policy.template.json"
cat > "$fixture/repo/infra/security/bootstrap-production-promotion-prerequisites.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
test "${1:-}" = --apply
test "${AWS_ACCOUNT_ID:-}" = 311414082667
test -z "${AWS_PROFILE:-}"
test -z "${AWS_DEFAULT_PROFILE:-}"
test -n "${AWS_ACCESS_KEY_ID:-}"
test -n "${AWS_SECRET_ACCESS_KEY:-}"
test -n "${AWS_SESSION_TOKEN:-}"
test "${PROMOTION_IAM_MAX_ATTEMPTS:-}" = 8
test "${PROMOTION_IAM_RETRY_SECONDS:-}" = 0
: > "$FAKE_AWS_STATE/helper-ran"
exit "${FAKE_HELPER_STATUS:-0}"
SH
chmod +x "$fixture/repo/infra/security/bootstrap-production-promotion-prerequisites.sh"

cat > "$fixture/bin/aws" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
service="$1" operation="$2"
printf '%s %s %s\n' "${AWS_PROFILE:-session}" "$service" "$operation" >> "$FAKE_AWS_STATE/calls"

counter() {
  local file="$1" value=0
  [ ! -f "$file" ] || value="$(<"$file")"
  value=$((value+1)); printf '%s\n' "$value" > "$file"; printf '%s\n' "$value"
}
not_found() { echo 'An error occurred (NoSuchEntity) when calling the fake operation' >&2; exit 254; }
visible() {
  local entity="$1" phase count limit
  if [ -f "$FAKE_AWS_STATE/$entity.exists" ]; then
    phase=create; limit="${FAKE_CREATE_STALE_READS:-0}"
  elif [ -f "$FAKE_AWS_STATE/$entity.deleted" ]; then
    phase=delete; limit="${FAKE_DELETE_STALE_READS:-0}"
  else
    return 1
  fi
  count="$(counter "$FAKE_AWS_STATE/$entity.$phase.count")"
  if [ "$phase" = create ]; then [ "$count" -gt "$limit" ]; else [ "$count" -le "$limit" ]; fi
}
accepted_but_lost() {
  local operation="$1" marker="$FAKE_AWS_STATE/accepted-$1"
  if [ "${FAKE_ACCEPTED_ERROR:-}" = "$operation" ] && [ ! -f "$marker" ]; then
    touch "$marker"
    echo 'An error occurred (ServiceFailure) after the fake service accepted the mutation' >&2
    return 0
  fi
  return 1
}

if [ "$service $operation" = 'sts get-caller-identity' ]; then
  if [ "${AWS_PROFILE:-}" = watchdog-bedrock ]; then
    arn=arn:aws:iam::311414082667:user/watchdog-bedrock-dev
  elif [ "${FAKE_ADMIN_ROOT:-0}" = 1 ]; then
    arn=arn:aws:iam::311414082667:root
  else
    arn=arn:aws:iam::311414082667:role/platform-admin
  fi
  if [[ " $* " == *' --query Arn '* ]]; then printf '%s\n' "$arn"
  else jq -cn --arg arn "$arn" '{Account:"311414082667",Arn:$arn,UserId:"fixture"}'; fi
  exit 0
fi
if [ "$service $operation" = 'sts assume-role' ]; then
  count="$(counter "$FAKE_AWS_STATE/assume.count")"
  if [ "$count" -le "${FAKE_ASSUME_FAILURES:-0}" ]; then
    echo 'An error occurred (AccessDenied) while the role propagates' >&2; exit 254
  fi
  jq -cn '{Credentials:{AccessKeyId:"ASIAFIXTURE",SecretAccessKey:"fixture-secret",
    SessionToken:"fixture-token",Expiration:"2099-01-01T00:00:00Z"}}'
  exit 0
fi

case "$service $operation" in
  'iam create-role')
    if [ "${FAKE_CREATE_RACE:-0}" = 1 ]; then
      touch "$FAKE_AWS_STATE/foreign-role.exists"
      echo 'An error occurred (EntityAlreadyExists) when calling the CreateRole operation' >&2
      exit 254
    fi
    touch "$FAKE_AWS_STATE/role.exists"; rm -f "$FAKE_AWS_STATE/role.deleted"
    if [ "${FAKE_CREATE_OWN_ALREADY_EXISTS:-0}" = 1 ]; then
      echo 'An error occurred (EntityAlreadyExists) after the fake CLI retried an accepted CreateRole' >&2
      exit 254
    fi
    accepted_but_lost create-role && exit 254; exit 0 ;;
  'iam list-role-tags')
    count="$(counter "$FAKE_AWS_STATE/role-tags.count")"
    if [ "$count" -le "${FAKE_ROLE_TAG_FAILURES:-0}" ]; then
      echo 'An error occurred (NoSuchEntity) while the role tag propagates' >&2
      exit 254
    fi
    if [ "$count" -le "$(( ${FAKE_ROLE_TAG_FAILURES:-0} + ${FAKE_ROLE_TAG_EMPTY_READS:-0} ))" ]; then
      jq -cn '{Tags:[]}'
      exit 0
    fi
    if [ -f "$FAKE_AWS_STATE/foreign-role.exists" ]; then
      jq -cn '{Tags:[{Key:"WatchdogCeremonyId",Value:"foreign-ceremony"}]}'
    else
      jq -cn --arg id "${PROMOTION_CEREMONY_ID:?}" \
        '{Tags:[{Key:"WatchdogCeremonyId",Value:$id}]}'
    fi
    exit 0 ;;
  'iam put-role-policy')
    count="$(counter "$FAKE_AWS_STATE/put-role-policy.count")"
    if [ "$count" -le "${FAKE_ROLE_POLICY_FAILURES:-0}" ]; then
      echo 'An error occurred (NoSuchEntity) while the role propagates' >&2
      exit 254
    fi
    touch "$FAKE_AWS_STATE/role-policy.exists"; rm -f "$FAKE_AWS_STATE/role-policy.deleted"
    accepted_but_lost put-role-policy && exit 254; exit 0 ;;
  'iam put-user-policy')
    count="$(counter "$FAKE_AWS_STATE/put-user-policy.count")"
    if [ "$count" -le "${FAKE_USER_POLICY_FAILURES:-0}" ]; then
      echo 'An error occurred (ConcurrentModification) while the bridge propagates' >&2
      exit 254
    fi
    touch "$FAKE_AWS_STATE/bridge.exists"; rm -f "$FAKE_AWS_STATE/bridge.deleted"
    accepted_but_lost put-user-policy && exit 254; exit 0 ;;
  'iam delete-user-policy')
    rm -f "$FAKE_AWS_STATE/bridge.exists"; touch "$FAKE_AWS_STATE/bridge.deleted"; exit 0 ;;
  'iam delete-role-policy')
    rm -f "$FAKE_AWS_STATE/role-policy.exists"; touch "$FAKE_AWS_STATE/role-policy.deleted"; exit 0 ;;
  'iam delete-role')
    rm -f "$FAKE_AWS_STATE/role.exists"; touch "$FAKE_AWS_STATE/role.deleted"; exit 0 ;;
  'iam get-role')
    visible role || not_found
    jq -cn --slurpfile trust "$FAKE_TRUST" '{Role:{Arn:"arn:aws:iam::311414082667:role/watchdog-bms-production-promotion-bootstrap",
      RoleName:"watchdog-bms-production-promotion-bootstrap",Path:"/",MaxSessionDuration:3600,
      AssumeRolePolicyDocument:$trust[0]}}'; exit 0 ;;
  'iam get-role-policy')
    visible role-policy || not_found
    jq -cn --slurpfile policy "$FAKE_PRINCIPAL" '{RoleName:"watchdog-bms-production-promotion-bootstrap",
      PolicyName:"watchdog-bms-production-promotion-bootstrap",PolicyDocument:$policy[0]}'; exit 0 ;;
  'iam get-user-policy')
    visible bridge || not_found
    jq -cn --slurpfile policy "$FAKE_BRIDGE" '{UserName:"watchdog-bedrock-dev",
      PolicyName:"watchdog-bms-production-promotion-bootstrap-assume",PolicyDocument:$policy[0]}'; exit 0 ;;
  'iam list-role-policies')
    jq -cn '{PolicyNames:["watchdog-bms-production-promotion-bootstrap"]}'; exit 0 ;;
  'iam list-attached-role-policies')
    if [ "${FAKE_EXTRA_ATTACHMENT:-0}" = 1 ]; then
      jq -cn '{AttachedPolicies:[{PolicyName:"Admin",PolicyArn:"arn:aws:iam::aws:policy/AdministratorAccess"}]}'
    else
      jq -cn '{AttachedPolicies:[]}'
    fi
    exit 0 ;;
esac
echo "unsupported fake AWS command: $*" >&2
exit 2
SH
chmod +x "$fixture/bin/aws"

reset_fake() {
  rm -rf -- "$fixture/state"
  mkdir -p "$fixture/state"
  : > "$fixture/state/calls"
}
run_ceremony() {
  PATH="$fixture/bin:$PATH" FAKE_AWS_STATE="$fixture/state" \
    FAKE_TRUST="$trust" FAKE_PRINCIPAL="$principal" FAKE_BRIDGE="$user_bridge" \
    AWS_ACCOUNT_ID=311414082667 PROMOTION_ADMIN_PROFILE=platform-admin \
    PROMOTION_CEREMONY_ID=fixture-ceremony \
    PROMOTION_IAM_MAX_ATTEMPTS=8 PROMOTION_IAM_RETRY_SECONDS=0 \
    bash "$fixture/repo/infra/security/run-production-promotion-prerequisite-ceremony.sh" --apply
}
assert_mutation_order() {
  test "$(awk '$2=="iam" && $3 ~ /^(create-role|put-role-policy|put-user-policy|delete-user-policy|delete-role-policy|delete-role)$/ {print $3}' \
    "$fixture/state/calls")" = "$(printf '%s\n' create-role put-role-policy put-user-policy \
      delete-user-policy delete-role-policy delete-role)"
}

reset_fake
FAKE_CREATE_STALE_READS=1 FAKE_DELETE_STALE_READS=1 FAKE_ASSUME_FAILURES=1 run_ceremony
test -f "$fixture/state/helper-ran"
test "$(grep -Fc 'watchdog-bedrock sts assume-role' "$fixture/state/calls")" -eq 2
assert_mutation_order

reset_fake
FAKE_ROLE_POLICY_FAILURES=1 FAKE_USER_POLICY_FAILURES=1 run_ceremony
test "$(grep -Fc 'platform-admin iam put-role-policy' "$fixture/state/calls")" -eq 2
test "$(grep -Fc 'platform-admin iam put-user-policy' "$fixture/state/calls")" -eq 2
test -f "$fixture/state/helper-ran"
test ! -f "$fixture/state/role.exists"
test ! -f "$fixture/state/role-policy.exists"
test ! -f "$fixture/state/bridge.exists"

reset_fake
if FAKE_ADMIN_ROOT=1 run_ceremony >/dev/null 2>&1; then
  echo 'ERROR: ceremony accepted AWS root without an approval reference' >&2; exit 1
fi
if grep -Eq ' iam (create-role|put-role-policy|put-user-policy)' "$fixture/state/calls"; then
  echo 'ERROR: rejected root path mutated temporary IAM' >&2; exit 1
fi

reset_fake
set +e
FAKE_ADMIN_ROOT=1 PROMOTION_ROOT_EXCEPTION_APPROVAL_REF=owner-approval-fixture \
  FAKE_HELPER_STATUS=42 run_ceremony >/dev/null 2>&1
helper_status=$?
set -e
test "$helper_status" -eq 42
test -f "$fixture/state/helper-ran"
assert_mutation_order

reset_fake
set +e
FAKE_EXTRA_ATTACHMENT=1 PROMOTION_IAM_MAX_ATTEMPTS=2 run_ceremony >/dev/null 2>&1
proof_status=$?
set -e
test "$proof_status" -ne 0
test ! -f "$fixture/state/helper-ran"
assert_mutation_order

for lost_response in create-role put-role-policy put-user-policy; do
  reset_fake
  set +e
  FAKE_ACCEPTED_ERROR="$lost_response" run_ceremony >/dev/null 2>&1
  lost_status=$?
  set -e
  if [ "$lost_response" = create-role ]; then
    test "$lost_status" -eq 254
  else
    test "$lost_status" -eq 0
    test -f "$fixture/state/helper-ran"
  fi
  test ! -f "$fixture/state/role.exists"
  test ! -f "$fixture/state/role-policy.exists"
  test ! -f "$fixture/state/bridge.exists"
  test "$(awk '$2=="iam" && $3 ~ /^delete-(user-policy|role-policy|role)$/ {print $3}' \
    "$fixture/state/calls")" = "$(printf '%s\n' delete-user-policy delete-role-policy delete-role)"
done

reset_fake
set +e
FAKE_CREATE_OWN_ALREADY_EXISTS=1 FAKE_ROLE_TAG_FAILURES=1 FAKE_ROLE_TAG_EMPTY_READS=1 \
  run_ceremony >/dev/null 2>&1
own_retry_status=$?
set -e
test "$own_retry_status" -eq 254
test ! -f "$fixture/state/role.exists"
test "$(grep -Fc 'platform-admin iam list-role-tags' "$fixture/state/calls")" -eq 3
test "$(awk '$2=="iam" && $3 ~ /^delete-(user-policy|role-policy|role)$/ {print $3}' \
  "$fixture/state/calls")" = "$(printf '%s\n' delete-user-policy delete-role-policy delete-role)"

reset_fake
set +e
FAKE_CREATE_RACE=1 run_ceremony >/dev/null 2>&1
race_status=$?
set -e
test "$race_status" -eq 254
test -f "$fixture/state/foreign-role.exists"
if grep -Eq ' iam delete-(user-policy|role-policy|role)' "$fixture/state/calls"; then
  echo 'ERROR: losing ceremony deleted authority owned by the create-role race winner' >&2
  exit 1
fi

echo 'production promotion bootstrap contract: PASS'
