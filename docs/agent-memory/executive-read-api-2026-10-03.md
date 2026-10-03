# Agent Memory: executive report — read API (stage E3a)

Status: BUILT on branch `claude/executive-read-api-20261003` (from `claude/executive-program-20261002` at `4e2b0d4dd`, stages E1 + E2), waiting for the controller's review. Not pushed, not merged, not deployed.

Owner: implementation lane of 2026-10-03; the controller session reviews, verifies, pushes and merges.

Scope: stage S3 of `docs/plans/mangmee-executive-business-backend-plan-th.md` §2 row 5 without API13 (the Excel export is a later stage): the read endpoints API01–API06 of the backend spec §16.1, reading the numbers only from the summary tables E2 built. Backend and contracts only: no web, no worker, no migration.

Decisions:

- One service (`ExecutiveReportReadService`) loads one month of the latest build in one REPEATABLE READ snapshot (build row, month header, company-month rows, every profile, sellers, provinces) and computes every card, group row, list, ranking and comparison of a request from those rows with the same predicates (`executive-read.logic.ts`). The list's count equals each card's count by construction. ponytail: in memory, about a thousand companies; move filters and order into SQL at tens of thousands.
- Live reads are only what the summary tables do not hold by design: company names, the "other" text of the original signup, sellers' display names and sales codes, the owner's e-mail and phone (only with `system.executive.contact.read`), the business type label, and the company history.
- Population of a month = its company-month rows labelled CUSTOMER (the label as of the round that last built the month). The detail and the history use the current profile label: test, internal, unclassified or unknown company answers 404 `COMPANY_NOT_FOUND` alike.
- `drilldownFilters` is the complete API03 query (besides month and buildId): the request's own report filters plus the item's. Compare sides carry only the side's filter, because the comparison takes no report filter.
- One rule for every count and money figure: partial → `value: null` with `knownValue`; unavailable → neither. Money is complete when successful balance scans cover the month from its first instant to its effective end; untied money adds UNMATCHED_MONEY; a month that ended before the first billing account of the running mode is unavailable (HISTORY_BEFORE_COLLECTION), never 0. Usage is partial for a month that began before the first build (HISTORY_BEFORE_FIRST_BUILD) or before the first question to the assistant was kept (HISTORY_BEFORE_COLLECTION). The companies card is partial while any company is unclassified (CLASSIFICATION_INCOMPLETE); averages, shares and differences built on a partial figure are null.
- No build yet, or a month the data set does not hold yet (the first hour of a month): 503 `SOURCE_UNAVAILABLE`, never zeros. A month after the current Bangkok month or before the first month of the data set: 400. A data set older than two hourly rounds: envelope `reasonCodes: ['SOURCE_STALE']`.
- Customers who pay the most: groups and ties per spec §13.6 on the companies in scope (report filters only); ranks and the cumulative share belong to that scope too, not to the list's own filters or page. No group and no net rank while the month's money is not read whole.
- Paid add-ons read "not on sale" (ADDON_NOT_ON_SALE) until any add-on money appears in the data set: decided from the data, no switch.
- Company history (API06): SIGNED_UP at the company's creation; lifecycle audit rows (`system.partner_company.lifecycle.transition`) by their target status, the term sweep's own `term_expired` disable shown as PACKAGE_EXPIRED; purchases from billing's own reader (`BillingCashMovementsService.companyPackagePurchases`, new): paid package invoices of the running mode at the moment they were applied, RENEWAL/RETURN as PACKAGE_RENEWED (the Q22 grouping) and every other kind as PACKAGE_PURCHASED, with `billingPlanLabel`. No actor, reason or phone.
- Errors reuse E1's filter: every 403 is `EXECUTIVE_ACCESS_DENIED` (words about reading the report on these routes), 400 `EXECUTIVE_QUERY_INVALID` with the field, 404 `COMPANY_NOT_FOUND`, 503 `SOURCE_UNAVAILABLE` (its words made true for both pages). Every route: `system.executive.read` + `assertPlatformTenant` + `Cache-Control: no-store`; the target is `:targetCompanyId`.
- Audit: `executive.report.read` (API02–04: report key, month, build id, constant filter values, row count, `hasSearch`) and `executive.company.read` (API05–06: month, `contactsReturned`), no `companyId`, no search text, no person's data.
- Contracts (`packages/contracts/src/executive-business.ts`): the values and Thai words of every filter, the sort options, the purchase grouping, the history event words, and the payload types of API01–API06. Owner-open answers are one-place changes there: the `email-otp` rail's words (`EXECUTIVE_REPORT_LABELS.signupRail`), the purchase grouping (`EXECUTIVE_PURCHASE_GROUPS`); the payment kind of a paid-ahead change and of a deal that replaced a card subscription stays in billing's `billingPurchaseKind`; the industry groups stay in `report-labels.ts`.

Open questions:

- Owner (unchanged from E2): the kind of a paid-ahead change to a cheaper tier or another interval, and of a sales deal that replaced a live card subscription (UNKNOWN today); the industry-group content (version 1, proposed); the on-screen words of the `email-otp` rail (proposal "สมัครด้วยรหัสอีเมล").
- Spec gaps decided here, for the owner or the spec to confirm: the history's purchase events and their moment (an invoice whose package was never applied shows no purchase), whether an admin's manual renewal is a history event (not today: only billing evidence), and that a "no package" sweep disable shows as "ปิดใช้งาน".
- Additions beyond spec §16.2, each small: `population.unclassifiedNetReceiptsSatang` (without it the month cannot reconcile with the provider while companies are unlabelled), envelope `reasonCodes` (SOURCE_STALE, and why a payment-group list is empty), envelope `coverage.money/usage`, `activeCompanies.breakdown` and `receiptsWithoutPositiveNet` (the explanation lines of spec §13.1), `creditedSellers` on the sales view.
- Not in the payload: the month's count of refunds the scan saw unsuccessful (`ExecutiveReportMonth.unsuccessfulRefundCount`); spec §14.1 has no line for it.
- The paid-usage sub-reasons (`paymentUnknown.byReason`) have no list filter in §12.4, so only their total opens a list.

Artifacts:

- Contracts: `packages/contracts/src/executive-business.ts` (report section)
- Rules: `apps/api/src/modules/executive-business/domain/executive-read.logic.ts`
- Service: `apps/api/src/modules/executive-business/application/executive-report-read.service.ts`
- Routes: `apps/api/src/modules/executive-business/presentation/http/executive-report.controller.ts` (`/v1/system/executive/context|overview|companies|analysis|companies/:targetCompanyId|companies/:targetCompanyId/history`), wired in `executive-business.module.ts` (imports `BillingModule`)
- Billing reader addition: `companyPackagePurchases` in `apps/api/src/modules/billing/application/billing-cash-movements.service.ts`
- Real-PostgreSQL spec: `apps/api/src/modules/executive-business/executive-report-read.pg.spec.ts`, run by `.github/workflows/ci.yml` (job "Migrations and Boot") with `EXECUTIVE_REPORT_READ_TEST_DATABASE_URL`; it builds its own scratch database from the migration files and seeds through the real E2 build
- Guard spec: `apps/api/src/modules/auth/auth.guard.spec.ts` (RB-01 list (a) with API05/API06; the E1 route boundary over all twelve executive routes; the report query DTOs; the 403 words)

Verification (local `postgres:18.3-alpine`, every migration applied; logs and red runs in the lane's notes folder `exec-s3/`):

- `executive-report-read.pg.spec.ts` 20 tests pass (16 on real PostgreSQL over rows written by the real build, 4 rule tables). 28 single-line breaks of the production code (population label, drilldown filters, contact permission, a stand-in owner, untied money, tie counting, rank scope, page-only summary, buildChanged, staleness, the expiry event, a leaked reason, audit company id, audit search text, a test company opening, a future month, `:companyId`, a missing platform check, an unbounded search, pre-build usage, compare share, unapplied invoice, money before billing, groups on unread money, the partial rule, the two detail notes, and the words of the list's yes/no filters) each fail at least one test.
- `auth.guard.spec.ts` 48 pass (RB-01 list (a) with API05/API06; the twelve executive routes; the report query DTOs; the 403 words).
- Neighbours unchanged in behaviour: `billing-cash-movements.pg.spec.ts` 13, `sales-console.pg.spec.ts` 24, `executive-report-build.pg.spec.ts` 23, `injectable-di-token.spec.ts` 3.
- API typecheck, contracts build, web typecheck and the boot smoke pass; final exit codes are in the lane's report.

Next: the controller reviews; then the web stage (E4) builds on the contracts above, and the Excel stage (API13) reads through the same service.
