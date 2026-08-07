# Agent Memory: expense export → real XLSX with readable headers

Status: Implemented and verified end to end (2026-07-25). Not committed; applied to three worktrees.

Owner: Expenses / accountant export.

Scope: `/companies/:id/expenses` export bar and the accountant sharing panel (`EvidencePanel`).

Reported problems:
1. The "ส่งออก Excel" button downloaded `expense-index-*.csv` — a CSV, not Excel.
2. Column headers were machine keys (`vendor_tax_id`, `wht_amount`, …), unreadable for accountants and general users.

Decisions:
- Reused the dependency-free OOXML writer that already existed in the tax module instead of adding SheetJS/exceljs. Moved it to `apps/api/src/common/export/xlsx.logic.ts` (`buildXlsx(rows, sheetName)`, `XLSX_MIME_TYPE`); `tax-export.logic.ts` now calls it, behaviour unchanged.
- The writer gained: numeric cells (`<v>`) when a cell value is a number, a frozen header row, and a fixed column width. Tax XLSX export inherits these.
- Headers use `ACCOUNTANT_INDEX_COLUMN_LABELS` in contracts — the Thai labels already written in `docs/specs/expense-receipt-upload-spec.md`.
- Enum-valued columns (`expense_status`, `source_document_type`, `tax_evidence_status`) render through the existing contracts label maps, so the file reads the same as the UI.
- Two column sets (`AccountantPackageRequest.columnSet`, default `summary`): summary = date / vendor / description / category / grand total / VAT / status; full = all 40 spec columns. The list page has a picker next to the button; the accountant sharing panel always sends `full`.
- `indexCsv` stays in the response unchanged (machine keys, full spec order) so API consumers and the spec's CSV requirement are untouched. No CSV button remains in the UI — the owner asked for Excel only.

Artifacts:
- contracts: `packages/contracts/src/expenses.ts` (labels, `ACCOUNTANT_INDEX_SUMMARY_COLUMNS`, `accountantIndexColumns()`, `columnSet`, `indexXlsxBase64`).
- api: `common/export/xlsx.logic.ts` (new), `modules/tax/domain/logic/tax-export.logic.ts`, `modules/expenses/domain/logic/expense-export.logic.ts` (`buildAccountantIndexXlsx`), `modules/expenses/application/use-cases/expense-evidence.use-case.ts`.
- web: `expenses.api.ts` (`downloadIndexXlsx`), `ExpensesPages.tsx`, `ExpensesWorkspacePanels.tsx`, `common/i18n/workspace-dictionary.ts` (`expenses.export_columns*`).
- docs: `docs/specs/expense-receipt-upload-spec.md` export-format rules.

Verification:
- `tsx --test src/modules/expenses/domain/logic/expense-document.logic.spec.ts src/modules/tax/domain/logic/tax-export.logic.spec.ts` → 30/30 pass (new case asserts PK signature, Thai headers, numeric cells, 7 vs 40 columns).
- `tsc --noEmit` in `apps/api` (58 pre-existing errors, unchanged) and `apps/web` (clean apart from stale `.next/types` entries).
- Live run: API built from source on :3011 against the local seeded DB, web dev server on :3211, Playwright logged in as Owner and clicked the button for both column sets. Both downloads named `expense-index-2026-07.xlsx`; `openpyxl` opened them with sheet `รายการค่าใช้จ่าย`, frozen header, Thai labels, and amounts as floats (1979.5 / 129.5).

Next: none required. If an English export is ever needed, add an `en` label map and pass locale on the request — deliberately skipped (Thai-only headers today).
