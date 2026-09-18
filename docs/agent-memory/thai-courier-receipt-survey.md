# Agent Memory: thai-courier-receipt-survey

Status: Courier research, CC01–CC10 and owner-approved NR01–NR09 documentation finalized for delivery through develop PR #643 and main PR #644; authoritative merge state is in the linked PR records. Paired document checks PASS. Application implementation, live AI/LINE/UX validation and deployment remain outside this documentation delivery.
Owner: Codex / root
Scope: Buyer-side Thai courier receipts and expenses through existing LINE AI, upload and replacement; short/full/electronic documents, UX40+ and eligible substitute-receipt continuation.

Decisions:
- LINE non-receipt reply follow-up (2026-09-18): source-read `formatBusinessDocumentReply` already distinguishes quotation/PO/delivery note, check bill, booking and non-financial image; courier label/deposit note has no dedicated copy and may reach generic missing-total/reference replies depending on classification. Do not report it as OCR failure when classification succeeded. Generic reference handling does not call `ensurePendingMedia`, so do not promise saved-file/same-work continuation for all non-receipts. The existing check-bill branch has a separate persisted payment-choice continuation. Invoice/bill, transfer slip and marketplace order remain potentially eligible expense evidence under `isExpenseExtractionEligible`; absence of a receipt/tax-invoice title is not a blanket rejection. User approved recording the refinement in spec/plan; implementation and runtime tests remain pending.
- Approved NR01–NR09 cover document-specific copy/actions, purpose/permission-bound pending persistence, same-work Web/manual continuation and proof append, check-bill reuse, no placeholder expense, no automatic certificate, plus unknown/non-business/read-failed separation. Append/replace must describe the actual existing record/attachment state; combined documents are assessed by evidence rather than rejected by heading. D02/D06 and W00–W08 reuse scope remains unchanged.
- Reuse v0.11 W00–W08 and existing recovery/review handlers. CC cases are proposed regression additions, not new brand-specific workflows or completed runtime acceptance.
- Separate receipt/tax invoice/temporary receipt/invoice/label/deposit note; paper width and PDF container do not determine tax kind. Separate legal issuer, agent, sender, recipient, buyer and payer.
- Multiple parcels can form one receipt; summary/detail pages repeat totals. COD goods principal, declared value and net settlement are not freight fees. Do not auto-mark invoices as paid or hardcode courier VAT treatment.
- Later full/electronic receipt must preserve original relations and prevent repeat expense/claim/payment; tracking alone cannot deduplicate extra charges or corrections.
- Keep the user's terminal reading failure decision: only when file persistence is confirmed, show saved status and “กรอกข้อมูลต่อ” to the same Web work. No reread CTA, new chat manual-entry flow or automatic substitute certificate. Pending-before-expense remains an implementation gap.
- Checked seven providers; catalog contains 11 document records, nine visual and two text-only. Seven public transaction copies are unauthenticated; four records are guide examples. KEX one guide page has three document types, DHL two pages form one specimen; neither page count is a receipt transaction count.
- Newest visually inspected actual transaction copy is THP 2026-02-23. KEX guide specimen is 2024-11-22; DHL guide specimen is 2018-10-08 despite modified metadata in 2026. No claim of latest complete coverage or verified signatures.
- Read the PDF skill and rendered selected public PDF pages for inspection. SPX's official-site-linked request form was read without entering or submitting data; browser account details were not copied into artifacts. AnyFlip's browser challenge was not bypassed; its two Flash records remain text-only.

Open questions:
- Need authorized current full specimens for THP/KEX/Flash, actual documents for J&T/SPX/SCG, current DHL transactions, genuine temporary/full pairs, credit/monthly documents and originals for D09 verification.
- D02 must decide whether existing manifest/evidence can hold shipment references and relations before changing contracts. Public specimen availability is not model-training permission; D05/D08 remain applicable.
- Current 10 MiB/multipage and pending-to-Web requirements are planned, not implemented by this survey. VAT/tax eligibility and reimbursement follow existing policy decisions, not logos or historical templates.

Artifacts:
- v0.11 documentation delivery: [develop PR #643](https://github.com/MangmeeDev/mangmeeplus/pull/643) and [main PR #644](https://github.com/MangmeeDev/mangmeeplus/pull/644) contain the same nine scoped documentation files. GitHub records retain the exact final reviewed heads, merge outcomes and merge commits. The user explicitly authorized admin merge without waiting for CI on 2026-09-18; no deployment is dispatched.
- [Research](../research/thai-courier-receipt-survey-2026-09-18-th.md)
- [Source/specimen catalog](../research/thai-courier-receipt-survey-2026-09-18.json)
- [Spec §18](../specs/marketplace-buyer-expense-capture-spec-th.md)
- [Plan §12](../plans/marketplace-buyer-expense-capture-plan-th.md)
- Read-only scratch PDF renders in `/tmp/mangmee-courier-survey-20260918/`; not deliverables or licensed model fixtures.

Verification:
- Non-receipt follow-up PASS (2026-09-18): `python3 /tmp/check-mangmee-non-receipt-replies.py` verifies 9 reply cases, spec/plan/catalog mapping, persistence/reuse flags and two existing test paths (not executed). Courier checker PASS with 218 local links/118 line targets; baseline v0.11 checker PASS with A88/IG29/E27/D9/W9 and 221 links/121 line targets; scoped `git diff --check` PASS. Source references checked; no application/LINE/browser/AI/UX test or code changes for this documentation turn.
- Visual records: C01–C08 and C11; text-only C09–C10. Local PDF renders: KEX page 21, DHL pages 23–24. THP short/non-VAT plus taxable packaging, Kerry discount, KEX fuel and DHL repeated-total arithmetic reviewed.
- Source/contract review only: receipt kinds, per-line VAT/charges, apply reconciliation and prior handler audit. No courier runtime bug reproduction, application tests, AI accuracy eval, signature validation or usability test. Earlier API29/Web54 evidence remains separate.
- PASS `python3 /tmp/check-mangmee-courier-20260918.py`: 7 providers, 19 sources, 11 records (9 visual/2 text-only), 10 CC mappings, 12 Decimal equalities, 214 local links/114 line targets/9 anchors. Checks include IDs/provider references, dates, table columns and same-work recovery flags.
- PASS `python3 /tmp/check-mangmee-retail-v011.py`: unchanged A88/IG29/E27/D9/W9 baseline, 217 local links/117 line targets/9 anchors. Scoped `git diff --check` PASS; the courier checker also checks whitespace/newlines in new untracked research files. These commands validate documentation, not application behavior.

Next:
- Research and documentation verification are complete for this survey; latest complete specimen coverage remains open. Preserve unrelated dirty workspace changes. Collect authorized current evidence in W00, then implement and verify only missing behavior through W01–W08.
