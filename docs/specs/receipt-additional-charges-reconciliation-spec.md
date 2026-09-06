# Feature: Receipt Additional Charges and Total Reconciliation

## 1. Status

- Roadmap/checklist item: Expense receipt upload follow-up
- Owner: Codex
- Date: 2026-07-30
- Status: Implemented

## 2. Goal

Preserve and explain the amount actually paid on receipts, bills, and tax invoices when the document contains monetary components beyond merchandise/service lines and VAT.

The first slice covers:

- additive printed charges such as service charge, delivery, packaging, platform/convenience fees, tips, and positive rounding;
- printed discounts and negative rounding through the existing document discount;
- printed withholding tax through the existing WHT fields;
- deterministic reconciliation between OCR evidence, reviewable lines, document totals, and the amount payable.

The outcome is accountant-reviewable expense lines that survive web review-save recomputation without dropping or double-counting a charge.

## 3. Source Docs

- [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]
- [[specs/typhoon-receipt-ocr-spec|Typhoon Receipt OCR Spec]]
- [[specs/expense-ledger-auto-post-spec|Expense Ledger Auto-post Spec]]
- [[specs/tax-thailand-2026-spec|Tax Thailand 2026 Spec]]
- [[specs/sap-compatible-transaction-tax-account-determination-spec|Transaction Tax and Account Determination Spec]]
- [Revenue Department tax-invoice guide](https://www.rd.go.th/fileadmin/user_upload/ebook/taxinvoice.pdf)
- [Revenue Department ruling: discounts and VAT base](https://www.rd.go.th/24410.html)
- [Revenue Department ruling: transport charges and VAT base](https://www.rd.go.th/24178.html)
- [Revenue Department: withholding tax](https://www.rd.go.th/27862.html)
- [Revenue Department: tax invoices, debit notes, and credit notes](https://www.rd.go.th/7047.html)

## 4. Non-goals

- No new `serviceChargeAmount`, `deliveryAmount`, `tipAmount`, or similar database columns.
- No per-line VAT-mode migration. The document keeps one `vatMode`; a line can carry an explicit zero VAT rate.
- No automatic deposit, advance-payment, stored-credit, or payment-allocation accounting. Those change settlement ownership and require a separate payment-allocation spec.
- No credit-note/debit-note or refund mutation inside an existing expense. Those remain separate source documents/reversals.
- No foreign-exchange-rate sourcing or foreign-currency remeasurement.
- No automatic tax-code selection or input-VAT claim from OCR.
- No AI confirmation, payment, posting, or filing.

## 5. User Roles

- Employee/uploader: uploads evidence and sees the resulting draft.
- Finance/accountant: reviews charge lines, discount, VAT rate, WHT rate, and reconciliation warnings.
- Owner/approver: confirms only after required review and existing duplicate/evidence gates.
- AI assistant user: receives draft capture only; final accounting actions remain web-only.

## 6. Business Journey

1. User uploads a receipt, bill, or tax invoice.
2. OCR reads the printed total fields and any additive charges.
3. AI Gateway returns bounded, evidence-backed `additionalCharges`.
4. ERP Core validates every charge against OCR text and recomputes candidate lines.
5. If the candidate lines reconcile with the printed VAT and grand total within ฿0.05, ERP stores the charges as separate `ExpenseLine` rows.
6. If they do not reconcile, ERP stores one total-preserving summary line, retains the raw charge suggestions as provenance, and marks the breakdown for human review.
7. Finance reviews the lines in web. Explicit VAT rate `0` must remain zero; it must never fall back to 7%.
8. A review save recomputes all totals on the server.
9. Confirmation blocks an unresolved OCR-total mismatch; a finance review performed after the OCR run resolves that block.
10. Existing posting and tax-source adapters consume the final expense lines and totals unchanged.

## 7. Business Rules

### 7.1 OCR adjustment contract

`ReceiptOcrFieldResult.additionalCharges` is optional and contains at most 10 entries:

```text
kind:
  SERVICE_CHARGE | DELIVERY | PACKAGING | PLATFORM_FEE |
  TIP | ROUNDING | OTHER
description: bounded printed label
amount: positive decimal string copied from OCR text
vatRate: optional decimal-fraction string, 0 <= rate < 1
evidenceSignal: one short exact OCR span containing the charge evidence
confidence: optional number, 0..1
```

- `additionalCharges` contains additive amounts only.
- Discounts, coupons, promotions, and negative rounding stay in `discountAmount`; the model must not duplicate them as charges.
- `amount` and `evidenceSignal` must survive the same OCR membership guard as other monetary fields.
- `vatRate = "0"` is meaningful and means the line carries no VAT under a VAT document mode.
- A missing adjustment VAT rate may inherit the document rate only when the full candidate breakdown reconciles with the printed VAT and grand total.
- Unknown or unsupported charge labels use `OTHER`; the model must not invent a new enum.

### 7.2 Printed WHT

- Optional `whtRate` and `whtAmount` join the OCR receipt field contract.
- Both must be printed/cross-checked values; the AI must not invent them.
- `grandTotalAmount` remains the document gross amount.
- `netPayableAmount = grandTotalAmount - whtAmount`.
- If charges plus WHT cannot round-trip through existing line calculations, charges fold into the summary line and the draft remains reviewable.

### 7.3 Deterministic totals

For every review save:

```text
line subtotal = quantity × unit price
line taxable = line subtotal - line discount
line VAT = VAT-mode/rate calculation rounded to satang
line total = line taxable + line VAT

document subtotal = sum(line subtotals)
document discount = sum(line discounts)
document taxable = sum(line taxable)
document VAT = sum(line VAT)
document WHT = sum(line WHT)
document grand total = document taxable + document VAT
document net payable = document grand total - document WHT
```

- Existing satang rounding policy remains authoritative.
- A printed additive charge is represented as quantity `1`, its printed amount as unit price, zero discount, inherited expense category/account hint, and its validated VAT rate.
- Negative lines are not created.

### 7.4 OCR reconciliation

- Candidate charge lines are accepted when recomputed grand total, VAT, and WHT each differ from printed values by no more than ฿0.05 — **or** under the whole-baht VAT rounding allowance below.
- Recomputed taxable amount must also match when all lines share one VAT rate. With explicit mixed VAT/zero-rate lines, printed `taxableAmount` may be only the positive-rate VAT base while the existing expense header stores the sum of all pre-VAT lines; in that case gross plus VAT are the acceptance proof.
- **Whole-baht VAT rounding allowance.** Only when the printed VAT is a whole-baht figure AND the printed item rows — or, where the page printed no usable item block, the subtotal base line, which is built from the printed subtotal and therefore agrees by construction — already reconcile with the printed subtotal, the grand total and VAT comparisons widen: a gap of STRICTLY LESS than ฿1.00 in either direction is accepted (a POS that rounds prints 56 where 55.79 was due; one that truncates prints 55). Exactly ฿1.00 is not a rounding — the computed VAT would then be a whole baht itself — and the bill folds.
  - The taxable comparison never widens, and the WHT tolerance never widens: the rounding is a fact about the TAX, not about the base or the withholding.
  - The rows stay exactly as printed, and the record keeps the COMPUTED VAT and grand total — nothing on the document is accepted as an amount by this allowance. All it decides is whether the reviewer sees the document's real rows or a single folded summary line with the charge deleted.
  - Review reason `vatRounding` names the remainder with its sign and the one control that records the printed figure ("ใช้ยอดตามเอกสาร").
  - The VAT capture snapshot stays `MISMATCH`, so the §7.5 confirmation guard still stands between this draft and a confirmation. "ใช้ยอดตามเอกสาร" is what answers it: the remainder moves into the VAT, where the merchant put it, and the tax base does not move.
- No `ROUNDING` line and no negative line is ever synthesized to close a remainder. A `ROUNDING` charge line exists only because the document printed one (§7.3 and §14 unchanged: negative lines are not created, and negative rounding still belongs in the discount).
- The document's VAT mode is decided from the printed arithmetic BEFORE the extractor's `vatMode` word: `subtotal − discount + Σ charges` plus the printed VAT reaching the printed total proves `VAT_EXCLUDED`, reaching it without the VAT proves `VAT_INCLUDED`, and the extractor's word stands only when neither reading explains the total. It never overrides a deliberate `EXEMPT` or `NEEDS_REVIEW`, which are tax positions rather than readings of the totals. Background and the UAT bills that forced this: `docs/agent-memory/receipt-charge-vat-mode.md`.
- Accepted outcomes: `RECONCILED_CHARGE_LINES`, or `RECONCILED_ITEM_LINES` when the printed item block itself reconciles. Either may carry the `vatRounding` review reason; the charge branch may instead carry `chargeVatUnknown` when the printed totals reconcile only with the charge left un-rated.
- Fallback outcomes: `FOLDED_INTO_SUMMARY_NEEDS_REVIEW`, or `ITEMS_DID_NOT_RECONCILE` when the page printed item rows that would not reconcile — the reviewer is shown both numbers, not merely told they disagree.
- No-charge outcome: `SUMMARY_LINE`.
- Fallback must preserve the printed grand total through a later review save.
- Raw OCR fields, including rejected/folded charge suggestions, remain in `aiVerifiedFieldsJson`.

### 7.5 Confirmation guard

- If `aiVerifiedFieldsJson.grandTotalAmount` differs from the stored grand total by more than ฿0.05, confirmation is blocked unless `reviewedAt >= aiVerifiedAt`.
- A finance review save is the acknowledgement boundary.
- Manual expenses without an AI total are unaffected.
- Existing duplicate, evidence, substitute-receipt, permission, and Tax Code gates remain unchanged.
- Printed VAT on a `NON_CLAIMABLE` receipt does not require a Tax Code snapshot; `CLAIMABLE` VAT lines still do.

## 8. Boundary and Ownership

- Web owns editable descriptions, amounts, discount, VAT rate, WHT rate, and the visible review warning.
- API/ERP Core owns arithmetic, charge-line acceptance/fallback, persistence, reconciliation state, permissions, confirmation gates, audit, and posting inputs.
- AI Gateway owns semantic extraction and strict output bounding; it does not own arithmetic truth or database access.
- Ledger consumes final gross/WHT/line values and does not parse OCR provenance.
- Tax consumes reviewed/finalized tax snapshots and does not infer claimability from a charge label.

## 9. Data Model and Contract Impact

### Existing persistent data reused

- `ExpenseRecord`: subtotal, discount, taxable, VAT, WHT, grand total, net payable, outstanding, AI provenance/review timestamps.
- `ExpenseLine`: description, quantity, unit price, discount, taxable, VAT rate/amount, WHT rate/amount, totals, category/account/tax snapshots.

### Additive wire contract only

- `ReceiptOcrFieldResult.additionalCharges`
- `ReceiptOcrFieldResult.whtRate`
- `ReceiptOcrFieldResult.whtAmount`

No Prisma migration is required.

## 10. Permission and Audit

- OCR request permissions remain `expense.ocr.request`, `expense.review`, or own-upload path.
- Review remains `expense.review` or permitted owner update within current ABAC rules.
- Confirmation remains `expense.confirm` and authenticated web only.
- OCR audit metadata records only counts/status, never raw OCR or attachment bytes.
- Charge provenance remains bounded inside existing AI verification JSON.

## 11. API Behavior

- Existing receipt extraction endpoint returns additive optional fields; no new endpoint.
- Existing expense detail endpoint returns generated charge lines through the existing line contract.
- Existing review PATCH accepts explicit VAT/WHT rate `0` without dropping it.
- OCR apply returns reconciliation status/count to the extraction use case for the bounded review summary.
- Existing records are not migrated; re-running OCR regenerates their lines.

## 12. UI Behavior

### Web

- Reconciled charges appear as normal editable expense lines.
- Manual capture accepts one printed service charge and sends it as its own quantity-1 line at the document VAT rate and Tax Code, so a hand-keyed bill and an AI-read bill produce the same document shape. A printed discount stays on the item line; the charge line carries none.
- Finance can edit VAT rate and WHT rate per line, including explicit `0`.
- Existing AI-vs-server total warning remains visible.
- Confirmation failure returns the server reconciliation message through the existing error banner.
- Loading, empty, forbidden, readonly, and duplicate states are unchanged.

### LINE

- No new final mutation.
- LINE capture may summarize the printed gross and WHT when present, but review remains in web.

## 13. Impact Analysis

| Area | Impact | Required action |
|---|---|---|
| Contracts | Additive OCR fields | Add bounded types; no breaking rename |
| AI Gateway prompt | Model must separate positive charges from discounts | Update schema/rules |
| AI Gateway parser | Nested untrusted array | Enum, length, evidence, numeric, confidence, and rate guards |
| OCR cross-check | Nested amounts | Verify charge amount against OCR digits/Thai digits |
| Expense apply | One summary line can become N+1 lines | Reconcile before writing; fallback atomically |
| Totals | Explicit rate zero currently becomes 7% | Preserve explicit zero in VAT included/excluded modes |
| WHT | OCR path currently writes zero | Apply printed WHT and net payable |
| Web review | WHT rate carried but not editable | Add WHT-rate input; preserve zero |
| Confirmation | UI warning is not a server gate | Add reviewed-after-OCR mismatch guard |
| Input VAT | Non-claimable printed VAT has no Tax Code | Require snapshots only for claimable VAT |
| Ledger | Uses final gross/WHT | No code change expected; verify |
| Tax sync | Uses claimability/snapshots | No code change expected; verify |
| Duplicate detection | Uses final grand total | Reconciled/fallback total remains authoritative |
| Historical data | Existing lines may be folded/understated | No migration; re-run OCR/manual correction |

## 14. Edge Cases

- Same printed amount appears more than once: require exact evidence span but accept deterministic numeric membership.
- Charge amount exists but VAT applicability is unclear: fallback to summary line.
- Explicit zero VAT adjustment inside a VAT document: retain rate `0`.
- Mixed taxable and non-taxable charges: accept only when their explicit rates reconcile.
- Positive rounding: `ROUNDING` charge line; negative rounding belongs in discount.
- Discount and charge share a label/value: do not double count; reconciliation fallback protects the total.
- WHT exceeds grand total or implies an invalid rate: do not auto-apply WHT; require review.
- More than 10 charges: drop charge breakdown and retain summary fallback.
- No printed grand total: existing document-classification gate remains; do not construct a final expense total from charge suggestions alone.
- Credit/refund/deposit: retain as review provenance only; do not mutate settlement/accounting.

## 15. Acceptance Criteria

- [x] A receipt `subtotal 1,000 + service 100 + VAT 77 = 1,177` creates two reviewable lines and remains 1,177 after save.
- [x] The same bill typed into manual capture creates the same two lines and the same 1,177.
- [x] A no-VAT receipt `subtotal 1,000 + delivery 50 = 1,050` creates two lines and remains 1,050 after save.
- [x] A VAT receipt with `tip 20, vatRate 0` does not add 7% VAT to the tip.
- [x] A printed WHT amount reduces net payable, not grand total.
- [x] An unprovable charge split falls back to one summary line and preserves grand total.
- [x] Hallucinated charge amounts/evidence are dropped by AI Gateway.
- [x] Unreviewed OCR/server mismatch above ฿0.05 blocks confirmation.
- [x] Finance review after OCR permits an intentional corrected total.
- [x] Non-claimable receipt VAT can confirm without a Tax Code snapshot.
- [x] Claimable VAT still requires reviewed tax evidence and tax snapshots.
- [x] Ledger gross, WHT, and payable remain balanced.
- [x] No Prisma migration or new dependency.

## 16. Test Cases

- Contracts/typecheck: new additive OCR fields compile across API and AI Gateway.
- AI Gateway: valid charges survive; invalid enum, amount, rate, or evidence is dropped.
- API totals: explicit zero rate remains zero.
- OCR apply: VAT, no-VAT, zero-VAT tip, WHT, and fallback reconciliation.
- Confirmation: mismatch review gate and non-claimable receipt VAT snapshot exception.
- Web: review payload preserves `"0"` VAT/WHT rates.
- Ledger/tax: focused existing posting/tax tests remain green.

## 17. Open Questions

- Deposit/credit allocation needs a separate settlement model and is intentionally deferred.
- Per-line VAT mode is unnecessary for the current receipt forms; add only when real evidence cannot be represented by document mode plus line rate.
