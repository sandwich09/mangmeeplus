# LINE intake cost benchmark — baseline and after (2026-09-17)

Stage 1 (baseline, §1–§7) and Stage 2 (implementation and re-measurement, §9–§12) of งาน C ([spec §10](../specs/line-ai-ledger-lifecycle-remediation-spec-th.md), [plan §C/D1](../plans/line-ai-ledger-lifecycle-remediation-plan-th.md)).
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

---

# Stage 2 — implemented, measured

Controller decision: implement **R1, R2, R3 only**. Outcome: **R2 and R3 shipped; R1 measured and
reverted** because its premise did not hold (§9.1). R4 and R5 are recorded, not done (§11).

Re-measured on the SAME frozen corpus (hash `cf9bce44…`), same model, region, capability set,
FX 33, `--pace-ms 2000`, 2 repetitions. Run `after-2026-09-17T16-05-…` versus baseline
`baseline-2026-09-17T15-17-59-772Z`.

## 9. What changed

### 9.1 R1 — cache the native tool-loop prefix: implemented, measured, REVERTED

Implemented as the controller specified: the `generateWithTools` checkpoint gate was widened to weigh
`toolConfig` + system (tools precede system in the Converse cached prefix), Bedrock's own minimum-size
rule kept, no TTL or other provider setting touched, OpenAI untouched, and the tool specs sorted by
name so the same tool set serialises to the same bytes.

It bought nothing, because the prefix is too small to cache at all:

| loop prefix | chars | ≈ tokens | clears the model's 1,024-token cache floor? |
| --- | ---: | ---: | --- |
| system prompt alone (`ORCHESTRATOR_NATIVE_LOOP_PROMPT`) | 2,382 (on the wire) | ~650 | no |
| + 1 tool + `ask_user` (`expense.get_breakdown`) | 2,968 | ~804 | no |
| + 1 tool + `ask_user` (`expense.explain_record`, the largest single tool) | 3,368 | ~913 | no |
| + 3 tools + `ask_user` | 3,866 | ~1,048 | borderline |

Measured on the wire with R1 in place: `line.loop` still reported `cacheReadInputTokens=0` and
`cacheWriteInputTokens=0` on every call. Three ways, as asked:

| `line.loop` | today (uncached) | after-cold (cache write) | after-warm (cache read) |
| --- | --- | --- | --- |
| measured | 36 calls, 54,326 input tokens, THB 8.70 | **never occurred** — no checkpoint materialised | **never occurred** |

There is therefore no cold penalty to weigh against a warm share, and no break-even point to state:
the change is inert, not a loss. The baseline's attribution of THB 8.70 to "an uncached prefix" was
**wrong**, and this is the correction: the 54,326 input tokens are dominated by the **per-call user
message** (messageText + subRequests + conversationContext + valueCandidates, 233–681 chars) plus the
`tool_results` transcript that grows with each iteration — all of which sit AFTER the prefix and cannot
be cached by a prefix checkpoint. Shipping an inert provider change would be dead code, so R1 was
reverted in full (`bedrock.provider.ts`, its spec, and the `nativeToolSpecs` sort all restored to the
merge commit). `line.loop` cost is unchanged between the two runs (THB 8.70 → 8.95, run-to-run
variance on an untouched path).

The real lever on `line.loop` is the per-call payload and the number of iterations, which is R4/R5
territory, not a caching change.

### 9.2 R2 — no fused-plan section and no tool catalog on an IMAGE intake: SHIPPED

`intent-router.agent.ts` `routeIntake` now deletes `caps.fusedPlan` for a request that carries an
attachment, in the same place and style as the existing `advisor` deletion. Consequences, all verified:

- the image system prompt becomes the legacy non-fused prompt (previously shipped behaviour);
- `cacheableContext` is not built at all, so the 22,659-char tool catalog is gone from image calls;
- **the glossary still reaches the model**: with `fusedPlan` off, `businessGlossary` returns to the
  DATA payload through the existing legacy branch — measured on the wire, 339 chars, image column;
- the image system prompt is 12,499 chars, still above `CACHE_MIN_CHARS` (4,000), so the image prefix
  **still gets its cache checkpoint** — measured cache read 3,504 tokens per warm image intake;
- `maxTokens` for an image stays 8,000 and the `documentText` instruction is byte-identical.

Empirical check the controller asked for: **0 image intakes emitted a `preparedPlan`** — 0 of 5 on the
PRE-change code (run `prechange-preparedplan-count`, the fused section and catalog present) and 0 of
18 after. The model already never produced one for a picture, so the section and the catalog were paid
for and discarded on every image turn. Structurally it could never have been used either: the media
path in `process-line-webhook.use-case.ts` never builds a `LineAiTurnRequest`, the only carrier of
`preparedPlan`.

### 9.3 R3 — stop asking an IMAGE intake for capture hints the media path discards: SHIPPED

Proof first, read-only, as required. Every read of `routePlan.captureHints` reachable from
`executeReceiptUploadInner` (`process-line-webhook.use-case.ts` 5423–6160) and from everything it
calls:

| file:line | field read |
| --- | --- |
| `process-line-webhook.use-case.ts:5994` | `sourceDocumentType` — and only as a fallback behind `sourceDocumentTypeFromClassification(decision.classification)` |
| `process-line-webhook.use-case.ts:5996` | `sourceDocumentLanguage` |
| `process-line-webhook.use-case.ts:6003` | `confidence` |
| `process-line-webhook.use-case.ts:6006` | `expenseCategoryId` |
| `process-line-webhook.use-case.ts:6009` | `confidence` |
| `process-line-webhook.use-case.ts:6032` | `confidence` |
| `process-line-webhook.use-case.ts:6112` | `confidence` |
| `process-line-webhook.use-case.ts:6133` | `businessPurpose`, and only when the caption literally contains it |

Callees checked and confirmed NOT to read capture hints: `decideLineBusinessDocument`
(`process-line-webhook.use-case.ts:511`, reads `status`, `intent`, `documentClassification` and the OCR
result only, and prefers `ocr.classification ?? routePlan.documentClassification`);
`LineExpenseDraftConversationUseCase.startFromReceipt`
(`line-expense-draft-conversation.use-case.ts:120`, takes `ocrFields` / `businessPurpose` /
`suggestedCategoryId`); `handleSubstituteMediaArrival` (deterministic caption and awaiting-scan signals);
`ensurePendingMedia`, `appendMediaClarification`, `createLineSignatureAsset` (no hint reads).

The two full-hint consumers are on the TEXT path only and are untouched:
`process-line-webhook.use-case.ts:4349/4442/4503` → `CaptureLineExpenseNoteUseCase` →
`expense-document.use-case.ts:133/142/152/160/177` (`validateCaptureHints`), and
`captureBeforeSubstituteContinuation` (`process-line-webhook.use-case.ts:6957`, called once at 3857,
signature `event: LineTextEvent`, and it BUILDS its own `{ amount, description }` rather than reading
the route plan's).

So an image turn is now asked for `targetExpenseId`, `sourceDocumentType`, `sourceDocumentLanguage`,
`businessPurpose`, `expenseCategoryId` and `confidence` only, and told explicitly not to return
`vendorName`, `description`, `amount`, `expenseDate`, `vatMode`, `items` or `missingFields`.
`targetExpenseId` is **kept** deliberately even though the media path never consumes it: it is one
short string and the one field whose absence could silently detach an answer from its draft.
`documentClassification`, `documentText` and the 8,000-token bound are untouched. Both shapes remain
acceptable to `parseIntakePlan`, which builds `captureHints` key by key with every field optional, so a
gateway and an API of different vintages interoperate in both directions.

**One wording iteration was needed and is worth recording.** The first version of the new section said
"return ONLY these, and put everything you read from the page in documentText instead". That pushed a
longer transcription (thermal slip 398 → 441 chars), which destabilised stage 2's item reconciliation
and fired the vision re-read: the short thermal slip went from **2 calls to 4** (THB 2.47). Removing
that clause and replacing it with "documentText itself is UNCHANGED: transcribe the page exactly as its
own field description above requires, no more and no less" put it back to 2 calls at THB 1.23 cold /
0.85 warm. An output instruction that mentions `documentText` at all has to be neutral about its
length.

## 10. Before / after

### 10.1 Overall, text, image

| group | attempted | successful | calls/task | THB / attempted | THB / successful | routing acc. | parse fail | truncation | p50 ms | p90 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| overall before | 82 | 76 | 2.59 | 0.86 | 0.93 | 95.1% | 1 | 0 | 7,300 | 24,436 |
| overall after | 82 | **77** | 2.59 | **0.75 (−13.2%)** | **0.79 (−14.3%)** | **96.3%** | **0** | 0 | 7,432 | 24,798 |
| text before | 64 | 60 | 2.38 | 0.60 | 0.64 | 93.8% | 1 | 0 | 6,529 | 18,895 |
| text after | 64 | **61** | 2.38 | 0.59 (−2.6%) | 0.62 (−4.2%) | **95.3%** | **0** | 0 | 6,735 | 19,678 |
| image before | 18 | 16 | 3.33 | 1.77 | 1.99 | 100% | 0 | 0 | 22,684 | 84,796 |
| image after | 18 | 16 | 3.33 | **1.31 (−26.0%)** | **1.47 (−26.0%)** | 100% | 0 | 0 | **18,310 (−19%)** | **68,160 (−20%)** |

Run total THB 70.47 → **61.19**. Calls per task identical at every level. Zero failed provider calls in
both runs. The text path's ±3% is run-to-run variance on a byte-identical prompt, not an effect: the
per-call warm text intake is THB 0.312 → 0.315.

### 10.2 Cost by component (whole run)

| component | before | after |
| --- | ---: | ---: |
| output | 36.34 | **31.12** |
| input | 14.05 | 14.32 |
| cache read | 12.88 | 11.87 |
| cache write | 7.14 | **3.88** |

Tokens: output 73,414 → 62,861; cache write 57,695 → 31,376; cache read 1,300,961 → 1,198,526.

### 10.3 Per usage tag — nothing moved to another tag

| tag | calls | THB before | THB after | out tokens | cache write tokens |
| --- | ---: | ---: | ---: | --- | --- |
| `line.intake-route` | 82 → 82 | 37.56 | **28.31 (−24.6%)** | 40,092 → 29,528 | 33,327 → 7,008 |
| `ocr.receipt.extract` | 24 → 24 | 11.68 | 11.47 | 15,951 → 15,578 | 11,560 → 11,560 |
| `line.loop` | 36 → 36 | 8.70 | 8.95 | 6,707 → 7,203 | 0 → 0 |
| `line.plan-route` | 28 → 28 | 5.35 | 5.36 | 3,317 → 3,316 | 8,987 → 8,987 |
| `ocr.receipt.image-reread` | 8 → 8 | 1.97 | 1.97 | 2,783 → 2,800 | 0 → 0 |
| `ocr.receipt.image-read` | 10 → 10 | 1.97 | 1.95 | 2,012 → 1,969 | 0 → 0 |
| `line.critic` | 14 → 14 | 1.33 | 1.31 | 1,192 → 1,185 | 0 → 0 |
| `line.compose` | 8 → 8 | 1.32 | 1.28 | 1,214 → 1,135 | 0 → 0 |
| `line.casual` | 2 → 2 | 0.59 | 0.59 | 146 → 147 | 3,821 → 3,821 |

Every saving lands in `line.intake-route`. Call counts are identical tag by tag, and no other tag moved
by more than THB 0.25. C-02's "not merely moving cost to another tag" is satisfied by construction here.

### 10.4 Intake per call, cold and warm

| intake call | n | input | output | cache read | cache write | THB / call |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| image cold before | 2 | 703 | 1,186 | 0 | 10,657 | 1.975 |
| image cold after | 2 | 841 | **725** | 0 | **3,504** | **0.875 (−55.7%)** |
| image warm before | 16 | 706 | 1,189 | 10,657 | 0 | 0.764 |
| image warm after | 16 | 844 | **570** | **3,504** | 0 | **0.399 (−47.8%)** |
| text warm before | 63 | 494 | 291 | 12,013 | 0 | 0.312 |
| text warm after | 64 | 494 | 296 | 12,013 | 0 | 0.315 (flat) |
| text cold before | 1 | 447 | 364 | 0 | 12,013 | 1.710 |
| text cold after | 0 | — | — | — | — | not sampled |

The image prefix fell from 39,459 chars / 10,657 cached tokens to 12,499 chars / 3,504 cached tokens
(−67%), and image intake output from a mean of 1,188 tokens (max 4,792) to **587 (max 1,451)**. Those
two numbers are R2 and R3 respectively.

Weighted at Production's observed intake mix (69% warm / 31% cold, §8.2): an image intake goes from
`0.69×0.764 + 0.31×1.975 = THB 1.14` to `0.69×0.399 + 0.31×0.875 = THB 0.55` — **−52%**. Text intake is
unchanged at either mix.

### 10.5 Attribution per proposal

The three changes touch disjoint tags, so the full run attributes them without extra spend:

| proposal | where it shows | measured effect |
| --- | ---: | --- |
| R1 | `line.loop` cache counters | **none** — prefix below the model's cache floor; reverted (§9.1) |
| R2 | image `line.intake-route` cache write / read tokens | 10,657 → 3,504 cached prefix tokens per call: THB **−1.10** cold, **−0.07** warm |
| R3 | image `line.intake-route` output tokens | 1,188 → 587 mean output tokens per call: THB **−0.30** per image intake |
| R2+R3 together | image tasks | THB/attempted 1.77 → 1.31, THB/successful 1.99 → 1.47, latency p50 −19% |

An isolated R2-only run was not purchased: R2 moves only cache tokens and R3 only output tokens, and
both are reported separately per call above, so the split is already measured rather than estimated.

### 10.6 Quality, task by task, everywhere anything changed

Aggregate: successful 76 → 77, routing accuracy 95.1% → 96.3%, parse failures 1 → 0, truncations 0 → 0,
provider errors 0 → 0, calls per task unchanged. OCR field accuracy identical:
`grandTotalAmount` 10/10 → 10/10, `expenseDate` 10/10 → 10/10, `vatAmount` 2/2 → 2/2,
`vendorName` 8/10 → 8/10.

**Nothing flipped from success to failure.** Two rows changed verdict, both on the byte-identical text
prompt, so neither is attributable to this change:

| task | pass | before | after | note |
| --- | ---: | --- | --- | --- |
| `text-capture-amount-only` | 1 | FAIL — routed `EXPENSE_DOCUMENT_CAPTURE` | **PASS** — routed `CLARIFY` | improvement; text prompt unchanged, so this is model variance on the known baseline weakness |
| `text-capture-amount-only` | 2 | FAIL — routed `EXPENSE_DOCUMENT_CAPTURE` | FAIL — same | unchanged |
| `text-out-of-scope-product-advice` | 1 | FAIL — `ROUTER_JSON_PARSE_FAILED` | FAIL — routed `ADVISOR_CONVERSATION` | still a failure, different shape; the parse failure disappeared |
| `text-out-of-scope-product-advice` | 2 | FAIL — routed `ADVISOR_CONVERSATION` | FAIL — same | unchanged |
| `image-vat-tax-invoice` | 1, 2 | FAIL — vendor "สมมติ**ช**ัพพลาย" | FAIL — same ซ/ช confusion | unchanged; total, VAT and date exact in both runs |

`documentText` lengths per image row, before → after: 398→430, 1,060→1,060, 495→630, 273→308,
157→152, 278→282 (pass 1) and 424→413, 1,166→1,276, 495→630, 270→308, 157→152, 279→282 (pass 2). No
systematic shrinkage — the one 5-char drop is the handwritten bill, whose fields all still read
correctly. C-03 (no truncation, no extra retries, transcription reuse still valid) holds: truncations
0 → 0, `ocr.receipt.image-reread` 8 → 8 calls, `ocr.receipt.image-read` 10 → 10 calls.

## 11. Found, not changed

Recorded for a later decision, with file:line, exactly as instructed:

- **R4 — reuse the intake route instead of a second `line.plan-route` call.** Worth THB 5.35 / 7.6% of
  the corpus and ~3s per business read, but `maybeShadowComparePreparedPlan`
  (`orchestrator.agent.ts:788`) already logs `intentMatch:false` on real turns, so adopting the fused
  plan can change which tool runs. Needs its own evidence; not in this delivery.
- **R5 — widen `LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES`.** Measured **THB 0.62 per business-read turn**
  (THB 0.93 full-agentic vs THB 0.31 prepared, 28 of 34 reads missed the lane) and 4.1 calls → 1. Each
  new family is a compiled deterministic answer replacing a model-composed one: a product behaviour
  change for the owner to decide, not a prompt trim.
- **`enabledFeatures` in the intake payload is always `[]`.** `tryRouteIntake`
  (`process-line-webhook.use-case.ts:1732`) never sets it, while the system prompt
  (`intent-router.agent.ts`, "Use the feature/tool catalog from the user payload as the source of
  truth") points the model at it, and the real catalog rides the cacheable block under the same key
  name. Costs 2 chars; it is a wording/contract contradiction, not a saving.
- **Intake sees 56 tools, `line.plan-route` sees 61.** `LineAiInternalController.lineIntakeRoute`
  (`line-ai-internal.controller.ts:143`) constructs `new IntentRouterAgent(provider)` without
  `draftEditEnabled`, while `OrchestratorAgent.run` (`orchestrator.agent.ts:469`) passes
  `this.config.lineAiDraftEditEnabled` (true in production). A fused prepared plan therefore can never
  propose a draft-edit tool. Fixing it would GROW the text intake prefix by ~2,885 chars, so it is a
  correctness question, not a cost one. (After R2 this no longer affects image calls at all — they
  carry no catalog.)
- **Three baseline quality misses, unchanged and not addressed by this work:** a bare
  "350 บาท" routed to capture against the prompt's own amount-AND-purpose rule
  (`intent-router.agent.ts`, EXPENSE_DOCUMENT_CAPTURE route meaning); "ช่วงนี้ควรขายอะไรดีคะ" answered
  as social advice rather than `UNSUPPORTED` (the plan-route prompt names this exact phrase as
  `unsupported_module` at `intent-router.agent.ts:78`); and the ซ/ช vendor transcription on the
  synthetic tax invoice.
- **`line.loop`, `line.critic`, `line.compose`, `ocr.receipt.image-read` and
  `ocr.receipt.image-reread` are all completely uncached** (zero cache read and zero cache write across
  both runs, THB 14.5 combined). For the loop the cause is now measured (§9.1): the prefix is below the
  model's cache floor. The others send a large system prompt per call with no checkpoint —
  `ocr.receipt.extract`'s 19,889-char prompt DOES cache, the 2,192-char re-read prompt does not. Not
  investigated further in this delivery.

## 12. Stage 2 verification and commands

```sh
# specs (all green): corpus integrity, both intake-router suites, provider, all three orchestrator
# suites, prepared-plan security, the internal controller
cd <worktree>
pnpm exec tsx --test scripts/line-ai-intake-cost.corpus.spec.ts
pnpm --filter @watchdog-bms/ai-gateway exec tsx --test \
  src/modules/line-ai/agents/line-intake-router.agent.spec.ts \
  src/modules/line-ai/agents/intent-router.agent.spec.ts \
  src/modules/line-ai/infrastructure/provider/bedrock.provider.spec.ts \
  src/modules/line-ai/infrastructure/provider/openai.provider.spec.ts \
  src/modules/line-ai/agents/orchestrator.agent.spec.ts \
  src/modules/line-ai/agents/orchestrator-native-loop.agent.spec.ts \
  src/modules/line-ai/agents/orchestrator-model-loop.agent.spec.ts \
  src/modules/line-ai/agents/prepared-simple-read-security.spec.ts \
  src/modules/line-ai/presentation/http/line-ai-internal.controller.spec.ts

# typecheck behind the machine-wide mkdir mutex
until mkdir /tmp/mangmee-heavy.lock 2>/dev/null; do sleep 15; done
(cd <worktree> && pnpm --filter @watchdog-bms/ai-gateway exec tsc --noEmit); rc=$?
rmdir /tmp/mangmee-heavy.lock; echo rc=$rc

git diff --check

# the after-run (THB 61.19)
cd <worktree>/apps/ai-gateway
MODEL_PROVIDER=bedrock AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 \
  BEDROCK_REGION=ap-southeast-1 BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6 \
  AI_PROMPT_LOGGING_ENABLED=false \
  pnpm exec tsx ../../scripts/line-ai-intake-cost-benchmark.ts \
    --label after --repetitions 2 --max-thb 65 --thb-per-usd 33 --pace-ms 2000 \
    --out <scratch>/after --ledger <scratch>/spend-ledger.jsonl

# the pre-change preparedPlan count (5 image tasks, R2/R3 temporarily reverted)
pnpm exec tsx ../../scripts/line-ai-intake-cost-benchmark.ts \
  --label prechange-preparedplan-count --repetitions 1 --max-thb 12 --pace-ms 2000 \
  --only image-thermal-short,image-vat-tax-invoice,image-check-bill-quantity-only,image-product-photo,image-signature-crop \
  --out <scratch>/prechange --ledger <scratch>/spend-ledger.jsonl
```

Harness change in Stage 2: two boolean telemetry fields per task record, `preparedPlanPresent` and
`advisorAnswerPresent`, read off the parsed plan AFTER the call. Nothing about the request changed, and
the corpus manifest and its hash are untouched (`cf9bce44…` in both runs).

Spend: Stage 1 THB 92.58, Stage 2 THB 84.83, **phase total THB 177.41** of the THB 250 ceiling.

## 13. Stage 2 limitations

- Every §7 limitation still applies (synthetic pages, stubbed ERP tools, n = 2, pacing, region).
- The after-run sampled **no cold text intake** (0 of 64) and only 2 cold image intakes, so the cold
  figures rest on 2 samples per side. The prefix-token counts they are derived from are exact.
- R1 was measured on a corpus whose business reads offer 1–3 tools. A deployment that offers many more
  tools per turn could push the loop prefix over the model's cache floor and make R1 pay; the numbers
  in §9.1 are the ones to re-check before revisiting it.
- The text-path deltas in §10.1 (±3%) and the two verdict flips in §10.6 are model variance on a
  byte-identical prompt. Two repetitions cannot separate a small real effect from that noise — but the
  prompt bytes are provably unchanged, which is the stronger argument.

## 14. R5 after-run — deterministic business reads (wave 2 H2, 2026-09-18)

R5 was recorded, not done, in §11. The owner took it in [wave 2 spec §6](../specs/line-ai-credit-wording-and-deterministic-reads-spec-th.md)
(decision 4), four families were compiled, and this is the measured result. Same harness, same frozen
corpus (`cf9bce44…`), same FX (THB 33/USD), same pacing (2,000 ms), 2 repetitions — business-read TEXT
tasks only, because R5 does not touch the image path.

| | before (`after-2026-09-17T16-13-27-267Z`) | after (`r5-after-2026-09-18T05-24-00-176Z`) |
| --- | ---: | ---: |
| records (11 tasks × 2 passes) | 22 | 22 |
| prepared-lane hit (`calls == 1`) | **8** | **16** |
| successful tasks | 22 / 22 | 22 / 22 |
| routing correct | 22 / 22 | 22 / 22 |
| calls / turn | 4.27 | **2.50** |
| THB total | 20.72 | **16.51** |
| THB / successful task | 0.942 | **0.750** (−20.4%) |

No task went success → fail and no route changed. The after-run paid ONE cold cacheable-prefix write
(`text-read-sales-month` pass 1, THB 1.68 against THB 0.31 warm) that the before subset did not, because
it ran first in a shorter run; on warm-equivalent cost the saving is ≈ 27%, so the 20.4% above is the
conservative figure.

Per task (`calls` before → after; ✓ = served by the prepared lane):

| task | before | after | |
| --- | ---: | ---: | --- |
| `text-read-sales-month` | 1 ✓ | 1 ✓ | already compiled |
| `text-read-expense-total` | 1 ✓ | 1 ✓ | already compiled |
| `text-read-glossary-shorthand` | 1 ✓ | 1 ✓ | already compiled |
| `text-read-tax-vat` | 6 | **1 ✓** | new `tax.get_vat_summary::single_metric` |
| `text-read-inventory-low` | 6 | **1 ✓** | new `inventory.list_low_stock::list` |
| `text-read-ap-outstanding` | 6 | **1 ✓** | new `procurement.get_ap_outstanding::single_metric` |
| `text-read-crm-new-customers` | 6 | **1 ✓** | new `crm.get_customer_summary::list` |
| `text-read-expense-breakdown` | 7 / 6 | 6 / 7 | no family by design (spec §6.2) |
| `text-read-explain-record` | 7 / 6 | 6 / 7 | no family by design (deterministic explain template) |
| `text-read-daily-closing` | 6 | 7 / 6 | family exists, plan defers — see below |
| `text-denied-read-no-query-permission` | 1 | 1 | permission refusal, unchanged |

`text-read-daily-closing` still misses the lane, and the eligibility replay
(`prepared-simple-read.logic.spec.ts`) says why: the message is two requests in one
(`วันนี้ปิดร้านต้องเช็คอะไรบ้าง ยังค้างจ่ายอะไรไหม` — a closing checklist AND what is still unpaid), so the
intake either marks the plan `complex` (gate reason `not_simple`) or emits no simple `answerShape`
(`no_simple_answer_shape`), and the full path then answers both halves. That is the router's plan doing
its job, not a defect in the gate or in the F3 formatter: one simple daily-closing read IS eligible and
IS served (pinned by test). Nothing was changed for it.

Answer facts were checked separately from cost, because the harness ERP client is a stub: each family's
answer is pinned against the REAL tool result shape in `prepared-simple-read-formatter.spec.ts`, and the
lane was replayed provider-free over the harness's own stub data to prove all four log
`line.ai.prepared_simple_read.served` (a formatted answer) rather than `.honest_terminal`. Two stub
entries were corrected to the real tool shapes in the same change — `tax.get_vat_summary`
(`vatOutput`/`vatInput`/`netVat`/`eventCount`/`currency`, not `outputVat`/`inputVat`/`payable`) and
`procurement.get_ap_outstanding` (`asOfDate`/`totalOutstanding`/`topSuppliers`, not
`outstandingAmount`/`overdueAmount`) — so those two tasks' answer TEXT is not comparable across the two
runs; their cost, calls, routing and success are (the stub is never metered and never reaches the intake
prompt).

Spend: smoke THB 0.01 + run THB 16.51 = **THB 16.52** of the THB 100 authorised for this phase
(`--max-thb 60` per run, ledger `…/agent-h2/spend-ledger.jsonl`).

```sh
# both runs, from apps/ai-gateway (the header's required cwd)
MODEL_PROVIDER=bedrock AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 \
  BEDROCK_REGION=ap-southeast-1 BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6 \
  pnpm exec tsx ../../scripts/line-ai-intake-cost-benchmark.ts --smoke \
    --max-thb 60 --thb-per-usd 33 --label r5-smoke --out <scratch>/agent-h2/r5-after

MODEL_PROVIDER=bedrock AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 \
  BEDROCK_REGION=ap-southeast-1 BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6 \
  pnpm exec tsx ../../scripts/line-ai-intake-cost-benchmark.ts \
    --label r5-after --repetitions 2 --thb-per-usd 33 --max-thb 60 \
    --only text-read-sales-month,text-read-expense-total,text-read-expense-breakdown,text-read-tax-vat,text-read-inventory-low,text-read-daily-closing,text-read-glossary-shorthand,text-read-ap-outstanding,text-read-crm-new-customers,text-read-explain-record,text-denied-read-no-query-permission \
    --out <scratch>/agent-h2/r5-after
```

### 14.1 Found in the R5 after-run, not changed

- **`tax.get_vat_summary` has no whitelisted input field, so no lane and no loop can ask for another
  period.** `LINE_TOOL_REGISTRY` (`packages/contracts/src/ai-tools.ts`) lists neither
  `requiredInputFields` nor `optionalInputFields` for it, while the tool itself accepts `periodKey`
  (`erp-tax-tools.use-case.ts:189`) and defaults to the CURRENT period. `text-read-tax-vat` asks about
  `เดือนที่แล้ว`, and both paths therefore read the current period. The compiled family makes that
  visible — it prints `VAT งวด <periodKey>` from the tool's own answer — where a model-composed reply
  could have called the current period "last month". Pre-existing; the fix is to whitelist `periodKey`
  (with a `YYYY-MM` format check) and re-measure, which changes the intake catalog and so belongs in its
  own round.
- **AP aging adds every currency into one total.** `ap-reporting.use-case.ts:27` sums
  `outstandingAmount` across bills regardless of `row.currency` and then reports `currency: 'THB'`, and
  the LINE tool drops the currency field entirely, so the compiled answer states baht on the tool's own
  authority. Single-currency companies are unaffected; a multi-currency one would read a wrong total on
  both paths.
- **`ap-reporting.use-case.ts:39` sets `supplierDisplayName` to the supplier ID**, so `topSuppliers` can
  never be shown to a customer. The compiled family prints no supplier for that reason.
- **The accounting-summary specialist's generic shaping misses AP/VAT count keys.**
  `accounting-summary.agent.ts:406` looks for `total`/`count`/`outstandingTotal`/… , none of which these
  two tools return, so the agentic fact for both is the placeholder
  `ข้อมูลพร้อมแล้ว (ดูรายละเอียดในเว็บแอป)` and the numbers reach the customer only through the model.
  The compiled families remove that dependency for these two questions.

## 15. H4 period replay — the tool gets the period the resolver read (wave 2 H4, 2026-09-18)

Owner-authorised replay of the [period-resolution spec](../specs/line-ai-period-resolution-spec-th.md)
P-06, on the remaining R5 phase budget. Real Bedrock, corpus **v2**
(`ae237f275d85a1d8e1be5a44f4325822d6f35d148ef2bac1415a0874f581ab83`), 2 repetitions, THB 33/USD, the
nine new period tasks plus the eleven business-read tasks of the R5 after-run.

```sh
cd apps/ai-gateway
MODEL_PROVIDER=bedrock AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 \
  BEDROCK_REGION=ap-southeast-1 BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6 \
  pnpm exec tsx ../../scripts/line-ai-intake-cost-benchmark.ts --smoke \
    --max-thb 40 --thb-per-usd 33 --label h4-smoke --out <scratch>/agent-h4/h4-period
MODEL_PROVIDER=bedrock AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 \
  BEDROCK_REGION=ap-southeast-1 BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6 \
  pnpm exec tsx ../../scripts/line-ai-intake-cost-benchmark.ts \
    --label h4-period --repetitions 2 --thb-per-usd 33 --max-thb 40 \
    --only text-period-sales-yesterday,text-period-expense-last-month,text-period-tax-vat-last-month,\
text-period-crm-last-week,text-period-sales-named-month,text-period-expense-explicit-range,\
text-period-daily-closing-day-before,text-period-sales-last-year,text-period-sales-last-month-en,\
text-read-sales-month,text-read-expense-total,text-read-expense-breakdown,text-read-tax-vat,\
text-read-inventory-low,text-read-daily-closing,text-read-glossary-shorthand,text-read-ap-outstanding,\
text-read-crm-new-customers,text-read-explain-record,text-denied-read-no-query-permission \
    --out <scratch>/agent-h4/h4-period2 --ledger <scratch>/agent-h2/spend-ledger.jsonl
```

Run `h4-period-2026-09-18T10-04-17-532Z`, git `3e65f7a6`. 40 records attempted, 39 completed, **39
successful, 0 refusals, 0 parse failures, 0 truncations**, routing 97.5% (the single miss is the last
record, stopped by the spend guard).

### 15.1 Did the tool get the period the resolver read?

The stub ERP client now records the input every tool received per task, and the record carries the
periods `resolvePeriodCandidates` read from that task's message, so this is a mechanical comparison —
no judgement, no model.

**31 of 33 records matched (93.9%).** Both misses are the same task,
`text-denied-read-no-query-permission`, which holds no `line.ai.query` permission and therefore makes
ZERO tool calls: there is no input to compare. **Of the 31 records that actually called a tool, 31
matched — 100%.**

| question (new period task) | the resolver read | the tool received |
| --- | --- | --- |
| ยอดขายเมื่อวานเท่าไหร่คะ | `day 2026-09-16..2026-09-16` | `sales.get_sales_summary {fromDate:2026-09-16,toDate:2026-09-16}` |
| ค่าใช้จ่ายเดือนที่แล้วรวมเท่าไหร่คะ | `month 2026-08-01..2026-08-31` | `expense.list_recent {fromDate:2026-08-01,toDate:2026-08-31}` |
| VAT เดือนที่แล้วยอดเท่าไหร่คะ | `month 2026-08` | `tax.get_vat_summary {periodKey:2026-08}` |
| สัปดาห์ที่แล้วมีลูกค้าใหม่กี่รายคะ | `week 2026-09-07..2026-09-13` | `crm.get_customer_summary {newSince:2026-09-07,newUntil:2026-09-13}` |
| ยอดขาย ส.ค. 68 เท่าไหร่คะ | `month 2025-08-01..2025-08-31` | `sales.get_sales_summary {fromDate:2025-08-01,toDate:2025-08-31}` |
| ค่าใช้จ่าย 1-15 ก.ย. รวมเท่าไหร่คะ | `range 2026-09-01..2026-09-15` | `expense.list_recent {fromDate:2026-09-01,toDate:2026-09-15}` |
| ปิดยอดเมื่อวานซืนเป็นยังไงบ้างคะ | `day 2026-09-15..2026-09-15` | `expense.get_daily_closing {date:2026-09-15}` |
| ยอดขายปีที่แล้วเท่าไหร่คะ | `year 2025-01-01..2025-12-31` | `sales.get_sales_summary {fromDate:2025-01-01,toDate:2025-12-31}` |
| how much did we sell last month? | `month 2026-08-01..2026-08-31` | `sales.get_sales_summary {fromDate:2026-08-01,toDate:2026-08-31}` |

Identical in both passes (the English one ran once; the second was the record the guard stopped).
`ส.ค. 68` reaching **2025**-08 is the single most valuable line here: the model never converted the
พ.ศ. year — it copied a candidate the normalizer's existing era rules had already resolved.

The period questions are also CHEAP, because the deterministic lane now serves them: 0.94 provider
calls per task and **THB 0.336 per successful answer**, against THB 1.569 for the older business
reads in the same run.

| group | records | successful | routing | calls/task | THB/successful | lane served |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| new period tasks | 18 (1 budget-stopped) | 17/17 | 17/17 | 0.94 | 0.336 | 15 of 17 |
| existing business reads | 22 | 22/22 | 22/22 | 2.45 | 1.569 (0.660 without one timeout, below) | 14 of 22 |

### 15.2 Regression check on the existing business reads

Success and routing are **22/22 and 22/22, exactly as in the R5 after-run** — no read that worked
before fails now, and every one still routes to the same intake intent. Two differences are worth
stating plainly:

- **Lane hits are 14 of 22, not the 16 of 22 of the R5 after-run.** The whole difference is
  `text-read-daily-closing`, which fell back with `no_prepared_plan` in BOTH passes: the intake router
  returned no prepared plan at all for it. That corpus message is two requests in one
  ("วันนี้ปิดร้านต้องเช็คอะไรบ้าง ยังค้างจ่ายอะไรไหม"), which §14 already recorded as a plan-shape miss
  rather than a gate or formatter defect, so it is the one task in this set whose lane hit is a coin
  toss from run to run. The other six non-hits are unchanged and by design: `expense.get_breakdown` and
  `expense.explain_record` have no compiled family (4 records), and the permission-denied task never
  reaches the lane (2 records).
- **THB/successful reads 1.569 against 0.750 before**, and all of that gap is ONE infrastructure blip:
  a `line.loop` call for `text-read-daily-closing` (pass 1) hit `PROVIDER_TIMEOUT` and is metered at the
  harness's pessimistic `usageEstimated` ceiling of 200,000 input tokens — THB 21.44 for a single call
  that returned nothing. Replacing that record with its own pass-2 cost gives THB 14.52 for the 22
  read records, i.e. **0.660 per successful read, better than the 0.750 of the after-run**. The
  estimate is deliberately conservative for the spend guard and is not evidence of a cost regression.

### 15.3 Spend

| entry | THB |
| --- | ---: |
| R5 smoke + after-run (§14) | 16.52 |
| H4 credential smoke | 0.01 |
| H4 replay, first attempt — stopped by the implementer (see below) | 29.07 |
| H4 replay, `h4-period-2026-09-18T10-04-17-532Z` | 40.23 |
| **phase total against the owner's THB 100 guard** | **85.83** |

The first attempt was stopped after 32 records because it could not measure what it was for: the
harness's request builders gated `valueCandidates` on amounts and dates alone, so a question whose only
value is a PERIOD reached the gateway with no candidates at all. Its THB 29.07 is recorded in the
ledger with that reason; the fix is `hasValueCandidates` in the benchmark, mirroring
`computeValueCandidates` in the webhook.

### 15.4 Found in the H4 replay, not changed

- **A timed-out provider call is metered at 200,000 input tokens.** `usageEstimated: true` makes one
  15-second timeout cost more than the other 39 records put together, which is safe for a spend guard
  but makes any per-task cost comparison fragile. Pre-existing, unrelated to period resolution.
- **`scripts/line-ai-intake-cost.corpus.spec.ts` is not wired into CI or `pnpm test:harness`.** The
  corpus hash pin — the thing that keeps a baseline and an after-run comparable — is therefore only
  checked when somebody runs that file by hand. Pre-existing; it was run by hand for this change.
- **The daily-closing stub had the pre-R5 shape** (`businessDate`/`totals` instead of
  `date`/`occurredToday`/`scope`), so the accounting specialist refused every daily-closing result and
  the compiled F3 family could never verify one. The replay made it visible — "ปิดยอดเมื่อวานซืน" reached
  the tool with exactly the resolved day and still answered with the honest terminal. Fixed in the
  harness after the run (fixture only); a future run should serve that family too.
