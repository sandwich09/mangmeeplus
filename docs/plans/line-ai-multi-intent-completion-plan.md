# LINE AI Multi-Intent Completion Implementation Plan

## Status

Docs-first pass authored 2026-07-07 after owner decisions (native tool-use loop + coverage critic; Redis Streams turn ledger; canonical Thai date = วัน/เดือน/ปี พ.ศ.; discovery over guessing).

**Implemented 2026-07-07: Phases 0–3 complete and green** (Phase 4 optional, not started). Suites: contracts 24, config 46, ai-gateway 266, api 1104 — all pass; typecheck clean on contracts/config/api/ai-gateway/workers. Live verification: (1) Bedrock Converse `toolConfig` on the pinned `global.anthropic.claude-haiku-4-5-20251001-v1:0` issued 2 PARALLEL toolUse blocks in one turn and completed the toolResult round-trip through our adapter; (2) ledger lifecycle (append→PEL→reclaim-with-delivery-count→ack, waiting_user attach, TTL, audit mirror) verified against a real local Redis 7. Implementation deviations from this plan are recorded inline per phase below. Remaining: dev-OA manual journeys and the Phase-3 prod rollout checks (deploy-time).

## Linked Spec

- Spec: [[specs/line-ai-multi-intent-completion-spec|LINE AI Multi-Intent Completion and Value Grounding Spec]]
- Roadmap/checklist item: 10F
- Related ADRs: [[adr/0010-line-ai-turn-ledger-redis-streams|ADR 0010]], [[adr/0011-line-ai-value-normalization-and-thai-date-canon|ADR 0011]]
- Related plans: [[plans/line-ai-local-agent-orchestration-plan|10B Plan]], [[plans/line-ai-message-buffering-plan|Buffering Plan]]

## Purpose

Make one multi-command LINE sentence end honestly per sub-request (answered / one clarify / explicit deferral with push follow-up), and block the hallucinated-value class for Thai money/dates by letting the model select from deterministic candidates instead of converting numerals — while keeping every existing safety boundary (allowlists, sanitizer, grounding, budgets, fail-closed, no mutations).

## Current Repository Context

- `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts`: `route()` already emits a multi-intent plan; `routeIntake()` + `parseIntakePlan()` validate capture hints (shape only — no value membership today).
- `apps/ai-gateway/.../agents/orchestrator.agent.ts`: JSON one-tool-at-a-time loop; `available.delete(toolName)` forbids calling the same tool twice; no coverage check; `plan.intents[].priority` unused; fallback chain modelLoop → dispatchByPlan.
- `apps/ai-gateway/.../agents/response-composer.agent.ts`: output number guard (`numericValues`/`allowedNumbersFromData`) — pattern to mirror on the input side.
- `apps/ai-gateway/.../infrastructure/provider/`: `provider.port.ts` is `generateText` only; Bedrock/OpenAI/Disabled implementations; factory fails safe.
- `apps/api/src/modules/line-ai/`: `domain/logic/` pure-file convention (`line-message-buffer.logic.ts` — time injected, no framework imports); buffer service per-chat serialization + shutdown flush; `deliverReply` push fallback; internal endpoints pattern.
- `apps/workers/src/modules/ai-draft/ai-draft-worker.ts`: BullMQ repeatable job → worker-token drain endpoint — the exact pattern for the reclaim worker.
- `packages/config`: `REDIS_URL` already in schema with default (API does not consume it yet); env-var + `AppConfigService` getter convention from the buffering plan.
- `packages/contracts/src/line-ai.ts`: turn/intake types, `LINE_AI_CONTEXT_WINDOW_MINUTES = 15`.
- Known dependency: `bullmq` already pulls `ioredis` into the workspace — reuse `ioredis` in apps/api (already-installed-dependency rung; no new package).
- Open implementation risks: recorded in Risks below (Bedrock toolConfig support on the pinned model, critic latency, Redis lifecycle in Nest).

## Implementation Rules

- Follow `docs/plans/master-implementation-checklist.md`.
- Ponytail full: shortest correct diff, reuse existing helpers/patterns, no new dependency, one runnable check per non-trivial change.
- Keep AI Gateway stateless and DB/Redis-free; all state lives in apps/api.
- Never move final mutations into LINE/AI paths; ledger follow-ups are read/draft only.
- Every new prompt carries the DATA-not-instructions line; every new boundary fails closed (values/tools) or fails open with audit (ledger availability), exactly as the spec assigns.
- Do not implement outside the phase scope; each phase ships green independently.

## Scope

### In Scope

- Value normalizer + candidates contract + input/output guards + discovery policy (money, dates).
- Provider port tool-use extension (Bedrock Converse, OpenAI) + native orchestration loop + `ask_user` synthetic tool + coverage critic, behind flags with the full fallback chain.
- Redis Streams turn ledger + drain endpoint + BullMQ reclaim worker + push follow-ups + clarify waiting/expiry + audit mirroring.
- Optional Phase 4: LINE quickReply clarify buttons; web assumption-note copy.

### Out of Scope

- Prisma migrations; tool contract changes; new permissions; multi-instance buffer redesign; OCR provider changes; CRM (15A) agents.

## Phase 0: Discovery and Alignment

### Goal

Confirm provider tool-use support and current-suite green before touching code.

### Tasks

- [x] Read spec + ADRs 0010/0011 + this plan; re-inspect the four gateway files and buffer service listed above (concurrent sessions may have moved them).
- [x] Verify the pinned Bedrock model id supports Converse `toolConfig` — live-verified 2026-07-07 via `aws bedrock-runtime converse` on `global.anthropic.claude-haiku-4-5-20251001-v1:0` (ap-southeast-1, profile watchdog-bedrock): `stopReason=tool_use` with TWO parallel toolUse blocks in one turn.
- [x] Confirm `ioredis` resolves from the workspace lockfile — finding: pnpm's isolated node_modules means apps/api must DECLARE `"ioredis": "^5.4.0"` (same specifier as apps/workers; resolves the already-locked 5.11.1, no new fetch). Declared in Phase 3.
- [x] Baseline: all four suites green (contracts 0 tests at baseline, config 46, ai-gateway 222, api 1078).

### Exit Criteria

- Tool-use support confirmed or blocker recorded; baselines green. **Met.**

## Phase 1: Value Grounding (no infra)

### Goal

Block the hallucinated money/date class end to end with pure logic + guards; ship independently of the loop/ledger.

### Tasks

- [x] `packages/contracts/src/line-ai.ts`: `LineAiValueCandidates`, `LineAiTurnRequest.valueCandidates?`, `LineIntakeRouteRequest.valueCandidates?`.
- [x] Normalizer implemented as `packages/contracts/src/line-ai-value-normalizer.ts` — **deviation from the planned apps/api path, on purpose**: the OCR cross-check (spec §13) needs the same grammar inside the gateway where Typhoon's `documentText` lives, and contracts already ships runtime values (LINE_TOOL_REGISTRY). One pure zero-dependency implementation, two consumers; `today` injected. All planned grammar shipped (Thai digits, Thai/English number words, currency tokens incl. unknown `$B`-style, §7 date rules in order, month-period boundaries, `span`+`assumptions` on every candidate, one BE↔CE helper).
- [x] Wired once per turn in `process-line-webhook.use-case.ts` (`computeValueCandidates` after `normalizeLineText`; media captions too) — same guarantee as "at buffer flush" with a smaller diff; original text untouched.
- [x] Gateway input guards: `parseIntakePlan` membership by numeric value / isoDate with ambiguity→CLARIFY downgrade naming the readings (`formatDateClarifyQuestion`); `sanitizeToolInput` explicit-date membership (candidates ∪ today) — relative periods untouched.
- [x] Output guard: composer allowed set gains candidate values, day/month numbers, and both BE and CE years.
- [x] Prompt lines added (intake + JSON loop + native loop + OCR stage-2 copy-exact rule).
- [x] OCR cross-check `applyOcrValueCrossCheck`: stage-2 numeric fields must exist in stage-1 OCR text (normalizer word-forms ∪ uncapped digit scan); `expenseDate` must match an unambiguous reading; failures drop to `missingFields` (NEEDS_REVIEW).

### Tests

- [x] Normalizer golden table (24 tests incl. the full §15 list) + span property test; intake guard strip/pass/CLARIFY paths (7); loop date-membership (4); composer candidate additions (4); OCR cross-check (6); api wiring — same candidates on both payloads, omitted when value-free (2).

### Exit Criteria

- Corrupted model values cannot reach drafts/tool inputs; all suites green; typecheck clean. **Met** (gateway 243 → contracts 24 at this phase).

## Phase 2: Native Tool-Use Loop + Coverage Critic (gateway)

### Goal

Multi tool calls per model turn with per-call guardrails, coverage judged per sub-request, all behind flags with today's behavior as fallback.

### Tasks

- [x] `provider.port.ts`: tool-use types + optional `generateWithTools` (optional keeps existing single-method stubs compiling; "not implemented" = not capable → fallback). Bedrock Converse (`toolConfig`/`toolUse`/`toolResult`, parallel blocks, stopReason mapping, same error mapper), OpenAI Responses function calling (`tools`/`function_call`/`function_call_output`), DisabledProvider → typed PROVIDER_DISABLED. Wire tool names map dots→`__` (both providers require `^[a-zA-Z0-9_-]{1,64}$`).
- [x] Native loop behind `LINE_AI_TOOLUSE_LOOP_ENABLED` (default false): parallel execution per model turn (Promise.all), per-call allowlist violation → tool_result error (loop continues), `sanitizeToolInput` per call, dedupe = tool + canonical JSON input (identical repeat → error result; different input allowed), `plan.intents` ride as `subRequests` checklist (priority finally used), synthetic `ask_user` tool. Every requested call gets a tool_result back (wire contract), incl. budget-rejected ones; assistant/user alternation preserved on the Converse wire.
- [x] Coverage critic behind `LINE_AI_COVERAGE_CRITIC_ENABLED` (default true): judges when the model stops AND after budget exhaustion (bounded ≤2 judge calls/turn); uncovered re-enters the loop once while budget remains; failure → fail-open warn. Verdicts refresh after a resume so the ledger acks against final facts.
- [x] Response contract: `AgentRunResult.coverage` + `LineAiTurnResponse.coverage`; deterministic reply assembly appends at most ONE clarify (loop ask_user wins over critic needs_user) + the honest deferral line. Deferral copy says "ask again" (no push promise — stays honest even before Phase 3 flips on).
- [x] Fallback chain preserved and tested: native (flag + capable + no early provider failure) → JSON loop → `dispatchByPlan`. Flag-off byte-equivalence proven by the untouched pre-existing suite (222 tests) plus an explicit no-native-wire test.

### Tests

- [x] All planned: parallel multi-call; same-tool-twice different input + identical-repeat block; budget cap + honest deferral; out-of-allowlist error result; ask_user; critic parse/resume/fail-open (13 loop/critic tests); provider adapters (6); coverage passthrough on the turn use case (2). Live smoke through the real Bedrock adapter completed the full round-trip (2 parallel calls → toolResults → grounded end_turn answer).

### Exit Criteria

- 3-command golden sentence fully answered with flags on; flags off reproduces today's suites unchanged. **Met** at agent level + live adapter round-trip (dev-OA end-to-end pending, see Integration Verification).

## Phase 3: Redis Streams Ledger + Reclaim (api / workers)

### Goal

Ordered, ack-based, crash-surviving completion: nothing asked is ever silently lost.

### Tasks

- [x] `apps/api` `LineAiLedgerService` (ioredis via `REDIS_URL`, dependency declared in apps/api per Phase-0 finding; `onModuleDestroy` quit; flag default false; every Redis error → log-warned no-op, never user-facing): append `turn` pre-gateway; ack post-persist; `coverage` → `sub_request` entries; `XADD MAXLEN ~` (default 200); TTL refresh-on-write; audit mirror `ai.line.ledger.*` on every transition. **Design detail:** entries are consumed into the group PEL on append ("consume-on-append"), so the PEL is always exactly the open set and XAUTOCLAIM(min-idle) is the single reclaim mechanism for turns AND sub-requests. **Live-Redis findings baked in:** ioredis needs `enableOfflineQueue: true` + `commandTimeout` (offline-queue-off rejects first-commands while connecting — a healthy-Redis false failure caught by the live smoke); real `MAXLEN ~` is approximate (small streams overshoot until a radix node fills — accepted; TTL bounds them).
- [x] Inbound-turn hook: bounded open `waiting_user` entries attached as `LineAiTurnRequest.openClarifications` (new contract type, also on the intake route request + both gateway payloads/prompts as DATA); after the turn completes they are acked — resolved, or carried over as fresh `uncovered` entries by the critic, so nothing waits forever. The intake CLARIFY route (text path) also appends its own `waiting_user` entry. Expiry acks (`clarify_expired`) live in the drain.
- [x] `POST /internal/ai/line-ledger/drain` (worker token, batch bound ≤50): XAUTOCLAIM (min-idle default 120000; XREADGROUP-new unnecessary under consume-on-append); per entry re-resolve user status + `resolveAccess` + `line.ai.query` → scoped follow-up turn → push via `sendPush` to the chatKey → ack `followed_up`; cap breach → `parked`; revoked access → `refused` (DENIED audit). **Deviation:** follow-ups serialize per chat within a drain batch (grouped), not through the in-memory buffer — enqueueing into the buffer would collide with webhook dedup semantics; interleaving with a live turn is cosmetic on a read-only channel. Follow-up turns are not persisted to AiTurn (context window doesn't include them) — revisit if dev-OA UX wants it.
- [x] `apps/workers/src/modules/line-ai-ledger/line-ai-ledger-worker.ts` repeatable BullMQ job (`LINE_AI_LEDGER_RECLAIM_INTERVAL_MS`, workers schema, default 60000) → drain endpoint; registered in `main.ts`.
- [x] `packages/config`: `LINE_AI_LEDGER_ENABLED/MAXLEN/TTL_SECONDS/CLAIM_MIN_IDLE_MS/DELIVERY_CAP` (api schema) + reclaim interval (workers schema) + `AppConfigService` getters (`redisUrl`, ledger group).
- [ ] Prod rollout checks (verified 2026-07-07: `infra/prod-ecs-express/deploy.sh` already injects `REDIS_URL` via Secrets Manager into all three task definitions — watchdog-api, ai-gateway, watchdog-workers — and `validateProductionConfig` already requires it for the API): (a) Redis reachability is inherited, not new: prod Redis is ElastiCache (`watchdog-bms-prod-redis`) and `prod-ecs-express/deploy.sh` applies ONE shared app security group + network config to every service, so the workers' daily BullMQ connections already prove the path the API will use — keep a single read-only `describe-security-groups` confirmation as a formality; (b) after flipping `LINE_AI_LEDGER_ENABLED=true`, one runtime smoke via logs/audit — at least one successful append and no `ai.line.ledger` warns — because the ledger is fail-open and a broken connection is silent by design. Observe via logs/ECS API only during canary bake (no endpoint probing).

### Tests

- [x] Ledger service against an injected fake Redis (10 tests: consume-on-append, ack, waiting attach/expiry-skip, min-idle + delivery counts, coverage mapping, MAXLEN, fail-open, flag-off, field round-trip); drain (9: skipped-when-off, follow-up round trip w/ candidates + push + ack, expiry, park, revoked permission, inactive user, gateway-throw leaves unacked, crash-resume turn re-run with original webhookEventId) + controller token auth (2); webhook wiring (4: append-before-gateway + ack-after-persist + coverage mapping, gateway-throw keeps entry open, openClarifications attach/ack, intake-CLARIFY waiting entry).
- [x] **Live integration smoke against real Redis 7 (docker-redis-1)**: full lifecycle green — fresh entry respects min-idle, unacked turn reclaimed with growing delivery count (crash-resume), ack empties the PEL, waiting_user surfaces with its question, TTL applied, audit actions mirrored.

### Exit Criteria

- Budget-deferral follow-up and kill-mid-turn recovery pass locally; ledger empty (all acked) after each scenario. **Met** at unit + live-Redis level (dev-OA push round-trip pending a running OA).

## Phase 4 (optional, owner taste): Clarify Quick Replies + Web Copy

### Tasks

- [ ] `line-reply.adapter.ts`: attach LINE `quickReply` items when a clarify carries enumerated choices (flag `LINE_AI_QUICK_REPLY_ENABLED`, default false).
- [ ] Web expense review: render assumption notes on NEEDS_REVIEW drafts (copy only).

### Exit Criteria

- One-tap clarify answer resolves the waiting_user entry end to end on dev OA.

## Integration Verification

Status 2026-07-07 (implementation pass):

- [x] Backend/API contract: candidates + openClarifications + coverage round-trip API↔gateway — contract-shape tests on both sides (api wiring specs; gateway payload/passthrough specs).
- [x] Commands run green (Node 22 via nvm PATH): `pnpm -C packages/contracts test` (24), `pnpm -C packages/config test` (46), `pnpm -C apps/ai-gateway test` (266), `pnpm -C apps/api test` (1104), `typecheck` clean on contracts/config/api/ai-gateway/workers.
- [x] `SMOKE_SCENARIO=multiintent` added to `line-webhook-local-smoke.ts` (item-10F golden sentence + expected log/audit signals).
- [x] Live smokes: Bedrock Converse toolConfig round-trip through the real adapter (parallel calls → grounded answer); ledger lifecycle against real local Redis 7.
- [x] Error/permission degrade paths exercised in tests: Redis-down turn proceeds (fail-open), provider-disabled falls back typed, revoked-permission follow-up refuses safely; loading animation untouched.
- [ ] LINE journey on dev OA (manual, needs running OA + services): (1) 3-command Thai sentence → ordered full answer; (2) low `AI_MAX_TOOL_CALLS` → subset + deferral → push follow-up arrives; (3) "บันทึกบิล 9/11/37 หกสิบบาท แล้วยอดขายวันนี้" → sales answered + one clarify → answer resolves → draft shows 60 + assumptions; (4) kill API mid-turn → restart → reclaim answers. Flags to flip for the session: `LINE_AI_TOOLUSE_LOOP_ENABLED=true`, `LINE_AI_LEDGER_ENABLED=true`.
- [ ] E2E/browser: existing web review click-through for assumption notes (Phase 4, optional).
- Deploy note: prod is ECS Express canary with rollback alarm — do not probe endpoints during bake; verify via ECS API + one 200 after stable (see deploy runbook/memory).

## Risks

- Pinned Bedrock model/AgentCore path may not support Converse toolConfig → Phase 0 verifies; fallback chain keeps shipping value regardless.
- Critic adds one model call (~1–2 s) per multi-intent turn → acceptable within buffering UX + loading animation; measure on dev OA; kill switch `LINE_AI_COVERAGE_CRITIC_ENABLED`.
- First Redis client inside apps/api (lifecycle, ECS networking) → fail-open design, flag default off, single connection, `onModuleDestroy` quit.
- At-least-once duplicate push if crash lands between push and ack → accepted (read-only channel), visible in audit.
- Canonical D/M + BE defaults can mis-read genuinely MM/DD foreign documents → accepted by owner; assumptions recorded; review path catches.

## Open Questions

- None blocking. Phase 4 quickReply is optional pending owner UX preference; reclaim cadence defaults are env-tunable after dev-OA observation.
