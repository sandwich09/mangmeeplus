# Agent Memory: H-15 AI trust boundary

Status: Code-complete and locally verified; immutable deploy, rotation, IAM/live network verification pending.
Owner: Platform/AI Security.
Scope: AgentCore secret/control-plane boundary and ECS AI Gateway IAM/network/DB/cache separation. M-01 signed actor delegation remains separate.
Decisions: AgentCore receives an exact secret ARN, resolves it at runtime through its execution role, and fails closed. ECS AI has no secret-store task permission, no DB/Redis coordinate, and a distinct SG never authorized on RDS/Redis.
Open questions: None for code. Production change evidence requires approved deploy/rotation and sanitized live IAM/SG/runtime checks.
Artifacts: `apps/ai-gateway/src/agentcore/runtime.ts`, `infra/ai-gateway/agentcore-deploy.sh`, `infra/ai-gateway/agentcore-execution-role-policy.json`, `infra/ai-gateway/h15-trust-boundary.spec.sh`, `infra/prod-ecs-express/deploy.sh`, H-15 checklist/spec/plan updates.
Verification: `infra/ai-gateway/h15-trust-boundary.spec.sh` passed; AgentCore runtime 20/20 passed; AI Gateway typecheck and `build:agentcore` passed; `git diff --check` passed.
Next: Deploy commit `f4d01830` as immutable ECS AI Gateway and AgentCore revisions; rotate internal secret; restrict deploy/control-plane readers; run IAM simulation and confirm live runtime env contains ARN only and AI SG is absent from RDS/Redis ingress.
