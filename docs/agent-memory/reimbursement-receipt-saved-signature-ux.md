# Agent Memory: reimbursement receipt and saved signature UX

Status: Complete
Owner: Codex
Scope: Reimbursement draft submit guidance/readiness and claim-form signing with the existing saved signature feature.
Decisions:
- Treat the server-owned `receiptRequirementStatus` as the submit readiness signal; `REQUIRED` disables submit and
  directs the requester to attach receipt evidence.
- Use only the eligible signer's latest `ACTIVE` saved company signature; preserve historical rendering after the asset
  is later archived by resolving the already-recorded attachment through its original owner.
- Keep legacy claim-signature upload endpoints for compatibility, but remove that upload step from the main web flow.
- The missing-signature modal primary action is exactly `ไปหน้าลายเซ็น`.
Open questions: None for the scoped implementation.
Artifacts:
- `docs/specs/reimbursement-approval-spec.md`
- `docs/plans/reimbursement-approval-plan.md`
- Reimbursement API/web implementation and focused tests.
Verification:
- API claim-signature use-case: 23 passed.
- API saved-signature repository ownership: 3 passed.
- API reimbursement request + DTO regression: 36 passed.
- CI follow-up: related-view, saved-signature, and spec-suite coverage passed 37 tests; the full API suite passed.
- Web reimbursement/expense model tests: 68 passed; reimbursement logic regression: 44 passed.
- `apps/api`: `pnpm typecheck` passed.
- `apps/web`: `pnpm typecheck` passed.
- Launch error-code coverage recognizes `claim_saved_signature_required`; the broader coverage test remains red only for
  pre-existing unrelated working-tree code `expense_review_forbidden`.
Next: Ready for UAT; no deployment was requested or performed.
