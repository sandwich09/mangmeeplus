# Agent Memory: LINE AI wave 2 — เครดิต AI wording, receipt refusal copy, deterministic reads

Status: WAVE 2 IMPLEMENTED AND MERGED to `develop` + `main` (H2 #624/#626, H1 #627/#628, H3 #630/#631, 2026-09-18) after the activation-flag PRs #622/#623; NOT deployed; spec W-01…W-08 and J-01…J-07 ticked with evidence, W-09/J-08 (UAT) open. See "Wave 2 delivery summary and handoff" at the end of this file.
Owner: thawatchai + Fable 5.1 (controller) + Opus 5 (implementer)
Scope: [spec](../specs/line-ai-credit-wording-and-deterministic-reads-spec-th.md), [plan](../plans/line-ai-credit-wording-and-deterministic-reads-plan-th.md). Continues the A–F remediation ([handoff](line-intake-cost-and-budget-receipt-behavior-2026-09-17.md#delivery-summary-and-handoff--2026-09-18)).
Decisions:
- "เครดิต AI" (not bare "เครดิต") because the ledger/expense UI already uses เครดิต for debit/credit, credit cards and tax credit.
- Document-reading refusals on the picture lane collapse money (OCR bucket / TOTAL on that lane / insufficient) and read-count exhaustion into one customer sentence "เครดิตสำหรับการอ่านเอกสารไม่พอ"; codes, scopes, terminal classes and the R-05 count/money separation are unchanged.
- R5: deterministic families widened (tax/VAT, low stock, AP outstanding, CRM new customers + the daily-closing miss); breakdown/explain questions stay on the grounded agentic path where the composer's numeric guard forbids model-computed numbers; Production keeps the lane enabled (parity default).
- Trial numbers (spec §7): chat 80 THB, receipts 15 (count), OCR money guard 60 THB, total 140 THB — applied per company by an admin after deploy; per-package defaults belong to the coming credit concept.
Open questions:
- ~~Owner authorisation for the R5 corpus replay Bedrock spend~~ — granted 2026-09-18; run done, THB 16.52 of the THB 100 phase guard (see H2 Verification).
- (closed 2026-09-18) Owner approved the hold-reconciliation proposal → [spec](../specs/line-ai-credit-hold-reconciliation-spec-th.md); CloudWatch recovery replaced by in-process durable retry + graceful drain (reason in that spec §2). Implemented in H3 below.
- H3 residual for the owner: there is **no read-only platform role**. `canManage: false` has been an API fact since D2 and the page handles it, but `apps/web/app/system/layout.tsx` admits only a membership carrying the `SYSTEM_ADMIN` role key, and that role holds every `system.*` permission — so no real login can open the partner console read-only. Creating such a role changes who may see every other system page too, so it is an owner decision, not a side effect of H3.
- H2 residual for the owner: `tax.get_vat_summary` has no whitelisted input field, so neither the lane nor the loop can ask for a period other than the current one — `ภาษีเดือนที่แล้ว` is answered for the period the tool defaults to, labelled with that period. Whitelisting `periodKey` changes the intake catalog, so it needs its own round.
- H2 residual: letting the model give real advice needs `SAFE_REPLY_WORDS` widened (and its compound entries fixed — `ตรวจสอบ` never matches because `Intl.Segmenter` splits it). That widens what the model may say, so it is an owner decision, not a side effect of this wave.

## H2 — deterministic business reads (R5), 2026-09-18

Artifacts (worktree `/private/tmp/mangmee-line-ai-wave2-h2-20260918`, branch `codex/line-ai-wave2-h2-deterministic-reads-20260918`, off docs commit `5d158ff0`):

| file | why |
| --- | --- |
| `apps/ai-gateway/.../agents/prepared-simple-read-formatter.ts` | F4–F7 compiled formatters + `isCount`/`isMoney`; registry now 10 keys |
| `apps/ai-gateway/.../agents/prepared-simple-read-formatter.spec.ts` | F4–F7 answer/empty/locale/unverified tests against the REAL tool shapes |
| `apps/ai-gateway/.../domain/logic/prepared-simple-read.logic.spec.ts` | the daily-closing miss pinned per plan variant + eligibility for all four new families |
| `apps/ai-gateway/.../agents/orchestrator.agent.ts` | `date` joins the civil-date/backing check; `no_prepared_plan` fallback reason |
| `apps/ai-gateway/.../agents/orchestrator.agent.spec.ts` | prepared-lane telemetry tests (served / reason / no_prepared_plan / silent) |
| `apps/ai-gateway/.../agents/inventory.agent.ts` | low-stock fact carries its source ref; the tool as-of is no longer dropped |
| `apps/ai-gateway/.../agents/response-composer.agent.ts` | Thai numerals normalised before every numeric membership test (both guards) |
| `apps/ai-gateway/.../agents/response-composer.agent.spec.ts` | W-06 grounded-breakdown tests |
| `apps/api/.../use-cases/erp-tools.use-case.ts` | low-stock tool leads with its report source ref, not a product id |
| `infra/prod-ecs-express/deploy.sh` | 10-family default allowlist, both envs; stale "production refuses" comment corrected |
| `infra/prod-ecs-express/production-serving-mode.spec.sh` | pins every compiled family in the default |
| `scripts/line-ai-intake-cost-benchmark.ts` | PROD_FLAGS allowlist mirrors deploy.sh; VAT + AP stub shapes corrected to the real tool results |
| `.github/workflows/deploy-production.yml`, `infra/security/validate-production-maintenance-release.sh` | pin re-sync (the syncer's own two lines) |

Decisions:
- `text-read-daily-closing` is NOT a gate/formatter defect: the corpus message is two requests in one, so the intake plan is `complex` (`not_simple`) or carries no simple `answerShape`. One simple daily-closing read is eligible and served (test-pinned). Left alone.
- AP and CRM register both read shapes; the deterministic answer is identical either way and `answerShape` only selects a renderer.
- The low-stock family prints a count and no product: the tool's rows carry ids, quantities and location ids only — no name, sku or unit.
- The AP family prints no supplier: `supplierDisplayName` is the supplier id upstream.
- The VAT family prints the tool's period key, both VAT sides, the raw period status and a compiled not-certified line, and never renders a negative "ต้องนำส่ง".

Verification (all local, 2026-09-18, heavy ones behind `/tmp/mangmee-heavy.lock`):

| command | result |
| --- | --- |
| `pnpm --filter @watchdog-bms/ai-gateway test` | 1186/1186 pass, 0 fail (141 suites) |
| `pnpm --filter @watchdog-bms/ai-gateway lint` (tsc --noEmit) | clean |
| `pnpm --filter @watchdog-bms/api test` (apps/api touched) | exit 0, 9164 dot-tests, 0 failures |
| `node scripts/run-line-ai-whole-chain-acceptance.mjs` | PASS (all 8 suites, incl. serving-mode contract) |
| `pnpm test:harness` | 17/17 pass |
| `bash infra/prod-ecs-express/production-serving-mode.spec.sh` | PASS |
| `node infra/security/sync-production-maintenance-release-pins.mjs` then `--check` | updated → current |
| `git diff --check` | clean |
| focused: formatter + security + eligibility + composer specs | 219/219 pass (security spec unmodified) |

Corpus replay (W-07), owner-authorised, real Bedrock via `AWS_PROFILE=watchdog-bedrock`, corpus `cf9bce44…`, THB 33/USD, 2 repetitions, business-read text tasks only, `--max-thb 60`:

```sh
cd apps/ai-gateway
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

Result (run `r5-after-2026-09-18T05-24-00-176Z`, git `21e45227`; before = `after-2026-09-17T16-13-27-267Z`): prepared-lane hit 8 → **16** of 22 records, success 22/22 and routing 22/22 unchanged (no success→fail), calls/turn 4.27 → 2.50, THB/successful 0.942 → 0.750. Spend: smoke THB 0.01 + run THB 16.51 = **THB 16.52** of THB 100 (ledger `<scratch>/agent-h2/spend-ledger.jsonl`). Still missing the lane: expense-breakdown and explain-record (no family by design) and daily-closing (router's plan). Detail + the four "found, not changed" items in [research §14](../research/line-ai-intake-cost-benchmark-2026-09-17.md).

Telemetry to read production with: `line.ai.prepared_simple_read.served` (`tool`, `answerShape`), `.honest_terminal` (`tool`, `status`), `.fallback` (`reason` — the eligibility reason, plus the new `no_prepared_plan` for a business read that arrived without a plan). All carry `requestId` only; no message text.

Next: H1 wording/receipt-copy/billing holds (separate worktree), controller review of this diff, then PR pair and the strict CI chain. H2 is NOT deployed; W-08/W-09 belong to H1 and to the post-deploy UAT pass.

Artifacts:
- H1 diff (33 files, +~430/-~200, all local commits with explicit paths):
  - LINE: `process-line-webhook.use-case.ts` (`aiBudgetReasonTh` now also answers `OCR_MONTHLY_LIMIT_EXCEEDED`/`OCR_QUOTA_UNAVAILABLE`; new `isDocumentReadingCreditSpent` for the 💚/⏳ choice; two now-dead governance branches deleted), `line-business-card.logic.ts`, `line-ai-formatter.logic.ts`, `apps/ai-gateway/.../line-ai-turn.use-case.ts`
  - Web customer/owner: `workspace-dictionary.ts` (th + en `expenses.extract_ai_budget_*`), `banking.logic.ts`, `InboxAiPanel.tsx`, `api-error-message.ts`
  - Admin: `PartnerDetailPage.tsx`, `ai-budget.logic.ts`, `PartnerAiAdjustmentHistory.tsx`, `PlatformAiBudgetPage.tsx`, `SystemHeader.tsx` (sidebar "เครดิตการใช้ AI"), `get-partner-timeline.use-case.ts`, `signup-ops-alert.service.ts`, `admin-ai-adjustments-smoke.ts`, `partner-ai-support-smoke.ts`
  - Billing (W-04): `packages/contracts/src/billing.ts` (`AI_CREDIT_HOLDS_PENDING`, `aiReservedSatang?`, `aiUnresolvedHolds?` — all additive), `company-ai-budget-readiness.ts` (`reserved: {TOTAL,CHAT,OCR}` from the snapshot it already reads), `billing-receipt-adjustments.service.ts`, `billing-plan-adjustments.service.ts`, `BillingReceiptAdjustmentsPage.tsx`, `BillingPlanAdjustmentsPage.tsx`
  - Guard: new `it` in `apps/web/src/common/api/api-error-coverage.spec.ts` greps apps/web+api+ai-gateway/src, packages/*/src, scripts, e2e for "งบ AI"/"โควตา AI"; allowlist holds exactly one entry (that spec itself, which must spell the phrases)
- Browser evidence: `docs/qa/evidence/line-ai-credit-wording-2026-09-18/` — 7 subjects × 1440/390 px (576 KB total), README with commands, seeded states and what each image proves
- Scratch (not in the repo): `<session scratch>/agent-h1/{env.sh,seed-h1-states.ts,capture.mjs}`
Verification (H1, 2026-09-18, all local, each heavy job behind `/tmp/mangmee-heavy.lock`):
- FULL `pnpm --filter @watchdog-bms/api test` → 10,553 tests, 0 failures (dot reporter; counted dots)
- FULL `pnpm --filter @watchdog-bms/web test` → 1,771 pass / 0 fail
- FULL `pnpm --filter @watchdog-bms/ai-gateway test` → 1,151 pass / 0 fail
- `pnpm --filter @watchdog-bms/contracts test` → 253 pass / 0 fail
- Focused: web 101 pass; api 700 (698 pass, 2 skipped = the two PG-only cases); gateway 33 pass
- `node scripts/run-line-ai-whole-chain-acceptance.mjs` → 21 repository scenarios + 3 controlled-external, 8 suites, all PASS
- `pnpm test:harness` → 17 pass / 0 fail
- Typechecks: api `tsc --noEmit` OK (needs `--max-old-space-size=8192`; the plain `pnpm lint` OOMs on this machine), web `next typegen && tsc --noEmit` OK, gateway OK, contracts OK
- `git diff --check` clean; final `grep -rn "งบ AI\|โควตา AI" apps packages scripts e2e infra` = only the 4 self-referential lines in the guard spec
- NOT run: `admin-ai-adjustments-smoke.ts` / `partner-ai-support-smoke.ts` (need the combined `billing-http-smoke` harness with Stripe fixtures and a second browser context, which the throwaway evidence stack does not provide) → their new selectors are proven by the `partner-ai-credit-form` screenshots and by CI
- Throwaway evidence stack: Postgres 15484 / Redis 16384 containers, API 3084, web 3085, `BILLING_MODE=test` with no Stripe secret, no provider, no LINE, no cloud; torn down, `apps/web/next-env.d.ts` restored, generated `apps/web/{AGENTS,CLAUDE}.md` removed
Next:
1. Controller (Fable) reviews the H1 diff for bugs/gaps/impact.
2. ~~H2 (deterministic reads, spec §6 / W-05–W-07)~~ — done, see above.
3. Merge develop into the H1 branch, then PR pairs + strict CI chain; the two browser smokes get their first real run there.
4. W-09 (real LINE transcript) after a UAT deploy, per the deployment runbook.
5. H3 is implemented and locally verified (see below). Controller review, then it rides the same PR
   chain; hold-spec J-08 (synthetic hold cleared through the real UAT page) after that deploy.

H1 findings worth carrying:
- The retired wording also hid behind collocations `grep "งบ AI"` cannot see: the sidebar item `งบการใช้ AI` (`SystemHeader.tsx`) and `platform_ai_budget_default_below_split_allocation` (`งบเริ่มต้น…`). Naive `sed` on `งบ` is unsafe — `ของบริษัท` and `ลงบัญชี` both contain it.
- `workspace-i18n.spec.ts` asserts the five `expenses.extract_ai_budget_*` reasons each read DIFFERENTLY, so §4's one-sentence collapse was applied to the LINE picture lane only (which is what W-02 asks for); the web keys took the §3 vocabulary and kept their distinct reasons.
- `isAiBudgetPermanentRefusal` answers for the four money codes only. Routing `OCR_MONTHLY_LIMIT_EXCEEDED` onto the shared sentence needed its own predicate, or a count ceiling would have been rendered with the transient ⏳.
- `readAiBudgetReadiness`'s truth table is asserted with `deepStrictEqual`, so the additive `reserved` field required three expectation updates in `company-ai-usage-meter.spec.ts` — behaviour unchanged.

## H3 — reconciling held AI credit (unresolved holds and breach), 2026-09-18

[Spec](../specs/line-ai-credit-hold-reconciliation-spec-th.md) (J-01…J-07 ticked, J-08 open),
[plan H3](../plans/line-ai-credit-wording-and-deterministic-reads-plan-th.md#h3-เคลียร์เครดิตที่กันไว้ค้าง--spec-แยก-owner-อนุมัติ-2026-09-18),
[ADR 0013 §14](../adr/0013-ai-budget-split-reservations.md#14-implementation-notes-h3).

Artifacts (worktree `/private/tmp/mangmee-line-ai-wave2-h3-20260918`, branch
`codex/line-ai-wave2-h3-hold-reconciliation-20260918`, off the merged H1+H2 commit `ef8bd608`;
four local commits `a53015ec` gateway, `c618e605` api, `4aedd5c3` web, `cb69c910` evidence):

| file | why |
| --- | --- |
| `apps/ai-gateway/.../usage/ai-budget-durability.ts` | NEW. Process-wide settle-evidence queue (1s/5s/30s/60s, ~10 min, 1,000 cap, ids-only drop log) plus the in-flight gauge the drain waits on, plus `drainAiBudgetDurability` |
| `apps/ai-gateway/.../usage/ai-budget-shutdown.service.ts` | NEW. 12 lines: `OnApplicationShutdown` → the drain, with the configured budget. Explicit `@Inject` token (the tsx boot spec emits no ctor metadata) |
| `apps/ai-gateway/.../usage/ai-budget-seam.ts` | the two inline attempts factored into `attemptOnce`, which the queue re-posts verbatim; `companyId` added to the settle input for the log lines |
| `apps/ai-gateway/.../usage/ai-budget-provider.ts` | `begin/endGuardedProviderCall` around the guarded call (inside the envelope branch only) and `companyId` passed to settle |
| `apps/ai-gateway/src/main.ts` | `app.enableShutdownHooks()` — without it Nest ignores SIGTERM entirely |
| `apps/ai-gateway/.../usage/ai-usage.interceptor.spec.ts` | +13 tests. Same file as the envelope machinery, for the reason already recorded there: the gateway's `package.json` test list is a fixed list this change may not edit |
| `apps/api/prisma/{schema.prisma,migrations/20260918100000_ai_credit_hold_reconciliation}` | `breachAcknowledgedAt/By` (nullable, no FK) + the `AiUsageEvent_usageBasis_check` widened for the new basis |
| `apps/api/.../line-ai/application/company-ai-budget-reservation.ts` | `operator_released` proof, the three operator primitives, `sweepAiBudgetCompanyMonth`, `listAiBudgetCreditHolds`, `shortenInvocationKey`, the `UNACKNOWLEDGED_BREACH` predicate, and the `operator` block on `settleAiBudgetStep` |
| `apps/api/.../use-cases/partner-ai-credit-holds.use-case.ts` | NEW. Reason, company lock, sweep-before-read, DTO mapping and the four typed refusals |
| `apps/api/.../http/partner.controller.ts` | `GET …/ai-credit-holds` (dashboard read) + three POST actions (`system.partner_ai_model.manage`) + the one-field body DTO |
| `apps/api/.../partner-ai-adjustment-history.ts`, `.../audit-action.ts` | the three new actions read into the SAME history list; two new before/after fields |
| `apps/api/.../get-partner-ai-usage.use-case.ts` | `OPERATOR_CHARGED_AT_BOUND` in `USAGE_BASES`, before UNKNOWN |
| `apps/api/.../signup-ops-alert.service.ts` + `signup-claim-email-internal.controller.ts` | `ai_credit_holds_unresolved` on the existing 15-minute sweep, counting companies |
| `apps/api/src/common/config/app-config.service.ts`, `packages/config/src/index.ts` | `AI_CREDIT_HOLD_ALERT_AFTER_HOURS` (24) and `AI_GATEWAY_SHUTDOWN_DRAIN_MS` (20,000) |
| `packages/contracts/src/{ai-lineage,partner-management}.ts` | the new basis member, `PartnerAiCreditHold*` DTOs, two history fields |
| `apps/web/.../ai-budget.logic.ts` (+spec) | step-kind labels, kind labels, age text, the three consequence texts, the conflict predicate, the new basis label |
| `apps/web/.../PartnerDetailPage.tsx` | `AiCreditHoldsPanel` + the state/handler under the existing `generation` token |
| `apps/web/.../PartnerAiAdjustmentHistory.tsx`, `system-partners.api.ts`, `api-error-message.ts` | Thai for the two new fields, the read + one action writer, four new Thai error texts |
| `.github/workflows/ci.yml`, `scripts/line-ai-whole-chain-acceptance.catalog.mjs` | the pg spec's two env vars + run line; the new api unit spec registered (spec-suite-coverage guard) |
| `docs/qa/evidence/line-ai-credit-holds-2026-09-18/` | 24 element screenshots (1.1 MB) + README + 4 manifests |

Decisions worth carrying:

- **`eventKind = COST_ADJUSTMENT` for an operator charge**, not a third event kind. The D1 breakdown
  already means "money, not a provider call" by it, and the web already prints
  "ซึ่งไม่นับเป็นจำนวนครั้งที่เรียกโมเดล" for it — so J-07 fell out of existing logic with no new
  branch and no widened `eventKind` CHECK.
- **`normalizeUsageBasis` stays at two values.** The new basis is in the contract but the
  untrusted-wire guard does not accept it, or a gateway could label a real call an operator decision
  and (through the event kind above) hide it from the call count.
- **`breach` is never cleared**; the acknowledgement is two new columns and one shared predicate.
- **The operator cancel proof has no owner token** — a stranded hold has no live owner. Fenced on
  `status='UNRESOLVED'` + reservation id + the route's company id instead.
- **The drain budget is 20s** because `deploy.sh` sets no `stopTimeout` on the ECS Express
  `primaryContainer` (the shape has no such field) → ECS's own 30s. Kamal's 180s is the native path.
- The gateway tests live in `ai-usage.interceptor.spec.ts` because `package.json` is off-limits;
  the new API unit spec went into the whole-chain catalog for the same reason.

Verification (all local, 2026-09-18, heavy ones behind `/tmp/mangmee-heavy.lock`):

| command | result |
| --- | --- |
| FULL `pnpm --filter @watchdog-bms/api test` | exit 0, 9,174 dot-tests, 0 failures |
| FULL `pnpm --filter @watchdog-bms/ai-gateway test` | 1,198/1,198 pass (143 suites), 0 fail |
| FULL `pnpm --filter @watchdog-bms/web test` | 1,780/1,780 pass, 0 fail |
| `pnpm --filter @watchdog-bms/contracts test` | 253/253 |
| `pnpm --filter @watchdog-bms/config test` | 143/143 |
| `company-ai-credit-holds.pg.spec.ts` (throwaway PG 15487) | 10/10 |
| `company-ai-budget-reservation.pg.spec.ts` (same DB) | 16/16, no regression |
| focused: reservation 62, hold use case 21, partner controller 25, ops alert 26, web logic 48, gateway interceptor 46, api meter/usage/history/coverage 232 (+5 PG-only skips) | all pass |
| `node scripts/run-line-ai-whole-chain-acceptance.mjs` | PASS, 8 suites |
| `pnpm test:harness` | 17/17 |
| typechecks api (`--max-old-space-size=8192`) / web (`next typegen && tsc`) / gateway / contracts | all clean |
| `pnpm --filter @watchdog-bms/api test:boot` | Nest resolved every provider in 133 ms |
| `prisma migrate diff` (migrated throwaway DB → schema) | no H3 delta; the 12 residual items (6 renamed indexes, 4 `updatedAt` defaults, 1 FK move) are identical against the pre-H3 committed schema, so they are pre-existing repo drift |
| `git diff --check` | clean |

Findings worth carrying:

- `app.boot.spec.ts` caught a real defect: a gateway provider without an explicit `@Inject(...)`
  token resolves to `undefined` under the tsx local-dev loader, and the shutdown hook then throws on
  the way out. Every gateway provider needs the explicit token.
- `get-partner-ai-usage.use-case.spec.ts` asserts `byUsageBasis` with `deepEqual`, so adding a basis
  key required updating that expectation — behaviour unchanged, the slice still reconciles.
- The evidence stack needs `CORS_ALLOWED_ORIGINS` to list the SAME host the browser uses
  (`127.0.0.1`, not `localhost`): the GETs pass through the Next proxy either way, but the three
  POSTs answer **500 "Origin is not allowed by CORS"**. Cost one wasted capture run.
- `prisma migrate diff` in Prisma 7 takes `--from-config-datasource` / `--to-schema`;
  `--from-schema-datasource` and `--shadow-database-url` print the help text and exit 0, which reads
  like a pass. Always check the output, never the exit code alone.

## Wave 2 delivery summary and handoff — 2026-09-18

Owner decisions of 2026-09-18 delivered the same way as wave 1 (Opus 5 implements, Fable 5.1 reviews every diff for bugs/gaps/impact, full local gate on the base-merged tree, PR pair, strict CI chain, admin-merge to `develop` + `main`):

| Phase | What | PRs (develop / main) |
| --- | --- | --- |
| G0 | `AI_BUDGET_SPLIT_ACTIVATION_ENABLED=true` as the UAT + Production deploy default (owner decision; SPLIT is savable, no company changes by itself) | #622 / #623 |
| H2 | R5 — four new deterministic families (VAT, low stock, AP outstanding, CRM new customers), Thai-numeral hole in the composer numeric guard closed, `date` sanitizer, telemetry denominator; owner-authorised Bedrock replay: prepared-lane hits 8 → 16 of 22 business reads, THB/successful task −20.4%, spend THB 16.52 | #624 / #626 |
| H1 | "เครดิต AI" wording everywhere people read it; picture-lane refusal collapsed to "เครดิตสำหรับการอ่านเอกสารไม่พอ"; billing hold warnings; guard test against the old words; evidence bundle | #627 / #628 |
| H3 | held-credit reconciliation: gateway durable settle queue + graceful drain, operator console (release / charge-at-bound / acknowledge-breach with audit + history), 15-minute alert, pg spec, evidence bundle | #630 / #631 |

Defects caught before merge: api typecheck error in H2 (`SourceRef` literal type lost in a spread — the implementer had run tests, not `tsc`), Thai numerals bypassing both composer guards (H2), gateway `main.ts` pin left stale after `enableShutdownHooks()` (H3 — the pins check belongs in every brief's verify list).

State: NOTHING IS DEPLOYED. The next deploy carries migrations `20260917140000`, `20260917150000`, `20260917160000` (wave 1) and `20260918100000_ai_credit_hold_reconciliation` (H3), all additive. After a runbook-governed UAT deploy: W-09 (credit wording seen on real LINE) and J-08 (clear a synthetic stranded hold through the real page) close the two open lines.

Owner-facing items still open: the credit CONCEPT (units, top-up, verification, per-package defaults — the trial numbers chat 80 / documents 60 / total 140 THB are per-company admin settings until then); a read-only platform role (today every real login is `SYSTEM_ADMIN`, so `canManage:false` surfaces are unreachable); `tax.get_vat_summary` exposes no period input (last month cannot be asked on either path); the composer vocabulary guard is what blocks most advice wording (widening it is a product decision).
