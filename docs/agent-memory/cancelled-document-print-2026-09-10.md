# Agent Memory: cancelled-document-print

Status: Implementation and focused verification complete. Authorized for merge to develop and main; PR/commit history and the final thread response record integration status.
Owner: Codex.
Scope: Cancelled substitute receipt presentation; reimbursement A4 pagination across preview, browser print and PDF download.
Decisions:
- Thai/English diagonal dark-red cancellation watermark on every derived page. Full stored cancellation reason at the end, with Thai word wrapping using the available box width.
- Normal cancellation box appears once on the final page, moved whole to a new final page when needed. An intrinsically page-tall reason continues in labelled final reason blocks; no content is truncated or shrunk to fit one page.
- Reimbursements use fixed A4 SVG pages, repeated identity/table headings, intact normal rows and continuation of oversized rows with amounts printed once. Totals and signatures occur once.
- API returns optional pageSvgDataUrls alongside the legacy SVG/checksum. FE preview, print and PDF download consume the same ordered pages; older responses still work. Image loading must finish for every page before Print is enabled; error/retry does not accept a partial preview.
- Browser PDF writer handles ordered pages with sequential rasterization. Named A4 print pages and block layout prevent blank intervening pages and remove preview decoration.
- Existing permissions, lifecycle, stored artifacts/checksums, approval and accounting mutations are unchanged. Completed cancellation alone marks claims; pending/rejected/active claims remain unmarked. No schema, dependency or package.json change.
Open questions: None for this scope. Full ledger integration was outside this print task.
Artifacts:
- docs/specs/cancelled-document-print-spec.md
- Synthetic examples and generator: output/pdf/pagination/ (local only; not committed). Includes a 65-row five-page claim, active equivalent, oversized row and final-box overflow.
- Browser QA script retained at output/pdf/pagination/browser-check.cjs; local auth fixture stays outside git.
Verification:
- 62 focused API tests passed, zero skipped: claim-form.logic.spec.ts, reimbursement-claim-form.use-case.spec.ts, substitute-receipt-pdf.logic.spec.ts, substitute-receipt-download.use-case.spec.ts. Log: /tmp/cancelled-pagination-api-tests.log.
- 32 focused web tests passed: image-pdf.logic.spec.ts, document-raster.logic.spec.ts, DocumentPreviewModal.spec.ts, reimbursements-preview.spec.ts, substitute-receipt-preview.spec.ts. Log: /tmp/cancelled-pagination-web-tests.log.
- API and web typecheck passed; local API build passed. Logs: /tmp/cancelled-pagination-api-types.log, /tmp/cancelled-pagination-web-types.log, /tmp/cancelled-pagination-api-build.log.
- Chromium on the actual web app: five preview pages = five downloaded PDF pages = five browser-print pages, no extra blank pages. Preview fits a 390px viewport; later-page failure disables Print; retry, delayed page loading and legacy one-image fallback work. Multi-page synthetic response was injected at the preview endpoint only; no cancellation/payment writes were performed.
- Unmocked seeded submitted claim: real authenticated API POST through the UI returns pageSvgDataUrls and loads successfully in the web preview.
- Poppler-rendered first/last/boundary/oversized pages and actual browser PDF output visually inspected for complete text, watermark, signatures and final reason box.
- git diff --check passed. Original dirty workspace remains untouched. API/web local review servers remain on 3007/3006 in the isolated worktree.
Next: Merge the scoped branch codex/cancelled-document-print-20260910 into develop and main using the user's existing admin-merge authorization. Report actual CI state without claiming deployment.
