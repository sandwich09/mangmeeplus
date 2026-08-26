# Agent Memory: mangmee-purchase-to-pay (P28)

Status: Spec + plan เขียนเสร็จ (DRAFT) 2026-08-26 — **รอ Owner ตอบ spec §10 (5 ข้อ) ก่อนเริ่ม Phase 0**; ยังไม่มีการแก้โค้ด; คิวแนะนำ = หลัง P27 จบ

Owner: thawatchai (Product Owner) + Lead dev 1 คน

Scope:

- P28 = FlowAccount parity ฝั่งซื้อ-จ่ายเงิน (คำสั่ง Owner 2026-08-26 รอบสาม): journey PO→GR→บิล→จ่าย + **ใบลดหนี้ฝั่งซื้อ (SupplierCreditNote — สั่งเจาะจง)** + รวมเข้าสมุดรายรับ–รายจ่าย + เปิดแบบควบคุม
- หน้าจอทั้งหมดต้องทำ spec/design ก่อน (คำสั่ง Owner) → อยู่ใน spec §7 (S1–S5 ตามกติกา F-LED-7)

Decisions:

- Spec เป็น **slice UX + ส่วนต่อขยาย** อ้าง canonical engine spec เดิม (`procurement-supplier-ap-spec.md` 1,469 บรรทัด item 12 ปิด 2026-06-30) — ไม่เขียน engine ซ้ำ
- Current truth สำคัญ (สำรวจลึก 2026-08-26): engine ครบสาย + maker-checker/2-3-way match/tax snapshot 2 จังหวะ/PP36/void true-reversal; web มี 2 hub (~1,977 บรรทัด) `status: 'ready'` แต่**ถูกกรองจาก nav โดย `DESIGN_HANDOFF_NAV_ORDER` (P4.6)**; `procurement` ไม่อยู่ใน default entitlement (บริษัทใหม่ explicit-false); gate `procurement/DEFAULT` seeded OPEN
- **ใบลดหนี้ฝั่งซื้อไม่มีทั้งหมด แต่ตะขอฝังรอแล้ว**: `VendorBillStatus.CREDITED` + transition `APPROVED→CREDITED` (`procurement.logic.ts:157`) ไม่มีผู้เขียน, tax sync/reconciliation นับ `CREDITED` เป็น finalized แล้ว (`expense-source.adapter.ts:90`), context `RETURN_OR_CREDIT`/`DEBIT_ADJUSTMENT` มี enum (ฝั่งขายใช้แล้ว), memory item-12 จอด "supplier credit" เป็น backlog — P28 คือการปลดจอด
- ข้อจำกัด engine ที่ CN ต้องเคารพ: payment path รับเฉพาะ APPROVED/PARTIALLY_PAID ยอดบวก clamp ศูนย์ (`prisma-procurement.repository.ts:1378-1399`) → CN มี settle path ของตัวเอง; void บิลบังคับ `paidAmount: 0` → บิลจ่ายแล้วแก้ได้ด้วย CN เท่านั้น; จ่ายห้าม overpayment → CN เกินยอดค้าง = เครดิตค้างกับผู้ขาย (MVP: บันทึก+โชว์ statement, auto-หัก/รับเงินคืน = คำถาม Owner)
- CN design: model ใหม่อ้าง `vendorBillId` บังคับ (source-first), เลข seq ใหม่ `procurement.supplier_credit_note`, dedupe `[companyId, supplierId, supplierDocumentNumber]`, สาเหตุชุดกฎหมายเดียวกับ F-LED-6, maker-checker เดียวกับบิล, PP36/IMPORT_SERVICE → refuse ใน MVP
- `updateVendorBillPaid` = dead code ห้ามปลุก (memory procurement-satang-rounding)

Open questions (spec §10 — Owner):

1. คิว P28 หลัง P27 จบ (แนะนำ) หรือสลับ
2. นโยบายเครดิตค้างกับผู้ขาย (MVP โชว์+หักมือ vs auto-หัก/รับเงินคืน)
3. ใบเพิ่มหนี้ฝั่งซื้อ คิวถัดไป (แนะนำ) หรือทำพร้อม (+1 วัน)
4. two-step payment release คง backlog หรือยกเข้ารอบนี้ (+1.5 วัน)
5. ธุรกิจนำร่องใช้สต็อกไหม (จูน S1)

Artifacts:

- `docs/specs/mangmee-purchase-to-pay-mvp-spec-th.md` (ใหม่)
- `docs/plans/mangmee-purchase-to-pay-mvp-plan-th.md` ฉบับเต็มตามเดิม (6 phases ~10.5 วัน); คิวรวมสองฝั่ง = สารบัญ `docs/plans/mangmee-flowaccount-parity-plan-th.md` (Owner 2026-08-26: รวมแค่หัวข้อ+ลิงก์กลับ); §10 ข้อ 1 (คิว) ตอบแล้ว — เหลือข้อ 2–5
- แผนหลัก: P28 section + spec-coverage matrix → ✅

Verification:

- Docs-only; ทุกข้อเท็จจริงมี file:line จาก Explore deep-dive 2026-08-26 (models/state machines/maker-checker/tax/void/web/entitlement/launch/tests); ข้อที่ยังไม่แน่ = Phase 0 W1–W5 ไม่เดา

Next:

1. PR docs เข้า develop + admin merge
2. รายงาน Owner + รอคำตอบ §10
3. คิวเขียน spec ที่ขาดตัวถัดไปตาม matrix: P26 billing → P10+P11 → P12 → P13
