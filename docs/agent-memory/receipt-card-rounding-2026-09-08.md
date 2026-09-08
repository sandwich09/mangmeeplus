# Agent Memory: receipt card and rounding

Status: implemented and locally verified; preparing reviewed integration and UAT.
Owner: Codex
Scope: LINE exact-image duplicate reply; concise receipt summary; rounding presentation; expense VAT preview inputs.

## Product and implementation plan

1. Reuse the existing green completed-reply card for an exact-image duplicate. Show current saved vendor, total and status, with “เปิดใบเสร็จเดิม”. Preserve creator, company, branch and chat scope. Do not reread OCR, consume admission, create another expense, start a questionnaire or confirm the draft.
2. User's latest card acceptance: show seller/payee, total, document type, document date and expense category in that order; append VAT, WHT and one aggregate of other service charges only when present/nonzero. Omit document number, discount/net breakdown, rounding and trial counter from the automatic summary. Preserve draft status, CTA and necessary exception warnings. Keep quota admission/enforcement and user-requested item details intact. Folded OCR charges must still be labelled as awaiting web review, not falsely claimed as persisted rows.
3. Keep financial rounding rows intact and inspectable in the web form and requested item detail. Name adjustments and their amount honestly instead of claiming that every generated amount was printed. Preserve the PANDA MALA layout and themed controls.
4. Fix tax preview inputs in both review and manual capture: VAT-inclusive entry is gross, not net. Reuse existing expense amount calculation with discounts and pass the calculated VAT for the existing server tolerance check. Backend tax resolution already receives separate taxableAmount, lineTotalAmount and vatAmount; no tax rule, OCR, database or final-posting change is intended.
5. Run focused regressions for scoped duplicate/current status/delivery recovery, exact summary order/optional amounts, charge presentation, fuel (61.488 × 39.19), included/excluded/no VAT and discount. Verify frontend typechecks and existing receipt apply/tax service tests. Review actual rendered card/form where available. Record exact deployment state before any UAT release; Production remains held.

## Evidence and boundaries

- Screenshot: fuel printed total 2,409.70; pretax 2,252.06; VAT 157.64. Multiplication yields 2,409.71472. Existing receipt apply deliberately creates ROUNDING −0.01 with sourceLineText “ระบบคำนวณส่วนต่างจากยอดสุทธิที่พิมพ์บนเอกสาร”. It preserves both printed inputs and the grand total. This is a calculated adjustment, not an extra purchase.
- Shichi prints rounding −0.72. Do not suppress all rounding or remove stored rows; both printed and calculated adjustments remain inspectable.
- Existing web tax selector sends the same quantity × price minus discount as both netAmount and grossAmount. An EXCLUSIVE tax code then calculates 7% on an already inclusive amount, producing the screenshot's incorrect 168.68.
- Unknown seller stays unknown. The duplicate card uses current persisted fields, not stale recognizedFields. No customer messages, image submissions, deletion, historical-data rewrite or Production deployment authorized by this task's screenshots.

Open questions: none blocking the scoped fix.
Artifacts: this memory; source and tests recorded below on completion.
Verification:
- Candidate 619d5c37 CI develop run 34251596162 failed one stale source assertion in ExpensesPages.qa.spec.ts: it expected the previous unconditional charges heading. Update coverage for the conditional adjustment heading and retain shared-index/grouping assertions. Main CI 34251698776 failed on the same old head. New user steering will be verified at a new head; no release has been dispatched.
- API: 609 passed, 0 failed across intake dispatch, webhook, business card, receipt apply and expense tax service specs. Final log `/tmp/receipt-card-api-final-tests.log`. Includes current saved facts/status, creator/chat isolation, exact-image no new OCR/admission/capture, durable failed-delivery replay, signed rounding and the existing fuel apply preserving 2,409.70 / 157.64 / 2,252.06.
- Web: 142 passed, 0 failed across expense model/both review and page QA/validation/tax model; the 6 existing review copy checks passed again after summary label changes. Fuel preview inputs now 2,252.07 taxable line base / 157.64 VAT / 2,409.71 gross line; the separate −0.01 adjustment retains document total 2,409.70 and document net 2,252.06. Discount, included/excluded/no VAT cases passed. Logs `/tmp/receipt-card-web-tests.log`, `/tmp/receipt-card-web-copy-tests.log`.
- API and Web TypeScript checks passed. No dependency, package manifest, schema, migration, OCR model, financial mutation or feature-flag change.
- Actual authenticated UAT read before rollout: sandwich / Drtb fuel `cmtsvajhh00291s5r8x27jgd5` (invoice TI2609-00438). Source and saved summaries already show correct VAT157.64 and total2409.70. Only the separate Tax Code preview displays168.68. No fields were edited or saved during this read.
- The first new rounding test used a legacy check-bill branch without a pending question, so it never rendered charges; corrected the test to exercise the actual receipt formatter. Updated the old exact-heading assertion for the shared charge summary. Final suite above is green.

Latest verification: exact five-field order plus optional VAT/WHT/service aggregate, zero tax omissions, no automatic rounding/document number/discount/net/counter, unchanged quota admissions and explicit item detail all pass. Existing OCR integration still asserts the document number is persisted while omitted from the card. The browser preview uses the actual Flex builder payload; it was refreshed and visually checked after the user steering.

CI follow-up: 298d5b91 run 34253599807 failed six display assertions in the sibling intake-dispatch spec (document number, unknown VAT, trial counter). Updated those three assertion sites to the new summary contract, retaining persisted document-number, admission retention/refund, draft source-state and no-questionnaire checks. Searched all apps/packages specs for the removed display strings and verified all 609 related API tests. Run 34253601554 is the paired CI for that same superseded head; no merge or UAT dispatch yet.

Next: exact reviewed PR-head CI, merge develop/main, canonical UAT and signed/runtime/customer acceptance. Previous UAT34245109127 and READY34248057686 succeeded on the old source; they cannot attest this changed source. Production remains held.
