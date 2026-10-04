# Agent Memory: expense-withholding-ux-2026-10-04

Status: implemented and locally verified; ready for controller review and database/browser verification; uncommitted.
Owner: expense withholding UX lane; controller commits and runs browser/database checks.
Scope: expense review withholding block, blank/clear interaction, empty catalog guidance, shared 50 ทวิ print wording. No API, schema, catalog activation, AP behavior or PND53 change.
Decisions:
- Keep server/client validation rules. Clearing uses the existing explicit zero input to override saved totals and historical line rates.
- One block after the line list: choice, payee, category, unit/value/base, accepted withholding amount. Phone reading order is DOM order.
- Preserve vendor taxpayer class (a vendor snapshot with no clear-to-null API); clear withholding input/base, category/rate and legacy line rates.
- Distinguish loading, request failure and a successful empty catalog; show the same truthful guidance to read-only users. Existing classified documents must not be described as unconfirmable solely because the current list is empty.
- Use the workspace dictionary as the wording source; AP changes are limited to the two requested print labels.
- New guidance and corrected hints share one Thai source in both workspace locales. Retire the unused old header/tooltip keys.
- Clear category/rate through existing update fields (blank category, zero certificate rate); the money input is explicit zero, with no base. Do not change the API or validators.
- Preview's existing DTO does not accept certificate category/rate. Strip those fields at the existing frontend preview seam, keeping actual `whtInput` and save metadata intact.
- A saved category outside the current catalog gets a Thai recorded-category label. Re-selecting this fallback does not invent a zero rate or replace saved money.
- Browser fixture adds/removes only a synthetic ACTIVE category in the explicitly selected isolated test DB. No seeded category is activated.
Open questions: none for scoped implementation. Catalog activation remains the owner's separate pending decision.
Artifacts:
- `apps/web/src/features/expenses/expense-withholding-ux.spec.ts`: ten regressions covering order/gating, blank values, clearing, rate fill, preview contract, fractional entry, catalog states/read-only, recorded category, Thai hints and print wording scan.
- Production: `ExpensesPages.tsx`, `expenses.model.ts`, `useExpenseReviewTotals.ts`, `ExpenseReviewPage.tsx`, `AccountsPayablePages.tsx` (labels only), workspace dictionary and API-error word mapping.
- Specs: expense input-units, receipt upload, certificate system issuance and correction/replacement (button label only).
- `e2e/receipt-draft-continuity.spec.ts`: update existing 390/1280 journey for choice-before-input, empty catalog explanation, order/overflow, category rate fill, zero/blank and clear/save/reload.
Verification:
- All node web tests use `pnpm --filter @watchdog-bms/web exec node --import tsx --test` (abbreviated W below), never the tsx CLI.
- W `src/features/expenses/expense-withholding-ux.spec.ts`: initial old-code red exit 1, 0 passed / 6 failed. First implementation green exit 0, 8 passed / 0 failed (after the extra two tests below).
- W `--test-name-pattern 'saved category outside|withholding hints' src/features/expenses/expense-withholding-ux.spec.ts`: red exit 1, 0/2, old Thai hint lines temporarily restored and then restored to the fix in `finally`; recorded-category word not yet added. Wrapper exit was 0 but explicitly reported child exit 1. Green in the next full focused run.
- W `--test-name-pattern 'typing zero before' src/features/expenses/expense-withholding-ux.spec.ts`: red exit 1, 0/1 against the initial zero-clears implementation; green full run exit 0, 9/0 after retaining category/base for typed zero.
- W `--test-name-pattern 'withholding hints' src/features/expenses/expense-withholding-ux.spec.ts`: red exit 1, 0/1 against separate English hints; green full run exit 0, 9/0 after sharing Thai guidance.
- W `--test-name-pattern 'choosing no withholding|totals preview omits' src/features/expenses/expense-withholding-ux.spec.ts`: red exit 1, 0/2 against original omit-empty metadata and original preview destructuring. First green attempt exit 1, 9/1 because the test's API DTO path had one too many parent segments; fixed test path, next run exit 0, 10/0.
- W `--test-name-pattern 'saved category outside' src/features/expenses/expense-withholding-ux.spec.ts`: red exit 1, 0/1 against fallback selecting an invented zero rate; guard added, latest full focused run exit 0, 10/0.
- W `src/features/expenses/expense-review-validation.spec.ts src/features/expenses/expenses.model.spec.ts`: exit 0, 131 passed / 0 failed (13 suites).
- Mandatory old-word and moved-selector scans across API, ai-gateway, web specs and e2e: no stale old sentence expectations. Selector matches only the new web regression and updated receipt continuity e2e. `e2e/expenses.spec.ts` has no moved-field selector to update. Production web scan found no reversed 50 ทวิ wording or retired dictionary keys.
- Final locked web typecheck: `/private/tmp/claude-501/-Users-thawatchai-Project-MangmeeYungYuen-mangmeeplus/6fadd91a-5682-4234-a498-2e23f77e8587/scratchpad/codex/heavy.sh pnpm --filter @watchdog-bms/web typecheck`: exit 0, route generation and compiler passed. Earlier locked typecheck also passed before preview/metadata changes.
- Earlier locked whole web suite (before the final preview/metadata fixes): W `"src/**/*.spec.ts"`, exit 0, 2973/0 (573 suites). Both whole-suite runs invoke heavy.sh with an environment dictionary removing every `S3_*` variable.
- Final locked whole web suite: W `"src/**/*.spec.ts"` through the same heavy.sh, all `S3_*` removed, exit 0, 2974 passed / 0 failed / 0 skipped (573 suites).
- Final full original-production proof: read the seven changed production files from `git show HEAD:<path>`, temporarily write those original contents while leaving all ten regression tests, run W `src/features/expenses/expense-withholding-ux.spec.ts`: exit 1, 0 passed / 10 failed. Restore current production bytes in `finally` and assert byte-for-byte equality. Run that exact focused command again: exit 0, 10 passed / 0 failed. No git mutation and no net production change from this verification.
- `git diff --check`: exit 0; repeat after this final memory update before handoff.
- Browser tests (old and new), 390/1280 visual evidence, real database save/preview and read-only browser variant: not checked because browser, server, network and database runs are unavailable/prohibited in this lane. Source checks cover read-only disabled fields and unconditional catalog guidance; they do not establish rendered browser behavior.
- No API, contracts or ai-gateway edits; no corresponding typecheck/build required. No package.json, paid-invoice.ts, billing-schedule.ts, schema or migration edits. No git mutations or deployment.
Next:
- Leave all work uncommitted for the controller; local implementation checks are complete.
- Controller: run `pnpm exec playwright test e2e/receipt-draft-continuity.spec.ts --project=chromium` with `RECEIPT_CONTINUITY_TEST_DATABASE_URL` selecting the isolated DB; tests include both 390/1280 widths. Also run `pnpm exec playwright test e2e/expenses.spec.ts --project=chromium` for surrounding expense flow.
- Controller browser matrix at both widths: default no-withholding, category empty/loading/failure, required payee/category together, category fills percent, explicit base and accepted amount, blank rate/amount, no-withholding clears errors and persists zero, save/reload, mixed historical rates, recorded category no longer listed, read-only notices/disabled fields, no horizontal overflow and eligible ENTERPRISE 50 ทวิ button.
- Controller: full verification and existing real-PostgreSQL specs per lane protocol. Catalog activation remains a separate owner decision.
