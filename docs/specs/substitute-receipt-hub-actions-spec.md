# Substitute receipt hub actions

Owner decision: 2026-09-10. Replace the actions column with a themed ellipsis menu on desktop and mobile: Edit, Print, View, Cancel document. Print the representation appropriate to the document state. Cancellation requires two explicit confirmations.

## Journey and acceptance

- The menu opens outside table/card clipping, stays inside the viewport, supports keyboard navigation/Escape/outside click, and restores focus. Labels remain explicit; destructive cancellation is red.
- Edit continues the existing wizard for an active document where the actor can work on it. View opens a read-only document preview for every state; unavailable historical content gives an actionable error. No fabricated reconstruction of old documents from current expense data.
- Cancelled documents opened in the wizard are view-only: no prepare-revised-version action, source-edit shortcut or signing form, including after focus refresh. Read-only details/evidence navigation, history and available document reads remain accessible. This owner decision (2026-09-10) replaces the earlier cancelled-page revision CTA; a new document may still be started from an eligible expense under existing rules.
- Print opens the same state-aware preview with printing/download available. PREPARED paper without submission yields the blank signing form; PREPARED online yields an unsigned preview; PAYER_CERTIFIED yields the actual certified artifact marked awaiting approval; submitted paper yields the actual scan marked awaiting review; ISSUED yields the complete stored artifact; SUPERSEDED yields retained content marked cancelled/superseded. Records without sufficient retained printable content explain why printing is unavailable.
- Printing does not sign, approve, accept, pay, or mark the signing review complete. Paper form freezing may retain its existing internal snapshot behavior. Preserve server read permissions, tenant/branch scope, checksum checks and audit.
- Cancel first asks for a nonempty reason and shows the document number/effect. A second themed dialog repeats the number and reason before any mutation. Cancel/Escape/backdrop at either stage makes no cancellation request. Disable double submission. Use existing supersede API with expected evidence revision; show stale/permission/state errors and refresh after success.
- Cancellation retains historical files; does not delete the expense or reverse payments/accounting. Existing source status, correction and live-claim restrictions stay authoritative. Issued/confirmed records requiring correction cannot bypass that boundary via this menu.

## Implementation plan

1. Reuse PopoverPanel, Modal, useConfirm, existing wizard links and supersede mutation; avoid a new dependency.
2. Extend the existing authenticated PDF read path with state-aware rendering while keeping issued delivery composition strict. Reuse current PDF rasterizer and scan composer; stored originals remain unchanged.
3. Expose existing source/correction state needed for menu availability in the list contract; no schema migration.
4. Verify state rendering, access/checksum/history behavior, no signing/payment effects; browser-test desktop/mobile menu, both confirmation exits, success/error and preview/print.

## Integration details

- Assigned certifiers/approvers retain the wizard action even without expense.review; this does not grant cancellation rights.
- Download uses the existing PDF data-URL contract, decoded into a revocable Blob URL so the content-security policy does not block data-URL fetches. Printing waits for every page and isolates document pages from application chrome.
- Unavailable retained content and certified checksum mismatches have stable localized error codes. No fallback to current expense facts for cancelled history.
