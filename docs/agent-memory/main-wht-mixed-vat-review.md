# Agent Memory: Main WHT Unit and Mixed-VAT Review

Status: Main review complete on 2026-08-27; main was only partially implemented. Subsequently authorized implementation delivered to develop: code `bef36ab35d77e79e371788b1abf57e3bdf75ddc0`, delivery tip `8cafd8af9510bd8f1a866ab67b39db90df1304f5`, included in parent-fetched develop `be7d58c644e31abd123501e0c06f3be0931076fd`. No live deployment or database migration application.

Owner: Current task / product backlog review.

Scope:

- User requested verification against current main, not implementation.
- Baseline: `007dcba70376acb94aa5b55275840304cabd6f68` (PR #308). `git ls-remote origin refs/heads/main` confirmed the same SHA before and after the checks.
- Reviewed the expense receipt/review journey: WHT baht/percent input, mixed taxable/non-taxable lines, source VAT reconciliation, and persisted tax meaning.
- Working checkout remains on `plan`; existing user changes were not modified. Tests ran against a separate main snapshot at `/tmp/mangmee-main-wht-vat.nbXuKs` with existing installed dependencies.
- No application code, package manifest, database, cloud environment, or deployment changes. This memory is the only repository edit for this review.

Decisions:

1. **WHT baht/percent selector: not implemented in expense review.** `ExpenseReviewEditSection` still renders one numeric rate input (0..1), reads/writes `whtRate`, and applies the entered rate to every line. Its help explicitly says `0.03 = 3%`. The expense line input contract accepts `whtRate`, not a direct WHT amount/input-unit selector. The calculation derives `whtAmount = round2(pre-VAT base * whtRate)`.
2. **Do not confuse VAT source units with WHT units.** The VAT card already offers RATE / AMOUNT / BOTH / NONE and per-line source evidence. These are `vatSource` fields, not a WHT amount-entry implementation. The VAT reconciliation plan explicitly excludes WHT redesign.
3. **Mixed-VAT arithmetic: implemented and covered by passing tests when line rates are specified correctly.** Excluded-price example: 100 at 7% plus 50 at zero VAT yields VAT 7 and gross 157; included-price example: 107 at 7% plus 50 at zero VAT yields the same gross 157. Residual rounding never lands on the zero-VAT line. Over-tolerance source differences and ambiguous rates produce review states rather than silent acceptance.
4. **Exempt versus zero-rated semantics: incomplete at line-capture level.** Both UI presets persist numeric `vatRate = 0`; reload maps that value back to the exempt/no-VAT preset. A separately selected Tax Code can retain the distinction, but the preset itself cannot. The code explicitly records this gap. Tax Code selection is not universally available: ordinary receipts cannot retain one. Therefore arithmetic support is not evidence that all exemption/report semantics are complete.
5. **OCR is not a guarantee of automatic item tax classification.** The OCR apply path assigns the document default rate to ordinary extracted items; special additional-charge lines may carry their own rate. Existing WHT OCR completion can derive a rate from a printed amount, but this does not supply the requested reviewer-facing baht selector or durable explicit WHT input mode.

Open questions:

- No clarification is required for this status report. If implementation is requested, confirm the intended WHT input scope (whole bill versus selected income/service lines) and rules for preserving printed amounts before changing contracts/calculation.

Artifacts:

- [Main WHT control and VAT line presets](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/web/src/features/expenses/ExpensesPages.tsx#L1743): presets at 1765-1773; WHT input at 1813-1839.
- [Main preset persistence and WHT model](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/web/src/features/expenses/expenses.model.ts#L765): `expenseDocumentWhtRate`, `vatRatePreset`, and `vatRatePresetValue`.
- [Main input contract](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/packages/contracts/src/expenses.ts#L600): `lines[].vatRate` and `lines[].whtRate`.
- [Main calculation](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/api/src/modules/expenses/domain/logic/expense-totals.logic.ts#L52).
- [Main mixed-VAT regressions](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/api/src/modules/expenses/domain/logic/expense-totals.logic.spec.ts#L311).
- [Main draft persistence](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts#L283): reconciliation, accepted line/header totals, and transactional line writes.
- Main docs inspected: `docs/specs/expense-vat-source-reconciliation-spec.md`, `docs/plans/expense-vat-source-reconciliation-plan.md`, `docs/agent-memory/expense-vat-source-reconciliation.md`, and `docs/specs/wht-settlement-capture-spec.md`. Historical checklist/PR status is not treated as proof of current implementation or live deployment.
- Opened the user's RPACC exemption article. Cross-checked the distinction between zero-rated VAT (section 80/1) and exemption (section 81) against [the Revenue Department](https://www.rd.go.th/5206.html); this review does not classify individual real-world products or provide a tax filing opinion.

Verification:

- Main source was extracted with `git archive`; no branch switch or source edits were needed.
- Snapshot contracts build: `./apps/api/node_modules/.bin/tsc -p packages/contracts/tsconfig.json` — PASS.
- API: `./apps/api/node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test --test-reporter=spec apps/api/src/modules/expenses/domain/logic/expense-totals.logic.spec.ts apps/api/src/modules/expenses/application/use-cases/expense-draft-vat-decouple.use-case.spec.ts apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.spec.ts apps/api/src/modules/expenses/domain/logic/expense-status.logic.spec.ts apps/api/src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts` — PASS, 197 tests.
- Web: `./apps/api/node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json --test --test-reporter=spec apps/web/src/features/expenses/expenses.model.spec.ts apps/web/src/features/expenses/expense-review-validation.spec.ts` — PASS, 91 tests.
- Initial combined API/web invocation used the API tsconfig, so the two web files could not resolve `@/common/api/api-error-message`. Re-ran with the unchanged main web tsconfig and freshly built snapshot contracts; all web tests passed. This was a review-runner configuration issue, not an application fix.
- Tests use local fixtures/mocks. Browser interaction, real database round-trips, accountant acceptance, end-to-end tax reports, UAT, and Production were not verified in this task.

Next:

- Report **partially implemented**: WHT input-unit selection remains open; mixed-VAT arithmetic exists; durable exempt/zero-rated distinction and relevant end-to-end acceptance remain incomplete/unverified.
- User authorized implementation by a separate agent, branching from develop, testing, and pushing the completed result into develop. No deployment was requested.
- Delegate: `/root/wht_units_mixed_vat`; running independently while the parent continues backlog review.
- Isolated worktree: `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-wht-input-units-mixed-vat`.
- Feature branch: `codex/wht-input-units-mixed-vat`, created from freshly fetched `origin/develop` at `a53bb992`.
- Implementation memory belongs in the agent's worktree at `docs/agent-memory/wht-input-units-mixed-vat.md`. Agent owns scoped spec/plan, implementation, tests, and safe non-force integration respecting branch protections; parent must not duplicate edits or claim delivery before remote containment is verified.
