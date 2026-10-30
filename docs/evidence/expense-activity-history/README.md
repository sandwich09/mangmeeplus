# Expense activity history verification — 2026-10-30

All screenshots use fictional local fixtures. Nothing here is a production/customer record.

- `desktop.png`, `mobile.png`: actual Next expense detail route and history modal, 1440×1000 / 390×844.
- `browser-result.json`: 16 successful browser checks; `unsaved-edit-result.json`: editing a vendor name, opening history and closing it preserved the unsaved value and did not save.
- `value-labels-result.json`: six successful checks for the earlier value-card revision (superseded by the table revision).
- `table-browser-result.json`: 17 successful checks for the approved compact table revision. Current screenshots show one three-column table for three simultaneous changes, actor/action together, and creator in the title. Loading/error/unknown/empty states, page retries and permission revocation, long mobile content, keyboard focus, and unsaved edits passed.
- `backend-tests.log`: 120 focused tests passed. `web-tests.log`: 39 focused tests passed.
- Contracts build and API/web TypeScript checks passed. Live PostgreSQL E2E was unavailable locally.

Browser execution used an isolated Next dev server on 127.0.0.1:4310 and fixture API on 127.0.0.1:4311, plus Playwright response interception for loading, failure, forbidden, empty and pagination cases. Temporary scripts: `/tmp/expense-activity-history-qa/api.cjs` , `browser.cjs`, and `table-browser.cjs` (current revision). Servers were stopped after verification.

Backend command from repository root:

```sh
corepack pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec src/modules/expenses/application/use-cases/expense-draft-concurrency.use-case.spec.ts src/modules/expenses/application/use-cases/expense-related-access.use-case.spec.ts src/modules/expenses/application/use-cases/expense-branch-scope.use-case.spec.ts src/modules/expenses/application/use-cases/line-draft-update.security.spec.ts src/modules/expenses/application/use-cases/line-expense-draft-conversation.use-case.spec.ts src/modules/expenses/infrastructure/prisma-expense.repository.tax-snapshot.spec.ts src/modules/system-partner-management/application/free-expense-access.spec.ts
```

Compact-table frontend follow-up: contracts build, web TypeScript, focused history formatter tests (4/4), and scoped whitespace check passed. Browser fixtures exercise the real Next route/modal; system filtering and creator lookup are verified in backend tests, not claimed as live database verification.

Backend compact-table projection follow-up: `human-projection-tests.log` records 27/27 passed (expense-related-access and expense-draft-concurrency specs). Contracts build, API TypeScript, and scoped whitespace check passed. Current screenshots were visually reviewed after the 17-check browser run.

## Integration on current main/develop (`994a55fa1`)

Current screenshots use the latest page and shared button styles: desktop1280, mobile390, wide1536. `table-browser-result.json` now records18 passing integration checks, including360/768/1536 bounds and button heights. Temporary harness: `/tmp/expense-activity-history-qa/integration-browser.cjs`. The editor fixture includes the current reviewers API.

Contracts build and API/web TypeScript passed. `integration-focused-tests.log` has19/19 history tests passing. Broader backend logs (`integration-api-tests.log`, `integration-six-specs.log`) include19 existing fixture failures, all `FREE_EXPENSE_ACCESS_UNAVAILABLE`:12 reviewer/disbursement cases reproduced against the original HEAD test;7 VAT-decision failures have a byte-identical caller/spec chain to HEAD. Evidence: `integration-baseline-tests.log`, `integration-vat-baseline-proof.log`. They were not changed by this feature. No live PostgreSQL end-to-end check was performed.
