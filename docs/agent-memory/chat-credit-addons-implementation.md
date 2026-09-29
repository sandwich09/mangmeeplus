# Agent Memory: chat-credit-addons-implementation

Status: PR A (shared billing foundation) merged to develop as #878 (`3a863b70`). PR B (receipt image ledger, shared add-on grant seam, admin grant for images) implemented 2026-09-29 on branch `claude/addons-pr-b-image-ledger-20260929` (worktree `/private/tmp/mangmee-addons-pr-b-20260929`, base develop `3a863b70`); committed, not pushed, no PR, not deployed. PR C–G not started.
Owner: thawatchai / Claude (controller + implementer)
Scope: add-on program PR A–G — spec `docs/specs/chat-credit-and-receipt-addons-spec-th.md`, plan `docs/plans/chat-credit-and-receipt-addons-plan-th.md`. Sales-event discounts (`docs/specs/sales-event-discounts-spec-th.md`, plan SD-A…SD-F) builds on PR A.

Decisions:
- Owner 2026-09-29 “อย่าทำ switch อีก เปิดไว้เลยเสมอ” (spec O-04): no `addon_chat_credit`/`addon_receipt_image` gate, no flag, no env. An offer is sellable once `addOnPriceIds[offerKey]` is bound in the ACTIVE policy and its product is ready (IMAGE after PR B, CHAT after PR C/D). PR A sells nothing: no quote path, and the reconciler rejects add-on snapshots. `billing-addon.spec.ts` asserts `BILLING_ACTIONS` has no add-on key.
- Owner 2026-09-29 “ตามค่าเริ่มต้น”: add-on Q1–Q7 (spec §3.3) and sales-event SD-Q1, Q2, Q3, Q5, Q8, Q9 (spec §12, SD-O9) take their proposed defaults.
- A4 is one helper, `latestPackageInvoice(db, where)` in `billing.service.ts`, used by all four `periodEnd desc` readers (`billing.service.ts:817`, `billing-admin.service.ts:92`, `billing-notifications.service.ts:380,423`). The PG spec exercises that helper, so it tests the code the readers run.
- A5: contracts decoder `billingProductKind` (absent = PACKAGE, unknown = null) → API `snapshotProductKind` (unknown throws `billing.product_kind_unknown`). The reconciler throws `billing.addon_reconcile_unsupported` in `reconcileAccount` (before one-time dispatch), `importDiscoveredInvoice` and `reconcileOriginalInvoice`. PR E replaces the last two with the add-on branch and keeps the first: the package slot never holds an add-on.
- PR A adds no API error code, so no web Thai text. Parser errors are message-only 400s, like `zeroPriceIds`.
- Not touched, as instructed: `paid-invoice.ts`, `paid-checkout-invoice.ts`, `billing-schedule.ts`, `packages/contracts/src/line-ai.ts`, any `package.json`, `billing-configuration.service.ts`.

What later PRs must do instead of the gates:
- PR E: the purchase condition is “Price bound in the ACTIVE policy and product ready” (`BILLING_ADDON_OFFER_UNAVAILABLE` when unbound, `BILLING_ADDON_NOT_READY` when not ready). Keep `new_sales`, `card_once`/`promptpay_once` and `salesCompanyIds`. Catalog and status use the same rule.
- PR E: `validateProvider` in `billing-configuration.service.ts` checks every bound add-on Price at PUBLISH_POLICY (one-time, THB, amount from `BILLING_ADDON_OFFERS`, active, livemode, tax behavior). The impact preview lists `addOnPriceIds` changes, because binding a Price opens that sale.
- PR E or F: `apps/web/src/features/billing-admin/BillingConfigurationPage.tsx` has no inputs for the six add-on Prices, and no PR in the plan owns them. Needed before U2.
- To close one product, publish a policy without its Price. `new_sales` closes everything. Neither removes balances or stops reconcile, refunds or history.

Findings for later PRs (current code, not in the A4 list):
- These readers read every invoice of the account and will see add-on invoices: `billing.service.ts:179` `purchaseSource` (any paid invoice when not attempt-bound), `billing-restart.ts:34` (every mapped invoice must be APPLIED and unrefunded), `billing-repeat.ts:143` `assertNoDebt` (every Stripe paid invoice must be mapped and APPLIED). A HELD or refunded add-on would block RESTART/REPEAT, which breaks A33. PR E must filter PACKAGE there.
- Attempt readers that are not `activeAttemptId`: `billing-checkout-expiry.service.ts:45` (admin attempt list; E6), `process-line-webhook.use-case.ts:2783` (support reference; harmless). The COMPLETED-attempt readers in `billing-schedule.ts:41` and `billing-repeat.ts:427` match only `scheduleId`/`repeat`, so add-on attempts are ignored.

Open questions:
- Does O-04 (no switches) also cover the sales-event `event_discounts` gate that SD-A adds to `BILLING_ACTIONS`? Owner/controller must answer before SD-A starts. The add-on spec §19 and plan §1 now say “open the event discounts” without naming a gate.

Artifacts:
- Migration `apps/api/prisma/migrations/20260929120000_billing_product_foundation/migration.sql` (ADD COLUMN ×3, CREATE UNIQUE INDEX on the slot, CREATE INDEX `(billingAccountId, productKind, periodEnd)`; passes `assertProductionA5NoDestructiveSql`).
- Code: `schema.prisma`, `packages/contracts/src/billing.ts`, `billing-policy.ts`, `billing.service.ts`, `billing-admin.service.ts`, `billing-notifications.service.ts`, `billing-reconciler.service.ts`.
- Tests: `packages/contracts/src/billing-addon.spec.ts` (`ci.yml` contracts line), `apps/api/src/modules/billing/domain/billing-policy-addon.spec.ts` (catalog `api-behavior`), `apps/api/src/modules/billing/billing-product-foundation.pg.spec.ts` (`ci.yml` Step 0 PG step, env `BILLING_PRODUCT_FOUNDATION_TEST_DATABASE_URL`).
- Docs: plan PR A note, add-on spec O-04 + §3.3, sales-event spec SD-O9 + §12, sales-event plan P3, runbook “Binary ขั้นต่ำต่อ schema ของ billing policy”, purchase-without-setup spec §9 note.
- `ci.yml` changed, so it must twin to main before any UAT `all` dispatch (plan §3.3).

Verification (2026-09-29, worktree above):
- contracts: build 0, typecheck 0, package tests 339/339, `ci.yml` contracts line 26/26 (new spec 4/4).
- api: typecheck 0 (after `prisma generate`), `test:boot` 0 (“Nest resolved every provider”), `billing-policy-addon.spec.ts` 4/4, `ci.yml` API lines 9/9 and 14/14, spec-suite-coverage 3/3, remaining importers of the changed modules 5/5.
- `node scripts/run-line-ai-whole-chain-acceptance.mjs`: exit 0, 12 suites, 3276 tests, 0 fail.
- W00 manifest spec 4/4, not regenerated (no hashed file changed). `sync-production-maintenance-release-pins.mjs --check`: status=current. Web typecheck 0. `git diff --check` clean.
- PG on throwaway postgres:16 `mangmee-addons-pra-pg-20260929` (port 15532, fresh `migrate deploy` of two DBs, removed afterwards): foundation 4/4, recipient-capture 3/3, admin-tools 3/3; Extended billing PG (receipts, grace, trial-carryover, caps, issues, advance-deal, purchase-source) 58/58; settings + issue-resolution 7/7.

## PR B (2026-09-29)

Decisions:
- Image cut-over = the company's receipts come from its billing account's lots (`CompanyPlanTerm.billingReceiptAccountId`, spec §11.3/§16 item 9). No separate image marker; `aiCreditCutoverAt` (PR C) is AI credit only. `LEGACY_MONTH` shops keep every old rule.
- B1 allocator (`billing-receipt-grants.ts`): package (INITIAL/RENEWAL/REPEAT/UPGRADE/TRIAL_CARRYOVER) → team (ADMIN_ADJUSTMENT/ADD_ON_ADMIN/SALES_EVENT) → purchased (ADD_ON_PAID), FEFO inside a group; unknown kind fails closed. This changes lot order for paid shops that hold a legacy ADMIN_ADJUSTMENT gift (package first, previously FEFO across both) — spec §6/D8 asks for it. `billing-trial-carryover.pg.spec.ts` asserted the old order (`paid-uses-earliest-gift` → ADMIN_ADJUSTMENT); updated to `paid-uses-package-before-gift` → TRIAL_CARRYOVER.
- `packageReceiptBalance` excludes only the three add-on kinds (plan text says "package kinds only"; excluding ADMIN_ADJUSTMENT would change quotes/usage of shops with legacy gifts). Package flows and `receiptQuotaSnapshot` use it, so the existing `BillingReceiptUsage` keeps its meaning; add-on balances are PR E's `quotaSummary`.
- Ledger: `ReceiptUnitEntry` (RESERVE/CONSUME/RELEASE/REVOKE, unique `(companyId, operationKey, generation, kind)`, `operationKey = <sourceRoute>:<requestId>`). `CompanyOcrUsageEvent.receiptUnitGeneration` null = admission from before the ledger, still counted from its event: no backfill, and a rolling deploy cannot hand out a unit twice. Resume renews the event id, not the generation.
- D4/Q4: `settleCompanyOcrAdmission(..., noReceipt)` releases a non-receipt read in a cut-over shop but keeps the event (request fence; the ops brake still counts the provider read). Technical failures still go through `releaseCompanyOcrAdmission` (deletes the event). Signature/reference/substitute/UNSUPPORTED/CLARIFY LINE images still CONSUME (charged as today) — needs a LINE-AI owner decision (PR F).
- Seam API (for PR C, PR E, SD-F): `applyAddOnGrant(tx, { companyId, billingAccountId, productKind, sourceKind: 'ADD_ON_PAID'|'ADD_ON_ADMIN'|'SALES_EVENT', sourceKey, sourceHash (sha256 hex), units, at })` → `{ productKind, lotId, units, availableAt, expiresAt, replayed }`, plus `addOnGrantReady(db, companyId, billingAccountId, productKind)`. Takes L1 → L4 itself (re-entrant); runs in the caller's transaction; caller verifies its source and writes its own audit. No `expiresAt` input (spec §16 item 1 lists one): always `appendPackageInterval(at, 'year')`. Same key + same payload (hash excludes `at`) returns the first lot and dates; different payload throws `billing.addon_source_changed`. `CHAT_CREDIT` throws `billing.addon_consumer_not_ready` until PR C adds its branch (and `addOnGrantReady`'s).
- B5 admin: reviewed `ADDON_ADMIN_GRANT`/`ADDON_ADMIN_REVOKE` with the receipt-adjustment permission set. Revoke is a preview type (spec §8.1 listed a `revoke` action). Revoke only team lots (ADD_ON_ADMIN, SALES_EVENT), REVOKE entry for unused units + `revokedAt`. New Thai texts: `CONTROL_ADDON_NOT_READY`, `CONTROL_COMPANY_HELD` (the latter already thrown by the legacy receipt adjustment without text).
- B6: quota card claim key `<monthKey>` (no add-on lot, unchanged) or `<monthKey>#<latest add-on lot createdAt ms>`, computed inside claim/release, so `process-line-webhook.use-case.ts` needed no card change.
- Migration `20260929150000_receipt_unit_entries` also replaces `BillingReceiptGrant_valid_units_period_kind` with a wider check (add-on kinds, units > 0) by the same drop/add the ADMIN_ADJUSTMENT and TRIAL_CARRYOVER migrations used; passes `assertProductionA5NoDestructiveSql`.
- The PG spec went to the `ci.yml` Step 0 release gate (controller instruction), not `extended-tests.yml` (plan §3.1): `ci.yml` changed again → twin to main before any UAT `all` dispatch.

`process-line-webhook.use-case.ts` lines touched (for the in-flight LINE media fixes): import at `:175` (+`settleCompanyOcrAdmission`), type at `:379` (+`noReceipt?`), `executeReceiptUpload` finally `:7974-7977` (new `else if` settle branch), non-receipt classification `:8587` (`admissionAttempt.noReceipt = true`).

Blockers / hand-offs for PR C:
- Add the `CHAT_CREDIT` branch to `applyAddOnGrant` and `addOnGrantReady` (AiCreditGrant lot, `aiCreditCutoverAt`), and `chat` to `BillingAddOnCredits`; the admin service already accepts `productKind: 'CHAT_CREDIT'` and refuses it through `addOnGrantReady`.
- PR C's migration timestamp must follow `20260929150000`.

Commits: `a5e197ba` = the seam alone on develop `3a863b70` (PR C / SD-F base); the next commit on the branch is the rest of PR B.

Verification (2026-09-29, worktree above; machine rule from 14:1x: no JS API typecheck, no full suites, heavy lock only for PG):
- contracts: build 0, typecheck 0, package tests 339/339, `ci.yml` contracts line 26/26.
- api: native TypeScript 7 typecheck (coordinator's serialized script) rc=0, web rc=0; `test:boot` 0 ("Nest resolved every provider"); `check-di-metadata` ok; spec-suite-coverage 3/3; body-validation-coverage 4/4; destructive-SQL guard on the migration: pass.
- new specs: `billing-receipt-allocator.spec.ts` 6/6, `billing-addon-admin-grants.spec.ts` 6/6, `receipt-addon-ledger.pg.spec.ts` 7/7.
- touched specs: expense-extraction 55/55, capture runner 33/33, ai-gateway client 39/39, company-ai-usage-meter 155 pass/2 skipped, billing-financial 4/4, line-ai-combined-regression 9/9, partner-support-tools 44/44, process-line-webhook full file 383/383; W00 regenerated, manifest spec 4/4; web error specs 62/62.
- PG on throwaway postgres:16 `mangmee-addons-prb-pg-20260929` (port 15542, fresh `migrate deploy` per DB, removed after each run): product-foundation 4/4, recipient-capture 3/3, admin-tools 3/3, billing-receipts 14/14, grace 15/15, trial-carryover 5/5, caps 10/10, issues 9/9, advance-deal 3/3, purchase-source 2/2, settings + issue-resolution 7/7, expense-capture-read 5/5, receipt-reliability 6/6, onboarding-receipt-allowance 1/1 (after `prisma/sync-permissions.ts`, as Extended Tests does). The seven Extended billing PG files in ONE tsx invocation on the loaded machine hit "Unable to start a transaction in the given time" (billing-issues too, which never touches receipts); one file at a time all pass.
- pins `--check`: current. `git diff --check`: clean.
- Not run, per the coordinator's machine rule: `node scripts/run-line-ai-whole-chain-acceptance.mjs`, full API and web suites (run once on the integrated branch).

Next: controller review → push → PR to develop → twin to main (`ci.yml` changed). PR C and SD-F build on the seam above.

PR A next (done): controller reviews the branch → push → PR to develop → twin to main (`ci.yml` changed). Then Extended Tests if wanted, and release through UAT and Production before any policy with `addOnPriceIds` is published (F-09). PR B and PR C can start from develop after merge.
