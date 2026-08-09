# Production Readiness — รอบ 2: ตรวจด้วย Use Case จริง (2026-08-09)

ต่อจาก `production-readiness-audit-2026-08-09.md` (รอบ 1 = ตรวจรายโมดูล)
รอบนี้ **ออกแบบสถานการณ์ผู้ใช้จริง 8 แบบ แล้วเดินทีละขั้นผ่านโค้ด** เพื่อจับบั๊กที่อยู่ตรงรอยต่อระหว่างโมดูล
ซึ่งการตรวจรายโมดูลมองไม่เห็น ทุกสายได้รับรายการบั๊กรอบ 1 ไปด้วยเพื่อไม่ให้รายงานซ้ำ

`✓` = ผู้ตรวจไล่โค้ด/รันพิสูจน์เองแล้ว

## 0. คำตัดสินที่เปลี่ยนไปจากรอบ 1

รอบ 1 สรุปว่า "ฐานสถาปัตยกรรมดี แต่มี blocker ต้องปิด" — **รอบ 2 เปลี่ยนคำตัดสินนั้น**

ชั้นบันทึกเอกสาร สิทธิ์ เวิร์กโฟลว์ LINE/AI ยังดีตามเดิม แต่การเดิน journey จริงเปิดเผยว่า
**ชั้นบัญชี (accounting output layer) ใช้งานไม่ได้เชิงโครงสร้าง** — ไม่ใช่บั๊กประปราย
แต่เป็นชิ้นส่วนที่ออกแบบไว้ครบและ "ไม่เคยถูกต่อเข้าด้วยกัน"

ผลคือ: ลูกค้าจริงบันทึกเอกสารได้ แต่ **ไม่มีอะไรไหลไปถึงบัญชีแยกประเภท งบทดลอง งบกำไรขาดทุน งบดุล และการปิดงวด**
สำหรับผลิตภัณฑ์บัญชี นี่คือสิ่งที่ลูกค้าจ่ายเงินซื้อ

---

## 1. หัวข้อใหญ่ที่สุด: ไม่มีอะไรลงบัญชีแยกประเภทได้เลย

### A1 ✓ [CRITICAL] ไม่มีโค้ดที่ไหนสร้าง PostingRule ได้ แต่ onboarding ทำให้มันเป็นข้อบังคับ

ลูกโซ่ที่ผมไล่ครบเอง:

1. onboarding ประทับ `chartOfAccountsTemplateKey` ให้ทุกบริษัท — `chart-template-bootstrap.service.ts:131`
2. `requiresReviewedPostingRules()` คืน `true` ทันทีที่มีค่าใด ๆ — `posting-engine.logic.ts:65`
3. **ไม่มี writer ของตาราง `PostingRule` ที่ไหนเลย** — grep `apps/api/src`, `prisma/`, `scripts/` เจอแค่ DDL ใน
   `migrations/20260625000001_item10_double_entry_ledger/migration.sql:93`; permission `ledger.posting-rule.manage`
   มีใน registry (`permission-registry.ts:205`) แต่**ไม่มี route ไหนใช้**
4. `journal.use-case.ts:527` โยน `posting_rule_missing` + mark เอกสารเป็น `posting_error`
   → fallback `buildDefaultPostingLines` (บรรทัด 552) **ไม่มีวันถูกเรียกถึง**

dev seed ก็ประทับเหมือนกัน (`seed.ts:2960`) และ spec ล็อกพฤติกรรมนี้ไว้
(`template-company-posting.use-case.spec.ts:128` assert ว่าต้องเป็น true)
→ **ไม่ใช่บั๊กเฉพาะ production — พังทั้ง dev และ prod และถูกเทสยืนยันว่า "ถูกต้อง"**

**Impact:** เจ้าของยืนยันรายจ่ายใบแรก กดปุ่ม "สร้าง JV" แล้วได้
*"ยังไม่ได้กำหนดกฎการลงบัญชีสำหรับเอกสารประเภทนี้ กรุณาตั้งค่ากฎการลงบัญชีก่อน"* — ชี้ไปยังหน้าจอที่ไม่มีอยู่จริง
เอกสารกลายเป็น `posting_error` ค้างถาวร เกิดกับทุก source type: expense, invoice, vendor bill, supplier payment

### A2 ✓ [CRITICAL] ไม่มี UI ลงรายการบัญชีเลย — ปรับปรุงบัญชีไม่ได้ + ปิดงวดค้างถาวร

`ledger.api.ts` มี 16 ฟังก์ชัน ไม่มี `postJournal` / `reverseJournal` / `createJournal`
grep ทั้ง `apps/web/src` = ศูนย์ผลลัพธ์ ทั้งที่ API มีครบ (`ledger.controller.ts:145,152,160`)

ผลสองชั้น:
- นักบัญชี **ลงรายการปรับปรุง/ตั้งค้างจ่าย ไม่ได้เลย** — งานหลักของการปิดงวดสิ้นเดือน
- close check `no_draft_journals` (`period.use-case.ts:101-108`, severity ERROR) บล็อกการปิดงวด
  แต่ **ไม่มีทางเคลียร์ DRAFT journal ได้** → deadlock ถาวร
  (เข้าถึงได้จริงผ่านบั๊ก generate ที่ไม่มี transaction ที่พบรอบ 1)

### A3 ✓ [CRITICAL] งบดุลไม่มีวันบาลานซ์

`report.use-case.ts:149` ส่ง `[period.id]` เดียวเข้า `getAccountBalances` ซึ่ง filter `periodId: { in: periodIds }`
(`prisma-ledger.repository.ts:291`) และ `:158` `if (!acc || !sectionMap.has(acc.accountClass)) continue;`
ทิ้ง REVENUE/COST/EXPENSE โดยไม่มีการโอนกำไรเข้าส่วนของเจ้าของ; GL hardcode `openingBalance: '0.0000'` (`:45`)

**Impact:** งบดุลแสดงเฉพาะความเคลื่อนไหวของเดือนนั้น ไม่มียอดยกมา
→ สินทรัพย์ ≠ หนี้สิน + ทุน เท่ากับกำไรของเดือน **ทุกเดือน ตลอดไป** ไม่มีงบดุลที่ถูกต้องในผลิตภัณฑ์

### A4 ✓ [CRITICAL] ไม่มีปีบัญชี ไม่มีปิดปี ไม่มีกำไรสะสม

grep `fiscalYear|retainedEarnings|กำไรสะสม` ทั้ง schema และ web = ศูนย์
ผังบัญชีมี `3200-00 กำไรสะสม` (`th-sme-chart-of-accounts-v1.ts:105`) แต่ไม่มีโค้ดไหนเขียนลงไป
period key เป็น `YYYY-MM` เท่านั้น

**Impact:** วันที่ 1 ม.ค. ไม่มีอะไรเกิดขึ้น บัญชีรายได้/ค่าใช้จ่ายไม่เคยถูกปิด ส่วนของเจ้าของไม่เคยถูกแสดง

### A5 ✓ [CRITICAL] จ่ายเงินเบิกแล้วไม่มีทางลงบัญชี

`postingStatus: 'pending'` ถูกตั้งตอนสร้าง (`prisma-reimbursement.repository.ts:1655`)
สิ่งเดียวที่ post ได้คือ `journal.use-case.ts:420` (`sourceType === 'reimbursement.payment'`) แต่:
- **ไม่มี worker** — grep `reimbursement` ใน `apps/workers/src` = ว่างเปล่า; auto-post drain filter `'expense.record'` เท่านั้น (`expense-auto-post.use-case.ts:76,145`)
- **ไม่มี web caller** — `generateSourceJournal` ถูกเรียกด้วย expense / pp36 / procurement เท่านั้น

**Impact:** เงินสดออกจากบริษัทโดยไม่มีการเครดิตเงินสดและไม่ล้างหนี้สินพนักงาน
และ close check `reimbursement_postings_complete` (`period.use-case.ts:311`) ทำให้**การเบิกจ่ายครั้งแรกของบริษัททำให้ปิดงวดไม่ได้ตลอดไป**

### A6 [CRITICAL] รายจ่ายที่เกิดจากใบเบิกไม่มีทาง auto-post

`prepareClaimProjections` ไม่เคยตั้ง `taxEvidenceStatus` (grep ทั้งโมดูล reimbursements = ศูนย์)
→ ค่า default คือ `NEEDS_REVIEW` (`schema.prisma:1910`)
→ query ของ auto-post ตัดออก: `AND expense."taxEvidenceStatus"::text NOT IN ('NEEDS_REVIEW','NOT_TAX_EVIDENCE')` (`expense-auto-post.use-case.ts:60`)
→ และขา settlement บังคับว่าต้องมี accrual ก่อน (`repo:1752`)

### A7 [CRITICAL] รายรับไม่เคยเข้าบัญชีแยกประเภท

ไม่มี worker สำหรับ accounting document และไม่มี web caller ที่ส่ง `sourceType: 'accounting.document'`
เอกสารที่ออกแล้วถูกตราเป็น `postingStatus: 'pending'` (`accounting-status.logic.ts:196`) แล้วค้างตลอดไป

---

## 2. เอกสารภาษีไม่ถูกต้องตามกฎหมาย

### B1 ✓ [CRITICAL] สาขาที่สองออกเอกสารไม่ได้เลยตลอดกาล

`branchScopeKey = input.branchId ?? 'GLOBAL'` → sequence แยกต่อสาขา (`prisma-document-sequence.repository.ts:21`)
แต่ **template ทั้ง 22 ตัวไม่มี `{BRANCH}` เลยสักตัว** (`document-sequence.logic.ts:11-31`, เช่น `'TAX-{YYYY}{MM}-{SEQ}'`)
ขณะที่ตารางบังคับ `@@unique([companyId, documentType, documentNumber])` (`schema.prisma:863`, `:1544`)

→ สาขา A ออก `TAX-202608-00001`; สาขา B เริ่มที่ 1 เหมือนกัน ได้สตริงเดียวกัน → P2002
→ transaction rollback → `nextNumber` ของ B ไม่ขยับ → **ชนซ้ำทุกครั้งที่ลอง**

**Impact:** บริษัทหลายสาขา (หรือบริษัทสาขาเดียวที่ผู้ใช้สลับ filter สาขา) ออกใบกำกับภาษี/ใบแจ้งหนี้/ใบเสร็จ
**ไม่ได้อีกเลย** แก้ไม่ได้ถ้าไม่แก้ DB

### B2 ✓ [CRITICAL] ใบกำกับภาษีที่ออกจากระบบไม่มีผู้ซื้อ

หน้าจอสร้างเอกสารเดียวที่มี (`AccountingPages.tsx:263-270`) ส่ง 6 ฟิลด์ — **ไม่มี `counterpartyId`** และไม่มีช่องเลือกลูกค้า
ตอน issue `document.use-case.ts:193` snapshot เฉพาะเมื่อมี `counterpartyId` และต่อให้มี ก็เก็บแค่
`{ id, displayName, taxId, legalName }` — ไม่มีที่อยู่ ไม่มีรหัสสาขาผู้ซื้อ

**Impact:** ใบกำกับภาษีทุกใบที่ออกผ่านผลิตภัณฑ์ไม่มีผู้ซื้อเลย → `MISSING_TAX_ID` review issue ทุกใบ
(`sync-tax-events.use-case.ts:192`) และ **ไม่เป็นใบกำกับภาษีที่ถูกต้องตาม ม.86/4**

### B3 [CRITICAL] ไม่มี PDF/พิมพ์ สำหรับเอกสารบัญชีเลยสักประเภท

มี PDF renderer สำหรับใบทดแทนใบเสร็จ, 50 ทวิ, ใบเบิกเงิน — **ไม่มีอะไรใน `modules/accounting-documents`**
และไม่มีปุ่มพิมพ์/ดาวน์โหลดในหน้าเอกสาร

**Impact:** สิ่งที่ลูกค้าต้องได้รับ (ใบกำกับภาษี ต้นฉบับ/สำเนา) ผลิตไม่ได้ และเพราะ B2 ข้อมูลบังคับไม่ได้ถูกเก็บด้วยซ้ำ
→ ต่อให้เพิ่ม PDF ก็ต้องแก้ data model ก่อน

### B4 [HIGH] ใบลดหนี้ลด VAT ผิดงวด และหายเงียบถ้างวดเดิมยื่นแล้ว

component ของใบลดหนี้ถูก clone จากต้นฉบับโดยไม่ re-resolve (`document.use-case.ts:586-591`)
`recognitionDate` จึงเป็นวันที่ของ **ใบกำกับภาษีต้นฉบับ** และ sync ใช้ค่านั้นหางวด (`sync-tax-events.use-case.ts:96`)
ถ้างวดนั้น FILED แล้ว → บันทึก issue แล้ว `continue` (ทิ้ง)

**Impact:** กฎหมายไทยกำหนดให้ใบลดหนี้ลดภาษีขายในเดือนที่ออก ที่นี่ย้อนไปเดือนเดิม และในกรณีปกติ
(ออกใบลดหนี้หลังยื่น ภ.พ.30 เดือนนั้นแล้ว) การลดหายไปจากทุกงวด → บริษัทจ่ายภาษีขายเกินโดยไม่มีข้อความเตือน

### B5 [HIGH] ใบกำกับภาษีรับชำระเงินไม่ได้เลย
`accounting-money-validation.logic.ts:92` อนุญาตเฉพาะ `INVOICE|BILLING_NOTE|DEBIT_NOTE`
แต่ `createDocument` ตั้ง `outstandingAmount` + `UNPAID` ให้ทุกประเภท และหน้าจอเสนอ `TAX_INVOICE` เป็นตัวเลือก
→ flow มาตรฐานไทย (ออกใบกำกับภาษี แล้วเก็บเงินตามใบนั้น) ทำไม่ได้; ใบกำกับภาษีค้าง UNPAID ตลอดไป

### B6 [HIGH] ใบลดหนี้ไม่เคยลดยอดลูกหนี้ + สถานะ `CREDITED`/`DEBITED` ไม่มีใครเขียน
ต้นฉบับไม่ถูกแตะเลยตอนออกใบลดหนี้ (`prisma-accounting.repository.ts:391-398`) → AR สูงเกินจริงถาวร

---

## 3. ข้อมูลเสียหาย / สูญหาย

### C1 ✓ [CRITICAL] ตัวสแกน PDF กักใบเสร็จจริงเป็นส่วนใหญ่ — ถาวรและเงียบ

`attachment.logic.ts:83` รัน regex `/\/(javascript|js|openaction|launch|richmedia|embeddedfile|xfa)\b/i`
บน **byte stream ทั้งก้อน** รวมข้อมูลภาพที่ถูกบีบอัด (entropy สูงเกือบสุ่ม) และ `.toLowerCase()` เพิ่มโอกาสชนอีกเท่าตัว

ผมรันพิสูจน์เองบน random bytes:

| ขนาด PDF | อัตราถูกกักผิด |
|---|---|
| 1 MB | 20% |
| 3 MB | 43% |
| 5 MB | 63% |
| 10 MB | **90%** |

และล้มเหลวแบบถาวร: `rejectUpload` → `markQuarantined` + audit HIGH + security event HIGH
ไม่มี reaper และยังนับกิน quota ของบริษัท

**Impact:** SME สแกนใบแจ้งหนี้หลายหน้า อัปโหลด แล้วได้ *"ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง"*
ลองใหม่ = ไบต์เดิม = ล้มเหมือนเดิม **ทุกครั้ง** ไม่มีทางไปต่อและไม่มีคำอธิบาย
ขณะเดียวกัน alert ความปลอดภัยระดับ HIGH ถูกจุดจากใบเสร็จของลูกค้าเอง กลบ detection จริง

### C2 ✓ [CRITICAL] ไม่มีขอบเขตปีที่ไหนเลย — ปี พ.ศ. ถูกเก็บเป็น ค.ศ.

`CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/` (`civil-date.ts:21`) และ `isCivilDate` ตรวจแค่ว่า Date parse ได้
ผมรันพิสูจน์: `2569-03-15` → `true`, `9999-12-31` → `true`
grep หาขอบเขตปี (`2100`, `MAX_YEAR`, `getFullYear() >`) ทั้ง repo = ศูนย์

**Impact:** รายจ่ายปี 2569 ลอยขึ้นบนสุดของทุกรายการที่เรียงตามวันที่ ไม่อยู่ในงวดบัญชีใดเลย
ไม่โผล่ใน filter เดือนปกติ เรียกได้ด้วย HTTP call เดียว

### C3 [HIGH] นำเข้า statement ธนาคารไม่ตรวจวันที่เลย ทั้งที่เป็น input ที่เป็น พ.ศ. เสมอ

`banking.logic.ts:103-107` ตรวจแค่ว่าไม่ว่าง; column alias มี `'วันที่ทำรายการ'`, `'วันที่'` (`:522`)
ซึ่งบน statement ไทยพิมพ์เป็น พ.ศ.; ค่าไปถึง `new Date(l.postedDate)` ตรง ๆ
การแปลง พ.ศ.→ค.ศ. **มีอยู่แค่ในข้อความ prompt** ที่ส่งให้โมเดล (`line-ai-internal.controller.ts:440`) ไม่มีอะไรตรวจว่าโมเดลทำตาม

### C4 ✓ [HIGH] กดปุ่มตัดสต็อกซ้ำ = ตัดสองครั้ง

`idempotencyKey: \`${ctx.requestId}:${key}\`` (`create-movement.use-case.ts:148`)
แต่ `ctx.requestId` เป็น UUID ใหม่ทุก request (`request-id.middleware.ts:8`) → key ต่างกันทุกครั้ง
ไม่มี idempotency ที่ repository; guard เดียวคือเช็คไม่ติดลบ → ตัด 5 สองครั้งจาก 10 ผ่านทั้งคู่
→ **คืน 201 ทั้งสองครั้ง สต็อกลดสองเท่า ไม่มี error** (รูปแบบเดียวกันใน `transfer-stock`, `stock-count`)

### C5 [HIGH] ใบเสร็จใบเดียวลงบัญชีสองครั้ง (latent — จะระเบิดทันทีที่แก้ A5/A6)

- `linkedExpenseId` มีครบฝั่ง API แต่ **web ไม่เคยส่ง** (`ReimbursementCreatePage.tsx:65-73`) → ผู้ใช้บอกระบบไม่ได้ว่า "นี่คือใบเสร็จที่ส่ง LINE ไปแล้ว"
- projection สร้าง `ExpenseRecord` ใหม่ **ทุกบรรทัดเสมอ** ไม่ว่าจะ link ไว้หรือไม่ (`materialize-claim-expenses.service.ts:14`)
- double-claim guard ดูแค่ `reimbursementLine` (`repo:1444`) ไม่เคยถามว่าใบเสร็จนี้เป็น expense อยู่แล้วหรือยัง
- projection ลบตัวตนผู้ขายทิ้ง (`vendorNameSnapshot = 'เบิกคืนพนักงาน: ...'`) → สัญญาณ duplicate +30/+25/+20 ใช้ไม่ได้ทั้งหมด
  เหลือแค่ checksum/pHash ของรูป

**Impact:** ผลลัพธ์ขึ้นกับไบต์ของรูป — ตรงกัน → จ่ายเงินแต่ไม่ลงบัญชีเลย และ settlement ค้างถาวร;
ไม่ตรงกัน → **ใบเสร็จเดียวกันเป็นค่าใช้จ่ายสองครั้ง**

---

## 4. งวดภาษี/งวดบัญชีล็อกตาย

### D1 [CRITICAL] แก้ข้อมูลหลังยื่นภาษีถูกทิ้งเงียบใน 4 จาก 6 เส้นทาง sync
เส้น component บันทึก issue `SOURCE_CHANGED_AFTER_TAX_PERIOD_LOCK` (`sync-tax-events.use-case.ts:112`)
แต่อีก 4 เส้น (`:170`, `:212`, `:264`, `:320`) แค่ `skippedLocked++; continue;` → ไปจบที่ log บรรทัดเดียว
**Impact:** หลังยื่น ภ.พ.30 มิ.ย. แล้วแก้เอกสารเดือน มิ.ย. บัญชีเปลี่ยนแต่แบบที่ยื่นไม่เปลี่ยน และไม่มีบันทึกว่าต่างกัน

### D2 [CRITICAL] `AMENDED` ไม่มีใครเขียน — งวดที่ยื่นแล้วแช่แข็งถาวร
เขียน `TaxPeriod.status` มีแค่ 3 จุด: `EXPORTED`, `FILED`, `PAID` — ไม่มี `AMENDED`/`CLOSED`
แต่ guard อ่าน `['FILED','PAID','CLOSED']` แล้วบอกให้ *"use an amendment workflow"* ที่ไม่เคยถูกสร้าง
**Impact:** ยื่น ภ.พ.30 แล้วเจอรายจ่ายซ้ำ → void ไม่ได้, เปิดงวดใหม่ไม่ได้, ไม่มีเส้นทางแก้ในผลิตภัณฑ์

### D3 [HIGH] เอกสารย้อนเข้างวดที่ปิดแล้วได้ (guard ครอบเฉพาะเอกสารภาษี)
`prisma-accounting.repository.ts:318` เช็คงวดเฉพาะ `TAX_INVOICE|CREDIT_NOTE|DEBIT_NOTE`
→ **INVOICE / RECEIPT / BILLING_NOTE ออกย้อนเข้างวดปิดได้**; vendor bill approval เช็คแค่งวดภาษี;
create payment / record expense payment / goods receipt / bank adjustment ไม่เช็คเลย
**Impact:** เอกสารสร้างสำเร็จ ตราเป็น `pending` แล้ว generate ปฏิเสธด้วย `period_closed`
ส่วน `countPostingBlockers` นับมันไว้ในงวดที่ปิดไปแล้ว → ไม่มีอะไรทำให้มันโผล่มาอีก **เงินเข้าธนาคารโดยไม่มีรายการบัญชี**

### D4 [HIGH] ไม่มี UI เปิดงวดที่ปิดไปแล้ว — `unclose` เป็น endpoint กำพร้า

---

## 5. ลูกค้าตัวเล็กที่สุด (เจ้าของคนเดียว / 2 คน) ใช้ไม่ได้

### E1 ✓ [HIGH] reimbursement ไม่เคยได้รับข้อยกเว้น "บริษัทเล็ก" ที่ procurement ได้
`REIMBURSEMENT_POLICY_DEFAULTS.allowSelfApproval = false` (`reimbursement.constants.ts:31`)
procurement มี `SELF_APPROVAL_EXEMPT_ROLES = ['OWNER','ADMIN','MANAGER']` (`procurement.logic.ts:298`)
พร้อมคอมเมนต์อ้างมติ 2026-07-18 ว่าบริษัทเล็กต้องไม่ถูกล็อก — **แต่ไม่เคยถูกนำมาใช้กับ reimbursement**
(grep `SELF_APPROVAL_EXEMPT|canSelfApprove` ในโมดูล reimbursements = ศูนย์)
**Impact:** เจ้าของคนเดียวส่งใบเบิกของตัวเอง → อนุมัติไม่ได้ ปฏิเสธก็ไม่ได้ (guard เดียวกัน) ทำได้แค่ยกเลิก

### E2 [HIGH] ระบบเชิญให้กดปุ่มที่มันจะปฏิเสธเสมอ
approval queue ไม่ filter self-approval (`reimbursement-approval.use-case.ts:73`), ปุ่มอนุมัติแสดงเสมอ
(`ReimbursementsPages.tsx:810`) และ template `reimbursement_pending_approval` (autoEnable) push หา `['MANAGER','OWNER']`
พร้อม deep link ไปหน้าอนุมัติ → เจ้าของได้ noti ภาษาไทยว่ามีงานรออนุมัติ กดตาม แล้วโดน 403
ข้อความ `ไม่สามารถอนุมัติคำขอของตนเองได้` อ่านเหมือนกฎถาวร ไม่บอกว่ามี toggle อยู่

### E3 ✓ [HIGH] role ที่สร้างจาก preset ชื่อไทยได้ key = `ROLE` ซึ่งไม่มีวันตรงกับ `MANAGER`
`roleKeyFromName` strip อักขระที่ไม่ใช่ ASCII ทิ้งหมด (`create-role.use-case.ts:20-27`)
ผมรันพิสูจน์: `ผู้จัดการ → ROLE`, `การเงิน → ROLE`, `บัญชี → ROLE`, `Manager → MANAGER`
ขณะที่ทุกใบเบิกตรึง `approverRoleSnapshot: 'MANAGER'` และ `matchesApproverRole('MANAGER', ['ROLE'])` = false
**Impact:** การตั้งค่าที่เป็นธรรมชาติที่สุด (เพิ่มพนักงาน + ให้ preset "ผู้จัดการ") ได้พนักงานที่เห็นหน้าอนุมัติ
แต่คิวว่างเปล่าตลอดกาล ขณะที่เจ้าของก็อนุมัติเองไม่ได้ → ล็อกทั้งคู่

### E4 [MED] `approverMode` ไม่มีผลอะไรเลยยกเว้น `CUSTOM_USER`; PO approval threshold + discount policy แก้ได้แต่ไม่มีใครอ่าน

---

## 6. รอยต่ออื่นที่พบใหม่

- ✓ [HIGH] **ปิดฟีเจอร์ `dashboard_notifications` = ทั้งบริษัทเป็นหน้าขาว** — ไม่อยู่ใน `PLATFORM_INVARIANT_FEATURE_KEYS`
  (มีแค่ `employee_access`, `company_settings`) พอปิด permission `dashboard.*` ถูกถอด → `WorkspaceLayout.tsx:79`
  redirect ไป dashboard ที่เข้าไม่ได้เหมือนกัน แล้ว `return null` → ทุกหน้าว่างเปล่า ไม่มี header ไม่มีปุ่มสลับบริษัท
- [HIGH] **ปุ่ม "ไปยังบริษัทที่ใช้งานได้" วนกลับบริษัทเดิม** — `/login` เลือก membership เก่าสุด แล้ว `watchdog_home` พากลับที่เดิม → วนไม่จบ ออกได้ทางเดียวคือ sign out
- ✓ [MED] **audit log ข้ามบริษัท** — `@Controller('audit')` ไม่มี `:companyId` และ web ไม่ส่ง header → ได้ log ของบริษัทเก่าสุดเสมอ
- [MED] **`x-company-id` มีศักดิ์เหนือ path** และ **43 จาก 64 controller ไม่เรียก `assertRouteCompany`** → URL บอกบริษัท B แต่อ่าน/เขียนบริษัท A ได้ (ไม่ใช่ privilege escalation แต่ทำลายความตรงกันของ audit trail)
- [MED] **permission/entitlement แช่แข็งตอน page load** — ไม่มี `router.refresh()` ที่ไหนเลย และโค้ดดึง permission ใหม่มาแล้วทิ้ง (`WorkspaceScope.tsx:46-49` ใช้แค่ `scopes.branchIds`) → ถูกถอดสิทธิ์กลางคันแล้วเมนูยังเต็ม ทุกคลิก 403
- [HIGH] **164 จาก 277 `@Body()` ไม่ผ่าน ValidationPipe** (type/interface → metatype = Object) — `expense.controller.ts` 28 body, DTO 0 ตัว; schema ไม่มี `VarChar` เลยสักคอลัมน์
- [HIGH] **เลขประจำตัวผู้เสียภาษีผู้ขายไม่ถูก validate ฝั่ง server** — เช็คแค่ไม่ว่าง (`expense-status.logic.ts:203`); `^\d{13}$` อยู่แค่ในเบราว์เซอร์ → ตัวอักษรปนก็ผ่านเข้ารายงานภาษีซื้อ
- [HIGH] **PO ไม่มี concurrency control เลย** — `purchaseOrder.update({ where: { id } })` ไม่มี status/version/companyId → สองคนอนุมัติพร้อมกันได้ 200 ทั้งคู่ ผู้อนุมัติคนหลังทับคนแรกใน audit
- [HIGH] **ผู้ที่ถูกตั้งเป็น approver แล้วถูก disable ทำให้ใบเบิกหายจากทุกคิว** — `isEligibleApprover` ข้าม OWNER fallback เมื่อมี `approverUserId` และ queue ใช้ predicate เดียวกัน → ไม่มีใครเห็น ไม่มีใครกดได้ ไม่มี route reassign
- [HIGH] **disable พนักงานลบประวัติ AI ทั้งหมดแบบถาวร** (`aiConversation.deleteMany` + cascade turns/tool invocations) โดยเป็นปุ่มเดียวไม่มี modal ยืนยัน และ `reason` ไม่เคยถูกส่ง
- [HIGH] **regenerate รหัสผ่านชั่วคราวให้พนักงานที่ถูก disable ได้ และ push เข้า LINE ของเขาเป็น plaintext** (ไม่มี status guard; ExternalIdentity ไม่เคยถูก unlink)
- [MED-HIGH] **รายจ่าย ฿0 ยืนยันและลงบัญชีได้** — `total < 0` เท่านั้นที่ถูกปฏิเสธ และ OCR cross-check บอดพอดีตอนที่ AI อ่านยอดไม่ออก
- [MED] **AR Aging ไม่มี bucket, ไม่สนใจ `asOfDate`, และเห็นแค่ `INVOICE`**; Sales Summary นับแค่ `INVOICE` → ผู้ขายที่จด VAT เห็นยอดขาย ฿0
- [MED] **หน้าจอเอกสารบัญชีเป็นภาษาอังกฤษทั้งหน้า** (Issue/Approve/Reject/Void/VAT rate/Tax ID — 32 สตริง) ทั้งที่เป็นหน้าจอที่มีผลทางกฎหมายที่สุด
- [MED] **165 จาก 190 error code (87%) ไม่มีข้อความไทย** → ผู้ใช้เห็น snake_case ดิบบนหน้าจอ; upload error ทั้ง 28 แบบถูกยุบเป็น "ระบบขัดข้อง" ก่อนถึงตัวแปลด้วยซ้ำ; 429/503 ไม่มี fallback ไทย
- [MED] **วันที่ทุกจุดบนเว็บ render ตามเวลาเบราว์เซอร์** (`thai-date.ts` ไม่ตั้ง `timeZone` ทั้ง 3 formatter, 40+ call site) ขณะที่ฝั่ง API ตรึง `Asia/Bangkok` ไว้แล้ว → เบราว์เซอร์ที่อยู่ตะวันตกของ UTC เห็นทุกวันที่เร็วไป 1 วัน
- [LOW-MED] **onboarding ไม่สร้าง**: WhtIncomeCategory (ไม่มี endpoint สร้างเลย → หัก ณ ที่จ่ายใช้ไม่ได้), expense category ตั้งต้น 11 หมวด, EmployeeAccessProfile ของเจ้าของ (เจ้าของไม่ปรากฏในหน้าพนักงาน/สิทธิ์ของตัวเอง)
- [HIGH] **ไม่มี UI บันทึกเลขผู้เสียภาษีของบริษัทเองและคำตอบ VAT registration** — API มี ไม่มีหน้าไหนเรียก → `sellerIdentityComplete` ไม่มีวันเป็นจริง

---

## 7. ลำดับการแก้ที่แนะนำ (แทนที่ลำดับในรอบ 1)

**P0 — ต้องมีก่อนมีลูกค้าจริงใช้บัญชี**
1. A1 สร้างเส้นทางสร้าง/อนุมัติ PostingRule (หรือปล่อย fallback ทำงานเมื่อไม่มีกฎ) — ปลดล็อกทุกอย่างในหมวด 1
2. A2 ทำ UI ลงรายการบัญชี + post/reverse (ปลดล็อกการปรับปรุงบัญชีและ deadlock ปิดงวด)
3. A3 งบดุลสะสมยอดยกมา + โอนกำไรเข้าทุน
4. B1 ใส่ `{BRANCH}` ใน template หรือทำ sequence เป็น company-wide
5. C1 จำกัด regex สแกน PDF ให้อยู่ใน object dictionary ที่ decompress แล้ว
6. C2 ใส่ขอบเขตปีใน `isCivilDate` (ปิดตระกูล พ.ศ. ได้เกือบทั้งหมดด้วยบรรทัดเดียว)

**P1 — ก่อนเปิดฟีเจอร์ที่เกี่ยวข้อง**
7. B2/B3 เก็บผู้ซื้อ+ผู้ขายให้ครบตาม ม.86/4 แล้วทำ PDF ใบกำกับภาษี
8. A5/A6/A7 ต่อ worker/ปุ่มลงบัญชีของรายรับและการเบิกจ่าย — **ต้องแก้ C5 (linkedExpenseId) พร้อมกัน** ไม่งั้นบั๊กลงบัญชีซ้ำจะระเบิดทันที
9. E1/E3 พอร์ต `SELF_APPROVAL_EXEMPT_ROLES` เข้า reimbursement + แก้ `roleKeyFromName` ให้รองรับชื่อไทย
10. D1/D2 ทำเส้นทาง amendment ให้มีจริง หรืออย่างน้อยบันทึก issue ทุกเส้นทาง sync
11. C4 idempotency ของ inventory ใช้ key จาก client ไม่ใช่ `ctx.requestId`
12. dashboard_notifications เข้า PLATFORM_INVARIANT หรือทำ fallback route

**P2**
13. D3 เติม period guard ที่เหลือ, 164 body ที่ไม่ validate, error message ไทย, i18n หน้าเอกสาร, timezone ฝั่งเว็บ

---

## 8. use case ที่ใช้ตรวจ

| # | สถานการณ์ | ผลเด่น |
|---|---|---|
| 1 | Day 0 บริษัทใหม่จากศูนย์ถึงรายจ่ายแรก | A1 (PostingRule), WHT category ว่าง, ไม่มี UI เลขผู้เสียภาษี |
| 2 | ถ่ายใบเสร็จส่ง LINE → ตั้งเบิก → ได้เงินคืน | A5, A6, C5 (ลงบัญชีซ้ำ), branchId ไม่ถูก assert |
| 3 | ปิดงวดสิ้นเดือน + ยื่นภาษี | A2, A3, A4, D1–D4 |
| 4 | เจ้าของคนเดียว / บริษัท 2 คน | E1–E4 |
| 5 | พนักงานลาออกทั้งที่มีงานค้าง | approver ค้าง, ลบประวัติ AI, push รหัสผ่านเข้า LINE คนที่ถูกปิด |
| 6 | ขายของ-เก็บเงิน-ออกใบกำกับภาษี | B1–B6, AR aging, ไม่มี PDF |
| 7 | หลายบริษัท + toggle เปลี่ยนกลางคัน | หน้าขาว, วน login, audit ข้ามบริษัท (ยืนยัน: 2 tab ไม่ปนกัน) |
| 8 | วันที่ทุกอย่างพัง | C1, C2, C3, C4, ฿0 confirm, 87% error ไม่มีข้อความไทย |
