#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
agentcore="$repo_root/infra/ai-gateway/agentcore-deploy.sh"
ecs="$repo_root/infra/prod-ecs-express/deploy.sh"
template="$repo_root/infra/ai-gateway/task-definition.template.json"
trust="$repo_root/infra/ai-gateway/agentcore-execution-role-trust.template.json"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/agentcore-role-propagation.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

bash -n "$agentcore"
bash -n "$ecs"

# Turns execute in AgentCore: exercise its actual environment renderer for both deployments,
# including draft-tool visibility, rather than accepting ECS-only activation as parity evidence.
awk '/^AGENTCORE_LINE_AI_FUSED_PLAN_SHADOW_ENABLED=/{on=1} /^ENV_SHA=/{exit} on{print}' \
  "$agentcore" > "$tmp_dir/runtime-env.sh"
printf '\nprintf "%%s" "$ENV_VARS"\n' >> "$tmp_dir/runtime-env.sh"
for stage in uat production; do
  env -i PATH="$PATH" DEPLOY_ENVIRONMENT="$stage" bash "$tmp_dir/runtime-env.sh" \
    | jq -e '.LINE_AI_FUSED_PLAN_SHADOW_ENABLED=="true"
      and .LINE_AI_PREPARED_SIMPLE_READ_ENABLED=="true" and .LINE_AI_DRAFT_EDIT_ENABLED=="true"
      and .LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES=="sales.get_sales_summary::single_metric,expense.list_recent::single_metric,accounting.get_summary::list,expense.get_daily_closing::single_metric,expense.list_recent::list,expense.get_breakdown::list,reimbursement.list_pending_approvals::list,reimbursement.get_summary::single_metric,expense.get_detail::single_metric,reimbursement.get_detail::single_metric"
      and .AI_FINAL_MUTATION_ENABLED=="false" and .AI_PROMPT_LOGGING_ENABLED=="false"' >/dev/null
  env -i PATH="$PATH" DEPLOY_ENVIRONMENT="$stage" LINE_AI_FUSED_PLAN_SHADOW_ENABLED=false \
    LINE_AI_PREPARED_SIMPLE_READ_ENABLED=false LINE_AI_DRAFT_EDIT_ENABLED=false \
    LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES=sales.get_sales_summary::single_metric \
    bash "$tmp_dir/runtime-env.sh" | jq -e '.LINE_AI_FUSED_PLAN_SHADOW_ENABLED=="false"
      and .LINE_AI_PREPARED_SIMPLE_READ_ENABLED=="false" and .LINE_AI_DRAFT_EDIT_ENABLED=="false"
      and .LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES=="sales.get_sales_summary::single_metric"' >/dev/null
done

grep -Fq '"AI_GATEWAY_INTERNAL_SECRET_ARN": "${AI_GATEWAY_SECRET_ARN}"' "$agentcore"
if grep -Fq '"AI_GATEWAY_INTERNAL_SECRET": "${AI_GATEWAY_INTERNAL_SECRET}"' "$agentcore"; then
  echo 'AgentCore must not publish the raw internal secret in runtime metadata' >&2
  exit 1
fi
jq -e '.Statement==[{Effect:"Allow",Principal:{Service:"bedrock-agentcore.amazonaws.com"},
  Action:"sts:AssumeRole",Condition:{StringEquals:{"aws:SourceAccount":"<ACCOUNT_ID>"},
    ArnLike:{"aws:SourceArn":"<AGENTCORE_RUNTIME_ARN>"}}}]' "$trust" >/dev/null
grep -Fq 'agentcore-execution-role-trust.template.json' "$agentcore"
grep -Fq 's|<AGENTCORE_RUNTIME_ARN>|$RUNTIME_ARN|g' "$agentcore"
create_block="$(sed -n '/^create_agent_runtime_with_role_retry()/,/^}/p' "$agentcore")"
update_block="$(sed -n '/RESULT=$(aws bedrock-agentcore-control update-agent-runtime/,/--client-token .*mmdsv2/p' "$agentcore")"
if grep -Fq -- '--metadata-configuration' <<< "$create_block"; then
  echo 'CreateAgentRuntime has no metadataConfiguration input; MMDSv2 belongs on the settled update' >&2
  exit 1
fi
grep -Fq -- '--client-token "watchdog-${DEPLOY_ENVIRONMENT}-${SOURCE_COMMIT}-${actual_sha:0:16}-${ENV_SHA:0:16}-create"' <<< "$create_block"
grep -Fq -- "--metadata-configuration '{\"requireMMDSV2\":true}'" <<< "$update_block"
grep -Fq -- '--client-token "watchdog-${DEPLOY_ENVIRONMENT}-${SOURCE_COMMIT}-${actual_sha:0:16}-${ENV_SHA:0:16}-mmdsv2"' <<< "$update_block"
grep -Fq 'CREATE_FAILED|UPDATE_FAILED|FAILED)' "$agentcore"
grep -Fq '.metadataConfiguration.requireMMDSV2 == true' "$agentcore"
create_line="$(grep -n 'RESULT="$(create_agent_runtime_with_role_retry)"' "$agentcore" | cut -d: -f1)"
create_ready_line="$(grep -n 'wait_for_runtime_ready create ' "$agentcore" | cut -d: -f1)"
update_line="$(grep -n 'RESULT=$(aws bedrock-agentcore-control update-agent-runtime' "$agentcore" | cut -d: -f1)"
update_ready_line="$(grep -n 'wait_for_runtime_ready mmdsv2-update ' "$agentcore" | cut -d: -f1)"
readback_line="$(grep -n 'RUNTIME_JSON=$(aws bedrock-agentcore-control get-agent-runtime' "$agentcore" | tail -1 | cut -d: -f1)"
endpoint_line="$(grep -n 'get-agent-runtime-endpoint' "$agentcore" | head -1 | cut -d: -f1)"
smoke_line="$(grep -n 'smoke_invoke safe ' "$agentcore" | cut -d: -f1)"
test "$create_line" -lt "$create_ready_line"
test "$create_ready_line" -lt "$update_line"
test "$update_line" -lt "$update_ready_line"
test "$update_ready_line" -lt "$readback_line"
test "$readback_line" -lt "$endpoint_line"
test "$endpoint_line" -lt "$smoke_line"
printf '%s\n' "$create_block" > "$tmp_dir/create-runtime.sh"
(
  set -euo pipefail
  STAGING="$tmp_dir/staging"; mkdir "$STAGING"
  REGION=ap-southeast-1 RUNTIME_NAME=watchdog_orchestrator_production_candidate
  ARTIFACT_JSON='{}' ROLE_ARN=arn:aws:iam::311414082667:role/candidate ENV_VARS='{}'
  DEPLOY_ENVIRONMENT=production SOURCE_COMMIT="$(printf 'a%.0s' {1..40})"
  actual_sha="$(printf 'b%.0s' {1..64})" ENV_SHA="$(printf 'c%.0s' {1..64})"
  AGENTCORE_IAM_PROPAGATION_ATTEMPTS=2 AGENTCORE_IAM_PROPAGATION_RETRY_SECONDS=0
  aws() {
    local count=0
    [ ! -f "$tmp_dir/attempts" ] || count="$(cat "$tmp_dir/attempts")"
    count=$((count + 1)); printf '%s' "$count" > "$tmp_dir/attempts"
    if [ "$count" -eq 1 ]; then echo 'Role validation failed' >&2; return 254; fi
    printf '%s' '{"agentRuntimeId":"runtime-AbCdEf1234"}'
  }
  source "$tmp_dir/create-runtime.sh"
  result="$(create_agent_runtime_with_role_retry)"
  test "$result" = '{"agentRuntimeId":"runtime-AbCdEf1234"}'
  test "$(cat "$tmp_dir/attempts")" = 2
)
grep -Fq 'refusing a mutable runtime reference' "$agentcore"
grep -Fq '"versionId": "${S3_VERSION}"' "$agentcore"
grep -Fq -- "--if-none-match '*'" "$agentcore"
grep -Fq "PreconditionFailed|412" "$agentcore"
grep -Fq 'pinned content-addressed AgentCore object has different bytes' "$agentcore"
if grep -Fq 'aws s3 cp "$STAGING/agentcore.zip"' "$agentcore"; then
  echo 'AgentCore artifacts must use an atomic create-only write, not an existence probe followed by overwrite' >&2
  exit 1
fi
conditional_put_line="$(grep -n -- "--if-none-match '\*'" "$agentcore" | cut -d: -f1)"
head_read_line="$(grep -n 'object_json=$(aws s3api head-object' "$agentcore" | cut -d: -f1)"
test "$conditional_put_line" -lt "$head_read_line"
endpoint_create_block="$(sed -n '/endpoint_json=$(aws bedrock-agentcore-control create-agent-runtime-endpoint/,/--output json)/p' "$agentcore")"
endpoint_update_block="$(sed -n '/endpoint_json=$(aws bedrock-agentcore-control update-agent-runtime-endpoint/,/--output json)/p' "$agentcore")"
endpoint_delete_block="$(sed -n '/aws bedrock-agentcore-control delete-agent-runtime-endpoint/,/--output json/p' "$agentcore")"
for endpoint_block in "$endpoint_create_block" "$endpoint_update_block" "$endpoint_delete_block"; do
  if grep -Fq -- '--client-token' <<< "$endpoint_block"; then
    echo 'AgentCore endpoint lifecycle must use deterministic identity/readback, not tombstoned client tokens' >&2
    exit 1
  fi
done
jq -e '.Statement[]|select(.Sid=="BedrockAgentCoreReadArtifact")
  |(.Action|sort)==["s3:GetObject","s3:GetObjectVersion"]' \
  "$repo_root/infra/ai-gateway/agentcore-execution-role-policy.json" >/dev/null

ai_policy="$(sed -n '/watchdog-bms-ecs-ai-task-policy.json <<EOF/,/^EOF$/p' "$ecs")"
if grep -Eq 'secretsmanager|ssm:Get' <<<"$ai_policy"; then
  echo 'AI task role must not read Secrets Manager or SSM' >&2
  exit 1
fi

ai_container="$(sed -n '/^ai_container_json()/,/^}$/p' "$ecs")"
if grep -Eq 'REDIS_URL|redis-url|DATABASE_URL|database-url' <<<"$ai_container"; then
  echo 'AI container must not receive DB or cache coordinates' >&2
  exit 1
fi
api_container="$(sed -n '/^api_container_json()/,/^}$/p' "$ecs")"
grep -Fq 'name:"REDIS_URL"' <<<"$api_container"
if grep -Eq 'REDIS_URL|redis-url|DATABASE_URL|database-url' "$template"; then
  echo 'AI task template must not receive DB or cache coordinates' >&2
  exit 1
fi

grep -Fq 'ensure_ai_security_group' "$ecs"
grep -Fq '2048 "$AI_SG_NAME"' "$ecs"

echo 'H-15 trust-boundary checks passed'
