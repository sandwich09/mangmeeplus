# Agent Memory: Document Preview Reliability

Status: Complete
Owner: Codex
Scope: Expense/substitute-receipt document preview, storage delivery, local seed objects, and Thai PDF runtime.
Decisions:
- Render validated Blob URLs instead of placing signed storage URLs directly in image/iframe elements.
- Preserve attachment permission, branch-scope, raw-signature, and SVG inline-security boundaries.
- Treat a document as reviewed only after the media element reports successful load.
- Use generated PDF for issued substitute-receipt preview; immutable SVG remains the source artifact.
- Preserve existing Docker volumes and repair mock objects idempotently during local seed.
- Invalidate asynchronous preview work on close, unmount, company/expense/evidence changes, and
  allow only the latest request to publish a Blob URL or mark a document viewed.
- Keep certificate renderability invariant across UI/API: 8 lines, 200 characters per line,
  8 evidence files, and 255 characters per evidence filename.
Open questions: None.
Artifacts:
- `docs/plans/document-preview-reliability-plan.md`
Verification:
- Web typecheck and production build passed; full web suite passed 815/815 and final focused preview/security tests passed 43/43.
- Focused API seed/attachment/substitute-render/amount suites passed 84/84; API Docker build passed.
- The deployed API container passed seed-fixture/PDF renderer tests 10/10; Thai ink ratio was 2.222%.
- Runtime CSP has `frame-src 'self' blob:` and no local HTTPS upgrade.
- API/gateway health are OK; web is ready.
- Seeded PNG/PDF objects return the expected MIME, byte size, checksum, and stable version ID across two seed runs.
- Runtime Noto Sans Thai is present; an eight-line Thai certificate rendered to two readable A4 pages and was visually inspected alongside both seed fixtures.
- The worst-case shared certificate boundary rendered within the four-page safety ceiling.
- Deployed images: API `69cf56759adf`, web `326cd9f0421e`; no Docker volume was reset.
- Browser-control smoke was unavailable because the browser runtime exposed no installed browser.
Next: User can exercise the shared viewer from the seeded team-meal expense and CRM payment-proof fixture; no follow-up implementation is required for this incident.
