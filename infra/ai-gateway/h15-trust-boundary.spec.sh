#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
agentcore="$repo_root/infra/ai-gateway/agentcore-deploy.sh"
ecs="$repo_root/infra/prod-ecs-express/deploy.sh"
template="$repo_root/infra/ai-gateway/task-definition.template.json"

bash -n "$agentcore"
bash -n "$ecs"

grep -Fq '"AI_GATEWAY_INTERNAL_SECRET_ARN": "${AI_GATEWAY_SECRET_ARN}"' "$agentcore"
if grep -Fq '"AI_GATEWAY_INTERNAL_SECRET": "${AI_GATEWAY_INTERNAL_SECRET}"' "$agentcore"; then
  echo 'AgentCore must not publish the raw internal secret in runtime metadata' >&2
  exit 1
fi
grep -Fq '"aws:SourceAccount":"${ACCOUNT_ID}"' "$agentcore"
grep -Fq '"aws:SourceArn":"arn:aws:bedrock-agentcore:${REGION}:${ACCOUNT_ID}:runtime/*"' "$agentcore"
grep -Fq -- "--metadata-configuration '{\"requireMMDSV2\":true}'" "$agentcore"

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
