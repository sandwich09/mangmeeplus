# Agent Memory: H-05 Money Input Validation

Status: Complete locally
Owner: Codex
Scope: Accounting document/payment HTTP runtime validation and use-case business invariants for user-entered money.
Decisions:
- Scope the confirmed finding to `accounting-documents`, where the exploitable negative payment/document paths and acceptance evidence point.
- Reuse the global ValidationPipe with concrete nested DTO classes, plus one Decimal-based domain guard reused by document/payment use cases.
- Keep item-08 currency policy THB-only: money scale 2, quantity scale 4, and 14 integer digits to stay inside Decimal(18,4).
- Keep overpayment behavior from the source spec: allocate only outstanding and preserve the excess as unapplied credit.
- Do not modify or stage concurrent H-04 reversal work present in the shared workspace.
Open questions: None.
Artifacts: accounting money validator/DTOs/controllers/use cases/tests, accounting spec/plan, security remediation checklist.
Verification:
- H-05 boundary/business/use-case suite passes 10/10.
- Full API regression passes 2,042/2,042; API typecheck passes.
- Caller review confirms the public routes use concrete DTOs, internal conversion copies persisted validated lines, and the existing web flow already supplies THB/positive values, limits allocation UI to issued receivables, and renders API errors.
- Review of sibling money modules found existing use-case/domain guards on confirmed reimbursement, supplier-payment, banking-allocation, and expense-payment paths; H-05 code remains scoped to the assessment's exploitable accounting payment/document paths.
- Scoped `git diff --check` passes. No schema/migration change.
Next: Deploy an immutable artifact, then run the authorized AC-01 retest.
