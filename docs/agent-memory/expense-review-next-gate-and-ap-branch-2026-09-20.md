# Agent Memory: expense review next-gate + AP transaction branch 2026-09-20

Status: done — both fixes implemented and proven on `codex/expense-next-gate-ap-branch-20260920` (branched from `codex/e2e-harness-drift-20260920`); not pushed
Owner: controller reviews/pushes/opens the PR; Opus 5 implemented in worktree `/private/tmp/mangmee-product-fixes-20260920`
Scope: `ExpenseReviewPage.tsx`, `expenses.model.ts`, `AccountsPayablePages.tsx`, `TransactionBranchField.tsx`, 2 specs + 1 unit spec. No `package.json`, no new dependency.

Decisions:
- Fix 1 root cause: `ExpenseReviewPage.tsx:926` disabled ถัดไป on `dataErrorCount !== 0`, while `:832` printed a reason only for `dataErrorCount > 0`. The count starts `null` (`:112`) and is only ever set from `ExpensesPages.tsx:1107`, a `useEffect` — one commit after the render that changed `values`. So `null` ("not reported yet") greyed the primary action out with nothing to read, and between an edit and its report the printed reason was the previous render's `firstBlockingMessage` — which is how a line whose category had just been chosen stayed named as missing (`ExpensesPages.tsx:1030` `sourceCategoryIncompleteIndexes`). New pure `expenseDataStepBlocker` is now the single value behind the disable, the text, the `title` and the `aria-describedby`, exactly as `expenseEvidenceStepBlocker` already is for step 2. Client-side `save()` still refuses on its own issue count, so an enabled-but-unknown button cannot skip validation.
- The two red tests were NOT red on that gate on this branch: both failed at `receipt-draft-continuity.spec.ts:163` on step 2's own gate, `expenses.doc_review_required_next`. That gate is correct and already explains itself (the hint beside the review form, pointed at by `aria-describedby`); the spec simply never answered สถานะหลักฐานภาษี or pressed บันทึกการตรวจ, which is the journey `expenses.spec.ts:212` already drives. Spec completed rather than product weakened.
- Fix 2: the vendor-bill form posted `useBranchFilter()`'s branch, blank by design under "ทุกสาขา (รวม)" → 422 `TRANSACTION_BRANCH_REQUIRED` with no control to answer. It now uses `useTransactionCreateBranchId()` + `<TransactionBranchField>` and refuses client-side with `กรุณาเลือกสาขาของรายการ`, mirroring `AccountingPages.tsx:302/326`. `TransactionTaxLineSelector` reads the same branch; the list's `useBranchFilter()` at `:439` is a read filter and stays. `TransactionBranchField` gained an optional `hint`, appended inside the existing described-by paragraph, so AP can say "not the supplier's branch printed on the bill" (`vendorBranchCodeSnapshot` is a different field) without a second element.

Open questions:
- On a 390px phone the step-2 refusal sits beside the review form, not under ถัดไป. Deliberate (`ExpenseReviewPage.tsx` comment), but a disabled button can be on screen while its reason is not. Owner call.
- `EXP-01/02/04/09` stay red on both sides — untouched list-locator/dataset drift, same bucket the harness branch parked.

Artifacts: `apps/web/src/features/expenses/expenses.model.ts` (`expenseDataStepBlocker`), `ExpenseReviewPage.tsx:832/926`, `AccountsPayablePages.tsx` (`CreateVendorBillForm`), `TransactionBranchField.tsx`, `expense-review-steps.logic.spec.ts` (+5 cases), `e2e/receipt-draft-continuity.spec.ts`, `e2e/accounts-payable.spec.ts` (AP-06).

Verification (throwaway stack: pg 15521 / redis 16421 / minio 19121, API 3221, web 3222, `TZ=Asia/Bangkok`, Playwright `webServer`, fresh migrate+seed+gate-sync before every run, `--project=chromium --retries=0 --workers=1`):

| group | BEFORE (this branch, base product code) | AFTER |
|---|---|---|
| `receipt-draft-continuity.spec.ts` (11) | 9 passed / 2 failed (both `…saves blank facts at 390px/1280px` at `:163`) | **11 passed / 0 failed** |
| `expenses` + `accounts-payable` + `feature-entitlement-accessibility` (37) | 32 passed / 5 failed (AP-06 + EXP-01/02/04/09) | **33 passed / 4 failed** (AP-06 green, EXP-01/02/04/09 unchanged, 0 regressions) |

`pnpm --filter @watchdog-bms/web test` rc=0 · `pnpm --filter @watchdog-bms/web lint` rc=0. AP form at 390px captured in the session scratchpad (`product-fixes/shots/`).

Next: controller pushes the branch and opens the PR; no deploy implied.
