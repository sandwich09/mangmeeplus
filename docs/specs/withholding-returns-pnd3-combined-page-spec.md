# Spec: ภ.ง.ด.3 beside ภ.ง.ด.53, on one page `ภาษีหัก ณ ที่จ่าย`

Date: 2026-10-13 · Owner: thawatchai · Plan: [docs/plans/sold-ux-owner-decisions-2026-10-13-plan.md](../plans/sold-ux-owner-decisions-2026-10-13-plan.md) (item ข18) · Standard: [docs/guidelines/thai-ux-standard.md](../guidelines/thai-ux-standard.md)

## Why

A shop that withholds tax when it pays must file a monthly return: **ภ.ง.ด.3** for payments to individuals (a freelancer, a landlord who is a person), **ภ.ง.ด.53** for payments to companies. Today the product issues หนังสือรับรอง 50 ทวิ for both kinds but prepares only ภ.ง.ด.53, on a page that shows neither the month's payments nor its certificates. The owner asked (2026-10-13): "ต้องมี ภงด 3 ด้วยไหม และทั้งหมดควรอยู่กับ ทวิ 50 ไหม", was answered yes to both, and said "ทำได้เลย", pointing at FlowAccount as the reference.

Reference seen (FlowAccount, view only): one page `หัก ณ ที่จ่าย`; every row is a withholding document with its date, number, payee, a column saying which form it belongs to (ภ.ง.ด.3 or ภ.ง.ด.53) with the rate, the amount paid with the tax under it, and its state; the filing action sits on the same page. What we take from it: the certificates and both forms live in one place, and the row says which form.

Second look at the reference, at the owner's invitation (2026-10-13, view only, nothing saved): FlowAccount's filing page asks for two things only, the form (ภ.ง.ด.3 or ภ.ง.ด.53) and the tax month, then shows the month's withholding documents of that form (date, number, payee, form and rate, amount with the tax under it) under two totals (amount paid, tax withheld), with one main button that downloads a data file for the Revenue Department's online filing. It does not fill the paper form. A single withholding document there carries the payee (name, address, tax number, branch), the form it belongs to, and one line with the income type, the rate and the amount. What we take from it: form and month are the only choices; totals above the list; one main action. What differs here: our download is the filled official paper, as ภ.ง.ด.53 already is; a file for online filing is a possible later addition and is out of this spec.

## Scope

In:
1. A ภ.ง.ด.3 return prepared exactly as ภ.ง.ด.53 is today: collect the month's withheld payments to individuals, compute totals, resolve review issues, download the official form with its attachment sheets filled in, record that it was filed.
2. One page `ภาษีหัก ณ ที่จ่าย` replacing the ภ.ง.ด.53 page: one month, both forms, that month's payments and certificates.
3. Two defects found while mapping the code (see "Defects").

Out: ภ.ง.ด.1 / 1ก / 2 / 3ก / 54, e-filing files for RD Prep, payment of the tax, anything in LINE, changes to how a certificate is issued or corrected, changes to packages or prices.

## Decisions

- **D1. Who gets it.** ภ.ง.ด.3 belongs to the same sold feature and the same rights as ภ.ง.ด.53: feature `wht_pnd53`, permissions `wht.pnd53.read` / `wht.pnd53.prepare`, pack `pack.wht.pnd53`. Keys stay; their Thai labels become `ออก ภ.ง.ด.3 และ ภ.ง.ด.53 ในระบบ` (feature) and `จัดทำ ภ.ง.ด.3 และ ภ.ง.ด.53` (pack). No new key, no package or price change. (Controller's decision; the owner can ask for a separate key later.)
- **D2. Same limits as ภ.ง.ด.53.** On-time filing only, one branch per return, Thai baht only, categories under มาตรา 3 เตรส only (for individuals: `WHT_SERVICE_3`, `WHT_RENT_IND`, `WHT_PROFESSIONAL_IND`, `WHT_ADVERTISING_IND`, `WHT_TRANSPORT_IND`), and every payee confirmed as an individual with name, 13-digit number and address. Anything else is a review issue on the page with what to fix, never a failed download with no reason.
- **D3. The official paper.** The download is the Revenue Department's own ภ.ง.ด.3 main form and `ใบแนบ ภ.ง.ด.3`, filled in, as ภ.ง.ด.53 is. The owner chose the paper first (2026-10-13, "ตามคำแนะนำ"); a data file for the Revenue Department's online filing is a later, separate job. The two masters come from rd.go.th (`270360_WHT3.pdf`, `270360_attach3.pdf`; downloaded with his permission the same day) and live in `apps/api/src/modules/tax/assets/` as `rd-pnd3-main.pdf` and `rd-pnd3-attachment.pdf`. The filler is `pnd3-official-form.logic.ts` (`renderPnd3OfficialForm`), a sibling of the ภ.ง.ด.53 one sharing its packet builder. What it prints: front side of the main form (payer, month, `ยื่นปกติ`, `มาตรา 3 เตรส`, attachment counts, the four totals with baht and satang in their own boxes), then six payees a sheet with up to three payments a payee. The master splits a payee's name into two slots; the record holds one name, printed whole in the first. A payee without a branch leaves the branch boxes empty. A second address line of the payer that does not fit the building slot goes on the form's unlabelled line beside the postal code.
- **D4. One page.** Menu `ภาษีหัก ณ ที่จ่าย` (where `ภ.ง.ด.53` is today; the old address redirects). The page fills the screen:
  1. Month chooser (months that have withheld payments or a return, newest first).
  2. Two cards side by side on a wide screen, stacked on a phone: `ภ.ง.ด.3 (จ่ายให้บุคคล)` and `ภ.ง.ด.53 (จ่ายให้บริษัท)`. Each shows: state (`ยังไม่ได้ยื่น`, `ดาวน์โหลดแบบแล้ว`, `ยื่นแล้ว`), number of payments, amount paid, tax withheld, due date, what must be fixed (the review issues, each with its way to the record), and the steps in order `ดึงรายการล่าสุด` → `ดาวน์โหลดแบบ` → `บันทึกว่ายื่นแล้ว`. A form with no payment in the month says `เดือนนี้ไม่มีรายการ` and shows no buttons.
  3. `รายการที่หักภาษีของเดือนนี้`: one row per withheld payment: date, payee, which form, income type and rate, amount paid, tax withheld, the certificate's state and number with `ดาวน์โหลดหนังสือรับรอง` when issued, and a link to the expense. Filters: `ทั้งหมด` · `ภ.ง.ด.3` · `ภ.ง.ด.53`. On a phone: stacked rows.
  4. A link to the full list `หนังสือรับรอง 50 ทวิ` (unchanged page), which gains a month filter and a form column.
- **D5. A payee whose kind is unknown** goes to neither form silently: it is a review issue `ยังไม่รู้ว่าผู้รับเงินเป็นบริษัทหรือบุคคล` on the page with a link to the counterparty, and the payment waits. (Today it falls into ภ.ง.ด.53 and the download fails.)

## Rules (server)

- R1. The narrow routes become form-aware: `tax/withholding/{formType}/…` for `PND3` and `PND53` with the same handlers, permissions and reviewer gate; the old `tax/pnd53/…` routes stay as aliases of `PND53`. A period of another form is not reachable through them.
- R2. The narrow sync takes both forms and creates periods and events for both (scope `WHT`), leaving VAT and other tax events untouched as today.
- R3. One read for the page: for a month, both periods (or none) with state, totals, due date, open issues; and the month's withheld payments from the tax events joined to their certificate hand-off (state, number, download right). Scoped to the reader's branches as the existing reads are.
- R4. ภ.ง.ด.3 export: the same checks as `buildPnd53Artifact` with the individual-payee test and the individual category set; the renderer is a sibling of `pnd53-official-form.logic.ts` on the ภ.ง.ด.3 masters (D3). Export number, package row, audit: the existing generic path.
- R5. The certificate list read accepts a month and a form type (from the hand-off's own facts) and returns the form of each row.

## Defects fixed here

- F1. Exporting again must never move a return backwards: a period that is `FILED`, `PAID` or `CLOSED` keeps its state when its form is downloaded again (today any download sets `EXPORTED`).
- F2. D5 (unknown payee kind no longer lands in ภ.ง.ด.53).
- F3. `จำนวนราย` on the main form counts the numbered payee rows of the attachment, not the payments inside them (both forms; it printed the number of payments).
- F4. A value wider than its slot shrinks to fit. The overlay asked for `textLength`, which the rasterizer ignores, so a long name or address ran into the next column (both forms and the 50 ทวิ certificate; they now use the existing `fitToWidth`). The claim form's own condensing uses the same ignored attribute and is left for its own round.

## Screens and words

Standard applies in full: plain Thai, one name per thing (`ภาษีหัก ณ ที่จ่าย`, `ภ.ง.ด.3`, `ภ.ง.ด.53`, `หนังสือรับรอง 50 ทวิ`, `ยังไม่ได้ยื่น`, `ยื่นแล้ว`), the page fills the screen, steps in order of the work, each refusal with its way out. The guide's tax section and the role-ability text follow.

## Acceptance

- A month with payments to one individual and one company shows both cards with the right counts and totals, and the list shows each payment under its form.
- ภ.ง.ด.3: sync, issues, totals, download and record-as-filed work as for ภ.ง.ด.53.
- An unknown payee kind is an issue with a link, in neither form.
- Downloading a filed return again leaves it filed.
- People without `wht.pnd53.read` do not see the menu; people with read but not prepare see the page without the step buttons.
- Tests: use-case and controller specs for both forms (registered files), the filler's packet test, page spec; the real screens looked at as owner and accountant at 390, 1280 and 1556.
