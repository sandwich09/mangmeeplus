# Company Plan Limits & Term (Admin-managed) — Spec P29

สถานะ: **SPEC-ONLY (Owner สั่ง 2026-08-30: "แค่ spec+plan ก่อน ห้าม implement")** — ยังไม่มี schema/โค้ด/UI ใด ๆ ของฟีเจอร์นี้; แผนส่งมอบอยู่ [แผน P29](../plans/mangmee-company-plan-term-plan-th.md)

ที่มา: คำสั่ง Owner 2026-08-30 ในแชต: หน้า company system ของ admin ต้อง config ได้ว่าแต่ละบริษัท "สร้างได้กี่สาขา พนักงานกี่คน อ่านสลิปได้กี่ใบ" default ตาม tier STARTER, มีระยะเวลาใช้งาน default 30 วัน (config ได้), แจ้งเตือนก่อนครบกำหนด**สีเหลือง** ครบกำหนด**สีแดง**, มีระบบต่ออายุ (renew) — ไม่ต่อ = **disable บริษัทตามเวลาวัน-ชั่วโมงจริง**ที่ครบกำหนด. ฟีเจอร์นี้คือ "subscription แบบแอดมินจัดการมือ" — ตัวคั่นก่อน P26 (payment/enforcement เต็มรูป) และเป็นกลไก trial ของ auto-register P10 (`PRO_TRIAL` 30 วัน)

## 1. Current truth (สำรวจโค้ด 2026-08-30)

| ข้อเท็จจริง | หลักฐาน |
|---|---|
| `Company.status` มี enum ครบ: `ACTIVE / SUSPENDED / DISABLED / ARCHIVED` + timestamp `activatedAt/disabledAt/archivedAt` | `schema.prisma` enum `CompanyStatus`, `Company.status @default(ACTIVE)` |
| Admin เปลี่ยนสถานะบริษัทได้แล้วผ่าน `PartnerLifecycleTransitionUseCase` (ACTIVE↔DISABLED↔ARCHIVED, ตั้ง timestamp, audit `system.partner_company.lifecycle.transition`); **SUSPENDED สงวนเป็น security state แยก ห้ามใช้ทาง lifecycle** | `partner-lifecycle-transition.use-case.ts:1-60` |
| ฝั่ง user: permission resolver ข้าม/ปฏิเสธบริษัทที่ไม่ ACTIVE (fallback query กรอง `company: { status: 'ACTIVE' }`; explicit-companyId branch อาศัยการ reject ขั้นถัดไปตาม comment ในไฟล์ — **จุด reject จริงต้องยืนยันซ้ำตอน implement T2**) | `prisma-permission-resolver.repository.ts:30-50` |
| Internal worker routes ปฏิเสธบริษัทไม่ ACTIVE ผ่าน `assertActiveCompany` (H-14) | `common/security/active-company.ts` |
| หน้า admin ที่ Owner หมายถึง = Partner console: `PartnerListPage.tsx` + `PartnerDetailPage.tsx` (มี features/AI model/member management อยู่แล้ว) | `apps/web/src/features/system-partners/` |
| Per-company config + override precedent (audit CRITICAL, before/after, ไม่ clamp เงียบ): `CompanyAiConfiguration.monthlyBudgetSatang` + `set-partner-ai-model.use-case.ts` | `set-partner-ai-model.use-case.ts:38-115` |
| Seam สร้างสาขา: `create-branch.use-case.ts` (data-model-core); seam สร้างพนักงาน: `create-employee.use-case.ts` (employee-access) — จุดเดียวต่อชนิด เหมาะกับ limit check | ทั้งสองไฟล์ + controller ที่เรียก |
| **มิเตอร์นับสลิปต่อเดือนยังไม่มี** (P26 F-BILL-1 `DocumentWorkUnit` = NOT FOUND) — จำกัด "อ่านสลิปกี่ใบ" จึงยังตัดจริงไม่ได้ในรอบนี้ | [Billing spec §3.2](mangmee-billing-subscription-spec-th.md) |
| Workers มี scheduled sweep precedent (`object-version-cleanup-worker`) + notification machinery + dashboard-notifications สำหรับเตือน System Admin | `apps/workers/src/modules/object-version-cleanup/`; `dashboard-notifications` |
| ราคา/โควตาต่อ tier = catalog 2026-08-30 (STARTER 1 สาขา·2 คน·30 ใบ / BASIC 2·5·50 / PRO 5·10·100 / ENTERPRISE 10·30·2,000) | [Billing §8](mangmee-billing-subscription-spec-th.md#billing-offer-catalog) |
| Seam ปฏิเสธสุภาพฝั่ง LINE เมื่อบริษัทใช้ไม่ได้ มี template อยู่แล้ว | `process-line-webhook.use-case.ts` DENIED template |

## 2. หลักการที่ห้ามละเมิด

1. **ข้อมูลลูกค้าไม่หายไม่ว่ากรณีใด** — disable = ปิดการใช้งาน ไม่ลบ ไม่ archive อัตโนมัติ; ต่ออายุแล้วกลับมาเห็นทุกอย่างเหมือนเดิม
2. **เกินลิมิตแบบ retroactive ห้ามลบ/ปิดของเดิม** — บริษัทที่มีสาขา/พนักงานเกิน limit อยู่แล้ว: บล็อกเฉพาะ "การสร้างใหม่" ห้ามแตะของที่มี
3. **SUSPENDED เป็น security state แยกเหมือนเดิม** — ระบบ term ห้ามเขียน/ล้าง SUSPENDED และ renew ห้าม re-enable บริษัทที่แอดมินสั่ง disable เอง (re-enable อัตโนมัติได้เฉพาะที่ถูก disable เพราะ term หมดอายุ)
4. หมดอายุตรงเวลา**ชั่วโมงจริง**: `termEndsAt` เป็น timestamp (เก็บ UTC แสดงผลเวลาไทย) = เวลาเริ่ม + N×24 ชม. เป๊ะ; การบังคับหลักอยู่ที่ on-access check (ไม่พึ่ง sweep อย่างเดียว — sweep มีหน้าที่ flip สถานะ/แจ้งเตือน)
5. การตัดโควตา "อ่านสลิป" จริงยังเป็นของ P26 (ต้องมี meter + ข้อความแจ้งครบก่อน) — รอบนี้ช่อง config เป็นค่าประกาศ/แสดงผลเท่านั้น
6. ทุกการแก้ config/ต่ออายุ/auto-disable ต้องมี audit ระดับ HIGH/CRITICAL พร้อมค่า before/after ตามแบบ `set-partner-ai-model`
7. บริษัทที่**ไม่มี** term row = ลูกค้าเดิม (grandfathered) ใช้ได้ไม่จำกัดเวลา — ระบบห้าม backfill เส้นตายให้ลูกค้าเดิมอัตโนมัติ; แอดมินตั้งเองรายบริษัทเมื่อพร้อม

## 3. Data model (ใหม่ — additive)

`CompanyPlanTerm` (1:1 กับ Company):

- `companyId @unique`, `tierKey` (อ้าง catalog Billing §8 — snapshot ตอนตั้ง ไม่ lookup สด), `branchLimit Int`, `employeeLimit Int`, `monthlySlipLimit Int`
- `termStartAt DateTime`, `termEndsAt DateTime` (ชั่วโมงจริง), `warningDays Int @default(7)`
- `lastRenewedAt?`, `renewCount Int @default(0)`, `termDisabledAt?` (เวลาโดน auto-disable เพราะหมดอายุ — ใช้แยกจาก disable โดยแอดมิน)
- `createdByUserId/updatedByUserId`, timestamps
- ประวัติการแก้/ต่ออายุอ่านจาก `AuditLog` (targetType `company_plan_term`) — ไม่สร้างตาราง event ใหม่ในเฟสแรก

สถานะแสดงผลเป็นค่า**คำนวณ** ไม่เก็บซ้ำ: `ACTIVE` (เขียว), `WARNING` (เหลือง: now ≥ termEndsAt − warningDays), `EXPIRED` (แดง: now ≥ termEndsAt)

## 4. พฤติกรรม

### 4A. ตั้งค่าเริ่มต้น

- บริษัทที่สร้างใหม่ผ่าน admin onboarding: สร้าง term row อัตโนมัติ default **STARTER** (1 สาขา · พนักงาน 2 คน · สลิป 30 ใบ/เดือน) + **30 วัน** นับจากเวลาสร้าง (ชั่วโมงจริง)
- หน้า admin มี dropdown เลือก tier preset (STARTER/BASIC/PRO/ENTERPRISE จาก Billing §8) แล้วเติมตัวเลขให้ — แก้รายช่องต่อได้ (override ต่อบริษัท)
- Auto-register (P10 Flow B) ตอน approve→provision: ตั้ง preset **PRO** + 30 วัน ตาม `PRO_TRIAL` — จุดเชื่อมอยู่ P10 Slice C
- จำนวนวัน default 30 แก้ได้ต่อบริษัททั้งตอนตั้งและตอนต่ออายุ

### 4B. แจ้งเตือนและหมดอายุ

- เข้าเขต warning (เหลือง): แจ้ง System Admin ผ่าน dashboard-notifications + แจ้ง OWNER บริษัทผ่านช่องแจ้งเตือนเดิม (web แบนเนอร์เหลือง "ใกล้ครบกำหนดใช้งาน วันที่/เวลา … ติดต่อต่ออายุ" + ปุ่มติดต่อ tel/LINE OA) — exactly-once ต่อ term ต่อระดับ
- ครบกำหนด (แดง): on-access check ปฏิเสธ business routes ของบริษัทนั้นทันทีที่ now ≥ termEndsAt (แม้ sweep ยังไม่ทัน) + sweep ใน workers (ทุก ~5 นาที) เปลี่ยน `Company.status → DISABLED` ผ่าน logic ชุดเดียวกับ `PartnerLifecycleTransitionUseCase` (actor = system, reason `term_expired`, เขียน `termDisabledAt`) + แจ้งทั้งสองฝั่ง
- ประสบการณ์ผู้ใช้บริษัทที่หมดอายุ: login ได้, เห็นบริษัทใน switcher ติดป้าย "หมดอายุ", เข้าแล้วเจอหน้าแจ้งต่ออายุ (แดง) — ไม่มี operation ข้อมูลใด ๆ ทำได้; LINE ตอบสุภาพ "บริษัทครบกำหนดใช้งานแล้ว ติดต่อ …" ผ่าน template DENIED เดิม
- ระหว่าง ACTIVE→DISABLED ด้วยเหตุ term: ห้ามแตะ SUSPENDED/ARCHIVED และห้ามชนกับ disable ที่แอดมินสั่งเอง (ถ้า status ไม่ใช่ ACTIVE อยู่แล้ว sweep ข้ามเฉย ๆ)

### 4C. ต่ออายุ (renew)

- ปุ่ม "ต่ออายุ" บน PartnerDetailPage: ระบุจำนวนวัน (default 30) → `termEndsAt ใหม่ = max(now, termEndsAt เดิม) + N×24 ชม.` (ยังไม่หมด = ต่อจากวันหมดเดิม; หมดไปแล้ว = นับจากตอนกด) → `renewCount+1`, `lastRenewedAt=now`, audit CRITICAL
- ถ้าบริษัทถูก disable เพราะ term (`termDisabledAt` มีค่า และ status = DISABLED): renew → กลับ ACTIVE อัตโนมัติ + ล้าง `termDisabledAt` + แจ้ง OWNER "ต่ออายุแล้ว ใช้งานได้ตามเดิม"
- ถ้า DISABLED โดยแอดมิน (ไม่มี `termDisabledAt`): renew แก้แค่วันที่ **ไม่** re-enable — ต้องกด activate แยกทาง lifecycle เดิม
- Idempotent ด้วย requestId ตามแบบ use-case แอดมินเดิม

### 4D. ลิมิตสาขา / พนักงาน / สลิป

- `create-branch.use-case`: นับสาขาสถานะใช้งานของบริษัท ≥ `branchLimit` → 422 ข้อความไทย "แพ็กเกจปัจจุบันสร้างได้สูงสุด X สาขา — ติดต่อผู้ดูแลเพื่อปรับแพ็กเกจ" (แอดมินแก้ limit ได้ทันทีจากหน้า partner)
- `create-employee.use-case`: เงื่อนไขเดียวกันกับ `employeeLimit` (นับ membership ACTIVE ที่ไม่ใช่ SYSTEM_ADMIN)
- บริษัทไม่มี term row = ไม่จำกัด (ตามหลักการข้อ 7); บริษัทที่เกินอยู่แล้ว = บล็อกเฉพาะสร้างใหม่ (หลักการข้อ 2)
- `monthlySlipLimit`: เก็บ+แสดงบนหน้า admin (และหน้าแพ็กเกจของลูกค้าในอนาคต) — **ยังไม่ตัดจริง** จนกว่า P26 F-BILL-1 meter มา แล้วค่อยผูกช่องนี้เป็นเพดานจริง

## 5. หน้าจอ

- **PartnerDetailPage**: section ใหม่ "แพ็กเกจและอายุการใช้งาน" — tier preset + 3 ช่องลิมิต + วันเริ่ม/วันหมด (แสดงเวลาไทยพร้อมชั่วโมง) + warningDays + ชิปสถานะ เขียว/เหลือง/แดง + ปุ่มต่ออายุ (กรอกจำนวนวัน) + ประวัติ (จาก audit)
- **PartnerListPage**: ชิปสถานะ term ต่อแถว (เขียว/เหลือง เหลือ X วัน/แดง หมดอายุ) + filter "ใกล้หมดอายุ/หมดอายุ"
- **ฝั่งลูกค้า**: แบนเนอร์เหลืองทุก role (ปุ่ม CTA ติดต่อเฉพาะ OWNER เห็นเด่น), หน้าแจ้งต่ออายุสีแดงเมื่อหมด, ป้าย "หมดอายุ" ใน company switcher — mobile-first 390px ตามผู้ใช้จริง
- ตัวเลข/เวลาแสดงแบบไทย (เช่น "ครบกำหนด 29 ก.ย. 2569 เวลา 14:00 น.")

## 6. Gates/tests

- หมดอายุตรงชั่วโมง: request ที่ now ≥ termEndsAt โดน block แม้ sweep ยังไม่ flip; sweep flip แล้ว idempotent (รันซ้ำไม่มีผลซ้ำ)
- renew ก่อนหมด = ต่อจากเดิม / หลังหมด = นับจาก now / โดน admin-disable = ไม่ re-enable
- แจ้งเตือนเหลือง/แดง exactly-once ต่อ term; ต่ออายุแล้วเข้าเขตเหลืองรอบใหม่แจ้งได้อีก
- limit สาขา/พนักงาน: ที่เพดาน = 422 พร้อมข้อความไทย; เกินอยู่แล้ว = ของเดิมไม่ถูกแตะ; ไม่มี term row = ไม่จำกัด
- audit ครบทุก set/renew/auto-disable พร้อม before/after; ไม่มี PII เกินจำเป็น
- LINE ตอบสุภาพเมื่อบริษัทหมดอายุ; login/switcher ยังทำงาน; ข้อมูลครบเมื่อกลับมา ACTIVE

## 7. สิ่งที่ไม่ทำรอบนี้

Payment/ชำระเงินทุกชนิด (P26), ตัดโควตาสลิปจริง (รอ meter P26), self-service renew โดยลูกค้า, proration/refund, backfill เส้นตายให้ลูกค้าเดิม, แก้ SUSPENDED flow

## 8. คำถาม Owner (ไม่ block การเริ่ม implement เมื่อสั่ง)

1. warningDays default 7 วัน โอเคไหม (config ได้ต่อบริษัทอยู่แล้ว)
2. แบนเนอร์เหลืองให้พนักงานเห็นด้วย หรือเฉพาะ OWNER
3. ยืนยันพฤติกรรม LINE ตอนหมดอายุ = ตอบสุภาพ+ชวนติดต่อ (ไม่เงียบ)
4. ลูกค้าเดิมที่ใช้อยู่ก่อน = ไม่มีเส้นตายจนกว่าแอดมินตั้งเอง (grandfathered) — ยืนยัน
