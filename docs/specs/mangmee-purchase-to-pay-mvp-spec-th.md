# ซื้อและจ่ายเงิน แบบ FlowAccount (Purchase-to-Pay MVP + ใบลดหนี้ฝั่งซื้อ) — Spec P28

สถานะ: **DRAFT รอ Owner ตอบคำถาม §10 ข้อ 2–5 ก่อนเริ่ม coding (docs-first)** — ข้อ 1 (คิว) ตอบแล้ว 2026-08-26: ต่อจาก P27 ทันที

ที่มา: คำสั่ง Owner 2026-08-26 — "แบบ FlowAccount ต้องได้ทั้งฝั่งจ่ายและซื้อทั้งหมด", "หน้าจอใช้งาน ให้ทำ spec design plan ให้เรียบร้อยก่อน, ทำอันนี้ด้วยใบลดหนี้ฝั่งซื้อ (รับจากผู้ขาย)"

หลักฐานโค้ดอ้างอิง `develop` @ หลัง PR #253 (สำรวจเชิงลึก 2026-08-26)

เอกสารแม่ (spec นี้เป็น **slice UX + ส่วนต่อขยาย** ไม่เขียน engine ซ้ำ):

- [Procurement / Supplier / AP Spec](procurement-supplier-ap-spec.md) (1,469 บรรทัด — canonical engine spec, item 12 ปิด 2026-06-30) + [plan](../plans/procurement-supplier-ap-plan.md)
- [Income–Expense Ledger Spec](mangmee-income-expense-ledger-spec-th.md) — กติกา UI §F-LED-7 ใช้บังคับทุกหน้าจอของ spec นี้ และสมุดที่ P2P ต้องเข้าไปรวม
- [SAP-compatible transaction tax spec](sap-compatible-transaction-tax-account-determination-spec.md) — ชั้นภาษีที่ vendor bill ใช้อยู่
- [ผลสำรวจ FlowAccount](../research/flowaccount-accounting-product-audit-2026-08-26-th.md) §7 (PO/GR/expense/ใบเตรียมจ่าย/2-3-way match)
- Agent memories ที่ผูกงานนี้: `item-12-procurement-ap-review` (จอด supplier credit เป็น backlog — งานนี้คือการปลดจอด), `h-04-vendor-bill-void-true-reversal`, `h-07-vendor-bill-maker-checker`, `procurement-satang-rounding`
- แผนส่งมอบ: [Purchase-to-Pay MVP Plan](../plans/mangmee-purchase-to-pay-mvp-plan-th.md); คิวรวมสองฝั่ง: [สารบัญแผนรวม FlowAccount Parity](../plans/mangmee-flowaccount-parity-plan-th.md)

## 1. เป้าหมาย

ผู้ใช้ 40+ ทำครบวงจรซื้อ→จ่ายบนมือถือโดยไม่รู้ศัพท์บัญชี — FlowAccount parity ฝั่งซื้อ:

```text
สั่งซื้อ (PO) → รับของ (ตัดเข้าสต็อก) → บันทึกบิลผู้ขาย (2-way/3-way match)
  → เตรียมจ่าย/จ่ายเงิน (หัก ณ ที่จ่าย + 50 ทวิ) → เห็นใน "สมุดรายรับ–รายจ่าย"
ของไม่ตรง/คืนของ/ผู้ขายลดราคา → บันทึกใบลดหนี้ที่ได้รับจากผู้ขาย → ยอดค้างจ่ายและภาษีซื้อถูกต้อง
```

กติกาภาษา: เหมือน P27 — ภาษาธุรกิจล้วน ("รอจ่าย", "จ่ายแล้ว", "บิลไม่ตรงกับของที่รับ") ไม่มี raw code/สถานะอังกฤษโผล่หน้าจอ

## 2. หลักการที่ห้ามละเมิด

1. **ใช้ engine เดิมทั้งหมด** — ห้ามสร้าง path เงิน/ภาษี/อนุมัติคู่ขนาน; ทุกการแก้เป็น additive
2. **Maker-checker คงเดิมทุกข้อ**: ผู้ส่งบิลอนุมัติเองไม่ได้ (`vendor_bill_self_approval_blocked` — `vendor-bill.use-case.ts:465-467`), dual approval เกิน threshold, การอนุมัติ pin กับ `vendorBillTaxSourceChecksum`, submitter ถูกหักออกจากโควตาเสมอ — **ใบลดหนี้ฝั่งซื้อต้องเข้า pipeline เดียวกันนี้**
3. **Tax evidence gate ห้าม bypass**: submit/approve บิลติด `vendor_bill_tax_evidence_blocked` จนหลักฐานครบ (`assertVendorBillTaxEvidenceReady`) — CN ฝั่งซื้อที่แตะ VAT ใช้เกณฑ์เดียวกัน
4. เงินเป็น decimal เสมอ (`procurement.logic.ts` มี `SETTLE_EPSILON` ของตัวเองที่ :25 และ path เงินสดใช้อยู่แล้ว)
5. UI ตามกติกา [F-LED-7](mangmee-income-expense-ledger-spec-th.md) ทุกข้อ: theme เดิม, mobile-first 390px, action-gating "ไม่มีปุ่มพาไปตาย", source-first ห้ามฟอร์มเปล่าสำหรับเอกสารแก้ยอด

## 3. Current truth (สำรวจ 2026-08-26)

### 3.1 Engine — มีครบและแข็งกว่าที่ประเมินครั้งแรก

| ส่วน | หลักฐาน |
|---|---|
| Models ครบสาย: `SupplierProfile`(+bank), `PurchaseRequest`, `PurchaseOrder`(นับ received/billed/outstanding), `GoodsReceipt`(ผูก PO บังคับ), `VendorBill`(paid/outstanding + dedupe `[companyId, supplierId, supplierDocumentNumber]`), `VendorBillMatch`, `SupplierPayment`(+allocation many-to-many, idempotencyKey unique), `PurchaseApprovalEvent`, `ProcurementApprovalPolicy` | `schema.prisma:4173-4817` |
| สถานะ VendorBill: `DRAFT NEEDS_REVIEW PENDING_APPROVAL APPROVED PARTIALLY_PAID PAID VOIDED CREDITED` — **`CREDITED` มีใน enum และ transition `APPROVED→CREDITED` เปิดไว้แล้ว แต่ไม่มีโค้ดใดเขียนถึง** | `schema.prisma:4111-4120`; `procurement.logic.ts:153-167` |
| Maker-checker เต็มรูป (submit event ก่อนเปลี่ยนสถานะ, self-approval exempt OWNER/ADMin/MANAGER ตาม product decision 2026-07-18, dual approval + checksum pin, re-derive ใน Serializable CAS) | `vendor-bill.use-case.ts:407-561`; memory `h-07` |
| 2-way/3-way match + override (`PurchaseMatchingMode NONE/TWO_WAY/THREE_WAY`, tolerance เริ่มที่ศูนย์ตาม owner decision 2026-06-23, override ต้องสิทธิ์+เหตุผล) | `schema.prisma:4136`; route `POST :id/match/override` |
| Tax ต่อบรรทัดเต็ม SAP-style (treatment/claimability/snapshot 2 จังหวะ DRAFT→FINAL, `IMPORT_SERVICE` รับรู้ตอนจ่ายเท่านั้น), PP36 ครบทั้ง output ตอนจ่าย + input claim release | `schema.prisma:4630-4654`; `vendor-bill.use-case.ts:161-209,540-561`; `pp36-input-claim.use-case.ts` |
| จ่ายเงิน: allocation ต้องเท่า gross เป๊ะ (ไม่มี overpayment/unapplied โดยตั้งใจ), WHT กันหักซ้ำ, ต้องมี 2 สิทธิ์ `create`+`release` ในคนเดียว (split จริงเป็น backlog), void จ่ายคืนยอดถูกต้อง | `supplier-payment.use-case.ts:37-206`; `prisma-procurement.repository.ts:1363-1652` |
| Void บิล = true reversal GL (CAS บังคับ `paidAmount: 0`), void รับของ = ย้อน stock + PO counter (กันติดลบด้วย advisory lock) | `prisma-procurement.repository.ts:1216-1284,786-858`; memory `h-04` |
| รับของตัดสต็อกจริงใน tx เดียวกัน (`STOCK_IN` ต่อบรรทัด + back-link) | `prisma-procurement.repository.ts:760-767` |
| รายงาน: AP aging + supplier statement + WHT handoff | routes `GET aging`, `GET suppliers/:id/statement` |
| Tests: api 19 spec files + web 4 + E2E `procurement.spec.ts`/`accounts-payable.spec.ts` | รายชื่อในแผน |

### 3.2 Web — มี 2 hub ใหญ่ ใช้งานได้ แต่ยังไม่ใช่ journey 40+

| ข้อเท็จจริง | หลักฐาน |
|---|---|
| `ProcurementHubPage` (แท็บ suppliers/pr/po/gr) + `AccountsPayableHubPage` (แท็บ bills/payments/wht/aging) รวม ~1,977 บรรทัด | `apps/web/src/features/procurement/`, `apps/web/src/features/accounts-payable/` |
| ทั้งสอง module ประกาศ `status: 'ready'` ใน registry พร้อม deep-link targets | `web-core-workspace.constants.ts:111-130,230-247` |
| **แต่ถูกกรองออกจาก nav เปิดตัว**: `DESIGN_HANDOFF_NAV_ORDER` (P4.6) ไม่มี `procurement`/`accounts-payable` → เข้าได้ทาง URL เท่านั้น | `WorkspaceLayout.tsx:32-50` |
| **ไม่มี detail route เลย** — ไม่มี `/new`, `/[id]`; ทุกอย่างอยู่ใน hub เดียวต่อฝั่ง (สร้างเอกสารจากฟอร์มใน hub) | มีแค่ `procurement/page.tsx` + `accounts-payable/page.tsx` |
| Entitlement: parent `procurement` + 7 submenus (**แท็บ `wht` ไม่มี submenu map**) — **ไม่อยู่ใน default**: บริษัทใหม่ถูกเขียน `enabled: false` ทุก key ต้องให้ platform เปิด | `feature-entitlements.ts:166-257`; `feature-registry.ts:27-40`; `create-company-onboarding.use-case.ts:296` |
| Launch gate `procurement/DEFAULT` seeded `OPEN` (แถวเดียว); runoff 60 แถว/BLOCKED 7 (เป็น survey record หลัง freeze 2026-08-04) | `launch-matrix.catalog.ts:118-126`; `runoff-matrix.catalog.ts:76` |

### 3.3 ใบลดหนี้ฝั่งซื้อ — ไม่มีจริง แต่ตะขอรองรับฝังไว้แล้ว

- **ไม่มีทั้งหมด**: model / use-case / route / permission / test / doc ใด ๆ (ค้นทั้ง module แล้ว); memory item-12 จอดไว้เป็น backlog ชัดเจน
- **ตะขอที่มีแล้ว (ทำให้งานเล็กลงมาก)**: `VendorBillStatus.CREDITED` + transition `APPROVED→CREDITED` เปิดรอ; tax sync นับบิล `CREDITED` เป็น finalized แล้ว (`expense-source.adapter.ts:90`, `transaction-tax-reconciliation.use-case.ts:74`); `TransactionTaxContext.RETURN_OR_CREDIT`/`DEBIT_ADJUSTMENT` มี enum รอ (ฝั่งขายใช้แล้ว); prior art ฝั่งขายครบ (CN/DN + `validateCumulativeCreditNote` + reason codes ตามกฎหมายจาก F-LED-6)
- **ข้อจำกัดที่ออกแบบต้องเคารพ**: path จ่ายเงินรับเฉพาะ `APPROVED/PARTIALLY_PAID` ยอดบวก และ clamp ที่ศูนย์ (`prisma-procurement.repository.ts:1378-1399`) → CN ต้องมี settle path ของตัวเอง; void บิลบังคับ `paidAmount: 0` → บิลที่จ่ายบางส่วน/หมดแล้ว แก้ได้ด้วย CN เท่านั้น (นี่คือเหตุผลเชิงระบบว่าทำไมต้องมี CN); จ่ายเงินห้าม overpayment/unapplied → CN ที่ทำให้เกิด "ผู้ขายติดเงินเรา" ต้องนิยามนโยบายใหม่ (คำถาม Owner §10)

## 4. Gap register

| ID | ปัญหา | ผล |
|---|---|---|
| P2P-01 | ใบลดหนี้ฝั่งซื้อไม่มี (บิลที่จ่ายแล้วแก้ไม่ได้เลย — void ก็ติด `paidAmount: 0`) | STOP-SHIP ของ P28 — F-P2P-2 |
| P2P-02 | nav เปิดตัวกรอง procurement/AP ออก ทั้งที่ module `ready` | งานเปิดระบบ F-P2P-5 |
| P2P-03 | hub อย่างเดียว ไม่มี journey/detail routes — ไม่ผ่านหลัก F-LED-7 (ฟอร์มทุกอย่างกองในหน้าเดียว) | งานหน้าจอ §7 |
| P2P-04 | แท็บ `wht` ของ AP ไม่มี entitlement submenu | เก็บใน F-P2P-5 |
| P2P-05 | จ่ายเงินต้องถือ `create`+`release` พร้อมกันในคนเดียว (two-step release = backlog เดิม) | บันทึกไว้ — ไม่แก้ใน MVP นี้ (คำถาม Owner §10 ข้อ 4) |
| P2P-06 | vendor bill/supplier payment ยังไม่เข้าสมุดรายรับ–รายจ่าย (P27 นับเฉพาะ `ExpenseRecord`) — เงินจ่ายจริงของธุรกิจซื้อขายจะหายจากสมุด | F-P2P-4 |
| P2P-07 | `updateVendorBillPaid` เป็น dead code (บันทึกใน memory satang) — CN ห้ามไปปลุกใช้ | กติกา implement |

## 5. ขอบเขต MVP (F-P2P-1..5)

### F-P2P-1 Journey ซื้อ→จ่าย ใช้ง่าย (จัดของเดิม ไม่เขียน engine ใหม่)

- หน้า "ซื้อและจ่ายเงิน" ใหม่เป็นทางเข้าเดียว (แทนที่ผู้ใช้ต้องรู้จัก 2 hub): การ์ดงานค้างเรียงตามที่ต้องทำ — "บิลรอตรวจ (N)", "รออนุมัติ (N)", "ถึงกำหนดจ่ายสัปดาห์นี้ (N/฿X)", "ของถึงแล้วยังไม่ลงบิล (N)" + CTA หลัก "บันทึกบิลผู้ขาย"
- เส้นทางเต็ม PO→GR→บิล ยังอยู่ใน hub เดิม (ผู้ใช้ขั้นสูง/ธุรกิจสต็อก); เส้นทางง่ายสำหรับบิลบริการ = direct vendor bill (สิทธิ์ `direct_entry` มีแล้ว)
- ทุกจุดใช้ engine/route เดิม 100% — งานคือ UI + query งานค้าง

### F-P2P-2 ใบลดหนี้ฝั่งซื้อ (SupplierCreditNote) — หัวใจของ P28

Model ใหม่ (additive; กระจกจากฝั่งขาย + กติกา procurement):

```prisma
SupplierCreditNote {
  companyId, creditNoteNumber (seq ใหม่ 'procurement.supplier_credit_note'),
  supplierId, vendorBillId (บังคับ — source-first เสมอ),
  supplierDocumentNumber?, supplierDocumentDate?,   // เลข/วันที่ใบลดหนี้จริงจากผู้ขาย
  adjustmentReasonCode + adjustmentReasonText?,      // ชุดสาเหตุกฎหมายเดียวกับ F-LED-6 (มุมผู้ซื้อ)
  status: DRAFT → PENDING_APPROVAL → APPROVED → APPLIED | REJECTED→DRAFT | VOIDED,
  เงิน: subtotal/vat/wht?/grandTotal + มูลค่าตามบิลเดิม→ที่ถูกต้อง→ผลต่าง (โมเดลเดียวกับ FlowAccount),
  lines อ้าง vendorBillLineId + tax snapshot ชุดเดียวกับบิล (context RETURN_OR_CREDIT, sign -1)
  @@unique([companyId, supplierId, supplierDocumentNumber])  // กันคีย์ใบเดียวกันซ้ำ แบบเดียวกับบิล
}
```

กติกาบังคับ:

1. **Source-first**: สร้างได้จากบิล `APPROVED/PARTIALLY_PAID/PAID` เท่านั้น + prefill มูลค่าตามบิลเดิม; เพดานสะสม: Σ CN ของบิล ≤ ยอดบิล (กระจก `validateCumulativeCreditNote` ฝั่งขาย)
2. **Maker-checker ชุดเดียวกับบิล**: ผู้สร้างอนุมัติเองไม่ได้ + dual threshold เดียวกัน + audit `PurchaseApprovalEvent` (sourceType ใหม่ `SUPPLIER_CREDIT_NOTE`)
3. **ผล AP เมื่อ approve → apply** (settle path ใหม่ของ CN เอง — ห้ามใช้ path จ่ายเงิน):
   - ลด `outstandingAmount` ของบิลก่อน (เท่าที่มี); บิลเป็นศูนย์ทั้งค้างและ CN ปิดพอดี → status บิล `CREDITED` (transition ที่รอไว้) หรือคงสถานะจ่ายเดิมถ้าลดบางส่วน
   - ส่วนของ CN ที่เกินยอดค้าง (บิลจ่ายไปแล้ว) = **เครดิตค้างกับผู้ขาย** — MVP บันทึกเป็นยอด `unappliedAmount` บน CN + โชว์ในหน้า supplier statement เพื่อไปหักบิลถัดไปด้วยมือ; การหักอัตโนมัติ/รับเงินคืน = นโยบายที่ Owner ต้องตอบ (§10 ข้อ 2)
4. **ภาษีซื้อ**: บรรทัด CN สร้าง tax snapshot context `RETURN_OR_CREDIT` sign ลบ → เข้าทาง `SyncTaxEventsUseCase` เดิม (ฟิลเตอร์รองรับ `CREDITED` แล้ว) ลด input VAT ตามงวด; ติด PP30 lock เดียวกับ void (`tax_period_locked`); ห้ามแตะบรรทัด `IMPORT_SERVICE/PP36` ใน MVP (นโยบายรับรู้ตอนจ่าย ซับซ้อนกว่า — refuse พร้อมข้อความชัด)
5. **GL**: posting source ของ CN = reversal สัดส่วนตามบรรทัด (pattern posting source บิล + sign) ผ่าน journal generation เดิม
6. หลักฐาน: แนบไฟล์ใบลดหนี้ผู้ขาย (purpose ใหม่ต่อจากที่ M6 ของ P27 เปิด seam ไว้), evidence gate แบบบิลเมื่อมี VAT

### F-P2P-3 หน้าจอทั้งหมด (design — ดู §7)

### F-P2P-4 รวมเข้าสมุดรายรับ–รายจ่าย (แก้ P2P-06)

- "จ่ายแล้ว" ของสมุด (P27 F-LED-4) ขยาย: `Σ ExpensePayment` + `Σ SupplierPayment (RECORDED, netPaidAmount)`; "รอจ่าย" ใหม่: `Σ VendorBill.outstandingAmount (APPROVED/PARTIALLY_PAID)` — ป้ายแยกที่มาให้ผู้ใช้เห็น ("บิลผู้ขาย/ค่าใช้จ่าย")
- Drill ไปหลักฐานต้นทางทั้งสองชนิด; นิยาม deterministic ลง spec สมุด (แก้ตาราง F-LED-4 เมื่อ implement — บันทึกเป็นงานของ plan P28 ไม่แก้ตอนนี้เพื่อไม่ให้ P27 Phase 4 สับสน)

### F-P2P-5 เปิดแบบควบคุม

- คืน `procurement` + `accounts-payable` เข้า nav (ตามลำดับกลุ่ม operate/finance เดิม) เฉพาะบริษัทที่ entitlement เปิด; เพิ่ม submenu `procurement.wht_handoff` ที่ขาด (P2P-04)
- เปิด per-company ผ่าน `PUT /v1/system/partners/:id/features` (กลไก V5 ของ P27); kill switch: gate `procurement/DEFAULT` (OPEN อยู่แล้ว) บังคับใช้ที่ root สร้างเอกสาร + CN ตาม pattern `assertExpenseRootOpen`
- ไม่เข้า `DEFAULT_ENABLED_FEATURE_KEYS` จนผ่าน gate §9

## 6. สิ่งที่ไม่ทำในรอบนี้

- Two-step payment release (preparer/releaser แยกคน) — backlog เดิม (P2P-05)
- หักเครดิตผู้ขายอัตโนมัติข้ามบิล / รับเงินคืนจากผู้ขาย (นโยบายรอ Owner §10 ข้อ 2)
- CN ต่อบรรทัด `IMPORT_SERVICE`/PP36 (refuse ชัดเจน — เฟสภาษี)
- ใบเพิ่มหนี้ฝั่งซื้อ (supplier debit note): โครงเดียวกับ CN, เข้าคิวถัดไปหลัง CN พิสูจน์ตัว — บิลที่ยอดขาดใช้บันทึกบิลใหม่ได้อยู่แล้ว
- Bank/statement matching (P15–P18 ตามแผนหลัก)

## 7. สเปกหน้าจอ (ตามกติกา F-LED-7 ทุกข้อ: theme เดิม, 390px, action-gating, source-first)

### S1 หน้า "ซื้อและจ่ายเงิน" (landing ใหม่)

```text
[หัวข้อ] ซื้อและจ่ายเงิน                     [CTA หลัก ≥56px] + บันทึกบิลผู้ขาย
[การ์ดงานค้าง — เรียงตามความเร่ง กดแล้วไปรายการที่กรองแล้ว]
  🔴 ถึงกำหนดจ่ายสัปดาห์นี้ N รายการ ฿X   🟡 รออนุมัติ N   🔵 ของถึงแล้วยังไม่ลงบิล N   ⚪ บิลรอตรวจหลักฐาน N
[รายการบิลล่าสุด — แถว: ผู้ขาย / เลขบิล / ครบกำหนด / ยอดค้าง / สถานะภาษาไทย]
[ลิงก์รอง: ใบสั่งซื้อ · รับของ · ผู้จำหน่าย · AP Aging]
```
- การ์ดที่ค่า 0 ไม่แสดง (ไม่โชว์ศูนย์หลอก); ผู้ใช้ไม่มีสิทธิ์กลุ่มไหน การ์ด/ลิงก์กลุ่มนั้นหายทั้งก้อน (matrix 7.2 ของ F-LED-7)

### S2 บันทึกบิลผู้ขาย (source-first + direct)

```text
คำถามแรก (2 ปุ่มใหญ่): 「มีใบสั่งซื้อ/รับของแล้ว」 | 「บิลตรง ไม่มีใบสั่งซื้อ」(เฉพาะผู้มีสิทธิ์ direct_entry — ไม่มีสิทธิ์ = ไม่เห็นปุ่ม)
ทางแรก → เลือก PO/GR ค้าง (list พร้อมยอด) → prefill บรรทัด + match อัตโนมัติ → แก้เฉพาะต่าง
ทางสอง → ฟอร์ม: ผู้ขาย (search/สร้างใหม่) → เลขที่/วันที่บิลผู้ขาย → บรรทัด (รายละเอียด+ยอด+VAT ต่อบรรทัดตามกติกา §7.9 ของ P27) → WHT → แนบไฟล์บิล
```
- แถบเงิน sticky: ยอดบิล / VAT / หัก ณ ที่จ่าย / สุทธิที่จะจ่าย
- ปุ่ม "ส่งอนุมัติ" disabled+เหตุผลจน: บรรทัดครบ, หลักฐานภาษีครบ (แสดง checklist จาก `buildTaxReviewIssues` เป็นภาษาคน เช่น "ยังไม่แนบใบกำกับภาษี", "ผู้ขายยังไม่ยืนยันจด VAT"), match ผ่านหรือมี override+เหตุผล
- ผู้ส่งเห็นชัดหลังส่ง: "รอ [ชื่อผู้อนุมัติกลุ่ม] อนุมัติ — คุณอนุมัติเองไม่ได้" (กติกา maker-checker แสดงตรง ๆ ไม่ให้กดแล้วเจอ 403)

### S3 อนุมัติ + จ่ายเงิน

- กล่อง "รออนุมัติ" ของผู้อนุมัติ: การ์ดบิล = ผู้ขาย/ยอด/ครบกำหนด/หลักฐานครบ✓/ผล match✓ + ปุ่ม อนุมัติ/ตีกลับ (เหตุผลบังคับตอนตีกลับ); เกิน threshold โชว์ "ต้องผู้อนุมัติ 2 คน (1/2 แล้ว)"
- จ่ายเงิน (จากบิล APPROVED): Modal ตาม S2 ของ P27 — ยอดจ่าย (default เต็ม), WHT (+เลข 50 ทวิเมื่อ >0), ช่องทาง, วันที่; จ่ายหลายบิลของผู้ขายเดียว = เลือกหลายใบก่อนกด "จ่ายรวม" (allocation ต่อใบโชว์ให้เห็น); ปุ่มยืนยัน disabled จนยอดจัดสรร = ยอดจ่ายพอดี (กติกา engine "ต้องเท่า gross")

### S4 ใบลดหนี้ฝั่งซื้อ (source-first — ไม่มีเมนูสร้างลอย)

```text
เข้าจากหน้าบิล (APPROVED/PARTIALLY_PAID/PAID) ปุ่ม "บันทึกใบลดหนี้จากผู้ขาย"
  → prefill: ผู้ขาย, อ้างอิงบิล, มูลค่าตามบิลเดิม (แก้ไม่ได้)
  → กรอกเลขที่/วันที่ใบลดหนี้ของผู้ขาย + เลือกสาเหตุ (dropdown ชุดกฎหมาย + เหตุอื่นระบุ)
  → เลือกบรรทัดที่ลด/คืน → ระบบคำนวณ มูลค่าที่ถูกต้อง + ผลต่าง สด
  → แถบผล: "ลดยอดค้างจ่าย ฿A" และ/หรือ "เครดิตค้างกับผู้ขาย ฿B (ไว้หักบิลถัดไป)" — บอกก่อนกด ไม่ใช่หลังกด
  → ส่งอนุมัติ (maker-checker เดียวกับบิล) → APPLIED → บิล/สมุด/ภาษีซื้ออัปเดต
```
- ปุ่มบันทึก disabled+เหตุผลจน: เลขที่ใบลดหนี้ผู้ขาย + สาเหตุ + ผลต่าง > 0 + ไม่เกินเพดานสะสม (โชว์เพดานคงเหลือ); บิลมีบรรทัด PP36 → ปุ่มไม่ปรากฏ + คำอธิบายในหน้า ("ใบลดหนี้สำหรับบริการต่างประเทศยังไม่รองรับ")

### S5 สมุดฝั่งจ่าย + Aging

- สมุดรายรับ–รายจ่าย: การ์ด "รอจ่าย" ใหม่ + "จ่ายแล้ว" รวมสองแหล่ง (F-P2P-4) พร้อมป้ายแหล่งที่มา; แถว CN แสดงเป็นยอดลบสีเขียวพร้อมเหตุผล
- AP Aging (มีแล้ว) เพิ่มคอลัมน์เครดิตค้างของผู้ขาย; supplier statement โชว์ CN + เครดิตคงเหลือ

สถานะกลาง (loading/empty/error/forbidden/success) ใช้ตาราง 7.8 ของ F-LED-7 ทุกหน้า

## 8. การเงิน/invariants ที่ต้องมี test

1. Σ(CN applied + payments) ต่อบิล ≤ grandTotal เสมอ; `paid + outstanding + creditedApplied = grandTotal` ภายใน `SETTLE_EPSILON`
2. CN บนบิล `PAID` ไม่แตะ `paidAmount` — สร้างเครดิตค้างเท่านั้น; CN บนบิลค้าง ลด outstanding ก่อน
3. Tax: CN สร้าง tax event ลบผ่าน sync เดิมครั้งเดียว (idempotent); งวด PP30 ล็อก → refuse เหมือน void; PP36 lines → refuse
4. Maker-checker: ผู้สร้าง CN อนุมัติเองไม่ได้ (test กระจก `vendor_bill_self_approval_blocked`), dual threshold ใช้ยอด CN
5. Retry/idempotency: เลขเอกสาร reserve+commit ใน tx (pattern P27 Phase 1); dedupe `[supplierId, supplierDocumentNumber]`
6. สมุด: ตัวเลขรวมสองแหล่ง = drill ได้ครบ 100% (self-check แบบ P27)

## 9. Quality gates ก่อนเปิด

- E2E ใหม่: P2P-01 PO→GR→บิล→อนุมัติ(2คน)→จ่าย→สมุดอัปเดต; P2P-02 direct bill; P2P-03 CN ลดบิลค้าง→ภาษีซื้อ/สมุดถูก; P2P-04 CN บนบิลจ่ายแล้ว→เครดิตค้างโชว์ statement; P2P-05 perm negative (maker-checker/self-approval)
- Usability ผู้ใช้ 40+ ≥3 คน: ลงบิลจากรูป, อนุมัติบนมือถือ, บันทึก CN ที่ได้รับ — บอกผลได้ถูก
- Entitlement off/on/off ไม่ทำข้อมูลเสีย; nav ไม่มีทางไป 403
- คำโฆษณา: "บันทึกซื้อ–จ่าย ครบเอกสารพร้อมหลักฐาน" — ห้าม "AP อัตโนมัติ/กระทบยอดธนาคาร"

## 10. คำถามที่ Owner ต้องตอบก่อนเริ่ม coding

1. ~~**ลำดับ P28 กับงานที่เหลือของ P27**~~ — **ตอบแล้ว (Owner 2026-08-26)**: ทำ P27 ให้จบก่อนแล้ว P28 ต่อทันที (สาย billing P14→P26 โยกไปท้ายคิวสุด) — สะท้อนใน[สารบัญแผนรวม FlowAccount Parity](../plans/mangmee-flowaccount-parity-plan-th.md)
2. **เครดิตค้างกับผู้ขาย** (CN เกินยอดค้าง/บิลจ่ายแล้ว): MVP บันทึก+โชว์ให้หักมือถัดไป (แนะนำ) พอไหม หรือต้องหักบิลถัดไปอัตโนมัติ/บันทึกรับเงินคืนตั้งแต่รอบแรก?
3. **ใบเพิ่มหนี้ฝั่งซื้อ**: เข้าคิวถัดไปหลัง CN (แนะนำ — บิลใหม่ทดแทนได้ระหว่างนี้) หรือทำพร้อมกัน (+~1 วัน)?
4. **Two-step payment release** (คนเตรียมจ่าย ≠ คนปล่อยจ่าย): คงไว้เป็น backlog ตามเดิม หรือยกเข้ารอบนี้ (+~1–1.5 วัน)?
5. ธุรกิจนำร่องของ P28 ใช้สต็อกไหม (ตัดสินว่า S1 เน้นเส้น PO→GR หรือ direct bill เป็นหลัก)?
