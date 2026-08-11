# Thai Receipt/Bill Field Format Conventions — OCR Extraction Canon

Research date: 2026-08-10; expanded 2026-08-11 (web research; Unicode/RD/AWS/Microsoft-cited). Owner directive: support the
real variety of Thai receipt/bill formats — define per-field format families, print
patterns, labels, and language envelope instead of case-by-case prompt patches.
Trigger: UAT 2026-08-10 hospital receipt via LINE — printed tax ID not extracted; the
date was written into เลขที่เอกสาร (see spec §19j for the normative rules).
Follow-up trigger: the latest UAT Starbucks receipt on 2026-08-11 was correctly recognized
as VAT-included with total 333.00, but both its printed date and printed VAT amount were
missing from the extracted fields (see spec §19k).
Consumed by: `docs/specs/expense-receipt-upload-spec.md` §19j, `RECEIPT_OCR_PROMPT` and
`applyOcrValueCrossCheck` in
`apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts`.
Sibling: `thai-document-conventions-receipt-ocr.md` (document *classification* rubric;
this file is the *field format* rubric).

## 1. vendorTaxId — เลขประจำตัวผู้เสียภาษี 13 หลัก

One legal format, three issuing families. Always 13 digits after stripping separators.

| Family | Number used | First digits | Notes |
|---|---|---|---|
| บุคคลธรรมดา | เลขบัตรประชาชน (กรมการปกครอง) | 1–8 | 13th digit is a documented mod-11 check digit (weights 13→2, check = (11 − sum mod 11) mod 10) |
| นิติบุคคล (จดกับ DBD) | เลขทะเบียนนิติบุคคล | 0 | Same number doubles as ทะเบียนเลขที่ on letterheads |
| ออกโดยสรรพากร (ไม่ได้จด DBD) | RD-issued 13-digit | 099x | คณะบุคคล/มูลนิธิ/สมาคม ≈ 0993…, ส่วนราชการ ≈ 0994000… |

DBD juristic number structure (หลักที่ 1–13): `0` (DBD) · จังหวัด (2) · ประเภท (1:
2 หสน. / 3 หจก. / 4–7 บริษัทรูปแบบต่าง ๆ รวม 5 บจก., 7 บมจ. / 8–9 หอการค้า-สมาคมการค้า /
0 นิติบุคคลต่างประเทศ) · ปี พ.ศ. ที่จด 3 ตัวท้าย (3) · ลำดับ (5) · check digit (1).
Verified example: บมจ. ท่าอากาศยานไทย `0107545000292` (digit 4 = 7 มหาชน, digits 5–7 =
545 → พ.ศ. 2545). Government example: กรมศุลกากร `0994000163011`. State hospitals are
ส่วนราชการ → expect the `0994000…` family on their receipts.

Check-digit stance: the citizen-ID mod-11 algorithm is public; the DBD check-digit
algorithm is **not** publicly documented. → Validation gate stays *13 digits exactly*
(the repo-wide convention: onboarding, substitute receipts, review page all check
`/^\d{13}$/` after stripping `[- ]`). Checksum must NOT be a hard gate — it would
reject legitimate juristic IDs on an unverified algorithm.

Print patterns seen in the wild:
- Solid run: `0105561000105`
- Citizen grouping: `X-XXXX-XXXXX-XX-X`
- Juristic grouping: `0-XX-X-XXX-XXXXX-X` (and looser space groupings from dot-matrix printers)
- OCR reality: Typhoon markdown may keep or drop the dashes; matching must compare digit
  sequences, never raw strings.

Labels (TH/EN): เลขประจำตัวผู้เสียภาษี, เลขประจำตัวผู้เสียภาษีอากร, เลขผู้เสียภาษี,
เลขทะเบียนนิติบุคคล, ทะเบียนเลขที่, TAX ID, Tax ID No., TIN, Tax Identification No.

Placement: usually the seller header block (near name/address); hospital receipts and
POS slips often print it in the **footer** in small type — a full-page read must not stop
at the header. A full ใบกำกับภาษี (ม.86/4(3)) prints **two** tax IDs — seller AND buyer;
the seller's sits with the issuer header, the buyer's inside the ลูกค้า/ผู้ซื้อ block.

## 2. vendorBranchCode — สาขาที่ออกใบกำกับภาษี

ประกาศอธิบดีกรมสรรพากร (ฉบับที่ 199) พ.ศ. 2556: tax invoices must state the issuing
สถานประกอบการ. Accepted head-office forms: `สำนักงานใหญ่`, `สนญ`, `HO`, `HQ`,
`Head Office`, or five zeros `00000`. Branch forms: `สาขาที่ 3`, `สาขา 00003`,
`Branch 00003` — the number per the VAT registration (ภ.พ.20). Canonical storage form:
5-digit zero-padded string; head office = `00000`. Typically printed adjacent to the
seller tax ID (e.g. `(สำนักงานใหญ่)` suffix after the address).

## 3. documentNumber — เลขที่เอกสาร families

Legal anchor: ม.86/4(2) requires ใบกำกับภาษี to carry เล่มที่/เลขที่; กรมบัญชีกลาง-style
official receipts likewise carry เล่มที่ + เลขที่. Families:

| Family | Shape | Example |
|---|---|---|
| Carbon book (ราชการ, โรงพยาบาล, บิลเงินสดเขียนมือ) | เล่มที่ X + เลขที่ Y | เล่มที่ 12 เลขที่ 345 → reference as `12/345` |
| Running over ปี พ.ศ. | N/YYYY(BE) | `123/2569` — **not a date** (123 is no valid day) |
| POS / ABB slip | long digit run, may embed date-like substrings | `RC2608100123`, `680810123456` |
| Prefixed alphanumeric | prefix-year-seq | `INV-2569-0001`, `RE6808-00123`, `TX680001` |
| e-Tax Invoice / e-Receipt | seller-defined running no. (XML per ขธมอ.3-2560) + paper marker "เอกสารนี้ได้จัดทำและนำส่งข้อมูลให้กรมสรรพากรแล้ว" | per seller |

Labels: เลขที่, เลขที่ใบเสร็จ, เลขที่เอกสาร, เลขที่ใบกำกับภาษี, เล่มที่/เลขที่, No.,
Receipt No., Rcpt#, Doc No., Invoice No., Tax Inv No., ABB No., Bill No.

**Negative list — numbers on the page that are NEVER the document number:**
- วันที่ (the reported bug: เลขที่ and วันที่ sit in adjacent boxes; OCR column drift
  swaps them)
- Hospital patient/visit numbers: `HN` (Hospital Number), `AN` (Admission Number),
  `VN` (Visit Number) — printed prominently near the header on hospital receipts
- Queue/table numbers (คิว, Queue, โต๊ะ/Table), POS terminal/merchant ids (TID/MID),
  card approval codes (เลขอนุมัติ/APPROVAL CODE), the tax ID itself, phone numbers,
  member/card numbers

## 4. expenseDate — locale families, not numeric-only

Unicode CLDR defines Thai wide months (`กรกฎาคม`, `สิงหาคม`), abbreviated months
(`ก.ค.`, `ส.ค.`), and Thai date order `d MMM y`; English includes both `MMM d, y` and
`d MMM y`, plus the two-digit-year form `MMM d, ’yy`. LDML parsing guidance explicitly
says abbreviated symbols should match both with and without their abbreviation marker.
That matters for OCR: dots, commas, apostrophes, and spaces are commonly dropped, so
`ก.ค.`, `กค`, `Aug.`, and `Aug` are the same month evidence, not separate templates.

Supported families:

- Numeric: `10/08/2569`, `10-08-2026`, `2026-08-10`, ตัวเลขไทย ๐-๙. Numeric dates
  whose two-digit year has no calendar/language anchor remain ambiguous and require review.
- Thai named month, day first: `10 สิงหาคม 2569`, `10 ส.ค. 69`, `10 สค 69`, including
  all punctuation-stripped aliases `มค กพ มีค เมย พค มิย กค สค กย ตค พย ธค`.
- English named month, either order: `23 Aug 2026`, `Aug 23, 2026`, `23 Aug. ’26`,
  `Aug 23 26`, full or abbreviated month names, case-insensitive.
- Four-digit years keep the existing deterministic era rule (2400–2700 = BE; 1900–2399
  = CE). A two-digit year attached to a Thai month name is read in the Thai Buddhist
  calendar (`สค 69` = 2569); one attached to an English month name is read in the
  Gregorian calendar (`Aug 26` = 2026). The language anchor resolves only named-month
  dates; `10/08/69` still exposes both defensible readings and is never guessed.

The date grammar still has exactly one home (`extractValueCandidates`). Receipt OCR and
LINE text reuse the same candidates; per-vendor regexes are prohibited. When stage 2 omits
the field, receipt OCR may recover only one unambiguous candidate carrying an explicit
receipt/transaction/issue/document-date label; unlabeled or multiple dates stay for review.

## 5. vatAmount — printed money independent of vatRate

Receipt schemas from AWS Textract and Microsoft Document Intelligence model `TAX` /
`TotalTax` as a monetary field. Microsoft separately models tax detail `Amount`, `Rate`,
and `NetAmount`; therefore a receipt does not need to print a percentage for its printed
VAT amount to be valid extraction evidence. Thai Revenue Code section 86/4 likewise
requires the VAT **amount** to be shown separately from the goods/service value on a full
tax invoice, while an abbreviated tax invoice may include VAT in the displayed price.

Label families (either label-before-amount or amount-before-label): `VAT`, `VAT AMT`,
`VAT AMOUNT`, `VAT TTL`, `VAT TOTAL`, `TOTAL VAT`, `TAX`, `TAX AMT`, `TAX AMOUNT`,
`TOTAL TAX`, `ภาษี`, `ยอดภาษี`, `ภาษีมูลค่าเพิ่ม`. Examples: `VAT AMT 21.79`,
`21.79 VAT TTL`, `ภาษีมูลค่าเพิ่ม 21.79 บาท`. A nearby `7%` is `vatRate`; `21.79` is
`vatAmount`. One may exist without the other. Extraction copies printed money exactly;
it never computes an unprinted VAT amount merely from total × rate.

Deterministic recovery is intentionally narrow: recover only a decimal/currency amount
adjacent to a VAT/tax amount label, only when there is exactly one distinct candidate.
Rate-only text (`VAT 7.00%`), multiple different VAT components, and unlabeled arithmetic
remain review items.

## 6. vendorName — ชื่อผู้ขาย

Legal-form markers (TH): บริษัท … จำกัด (มหาชน), บจ./บจก./หจก./หสน./บมจ., ร้าน,
โรงพยาบาล/รพ., คลินิก, มหาวิทยาลัย, ส่วนราชการ names. (EN): Co., Ltd., PLC, Ltd., Part.
When both a trade/brand name (logo) and a juristic name are printed, the juristic name
adjacent to the tax ID is the vendor identity; the brand can stay in `description`.

## 7. Language envelope

Typhoon OCR (SCB10X, all released variants incl. 1.5) is **bilingual Thai + English**
by design, trained on Thai financial documents, government forms, and handwriting.
Policy tiers for extraction:
- Tier 1 (full field extraction): Thai, English, mixed TH-EN documents.
- Tier 2 (no field invention): other languages (CJK, etc.) — stage 2 must omit fields it
  cannot ground in the OCR text; classification/review path decides handling. Fields are
  never guessed from an unsupported-language document.

## 8. Collision traps observed on UAT

- เลขที่ ↔ วันที่ adjacent boxes → date lands in documentNumber; downstream this flips a
  RECEIPT to `USABLE_FOR_TAX` (a doc number "exists") and poisons the duplicate scorer
  (+30 on exact vendorDocumentNumber match).
- Small-type footer tax ID + dashed grouping → stage-2 omission even when stage-1 read it.
- HN printed larger than เลขที่ → HN is the tempting (wrong) pick for documentNumber.
- Month-first English dates and punctuation-stripped Thai abbreviations were absent from
  the shared grammar; stage 2 could normalize them but the §13 cross-check then discarded
  the date as unsupported.
- A VAT-included classification does not prove the amount. Conversely, a printed VAT
  amount does not need a printed percentage; tying `vatAmount` to `vatRate` drops real data.

## 9. Sources

- RD 13-digit tax ID usage: https://www.rd.go.th/46203.html ; OECD TIN note (juristic =
  DBD number; others RD-issued): https://www.oecd.org/content/dam/oecd/en/topics/policy-issue-focus/aeoi/thailand-tin.pdf
- Tax ID families/explainers: https://flowaccount.com/blog/tax-id-number/ ,
  https://www.peakaccount.com/blog/tax/gen-tax/tax-id , https://bmu.co.th/tax-id/
- Government-agency tax IDs (0994000…, examples): https://www.accountingcenter.co/blog/government-agency-taxid
- DBD juristic number structure: https://corpusx.bol.co.th/blogs/company-id-13-digit-structure-thailand-guide/ ,
  https://www.thaichamber.org/news/view/510/2884/smart-to-know
- Citizen-ID mod-11 check digit: https://www.aiprise.com/blog/thailand-personal-identification-number-pin-check-verification ,
  https://freeutil.app/tools/thai-id-validator/
- Branch code (ประกาศอธิบดีฯ ฉบับที่ 199): https://www.rd.go.th/27982.html ,
  https://www.bangkokbiznews.com/business/544334 , RD คู่มือใบกำกับภาษี:
  https://www.rd.go.th/fileadmin/user_upload/ebook/taxinvoice.pdf
- Full tax invoice required fields (ม.86/4): https://www.rd.go.th/5208.html ,
  https://www.peakaccount.com/blog/tax/gen-tax/tax-full-invoice
- Official receipt เล่มที่/เลขที่ samples: https://finance.wu.ac.th/wp-content/uploads/2020/04/ตัวอย่างใบเสร็จรับเงิน.pdf ,
  https://www.en.kku.ac.th/web/wp-content/uploads/2018/10/ลักษณะใบเสร็จรับเงินบิลเงินสดใบสำคัญรับเงินที่ถูกต้อง-v4.pdf
- Hospital OPD billing (HN/AN usage): https://pyh.moph.go.th/index.php/downloads/category/3-manual?download=89%3Afinance-opd
- e-Tax Invoice & e-Receipt (ขธมอ.3-2560 XML): https://www.etda.or.th/th/Our-Service/e-tax-Invoice-Receipt.aspx ,
  https://www.rd.go.th/publish/seminar/180820_eTaxInvoice-eReceipt_doc.pdf
- Typhoon OCR bilingual envelope: https://huggingface.co/scb10x/typhoon-ocr-7b ,
  https://github.com/scb-10x/typhoon-ocr , https://arxiv.org/html/2601.14722v1
- Unicode CLDR Thai locale data and date grammar: https://unicode.org/cldr/charts/45/summary/th.html ,
  https://unicode.org/cldr/charts/49/summary/en.html ,
  https://cldr-smoke.unicode.org/spec/main/ldml/tr35-dates.html
- AWS Textract AnalyzeExpense standard receipt fields (`INVOICE_RECEIPT_DATE`, `TAX`):
  https://docs.aws.amazon.com/textract/latest/dg/invoices-receipts.html
- Microsoft Document Intelligence receipt schema (`TransactionDate`, `TotalTax`, and
  separate tax `Amount`/`Rate`/`NetAmount`):
  https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/receipt?view=doc-intel-4.0.0
- RD Revenue Code section 86/4 — VAT amount and issue date as distinct required fields:
  https://www.rd.go.th/5208.html
