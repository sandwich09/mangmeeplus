# AI Runtime Production Integration Spec

Active production remediation: [[specs/line-ai-production-parity-and-receipt-continuity-remediation-spec|LINE AI Production Parity and Receipt Continuity Remediation Spec]]. For LINE AI promotion it supersedes older wording that allows local-only UAT proof or a hosted artifact source different from the ECS candidate.

## 1. Status

Ready for implementation handoff. This spec is the production-use addendum for:

- [[plans/master-implementation-checklist|Master Implementation Checklist]] item 10B, LINE AI Local Agent Orchestration.
- [[plans/master-implementation-checklist|Master Implementation Checklist]] item 17, AI Draft and Suggestion Layer.
- [[plans/master-implementation-checklist|Master Implementation Checklist]] item 24, Production Ops.

Item 10B owns the first real AI runtime path. Item 17 reuses the same provider, tool, audit, and safety boundary for wider draft/suggestion workflows. Item 24 owns production readiness, monitoring, rollback, cost guard, and operating evidence.

This spec is not a claim that production runtime is already complete. Current repo has local TypeScript AI Gateway agents, direct Bedrock/OpenAI provider ports, provider-disabled fallback, AgentCore-compatible `/ping` and `/invocations`, and `agentcore.json`. Remaining production work includes real provider smoke, private runtime hosting, least-privilege IAM, AgentCore invoke adapter, deployed runtime smoke, redacted logs, cost guard, and recorded evidence.

## 2. Goal

Enable WatchDog-BMS to call real AI in production while preserving the product boundary:

1. LINE and web never receive provider keys.
2. AI Gateway remains separate from ERP core.
3. AI Gateway and runtime do not import Prisma or source-module repositories.
4. Every business read/write candidate goes through permission-checked WatchDog API/tool boundaries.
5. LINE AI can read, summarize, suggest, and capture draft/evidence only.
6. Final money, stock, accounting, tax, approval, export, permission, close-period, and external publishing mutations stay web-owned and permission-checked.
7. Provider errors fail closed with safe Thai user messages and audit evidence.

The first production path should work for:

- LINE assistant text turns.
- LINE receipt/bill/tax-invoice capture that creates draft/review evidence only where source modules already allow it.
- Future web assistant and AI Draft/Suggestion queue reuse.

## 3. Non-goals

- Public direct access to AgentCore Runtime or model providers.
- Direct model-generated HTTP routes, SQL, Prisma, database credentials, or arbitrary tool calls.
- Autonomous final mutation.
- AgentCore Gateway, Memory, Browser, Code Interpreter, formal online evaluations, or long-term memory in the first production cut.
- Prompt-template admin body editing.
- Fine-tuning, vector memory platform, or external agent plugin marketplace.
- Replacing source-module validators, state machines, approvals, or audit.

## 4. Current Repo Baseline

Use these existing primitives first:

- `apps/api/src/modules/line-ai`: LINE webhook, context resolution, AI Gateway client, LINE reply.
- `apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.ts`: internal API -> AI Gateway call with `X-Internal-Secret`.
- `apps/ai-gateway/src/modules/line-ai`: turn use case, orchestrator, intent router, specialist agents, provider adapters, ERP tool client.
- `apps/ai-gateway/src/modules/line-ai/infrastructure/provider`: `DisabledProvider`, `BedrockProvider`, `OpenAiProvider`, provider factory.
- `apps/ai-gateway/src/agentcore/runtime.ts`: AgentCore-compatible HTTP runtime entrypoint.
- `apps/ai-gateway/agentcore.json`: CodeZip-style runtime config.
- `packages/config/src/index.ts`: AI Gateway config schema.
- `packages/contracts/src/line-ai.ts` and `packages/contracts/src/ai-tools.ts`: shared turn/tool/provider contracts.
- `docs/runbooks/line-ai-local-agent-10b-runbook.md`: current local runbook.

Do not duplicate these modules. Extend them.

## 5. Target Architecture

### 5.1 Default Production Topology

```text
LINE OA / Web
  -> Public API / apps/api
  -> private AI Gateway / apps/ai-gateway
  -> runtime mode
       A. direct Bedrock/OpenAI provider from AI Gateway
       B. Bedrock AgentCore Runtime invoked server-side by AI Gateway
  -> WatchDog internal tool APIs
  -> source modules / permissions / audit / data
```

Default production hosting follows ADR 0005:

- Web: ECS Fargate service.
- API: ECS Fargate service, public/private as required by LINE webhook and web.
- AI Gateway: separate ECS Fargate service. ECS Express Mode can be used for the current no-real-user migration; keep internal auth enforced even when the first endpoint is public.
- AgentCore Runtime: optional hosted runtime for orchestrator after local/provider proof.
- Data: RDS PostgreSQL, Redis/Valkey, S3.
- Secrets: AWS Secrets Manager or SSM Parameter Store.
- Logs/metrics: CloudWatch.
- Containers: ECR.

### 5.2 Runtime Modes

| mode | purpose | repo support now | production status |
| --- | --- | --- | --- |
| `disabled` | no paid AI; safe local/prod boot | supported | keep as default/fallback |
| `bedrock-direct` | AI Gateway calls Bedrock Runtime directly | supported through `MODEL_PROVIDER=bedrock` | first real provider smoke path |
| `openai-direct` | AI Gateway calls OpenAI Responses API | supported through `MODEL_PROVIDER=openai` | optional fallback only |
| `agentcore` | AI Gateway invokes hosted AgentCore Runtime | runtime endpoint exists | adapter/IAM/deploy proof still required |

First production can use `bedrock-direct` while AgentCore adapter is implemented. AgentCore becomes preferred only after deploy/invoke proof exists and monitoring/cost guard are active. App Runner endpoints are legacy migration evidence; new deploy proof should use ECS Express/Fargate.

## 6. Business Flow

### 6.1 LINE Text Turn

1. LINE sends webhook to API.
2. API validates raw-body LINE signature.
3. API deduplicates webhook event.
4. API resolves LINE identity, internal user, active company membership, selected company context, feature entitlement, approved AI model, and permission grants.
5. API refuses before AI Gateway when user is unlinked, inactive, lacks company context, lacks `line.ai.query`, or feature is disabled.
6. API sends sanitized `LineAiTurnRequest` to AI Gateway using internal secret.
7. AI Gateway validates request and feature flags.
8. AI Gateway routes through either local orchestrator or AgentCore invoke adapter.
9. Runtime/agent creates structured intent plan.
10. Specialist agents call only allowlisted WatchDog tools.
11. Tool client checks tool policy and calls API internal tool endpoint.
12. API repeats permission/ABAC checks and source-module validation.
13. Runtime composes answer with source labels/web links.
14. API replies to LINE.
15. Turn, tool decisions, provider errors, and audit evidence are recorded with redaction.

### 6.2 LINE Receipt/Image Turn

1. API validates LINE signature and downloads media server-side.
2. API stores attachment evidence through shared attachment/expense primitives.
3. AI Gateway receives attachment metadata, not raw LINE secrets.
4. Runtime routes attachment before mutation keyword classification.
5. OCR/extraction returns draft fields with confidence and provenance when provider/tool support exists.
6. Authenticity/risk agent returns `LOW | MEDIUM | HIGH` risk with reasons, never absolute real/fake verdict.
7. Draft/evidence capture is created only through permission-checked source-module APIs.
8. LINE reply links to web review.
9. Final confirmation, payment, tax filing, export, and ledger posting stay in web.

### 6.3 Web Assistant / Draft Suggestions

Web can reuse the same AI Gateway contract later:

1. Web sends authenticated request to API, not AI Gateway directly.
2. API derives company/user/permission context.
3. AI Gateway calls provider/runtime.
4. Draft/suggestion artifacts return to API.
5. Web review queue owns validate/edit/dismiss/regenerate/create-source-draft actions.
6. Source draft creation re-checks source state, permissions, validators, idempotency, and audit.

## 7. Provider And Model Policy

### 7.1 Primary Provider

Amazon Bedrock is the primary paid provider.

Required:

- `MODEL_PROVIDER=bedrock`
- `BEDROCK_REGION=ap-southeast-1` unless availability requires documented exception.
- `BEDROCK_MODEL_ID` set to approved model or inference profile id.
- Runtime role/task role can invoke selected model.
- Anthropic model access approved in AWS account.

Default candidate:

```text
BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6
```

Fallback candidates must be explicit in environment/admin config and verified before use.

### 7.2 Optional Fallback

OpenAI stays optional fallback:

```text
MODEL_PROVIDER=openai
OPENAI_API_KEY=<secret>
OPENAI_MODEL=gpt-4.1-mini
```

OpenAI key must live only in Secrets Manager/SSM or local uncommitted env.

### 7.3 Disabled Provider

`MODEL_PROVIDER=disabled` must:

- boot service safely.
- make no external model call.
- return typed provider-disabled/feature-unavailable state.
- avoid deterministic business keyword fallback in item 10B orchestration mode.

### 7.4 Model Output Rules

- Router/model output must be JSON/schema-validated before use.
- Empty, malformed, unknown-tool, or unsupported-agent output fails closed.
- Model cannot decide final mutation.
- Model cannot invent source refs.
- Tool outputs are the only accepted source of business facts.
- Prompt logging stays disabled in production.

## 8. Runtime Configuration Contract

### 8.1 API Service

Required production keys:

```text
APP_ENV=production
SERVICE_NAME=watchdog-api
SERVICE_VERSION=<release>
GIT_SHA=<sha>
PUBLIC_BASE_URL=https://<api-domain-or-web-domain>
LOG_FORMAT=json
LOG_REDACTION_ENABLED=true
RATE_LIMIT_ENABLED=true

AI_GATEWAY_INTERNAL_URL=http://<private-ai-gateway>/v1
AI_GATEWAY_INTERNAL_SECRET=<secret-from-secrets-manager>

LINE_MESSAGING_CHANNEL_ID=<secret/value>
LINE_MESSAGING_CHANNEL_SECRET=<secret>
LINE_MESSAGING_CHANNEL_ACCESS_TOKEN=<secret>
LINE_LOGIN_CHANNEL_ID=<value>
LINE_LOGIN_CHANNEL_SECRET=<secret>
LINE_LIFF_ID=<value>

WATCHDOG_JWT_ISSUER=<issuer>
WATCHDOG_JWT_AUDIENCE=<audience>
WATCHDOG_JWT_SECRET_ARN=<secret-arn-or-injected-secret>
```

### 8.2 AI Gateway Direct Provider Mode

```text
APP_ENV=production
SERVICE_NAME=watchdog-ai-gateway
SERVICE_VERSION=<release>
GIT_SHA=<sha>
PUBLIC_BASE_URL=https://<internal-or-ops-url-if-needed>
HOST=0.0.0.0
PORT=3002
LOG_FORMAT=json
LOG_REDACTION_ENABLED=true
RATE_LIMIT_ENABLED=true

ERP_CORE_INTERNAL_URL=http://<private-api>/v1
AI_GATEWAY_INTERNAL_SECRET=<same-secret-as-api>

AI_GATEWAY_ENABLED=true
AI_AGENT_REGISTRY_ENABLED=true
AI_TOOL_POLICY_ENFORCED=true
AI_TOOL_AUDIT_ENABLED=true
AI_FINAL_MUTATION_ENABLED=false
AI_PROMPT_LOGGING_ENABLED=false
AI_MAX_TOOL_CALLS=8
AI_TOOL_TIMEOUT_MS=15000

LINE_AI_AGENT_ORCHESTRATION_ENABLED=true
LINE_AI_AGENT_RUNTIME=strands-local

MODEL_PROVIDER=bedrock
BEDROCK_REGION=ap-southeast-1
BEDROCK_MODEL_ID=<approved-bedrock-model-or-inference-profile>
```

### 8.3 AgentCore Runtime Mode

Config to add before AgentCore production invoke:

```text
LINE_AI_AGENT_RUNTIME=agentcore
AGENTCORE_REGION=ap-southeast-1
AGENTCORE_RUNTIME_ARN=<runtime-arn-or-id>
AGENTCORE_RUNTIME_QUALIFIER=<DEFAULT-or-named-qualifier>
AGENTCORE_INVOKE_TIMEOUT_MS=20000
```

Required code change:

- Extend `LINE_AI_AGENT_RUNTIME` enum from `disabled | strands-local` to include `agentcore`.
- Add AgentCore invoke adapter in AI Gateway.
- Keep direct provider mode available for fallback/rollback.

### 8.4 AgentCore Runtime Process

Runtime receives only sanitized invocation env:

```text
APP_ENV=production
SERVICE_NAME=watchdog-agentcore-orchestrator
PORT=8080
MODEL_PROVIDER=bedrock
BEDROCK_REGION=ap-southeast-1
BEDROCK_MODEL_ID=<approved-model>
ERP_CORE_INTERNAL_URL=http://<private-api>/v1
AI_GATEWAY_INTERNAL_SECRET_ARN=arn:aws:secretsmanager:<region>:<account>:secret:watchdog-bms/production/ai-gateway-internal-secret-<suffix>
AI_FINAL_MUTATION_ENABLED=false
AI_TOOL_POLICY_ENFORCED=true
AI_TOOL_AUDIT_ENABLED=true
AI_PROMPT_LOGGING_ENABLED=false
```

Runtime must not receive database URL, Prisma credentials, LINE channel secret, or frontend secrets.
Runtime control-plane metadata must not receive raw shared secrets. It resolves only the exact internal-tool secret ARN at process startup through its least-privilege execution role, fails closed when retrieval is missing/empty, uses `SourceAccount`/runtime `SourceArn` trust conditions, and requires MMDSv2.

AI Gateway ECS and AgentCore identities must have no direct database/cache coordinates or network identity trusted by RDS/Redis. ECS AI Gateway uses a distinct SG that is never an ingress source on RDS/Redis; its task role has no Secrets Manager/SSM reads. Business data remains reachable only through permission-checked ERP APIs/tools.

## 9. API And Runtime Contracts

### 9.1 API -> AI Gateway

Existing endpoint:

```text
POST /v1/internal/ai/line-turn
Header: X-Internal-Secret: <secret>
Body: LineAiTurnRequest
```

Rules:

- API derives context server-side.
- Client-sent company/user/permission fields are not trusted.
- Internal secret missing means fail closed.
- AI Gateway rejects invalid payload.

### 9.2 AI Gateway -> AgentCore Runtime

Adapter input:

```json
{
  "turnId": "uuid",
  "companyId": "company-id",
  "userId": "user-id",
  "messageText": "สรุปยอดขายวันนี้",
  "locale": "th-TH",
  "permissions": ["line.ai.query", "inventory.read"],
  "attachments": [
    {
      "attachmentId": "uuid",
      "mimeType": "image/jpeg",
      "kind": "LINE_IMAGE",
      "sha256": "hex"
    }
  ]
}
```

Runtime output:

```json
{
  "turnId": "uuid",
  "replyText": "ข้อความตอบกลับ",
  "plan": {
    "status": "ROUTABLE",
    "intents": []
  },
  "durationMs": 1234,
  "refused": false
}
```

Rules:

- Runtime response must not expose raw entity ids/source refs that bypass API formatting unless contract explicitly allows them.
- AI Gateway maps runtime response into `LineAiTurnResponse`.
- AI Gateway handles runtime timeout/throttle/unavailable with safe fallback.

### 9.3 AI Gateway -> API Tools

Tool calls must include:

- `requestId`
- `companyId`
- `userId`
- `membershipId` if available.
- permissions/scope derived by API.
- tool name from registry.
- schema-validated tool input.

Tool output must include:

- status: `ok | forbidden | unsupported_module | error`.
- `sourceRefs` with `permissionChecked=true`.
- redacted error details.
- web links only for allowed routes.

## 10. IAM And Secrets

### 10.1 API Task Role

Minimum:

- read API secrets from Secrets Manager/SSM.
- write CloudWatch logs.
- access RDS/S3/Redis according to existing platform docs.
- no Bedrock model invoke required unless API owns direct provider call, which this spec forbids.

### 10.2 AI Gateway Task Role

Minimum for direct Bedrock:

- `bedrock:InvokeModel`
- `bedrock:InvokeModelWithResponseStream` only if streaming is implemented.
- optional `bedrock:Converse`/runtime action names according to current AWS IAM model for Bedrock Runtime.
- read AI Gateway secrets.
- write CloudWatch logs/metrics.
- call private API over VPC/network.

No RDS direct access.

### 10.3 AgentCore Runtime Execution Role

Minimum:

- invoke selected Bedrock model or inference profile.
- read only runtime-required secrets.
- write runtime logs/metrics/traces.
- access artifact/image storage as required by AgentCore deployment.
- call private WatchDog API/tool endpoint if network mode allows it, or call through future tool gateway.

No database permissions.

### 10.4 Secret Rules

- Never commit provider keys, AWS credentials, internal secrets, LINE secrets, JWT secrets, or runtime ARN tokens with credentials.
- Use stable secret names/ARNs per environment.
- Rotate `AI_GATEWAY_INTERNAL_SECRET` before production launch and after any suspected exposure.
- Prompt/model raw payload logging disabled by default.

## 11. Network And Exposure

- API must expose LINE webhook over HTTPS.
- Web calls API, not AI Gateway.
- AI Gateway should be private inside VPC/service discovery/private ALB.
- AgentCore Runtime must be invoked server-side only by AI Gateway.
- LINE/web must not call AgentCore directly.
- CORS for AI Gateway should be empty or restricted; no public browser use in first production.
- Internal API/tool endpoints require internal secret or stronger service auth.

## 12. Audit, Observability, And Evidence

Every AI turn must be traceable by:

- `requestId`
- `turnId`
- `webhookEventId` when LINE.
- company id.
- internal user id.
- model provider.
- model id.
- runtime mode.
- agent.
- intent.
- tool names.
- policy decisions.
- source refs.
- duration.
- provider error code when present.

Logs must redact:

- provider keys.
- LINE access tokens.
- LINE raw user ids unless hashed.
- internal secrets/JWTs.
- prompt/raw customer text unless retention policy explicitly allows it.
- attachment raw bytes.

Required production signals:

- health check for API and AI Gateway.
- AgentCore `/ping` health where used.
- provider call count.
- provider error count by code.
- tool call count by tool/status.
- runtime timeout count.
- final-mutation refusal count.
- permission-denied count.
- cost estimate or usage counter.

## 13. Cost And Rate Guard

Minimum guard before sustained real use:

- `AI_MAX_TOOL_CALLS` default 8 or lower for production pilot.
- `AI_TOOL_TIMEOUT_MS` default 15000.
- per-user/per-company AI rate limit.
- provider timeout.
- max output tokens per provider call.
- Bedrock/OpenAI spend budget monitored outside app.
- AWS all-services monthly budget from production ops, first default `$100/month`.
- zero-spend or low-threshold alert for accidental activation.
- disabled-provider rollback path.

## 14. Failure Behavior

| condition | system behavior | user-facing behavior |
| --- | --- | --- |
| provider disabled | no model/tool fallback guess | "AI ยังไม่ได้เปิดใช้งานสำหรับระบบนี้" |
| missing provider config | fail closed at provider factory/runtime startup or request | safe temporary unavailable |
| Bedrock access not approved | typed `PROVIDER_ACCESS_NOT_READY` | setup/access unavailable, retry later |
| throttle/quota | typed retryable provider error | temporary unavailable |
| provider timeout | abort and audit | temporary unavailable or partial if source-safe |
| invalid model JSON | reject plan | feature unavailable, no fake answer |
| unknown tool | policy deny | unsupported module |
| permission denied | no hidden counts/data | permission refusal |
| internal secret missing | API/Gateway call fails closed | generic temporary error |
| runtime invoke failure | direct provider fallback only if explicitly enabled; otherwise safe error | temporary unavailable |
| mutation request | no tool call | web action guidance/refusal |

## 15. Deployment Modes

### 15.1 Local Real Provider Smoke

Use before any production deploy:

1. Local API + AI Gateway.
2. `MODEL_PROVIDER=bedrock` with approved AWS profile or temporary `openai` fallback.
3. Tunnel LINE webhook to local API.
4. Send Thai inventory/dashboard query.
5. Confirm real provider call, permission-checked tools, Thai reply, and audit logs.

### 15.2 ECS AI Gateway Direct Provider

First production-capable path:

1. Build AI Gateway image.
2. Push image to ECR.
3. Deploy private ECS service.
4. Inject secrets/env.
5. Give task role Bedrock invoke.
6. API points `AI_GATEWAY_INTERNAL_URL` to private AI Gateway.
7. Run API -> AI Gateway -> Bedrock smoke.

### 15.3 AgentCore Runtime

Production hosted runtime path:

1. Build `apps/ai-gateway` runtime artifact with `apps/ai-gateway/src/agentcore/runtime.ts`.
2. Use CodeZip when dependency/runtime size allows.
3. Use container/ECR fallback if CodeZip is blocked.
4. Create least-privilege execution role.
5. Create/update AgentCore Runtime with HTTP protocol.
6. Record runtime ARN/id and qualifier.
7. Add AI Gateway server-side invoke adapter.
8. Run deployed read-only payload smoke.
9. Run mutation refusal smoke.
10. Confirm CloudWatch redacted logs and cost guard.

## 16. Rollback

Rollback switches, in order:

1. `LINE_AI_AGENT_ORCHESTRATION_ENABLED=false` restores deterministic item 07 path.
2. `MODEL_PROVIDER=disabled` disables paid model calls while AI Gateway still boots.
3. `LINE_AI_AGENT_RUNTIME=strands-local` falls back from AgentCore to AI Gateway-local orchestrator after adapter exists.
4. Deploy previous AI Gateway image tag.
5. Disable LINE webhook only if API-level failure affects webhook processing.

Rollback must preserve audit logs and not delete turn evidence.

## 17. Acceptance Criteria

- [ ] Real model call is proven with Bedrock or exact AWS blocker is recorded.
- [ ] OpenAI remains optional fallback only.
- [ ] API -> AI Gateway internal secret boundary fails closed.
- [ ] AI Gateway has no direct DB/Prisma/source repository access.
- [ ] Tool calls use registry + schema validation + policy enforcement + API permission checks.
- [ ] `MODEL_PROVIDER=disabled` boots and returns safe unavailable output.
- [ ] `LINE_AI_AGENT_ORCHESTRATION_ENABLED=false` restores item 07 deterministic behavior.
- [ ] ECS private AI Gateway deployment or exact blocker is recorded.
- [ ] AgentCore Runtime deployment/invoke or exact AWS/IAM/quota blocker is recorded before item 10B tick.
- [ ] AgentCore Runtime can be invoked only server-side by AI Gateway.
- [ ] Runtime read-only smoke returns permission-aware answer.
- [ ] Runtime mutation smoke refuses final action.
- [ ] Logs are redacted and include request/runtime/tool/provider evidence.
- [ ] Cost guard and budget alert exist before sustained provider testing.
- [ ] Runtime identifiers, image/artifact ids, model id, region, qualifier, role ARN, and smoke evidence are recorded in agent memory/runbook.

## 18. Test Cases

1. `MODEL_PROVIDER=disabled` and orchestration on returns feature unavailable, no business keyword answer.
2. Missing `AI_GATEWAY_INTERNAL_SECRET` blocks API -> AI Gateway call.
3. Linked OWNER asks Thai business summary and receives source-backed answer.
4. Inventory staff asks stock question and receives only allowed branch/location data.
5. User without `line.ai.query` is refused before AI Gateway call.
6. Multi-company user without selected context is refused before AI Gateway call.
7. Mutation request is refused before tool call.
8. Unknown model tool output is rejected.
9. Unknown tool name is policy-denied.
10. Unsupported source module returns typed unsupported reply without fake numbers.
11. Bedrock throttle maps to retryable provider error and safe Thai reply.
12. Bedrock access-not-ready maps to setup/access blocker.
13. OpenAI 401/403 maps to access-not-ready.
14. AgentCore runtime invalid payload returns 400.
15. AgentCore runtime `/ping` returns healthy.
16. AgentCore deployed read-only invoke returns safe response.
17. AgentCore deployed mutation invoke returns refusal.
18. CloudWatch log sample contains no provider key, LINE token, internal secret, or raw attachment bytes.

## 19. Implementation References

Internal:

- [[specs/line-ai-local-agent-orchestration-spec|LINE AI Local Agent Orchestration Spec]]
- [[plans/line-ai-local-agent-orchestration-plan|LINE AI Local Agent Orchestration Plan]]
- [[runbooks/line-ai-local-agent-10b-runbook|LINE AI Local Agent Runbook]]
- [[specs/ai-gateway-agents-spec|AI Gateway and Agents Spec]]
- [[specs/ai-draft-suggestion-layer-spec|AI Draft and Suggestion Layer Spec]]
- [[specs/production-ops-spec|Production Ops Spec]]
- [[adr/0005-aws-first-hosting-and-deployment-strategy|ADR 0005 AWS-First Hosting]]

External references to verify at implementation time:

- Amazon Bedrock Runtime Converse API: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
- AWS CLI AgentCore control plane commands: https://docs.aws.amazon.com/cli/latest/reference/bedrock-agentcore-control/
- AWS CLI AgentCore runtime invoke commands: https://docs.aws.amazon.com/cli/latest/reference/bedrock-agentcore/
- OpenAI Responses API: https://platform.openai.com/docs/api-reference/responses/create
- Amazon ECS Fargate: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html

AgentCore command names and payload options may drift. Implementation must confirm installed AWS CLI help and current AWS docs before writing final deploy scripts.
