# Substitute receipt edits and immutable numbers

Owner-approved rules, 2026-09-10. Supersedes automatic monthly renumber/reuse. Implement on existing codex/substitute-step3-edit-20260910 and PR514/515; merge develop/main after passing checks. No deploy in this scope.

## Product and acceptance

- Focus actual payment date, not expense date. Expense date remains independent. COMPANY recorded payments and PERSONAL_ADVANCE employee-to-vendor payments remain distinct from company reimbursement.
- An assigned document number is immutable across date/month/year, branch and numbering-template edits. Editing never reserves/releases/reassigns numbers. New creation selects any valid payment calendar date and allocates from that period.
- PREPARED/PAYER_CERTIFIED certificates on editable expenses can be edited from either journey. Source page displays certificate payment facts and returns to the same certificate editor; editing these facts does not create or rewrite a recorded payment.
- Same-month date edits need no popup. Changing month/year prompts with the previous and proposed dates and the unchanged number. Accept changes only the local draft; final Save persists it. Cancel/Escape/close retains the prior date and unrelated fields. Each newly selected month must be accepted; confirmation is bound to the submitted date/revision. API also requires explicit acknowledgment for a cross-month amendment.
- Exact popup: title **ยืนยันเปลี่ยนวันที่จ่ายเงิน**; body **วันที่จ่ายเงิน: {oldDate} → {newDate}**, **เลขเอกสารคงเดิม: {documentNumber}**; only buttons **ตกลง** and **ยกเลิก**. No extra instructions.
- Editing ISSUED certificates or financial facts linked to recorded payments/accounting is rejected consistently from both surfaces. Route to explicit certificate cancellation and the relevant payment/reimbursement/accounting cancellation first. Cancelling a certificate never reverses money implicitly. Nonprinted review metadata and no-op saves must remain available, so confirmation cannot deadlock on taxpayer classification.
- Unsigned changes retain ID/number and invalidate the old printable snapshot. Signed/submitted changes preserve the old signed artifacts and start an unsigned internal revision with the same number, requiring fresh signatures/approvals. No-op changes preserve signatures. No automatic replacement logical document.
- Explicit cancellation/new creation offers prior facts for review, including the payment date, without reusing signatures, approvals or payment mutations. Retain original payment facts when already recorded. Historical/cancelled versions remain clearly identified; old links resolve within their own revision lineage.
- Shared purpose/reason are synchronized atomically. Source owns vendor identity, expense date, items/totals/tax; certificate owns actual payee and payment certification. A separately entered payee must not be overwritten by vendor changes. Matched identity updates are a group; do not invent a missing address or buyer TIN.
- Source changes and certificate refresh commit together under existing locks/CAS. Conflict, failed save, repeated request, stale preview/upload and concurrent signing cannot partially update or duplicate payment/document/number.
- Form/preview uses current reviewed facts. Historical signed files remain in history. Signing is bound to the current revision; the system cannot infer the contents of an old handwritten scan. Existing print-by-status and immutable history safeguards stay in place.
- Lists/exports use actual date fields, never derive the payment date or reporting period from the displayed SRC number.

## Implementation plan

1. Remove the edit-time allocator and reuse existing unsigned/signed revision helper. Keep canonical allocation for new creation only.
2. Enforce final/financial edit boundaries in the shared repository transaction and amendment API; preserve unrelated metadata/no-op behavior.
3. Reuse themed confirmation modal, existing amendment DTO/API and revision checks. Expose the same editor from source, display canonical certificate payment date, correct stale number-related helper text, and carry cancelled draft facts forward.
4. Update focused PostgreSQL tests for immutable numbers, month/year changes, signed history, conflicts, atomic rollback, cancellation, paid/posted restrictions and no sequence consumption. Verify mobile/desktop source↔certificate edit/save/download and dialog cancellation.
5. Diagnose previous CI LINE whole-chain failures; fix root cause/accurate fixtures without weakening production validation. Run required CI and merge existing PRs only when green.

## Architecture and verification boundaries

Reuse permission/branch checks, funding locks, revisionOfEvidenceId, CAS and retained artifacts. No new dependencies or payment reversal endpoint. Existing additive migration for revision linkage and PREPARED/SUPERSEDED incomplete facts remains in the PR. Do not change package manifests. Record commands/results and any browser limitations in task memory.

## Cancellation gap found during verification

Issuance may record COMPANY payment while the source still needs review. Previously void required CONFIRMED, so cancellation-first could strand a paid incomplete expense. Extend the existing authorized true-reversal operation (no new endpoint) to unconfirmed sources with recorded financial state; empty unpaid drafts remain excluded. Preserve existing company/branch/expense.void permission, active-claim exclusions, period checks, transactional CAS, payment/journal reversals and audit. Claim projections use reimbursement cancellation. Retire active certificate revisions and their immutable number on source void, including numbers owned by an earlier internal revision. Expose the existing void dialog from source without requiring users to confirm incorrect data first.
