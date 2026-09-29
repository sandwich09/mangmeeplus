# Agent Memory: chat-credit-addons-implementation

Status: PR A merged to develop (#878, `3a863b70`). PR C (AI credit cycles, ledger, LINE v2 SHARED funding, holds across months, cap warnings) implemented 2026-09-29 on branch `claude/addons-pr-c-ai-credit-20260929` (worktree `/private/tmp/mangmee-addons-pr-c-20260929`, base develop `3a863b70`); not pushed. Commits: `4d018379` (PR C), merge of PR B's seam `a5e197ba`, `8772832c` (CHAT_CREDIT branch of the seam). PR B (full, `5b43e65a`) built in parallel on `claude/addons-pr-b-image-ledger-20260929`. PR D–G not started.
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

Next: controller reviews the branch → push → PR to develop → twin to main (`ci.yml` changed). Then Extended Tests if wanted, and release through UAT and Production before any policy with `addOnPriceIds` is published (F-09). PR B and PR C can start from develop after merge.

## PR C — AI credit cycles, ledger, v2 SHARED funding (2026-09-29)

Decisions and deviations (also in the plan's PR C note):
- Migration `20260929160000_ai_credit_ledger`: `AiCreditGrant`, `AiCreditEntry`, `CompanyAiConfiguration.aiCreditCutoverAt/aiCreditCutoverSource`; String values with CHECKs; additive only. No company changes behaviour until PR G sets `aiCreditCutoverAt`.
- Hold liveness comes from `AiBudgetReservation.status` (ADR 0013 "no second counter"): a RESERVE entry counts only while its reservation is RESERVED/DISPATCHED/UNRESOLVED. Cancel, sweep and operator release write no entry; settle and charge-at-bound write CONSUME on the held lots (never above the hold). Late evidence after an operator release (CANCELLED → settled-anomaly) consumes nothing: provider loss (spec §15.2). No RELEASE entries are written (kind kept in the CHECK for later).
- Cycle anchor = `billingAnchorDay ?? start day of the continuous run of periods`, not `periodStart.getUTCDate()` (spec §5.1 formula splits a subscription month that starts on a clamped day). Upgrade invoices never start a cycle (only periods starting at/after the covered end count). Admin gift days stretch the running cycle to `paidThrough` with no new allowance (the gift records `aiQuotaAdded: 0`) — open for the Owner if gift days should carry AI credit.
- Funding is evaluated at the turn's admission time and BEFORE `authorizeAndClaim`, so a credit refusal commits without burning the ordinal; the turn's cycle is pinned in `budgetAuthorityJson.fundingContext.cycleKey` (never in the signed grant). Image intake (`line-intake-image/2`) is never funded (C4); audit N-1 still waits for the LINE AI owner.
- Cut-over SHARED companies skip the calendar CHAT cap (cap = TOTAL) on the rendered path; an explicit SPLIT CHAT cap still applies. `readAiBudgetReadiness` reports CHAT = TOTAL for them.
- Credit refusals keep `reason` + `budgetScope: 'CHAT'` and add in-process `aiCredit: EXHAUSTED | INSUFFICIENT | PACKAGE_REQUIRED`; the internal controller drops it (no gateway contract change, no new `AI_BUDGET_REFUSAL_CODES`).
- C5: operator hold list covers every month, 100 per page with `?cursor=<createdAtISO>_<id>`; the read sweeps current, previous and every month with a RESERVED/DISPATCHED row. New code `partner_ai_credit_holds_cursor_invalid` has Thai text. Web sentence now “ค้นทุกเดือนที่ยังมีรายการค้าง”; a next-page control is PR F.
- C6: `readAiCreditSalesReadiness` (TOTAL headroom ≥ held credit + pack; held = remaining, since used credit is already in spend). Cap writers warn (never refuse): `SetPartnerAiModelResult.aiCreditWarning`, `PlatformAiBudgetDto.aiCreditWarningCompanyCount`; read-only under the locks already held.
- C7: PR B's seam `a5e197ba` merged; `8772832c` wires its CHAT_CREDIT branch: `addOnGrantReady` = paid term on the account AND `aiCreditCutoverAt <= now`; `applyAddOnGrant` writes the lot through `applyAiCreditGrant` under the seam's L1 → L4, key `addon:<billingAccountId>:<sourceKey>` (per account like receipt lots, never colliding with `cycle:` lot keys); replay before readiness; a changed payload throws `billing.addon_source_changed`.
- Still to do in PR B's admin service (`billing-addon-admin-grants.service.ts`, not in the seam commit) for CHAT_CREDIT: revoke (`revocableLot` reads `billingReceiptGrant` only → use `AiCreditGrant` + `revokeAiCreditGrant` with `addon-revoke:<operationId>`), `additional()`/`list()`/`lotView` (images only → add the chat balance from `readAiCreditBalance`; contracts `BillingAddOnCredits` gains it). Grant approval already works for CHAT through the seam.

Verification (2026-09-29, HEAD `8772832c`; machine rule 14:20: no JS API typecheck, no full suites):
- contracts: build 0, typecheck 0, package tests 339/339, `ci.yml` contracts line 26/26.
- Native TypeScript 7 typecheck (`api-typecheck.sh`): API rc=0 (on `8772832c`), web rc=0.
- `test:boot`: "Nest resolved every provider"; `check-di-metadata`: all decorated classes carry paramtypes.
- Focused specs: API 440 (435 pass, 0 fail, 5 PG-gated skips) across cycles, reservation, holds use case, partner controller, set-partner-ai-model, set-platform-ai-budget, usage meter, AI usage, support tools, internal budget controller, spec-suite-coverage; web error specs 62/62.
- PG on throwaway postgres:16 `mangmee-addons-prc-pg-20260929` (port 15642, fresh `migrate deploy` of every migration, removed afterwards): run 1 (lock 14:14–14:17) 51/51 = reservation 16, holds 10, funding 10, authority 15; run 2 after the seam (released 14:28) funding 11/11.
- W00 manifest spec 4/4 (no hashed file changed, not regenerated); pins `--check` status=current; `git diff --check` clean.
- Not run, per the coordinator's machine rule: `node scripts/run-line-ai-whole-chain-acceptance.mjs` and the full API/web suites (the coordinator runs them once on the integrated branch).

Residuals for later PRs:
- PR D: v1 lanes (CRM, draft) still use the calendar CHAT cap for cut-over companies; must fund before AI credit is sold (spec §5.3).
- PR E: quote/status call `readAiCreditSalesReadiness` and `readAiCreditBalance` (customer projection = package/additional/total only).
- PR F: web next-page control for holds; render `aiCreditWarning`; customer copy from the internal `aiCredit` cause.
- PR G: set `aiCreditCutoverAt` at the next cycle boundary (D9); `signup-ops-alert.service.ts` still counts CHAT exhaustion from the calendar cap for cut-over shops.
