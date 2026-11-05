# Document Preview Reliability Plan

Status: Complete (2026-08-08)

## Goal

PDF, PNG, JPEG, and system-generated substitute-receipt SVG documents must open visibly from every expense preview entry point. A missing or invalid object must show an actionable error and must never count as "reviewed" for signing or approval.

## Confirmed failures

- Expense PDF viewers frame a cross-origin signed storage URL, but CSP has no `frame-src` allowance.
- Certified and issued substitute receipts are stored as SVG with attachment disposition while the UI loads the URL in an image element; browser ORB can reject that response.
- Preview compliance state is set before the browser has decoded the document.
- The local seed marks a payment-proof image ACTIVE without uploading its object to MinIO.
- The API image lacks a configured Thai font, so server-rendered PDF text can become missing-glyph boxes.
- The evidence picker lists filenames without a way to inspect the selected image/PDF.

## Smallest correct design

1. Keep generic storage download authorization and the SVG inline security restriction unchanged.
2. Fetch the permission-checked signed URL as bytes, validate status/MIME/non-empty content, then render a short-lived Blob URL. This removes `Content-Disposition`/ORB from the media element and gives reliable HTTP errors.
3. Render all sources through one preview modal: images in a readable scroll/zoom surface and PDFs in a Blob iframe. Revoke Blob URLs on replacement, close, reload, and unmount.
4. Mark prepared/certified documents reviewed only from the viewer's successful media `load` event.
5. Preview issued substitute receipts as the generated PDF; keep immutable SVG as the stored source artifact.
6. Allow `frame-src 'self' blob:` and derive local CSP behavior from runtime deployment identity rather than compiled `NODE_ENV` alone.
7. Install and verify Noto Thai fonts in the API image.
8. Upload deterministic mock image/PDF bytes before upserting ACTIVE seed attachment metadata.
9. Bind every asynchronous preview to the active company, expense, evidence revision, or drawer.
   Closing or changing context invalidates the request and revokes any unpublished Blob URL.
10. Enforce the same renderable certificate boundary in the wizard and API: at most 8 expense
    lines, 200 characters per line, 8 unique evidence files, and 255 characters per filename.
    **Owner 2026-11-05:** the line limit is now `EXPENSE_MAX_ITEM_LINES` (200), the same as the
    AI read. The certificate's rows are the bill's own rows, so a bill that saves must also be
    certifiable. The PDF continues on new sheets with the table header and "(ต่อ)"; totals and
    signatures appear once. Evidence files stay at 8.

## Scope

- Expense inline/fullscreen attachment viewer.
- Substitute-receipt Wizard, Hub, and the legacy expense review section.
- Evidence selection rows in the Wizard.
- Shared browser fetch and preview UI.
- Local mock object integrity and PDF font runtime.

Out of scope: allowing arbitrary uploaded SVG, changing raw-signature download rules, changing attachment permissions, or resetting Docker volumes.

## Acceptance criteria

- Real PNG/JPEG and PDF attachments render without direct iframe/image navigation to MinIO/S3.
- Prepared/certified SVG renders from a Blob URL without weakening SVG download disposition.
- Issued receipt opens as a multipage PDF preview and still downloads normally.
- HTTP 404, empty bytes, unsupported MIME, decode failure, and retry are visible states.
- Approval cannot proceed merely because a broken preview button was clicked.
- All generated Blob URLs are revoked.
- Thai text is present in a PDF generated inside the rebuilt API container.
- Seeded ACTIVE preview fixtures have retrievable objects.
- Focused API/web tests, rendered PDF/image inspection, Docker rebuild, and health checks pass.

## Delivered verification

- One shared viewer now handles validated PNG, JPEG, system SVG, and PDF Blob URLs across expenses, substitute receipts, reimbursements, vendor-bill tax evidence, and international tax evidence.
- Local CSP includes `frame-src 'self' blob:` and no longer applies `upgrade-insecure-requests` when `APP_ENV=local`.
- API image `69cf56759adf` and web image `326cd9f0421e` were rebuilt and deployed without resetting volumes; API and AI gateway are healthy and web is ready.
- Local seed uploads three deterministic, retrievable versioned objects (two PNG paths and one PDF), repairs the CRM retained blob/message link, and rerunning the seed preserves the same version IDs.
- Full web suite passed 815/815; focused API preview/PDF/attachment/amount suites passed 84/84; the final preview/security suite passed 43/43; contracts and web typechecks and production Docker builds passed.
- The deployed API container also passed its seed-fixture and PDF renderer suites 10/10 with a
  measured Thai ink ratio of 2.222%.
- Latest-request lifecycle guards cover expense review, substitute-receipt wizard/hub/legacy flow,
  reimbursements, vendor bills, and trade-tax evidence. Stale responses cannot reopen a closed
  preview or satisfy a signing/approval gate.
- The shared certificate limits are enforced before prepare and before legacy issue; a worst-case
  boundary document rendered within the four-page safety ceiling.
- A runtime-generated eight-line Thai substitute receipt rendered into two readable A4 pages. Both pages, the seeded PNG, and the seeded PDF were rasterized and visually inspected.
- Interactive browser automation remained unavailable because the in-app browser runtime reported no installed browser; HTTP/CSP, storage bytes, MIME headers, rendered artifacts, tests, and container runtime were verified directly instead.
