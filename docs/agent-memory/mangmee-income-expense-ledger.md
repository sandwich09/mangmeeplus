# Agent Memory: mangmee-income-expense-ledger

Status: Spec + plan เขียนเสร็จ (DRAFT) และ apply เข้าแผนหลักเป็น P27 แล้ว — **รอ Owner review + ตอบ spec §9 ก่อนเริ่ม Phase 0**; ยังไม่มีการแก้โค้ด

Owner: thawatchai (Product Owner) + Lead dev 1 คน

Scope:

- ฟีเจอร์ "สมุดรายรับ–รายจ่าย" MVP ตามการตัดสินใจ Owner 2026-08-26: เอกสารขายเป็นแกนรายรับ (ห่อ `AccountingDocument`/`AccountingPayment` เดิม), รายจ่ายใช้ engine เดิม, หมวดหมู่ 2 ชุด, หน้าสรุป + export — ไม่ทำธนาคาร/statement/กระทบยอด/Auto Revenue/ภาษียื่น/งบทางการ/สต็อก
- Docs เท่านั้นในรอบนี้; หลักฐานโค้ดสำรวจจาก `develop` @ `beb0c5f6` ด้วย Explore agents 3 ชุด (engine ขาย+ชำระ / รายจ่าย+หมวด / patterns)

Decisions:

- ไม่สร้างตารางรายรับแยก (REVENUE-02) และห้าม regression invariant "รับชำระไม่ลงรายได้/VAT ซ้ำ" ซึ่งโค้ดบังคับแล้ว (`prisma-accounting.repository.ts:751-757`, `posting-engine.logic.ts:136-168`, RECEIPT ห้าม carry tax `document.use-case.ts:344-346`)
- หมวดรายรับ = model ใหม่ `RevenueCategory` **company-scoped เท่านั้น** (จงใจไม่มีแถว global เพื่อเลี่ยงบั๊ก NULL-distinct + union ซ้ำที่เกิดจริงฝั่ง expense — LED-FIN-03) + `AccountingDocumentLine.revenueCategoryId` FK ใหม่ โดยคอลัมน์ free-text `revenueCategory` เดิม (`schema.prisma:1848`) กลายเป็น snapshot ชื่อ ณ วัน issue
- ขายสดใช้ orchestration `RecordSimpleIncomeUseCase` (INVOICE→issue→payment→auto-RECEIPT + idempotencyKey) — ไม่เพิ่ม enum `TAX_INVOICE_RECEIPT`
- คำต้องห้ามบนทุกหน้าจอ/รายงาน: "กำไร", "ยอดเงินคงเหลือ" → ใช้ "ส่วนต่างรายรับ–รายจ่ายที่บันทึก" / "ส่วนต่างเงินรับ–เงินจ่าย"
- STOP-SHIP: LED-FIN-01 — `accounting-totals.logic.ts:35-46` ใช้ JS float ต้องแปลง decimal.js + golden ก่อนเปิดผู้ใช้จริง (residual จาก FIN-01)
- เปิดแบบ per-company allowlist ผ่าน entitlement `sales_documents` (default OFF, ไม่เข้า `DEFAULT_ENABLED_FEATURE_KEYS`) + kill switch gate `sales_documents/DEFAULT` (seeded OPEN) แบบ BLOCK_NEW_ROOT
- Runoff matrix "blocked 4/31" เป็น survey record แล้ว (Owner decision 2026-08-04 ใน `feature-entitlement-runoff-matrix.md:11`) — ไม่ใช่ gate อัตโนมัติ แต่ 4 แถว (approve/issue/reject + outbox producer) ยังต้องเคลียร์เชิงหลักฐานตาม §15 แผนหลัก

Open questions (spec §9 — Owner ต้องตอบก่อน coding):

1. ลำดับคิว P27 เทียบสาย P14→P26 (billing) — dev คนเดียวเลือกได้สายเดียว
2. auto-RECEIPT ทุกครั้งในโหมดขายสด? (แนะนำ: ใช่)
3. บริษัทไม่จด VAT ซ่อนตัวเลือก VAT? (ต้องหา truth สถานะ VAT — Phase 0 V4)
4. CN/DN วันนี้อ้างได้เฉพาะ TAX_INVOICE ที่ issue แล้ว — บริษัทไม่จด VAT ใช้ VOID+ออกใหม่พอไหม
5. นักบัญชีที่ยืนยัน mapping หมวดรายรับ 6 หมวด → account/tax code
6. ยืนยันชุดคำ 6 ตัวเลขหน้าสมุด

Artifacts:

- `docs/specs/mangmee-income-expense-ledger-spec-th.md` (ใหม่)
- `docs/plans/mangmee-income-expense-ledger-plan-th.md` (ใหม่ — 7 phases ~9 วัน, Phase 0 = ยืนยัน V1–V6)
- `docs/plans/mangmee-brain-2-5-day-priority-plan-th.md` — เพิ่ม P27, ลำดับข้อ 5 §10, decided list §11, ลิงก์จาก §13.10, อ้างอิง §16
- Commit ชุดเอกสารบัญชีที่เคยเป็น untracked เข้า repo พร้อมกัน: accounting OS spec/plan, tax knowledge spec, FlowAccount research + memory (เนื้อหา byte-identical กับสำเนาใน checkout หลัก ไม่แก้ไข)

Verification:

- Docs-only — ไม่มี test ต้องรัน; ตรวจ markdown ลิงก์ภายในด้วยตาก่อน commit
- ข้อเท็จจริงโค้ดทุกข้อใน spec §3 มี file:line จากการสำรวจ 2026-08-26; ข้อที่ยังไม่แน่ใจถูกแยกไว้เป็น Phase 0 V1–V6 อย่างชัดเจน ไม่เดา

Next:

1. PR docs ชุดนี้เข้า `develop` (admin merge ตาม pattern ที่ Owner อนุญาตในรอบงานนี้)
2. รายงาน Owner: spec/plan พร้อม + คำถาม §9 ที่ต้องตอบ
3. เมื่อ Owner ตอบ → เริ่ม Phase 0 (ยืนยัน V1–V6) แล้วไล่ phase ตามแผน
4. หมายเหตุข้ามงาน: PR #238 (develop→main, release รอบก่อน) CI เขียวครบ รอ Owner approve+merge แล้วจึง dispatch UAT ตาม runbook
