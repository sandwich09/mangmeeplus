# Agent Memory: receipt add-row scrolling

Status: scrolling implemented/verified; owner now approved precision/live totals implementation, combined merge and UAT deployment on 2026-09-09. Production held.
Owner: Codex
Scope: existing receipt form: add-row scrolling, server-owned precision adjustment and same-calculator live totals. FE/API/shared contracts; no schema/dependency/config change.
Decisions:
- After a successful local insertion, scroll once to the new row heading and focus that heading without opening the mobile keyboard. Keep existing product-before-charge ordering, field values, VAT source line numbering, validation and theme.
- Respect reduced motion. Do not scroll on initial load, field edits, deletion, save or refresh.
- Owner approved the combined implementation, merge and UAT deployment. Production held. Earlier discussion-only and merge holds are superseded.
- System provenance identifies hidden precision; printed rounding remains visible. Preview is read-only and never adds a Next/save blocker. Monetary discrepancies remain draft-saveable with existing explicit final review/acknowledgement.
Open questions: none within approved scope.
Artifacts: `ExpensesPages.tsx`; existing focused regression suites.
Verification:
- Web TypeScript check `pnpm exec tsc --noEmit -p apps/web/tsconfig.json` PASS.
- Focused QA/model/validation suites `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test apps/web/src/features/expenses/ExpensesPages.qa.spec.ts apps/web/src/features/expenses/ExpenseReviewPage.qa.spec.ts apps/web/src/features/expenses/expense-review-validation.spec.ts apps/web/src/features/expenses/expenses.model.spec.ts`: 131 PASS, 0 fail/skip. Initial invocation omitted the web tsconfig and could not resolve `@/`; corrected the invocation, no source workaround.
- Browser: actual ExpenseReviewEditSection rendered in React.StrictMode with production CSS and synthetic fixture; navigation/read APIs/icons stubbed, no backend mutation. Four cases PASS: widths390/1280 × reduced motion on/off. Verified inserted products precede charges, repeated additions, keyboard activation, heading focus/visibility beyond fixed chrome, and no added scrolling on initial load, input edits or deletion.
- Browser harness and screenshots: `/tmp/receipt-add-scroll-browser/`; result `results.json`. Focused log `/tmp/receipt-add-scroll-tests.log`; typecheck log `/tmp/receipt-add-scroll-typecheck.log`.
- Initial scroll-only diff was 15 inserted / 2 replaced lines in existing form; `git diff --check` PASS. At that stage no API/DB/AI changes. The approved combined implementation now includes API calculation/FE preview; no schema, package manifest or dependency changes.
Next: implement [approved precision spec](../specs/receipt-precision-review-spec.md), test combined change, exact PR CI, merge and canonical UAT with signed/runtime/customer acceptance. Earlier merge/rounding hold is superseded by owner approval. No new release dispatched yet.

## Discussion findings (no behavior changes)

- Current form validates a computed-vs-OCR difference greater than 0.01 as a warning; other malformed/missing data may independently block Next. The visible money card currently renders persisted `detail` totals, explaining why unsaved input changes do not immediately update that card.
- Current API confirmation uses OCR grand-total mismatch tolerance0.05 and requires expense.review acknowledgement with reason bound to the accepted amount above tolerance. VAT reconciliation has its own confirmation blocker/explicit source-acceptance mechanism.
- Fuel1-satang automatic settlement adjustment is existing OCR apply behavior: fractional quantity, printed price, no printed charge suggestion, bounded difference<=0.02. It is currently exposed as a ROUNDING input. Owner agreed this should be system-managed but then explicitly paused all rounding changes for discussion.
- Avoid broad automatic balancing that hides incorrect OCR, missing lines, taxes or real service charges. Printed rounding and computed precision adjustments have different provenance.

## Combined implementation evidence

- API read-only totals-preview shares permission, branch, source/VAT/WHT validation and Decimal calculation with draft save. Server-owned adjustment normalized from original receipt evidence; stale row removed on substantive edits. Raw VAT source validated before remapping; preview exits before writes/audit/review marking.
- UI hides only evidenced computed rounding from inputs/VAT summaries, folds its satang residual into displayed goods subtotal; printed rounding is distinct. Live preview debounce/cancellation/retry prevents stale totals. Add-row scrolling respects reduced motion.
- Focused web suites: 131 PASS. Expanded API draft/review-fields/OCR/VAT/totals/status + preview suites: 275 PASS. New boundary cases for malformed VAT source/remapping pass.
- API TypeScript initially exceeded default 4GB Node heap; rerun with 8GB (same code/check) PASS. Web TypeScript PASS.
- Read-only UAT preflight PASS (2026-09-09). No queued/running UAT/READY/Production release at precheck; previous READY34259459766 verified signed PASS, old candidate superseded.
- Release IDs: UAT not dispatched; READY not dispatched; Production held/not dispatched.

- Integrated browser PASS at390/1280: actual full React review form + actual API calculator with in-memory repository; fuel2409.70, edited price2459.52, service2559.52, draft save/readback, error/retry without disabling Next, stale response ignored. `/tmp/receipt-precision-browser/results.json`, screenshots `money-390.png`/`money-1280.png`. Harness was corrected to advance revisions like the real repository; no product workaround. PostgreSQL CI and live UAT acceptance remain pending.
