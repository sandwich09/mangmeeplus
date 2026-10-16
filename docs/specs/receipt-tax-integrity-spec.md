# Receipt tax integrity and one review form

Status: owner authorized specification, implementation, tests, UAT deployment and post-deployment acceptance on 2026-09-08. Production is not authorized.

## Product outcome and evidence

An owner can upload a receipt, see the supported facts, correct one ordinary PANDA MALA form, save an incomplete draft, and finish review without losing money, tax or item meaning. VAT and withholding are separate inputs and separate summary lines; both can coexist. The AI may preselect a clearly evidenced seller/payee entity kind, but cannot mistake the buyer/patient/contact for the payee or overwrite a reviewer decision.

Source findings: [receipt sample evaluation](../research/receipt-ocr-real-sample-evaluation-2026-09-08.md), [tax completeness research](../research/receipt-tax-completeness-2026-09-08.md). Extends the existing receipt-single-form, receipt-additional-charges-reconciliation and expense-wht-input-units-mixed-vat specs. Their permissions, draft/confirmation boundaries and existing form remain in force.

## Scope and viewpoints

| View | Required behavior / impact |
| --- | --- |
| Owner/customer, including older users | Same familiar form; readable Thai labels, themed selectors, no duplicate item sets, no code names, no unsolicited LINE questionnaire. Draft save retains work and gives success/failure feedback. |
| Accountant | Preserve printed gross, VAT, WHT, discounts, service and rounding; distinguish tax bases, unknown facts and accepted decisions. Party kind belongs to issuer/payee. Invoice does not itself create payment or establish deductibility. |
| Business/operator | Failed/partial reads have a useful recoverable state and support evidence; no duplicate expenses/quota from an internal retry. No unsupported claim that every tax filing is now automated. |
| AI | Output must be complete, schema-valid and evidence-bound. Keep reader/extractor failures distinct. No inferred tax number presented as printed, no buyer identity recovery into seller fields, no named-vendor hardcoding. |
| Architecture/backend | Existing permission-checked API, Decimal calculations, JSON source snapshots and optimistic transaction boundary remain authoritative. AI gateway has no database access. Old client inputs remain valid. |
| Frontend/BA | Every required fact has a visible control and a clear reason; optional purpose stays optional. Partial capture, accepted financial review and final tax/payment decisions remain separate. Same accepted values flow through form, summaries and API/DB. |

This release fixes the reported receipt ingestion/review failures and directly affected WHT source projection. It does not implement new statutory rates, new filing formats, payroll, foreign-tax regimes or automatic remittance. Broader tax roadmap findings remain explicit in the research; current unsupported facts must remain unresolved rather than receive a guessed domestic classification.

## 1. Reading and structured output

- Preserve original attachment/expense identity. The reader prioritizes the foreground document, original orientation, issuer versus buyer/patient blocks, exact monetary labels and table-row alignment. Do not move a price to a neighboring description or count hierarchy/summary headings as purchased items. Leave illegible text unknown, including issuer name.
- Landscape receipt photos include a bounded upright alternate view of the same page in the normal read (maximum2048px, JPEG90, input pixel limit40M); preserve the original attachment unchanged. Forwarded landscape transcripts are re-read through this same route because the previous intake reader may misread the orientation. This uses the existing four-call budget, not a new retry chain. Add the repository-pinned `sharp` runtime dependency to AI Gateway for this required transform. The production dependency install omits optional packages: copy only the pinned Linux sharp/libvips binaries using the existing API image pattern, and execute a synthetic image rotation during the final image build. Keep release enforcement hashes synchronized.
- Separate transcription from arithmetic/tax interpretation. Do not calculate a tax amount, invent a tax rate, expand an uncertain brand into an industry, or turn a coupon into purchased goods in the transcription.
- The normal extraction budget must accommodate supported item counts. Detect `max_tokens` at both reading and extraction stages and schema/JSON rejection. Reject overlong read text instead of silently slicing off later rows; the shared transcript bound is12,000 characters. A bounded structured-output repair may reuse the existing transcript; do not make the customer resend an already stored image. Do not drop classification gates merely to rescue fields. Do not invent classification confidence/evidence to make a parser accept a response.
- Any extra attempt stays within an explicitly bounded provider-call count and the API/worker timeout contract. Preserve the existing multi-document refusal; repair cannot convert a multi-document page into one expense.
- Incomplete output after the bounded attempt retains the existing recovery/manual-draft flow and typed internal failure. User copy is human-readable; infrastructure/support can inspect failure stage and model/source version without patient/secret logs.
- Numeric presence in generated transcription alone is insufficient when labels contradict it. Explicit no-VAT evidence must not be overwritten by invented or inferred VAT. WHT rate requires printed rate evidence; amount-only capture stays amount-only. Pre-tax/exempt amounts and WHT must never match a generic VAT label.
- Verify/repair layout only where evidence/reconciliation needs it. Do not repeatedly rerun a successful response to fish for a desired result. Initial LINE reused-read and direct web-upload paths must share the same guards.

## 2. Seller identity and automatic entity-kind selection

- Extend the OCR contract only for supported issuer/payee identity evidence and optional `INDIVIDUAL` / `JURISTIC` entity-kind suggestion. Existing `vendorEntityKindSnapshot` is the accepted field; do not create a second party table or unrelated verification service.
- Require seller/issuer-bound evidence, not just a name appearing anywhere. Explicit company/registered partnership wording on the issuer name supports JURISTIC. Explicit personal payee identity/name with individual wording supports INDIVIDUAL. A trade name alone, a brand, a 13-digit number alone, a patient name, cashier name or a buyer company is insufficient.
- AI may propose the kind; deterministic evidence checks and API preservation rules decide whether to prefill. The dropdown remains editable and uses normal Thai labels. Unknown remains blank and is required only where the existing WHT/tax boundary needs it. Country/government/other classifications are not inferred from these two choices.
- Seller TIN recovery may only use seller-bound candidates. A lone buyer TIN must remain a missing vendor TIN. Multiple conflicting issuer candidates stay unresolved. Preserve leading zeros and existing format validation.
- OCR never overwrites an existing reviewed payee kind/identity. Re-extraction retains reviewer money/tax/identity decisions and optimistic revision protection; no historical mass update or GET mutation.
- Avoid copying a patient's identity into the ordinary expense description when it is not needed to identify the transaction. Keep original evidence accessible only through existing authorization.

## 3. Money, VAT, discounts and signed rounding

- Reuse separate existing VAT/WHT amounts. Merchandise, discount/coupon, service/additional charges, VAT, gross, WHT and net have distinct meanings and are counted once.
- Mixed VAT retains line rates/treatments and printed VAT; never derive a blended statutory rate from VAT divided by the pre-VAT total of taxed and untaxed goods. A receipt's accepted gross cannot drift by one satang merely because it was applied or saved again.
- Preserve source versus accepted VAT provenance and existing explicit discrepancy resolution. Unknown source VAT stays unknown; no unprinted amount is labeled as printed evidence. A source amount differing from calculated tax must be visibly resolvable through the existing tax controls.
- Use the existing ROUNDING charge kind for signed settlement rounding. A negative ROUNDING line has quantity one, no discount and no VAT/WHT of its own. It changes gross/net once, not the VAT base of the actual taxed items. Other charge kinds remain positive. Shared calculation/reconciliation and FE/API validation must agree on signed rows.
- Reviewed ledger-category allocations must retain that sign: a net negative expense-account allocation is a positive credit, never an invalid negative debit; zero account allocations are omitted. Confirmed-source, reviewed mapping and balanced-journal guards remain unchanged. Existing unsupported WHT account mapping is still an explicit downstream boundary, not silently guessed by this receipt correction.
- Coupons/discounts are adjustments, not another positive item. They must not be applied both as a discount and a negative line. An explicit zero-price real item remains valid; invalid/uncertain items cannot silently acquire monetary facts.
- A mixed-tax summary page may already show discounted net tax groups. Preserve those groups separately when their printed base/rate/VAT reconcile; do not allocate a second document discount over them. Keep the printed discount in source evidence, label the net groups as including discount, and require review of the missing detail.
- Fractional quantity × rounded printed unit price may differ from the printed payable by at most two satang. Preserve both printed inputs; a reconciled signed ROUNDING adjustment must be clearly labelled as calculated from the printed payable, never as a printed charge. Larger unexplained gaps retain review/fallback handling.
- If detailed items cannot be trusted, keep one honest financial summary with preserved total/tax/charges and retained evidence. Do not reinsert uncertain item rows as additional money on top of that summary.

## 4. Separate WHT input and base

- VAT and WHT have separately labeled inputs and unit selectors, independent values and validation. Example only: pre-VAT amount 1,000, VAT 70, gross 1,070, withholding 30, net payable 1,040. This is arithmetic, not a default statutory-rate policy.
- Extend existing `ExpenseWhtInput` / `whtInputJson` with optional explicit `baseAmount` in baht. No new top-level VAT/WHT money columns are necessary. Omitted base retains current accepted-base behavior for old clients/records; an explicit base is preserved on save/reload and in downstream source projection.
- RATE + explicit base computes one rounded document withholding amount from that base, then allocates exact satang over eligible financial rows using the existing deterministic allocation pattern. Without an explicit base preserve legacy percentage behavior. AMOUNT preserves exactly the entered withholding; adding a base does not rewrite it into a rate.
- A base may differ from the after-discount VAT base, as in the supplied coupon receipts. Do not infer statutory base/rate from inverse arithmetic. OCR may capture an explicitly printed labelled base, otherwise leave it absent for review.
- Inputs must be finite, bounded decimal strings, non-negative and within money precision. WHT must not make the actual payable negative. Signed rounding never receives a negative withholding allocation. Invalid input is rejected before any write with a mapped field error; draft data is retained.
- Changing VAT, quantity, service or discount must not overwrite explicit AMOUNT WHT. Changing WHT amount/unit/base must not overwrite VAT source. Switching units must not silently erase previously accepted information without visible state; preserve compatible base.
- Tax source adapters must use an explicit base when present and retain unknown rate for amount-only capture. They must not reconstruct base by dividing a rounded withholding amount. This release does not infer a tax income category, issue a certificate, mark paid or file taxes automatically.

## 5. One form, one financial representation, one summary

- Keep PANDA MALA form/steps, optional purpose, existing labels, access checks, draft-save button scope/toast and themed dropdowns. No alternate complete-form layout or missing-fields overview.
- A materialized summary is authoritative until explicitly replaced by reviewed detail. Do not display/count both summary and unbound OCR lines. Bind existing rows by identity/evidence; preserve discounts, charge kinds, tax choices and reviewer edits. Partial source facts remain available as evidence without replacing known financial quantities/prices with blanks in the full review form.
- Users with only upload/source permissions retain their bounded incomplete-source flow. The full reviewer can replace/edit the financial summary through the existing authorized line path. Source state must not leave an invisible completion requirement after a legitimate review save.
- Validate Next/save/confirmation against the visible representation; preserve server-side source/tax/concurrency gates. Unresolved double-counting or monetary loss cannot pass because it is merely a warning. An intentional reviewer correction must still have an explicit supported path; do not universally prohibit changing an incorrect OCR total.
- LINE retains the requested detailed, themed card and one web-review CTA. VAT and WHT appear as separate labeled facts, with relevant service/discount/rounding and net amounts when present. Use accepted application values, not contradictory raw extracted numbers. No raw IDs, account keys or unsolicited “please fill these” chat sequence.
- Save errors (validation, permission, conflict, session, network, refresh-after-success) remain understandable; do not discard input or retry final mutations invisibly. Quota/retry behavior uses the existing receipt continuity policy.

## 6. Acceptance matrix

| Evidence | Required result |
| --- | --- |
| Hospital 1,820 repeated | Three correct money rows, invoice classification, no patient-to-payee confusion; same monetary outcome on repeat. |
| Hospital 5,785.28 | Six correctly aligned priced rows; subtotal 5,853.64 and discount 68.36; valid classification output or honest recoverable state, no silent bad rows. |
| Shichi | Six items + service136 + VAT104.72 + rounding−0.72 = gross1,600; single form, no double count. |
| MaxValu | Six rows/eight units, non-VAT gross239 + taxable gross161 =400, VAT10.53; no blended2.7% or399.99 drift. |
| S&P | Seven correct name/price pairs, subtotal829 + service61 =890, VAT58.22; no inferred E/T treatment. |
| Pepper Lunch | Three rows/321; unprinted tax remains source-unknown with visible resolution; draft save works and final tax gate remains honest. |
| Shipnity | Gross5,000, explicitly printed WHT1%/50, net4,950; legal entity suggestion from issuer, not accounting classification of credit. |
| Rotated TCAT | Transport issuer, no VAT, WHT6.91, gross690.80/net683.89; no invented45.19 or buyer identity. |
| Coupon TCAT | Freight8,224.45−coupon6,300 =1,924.45; WHT82.24/net1,842.21; seller and buyer distinct. |
| VAT + WHT, explicit distinct base | Both tax inputs coexist; source intent survives FE/API/DB reload and tax adapter; invalid base/amount fails atomically. |
| Person/company ambiguity | Evidenced seller is preselected; patient/cashier/buyer/brand-only/unknown remains unselected; reviewer override survives OCR retry. |
| Additional Makro pages | Photos C1/C2 share invoice004841145854; supplied pages1&3of3 only. Keep incomplete-page evidence and prevent treating calculated page subtotal as printed final amount. Gross15,532/VAT955.27/discount345; voucher220 plus POD15,312 is payment composition, not another discount. |
| Separate exempt Makro invoice | Invoice004841145892,50kg×99=4,950, printed exemption legend; do not merge with the other Makro invoice merely because buyer/date/vendor match. |
| Fuel fractional quantity | 61.488litres at printed39.19, gross2,409.70/VAT157.64; preserve printed totals and rounding evidence, seller/buyer distinct. |
| Handwritten cash bill | Four rows1,000/660/1,440/400, total3,500; book021/no1037, date3Sep2026; no invented tax or person/company from the bank account holder. |
| Recovery and safety | Truncated/schema-invalid output, unknown date/amount, duplicate/retry, abandonment, partial save, stale revision, forbidden/cross-company access, signed rounding and real zero rows. |

No live ledger/payment/tax submission is implied by a local harness. Live UAT acceptance must exercise upload/review/save/reload/Next and DB readback with authorized test drafts; preserve customer originals and do not emit customer messages. Record real screenshots where available.

## OCR-A correction — owner direction 2026-10-15

The receipt/slip benchmark exposed avoidable row loss and repeated image reads. These corrections apply to the existing extraction and evidence gates:

- Preserve quantity and amount when an optional unit price was derived or malformed; remove only that unsupported unit price. Match row quotes across table pipes and collapsed whitespace, retain an exact source span, and keep valid sibling rows when one fails. Mark partial detail with `missingFields: ["lines", ...]`, including when the missing-field list reaches its bound. Partial detail remains source evidence; API apply uses the financial summary until complete detail reconciles, and one-pass intake still requires every row.
- Admit up to 200 item rows in gateway parsing and API apply. This is an admission bound, not a guarantee that every 200-row response fits the unchanged 8,192-token extraction budget. Truncation still fails explicitly; never silently accept a truncated response.
- Spend an image reread only on an admitted, complete item block with a usable total, no clarification, and an unexplained arithmetic gap. A dropped row, missing total/VAT, uncertain VAT mode, or a gap explained by switching VAT mode does not warrant another image pass. The replacement still needs complete reconciled rows, the same exact total and compatible document number.
- An exact printed due-date field on a settled combined tax invoice/receipt is not a contradiction. Unknown contradictions, unpaid documents, missing totals and multi-document gates retain review behavior.
- Parse Thai named-month slip dates before an adjacent time, including `16 ก.ย. 69 14:10 น.` and `13 ต.ค. 69 - 18:45`, without consuming their year/time as a month-first date.
- Explicit affirmative `VAT INCLUDED` / `รวมภาษีมูลค่าเพิ่มแล้ว` governs the item-price VAT mode. Normalize printed `168.-` to `168.00` and compact slip references by removing spaces and zero-width characters, retaining source membership. Extraction instructions keep purchased delivery/installation rows as items; only a restaurant-style percentage surcharge is `SERVICE_CHARGE`.
- Recover the specific early root brace before receipt `fields` locally with the existing tolerant JSON extractor. Incomplete financial siblings still enter the bounded structural repair path. Do not report missing seller tax ID for receipts, handwritten cash bills or transfer slips; full tax-invoice requirements remain intact.

Offline evidence, registered regression specs and remaining model-only uncertainties are recorded in [OCR-A task memory](../agent-memory/ocr-round-a-20261015.md). PDF pages, image transforms and timeouts belong to OCR-B and are outside this correction.

## 7. Release and compatibility

No new feature flag or email-provider activation. Existing receipt features must remain enabled on UAT. Source JSON extension is additive; use existing nullable snapshots/columns, with no speculative schema migration. If implementation discovers a required schema change, amend this spec/plan and rehearse it through canonical readiness before rollout.

Use reviewed PR head with passing CI, integrate develop/main under existing owner merge authorization, then canonical UAT workflow only. The prior READY refers to the old source and cannot authorize this new release. Record candidate/controller, UAT/automatic READY run IDs, image/signature evidence, config checks and post-deploy results. Do not dispatch Production; it still requires a later explicit owner instruction.
