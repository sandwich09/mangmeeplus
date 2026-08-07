# AI Runtime Production Integration Plan

## Status

Ready for implementation handoff. This plan implements [[specs/ai-runtime-production-integration-spec|AI Runtime Production Integration Spec]].

Do not mark item 10B complete from this plan alone. Item 10B can be ticked only when real local/provider smoke and production runtime evidence, or owner-accepted external blockers, are recorded.

## Linked Specs And Plans

- Spec: [[specs/ai-runtime-production-integration-spec|AI Runtime Production Integration Spec]]
- Primary item: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 10B.
- Related item: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 17.
- Production item: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 24.
- Existing local spec: [[specs/line-ai-local-agent-orchestration-spec|LINE AI Local Agent Orchestration Spec]]
- Existing local plan: [[plans/line-ai-local-agent-orchestration-plan|LINE AI Local Agent Orchestration Plan]]
- Runbook: [[runbooks/line-ai-local-agent-10b-runbook|LINE AI Local Agent Runbook]]

## Purpose

Move WatchDog-BMS from provider-ready local code to real AI use:

1. Prove real Bedrock/OpenAI provider call locally.
2. Host AI Gateway safely for production.
3. Add AgentCore Runtime invoke path when local/direct provider proof is stable.
4. Keep all data, permission, mutation, and audit ownership inside WatchDog API/source modules.
5. Record evidence so later AI Draft/Suggestion work can reuse the same boundary.

## Implementation Defaults

- Primary provider: Amazon Bedrock.
- Optional fallback: OpenAI.
- Safe default: `MODEL_PROVIDER=disabled`.
- First production deploy path: private ECS Fargate AI Gateway with direct Bedrock provider.
- AgentCore Runtime: implement after direct provider smoke and tool/policy proof.
- Region: `ap-southeast-1` unless AWS availability or account setup requires documented exception.
- Runtime exposure: server-side only. LINE/web never call AI Gateway or AgentCore directly.
- Prompt logging: disabled.
- Final mutation: disabled.
- Cost guard: required before sustained provider tests.

## Phase 0: Baseline And Drift Check

### Goal

Confirm current repo state before editing production runtime code.

### Tasks

- [ ] Read this plan and linked spec.
- [ ] Read `.agents/skills/ponytail/SKILL.md`.
- [ ] Inspect dirty worktree and avoid reverting unrelated changes.
- [ ] Inspect `packages/config/src/index.ts` AI Gateway schema.
- [ ] Inspect `apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.ts`.
- [ ] Inspect `apps/ai-gateway/src/modules/line-ai/application/use-cases/line-ai-turn.use-case.ts`.
- [ ] Inspect `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/`.
- [ ] Inspect `apps/ai-gateway/src/modules/line-ai/infrastructure/erp-tool.client.ts`.
- [ ] Inspect `apps/ai-gateway/src/agentcore/runtime.ts`.
- [ ] Inspect `apps/ai-gateway/agentcore.json`.
- [ ] Confirm current AWS CLI AgentCore command names from installed CLI/docs.
- [ ] Confirm current Bedrock model access status in AWS console/account.

### Verification

```bash
rg -n "MODEL_PROVIDER|LINE_AI_AGENT_RUNTIME|AGENTCORE|BEDROCK|OPENAI|AI_FINAL_MUTATION" packages apps docs
git status --short
```

### Exit Criteria

- Known current support vs missing production pieces is recorded in `docs/agent-memory/ai-runtime-production-integration.md`.

## Phase 1: Config Contract Hardening

### Goal

Make runtime mode explicit and production-valid.

### Tasks

- [ ] Extend `LINE_AI_AGENT_RUNTIME` enum to include `agentcore`.
- [ ] Add config keys:
  - `AGENTCORE_REGION`
  - `AGENTCORE_RUNTIME_ARN`
  - `AGENTCORE_RUNTIME_QUALIFIER`
  - `AGENTCORE_INVOKE_TIMEOUT_MS`
- [ ] Keep existing `disabled` and `strands-local` values.
- [ ] Validate production config:
  - if `LINE_AI_AGENT_RUNTIME=agentcore`, require AgentCore region/runtime/qualifier.
  - if `MODEL_PROVIDER=bedrock`, require Bedrock region/model id.
  - if `MODEL_PROVIDER=openai`, require OpenAI key.
  - always reject `AI_FINAL_MUTATION_ENABLED=true` in production.
  - reject `AI_PROMPT_LOGGING_ENABLED=true` in production.
- [ ] Add `.env.example` placeholders without real secrets.
- [ ] Add config service getters.

### Suggested Files

- `packages/config/src/index.ts`
- `packages/config/src/index.test.ts`
- `apps/ai-gateway/src/common/config/ai-gateway-config.service.ts`
- `.env.example`

### Verification

```bash
corepack pnpm --filter @watchdog-bms/config test
corepack pnpm --filter @watchdog-bms/config build
corepack pnpm --filter @watchdog-bms/ai-gateway typecheck
```

### Exit Criteria

- Invalid AgentCore config fails fast.
- Disabled/local/direct provider modes remain valid.

## Phase 2: Provider Smoke And Error Contract

### Goal

Prove real model calls can happen safely before runtime hosting.

### Tasks

- [ ] Add a focused local smoke script or test command for provider calls that does not require LINE.
- [ ] Bedrock smoke uses current `BedrockProvider` and approved profile/role.
- [ ] OpenAI smoke remains optional and never required for main path.
- [ ] Ensure provider errors map to existing `ProviderErrorCode`.
- [ ] Ensure timeout uses `AI_TOOL_TIMEOUT_MS`.
- [ ] Ensure prompt text is not printed unless local debug explicitly enables it.
- [ ] Record exact AWS/OpenAI blocker if real call cannot run.

### Suggested Files

- `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/bedrock.provider.spec.ts`
- `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/openai.provider.spec.ts`
- optional `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/provider-smoke.ts`
- `docs/agent-memory/ai-runtime-production-integration.md`

### Verification

Disabled path:

```bash
MODEL_PROVIDER=disabled \
LINE_AI_AGENT_ORCHESTRATION_ENABLED=true \
corepack pnpm --filter @watchdog-bms/ai-gateway test
```

Bedrock smoke:

```bash
MODEL_PROVIDER=bedrock \
AWS_PROFILE=watchdog-bedrock \
AWS_SDK_LOAD_CONFIG=1 \
BEDROCK_REGION=ap-southeast-1 \
BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6 \
AI_TOOL_TIMEOUT_MS=15000 \
corepack pnpm --filter @watchdog-bms/ai-gateway exec tsx <smoke-script>
```

OpenAI fallback smoke only if owner provides key:

```bash
MODEL_PROVIDER=openai \
OPENAI_API_KEY=<local-secret> \
OPENAI_MODEL=gpt-4.1-mini \
corepack pnpm --filter @watchdog-bms/ai-gateway exec tsx <smoke-script>
```

### Exit Criteria

- Bedrock real call succeeds, or exact Bedrock/IAM/quota/use-case blocker is recorded.
- Disabled provider remains safe.
- Optional OpenAI fallback does not become required.

## Phase 3: Direct AI Gateway Production Hosting

### Goal

Deploy AI Gateway as a private production service that can call Bedrock directly.

### Tasks

- [ ] Build AI Gateway production image from existing Dockerfile.
- [ ] Push image to ECR with immutable tag.
- [ ] Add/extend CDK or deployment config for private ECS Fargate AI Gateway service.
- [ ] Configure service health check.
- [ ] Configure private service discovery/private ALB.
- [ ] Inject secrets from Secrets Manager/SSM.
- [ ] Give task role least-privilege Bedrock invoke permission.
- [ ] Keep no RDS/Prisma database access.
- [ ] Point API `AI_GATEWAY_INTERNAL_URL` to private AI Gateway URL.
- [ ] Verify API -> AI Gateway internal secret path.

### Suggested Files

- `apps/ai-gateway/Dockerfile`
- deployment/CDK files when infra folder exists or is introduced.
- `docs/runbooks/line-ai-local-agent-10b-runbook.md` or new production runbook section.
- `docs/agent-memory/ai-runtime-production-integration.md`

### Verification

```bash
corepack pnpm --filter @watchdog-bms/ai-gateway build
docker build -f apps/ai-gateway/Dockerfile .
```

Production smoke:

```text
API health ok
AI Gateway health ok
API -> AI Gateway internal call ok
AI Gateway -> Bedrock direct call ok or exact blocker
```

### Exit Criteria

- Private AI Gateway service is reachable by API only.
- Real provider/direct smoke evidence recorded.
- Logs are redacted.

### H-15 trust-boundary closure (2026-07-18)

- [x] Replace raw AgentCore environment secret with an exact Secrets Manager ARN resolved at runtime.
- [x] Scope the AgentCore execution role to that exact secret and add `SourceAccount`/runtime `SourceArn` trust conditions plus MMDSv2.
- [x] Remove Secrets Manager/SSM from the ECS AI task role and remove DB/Redis coordinates from AI container definitions.
- [x] Give ECS AI Gateway a distinct SG that is not reused by ERP data-plane services.
- [x] Add focused fail-closed runtime tests and static IAM/network/config regression checks.
- [ ] Deploy immutable ECS/AgentCore revisions, rotate the exposed secret, run IAM simulation, and record sanitized live metadata plus RDS/Redis ingress evidence.

## Phase 4: AgentCore Invoke Adapter

### Goal

Let AI Gateway invoke AgentCore Runtime by ARN/id + qualifier without changing LINE/web contracts.

### Tasks

- [ ] Confirm current AWS SDK package/client for AgentCore Runtime invoke.
- [ ] Add adapter port:
  - `invokeLineTurn(req: LineAiTurnRequest): Promise<AgentRunResult>`
- [ ] Add AgentCore adapter implementation.
- [ ] Add `LINE_AI_AGENT_RUNTIME=agentcore` routing branch.
- [ ] Keep `strands-local` direct orchestrator branch.
- [ ] Keep disabled fallback.
- [ ] Map AgentCore errors:
  - runtime not found.
  - qualifier not found.
  - throttled.
  - timeout.
  - invalid runtime payload.
  - malformed runtime response.
- [ ] Add tests with mocked SDK/client.
- [ ] Ensure adapter never exposes runtime endpoint to LINE/web.

### Suggested Files

- `apps/ai-gateway/src/modules/line-ai/application/use-cases/line-ai-turn.use-case.ts`
- `apps/ai-gateway/src/modules/line-ai/infrastructure/runtime/agentcore-runtime.client.ts`
- `apps/ai-gateway/src/modules/line-ai/infrastructure/runtime/runtime.port.ts`
- `apps/ai-gateway/src/modules/line-ai/line-ai.module.ts`
- `apps/ai-gateway/src/modules/line-ai/application/use-cases/line-ai-turn.use-case.spec.ts`
- `packages/config/src/index.ts`

### Verification

```bash
corepack pnpm --filter @watchdog-bms/ai-gateway test
corepack pnpm --filter @watchdog-bms/ai-gateway typecheck
```

### Exit Criteria

- `LINE_AI_AGENT_RUNTIME=agentcore` invokes adapter in tests.
- Missing AgentCore config fails fast.
- AgentCore failure returns safe LINE-compatible error.

## Phase 5: AgentCore Runtime Deployment

### Goal

Deploy the existing runtime entrypoint and prove it handles safe invocations.

### Tasks

- [ ] Build runtime artifact.
- [ ] Confirm `agentcore.json` entrypoint matches built path.
- [ ] Use CodeZip first if dependency size/runtime limits allow.
- [ ] Use container/ECR fallback only if CodeZip is blocked.
- [ ] Create least-privilege execution role.
- [ ] Create or update AgentCore Runtime in `ap-southeast-1` or documented region exception.
- [ ] Record runtime ARN/id, qualifier, role ARN, artifact/image id, model id, region.
- [ ] Confirm runtime ready/available state.
- [ ] Invoke `/ping` equivalent through AgentCore health/status.
- [ ] Invoke safe read-only Thai payload.
- [ ] Invoke final mutation payload and confirm refusal.

### Expected AWS CLI Shape

Confirm current command names before implementation. Expected families:

```bash
aws bedrock-agentcore-control create-agent-runtime ...
aws bedrock-agentcore-control get-agent-runtime ...
aws bedrock-agentcore invoke-agent-runtime ...
```

If installed CLI uses different names, update runbook and memory with exact command/output.

### Verification

```text
Runtime status: ready/available
Read-only invoke: PASS
Mutation refusal invoke: PASS
CloudWatch redacted log sample: PASS
```

### Exit Criteria

- Hosted runtime can be invoked server-side.
- Runtime does not bypass WatchDog API/tool permission boundary.

## Phase 6: Tool Boundary And Schema Parity

### Goal

Make runtime/tool calls production-safe and impossible to drift silently.

### Tasks

- [ ] Define one source of truth for tool registry.
- [ ] Ensure each tool has:
  - stable name.
  - input schema.
  - required permission.
  - allowed agents.
  - final-mutation classification.
  - audit sensitivity.
  - source-ref behavior.
- [ ] Add tests that model-required tool names must exist in registry.
- [ ] Add tests for schema mismatch fails before API call.
- [ ] Add tests for permission denied returns no hidden counts/data.
- [ ] Keep unimplemented tools returning typed `unsupported_module`.
- [ ] Confirm receipt tools create draft/evidence only through item 09 APIs when implemented.

### Suggested Files

- `packages/contracts/src/ai-tools.ts`
- `apps/ai-gateway/src/common/ai/tool-policy-enforcer.service.ts`
- `apps/ai-gateway/src/modules/line-ai/infrastructure/erp-tool.client.ts`
- API internal tool controllers/use cases.

### Verification

```bash
corepack pnpm --filter @watchdog-bms/contracts build
corepack pnpm --filter @watchdog-bms/ai-gateway test
corepack pnpm --filter @watchdog-bms/api test
```

### Exit Criteria

- No tool can be called without registry, schema, policy, permission, and audit path.

## Phase 7: LINE End-To-End Real Smoke

### Goal

Prove real user journey with actual LINE webhook.

### Tasks

- [ ] Start API, AI Gateway, database, Redis, storage dependencies.
- [ ] Use ngrok or Cloudflare Tunnel to expose API webhook.
- [ ] Configure LINE Developer Console webhook.
- [ ] Link a real LINE user to WatchDog account/company.
- [ ] Test `/companies` and `/company <n>` for multi-company owner.
- [ ] Send Thai inventory/dashboard question.
- [ ] Send mutation request.
- [ ] Send receipt image or record exact blocker if receipt provider/tool unsupported.
- [ ] Confirm audit/turn/tool/provider logs.
- [ ] Confirm web deep link opens expected review/detail page when returned.

### Verification Evidence

Record in memory:

- date/time.
- environment.
- provider/model.
- runtime mode.
- LINE message category.
- response summary.
- tool names.
- provider error if any.
- screenshots/log excerpts with secrets redacted.

### Exit Criteria

- Real LINE message reaches AI and returns source-aware answer or safe refusal.

## Phase 8: Observability, Cost Guard, And Runbook

### Goal

Make sustained real AI use operable.

### Tasks

- [ ] Add/confirm structured log fields.
- [ ] Add/confirm log redaction tests.
- [ ] Add CloudWatch metric filters or app metrics for:
  - provider calls.
  - provider errors by code.
  - runtime errors.
  - tool calls by status.
  - mutation refusals.
  - permission denials.
  - timeouts.
- [ ] Add alarms or documented manual watch for pilot.
- [ ] Confirm AWS monthly budget guard from production ops.
- [ ] Add AI-specific cost notes to runbook.
- [ ] Add rollback steps.
- [ ] Add secret rotation notes.

### Suggested Files

- `docs/runbooks/line-ai-local-agent-10b-runbook.md`
- `docs/plans/production-ops-plan.md` if production ops contract changes.
- `docs/agent-memory/ai-runtime-production-integration.md`

### Verification

```bash
git diff --check -- docs
rg -n "ai-runtime-production-integration|AI Runtime Production Integration" docs/README.md docs/plans/master-implementation-checklist.md docs/plans/implementation-roadmap.md docs/specs/ai-runtime-production-integration-spec.md docs/plans/ai-runtime-production-integration-plan.md docs/agent-memory/ai-runtime-production-integration.md
```

### Exit Criteria

- Operator can see health, errors, cost risk, and rollback path.

## Phase 9: Production Pilot Gate

### Goal

Decide whether AI runtime is ready for limited customer pilot.

### Required Evidence

- [ ] Config validation passes.
- [ ] AI Gateway tests pass.
- [ ] API LINE tests pass.
- [ ] Direct Bedrock smoke passes or exact blocker accepted.
- [ ] Private AI Gateway deployment proof exists.
- [ ] AgentCore deploy/invoke proof exists or exact blocker accepted.
- [ ] Real LINE text smoke passes.
- [ ] Real LINE mutation refusal passes.
- [ ] Receipt image smoke passes or exact blocker accepted.
- [ ] CloudWatch redacted log proof exists.
- [ ] Cost guard active.
- [ ] Runtime identifiers and rollback steps recorded.

### Exit Criteria

Item 10B may be ticked only after required evidence is present or owner explicitly accepts remaining external blockers.

## Handoff Notes

- Do direct Bedrock provider smoke before AgentCore. Fewer moving parts, better error isolation.
- Do not add Strands/AgentCore SDK dependency unless current runtime adapter requires it.
- Do not expose AI Gateway to browser.
- Do not let AgentCore own source truth. It orchestrates only.
- Do not invent fake business data for unsupported modules.
- Do not mark provider-disabled path as success for "real AI".
