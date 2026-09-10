# Cancelled substitute receipt and reimbursement printing

Owner request: 2026-09-10. Cancelled documents must be unmistakable when printed, with a formal central watermark and the recorded cancellation reason below the document content.

## Presentation and acceptance

- Use Thai `ยกเลิก` above `CANCELLED`, bold Noto Sans Thai / sans-serif, dark red `#991B1B` at 18% opacity, angled upwards 30 degrees through the page centre. This is a product design, not a claim of a prescribed statutory template.
- Repeat the watermark on every derived PDF page, including paper scans and attestation pages. Preserve legibility and original document facts/signatures.
- Add a bordered rectangular box below the final content: `เหตุผลการยกเลิกเอกสาร`, the full recorded reason, and `เอกสารฉบับนี้ยกเลิกแล้ว ใช้เพื่อการอ้างอิงและตรวจสอบย้อนหลังเท่านั้น`. Dark red heading/border, very pale red fill, near-black reason. Wrap Thai and long text; never truncate or cover a signature. If a retained scan or a full page has no known free space, append a cancellation detail page identified by the document number.
- Substitute receipts: all SUPERSEDED retained representations, including expense-voided and replaced versions, receive this presentation. Map system reasons to Thai wording; preserve original state metadata and file naming. Use retained snapshots/files only.
- Reimbursements: only completed CANCELLED requests receive it. Pending cancellation, rejection and active requests must not be marked cancelled. Use the persisted cancellation reason, not the expense purpose or payment void reason. Existing requirement for an assigned request number remains.
- Legacy records without a reason explicitly say `ไม่ได้ระบุเหตุผลการยกเลิก`. Do not invent a reason or signer.
- Existing preview and print/download share the decorated representation. Stored originals and checksums, read permissions, cancellation rules and accounting effects remain intact. Receipt attachments are evidence, not cancelled claim forms.

## Implementation plan

1. Reuse a small shared SVG presentation helper for the motif and wrapped reason box.
2. Decorate derived substitute PDFs after composition, adding the reason in known whitespace or a detail page; pass cancellation facts through all retained-content paths.
3. Pass cancellation facts to the reimbursement SVG renderer and reserve space below signatures.
4. Verify both status mappings, all retained substitute paths, long/escaped/missing reasons, unchanged active documents, multipage stamping and original scan preservation. Render representative PDFs and inspect the output.

No schema, permission, dependency or package-script change is required.

## Multi-page claim follow-up (authorized 2026-09-10)

- All printable reimbursement states paginate at readable A4 width. Long content continues on another page rather than shrinking the complete document onto one page.
- Repeat document identity on each page and table headings wherever item rows continue. Keep normal rows together; exceptionally tall rows continue without dropping text or repeating the monetary amount. Totals and approval/signature blocks occur once. The cancellation reason appears only after the document content.
- Keep the cancellation box together at the end of the final page. If the remaining space cannot hold it, use a new final page. If the reason itself is taller than a full page, continue its complete text in labelled reason blocks on the final sheets without shrinking it. Apply the cancellation watermark independently to every page. Active/rejected/pending-cancellation requests remain unmarked.
- Preview, browser print and downloaded PDF consume the same ordered page array. A single-image legacy response remains readable during rollout. Wait for every preview page before enabling Print; failures/retries must not acknowledge a partially loaded document.
- Extend the existing browser PDF writer to accept ordered page images, reuse existing image loading and PDF encoding, and rasterize pages sequentially. No new rendering dependency or API storage mutation.
- Verification includes long/multiple rows, one very tall row, long reasons, normal/signed/cancelled states, final-box overflow, exact line/amount coverage, per-page watermark, PDF page count, page-loading failure/retry, print CSS and mobile/desktop preview. Merge the completed scoped changes to develop and main after focused checks.
