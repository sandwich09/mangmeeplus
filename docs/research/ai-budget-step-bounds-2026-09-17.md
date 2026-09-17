# AI budget step bounds — declared upper bounds, pricing and feasibility (2026-09-17)

- Scope: Phase E1b of the [LINE AI ledger-lifecycle remediation](../specs/line-ai-ledger-lifecycle-remediation-spec-th.md) §12.3, ADR [0013](../adr/0013-ai-budget-split-reservations.md) §3/§6, review gate **R-01** (feasibility table) and criterion **E-05** (bounds cover cold cache, max output, images, bounded multi-call, timeout estimate).
- Code: `packages/contracts/src/ai-budget-bounds.ts` (the table), `apps/api/src/modules/line-ai/application/ai-model-pricing.ts` (`priceAiStepUpperBound`).
- The numbers in §4 are **asserted** in `apps/api/src/modules/line-ai/application/ai-model-pricing.spec.ts`, so changing a declared bound is a visible diff in this document and in that test.

## 1. Why the table is per CHAIN, not per provider call

A reservation's identity is `<companyId>#<attemptKey>#<stepKind>#<ordinal>`, and `ordinal` is the
bounded call index *inside* the step kind. The gateway asks for its next invocation through
`POST /internal/ai/budget-step`, which can only validate `0 <= ordinal < maxCalls` if `maxCalls`
belongs to the chain rather than to one call. So there is one step kind per provider chain, and:

- `maxCalls` = the chain's declared provider-call ceiling;
- `maxOutputTokens` = the **maximum** `maxTokens` across every call the chain can make (so the
  bound covers each of them);
- `maxInputTokens` = a declared per-invocation input ceiling (§3).

ADR 0013 §3 lists the sub-steps (`read / extract / extract-repair / image-reread`) as the coverage a
route-level bound must have, which is what §2 documents call by call.

## 2. Every provider call a SPLIT company can reach, with its real `maxTokens`

Surveyed exhaustively across `apps/ai-gateway/src` (every `usageTag` call site). Line numbers are
from the branch `codex/line-ai-remediation-e1b-reservations-20260917`.

| Step kind | Provider call (usageTag) | File:line | `maxTokens` passed | Defined at |
| --- | --- | --- | --- | --- |
| `line-intake-text` | `line.intake-route` (no image) | `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts:415` | `1500` fused-plan / `1000` plain | same file `:423` |
| `line-intake-image` | `line.intake-route` (with image) | `…/intent-router.agent.ts:415` | `8000` | `INTAKE_DOCUMENT_MAX_TOKENS`, `…/intent-router.agent.ts:32`, used at `:423` |
| `line-turn` | `line.plan-route` | `…/intent-router.agent.ts:550` | `500` | same file `:563` |
| `line-turn` | `line.loop` (native tool loop) | `…/agents/orchestrator.agent.ts:974` | `1024` | same line |
| `line-turn` | `line.loop` (`chooseNextTool`) | `…/orchestrator.agent.ts:1081` | `300` | same file `:1101` |
| `line-turn` | `line.critic` | `…/agents/coverage-critic.agent.ts:43` | `500` | same file `:57` |
| `line-turn` | `line.casual` | `…/agents/response-composer.agent.ts:406` | `180` | same file `:418` |
| `line-turn` | `line.compose` | `…/response-composer.agent.ts:561` | `600` | same file `:573` |
| `line-turn` | `line.polish` | `…/response-composer.agent.ts:615` | `500` | same file `:618` |
| `receipt-ocr` | `ocr.receipt.image-read` / `ocr.receipt.pdf-read` | `…/modules/line-ai/presentation/http/line-ai-internal.controller.ts:286` | `4096` | same file `:294` |
| `receipt-ocr` | `ocr.receipt.image-reread` | `…/line-ai-internal.controller.ts:219` | `4096` | same file `:223` |
| `receipt-ocr` | `ocr.receipt.extract` / `ocr.receipt.extract-repair` | `…/line-ai-internal.controller.ts:308` | `8192` | `RECEIPT_EXTRACTION_MAX_TOKENS`, same file `:40` |
| `bank-statement` | `ocr.bank-statement.image-read` | `…/line-ai-internal.controller.ts:286` (shared reader) | `4096` | same file `:294` |
| `bank-statement` | `ocr.bank-statement` | `…/line-ai-internal.controller.ts:371` | `4000` | same file `:374` |
| `crm-summary` | `crm.summary` | `…/modules/crm-customer-ai/agents/crm-conversation-summary.agent.ts:21` | `1600` | same file `:24` |
| `crm-reply-draft` | `crm.reply` | `…/agents/crm-customer-reply.agent.ts:40` | `500` | same file `:43` |
| `crm-intake` | `crm.intake` | `…/agents/crm-customer-intake.agent.ts:22` | `200` | same file `:25` |
| `crm-customer-profile-extract` | `crm.profile-extract` | `…/agents/crm-customer-profile-extract.agent.ts:18` | `350` | same file `:21` |
| `crm-booking-extract` | `crm.booking-extract` | `…/agents/crm-booking-extract.agent.ts:21` | `300` | same file `:24` |
| `crm-insights` | `crm.insights` | `…/agents/crm-insights.agent.ts:27` | `600` | same file `:30` |
| `crm-broadcast` | `crm.broadcast` | `…/agents/crm-broadcast.agent.ts:9` | `1200` | same line |
| `crm-trust-score` | `crm.trust` | `…/agents/crm-trust-score.agent.ts:23` | `200` | same file `:26` |
| `draft-generate` | `ai.draft` | `…/modules/ai-draft/generate-draft.use-case.ts:38` | `900` | same file `:41` |

Notes from the survey:

- `line.loop` is the only tag emitted from two call sites with **different** `maxTokens` (1024 and
  300), so the declared `line-turn` output bound is 1024.
- `ocr.bank-statement.pdf-read` is emittable by the tag template but unreachable: the statement
  route rejects non-JPEG/PNG at `line-ai-internal.controller.ts:356`.
- `crm-trust-score` has **no API caller today** (`crm-ai-gateway.client.ts` exposes seven CRM
  methods, not this one). It is declared anyway so the route cannot become reachable unbounded.
- The provider defaults (`input.maxTokens ?? 2048` / `?? 1024`, `bedrock.provider.ts:63`/`:116`,
  `openai.provider.ts:74`/`:150`) are unreachable from any tagged production call site — every one
  of them passes `maxTokens` explicitly.
- `TIMEOUT_INPUT_TOKEN_CEILING = 200_000` (`bedrock.provider.ts:21`) is the legacy conservative
  timeout accounting: an aborted Converse call is metered at 200k input tokens. That is **above**
  every declared `maxInputTokens` here, so it is a known gap — see §5.

### `line-turn` call ceiling

`AI_MAX_TOOL_CALLS` is `z.coerce.number().int().positive().max(8).default(8)`
(`packages/config/src/index.ts:483`) and becomes the orchestrator's `budget`
(`orchestrator.agent.ts:430` → `:521`). It bounds tool *executions*, and transitively provider
calls. Worst case for one `/internal/ai/line-turn`:

| Part | Calls |
| --- | --- |
| `line.plan-route`, including its `attempt < 2` retry loop (`intent-router.agent.ts:549`) | 2 |
| `line.loop` — 8 tool iterations + a final no-tool turn + one resume after an uncovered verdict | 10 |
| `line.critic` — guarded by `judges < 2` (`orchestrator.agent.ts:991`, `:1065`) | 2 |
| one of `line.casual` / `line.compose`, plus `line.polish` | 2 |
| **declared `maxCalls`** | **16** |

## 3. How `maxInputTokens` was chosen

`maxOutputTokens` is measured (§2). `maxInputTokens` is a **declared ceiling that E1c enforces**
before the provider runs, so it has to be above every real prompt and low enough that a supported
cap can start the work. Method:

1. **Measured static scaffolding.** `LINE_TOOL_REGISTRY` serialises to **32,067 bytes** across 66
   tools (measured on this branch) — the largest single static block in a LINE turn. The agent
   sources that embed system prompts are at most ~86 KB *of source*, of which the prompt text is a
   fraction. JSON and English prose tokenise at roughly 3–4 bytes per token, so the static part of
   a turn prompt is on the order of 10–15 k tokens.
2. **Transport ceiling as the hard upper limit.** The gateway parses internal JSON at
   `HTTP_BODY_LIMIT` = `1mb` (`packages/config/src/index.ts:177`, applied at
   `apps/ai-gateway/src/main.ts:54`; base64-media routes get 16 MB at `:53`). A UTF-8 byte length is
   a safe upper bound for tokens, so 1 MB ≈ 1 M tokens is the *enforceable* ceiling — far too loose
   to reserve against (1 M Sonnet cache-write tokens ≈ ฿123 per invocation), which is exactly the
   F-01 problem. The declared bound therefore sits well below it and E1c refuses in between.
3. **Images: a fixed per-image ceiling.** `AI_BUDGET_IMAGE_TOKEN_CEILING = 2_000`. A vision image is
   billed at roughly `(w × h) / 750` tokens and is capped near 1,600 for a 1568 px image; 2,000 is a
   round ceiling above that. The document reader sends at most two images (original + rotated
   alternate, `line-ai-internal.controller.ts:291-293`), so 4,000 tokens of image budget.
4. **Documents: a documented conservative rule.** `AI_BUDGET_DOCUMENT_PAGE_TOKEN_CEILING = 3_000`
   per PDF page. The declared 30,000-token document bound therefore admits **at most 8 pages**
   alongside ~6,000 tokens of instructions; E1c must refuse a larger document rather than exceed the
   hold.

Resulting declared input ceilings, with the headroom over the estimate in (1):

| Step kind | `maxInputTokens` | Rationale |
| --- | --- | --- |
| `line-turn` | 40,000 | ~10–15 k static (tool specs + system prompt) + accumulated tool results and history over up to 8 tool turns. ≈ 2.7–4× headroom. |
| `line-intake-image`, `receipt-ocr`, `bank-statement` | 30,000 | 4,000 image tokens (2 × 2,000) **or** ≤ 8 PDF pages at 3,000, plus the OCR markdown and the category catalogue the extract stage re-sends. |
| `line-intake-text` | 20,000 | Intake prompt + the ~21 KB fused-plan catalogue + a LINE text message (≤ 5,000 chars). |
| every CRM step, `draft-generate` | 20,000 | Server-built facts/citations or a bounded inbox thread; no catalogue larger than the intake one. |

These are **declared**, not measured against production traffic — this session has no production
access. §5 records that as the residual.

## 4. Pricing formula and the feasibility table (R-01)

```text
inputRate  = max(prices.input, prices.cacheWrite)        # a cold cache writes the whole prompt
usdPerMTok = maxInputTokens × inputRate + maxOutputTokens × prices.output
bound      = ceil(usdPerMTok × thbPerUsd × 100 / 1e6)    # UP, per INVOCATION (spec §12.3)
attempts   = 1                                            # E1c pins the SDK
```

- Prices come from the existing pinned map (`AI_MODEL_PRICES`); an **unknown model** costs out at
  the maximum configured price and is never free.
- Rounding is up **per invocation** because a chain of N calls holds N ceilings: rounding once after
  summing would let N half-up actuals exceed one summed hold.
- The bound pins model id, unit rates, the FX rate *and its source*, the token bounds and the
  attempt count onto `AiBudgetReservation.pricingSnapshot`, and settlement prices the actual at that
  same pinned FX — never at today's rate.

**Feasibility at FX 33.** `minimum bucket cap to start` = the bound itself (spend and holds are 0 at
that point). `worst chain` = `bound × maxCalls`, which is what the whole route can hold if every
step is funded.

| Step kind | `maxCalls` | Sonnet bound (satang / ฿) | Sonnet worst chain (฿) | Haiku bound (satang / ฿) | Haiku worst chain (฿) |
| --- | --- | --- | --- | --- | --- |
| `line-intake-text` | 1 | 322 / 3.22 | 3.22 | 26 / 0.26 | 0.26 |
| `line-intake-image` | 1 | 768 / 7.68 | 7.68 | 63 / 0.63 | 0.63 |
| `line-turn` | 16 | 546 / 5.46 | 87.36 | 44 / 0.44 | 7.04 |
| `receipt-ocr` | 4 | 777 / 7.77 | 31.08 | 64 / 0.64 | 2.56 |
| `bank-statement` | 2 | 575 / 5.75 | 11.50 | 47 / 0.47 | 0.94 |
| `crm-summary` | 1 | 327 / 3.27 | 3.27 | 27 / 0.27 | 0.27 |
| `crm-reply-draft` | 1 | 273 / 2.73 | 2.73 | 22 / 0.22 | 0.22 |
| `crm-intake` | 1 | 258 / 2.58 | 2.58 | 21 / 0.21 | 0.21 |
| `crm-customer-profile-extract` | 1 | 265 / 2.65 | 2.65 | 22 / 0.22 | 0.22 |
| `crm-booking-extract` | 1 | 263 / 2.63 | 2.63 | 22 / 0.22 | 0.22 |
| `crm-insights` | 1 | 278 / 2.78 | 2.78 | 23 / 0.23 | 0.23 |
| `crm-broadcast` | 1 | 307 / 3.07 | 3.07 | 25 / 0.25 | 0.25 |
| `crm-trust-score` | 1 | 258 / 2.58 | 2.58 | 21 / 0.21 | 0.21 |
| `draft-generate` | 1 | 293 / 2.93 | 2.93 | 24 / 0.24 | 0.24 |

### What a product cap can actually do

Using the spec's own illustration (`T=100`, `C=30`, `O=70` **baht**, test values only):

- **Sonnet.** A ฿30 CHAT cap starts a LINE turn (needs ฿5.46) and can fund about 5 of its steps
  before the chain hits `insufficient` and returns its usable partial result. A ฿70 OCR cap starts a
  receipt read (needs ฿7.77) and can fund one full 4-call receipt chain (฿31.08) twice over.
- **Haiku.** The same caps are ample: a whole worst-case turn is ฿7.04 and a whole receipt chain
  ฿2.56.

This is the conservative-refusal consequence ADR 0013 §10 records: near the limit a step is refused
before `spent` reaches the cap, which is why the admin console reports spent / reserved / available
separately and the customer copy says "เหลือไม่พอ", never "เต็ม".

## 5. Known looseness and residuals

1. **The input ceilings are declared, not measured against production.** They have documented
   headroom over the static scaffolding measured here, but no session with production log access has
   confirmed the p100 real prompt. E1c must land its request-size check with a shadow/measure step
   before any company is switched to SPLIT.
2. **`TIMEOUT_INPUT_TOKEN_CEILING = 200_000` is above every declared bound.** An aborted Bedrock
   call is still metered at 200k input tokens (`bedrock.provider.ts:248-257`), which would settle
   above the hold and trip the breach path on every SPLIT timeout. Spec §12.3 is explicit that this
   must be covered by the reservation **or** the accounting fixed first, and that lowering the
   estimate to 0 to pass the gate is forbidden. E1c owns this: the conservative estimate must become
   the declared bound, not the legacy ceiling.
3. **`line-turn`'s 16-call ceiling is arithmetic, not observed.** It is derived from the config
   maximum and the loop guards; a measured p100 turn length would let it be tightened.
4. **Byte length as a token bound is loose for Thai** (roughly 2–4×), as ADR 0013 §10 already notes.
5. **The bound is one number for a whole chain**, so a cheap `line.casual` invocation holds the same
   1,024-output ceiling as a `line.loop` one. Tightening this needs per-call step kinds, which in
   turn needs the gateway to name the sub-step in `budget-step`; deliberately not done in E1b.
