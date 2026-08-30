# แผนส่งมอบ Company Plan Limits & Term — P29

สถานะ: **SPEC/PLAN LOCKED 2026-08-30; ห้าม implement จนกว่า Owner สั่ง** (คำสั่งเดียวกับ P10 Flow B: spec+plan ก่อน)

Source of truth: [P29 Spec](../specs/mangmee-company-plan-term-spec-th.md) + [Billing §8 catalog 2026-08-30](../specs/mangmee-billing-subscription-spec-th.md#billing-offer-catalog)

## เป้าหมายและเส้นแบ่ง

แอดมิน config ลิมิต (สาขา/พนักงาน/สลิป) + อายุการใช้งานต่อบริษัทจากหน้า Partner console, ระบบเตือนเหลือง/แดง, หมดอายุแล้ว disable ตรงชั่วโมงจริง, ต่ออายุแล้วกลับมาใช้ได้ทันที — **ไม่มี payment, ไม่ตัดโควตาสลิปจริง** (ทั้งสองเป็น P26)

## T1 — Config + หน้า admin (ยังไม่มี enforcement — ปลอดภัยต่อลูกค้าปัจจุบัน 100%)

- Migration additive: ตาราง `CompanyPlanTerm` ตาม spec §3
- Auto-create term row default STARTER+30 วัน เฉพาะบริษัทที่**สร้างใหม่**ผ่าน admin onboarding (ลูกค้าเดิมไม่ backfill)
- API แอดมิน (system-partner-management): get/set config, renew (idempotent + audit CRITICAL before/after ตามแบบ set-partner-ai-model)
- UI: section "แพ็กเกจและอายุการใช้งาน" ใน PartnerDetailPage + ชิป/ filter ใน PartnerListPage (สถานะเขียว/เหลือง/แดงเป็นค่าคำนวณฝั่ง read)
- Gate: CRUD/renew/audit ครบ, tier preset เติมเลขตรง catalog, บริษัทไม่มี row แสดง "ไม่จำกัด (ลูกค้าเดิม)"

## T2 — Enforcement + แจ้งเตือน

- ยืนยันจุด reject บริษัทไม่ ACTIVE บนเส้น user (permission resolver) แล้วเพิ่ม on-access expiry check (ACTIVE แต่ now ≥ termEndsAt → block business routes + หน้าต่ออายุแดง)
- Workers sweep (~5 นาที ตามแบบ object-version-cleanup): flip ACTIVE→DISABLED (เหตุ `term_expired`, เขียน `termDisabledAt`, reuse logic lifecycle เดิม, ข้ามบริษัทที่ status ไม่ใช่ ACTIVE) + แจ้งเตือนเหลือง/แดง exactly-once (dashboard-notifications ฝั่งแอดมิน + ช่องแจ้งเตือน OWNER)
- Renew re-enable เฉพาะ `termDisabledAt` (admin-disabled ไม่แตะ); LINE template ตอบสุภาพเมื่อหมดอายุ; ป้าย "หมดอายุ" ใน company switcher + แบนเนอร์เหลือง
- Limit สาขา/พนักงาน ที่ create-branch / create-employee (422 ไทย, นับเฉพาะ ACTIVE, ไม่มี row = ไม่จำกัด, เกินอยู่แล้วไม่แตะของเดิม)
- Gate: ตาม spec §6 ครบ (ตรงชั่วโมง, exactly-once, renew 3 กรณี, limit ที่เพดาน, LINE, ข้อมูลครบหลังกลับมา)

## T3 — เชื่อม auto-register (ไปกับ P10 Slice C)

- Approve `PRO_TRIAL` → provision พร้อม term row preset PRO + 30 วัน (ชั่วโมงจริงนับจาก provision)
- หน้า claim/success ลูกค้าเห็นวันหมดอายุ trial ชัดเจน
- Gate: e2e สมัคร→อนุมัติ→claim→เห็นวันหมด→(จำลอง)หมดอายุ→disable→renew→กลับมาใช้ได้

## ภายหลัง (ไม่อยู่ในแผนนี้)

- P26: meter นับสลิป (F-BILL-1) มาผูกกับ `monthlySlipLimit` เป็นเพดานจริง + self-service payment/renew — ตาราง/ช่องของ P29 ออกแบบให้ P26 ต่อได้โดยไม่ migrate ซ้ำ
