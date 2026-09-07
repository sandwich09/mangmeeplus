# Receipt reliability and draft continuity

2026-09-08 amendment: [Receipt UX and rejected reapplication](line-receipt-ux-signup-reapply-spec.md) supersedes automatic receipt questioning and terminal-rejection dead ends. Capture, permissions, audit and final-mutation boundaries remain.


Status: Authorized for implementation, 2026-09-07. Runtime rollout is separate from merging this change.

Owner: Product owner; coordinating agent with GPT-6 Astra / GPT-5.6 Sol at xhigh as requested.

Sources: [incident](../agent-memory/line-receipt-zero-price-diagnosis-2026-09-07.md), [review and T01–T18](../research/line-receipt-reliability-ux-review-2026-09-07-th.md), existing expense receipt upload, LINE expense draft conversation, LINE conversation reliability, receipt additional charges, and company OCR governance specs.

## 1. Outcome and scope

An entrepreneur sends a receipt once, can see whether its image/draft is saved, receives all currently missing user-supplied facts together, and can leave and finish the SAME draft through LINE or the web. Older users need ordinary Thai words, visible actions, and preservation of work without remembering question codes. Saving an incomplete draft never confirms, approves, pays, posts, or exports it.

This increment remedies P0-1–P0-3, P1-1–P1-6, P2-1 and A1–A8 in the review. These are 18 traceable acceptance entries, not independent root causes. No production customer data repair, quota refund to named customers, deployed flag mutation, or deployment is part of the requested Git delivery. Dedicated conversation/outcome feature defaults remain gated until their required live acceptance.

## 2. Receipt intake and truthful delivery

1. A printed zero-priced item is a valid monetary fact. Unknown, malformed, infinite, and NaN amounts must never be persisted as a number or silently represented as zero. Preserve the existing decimal/quantity/tax rules.
2. Persist provider input identity with the durable capture as early as the existing upload boundary permits. A retry of an existing event/message must recover that record and attachment, not create another record. Preserve tenant/branch and unique constraints.
3. Distinguish captured image, saved draft, OCR application, and notification delivery. Only a committed stage authorizes the corresponding Thai success claim. An error sending the final LINE result cannot replace a saved result with “processing failed; send again”.
4. Use the existing terminal outcome and orphan recovery infrastructure. Pending delivery retries the same result; it cannot rerun business mutation or OCR. Preserve successful payload on transient fallback and keep event/outcome state coherent. Retryable and permanent failure must not be conflated.
5. Push retries use the same supported LINE retry key from the FIRST push of one logical payload/recipient, including reply-to-push fallback. Preserve reply API semantics and distinguish API acceptance from device delivery/read. Do not add retry headers to unsupported operations.
6. Same provider event and a new message containing a similar receipt are distinct cases. Use existing checksum/perceptual/OCR candidate machinery within the same company. Resolve an exact stored capture where proven; otherwise show the existing duplicate review path. Do not merge different receipts solely by amount/date/vendor similarity.
7. Notification retry and retries of the same admitted receipt must not consume a second customer OCR admission. Record actual provider cost truthfully. Reuse the existing admission/compensation primitive for pre-usable-result system failures if available; do not invent a broad billing/refund service. Any necessary policy/contract extension must state the immutable operation identity and exactly-once accounting. A new, unproven image is not automatically entitled to a refund. No retroactive customer usage edits.
8. Record stage, bounded operation references, safe error class/cause/provider status sufficient to diagnose failures. Avoid raw Prisma request bodies, receipt text, tokens, and raw media in operational logs.

## 3. One durable draft, preserved financial facts

1. Reuse ExpenseRecord and its existing staged continuation metadata. ExpenseLine continues to hold only valid financial rows. Unknown staged quantity/price is absent/null, not a fabricated 1/0.
2. Updating purpose/vendor/date, pausing, selecting, resuming or accepting no fields must not replace financial rows or change monetary/tax values. A field/row change is constrained to the actual accepted facts.
3. Preserve existing line identity, charges, discount, tax treatments, tax snapshots, WHT and reviewer decisions. A replacement built from a lossy OCR projection is forbidden. If a materialized row cannot be safely matched, retain it and require an explicit reviewed edit rather than deleting it.
4. Preserve all currently supported OCR items (up to 40) across capture, persistence, questions, web editing and resume. Message size/display limits cannot become storage truncation. Bound invalid/oversized inputs explicitly; never silently discard accepted rows.
5. On web edit or another turn, stale LINE writes fail closed. Explicit resume then refreshes from the current stored facts/revision and recomputes questions, retaining unresolved staged facts. Merely bumping an old snapshot's revision before writing it is forbidden. Concurrent writes still require CAS.
6. Explicit draft ID resolution uses scoped lookup, independent of the bounded recent list. Recent 5 items is a discovery UI choice, not the lifetime of older drafts.

## 4. Complete questions and save for later

1. Ask ALL currently missing user-supplied facts in the same response cycle, grouped by document/item. Accept combined or partial replies. Already known facts must not be asked again. Do not require question codes; retain stable internal IDs and optional labeled input.
2. “บันทึกไปก่อน”, “บันทึกไว้ก่อน”, “เดี๋ยวไปแก้ในเว็บ” and existing pause phrases mean retain current draft/image, stop collecting questions, show a direct link/action for the same scoped draft. No financial finalization is implied.
3. Silence produces no message, deletion, finalization or reminder. Unrelated tasks proceed without treating their text as receipt answers or repeatedly appending old receipt questions. Existing routing/context rules remain authoritative for disambiguation.
4. Replies name the current draft/shop and distinguish known total from incomplete total. “เก็บร่างแล้ว ยังไม่ยืนยันรายการ” must be truthful. Large question sets must remain accessible together without silent payload truncation or post-commit send crashes.

## 5. Web/API contract and authority

1. The web must show the original image, current stored facts, incomplete staged rows, and all missing facts, with a visible save-draft action that works before final completeness. Existing strict review/finalization checks remain at their actual workflow boundaries.
2. Reuse the existing draft update/detail paths where possible. If partial source input requires a distinct request shape, add one narrow validated `sourceDraft` contract to existing expense contracts and update flow, with expectedUpdatedAt required. Provide a safe read projection in ExpenseDetail; do not expose chat identifiers, raw provenance or internal sourceChannelMetadataJson wholesale.
3. Partial source edits contain ordinary source facts (document date/vendor/purpose and item description/quantity/price/category where the existing collection permits), not reviewer-only tax/accounting/final fields. Empty incomplete values are staged. Malformed supplied values, unknown item references, inactive categories, stale revision, and cross-tenant/branch references fail closed.
4. Existing reviewers retain their permissions. The originating user with existing upload/create capability may fill ordinary source facts on their own mutable LINE receipt draft through web as they may through LINE, after active membership and branch checks. This does not grant general expense review, tax, account, approval, payment or posting permission. Hide/replace an action if its authorized endpoint is unavailable; do not offer a dead-end web link.
5. Both channels use the same staged facts/completeness semantics. Saving via web updates the collection projection/revision atomically or causes a safe refresh; missing-field labels and clearing must agree. Saved partial values survive reload. An incomplete staged collection prevents transition to financial confirmation through every entry point.
6. Preserve existing web editing for materialized rows and charges. Partial source-save cannot silently clear financial fields that are absent from its payload. Header-only edits remain header-only.
7. An explicit reviewer financial-row replacement carries existing row IDs where available. Validate them within this company/expense and reject foreign or repeated IDs. Deleting a proven bound financial row removes only that staged counterpart; unrelated unmaterialized source facts remain. A legacy READY record with incomplete source facts must have a visible correction path through the existing review save, reopening NEEDS_REVIEW before partial editing.

## 6. Acceptance and rollout evidence

T01–T18 in review §13 are the acceptance inventory. Add permanent focused regression tests that fail on the diagnosed behavior and pass on the fix; test actual use-case composition and repository boundaries where the original unit coverage missed data loss. Include failed delivery after commit, duplicate retry, unknown/free prices, discounted/charged/mixed-tax receipts, 20/21/40 items, web partial save/reload/resume, concurrent revisions, save-for-later/unrelated routing, own-upload role and revoked/cross-scope access.

Before accepting the PR: relevant tests, contracts/API/web typechecks/build checks, available local DB/browser integration and CI pass, or each external blocker is recorded precisely. Review UX/entrepreneur accessibility, transaction architecture, business rules, AI boundaries and sibling callers. No claim of live OA/UAT/production acceptance without the corresponding artifact. Merge authorization does not itself satisfy live runtime flag gates.
