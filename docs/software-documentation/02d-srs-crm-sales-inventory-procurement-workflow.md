# 02d — SRS: CRM / งานขาย / คลังสินค้า / จัดซื้อ / เวิร์กโฟลว์ / รายงานผู้บริหาร / จัดการร้านลูกค้า (AREA = `CRM`)

**วัตถุประสงค์** เอกสารนี้เป็น Software Requirements Specification ของโมดูล API `crm`, `crm-inbox`, `inventory`, `procurement`, `workflow`, `executive-business` และ `system-partner-management` พร้อมหน้าจอเว็บที่เกี่ยวข้อง ของระบบ MangmeePlus / WatchDog-BMS จัดทำเป็นบันทึกวิศวกรรมถาวรหลังปิดโครงการ (2026-11-16) เพื่อให้ทีมในอนาคตเข้าใจ สร้างใหม่ และดูแลระบบได้จากเอกสารนี้ร่วมกับซอร์สโค้ดที่เก็บถาวร เอกสารเริ่มจากการพิสูจน์จากโค้ดว่าฟีเจอร์ใด "ขายจริง" ในแพ็กถึง `ENTERPRISE_1999` แล้วลงรายละเอียดเชิงลึกเฉพาะส่วนที่อยู่ในขอบเขต ส่วนที่มีโค้ดแต่ไม่ได้ขายถูกรวบไว้ท้ายเอกสารแบบบรรทัดเดียวต่อรายการ

**ที่มา** checkout `closeout-docs-main` = `origin/main` commit `08850deaf` (2026-11-10) อ่านอย่างเดียว ยึดโค้ดเป็นความจริง เอกสารใน `docs/` ใช้ประกอบเจตนาเท่านั้น

---

## สารบัญ

1. [ผลการตัดสินขอบเขตจากโค้ด](#1-ผลการตัดสินขอบเขตจากโค้ด)
2. [ผู้ใช้ บทบาท และ permission keys](#2-ผู้ใช้-บทบาท-และ-permission-keys)
3. [ส่วน A — จัดการร้านลูกค้า (system-partner-management)](#3-ส่วน-a--จัดการร้านลูกค้า-system-partner-management)
4. [ส่วน B — อายุแพ็กเกจ ขีดจำกัด และโควตา (plan term)](#4-ส่วน-b--อายุแพ็กเกจ-ขีดจำกัด-และโควตา-plan-term)
5. [ส่วน C — รายงานผู้บริหาร (executive-business)](#5-ส่วน-c--รายงานผู้บริหาร-executive-business)
6. [ส่วน D — เครื่องยนต์เวิร์กโฟลว์เบื้องหลังที่ทำงานให้แพ็กที่ขาย](#6-ส่วน-d--เครื่องยนต์เวิร์กโฟลว์เบื้องหลังที่ทำงานให้แพ็กที่ขาย)
7. [ส่วน E — ชิ้นส่วนของ procurement ที่ฟีเจอร์ที่ขายเรียกใช้](#7-ส่วน-e--ชิ้นส่วนของ-procurement-ที่ฟีเจอร์ที่ขายเรียกใช้)
8. [State machines](#8-state-machines)
9. [ตาราง API endpoints ครบทุกเส้นของส่วนที่อยู่ในขอบเขต](#9-ตาราง-api-endpoints-ครบทุกเส้นของส่วนที่อยู่ในขอบเขต)
10. [หน้าจอเว็บ (web routes)](#10-หน้าจอเว็บ-web-routes)
11. [ข้อมูลที่เกี่ยวข้อง (Prisma models)](#11-ข้อมูลที่เกี่ยวข้อง-prisma-models)
12. [ข้อกำหนดที่ไม่ใช่ฟังก์ชัน (NFR)](#12-ข้อกำหนดที่ไม่ใช่ฟังก์ชัน-nfr)
13. [การทดสอบที่ครอบคลุม](#13-การทดสอบที่ครอบคลุม)
14. [นอกขอบเขตแพ็ก 1,999 (มีโค้ดแต่ไม่ได้ขาย)](#14-นอกขอบเขตแพ็ก-1999-มีโค้ดแต่ไม่ได้ขาย)
15. [สิ่งที่ตรวจไม่ได้ และสิ่งที่พบในเอกสารแต่ไม่พบในโค้ด](#15-สิ่งที่ตรวจไม่ได้-และสิ่งที่พบในเอกสารแต่ไม่พบในโค้ด)

---

## 1. ผลการตัดสินขอบเขตจากโค้ด

### 1.1 แหล่งความจริงของ "ขายอะไรในแพ็กไหน"

| สิ่งที่ดู | ไฟล์ | สาระ |
|---|---|---|
| รายการฟีเจอร์และเมนูย่อย | `packages/contracts/src/feature-entitlements.ts` (`FEATURE_CATALOG`) | 20 feature keys ระดับบน, `sellable: false` เฉพาะ `employee_access`, `company_settings` |
| เมนู ↔ ฟีเจอร์ ↔ สถานะ | `packages/contracts/src/menu-entitlements.ts` (`MENU_ENTITLEMENT_BINDINGS`) | `status: 'ready' \| 'planned'` |
| ชุดฟีเจอร์ของแต่ละแพ็ก | `packages/contracts/src/menu-entitlements.ts:496-501` (`TIER_FEATURE_PRESETS`) | ดูตารางถัดไป |
| ฟีเจอร์ที่ดีลของเซลล์ขายได้ | `menu-entitlements.ts:504-508` (`SALES_DEAL_ALLOWED_FEATURE_KEYS`) | starter + `wht_pnd53` + `wht_50bis` เท่านั้น |
| จุดบังคับใช้ | `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts` | ตัด permission ของฟีเจอร์ที่ปิดออกตอน resolve สิทธิ์ (รวม OWNER) |

`TIER_FEATURE_PRESETS` ตามโค้ด:

| แพ็ก | feature keys |
|---|---|
| `STARTER_249`, `BASIC_499`, `PRO_999` | ชุด starter: `dashboard_notifications`, `expenses` (+`.list`, `.upload`, `.manual`, `.categories`, `.evidence`, `.signatures`), `reimbursement`, `ai_line_assistant`, `employee_access` (+`.employees`, `.roles`, `.overview`), `company_settings` (+`.branches`, `.security`) |
| `ENTERPRISE_1999` | ชุด starter + `wht_pnd53` + `wht_50bis` |
| `FREE_TRIAL_15` | ไม่มีใน `TIER_FEATURE_PRESETS` (type เป็น `Exclude<PlanTierKey,'FREE_TRIAL_15'>`); การสมัครเองใช้ชุด starter ผ่าน `FEATURE_PACKAGE_PRESETS.starter` ใน `apps/api/src/modules/system-onboarding/application/use-cases/create-company-onboarding.use-case.ts:593-595` |

**ข้อสรุปหลัก:** ไม่มี feature key ใดของ `crm`, `inventory`, `product_catalog`, `line_oa`, `procurement`, `workflow_automation`, `sales_documents` อยู่ในแพ็กใดเลย ทั้งห้าระดับ ฟีเจอร์เหล่านี้เปิดได้ทางเดียวคือ System Admin เปิดรายร้านด้วยมือจากหน้า `/system/partners/[companyId]` (ชุด "มาตรฐาน"/"ครบวงจร" ของ `FEATURE_PACKAGE_PRESETS` หรือสวิตช์รายตัว) ซึ่งเป็นความสามารถของผู้ดูแลแพลตฟอร์ม ไม่ใช่ของที่ขายในแพ็ก

### 1.2 ผลตัดสินรายโมดูล

| โมดูล API | feature key ที่คุม | อยู่ในแพ็กใด | สถานะเมนู (`navKey`: status) | ผลตัดสิน |
|---|---|---|---|---|
| `crm` | `crm` (+`crm.overview`, `.leads`, `.pipeline`, `.followups`, `.customers`, `.bookings`) | ไม่มี | `crm`: ready, `customers`: ready, `booking`: ready, `crmreport`: planned, `discount`: planned | **นอกขอบเขต** (§14) |
| `crm-inbox` | `crm.inbox`; `line_oa` (prefix `crm.channel.`); `ai_line_assistant` (prefix `crm.ai.`) | `crm.inbox`/`line_oa` ไม่มี; `ai_line_assistant` มีทุกแพ็ก แต่ทุก endpoint ที่ใช้ `crm.ai.assist` อยู่ใต้ข้อมูลของ `crm.inbox` | `inbox`: ready, `lineoa`: ready | **นอกขอบเขต** (§14) |
| `inventory` | `inventory` (+`.locations`, `.movements`, `.stock_report`); `product_catalog` (prefix `inventory.product.`) | ไม่มี | `inventory`: ready, `crmsettings` (สินค้าและบริการ): ready | **นอกขอบเขต** (§14) |
| `procurement` | `procurement` (+7 เมนูย่อย) | ไม่มี | `procurement`: ready, `accounts-payable`: ready, `poapproval`: planned | **นอกขอบเขต** ยกเว้นชิ้นส่วน 2 ชิ้นที่ฟีเจอร์ที่ขายเรียกใช้ (§7) |
| `workflow` | `workflow_automation` (+6 เมนูย่อย) | ไม่มี | `workflow`: ready | **เมนู/หน้าจอ/API ของผู้ใช้อยู่นอกขอบเขต** แต่ **เครื่องยนต์เบื้องหลังอยู่ในขอบเขต** เพราะทำงานให้ทุกร้านโดยไม่ตรวจ entitlement และเป็นตัวส่งแจ้งเตือนการเบิกจ่าย (`reimbursement` ขายทุกแพ็ก) (§6) |
| `executive-business` | ไม่ผูก feature key; ใช้ permission `system.executive.*` ในบริษัทแพลตฟอร์ม | เป็นพื้นผิวของแพลตฟอร์มเพื่อบริหารการขายแพ็ก | ไม่อยู่ใน `MENU_ENTITLEMENT_BINDINGS` (เส้นทาง `/system/executive/*`) | **ในขอบเขต** (§5) |
| `system-partner-management` | ไม่ผูก feature key; ใช้ permission `system.partner_*` | เป็นพื้นผิวของ System Admin เพื่อดูแลร้านและแพ็ก | เส้นทาง `/system/*` | **ในขอบเขต** (§3, §4) |

หมายเหตุสำคัญสำหรับผู้สร้างระบบใหม่:

- ค่าตั้งต้นเก่า `DEFAULT_ENABLED_FEATURE_KEYS` (`apps/api/src/modules/system-partner-management/domain/feature-registry.ts:27-40`) ยังรวม `crm`, `line_oa`, `product_catalog`, `thai_tax`, `double_entry_ledger`, `workflow_automation` ไว้ แต่จะถูกใช้เฉพาะเมื่อ onboarding ถูกเรียกด้วย `modulePackage` ที่ไม่ใช่ `'starter'` และไม่ส่ง `entitledFeatureKeys` (`create-company-onboarding.use-case.ts:593-601`) ค่าปริยายของ `modulePackage` คือ `'starter'` จึงไม่ใช่เส้นทางขายปกติ
- บริษัทที่ไม่มีแถว `CompanyFeatureEntitlement` เลยถือเป็น legacy และ "เปิดทุกอย่าง" (fail-open) ตาม `evaluateEntitledFeatureKeys` (`apps/api/src/modules/employee-access/application/entitlement.helper.ts`) ทุกบริษัทที่สร้างผ่าน onboarding ปัจจุบันมีแถวครบทุก key จึงเป็น deny-by-default
- "marketing platforms" ที่ระบุในโจทย์: ค้นคำว่า marketing platform ใน `apps/api/src`, `apps/web/src`, `packages/contracts/src` ไม่พบ มีเพียง `MARKETPLACE` เป็นค่า enum ของแหล่งที่มาลูกค้า/ลีด ไม่มีโมดูลเชื่อมต่อแพลตฟอร์มการตลาด

---

## 2. ผู้ใช้ บทบาท และ permission keys

### 2.1 บทบาท

| บทบาท | ที่มา | ใช้กับส่วนใด |
|---|---|---|
| `SYSTEM_ADMIN` (role ระบบ, `scopeKey: 'system'`, `companyId: null`) | สมาชิกของบริษัทแพลตฟอร์ม `PLATFORM_TENANT_ID = 'seed-watchdog-system-company'` (`apps/api/src/modules/sales-console/application/sales-context.ts:20`) | ส่วน A, B ทั้งหมด; จัดการบัญชีผู้บริหาร |
| `MANGMEE_EXECUTIVE` (+ role เสริม `MANGMEE_EXECUTIVE_EXPORT`, `MANGMEE_EXECUTIVE_CONTACT`, `MANGMEE_EXECUTIVE_COMPANY_NOTE`) | `EXECUTIVE_ROLE_KEYS` ใน `packages/contracts/src/executive-business.ts:8` | ส่วน C (อ่านรายงาน, ส่งออก, เห็นช่องทางติดต่อ, แก้บันทึกทีม) |
| `OWNER` และผู้ถือ `company.plan.manage` ของร้านลูกค้า | role ของร้าน | รับแจ้งเตือนอายุแพ็ก, เห็นแบนเนอร์/หน้าหมดอายุ |
| สมาชิกร้านทุกคน | — | เรียก `GET /v1/plan-term/notice` |
| worker (ไม่มีผู้ใช้) | header `x-worker-token` ตรวจด้วย `assertWorkerToken` | เส้นทาง `internal/*` |

### 2.2 Permission keys ของส่วนที่อยู่ในขอบเขต

ระดับความเสี่ยงอ่านจาก permission registry (grep `key: 'system.…'` ใน `apps/api/src`)

| Permission key | ระดับ | ใช้คุม |
|---|---|---|
| `system.partner_dashboard.read` | MEDIUM | รายการร้าน, รายละเอียดร้าน, อ่านบันทึกทีม, มิเตอร์ AI, รายการเครดิตค้าง, อ่าน plan term และประวัติ |
| `system.partner_company.update` | MEDIUM | แก้โปรไฟล์ร้าน, เขียนบันทึกทีม (ต้องเป็น `SYSTEM_ADMIN` ด้วย), ตอบ VAT, ตั้ง/ต่ออายุ/ยุติ warm-up ของ plan term, ส่งข้อความ LINE ถึงร้าน, คิวคำขอเปลี่ยนแพ็กเกจ |
| `system.partner_company.lifecycle.manage` | CRITICAL | เปลี่ยนสถานะร้าน ACTIVE/DISABLED/ARCHIVED |
| `system.partner_feature.manage` | HIGH | ตั้ง feature entitlements, สวิตช์ทางเข้าเว็บของ "บันทึกด้วยมือ" และ "ใบสำคัญจ่าย" |
| `system.partner_ai_model.manage` | HIGH | ตั้งโมเดล/งบ AI รายร้าน, ตั้ง OCR, จัดการเครดิตค้าง, ประวัติการปรับ AI, งบ AI ระดับแพลตฟอร์ม |
| `system.partner_member.read` | HIGH | รายชื่อสมาชิกร้าน, ค้นหาผู้ใช้ข้ามร้าน |
| `system.partner_member.manage` | CRITICAL | ยกเลิกผูก LINE, ออก QR ผูก LINE ใหม่, รีเซ็ต/เปิดดูรหัสผ่านชั่วคราว, แก้ช่องทางติดต่อ/ชื่อที่แสดง |
| `system.identity_reconciliation.resolve` | CRITICAL | อ่าน/แก้ตัวตนทางกฎหมายของร้าน (ชื่อจดทะเบียน เลขผู้เสียภาษี ที่อยู่), ตัวเลือกที่อยู่ไทย |
| `system.company_onboarding.read` | MEDIUM | ไทม์ไลน์ของร้าน |
| `system.shared_line_credential.manage` | CRITICAL | อ่านสถานะ/หมุนกุญแจ LINE Messaging API ของ OA กลาง |
| `system.partner_line_credential.manage` | CRITICAL | มี permission และ use case (`SetPartnerLineCredentialUseCase`) แต่ **ไม่มี controller route เรียกใช้** (ดู §15) |
| `system.executive.read` | MEDIUM | อ่านรายงานผู้บริหารทุกหน้า |
| `system.executive.export` | HIGH | ส่งออก XLSX |
| `system.executive.contact.read` | HIGH | เห็นอีเมล/เบอร์ของเจ้าของร้านในรายงานและไฟล์ส่งออก |
| `system.executive_user.manage` | CRITICAL | จัดการบัญชีผู้บริหาร |
| `system.executive.company_note.manage` (ค่าคงที่ `COMPANY_TEAM_NOTE_MANAGE_PERMISSION` ใน `packages/contracts/src/company-team-note.ts:3`) | — | แก้บันทึกทีมจากหน้ารายงานผู้บริหาร (ข้อความยาวไม่เกิน `COMPANY_TEAM_NOTE_MAX_LENGTH = 1,000`) |
| `account.session.read` | — | `GET /v1/plan-term/notice` |
| `company.plan.manage` | — | ตัดสินว่าใครได้รับแจ้งเตือนอายุแพ็กและเห็นปุ่มซื้อ |

กติการ่วมของทุกเส้นทาง `system/*`:

- พารามิเตอร์ชื่อ `:partnerCompanyId` / `:targetCompanyId` โดยเจตนา ไม่ใช้ `:companyId` เพราะ AuthGuard ตีความ `companyId` เป็นขอบเขต tenant และจะเรียกร้อง membership ในร้านลูกค้า ซึ่ง System Admin ต้องไม่มี (`partner.controller.ts:360-363`)
- เส้นทางรายงานผู้บริหารและ address-master เรียก `assertPlatformTenant(ctx)` เพิ่ม: ผู้เรียกต้องอยู่ในบริบทบริษัทแพลตฟอร์ม มิฉะนั้น 403 `sales_console_platform_tenant_required`

---

## 3. ส่วน A — จัดการร้านลูกค้า (system-partner-management)

ทุก FR ในส่วนนี้: **แพ็กที่ได้ใช้** = ไม่ใช่ฟีเจอร์ของร้านลูกค้า เป็นพื้นผิวของ System Admin ที่ใช้ดูแลร้านทุกแพ็ก (`FREE_TRIAL_15` ถึง `ENTERPRISE_1999`) หน้าจอหลักคือ `/system/partners` และ `/system/partners/[companyId]` โค้ด API อยู่ใต้ `apps/api/src/modules/system-partner-management/` (ต่อไปเรียกย่อ `SPM/`)

### FR-CRM-001 รายการร้านลูกค้า

- **คำอธิบาย** แสดงร้านทั้งหมดแบบแบ่งหน้า พร้อมค้นหาและกรอง (ข้อมูลเมตาเท่านั้น ไม่มีข้อมูลธุรกิจของร้าน)
- **ผู้ใช้ / permission** System Admin — `system.partner_dashboard.read`
- **เงื่อนไขก่อนทำ** ล็อกอินในบริบทบริษัทแพลตฟอร์ม
- **ขั้นตอนหลัก** เปิด `/system/partners` → เรียก `GET /v1/system/partners?q&status&page&pageSize&reportClassification&reportIndustryGroup` → เรียงตาม `createdAt desc, id asc`
- **กฎธุรกิจ** ค้น `q` แบบไม่สนตัวพิมพ์ในชื่อร้านและชื่อจดทะเบียน; แต่ละแถวคำนวณ `planState` ด้วย `planTermState(planTerm, now, status)` และนับฟีเจอร์ที่เปิด/สมาชิก ACTIVE/การผูก LINE
- **การตรวจสอบ** `page ≥ 1`, `1 ≤ pageSize ≤ 100` (ปริยาย 20), `q` ไม่เกิน 120 ตัวอักษร, `status ∈ {ACTIVE, DISABLED, ARCHIVED, SUSPENDED}` ไม่ผ่านตอบ 422
- **ข้อมูล** `Company`, `CompanyPlanTerm`, `CompanyFeatureEntitlement`, `CompanyMembership`, `ExternalIdentity`
- **API** `GET /v1/system/partners`
- **หน้าจอ** `/system/partners` (`apps/web/src/features/system-partners/PartnerListPage.tsx`)
- **ทดสอบ** `SPM/presentation/http/partner.controller.spec.ts`, `e2e/system-admin.spec.ts`
- **หลักฐาน** `SPM/application/use-cases/list-partners.use-case.ts:36-139`

### FR-CRM-002 รายละเอียดร้านลูกค้า

- **คำอธิบาย** อ่านข้อมูลเมตาของร้านหนึ่งร้าน: โปรไฟล์ สถานะ วันเวลาเปิด/ปิด/เก็บถาวร รายการ feature entitlement พร้อม `setVersion`, การตั้งค่า AI/OCR, สวิตช์ทางเข้าเว็บ, ป้ายรายงาน, เซลล์ผู้แนะนำ, ผู้แก้ไขล่าสุด
- **ผู้ใช้ / permission** `system.partner_dashboard.read`
- **กฎธุรกิจ** ค่าที่ใช้เป็น CAS token ของคำสั่งเขียน (เช่น `setVersion`, เวอร์ชัน OCR, เวอร์ชันสวิตช์ทางเข้าเว็บ) มาจากคำตอบนี้; ไม่พบร้านตอบ 404
- **ข้อมูล** `Company`, `CompanyMembership`, `Role`, `SalesAgentProfile`, `User`, `AuditLog`
- **API** `GET /v1/system/partners/:partnerCompanyId`
- **หน้าจอ** `/system/partners/[companyId]` (`PartnerDetailPage.tsx`)
- **ทดสอบ** `partner.controller.spec.ts`, `e2e/system-admin.spec.ts`
- **หลักฐาน** `SPM/application/use-cases/get-partner-detail.use-case.ts`

### FR-CRM-003 แก้โปรไฟล์ร้านและป้ายรายงาน

- **คำอธิบาย** แก้ `name`, `brandName`, `timezone`, `locale`, `phone`, `email` และป้ายที่ใช้ในรายงานผู้บริหาร `reportClassification` (`CUSTOMER`/`TEST`/`INTERNAL`; `null` = ล้าง) กับ `reportIndustryGroup`
- **ผู้ใช้ / permission** `system.partner_company.update`
- **กฎธุรกิจ** ร้านที่ `DISABLED` (แบบผู้ดูแลสั่งพัก) หรือ `ARCHIVED` แก้ไม่ได้ ตอบ 422 ด้วยข้อความจาก `partnerMetadataLockError` (`SPM/domain/logic/partner-lock.logic.ts`); ค่า `DEMO` ของ `reportClassification` ไม่อยู่ในตัวเลือกของ DTO นี้ (ร้านเดโมถูกตั้งโดย `sales-demo`)
- **การตรวจสอบ** `UpdateProfileBodyDto` (`partner.controller.ts:87-97`)
- **ข้อมูล** `Company`, `AuditLog` (action `system.partner_company.update`)
- **API** `PATCH /v1/system/partners/:partnerCompanyId`
- **หน้าจอ** `/system/partners/[companyId]` (`PartnerReportLabels.tsx`)
- **ทดสอบ** `SPM/application/use-cases/update-partner-profile.use-case.spec.ts`, `SPM/report-labels.pg.spec.ts`, `apps/web/src/features/system-partners/report-labels.logic.spec.ts`

### FR-CRM-004 แก้ตัวตนทางกฎหมายของร้าน

- **คำอธิบาย** อ่าน CAS token และชนิดการแก้ที่อนุญาต แล้วแก้ชื่อจดทะเบียน เลขประจำตัวผู้เสียภาษี และ/หรือที่อยู่ของร้านแทนลูกค้า
- **ผู้ใช้ / permission** `system.identity_reconciliation.resolve` (ตั้งใจให้สูงกว่า `system.partner_company.update`)
- **ขั้นตอนหลัก** `GET …/identity` → กรอกฟอร์ม (ตัวเลือกที่อยู่จาก `GET /v1/system/partners/address-master?postalCode=`) → `PATCH …/identity`
- **กฎธุรกิจ** ต้องส่ง `expectedLegalIdentityVersion`, `changeKind` (`USER_LEGAL_IDENTITY_CHANGE_KINDS`), `reason` (บังคับ, ≤ 500); ผูกกับคำขอช่วยเหลือได้ด้วย `supportRequestId`; ร้านที่ sweep ปิดเพราะหมดอายุ (`termDisabledAt` มีค่า) ยังแก้ตัวตนได้ ส่วนร้านที่ผู้ดูแลสั่งพักหรือ `ARCHIVED` แก้ไม่ได้
- **ข้อผิดพลาด** 409 เมื่อ `legalIdentityVersion` เก่า; 422 เมื่อร้านถูกพักโดยผู้ดูแล/เก็บถาวร หรือ `changeKind` ไม่อนุญาต
- **การตรวจสอบ** `PartnerIdentityBodyDto`: `taxId ≤ 32`, `registeredName ≤ 255`, `note ≤ 500`, `evidenceRef ≤ 200`, `correctionReason ∈ LEGAL_IDENTITY_CORRECTION_REASONS`
- **ข้อมูล** `Company`, `CompanyLegalIdentityRevision`, `AuditLog` (action `system.partner_company.identity_update`)
- **API** `GET /v1/system/partners/address-master`, `GET|PATCH /v1/system/partners/:partnerCompanyId/identity`
- **หน้าจอ** `/system/partners/[companyId]`
- **ทดสอบ** `SPM/application/use-cases/update-partner-identity.use-case.spec.ts`

### FR-CRM-005 บันทึกทีมของร้าน (company team note)

- **คำอธิบาย** ข้อความภายในของทีมแพลตฟอร์มต่อร้าน อ่านได้จากหน้าพาร์ทเนอร์และหน้ารายงานผู้บริหาร
- **ผู้ใช้ / permission** อ่าน `system.partner_dashboard.read`; เขียนผ่านหน้าพาร์ทเนอร์ต้องมี `system.partner_company.update` **และ** role `SYSTEM_ADMIN` (มิฉะนั้น 403 `company_team_note_edit_denied`); เขียนผ่านหน้ารายงานผู้บริหารต้องมี `system.executive.read` + `system.executive.company_note.manage` (FR-CRM-043)
- **กฎธุรกิจ** optimistic concurrency ด้วย `expectedVersion`; ตอบ `Cache-Control: no-store`
- **ข้อผิดพลาด** `company_team_note_company_not_found`, `company_team_note_invalid`, `company_team_note_too_long`, `company_team_note_version_conflict`, `company_team_note_save_unconfirmed`, `company_team_note_read_denied`
- **ข้อมูล** `CompanyTeamNote`, `AuditLog` (action `system.company_team_note.update`, MEDIUM)
- **API** `GET|PUT /v1/system/partners/:partnerCompanyId/team-note`
- **หน้าจอ** `/system/partners/[companyId]` (`PartnerTeamNote.tsx`), `/system/executive/companies/[targetCompanyId]` (`ExecutiveCompanyNote.tsx`)
- **ทดสอบ** `apps/web/src/features/system-partners/company-team-note.spec.ts`
- **หลักฐาน** `SPM/application/company-team-note.service.ts`, `partner.controller.ts:373-388`

### FR-CRM-006 เปลี่ยนสถานะวงจรชีวิตของร้าน

- **คำอธิบาย** สั่งเปิดใช้งาน (`ACTIVE`), พัก (`DISABLED`) หรือเก็บถาวร (`ARCHIVED`) ร้าน
- **ผู้ใช้ / permission** `system.partner_company.lifecycle.manage`
- **ขั้นตอนหลัก** กดปุ่มในหน้ารายละเอียด → ยืนยันใน modal → `POST …/lifecycle { targetStatus, reason? }`
- **กฎธุรกิจ** (`SPM/application/use-cases/partner-lifecycle-transition.use-case.ts`)
  1. ทำใน transaction เดียวและล็อกแถว `Company` ด้วย `SELECT … FOR UPDATE` ก่อน (`lockPlanTermCompany`)
  2. `SUSPENDED` เป็นสถานะด้านความปลอดภัย ไม่รับเป็นเป้าหมาย → 422
  3. คนสั่ง `ACTIVE` ขณะที่ plan term หมดแล้ว (`termEndsAt ≤ now`) → 409 `partner_activation_term_locked` พร้อมข้อความแยกกรณี `no_package` กับหมดอายุ (เพราะ sweep จะปิดกลับภายใน ~5 นาที)
  4. คนสั่งเป้าหมายที่ไม่ใช่ `ACTIVE` จะล้าง `CompanyPlanTerm.termDisabledAt` เป็น `null` เพื่อให้การต่ออายุภายหลังไม่ปลดการพักที่คนสั่ง
  5. ตราเวลา: `ACTIVE` ตั้ง `activatedAt = now` และล้าง `disabledAt`, `archivedAt`; `DISABLED` ตั้ง `disabledAt = now` ล้าง `archivedAt`; `ARCHIVED` ตั้ง `archivedAt = now`
- **ข้อมูล** `Company`, `CompanyPlanTerm`, `AuditLog` (action `system.partner_company.lifecycle.transition`, CRITICAL, metadata `{fromStatus,toStatus,reason}`; `actorUserId = null` เมื่อ sweep เป็นผู้ทำ)
- **API** `POST /v1/system/partners/:partnerCompanyId/lifecycle` (200)
- **หน้าจอ** `/system/partners/[companyId]` (LifecycleConfirmModal ใน `PartnerDetailPage.tsx`)
- **ทดสอบ** `SPM/application/use-cases/partner-lifecycle-transition.use-case.spec.ts`
- **State machine** §8.1

### FR-CRM-007 รายชื่อสมาชิกของร้าน

- **คำอธิบาย** แสดงสมาชิก บทบาท สถานะการผูก LINE และสถานะรหัสผ่านของร้าน
- **ผู้ใช้ / permission** `system.partner_member.read`
- **ข้อมูล** `Company`, `CompanyMembership`
- **API** `GET /v1/system/partners/:partnerCompanyId/members` (404 เมื่อไม่พบร้าน)
- **หน้าจอ** `/system/partners/[companyId]` (ส่วนสมาชิก)
- **ทดสอบ** `SPM/application/use-cases/partner-member-console.use-cases.spec.ts`

### FR-CRM-008 ยกเลิกการผูก LINE ของสมาชิก

- **ผู้ใช้ / permission** `system.partner_member.manage`
- **กฎธุรกิจ** ต้องมี membership ในร้านนั้นและ `ExternalIdentity` LINE สถานะ `ACTIVE`; อัปเดตแบบ CAS ด้วย `updatedAt` เป็น `UNLINKED` (ชนกันตอบ 409 `line_identity_changed`); เพิกถอน `PasswordResetToken` ที่ `PENDING` และลิงก์ handoff จาก LINE ที่ค้าง; ล้างบริบทร้านของ LINE (`LineCompanyContext`)
- **ข้อผิดพลาด** 404 เมื่อสมาชิกไม่อยู่ในร้าน หรือไม่มี LINE ที่ผูกอยู่
- **ข้อมูล** `ExternalIdentity`, `LineCompanyContext`, `PasswordResetToken`, `AuditLog` (action `system.partner_member.line_unlink`, HIGH)
- **API** `POST /v1/system/partners/:partnerCompanyId/members/:memberUserId/line-unlink`
- **ทดสอบ** `partner-member-console.use-cases.spec.ts`

### FR-CRM-009 ออก QR ผูก LINE ใหม่ให้สมาชิก

- **ผู้ใช้ / permission** `system.partner_member.manage`
- **กฎธุรกิจ** ต้องมี membership `ACTIVE`; โทเค็นอายุ `OWNER_LINE_LINK_TOKEN_TTL_MS` (72 ชั่วโมง ไม่ใช่ 15 นาทีแบบพนักงานทั่วไป) ใช้ได้ครั้งเดียว; โทเค็น `PENDING` เดิมของ membership เดียวกันถูกตั้งเป็น `REVOKED`; URL ฐานมาจาก `trustedPublicApiBase(req)`
- **ข้อมูล** `EmployeeLineLinkToken`, `AuditLog` (action `system.partner_member.line_link_token.issue`, CRITICAL)
- **API** `POST /v1/system/partners/:partnerCompanyId/members/:memberUserId/line-link-token`
- **ทดสอบ** `SPM/application/use-cases/partner-member-line-link-token.use-case.spec.ts`

### FR-CRM-010 รีเซ็ตรหัสผ่านชั่วคราวของสมาชิก

- **ผู้ใช้ / permission** `system.partner_member.manage`
- **กฎธุรกิจ** สร้างรหัสผ่านชั่วคราวใหม่ ตั้ง `UserCredential.status = TEMPORARY`, บังคับเปลี่ยนรหัสผ่าน, มีวันหมดอายุ (`temporaryPasswordExpiry`); คืนรหัสให้เห็นครั้งเดียวและเก็บแบบเข้ารหัสไว้สำหรับ "เปิดดู"; เพิกถอนทุก session ที่ยังใช้งานของผู้ใช้นั้น
- **ข้อผิดพลาด** 404 เมื่อสมาชิกไม่อยู่ในร้านหรือไม่มี credential
- **ข้อมูล** `UserCredential`, `AuthSession`, `AuditLog` (action `system.partner_member.password.reset`, CRITICAL, metadata มี `revokedSessionCount`)
- **API** `POST …/members/:memberUserId/password/reset`
- **ทดสอบ** `partner-member-console.use-cases.spec.ts`

### FR-CRM-011 เปิดดูรหัสผ่านชั่วคราวที่ระบบออกให้

- **ผู้ใช้ / permission** `system.partner_member.manage`
- **กฎธุรกิจ** เปิดดูได้เฉพาะรหัสชั่วคราวที่ระบบสร้างและยังเก็บอยู่; ผู้ใช้เปลี่ยนรหัสเองแล้วหรือถอดรหัสไม่ได้ ตอบ 404 พร้อมคำแนะนำให้รีเซ็ต; บันทึก audit ทุกครั้งที่เปิดดู
- **ข้อมูล** `UserCredential`, `AuditLog` (action `system.partner_member.password.reveal`, CRITICAL)
- **API** `POST …/members/:memberUserId/password/reveal`
- **ทดสอบ** `partner-member-console.use-cases.spec.ts`

### FR-CRM-012 แก้อีเมล/เบอร์โทรของสมาชิก

- **ผู้ใช้ / permission** `system.partner_member.manage`
- **กฎธุรกิจ** อีเมลที่ตั้งกลายเป็นตัวระบุสำหรับล็อกอิน; ต้องส่งอย่างน้อยหนึ่งช่อง
- **การตรวจสอบ / ข้อผิดพลาด** `email ≤ 254`, `phoneNumber ≤ 20`; รูปแบบผิด 422; ไม่มีอะไรให้แก้ 422 (`Nothing to update.`); อีเมลซ้ำกับผู้ใช้อื่น 409
- **ข้อมูล** `User`, `AuditLog` (action `system.partner_member.contact_update`, HIGH)
- **API** `PATCH …/members/:memberUserId/contact`
- **ทดสอบ** `partner-member-console.use-cases.spec.ts`

### FR-CRM-013 แก้ชื่อที่แสดงของบัญชีเจ้าของร้าน

- **ผู้ใช้ / permission** `system.partner_member.manage`
- **กฎธุรกิจ** ส่ง `displayName` ใหม่พร้อม `expectedDisplayName` (ค่าเดิมที่เห็น) เป็น CAS
- **ข้อผิดพลาด** 422 `partner_owner_name_invalid`, 404 `partner_owner_name_unavailable`, 409 `partner_owner_name_conflict`
- **ข้อมูล** `User`, `AuditLog` (action `system.partner_member.display_name_update`, HIGH)
- **API** `PATCH …/members/:memberUserId/display-name`
- **หลักฐาน** `SPM/application/use-cases/set-partner-owner-name.use-case.ts`

### FR-CRM-014 ค้นหาผู้ใช้ข้ามร้าน

- **คำอธิบาย** ค้นบัญชีผู้ใช้จากชื่อ/ตัวระบุเพื่อช่วยงานซัพพอร์ต พร้อมร่องรอยการรวมบัญชี (`AUTH_ACCOUNT_MERGE`)
- **ผู้ใช้ / permission** `system.partner_member.read`
- **การตรวจสอบ** ความยาวคำค้น 2..120 ตัวอักษร (`USER_LOOKUP_MIN_QUERY = 2`, `USER_LOOKUP_MAX_QUERY = 120`); สถานะที่กรองต้องถูกต้อง มิฉะนั้น 422; ผลลัพธ์สูงสุด 20 รายการ (`RESULT_LIMIT`) และร่องรอยการรวมบัญชีสูงสุด 5 รายการต่อผู้ใช้ (`MERGE_TRAIL_LIMIT`)
- **ข้อมูล** `User`, `ExternalIdentity`, `AuditLog`
- **API** `GET /v1/system/users/lookup`
- **หน้าจอ** `/system/partners` (`UserLookupSection.tsx` ฝังใน `PartnerListPage.tsx`); `/system/users` เป็น redirect ไป `/system/partners` เพื่อให้ลิงก์เก่ายังใช้ได้ (`apps/web/app/system/users/page.tsx`)
- **ทดสอบ** `SPM/application/use-cases/lookup-users.use-case.spec.ts`

### FR-CRM-015 ตั้ง feature entitlements ของร้าน

- **คำอธิบาย** เปิด/ปิดฟีเจอร์และเมนูย่อยรายร้าน นี่คือกลไกเดียวที่ทำให้ร้านได้ใช้ฟีเจอร์นอกแพ็ก (CRM, คลัง, จัดซื้อ, เวิร์กโฟลว์ ฯลฯ)
- **ผู้ใช้ / permission** `system.partner_feature.manage`
- **เงื่อนไขก่อนทำ** ร้านไม่ถูกล็อกเมตาดาตา; การ normalize entitlement ของร้านเสร็จที่เวอร์ชันปัจจุบันและมี `cohortKind`
- **ขั้นตอนหลัก** หน้าเว็บเลือกชุดสำเร็จรูป (`เริ่มต้น`, `มาตรฐาน`, `ครบวงจร`, `แพ็กเกจ 1999` ใน `apps/web/src/features/system-partners/system-partners.logic.ts:42-45`) หรือสลับรายตัว → `PUT …/features { features[], commandId, expectedSetVersion, confirmCascade? }`
- **กฎธุรกิจ** (`SPM/application/use-cases/set-partner-features.use-case.ts`)
  1. **Idempotency ทั้งคำสั่ง:** `commandId` เดิม + payload เดิม (fingerprint SHA-256 ของรายการที่เรียงแล้ว + `confirmCascade`) คืนผลเดิมจาก `EntitlementCommand.resultJson`; `commandId` เดิมแต่ payload ต่าง → 409 `entitlement_command_conflict` การ replay ตรวจก่อนสถานะร้าน/normalization เพื่อให้คำสั่งที่ commit แล้ว replay ได้เสมอ
  2. **CAS:** `expectedSetVersion` ต้องตรง `CompanyEntitlementSet.setVersion` มิฉะนั้น 409 `entitlement_set_version_conflict`; สำเร็จแล้ว `setVersion + 1`
  3. **ฟีเจอร์พื้นฐานของแพลตฟอร์ม** (`employee_access`, `company_settings` และเมนูย่อย) ปิดไม่ได้ → 422 `platform_feature_not_disableable`
  4. **เมทริกซ์การพึ่งพา** (`FEATURE_DEPENDENCIES`): `expense_auto_post ⇒ double_entry_ledger`, `procurement.supplier_payments ⇒ procurement.vendor_bills`, `procurement.ap_aging ⇒ procurement.vendor_bills` เปิดลูกโดยพ่อปิดในคำขอเดียวกัน → 422; ปิดพ่อขณะลูกยังเปิด → 422 `feature_cascade_confirmation_required` พร้อม `impact`; ส่ง `confirmCascade: true` จึงปิดลูกพร้อมกันแบบ atomic; เหลือค้างอีก → 422 `feature_cascade_incomplete`
  5. **`expense_auto_post`** เปิดได้เมื่อ `ChartReadinessService` รายงาน `readyForAutomaticPosting` มิฉะนั้น 422 `coa_posting_readiness_incomplete`
  6. **Freeze in place** (มติเจ้าของ 2026-08-04): การปิดไม่ถูกปฏิเสธเพราะมีงานค้าง ข้อมูลเดิมคงอยู่และหยุดนิ่ง เปิดใหม่ทำงานต่อจากเดิม
  7. ใช้ advisory lock แบบ exclusive ต่อร้าน (`exclusiveEntitlementLock`); แต่ละแถวมี `epoch` (เพิ่มเมื่อเปลี่ยนจากไม่เปิด→เปิดจริง) และ `lastSeq`; บันทึก `EntitlementTransition` (`ENABLE` / `DISABLE_REQUESTED` / `OFF`) และ `RunoffSnapshot` สำหรับการปิดจริง แล้วเรียก `completeRunoffIfDrained` หลัง commit (ล้มเหลวไม่กระทบผลคำสั่ง)
  8. เมื่อค่าที่มีผลจริงเปลี่ยน จะล้างสถานะบทสนทนา LINE AI ของร้าน (`invalidateLineConversationState`)
- **การตรวจสอบ / ข้อผิดพลาด** `entitlement_features_required`, `entitlement_feature_batch_too_large`, `entitlement_feature_invalid`, `entitlement_feature_duplicate`, `entitlement_feature_unknown`, `entitlement_command_id_required`, `entitlement_set_version_required` (422); `company_entitlement_normalization_pending` (409); ร้านถูกล็อก (422); ไม่พบร้าน (404)
- **ข้อมูล** `CompanyFeatureEntitlement`, `CompanyEntitlementSet`, `EntitlementCommand`, `EntitlementTransition`, `RunoffSnapshot`, `CompanyEntitlementNormalization`, `AuditLog` (action `system.partner_feature.update`, HIGH)
- **API** `PUT /v1/system/partners/:partnerCompanyId/features`
- **หน้าจอ** `/system/partners/[companyId]`
- **ทดสอบ** `SPM/application/use-cases/set-partner-features.use-case.spec.ts`, `apps/web/src/features/system-partners/system-partners.logic.spec.ts`, `packages/contracts/src/feature-entitlements.spec.ts`

### FR-CRM-016 สวิตช์ทางเข้าเว็บของ "บันทึกด้วยมือ"

- **คำอธิบาย** แสดง/ซ่อนทางเข้าหน้า manual expense บนเว็บของร้านหนึ่ง (เป็นการตั้งค่าหน้าจอ ไม่ใช่ entitlement)
- **ผู้ใช้ / permission** `system.partner_feature.manage`
- **กฎธุรกิจ** สถานะที่ต้องการแบบสัมบูรณ์ `{ enabled, expectedVersion }`; มีเวอร์ชันของตัวเอง ไม่กระทบ `setVersion`; ไม่มีช่องเหตุผล
- **ข้อผิดพลาด** 409 เมื่อเวอร์ชันเปลี่ยน; 422 เมื่อร้าน `DISABLED`/`ARCHIVED`
- **ข้อมูล** `CompanyWebEntrySetting`, `AuditLog` (action `system.partner_manual_expense_web_entry.update`)
- **API** `PUT …/manual-expense-web-entry`
- **ทดสอบ** `SPM/manual-expense-web-entry.pg.spec.ts`, `apps/web/src/features/system-partners/manual-web-entry-switch.qa.spec.ts`, `e2e/manual-expense-web-entry.spec.ts`

### FR-CRM-017 สวิตช์ทางเข้าเว็บของ "ใบสำคัญจ่าย"

- เหมือน FR-CRM-016 แต่สำหรับเอกสาร disbursement voucher
- **ข้อมูล** `CompanyWebEntrySetting`, `AuditLog` (action `system.partner_disbursement_voucher_web_entry.update`)
- **API** `PUT …/disbursement-voucher-web-entry`
- **หลักฐาน** `SPM/application/use-cases/set-partner-disbursement-voucher-web-entry.use-case.ts`, `SPM/domain/logic/disbursement-voucher-web-entry.logic.ts`

### FR-CRM-018 ตอบ/แก้สถานะจดทะเบียน VAT ของร้านแทนลูกค้า

- **ผู้ใช้ / permission** `system.partner_company.update`
- **กฎธุรกิจ** เรียกคำสั่งเดียวกับหน้าของร้านเอง (`CompanyVatRegistrationUseCase.put` ในโมดูล `data-model-core`) ด้วย `command: { kind: 'UPSERT_FACT', status, effectiveFrom }` จึงใช้ CAS, audit และพีชคณิตช่วงเวลาชุดเดียวกัน
- **การตรวจสอบ** `status ∈ VAT_FACT_STATUSES`, `effectiveFrom` บังคับ, `commandId ≤ 64`, `expectedVersion ≥ 0`; เวอร์ชันเคลื่อน 409
- **API** `PUT …/vat-registration`
- **หลักฐาน** `partner.controller.ts:672-687`

### FR-CRM-019 ตั้งโมเดล AI และงบ AI รายเดือนของร้าน

- **คำอธิบาย** ตั้ง `modelId` ที่อนุมัติ, งบรายเดือน (สตางค์) และนโยบายแบ่งงบ CHAT/OCR (`SHARED` หรือ `SPLIT`)
- **ผู้ใช้ / permission** `system.partner_ai_model.manage`
- **กฎธุรกิจ** (`SPM/application/use-cases/set-partner-ai-model.use-case.ts`)
  - อัปเดตบางส่วน: ช่องที่ไม่ส่ง = คงเดิม; `null` = ล้างค่า override ให้ใช้ค่าปริยายของแพลตฟอร์ม; `budgetPolicy: null` = ยกเลิกนโยบายที่รอมีผลเดือนถัดไป
  - ต้องส่งเหตุผล (`reason`, 1..`PARTNER_ADJUSTMENT_REASON_MAX_LENGTH`) และค่าก่อนหน้าที่คาดไว้ (`expectedModelId`, `expectedMonthlyBudgetSatang`, `expectedBudgetRevision`) เป็น CAS
  - `budgetPolicy.effectiveMonthKey` รูปแบบ `YYYY-MM`; การเปลี่ยนโหมดหรือเริ่ม SPLIT ต้องมีผลเดือนถัดไป; เพดานต่อถังห้ามต่ำกว่ายอดที่ใช้แล้ว; ผลรวม SPLIT ห้ามเกินงบรวม
- **ข้อผิดพลาด (422)** `partner_adjustment_reason_required`, `partner_ai_budget_policy_invalid`, `partner_ai_budget_split_caps_required`, `partner_ai_budget_effective_month_invalid`, `partner_ai_previous_value_required`, `partner_ai_budget_revision_required`, `partner_ai_budget_split_exceeds_total`, `partner_ai_budget_total_below_split_allocation`, `partner_ai_budget_split_requires_model`, `partner_ai_budget_split_requires_next_month`, `partner_ai_budget_mode_change_next_month_only`, `partner_ai_budget_cap_below_bucket_spend`, `partner_ai_budget_total_below_committed`; **(409)** `partner_ai_configuration_changed`, `partner_ai_budget_revision_conflict`
- **ข้อมูล** `CompanyAiConfiguration`, `CompanyAiMonthlyUsage`, `AiUsageEvent`, `AuditLog` (action `system.partner_ai_model.update`, CRITICAL)
- **API** `PUT …/ai-model`
- **หน้าจอ** `/system/partners/[companyId]` (การ์ด AI)
- **ทดสอบ** `SPM/application/use-cases/set-partner-ai-model.use-case.spec.ts`, `apps/web/src/features/system-partners/ai-budget.logic.spec.ts`, `packages/contracts/src/ai-budget-bounds-v2.spec.ts`

### FR-CRM-020 ตั้งค่า OCR และโควตาอ่านใบเสร็จของร้าน

- **ผู้ใช้ / permission** `system.partner_ai_model.manage`
- **กฎธุรกิจ** สถานะสัมบูรณ์: `enabled` (บังคับ), `monthlyLimit` (จำนวนเต็ม 1..1,000,000 หรือ `null` = ไม่จำกัด; ไม่ส่งถือว่าผิด), `receiptQuotaEnforced` (boolean หรือ `null`), `expectedVersion`, `reason`
- **ข้อผิดพลาด** 409 `ocr_config_version_conflict`; 422 เมื่อร้านถูกล็อกหรือค่าผิดช่วง
- **ข้อมูล** `CompanyAiConfiguration`, `AuditLog` (action `system.partner_ocr_config.update`, CRITICAL)
- **API** `PUT …/ocr-config`
- **หลักฐาน** `SPM/application/use-cases/set-partner-ocr-config.use-case.ts`

### FR-CRM-021 มิเตอร์การใช้ AI ของร้าน

- **คำอธิบาย** ยอดใช้ AI เดือนนี้/เดือนก่อน งบที่มีผล และแท็กการใช้งานสูงสุด รวมการใช้ OCR
- **ผู้ใช้ / permission** `system.partner_dashboard.read`; คำตอบแนบ `canManage` (ผู้เรียกมี `system.partner_ai_model.manage` หรือไม่) เพื่อให้ผู้อ่านอย่างเดียวเห็นตัวเลขโดยไม่เห็นฟอร์ม
- **ข้อมูล** `CompanyAiConfiguration`, `CompanyAiMonthlyUsage`, `CompanyOcrMonthlyUsage`, `CompanyOcrUsageEvent`, `AttachmentObject`
- **API** `GET …/ai-usage`
- **ทดสอบ** `SPM/application/use-cases/get-partner-ai-usage.use-case.spec.ts`

### FR-CRM-022 ประวัติการปรับ AI ของร้าน

- **ผู้ใช้ / permission** `system.partner_ai_model.manage`
- **กฎธุรกิจ** แบ่งหน้าด้วย `cursor` (≤ 100 ตัวอักษร)
- **API** `GET …/ai-adjustments?cursor=`
- **หน้าจอ** `PartnerAiAdjustmentHistory.tsx`
- **หลักฐาน** `SPM/application/partner-ai-adjustment-history.ts`

### FR-CRM-023 กระทบยอดเครดิต AI ที่ค้างกัน (credit holds)

- **คำอธิบาย** แสดงเครดิตที่ถูกกันไว้และยัง `UNRESOLVED` กับ breach ที่ยังไม่รับทราบ ของทุกเดือน ทีละหน้า (หน้าละ `AI_CREDIT_HOLDS_PAGE_SIZE = 100`) หลังรัน lazy sweep ชุดเดียวกับตอนรับงาน แล้วให้ผู้ดูแลตัดสินทีละรายการ
- **ผู้ใช้ / permission** อ่าน `system.partner_dashboard.read`; สามคำสั่ง `system.partner_ai_model.manage`
- **คำสั่ง** `release` (คืนเครดิตทันที ไม่บันทึกการใช้), `charge-at-bound` (ตัดที่เพดานที่ประกาศไว้ของรายการ ไม่ใช่การเรียกโมเดล), `acknowledge-breach` (ไม่แตะเงิน เปิดรับงานของ scope นั้นอีกครั้ง) ทุกคำสั่งต้องมี `reason`
- **ข้อผิดพลาด** 404 `partner_ai_credit_hold_not_found`; 409 `partner_ai_credit_hold_already_resolved`, `partner_ai_credit_breach_already_acknowledged`; 422 `partner_adjustment_reason_required`, `partner_ai_credit_holds_cursor_invalid`; `partner_ai_credit_hold_action_failed`
- **ข้อมูล** `AiBudgetReservation`, `Company`
- **API** `GET …/ai-credit-holds`, `POST …/ai-credit-holds/:reservationId/{release|charge-at-bound|acknowledge-breach}`
- **ทดสอบ** `SPM/application/use-cases/partner-ai-credit-holds.use-case.spec.ts`

### FR-CRM-024 งบ AI ระดับแพลตฟอร์ม

- **คำอธิบาย** อ่าน/ตั้งค่างบ AI ปริยายที่ทุกร้านรับช่วงเมื่อไม่มี override
- **ผู้ใช้ / permission** `system.partner_ai_model.manage`
- **ข้อผิดพลาด** `platform_ai_budget_default_below_split_allocation` เมื่อค่าปริยายใหม่ต่ำกว่ายอดแบ่ง SPLIT ที่ร้านใดร้านหนึ่งตั้งไว้
- **ข้อมูล** `PlatformAiBudgetConfig`, `CompanyAiConfiguration`, `AuditLog` (action `system.platform_ai_budget.update`, CRITICAL)
- **API** `GET|PUT /v1/system/ai-budget`
- **หน้าจอ** `/system/ai-budget` (`PlatformAiBudgetPage.tsx`)
- **ทดสอบ** `SPM/application/use-cases/set-platform-ai-budget.use-case.spec.ts`

### FR-CRM-025 กุญแจ LINE Messaging API ของ OA กลาง

- **คำอธิบาย** อ่านสถานะ (`AVAILABLE`/`INCOMPLETE`, เวอร์ชัน, channel id; ไม่เคยคืนค่าลับ) และหมุน channel secret + access token ของ LINE OA กลางที่ทั้งแพลตฟอร์มใช้
- **ผู้ใช้ / permission** `system.shared_line_credential.manage`
- **กฎธุรกิจ** (`SPM/application/use-cases/set-shared-line-credential.use-case.ts`, `SPM/presentation/http/system-line.controller.ts`)
  1. รองรับเฉพาะ `credentialKind = LINE_MESSAGING_API` (อื่น 400 `LINE_CREDENTIAL_KIND_UNSUPPORTED`)
  2. จำกัดอัตรา 10 ครั้งต่อ 300 วินาทีต่อผู้ใช้ (`LINE_CREDENTIAL_RATE_LIMIT`)
  3. ต้องยืนยันตัวตนซ้ำด้วยรหัสผ่านปัจจุบัน (`LINE_REAUTH_FAILED`); session ต้อง `ACTIVE` และ credential ไม่ใช่ชั่วคราว/หมดอายุ
  4. `channelId` ต้องเท่ากับค่าที่ตั้งในคอนฟิกของระบบ มิฉะนั้น 409 `LINE_CHANNEL_MIGRATION_REQUIRED` (หน้านี้หมุนกุญแจได้ แต่ย้าย channel ไม่ได้)
  5. ตรวจ token กับ LINE (`/v2/oauth/verify`): `client_id` ต้องตรง channel และอายุ token สมเหตุผล มิฉะนั้น 400 `LINE_TOKEN_REJECTED`
  6. CAS ด้วย `expectedVersion` (`LINE_CREDENTIAL_CHANGED`) และ `rotationId` (UUID v4)
- **การตรวจสอบ** `channelSecret` 16..1024, `accessToken` 16..4096 ไม่มีช่องว่าง, `reason` 5..500
- **ข้อมูล** `PlatformLineCredential`, `AuthSession`, `UserCredential`, `AuditLog` (action `system.shared_line_credential.published`)
- **API** `GET /v1/system/line/shared-credentials`, `PUT /v1/system/line/shared-credentials/:credentialKind`
- **หน้าจอ** `/system/line-settings` (`SharedLineSettingsPage.tsx`)
- **ทดสอบ** `e2e/system-settings-ux.spec.ts`

### FR-CRM-026 ไทม์ไลน์ของร้าน (เครื่องมือซัพพอร์ต)

- **คำอธิบาย** ประกอบเหตุการณ์สำคัญของร้านจากแถว audit และมิเตอร์ที่มีอยู่ ไม่มีตารางเหตุการณ์ของตัวเอง
- **ผู้ใช้ / permission** `system.company_onboarding.read`
- **ชนิดเหตุการณ์** `signup_submitted`, `signup_approved`, `legal_accepted`, `first_web_entry`, `first_receipt`, `last_activity`, `package_change`, `ai_refusal`
- **ข้อมูล** `CompanySignupRequest`, `AuditLog`, `ExternalIdentity`, `CompanyOcrUsageEvent`, `CompanyOcrMonthlyUsage`, `AiUsageEvent`, `PackageChangeRequest`, `CompanyPlanTerm`, `CompanyAiConfiguration`
- **API** `GET …/timeline`
- **ทดสอบ** `SPM/presentation/http/partner-support-tools.spec.ts`, `apps/web/src/features/system-partners/PartnerSupportTools.qa.spec.ts`

### FR-CRM-027 ส่งข้อความ LINE จากผู้ดูแลถึงร้าน

- **คำอธิบาย** ผู้ดูแลพิมพ์ข้อความหนึ่งข้อความ ระบบ push ผ่าน OA กลางไปยัง OWNER ของร้าน และผู้ร้องขอของคำขอช่วยเหลือที่ระบุ (ถ้ามี) พร้อมทำเครื่องหมายคำขอนั้นว่า `ANSWERED`
- **ผู้ใช้ / permission** `system.partner_company.update`
- **กฎธุรกิจ** (`SPM/application/use-cases/send-partner-line-message.use-case.ts`, `SPM/domain/logic/partner-line-message.logic.ts`) ข้อความถูก trim และจำกัดความยาว `PARTNER_LINE_MESSAGE_MAX_LENGTH = 500`; ลิงก์ในข้อความต้องเป็นโดเมนของระบบเองหรือ `liff.line.me` เท่านั้น เพราะข้อความจาก OA ที่ผ่านการรับรองรับช่วงความน่าเชื่อถือของบัญชีนั้น
- **ข้อผิดพลาด (422)** `partner_line_message_empty`, `partner_line_message_too_long`, `partner_line_message_external_link`, `line_messaging_channel_not_configured`; 404 เมื่อไม่พบร้าน หรือคำขอช่วยเหลือไม่ใช่ของร้านนี้/ปิดแล้ว
- **ข้อมูล** `LineSupportRequest`, `LineSupportMessage`, `AuditLog` (action `system.partner.line_message_sent`, HIGH)
- **API** `POST …/line-message` (200, ตอบจำนวนแชตที่ส่งถึง)
- **ทดสอบ** `SPM/domain/logic/partner-line-message.logic.spec.ts`, `partner-support-tools.spec.ts`

### FR-CRM-028 คิวคำขอเปลี่ยนแพ็กเกจจาก LINE

- **คำอธิบาย** ลูกค้ากด "ขอเปลี่ยนแพ็กเกจ" ใน LINE ได้แถว `PackageChangeRequest` ชนิด `CUSTOMER_REQUEST`; ผู้ดูแลอนุมัติหรือปฏิเสธจากคิว
- **ผู้ใช้ / permission** `system.partner_company.update` และผู้ตัดสินต้องผ่าน `assertPlanTermAdjustmentActor` (เป็น `SYSTEM_ADMIN` ที่ยัง ACTIVE)
- **ขั้นตอนหลัก** `GET /v1/system/package-change-requests?status=OPEN` (สูงสุด 200 แถว เรียงเก่าก่อน) → `POST …/:id/decision { action: 'APPROVE' | 'REJECT', note? }`
- **กฎธุรกิจ** (`SPM/application/use-cases/package-change-decision.use-case.ts`)
  1. Idempotent: แถวที่ตัดสินแล้วตอบสถานะเดิม ไม่เปลี่ยนแพ็กซ้ำ
  2. `APPROVE` เรียก `SetCompanyPlanTermUseCase` ใน transaction เดียวกัน (ล็อก `Company`) ด้วย `commandId = line-package-<id>` และขีดจำกัดจาก `PLAN_TIER_PRESETS[requestedTierKey]`; อนุมัติแล้ว **ไม่ขยับวันหมดอายุ**
  3. ร้านที่มีรายการชำระเงิน (`billingReceiptAccountId` มีค่า) → 409 `paid_plan_review_required` (ต้องไปหน้าปรับแพ็กเกจชั่วคราวของ billing)
  4. ร้านที่ term หมดแล้ว → 409 `package_change_company_locked`
  5. `note` ของผู้ดูแลถูกส่งเข้าแชตลูกค้า จึงผ่านรั้วเดียวกับ FR-CRM-027 (ตรวจก่อน CAS claim)
  6. แจ้งผลหลัง commit แบบ best-effort ไปยังผู้ถือ `company.plan.manage` ทุกคนของร้านที่ผูก LINE ล้มเหลวก็ไม่ย้อนการเปลี่ยนแพ็ก
- **ข้อมูล** `PackageChangeRequest`, `CompanyPlanTerm`, `AuditLog` (action `signup.line.package_change_decided`, HIGH)
- **API** `GET /v1/system/package-change-requests`, `POST /v1/system/package-change-requests/:id/decision`
- **หน้าจอ** เรียกจาก `apps/web/src/features/system-signup-requests/signup-requests.api.ts` (หน้า `/system/signup-requests`)
- **ทดสอบ** `SPM/application/use-cases/package-change-decision.use-case.spec.ts`
- **State machine** §8.3

---

## 4. ส่วน B — อายุแพ็กเกจ ขีดจำกัด และโควตา (plan term)

โค้ดอยู่ใน `SPM/` เช่นกัน เพราะ plan term เป็นทั้งเครื่องมือของผู้ดูแลและกลไกบังคับใช้แพ็กของทุกร้าน ค่าตั้งต้นต่อแพ็กมาจาก `PLAN_TIER_PRESETS` (`packages/contracts/src/plan-term.ts:133-140`):

| แพ็ก | ป้ายภาษาไทย | สาขา | พนักงาน | ใบเสร็จ/เดือน |
|---|---|---|---|---|
| `FREE_TRIAL_15` | ทดลองใช้ฟรี | 1 | 2 | 15 |
| `STARTER_249` | เริ่มต้น (STARTER) | 1 | 2 | 30 |
| `BASIC_499` | เติบโต (BASIC) | 2 | 5 | 50 |
| `PRO_999` | มืออาชีพ (PRO) | 5 | 10 | 100 |
| `ENTERPRISE_1999` | ธุรกิจ (ENTERPRISE) | 10 | 30 | 500 |

ค่าคงที่: `DEFAULT_TERM_DAYS = 30`, `DEFAULT_WARNING_DAYS = 7`, `ONBOARDING_DEFAULT_TIER = 'STARTER_249'`, `SIGNUP_TRIAL_TIER_KEY = 'FREE_TRIAL_15'`, บันไดเตือน `WARNING_LADDER_DAYS = [7, 3, 1]` (`SPM/domain/logic/plan-term.logic.ts`)

### FR-CRM-029 อ่าน plan term และประวัติการปรับของร้าน

- **ผู้ใช้ / permission** `system.partner_dashboard.read`
- **แพ็กที่ได้ใช้** ทุกแพ็ก (พื้นผิวของผู้ดูแล)
- **กฎธุรกิจ** ร้านที่ไม่มีแถว `CompanyPlanTerm` ตอบ `{ term: null }` (ไม่ใช่ 404) หมายถึงร้านรุ่นเก่าที่ไม่จำกัด; คำตอบแนบ `sourceVersion` (SHA-256 ของค่าที่เก็บ ไม่รวมเวลาที่ผ่านไป) สำหรับใช้เป็น `expectedVersion`, `activeBranches`, `activeMembers`; DTO คำนวณ `derivedState` (`ACTIVE`/`WARNING`/`EXPIRED`), `daysLeft`, `lockReason` เมื่อหมดอายุ และ `effectiveCapacity` เมื่อเป็นแพ็กที่ชำระเงิน
- **ข้อมูล** `CompanyPlanTerm`, `Branch`, `CompanyMembership`, `AuditLog` (ประวัติอ่านจาก action `system.company_plan_term.set` / `.renew`)
- **API** `GET …/plan-term`, `GET …/plan-term/history?cursor=`
- **หน้าจอ** `/system/partners/[companyId]` (`PartnerPlanAdjustmentHistory.tsx`, `plan-term.logic.ts`)
- **ทดสอบ** `SPM/application/use-cases/company-plan-term.use-cases.spec.ts`, `apps/web/src/features/system-partners/plan-term.logic.spec.ts`

### FR-CRM-030 ตั้ง/แก้ plan term (แพ็กและขีดจำกัด)

- **ผู้ใช้ / permission** `system.partner_company.update` และต้องเป็น `SYSTEM_ADMIN` ที่ membership/ผู้ใช้/บริษัท ACTIVE (`assertPlanTermAdjustmentActor`)
- **ขั้นตอนหลัก** เลือก preset ของแพ็กในหน้าเว็บ → `PUT …/plan-term { tierKey, branchLimit, employeeLimit, monthlySlipLimit, warningDays?, termStartAt?, termDays?, commandId, expectedVersion, reason }`
- **กฎธุรกิจ** (`SetCompanyPlanTermUseCase`)
  1. วันเริ่ม/วันสิ้นสุดถูกกำหนด **ครั้งเดียวตอนสร้างแถว** (`termEndsAt = termStartAt + termDays × 24 ชม.`); การแก้ภายหลังเปลี่ยนเฉพาะ `tierKey`, ขีดจำกัด และ `warningDays` ไม่ขยับวันหมดอายุ (การขยับต้องใช้การต่ออายุ)
  2. `commandId` รูปแบบ `^[a-zA-Z0-9_-]{16,120}$`, `expectedVersion` เป็น hex 64 ตัว; ซ้ำ `commandId` + fingerprint เดิม → `replayed: true`; ต่างผู้ทำหรือ fingerprint ต่าง → 409 `partner_plan_term_command_conflict`; `expectedVersion` ไม่ตรง → 409 `partner_plan_term_changed`
  3. ร้านที่มีรายการชำระเงิน (`billingReceiptAccountId` หรือ `BillingAccount.activeAttemptId`) → 409 `paid_plan_review_required`
- **การตรวจสอบ** DTO: `tierKey ∈ PLAN_TIER_PRESETS`, `branchLimit`/`employeeLimit` 1..10,000, `monthlySlipLimit` 1..1,000,000, `termDays` 1..3,650, `warningDays` 1..365, `reason` 1..500; use case ตรวจซ้ำว่าเป็นจำนวนเต็ม ≥ 1 (422)
- **ข้อมูล** `CompanyPlanTerm`, `BillingAccount`, `AuditLog` (action `system.company_plan_term.set`, CRITICAL, metadata `from`/`to`, `commandId`, `fingerprint`, `entryPoint` = `SYSTEM_PARTNER_ADMIN` หรือ `LINE_PACKAGE_REQUEST`)
- **API** `PUT /v1/system/partners/:partnerCompanyId/plan-term`
- **ทดสอบ** `company-plan-term.use-cases.spec.ts`, `apps/api/src/scripts/partner-plan-adjustments-smoke.ts`

### FR-CRM-031 ต่ออายุ plan term

- **ผู้ใช้ / permission** เหมือน FR-CRM-030
- **กฎธุรกิจ** (`RenewCompanyPlanTermUseCase`)
  1. `days` ปริยาย 30 (1..3,650); ฐานคือค่าที่มากกว่าระหว่าง `termEndsAt` เดิมกับ `now` (ต่อก่อนหมดไม่เสียวันที่เหลือ ต่อหลังหมดเริ่มนับจากตอนนี้)
  2. `renewCount + 1`, ตั้ง `lastRenewedAt`, ล้าง `warn7SentAt`/`warn3SentAt`/`warn1SentAt`/`expiredNotifiedAt` เพื่อให้บันไดเตือนรอบใหม่ทำงาน
  3. เปิดร้านกลับเป็น `ACTIVE` **เฉพาะ** ร้านที่ `DISABLED` และ `termDisabledAt` มีค่า (ระบบ term เป็นผู้ปิด) ร้านที่ผู้ดูแลสั่งพักยังคงพัก; การเปิดกลับทำใน transaction เดียวกันผ่าน `PartnerLifecycleTransitionUseCase` ด้วย `reason: 'term_renewed'`
  4. ร้านที่มีรายการชำระเงิน → 409 `paid_plan_review_required`; ไม่มีแถว term → 404
- **ข้อมูล** `CompanyPlanTerm`, `Company`, `AuditLog` (action `system.company_plan_term.renew`, CRITICAL)
- **API** `POST …/plan-term/renew` (200)
- **ทดสอบ** `company-plan-term.use-cases.spec.ts`

### FR-CRM-032 ยุติเพดาน warm-up ก่อนกำหนด

- **คำอธิบาย** ร้านใหม่บางแพ็กมีเพดานใบเสร็จช่วงสัปดาห์แรก (`warmupUntil`, `warmupSlipLimit`); เมื่อผู้ดูแลตรวจร้านแล้วสามารถยกเลิกเพดานได้ทันที
- **ผู้ใช้ / permission** `system.partner_company.update`
- **กฎธุรกิจ** เขียน `warmupUntil = now` (ตัวนับใช้เงื่อนไข `now < warmupUntil`); idempotent: warm-up ที่จบแล้วหรือไม่มี ไม่เขียนอะไรและไม่บันทึก audit; ไม่มีแถว term → 404
- **ข้อมูล** `CompanyPlanTerm`, `AuditLog` (action `system.company_plan_term.warmup_ended`, HIGH)
- **API** `POST …/plan-term/end-warmup` (200)

### FR-CRM-033 ขีดจำกัดสาขาและพนักงานตามแพ็ก

- **คำอธิบาย** ประตูฝั่ง "สร้าง" สองบาน เรียกโดยโมดูล `data-model-core` (สร้างสาขา) และ `employee-access` (สร้าง/เปิดใช้พนักงาน เปลี่ยนบทบาท)
- **แพ็กที่ได้ใช้** ทุกแพ็กที่มีแถว term; ค่าขีดจำกัดตามตารางต้นส่วนนี้ หรือค่าที่ผู้ดูแลตั้งเอง
- **กฎธุรกิจ** (`SPM/application/plan-term-limit.ts`)
  1. ไม่มีแถว `CompanyPlanTerm` = ไม่จำกัด (fail-open สำหรับร้านรุ่นเก่า)
  2. สิ่งที่นับ: สาขา `status = ACTIVE`; membership `status = ACTIVE` ที่ไม่ถือ role ระบบ `SYSTEM_ADMIN` (role ชื่อเดียวกันที่ร้านสร้างเองไม่ได้รับยกเว้น)
  3. ร้านที่เกินขีดจำกัดใหม่ยังคงของเดิมทั้งหมด ถูกห้ามเฉพาะการเพิ่ม
  4. ความจุชั่วคราวจาก billing (`capacityOverride` JSON 7 คีย์ ผูก `billingReceiptAccountId`, อยู่ในช่วง `effectiveAt..expiresAt`, term ยังไม่หมดและไม่ถูกปิด) มีผลแทนค่าปกติ และหมดเองโดยไม่ต้องมี worker (`SPM/domain/logic/plan-capacity.ts`)
- **ข้อผิดพลาด** 422 `plan_branch_limit_exceeded` พร้อมข้อความ `branchLimitMessageTh` และ `details { limit, active }`; 422 พร้อมข้อความ `employeeLimitMessageTh`
- **ข้อมูล** `CompanyPlanTerm`, `Branch`, `CompanyMembership`
- **API** ไม่มีของตัวเอง (ถูกเรียกจาก use case ของโมดูลอื่น)
- **ทดสอบ** `company-plan-term.use-cases.spec.ts`, `e2e/journeys/team-and-roles.journey.spec.ts`

### FR-CRM-034 โควตาอ่านใบเสร็จต่อเดือนและข้อความเมื่อเต็ม

- **คำอธิบาย** คำนวณเพดานการให้ AI อ่านรูปต่อเดือนและสร้างข้อความภาษาไทยเมื่อเต็ม ใช้โดยโมดูล `expenses` และ `line-ai`
- **กฎธุรกิจ** (`SPM/domain/logic/receipt-quota.logic.ts`)
  1. `effectiveMonthlySlipLimit`: ไม่มี term = `null` (ไม่จำกัด); แพ็ก `FREE_TRIAL_15` ใช้ `monthlySlipLimit` ทันที; แพ็กอื่นช่วง warm-up ใช้ `min(monthlySlipLimit, warmupSlipLimit)` หลังจากนั้นใช้ `monthlySlipLimit`
  2. ข้อความนับ "ครั้งที่ AI อ่านรูป" ไม่ใช่ "ใบเสร็จ" เพราะการรับงานนับทุกรูป; คำว่า "ช่วงทดลอง" ใช้กับ `FREE_TRIAL_15` เท่านั้น; ผู้อ่านที่ไม่มีสิทธิ์ซื้อได้ข้อความ "ให้ติดต่อผู้ดูแลแพ็ก" แทนคำชวนซื้อ
  3. จังหวะ `FREE_MONTHLY_3` (สิทธิ์อ่านฟรีเดือนละ 3 ใบ) และ `PAID_GRANTS` มีข้อความของตัวเอง; `displayReceiptQuotaLimit` ไม่พิมพ์เลข 0
  4. `trialReceiptCounterLineTh` เพิ่มบรรทัด "อ่านครั้งที่ n จาก m ในช่วงทดลอง" เฉพาะแพ็กทดลอง
- **ทดสอบ** `SPM/domain/logic/receipt-quota.logic.spec.ts`

### FR-CRM-035 กวาดอายุแพ็กเกจ: ปิดร้านที่หมดอายุ แจ้งเตือน และลบร้านเดโม

- **คำอธิบาย** งานเบื้องหลังรันทุก 5 นาที (`apps/workers/src/modules/plan-term-sweep/plan-term-sweep-worker.ts`, `intervalMs: 300_000`) เรียก `POST /v1/internal/plan-term/sweep`
- **ผู้ใช้ / permission** worker (`x-worker-token`)
- **กฎธุรกิจ** (`SPM/application/use-cases/plan-term-sweep.use-case.ts`) สามรอบ อิสระต่อกัน idempotent และจำกัดจำนวน (200 ร้านต่อรอบ, เดโม 20)
  1. **ปิดร้านหมดอายุ:** เลือกร้าน `ACTIVE` ที่ `termEndsAt ≤ now` → ล็อก `Company` → ตรวจซ้ำ → เปลี่ยนเป็น `DISABLED` ผ่าน lifecycle (`requestingAdminUserId: null`, `reason` = `no_package` หรือ `term_expired`) → ตั้ง `termDisabledAt` และ `expiredNotifiedAt` → แจ้งเตือน `plan_term_expired` (severity `critical`) ยกเว้นร้านเดโม ร้านที่ไม่เคยมีแพ็ก (`no_package`) และร้านที่เข้าข่ายใช้ฟรี (FR-CRM-037)
  2. **เตือนล่วงหน้า:** ร้าน `ACTIVE` ที่จะหมดภายใน 7 วัน (ไม่รวมเดโม) ส่งเฉพาะจุดที่ลึกที่สุดของบันได 7/3/1 ที่ยังไม่เคยส่ง (คอลัมน์ `warn7SentAt`/`warn3SentAt`/`warn1SentAt` เป็นรั้ว exactly-once) trigger `plan_term_expiring` (severity `action`)
  3. **ลบร้านเดโม:** ร้าน `reportClassification = 'DEMO'` ที่หมดอายุถูกลบด้วย `purgeDemoCompany` (โมดูล `sales-demo`)
  4. ผู้รับ: ผู้ถือ `company.plan.manage` ของร้าน (เว็บ + LINE ผ่าน notification event ของร้าน, deep link ไป `/companies/<id>/billing` เมื่อเปิด self-serve billing มิฉะนั้น `/dashboard`) และ `SYSTEM_ADMIN` ทุกคน (notification ในบริษัทแพลตฟอร์ม, deep link `/system/partners/<id>`)
  5. ร้านหนึ่งล้มเหลวไม่หยุดทั้งชุด (นับใน `failures` และ log JSON); การบังคับใช้จริงอยู่ที่ AuthGuard (FR-CRM-036) sweep มีไว้เพื่อพลิกสถานะที่มองเห็นและแจ้งคน
- **ข้อมูล** `CompanyPlanTerm`, `Company`, `BillingAccount`, `NotificationEvent` (ผ่านโมดูล `dashboard-notifications`), `AuditLog`
- **API** `POST /v1/internal/plan-term/sweep` (ไม่รับ body; ตอบ `{ expired, warned, purged, failures }`)
- **ทดสอบ** `SPM/application/use-cases/plan-term-sweep.use-case.spec.ts`, `apps/workers/src/modules/plan-term-sweep/plan-term-sweep-worker.spec.ts`

### FR-CRM-036 สถานะอายุแพ็กสำหรับผู้ใช้ของร้าน และการล็อกเมื่อหมดอายุ

- **คำอธิบาย** สมาชิกของร้านอ่านสถานะ term ของร้านตัวเองเพื่อแสดงแบนเนอร์เหลือง (ใกล้หมด) หรือหน้าหมดอายุ
- **ผู้ใช้ / permission** สมาชิกทุกคน — `account.session.read`
- **แพ็กที่ได้ใช้** ทุกแพ็ก
- **กฎธุรกิจ**
  1. `GET /v1/plan-term/notice` ตอบ JSON `null` เมื่อไม่มี term (ไม่จำกัด) มิฉะนั้น `{ derivedState, termEndsAt, daysLeft, lockReason?, freeExpenseDrafts?, isOwner, canManagePlan }`; payload ไม่มีขีดจำกัดและไม่มีชื่อแพ็ก
  2. AuthGuard ปฏิเสธทุกคำขอของร้านที่ `termEndsAt ≤ now` ด้วย 403 `company_term_expired` ทันทีถึงระดับมิลลิวินาที แม้สถานะร้านยังเป็น `ACTIVE`; เส้นทางที่ยกเว้นคือ `/v1/auth` และ `/v1/plan-term/notice` (`apps/api/src/modules/auth/presentation/auth.guard.ts:58-60, 309-331`)
  3. `derivePlanTermState`: `EXPIRED` เมื่อ `msLeft ≤ 0`; `WARNING` เมื่อ `msLeft ≤ warningDays × 24 ชม.`; `daysLeft = ceil(msLeft / 24 ชม.)` ไม่ต่ำกว่า 0
  4. `lockReason`: `no_package` เมื่อ `termEndsAt ≤ termStartAt` และ `renewCount = 0` มิฉะนั้น `trial_ended` (`packages/contracts/src/plan-term.ts:46-50`)
- **ข้อมูล** `CompanyPlanTerm`
- **API** `GET /v1/plan-term/notice`
- **หน้าจอ** แบนเนอร์และการ์ดใน shell ของ workspace (`apps/web/src/features/plan-term/PlanTermBanner.tsx`, `PlanTermSidebarCard.tsx`, `LockedShellScope.tsx`, `CompanyTermExpiredPage.tsx`)
- **ทดสอบ** `apps/web/src/features/plan-term/plan-term.logic.spec.ts`, `plan-term.api.spec.ts`, `SPM/domain/logic/plan-term.logic.spec.ts`, `e2e/plan-term-billing-readiness.spec.ts`, `apps/api/src/modules/auth/auth.guard.spec.ts`

### FR-CRM-037 สิทธิ์ใช้ฟรีแบบร่างค่าใช้จ่ายหลังช่วงทดลองหมด (free expense drafts)

- **คำอธิบาย** ร้านแพ็ก `FREE_TRIAL_15` ที่หมดช่วงทดลองและไม่เคยมีร่องรอยการซื้อใด ๆ ยังอัปโหลดใบเสร็จและแก้ร่างค่าใช้จ่ายได้ในขอบเขตแคบ เป็นสิทธิ์ที่ "คำนวณ" ไม่เปลี่ยน lifecycle, term, entitlement หรือยอดที่ซื้อ
- **แพ็กที่ได้ใช้** `FREE_TRIAL_15` ที่หมดอายุเท่านั้น
- **กฎธุรกิจ** (`SPM/application/free-expense-access.ts`)
  1. `isFreeExpenseDraftCompany` เป็นจริงเมื่อ: แพ็กเป็น `FREE_TRIAL_15`, `termEndsAt ≤ now`, ไม่มี `billingReceiptAccountId`/`capacityOverride`, ร้านไม่ถูกเก็บถาวร, สถานะ `ACTIVE` หรือ `DISABLED` ที่ระบบ term เป็นผู้ปิด (audit ล่าสุดต้อง `actorUserId = null` และ `reason ∈ {no_package, term_expired}`), ไม่มีบัญชี billing ที่มีร่องรอยสมัคร/ชำระ, ไม่มี invoice ที่ชำระ/คืน/โต้แย้ง, ไม่มี receipt grant ที่มีผล, ไม่มี `PackageChangeRequest` ที่ยืนยัน/จ่ายแล้ว และไม่มี `SalesAttribution`
  2. อ่านหลักฐานไม่ได้ → 503 `FREE_EXPENSE_ACCESS_UNAVAILABLE` (ไม่ยอมให้ความผิดพลาดกลายเป็นสิทธิ์ฟรี)
  3. สิทธิ์ที่เหลือ = intersection กับ 17 keys ใน `FREE_EXPENSE_PERMISSIONS` (เช่น `expense.read*`, `expense.update`, `expense.receipt.upload`, `expense.receipt.line_upload`, `expense.ocr.request`, `attachment.read`, `attachment.create`, `company.plan.manage`) ไม่ให้ review/confirm/create
  4. เส้นทาง HTTP ที่อนุญาตถูกจับคู่ด้วย regex ใน `isFreeExpenseDraftRoute` (GET รายการ/รายละเอียด/สถานะอ่าน, PATCH ร่าง, POST อัปโหลดและ capture group); ปิด `shared-evidence` และ `accountant-package`
  5. `assertFreeExpenseSourceActor` ตรวจผู้ทำซ้ำภายใน persistence (membership ACTIVE, ขอบเขตสาขา, entitlement, มีสิทธิ์อัปโหลดอย่างน้อยหนึ่ง) มิฉะนั้น 403 `FREE_EXPENSE_SOURCE_ACCESS_REVOKED`
  6. ข้อความโควตา: เดือนละ 3 ใบ (`FREE_MONTHLY_3`), แจ้งวันเริ่มรอบใหม่ตามเวลา Asia/Bangkok, ไฟล์หลายเอกสารต้องแยกส่ง
- **ข้อมูล** `Company`, `CompanyPlanTerm`, `BillingAccount`, `BillingInvoice`, `BillingReceiptGrant`, `PackageChangeRequest`, `SalesAttribution`, `AuditLog`
- **ทดสอบ** `SPM/application/free-expense-access.spec.ts`, `SPM/application/free-expense-access.pg.spec.ts`

---

## 5. ส่วน C — รายงานผู้บริหาร (executive-business)

โค้ด API: `apps/api/src/modules/executive-business/` (ต่อไปเรียกย่อ `EXB/`) สัญญา: `packages/contracts/src/executive-business.ts`, `executive-report-words.ts` เว็บ: `apps/web/src/features/executive-reports/`, `executive-users/`

**แพ็กที่ได้ใช้** ไม่ใช่ฟีเจอร์ของร้านลูกค้า เป็นรายงานของผู้บริหารแพลตฟอร์มเกี่ยวกับร้านทุกแพ็ก ประชากรของรายงานคือร้านที่ `reportClassification = 'CUSTOMER'`

กติการ่วมของทุกเส้นทางอ่าน: ต้องมี `system.executive.read` + บริบทบริษัทแพลตฟอร์ม, ตอบ `Cache-Control: no-store`, ข้อผิดพลาดห่อด้วย envelope `{ code, message, requestId, fieldErrors? }` โดย 403 ทุกกรณีมี code `EXECUTIVE_ACCESS_DENIED` และ 400 ที่ไม่มี code กลายเป็น `EXECUTIVE_QUERY_INVALID` (GET) หรือ `INVALID_INPUT` (อื่น) (`ExecutiveAccountExceptionFilter`, `ExecutiveReportExceptionFilter`)

### FR-CRM-038 บริบทของรายงาน (context)

- **คำอธิบาย** ให้ข้อมูลที่หน้ารายงานต้องใช้ก่อนอ่านตัวเลข (type `ExecutiveContext`): `build` ปัจจุบัน, `currentMonth`/`defaultMonth`/`defaultPeriod`, `presets` (`THIS_MONTH`, `LAST_MONTH`, `THIS_QUARTER`, `THIS_YEAR`, `LAST_12_MONTHS`, `ALL`), `months` (ช่วงเดือนที่ขอได้), `builtMonths` (เดือนที่สร้างแล้ว; เดือนที่ยังไม่สร้างตอบ 503), `earliestAvailableMonth` ต่อแหล่ง (`aiUsage`, `receiptReading`, `billing`, `discovery`), `filters` (ป้ายจาก `EXECUTIVE_REPORT_LABELS`; รายชื่อเซลล์มาจากข้อมูล), `sortOptions` และ `capabilities` ของผู้เรียก (`readReport`, `export`, `seeContacts`, `manageAccounts`)
- **permission** `system.executive.read`
- **API** `GET /v1/system/executive/context`
- **หน้าจอ** ทุกหน้าใต้ `/system/executive`
- **ทดสอบ** `EXB/executive-report-read.pg.spec.ts`, `apps/web/src/features/executive-reports/executive-period.spec.ts`

### FR-CRM-039 ภาพรวม (overview)

- **คำอธิบาย** ตัวเลขสรุปของช่วงเวลา: จำนวนร้าน ร้านใหม่ ร้านที่ใช้งาน ร้านที่เพิ่มใบเสร็จ ร้านที่จ่ายเงิน ยอดรับ/คืน/สุทธิ ค่าธรรมเนียม ภาษี การใช้งานของร้านที่จ่าย (paid usage) การเริ่มใช้ใบเสร็จ (receipt adoption) และการกระจุกตัวของรายได้ (spend concentration)
- **permission** `system.executive.read`
- **กฎธุรกิจ** ทุกตัวเลขมี `coverage` (`complete`/`partial`/`unavailable`) และ `reasonCodes` (20 ค่าใน `EXECUTIVE_REASON_CODES` เช่น `PAYMENT_HISTORY_INCOMPLETE`, `RANGE_MONTH_NOT_BUILT`, `TOO_FEW_COMPANIES`); แต่ละรายการมี `drilldownFilters` ที่เปิดรายการร้านชุดเดียวกันได้ครบ
- **การตรวจสอบ** `month`/`from`/`to` รูปแบบ `YYYY-MM`; `industry`, `discovery` ต้องอยู่ในชุดค่าที่กำหนด; `referringSales` รูปแบบ `^[A-Za-z0-9_-]{1,40}$` และต้องเป็นเซลล์ที่มีอยู่จริง (ค่านอกสัญญาตอบ 400 ไม่ขยายเป็น ALL)
- **API** `GET /v1/system/executive/overview`
- **หน้าจอ** `/system/executive`
- **ทดสอบ** `EXB/executive-report-read.pg.spec.ts`, `e2e/executive-report.spec.ts`

### FR-CRM-040 รายการร้าน (companies directory)

- **คำอธิบาย** ตารางร้านพร้อมตัวกรองละเอียด ค้นหา เรียง และแบ่งหน้า
- **permission** `system.executive.read`; อีเมล/เบอร์ของเจ้าของร้านแสดงเฉพาะผู้มี `system.executive.contact.read`
- **ตัวกรอง** `receiptBucket`, `packageLabel`, `companyStatus`, `planState` (`ACTIVE`/`TRIAL`/`NO_PACKAGE`/`EXPIRED`/`ADMIN_HOLD`), `usageGroup` (`NOT_STARTED`/`INACTIVE`/`ACTIVE`/`NOT_PAID`…), `paidEver` (`YES`/`NO`/`UNKNOWN`), `receiptAdoption`, `spendCohort` (`TOP20`/`REST`/`TO80`…), `signupRail` (`official-site`/`line-oa`/`email-otp`/`ADMIN_CREATED`/`UNKNOWN`) และธง `churned`, `neverUsed`, `receiptAdded7`, `receiptAdded30`, `receiptDays30AtLeast2`, `atDataDate`, `usageAssessed`, `activeInPeriod`, `paidInPeriod`, `positiveNetInPeriod`, `joinedInPeriod`, `fullyRefunded`
- **กฎธุรกิจ** `q` ค้นเฉพาะชื่อร้าน ชื่อจดทะเบียน และจังหวัด (ไม่ค้น id/ช่องทางติดต่อ/เลขภาษี), trim, ≤ 120 ตัวอักษร, ไม่ถูก log; `pageSize` 1..100; หน้าที่เกินหน้าสุดท้ายตอบหน้าสุดท้าย; เซลล์แสดงเป็น "ชื่อ · รหัสเซลล์"
- **API** `GET /v1/system/executive/companies`
- **หน้าจอ** `/system/executive/companies`
- **ทดสอบ** `EXB/executive-report-read.pg.spec.ts`, `apps/web/src/features/executive-reports/executive-reports.logic.spec.ts`

### FR-CRM-041 การวิเคราะห์ (usage / revenue / customers / compare)

- **คำอธิบาย** เส้นทางเดียวให้สี่ส่วนตาม `section`
  - `usage`: มุมมอง `adoption` และ `ranking` (ตัวชี้วัด `expenseReceiptCount`, `activeDays`, `aiRequests`)
  - `revenue`: มุมมอง `summary` (พร้อมแนวโน้มรายเดือน) และ `top`
  - `customers`: จัดกลุ่มตาม `industry`, `discovery`, `sales` (พร้อมเครดิตสะสมของเซลล์)
  - `compare`: เทียบสองฝั่ง (`sideA`, `sideB`) ตามมิติ `industry`, `discovery`, `referringSales`, `company`
- **permission** `system.executive.read`
- **การตรวจสอบ** `section` บังคับ; `view`, `metric`, `dimension` อยู่ในชุดค่าที่กำหนด; `sideA`/`sideB` ≤ 64 ตัวอักษร
- **API** `GET /v1/system/executive/analysis`
- **หน้าจอ** `/system/executive/usage`, `/system/executive/revenue`, `/system/executive/customers`, `/system/executive/compare`
- **ทดสอบ** `EXB/executive-report-read.pg.spec.ts`, `apps/web/src/features/executive-reports/executive-infographic.spec.ts`, `executive-compact-report.spec.ts`, `executive-design-v2.spec.ts`, `executive-presentation.spec.ts`

### FR-CRM-042 รายละเอียดร้านและประวัติเหตุการณ์

- **คำอธิบาย** หน้ารายร้าน: ข้อมูลพื้นฐาน แพ็ก การใช้งาน เงิน และช่องทางติดต่อของเจ้าของร้าน (อ่านสดจากบัญชีเจ้าของ ไม่ใช้ตัวแทน; สถานะ `OK`/`NO_CURRENT_OWNER`/`MULTIPLE_OWNERS`/`SOURCE_UNAVAILABLE`/`NOT_PERMITTED`) และประวัติเหตุการณ์ของร้านแบบแบ่งหน้า (ไม่บอกว่าใครทำหรือทำไม)
- **permission** `system.executive.read`; ช่องทางติดต่อต้องมี `system.executive.contact.read`
- **กฎธุรกิจ** ร้านที่ไม่ใช่ `CUSTOMER` ตอบ 404 `COMPANY_NOT_FOUND`; การอ่านรายร้านบันทึก audit ว่ามีการคืนช่องทางติดต่อหรือไม่
- **API** `GET /v1/system/executive/companies/:targetCompanyId`, `GET …/:targetCompanyId/history?page&pageSize`
- **หน้าจอ** `/system/executive/companies/[targetCompanyId]`
- **ทดสอบ** `EXB/executive-report-read.pg.spec.ts`, `apps/web/src/features/executive-reports/ExecutiveReportContent.spec.ts`

### FR-CRM-043 แก้บันทึกทีมจากหน้ารายงาน

- **permission** `system.executive.read` + `system.executive.company_note.manage`
- **กฎธุรกิจ** ใช้ `CompanyTeamNoteService` ชุดเดียวกับ FR-CRM-005; ผู้ไม่มีสิทธิ์ได้ข้อความปฏิเสธต่างกันระหว่าง System Admin (ชี้ไปหน้าพาร์ทเนอร์) กับผู้บริหาร
- **API** `PATCH /v1/system/executive/companies/:targetCompanyId`
- **หน้าจอ** `ExecutiveCompanyNote.tsx`

### FR-CRM-044 ส่งออกรายงานเป็น XLSX

- **permission** `system.executive.read` + `system.executive.export`; รวมช่องทางติดต่อ (`includeContacts`) ต้องมี `system.executive.contact.read` ด้วย
- **ขั้นตอนหลัก** หน้าเว็บส่ง `POST /v1/system/executive/exports { buildId, reportKey, period, filters…, includeContacts }` → ได้ไฟล์ `.xlsx` พร้อม header `X-Export-Reference`, `X-Export-Row-Count`, `X-Export-Company-Count`, `X-Request-Id`
- **กฎธุรกิจ** (`EXB/application/executive-report-read.service.ts:329-…`, `EXB/domain/executive-export.logic.ts`, `executive-company-sheet.logic.ts`)
  1. `reportKey ∈ {overview, companies, usage, revenue, customers, compare, detail}`
  2. `buildId` ต้องตรง build ที่กำลังอ่าน มิฉะนั้น 409 `EXECUTIVE_SNAPSHOT_EXPIRED`
  3. ผู้ใช้หนึ่งคนส่งออกได้ทีละงาน: ชุดในหน่วยความจำ + `pg_try_advisory_xact_lock(6013, hashtext(userId))` ข้าม instance → 429 `RATE_LIMITED` (`retryAfterSeconds: 1`)
  4. ไม่มีแถว → 422 `EXECUTIVE_EXPORT_EMPTY`; เกิน 10,000 แถว → 422 `EXECUTIVE_EXPORT_LIMIT_EXCEEDED`
  5. ข้อความอิสระ (ชื่อร้าน ประเภทธุรกิจอื่น ๆ ป้ายเซลล์) ผ่าน `safeNoteForExport` ก่อนลงไฟล์
  6. ทุกความพยายามส่งออก ทั้งสำเร็จ ถูกปฏิเสธ และล้มเหลว บันทึก audit action `executive.export.created` พร้อม `exportReference` และ `outcome` (`INVALID_INPUT`, `EXECUTIVE_ACCESS_DENIED`, `RATE_LIMITED`, `SOURCE_UNAVAILABLE` ฯลฯ); บันทึก audit ไม่ได้ถือว่าส่งออกไม่ได้ (503 `SOURCE_UNAVAILABLE`)
- **หน้าจอ** `ExecutiveExportPanel.tsx`
- **ทดสอบ** `apps/web/src/features/executive-reports/executive-export.logic.spec.ts`, `EXB/executive-report-read.pg.spec.ts`, `EXB/fixtures/executive-export.fixture.ts`

### FR-CRM-045 สร้างตารางสรุปของรายงาน (rebuild)

- **คำอธิบาย** worker เรียกทุก 1 ชั่วโมง (`apps/workers/src/modules/executive/executive-rebuild-worker.ts`, `intervalMs: 3_600_000`) → `POST /v1/internal/executive/rebuild`
- **permission** worker (`x-worker-token`)
- **กฎธุรกิจ** (`EXB/application/executive-report-build.use-case.ts`)
  1. หนึ่งรอบต่อครั้ง: `pg_try_advisory_xact_lock(hashtextextended('executive-report-build', 0))`; ล็อกไม่ได้ตอบ `{ status: 'SKIPPED' }`; transaction timeout 15 นาที
  2. รอบแรกของวัน (เวลา Bangkok) เป็น `FULL` ย้อนถึงเดือนแรกที่มีข้อมูล รอบถัดไปของวันเป็น `HOURLY` (ทุก profile + เดือนปัจจุบันและเดือนก่อน)
  3. อ่านทุกแหล่งเป็นชุดโดยไม่ล็อกแถว billing/ลูกค้า แล้วเขียนทั้งรอบครั้งเดียว อ่านล้มเหลวไม่เขียนอะไร ตัวชี้ build ไม่ขยับ
  4. การตัดสินเชิงธุรกิจอยู่ใน `EXB/domain/executive-report.logic.ts`: `decidePaidEver`, `decideUsageGroup`, `decideReceiptAdoption`, `decideDiscovery`, `decideSignupRail`, `decideReferrer` (`KNOWN`/`NONE`/`UNKNOWN`/`UNRESOLVED`); ตัวนับการใช้งานเก็บค่าที่มากกว่าระหว่างที่นับใหม่กับที่เก็บไว้ (`keepLargerCounters`); เดือนที่ตัวเลขเปลี่ยนหลังปิดได้ `revision` ใหม่ (`nextRevision`)
  5. เดือนและวันยึดเขตเวลา Asia/Bangkok (`executiveMonthOf`, `bangkokDayStart`); `EXECUTIVE_DEFINITION_VERSION = 1`
- **ข้อมูล** `ExecutiveReportBuild`, `ExecutiveReportMonth`, `ExecutiveCompanyMonth`, `ExecutiveCompanyProfile` (เขียน); อ่านจาก `Company`, `CompanyPlanTerm`, `CompanySignupRequest`, `ThaiAddressMaster`, `CompanyMembership`, `Branch`, `CompanyFeatureEntitlement`, `SalesAttribution`, ข้อมูลเงินผ่าน `BillingCashMovementsService`
- **API** `POST /v1/internal/executive/rebuild`
- **ทดสอบ** `EXB/executive-report-build.pg.spec.ts`, `EXB/executive-demo-classification.spec.ts`

### FR-CRM-046 จัดการบัญชีผู้บริหาร

- **คำอธิบาย** System Admin สร้างและดูแลบัญชีผู้บริหาร ซึ่งเป็น membership ในบริษัทแพลตฟอร์มที่ถือ role `MANGMEE_EXECUTIVE`
- **permission** `system.executive_user.manage`
- **ฟังก์ชัน**
  - **รายการ/ค้นหา:** `q` (≤ 320) ค้น `username`, `displayName`, `email`, `phoneNumber`; กรอง `status ∈ {PENDING_ACTIVATION, ACTIVE, SUSPENDED, REVOKED}`; `pageSize` 1..100 (ปริยาย 20); บัญชีที่เป็น `SYSTEM_ADMIN` ไม่แสดงในรายการ
  - **สร้าง:** `username` ตรง `^[a-z0-9._-]{3,40}$` (แปลงเป็นตัวเล็ก), `displayName` ≤ 120, `email`/`phoneNumber` ไม่บังคับ, สิทธิ์เสริม `canExport`, `canSeeContacts`, `canEditCompanyNote`; ระบบออกรหัสผ่านชั่วคราว (บังคับเปลี่ยน มีวันหมดอายุ) และคืนให้เห็นครั้งเดียว; ทำใน serializable transaction; ซ้ำ `username`/`email` → 409 `ACCOUNT_ALREADY_EXISTS`
  - **พัก/เปิดคืน:** `status ∈ {ACTIVE, SUSPENDED}` + `reason` (≤ 500); พักแล้วเพิกถอนทุก session
  - **ออกรหัสผ่านชั่วคราวใหม่:** ต้องมี `reason`; เพิกถอนทุก session; ล้างรหัสที่เก็บเข้ารหัสไว้
  - **เปลี่ยนสิทธิ์เสริม:** เพิ่ม/ถอด role `MANGMEE_EXECUTIVE_EXPORT`, `MANGMEE_EXECUTIVE_CONTACT`, `MANGMEE_EXECUTIVE_COMPANY_NOTE`; ค่าเดิมเท่าค่าใหม่ไม่เขียนอะไร
- **ข้อผิดพลาด** 404 `ACCOUNT_NOT_FOUND`; 409 `ACCOUNT_REVOKED` (ถูกปิดจากทางอื่น หน้านี้เปิดคืนไม่ได้); 422 `ACCOUNT_PROTECTED` (ห้ามใช้คำสั่งนี้กับบัญชี System Admin); 400 `INVALID_INPUT` พร้อม `fieldErrors`
- **ข้อมูล** `User`, `UserCredential`, `CompanyMembership`, `MembershipRole`, `Role`, `AuthSession`, `AuditLog` (เหตุการณ์ `created`, `suspended`, `reactivated`, `credential_issued`, `access_changed` พร้อมสถานะก่อน/หลังและเหตุผล)
- **API** `GET|POST /v1/system/executive-users`, `GET /v1/system/executive-users/:userId`, `POST …/:userId/status`, `POST …/:userId/credential`, `POST …/:userId/access`
- **หน้าจอ** `/system/executive-users`, `/system/executive-users/new`, `/system/executive-users/[userId]`
- **ทดสอบ** `apps/web/src/features/executive-users/executive-users.logic.spec.ts`, `executive-users.qa.spec.ts`
- **State machine** §8.4

---

## 6. ส่วน D — เครื่องยนต์เวิร์กโฟลว์เบื้องหลังที่ทำงานให้แพ็กที่ขาย

**เหตุที่อยู่ในขอบเขต** เมนู "เวิร์กโฟลว์" (`workflow_automation`) ไม่อยู่ในแพ็กใด ร้านในแพ็กจึงไม่เห็นหน้า `/workflow` และถูกตัด permission `workflow.*` ทั้งหมด แต่เครื่องยนต์ของโมดูล `workflow` ทำงานเบื้องหลังให้ **ทุกร้าน** เพราะ

1. การสร้างร้านเรียก `autoEnableWorkflowTemplatesForCompany` ใน transaction เดียวกับ onboarding (`create-company-onboarding.use-case.ts:632-634`) สร้างกฎ `ENABLED` จากเทมเพลตที่ `autoEnable: true` ทั้งหมด ซึ่งเป็นเทมเพลตแจ้งเตือนการเบิกจ่าย (`reimbursement` ขายทุกแพ็ก)
2. worker รันงานสแกนและ drain โดย **ไม่ตรวจ entitlement** โค้ดเพียงบันทึกแบบ shadow ว่า guard "จะ" ตัดสินอย่างไร (`LaunchShadowProbe`) แต่ไม่แตกกิ่งตามผล (`workflow-scan.use-case.ts`, `workflow-retry.use-case.ts`, `workflow-outbox-drain.use-case.ts`)

โค้ด: `apps/api/src/modules/workflow/` (ต่อไปเรียกย่อ `WF/`) ตารางเวลาของ worker (`apps/workers/src/modules/workflow/workflow-worker.ts:18-52`): drain outbox ทุก 30 วินาที, สแกน threshold/SLA/schedule ทุก 15 นาที, retry ทุก 60 วินาที

**แพ็กที่ได้ใช้** ทุกแพ็ก (ทำงานอัตโนมัติ ผู้ใช้เห็นผลเป็นการแจ้งเตือนเว็บ/LINE และงานที่มอบหมาย)

### FR-CRM-047 รับเหตุการณ์จาก outbox และจับคู่กับกฎ

- **ผู้ใช้** worker (`x-worker-token`)
- **ขั้นตอนหลัก** `POST /v1/internal/workflow/outbox/drain { batchSize? }` (ปริยาย 25) → คืนแถว outbox ที่ผู้ถือ lease ตายกลับเป็น `PENDING` → claim ชุดใหม่ (`FOR UPDATE SKIP LOCKED`) → แปลงเป็น `WorkflowEventEnvelope` → `IngestWorkflowEventUseCase`
- **กฎธุรกิจ** (`WF/application/use-cases/workflow-outbox-drain.use-case.ts`, `workflow-event-ingest.use-case.ts`)
  1. เหตุการณ์ที่มี consumer ของตัวเองถูกกันออกจากการ claim (เช่น `billing.invoice.applied`, `billing.status.email`, `billing.recipient.changed`, อีเมล Postmark, ประกาศความปลอดภัยทางอีเมล, object-version cleanup, อีเมลรับสิทธิ์บัญชี, แจ้งปฏิเสธการสมัคร, แจ้งรอตรวจการสมัคร, push การสมัครทาง LINE, แจ้งซัพพอร์ตทาง LINE, ops alert, ผลอ่านเอกสารค่าใช้จ่าย, `line.document_qa.raw_cleanup_requested`)
  2. เหตุการณ์ที่ไม่มี `companyId` ถูกทำเครื่องหมาย published โดยไม่ทำอะไร
  3. Idempotent ต่อ `(companyId, eventId)`: เหตุการณ์ที่เคยรับแล้วตอบ `already_processed`
  4. จับคู่กับกฎ `ENABLED` ชนิด `EVENT` ที่ `triggerConfigJson.eventType` เท่ากัน หรืออยู่ใน `eventTypes[]`; ไม่มีกฎตรง → inbox เป็น `SKIPPED`; มีกฎตรง → `MATCHED` (ถ้าทุกกฎข้าม บันทึก `errorCode: RUNS_SKIPPED` พร้อมสรุปเหตุผล)
  5. ค้นกฎล้มเหลว → inbox `FAILED` (`RULE_LOOKUP_FAILED`) และโยนต่อให้ outbox retry
  6. การ complete นับเฉพาะเมื่อ worker ยังถือ lease (`outbox.lost_lease` ถูก log ไม่ throw); แถว outbox ที่ `DEAD` ถูก log เตือน `outbox.dead_rows` (ไม่มีทาง replay)
- **เส้นทางฉีดตรง** `POST /v1/internal/workflow/events/ingest` ตรวจ `assertActiveCompany` ก่อน เพื่อกันเหตุการณ์ปลอมไปยัง tenant ที่ไม่มีหรือไม่ active
- **ข้อมูล** `OutboxEvent` (โมดูล `data-model-core`), `WorkflowEventInbox`, `WorkflowRule`, `WorkflowRuleVersion`
- **ทดสอบ** `WF/application/use-cases/workflow-outbox-drain.use-case.spec.ts`, `workflow-event-ingest.use-case.spec.ts`, `WF/presentation/http/workflow-internal.controller.spec.ts`, `WF/domain/logic/workflow-event-match.logic.spec.ts`

### FR-CRM-048 รันกฎ: dedup, cooldown, เงื่อนไข และ action

- **กฎธุรกิจ** (`WF/application/use-cases/workflow-runner.use-case.ts`, `WF/domain/logic/workflow-idempotency.logic.ts`, `workflow-condition.logic.ts`)
  1. ข้ามเมื่อกฎไม่ `ENABLED` (`rule_not_enabled`), ไม่มีเวอร์ชัน (`no_rule_version`), มี run ที่ `(companyId, ruleVersionId, dedupKey)` เดิม (`duplicate_dedup_key`), หรืออยู่ใน cooldown (`cooldown`)
  2. `dedupKey`: `event:<eventKey>` สำหรับ EVENT; `schedule:<YYYY-MM-DD>` สำหรับ SCHEDULE (วันละครั้ง); `scan:<YYYY-MM-DDTHH>:<sourceType>:<sourceId>` สำหรับ THRESHOLD/SLA (ถังรายชั่วโมง)
  3. runner อ่าน **snapshot ของเวอร์ชันกฎ** ไม่อ่านแถวกฎที่แก้ได้
  4. เงื่อนไขเป็นต้นไม้ `ALL`/`ANY`/`NOT` ลึกไม่เกิน 8 ชั้น ตัวดำเนินการ 15 ตัว (`EQ`, `NEQ`, `GT`, `GTE`, `LT`, `LTE`, `IN`, `NOT_IN`, `EXISTS`, `MISSING`, `CONTAINS`, `STARTS_WITH`, `OLDER_THAN`, `WITHIN_NEXT`, `BETWEEN`) ประเมินแบบ pure ไม่มี eval/SQL; ไม่ตรง → run `SKIPPED` (`condition_not_matched`)
  5. สร้าง `WorkflowActionRun` สถานะ `QUEUED` ต่อ action โดย `idempotencyKey = <runId>:<actionKey>` (ไม่รวมจำนวนครั้งที่ลอง จึง retry ไม่ทำผลข้างเคียงซ้ำ)
  6. สถานะ run สุดท้าย: ทุก action ล้มเหลว = `FAILED`, บางส่วน = `PARTIAL_FAILED`, มิฉะนั้น `SUCCEEDED`; บันทึก audit `workflow.run.execute`
- **ข้อมูล** `WorkflowRun`, `WorkflowActionRun`
- **ทดสอบ** `WF/application/use-cases/workflow-runner.use-case.spec.ts`, `WF/domain/logic/workflow-idempotency.logic.spec.ts`, `workflow-condition.logic.spec.ts`

### FR-CRM-049 ทำ action ที่ปลอดภัย, retry และ dead letter

- **กฎธุรกิจ** (`WF/application/use-cases/workflow-action-runner.use-case.ts`, `WF/domain/workflow.constants.ts`)
  1. อนุญาตเฉพาะ 8 ชนิด: `SEND_NOTIFICATION`, `CREATE_WORKFLOW_TASK`, `CREATE_APPROVAL_REVIEW_REQUEST`, `REQUEST_AI_DRAFT`, `CREATE_REPORT_EXPORT_DRAFT`, `CALL_WEBHOOK`, `ADD_AUDIT_NOTE`, `NOOP_DISABLED_TEMPLATE` การเปลี่ยนแปลงขั้นสุดท้ายด้านเงิน สต๊อก ภาษี บัญชี สิทธิ์ การส่งออก หรือการเผยแพร่ ไม่อยู่ในรายการโดยเจตนา
  2. `SEND_NOTIFICATION` หาผู้รับจาก payload (`recipientPayloadKeys`) หรือจากผู้ถือ permission ของร้าน (`recipientPermissions` พร้อมลำดับความชอบ `preferRecipientPayloadKeys` / `neverPreferRecipientPayloadKeys`, ทางสุดท้าย `lastResortRecipientRoles`, และผู้รับเฉพาะบนเว็บ `webOnlyRecipientPayloadKeys`), ตัดผู้ทำเหตุการณ์ออก (`excludeRecipientPayloadKeys: ['actorUserId']`) และข้ามอย่างนุ่มนวลเมื่อไม่เหลือผู้รับ (`skipWhenAllRecipientsExcluded`, `skipWhenNoRecipients`); ลิงก์ลึกใช้ `deepLinkPathTemplate` (การเบิกจ่าย: `/companies/{{companyId}}/reimbursements/{{requestId}}`); แจ้งเตือน "จ่ายแล้ว" กับ "ยกเลิกการจ่าย" แทนที่กันและกัน (`WORKFLOW_NOTICE_ALSO_REPLACES`)
  3. ล้มเหลวแบบ retry ได้และยังไม่ครบ `WORKFLOW_MAX_RETRY_ATTEMPTS = 3` → `FAILED_RETRYABLE` พร้อม `nextAttemptAt` แบบ exponential backoff (ฐาน 30 วินาที สูงสุด 30 นาที + jitter ≤ 1 วินาที); ล้มเหลวถาวรหรือครบจำนวน → `DEAD_LETTERED` และสร้าง `WorkflowDeadLetter` (`ACTION_FAILED_FINAL` / `ACTION_FAILED_EXHAUSTED`)
  4. `POST /v1/internal/workflow/action-runs/retry { limit? }` (ปริยาย 50) ลอง action ที่ถึงกำหนด
  5. `CALL_WEBHOOK` (ใช้ได้เฉพาะร้านที่เปิด `workflow_automation`): HTTPS พอร์ต 443 เท่านั้น ไม่มี credential/fragment ใน URL, hostname ต้องอยู่ใน allowlist ของคอนฟิก, ทุกที่อยู่ที่ resolve ได้ต้องเป็น public (กัน SSRF ทั้ง IPv4/IPv6), payload ≤ 64 KiB, timeout 10 วินาที, header `X-Webhook-Signature` และ `X-Idempotency-Key`
- **ข้อมูล** `WorkflowActionRun`, `WorkflowDeadLetter`, `WorkflowTask`, `NotificationEvent`
- **ทดสอบ** `WF/application/use-cases/workflow-action-runner.use-case.spec.ts`, `workflow-retry.use-case.spec.ts`, `WF/domain/logic/workflow-action.logic.spec.ts`, `workflow-webhook-security.logic.spec.ts`

### FR-CRM-050 สแกนตามเวลา/ค่าเกณฑ์/SLA

- **ขั้นตอนหลัก** `POST /v1/internal/workflow/scan { triggerType: 'SCHEDULE' | 'THRESHOLD_SCAN' | 'SLA_SCAN' }` → ดึงกฎ `ENABLED` ของทุกร้านตามชนิด → `WorkflowScanCandidatesProvider.forTemplate(templateKey, companyId, now)` → รันกฎต่อรายการ
- **กฎธุรกิจ** ตัวให้ข้อมูลผู้สมัครมีสำหรับ 8 เทมเพลต: `low_stock_alert`, `approval_sla_breach`, `reimbursement_duplicate_sla_breach`, `reimbursement_payment_sla_breach`, `tax_due_soon`, `bank_reconciliation_aging`, `crm_follow_up_due`, `crm_opportunity_stuck` (`WF/application/use-cases/workflow-scan-candidates.use-case.ts:53-67`); แหล่งข้อมูลใช้ไม่ได้ในรอบนั้นให้ข้ามกฎนั้น ไม่ล้มทั้งชุด; ตอบ `{ rulesScanned, runsCreated }`
- **สำหรับแพ็กที่ขาย** มีผลจริงสามเทมเพลต SLA ของการเบิกจ่าย (ดูตาราง FR-CRM-051)
- **ทดสอบ** `WF/application/use-cases/workflow-scan.use-case.spec.ts`

### FR-CRM-051 เทมเพลตที่เปิดอัตโนมัติให้ทุกร้าน (แจ้งเตือนการเบิกจ่าย)

เทมเพลตทั้งหมดใน `WORKFLOW_TEMPLATE_CATALOG` (`WF/domain/workflow-template-catalog.ts:143-891`) ที่ `autoEnable: true` ทุกตัวมี `sourceModule: 'reimbursements'`:

| key | trigger | เหตุการณ์ / เงื่อนไขปริยาย | action | ผู้รับ |
|---|---|---|---|---|
| `reimbursement_pending_approval` | EVENT | `reimbursement.request_submitted`, `status EQ PENDING_APPROVAL` | แจ้งเตือน + `CREATE_APPROVAL_REVIEW_REQUEST` (งานลำดับ `HIGH`) | ผู้อนุมัติของใบเบิก |
| `approval_sla_breach` | SLA_SCAN | `slaRisk EQ true` | แจ้งเตือน `critical` + งาน `CRITICAL` | ผู้อนุมัติ (เจ้าของร้านเมื่อไม่มีผู้อนุมัติคนใดทำได้) |
| `reimbursement_duplicate_confirmed` | EVENT | `reimbursement.duplicate_confirmed`, `requestId EXISTS` | แจ้งเตือน 2 แบบ (ผู้เบิก / ผู้ยกเลิก) | ผู้เบิกและผู้มีสิทธิ์ยกเลิก |
| `reimbursement_duplicate_sla_breach` | SLA_SCAN | `slaRisk EQ true` | แจ้งเตือน | ผู้มีสิทธิ์ยกเลิก |
| `reimbursement_payment_sla_breach` | SLA_SCAN | `slaRisk EQ true` (รอบันทึกการจ่ายเกินกำหนด) | แจ้งเตือนอย่างเดียว | ผู้ถือ `reimbursement.payment.record` โดยเลือกผู้ตรวจการเงิน/ผู้อนุมัติของใบนั้นก่อน ไม่เลือกผู้เบิก |
| `reimbursement_decision_requester` | EVENT | `reimbursement.approved`, `reimbursement.rejected` | แจ้งเตือน | ผู้เบิก |
| `reimbursement_correction_requester` | EVENT | `reimbursement.correction_requested` | แจ้งเตือน | ผู้เบิก |
| `reimbursement_finance_blocked_requester` | EVENT | `reimbursement.finance_review_updated`, `decision EQ BLOCKED` และ `requesterUserId EXISTS` | แจ้งเตือน | ผู้เบิก (`requesterUserId`) |
| `reimbursement_finance_review` | EVENT | `reimbursement.finance_review_updated`, `decision EQ BLOCKED` | แจ้งเตือน | ผู้ถือ `reimbursement.finance_review` (ไม่มีใครเลยจึงส่ง `OWNER`); ไม่ส่งผู้ทำและผู้เบิก |
| `reimbursement_finance_review_pending` | EVENT | `reimbursement.approved`, `reimbursement.finance_review_requested`, `status EQ FINANCE_REVIEW` | แจ้งเตือน | ผู้ถือ `reimbursement.finance_review` (ไม่มีใครเลยจึงส่ง `OWNER`); ผู้ทำได้เฉพาะบนเว็บ |
| `reimbursement_ready_for_payment` | EVENT | `reimbursement.ready_for_payment`, `requestId EXISTS` | แจ้งเตือน | ผู้ถือ `reimbursement.payment.record` โดยเลือกผู้ตรวจการเงิน/ผู้ทำ/ผู้อนุมัติของใบนั้นก่อน ไม่เลือกผู้เบิก |
| `reimbursement_payment_recorded` | EVENT | `reimbursement.payment_recorded` | แจ้งเตือน | ผู้เบิก |
| `reimbursement_payment_voided` | EVENT | `reimbursement.payment_voided` | แจ้งเตือน | ผู้เบิก |
| `reimbursement_payout_correction_requested` | EVENT | `reimbursement.payout_correction_requested` | แจ้งเตือน | ผู้เบิก |
| `reimbursement_payout_correction_submitted` | EVENT | `reimbursement.payout_correction_submitted` | แจ้งเตือน | ผู้อนุมัติ |

- **กฎธุรกิจ**
  1. Cooldown ของเทมเพลตเบิกจ่ายแบบ EVENT เป็น 0 (ค่าปริยายทั่วไป 3,600 วินาทีจะทำให้การแจ้งเตือนของใบเบิกแรกกลบใบอื่นทั้งชั่วโมง); การ replay ถูกกันด้วย dedup key อยู่แล้ว
  2. สร้างกฎเฉพาะเมื่อร้าน **ไม่มีกฎของเทมเพลตนั้นในสถานะใดเลย** ผู้ดูแลที่ปิดหรือเก็บกฎจึงคงการตัดสินใจไว้; ไม่แก้กฎที่มีอยู่ การรันซ้ำจึงไม่มีผล
  3. เทมเพลตใหม่ที่ผูกกับ "พี่น้อง" (`WORKFLOW_TEMPLATE_FOLLOWS_SIBLING`) ถูกสร้างเป็น `DISABLED` เมื่อร้านปิดกฎพี่น้องทั้งหมดไว้
  4. ผู้ทำเหตุการณ์ไม่ได้รับแจ้งเตือนเรื่องที่ตัวเองทำ (เจ้าของร้านคนเดียวที่ส่ง-อนุมัติ-จ่ายเองไม่ได้ push ใด)
  5. การ sync ตอน release (`apps/api/prisma/sync-workflow-templates.ts`) เรียก `autoEnableWorkflowTemplatesForCompany`, `resyncWorkflowTemplateRulesForCompany` (ปักค่าใหม่ให้กฎที่ระบบสร้างและยังไม่ถูกแก้เนื้อหา), `renameDefaultNamedTemplateRulesForCompany` (เปลี่ยนชื่อกฎที่ยังใช้ชื่อเดิมภาษาอังกฤษ) และ `closeSettledClaimTasksAtRelease`
  6. ผู้สร้างกฎอัตโนมัติถูกบันทึกเป็น `system:workflow-template-sync` (ไม่ใช่ FK)
- **ทดสอบ** `WF/application/use-cases/workflow-template-auto-enable.spec.ts`, `workflow-template.use-case.spec.ts`

### FR-CRM-052 ปิดงานอนุมัติเมื่อใบเบิกเปลี่ยนสถานะ

- **กฎธุรกิจ** (`WF/domain/logic/workflow-claim-task.logic.ts`, `IngestWorkflowEventUseCase.closeClaimTasks`)
  1. ใช้กับงานจากเทมเพลต `reimbursement_pending_approval` และ `approval_sla_breach` เท่านั้น
  2. ใบเบิกยัง `PENDING_APPROVAL` → งานคงเปิด (ยกเว้นกำลังรอผู้เบิกแก้บัญชีรับเงิน → `CANCELED`); สถานะ `APPROVED`/`FINANCE_REVIEW`/`READY_FOR_PAYMENT`/`PARTIALLY_PAID`/`PAID` → `DONE`; สถานะอื่นหรือใบเบิกหายไป → `CANCELED`
  3. เหตุการณ์ `reimbursement.request_submitted` (ส่งซ้ำ) ปิดงานของรอบก่อนแบบ supersede ก่อนสร้างงานใหม่
  4. เป็น best effort: ล้มเหลวไม่ throw งานที่ค้างจะถูกปิดโดยเหตุการณ์ถัดไปหรือการกวาดตอน release; ไม่ทำเมื่อเป็น replay
- **ข้อมูล** `WorkflowTask`
- **ทดสอบ** `workflow-event-ingest.use-case.spec.ts`, `workflow-task.use-case.spec.ts`

---

## 7. ส่วน E — ชิ้นส่วนของ procurement ที่ฟีเจอร์ที่ขายเรียกใช้

โมดูล `procurement` โดยรวมอยู่นอกขอบเขต (§14) แต่มีสองชิ้นที่โมดูลของฟีเจอร์ที่ขาย import โดยตรง

### FR-CRM-053 รายการประเภทเงินได้สำหรับหักภาษี ณ ที่จ่าย

- **คำอธิบาย** คืนประเภทเงินได้ที่ `ACTIVE` (`code`, `nameTh`, `formType`, `defaultRate`) เรียงตาม `code` ใช้ตอนบันทึกค่าใช้จ่ายที่มีหัก ณ ที่จ่าย ทั้งบนเว็บและใน LINE
- **ผู้ใช้ / permission** ผู้ถือ `procurement.supplier_payment.read` **หรือ** `expense.create` (มิฉะนั้น 403)
- **แพ็กที่ได้ใช้** ทุกแพ็กผ่าน `expense.create` (ฟีเจอร์ `expenses.manual`); การออกแบบ ภ.ง.ด.3/53 และ 50 ทวิ ในระบบเป็นของ `ENTERPRISE_1999` (`wht_pnd53`, `wht_50bis`) และอธิบายในเอกสารของพื้นที่ภาษี/ค่าใช้จ่าย
- **กฎธุรกิจ** ไม่ผูกกับ `tax.config.read` โดยเจตนา: ร้านที่ไม่ได้ซื้อฟีเจอร์ภาษีก็ยังหักภาษีและต้องออก 50 ทวิให้ผู้รับเงิน
- **ข้อมูล** `WhtIncomeCategory`
- **API** ถูกเรียกจาก `apps/api/src/modules/expenses/presentation/http/expense.controller.ts` และ `apps/api/src/modules/line-ai/application/line-expense-action.service.ts`; เส้นทางของ procurement เอง (`GET /v1/companies/:companyId/accounts-payable/wht-income-categories`) ต้องมี `procurement.supplier_payment.read` จึงใช้ไม่ได้ในแพ็กที่ขาย
- **หลักฐาน** `apps/api/src/modules/procurement/application/use-cases/wht-income-category.use-case.ts`

### FR-CRM-054 บทบาทที่ได้รับยกเว้นกฎ maker-checker

- **คำอธิบาย** ค่าคงที่ `SELF_APPROVAL_EXEMPT_ROLES = ['OWNER', 'ADMIN', 'MANAGER']` (`apps/api/src/modules/procurement/domain/logic/procurement.logic.ts:298`) ถูก import โดยงานใบรับรองแทนใบเสร็จของ `expenses` (`substitute-receipt.use-case.ts:52`) และของ LINE (`line-substitute-receipt-action.service.ts:13`)
- **กฎธุรกิจ** ผู้ถือบทบาทเหล่านี้อนุมัติรายการที่ตัวเองสร้างได้ บทบาทอื่นต้องให้คนอื่นอนุมัติ เว้นแต่นโยบายของร้านอนุญาต
- **แพ็กที่ได้ใช้** ทุกแพ็ก (ผ่านฟีเจอร์ `expenses`)

---

## 8. State machines

### 8.1 สถานะวงจรชีวิตของร้าน (`Company.status`)

```
                 คนสั่ง (lifecycle.manage)                 คนสั่ง
   ACTIVE ───────────────────────────────▶ DISABLED ─────────────▶ ARCHIVED
     ▲  │   sweep: termEndsAt ≤ now            │  ▲                    │
     │  └──────────────────────────────────────┘  │                    │
     │      (ตั้ง termDisabledAt, actor = null)     │                    │
     │                                             │                    │
     ├── renew: เฉพาะ DISABLED ที่ termDisabledAt ≠ null (reason term_renewed)
     └── คนสั่ง ACTIVE: ได้เมื่อ term ยังไม่หมด (หมดแล้ว → 409 partner_activation_term_locked)
   SUSPENDED: สถานะด้านความปลอดภัย โมดูลนี้ไม่รับเป็นเป้าหมาย (422)
```

| จาก → ไป | ผู้ทำ | เงื่อนไข / ผลข้างเคียง |
|---|---|---|
| ใด ๆ → `ACTIVE` | System Admin | term ต้องยังไม่หมด; ตั้ง `activatedAt`, ล้าง `disabledAt`/`archivedAt` |
| ใด ๆ → `DISABLED` | System Admin | ล้าง `termDisabledAt` (การพักของคนมาก่อนการพักของ term) |
| ใด ๆ → `ARCHIVED` | System Admin | ล้าง `termDisabledAt`; ตั้ง `archivedAt` |
| `ACTIVE` → `DISABLED` | sweep | `termEndsAt ≤ now`; ตั้ง `termDisabledAt`, `expiredNotifiedAt` |
| `DISABLED` → `ACTIVE` | การต่ออายุ | เฉพาะเมื่อ `termDisabledAt ≠ null` |

โค้ดไม่จำกัดคู่สถานะต้นทาง-ปลายทางที่คนสั่ง (ไม่มีตารางห้าม เช่น `ARCHIVED → ACTIVE` ผ่านได้ถ้า term ยังไม่หมด) ผลของการล็อกเมตาดาตา (`partnerMetadataLockError`): `DISABLED` ที่คนสั่งและ `ARCHIVED` แก้โปรไฟล์/ฟีเจอร์/AI ไม่ได้; `DISABLED` ที่ term เป็นผู้ปิดยังแก้ตัวตนทางกฎหมายได้

### 8.2 สถานะอายุแพ็ก (คำนวณ ไม่ได้เก็บ)

`derivedState` ของ term (`derivePlanTermState`): `ACTIVE` → (`msLeft ≤ warningDays` วัน) `WARNING` → (`msLeft ≤ 0`) `EXPIRED`; การต่ออายุพากลับ `ACTIVE`/`WARNING`

`PlanTermState` ที่ใช้ในรายการร้านและรายงาน (`planTermState`, ตรวจตามลำดับ):

| ลำดับ | เงื่อนไข | ผล |
|---|---|---|
| 1 | ร้านไม่ `ACTIVE` และไม่ใช่ `DISABLED` ที่ term ปิด | `ADMIN_HOLD` |
| 2 | ไม่มีแถว term | `ACTIVE` (ร้านรุ่นเก่า ไม่จำกัด) |
| 3 | `termEndsAt ≤ termStartAt` และ `renewCount = 0` | `NO_PACKAGE` |
| 4 | `termEndsAt ≤ now` หรือ `termDisabledAt` มีค่า | `EXPIRED` |
| 5 | แพ็ก `FREE_TRIAL_15` | `TRIAL` |
| 6 | อื่น ๆ | `ACTIVE` |

บันไดเตือน: แต่ละ term ส่งได้อย่างมากจุดละครั้ง (7, 3, 1 วัน) ส่งเฉพาะจุดที่ลึกที่สุดที่เข้าแล้ว การต่ออายุล้างธงทั้งสามและ `expiredNotifiedAt`

### 8.3 คำขอเปลี่ยนแพ็กเกจ (`PackageChangeRequest.status`, ชนิด `CUSTOMER_REQUEST`)

`OPEN` → `APPROVED` (ผู้ดูแลอนุมัติ; เขียน plan term ใน transaction เดียวกัน) | `REJECTED` (ผู้ดูแลปฏิเสธ) | `CANCELLED` (ถูกแทนที่ด้วยการซื้อผ่าน catalog: `paymentState = CATALOG_SUPERSEDED`) สถานะที่ตัดสินแล้วไม่เปลี่ยนอีก; `APPROVED` ที่ `paymentState = STRIPE_APPLIED` แสดงเป็น `resolutionSource: PAID_PURCHASE`

### 8.4 บัญชีผู้บริหาร (`ExecutiveAccountStatus`, คำนวณจาก membership + credential)

การแมปอยู่ในเมธอด `view()` (`EXB/application/executive-users.service.ts:186-199`) ตรวจตามลำดับ:

| ลำดับ | เงื่อนไข | สถานะ |
|---|---|---|
| 1 | `User.status ≠ ACTIVE` หรือ membership `DISABLED` หรือไม่มี credential หรือ credential `DISABLED` | `REVOKED` (หน้านี้เปิดคืนไม่ได้: 409 `ACCOUNT_REVOKED`) |
| 2 | membership `SUSPENDED` | `SUSPENDED` |
| 3 | credential `TEMPORARY` หรือ `expiresAt ≤ now` | `PENDING_ACTIVATION` (แสดง `temporaryPasswordExpiresAt`) |
| 4 | อื่น ๆ | `ACTIVE` |

การเปลี่ยน: สร้างบัญชี → `PENDING_ACTIVATION` → (ผู้ใช้เปลี่ยนรหัสผ่าน) `ACTIVE` ⇄ `SUSPENDED` (คำสั่ง status; พักแล้วเพิกถอน session); ออกรหัสผ่านชั่วคราวใหม่พากลับ `PENDING_ACTIVATION`

### 8.5 Entitlement ของฟีเจอร์ (ต่อ `CompanyFeatureEntitlement`)

`OFF` ─(ENABLE; `epoch + 1`)→ `ON` ─(DISABLE_REQUESTED; สร้าง `RunoffSnapshot`)→ `DRAINING` ─(`completeRunoffIfDrained` หรือ `sweepDrainingLifecycles`)→ `OFF`
การเขียนแถวแรกของฟีเจอร์ที่ปิดอยู่แล้วบันทึกเป็น `OFF` ตรง ๆ ไม่ผ่าน `DRAINING`; การยืนยันค่าเดิมของแถว legacy บันทึก `ENABLE` พร้อม `reasonJson.noopConfirm` โดยไม่ขยับ `epoch` และไม่แตะ `updatedAt`

### 8.6 เวิร์กโฟลว์ (ค่าจาก `packages/contracts`)

| เอนทิตี | สถานะ | การเปลี่ยน |
|---|---|---|
| `WorkflowTemplate` | `AVAILABLE`, `UNAVAILABLE`, `DEPRECATED` | คงที่ตาม catalog; เปิดเป็นกฎได้เฉพาะ `AVAILABLE` |
| `WorkflowRule` | `DRAFT`, `ENABLED`, `DISABLED`, `ARCHIVED` | สร้าง = `DRAFT` (auto-enable สร้างแล้วเปิดทันที); `enable` สร้างเวอร์ชันใหม่ → `ENABLED`; `disable` ได้เฉพาะจาก `ENABLED`; `ARCHIVED` แก้และเปิดไม่ได้ |
| `WorkflowEventInbox` | `RECEIVED` → `MATCHED` \| `SKIPPED` \| `FAILED` | ดู FR-CRM-047 |
| `WorkflowRun` | `QUEUED`, `RUNNING` → `SUCCEEDED` \| `PARTIAL_FAILED` \| `FAILED` \| `SKIPPED`; `CANCELED` | ดู FR-CRM-048 |
| `WorkflowActionRun` | `QUEUED` → `SUCCEEDED` \| `FAILED_RETRYABLE` (วนกลับเมื่อถึง `nextAttemptAt`) → `DEAD_LETTERED`; `FAILED_FINAL`, `SKIPPED`, `CANCELED`, `RUNNING` | สูงสุด 3 ครั้ง |
| `WorkflowTask` | `OPEN` ⇄ `SNOOZED` → `DONE` \| `CANCELED` | `DONE`/`CANCELED` เป็นสถานะสุดท้าย; การปิดงานไม่เปลี่ยนเอกสารต้นทาง |
| `WorkflowDeadLetter` | `OPEN` → `REPLAYED` \| `IGNORED` \| `RESOLVED_EXTERNALLY` | replay/ignore ได้เฉพาะ `OPEN`; ignore ต้องมีหมายเหตุ |
| `WorkflowWebhookEndpoint` | `DISABLED` ⇄ `ENABLED` | สร้างใหม่เป็น `DISABLED` เสมอ |

---

## 9. ตาราง API endpoints ครบทุกเส้นของส่วนที่อยู่ในขอบเขต

ทุกเส้นมี prefix `/v1` เส้นที่ขึ้นต้น `internal/` เป็น `@Public()` และตรวจ `x-worker-token`

### 9.1 `system-partner-management`

| # | Method | Path | Permission | FR |
|---|---|---|---|---|
| 1 | GET | `system/partners` | `system.partner_dashboard.read` | 001 |
| 2 | GET | `system/partners/address-master` | `system.identity_reconciliation.resolve` | 004 |
| 3 | GET | `system/partners/:partnerCompanyId/identity` | `system.identity_reconciliation.resolve` | 004 |
| 4 | PATCH | `system/partners/:partnerCompanyId/identity` | `system.identity_reconciliation.resolve` | 004 |
| 5 | GET | `system/partners/:partnerCompanyId` | `system.partner_dashboard.read` | 002 |
| 6 | GET | `system/partners/:partnerCompanyId/team-note` | `system.partner_dashboard.read` | 005 |
| 7 | PUT | `system/partners/:partnerCompanyId/team-note` | `system.partner_company.update` + role `SYSTEM_ADMIN` | 005 |
| 8 | PATCH | `system/partners/:partnerCompanyId` | `system.partner_company.update` | 003 |
| 9 | POST | `system/partners/:partnerCompanyId/lifecycle` | `system.partner_company.lifecycle.manage` | 006 |
| 10 | GET | `system/partners/:partnerCompanyId/members` | `system.partner_member.read` | 007 |
| 11 | POST | `…/members/:memberUserId/line-unlink` | `system.partner_member.manage` | 008 |
| 12 | POST | `…/members/:memberUserId/line-link-token` | `system.partner_member.manage` | 009 |
| 13 | POST | `…/members/:memberUserId/password/reset` | `system.partner_member.manage` | 010 |
| 14 | POST | `…/members/:memberUserId/password/reveal` | `system.partner_member.manage` | 011 |
| 15 | PATCH | `…/members/:memberUserId/contact` | `system.partner_member.manage` | 012 |
| 16 | PATCH | `…/members/:memberUserId/display-name` | `system.partner_member.manage` | 013 |
| 17 | PUT | `system/partners/:partnerCompanyId/features` | `system.partner_feature.manage` | 015 |
| 18 | PUT | `system/partners/:partnerCompanyId/ai-model` | `system.partner_ai_model.manage` | 019 |
| 19 | PUT | `system/partners/:partnerCompanyId/ocr-config` | `system.partner_ai_model.manage` | 020 |
| 20 | PUT | `system/partners/:partnerCompanyId/manual-expense-web-entry` | `system.partner_feature.manage` | 016 |
| 21 | PUT | `system/partners/:partnerCompanyId/disbursement-voucher-web-entry` | `system.partner_feature.manage` | 017 |
| 22 | PUT | `system/partners/:partnerCompanyId/vat-registration` | `system.partner_company.update` | 018 |
| 23 | GET | `system/partners/:partnerCompanyId/ai-usage` | `system.partner_dashboard.read` | 021 |
| 24 | GET | `system/partners/:partnerCompanyId/ai-credit-holds` | `system.partner_dashboard.read` | 023 |
| 25 | POST | `…/ai-credit-holds/:reservationId/release` | `system.partner_ai_model.manage` | 023 |
| 26 | POST | `…/ai-credit-holds/:reservationId/charge-at-bound` | `system.partner_ai_model.manage` | 023 |
| 27 | POST | `…/ai-credit-holds/:reservationId/acknowledge-breach` | `system.partner_ai_model.manage` | 023 |
| 28 | GET | `system/partners/:partnerCompanyId/ai-adjustments` | `system.partner_ai_model.manage` | 022 |
| 29 | GET | `system/partners/:partnerCompanyId/plan-term` | `system.partner_dashboard.read` | 029 |
| 30 | GET | `system/partners/:partnerCompanyId/plan-term/history` | `system.partner_dashboard.read` | 029 |
| 31 | PUT | `system/partners/:partnerCompanyId/plan-term` | `system.partner_company.update` | 030 |
| 32 | POST | `system/partners/:partnerCompanyId/plan-term/renew` | `system.partner_company.update` | 031 |
| 33 | POST | `system/partners/:partnerCompanyId/plan-term/end-warmup` | `system.partner_company.update` | 032 |
| 34 | GET | `system/partners/:partnerCompanyId/timeline` | `system.company_onboarding.read` | 026 |
| 35 | POST | `system/partners/:partnerCompanyId/line-message` | `system.partner_company.update` | 027 |
| 36 | GET | `system/ai-budget` | `system.partner_ai_model.manage` | 024 |
| 37 | PUT | `system/ai-budget` | `system.partner_ai_model.manage` | 024 |
| 38 | GET | `system/line/shared-credentials` | `system.shared_line_credential.manage` | 025 |
| 39 | PUT | `system/line/shared-credentials/:credentialKind` | `system.shared_line_credential.manage` | 025 |
| 40 | GET | `system/package-change-requests` | `system.partner_company.update` | 028 |
| 41 | POST | `system/package-change-requests/:id/decision` | `system.partner_company.update` | 028 |
| 42 | GET | `system/users/lookup` | `system.partner_member.read` | 014 |
| 43 | GET | `plan-term/notice` | `account.session.read` | 036 |
| 44 | POST | `internal/plan-term/sweep` | worker token | 035 |

### 9.2 `executive-business`

| # | Method | Path | Permission | FR |
|---|---|---|---|---|
| 1 | GET | `system/executive/context` | `system.executive.read` | 038 |
| 2 | GET | `system/executive/overview` | `system.executive.read` | 039 |
| 3 | GET | `system/executive/companies` | `system.executive.read` | 040 |
| 4 | GET | `system/executive/analysis` | `system.executive.read` | 041 |
| 5 | GET | `system/executive/companies/:targetCompanyId` | `system.executive.read` | 042 |
| 6 | GET | `system/executive/companies/:targetCompanyId/history` | `system.executive.read` | 042 |
| 7 | PATCH | `system/executive/companies/:targetCompanyId` | `system.executive.read` + `system.executive.company_note.manage` | 043 |
| 8 | POST | `system/executive/exports` | `system.executive.read` + `system.executive.export` | 044 |
| 9 | GET | `system/executive-users` | `system.executive_user.manage` | 046 |
| 10 | POST | `system/executive-users` | `system.executive_user.manage` | 046 |
| 11 | GET | `system/executive-users/:userId` | `system.executive_user.manage` | 046 |
| 12 | POST | `system/executive-users/:userId/status` | `system.executive_user.manage` | 046 |
| 13 | POST | `system/executive-users/:userId/credential` | `system.executive_user.manage` | 046 |
| 14 | POST | `system/executive-users/:userId/access` | `system.executive_user.manage` | 046 |
| 15 | POST | `internal/executive/rebuild` | worker token | 045 |

### 9.3 `workflow` (เฉพาะเส้นเบื้องหลังที่อยู่ในขอบเขต)

| # | Method | Path | การป้องกัน | FR |
|---|---|---|---|---|
| 1 | POST | `internal/workflow/events/ingest` | worker token + `assertActiveCompany` | 047 |
| 2 | POST | `internal/workflow/outbox/drain` | worker token | 047 |
| 3 | POST | `internal/workflow/scan` | worker token | 050 |
| 4 | POST | `internal/workflow/action-runs/retry` | worker token | 049 |

เส้นทางของผู้ใช้ `companies/:companyId/workflow/*` อยู่ใน §14

---

## 10. หน้าจอเว็บ (web routes)

| Route | ไฟล์หน้า (`apps/web/app/…`) | คอมโพเนนต์ (`apps/web/src/features/…`) | FR |
|---|---|---|---|
| `/system/partners` | `system/partners/page.tsx` | `system-partners/PartnerListPage.tsx` (+ `UserLookupSection.tsx`) | 001, 014 |
| `/system/users` | `system/users/page.tsx` | redirect ไป `/system/partners` | 014 |
| `/system/partners/[companyId]` | `system/partners/[companyId]/page.tsx` | `system-partners/PartnerDetailPage.tsx` (+ `PartnerReportLabels.tsx`, `PartnerTeamNote.tsx`, `PartnerPlanAdjustmentHistory.tsx`, `PartnerAiAdjustmentHistory.tsx`) | 002–013, 015–023, 026–027, 029–032 |
| `/system/ai-budget` | `system/ai-budget/page.tsx` | `system-partners/PlatformAiBudgetPage.tsx` | 024 |
| `/system/line-settings` | `system/line-settings/page.tsx` | `system-partners/SharedLineSettingsPage.tsx` | 025 |
| `/system/signup-requests` | `system/signup-requests/page.tsx` | `system-signup-requests/*` (เรียก `package-change-requests`) | 028 |
| shell ของ workspace ทุกหน้า | — | `plan-term/PlanTermBanner.tsx`, `PlanTermSidebarCard.tsx`, `LockedShellScope.tsx`, `CompanyTermExpiredPage.tsx` | 036 |
| `/system/executive` | `system/executive/page.tsx` | `executive-reports/ExecutiveReportPage.tsx` (ทุกหน้าย่อยใช้คอมโพเนนต์เดียวกัน) | 038, 039 |
| `/system/executive/usage` | `system/executive/usage/page.tsx` | เดียวกัน | 041 |
| `/system/executive/revenue` | `system/executive/revenue/page.tsx` | เดียวกัน | 041 |
| `/system/executive/customers` | `system/executive/customers/page.tsx` | เดียวกัน | 041 |
| `/system/executive/compare` | `system/executive/compare/page.tsx` | เดียวกัน | 041 |
| `/system/executive/companies` | `system/executive/companies/page.tsx` | เดียวกัน (+ `ExecutiveFilters.tsx`) | 040 |
| `/system/executive/companies/[targetCompanyId]` | `system/executive/companies/[targetCompanyId]/page.tsx` | เดียวกัน (+ `ExecutiveCompanyNote.tsx`, `ExecutiveExportPanel.tsx`) | 042–044 |
| `/system/executive-users` | `system/executive-users/page.tsx` | `executive-users/ExecutiveUsersPage.tsx` | 046 |
| `/system/executive-users/new` | `system/executive-users/new/page.tsx` | `executive-users/ExecutiveUserPage.tsx` | 046 |
| `/system/executive-users/[userId]` | `system/executive-users/[userId]/page.tsx` | `executive-users/ExecutiveUserPage.tsx` | 046 |

ส่วน D (เครื่องยนต์เวิร์กโฟลว์) ไม่มีหน้าจอของตัวเองในแพ็กที่ขาย ผลลัพธ์ปรากฏในหน้าการแจ้งเตือนและหน้าใบเบิก (`/companies/[companyId]/reimbursements/[requestId]`) ซึ่งเป็นของพื้นที่อื่น

---

## 11. ข้อมูลที่เกี่ยวข้อง (Prisma models)

ทุกชื่อยืนยันแล้วว่ามี `model <ชื่อ> {` ใน `apps/api/prisma/schema.prisma`

| กลุ่ม | Models | ใช้ใน |
|---|---|---|
| ร้านและอายุแพ็ก | `Company`, `CompanyPlanTerm`, `CompanyTeamNote`, `CompanyLegalIdentityRevision`, `CompanyWebEntrySetting`, `PackageChangeRequest` | ส่วน A, B |
| Entitlement | `CompanyFeatureEntitlement`, `CompanyEntitlementSet`, `EntitlementCommand`, `EntitlementTransition`, `RunoffSnapshot`, `CompanyEntitlementNormalization` | FR-CRM-015 |
| สมาชิกและตัวตน | `User`, `UserCredential`, `CompanyMembership`, `MembershipRole`, `Role`, `ExternalIdentity`, `EmployeeLineLinkToken`, `PasswordResetToken`, `AuthSession`, `LineCompanyContext` | FR-CRM-007–014, 046 |
| AI และ OCR | `CompanyAiConfiguration`, `CompanyAiMonthlyUsage`, `CompanyOcrMonthlyUsage`, `CompanyOcrUsageEvent`, `AiUsageEvent`, `AiBudgetReservation`, `PlatformAiBudgetConfig` | FR-CRM-019–024 |
| LINE ของแพลตฟอร์ม | `PlatformLineCredential`, `CompanyIntegrationCredential` (เฉพาะ use case ที่ไม่มี route), `LineSupportRequest`, `LineSupportMessage` | FR-CRM-025, 027 |
| Billing ที่อ่าน | `BillingAccount`, `BillingInvoice`, `BillingReceiptGrant`, `SalesAttribution` | FR-CRM-030, 031, 037 |
| รายงานผู้บริหาร | `ExecutiveReportBuild`, `ExecutiveReportMonth`, `ExecutiveCompanyMonth`, `ExecutiveCompanyProfile` | ส่วน C |
| เวิร์กโฟลว์ | `WorkflowTemplate`, `WorkflowRule`, `WorkflowRuleVersion`, `WorkflowEventInbox`, `WorkflowRun`, `WorkflowActionRun`, `WorkflowTask`, `WorkflowDeadLetter`, `WorkflowWebhookEndpoint`, `OutboxEvent` | ส่วน D |
| อื่น ๆ | `AuditLog`, `NotificationEvent`, `WhtIncomeCategory`, `ThaiAddressMaster`, `CompanySignupRequest`, `Branch` | หลายส่วน |

คอลัมน์สำคัญของ `CompanyPlanTerm` ที่ตรรกะอ้างถึง: `tierKey`, `branchLimit`, `employeeLimit`, `monthlySlipLimit`, `termStartAt`, `termEndsAt`, `warningDays`, `renewCount`, `lastRenewedAt`, `termDisabledAt`, `warmupUntil`, `warmupSlipLimit`, `warn7SentAt`, `warn3SentAt`, `warn1SentAt`, `expiredNotifiedAt`, `billingReceiptAccountId`, `capacityOverride`, `createdByUserId`, `updatedByUserId`

---

## 12. ข้อกำหนดที่ไม่ใช่ฟังก์ชัน (NFR)

เลข NFR ในเอกสารนี้ใช้ช่วง 400–419 เพื่อไม่ชนกับเอกสารพื้นที่อื่น หากตารางตรวจย้อนกลับใช้ช่วงอื่นให้เปลี่ยนเลขที่จุดรวม

| ID | ชื่อ | ข้อกำหนด | หลักฐาน |
|---|---|---|---|
| NFR-400 | แยก tenant ของผู้ดูแลจากร้านลูกค้า | เส้นทาง `system/*` ต้องไม่ใช้พารามิเตอร์ชื่อ `companyId`; System Admin ไม่มี membership ในร้านลูกค้า; รายงานผู้บริหารต้องอยู่ในบริบทบริษัทแพลตฟอร์ม | `partner.controller.ts:360-363`, `assertPlatformTenant` |
| NFR-401 | Idempotency ของคำสั่งที่กระทบสิทธิ์และเงิน | คำสั่ง entitlement และ plan term ต้อง replay ได้ด้วย `commandId` + fingerprint และปฏิเสธ payload ต่าง (409) | `set-partner-features.use-case.ts`, `plan-term-adjustment.ts` |
| NFR-402 | Optimistic concurrency | การเขียนทุกจุดที่ผู้ดูแลสองคนอาจชนกันต้องมี CAS token (`expectedSetVersion`, `expectedVersion`, `expectedLegalIdentityVersion`, `expectedDisplayName`, `expectedBudgetRevision`) และตอบ 409 เมื่อข้อมูลเปลี่ยน | DTO ใน `partner.controller.ts` |
| NFR-403 | ลำดับการล็อก | ผู้เขียน term/lifecycle ทุกตัวต้องล็อกแถว `Company` (`FOR UPDATE`) ก่อนอ่านหรือเขียน term | `lock-plan-term-company.ts` |
| NFR-404 | Audit | ทุกคำสั่งเขียนของส่วน A/B/C บันทึก `AuditLog` พร้อมผู้ทำ `requestId` ระดับความเสี่ยง และค่าก่อน/หลัง; การเปิดดูรหัสผ่านและการส่งออกรายงานบันทึกทุกครั้ง รวมที่ถูกปฏิเสธ | action ใน FR แต่ละข้อ |
| NFR-405 | ความลับ | ไม่คืนค่าลับของ LINE/webhook ใน API; รหัสผ่านชั่วคราวแสดงครั้งเดียวและเก็บแบบเข้ารหัส; secret ของ webhook เก็บแบบเข้ารหัสด้วย `credentialEncryptionKey` | `set-shared-line-credential.use-case.ts`, `workflow-webhook.use-case.ts`, `credential-cipher.logic.ts` |
| NFR-406 | การยืนยันตัวตนซ้ำและจำกัดอัตรา | การหมุนกุญแจ LINE ต้องยืนยันรหัสผ่านปัจจุบันและจำกัด 10 ครั้ง/300 วินาที/ผู้ใช้; การส่งออกรายงานจำกัดผู้ใช้ละหนึ่งงานพร้อมกัน | `system-line.controller.ts`, `executive-report-read.service.ts` |
| NFR-407 | ข้อความที่ส่งออกนอกระบบ | ข้อความที่ผู้ดูแลพิมพ์และถูก push ผ่าน OA ต้องมีเฉพาะลิงก์โดเมนของระบบหรือ `liff.line.me` และยาวไม่เกิน 500 ตัวอักษร | `partner-line-message.logic.ts` |
| NFR-408 | Fail-open/fail-closed ที่ตั้งใจ | ร้านไม่มีแถว term = ไม่จำกัด; ร้านไม่มีแถว entitlement = เปิดทั้งหมด (legacy); แต่การตรวจสิทธิ์ใช้ฟรีต้อง fail-closed (503) เมื่ออ่านหลักฐานไม่ได้ | `plan-term-limit.ts`, `entitlement.helper.ts`, `free-expense-access.ts` |
| NFR-409 | ความตรงเวลาในการบังคับใช้อายุแพ็ก | การปฏิเสธร้านที่หมดอายุทำที่ AuthGuard ทันที ไม่รอ sweep; sweep ทุก 5 นาทีมีไว้พลิกสถานะและแจ้งเตือน | `auth.guard.ts:309-331`, `plan-term-sweep-worker.ts` |
| NFR-410 | เขตเวลา | วันที่ที่ผู้ใช้เห็นและขอบเขตเดือนของรายงานยึด Asia/Bangkok; ระยะ term เป็นจำนวนวัน × 24 ชั่วโมงพอดี ไม่ใช่เดือนปฏิทิน | `plan-term.logic.ts`, `executive-report.logic.ts` |
| NFR-411 | งานเบื้องหลังต้อง idempotent และจำกัดขนาด | sweep 200 ร้าน/รอบ; drain 25 เหตุการณ์/รอบ; retry 50 รายการ/รอบ; rebuild รอบเดียวพร้อมกันด้วย advisory lock; ความล้มเหลวของหนึ่งร้านไม่หยุดทั้งชุด | use case ที่เกี่ยวข้อง |
| NFR-412 | ไม่มีผลข้างเคียงซ้ำ | run ของกฎ unique ต่อ `(companyId, ruleVersionId, dedupKey)`; action unique ต่อ `(companyId, actionType, idempotencyKey)`; เหตุการณ์ unique ต่อ `(companyId, eventId)` | `workflow-idempotency.logic.ts` |
| NFR-413 | ความปลอดภัยของ action อัตโนมัติ | เวิร์กโฟลว์ทำได้เฉพาะ 8 ชนิดที่อนุญาต ไม่มี action ที่เปลี่ยนเงิน สต๊อก ภาษี บัญชี หรือสิทธิ์ | `workflow.constants.ts`, `workflow-action.logic.ts` |
| NFR-414 | ป้องกัน SSRF ของ webhook | HTTPS/443, allowlist ของ host, ปฏิเสธที่อยู่ที่ไม่ใช่ public ทั้ง IPv4/IPv6, ตรึงที่อยู่ที่ resolve แล้วตอนเชื่อมต่อ, payload ≤ 64 KiB, timeout 10 วินาที | `workflow-webhook-security.logic.ts` |
| NFR-415 | ความเป็นส่วนตัวในรายงานผู้บริหาร | ช่องทางติดต่อของเจ้าของร้านเห็นได้เฉพาะผู้มี `system.executive.contact.read`; คำค้นไม่ถูก log; ทุกคำตอบ `Cache-Control: no-store`; ข้อผิดพลาดใช้ข้อความคงที่ไม่แทรกข้อมูลนำเข้า | `executive-report.controller.ts`, `executive-users.service.ts` |
| NFR-416 | ความโปร่งใสของตัวเลข | ตัวเลขรายงานทุกตัวต้องมี `coverage` และ `reasonCodes` เมื่อไม่ครบ; การส่งออกผูกกับ `buildId` ที่ผู้ใช้เห็น | `packages/contracts/src/executive-business.ts` |
| NFR-417 | ขีดจำกัดการส่งออก | ไฟล์ส่งออกไม่เกิน 10,000 แถว | `executive-report-read.service.ts` |
| NFR-418 | ขนาดหน้า | รายการทุกเส้น `pageSize ≤ 100`; คิวคำขอเปลี่ยนแพ็ก ≤ 200 แถว; เครดิตค้าง 100 แถว/หน้า | use case ที่เกี่ยวข้อง |

---

## 13. การทดสอบที่ครอบคลุม

ไฟล์ทดสอบมีอยู่จริงใน checkout (ไม่ได้รันในงานเอกสารนี้ตามกติกาการทำงาน)

| พื้นที่ | ไฟล์ |
|---|---|
| ส่วน A — API | `SPM/presentation/http/partner.controller.spec.ts`, `partner-support-tools.spec.ts`; `SPM/application/use-cases/` : `set-partner-features`, `set-partner-ai-model`, `set-platform-ai-budget`, `get-partner-ai-usage`, `partner-ai-credit-holds`, `partner-lifecycle-transition`, `partner-member-console.use-cases`, `partner-member-line-link-token`, `set-partner-line-credential`, `update-partner-profile`, `update-partner-identity`, `lookup-users`, `package-change-decision` (`*.spec.ts`); `SPM/domain/logic/partner-line-message.logic.spec.ts`; `SPM/report-labels.pg.spec.ts`, `SPM/manual-expense-web-entry.pg.spec.ts` |
| ส่วน B — API | `SPM/application/use-cases/company-plan-term.use-cases.spec.ts`, `plan-term-sweep.use-case.spec.ts`; `SPM/domain/logic/plan-term.logic.spec.ts`, `receipt-quota.logic.spec.ts`; `SPM/application/free-expense-access.spec.ts`, `free-expense-access.pg.spec.ts`; `apps/workers/src/modules/plan-term-sweep/plan-term-sweep-worker.spec.ts` |
| ส่วน A/B — เว็บ | `apps/web/src/features/system-partners/` : `system-partners.logic.spec.ts`, `plan-term.logic.spec.ts`, `ai-budget.logic.spec.ts`, `report-labels.logic.spec.ts`, `company-team-note.spec.ts`, `manual-web-entry-switch.qa.spec.ts`, `PartnerSupportTools.qa.spec.ts`; `apps/web/src/features/plan-term/plan-term.logic.spec.ts`, `plan-term.api.spec.ts` |
| ส่วน C — API | `EXB/executive-report-build.pg.spec.ts`, `executive-report-read.pg.spec.ts`, `executive-demo-classification.spec.ts` |
| ส่วน C — เว็บ | `apps/web/src/features/executive-reports/` : `executive-reports.logic.spec.ts`, `executive-export.logic.spec.ts`, `executive-period.spec.ts`, `executive-presentation.spec.ts`, `executive-infographic.spec.ts`, `executive-compact-report.spec.ts`, `executive-design-v2.spec.ts`, `executive-browser-review.spec.ts`, `ExecutiveReportContent.spec.ts`, `ExecutiveReports.wiring.spec.ts`; `apps/web/src/features/executive-users/executive-users.logic.spec.ts`, `executive-users.qa.spec.ts` |
| ส่วน D — API | `WF/application/use-cases/` : `workflow-event-ingest`, `workflow-outbox-drain`, `workflow-runner`, `workflow-action-runner`, `workflow-retry`, `workflow-scan`, `workflow-task`, `workflow-template`, `workflow-template-auto-enable` (`*.spec.ts`); `WF/domain/logic/` : `workflow-condition`, `workflow-idempotency`, `workflow-event-match`, `workflow-action`, `workflow-permission`, `workflow-render`, `workflow-webhook-security` (`*.spec.ts`); `WF/presentation/http/workflow-internal.controller.spec.ts` |
| E2E (Playwright) | `e2e/system-admin.spec.ts`, `e2e/system-settings-ux.spec.ts`, `e2e/executive-report.spec.ts`, `e2e/plan-term-billing-readiness.spec.ts`, `e2e/manual-expense-web-entry.spec.ts`, `e2e/sidebar-nav.spec.ts`, `e2e/journeys/team-and-roles.journey.spec.ts`, `e2e/journeys/shop-menus-everyday.journey.spec.ts`, `e2e/journeys/package-upgrade-unlocks-50-tawi.journey.spec.ts` |
| Smoke scripts | `apps/api/src/scripts/partner-plan-adjustments-smoke.ts`, `billing-plan-adjustments-smoke.ts`, `billing-feature-controls-smoke.ts`, `signup-journey-smoke.ts` |

---

## 14. นอกขอบเขตแพ็ก 1,999 (มีโค้ดแต่ไม่ได้ขาย)

เหตุผลร่วม: feature key ที่คุมไม่อยู่ใน `TIER_FEATURE_PRESETS` ของแพ็กใด และไม่อยู่ใน `SALES_DEAL_ALLOWED_FEATURE_KEYS` permission ของฟีเจอร์เหล่านี้ถูกตัดออกตอน resolve สิทธิ์สำหรับร้านในแพ็ก (รวม OWNER) จึงทั้งเมนู หน้าเว็บ API และเครื่องมือ LINE AI ที่อ้าง permission เดียวกันใช้ไม่ได้ เปิดได้เฉพาะเมื่อ System Admin เปิดรายร้าน (FR-CRM-015) ทุก path ด้านล่างมี prefix `/v1/companies/:companyId/` เว้นแต่ระบุเป็นอย่างอื่น

### 14.1 โมดูล `crm` (feature `crm`)

| ฟีเจอร์ | สรุปบรรทัดเดียว |
|---|---|
| ลูกค้า (`crm.customers`, เมนู `customers`: ready) | `crm/customers` รายการ/สร้าง/อ่าน/แก้, `merge/preview`, `merge`, `line-identities/:identityId/link`, `archive`, `assign`; ผู้ติดต่อ `customers/:id/contacts`, `contacts/:contactId`; หน้า `/customers`, `/crm/customers/[customerId]`; permission `crm.customer.*`, `crm.contact.*`; `CrmCustomer` (`ACTIVE`/`INACTIVE`/`ARCHIVED`/`MERGED`), `CrmContactPerson` |
| ลูกค้ามุ่งหวัง (`crm.leads`) | `crm/leads` รายการ/สร้าง/อ่าน/แก้/`assign`/`convert`/`disqualify`; หน้า `/crm?tab=leads`; `crm.lead.*`; `CrmLead` (`NEW`/`CONTACTED`/`QUALIFIED`/`CONVERTED`/`DISQUALIFIED`/`ARCHIVED`) |
| ไปป์ไลน์และโอกาสขาย (`crm.pipeline`) | `crm/pipeline/stages` (GET/PUT), `crm/activities`, `crm/opportunities` (+`board`, `stage`, `close`, `reopen`, `quotations`, `quotation-drafts`, `quotations/:linkId/refresh`); หน้า `/crm?tab=pipeline`; `crm.opportunity.*`, `crm.activity.*`, `crm.pipeline.configure`, `crm.quotation.link`; `CrmOpportunity` (`OPEN`/`WON`/`LOST`/`ARCHIVED`), `CrmPipelineStage`, `CrmActivity`, `CrmQuotationLink` |
| งานติดตาม (`crm.followups`) | `crm/follow-ups` รายการ/สร้าง/แก้/`complete`/`snooze`/`cancel`; หน้า `/crm?tab=followups`; `crm.follow_up.*`; `CrmFollowUpTask` (`OPEN`/`DONE`/`SNOOZED`/`CANCELED`/`OVERDUE`) |
| การจองออนไลน์ (`crm.bookings`, เมนู `booking`: ready) | `crm/bookings` (+`settings` GET/PATCH, `availability`, `by-customer/:customerId`, `:bookingId` PATCH, `:bookingId/cancel`); หน้า `/bookings`; `crm.booking.*`; `CrmBooking` (`BOOKED`/`CANCELLED`/`DONE`/`NO_SHOW`), `CrmBookingProposal` |
| สรุปแดชบอร์ด CRM และ AI อ่านข้อมูล CRM | `crm/dashboard/summary` (`crm.report.read`), `crm/ai/follow-up-priorities`, `crm/ai/customers/:id/summary`, `crm/ai/opportunities/:id/summary`, `crm/ai/pipeline-summary` (`crm.ai.read`) |
| รายงาน CRM (`crm.overview`, เมนู `crmreport`: **planned**) | `crm/reports/summary` (อยู่ใน `crm-inbox`); หน้า `/crm-reports`; `crm.report.read` |
| นโยบายส่วนลด (เมนู `discount`: **planned**) | หน้า `/settings/discount-policy`; API อยู่ในโมดูล `employee-access` (`business-policy.controller.ts`) ไม่ใช่โมดูล `crm`; ผูก `crm.customers` |

### 14.2 โมดูล `crm-inbox` (feature `crm.inbox`, `line_oa`)

| ฟีเจอร์ | สรุปบรรทัดเดียว |
|---|---|
| กล่องข้อความ (เมนู `inbox`: ready) | `crm/conversations` รายการ/อ่าน, `messages/:messageId/content`, `messages` (ตอบ), `notes`, `status`, `priority`, `auto-reply`, `tags`, `assign`, `read`; หน้า `/inbox`; `crm.inbox.read/reply/note/assign/resolve`; `CrmConversation` (`NEW`/`OPEN`/`WAITING_CUSTOMER`/`WAITING_INTERNAL`/`FOLLOW_UP`/`RESOLVED`/`SPAM`), `CrmMessage` |
| สร้างงานจากบทสนทนา | `crm/conversations/:id/create-deal`, `create-task`, `create-quotation`, `messages/:messageId/flag-payment-proof` |
| หลักฐานการชำระจากแชต | `crm/payment-proofs` รายการและเนื้อหาไฟล์ (`accounting.document.read`); หน้า `/crm/payment-proofs` |
| สรุปประจำวันของกล่องข้อความ | `crm/daily-brief` (`crm.inbox.read`) |
| AI ช่วยตอบในกล่องข้อความ | `crm/conversations/:id/ai/trust`, `summary`, `reply-draft`, `insights`, `feedback`; `crm/customers/ai-profile-extract`; permission `crm.ai.assist` (คุมด้วย `ai_line_assistant` แต่ข้อมูลอยู่ใต้ `crm.inbox`); `CrmAiAssistFeedback`, `CrmAutonomyJob` |
| ลูกค้า 360 และลบข้อมูลลูกค้า | `crm/customers/:customerId/summary360`, `timeline`, `erase` (`crm.customer.erase`); `CrmDataSubjectRequest` |
| เทมเพลตข้อความ | `crm/templates` รายการ/สร้าง/แก้/`archive`/`approve-ai`; `crm.template.read/manage`; `CrmMessageTemplate` |
| นโยบายกล่องข้อความ | `crm/inbox-policy` GET/PUT (`crm.inbox.policy_manage`); `CrmInboxPolicy` |
| แคมเปญ broadcast | `crm/campaigns` รายการ, `drafts`, `:id/preview`, `:id/send`, `generate`; `crm.campaign.read/manage/send`; `CrmCampaign` (`DRAFT`…`CANCELLED`), `CrmCampaignRecipient` |
| เชื่อมต่อ LINE OA ของร้าน (`line_oa`, เมนู `lineoa`: ready) | `crm/channels` รายการ/สร้าง, `:channelId/settings`, `test`, `rotate`, `disable`, `reveal`; หน้า `/settings/line-oa`; `crm.channel.read/manage`; `CrmChannelIdentity`, `CrmChannelAutoReplyUsage` |
| Webhook ของ LINE OA ร้าน | `POST /v1/crm/line/webhook/:webhookKey` (public, ตรวจลายเซ็น) → `process-inbound-line-message.use-case.ts` |
| ลูกค้าปลายทางลงทะเบียนผ่าน LINE | `POST /v1/auth/line/customer-register`, `GET /v1/auth/line/customer-register-page` (public) |
| PDPA self-service ของลูกค้าปลายทาง | `POST /v1/crm-customer/pdpa/consent-withdraw`, `data-export`, `erasure-request`, `erasure-status` (public) |
| งานเบื้องหลังของ CRM | `POST /v1/internal/crm/` : `campaign-delivery-scan`, `sla-breach-scan`, `new-conversation-scan`, `inbox-retry-scan`, `autonomy-retry-scan`, `booking-reminder-scan`, `booking-proposal-sweep`, `pdpa-purge`, `pdpa-erasure-process`, `pdpa-post-restore-re-erasure`, `trust-score-scan` (worker token) |

### 14.3 โมดูล `inventory` (feature `inventory`, `product_catalog`)

| ฟีเจอร์ | สรุปบรรทัดเดียว |
|---|---|
| สินค้าและบริการ (`product_catalog`, เมนู `crmsettings`: ready) | `inventory/products` รายการ/สร้าง/อ่าน/แก้/`archive`, `:productId/barcodes`, `:productId/internal-qr`, `:productId/movements`, `:productId/balances`; หน้า `/settings/crm-catalog`, `/settings/crm-catalog/new`, `/settings/crm-catalog/[productId]`, `/inventory/products*`; `inventory.product.read/manage`; `Product`, `ProductBarcode` |
| สถานที่จัดเก็บ (`inventory.locations`) | `inventory/locations` รายการ/สร้าง/อ่าน/แก้/`archive`, `:locationId/balances`, `:locationId/internal-qr`; หน้า `/inventory/locations`; `inventory.location.read/manage`; `InventoryLocation` |
| ความเคลื่อนไหวสต๊อก (`inventory.movements`) | `inventory/movements` รายการ, `movements/receive`, `issue`, `transfer`, `count`, `adjust`; หน้า `/inventory/movements`, `/inventory/movements/new`, `/inventory/stock-count`; `inventory.movement.read/create/adjust`, `inventory.stock_count.create`; `StockMovement` (ชนิด `STOCK_IN`, `STOCK_OUT`, `TRANSFER_OUT`, `TRANSFER_IN`, `COUNT_ADJUSTMENT_IN/OUT`, `ADJUSTMENT_IN/OUT`) |
| รายงานสต๊อก (`inventory.stock_report`) | `inventory/balances`, `inventory/reports/stock`; หน้า `/inventory`, `/inventory/reports/stock`; `inventory.report.read` |
| ป้าย QR และการสแกน | `inventory/labels` รายการ, `generate`, `resolve`, `scan`, `:labelId/printed`; หน้า `/inventory/scan`; `inventory.label.manage` |

### 14.4 โมดูล `procurement` (feature `procurement`)

| ฟีเจอร์ | สรุปบรรทัดเดียว |
|---|---|
| ผู้จำหน่าย (`procurement.suppliers`) | `procurement/suppliers` รายการ/สร้าง/อ่าน/แก้, `:supplierId/bank-accounts` GET/POST; หน้า `/procurement?tab=suppliers`; `procurement.supplier.*`, `procurement.supplier.bank.*`; `SupplierProfile`, `SupplierBankAccount` |
| ใบขอซื้อ PR (`procurement.purchase_requests`) | `procurement/purchase-requests` รายการ/สร้าง/อ่าน, `submit`, `approve`, `reject`, `cancel`; หน้า `/procurement?tab=pr`; `PurchaseRequest` (`DRAFT`/`PENDING_APPROVAL`/`APPROVED`/`REJECTED`/`CANCELLED`/`CONVERTED`) |
| ใบสั่งซื้อ PO (`procurement.purchase_orders`) | `procurement/purchase-orders` รายการ/สร้าง/อ่าน, `approve`, `issue`, `reject`, `cancel`, `close`; หน้า `/procurement?tab=po`; `PurchaseOrder` (`DRAFT`…`ISSUED`/`PARTIALLY_RECEIVED`/`RECEIVED`/`PARTIALLY_BILLED`/`BILLED`/`CLOSED`/`CANCELLED`) |
| ใบรับสินค้า GR (`procurement.goods_receipts`) | `procurement/goods-receipts` รายการ/สร้าง/อ่าน, `post` (ตัดสต๊อกผ่านโมดูล `inventory`), `void`; หน้า `/procurement?tab=gr`; `GoodsReceipt` (`DRAFT`/`POSTED`/`VOIDED`) |
| ใบวางบิล (`procurement.vendor_bills`, เมนู `accounts-payable`: ready) | `accounts-payable/vendor-bills` รายการ/สร้าง/อ่าน, `tax-evidence` (PATCH), `tax-evidence/review`, `posting-source`, `pp36-posting-source`, `match`, `match/override`, `submit`, `approve`, `reject`, `void`, `approval-policy` (GET/PUT), `:vendorBillId/lines/:lineId/pp36-input-claim`; หน้า `/accounts-payable?tab=bills`; `VendorBill` (`DRAFT`/`NEEDS_REVIEW`/`PENDING_APPROVAL`/`APPROVED`/`PARTIALLY_PAID`/`PAID`/`VOIDED`/`CREDITED`), `VendorBillMatch`, `PurchaseApprovalEvent` |
| การชำระเงินผู้จำหน่าย (`procurement.supplier_payments`) | `accounts-payable/payments` รายการ/สร้าง/อ่าน, `posting-source`, `pp36-posting-source`, `void`, `wht-income-categories`; หน้า `/accounts-payable?tab=payments`; `SupplierPayment` (`DRAFT`/`RECORDED`/`VOIDED`), `SupplierPaymentAllocation` |
| AP Aging และ statement (`procurement.ap_aging`) | `accounts-payable/aging`, `accounts-payable/suppliers/:supplierId/statement`; หน้า `/accounts-payable?tab=aging`; `procurement.ap.report` |
| อนุมัติคำสั่งซื้อ (เมนู `poapproval`: **planned**) | มีหน้า `/settings/po-approval`; ผูก `procurement.purchase_orders` |

### 14.5 โมดูล `workflow` ฝั่งผู้ใช้ (feature `workflow_automation`, เมนู `workflow`: ready)

| ฟีเจอร์ | สรุปบรรทัดเดียว |
|---|---|
| เทมเพลต | `workflow/templates` รายการ, `:templateKey/enable`; หน้า `/workflow?tab=templates`; `workflow.template.read`, `workflow.rule.manage` + `workflow.rule.enable` |
| กฎอัตโนมัติ | `workflow/rules` รายการ/สร้าง/อ่าน/แก้, `enable`, `disable`, `test`; หน้า `/workflow?tab=rules`; ต้องมีสิทธิ์อ่านโมดูลต้นทางของกฎด้วย (`WORKFLOW_SOURCE_MODULE_READ_PERMISSIONS`) |
| ประวัติการทำงาน | `workflow/runs`, `runs/:runId`, `explanations/:runId`, `action-runs/:actionRunId/replay`; หน้า `/workflow?tab=runs`; `workflow.run.read/replay` |
| งานที่มอบหมาย | `workflow/tasks` รายการ, `snooze`, `complete`, `cancel`; หน้า `/workflow?tab=tasks`; `workflow.task.read/work` (ร้านในแพ็กได้งานถูกสร้างโดยเครื่องยนต์ แต่ไม่มีหน้านี้ให้เปิด; งานอนุมัติปิดเองตาม FR-CRM-052) |
| ข้อผิดพลาดค้าง | `workflow/dead-letters` รายการ, `replay`, `ignore`; หน้า `/workflow?tab=dead-letters`; `workflow.dead_letter.read/replay` |
| Webhook ปลายทาง | `workflow/webhooks` รายการ/สร้าง, `enable`, `disable`; หน้า `/workflow?tab=webhooks`; `workflow.webhook.manage` |
| เทมเพลตที่ไม่เปิดอัตโนมัติ | `AVAILABLE`: `low_stock_alert`, `vendor_bill_pending_approval`, `vendor_bill_second_approval`, `tax_due_soon`, `bank_reconciliation_aging`, `crm_follow_up_due`, `crm_opportunity_stuck`, `ai_draft_requested`, `outbound_webhook`; `UNAVAILABLE`: `stockout_risk`, `overdue_invoice_follow_up`, `sales_below_target`; `DEPRECATED`: `daily_owner_summary` |

### 14.6 รายการที่เกี่ยวข้องแต่เป็นของพื้นที่อื่น

| รายการ | สรุปบรรทัดเดียว |
|---|---|
| เมนู `salesdoc`, `sales`, `accounting` (ทั้งหมด **planned**, feature `sales_documents`) | เอกสารขายและรับชำระ อยู่ในโมดูล `accounting-documents` ไม่อยู่ในแพ็กใด |
| ดีลของเซลล์และคอนโซลเซลล์ | อยู่ในโมดูล `sales-console` (ขายได้เฉพาะ `SALES_DEAL_ALLOWED_FEATURE_KEYS`) อธิบายในเอกสารพื้นที่ billing/sales |
| เครื่องมือ LINE AI ของ CRM/คลัง/จัดซื้อ/เวิร์กโฟลว์ | `apps/api/src/modules/line-ai/application/use-cases/erp-crm-tools.use-case.ts`, `erp-crm-operational-tools.use-case.ts`, `erp-procurement-ledger-tools.use-case.ts`, `erp-workflow-tools.use-case.ts` ฯลฯ ใช้ permission ชุดเดียวกัน จึงปิดไปพร้อมฟีเจอร์ |
| การลงบัญชีจากเอกสารจัดซื้อ | `ledger` import ตัวสร้าง posting source ของ vendor bill / supplier payment / PP36 จาก `procurement`; ทำงานเมื่อเปิดทั้ง `double_entry_ledger` และ `procurement` ซึ่งไม่อยู่ในแพ็กใด |

---

## 15. สิ่งที่ตรวจไม่ได้ และสิ่งที่พบในเอกสารแต่ไม่พบในโค้ด

### 15.1 ตรวจไม่ได้หรือตรวจไม่ครบ

1. **ไม่ได้รันการทดสอบหรือระบบจริง** ตามกติกาการทำงาน (อ่านอย่างเดียว) ข้อกำหนดทั้งหมดมาจากการอ่านโค้ด
2. **หน้าเว็บ** ยืนยันเฉพาะการมีอยู่ของ route, ไฟล์หน้า และคอมโพเนนต์ที่ import ไม่ได้อ่านรายละเอียดการแสดงผลทุกส่วนของ `PartnerDetailPage.tsx` (ยาวกว่า 3,800 บรรทัด) และ `ExecutiveReportPage.tsx`
3. **`ExecutiveReportReadService`** (1,420 บรรทัด) อ่านโครงเมธอด, ส่วน export ช่วงต้น และ DTO ครบ แต่ไม่ได้อ่านสูตรคำนวณทุกตัว (เช่น เกณฑ์ `TOP20`/`TO80`, การจัดอันดับเมื่อคะแนนเท่ากัน) สูตรละเอียดต้องดูโค้ดและ `executive-report-read.pg.spec.ts`
4. **`/system/platform-access`** (`PlatformAccessPage.tsx`) อยู่ในโฟลเดอร์ `system-partners` ของเว็บ แต่ไม่ได้เรียก API ของเจ็ดโมดูลในเอกสารนี้เท่าที่ตรวจ (ไม่ได้อ่านว่าเรียก endpoint ใด) จึงไม่ได้ผูกกับ FR ใด
5. **`get-partner-detail.use-case.ts`, `get-partner-ai-usage.use-case.ts`, `get-partner-timeline.use-case.ts`** ยืนยันจาก model ที่อ่านและชนิดเหตุการณ์ ไม่ได้ไล่ทุก field ของ DTO
6. **`set-partner-ai-model.use-case.ts`** ยืนยันรหัสข้อผิดพลาดครบ แต่ไม่ได้ยืนยันรายการ `modelId` ที่อนุมัติและค่าเพดานงบของแพลตฟอร์ม (อยู่ใน `packages/contracts/src/ai-budget-bounds.ts` และคอนฟิก)
7. **ข้อความและป้ายภาษาไทยบนหน้าจอ** ไม่ได้คัดลอกมาทั้งหมด ยกมาเฉพาะข้อความที่ฝั่ง API สร้าง
8. **ค่า TTL จริงของรหัสผ่านชั่วคราว** (`temporaryPasswordExpiry`) และ `OWNER_LINE_LINK_TOKEN_TTL_MS` อยู่ในโมดูล `employee-access`/`auth`; ใช้ค่า 72 ชั่วโมงตามคอมเมนต์ใน `partner-member-line-link-token.use-case.ts:41`
9. **e2e ที่ครอบคลุม** จับคู่จากชื่อไฟล์และการ grep คำสำคัญ ไม่ได้อ่านทุกกรณีทดสอบ
10. **เลข NFR** ใช้ช่วง 400–419 เองเพราะ brief ไม่ได้จัดสรรช่วงต่อเอกสาร

### 15.2 พบในเอกสารหรือชื่อ แต่ไม่พบในโค้ด / โค้ดที่ไม่มีทางเข้า

1. **"marketing platforms"** (ระบุในขอบเขตงาน): ไม่พบโมดูล controller หรือ model ใดในโค้ด มีเพียงค่า enum `MARKETPLACE` ของแหล่งที่มาลูกค้า/ลีด
2. **กุญแจ LINE รายร้านโดยผู้ดูแล**: มี permission `system.partner_line_credential.manage`, use case `SetPartnerLineCredentialUseCase` (ลงทะเบียนใน module) และ spec ของมัน แต่ **ไม่มี controller route เรียกใช้** ใน `system-partner-management` (ผู้เรียกเดียวที่พบคือ module provider)
3. **คอมเมนต์ใน catalog ของเวิร์กโฟลว์** ระบุว่า "All templates default to disabled — admin must enable/configure each from web" (`workflow-template-catalog.ts:139-142`) ซึ่งไม่ตรงกับพฤติกรรมจริงของเทมเพลต `autoEnable` 15 ตัวที่ถูกเปิดอัตโนมัติ
4. **คอมเมนต์ `TIER_FEATURE_PRESETS`** ระบุว่า "All four paid tiers share starter menus" ตรงกับโค้ด แต่ป้ายชุด `มาตรฐาน`/`ครบวงจร` ใน `FEATURE_PACKAGE_PRESETS` อาจทำให้เข้าใจว่าเป็นแพ็กที่ขาย: ในโค้ดทั้งสองเป็นเพียงปุ่มลัดของผู้ดูแลในหน้าพาร์ทเนอร์และฟอร์มดีล ไม่มีแพ็กราคาใดผูกกับชุดนี้
5. **`DEFAULT_ENABLED_FEATURE_KEYS`** และคอมเมนต์ "Standard package enabled for newly onboarded companies (the Mangmee baseline)" (`feature-registry.ts`) อธิบายพฤติกรรมเดิม เส้นทางสร้างร้านปัจจุบันใช้ชุด starter เป็นค่าปริยาย
6. **การบังคับ entitlement ของเวิร์กโฟลว์เบื้องหลัง**: โค้ดอ้างแผน "CC1 guard" และบันทึกแบบ shadow แต่ยังไม่ได้เปิดบังคับ (`SHADOW ONLY` ในสามจุด) ร้านที่ปิด `workflow_automation` จึงยังได้รับการแจ้งเตือนจากกฎที่เปิดอัตโนมัติ ซึ่งเป็นพฤติกรรมที่แพ็กที่ขายพึ่งพา
7. ไม่ได้ไล่อ่าน `docs/specs` ของ CRM/คลัง/จัดซื้อทีละฉบับเพื่อเทียบกับโค้ด เพราะทั้งสามโมดูลอยู่นอกขอบเขตแพ็ก; ความแตกต่างระหว่าง spec กับโค้ดของส่วนนั้นจึงไม่ได้ตรวจ
