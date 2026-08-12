#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
bootstrap="$root/infra/security/bootstrap-production-promotion-prerequisites.sh"
principal="$root/infra/security/production-promotion-bootstrap-principal-policy.template.json"
trust="$root/infra/security/production-promotion-bootstrap-trust.template.json"
user_bridge="$root/infra/security/production-promotion-bootstrap-user-policy.template.json"
deploy="$root/infra/prod-ecs-express/github-deploy-role-policy.template.json"
security="$root/infra/security/production-security-readonly-policy.template.json"

bash -n "$bootstrap"
jq -e . "$principal" "$trust" "$user_bridge" "$deploy" "$security" >/dev/null

jq -e '
  ([.Statement[]|select(.Effect=="Allow")|.Action|if type=="array" then .[] else . end]|unique|sort)
  == ["iam:AttachRolePolicy","iam:CreateRole","iam:GetRole","iam:GetRolePolicy","iam:ListAttachedRolePolicies",
      "iam:ListRolePolicies","iam:PutRolePolicy","iam:UpdateAssumeRolePolicy","iam:UpdateRole",
      "s3:GetLifecycleConfiguration","s3:PutLifecycleConfiguration"]
  and ([.Statement[]|select(.Sid!="RepairExactProductionBucketLifecycle")|.Resource
      |if type=="array" then .[] else . end]
    |all(test("^arn:aws:iam::311414082667:role/[A-Za-z0-9_./+=,@-]+$")))
  and (.Statement[]|select(.Sid=="RepairExactProductionBucketLifecycle")
    |.Resource=="arn:aws:s3:::watchdog-bms-prod-311414082667"
    and (.Action|sort)==["s3:GetLifecycleConfiguration","s3:PutLifecycleConfiguration"])
  and ([.Statement[]|select(has("NotAction") or has("NotResource"))]|length)==0
' "$principal" >/dev/null

jq -e '.Statement==[{Sid:"ExactNonRootBootstrapOperator",Effect:"Allow",
  Principal:{AWS:"arn:aws:iam::311414082667:user/watchdog-bedrock-dev"},Action:"sts:AssumeRole"}]' \
  "$trust" >/dev/null
jq -e '.Statement==[{Effect:"Allow",Action:"sts:AssumeRole",
  Resource:"arn:aws:iam::311414082667:role/watchdog-bms-production-promotion-bootstrap"}]' \
  "$user_bridge" >/dev/null

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

for role in ecsInfrastructureRoleForExpressServices ecsTaskExecutionRole \
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

grep -Fq 'arn:aws:iam::$account:role/$bootstrap_role' "$bootstrap"
grep -Fq 'assumed-role/watchdog-bms-production-promotion-bootstrap/' "$bootstrap"
grep -Fq -- '--max-session-duration 7200' "$bootstrap"
grep -Fq 'update-role --role-name "$deploy_role" --max-session-duration 7200' "$bootstrap"
grep -Fq 'agentcore_runtime_arn=arn:aws:bedrock-agentcore:ap-southeast-1:311414082667:runtime/watchdog_orchestrator-6xOx1tCbz0' "$bootstrap"
grep -Fq 'put-bucket-lifecycle-configuration' "$bootstrap"
grep -Fq 'get-bucket-lifecycle-configuration' "$bootstrap"
grep -Fq 'watchdog-bms-prod-$account' "$bootstrap"
if grep -Fq 'AGENTCORE_RUNTIME_ARN:?' "$bootstrap"; then
  echo 'ERROR: bootstrap still depends on a manually supplied AgentCore ARN' >&2; exit 1
fi
grep -Fq 'changes only fifteen durable IAM roles' "$bootstrap"
grep -Fq 'attach-role-policy --role-name ecsTaskExecutionRole' "$bootstrap"
grep -Fq 'attach-role-policy --role-name ecsInfrastructureRoleForExpressServices' "$bootstrap"
if grep -Eq 'delete-role|delete-role-policy|detach-role-policy' "$bootstrap"; then
  echo 'ERROR: promotion prerequisite bootstrap contains destructive IAM mutation' >&2
  exit 1
fi

dry="$("$bootstrap")"
grep -Fq 'Dry run only.' <<< "$dry"
grep -Fq 'rejects the AWS root principal' <<< "$dry"
echo 'production promotion bootstrap contract: PASS'
