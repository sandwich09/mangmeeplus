# ADR 0013: Separate CHAT/OCR AI budget caps — per-step reservations and evidence-driven settlement

- Status: Accepted for implementation (dark — no company can activate SPLIT until the readiness gate in §9 is open)
- Date: 2026-09-17
- Spec: [LINE AI — NOGROUP, budget errors, intake cost, chat/OCR caps §12](../specs/line-ai-ledger-lifecycle-remediation-spec-th.md)
- Plan: [E1 / D2](../plans/line-ai-ledger-lifecycle-remediation-plan-th.md)
- Review gates: R-01…R-08, R-10 of the [round-2 impact review](../research/line-ai-remediation-impact-review-2026-09-17-th.md)
- Extends: [AI usage metering and monthly budget](../specs/ai-usage-metering-and-monthly-budget-spec.md)

## 1. Context

The owner chose **separate** monthly caps for chat/general AI (`CHAT`) and document reading (`OCR`) inside the existing monthly total; neither bucket may borrow from the other. Today's gate (`runWithCompanyAiBudgetAdmission`) takes a per-company single-flight lease, compares the live month aggregate with the effective total and records the actual cost after the provider returns. That is a *bounded-overshoot* design: the one admitted action can cross the cap, and chat/media lanes can each have one action in flight. It cannot honour "each part never exceeds its own cap", so SPLIT needs money to be **reserved before** each provider invocation and **settled exactly once** afterwards.

`SHARED` stays the default and keeps today's code path byte-for-byte. Everything below applies only when the resolved policy of the company for the pinned Bangkok month is `SPLIT`.

## 2. Decision summary

1. **One resolver** decides the effective policy (mode, total `T`, caps `C`/`O`, revision) for a company and Bangkok month. Admission, the admin read and every readiness projection call the same function. A pending policy becomes effective by comparison with the month key — no cron.
2. **Durable reservation per provider step.** Before every provider invocation the API inserts an `AiBudgetReservation` row under the company-month advisory lock, admitting iff `spentTotal + reservedTotal + upperBound ≤ T` and the same inequality for the step's bucket. No whole-chain worst case is reserved.
3. **Static, enforced upper bounds.** Each step kind has a declared bound (max input tokens, max output tokens, provider attempts) in `packages/contracts`. The API prices the bound with the pinned price map and live FX, rounding **up per invocation**. The gateway **enforces** the same bound before calling the provider (request size, `maxTokens`, model id, SDK attempts) and refuses instead of exceeding it. A timeout is accounted at the declared bound, not at the legacy 200,000-token ceiling.
4. **Multi-call routes ask before each further step.** The gateway calls an authenticated API seam (`POST /internal/ai/budget-step`) before every provider call after the first; a refusal stops the chain and returns the usable partial result with a typed `AI_BUDGET_INSUFFICIENT`/`AI_MONTHLY_BUDGET_EXCEEDED` and scope.
5. **Settlement is driven by invocation evidence, not by the HTTP response.** After every provider call under an envelope the gateway posts the measured (or conservatively estimated) usage for that invocation to `POST /internal/ai/budget-settle`. The API settles the reservation, writes the usage event, and updates the month and bucket aggregates in one transaction, fenced by a unique invocation key. Usage attached to the HTTP response for the same invocation is then an idempotent no-op. A parser/controller error after the provider, a partial chain or a lost outer response therefore cannot turn real cost into zero.
6. **No TTL release.** A reservation that was dispatched and never settled becomes `UNRESOLVED` and keeps counting as reserved until evidence or an audited operator decision closes it. `CANCELLED` requires proof that no provider call started.
7. **Actual above bound is an invariant breach**: the actual cost is recorded in full, admission for that scope closes (`AI_BUDGET_UNAVAILABLE`) and a HIGH security event is raised. Nothing is clamped.
8. The Gateway still has **no database access**; it only uses the internal secret it already has. The API remains the owner of company, classification, reservation, ledger and audit.
9. The bucket of a step is decided by the API before the provider call with the Phase D1 function `classifyAiUsageRequest(sourceRoute, content)`; a step whose bucket cannot be derived is refused under SPLIT (`AI_BUDGET_UNAVAILABLE`), never defaulted.

## 3. Data model (one additive migration)

`CompanyAiConfiguration` (+): `budgetMode String @default("SHARED")`, `chatMonthlyBudgetSatang Int?`, `ocrMonthlyBudgetSatang Int?`, `budgetConfigVersion Int @default(0)`, `pendingBudgetPolicy Json?` validated as `{ mode, chatMonthlyBudgetSatang, ocrMonthlyBudgetSatang, effectiveMonthKey }`. `null` caps under SHARED mean "not set", never "unlimited".

`AiBudgetReservation` (new): `id`, `companyId`, `monthKey` (pinned), `bucket`, `policyRevision`, `sourceRoute`, `stepKind`, `attemptKey`, `invocationKey @unique`, `upperBoundSatang`, `pricingSnapshot Json` (model id, unit rates, FX + source, token bounds, attempts), `status` (`RESERVED → DISPATCHED → SETTLED | UNRESOLVED`, `RESERVED → CANCELLED`), `ownerToken` (fencing), `settledCostSatang Int?`, `usageBasis String?`, `evidenceJson Json?`, timestamps. Indexes: `(companyId, monthKey, status)`, `(companyId, monthKey, bucket, status)`.

`CompanyAiMonthlyBucketUsage` (new): unique `(companyId, monthKey, bucket)` with `costSatang`, `callCount`. Written in the same transaction as `AiUsageEvent` and `CompanyAiMonthlyUsage` for every new row whose bucket is known (SHARED companies too, so a later SPLIT activation and the admin view read one aggregate).

`AiUsageEvent` (+): `invocationKey String? @unique` — the settlement fence. Legacy/SHARED rows keep it `NULL`.

`reserved` is always `SUM(upperBoundSatang)` over `RESERVED | DISPATCHED | UNRESOLVED` rows of the month, read under the lock — no second counter that could drift (ponytail: live sum over a small indexed set; add a counter only if a profile shows it matters).

## 4. Identities (R-03)

- **Attempt key** — stable per logical user attempt, never the transport request id: `line-text:<webhookEventId>`, `line-image:<lineMessageId>`, `receipt-web:<client extraction request id>` (the web already reuses it for a lost response and rotates it for an explicit re-read), `statement:<import id>:<source hash>`, `crm:<message/suggestion id>`, `draft:<job id>`. No prompt text, raw LINE id or secret.
- **Invocation key** — `<attemptKey>#<stepKind>#<ordinal>`; the ordinal is the bounded call index inside the step kind (`0…maxCalls-1`). A ledger-drain reclaim of the same webhook event is the same attempt with the next **retry ordinal** bounded by the existing delivery cap; the previous invocation stays `DISPATCHED/UNRESOLVED` and keeps holding money until evidence arrives.
- **Owner token** — random per reservation; only its holder may cancel. Settlement by evidence is accepted once per invocation key regardless of owner, because it can only add truth, never release money wrongly.

## 5. Admission algorithm (API, one DB transaction, no network inside)

Lock order (R-06, the single canonical order for config writes, reserve, settle and OCR compensation): `partner-ocr-config:<company>` → plan-term lock (only when the action needs it) → `platform-ai-budget` → `ai-budget:<company>:<pinned month>`; bucket rows in fixed order CHAT then OCR. The platform-default writer holds only the platform lock and validates affected allocations by reading, never by taking company locks in reverse.

```text
policy   = resolve(company, month)            # fresh, never cached
if policy invalid/unreadable/bucket unknown   -> AI_BUDGET_UNAVAILABLE
bound    = priceUpperBound(stepKind, model)   # ceil per invocation
if spentTotal  >= T                           -> EXCEEDED  scope TOTAL
if spentTotal  + reservedTotal  + bound > T   -> INSUFFICIENT scope TOTAL
if spentBucket >= cap                         -> EXCEEDED  scope bucket
if spentBucket + reservedBucket + bound > cap -> INSUFFICIENT scope bucket
insert reservation RESERVED
```

The existing chat/media lease is kept around the step as a scheduler (it bounds concurrent holds and keeps "คุยระหว่างอ่านรูป"), but it no longer owns the balance. OCR count admission runs **after** the money reservation; a count/switch/plan refusal cancels exactly that reservation with the no-provider proof. Refunding an OCR *count* after a provider failure never cancels money (R-05).

## 6. Envelope and gateway enforcement (R-02)

The API adds `budgetEnvelope` to the internal request: `{ attemptKey, invocationKey, stepKind, bucket, monthKey, modelId, bounds, maxCalls }`. The gateway stores it in the existing request-scoped usage context. A provider decorator created in `createProvider` — the single choke point every agent already goes through — does, only when an envelope is present:

1. for call index > 0: `budget-step` → refusal stops the chain;
2. refuse before the provider if the request exceeds the declared bound (UTF-8 byte length is a safe upper bound for tokens; images use a fixed per-image ceiling), if `maxTokens` exceeds the bound, or if the model differs;
3. run the provider with SDK attempts pinned to the declared number;
4. post the invocation evidence to `budget-settle` (bounded retry; failure leaves the reservation `DISPATCHED` → `UNRESOLVED`, never silently free);
5. on timeout report `CONSERVATIVE_ESTIMATE` at the declared bound.

A runtime that cannot honour an envelope (AgentCore passthrough, a provider without usage counters) refuses SPLIT traffic with `AI_BUDGET_UNAVAILABLE`; it never falls back silently.

## 7. Settlement and reconciliation (R-04, R-12)

`settle(invocationKey, evidence)`: under the company-month lock — if an event with this invocation key exists → no-op; else insert the `AiUsageEvent` (D1 metadata + pricing snapshot + invocation key), increment month and bucket aggregates of the **pinned** month, mark the reservation `SETTLED` with actual cost and basis. A later provider-reported actual for an invocation that was settled conservatively goes through the Phase D1 writer `recordCompanyAiCostAdjustment` (signed delta, unique correction identity, original month, no extra call count, idempotent under concurrency); Phase E extends it to move the bucket aggregate in the same transaction. Month rollover never moves a reservation or its settlement to the new month.

## 8. Config writer, cutover and rollback (R-06, R-07, R-08)

`PUT /v1/system/partners/:id/ai-model` gains mode/caps/effective month/`expectedBudgetVersion` with the existing reason + audit flow; absent = preserve, `null` = clear where allowed, `0` = closed bucket, total stays positive. Validation in one transaction under the canonical locks: `C,O ≥ 0`, `C+O ≤ T`, nothing below `spent + reserved`, a company with spend or unresolved holds this month may only schedule SPLIT (and any SPLIT→SHARED or cross-bucket move) for the **next** Bangkok month, an activated pending policy is materialised as the predecessor before CAS/clear, and the read revision binds policy + month so a page left open across midnight conflicts. Every other writer of the total (platform default, signup provisioning, OCR config) validates against active/pending split state or refuses. Rollback keeps schema, usage and reservations; no binary that ignores SPLIT may serve a SPLIT company and nothing downgrades to SHARED automatically.

## 9. Readiness gate

Saving `mode: SPLIT` (active or pending) is refused with a typed error unless the server flag `AI_BUDGET_SPLIT_ACTIVATION_ENABLED` is true **and** every cost-bearing seam declares an enforced bound. The flag defaults to false and is not wired into any deploy in this delivery, so production and UAT behaviour cannot change by merging the code. Opening it is a separate, runbook-governed operator decision after UAT acceptance (spec X-02).

## 10. Consequences

- A conservative bound refuses some work before `spent` reaches the cap (near-limit). The admin view shows spent / reserved / available separately and the customer copy says "not enough left", never "full".
- One extra internal HTTP call per provider step, SPLIT companies only.
- Crashes convert holds into `UNRESOLVED` until reconciled — deliberate: money is never released on a timer.
- The byte-length input bound is loose (roughly 2–4× for Thai). The bound table is data; it can be tightened with measured evidence without changing the mechanism.

## 11. Implementation notes (E1b)

What this ADR left open, and what the implementation decided. Two of these deviate from the text
above on purpose; both are marked.

1. **The invocation key is company-scoped — DEVIATION from §4.** `invocationKey` is
   `<companyId>#<attemptKey>#<stepKind>#<ordinal>`, not `<attemptKey>#<stepKind>#<ordinal>`. The
   fence behind it (`AiUsageEvent.invocationKey` and `AiBudgetReservation.invocationKey`) is a
   GLOBAL unique index, so an unscoped key lets one company's attempt key claim the fence another
   company needs — a cross-tenant refusal driven by a tenant's own identifier. The company id is not
   personal data and the gateway already holds it, so scoping costs nothing. Caught by a real-DB
   test whose two companies collided on the same attempt key.
2. **One step kind per provider CHAIN — reading of §3.** §3 lists the receipt sub-steps
   (`read / extract / extract-repair / image-reread`) and gives the chain a single
   `maxCalls = AI_RECEIPT_OCR_MAX_PROVIDER_CALLS`. Those two only reconcile if the step kind names
   the chain and the ordinal names the call, which is also the only shape
   `POST /internal/ai/budget-step` can validate (`0 <= ordinal < maxCalls`). So `maxOutputTokens` is
   the MAXIMUM `maxTokens` across the calls a chain can make, and the research doc records each call
   it covers with `file:line`.
3. **A SPLIT company must have an explicit approved `modelId`.** The API cannot name the gateway's
   own default model, so it cannot pin one into the envelope. A SPLIT company whose
   `CompanyAiConfiguration.modelId` is null is refused with `AI_BUDGET_UNAVAILABLE`
   (`model_unknown`) rather than reserving against an unknown model. Setting the model is an
   operator action, consistent with the §9 readiness gate.
4. **`already_claimed` is mapped, not invented.** A duplicate invocation returns a typed
   `already_claimed` carrying the existing row's status. The meter maps `RESERVED`/`DISPATCHED` to
   `AI_BUDGET_BUSY` (another execution owns it; the LINE lanes already retry that, bounded) and any
   terminal status to `AI_BUDGET_UNAVAILABLE`. It is never a second provider execution.
5. **Sweep constants.** `RESERVED` older than **10 minutes** ⇒ `CANCELLED` with evidence
   `never_dispatched`; `DISPATCHED` older than **30 minutes** ⇒ `UNRESOLVED` (never released). The
   second is strictly greater than the longest caller timeout (195s receipt OCR) plus the 180s
   admission lease. The sweep is lazy: it runs inside the next reserve transaction for that
   company-month only.
6. **A `RESERVED` row that receives evidence is refused (`invalid-state`).** The `DISPATCHED` mark
   is committed before every provider call, so evidence for a `RESERVED` row is an ordering
   violation. Refusing keeps the hold rather than accepting money against a row the sweep may have
   already cancelled — but it also means such evidence is not recorded. Residual, see §12.
7. **Settlement prices the actual at the reservation's PINNED FX**, never at a fresh rate, so the
   hold and the settlement are comparable and history is never re-priced.
8. **Cancellation is structurally separated from the OCR count refund (R-05).**
   `cancelAiBudgetStep` needs an explicit `proof` from a closed union and the reservation's owner
   token; `releaseCompanyOcrAdmission` takes neither and cannot reach a reservation. The seams call
   it only for a refused OCR admission (`ocr_admission_refused`) or one of the exact pre-provider
   refusal shapes (`gateway_pre_provider_refusal`).
9. **Lock order as implemented.** `partner-ocr-config:<company>` → *(plan-term `SELECT … FOR UPDATE`
   where the action needs it)* → `platform-ai-budget` → `ai-budget:<company>:<pinned month>`, bucket
   rows CHAT then OCR. `reserve` takes all three advisory locks; `settle` and `cancel` take only the
   last; the admin writer takes all of them in that order (the `ai-budget` one added by this phase).
10. **The bucket aggregate is derived data with a tolerant delegate.** `upsertBucketUsage` and
    `readAiBudgetMonthSnapshot` skip the table when a (unit-test) client does not expose it, the
    `resolveEffectiveBudget` precedent. The authoritative money stays the `AiUsageEvent` rows and
    the month total written in the same transaction.
11. **API-side settlement of a multi-entry response.** Until E1c has the gateway settle each of its
    own invocations, a response carrying several usage entries settles the FIRST against the
    envelope and records the rest through the normal metering path with no `invocationKey`, warning
    `ai.budget.unenveloped_chain_usage`. Nothing is dropped; the remainder is metered but unheld.

## 12. Residuals for E1c and beyond

- `TIMEOUT_INPUT_TOKEN_CEILING = 200_000` (`bedrock.provider.ts:21`) is above every declared input
  bound, so a SPLIT timeout would settle above its hold and trip the breach path. Spec §12.3
  requires this to be covered by the reservation or the accounting fixed first. **E1c blocker.**
- `LineIntakeRouteRequest` carries no webhook event id, so a TEXT intake's attempt key is derived
  from its transport request id. A LINE redelivery under a new request id would buy a second hold.
  Closing it needs a contract field.
- A breach closes its scope until an operator clears `AiBudgetReservation.breach`; there is no
  operator surface for that yet (the flag is cleared by hand).
- No reconciliation surface for `UNRESOLVED` holds beyond the count in the admin read.
- Evidence arriving for a `RESERVED` row (note 6) is refused and therefore unrecorded. Accepting it
  with a HIGH alert would be the money-safer choice; deliberately left as the brief specified.
