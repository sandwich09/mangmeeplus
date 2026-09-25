# Expense document-date list filter plan

Status: Implemented and browser-verified locally, 2026-09-25; pending release.

Spec: [Expense document-date list filter](../specs/expense-document-date-list-filter-2026-09-25.md).

1. Reuse the existing `fromDate`/`toDate` API filter, which already maps to `expenseDate` and orders document-date results. Change only the default main-list query; preserve special-view behavior.
2. Set the main-list accountant export to `dateField: 'expenseDate'` and update Thai/English helper and empty-state copy.
3. Update the existing Expenses E2E journey to assert that a backdated document is in its document month, absent from its intake month, and retains both date labels and the late badge.
4. Run a focused check and typecheck; record exact evidence in task memory. No migration is required. Production deploy requires its separate release protocol.
