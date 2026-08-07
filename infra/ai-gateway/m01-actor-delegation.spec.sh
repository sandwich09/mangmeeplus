#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
deploy="$repo_root/infra/prod-ecs-express/deploy.sh"

grep -Fq 'AI_ACTOR_DELEGATION_SIGNING_KEY' "$repo_root/packages/config/src/index.ts"
grep -Fq '{name:"AI_ACTOR_DELEGATION_SIGNING_KEY", valueFrom:$actorDelegationKey}' "$deploy"
grep -Fq 'ensure_ai_actor_delegation_secret' "$deploy"
grep -Fq 'AI_ACTOR_DELEGATION_SIGNING_KEY:' "$repo_root/infra/docker/compose.local.yml"
grep -Fq 'unset AI_ACTOR_DELEGATION_SIGNING_KEY' "$repo_root/infra/api-web/start-api-web-runtime.sh"
grep -Fq 'build-agentcore-artifact.sh' "$repo_root/.github/workflows/ci.yml"
grep -Fq 'AGENTCORE_ARTIFACT_MANIFEST' "$repo_root/infra/ai-gateway/agentcore-deploy.sh"
grep -Fq 'create_random_secret "${secret_prefix}/ai-actor-delegation-signing-key"' "$repo_root/infra/uat/bootstrap-data.sh"
grep -Fq 'm01-actor-delegation-live-smoke.ts' "$repo_root/infra/prod-ecs-express/run-release-task.sh"
grep -Fq 'M01ActorDelegationDenied' "$repo_root/infra/uat/m01-actor-delegation-alert.sh"
grep -Fq 'm01-actor-delegation-alert.sh install' "$repo_root/.github/workflows/deploy-uat.yml"

ai_container="$(
  sed -n '/^ai_container_json()/,/^}/p' "$deploy"
)"
if grep -Fq 'AI_ACTOR_DELEGATION_SIGNING_KEY' <<<"$ai_container"; then
  echo "AI Gateway container must not receive the actor delegation signing key" >&2
  exit 1
fi
if grep -Fq 'AI_ACTOR_DELEGATION_SIGNING_KEY' "$repo_root/infra/ai-gateway/agentcore-deploy.sh"; then
  echo "AgentCore runtime must not receive the actor delegation signing key" >&2
  exit 1
fi
# The App Runner gateway guard is gone with its deploy script (ADR 0005, removed 2026-07-28).
# The ECS Express gateway check above is the live equivalent.

echo "M-01 actor delegation static boundary: PASS"
