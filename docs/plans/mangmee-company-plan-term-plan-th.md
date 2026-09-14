# แผนส่งมอบ Company Plan Limits & Term — P29

> **Implementation update 2026-09-14 — IN PROGRESS:** actual Next/Nest/PostgreSQL/Chromium + isolated marketing ผ่าน143กลุ่มกับ Stripe/Postmark/LINE จำลอง ครอบคลุมแพ็กเกจ/สิทธิ์และ Admin ที่บันทึกใน[หลักฐาน](../evidence/billing-integration-2026-09-13/README.md) รวมกู้ provider event เดิมและประวัติอีเมลรับบัญชี. ตัวเลขเป็น scenario groups ไม่ใช่ครบทุกflowในspec. Root CI34794722241ผ่าน tests/HTTP แต่ล้มตอนปิด Redis ที่runnerไม่มี; กำลังแก้CI. Marketing CI34792867313ผ่าน. Controls/fullsignup/fullLINE/mail recoveryบางส่วนยังไม่ครบ; คำถามช่องทางemail resetรอOwner. Receipt-only HIDDEN; ยังไม่merge/deploy.

> **Package amendment 2026-09-11:** [สิทธิ์/ราคา/7เมนู default](../specs/mangmee-package-entitlements-spec-th.md) และ [PE-S0–S5 / PE01–PE36](mangmee-package-entitlements-plan-th.md) เป็นข้อกำหนดล่าสุด: สมัครอย่างเดียวได้ starter7เมนู + FREE_TRIAL_15 (1สาขา/ผู้ใช้รวม2คน/15ใบต่อเดือน/30วัน) ไม่ผูกบัตร; paid รองรับ month/year ตามรูป; มติ2026-09-13ให้ annual quota12เท่าทันทีและซื้อแพ็กเกจเต็มซ้ำต่ออายุจากวันเดิม. Trial/manualคงโควตารายเดือนเดิม. ENTERPRISE_1999 ทั้งเดือน/ปี + ภ.ง.ด.53/50ทวิ Coming soon ห้ามจ่าย; ไม่กระทบ PRO_999. B01/B02/B09 ตัดสินแล้วเฉพาะขอบเขตนี้; นโยบายอื่นคงเดิม. Full spec/native provider acceptance ยังไม่ครบ; local simulated browser/HTTP checkpoint ดูหลักฐาน integration ล่าสุด ไม่ใช้แทน native provider acceptance.

สถานะ: **T1+T2+T3 IMPLEMENTED บน branch `codex/auto-register-round1` (2026-08-30)** — enforcement มีผลเฉพาะบริษัทที่มี term row; ลูกค้าเดิมไม่มี row = ไม่กระทบ (พิสูจน์ด้วยเทสต์); follow-up ที่จดไว้: ข้อความ LINE ตอนหมดอายุยังเป็น generic (จุดแก้อยู่ process-line-webhook — สงวนไว้รอบถัดไป), DRAFT membership ไม่นับโควตาที่นั่ง (completeDraft ไม่มี gate), notification preference เดิมของ user อาจกรอง trigger ใหม่ (LINE push)

**S-pre acceptance 2026-09-11 — DONE local:** ปิด R01/R02/R03/R05/R06 และ R07 notification persistence. [หลักฐาน](../evidence/stripe-repair-2026-09-11/README.md) ผ่าน browser 20/20, real PG 15/15, focused 198/198 รวม RG01–RG05; API/web production-source typecheck ผ่าน. ไม่มี Stripe collection/deploy/charge และไม่เปลี่ยน business policy.

Source of truth: [P29 Spec](../specs/mangmee-company-plan-term-spec-th.md) + [Billing §8 current catalog](../specs/mangmee-billing-subscription-spec-th.md#billing-offer-catalog)

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

- Current policy 2026-09-05/07: approve `FREE_TRIAL` (`PRO_TRIAL` เป็น legacy alias) → provision `FREE_TRIAL_15`, 1 สาขา/2 คน/15 ใบต่อเดือน, default 30 วันจาก provision ตาม P29 amendment; ไม่ใช้ preset PRO paid
- หน้า claim/success ลูกค้าเห็นวันหมดอายุ trial ชัดเจน
- Gate: e2e สมัคร→อนุมัติ→claim→เห็นวันหมด→(จำลอง)หมดอายุ→disable→renew→กลับมาใช้ได้

## ภายหลัง (ไม่อยู่ในแผนนี้)

- P26: meter นับสลิป (F-BILL-1) มาผูกกับ `monthlySlipLimit` เป็นเพดานจริง + self-service payment/renew — ตาราง/ช่องของ P29 ออกแบบให้ P26 ต่อได้โดยไม่ migrate ซ้ำ

## S-pre — งานแก้ฐานเดิมก่อน Stripe (DONE / LOCAL PASS 2026-09-11)

1. แก้ transaction/dedupe/activation ของ manual renew และ shared term/lifecycle writers: R01/R05 แล้ว R03; รักษา admin/security hold รวมคำสั่งที่ชนกัน.
2. ทำ durable notification intent/retry ผ่าน machinery เดิม: R07; ทดสอบ crash ไม่ให้ warning/expiry notice สูญหายหรือส่งผิด term.
3. แก้ scoped recovery permission และ selected-company UI/error contract: R02/R06; OWNER/employee/tenant isolation และ business block ต้องอยู่ครบ.
4. รัน browser/PG baseline พร้อม RG01–RG05 แล้วบันทึกผลใหม่และ cleanup. [P29 §9](../specs/mangmee-company-plan-term-spec-th.md#plan-term-repair) เป็น acceptance, [P26 §9](mangmee-stripe-billing-implementation-and-test-plan-th.md#stripe-closure-plan) เป็นแผนกลาง; ไม่สร้าง task/test register สองชุดที่คลาดกัน.

S-pre แก้ correctness ของ behavior เดิม ไม่รอคำตอบ grace/refund ใหม่; paid collection/period/entitlement application ยังอยู่ S0–S5 ของ P26. ข้อความ NOT FOUND/ยังไม่มี meter ในประวัติ 2026-08-30 ต้อง revalidate ตาม P26 current baseline ก่อนเพิ่ม model หรือ enforcement.

ผลปิดงาน: 4 ขั้น S-pre ข้างต้น implemented/verified แล้ว. Worker intent ใช้ NotificationEvent/Recipient/Delivery ใน transaction เดียวกับ term claim และ worker delivery เดิม; ไม่เพิ่ม OutboxEvent rail. Legacy read-only report ผ่าน fixture ที่มี admin hold. ข้อมูลทดสอบ company/user/notification/audit เหลือ 0; immutable legal evidence คงตาม policy. คำว่า DONE ไม่ครอบคลุม Stripe S0–S5 หรือ historical LINE/signup acceptance ที่ไม่ได้รันในรอบนี้.
