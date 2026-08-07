# WHT Settlement Capture Plan

Status: READY (docs-first; ยังไม่เริ่ม implement)
Spec: `docs/specs/wht-settlement-capture-spec.md`
Memory: `docs/agent-memory/wht-settlement-capture.md`
Scope: จ่ายเจ้าหนี้แบบหัก ณ ที่จ่าย (Phase 1) + รับชำระที่ถูกหัก (Phase 2) + posting-rule/WHT (ฝังใน 1–2)
หลักการ: ponytail full — reuse pattern เดิมทุกจุด (expense WHT sync loop, PP36 void pattern, H4 handoff), ไม่มี abstraction ใหม่, ไม่มี dependency ใหม่

## ลำดับที่บังคับ

Phase 1 ก่อน Phase 2 (Phase 2 ใช้ posting-rule extension ที่ทำใน 1.4) แต่ 2 ไม่ block 1 — ส่งแยก commit ได้

---

## Phase 1 — จ่ายเจ้าหนี้หัก ณ ที่จ่าย

### 1.1 Schema + contracts

- `apps/api/prisma/schema.prisma`: `SupplierPayment` + `whtCategoryCode String?`, `whtRate Decimal? @db.Decimal(8,4)`; migration additive ใหม่ (ชื่อแนว `2026xxxx_supplier_payment_wht_decision`)
- `packages/contracts/src/procurement.ts`: `CreateSupplierPaymentDto` + `whtCategoryCode?`, `whtRate?`; ตรวจ `SupplierPaymentAllocationDto`/`SupplierPaymentDto` ว่า `whtAmount` ครบทั้ง input/response แล้วเติมส่วนที่ขาด + field ใหม่ใน response
- `apps/api/.../procurement/presentation/http/procurement.dtos.ts`: validators ของ field ใหม่ (pattern จาก `common/pipes/decimal-string.patterns.ts`, อัตรา 0–100 ≤4dp)
- `apps/api/.../procurement/domain/models/procurement.model.ts` + `toSupplierPaymentRecord`: map field ใหม่

### 1.2 Use-case + repository

`supplier-payment.use-case.ts` (CreateSupplierPaymentUseCase):
- สลับ validation: `Σ alloc.amount == grossAmount` (แทน `== netPaidAmount`); คง `gross − wht == net`
- กติกาใหม่: Σ alloc.whtAmount == header wht **เสมอ** (รวม header=0), alloc.whtAmount < alloc.amount; wht>0 ⇒ category+rate บังคับ; บิลที่ `whtAmount > 0` + alloc.wht>0 → `wht_double_withholding`
- ส่ง field ใหม่ลง repo

`prisma-procurement.repository.ts`:
- `createSupplierPayment`: persist field ใหม่; `unappliedAmount = gross − allocated`
- `createWhtHandoffForPayment`: prefill `incomeCategoryCode/Name` (lookup `whtIncomeCategory` ใน tx), `whtRate`, `grossAmount` = ฐานเงินได้ round2(wht ÷ rate%) — ลบ comment "Not derivable" ที่หมดอายุ
- `voidSupplierPayment` (ใน tx เดิม, ตาม pattern PP36 บล็อกบน):
  - WHT events (`sourceType='procurement.supplier_payment'`, eventType `WHT_PND3|WHT_PND53`, ACTIVE): period FILED/PAID/CLOSED → `wht_tax_period_locked_requires_amendment`; ไม่งั้น REVERSED + `TaxAdjustment(REVERSAL, kind:'WHT_PAYMENT_REVERSAL')`
  - handoff: `updateMany({where:{companyId, sourcePaymentType:'procurement.supplier_payment', sourcePaymentId:id, status:'REQUIRED'}, data:{status:'CANCELLED'}})`; ก่อนหน้านั้นถ้าพบ row สถานะ `EXTERNAL_LINKED|SYSTEM_ISSUED` → `wht_certificate_linked_requires_review`

### 1.3 Posting source

- `buildSupplierPaymentPostingSource`: `totalAmount = grossAmount`, `whtTotal = whtAmount`

### 1.4 Posting engine (`posting-engine.logic.ts`)

- branch `'expense.payment' | 'accounting.payment.made'`: Dr AP `total` / Cr Cash `total − wht` / Cr `WHT_PAYABLE` `wht` (wht=0 → สองบรรทัดเดิมเป๊ะ)
- `resolvePostingLinesFromRule`: อ่าน `mappingJson.whtAccountCode`; `whtTotal>0` && ไม่มี → คืน null (ไหลไป `posting_rule_missing` เดิม); มี → 3 บรรทัด, ฝั่ง WHT: eventType ลงท้าย `.received` → DEBIT, `.made` → CREDIT

### 1.5 Tax sync (ปิด RA-20 payment seam)

- ใหม่: `apps/api/.../tax/infrastructure/adapters/supplier-payment-source.adapter.ts` — `findRecordedWithWhtByCompany(companyId, since)` คืน row {id, paymentDate, whtAmount, whtRate, whtCategoryCode, currency, supplier snapshot(name/taxId/branchCode/supplierType), updatedAt}
- stub `accounting-payment-source.adapter.ts` **คงไว้** — comment ของมัน ("AccountingPayment ไม่มี WHT event") ยังจริงตาม spec §3 (ฝั่งขายไม่มี tax event); แค่เติมบรรทัดชี้ว่า supplier-payment WHT อยู่ที่ adapter ใหม่
- `sync-tax-events.use-case.ts`: loop ใหม่หลัง expense WHT — copy โครง expense ทั้ง period upsert / currency guard / MISSING_TAX_ID / hash-supersede; ต่างแค่ sourceType `procurement.supplier_payment`, eventDate=paymentDate, gross=round2(wht÷rate%), rate ใช้ตรง ๆ (percent), formType จาก supplierType
- `tax.module.ts` register adapter

### 1.6 Web (AP)

- `accounts-payable.api.ts`/type: field ใหม่
- `accounts-payable.model.ts`: `canSubmitSupplierPayment` รับ {whtAmount, whtCategoryCode, whtRate, billWhtAmount} + กติกา §6.2; แสดงผลใน `accounts-payable.model.spec.ts`
- endpoint ใหม่ (ยืนยันแล้วว่าจำเป็น — ของเดิมติด `tax.config.read`): `GET .../procurement/wht-categories` ใน procurement controller, guard `procurement.supplier_payment.read`, คืน ACTIVE เท่านั้น `{code, nameTh, formType, defaultRate}` + client fn ใน `accounts-payable.api.ts`
- `AccountsPayablePages.tsx` ฟอร์มจ่าย: ส่วนหัก ณ ที่จ่าย ใช้ endpoint ข้างบน, อัตรา autofill, ยอดหักเสนอ rate×bill.taxableAmount เมื่อจ่ายเต็ม, แสดงโอนจริง, disable เมื่อบิล bill-carried, hint เมื่อไม่มีหมวด ACTIVE
- list/detail payment แสดง whtAmount

### 1.7 Tests (เพิ่มไฟล์ใหม่เข้า list ใน `apps/api/package.json` "test" ด้วย — repo enumerate รายไฟล์)

- `supplier-payment-integrity.use-case.spec.ts` (มีอยู่): เคส validation ใหม่ทั้งหมด (gross-based allocation, double-withholding, category/rate บังคับ, backward-compat wht=0)
- `procurement.dtos.spec.ts` (มีอยู่): field ใหม่ + ช่วงอัตรา 0–100
- posting-engine spec (มี transaction-tax-posting.logic.spec / journal specs): เคส made-branch 3 บรรทัด + rule whtAccountCode + fail-closed
- adapter spec ใหม่ mirror `expense-source.adapter.spec.ts`
- sync spec: ต่อยอด `sync-tax-events-wht-form.use-case.spec.ts` ด้วย payment source (formType จาก supplierType, ฐาน = wht÷rate)
- void spec: `pp36-payment-reversal.repository.spec.ts` แนวเดียวกัน — WHT event reversal + handoff CANCELLED + blocked-link case
- web: `accounts-payable.model.spec.ts`

### 1.8 Verify (Phase gate)

```bash
pnpm --filter @watchdog-bms/contracts build && pnpm --filter @watchdog-bms/api lint && pnpm --filter @watchdog-bms/api test
pnpm --filter @watchdog-bms/api prisma:validate
pnpm --filter @watchdog-bms/web typecheck && pnpm --filter @watchdog-bms/web test
```
- migration ต่อ local Postgres: `docker:local:infra` + `prisma migrate deploy` status สะอาด
- บันทึกผลจริงลง memory; e2e `accounts-payable.spec.ts` เพิ่ม scenario A1/A3 ถ้ารัน local ได้ ไม่ได้ให้บันทึกเหตุผล

---

## Phase 2 — รับชำระที่ถูกหัก (ฝั่งขาย)

### 2.1 Schema + contracts

- `AccountingPayment.whtAmount Decimal @default(0) @db.Decimal(18,4)`; `AccountingPaymentAllocation.whtAmount Decimal? @db.Decimal(18,4)`; migration additive
- `packages/contracts/src/accounting-documents.ts`: `CreatePaymentDto.whtAmount?`, PaymentDto/allocation response + field
- `accounting-money.dtos.ts`: validator (+spec ไฟล์เดิม `accounting-money.dtos.spec.ts`)

### 2.2 Logic + use-case + repository

- `accounting-money-validation.logic.ts`: ขยาย `validateAccountingPaymentMoneyInput` (whtAmount รูปแบบเงิน ≥0; wht>0 ⇒ RECEIVED + allocateToDocumentId) และ `validateAccountingPaymentAllocation` (cash+wht ≤ outstanding 2dp exact) (+spec เดิม)
- `payment.use-case.ts`: ส่งผ่าน field; audit/outbox metadata + whtAmount
- `prisma-accounting.repository.ts`:
  - `createPayment`: applied = amount+wht (wht>0 ห้าม clamp), **re-read outstanding ใน tx แล้ว throw เมื่อเกิน** (spec §7.2 — กัน race over-settle; เพิ่ม test แนว `prisma-accounting.repository.atomic-issue.spec.ts`), `paidAmount += applied`, allocation {amount: cash, whtAmount}, `calculateUnappliedCredit(amount, allocatedCash)` เดิม
  - `voidPaymentTrueReversal`: restore `paid −= (alloc.amount + (alloc.whtAmount ?? 0))` (+`prisma-accounting.repository.void.spec.ts`)
- `sumReceivedPaymentsByCounterparty`: Σ(amount + whtAmount) (+spec เดิมของ use-case)

### 2.3 Posting

- `buildAccountingPaymentPostingSource`: `totalAmount = amount + whtAmount`, `whtTotal = whtAmount` (+`payment-posting-source.use-case.spec.ts`)
- `posting-engine.logic.ts` branch `accounting.payment.received`: Dr Cash total−wht / Dr `WHT_RECEIVABLE` wht / Cr AR total; rule path ใช้ 1.4 (received → DEBIT) — เพิ่มเคสใน spec posting

### 2.4 Web

- `AccountingPages.tsx` ฟอร์มสร้างเอกสาร: ช่อง "หัก ณ ที่จ่าย (%)" → `lines[0].whtRate`; แสดงสุทธิหลังหักเมื่อ >0
- ฟอร์มรับชำระ: ช่อง "ถูกหัก ณ ที่จ่าย" (prefill doc.whtAmount เมื่อ paidAmount=0), ส่ง `whtAmount`; ปุ่ม disable เมื่อ cash+wht > outstanding
- `accounting-documents.model.ts`/api types

### 2.5 Verify

ชุดคำสั่งเดียวกับ 1.8 + e2e `accounting.spec.ts` scenario B1 ถ้ารันได้; สรุปตัวเลข A1/B1 ให้ตรง spec §10 แบบ assert จริงใน unit test อย่างน้อยหนึ่งจุดต่อ scenario กลุ่ม A(1,3,4), B(1,3,5), C(1)

---

## Phase 3 — ปิดงานเอกสาร

- อัปเดต `docs/specs/accounting-tax-readiness-assessment.md`: RA-20 → ปิดฝั่ง payment seam (อ้าง spec นี้ + commit), RA-22 → ปิดบางส่วน (settlement+GL ได้, CIT report ยังค้าง)
- `docs/plans/master-implementation-checklist.md`: Reorder Log entry ชี้ spec/plan นี้ (เพิ่มแล้วตอน planning — อัปเดตสถานะตอน implement เสร็จ)
- memory: สถานะ + verification evidence + ราย scenario ที่ยังไม่ได้รันจริงพร้อมเหตุผล
- Deploy note จาก spec §11: query audit `whtAmount > 0` payments ก่อน deploy

## การตัดสินใจที่ล็อกแล้ว (อย่ารื้อโดยไม่บันทึก)

1. alloc.amount = ยอดตัดหนี้ (รวม WHT); เงินสดอยู่ที่ header net/amount — เพราะ bank rec + PP36 proration + void restore ทั้งหมดพึ่งความหมายนี้พอดีโดยแก้โค้ดน้อยสุด
2. WHT ไม่เป็น `TaxComponentKey` รอบนี้ — ใช้ `whtTotal` + posting rule field เดียว; ทางเลือก component-based บันทึกไว้ใน spec §8 สำหรับอนาคต
3. formType มาจาก supplierType ไม่ใช่หมวด — กติกาเดียวกับ RA-18 ฝั่ง expense, หมวดเป็น metadata
4. ฐานเงินได้ derive จาก wht÷rate ไม่ใช่ gross payment (gross รวม VAT) และไม่ prorate จากบิล — เพราะบังคับกรอก rate เมื่อ wht>0 ทำให้ฐานถูกเสมอ
5. ไม่แตะ TH SME catalog (checksum machinery) — บัญชีภาษีถูกหักฝั่งรับให้บริษัทเพิ่มเอง/นักบัญชี map ใน posting rule
6. Void ที่มีหนังสือรับรองจริงผูกแล้ว → block ไม่ใช่ auto-cancel — เอกสารกฎหมายภายนอกต้องถูกจัดการก่อน
