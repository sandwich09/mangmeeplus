# Agent Memory: Expense single WHT field

Status: Complete
Owner: Codex
Scope: Web expense receipt review form, validation, tests, and the receipt-upload specification.
Decisions: Preserve the line-level WHT API/storage/accounting contract. Show one WHT control after the item list and apply an entered or cleared rate to every line. New lines inherit the common rate. Preserve mixed historical line rates until the reviewer deliberately enters a replacement.
Open questions: None.
Artifacts: `ExpensesPages.tsx`, `expenses.model.ts`, `expense-review-validation.ts`, their focused tests, workspace dictionary, and `expense-receipt-upload-spec.md`.
Verification: `corepack pnpm --filter @watchdog-bms/web exec tsx --test src/features/expenses/expenses.model.spec.ts src/features/expenses/expense-review-validation.spec.ts` passed 77/77; `corepack pnpm --filter @watchdog-bms/web typecheck` passed; `git diff --check` passed.
Next: Merge the PR to `develop` after CI passes.
