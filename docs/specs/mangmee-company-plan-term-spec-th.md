# Company Plan Limits & Term (Admin-managed) — Spec P29

> **Implementation update 2026-09-14 — IN PROGRESS:** actual Next/Nest/PostgreSQL/Chromium + isolated marketing ผ่าน158กลุ่มกับ Stripe/Postmark/LINE จำลอง รวมAdminกู้สิทธิ์จากใบเสร็จเดิมที่เลือกและตรวจeventตกหล่น. สมัครเว็บ8และยืนยันอีเมล6เป็นหลักฐานแยก ไม่รวมใน158. API/web typechecks, billing/DTO29, PostgreSQL35ผ่าน. Root CI34801493799(7ca2d7a8)ผ่าน; รอบ34803284452(6da65148)ติดจังหวะlegal redirectในsignup fixture ซึ่งแก้และรันsignup8ผ่านแล้ว รอCIใหม่ของโค้ดรอบนี้. Marketing CI34802725764(0cd88eb)ผ่าน. Controls/fullsignup/fullLINE/mailยังมีงานค้าง; email password recoveryรอOwner. Receipt-only HIDDEN/Enterprise Coming soon; ยังไม่merge/deploy. ดู[หลักฐาน](../evidence/billing-integration-2026-09-13/README.md).

> **Package amendment 2026-09-11:** [สิทธิ์/ราคา/7เมนู default](mangmee-package-entitlements-spec-th.md) และ [PE-S0–S5 / PE01–PE36](../plans/mangmee-package-entitlements-plan-th.md) เป็นข้อกำหนดล่าสุด: สมัครอย่างเดียวได้ starter7เมนู + FREE_TRIAL_15 (1สาขา/ผู้ใช้รวม2คน/15ใบต่อเดือน/30วัน) ไม่ผูกบัตร; paid รองรับ month/year ตามรูป; มติ2026-09-13ให้ annual quota12เท่าทันทีและซื้อแพ็กเกจเต็มซ้ำต่ออายุจากวันเดิม. Trial/manualคงโควตารายเดือนเดิม. ENTERPRISE_1999 ทั้งเดือน/ปี + ภ.ง.ด.53/50ทวิ Coming soon ห้ามจ่าย; ไม่กระทบ PRO_999. B01/B02/B09 ตัดสินแล้วเฉพาะขอบเขตนี้; นโยบายอื่นคงเดิม. Full spec/native provider acceptance ยังไม่ครบ; local simulated browser/HTTP checkpoint ดูหลักฐาน integration ล่าสุด ไม่ใช้แทน native provider acceptance.

> **LINE/web payment UI extension 2026-09-11 — DESIGN ONLY:** /companies/{companyId}/renew จะพา OWNER เข้า [billing overview/Checkout/Portal](mangmee-line-web-billing-ui-spec-th.md) เมื่อผ่าน gate; employee คงข้อความกลาง. LINE-only expired OWNER ต้องเข้าผ่าน LIFF/handoff recovery ที่ออกแบบเพิ่ม ไม่ใช่ handler ปัจจุบันที่เลือก ACTIVE บริษัทแรก. [แผน UI](../plans/mangmee-line-web-billing-ui-plan-th.md) แยกผล manual-renew ที่ผ่านแล้วจาก Stripe paid/device tests ที่ยัง NOT RUN.

> **Current-policy amendment 2026-09-08:** trial ของ self-signup ใช้ `FREE_TRIAL` → `FREE_TRIAL_15` (1 สาขา/2 คน/15 ใบต่อเดือนตั้งแต่วันแรก, default 30 วันจาก provision) ตามมติ 2026-09-05/07 ใน [External Signup §3A](mangmee-external-signup-contract-spec-th.md) และ [onboarding/trial fixes](onboarding-trial-receipt-fixes-spec.md). ข้อความ PRO trial/100 ใบด้านล่างเป็นประวัติ 2026-08-30 ที่ถูกแทนที่แล้ว; admin STARTER/manual override ไม่เปลี่ยน.

> **Stripe integration boundary (spec-only):** [P26 F-BILL-3](mangmee-billing-subscription-spec-th.md#billing-stripe) จะต่อ paid term จาก service period ที่ Stripe ยืนยันผ่าน application logic เดิม ไม่เรียก manual renew `max(now, termEndsAt) + N×24h` ทุก webhook. Manual/trial term และ Bangkok quota month คงกติกาเดิม; payment replay ไม่ reset usage. ห้าม re-enable admin-disabled/SUSPENDED/ARCHIVED. Paid grace/access/cancellation ยังรอมติ P26 §10; P29 expiry/sweep ต้องใช้ policy เดียวกับ billing ก่อน LIVE และ OWNER ต้องเข้าเส้นแก้บัตร/ต่ออายุได้โดยไม่เปิด business routes. การแก้ spec นี้ไม่เปลี่ยนพฤติกรรมหมดอายุที่ใช้อยู่.

> **Repair acceptance 2026-09-11 — IMPLEMENTED / LOCAL PASS:** R01/R02/R03/R05/R06 แก้แล้ว และ R07 ผ่าน fault-injection/durable-delivery proof. [ผลหลังแก้](../evidence/stripe-repair-2026-09-11/README.md) มี browser 20/20, real PG 15/15, focused 198/198 และ source hashes; §9 เป็น implemented contract ของ manual flow. Stripe collection/paid-period adapter ยังไม่ implement และไม่มี deploy. ผล red run เก็บไว้ใน report เดิม.

สถานะ: **IMPLEMENTATION IN PROGRESS 2026-08-30** (Owner ตอบ §8 ครบและสั่งลุยพร้อมรอบ auto-register; ห้าม deploy UAT จนกว่า SES ops จะเสร็จ); แผนส่งมอบอยู่ [แผน P29](../plans/mangmee-company-plan-term-plan-th.md)

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

- เข้าเขต warning (เหลือง): แจ้ง System Admin ผ่าน dashboard-notifications + แจ้ง **OWNER เท่านั้น** (Owner 2026-08-30: พนักงานไม่เห็น จนกว่าจะสั่งเปลี่ยน) เป็นบันได **7 / 3 / 1 วันก่อนครบกำหนด** — web แบนเนอร์เหลือง + แจ้งเตือน LINE ช่องเดิม, exactly-once ต่อจุดต่อ term, ต่ออายุแล้วหยุดทันทีไม่ขึ้นอีก
- ครบกำหนด (แดง): on-access check ปฏิเสธ business routes ของบริษัทนั้นทันทีที่ now ≥ termEndsAt (แม้ sweep ยังไม่ทัน) + sweep ใน workers (ทุก ~5 นาที) เปลี่ยน `Company.status → DISABLED` ผ่าน logic ชุดเดียวกับ `PartnerLifecycleTransitionUseCase` (actor = system, reason `term_expired`, เขียน `termDisabledAt`) + แจ้งทั้งสองฝั่ง
- ประสบการณ์ผู้ใช้บริษัทที่หมดอายุ: login ได้, เห็นบริษัทใน switcher ติดป้าย "หมดอายุ", เข้าแล้วเจอหน้าแจ้งต่ออายุ (แดง) — ไม่มี operation ข้อมูลใด ๆ ทำได้; LINE ตอบสุภาพ "บริษัทครบกำหนดใช้งานแล้ว ติดต่อ …" ผ่าน template DENIED เดิม
- ระหว่าง ACTIVE→DISABLED ด้วยเหตุ term: ห้ามแตะ SUSPENDED/ARCHIVED และห้ามชนกับ disable ที่แอดมินสั่งเอง (ถ้า status ไม่ใช่ ACTIVE อยู่แล้ว sweep ข้ามเฉย ๆ)

### 4C. ต่ออายุ (renew)

- ปุ่ม "ต่ออายุ" บน PartnerDetailPage: ระบุจำนวนวัน (default 30) → `termEndsAt ใหม่ = max(now, termEndsAt เดิม) + N×24 ชม.` (ยังไม่หมด = ต่อจากวันหมดเดิม; หมดไปแล้ว = นับจากตอนกด) → `renewCount+1`, `lastRenewedAt=now`, audit CRITICAL
- ถ้าบริษัทถูก disable เพราะ term (`termDisabledAt` มีค่า และ status = DISABLED): renew → กลับ ACTIVE อัตโนมัติ + ล้าง `termDisabledAt` + แจ้ง OWNER "ต่ออายุแล้ว ใช้งานได้ตามเดิม"
- ถ้า DISABLED โดยแอดมิน (ไม่มี `termDisabledAt`): renew แก้แค่วันที่ **ไม่** re-enable — ต้องกด activate แยกทาง lifecycle เดิม
- Idempotent ด้วย company/action/requestId + normalized payload ภายใต้ concurrency ตาม §9; audit read ก่อน transaction ไม่เพียงพอ

### 4D. ลิมิตสาขา / พนักงาน / สลิป

- `create-branch.use-case`: นับสาขาสถานะใช้งานของบริษัท ≥ `branchLimit` → 422 ข้อความไทย "แพ็กเกจปัจจุบันสร้างได้สูงสุด X สาขา — ติดต่อผู้ดูแลเพื่อปรับแพ็กเกจ" (แอดมินแก้ limit ได้ทันทีจากหน้า partner)
- `create-employee.use-case`: เงื่อนไขเดียวกันกับ `employeeLimit` (นับ membership ACTIVE ที่ไม่ใช่ SYSTEM_ADMIN)
- บริษัทไม่มี term row = ไม่จำกัด (ตามหลักการข้อ 7); บริษัทที่เกินอยู่แล้ว = บล็อกเฉพาะสร้างใหม่ (หลักการข้อ 2)
- `monthlySlipLimit`: เก็บ+แสดงบนหน้า admin (และหน้าแพ็กเกจของลูกค้าในอนาคต) — **ยังไม่ตัดจริง** จนกว่า P26 F-BILL-1 meter มา แล้วค่อยผูกช่องนี้เป็นเพดานจริง

## 5. หน้าจอ

- **PartnerDetailPage**: section ใหม่ "แพ็กเกจและอายุการใช้งาน" — บริษัทที่ยังไม่มี term (ลูกค้าเดิม) ต้องมีปุ่ม "ตั้งแพ็กเกจ/อายุการใช้งาน" ให้ Owner เข้าไปเติมเองรายบริษัท (Owner 2026-08-30) — tier preset + 3 ช่องลิมิต + วันเริ่ม/วันหมด (แสดงเวลาไทยพร้อมชั่วโมง) + warningDays + ชิปสถานะ เขียว/เหลือง/แดง + ปุ่มต่ออายุ (กรอกจำนวนวัน) + ประวัติ (จาก audit)
- **PartnerListPage**: ชิปสถานะ term ต่อแถว (เขียว/เหลือง เหลือ X วัน/แดง หมดอายุ) + filter "ใกล้หมดอายุ/หมดอายุ"
- **ฝั่งลูกค้า**: แบนเนอร์เหลือง + หน้าแดง แสดงเฉพาะ **OWNER** (พนักงานเจอบริษัทหมดอายุ = ข้อความกลาง "ติดต่อเจ้าของร้าน" ไม่มีรายละเอียดแพ็กเกจ), ป้าย "หมดอายุ" ใน company switcher — mobile-first 390px
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

## 8. คำถาม Owner — **ตอบครบ 2026-08-30**

1. ~~warningDays~~ → 7 วัน ยืนยัน; บันไดแจ้งเตือน 7/3/1 วันก่อนหมด (§4B)
2. ~~ใครเห็นแบนเนอร์~~ → OWNER เท่านั้น จนกว่าจะสั่งเปลี่ยน
3. ~~LINE ตอนหมดอายุ~~ → ตอบสุภาพ+ชวนติดต่อ ยืนยัน (แจ้งเฉพาะ OWNER เหมือนเดิม)
4. ~~ลูกค้าเดิม~~ → ไม่มีเส้นตายจนกว่าแอดมินตั้งเอง ยืนยัน + ต้องมีช่อง config ให้เติม term ย้อนหลังจากหน้า Partner (§5)

<a id="plan-term-repair"></a>
## 9. Recovery/concurrency amendment — 2026-09-11

ข้อกำหนดต่อไปนี้ขยายคำว่า idempotent/renew แล้วใช้ได้/แจ้งเตือนครั้งเดียวใน §4–6; ไม่เปลี่ยนสูตรจำนวนวัน manual renew หรือเลือก policy paid ของ P26.

- **R01/R05:** อ่าน term/status/dedupe และคำนวณวันใน transaction/fence เดียวกับ update. Same requestId + days เดิมต่ออายุครั้งเดียวรวม activation/audit; days ต่างต้อง conflict. ต่าง requestId ที่ตั้งใจต่อสองครั้งต้องบวกวันครบ. ถ้า term/lifecycle แยก commit ต้องมี durable continuation; ห้าม completion ข้าม activation ที่ค้าง. ข้อผิดพลาดก่อน commit ต้อง rollback; response หายหลัง commit ต้อง replay โดยไม่บวกวันใหม่.
- **R03:** sweep ใช้ batch เป็น candidate แล้ว revalidate deadline/current status ภายใน boundary ที่ป้องกัน concurrent renew/set/lifecycle ได้จริง. Deadline เปลี่ยนแล้วต้องข้าม stale disable และ stale notice. Admin disable บนบริษัทที่ term-disabled อยู่แล้วต้องเก็บเหตุ admin hold ที่ renewal ล้างไม่ได้; status DISABLED + marker เก่าลำพังไม่พอพิสูจน์ว่าเปิดคืนได้.
- **R02/R06:** authenticated recovery notice ของบริษัทที่เลือกต้องยังเข้าถึงได้เมื่อหมด term/term-disabled ตาม [P26 §14](mangmee-billing-subscription-spec-th.md#billing-recovery-contract); OWNER เห็นรายละเอียด, employee เห็นข้อความกลาง, business routes ยังคงปิด. ไม่เพิ่ม public route/ข้าม security hold; null ไม่มี term ต้องแยกจาก auth/network error และห้าม fallback บริษัทอื่น.
- **R07:** durable notification intent ต้องอยู่ครบก่อนถือว่า claim สำเร็จ; worker retry แยกจาก term/lifecycle. คำว่า exactly-once ใน §6 หมายถึง dedupe business event ต่อ company/term/point ไม่ใช่รับประกันว่า LINE/email จะถูกส่งทางเครือข่ายครั้งเดียว. ต้องกู้ได้ทั้งก่อน event persistence และหลัง event ก่อน recipient/delivery, ตรวจ flag/claim กับ current period ไม่ส่ง warning ของรอบที่ต่ออายุไปแล้ว.
- ห้ามใช้ batch activate/ล้าง marker เพื่อซ่อม R01 โดยไม่ตรวจประวัติ hold. เริ่มจาก read-only report แล้วซ่อมเฉพาะ operation ที่มีหลักฐานแน่นอน; กรณีแยก admin hold ไม่ได้ให้เป็นงานตรวจ ไม่เดา.
- Gates บังคับ: existing browser 8/8 + real PG 4/4 และ RG01–RG05 ในแผน P26 ต้องผ่าน โดยคง regression ของ no-term grandfathered company, quota/data/role/tenant isolation. ผลหลังแก้คือ browser 20/20 และ PG 15/15 รวม RG01–RG05; R07 fault injection ผ่านแล้ว. Paid invoice application ใช้ service period ใน P26 ไม่เรียก manual days renewal ทุก event.

Implementation evidence §9: Company lock ร่วมใน set/renew/lifecycle/sweep, atomic term/lifecycle/audit, transaction-bound NotificationEvent/Recipient/Delivery และ worker เดิม, selected-company recovery รวม password login/legal acceptance. มี [read-only legacy report](../evidence/stripe-repair-2026-09-11/inspect-legacy-recovery.sql) สำหรับ audit/term/status mismatch; report ไม่อนุมัติให้ activate ใครเอง. Production-source API/web typecheck ผ่าน; full API typecheck ยังติด 2 Buffer errors ใน expense test ที่ไม่ได้แก้ในงานนี้.
