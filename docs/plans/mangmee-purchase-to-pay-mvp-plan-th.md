# แผนพัฒนา ซื้อและจ่ายเงิน แบบ FlowAccount (P28: Purchase-to-Pay MVP + ใบลดหนี้ฝั่งซื้อ)

สถานะ: **DRAFT รอ Owner ตอบ spec §10 ข้อ 2–5 แล้วจึงเริ่ม Phase 0** (ข้อ 1 เรื่องคิว ตอบแล้ว 2026-08-26)

Spec: [Purchase-to-Pay MVP Spec](../specs/mangmee-purchase-to-pay-mvp-spec-th.md) — แผนนี้ไม่ประกาศข้อเท็จจริงใหม่; engine canonical อยู่ใน [procurement-supplier-ap-spec](../specs/procurement-supplier-ap-spec.md)

ตำแหน่งคิว: **หลัง P27 จบ ต่อทันที (Owner ยืนยัน 2026-08-26 — สาย billing P14→P26 ท้ายคิวสุด)**; คิวรวมสองฝั่งดูที่ [สารบัญแผนรวมมั่งมีพลัส](mangmee-master-plan-index-th.md) (ภาค 2 = แผนนี้)

## 0. คำตอบตรง ๆ เรื่องเวลา (dev 1 คน รวม test)

| Phase | เนื้องาน | ประเมิน |
|---|---|---|
| 0 | ยืนยันสัญญา W1–W5 | 0.5 วัน |
| 1 | SupplierCreditNote engine (model→settle→tax→GL→maker-checker) | 3 วัน |
| 2 | หน้าจอ S4 (CN) + S2 ปรับ (source-first + checklist หลักฐานภาษาคน) | 2 วัน |
| 3 | S1 landing + S3 อนุมัติ/จ่ายรวมหลายบิล | 2 วัน |
| 4 | F-P2P-4 รวมเข้าสมุด + S5 (aging/statement เพิ่มเครดิตค้าง) | 1.5 วัน |
| 5 | เปิดระบบ: nav คืน + submenu wht + entitlement/gate + E2E P2P-01..05 + หลักฐาน | 1.5 วัน |
| รวม | | **~10.5 วันทำงาน** (ตัวเลือก Owner: +ใบเพิ่มหนี้ ~1 วัน, +two-step release ~1.5 วัน) |

ทางลัดที่ตัดได้โดยไม่เสียหลักการ (Owner เลือก): เลื่อน S1 landing ไปหลังเปิด (ใช้ hub เดิมไปก่อน, −1 วัน); เลื่อนจ่ายรวมหลายบิล (จ่ายทีละใบก่อน, −0.5 วัน)

## 1. กติกาการทำงาน

- ponytail full mode + กติกา P27 ทุกข้อ (branch/PR ละ phase, spec ใหม่ลงทะเบียน test list, migration additive + dry-run ก่อน UAT, ห้ามแตะ `updateVendorBillPaid` dead code)
- ทุก phase อัปเดต [task memory](../agent-memory/mangmee-purchase-to-pay.md) + spec-coverage matrix ในแผนหลักเมื่อ spec merge

## Phase 0 — ยืนยันสัญญา (W1–W5) ก่อนเขียนโค้ด

| # | ต้องยืนยัน | วิธี |
|---|---|---|
| W1 | `resolveSourceTaxInTransaction(..., 'INPUT', 'procurement')` รับ context `RETURN_OR_CREDIT` + sign ลบได้จริง (ฝั่งขายใช้ผ่าน accounting-documents — ฝั่ง procurement ยังไม่เคยเรียก) | อ่าน resolver + ทดลอง unit กับ fixture บิลจริง |
| W2 | `SyncTaxEventsUseCase` จะเห็นบรรทัด CN อย่างไร — ผ่าน adapter เดิม (บิล CREDITED) หรือ CN ต้องมี adapter แหล่งใหม่ | อ่าน `expense-source.adapter.ts:86-119` + ตัดสิน schema CN lines |
| W3 | posting source ของ CN: reuse `buildPostingKey`/posting-source pattern บิลด้วย sign ได้ไหม | อ่าน posting-source บิล + ledger journal path |
| W4 | สมุด P27 (Phase 4 ของ P27) จะเสร็จก่อนหรือหลัง — นิยาม "จ่ายแล้ว/รอจ่าย" สองแหล่งต้องแก้ที่ API สมุดจุดเดียว | เทียบตารางเวลา P27 จริง ณ วันเริ่ม |
| W5 | เลข seq `procurement.supplier_credit_note` + purpose ไฟล์แนบใหม่ (`procurement.credit_note.evidence`) ไม่ชนกติกา attachment gate (M6 P27) | อ่าน document-sequence defaults + attachment.logic |

ผล Phase 0 → อัปเดต spec §5/§8 ด้วยคำตอบ (แก้ spec ก่อน ไม่ workaround)

## Phase 1 — SupplierCreditNote engine (spec F-P2P-2)

1. Migration: model + enums + `@@unique([companyId, supplierId, supplierDocumentNumber])` + seq default `PCN-{YYYY}{MM}-{SEQ}`
2. Repository bundle: create draft (+lines+tax DRAFT snapshot) / submit / approve (CAS + checksum pin + dual quota — reuse ตัวช่วย maker-checker เดิม) / apply (settle path ใหม่: ลด outstanding ก่อน → เครดิตค้าง `unappliedAmount`; สถานะบิล → `CREDITED` เมื่อปิดพอดี) / void (ก่อน apply เท่านั้น)
3. Tax: FINAL snapshot ตอน approve (context `RETURN_OR_CREDIT`, sign −1, refuse PP36/IMPORT_SERVICE), งวดล็อก → refuse; sync เข้าทางเดิม (ผล W2)
4. GL: posting source + journal reversal สัดส่วน (ผล W3)
5. Controller `companies/:companyId/accounts-payable/supplier-credit-notes` + permissions ใหม่ (`procurement.supplier_credit_note.read/create/approve/void` — grant กลุ่มเดียวกับ vendor_bill)
6. Tests: transition table, settle ทุกเคส §8.1–8.2 (partial/paid/เพดานสะสม/satang), maker-checker mirror, tax refuse cases, idempotent number+dedupe — ลงทะเบียนครบ

## Phase 2 — หน้าจอ CN + บิล (S4 + S2)

1. S4 ตาม spec §7 เป๊ะ: ปุ่มจากหน้าบิล (ตาม matrix สิทธิ์+สถานะ), prefill แก้ไม่ได้, สาเหตุบังคับ, แถบผล "ลดยอดค้าง/เครดิตค้าง" ก่อนกด, disabled+เหตุผล
2. S2: แปลง checklist `buildTaxReviewIssues` เป็นภาษาคนตามตาราง copy ใน spec, source-first เลือก PO/GR, ปุ่มส่งอนุมัติบอกชื่อกลุ่มผู้อนุมัติ
3. Web unit: gating logic + copy; E2E แท่ง CN (P2P-03/04)

## Phase 3 — S1 landing + S3 จ่ายเงิน

1. S1 การ์ดงานค้าง (query จาก endpoint list เดิม + aging — ไม่มี endpoint ใหม่ถ้าไม่จำเป็น; ถ้าต้องมี summary endpoint ให้ใช้ pattern bounded aggregate ของ P27 T2)
2. S3: กล่องรออนุมัติ + จ่ายรวมหลายบิล (UI บน allocation engine เดิม) + สถานะ 1/2 อนุมัติ
3. nav ภายในหน้า "ซื้อและจ่ายเงิน" → hub เดิมสำหรับ PO/GR/supplier (ไม่ rewrite hub ในรอบนี้)

## Phase 4 — สมุด + รายงาน (F-P2P-4, S5)

1. API สมุด: "จ่ายแล้ว" += SupplierPayment(RECORDED).netPaid; การ์ดใหม่ "รอจ่าย (บิลผู้ขาย)"; ป้ายแหล่งที่มา; อัปเดตตาราง F-LED-4 ใน spec P27 พร้อม PR เดียวกัน
2. S5: aging + statement เพิ่มเครดิตค้าง; แถว CN ในสมุด (ยอดลบ+เหตุผล)
3. Golden: ตัวเลขสมุดสองแหล่ง reconcile + drill ครบ

## Phase 5 — เปิดระบบ + หลักฐาน

1. คืน `procurement`/`accounts-payable` เข้า `DESIGN_HANDOFF_NAV_ORDER` (เฉพาะ entitlement เปิด — ตรรกะ nav เดิมจัดการอยู่แล้ว) + เพิ่ม submenu `procurement.wht_handoff`
2. Kill switch: บังคับ gate `procurement/DEFAULT` ที่ root สร้าง PR/PO/GR/บิล/CN (pattern `assertExpenseRootOpen` + Thai copy + DENIED audit)
3. เปิด allowlist ผ่าน partner features (CAS/normalization ตาม V5 ของ P27)
4. E2E P2P-01..05 เข้า project critical + รัน suite ที่แตะทั้งหมด + evidence (SHA/ผลรัน/นิยามตัวเลข) + usability 40+ 3 คน (ต้องมนุษย์)

## 2. ความเสี่ยงและทางถอย

- **W1/W2 ไม่ผ่าน** (resolver/sync ไม่รองรับฝั่งซื้อ sign ลบ): ทางถอย = tax event ผ่าน adapter แหล่งใหม่เฉพาะ CN (pattern `tax.pp36_input_claim` ที่เขียน event ตรงแบบ idempotent) — ช้าลง ~1 วัน ไม่เปลี่ยน UX
- **เครดิตค้างสับสนผู้ใช้**: MVP โชว์เฉพาะใน statement + aging พร้อมคำอธิบาย; ไม่มี auto-หัก จนพฤติกรรมจริงชัด
- Kill switch พร้อม: CLOSE `procurement/DEFAULT` → หยุดรับงานใหม่ทั้งฝั่งซื้อ ภายใน 15 นาที

## 3. สิ่งที่แผนนี้ไม่สัญญา

- ไม่แตะ P27 Phase 3–6 (คนละคิว — ยกเว้น F-P2P-4 ที่แก้ API สมุดหลัง P27 Phase 4 เสร็จ)
- ไม่เปิด production จนกว่า gate §9 ของ spec ผ่าน + Owner GO ตาม release protocol
