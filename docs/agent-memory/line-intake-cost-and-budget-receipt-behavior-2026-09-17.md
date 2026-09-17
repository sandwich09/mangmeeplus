# Agent Memory: LINE intake cost and receipt behavior at AI budget cap

Status: Read-only Production diagnosis complete; owner subsequently requested all fixes in the existing NOGROUP spec and selected separate CHAT/OCR caps. Unified spec/plan prepared; no application or budget changes.
Owner: thawatchai + Codex
Scope: Explain the screenshot's THB55.67 `line.intake-route` usage and whether receipt uploads/OCR remain available after the affected company's monthly AI money budget is exhausted.

## Evidence and boundaries

- Incident correlation and deployed source are established in [the original investigation](uat-line-chat-nogroup-2026-09-17.md). Production source inspected: `fc2838c4cb691033f41595c0d43587f10377d33c`.
- Read the cloud operations and Production support access runbooks before access. Used existing non-root `watchdog-bedrock` / `watchdog-bedrock-dev` credentials and the repository's T1 support connector with ticket `INC-20260917-LINE-AI-COST`.
- Both interactive SSM sessions used server-enforced role `watchdog_support_ro`; verified `transaction_read_only=on`, then explicit `BEGIN READ ONLY` / scoped SELECTs / `COMMIT` / exit. No T2 arming, port forwarding, database write, live LINE send, budget adjustment or deploy.
- Query scope was September 2026 for the company resolved by `LineWebhookEventLog.webhookEventId = '01M2QJ10XYHT1JH6XQG3ACSYZ3'`. Read only aggregate usage/model/token/cost data and limited numeric usage-row examples; did not query customer message text.
- SSM sessions `watchdog-bedrock-dev-kd9akkcgz8xdx4qc686u6a6qqi` and `watchdog-bedrock-dev-i694pyuajuirxscha6e7r8dnne` were both verified `Terminated` after exit (19:42:11 and 19:44:35 Bangkok respectively).
- Current usage matches all screenshot rows: 92 provider calls, THB80.62. All rows use `global.anthropic.claude-sonnet-4-6` and `ok=true`. Provider success does not establish parser or business-flow success.

## Meter results

| Tag | Calls | Input tokens | Output tokens | Cache read tokens | Cache write tokens | Recorded THB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `line.intake-route` | 48 | 129,913 | 36,628 | 391,280 | 168,877 | 55.67 |
| `ocr.receipt.extract` | 14 | 15,946 | 11,093 | 26,820 | 48,380 | 13.29 |
| `line.plan-route` | 15 | 7,301 | 1,774 | 89,870 | 44,935 | 8.06 |
| `line.casual` | 7 | 12,960 | 364 | 0 | 0 | 1.46 |
| `ocr.receipt.image-reread` | 2 | 3,976 | 946 | 0 | 0 | 0.86 |
| `ocr.receipt.image-read` | 1 | 1,896 | 712 | 0 | 0 | 0.54 |
| `line.loop` | 4 | 3,973 | 212 | 0 | 0 | 0.49 |
| `line.compose` | 1 | 1,505 | 200 | 0 | 0 | 0.25 |

`line.intake-route` is about 69% of total cost and averages THB1.16 per call. Recomputed all 48 rows using the deployed pinned price map and each row's recorded FX: zero cost mismatches. This verifies the application meter, not reconciliation with the AWS invoice or current vendor list prices.

Approximate component totals for this tag:

- Ordinary input: THB12.84.
- Generated output: THB18.09.
- Cache read: THB3.87.
- Cache write: THB20.86.

The separately rounded components sum to THB55.66; the authoritative sum of per-call rounded costs is THB55.67. There were 15 calls with cache writes and 33 calls with cache reads. Cache is being used; this evidence does not show that cache is broken. No failed-provider rows account for this tag's total, so conservative failed-call/timeout ceiling metering is not the observed explanation.

The highest-cost call was THB3.30, with 2,909 ordinary input tokens, 3,453 output tokens and 10,610 cache-write tokens. Eleven intake calls sharing a request ID with an `ocr.%` row account for THB26.67; the remaining 37 account for THB29.00. Do not label those 37 as text-only: absence of an OCR peer does not prove absence of media.

## Why the tag costs more than its name suggests

- Deployed `IntentRouterAgent.routeIntake()` uses the company-selected model for routing, business context and image understanding. It sends permission/feature context, categories and available conversation/draft/clarification context, plus image content when present.
- With fused planning enabled, the stable glossary/tool catalog is included in a cacheable block. Source comments describe approximately 21 KB of catalog; do not confuse that character/byte size with the approximately 10,600-token cache prefix observed in some calls.
- For images, the response includes `documentText`, a transcription of the document, as well as the route/plan. The 8,000-token image output setting is a ceiling, not a fixed per-call charge. This tag generated 36,628 output tokens in total.
- The receipt OCR controller already reuses valid `documentText` from intake and skips its first image-reading stage when applicable. `ocr.receipt.extract` then converts the text to receipt fields. Therefore THB13.29 under `ocr.receipt.extract` is not the complete cost of receipt understanding, and the two tags alone do not demonstrate duplicate image reading.
- The screenshot's ordinary input/output headline excludes additional cache-token counters. Those counters still contribute to recorded cost.

Code evidence at the deployed source:

- `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts`: `routeIntake`, `INTAKE_DOCUMENT_MAX_TOKENS`, `documentText` contract.
- `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/bedrock.provider.ts`: prompt cache blocks and usage counters.
- `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts`: transcription reuse and structured receipt extraction.
- `apps/api/src/modules/line-ai/application/ai-model-pricing.ts`: pinned component rates and per-call satang rounding.

## Receipt behavior when this monthly money budget is exhausted

This is the THB80 monthly AI money cap, shared by chat and receipt AI for the same company. It is separate from receipt-count quotas, OCR entitlement, file limits and expense permissions.

| Entry point | Expected behavior from deployed code |
| --- | --- |
| Web file upload/manual expense entry | File attachment/upload and manual entry can proceed, subject to normal permissions and other gates. Monthly AI money admission is applied at OCR invocation, not file upload. |
| Web automatic OCR | `ReceiptOcrClient.extract()` fails with `AI_MONTHLY_BUDGET_EXCEEDED` before provider execution and OCR count admission. The attachment/draft already exists; OCR failure does not delete it. |
| Fresh receipt image via LINE | Intake and OCR provider admission fail at the shared money cap. For an authorized expense-capture user, the document decision takes the clarification path and can persist pending media. It returns before automatic expense creation; pending media is not a completed expense. |

Do not promise automatic OCR retry after a budget change, indefinite pending-media retention, or that every LINE/manual clarification path succeeds without AI. These were not established here. No live upload was sent after the cap; the receipt behavior above is a deployed-code trace.

Confirmed error-handling gap in Production:

1. `tryRouteIntake()` catches the budget HTTP error and substitutes `ROUTER_UNREACHABLE`.
2. `tryExtractReceiptFields()` catches the OCR HTTP error and returns `OCR_FAILED` without preserving the budget error code.
3. `formatOcrGovernanceClarifyReply()` handles OCR entitlement/count quota errors, but has no explicit monthly AI money-budget case. The failed-read fallback says the document reader is temporarily unavailable and that the image is retained but no expense has been recorded.

Thus a LINE receipt can receive a misleading temporary-failure explanation for an explicit budget denial. This is distinct from the free-text budget card, and distinct from UAT's ledger NOGROUP failure.

Code evidence at the deployed source:

- `apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts`: upload lifecycle.
- `apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts`: failed extraction preserves existing attachment/draft.
- `apps/api/src/modules/expenses/infrastructure/receipt-ocr.client.ts`: company AI budget before OCR execution/count admission.
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`: error conversion, `decideLineBusinessDocument`, pending-media clarification before `initReceiptUpload`.

Decisions:
- Preserve the company cap. Correctly labeling a refusal must not bypass admission.
- Original diagnostic scope kept ledger and budget/media fixes distinct. Superseded by the owner's later request to combine all five work areas in the same NOGROUP spec/plan; implementation has not started.
- Potential cost work: measure and reduce unnecessary routing context/catalog/output while preserving permissions and routing quality; make routing versus document transcription cost understandable in reporting. Existing transcription reuse is already implemented.
- Owner has now explicitly selected separate CHAT/OCR ceilings under the total, without borrowing. See the combined spec §12 for admission, classification, activation and migration. No company-specific amounts or live activation were requested.

Open questions:
- Split policy is resolved. Company-specific caps remain admin inputs; actual cost savings await the planned before/after corpus, and new split admission remains unimplemented.

Artifacts:
- [Combined NOGROUP, budget, cost and split-cap spec](../specs/line-ai-ledger-lifecycle-remediation-spec-th.md).
- [Original incident investigation](uat-line-chat-nogroup-2026-09-17.md).

Verification:
- Scoped read-only SQL aggregates reproduce the screenshot and all 48 intake costs; both support sessions closed and termination checked.
- Compared receipt, routing, pricing and error boundaries against the exact Production source.
- Documentation whitespace/link checks performed. No runtime code changed; no implementation test or live upload performed.

Next:
- Implement the unified [plan](../plans/line-ai-ledger-lifecycle-remediation-plan-th.md) when requested. The earlier explanation is complete; do not ask again whether the owner wants reserve versus split caps.

## Phase C implementation — 2026-09-17

Status: งาน C ปิดรอบ implementation แล้วบน branch `codex/line-ai-remediation-c-intake-cost-20260917` (ยัง **ไม่** deploy, ยังไม่ merge). หลักฐานทั้งหมดอยู่ใน [cost benchmark before/after](../research/line-ai-intake-cost-benchmark-2026-09-17.md).

- **Frozen corpus + harness** อยู่ใน repo: `scripts/line-ai-intake-cost.corpus.ts` (hash `cf9bce443b3012ef39a081670614b8651fa55483aa34043376978d4b13becce2` ตรึงด้วย spec ข้างกัน), `scripts/line-ai-intake-cost-benchmark.ts` ขับ controller/orchestrator จริงใน process เดียวผ่าน `runWithUsageContext` — ห้ามรันใน CI เพราะใช้เงินจริง และต้องรันจาก `apps/ai-gateway` (decorators + `sharp`).
- **Baseline จริง (Sonnet 4.6, ap-southeast-1, FX 33, 2 รอบ):** 82 attempted / 212 calls / THB 70.47; `line.intake-route` 53.3% ของต้นทุน; component split output 51.6% > input 19.9% > cache read 18.3% > cache write 10.1%. ต่อคอล: text intake warm THB 0.312 / cold 1.710; image intake warm 0.764 / cold 1.975 (คนละ prefix เพราะ advisor ถูกลบเมื่อมี attachment).
- **ที่ implement:** (1) ไม่ส่ง fused-plan section + tool catalog บน image intake (ลบ `caps.fusedPlan` เมื่อมี attachment เหมือนที่ทำกับ advisor) และ (2) ไม่ขอ capture hints ที่ media path ทิ้งบน image turn. **ผล:** THB/attempted 0.86 → 0.75 (−13.2%), THB/successful 0.93 → 0.79 (−14.3%), image −26%, text flat, calls/task 2.59 เท่าเดิม, routing 95.1% → 96.3%, parse fail 1 → 0, truncation 0, OCR fields เท่าเดิม, และการประหยัดอยู่ใน `line.intake-route` ทั้งหมด (37.56 → 28.31).
- **ที่วัดแล้ว revert:** การให้ `generateWithTools` นับ `toolConfig` เข้า cache-checkpoint gate ไม่ได้ผล — prefix ของ native tool loop (system 2,382 chars + tool specs 425–1,408 chars) อยู่ที่ ~780–1,050 tokens ต่ำกว่าเพดาน 1,024 tokens ของโมเดล จึงไม่เกิด cache write/read เลย (วัดจริง cr=0 cw=0 ทั้งก่อนและหลัง). **แก้ความเข้าใจผิดจาก baseline:** THB 8.70 ของ `line.loop` ไม่ได้มาจาก prefix ที่ไม่ถูก cache แต่มาจาก user message ต่อคอล + tool_results transcript ที่โตขึ้นทุกรอบ ซึ่ง cache prefix แก้ไม่ได้.
- **บทเรียนถ้อยคำ prompt:** ประโยค "put everything you read from the page in documentText instead" ทำให้ transcription ยาวขึ้น → stage 2 reconcile รายการไม่ลง → vision re-read ยิงเพิ่ม → thermal slip จาก 2 เป็น 4 calls. คำสั่งลด output ที่พูดถึง `documentText` ต้องเป็นกลางเรื่องความยาวเสมอ.
- **สิ่งที่พบแต่ไม่แก้ (ต้องตัดสินใจแยก):** `enabledFeatures` ใน payload เป็น `[]` เสมอทั้งที่ prompt บอกให้ใช้เป็น source of truth; intake เห็น 56 tools แต่ `line.plan-route` เห็น 61 เพราะ controller ไม่ส่ง `draftEditEnabled`; reuse intake route แทน `line.plan-route` (THB 5.35/7.6% แต่ `intentMatch:false` มีจริง); ขยาย `LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES` (THB 0.62 ต่อ business read — เป็น product decision ของ owner); `line.loop`/`line.critic`/`line.compose`/`ocr.receipt.image-*` ยังไม่ถูก cache เลยรวม THB 14.5.
- **ค่าใช้จ่ายการวัด:** Stage 1 THB 92.58 + Stage 2 THB 84.83 = **THB 177.41** บน profile `watchdog-bedrock` (ledger `spend-ledger.jsonl` ใน scratch). ไม่มีการเรียก AWS API อื่นนอกจาก `bedrock-runtime`, ไม่แตะ UAT/Production, corpus สังเคราะห์ 100%.
- **ยังไม่ปิด:** C-04 (ส่วน "ไม่มี extra call เพื่อหา budget bucket" เป็นของงาน E), X-02 (ต้องมี UAT journey จริง) และการ deploy ทั้งหมด

## Phase D1 implementation — 2026-09-17

Status: implemented on branch `codex/line-ai-remediation-d1-usage-20260917` (worktree only, not pushed, no PR, no deploy).

Decisions:
- Additive migration only. `requestKind`, `budgetBucket`, `usageBasis`, `pricingSnapshot`, `adjustsEventId`, `correctionKey` are nullable; `eventKind` defaults to `MODEL_CALL`. No backfill, no re-pricing, no rewrite. Plain `String` columns with CHECK constraints, matching the newest models in this schema (`BillingReceiptGrant.kind`, `EmailAccessChallenge.status`) and the existing `sourceRoute`/`thbPerUsdSource` style — not Prisma enums.
- No execution/invocation unique key in this phase. Its attempt-vs-invocation-vs-transport semantics belong to §12.6 (phase E); adding the fence now would turn a metering replay into a LOST usage write. Recorded as a comment in `schema.prisma` and in the migration.
- The bucket/kind decision lives in ONE exported pure function, `classifyAiUsageRequest(sourceRoute, content)`, so phase E reuses it. `line-intake-route` + image = OCR for the whole call; `line-turn` stays CHAT even with an attachment; `receipt-ocr` and `bank-statement-extract` are always OCR. The function never reads `usageTag` — the intake image path is tagged `line.intake-route`.
- `costSatang` stays the single half-up rounding in `computeCostSatang`. `buildPricingSnapshot` splits it into components and puts the residue in `rounding`, so a snapshot can never contradict the money on its row.
- `usageBasis` arriving from the gateway is untrusted wire JSON and is normalised to the two known values or NULL.
- The report derives EVERY slice (tags, kinds, buckets, basis, adjustments, coverage) from one grouped `$queryRaw` inside the existing RepeatableRead transaction, so the slices reconcile by construction. Raw SQL is needed because component cost lives inside the `pricingSnapshot` JSON, which `groupBy` cannot sum. `breakdown.total` (event-derived) is exposed next to `current` (the running aggregate) rather than reconciled away.
- `recordCompanyAiCostAdjustment` was implemented (~35 lines): the aggregate move is one conditional `updateMany` whose WHERE requires every total to stay >= 0, so it refuses atomically with no isolation level and no read-then-write race. Idempotent on `correctionKey`, never touches `callCount`, refuses to correct a correction. No HTTP endpoint and no caller yet.

Artifacts:
- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20260917140000_ai_usage_metadata/migration.sql`
- `apps/api/src/modules/line-ai/application/company-ai-usage-meter.ts` (+ `ai-model-pricing.ts`), the five metering seams
- `apps/api/src/modules/system-partner-management/application/use-cases/get-partner-ai-usage.use-case.ts`
- `packages/contracts/src/ai-lineage.ts`, `packages/contracts/src/partner-management.ts`
- `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/{bedrock,openai}.provider.ts`
- `apps/web/src/features/system-partners/{ai-budget.logic.ts,PartnerDetailPage.tsx,system-partners.api.ts}`

Verification:
- `pnpm exec tsx --test` (apps/api): `company-ai-usage-meter.spec.ts` + `get-partner-ai-usage.use-case.spec.ts` + `ai-gateway.client.spec.ts` + `crm-ai-gateway.client.spec.ts` + `partner.controller.spec.ts` + `security-event-emitters.spec.ts` → 186 tests, 182 pass, 0 fail, 4 skipped (real-PostgreSQL skips without `DATABASE_URL`).
- `pnpm exec tsx --test` (apps/ai-gateway): bedrock + openai provider specs and both usage specs → 52 tests, 52 pass, 0 fail.
- `pnpm test` (apps/web, the repo's own unit runner) → 1745 tests, 1745 pass, 0 fail.
- Real PostgreSQL (throwaway `postgres:16-alpine`, 127.0.0.1:15571, dropped afterwards): `prisma migrate deploy` applied all migrations including `20260917140000_ai_usage_metadata`; the spec's new real-DB case and a scratch probe then proved a legacy-shaped row stores NULL metadata, a new-shaped row stores kind/bucket/basis/snapshot, snapshot components reconstruct `costSatang` exactly (47=47, 251=251, 47=47), the correction applied → replayed as `duplicate` → an over-large negative delta `refused-negative`, the aggregate moved 345→195 with `callCount` still 3, and the DTO reported `total.calls 3`, `adjustments {-150, 1}`, `coverage partial 2/3` with UNKNOWN present in every slice.
- `prisma validate`, `migration:review`, `git diff --check` clean. Typechecks (serialised on the `/tmp/mangmee-heavy.lock` mkdir mutex): api, ai-gateway, web all rc=0.

Next:
- D-01/D-03 stay open: the web breakdown has unit-tested logic and a typecheck but no rendered desktop/mobile evidence, company-switch/stale-version/audit-history evidence, or real HTTP round trip.
- R-12 stays open on its cost-corpus half; the baseline-corpus plan items belong to phase C.
- `recordCompanyAiCostAdjustment` has no caller; phase E wires late-actual settlement to it.
- The migration adds four CHECK constraints to `AiUsageEvent`, which Postgres validates with a table scan under an ACCESS EXCLUSIVE lock. The table is small (about 92 rows/company-month on Production) so this is expected to be brief, but it was only measured against an empty catalog here.

### D1 controller review follow-ups — 2026-09-17

Five hardening changes on top of the D1 commit, same branch:

1. **Version skew.** `AiUsageBreakdown` now returns `null` unless `hasAiUsageBreakdown(usage)` (a new one-line predicate in `ai-budget.logic.ts`), and the "อื่น ๆ" row uses `usage.otherTags?.tags ?? 0`. A rolling deploy that serves this page from a pre-D1 API degrades to the old card instead of throwing mid-render. The contract types stay required — the current API always sends both fields.
2. **Dead code.** `aiTagsReconcile` and its test are deleted; reconciliation is structural on the server and already asserted in the use-case spec.
3. **Adjustment race.** Two callers with the same `correctionKey` can both pass the `findUnique`; the loser's INSERT raised P2002 out of `$transaction` instead of the documented `'duplicate'`. `recordCompanyAiCostAdjustment` now catches that ONE case outside the transaction. **Measured, not assumed:** Prisma 7's pg adapter leaves `meta.target` undefined and reports the column through `meta.driverAdapterError.cause.constraint.fields` **quoted** — `['"correctionKey"']`. The first attempt compared unquoted and the real-PG test caught it. The detector strips quotes, also accepts `meta.target` and a constraint/index name, and re-throws everything else.
4. **Malformed snapshot.** The grouped SQL wrapped each component in `CASE WHEN jsonb_typeof(...) = 'number' THEN (...)::numeric END`, rounded and cast once after the `SUM`. One snapshot row with a non-number component now contributes NULL instead of aborting the cast and taking the whole partner page down.
5. **Gateway trust boundary.** `recordCompanyAiUsage` drops an entry whose four counters are not non-negative safe integers, or whose `modelId`/`tag` is not a non-empty string, or whose `ok` is not a boolean (that last clause is beyond the letter of the review: a non-boolean would fail the insert for every sibling row in the batch). Dropped entries log one `ai.usage.malformed_entry` warn with ids only — never the payload — and the remaining entries are still recorded. An all-malformed batch takes the existing `ai.usage.absent` path. A negative counter can no longer lower a company's month aggregate.

Verification of the follow-ups (fresh throwaway `postgres:16-alpine`, `mangmee-d1-pg2-18263`, db `d1b_10977`, 127.0.0.1:15583, migrated and stopped afterwards):

- `pnpm exec tsx --test --test-reporter=tap` (apps/api, meter + get-partner-ai-usage) **with** `DATABASE_URL` + `OCR_REQUIRE_POSTGRES=true`: 135 tests, 135 pass, 0 fail, 0 skipped. The real-PG case proves the `Promise.all` race returns exactly `['applied','duplicate']`, the aggregate moved once (1250 → 1150) and only one `race-key` row exists, and that a row whose snapshot holds the string `'5'` in `componentSatang.cacheRead` reports `{ read: 0, write: 7 }` for its slice instead of failing the read.
- Same focused api set without `DATABASE_URL` (meter, get-partner-ai-usage, ai-gateway.client, crm-ai-gateway.client, partner.controller, security-event-emitters): 197 tests, 193 pass, 0 fail, 4 skipped (the real-PG cases).
- `pnpm test` (apps/web): 1745 tests, 1745 pass, 0 fail.
- api typecheck rc=0, web typecheck rc=0 (both serialised on the `/tmp/mangmee-heavy.lock` mkdir mutex). `git diff --check` clean.

The ai-gateway typecheck was not re-run: no gateway file changed in this round.

### Phase E1a implementation — 2026-09-17

Branch `codex/line-ai-remediation-e1a-split-policy-20260917`. Delivers the **policy and config half** of separate CHAT/OCR caps (ADR 0013 §2.1/§3/§8/§9, spec §12.1/§12.4/§12.5/§12.7). No reservations, no settlement, no budget envelope, no admin UI — those are later phases. **After this phase every company still behaves exactly as before**: all are `SHARED`, and `SPLIT` cannot be reached at all while `AI_BUDGET_SPLIT_ACTIVATION_ENABLED` is false, which is its default and the value every deploy uses because the key is deliberately wired into no deploy script.

- **Migration** `20260917150000_ai_budget_split_policy`: additive columns on `CompanyAiConfiguration` (`budgetMode` default `'SHARED'`, `chatMonthlyBudgetSatang`, `ocrMonthlyBudgetSatang`, `budgetConfigVersion` default `0`, `pendingBudgetPolicy`) plus three CHECK constraints (mode domain, both caps `>= 0`). No backfill. An old binary never selects or writes them and can only serve SHARED companies.
- **One resolver** `apps/api/src/modules/line-ai/application/company-ai-budget-policy.ts`: `resolveAiBudgetPolicy` decides mode, caps, source, pending and `revision` for a company and a PINNED Bangkok month. A pending policy whose month has arrived IS the effective policy — no cron. `revision` binds row version + month + source, so a page left open across a month boundary conflicts even though the row version never moved (R-07). Validation fails closed with `SPLIT_CAPS_MISSING` / `SPLIT_EXCEEDS_TOTAL` / `POLICY_MALFORMED`; nothing is ever clamped.
- **Admission** (`assertCompanyAiBudget`): SHARED takes today's path unchanged; an invalid policy and any effective SPLIT refuse `unavailable` with one `ai.budget.policy_unavailable` warn. The policy columns ride the select `resolveEffectiveBudget` already does — no second query — and a test fake without the columns still resolves SHARED.
- **Admin writer** `PUT /v1/system/partners/:id/ai-model` gains `budgetPolicy` (absent = preserve, `null` = cancel a FUTURE pending only, object = desired policy for `effectiveMonthKey`) and `expectedBudgetRevision`, through the real `SetAiModelBodyDto` (nested `AiBudgetPolicyBodyDto`) and the explicit controller mapping, not only the TypeScript type (F-07/R-08). All rules run inside the existing transaction under the existing lock order `partner-ocr-config:<company>` → plan-term → `platform-ai-budget`; no new lock was added. An activated pending policy is MATERIALISED (version bump + its own `budgetPolicyEvent: 'PENDING_ACTIVATED'` audit row) before the CAS, so cancelling it cannot fall back to SHARED (F-06/R-07).
- **Other writers**: the platform-default writer refuses a DEFAULT reduction that would put an inheriting company's active or pending `C + O` above the new default, read-only under the platform lock alone, returning the affected count and ids; lowering the CEILING keeps today's grandfathering, and both are covered by separate tests (F-05/R-06). Signup's trial-total `updateMany` is restricted to SHARED rows with nothing scheduled and logs `signup.ai_budget.split_policy_preserved` when it skips (F-09). The OCR-config writer provably never mentions the new columns.
- **Read side**: `GET …/ai-usage` exposes `budget.policy` resolved by the SAME resolver inside the existing RepeatableRead snapshot. No `reserved`/`available` yet — the shape takes them per bucket later without renaming. Permissions unchanged, no tenant endpoint.

Verification (all from the worktree; heavy passes serialised on the `/tmp/mangmee-heavy.lock` mkdir mutex):

- Focused api specs (meter, set-partner-ai-model, set-platform-ai-budget, get-partner-ai-usage, partner.controller, partner-ai-adjustment-history, provision-signup): **285 tests, 280 pass, 0 fail, 5 skipped** (the pre-existing real-PG cases, no `DATABASE_URL`).
- `pnpm --filter @watchdog-bms/config test` 143/143; `pnpm --filter @watchdog-bms/contracts test` 246/246.
- api typecheck rc=0, web `tsc --noEmit` rc=0, `test:boot` rc=0 ("Nest resolved every provider in 165ms"), `prisma validate` valid, `migration:review` rc=0, maintenance pins `status=current`, `git diff --check` clean.
- **Real PostgreSQL** (throwaway `postgres:16-alpine`, container `mangmee-e1a-pg-20260917`, db `e1a_split`, 127.0.0.1:15571, `migrate deploy` over the full catalog, stopped and removed afterwards): both CHECK constraints reject a negative cap and an unknown mode; scheduling SPLIT for next month leaves the active policy SHARED and admission `{allowed:true}`; after the month turns the resolver reports `PENDING_ACTIVATED`, the next write materialises it (version 1 → 2, `budgetPolicyEvent: 'PENDING_ACTIVATED'` audited) and a simultaneous `budgetPolicy: null` cancels nothing, leaving SPLIT 3000/7000 in the active columns; a SPLIT company's admission is then `{allowed:false, reason:'unavailable'}`; **two concurrent writers with the same expected revision → exactly 1 fulfilled, 1 rejected with `partner_ai_budget_revision_conflict`, version bumped once (2 → 3)**; `C+O > T`, a total lowered under the allocation, and a platform-default reduction under an inheriting company's allocation are all refused, while a ceiling-only reduction still saves.

Open for the next phases: `AiBudgetReservation`, `CompanyAiMonthlyBucketUsage`, `AiUsageEvent.invocationKey`, the budget envelope/`budget-step`/`budget-settle` seams, per-bucket `reserved`/`available`, the admin UI, and the readiness projections on the support/billing surfaces (F-09's other half). The flag stays false until a runbook-governed operator decision after UAT acceptance (spec X-02).

### Phase E1b implementation — 2026-09-17

Branch `codex/line-ai-remediation-e1b-reservations-20260917` (on top of A + B + D1 + E1a + ADR 0013). Delivers the **reservation and settlement half** of separate CHAT/OCR caps on the API side (ADR 0013 §3–§7, spec §12.3/§12.6/§12.7). The AI Gateway's enforcement of the envelope is the NEXT phase (E1c); `AI_BUDGET_SPLIT_ACTIVATION_ENABLED` is still false and wired into no deploy, so **no existing company changes behaviour**: every company is `SHARED` and takes the exact legacy bounded-overshoot path.

- **Migration** `20260917160000_ai_budget_reservations`: additive only. `AiBudgetReservation` (invocation-unique, CHECKed bucket/status/amounts, two `(companyId, monthKey, …)` indexes, cascade FK), `CompanyAiMonthlyBucketUsage` (unique `(companyId, monthKey, bucket)`), and `AiUsageEvent.invocationKey TEXT NULL UNIQUE` — the settlement fence, NULL on every legacy and SHARED row so the index costs them nothing. No backfill.
- **Declared bounds** `packages/contracts/src/ai-budget-bounds.ts`: `AI_BUDGET_STEP_BOUNDS` keyed by step kind, **one step kind per provider CHAIN** (`maxCalls` = the chain's ceiling, `ordinal` = the call index, so `POST /internal/ai/budget-step` can validate `0 <= ordinal < maxCalls`). Every `maxOutputTokens` equals the largest `maxTokens` the gateway really passes for that chain, cited `file:line` in `docs/research/ai-budget-step-bounds-2026-09-17.md` together with the input-ceiling derivation, the pricing formula and the **feasibility table** (asserted in `ai-model-pricing.spec.ts`, so a bound change is a visible diff). A step kind that is absent can never be reserved ⇒ `AI_BUDGET_UNAVAILABLE`.
- **Engine** `apps/api/src/modules/line-ai/application/company-ai-budget-reservation.ts` — its own file so it does not widen the known meter↔policy import cycle (`test:boot` green). `reserveAiBudgetStep` (fresh policy under the locks, lazy sweep, TOTAL before bucket, `exceeded` vs `insufficient`, duplicate ⇒ typed `already_claimed`), `markAiBudgetStepDispatched` (CAS, committed BEFORE the HTTP call), `settleAiBudgetStep` (event + month + bucket aggregate + terminal state in ONE transaction, fenced on `invocationKey`, priced at the reservation's PINNED FX, accepts DISPATCHED **and** UNRESOLVED, `actual > bound` ⇒ full actual + `breach` + HIGH event + scope closed, never clamped), `cancelAiBudgetStep` (owner-token fenced, needs a closed-union no-provider `proof`), and the pure `decideAiBudgetStep` so the whole decision table is unit-testable.
- **Lock order as implemented** `partner-ocr-config:<company>` → plan-term `FOR UPDATE` (where needed) → `platform-ai-budget` → `ai-budget:<company>:<pinned month>`, bucket rows CHAT then OCR. Reserve takes all three advisory locks; settle/cancel take only the last; the E1a writer now takes the new one LAST. No network inside any transaction (FX resolves first).
- **Seams** all five carry a stable attempt key and the wire envelope: `line-text:<sha256(webhookEventId)>` (+`:r<deliveryCount>` for a drain reclaim), `line-image:<sha256(lineMessageId|attachmentId)>`, `receipt-web:<client requestId>`, `statement:<import requestId>`, `crm:<route>:<requestId>`, `draft:<job id>`. `invocationKey = <companyId>#<attemptKey>#<stepKind>#<ordinal>` — the company segment is a **deliberate deviation from ADR §4**, because the fence is a global unique index and an unscoped key let one tenant claim another's (caught by a real-DB test). The owner token never leaves the API.
- **R-05 by construction**: only `ocr_admission_refused` and `gateway_pre_provider_refusal` release money; `releaseCompanyOcrAdmission` takes neither a reservation nor a proof, so refunding an OCR COUNT after a provider failure cannot refund money. Money is reserved BEFORE `admitCompanyOcr` on all three OCR seams.
- **Internal seams** `POST /internal/ai/budget-step` and `POST /internal/ai/budget-settle` (`@Public()` + `assertInternalSecret`, class-validator DTOs, registered in `line-ai.module.ts`). Everything that decides money on `budget-step` comes from the PARENT hold (bucket, month, route, model, FX), never from the body.
- **Read side** `GET …/ai-usage` gains `budget.position` = per-scope `spent/reserved/available` (available null for a SHARED bucket), `unresolvedHolds` and `breach`, from the same RepeatableRead snapshot.
- **Writer** now refuses a bucket cap below `max(bucket aggregate, event sum) + holds`, a TOTAL below `spent + reserved` for a SPLIT company, and current-month SPLIT activation while any non-terminal hold exists. The platform-default writer additionally refuses a default below an inheriting SPLIT company's `spent + reserved`, still read-only under the platform lock alone.

Verification (worktree only; heavy passes serialised on the `/tmp/mangmee-heavy.lock` mkdir mutex):

- Focused api specs (meter, pricing, reservation, gateway client, both writers, the admin read, partner controller, adjustment history): **320 tests, 315 pass, 0 fail, 5 skipped** (pre-existing real-PG cases without `DATABASE_URL`). Internal budget controller spec 6/6. `@watchdog-bms/contracts` 248/248.
- `node scripts/run-line-ai-whole-chain-acceptance.mjs` rc=0 — api-behavior **1427/1427**, gateway-behavior **361/361**, catalog-contract 4/4, controlled-image-harness 4/4, zero `not ok`. `pnpm test:harness` **17/17** rc=0.
- `pnpm --filter @watchdog-bms/web test` **1752 tests, 1751 pass, 1 fail** — the one failure is `api-error-coverage.spec.ts` listing E1a's ten untranslated `partner_ai_budget_*` / `platform_ai_budget_*` codes (inherited, being fixed on the E1a branch). This phase's only new code `partner_ai_budget_total_below_committed` HAS its Thai entry and is absent from that list.
- api typecheck rc=0, web `tsc --noEmit` rc=0, ai-gateway `tsc --noEmit` rc=0, `test:boot` rc=0 ("Nest resolved every provider in 133ms"), `prisma validate` valid, `migration:review` rc=0, maintenance pins `status=current`, `git diff --check` clean.
- **Real PostgreSQL** (throwaway `postgres:16-alpine`, container `mangmee-e1b-budget-pg`, db `mangmee_e1b_budget`, 127.0.0.1:**15477**, full `migrate deploy`, stopped and removed afterwards) — `company-ai-budget-reservation.pg.spec.ts` **11/11**: 20 concurrent reserves across two buckets admit exactly 4 CHAT + 3 OCR against caps of 84/141 satang with `spent + reserved` never crossing either cap or the 225 total; a concurrent duplicate invocation buys exactly one hold; 6 concurrent settlements of one invocation write ONE event and move both aggregates once; reserve racing the E1a cap writer **50×** with zero deadlocks; the writer refuses a cap below `spent + reserved`; a settlement after Bangkok midnight lands in the PINNED month and creates no next-month rows; the sweep cancels a stale RESERVED hold and turns a stale DISPATCHED one UNRESOLVED (never released) with late evidence still settling it; an actual above the bound records in full, flags `breach` and closes only that bucket; cancel is owner-token fenced and the sweep proof cannot touch a DISPATCHED row; a SHARED company fills the bucket aggregate and a correction moves it back without touching `callCount`.

Open for E1c and beyond: the gateway must enforce the envelope (request size, `maxTokens`, model, pinned attempts) and drive `budget-step`/`budget-settle`; **`TIMEOUT_INPUT_TOKEN_CEILING = 200_000` is above every declared input bound**, so a SPLIT timeout would settle above its hold and trip the breach path — spec §12.3 requires that covered or the accounting fixed first; `LineIntakeRouteRequest` carries no webhook event id so a TEXT intake's attempt key still comes from its transport request id; no operator surface yet for clearing `breach` or reconciling UNRESOLVED holds; a SPLIT company must have an explicit approved `modelId` (no model ⇒ `AI_BUDGET_UNAVAILABLE`); the admin UI (D2) still does not render `position`.

#### E1b controller-review follow-ups — 2026-09-17

Six review items, all landed on the same branch after merging the E1a Thai-message fix (tip `766d64ca`).

1. **Deadlock that would LOSE usage.** `recordCompanyAiUsage` wrote the bucket row before `CompanyAiMonthlyUsage` while `settleAiBudgetStep` wrote them the other way round, and `recordCompanyAiUsage` holds no `ai-budget:` lock — so for one SPLIT company a settle on one lane and a recording on another could take the two aggregate rows in opposite order, Postgres kills one, and the victim's usage is only *warned* about, never retried. All three writers of those tables (`recordCompanyAiUsage`, `settleAiBudgetStep`, `recordCompanyAiCostAdjustment`) now touch the MONTH row first, bucket second, CHAT before OCR. Asserted in the unit spec (source-order check) and proven with 50 concurrent settle+record rounds plus a correction on real PostgreSQL: 0 failures of any kind, 100/100 events, both aggregates equal to the summed event cost.
2. **Real evidence is never dropped.** The reservation is now re-read AFTER the company-month lock (a locator read supplies only the lock key), and `SETTLED`/existing event ⇒ `duplicate`, `DISPATCHED`/`UNRESOLVED` ⇒ settle, `RESERVED`/`CANCELLED` ⇒ settle in FULL with `evidenceJson.anomaly.previousStatus`, the new distinct result `settled-anomaly`, and one HIGH `evidence_for_<status>_hold` event after commit. Malformed evidence still settles nothing. This replaces the earlier `invalid-state` refusal, which silently discarded real provider cost — the §12.6 "usage หาย" failure.
3. **Global lock scope.** `reserveAiBudgetStep` now takes the platform-WIDE `platform-ai-budget` lock **only when the company inherits the default** (no `monthlyBudgetSatang` override); an override company takes two company-scoped locks only. Canonical order preserved. Unit tests assert both lock sequences; a real-PG test races an *inheriting* company's reserve against `SetPlatformAiBudgetUseCase` 30× with zero deadlocks, and the existing per-company writer race (50×) stays green.
4. **No silent stop after a successful save.** `SetPartnerAiModelUseCase` refuses any write whose result is an active or pending SPLIT policy while the resulting `modelId` is null (`partner_ai_budget_split_requires_model`, object form, Thai text added). The same request may set model + policy together, so the operator is never trapped. Confirmed `modelId` can only be SET, never cleared: this writer rejects `null` via the approved-list check, the OCR-config writer names `modelId: null` only in its CREATE branch, and signup upserts with `update: {}` — recorded as a comment at the gate.
5. **`requestKind` pinned on the hold** (`AiBudgetReservation.requestKind`, nullable + CHECK, in the still-unmerged migration), inherited by `budget-step` children from the ordinal-0 parent, used by `settleAiBudgetStep` when the caller supplies none — otherwise every gateway-settled invocation would read UNKNOWN and the month would sit at "partial coverage" forever.
6. **`budget-step` refuses a dead parent**: the ordinal-0 row is looked up by its unique invocation key and a `CANCELLED` one answers `AI_BUDGET_UNAVAILABLE`.

Re-verification after the follow-ups: focused api specs **332 tests / 327 pass / 0 fail / 5 skipped**; real PostgreSQL (fresh throwaway `postgres:16-alpine`, container `mangmee-e1b-budget2-pg`, db `mangmee_e1b_budget2`, 127.0.0.1:**15478**, stopped and removed) **16/16**; acceptance runner rc=0 (api-behavior **1427/1427**, gateway-behavior **361/361**, 0 `not ok`); `pnpm test:harness` **17/17**; `pnpm --filter @watchdog-bms/web test` **1752/1752, 0 fail** (the E1a code-coverage gap is closed by the merge); contracts **248/248**; api/web/gateway `tsc --noEmit` rc=0; `test:boot` rc=0; `prisma validate` valid; `migration:review` rc=0; pins `status=current`; `git diff --check` clean.

#### E1b full-gate fixes — 2026-09-18

The FULL api suite (`pnpm --filter @watchdog-bms/api test`, which CI runs) had not been run and caught 9 failures, plus one more found while proving CI-database safety.

1. **Eager attachment dereference (7 tests).** Assembling the budget step read `request.attachment.mimeType` BEFORE admission could refuse, so seven `ReceiptOcrClient failure boundary` tests — whose fixtures carry no attachment because the call was going to be refused anyway — died with `TypeError`. The old code only touched it inside a try/catch that swallowed the throw. Fixed in the seam, not the fixtures: `receiptOcrContent()` in both `receipt-ocr.client.ts` and `ai-gateway.client.ts` now uses `request.attachment?.mimeType`, the LINE receipt attempt key falls back to the transport id (`request.attachment?.id ?? request.requestId`) and the LINE turn attempt key to `request.webhookEventId || request.requestId`. Audited `statement-ai-extract.client.ts`, `crm-ai-gateway.client.ts` and `generate-suggestion.use-case.ts` — no eager dereference in any of them.
2. **Spec registration guard (2 tests).** `src/spec-suite-coverage.spec.ts` requires every non-`.pg.` spec to be named by an api `package.json` script, the acceptance catalog, or `ci.yml`. `package.json` is off-limits, so the two new unit specs were added to the acceptance catalog's `api-behavior` args (its contract spec pins scenario ids, not suite args, so this is safe) and the real-PG spec was wired into `ci.yml`'s "P27, OCR, and expense payment integrity against PostgreSQL" step as its own `tsx --test` invocation with `AI_BUDGET_RESERVATION_TEST_DATABASE_URL` (same `watchdog_p27_ci` URL) and `AI_BUDGET_RESERVATION_REQUIRE_POSTGRES: 'true'`. api-behavior went 1427 → **1466** (+39 = 32 + 7, exactly the new tests).
3. **Negative correction on a legacy bucketed row (found while proving CI-database safety).** `recordCompanyAiCostAdjustment` returned `refused-negative` whenever the bucket aggregate row was ABSENT, because a guarded `updateMany` matching nothing looks the same as a guard that blocked. A row bucketed before this phase added the aggregate has no such row, so a legitimate correction was rejected for a missing DERIVED value. Now `count === 0` is disambiguated with a `findUnique`: row present ⇒ `refused-negative`, row absent ⇒ the month total already is the whole correction. Three unit tests cover both causes and the happy path.
4. **CI-database hygiene.** `PlatformAiBudgetConfig` is a singleton shared with the sibling specs in that CI step: the one test that needs it now borrows the row and `after()` restores it byte-for-byte (or deletes it if there was none). Pool lowered 30 → 25 against `max_connections = 100`, and `after()` closes it in a `finally`. Proven by running the step's sibling specs, then this spec, then the siblings again on one database: 215/215 both times.

Gates on the final tree: `pnpm --filter @watchdog-bms/api test` rc=0 / 0 `not ok`, and the same 469-file list under TAP = **7624 tests, 7524 pass, 0 fail, 100 skipped**; real-PG spec invoked exactly as the CI step will (identical env var names) **16/16**; acceptance rc=0 (api-behavior **1466/1466**, gateway-behavior **361/361**); `pnpm test:harness` **17/17**; `pnpm --filter @watchdog-bms/web test` **1752/1752**; api typecheck rc=0; pins `status=current`; `git diff --check` clean.

#### Phase E1c implementation — 2026-09-17

The gateway half of ADR 0013: the AI Gateway can no longer spend outside what the API reserved.
Branch `codex/line-ai-remediation-e1c-gateway-envelope-20260917`, on top of E1b's `1fd19156`.

**The hard property first.** A request without a `budgetEnvelope` — every company today, all
`SHARED` — is untouched. The guard is a `Proxy` over the real provider that changes only
`generateText`/`generateWithTools`, and with no envelope in the request context it hands the inner
provider the caller's OWN input object and returns its own result: same bytes, same prompts, same
usage rows, same response, and no money seam is called. The full gateway suite (1,146 tests) passes
with every pre-existing spec unedited, including the one that reads the configured model off the
provider the factory built — which is why a `Proxy` and not a new object.

**What was built.** `withAiBudgetEnvelope` in `apps/ai-gateway/src/common/usage/ai-budget-provider.ts`,
applied inside `createProvider` (the single choke point every agent in every module goes through),
plus `ai-budget-seam.ts` for the two internal API calls and `parseAiBudgetEnvelope` in
`packages/contracts/src/ai-budget-bounds.ts` beside the table it enforces. The interceptor validates
the envelope at the receiver boundary and stores absent / `invalid` / `active` in the existing usage
context; `invalid` refuses every provider call of that request rather than running unmetered. Per
call: the model must match the hold's, `maxTokens` must be declared and inside the output bound, the
request must be provably inside the input bound (UTF-8 bytes + tool specs + 2,000/image +
3,000/PDF-page with at most 8 pages, and an uncountable PDF refuses), call 0 uses the invocation the
API reserved, call `n >= 1` wins its own `budget-step` BEFORE the provider, a call past `maxCalls`
never happens, and every invocation's evidence is posted afterwards from a `finally`. Full rule
table and decisions: ADR 0013 §13.

**Two E1b residuals closed.** `TIMEOUT_INPUT_TOKEN_CEILING = 200_000` no longer applies under an
envelope (the estimate is the declared bound, so a SPLIT timeout can no longer settle above its hold
and trip the breach path); `LineIntakeRouteRequest` gained an optional `webhookEventId` so a TEXT
intake's attempt key is the original webhook event instead of a transport id a redelivery mints
afresh. On the API side `recordCompanyAiUsage` now settles each gateway-tagged usage row against its
own invocation key — a multi-call chain is fully held instead of metering the remainder unheld — and
the AgentCore passthrough refuses SPLIT traffic instead of falling back to an unreserved runtime.

**One real defect found while testing.** `requestLineIntakeRoute` resolved the tenant model policy
only when the intake carried a picture, so a SPLIT company's TEXT lane reserved with an empty model
id and every text message would have been refused `model_unknown`: the shop goes quiet on chat while
the picture lane keeps working. Fixed by resolving it for both lanes, like every other cost-bearing
seam, with a regression test that asserts the hold exists and prices the tenant's approved model.

**Verification on the final tree** (each heavy run behind `/tmp/mangmee-heavy.lock`):
`pnpm --filter @watchdog-bms/ai-gateway test` **1146/1146, 0 fail**; `pnpm --filter @watchdog-bms/api
test` rc=0 with zero failure markers (~10,036 tests, dot reporter, no known failures after merging
E1b `1fd19156`); `pnpm --filter @watchdog-bms/web test` **1752/1752**; `pnpm --filter
@watchdog-bms/contracts test` **253/253**; `node scripts/run-line-ai-whole-chain-acceptance.mjs`
rc=0 (8 suites, 21 repository scenarios); `pnpm test:harness` **17/17**; ai-gateway and api
`tsc --noEmit` rc=0 (api needs `NODE_OPTIONS=--max-old-space-size=8192` on this machine);
`git diff --check` clean. No cloud, LINE or provider access; fake providers and an in-process fake
of the two money seams only.

**Before an operator may open `AI_BUDGET_SPLIT_ACTIVATION_ENABLED`** — honest readiness checklist,
none of it done by this phase:

1. ~~`draft-generate` is held but NOT enforced.~~ **CLOSED** by the controller-review follow-up
   below: the request contract gained optional `companyId` + `budgetEnvelope`, the draft use case
   attaches both when a hold exists, and `createProvider` runs that seam on the envelope's model.
2. **The declared input ceilings are still declared, not measured** (research doc §5.1). No session
   has confirmed the p100 real prompt against production traffic, and byte length is 2–4× loose for
   Thai. Measure a week of real `line-turn` and `receipt-ocr` prompts against
   `AI_BUDGET_STEP_BOUNDS` — a shadow count is enough — before any company is switched.
3. **UAT must exercise a real SPLIT company end to end**: a funded receipt chain (read → extract),
   a chain refused mid-way (the partial result and the Thai copy the shop actually sees), a
   near-limit `insufficient` that must never read "เต็ม", and a timeout. Nothing in this phase ran
   against a real provider or a real LINE channel.
4. **The MONEY of a pre-provider refusal is released now** (follow-up below), but the OCR READ
   COUNT of such a refusal is still consumed on the three OCR seams — `isOcrPreProviderRefusal`
   deliberately does not name the budget codes, because R-05 keeps count refunds separate from
   money. One read per misdeclared bound. And there is still **no operator surface** for
   reconciling `UNRESOLVED` holds or clearing `breach`: decide who clears them and how, first.
5. **A PDF whose page objects live in compressed object streams is refused** under an envelope
   (its page count cannot be proven from its bytes). That is fail-closed by design, but it refuses a
   document a SHARED company reads today — check real customer PDFs before switching an OCR-heavy
   company.
6. **Rollback still means "no binary that ignores SPLIT may serve a SPLIT company"** (ADR §8). The
   enforcement lives in the gateway now, so the gateway and API versions must be pinned together:
   an older gateway ignores `budgetEnvelope` entirely and would run a SPLIT company unenforced
   while the API holds its money.

##### E1c controller-review follow-ups — 2026-09-17

Three items, all landed on the same branch.

1. **`draft-generate` enforced, not just held.** Optional `companyId` + `budgetEnvelope` on
   `AiDraftGenerationRequest` (additive; an older gateway ignores them), attached by
   `generate-suggestion.use-case.ts` ONLY when a hold exists — a SHARED body still carries exactly
   its eight original fields, asserted by a test. That seam sends no per-request model policy, so
   `createProvider` now prefers the envelope's `modelId` over the deployment default when an
   envelope is present; without one nothing changes. A metadata guard in `app.boot.spec.ts` asserts
   all three internal AI controllers carry `AiUsageInterceptor`, since a cost-bearing route without
   it would see no envelope at all. Tests: the SPLIT draft request carries the envelope and settles
   by its invocation key; the SHARED body is unchanged; a gateway refusal releases the hold.
2. **A hold the gateway provably never spent is RELEASED.** One shared predicate —
   `gatewayRefusedWithoutSpending(budgetCode, usage)`: one of OUR codes plus ZERO usage rows —
   feeding `cancelAiBudgetStepIfGatewayUnspent`, which cancels with the existing
   `gateway_pre_provider_refusal` proof under the existing owner fence. Five wiring points (one hook
   in `ai-gateway.client.ts::postInternal` serves all three LINE routes; plus the receipt-OCR web
   client, the statement client, the CRM client reading `error.budgetCode`, and the draft use case).
   ANY usage row blocks the release, so a mid-chain refusal keeps paying for the call that ran, and
   a refusal at ordinal >= 1 has no child hold anyway. Not folded into `isOcrPreProviderRefusal`
   (R-05). Late evidence for a cancelled invocation still records in full through `settled-anomaly`.
3. **The sequential-call assumption is documented and guarded.** Positional attribution is only
   sound while one request's provider calls do not overlap (true today — the single `Promise.all`
   runs ERP tool calls). An in-flight mark on the request's budget state refuses an overlapping
   guarded call with `AI_BUDGET_UNAVAILABLE` before it claims an ordinal, so a future change fails
   loudly instead of settling one invocation's tokens against another.

Re-verification on the final tree: `pnpm --filter @watchdog-bms/ai-gateway test` **1150/1150**;
`pnpm --filter @watchdog-bms/api test` rc=0, zero failure markers; `pnpm --filter @watchdog-bms/web
test` **1752/1752**; contracts **253/253**; acceptance rc=0 (api-behavior **1472/1472**,
gateway-behavior **369/369**); `pnpm test:harness` **17/17**; ai-gateway and api `tsc --noEmit`
rc=0; `git diff --check` clean.
