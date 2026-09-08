# Agent Memory: receipt-ocr-real-sample-evaluation-2026-09-08

Status: evaluation complete; recommendations recorded; no product implementation or deployment.
Owner: root
Scope: two supplied batches, 10 images / 9 unique documents, actual Bedrock OCR followed by in-memory application and current web/source-draft projection. Extends the previous WHT/tax investigation.
Decisions: production remains held. Preserve PANDA MALA form and no unsolicited LINE questionnaire. Separate printed evidence, accepted financial values, tax qualification and payment confirmation. Keep medical images/raw traces private in `/tmp`; no patient identities copied into report. No app/customer-data writes.
Open questions: implementation scope/prioritization not yet approved. Rate/base/coupon legal meaning and shipping-credit accounting classification remain matters to verify, not facts inferred from arithmetic. Exact tenant/live LINE/browser behavior still needs later smoke.
Artifacts: [evaluation report](../research/receipt-ocr-real-sample-evaluation-2026-09-08.md); private `/tmp/mangmee-receipt-eval-20260908/` with original baseline, isolated candidate, projection and diagnostics. Prior [WHT memory](wht-receipt-analysis-2026-09-08.md) and [tax completeness research](../research/receipt-tax-completeness-2026-09-08.md) preserved.
Verification: real Sonnet 4.6 via existing `watchdog-bedrock` AWS profile in ap-southeast-1. UAT config read after cloud runbook. Local source93f1d3db; compared gateway LINE AI/API expenses/web expenses/contracts paths are unchanged from deployed UAT source88a08ae3. Baseline 24 calls, 7 usable OCR responses / 3 failed; not an accuracy pass count. Median24.87s, range20.87–40.04s. Temporary output-cap experiment adds four Bedrock calls; real apply uses in-memory transaction/repository substitutes. Pure source-draft/web validators and parser diagnostics executed successfully after splitting decorator and web import contexts. No package/config edits or product tests added.
Next: explain findings to owner and obtain the intended implementation scope before product changes. Then spec/plan, scoped fixes, sample and independent regression evaluation, real UAT smoke across LINE → form → save/reload → Next → DB. Do not claim the local projection is a live posting or browser test. Prod requires later owner approval.

## Confirmed findings

- A1/B4 are byte-identical hospital invoice1820; baseline monetary values agree. Duplicate detection not tested.
- MaxValu A3 and S&P A5 failed at the1200-token extraction cap (`max_tokens`, truncated JSON). Hospital B3 returned valid JSON but missing classification confidence/evidenceRoles, causing the same generic parse error; price alignment also wrong.
- Shichi A2 gross1600/VAT104.72 retained but six items and service136 collapsed, negative settlement rounding−0.72 unrepresented. Pure form projection adds six staged items to summary →7rows, total warning2959.95.
- Rotated TCAT B2 reader/rereader invented telecom issuer/type and VAT45.19; cross-check/application accepted it though source VAT saysไม่มี. Gross690.80/WHT6.91/net683.89 still agree, so totals alone would miss it.
- TCAT B5 raw model omitted vendorTIN; deterministic cross-check injected the sole buyerTIN into vendorTIN. Diagnostic proves raw absent→parsed absent→cross-check added buyerID. Money1924.45/82.24/1842.21 correct; form projection has missingpayee/quantity/price.
- Shipnity B1 printed1%/50 on5000 gives4950 correctly; payablekind still needed. Shipping credit may be prepayment, not automatically consumedexpense.
- Pepper Lunch A4 total321 correct; unprinted VAT remainsunknown. Form rate requirement exists; don’t assert zeroVAT or finalizedtax readiness.
- Isolated2400-token cap experiment with replayed first-stage text (baseline untouched) completesA3/A5; A3 existing reread also runs. A3 then derives blended2.7%, stores399.99/VAT10.52 and collapsesitems; formprojection799.99. A5 keepsgross890/VAT58.22/service61 but wrongitem-pricealignment and summary+stagedform1544. Not a fix or accuracy claim.
- Current product files unchanged. Existing two untracked tax research/memory files remain, plus these two new documentation files. Do not delete unrelated work.

## Subsequent owner authorization
The owner subsequently authorized spec→implementation→tests→UAT. This file preserves baseline discovery; current implementation and acceptance state are tracked in [receipt-tax-integrity memory](receipt-tax-integrity-2026-09-08.md). Final15-image candidate results are appended to the linked evaluation report. Do not treat the older “not approved/no product changes” checkpoint as current authority. Production remains held.
