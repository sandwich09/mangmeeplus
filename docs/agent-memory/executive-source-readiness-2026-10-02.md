# Agent Memory: executive report — source readiness (stage S2)

Status: IN PROGRESS on branch `claude/executive-source-readiness-20261002` (from `claude/executive-program-20261002`). Part B (money facts) and Part C (summary tables and their build) are built and verified locally. Parts A and D follow in this note as they land. Nothing is pushed, merged or deployed.

Owner: implementation lane of 2026-10-02; the controller session reviews, verifies, pushes and merges.

Scope: stage S2 of `docs/plans/mangmee-executive-business-backend-plan-th.md` §2.1 rows 1–11, backend only: the money facts the billing module hands to the report, the summary tables and their build, the company labels, and two verifications. No executive read API (S3), no web (S4), nothing of the data-deletion part.

Decisions:

- Billing reads the scan's own rows; there is no projection table. A finding row (`BillingOperation` type `OBSERVE_PROVIDER_BALANCE`) is never deleted by any code and already holds the provider id, time, amounts, fee, the matched invoice and company and the invoice's tax. A second table would be a copy to keep in step. The reader walks every finding row of the account and mode; if that walk ever shows in the build's duration, the next step is an expression index on the movement id and time, or a projection.
- One reader for everything outside billing: `BillingCashMovementsService` (`apps/api/src/modules/billing/application/billing-cash-movements.service.ts`), exported by `BillingModule`. It takes the account and mode from `AppConfigService` and holds no provider client, so it cannot call the provider.
- A movement is counted once per provider transaction id, by the row read last (`observedAt`, then `createdAt`, then `id`). The latest read wins in both directions: a movement a later scan put back under review stops being the company's.
- `tie` says where a movement is counted: `COMPANY` (a charge or a succeeded refund the scan matched to an invoice and company), `UNTIED` (everything the scan could not match or left for a manual check: `LOCAL_MISSING`, `MANUAL`, `DIFFERENT`, other movement kinds), `EXCLUDED` (a payout, or a refund the scan saw in any state but `succeeded`).
- The daily balance scan rides the existing provider-scan schedule: `BillingSettlementService.scheduleDaily()`, called from the drain the `billing-discovery` worker already runs every 10 seconds. It queues one job per finished Bangkok day, only while the schedule (`CONFIGURE_PROVIDER_SCANS`) is published, valid and enabled, as that schedule's owner. The owner's permission is checked when the job is queued and again on every page (`actor()`). No new worker, no new setting, no environment switch, and `billing-schedule.ts` is not involved (that file is about subscription schedules at the provider).
- The daily job starts where the last scheduled job ended (31 days at most), so a day the worker missed is read by the next job. A failed job keeps its own window for the admin; it does not stop the days after it.
- `purchaseKind` is computed in the reader from the invoice row and the attempt it came from (table below). Two cases the spec table does not prove are `UNKNOWN`.
- Four summary tables, not three: `ExecutiveCompanyMonth`, `ExecutiveCompanyProfile`, `ExecutiveReportBuild`, and `ExecutiveReportMonth` for what belongs to a month and to no company (money not tied to a company, how far the provider was read, the month's revision, the "before the first build" mark). Columns are in spec §12.3.
- One round is one transaction that takes the advisory lock first, stays idle while every source is read as a set through other connections, and writes at the end. A round that cannot take the lock answers `SKIPPED`. A read that fails rolls the transaction back: nothing is written and the build pointer does not move. No failed-round row is kept.
- The worker has one timer, every hour. The API decides the daily round: the first round of a Bangkok day with no `FULL` build of the definition version is `FULL` (every month back to the month the first company was created); the others are `HOURLY` (every profile, the current and the previous month).
- `asOf` is fixed before the round reads; every time-based read is bounded by it, and a month still running ends there.
- When a source began to keep data is read from the data, not from a migration date: `aiUsageSince`, `ocrUsageSince`, `discoverySince`, `billingSince` are the earliest row of each source and are stored on the build row. They can only be later than the true go-live, so the error is on the side of "not assessable", never "never".
- A month's stored answer is final once the month had ended and the provider had been read to its end (or no online payment could exist in it). Only a change after that raises `revision`. Without this every month would be "revised" on its first morning, when the money of its last day arrives.
- A month that is over, for a shop with a paid invoice today and no dated receipt before the month's end: `NO` only if the provider was read from the first billing account to that month's end and no untied receipt lies before it; otherwise `UNKNOWN` with `BILLING_SCAN_NOT_COMPLETE` or `UNMATCHED_MONEY`.
- `referrerKind`: an id with a sales profile is `KNOWN`, an id without one `UNRESOLVED`; no id is `UNKNOWN` when the shop said "sales" or signed up before the question existed, `NONE` otherwise.
- A question to the assistant is one distinct `requestId`; a row with no request id counts as its own request, so a month with such rows never shows active days and zero questions.
- The company label columns and the industry-group mapping landed with Part C, because the build reads them. Part A adds how they are written.

`purchaseKind` evidence (spec §14.1 table; line numbers at commit of Part B):

| Spec row | Kind | Evidence in the code | Contradicts or not covered |
|---|---|---|---|
| First cycle of a subscription, or a one-time purchase with `quote.purchase.kind = INITIAL` | FIRST_PURCHASE | `billing.service.ts` `quote()` L526: INITIAL only when none of advance deal, full-package upgrade, scheduled change, repeat, running one-time term, restart applies. The attempt keeps the quote (`checkout()` L668 `quoteSnapshot`). The invoice points at the attempt: `billing-reconciler.service.ts` `reconcileOneTime` L560, and `applyInvoice` L1326 for the first cycle of a subscription (`paid-invoice.ts` L56 `subscription_create`) | (a) A subscription started again after expiry also has a first cycle; its quote says RESTART, so it is filed RETURN, not FIRST_PURCHASE. (b) NOT COVERED: a sales deal that replaces a live card subscription with a one-time deal (`convertingDeal` L366, `oneTime` forced off at L438) is quoted INITIAL although the shop paid before. The snapshot carries `subscriptionConversion`; filed UNKNOWN. (c) INITIAL is also the first ONLINE purchase of a shop whose earlier package the admin set by hand |
| Subscription invoice with `sourceAttemptId` null, `REPEAT`, `ADVANCE_DEAL` | RENEWAL | Null `sourceAttemptId` is written only by `applyInvoice` L1326, for a later cycle (`subscription_cycle`, and every PromptPay-renew subscription invoice). REPEAT: `quote()` L526 `repeat \|\| oneTime`, written by `billing-repeat.ts` `recordPayment` L462 or `reconcileOneTime` L560. ADVANCE_DEAL: L526, written by `reconcileAdvanceDeal` L735 | A renewal invoice's own `contractSnapshot` can still say INITIAL (it is the contract the subscription started with), so the reader never reads the invoice snapshot. A renewal that also applies a plan change scheduled for the renewal date is still RENEWAL |
| `RESTART` | RETURN | `quote()` L420 `restart` (a subscription whose paid period ended) or `purchaseSource === 'PAID_EXPIRED_CURRENT_MODE'` (`billing-purchase-source.ts` L38) | none found |
| `UPGRADE`, `FULL_PACKAGE_UPGRADE`, `SCHEDULED_CHANGE` | UPGRADE | UPGRADE: `quote()` L533, only when `upgrade` exists, which needs `isUpgrade()` (L460, L481). FULL_PACKAGE_UPGRADE: L456–459 requires `isUpgrade()` | CONTRADICTS: SCHEDULED_CHANGE is `oneTimeChange`, set at L444–451 exactly when the new offer differs and `isUpgrade()` is false (`billing-upgrade.ts` L13: same interval and a higher tier). It is a lower tier, or any tier on the other billing interval, paid now and starting when the current term ends. Filed UNKNOWN until the owner decides (RENEWAL, UPGRADE as written, or a kind of its own) |
| `productKind` `CHAT_CREDIT` or `RECEIPT_IMAGE` | ADD_ON | `BillingInvoice.productKind` (default `PACKAGE`) | No code writes `productKind` on an invoice or an attempt today, so this cannot occur until add-ons are sold. The report must say "not on sale" (`ADDON_NOT_ON_SALE`), not 0 |
| Cannot be filed, or no matched invoice | UNKNOWN | reader: no matched invoice, unknown product kind, neither attempt nor subscription, a quote without `purchase.kind` (none found: the field exists since the first billing commit `97d98a2ea`, 2026-09-14), and the two cases above | — |

Open questions:

- Owner: the `SCHEDULED_CHANGE` row and the deal-conversion case above. Both are UNKNOWN in the code until answered; either answer is a one-line change in `billingPurchaseKind`.
- A refund still pending when the scan read it is never counted as a refund unless a later scan reads the same window again (the scan files it for a manual check, the report follows the spec and leaves it out). The daily job reads each day once, shortly after midnight. Spec §14.1 has no rule for this. The month row keeps their number (`unsuccessfulRefundCount`) so the read stage can say so.
- The hourly round builds two months. A company's older months are written by the daily full round, so a label changed today reaches months older than the previous one within a day, not within the hour.
- `ExecutiveReportBuild` rows are never deleted (about 9,000 a year). Nothing reads old ones except "the first build"; a retention rule is not in the spec.
- Whether the provider-scan schedule is published and enabled in production was not checked (no production read in this stage). The daily balance scan does not start until it is.

Artifacts:

- Reader and coverage: `apps/api/src/modules/billing/application/billing-cash-movements.service.ts`
- Daily job: `scheduleDaily()` in `apps/api/src/modules/billing/application/billing-settlement.service.ts`
- Real-PostgreSQL spec: `apps/api/src/modules/billing/billing-cash-movements.pg.spec.ts`, run by `.github/workflows/ci.yml` (job "Migrations and Boot") with `BILLING_CASH_MOVEMENTS_TEST_DATABASE_URL`
- Migrations: `20261003090000_company_report_labels` (four nullable columns on `Company`), `20261003091000_executive_report_summary` (four tables)
- Build: `apps/api/src/modules/executive-business/` — `executive-report-build.module.ts`, `application/executive-report-build.use-case.ts`, `domain/executive-report.logic.ts`, `presentation/http/executive-internal.controller.ts` (`POST /v1/internal/executive/rebuild`, worker token)
- Worker: `apps/workers/src/modules/executive/executive-rebuild-worker.ts` (hourly), registered in `apps/workers/src/main.ts`; that file is pinned by the production maintenance validator, so the two pins were re-synced with `infra/security/sync-production-maintenance-release-pins.mjs`
- Labels and mapping: `packages/contracts/src/report-labels.ts`
- Real-PostgreSQL spec of the build: `apps/api/src/modules/executive-business/executive-report-build.pg.spec.ts`, run by the same CI job with `EXECUTIVE_REPORT_BUILD_TEST_DATABASE_URL`; it builds its own scratch database from the migration files
- Working notes outside the repository: the lane's scratch folder `exec-s2/NOTES.md`

Verification:

- Part B: `billing-cash-movements.pg.spec.ts` 12 tests pass on a local `postgres:18.3-alpine` with every migration applied. Each behaviour was also run against the production code with that behaviour removed, and failed (dedup, provider time, exclusions, mode scope, safe-integer check, coverage, schedule enabled, catch-up, authority).
- Part C: `executive-report-build.pg.spec.ts` 22 tests pass (16 on real PostgreSQL, 6 rule tables). 32 single-line changes of the production code were each run against it; every one failed at least one test.
- Not run: the extended billing smoke suite (`extended-tests.yml`, real browser and Redis). Read instead: `billing-scan-schedule-smoke.ts` counts only `/v1/events` reads and event-scan rows, so the extra balance job its enabled schedule now queues does not meet any of its assertions; it is left queued for retry there because the fake provider has no `/balance_transactions` route.

Operator steps — the one-time back-read (owner approved 2026-10-02; only after this code is live in production):

1. Tell the owner before opening a production session, and follow `docs/runbooks/uat-production-v2-deployment.md` and `docs/runbooks/cloud-environment-operations.md`.
2. Find the first day of online payment: the earliest live `BillingAccount.createdAt` (`SELECT min("createdAt") FROM "BillingAccount" WHERE livemode`), read-only. Billing code first shipped 2026-09-14, so September 2026 is the earliest possible month.
3. As the System Admin, open `/system/billing/settlements` (or `POST /v1/system/billing/settlements` with an `Idempotency-Key` header of 16–120 characters and `{ windowStart, windowEnd, reason }`). One window is at most 31 days, written as `YYYY-MM-DDTHH:MM:SSZ`, and must end at least one minute in the past.
4. Use Bangkok month windows that touch each other, so every month is covered whole: `2026-08-31T17:00:00Z` to `2026-09-30T17:00:00Z` for September 2026, then `2026-09-30T17:00:00Z` to the last Bangkok midnight (`…T17:00:00Z` of the day before). At most five jobs can be waiting at once; the worker reads 25 movements every 10 seconds.
5. Record for every window: the job id, the window, the final state (`SUCCEEDED`), and the counts seen / matched / different / manual / missing. A window that opened a review case (`SETTLEMENT_REVIEW`) is read again after the case is settled: the report takes the latest read of each movement.
6. Then publish the provider-scan schedule as enabled at `/system/billing/provider-scans`. From that day the system reads the previous day by itself.
7. The report shows a month's money as complete only when successful windows cover the whole month; the build picks the back-read up in its next daily full round.

Next: Part C (summary tables and build), then Part A (company labels), then Part D (two verifications).
