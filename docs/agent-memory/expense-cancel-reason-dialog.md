# Agent Memory: expense-cancel-reason-dialog

Status: Complete — implementation and screenshots approved for commit and PR
Owner: Codex
Scope: Expense review page cancellation-reason UX only; no API, contract, permission, or state-transition changes
Decisions:
- Reuse the shared `Modal`, which renders as a bottom sheet on mobile and a centered dialog from `sm` upward.
- Move only “ยกเลิกรายการ” (`rejectExpense`) out of the sticky footer; keep void, delete, and duplicate-resolution flows unchanged.
- Use the approved actions “ยังไม่ยกเลิก” and “ยืนยัน”; confirmation is destructive red and requires a non-empty reason.
- Reset stale reason/error state whenever the cancellation dialog opens; prevent closing it while the mutation is running.
- Show action errors inside the dialog so failures are visible above the overlay.
- Keep the existing `REJECTED` backend state and related “ปฏิเสธ” status/history wording; changing product-state terminology is a separate scope.
Open questions: None
Artifacts:
- `apps/web/src/features/expenses/ExpenseReviewPage.tsx`
- `apps/web/src/common/i18n/workspace-dictionary.ts`
- `e2e/expenses.spec.ts` (`EXP-04A`)
- `/private/tmp/expense-cancel-dialog-desktop.png`
- `/private/tmp/expense-cancel-dialog-mobile.png`
Verification:
- `corepack pnpm --filter @watchdog-bms/web typecheck` — passed
- `corepack pnpm --filter @watchdog-bms/web test` — 950 passed, 0 failed
- focused existing E2E `EXP-04` — 1 passed
- new regression E2E `EXP-04A` — 1 passed; “ยังไม่ยกเลิก” preserved DRAFT, reopen cleared stale reason, “ยืนยัน” produced REJECTED API truth
- Browser at 1280×720 — centered 448px dialog, no horizontal overflow
- Browser at 390×844 — 390px bottom sheet anchored to viewport bottom, no horizontal overflow
- Browser console warnings/errors — none
- `git diff --check` on scoped files — passed
Impact/gaps:
- Permission gates and all three existing entry points still call the same `rejectExpense` mutation; no API/contract/state transition changes.
- Confirm is disabled for a blank reason, closing is blocked while the mutation runs, and API errors remain visible inside the dialog.
- Confirmed-document “ยกเลิกเอกสาร” remains the existing inline flow; it is a separate action from the requested draft cancellation.
- Existing `REJECTED` status/history copy remains “ปฏิเสธ”; intentionally not broadened beyond the approved cancellation-dialog scope.
Next: Merge the scoped PR after CI/review passes.
