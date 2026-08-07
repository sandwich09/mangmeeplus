# Agent Memory: expense-extraction-doc-type-default

Status: Done (2026-08-04)
Owner: web upload OCR flow
Scope: Default `sourceDocumentType` + tax evidence from AI classification after web receipt extraction, matching the existing LINE flow.
Decisions:
- `sourceDocumentTypeFromClassification` moved from `process-line-webhook.use-case.ts` to `expenses/domain/logic/expense-document.logic.ts` and shared by both flows (SUPPLIER_INVOICE_OR_BILL → SUPPLIER_BILL, MARKETPLACE_ORDER → MARKETPLACE_ORDER_SCREENSHOT, else same-name; unknown kinds → NEEDS_REVIEW via `toSourceDocumentType`).
- `RequestReceiptExtractionUseCase` ok-path now writes `sourceDocumentType` + `deriveTaxEvidence` result, but ONLY while the expense is still `NEEDS_REVIEW` — a reviewer's explicit choice survives re-extraction.
- No web UI change needed: the review dropdown already binds `detail.sourceDocumentType`.
Open questions: none
Artifacts:
- apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts
- apps/api/src/modules/expenses/domain/logic/expense-document.logic.ts
- apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts (import only)
Verification:
- `npx tsx --test expense-extraction.use-case.spec.ts` → 13 pass (3 new: default from classification, supplier-bill mapping, reviewer choice preserved)
- `npx tsx --test process-line-webhook.use-case.spec.ts` → 53 pass
- `tsc --noEmit` → no errors in touched files (pre-existing reports module errors unrelated)
Next: none
