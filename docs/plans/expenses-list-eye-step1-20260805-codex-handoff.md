# Expenses list — eye icon opens step 1 + drop เดือนนี้ reset — Codex CLI Handoff

Status: Implement-ready 2026-08-05. Owner request, two small behavior changes on the expenses list/review flow. Executor: Codex CLI; never commit, never `git add`/`checkout`/`restore`/`stash`, never start servers.

## Change 1 — opening an expense always starts on step 1 (ตรวจข้อมูล)

Today `initialExpenseReviewStep` (`apps/web/src/features/expenses/expenses.model.ts:621-624`) jumps to the first ⚠ attention step, and READY_FOR_CONFIRMATION opens on the final review step. The owner wants the guided review to ALWAYS open on step 1 so the user walks forward with ถัดไป themselves (entry point: the 👁 "ดูรายละเอียด" button on the list, which routes to the review page — the review page computes the step).

- Change the function body to `return 'data';`. KEEP the exported signature `(steps, status?)` exactly as-is (single call site passes both args; the seam stays documented). Rewrite the docstring to state the new rule: guided review always opens on step 1; the stepper chips remain freely clickable so users can still jump manually.
- Update the `initialExpenseReviewStep` test expectations in `apps/web/src/features/expenses/expense-review-steps.logic.spec.ts` to the new behavior (every case now expects `'data'`). Do not delete test cases — repoint their expectations and rename their descriptions truthfully.
- Touch nothing else in `ExpenseReviewPage.tsx` — the effect at `:118-122` stays as-is.

## Change 2 — remove the "เดือนนี้" reset chip

`apps/web/src/features/expenses/ExpensesPages.tsx` — in the list-page period toolbar (the reset button currently renders `วันนี้` in day mode and `เดือนนี้` in month mode, line ~1224 inside the period strip). Make it render **only in day mode**: `{gran === 'day' && <button …>วันนี้…}` — i.e. the month-mode เดือนนี้ chip disappears, the day-mode วันนี้ chip stays exactly as it is. No dictionary changes.

## Files (exactly these 3)

- `apps/web/src/features/expenses/expenses.model.ts`
- `apps/web/src/features/expenses/expense-review-steps.logic.spec.ts`
- `apps/web/src/features/expenses/ExpensesPages.tsx`

## Verify (Codex runs ONLY these)

```
corepack pnpm --filter @watchdog-bms/web typecheck
cd apps/web && corepack pnpm exec tsx --test src/features/expenses/expense-review-steps.logic.spec.ts
```

Report: new function body + docstring, list of spec cases updated, and the toolbar JSX line after the chip change.
