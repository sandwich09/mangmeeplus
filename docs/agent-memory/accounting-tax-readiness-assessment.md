# Agent Memory: accounting-tax-readiness-assessment

Status: DONE 2026-08-03 — read-only audit เสร็จ บันทึกผลที่ `docs/specs/accounting-tax-readiness-assessment.md`; ไม่มีการแก้โค้ด
Owner: thawtchai (ผู้ขอ) / Claude session 2026-08-03
Scope: ตอบคำถาม "ระบบบัญชี–ภาษีครบพอยื่นสรรพากร / ใช้ทำบัญชีบริษัททั่วไปได้ไหม" — audit อย่างเดียว ไม่ fix
Decisions:
- คำตอบ: **ยังไม่พร้อมทั้งสองระดับ** — ระบบปัจจุบันเป็น tax-data-preparation สำหรับส่งต่อสำนักงานบัญชี
- ใช้เลข finding แบบ RA-01..RA-34 แยกจาก GAP-xx และ**ไม่แก้** `finance-accounting-gaps-spec.md` (เป็น DRAFT รอทีมตัดสินรายข้อ ไม่ควรแตะจาก audit ภายนอก)
- ผลสำรวจอัตโนมัติหนึ่งข้อคลาดเคลื่อนและแก้แล้ว: WHT handoff **มี UI จริง** (`WhtHandoffPanel`, AccountsPayablePages แท็บ wht) — อย่าคัดลอก claim "ไม่มี UI" ต่อ
Open questions:
- ทีมจะรับ roadmap Phase A–E ใน §7 ของเอกสารผลตรวจหรือจัดลำดับใหม่
- จะ merge RA findings เข้า `finance-accounting-gaps-spec.md` (ให้เป็น gap inventory เดียว) หรือถือแยกเป็น assessment snapshot
Artifacts:
- `docs/specs/accounting-tax-readiness-assessment.md` (ผลตรวจหลัก: verdict, ตารางรายแบบภาษี/งานบัญชี, RA-01..RA-34, จุดแข็ง, roadmap)
Verification:
- Survey 3 เลนขนาน (ledger/accounting core, tax, docs) บน tree `develop @ 544bdd25`
- Grep ยืนยัน claim หลัก 15 รายการ (รายการอยู่ใน §8 ของเอกสารผลตรวจ) — ทุกข้อตรงตามผลสำรวจ ยกเว้นข้อ WHT handoff UI ที่แก้แล้ว
Next:
- ทีม triage RA ระดับ "บล็อก" (RA-01..04, 06..09, 13..16, 18..20, 23..24, 30) เทียบกับ GAP-01/02/07 ที่เปิดอยู่
- เมื่อปิด finding ใด ให้อัปเดตสถานะในเอกสารผลตรวจหรือย้ายเข้า gaps spec ตามที่ทีมตัดสิน
