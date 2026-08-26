# Agent Memory: mangmee-income-expense-ledger

Status: Spec v1.1 + plan ACTIVE — **Phase 1 (LED-FIN-01) โค้ดเสร็จ 2026-08-26**: `accounting-totals.logic.ts` เป็น decimal.js ROUND_HALF_UP ทั้งไฟล์, จุด float ใน `createPayment` แปลงครบ, `paymentNumber` ออกจาก sequence `accounting.payment` แบบ reserve+commit ใน tx เดียว; golden spec 8 เคส (3 เคสเป็น float tripwire ที่ของเดิมตอบผิดจริง: 57.50×7%→4.03 ไม่ใช่ 4.02, 33.50×3%→1.01, 1.005→1.01) ลงทะเบียนใน test list แล้ว → ต่อไป Phase 2 (หมวดรายรับ)

Owner: thawatchai (Product Owner) + Lead dev 1 คน

Scope:

- ฟีเจอร์ "สมุดรายรับ–รายจ่าย" MVP (P27 ของแผนหลัก — **คิวหลักก่อนสาย P14→P26** ตามคำตอบ Owner ข้อ 1): เอกสารขายเป็นแกนรายรับ (ห่อ `AccountingDocument`/`AccountingPayment` เดิม), รายจ่ายใช้ engine เดิม, หมวดหมู่ 2 ชุด, หน้าสรุป + export, ใบลดหนี้/เพิ่มหนี้แบบ FlowAccount — ไม่ทำธนาคาร/statement/กระทบยอด/Auto Revenue/ภาษียื่น/งบทางการ/สต็อก
- หลักฐานโค้ดจาก `develop` @ `beb0c5f6`; หลักฐาน FlowAccount จากบัญชีทดสอบ Owner (`advance.flowaccount.com/N9355777`, read-only, 2026-08-26)

Decisions:

- คำตอบ Owner §9 (2026-08-26): 1=P27 ก่อน billing, 2=auto-RECEIPT ทุกครั้ง, 3=ซ่อน VAT บริษัทไม่จด, 4=ใบลดหนี้เลียนแบบ FlowAccount, 5=ใช้ pattern ตาราง mapping taxcode เดิม ([expense-category-default-tax-code-spec](../specs/expense-category-default-tax-code-spec.md) v1.1 Implemented — external code ไม่มี FK; ค่า default หมวดรายรับ = null จนยืนยันกับ tax-2026-verified-rules), 6=ยืนยันชุดคำ 6 ตัวเลข
- ไม่สร้างตารางรายรับแยก (REVENUE-02); invariant "รับชำระไม่ลงรายได้/VAT ซ้ำ" โค้ดบังคับแล้ว ห้าม regression
- V1: `counterpartyId` nullable จริงทุกชั้น → **ไม่สร้าง row "ลูกค้าเงินสด"** (ไม่มี unique fence กันซ้ำ); UI ใช้ label "ลูกค้าทั่วไป (ขายเงินสด)"; payment/เอกสารต้อง match counterparty (null↔null ผ่าน)
- V6: **ห้าม chain use-case เดิม** → `recordSimpleIncomeBundle` repository method เดียว (Serializable tx + advisory lock + `reserveNumberInTransaction`/`commitNumberInTransaction` + tax snapshot db param + audit ผ่าน tx) ตามแบบ `submitDraftAtomic` ของ reimbursements
- V3: RECEIPT ตั้ง `sourceDocumentId` ได้ (engine ตรวจ existence เท่านั้น) → auto-receipt ใน bundle; `taxInvoiceId` เป็น dead metadata
- F-LED-6 (FlowAccount findings): CN มี 2 ทางสร้าง (แยก/อ้างใบกำกับภาษี), สาเหตุบังคับตามรายการกฎหมาย 2 กลุ่ม, โมเดลมูลค่าเดิม→ถูกต้อง→ผลต่าง, ขายเงินสด = "ใบเสร็จรับเงิน (เงินสด)" ใบเดียวเลขชุด CA- → เรา: ขยาย CN/DN ให้อ้าง INVOICE ที่ issue แล้วได้ + M5 (`adjustmentReasonCode/Text`) + prefill จาก source; **ไม่ทำ CN แบบไม่อ้างเอกสารใน MVP**; รายการสาเหตุต้องตรวจกับต้นทางกรมสรรพากรก่อน copy
- หมวดรายรับ `RevenueCategory` company-scoped เท่านั้น (เลี่ยงบั๊ก NULL-distinct ฝั่ง expense); STOP-SHIP = LED-FIN-01 (float ใน `accounting-totals.logic.ts`); gap ใหม่ LED-FIN-05 (AI sales summary ไม่นับ payment ไม่มีลูกค้า — ปรับใน Phase 4)
- เปิดแบบ per-company allowlist: `PUT /v1/system/partners/:id/features` (V5 — CAS + normalization gate; off/on/off มี test พิสูจน์ epoch bump)

Open questions: — (ไม่มี; ทุกข้อปิดแล้ว)

Artifacts:

- `docs/specs/mangmee-income-expense-ledger-spec-th.md` v1.1 (คำตอบ §9 + ผล V1–V6 + F-LED-6 + M5/M6 + LED-FIN-05)
- `docs/plans/mangmee-income-expense-ledger-plan-th.md` ACTIVE (~9.5 วัน; Phase 0 ปิด; Phase 3 รวม bundle + CN/DN)
- `docs/plans/mangmee-brain-2-5-day-priority-plan-th.md` P27 + §10/§11 อัปเดตคิวตัดสินแล้ว
- PR #245 (docs ชุดแรก merged); PR ถัดไป = ชุดคำตอบ+Phase 0 นี้

Verification:

- หลักฐานโค้ดทุกข้อมี file:line จาก Explore agents (2026-08-26); FlowAccount ตรวจ read-only ไม่มี mutation ใด ๆ (ไม่กดบันทึกเอกสาร/ไม่รับ cookie banner แทนผู้ใช้)
- Phase 1 (branch `codex/ledger-p1-decimal`): specs ทั้ง module accounting-documents ผ่าน 144/144 (61+83 รวม golden ใหม่ 8 และ `spec-suite-coverage` guard); `tsc --noEmit` apps/api เงียบ; เอกสารเดิมไม่ถูกกระทบ — totals คำนวณเฉพาะตอน create/update draft ไม่มี migration/rewrite แถวเดิม และ `sales_documents` ปิด default ทุก env (DB seeded local ไม่ได้รัน จึงไม่มี count query — บันทึกตามจริง); ไม่มี spec เดิม exercise `createPayment` ตรง ๆ → เคส in-tx numbering คุมด้วย E2E LED-02 ใน Phase 6

Next:

1. PR Phase 1 เข้า develop + admin merge
2. Phase 2: `RevenueCategory` model→API→UI→bootstrap 6 หมวด (M1, M2)
3. ไล่ Phase 3→6 ตามแผน; รายงานผลต่อ Owner ราย phase
4. หมายเหตุข้ามงาน: PR #238 (release รอบก่อน develop→main) CI เขียวครบ ยังรอ Owner approve+merge → แล้วผม dispatch UAT ตาม runbook
