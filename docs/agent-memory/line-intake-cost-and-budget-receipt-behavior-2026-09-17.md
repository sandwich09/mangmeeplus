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
