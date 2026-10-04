# Agent Memory: expense-correction-after-confirm-2026-10-04

Status: Scoped implementation and local verification complete; uncommitted for controller review. Owner questions below remain open.
Owner: Expense correction implementation lane; owner decision 2026-10-04. Baseline commit d73293d55 verified in git log before edits.
Scope: Cancel unposted recorded expense payments; reopen confirmed expenses before ledger/certificate/filed-PND53/live-claim boundaries; server correction capabilities; correct outstanding payment guidance; persistent 50 ทวิ and latest PDF download; payee-specific income catalog.
Decisions:
- Reuse NEEDS_REVIEW and payment VOIDED, expense.confirm and expense.payment.record permissions, existing reason DTO, transactional AuditService callbacks and funding/lifecycle locks. Reject LINE mutation authority. Tenant and branch scope rechecked under lock. No package, dependency, switch, schema, migration, paid-invoice.ts or billing-schedule.ts edits.
- Mandatory trimmed reason 3–500 characters; audit actor and reason atomically. Mask long account-like digits in free-text correction reasons with existing banking helper; no bank field copied to audit/notices/export.
- Cancellation keeps the VOIDED history row, subtracts only that payment from paid (preserving legacy paid balances without history), recalculates outstanding/status and latest recorded payment metadata. Same cancellation replay does not mutate/audit again.
- Reopen keeps number and payments, clears confirmation/review stamps, sets not_required and returns to review. Saving recalculates outstanding/status against retained payments. Confirmation rejects paid > corrected payable before finalization/number/outbox, using existing satang tolerance.
- Persisted journals are authoritative. Actual posted journals block correction; dangling posted flags/pointers refuse as unresolved rather than claiming an unseen journal exists. Generated drafts currently require accountant resolution (pending owner decision below). Journal creation rechecks expense status/revision and payment state under the same lock.
- Reopen cancels REQUIRED direct and tax-event handoffs and supersedes ACTIVE WHT events (clears source hash to force refresh). Reconfirmation reuses the retired direct handoff with corrected snapshots and clears the old operator payee address. Issued/external certificates, including tax-workspace event linkage, block reopening. Handoff issuance status/CAS failure rolls the certificate and number commit back inside its transaction. Tax-workspace issuance and external fallback creation recheck active event hashes/current confirmed sources under locks.
- Detail capabilities decide buttons and Thai blockers; known payment retries preserve their immutable intent even when the latest balance is zero. Shared correction words live in contracts, payment words in one model helper, catalog/print words in the existing shared dictionary. New correction modal controls use Thai in either workspace locale.
- Persistent WHT action uses existing permission/feature entitlement and launch-route capability; issued document downloads the latest certificate with its existing number, without issuing a replacement. No withholding means no action. Income list matches ภ.ง.ด.3/ภ.ง.ด.53; changing type clears incompatible selection. Unknown saved categories remain display-only, never an editable catalog option. Mangmee manages the catalog.
Open questions:
- Asked owner asynchronously: should a filed ภ.พ.30 period also block reopening? Brief names only ภ.ง.ด.53. Existing VAT confirmation policy is unchanged; no new VAT reopening rule invented.
- Asked owner asynchronously: resolve a generated draft journal first (current refusal), or cancel it on reopen? No automatic journal cancellation added without that decision.
- Existing signed substitute-receipt material-edit locks remain. Reopening does not cancel signed evidence, so that document's material fields can still require its existing correction workflow.
Artifacts:
- Specs: expense-receipt-upload-spec.md, expense-confirmed-return-for-correction-spec.md (old proposal explicitly historical), expense-ledger-auto-post-spec.md, wht-certificate-system-issuance-spec.md.
- APIs: POST /expenses/:expenseId/reopen, POST /expenses/:expenseId/payments/:paymentId/cancel, GET /companies/:companyId/wht/payment-handoffs/:handoffId/system-certificate; GET expense detail carries correctionCapabilities.
- Existing listed API spec files updated; new web expense-correction.spec.ts; existing CI-listed expense-number.pg.spec.ts adds correction/reconfirmation and posted-pointer cases. The tax-sync comment now reflects the new gated correction edge (no sync logic change). Existing browser expectations updated in e2e/expenses.spec.ts and e2e/receipt-draft-continuity.spec.ts.
Verification:
- Command prefixes: A = pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec; W = pnpm --filter @watchdog-bms/web exec node --import tsx --test. Paths below relative to package.
- Every local behavior regression ran red before its fix, or with original production restored from HEAD for one run and then restored in finally (controller/QA and original confirm guard/handoff write).

| Regression/spec | Old production red (exit 1) | Corrected green |
| --- | --- | --- |
| A src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts: cancel/replace, posted/draft refusal; reopen preserve number/payments; 9 blockers; capabilities; audit rollback/tenant/branch/CAS | 41 tests: 19 pass, 16 fail, 6 database cases skip | Passed in final 216-test API batch |
| Same: retire active WHT events | 77-test payment+external-link run: 69 pass, 2 fail, 6 skip | Passed in final API batch |
| Same: stale posting pointer words | 41 tests: 34 pass, 1 fail, 6 skip | Passed in final API batch |
| Same: external certificate linked through tax events | 74-test payment+atomic-confirm run: 66 pass, 2 fail, 6 skip | Passed in final API batch |
| A src/modules/expenses/application/use-cases/record-expense-payment.use-case.spec.ts: correction permission/web/branch/reason/transaction audit | 9 tests: 8 pass, 1 fail | Passed in final API batch |
| Same: mask account-like free text in reason; A src/modules/expenses/infrastructure/prisma-expense.repository.atomic-confirm.spec.ts: reject retained overpayment; rebuild retired handoff | 42 tests: 39 pass, 3 fail | Passed in final API batch |
| Same atomic-confirm: clear former payee address | 74 tests: 66 pass, 2 fail, 6 skip (with event-linked blocker above) | Passed in final API batch |
| A src/modules/expenses/domain/logic/expense-status.logic.spec.ts: only correction review edge | 53 tests: 52 pass, 1 fail | Passed in final API batch |
| A src/modules/ledger/application/use-cases/expense-payment-posting.use-case.spec.ts: stale expense/payment/revision; A src/modules/tax/application/use-cases/issue-wht-certificate-from-handoff.use-case.spec.ts: source/handoff race and download | 23 tests: 18 pass, 5 fail | Passed in final API batch; an intermediate 3-failure mock-transaction recursion was corrected to model a distinct Prisma transaction client |
| Same issue-from-handoff: truthful refusal when no system certificate can be downloaded | 10 tests: 9 pass, 1 fail | Passed in final API batch |
| A src/modules/tax/application/use-cases/wht-certificate-handoff.use-case.spec.ts: refuse external link after reopen | 77-test payment+handoff run: 69 pass, 2 fail, 6 skip | Passed in final API batch |
| A src/modules/tax/application/use-cases/create-wht-certificate.use-case.spec.ts: refuse reopened/superseded sources, OPEN and CLOSED fallback routes | Each red run 9 tests: 8 pass, 1 fail | Passed in final API batch |
| A src/modules/tax/presentation/http/tax.controller.spec.ts: read/issue/correct download/list authority and separate issue permission | 11 tests: 10 pass, 1 fail | Passed in final API batch |
| A src/modules/expenses/application/use-cases/expense-draft-amount-validation.use-case.spec.ts: save retains paid and recalculates balance/status | 27 tests: 26 pass, 1 fail | 27 pass, exit 0 |
| W src/features/expenses/expense-correction.spec.ts; W src/features/expenses/expense-withholding-ux.spec.ts: satang prefill/labels/validation, lock remedies, persistent/no-WHT action, category form/clear and true empty guidance | 14 tests: 9 pass, 5 fail | Passed in final 53-test web batch |
| Same correction: structured blockers, source-change and missing-download words | Each red 4 tests: 3 pass, 1 fail | Passed in final web batch |
| Same two web files: editable list excludes unknown category; source-change words | 15 tests: 13 pass, 2 fail | Passed in final web batch |
| Same correction: immutable retry despite zero balance | 5 tests: 4 pass, 1 fail | Passed in final web batch |
| Same correction: new modal Thai controls in either locale | 5 tests: 4 pass, 1 fail | Passed in final web batch |
| W src/features/expenses/ExpenseReviewPage.qa.spec.ts: persistent predicate, issuance reload, required/issued handoff reread | 21 tests: 18 pass, 3 fail | Passed in final web batch |
| New PostgreSQL correction tests and changed browser tests | Not checked: database/browser forbidden in lane | Not checked: controller must run against old/new production |

- Final nine-file API batch (payment repo, atomic confirm, payment use case, status, payment posting, create certificate, issue from handoff, handoff, tax controller): exit 0; 216 tests, 210 pass, 6 database cases skip. A plus all nine spec paths in the table.
- New paid-balance save spec separately: exit 0; 27/27 pass. Existing update regressions (A src/modules/expenses/application/use-cases/expense-draft-concurrency.use-case.spec.ts src/modules/expenses/application/use-cases/expense-draft-vat-decouple.use-case.spec.ts src/modules/expenses/application/use-cases/expense-vendor-address.use-case.spec.ts): exit 0; 46/46 pass.
- Final focused web (W src/features/expenses/expense-correction.spec.ts src/features/expenses/expense-withholding-ux.spec.ts src/features/expenses/ExpenseReviewPage.qa.spec.ts src/common/api/api-error-coverage.spec.ts): exit 0; 53/53 pass, repeated after removing the unused page date import.
- pnpm --filter @watchdog-bms/contracts build: exit 0.
- Required heavy wrapper: /private/tmp/claude-501/-Users-thawatchai-Project-MangmeeYungYuen-mangmeeplus/6fadd91a-5682-4234-a498-2e23f77e8587/scratchpad/codex/heavy.sh.
- Wrapper pnpm --filter @watchdog-bms/api typecheck: final exit 0. Intermediate exit 2 (generic callback inferred unknown row) fixed by removing needless generic.
- Wrapper pnpm --filter @watchdog-bms/web typecheck: final exit 0, including the last Thai-modal edit; Next route type generation and tsc passed.
- Wrapper pnpm --filter @watchdog-bms/web exec node --import tsx --test "src/**/*.spec.ts", removing all S3_* environment variables via os.execve: final exit 0; 2,980/2,980 pass, 0 skip. First run exit 1 (2,978/2,979 pass), missing generic API correction-code fallback coverage; shared fallback fixed.
- A src/modules/expenses/infrastructure/expense-number.pg.spec.ts without opt-in: exit 0; entire suite skipped, 0 tests executed. Actual PostgreSQL transactions are not checked.
- All changed API specs confirmed in apps/api/package.json test list; expense-number.pg.spec.ts confirmed in CI. Old changed sentences/labels scanned across API, ai-gateway, web and e2e specs: rg exit 1, no stale literal expectations. Protected-file diff scan: none. git diff --check: exit 0 (will repeat after this note).
Next:
- Controller review/commit/full API suite and real PostgreSQL: EXPENSE_NUMBER_PG_TEST=1 A src/modules/expenses/infrastructure/expense-number.pg.spec.ts, plus payment spec with DATABASE_URL. No database/network/docker/browser/server work attempted here.
- Browser: pnpm exec playwright test e2e/expenses.spec.ts --project=chromium -g "EXP-27|EXP-28|EXP-29"; pnpm exec playwright test e2e/receipt-draft-continuity.spec.ts --project=chromium -g "readable LINE receipt".
- Add/run owner journeys at desktop/mobile: 2409.70/2409.71 confirms with 0.01 prefilled and named; cancel unposted with reason then correct payment; reopen, edit totals, review/reconfirm same number; posted journal/certificate/filed PND53/live claim each blocks with true remedy; issued WHT persists after reload and downloads latest PDF; no-WHT has no action; individual/juristic catalog filtering and clearing; empty catalog directs to Mangmee. Check permission/loading/error and lost-response states.
- Resolve the two owner questions and existing signed substitute-evidence boundary before claiming those extra cases delivered.
