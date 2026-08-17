#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd -P)"
deploy_policy="$root/infra/uat/github-deploy-role-policy.template.json"
production_deploy_policy="$root/infra/prod-ecs-express/github-deploy-role-policy.template.json"
setup="$root/infra/uat/setup-control-plane.sh"
verify="$root/infra/uat/verify-control-plane-policies.sh"
workflow="$root/.github/workflows/deploy-uat.yml"
ci_workflow="$root/.github/workflows/ci.yml"
agentcore_deploy="$root/infra/ai-gateway/agentcore-deploy.sh"
artifact_build="$root/infra/ai-gateway/build-agentcore-artifact.sh"
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
      "bedrock-agentcore:UpdateAgentRuntimeEndpoint",
      "bedrock-agentcore:DeleteAgentRuntimeEndpoint",
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
      "bedrock-agentcore:UpdateAgentRuntimeEndpoint",
      "bedrock-agentcore:DeleteAgentRuntimeEndpoint",
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
agentcore_line="$(grep -n 'name: Deploy exact AgentCore candidate' "$workflow" | cut -d: -f1)"
release_task_line="$(grep -n 'name: Verify and run UAT release task' "$workflow" | cut -d: -f1)"
service_deploy_line="$(grep -n 'name: Deploy immutable UAT manifest' "$workflow" | cut -d: -f1)"
test "$agentcore_line" -lt "$release_task_line"
test "$release_task_line" -lt "$service_deploy_line"
grep -Fq 'AgentCore failed before the durable release task; no rollout parent exists' "$workflow"
grep -Fq 'release_controller_only: ${{ steps.source.outputs.release_controller_only }}' "$ci_workflow"
grep -Fq 'name: Test AgentCore release controller without application TypeScript' "$ci_workflow"
grep -Fq "if: needs.resolve-source.outputs.release_controller_only == 'true'" "$ci_workflow"
grep -Fq "if: needs.resolve-source.outputs.recovery_only != 'true' && needs.resolve-source.outputs.release_controller_only != 'true'" "$ci_workflow"
if grep -Fq "AGENTCORE_RUNTIME_QUALIFIER: \${{ vars.AGENTCORE_RUNTIME_QUALIFIER || 'DEFAULT' }}" "$workflow"; then
  echo 'ERROR: UAT workflow still permits a mutable DEFAULT endpoint' >&2
  exit 1
fi

# Settled AWS endpoint read-back can omit targetVersion and retain only liveVersion. Candidate deploy
# must use the same lifecycle-aware exact validator as Production readiness.
grep -Fq 'validate-agentcore-endpoint-readback.sh' "$agentcore_deploy"
grep -Fq 'refusing to guess that it is absent' "$agentcore_deploy"
grep -Fq 'describe-express-gateway-service' "$agentcore_deploy"
grep -Fq 'preserving live endpoint' "$agentcore_deploy"
grep -Fq 'delete-agent-runtime-endpoint' "$agentcore_deploy"
grep -Fq 'exact runtime configuration is already READY' "$agentcore_deploy"
grep -Fq 'reusing existing content-addressed object version' "$agentcore_deploy"
grep -Fq 'pinned content-addressed AgentCore object has different bytes' "$agentcore_deploy"
grep -Fq -- "--if-none-match '*'" "$agentcore_deploy"
grep -Fq 'ENDPOINT_NAME="candidate_${DEPLOY_ENVIRONMENT}_${SOURCE_COMMIT:0:12}_${actual_sha:0:8}"' "$agentcore_deploy"
grep -Fq 'TZ=UTC touch -t 198001010000.00 "$staging/runtime.js"' "$artifact_build"
if sed -n '/bedrock-agentcore-control \(create\|update\|delete\)-agent-runtime-endpoint/,/--output json/p' \
    "$agentcore_deploy" | grep -Fq -- '--client-token'; then
  echo 'ERROR: endpoint lifecycle still uses a provider-tombstoned client token' >&2
  exit 1
fi

endpoint_fixture='{"runtimeEndpoints":[{"name":"DEFAULT"},{"name":"candidate_uat_old000000001"},{"name":"candidate_uat_live00000001"},{"name":"candidate_production_other000001"},{"name":"foreign"}]}'
test "$(jq -r --arg environment uat --arg intended candidate_uat_new000000001 \
  --argjson protected '["candidate_uat_live00000001"]' \
  -f "$root/infra/ai-gateway/select-retirable-agentcore-endpoints.jq" \
  <<< "$endpoint_fixture")" = candidate_uat_old000000001

echo 'UAT AgentCore candidate policy contract: PASS'
