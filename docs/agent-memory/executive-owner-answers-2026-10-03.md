# Agent Memory: executive owner answers — 2026-10-03

Status: implementation and local checks complete; uncommitted, ready for controller review and real-PostgreSQL/browser verification. No deployment.

Owner: implementation lane; controller reviews and runs database/browser verification.

Scope: apply the six owner answers of 2026-10-03 to purchase classification and the specs/contracts; no billing mutation, schema, dependency, or permission change.

Decisions:

- SCHEDULED_CHANGE is RENEWAL. Sales deals use the paid package history at payment: live → RENEWAL, ended → RETURN, never paid → FIRST_PURCHASE. RETURN still displays in the renewal group under Q22.
- Industry groups v1, the existing email signup label, company-detail AI cost coverage, and ACCOUNTANT's existing lack of expense review/confirm defaults are approved.
- Keep classification inside billing. Both readers share history facts; the executive build already consumes the cash reader's purchase kind.
- Billing quotes preserve prior paid-through dates in subscriptionConversion and quote.purchase.previousPaidThrough (including ADVANCE_DEAL/REPEAT/RESTART). Expired one-time deals can be RESTART without a previousPaidThrough, so read prior applied paid package invoices too. Current account/plan state cannot reconstruct an old payment.
- Deal payment time is PackageChangeRequest.verifiedAt, written from verified billing evidence; the provider charge observation is the fallback for held/unapplied deals. appliedAt and periodStart are not payment times for an advance deal.
- No billing/executive unit spec is listed in apps/api's main test script. Put pure classifier tests in the registered reports/application/report-source-adapters.spec.ts and SQL integration tests in the registered billing/executive PG specs.

Open questions: none for the six supplied decisions. Unrelated open questions remain in the older notes.

Artifacts:

- `apps/api/src/modules/billing/application/billing-cash-movements.service.ts`: one classifier and one shared SQL history fragment for movements and companyPackagePurchases. The executive build needs no production change: it already reads movements and sums each into one moneyByPurchaseKind entry. figuresKey includes those entries, so a subsequent full build can revise old months.
- `apps/api/src/modules/reports/application/report-source-adapters.spec.ts`: 14 pure classification cases in an already registered spec.
- `apps/api/src/modules/billing/billing-cash-movements.pg.spec.ts`: 14 new database cases, plus the existing scheduled-change assertion and pure table updated.
- `apps/api/src/modules/executive-business/executive-report-build.pg.spec.ts`: one new database test with seven company cases; receipt/refund totals equal the sole purchase-kind entry.
- Backend spec §14.1/§15/§16.6 and decision register D09–D14; plain-language spec; permission matrix; contracts comments; the two earlier notes. Runtime labels are reused unchanged.

Verification:

Commands below are from the worktree root. No network, server, Docker, browser, database, commit or package.json edit.

1. `pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/reports/application/report-source-adapters.spec.ts`
   - Test-first old production: exit 1, 47 pass / 9 fail (56 tests). Failures: SCHEDULED_CHANGE; INITIAL conversion live and ended; ADVANCE_DEAL ended; REPEAT ended; RESTART live; exact-end conversion; returning INITIAL deal without conversion marker; missing payment/history evidence.
   - The other five new tests already passed on the old code: ADVANCE_DEAL live, REPEAT live, RESTART ended, never-paid/ordinary initial controls, subscription-cycle/ordinary restart/upgrade controls. They guard unchanged behavior; no red result is claimed for them.
   - One intermediate fix run failed to parse an unclosed SQL template: exit 1, 0 pass / 1 failed file. Corrected the delimiter.
   - Final production: exit 0, 56 pass / 0 fail, including all 14 added cases.
2. `pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/billing/billing-cash-movements.pg.spec.ts`
   - Test-first old production: exit 1, 1 pass / 1 fail. The existing pure table fails on the new scheduled-change expectation.
   - Final production: exit 0, 2 pass / 0 fail (also rerun after the final two database cases and the separate-scan-job fixture correction).
   - The database suite was skipped in every run: BILLING_CASH_MOVEMENTS_TEST_DATABASE_URL is absent. Database red/green is **not checked**, not a passing SQL verification.
   - New database cases use payment-time history in BOTH readers, with a later refund, duplicate charge observation and exact totals: scheduled change; live conversion; ended conversion; live deal without conversion; ended deal without conversion; end-boundary conversion; advance deal; late advance deal; live one-time deal; ended one-time deal; never-paid deal; ordinary first purchase; subscription cycle; ordinary restart.
   - Each deal case first checks company history before a balance scan, then removes verifiedAt and checks the charge-time fallback in both readers. Add-ons, zero payments, unapplied packages, later applications and another billing mode cannot supply prior history.
3. `pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/executive-business/executive-report-build.pg.spec.ts`
   - Old and final production: exit 0, 6 pass / 0 fail; the database suite was skipped because EXECUTIVE_REPORT_BUILD_TEST_DATABASE_URL is absent.
   - Added database test: “builds owner-approved purchase kinds with every receipt and refund in exactly one kind”: scheduled change; live/ended/never-paid deals; ordinary first purchase; subscription cycle; RESTART. Database red/green is **not checked**.
4. `pnpm --filter @watchdog-bms/contracts build`: exit 0 (comments changed; no runtime contract/label change).
5. `/private/tmp/claude-501/-Users-thawatchai-Project-MangmeeYungYuen-mangmeeplus/6fadd91a-5682-4234-a498-2e23f77e8587/scratchpad/codex/heavy.sh pnpm --filter @watchdog-bms/api typecheck`: exit 0, no diagnostics; final rerun after the fixture edits also exit 0.
6. `git diff --check`: exit 0.

Not checked: real database SQL execution, performance and browser behavior (unavailable and prohibited by lane rules). Existing scan/history queries have no new index; measure the shared history joins on real PostgreSQL before acceptance. No live environment was read. Unrelated questions in earlier notes were left intact.

Next: controller reviews the uncommitted diff, runs the two PG files above with their explicit disposable-database URL variables, runs executive-report-read.pg.spec.ts for API06 and the normal full/browser checks. Older stored months pick up the classification on the next full rebuild; no rebuild was run here.
