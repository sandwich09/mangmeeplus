# Agent Memory: line-ai-multi-intent-completion

Status: **Phases 0–3 implemented and green 2026-07-07** (docs-first pass same day). Phase 4 (quickReply) not started — owner UX taste. Remaining: dev-OA manual journeys; prod rollout checks at deploy time.
Owner: thawtchai
Scope: Item 10F — multi-intent completion for LINE AI: native tool-use loop (provider port + orchestrator), coverage critic, Redis Streams turn ledger with BullMQ reclaim + push follow-ups, Thai value normalizer (money + dates) with input/output membership guards and a 3-tier discovery policy.

Decisions:
- 2026-07-07 owner: architecture = tool-use loop (C) + coverage critic; ledger = Redis Streams (not Postgres table); canonical date convention = วัน/เดือน/ปี พ.ศ. (interpretation default + clarify/assumption display; wire/storage stays ISO CE); discover money/dates when ambiguous or unmappable — never guess.
- Implementation deviations (all recorded in the plan): normalizer lives in `packages/contracts/src/line-ai-value-normalizer.ts` (not apps/api) because the gateway-side OCR cross-check needs the same grammar — one pure zero-dep implementation, two consumers; drain follow-ups serialize per chat within a batch (not through the in-memory buffer — webhook-dedup collision); follow-up turns not persisted to AiTurn; media-path CLARIFY does not ledger (text path does).
- Ledger design: consume-on-append (entries enter the PEL immediately) → PEL is always exactly the open set; XAUTOCLAIM(min-idle 120 s) is the single reclaim mechanism for turns AND sub-requests; waiting_user entries only expire in the drain (in-window redeliveries are skipped without counting).
- Loop dedupe key = tool + canonical JSON input (identical repeat → error tool_result; different input allowed — period comparisons). Out-of-allowlist call → error tool_result, loop continues. ask_user wins over critic needs_user as THE one clarify; deferral copy says "ask again" (no push promise — honest with ledger off).
- Critic: ≤2 judge calls per turn (initial + refresh after the single uncovered-resume) so ledger acks reflect final facts; judges after budget exhaustion too; fail-open.

Open questions: none blocking. Phase 4 quickReply = owner taste; reclaim cadence env-tunable after dev-OA observation.

Artifacts:
- Code: `packages/contracts/src/line-ai-value-normalizer.ts` (+spec); contracts line-ai.ts (valueCandidates, openClarifications, coverage); gateway intent-router guards + orchestrator native loop + coverage-critic.agent.ts + provider port/bedrock/openai/disabled generateWithTools + OCR cross-check in line-ai-internal.controller.ts; api line-ai-ledger.service.ts (+spec), drain-line-ledger.use-case.ts (+spec), line-ai-ledger-internal.controller.ts, process-line-webhook wiring (+spec additions); workers line-ai-ledger-worker.ts; config envs + getters; `SMOKE_SCENARIO=multiintent` in line-webhook-local-smoke.ts.
- Docs: specs/line-ai-multi-intent-completion-spec.md; plans/line-ai-multi-intent-completion-plan.md (phase checkboxes + deviations updated); adr/0010, adr/0011; master checklist item 10F.
- Flags (all default-safe): `LINE_AI_TOOLUSE_LOOP_ENABLED=false`, `LINE_AI_COVERAGE_CRITIC_ENABLED=true` (native path only), `LINE_AI_LEDGER_ENABLED=false`; envs `LINE_AI_LEDGER_MAXLEN=200/TTL_SECONDS=86400/CLAIM_MIN_IDLE_MS=120000/DELIVERY_CAP=3`, workers `LINE_AI_LEDGER_RECLAIM_INTERVAL_MS=60000`.

Verification (2026-07-07):
- Suites green: contracts 24, config 46, ai-gateway 266 (was 222), api 1104 (was 1078); typecheck clean contracts/config/api/ai-gateway/workers. Flag-off byte-equivalence: pre-existing suites pass untouched + explicit no-native-wire test.
- Live: (1) `aws bedrock-runtime converse` + the real BedrockProvider adapter on pinned `global.anthropic.claude-haiku-4-5-20251001-v1:0` — 2 PARALLEL toolUse blocks, full toolResult round-trip to a grounded end_turn answer; (2) ledger lifecycle against real Redis 7 (docker-redis-1): min-idle respected, crash-resume reclaim with delivery count 2, ack empties PEL, waiting_user attach, TTL, audit mirror.
- Live-Redis findings fixed/accepted: ioredis needs `enableOfflineQueue: true` + `commandTimeout: 2000` (offline-queue-off rejects first commands while connecting — false failure on healthy Redis); real `MAXLEN ~` is approximate (small streams overshoot until a radix node fills; TTL bounds them; the unit fake trims exactly = stricter).
- pnpm isolation: apps/api had to DECLARE `ioredis@^5.4.0` (same as workers; lockfile already had 5.11.1 — no new fetch).

Next: (1) dev-OA manual journeys with `LINE_AI_TOOLUSE_LOOP_ENABLED=true` + `LINE_AI_LEDGER_ENABLED=true` (`SMOKE_SCENARIO=multiintent` helper ready); (2) prod rollout at deploy time — read-only `describe-security-groups` formality + post-flip runtime smoke via logs/audit only (canary: never probe during bake); (3) optional Phase 4 quickReply on owner go.
