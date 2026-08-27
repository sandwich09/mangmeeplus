# Agent Memory: WHT input units and mixed VAT

Status: implementation and local verification complete, 2026-08-27; remote integration pending.
Owner: delegated implementation agent.
Scope: expense receipt/review WHT baht/percent; durable zero-VAT line treatment; test and integrate into develop.
Decisions:

- Isolated worktree `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-wht-input-units-mixed-vat`, branch `codex/wht-input-units-mixed-vat`, base `a53bb992fc04713d7cba2f2b19c08286f27c08e5`.
- User's dirty `plan` checkout is read-only and excluded from all changes/commits.
- Mandatory old ponytail path is unavailable; read the repository's full skill instead.
- Whole-bill WHT input is additive; legacy mixed rates are not inferred/overwritten. Amount stays authoritative; no fabricated tax rate.
- RATE is percent (3 means 3%), max two decimals. AMOUNT is baht, max two decimals and cannot exceed accepted pre-VAT base; exact satang allocation uses largest remainder.
- Apply WHT after accepted VAT reconciliation. Preserve gross-before-WHT and net-payable meanings. Reject negative VAT/base residual carriers even inside the 0.05 tolerance; exempt/zero rows never become VAT carriers.
- Nullable `whtInputJson` holds reviewer/OCR intent; nullable line `vatTreatment` distinguishes EXEMPT, ZERO_RATED, NON_VAT. Historical zero remains unknown. Ordinary receipts need no Tax Code to retain treatment.
- OCR retry keeps reviewed monetary lines/price mode when reviewer WHT, explicit treatment, or mixed historical WHT rates exist; it still refreshes raw OCR evidence. Do not match a changed extracted row to prior tax meaning by row number.
- Downstream amount-only WHT event/report rate stays null (not fabricated or 0%); whole-bill input retains the whole base even when small allocated line WHT rounds to zero.
- Existing summary shows saved accepted totals and refreshes on save. No second client-side VAT reconciler. Included-VAT source input uses a client gross upper bound; server enforces the exact accepted base.
- No cloud, live DB, deployment, main mutation, dependency or package.json changes.

Open questions: none for bounded receipt implementation; tax eligibility remains reviewer-owned.
Artifacts:

- `docs/specs/expense-wht-input-units-mixed-vat-spec.md`
- `docs/plans/expense-wht-input-units-mixed-vat-plan.md`
- `apps/api/prisma/migrations/20260827100000_expense_wht_input_vat_treatment/migration.sql`

Verification:

- Isolated offline dependencies installed with `corepack pnpm install --offline --ignore-scripts --frozen-lockfile`; contracts/config built in this worktree, API Prisma client generated locally. No package/lock changes.
- `./node_modules/.bin/tsx --test --test-reporter=spec packages/contracts/src/prisma-enum-parity.spec.ts`: 43/43 passed (includes runtime WHT input guards).
- All expense API specs excluding `.pg.spec.ts`, via `rg --files apps/api/src/modules/expenses | rg '\.spec\.ts$' | rg -v '\.pg\.spec\.ts$' | xargs ./apps/api/node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test --test-concurrency=4 --test-reporter=spec`: 923 tests, 917 passed, 6 skipped, 0 failed. Skips require a real PostgreSQL `DATABASE_URL`; no database was started or mutated.
- All expense web specs via `rg --files apps/web/src/features/expenses | rg '\.spec\.tsx?$' | xargs ./node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json --test`: 230/230 passed. Covers unit labels/input/payload/reload, explicit zero, historical mixed WHT, treatment validation and missing-rate visibility.
- Downstream API suites (`expense-auto-post`, `expense-account-binding`, `transaction-tax-posting`, `sync-tax-events-wht-form`, `expense-source.adapter`, `tax-reconciliation`, `wht-report`, `generate-tax-filing-package`, `spec-suite-coverage`), using API tsx/tsconfig: 60/60 passed.
- Final focused VAT/WHT/draft/OCR regression rerun: 126/126 passed. Tiny gross0.01 VAT carrier cannot accept source VAT0.05 and produce negative WHT; both document and line source cases stay MISMATCH.
- `tsc -p packages/contracts/tsconfig.json`, `tsc -p packages/config/tsconfig.json`, `tsc --noEmit -p apps/api/tsconfig.json`, `tsc --noEmit -p apps/web/tsconfig.json`: passed.
- `corepack pnpm --filter @watchdog-bms/api build`, `corepack pnpm --filter @watchdog-bms/web build`, and `corepack pnpm --filter @watchdog-bms/api exec prisma validate`: passed. API build/typecheck repeated after final arithmetic fix; web typecheck repeated after browser verification.
- Real ExpenseReviewPage + real UpdateExpenseDraftUseCase browser check on localhost4330/4331 with in-memory repository, no database/auth/customer data: direct AMOUNT30.01 on VAT7%1234.56 + EXEMPT100 -> base1334.56/VAT86.42/gross1420.98/net1390.97; editing first item to1000 with discount10 retained WHT30.01 and net1129.29. Switching to RATE clears input; blank/101% blocked Next; entering3 saved fraction0.0300, WHT32.70/net1126.60. Reload retained percent3, correct unit and EXEMPT treatment. Browser error log empty. Temporary fixture files and servers removed/stopped; no test routes retained.
- `git diff --check`: passed. No package.json, lockfile, generated-file or unrelated diff.
- Remote develop protection inspected read-only: force/deletion disabled, no required PR/status checks/rules; use ordinary non-force fast-forward push only. Related VAT-navigation and reimbursement agents must fetch/rebase after this integration.

Limitations: additive migration has not been applied to a real database; six PostgreSQL tests, authenticated/live E2E, UAT/Production deployment are not claimed. Amount-only tax-document rate selection remains accountant-owned, not guessed from amount. Browser verification uses synthetic state, not a full authentication/persistence stack.

Next: fetch develop again, commit/push scoped feature, fast-forward develop and record verified remote delivery SHAs.
