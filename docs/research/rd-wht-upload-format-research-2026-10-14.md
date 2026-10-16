# Revenue Department upload formats for ภ.ง.ด.53 and ภ.ง.ด.3 — research notes

> Kept from the session of 2026-10-14 for withholding slice 4 (`docs/specs/withholding-returns-complete-spec.md`). The downloaded files are NOT in the repository (they are the Revenue Department's; fetch them again from the URLs and compare the sha256). Read section 0 point 3 before designing: the published layout is the input of the department's own deposit-file program, and whether the e-Filing upload or RD Prep takes it as it is is an open question for the owner's accountant.

Research date: 2026-10-14. Sources are the Thai Revenue Department's own sites only (rd.go.th, efiling.rd.go.th).
Everything below is a summary in my own words; Thai words are the documents' own field names and code labels.
Page numbers are PDF page numbers of the saved files.

## 0. What was found, in short

1. Both documents exist on the official page "รูปแบบข้อมูล (ฟอร์แมตกลาง)" (https://www.rd.go.th/63724.html):
   "รูปแบบข้อมูล (FORMAT กลาง) ภ.ง.ด.53" and "รูปแบบข้อมูล (FORMAT กลาง) ภ.ง.ด.3 และ ภ.ง.ด.3ก", both
   "Version 2.0 ปรับปรุง ณ วันที่ 16/06/2568" (16 June 2025). No login was needed.
2. Format 2.0 is one text file per return: UTF-8, fields separated by `|`, records separated by CR/LF,
   one header record `H` (25 fields, carries the return's totals) followed by detail records `D` (38 fields).
   One detail record carries up to 3 payments for one payee. There is no trailer record.
3. **Important about where this file goes.** The official material read here says the Format 2.0 text file is the
   input of the department's WHT Software Component (SWC / SWC-UI) "deposit file" channel
   (ยื่นแบบด้วยสื่อฯ ฝากไฟล์), which needs a registration, a registration reference number and a digital certificate
   (SWC-UI manual pp. 4–9, 35–36). SWC then produces a file ending `whtc.rdx` that is uploaded on e-Filing.
   The e-Filing FAQ says a `.txt` file cannot be uploaded to e-Filing directly; e-Filing takes an `.rdx` file made by
   RD Prep. The RD Prep manual does **not** prescribe a column layout: the user picks the separator and maps the
   columns by hand (RD Prep manual pp. 37–39). So "Format 2.0" is the only officially specified raw layout, but no
   official document read here says RD Prep or the e-Filing upload page accepts a Format 2.0 file as it is.
   See section 2 and open questions Q1–Q2.
4. A second, older official layout ("Format 1.0": one payment per line, payer block repeated on every line,
   branch 5 digits, ยื่นปกติ/ยื่นเพิ่มเติม as two fields) is still published as a companion and can be converted to
   Format 2.0 by SWC-UI. It is summarised in section 5.

## 1. Sources

### 1.1 Files downloaded (all from rd.go.th domains)

Base directory: `<session scratch>/rd-format/files/`

| # | Saved as (under base dir) | URL | Title as printed | Version / date as printed | Bytes | sha256 |
|---|---|---|---|---|---|---|
| A | `pnd53-v2/FormatPND53V2_0.pdf` (5 pages) | https://www.rd.go.th/fileadmin/user_upload/WHT/Download/FormatPND53V2_0.pdf | Page head: "รูปแบบการนำส่งข้อมูลภาษีเงินได้หัก ณ ที่จ่ายด้วยสื่อบันทึกข้อมูลในระบบคอมพิวเตอร์ หรือรูปแบบอิเล็กทรอนิกส์"; title: "รูปแบบข้อมูล (FORMAT กลาง) ภ.ง.ด.53" | Footer: "กรมสรรพากร Version 2.0 ปรับปรุง ณ วันที่ 16/06/2568". Web listing: version 2, 16/06/2025. Server Last-Modified 2025-06-16 | 245986 | `cbbe88d5088dbbbba905627165e105fa8cc02420adeeea9f434393c9cbdff008` |
| B | `pnd3-v2/FormatPND3V2_0.pdf` (6 pages) | https://www.rd.go.th/fileadmin/user_upload/WHT/Download/FormatPND3V2_0.pdf | Same page head; title: "รูปแบบข้อมูล (FORMAT กลาง) ภ.ง.ด.3 และ ภ.ง.ด.3ก" | Footer: "กรมสรรพากร Version 2.0 ปรับปรุง ณ วันที่ 16/06/2568". Web listing: version 2, 16/06/2025. Server Last-Modified 2025-06-16 | 317990 | `702b89c722787c6880cfd448376c9fd745b9213a9752d6c091d38700d8906a87` |
| C | `pnd53-table-v1/format_Media53.pdf` (3 pages) | https://www.rd.go.th/fileadmin/user_upload/WHT/swc1.5.1/format_Media53.pdf | Page head: "โปรแกรมภาษีเงินได้นิติบุคคลหัก ณ ที่จ่าย ยื่นด้วยสื่อคอมพิวเตอร์ (Media)"; title: "Format กลาง ภ.ง.ด.53" | Footer p.1 "Ver 1.0 Nov-2006", pp.2–3 "Ver 2.3 pack 1 Aug-2012". Web listing: "ตารางรูปแบบข้อมูล ภ.ง.ด.53", version 1.0, 14/2/2023 | 90821 | `d06b953d245a4ca5152a471d9b32308910aeb57400f51e283c3bc831cce8f3e9` |
| D | `pnd3-table-v1/format_Media3.pdf` (3 pages) | https://www.rd.go.th/fileadmin/user_upload/WHT/swc1.5.1/format_Media3.pdf | Same page head; title: "ภาคผนวก FORMAT กลาง ภ.ง.ด.3" | Footer "Ver 2.3 pack 1 Aug-2012". Web listing: "ตารางรูปแบบข้อมูล ภ.ง.ด.3 และ ภ.ง.ด.3ก", version 1.0, 14/2/2023 | 87952 | `4af187b5e0f93831252d09b93bc343074ed0950461ec8102e6a5efbd12beb64d` |
| E | `rdprep-manual/RDPrep.pdf` (63 pages) | https://efiling.rd.go.th/content/download/RDPrep.pdf | "คู่มือการจัดเตรียมข้อมูลแบบ ผ่านโปรแกรม RD Prep เวอร์ชัน 1.0" | "เวอร์ชัน 1.0"; no printed date. PDF created 2021-09-16; server Last-Modified 2021-09-16 | 6441622 | `a81e04f18325135523a4721cf2eb191a2ff312ec830efeee642059602654f259` |
| F | `swc-ui-manual/swc-ui_manual_1.5.4.pdf` (83 pages) | https://www.rd.go.th/fileadmin/user_upload/WHT/swc1.5.4/swc-ui_manual_1.5.4.pdf | "คู่มือโปรแกรมช่วยนำส่งข้อมูล SWC User Interface (SWC-UI)" | Footer "SWC-UI Version 1.5.4". Web listing (https://www.rd.go.th/63742.html): 30/6/2025. PDF created 2025-06-26 | 5308145 | `2b4c99b96711c76b18e3ca3d6a6fc229cdbab0d61fe7387d3b56fba4a6e7bf22` |
| G | `sample-data-zip/swc_Data_Test.zip` | https://www.rd.go.th/fileadmin/user_upload/WHT/Download/swc_Data_Test.zip | Web listing on the format page: "ตัวอย่างข้อมูล" | Listing date 29/11/2022; files inside dated 2015–2019 | 6829 | `a303a349025c24162f7c27eb5f686d74e8d1be5a97995136d29660df3c360a7a` |

Extracted from G into `sample-data-extracted/swc_Data_Test/` (only the three files for these forms; nothing was executed):

| File | Bytes | sha256 |
|---|---|---|
| `PND53_TTTTTTTTTTTTT_000000_2555_04_00_01.txt` | 3279 | `a027d8e3b82af37caa7b5aaefdfbd87135800c891de1874ecee4976f1c7d128b` |
| `PND3_TTTTTTTTTTTTT_000000_2555_06_00_01.txt` | 2925 | `5e02f0f2d733163fe9abac1828efcfd48b563591a6a2147d3da09a7d5fe15239` |
| `PND3A_TTTTTTTTTTTTT_000000_2555_00_00_00.txt` | 2913 | `eaa22b4aae4c61dbeafe81ce5e0250000b84a8638b855020914f542abd5e809d` |

Notes on handling:
- A and B are the two requested documents. C and D are the older tables published on the same page. E is the RD Prep
  manual named in the brief. F and G were added because they are the department's own companions to the same format
  (F is the manual of the program that consumes Format 2.0; G is the sample data linked on the format page). F was
  first fetched by the web-fetch tool, which kept its own copy at
  `<session tool results>/webfetch-1791940259299-wt5939.pdf`; the copy listed above is identical.
- Working files (extracted text, page excerpts, two small helper programs) are in `…/rd-format/derived/`, `…/rd-format/scripts/` and `…/rd-format/bin/`.

### 1.2 Official pages read but not saved

| Page | What it gave |
|---|---|
| https://www.rd.go.th/63724.html "รูปแบบข้อมูล (ฟอร์แมตกลาง)" | The download list: Format กลาง V2 for ภ.ง.ด.1/1ก/1ก พิเศษ, ภ.ง.ด.2/2ก, ภ.ง.ด.3/3ก, ภ.ง.ด.53 (all version 2, 16/06/2025), the 1.0 tables, the 1.0 Excel templates, "ตัวอย่างข้อมูล" |
| https://www.rd.go.th/64592.html "การยื่นแบบ กรณีตัวแทน" | Links the same ภ.ง.ด.53 file (listed there as version 2, 15/3/2018, 0.18 MB — same URL as A); says an agent puts 2 in field number 5 and recommends SWC |
| https://www.rd.go.th/63742.html | SWC / SWC-UI 1.5.4 download list |
| https://efiling.rd.go.th/rd-cms/ask (FAQ) | Statements about RD Prep, `.rdx`, `.txt`, `.csv` used in section 2 |
| https://efiling.rd.go.th/rd-cms/knowledge | The e-Filing manuals for "ยื่นแบบภาษีเงินได้หัก ณ ที่จ่าย (ภ.ง.ด.1, 2, 3, 53)" and newer RD Prep manuals are linked to **Dropbox**, not an rd.go.th domain — not opened, not downloaded |
| https://whtsvs.rd.go.th/WHTSVS/view/svsr/svsr044_5c | Public page; describes an import layout for ภ.ง.ด.1/1ก only — not relevant to 3/53 |

### 1.3 Official files seen but not retrieved

- `https://www.rd.go.th/fileadmin/user_upload/WHT/format1.0/Format1.0_PND53.xlsx` and `…/Format1.0_PND33A.xlsx` (Format 1.0 Excel templates, listed 27/3/2023).
- `https://www.rd.go.th/fileadmin/user_upload/WHT/Download/format/FormatPND53V2_10022568.pdf` (the previous revision of A, dated 10/02/2568 by its file name) — so what changed on 16/06/2568 is not known (Q20).
- `https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/format_pnd53_58dg256.pdf` (an older copy attached to a legal notice).

## 2. Which file goes into which channel (official statements only)

| Statement | Source |
|---|---|
| Format 2.0 is "for filing by computer media or by internet of the Revenue Department" | A p.5 and B p.6, requirement 1 |
| SWC deposits the attachment file with the department's server over the internet; the system then issues the return with a deposit reference number. SWC-UI is the window front-end. One submission can carry 1–2 million records | F pp. 4–5 |
| Using SWC needs a registration, approval, a registration reference number, user name/password and a digital certificate | F pp. 6–9 |
| The data loaded into SWC must follow the department's Format กลาง; in SWC-UI the user browses to "the file prepared according to Format 2.0"; a wrongly named file is refused ("ชื่อไฟล์ไม่ถูกต้อง"); step 1 checks the content against Format 2.0 | F p. 9 (6.6), pp. 35–36 |
| After the deposit, SWC writes a PDF return and a file ending `whtc.rdx`; that file is uploaded on e-Filing to file and pay without attaching the detail again | F pp. 5, 39, 46–47, 51 |
| SWC-UI converts Format 1.0 files (text, Excel or CSV — from payroll, GFMIS or the old CD media) into Format 2.0; the form type, sender role, department name, LTO status and branch type are then chosen on screen | F pp. 4, 56–62 |
| For an agent (ผู้กระทำการแทน) filing ภ.ง.ด.53, field 5 is set to 2, and the department recommends SWC for sending the data and filing | https://www.rd.go.th/64592.html; A p.1 field 5 |
| RD Prep supports ภ.ง.ด.3, 3ก and 53 | E p. 3 |
| RD Prep "transfer" (โอนย้าย): the user types the payer's tax ID and branch, picks the file, picks ยื่นปกติ or ยื่นเพิ่มเติม (the number is shown automatically), month/year, then chooses "split by a symbol" (and which symbol) or "split by character position", may switch on "first line is the column names", and in step 2 matches each column of the file to a target field. The manual's worked examples are ภ.พ.30 (a `,`-separated .csv) and ภ.ง.ด.91; it has no column list for ภ.ง.ด.3 or 53 | E pp. 36–39 (and 48–52 for ภ.ง.ด.91) |
| RD Prep's transfer accepts `.txt` and `.csv`; a `.txt` cannot be uploaded to the new e-Filing — the upload needs the `.rdx` made by RD Prep; if spaces turn into odd characters, re-save the file as UTF-8; an attachment file exported from the SVS program can be uploaded directly; more than 1,000 attachment lines must go through an `.rdx` made by transfer; e-Filing assigns the additional-filing number itself; RD Prep is not compulsory (lines can be typed online) | https://efiling.rd.go.th/rd-cms/ask |

Caveat: the rows citing web pages (the e-Filing FAQ and 64592.html) rest on the page text as returned by the
page-reading tool, not on a saved copy; re-read those pages before relying on the exact wording. The rows citing
A, B, E and F were read from the saved files.

## 3. ภ.ง.ด.53 — Format กลาง Version 2.0 (document A)

### 3.1 File-level rules (A p.5, "ข้อกำหนด" 1–16)

| Topic | Rule | Ref |
|---|---|---|
| File type | Text file, name ends `.txt` | req. 3 |
| File name | `TAX_TYPE` `_` `NID` (payer's 13-digit tax ID) `_` `BRANCH_NO` (6) `_` `TAX_YEAR` (4) `_` `TAX_MONTH` (2) `_` `FORM_TYPE` (2) `_` ครั้งที่ส่ง (send number, 00–99) `.txt` | req. 3 |
| Encoding | "UNICODE … UTF8" | req. 6 |
| Delimiter | Pipe `\|` between fields; no pipe at the start or the end of a record | req. 7 |
| Line ending | CR/LF | req. 7 |
| Structure | Part 1 Header: the first row, exactly 1 row. Part 2 Detail: the following rows. No trailer | req. 4 |
| Numbers | N (15,2) = total length 18 counting the decimal point; no data → `0.00` | req. 8 |
| Rounding | Third decimal 5 or more rounds up | req. 9 |
| Forbidden characters | `* + / \ ! $ % # & @`, "reserved words", comma, single quote, double quote | req. 10 |
| Mandatory / optional | M must have data as described; O may be empty | req. 11–12, notes |
| Empty values | Money → `0.00`; text (C) → empty; an empty field is two pipes side by side | req. 13–14 |
| Lengths | Maximum lengths; no padding with spaces or zeros is needed (the document's example is a name written at its real length) | req. 15 |
| Payments per row | One sequence number of one payee carries up to 3 income items; a payee with more (the document's example: 5) continues on the next sequence number (items 1–3 in sequence 1, items 4–5 in sequence 2 or the next) | req. 16 |
| Per-channel completeness | Data must be complete "as marked X" for each filing method (the tables actually use M/O — see Q9) | req. 5 |
| Legend | M = Mandatory, O = Optional, C = Character, N = Numeric; "ยื่นด้วยสื่อฯ" = filing by computer media; "ยื่นอินเทอร์เน็ต" = filing by internet | p.5 notes |

Reading the tables below: **M/O** is written as *overall · media · internet*, exactly the document's three columns
("M/O", "ยื่นด้วยสื่อฯ", "อินเทอร์เน็ต").

### 3.2 Header record — "ส่วนที่ 1 : HEADER ส่วนข้อมูลที่เป็นแบบยื่นรายการ" (A pp.1–2)

| # | Field name | Thai name | Type | Len | M/O | Allowed values / rule | Example printed | p. |
|---|---|---|---|---|---|---|---|---|
| 1 | HEADER | Header | C | 1 | M·M·M | Must be `H`, capital | H | 1 |
| 2 | SENDER_ID | รหัสผู้นำส่ง | C | 4 | M·M·M | Bank code or a code given by the department; media filing → `0000` | 0000, 0006 | 1 |
| 3 | SENDER_NID | เลขประจำตัวผู้เสียภาษีอากรผู้นำส่ง | C | 13 | M·M·M | Sender's 13-digit tax ID | 1234567890123 | 1 |
| 4 | SENDER_BRANCH | สาขาที่ผู้นำส่ง | C | 6 | M/O·M·O | Branch per VAT or SBT registration (VAT wins if both); branch 1 = `000001`; no branch → head office `000000` | 000000 | 1 |
| 5 | SENDER_ROLE | ประเภทการนำส่ง (ในฐานะ) | C | 1 | M·M·M | 1 = ผู้หักภาษี ณ ที่จ่าย, 2 = ผู้กระทำการแทน, 3 = ตัวกลาง, 4 = ยื่นรวม | 1 (1 ถึง 4) | 1 |
| 6 | TAX_TYPE | ประเภทแบบภาษี | C | 8 | M·M·M | `PND53` | PND53 | 1 |
| 7 | NID | เลขประจำตัวผู้เสียภาษีอากรผู้มีหน้าที่หักภาษี | C | 13 | M·M·M | Payer's 13-digit tax ID | 1234567890 (sic, 10 digits printed) | 1 |
| 8 | BRANCH_NO | สาขาที่ผู้มีหน้าที่หักภาษี | C | 6 | M/O·M·O | Same rule as field 4 | 000000 | 1 |
| 9 | DEPT_NAME | ชื่อ แผนก/ส่วน/ฝ่าย หรือสำนักงานใหญ่ | C | 80 | M/O·M·O | Name of the department/section that submits, or "สำนักงานใหญ่" when not split by department | สำนักงานใหญ่/แผนกบัญชี | 1 |
| 10 | SECTION3 | มาตรา 3 เตรส | C | 1 | M·M·M | 0 = not remitting under this section, 1 = remitting | 1 | 1 |
| 11 | SECTION65 | มาตรา 65 จัตวา | C | 1 | M·M·M | 0 / 1 as above | 1 | 1 |
| 12 | SECTION69 | มาตรา 69 ทวิ | C | 1 | M·M·M | 0 / 1 as above | 1 | 1 |
| 13 | LTO | สถานะผู้ประกอบการรายใหญ่ (LTO) | C | 1 | M/O·O·M | 0 = ไม่เป็น, 1 = เป็น | 1 หรือ 0 | 2 |
| 14 | TAX_MONTH | เดือนภาษี | C | 2 | M·M·M | 01 = January … 12 = December | 01, 12 | 2 |
| 15 | TAX_YEAR | ปีภาษี | C | 4 | M·M·M | Buddhist-era year, 4 digits | 2557 | 2 |
| 16 | BRANCH_TYPE | ประเภทสาขา | C | 1 | M/O·O·M | V = VAT branch, S = SBT branch; both → V; media filing with no value → leave empty | V | 2 |
| 17 | FORM_TYPE | ประเภทการยื่นแบบ | C | 2 | M·M·M | 00 = ยื่นปกติ; 01 = ยื่นเพิ่มเติมครั้งที่ 1; 02–99 = ครั้งที่ 2–99 | 00 หรือ 01 | 2 |
| 18 | TOT_NUM | รวมจำนวนราย | N | 7 | M·M·M | Total number of entries of the attachment; none → 0 | 100 | 2 |
| 19 | TOT_AMT | รวมจำนวนเงินได้ทั้งสิ้น | N | 15,2 | M·M·M | None → 0.00 | 5000.00 | 2 |
| 20 | TOT_TAX | รวมจำนวนเงินภาษีนำส่งทั้งสิ้น | N | 15,2 | M·M·M | None → 0.00 | 1500.00 | 2 |
| 21 | SUR_AMT | จำนวนเงินเพิ่ม | N | 15,2 | M·M·M | None → 0.00 | 1000.00 | 2 |
| 22 | GTOT_TAX | จำนวนเงินรวมยอดภาษีนำส่งทั้งสิ้นและเงินเพิ่ม | N | 15,2 | M·M·M | None → 0.00 | 2000.00 | 2 |
| 23 | TRANS_AMT | จำนวนเงินโอนผ่านธนาคาร | N | 15,2 | M·M·M | None → 0.00 | 5000.00 | 2 |
| 24 | USER_ID | รหัสลงทะเบียน | C | 20 | M·M·M | Internet filing = the login code; media filing = the registration reference number | 9999999990000 / 25570100600000000020 | 2 |
| 25 | FORM_FLAG | ช่องทางการยื่นแบบ | C | 1 | M·M·M | 1 = ยื่นสื่อฝากไฟล์; 2 = "ยื่นแบบผ่าน…" (the cell is cut off in this document; document B reads 2 = ยื่นแบบอินเตอร์เน็ต) | 1 | 2 |

### 3.3 Detail record — "ส่วนที่ 2 : DETAIL ส่วนข้อมูลที่เป็นใบแนบรายการ" (A pp.3–4)

| # | Field name | Thai name | Type | Len | M/O | Allowed values / rule | Example printed | p. |
|---|---|---|---|---|---|---|---|---|
| 1 | DETAIL | Detail | C | 1 | M·M·M | Must be `D`, capital | D | 3 |
| 2 | SEQ_NO | ลำดับที่ | N | 10 | M·M·M | Sequence number in the attachment; no more than 3 payment items per sequence | 1 | 3 |
| 3 | BRANCH_NO | สาขาผู้หักภาษี | C | 6 | M·M·M | Branch **of the payer**, e.g. 000001 | 000000 | 3 |
| 4 | NID | เลขประจำตัวผู้เสียภาษีอากร ผู้มีเงินได้ | C | 13 | M·M·M | Payee's 13-digit tax ID | 0123458678989 | 3 |
| 5 | TIN | เลขประจำตัวผู้เสียภาษีอากรผู้มีเงินได้ (10 หลัก) | C | 10 | M·M·M | 10 digits; none → ten zeros `0000000000` | 0000000000 | 3 |
| 6 | TITLE_NAME | คำนำหน้าชื่อ | C | 100 | M·M·M | The entity's prefix, e.g. บริษัท | บริษัท | 3 |
| 7 | FNAME | ชื่อผู้มีเงินได้ | C | 100 | M·M·M | The entity's name only | มีคอม | 3 |
| 8 | SNAME | ชื่อสกุลผู้มีเงินได้ | C | 80 | O·O·O | None → nothing at all (no space) | — | 3 |
| 9 | PAID_DATE1 | วันเดือนปีที่จ่าย1 | C | 8 | M·M·M | Date the payer paid, Buddhist-era year (example shows DDMMYYYY) | 01012568 | 3 |
| 10 | TAX_RATE1 | อัตราภาษี1 | N | 4,2 | M·M·M | Tax rate; none → 0.00 | 10.00 | 3 |
| 11 | PAID_AMT1 | จำนวนเงินที่จ่าย1 | N | 15,2 | M·M·M | None → 0.00 | 100.00 | 3 |
| 12 | TAX_AMT1 | จำนวนเงินภาษี1 | N | 15,2 | M·M·M | None → 0.00 | 10.00 | 3 |
| 13 | INC_TYPE_PND1 | ประเภทเงินได้1 | C | 100 | M·M·M | Free text saying what was paid, e.g. ค่าเช่าอาคาร, ค่าบริการ | ค่าเช่าอาคาร | 3 |
| 14 | PAY_CON1 | เงื่อนไขการหักภาษี1 | C | 1 | M·M·M | 1 = หัก ณ ที่จ่าย, 2 = ออกให้ตลอดไป, 3 = ออกให้ครั้งเดียว | 1 | 3 |
| 15 | PAID_DATE2 | วันเดือนปีที่จ่าย รายการที่ 2 | C | 8 | M·M·M | Buddhist-era date; none → `00000000` | 01012557 | 3 |
| 16 | TAX_RATE2 | อัตราภาษีรายการที่ 2 | N | 4,2 | O·O·O | None → 0.00 | 10.00 | 3 |
| 17 | PAID_AMT2 | จำนวนเงินที่จ่าย รายการที่ 2 | N | 15,2 | O·O·O | None → 0.00 (the cell ends with a dangling "หรือ") | 0.00 | 3 |
| 18 | TAX_AMT2 | จำนวนเงินภาษี รายการที่ 2 | N | 15,2 | O·O·O | None → 0.00 | 0.00 | 3 |
| 19 | INC_TYPE_PND2 | ประเภทเงินได้รายการที่ 2 | C | 100 | O·O·O | None → nothing | ค่าเช่าอาคาร | 3 |
| 20 | PAY_CON2 | เงื่อนไขการหักภาษี รายการที่ 2 | C | 1 | O·O·O | 1 / 2 / 3 as field 14 | 1 | 3–4 |
| 21 | PAID_DATE3 | วันเดือนปีที่จ่าย รายการที่ 3 | C | 8 | M·M·M | Buddhist-era date; none → `00000000` | 01012557 | 4 |
| 22 | TAX_RATE3 | อัตราภาษีรายการที่ 3 | N | 4,2 | O·O·O | None → 0.00 | 10.00 | 4 |
| 23 | PAID_AMT3 | จำนวนเงินที่จ่าย รายการที่ 3 | N | 15,2 | O·O·O | None → 0.00 | — | 4 |
| 24 | TAX_AMT3 | จำนวนเงินภาษี รายการที่ 3 | N | 15,2 | O·O·O | None → 0.00 | — | 4 |
| 25 | INC_TYPE_PND3 | ประเภทเงินได้รายการที่ 3 | C | 100 | O·O·O | None → nothing | — | 4 |
| 26 | PAY_CON3 | เงื่อนไขการหักภาษี รายการที่ 3 | C | 1 | O·O·O | 1 / 2 / 3 as field 14 | — | 4 |
| 27 | BUILD_NAME | ชื่ออาคาร | C | 40 | O·O·O | Building; none → nothing | — | 4 |
| 28 | ROOM_NO | ห้องเลขที่ | C | 20 | O·O·O | None → nothing | เลขที่ 1 | 4 |
| 29 | FLOOR_NO | ชั้นที่ | C | 20 | O·O·O | None → nothing | 1 | 4 |
| 30 | VILLAGE_NAME | หมู่บ้าน | C | 100 | O·O·O | None → nothing | — | 4 |
| 31 | ADD_NO | เลขที่ | C | 20 | O·O·O | None → nothing | 12 | 4 |
| 32 | MOO_NO | หมู่ที่ | C | 20 | O·O·O | None → nothing | 3 | 4 |
| 33 | SOI | ซอย/แยก | C | 100 | O·O·O | Soi, one space, then the word แยก… if there is one (e.g. แยก 4-47) | สวนพลู | 4 |
| 34 | STREET_NAME | ถนน | C | 100 | O·O·O | None → nothing | พหลโยธิน | 4 |
| 35 | TAMBON | ตำบล/แขวง | C | 50 | O·O·O | — | พญาไท | 4 |
| 36 | AMPHUR | อำเภอ/เขต | C | 50 | O·O·O | — | ราชเทวี | 4 |
| 37 | PROVINCE | จังหวัด | C | 50 | O·O·O | — | กรุงเทพมหานคร | 4 |
| 38 | POSTAL_CODE | รหัสไปรษณีย์ | C | 5 | O·O·O | — | 10120 | 4 |

### 3.4 How the asked-about items are written (ภ.ง.ด.53)

| Item | Where | Ref |
|---|---|---|
| Payer block | Header fields 7–9 (tax ID, branch, department/"สำนักงานใหญ่"); sender is fields 2–5. The payer's name and address are not in the file | A p.1 |
| Month / year | Header 14 `TAX_MONTH` (01–12) and 15 `TAX_YEAR` (B.E.); both repeated in the file name | A p.2, p.5 req. 3 |
| Normal / additional filing | Header 17 `FORM_TYPE`: `00` normal, `01`–`99` = additional filing number 1–99; repeated in the file name. The file name's last part (ครั้งที่ส่ง 00–99) is a separate counter | A p.2, p.5 req. 3 |
| Branch | **6 digits**, head office `000000`, branch 1 `000001`: header 4 (sender), header 8 (payer), detail 3 (payer's branch on every row), file name; header 16 says whether it is a VAT (V) or SBT (S) branch | A pp.1–3, p.5 |
| Payee rows | One `D` row = one sequence number of one payee; payee = detail fields 4–8 plus address 27–38 | A pp.3–4 |
| Payments per payee row | Up to 3 (fields 9–14, 15–20, 21–26); more → next sequence number | A p.3 field 2, p.5 req. 16 |
| Income type | Free text, up to 100 characters, per payment (fields 13, 19, 25); no code list | A pp.3–4 |
| Rate, amount, tax | Per payment: rate N(4,2), amount paid N(15,2), tax N(15,2) | A pp.3–4 |
| Withholding condition | Per payment (fields 14, 20, 26): 1 = หัก ณ ที่จ่าย, 2 = ออกให้ตลอดไป, 3 = ออกให้ครั้งเดียว | A pp.3–4 |
| Totals / controls | Only in the header: fields 18–23 | A p.2 |

## 4. ภ.ง.ด.3 (and ภ.ง.ด.3ก) — Format กลาง Version 2.0 (document B)

### 4.1 File-level rules (B p.6, "ข้อกำหนด" 1–17)

Requirements 1–16 read the same as for ภ.ง.ด.53 (section 3.1): `.txt`; the same file-name rule; UTF-8; `|` with
no leading or trailing pipe; CR/LF; header = first row, one row; detail rows after it; N(15,2) = 18 characters;
round half up at the third decimal; the same forbidden characters; empty text = two pipes side by side, money =
`0.00`; lengths are maxima without padding (example name "สมศักดิ์"); 3 income items per sequence number, more
continue on the next one. One extra requirement:

| Topic | Rule | Ref |
|---|---|---|
| ภ.ง.ด.3ก | The payee's address and postal code must be given in the specified form | B p.6 req. 17 |

The legend (M, O, C, N, the two channels) is on B p.5.

### 4.2 Header record (B pp.1–3)

| # | Field name | Thai name | Type | Len | M/O | Allowed values / rule | Example printed | p. |
|---|---|---|---|---|---|---|---|---|
| 1 | HEADER | Header | C | 1 | M·M·M | Must be `H`, capital | H | 1 |
| 2 | SENDER_ID | รหัสผู้นำส่ง | C | 4 | M·M·M | Bank code or a code given by the department; media filing → `0000` | 0000 | 1 |
| 3 | SENDER_NID | เลขประจำตัวผู้เสียภาษีอากรผู้นำส่ง | C | 13 | M·M·M | Sender's tax ID | 1234567890123 | 1 |
| 4 | SENDER_BRANCH | สาขาที่ผู้นำส่ง | C | 6 | M/O·M·O | Branch per VAT or SBT (VAT wins); branch 1 = `000001`; none → `000000`; **left-pad with zeros to 6 digits** | 000000 | 1 |
| 5 | SENDER_ROLE | ประเภทการนำส่ง (ในฐานะ) | C | 1 | M·M·M | 1 = ผู้หักภาษี ณ ที่จ่าย, 2 = ผู้กระทำการแทน, 3 = ตัวกลาง, 4 = ยื่นรวม | 1 (1 ถึง 4) | 1 |
| 6 | TAX_TYPE | ประเภทแบบภาษี | C | 8 | M·M·M | `PND3` = ภ.ง.ด.3; `PND3A` = ภ.ง.ด.3ก | PND3 หรือ PND3A | 1 |
| 7 | NID | เลขประจำตัวผู้เสียภาษีอากรผู้มีหน้าที่หักภาษี | C | 13 | M·M·M | Payer's tax ID | 1234567890 (sic) | 1 |
| 8 | BRANCH_NO | สาขาที่ผู้มีหน้าที่หักภาษี | C | 6 | M/O·M·O | Same rule as field 4, including the zero padding | 000000 | 1 |
| 9 | DEPT_NAME | ชื่อ แผนก/ส่วน/ฝ่าย หรือสำนักงานใหญ่ | C | 80 | M/O·M·O | Department/section that submits, or "สำนักงานใหญ่" | สำนักงานใหญ่/แผนกบัญชี | 1 |
| 10 | SECTION3 | มาตรา 3 เตรส | C | 1 | M·M·M | 0 = not remitting under this section, 1 = remitting | 1 | 1 |
| 11 | SECTION48 | มาตรา 48 ทวิ | C | 1 | M·M·M | 0 / 1 as above | 0 | 2 |
| 12 | SECTION50 | มาตรา 50 (3) (4) (5) | C | 1 | M·M·M | 0 / 1 as above | 1 | 2 |
| 13 | LTO | สถานะผู้ประกอบการรายใหญ่ (LTO) | C | 1 | M/O·O·M | 0 = ไม่เป็น, 1 = เป็น | 1 หรือ 0 | 2 |
| 14 | TAX_MONTH | เดือนภาษี | C | 2 | M·M·M | 01–12; **00 = ภ.ง.ด.3ก** | 01, 12 | 2 |
| 15 | TAX_YEAR | ปีภาษี | C | 4 | M·M·M | Buddhist-era year, 4 digits | 2557 | 2 |
| 16 | BRANCH_TYPE | ประเภทสาขา | C | 1 | M/O·O·M | V = VAT branch, S = SBT branch; both → V; neither → leave empty | V | 2 |
| 17 | FORM_TYPE | ประเภทการยื่นแบบ | C | 2 | M·M·M | 00 = ยื่นปกติ; 01 = ยื่นเพิ่มเติมครั้งที่ 1; 02–99 = ครั้งที่ 2–99 | 00 หรือ 01 | 2 |
| 18 | TOT_NUM | รวมจำนวนราย | N | 7 | M·M·M | Total number of entries of the attachment | 100 | 2 |
| 19 | TOT_AMT | รวมจำนวนเงินได้ทั้งสิ้น | N | 15,2 | M·M·M | None → 0.00 | 500.00/ -500.00 | 2 |
| 20 | TOT_TAX | รวมจำนวนเงินภาษีนำส่งทั้งสิ้น | N | 15,2 | M·M·M | Satang are written, e.g. 0.09; none → 0.00 | 0.09 | 2 |
| 21 | SUR_AMT | จำนวนเงินเพิ่ม | N | 15,2 | M·M·M | None → 0.00 | 0.00 | 2 |
| 22 | GTOT_TAX | จำนวนเงินรวมยอดภาษีนำส่งทั้งสิ้นและเงินเพิ่ม | N | 15,2 | M·M·M | None → 0.00 | 2000.00 | 2 |
| 23 | TRANS_AMT | จำนวนเงินโอนผ่านธนาคาร | N | 15,2 | M·M·M | None → 0.00 | 0.00 | 2 |
| 24 | USER_ID | รหัสลงทะเบียน | C | 20 | M·M·M | Media filing = registration reference number; internet filing = login code | 9999999990000 / 25570100600000000020 | 3 |
| 25 | FORM_FLAG | ช่องทางการยื่นแบบ | C | 1 | M·M·M | 1 = ยื่นสื่อฝากไฟล์; 2 = ยื่นแบบอินเตอร์เน็ต | 1 | 3 |

### 4.3 Detail record (B pp.3–5)

| # | Field name | Thai name | Type | Len | M/O | Allowed values / rule | Example printed | p. |
|---|---|---|---|---|---|---|---|---|
| 1 | DETAIL | Detail | C | 1 | M·M·M | Must be `D`, capital | D | 3 |
| 2 | SEQ_NO | ลำดับที่ | N | 10 | M·M·M | Sequence number in the attachment; no more than 3 payment items per sequence | 1 | 3 |
| 3 | BRANCH_NO | สาขาผู้หักภาษี | C | 6 | M·M·M | Branch of the payer | 000000 | 3 |
| 4 | PIN | เลขประจำตัวประชาชนผู้มีเงินได้ | C | 13 | M·M·M | Payee's citizen ID | 0123458678989 | 3 |
| 5 | TIN | เลขประจำตัวผู้เสียภาษีอากรผู้มีเงินได้ (10 หลัก) | C | 10 | M·M·M | 10 digits; none → `0000000000` | 0000000000 | 3 |
| 6 | TITLE_NAME | คำนำหน้าชื่อ | C | 100 | M·M·M | Name prefix; none → a dash `-` | นาย | 3 |
| 7 | FNAME | ชื่อผู้มีเงินได้ | C | 100 | M·M·M | First name only, or the name of a คณะบุคคล | สมชาย | 3 |
| 8 | SNAME | ชื่อสกุลผู้มีเงินได้ | C | 80 | O·O·O | With a middle name: middle name, one space, surname; for a คณะบุคคล put a dot `.` | จันกระโทก | 3 |
| 9 | PAID_DATE1 | วันเดือนปีที่จ่ายเงินได้ 1 | C | 8 | M·M·M | ววดดปปปป (DDMMYYYY), Buddhist era; for ภ.ง.ด.3ก the last day of the tax year | 01012557 | 3 |
| 10 | TAX_RATE1 | อัตราภาษีรายการที่ 1 | N | 4,2 | M·M·M | Tax rate; none → 0.00 | 10.00 | 3 |
| 11 | PAID_AMT1 | จำนวนเงินที่จ่ายรายการที่ 1 | N | 15,2 | M·M·M | None → 0.00 | 100.00 | 3 |
| 12 | TAX_AMT1 | จำนวนเงินภาษีรายการที่ 1 | N | 15,2 | M·M·M | Satang are written, e.g. 0.09; none → 0.00 | 0.09 | 3 |
| 13 | INC_TYPE_PND1 | ประเภทเงินได้รายการที่ 1 | C | 100 | M·M·M | The type of income must be stated (free text) | ค่าเช่าอาคาร | 3 |
| 14 | PAY_CON1 | เงื่อนไขการหักภาษีรายการที่ 1 | C | 1 | M·M·M | 1 = หัก ณ ที่จ่าย, 2 = ออกให้ตลอดไป, 3 = ออกให้ครั้งเดียว | 1 | 4 |
| 15 | PAID_DATE2 | วันเดือนปีที่จ่าย รายการที่ 2 | C | 8 | M·M·M | DDMMYYYY B.E. (ภ.ง.ด.3ก: year end); none → `00000000` (8 digits) | 01012557 หรือ 00000000 | 4 |
| 16 | TAX_RATE2 | อัตราภาษีรายการที่ 2 | N | 4,2 | O·O·O | None → 0.00 | 0.00 | 4 |
| 17 | PAID_AMT2 | จำนวนเงินที่จ่าย รายการที่ 2 | N | 15,2 | O·O·O | None → 0.00 | 0.00 | 4 |
| 18 | TAX_AMT2 | จำนวนเงินภาษี รายการที่ 2 | N | 15,2 | O·O·O | Satang e.g. 0.09; none → 0.00 | 0.09 | 4 |
| 19 | INC_TYPE_PND2 | ประเภทเงินได้รายการที่ 2 | C | 100 | O·O·O | None → nothing | ค่าเช่าอาคาร | 4 |
| 20 | PAY_CON2 | เงื่อนไขการหักภาษี รายการที่ 2 | C | 1 | O·O·O | 1 / 2 / 3; none → nothing | 1 | 4 |
| 21 | PAID_DATE3 | วันเดือนปีที่จ่าย รายการที่ 3 | C | 8 | M·M·M | B.E. date (ภ.ง.ด.3ก: year end); none → `00000000` (8 digits) | 01012557/ 00000000 | 4 |
| 22 | TAX_RATE3 | อัตราภาษีรายการที่ 3 | N | 4,2 | O·O·O | None → 0.00 | 0.00 | 4 |
| 23 | PAID_AMT3 | จำนวนเงินที่จ่าย รายการที่ 3 | N | 15,2 | O·O·O | None → 0.00 | 0.00 | 4 |
| 24 | TAX_AMT3 | จำนวนเงินภาษี รายการที่ 3 | N | 15,2 | O·O·O | Satang e.g. 0.09; none → 0.00 | 0.09 | 4 |
| 25 | INC_TYPE_PND3 | ประเภทเงินได้รายการที่ 3 | C | 100 | O·O·O | None → nothing | ค่าเช่าอาคาร | 4 |
| 26 | PAY_CON3 | เงื่อนไขการหักภาษี รายการที่ 3 | C | 1 | O·O·O | 1 / 2 / 3; none → nothing | 1 | 4 |
| 27 | BUILD_NAME | ชื่ออาคาร | C | 40 | O·O·O | None → nothing | — | 4 |
| 28 | ROOM_NO | ห้องเลขที่ | C | 20 | O·O·O | None → nothing | เลขที่ 1 | 5 |
| 29 | FLOOR_NO | ชั้นที่ | C | 20 | O·O·O | None → nothing | 1 | 5 |
| 30 | VILLAGE_NAME | หมู่บ้าน | C | 100 | O·O·O | None → nothing | — | 5 |
| 31 | ADD_NO | เลขที่ | C | 20 | O·O·O | None → nothing | 12 | 5 |
| 32 | MOO_NO | หมู่ที่ | C | 20 | O·O·O | None → nothing | 3 | 5 |
| 33 | SOI | ซอย/แยก | C | 100 | O·O·O | Soi, one space, then the word แยก… if there is one | 4 แยก 4-47 | 5 |
| 34 | STREET_NAME | ถนน | C | 100 | O·O·O | None → nothing | พหลโยธิน | 5 |
| 35 | TAMBON | ตำบล/แขวง | C | 50 | O·O·O | None → nothing | พญาไท | 5 |
| 36 | AMPHUR | อำเภอ/เขต | C | 50 | **M·M·M** | District | ราชเทวี | 5 |
| 37 | PROVINCE | จังหวัด | C | 50 | **M·M·M** | Province | กรุงเทพมหานคร | 5 |
| 38 | POSTAL_CODE | รหัสไปรษณีย์ | C | 5 | **M·M·M** | All 5 digits | 10120 | 5 |

### 4.4 How the asked-about items are written (ภ.ง.ด.3)

Same places as for ภ.ง.ด.53 (section 3.4) with these form-specific points:

| Item | Where | Ref |
|---|---|---|
| Form | Header 6 = `PND3` (monthly) or `PND3A` (annual ภ.ง.ด.3ก) | B p.1 |
| Month | Header 14 = 01–12, or `00` for ภ.ง.ด.3ก | B p.2 |
| Normal / additional filing | Header 17 `FORM_TYPE` `00` / `01`–`99`; also in the file name | B p.2, p.6 req. 3 |
| Branch | 6 digits, left-padded with zeros: header 4 and 8, detail 3 (payer's branch), file name | B pp.1, 3, 6 |
| Law sections | Header 10–12: มาตรา 3 เตรส, มาตรา 48 ทวิ, มาตรา 50 (3) (4) (5) | B pp.1–2 |
| Payee | Detail 4 = citizen ID (`PIN`), 6–8 = prefix / first name / surname; district, province and postal code are mandatory | B pp.3, 5 |
| Payments, income type, rate, amounts, tax, condition | As ภ.ง.ด.53: 3 payment groups per row; condition codes 1 / 2 / 3 | B pp.3–4, p.6 req. 16 |

## 5. Companion: the older "Format 1.0" layout (documents C and D)

Still published on the format page as "ตารางรูปแบบข้อมูล … 1.0" and reproduced as appendices ค and ง of the SWC-UI 1.5.4
manual (F pp. 72–74 and 77–79). The SWC-UI manual treats it as the layout of payroll, GFMIS and old CD-media
data that its converter turns into Format 2.0 (F pp. 4, 56–62).

File-level rules (C p.3 and D p.3, "หมายเหตุ" 1–5): save as "Text Documents (*.txt)"; fields separated by `|`;
N (16,2) = total length 19 counting the decimal point, none → `0.00`; an empty field = two pipes side by side.
Encoding, line ending and file name are not stated. There is no header record: every line repeats the payer block
and holds **one** payment.

| # (53) | # (3) | Thai name | Field | Type, len | Rule / values | Ref |
|---|---|---|---|---|---|---|
| 1 | 1 | เลขประจำตัวประชาชนผู้มีหน้าที่หักภาษี ณ ที่จ่าย | pin | C 13 | 13 digits if present, else empty | C p.1, D p.1 |
| 2 | 2 | เลขประจำตัวผู้เสียภาษีอากร (13 หลัก) หรือเลขทะเบียนนิติบุคคลของผู้มีหน้าที่หักภาษี ณ ที่จ่าย | nid | C 13 | 13 digits if present, else empty | p.1 |
| 3 | 3 | เลขประจำตัวผู้เสียภาษีอากรผู้มีหน้าที่หักภาษี ณ ที่จ่าย | tin | C 10 | None → ten zeros | p.1 |
| 4 | 4 | สาขาที่ | branchid | **C 5** | None → five zeros (example 00001) | p.1 |
| 5 | 5 | ลักษณะการยื่น | indcsubmit | C 1 | 1 = ยื่นปกติ, 2 = ยื่นเพิ่มเติม | p.1 |
| 6 | 6 | ยื่นครั้งที่ | submitno | N 3 | Normal filing = 0 | p.1 |
| 7 | 7 | นำส่งภาษีตามมาตรา 3 เตรส | sendtype1 | C 1 | 0 / 1 | p.1 |
| 8 | 8 | 53: นำส่งภาษีตามมาตรา 65 จัตวา · 3: นำส่งภาษีตามมาตรา 48 ทวิ | sendtype2 | C 1 | 0 / 1 (D's description text still names 65 จัตวา) | p.1 |
| 9 | 9 | 53: นำส่งภาษีตามมาตรา 69 ทวิ · 3: นำส่งภาษีตามมาตรา 50 (3) (4) (5) | sendtype3 | C 1 | 0 / 1 (D's description text still names 69 ทวิ) | p.1 |
| 10 | 10 | ปีที่จ่ายเงินได้พึงประเมิน | totincyear | C 4 | B.E. or C.E., 4 digits | p.1 |
| 11 | 11 | เดือนที่จ่ายเงินได้พึงประเมิน | totincmonth | C 2 | 01–12 | p.2 |
| 12 | 12 | 53: เลขประจำตัวผู้เสียภาษีอากร (13 หลัก) หรือเลขทะเบียนนิติบุคคลของผู้มีเงินได้ · 3: … หรือเลขประจำตัวประชาชนผู้มีเงินได้ | Rcv_nid / Rev_pin | C 13 | 13 digits if present, else empty | p.2 |
| 13 | 13 | เลขประจำตัวผู้เสียภาษีอากรผู้มีเงินได้ | rcv_tin | C 10 | None → ten zeros | p.2 |
| 14 | 14 | สาขาที่ (in the payee block) | branchid | 53: C 5 · 3: printed "4" with example 00001 and a note saying 5 digits | None → five zeros | p.2 |
| 15 | 15 | คำนำหน้าชื่อผู้มีเงินได้ | v_description | C 100 | None → `-` | p.2 |
| 16 | 16 | ชื่อผู้มีเงินได้ | cName (53) / fName (3) | C 160 | Required | p.2 |
| — | 17 | นามสกุลผู้มีเงินได้ | lName | C 160 | ภ.ง.ด.3 only | D p.2 |
| 17–29 | 18–30 | ชื่ออาคาร, ชื่อหมู่บ้าน, ห้องเลขที่, ชั้นที่, เลขที่, หมู่ที่, ตรอก/ซอย, ถนน, ตำบล/แขวง, อำเภอ/เขต, จังหวัด, รหัสไปรษณีย์, โทรศัพท์ | buildname, mooName, roomNo, floorNo, addNum, mooNo, trokSoi, street, tumbolName, amphurName, provinceName, postcode, telnum | C 40, 100, 10, 10, 20, 3, 100, 100, 50, 50, 50, 5, 30 | All optional (example เลขที่ "45/44") | pp.2–3 |
| 30 | 31 | วันเดือนปีที่จ่าย | paydate | C 8 | "8 digits" as DDMMYYYY, or DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD, YYYY/MM/DD, YYYYMMDD | p.3 |
| 31 | 32 | ประเภทเงินได้พึงประเมิน | inctype | C 200 | Free text (example ค่าบริการ) | p.3 |
| 32 | 33 | อัตราภาษีร้อยละ | taxrate | N 5,2 | None → 0 | p.3 |
| 33 | 34 | จำนวนเงินที่จ่ายในครั้งนี้ | payamt | N 16,2 | None → 0.00 | p.3 |
| 34 | 35 | จำนวนเงินภาษีที่หักและนำส่งในครั้งนี้ | taxamt | N 16,2 | None → 0.00 | p.3 |
| 35 | 36 | เงื่อนไข | proviso | C 1 | **53: 1 = หัก ณ ที่จ่าย, 2 = ออกภาษีให้** · **3: 1 = หัก ณ ที่จ่าย, 2 = ออกให้ตลอดไป, 3 = ออกให้ครั้งเดียว** | C p.3, D p.3 |
| 36 | 37 | หมายเหตุ | notes | C 80 | Optional | p.3 |

Total: 36 fields for ภ.ง.ด.53, 37 for ภ.ง.ด.3.

## 6. Differences between the two forms' layouts

### 6.1 Format 2.0 (A versus B)

| Point | ภ.ง.ด.53 (A) | ภ.ง.ด.3 / 3ก (B) |
|---|---|---|
| `TAX_TYPE` (header 6) | `PND53` | `PND3` or `PND3A` |
| Header 11 | `SECTION65` มาตรา 65 จัตวา | `SECTION48` มาตรา 48 ทวิ |
| Header 12 | `SECTION69` มาตรา 69 ทวิ | `SECTION50` มาตรา 50 (3) (4) (5) |
| `TAX_MONTH` (header 14) | 01–12 | 01–12, plus `00` for ภ.ง.ด.3ก |
| Branch fields (header 4, 8) | 6 digits; no padding sentence | 6 digits; "pad with leading zeros to 6" stated |
| `BRANCH_TYPE` empty when | "media filing and there is no value" | "neither VAT nor SBT" |
| `TOT_NUM` (header 18) | "if none, 0" stated | not stated |
| Amount examples | positive only | `TOT_AMT` example shows a negative (`-500.00`); "satang are written (0.09)" notes on tax fields |
| `FORM_FLAG` value 2 | cell cut off ("ยื่นแบบผ่าน…") | "ยื่นแบบอินเตอร์เน็ต" |
| Detail 4 | `NID` — payee's 13-digit tax ID | `PIN` — payee's citizen ID |
| Detail 6 `TITLE_NAME` | entity prefix such as บริษัท | personal prefix; none → `-` |
| Detail 7 `FNAME` | entity name only | first name, or the name of a คณะบุคคล |
| Detail 8 `SNAME` | optional; leave empty | optional; middle name + space + surname; `.` for a คณะบุคคล |
| Payment dates | B.E. date; no ภ.ง.ด.3ก rule | DDMMYYYY spelled out; ภ.ง.ด.3ก uses the tax-year end date |
| Detail 36–38 (district, province, postal code) | optional (O·O·O) | mandatory (M·M·M) |
| Extra requirement | — | req. 17: ภ.ง.ด.3ก must carry the payee's address and postal code |
| Everything else | identical: 25 header fields, 38 detail fields, same order, types and lengths, same file-level rules | |

### 6.2 Format 1.0 (C versus D)

ภ.ง.ด.3 has one more field (surname, so 37 against 36); the payee ID is a tax ID or citizen ID; the law-section
fields are 48 ทวิ and 50 (3)(4)(5) instead of 65 จัตวา and 69 ทวิ; the condition field has three values in
ภ.ง.ด.3 but only two in ภ.ง.ด.53.

### 6.3 Format 2.0 versus Format 1.0 (both forms)

| Point | Format 2.0 | Format 1.0 |
|---|---|---|
| Records | 1 header + detail rows | flat; payer block on every line |
| Payments per line | up to 3 | 1 |
| Branch width | 6 digits | 5 digits |
| Payee's branch | **no field** (detail 3 is the payer's branch) | field 14 "สาขาที่" sits in the payee block |
| Additional filing | one field `FORM_TYPE` 00–99 | two fields: ลักษณะการยื่น 1/2 and ยื่นครั้งที่ |
| Totals | in the header | none |
| Encoding / line ending / file name | stated | not stated |
| Date | DDMMYYYY B.E. | six accepted patterns; year B.E. or C.E. for the year field |
| Telephone, remark | absent | present |
| Amount width | N(15,2) | N(16,2) |

## 7. Not stated, or stated ambiguously (open questions)

Nothing below is filled with a guess. Where the official sample files (G) or a companion show something, it is
marked "observed", which is weaker than a stated rule; the samples are dated 2015–2016, older than the 16/06/2568 text.

| # | Open question | What the documents do say |
|---|---|---|
| Q1 | Does RD Prep's "โอนย้าย", or the e-Filing upload page, accept a Format 2.0 file (H row, three payment groups per row) as it is? | Not stated anywhere read. Format 2.0 is documented as SWC's input (F pp. 9, 35–36). RD Prep takes `.txt`/`.csv` with user-chosen separator and manual column mapping (E pp. 37–39; e-Filing FAQ). The RD Prep manual on the official domain has no ภ.ง.ด.3/53 column list |
| Q2 | Which target fields does RD Prep offer for ภ.ง.ด.3 and ภ.ง.ด.53 (order, required ones, date patterns)? | Not in E. The newer RD Prep and e-Filing WHT manuals are linked from the official site to Dropbox and were not opened |
| Q3 | Is a UTF-8 byte-order mark required, allowed or forbidden? | A/B req. 6 says only "UTF8". Observed: all three sample files start with a BOM |
| Q4 | Must the last record end with CR/LF? | Req. 7 says new lines are CR/LF. Observed: the samples have no line ending after the last record |
| Q5 | Is `/` really forbidden in data (house numbers such as 12/34)? What about `-`, `.`, brackets? | Req. 10 lists `/` as forbidden, yet the documents' own example for `DEPT_NAME` contains `/`, B tells the filer to use `-` and `.`, and the Format 1.0 example house number is "45/44" |
| Q6 | What are the "reserved words" (คำสงวน Reserve Word)? | Not listed |
| Q7 | Width of a rate N(4,2): 4 integer digits + point + 2 decimals (7 characters), or 4 in total? | Only (15,2) = 18 characters is explained (req. 8). Examples: 10.00, 0.00 |
| Q8 | Must amounts and rates always show two decimals? Are negative amounts allowed? | Examples always show two decimals; B's `TOT_AMT` example includes `-500.00` with no explanation |
| Q9 | Requirement 5 refers to fields "marked X" per channel | The tables use M and O, not X |
| Q10 | Does `TOT_NUM` count detail rows, distinct payees or payment items? | "รวมจำนวนรายของใบแนบ". Observed: in the ภ.ง.ด.53 sample it equals the number of D rows (5) although two payees appear on two rows each |
| Q11 | Are `TOT_AMT` / `TOT_TAX` the sums over all three payment groups, and is `GTOT_TAX` = `TOT_TAX` + `SUR_AMT`? | Implied by the names only. Observed: true in both samples |
| Q12 | What is `TRANS_AMT` (จำนวนเงินโอนผ่านธนาคาร) and when is it not zero? | Only "none → 0.00". Observed: 0.00 in the samples |
| Q13 | What does the file name's last part "ครั้งที่ส่ง (00–99)" count, and when must it change? | Not explained. Observed: samples for a normal filing (`FORM_TYPE` 00) use `_00_01.txt` and `_00_00.txt`; SWC-UI shows it as a separate box "ครั้งที่ส่ง" beside "ประเภทการยื่นแบบ" (F p. 35) |
| Q14 | Rules for `SEQ_NO`: start at 1? consecutive? per file or per branch? | Only "sequence number in the attachment" |
| Q15 | For an unused payment group, may the optional numeric fields be left empty, or must they be `0.00`? | Field descriptions and req. 8, 13 say `0.00`; req. 12 says optional fields may have no data. The date fields 15 and 21 are mandatory and take `00000000` |
| Q16 | If the last field of a record is empty, does the line end with a pipe? | Req. 7 says no pipe closes a record; req. 14 says an empty field is two pipes side by side. The case "last field empty" is not addressed (it can occur for ภ.ง.ด.53, where postal code is optional) |
| Q17 | ภ.ง.ด.53 has no field for the **payee's** branch, although the paper attachment has one | Detail 3 is described as the payer's branch (A p.3, B p.3) |
| Q18 | Where does a company's legal suffix ("จำกัด") go, and what if a ภ.ง.ด.53 payee has no 13-digit number? | `FNAME` = "the entity's name only"; detail 4 is mandatory. Observed: the sample puts "… จำกัด" in `FNAME`, and uses thirteen zeros with a 10-digit `TIN` on two rows |
| Q19 | Are district, province and postal code mandatory for monthly ภ.ง.ด.3 too, or only for ภ.ง.ด.3ก? | The table marks them M for all (B p.5); req. 17 speaks of ภ.ง.ด.3ก only |
| Q20 | What changed in the 16/06/2568 revision? | Not stated in the document; an earlier revision (10/02/2568) exists on the site and was not compared |
| Q21 | How are amount and tax to be computed under conditions 2 and 3 (tax borne by the payer)? | Only the code values are given |
| Q22 | Must each payment date fall inside the tax month? Are date/amount cross-checks applied? | Not stated. Observed: the samples' tax amounts do not equal rate × amount, so nothing can be inferred |
| Q23 | What does "internet" filing with `FORM_FLAG` = 2 and a bank code in `SENDER_ID` mean in practice, and who may use it? | Only the code values and the per-channel M/O columns |
| Q24 | Maximum number of records or file size | Not in A/B. F p. 4 mentions 1–2 million records per SWC submission |
| Q25 | Format 1.0 only: the payee-block branch length (5, 4 or 6?), and the sample line | C says C 5; D prints 4 with a 5-digit example; F's Excel listing says (C,6) and gives the payee tax number as (C,13) instead of 10 (F pp. 75, 80). F's "Format 1.0 text example" for ภ.ง.ด.3 and 53 is a 20-field line that matches the ภ.ง.ด.1 layout, not the 36/37-field tables (F pp. 60–61) |

## 8. Worked examples (made-up values)

All numbers and names are invented; tax IDs are not checksum-valid. Each record is one line; lines are joined by CR/LF.

### 8.1 ภ.ง.ด.53, Format 2.0 — normal filing, head office, September 2569

File name by A p.5 req. 3: `PND53_0105558000019_000000_2569_09_00_00.txt`

```
H|0000|0105558000019|000000|1|PND53|0105558000019|000000|สำนักงานใหญ่|1|0|0|0|09|2569|V|00|2|35000.00|1350.00|0.00|1350.00|0.00|25690100600000000123|1
D|1|000000|0105500000027|0000000000|บริษัท|ตัวอย่างการค้า จำกัด||15092569|3.00|10000.00|300.00|ค่าบริการ|1|20092569|5.00|20000.00|1000.00|ค่าเช่าอาคาร|1|00000000|0.00|0.00|0.00|||||||99|||พหลโยธิน|สามเสนใน|พญาไท|กรุงเทพมหานคร|10400
D|2|000000|0103500000035|0000000000|ห้างหุ้นส่วนจำกัด|ตัวอย่างขนส่ง||25092569|1.00|5000.00|50.00|ค่าขนส่ง|1|00000000|0.00|0.00|0.00|||00000000|0.00|0.00|0.00||||||||||||เมืองนนทบุรี|นนทบุรี|11000
```

- Header: 25 fields. Sender = payer (role 1), media channel (`SENDER_ID` 0000, `FORM_FLAG` 1), remitting under มาตรา 3 เตรส only, not LTO, VAT branch, `FORM_TYPE` 00.
- Row 1: two payments (service 3 %, rent 5 %), third group unused (`00000000`, `0.00` ×3, two empty text fields). Row 2: one payment.
- Header totals here follow the pattern observed in the official samples (2 rows; amounts and tax summed over all groups) — see Q10–Q11. Unused numeric fields are written `0.00` — see Q15. "จำกัด" is placed in `FNAME` as in the official sample — see Q18.
- Additional filing number 1 for the same month: header field 17 becomes `01` and the name becomes `PND53_0105558000019_000000_2569_09_01_00.txt`.
- Branch 1 instead of head office: `000001` in header field 8 (and field 4 if the branch is also the sender), in detail field 3 and in the file name.

### 8.2 ภ.ง.ด.3, Format 2.0 — normal filing, head office, September 2569

File name: `PND3_0105558000019_000000_2569_09_00_00.txt`

```
H|0000|0105558000019|000000|1|PND3|0105558000019|000000|สำนักงานใหญ่|1|0|0|0|09|2569|V|00|2|24000.00|960.00|0.00|960.00|0.00|25690100600000000123|1
D|1|000000|3100500000015|0000000000|นาย|สมชาย|ใจดี|10092569|3.00|8000.00|240.00|ค่าบริการ|1|00000000|0.00|0.00|0.00|||00000000|0.00|0.00|0.00|||||||12|||||เมืองเชียงใหม่|เชียงใหม่|50000
D|2|000000|3100500000023|0000000000|นางสาว|สมหญิง|รักงาน|05092569|5.00|12000.00|600.00|ค่าเช่าอาคาร|1|19092569|3.00|4000.00|120.00|ค่านายหน้า|1|00000000|0.00|0.00|0.00||||||||||||บางรัก|กรุงเทพมหานคร|10500
```

- Header fields 10–12 are มาตรา 3 เตรส / 48 ทวิ / 50 (3)(4)(5). District, province and postal code are filled on every row because they are mandatory in this form.
- For ภ.ง.ด.3ก the header would carry `PND3A`, month `00`, and each payment date would be the last day of the tax year.

### 8.3 The same first payment in Format 1.0 (for comparison)

ภ.ง.ด.53 (36 fields; the first field, the payer's citizen ID, is empty for a company, so the line starts with a pipe; the last field, the remark, is empty):

```
|0105558000019|0000000000|00000|1|0|1|0|0|2569|09|0105500000027|0000000000|00000|บริษัท|ตัวอย่างการค้า จำกัด|||||99|||พหลโยธิน|สามเสนใน|พญาไท|กรุงเทพมหานคร|10400||15092569|ค่าบริการ|3.00|10000.00|300.00|1|
```

ภ.ง.ด.3 (37 fields):

```
|0105558000019|0000000000|00000|1|0|1|0|0|2569|09|3100500000015|0000000000|00000|นาย|สมชาย|ใจดี|||||12|||||เมืองเชียงใหม่|เชียงใหม่|50000||10092569|ค่าบริการ|3.00|8000.00|240.00|1|
```

## 9. What unofficial sites say (unverified — not used above)

Read only to locate official links and to see how accounting-software vendors describe RD Prep. None of this is confirmed by an official document.

| Source | Claim |
|---|---|
| FlowAccount blog, https://flowaccount.com/blog/online-tax-filling-pnd3-53/ | Its `.txt` export for ภ.ง.ด.3/53 is brought into RD Prep with "split by the symbol `\|`"; the columns are then dragged onto the payee fields by hand; the date pattern offered is dd-mm-yy or dd/mm/yy; filing type, month and branch are chosen on screen; the result is an RDX file that must not be renamed |
| Leceipt docs, https://www.leceipt.com/docs/etax/ภงด53-rd-prep | `\|` for `.txt` or `,` for `.csv`; the "first line is the column names" switch is turned on; year type "พ.ศ." and pattern dd/mm/yyyy are chosen on screen; head office is entered as branch 0; mapping has a group called "รายละเอียดการจ่ายเงินครั้งที่ 1"; output `.rdx` |

Both describe a vendor-specific text file mapped by hand in RD Prep — consistent with the RD Prep manual's
generic description, and different from Format 2.0 with its header record.
