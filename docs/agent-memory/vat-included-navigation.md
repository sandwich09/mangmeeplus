# Agent Memory: VAT-included navigation

Status: implemented and locally verified; merging WHT/develop next, 2026-08-27.
Owner: /root/wht_units_mixed_vat/zero_vat_persistence, assigned by /root.
Scope: source-aware VAT validation and usable Next navigation; isolated worktree
`mangmeeplus-vat-included-navigation`, branch `codex/vat-included-navigation` from
`origin/develop@a53bb992fc04713d7cba2f2b19c08286f27c08e5`.

Decisions:
- Read root's main-vat-included-navigation-review.md and user screenshot read-only.
- Existing code already exposes VAT controls in SIMPLE for included/excluded modes.
- Confirmed remaining mismatch: setDocumentVatAmount changes source but not line
  rates; validateExpenseReview rejects blank rates before server derivation.
- No assumed 7%, no NO_VAT bypass, no confirmation guard relaxation.
- Ponytail full; reuse vatRateFromPrintedAmount; no dependency/package.json edits.
- WHT task handed off before starting this work; its parent owns that integration.
- Both agents must refresh/integrate develop serially and retain shared-file changes.

Open questions: none.
Artifacts:
- `docs/specs/expense-vat-included-navigation-spec.md`
- `docs/plans/expense-vat-included-navigation-plan.md`
- Scoped code: review validation, review page/footer, edit section, dictionary;
  frontend validation and API draft VAT regression specs. No production backend behavior change.
Verification:
- New worktree branch/status verified clean at a53bb992.
- corepack pnpm install --offline --ignore-scripts --frozen-lockfile: PASS, 754 reused.
- `./node_modules/.bin/tsc -p packages/contracts/tsconfig.json` and config equivalent: PASS.
- `corepack pnpm --filter @watchdog-bms/api exec prisma generate`: PASS.
- `./node_modules/.bin/tsc --noEmit -p apps/web/tsconfig.json` and API equivalent: PASS.
- `./node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json --test --test-reporter=spec apps/web/src/features/expenses/expense-review-validation.spec.ts apps/web/src/features/expenses/expenses.model.spec.ts apps/web/src/features/expenses/expense-review-steps.logic.spec.ts`: 111/111 PASS.
- `corepack pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec src/modules/expenses/application/use-cases/expense-draft-vat-decouple.use-case.spec.ts src/modules/expenses/domain/logic/expense-totals.logic.spec.ts`: 63/63 PASS.
- `./node_modules/.bin/tsx --test --test-reporter=spec packages/contracts/src/*.spec.ts`: 197/197 PASS.
- `git diff --check`: PASS.

## Browser integration evidence

Read the browser skill and used its in-app browser runtime with Chrome. Tested the
actual `ExpenseReviewPage` on Next at 127.0.0.1:4320. A temporary loopback HTTP API
at 127.0.0.1:4321 used the actual `UpdateExpenseDraftUseCase` with an in-memory
repository and synthetic receipt only; no database, customer data, authentication
session, cloud service, or deployment was accessed. `INTERNAL_API_URL` routed only
this local dev process. The temporary fixture page and generated next-env change
were removed after testing; both dev servers stopped and viewport reset.

- SIMPLE, gross25, included, blank rate/NONE source: Next disabled; field and footer
  show the required VAT rate/amount reason; action focuses `expense-vat-rate-vat-fixture-0`.
- Explicit7% then actual Next: step2 opens; saved base23.36 + VAT1.64 = gross25,
  unitPrice25 unchanged, sourceNONE, rate0.07, expectedUpdatedAt preserved.
- Blank rate with sourceAMOUNT1.64: Next enables and saves; derived rate0.0702,
  accepted VAT1.64, base23.36, gross25. Source comparison matches after returning.
- Amount1.001: Next remains disabled; source validation says at most2 decimals.
- Injected synthetic422: stays on step1 with existing error UI and typed1.64 intact;
  retry saves successfully and advances with one recorded successful mutation.
- FULL, mobile390x844: screenshots/DOM inspected; no horizontal overflow, actionable
  reason and Next visible, action scrolls/focuses the correct input.
- FULL explicit0%: Next advances; VAT0 and gross25. No inference of tax treatment.
- FULL excluded blank: blocked; explicit7% then Next saves base25/VAT1.75/gross26.75;
  existing AI-total mismatch acknowledgement remains required (not bypassed).
- Final focus-ref simplification retested; disabled Next has aria-describedby linked
  to the visible exact reason, and the field focus works.

Limitations: synthetic API supplies permissions/detail and bypasses real login/storage;
no authenticated full-stack database E2E or live release check was run. Server use-case,
frontend save/refresh, stale-version request shape, and retry were exercised together.

Next: integrate WHT origin/develop 8cafd8af, regenerate contracts/Prisma, rerun combined
affected tests/typechecks, push feature then develop non-force, and verify remote SHA.
