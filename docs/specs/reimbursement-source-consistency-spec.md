# ใบเบิกคืน: ข้อมูลต้นทางและผู้รับเงินที่สอดคล้องกัน

Status: member/digital-source scope implemented and verified locally on 2026-09-10; paper/no-account beneficiary decision remains open. Owner authorization 2026-09-10. Extends the previously deferred reimbursement work; does not change the completed substitute-receipt scope retrospectively.

## Product journey

พนักงานสำรองจ่ายเต็ม → เลือกค่าใช้จ่าย/ใบทดแทนเดิม หรือแนบใบเสร็จ → ตรวจผู้รับเงินคืนและข้อเท็จจริง → บันทึกร่าง → ส่งตรวจ/อนุมัติเดิม → บริษัทจ่ายคืนครั้งเดียวตามใบเบิก. Finance may prepare for an active scoped company member using existing reimbursement.create + reimbursement.finance_review. Requester is the employee receiving repayment, never inferred from the preparer. The preparer remains separately audited. Existing own-draft permissions remain unchanged.

บริษัทจ่ายเอง/รายการจ่ายแล้ว/รายการบัญชีที่เกิดจากใบเบิก/ต้นทาง voided or posted cannot become a fresh employee claim. Digital substitute receipts require ISSUED, PERSONAL_ADVANCE and payerUserId = requester. Paper evidence must remain tied to the actual handwritten identity; never equate an uploader account or a matching name with a payer identity. Scope for people without accounts awaits the owner reply; no arbitrary recipient impersonation.

## Field ownership and consistency

| Group | Authoritative source and behavior |
|---|---|
| Company/branch/currency | Claim and every source must match. Existing tenant/actor/branch permissions remain enforced. Beneficiary selection and creation require active scoped membership; later employment changes do not silently erase an existing repayment obligation. No currency conversion. |
| Employee/payee | Active company member selected as requester; creator/submittedBy/approver/payer are distinct actor fields. Immutable requester after draft creation. Ordinary receipt sources retain existing employee ownership; digital certificate sources use the certified actual payer, even when another user prepared the expense. |
| Dates | Expense incurred date, actual store-payment date, claim submission date and reimbursement paidAt stay distinct. Do not copy any one into another. |
| Source identifiers | Linked source expense ID stays evidence identity. Claim-born projection uses existing sourceReimbursementRequestId/sourceReimbursementLineId and never overwrites source evidence. |
| Seller/document | Preserve vendor name/tax ID/branch/document number, source document type and certificate number/version/checksums in a server-created per-line source snapshot. |
| Amounts | Full one-source reimbursement only. Line amount equals supported source net actually advanced; header total is Decimal sum of lines. Prevent partial/custom override of imported source amount/date. |
| Categories/description/purpose | Imported from source where present. Explicit editable claim classification/purpose remains distinct and enters approval hash. Source descriptions/categories remain retained. |
| VAT/WHT | Preserve every source total, tax status and line tax snapshot. Do not turn a certificate into tax approval. Retain existing gross/nonclaimable claim projection policy for supported sources, preserving each original category/account hint as a gross cost line. Source costs must reconcile exactly with the claim amount. WHT-bearing or claimable/unresolved tax cases must fail with an actionable review reason before projection; do not erase a tax liability or lower original cost to net cash. Broader tax-engine changes are outside this feature. |
| Evidence | Active attachments must match company/branch/source. Resolve expense-linked files to their source, so uploading/selecting a sibling file cannot bypass source eligibility. Bound ambiguity; never choose the first of multiple unrelated sources. |
| Signatures/versions | Draft refresh is explicit and clears claim signatures if financial/evidence facts change. At submit, bind source facts into approval hash; later steps verify exactly those retained facts. Source change requires return to draft/review, never silent reapproval. |

## Lifecycle and transaction contract

- Source selection returns safe facts, eligibility/reason and expected source revision under reimbursement permissions; no Expenses entitlement required for the standalone claim journey.
- Create/update resolve and validate source facts at the server. Persist additive nullable sourceExpenseSnapshotJson and attachmentSnapshotJson on ReimbursementLine. The latter retains uploader/checksum for a file finance validated while preparing for the employee; an employee may retain that file without impersonating its uploader. Existing rows remain readable; do not fabricate legacy provenance.
- updatedAt is the draft source-selection revision token. After submit, compare retained business/evidence facts; a background timestamp update alone does not invalidate approval.
- Refresh fetches the exact selected expense again under the same eligibility/permission rules, independent of search text or the source list limit. Update source-owned facts; retain a purpose/description/category explicitly edited by the preparer. Unlinking removes source identity, facts, files and imported values together.
- Reuse lockFundingEvidence on source and claim boundaries, including attachment aliases, before source checks and submit. Validate current source under the same transaction as submit, approval/finance projection readiness and payout. Keep existing request lock order and idempotent payment boundaries.
- Reuse duplicate guards; same source or related file in another nonterminal claim blocks. Drafts/rejected/cancelled/voided can be edited/reused as existing policy allows. PAID still consumes the source. Different rows in one claim cannot consume one source twice.
- Submitted source is frozen against ordinary expense edits/receipt removal/payment/receipt revision until the claim returns to a terminal editable state; exact source snapshot checks also fail closed if another writer bypasses that guard.
- Projection remains a separate employee payable with source facts retained in metadata. No double recognition on original expense, no duplicate attachment primary ownership, and no resetting actual company payment on document-only corrections.
- Gross source cost lines preserve original account/category hints and charge kinds. Service charges and negative rounding remain separate from goods subtotal and reconcile with the supported source net/claim amount.
- Preserve approval routing, policy snapshots, CC2 standalone authority, period/tax locks, audit/outbox and payment reversal semantics. Do not change production quiesce/deployment controls.
- Approval/signature hashes include retained source and attachment snapshots. The A5 read-only classifier consumes these and the existing policy snapshot using JSON row extraction compatible with databases where additive columns are absent. Legacy V1 fallback must reject a row carrying newer facts/policy; it cannot bypass current evidence checks.

## UX and errors

The create/edit page offers existing expenses as a source, preloads supported fields and shows original document/payer/payment facts. Imported amount/date are read-only until unlinking; changing claimant/branch resets the source picker. Show why unavailable sources cannot be selected. Detail, claim form and evidence export expose the same source reference and facts. Errors keep typed data, require explicit refresh for stale sources and never show success for a blocked claim. Use existing theme and confirmation patterns.

## Acceptance

1. Member can import their issued PERSONAL digital certificate even when another user prepared the expense; company-funded and wrong-payer sources reject.
2. Finance creates for an active in-scope member; self-only actors cannot choose others. Beneficiary and preparer are correctly displayed/audited.
3. Cross-tenant/branch/currency, inactive members/files, ambiguous attachment source, company-paid/posted/voided/claim-born source reject.
4. Full amount/date/source identity tampering and WHT/claimable/unresolved-tax handoff cannot silently pass.
5. Duplicate source, same primary/sibling file and concurrent submissions produce one effective claim; source edit/submit races cannot yield a stale approved claim.
6. Changing source facts invalidates draft review/signature; submitted versions remain pinned through approval, finance and payout.
7. Projection preserves source seller, references, complete totals/tax/evidence metadata, with no original payment or duplicate expense side effect.
8. Existing manual receipts and old claims still work with original permissions, signature and payout idempotency. No package.json/dependency change.
9. Focused unit/PostgreSQL checks and browser new/edit/detail paths demonstrate success, denied/stale/error behavior. Keep evidence in task memory.

## Beneficiary boundary — owner decision 2026-09-11

Note 2026-10-05: the owner now wants claims to be repaid into the account of a person outside the company ("เพิ่ม บัญชีใครก็ได้ได้ ที่ไม่ได้อยู่ในระบบได้ บางครั้ง ต้องเบิกคืนคนที่ไม่ได้อยู่ใน บ"). [The multi payout accounts spec](reimbursement-multi-payout-accounts-spec-th.md) does that for the DESTINATION: the requester picks another person's account and the approver accepts it. The boundary below is unchanged for the SOURCE: a substitute receipt or an expense whose recorded payer is someone else still cannot be claimed by another requester (`reimbursement_source_wrong_payer`, `reimbursement_source_payer_unlinked`). A reviewed payer binding for outsiders is designed in [the proposal](reimbursement-recipient-bank-account-spec-th.md) §4.4 and is not built.

Paper substitute receipts currently retain handwritten names without an authoritative payer account link. They return `reimbursement_source_payer_unlinked`; the UI must explain the missing verified link. This implementation does not create an external payee, match by name, or treat the uploader as the recipient. The owner chose to handle external/no-account payee reimbursements outside the system; keep only facts the existing flow can record. Do not add an external-payee journey or invent an identity link. Creating an account alone does not retrospectively prove handwritten payer identity.
