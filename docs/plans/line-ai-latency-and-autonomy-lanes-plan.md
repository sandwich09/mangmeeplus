# LINE AI Latency and Autonomy Lanes Implementation Plan

For proposed reliability v2 work, apply the [reliability spec](../specs/mangmee-ai-understanding-and-advisor-reliability-spec-th.md) §§2/20/20.1 and its [plan](mangmee-ai-understanding-and-advisor-reliability-plan-2026-09-26.md) Phase4: preserve quality against the intelligence-enhanced candidate before speed optimization, keep native enablement separately gated, and validate proposed v2 round/deadline budgets before replacing existing bounds. This adds no runtime activation.

## Current evidence reconciliation — 2026-09-26

The implementation-status block below is a historical checkpoint, not current enablement truth. Existing Phase0 traces and hosted Production/UAT baseline from2026-09-03 are real. Fresh read-only checks found AgentCore Productionv12/UATv33 on sourcea2b926c6 with prepared enabled/four families; UAT application hosts were stopped. AiTurn runtime timings exist, but current full LINE end-to-end coverage and eligible prepared hit rate remain unproved. Production Kamal log groups changed and current scoped read access is denied; UAT native deployment config does not add the Production awslogs driver. Continue this plan by reconciling existing collectors/access/correlation/coverage/reporting, not creating a second timing system. See [live evidence](../research/mangmee-ai-live-timing-readback-2026-09-26-th.md).

## Status (historical implementation checkpoint)

Phases 0–2 plus the real Phase 3 producer and Phase 4 deterministic simple-read EXECUTION lane are
code-implemented DEFAULT-OFF and verified (an earlier router-skip-only Phase-4 attempt was rejected and
replaced): `routeIntake` emits an optional bounded prepared plan (glossary/tool catalog in
cacheableContext); the untrusted wrapper carries NO provenance — the API binds the outer route intent onto
a separate `LineAiTurnRequest.intakeIntent`, re-validated at every receiver; the lane requires exact
sanitizer equality (any change → fall back before any call) and executes exactly one specialist call
answered by a compiled deterministic formatter (or authoritative deterministic terminal), skipping
router.route/model-loop/critic/composer (proven by method-call counters); all 23 security/source cases
execute at the real orchestrator+ERP boundary. One compiled family
(`sales.get_sales_summary::single_metric`) is real but default-off. The producer CODE + PROMPT are
implemented (the intake prompt instructs the bounded prepared-plan schema + omission gates, prompt-contract
tested). Still evidence-gated, not code: configured-provider QUALITY of emitted plans, Phase 5 family
enablement (blind pairwise eval), and Phase 6 live wiring (measured latency/cost). Every new flag defaults off and the effective 2,000 ms / processing-start-
loading path is unchanged when off. No behavior enablement, hosted baseline/cohort/shadow, full-flow/
provider evidence, or deployment has been performed. The user selected 1,000 ms as the primary experiment
candidate. Live implementation state lives in [[../agent-memory/line-ai-latency-and-autonomy-lanes|the task memory]].

## Linked Spec

- [[../specs/line-ai-latency-and-autonomy-lanes-spec|LINE AI Latency and Autonomy Lanes]]
- [[../specs/line-ai-message-buffering-spec|LINE AI Message Buffering and Turn Serialization]]
- [[../specs/line-ai-operator-intent-and-answer-depth-spec|LINE AI Operator Intent and Answer Depth]]

## Objective

Evaluate **1,000 ms** and **1,500 ms** buffer candidates against the 2,000 ms baseline, select the
smallest safe value, make 1:1 waiting feedback start after durable acceptance, and reduce eligible
simple business reads to one Sonnet model call while preserving the current full agentic, capture,
security, grounding, and audit paths.

## Ponytail Decision

- Reuse `AgentIntentPlan`, `LINE_TOOL_REGISTRY`, access normalization, sanitizers, specialists,
  response composer, usage meter, and operator corpus/runner.
- Add one optional prepared-plan wrapper; do not create another router/executor hierarchy.
- Keep Sonnet 4.6 for the first implementation.
- No dependency, `package.json`, database schema, ERP repository, or direct Gateway database change.
- Implement provider reuse/session affinity/model tiering only after the primary call-count win is
  measured.

## Phase 0: Baseline and Trace Contract

- Add structured API end-to-end timing for durable acceptance, loading request, buffer/queue wait,
  intake route, Gateway, persistence, and LINE delivery.
- Preserve runtime-owned `LineAiStageDurations`; do not put pre-Gateway timings into that type.
- Record lane, prepared-plan version, model/tool call counts, fallback reason, usage, and cost.
- Capture p50/p95/p99 by journey, single/multi-intent, model-call bucket, tool-count bucket, delivery
  mode, and success/refusal/timeout outcome.
- Emit the spec-defined loading-start/accepted, completed-intent, duplicate-answer, wrong-tool, and
  grounded-accuracy events; keep device-visible loading as controlled UAT evidence only.

Exit: hosted baseline identifies the full waterfall without raw message text or LINE ids.

## Phase 1: Waiting Feedback and Debounce Selection

- Start one coalesced 1:1 loading request after signature/legal/durable acceptance, before buffer wait.
- Reuse that in processing so loading cannot race after the final reply.
- Anchor the long-wait timer to accepted time; atomically cancel before it starts, bound any started
  status attempt, order it before final, and restart loading after a successful status when useful.
- Collect 1,000 ms, 1,500 ms, and the implemented 2,000 ms control concurrently. Keep 750 ms as an
  offline lower-bound fixture until 1,000 ms is safe.
- Change the config default and buffering spec/test expectations only after the cohort decision.
- Keep max wait 8,000 ms, command fast path, serialization, caps, and group behavior unchanged.
- Make `gap <= debounceMs` deterministic as one turn and `gap > debounceMs` as the next turn; idle
  commands flush immediately without requesting loading.
- Measure late-second-bubble, split-turn,
  duplicate-answer, re-ask, and cost-per-intent rates.
- Assign cohorts stably by experiment-secret HMAC of company+chat, never log identifiers/hash material,
  and run matched journeys for >=14 full days and >=10,000 accepted intents per cohort (or the larger
  baseline-derived, cluster-design-effect-adjusted sample for 80% power). Analyze at the assignment
  cluster with bootstrap/cluster-robust intervals and Holm-adjusted one-sided 95% bounds for both
  candidate/control comparisons. Evaluate 1,000 ms first; consider 1,500 ms only as the predeclared
  fallback when its concurrently collected comparison independently passes every gate.
- Use the spec definitions for completed intent, late-fragment candidate, semantic split, and re-ask;
  require both absolute SLOs and relative improvement.
- Exclude or separately report deploy/restart/scaling/multi-instance windows unless chat-key partitioning
  proves one buffer owner; label them `buffer_assignment_contaminated`.
- Freeze loading-on-accept and every latency-affecting feature/config flag for the full experiment;
  restart or separately label the measurement window after any change.

Exit: LINE accepts the 1:1 loading request p95 <=1 second, controlled device/UAT verifies actual visible
acknowledgement, and the smallest selected candidate does not cross rollback gates. Before telemetry,
1,000 ms is recommended; use 1,500 ms only if 1,000 ms fails selection and the concurrent 1,500 ms
cohort independently passes every adjusted gate.

## Phase 2: Additive Prepared Plan Contract

- Add optional `LineAiPreparedPlan` in `packages/contracts/src/line-ai.ts`, reusing
  `AgentIntentPlan`.
- Add optional `preparedPlan` to `LineIntakeRoutePlan` and `LineAiTurnRequest`.
- Extend intake parsing with exact version 1, <=32 KiB wrapper, confidence >=0.85 for simple execution,
  one intent/call/tool for simple plans, required-tool equality, depth/key/array/string caps, plain-object
  checks, forbidden prototype/scope/credential fields, and answer-shape guards.
- Treat `responseMode`, `answerShape`, and confidence as untrusted advice. Derive the lane from verified
  invariants; confidence is veto-only, is never recomputed by the server, and cannot grant authority.
- Preserve optionality through API client, turn use case, runtime port, AgentCore client, runtime
  validation/coercion, and payload-to-turn conversion.
- Increment the runtime contract version only when both compatibility directions are tested.
- Add invalid/oversize/unknown-tool/forged-input/legacy-artifact tests.

Exit: old artifacts fall back safely; new artifacts never trust wire JSON as authority.

## Phase 3: Fused Text Planning

- Extend `IntentRouterAgent.routeIntake()` so text may return the intake route plus bounded
  `AgentIntentPlan` in the same response for business reads, allowed zero-tool casual/capability intents,
  and semantic refusals.
- Put the static glossary/tool catalog in a stable cacheable prefix.
- Keep media/capture context, active categories, deterministic value candidates, correction targets,
  and open clarifications intact.
- In `ProcessLineWebhookUseCase`, forward a valid prepared plan into `LineAiTurnRequest` instead of
  discarding it.
- Retain the current permission/entitlement-filtered all-eligible actor delegations during shadow and
  initial prepared-lane rollout so a fallback can choose another authorized tool. Do not let a prepared
  plan narrow fallback capability; delegation narrowing is a later separately proven optimization.
- Deliver capability/refusal plans deterministically, keep the existing casual persona composer, and
  verify mixed social+business, social+mutation, crisis, privacy, persona, brevity, and language rows.
- Preserve the outer intake enum: casual/capability remains `UNSUPPORTED` there, while the optional
  prepared `AgentIntentPlan` carries `casual_conversation` or `capability_help`; test both fields.
- Shadow-compare prepared plan versus the current second router without using the shadow result for
  execution or increasing user latency.

Exit: configured-provider route/tool/input/refusal/clarification gates pass before prepared execution.

## Phase 4: Prepared Simple-Read Lane

- In `OrchestratorAgent`, consume the prepared intent plan instead of calling `route()` again.
- Add one eligibility predicate for `BUSINESS_READ_QUESTION`, exactly one intent/proposed call/registered
  read tool, exact `requiredTools` equality, all wrapper/input bounds, no missing
  context/attachment/open clarification/partial/human-review state, non-narrowed delegation, and a
  verified formatter family.
- Re-run access normalization, tool/subject/permission/entitlement checks, sanitizer/value guards, and
  the live specialist/API boundary.
- Execute the existing specialist directly; validation failure falls back before any ERP call.
- Format only complete-success/explicit-empty results. Use existing honest terminal copy for an
  authoritative unavailable/failure state; otherwise pass the validated result/error to complex
  coverage without claiming completion.
- Add forged-plan, feature-change, permission-change, wrong-subject, invalid-input, empty-data,
  unavailable-source, and full-fallback tests.
- Execute all cases in `LINE_AI_PREPARED_PLAN_SECURITY_EVAL_CASES`, including tenant/branch scope,
  delegation, duplicate/oversized/prototype-shaped input, version, confidence, and mutation forgery.

Exit: eligible rows use one model call; security and source boundaries are unchanged.

## Phase 5: Deterministic Response and Coverage Gates

- Add one high-volume response family at a time, beginning with exact single-metric/list snapshots
  whose tool data and requested answer shape are unambiguous.
- Preserve source refs, as-of, links, language, numeric/semantic guards, and honest empty/failure copy.
- Simple coverage is deterministic only when every validated planned call has an honest terminal
  result.
- Keep model composer/critic for unverified, mixed, partial, comparative, explanatory, analytical, or
  multi-source journeys.
- Run randomized blind pairwise Thai/English quality evaluation against the current Sonnet-composed
  answer before each formatter family is enabled: at least three ratings per row and 30 paired ratings
  per language/family stratum, win=1/tie=0.5/loss=0, with the aggregate and each eligible language's
  one-sided 95% lower bound >=0.50. Formatter factual/source fixtures remain 100% regardless of
  preference score.
- Bind every enabled simple row to a fixed fixture asserting source refs, as-of, outcome, required and
  forbidden facts, explicit-empty copy, source-unavailable copy, and ordered repeated-tool inputs.

Exit: selected simple families skip critic/composer without answer-quality regression.

Complex journeys keep the structural runtime round budget and observed replay distribution. Five model
calls is an ideal happy-path target, not a hard cap that can silently remove critic/coverage recovery.

## Phase 6: Secondary Runtime Experiments

- Reuse underlying Bedrock SDK clients by region/credential boundary; do not share request state.
- A/B privacy-safe, bounded AgentCore session affinity separately; never encode raw company/chat/user
  ids in the session header and test cross-chat isolation.
- Verify prompt-cache read/write tokens and throttling/retry delay before changing capacity.
- Shadow a smaller routing model only after the Sonnet fused path is stable; keep Sonnet fallback and
  all allowlist, lineage, metering, processing-region, and approval controls.

Exit: retain only experiments with measured latency/cost wins and no protected-journey regression.

## Eval and Verification

- Corpus integrity/arithmetic only:
  `pnpm exec tsx --test scripts/line-ai-latency-autonomy.corpus.spec.ts`.
- Existing operator fixture replay remains 436/436 with zero forbidden tool calls.
- Extend the existing replay/eval runners to consume the new corpus; do not create a parallel provider
  runner.
- Run fixed full-flow cases for every lane; do not count corpus integrity as routing, permission,
  AgentCore, grounding, loading, or fallback evidence.
- Run every protected journey enumerated in the spec and report Thai/English strata separately. Freeze
  the journey list, gold plans, required/forbidden facts, sources, and scoring code before shadow data.
- Run all 96 non-attachment route/path rows and all seven attachment-bound rows as exact configured-
  provider/full-flow cases before UAT. Three attachment rows use the existing harness; four remain
  blocked until their `extension_required` harnesses exist. Run all 23 security/source cases against
  real validation/full-flow boundaries and all 38 matched timing rows deterministically without a
  provider. `reject_before_tool` must audit/discard the forged payload, execute zero proposed calls, and
  continue only through an existing deterministic denial or a fresh safe full-agentic plan.
- Keep the timing simulator labelled integrity-only and retain API service tests as authority for
  merge-into-pending, capacity, persistence, media caption/defer behavior, and delivery ordering.
- Use the existing source-hashed controlled-image harness for its three current scenarios. Extend it for
  transfer-slip, quotation, and signature before those requirements count as passing; require MIME,
  expected SHA-256, human review, and class-specific observed model budgets.
- Record source commit,
  corpus SHA-256, model/provider, counts, call-count distribution, duration, usage/cost, and failures.
- Run focused contracts/API/Gateway/AgentCore tests and typechecks; record exact results in task memory.
- Stop before deploy. UAT/Production requires the mandatory deployment runbook and signed run evidence.

## Rollout

1. Trace-only baseline.
2. Loading-on-accept 5% -> 25% -> 100%.
3. Start a fresh measurement window after the 2,000 ms default deploy; collect concurrent
   1,000/1,500/2,000 ms cohorts and apply the predeclared 1,000-first selection. Never combine the
   earlier 2,500 ms observations with this window.
4. Fused-plan shadow.
5. Prepared simple lane 5% -> 25% -> 50% -> 100% per eligible family.
6. Deterministic formatter families individually.
7. Provider reuse, session affinity, then smaller-model experiments separately.

Create the exact independently default-off flags enumerated in the spec. Record assignment scope and
the old path restored by each flag in config tests before any canary.

## Rollback

For reliability v2, the numeric quality margins below are additional operational stop triggers, not pre-canary regression allowances. Confirmed optimization-induced quality loss fails its acceptance gate and stops expansion even below these thresholds; keep the original isolation/authority controls and runtime budget enforcement.

- Feature flags return each lane independently to the current path.
- Any authorization, tenant, entitlement, mutation, source-honesty, or identifier-leak regression is
  zero tolerance and rolls back immediately.
- Performance/quality rollback: wrong-tool >0.5 point worse, grounded accuracy >1 point worse,
  split-turn/duplicate-answer >0.5 point worse, re-ask/fallback >10% relative worse, or
  protected-journey p95/cost >10% worse. A simple-read p95 above 8 seconds also fails even if it beats
  the 2,000 ms control.
- No schema/data rollback is required by the primary plan.
