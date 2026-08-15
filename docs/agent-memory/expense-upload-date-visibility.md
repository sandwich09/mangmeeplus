# Agent Memory: expense-upload-date-visibility

Status:
Implemented, locally verified and delivered on 2026-08-15. Implementation commit `9dbc564`; ready PR [#98](https://github.com/MangmeeDev/mangmeeplus/pull/98) targets `develop` from `date-miss`.

Owner:
Product owner approved the v0.2 spec/plan, cross-channel semantics and implementation on the existing `date-miss` branch, including review, tests, commit, push and PR.

Scope:
Main Expenses operational list only: intake-date query/order, both-date display, cross-month late tag, KPI/empty/export lens copy, tests and documentation. Web upload, manual, substitute, reimbursement and LINE source workflows were regression-checked but not re-dated or rewritten.

Decisions:

- Reuse `ExpenseRecord.uploadedAt`; no new field or migration.
- Main list day/month and KPI/status cohort use the Bangkok civil date of `uploadedAt`.
- `expenseDate` remains document/accounting/tax truth; accountant export remains `dateField: expenseDate`.
- Show `เอกสารย้อนหลัง X วัน` only when intake is later and the Bangkok civil month differs.
- Order a dedicated upload-date lens by `uploadedAt desc` before `take`; no-range or combined document-date callers retain `expenseDate desc`.
- Existing Expense intake never moves when OCR/review, optional evidence or substitute-certificate workflow runs.
- Reimbursement projection and clarified LINE rows enter the main list when their Expense row is created, not when an upstream attachment or request first arrived.
- Known 200-row client KPI ceiling remains out of scope.

Bug/gap findings during implementation:

- Existing upload-range conversion used UTC midnight while UI/tag use Asia/Bangkok. This would exclude month-day 1 between 00:00–06:59 Bangkok and include the same hours from the next month. Fixed only for Expense timestamp/upload lenses and pinned with exact UTC bounds.
- Three stale Expenses E2E fixtures used superseded API shapes: two receipt intents sent an ISO timestamp instead of a civil date and one PATCH omitted `expectedUpdatedAt`. Updated test fixtures; no production boundary was weakened.
- Main list source export intentionally differs from the visible cohort. UI copy and E2E request assertions make this explicit.

Artifacts:

- `docs/specs/expense-upload-date-visibility-spec.md`
- `docs/plans/expense-upload-date-visibility-plan.md`
- `apps/web/src/features/expenses/ExpensesPages.tsx`
- `apps/web/src/features/expenses/expenses.model.ts`
- `apps/web/src/features/expenses/expenses.model.spec.ts`
- `apps/web/src/common/i18n/workspace-dictionary.ts`
- `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts`
- `apps/api/src/modules/expenses/application/use-cases/expense-related-access.use-case.spec.ts`
- `e2e/expenses.spec.ts`

Verification:

- Red-first late-tag helper, upload ordering and Bangkok month-boundary assertions all failed for the intended baseline reason and passed after implementation.
- Focused web model: 49/49 passed; post-change web expense/API/substitute matrix: 80/80 passed.
- Focused repository/ABAC: 8/8 passed; expense upload/substitute/related matrix exited 0.
- Reimbursement materialization/approval/finance plus LINE intake dispatch matrix exited 0.
- Web and API typechecks passed.
- Fresh isolated Postgres/Redis/MinIO stack: all 132 migrations applied, standard seed passed, Expenses E2E 16/16 passed; EXP-26 independently passed desktop/mobile, request and export assertions.
- `git diff --check` passed before documentation update. No package manifest, schema, migration, permission, controller, tax or ledger file changed.
- Unrelated user-owned `docs/agent-memory/branch-selector-system-audit.md` remains untracked and untouched. The branch also pre-existed with the committed legal-acceptance memory delta; it was not modified in this implementation.
- Branch `date-miss` was pushed to `origin`; ready PR #98 was created against `develop` with implementation, impact and verification evidence.

Next:

1. Review PR #98 and merge into `develop` when repository checks and reviewer approval pass.
2. Track the existing 200-row KPI aggregation limitation separately if the intake volume requires server-side aggregates.
