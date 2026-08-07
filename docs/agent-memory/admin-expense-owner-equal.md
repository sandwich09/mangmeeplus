# Agent Memory: admin-expense-owner-equal

Status: Implemented and locally verified; NOT deployed (UAT still on 244c853e)
Owner: Claude (per owner decision in chat, 2026-07-26)
Scope: Extend the protected `ADMIN` company role to work the expense module owner-equal, triggered by UAT: admin could not run the substitute-receipt (ใบรับรองแทนใบเสร็จ) flow.

Decisions:
- Owner asked "admin ต้องทำได้" for the substitute-receipt prepare step, then widened to "admin ควรทำได้เท่ากับ owner"; scope confirmed via question = owner-equal for the expense module only (not system-wide, not reimbursement).
- Added to ADMIN: `expense.create`, `expense.update`, `expense.review`, `expense.confirm`, `expense.reject`, `expense.void`, `expense.payment.record`, `expense.duplicate.resolve`.
- Kept out deliberately: `expense.signature.approve` (owner-level, UI labels it "รอเจ้าของกิจการอนุมัติ"), `expense.ocr.request` (redundant — extraction boundary accepts `expense.review`, see expense-extraction.use-case.ts:51), `expense.ai.verify` (service-lane).
- The whole reviewer journey (review-fields, reviewer-mark-ready, substitute-receipt prepare/payers/history/supersede) is gated by `expense.review`; substitute approve by `expense.confirm` with payer≠approver enforced in the use case — that separation is unchanged.
- Related but separate: the original UAT error on "เตรียมเอกสารให้ผู้จ่ายลงนาม" was NOT a permission failure — it was 400 eligibility (sourceDocumentType/taxEvidenceStatus still NEEDS_REVIEW). Reviewer must save doc review first; tax status must not be USABLE_FOR_TAX.

Open questions: None.

Artifacts:
- `apps/api/src/modules/auth/permission-registry.ts` (ADMIN Item 09 block)
- `apps/api/src/modules/auth/permission-registry.spec.ts` (owner-equal lane test + negative signature.approve)
- `docs/specs/permission-matrix.md` (grants line, prose note, module overview table cell)
- Builds on `docs/agent-memory/admin-receipt-web-upload.md` (8d7972aa added expense.receipt.upload)

Verification:
- `pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/auth/permission-registry.spec.ts` — see chat/commit for result.

Next:
- Deploy so the release-task permission sync reconciles existing ADMIN roles (same mechanism as 8d7972aa, still pending deploy too; GitHub Actions free-tier minutes exhausted until ~Aug 1 — manual runbook in uat-ai-not-responding.md).
- For the substitute-receipt approve step on UAT: the admin user must also be added to the approver list in company settings (`/settings/substitute-receipt`) and must not be the selected payer.
