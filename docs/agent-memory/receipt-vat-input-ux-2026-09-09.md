# Agent Memory: Receipt VAT input and warning UX

Status: implemented and locally verified on `codex/receipt-vat-input-ux-20260909`; not merged or deployed.
Owner: Codex.
Scope: document/line VAT source unit changes, global number-input spinners, VAT spacing, operator tax preview, warning navigation.

## Decisions and plan

- An explicit change of VAT source unit starts new source fields empty. Do not reuse source amounts/rates or infer document evidence from calculated line rates. Changing document mode also removes old per-line sources; changing one line leaves other lines intact. Existing accounting line rates remain unchanged until explicitly edited.
- Test NONE, RATE, AMOUNT, BOTH and per-line transitions through the same payload used for preview/save. Required values must be visible; NONE uses system calculation without demanding hidden source fields. API source validation remains authoritative; no schema/migration or tax-rule changes.
- Make the VAT unit label a block so existing vertical spacing applies. Keep the established form layout and themed dropdown.
- Hide number spinners with global CSS, preserving number semantics, decimal steps and keyboard entry.
- For expense entry, omit the duplicate technical per-line tax/account/report summary; document VAT and totals cards already show the amounts used for the receipt. Preserve tax setup warnings/errors and validation. This avoids presenting the unadjusted fuel line base 2,252.07 as the document base 2,252.06.
- Render the validation navigation as a yellow warning with readable text and a focusable link to the invalid input. Preserve real validation and draft behavior.

## Verification

- Web model/validation/page QA/tax model: 143 passed, 0 failed. Command: `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test apps/web/src/features/expenses/expenses.model.spec.ts apps/web/src/features/expenses/expense-review-validation.spec.ts apps/web/src/features/expenses/ExpensesPages.qa.spec.ts apps/web/src/features/expenses/ExpenseReviewPage.qa.spec.ts apps/web/src/features/tax/transaction-tax.model.spec.ts`. Log `/tmp/receipt-vat-ux-tests.log`.
- API draft amount/preview suite: 26 passed, 0 failed. Command: `pnpm exec tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/modules/expenses/application/use-cases/expense-draft-amount-validation.use-case.spec.ts`. Log `/tmp/receipt-vat-ux-api.log`.
- Web TypeScript and `git diff --check` passed. Initial command without web tsconfig could not resolve `@/`; corrected invocation above. Initial typecheck caught a missing shared helper import; corrected before browser verification.
- Actual React form + freshly compiled global stylesheet + real API use case/DTO validation, isolated in-memory repository: `/tmp/receipt-precision-browser/vat-ux.cjs` passed 390/1280px, OS dark preference (app remains its existing light theme), header/per-line unit switches, exact preview/save payload, persisted snapshot readback and Next to step 2. No original UAT receipt was mutated. Re-selecting the same unit preserves evidence; changing one line does not create required values on other lines.
- Number inputs retain `appearance: textfield`, numeric semantics and original min/max/step; global CSS imported once by root layout covers all web routes. Chromium screenshots checked visually; Firefox uses standard appearance plus `-moz-appearance`, Safari/WebKit uses the native spin-button selectors. Firefox/Safari engines were not separately run.
- Warning yellow/background and text colors checked in rendered CSS, link focuses actual invalid amount/rate (including per-line). Dropdown-to-field spacing is at least 10px. Screenshots `/tmp/receipt-precision-browser/vat-warning-390.png` and `vat-warning-1280.png`.
- `/tmp/receipt-precision-browser/tax-copy.cjs` proves the real tax selector still resolves tax and displays configuration errors while omitting duplicate technical line amounts/account/report counts only for expense records. No tax calculation, backend permission, DTO contract, DB schema or migration change.
- Browser checks found the old per-line value handler reintroduced the hidden automatic-rounding row as a source entry; it now excludes that row consistently with the unit switch helper.

Release: previous UAT 34271465242 passed. Previous READY 34273932168 failed at RDS clone connectivity/cleanup; do not retry or start a new automatic READY until the failure and cleanup boundary are resolved. Production remains held. No new release dispatched.
Next: reviewed integration/exact-head CI when continuing the release; retain failed READY evidence in `/tmp/mangmee-receipt-precision-uat-20260909` and resolve its first failing boundary before another deployment/readiness attempt. This change set has not been merged or pushed to UAT.
