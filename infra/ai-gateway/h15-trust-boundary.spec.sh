#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
agentcore="$repo_root/infra/ai-gateway/agentcore-deploy.sh"
ecs="$repo_root/infra/prod-ecs-express/deploy.sh"
template="$repo_root/infra/ai-gateway/task-definition.template.json"
trust="$repo_root/infra/ai-gateway/agentcore-execution-role-trust.template.json"

bash -n "$agentcore"
bash -n "$ecs"

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
create_block="$(sed -n '/RESULT=$(aws bedrock-agentcore-control create-agent-runtime/,/--description .*item 10B/p' "$agentcore")"
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
create_line="$(grep -n 'RESULT=$(aws bedrock-agentcore-control create-agent-runtime' "$agentcore" | cut -d: -f1)"
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
grep -Fq 'refusing a mutable runtime reference' "$agentcore"
grep -Fq '"versionId": "${S3_VERSION}"' "$agentcore"
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
