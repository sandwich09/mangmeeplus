# Agent Memory: expense-unusual-date-filter-2026-10-29

Status: COMPLETE — correction integrated directly and released to signed UAT and Production; customer remains `OPEN`.
Owner: Codex
Scope: Expense document-date discovery, highlighted navigation, shared evidence folders and export.
Decisions:
- Actual UAT detail shows 18 March 2024 and `วันที่ผิดปกติ`; March 2024 list is empty. Read-only October 2026 search for `OR670318000742` finds the exact receipt, displayed with 18 March 2024 and intake 29 October 2026.
- Root cause: `documentDateWhere` groups `implausible` with `unverified`, although OCR stores a valid old date and the visible row displays it. The two-year OCR warning is retained; discovery uses the date displayed on the document.
- No change to date acceptance, permissions, tax, payment, posting, schema, package files or customer data. Existing shared status parser and query are reused.
Open questions: None.
Artifacts: Existing document-date spec/plan, this memory and `docs/evidence/expense-unusual-date-filter-2026-10-29/README.md`.
Verification: UAT read-only reproduction; API 178 + source guards 8, web 130, PostgreSQL 1 (9 fixtures), API compile and web typecheck passed. Actual Chrome month-picker/search/row/back journey at 390/1280/1536 passed; evidence report records fixture limitations and unchanged 36 px status chips.
Next: No release action remains. Exact release operations and evidence are recorded in `latest-main-uat-production-2026-10-29.md`. Local API/web and task-started database/cache/storage containers remain stopped; the synthetic clone is retained. No customer data was changed by the verification.
