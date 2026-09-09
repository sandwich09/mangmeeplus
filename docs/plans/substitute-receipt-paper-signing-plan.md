# Plan: ใบรับรองลงนามบนกระดาษ

Spec: [[specs/substitute-receipt-paper-signing-spec]]

1. Discover existing paper/LINE/upload/PDF/issue boundaries — done.
2. Add nullable signer identity, frozen form/submission/reviewer fields and additive migration.
3. Extend prepare and add scoped paper upload/preview/accept using existing final issue transaction and storage controls.
4. Render blank-name paper forms and captured company payment wording; preserve legacy snapshots.
5. Move member selector behind signing-method choice, add paper upload/review panel and hub waiting state.
6. Focused API/web/typechecks plus PostgreSQL boundary tests, browser and actual PDF visual QA. Keep local running, no deploy.

Status: implementation and local verification complete; awaiting user review. Preserve prior receipt work and unrelated dirty files; do not edit package.json.

## Completed evidence

- Steps 1–6 completed with focused tests, real PostgreSQL concurrency/payment checks, HTTP/storage smoke, browser journey and visual PDF checks. See [[agent-memory/substitute-receipt-paper-signing-2026-09-09]] for exact logs and fixtures.
- Follow-up integration fixes: legacy DB signature constraints now distinguish paper from digital; paper preview renders all pages in the in-app browser and requires explicit reading confirmation; issued paper uses the same reader from wizard/hub.
- Web/API stay running locally for review. No deployment or reimbursement scope added.

- User presentation follow-up: blank PAPER form now omits the centered number/version line, red instructions and all footer text. Verified the actual SRC-202609-00017 PDF locally; focused checks 77/77 passed. See task memory for logs.

## Optional positions and acceptance page follow-up

Completed and verified locally 2026-09-10: normalize optional positions in contracts/API, remove all UI position gates, render absent positions cleanly, capture uploader display name, simplify new paper attestation, and clarify existing reviewer settings. Verify focused API/web checks and real local PDFs/flows; preserve issued artifacts.

Evidence: focused API 304/304, web 53/53, guide suite, typechecks/builds, four real local funding/signing combinations and PDF/browser QA passed. Reviewer settings renamed for discoverability after user follow-up; company policy untouched. See task memory for logs and fixtures.

- Disabled-state UX follow-up completed 2026-09-10: numbered paper review steps, prerequisite feedback and page-open progress. Chrome verified that explicit reading confirmation enables declarations; acceptance remains gated. Preview tests 15/15 and web typecheck passed.

- Step 3 PDF footer follow-up completed 2026-09-10: accountless PAPER preview/download no longer adds ID/Page; generated attestation tax footer removed, including from derived downloads of existing issued records. Uploaded source content, stored artifacts and state stamps preserved. Focused checks 82/82, API build/typecheck and actual prepared/issued PDF visual QA passed. Local API restarted; see task memory for evidence.

- Online footer follow-up completed 2026-09-10: new online SVGs omit the grey tax footer; issued online preview/download removes the former static footer from derived copies and omits ID/SHA256/Page. Online unsigned downloads also omit page footers; status stamps remain. Focused tests 82/82, API build/typecheck, and actual SRC-202609-00026 PDF visual QA passed. Source record unchanged; local API restarted.
