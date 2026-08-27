# Agent Memory: Sales payment stable retry

Status: IMPLEMENTED / LOCAL PAYMENT ACCEPTANCE PASS — committed and rebased onto develop; ready for PR, CI and merge pending. No deployment or main promotion.
Owner: Codex / phase6_launch_review; parent owns local E2E/browser acceptance and delivery.
Scope: The existing sales-document receive-payment form in `AccountingPages.tsx`; subscription, auto-accounting and reconciliation remain excluded.

## Product and acceptance (before code changes)

Canonical sources: [Income–Expense Ledger spec §7](../specs/mangmee-income-expense-ledger-spec-th.md#7-ความถูกต้องการเงิน-stop-ship-ของ-spec-นี้) and [P27 plan Phase 3](../plans/mangmee-income-expense-ledger-plan-th.md#phase-3--บันทึกรายรับ--ใบลดหนี้เพิ่มหนี้-spec-f-led-1-f-led-6). This is a bug correction to existing receive-payment behavior, not a new financial policy.

Proven defect: `DocumentDetailPanel` preserves a key using form fields but generates a new `paidAt` on every submit. `accountingPaymentPayloadFingerprint` includes exact ISO `paidAt`; therefore a persisted payment whose response is lost receives a different fingerprint on retry and returns `accounting_payment_idempotency_conflict` instead of the prior payment.

Acceptance:

1. One local attempt retains an immutable body and key, including its first generated timestamp, across transport/uncertain failures and a failed follow-up document refresh. Unchanged retry sends identical serialized bytes even after the clock advances.
2. The intent identity includes company, target document, branch, counterparty and all submitted payment values. A deliberate payload/context change creates a new attempt; confirmed success clears only that submitted attempt, not a newer in-flight attempt.
3. Preserve existing cash, WHT, reference, allocation, overpayment, permission and branch behavior. No server fingerprint/validation change and no retry-specific money normalization.
4. Keep the existing state/ref pattern and key generator; one payment-specific helper is sufficient. No generic retry framework or dependency/package changes.
5. Regression tests use the real `createPayment` → authenticated fetch serializer with an intercepted fetch, cover lost response + advanced clock, input edit and success reset. Existing payment/permission logic tests and web typecheck must remain green. These are local tests, not browser/DB evidence.

## Trace and bounded plan

- Key helper callers: `AccountingPages.tsx` and `IncomeExpenseLedgerPage.tsx`. The ledger modal already uses its fixed `paidOn` value and is not changed merely to adopt a helper.
- `DocumentDetailPanel.run()` is shared with issue/approve/reject/void/convert/linked-tax actions. It returns success only after both the action and follow-up document fetch complete; leave it unchanged and retain the attempt when either rejects.
- Add a small accounting-document payment snapshot helper beside the existing API key generator; ref holds the helper result, and the request closure captures that exact result rather than reading a mutable ref later.
- Add regressions to the existing `income-record.logic.spec.ts` suite. The parent owns real desktop/mobile acceptance; no browser/DB/cloud operation in this task.
- Follow-up UI regression authorization: author/list `ACCT-06` in the existing `e2e/accounting.spec.ts` only; parent runs it. Reuse `createDocument`, `pageAs('FINANCE')` and `apiAs('FINANCE')`; create one unique customer and issued invoice, then call the real browser POST via `route.fetch` and drop only its first successful response. Retry from the same form after advancing client time and changing desktop→mobile viewport. API readback must prove one payment ID/count, allocated amount and source paid/outstanding totals. There is no allocation-row listing API, so the test must not claim direct allocation-row cardinality. Cleanup voids only payments belonging to this unique customer and its own invoice, then archives that customer through supported APIs; no gate, permission or shared-data setup mutation.

Decisions:

- Worktree `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-sales-payment-stable-retry`; branch `codex/sales-payment-stable-retry`; base `origin/develop` `d2b40f37948d482c1bdd29c6047551c4258f24a7` (PR #282 capture-first scope).
- Read AGENTS and repository Ponytail full; the old AGENTS skill path is absent. Preserve the primary dirty worktree and completed Partner-copy worktree.

Open questions: None for this bounded correction. Refresh/unmount persistence beyond the current mounted form remains outside this existing in-memory retry contract.

Artifacts:

- `apps/web/src/features/accounting-documents/AccountingPages.tsx`
- `apps/web/src/features/accounting-documents/accounting-documents.api.ts`
- `apps/web/src/features/accounting-documents/income-record.logic.spec.ts`
- `e2e/accounting.spec.ts` — ACCT-06, author/list only until parent executes locally
- Ledger spec §7 and this memory

## Implementation result

- `prepareAccountingDocumentPaymentAttempt` snapshots the complete submitted body, including its first `paidAt` and existing UUID-based key, and freezes both the attempt and its primitive-only body. Matching company/body intent returns the exact same attempt; form edits do not mutate an in-flight payload.
- `DocumentDetailPanel` retains that snapshot in the existing ref and captures it in the request closure. It clears only the matching attempt after `run()` returns success; `run()` itself is unchanged, including its false result after a failed action or failed follow-up document read.
- `IncomeExpenseLedgerPage`, key generation, `createPayment` serialization, backend fingerprint/validation, permissions and all money/WHT/allocation/overpayment rules are unchanged. Removed only a redundant branch spread whose value was already overwritten by the same `detail.branchId`.

Verification (2026-08-27, isolated worktree):

- `corepack pnpm install --frozen-lockfile` — PASS; reused lockfile, no dependency/manifest change.
- `corepack pnpm --filter @watchdog-bms/contracts build` — PASS.
- `corepack pnpm --filter @watchdog-bms/design-tokens build` — PASS; no tracked generated changes.
- `corepack pnpm --filter @watchdog-bms/web exec tsx --test --test-reporter=spec src/features/accounting-documents/income-record.logic.spec.ts src/features/accounting-documents/income-expense-ledger.logic.spec.ts` — **59/59 PASS, 0 skipped**. New regressions exercise the real `createPayment` → `authedApiFetch` serializer with intercepted fetch, lose the first response, advance the clock, assert byte-identical retry body/key, then verify a fresh attempt after confirmed success and changes to amount/WHT/method/reference/company/branch/customer/document. Existing VAT, permission, amount and ledger-modal policy tests remain green. Node emits its expected MockTimers experimental notice; no failed test.
- `corepack pnpm --filter @watchdog-bms/web typecheck` — PASS (`next typegen && tsc --noEmit`).
- `git diff --check` — PASS. New tests are in an existing registered web `src/**/*.spec.ts` suite; no `package.json` changes.
- No DB, cloud, browser, real-device or CI-run evidence is claimed. The initial lost-response proof is an intercepted-client test, not a server persistence test; existing server fingerprint/idempotency checks were inspected without modifying or invoking them.

UI-regression follow-up (author/list only, **NOT RUN against local server**):

- `ACCT-06 @smoke` is in the existing accounting E2E spec. It uses a unique customer + own issued 250.00 invoice, sends 97.00 cash + 3.00 WHT from the legacy form at 1280×900, forwards the actual POST using `route.fetch({ maxRetries: 0 })`, and aborts only its first successful response. It checks real API persistence before retry, moves to 390×844 and a client clock 61 seconds later, then clicks the same form's submit button and verifies identical raw body/key/time and the same payment ID. API totals must remain one payment, allocated cash 97.00, unapplied 0.00, source paid 100.00/outstanding 150.00. Direct allocation-row cardinality is not asserted because no public endpoint exposes it.
- Test finally cleanup uses the unique customer's exact filtered payment IDs only, voids them and its own invoice, checks restored paid/allocated totals, then archives that customer. No fixture root/gate, permission or shared-company data is changed.
- `corepack pnpm exec playwright test e2e/accounting.spec.ts --project=chromium --grep 'ACCT-06' --list` — PASS, 1 test found.
- `corepack pnpm exec playwright test e2e/accounting.spec.ts --project=critical --grep 'ACCT-06' --list` — PASS, 1 test found; already included by `@smoke` without config changes.
- `corepack pnpm exec tsc --noEmit --target ES2022 --module CommonJS --moduleResolution Node --esModuleInterop --strict --skipLibCheck e2e/accounting.spec.ts` — PASS. This is authoring/type evidence only; no browser or server was started.
- The successful-new-attempt and deliberate-input-edit unit regressions remain unchanged in the prior 59/59 passing pair.
- Runtime prerequisites for the parent: existing local API/web serving this change; current seeded `qa.finance` account and business permissions/entitlements; sales root availability OPEN so the ordinary customer+invoice setup APIs can succeed. Use the existing `API_PORT`/`WEB_PORT` or `E2E_API_BASE_URL`/`E2E_WEB_BASE_URL` settings. The test does not open a gate or repair seed/config state.
- Parent run command: `corepack pnpm exec playwright test e2e/accounting.spec.ts --project=chromium --grep 'ACCT-06' --workers=1`. Attachments written by that future run: `lost-response-desktop`, `replayed-payment-mobile`, and `payment-retry-readback` in Playwright's `test-results/.../attachments/`; failure trace follows the existing config. No screenshot exists yet from this authored test.

## Parent integration evidence — 2026-08-27

- Reviewed the helper, real request serializer, component call site, server fingerprint and current permissions/money boundaries. No server or ledger-modal behavior changed.
- Focused real `ACCT-06` first run: **1/1 PASS** against local web3000/API3001.
- Full accounting run exposed pre-existing English selectors in ACCT-01/02 after the Thai UI migration; stopped that run after ACCT-01 failed, corrected selectors to current visible Thai labels, and used the supported document deep link in ACCT-03 so a page-one pagination assumption cannot hide its own fixture.
- Final command: `PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_JSON_OUTPUT_FILE=test-results/accounting-report.json pnpm exec playwright test e2e/accounting.spec.ts --project=chromium --workers=1 --reporter=list,html,json` — **6/6 PASS**. Previous full run after selector corrections also passed 6/6.
- ACCT-06 forwards the real write before intentionally dropping the response. Readback before/after retry is one payment with the same ID, actual money received97 + WHT3, allocated cash97/unapplied0, invoice paid100/outstanding150 of250. Both serialized POST bodies, key and timestamp are identical after advancing the browser clock61 seconds. The final screenshot waits for the earlier transport-error toast to expire; zero unhandled page errors. This is a deliberate negative network test, not a live outage.
- Final fixture: invoice `INV-202608-00065` / `cmtaykk77009rtak102laf3ep`, payment `PAY-202608-00024` / `cmtaykkle00a1tak1m61xfk81`. After the evidence readback, the test's supported cleanup voided only its own payment/invoice and archived its unique customer. ACCT-02/03/04/05 retain their ordinary labeled draft/issue fixtures; no shared record deletion.
- Full web suite: **1127/1127 PASS, 0 skipped** (`pnpm --filter @watchdog-bms/web exec tsx --test --test-reporter=spec 'src/**/*.spec.ts'`). Web typecheck and `git diff --check` passed.
- Real Chrome viewport inspection at1280×900 and390×844: selected an existing local unpaid fixture, entered example97+3 without submitting, checked summary100 against432.10, keyboard focus and no horizontal page overflow. Browser warnings/errors empty. This separate inspection does not claim a manual network-fault injection or change any existing payment.
- Evidence: [screenshots and exact generated API readback](../evidence/sales-payment-stable-retry/README.md). The HTML reporter retains body attachments; list-only reporting does not write them to disk, correcting the earlier author-only expectation above.
- Full P24/physical-device acceptance remains open: legacy payment inputs still use placeholder/ARIA names rather than persistent visible labels. The financial retry fix does not claim to close that existing UX gap.

## Integration-base recheck — 2026-08-27

- Rebased the scoped implementation onto develop `b98e500fa027553222f0dd4af137ac993d35d79c` (merged P24 shared-shell controls). Production and E2E diff versus the pre-rebase implementation is empty.
- Post-rebase full accounting E2E: **6/6 PASS**; full web unit suite: **1127/1127 PASS, 0 skipped**; web typecheck and `git diff --check`: PASS.
- The screenshots/readback above retain their exact pre-rebase fixture identities; the post-rebase run independently repeats the same assertions with new uniquely named fixtures and supported cleanup. No claim that a previous screenshot depicts the later run.
- Generated `next-env.d.ts` returned to the tracked typegen reference after typecheck. The generated local Playwright HTML report is not part of the source change.

Next: Push this bounded correction and open its PR to develop; merge only after the exact-head PR CI passes. No reconciliation, auto-accounting, subscription or main promotion is included.
