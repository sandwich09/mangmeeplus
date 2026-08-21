# Agent Memory: LINE substitute-receipt semantic routing

Status: IMPLEMENTED default-off (mode 'off' = exact legacy). Contracts (bounded substituteContext +
asIntakeRouteIntent de-dup), prompt (SUBSTITUTE_RECEIPT_CONTINUATION route meaning + substituteContext +
low-confidence CLARIFY), config mode (off|shadow|primary, default off), dispatcher (primary after
routePlan; narrow anchored UNAVAILABLE fallback; consume only resolved∩substitute ids), continuation
safety (permission+eligibility before every save incl. pause/cancel; reject-before-save; anchored NFC
canonical explicit-start; paraphrase → one ledger confirmation, no workflow write; affirmative inherits +
starts), server-derived read-only substituteContext method, telemetry (bounded, workflowState bucket).
SHADOW is an explicit NO-GO (off-equivalent; a serverless webhook cannot safely run a nonblocking
compare). PRIMARY code is complete + tested but DISABLED absent provider/full-flow evidence.
Owner: thawatchai.phuchana
Scope: routing/dispatcher-safety + shadow/eval ONLY for `SUBSTITUTE_RECEIPT_CONTINUATION`. NOT
assisted-issuance v0.2 / signatures / delivery / policy / schema / final mutation.

Root cause (confirmed, matches the existing substitute memory): `process-line-webhook.use-case.ts`
runs the narrow regex `isSubstituteReceiptConversationText` BEFORE the intake router, so a semantic
paraphrase ("ใบทดแทนของค่าวิน…") never routes to the continuation, and a message that is both a new
expense and a substitute request never reaches text capture. Fix = guard ORDER (dispatch after
routePlan) + a semantic route, gated by a default-off mode.

Key seams read (2026-08-20):
- Regex + continuation use case: `apps/api/.../expenses/application/use-cases/line-substitute-receipt-
  continuation.use-case.ts` — `isSubstituteReceiptConversationText` (5 canonical names); `execute(ctx,
  {messageText, chatKeyHash, recentCandidates})` → `{handled,status,replyText,acceptedFields,blockers,
  pendingQuestion?,sideQuestionAnswered?,resumeCapsule?}`. Statuses include TARGET_REQUIRED/STALE/…
- Current dispatch: `process-line-webhook.use-case.ts` ~1439–1491 runs BEFORE `routePlan` (~1497); gated
  on `isSubstituteReceiptConversationText(text) || hasSubstituteClarification`.
- Parser raw cast to remove: `intent-router.agent.ts:625` (`INTAKE_ROUTE_INTENTS.includes(intent as …)`)
  and `:707` (`intent as LineIntakeRouteIntent`). Ledger raw cast: `line-ai-ledger.service.ts:133`.
- Contract: `LineIntakeRouteRequest` (packages/contracts/src/line-ai.ts) — add optional bounded
  `substituteContext`. `asIntakeRouteIntent` + `LINE_INTAKE_ROUTE_INTENTS` already exist (added in the
  latency/autonomy work).

Decisions:
- Reuse the existing `LineSubstituteReceiptContinuationUseCase` verbatim (no new save/preflight/ledger).
- Config mode `LINE_AI_SUBSTITUTE_SEMANTIC_ROUTING_MODE ∈ {off,shadow,primary}` default `off`.
- Bounded `substituteContext` carries only workflowState/hasPendingQuestion/preparedState/
  recentCandidateCount — DATA, never authorization; API re-reads authoritative state before dispatch.

Artifacts:
- `docs/specs/line-substitute-semantic-routing-spec.md`
- `docs/plans/line-substitute-semantic-routing-plan.md`

Corpus: `scripts/line-ai-substitute-routing.corpus.ts` — 47 protected Thai/English rows (UAT paraphrase,
start/continue/status/pause/cancel, receipt avail/unavail, ordinary expense, payment-voucher/ใบสำคัญ/
reimbursement negatives, definition/VAT/help, negation, side-question, unrelated-expense, multiple, low
confidence, UNAVAILABLE, denied). Non-canonical semantic starts pin write=FALSE (confirm-first, ledger
only). The corpus integrity tests (9) are INTEGRITY-ONLY. All 47 IDs are bound into
`LINE_AI_PROTECTED_EVAL_CASE_IDS` and scored by the EXISTING `run-line-ai-operator-language-eval` runner
via a routeIntake pass (same runner, provider-evidence pending). Runner scoring is TRUTHFUL: the two
`unavailable` (outage-only) rows are SKIPPED (a healthy provider cannot reproduce a provider-down
UNSUPPORTED, so scoring them would spuriously fail — they remain in structural/unit coverage only);
protected negatives are scored by `actualIntent !== SUBSTITUTE_RECEIPT_CONTINUATION` (any safe
non-substitute route passes, since e.g. a payment voucher may be CLARIFY or MUTATION_REQUEST_REFUSAL);
every other provider-eligible row is scored against its pinned expected intent. The JSON report emits
`scored`, `skippedOutageOnly`, `skippedIds`, and per-basis counts so no evidence is overstated. Runner
load verified (fails at PROVIDER_UNAVAILABLE, i.e. parses/imports cleanly; the pass needs credentials).

Fable FINAL CONDITIONAL review — ALL fixes applied (2026-08-20, Opus 4.8, no deploy):
- P1-1 DEFAULT-OFF PROMPT/COST: intake prompt is a capability-gated builder `intakeRouterSystemPrompt(caps)`;
  default-off is byte-for-byte identical to the pre-feature HEAD baseline (proven once via a runtime probe),
  and permanently guarded (exported const == default-off, no fused/substitute markers, each cap additive,
  routeIntake off = no catalog + glossary in DATA + maxTokens 1000; fused = catalog + maxTokens 1500).
  RUNTIME RECEIVER-BOUNDARY HARDENING (post-review audit): the trusted flags are bounded at the gateway HTTP
  edge, not only by the TS shape (`@Body()` does no runtime validation). New contract validator
  `asIntakeRouterCapabilities` accepts ONLY an OWN literal boolean `true` per known key (Object.hasOwn →
  `__proto__`/prototype-chain safe) and discards truthy non-booleans (1/"true"/{}/[]), false/null,
  non-objects, and unknown/nested keys. Applied BOTH in the `line-intake-route` controller (bounds
  `body.capabilities` in place) AND inside `routeIntake` (self-defending for every caller) — so a
  malformed/hostile body can never COERCE the fused or substitute section on (the old `!!` coercion is
  gone). `substituteContext` now rides the intake payload ONLY when the VALIDATED substituteSemantic is
  true, so shadow/off can't inject semantic context. Tests: contract validator, gateway routeIntake
  receiver (malformed → default-off; legit true still activates), controller (bounds in place).
- P1-2 MULTI-CANDIDATE CONFIRM: the selected expense id is preserved through the typed `candidateExpenseIds`
  clarification; `confirmedStart` requires isAffirmativeText AND a currently-active RESOLVED single-target
  start-confirm clarification (never a stale/any substitute clarification); ordinal/affirmative bind to the
  FROZEN pinned shortlist, not the recency window. REAL end-to-end webhook test (3 turns, real continuation
  use case) proves exact-id binding survives a shuffled and drained recency window with EXACTLY one save.
- P1-3 ZERO-WRITE EVIDENCE: use-case persistence-seam save/revision-count tests for VAT/definition question,
  negation, forbidden, ineligible (start + control), no-op, paraphrase-no-confirm (all 0 writes) and
  canonical start / confirmedStart / pause / cancel (exactly 1 write). The 4 pause/cancel corpus phrases now
  match the runtime via NEW NFC-safe anchored `isSubstitutePauseControl`/`isSubstituteCancelControl`
  predicates (broadened to the natural Thai/English forms + legacy short forms, with safety negatives).
- P2-G: `isAffirmativeText` broadened (ได้เลย/เริ่มเลย/ใช่จ้า/…) with the negative guard FIRST, anchored.
- P2-H: substitute DB context read stays primary-only; provider-UNAVAILABLE precedence documented + tested —
  a canonical command with BOTH a substitute workflow and an OPEN expense draft dispatches the substitute
  (narrow fallback) and INTERRUPTS (pauses) the draft, never dropping it.
- P2-I: `shadow` mode is now byte-identical to `off` (capability + substituteContext are primary-only, DB
  read primary-only) — a true inert NO-GO, proven by a shadow==off test (no fake agreement).

Verification (2026-08-20, Opus 4.8, no deploy): continuation use case 28/28; webhook 95/95; buffer 60/60;
intent-router 58/58 (incl. receiver-boundary capability hardening); gateway controller 51/51; prepared
formatter 10/10; prepared execution 35/35; AgentCore runtime 40/40; config 123/123; contracts suite 172/172
(incl. `asIntakeRouterCapabilities` validator) + build; substitute (9) + latency-autonomy corpora;
API+Gateway typechecks clean; diff-check (no package.json/schema/migration/cloud; apps/web/next-env.d.ts
preserved).

Fable success/end_turn CLOSURE (2026-08-21, Opus 4.8, no deploy):
- P1 RUNNER: `scripts/run-line-ai-operator-language-eval.ts` substitute pass previously called routeIntake
  WITHOUT `capabilities`, so under the receiver gate the gateway ran the legacy prompt (no substitute route)
  AND stripped substituteContext — every scored expected-intent row would have been unroutable and the
  future evidence FALSE. Fixed: the pass now builds its request via exported `buildSubstituteRouteRequest`,
  which sends literal `capabilities:{substituteSemantic:true}` + the bounded server-derived substituteContext.
  A main()-guard makes the module importable without replaying the eval. New focused spec (4) proves literal
  capability true + bounded context, real activation of the substitute prompt + context, and the load-bearing
  regression (no-capability → legacy prompt + stripped context). Non-substitute `router.route` pass unchanged.
- (d) REPETITIVE-CONFIRMATION GUARD: when the provider routes substitute but OMITS the resolved clarification
  id, an affirmative now binds DETERMINISTICALLY — but ONLY when there is EXACTLY ONE active start-confirm
  clarification with EXACTLY ONE candidate id; ambiguous (≥2) or missing (0) stays ZERO-write and
  re-clarifies. Gated on isAffirmativeText; provenance (current-active ∩ model-resolved) still comes first;
  the recovered clarification is consumed (never re-asked); all use-case permission/eligibility/reject-
  before-save gates unchanged. Webhook regression: unique bind + ambiguous/missing zero-write + non-affirmative.
- Doc truth fixes: plan §5 `shadow` rewritten to inert off-equivalent NO-GO (offline replay, no fake live
  telemetry); buffering spec loading/timer documented behind `LINE_AI_LOADING_ON_ACCEPT_ENABLED` (default off,
  subordinate to master); substitute corpus spec prose 7→9 tests; latency memory protected count 164→211
  union (164 latency + 47 substitute, verified).
- Re-verified: webhook 96/96; continuation 28/28; buffer 60/60; intent-router 58/58; runner 4/4; substitute
  corpus 9/9; contracts 172/172; API+Gateway tsc clean; diff-check clean.

Next (evidence-gated, NOT code): run the operator-language provider replay to measure substitute routing
agreement + protected-negative pass; only then consider enabling PRIMARY. SHADOW stays a documented NO-GO.
