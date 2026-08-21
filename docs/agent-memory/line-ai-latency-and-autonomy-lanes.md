# Agent Memory: line-ai-latency-and-autonomy-lanes

Status: Phase 0–2 code IMPLEMENTED default-off and verified with focused tests/typechecks, then
hardened by FOUR corrective review rounds — round 1 (loading ordering, acceptedAt anchoring,
deterministic boundary, receiver validation, trace milestones), round 2 (per-batch loading
ownership + concurrency test, backstop strictly past the boundary with generation guard + tick-fired
timer tests, parser deep-rebuild + refined zero-call semantics, real `line.ai.stage`/`turn_summary`
seams, false-doc-claim removal), round 3 (timer stale-callback ownership fix + white-box test,
removal of the lumped `dispatchMs` aggregation, turn_summary model identity + distinct `fallbackReason`,
memory reconciliation), and round 4 (P1 default-off wait-status anchor gated on the loading-on-accept
flag, api_trace.loadingRequested from actual bound loading, overlapping-batch loading re-show,
cohort key aligned to company+chat, config default-off tests).

Phase 3 producer + Phase 4 TRUE deterministic execution lane are now IMPLEMENTED default-off (a controller
correction rejected an earlier router-skip-only attempt that ignored `proposedCalls.input`, still ran the
model loop + ResponseComposer, hardcoded the intake intent, and only RECORDED security gaps). The real
lane: `IntentRouterAgent.routeIntake` emits an optional bounded prepared plan (static glossary + tool
catalog in cacheableContext, dynamic data in the DATA message, invalid wrapper discarded). Intake
provenance is NOT trusted from the wrapper: the API binds the outer route intent onto a separate
`LineAiTurnRequest.intakeIntent`, re-validated by explicit membership at every API→Gateway→AgentCore
receiver; the orchestrator gate requires `request.intakeIntent === 'BUSINESS_READ_QUESTION'`. The lane
re-parses + re-validates the wrapper, requires the sanitized input to EXACTLY equal the proposed input
(any change → fall back before any call), executes EXACTLY the sanitized `proposedCalls[0].input` through
the owning specialist (one call), and answers via a COMPILED deterministic formatter (or an authoritative
deterministic terminal for non-success) — no router.route, native/model loop, critic, or composer (proven
by method-call counters, not fetch alone). All 23 security/source cases EXECUTE against the real
orchestrator+ERP boundary (zero recorded gaps). One compiled family
(`sales.get_sales_summary::single_metric`) is real but default-off (empty operator allowlist → no family
active). Every flag remains default off; the effective 2,500 ms path and processing-start loading are
unchanged when off. No behavior enablement, hosted baseline/cohort/shadow, full-flow provider evidence, or
deploy has been done. Spec/plan/eval manifest remain the source of truth.
Owner: thawatchai.phuchana
Scope: Employee LINE AI latency, measured 1,000/1,500 ms buffer candidates, loading-on-accept, fused prepared plan,
simple-read autonomy lane, protected complex/capture fallbacks, and quality/cost/latency evaluation.
Decisions:
- User proposed 1,500 ms, then reopened the value for discussion. Current code remains 2,500 ms.
  Recommendation: compare 1,000 ms primary and 1,500 ms conservative candidates, select the smallest
  value inside fragment/re-ask/cost gates; 750 ms is an offline lower-bound fixture only.
- Keep Sonnet 4.6 in the first implementation; reduce serial model calls before model tiering.
- Reuse `AgentIntentPlan`, registries, specialists, access normalization, composer, and existing
  operator runner. Add one optional prepared-plan wrapper only.
- A prepared plan has no authorization power; every existing security/source boundary is repeated.
- Simple eligible read target: one model call, no critic/composer. Complex/capture routes keep their
  full intelligence path.
- Ingress/buffer/LINE timing is an API trace, not `LineAiStageDurations`.
- `1,500 ms` remains a conservative candidate, not the recommended default: it consumes half of the
  3-second simple-read p50 budget before model/tool work. Select 1,000 ms only after a stable, powered
  cohort passes absolute and non-inferiority gates; otherwise use 1,500 ms.
- Fused intake carries bounded business, casual/capability, and semantic-refusal `AgentIntentPlan`
  shapes. Initial actor delegations remain all currently authorized/entitled tools so prepared-plan
  validation failure can fall back without losing intelligence.
- Complex five-call flow is an ideal happy path, not a hard cap. Runtime structural budget and observed
  replay counts govern complex execution.
- The eval file is an expectation manifest, not provider/full-flow evidence: 103 route/path rows,
  23 security/source cases, 38 matched timing rows, and six controlled-attachment requirements.
- Claude and Codex agree on 1,000 ms as the primary experiment candidate, 1,500 ms conservative,
  2,500 ms control, and 750 ms offline-only. This is not a production conclusion before telemetry.
- User selected 1,000 ms as the primary experiment candidate after the joint review.
- Bubble semantics are normative: `gap <= debounce` joins; `gap > debounce` splits; max wait remains
  eight seconds; idle commands are immediate with no loading; media text becomes `captionText`.
- Server derives lanes only from verified invariants. Model confidence is veto-only at 0.85 and cannot
  grant execution authority; response mode and answer shape remain advisory.
- Debounce cohorts are collected concurrently and analyzed at the `(company, chat)` cluster with a
  design-effect-adjusted sample and Holm-adjusted one-sided bounds; product selection evaluates
  1,000 ms first and considers 1,500 ms only as a predeclared independently passing fallback.
- Protected journeys are frozen before shadow. Fixed factual/source fixtures require 100%; blind
  casual/formatter comparison requires at least three ratings per row, 30 paired ratings per
  language/family stratum, and a one-sided lower preference bound >=0.50 overall and per language.
- Claude's fresh five-file review found no P0/P1 and confirmed the prior contract/statistics/metric
  closures. Its six P2s were then applied: exact 96+7 provider target, frozen latency-affecting flags,
  defined reject-before-tool behavior, 30-rating language/family minimum, exact corpus counts, five
  context fixtures, and a route-level permission-denied case.
Open questions:
- Which exact high-volume tool family is the first deterministic formatter canary after pairwise eval?
- Hosted p50/p95/p99 and split-utterance baseline remain to be measured before implementation rollout.
Implementation (Phase 0–2, default-off, no deploy):
- Phase 2 contract: `LineAiPreparedPlan`/`LineAiPreparedCall` types in
  `packages/contracts/src/line-ai.ts`; optional `preparedPlan?` added to `LineIntakeRoutePlan` and
  `LineAiTurnRequest`. Bounded parser `parseLineAiPreparedPlan` + `LINE_AI_PREPARED_PLAN_BOUNDS` in
  new `packages/contracts/src/line-ai-prepared-plan.ts` (version==1, ≤32 KiB, plain-object, depth 4 /
  32 keys / 50 items / 512 UTF-8 bytes, reject prototype + scope/credential input keys, unknown-tool
  reject, confidence bounded [0,1] veto-only never recomputed; returns undefined→fallback). Threaded
  optional+re-bounded through gateway turn use case → `AgentCoreInvokeInput` → runtime `validatePayload`
  + `payloadToTurnRequest`. Runtime contract version NOT bumped (additive/optional). API client already
  forwards via spread (producer side is Phase 3).
- Phase 1: config `LINE_AI_LOADING_ON_ACCEPT_ENABLED`, `LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED`,
  `LINE_AI_DEBOUNCE_EXPERIMENT_SECRET` (all default off/unset). Pure `debounceCohortMs` (HMAC of the
  cluster key `${companyId}:${chatId}` — company+CHAT per spec §10, NOT the buffer key which is
  chat+user; cohorts 1000/1500/2500, returns only the ms, no id/hash logged; off/no secret/no company →
  configured). Wired per-chat via `ChatState.debounceMs`; `preflightLegalAcceptance`
  now returns `companyId` on the resolved `continue` path so the buffer has the cohort key. Loading-on-
  accept fires once per opened buffer (1:1, non-command) before the debounce wait; idle command/group
  unchanged. Deterministic `gap<=debounce` join already held by `nextFlushDelayMs`.
- Phase 0: API-only `LineAiApiTrace` + `buildLineAiApiTrace` in the buffer logic — ingress/buffer/queue
  ONLY (acceptedAtMs, bufferWaitMs, queueWaitMs; NO lumped dispatch duration), separate from runtime
  `LineAiStageDurations`; buffer service emits `line.ai.api_trace` per dispatched group (guarded, no raw
  text/LINE id, correlated by webhookEventId). The precise downstream durations are `line.ai.stage`
  (intake_route/gateway_turn/persistence/line_delivery) plus `line.ai.turn_summary`, both emitted by the
  use case (see item-5 note below). `startLoadingAnimation` returns acceptance; buffer emits
  `line.ai.loading_started`/`loading_accepted` server timestamps.
- Known simplifications: api_trace is one-per-content-group (multi-media group collapses N media turns
  into one trace); loading_started/accepted are server-side only (device visibility stays UAT). Prepared
  plan is parsed-and-threaded but nothing produces it yet (Phase 3) or executes the simple lane (Phase 4).

Corrective items (describing the FINAL code after all four correction rounds — no superseded intermediate
state is claimed here):
- Loading ownership (item 1, final): accept-loading is NOT a global ChatState slot. It is bound to the
  open buffer (`state.openLoading`), moves into `pendingMeta.loading` on flush, and is consumed exactly
  once per batch in `dispatchBatch` (before ANY of the batch's groups) via `consumeBatchLoading`, which
  awaits it and emits `loading_accepted`. So the request and loading_accepted are ordered strictly
  before every final of that batch (even debounce=0/fast turns); a later batch never overwrites or
  cross-consumes it (each batch's `meta.loading` is its own); it is fired only when a non-command opens
  a buffer with no pending batch (coalesced, preserved through merge); the first content turn skips the
  duplicate processing-start loading only when acceptance was true (else it may retry).
- acceptedAt anchoring (item 2): acceptEvent now returns the exact durable-acceptance instant (captured
  at each success/reclaim), threaded onto every buffer item (LineBufferItem.acceptedAt), preserved as
  ChatState.firstAcceptedAt / pendingMeta.firstAcceptedAt through open+pending+merge; the API trace
  bufferWait anchors to first acceptance. The long-wait status timer anchors to acceptance ONLY when
  lineAiLoadingOnAcceptEnabled is ON (delay = max(0, firstAcceptedAt + 2000 - now)); with that flag OFF
  it keeps the exact legacy 2 s from processing start (see round-4 P1 below), so a large configured
  debounce never collapses the wait status to immediate.
- Deterministic boundary (item 3, final): appendAccepted decides gap<=debounce join vs gap>debounce
  split by comparing the new item's acceptedAt against ChatState.scheduledFlushAt (a pure function of
  accepted times via nextFlushDelayMs), flushing the open buffer on arrival rather than relying on
  timer-callback ordering. The quiet-buffer backstop timer is armed at scheduledFlushAt+1 (strictly
  past the boundary) with an ownership guard: the callback checks its captured `flushGeneration` FIRST
  and returns without touching state if stale, so a cleared-but-queued callback cannot erase the live
  timer reference. Tests ACTUALLY fire timers with mock-timer `tick` (tick 1000 → join, tick 1001 →
  split), plus a white-box regression firing a stale captured callback to prove it cannot disable the
  current schedule.
- Prepared-plan receivers (item 4): re-parse/rebuild at EVERY receiver — API requestLineIntakeRoute
  (intake response), gateway turn ingress executeInner (covers agentcore + local + deterministic paths),
  AgentCore validatePayload. Raw enum casts removed via an inSet type-guard over explicit allowed-sets
  (intent/subject/agent/reason/status/complexity/responseMode/answerShape). Phase-2 STRUCTURAL
  invariants now enforced at parse for a plan that claims simple: confidence veto floor, exactly one
  intent, <=1 call, exact tool==requiredTools equality + registered read category; a zero-call simple
  plan is allowed ONLY for casual_conversation/capability_help or an explicit refusal (forged
  read_summary with zero tools rejected). Untrusted tool input is deep-rebuilt (mutation-isolation).
- Trace instrumentation (item 5): api_trace gains the immutable acceptedAtMs anchor (ingress/buffer/
  queue only, no dispatch). ProcessLineWebhook emits DISTINCT `line.ai.stage` durations for the seams
  the API observes — intake_route, gateway_turn, persistence, line_delivery — plus one
  `line.ai.turn_summary` (webhookEventId+requestId) after delivery with intent,
  refused/refusalReason/errorCode, a DISTINCT `fallbackReason` (always null — not observable, never
  conflated with refusal/error), modelProvider + modelIds (from response modelLineage/usage),
  modelCallCount, toolCallCount, deliveryResult, usage input/output tokens, and explicit null for lane
  (Phase 4) and costSatang (metered in recordCompanyAiUsage). Accurate store map: persisted `AiTurn`
  (webhookEventId) holds
  intent/agent, refused/refusalReason/errorCode, observabilityJson(stageDurationsMs, modelCallCount) —
  NOT lane, NOT usage/cost, NOT requestId; gateway `ai.turn.complete` (requestId) has per-model-call
  detail; `line.ai.terminal` (webhookEventId) is the terminal outcome CLASS, not the raw reply/push
  mode (that is in turn_summary.deliveryResult). Remaining limit: finer per-model-call/per-tool
  sub-durations are the runtime `stageDurationsMs`/gateway leg; fused-plan-vs-lane timing is Phase 3+.

Artifacts:
- `docs/specs/line-ai-latency-and-autonomy-lanes-spec.md`
- `docs/plans/line-ai-latency-and-autonomy-lanes-plan.md`
- `scripts/line-ai-latency-autonomy.corpus.ts`
- `scripts/line-ai-latency-autonomy.corpus.spec.ts`
- `packages/contracts/src/line-ai-prepared-plan.ts` (+ `.spec.ts`)
- `apps/ai-gateway/src/modules/line-ai/domain/logic/prepared-simple-read.logic.ts` (+ `.spec.ts`) — Phase 4 eligibility
- `apps/ai-gateway/src/modules/line-ai/agents/prepared-simple-read-formatter.ts` (+ `.spec.ts`) — Phase 5 compiled formatter registry
- `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts` — Phase 3 fused producer (cacheableContext + optional prepared plan)
- `apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts` — Phase 4 execution lane
- `apps/ai-gateway/src/modules/line-ai/domain/logic/session-affinity.logic.ts` (+ `.spec.ts`) — Phase 6 privacy-safe derivation
Verification:
- Final confirmation: Claude Code 2.1.234, exact main `claude-fable-5 --effort max`, no configured
  fallback/substitution, read-only five-file review, `success/end_turn`. Verdict PASS with no
  P0/P1/blocking P2; Phase 0 GO, behavior enablement and canary/production remain NO-GO pending hosted
  baseline, shadow, full-flow/provider, attachment-harness, gate, and signed deployment evidence.
- P1/P2 closure check: `pnpm exec tsx --test scripts/line-ai-latency-autonomy.corpus.spec.ts
  scripts/line-ai-operator-language.corpus.spec.ts` -> 5/5 tests pass. The latency manifest is 103
  route/path + 23 security/source + 38 timing = 164 ids; the substitute-routing corpus (47 rows) was later
  UNIONED into `LINE_AI_PROTECTED_EVAL_CASE_IDS`, so the combined protected set is 164 + 47 = 211/211 unique
  ids (verified). `git diff --check` -> pass.
- `pnpm exec tsx --test scripts/line-ai-latency-autonomy.corpus.spec.ts scripts/line-ai-operator-language.corpus.spec.ts` -> 5/5 tests pass.
- From `apps/api`: `pnpm exec tsx --test src/modules/line-ai/domain/logic/line-message-buffer.logic.spec.ts src/modules/line-ai/application/line-message-buffer.service.spec.ts` -> 46/46 tests pass.
- `git diff --check` -> pass.
- A direct root-level service-spec attempt failed because root `tsx` did not load the API
  `experimentalDecorators` tsconfig; rerunning from `apps/api` used the repository's correct config and
  passed. This was a runner invocation issue, not a product failure.
- Claude Code 2.1.234 was invoked read-only with exact main model `claude-fable-5 --effort max`, no
  configured fallback, and no edit/cloud/web tools. It completed 34 tool turns but produced no final
  before safe interruption at about ten minutes (`aborted_streaming`; main-model cost about $3.59).
  The independent consolidated review found no P0 and its P1/P2 corrections were applied: fallback
  delegation, truthful evidence labels, complex budget, fused zero-tool contract, security suite,
  powered matched debounce cohorts, waiting-order semantics, server/device SLO distinction, ordered
  repeated calls, and explicit feature flags.
- At the user's request, a second tightly bounded Claude run continued until a real final: Claude Code
  2.1.234, exact main `claude-fable-5 --effort max`, no configured fallback, five read-only files,
  `success/end_turn`, 11 turns, 173.6 seconds API duration, cost about $1.53. Verdict `CONDITIONAL`:
  approve 1,000 ms as primary candidate, not production default. Its remaining findings were applied:
  explicit outer `UNSUPPORTED` versus prepared zero-tool intent, runtime `captionText`, equality boundary,
  idle-command no-loading, server-side metric name, four missing media/command timing journeys,
  multi-instance contamination exclusion, and integrity-simulator disclaimer.
- Post-review reconciliation passed after correcting the two-media fixture to emit the same caption for
  both runtime media segments; the reviewing agent reran the focused corpus test at 3/3 and reported PASS.
Phase 0–2 implementation verification (2026-08-20, Opus 4.8, no deploy):
- `pnpm -C packages/contracts build` → clean; `pnpm exec tsx --test packages/contracts/src/line-ai-prepared-plan.spec.ts` → 19/19.
- `pnpm -C packages/config build` → clean; `pnpm -C packages/config test` → 3 files / 121 tests pass.
- `pnpm exec tsx --test scripts/line-ai-latency-autonomy.corpus.spec.ts` → 3/3 (unchanged manifest).
- Gateway (`apps/ai-gateway`): `runtime.spec.ts` + `line-ai-turn.use-case.spec.ts` → 67/67; full `pnpm test` → 599/599; `line-ai-internal.controller.spec.ts` → 50/50; `tsc --noEmit` (main + `tsconfig.agentcore.json`) → 0 errors.
- API (`apps/api`): `line-message-buffer.logic.spec.ts` + `line-message-buffer.service.spec.ts` + `line-reply.adapter.spec.ts` → 65/65; `process-line-webhook.use-case.spec.ts` → 81/81; webhook controller + intake dispatch → 101/101; all line-ai module specs → 565/565; `tsc --noEmit` → 0 errors.
- `git diff --check` → clean. `apps/web/next-env.d.ts` was already modified at session start and was NOT touched.

Corrective-round-2 verification (2026-08-20, Opus 4.8, no deploy) — closes the 4 rejected blockers:
- Blocker 1 (per-batch loading ownership): loading bound to open buffer → pendingMeta.loading →
  consumed once in dispatchBatch before the batch's finals; no global slot. New concurrency test:
  batch1 blocked with two groups while batch2 arrives — each loading has its own webhookEventId, none
  overwritten/cross-consumed, each awaited before its batch's finals.
- Blocker 2 (backstop strictly past the boundary + generation guard): backstop timer armed at
  scheduledFlushAt+1 with a stale-generation/open-state guard. New tick-based tests ACTUALLY fire
  timers: tick to exactly 1000 does not flush (join); tick to 1001 fires the backstop (split).
- Blocker 3 (deep rebuild + zero-call semantics): parser deep-rebuilds every nested input array/object
  (mutation-isolation tests); zero-call simple allowed only for casual_conversation/capability_help or
  an explicit refusal (forged read_summary rejected). Comments corrected.
- Blocker 4 (real Phase-0 seams): `line.ai.stage` durations for intake_route/gateway_turn/persistence/
  line_delivery + a `line.ai.turn_summary`; false doc claims removed (AiTurn does NOT hold lane/usage/
  cost/requestId; terminal is outcome-class not raw delivery mode).
- Contracts build clean; `line-ai-prepared-plan.spec.ts` → 27/27; corpus → 3/3.
- Gateway (`apps/ai-gateway`): `runtime`+`turn` → 67/67; `tsc --noEmit` main + agentcore → 0 errors.
- API (`apps/api`): buffer logic+service → 69/69; `process-line-webhook.use-case.spec.ts` → 82/82;
  every line-ai module spec (non-ledger) + webhook controller → 526/526; ledger → 45/45; `tsc --noEmit`
  → 0 errors.
- Config build clean; `git diff --check` → clean. `apps/web/next-env.d.ts` untouched. (No claim about
  the full API suite runtime is made — it was not run to a grepped summary this round.)

Corrective-round-3 verification (2026-08-20, Opus 4.8, no deploy) — supersedes prior test-count
snapshots; closes the final controller items A–E:
- A: scheduleFlush backstop callback now checks its captured `flushGeneration` FIRST and only clears the
  timer reference if it still owns the current schedule (fix: a stale cleared-but-queued callback could
  previously null the live timer). White-box regression added firing a stale callback.
- B: removed the lumped dispatch aggregation entirely — no `dispatchMs` on `LineAiApiTrace`, no
  dispatchStart/End params on `buildLineAiApiTrace`; callers/tests/docs updated.
- C: `line.ai.turn_summary` now includes `modelProvider` + `modelIds` (derived from response
  modelLineage/usage, null when absent) and a DISTINCT `fallbackReason:null`; test fixtures assert the
  actual model ids.
- D/E: corrected all summary/trace comments and reconciled this memory — no `ChatState.acceptLoading`
  global-slot / `setTime`-without-firing / dispatch-seam claims remain; only the final code/tests are
  described.
- Contracts build clean; parser `line-ai-prepared-plan.spec.ts` → 27/27; corpus → 3/3.
- API: buffer logic+service → (incl. the new stale-callback test) pass; use-case → 82/82; all line-ai
  module specs (non-ledger) + webhook controller → 527/527; ledger → 45/45; `tsc --noEmit` → 0 errors.
- Gateway: full suite → 599/599; `tsc --noEmit` main + `tsconfig.agentcore.json` → 0 errors.
- `git diff --check` → clean; `apps/web/next-env.d.ts` untouched.

Corrective-round-4 verification (2026-08-20, Opus 4.8, no deploy) — one P1 default-off regression + P2/cohort:
- P1 (default-off regression, fixed): the long-wait status timer anchored to firstAcceptedAt
  unconditionally, so with all new flags OFF and debounce 2,500 ms the legacy 2 s status became
  immediate. Now the acceptance anchor applies ONLY when lineAiLoadingOnAcceptEnabled is on; otherwise
  the exact legacy 2 s-from-processing-start is preserved. Regression test: debounce 2,500, flags off →
  no immediate status, status after exactly 2 s from processing start, ordered before final.
- P2(a): api_trace.loadingRequested now reflects the batch's actual bound accept-loading
  (`meta.loading != null`), not a config/oneToOne guess. Tests: flag off/on, group, and a text turn in a
  no-loading (command-opened, merged-while-busy) batch → false.
- P2(b): a batch whose accept-loading spinner is dismissed by a prior batch's final now re-shows
  processing-start loading instead of suppressing it (`BatchLoading.firedDuringProcessing`). Overlap
  regression asserts the re-show; per-batch loading_accepted-before-own-final ordering preserved.
- P2(c): config tests prove all three new settings default OFF and unset, and enabling the experiment with
  a missing secret keeps the configured debounce path; buffer test confirms no-secret → configured.
- Cohort alignment: cohort assignment key changed from company+chat+user to company+chat
  (`${companyId}:${chatId}`) per spec §10 cluster; buffer isolation stays chat+user. Regression: two
  users in one group share the cohort while their buffers stay isolated. No ids logged.
- Date.now/NTP monotonic timer re-arm intentionally NOT changed (no tiny safe existing-pattern fix;
  would expand scope) — noted as a residual risk.
- Verification: config → 124/124; API buffer logic+service → 76/76 (incl. the 6 new tests); all line-ai
  module specs (non-ledger) + webhook controller → 533/533; ledger → 45/45; `tsc --noEmit` API + gateway
  → 0 errors; `git diff --check` clean; `apps/web/next-env.d.ts` untouched.

Fable-PASS residuals + Phase 3–6 locally-implementable scope (2026-08-20, Opus 4.8, default-off, no deploy):
- Residual P2(1) — per-segment loadingRequested: `emitApiTrace` now sets `loadingRequested = group.kind
  !== 'command' && meta?.loading != null`, so a command segment inside a mixed batch that DID bind accept-
  loading still reports false for that segment. Regression added (mixed text+command batch).
- Residual P2(2) — cohort freeze per open batch: the debounce cohort key is computed ONLY when a new open
  batch starts (`state.firstAcceptedAt === null`) and frozen for the whole batch; a later bubble resolving
  a different authoritative company can no longer re-assign an already-open batch. (company, chat) is the
  cluster (different authoritative companies in one group = different clusters); an unresolved company
  stays on the configured debounce; chat+user buffer isolation is unchanged. Tests: group users resolving
  different companies, unresolved-company stays configured, freeze-through-open-batch.
- Phase 3 SHADOW (default off, `LINE_AI_FUSED_PLAN_SHADOW_ENABLED`): `OrchestratorAgent.maybeShadowCompare
  PreparedPlan` logs `line.ai.fused_plan.shadow` with only status/intent/tool MATCH booleans + requestId —
  synchronous, try/caught, never awaited on the critical path, no execution effect, no raw ids/text.
  API forwards the intake route's already-parsed `preparedPlan` into the turn. The producer prompt now
  instructs the model to emit `preparedPlan` (see the Phase 3 PRODUCER bullet); the remaining gate is
  configured-provider QUALITY evidence (does a live model emit correct, gate-respecting plans), which the
  shadow flag exists to gather before Phase 4 ever executes.
- Phase 3 PRODUCER (real, prompt + code): `IntentRouterAgent.routeIntake` now (a) rides the static
  glossary + bounded tool catalog as `cacheableContext` and keeps only per-request data in the DATA
  message (cache-stable prefix); (b) `LINE_INTAKE_ROUTER_SYSTEM_PROMPT` INSTRUCTS the live provider to
  optionally emit the exact bounded `preparedPlan` schema (version/complexity "simple"/responseMode/
  answerShape single_metric|list/intentPlan/proposedCalls with exact `requiredTools==[tool]==proposed
  Calls[0].toolName`), copying tool/subject/agent VERBATIM from the enabledFeatures catalog. The catalog
  now also exposes each tool's `requiredInputFields`/`optionalInputFields` (e.g. sales fromDate/toDate),
  so "fill only the fields the tool declares" is GROUNDED — the model copies input field NAMES from the
  catalog (dates only as valueCandidate isoDates; NEVER a branch/company/scope/permission field even if
  listed — the parser's FORBIDDEN_INPUT_KEY also rejects those). A refusal turn uses the EXACT parser-
  valid zero-tool shape (one `{intent:"unknown",subject:"unknown",agent:"general",requiredTools:[]}` +
  one contract refusal). It spells out every omission gate (attachment / clarification / missing or
  ambiguous context / >1 intent or tool / comparison-analysis-mixed / mutation / document-capture-
  correction-signature / human review / low confidence / any invented value → OMIT); and (c) parses that
  optional `preparedPlan` via `parseLineAiPreparedPlan` (invalid or gate-violating → discarded, route
  preserved). It binds NO provenance into the wrapper — the low-confidence capture/CLARIFY rewrites
  return before the attach, so those never carry a prepared plan. Prompt-contract tests inspect the
  ACTUAL system prompt + the shipped cacheable catalog (naming AND input-field authority) to prove the
  model is instructed to emit the exact bounded schema and omission gates (not parsed from invented
  output); parse/attach regressions cover the read, casual/capability, and the exact refusal shape, plus
  a one-call-gate discard.
- TRUSTED PROVENANCE (P0 fix): the untrusted wrapper NEVER carries authorization-relevant intake
  provenance (`parseLineAiPreparedPlan` drops any `intakeIntent` a forger injects). Instead the API binds
  the already-parsed OUTER `LineIntakeRoutePlan.intent` onto a SEPARATE `LineAiTurnRequest.intakeIntent`
  (validated by the shared `asIntakeRouteIntent` membership check). Every receiver re-validates it with no
  unsafe cast: API bind (process-line-webhook), gateway ingress (`line-ai-turn.use-case` alongside the
  wrapper re-parse), and the AgentCore runtime (`validatePayload`/`payloadToTurnRequest`). No contract
  version bump (additive optional field). Eligibility requires `ctx.intakeIntent === 'BUSINESS_READ_
  QUESTION'` sourced from `req.intakeIntent`, never the wrapper, never hardcoded.
- Phase 4 TRUE EXECUTION (default off, `LINE_AI_PREPARED_SIMPLE_READ_ENABLED`): `OrchestratorAgent.execute
  PreparedSimpleRead` runs BEFORE `route()`. It re-parses the wrapper, re-runs `preparedSimpleReadEligib
  ility` (reads `req.intakeIntent`; family gate = ACTIVE compiled key), re-normalizes access (subject/
  permission/entitlement via `normalizePlanToolAccess`), sanitizes `call.input` with the existing whitelist
  + value/date guards, then requires EXACT deep-canonical equality between the proposed and sanitized input
  — ANY change (dropped unknown key, rejected/unbacked date, coercion, nesting) logs `…fallback` reason
  `input_sanitizer_changed` and returns null (ZERO calls), never strip-and-execute. It checks pre-call
  delegation presence and the specialist allowlist, then executes EXACTLY one specialist call with the
  UNCHANGED sanitized input (existing direct-toolInput pattern; never re-derived from text). A verified
  success answers via the COMPILED formatter; any PRE-call failure returns null → fresh non-narrowed
  `route()` (zero prepared calls). A non-success/unverifiable POST-call outcome returns an AUTHORITATIVE
  deterministic terminal (`preparedTerminalReply`, Thai/English, no fabricated facts/source/completion) —
  NO ResponseComposer/router/critic/model and no duplicate tool execution.
- Compiled formatter (new `agents/prepared-simple-read-formatter.ts`): exact `${tool}::${answerShape}`
  registry with ONE real family `sales.get_sales_summary::single_metric` — grounded Thai/English total,
  source ref, as-of (carried via new optional `SpecialistOutput.asOf`, set by the two specialists), and
  link; honest zero for explicit-empty; `unverified` when the total is absent. Non-success uses
  `preparedTerminalReply`. `activePreparedFamilies` = compiled ∩ operator allowlist; env NARROWS only
  (default empty → nothing active).
- API forwarding independence (bugfix): forwarding OR-gated `(shadow || preparedSimpleRead)` so the two
  lanes are independent; the trusted `intakeIntent` is bound SEPARATELY (from the outer route) in the same
  gated block, never taken from the wrapper.
- Phase 4 SECURITY EXECUTION — **REMOVED 2026-08-21, never executed.** The spec below was never listed
  in `apps/ai-gateway`'s `test` script and root `scripts/*.spec.ts` is wired into no runner either, so
  none of the assertions described here ever ran. It also broke the release: it imported the corpus from
  the repo-root `scripts/` directory, which no app image copies, so `turbo run build` failed inside the
  ai-gateway image (UAT run 32436479992). The file was deleted on owner instruction. **The 23 security
  cases have no executing test today.** What it CLAIMED to prove, kept for whoever re-establishes it:
  it drove ALL 23 `LINE_AI_
  PREPARED_PLAN_SECURITY_EVAL_CASES` through the REAL OrchestratorAgent lane with a call-counting ERP
  double and a failing model wire (so any fallback routes to UNROUTABLE and calls zero tools). 19 reject/
  fallback cases reach the ERP ZERO times; 4 source-honesty cases run exactly one call and return an
  authoritative terminal (explicit-empty shows 0; unavailable/failure/partial never fabricate a number).
  For every 1-call case the test asserts, via prototype method-call counters (NOT fetch alone),
  `ResponseComposer.compose === 0`, `CoverageCritic.judge === 0`, and `IntentRouter.route === 0`. NO case
  is a recorded gap. Plus: eligible Thai + English serving (one ERP call, exact sanitized input, all three
  counters 0, source/as-of/link); trusted-provenance tests (a forged/missing `req.intakeIntent` makes ZERO
  calls even with a valid wrapper, only a server-bound BUSINESS_READ_QUESTION activates); sanitizer
  exact-equality regressions (unknown key / invalid date / unbacked date / nested value → ZERO calls,
  fallback `input_sanitizer_changed`); default-off; env-narrowing.
- Phase 5 (default empty, `LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES`): the compiled formatter + fixed
  fixtures are REAL and enableable ONLY for the compiled family by listing its exact key. NO family is
  enabled by default; ENABLING one still requires the plan's mandatory blind pairwise Thai/English eval
  (≥3 ratings/row, 30 paired/language-family, one-sided 95% LB ≥0.50) vs the live Sonnet composer + human
  raters — provider/eval-blocked. Empty allowlist ⇒ eligibility always fails ⇒ the lane is dormant.
- Phase 6 (three separate default-off flags): `LINE_AI_PROVIDER_CLIENT_REUSE_ENABLED`, `LINE_AI_AGENTCORE_
  SESSION_AFFINITY_ENABLED`, `LINE_AI_SMALL_ROUTER_SHADOW_ENABLED`. Locally-provable piece: pure `derive
  SessionAffinityToken` — HMAC over the length-prefixed (company, chat) cluster, opaque 128-bit hex, never
  raw ids or HMAC bytes; undefined when off/unconfigured (unchanged cold path). Distinct clusters get
  distinct HMAC PRE-IMAGES; token inequality then follows from SHA-256 collision resistance (softened from
  a never-collide claim). NO-GO for live wiring: client reuse, the AgentCore session header, and the
  smaller-router shadow all need measured prompt-cache/throttle/latency/cost proof before capacity change.
- Verification (2026-08-20, Opus 4.8; after the P0 corrections, the real producer-prompt round, AND the
  catalog-input-fields + parser-valid-refusal addendum): gateway line-ai + agentcore → 732/732 (incl. 7
  prompt-contract + read/casual/refusal parse-attach + 1 one-call-gate discard); full gateway suite →
  872/872; API line-ai → 582/582; contracts → 167/167 (prepared-plan 30); config → 122/122; corpus → 3/3;
  `tsc --noEmit` contracts+config+api+gateway → 0 errors; `git diff --check` clean; no package.json /
  Prisma schema / migration edits. `apps/web/next-env.d.ts` was already modified at session start (Next.js
  dev/prod types-path churn) and was NOT touched by this session.

Fable FINAL CONDITIONAL review — latency/autonomy P1/P2 fixes applied (2026-08-20, Opus 4.8, no deploy):
- P1-1 DEFAULT-OFF PROMPT/COST (shared with substitute routing): the intake router prompt is a
  capability-gated builder `intakeRouterSystemPrompt({fusedPlan?, substituteSemantic?})`; with no caps it is
  BYTE-FOR-BYTE identical to the pre-feature HEAD baseline (proven once via a runtime probe) and permanently
  guarded. The ~21KB fused catalog + preparedPlan section and maxTokens 1500 appear ONLY when fusedPlan is
  on (API sets it = fusedPlanShadow OR preparedSimpleRead); legacy keeps glossary-in-DATA + maxTokens 1000.
  Post-review RUNTIME receiver-boundary hardening: `capabilities` is bound at the gateway HTTP edge by
  `asIntakeRouterCapabilities` (own literal-true only, Object.hasOwn) in BOTH the `line-intake-route`
  controller and `routeIntake` — a truthy non-boolean / unknown / nested / `__proto__` body can no longer
  coerce fusedPlan on (the old `!!` is gone); receiver tests prove malformed input stays default-off.
- P2-A: loading-on-accept now also requires the master LINE_AI_LOADING_ANIMATION_ENABLED (sub-feature gate);
  test proves the accept flag alone shows no spinner + no loading_started telemetry.
- P2-B: the wait-status timer re-times from durable acceptance ONLY when the accept spinner was actually
  SHOWN (suppressLoading), not merely when the flag is on — a REJECTED accept-loading (or a re-show at
  processing start) falls back to the legacy fixed 2 s from processing start, never collapsing to immediate
  at a large debounce. Two fake-timer tests (accepted→immediate re-time, rejected→legacy 2 s).
- P2-C: the prepared sales formatter now STATES the period — preferring the validated proposed input
  (fromDate/toDate), falling back to the tool-echoed data.period, and NEVER fabricating one (omits when
  neither names a period). Thai single-date, English range, default-period, and omit fixtures.
- P2-D: the prepared lane requires deterministic date backing — `preparedAllowedDates` ALWAYS includes today
  (unlike the lenient loop `allowedLoopDates` which is undefined without candidates), so a model-invented
  date with no candidate backing is dropped by the sanitizer and the lane falls back BEFORE any tool call.
- P2-E: the turn_summary `lane` comment is truthful — `lane` is null because the gateway RESPONSE does not
  expose which internal lane served the turn (observable only in gateway prepared_simple_read.* logs), NOT
  because lanes are unimplemented (the prepared lane is live behind the families allowlist).
- P2-F: the three Phase 6 flags are marked RESERVED/INERT in both the config schema and the getters — they
  parse and expose getters but have no runtime consumer yet.

Residual / still evidence-gated (not code): the producer CODE and PROMPT are implemented (the prompt
instructs the exact bounded schema + omission gates, proven by prompt-contract tests; parse/bind/attach
tested with mocked responses) — what remains is CONFIGURED-PROVIDER QUALITY evidence: whether a live model
actually emits correct, gate-respecting prepared plans at acceptable precision/recall (shadow-metrics, no
provider run done here). Phase 4 execution code stays default-off. Phase 5 family ENABLEMENT needs the
blind pairwise eval; Phase 6 live wiring (client reuse / AgentCore session header / smaller-router shadow)
needs measured latency/cost.
Do not enable any flag or deploy without the hosted baseline, powered cohort, shadow, and full-flow/
provider evidence the gates require.
