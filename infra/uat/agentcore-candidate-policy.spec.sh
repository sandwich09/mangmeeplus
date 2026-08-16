#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd -P)"
deploy_policy="$root/infra/uat/github-deploy-role-policy.template.json"
setup="$root/infra/uat/setup-control-plane.sh"
verify="$root/infra/uat/verify-control-plane-policies.sh"
workflow="$root/.github/workflows/deploy-uat.yml"
agentcore_deploy="$root/infra/ai-gateway/agentcore-deploy.sh"

jq -e '
  any(.Statement[];
    .Sid=="ManageUatAgentCoreCandidate"
    and ([.Action[]]|contains([
      "bedrock-agentcore:CreateAgentRuntime",
      "bedrock-agentcore:UpdateAgentRuntime",
      "bedrock-agentcore:CreateAgentRuntimeEndpoint",
      "bedrock-agentcore:GetAgentRuntimeEndpoint",
      "bedrock-agentcore:InvokeAgentRuntime"])))
  and any(.Statement[];
    .Action=="iam:GetRolePolicy"
    and (.Resource|index("arn:aws:iam::<ACCOUNT_ID>:role/watchdog-bms-uat-ecs-ai-gateway-role")))
' "$deploy_policy" >/dev/null

for file in "$setup" "$verify"; do
  grep -Fq 'runtime/watchdog_orchestrator_uat_candidate-*' "$file"
  grep -Fq 'runtime/watchdog_orchestrator_uat_candidate-*/runtime-endpoint/*' "$file"
done
grep -Fq 'verify watchdog-bms-uat-ecs-ai-gateway-role watchdog-bms-uat-ai-gateway-runtime' "$verify"

grep -Fq 'DEPLOY_ENVIRONMENT: uat' "$workflow"
grep -Fq 'validate-agentcore-candidate-binding.sh' "$workflow"
grep -Fq 'AGENTCORE_RUNTIME_QUALIFIER=$qualifier' "$workflow"
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
