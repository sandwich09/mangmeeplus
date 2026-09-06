# Agent Memory: receipt-charge-vat-mode

Status: implemented on `codex/receipt-charge-vat-mode`, all gates green, not merged, no PR opened.
Owner: Owner (UAT report 2026-09-06, build 178d3fb6)
Scope: `apps/api` receipt OCR apply service + the LINE capture card. No contracts, web, gateway,
schema or migration change — `ExpenseLineChargeKind.ROUNDING` and `expenseLineCharges` already exist.

## Symptom

The LINE receipt card showed a service charge; the record opened on the web had no service-charge
row. Three UAT records created 03:47–03:48Z on 2026-09-06, all `aiVerificationStatus=NEEDS_REVIEW`,
OCR status `OCR_EXTRACTED_NEEDS_REVIEW`, review reason `RECEIPT_REVIEW_REASONS.chargesFolded`, and
exactly ONE persisted `ExpenseLine` each with `chargeKind` NULL.

## Root cause (reproduced before changing anything)

`prepareOcrLines` took the VAT mode from `documentVatMode(fields)` — the word the extractor put in
`vatMode` — and the extractor labelled all three bills `VAT_INCLUDED` while their printed arithmetic
was VAT **added on top**, exact to the satang:

- `130.00 + ค่าบริการ 13.00 = 143.00 → 7% = 10.01 → 153.01`
- `3,680.00 + ค่าบริการ 368.00 = 4,048.00 → 283.36 → 4,331.36`

Read as inclusive, the base and the charge come to 143.00 (4,048.00), `reconciledTotals` misses the
printed grand total by the whole VAT, `unprovenCharges` misses it the same way, and the function
falls through to the summary line — 153.01 inclusive reconciles trivially, so the record was written
as one line at `1 × 153.0100 @ 0.07`, `chargesApplied 0`, status `FOLDED_INTO_SUMMARY_NEEDS_REVIEW`.

Meanwhile `formatPaypersReply` listed charges from the OCR `additionalCharges` block (a suggestion),
so the chat promised a row the record did not have. The comment there already said "slice B swaps
this for the persisted `chargeKind` column, one call site" — it never did.

Reproduction, before the fix, through the real `apply()` with an in-memory Prisma fake:

```
HOUSE_TANGO  status FOLDED_INTO_SUMMARY_NEEDS_REVIEW chargesApplied 0
             lines [{ck: null, q: 1, u: 153.0100, r: 0.07, v: 10.0100}]           ← matches UAT DB
BIG_BILL     status FOLDED_INTO_SUMMARY_NEEDS_REVIEW chargesApplied 0
             lines [{ck: null, q: 1, u: 4331.3600, r: 0.07, v: 283.3600}]         ← matches UAT DB
CHECK_BILL   status ITEMS_DID_NOT_RECONCILE          chargesApplied 0
```

## Decisions

1. **The printed arithmetic decides the VAT mode.** New `printedVatMode(fields, vat, grand)` in
   `receipt-ocr-apply.service.ts`, applied inside `completeVatFields`. With `subtotalAmount`,
   `vatAmount` and `grandTotalAmount` all present (charges and discount optional), base =
   `subtotal − discount + Σ charges`; `|base + vat − total| ≤ 0.05` ⇒ `VAT_EXCLUDED`,
   `|base − total| ≤ 0.05` ⇒ `VAT_INCLUDED`, otherwise the extractor's word stands.

   It lives in `completeVatFields` rather than in `prepareOcrLines` because the record's own
   `vatMode` column is what `reconcileExpenseVat` recomputes every line total from
   (`Object.assign(data, vat.totals)`). Fixing only `prepareOcrLines` would have built the lines one
   way and then recomputed them the other. Every `documentVatMode` caller — `defaultLineVatRate`,
   `summaryLineVatRate`, `deriveLineSubtotal`/`deriveUnitPrice`, `prepareOcrLines`,
   `ocrLineVatRateUnknown` — reads completed fields, so one edit covers the breakdown branches and
   the summary line alike.

2. **Whole-baht VAT rounding: option (a), a `ROUNDING` charge line.** Chosen over (b) because all
   four preconditions hold today, checked in code:
   - `validateExpenseChargeLines` (`expense-draft-amount-validation.logic.ts:121-125`) accepts a
     non-zero `ROUNDING` row of either sign, quantity 1, sorted after every product row.
   - `calcLineTotals` (`expense-totals.logic.ts:55-57`) clamps the document discount against zero
     precisely so a negative row survives; `expenseTotalsIdentityError` counts a charge row's
     subtotal into `taxable`, so the identity still holds with the row present.
   - The web charge group (`ExpensesPages.tsx:1903-1950`) renders every `chargeKind != null` row with
     the `EXPENSE_LINE_CHARGE_KIND_LABELS` select — `ROUNDING` reads **ปัดเศษ** — and the amount input
     carries no `min` for exactly that reason. `vatRatePreset` parses `'0'` numerically, so the row
     shows as an explicit zero rate, not "custom".
   - The accountant export sums `lineSubtotalAmount` over all `chargeKind != null` rows
     (`prisma-expense.repository.ts:3192-3197` → `additional_charges_amount`), so the row is additive.

   Guarded to what it is meant for: only when the printed VAT is a **whole baht** (`Number.isInteger`)
   and the gap is `≤ MAX_PRINTED_ROUNDING = 1.00`. Tried after `reconciledTotals` and **before**
   `unprovenCharges` in both the item branch and the charge branch, so a remainder the bill itself
   rounded is explained rather than paid for by un-rating the charge. The row carries an explicit
   `vatRate '0'` (a rounding of a VAT figure is not itself taxed; `null` would read as "rate unknown"
   and ask the reviewer a question with no answer) and a new review reason
   `RECEIPT_REVIEW_REASONS.chargeRounding` naming the amount, so the derived row is disclosed.

   Consequence, stated plainly: the record's grand total equals the printed one (853.00) and the §5.1
   identity holds, but its stored VAT is the computed 55.79, not the printed 56.00 — per-line VAT is
   always `rate × taxable`, so the printed figure cannot be reproduced without a fake line. The 0.21
   sits in the base as the visible ปัดเศษ row, and `reconcileExpenseVat` records the difference in the
   VAT capture snapshot (`status: MISMATCH`, `differenceAmount 0.2100`).

3. **One source of truth for the LINE card.** `apply()` now returns `charges: ExpenseChargeSummary[]`
   built by the shared `expenseLineCharges` over the rows it actually wrote. `formatPaypersReply`
   takes `options.charges` and lists those; `receiptItemLines` takes them too, and
   `formatGroundedReceiptFollowUp` passes `expense.charges` (already on
   `ExpenseRecordWithRelations`). When the apply folded them, the card prints one honest line —
   `➕ ค่าบริการ 13.00 ยังรวมอยู่ในยอดเดียว – ตรวจแยกบนเว็บ` — instead of listing them as recorded.
   Charge names on the card now come from the `EXPENSE_LINE_CHARGE_KIND_LABELS` constant rather than
   model-authored free text, which also removes OCR prose from a LINE reply.

## Fixtures (all four are real, verbatim)

| Fixture | Source | Before | After |
|---|---|---|---|
| HOUSE TANGO 153.01 | UAT `cmtp9v5bc00931u2uznumjslm` | FOLDED, 1 line, charges 0 | RECONCILED_CHARGE_LINES, base 130 + SERVICE_CHARGE 13 @ 7%, taxable 143.00, VAT 10.01, total 153.01 |
| 4,331.36 bill | UAT `cmtp9ul5d008e1u2u4yqkx2ee` / `cmtp9tw7q007o1u2ua08kb0t9` | FOLDED, 1 line, charges 0 | RECONCILED_CHARGE_LINES, base 3,680 + SERVICE_CHARGE 368 @ 7%, taxable 4,048.00, VAT 283.36, total 4,331.36 |
| VAT-included control | synthetic (100 + 10 charge, VAT 7.20, total 110) | — | stays `VAT_INCLUDED` |
| Owner check bill | 270+160+190+30+50+25 = 725, Gratuity 72, VAT 56, total 853 | ITEMS_DID_NOT_RECONCILE, charges 0 | RECONCILED_ITEM_LINES, 6 goods + Gratuity 72 + ปัดเศษ 0.21, subtotal 725.00, taxable 797.21, VAT 55.79, total 853.00 |

## Verification

- `receipt-ocr-apply.service.spec.ts` — RED first (5 new cases failing: FOLDED vs RECONCILED, `charges`
  undefined, ITEMS_DID_NOT_RECONCILE vs RECONCILED_ITEM_LINES) → **87/87 pass**.
- `process-line-webhook.use-case.spec.ts` — RED first (2 new card cases) → **198/198 pass**.
- `receipt-truth.pg.spec.ts` against a throwaway `postgres:16-alpine` on port 15987 (container
  removed afterwards): **6/6 pass**, including the new case proving the real columns — `vatMode`
  `VAT_EXCLUDED`, 2 rows, `chargeKind = SERVICE_CHARGE`, `vatRate 0.0700`, header 130.00 / 143.00 /
  10.01 / 153.01.
- Mutation gate, 10 mutations, each anchor `grep -Fc == 1`: **10 killed, 0 survived** (mode proof
  disabled / inverted / base ignoring charges; rounding row disabled / whole-baht guard dropped / cap
  widened to 100 / gap sign flipped; outcome `charges` emptied; card folded-line hidden; card back to
  OCR labels).
- `spec-suite-coverage.spec.ts` 3/3 (no new spec file, so no `package.json` edit).
- `tsc --noEmit` on `apps/api` exit 0 (needs `NODE_OPTIONS=--max-old-space-size=8192`; the default
  heap OOMs on this project).
- `node apps/api/scripts/check-di-metadata.mjs` — 794 files, 870 decorated classes, all clean.
- `pnpm --filter @watchdog-bms/api test` (full fixed list) exit 0; `test:boot` — "Nest resolved every
  provider in 149ms".
- Heavy suites ran under the `mkdir /tmp/mangmee-heavy.lock` mutex, released afterwards.

## Observations (reported, not fixed)

- All three records carry `วันที่บนเอกสารยังอ่านไม่ได้` (`missingFields` includes `expenseDate`) even
  though `documentNumber` `0509202623135963` parses cleanly as `05/09/2026 23:13:59` + a 2-digit
  tail, which matches a bill printed the evening before the 03:47Z capture. Nothing anywhere reads a
  date out of `documentNumber`, and doing so is an inference, not a reading — if it is wanted it
  belongs behind §5.2's existing `dateStatus: 'assumed'`, which exists for exactly this, and needs an
  Owner decision first.
- The same 4,331.36 bill produced two records with `duplicateWarning=false`. Both were in each
  other's candidate set (`findNearDuplicates`: same company, 180 days, 200 rows), so every rule in
  `scoreAndFindDuplicates` must have scored 0, which pins down what the two readings were:
  - `same_checksum` — two separate photos, so different bytes. Never going to fire.
  - `same_visual_fingerprint` — LINE uploads DO get a perceptual hash (the lane goes through
    `CompleteAttachmentUploadUseCase`), so the two hashes were more than
    `MAX_PERCEPTUAL_HASH_DISTANCE = 6` bits apart.
  - `same_vendor_document_number` — this rule needs nothing but two equal non-null
    `vendorDocumentNumber`s, so the extractor must have read a different number on one photo, or
    none. This is the cheapest thing to fix if the two bills do print the same number.
  - `same_vendor_date_amount` — the amount matched and both dates were the same upload-day
    placeholder, so ONLY the differing vendor-name reading stopped it. A normalized-vendor-name
    comparison that tolerated the two readings would have caught the pair.
  - `same_vendor_tax_id_amount_near_date` — needs a `vendorTaxIdSnapshot`; `missingFields` says both
    were unread.

  There is deliberately no amount+date rule on its own, because two identical purchases on one day
  are legitimate. Any change here is a dedupe-policy decision, not part of this fix.
- Pre-existing, untouched: a charge whose OCR entry carries its own `vatRate` keeps the raw string
  (`'0.07'`) while product rows get the 4-dp normalized `'0.0700'`. Both are 7% and the
  `Decimal(18,4)` column and the web `vatRatePreset` both normalize, but `reconcileExpenseVat` sees
  two distinct rate strings and stamps `calculation.formula: 'MIXED'` with `vatRatePercent: null` on a
  plainly single-rate bill. Normalizing would flip the existing green assertion
  `assert.equal(tip.lines[1].vatRate, '0')`, so it was left alone.

## Next

- Owner acceptance on UAT: re-send the HOUSE TANGO and 4,331.36 bills and confirm the card's
  `➕ ค่าใช้จ่ายเพิ่ม` block matches the web record's charge rows.
- Merge decision and deploy ride-along; no flag, no migration, no config.
