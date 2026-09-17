# LINE intake cost benchmark — baseline (2026-09-17)

Stage 1 of งาน C ([spec §10](../specs/line-ai-ledger-lifecycle-remediation-spec-th.md), [plan §C/D1](../plans/line-ai-ledger-lifecycle-remediation-plan-th.md)).
This document records the frozen corpus, the measurement method, the **baseline** numbers measured
against real Amazon Bedrock, the deterministic prompt accounting, and a ranked list of optimisation
candidates. **No prompt, catalog, context builder, token bound or provider setting was changed to
produce it.** Nothing here is an implemented saving.

Related evidence: [Production intake cost and receipt flow](../agent-memory/line-intake-cost-and-budget-receipt-behavior-2026-09-17.md) (§8.2 Production reference: 48 `line.intake-route` calls / THB 55.67).

## 1. Method

- The corpus is a frozen TypeScript manifest, `scripts/line-ai-intake-cost.corpus.ts`, checked by
  `scripts/line-ai-intake-cost.corpus.spec.ts` (unique ids, complete expectations, §10.1 coverage,
  no realistic identifier, pinned content hash).
- The harness is `scripts/line-ai-intake-cost-benchmark.ts`. It runs in-process with **no NestJS
  server and no database**, and drives the real production entry points:
  - intake through `LineAiInternalController.lineIntakeRoute` (which builds the router, picks the
    document timeout for an attachment and binds the trusted capability flags);
  - the follow-on work production would then do for that route — the real `OrchestratorAgent` for a
    gateway turn, and `LineAiInternalController.receiptOcr` with the intake `documentText` forwarded
    exactly as `process-line-webhook.use-case.ts` forwards it;
  - all inside one `runWithUsageContext`, so every provider call's usage row (tag, model,
    input/output/cache-read/cache-write tokens, duration, ok) is captured the way production meters it.
- Only the model calls are real. The ERP tool client is a deterministic stub returning small
  synthetic read results (same approach as the existing `orchestrator-smoke.ts`), and the actor
  delegations the API's gateway client mints are minted with placeholder tokens the stub never redeems.
- Cost uses the repo's own pinned price map with per-call half-up satang rounding
  (`apps/api/src/modules/line-ai/application/ai-model-pricing.ts`) at a fixed `--thb-per-usd 33`.
  The after-run must use the same map and the same FX.
- Failures stay in the denominator. The report prints cost per **attempted** task next to cost per
  **successful** task, plus refusal / parse-failure / truncation rates (review finding F-12, R-12).
- Success is mechanical, never judged at run time: provider ok, parse ok, not truncated, the routed
  intent is in the manifest's allowed set, a `forbidCapture` row did not reach an expense-writing
  route, the named open clarifications were resolved, `documentText` was handed back where the
  manifest requires it, and the receipt fields match within the manifest's tolerance (amount and VAT
  as exact decimals after comma-stripping, date as an exact ISO string, vendor as a
  case-insensitive substring).
- "Refusal" counts a refusal-shaped route (`CLARIFY`, `UNSUPPORTED`, `MUTATION_REQUEST_REFUSAL`) that
  the manifest did **not** allow for that task; a row whose correct answer is a refusal is not a refusal.

### Follow-on decision (mirrors `process-line-webhook.use-case.ts`)

| route | text turn | image turn |
| --- | --- | --- |
| `CLARIFY` | answered from the intake call | answered from the intake call, media parked |
| `ADVISOR_CONVERSATION` with a servable draft | answered from the intake call | n/a (advisor is deleted when an attachment is present) |
| `EXPENSE_*`, `SIGNATURE_UPLOAD_TICKET`, `BUSINESS_DOCUMENT_REFERENCE` | deterministic dispatch, no model call | receipt OCR (signature excepted) |
| `BUSINESS_READ_QUESTION`, `UNSUPPORTED`, `MUTATION_REQUEST_REFUSAL`, router `UNAVAILABLE` | gateway turn behind `line.ai.query` | receipt OCR when the caption is empty; otherwise pending media + one question |

## 2. Environment and capability set

| key | value | source |
| --- | --- | --- |
| git revision | `2cfd0955630f396363f61189f0e1ba2db1f13b7a` | worktree `codex/line-ai-remediation-c-intake-cost-20260917` |
| chat model | `global.anthropic.claude-sonnet-4-6` | `infra/prod-ecs-express/deploy.sh` `PROD_CHAT_MODEL` |
| document model | `global.anthropic.claude-sonnet-4-6` | `deploy.sh` `PROD_DOC_MODEL` (identical to chat) |
| region | `ap-southeast-1` | `deploy.sh` `REGION="${AWS_REGION:-ap-southeast-1}"`; `BEDROCK_REGION` itself is a GitHub repo variable and is not readable from the repo — this is the documented value used by the runbook and `provider-smoke.ts` |
| AWS profile | `watchdog-bedrock` (owner-authorised, `bedrock-runtime` only) | — |
| `LINE_AI_ADVISOR_MODE` | `social` | `deploy.sh` default |
| `LINE_AI_FUSED_PLAN_SHADOW_ENABLED` | `true` | `deploy.sh` default |
| `LINE_AI_PREPARED_SIMPLE_READ_ENABLED` | `true` | `deploy.sh` default |
| `LINE_AI_DRAFT_EDIT_ENABLED` | `true` | `deploy.sh` default |
| `LINE_AI_TOOLUSE_LOOP_ENABLED`, `LINE_AI_COVERAGE_CRITIC_ENABLED` | `true` (= `$aiEnabled`) | `deploy.sh` gateway env block |
| `LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES` | `sales.get_sales_summary::single_metric,expense.list_recent::single_metric,accounting.get_summary::list,expense.get_daily_closing::single_metric` | `deploy.sh` default (applies to production too; the "UAT only" comment above it is stale) |
| `LINE_AI_SUBSTITUTE_SEMANTIC_ROUTING_MODE` | `off` | **never set by `deploy.sh`** → schema default |
| `LINE_AI_REIMBURSEMENT_SEMANTIC_MODE` | `off` | **never set by `deploy.sh`** → schema default |
| `AI_TOOL_TIMEOUT_MS` / `AI_MAX_TOOL_CALLS` | `15000` / `8` | `deploy.sh` gateway env block |
| resulting intake capabilities | `{ fusedPlan: true, advisor: true }` | `tryRouteIntake` applied to the flags above |
| FX | THB 33 / USD (fixed for before **and** after) | `--thb-per-usd 33` |

## 3. Corpus

- Content hash `cf9bce443b3012ef39a081670614b8651fa55483aa34043376978d4b13becce2`, pinned in
  `scripts/line-ai-intake-cost.corpus.spec.ts`.
- 41 tasks: **32 text**, **9 image**. 100% synthetic — invented Thai shop names, invented amounts, no
  tax id that passes the Thai 13-digit checksum, no LINE user-id shape, no phone number, no e-mail.
- Coverage (§10.1): greeting, casual chat, business reads (sales / expense total / expense breakdown
  / VAT / inventory / daily closing / glossary shorthand / AP outstanding / CRM / explain-own-record),
  text capture with amount+purpose, amount-only and purpose-only, two corrections of a recent
  capture, an answer to an open clarification, a bare number with the context expired, two
  denied-capability rows (no `line.ai.query`; capture without the receipt permission), two mutation
  refusals, capability/teach-me, draft continuation, two out-of-scope rows, and images: short thermal
  slip, 22-item long receipt, VAT-printed tax invoice, low-contrast rotated slip, handwritten-style
  cash bill, quantity-only check bill, signature crop, product photo, chat screenshot.
- Images are **generated**, never committed: the manifest carries a deterministic page spec that the
  harness renders SVG → JPEG/PNG through the already-installed `sharp`. Per-run sha256 is recorded in
  every JSONL row. Rendering is byte-identical on a given machine (verified); it depends on the host's
  fonts, so the manifest — not the pixels — is the freeze anchor.
- Where more than one route is allowed, the manifest states which contract sentence permits it and the
  spec fails the build if that reason is missing.

## 4. Baseline results

Run `baseline-2026-09-17T15-17-59-772Z`, 2 repetitions over the fixed order, 82 attempted tasks,
212 provider calls, **THB 70.47**, 0 failed provider calls, no budget stop.

### 4.1 Per kind and per pass

| group | attempted | completed | successful | refusal | parse fail | truncation | calls/task | THB/attempted | THB/successful | routing acc. | p50 ms | p90 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| overall | 82 | 81 | 76 | 0.0% | 1.2% | 0.0% | 2.59 | 0.86 | 0.93 | 95.1% | 7300 | 24436 |
| text | 64 | 63 | 60 | 0.0% | 1.6% | 0.0% | 2.38 | 0.60 | 0.64 | 93.8% | 6529 | 18895 |
| image | 18 | 18 | 16 | 0.0% | 0.0% | 0.0% | 3.33 | 1.77 | 1.99 | 100.0% | 22684 | 84796 |
| pass 1 | 41 | 40 | 38 | 0.0% | 2.4% | 0.0% | 2.56 | 0.82 | 0.89 | 95.1% | 7524 | 24436 |
| pass 2 | 41 | 41 | 38 | 0.0% | 0.0% | 0.0% | 2.61 | 0.89 | 0.96 | 95.1% | 7179 | 23122 |

Latency excludes the harness's own pacing sleep (see §7).

### 4.2 Tokens and cost by component

| group | input | output | cache read | cache write |
| --- | ---: | ---: | ---: | ---: |
| overall | 141,892 | 73,414 | 1,300,961 | 57,695 |
| text | 102,344 | 31,280 | 1,003,289 | 24,821 |
| image | 39,548 | 42,134 | 297,672 | 32,874 |

Component cost for the whole run: **output THB 36.34 (51.6%)**, input THB 14.05 (19.9%), cache read
THB 12.88 (18.3%), cache write THB 7.14 (10.1%). (Separately rounded components sum to THB 70.41
against the authoritative per-call total of THB 70.47 — the same rounding gap §8.2 records.)

This is the opposite shape from the Production sample in §8.2, where cache write was the largest
intake component (THB 20.86). The reason is measured, not guessed: see §4.4.

### 4.3 Per usage tag (so a saving cannot hide by moving tag)

| tag | calls | input | output | cache read | cache write | THB | cold | warm | no cache |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `line.intake-route` | 82 | 44,302 | 40,092 | 927,331 | 33,327 | 37.56 | 3 | 79 | 0 |
| `ocr.receipt.extract` | 24 | 11,002 | 15,951 | 127,160 | 11,560 | 11.68 | 2 | 22 | 0 |
| `line.loop` | 36 | 54,326 | 6,707 | 0 | 0 | 8.70 | 0 | 0 | **36** |
| `line.plan-route` | 28 | 1,594 | 3,317 | 242,649 | 8,987 | 5.35 | 1 | 27 | 0 |
| `ocr.receipt.image-reread` | 8 | 6,116 | 2,783 | 0 | 0 | 1.97 | 0 | 0 | 8 |
| `ocr.receipt.image-read` | 10 | 9,728 | 2,012 | 0 | 0 | 1.97 | 0 | 0 | 10 |
| `line.critic` | 14 | 7,474 | 1,192 | 0 | 0 | 1.33 | 0 | 0 | 14 |
| `line.compose` | 8 | 7,282 | 1,214 | 0 | 0 | 1.32 | 0 | 0 | 8 |
| `line.casual` | 2 | 68 | 146 | 3,821 | 3,821 | 0.59 | 1 | 1 | 0 |

`line.intake-route` is 53.3% of the corpus cost — the same dominance §8.2 measured on Production (69%).

### 4.4 Cold versus warm intake (measured per call)

| intake call | n | mean input | mean output | mean cache read | mean cache write | THB / call |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| text, warm | 63 | 494 | 291 | 12,013 | 0 | **0.312** |
| text, cold | 1 | 447 | 364 | 0 | 12,013 | **1.710** |
| image, warm | 16 | 706 | 1,189 | 10,657 | 0 | **0.764** |
| image, cold | 2 | 703 | 1,186 | 0 | 10,657 | **1.975** |

A cold intake costs **5.5×** a warm one on text and **2.6×** on image. The corpus runs back to back, so
96% of its intake calls are warm; Production's sample was 31% cold. **The baseline therefore
under-states the cold-cache share of real cost — the per-call cold figures above are the ones to
weight against Production traffic, not the run averages.**

Two prefixes exist, and they are different byte-for-byte:

- text intake: system 21,219 chars + catalog 22,659 chars → 12,013 cached tokens;
- image intake: system 16,800 chars + catalog 22,659 chars → 10,657 cached tokens
  (`routeIntake` deletes the `advisor` capability when an attachment is present, which removes the
  4,419-char advisor section and makes the image prompt a different prefix).

Consequence, measured: `image-thermal-short` was **cold in both passes** (25 minutes apart) at
THB ~3.00 each, while the text prefix stayed warm across 30 consecutive tasks. Every "first photo
after a chat" pays a full 10,657-token cache write.

### 4.5 Lanes

| lane | tasks | calls | THB | THB / task |
| --- | ---: | ---: | ---: | ---: |
| image → receipt OCR chain | 16 | 58 | 31.28 | 1.96 |
| text → full agentic turn (plan-route + loop + critic + compose) | 28 | 116 | 25.91 | 0.93 |
| text → intake only (advisor direct, capture, correction, clarify, denied) | 30 | 30 | 10.89 | 0.36 |
| text → prepared simple-read lane | 6 | 6 | 1.88 | **0.31** |
| image → intake only (signature) | 2 | 2 | 0.51 | 0.26 |

A business read that qualifies for the prepared simple-read lane costs **THB 0.31 and one call**; the
same shape of question that does not qualify costs **THB 0.93 and 4.1 calls**. Only 6 of 34
business-read turns qualified, because `LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES` allowlists four
(tool, answerShape) pairs.

### 4.6 Quality

- Routing accuracy 95.1% overall (text 93.8%, image 100%).
- OCR field accuracy: `grandTotalAmount` 10/10, `expenseDate` 10/10, `vatAmount` 2/2,
  `vendorName` 8/10.
- Truncation 0/82. Parse failure 1/82. Zero failed provider calls.
- `documentText` was returned for every receipt/reference image (157–1,166 chars) and reused by
  receipt OCR — the short thermal slip and the low-contrast slip cost **2** model calls end to end
  because stage one was skipped.

The six unsuccessful task-runs, in full:

| task | pass | outcome | routed | why it failed |
| --- | ---: | --- | --- | --- |
| `text-capture-amount-only` | 1, 2 | completed | `EXPENSE_DOCUMENT_CAPTURE` | "350 บาท" with no purpose was routed to capture, twice. The prompt's own rule is that a new spend note needs an amount **and** a purpose. |
| `text-out-of-scope-product-advice` | 1 | parse_failed | — | `ROUTER_JSON_PARSE_FAILED` on "ช่วงนี้ควรขายอะไรดีคะ". |
| `text-out-of-scope-product-advice` | 2 | completed | `ADVISOR_CONVERSATION` | Same message routed to social advice rather than `UNSUPPORTED`/business read. |
| `image-vat-tax-invoice` | 1, 2 | completed | `EXPENSE_DOCUMENT_CAPTURE` | Vendor transcribed "สมมติ**ช**ัพพลาย" instead of "สมมติ**ซ**ัพพลาย" (ซ/ช glyph confusion). Total, VAT and date were all exact. |

These are baseline behaviour, not harness bugs. They are the rows an after-run must not make worse.

## 5. Prompt accounting

Measured on the wire (the harness wraps `BedrockProvider` and records each call's block sizes; it
stores sizes and payload key names only, never prompt text). Mean chars per intake call:

| block | text intake | image intake |
| --- | ---: | ---: |
| system prompt | 21,219 | 16,800 |
| cacheable catalog block | 22,659 | 22,659 |
| dynamic user payload | 1,324 | 1,335 |
| image bytes | 0 | 18,728 |
| `maxTokens` | 1,500 | 8,000 |

Measured cacheable-prefix density: **3.69 chars per cache-write token** (3 cold samples).

| system-prompt variant | chars |
| --- | ---: |
| legacy base (no capability) | 13,121 |
| + fused-plan section only | 16,800 |
| + advisor section only | 17,540 |
| production text (fused + advisor) | 21,219 |
| production image (fused; advisor deleted) | 16,800 |
| fused-plan section | **3,679** |
| advisor section | **4,419** |

| cacheable block key | chars | note |
| --- | ---: | --- |
| `enabledFeatures` | 20,558 | 56 tools; sent on every intake call |
| `disabledFeatures` | 1,702 | 5 tools |
| `businessGlossary` | 339 | moved out of the payload when `fusedPlan` is on — no duplication |

| dynamic payload field | text | image | note |
| --- | ---: | ---: | --- |
| `permissions` | 843 | 895 | 64% of the dynamic payload; contract-protected, **not** a candidate |
| `activeCategories` | 243 | 243 | only usable by capture routes |
| `attachments` | 2 | 91 | |
| `messageText` | 30 | 2 | |
| `conversationContext` | 41 | 0 | mean over all text rows (present on 5) |
| `recentCapturedExpenses` | 18 | 0 | mean over all text rows (present on 3) |
| `valueCandidates` | 21 | 0 | |
| `openClarifications` / `activeExpenseDrafts` | 5 / 5 | 0 | |
| `locale` | 7 | 7 | |
| `enabledFeatures` | 2 | 2 | always `[]` — see finding F-b below |

Structural findings from the accounting:

- **(c) The cacheable prefix is already byte-stable.** `cacheableContext` is
  `JSON.stringify({ businessGlossary, ...buildFeatureCatalog(draftEditEnabled) })` — pure static
  registry data — and the system prompt is static per capability set. No tenant or user data sits in
  or before the cached prefix. There is nothing to fix here; the dynamic payload is already after it.
- **(b) There is no literal duplication inside the intake system prompt** (checked line by line: one
  repeated fragment, the `"confidence"/"missingFields"` schema tail, which belongs to two different
  hint objects). The glossary is sent once, permissions are described once.
- **(b') The duplication is between calls, not inside one.** A full-agentic business read serialises
  the same tool registry twice — 22,659 chars in the intake prefix and 25,544 chars in the
  `line.plan-route` prefix — and pays two separate cached prefixes (12,013 + 8,987 tokens).
- **(F-b) `enabledFeatures` in the payload is dead.** `tryRouteIntake` never sets it, so it is always
  `[]`, while the system prompt says "Use the feature/tool catalog from the user payload as the
  source of truth" and "Pick the best matching enabled feature" — and the real catalog lives in the
  cacheable block under the *same key name*. Zero money, but it is a prompt/payload contradiction.
- **(F-c) The intake catalog and the plan-route catalog disagree.**
  `LineAiInternalController.lineIntakeRoute` builds `new IntentRouterAgent(provider)` and never passes
  `draftEditEnabled`, so intake sees 56 tools / 20,558 chars while the orchestrator's `line.plan-route`
  (built with `this.config.lineAiDraftEditEnabled`) sees 61 tools / 23,443 chars in production. A fused
  prepared plan therefore can never propose a draft-edit tool. This is a **bug report, not a saving** —
  fixing it would grow the intake prefix by ~2,885 chars.
- **(F-d) `line.loop` is not cached at all.** 36 calls, 54,326 input tokens, zero cache read and zero
  cache write. `ORCHESTRATOR_NATIVE_LOOP_PROMPT` is ~2,458 chars, below `CACHE_MIN_CHARS` (4,000), so
  `systemBlocks()` emits no checkpoint, and `generateWithTools` is never given a `cacheableContext`.
  The provider's own comment ("one system checkpoint covers toolConfig + system for
  `generateWithTools`") only holds when the system prompt clears that floor — this one does not, so
  the tool schemas are re-sent at full input price on every iteration.

## 6. Ranked optimisation candidates

None of these is implemented. Each says what changes, which §10.2 item it sits under, the measured or
bounded saving and which token component it comes from, the risk, what would prove it safe, and
whether it can merely move cost to another tag.

### R1 — Cache the native tool loop's prefix (`line.loop`)

- **What:** give `generateWithTools` in `dispatchByNativeToolLoop` the `cacheableContext` seam that
  already exists on the provider port (or raise the loop system prompt past `CACHE_MIN_CHARS`), so the
  `toolConfig` + system prefix reaches a cache checkpoint.
- **§10.2 item:** 3 (cache prefix), measured rather than assumed.
- **Measured saving:** `line.loop` is THB 8.70 / 12.3% of the run, entirely uncached input (1,509
  input tokens per call, 36 calls). Input at $3/M becomes cache read at $0.30/M after the first call
  of a prefix: bound is THB 8.70 → ~THB 2.6, i.e. **~THB 6.1 (8.7% of the corpus)**, minus one cache
  write per new tool set. Component: input → cache read.
- **Risk:** low for quality (no prompt wording changes). The real question is byte-stability: the
  `toolConfig` is built from the plan's tools, so it varies per turn. The saving is real for
  iterations 2..n of a turn and for repeated tool sets; it could be near zero for one-iteration turns
  and adds a cache write. **Must be measured, not assumed** — this run has 36 loop calls over 28
  turns, i.e. 1.3 iterations/turn, so the within-turn benefit is small and the cross-turn benefit is
  the load-bearing part.
- **Proves it safe:** the existing `orchestrator-native-loop.agent.spec.ts` plus the corpus's 20
  business-read rows (routing accuracy and tool choice unchanged, `line.loop` cache counters non-zero).
- **Tag movement:** none — the saving stays inside `line.loop`.

### R2 — Do not send the fused-plan section or the tool catalog on an IMAGE intake call

- **What:** the same trick `routeIntake` already applies to `advisor` — when
  `request.attachments?.length`, drop `caps.fusedPlan` so `FUSED_PLAN_SECTION` and the
  `cacheableContext` catalog are not built for that call.
- **§10.2 items:** 1 (only the capabilities the server actually uses) and 3 (cache prefix).
- **Measured saving:** the image prefix is 39,459 chars → 10,657 cached tokens today. Without the
  section and the catalog it is 13,121 chars → ~3,555 tokens at the measured 3.69 chars/token, i.e.
  **7,100 fewer prefix tokens per image intake call**: THB 0.070 warm, **THB 0.879 cold**. On this run
  (2 cold + 16 warm image intakes) that is THB 2.88, **4.1% of the corpus** — but it is worth more on
  Production traffic, where §4.4 shows the image prefix goes cold between photo bursts. Components:
  cache write and cache read.
- **Why it is safe by construction:** production can never consume a prepared plan produced on an
  image turn. The media path in `process-line-webhook.use-case.ts` never builds a `LineAiTurnRequest`;
  it answers deterministically or calls receipt OCR. The prompt itself already orders the model to
  omit `preparedPlan` "whenever ... an attachment". The image call already has its own prefix, so this
  shrinks an existing prefix rather than splitting a shared one, and 13,121 chars still clears
  `CACHE_MIN_CHARS`.
- **Risk:** the catalog also grounds a `BUSINESS_READ_QUESTION`-on-a-photo decision and the
  disabled-tool vocabulary. Routing on the four non-receipt image rows could move.
- **Proves it safe:** all 9 image rows keep their routing (100% today), `documentText` stays in the
  157–1,166 char band, OCR field accuracy does not drop, and `line-intake-router.agent.spec.ts` stays
  green.
- **Tag movement:** none. It cannot push work to `ocr.*` because `documentText` is unchanged.

### R3 — Stop asking an IMAGE intake for `captureHints` fields the media path discards

- **What:** on a turn that carries an image, ask for the capture hints the API actually reads and omit
  the rest.
- **Evidence:** on the media path (`process-line-webhook.use-case.ts` 5990–6131) only
  `sourceDocumentType`, `sourceDocumentLanguage`, `confidence`, `expenseCategoryId` and
  `businessPurpose` are consumed. `vendorName`, `description`, `amount`, `expenseDate`, `vatMode`,
  `items[]` and `missingFields` are discarded, because `ocr.receipt.extract` re-derives them from
  `documentText` and `decideLineBusinessDocument` takes `ocr.classification ?? routePlan.documentClassification`
  — OCR wins whenever it ran. So the model is paid to itemise the receipt twice.
- **§10.2 items:** 4 (task-appropriate output) and 5 (remove a duplicate path that is genuinely there).
- **Bounded saving:** image intake output averages **1,189 tokens** (max 4,792) and is **76% of a warm
  image intake's cost** — image intake output alone is 21,384 of the run's 40,092 intake output tokens.
  The discarded hint fields are a real but unmeasured slice of that; the 22-item receipt's 4,792-token
  response is the upper end. Estimate THB 0.07–0.30 per image intake; **the after-run must measure it,
  not the proposal.** Component: output.
- **Risk:** the one thing that must not shrink is `documentText`. If transcription gets shorter, receipt
  OCR falls back to its own image read (+THB ~0.20 and ~16s) or loses a number — exactly what C-03
  forbids.
- **Proves it safe:** the five receipt rows keep exact total / VAT / date / vendor, `documentText`
  chars stay in band, and `ocr.receipt.image-reread` call counts do not rise.
- **Tag movement:** yes, this is the risk — a thinner intake could push work into `ocr.receipt.*`.
  The per-tag table in §4.3 is exactly the check for it.

### R4 — Reuse the intake route instead of re-routing in `line.plan-route`

- **What:** when intake already returned a `preparedPlan` whose `intentPlan` re-validates, let the
  orchestrator adopt that intent plan instead of calling `router.route()` again — even when the
  prepared *simple-read lane* is not eligible for the deterministic formatter.
- **§10.2 item:** 5 (remove a duplicate model call that really exists).
- **Measured saving:** `line.plan-route` is THB 5.35 / 7.6% of the run (28 calls) and ~3s of latency
  per business read. It is a second full router call over the same message with a second 8,987-token
  cached prefix. Components: cache read/write plus output.
- **Risk: highest of the four.** The shadow comparison already logs disagreement
  (`line.ai.fused_plan.shadow` reported `intentMatch:false` on a probe), so adopting the fused plan
  changes which tool runs on some turns. Everything the fresh route does — `normalizePlanToolAccess`,
  the explain-record rescue, the joke rescue, the `unsupported_yet` relabel — would have to keep
  running on the adopted plan.
- **Proves it safe:** the 20 business-read rows keep their tool choice and answer, the invalid/forged
  prepared-plan cases in `prepared-simple-read-security.spec.ts` still execute zero calls, and the
  shadow log agreement rate is reported before and after.
- **Tag movement:** yes by design — it deletes a tag rather than moving it, but a wrong tool choice
  would move cost into extra `line.loop` iterations. Watch `line.loop` calls/turn.

### R5 — Widen the deterministic formatter allowlist (biggest money, biggest scope)

- **What:** compile deterministic formatters for more (tool, answerShape) families so more business
  reads take the prepared simple-read lane.
- **Measured saving:** **THB 0.62 per business-read turn** (THB 0.93 full-agentic vs THB 0.31 prepared),
  and 4.1 calls → 1. On this corpus, 28 of 34 business reads missed the lane; converting them all
  would remove ~THB 17 of THB 70.47 (**24%**) and most of the latency.
- **Why it is listed last despite being the largest:** this is **not a prompt trim**. Each new family
  is a new compiled deterministic answer replacing a model-composed one — a product behaviour change
  with its own formatter, its own tests and its own review. It also cannot be judged from cost alone:
  a deterministic answer is not the same answer.
- **Recommendation:** do not fold this into งาน C. Record the number, raise it to the owner as its own
  decision.

### Measured and deliberately NOT proposed

- **`permissions` (843–895 chars, 64% of the dynamic payload).** §10.2 item 2 forbids trimming
  permissions to save tokens. Not a candidate.
- **`activeCategories` (243 chars ≈ 66 tokens ≈ THB 0.007 warm).** Gating it on "attachment or amount
  candidate or active draft" would save less than a satang per turn and would make the payload's shape
  depend on message class. Rejected on cost/benefit, not on principle.
- **`documentClassification` on image intake.** OCR's classification wins whenever OCR runs, but the
  intake copy still drives the in-gateway `requiresClarification` downgrade
  (`intent-router.agent.ts` 514–519) and the reference reply when OCR does not run (no capture
  permission, OCR failure). Not safe to drop. At most the three free-text signal arrays
  (`evidenceSignals`, `amountSignals`, `settlementSignals`) are arguable; small and not worth the risk
  in this round.
- **Lowering the image `maxTokens` bound (8,000).** Observed image intake output reached 4,792 tokens
  on the 22-item receipt — 60% of the ceiling. The ceiling is not a per-call charge and cutting it is
  exactly the C-03 truncation trap. Leave it.
- **Anything to do with the model, a keyword classifier, extra provider calls, or cache TTL.** Out of
  scope per §10.2 item 6.

### Suggested order

R1 → R2 → R3, then a separate decision on R4, and R5 raised to the owner as its own piece of work.
R1+R2+R3 are bounded at roughly **THB 9–12 of THB 70.47 (13–17%)** on this corpus, weighted more
heavily on Production traffic because of the cold-prefix behaviour in §4.4, and none of them touches
permissions, provenance, clarification state or the model.

## 7. Limitations

- **Synthetic images.** Pages are rendered from SVG, so they are cleaner than camera photos: no
  crumpling, glare, skew beyond the one deliberate 5° rotation, or thermal fading. Absolute OCR
  accuracy here is an upper bound. The handwritten row uses a handwriting font that has no Thai
  glyphs, so its Thai lines fall back to a printed face and only its numerals look handwritten.
- **Warm-dominated cache.** 96% of intake calls in this run were warm because the corpus runs back to
  back; the Production sample in §8.2 was 31% cold. Use the per-call cold/warm figures in §4.4, not
  the run averages, when reasoning about Production money.
- **Stubbed ERP tools.** Tool results are small and always `ok`, so `line.loop` and `line.compose`
  see less input than a real read with a long list, and no tool error path is exercised.
- **n = 2 per task.** Enough to see a stable route and a stable cost band, not enough for a
  statistical claim about a small routing change.
- **Pacing.** The harness sleeps `--pace-ms 2000` before each provider call because an unpaced run hit
  `PROVIDER_THROTTLED` inside a tool loop on this account. The sleep is subtracted from the reported
  latency and changes no prompt, payload or provider setting; wall-clock is recorded separately.
- **Region.** `BEDROCK_REGION` is a GitHub repo variable, so the production value could not be read
  from the repo; `ap-southeast-1` is the value the runbook and `provider-smoke.ts` document.
- **The corpus is frozen by hash, the images by machine.** The same manifest on a host with different
  fonts renders different pixels. Re-run the after-run on the same machine, or compare the recorded
  image sha256 values first.
- **`ocr.receipt.extract-repair` and the provider-timeout path were never exercised** (0 parse repairs,
  0 timeouts), so their cost is not in this baseline.

## 8. Exact commands

```sh
# integrity of the frozen corpus (no provider, safe anywhere)
cd <worktree>
pnpm exec tsx --test scripts/line-ai-intake-cost.corpus.spec.ts

# render the synthetic pages and print their sha256 (no provider)
cd <worktree>/apps/ai-gateway
pnpm exec tsx ../../scripts/line-ai-intake-cost-benchmark.ts --dry-run --out <scratch>/out

# one real call, to prove credentials before spending anything
MODEL_PROVIDER=bedrock AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 \
  BEDROCK_REGION=ap-southeast-1 BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6 \
  pnpm exec tsx ../../scripts/line-ai-intake-cost-benchmark.ts --smoke --label smoke \
  --ledger <scratch>/spend-ledger.jsonl

# the baseline run recorded above (THB 70.47)
MODEL_PROVIDER=bedrock AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 \
  BEDROCK_REGION=ap-southeast-1 BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6 \
  AI_PROMPT_LOGGING_ENABLED=false \
  pnpm exec tsx ../../scripts/line-ai-intake-cost-benchmark.ts \
    --label baseline --repetitions 2 --max-thb 70 --thb-per-usd 33 --pace-ms 2000 \
    --out <scratch>/baseline --ledger <scratch>/spend-ledger.jsonl

# the gateway specs this work must not disturb
cd <worktree>
pnpm --filter @watchdog-bms/ai-gateway exec tsx --test \
  src/modules/line-ai/agents/line-intake-router.agent.spec.ts
```

The harness must never run in CI. Raw JSONL, summary JSON and the per-run Markdown table stay in the
scratch directory; only the manifest, its spec, the harness and this document are committed.
