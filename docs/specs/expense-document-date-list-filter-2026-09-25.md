# Expense document-date list filter

Status: Approved by the owner's 2026-09-25 request; implemented and browser-verified locally, pending release.

## Problem and decision

The main Expenses page currently groups rows by `uploadedAt` (the date the record entered the system). Production screenshots for บริษัท มั่งมียั่งยืน จำกัด show no rows in July or August 2026 while September contains records whose document dates are in those earlier months. The owner requires each expense to appear in the month of its document date.

The existing day/month selector on the main Expenses page must filter `ExpenseRecord.expenseDate` using the selected civil-date range. Its rows, KPI cards, status counts, empty state, and accountant export must use that same document-date period. The branch and permission scopes remain unchanged. The page continues to show both document and intake dates, including the late-document badge. The intake timestamp is not rewritten, and no expense data migration is needed.

Special views (`confirmed`, `unpaid`, and missing-address) keep their existing explicit scopes. The accountant export from a document-period page uses `dateField: 'expenseDate'`. Other pages and APIs that deliberately query by intake date retain that capability.

## Acceptance

- A record dated July appears in July and not September even when entered in September; likewise for August.
- Day and month selectors, visible totals/status counts, empty copy, and export refer to document date.
- Rows still display both dates and the late-document badge where applicable.
- No accounting, tax, approval, payment, or data mutation semantics change.

This decision supersedes the main-list intake-date and export lens sections of [the 2026-08-15 spec](expense-upload-date-visibility-spec.md).
