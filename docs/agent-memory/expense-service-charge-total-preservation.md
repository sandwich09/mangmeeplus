# Agent Memory: Expense Service Charge Total Preservation

Status: Complete
Owner: Codex
Scope: Preserve OCR receipt totals containing a service charge or surcharge through expense review-save recomputation.
Decisions: Reuse the existing OCR grand total, taxable amount, discount, and summary line. Do not add a service-charge column or migration; fold the surcharge difference into the reviewable summary-line price and retain the original OCR fields as provenance.
Open questions: None.
Artifacts: `docs/specs/expense-receipt-upload-spec.md`; `apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts`; focused regression spec.
Verification: `./node_modules/.bin/tsx --test apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.spec.ts` passed 19/19; `./node_modules/.bin/tsc --noEmit -p apps/api/tsconfig.json` passed; `git diff --check` passed.
Next: Re-run OCR on affected drafts, or manually include the service charge in their review lines; existing records are not rewritten automatically.
