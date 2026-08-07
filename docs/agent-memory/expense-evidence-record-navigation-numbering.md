# Agent Memory: expense evidence record navigation and numbering

Status: Implemented, verified, and committed 2026-07-17; not deployed.

Owner: Codex

Scope: Expense confirmation numbering and the accountant shared-evidence table navigation.

Decisions:
- `เลขที่ค่าใช้จ่าย` is the company-internal `ExpenseRecord.expenseNumber`, separate from the supplier's `vendorDocumentNumber`.
- New confirmations reserve `expense.record`, persist the number in the same serializable expense confirmation transaction, then commit the reserved number; failed confirmations void it.
- The evidence table row is keyboard/click accessible and opens the existing expense detail journey, where linked files already use permission-checked preview/download behavior.
- Existing confirmed legacy records with a null number remain labelled `รายการเดิมไม่มีเลขที่`; this change does not silently renumber historical accounting evidence.

Open questions:
- Historical-number backfill requires an explicit owner/accountant decision because assigning official numbers retroactively changes retained accounting references.

Artifacts:
- `apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts`
- `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts`
- `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx`
- `apps/web/src/features/expenses/ExpensesPages.tsx`

Verification:
- `node --import tsx --test src/modules/expenses/application/use-cases/expense-branch-scope.use-case.spec.ts src/modules/expenses/infrastructure/prisma-expense.repository.atomic-confirm.spec.ts` from `apps/api`: 29 passed.
- `corepack pnpm --filter @watchdog-bms/api typecheck`: passed after regenerating the existing Prisma client.
- `corepack pnpm --filter @watchdog-bms/web typecheck`: passed.
- `git diff --check`: passed.

Next:
- Deploy only when requested.
- If historical records must receive official numbers, agree the effective numbering/backfill policy first and implement it as an audited one-time operation.
