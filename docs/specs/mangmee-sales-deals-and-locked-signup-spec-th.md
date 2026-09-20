# Feature: สมัครแล้วล็อก (ไม่มีทดลองฟรี) + Sales console + ดีลพิเศษ + หน้าแพ็กเกจ — Spec ฉบับรวม

## 1. Status

- วันที่: 2026-09-20 · สถานะ: **DRAFT — โครงตามมติ Owner วันนี้ครบแล้ว รอตอบ D1–D5 (§16) ก่อนลงมือ** · ผู้เขียน: Claude (controller)
- **แทนที่** เอกสารก่อนหน้าของวันเดียวกัน: [free-usage-close-toggle-plan](../plans/free-usage-close-toggle-plan-th.md) (สวิตช์ไม่จำเป็นแล้ว แต่ locked shell + LINE fixes ยังใช้), [special-invoice spec](special-invoice-manual-payment-spec-th.md) (กลายเป็น "ดีล" + ช่องทางโอน), [billing-special-price spec](billing-special-price-spec-th.md) (พักไว้; ทะเบียน G01–G33 ยังอ้างอิงได้)
- ฐานโค้ด: `main` 61c7cc37 · แผน: [mangmee-sales-deals-and-locked-signup-plan-th.md](../plans/mangmee-sales-deals-and-locked-signup-plan-th.md) · memory: [mangmee-sales-deals-2026-09-20.md](../agent-memory/mangmee-sales-deals-2026-09-20.md)

## 2. Goal

1. ตั้งแต่นี้ **ไม่มีทดลองใช้ฟรี**: ร้านที่สมัครใหม่คุยกับ AI ไม่ได้ และบนเว็บเห็นแค่ "ตั้งค่า (ข้อมูลร้านและบัญชีของฉัน)" กับ "แพ็กเกจ" จนกว่าจะชำระเงิน; ร้านที่กำลังทดลองอยู่ใช้จนครบวันเดิม (มติ Owner)
2. ทีมขายของมั่งมีมี **Sales console** เป็น role แยก: หัวหน้าเซลล์สร้างบัญชีเซลล์ในทีม ดูยอดขาย/ยอดเปิดบริษัทของทุกทีม อนุมัติดีล; เซลล์สร้างดีลพิเศษให้ร้านที่มีบัญชีอยู่แล้วด้วย **ราคาใดก็ได้ จำนวนเดือน โควตา สาขา ผู้ใช้ เมนู งบ AI** แล้วส่งหัวหน้าอนุมัติ
3. เมื่ออนุมัติ ระบบสร้างการ์ด **"ข้อเสนอพิเศษสำหรับร้านคุณ"** บนหน้าแพ็กเกจของร้านนั้นร้านเดียว ลูกค้ากรอกข้อมูลและชำระเอง (บัตร/PromptPay ผ่าน Stripe เปิดสิทธิ์อัตโนมัติ; โอนแล้วแนบสลิปเป็นทางสำรอง) **ภายใน 3 วัน** ไม่มีการเปิดสิทธิ์ก่อนจ่าย
4. Admin console (Owner) สร้างบัญชีเซลล์พร้อมข้อมูลสำหรับทำใบค่าจ้าง/50 ทวิ (คอมมิชชันคำนวณนอกระบบ)

## 3. Source Docs และของเดิมที่ต่อยอด

- ล็อกเมื่อ term หมด: P29 §4B (`auth.guard.ts:264-275` `company_term_expired`, allowlist `:55-79`; sweep 5 นาที; web `PlanTermBanner`/`CompanyTermExpiredPage`; LINE `replyIfTermExpiredOwner`) — ทะเบียน gap เดิม G01–G20 ใน free-usage plan §5 ยังใช้ทั้งหมด
- Billing: Checkout/evidence/reconciler (P26), one-time Checkout ของซื้อซ้ำ (`billing-repeat.ts:266-276` `mode: 'payment'` + `price_data` ยอดที่ระบบใส่เอง), evidence แบบครั้งเดียว `paid-checkout-invoice.ts` (ตรวจกับ snapshot), event `checkout.session.async_payment_*` รับอยู่แล้ว (`billing-reconciler.service.ts:24-25`)
- Reviewed ops + single-admin + proof รหัสผ่าน: `billing-receipt-adjustments.service.ts`, `billing-approval.ts`
- คำขอเปลี่ยนแพ็กเกจ: `PackageChangeRequest` + คอลัมน์ payment (`schema.prisma:3314-3336`), approve atomically (`package-change-decision.use-case.ts`)
- ผู้ใช้/รหัสผ่านชั่วคราว: `create-employee.use-case.ts` (`mustChangePassword`, `generateTemporaryPassword`, push LINE) ; platform tenant `seed-watchdog-system-company` ถือ membership SYSTEM_ADMIN; `platformScope = roles.some(SYSTEM_ADMIN)` (`billing-admin.service.ts:78`); web gate `isSystemAdmin`/`canOpenSystemBilling` (`session-gate.logic.ts:25-33`)
- หน้าจอปัจจุบันที่เป็น to-be: หน้า "ตั้งค่า" การ์ด "ข้อมูลร้านและบัญชีของฉัน" (badge ยังกรอกไม่ครบ) และหน้า "แพ็กเกจและการชำระเงิน" (แพ็กเกจปัจจุบัน → เลือกแพ็กเกจ → การ์ด STARTER/BASIC/PRO/ENTERPRISE)

## 4. Non-goals

- ไม่มีสวิตช์เปิด/ปิด trial (ค่าคงที่ = ไม่มี); ไม่ตัดร้านที่กำลังทดลอง
- ไม่มี coupon/Price เฉพาะร้านบน subscription; ไม่มีตัดบัตรอัตโนมัติสำหรับดีล (ต่ออายุดีล = จ่ายใหม่แตะเดียว)
- ไม่คำนวณคอมมิชชัน/ไม่ออกใบค่าจ้าง/50 ทวิ จากระบบ (เก็บข้อมูลให้ทำนอกระบบ)
- ไม่มีการเปิดสิทธิ์ล่วงหน้าก่อนชำระ (ทุกช่องทาง); ไม่มี LIFF/หน้าแอปแยกสำหรับเซลล์ (ใช้เว็บเดิม)
- ไม่ตรวจสลิปอัตโนมัติ (EasySlip) รอบแรก

## 5. User Roles

| บทบาท | ที่อยู่ในระบบ | ทำอะไรได้ |
|---|---|---|
| SYSTEM_ADMIN (Owner) | platform tenant | ทุกอย่างของ Sales console + สร้าง/ระงับบัญชีเซลล์ + ดู/แก้ข้อมูลภาษีเซลล์ (PII) + ตรวจสลิป + อนุมัติดีลแทนหัวหน้าได้เสมอ |
| **MANGMEE_SALES_LEAD** (role ใหม่ใน platform tenant) | `/sales/*` | สร้างบัญชีเซลล์ในทีม (รหัสผ่านชั่วคราว), ดูดีล/ยอดขาย/ยอดเปิดบริษัทของ **ทุกทีม**, อนุมัติ/ปฏิเสธดีล, สร้างดีลเอง |
| **MANGMEE_SALES** (role ใหม่) | `/sales/*` | ค้นหาร้านที่มีบัญชี (ชื่อ, สถานะแพ็กเกจ, จังหวัด — ไม่เห็นข้อมูลธุรกิจ/การเงินของร้าน), สร้าง/แก้ดีล DRAFT, ส่งอนุมัติ, เห็นดีลและยอดของตัวเอง |
| OWNER ร้านค้า | เว็บ/LINE | เห็นการ์ดข้อเสนอเฉพาะร้านตัวเอง กรอกข้อมูลบริษัท/อีเมล ชำระเงิน |
| พนักงานร้าน | — | ไม่เห็นแพ็กเกจ/ข้อเสนอ (เหมือน P26 §14A) |

ชื่อ role ต้องไม่ชนกับ role ระดับบริษัท `SALES` ที่มีอยู่ (`permission-registry.ts:707`) จึงใช้ prefix `MANGMEE_`

## 6. Business Journey

**J1 สมัครใหม่ → ล็อก**: LINE/เว็บ signup → provisioning เขียน term 0 วัน + `DISABLED`/`termDisabledAt` (reason `no_package`) ทันที (ไม่รอ sweep) + push "เปิดร้านแล้ว ขั้นต่อไปเลือกแพ็กเกจ" → LINE: ทุกข้อความ/รูปตอบการ์ด "สมัครแพ็กเกจก่อนเริ่มใช้งาน" + ปุ่มเปิดหน้าแพ็กเกจ (ไม่มี OCR/model) ; "ติดต่อเจ้าหน้าที่"/"ติดต่อเรา" ยังทำงาน → เว็บ: locked shell 2 เมนู

**J2 ลูกค้าเลือกแพ็กเกจเอง**: หน้าแพ็กเกจ → การ์ด catalog → quote → กรอกที่ขาด (ที่อยู่บริษัท, อีเมล) → Checkout (บัตร/PromptPay) → เปิดสิทธิ์อัตโนมัติ (flow P26 เดิม) ; หรือเลือกโอน → ใบเรียกเก็บ + สลิป → แอดมินตรวจ → เปิดสิทธิ์

**J3 เซลล์ทำดีล**: เซลล์ค้นร้าน → ฟอร์มดีล (tier ฐานเติมค่าเริ่มต้น; แก้ราคา/เดือน/ลิมิต/เมนู/งบ AI ได้หมด; โน้ตถึงลูกค้า) → ส่งอนุมัติ → หัวหน้า/Owner อนุมัติ (หรือปฏิเสธพร้อมเหตุผลถึงเซลล์) → ระบบสร้างการ์ดข้อเสนอบนหน้าแพ็กเกจของร้านนั้น + push LINE ถึง OWNER (ไม่มีตัวเลข) → ลูกค้าเลือก → กรอกที่ขาด → ชำระ (บัตร/PromptPay/โอน) → เปิดสิทธิ์ตามดีล → ดีล APPLIED; เซลล์และหัวหน้าเห็นสถานะ

**J4 หมดเวลา/ต่ออายุ**: ข้อเสนอไม่ถูกจ่ายใน 3 วัน → EXPIRED การ์ดหาย ร้านยังล็อก เซลล์ออกใหม่ได้; ร้านที่จ่ายดีลแล้ว 14 วันก่อนหมด ระบบสร้างข้อเสนอรอบถัดไปเงื่อนไขเดิม (D3) → จ่ายใหม่แตะเดียว; ไม่จ่าย → P29 ล็อก

**J5 Owner สร้างเซลล์**: admin console → "ทีมขาย" → สร้างผู้ใช้ (username, ชื่อ, เบอร์, อีเมล, role, ข้อมูลภาษี) → รหัสผ่านชั่วคราว (แสดงครั้งเดียว/ส่ง LINE ถ้าผูก) → เซลล์ login ครั้งแรกต้องเปลี่ยนรหัส

## 7. Business Rules

- R1 **ไม่มี trial**: `TRIAL_DAYS = 0` ทุกช่องทางสมัคร; copy "ทดลองฟรี 30 วัน" ทั้ง 6 จุด (LIFF สมัคร, เว็บสมัคร 3 หน้า, การ์ดโปรโมชั่น, catalog `trial`) เปลี่ยนเป็น "เลือกแพ็กเกจเพื่อเริ่มใช้งาน"; `BillingCatalog.trial` = null; ร้านที่มี term ทดลองอยู่ไม่ถูกแตะ
- R2 **สถานะร้าน** ใช้ term เดิม: ยังไม่มีแพ็กเกจ (term 0 วัน + `termDisabledAt`) → ใช้งาน (term เต็ม) → หมดอายุ (P29); `lockReason` derive จาก term (`termEndsAt <= termStartAt && renewCount = 0` ⇒ `no_package`)
- R3 **ดีล** = แถว `PackageChangeRequest` kind `SALES_DEAL`; หนึ่งร้านมีดีลที่ยังไม่จบได้หนึ่งใบ (partial unique OPEN เดิม); เนื้อหาถูก snapshot ใน `offerSnapshotJson` v2: `{ base: tierKey, priceSatang, months, branchLimit, employeeLimit, monthlySlipLimit, features[], aiMonthlyBudgetSatang|null, description, salesUserId, approvedBy, offerExpiresAt }`; ราคา ≥ 1 satang ไม่มีเพดาน/พื้น (เตือนเมื่อสูงกว่า catalog หรือต่ำกว่าพื้นที่ Owner ตั้ง — ไม่ห้าม); เดือน 1–36
- R4 **สถานะดีล**: DRAFT → PENDING_APPROVAL → APPROVED (การ์ดโชว์; `offerExpiresAt = approvedAt + 3 วัน`) → PAID (Stripe ยืนยัน/แอดมินตรวจสลิป) → APPLIED (เปิดสิทธิ์แล้ว) | EXPIRED (เลย 3 วัน; derive + scan รายวันปิดแถว) | REJECTED (หัวหน้า) | CANCELLED (เซลล์/หัวหน้า ก่อนจ่าย); แก้ไขได้เฉพาะ DRAFT/REJECTED; APPROVED แก้ไม่ได้ (ยกเลิกแล้วออกใหม่)
- R5 **อนุมัติ**: `MANGMEE_SALES_LEAD` หรือ SYSTEM_ADMIN; ผู้สร้างอนุมัติดีลของตัวเองไม่ได้ ยกเว้น SYSTEM_ADMIN (single-admin); ทุกการเปลี่ยนสถานะมีเหตุผล + audit CRITICAL (`sales.deal.*`)
- R6 **ชำระดีลด้วย Stripe แบบครั้งเดียว**: quote จาก snapshot ดีล (ยอด = `priceSatang`, VAT ตามนโยบาย `quoteTotals`), Checkout `mode: 'payment'` `price_data { product: product ของ tier ฐาน (อ่านจาก Price catalog), unit_amount: priceSatang }`, `payment_method_types: ['card','promptpay']`; หลักฐานผ่าน `paidPackageCheckoutEvidence` (ขยายให้รับ `promptpay`), async events ที่มีอยู่; apply = term `termEndsAt = appendPackageInterval × months` จาก now, ลิมิต/เมนู/งบ AI ตาม snapshot, ใบเสร็จ = โควตาต่อเดือน (LEGACY_MONTH), `billingReceiptAccountId` **ไม่ตั้ง** (ไม่ใช่ subscription) → source แสดงเป็น `DEAL` (label ใหม่) ; re-enable บริษัทถ้า `termDisabledAt`
- R7 **ชำระด้วยโอน+สลิป**: ตาม special-invoice spec (endpoint สลิปใต้ `package-change-requests`, ตรวจไวรัส, แอดมิน verify ด้วยรหัสผ่าน → apply เดียวกับ R6); ไม่มีสิทธิ์ก่อน verify
- R8 **ไม่มีสิทธิ์ก่อนจ่าย** ทุกช่องทาง; การ์ดข้อเสนอเป็นแค่ข้อมูล; ร้านยังล็อกจน APPLIED
- R9 **Checkout ของดีลไม่ผูก BillingAccount/subscription เดิม**: สร้าง BillingAccount ถ้ายังไม่มี (customer Stripe เดิม/ใหม่), ไม่แตะ `baseSubscriptionId`; ร้านที่มี subscription catalog อยู่แล้วรับดีลไม่ได้ (`CONTROL_DEAL_SUBSCRIPTION_ACTIVE`) ต้องยกเลิกต่ออายุก่อน (เตือนเซลล์ตอนสร้าง)
- R10 **หน้าแพ็กเกจ**: การ์ดข้อเสนอเป็นการ์ดแรกก่อน catalog; catalog ยังเลือกได้; "แพ็กเกจปัจจุบัน" ของร้านล็อกแสดง "ยังไม่มีแพ็กเกจ · เลือกแพ็กเกจเพื่อเริ่มใช้งาน" ไม่ใช่ "ไม่จำกัด"; public catalog/BFF/marketing ไม่เปลี่ยน
- R11 **การมองเห็นเซลล์**: เห็นร้านผ่าน endpoint ใหม่ที่คืนแค่ ชื่อ/สถานะ/แพ็กเกจ/จังหวัด/วันที่สมัคร; ไม่ได้ `system.partner_dashboard.read` หรือ billing permission ใด; ดีลของคนอื่นเห็นเฉพาะหัวหน้า/Owner; ข้อมูลภาษีของเซลล์เห็นเฉพาะ SYSTEM_ADMIN
- R12 **ข้อมูลเซลล์สำหรับใบค่าจ้าง/50 ทวิ** (ตาราง `SalesAgentProfile`): ชื่อ-นามสกุลตามบัตร, เลขบัตรประชาชน/เลขผู้เสียภาษี (เข้ารหัสแบบ credential เดิม), ที่อยู่, ธนาคาร/เลขบัญชี, อัตราหัก ณ ที่จ่าย, สถานะ (ACTIVE/SUSPENDED), ทีม/หัวหน้า; ส่งออก CSV ให้บัญชี (SYSTEM_ADMIN)
- R13 **รายงานหัวหน้า**: ต่อเซลล์/ต่อทีม/ทั้งบริษัท: ดีลตามสถานะ, ยอดชำระที่ APPLIED (รายเดือน จาก BillingInvoice/สลิปที่ verify), จำนวนร้านที่เปิดใช้ (APPLIED ครั้งแรก), conversion (APPROVED→APPLIED), ค้างชำระ; ตัวเลขมาจาก server เท่านั้น
- R14 **LINE**: การ์ดล็อก + reply พนักงาน + ปิดช่องโหว่ 5 นาที ตาม free-usage plan §4.4; push ข้อเสนอถึง OWNER ไม่มีตัวเลข; ไม่มีราคาบน LINE

## 8. Boundary and Ownership

- **billing**: quote/checkout/evidence/apply ของดีล (source ใหม่ `DealSource` คู่กับ `RepeatSource`), PromptPay, label `DEAL`
- **external-signup**: แถว `PackageChangeRequest` + endpoint ลูกค้า (list/สลิป) — เดิม
- **system-partner-management**: ไม่เปลี่ยน (manual term/ต่ออายุ ยังเป็นเครื่องมือ Owner)
- **module ใหม่ `sales-console`** (apps/api): roles, `SalesAgentProfile`, deals CRUD/approve, company search, reports; ใช้ `create-employee`/`regenerate-employee-credential` ของ employee-access กับ platform tenant
- **auth**: permission ใหม่ + role ใหม่ใน registry; web gate `canOpenSales`
- **web**: พื้นที่ใหม่ `/sales/*` (layout + nav ของตัวเอง), admin console เพิ่ม "ทีมขาย", BillingPage เพิ่มการ์ดข้อเสนอ, locked shell
- **line-ai**: การ์ดล็อก/reply/window (ของเดิมในแผนสวิตช์)
- AI Gateway ไม่เกี่ยว; workers: scan รายวันปิดดีล EXPIRED และออกข้อเสนอต่ออายุ (reuse scan-worker pattern)

## 9. Data Model Draft (additive)

- `PackageChangeRequest`: เพิ่ม `kind` ('CUSTOMER_REQUEST'|'SALES_DEAL'|'SPECIAL_INVOICE'), `salesUserId?`, `approvedByUserId?`, `approvedAt?`, `offerExpiresAt?`, `rejectedReason?`, `version Int` (+ คอลัมน์สลิปจาก special-invoice spec) ; `paymentState` เพิ่มค่า `STRIPE_ONE_TIME`
- `SalesAgentProfile`: `userId` (unique), `teamLeadUserId?`, `legalName`, `nationalIdEncrypted`, `taxIdEncrypted?`, `address`, `bankName`, `bankAccountEncrypted`, `whtRatePercent`, `status`, `createdByUserId`, timestamps
- `BillingAttempt.quoteSnapshot` รองรับ `deal: { requestId, snapshotHash }`; `BillingInvoice` แถวของ Checkout ครั้งเดียว (มีอยู่จากซื้อซ้ำ) ; ไม่มีตาราง Stripe Price ใหม่
- roles/permissions ใน `permission-registry.ts`: `MANGMEE_SALES_LEAD`, `MANGMEE_SALES`; keys `sales.console.read`, `sales.company.search`, `sales.deal.create`, `sales.deal.approve`, `sales.team.manage`, `sales.report.read`, `sales.agent_profile.manage` (SYSTEM_ADMIN)

## 10. Permission and Audit

- Sales console ทั้งหมดผ่าน membership ใน platform tenant + permission ข้างต้น; ไม่มี company scope ของร้าน; ทุก endpoint ปฏิเสธถ้า role อยู่ในบริษัทอื่น
- Audit: `sales.agent.created/updated/suspended` (SYSTEM_ADMIN, PII เข้ารหัส ไม่ลง metadata), `sales.deal.created/submitted/approved/rejected/cancelled/expired/applied`, `billing.deal.checkout/apply` (CRITICAL), การเปิดดูข้อมูลภาษี (MEDIUM)
- Proof รหัสผ่านสำหรับ verify สลิป (แอดมิน) และอนุมัติดีลที่ราคาต่ำกว่าพื้น (ถ้า Owner ตั้ง — D2)

## 11. API Behavior (สรุป)

| Path | Role | ผล |
|---|---|---|
| `GET /v1/sales/companies?q=` | sales/lead | รายชื่อร้าน (ชื่อ, สถานะ, แพ็กเกจ, จังหวัด, สมัครเมื่อ, มีดีลค้างไหม) |
| `GET/POST /v1/sales/deals`, `PUT /:id` (DRAFT), `POST /:id/submit|approve|reject|cancel` | sales / lead | ตาม R4–R5; approve สร้างการ์ด + push OWNER + `offerExpiresAt` |
| `GET /v1/sales/reports/summary?from&to&teamLead=&sales=` | lead/admin | R13 |
| `GET/POST /v1/system/sales-agents`, `PATCH /:userId`, `POST /:userId/credential` | SYSTEM_ADMIN (+lead สำหรับสร้างเซลล์ในทีมด้วย `sales.team.manage` โดยไม่เห็นข้อมูลภาษี) | สร้าง user + membership platform tenant + role + profile; รหัสผ่านชั่วคราว |
| `GET /v1/companies/:id/package-change-requests` (เดิม) | OWNER | เพิ่ม `kind`, `deal` (ราคา, เดือน, สิทธิ์, หมดอายุ, description) |
| `POST /v1/companies/:id/billing/quote` (เดิม) body `{ dealId }` | OWNER | quote จากดีล; ต้องมีอีเมลยืนยัน (ขั้นในหน้า) และที่อยู่บริษัท (D4) |
| `POST /v1/companies/:id/billing/checkout` (เดิม) | OWNER | Checkout ครั้งเดียว บัตร+PromptPay |
| สลิป (เดิมจาก special-invoice) | OWNER/แอดมิน | R7 |

Error codes ใหม่ต้องมี Thai สองที่ (`api-error-message.ts` + `BillingPage.errorText`): `CONTROL_DEAL_SUBSCRIPTION_ACTIVE`, `SALES_DEAL_STATE_CONFLICT`, `SALES_DEAL_SELF_APPROVAL`, `SALES_DEAL_EXPIRED`, `SALES_COMPANY_NOT_FOUND`, `BILLING_DEAL_EXPIRED`

## 12. UI Behavior

### เว็บลูกค้า (locked shell + หน้าแพ็กเกจ)
- หลัง login ร้านที่ล็อก: nav 2 รายการ "ตั้งค่า" (hub แสดงเฉพาะการ์ด "ข้อมูลร้านและบัญชีของฉัน" + badge ยังกรอกไม่ครบ) และ "แพ็กเกจ"; รหัสผ่าน/อีเมล/LINE ในเมนูผู้ใช้; path อื่น → `/renew` ที่เขียนใหม่เป็น "ยังไม่มีแพ็กเกจ · เลือกแพ็กเกจเพื่อเริ่มใช้งาน" + ปุ่มไปหน้าแพ็กเกจ; API allowlist เพิ่ม identity/vat/business-type (free-usage plan S3)
- หน้าแพ็กเกจ: "แพ็กเกจปัจจุบัน: ยังไม่มีแพ็กเกจ" → "เลือกแพ็กเกจ" → [การ์ดข้อเสนอพิเศษ (ถ้ามี): ชื่อ tier ฐาน + "ข้อเสนอพิเศษสำหรับร้านคุณ", ราคา/รวม N เดือน, สาขา·ผู้ใช้·ใบต่อเดือน, เมนูที่ได้, ใช้ได้ถึง (3 วัน), ปุ่ม "เลือกข้อเสนอนี้"] + การ์ด catalog เดิม; หลังเลือก: ขั้นกรอกอีเมล/ที่อยู่ที่ยังขาด → สรุปยอด/VAT → ยืนยัน → Stripe (บัตร/PromptPay) → หน้า return เดิม → "ใช้งานแพ็กเกจแล้ว"; ทางเลือก "โอนเงินเข้าบัญชี" → ใบเรียกเก็บ + แนบสลิป
- 390px ไม่ล้น; error ผ่านสอง map; ไม่มีราคาบน LINE

### Sales console (`/sales`)
- Layout/nav ของตัวเอง (ไม่ใช่ `/system`): ดีล (รายการ+สร้าง), ร้านค้า (ค้นหา), รายงาน (lead), ทีม (lead: สร้างเซลล์/รีเซ็ตรหัส); mobile-first
- ฟอร์มดีล: ร้าน (search), tier ฐาน (เติมค่า), ราคา (บาท อิสระ), เดือน, สาขา/ผู้ใช้/ใบต่อเดือน, เมนู (preset + สวิตช์), งบ AI, โน้ตถึงลูกค้า (≤200), เหตุผลภายใน → บันทึก DRAFT → ส่งอนุมัติ; หน้าหัวหน้า: คิวรออนุมัติ + preview + อนุมัติ/ปฏิเสธ (เหตุผล)

### Admin console (`/system`)
- เมนูใหม่ "ทีมขาย": รายชื่อเซลล์/หัวหน้า, สร้าง/ระงับ/รีเซ็ตรหัส, ฟอร์มข้อมูลภาษี (เห็นเฉพาะ SYSTEM_ADMIN), ส่งออก CSV; ดีลทั้งหมด + ตรวจสลิป (จาก special-invoice)

## 13. Bug / Gap / Impact Register (รวมข้ามโมดูล)

ระดับ **H** ทำให้ requirement ไม่เป็นจริง/รั่ว/ทางตัน · **M** สับสน/หลุดกติกา · **L** ความสม่ำเสมอ

| ID | เรื่อง | หลักฐาน | แก้ใน |
|---|---|---|---|
| S01 | ไม่มี trial แต่ provisioning เขียน 30 วันคงที่ และ push "ทดลองฟรี 30 วัน"; copy ฟรีฝัง 6 จุด | `provision-signup.use-case.ts:557`, `line-signup-notify.service.ts:50`, `auth.controller.ts:533-604`, `signup.logic.ts:33-42`, `line-staff-menu.logic.ts:301`, `billing.service.ts:118` | P1 (H) |
| S02 | ร้านใหม่ term 0 วันต้อง `DISABLED` ทันที ไม่งั้น LINE ตอบได้ ≤5 นาที และ sweep ส่ง "ครบกำหนด" + แจ้ง SYSTEM_ADMIN ทุกร้าน | `plan-term-sweep.use-case.ts:60-100` | P1 (H) |
| S03 | locked shell: ตั้งค่าบริษัทถูกบล็อก (API allowlist ไม่มี identity/vat/business-type; เว็บ redirect), ไม่มี nav, copy "ครบกำหนด" ผิดสำหรับร้านใหม่ | `auth.guard.ts:55-79`, `PlanTermBanner.tsx:30-34`, `CompanyTermExpiredPage.tsx` | P1 (H) |
| S04 | หน้าแพ็กเกจของร้านไม่มี term แสดง "ใบเสร็จคงเหลือ ไม่จำกัด" (จริง = ไม่มีแพ็กเกจ) | ภาพหน้าจอ / `BillingPage.tsx` แพ็กเกจปัจจุบัน | P3 (M) |
| S05 | LINE: พนักงานร้านล็อกได้ "กรุณาเชื่อมต่อบัญชี", OWNER ได้ปุ่ม "ขอเปลี่ยนแพ็กเกจ" ไม่ใช่ลิงก์หน้าแพ็กเกจ, ช่องโหว่ 5 นาที, LIFF start copy บอกให้พิมพ์คำสั่ง | `process-line-webhook.use-case.ts:1336,1803-1815,3324`, `liff-page.security.ts:174` | P1 (M) |
| S06 | ชื่อ role `SALES` มีอยู่แล้ว (role ในบริษัทลูกค้า) → ต้องใช้ `MANGMEE_SALES*` และ UI ต้องไม่ปนคำ | `permission-registry.ts:707` | P2 (H) |
| S07 | web gate `/system` = SYSTEM_ADMIN หรือ billing.read เท่านั้น; ไม่มีพื้นที่สำหรับ role แพลตฟอร์มอื่น → ต้องมี `/sales` layout + `canOpenSales` และ landing ตาม role | `apps/web/app/system/layout.tsx:25`, `session-gate.logic.ts:25-33,144` | P2 (H) |
| S08 | platform tenant มี employee limit? ถ้ามี term row จะบล็อกสร้างเซลล์ (`employeeLimit`) → ต้องยืนยันว่า platform tenant ไม่มี term row/ยกเว้น | `create-employee.use-case.ts:545`, P29 §4D | P2 (M) |
| S09 | สร้างผู้ใช้ผ่าน create-employee ต้องกรอกวันเกิด/ฟิลด์พนักงาน และผูกกับ jobTitle/HR ของบริษัท → ต้อง wrapper ที่ใส่ค่าที่จำเป็นและไม่โชว์ใน HR ของ platform tenant | `CreateEmployeeCommand` (`create-employee.use-case.ts:24-40`) | P2 (M) |
| S10 | ข้อมูลภาษีเซลล์ = PII อ่อนไหว (เลขบัตร, บัญชีธนาคาร) ต้องเข้ารหัสแบบ `encryptCredential` และห้ามลง audit metadata/ export ต้องมีสิทธิ์เฉพาะ | `regenerate-employee-credential.use-case.ts:61` (แบบเข้ารหัส) | P2 (H) |
| S11 | Checkout ครั้งเดียวของเดิมผูกกับ subscription (`RepeatSource` ต้องมี `baseSubscriptionId`) → ต้องมี `DealSource` แยกสำหรับร้านที่ไม่มี subscription; evidence ครั้งเดียวรับเฉพาะบัตร | `billing-repeat.ts:23,37-51`, `paid-checkout-invoice.ts:57` | P3 (H) |
| S12 | PromptPay: Checkout ส่ง `['card']` ทั้งสองแบบ; ต้องเปิดใน Stripe account; เพดานยอดต่อรายการของ PromptPay; ใบเสร็จ Stripe สำหรับ PromptPay | `billing.service.ts:415`, `billing-repeat.ts:269` | P3 (M) |
| S13 | apply ดีล = term ตามเดือน + ลิมิต + เมนู + งบ AI + โควตารายเดือน — ต้องเป็นธุรกรรมเดียว + follow-up idempotent (เมนู/งบ AI) ตามแบบ special-invoice; source label ใหม่ `DEAL` ใน `billing-admin.service.ts:102` และ `BillingCompanyOverview.tsx:30` | special-invoice spec R6 | P3 (H) |
| S14 | ร้านที่มี subscription catalog แล้วรับดีลไม่ได้ (`assertNoDebt`/repeat/upgrade เดิม) → ต้อง block ตอนสร้างดีลและตอน quote | `billing-repeat.ts:132-144` | P2/P3 (M) |
| S15 | ร้าน manual/ดีลเดิมติด `BILLING_LEGACY_REVIEW_REQUIRED` เมื่อจะซื้อ catalog ทีหลัง → ผ่อนเมื่อมีดีล APPLIED มาก่อน (ทีมงานตรวจแล้ว) | `billing.service.ts:228-230` | P3 (M) |
| S16 | อีเมลยืนยันเป็นเงื่อนไขก่อน Checkout (`verifiedAccountEmailProof`) ร้าน LINE-first ไม่มีอีเมล → ขั้นยืนยันอีเมลต้องอยู่ในหน้าแพ็กเกจ (มีแล้วบางส่วน) หรือผ่อน (D4) | `billing.service.ts:223` | P3 (H) |
| S17 | ดีลหมดอายุ 3 วัน: ไม่มี scan → derive ตอนอ่าน + scan รายวันปิดแถว (reuse scan-worker); การ์ดต้องหายทันทีเมื่อ derive EXPIRED | — | P2 (M) |
| S18 | one-OPEN-per-company index: ดีล PENDING ชนกับคำขอเปลี่ยนแพ็กเกจของลูกค้า/ใบพิเศษ → กติกาแปลง/ปฏิเสธ | migration `20260904120000_line_first_signup` | P2 (M) |
| S19 | LINE push งบ/กติกา: push ข้อเสนอถึง OWNER ต้องไม่มีตัวเลขและใช้ `ownerLineUserIds`; lane billing ไม่กัน group | `package-change-decision.use-case.ts:163-200`, `process-line-webhook.use-case.ts:2404-2412` | P2 (L) |
| S20 | `billing` ไม่อยู่ใน LAUNCH_MODULES; BillingPage มี map เอง; catalog public + marketing regex ไม่รู้จักฟิลด์ใหม่ | `api-error-coverage.spec.ts:22-25`, `BillingPage.tsx:20-46`, `billing-marketing-smoke.ts:34` | P3 (M) |
| S21 | รายงาน "ยอดขาย": ยอดจาก BillingInvoice (Stripe) + ดีลสลิป verify ต้องรวมเป็นแหล่งเดียว และห้ามให้เซลล์เห็นเอกสารการเงินของร้าน | `billing-timeline.ts`, `financial.read` gate | P4 (M) |
| S22 | e2e `billing-preview.spec.ts` ตรึงข้อความประหยัด ฿498; fixture ดีลต้องแยก | `e2e/billing-preview.spec.ts` | P3 (L) |
| S23 | ร้านที่ทดลองอยู่: ห้าม provisioning/ scan ใหม่ไปแตะ term ที่มี (`update: {}` เดิมคงไว้) | `provision-signup.use-case.ts:463-470` | P1 test (H) |
| S24 | reason/โน้ตของดีลอ่านได้ทั้งทีม → ห้ามใส่ PII ลูกค้า; โน้ตถึงลูกค้า ≤200 ไม่มี "+" | SEC-05 | P2 (L) |
| S25 | คู่มือ/support playbook สำหรับเซลล์ + Owner (สร้างบัญชี, รีเซ็ตรหัส, ดีลค้าง) | docs/runbooks | P4 (L) |

## 14. Acceptance Criteria

- AC1 สมัครใหม่ (LINE และเว็บ) → ร้าน DISABLED ทันที, LINE ตอบการ์ดเดียวไม่มี model/OCR, เว็บเห็น 2 เมนู, แก้ข้อมูลบริษัทได้, ร้านทดลองเดิมไม่เปลี่ยน
- AC2 เซลล์สร้างดีล → หัวหน้าอนุมัติ → การ์ดขึ้นเฉพาะร้านนั้น (ร้านอื่น/public/LINE ไม่มีราคา) → ลูกค้าจ่ายบัตรและ PromptPay (Stripe test) → APPLIED + สิทธิ์ตามดีลครบ (term เดือน, ลิมิต, เมนู, งบ AI) → LINE/เว็บใช้ได้; เกิน 3 วัน → EXPIRED
- AC3 โอน+สลิป → แอดมิน verify → APPLIED; สลิปไม่ผ่าน → ยังล็อก
- AC4 Sales console: role/permission ถูกต้อง (เซลล์เห็นเฉพาะของตัวเอง, หัวหน้าเห็นทุกทีม, self-approve ปฏิเสธ, ไม่เห็นข้อมูลธุรกิจร้าน, `/system` เข้าไม่ได้), รหัสผ่านชั่วคราวบังคับเปลี่ยน, PII เข้ารหัสและ export ได้เฉพาะ Owner
- AC5 รายงานหัวหน้าตรงกับข้อมูลจริง (ดีล/ยอด/ร้านเปิดใช้/ค้างชำระ) ในช่วงเวลา
- AC6 ไม่มี diff ในไฟล์ตรวจหลักฐาน subscription (`paid-invoice.ts`) ; evidence ครั้งเดียวขยายเฉพาะ promptpay
- AC7 390px ทุกหน้า; error Thai ทั้งสอง map; ไม่มี raw error

## 15. Test Cases (สรุป; รายละเอียดในแผน)

unit (สถานะดีล, snapshot, quoteTotals, ladder-less validation, lockReason) · PG (provision 0 วัน + DISABLED, ดีล state machine + unique OPEN, apply atomic + replay, permission/role) · HTTP smoke ใหม่ `billing-deal-smoke.ts` (simulated Stripe: card + promptpay async) · regression smokes เดิม · webhook LINE spec · E2E (signup → locked → deal → pay → unlocked; sales console 390) · Stripe test mode จริงบน UAT (บัตร + PromptPay)

## 16. Open Questions (Owner)

| ID | คำถาม | ข้อเสนอ |
|---|---|---|
| D1 | ราคาพื้นสำหรับ "เตือน" (ไม่ห้าม) มีไหม | ไม่มีในรอบแรก; เตือนเฉพาะสูงกว่า catalog |
| D2 | หัวหน้าเซลล์อนุมัติดีลของตัวเองได้ไหม | ไม่ได้ (Owner อนุมัติแทน) |
| D3 | ข้อเสนอต่ออายุอัตโนมัติ 14 วันก่อนหมด เงื่อนไขเดิม ต้องให้หัวหน้าอนุมัติซ้ำไหม | ไม่ต้อง (เงื่อนไขเดิมที่เคยอนุมัติ) |
| D4 | ก่อนจ่ายบังคับกรอกที่อยู่บริษัท + อีเมลยืนยันในหน้าแพ็กเกจ ใช่ไหม | ใช่ (ที่อยู่เพื่อเอกสาร, อีเมลเพื่อใบเสร็จ Stripe) |
| D5 | ร้านที่มี subscription catalog อยู่แล้ว รับดีลไม่ได้ (ต้องยกเลิกต่ออายุก่อน) ยอมรับไหม | ใช่ในรอบแรก |

## 17. มติ Owner รอบ 2 (2026-09-20) และผลต่อกติกา

| ID | มติ | ผลต่อ spec |
|---|---|---|
| D1 | ไม่มีราคาพื้น | เตือนเฉพาะราคาสูงกว่า catalog (R3 คงเดิม) |
| D2 | หัวหน้าเซลล์อนุมัติดีลของตัวเองได้ | R5 แก้: ผู้สร้างที่เป็น `MANGMEE_SALES_LEAD`/SYSTEM_ADMIN อนุมัติเองได้; เซลล์ธรรมดาอนุมัติไม่ได้; audit ระบุ `selfApproved: true` |
| D3 | ข้อเสนอต่ออายุต้องอนุมัติซ้ำ **และมีแจ้งเตือน** | J4/R4 แก้: 14 วันก่อนหมด ระบบสร้างดีลรอบถัดไปสถานะ PENDING_APPROVAL ผูกกับเซลล์เจ้าของดีล → แจ้งเตือนเซลล์ + หัวหน้า (เว็บ + LINE ถ้าผูก + สรุปรายวัน) → อนุมัติแล้วการ์ดถึงลูกค้า; ถ้าไม่มีใครอนุมัติภายใน 7 วันก่อนหมด เตือนซ้ำและแจ้ง Owner; ร้านล็อกตาม P29 เมื่อหมดรอบโดยไม่จ่าย |
| D4 | บังคับที่อยู่บริษัท + อีเมลยืนยันก่อนจ่าย | R6/UI คงตามร่าง (ขั้นกรอกในหน้าแพ็กเกจ) |
| D5 | ร้านที่มี subscription catalog **รับดีลได้ โดยจ่ายเพิ่มตามส่วนต่าง** | R9/S14 แก้: ดีลบนร้านที่มี subscription = "แปลงเป็นดีล": ยอดที่ต้องจ่ายวันนี้ = ราคาดีล − มูลค่าคงเหลือของรอบที่จ่ายแล้ว (คิดสัดส่วนวันด้วย `proratedPackagePrice` ที่ upgrade ใช้ [billing-package.ts](../../apps/api/src/modules/billing/domain/billing-package.ts)) ไม่ต่ำกว่า 0 → Checkout ครั้งเดียว (บัตร/PromptPay) → apply ดีลทันที (term ใหม่นับจากวันจ่าย) → ระบบสั่ง CANCEL_RENEWAL ให้ subscription เดิมสิ้นสุด ณ สิ้นรอบโดยไม่เก็บเงินอีก (system-initiated, ใช้ op เดิม) → ปุ่ม "ต่ออายุอีกครั้ง" ใน Portal ถูกปิดขณะดีล ACTIVE; quote ต้องแสดง "จ่ายวันนี้ / มูลค่าที่นำมาหัก / วันเริ่มดีล"; เงื่อนไข: subscription ต้อง `active` ไม่มีรายการค้าง (`assertNoDebt`) ไม่มี grace/ค้างชำระ ไม่งั้นปฏิเสธ `CONTROL_DEAL_SUBSCRIPTION_REVIEW` |

**รายงานและการนับยอด (มติ Owner):**
- หัวหน้าเซลล์เห็นเฉพาะยอดที่เกิดจากดีลของเซลล์ (ทุกทีม) **ไม่นับ** ยอดจากช่องทางอื่น (ลูกค้าซื้อ catalog เองบนเว็บ/LINE); เซลล์เห็นเฉพาะยอดของตัวเอง สะสมรายเดือน; ไม่มีใครในทีมขายเห็นเอกสารการเงินของร้าน (S21 = ไม่เห็น)
- **การระบุที่มาของยอด (attribution)**: ทุกดีลมี `salesUserId` → ยอดที่จ่ายผ่านดีล (ครั้งแรกและรอบต่ออายุที่สืบทอดจากดีลเดิม) นับให้เซลล์คนนั้นอัตโนมัติ; ยอดที่ไม่ผ่านดีลไม่นับให้ใคร; ถ้าเซลล์ถูกระงับ/ย้ายทีม ดีลเดิมยังนับให้เจ้าของเดิม (ประวัติไม่เปลี่ยน) เว้นแต่ Owner โอนดีลด้วยเหตุผล (audit)
- "ยอดเปิดบริษัท" ของเซลล์ = จำนวนร้านที่ APPLIED ดีลของเซลล์คนนั้นเป็นครั้งแรก (นับร้านละ 1)
- S15 (ร้านที่เคยรับดีลซื้อ catalog เองได้เลย): ใช้ตามข้อเสนอ = ได้ (ยอดนั้นไม่นับให้เซลล์)

| ID | คำถามค้าง | ข้อเสนอ |
|---|---|---|
| D6 | ต้องการนับยอดให้เซลล์ในกรณีที่ลูกค้าสมัครและซื้อ catalog เองหลังเซลล์ไปเสนอไหม (ต้องมี "รหัส/ลิงก์แนะนำของเซลล์" ตอนสมัคร หรือช่อง "รู้จักเราจากเซลล์" ที่มีอยู่แล้วในฟอร์มสมัคร) | รอบแรก **ไม่นับ** (นับเฉพาะดีล ตรงมติ); ถ้าต้องการ ทำเป็นเฟสถัดไปด้วยลิงก์แนะนำ `?ref=<รหัสเซลล์>` ที่ผูกร้านกับเซลล์ตอนสมัคร และนับยอดของร้านนั้น N เดือน |

### 17.1 D6 ตัดสินแล้ว (Owner 2026-09-20): นับยอดจาก "รู้จักเราทางไหน" ด้วย ทำในรอบแรกพร้อมตัวกันโกง

มติ: ยอดจากดีล = ของเซลล์ผู้สร้างดีล; ยอด subscription ที่ลูกค้าซื้อเอง = นับให้เซลล์ที่ลูกค้าระบุในช่อง "รู้จักเราทางไหน" ตอนสมัคร **ภายใน 14 วันนับจากวันเปิดร้าน (Owner แก้จาก 1 เดือน)**; เซลล์ไม่ทับพื้นที่กัน (ไม่มีกติกา first/last touch); ต้องมีตัวกันโกงตั้งแต่แรก

**กติกา**
- ฟอร์มสมัคร (LIFF + เว็บ) เพิ่ม option `SALES` "เซลล์ของมั่งมี" ใน `SIGNUP_DISCOVERY_SOURCE_OPTIONS` ([external-signup.ts:5-11](../../packages/contracts/src/external-signup.ts)) พร้อมช่อง **รหัสเซลล์แบบง่าย** (ตั้งเองได้ 3–6 ตัว ตัวพิมพ์ใหญ่/ตัวเลข ไม่ซ้ำ เช่น ชื่อเล่น "TON"; ค่าเริ่มต้นระบบสุ่ม 4 ตัวโดยไม่ใช้ตัวที่สับสน 0/O 1/I; ออกให้ทุกบัญชีเซลล์ตอนสร้าง; ลิงก์ `?ref=<รหัส>` เติมให้อัตโนมัติ); server แปลงรหัสเป็น `referralSalesUserId` ตอน submit; รหัสผิด/ไม่ ACTIVE → เก็บข้อความดิบไว้ให้แอดมินดู ไม่นับ
- ตอน provisioning คัดลอกไป `Company.referralSalesUserId` + `referredAt` (= เวลา provision) + `referralSource` ('SIGNUP_CODE'|'SIGNUP_LINK'|'ADMIN'); แก้ได้เฉพาะ SYSTEM_ADMIN พร้อมเหตุผล (audit) ภายใน 14 วันแรก
- **สูตรนับ**: ยอดที่จ่ายและ APPLIED ผ่านดีล → `deal.salesUserId` เสมอ (ดีลชนะ) ; ยอดที่ไม่ผ่านดีล → นับให้ `referralSalesUserId` เมื่อ `paidAt <= referredAt + 14 วัน` ; หลังจากนั้นไม่นับให้ใคร (รวมรอบต่ออายุ) ; คืนเงิน/dispute ภายใน 60 วัน หักออกจากยอดเดือนที่คืน
- "ยอดเปิดบริษัท" = ร้านที่ APPLIED ครั้งแรกภายในหน้าต่างของเซลล์ (ดีลหรือแนะนำ) นับร้านละ 1

**ตัวกันโกง (บังคับในรอบแรก)**
- รหัสเซลล์ผูกกับบัญชีเซลล์ ACTIVE เท่านั้น; ระงับเซลล์ = รหัสหยุดรับ (ร้านเก่ายังนับตามหน้าต่างเดิม)
- ร้านที่ OWNER มี identity เดียวกับเซลล์ (LINE userId, อีเมล, เบอร์) หรือเซลล์คนใดในทีม → ไม่นับ + ธง `self_referral` ให้ Owner ตรวจ
- เจ้าของคนเดียวกันเปิดหลายร้าน (ตรรกะ repeat-shop ที่มีอยู่) → นับเฉพาะร้านแรก
- ระบุรหัสได้เฉพาะตอนสมัคร (หรือ Owner ใส่ให้ภายใน 30 วันพร้อมเหตุผล) ห้ามเซลล์ใส่ย้อนหลัง
- นับเฉพาะเงินที่ Stripe/สลิปยืนยันแล้วเท่านั้น ไม่นับข้อเสนอที่ยังไม่จ่าย
- ความผิดปกติ: รหัสเดียวถูกใช้เกิน 20 ร้าน/วัน หรือร้านแนะนำหลายร้านใช้ LINE/เบอร์/IP เดียวกัน → ธง `referral_anomaly` + สรุปให้ Owner ทุกเช้า; รายงานแยกคอลัมน์ "ดีล" กับ "แนะนำ" และเก็บหลักฐานที่มาทุกแถว
- คิวสมัครโชว์ "รู้จักเราจากเซลล์: <ชื่อ>" ให้แอดมินเห็นตอนอนุมัติ/ตรวจสอบ

มติ Owner (รอบ 3): หน้าต่างนับ 14 วันนับจากเวลาเปิดร้าน; เกณฑ์ผิดปกติ 20 ร้าน/วัน; รหัสเซลล์ต้องง่าย (ตั้งเองได้)

**ช่องทาง "สรุปให้ Owner ทุกเช้า" (รอ Owner เลือก):** ระบบมีอยู่แล้ว 3 ช่อง — (ก) การแจ้งเตือนในคอนโซล + badge บนเมนู "ทีมขาย" (แน่นอนที่สุด ใช้กลไก dashboard-notifications ของ SYSTEM_ADMIN แบบเดียวกับคำขอสมัคร) (ข) LINE push ถึงบัญชีของ Owner ที่ผูก LINE กับบัญชี SYSTEM_ADMIN (ต้องผูกก่อน; วันนี้ยังไม่มี SYSTEM_ADMIN ที่ผูก LINE) (ค) อีเมลผ่าน Postmark ถึงกล่องที่กำหนด (ใช้ transport เดิมของอีเมล billing/สมัคร) — ข้อเสนอ: (ก) + (ข) ทุกวัน 07:00 ตามเวลาไทยด้วย cron เดิมของสรุปรายวัน (`daily_owner_summary` 07:00 Asia/Bangkok) โดยเพิ่ม trigger `sales_daily_digest`; (ค) เป็นทางเลือก

### 17.2 มติรอบ 4 (Owner 2026-09-20) — นับยอดเฉพาะ "เปิดครั้งแรก" และสรุปรายวันในคอนโซลเท่านั้น

- **ยอดของทีมขายนับเฉพาะการชำระครั้งแรกที่ทำให้ร้านเปิดใช้งาน** (ต่อร้าน 1 ครั้งตลอดอายุร้าน): เปิดด้วยแพ็กเกจรายเดือน = นับยอด 1 เดือน, รายปี = นับยอด 1 ปี, ดีลพิเศษ = นับยอดของดีลตามเดือนที่ดีลระบุ; **รอบต่ออายุทุกชนิดไม่นับ** (subscription ต่อรายเดือน/รายปี, ดีลรอบถัดไป, อัปเกรด) → สูตรใน §17.1 แก้เป็น: `first paid activation` ของร้าน → ถ้าเป็นดีล นับให้ `deal.salesUserId`; ถ้าไม่ใช่ดีลและ `paidAt <= referredAt + 14 วัน` นับให้ `referralSalesUserId`; อย่างอื่นไม่นับ; คืนเงินภายใน 60 วันหักออก; "ยอดเปิดบริษัท" = จำนวนร้านที่นับได้
- ผลต่อการออกแบบ: รายงานเซลล์/หัวหน้าไม่ต้องติดตาม renewal เลย ตาราง attribution เก็บแค่ 1 แถวต่อร้าน (`companyId`, `salesUserId`, `source: DEAL|REFERRAL`, `amountSatang`, `interval|months`, `paidAt`, `refundedSatang`) เขียนครั้งเดียวตอน APPLIED ครั้งแรก, immutable ยกเว้น refund/โอนโดย Owner (audit)
- ดีลรอบถัดไป (D3) ยังต้องอนุมัติ+แจ้งเตือน แต่ **ไม่สร้างยอดให้เซลล์**; เซลล์ยังเห็นสถานะร้านของตน
- **สรุปรายวันถึง Owner = การแจ้งเตือนในคอนโซลอย่างเดียว** (badge บนเมนู "ทีมขาย" + กระดิ่ง SYSTEM_ADMIN ผ่าน dashboard-notifications, trigger `sales_daily_digest` บน cron 07:00 เดิม); ไม่ส่ง LINE/อีเมล

### 17.3 มติรอบ 5 (Owner 2026-09-20): ดีลตัดบัตรอัตโนมัติได้ โดยอนุมัติครั้งเดียวตอนสร้าง (D7 = ก)

- ฟอร์มดีลเพิ่มสวิตช์ **"ต่ออายุอัตโนมัติ (ตัดบัตรทุกรอบ)"**; หัวหน้าอนุมัติดีลครั้งเดียว = อนุมัติการตัดบัตรทุกรอบของดีลนั้น; **D3 (อนุมัติซ้ำ + แจ้งเตือน) ใช้เฉพาะดีลแบบจ่ายครั้งเดียว**
- ดีลแบบตัดอัตโนมัติจำกัดรอบเป็น **รายเดือนหรือรายปี** เท่านั้น (ข้อจำกัด Stripe recurring); ดีลแบบจ่ายครั้งเดียวยังกำหนดจำนวนเดือนอิสระได้
- กลไก = spec ที่พักไว้ [billing-special-price-spec-th.md](billing-special-price-spec-th.md): ตอนอนุมัติ ระบบสร้าง **Stripe Price เฉพาะร้าน** (product ของ tier ฐาน, `unit_amount` = ราคาดีล, recurring ตามรอบ, `tax_behavior` ตามนโยบาย, idempotent) → ลูกค้ากดการ์ดข้อเสนอ → Checkout แบบ subscription เดิม (`assertStripePrice` เทียบกับ offer ของดีล) → webhook/reconciler เดิม apply term/ใบเสร็จตาม snapshot (ลิมิตพิเศษไหลไปเอง) → **ต่ออายุอัตโนมัติที่ราคาดีล** พร้อม grace/retry/Portal/ใบเสร็จของ Stripe ทั้งชุด โดยไม่แตะโค้ดตรวจหลักฐาน (ทะเบียน G10–G33 ในสเปกนั้นยังใช้)
- ระยะเวลาดีลแบบอัตโนมัติ: เซลล์เลือก "จนกว่าจะเพิกถอน" หรือ "N รอบแล้วกลับราคาปกติ"; การจบดีลบน subscription ที่ใช้อยู่ = op `SCHEDULE_PRICE_RETURN` (schedule เฟสถัดไปเป็น Price catalog ของ tier เดิม) พร้อม issue เตือน 14 วันก่อน; เพิกถอนก่อนใช้ = ปิด Price
- ลูกค้าต้องมีบัตร (PromptPay ตัดอัตโนมัติไม่ได้) → การ์ดข้อเสนอแบบอัตโนมัติแสดงเฉพาะ "จ่ายด้วยบัตร"; แปลง subscription เดิม (D5) ทำได้ทั้งสองแบบ: อัตโนมัติ = เปลี่ยน Price ในรอบถัดไปผ่าน schedule + ส่วนต่างรอบปัจจุบันจ่ายครั้งเดียว
- การนับยอดทีมขายไม่เปลี่ยน: นับเฉพาะการชำระครั้งแรก
- ลำดับงาน: Phase 5 ต่อจากดีลแบบจ่ายครั้งเดียว (Phase 3) เพราะใช้ฟอร์ม/การ์ด/อนุมัติชุดเดียวกัน ต่างกันที่ช่องทางเก็บเงิน

## 18. ตรวจ gap รอบสุดท้ายหลัง D1–D7 (2026-09-20) — S26–S33 และคำถาม Q1–Q6

| ID | เรื่อง | ผลกระทบ | ข้อเสนอ |
|---|---|---|---|
| S26 | ดีลอัตโนมัติจบแล้ว "กลับราคาปกติ" tier เดิม: term/ใบเสร็จกลับตาม catalog ผ่าน schedule แต่ **เมนู/งบ AI ที่ดีลเปิดไว้ไม่มีใครย้อน** (ไม่ได้อยู่ใน offer) | ลูกค้าจ่ายราคาปกติแต่ยังได้สิทธิ์พิเศษ | Q1 |
| S27 | ราคาในฟอร์มดีล: เซลล์คิดเป็น "ราคาที่ลูกค้าจ่าย" แต่ระบบต้องรู้ว่ารวม VAT หรือยัง (`quoteTotals` ตามนโยบาย INCLUSIVE/EXCLUSIVE) | ยอดผิด 7% | Q2: กรอกยอดที่ลูกค้าจ่ายจริง ระบบแยก VAT ให้ |
| S28 | รหัสผ่านชั่วคราวของเซลล์: flow เดิมส่งทาง LINE เมื่อผูกแล้ว; เซลล์ใหม่ยังไม่ผูก LINE | สร้างบัญชีแล้วส่งรหัสไม่ถึง | Q3: แสดงบนจอผู้สร้างครั้งเดียว + LINE ถ้าผูก |
| S29 | เซลล์เป็นสมาชิก platform tenant → company switcher/หน้า workspace ของ tenant นั้นจะเปิดได้ถ้า role มี permission ธุรกิจ | เซลล์เห็นข้อมูล platform tenant | role ใหม่มีแค่ `account.*` + `sales.*`; landing ของ role = `/sales`; workspace ของ platform tenant ปฏิเสธ role นี้ |
| S30 | แจ้งเตือนถึงเซลล์/หัวหน้า (D3 ดีลจ่ายครั้งเดียว, ดีลถูกปฏิเสธ, ใกล้หมด) ต้องมีที่แสดงใน `/sales` | แจ้งแล้วไม่มีใครเห็น | Q6: หน้า "งานของฉัน" + badge แทนกระดิ่ง; ลงทะเบียน trigger keys |
| S31 | ดีลลดลิมิตต่ำกว่าที่ร้านใช้อยู่ (เช่น 3 สาขา → 2) | ห้ามสร้างเพิ่ม ของเดิมคงอยู่ (P29 §4D) | preview ดีลต้องแสดงจำนวนเกินให้เซลล์เห็น |
| S32 | ร้านที่ยังอยู่ในช่วงทดลอง (ของเดิม) รับดีลได้ไหม | ถ้าได้ ดีลเริ่มทันทีเมื่อจ่าย แทน trial ที่เหลือ | Q5 |
| S33 | ค้นหาร้านของเซลล์คืนทุกร้านในระบบ (ชื่อ/สถานะ/จังหวัด) | เห็นชื่อร้านลูกค้าทั้งระบบ | Q4: อนุญาต แต่ฟิลด์น้อยและบันทึกการค้นหา (audit LOW) |

| ID | คำถาม | ข้อเสนอ |
|---|---|---|
| Q1 | ดีลอัตโนมัติจบ/กลับราคาปกติ → เมนู/งบ AI/ลิมิต กลับเป็นค่าเริ่มต้นของ tier หรือคงของดีล | กลับเป็นค่าเริ่มต้นของ tier (เซลล์ออกดีลใหม่ถ้าจะให้ต่อ) |
| Q2 | ราคาที่เซลล์กรอก = ยอดที่ลูกค้าจ่ายจริง (รวม VAT ถ้ามี) ใช่ไหม | ใช่ ระบบแสดงส่วน VAT ให้อัตโนมัติ |
| Q3 | รหัสผ่านชั่วคราวของเซลล์ส่งทางไหน | โชว์บนจอผู้สร้างครั้งเดียว (คัดลอก) + LINE ถ้าผูก |
| Q4 | เซลล์ค้นหาร้านได้ทุกร้านในระบบไหม | ได้ เฉพาะชื่อ/สถานะ/แพ็กเกจ/จังหวัด บันทึกการค้นหา |
| Q5 | ร้านที่ยังทดลองอยู่ รับดีลได้ไหม | ได้ จ่ายแล้วดีลเริ่มทันทีแทนวันทดลองที่เหลือ |
| Q6 | แจ้งเตือนในคอนโซลเซลล์เป็นหน้า "งานของฉัน" + badge พอไหม | พอ |

**มติ Owner ต่อ Q1–Q6 (2026-09-20):** Q1 ดีลอัตโนมัติจบ/กลับราคาปกติ → เมนู/งบ AI/ลิมิตกลับเป็นค่าเริ่มต้นของ tier (ระบบทำใน RETURN op เดียวกัน, audit) · Q2 ยังไม่จด VAT → ราคาที่เซลล์กรอก = ยอดที่ลูกค้าจ่ายจริง ไม่มีการแยก VAT ในตอนนี้; เมื่อจด VAT ภายหลัง นโยบาย billing เปลี่ยน taxTreatment แล้วระบบแยก VAT ให้เองตาม `quoteTotals` โดยฟอร์มดีลต้องแสดงชัดว่ายอดเป็น "รวม VAT" (ฟิลด์เดียว ไม่ต้องเปลี่ยน schema) · Q3 รหัสผ่านชั่วคราวแสดงบนจอผู้สร้างครั้งเดียว + ส่ง LINE ถ้าผูก · Q4 เซลล์ค้นหาได้ทุกร้าน ฟิลด์น้อย บันทึกการค้นหา (audit LOW) · Q5 ร้านที่ยังทดลองอยู่รับดีลได้ ดีลเริ่มทันทีเมื่อจ่าย (วันทดลองที่เหลือไม่ทบ — เตือนใน quote) · Q6 หน้า "งานของฉัน" + badge ในคอนโซลเซลล์ พอ
