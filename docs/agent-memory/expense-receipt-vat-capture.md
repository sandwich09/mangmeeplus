# Agent Memory: expense-receipt-vat-capture

Status: DONE 2026-07-28 — implemented + reviewed (APPROVE-WITH-FIXES; 4 in-scope defects fixed in completion helper) + verified; committed (see Verification).
Owner: thawtchai (report: BENLAI card slip shows VAT 7% but draft form has empty VAT rate and totals 542.06 instead of paid 580.00)
Scope: packages/contracts (ReceiptOcrFieldResult), apps/ai-gateway (RECEIPT_OCR_PROMPT + parser), apps/api expenses (receipt-ocr-apply completion, expense-draft decoupling), apps/web expenses (review save no longer wipes VAT), specs/tests.

Decisions:
- Spec authority: docs/specs/expense-receipt-upload-spec.md §19c (2026-07-28) — vatMode/vatRate (document arithmetic) decoupled from inputVatClaimStatus × taxEvidenceStatus (claimability). Recorded grandTotal/netPayable must equal amount actually paid.
- Root cause 3 legs: (1) contract/prompt had no vatRate; (2) apply service hardcoded `vatRate: fields.vatAmount ? '0.0700' : null`, never completed base/VAT/total arithmetic; (3) web (ExpensesPages saveDocumentReview + ExpenseReviewEditSection.save + clearExpenseTaxSelections) AND server (UpdateExpenseDraftUseCase isReceiptOrSupportingOnly) forced vatMode=NO_VAT + wiped vatRate for non-TAX_INVOICE docs.
- Ledger already correct — do not touch: normalizeExpenseVatForLedger zeroes INPUT_VAT split for non-claimable (gross absorbed into expense debit, journal.use-case.ts:64-71 + posting-engine expense.confirmed template); PP30 gated on CLAIMABLE (prisma-expense.repository.ts:993).
- Keep enforced: NON_CLAIMABLE force, CLAIMABLE rejection, Tax-Code rejection/clear for receipt/substitute/supporting-only. Only the vatMode/vatRate wipe goes.
- Completion rules (tolerances): complete missing one of {taxable, vat, grand} iff implied rate ∈ (0, 0.20]; rate snap 0.07 within ±0.002; vatMode → VAT_EXCLUDED when vat>0 ∧ |t+v−g|≤0.05 (overrides explicit NO_VAT only under proven arithmetic); subtotal defaults to taxable; inconsistent triple → no invention.
- vatRate NOT added to gateway OCR_NUMERIC_FIELDS verbatim cross-check (rates print as "7%", not "0.07"); parser sanity 0<r<1 instead.
- No data migration; heal via re-extraction ("อ่านเอกสารอีกครั้ง") or manual edit.

Open questions: none blocking.

Artifacts:
- Spec: docs/specs/expense-receipt-upload-spec.md §19c
- Key files: apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts; apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts (lines ~177/243); apps/web/src/features/expenses/ExpensesPages.tsx (saveDocumentReview ~331, ExpenseReviewEditSection.save ~706); apps/web/src/features/expenses/expenses.model.ts (clearExpenseTaxSelections); apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts (RECEIPT_OCR_PROMPT ~251, parseReceiptOcrJson ~379); packages/contracts/src/line-ai.ts (ReceiptOcrFieldResult ~142).

Verification:
- Committed 2026-07-28 on develop, subject "fix(expenses): capture receipt VAT and decouple vatMode from input-VAT claimability" (NOT pushed). api expenses suite 168/168 (17 specs incl. 2 new, registered), ledger/tax invariants 18/18, gateway controller 26/26, web 23/23, process-line-webhook consumers 44/44; contracts/api/ai-gateway/web typechecks clean; contracts dist rebuilt (gitignored).
- Review lane APPROVE-WITH-FIXES: 4 in-scope defects fixed in completeVatFields (grand-completion sanity gate, subtotal default gated on provenVat, derived-rate sanity gate, vatRate fallback on explicit "0.00").
- Business matrix (Fable 5): BENLAI → line 542.06 @0.0700 → VAT 37.94, grand/net 580.00, VAT_EXCLUDED, NON_CLAIMABLE; typed 0.07 survives review save; CLAIMABLE + tax-code guards still reject; ledger posts gross to expense with no INPUT_VAT line; PP30 gate CLAIMABLE-only.

Accepted residuals (follow-up task chips spawned):
- INPUT_VAT_NOT_CLAIMABLE INFO issues accumulate per tax-sync pass (createIssue has no dedupe — pre-existing pattern, newly reachable for receipts).
- Satang residue: review-save recompute yields 580.0042 (4dp rate math) vs printed 580.00 → typed payment 580 leaves PARTIALLY_PAID with ฿0.00 shown (pre-existing for manual VAT_EXCLUDED; evaluate 2dp VAT rounding in calcLineTotals + siblings).
- LINE reply/missingFields read RAW extraction fields (cosmetic; webhook file owned by another session).

Next: deploy (ai-gateway + api + web together; additive contract field — no ordering hazard); after deploy, heal the BENLAI draft via "อ่านเอกสารอีกครั้ง" or manual edit; owner may verify on the real slip.
