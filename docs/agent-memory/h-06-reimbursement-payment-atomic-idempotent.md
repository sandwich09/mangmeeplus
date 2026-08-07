# Agent Memory: H-06 Reimbursement Payment Atomic and Idempotent

Status: Complete locally
Owner: Codex
Scope: Reimbursement finance record-payment mutation, durable payment idempotency, request totals/status, source ref, and document-number retry finalization.
Decisions:
- Keep the existing document-number reservation primitive; make its key stable from the payment attempt and recover an uncommitted reservation on retry instead of duplicating sequence logic inside reimbursement.
- Derive the server fallback attempt key from company, reimbursement request, and server-owned request `updatedAt`; optional validated client keys remain supported, but caller `paidAt` never defines idempotency.
- Put policy/duplicate/payment revalidation, payment/source-ref creation, totals/status update, per-request advisory lock, and request-version CAS in one Serializable repository transaction.
- Backfill legacy payments and enforce unique `(companyId, idempotencyKey)` at the database boundary.
- Keep existing UI because it already disables repeated submit, retries the same form facts, and renders API errors; the API remains authoritative.
- Preserve concurrent H-07/procurement and ledger work in the shared workspace and exclude it from the H-06 commit.
Open questions: None.
Artifacts: reimbursement use case/repository/model/schema migration/tests, reimbursement spec/plan, security remediation checklist.
Verification:
- Focused reimbursement finance/H-06 suite passes 15/15.
- Full API regression from the isolated staged H-06 snapshot passes 2,084/2,084.
- Deterministic two-request race creates one payment; create, source-ref, CAS, CAS-conflict, and readback faults roll back, then retry creates once.
- Retry after ambiguous transaction commit and document-number commit timeout returns the recorded payment without a second payment/number commit.
- API typecheck and Prisma schema validation pass.
Next: Deploy the migration with backup/restore rehearsal, then run the authorized concurrent-payment retest against the immutable release artifact.
