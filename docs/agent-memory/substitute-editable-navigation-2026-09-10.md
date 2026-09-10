# Agent Memory: substitute-editable-navigation

Status: Implemented, verified, and synchronized to user local; integrating main/develop.
Owner: Codex.
Scope: Existing substitute receipt Back/Next navigation, DIGITAL and PAPER.
Decisions:
- Back opens the original editable fields directly; remove the separate certificate edit action/mode UI. Keep navigation below content with Back/Next labels.
- Step 1 reuses ExpenseReviewEditSection and its canonical review-fields save, calculations, validation and concurrency token. Step 2 reuses certificate facts and attachment pickers together. Do not duplicate expense/tax payloads.
- Next from step 1 saves changed source facts. Next from step 2 amends certificate facts using the existing server endpoint. Preserve typed certificate-only fields when navigating back; a newly saved source purpose/reason takes precedence for shared facts.
- Reuse existing status/financial locks, immutable document number and signed-revision invalidation. No-op navigation does not invalidate signatures. No new database or API shape.
- Disabled forms for explicit mode=view, lack of edit permission, cancelled/issued or financially locked documents. Viewing attached files and Back/Next stay available, with no mutation or signing actions in view mode.
- During editable forms, step chips cannot bypass validation/save. Error leaves the form and entered values available.
Open questions: None.
Artifacts: Wizard, existing expense form save option, existing receipt route, browser coverage.
Verification:
- Web typecheck passes. 46 focused web checks pass (wizard model/QA, preview and canonical source payload).
- PostgreSQL suite `substitute-expense-edit.pg.spec.ts`: 31 passed, including signed no-op, paper scan retention/resigning, immutable numbering, financial locks and stale writes.
- Browser: 4 passed (20.6s). DIGITAL/PAPER disabled view/cancelled forms, every file preview, cancellation on focus, 1440px/390px. Live API: source quantity/purpose and certificate payee/reason saves, unsaved payee retained across Back, validation, no-op signatures preserved, digital signed revision reopened with same number and old history retained, no page errors/overflow.
- Live browser spec is opt-in for the isolated review DB/policy/personal signature fixture: `SUBSTITUTE_NAVIGATION_LIVE=1 E2E_WEB_BASE_URL=http://localhost:3010 WEB_PORT=3010 API_PORT=3011 pnpm exec playwright test e2e/substitute-editable-navigation.spec.ts e2e/substitute-cancelled-view-only.spec.ts --project=chromium --workers=1`.
- Evidence: `/tmp/sub-editable-{all-browser,pg,focused,types-final,userlocal}.log`, screenshots under test-results. Actual user port3000 receipt SRC-202609-00040: Back opens editable certificate fields, Back again opens source fields. Only read/navigation performed on this user record.
- User local received a three-way merge of just wizard, shared form save option and route, preserving concurrent edits. No cloud deployment.
Next: Merge scoped changes into main/develop and record PR IDs.
