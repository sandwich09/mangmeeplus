# Agent Memory: expense-unusual-date-filter-2026-10-29

Status: Correction verified for direct main/develop integration without PR. No live mutation or deployment.
Owner: Codex
Scope: Expense document-date discovery, highlighted navigation, shared evidence folders and export.
Decisions:
- Actual UAT detail shows 18 March 2024 and `วันที่ผิดปกติ`; March 2024 list is empty. Read-only October 2026 search for `OR670318000742` finds the exact receipt, displayed with 18 March 2024 and intake 29 October 2026.
- Root cause: `documentDateWhere` groups `implausible` with `unverified`, although OCR stores a valid old date and the visible row displays it. The two-year OCR warning is retained; discovery uses the date displayed on the document.
- No change to date acceptance, permissions, tax, payment, posting, schema, package files or customer data. Existing shared status parser and query are reused.
Open questions: None for the local correction. No deployment requested in this bug report.
Artifacts: Existing document-date spec/plan, this memory and `docs/evidence/expense-unusual-date-filter-2026-10-29/README.md`.
Verification: UAT read-only reproduction; API 178 + source guards 8, web 130, PostgreSQL 1 (9 fixtures), API compile and web typecheck passed. Actual Chrome month-picker/search/row/back journey at 390/1280/1536 passed; evidence report records fixture limitations and unchanged 36 px status chips.
Next: A live UAT fix requires a separately authorized release under the deployment runbook. Local API/web and task-started database/cache/storage containers are stopped; the synthetic clone is retained. Local logout returned 204; viewport reset. No customer data was changed.
