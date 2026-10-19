# Agent Memory: LINE AI credit cost analysis — 2026-10-19

Status: Analysis complete; no money/model/budget behavior changed.
Owner: Starter shop owner, UAT retest 15:10–15:14; code lane W3.
Scope: Explain insufficient-credit refusals, configured reservation bounds, uncached intake input, and cheaper routing options.
Decisions: Preserve reserve sizes, credit amounts, maxCalls, model selection, budget contract/digest and final mutation gates.
Open questions: Exact failing invocation's pricing snapshot, live FX, outstanding holds and complete usage distribution were not supplied. No cloud, network, database or provider call was made here.
Artifacts: [Measured builder output](../evidence/line-uat2-20261019-intake-cost-measurements.json), [exact-input synthetic routes](../evidence/line-uat2-20261019-router-replays.json).
Verification: Offline `IntentRouterAgent.routeIntake` with a capturing provider; prices and arithmetic checked against current code. Measurements are bytes, not invented provider token counts.
Next: Owner review of options, then a separate approved change and real-model eval if desired.

## What the supplied evidence establishes

The owner increased the chat allowance from 80 to 100 baht. The supplied UAT observations are 4,900–6,800 **uncached** input tokens, 23,653 cache-read tokens, 117–298 output tokens and 3–5 seconds per `line.intake-route`. The first call wrote 23,653 cache tokens. Refusals were `ai_budget_insufficient`, including an earlier case with 15.43 baht left. These are owner-supplied observations, not logs independently retrieved in this lane.

At the repository's configured Sonnet rates and **33 THB/USD**, one warm intake costs **0.78–1.05 baht**; the midpoint example (5,850 input, 208 output) is **0.92 baht**. A cold prefix costs **3.47–3.75 baht** for that same usage range, about **2.69 baht extra** versus a cache hit. That buys approximately **95–129 warm intake calls per 100 baht**, before cold starts, repairs, planning, composition, OCR and other work. These are intake calls, not complete claim conversations or guaranteed successful messages.

This does **not** establish that a handful of messages consumed 100 baht. Admission checks the next invocation's hold against the remaining relevant cap/funding after outstanding holds. `insufficient` means that hold does not fit; `exceeded` means the applicable spend has reached its cap. Increasing one allowance does not prove that TOTAL, CHAT, funding-cycle availability and outstanding holds all allow the next invocation.

Sources: [pricing](../../apps/api/src/modules/line-ai/application/ai-model-pricing.ts) (`computeCostSatang`, `priceRenderedAiInvocationV2`), [reservation](../../apps/api/src/modules/line-ai/application/company-ai-budget-reservation.ts) (`decideAiBudgetStep`, `reserveAiBudgetStep`, `planAiCreditFunding`), [FX](../../apps/api/src/modules/line-ai/application/ai-fx-rate.ts) (`resolveThbPerUsd`). Actual rows pin their own FX; **all baht estimates below scale by actual FX / 33**. The live cache/stored FX can differ from the config fallback of 33.

## A. Holds and the actual cost are different quantities

Actual cost, once per invocation, in satang:

```text
round_half_up(100 × FX / 1,000,000 ×
  (uncached_input × input_rate + output × output_rate
   + cache_read × cache_read_rate + cache_write × cache_write_rate))
```

Configured USD per million tokens:

| Reviewed tariff | Input | Output | Cache read | Cache write |
|---|---:|---:|---:|---:|
| Sonnet 3.5 / Sonnet 4.6 | 3 | 15 | 0.30 | 3.75 |
| Haiku 3 | 0.25 | 1.25 | 0.03 | 0.30 |
| GPT-4.1 mini, v2 exact tariff only | 0.40 | 1.60 | 0.10 | 0.40 |

The first two rows live in `AI_MODEL_PRICES`; all exact v2 model IDs/rates live in [AiGatewayClient](../../apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.ts), `LINE_V2_TARIFFS`. GPT must not be priced through the legacy unknown-model fallback. These are pinned repository prices, not a claim about current public vendor pricing.

Reservation per invocation, in satang:

```text
ceil(100 × FX / 1,000,000 ×
  (input_bound × max(input_rate, cache_write_rate)
   + requested_output_bound × output_rate))
```

The hold assumes a cold cache, including prefix tokens. A later hit lowers actual settlement but **does not lower this hold**. Cache reads are separate from uncached input in the supplied Bedrock usage; do not add them to uncached input and then also charge them as cache reads.

**V2 caps** from [AI_BUDGET_PROFILES_V2](../../packages/contracts/src/ai-budget-bounds.ts); these are the largest allowed envelopes, not the hold every ordinary turn always takes:

| Profile / calls using it | Input cap/call | Output cap/call | maxCalls/profile | Sonnet baht/call | Sonnet sum at profile cap | Haiku baht/call |
|---|---:|---:|---:|---:|---:|---:|
| intake text | 160,000 | 4,096 | 2 | 21.83 | 43.66 | 1.76 |
| intake image | 160,000 | 8,000 | 2 | 23.76 | 47.52 | 1.92* |
| control: semantic planner, `line.loop`, plan-route, critic | 160,000 | 2,048 | 3 | 20.82 | 62.46 | 1.67 |
| answer: compose, casual, polish | 160,000 | 4,096 | 2 | 21.83 | 43.66 | 1.76 |
| document QA / `ocr.*` under a v2 grant | 160,000 | 8,192 | 2 | 23.86 | 47.72 | 1.93* |
| public lookup, token component only | 32,000 | 4,096 | 1 | 5.99 | 5.99 | 0.49 |

`*` Arithmetic only: reviewed Haiku capacity permits 4,096 output tokens, so an 8,000/8,192-output invocation fails the model-capacity check. It is not a drop-in image/OCR replacement. Public lookup additionally needs an approved hosted-tool tariff; Sonnet/Haiku rows above do not authorize hosted lookup. For the reviewed GPT tariff, two hosted units add 0.66 baht external fees plus 0.2112 baht for 16,000 content-input tokens before per-invocation rounding; the maximum public invocation is **1.51 baht** at FX 33.

V2 uses the **rendered** input rather than reserving 160,000 on every call:

```text
text_bytes = utf8_bytes(canonical JSON(systemPrompt, cacheableContext, messages, tools))
            + 2,000 per image + 3,000 per admitted PDF page
input_bound = max(1,024, ceil((text_bytes + 4,096) / 1,024) × 1,024)
output_bound = this provider call's maxTokens
```

Sources: [ai-budget-provider](../../apps/ai-gateway/src/common/usage/ai-budget-provider.ts), `v2RenderedInput`, `v2ProfileFor`, `admitV2`; [authority](../../apps/api/src/modules/line-ai/application/line-ai-budget-authority.service.ts), `issue`, `narrow`, `reserve`. Private turns have **4 normal slots + 1 repair**, bounded again by per-profile maxCalls; do not add 2+3+2 profile counts and call that a permitted turn. Holds are acquired per invocation, not one up-front charge equal to the sum. The image intake still uses the CHAT cost bucket but has `fundsAiCredit: false`; do not equate every internal provider cost with a chat-credit debit.

**Legacy step bounds** remain relevant to older envelope paths and separate receipt capture. Source: `AI_BUDGET_STEP_BOUNDS` and `priceAiStepUpperBound`:

| Legacy chain | Input/call | Output/call | maxCalls | Sonnet baht/call | Sonnet chain ceiling | Haiku baht/call |
|---|---:|---:|---:|---:|---:|---:|
| intake text | 20,000 | 1,500 | 1 | 3.22 | 3.22 | 0.26 |
| intake image | 30,000 | 8,000 | 2 | 7.68 | 15.36 | 0.63* |
| turn: router + loop + critic + compose/polish | 40,000 | 1,024 | 16 | 5.46 | 87.36 | 0.44 |
| receipt OCR | 30,000 | 8,192 | 8 | 7.77 | 62.16 | 0.64* |
| receipt capture read | 30,000 | 8,192 | 1 per chunk | 7.77 | 7.77/chunk | 0.64* |
| receipt capture extract | 30,000 | 8,192 | 1 per window | 7.77 | 7.77/window | 0.64* |

Legacy chain ceilings sum separately rounded holds; they are not actual spend or simultaneous holds. The 16-call derivation is in [step-bound research](../research/ai-budget-step-bounds-2026-09-17.md). `line-turn` has one shared profile even when an individual legacy compose requests only 600 tokens. V2 [semantic turn](../../apps/ai-gateway/src/modules/line-ai/agents/semantic-turn-v2.ts) requests 2,048 for control and 1,536 for ordinary compose / 4,096 for detailed compose; those calls map to control/answer above. There is **no separate claim money profile**: claim options/preview tools use existing reimbursement guards, and AI planning/composition uses these same LINE profiles.

### Why a claim can be refused with 15–20 baht left

The measured synthetic Starter request with four prior turns renders an input bound of **100,352**, holding **14.45 baht** at 4,096 output tokens; 15 prior turns renders **104,448 / 14.96 baht**. More categories, read descriptors, pending tasks or native tool results can enlarge the next call. Examples using the exact estimator/pricing formula:

| Rendered input bound | Output bound | Required hold |
|---:|---:|---:|
| 112,640 | 4,096 | 15.97 baht |
| 122,880 | 4,096 | 17.24 baht |
| 131,072 | 4,096 | 18.25 baht |
| 160,000 | 4,096 | 21.83 baht |

Thus **15.43 left cannot admit a 15.97 hold**, even if actual usage would settle near 1 baht. A 14.45 intake might fit, settle, then leave too little for a larger control/compose invocation. This explains the class of refusal; the supplied logs do not identify which bound or funding/cap caused that exact refusal. Reconciliation needs the failed `ai.budget.step_refused`/admission observation, its scope, live holds, and adjacent `AiBudgetReservation.pricingSnapshot`/`AiUsageEvent` rows. Do not infer a 20-baht actual charge from a 20-baht hold.

### A tighter observed-usage candidate, not an implemented rule

No true p95 is available from a range alone. As an **upper-observed proxy**: 23,653 cached-prefix + 6,800 uncached = **30,453 total input tokens**. With 20% headroom, rounded to 1,024-token blocks, input becomes **36,864**; round output 298 × 1.2 to **512**. The cold-cache hold would be **4.82 baht**, versus the measured 14.45–14.96 or the maximum text-profile 21.83. **Actual per-message price is unchanged** by tightening a hold.

To derive real p95, group `PROVIDER_REPORTED`, `MODEL_CALL` usage by exact model, requestKind and usageTag, retaining cold/warm and successful/failed calls separately. Use input + cacheRead + cacheWrite for the total context distribution, output separately; inspect repairs and claim-loop result growth too. Usage is emitted by `BedrockProvider.logProviderUsage` as `ai.usage`, collected by `usage-context`, persisted in `AiUsageEvent` (`usageTag`, counters, usageBasis, pricingSnapshot), and in reservation `evidenceJson`; writers are `recordCompanyAiUsage` in `company-ai-usage-meter.ts` and `settleAiBudgetStep` in `company-ai-budget-reservation.ts`. No new telemetry was added.

Example read-only query for a future connected audit (not executed here):

```sql
SELECT "modelId", "usageTag", "requestKind", count(*),
 percentile_cont(0.95) WITHIN GROUP (ORDER BY
   "inputTokens" + "cacheReadInputTokens" + "cacheWriteInputTokens") AS p95_input,
 percentile_cont(0.95) WITHIN GROUP (ORDER BY "outputTokens") AS p95_output
FROM "AiUsageEvent"
WHERE "companyId" = $1 AND "monthKey" = '2026-10'
 AND "eventKind" = 'MODEL_CALL' AND "usageBasis" = 'PROVIDER_REPORTED'
GROUP BY "modelId", "usageTag", "requestKind";
```

A percentile is not a safe maximum: long Thai replies, images, cold prefixes, schemas, accumulated tools, output repairs and provider framing can exceed it. A lower input ceiling rejects those messages; lowering maxTokens can truncate valid JSON and trigger repairs. Replacing the byte estimator with a tokenizer estimate without a proven bound risks spending above the hold; existing breach handling can close admission pending operator acknowledgement. Any production tightening needs approved contract/estimator/profile changes and overflow evidence. None was made here.

## B. What is uncached and what could change

`IntentRouterAgent.routeIntake` already caches the system prompt and the fused glossary/tool catalogue. [BedrockProvider](../../apps/ai-gateway/src/modules/line-ai/infrastructure/provider/bedrock.provider.ts) emits cache checkpoints at **4,000 characters**; the uncached user message carries serialized JSON. A cache hit does not make the per-turn payload free.

The offline measurement invokes the real payload builder using the exact `ค่าอาหาร` input, real evidence/candidate builders, Starter feature preset, registry owner permission superset (required + any-of permissions), five categories, one delivered read descriptor, and an existing J7 task-projection fixture. Four-turn and 15-turn histories use only user previews, following the API's current context shape. It captures provider input without dispatching a model. This is a **representative synthetic request**, not the actual missing UAT request. It includes more owner permissions than a particular shop may have; tool availability still applies Starter features. Reproduce with `/private/tmp/line-uat2-cost-measure.cjs` via `pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx ...` in this workspace.

| Per-turn JSON component | Four prior turns, UTF-8 bytes | Fifteen prior turns, UTF-8 bytes | Treatment |
|---|---:|---:|---|
| chatActions: IDs, Thai titles, groups | 3,151 | 3,151 | Constant catalogue; candidate for cached prefix |
| permissions | 2,050 | 2,050 | Fresh authority data; trim only redundant representation, not checks |
| enabledFeatures | 380 | 380 | Fresh entitlement data; preserve scope |
| activeCategories | 299 | 299 | Company-specific names/IDs; content/revision keyed if cached |
| conversationContext | 1,253 | 3,650 | User history + latest read context; bound relevant history |
| readContextCandidates | 452 | 1,733 | Derived dates/periods from history; overlaps history but supplies normalized candidates |
| taskProjection | 687 | 687 | Required task/revision/slot binding; retain current task authority |
| resumableTaskRefs | 136 | 136 | Small ready-to-copy references; removing risks the already observed taskRef errors |
| inputEvidenceParts | 299 | 299 | Current text/hash/spans; provenance required |
| valueCandidates | 274 | 274 | Normalized current money/date evidence; required |
| messageText | 40 | 40 | Repeats current text; removing requires parser/grounding eval |
| locale / attachments | 29 | 29 | Small |
| **Complete JSON payload including punctuation** | **9,064** | **12,742** | Exact serialized size |

Both requests also carry **56,222 bytes system prompt + 26,077 bytes cached context**. Nested conversation sizes: four-turn user previews **875 bytes**, fifteen-turn **3,272 bytes**, recentReads **252 bytes** in either. The API permits **15 turns in 15 minutes**, with stored previews capped at **240 characters** (`loadConversationContext`, `PREVIEW_MAX_CHARS` in the webhook use case). Stored assistant replies are already excluded from model input. Read memory is capped at three entries, up to ten shown items per entry at the runtime boundary; larger real descriptors/categories/open clarifications can add substantially more than this sample.

Other conditional fields are retainedTaskSource, openClarifications/readClarificationCandidates, recentCapturedExpenses, activeExpenseDrafts, approvedKnowledge and substituteContext. They are not present in this sample and are not counted as zero-sized real UAT fields. See the payload literal in [intent-router.agent.ts](../../apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts). The tokenized contribution of each field cannot be recovered exactly from aggregate 5–7k usage. Byte counts are exact here; the savings below use proportional byte shares as a labeled approximation, not a provider tokenizer.

At the observed midpoint 5,850 uncached / 23,653 cached / 208 output, using the fifteen-turn sample for allocation:

| Analysis-only lever | Approximate token movement | Estimated warm intake price | Saving/message |
|---|---|---:|---:|
| current observed midpoint | — | 0.92 baht | — |
| move constant chatActions into cached prefix | ~1,447 uncached → cache-read | 0.79 baht | ~0.13 baht / 14% |
| reduce relevant history from 15 to 4 turns, including derived candidates | remove ~1,689 uncached | 0.75 baht | ~0.17 baht / 18% |
| both, same baseline, disjoint fields | ~1,447 cached + ~1,689 removed | 0.62 baht | ~0.30 baht / 32% |

Approximation formula: `5850 × removed_or_moved_bytes / 12742`; removed input saves `tokens × 3 × 33 / 1e6`; moved input saves `tokens × (3 − 0.3) × 33 / 1e6`. Same output and successful prefix reuse are assumed. Combined midpoint capacity rises from ~109 to **~161 intake calls / 100 baht**. Cold writes, repair rates, changed tokenization and extra tool calls can erase part of the gain. Moving static fields into cache **does not reduce today's cold-priced reservation**; trimming bytes can. Do not move permissions/current tasks into a shared static prefix or discard their checks. Relevance trimming must retain exactly the task/question and evidence the user is continuing.

## C. Cheaper models and the evaluation needed

[provider.factory.ts](../../apps/ai-gateway/src/modules/line-ai/infrastructure/provider/provider.factory.ts) supports Bedrock and OpenAI; direct Anthropic keys are local-only. It enforces approved provider/model/region lists and the signed grant's exact model. [Config defaults](../../packages/config/src/index.ts) approve APAC Sonnet 3.5 and APAC Haiku 3. Exact v2 tariffs/capacities also review Sonnet 4.6 global and GPT-4.1 mini (including its dated ID), but that does **not** mean those IDs are enabled in this environment. Global Sonnet requires the named global-inference approval and reference; OpenAI requires its key and approved processing region/model. No approval or model config was changed.

At the same supplied token counts and configured FX, Haiku arithmetic is **0.069–0.092 baht/warm intake**, approximately **91% cheaper**, around **1,090–1,456 intake calls/100 baht** before other work. GPT-4.1 mini arithmetic is **0.149–0.184 baht**, about **81–83% cheaper**. These are same-token counterfactuals: model tokenization, cache reuse, output lengths, retries and quality must be measured rather than assumed equal.

Haiku 3 has a reviewed **4,096 output** limit and 200k context; text intake fits the declared capacity, while existing image/OCR output requests do not. More importantly, a v2 grant pins **one model for the whole turn**: `createProvider` takes grant.model before a workload override. Selecting Haiku just for intake and retaining Sonnet for the rest is not an existing per-call switch; it would need an approved authority/budget design. A model-free LINE route likewise needs the owner's approval. W3 authorizes neither.

The quality risk is routing/grounding, not prose style: Thai fragments, picker continuations, missing reasons, distinguishing expense/employee claim, multiple intents, UTF-16 evidence spans, exact candidate IDs, task revisions, forged/stale sources, hostile instructions and valid `decisionV1` JSON. A cheap misroute can cost a retry or create the wrong draft; the W1 API guard remains necessary with either model.

An approval-quality eval would run identical accepted request snapshots against Sonnet and the cheaper candidate, including these four exact owner inputs and existing exam/whole-chain cases; require **zero** unauthorized/unasked/final mutations, zero description-only expenses, same claim continuity, no false save claims, and preserved refusal/permission/tenant boundaries. Compare intent/writeIntent/semantic outcome, taskRef/evidence grounding, complete semantic coverage, malformed-output/repair/refusal rates, cold/warm token usage and total conversation cost, plus p50/p95 latency. Use at least repeated runs across the mandatory corpus and a held-out Thai continuation set; passing mocked JSON replays alone cannot establish cheaper-model quality. Reject savings that disappear after retries, downstream calls or owner corrections. Keep all existing money and final-button rules throughout the eval.

## Owner summary — five lines

ตอนนี้เฉพาะการอ่านเจตนาข้อความอยู่ที่ประมาณ 0.78–1.05 บาท/ครั้ง หรือราว 95–129 ครั้งต่อ 100 บาทค่ะ
เงินเหลือ 15.43 บาทก็ถูกปฏิเสธได้ หากงานถัดไปต้องกันไว้ 15.97 บาท; ตัวอย่างขอบเขตตาม usage อยู่ราว 4.82 บาท แต่ลดเงินกันไม่ได้ลดค่าใช้จริงค่ะ
ย้ายรายการปุ่มคงที่เข้าแคชคาดว่าประหยัดประมาณ 0.13 บาท/ครั้ง และตัดประวัติที่ไม่เกี่ยวข้องประมาณ 0.17 บาท/ครั้งค่ะ
ถ้าทำสองอย่างร่วมกัน ตัวอย่างกลางลดจาก 0.92 เหลือราว 0.62 บาท/ครั้ง หรือประมาณ 161 ครั้งต่อ 100 บาท ก่อนงานขั้นอื่นค่ะ
Haiku ตามราคาที่ตั้งไว้อาจเหลือราว 0.07–0.09 บาท/ครั้ง ประหยัดประมาณ 91% แต่ต้องทดสอบคุณภาพก่อน และรอบนี้ยังไม่เปลี่ยนกติกาเงินหรือโมเดลค่ะ
