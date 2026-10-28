# Expense document-date list filter plan

Status: Implemented and browser-verified locally, 2026-09-25; pending release.

Spec: [Expense document-date list filter](../specs/expense-document-date-list-filter-2026-09-25.md).

1. Reuse the existing `fromDate`/`toDate` API filter, which already maps to `expenseDate` and orders document-date results. Change only the default main-list query; preserve special-view behavior.
2. Set the main-list accountant export to `dateField: 'expenseDate'` and update Thai/English helper and empty-state copy.
3. Resolve `highlight` links to the accessible expense's document month before loading the list, so review and batch-upload return paths stay visible. Update the existing Expenses E2E journey to assert that a backdated document is in its document month, absent from its intake month, retains both date labels and the late badge, and is highlighted after a fresh navigation.
4. Run a focused check and typecheck; record exact evidence in task memory. No migration is required. Production deploy requires its separate release protocol.

## 2026-10-29 correction

1. Reuse the existing date-status contract: move `implausible` to the document-date branch of the shared list/evidence query; use the same distinction in evidence folders, accountant export and highlighted navigation.
2. Keep the existing warning and confirmation guard. Cover an old dated receipt, future unusual date, unread placeholder, legacy rows, day/month bounds and unchanged branch/actor scope with focused unit and real PostgreSQL checks.
3. Reproduce UAT read-only, then click the corrected local list at 390 and 1280. Record exact evidence in `docs/agent-memory/expense-unusual-date-filter-2026-10-29.md`. UAT deployment is a separate operation; this correction does not modify live receipts.
