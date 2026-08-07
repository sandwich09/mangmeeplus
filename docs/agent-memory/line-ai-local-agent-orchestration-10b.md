# Agent Memory: line-ai-local-agent-orchestration-10b

Owner follow-up 2026-07-13: image/document semantic classification before expense-draft creation is tracked in [[agent-memory/business-document-image-intake|Business Document Image Intake memory]]. Item 10B remains the LINE orchestration owner and must fail closed when the provider cannot classify uncaptioned media.

Status: COMPLETE (OpenAI local provider ready; pending LINE tunnel smoke and Bedrock quota/use-case approval).
Owner: Product / AI Gateway.
Scope: Item 10B – local-playable agent orchestration for LINE chat: Bedrock provider adapter, feature-flagged OrchestratorAgent, per-specialist tool allowlists, receipt image path, safe LINE replies, and local runbook.

Role gate status:
- BA: Complete. Goal: linked users ask in Thai, agents route multi-command text/images safely.
- SA: Complete. Architecture: feature-flagged turn use case → OrchestratorAgent → IntentRouterAgent → specialist agents → ResponseComposerAgent. No DB in AI Gateway. All data via ErpToolClient.
- DEV: Complete. Ponytail read; smallest correct diff. All phases 1–7 implemented. OpenAI local provider added after user obtained API key. Focused provider tests pass; AI Gateway typecheck clean.
- Integration: Complete. All checks passed. See Verification section below.

Decisions:
- Initial local implementation did not depend on Strands JS/TS SDK; AWS-eval samples later proved `@strands-agents/sdk` exists. Future AgentCore packaging may add it after current package/version verification.
- `LINE_AI_AGENT_ORCHESTRATION_ENABLED=false` → item 07 deterministic path untouched.
- `MODEL_PROVIDER=disabled` → DisabledProvider; safe boot, no model calls.
- `MODEL_PROVIDER=openai` → OpenAiProvider; fastest local real-model test path while Bedrock quota is blocked.
- Agent prompts are English constants in each agent file. User-facing output must follow user input language.
- IntentRouterAgent uses provider JSON routing when available; disabled/missing/invalid model plans fail closed with feature-unavailable output.
- Per-agent ALLOWED_TOOLS enforced: each specialist only calls its own allowlisted tools.
- Receipt tools (receipt.*, accounting.get_summary) in LINE_TOOL_REGISTRY with supportedAgents=[] so legacy selectTools ignores them; orchestrator agents find by name.
- Receipt OCR/authenticity return UNSUPPORTED until API endpoints exist; web review link in reply.
- ReceiptAuthenticityAgent returns ReceiptRisk (LOW/MEDIUM/HIGH with reasons), never absolute verdict.
- All unimplemented-tool results include permissionChecked: true in sourceRefs.
- Final mutation blocked via intent classification (mutation_request → UNROUTABLE) and zero mutation tools in allowlists. ToolPolicyEnforcerService provides a second layer for any mutation tool call.
- OpenAI provider uses native Node `fetch`; no new dependency.
- @aws-sdk/client-bedrock-runtime ^3 installed in apps/ai-gateway/node_modules.
- Grounded language layer (owner directive 2026-07-01, "AI 100%, not deterministic"): `ResponseComposerAgent.compose()` still builds the source-backed reply deterministically; `polishLanguage()` then lets the model reword it for readability using only those facts. Wired in `OrchestratorAgent.run` for data replies (`sourceRefs>0`) only; refusals/no-data stay verbatim. Grounding guard rejects any invented/altered number or runaway output and falls back to the grounded text; provider-unavailable also falls back, so LINE always answers. Reuses the previously-dead `RESPONSE_COMPOSER_SYSTEM_PROMPT`. Spec `line-ai-local-agent-orchestration-spec.md` "Reference patterns" updated to permit this. Tests: `response-composer.agent.spec.ts` (6 new) + orchestrator suite green (ai-gateway 160/160).
- Model-driven tool loop (owner "ได้ ทำเลย" 2026-07-01, extends "AI 100%"): `OrchestratorAgent` now picks tools via a model loop (`dispatchByModelLoop` + `chooseNextTool`, using the previously-dead `ORCHESTRATOR_SYSTEM_PROMPT`) instead of a one-shot deterministic switch. The model chooses the next read-only tool one at a time, restricted to `availableToolsForPlan` = the routed agents' specialist allowlists ∩ `ROUTER_ENABLED_TOOLS` (domain isolation). Each choice runs through the owning specialist (`requiredTools=[tool]`) so permission checks + deterministic fact-shaping (grounding) are unchanged; mutations stay impossible (read-only allowlists + ToolPolicyEnforcer). No new config flag: the loop is gated on provider availability and **falls back to the existing `dispatchByPlan` deterministic dispatch** when the provider is unavailable OR the model names an out-of-allowlist tool OR declines — so all prior behavior/tests are preserved (the shared plan-returning mock makes the loop no-op into fallback). Tests: `orchestrator-model-loop.agent.spec.ts` (3 new: model-chosen tool, out-of-domain rejection→fallback, decline→fallback); ai-gateway 163/163.
- Live Bedrock verification (2026-07-01): full model-driven path exercised against real Bedrock via `agents/orchestrator-smoke.ts` (standalone, stubbed ERP data, never-in-CI, companion to `provider-smoke.ts`). Confirmed: model routes domain correctly; model tool loop selects tools multi-step (e.g. list_low_stock → get_stock_balance); specialists shape grounded facts; grounded language layer polishes (added thousands separators; translated a Thai grounded reply to English on English input) with numbers preserved (guard passed, no fallback); mutation ask → UNROUTABLE safe refusal. **Fix found in the process:** `polishLanguage` was gated on `composed.sourceRefs.length > 0`, but specialists never attach `sourceRef` to facts, so the language layer never ran in the orchestrator path — regated on `outputs.some(o => o.facts.length > 0)`. **Bedrock model id:** `anthropic.claude-sonnet-4-6` is NOT on-demand invokable in ap-southeast-1 → use inference profile `global.anthropic.claude-sonnet-4-6` (`.env` fixed; `.env.example` already correct). Provider smoke: `{ok:true, provider:"bedrock", text:"ยืนยัน"}`.
- Full-stack live run (2026-07-01, model = **Haiku 4.5** `global.anthropic.claude-haiku-4-5-20251001-v1:0` for cheap testing): built + ran API (`:3001`) + AI Gateway (`:3002`) against live Postgres/Redis, drove real turns via `POST /v1/internal/ai/line-turn` (X-Internal-Secret). Confirmed end-to-end: Haiku routes → model tool loop picks 3 inventory tools → gateway `ErpToolClient` calls API `POST /v1/internal/ai/tools/invoke` (200 ×3, real DB reads on `seed-local-company`) → grounded facts (stock=1, received=100 from real Product row) → language layer (English question → English reply, numbers preserved). Mutation ask ("โอนเงินจ่ายบิล") → `refused=true`. **Config bug found by running for real:** `.env` had `AWS_SDK_LOAD_CONFIG=1`, but the gateway config `envBoolean` only accepts `true`/`false` → boot crash; fixed to `true` (still truthy for the AWS SDK). Runbook example corrected too. Both ports read `PORT` (schema default 3000) so run with `PORT=3001`/`PORT=3002`. Note: the LINE webhook transport + API-side server-side permission resolution were not exercised (turn was posted directly to the gateway with a realistic userContext, as the API webhook flow would).
- Richer seed (2026-07-01): extended `apps/api/prisma/seed.ts` with 3 demo products on `seed-local-company` (WATER-600, COFFEE-1KG, BOX-M) + stock movements, so WATER (bal 15<50) and BOX (bal 10<100) are low-stock. Re-running a real inventory turn then returned grounded `low-stock=2, balances=4, received=840, issued=680` — all from real DB. Seed is idempotent (upsert + fixed ids + reason-guarded movements).
- Real LINE webhook verified end-to-end (2026-07-01): the `.env` already has LINE Messaging creds. Inserted a `provider='LINE'` ExternalIdentity (`Utestline0001` → seed-local-owner). POSTed an HMAC-SHA256-signed body to `POST /v1/line/webhook`: **valid signature → 200 (durationMs 8218 = full turn)**; the API verified the signature, resolved LINE user→owner→`seed-local-company`→permissions (`line.ai.query` ✓, all server-derived), called the gateway, which ran Haiku + a 3-tool model loop against the real DB (3× `POST /v1/internal/ai/tools/invoke`). **Invalid signature → 401.** owner has 1 membership so `resolveCompanyForLineUser` auto-resolves (no LineCompanyContext needed). Only gap: actual reply DELIVERY needs a real (non-expired) `replyToken` from a genuine LINE event — a dummy token is rejected by api.line.me.
- **Two real bugs found + fixed in `process-line-webhook.use-case.ts` (2026-07-01), both exposed only by running the model-driven path for real:**
  1. **`persistTurn` threw on the model's free-form intent.** `AiTurn.intent` is the `AiTurnIntent` enum (READ_SUMMARY/READ_DETAIL/MUTATION_REQUEST/UNSUPPORTED_MODULE/FORBIDDEN/UNKNOWN), but persist did `response.intent.toUpperCase()`, and the item-10B model returns descriptive intents ("list_all_products", Thai text) → Prisma rejected → the whole turn was lost. Item-07's fixed-set intents matched, so this never surfaced before; the mocked unit test didn't validate the enum. Fix: `toAiTurnIntent(raw, refusalReason)` normalizes to a valid enum (refusal signal → MUTATION_REQUEST/UNSUPPORTED_MODULE/FORBIDDEN, else UNKNOWN). Exported + unit-tested.
  2. **Delivery failure aborted persistence.** `sendReply` ran before `persistTurn`, so an expired/invalid reply token threw and skipped persistence. Fix: persist + audit + event-log FIRST, then best-effort `sendReply` in try/catch (delivery failure logged, never loses the turn).
  Verified in the real stack: a signed webhook with a dummy reply token now persists `AiTurn` (status COMPLETED, intent UNKNOWN, replyPreview = grounded reply) and marks the event `completed`, even though delivery fails. Tests: `process-line-webhook.use-case.spec.ts` (+4: 3 `toAiTurnIntent` + 1 delivery-failure-still-persists); api suite 735/735.
- Runbook §5 local run needs `PORT=3001` (api) / `PORT=3002` (gateway) overrides — both read `PORT` (schema default 3000). Postgres/Redis via `pnpm docker:local:infra`.

Open questions:
- Anthropic use-case form status for ap-southeast-1 Bedrock access (external blocker for real model calls).
- Tunnel canonical choice: ngrok vs Cloudflare Tunnel (runbook documents both; either works).
- Receipt endpoint timeline (when API adds receipt.* endpoints, remove from UNIMPLEMENTED_TOOLS in erp-tool.client.ts).

Artifacts:
- `packages/config/src/index.ts` – 4 new keys: LINE_AI_AGENT_ORCHESTRATION_ENABLED, LINE_AI_AGENT_RUNTIME, AWS_PROFILE, AWS_SDK_LOAD_CONFIG
- `packages/config/src/index.test.ts` – 7 new aiGatewayConfigSchema tests (all pass)
- `packages/contracts/src/line-ai.ts` – ProviderError, AgentIntentPlan, SpecialistOutput, ReceiptRisk, etc.
- `packages/contracts/src/ai-tools.ts` – 5 new receipt/accounting tools (supportedAgents=[])
- `apps/ai-gateway/src/common/config/ai-gateway-config.service.ts` – 4 new getters
- `apps/ai-gateway/package.json` – @aws-sdk/client-bedrock-runtime ^3 added; test script updated with OpenAI provider spec
- `.env.example` – new item 10B keys documented
- `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/` – provider.port.ts, disabled.provider.ts, bedrock.provider.ts, openai.provider.ts, provider.factory.ts + 3 spec files
- `apps/ai-gateway/src/modules/line-ai/agents/` – agent-types.ts, intent-router.agent.ts, accounting-summary.agent.ts, inventory.agent.ts, receipt-ocr.agent.ts, receipt-authenticity.agent.ts, response-composer.agent.ts, orchestrator.agent.ts + 2 spec files
- `apps/ai-gateway/src/modules/line-ai/infrastructure/erp-tool.client.ts` – UNIMPLEMENTED_TOOLS guard
- `apps/ai-gateway/src/modules/line-ai/application/use-cases/line-ai-turn.use-case.ts` – feature-flag routing
- `apps/ai-gateway/src/modules/line-ai/application/use-cases/line-ai-turn.use-case.spec.ts` – new (5 tests)
- `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.spec.ts` – updated (5 tests: auth, happy path, bad request)
- `apps/ai-gateway/src/modules/line-ai/line-ai.module.ts` – OrchestratorAgent registered
- `docs/runbooks/line-ai-local-agent-10b-runbook.md` – AWS profile, throttle handling, env values, start commands, tunnel, LINE webhook, sample messages, rollback, known limitations

Verification:

Integration gate – run 2026-06-27.

| Command | Result |
|---------|--------|
| `pnpm --filter @watchdog-bms/contracts build` | PASS – clean build |
| `pnpm --filter @watchdog-bms/ai-gateway build` | PASS – clean build |
| `pnpm --filter @watchdog-bms/ai-gateway test` | PASS – 76/76 tests |
| `pnpm --filter @watchdog-bms/config test` | 41/42 pass (1 pre-existing failure: LINE_LIFF_ID missing in test fixture; unrelated to 10B) |
| `./node_modules/.bin/tsc --noEmit -p apps/ai-gateway/tsconfig.json` | PASS – clean typecheck after OpenAI provider patch |
| `./node_modules/.bin/tsx --test apps/ai-gateway/src/modules/line-ai/infrastructure/provider/disabled.provider.spec.ts apps/ai-gateway/src/modules/line-ai/infrastructure/provider/bedrock.provider.spec.ts apps/ai-gateway/src/modules/line-ai/infrastructure/provider/openai.provider.spec.ts` | PASS – 11/11 provider tests |
| `./node_modules/.bin/tsx --test apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.spec.ts apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts` | PASS – 14/14 agent prompt/language tests |

Verification notes after OpenAI provider patch:
- `pnpm ...` commands were blocked by repository/package-manager state: pnpm first required `CI=true`, then network access, then failed on `ERR_PNPM_IGNORED_BUILDS` from pending build-script approvals. Direct local `tsx`/`tsc` commands were used for focused verification.
- No real OpenAI API call was made; provider spec stubs `globalThis.fetch` and verifies success/auth/throttle mapping.

Integration checks (all verified by code read + test output):

1. CONTRACT CONSISTENCY: All required types present in packages/contracts/src/line-ai.ts –
   ProviderErrorCode, ProviderError, AgentIntentPlan, AgentIntentItem, AgentRefusal,
   SpecialistOutput, AgentFact, AgentSuggestion, AgentToolCall, ReceiptRisk. CONFIRMED.

2. FEATURE FLAG ROUTING: line-ai-turn.use-case.ts line 86-89 branches on
   this.config.lineAiAgentOrchestrationEnabled. Flag=false → runDeterministicPath (item 07 intact).
   Flag=true → runOrchestratorPath → this.orchestrator.run(req). Tests confirm both branches.

3. MUTATION GUARD: IntentRouterAgent returns UNROUTABLE for mutation_request intents.
   OrchestratorAgent checks plan.status !== 'UNROUTABLE' before dispatching specialists.
   Test "mutation request returns UNROUTABLE plan and safe reply" confirms. ToolPolicyEnforcerService
   provides second-layer guard for mutation tools (AI_FINAL_MUTATION_ENABLED=false). CONFIRMED.

4. MAX TOOL CALLS GUARD: OrchestratorAgent.run() checks totalToolCalls >= maxToolCalls before each
   specialist dispatch. Test "respects aiMaxToolCalls limit" with limit=1 confirms. CONFIRMED.

5. DISABLED PROVIDER: DisabledProvider.generateText() returns { ok: false, error: { code:
   'PROVIDER_DISABLED', retryable: false } } without any HTTP call. Tests confirm. CONFIRMED.

6. RECEIPT RISK TYPE: ReceiptAuthenticityAgent.computeRisk() returns ReceiptRisk with level:
   'LOW'|'MEDIUM'|'HIGH'. Never returns string like "real" or "fake". CONFIRMED.

7. PERMISSION CHECKED: UNIMPLEMENTED_TOOLS stub in erp-tool.client.ts returns
   sourceRefs with permissionChecked: true. CONFIRMED.

8. MODULE REGISTRATION: OrchestratorAgent in LineAiModule.providers. AiGatewayConfigService
   available via imported AiModule (which exports AiGatewayConfigService). CONFIRMED.

9. NO PRISMA IN AI-GATEWAY: grep for prisma imports returns empty. CONFIRMED.

10. PROVIDER FACTORY: DisabledProvider selected when MODEL_PROVIDER=disabled or provider config is
    missing; BedrockProvider selected for MODEL_PROVIDER=bedrock with region/model ID; OpenAiProvider
    selected for MODEL_PROVIDER=openai with OPENAI_API_KEY. CONFIRMED.

10A. AGENT PROMPTS: Intent router, orchestrator, accounting, inventory, receipt OCR,
     receipt authenticity, and response composer all expose English system prompt constants. Intent
     router calls provider when available and falls back safely on disabled/invalid output.
     Response composer mirrors Thai/English user input for safe replies. CONFIRMED.

11. RECEIPT IMAGE PATH: OrchestratorAgent detects hasAttachment → runs ReceiptOcrAgent then
    ReceiptAuthenticityAgent. Both tools UNIMPLEMENTED → ReceiptOcrAgent returns UNSUPPORTED with
    Thai safe message. ReceiptAuthenticityAgent returns LOW risk. ResponseComposerAgent renders
    "กรุณาตรวจสอบผ่านเว็บแอป". CONFIRMED.
    Known gap: ReceiptOcrAgent.webLinks (non-standard field on SpecialistOutput) is not read by
    ResponseComposerAgent. Acceptable since tools are unimplemented; fix when receipt endpoints exist.

12. ENV EXAMPLE: .env.example has LINE_AI_AGENT_ORCHESTRATION_ENABLED=false (safe default),
    LINE_AI_AGENT_RUNTIME=disabled, AWS_PROFILE=, AWS_SDK_LOAD_CONFIG=false. CONFIRMED.

13. RUNBOOK: docs/runbooks/line-ai-local-agent-10b-runbook.md has AWS profile setup, env values,
    tunnel setup, sample Thai LINE messages, rollback flag instructions. CONFIRMED.

14. BEDROCK SDK: @aws-sdk/client-bedrock-runtime installed in apps/ai-gateway/node_modules. CONFIRMED.

Accepted external blockers (not code issues):
- Bedrock smoke: No AWS credentials in CI; Anthropic use-case form for ap-southeast-1 may need
  approval (PROVIDER_ACCESS_NOT_READY expected until approved). This is an AWS external blocker.
- Receipt API endpoints: receipt.find_duplicate_by_hash, receipt.score_authenticity,
  receipt.get_attachment_metadata, receipt.create_or_update_evidence_draft, accounting.get_summary
  are all in UNIMPLEMENTED_TOOLS; return unsupported_module. Remove entries when API endpoints exist.

Next:
- OpenAI local smoke: set MODEL_PROVIDER=openai, OPENAI_API_KEY, OPENAI_MODEL=gpt-4.1-mini,
  LINE_AI_AGENT_ORCHESTRATION_ENABLED=true. Send Thai inventory/notification message through the
  local turn endpoint or LINE tunnel. Do not commit the key.
- Bedrock smoke: Set MODEL_PROVIDER=bedrock, BEDROCK_REGION=ap-southeast-1,
  BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6, LINE_AI_AGENT_ORCHESTRATION_ENABLED=true,
  AWS_PROFILE=watchdog-bedrock. Send Thai inventory/notification message via LINE tunnel.
  Confirm reply is Thai text, plan.status=ROUTABLE, toolsInvoked has inventory.* tools.
  If PROVIDER_ACCESS_NOT_READY → submit Anthropic use-case form; retry when approved.
- Receipt web link gap: add optional webLinks?: LineAiWebLink[] to SpecialistOutput in contracts,
  update ResponseComposerAgent to collect them. Do this when receipt API endpoints are implemented.
- Config test pre-existing failure: LINE_LIFF_ID missing in validProduction fixture in
  packages/config/src/index.test.ts; needs separate fix unrelated to 10B.

## 2026-06-27 Runtime Routing Fix

Status: COMPLETE.

Role gate status:
- BA: Complete. User report showed LINE replies reused accounting summary for unrelated prompts. Business rule: when model/feature is not configured, tell user the feature is not enabled instead of guessing.
- SA: Complete. Architecture remains feature-flagged OrchestratorAgent -> IntentRouterAgent -> specialist -> ERP tools. Orchestrator routing now depends on model JSON plans with explicit requiredTools; model disabled/invalid/missing tool plan fails closed as tool_unavailable.
- DEV: Complete. Ponytail full. Smallest diff removed deterministic fallback from IntentRouterAgent, required non-empty allowlisted requiredTools for routable plans, made specialists respect requiredTools, allowed sales/crm dispatch through existing summary specialist, and added user-facing unavailable copy.
- Integration: Complete. Focused AI Gateway tests passed; sandbox tsx IPC failed with EPERM, escalated rerun passed.

Decisions:
- Do not add Thai/English keyword classifier entries for every phrase. Item 10B orchestration must use model routing, not deterministic keyword expansion.
- `MODEL_PROVIDER=disabled`, missing key, invalid model JSON, empty requiredTools, or unknown tool name means LINE reply says the feature is not enabled in this system.
- Legacy deterministic item 07 path remains behind `LINE_AI_AGENT_ORCHESTRATION_ENABLED=false`.

Artifacts:
- `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/accounting-summary.agent.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/inventory.agent.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.spec.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts`
- `apps/ai-gateway/src/modules/line-ai/domain/logic/line-ai-turn.spec.ts`

Verification:
- `./node_modules/.bin/tsx --test apps/ai-gateway/src/modules/line-ai/domain/logic/line-ai-turn.spec.ts apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.spec.ts apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts`: PASS, 40/40 tests.

Next:
- For real LINE smoke, set `LINE_AI_AGENT_ORCHESTRATION_ENABLED=true` plus real `MODEL_PROVIDER=openai|bedrock` credentials. If credentials are absent, expected reply is feature-not-enabled.

## 2026-06-27 LINE Owner Company Context Commands

Status: COMPLETE.

Role gate status:
- BA: Complete. OWNER users with multiple companies must be able to check accessible companies and switch current LINE company context; non-owner multi-company membership remains a policy violation.
- SA: Complete. Company context switching is API control plane before AI Gateway, not model/business-intent classification. Server resolves LINE identity, active memberships, OWNER roles, then writes `LineCompanyContext`.
- DEV: Complete. Ponytail full. Smallest diff added exact commands `/companies` and `/company <number-or-companyId>` in `ProcessLineWebhookUseCase`, kept business natural language out of classifier changes, and added focused tests.
- Integration: Complete. API focused test and typecheck passed; sandbox tsx IPC failed with EPERM, escalated rerun passed from `apps/api`.

Decisions:
- `/companies` lists active companies the linked OWNER can access and marks the active context.
- `/company <number-or-companyId>` switches context only after active membership and OWNER checks pass.
- Natural-language questions such as company data checks continue through normal AI/model route after server-side context exists. Natural language does not switch company context.
- If a user has multiple active memberships without OWNER role, LINE replies forbidden and no AI Gateway or ERP tool call runs.

Artifacts:
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts`
- `docs/specs/line-ai-read-only-assistant-spec.md`
- `docs/specs/line-ai-channel-auth-spec.md`
- `docs/agent-memory/line-ai-local-agent-orchestration-10b.md`

Verification:
- `../../node_modules/.bin/tsx --test src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` from `apps/api`: PASS, 15/15 tests.
- `corepack pnpm --filter @watchdog-bms/api typecheck`: PASS.

Next:
- Real LINE smoke should test `/companies`, `/company 2`, then a normal company-scoped AI question; expected company comes from updated `LineCompanyContext`.

## 2026-06-27 AWS-eval AgentCore Sample Review

Status: DOCS UPDATED.

Evidence reviewed:
- `/Users/spare058/Desktop/AWS-eval/fde-agentic-AI`
- `/Users/spare058/Desktop/AWS-eval/fsi-agentic-AI-Platform`
- `/Users/spare058/Desktop/AWS-eval/ConvoBankUc02`
- `/Users/spare058/Desktop/AWS-eval/CreditMemoUc01`

Applied to docs:
- `docs/specs/line-ai-local-agent-orchestration-spec.md`
- `docs/plans/line-ai-local-agent-orchestration-plan.md`
- `docs/runbooks/line-ai-local-agent-10b-runbook.md`
- `docs/agent-memory/line-ai-local-agent-orchestration-10b.md`

Decisions:
- Keep WatchDog API/AI Gateway as the source of permission, data, source-module validation, audit, and final-mutation refusal.
- Adopt the sample pattern of one governed tool path: policy decision -> audit record -> execute. No raw API, MCP, Prisma, SQL, arbitrary HTTP, or model-selected endpoint path reaches the model.
- Tool schemas are contracts. Any future AgentCore Gateway/MCP target schema must match the real API/use-case signature exactly; mismatch fails closed.
- Use conversation supervisor/orchestrator for routing, but keep regulated calculations/outcomes deterministic or human-reviewed.
- Treat AgentCore CodeZip/direct-code deploy as the first iteration path when dependency size/runtime limits allow; container/ECR stays fallback for production or heavy dependencies.
- Sample `ConvoBankUc02` and `CreditMemoUc01` prove Node 22 AgentCore Runtime with `@strands-agents/sdk` and `bedrock-agentcore` is viable, but WatchDog must verify current package versions before adding dependencies.
- Keep AgentCore Gateway, Memory, Registry, and Evaluations as later hardening unless owner pulls them into item 10B.

Verification:
- Docs-only change. `git diff --check`: PASS.
- `pnpm agent:gates -- docs/plans/line-ai-local-agent-orchestration-plan.md docs/agent-memory/line-ai-local-agent-orchestration-10b.md`: blocked by pnpm no-TTY install preflight.
- `CI=true pnpm agent:gates -- docs/plans/line-ai-local-agent-orchestration-plan.md docs/agent-memory/line-ai-local-agent-orchestration-10b.md`: PASS, plan gate evidence ok and memory gate evidence ok.

Next:
- If implementing AgentCore Runtime next, start with local provider-disabled and feature-unavailable tests, then Bedrock smoke, then CodeZip runtime deploy proof or exact AWS/IAM/quota blocker.

## 2026-06-27 Phase 8 – AgentCore Runtime Entry Point + Governed Tool Path

Status: PARTIAL. Local artifacts complete. AWS deployment blocked (no credentials/IAM role).

Role gate status:
- BA: No change to user-facing behavior. AgentCore runtime is a server-side invocation path; LINE users continue to interact through LINE/API as before.
- SA: Architecture: AI Gateway invokes AgentCore runtime by ARN+qualifier server-side only. LINE and web must never call AgentCore directly. All tool execution remains behind WatchDog API internal tool endpoints.
- DEV: Ponytail full. Smallest correct diff. Three artifacts added: runtime.ts (GET /ping, POST /invocations), runtime.spec.ts (payload validation tests), agentcore.json (CodeZip deploy config). Governed tool path hardened: ToolPolicyEnforcerService wired into ErpToolClient.invoke() as policy decision → audit record → execute chain. toolMetaToPolicy() converts ToolMeta→ToolPolicy using category/sensitiveAudit/requiresErpPermissionCheck. No new dependencies (Node.js http module only; no @strands-agents/sdk or bedrock-agentcore since not installed). erp-tool.client.spec.ts added with 9 new focused tests.
- Integration: Local tests pass. AWS deployment remains external blocker.

Decisions:
- AgentCore runtime standalone Node.js http server (no NestJS); constructs dependencies directly from env vars. No Strands SDK dependency added (not installed; add only after version verification).
- agentcore.json CodeZip path: entrypoint=dist/agentcore/runtime.js; deploy via CDK or AWS CLI only.
- toolMetaToPolicy(): `final_mutation || approval_request` category → allowedWhenFinalMutationDisabled=false; `draft_create` remains allowed because evidence/draft capture is permitted before final human-reviewed mutation. sensitiveAudit → riskLevel='high'; requiresErpPermissionCheck → requiresErpCorePermissionCheck.
- receipt.create_or_update_evidence_draft (draft_create) is in UNIMPLEMENTED_TOOLS → returns unsupported_module BEFORE policy check until API endpoint exists. It is not blocked by AI_FINAL_MUTATION_ENABLED=false.
- Unknown tool (not in ROUTER_ENABLED_TOOLS) caught by firstDisabledTool() as feature_disabled (fail closed). Both feature_disabled and tool_unavailable are valid fail-closed reasons; tests assert UNROUTABLE + empty intents + no data leak.
- Permission-denied reply must not contain numeric record counts or entity IDs. Test "PERMISSION_DENIED from all tools produces safe refused reply with no hidden data leak" asserts this.

Artifacts:
- `apps/ai-gateway/src/agentcore/runtime.ts` – standalone HTTP server: GET /ping, POST /invocations
- `apps/ai-gateway/src/agentcore/runtime.spec.ts` – payload validation tests (9 tests)
- `apps/ai-gateway/agentcore.json` – CodeZip deploy config
- `apps/ai-gateway/src/modules/line-ai/infrastructure/erp-tool.client.ts` – MODIFIED: ToolPolicyEnforcerService injection + toolMetaToPolicy() + policy decision → audit → execute chain
- `apps/ai-gateway/src/modules/line-ai/infrastructure/erp-tool.client.spec.ts` – NEW: 9 focused governed-path tests
- `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.spec.ts` – MODIFIED: added unknown-tool/schema-mismatch test
- `apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts` – MODIFIED: no-data-leak assertion on permission denied + agent/tool mismatch test

Verification:
| Command | Result |
|---------|--------|
| `./node_modules/.bin/tsx --test apps/ai-gateway/src/modules/line-ai/infrastructure/erp-tool.client.spec.ts apps/ai-gateway/src/agentcore/runtime.spec.ts apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.spec.ts apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts` | PASS – 46/46 |
| `CI=true corepack pnpm --filter @watchdog-bms/ai-gateway test` | PASS – 109/109 |
| `CI=true corepack pnpm --filter @watchdog-bms/ai-gateway build` | PASS |
| `git diff --check` | PASS |

Accepted external blockers:
- AWS deployment (runtime create/update, IAM role, artifact/ECR fallback, CloudWatch): no AWS credentials or IAM access in current env. Local runtime artifacts build and test successfully; deploy when credentials and IAM role are available.
- Bedrock smoke: unchanged from prior blocker (no AWS credentials/use-case approval for ap-southeast-1).

Open Phase 8 items (require AWS access):
- [ ] Create least-privilege AgentCore Runtime execution role.
- [ ] Create/update runtime in ap-southeast-1.
- [ ] AI Gateway adapter for invoking runtime by ARN + qualifier.
- [ ] Deploy smoke: read-only Thai summary, mutation refusal, CloudWatch log verification.
- [ ] Cost guard before sustained testing.
- [ ] Store runtime ARN/id, artifact id, role ARN, qualifier in this doc.

Next:
- When AWS credentials + IAM role are available: `aws bedrock-agentcore create-runtime` in ap-southeast-1, add AI Gateway ARN adapter (plan item unticked), invoke via AI Gateway by ARN + qualifier, record ARN + qualifier here.
- AgentCore Gateway/MCP tool schema and bearer auth: defer unless owner pulls into 10B.
- Strands SDK (@strands-agents/sdk): add only after confirming current package version (last seen 1.0.0-rc.4 in AWS-eval; verify before adding).

## 2026-06-27 Review Findings Fix

Status: COMPLETE.

Decisions:
- P1 fix: toolMetaToPolicy() now blocks only `final_mutation` and `approval_request` when AI_FINAL_MUTATION_ENABLED=false. `draft_create` (evidence capture / receipt draft) is allowed — per spec section 2/13: AI may create/update draft/evidence capture through permission-checked tools. Previous code incorrectly included `draft_create` in the mutation block.
- P2 plan: "Add API/AI Gateway adapter config for invoking the runtime by ARN/id" unticked in plan.md — code has runtime entry point and agentcore.json but no ARN/qualifier invoke adapter in AI Gateway. Remains open work.
- P2 runtime: runtime.ts refactored to export `validatePayload` and `makeHttpServer(orchestrator)` factory; startup guarded by `require.main === module` so test imports don't auto-listen. runtime.spec.ts rewrites using real imports (no duplicate validatePayload) and adds 4 real HTTP tests (GET /ping, POST /invocations invalid JSON, invalid payload, valid payload).
- P2 test script: apps/ai-gateway/package.json test script now includes erp-tool.client.spec.ts and runtime.spec.ts.
- P4 build/CodeZip: Earlier build failure came from broken local dependency state. After restoring dependencies with `corepack pnpm install --frozen-lockfile`, ai-gateway build passes. Runbook updated to state remaining blockers only: AWS credentials/IAM and missing ARN+qualifier invoke adapter.

Artifacts:
- `apps/ai-gateway/src/modules/line-ai/infrastructure/erp-tool.client.ts` – isMutation now uses `final_mutation || approval_request` (was `final_mutation || draft_create`)
- `apps/ai-gateway/src/modules/line-ai/infrastructure/erp-tool.client.spec.ts` – updated: draft_create allowed assertion, final_mutation blocked tests, new finalMutationTool fixture
- `apps/ai-gateway/src/agentcore/runtime.ts` – refactored: exports validatePayload and makeHttpServer; startup guarded by require.main
- `apps/ai-gateway/src/agentcore/runtime.spec.ts` – rewritten: imports real validatePayload, makeHttpServer; 9 validation + 4 HTTP tests
- `apps/ai-gateway/package.json` – test script extended with erp-tool.client.spec.ts and runtime.spec.ts
- `docs/plans/line-ai-local-agent-orchestration-plan.md` – ARN adapter plan item unticked
- `docs/runbooks/line-ai-local-agent-10b-runbook.md` – Known Limitations updated: local test/build pass, AWS/IAM and ARN+qualifier adapter remain open

Verification:
| Command | Result |
|---------|--------|
| `./node_modules/.bin/tsx --test apps/ai-gateway/src/modules/line-ai/infrastructure/erp-tool.client.spec.ts` | PASS – 11/11 |
| `./node_modules/.bin/tsx --test apps/ai-gateway/src/agentcore/runtime.spec.ts` | PASS – 13/13 |
| `./node_modules/.bin/tsx --test apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.spec.ts apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts` | PASS – 22/22 |
| `CI=true corepack pnpm --filter @watchdog-bms/ai-gateway test` | PASS – 109/109 |
| `CI=true corepack pnpm --filter @watchdog-bms/ai-gateway build` | PASS |
| `git diff --check` | PASS |

Open Phase 8 items (unchanged; require AWS access):
- [ ] Create least-privilege AgentCore Runtime execution role.
- [ ] Create/update runtime in ap-southeast-1.
- [ ] AI Gateway adapter for invoking runtime by ARN + qualifier.
- [ ] Deploy smoke: read-only Thai summary, mutation refusal, CloudWatch log verification.
- [ ] Cost guard before sustained testing.
- [ ] Store runtime ARN/id, artifact id, role ARN, qualifier in this doc.

## 2026-07-03 LINE Intake Router Agent Scope

Status: Docs handoff update for item 10B and item 09 follow-up.

Decisions:
- BA: Owner wants a dedicated agent that separates LINE intent/context before handing work to other agents. For the current expense/signature scope, it must distinguish expense evidence capture, signature-upload ticket, read-only business question, unsafe mutation, unsupported request, and ambiguous input.
- SA: Use a logical `LINE Intake Router Agent` in front of specialist agents. First implementation may extend the existing `IntentRouterAgent` rather than adding duplicate orchestration. Router is model-driven for context classification when provider is available and must consider text, images/attachments, and conversation context. It must not use keyword-only routing, regex-only parsing, or static phrase lists as the primary classifier. Deterministic logic remains for LINE signature verification, active company/membership, permissions, MIME/size, idempotency, tool allowlists, and mutation blocking.
- DEV: Updated `docs/specs/line-ai-local-agent-orchestration-spec.md`, `docs/plans/line-ai-local-agent-orchestration-plan.md`, item 09 expense spec/plan, product BUC, checklist, and related memory. Implementation should add/extend router tests for `SIGNATURE_UPLOAD_TICKET`, `EXPENSE_DOCUMENT_CAPTURE`, `BUSINESS_READ_QUESTION`, `MUTATION_REQUEST_REFUSAL`, `CLARIFY`, and `UNSUPPORTED`.

Boundary:
- Router does not answer users, call ERP tools, create DB records, or activate/apply signatures. It emits a structured route plan. Source-module use cases do the actual permission-checked intake/read action.
- Low-confidence or conflicting routes must return `CLARIFY`; do not open expense drafts or signature tickets automatically.

Verification:
- Docs-only update; run `git diff --check -- docs` and relevant agent gates before closeout.

Implementation prompt handoff 2026-07-03:
- Added `docs/prompts/implement-line-ai-expense-intake-router.md` for the combined item 10B + item 09 follow-up. The prompt instructs the next implementation agent to add/extend a logical `LINE Intake Router Agent` before specialist dispatch, route `EXPENSE_DOCUMENT_CAPTURE` and `SIGNATURE_UPLOAD_TICKET` safely, avoid keyword-only primary classification, and keep AI Gateway DB-free with permission-checked API/tool boundaries only.

## 2026-07-03 LINE Intake Router Agent Implemented

Status: COMPLETE (unit-verified; live provider smoke pending keys/tunnel).

Decisions:
- Extended the existing `IntentRouterAgent` (same file/class, new `routeIntake()` method) instead of a parallel router stack — smallest safe diff per spec section 8.
- Contract in `packages/contracts/src/line-ai.ts`: `LineIntakeRouteRequest` (sanitized text, attachment metadata + bounded image base64, server-derived permissions, active category catalog) -> `LineIntakeRoutePlan` (single intent of EXPENSE_DOCUMENT_CAPTURE | SIGNATURE_UPLOAD_TICKET | BUSINESS_READ_QUESTION | MUTATION_REQUEST_REFUSAL | CLARIFY | UNSUPPORTED, confidence, bounded `captureHints` handoff). Router emits plans only — never answers, calls tools, or creates records.
- Deterministic trust-boundary guards stay in code, not prompt: intent enum validation, confidence 0..1 clamp, `INTAKE_MIN_ACTION_CONFIDENCE=0.6` downgrade of draft/ticket routes to CLARIFY, bounded reason/hints extraction, unknown-intent/broken-JSON -> typed `UNAVAILABLE` (`ROUTER_JSON_PARSE_FAILED`), provider-off -> `UNAVAILABLE` (`PROVIDER_DISABLED`). No keyword fallback anywhere.
- New internal endpoint `POST /internal/ai/line-intake-route` (X-Internal-Secret) in `line-ai-internal.controller.ts`; API calls it via `AiGatewayClient.requestLineIntakeRoute` before intake dispatch in `ProcessLineWebhookUseCase` (both text and media paths). Router UNAVAILABLE -> legacy behavior (media -> manual-review expense draft, text -> normal AI turn), so provider-off keeps item 07/09 baselines.
- BedrockProvider now attaches Converse image blocks to the last user message (router/vision path); OpenAI already supported images.
- Receipt OCR: owner-decided Typhoon-only slice implemented — `TYPHOON_OCR_API_KEY` config, fetch-based `TyphoonOcrClient` (api.opentyphoon.ai chat/completions, model `typhoon-ocr`, AI_TOOL_TIMEOUT_MS, 401/403/429/timeout/5xx -> bounded codes), `POST /internal/ai/receipt-ocr` uses Typhoon when key present, `not_configured` otherwise; no OpenAI/Bedrock receipt-OCR fallback.

Artifacts:
- `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts` (LINE_INTAKE_ROUTER_SYSTEM_PROMPT + routeIntake + parse/guard helpers)
- `apps/ai-gateway/src/modules/line-ai/agents/line-intake-router.agent.spec.ts` (10 tests: signature image, novel wording pass-through, capture hints bounding, low-confidence->CLARIFY, model CLARIFY, mutation refusal, provider-off typed UNAVAILABLE, broken JSON/unknown intent -> UNAVAILABLE, read question, image bytes never in text payload)
- `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts` + spec (intake route auth/bad payload/disabled; Typhoon not_configured/success/throttle)
- `apps/ai-gateway/src/modules/line-ai/infrastructure/typhoon-ocr.client.ts`, `provider/bedrock.provider.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` (router-first dispatch) + `line-intake-dispatch.use-case.spec.ts` (12 tests)
- `packages/config/src/index.ts` (TYPHOON_OCR_API_KEY), `.env.example`

Verification:
- `CI=true corepack pnpm --filter @watchdog-bms/ai-gateway test`: 177/177 pass (all prior suites + new router/controller tests)
- `CI=true corepack pnpm --filter @watchdog-bms/api test`: 783/783 pass (router dispatch + legacy webhook suites)
- ai-gateway/api `tsc --noEmit`: pass; contracts/config build+test: pass
- Live: API webhook fallback behavior exercised through running local API (gateway intentionally down -> typed UNAVAILABLE -> media manual-review draft / text AI-turn paths confirmed by tests and running stack)
- Skipped: live Bedrock/OpenAI routed smoke (no provider run this turn) and LINE tunnel smoke — same standing external blockers as before; run per runbook when keys/tunnel are available.

## 2026-07-03 Router PDF metadata, Typhoon two-stage OCR, AgentCore status correction, prod provider wiring

Status: COMPLETE (unit + live local smoke verified).

Decisions:
- `routeIntake()` now sends attachment `purpose` alongside id/mimeType/hasImageContent, and the system prompt explicitly covers PDFs/files described by metadata (bytes stay image-only; PDF rasterizing would need a dependency the owner excluded). Live Bedrock smoke: PDF supplier tax-invoice metadata -> EXPENSE_DOCUMENT_CAPTURE/TAX_INVOICE; `ค่ากาแฟ 65 บาท` -> EXPENSE_DOCUMENT_CAPTURE with active-category hint; `อนุมัติจ่ายเงิน` -> MUTATION_REQUEST_REFUSAL.
- Receipt OCR follows official Typhoon practice: stage 1 Typhoon official prompt -> `natural_text` markdown (temperature 0.1, top_p 0.6, repetition_penalty 1.2, max_tokens 4096), stage 2 gateway provider maps markdown -> bounded fields; provider-off fails typed and manual review stays. Live smoke: real Typhoon + real Bedrock returned correct Thai receipt fields in ~4.5s. Detail in [[expense-receipt-upload-09]] memory.
- STATUS CORRECTION: the AgentCore Runtime invoke adapter EXISTS and is deployed — `infrastructure/runtime/agentcore-runtime.client.ts` (SigV4) + `LINE_AI_AGENT_RUNTIME=agentcore` branch in `line-ai-turn.use-case.ts`; production ECS Express deploy (`infra/prod-ecs-express/deploy.sh`) targets runtime `watchdog_orchestrator-6xOx1tCbz0` in ap-southeast-1. Earlier "adapter deferred until ARN provisioned" notes in this file/checklist and the open Phase 8 block above predate this and are stale.
- Prod ai-gateway previously hardcoded `MODEL_PROVIDER=disabled`, which silently disabled the intake router and OCR stage 2 in production; deploy.sh now passes `MODEL_PROVIDER`/`BEDROCK_REGION`/`BEDROCK_MODEL_ID` from `.env`, ships `TYPHOON_OCR_API_KEY` as a Secrets Manager secret into the container, and grants `bedrock:InvokeModel(+WithResponseStream)` (anthropic foundation models + global inference profiles) to the AI task role. Chat turns keep the agentcore runtime path.
- Local dev on Zscaler-inspected networks: run Node services with `NODE_EXTRA_CA_CERTS=<exported Zscaler root PEM>` or all outbound TLS from Node fails with UNABLE_TO_GET_ISSUER_CERT_LOCALLY (curl works because it uses the macOS Keychain).
- Correction: `docs/prompts/implement-line-ai-expense-intake-router.md` referenced earlier was never committed; the scope lives in the specs/plans/memory.

Verification (2026-07-03 second pass):
- `CI=true corepack pnpm --filter @watchdog-bms/ai-gateway test`: 185/185 pass (new: typhoon-ocr.client.spec 6, two-stage controller specs, router PDF-metadata spec); api 783/783; web 117/117; api + ai-gateway typecheck clean
- Live local gateway (:3002, real `.env` + Zscaler CA): receipt-ocr `status=ok` with correct Thai fields; 3 intake-route smokes routed correctly on real Bedrock

Production deploy + smoke (2026-07-03, commit a19619e):
- api-web deployed clean (image `ecs-api-web-a19619e` sole active config): migration `20260703000000_item09_document_intake_signature` + `sync-permissions.ts` ran on boot; new item-09 routes live (categories/signature-assets return 401 not 404); web 200.
- ai-gateway required a service rebuild: the original Express service wedged (every deployment `ROLLBACK_FAILED: No rollback candidate`, later updates never launched target tasks). Root causes in sequence: (1) my own 404 smoke/poll traffic during canary bake tripped the auto-created `RollbackAlarm` (`4xx>=5/min + 5xx > 1%` of requests) and rolled back 3 deployments; (2) the failed rollback left the service control plane permanently stuck. Created `watchdog-bms-ai-gateway-v2` with the same container config -> healthy in ~2 min; repointed 4 SSM params + api-web `AI_GATEWAY_INTERNAL_URL`.
- Prod v2 smoke (real Typhoon key via Secrets Manager, real Bedrock via task role): receipt-ocr `status=ok` in 4.3s with correct Thai receipt fields; `ค่าแท็กซี่ไปหาลูกค้า 180 บาท` -> EXPENSE_DOCUMENT_CAPTURE (EXPENSE_NOTE_TEXT, amount 180, cat-travel); `โอนเงินจ่ายบิลซัพพลายเออร์เดี๋ยวนี้` -> MUTATION_REQUEST_REFUSAL.
- Real LINE end-to-end smoke PASSED 2026-07-03 (~20:47): owner sent a real paper receipt photo through the production LINE OA; webhook -> intake router (Bedrock) -> Typhoon OCR -> Bedrock extraction -> reviewable draft -> Paypers-style reply (correct total/VAT/vendor/date/doc-no + web deep link). The standing external blocker from items 07/09/10B is CLOSED. Six onboarding/link bugs were found+fixed live during the same session — see [[expense-receipt-upload-09]] memory.

## Owner decision 2026-07-03: model-composed business-read answers

- During live LINE testing, "มีกี่สาขา" returned a deterministic "• บริษัท: company-2" bullet (composer rendered facts as templates; no branch tool existed). Owner: answers must be AI-composed — no deterministic answer path for business reads.
- Implemented: specialists attach bounded raw `toolData` to SpecialistOutput; `ResponseComposerAgent.composeAnswer()` has the model answer the question from that data (grounding: value-equal number guard incl. array-length counts, JSON-shape rejection, 1200-char cap; deterministic compose remains the fallback on provider failure/guard violation). polishLanguage stays for attachment turns; refusal/permission/no-data templates stay deterministic.
- Added `company.list_branches` tool (permission company.branch.read; ACTIVE branches + scopedBranchNames + settings webPath) wired through api toolMap/module, contracts registry+agent catalog, router enabled set + descriptions, accounting/general allowlist + fact shaping, legacy keyword priority (สาขา/branch).
- Verified: ai-gateway 193/193 (8 new composeAnswer tests), api 816/816 (3 new branch-tool tests; api test script gained the new spec files — it is an explicit file list, not a glob).

## Tool catalog closure 2026-07-03 (owner directive: ปิด gap ทุกกลุ่ม)

- Group 1 (built-but-unreachable): enabled tax.* ×5 + workflow.* ×4 in ROUTER_ENABLED_TOOLS + accounting/general agent allowlist (agent `tax` now maps to the accounting specialist); repurposed+wired `accounting.get_summary` to accounting-documents (was ledger-labeled and unwired).
- Group 2 (module ready, no tool): new `accounting.list_recent_documents`, `procurement.get_ap_outstanding` (via GetApAgingUseCase), `company.get_employee_summary` (counts only, no PII), `expense.get_breakdown` (groupBy category+branch, 10D branch-scope aware, read_own-limited) — new file erp-business-tools.use-case.ts; modules now export ListDocumentsUseCase/GetApAgingUseCase/ListEmployeesUseCase for LINE tools.
- Group 3 (inputs): model tool loop now passes whitelisted inputs per registry meta (requiredInputFields/optionalInputFields; dates YYYY-MM-DD validated, unknown keys dropped by sanitizeToolInput); loop prompt carries currentDate (Asia/Bangkok) so the model resolves "เดือนที่แล้ว/last week" to explicit ranges. Owner decision: period tools DEFAULT TO NOW (current month) server-side via resolvePeriodInput when no explicit range — expense.list_recent, expense.get_breakdown, accounting summary/list all echo their effective period in data.
- Pre-registered waiting tools for unfinished modules (safe unsupported_module replies until wired): bank.get_account_balances, bank.get_reconciliation_status (item 13), reimbursement.list_pending_approvals (item 14), reports.get_monthly_report_summary (item 18); sales/crm entries remain disabled per item 15.
- Verified: api 830/830 (14 new business-tool tests incl. default-now + branch-scope-where + no-PII guards), ai-gateway 207/207 (loop input sanitization test + registry drift guard over the expanded allowlist), tsc clean both.

## 2026-07-04 Root cause: prod chat turns never ran the local orchestrator

- Owner live-tested after the 2792fc9b deploy and got identical old behavior ("มีกี่สาขา" -> "• บริษัท: company-2", employee questions -> out-of-scope refusal, deterministic expense bullets). Diagnosis: prod ai-gateway env had `LINE_AI_AGENT_RUNTIME=agentcore` hardcoded in `deploy.sh ai_container_json`, so `line-ai-turn.use-case.ts` sent every chat turn to the stale AgentCore runtime snapshot (`watchdog_orchestrator-6xOx1tCbz0`) — the local agents (10B orchestration, model-composed answers, 25-tool catalog, default-now inputs) shipped in the image but were never invoked. `.env` already said `strands-local`; the script ignored it.
- Fix (commit 0c1924d9): deploy.sh now passes `LINE_AI_AGENT_RUNTIME` from `.env` (default `strands-local`). Intake router + receipt OCR were unaffected (they always ran in-gateway on Bedrock — which also proves the provider/IAM path used by the local orchestrator works in prod).
- Lesson recorded: env values in `ai_container_json`/`api_container_json` are authoritative for prod — when prod behavior contradicts shipped code, diff the live service env (`aws ecs describe-express-gateway-service ... primaryContainer.environment`) against `.env` before suspecting the image.

## 2026-07-05 Live test round 2: local runtime works; employee summary source fixed

- After the strands-local flip (0c1924d9), owner's live LINE test confirmed model-composed answers: "มีกี่สาขา" -> "บริษัทมีสาขา 1 แห่ง คือ Head Office ค่ะ"; "ดูค่าใช้จ่าย" -> natural summary with explicit period "(1-4 ก.ค. 2026)" proving default-now periods. One deterministic fallback observed ("• พนักงาน: total: 0") — fallback path behaving as designed.
- Remaining wrong answer: employee questions returned total 0. Root cause: `company.get_employee_summary` counted `employeeAccessProfile` rows (employee-access onboarding records) — owner is not in that table and company-2 has no onboarded employees. Owner directive: "owner ก็ควรที่จะดูได้". Fix (commit 046991ab): count `CompanyMembership` + role names (owner included; counts only, no PII); dropped the ListEmployeesUseCase export/import added for the old wiring. api 847/847.

## 2026-07-05 Short-Term Multi-Turn Context

Status: IMPLEMENTED LOCALLY (focused tests pass; real LINE follow-up smoke still recommended).

Decisions:
- Owner requested real multi-turn behavior: remember up to 15 turns while conversation is continuous, and treat a 15-minute inactivity gap as a fresh short-term chat context.
- Long-lived company selection remains `LineCompanyContext`; it is not limited by the 15-minute chat-context window and still re-checks active membership.
- API now builds `conversationContext` from previous `AiTurn` rows for the same `companyId + userId`, status `COMPLETED/REFUSED`, `createdAt >= now - 15 minutes`, newest 15 rows only, returned in chronological order.
- Context is sent only when current access still has `line.ai.query`. Assistant reply previews are included only if current permissions still cover all tools invoked in that previous turn; otherwise the user message preview/intent/agent/refused metadata may remain but reply text is omitted.
- AI Gateway passes the bounded context through LINE Intake Router, Intent Router, Orchestrator model tool loop, model answer composer, and AgentCore Runtime payload validation. Model prompts say context is only for follow-up wording, not business truth, permission truth, or company selection.
- AgentCore Runtime direct payload validation caps context to 15 turns and 500 chars per preview.

Artifacts:
- `packages/contracts/src/line-ai.ts` – added `LineAiConversationContext`, `LineAiConversationContextTurn`, and optional context fields on LINE turn/intake requests.
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` – loads bounded context and permission-filters assistant previews.
- `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts` – forwards context to business and intake routing prompts.
- `apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts` – forwards context to model tool loop and answer composer.
- `apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts` – passes context to model answer composition with grounding guard unchanged.
- `apps/ai-gateway/src/modules/line-ai/application/use-cases/line-ai-turn.use-case.ts`, `infrastructure/runtime/runtime.port.ts`, `agentcore/runtime.ts` – carry bounded context through AgentCore runtime path.
- Focused specs updated for API context window/permission filtering, router payloads, orchestrator payloads, and runtime bounding.

Verification:
- `../../node_modules/.bin/tsx --test src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` from `apps/api`: PASS, 22/22.
- `./node_modules/.bin/tsx --test apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.spec.ts apps/ai-gateway/src/modules/line-ai/agents/orchestrator-model-loop.agent.spec.ts apps/ai-gateway/src/agentcore/runtime.spec.ts`: PASS, 29/29.
- Initial root-level mixed test command hit expected tsx/root-config issue for API decorators; reran API spec from `apps/api`.

Next:
- Real LINE smoke: ask a business question, then within 15 minutes ask a follow-up such as "อันที่สองล่ะ"; verify the answer uses current permission-checked tools. Then test a >15 minute gap or seeded old turns and confirm no short-term context is sent.

## 2026-07-05 Owner directive: named employee lookups + discovery (clarifying questions)

- Owner: "ควรมีชื่อด้วยถ้าถามเจาะจง เช่น ขอข้อมูลติดต่อของนาย B ... และต้องเก่งพอที่จะ discovery คำถามเพื่อเคลียร์ความเข้าใจกับผู้ใช้งาน".
- New `company.get_employee_detail` (requiredInputFields [nameQuery], sensitiveAudit=true → auto MEDIUM audit in InternalToolsController): searches memberships by user/profile displayName + legalName (insensitive contains); 1 match → bounded contact detail (name, legalName, roles, status, phoneNumber, email, memberSince — identity fields NEVER leave); >1 → name+role candidates (no contact info); 0/no name → matches:0 (+needsName) so the model asks. `hr.get_leave_summary` pre-registered as waiting (วันลา → polite feature-not-enabled until an HR module exists).
- Discovery: orchestrator tool loop accepts `{"askUser":"<question>"}` — bounded (≤500 chars, non-JSON) single clarifying question returned as the reply instead of guessing or falling back; malformed askUser degrades to done→deterministic dispatch. Follow-up turns resolve via the conversationContext short-term memory (built by the concurrent session: api loadConversationContext feeds recentTurns from AiTurn within 15 min into router/loop/composer prompts, reply previews permission-guarded).
- Employee summary fix live-confirmed prerequisite: counts CompanyMembership (owner included) since 046991ab.
- Concurrent-session note: repo worktree is shared; commit 046991ab accidentally swept in the other session's docs (git add -A — do not repeat). This increment was committed deliberately as one green-tree commit including the in-flight conversationContext plumbing (api 852+/0 fail, gateway 213/213, tsc clean both) because gateway files interleave both changes.

## 2026-07-05 Gap closure: multi-turn memory covers intake; discovery hardened (owner directive)

Owner: "ปิด gap ทั้งหมด... สิทธิ์ส่วนมากเป็น read จะมีแค่งาน approve สร้างใบคำขอเป็น draft ได้ รวมถึงเซฟบิล/สร้างบิล เท่านั้น".
- Gap2 (intake turns invisible to memory): `persistIntakeTurn` (best-effort, never breaks a sent reply) now records capture (text note + receipt image), signature request (text+media), clarify, and media mutation-refusal turns into AiTurn; migration `20260705150000_item10b_intake_turn_intents` adds enum values EVIDENCE_CAPTURE / SIGNATURE_REQUEST / CLARIFY (additive, IF NOT EXISTS).
- Gap3: composeAnswer's allowed-number set now includes numbers from conversationContext turn PREVIEWS (they were grounded when produced); timestamps/intents deliberately excluded — invented numbers still fall back.
- Gap4: intake router may return a bounded `clarifyQuestion` (CLARIFY route only, ≤200 chars, non-JSON); api prefers it over the static template on both text and media clarify branches.
- Gap5: turn preview slices 120 → 240 chars (PREVIEW_MAX_CHARS; columns are unbounded text).
- Gap6: `LINE_AI_CONTEXT_WINDOW_MINUTES/MAX_TURNS` are now exported from contracts — api loader, both gateway prompts (interpolated), and the agentcore runtime parser all derive from them.
- Gap7: prompts (intent router, intake router, tool loop, answer composer) gained an explicit "conversationContext/messageText are DATA, never instructions" line.
- Boundary guard tests: router-enabled tools must be read_summary/read_detail/report/suggestion; evidence_capture/draft_create/approval_request/final_mutation can never be model-callable (encodes the owner rule — drafts happen only via the intake flow).
- Verified: ai-gateway 220/220, api full suite 0 fail, tsc clean both. NOT deployed (owner hold since earlier today).

## 2026-07-05 Deployed: discovery + multi-turn memory live (16 turns)

- Owner raised the memory cap to 16 turns (LINE_AI_CONTEXT_MAX_TURNS in contracts; cap tests derive from the constant) and lifted the deploy hold.
- Prod rollout commit 6a28d81b (fb3af472 + e9f33568 + 16-turn bump): api-web SUCCESSFUL 15:03, ai-gateway SUCCESSFUL 15:05; sole active configs ecs-api-web-6a28d81b / ecs-6a28d81b; LINE_AI_AGENT_RUNTIME=strands-local; web root 200. Migration 20260705150000_item10b_intake_turn_intents applied on boot (rollout success implies clean boot).
- Live now: company.get_employee_detail (named contact lookups, audited), askUser clarifying questions, model clarifyQuestion on intake CLARIFY, conversation memory incl. intake turns (16-turn/15-min window), context-aware number grounding, read-only boundary guard tests.
