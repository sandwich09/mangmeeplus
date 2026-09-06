# Agent Memory: receipt-charge-vat-mode

Status: PR #447 (`codex/receipt-charge-vat-mode`). First cut `d300b144` was reviewed NOT READY; this
round applies the controller's decisions — R1 (the ROUNDING row withdrawn), F5, F6, F9, F11, F14 —
and records F7, F8, F10, F13 as findings. Not merged.
Owner: Owner (UAT report 2026-09-06, build 178d3fb6)
Scope: `apps/api` receipt OCR apply service + the LINE capture/check-bill replies. No contracts, web,
gateway, schema or migration change — `expenseLineCharges` already exists.

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

2. **WITHDRAWN: the synthesized `ROUNDING` charge line.** The first cut answered a whole-baht VAT
   box by adding a `ปัดเศษ` charge row for the remainder. The review's accounting proof retired it.
   Three readings of the Owner's check bill — goods 725.00, Gratuity 72.00, VAT box "56", total
   853.00, where 7% of 797.00 is 55.79:

   | | taxable | VAT | grand | what it claims |
   |---|---|---|---|---|
   | **C** computed, rows as printed | 797.00 | 55.79 | 852.79 | the arithmetic of the rows |
   | **A** with the synthesized ปัดเศษ 0.21 row | 797.21 | 55.79 | 853.00 | a tax base of 797.21 |
   | **B** rows as printed + `ใช้ยอดตามเอกสาร` | **797.00** | **56.00** | **853.00** | the tax invoice |

   A reaches the printed total by inflating the TAX BASE with 0.21 of supply that does not exist, and
   its VAT is still not the printed 56.00 — so the record matches no document: not the invoice
   (whose base is 797.00) and not the arithmetic (whose total is 852.79). The remainder a merchant
   creates by printing a whole-baht VAT box is a fact about the TAX, and B puts it there. B needs no
   new code: `acceptExpenseVatSource` — the reviewer's existing "ใช้ยอดตามเอกสาร", `expense.review` +
   a written reason + a named VAT line — already moves a residual onto one VAT-bearing line and
   leaves the base alone.

   **What replaces it (R1).** `reconciledTotals` accepts the rows AS PRINTED when the printed VAT box
   is a whole baht: the VAT and grand-total comparisons widen from ฿0.05 to under ฿1.00, in either
   direction, while the taxable comparison never moves. Guarded by `printedVatIsWholeBaht`:
   `Number.isInteger(printedVat)`, a printed grand total to carry the same remainder, the candidate's
   own `subtotalAmount` reaching the printed subtotal, and — when the page printed an item block —
   those rows summing to the printed subtotal too (F3: an items-vs-subtotal disagreement is a
   different disagreement and must keep landing as `ITEMS_DID_NOT_RECONCILE`, with both numbers).

   Nothing is accepted by the widening: the record keeps the COMPUTED VAT (55.79) and grand total
   (852.79), the VAT capture snapshot stays `MISMATCH`, and the §7.5 confirmation block still stands
   between the draft and a confirmation. All it decides is whether the reviewer sees the document's
   real rows or a single folded summary line with the gratuity deleted. The remainder is named in the
   reviewer's own words by `RECEIPT_REVIEW_REASONS.vatRounding` +
   `vatRoundingReason(remainder)` — "บิลปัดเศษ VAT เป็นบาทเต็ม ต่างจากที่คำนวณ 0.21 บาท – กด
   ใช้ยอดตามเอกสาร เพื่อบันทึกตามใบเสร็จ" — which names the amount, the sign and the one control that
   records the printed figure.

   **Deviation from the brief, flagged for the controller.** The brief said `≤ 0.50` in either
   direction AND required the fixture "printed VAT 55 / total 852" to keep its rows with a −0.79
   remainder reason. Those two cannot both hold: 55.79 − 55 = 0.79. The implemented window is
   `MAX_WHOLE_BAHT_VAT_ROUNDING = 1` (strictly under one baht), because
   (a) the named fixture is the concrete acceptance criterion and a POS that TRUNCATES its VAT box
   (Thai ปัดเศษทิ้ง, 55.79 → 55) is as real as one that rounds (→ 56), and a 0.50 window would fold
   exactly those bills and delete their charge rows — the bug under repair; and
   (b) the window is safe at 1.00 because it accepts no amount: the record still carries the computed
   VAT, still reads `MISMATCH`, and still blocks confirmation until a reviewer answers. One line to
   revert if the Owner wants 0.50: the constant, and the truncation fixture's expectation.

3. **One source of truth for the LINE card.** `apply()` now returns `charges: ExpenseChargeSummary[]`
   built by the shared `expenseLineCharges` over the rows it actually wrote. `formatPaypersReply`
   takes `options.charges` and lists those; `receiptItemLines` takes them too, and
   `formatGroundedReceiptFollowUp` passes `expense.charges` (already on
   `ExpenseRecordWithRelations`). When the apply folded them, the card prints one honest line —
   `➕ ค่าบริการ 13.00 ยังรวมอยู่ในยอดเดียว – ตรวจแยกบนเว็บ` — instead of listing them as recorded.
   Charge names on the card now come from the `EXPENSE_LINE_CHARGE_KIND_LABELS` constant rather than
   model-authored free text, which also removes OCR prose from a LINE reply.

4. **An outcome says what the RECORD carries, and a card claims only what THIS apply did (F5/F12).**
   Two `apply()` outcomes write no lines: a rerun that must PRESERVE reviewed lines, and one skipped
   because the record moved under the OCR round trip. Both returned `charges: []`, which the card
   read as "the charges were folded into one total" — and printed that sentence over records that
   carry a real `SERVICE_CHARGE` row. Both now return `expenseLineCharges` over the record's CURRENT
   lines (the `findFirst` select gained `chargeKind`, `lineSubtotalAmount`, `vatAmount`), and the
   stale path returns a whole, honest `ReceiptOcrApplyOutcome` instead of an
   `as unknown as` cast that omitted half of it (F12). The card's folded line now needs positive
   evidence of a fold: `formatPaypersReply` takes `chargeReconciliation` and prints
   "ยังรวมอยู่ในยอดเดียว" only for `chargesApplied === 0` with a genuinely folded status
   (`FOLDED_INTO_SUMMARY_NEEDS_REVIEW` / `ITEMS_DID_NOT_RECONCILE`). Call sites with no apply outcome
   claim nothing.

5. **The check-bill lane keeps the apply outcome (F6).** Answering "1" on a check bill runs the same
   `receiptOcrApply.apply` as the photo lane and then discarded its result, composing
   `aiVerificationSummaryJson` from scratch: every review reason the apply had just raised — the
   whole-baht VAT remainder included — was dropped, and the reply never named the charge row the
   apply had written. `resolvePendingCheckBillAction` now keeps the outcome, merges
   `reviewReasons` into the summary JSON, and passes `outcome.charges` to
   `formatCheckBillDraftCreatedReply`, which lists them through the SAME `chargeSummaryLines` helper
   and the same `EXPENSE_LINE_CHARGE_KIND_LABELS` constant as the capture card.

6. **A charge kind is a label only if it is a kind (F9).** `EXPENSE_LINE_CHARGE_KIND_LABELS[kind]` on
   EXTRACTOR-supplied kinds resolves `constructor` / `__proto__` to an `Object.prototype` member — a
   truthy value the `?? 'ค่าใช้จ่ายเพิ่ม'` fallback never replaced, so the card would have printed
   "function Object() { [native code] } 13.00". `chargeKindLabel` validates against
   `RECEIPT_ADDITIONAL_CHARGE_KINDS` first.

7. **The printed mode may correct a guess, never a tax position (F11).** `printedVatMode` no longer
   overwrites a deliberate `EXEMPT` or `NEEDS_REVIEW` `vatMode` — only `VAT_INCLUDED`,
   `VAT_EXCLUDED`, `NO_VAT` and words that are not modes at all. Same line the adjacent `provenVat`
   rule already refused to cross: a supply exempted by law does not become taxable because a box on
   the slip adds up.

8. **One guard for the extractor's charge block (F14).** `completeVatFields:239` reached
   `fields.additionalCharges?.some(...)` on raw model JSON and threw a `TypeError` on a string,
   taking the whole apply — and the draft — with it, BEFORE the `Array.isArray` guard inside
   `printedVatMode` could help. Every reader (`verifyDiscountAmount`, `printedVatMode`,
   `completeVatFields`, `receiptFallbackLineTotal`, `prepareOcrLines`) now routes through one
   `ocrCharges(fields)` helper, and the duplicated inline guards are gone.

## Fixtures (all four are real, verbatim)

| Fixture | Source | Before | After |
|---|---|---|---|
| HOUSE TANGO 153.01 | UAT `cmtp9v5bc00931u2uznumjslm` | FOLDED, 1 line, charges 0 | RECONCILED_CHARGE_LINES, base 130 + SERVICE_CHARGE 13 @ 7%, taxable 143.00, VAT 10.01, total 153.01 |
| 4,331.36 bill | UAT `cmtp9ul5d008e1u2u4yqkx2ee` / `cmtp9tw7q007o1u2ua08kb0t9` | FOLDED, 1 line, charges 0 | RECONCILED_CHARGE_LINES, base 3,680 + SERVICE_CHARGE 368 @ 7%, taxable 4,048.00, VAT 283.36, total 4,331.36 |
| VAT-included control | synthetic (100 + 10 charge, VAT 7.20, total 110) | — | stays `VAT_INCLUDED` |
| Owner check bill | 270+160+190+30+50+25 = 725, Gratuity 72, VAT 56, total 853 | ITEMS_DID_NOT_RECONCILE, charges 0 | RECONCILED_ITEM_LINES, 6 goods + Gratuity 72 (7 rows, no ปัดเศษ row), subtotal 725.00, taxable 797.00, VAT 55.79, total 852.79, snapshot MISMATCH + `vatRounding` reason; after `acceptExpenseVatSource`: 797.00 / 56.00 / 853.00 |
| Owner check bill, VAT box truncated | the same bill printing VAT 55, total 852 | — | same 7 rows, no invented negative line, reason names −0.79 |

## Verification

Round 2 (the review fixes), all from this worktree:

- `receipt-ocr-apply.service.spec.ts` — RED first, **11 failing** across R1/F11/F14/F5/F12
  (`keeps the gratuity…`, `lands on the printed 797 / 56 / 853…`, `keeps the rows … truncated its
  VAT down`, `never widens the subtotal comparison…`, `leaves a deliberate EXEMPT mode alone`,
  `leaves NEEDS_REVIEW alone`, `treats a non-array additionalCharges…`, `survives a non-array …
  through the whole apply`, `returns the persisted charge rows when a reviewed line layout is
  preserved`, `… when the apply is skipped as stale`) → **99/99 pass**.
- `process-line-webhook.use-case.spec.ts` — RED first, **4 failing** (`lists the persisted charges
  the way the capture card does`, `keeps the apply outcome when the check bill is confirmed as
  paid`, `claims no fold when no apply outcome is known at all`, `falls back to a plain label for a
  charge kind that is not one`) → **204/204 pass**.
- `receipt-truth.pg.spec.ts` against a throwaway `postgres:18.3-alpine` on port 15881 (`migrate
  deploy` + `prisma/sync-permissions.ts` first, container removed afterwards): **7/7 pass**,
  including the replacement for the withdrawn ROUNDING case — `records the check bill exactly as
  printed and invents no rounding row`: 7 rows, `chargeKind` `[null ×6, SERVICE_CHARGE]`, header
  725.00 / 797.00 / 55.79 / 852.79, snapshot `MISMATCH`.
- `line-intake-dispatch.use-case.spec.ts` 180/180 — it caught a real regression mid-round: reading
  `appliedOutcome.reviewReasons.length` threw on an outcome stub without the field and stranded the
  pending row at `PENDING`. Read totally now; a summary field may never throw away a user's turn.
- Mutation gate, 15 mutations, every anchor `count == 1`, each run against the spec that owns it:
  **15 killed, 0 survived.** Widening disabled / whole-baht guard dropped / cap widened to 100 /
  rows-vs-subtotal gate dropped / item block ignored / taxable comparison widened / remainder never
  named / EXEMPT overwritten / non-array guard dropped (59 failures) / preserved-lines charges
  emptied / stale charges emptied / card claims a fold with no outcome / charge kind indexed
  unvalidated / check-bill drops the reasons / check-bill reply stops naming the charges.
  The first run had **2 survivors** — the candidate-subtotal gate was dead code beside the item-block
  gate, and nothing distinguished a widened taxable comparison. Both fixed: the two gates are now one
  `rowsSubtotal` comparison, and `never widens the taxable comparison, even with a whole-baht VAT
  box` (printed `taxableAmount 797.60`) is the fixture that kills M6.
- `spec-suite-coverage.spec.ts` 3/3 (no new spec file, so no `package.json` edit).
- `tsc --noEmit` on `apps/api` exit 0 (`NODE_OPTIONS=--max-old-space-size=8192`).
- `node apps/api/scripts/check-di-metadata.mjs` — 794 files, 870 decorated classes, 820 with
  constructor dependencies, all clean.
- `pnpm --filter @watchdog-bms/api test` (full fixed list, 469 specs) exit 0, ~9,604 dot passes, no
  `✖`; `test:boot` — "boot-di-smoke: Nest resolved every provider in 135ms".
- `node scripts/run-line-ai-whole-chain-acceptance.mjs` exit 0 (21 repository scenarios, 3 controlled
  external, 8 suites, 10.1s).
- Heavy suites ran under the `mkdir /tmp/mangmee-heavy.lock` mutex, released with `rmdir` afterwards.

### The four fixtures, full apply output (round 2)

```
HOUSE TANGO 153.01     RECONCILED_CHARGE_LINES chargesApplied 1  vatMode VAT_EXCLUDED
                       header 130.00 / 143.00 / 10.01 / 153.01   snapshot MATCHED 0.0000
                       #1 ck=null u=130.0000 rate="0.0700" vat=9.1000
                       #2 ck=SERVICE_CHARGE u=13.0000 rate="0.07" vat=0.9100
                       charges [SERVICE_CHARGE ค่าบริการ 13.0000 / 0.9100]
4,331.36 bill          RECONCILED_CHARGE_LINES chargesApplied 1  vatMode VAT_EXCLUDED
                       header 3680.00 / 4048.00 / 283.36 / 4331.36  snapshot MATCHED 0.0000
                       #1 ck=null u=3680.0000 rate="0.0700" vat=257.6000
                       #2 ck=SERVICE_CHARGE u=368.0000 rate="0.07" vat=25.7600
VAT-included control   RECONCILED_CHARGE_LINES chargesApplied 1  vatMode VAT_INCLUDED (unchanged)
                       header 100.00 / 102.80 / 7.20 / 110.00
Owner check bill       RECONCILED_ITEM_LINES   chargesApplied 1  vatMode VAT_EXCLUDED
                       header 725.00 / 797.00 / 55.79 / 852.79  snapshot MISMATCH 0.2100
                       7 rows: 6 goods @0.0700 + ค่าบริการ 72.0000 @0.0700 — no ROUNDING row
                       reason "บิลปัดเศษ VAT เป็นบาทเต็ม ต่างจากที่คำนวณ 0.21 บาท – กด ใช้ยอดตามเอกสาร เพื่อบันทึกตามใบเสร็จ"
  after acceptExpenseVatSource(line 1): taxable 797.0000  VAT 56.0000  grand 853.0000
                       (line 1 VAT 18.90 → 19.11; snapshot REVIEWER_ACCEPTED; subtotal 797.0000 — F8)
Same bill, VAT box 55  RECONCILED_ITEM_LINES   chargesApplied 1  same 7 rows, no negative line
                       header 725.00 / 797.00 / 55.79 / 852.79  snapshot MISMATCH -0.7900
                       reason "… ต่างจากที่คำนวณ -0.79 บาท – …"
```

## Review findings recorded, NOT fixed (controller decision, 2026-09-06)

Each was reproduced through the real functions before it was written down; the outputs below are
verbatim from those runs.

### F7 — a mislabelled-inclusive bill that also prints a discount is rewritten before the mode is decided

`apply()` calls `completeVatFields(verifyDiscountAmount(fields))`, so the discount is verified while
`fields.vatMode` still holds the extractor's word. `verifyDiscountAmount` takes its charged base from
that word (`vatMode === 'VAT_EXCLUDED' ? taxable : grand`), so on a bill the extractor mislabelled
`VAT_INCLUDED` the base is the gross and the implied discount absorbs the whole VAT:

```
in : { vatMode: VAT_INCLUDED, subtotal 150.00, discount 20.00, SC 13.00, vat 10.01, total 153.01 }
out: { … discountAmount: "9.99" … }        # implied = 150 + 13 − 153.01 = 9.99, and 20.00 is replaced
```

Pre-existing (the discount verifier and the mode proof were written in different rounds) and out of
scope here. The fix is an ordering question — the mode proof would have to run first, or
`verifyDiscountAmount` would have to try both bases — and it changes a money path the review-save
flow shares, so it needs its own slice. No live example yet: no UAT bill so far prints a discount AND
a charge AND a mislabelled mode together.

### F8 — `reconcileExpenseVat` drops `chargeKind`, so a recomputed header counts charges as goods

`expense-vat-reconciliation.logic.ts:492` returns
`accepted.map(({ lineNumber, vatRate, totals }) => ({ lineNumber, vatRate, totals }))` — the
`chargeKind` flag that keeps a charge row out of `subtotalAmount` is not carried. Every later
`calcDocumentTotals({ lines: documentTotalsLines(result.lines) })` therefore treats every row as
goods. TWO call sites do exactly that:

- `expense-wht-input.logic.ts:51`, whenever a printed WHT is applied. The check bill with `whtRate
  0.03` writes `subtotalAmount 797.0000` for 725.00 of goods, and
  `expenseTotalsIdentityError` → `"Totals identity: subtotal 797.0000 is not the 725.00 the product
  lines add up to."` — persisted, because the apply's `expenseRecord.update` does not re-check it.
- `acceptExpenseVatSource:286`, the reviewer's "ใช้ยอดตามเอกสาร". Variant B above lands
  `taxable 797.0000 / vat 56.0000 / grand 853.0000` — correct — but `subtotal 797.0000`, and the same
  identity error. **This is the one that matters most**: it is the control R1 hands the reviewer, so
  a charge-bearing bill accepted at the printed VAT produces a header that fails the §5.1 identity.

Pre-existing (it predates this branch — nothing here touches either file) but plainly MORE reachable
now that charge rows are actually written. The fix looks like one line at `:492` (carry `chargeKind`
through the returned rows) plus its type; it is shared money logic used by the web review save, so it
belongs in its own change with its own gates, not in a card/VAT-mode fix. Pinned by an assertion in
`receipt-ocr-apply.service.spec.ts` ("F8: the gratuity is wrongly counted as goods") so the day it is
fixed, that test fails and points here.

### F10 — a charge's own rate string makes a single-rate bill read as MIXED (provenance only)

A charge whose OCR entry carries its own `vatRate` keeps the raw string while product rows get the
4-dp normalized one, so `reconcileExpenseVat` sees two spellings of one rate:

```
HOUSE TANGO: rates "0.0700", "0.07"  →  calculation.formula "MIXED", vatRatePercent null
```

Both are 7%, the `Decimal(18,4)` column and the web `vatRatePreset` both normalize, and no amount
moves — the damage is provenance: a plainly single-rate bill is stamped MIXED. Normalizing would flip
the existing green assertion `assert.equal(tip.lines[1].vatRate, '0')`, which is a deliberate test of
"an explicit zero survives verbatim", so it needs that test's intent re-decided first.

### F13 — the ±0.05 tolerance is asymmetric at exactly the boundary

`closeEnough` compares IEEE doubles (`Math.abs(a − b) <= 0.05`), and at exactly five satang the
answer depends on the binary representation of the pair, not on the money:

```
100.00 vs 100.05 → 0.049999999999997158  accepted
143.00 vs 143.05 → 0.050000000000011369  REJECTED
  1.10 vs   1.05 → 0.050000000000000044  REJECTED
  3.00 vs   2.95 → 0.049999999999999822  accepted
```

So a bill that misses by exactly ฿0.05 reconciles or folds depending on its magnitude. Every other
money path in this codebase uses `Decimal`; this comparison predates the charge work and was left
alone deliberately — changing it moves the accept/reject line for existing records, which is a
behaviour change that needs its own fixtures. The whole-baht widening added here does not make it
worse: `MAX_WHOLE_BAHT_VAT_ROUNDING` compares at 1.00, far from any satang boundary.

## Next

- **Controller decision needed on the window**: `MAX_WHOLE_BAHT_VAT_ROUNDING = 1` (under one baht,
  either direction) versus the brief's `≤ 0.50`. See the deviation note in decision 2 — 0.50 folds
  the truncating-POS bill the brief itself named as a required fixture.
- **F8 blocks the story R1 tells.** `ใช้ยอดตามเอกสาร` on a charge-bearing record lands the right
  taxable/VAT/grand but writes `subtotalAmount 797.00` for 725.00 of goods and fails the §5.1
  identity. R1 is still an improvement without it (the rows survive, the reviewer sees the real bill
  and the remainder is named) but "the reviewer can land the record on the tax invoice" is not true
  until F8 is fixed. Smallest known fix: carry `chargeKind` through
  `expense-vat-reconciliation.logic.ts:492`, with its own gates.
- Owner acceptance on UAT: re-send the HOUSE TANGO and 4,331.36 bills and confirm the card's
  `➕ ค่าใช้จ่ายเพิ่ม` block matches the web record's charge rows; and send the check bill, answer
  "1", and confirm the reply names ค่าบริการ 72.00 and the review page shows the ปัดเศษ VAT reason.
- Merge decision and deploy ride-along; no flag, no migration, no config.
