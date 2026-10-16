# Spec: withholding returns, complete (who files, every income type, additional filing, online file)

Date: 2026-10-13 · Status: approved to build; open points answered by the owner on 2026-10-14 (question set 2, "as recommended, all of it", last section); slices 1 and 2a are built · Owner: thawatchai · Plan: [docs/plans/sold-ux-owner-answers-2026-10-13-evening-plan.md](../plans/sold-ux-owner-answers-2026-10-13-evening-plan.md) (batch B, answers 3, 4, 6, 7, 10) · Follows: [withholding-returns-pnd3-combined-page-spec.md](withholding-returns-pnd3-combined-page-spec.md) · Standard: [docs/guidelines/thai-ux-standard.md](../guidelines/thai-ux-standard.md) · Method: [docs/runbooks/local-proof-stack-and-merge-gate.md](../runbooks/local-proof-stack-and-merge-gate.md)

## Why

The page `ภาษีหัก ณ ที่จ่าย` prepares ภ.ง.ด.3 and ภ.ง.ด.53 for one shop as if it were one establishment that only pays for services, rent, professional work, advertising and transport, and that never records a payment late. The owner answered five questions with his accountant's rules (2026-10-13 evening). This spec turns them into four slices that can each be tried on their own.

## Present state (read from the code)

- P1. One return per company, form and month: `TaxPeriod` is unique on `(companyId, formType, periodKey)` (`apps/api/prisma/schema.prisma`; `PrismaTaxRepository.upsertPeriod`). The payer block of the paper comes from the one branch all the month's events share (`validateWithholdingFiling` in `withholding-filing-validation.ts`: `branch?.taxBranchCode ?? '00000'`, `branch?.addressJson ?? company?.addressJson`). Two branches in a month is the fault `branches` (`PND3_FILING_REVIEW_MESSAGES` in `tax-period.logic.ts`: "มีรายการจ่ายจากหลายสาขา …"). A branch with no tax branch code prints `00000` with its own address.
- P2. Fillable types are two hard-coded sets (`CATEGORIES` in `withholding-filing-validation.ts`). Anything else is the fault `category` and stops the whole form.
- P3. The chooser in the expense form shows only `ACTIVE` rows (`ListWhtIncomeCategoriesUseCase`, `apps/api/src/modules/procurement/application/use-cases/wht-income-category.use-case.ts`) of the payee's form (`expenseWhtCategoriesForPayee` in `expenses.model.ts` filters `formType`). `WHT_PRIZE`, `WHT_INTEREST`, `WHT_DIVIDEND` are seeded `DRAFT` (migration `20261004120000_open_wht_income_categories`), so they are hidden unless the team opened them; `WHT_OTHER_IND` / `WHT_OTHER_JUR` are `ACTIVE` and can be chosen although no form takes them. The catalogue has one row per code with one form: `WHT_INTEREST` is `PND3` at 1, `WHT_DIVIDEND` is `PND53` at 10; no row exists for interest to a company, a dividend to a person, or a prize to a company. `TaxFormType` has no ภ.ง.ด.2.
- P4. A payment confirmed into a filed month is neither refused nor shown: confirmation skips the withholding lock on purpose (the confirm path in `prisma-expense.repository.ts` calls `readExpensePeriodLocks` with `withholdingForms = false`), and the sync then skips it without writing an event or an issue (`assertPeriodUnlocked` → `skippedLocked++` in the two withholding loops of `sync-tax-events.use-case.ts`). It is on no paper and the page does not know it exists.
- P5. What was filed is not kept. A download stores a checksum of the month's payment facts (`withholdingPaymentChecksum`, written to `TaxReportSnapshot`) and a `TaxFilingPackage` row; the file is not stored (`TaxFilingPackage.attachmentId` is never written in `apps/api/src/modules/tax`). Downloading a filed month again renders the live rows.
- P6. After filing: reopening an expense is refused (`tax_period_filed`, `withholdingPeriodLockedMessage` in `packages/contracts/src/tax.ts`); cancelling it is refused only when it carries a 50 ทวิ (`voidExpenseTrueReversal` in `prisma-expense.repository.ts`). Without a certificate the cancel goes through, the event stays `ACTIVE` in the locked month and `currentWithholdingPayments` drops it from the page and from the next download: the paper of a filed month changes silently.
- P7. The lock is the month's `TaxPeriod.status` (`isPeriodLocked` or the same three states spelled out), read in: the sync, `readExpensePeriodLocks` (expense reopen, cancel, claim cancel, and `tax_period_filed` in `wht-certificate-handoff.use-case.ts`), `supersedeUnclassifiedWithholding`, `correct-wht-certificate.use-case.ts` (`wht_certificate_correction_tax_period_locked`), `prisma-procurement.repository.ts` (`wht_tax_period_locked_requires_amendment`), and `markFiled` in `tax.controller.ts`.
- P8. The fillers (`pnd3-official-form.logic.ts`, `pnd53-official-form.logic.ts`) tick `ยื่นปกติ` only; the place of the `ยื่นเพิ่มเติม` box and its `ครั้งที่` is not in the code. The main form prints 0 for the surcharge. A download after the due date is the fault `overdue`.
- P9. A file for online filing: not found anywhere in `apps/api`, `apps/web` or `packages/contracts`.
- P10. The 50 ทวิ prefill of an expense takes the company's address and the expense branch's tax branch code (`createWhtHandoffForExpense` in `prisma-expense.repository.ts`); the certificate ticks only ภ.ง.ด.3 or ภ.ง.ด.53 and refuses a dividend (`incomeFields`, `makeMarks` in `wht-certificate-pdf.logic.ts`).

## Scope

In: the four slices below, in this order. Out: filling ภ.ง.ด.2, ภ.ง.ด.1, 1ก, 3ก, 54; computing a surcharge or a fine; sending anything to the Revenue Department; refunds from the department; LINE, bell and printed 50 ทวิ wording; packages, prices and rights (still feature `wht_pnd53`, `wht.pnd53.read` / `wht.pnd53.prepare`).

## Decisions (the owner's, with his accountant's rules; given)

- D1. **Who files.** A return belongs to the establishment (head office or a branch) that really paid and withheld. Head office paying everything files everything as head office, also costs of several branches. Branches that pay themselves each file their own return, also when head office's bookkeeper prepares and submits them. A shared filing place never merges two establishments into one paper. ภ.ง.ด.3 and ภ.ง.ด.53 are always separate papers.
- D2. **Income types.** No type is hidden. A contest, competition or lucky-draw prize: to a person on ภ.ง.ด.3, to a company on ภ.ง.ด.53, on the same paper as services at its own rate; its name says which prize. Interest or a dividend to a person belongs on ภ.ง.ด.2 and is not a row of ภ.ง.ด.3. Interest and a dividend to a company belong on ภ.ง.ด.53 (a dividend only when no exemption applies); while the system cannot fill them, that form of that establishment and month is prepared by the accountant, the system exports the rows and totals, and the other form stays downloadable. "Other" needs its nature known first: same treatment. The person learns this when choosing the type.
- D3. **A payment recorded into a filed month** becomes an additional filing in the system: `ยื่นเพิ่มเติมครั้งที่ n`, with its own download and filed state. Nothing filed is ever rewritten.
- D4. **A file for online filing** follows, per establishment, form and month, in the Revenue Department's published data format.
- D5. **`จำนวนราย`** counts the payee rows of the attachment as filed; a row holds at most three payments; cover and attachment agree.

## Slice 1: income types

Data (additive):
- `WhtIncomeCategory.filingRoute` text, default `SYSTEM_FILLS`; values `SYSTEM_FILLS`, `ACCOUNTANT_PREPARES`, `SEPARATE_PND2`. It replaces the two `CATEGORIES` sets.
- Enum values added: `TaxFormType.PND2`, `TaxEventType.WHT_PND2`. `WhtFormType` in contracts stays the two forms the system prepares.
- Catalogue rows (insert when absent; names and routes set on existing rows; nothing else touched):

| Code | Payee | Form | Route | Name on screen |
|---|---|---|---|---|
| `WHT_PRIZE` (exists) | person | ภ.ง.ด.3 | system fills | `รางวัลจากการประกวด แข่งขัน หรือชิงโชค (บุคคลธรรมดา)` |
| `WHT_PRIZE_JUR` (new) | company | ภ.ง.ด.53 | system fills | `รางวัลจากการประกวด แข่งขัน หรือชิงโชค (นิติบุคคล)` |
| `WHT_INTEREST` (exists, today ภ.ง.ด.3) | person | ภ.ง.ด.2 | separate | `ดอกเบี้ย (บุคคลธรรมดา)` |
| `WHT_INTEREST_JUR` (new) | company | ภ.ง.ด.53 | accountant | `ดอกเบี้ย (นิติบุคคล)` |
| `WHT_DIVIDEND_IND` (new) | person | ภ.ง.ด.2 | separate | `เงินปันผล (บุคคลธรรมดา)` |
| `WHT_DIVIDEND` (exists) | company | ภ.ง.ด.53 | accountant | `เงินปันผล (นิติบุคคล)` |
| `WHT_OTHER_IND`, `WHT_OTHER_JUR` (exist) | both | as today | accountant | names as today |

  A row becomes `ACTIVE` only with a rate the accountant has confirmed (open point 1); a sales-promotion reward gets no row here and is recorded as `อื่นๆ` until the owner asks for its own (open point 2).

Server rules:
- S1.1 The chooser lists every `ACTIVE` type of the payee's kind (person: forms ภ.ง.ด.3 and ภ.ง.ด.2; company: ภ.ง.ด.53) with its route. The match of type and payee kind checked at confirmation (answer 5; its twin switch was not found in this worktree) knows the new pairs.
- S1.2 `SYSTEM_FILLS`: a line of the form, at its own rate and with its own name; one paper may mix types (the line already carries both).
- S1.3 `SEPARATE_PND2`: the sync writes a `WHT_PND2` event in a `PND2` period; it is never a line, a count or a total of ภ.ง.ด.3 and never stops it. The system prepares, downloads and marks nothing for ภ.ง.ด.2.
- S1.4 `ACCOUNTANT_PREPARES`: when a paper holds at least one such payment, that paper (that form, establishment and month) is the accountant's: no official download for it, no fault on the rows, the other form untouched. The narrow export route accepts `XLSX` beside `PDF` (today `exportPnd53` refuses anything else) and returns every row of that paper (date, payee, tax number, branch, address, income type, rate, paid, withheld, 50 ทวิ number) with the totals, and the ภ.ง.ด.2 rows of the month on a second sheet. `บันทึกว่ายื่นแล้ว` works on such a paper after its export, with the same "changed after download" check.
- S1.5 The system issues no 50 ทวิ for a ภ.ง.ด.2 type or a dividend until the certificate can tick the right form (P10); the existing record of a certificate the shop issued itself stays available.

Screens and words:
- Expense form, under `จ่ายค่าอะไร`, one line by route: accountant → `ระบบยังกรอกประเภทนี้ลงแบบไม่ได้ ผู้ทำบัญชีต้องจัดทำ ภ.ง.ด.53 ของเดือนนี้เอง` (ภ.ง.ด.3 for a person); separate → `ประเภทนี้ยื่น ภ.ง.ด.2 แยก ไม่อยู่ใน ภ.ง.ด.3`; `อื่นๆ` → `บอกผู้ทำบัญชีว่าเป็นเงินได้อะไร ผู้ทำบัญชีต้องจัดทำแบบของเดือนนี้เอง`.
- Page, the card of an accountant's paper: state `ผู้ทำบัญชีจัดทำแบบนี้เอง`, one sentence `มีเงินได้ที่ระบบยังกรอกลงแบบไม่ได้: {ประเภท} ({ผู้รับเงิน})`, buttons `ดาวน์โหลดรายการให้ผู้ทำบัญชี` then `บันทึกว่ายื่นแล้ว`.
- Page, a block under the cards when the month has such rows: heading `ต้องจัดทำ ภ.ง.ด.2 แยก`, one row per payment: payee, income type, `จ่าย ฿…`, `หักไว้ ฿…`, `เปิดรายจ่าย`.
- The fault `category` keeps its meaning for a type with no catalogue row only; its sentence loses the list of five types.

Journey `withholding-forms` (before the two downloads): a third paid expense, the prize to the same person at its rate → the ภ.ง.ด.3 card reads `2 รายการ` and still downloads; a fourth, interest to a person → the line under the chooser, the block `ต้องจัดทำ ภ.ง.ด.2 แยก` with payee and amount, the ภ.ง.ด.3 card still `2 รายการ`. A second test in the file, in a shop where no journey downloads the forms: `อื่นๆ (นิติบุคคล)` → the line at the chooser, the ภ.ง.ด.53 card without `ดาวน์โหลดแบบ ภ.ง.ด.53`, an `.xlsx` from `ดาวน์โหลดรายการให้ผู้ทำบัญชี`, ภ.ง.ด.3 of that shop untouched.

Tests (registered spec files): validation by route; a mixed paper (service 3 and prize 5) through the filler's packet test; the sync for a ภ.ง.ด.2 type; the export sheet; the chooser model; page spec.

## Slice 2: paying establishment

Data (additive):
- `WhtPayerModeFact` (new table, the pattern of the VAT registration facts in `company-vat-registration.logic.ts`): `companyId`, `mode` (`HEAD_OFFICE_PAYS_ALL` | `EACH_BRANCH_PAYS`), `effectiveFromPeriodKey`, `answeredByUserId`, `answeredAt`, `supersededAt`. `CompanyTaxProfile.branchPolicy` exists but nothing reads it and its three values mean something else: left alone.
- `WhtFiling` (new table), one row per paper: `companyId`, `taxPeriodId`, `formType`, `periodKey`, `establishmentCode` (five digits), `establishmentBranchId`, `sequence` (0 = `ยื่นปกติ`), `status` (`OPEN`, `EXPORTED`, `FILED` of `TaxPeriodStatus`), `preparedBy` (system or accountant), `payerSnapshotJson` (name, tax number, code, address as printed), `rowsChecksum`, `filingPackageId`, `downloadedAt`, `filedAt`, `filedByUserId`, `filedNote`, `rowsCertain` (default true); unique on `(companyId, formType, periodKey, establishmentCode, sequence)`.
- `WhtFilingLine` (new table): `whtFilingId`, `rowNumber`, `taxEventId`, `sourceType`, `sourceId`, `lineJson` (the printed facts of the payment).
- `TaxFilingPackage.whtFilingId` (new, nullable); `TaxFilingPackage.attachmentId` (exists) now holds the stored file. `TaxPeriod` and its unique key stay as they are.

Server rules:
- S2.1 The paying establishment of a payment is a five-digit code. `HEAD_OFFICE_PAYS_ALL`: head office's code (the tax branch code of the `HEAD_OFFICE` branch, `00000` when it has none), whatever branch the cost belongs to. `EACH_BRANCH_PAYS`: the tax branch code of the expense's (or supplier payment's) branch; a payment with no branch is head office's; a payment of a branch that has no tax branch code has NO establishment yet (answer 3 below): it is recorded, confirmed and paid as any other, it is listed on the page as `ยังไม่มีรหัสสาขา`, it is on no paper, and the page carries one line with the link to give that branch its code. The papers of the other establishments of the month are not held back by it. The mode in force is the fact covering the payment's month.
- S2.2 Defaults. A shop with one active branch (the head office: `canLeaveActiveBranch` in `branch.logic.ts` never lets the last active head office go): head office pays everything, no question shown, the same paper as today. An existing shop with several branches has no answer until someone gives one; meanwhile it behaves as today (the code of the expense's branch, and a month that resolves to two establishments cannot be downloaded), and that fault now carries the link to the question instead of "ให้ผู้ทำบัญชีแยกแบบยื่นตามสาขา".
- S2.3 Changing the mode writes a new fact from a month the person chooses (default: this month). It is refused for a month that already has a filed paper, with the first free month offered. Months before it keep their establishments; a downloaded, unfiled paper whose rows move shows `มีรายการเปลี่ยนหลังดาวน์โหลดแบบ` as today.
- S2.4 State, download, filed state and lock are per `WhtFiling`. At download the rows are frozen into `WhtFilingLine`, the payer block into `payerSnapshotJson`, and the file is stored; `บันทึกว่ายื่นแล้ว` files that paper only. A filed paper downloads its stored file. No code path updates or deletes a filed `WhtFiling` or its lines.
- S2.5 The lock moves from the month to the payment: a payment is locked when it has a line on a filed paper. Every reader in P7 asks that question for ภ.ง.ด.3 and ภ.ง.ด.53. `TaxPeriod.status` of these two forms becomes a roll-up for old readers (filed when every paper of the month is filed and no row is off paper).
- S2.6 The sync no longer skips a filed month for these forms. A new payment in an establishment and month whose paper is filed gets its event; until slice 3 the card says `มีรายการที่ยังไม่อยู่ในแบบที่ยื่น {n} รายการ ให้ผู้ทำบัญชียื่นเพิ่มเติม` and offers no download for them.
- S2.7 The payer on a paper is the establishment: its code, and the address of the branch that owns the code (head office: the shop's registered address). A new 50 ทวิ prefill names the same establishment (P10).
- S2.8 A reader limited to some branches sees the cards of establishments inside that limit; the list of payments keeps today's limit and shows who files each row.
- S2.9 File name: form, month, establishment code.

Screens and words:
- `ตั้งค่าร้าน › สาขา` (`BranchSettingsPage.tsx`), only for a shop with more than one active branch: `ใครจ่ายเงินและหักภาษี` with `สำนักงานใหญ่จ่ายทั้งหมด` / `แต่ละสาขาจ่ายเอง`, `ใช้ตั้งแต่เดือน`, hint `แบบภาษีหัก ณ ที่จ่ายยื่นในนามผู้ที่จ่ายจริง`, button `บันทึกวิธีจ่าย`, after it `บันทึกวิธีจ่ายแล้ว ใช้ตั้งแต่เดือน …`.
- Page: after the month chooser, `ยื่นในนาม` (shown only when the month has more than one establishment): `สำนักงานใหญ่ (00000)`, `{ชื่อสาขา} ({รหัส})`; the two cards and their buttons belong to the chosen one. In the list each row says `ยื่นโดย {สำนักงานใหญ่ | ชื่อสาขา}`. The fault of a shop that has not answered: `มีรายการจ่ายจากหลายสาขา บอกก่อนว่าใครจ่ายเงินและหักภาษี`, with the link `ตั้งค่าร้าน › สาขา`.

Journey `withholding-forms` (after the month of head office is filed): add a branch with a tax branch code, answer `แต่ละสาขาจ่ายเอง`, record a paid expense from that branch → `ยื่นในนาม` offers two names; the branch's card reads `ยังไม่ได้ยื่น` with one payment and downloads its own paper; head office still reads `ยื่นแล้ว` and its download is byte-for-byte the file downloaded before; the server shows two papers.

Tests: the establishment of a payment in both modes and at a mode change; two establishments in a month give two papers with the right payer blocks; the lock per payment through each reader of P7; a filed paper served from its stored file; real-database spec for the unique key and the backfill.

## Slice 3: additional filing

Data: none beyond slice 2 (`sequence` ≥ 1). The fillers gain the tick `ยื่นเพิ่มเติม` and `ครั้งที่`, measured from the masters in `apps/api/src/modules/tax/assets/`.

Server rules:
- S3.1 The open additional filing of an establishment, form and month holds the payments that are on no filed paper of it, once its `ยื่นปกติ` is filed; `n` is the number of filed additional papers plus one. It has its own download, frozen rows, stored file and `บันทึกว่ายื่นแล้ว`; when filed, the next late payment opens `n + 1`.
- S3.2 Added after filing: enters the open additional filing by itself and is shown at once.
- S3.3 Cancelled after filing: the cancel is allowed, with or without a 50 ทวิ, under the existing rules for cancelling a certificate (today's difference in P6 ends; open point 7). The filed paper keeps its row. The page keeps a line on that paper: `ยกเลิกหลังยื่น: {ผู้รับเงิน} หักไว้ ฿… ระบบแก้แบบที่ยื่นแล้วไม่ได้ ให้ผู้ทำบัญชีแจ้งกรมสรรพากร`. An additional filing cannot take a row away: the correction with the department is the accountant's.
- S3.4 Changed after filing: the facts of a filed payment (amount, rate, type, date, payee's number, who paid) cannot be changed in the system, as today; spelling on the 50 ทวิ keeps its existing way. To change them the person cancels the document and records it again: the new document is a new payment and enters the additional filing in full. The system does not net it against the cancelled row, so the page warns on that paper before download: `มีผู้รับเงินที่ถูกยกเลิกหลังยื่นในเดือนนี้: {ชื่อ} ให้ผู้ทำบัญชีตรวจยอดก่อนยื่น`.
- S3.5 The fault `overdue` applies to `ยื่นปกติ` only. An additional paper prints the tax of its own rows, leaves the surcharge and the grand total empty, and the card says `เงินเพิ่ม (ถ้ามี) ให้ผู้ทำบัญชีคำนวณและกรอกก่อนยื่น` (open point 5).
- S3.6 An additional paper follows slice 1: with an accountant's type on it, it is the accountant's paper and exports its rows.

Screens and words: a card lists its papers, oldest first, one line each: `ยื่นปกติ · ยื่นแล้ว 7 พ.ย. 2569 · 4 รายการ · หักไว้ ฿1,200.00` with `ดาวน์โหลดแบบที่ยื่น`; `ยื่นเพิ่มเติมครั้งที่ 1 · ยังไม่ได้ยื่น · 1 รายการ · หักไว้ ฿90.00` with `ดาวน์โหลดแบบยื่นเพิ่มเติมครั้งที่ 1`, then `บันทึกว่ายื่นแล้ว`. The numbers at the top of the card are the month's, all papers together. In the list each row says which paper it is on: `ยื่นปกติ`, `ยื่นเพิ่มเติมครั้งที่ 1`, or `ยังไม่อยู่ในแบบ`. The dialog of `บันทึกว่ายื่นแล้ว` names the paper.

Journey `withholding-forms` (last): one more paid expense for head office in the filed month → the ภ.ง.ด.3 card shows `ยื่นเพิ่มเติมครั้งที่ 1 · ยังไม่ได้ยื่น · 1 รายการ`, its download is a PDF, `ยื่นปกติ` still reads `ยื่นแล้ว` and downloads the same bytes; mark it filed; cancel the company's expense (filed on ภ.ง.ด.53, no 50 ทวิ) → the line `ยกเลิกหลังยื่น` on that `ยื่นปกติ`, its download unchanged; the server shows the filed papers with their first rows as they were.

Tests: rows of the open additional filing; numbering; the tick and number on both fillers; nothing filed is rewritten (a cancel, a mode change and a re-sync leave the lines and the stored file as they were); the warning of S3.4.

## Slice 4: a file for online filing (after slices 2 and 3)

**Not built (the owner, 2026-10-14, question set 4, ค1):** online filing ends at the accounting office for now; this system offers no online-filing file and shows nothing about it. The research is kept in `docs/research/rd-wht-upload-format-research-2026-10-14.md` for when he asks again (its open point: the published layout is the input of the department's deposit-file program, not of the e-Filing upload).


One file per paper (establishment, form, month, `ยื่นปกติ` or an additional filing), from the same frozen rows as the PDF of that paper, so the two can never differ: the payer and the establishment, the month, the kind of filing, and every payee row with its payments. Button on the card: `ดาวน์โหลดไฟล์ยื่นออนไลน์`. An accountant's paper has none. The exact layout (fields, order, widths, encoding, file name) must be read from the Revenue Department's published format document before building; the accountant pointed at the one for ภ.ง.ด.53, version 2.0. This spec invents none of it, and the document for ภ.ง.ด.3 must be found too (open point 6). Journey: the download is asserted by its name and first bytes as that document defines them.

## Slice 5: the payment decides the month (the owner's accountant, 2026-10-14, question set 5)

Found by a prover and confirmed by reading (slice 2's fix round, item 8): an ordinary expense's withholding is put on the paper of its DOCUMENT date (`expenseDate`), with that date printed as the payment date, as soon as the expense is confirmed, paid or not; the 50 ทวิ prefill takes the same date. Supplier payments (procurement) already use their real payment date. The accountant's answer, taken as given (ท.ป.4/2528 ข้อ 2 and ข้อ 13; the 50 ทวิ form; มาตรา 50 ทวิ):

| Case | Month of ภ.ง.ด.3 / ภ.ง.ด.53 | Payment date on the 50 ทวิ |
|---|---|---|
| Invoice 28 Oct, paid 5 Nov | November | 5 November |
| Rent confirmed 13 Oct, not paid yet | not on any paper yet | no certificate saying tax was withheld |

Rules:
- W1. **Confirming is not paying.** A confirmed expense that is not paid is recorded as a cost and a debt as today, is on no withholding paper, and its 50 ทวิ can only be prepared as a draft (no number, nothing saying tax was withheld).
- W2. **The payment decides.** Each recorded payment of an expense with withholding puts on the paper of ITS month (the month of its real payment date) the income it pays and the tax withheld on it, with that date. The expense page and the supplier-payment page follow the same rule, and the same payment is never counted twice.
- W3. **Paid in parts.** Each payment carries its own share of the income and of the tax into its own month; the whole invoice is never pulled into the month of the first payment.
- W4. **No payment date, no paper.** A payment whose real date is not known (for example a document captured as "already paid" without a date) is asked for its date from the evidence before it goes on a paper; the document date is never used in its place.
- W5. **Recorded late.** A payment can be recorded later with its real date; it belongs to the month of that date, never the month it was recorded in, and the record keeps when it was entered and by whom apart from the payment date. If that month's paper was already filed: when the payment is already on it, it stays as history and is not filed again; when it is not, it goes on that month's additional filing (slice 3), never into a later month.
- W6. **The 50 ทวิ has two dates.** The payment date (= the payment's real date; it decides the month) and the issue date (= the day it is really issued; never back-dated by the system). Issued together with the payment, both are the same day. Issued later, the payment date stays and the month does not move. A certificate that was issued on paper earlier and is only now entered keeps both its original dates; the date of entry is history apart.
- W7. **Paid but not withheld.** When an expense that must be withheld is paid without the tax being withheld (the payment recorded as the full amount), the duty to remit stays: the system does not drop the row from the paper because nothing was recorded as withheld; it tells the person on that expense and on the withholding page to correct the entry (the words of the sentence and where it shows are in the round's brief and pressed by a prover).
- W8. **Nothing filed is rewritten** (slices 2 and 3 stand): rows already on a filed paper keep what was filed; the move from document date to payment date applies to papers not yet filed, and a filed paper whose rows differ from the new rule gets no automatic change (its card says so in one sentence, and the accountant decides; an additional filing carries only payments that were on no paper).
- W9. **No dead ends** (N1 to N4): a payment is never refused for any of this; what waits is the paper or the certificate, with the way to give what is missing on the same screen.

## Rule for every slice: `จำนวนราย`

`จำนวนราย` on the cover is the number of numbered payee rows on the attachment sheets of that paper; a row holds at most three payments; the cover's totals equal the sum of the sheets (`renderOfficialWithholdingForm` in `pnd53-official-form.logic.ts`). One thing to fix: rows are joined only when a payee's payments are next to each other, and the export reads them by date (`findEventsByPeriod` orders by `eventDate`), so a payee paid on the 1st and the 20th with someone else between takes two rows. The lines are ordered by payee (tax number, branch), then date, before they are frozen. Test: a payee with four payments spread over a month among other payees takes two rows, and the cover counts rows.

## Existing data

- Every ภ.ง.ด.3 / ภ.ง.ด.53 `TaxPeriod` that was downloaded or filed gets one `WhtFiling` (`sequence` 0), by a one-off command of the release with a real-database spec: establishment = the code of the one branch its events share (none: `00000`), state and dates from the period, lines from its current events. The old model kept a checksum, not the rows (P5): when the rebuilt rows match the checksum of the downloaded package, the paper is exact and gets a stored file by rendering once (the same rows; its layout can differ from the sheet that was handed in, since the filler has changed since); when they do not (a payment cancelled after filing), `rowsCertain` is false, the card says `รายการของแบบที่ยื่นไว้ตรวจได้ไม่ครบ ให้ผู้ทำบัญชีเทียบกับแบบที่ยื่นจริง`, and no additional filing is computed for it until open point 4 is answered.
- Payments already confirmed into filed months and skipped (P4) appear after the first sync of slice 2 as rows off paper. That is correct and will surprise: the release note says so.
- Expenses that already carry `WHT_INTEREST`, `WHT_DIVIDEND`, `WHT_PRIZE` or an `อื่นๆ` code are counted before slice 1's migration; rows on a filed paper keep what was printed.
- The guide's tax table (`apps/web/src/features/user-guide/tax-guide.content.ts`) lists interest under ภ.ง.ด.3 and shows codes: it follows slice 1.

## Acceptance

- Each slice is pressed on the proof stack through its journey steps, at 390, 1280 and one wide window, as owner and as the person who does the paperwork; the gate is green.
- A shop with one branch and only the five old types sees the page, the papers and the file contents it sees today, except the file name.
- No refusal in these slices is without its way out on the same screen.

## No dead ends (the owner, 2026-10-14)

"Do not forget the shops that are not VAT-registered and the ordinary shops. No dead end, nothing that cannot go on. Every shop must be able to record everything."

- N1. Nothing in these slices refuses recording, confirming, paying or cancelling a document. What can be held back is a paper (a download, `บันทึกว่ายื่นแล้ว`) or one choice, and each such stop says what is missing and carries its link on the same screen.
- N2. A stop is as narrow as its cause: one establishment, form and month. A branch without a code, an unanswered `ใครจ่ายเงินและหักภาษี`, an accountant's type or an unproven old month never holds back another establishment's paper or the other form.
- N3. A shop with one branch, and a shop that never withholds, meets no new question, no new required field and no new line on any screen.
- N4. Each slice's journey walks these cases, and `plain-shop-records-everything` (a shop that is not VAT-registered and has no tax details) stays green through every slice.

## Open points, answered by the owner on 2026-10-14

He answered question set 2 with "as recommended, all of it". The numbers in brackets are the questions of that set.

1. **Rates** (ภ1). No row is opened on a guessed rate. The accountant's table has not come: a prize to a company, interest and dividends stay not selectable, and such a payment is `อื่นๆ` (the accountant prepares that form). Nothing to build until the table comes.
2. **A sales-promotion reward** (ภ2). `อื่นๆ` now; no type of its own.
3. **A branch without a tax branch code** (ภ4). Asked with a recommendation that differs from this draft's, and that is what he took: under `EACH_BRANCH_PAYS` no paper is made for that branch's payments until the code is filled; S2.1 is written that way above, with its link and without holding back anyone else (N2).
4. **Old filed months whose rows cannot be proven** (ภ8). The accountant confirms the rebuilt rows once per month, recorded with who and when; then additional filings are computed for it.
5. **The surcharge on an additional paper** (ภ7). Left empty, with the sentence on the card.
6. **The format documents** (ภ9). The controller may open, read and download the two published documents from the Revenue Department's site; a summary goes to `docs/research/` before slice 4.
7. **A filed payment cancelled or changed** (ภ6). (a) Cancelling is allowed with or without a 50 ทวิ, with the line on the paper. (b) The warning and the export first; no hold-out.
8. **Who answers `ใครจ่ายเงินและหักภาษี`** (ภ5). The people who may edit the shop's registered data (`company.legal_identity.manage`).
9. **How a shop with several branches starts** (ภ3). No guess: the page asks once; until then the shop behaves as today and the fault carries the link (S2.2). A shop with one branch is not asked.
