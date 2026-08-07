# Agent Memory: expense-abbreviated-tax-invoice

Status: DONE 2026-08-04 — implemented, self-reviewed, verified, committed on `develop`. NOT pushed (owner pushes; see [[watchdog-no-push-credentials]]).
Owner: thawtchai (confirmed the tax rule 2026-08-04; spun off from [[expense-vat-rate-correctness]], which flagged this as out of scope)

Scope: `packages/contracts` (`SourceDocumentType`, `BUSINESS_DOCUMENT_KINDS`, `TaxEvidenceReasonCode`, labels), `apps/api` (Prisma enum + migration, `deriveTaxEvidence`, extraction eligibility, two input-VAT gates, accountant report columns), `apps/ai-gateway` (receipt-OCR prompt + kind enum), `apps/web` (reason label, checklist row, document-kind labels), spec §19h + tests.

## Decisions

Authority: `docs/specs/expense-receipt-upload-spec.md` §19h.

1. **Owner-confirmed rule**: ใบกำกับภาษีอย่างย่อ (Revenue Code s.86/6) cannot support an input-VAT credit (s.82/5). Its VAT is absorbed into expense cost — exactly what §19c decision 1 already does for non-claimable documents, so no new ledger or PP30 behavior was needed.
2. **First-class document type**, not a modifier on `TAX_INVOICE` — owner's choice between the two options costed below. `ABBREVIATED_TAX_INVOICE` added to the Prisma enum (additive `ADD VALUE` migration), the contract union, and `BUSINESS_DOCUMENT_KINDS`.
3. **Discriminator is buyer identification**, not just the printed title: s.86/4 (full form) requires the buyer's name/address, s.86/6 does not. The prompt uses the title when present and falls back to "seller tax id + VAT but no buyer identified". Notably, `deriveTaxEvidence` never checked anything about the buyer at all — that absence is what let the slip through.
4. **Blocked by document type, not by evidence status.** `isReceiptOrSupportingOnly` and `validateDomesticInputVatEvidence` name the type explicitly rather than leaning on their existing `SUPPORTING_ONLY` clause, so a reviewer moving `taxEvidenceStatus` by hand cannot reopen the claim path. Upgrading legitimately means the seller issues a full-form invoice, which is a different document recorded as `TAX_INVOICE`.
5. **No back-migration + a review path.** Beyond the §19c/§19g precedent, a stored abbreviated invoice is *indistinguishable* from a full-form one — the discriminator is on the image — so any backfill would be a guess over confirmed records. Instead `expense.accountant_evidence` gained `expenseStatus` + `inputVatClaimStatus` columns so the accountant can list `CONFIRMED + TAX_INVOICE + USABLE_FOR_TAX + CLAIMABLE` and check them against the attachments. This defect *over*-stated tax evidence and may have reached a filed PP30, unlike §19c/§19g which under-recorded — hence surfacing the rows is part of the change, not optional.

## Option costing (recorded for future similar calls)

- **Chosen — new `SourceDocumentType`**: needs a Prisma enum migration (`SourceDocumentType` is a DB enum at `schema.prisma`), plus contract union, labels, prompt, classification enum. Truthful model, filterable in reports, reviewer can set it directly.
- **Rejected — keep `TAX_INVOICE` + new reason code only**: migration-free (`taxEvidenceReasonCode` is `String?`) and would have gated correctly via the existing `SUPPORTING_ONLY` clauses, but the doc-type control would still read "ใบกำกับภาษี" and the ABB fact would vanish if a reviewer overrode the status.

## Exposure that motivated it

`validateDomesticInputVatEvidence` admits domestic input VAT on `TAX_INVOICE` + `USABLE_FOR_TAX` + attachment + seller tax id + document number. The reported Starbucks slip satisfied all five. `inputVatClaimStatus` starts at `NEEDS_REVIEW` so nothing was claimed automatically — but the `ใช้เป็นหลักฐานภาษีได้` badge was actively telling Finance the credit was available.

## Also in this pass

`TaxEvidenceInput.hasVatAmount` was declared and never read by the function body — removed. It was dead regardless of the ABB decision (an abbreviated invoice prints VAT just like a full one, so it was never a discriminator).

## Open questions

None blocking. Still open elsewhere: zero-rated vs exempt as distinct VAT modes (PP30 box 2 vs box 3) — noted in §19g.

## Artifacts

- Spec: `docs/specs/expense-receipt-upload-spec.md` §19h
- Migration: `apps/api/prisma/migrations/20260804200000_abbreviated_tax_invoice_document_type/`
- Predecessor: `docs/agent-memory/expense-vat-rate-correctness.md`

## Verification

- `apps/api` full suite exit 0; `apps/web` 673/673; `apps/ai-gateway` 518/518. Typecheck clean across contracts, api, web, ai-gateway. `prisma generate` re-run after the enum change (the API typecheck fails without it — generated client types gate the enum).
- New coverage: complete-ABB → `SUPPORTING_ONLY` and amount-less ABB → `NEEDS_REVIEW` (`expense-document.logic.spec`); ABB stays extraction-eligible (same spec); Tax Code + `CLAIMABLE` refused even when hand-marked `USABLE_FOR_TAX` (`expense-status.logic.spec`); write-path refusal plus printed VAT preserved (`expense-draft-vat-decouple.use-case.spec`); ABB-specific checklist row (`expenses-audit.logic.spec`); the new kind survives the strict classification parser (gateway controller spec).
- Not verified by automated test: whether the model actually classifies a real ABB correctly — that is prompt behavior. Worth checking against the owner's real slip after deploy.

## Next

Owner reviews and pushes. **Deploy order matters here, unlike §19g**: run the migration before or with the API (`ADD VALUE` must exist before any API build writes it), and deploy ai-gateway no earlier than the API — a gateway returning `ABBREVIATED_TAX_INVOICE` to an older API would fall back to `NEEDS_REVIEW` via `toSourceDocumentType`, which is safe but wastes an extraction. After deploy: re-extract the Starbucks draft to confirm it lands as `ABBREVIATED_TAX_INVOICE`, and run the accountant report filter from decision 5 for the affected-row review.
