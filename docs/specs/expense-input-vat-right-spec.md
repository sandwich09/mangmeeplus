# Spec: the right to input VAT, apart from the document type

Date: 2026-10-13 · Status: approved to build; open points answered by the owner on 2026-10-14 (question set 2, "as recommended, all of it", last section) · Owner: thawatchai · Plan: [docs/plans/sold-ux-owner-answers-2026-10-13-evening-plan.md](../plans/sold-ux-owner-answers-2026-10-13-evening-plan.md) (batch C, answer 9) · Standard: [docs/guidelines/thai-ux-standard.md](../guidelines/thai-ux-standard.md) · Method: [docs/runbooks/local-proof-stack-and-merge-gate.md](../runbooks/local-proof-stack-and-merge-gate.md)

## Why

This week the expense page learned to preset its tax answer from the document type: `ใบกำกับภาษี (เต็มรูป)` sets `ใช้เป็นหลักฐานภาษีได้`, everything else `หลักฐานประกอบเท่านั้น`. The owner's accountant judged that partly wrong (answer 9). His verdict, taken as given:

1. A full tax invoice does not mean the VAT may be claimed. The shop must be entitled to input VAT, the paper must be correct and issued by someone entitled to issue it, the purchase must be for the business, and it must not be a prohibited input tax (entertainment, for example). The preset for a full tax invoice is `มีใบกำกับภาษีเต็มรูป — รอตรวจสอบสิทธิภาษีซื้อ`.
2. "Usable as tax evidence" mixes two things. Input VAT and a deductible expense for income tax are separate: a receipt, a cash bill or a transfer slip that proves payee and payment may support the expense although no VAT can be claimed. The screen must not make a person think such papers have no tax effect.
3. Papers other than a seller's full tax invoice can carry claimable input VAT (a customs VAT receipt; the department's receipt for VAT remitted under ภ.พ.36), under the same conditions. An abbreviated tax invoice, a plain slip, a screenshot or a note never becomes claimable because someone pressed a choice.
4. The model: document type = what the paper is; input-VAT right = its own answer with three values (`รอตรวจสอบ` / `ใช้ได้ตามเงื่อนไข` / `ใช้ไม่ได้`); deductibility as an expense judged separately; changing the VAT right needs a reason and supporting evidence, not only a press.

## Present state (read from the code)

- P1. Three fields on `ExpenseRecord` (`apps/api/prisma/schema.prisma`): `sourceDocumentType` (ten types and `NEEDS_REVIEW`), `taxEvidenceStatus` (`USABLE_FOR_TAX`, `SUPPORTING_ONLY`, `NOT_TAX_EVIDENCE`, `NEEDS_REVIEW`) with `taxEvidenceReasonCode`, and `inputVatClaimStatus` (`CLAIMABLE`, `NON_CLAIMABLE`, `NEEDS_REVIEW`; default `NON_CLAIMABLE`). The third already has the three values the accountant asks for.
- P2. The page asks two questions in step 2 `ภาษีและเอกสาร` (`ExpensesPages.tsx`): `ประเภทเอกสาร` and `ใบนี้ใช้เป็นหลักฐานภาษีได้แค่ไหน` (`taxEvidenceStatus`, words in `TAX_EVIDENCE_STATUS_LABELS`, `packages/contracts/src/expenses.ts`). `inputVatClaimStatus` is never asked: it appears only in the buyer-mismatch banner (`expense-buyer-match.logic.ts`, `ทำเครื่องหมายใบนี้ใช้ภาษีซื้อไม่ได้`) and in one report column.
- P3. Two presets disagree. The web (`taxEvidenceForDocumentType`, `expenses.model.ts`): a full tax invoice → `USABLE_FOR_TAX`, every other type → `SUPPORTING_ONLY`. The server (`deriveTaxEvidence`, `expense-document.logic.ts`, used by upload, the reader and LINE): a receipt or a seller's bill with a name and a number → `USABLE_FOR_TAX` too. So `USABLE_FOR_TAX` already means "supports the expense" on one path and "VAT may be claimed" on the other: the mixture of verdict 2 is in the data.
- P4. The server ties the two together (`validateDomesticInputVatEvidence`, `expense-status.logic.ts`): `CLAIMABLE` needs type `TAX_INVOICE`, `USABLE_FOR_TAX`, an attached file, the seller's tax number and a document number; it is refused when the shop was not VAT-registered on the document's date; a receipt, an abbreviated tax invoice, a certificate in place of a receipt or anything `SUPPORTING_ONLY` can never be `CLAIMABLE` (`isReceiptOrSupportingOnly`, `expense-draft.use-case.ts`). The type `TAX_INVOICE` is hard-coded as the only claimable paper; a customs VAT receipt and a ภ.พ.36 receipt are not types (not found in `SourceDocumentType`).
- P5. Input VAT counts only when both say so: the tax sync (`sync-tax-events.use-case.ts`) and the ledger (`normalizeExpenseVatForLedger`, `journal.use-case.ts`) take it when `CLAIMABLE` and `USABLE_FOR_TAX`.
- P6. No sold screen sends `CLAIMABLE` (not found): the expense page sends `NEEDS_REVIEW` when a tax code is chosen and `NON_CLAIMABLE` otherwise; LINE drafts start as `NEEDS_REVIEW` (`process-line-webhook.use-case.ts`). A full tax invoice typed by hand in a shop without tax codes therefore rests at `NON_CLAIMABLE`, the column default, without anyone having judged it.
- P7. `inputVatClaimStatus` is not on the server's reviewer-only list (`financeOnlyFields`, `expense-draft.use-case.ts`); `taxEvidenceStatus` is. A reviewer's change is stamped `MANUAL_OVERRIDE` with no reason; the audit record `expense.review.update` holds no before and after of these answers. A free-text reason exists only for the buyer mismatch (`buyerAsPrintedJson.overrideReason`).
- P8. The shop's VAT answer is a dated fact (`VatRegistrationStatus`: `REGISTERED`, `NOT_REGISTERED`, `UNKNOWN`; `company-vat-registration.logic.ts`), asked on `ข้อมูลร้าน` (`CompanyProfilePage.tsx`: `ร้านจดทะเบียน VAT หรือยัง`). A shop that answered no gets the short form without tax questions (`expenseCaptureMode`). `UNKNOWN` does not stop a claim today, on purpose.
- P9. Other readers. Claims: an expense whose VAT answer is `CLAIMABLE` or `NEEDS_REVIEW` cannot be put in a claim (`reimbursement-source.ts`, `reimbursement_source_tax_review_required`), and a claim pins the answer in its snapshot and compares it later (`assertReimbursementSources`). Lists: a filter and a badge on `taxEvidenceStatus` (`ExpensesWorkspacePanels.tsx`), the badge on the review page (`ExpenseReviewPage.tsx`), the check list (`deriveExpenseAuditChecks`). Files for the accounting office: columns `tax_evidence_status`, `tax_evidence_reason` (`expense-export.logic.ts`, `ACCOUNTANT_INDEX_COLUMNS`). Report `expense.accountant_evidence`: `สถานะหลักฐานภาษี` and `สถานะภาษีซื้อ` with its own three words (`report-row-text.logic.ts`). Guide: `expenses-guide.content.ts` describes this week's preset.

## Scope

In: the model, the presets, the reviewer's decision with its record, the words on every sold screen that shows these answers, exports and the report, existing records, tests, one journey. Out: any LINE wording (what LINE reads is listed, nothing there changes), a recorded answer on deductibility (open point 3), ภ.พ.30 itself, tax codes and the purchase-tax module that is not sold, how the reader guesses the document type.

## Decisions

- D1. **No new column for the right.** `sourceDocumentType` = what the paper is. `inputVatClaimStatus` = the right to input VAT: `NEEDS_REVIEW` is `รอตรวจสอบ`, `CLAIMABLE` is `ใช้ได้ตามเงื่อนไข`, `NON_CLAIMABLE` is `ใช้ไม่ได้`. `taxEvidenceStatus` = how far the paper supports the expense, and nothing about VAT. One new table holds the decisions (D4).
- D2. **One direction only.** The VAT right can never be better than the evidence (`CLAIMABLE` still needs `USABLE_FOR_TAX`: P4 and P5 stay), and the evidence answer never sets or implies the VAT right.
- D3. **Presets by document type**, applied when the type is chosen by a person or by the reader, never over an answer a person gave:

| Document type | Right to input VAT | Supports the expense (preset) |
|---|---|---|
| `ใบกำกับภาษี (เต็มรูป)` | `รอตรวจสอบ`; a reviewer may decide | as the server derives today (usable with tax number and document number) |
| `ใบเสร็จรับเงินกรมศุลกากร (VAT นำเข้า)`, `ใบเสร็จรับเงิน ภ.พ.36` (two new types) | `รอตรวจสอบ`; a reviewer may decide | usable |
| `ใบกำกับภาษีอย่างย่อ` | `ใช้ไม่ได้`, fixed | usable (today `SUPPORTING_ONLY`, which only stood for "no VAT") |
| `ใบเสร็จรับเงิน`, `บิลผู้ขาย` | `ใช้ไม่ได้`, fixed | as the server derives today (usable with a name and a number) |
| `บิลเงินสดเขียนมือ`, `สลิปโอนเงิน`, screenshot, note, `ใบรับรองแทนใบเสร็จรับเงิน`, other | `ใช้ไม่ได้`, fixed | as the server derives today |

  A paper with no VAT on it (`NO_VAT`, or VAT of zero) has no right to judge: the question is not shown and the stored answer stays `NON_CLAIMABLE`. The web's own preset (`taxEvidenceForDocumentType`) goes; the server's is the only one.
- D4. **A decision, not a press.** `รอตรวจสอบ` → `ใช้ได้ตามเงื่อนไข` or `ใช้ไม่ได้`, and any later change, is a decision by a person with `expense.review`, recorded in a new table `ExpenseInputVatDecision`: `expenseId`, `fromStatus`, `toStatus`, `reason`, `conditionsJson` (each condition, who or what answered it, the fact it was read from), `evidenceAttachmentIds`, `decidedByUserId`, `decidedAt`. The expense keeps only the current answer; the page shows the latest decision. An audit record `expense.input_vat.decide` carries before and after.
- D5. **Conditions of `ใช้ได้ตามเงื่อนไข`.** Checked by the system and shown as facts: the shop is VAT-registered on the document's date; the type is one that can carry input VAT; the paper is attached with the seller's tax number and document number; the shop's name and tax number on the paper match `ข้อมูลร้าน` (the existing buyer check; where it could not be read, the reviewer confirms it). Confirmed by the reviewer, one tick each: bought for the business; not a prohibited input tax; the issuer is entitled to issue it. All must hold. (Which side checks which is open point 4.)
- D6. **A shop that is not VAT-registered** on the document's date: the right is `ใช้ไม่ได้`, set by the system with the reason `ร้านไม่ได้จด VAT ณ วันที่ของเอกสาร`, not asked, not changeable; the short form stays as it is. A shop that never answered: the preset is `รอตรวจสอบ` and `ใช้ได้ตามเงื่อนไข` cannot be saved until the shop's VAT question is answered (link to `ตั้งค่าร้าน › ข้อมูลร้าน`).
- D7. **Confirming does not wait for the right** (answered: yes). An expense may be confirmed at `รอตรวจสอบ`: nothing is claimed while it waits. The reviewer decides later from the list, without reopening the document.

## Rules (server)

- R1. `inputVatClaimStatus` joins the reviewer-only fields. Any write of it other than by R2 or R3 is refused.
- R2. System writes: the preset of D3 when the type is set or changed and no decision exists; `NON_CLAIMABLE` for a fixed type, for D6 and when the VAT goes to zero. Changing the type of a decided expense puts the right back to its preset and records a decision row with the reason `เปลี่ยนประเภทเอกสาร`.
- R2b. When the shop's VAT answer becomes known or changes, the system recomputes the right of every expense that has no decision: not registered on the document's date → `ใช้ไม่ได้` with the reason of D6; registered → the preset of D3. A shop that answers "not registered" is therefore never left with a list of papers waiting for a judgement nobody will make.
- R3. A decision: `expense.review`; a reason of 1 to 500 characters for `ใช้ไม่ได้` and for every change of an earlier decision; for `ใช้ได้ตามเงื่อนไข` every condition of D5 true. Refusals name the field: `ติ๊กเงื่อนไขให้ครบก่อนเลือก “ใช้ได้ตามเงื่อนไข”`, `บอกเหตุผลที่ใช้ภาษีซื้อไม่ได้`.
- R4. `validateDomesticInputVatEvidence` reads the list of claimable types (the full tax invoice and the two new ones) instead of the one type, and keeps every other check.
- R5. After confirmation a decision is its own action and changes nothing else on the document. It is refused when the ภ.พ.30 month of the document is filed (existing words of `tax_period_locked`) and, for a shop that posts to the ledger, when the expense has a posted journal; that refusal offers `แก้ไขเอกสาร` (`EXPENSE_CORRECTION_WORDS.reopen`), the existing way.
- R6. `deriveTaxEvidence` gives an abbreviated tax invoice `USABLE_FOR_TAX`; the reason `ABBREVIATED_TAX_INVOICE_NOT_CREDITABLE` moves to the VAT right. The rule that evidence used in place of a receipt must be `SUPPORTING_ONLY` and never `CLAIMABLE` (`expenseEvidenceInputError`) stays.
- R7. Reads return the right, whether it is fixed, and the latest decision (who, when, reason, conditions).

## Screens and words

One name per thing: `สิทธิภาษีซื้อ` for the right, `หลักฐานรายจ่าย` for the evidence answer. Retired everywhere on the web: `ใบนี้ใช้เป็นหลักฐานภาษีได้แค่ไหน`, `ใช้เป็นหลักฐานภาษีได้`, `หลักฐานประกอบเท่านั้น`, `ไม่ใช่หลักฐานภาษี`, `รอตรวจหลักฐานภาษี`, the tip `expenses.tip_doc_type`, and the report's own three words of P9. `TAX_EVIDENCE_STATUS_LABELS` takes the new words (the exports read the same map); a map for the right is added beside it in `packages/contracts`.

- Step 2 `ภาษีและเอกสาร`, in this order: `ประเภทเอกสาร` → `ใช้เป็นหลักฐานรายจ่ายได้ไหม` (`ใช้ได้` / `ใช้ได้เมื่อมีหลักฐานอื่นประกอบ` / `ใช้ไม่ได้` / `รอตรวจ`) → `สิทธิภาษีซื้อ` (only when the paper carries VAT and the shop has not answered "not registered").
- On choosing `ใบกำกับภาษี (เต็มรูป)`, one line under the type: `มีใบกำกับภาษีเต็มรูป — รอตรวจสอบสิทธิภาษีซื้อ`.
- `สิทธิภาษีซื้อ` for a reviewer: `รอตรวจสอบ` / `ใช้ได้ตามเงื่อนไข` / `ใช้ไม่ได้`. Choosing `ใช้ได้ตามเงื่อนไข` opens the conditions under it: the system's as read-only lines (`ร้านจด VAT ณ วันที่ของเอกสาร`, `แนบเอกสาร มีเลขผู้เสียภาษีผู้ขายและเลขที่เอกสาร`, `ชื่อและเลขผู้เสียภาษีของร้านบนใบตรงกับข้อมูลร้าน`), each with its way to fix when it fails; the reviewer's as three ticks (`ซื้อเพื่อใช้ในกิจการ`, `ไม่ใช่ภาษีซื้อต้องห้าม เช่น ค่ารับรอง`, `ผู้ออกใบมีสิทธิออกใบกำกับภาษี`). Choosing `ใช้ไม่ได้` opens `เหตุผล`. It is saved by the step's own `ถัดไป`; no dialog.
- For a fixed type the field is a fact, not a box: `ใช้ไม่ได้` and one line. Abbreviated: `ใบกำกับภาษีอย่างย่อใช้ภาษีซื้อไม่ได้ ขอใบกำกับภาษีเต็มรูปจากผู้ขายถ้าต้องการใช้`. The others: `ไม่ใช่ใบกำกับภาษี จึงใช้ภาษีซื้อไม่ได้ ไม่เกี่ยวกับการเป็นหลักฐานรายจ่าย`.
- A person without `expense.review` reads both answers as facts, as today.
- Step 3 `ตรวจสรุป` and the confirmed document: two lines, `หลักฐานรายจ่าย: …` and `สิทธิภาษีซื้อ: …`, the second with `ตรวจโดย {ชื่อ} {วันที่}` and the reason when a decision exists, and `ตรวจสิทธิภาษีซื้อ` for a reviewer while it is `รอตรวจสอบ` (D7).
- Lists and badges always carry the name: `ภาษีซื้อรอตรวจสอบ`, `ภาษีซื้อใช้ได้ตามเงื่อนไข`, `ภาษีซื้อใช้ไม่ได้`; `หลักฐานรายจ่ายใช้ได้`, `หลักฐานรายจ่ายต้องมีเอกสารอื่นประกอบ`, `ไม่ใช่หลักฐานรายจ่าย`, `หลักฐานรายจ่ายรอตรวจ`. The expense list gains the filter `สิทธิภาษีซื้อ`; `ภาษีซื้อรอตรวจสอบ` is the reviewer's work list.
- The buyer-mismatch banner keeps its buttons; its mark becomes a decision with the reason `ชื่อหรือเลขผู้เสียภาษีของร้านบนใบไม่ตรง`, and its undo a decision back.
- The guide's step text follows; the three pins are rewritten with `repin.sh` and their diffs read.

## Exports and reports

- Files for the accounting office: `tax_evidence_status` keeps its key, header `หลักฐานรายจ่าย`; `tax_evidence_reason` header `เหตุผลหลักฐานรายจ่าย`; four columns added at the end: `input_vat_right` (`สิทธิภาษีซื้อ`), `input_vat_reason`, `input_vat_decided_by`, `input_vat_decided_at`. The CSV keeps codes, the XLSX the same Thai words as the screen.
- Report `expense.accountant_evidence`: the two columns are named `หลักฐานรายจ่าย` and `สิทธิภาษีซื้อ` and use the shared words; reason and reviewer are added.
- Tax sync and the ledger: unchanged (D2). With the old preset gone, nothing reaches ภ.พ.30 without a decision.

## Existing records

- Confirmed, cancelled and rejected records: no stored value changes, so what was and was not claimed stays exactly as it was. No decision rows are invented. On screen, a claimable type that rests at `NON_CLAIMABLE` without a decision reads `ไม่ได้ใช้ภาษีซื้อ (บันทึกก่อนมีการตรวจสิทธิ)`, not `ใช้ไม่ได้`: the first is a fact, the second would be a judgement nobody made (P6). `CLAIMABLE` rows read `ใช้ได้ตามเงื่อนไข`.
- Open records (draft, in review, ready to confirm): a full tax invoice with VAT that rests at `NON_CLAIMABLE` with no human mark (`claimStatusBeforeMark` absent) moves to `รอตรวจสอบ`, except expenses a claim already points at (P9: the claim would read as changed). An open abbreviated tax invoice at `SUPPORTING_ONLY` with the reason `ABBREVIATED_TAX_INVOICE_NOT_CREDITABLE` moves to usable evidence. One migration, with counts written to its log; a real-database spec.
- `taxEvidenceStatus` values are not rewritten otherwise: only their words change.

## What LINE reads (nothing changes there in this spec)

- The assistant's expense detail tool returns both codes (`erp-core-detail-tools.use-case.ts`): its answers will show more `NEEDS_REVIEW` for the right, which is the truth.
- A LINE follow-up prints the raw code after `สถานะหลักฐานภาษี –` (`formatGroundedReceiptFollowUp`, `process-line-webhook.use-case.ts`) and a sentence about VAT credit: both read oddly beside the new words and wait for the owner's word.
- LINE captures use `deriveTaxEvidence` and start the right at `NEEDS_REVIEW`: already the new preset. The two new document types need a LINE label (`SOURCE_DOC_TYPE_REPLY_LABELS`) or the code shows.
- The daily closing counts `taxEvidenceStatus` only (`erp-expense-daily-closing.use-case.ts`): unaffected.

## Tests and journey

- Server (registered spec files): presets per type; a fixed type refuses every decision; each condition of D5 missing in turn; reason rules; a non-reviewer cannot write the right; type change after a decision; D6 for not registered and never answered; a decision after confirmation and its two refusals; sync and ledger take VAT only after a decision; the migration on a real database.
- Web: the model's words in every state (fixed, waiting, decided, old record), the step, the list filter, the export headers.
- New journey `e2e/journeys/expense-input-vat-right.journey.spec.ts`, in a shop that answers `ร้านจดทะเบียน VAT หรือยัง` yes on the way: an expense by hand with `ใบกำกับภาษี (เต็มรูป)` and VAT → the line under the type and `สิทธิภาษีซื้อ: รอตรวจสอบ`; `ใช้ได้ตามเงื่อนไข` without the ticks → the sentence beside the field; confirm while waiting; from the list filtered to `ภาษีซื้อรอตรวจสอบ`, open it, press `ตรวจสิทธิภาษีซื้อ`, tick, save → `ใช้ได้ตามเงื่อนไข` with the reviewer's name; a second expense with `ใบเสร็จรับเงิน` → `ใช้ไม่ได้` as a fact with its line and `หลักฐานรายจ่าย: ใช้ได้`; download the files for the accounting office and find both columns; the server shows the right, one decision row, and no change on the receipt.

## Acceptance

- Choosing a full tax invoice never states that VAT can be claimed; no paper other than the three claimable types can reach `ใช้ได้ตามเงื่อนไข` by any route; a receipt, a cash bill or a slip never reads as having no tax use.
- Every `ใช้ได้ตามเงื่อนไข` in the system has a decision row with a reviewer, a time and its conditions.
- No confirmed record changed its stored answers; the counts of the migration match the proof database.
- The screens are looked at as owner, reviewer and staff at 390, 1280 and one wide window; a shop that is not VAT-registered sees no new question.

## No dead ends (the owner, 2026-10-14)

"Do not forget the shops that are not VAT-registered and the ordinary shops. No dead end, nothing that cannot go on. Every shop must be able to record everything."

- N1. No document type, no value of the right, no missing decision and no unanswered shop question refuses saving, confirming, paying, putting into a claim or cancelling an expense. The only thing that can wait is the choice `ใช้ได้ตามเงื่อนไข`, and it says what is missing with its link.
- N2. A shop that is not VAT-registered sees no new question, no new field and no new required step: the short form stays as it is, the right is a fact set by the system (D6).
- N3. A shop that never answered the VAT question records everything; a paper that could carry input VAT rests at `รอตรวจสอบ` and blocks nothing; one line on the reviewer's list offers the shop's question, and answering it settles every waiting paper at once (R2b).
- N4. A person without `expense.review` is never asked to judge the right and is never stopped by it.
- N5. The journey `plain-shop-records-everything` (a shop that is not VAT-registered and has no tax details: record by hand, upload a picture, confirm, pay, claim) is written before this spec is built and stays green through it; `expense-input-vat-right` walks a registered shop and a shop that never answered.

## Open points, answered by the owner on 2026-10-14

He answered question set 2 with "as recommended, all of it". The numbers in brackets are the questions of that set.

1. **Confirming while the right is `รอตรวจสอบ`** (ส1): yes; the reviewer decides later from the list (D7, R5).
2. **Claims** (ส2): a claim does not wait for the right; the claim's pinned snapshot stops comparing it.
3. **Deductibility as an expense** (ส3): no recorded answer now; only the words stop the VAT answer from standing in for it.
4. **Who checks which condition** (ส4): the split of D5 is taken. The accountant has not confirmed it separately; the list of the reviewer's ticks is data, so a condition can be added without a new screen.
5. **Supporting evidence** (ส5): the attached paper with the recorded conditions is enough; more files stay optional.
6. **Who may decide** (ส6): everyone with `expense.review`.
7. **The two new document types** (ส7): added now.
8. **A shop that never answered the VAT question** (ส8): `ใช้ได้ตามเงื่อนไข` waits for the answer, with the link; everything else goes on (N3).
