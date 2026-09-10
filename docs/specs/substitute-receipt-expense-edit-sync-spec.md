# Substitute receipt synchronization after expense edits

Owner decision: 2026-09-10. A reviewer can edit the source expense and return to step 3; no manual cancellation or document recreation is required. Both online and paper signing use the latest reviewed data.

## Journey and acceptance

- Before any signature or paper submission, saving the expense refreshes the prepared evidence and invalidates the previous printable form/preview. Keep its document number and signing method.
- After a signature, paper submission, or issuance, saving a permitted expense edit supersedes the old evidence and prepares the next internal revision automatically with the same document number. Keep the old snapshots, signatures, scans, artifacts and audit trail. The current revision contains no signatures/scan/review acknowledgements and must be signed and approved again.
- Existing links to superseded evidence lead the wizard to the current revision. Old artifacts remain identifiable as superseded.
- Step 3 allows back navigation to source data/evidence and back to signing. Editing source data opens the existing expense review page. Signing-method changes still use the existing explicit cancellation workflow.
- Downloading an unsigned form and online preview render latest expense dates, item details, amounts and current seller data. Explicit substitute-only fields (reason, business purpose, payment date/method, funding source and signer) retain their values unless the corresponding expense field was actually changed.
- A stale preview cannot be signed. A paper upload is bound to the form revision present when upload was initialized; expense edits invalidate that revision. The UI asks the user to print and sign the latest form. The system does not infer handwritten document contents automatically.
- Paid/posted source amounts are not rewritten by document refresh, and re-issuance must not create another payment, tax event or journal entry. Existing source-edit permission and status restrictions remain authoritative. Financial changes to already paid records require their existing correction/reversal flow.

## Architecture and smallest plan

1. Reuse expense review CAS transaction, existing evidence versions, superseded status, correction linkage, retained artifacts and audit log; no schema/dependencies/new numbering allocation.
2. Opt in from the permission-checked expense review save only. Generic OCR/system updates must not reset signed documents.
3. Serialize with existing funding/substitute locks. Update source, lines and refreshed evidence in one transaction. Unsigned snapshots are invalidated; signed evidence is preserved in its old row.
4. Reuse correction settlement bypass for previously issued evidence; verify previous approval identity and company identity. Continue preserving retained source attachments.
5. Verify source-to-artifact dates/amounts, signed invalidation, stale paper/online payload rejection, paid reissue, history links and back-navigation in focused tests and local browser.
