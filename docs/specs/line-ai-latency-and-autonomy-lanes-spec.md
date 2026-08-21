# LINE AI Latency and Autonomy Lanes Spec

## 1. Status

Design approved for evaluation. Phase 0–2 and the real Phase 3 producer + Phase 4 deterministic simple-read
EXECUTION lane are IMPLEMENTED default-off (see `docs/agent-memory/line-ai-latency-and-autonomy-lanes.md`
for exact code paths): `routeIntake` emits an optional bounded prepared plan (static glossary/tool catalog
in cacheableContext); the untrusted wrapper carries NO provenance — the API binds the outer route intent
onto a separate `LineAiTurnRequest.intakeIntent`, re-validated by explicit membership at every
API→Gateway→AgentCore receiver, and the orchestrator gates on `request.intakeIntent === BUSINESS_READ_
QUESTION`. The lane requires the sanitized input to EXACTLY equal the proposed input (any change → fall
back before any call), executes exactly one specialist call, and answers via a compiled deterministic
formatter (or an authoritative deterministic terminal) — no router.route, model loop, critic, or composer
(proven by method-call counters). All 23 security/source cases execute against the real orchestrator+ERP
boundary. One compiled family (`sales.get_sales_summary::single_metric`) is real but default-off (empty
operator allowlist). The producer CODE and PROMPT are implemented (the intake prompt instructs the exact
bounded prepared-plan schema + omission gates, prompt-contract tested). Still evidence-gated, not code:
configured-provider QUALITY (does a live model emit correct, gate-respecting plans), Phase 5 family
ENABLEMENT (mandatory blind pairwise eval), and Phase 6 live wiring (measured latency/cost). Every flag defaults off; the running code still defaults
`LINE_AI_BUFFER_DEBOUNCE_MS` to 2,000 ms and keeps the processing-start loading path when off. The user
selected 1,000 ms as the primary experiment candidate; the experiment collects concurrent 1,000/1,500/
2,000 ms cohorts, evaluates 1,000 ms first, and uses 1,500 ms only as the predeclared conservative
fallback when it independently passes every gate.

## 2. Goal

Make the employee LINE assistant visibly react within one second and reduce the common business-read
path from roughly five or six serial model calls to one, without weakening Thai/English understanding,
grounding, tenant isolation, permission/entitlement enforcement, source honesty, audit, or the
read-only/final-mutation boundary.

The user initially proposed **1,500 ms**, then selected **1,000 ms as the primary experiment candidate**
after design review found 1,500 ms conservative for a one-bubble message. The evaluation method is an
A/B comparison: 1,000 ms primary candidate, 1,500 ms
conservative candidate, and the current 2,000 ms control. The buffer still joins multi-bubble
utterances and serializes replies; this is a latency adjustment, not removal of buffering.

## 3. Current Evidence

- `packages/config/src/index.ts` defaults `LINE_AI_BUFFER_DEBOUNCE_MS` to 2,000 ms.
- Loading starts only when a buffered batch begins processing, so the user sees no loading feedback
  during the debounce wait.
- A normal business read first calls `line-intake-route`, then `line-turn`; the orchestrator routes the
  same text again before the native tool loop.
- The enabled native path may add a tool-selection round, a post-tool round, coverage critic, and model
  answer composition.
- Configured-provider replays recorded business-read durations around 9.6-19.8 seconds, while observed
  successful daily-closing ERP tool reads were about 60-104 ms. The dominant evidenced cost is serial
  model orchestration, not the source read.
- Production currently pins Sonnet 4.6 for chat and document roles. This spec does not downgrade either
  role.

## 4. Product SLOs

These are design targets to validate with hosted telemetry, not claims about current behavior.

| Journey | Target |
|---|---:|
| 1:1 loading-request accepted by LINE API p95 | <= 1.0 s |
| deterministic command final p95 | <= 2.0 s |
| simple business-read final p50 | <= 3.0 s |
| simple business-read final p95 | <= 8.0 s |
| complex progress feedback p95 | <= 6.0 s |
| complex final p95 | <= 20.0 s |

An under-one-second grounded final answer is required only for an explicitly precomputed or cached,
permission-scoped journey. It is not a universal SLO for fresh multi-source analysis.

The loading-request SLO is a server-side proxy. Actual device-visible acknowledgement requires a
controlled LINE device/UAT measurement; server traces alone must not claim that the animation rendered.

## 5. Design Principles

The Karpathy-style lens used here is practical rather than biographical: use the LLM as a compact
learned program for ambiguous language and planning, surround it with deterministic verification and
tools, and spend model intelligence only where the task is genuinely uncertain. Evals decide whether
an apparent shortcut is allowed to ship.

1. **Model proposes; code verifies.** A model plan carries no authorization.
2. **Use the lowest sufficient autonomy.** Exact controls use deterministic code; simple reads use one
   semantic plan; ambiguous or analytical work keeps the full agentic path.
3. **Keep the strong model first.** Call-count reduction must be proven before any smaller-model trial.
4. **Fallback toward intelligence.** Any invalid, incomplete, low-confidence, or unsupported prepared
   plan falls back to the existing full orchestration path.
5. **One measured change at a time.** Loading, debounce, fused planning, simple execution, composition
   gating, provider reuse, session affinity, and model tiering have separate flags/cohorts.

## 6. Target Flow and Autonomy Lanes

```text
LINE event
  -> signature/legal/durable acceptance
  -> immediate 1:1 loading (best effort, never before durable acceptance)
  -> measured debounce candidate and per-chat serialization
  -> one fused semantic plan
       -> zero-model authority lane
       -> prepared simple-read lane
       -> full agentic lane
       -> document/capture lane
  -> persistence/audit
  -> LINE delivery
```

### 6.1 Zero-model authority lane

Existing deterministic gates remain zero-model: duplicate event, legal acceptance, unlinked/inactive
user, company selection controls, explicit `/company` commands, permission denial known before semantic
routing, and final-mutation controls whose intent is already authoritative. Zero-model means zero model
calls; a tool may run only when an existing authoritative control already permits it.

### 6.2 Prepared simple-read lane

A turn is eligible only when every condition holds:

- intake intent is `BUSINESS_READ_QUESTION`;
- one business intent and one registered read tool;
- no attachment, open clarification, missing context, partial plan, or human-review requirement;
- the one proposed tool exactly equals the one unique entry in `intentPlan.requiredTools`;
- the versioned wrapper and every object/array/string/input bound in section 7 pass;
- proposed input is bounded and passes the existing sanitizer/value-candidate rules;
- subject compatibility, effective permission, exact feature entitlement, actor delegation, and the
  live API tool boundary all pass;
- the selected response family has a verified grounded deterministic formatter.

The lane executes the existing specialist and permission-checked ERP tool. It does not call the native
tool loop, coverage critic, or model answer composer. Any failed eligibility or validation check falls
back to the full agentic lane before an ERP call. After the call, only a complete success or explicit
empty result may reach its verified formatter. A partial result, unavailable source, or failure uses an
existing honest deterministic terminal response when one is authoritative; otherwise the validated
result and error state move to complex coverage without claiming completion.

During shadow and initial rollout, actor delegation remains the same deterministic all-eligible,
permission/entitlement-filtered set used by the current full path. A prepared plan must never narrow
the capabilities required by fallback. Delegation narrowing is a later optimization only if fallback
can obtain a fresh validated delegation before any tool call.

### 6.3 Full agentic lane

Multi-intent, comparison, analysis, ambiguous input, missing identifiers, open clarification, partial
availability, or unverified response families keep the native tool loop and model synthesis. Fused
planning may remove the duplicate plan-router call, but this lane does not trade away reasoning depth.

### 6.4 Casual conversation

Casual conversation remains model-written in the Nong Mangmee persona. Phase 1 targets fused
classification plus the existing casual composer (at most two calls). A one-call inline casual reply is
an experiment only after the casual, safety, mixed-business, and persona eval rows pass.

### 6.5 Document/capture lane

Receipt, OCR, expense-draft continuation, correction, and signature/image classification keep their
existing specialist pipeline. Active categories and deterministic value candidates remain available;
latency work must not remove capture context merely to make the prompt smaller.

## 7. Prepared Plan Contract

Reuse the existing `AgentIntentPlan`; add one optional wrapper rather than a second plan hierarchy:

```ts
type LineAiPreparedPlan = {
  version: 1;
  complexity: 'simple' | 'complex';
  confidence: number;
  intentPlan: AgentIntentPlan;
  proposedCalls: Array<{
    toolName: string;
    input: Record<string, unknown>;
  }>;
  responseMode: 'deterministic' | 'casual_composer' | 'simple_grounded' | 'full_agentic';
  answerShape?: 'single_metric' | 'list' | 'summary' | 'comparison';
};
```

`LineIntakeRoutePlan` may carry `preparedPlan`; `LineAiTurnRequest` may carry the same server-forwarded
field. Both are additive and optional so an older API/Gateway/AgentCore artifact falls back safely.

`responseMode`, `answerShape`, and `confidence` are untrusted model advice, never execution authority.
The server derives the lane only from verified intent shape, tool registry, wrapper bounds, live
permission/entitlement/delegation state, subject compatibility, input validation, formatter coverage,
and source state. The server does not recompute model confidence: confidence is veto-only. A value below
0.85 forces upward fallback and a value at or above 0.85 cannot make an otherwise ineligible plan
eligible. Shadow calibration may raise the floor; lowering it requires a spec revision and fresh eval.

Every receiver must parse and bound the field. It must never cast raw JSON directly into the type.
Before execution, the orchestrator repeats `normalizePlanToolAccess`, registry/subject checks, input
sanitization, permission/entitlement checks, and the specialist/live API checks already used today.

Version 1 bounds are concrete: encoded wrapper <=32 KiB; plain objects/arrays only; maximum depth 4,
32 keys per object, 50 array items, and 512 UTF-8 bytes per string; reject `__proto__`, `prototype`, and
`constructor`; strip/reject actor, user, company, tenant, branch-scope, permission, entitlement, token,
delegation, and credential fields. A prepared simple read requires confidence >=0.85, exactly one
intent, one unique proposed call, one registered read tool, and exact equality between that tool and
`intentPlan.requiredTools`. A zero-tool plan requires an existing allowed zero-tool intent or refusal
and no proposed calls. Invalid version, size, shape, confidence, or equality falls back before a tool.

## 8. Fused Planning

For text, `routeIntake()` may return the intake route plus a bounded `AgentIntentPlan` in the same
provider call. This includes business reads and the existing zero-tool `casual_conversation`,
`capability_help`, and semantic-refusal shapes. The API forwards the validated plan instead of
discarding it and asking `IntentRouterAgent.route()` to classify the same message again. Capability
and refusal delivery remains deterministic; casual conversation keeps the existing persona composer.
Mixed social+business or social+mutation turns follow the business/refusal clause, never the casual
lane. Crisis and privacy rules override ordinary casual handling.

Fused planning preserves the current reasoning depth, composition, Nong Mangmee persona, and document
behavior. It removes only the duplicate routing inference. No path is described as wholly unchanged,
because forwarding the prepared plan intentionally changes orchestration.

The two layers keep different enums: the outer `LineIntakeRouteIntent` continues to report
`UNSUPPORTED` for casual/capability text, while its optional prepared `AgentIntentPlan` carries the
actual zero-tool `casual_conversation` or `capability_help` intent. Eval rows assert both; this is not
an enum substitution.

The static glossary/tool catalog belongs in a stable cacheable prefix. Message text, conversation
context, permissions, candidates, and attachments remain untrusted DATA. Media/capture prompts may stay
specialized when combining them would enlarge or weaken the common text path.

## 9. Grounded Response Policy

- Existing deterministic refusal, unavailable, no-data, daily-closing, capability, and permission copy
  remains authoritative.
- Add deterministic formatting one high-volume tool family at a time. The formatter answers the
  requested metric/list shape, not a generic dump of every fact.
- Preserve source references, as-of state, links, and existing numeric/semantic grounding.
- Use the model composer for unverified families, mixed results, multi-source synthesis, comparison,
  explanation, or analytical wording.
- Simple deterministic coverage is `planned calls == validated calls == successful/explicit-empty
  results`. Anything else falls back or uses the complex coverage path.

## 10. Buffering and Waiting Feedback

- `LINE_AI_BUFFER_DEBOUNCE_MS` cohorts: **1,000 ms primary**, **1,500 ms conservative**, and the
  implemented **2,000 ms control**. An optional 750 ms fixture explores the lower boundary but is not
  a rollout candidate until 1,000 ms is safe.
- `0` continues to mean serialize-only.
- Max wait stays 8,000 ms and remains anchored to the first bubble.
- The normative boundary is `gap <= debounceMs` joins the current turn; `gap > debounceMs` starts the
  next turn. Implementation tests must make equality deterministic rather than rely on timer callback
  ordering.
- Idle commands remain immediate and do not request LINE loading.
- Loading starts best-effort after signature/legal/durable acceptance and before debounce for 1:1
  chats. It must be coalesced per chat and ordered so it can never appear after the final reply.
- The long-wait status is due 5,000 ms after the last user bubble's durable acceptance, not 5,000 ms
  after processing start. Its delivery must
  be atomically cancelled if it has not started. An already-started status delivery is ordered before
  final delivery but may not hold a ready answer indefinitely; use a bounded attempt, then proceed.
  Because a pushed status clears LINE loading, restart loading 300 ms after a successful status when
  the final answer is not ready.
- Group chats have no loading indicator and retain a separate measurement cohort.
- Freeze `LINE_AI_LOADING_ON_ACCEPT_ENABLED` and every flag that can affect buffering, routing, model
  calls, provider reuse, or session affinity for the full 14-day debounce experiment. A flag/config
  change starts a new window; never combine it with the primary inference.

Select the smallest candidate whose split-utterance, duplicate-answer, re-ask, and cost-per-intent
metrics remain inside the acceptance gates. Before telemetry, the design recommendation is 1,000 ms;
1,500 ms remains the safe fallback when fragmented-message quality regresses.

The cohort decision uses privacy-safe timing data: single- versus multi-bubble rate, inter-bubble gap
distribution for one accepted intent, split-turn and duplicate-answer rate, re-ask within five minutes,
final latency, and cost per completed intent. A candidate fails when split-turn or duplicate-answer
rate worsens by more than 0.5 percentage point versus control, even if its median latency is faster.

Assignment is stable per `(company, chat)` using an experiment-secret HMAC; raw identifiers and the
HMAC input/output are not logged. Collect 1,000/1,500/2,000 ms cohorts concurrently across matched
journeys for at least 14 full days and 10,000 accepted intents per cohort, or a larger
baseline-derived, design-effect-adjusted sample needed for 80% power. Analyze at the assignment-cluster
level with a cluster bootstrap or cluster-robust interval. Predeclare the hierarchy: evaluate 1,000 ms
first; select it only if every absolute and non-inferiority gate passes. Otherwise consider 1,500 ms
only if its concurrently collected, multiplicity-adjusted comparison against 2,000 ms independently
passes every gate. Use Holm-adjusted one-sided 95% bounds across the two candidate/control comparisons
for each declared primary metric; the upper bound must stay inside its regression margin. `completed intent`
means one durable accepted request window with one delivered final/refusal/unavailable terminal result;
duplicates, legal-pending, and unlinked events are reported separately. `late fragment candidate` means
a new bubble arrived within five seconds after the earlier candidate flushed without an intervening
user-visible final; a controlled human/UAT sample determines semantic splits. `re-ask` means a new
accepted turn within five minutes with the same routed family and normalized request shape. A candidate
must also meet the absolute SLOs, not merely beat the control.

Exclude deploy, restart, scaling, or multi-instance windows from the primary non-inferiority inference
unless chat-key partitioning proves all bubbles reached one buffer owner. Mark such windows
`buffer_assignment_contaminated` and report them separately; do not count cross-instance splits as a
debounce failure.

## 11. Model and Cost Policy

Phase 1 keeps production Sonnet 4.6. Expected cost reduction comes from fewer calls and fewer repeated
tokens, not a weaker model. A smaller routing model may run in shadow only after the fused Sonnet path is
stable. It may serve traffic only when routing/tool-input/refusal/clarification/persona evals meet the
same gates and all model allowlist, lineage, metering, processing-region, and approval controls pass.

## 12. Observability

One correlation chain must record, without raw message text or LINE identifiers:

```text
LINE event timestamp -> webhook received -> durable acceptance -> loading request
-> buffer wait -> queue wait -> security/context reads -> intake plan
-> API/Gateway HTTP -> AgentCore -> each model call -> each ERP tool
-> critic/composer -> persistence/audit -> LINE delivery response
```

Required per turn: journey/lane, plan version, model-call count, tool-call count, fallback reason,
buffer/queue wait, total time, delivery mode/result, and usage/cost. Per model call: stable tag, model,
duration, input/output/cache tokens, throttle/retry count and delay when available.

Metric events are operational, not inferred from prose: `loading_started` is the server timestamp when
the post-accept outbound loading request begins; `loading_accepted` is its successful LINE response;
device visibility exists only in controlled UAT. `duplicate_answer` is more than one user-visible
terminal result for the same completed intent. `wrong_tool` is any executed tool/call multiplicity not
allowed by the frozen gold plan. `grounded_accuracy` is the percentage of fixed full-flow fixtures that
match outcome, required facts, forbidden facts, source reference, and as-of state.

The trace measures loading request/LINE response timestamps. Device-visible render timing is recorded
only by controlled UAT and must be labelled separately.

Runtime-owned measurements stay in `LineAiStageDurations`; ingress/buffer/LINE delivery timings belong
to a separate API end-to-end trace because AgentCore cannot observe them.

## 13. Eval Dataset Contract

`scripts/line-ai-latency-autonomy.corpus.ts` is the machine-readable expectation manifest for this
change. It currently contains 103 route/path rows, 23 prepared-plan security/source cases, and 38
matched debounce-timing rows. These are planned expectations, not completed provider/full-flow evidence.
It covers:

- zero-model commands/security outcomes;
- casual and mixed casual+business text;
- capability help;
- simple single-tool reads;
- complex/multi-tool reads;
- clarification/follow-up;
- mutation refusal and unsupported requests;
- capture/document route requirements bound to controlled external attachments by scenario id,
  required SHA-256, MIME allowlist, and human review;
- 750/1,000/1,500/2,000 ms inside/equal/outside boundaries, max-wait, command, and media-caption timing;
- caption-before-photo, multiple-media caption, photo plus business-read question, and company-command
  segmentation.

Every row in all three manifests is protected and its exact case id is exported in
`LINE_AI_PROTECTED_EVAL_CASE_IDS`; a canary may not select a favorable subset after observing results.

The implementation must reuse the existing operator corpus/runner and add latency-lane assertions; it
must not create a second provider-eval framework. The current integrity test proves schema, registry,
policy, security-manifest, and timing arithmetic only. It does not count as intake, permission,
AgentCore, model/tool-count, grounding, loading, or fallback evidence.

For blind answer-quality evaluation, randomize candidate/control sides and hide lane/model metadata.
Use at least three independent ratings per row and at least 30 independent paired ratings in each
language/response-family stratum before calculating an interval. Score a candidate win as 1, tie as
0.5, and control win as 0. The aggregate and each eligible Thai/English stratum must have a one-sided
95% lower confidence bound at or above 0.50 for casual/persona replies and each deterministic formatter
family. Fixed formatter fixtures still require 100% factual/source-policy pass; pairwise preference
cannot excuse a factual failure.

For media timing rows, `expectedSegmentTexts` mirrors runtime segmentation: media markers are never
joined into user text, and surrounding text becomes `captionText`. The image-plus-business-question
row is timing-only because receipt handling may intentionally defer that caption into a business-read
turn. The small integrity simulator replays only debounce/segmentation arithmetic and does not prove
service merge, capacity, persistence, or delivery behavior; API service tests remain authoritative.

Before UAT, every simple formatter row must bind to an existing fixed full-flow fixture with source
references, as-of state, outcome, required facts, forbidden facts, explicit-empty behavior, and
source-unavailable behavior. The three existing controlled-image scenarios use
`scripts/run-line-ai-controlled-image-replay.mjs`; transfer-slip, quotation, and signature scenarios
are explicitly `extension_required` and do not count as passing until source-hashed, human-reviewed
fixtures are supplied. Run all 96 non-attachment route/path rows plus all seven attachment-bound rows as
exact configured-provider/full-flow cases. Three attachment rows are runnable on the existing harness;
the remaining four rows stay blocked—not waived—until their `extension_required` harnesses exist.
Record this evidence separately from corpus integrity.

Security-manifest outcome `reject_before_tool` means discard and audit the forged plan/input, execute
none of its proposed calls, then use the existing deterministic denial or safe full-agentic fallback.
The fallback re-plans from trusted request/context and receives no authority from the rejected payload.

## 14. Acceptance and Rollback Gates

Required before canary:

- existing combined operator replay remains 436/436 with zero forbidden tool calls;
- new corpus integrity and fixed full-flow replay are 100%;
- prepared-plan forgery cannot expand tool, tenant, permission, feature, input, or mutation authority;
- simple eligible rows use at most one model call and no critic/composer;
- complex/capture rows retain their expected path and answer quality;
- complex rows record the five-call happy-path target, but enforcement uses an explicit structural
  runtime round budget plus observed replay counts; five is not a false hard maximum;
- wrong-tool rate may not regress by more than 0.5 percentage point;
- grounded-answer accuracy may not regress by more than 1 point;
- split-utterance or duplicate-answer rate may not regress by more than 0.5 percentage point;
- re-ask/fallback rate may not increase by more than 10% relative;
- simple-read p95 must be <=8 seconds and its p95 latency/cost must improve versus control; neither
  latency nor cost may regress by more than 10% in any protected journey.

Protected journeys are enumerated, not chosen after results: unlinked/inactive/legal/company-selection
controls; permission/entitlement/subject denials; casual, capability, crisis/privacy, and mixed
social+business/refusal turns; simple read success, explicit-empty, unavailable, and tool-failure
outcomes; complex multi-intent, repeated-tool comparison, analysis, and clarification; receipt/capture,
correction, quotation, transfer-slip, and signature handling; and final-mutation refusal/authoritative
confirmation controls. Report Thai and English separately wherever both exist in the frozen corpus.

Latency and cost reduction are gated hypotheses, not design guarantees. Larger fused prompts or lower
cache reuse may erase the expected saving; retain a change only when measured per-completed-intent cost
and latency pass these gates while quality remains inside its numeric margins.

Immediate rollback: any cross-tenant result, permission/entitlement bypass, final mutation, raw
identifier leakage, forged prepared-plan execution, or feedback before durable acceptance.

## 15. Rollout

1. Baseline traces and freeze eval evidence.
2. Loading-on-accept canary.
3. Collect concurrent 1,000/1,500/2,000 ms cohorts; apply the predeclared 1,000-first selection gate.
4. Fused planner shadow; compare plans without adding user latency.
5. Prepared simple lane 5% -> 25% -> 50% -> 100%, with full-path fallback.
6. Deterministic response families one at a time.
7. Provider-client reuse and AgentCore session-affinity experiments separately.
8. Smaller router model shadow last.

Proposed independently default-off flags and rollback owners:

- `LINE_AI_LOADING_ON_ACCEPT_ENABLED`: tenant canary; off restores loading at processing start.
- `LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED`: global experiment, stable chat cohort; off restores configured
  2,000 ms behavior.
- `LINE_AI_FUSED_PLAN_SHADOW_ENABLED`: tenant shadow; off stops forwarding/comparing prepared plans.
- `LINE_AI_PREPARED_SIMPLE_READ_ENABLED`: tenant + formatter-family cohort; off restores full agentic
  execution.
- `LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES`: exact family allowlist; removing a family restores composer.
- `LINE_AI_PROVIDER_CLIENT_REUSE_ENABLED`, `LINE_AI_AGENTCORE_SESSION_AFFINITY_ENABLED`, and
  `LINE_AI_SMALL_ROUTER_SHADOW_ENABLED`: separate global/tenant experiments; off restores the current
  provider/session/model path.

## 16. Non-goals

- No provider/model change in the first implementation.
- No ERP repository or permission-rule rewrite.
- No direct database access from AI Gateway.
- No token-fragment push messages to imitate web streaming.
- No larger timeout presented as a latency fix.
- No shared response cache above the permission-checked source boundary.

## 17. Linked Docs

- [[specs/line-ai-message-buffering-spec|LINE AI Message Buffering and Turn Serialization]]
- [[specs/line-ai-local-agent-orchestration-spec|LINE AI Local Agent Orchestration]]
- [[specs/line-ai-operator-intent-and-answer-depth-spec|LINE AI Operator Intent and Answer Depth]]
- Plan: [[plans/line-ai-latency-and-autonomy-lanes-plan|LINE AI Latency and Autonomy Lanes Plan]]
