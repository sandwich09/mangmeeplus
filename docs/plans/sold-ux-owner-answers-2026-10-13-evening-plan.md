# Plan: the owner's answers of the evening of 2026-10-13 (twenty questions with use cases)

Owner: thawatchai · Follows [sold-ux-owner-decisions-2026-10-13-plan.md](sold-ux-owner-decisions-2026-10-13-plan.md) · Method: [docs/runbooks/local-proof-stack-and-merge-gate.md](../runbooks/local-proof-stack-and-merge-gate.md) (work cut by journey, journey tests, merge gate) · Standard: [docs/guidelines/thai-ux-standard.md](../guidelines/thai-ux-standard.md)

The questions went to him as a Thai file with one use case each; he answered by number. Answers 3, 4, 9 and 10 carry his accountant's reasoning, kept here in substance. Nothing here is pushed or deployed (answers 18 and 19).

## Answers and what each means

| # | Question | His answer | What is built |
|---|---|---|---|
| 1 | Payee name on the expense while it waits for confirmation | as recommended | When a certificate is made for an expense that has no seller name, the payee's name is written to the expense at once; while the certificate is unsigned and the name on the expense is still the one written this way, a change of the payee on the certificate follows. |
| 2 | A file for an expense that is paid and reopened | as recommended | While the document is open for review, supporting files can be added even when a payment exists (who and when is recorded). Replacing the main receipt file stays refused. |
| 3 | Shops with several branches and the withholding returns | separate by the establishment that really pays and withholds; head office paying everything files as head office; a shared filing place never makes one paper | Batch B: a return per paying establishment; the shop says whether head office pays everything or each branch pays its own. |
| 4 | Income types the system cannot put on the form | do not hide; a warning alone is not enough; "the accountant prepares that form" is acceptable for now, limited to the affected form, branch and month; a contest prize to a person belongs on ภ.ง.ด.3 and may share it with services; interest or a dividend to a person belongs on ภ.ง.ด.2 and must not stop ภ.ง.ด.3; "other" needs its nature known | Batch B: prize becomes fillable; interest and dividend to a person leave ภ.ง.ด.3 with the line "ต้องจัดทำ ภ.ง.ด.2 แยก"; the chooser says at once when the system cannot prepare the form for a type; the month's rows and totals can be exported for the accountant. |
| 5 | Income type that does not match the payee's kind | as recommended | Checked on the server at confirmation; the same income at the same rate is switched to the matching twin. |
| 6 | A payment recorded into a month already filed | "do it completely" | Batch B: an additional filing (`ยื่นเพิ่มเติมครั้งที่ …`) in the system, with what was filed before kept. |
| 7 | A file for online filing | as recommended | Batch B, after 3: the Revenue Department's data format. |
| 8 | Guides in the guide menu | not now; all guides at once when the work is solid | nothing. |
| 9 | The tax answer preset from the document type | partly wrong: a full tax invoice is not always creditable; "usable as tax evidence" mixes input VAT with deductible expense; other papers can carry input VAT | Batch C: the document type stays as chosen; input-VAT right becomes its own answer (`รอตรวจสอบ` / `ใช้ได้ตามเงื่อนไข` / `ใช้ไม่ได้`) that a full tax invoice starts as `รอตรวจสอบ`; deductibility as an expense is judged separately; changing the VAT right needs a reason. |
| 10 | `จำนวนราย` on the forms | right as built: count the payee rows of the attachment as filed (a row holds at most three payments); cover and attachment must agree | a test for a payee with four payments in a month (two rows, count two). |
| 11 | The payee's name on ภ.ง.ด.3 | must be split | title and first name in `ชื่อ`, the rest in `ชื่อสกุล`. |
| 12 | The badge of a claim that is paid | `จ่ายแล้ว`; the line about the signed form only when the claim is signed on paper | as said. |
| 13 | `ตีกลับ` and `ไม่อนุมัติ` | as recommended | `ส่งกลับให้แก้` on both screens (claims and payment documents). Asked whether the bell and LINE should follow, he said "เอาตามแนะนำ" (yes): their sentences use the same words, in a follow-up round after the screens (stored notice templates need the template sync; LINE card layout is not touched, words only). |
| 14 | The branch remembered on a shared device | as recommended | remembered per person. |
| 15 | LINE says `แดชบอร์ด` | as recommended | LINE says `หน้าแรก`. |
| 16 | `กรุณา` in the edit dialog | as recommended | removed on the web and in the LINE help answers that use the same words. |
| 17 | The purchase screens | all of it, option ก for 17.1 to 17.3 | Batch D: its own round, after A to C. |
| 18 | Push | wait until he has tried | nothing pushed. |
| 19 | UAT | not yet | nothing deployed. |
| 20 | The old trial stack on his machine | may be deleted | removed by the controller. |

## Batches (each one journey or one rule family, small enough to try on its own)

- **A. Small rules and words** (answers 1, 2, 5, 10, 11, 12, 13, 14, 15, 16). Three lanes: expenses (1, 2, 5), words and LINE (11, 10's test, 13 for payment documents, 14, 15, 16), claims (12, 13 for claims). Journey steps added to `no-receipt-certificate`, `claim-declined-then-paid`, `payment-document-two-people`.
- **B. Withholding, complete** (answers 3, 4, 6, 7). Spec first: `docs/specs/withholding-returns-complete-spec.md`. Slices: income types; paying establishment; additional filing; online file.
- **C. Input VAT apart from the document type** (answer 9). Spec first: `docs/specs/expense-input-vat-right-spec.md`.
- **D. Purchase screens** (answer 17). Its own plan.

## Rules of the build

As in the plan this one follows: rules on the server and test-first; every refusal with its way out; a journey test for every journey touched; the merge gate after every merge; the controller presses the journey once on the proof stack. LINE, printed papers and bell wording change only where an answer names them (13, 15, 16).

## Question sets 2 and 3 (2026-10-14)

- **Set 2** (nine on withholding, eight on the input-VAT right): "as recommended, all of it", and: "do not forget the shops that are not VAT-registered and the ordinary shops; no dead end, nothing that cannot go on; every shop must be able to record everything". Each answer is written into the last section of the two specs, with the rule `No dead ends` above it. One answer differs from the spec's draft: a branch without a tax branch code gets no paper until the code is filled (the question recommended that, and he took it).
- **Set 3** (five on the purchase screens): "wait". Batch D does not start.
- Order of building: a journey for a shop that is not VAT-registered and has no tax details first (it must stay green through everything else); withholding slice 2 (who pays) then slice 3 (additional filing) then slice 4 (online file); batch C in parallel, server first.

## Question set 4 (2026-10-14)

Three questions found by a prover walking a plain shop and by reading the Revenue Department's format documents. Answer: "as recommended, except the online filing file".
- ค1 online filing file: not built; "let it end at the accounting office first; online filing on this side is not needed yet, hide it". Nothing on any screen offers it today.
- ค2 a slip when recording an expense payment: add an optional `แนบสลิป (ถ้ามี)` to the expense's pay dialog, as the claim's pay dialog has.
- ค3 the certificate in place of a receipt for a shop that is not a company: the paper says `กิจการ` instead of `บริษัท` everywhere, and prints no tax-number line when the shop has none.

## Question set 5 (2026-10-14)

One question, answered by his accountant in full (ท.ป.4/2528 ข้อ 2 and ข้อ 13; the 50 ทวิ form; มาตรา 50 ทวิ): withholding belongs to the month the money is really paid; confirming or owing is not paying; the 50 ทวิ keeps the payment date and the issue date apart and is never back-dated; paid in parts goes month by month; a payment recorded late keeps its real date (a filed month gets an additional filing, never a later month); paid but not withheld keeps the duty and the person is told to correct the entry. Written as "Slice 5" of `docs/specs/withholding-returns-complete-spec.md` (W1–W9).

## Status

2026-10-13 late evening: answers recorded; batch A started; specs of B and C being drafted.
2026-10-14: batch A, withholding slices 1 and 2a on the trial web; set 2 answered, set 3 waits; slice 2, batch C and the plain-shop journey started.
