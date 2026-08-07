# WHT Settlement Capture Spec — หัก ณ ที่จ่ายตอนจ่ายเจ้าหนี้ + ถูกหักตอนรับชำระ

Status: DRAFT (docs-first, พร้อม implement)
Owner: Finance/Accounting lane
Related: `docs/specs/accounting-tax-readiness-assessment.md` (RA-20, RA-22), `docs/agent-memory/wht-durable-prefilled-handoff.md` (H4), `docs/specs/tax-2026-verified-rules.md`, `docs/plans/wht-settlement-capture-plan.md`
Baseline discovery: 2026-08-05 บน `develop` (f68dba77)

## 1. ปัญหา

จุดที่ SME เจอหัก ณ ที่จ่ายบ่อยที่สุดคือ "ตอนเงินเคลื่อน" — จ่ายผู้รับจ้างแล้วหัก 3% หรือถูกลูกค้านิติบุคคลหัก 3% จากบิลเรา ทั้งสองจุดนี้ระบบยังทำไม่ได้จริง:

- **ฝั่งจ่าย (procurement)** — backend รับ `whtAmount` และ validate `gross − wht = net` แล้ว ([supplier-payment.use-case.ts:152](../../apps/api/src/modules/procurement/application/use-cases/supplier-payment.use-case.ts)) แต่:
  - UI ฮาร์ดโค้ด `whtAmount: '0'` ([AccountsPayablePages.tsx:417](../../apps/web/src/features/accounts-payable/AccountsPayablePages.tsx)) — กรอกไม่ได้เลย
  - posting source ฮาร์ดโค้ด `totalAmount = netPaid, whtTotal: '0'` ([supplier-payment.use-case.ts:206-208](../../apps/api/src/modules/procurement/application/use-cases/supplier-payment.use-case.ts)) — ถ้าจ่ายแบบหักจริงผ่าน API วันนี้ GL จะผิด: AP ถูก debit แค่ยอด net เหลือค้างเท่ายอดหักตลอดกาล และ 2210-02 ไม่ถูกเครดิต
  - ไม่มี WHT tax event จากการจ่าย (RA-20) — `accounting-payment-source.adapter.ts` เป็น stub; ภ.ง.ด.3/53 มาจาก expense เท่านั้น ([sync-tax-events.use-case.ts:245](../../apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts))
  - `SupplierPayment` ไม่มี `whtCategoryCode`/`whtRate` — handoff 50 ทวิ จึง prefill หมวด/อัตราเป็น null โดยตั้งใจ ([prisma-procurement.repository.ts:1455](../../apps/api/src/modules/procurement/infrastructure/prisma-procurement.repository.ts))
  - void payment ไม่ยกเลิก handoff — `WhtHandoffStatus.CANCELLED` มีใน enum แต่**ไม่มีโค้ดไหนเขียนค่านี้เลย** → void แล้ว obligation ค้าง `REQUIRED` ให้คนไปออก 50 ทวิ ของ payment ที่ตายแล้ว
- **ฝั่งรับ (accounting-documents, RA-22)** — schema เอกสารมี `whtRate/whtAmount` ครบและ totals logic คำนวณได้ ([accounting-totals.logic.ts:76](../../apps/api/src/modules/accounting-documents/domain/logic/accounting-totals.logic.ts)) แต่:
  - ฟอร์มสร้างเอกสารไม่ส่ง `whtRate` (มีแต่ช่อง VAT — [AccountingPages.tsx:288](../../apps/web/src/features/accounting-documents/AccountingPages.tsx))
  - `AccountingPayment`/`AccountingPaymentAllocation` **ไม่มีฟิลด์ WHT เลย** → invoice ที่ลูกค้าหัก 3% จะค้าง PARTIALLY_PAID เท่ายอดที่ถูกหักตลอดกาล
  - `WHT_RECEIVABLE: '1270-00'` ประกาศไว้แต่ไม่มี posting branch ไหนใช้ ([posting-engine.logic.ts:54](../../apps/api/src/modules/ledger/domain/logic/posting-engine.logic.ts))

## 2. เป้าหมาย

1. บันทึกจ่ายเจ้าหนี้แบบหัก ณ ที่จ่าย ได้จากหน้า AP: ตัดหนี้เต็ม, จ่ายเงินสุทธิ, GL ถูก, เกิด WHT tax event เข้า ภ.ง.ด.3/53, เกิด 50 ทวิ handoff ที่ prefill หมวด/อัตราครบ
2. รับชำระเอกสารขายที่ลูกค้าหักภาษี ได้จากหน้า Accounting: เอกสาร settle เป็น PAID, เงินสดลง 1,040 ภาษีถูกหักลงบัญชีสินทรัพย์, ค้างรับเป็นศูนย์
3. Void ทั้งสองฝั่งย้อนทุกอย่างที่สร้าง: journal (true reversal เดิมรองรับอยู่แล้วเพราะ mirror บรรทัดจริง), tax event, handoff
4. Fail closed เสมอ: บริษัทที่บังคับ PostingRule แต่ rule ยังไม่รู้จัก WHT ต้องได้ posting_error ที่บอกว่าตั้งค่าอะไร ไม่ใช่ journal ผิดเงียบ ๆ

## 3. Non-goals (บันทึกไว้ ไม่ทำรอบนี้)

- **Bill-carried WHT → ภ.ง.ด. event**: bill ที่ตั้ง `whtAmount` ตอนตั้งหนี้ (ทำได้ทาง API เท่านั้น ฟอร์ม web ไม่มีช่อง) ยังไม่เกิด tax event — จุดหักที่ระบบแนะนำคือ payment-time; bill-carried ยังลง GL ถูกเหมือนเดิมแต่ไม่เข้าใบแนบอัตโนมัติ
- เปิด gate `cap.wht50bis` / ฟอร์มพิมพ์ 50 ทวิ (RA-21) — handoff ภายนอกคือ path ที่ใช้ไป
- ฝั่งขาย: ไม่มี tax event (เราเป็นผู้ถูกหัก ไม่มีหน้าที่ยื่น ภ.ง.ด. ของรายการนี้); เครดิตภาษี CIT อ่านจากยอดบัญชี WHT receivable — ส่วนต่อ CIT report คือ RA-22 ที่เหลือ
- แนบไฟล์หนังสือรับรองที่ลูกค้าออกให้ (ฝั่งขาย) — รอบแรกใช้ `note`/`externalReference`
- WHT บน expense-module payment, reimbursement (เบิกคืนพนักงานไม่หักโดยนิยาม), หน่วย fraction ฝั่ง expense UI (backlog เดิม)
- Expense-side 50 ทวิ handoff seam (H4 OQ-2 ระบุเป็น later slice อยู่แล้ว)
- ภ.ง.ด.54 / ผู้รับเงินต่างประเทศ — supplier `FOREIGN` ตกลง PND53 fallback ไปก่อนพร้อมให้ผู้ทำบัญชี review (แบบเดียวกับ payee ที่ไม่รู้ประเภท)

## 4. ผู้ใช้และ journey

- **การเงิน (มี `procurement.supplier_payment.create+release`)**: เลือกบิล → เห็น outstanding → เลือกหมวดเงินได้ (จาก `WhtIncomeCategory` ที่ ACTIVE) → อัตราเติมอัตโนมัติ แก้ได้ → ระบบเสนอยอดหัก = rate × ฐาน → เห็น "โอนจริง" = ตัดหนี้ − หัก → บันทึก
- **การเงิน (มี `accounting.payment.create`)**: เปิดเอกสารขาย ISSUED → กรอกเงินสดที่เข้าบัญชี + ยอดที่ลูกค้าหัก → เอกสาร PAID
- **ผู้ทำบัญชี**: sync tax events → เห็น WHT ครบทั้ง expense และ supplier payment ในงวด ภ.ง.ด.3/53 → เห็น handoff ที่ prefill ครบพอกรอกแบบ RD ภายนอกได้
- **ผู้ดูแลผังบัญชี**: บริษัท template ตั้ง `whtAccountCode` ใน PostingRule ของ event ที่เกี่ยว (ฝั่งรับต้องเพิ่มบัญชี "ภาษีถูกหัก ณ ที่จ่าย" เองก่อน — ผัง TH SME v1 ไม่มี ดู §8)

## 5. กติกาเงิน (ทั้งสองฝั่ง)

- หน่วยอัตรา = **เปอร์เซ็นต์** (`3` = 3%) ทศนิยม ≤ 4 ตำแหน่ง ช่วง 0–100 — ตรงกับ `VendorBill.whtRate`, `AccountingDocumentLine.whtRate`, `WhtIncomeCategory.defaultRate` (ฝั่ง expense เก็บ fraction เป็น legacy ของโมดูลนั้น มี RA-19 adapter แปลงอยู่แล้ว — ห้ามลอกหน่วยมาฝั่งนี้)
- ทุก component ปัดสตางค์ (round2) ตอนคำนวณ ตาม §19d ของ expense; เก็บ Decimal(18,4)
- ฐานภาษีหัก ณ ที่จ่าย = ยอดก่อน VAT เสมอ

## 6. ฝั่งจ่าย — supplier payment

### 6.1 Data model (migration additive)

```prisma
model SupplierPayment {
  // ...
  whtCategoryCode String?               // อ้าง WhtIncomeCategory.code
  whtRate         Decimal? @db.Decimal(8, 4)  // เปอร์เซ็นต์ ตาม WhtIncomeCategory.defaultRate
}
```
`allocations[].whtAmount` มีอยู่แล้วใน schema/DTO — เปลี่ยนจากไม่เคยใช้เป็นใช้จริง

### 6.2 นิยาม allocation ใหม่ (breaking ภายใน, ไม่ breaking ต่อ caller เดิม)

- `allocations[].amount` = **ยอดตัดหนี้บิล** (รวมส่วนที่หัก) — ตัด `outstandingAmount` ตรง ๆ เหมือนเดิม
- `grossAmount` = Σ alloc.amount (validation ใหม่ แทนของเดิมที่บังคับ Σ alloc == netPaid — caller เดิมส่ง wht=0 → gross==net → ผ่านเหมือนเดิมทุกกรณี)
- `netPaidAmount` = เงินสดออกจริง = gross − wht (validation เดิมคงไว้)
- `unappliedAmount` ใน repo เปลี่ยนเป็น `gross − allocated` (เดิม net − allocated ซึ่งจะติดลบเมื่อมี wht)
- Σ (alloc.whtAmount ?? 0) == header `whtAmount` **เสมอ** (รวมเคส header = 0 — alloc แอบใส่ wht โดย header ไม่รู้ต้องโดน reject); แต่ละ alloc: `0 ≤ whtAmount < amount`
- header `whtAmount` > 0 ⇒ ต้องมี `whtCategoryCode` + `whtRate`
- **กันหักซ้ำ**: alloc ที่ `whtAmount > 0` ไปยังบิลที่ `bill.whtAmount > 0` (bill-carried, netPayable หักไว้แล้วตอนตั้งหนี้) → 400 `wht_double_withholding`
- PP36 proration ใช้ alloc.amount (ยอดตัดหนี้) — ความหมายเดิมไม่เปลี่ยน; SETTLE_EPSILON ครึ่งสตางค์คงเดิม

### 6.3 GL

posting source: `totalAmount = grossAmount`, `whtTotal = whtAmount` (แก้ [buildSupplierPaymentPostingSource](../../apps/api/src/modules/procurement/application/use-cases/supplier-payment.use-case.ts))

default branch `accounting.payment.made` (+`expense.payment` ที่ share case — source ของ expense ไม่ส่ง `whtTotal` เลย ([journal.use-case.ts:415](../../apps/api/src/modules/ledger/application/use-cases/journal.use-case.ts)) และ `decimal(undefined)` = 0 → พฤติกรรมเดิมไม่ขยับ):

| บัญชี | Dr | Cr |
|---|---|---|
| เจ้าหนี้การค้า (AP) | gross | |
| เงินสด/ธนาคาร | | gross − wht |
| ภาษีหัก ณ ที่จ่ายรอนำส่ง (WHT_PAYABLE) | | wht |

ตัวอย่าง: บิล 1,070 (ฐาน 1,000 + VAT 70, บิลไม่หัก) จ่ายหักค่าบริการ 3% ของฐาน = 30 → alloc 1,070 / cash 1,040 / wht 30 → บิล PAID, AP ล้างพอดี

### 6.4 ภ.ง.ด.3/53 tax event (ปิด RA-20 ฝั่ง payment seam)

Adapter ใหม่ `supplier-payment-source.adapter.ts` (mirror [expense-source.adapter.ts](../../apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.ts)): อ่าน `SupplierPayment` ที่ `status='RECORDED' AND whtAmount > 0` พร้อม supplier snapshot แล้วต่อ loop ใน `sync-tax-events.use-case.ts` ตาม pattern expense WHT เป๊ะ ๆ:

- `formType`: `supplier.supplierType === 'INDIVIDUAL'` → PND3, `'JURISTIC_PERSON'` → PND53, ค่าอื่น (`FOREIGN`/`GOVERNMENT`/`OTHER`/null) → PND53 fallback (กติกาเดียวกับ RA-18; ไม่เดาจากเลข 13 หลัก) — ผู้รับต่างประเทศจริง ๆ เป็นเรื่อง ภ.ง.ด.54 ซึ่งอยู่นอก scope (ดู §3)
- `eventDate = paymentDate`, periodKey รายเดือน, `assertPeriodUnlocked` เดิม
- `grossAmount` (ฐานเงินได้) = round2(whtAmount ÷ (whtRate/100)) — derive จากอัตราที่บังคับกรอก ไม่ใช่ `SupplierPayment.grossAmount` ซึ่งรวม VAT
- `incomeCategoryCode = whtCategoryCode`, `whtRate` = เปอร์เซ็นต์ตรง ๆ (ไม่ต้องแปลงหน่วยแบบ expense)
- supplier ไม่มี `taxId` → review issue `MISSING_TAX_ID` แล้วข้าม (เหมือน expense)
- sourceHash จาก whtAmount+updatedAt; supersede เมื่อ hash เปลี่ยน

### 6.5 Handoff 50 ทวิ

- prefill ใน `createWhtHandoffForPayment` เติม `incomeCategoryCode`, `incomeCategoryName` (lookup ใน tx), `whtRate` จากฟิลด์ใหม่ — ลบเหตุผลที่เคย null ทิ้งได้เพราะตอนนี้ payment header ถือ withholding decision แล้ว; `formType` ยังมาจาก supplierType (หมวดเป็น metadata ไม่ override)
- `grossAmount` ใน prefill เปลี่ยนเป็นฐานเงินได้ (สูตรเดียวกับ §6.4) ให้ตรงความหมายบนแบบ RD

### 6.6 Void

ใน transaction `voidSupplierPayment` เพิ่ม (ตาม pattern PP36 ที่อยู่ในไฟล์เดียวกัน):

1. WHT tax events (`sourceType='procurement.supplier_payment'`, eventType WHT_*) → ถ้า period FILED/PAID/CLOSED → `ConflictException('wht_tax_period_locked_requires_amendment')`; ไม่งั้น status → REVERSED + `TaxAdjustment(REVERSAL)`
2. handoff ของ payment นี้: `REQUIRED` → `CANCELLED` (updateMany แบบ CAS); ถ้า `EXTERNAL_LINKED`/`SYSTEM_ISSUED` → block void ด้วย `wht_certificate_linked_requires_review` — หนังสือรับรองจริงถูกออกไปแล้ว ต้องจัดการเอกสารจริงก่อน (mirror หลัก fail-closed ของ `pp36_input_claim_already_released_requires_amendment`)
3. bill restore ใช้ alloc.amount (ยอดตัดหนี้) — สูตรเดิมถูกอยู่แล้วเพราะนิยามใหม่ทำให้ alloc = ยอดที่เคยตัด

### 6.7 UI (แท็บ payments ใน AP)

- เพิ่มส่วน "หัก ณ ที่จ่าย": dropdown หมวด, อัตรา (autofill จาก defaultRate, แก้ได้), ยอดหัก (เสนอ = round2(rate% × bill.taxableAmount) เมื่อตัดหนี้เต็ม outstanding, แก้ได้; จ่ายบางส่วนให้กรอกเอง)
- **แหล่งหมวดสำหรับหน้า AP**: endpoint เดิม `GET tax/wht-categories` ติด `tax.config.read` (ยืนยันแล้ว [tax.controller.ts:249](../../apps/api/src/modules/tax/presentation/http/tax.controller.ts)) ซึ่งคนการเงินฝั่ง AP ไม่จำเป็นต้องมี — เพิ่ม endpoint read เล็ก `GET .../procurement/wht-categories` guard ด้วย `procurement.supplier_payment.read` คืนเฉพาะ ACTIVE `{code, nameTh, formType, defaultRate}` ตามหลักเดียวกับที่แท็บ WHT ไม่ผูก `thai_tax` (H4)
- แสดง "โอนจริง" = ตัดหนี้ − หัก (readonly), ส่ง `grossAmount`=ตัดหนี้, `whtAmount`, `netPaidAmount`, `allocations[0].whtAmount`
- บิลที่ `whtAmount > 0` อยู่แล้ว: ช่องหักถูก disable พร้อมข้อความว่าบิลนี้หักไว้ตอนตั้งหนี้แล้ว
- หมวด ACTIVE ว่างเปล่า (ยัง DRAFT ทั้ง 15 แถวตาม seed): แสดงคำแนะนำให้เปิดใช้หมวดก่อน — ช่องหักใช้ไม่ได้จนกว่าจะมีหมวด (fail closed ฝั่ง UX, สอดคล้อง seed note "Accountant verification required")
- `canSubmitSupplierPayment` ([accounts-payable.model.ts](../../apps/web/src/features/accounts-payable/accounts-payable.model.ts)) รับ wht inputs + bill.whtAmount แล้ว validate กติกา §6.2 ฝั่ง client

## 7. ฝั่งรับ — accounting documents

### 7.1 Data model (migration additive)

```prisma
model AccountingPayment {
  whtAmount Decimal @default(0) @db.Decimal(18, 4)  // ยอดที่ผู้จ่ายหักไว้ นับเป็นการ settle เอกสาร
}
model AccountingPaymentAllocation {
  whtAmount Decimal? @db.Decimal(18, 4)             // ส่วน WHT ของ allocation นี้
}
```
`AccountingPayment.amount` **คงความหมายเงินสดเข้าบัญชี** — bank reconciliation จับคู่ด้วยฟิลด์นี้ ([prisma-match-source.query.ts](../../apps/api/src/modules/banking/infrastructure/prisma-match-source.query.ts)) ห้ามเปลี่ยน

### 7.2 กติกา

- `whtAmount > 0` ⇒ `direction === 'RECEIVED'` และต้องมี `allocateToDocumentId` (WHT ไม่มีทางเป็นเครดิตลอย ต้องผูกเอกสารเสมอ) — ฝั่ง PAID direction ให้ error (payable เป็นของ procurement)
- ยอด settle เอกสาร = `amount + whtAmount` ต้อง ≤ outstanding (2dp exact); เมื่อ wht=0 คง clamp พฤติกรรมเดิม
- **re-check ใน transaction**: use-case validate นอก tx แล้ว repo ต้องอ่าน outstanding ใหม่ใน tx และ throw เมื่อ cash+wht เกิน (wht>0 ไม่มี clamp ให้พึ่ง — สอง payment พร้อมกันต้องมีตัวแพ้ ไม่ใช่ over-settle เงียบ ๆ)
- `doc.paidAmount += amount + whtAmount`; allocation row: `amount` = ส่วนเงินสด, `whtAmount` = ส่วนหัก; `calculateUnappliedCredit(amount, allocatedCash)` สูตรเดิม
- void restore: `paid −= (alloc.amount + alloc.whtAmount)` ([prisma-accounting.repository.ts:620](../../apps/api/src/modules/accounting-documents/infrastructure/prisma-accounting.repository.ts) ต้องบวก whtAmount เข้าไป)
- `validateAccountingPaymentMoneyInput` + `validateAccountingPaymentAllocation` ขยายตามนี้; `CreatePaymentDto` เพิ่ม `whtAmount?` (ACCOUNTING_MONEY_PATTERN)
- `sumReceivedPaymentsByCounterparty` เปลี่ยนเป็น Σ(amount + whtAmount) — ความหมายคือ "ยอดที่ settle ให้ลูกค้ารายนี้" ไม่ใช่เงินสด

### 7.3 GL

posting source: `totalAmount = amount + whtAmount`, `whtTotal = whtAmount` ([buildAccountingPaymentPostingSource](../../apps/api/src/modules/accounting-documents/application/use-cases/posting-source.use-case.ts))

default branch `accounting.payment.received`:

| บัญชี | Dr | Cr |
|---|---|---|
| เงินสด/ธนาคาร | total − wht | |
| ภาษีถูกหัก ณ ที่จ่าย (WHT_RECEIVABLE) | wht | |
| ลูกหนี้การค้า (AR) | | total |

ตัวอย่าง: invoice 1,070 ลูกค้าหัก 30 → Dr Cash 1,040 / Dr 1270-00 30 / Cr AR 1,070 → PAID

### 7.4 UI

- ฟอร์มสร้างเอกสาร: เพิ่มช่อง "หัก ณ ที่จ่าย (%)" (optional) ส่งเป็น `lines[].whtRate` — validation ([ACCOUNTING_RATE_PATTERN](../../apps/api/src/modules/accounting-documents/domain/logic/accounting-money-validation.logic.ts)) และ totals มีอยู่แล้ว; แสดง "คาดว่าจะได้รับสุทธิ = grand − wht" ใต้ฟอร์ม
- ฟอร์มรับชำระในหน้า detail: เพิ่มช่อง "ถูกหัก ณ ที่จ่าย" (prefill = `doc.whtAmount` เมื่อยังไม่เคยรับชำระ, อื่น ๆ กรอกเอง), ช่อง Amount เดิม = เงินสดจริง; validate cash + wht ≤ outstanding

## 8. PostingRule / บริษัทที่ใช้ผังบัญชี template (จุดตายที่ต้องปิด)

ข้อเท็จจริงจาก discovery: บริษัทที่ผ่าน chart bootstrap (รวมบริษัท seed) เข้าเงื่อนไข `requiresReviewedPostingRules` → **บังคับ PostingRule และไม่ใช้ default codes เลย** ([journal.use-case.ts:519](../../apps/api/src/modules/ledger/application/use-cases/journal.use-case.ts)); `resolvePostingLinesFromRule` วันนี้แสดงได้แค่ 2 บรรทัด gross ([posting-engine.logic.ts:78](../../apps/api/src/modules/ledger/domain/logic/posting-engine.logic.ts)) จึง**แสดง journal ที่มี WHT ไม่ได้เชิงโครงสร้าง**

ทางแก้ (เล็กสุดที่ถูก):

- ขยาย `mappingJson` ด้วย field ใหม่ตัวเดียว: `whtAccountCode?: string`
- `resolvePostingLinesFromRule`: เมื่อ `whtTotal > 0` — ไม่มี `whtAccountCode` → คืน null → เดิน path `posting_rule_missing` (fail closed, ข้อความบอกให้ไปตั้งบัญชี WHT ใน rule); มี → สร้าง 3 บรรทัด โดยฝั่งของบรรทัด WHT ตาม event: `*.received` → DEBIT (สินทรัพย์), `*.made` → CREDIT (หนี้สิน); `whtTotal == 0` → พฤติกรรมเดิมทุก byte
- ผัง TH SME v1: มี 2132-03/2132-04 (payable ภงด.3/53) ให้เลือกฝั่งจ่าย แต่**ไม่มีบัญชีภาษีถูกหัก ณ ที่จ่าย** — ฝั่งรับผู้ดูแลต้องสร้างบัญชีบริษัทเองก่อน (ผ่านหน้า COA ที่มีอยู่) หรือใช้ 1151-02 ตามดุลพินิจนักบัญชี; **ไม่แตะ catalog** เพราะ checksum/version machinery ของ template ไม่คุ้มกับงานรอบนี้ — บันทึกเป็น follow-up ของ catalog vNext
- semantic role `WHT_PAYABLE`/`WHT_RECEIVABLE` มีใน `TaxAccountRole` enum แล้ว แต่เส้นทาง component-based ใช้กับ VAT-family เท่านั้น (WHT ไม่ใช่ `TaxComponentKey`) — ไม่ยก WHT เป็น component รอบนี้ (สเกลใหญ่เกิน, บันทึกเป็นทางเลือกที่ตัดใน plan)

## 9. สิ่งที่ตรวจแล้วว่า "ไม่ต้องแก้" (แต่ต้องมี test กันถอย)

- **Bank reconciliation**: ทั้งสอง candidate ใช้เงินสดจริง (`payment.amount`, `netPaidAmount`) — นิยามใหม่คงฟิลด์เหล่านี้เป็นเงินสด → จับคู่ statement ได้เหมือนเดิม
- **AP aging**: อิง `outstandingAmount` ของบิล — WHT ตัดหนี้ผ่าน alloc.amount จึงถูกโดยอัตโนมัติ
- **Supplier statement**: บิลแสดง `netPayableAmount` (1,070) payment แสดง `netPaidAmount` (1,040) — ส่วนต่างที่เห็น = WHT ซึ่งตรงกับความจริงทางบัญชี ยอมรับได้ ไม่แก้รอบนี้
- **PP36**: proration ใช้ alloc.amount (ยอดตัดหนี้) — นิยามตรงเดิม; บิล PP36 (บริการต่างประเทศ) กับ WHT-at-payment อยู่ร่วมกันได้ ไม่มี validation ขัดกัน
- **Expense payments / reimbursement payments**: ส่ง wht=0 ตลอด — shared posting branch เปลี่ยนแบบ backward-compatible
- **LINE AI tools**: read-only, field ใหม่เป็น additive
- **Idempotency/replay**: `idempotencyKey` เดิมครอบ payload ใหม่โดยไม่ต้องแก้; handoff `creationCommandId` per-payment เดิม

## 10. Acceptance criteria

| # | Scenario | ผลที่ต้องได้ |
|---|---|---|
| A1 | จ่ายบิล 1,070 (ฐาน 1,000+VAT 70) หักค่าบริการ 3% (30) | บิล PAID; payment gross 1,070 / wht 30 / net 1,040; GL Dr AP 1,070, Cr Cash 1,040, Cr WHT_PAYABLE 30; sync แล้วเกิด WHT_PND53 (supplier นิติบุคคล) gross 1,000 withheld 30 งวดตาม paymentDate; gate CLOSED → handoff REQUIRED prefill หมวด/อัตรา/ฐานครบ |
| A2 | จ่ายบางส่วน 535 จากบิล 1,070 หัก 15 | บิล PARTIALLY_PAID เหลือ 535; cash 520 |
| A3 | จ่ายบิลที่ bill-carried WHT (bill.whtAmount>0) พร้อมส่ง payment wht > 0 | 400 `wht_double_withholding`; ช่อง UI disabled |
| A4 | void payment A1 (period ยังไม่ FILED) | journal reversal mirror 3 บรรทัด; tax event REVERSED + TaxAdjustment; handoff → CANCELLED; บิลกลับ APPROVED/outstanding เดิม |
| A5 | void payment ที่ handoff EXTERNAL_LINKED แล้ว | 409 `wht_certificate_linked_requires_review`, ไม่มี mutation |
| A6 | supplier ไม่มี taxId + จ่ายแบบหัก | payment สำเร็จ; sync สร้าง review issue MISSING_TAX_ID, ไม่มี event |
| A7 | wht > 0 แต่ไม่ส่งหมวด/อัตรา; หรือ Σ alloc.wht ≠ header (รวมเคส header=0 แต่ alloc แอบมี wht) | 400 จาก DTO/use-case |
| B1 | invoice 1,070 ลูกค้าหัก 30, รับ 1,040+wht 30 | เอกสาร PAID outstanding 0; GL Dr Cash 1,040, Dr WHT_RECEIVABLE 30, Cr AR 1,070 |
| B2 | รับบางส่วน 500 cash (wht 0) แล้วตามด้วย 540+30 | PARTIALLY_PAID 570 → PAID |
| B3 | cash+wht > outstanding | 422 ก่อนเขียนอะไร |
| B4 | wht > 0 โดยไม่ allocate เอกสาร หรือ direction PAID | 422 |
| B5 | void B1 | paid/outstanding คืนเดิม; reversal mirror 3 บรรทัด |
| C1 | บริษัท template, rule ไม่มี whtAccountCode, จ่ายแบบหัก | journal generation ล้ม `posting_rule_missing` + markSource posting_error; ตั้ง whtAccountCode แล้ว generate ใหม่ผ่าน |
| C2 | บริษัท legacy (ไม่มี template stamp) | default 3 บรรทัดโพสต์ได้เมื่อ 2210-02/1270-00 มีในผังบริษัท; ไม่มี → `account_not_found:<code>` เดิม |

## 11. ความเสี่ยง / deploy note

- Payment ที่เคยสร้างผ่าน API ด้วย wht > 0 (ถ้ามีใน UAT/prod) เคยโพสต์ journal แบบ net-only ผิดมาก่อน — migration ไม่แก้ย้อนหลัง ต้อง audit ด้วย query `SupplierPayment.whtAmount > 0` ก่อน deploy แล้วแก้ด้วย manual journal ถ้าพบ
- การสลับ validation `Σ alloc == netPaid` → `== gross` ต้องมี test ยืนยัน caller เดิม (wht=0) ไม่สะดุด
- หมวดเงินได้ยัง DRAFT ทั้งหมด: ฟีเจอร์ฝั่งจ่ายจะกดใช้ไม่ได้จนกว่านักบัญชีเปิดใช้หมวด (by design) — ต้องสื่อสารตอนเปิดฟีเจอร์
