#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd -P)"
deploy_policy="$root/infra/uat/github-deploy-role-policy.template.json"
production_deploy_policy="$root/infra/prod-ecs-express/github-deploy-role-policy.template.json"
setup="$root/infra/uat/setup-control-plane.sh"
verify="$root/infra/uat/verify-control-plane-policies.sh"
workflow="$root/.github/workflows/deploy-uat.yml"
agentcore_deploy="$root/infra/ai-gateway/agentcore-deploy.sh"
ai_policy="$root/infra/uat/ai-task-policy.template.json"
bootstrap="$root/infra/security/bootstrap-production-promotion-prerequisites.sh"
ceremony="$root/infra/security/run-production-promotion-prerequisite-ceremony.sh"

jq -e '
  .Statement[0].Resource==["<AGENTCORE_RUNTIME_ARN>","<AGENTCORE_RUNTIME_ARN>/runtime-endpoint/*"]
  and (.Statement[1].Resource|index("arn:aws:bedrock:*:<ACCOUNT_ID>:inference-profile/apac.anthropic.*"))!=null
  and (.Statement[1].Resource|index("arn:aws:bedrock:*:<ACCOUNT_ID>:inference-profile/global.anthropic.*"))!=null
' "$ai_policy" >/dev/null

jq -e '
  any(.Statement[];
    .Sid=="ManageUatAgentCoreCandidate"
    and ([.Action[]]|contains([
      "bedrock-agentcore:CreateAgentRuntime",
      "bedrock-agentcore:CreateWorkloadIdentity",
      "bedrock-agentcore:UpdateAgentRuntime",
      "bedrock-agentcore:CreateAgentRuntimeEndpoint",
      "bedrock-agentcore:GetAgentRuntimeEndpoint",
      "bedrock-agentcore:TagResource",
      "bedrock-agentcore:InvokeAgentRuntime"])))
  and any(.Statement[];
    ((.Action|if type=="array" then index("iam:GetRolePolicy") else .=="iam:GetRolePolicy" end))
    and (.Resource|index("arn:aws:iam::<ACCOUNT_ID>:role/watchdog-bms-uat-ecs-ai-gateway-role")))
  and any(.Statement[];
    .Sid=="ManageOnlyUatAgentCoreExecutionRole"
    and ([.Action[]]|contains(["iam:GetRolePolicy","iam:ListAttachedRolePolicies","iam:ListRolePolicies"])))
' "$deploy_policy" >/dev/null

jq -e '
  any(.Statement[];
    .Sid=="ManageProductionAgentCoreCandidate"
    and ([.Action[]]|contains([
      "bedrock-agentcore:CreateAgentRuntime",
      "bedrock-agentcore:CreateWorkloadIdentity",
      "bedrock-agentcore:UpdateAgentRuntime",
      "bedrock-agentcore:CreateAgentRuntimeEndpoint",
      "bedrock-agentcore:GetAgentRuntimeEndpoint",
      "bedrock-agentcore:TagResource",
      "bedrock-agentcore:InvokeAgentRuntime"])))
' "$production_deploy_policy" >/dev/null

for file in "$setup" "$verify"; do
  grep -Fq 'runtime/watchdog_orchestrator_uat_candidate-*' "$file"
  grep -Fq 'ai-task-policy.template.json' "$file"
done
grep -Fq 'verify_exact_role watchdog-bms-uat-ecs-ai-gateway-role watchdog-bms-uat-ai-gateway-runtime' "$verify"
grep -Fq 'verify_exact_role watchdog-bms-uat-agentcore-execution-role watchdog-bms-agentcore-permissions' "$verify"
grep -Fq 'ensure_role "$agentcore_role" "$tmp_dir/agentcore-trust.json"' "$setup"
grep -Fq 'APPLIED_BUT_UNVERIFIED: role=${agentcore_role} policy=watchdog-bms-agentcore-permissions' "$setup"
grep -Fq 'get-bucket-versioning' "$verify"
grep -Fq 'list-agent-runtimes' "$verify"
grep -Fq 'PUBLIC_DOMAIN_URL is not the canonical UAT origin' "$workflow"
grep -Fq -- '--apply-uat-runtime' "$bootstrap"
grep -Fq -- '--apply-uat-runtime' "$ceremony"

grep -Fq 'DEPLOY_ENVIRONMENT: uat' "$workflow"
grep -Fq 'validate-agentcore-candidate-binding.sh' "$workflow"
grep -Fq 'AGENTCORE_RUNTIME_QUALIFIER=$qualifier' "$workflow"
grep -Fq 'AGENTCORE_EXPECTED_SOURCE_COMMIT=$SOURCE_COMMIT' "$workflow"
grep -Fq 'AGENTCORE_EXPECTED_ARTIFACT_SHA256=$artifact_sha' "$workflow"
grep -Fq 'AGENTCORE_EXPECTED_CONTRACT_VERSION=$contract_version' "$workflow"
if grep -Fq "AGENTCORE_RUNTIME_QUALIFIER: \${{ vars.AGENTCORE_RUNTIME_QUALIFIER || 'DEFAULT' }}" "$workflow"; then
  echo 'ERROR: UAT workflow still permits a mutable DEFAULT endpoint' >&2
  exit 1
fi

# AWS CLI 2.36 exposes targetVersion/liveVersion for endpoint read-back. There is no
# agentRuntimeVersion field on get-agent-runtime-endpoint output.
grep -Fq "'.targetVersion'" "$agentcore_deploy"
grep -Fq "'.liveVersion'" "$agentcore_deploy"
grep -Fq "'.agentRuntimeArn'" "$agentcore_deploy"
grep -Fq 'refusing to guess that it is absent' "$agentcore_deploy"
grep -Fq 'test "$ENDPOINT_ARN" = "$RUNTIME_ARN/runtime-endpoint/$ENDPOINT_NAME"' "$agentcore_deploy"

echo 'UAT AgentCore candidate policy contract: PASS'
