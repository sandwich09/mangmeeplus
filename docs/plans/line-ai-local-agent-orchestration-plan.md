# LINE AI Local Agent Orchestration Plan

## Linked Spec

- Spec: [[specs/line-ai-local-agent-orchestration-spec|LINE AI Local Agent Orchestration Spec]]
- Checklist item: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 10B.
- Related specs:
  - [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]]
  - [[specs/line-ai-channel-auth-spec|LINE AI Channel/Auth Spec]]
  - [[specs/line-ai-assistant-ux-spec|LINE AI Assistant UX Spec]]
  - [[specs/ai-gateway-agents-spec|AI Gateway and Agents Spec]]
  - [[specs/admin-company-onboarding-spec|Admin Company Onboarding and Partner Management Spec]]
  - [[specs/permission-matrix|Permission Matrix]]
  - [[specs/inventory-mvp-spec|Inventory MVP Spec]]
  - [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]
  - [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Closing Spec]]
- Related plan: [[plans/line-ai-read-only-assistant-plan|LINE AI Read-Only Assistant Plan]]

## Purpose

Implement a local demo slice where WatchDog-BMS can receive real LINE messages, run Strands agents, call a real Bedrock model through provider config, use permission-checked WatchDog tools, and reply to LINE. After local proof, package the same agent service and deploy it to Amazon Bedrock AgentCore Runtime.

This plan is implementation-ready for a DEV agent. It gates production AgentCore Runtime deployment behind local agent/tool/policy proof.

## Current Decisions

- Use the current TypeScript AI Gateway agents as the local proof path. When promoting to AgentCore Runtime, verify current `@strands-agents/sdk` and `bedrock-agentcore` package versions from package manager/docs before adding them; local AWS-eval samples used `@strands-agents/sdk@1.0.0-rc.4` and `bedrock-agentcore@0.2.4`.
- Use Bedrock through AWS profile `watchdog-bedrock` as the primary local smoke path; OpenAI is optional fallback only.
- Production target: deploy the same governed orchestration boundary to Bedrock AgentCore Runtime after local proof.
- Prefer AgentCore CodeZip/direct-code deploy for fast iteration when dependencies fit runtime limits; keep container/ECR deploy as production fallback.
- Keep AgentCore Gateway, Memory, Registry, and Evaluations as later hardening unless an owner explicitly pulls them into item 10B.
- Preferred model: `global.anthropic.claude-sonnet-4-6`.
- Temporary fallback model: `global.anthropic.claude-haiku-4-5-20251001-v1:0` or `apac.anthropic.claude-3-haiku-20240307-v1:0` only when Sonnet quota/use-case access blocks local wiring.
- Default region for Thailand-local dev: `ap-southeast-1`.
- Keep `MODEL_PROVIDER=disabled` as safe default.
- Local playable target must support LINE text; receipt image routing can return typed provider unavailable until OCR/vision is verified.
- Item 10B can create draft/evidence capture only through existing item 09 boundaries.
- Add a first-stage LINE Intake Router Agent in front of specialist agents. First pass may implement it by extending the existing `IntentRouterAgent`, but the contract must semantically classify LINE text/image/context into read question, expense-document capture, business-document reference, signature-upload ticket, mutation refusal, unsupported, or clarify before specialist dispatch. Cross-domain document hints and deterministic pre-draft gates follow [[plans/business-document-image-intake-plan|Business Document Image Intake Plan]].
- LINE Intake Router Agent must be model-driven for context/intent classification when provider is available. Static keyword dictionaries, regex-only routing, or a single phrase such as `ลายเซ็น` are not acceptable as the primary router.
- No final mutation from LINE or AI.

## Role Gates

- BA gate: Prove useful user journey: owner/accountant/inventory user can ask LINE in Thai and get safe summary/suggestion/draft-capture response from real local agent flow.
- SA gate: Reuse existing LINE auth, selected-company context, AI Gateway boundary, permission registry, internal secret, API tool adapters, attachment/expense primitives, and audit. No direct DB in AI Gateway.
- DEV gate: Ponytail read. Smallest correct diff should add feature-flagged Strands runtime, provider adapter, agent contracts, focused tools, local smoke checks, and AgentCore Runtime deployment artifacts only after local proof.
- Integration gate: Verify LINE webhook to local API through tunnel, API to AI Gateway, AI Gateway to selected model provider, tool permission checks, safe refusal/error states, LINE reply, then deployed AgentCore Runtime invoke/readiness when AWS access is ready. Browser path only for web deep-link/review pages that already exist.

## Phase 0: Discovery And Baseline Lock

### Goal

Confirm existing LINE/AI Gateway/tool/receipt state before code edits.

### Tasks

- [ ] Read linked spec and plan.
- [ ] Read `.agents/skills/ponytail/SKILL.md`.
- [ ] Inspect `apps/api/src/modules/line-ai` webhook, media download, reply, and context resolution.
- [ ] Inspect `apps/ai-gateway/src/modules/line-ai` turn use case, deterministic logic, controller contract, config service, and provider placeholders.
- [ ] Inspect `packages/contracts/src/line-ai.ts` and `packages/contracts/src/ai-tools.ts`.
- [ ] Inspect existing receipt upload/expense draft code and permission keys.
- [ ] Inspect package manager and current installed dependencies before adding Strands. Prefer existing deps if Strands SDK is already present.
- [ ] Inspect the local AWS-eval sample projects for reusable AgentCore/Strands patterns:
  - `/Users/spare058/Desktop/AWS-eval/fde-agentic-AI`
  - `/Users/spare058/Desktop/AWS-eval/fsi-agentic-AI-Platform`
  - `/Users/spare058/Desktop/AWS-eval/ConvoBankUc02`
  - `/Users/spare058/Desktop/AWS-eval/CreditMemoUc01`
- [ ] Confirm current AgentCore Runtime deployment contract: CodeZip/direct-code, container/ECR fallback, `/ping`, `/invocations`, IAM role, runtime create/update, runtime invoke, qualifier, and CloudWatch logs.
- [ ] Confirm current dirty worktree and avoid reverting unrelated changes.

### Verification

- `rg -n "MODEL_PROVIDER|BEDROCK|OPENAI|AI_FINAL_MUTATION|line.ai.query|capture_receipt|receipt" apps packages docs`
- Record findings in `docs/agent-memory/line-ai-local-agent-orchestration-10b.md`.

### Exit Criteria

- DEV knows exact existing extension points and no duplicate LINE/AI/receipt boundary is planned.

## Phase 1: Docs, Config, And Contracts

### Goal

Expose the local agent mode safely through config and shared contracts.

### Tasks

- [ ] Add env placeholders to `.env.example`.
- [ ] Extend config schema/service with:
  - `LINE_AI_AGENT_ORCHESTRATION_ENABLED`
  - `LINE_AI_AGENT_RUNTIME`
  - `MODEL_PROVIDER`
  - `OPENAI_API_KEY`
  - `OPENAI_MODEL`
  - `AWS_PROFILE`
  - `AWS_SDK_LOAD_CONFIG`
  - `BEDROCK_REGION`
  - `BEDROCK_MODEL_ID`
  - `AI_MAX_TOOL_CALLS`
  - `AI_TOOL_TIMEOUT_MS`
  - `AI_PROMPT_LOGGING_ENABLED`
- [ ] Keep disabled provider as default.
- [ ] Add/extend contracts for agent turn input/output, LINE intake route plan, specialist output, receipt risk, provider error, and tool call summary.
- [ ] Include route intents: `EXPENSE_DOCUMENT_CAPTURE`, `SIGNATURE_UPLOAD_TICKET`, `BUSINESS_READ_QUESTION`, `MUTATION_REQUEST_REFUSAL`, `CLARIFY`, and `UNSUPPORTED`.
- [ ] Add model id validation against approved company model when item 10A configuration exists.
- [ ] Add feature flag so legacy deterministic item 07 flow still works.

### Verification

- Config validation tests for disabled, OpenAI, Bedrock, and missing required provider fields.
- Contract compile/typecheck.

### Exit Criteria

- Local service starts without real AI credentials, and provider mode fails fast with typed setup error if env is incomplete.

## Phase 2: Model Provider Adapter

### Goal

Create minimal provider port for model calls from AI Gateway.

### Tasks

- [ ] Add provider interface:
  - `generateStructured(input, schemaHint)`
  - `generateText(input)`
  - typed errors: `PROVIDER_DISABLED`, `PROVIDER_CONFIG_MISSING`, `PROVIDER_THROTTLED`, `PROVIDER_ACCESS_NOT_READY`, `PROVIDER_TIMEOUT`, `PROVIDER_UNKNOWN`
- [ ] Implement Bedrock Converse adapter using AWS SDK already present or add the smallest required AWS SDK package if absent.
- [ ] Implement OpenAI Responses API adapter using native `fetch` and existing `OPENAI_*` config.
- [ ] Support model ids and inference profile ids in `BEDROCK_MODEL_ID`.
- [ ] Map known errors:
  - `ThrottlingException` to `PROVIDER_THROTTLED`
  - Anthropic use-case details error to `PROVIDER_ACCESS_NOT_READY`
  - validation unsupported on-demand throughput to setup guidance.
- [ ] Add timeout wrapper using existing config.
- [ ] Add provider-disabled adapter for local no-key runs.

### Verification

- Unit test error mapping for disabled, Bedrock, and OpenAI.
- Primary local Bedrock smoke when account access is available:

```bash
MODEL_PROVIDER=bedrock \
AWS_PROFILE=watchdog-bedrock \
AWS_SDK_LOAD_CONFIG=1 \
BEDROCK_REGION=ap-southeast-1 \
BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6 \
LINE_AI_AGENT_ORCHESTRATION_ENABLED=true \
pnpm --filter @watchdog-bms/ai-gateway test
```

- Local smoke command or script with real Bedrock profile when available:

```bash
MODEL_PROVIDER=bedrock \
AWS_PROFILE=watchdog-bedrock \
AWS_SDK_LOAD_CONFIG=1 \
BEDROCK_REGION=ap-southeast-1 \
BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6 \
pnpm --filter @watchdog-bms/ai-gateway test:bedrock-smoke
```

If quota/use-case blocks smoke, record exact AWS error in memory and keep provider-disabled tests passing.

### Exit Criteria

- AI Gateway can call OpenAI/Bedrock or return typed provider error without crashing.

## Phase 3: Local Agent Runtime Skeleton

### Goal

Add local agent runtime behind feature flag.

### Tasks

- [ ] Add Strands/AgentCore SDK dependencies only after confirming current package name/version from package manager/docs.
- [ ] Create `apps/ai-gateway/src/modules/line-ai/agents/`.
- [ ] Add agent files:
  - `orchestrator.agent.ts`
  - `line-intake-router.agent.ts` or extend `intent-router.agent.ts` with the same logical contract
  - `intent-router.agent.ts`
  - `accounting-summary.agent.ts`
  - `inventory.agent.ts`
  - `receipt-ocr.agent.ts`
  - `receipt-authenticity.agent.ts`
  - `response-composer.agent.ts`
- [ ] Provider disabled/misconfigured must return typed feature-unavailable output; do not expand Thai/English keyword fallback for business routing.
- [ ] Add allowlisted tool map per agent.
- [ ] Add LINE intake routing before specialist dispatch. The router sees sanitized message, attachment metadata, bounded image/vision hints where available, permissions, enabled features, and policy; it does not call ERP tools or write records directly.
- [ ] Route `SIGNATURE_UPLOAD_TICKET` only to an item 09 permission-checked API use case that creates a pending company signature candidate and web owner-approval ticket. Do not create an expense draft for this route.
- [ ] Route ambiguous image/text context to `CLARIFY`; do not open expense drafts or signature tickets automatically when confidence is low.
- [ ] Add max tool call guard.
- [ ] Add final mutation guard before and after model output.
- [ ] Expose exactly one governed delegation path from model/orchestrator to tools; no raw API, MCP, Prisma, SQL, or arbitrary HTTP access.

### Verification

- Unit test provider-disabled/missing-key path returns feature-unavailable without model/tool calls.
- Unit test multi-intent routing when provider returns a valid structured plan.
- Unit test mutation request refusal.
- Unit test LINE Intake Router for:
  - standalone signature-like image -> `SIGNATURE_UPLOAD_TICKET`
  - natural text asking to upload a signature with image -> `SIGNATURE_UPLOAD_TICKET`
  - unseen wording/synonym -> no keyword addition required
  - ambiguous image/text -> `CLARIFY`
  - receipt/slip image -> `EXPENSE_DOCUMENT_CAPTURE`, not signature ticket
  - final mutation request -> `MUTATION_REQUEST_REFUSAL`
- Unit test per-agent tool allowlist denial.

### Exit Criteria

- One local orchestrator turn can run without LINE and produce structured output.

## Phase 4: Tool Adapter Wiring

### Goal

Expose permission-checked BMS tools to agents through existing boundaries.

### Tasks

- [ ] Reuse existing AI Gateway to API internal request path and internal secret.
- [ ] Register required tools:
  - `company.get_current_context`
  - `dashboard.get_business_health_summary`
  - `notifications.list_open_alerts`
  - `inventory.list_low_stock`
  - `inventory.get_stock_balance`
  - `inventory.summarize_stock_movements`
  - `receipt.get_attachment_metadata`
  - `receipt.create_or_update_evidence_draft`
  - `receipt.find_duplicate_by_hash`
  - `receipt.score_authenticity`
- [ ] For absent tools, return typed unsupported-module result.
- [ ] Ensure API repeats permission and ABAC checks.
- [ ] Ensure AI Gateway also checks tool policy before call.
- [ ] Ensure tool outputs include source refs and `permissionChecked: true`.
- [x] Keep a single governed tool executor/adapter path: policy decision -> audit record -> execute.
- [x] Define tool input schemas from the real API/use-case contract. Do not invent Gateway/MCP schemas; mismatches must fail tests.

### Verification

- API/AI Gateway tests for allowed tool call.
- Permission-denied test proves no hidden counts/data leak.
- Unsupported-module test proves no fake numbers.
- Schema-mismatch test proves invalid tool input fails closed before API call.

### Exit Criteria

- Agents can call at least one dashboard/notification or inventory tool safely.

## Phase 5: LINE Text End-To-End Local Path

### Goal

Make real LINE text invoke local agent mode and reply.

### Tasks

- [ ] Add routing switch in current LINE AI turn use case:
  - flag off: existing item 07 behavior
  - flag on: Strands Orchestrator Agent
- [ ] Preserve raw-body signature verification and redaction.
- [ ] Preserve unlinked, inactive membership, feature disabled, permission denied, and ambiguous company refusals before AI Gateway call.
- [ ] Add concise Thai response composer output.
- [ ] Add source refs/deep links only from tool outputs.
- [ ] Add provider error messages safe for LINE.
- [x] Add real short-term multi-turn context for LINE chat:
  - same `companyId + userId` only
  - previous 15 `AiTurn` rows maximum
  - active only when the latest context is inside the last 15 minutes
  - sent only when current access still has `line.ai.query`
  - assistant reply previews included only when current permissions still cover tools invoked in that prior turn
- [x] Pass bounded `conversationContext` through LINE Intake Router, Intent Router, Orchestrator model tool loop, model answer composer, and AgentCore Runtime payload validation.
- [x] Keep `LineCompanyContext` separate as long-lived selected-company context; short-term chat context never chooses company or bypasses membership/permission checks.

### Verification

- Test linked user happy path through controller/use case.
- Test unlinked user does not call AI Gateway.
- Test feature disabled and permission denied paths.
- Test 15-turn cap, 15-minute inactivity cutoff, and permission-filtered assistant reply preview.
- Test router/tool-loop/answer-composer payloads receive bounded context.
- Test AgentCore Runtime caps direct context payloads to 15 turns and 500 chars per preview.
- Manual local LINE tunnel smoke:
  - send Thai multi-command text
  - send a follow-up within 15 minutes such as "อันที่สองล่ะ"
  - wait more than 15 minutes or simulate an old turn and verify the follow-up starts without short-term context
  - verify LINE reply
  - verify audit/turn/tool log

### Exit Criteria

- Local real LINE text demo works or exact external blocker is recorded.

## Phase 6: Receipt Image Local Path

### Goal

Route LINE image/PDF evidence to receipt OCR/authenticity flow without final mutation.

### Tasks

- [ ] Reuse item 09 media download and attachment persistence.
- [ ] Route attachments to Receipt OCR Agent before generic text intent when present.
- [ ] Add OCR output contract even if provider returns typed unavailable.
- [ ] Implement duplicate hash check.
- [ ] Implement authenticity scoring from available deterministic signals first.
- [ ] If Bedrock vision is verified, add OCR extraction through provider adapter; otherwise keep manual-review fallback.
- [ ] Create or update evidence draft only through permission-checked receipt draft tool.
- [ ] Link LINE reply to web review path.

### Verification

- Image upload with permission creates/reuses draft or manual-review record.
- Duplicate image returns risk.
- Missing permission denies before draft.
- Provider unavailable still stores original evidence and asks for web review.

### Exit Criteria

- Receipt upload does not require final AI certainty to be useful and safe.

## Phase 7: Local Runbook And Demo Script

### Goal

Make another developer able to run the local LINE agent demo without rediscovery.

### Tasks

- [ ] Add docs/runbook or plan section with:
  - AWS profile setup
  - Anthropic use case form note
  - quota/throttle handling
  - env values
  - local API/AI Gateway start commands
  - tunnel setup
  - LINE webhook URL setup
  - sample LINE messages
  - expected replies
  - rollback flag
- [ ] Add local smoke script if repo patterns support it.
- [ ] Record known limitations.

### Verification

- Run docs/code lint gates.
- Manual runbook dry read by Integration.

### Exit Criteria

- Item 10B can be handed to Sonnet 4.6 without chat context.

## Integration Verification

### Goal

Prove backend-to-LINE flow and safety gates.

### Required Checks

- [ ] `pnpm agent:gates -- docs/plans/line-ai-local-agent-orchestration-plan.md docs/agent-memory/line-ai-local-agent-orchestration-10b.md`
- [ ] Config validation tests.
- [ ] AI Gateway unit tests for provider adapter, intent router, mutation guard, tool policy.
- [ ] API LINE tests for signature/context/refusal paths.
- [ ] One local LINE text smoke with tunnel.
- [ ] One LINE image smoke or exact blocker recorded.
- [ ] `MODEL_PROVIDER=disabled` run proves local services still boot.
- [ ] Bedrock smoke or exact AWS blocker recorded.

### Exit Criteria

- Checklist item 10B can be ticked only after real local LINE path proof or exact owner-accepted external blocker is recorded.

## Phase 8: AgentCore Runtime Deployment

### Goal

Deploy the proven agent service to Amazon Bedrock AgentCore Runtime without weakening WatchDog data, permission, or audit boundaries.

### Tasks

- [x] Package the Orchestrator Agent as an AgentCore-compatible HTTP service.
- [x] Expose `GET /ping` and `POST /invocations`.
- [x] Add CodeZip/direct-code deployment path first if dependencies fit AgentCore runtime size/runtime limits.
- [ ] Add a Dockerfile/runtime image build path only if CodeZip is blocked by dependency size, native/system deps, or production CI/CD needs.
- [ ] If using container, push the image to ECR with an immutable tag.
- [ ] Create or reuse a least-privilege AgentCore Runtime execution role.
- [ ] Create or update the AgentCore Runtime in `ap-southeast-1` unless model/runtime availability requires a documented exception.
- [ ] Invoke the runtime from AI Gateway/API server-side only by ARN/id plus qualifier (`DEFAULT` for auto-tracking code deploy or named endpoint for controlled release).
- [ ] Add API/AI Gateway adapter config for invoking the runtime by ARN/id; LINE and web must not call AgentCore directly.
- [x] Keep all tool execution behind WatchDog API/internal tool endpoints or future AgentCore Gateway/MCP; no Prisma, direct DB, arbitrary HTTP, or model-selected endpoint paths in runtime.
- [ ] Store runtime ARN/id, artifact id or image tag, model id, role ARN, region, qualifier, and verification output in `docs/agent-memory/line-ai-local-agent-orchestration-10b.md`.

### Verification

- [ ] Runtime status reaches ready/available state.
- [ ] Deployed runtime handles a read-only Thai summary payload.
- [ ] Deployed runtime refuses a final mutation request.
- [ ] CloudWatch logs show redacted turn id, agent id, provider model id, and policy decision.
- [ ] Cost guard is active before sustained runtime testing.

### Exit Criteria

- AgentCore Runtime can host the Strands agent and be invoked server-side without bypassing WatchDog API permissions or audit.

## Later Deferred Work

- AgentCore Gateway or MCP production tool gateway with exact schema parity and fail-closed bearer/IAM auth.
- AgentCore Memory, Registry, and Evaluations.
- OpenTelemetry dashboards.
- Formal eval dataset beyond focused tests.
- CRM/Employee/Tax/Bank/Procurement specialist agents.
- Any final mutation capability.

## Handoff Notes For DEV

- Start with disabled provider and feature-unavailable tests.
- Add Bedrock after config is stable.
- Add Strands/AgentCore SDK only when current package choice is confirmed; sample repos are evidence, not version lock.
- Deploy AgentCore Runtime only after local LINE/tool/policy proof passes or blocker is explicitly accepted.
- Do not let Strands import Prisma, repositories, or unrestricted HTTP clients.
- Keep all model output behind schema validation and policy guard.
- The first working demo can answer inventory/dashboard questions and refuse everything else. Receipt path may be manual-review fallback if OCR model access is blocked.
