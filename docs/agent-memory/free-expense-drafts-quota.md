# Agent Memory: free-expense-drafts-quota

Status: Implemented and locally verified; parent task owns overall integration/release acceptance.
Owner: Free document quota slice (delegated implementation).
Scope: Existing OCR admission/event tables, four receipt routes, capture worker source scope, LINE capture completion notification, shared quota copy/contracts, additive migration.

Decisions:
- Existing `CompanyOcrUsageEvent` is reused. `quotaSource=FREE_MONTHLY_3` pins source; `succeededAt` distinguishes pending from persisted usable results. No new ledger or budget grant.
- Three shared company/month slots count successful plus pending free admissions under the existing config/month advisory locks; customer used count prints successful reads only. Free allowance is always enforced, including legacy shadow mode.
- Failed reads compensate exact event identity/original month. A replacement attempt and a successful result cannot be refunded by a late release. Stale completion aborts its source transaction.
- Source success can join the owning transaction through `completeCompanyOcrAdmissionWithinTransaction`; standalone completion remains available for recovery/idempotent snapshots. Free capture observations and source apply both use the atomic seam.
- Capture free provenance permits one expense document and prevents auto-split/handoff. Worker rechecks actor, current permissions/branches/company, mutable source state and attachment; source-only apply retains original owner and avoids counterparty creation after upgrade.
- Failed terminal state, exact compensation and the existing outbox event commit together. Outbox service passes the optional owning transaction to its repository and propagates transactional failures.
- Async expense read-status returns the shared `FreeExpenseAllowance` only after the exact source-tagged event succeeded and its frozen checkpoint month matches the current Bangkok month; it never claims the LINE notice marker.
- Third-success notice uses a separate free/month marker. Claim requires three successful results and the current Bangkok month. Failed delivery releases only the notice claim and retries the saved result through outbox; allowance stays consumed.
- Existing paid/trial/gift admissions remain null-source. Free admissions never count against an upgraded monthly base or paid grants. Lifecycle/expired access cannot fall through the legacy shadow allowance.

Open questions: Parent integration and overall acceptance remain outside this slice; no live release or provider/native LINE proof is claimed.

Artifacts:
- `apps/api/prisma/migrations/20261028090000_free_expense_monthly_documents/migration.sql`
- `apps/api/src/modules/line-ai/application/free-expense-quota.ts`
- `apps/api/src/modules/line-ai/application/free-expense-quota.pg.spec.ts`
- Shared admission, runner, notifier, source snapshot projection, receipt copy, billing cadence and focused legacy fixtures.

Verification:
- Focused capture/quota-copy/notifier/extraction/gateway/banking/outbox tests: 222 passed in the final scoped rerun, including the asynchronous read-status projection.
- Dedicated local PostgreSQL quota suite: 5 passed, including all four routes racing the last slot, compensation/replacement/source/month invariants, in-flight upgrade, old-month notice suppression, terminal/refund/outbox rollback/recovery, and first/resumed admission after suspension.
- Default-budget readiness: absent company config inherits the shipped SHARED total of 200,000 satang (฿2,000), with OCR under that total. Three normal mocked receipts with classification plus extraction usage each settled six OCR calls costing 165 satang (฿1.65), zero CHAT usage, zero company budget/grant/override writes. Existing SHARED uses its leased total; it does not create a SPLIT signed envelope. Actual model/provider behavior and live pricing were not tested.
- Prisma client generated; schema pushed only to an isolated disposable local database, never a live environment.
- Default API TypeScript check exhausted its heap; duplicate larger check was stopped while parent ran the authoritative full check. Parent owns final compiler result.
- Scoped `git diff --check` passed. No package manifest edit, commit, push, cloud read/write, live migration, or deploy.

Next: Parent completed source-writer integration, final API/web checks and task memory. Disposable local PostgreSQL was stopped after the final combined 11-test PG run. Browser/native/live acceptance remains recorded as not run in the parent verification artifact.

Port onto current main (2026-10-28):
- Target base `48295b57c6219da8d58fd4eec1e12489ee04d137`; task-only 3-way patch extracted from the old `4a5817b4` baseline. Original checkout remains untouched. The pre-existing draft-edit capability probe and bucket mock edits in the old gateway spec were excluded.
- Preserved current main's ReceiptUnitEntry generation reserve/consume/release and package-only balance projection, add-on notice generations, capture 210-second lease, v3 window evidence/retry policy/category/type projection, attempt-scoped outbox identity, and guarded LINE delivery plans/access fingerprints.
- Free third-result notice is frozen before a guarded delivery plan is saved. Its marker remains with a durable retry plan; failed unplanned delivery releases the marker. Free provenance/current free mode skips payment-evidence linking, confirm previews and automatic handoff.
- Current-main focused verification: 300 passed; after one additional guarded-free-plan regression the notifier suite passed 75/75. Fresh disposable latest-schema PostgreSQL verification: 16 passed (11 existing add-on ledger cases plus 5 free-quota cases). Scoped cached whitespace check passed. Parent owns final aggregate typecheck/browser/release evidence.
- Provider UI fixture is prepared but stopped until the parent requests fresh current-main browser validation. No commit, push, package manifest edit, original-file mutation or cloud action was performed by this slice.
