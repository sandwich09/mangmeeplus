# Agent Memory: Substitute cancelled view only

Status: Implementation and local verification complete; PR CI and merges pending.
Owner: Codex
Scope: User requests cancelled substitute receipts to be view-only with no revised-document action, then merge into develop and main.
Decisions:
- Remove the cancelled wizard's action that clears evidence and reopens preparation.
- Retain read-only expense/details/evidence navigation, history and existing document reads; hide the source-edit link and signing instructions for cancelled evidence.
- A focus refresh that discovers cancellation exits signing and displays cancelled status. Render cancellation before any editable/signing step as a final UI guard.
- Keep automatic same-document internal revision routing from the expense-edit synchronization spec, existing active-document workflow and API status/permission guards.
- Isolated worktree based on origin/develop 9c37ed02; original checkout contains unrelated uncommitted work.
Open questions: None.
Artifacts: SubstituteReceiptWizardPage.tsx; e2e/substitute-cancelled-view-only.spec.ts.
Verification:
- `corepack pnpm --filter @watchdog-bms/web exec tsx --test src/features/expenses/SubstituteReceiptWizardPage.qa.spec.ts src/features/expenses/substitute-receipt-wizard.model.spec.ts`: 27 passed.
- `corepack pnpm --filter @watchdog-bms/web typecheck`: passed.
- `WEB_PORT=3021 E2E_WEB_BASE_URL=http://127.0.0.1:3021 corepack pnpm exec playwright test e2e/substitute-cancelled-view-only.spec.ts --project=chromium`: 2 passed. DIGITAL/PAPER, 1440/390px, direct reload, active signing cancelled on focus, all read-only back steps, retained history and expense-view link; zero business writes and browser errors. Expense/evidence responses mocked; local seeded owner authentication remains real.
- Visually inspected desktop DIGITAL and mobile PAPER screenshots in the isolated worktree's test-results directory. Cancelled history has no revision action.
- Backend certification/approval/paper submission already reject incompatible evidence status; no API, contract, data model or financial mutation change is needed.
Next: Complete verification, open scoped PRs and merge into develop/main. No deployment requested.
