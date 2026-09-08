# Real receipt sample evaluation — 2026-09-08

Status: baseline investigation retained below. Owner subsequently authorized implementation; final local candidate results are appended. Canonical UAT deployment is pending and Production remains held.

## Outcome

The current document AI does not reliably preserve these documents through extraction, financial application and review-form projection. Ten supplied images represent nine unique documents (A1 and B4 are byte-identical). In the baseline, seven calls returned an OCR response usable by the apply gate and three failed. **Seven usable responses does not mean seven correct documents.**

The most consequential findings are invented VAT on a no-VAT transport receipt, deterministic substitution of the buyer's tax ID for the seller's, loss of service/item breakdowns, and a reproducible form projection that combines a financial summary with unbound OCR items. A separate token-budget experiment recovered two failed responses but exposed mixed-VAT arithmetic drift and incorrect item/price alignment. Increasing the output budget alone is insufficient.

## Method and evidence boundaries

- Evaluated on 2026-09-08 using real AWS Bedrock calls to `global.anthropic.claude-sonnet-4-6` in `ap-southeast-1`, matching the document model read from UAT configuration.
- Local source: `93f1d3db795d2d015bb2123ef60ac07d90d237a4`. `git diff --name-only 88a08ae3e8e93fe12840f1c46c006945fb96b3c8 HEAD -- apps/ai-gateway/src/modules/line-ai apps/api/src/modules/expenses apps/web/src/features/expenses packages/contracts` returned no differences. The compared paths match the UAT source recorded in the release evidence; this is not a claim that a local harness reproduces every deployed integration.
- Executed the actual `LineAiInternalController.receiptOcr`, including image reading, field extraction, parser, cross-check and the existing bounded image reread. Used original JPEG orientation and bytes; no image correction or manual answer was supplied to the model.
- Used the existing seeded Thai expense-category names with synthetic IDs, not Drtb's exact tenant category state.
- Executed the actual `ReceiptOcrApplyService.apply` with in-memory repository/transaction substitutes. Captured its record updates and line creates. No expense, payment, confirmation, tax event or customer message was written to UAT/Prod.
- Executed `sourceDraftState`, `projectExpenseSourceDraft`, `reviewValues` and `validateExpenseReview` against those captured writes with a LINE-shaped draft summary. The summary shape follows the LINE webhook's recognized-fields and charge-reconciliation composition. This is a deterministic projection, **not** a live browser save/reload or Next test.
- Not exercised: the initial LINE intake router and its reused transcription, tenant authorization, real database constraints, duplicate detection against actual records, quota accounting, HTTP timeouts, notifications, final posting or real tax filing. A live LINE route can produce a different initial transcription.
- Independent visual transcription was recorded in the private manifest before model calls. Unknown or unprinted tax amounts/rates are not scored as printed zero or as legally established tax treatment.
- Baseline: 24 Bedrock calls, two documents in parallel; end-to-end median 24.87 seconds, range 20.87–40.04 seconds. These small-sample timings exclude the LINE intake, queue and real persistence.
- One baseline attempt per supplied image; A1/B4 provide one consistency repeat. This is a regression sample, not a population accuracy estimate.

Private raw evidence, traces and runnable harnesses: `/tmp/mangmee-receipt-eval-20260908/`. Images and raw model outputs include medical/person data and are intentionally excluded from repository artifacts. Retain them privately for this investigation; this path is temporary, not a permanent audit store.

## Sample index and independently visible money

Batch A directory suffix: `8ebf4ab3-3767-4cc1-ad0c-c4884d4a880b`; batch B: `91406939-99a4-46bc-84f0-d6fc729c8ad9`. Both are under the attachment root for task `01a0778d-a88f-76c2-a9d4-334b53165360`; each uses `<n>-Photo-<n>.jpg`.

| Case | Document | Visible financial facts | Important distinction |
| --- | --- | --- | --- |
| A1 / B4 | Hospital invoice, 7 Sep | 200 + 420 + 1,200 = 1,820.00; discount 0 | Invoice/COPY; no automatic settled-payment conclusion. Three priced rows, not section headings. |
| A2 | Shichi | Items 1,360 + service 136 + VAT 104.72 = 1,600.72; rounding −0.72; payable 1,600 | Summary food/dessert/beverage rows repeat the six item rows. Rounding is separate from VAT. |
| A3 | MaxValu | Six rows/eight units; gross 400; pre-VAT total 389.47; VAT 10.53; printed VAT-sales base 150.47 | N-marked gross 239 and taxable gross 161. Cash 1,000 and change 600 are not expense totals. |
| A4 | Pepper Lunch | 279 + 25 + 17 = 321; VAT INCLUDED | VAT amount/rate are not printed. A calculated tax suggestion must not become claimed OCR evidence. |
| A5 | S&P | Seven item amounts 175, 168, 168, 15, 85, 68, 150 = 829; service 61; gross 890; VAT 58.22 included | Do not infer the meaning of E/T item suffixes as tax treatments. Do not invent a service percentage. |
| B1 | Shipnity Express | Shipping credit 5,000; explicitly printed WHT 1% = 50; transfer 4,950 | Credit/prepayment meaning requires business review; a correct amount alone does not establish expense recognition. |
| B2 | TCAT, rotated | 690.80; VAT column says ไม่มี; WHT 6.91; paid amount 683.89 | Rate not printed. Preserve the transport issuer and the buyer/issuer roles. |
| B3 | Hospital invoice with discount | Six amounts 683.64, 2,200, 350, 200, 420, 2,000 = 5,853.64; discount 68.36; total 5,785.28 | Table headings must not shift price-to-description alignment. COPY and a received stamp are evidence, not permission to create a payment. |
| B5 | TCAT with coupon | Freight 8,224.45 − coupon 6,300 = 1,924.45; WHT 82.24; paid amount 1,842.21; VAT ไม่มี | WHT amount is not the same as a verified statutory rate/base; coupon is not another positive purchase. |

Dates observed: A1/B4 2026-09-07; A2 2026-09-06; A3/A4 2026-09-01; A5/B3 2026-09-04; B1 2026-08-21; B2 2026-08-20; B5 2026-08-15. All usable baseline responses retained these dates. Ambiguous fine-print document IDs and item spellings are not scored as exact matches.

## Baseline results

| Case | AI/extraction result | In-memory application / limitation |
| --- | --- | --- |
| A1 / B4 | Both returned total 1,820 and three correct monetary rows; classified as supplier invoice, DUE | Three rows and total 1,820 preserved. Category suggestions differed in confidence and were not auto-filled. Repeat consistency is demonstrated only for these monetary facts. |
| A2 | Correct total, VAT, service and six items; printed negative rounding omitted from fields | Applied total 1,600/VAT 104.72, but collapsed six items plus service into one summary. Stored pre-VAT base 1,495.28 instead of retaining 1,496 with a separate −0.72 settlement rounding. `ITEMS_DID_NOT_RECONCILE`; charges applied 0. |
| A3 | `OCR_JSON_PARSE_FAILED` | Extraction stopped at `max_tokens` = 1,200 in an unfinished object. No apply was attempted. This is not evidence that the image could not be read. |
| A4 | Total 321 and three rows correct; VAT INCLUDED with no printed VAT amount/rate recovered, including reread | Stored total 321 with no captured tax input. Form validation requires a rate for each VAT row. The missing tax evidence still needs an understandable resolution; stored zero must not be described as proven zero VAT. |
| A5 | `OCR_JSON_PARSE_FAILED` | Extraction stopped at `max_tokens` = 1,200 mid-item. Its first-stage transcript also shifted prices down one description row. No apply attempted. |
| B1 | Correct gross 5,000, WHT 50 and printed 1% | Applied net 4,950; WHT capture uses AMOUNT. Form still requires payee entity kind before withholding confirmation. This is an appropriate remaining tax fact, not proof that final tax processing is complete. |
| B2 | Gross/WHT correct, but invented VAT 45.19 and tax base 645.61, misidentified transport company as CAT telecom, and misread document number | Accepted VAT 45.19, total 690.80/net 683.89; VAT reconciliation says MATCHED. Correct total and internally consistent math conceal wrong source tax facts. |
| B3 | Valid JSON with total 5,785.28, but missing classification `confidence` and `evidenceRoles` | Entire parse rejected under `OCR_JSON_PARSE_FAILED`. Transcription also misaligned line descriptions/amounts and the extracted item set omitted the 420 row. No apply attempted. |
| B5 | Correct subtotal, coupon, gross and WHT; seller name misread; raw model intentionally omitted vendor tax ID | Cross-check filled the only 13-digit number from the buyer block into `vendorTaxId`. Applied gross 1,924.45/WHT 82.24/net 1,842.21, with the wrong party identity. Fallback staging also leaves quantity/unit price blank despite a persisted summary row. |

## Isolated output-budget experiment — not a product fix

Retained baseline files unchanged. For A3 and A5, replayed their identical first-stage baseline transcription and raised only the extraction call's output ceiling from 1,200 to 2,400 in the temporary harness. The normal conditional reread was allowed and did occur for A3. Results are saved under `budget2400/`.

- A3 extraction completed at 1,411 tokens; the subsequent reread/extraction completed at 1,483. Six rows with gross sum 400 and two N-marked non-VAT rows survived extraction. Application then reduced the mixed bill to one summary row, derived an effective rate of 0.0270, stored VAT 10.52 and gross **399.99**, rather than printed 10.53 and 400.00. The snapshot retained the original 7%/10.53 evidence and reported MISMATCH. A ratio over mixed taxable and untaxed bases is not the printed tax rate.
- A5 completed at 1,042 tokens (below the old cap on this stochastic repeat). Therefore the repeat alone does not prove the cap caused its improvement; the **baseline `max_tokens` trace** proves the earlier truncation. Total 890, VAT 58.22 and service 61 were preserved, but six misaligned item rows summed to 654. Application retained merchandise summary 829 plus service 61, losing the seven actual item details. This is still not an accurate item extraction.
- The experiment shows why budget repair is necessary for dense output but insufficient for correctness. It is not a measured accuracy improvement and is not deployed. No case-specific expected amount, vendor or rate was inserted into a prompt.

## Form projection and adjacent impact

The actual source-draft and web helpers reproduce the following without a database write:

| Case | Financial rows | Staged rows | Form rows | Validator outcome |
| --- | ---: | ---: | ---: | --- |
| A1 / B4 | 3 | 3 | 3 | No field issues in this projection; not final tax/permission acceptance. |
| A2 | 1 | 6 | 7 | Total warning: 2,959.95 versus 1,600.00. |
| A4 | 3 | 3 | 3 | Missing VAT rate errors on three rows. |
| B1 / B2 | 1 | 1 | 1 | Payee entity-kind required for WHT. B2's invented VAT is not caught here. |
| B5 | 1 | 1 | 1 | Payee kind, quantity and unit-price errors. |
| A3 budget experiment | 1 | 6 | 7 | Total warning: 799.99 versus 400.00. |
| A5 budget experiment | 2 | 6 | 8 | Total warning: 1,544.00 versus 890.00. |

The summary row remains while unmatched source items are inserted by `reviewValues`. The helper's total mismatch is a warning, not a field error. This proves a projection/validation gap and a route for the previously reported duplicate-form confusion. It does **not** prove an inflated ledger posting: save/Next/backend confirmation may impose additional gates and were not executed.

## Root causes with source evidence

1. **Output completeness and classification contract.** `line-ai-internal.controller.ts:283–310` always budgets 1,200 extraction tokens, ignores successful provider `stopReason=max_tokens`, and maps both malformed JSON and rejected classification to one parse error. `business-document-classification.logic.ts:73–102` requires classification confidence and an evidence-role array. B3 has valid JSON but neither required property; `diagnostics.json` reproduces rejection. Do not fix by bypassing classification or inventing a high confidence.
2. **Transcription is treated as proof, although it can hallucinate.** In B2, the image reader invented telecom context and tax figures, then the reread invented 45.19 as “partially visible”. `applyOcrValueCrossCheck` checks values against that generated transcript, not against image regions. A hallucinated number repeated by the reader consequently passes. Arithmetic reconciliation is a consistency check, not evidence that VAT was printed.
3. **Seller/buyer binding is absent from deterministic identity recovery.** `line-ai-internal.controller.ts:755–772` validates 13-digit presence anywhere and fills a single candidate anywhere. For B5 the model output and parser have no vendor tax ID; cross-check adds the number in the explicitly labelled buyer block. `diagnostics.json` confirms all three stages. Vendor existence/checksum alone cannot establish party role.
4. **Mixed VAT is collapsed into an aggregate rate.** `receipt-ocr-apply.service.ts:243–290` can reject printed 7% against an all-item pre-VAT base and derive VAT/base rounded to four decimals. The A3 experiment produces 2.7%, discards the six-row mixed treatment and changes accepted money by one satang. Preserve separate taxable and non-VAT bases and per-line treatment rather than deriving a document rate from a blended base.
5. **Signed rounding has no complete OCR-to-money path.** The OCR prompt puts negative rounding in discount; the additional-charge parser accepts only positive amounts, and `prepareOcrLines` explicitly excludes negative ROUNDING while downstream paths support signed rows in other contexts. A2's after-tax −0.72 cannot be represented faithfully through this route. Do not “fix” reconciliation by altering the printed VAT/base or mislabelling settlement rounding as a pre-tax discount.
6. **Row layout and incomplete-item fallback.** A5/B3's first-stage text attaches prices to the next description or heading. Exact-span matching can validate that incorrect transcript without validating row geometry. Summary fallback prevents some incorrect item arithmetic, but source staging then adds those unbound items to the summary. `expense-source-draft.logic.ts:95–143` and `expenses.model.ts:485–551` reproduce this. One receipt needs one editable financial representation.
7. **Evidence omissions become awkward form states.** A4 preserves “VAT included but amount not printed”, while the form requires row rates; B5 source staging cannot bind complete summary defaults to incomplete source quantity/price. Required tax facts must be resolved visibly at the appropriate boundary without making draft capture impossible or changing the agreed form.

## Proposed correction order and acceptance rules

These are recommendations for a later spec/implementation decision, not approved product changes in this investigation.

1. **Protect source truth and identity first.** Separate seller, buyer, patient/beneficiary and staff/contact blocks. Require role-bound evidence for tax IDs; never fill a seller ID merely because a single ID exists. Keep uncertain text unknown. Reader instructions/layout handling should address original orientation, foreground-document selection and table alignment. Test those changes with fresh/repeated samples; no template/vendor-name hardcoding.
2. **Recover structured output without unsafe success.** Detect truncation separately from invalid JSON and incomplete classification. Use an adequate bounded budget, schema-constrained output if supported by the actual provider, and at most a bounded repair/retry appropriate to the failure. Preserve the attachment and validated facts as an incomplete draft when completion fails. Retry must not create another expense or consume another successful-read quota. Do not weaken business-document gates or report guessed values as extracted evidence.
3. **Preserve accounting identities across layers.** Explicitly represent merchandise, discount/coupon, service, signed settlement rounding, taxable/non-VAT bases, VAT, gross, WHT and net payment evidence. Keep the printed WHT amount separately from an unverified rate/base. Do not infer a statutory rate from inverse arithmetic or default all WHT to 3%. Each accepted change must preserve the supported gross/VAT/net identity or show an unresolved reconciliation state before final confirmation.
4. **Keep one PANDA MALA review form.** Bind source rows to financial rows, or replace the fallback summary when materializing items; never add both to totals. Preserve unknown source facts without clearing known accepted facts. Continue to allow saving a draft. Final confirmation must not accept an unresolved duplicated-row total merely because it is only a warning.
5. **Keep the customer journey simple.** The merchant sees the original image, seller/date, accepted total, important service/discount/VAT/WHT/net amounts and one review action. Use the existing labels and field errors, no second missing-fields checklist and no automatic chat questionnaire. Example when unresolved: “เก็บรูปและแบบร่างไว้แล้วค่ะ กรุณาตรวจยอดภาษีในเว็บก่อนยืนยัน”. Admin support can see raw extraction, accepted values, failure stage, model version and correlation IDs; customer copy should not expose those codes.

Acceptance examples:

- Shichi keeps six items, service 136, VAT 104.72, settlement rounding −0.72 and gross 1,600 through LINE summary, form, save/reload and DB readback; no doubled rows.
- MaxValu keeps six rows/eight units, separate non-VAT 239 and taxable gross 161, printed VAT 10.53 and gross 400. No blended 2.7% or one-satang drift.
- S&P keeps seven correct description/price pairs and service 61, gross 890/VAT 58.22; does not invent E/T semantics.
- Rotated TCAT retains transport identity, no printed VAT, WHT 6.91 and net 683.89; never fabricates 45.19.
- Coupon TCAT keeps the 6,300 adjustment once, gross 1,924.45/WHT 82.24/net 1,842.21; buyer ID is never installed as vendor ID.
- Hospital documents preserve row totals and discount, distinguish invoice/payment evidence, avoid unnecessary patient names in the ordinary expense title, and do not create confirmed tax/payment records from OCR alone.
- Pepper Lunch distinguishes unprinted VAT from zero VAT; a reviewer can resolve it through existing controls without an opaque or hidden-field error.
- Repeats, retries, malformed/truncated responses, abandonment, manual correction, save/reload, permissions and quota boundaries must be tested separately. The A1/B4 duplicate in this benchmark is not a duplicate-detection acceptance test.

## Reproduction and next state

Baseline (requires the private supplied attachments and an authorized Bedrock profile):

```sh
AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 pnpm --filter ./apps/ai-gateway exec tsx /tmp/mangmee-receipt-eval-20260908/benchmark.ts
```

Do not overwrite the original baseline when investigating a candidate. Existing isolated experiment: `budget-experiment.ts A3 A5`, writing `budget2400/`. Pure diagnostics: run `diagnostics.ts` from the AI gateway package and `projection.ts` from the web package. Running the combined imports from web initially failed on gateway parameter decorators; splitting those two harnesses resolved the tool setup without a repository configuration change.

Files: `A1.json`…`B5.json`, `manifest.json`, `budget2400/A3.json`, `budget2400/A5.json`, `diagnostics.json`, `projection.json`. Product files/package manifests unchanged. No new dependency, commit, push, cloud configuration change or deployment.

Next: agree implementation scope with the owner, write the smallest relevant spec/plan, then fix and re-run these samples plus independent regression cases. Live UAT save/reload/Next, database readback and full LINE/quota smoke remain necessary; production still requires the owner's later approval. Broader legal/accounting research is in [receipt tax completeness](receipt-tax-completeness-2026-09-08.md).

## Implemented candidate re-evaluation — 2026-09-08

See [spec](../specs/receipt-tax-integrity-spec.md) and [implementation ledger](../plans/receipt-tax-integrity-plan.md). Baseline findings above describe the pre-change code, not the final candidate.

Final candidate-v5 calls the real Bedrock model on all15 supplied images, including the five later Makro/fuel/handwritten samples. All14 images with a printed final total retain gross and printed VAT/WHT/net through actual OCR and in-memory apply. Makro page1of3 has no printed final total; it remains incomplete and is not applied. No expected values were supplied to the model.

| Cases | Final local evidence | Remaining boundary |
| --- | --- | --- |
| A1/B4 hospital1820; B3 hospital5785.28 | Three/six priced rows respectively; discount68.36 retained on B3 | Invoice and medical context do not establish payment/deductibility. |
| A2 Shichi1600 | Six items, service136, VAT104.72, signed rounding−.72 | No automatic tax claim qualification. |
| A3 MaxValu400; A5 S&P890 | Six/eight rows respectively; VAT10.53/58.22; no duplicate source rows | Unknown E/T treatment remains unresolved. |
| A4 Pepper Lunch321 | Three rows/gross321 | Unprinted VAT rate has visible form validation; not silently set to zero. |
| B1 Shipnity5000; B2 rotatedTCAT690.80; B5 couponTCAT1924.45 | WHT50/6.91/82.24; net4950/683.89/1842.21; no invented VAT | Credit/coupon statutory base and payment classification require review. |
| C1 Makro page3of3 | Gross15532/VAT955.27 in two reconciled net tax groups; original discount345 retained in evidence, not deducted twice | Missing detailed pages; financial groups explicitly require review. Voucher220 is tender. |
| C2 same Makro invoice page1of3 | No fabricated final total, no apply | Page2 was not supplied; no automatic multipage assembly implemented. |
| C3 distinct exempt Makro invoice | 50×99=4950, zero VAT | Distinct document number must keep it separate from C1/C2. |
| C4 fuel | Quantity61.488/printedunit39.19; gross2409.70/VAT157.64, calculatedROUNDING−.01 clearly identified | Calculated adjustment is not claimed to be a printed receipt row. |
| C5 handwritten | Four rows1000/660/1440/400=3500, date3Sep2026 | Trade name/bank holder does not prove individual/company; unknown stays blank. |

All14 applied records project one accepted financial row set in the actual FE model; original OCR evidence does not duplicate money. Candidate-v5 elapsed roughly18–120 seconds per image; these timings exclude queue/real persistence. A subsequent read-truncation guard has focused regression coverage; all v5 transcripts were below its bound. This sample result is not a population accuracy score or a guarantee for every issuer spelling.

Separate real local Next/API/PostgreSQL/MinIO browser tests pass11/11, covering normal form, save/reload/Next, tax-base coexistence and failures. Real deployed UAT acceptance remains pending; no LINE/customer message, posting, payment or tax filing was sent by these harnesses.
