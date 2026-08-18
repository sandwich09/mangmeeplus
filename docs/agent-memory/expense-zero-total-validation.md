# Agent Memory: Expense zero-total validation

Status: Complete
Owner: Codex
Scope: Web expense review validation, messages, focused tests, and receipt-upload specification.
Decisions: Treat a computed bill total of zero as a blocking data-step error. Keep zero-priced free lines valid when the document total is positive. Preserve zero as valid for discount, VAT, and WHT fields. The API confirmation guard remains the final defense.
Open questions: None.
Artifacts: `expense-review-validation.ts`, its focused spec, workspace dictionary, and `expense-receipt-upload-spec.md`.
Verification: `corepack pnpm --filter @watchdog-bms/web exec tsx --test src/features/expenses/expense-review-validation.spec.ts` passed 27/27; `corepack pnpm --filter @watchdog-bms/web typecheck` passed; `git diff --check` passed.
Next: Merge the PR to `develop` after CI passes.
