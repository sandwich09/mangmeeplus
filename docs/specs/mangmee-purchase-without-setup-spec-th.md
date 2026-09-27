# Feature: ซื้อแพ็กเกจได้ทันทีหลังสมัคร (ไม่ต้องตั้งค่าก่อนซื้อ) — สถานะยังไม่มีแพ็กเกจ, ลิงก์จาก LINE, แก้ไขเอกสารด้วยตัวเอง, เครื่องมือแอดมิน — Spec

## 1. Status

- วันที่: 2026-09-26 · แก้ไข 2026-09-27 (ผลตรวจโค้ดจริง §18) · สถานะ: **DRAFT v0.2 — มติ Owner D-PF-1..10 ครบ; §18.2 มีผลเหนือ §7/§9/§11 ที่ขัดกัน; รอ Owner ตอบ DQ1–DQ7 (§18.4, มีค่าเริ่มต้น) แล้วเริ่ม Phase 1** · ผู้เขียน: Claude (controller)
- ฐานโค้ด: `origin/develop` ddcdcadf (billing/LINE/LIFF เท่ากับ production ที่ serve `a2b926c6` ณ 2026-09-26) · แผน: [mangmee-purchase-without-setup-plan-th.md](../plans/mangmee-purchase-without-setup-plan-th.md) · memory: [purchase-without-setup-2026-09-26.md](../agent-memory/purchase-without-setup-2026-09-26.md)
- ที่มา: ผู้ทดลองใช้จริง (2026-09-26) เข้าจากการ์ดในแชต LINE แล้ว "กดเลือกแพ็กเกจไม่ได้เลย" และร้านที่สมัครใหม่ถูกโชว์เป็นทดลองใช้ที่หมดอายุจน Owner ต้องกดต่ออายุในคอนโซลให้ทุกร้าน; วิเคราะห์เส้นทางทั้งชุดจากโค้ดและหน้าเว็บจริงแล้ว (สรุปใน memory)

### 1.1 มติ Owner (2026-09-26)

| ID | มติ | ผล |
|---|---|---|
| D-PF-1 | ให้หน้า Checkout ของ Stripe เก็บอีเมลและที่อยู่ออกเอกสารแทนการยืนยันในแอป แล้วระบบคัดลอกกลับหลังจ่ายสำเร็จ | **ทับ** เงื่อนไข "ที่อยู่ก่อนซื้อ" ([billing-company-profile-gate-spec-th.md](billing-company-profile-gate-spec-th.md), 2026-09-17) และ D4 "อีเมลยืนยันก่อนจ่าย" ([sales-deals spec §16/§17](mangmee-sales-deals-and-locked-signup-spec-th.md)) สำหรับการซื้อทุกแบบ |
| D-PF-2 | ลิงก์จาก LINE **ทุกลิงก์** ที่เข้าเว็บแอปเปิดใน Safari/Chrome (นอกเบราว์เซอร์ของ LINE) | หน้า LIFF ของ LINE เอง (สมัคร, เชื่อม LINE, เปิดหน้าเว็บ) คงอยู่ใน LINE |
| D-PF-3 | ปุ่ม "เลือกแพ็กเกจ" บนเว็บ official คงพาเข้า LINE OA (ไม่มีบัญชีต้องสมัครก่อนทาง LINE) | ไม่แตะ CTA; เพิ่มขั้น "เลือกแพ็กเกจ" ในวิธีใช้งาน 5 ขั้นของเว็บ (repo `mangmee_web`, งานแยก) |
| D-PF-4 | อีเมลผิด = แก้ผู้รับเอกสารในแอป + ส่งเอกสารเดิมซ้ำ; ชื่อ/ที่อยู่บนใบผิด = ลูกค้าแก้เองได้ (ยกเลิกใบเดิมด้วยใบลดหนี้ไม่คืนเงิน + ออกใบใหม่ยอดเดิม) | §7-D |
| D-PF-5 | ทุกจุดที่ลูกค้าเห็น "ติดต่อทีมงาน" ต้องมีเครื่องมือฝั่งแอดมินรองรับ | §7-E |
| D-PF-6 | "ยังไม่มีแพ็กเกจ" (และหมดอายุจริง) = เข้าหน้าแพ็กเกจและตั้งค่าบัญชีเดิมได้ทุกทาง (LIFF/LINE/เว็บ) ที่เหลือบล็อกเหมือนเดิม; ไม่ต้องกดต่ออายุในคอนโซลอีก | §7-C |
| D-PF-7 (default) | อีเมลบัญชี (ล็อกอินสำรองด้วย OTP) ยังเป็นทางเลือก ไม่บังคับก่อนซื้อ | §7-A R-A6 |
| D-PF-8 (default) | ไม่มี feature flag ใหม่; กติกาเป็นโค้ด; gate การขายเดิม (`new_sales`, โหมดจ่าย) คงเดิม | §17 |
| D-PF-9 (Owner 2026-09-26 รอบ 2) | หน้าต่างแก้ใบด้วยตัวเอง = **30 วันนับจากวันที่ออกใบ** (ไม่ใช่สิ้นเดือนถัดไป) 1 ครั้ง/ใบ | R-D5 |
| D-PF-10 (Owner 2026-09-26 รอบ 2) | LINE ส่งการ์ด/ลิงก์/แจ้งเตือนเรื่องแพ็กเกจให้ **ผู้มีสิทธิ์จัดการแพ็กเกจทุกคน** (`company.plan.manage`) ไม่ใช่เฉพาะ OWNER role — ให้ตรงกับเว็บ | R-C11 (G26 เข้า scope) |

## 2. Goal

1. ร้านที่สมัครใหม่ (LINE หรือเว็บ) ซื้อแพ็กเกจได้ **โดยไม่ต้องกรอกอะไรในแอปเราก่อน**: การ์ดในแชต → หน้าแพ็กเกจ → ยืนยัน → Stripe → ใช้งานได้ (3 หน้า, 4 แตะ, 0 ช่องกรอกในแอป)
2. ร้านที่ "ยังไม่มีแพ็กเกจ" หรือหมดอายุ เข้าหน้าแพ็กเกจและตั้งค่าบัญชีได้เองจากทุกทางเข้า ไม่มีหน้าไหนบอกให้ติดต่อทีมงานเป็นทางหลัก และ Owner ไม่ต้องต่ออายุด้วยมือ
3. เอกสารการชำระเงินแก้ไขได้เอง (อีเมลผู้รับ, ชื่อ/ที่อยู่บนใบ) โดยไม่กระทบสิทธิ์และไม่มีการเรียกเก็บหรือคืนเงิน
4. แอดมินคอนโซลทำทุกอย่างที่ลูกค้าถูกบอกให้ "ติดต่อทีมงาน" ได้จากหน้าเดียว และค้นด้วยเลขอ้างอิงได้

## 3. Source Docs และของเดิมที่ต่อยอด

- ล็อกร้าน/locked shell: [P29](mangmee-company-plan-term-spec-th.md) §4B (`auth.guard.ts` allowlist), [sales-deals spec](mangmee-sales-deals-and-locked-signup-spec-th.md) J1/S02/S03 (provisioning term 0 วัน + `DISABLED`/`termDisabledAt` reason `no_package`: `provision-signup.use-case.ts:475,512-534`), web locked shell `WorkspaceLayout.tsx:83-104,145-160`, `PlanTermBanner.tsx`, `CompanyTermExpiredPage.tsx`
- ทางเข้า LINE: LIFF signup status `get-line-signup-status.use-case.ts:57-77` (`canEnter = company.status === 'ACTIVE'`), LIFF page `liff-page.security.ts:700-711,995-1045`, LIFF start/session `exchange-liff-session.use-case.ts:112-165` (รับร้าน `DISABLED`+`termDisabledAt` แล้ว), handoff `line-handoff.logic.ts:13,78` (`/l/<token>` 15 นาที ใช้ครั้งเดียว), `app/l/[token]/route.ts`, การ wrap ลิงก์ `process-line-webhook.use-case.ts:3274-3280` (wrap เฉพาะเมื่อ `LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED` ปิด), การ์ดล็อก `line-business-card.logic.ts:516-541` + `replyIfCompanyLocked` (webhook `:2177-2190`), push หลังสมัคร `line-signup-notify.service.ts:356-374`, in-app browser helper `apps/web/src/common/auth/line-in-app-browser.logic.ts`
- การซื้อ: `billing.service.ts` quote `:280-372` (email proof `:301`, profile `:306`, recipient `:335`), checkout `:511-751` (Checkout params `:711-728`), status `:798-855`; email state `account-email-state.ts:36-51`; profile gate `billing-company-profile.ts` (api + contracts); recipient service `billing-email-recipient` (advance ที่ reconciler `:215`); reconciler apply `billing-reconciler.service.ts:464-675`; worker 10 s/30 s `apps/workers/src/modules/billing/billing-worker.ts:5-12`; ไฟล์หลักฐาน `paid-invoice.ts` / `paid-checkout-invoice.ts` **ไม่แตะ** (ไม่ได้ตรวจอีเมล)
- หน้าเว็บลูกค้า: `BillingPage.tsx` (email gate `:441,505`, profile modal `:251,308-315`, กล่องเหลือง `:326-338`, quote `:513-582`, return `:196-205,340-393`), `AccountEmailOtpPanel.tsx` (reauthenticate `:82-86` ไม่มี external-browser flag), `account-email-otp.service.ts:145-152` (EMAIL_REAUTH_REQUIRED), `api-error-message.ts`
- เอกสาร: `billing-invoice-details.ts:61-65` (hosted invoice/PDF/receipt), `documents/:documentId/open` (customer + admin), refund/credit note `billing-refunds.service.ts` (line-based credit notes, `out_of_band_amount`), end-package `billing-end-package.ts`, refund source `billing-refund-source.ts`
- แอดมิน: partner detail (`PartnerDetailPage.tsx`; `update-partner-profile.use-case.ts` แก้ได้แค่ name/email/phone), plan-term renew `company-plan-term.use-cases.ts:247-330` (บวกวัน + reactivate), lookup `lookup-users.use-case.ts` (email/username), admin invoice page `/system/billing/companies/:id/invoices/:invoiceId` (refund-preview, end-package, adjustments), support inbox → "เปิดหน้าร้าน" → "ดูการชำระเงินของบริษัท" (`PartnerDetailPage.tsx:3115`)
- Stripe: [Checkout Session create](https://docs.stripe.com/api/checkout/sessions/create) (`customer`, `customer_update`, `billing_address_collection`; Customer ที่มีอีเมลแล้ว Checkout จะไม่ให้แก้), [Send invoice](https://docs.stripe.com/api/invoices/send) (ส่งใบที่จ่ายแล้วซ้ำได้), [Charge update `receipt_email`](https://docs.stripe.com/api/charges/update), [Credit notes](https://docs.stripe.com/api/credit_notes/create) (`out_of_band_amount`), [Pay invoice `paid_out_of_band`](https://docs.stripe.com/api/invoices/pay)

## 4. Non-goals

- ไม่เปิดทดลองใช้ฟรีกลับมา (R1 เดิมคงอยู่); ไม่มีโอน/แนบสลิป; ไม่มี proration ใหม่; ไม่แตะราคา/นโยบาย/gate การขาย
- ไม่แก้ CTA ของเว็บ official (D-PF-3); ไม่ทำ OTP ทางโทรศัพท์; ไม่ทำ passwordless เพิ่ม; ไม่ทำหัก ณ ที่จ่ายฝั่งผู้ซื้อ (ลูกค้านิติบุคคลที่ต้องหัก 3% ยังจ่ายเต็มผ่าน Stripe — ประเด็นแยก)
- ไม่ออกแบบกติกาใบกำกับภาษีหลังจด VAT (อ้างเลขใบเดิม/วันที่เดิม/เหตุผลตามสรรพากร) — ต้องมีสเปกแยกก่อนจด VAT (§7-D R-D6)
- ไม่แตะไฟล์หลักฐานการจ่าย (`paid-invoice.ts`, `paid-checkout-invoice.ts`) และไม่เปลี่ยน tier key/entitlement ของร้านใหม่ (คง `FREE_TRIAL_15` + term 0 วันภายใน; เปลี่ยนเฉพาะการแสดงผล — R-C7)
- ไม่มี feature flag/env ใหม่ (D-PF-8)

## 5. User Roles

| บทบาท | เกี่ยวข้องอย่างไร |
|---|---|
| OWNER ร้าน (LINE-first: ไม่มีรหัสผ่าน/อีเมล/ที่อยู่) | กลุ่มหลักที่ติด; ต้องซื้อได้จากการ์ดในแชตโดยไม่ตั้งค่า |
| ผู้มีสิทธิ์ `company.plan.manage` (custom role) | ซื้อบนเว็บได้เท่า OWNER (เดิม); LINE ส่งการ์ด/ลิงก์/แจ้งเตือนให้ด้วย (R-C11, D-PF-10) |
| พนักงานร้าน | ไม่เห็นแพ็กเกจ (เดิม) |
| SYSTEM_ADMIN / billing operator (company scope) | ใช้เครื่องมือ §7-E; single-admin self-confirm ตาม [billing-single-admin spec](billing-single-admin-spec-2026-09-16.md) |

## 6. Business Journey

- **J1 ร้านใหม่จาก LINE**: เปิดร้านใน LIFF → หน้าผลลัพธ์ "เปิดร้านแล้ว ขั้นต่อไปเลือกแพ็กเกจ" [เลือกแพ็กเกจ] → เปิดหน้าแพ็กเกจในเบราว์เซอร์นอก LINE (ล็อกอินให้แล้ว) → เลือกโหมดจ่าย/แพ็กเกจ → ยืนยัน → Stripe ถามบัตรหรือ QR + อีเมล + ที่อยู่ → กลับหน้า return "ชำระแล้ว เปิดใช้งานแล้ว · ส่งเอกสารไปที่ {อีเมล} [แก้ไข]" → ใช้งานได้ (LINE ตอบทันที)
- **J2 ร้านล็อกส่งข้อความในแชต**: ได้การ์ดล็อก [เลือกแพ็กเกจ] → กดเดียวเข้าหน้าแพ็กเกจ (เบราว์เซอร์นอก LINE) → เหมือน J1
- **J3 ร้านหมดอายุจริง**: เหมือน J2 (คำว่า "หมดอายุ · ต่ออายุ") ; เว็บเข้าได้เฉพาะ locked shell (เดิม)
- **J4 อีเมลผิด**: หน้า return หรือแท็บการต่ออายุ → "แก้อีเมลรับเอกสาร" (OTP ไปอีเมลใหม่) → "ส่งเอกสารล่าสุดไปอีเมลใหม่" → Stripe ส่งใบเดิมซ้ำ
- **J5 ชื่อ/ที่อยู่บนใบผิด**: ประวัติ → เปิดใบ → "ข้อมูลบนใบไม่ถูกต้อง แก้ไข" → ฟอร์ม (ชื่อบนเอกสาร เลขผู้เสียภาษี ที่อยู่) → ยืนยัน "ยกเลิกใบเลขที่เดิม ออกใบใหม่ ยอดไม่เปลี่ยน ไม่มีเรียกเก็บ/คืนเงิน" → ใบใหม่ในประวัติ + ส่งอีเมล; ใบเดิมป้าย "ถูกแทนที่โดย …"
- **J6 แอดมินช่วยลูกค้า**: กล่องคำขอคุยกับเจ้าหน้าที่ (มีเลขอ้างอิง) → "เปิดรายการ" → หน้าใบแจ้งหนี้ของบริษัท → ส่งซ้ำ / เปลี่ยนอีเมลผู้รับ / แก้ข้อมูลบนใบ; หรือ ระบบ → บริษัทและผู้ใช้งาน → แก้ไขข้อมูลบริษัท (ชื่อจดทะเบียน/ที่อยู่/เลขภาษี) สำหรับใบถัดไป

## 7. Business Rules

### 7-A ซื้อโดยไม่ต้องตั้งค่าก่อน (ทับ gate 2026-09-17 และ D4)

- **R-A1** `quote` และ `checkout` ทุก purchase kind (INITIAL/RESTART/REPEAT/UPGRADE/FULL_PACKAGE/ดีล) **ไม่ต้องมี** verified account email และ **ไม่ต้องมี** invoice profile ครบ; รหัส `BILLING_EMAIL_VERIFICATION_REQUIRED`, `BILLING_EMAIL_CHANGED`, `BILLING_COMPANY_PROFILE_REQUIRED` ไม่ถูกโยนจากเส้นทางซื้ออีก (คง mapping ข้อความไว้ 1 release เพื่อ client เก่า)
- **R-A2 Stripe Customer ก่อน Checkout** (เดิมส่งชื่อ/ที่อยู่อยู่แล้ว): `name` = `registeredName.trim() || Company.name.trim()` (เดิม); `address` = จากโปรไฟล์ **เฉพาะเมื่อครบ 5 ช่อง** ไม่ครบ → ไม่ส่ง; `email` = อีเมลบัญชีของผู้กดซื้อ **เฉพาะเมื่อ verified** หรือผู้รับเอกสารปัจจุบันของบริษัท; ไม่มีทั้งคู่ → **ไม่ตั้งอีเมล** เพื่อให้ Checkout ถามและบันทึกลง Customer เอง (Stripe ล็อกอีเมลที่ Customer มีอยู่แล้วให้แก้ในหน้า Checkout ไม่ได้ จึงห้ามเติมอีเมลที่ยังไม่ยืนยันลง Customer)
- **R-A3 Checkout params** ทั้ง `mode: 'payment'` และ `'subscription'`: คง `billing_address_collection: 'required'` + เพิ่ม `customer_update: { address: 'auto' }`; **ไม่ตั้ง** `customer_update.name` (ชื่อบนเอกสารต้องเป็นชื่อร้าน ไม่ใช่ชื่อผู้ถือบัตร); Stripe prefill ที่อยู่จาก Customer เมื่อมี
- **R-A4 (แทนที่โดย §18.2 — ห้ามเขียนที่อยู่ลงข้อมูลบริษัท; อ่าน Customer ก่อน transaction)** ~~คัดลอกกลับหลังจ่ายสำเร็จ~~ ใน apply ของ reconciler (หลังหลักฐานผ่าน, ใน transaction/lock เดิม, idempotent): อ่าน Customer ปัจจุบัน → (ก) ผู้รับเอกสารของบริษัท = `customer.email` (`recipientSource = STRIPE_CHECKOUT`, ไม่แตะ `User.email`/`emailVerifiedAt`); (ข) เติมที่อยู่ในโปรไฟล์บริษัท **เฉพาะช่องที่ว่าง** ตาม mapping เดิมของ gate spec (line1 ↔ บ้านเลขที่/ถนน, line2 ↔ ที่อยู่เพิ่มเติม+ตำบล/แขวง, city ↔ อำเภอ/เขต, state ↔ จังหวัด, postal_code ↔ รหัสไปรษณีย์; ค่าที่แยกไม่ได้ให้เก็บ line2 ทั้งก้อนใน "ที่อยู่เพิ่มเติม" และเว้นตำบล) ไม่ทับข้อมูลที่ลูกค้ากรอกไว้; audit `billing.recipient.captured` / `company.profile.filled_from_checkout` (ไม่มี PII ใน metadata)
- **R-A5 ความสอดคล้องผู้รับ**: กติกาใหม่ "ผู้รับเอกสาร = อีเมลบน Stripe Customer ของบริษัท"; ยกเลิกการเทียบกับ account email ที่ quote/checkout/resume (`billing.service.ts:332-336, 634-635, 686`) — `BILLING_RECIPIENT_UPDATE_REQUIRED` เหลือเฉพาะกรณี operation เปลี่ยนผู้รับกำลังค้าง; ตัวตรวจ customer id / account / livemode คงเดิม; ไฟล์หลักฐานไม่แตะ
- **R-A6 อีเมลบัญชี** (OTP, ล็อกอินสำรอง) แยกจากผู้รับเอกสาร: ไม่บังคับก่อนซื้อ; หน้าแพ็กเกจไม่มีขั้น "ยืนยันอีเมลบัญชี"; หน้าบัญชีของฉันคงเดิม และเสนอ "ตั้งอีเมลสำรอง" เป็นรายการข้ามได้
- **R-A7 อีเมลชำระสำเร็จ + ตัวตรวจตีกลับ**: หลัง apply ส่งอีเมล "ชำระสำเร็จ" ผ่าน mailer ของเรา (Postmark, template billing status เดิม) ไปยังผู้รับเอกสาร โดยลิงก์ในเมลเป็นลิงก์เข้าแอป (หน้าเอกสาร) ไม่ใช่ URL ของ Stripe; Postmark Bounce/SpamComplaint (`postmark-events.service` เดิม) ที่ตรงกับผู้รับเอกสาร → ตั้งธง `recipientBouncedAt` → แบนเนอร์ในหน้าแพ็กเกจ "อีเมลรับเอกสารส่งไม่ถึง แก้ไขได้ที่นี่" + LINE push ถึง OWNER 1 ครั้งต่อธง; ธงล้างเมื่อเปลี่ยนผู้รับสำเร็จ
- **R-A8 หน้า return**: แสดง "ส่งเอกสารไปที่ {อีเมล}" + ปุ่ม "แก้อีเมลรับเอกสาร" (ไป R-D2) ทันทีที่สถานะ PAID/APPLIED
- **R-A9 หน้าแพ็กเกจ**: ปุ่มเลือกแพ็กเกจกดได้เสมอเมื่อ `allowedActions` มี `new_sales`; ถอด modal "กรอกข้อมูลบริษัทก่อนซื้อ" และ detour `billingProfileHref`; กล่องเหลือง "ตั้งค่าข้อมูลบริษัทก่อนซื้อ" → กล่องข้อมูลไม่บล็อก "เอกสารจะออกในชื่อ {ชื่อ} · ที่อยู่กรอกได้ที่หน้าชำระเงิน หรือเติมล่วงหน้าที่ข้อมูลร้าน" (ลิงก์ไปโปรไฟล์คง `returnTo=billing` เดิม)
- **R-A10 quote snapshot** คงผูกชื่อ/ที่อยู่ที่ส่งไป Stripe ณ quote (ว่างได้) และ `BILLING_QUOTE_STALE` เมื่อโปรไฟล์เปลี่ยนคงเดิม
- **R-A11 หน้ายืนยัน (quote)**: กล่อง "ข้อมูลออกเอกสาร" แสดง ชื่อ · ที่อยู่ (หรือ "จะกรอกที่หน้าชำระเงิน") · อีเมล (หรือ "จะกรอกที่หน้าชำระเงิน"); ลิงก์ "แก้ไขข้อมูลบริษัท" คงไว้เป็นทางเลือก

### 7-B ลิงก์จาก LINE เปิดนอกเบราว์เซอร์ของ LINE

- **R-B1** ทุก URL เข้าเว็บแอปในข้อความ LINE (Flex `uri`, ข้อความ, quick reply, การ์ดแจ้งเตือน, ข้อเสนอพิเศษ, การ์ดโปรโมชั่น, การ์ดล็อก, ตอบคำสั่งขอเปลี่ยนแพ็กเกจ, ปุ่ม "บริษัทของฉัน") ต้องมี `openExternalBrowser=1` — ทำที่จุดสร้างเดียว `lineHandoffUrl()` (`line-handoff.logic.ts:78`) และจุดที่สร้าง URL ธรรมดาโดยไม่ผ่าน handoff; ยกเว้น URL ของ LIFF (`liff.line.me/...`) และลิงก์ภายนอก; helper กลาง `withLineExternalBrowserParam(url)` ใน contracts/shared และ test ว่าทุก builder ผ่าน helper
- **R-B2 (ตัดสินแล้ว §18.2 = ทาง (ข) mint ในเลนก่อนบันทึก; ห้าม mint ในกลุ่ม)** การ์ดล็อก, ตอบคำสั่งขอเปลี่ยนแพ็กเกจ และการ์ดโปรโมชั่น ต้องเป็น **one-tap handoff เสมอ** ไม่ขึ้นกับ `LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED`: mint ณ เวลาส่ง (delivery-time) ขณะที่ payload ที่บันทึกเพื่อ replay ยังเป็น URL ธรรมดา (กติกา replay เดิม); ผู้ implement ต้องอ่านเหตุผลของเงื่อนไขที่ `process-line-webhook.use-case.ts:3268-3280` — ถ้าเงื่อนไขมีไว้เพียงเพื่อความเท่าเทียมของ byte กับ legacy path ให้ wrap เสมอเมื่อ `event.handoff` มี; ถ้ามีเหตุด้านความถูกต้องของ replay ให้ mint ตรงใน builder ของสามการ์ดนี้แบบเดียวกับการ์ดโปรโมชั่น (`:2309`) และบันทึกเหตุผลใน memory
- **R-B3 (ตัดทิ้ง — §18.2 RV09)** ~~การแลก handoff token~~ (`exchange-line-handoff-token`) และ LIFF session ถือเป็น fresh re-authentication: ตั้ง `emailReauthenticatedAt` + binding บน session ที่สร้าง เพื่อขั้นตั้งอีเมลสำรองไม่ต้องล็อกอิน LINE ซ้ำภายใน 5 นาที (ความสำคัญต่ำหลัง 7-A)
- **R-B4** ปุ่ม "ยืนยันตัวตนผ่าน LINE" ในหน้าอีเมลบัญชีต้องใช้ `withLineExternalBrowser` เหมือนหน้าล็อกอิน (`AccountEmailOtpPanel.tsx:82-86`)
- **R-B5** หน้า login ที่มาด้วย `line=handoff-expired&next=` และมี session ใช้ได้ → ไป `next` ทันที; ข้อความลิงก์หมดอายุใน LINE บอกให้ "กดเมนู บริษัทของฉัน เพื่อรับลิงก์ใหม่"

### 7-C สถานะ "ยังไม่มีแพ็กเกจ" เป็นสถานะปกติที่เข้าได้ทุกทาง

- **R-C1 นิยาม** (เดิม P29/R2): ร้านล็อก = `Company.status = DISABLED` + `planTerm.termDisabledAt ≠ null`; `lockReason` ∈ {`no_package` (term 0 วัน + `renewCount = 0`), `trial_ended`, `expired`}; ทุก surface ต้องถือว่าร้านล็อก "เข้าได้แบบจำกัด" ไม่ใช่ "เข้าไม่ได้"
- **R-C2 LIFF signup status** (แก้ไข §18.2: **คง `canEnter` เดิม** เพิ่มฟิลด์แสดงผลแทน): ~~`canEnter = ACTIVE || locked`~~; DTO เพิ่ม `entryKind: 'ACTIVE' | 'LOCKED'` และ `lockReason`; หน้า LIFF เมื่อ COMPLETED + LOCKED → หัวข้อ "เปิดร้านแล้ว ขั้นต่อไปเลือกแพ็กเกจ", ปุ่มหลัก "เลือกแพ็กเกจ" (ขอ handoff ผ่าน `liff/session` target หน้าแพ็กเกจ แล้ว `liff.openWindow({ external: true })` แบบเดียวกับปุ่ม "เปิดหน้าเว็บ"), "ติดต่อเจ้าหน้าที่" เป็นปุ่มรอง; รายการร้าน: `no_package` → "ยังไม่มีแพ็กเกจ · เลือกแพ็กเกจ", อื่น → "หมดอายุ · ต่ออายุ" (แทน "หมดอายุแล้ว ติดต่อทีมงานเพื่อเลือกแพ็กเกจก่อนเข้าใช้งานค่ะ")
- **R-C3 LIFF start (เปิดหน้าเว็บ)** สำหรับร้านล็อก: target = `/companies/:id/billing` โดยตรง (แทน `/renew`; Q5) ; `/renew` ยังอยู่สำหรับ redirect ของ locked shell
- **R-C4 push หลังสมัคร** (แก้ไข §18.2: คงเป็นลิงก์ LIFF = 2 แตะ ไม่ mint token ใน push): หัวข้อ "เปิดร้านแล้ว" ข้อความ "เปิดร้าน {ร้าน} ให้แล้วค่ะ ขั้นต่อไปเลือกแพ็กเกจเพื่อเริ่มใช้งาน" ปุ่ม "เลือกแพ็กเกจ" = one-tap external ไปหน้าแพ็กเกจ (แทน "พร้อมใช้งานแล้ว"/"เริ่มใช้งาน"); ภาพวิธีใช้ในแชตต้องมีขั้นเลือกแพ็กเกจ
- **R-C5 เว็บ**: locked shell คงเดิม (billing, billing/return, billing/invoices, settings, settings/profile, renew); e2e ต้องเดินจริง: LINE login → ร้านล็อก → ลงหน้าแพ็กเกจ; company picker ใช้ label ตาม `lockReason` ("ยังไม่มีแพ็กเกจ"/"หมดอายุ") แทน "ครบกำหนดใช้งาน" (`BillingCompanyPicker.tsx:24,27`)
- **R-C6 คอนโซล**: partner list/detail แสดงสถานะ "ยังไม่มีแพ็กเกจ" (จาก `lockReason`) แทน tier "ทดลองใช้ฟรี" + "หมดอายุ"; ปุ่ม "ต่ออายุ" สำหรับร้าน `no_package` มีคำเตือน "ร้านนี้ยังไม่มีแพ็กเกจ ลูกค้าซื้อเองได้จากหน้าแพ็กเกจ การต่ออายุ = ให้วันใช้งานฟรี" + เหตุผลบังคับ (audit) — ไม่ถอดปุ่ม (Q4)
- **R-C7** tier ตอนสมัครคง `FREE_TRIAL_15` + term 0 วันภายใน (ไม่แตะ entitlement/normalization) แต่ **ห้ามแสดงคำว่า "ทดลองใช้"** กับร้าน `no_package` ในทุก surface — label ต้องมาจาก `lockReason` (helper เดียวใน contracts `planTermStateLabel(term)`)
- **R-C8 LINE**: การ์ดล็อกคง "ยังไม่ได้สมัครแพ็กเกจ"/"แพ็กเกจหมดอายุแล้ว" ตาม lockReason (เดิม); รายการร้านใน "บริษัทของฉัน" ใช้ label เดียวกับ R-C2
- **R-C9** ร้านที่ Owner เคยกดต่ออายุด้วยมือ: ไม่ต้องทำอะไร; เมื่อครบวันจะล็อกด้วย `trial_ended`/`expired` และเข้าหน้าซื้อได้ตามกติกาเดียวกัน
- **R-C10** sweep ต้องไม่ส่ง "ครบกำหนด" และไม่แจ้ง SYSTEM_ADMIN สำหรับร้าน `no_package` (เดิมกันด้วย DISABLED ทันที) — เพิ่ม test ยืนยัน
- **R-C11 LINE ใช้สิทธิ์เดียวกับเว็บ** (D-PF-10): ทุกจุดที่ LINE ตัดสินว่าใคร "จัดการแพ็กเกจได้" ใช้ predicate เดียว = สมาชิก ACTIVE ที่ role ACTIVE มี `company.plan.manage` (เหมือน `assertOwner` ใน `billing.service.ts:102-121`) แทนการเช็ก role OWNER: การ์ดล็อก/`lockedCompanyFor(..., ownerOnly)` (webhook `:2181`), ปุ่มซื้อบนการ์ดโปรโมชั่นและคำสั่งขอเปลี่ยนแพ็กเกจ (webhook `:1162-1164, 2298, 2814`), ผู้รับแจ้งเตือนใกล้หมด/หมดอายุ (`plan-term-sweep.use-case.ts:178`), ผู้รับแจ้ง "อัปเดตแพ็กเกจ" หลังจ่าย (`billing-notifications.service.ts:225-227`), ผู้รับ push ข้อเสนอพิเศษ (`sales-deals.service.ts:520-528`), ลิงก์กลับของหน้าอีเมลบัญชี (`account/email/page.tsx:23`); พนักงานที่ไม่มีสิทธิ์ยังได้ข้อความพนักงานเดิม; helper กลาง `planManagersOf(companyId)` ใน employee-access/auth ใช้ร่วมกันทุกจุด

### 7-D แก้ไขเอกสารด้วยตัวเอง (ลูกค้า)

- **R-D1 ส่งเอกสารซ้ำ**: ปุ่ม "ส่งเอกสารไปอีเมลอีกครั้ง" ในหน้าเอกสาร (customer) → ใบแจ้งหนี้: `POST /v1/invoices/{id}/send` (Stripe ส่งใบที่ finalized/paid ซ้ำได้); ใบเสร็จ: `POST /v1/charges/{id}` `{ receipt_email }` = ผู้รับปัจจุบัน (Stripe ส่งใบเสร็จเมื่ออัปเดต); จำกัด 3 ครั้ง/เอกสาร/วัน (Redis limiter เดิม); audit `billing.document.resent`; provider error → ข้อความไทย + ไม่นับครั้ง
- **R-D2 เปลี่ยนอีเมลผู้รับเอกสาร**: flow เดิม (OTP ไปอีเมลใหม่ → อัปเดต Stripe Customer + ผู้รับ) คงไว้ ใช้ได้จากหน้า return, แท็บการต่ออายุ, แบนเนอร์ตีกลับ; หลังยืนยันเสนอ "ส่งเอกสารล่าสุดไปอีเมลใหม่" (= R-D1) และล้าง `recipientBouncedAt`
- **R-D3 (พักไว้ — §18.2 DQ1: ย้ายไปสเปกแยก)** แก้ชื่อ/ที่อยู่บนใบที่ออกแล้ว = operation `DOCUMENT_REISSUE` (preview → confirm, journal/observed/retry แบบ collection op เดิม):
  1. อัปเดตโปรไฟล์บริษัท (ชื่อบนเอกสาร = registeredName, เลขผู้เสียภาษี, ที่อยู่ 5 ช่อง) + Stripe Customer `name`/`address` (มีผลกับใบถัดไปด้วย)
  2. ใบลดหนี้บนใบเดิม: `out_of_band_amount` = ยอดใบ, ไม่มี `refund_amount`, `reason: 'order_change'`, memo "ออกใบใหม่แทนเลขที่ {เลขใบเดิม} — แก้ไขข้อมูลผู้ซื้อ", metadata `mangmeeDocumentReissueOperationId`, `mangmeeReissueKind: 'BUYER_DETAILS'`
  3. ใบใหม่: invoice items เท่ารายการเดิม (product/price หรือ amount, quantity, tax เดิม, currency THB), `auto_advance: false`, `collection_method: 'send_invoice'` + `days_until_due` ตามค่าเดิมของระบบ, **`effective_at` = วันที่ของใบเดิม** (ให้ "วันที่ออกเอกสาร" บน PDF/ใบเสร็จเป็นวันเดิม ลูกค้าลงบัญชีงวดเดิมได้), footer/memo "ออกแทนใบเลขที่ {เดิม} — แก้ไขข้อมูลผู้ซื้อ", metadata `mangmeeReplacesInvoiceId` + attempt/company เดิม; ถ้าลูกค้ากรอกเลขผู้เสียภาษี ให้ตั้ง Stripe Customer `tax_ids` ชนิด `th_vat` ก่อน finalize เพื่อให้เลขปรากฏบนใบ; finalize, `POST /v1/invoices/{id}/pay` `{ paid_out_of_band: true }`, แล้วส่งอีเมล (`send`)
  4. DB: แถว `BillingInvoice` ใหม่ (`kind: DOCUMENT_REISSUE`, `replacesInvoiceId`), ใบเดิม `replacedByInvoiceId`; ประวัติแสดงใบใหม่เป็นเอกสารปัจจุบัน ใบเดิมป้าย "ถูกแทนที่โดย {เลขใหม่}" (ยังเปิดดูได้)
- **R-D4 ห้ามกระทบสิทธิ์**: หลักฐานเปิดสิทธิ์/สัญญา (`contractAttemptId`, source invoice, `oneTime` continuation, `billingAnchorDay`, refund-source) อ้างใบเดิมต่อไป; ตัวตรวจ refund/dispute/credit note ที่ใช้ตัดสิน review/hold/ต่อท้ายรอบ (`billing-refund-source.ts`, reconciler paid-held, `billing-repeat.ts` assertNoDebt, `billing-purchase-source.ts`) ต้อง **ข้าม** credit note ที่มี metadata reissue และใบใหม่ `kind: DOCUMENT_REISSUE`; รายงานยอดขาย (sales report/settlements) นับใบเดิมครั้งเดียว ไม่นับใบใหม่ และไม่นับใบลดหนี้ reissue เป็นการคืนเงิน
- **R-D5 ข้อจำกัด self-service**: 1 ครั้ง/ใบ; ภายใน **30 วันนับจากวันที่ออกใบ** (เทียบวันที่ Asia/Bangkok; D-PF-9); เฉพาะฟิลด์ผู้ซื้อ; ไม่ใช้กับใบที่มีการคืนเงิน/ข้อพิพาท/ใบลดหนี้อื่น หรือใบที่ operation อื่นค้าง; ครั้งที่สองหรือเลยกำหนด → ข้อความ "ติดต่อทีมงาน" พร้อมเลขอ้างอิง (แอดมินทำได้ R-E1)
- **R-D6 VAT และข้อสังเกตทางเอกสาร**: ใบเสร็จของผู้ขายที่ไม่จด VAT ไม่มีกำหนดเวลาแก้ไขตามกฎหมาย ลูกค้าใช้ลงรายจ่ายได้ตราบที่ชื่อ/ที่อยู่/เลขผู้เสียภาษีของผู้ซื้อถูก (30 วันจึงพอ); การออกใบใหม่ต้องคง **วันที่เดิม** (R-D3 `effective_at`) และอ้างเลขใบเดิม เพื่อไม่ให้ลูกค้าลงบัญชีผิดงวด; ตอนนี้ NOT_VAT_REGISTERED เอกสาร Stripe เป็นใบเสร็จธรรมดา; เมื่อจด VAT ต้องมีสเปกแยกก่อนเปิดใช้ R-D3 ต่อ (ใบใหม่อ้างเลขใบเดิม ใช้วันที่เดิม (`effective_at`) ระบุเหตุผล) — ใส่ guard: ถ้า policy tax treatment ≠ NOT_VAT_REGISTERED ให้ปิด self-service reissue และแสดง "ติดต่อทีมงาน"
- **R-D7 copy ยืนยัน** ทุกครั้ง: "ระบบจะยกเลิกใบเลขที่ {เดิม} และออกใบใหม่ด้วยข้อมูลนี้ ยอดเงินไม่เปลี่ยน ไม่มีการเรียกเก็บหรือคืนเงิน" + สรุปฟิลด์ก่อน/หลัง

### 7-E เครื่องมือแอดมิน (ทุก "ติดต่อทีมงาน" มีปุ่มรองรับ)

- **R-E1 หน้าใบแจ้งหนี้ของบริษัท** (`/system/billing/companies/:id/invoices/:invoiceId`, มี refund/end-package อยู่แล้ว) เพิ่ม 3 ปุ่ม: "ส่งเอกสารซ้ำ" (R-D1), "เปลี่ยนอีเมลผู้รับเอกสาร" (R-E2), "แก้ข้อมูลบนใบและออกใบใหม่" (engine R-D3, ไม่ติดลิมิต R-D5 แต่ **เหตุผลบังคับ**; reviewed-op + single-admin self-confirm + password proof เดิม)
- **R-E2 เปลี่ยนผู้รับโดยแอดมิน**: ตั้ง Stripe Customer email + ผู้รับเอกสาร (`recipientSource = ADMIN`, เหตุผล, อ้าง support request ถ้ามี) **ไม่ตั้ง** verified ของ account email; แจ้งลูกค้าทาง LINE/เว็บว่า "ทีมงานเปลี่ยนอีเมลรับเอกสารให้ตามคำขอ"
- **R-E3 แก้ไขข้อมูลบริษัท** (partner detail): เพิ่ม ชื่อจดทะเบียน, เลขผู้เสียภาษี, ที่อยู่ 5 ช่อง (ใช้ `address-master` lookup เดิม; เส้นทางแอดมินมีอยู่แล้วสำหรับ sales agents) → sync Stripe Customer name/address (ไม่แก้ใบเก่า); คง permission ของ `update-partner-profile` เดิม; audit ระบุฟิลด์ที่เปลี่ยน ไม่เก็บค่า PII
- **R-E4 ค้นหาด้วยเลขอ้างอิง**: ช่องบนหน้า `/system/billing` รับ attempt id, เลขใบ (เช่น `JVWXECXS-0001`), Stripe invoice/session/charge id → ลิงก์ไปหน้า checkouts/:attemptId หรือ invoices/:invoiceId ของบริษัทนั้น; ต้องมี `system.billing.read`; ไม่คืนข้อมูลบริษัทอื่นนอกจากลิงก์เดียว
- **R-E5 เลขอ้างอิงในคำขอ**: คำขอติดต่อเจ้าหน้าที่ที่เริ่มจากหน้า billing (เว็บ: ปุ่ม/ฟอร์ม; LINE: การ์ดล็อก/ข้อความหลังชำระ) แนบ `reference` (attempt/invoice) → กล่องคำขอแสดงปุ่ม "เปิดรายการ" (R-E4)
- **R-E6 permissions**: อ่านใช้ `system.billing.financial.read`; ปฏิบัติการเอกสาร (ส่งซ้ำ/เปลี่ยนผู้รับ/ออกใบใหม่) ใช้ `system.billing.override.manage` (ที่ receipt adjustments ใช้อยู่); แก้ไขข้อมูลบริษัทใช้ permission ของ partner profile เดิม; ไม่เพิ่ม key ใหม่เว้นแต่ review พบว่าจำเป็น
- **R-E7 audit**: `billing.document.resent`, `billing.recipient.changed` (source: CUSTOMER_OTP | STRIPE_CHECKOUT | ADMIN), `billing.document.reissued` (opId, invoice เดิม/ใหม่, ฟิลด์ที่เปลี่ยน), `partner.profile.updated` (ฟิลด์) — ไม่มีอีเมล/ที่อยู่เต็มใน metadata

## 8. Boundary and Ownership

- **billing (api)**: R-A1–A5, A7 ตัวส่งอีเมล/ธงตีกลับ, A10; R-D1–D5 engine + guards; R-E1/E2/E4 endpoints; status DTO เพิ่ม `recipient` {email, source, bouncedAt} และ `documentActions`
- **auth (api)**: R-B3 (handoff/LIFF exchange ตั้ง reauth), R-B5 login redirect, Postmark events → ธงตีกลับ (เรียก billing ผ่าน service เดิม)
- **external-signup (api)**: R-C2 DTO/`canEnter`, R-C4 push, R-C10 test
- **line-ai (api)**: R-B1/B2 (handoff link service, การ์ดล็อก, package-change reply, promotion card), R-C8 labels, R-E5 reference ในคำขอ
- **system-partner-management (api)**: R-C6 label/lockReason ใน DTO + คำเตือนต่ออายุ, R-E3 ฟิลด์เพิ่ม
- **web**: BillingPage (R-A8/A9/A11, R-D1–D3 UI, R-C5 picker), AccountEmailOtpPanel (R-B4), LoginPage (R-B5), PartnerDetailPage (R-C6, R-E3), admin invoice page (R-E1), system billing home (R-E4), support inbox (R-E5)
- **LIFF HTML** (`liff-page.security.ts`): R-C2/C3
- **contracts**: `planTermStateLabel`, `withLineExternalBrowserParam`, DTO เพิ่ม
- **workers**: reissue/resend operations ผ่าน billing worker เดิม (journal/observed/retry)
- **marketing repo**: ขั้น "เลือกแพ็กเกจ" ในวิธีใช้ 5 ขั้น (งานแยก, ไม่ block)

## 9. Data Model (additive) — แทนที่โดย §18.2 §9 (ไม่มีคอลัมน์ผู้รับใน DB วันนี้; ไม่แตะ `BillingInvoice` รอบนี้)

- `BillingAccount`: `recipientEmail` (มีอยู่ในรูปแบบผู้รับเดิม — ใช้ต่อ), เพิ่ม `recipientSource` (`CUSTOMER_OTP` | `STRIPE_CHECKOUT` | `ADMIN`), `recipientBouncedAt?`, `recipientBounceNotifiedAt?`
- `BillingInvoice`: เพิ่ม `kind` (`ORIGINAL` | `DOCUMENT_REISSUE`), `replacesInvoiceId?`, `replacedByInvoiceId?`, `reissueOperationId?`
- `BillingOperation` (ตารางปฏิบัติการเดิม): type ใหม่ `DOCUMENT_REISSUE`, `DOCUMENT_RESEND`, `RECIPIENT_ADMIN_CHANGE`
- LIFF status DTO: `entryKind`, `lockReason`; partner list/detail DTO: `lockReason`, `stateLabel`
- SupportRequest (คำขอคุยกับเจ้าหน้าที่): `referenceKind?` (`attempt` | `invoice`), `referenceId?`
- ไม่มีตาราง Stripe ใหม่; migration additive ทั้งหมด

## 10. Permission and Audit

- ลูกค้า: ทุก endpoint ใหม่ใต้ `companies/:companyId/billing/*` ใช้ `assertOwner` (= `company.plan.manage`) + rate limit 30/นาที เดิม; resend limiter 3/เอกสาร/วัน
- แอดมิน: ตาม R-E6; reviewed-op + self-confirm ตาม single-admin spec; async worker recheck authority ก่อน side effect (เดิม)
- Audit ตาม R-A4, R-E7; การเปิดดูข้อมูลบริษัทโดยแอดมิน (R-E3) audit MEDIUM เหมือน sales agent profile

## 11. API Behavior (สรุป)

| Path | Role | ผล |
|---|---|---|
| `POST /v1/companies/:id/billing/quote` (เดิม) | plan manager | ไม่โยน EMAIL_VERIFICATION_REQUIRED / COMPANY_PROFILE_REQUIRED / RECIPIENT_UPDATE_REQUIRED (ยกเว้น op เปลี่ยนผู้รับค้าง); quote คืน `documentProfile` {name, address?, email?} เพื่อหน้ายืนยัน |
| `POST /v1/companies/:id/billing/checkout` (เดิม) | plan manager | Checkout ตาม R-A2/A3 |
| `GET /v1/companies/:id/billing` (เดิม) | plan manager | เพิ่ม `recipient` {email, source, bouncedAt}, `documentActions` ต่อ invoice {canResend, canReissue, reissueDeadline} |
| `POST /v1/companies/:id/billing/documents/:invoiceId/resend` | plan manager | R-D1; 429 `BILLING_RESEND_LIMIT` |
| `POST /v1/companies/:id/billing/documents/:invoiceId/reissue/preview` · `/:operationId/confirm` · `/cancel` | plan manager | R-D3/D5; errors `BILLING_REISSUE_NOT_ALLOWED` (เหตุผลใน payload: `window_passed` | `already_reissued` | `refund_or_dispute` | `vat_registered` | `operation_pending`) |
| `GET /v1/auth/line/signup-status` (เดิม) | LIFF | `entryKind`, `lockReason`, `canEnter` ใหม่ (R-C2) |
| `POST /v1/auth/line/liff/session` (เดิม) | LIFF | ร้านล็อก target หน้าแพ็กเกจ (R-C3) |
| `GET /v1/system/billing/lookup?reference=` | `system.billing.read` | R-E4 |
| `POST /v1/system/billing/companies/:id/invoices/:invoiceId/resend` · `/recipient/preview|confirm` · `/reissue/preview|confirm` | `system.billing.override.manage` | R-E1/E2 |
| `PATCH /v1/system/partners/:partnerCompanyId` (เดิม) | partner manage | รับ registeredName, taxId, address 5 ช่อง (R-E3) |
| `POST .../support-requests` (เดิม, เว็บ/LINE) | ลูกค้า | รับ `referenceKind/referenceId` (R-E5) |

Error codes ใหม่ต้องมี Thai สองที่ (`api-error-message.ts` + `BillingPage.errorText`): `BILLING_RESEND_LIMIT`, `BILLING_REISSUE_NOT_ALLOWED`, `BILLING_REISSUE_PENDING`, `BILLING_RECIPIENT_BOUNCED`; และปิดช่องว่าง G09 (21 รหัสไม่มีไทย) ในรอบเดียวกัน

## 12. UI Behavior

### เว็บลูกค้า
- หน้าแพ็กเกจ: ปุ่มกดได้เสมอ (R-A9); โหมดจ่าย: ค่าเริ่มต้นบัตร ตัวเลือกอื่นใน "วิธีชำระอื่น" (พับ) (G24); ราคารายปีแสดงต่อเดือนด้วย; กล่องข้อมูลเอกสารไม่บล็อก
- หน้ายืนยัน: R-A11; ข้อความหมดอายุ quote ชัด "ราคานี้หมดอายุแล้ว กดตรวจสอบราคาใหม่" แทนปุ่มจาง (G10)
- หน้า return: R-A8; รอผลนานขึ้นเป็น 3 นาที (2 วิ × 30 วิ แล้ว 5 วิ) ตาม [line-web-billing-ui spec §4](mangmee-line-web-billing-ui-spec-th.md) (G13); ปลดล็อก shell ในที่ (re-read plan-term notice หลัง APPLIED) (G14); กลับจาก Stripe ด้วย cancel → หัวข้อ "ยังไม่ได้ชำระ" + ปุ่ม "เลือกแพ็กเกจใหม่" ที่ยุติรายการค้างให้ในกดเดียว (G12)
- ประวัติ/เอกสาร: ปุ่มส่งซ้ำ, "ข้อมูลบนใบไม่ถูกต้อง แก้ไข" (R-D3) พร้อมป้าย "ถูกแทนที่"
- แบนเนอร์ตีกลับ (R-A7); error ทุกรหัสเป็นไทย และแสดงข้อความจาก API เมื่อไม่มี mapping เฉพาะ (G09)
- Company picker: label ตาม lockReason (R-C5); การ์ดใกล้หมดอายุใน sidebar มีปุ่ม "ไปหน้าแพ็กเกจ" (G17); ลิงก์โควตาใบเสร็จในหน้าค่าใช้จ่ายชี้หน้าแพ็กเกจ (G18)
- 390px ไม่ล้น; touch target ≥ 44px

### LIFF / LINE
- LIFF: R-C2/C3; push: R-C4; การ์ดล็อก/โปรโมชั่น/ตอบคำสั่ง: R-B1/B2; ปุ่ม "ให้ทีมงานช่วยเลือก" → เปลี่ยนเป็น "ให้ทีมงานติดต่อกลับ" ที่สร้าง support request จริง (G19); การ์ดโปรโมชั่นแพ็กเกจธุรกิจใช้สรุปเมนูเดียวกับเว็บ (G20); FAQ ทดลองใช้ (G25) ถอด

### แอดมิน
- หน้าใบแจ้งหนี้ของบริษัท: 3 ปุ่ม (R-E1) + ประวัติการแก้เอกสาร; partner detail: สถานะ "ยังไม่มีแพ็กเกจ", คำเตือนต่ออายุ (R-C6), ฟอร์มแก้ไขข้อมูลบริษัทเพิ่มฟิลด์ (R-E3); หน้า `/system/billing`: ช่องค้นหาด้วยเลขอ้างอิง (R-E4); กล่องคำขอ: ปุ่ม "เปิดรายการ" (R-E5)

## 13. Bug / Gap / Impact Register

ระดับ **H** ทำให้ซื้อไม่ได้/ทางตัน · **M** สับสน/หลุดกติกา · **L** ความสม่ำเสมอ · ทุกข้อยืนยันจากโค้ด `origin/develop` ddcdcadf ยกเว้นที่ระบุ

| ID | เรื่อง | หลักฐาน | แก้ใน |
|---|---|---|---|
| G01 | LIFF หลังสมัครถือว่าร้านล็อก "เข้าไม่ได้" → "ร้านนี้ยังเข้าใช้ไม่ได้ กรุณาติดต่อทีมงาน" ไม่มีปุ่มซื้อ; fixture ยังจำลองร้านใหม่เป็น ACTIVE | `get-line-signup-status.use-case.ts:77`, `liff-page.security.ts:705-710`, `line-liff-signup.spec.ts:463-466` | P1 (H) |
| G02 | push หลังสมัคร "พร้อมใช้งานแล้ว/เริ่มใช้งาน" ขัดกับร้านที่ล็อก; ภาพวิธีใช้ไม่มีขั้นชำระ | `line-signup-notify.service.ts:366-370`, `public/assets/line/mangmeeplus-welcome-how-to-start-1080x1350.png` | P1 (H) |
| G03 | ปุ่มยืนยันตัวตนผ่าน LINE ในหน้าอีเมลไม่มี external-browser flag → ล้มเหลวในเบราว์เซอร์ของ LINE (อาการ UAT 2026-09-01) | `AccountEmailOtpPanel.tsx:82-86`, `line-in-app-browser.logic.ts:1-9` | P1 (H) |
| G04 | ลิงก์ในคำตอบ LINE ถูก wrap เป็น one-tap เฉพาะเมื่อ replay flag ปิด → การ์ดล็อก/ตอบขอเปลี่ยนแพ็กเกจเป็น URL ธรรมดา ชนหน้าล็อกอิน (ค่า flag บน production ยังไม่ยืนยัน) | `process-line-webhook.use-case.ts:3274-3280`, `:2181-2189` | P1 (H) |
| G05 | `/l/<token>` ไม่มี `openExternalBrowser=1` → เปิดในเบราว์เซอร์ของ LINE; ขัดมติเอกสาร "external browser as primary" | `line-handoff.logic.ts:78`, `line-stripe-browser-payment-reference-th.md:15` | P1 (H) |
| G06 | ปุ่มเลือกแพ็กเกจถูกปิดจนกว่าอีเมลบัญชี verified โดยไม่มีเหตุผลที่ปุ่ม; เงื่อนไขอีเมลโผล่เป็นบรรทัดเล็กในตัวเลือก ส่วนที่อยู่โผล่เป็นกล่องเหลืองบนหน้าแรก (สองที่ สองเวลา) | `BillingPage.tsx:326-338,441,505` | P2 (H) |
| G07 | detour ไปหน้าอีเมล/โปรไฟล์ไม่พากลับ (กล่องเหลือง, /renew) และ state ตัวเลือกหาย | `BillingPage.tsx:251,308-315,335`, `CompanyTermExpiredPage.tsx:98`, `account/email/page.tsx:24-27` | P2 (H) |
| G08 | ถามที่อยู่สองครั้ง (แอป + Stripe `billing_address_collection: 'required'`) | `billing.service.ts:721,726` | P2 (M) |
| G09 | 21 รหัสไม่มีข้อความไทย; BillingPage ทิ้งข้อความไทยจาก API แล้วแสดง "…ติดต่อทีมงานพร้อมเลขอ้างอิง"; mapping ตาย `BILLING_LEGACY_REVIEW_REQUIRED`; 2 ข้อความอธิบายผิดสถานการณ์ (42↔395, 40↔318) | `BillingPage.tsx:33-65`, `api-error-message.ts` | P5 (M) |
| G10 | quote หมดอายุ 10 นาทีเงียบ ๆ ปุ่มแค่จาง | `billing.service.ts:462`, `BillingPage.tsx:577` | P5 (M) |
| G11 | สร้าง Checkout session ไม่สำเร็จ → กลับหน้าแรกเงียบ ๆ | `billing.service.ts:736-751`, `BillingPage.tsx:580` | P5 (M) |
| G12 | กด back จาก Stripe → "กำลังตรวจสอบรายการชำระเงิน" และซื้อใหม่ไม่ได้จนยุติรายการ 2 ขั้นหรือรอ 30 นาที | `billing.service.ts:721-722,803`, `BillingPage.tsx:340,375-383` | P5 (M) |
| G13 | หน้า return รอผล ~32 วินาที แล้วให้กดเอง (PromptPay ข้ามแอปธนาคารอาจนานกว่า) | `BillingPage.tsx:196-205,385-393` | P5 (M) |
| G14 | locked shell ไม่ปลดในที่หลังจ่าย จนกว่าจะโหลดหน้าใหม่ | `WorkspaceLayout.tsx:83-89`, `PlanTermBanner.tsx:28-43` | P5 (M) |
| G15 | company picker แสดง "ครบกำหนดใช้งาน" กับร้านที่ไม่เคยมีแพ็กเกจ | `BillingCompanyPicker.tsx:24,27` | P1 (L) |
| G16 | error ที่มีคำว่า "อีเมล" กระโดดไปแท็บการต่ออายุซึ่งผู้ซื้อครั้งแรกไม่มีตัวควบคุมอีเมล | `BillingPage.tsx:123,407-410` | P2 (L) |
| G17 | การ์ดใกล้หมดอายุใน sidebar มีแต่โทร/อีเมล ไม่มีปุ่มจ่าย | `PlanTermSidebarCard.tsx:78-105` | P5 (L) |
| G18 | ลิงก์ "ขอเปลี่ยนแพ็กเกจ" ในหน้าค่าใช้จ่ายชี้ `/settings` ที่ไม่มีการ์ดแพ็กเกจ | `ExpensesPages.tsx:520-524`, `settings-menu.logic.ts:17-112` | P5 (L) |
| G19 | "ให้ทีมงานช่วยเลือก" ส่งลิงก์ให้ซื้อเอง ไม่ใช่คำขอเจ้าหน้าที่ | `line-staff-menu.logic.ts:321`, webhook `:2838-2845` | P1 (M) |
| G20 | LINE บอกแพ็กเกจธุรกิจ "ครบทุกเมนู…" เกินที่ให้จริง (starter + ภ.ง.ด.53/50 ทวิ) | `line-staff-menu.logic.ts:310`, `line-public-policy.logic.ts:16` vs `menu-entitlements.ts:491-500` | P1 (M) |
| G21 | คอนโซลแก้ข้อมูลบริษัทได้แค่ชื่อร้าน/อีเมลติดต่อ/เบอร์; ไม่มี label จาก lockReason (ร้านใหม่ = "ทดลองใช้ฟรี หมดอายุ"); ปุ่มต่ออายุให้วันฟรีโดยไม่เตือน | `update-partner-profile.use-case.ts:23`, `company-plan-term.use-cases.ts:247-330`, `PartnerDetailPage.tsx` | P1/P4 (M) |
| G22 | ไม่มีส่งเอกสารซ้ำ/เปลี่ยนผู้รับโดยแอดมิน/ออกใบใหม่/ค้นด้วยเลขอ้างอิง (lookup มีแค่ email/username) | `billing.controller.ts:65-200`, `lookup-users.use-case.ts:57-58` | P3/P4 (M) |
| G23 | ไม่มี e2e เส้นทางร้านใหม่จริง (fixture preview มี verified email + trial carryover; ไม่ผ่าน gate อีเมล/โปรไฟล์/reauth/return polling) | `billing-preview.fixture.ts:37,48`, `e2e/billing-preview.spec.ts` | P2/P6 (M) |
| G24 | ตัวเลือกโหมดจ่าย 4 แบบมาก่อนราคา; "สแกนบิลทุกงวด" อธิบายเฉพาะหน้ายืนยัน; รายปีไม่มีต่อเดือน; VAT บอกตอนสรุป | `BillingPage.tsx:472-480,497-498,535-542,568` | P5 (L) |
| G25 | FAQ ใน LINE ยังมีหัวข้อทดลองใช้ฟรี | `line-public-policy.logic.ts:10,24-34` | P1 (L) |
| G26 | LINE gate บน OWNER role, เว็บบน permission `company.plan.manage` (custom role ซื้อได้บนเว็บแต่ LINE ไม่ส่งการ์ด) | webhook `:1162-1164,2298,2814`, `billing.service.ts:117-120` | P1 (M) — R-C11 |
| G27 | สมมติฐาน Stripe ที่ต้องพิสูจน์ใน test mode ก่อน prod: Checkout ถามอีเมลเมื่อ Customer ไม่มีอีเมล และบันทึกลง Customer; `customer_update.address='auto'` บันทึกที่อยู่; `invoices/:id/send` กับใบที่จ่ายแล้ว; `receipt_email` ส่งใบเสร็จ; credit note `out_of_band_amount` + ใบใหม่ `paid_out_of_band` | Stripe docs (§3) | P2/P3 gate (H) |

## 14. Acceptance Criteria

- **AC1** ร้านใหม่ LINE-first (ไม่มีอีเมล/รหัสผ่าน/ที่อยู่) สมัครแล้วกด "เลือกแพ็กเกจ" จาก LIFF, จากการ์ดล็อก และจาก push → ถึงหน้าแพ็กเกจในเบราว์เซอร์นอก LINE โดยล็อกอินให้แล้ว ≤ 1 แตะ; ซื้อ STARTER รายเดือนด้วยบัตรและด้วย PromptPay (Stripe test mode) โดยไม่กรอกอะไรในแอป → APPLIED, LINE ตอบได้, ผู้รับเอกสาร = อีเมลที่พิมพ์ที่ Stripe, ที่อยู่ในโปรไฟล์ถูกเติม, อีเมลชำระสำเร็จส่งถึง
- **AC2** ร้าน `no_package` และร้านหมดอายุจริง เข้าได้เฉพาะ billing/settings/account/invoices บนเว็บ (เดิม) และทุก surface แสดง label ตาม lockReason ไม่มีคำว่า "ทดลองใช้"/"ติดต่อทีมงาน" เป็นทางหลัก; ไม่มีการกด "ต่ออายุ" ในคอนโซลในเส้นทาง AC1
- **AC3** ทุกลิงก์ที่ LINE ส่งออก (ตรวจด้วย test ครอบ builder ทั้งหมด) มี `openExternalBrowser=1` ยกเว้น LIFF/ลิงก์ภายนอก; การ์ดล็อกและตอบขอเปลี่ยนแพ็กเกจเป็น one-tap ทั้งเมื่อ replay flag เปิดและปิด; payload ที่บันทึกเพื่อ replay ยังเป็น URL ธรรมดา
- **AC4** อีเมลผิด: เปลี่ยนผู้รับ (OTP) + ส่งซ้ำ → Stripe ส่งใบเดิมและใบเสร็จไปอีเมลใหม่; อีเมลตีกลับ (Postmark bounce จำลอง) → แบนเนอร์ + LINE push 1 ครั้ง
- **AC5** ชื่อ/ที่อยู่ผิด: self-service reissue → ใบใหม่ยอดเท่าเดิม สถานะ paid (out of band), ใบเดิมมี credit note เต็มจำนวนไม่คืนเงินและป้าย "ถูกแทนที่"; สิทธิ์/term/receipt grants/renewalMode/`paidThrough` ไม่เปลี่ยน; ซื้อซ้ำ/ต่อท้ายรอบยังทำได้ (ไม่ตก review เพราะ credit note reissue); ครั้งที่สอง/เลยกำหนด/VAT ถูกปฏิเสธด้วยข้อความไทย + เลขอ้างอิง
- **AC6** แอดมิน: 3 ปุ่มบนหน้าใบแจ้งหนี้ทำงานผ่าน reviewed-op + self-confirm; แก้ไขข้อมูลบริษัทเพิ่มฟิลด์และ sync Stripe Customer; ค้นด้วยเลขอ้างอิงเปิดรายการถูกบริษัท; คำขอจากหน้า billing มีปุ่ม "เปิดรายการ"
- **AC7** รหัส error ทุกตัวในเส้นทางซื้อมีข้อความไทยทั้งสอง map; ไม่มี raw error; 390px ทุกหน้าใหม่/ที่แก้
- **AC8** ไม่มี diff ใน `paid-invoice.ts` / `paid-checkout-invoice.ts`; ไม่มี env/flag ใหม่; migration additive
- **AC9** ก่อน production: journey AC1 ผ่านบน UAT (Stripe test mode) ทั้งบัตรและ PromptPay จาก LINE จริง (iPhone + Android) และ AC5 บน UAT; หลัง production: ร้านใหม่จริง 1 ร้าน (ของ Owner) เดิน AC1 ภายในกรอบ acceptance ของ runbook

## 15. Test Cases (สรุป; รายละเอียดในแผน)

unit (label จาก lockReason; `withLineExternalBrowserParam` ทุก builder; quote/checkout gate ใหม่; Checkout params; sync-back mapping; reissue guards ใน refund-source/purchase-source/repeat; resend limiter; reissue window/once) · PG (provision no_package + LIFF status entryKind; apply → recipient captured + profile filled-if-blank; reissue op replay/idempotent/refund-before/after; bounce flag) · HTTP smoke ใหม่ `billing-no-setup-smoke.ts` (simulated Stripe: Checkout ไม่มี customer email, card + promptpay async, resend, reissue) · webhook LINE spec (การ์ดล็อก one-tap ทั้งสอง flag, push ใหม่, ลิงก์ external) · LIFF spec (fixture ร้านล็อก) · E2E playwright 1280/390: ร้านใหม่ LINE-simulated → locked shell → ซื้อ (fixture ใหม่ ไม่แก้ค่าเดิม) → return → ปลดล็อกในที่; admin invoice tools; reference lookup · Stripe test mode จริงบน UAT (G27)

## 16. Open Questions (Owner) — มีค่าเริ่มต้น ถ้าไม่ตอบใช้ค่าเริ่มต้น

| ID | คำถาม | ค่าเริ่มต้น |
|---|---|---|
| Q1 | ร้านที่โปรไฟล์มีที่อยู่ครบอยู่แล้ว ยังให้ Stripe ถามที่อยู่ (prefill) ไหม | ถาม (Stripe บังคับเมื่อ required) แต่ prefill จาก Customer จึงแค่กดผ่าน; ไม่ทำ conditional |
| Q2 | ชื่อบนเอกสาร | ชื่อจดทะเบียน หรือชื่อร้าน; ไม่ใช้ชื่อผู้ถือบัตรจาก Stripe |
| Q3 | หน้าต่าง self-service reissue | **ตัดสินแล้ว (D-PF-9): 30 วันนับจากวันที่ออกใบ**, 1 ครั้ง/ใบ |
| Q4 | ปุ่ม "ต่ออายุ" ในคอนโซลสำหรับร้าน no_package | คงไว้ + คำเตือน + เหตุผลบังคับ |
| Q5 | ร้านล็อกจาก LIFF/การ์ด ลงหน้าแพ็กเกจตรง (ข้าม /renew) | ใช่ |
| Q6 | LINE ส่งการ์ด/ลิงก์ให้ผู้มีสิทธิ์ `company.plan.manage` ที่ไม่ใช่ OWNER ด้วยไหม | **ตัดสินแล้ว (D-PF-10): รวม** — R-C11, G26 เข้า Phase 1 |

## 17. Rollout และความเสี่ยง

- ปล่อยเป็น **release เดียว** ตาม [runbook UAT→Production](../runbooks/uat-production-v2-deployment.md) (PR แยกตาม phase ในแผน แต่ deploy รวม); ไม่มี gate/flag ใหม่ — เมื่อ deploy กติกาใหม่มีผลทันที; gate การขายเดิมคงเดิม
- **ก่อน production ต้องผ่าน G27 บน UAT (Stripe test mode)**; acceptance บน production ทำภายใน ~5 นาทีหลัง website-ready (บทเรียน 2026-09-23)
- ความเสี่ยง: (1) reissue กระทบ evidence chain → R-D4 + PG tests; (2) พฤติกรรม Checkout เรื่องอีเมลล็อก → R-A2 (ไม่เติมอีเมลที่ไม่ verified); (3) เงื่อนไข replay flag → R-B2 ทางเลือกสอง; (4) เบราว์เซอร์ภายนอกบน iOS/Android ต่างกัน → ทดสอบเครื่องจริงทั้งสอง; (5) single-admin self-confirm สำหรับ op เอกสาร → reuse `billing-approval.ts`; (6) ลูกค้าพิมพ์อีเมลผิด → R-A7/A8/D1
- เอกสารที่ต้อง amend พร้อม PR: company-profile-gate spec (สถานะ superseded สำหรับการซื้อ), signup-optional-email-otp spec §5.2/§8 (gate การจ่ายถูกแทน), sales-deals spec D4/S16, line-web-billing-ui spec §2.2 (external browser), P29 §4B (label), LINE signup spec (LIFF copy), runbook rich menu (ไม่เปลี่ยน), master plan index

## 18. ผลตรวจจากโค้ดจริง (2026-09-27) — bug / gap / impact และการแก้สเปก

ตรวจโดย 6 audit บน `origin/develop` ddcdcadf (ครอบคลุม billing, auth/LIFF/handoff, line-ai, external-signup, system-partner-management, sales-console, notifications, workers, contracts, web, CI/pins/migrations/security docs) + ยืนยันพฤติกรรม Stripe จาก API reference ทางการ (Checkout `customer`/`customer_update`, invoice `effective_at`, `pay paid_out_of_band`, `invoices/:id/send`, charge `receipt_email`, credit note `out_of_band_amount`/`email_type`). **ข้อความใน §18.2 มีผลเหนือ §7/§9/§11 ที่ขัดกัน**

### 18.1 สรุปความเป็นไปได้

| ส่วน | ผล | สาเหตุหลัก |
|---|---|---|
| 7-A ซื้อโดยไม่ตั้งค่า | ทำได้ แต่ต้องแก้สเปก 9 ข้อ | ไม่มีคอลัมน์ผู้รับเอกสารใน DB (ผู้รับอยู่บน Stripe Customer เท่านั้น); DTO/controller บังคับ `billingEmail`; gate อีเมล/โปรไฟล์ซ่อนอยู่อีก ~10 จุด (checkout, repeat, portal, collection ops, Customer creation); การเขียนที่อยู่จาก Stripe ลงข้อมูลบริษัทผิดเส้นทาง legal identity; flow "เปลี่ยนผู้รับด้วย OTP ไปอีเมลใหม่" **ยังไม่มี** (flow เดิมสลับไปใช้อีเมลบัญชีที่ verified เท่านั้น) |
| 7-B ลิงก์ LINE | ทำได้ | ใส่ param ที่ "ทางออก" 3 จุดแทน builder ~40 จุด; R-B2 ต้องเป็นทาง (ข) mint ในเลนก่อนบันทึก (ทาง (ก) ทำให้ retry key ต่างกันและส่งซ้ำได้); R-B3 ต้องตัดทิ้ง (ลดความปลอดภัย); R-B5 ส่วนแรกมีอยู่แล้ว |
| 7-C สถานะยังไม่มีแพ็กเกจ | ทำได้ | `lockReason` มีแค่ 2 ค่า (ไม่มี `expired`); ห้ามเปลี่ยนความหมาย `canEnter` (กระทบ FIRST_SHOP signup) ให้เพิ่มฟิลด์แสดงผลแทน; push หลังสมัครต้องคงเป็นลิงก์ LIFF (กฎ LINE-ONBOARD-01) = 2 แตะ; หน้าเว็บ landing ของร้านล็อกทำงานอยู่แล้ว; จุด render "ทดลองใช้" มี 10+ จุด; คอนโซลแช่แข็งการแก้ข้อมูลร้าน DISABLED ต้องปลดสำหรับร้านล็อก |
| 7-D แก้เอกสาร | ส่งซ้ำ + เปลี่ยนผู้รับ (flow ใหม่) ทำได้ · **ออกใบใหม่แทนใบเดิม: พักไว้ทำเป็นสเปกแยก** | ใบลดหนี้เต็มจำนวนทำให้ **คืนเงินใบนั้นไม่ได้อีก** และยุติแพ็กเกจหลังคืนเงินทำไม่ได้; แถวใบใหม่ทำให้ restart หลังหมดอายุติด review ถาวร; แก้ชื่อ/ที่อยู่ = แก้ legal identity ที่มีสิทธิ์/เวอร์ชัน/หน้าต่างเวลาแยก; pending invoice items อาจไหลไปบิลต่ออายุ (เก็บเงินซ้ำ); เอกสารใบใหม่เปิดไม่ได้ในหน้าเดิม (ไม่มี charge); op slot เดิมชนกับ reconciler — งานใหญ่กว่าที่ประเมินและมีความเสี่ยงต่อสิทธิ์ที่จ่ายแล้ว |
| 7-E แอดมิน | ทำได้ ยกเว้น web support request | ไม่มี model/endpoint คำขอเจ้าหน้าที่ฝั่งเว็บ (`LineSupportRequest.lineUserId` NOT NULL); แก้ข้อมูลบริษัทต้องผ่าน use case legal identity เดิม (ไม่ใช่ partner profile) และต้องปลดล็อกร้าน DISABLED-by-term; lookup ต้องค้นด้วย "เลขอ้างอิง 8 ตัวท้าย" ที่ลูกค้าเห็นจริง |
| ข้ามระบบ | ทำได้ มีเงื่อนไข | maintenance pins **stale อยู่แล้วบน develop** (commit 48c4ab57 แก้ `auth.guard.ts` โดยไม่ sync) → PR แรกต้อง sync pins; spec ใหม่ทุกไฟล์ต้องลงทะเบียนใน catalog/ci.yml/extended-tests (ไม่ต้องแตะ package.json); `ci.yml` ต้องตรงกับ main ก่อน UAT all; PG/smoke/e2e รันเฉพาะ Extended Tests (manual) |

### 18.2 การแก้กติกา (มีผลเหนือ §7/§9/§11)

**7-A**
- **R-A1/R-A5/R-A6 (แก้)** ถอด email proof ทุกจุด: `billing.service.ts:301,529-530,620-621,675-676`, `billing-repeat.ts:207-208`; ถอด/ลดการเทียบอีเมล Customer กับ account email: `billing.service.ts:332-336,633-635,683-687`, `billing-repeat.ts:281` → เหลือเพียง "ผู้รับเปลี่ยนตั้งแต่ quote → `BILLING_QUOTE_STALE`"; `BILLING_RECIPIENT_UPDATE_REQUIRED` ไม่มีแหล่งอีก (คงข้อความ 1 release); profile gate: `requireBillingProfile` ที่ checkout `:550,:659` และ `billing-repeat.ts:209` เปลี่ยนเป็น compare แบบไม่โยน (ต่างจาก snapshot → `BILLING_QUOTE_STALE`); DTO `billing.dto.ts:94` + controller `:538` + contracts `billing.ts:127` → `billingEmail` optional/nullable (คง key ไว้; client เก่ายังส่งได้); **portal (`:922-929`) และ collection ops RESUME_RENEWAL/CANCEL_DOWNGRADE (`billing-collection.ts:24,75,164,262-263`) เลิกบังคับ verified account email** (DQ2 ค่าเริ่มต้น = เลิก); การสร้าง Stripe Customer (`:615-632`) ต้องทำได้เมื่อไม่มีอีเมล
- **R-A2 (แก้)** payload sync Customer ชุดเดียวใช้ทั้ง 3 จุด (`billing.service.ts:636-648`, `billing-repeat.ts:240,283`, reconciler `:63-71`; idempotency key `mm:<attempt>:billing-profile` ต้องได้ payload เดิม): `name` เสมอ; `address` เฉพาะเมื่อโปรไฟล์ครบ 5 ช่อง (ห้ามส่งช่องว่างทับที่อยู่ที่ Stripe เก็บจาก Checkout); `email` เฉพาะ verified account email หรือผู้รับปัจจุบัน (ไม่มี → ไม่ตั้ง)
- **R-A3 (แก้)** `customer_update: { address: profileComplete ? 'never' : 'auto' }` (Stripe prefill ที่อยู่จาก **บัตรที่บันทึกล่าสุด** ไม่ใช่จาก Customer.address; `'auto'` จะทับที่อยู่ที่ sync ไว้) ทั้ง 3 จุดสร้าง session (`:711-722`, `:723-729`, `billing-repeat.ts:289-295` — จุดหลังมี journal hash ของ params → deploy เมื่อไม่มี repeat attempt ค้าง); เพิ่ม `&checkout=canceled` ใน `cancel_url` (G12)
- **R-A4 (แทนที่ทั้งข้อ)** (ก) ผู้รับเอกสาร: อ่าน Customer **ก่อน** transaction ภายใต้ account lease (กฎห้ามเรียก provider ใน transaction) แล้วเขียน `BillingAccount.recipientEmail` แบบ "เฉพาะเมื่อยังว่าง" หลัง upsert invoice; `recipientSource = STRIPE_CHECKOUT` เฉพาะเมื่อ snapshot ไม่มีอีเมล; ใช้กับ apply ทั้ง 4 ทาง (one-time `:468-687`, advance-deal `:690-749/919-1014`, `applyInvoice :1251-1405`, repeat apply `billing-repeat.ts:471-542`; admin apply held `:437-466` เขียนเฉพาะเมื่อว่าง) — (ข) ที่อยู่: **ห้ามเขียนลงข้อมูลบริษัท** (legal identity มีเส้นทางเดียว `company-identity.use-case.ts:214-342` ต้องครบ 5 ช่อง มี revision/สิทธิ์ `company.legal_identity.manage` และถูกใช้ออก 50 ทวิ/ยื่นภาษี/จับคู่ผู้ซื้อ) → เก็บที่อยู่ที่ Stripe รวบรวมไว้เป็น snapshot เอกสาร `BillingAccount.checkoutAddressJson` และหน้าข้อมูลร้านเสนอปุ่ม "ใช้ที่อยู่จากการชำระเงิน" ที่เขียนผ่าน use case identity ด้วย change kind ปกติ (DQ5)
- **R-A7 (แก้)** อีเมลชำระสำเร็จ: outbox key ใหม่ "document-recipient notice" อ่านจากคอลัมน์ผู้รับ (ไม่ผูก OWNER user: `billing-notifications.service.ts:225-228,248-289`; `recipientUserId` เป็น nullable ใน contracts `billing.ts:319` + admin monitor join `system-email-delivery.service.ts:96-103`); การตีกลับ: **ห้าม** auth เรียก billing (module วน) → billing worker อ่าน `EmailSendAttempt` ที่ SUPPRESSED ผ่าน `intentKey 'billing-notice:<outboxId>'` แล้วตั้งธง; LINE push ไปผู้มี `company.plan.manage` ใช้ trigger เดิม (`billing.package_updated`) ไม่เพิ่ม key ใหม่ (key ใหม่ถูก preference เดิมบล็อก); Postmark stream แยกสำหรับอีเมลผู้รับ (DQ6); UAT: `POSTMARK_UAT_ALLOWED_RECIPIENTS` ปฏิเสธอีเมลที่พิมพ์ที่ Checkout → แผนทดสอบใช้อีเมลใน allowlist
- **R-A8 + R-D2 (แทนที่)** ทำ **flow เปลี่ยนผู้รับเอกสารแบบใหม่ (company-scoped)**: กรอกอีเมลใหม่ → OTP ไปอีเมลนั้น (ใช้ challenge/HMAC/limit ของ account-email OTP เดิม แต่ purpose `billing_recipient` ผูก companyId) → ยืนยัน → operation `UPDATE_BILLING_EMAIL` แบบใหม่ที่ถือ recipient proof (worker ไม่ assert account email) → อัปเดต Stripe Customer email (journaled) → แจ้งผู้รับเดิม + LINE; แสดงอีเมลบนหน้า return ตั้งแต่ PAID; ปุ่มแก้เปิดเมื่อ APPLIED (op เดิม `billing-email-recipient.ts:69` ปฏิเสธขณะ attempt ยัง active); ส่งเอกสารซ้ำได้หลัง op COMPLETED; ผู้ที่มี verified account email ยังเลือก "ใช้อีเมลบัญชี" ได้ (flow เดิม)
- **R-A9/R-A11 (แก้)** คง `billing-profile-navigation.ts` (หน้าโปรไฟล์และลิงก์ในหน้ายืนยันใช้; `ci.yml:545` ตั้งชื่อ spec ของมัน) ถอดเฉพาะ `BillingPage.tsx:78,212-216,250-251,308-315,326-338`; gate ฝั่งเว็บที่ต้องถอดทั้งหมด `:102,116,144,147,239,257,422,438,441,467,505,508,543,577` + `CompanyTermExpiredPage.tsx:98` + `account/email/page.tsx:25`; quote `billingEmail` nullable = "อีเมลที่จะกรอกที่หน้าชำระเงิน"; ไม่เพิ่ม `documentProfile` (ใช้ `billingProfile.missingFields` เดิม); เมื่อมี Customer แล้วแสดง "แก้อีเมลรับเอกสาร" ในหน้ายืนยัน
- **R-A10 (แก้)** `assertBillingProfileUnchanged` ไม่โยน PROFILE_REQUIRED อีก (รวม repeat)

**7-B**
- **R-B1 (แก้)** เติม `openExternalBrowser=1` ที่ **ทางออกของข้อความ** 3 จุดเท่านั้น: `line-reply.adapter.ts:22-29` (`providerMessages`), `system-line-push.ts:43-51`, `notification.use-cases.ts:781-806` — ไม่ใส่ใน builder (จะเปลี่ยน binding hash ของ billing notification `billing-notifications.service.ts:85,368-372` → `LINE_BINDING_CHANGED` และพัง label check `notification.use-cases.ts:735-736`); ทำหลังคำนวณ retry key; parse ด้วย `URL` เก็บ `#fragment`; นับความยาว 5000; ตอน mint handoff ให้ตัด param ออกจาก target (`line-handoff-link.service.ts:118-120`, `sales-deal.logic.ts:220`); `/l/[token]` เพิ่ม `HEAD` → 204 และส่งต่อ client IP (`forwardedClientHeaders()`) เพื่อไม่ให้ทุก exchange ใช้ limiter เดียว (20/60 วิ) จนตกไป `/login` ไม่มี `next`; ยกเว้น LIFF/เว็บ official/tel/กล้อง; ภาพต้อนรับไม่แตะ
- **R-B2 (ตัดสิน = ทาง (ข))** mint ในเลนก่อนบันทึก แบบเดียวกับการ์ดโปรโมชั่น (`:2312`), บริษัทของฉัน (`:5800,:5850`), ledger drain: `replyIfCompanyLocked` (`:2185-2192`) mint ก่อนสร้างการ์ด (`surface: 'locked_card_packages'`), `buildPackageRequiredMessage` รับ `packageUrl` (ต้องขึ้นต้น web base + `/l/`) ไม่งั้น fallback URL ธรรมดา; `handlePackageChangeRequest` (`:2841-2846`) เช่นกัน (`surface: 'package_change_reply'`); **ห้าม mint ในกลุ่ม/ห้อง** (`isLineGroupChatKey(pushTargetId)` → URL ธรรมดา+param หรือลิงก์ LIFF); ไม่แตะเงื่อนไข `:3274` และ `linePushRetryKey`; เหตุผลที่ทาง (ก) ใช้ไม่ได้: retry key = SHA-256 ของ payload ที่บันทึก (`line-reply.adapter.ts:87-94`) และ replay ส่ง bytes ที่บันทึก — payload ต่างกัน = LINE dedupe ไม่ได้ = ส่งซ้ำ (`receipt-reliability-remediation-verification-2026-09-07.md:55`, `schema.prisma:1801`); **AC3 แก้เป็น "payload ที่บันทึก = payload ที่ส่ง"**; amend line-web-billing-ui spec §2.2.1 (token ในแชตของเลนเหล่านี้มีอยู่แล้วและไม่ถูก replay เพราะไม่มี read/access proof)
- **R-B3 (ตัดทิ้ง)** ลิงก์ในแชตส่งต่อได้/แลกในกลุ่มได้ ไม่ใช่ fresh reauth (ขัด signup-optional spec §6 nonce/purpose ≤5 นาที); D-PF-1 ทำให้ไม่จำเป็น
- **R-B4 (แก้)** ในเบราว์เซอร์ของ LINE ไม่ส่ง reauth ออกนอก (เบราว์เซอร์นอกไม่มี session → `/login` เปล่า) แต่แสดง "เปิดหน้านี้ใน Safari/Chrome" (reopen หน้าปัจจุบันด้วย `openExternalBrowser=1`) ก่อนเริ่ม reauth; start route redirect ไป `/login?next=<returnTo>` เมื่อไม่มี session
- **R-B5 (แก้ + ขยาย "ไม่ต้องล็อกอินซ้ำ")** ส่วนแรกมีอยู่แล้ว (`app/login/page.tsx:37-46`, `session-gate.logic.ts:97-124` — ไฟล์ pinned ห้ามแตะ); เพิ่ม: (1) เมื่อมาถึงหน้าล็อกอินจากลิงก์ LINE (`line=handoff-expired` หรือ `next` มี `channel=line`) และ**ไม่มี** session → **เริ่ม LINE login ให้ทันที** (redirect ไป start route พร้อม `next`) โดยไม่แสดงฟอร์มรหัสผ่าน; ผู้ที่เคยยินยอมแล้ว LINE จะส่งกลับโดยไม่ต้องกดอะไร (ยกเว้นหน้ายินยอมครั้งแรก); ทำใน `LoginPage.tsx` (ไม่ pinned) ไม่แตะ `app/login/page.tsx`; (2) หน้าล็อกอินเมื่อ `next` มี `channel=line` ให้ปุ่ม "เข้าสู่ระบบด้วย LINE" เป็นปุ่มหลักบนสุด ฟอร์มรหัสผ่านพับไว้; (3) copy `LoginPage.tsx:41` เปลี่ยนเป็น "ลิงก์นี้หมดอายุแล้ว กำลังเข้าสู่ระบบด้วย LINE ให้…"; (4) log เหตุการณ์ `login_wall_from_line_link` (มี/ไม่มี session, เหตุผล) เพื่อวัดหลัง release ว่าหน้าล็อกอินโผล่บ่อยแค่ไหน

**7-C**
- **R-C1 (แก้)** `lockReason` = `no_package` | `trial_ended` เท่านั้น (`plan-term.ts:14`; `plan-term.logic.ts:74-80`); `trial_ended` = "เคยมี term จริง" (ทดลอง/ต่ออายุโดยแอดมิน/จ่ายแล้วหมด/ยุติหลังคืนเงิน) → label "หมดอายุ"; ไม่เพิ่มค่าที่สาม; นิยาม "ล็อก" = term หมด (`termEndsAt <= now`) และไม่ใช่ admin hold (`termDisabledAt` ว่าง) ตาม `resolveLineHandoffTarget`
- **R-C2 (แก้)** **คง `canEnter` เดิม** (เปลี่ยนแล้วกระทบ FIRST_SHOP/RETURN_EXISTING `submit-line-signup.use-case.ts:144-147`); เพิ่ม `lockReason` + `canManagePlan` (optional) ใน DTO เพื่อแสดงผล; หน้า COMPLETED + ล็อก + `canManagePlan` → หัวข้อ "เปิดร้านแล้ว ขั้นต่อไปเลือกแพ็กเกจ" + ปุ่ม "เลือกแพ็กเกจ" ที่ **เตรียม handoff ตอน render** (จึงเป็น 1 แตะ; GW02 ห้ามเปิดอัตโนมัติเท่านั้น) ผ่าน `liff/session` เดิม; ไม่มีสิทธิ์ → ข้อความพนักงาน; billing `disabled`/`new_sales` ปิด → copy ติดต่อทีมงานเดิม (P29 §3); label รายการร้านสั้น (ปุ่มจำกัดความยาว) ใส่สถานะในเนื้อความ
- **R-C3 (แก้)** ทำใน `exchange-liff-session.use-case.ts:122-125` (`destination()`) แบบ permission-aware: ผู้มี plan.manage → `/companies/:id/billing`; อื่น → `/renew`; ไม่แก้ fallback ใน `line-handoff.logic.ts:147-149`; `needsSelection` แนบ lock info
- **R-C4 (แก้)** push หลังสมัคร **คงเป็นลิงก์ LIFF** (LINE-ONBOARD-01: ไม่มี token ส่วนตัวใน push; token 15 นาทีตายก่อนกด; push retry ได้ถึง 6 ชม.) เปลี่ยนแค่หัวข้อ "เปิดร้านแล้ว" + ปุ่ม "เลือกแพ็กเกจ" ทั้งสองแบบ (`line-signup-notify.service.ts:56-58,352-374`) → LIFF start เตรียมลิงก์อัตโนมัติ → "เปิดหน้าเว็บ" = **2 แตะจาก push** (AC1 แก้); ภาพวิธีใช้ (ส่งตอน follow `:240-252,:2226-2230`) ถอดจนกว่าจะมีไฟล์ใหม่ชื่อใหม่ (cache + Release Contracts)
- **R-C5 (คง)** landing หลัง LINE login ทำงานแล้ว (callback → `/` → `/login` → `/auth/me` allowlisted → resolver เลือกร้าน DISABLED+termDisabledAt → locked shell → `/renew`); เพิ่ม `lockReason` ใน `/auth/me/companies` (`auth.controller.ts:1094-1105`) เพื่อ picker/switcher
- **R-C6 (แก้)** เหตุผลบังคับมีอยู่แล้ว; เพิ่มคำเตือนที่ระบุผลข้างเคียงจริง: ต่ออายุร้าน `no_package` = เปิดทดลองใช้ (15 ใบ AI/เดือน, เครดิตแชตเริ่มต้น, เมนู starter, ยกยอด ≤15 ใบตอนซื้อครั้งแรก, copy "ช่วงทดลอง"); partner list เลือก `planTerm` เพิ่มฟิลด์; ปุ่ม "เปิดใช้งานบริษัท" สำหรับร้าน term-disabled ต้องเตือน/ซ่อน (sweep จะปิดกลับใน 5 นาที); อนุมัติคำขอเปลี่ยนแพ็กเกจของร้านล็อกต้องบล็อกหรือพ่วงต่ออายุ (มิฉะนั้น LINE บอก "เปลี่ยนแล้ว" แต่ยังล็อก)
- **R-C7 (แก้)** ย้าย `planTermLockReason` + `accessStateOf` (sales-console) ไป contracts `plan-term.ts` (ไม่ใช่ `line-ai.ts`); เพิ่มฟิลด์ optional ใน 4 responses (`/auth/me/companies`, `CompanyPlanTermDto`, `PartnerCompanySummaryDto`, package-change queue); จุด render ที่ต้องแก้: picker, switcher `WorkspaceScope.tsx:327-331`, `BillingPage.tsx:341-347`, LIFF `:660`, `PartnerDetailPage.tsx:2563-2589,3089,3091`, `PartnerListPage.tsx:130`, `BillingCompanyDirectory.tsx:18,65,74`, `BillingCompanyOverview.tsx:31,37`, `SalesConsoleParts.tsx:56-58`, `SignupQueuePage.tsx:772`, `get-partner-timeline.use-case.ts:161`
- **R-C10 (คง)** ทำแล้วและมี test; แผนเหลือ PG test provisioning→sweep
- **R-C11 (แก้)** helper ใหม่ใน access-control (`planManagerRoleFilter`, `planManagersOf`, `planManagerLineUserIds`, `canManagePlan`) ใช้ใน `assertOwner` ด้วย; call sites: webhook `:1707,:2301+5741-5753,:2817`, `plan-term-sweep.use-case.ts:177-180`, `billing-notifications.service.ts:225-228` (แยกผู้รับ LINE กับอีเมล), `sales-deals.service.ts:524` (ฟังก์ชันใหม่ **ไม่แตะ** `ownerLineUserIds` ที่ใช้ตอบ support), `account/email/page.tsx:23`; คง OWNER สำหรับ "เปิดร้านเพิ่ม" (`:5842`); ไม่ cache

**7-D / 7-E**
- **R-D1 (แก้)** เป็นคำสั่ง synchronous ภายใต้ account lease (ไม่ใช่ durable op); limiter: inspect → Stripe → consume; ใบเสร็จส่งซ้ำได้เฉพาะเมื่ออีเมลเปลี่ยน (`receipt_email` ส่งเมื่อค่าเปลี่ยน) ไม่งั้นให้ลิงก์; **test mode ไม่ส่งอีเมล** (มีแต่ `invoice.sent`) → พิสูจน์บน production ด้วยการซื้อทดสอบของ Owner; error Stripe ถูกยุบเป็น REJECTED/UNKNOWN/RETRY → ข้อความไทยตามผลลัพธ์
- **R-D3/R-D4/R-D5/R-D7 (พักไว้ — DQ1)** ย้ายไปสเปกแยก "ออกใบใหม่แทนใบเดิม" ซึ่งต้องตอบให้ครบ: (1) เส้นทางคืนเงินหลังออกใบใหม่ (refund ตรงที่ charge + ใบลดหนี้ out-of-band บนใบใหม่ หรือบล็อกพร้อม runbook); (2) เก็บใบใหม่ในตารางแยกหรือ `kind` + กรองใน reader ทุกตัว (restart `billing-restart.ts:30-46`, status `:784`, admin retry queue, repeat, scans, settlements, history/export/timeline); (3) แก้ชื่อ/ที่อยู่ผ่าน `CompanyIdentityUseCase` ด้วยสิทธิ์ `company.legal_identity.manage` (ไม่ใช่ plan.manage) และเคารพหน้าต่างเวลา/LEGAL_CHANGE; (4) ลำดับ Stripe: draft (`pending_invoice_items_behavior: exclude`, `auto_advance:false`) → items ผูก invoice → finalize → pay out-of-band → send; credit note `lines` เดิม + `out_of_band_amount` + `email_type:'none'`; ห้ามมี `credit_amount`; ห้ามคัดลอก charge/subscription/attempt ลงแถวใหม่; (5) op อิสระแบบ REFUND (drain ของตัวเอง, lease ต่อขั้น) ไม่ใช้ email/collection slot และ**ไม่แตะ** `billing-schedule.ts`; (6) หน้าเอกสารแบบใหม่ (ไม่มี charge → ไม่มีใบเสร็จ); (7) mutual exclusion กับ attempt/collection/refund/recipient ops; (8) G27 เพิ่ม `effective_at` ย้อนหลัง, `th_vat`, PDF/`amount_paid` ของ out-of-band; ระหว่างรอ: runbook แอดมินทำมือใน Stripe Dashboard พร้อมกติกา "ถ้าอาจต้องคืนเงิน ให้คืนเงินก่อนออกใบใหม่"; ลูกค้าแก้ชื่อ/ที่อยู่ **สำหรับใบถัดไป** ได้ที่ข้อมูลร้าน (มีอยู่แล้ว)
- **R-D6 (คง สำหรับสเปกแยก)** fail closed เว้นแต่ policy ปัจจุบัน **และ** snapshot ของใบเดิมเป็น NOT_VAT_REGISTERED, `taxSatang = 0`, `total_taxes` ว่าง
- **R-E1 (แก้)** รอบนี้ 2 ปุ่ม: ส่งเอกสารซ้ำ, เปลี่ยนอีเมลผู้รับ (reviewed op + password proof + self-confirm; แจ้งผู้รับเดิม — R-E2 เป็น social-engineering target); ออกใบใหม่ตามสเปกแยก; R-E2 ต้องมาหลัง R-A5 (มิฉะนั้นทุกการซื้อพัง `RECIPIENT_UPDATE_REQUIRED`)
- **R-E3 (แก้)** แก้ผ่าน `CompanyIdentityUseCase` (export จาก DataModelCoreModule; ระบุ change kind; audit CRITICAL เดิม) ไม่ใช่ `update-partner-profile`; ปลด `partnerMetadataLockError` สำหรับร้าน DISABLED+termDisabledAt (คงสำหรับ admin hold/ARCHIVED); เพิ่ม route address-master สำหรับ partner (ของเดิมต้อง `sales.*`); Customer sync เป็นคำสั่ง journaled
- **R-E4 (แก้)** เลขอ้างอิงที่ลูกค้าเห็น = 8 ตัวท้ายของ invoice/attempt id (`billing-display.ts:33-39`) → ค้นแบบ suffix (รวม op/issue id) ใน `BillingAdminService`; นอก scope → 404 เปล่า; index ตามต้องการ
- **R-E5 (แก้)** ฝั่ง LINE: คำขอที่เริ่มจากการ์ด/ข้อความ billing แนบ `referenceKind/referenceId` บนแถวเดิม (1 คำขอ live ต่อ LINE user; companyId ของร้านล็อกเป็น null → derive จาก reference); ฝั่งเว็บ: **ไม่มี model** → ใช้ `POST /companies/:id/package-change-requests` เดิม (allowlisted + plan-manager gated) เป็น "ขอความช่วยเหลือเรื่องแพ็กเกจ" พร้อม reference หรือเลื่อน (DQ4); เลขอ้างอิงแสดงเฉพาะ staff (line-support-request spec :15)
- **R-E6 (แก้)** ใช้ `system.billing.override.manage` สำหรับส่งซ้ำ/เปลี่ยนผู้รับ และ amend billing-controls spec (:113,223) + single-admin spec (:14) ให้ระบุ 2 op ใหม่; scoped operator ต้องมี reviewer คนที่สอง (self-confirm เฉพาะ platform scope)
- **§9 (แทนที่)** additive: `BillingAccount.recipientEmail` (index), `recipientSource` (`ACCOUNT_EMAIL` legacy/`CUSTOMER_OTP`/`STRIPE_CHECKOUT`/`ADMIN`), `recipientBouncedAt`, `recipientBounceNotifiedAt`, `checkoutAddressJson`; backfill `recipientEmail` จาก Stripe Customer (script อ่านอย่างเดียว); `LineSupportRequest.referenceKind/referenceId`; **ไม่มี** การเปลี่ยน `BillingInvoice` ในรอบนี้; DTO ฟิลด์ใหม่ทุกตัว optional (preview fixture เป็น literal เต็ม); ไม่มี enum ใหม่ (billing ใช้ String)
- **§11 (แก้)** ตัด endpoint reissue; เพิ่ม `POST .../billing/recipient/otp/request|confirm` (flow ใหม่), `POST .../billing/documents/:invoiceId/resend`; ทุก route ใหม่ต้องเข้า allowlist ร้านล็อก (`auth.guard.ts:98-104` — ไฟล์ pinned) และ `isBillingCustomerRecoveryPath` ไม่ต้องเปลี่ยนถ้า UI อยู่ใน `/billing/invoices/:id`; body ใหม่ต้องมี class DTO (`forbidNonWhitelisted`)
- **§12 error (แก้)** ห้ามแสดงข้อความดิบจาก API (นโยบาย fail-closed `no-raw-api-error-display.spec.ts`) → ทำ mapping ไทยครบทุกรหัส (21 + 5 ที่มีเฉพาะ `api-error-message.ts`) และเพิ่ม test ที่ไล่ `billingError('X')` ทุกตัว
- **AC1 (แก้)** จากการ์ดล็อก/หน้าผลลัพธ์ LIFF = 1 แตะ; จาก push หลังสมัคร = 2 แตะ (LIFF); AC1 ถือเฉพาะผู้ซื้อที่ไม่มี verified account email (ถ้ามี Stripe จะ prefill และล็อกอีเมลนั้น)
- **AC10 (ใหม่ — "ไม่ต้องล็อกอินซ้ำ")** บนเครื่องจริง iPhone และ Android: (ก) แตะการ์ดล็อกครั้งแรก → Safari/Chrome เปิดหน้าแพ็กเกจโดยไม่มีหน้าล็อกอิน; (ข) ปิดเบราว์เซอร์ รอเกิน 15 นาที แตะการ์ดเดิมซ้ำ → เข้าหน้าแพ็กเกจโดยไม่มีหน้าล็อกอิน (session เดิม); (ค) ลบ cookie แล้วแตะการ์ดเดิม (ลิงก์หมดอายุ) → เห็นเฉพาะการเด้งไป LINE แล้วกลับมาหน้าแพ็กเกจ ไม่มีฟอร์มรหัสผ่าน; (ง) ลิงก์ในกลุ่มเป็นลิงก์ธรรมดาและใช้ session ของเครื่องได้

### 18.3 ทะเบียนผลตรวจ (RV) — สรุปข้อ H/M ที่เปลี่ยนแผน (ข้อ L อยู่ในบันทึกงาน)

| ID | ระดับ | เรื่อง | หลักฐาน | แก้ใน |
|---|---|---|---|---|
| RV01 | H | ไม่มีคอลัมน์ผู้รับเอกสาร; ผู้รับ = Stripe Customer.email เท่านั้น | `schema.prisma:9653-9689`, `billing-email-recipient.ts:47-56` | §9 |
| RV02 | H | เขียนที่อยู่จาก Stripe ลง Company ผิดเส้นทาง legal identity (5 ช่องบังคับ, revision, ใช้ออก 50 ทวิ) | `company-identity.use-case.ts:214-342`, `company-legal-identity.logic.ts:105-110`, `create-wht-certificate.use-case.ts:98`, `buyer-as-printed.logic.ts:125,153` | R-A4 |
| RV03 | H | gate อีเมล/โปรไฟล์ซ่อนที่ checkout/repeat/portal/collection/Customer creation; DTO บังคับ `billingEmail` | `billing.service.ts:529-530,550,615-632,620-621,659,675-676,922-929`, `billing-repeat.ts:203-213,239-243,281-286`, `billing-collection.ts:24,75,164,262-263`, `billing.dto.ts:94`, `billing.controller.ts:538` | R-A1 |
| RV04 | H | flow เปลี่ยนผู้รับเดิมสลับไปใช้ account email ที่ verified เท่านั้น; ไม่มี OTP ไปอีเมลผู้รับใหม่; Stripe ล็อกอีเมลที่ Customer มีอยู่ตอน Checkout | `billing-email-recipient.ts:57-76,149`, `billing.controller.ts:487`, `BillingEmailRecipientPanel.tsx:41-50` | R-A8/R-D2 |
| RV05 | H | เว็บส่ง `billingEmail ''` → 400 สองชั้น; ปุ่มปิดด้วย regex อีเมล | `BillingPage.tsx:100,467,505` | R-A9 |
| RV06 | H | อีเมลชำระสำเร็จผูก OWNER user ที่ verified; auth→billing = module cycle; UAT allowlist ปฏิเสธอีเมลที่พิมพ์ | `billing-notifications.service.ts:225-289`, `billing.module.ts:11,27`, `packages/config/src/index.ts:386` | R-A7 |
| RV07 | H | R-B2 ทาง (ก) ทำให้ retry key/replay bytes ต่างกัน → ส่งซ้ำ; ทาง (ข) ตรงกับ pattern เดิม | `line-reply.adapter.ts:87-94`, `recover-orphan-line-events.use-case.ts:298-301`, doc 2026-09-07:55 | R-B2 |
| RV08 | H | token ในกลุ่มแลกได้โดยสมาชิกคนใดก็ได้ → ได้ session เจ้าของ | `exchange-line-handoff-token.use-case.ts:79-92`, `line-webhook.controller.ts:78` | R-B2 (ห้าม mint ในกลุ่ม) |
| RV09 | H | R-B3 นับ handoff เป็น reauth = ลดความปลอดภัยการเปลี่ยนอีเมล | `line-login-bff.logic.ts:40`, `account-email-reauth.service.ts:49-51` | ตัด R-B3 |
| RV10 | H | เปลี่ยน `canEnter` กระทบ FIRST_SHOP/RETURN_EXISTING | `submit-line-signup.use-case.ts:144-147`, `external-signup.ts:370-373` | R-C2 |
| RV11 | H | push ด้วย token ตายก่อนกด (15 นาที; retry ถึง 6 ชม.); ขัด LINE-ONBOARD-01 | `mint-line-handoff-token.use-case.ts:41`, `system-line-push.ts:16`, `line-signup-notify.service.ts:352-374` | R-C4 |
| RV12 | H | maintenance pins stale บน develop (auth.guard.ts แก้โดยไม่ sync) → CI แดงทุก PR โค้ด | `validate-production-maintenance-release.sh:25,106`, commit 48c4ab57 | แผน Phase 1 task 0 |
| RV13 | H | spec ใหม่ไม่ลงทะเบียน → CI แดง/ไม่รัน; PG/smoke/e2e รันเฉพาะ Extended Tests | `spec-suite-coverage.spec.ts:43-75`, catalog `:342-427`, `extended-tests.yml:3-5` | แผน "การลงทะเบียนเทสต์" |
| RV14 | H | ออกใบใหม่ → คืนเงินใบนั้นไม่ได้อีก; restart ติด review ถาวร; สิทธิ์ legal identity; pending items ไหลไปบิลต่ออายุ; เอกสารใหม่เปิดไม่ได้; op slot ชน reconciler | `billing-refund-source.ts:55-70,133-134`, `billing-restart.ts:30-46`, `billing.service.ts:102-121` vs `company-identity.controller.ts:68-69`, `paid-invoice.ts:21-29`, `BillingAdjustmentsPage.tsx:29-81`, reconciler `:214-229` | พัก R-D3 (DQ1) |
| RV15 | H | ไม่มี web support-request model; `lineUserId` NOT NULL | `schema.prisma:4143-4230`, `liff-page.security.ts:967-976` | R-E5 |
| RV16 | M | `customer_update.address:'auto'` ทับที่อยู่ที่ sync; prefill มาจากบัตรที่บันทึก | Stripe API reference (2026-09-27) | R-A3 |
| RV17 | M | params ของ repeat ถูก hash ลง journal → attempt ค้างระหว่าง deploy ตก review | `billing-repeat.ts:200-216` | Rollout |
| RV18 | M | cohort `salesCompanyIds` ไม่ว่าง = บล็อกร้านใหม่ทุกร้าน (ค่า production ไม่รู้) | `billing-policy.ts:91-96`, `billing.service.ts:798-803` | Phase 6 readback |
| RV19 | M | ร้านเก่า 60 แถว cohort LEGACY/null ถูกบล็อก INITIAL/RESTART; `CANONICAL.length===62` hard-coded | `billing-feature-entitlements.ts:49-58` | residual + test |
| RV20 | M | PROMPTPAY_RENEW binding ต้องมี Customer email; attempt ค้างจนกว่า bind สำเร็จ | reconciler `:649,1100-1107,811-821,1129-1131` | G27 + alert |
| RV21 | M | `openExternalBrowser` ใน builder เปลี่ยน binding hash ของ notification; wrapper ตัด fragment; ความยาว 5000 | `billing-notifications.service.ts:85,368-372`, `line-handoff-link.service.ts:118-120`, webhook `:3085-3088` | R-B1 |
| RV22 | M | `/l/` ไม่ส่งต่อ client IP → limiter รวม 20/60 วิ → `/login` ไม่มี next; GET/HEAD ใช้ token | `app/l/[token]/route.ts:35,50-55`, `trusted-client-ip.ts:53-70` | R-B1 |
| RV23 | M | reauth ออกนอกเบราว์เซอร์ไม่มี session → `/login` เปล่า | `line-login/start/route.ts:31-32`, `AccountEmailOtpPanel.tsx:80-85` | R-B4 |
| RV24 | M | LIFF status/session ไม่เช็กสิทธิ์ → พนักงานได้ปุ่มเลือกแพ็กเกจแล้วโดนปฏิเสธ | `get-line-signup-status.use-case.ts:53-78`, `exchange-liff-session.use-case.ts:113-125` | R-C2/C3 |
| RV25 | M | ต่ออายุร้าน no_package = เปิดทดลองใช้ (โควตา/เครดิต/ยกยอด/copy); "เปิดใช้งานบริษัท" ถูก sweep ปิดกลับ; อนุมัติคำขอเปลี่ยนแพ็กเกจร้านล็อกไม่เปิดสิทธิ์ | `receipt-quota.logic.ts:31-32`, `billing-trial-carryover.ts:10-39`, `partner-lifecycle-transition.use-case.ts:55-62`, `package-change-decision.use-case.ts:26-29,134,177` | R-C6 |
| RV26 | M | partner profile แช่แข็งทุก DISABLED; แก้ชื่อ/ที่อยู่ต้องผ่าน identity use case | `partner-lock.logic.ts:3-6`, `update-partner-profile.use-case.ts:27-28`, `data-model-core.module.ts:83-100` | R-E3 |
| RV27 | M | ลูกค้าเห็นเลขอ้างอิง 8 ตัวท้าย; lookup เดิมค้นได้แค่ email/username | `billing-display.ts:33-39`, `lookup-users.use-case.ts:57-58` | R-E4 |
| RV28 | M | ข้อความดิบจาก API ขัดนโยบาย fail-closed; coverage test ไม่เห็น `billingError` | `api-error-message.ts:1279-1320`, `api-error-coverage.spec.ts:51-52` | §12 |
| RV29 | M | Checkout ค้าง 30 นาทีซ่อนปุ่มซื้อ; cancel_url = success_url; quote หมดอายุเงียบ; Checkout สร้างไม่สำเร็จเงียบ; polling 5 GET/4 วิ ไม่หยุดที่ HELD | `billing.service.ts:721-722,803,736-751`, `BillingPage.tsx:155-205,374-383,577,580` | Phase 5 |
| RV30 | M | locked shell ไม่ปลดในที่; layout switch remount; permissions stale | `WorkspaceLayout.tsx:83-89,114-143,189-202` | Phase 5 (event `PLAN_TERM_CHANGED`) |
| RV31 | M | e2e rig ของ plan-term ส่ง `{days:30}` ผิด DTO → BR01/02/07, GW02, BC03 จะ 400; e2e ไม่อยู่ใน workflow ใด | `plan-term-billing-readiness.spec.ts:103-110,736-775` | Phase 6 |
| RV32 | M | "ให้ทีมงานติดต่อกลับ" ผ่าน "ติดต่อเจ้าหน้าที่" จะหยุด AI 24 ชม. | webhook `:2363,:2536-2543` | G19 → postback เฉพาะ |
| RV33 | M | copy LIFF สัญญาว่าจะยืนยันอีเมลก่อนจ่าย; ภาพวิธีใช้ไม่มีขั้นจ่าย (ส่งตอน follow) | `auth.controller.ts:580`, webhook `:240-252,:2226-2230` | Phase 1 copy |
| RV34 | M | รายการ "ห้ามแตะ" ในแผน sales-deals (6 ไฟล์) ครอบ `billing-collection.ts`/`billing-refund-source.ts` ที่แผนนี้ต้องแก้ | `mangmee-sales-deals-and-locked-signup-plan-th.md:19,83` | amend แผนนั้น (คงห้ามเฉพาะ evidence 2 ไฟล์) |
| RV35 | M | การ merge develop ทีละ phase อาจติดไปกับ release อื่น | runbook :273-274 | ทุก phase ต้องปล่อยเดี่ยวได้ (ออกแบบไว้แล้ว) |

### 18.4 ข้อที่ต้องให้ Owner ตัดสิน (DQ) — มีค่าเริ่มต้น

| ID | คำถาม | ค่าเริ่มต้น (แนะนำ) |
|---|---|---|
| DQ1 | ออกใบใหม่แทนใบเดิม (ชื่อ/ที่อยู่ผิดบนใบที่ออกแล้ว) | **พักไปสเปกแยก**; รอบนี้มีส่งซ้ำ + เปลี่ยนผู้รับ + แก้ข้อมูลสำหรับใบถัดไป; แอดมินทำมือใน Stripe ตาม runbook (คืนเงินก่อนออกใบใหม่ถ้ามีแนวโน้ม) |
| DQ2 | จัดการบัตร (portal) / ต่ออายุอัตโนมัติ / ยกเลิกลดแพ็กเกจ ต้องมีอีเมลบัญชี verified ไหม | **ไม่ต้อง** (portal config ห้ามแก้อีเมลอยู่แล้ว) |
| DQ3 | push หลังสมัคร = 2 แตะ (ลิงก์ LIFF) ตามกฎความปลอดภัย | **ยอมรับ**; 1 แตะเฉพาะการ์ดล็อก/หน้าผลลัพธ์ LIFF |
| DQ4 | คำขอเจ้าหน้าที่จากหน้าเว็บ | **ใช้คำขอเปลี่ยนแพ็กเกจเดิม** พร้อม reference; model เว็บใหม่เป็นงานแยก |
| DQ5 | ที่อยู่ที่พิมพ์ที่ Stripe | **ไม่เขียนลงข้อมูลบริษัทอัตโนมัติ**; เก็บเป็น snapshot + ปุ่ม "ใช้ที่อยู่จากการชำระเงิน" |
| DQ6 | Postmark stream แยกสำหรับอีเมลผู้รับเอกสาร (กัน bounce ปนกับ OTP) | **ไม่แยก** (แก้ 2026-09-27 หลังเขียน brief: แยก stream ต้องมี env ใหม่ + แก้ webhook/suppression/monitor/retention ที่ผูก stream เดียว + ไฟล์ pinned `infra/postmark/config.*` — ขัด D-PF-8) → คง stream `outbound` เดียว แยกด้วย Tag `purpose` ใน Postmark และ `intentKey` ในระบบ; hard bounce ของอีเมลผู้รับจะบล็อกอีเมลนั้นทั้ง OTP/billing บน stream นี้ (ยอมรับ: อีเมลตายจริง) |
| DQ7 | permission สำหรับส่งซ้ำ/เปลี่ยนผู้รับโดยแอดมิน | **ใช้ `system.billing.override.manage`** + amend controls/single-admin spec |
| DQ8 | อายุ session เว็บของลูกค้า (ตอนนี้ 7 วันเมื่อติ๊กจดจำ; `issue-token.use-case.ts:19`) | **คงเดิม 7 วันไปก่อน (Owner 2026-09-27)** — ไม่ทำในรอบนี้ (ตัดออกจาก PR B); ถ้าจะขยายภายหลังทำเป็นค่าคงที่ตามบทบาทที่ตัว issue token ไม่ใช่ env ใหม่ (แนวทางเดิมเก็บไว้ใน pr-b §3.13) |
| DQ9 | permission ของฟอร์มแก้ข้อมูลจดทะเบียน (ชื่อ/เลขภาษี/ที่อยู่) ในคอนโซลพาร์ทเนอร์ (R-E3) | **`system.identity_reconciliation.resolve`** (CRITICAL, มีอยู่แล้ว; legal identity เป็นเส้นทางเดียวที่มี revision/CAS/audit) ไม่ใช่ `system.partner_company.update` (MEDIUM); ถ้าเลือกอย่างหลังต้อง amend tax-identity spec :386 + delegation spec :29 → **Owner 2026-09-27: ยืนยันว่าแอดมินต้องแก้ได้ — ใช้ค่าเริ่มต้น** (System Admin มีสิทธิ์นี้อยู่แล้ว จึงแก้ได้ทันที; คำถามเป็นเพียงว่าจะใช้สิทธิ์ตัวไหน gate ฟอร์มสำหรับบัญชีเจ้าหน้าที่อื่น) |
| DQ10 | เพดานส่งเอกสารซ้ำโดยแอดมิน | **10 ครั้ง/ใบ/วัน** (ลูกค้า 3) — limiter key แยก `billing-resend-admin:<invoiceId>`; รหัส `BILLING_RESEND_LIMIT` เดียวกัน ข้อความไทยไม่ระบุตัวเลข |
| DQ11 | OTP ผู้รับเอกสาร (company-scoped) ต้องบังคับรหัสผ่าน/LINE reauth ก่อนขอรหัสไหม | **ไม่บังคับ**: OTP พิสูจน์ mailbox ใหม่อยู่แล้ว, ผู้กดต้องมี session + `company.plan.manage`, reauth LINE ในเบราว์เซอร์ของ LINE คือทางตันเดิม (RV23), ผู้รับเดิม + ผู้จัดการแพ็กเกจได้แจ้งเตือนทันที; ถ้า Owner ต้องการ ใส่ reauth 5 นาทีแบบ account OTP ได้ (3 บรรทัด, pr-c §9.12) |

### 18.5 การปรับสเปกหลังเขียน implementation briefs (2026-09-27) — มีผลเหนือ §18.2 ที่ขัดกัน

Briefs: `docs/plans/purchase-without-setup/00-readme.md` (สารบัญ + กติกา contract ข้าม PR) และ `pr-a…pr-e`, `xx-cross-cutting` — ทุกฉบับตรวจบรรทัดกับ `origin/develop` ddcdcadf แล้ว ข้อที่ brief พบว่าสเปกทำไม่ได้/ไม่ครบ และการตัดสิน:

| # | ข้อ | การแก้ |
|---|---|---|
| A1 | DQ6 แยก Postmark stream ทำไม่ได้โดยไม่มี env ใหม่ (`POSTMARK_MESSAGE_STREAM` เดียว; webhook ปฏิเสธ stream อื่น `postmark-events.service.ts:57`; suppression/monitor/retention ผูก stream เดียว) | ค่าเริ่มต้น DQ6 = **ไม่แยก**; R-A7 ข้อความ "Postmark stream แยกสำหรับอีเมลผู้รับ (DQ6)" ยกเลิก → แยกด้วย Tag `purpose` + `intentKey` |
| A2 | §9 ไม่มีที่เก็บ challenge OTP ผู้รับแบบผูกบริษัท | เพิ่มคอลัมน์ additive `EmailVerificationToken.companyId String?` + index `(companyId, proofKind, status)`; `proofKind = 'BILLING_RECIPIENT'` เท่านั้นที่ตั้งค่า (pr-c §3) |
| A3 | R-A8 รหัส error ของ flow OTP ผู้รับ | ใช้รหัส `EMAIL_OTP_*`/`EMAIL_*` เดิม (ไทยมีแล้ว) + 3 รหัสใหม่ `BILLING_RECIPIENT_UNAVAILABLE`/`_UNCHANGED`/`_PROOF_INVALID`; **ไม่มี** `BILLING_RECIPIENT_OTP_*` |
| A4 | R-D1 ส่งซ้ำเมื่อผู้รับตีกลับ | โยน `BILLING_RECIPIENT_BOUNCED` (§11) ทั้งฝั่งลูกค้าและแอดมิน; ผลลัพธ์ `{ invoiceSent, receiptUpdated, recipientEmail, remainingToday }`; ไม่ต้อง `Idempotency-Key` |
| A5 | §11/§12 ข้อมูลที่หน้าเว็บต้องใช้ | `BillingStatus.checkoutAddress` (จาก `checkoutAddressJson`, DQ5), `BillingAdjustments.documentActions/recipientEmail`; ระหว่าง PAID→APPLIED `recipient.email` ยังว่าง → เว็บแสดง "อีเมลที่กรอกไว้ที่หน้าชำระเงิน" |
| A6 | §12 error: กติกา "ไทยทั้งสอง map" | `api-error-message.ts` เป็น map เดียว; `BillingPage.errorText` fall-through ไป `translateApiError` + spec เดินทุก `billingError('X')` (รวม 22 `CONTROL_*` + 3 รหัส domain) |
| A7 | R-C7 "ฟิลด์ optional ใน 4 responses" | `CompanyPlanTermDto` ได้เฉพาะ `lockReason` (ฟังก์ชัน `toPlanTermDto` ไม่เห็น `Company.status`); `planState` derive ฝั่งเว็บด้วย `planTermState(term, now, companyStatus)`; helper `planTermLockReason/planTermState/planTermStateLabel` อยู่ใน contracts `plan-term.ts`; label กลาง: ยังไม่มีแพ็กเกจ / กำลังทดลองใช้ / ใช้งานได้ / หมดอายุ / พักการใช้งาน (sales console ACTIVE เปลี่ยนจาก "ใช้งานอยู่"; chip "พักการใช้งานแล้ว" ของหน้าพาร์ทเนอร์ถูกรวมเข้า state chip) |
| A8 | R-C6 | API ปฏิเสธด้วย `package_change_company_locked` (อนุมัติคำขอเปลี่ยนแพ็กเกจของร้านล็อก) และ `partner_activation_term_locked` (human เปิดใช้งานร้านที่ term ล็อก); reconciler/repeat/free-days (`requestingAdminUserId: null`) ไม่ติด |
| A9 | R-C2 | เพิ่ม `progress.lockedEntryCompanyId` (display-only) เพราะ `entryCompanyId` ถูก gate ด้วย `canEnter` ที่ห้ามขยาย (RV10); DTO ร้าน ACTIVE ไม่เปลี่ยน byte |
| A10 | AC3 (R-B2) | "payload ที่บันทึก = payload ที่ส่ง **ยกเว้น** `openExternalBrowser=1` ที่ทางออกเติมแบบ deterministic/idempotent หลังคำนวณ retry key" |
| A11 | R-E1 | ส่งเอกสารซ้ำโดยแอดมิน = คำสั่ง synchronous + password proof (ไม่ต้องอนุมัติ); เปลี่ยนอีเมลผู้รับโดยแอดมิน = reviewed op `RECIPIENT_ADMIN_CHANGE` **อิสระแบบ REFUND** (ไม่ใช้ `activeEmailOperationId`/`activeCollectionOperationId`) + mutual exclusion กับ attempt/collection/op ผู้รับของลูกค้า |
| A12 | R-E3 | permission = DQ9; Stripe Customer sync หลังแก้ข้อมูล = op journaled `CUSTOMER_PROFILE_SYNC` (QUEUED ทันที) ใช้ payload R-A2 |
| A13 | R-E5 ฝั่ง LINE | postback G19 ไม่ถือ id (SEC-04) → `referenceKind/referenceId` derive ฝั่ง server จากบริษัทของผู้ส่ง (attempt ค้างล่าสุด → invoice ล่าสุด); ไม่มี `LineTextEvent.supportReference` |
| A14 | DQ8 | **ยกเลิกในรอบนี้** — Owner 2026-09-27 ให้คงอายุ session 7 วันไปก่อน; PR B ไม่แตะ issue-token/cookie; แนวทางที่ออกแบบไว้ (ค่าคงที่ตามบทบาท + cookie 30 วัน + ตัดสิน role ด้วย membership count) เก็บไว้ใน pr-b §3.13 สำหรับอนาคต |
| A15 | R-B5 (4) log event | เว็บไม่มี client logging → `console.info` JSON `login_wall_from_line_link` ใน `line-login/start/route.ts` (ไม่ pinned) + audit `AUTH_LINE_HANDOFF_EXCHANGE` FAILED เป็น metric คู่; ต้องยืนยันว่า stdout ของ Next ถูกเก็บใน CloudWatch |
| A16 | plan P2 ข้อ 2 "(+ SCHEDULED_CHANGE/ADVANCE_DEAL)" | ไม่ต้องทำ — มีใน `contracts/billing.ts:134` แล้ว (audit F26 ล้าสมัย) |
| A17 | DQ ใหม่ | DQ9 (permission identity), DQ10 (เพดาน resend แอดมิน), DQ11 (OTP ผู้รับไม่บังคับ reauth) — ค่าเริ่มต้นใน §18.4 |
| A18 | G20 ข้อความ Owner-verbatim (`process-line-webhook.use-case.ts:244`) | **Owner sign-off 2026-09-27**: แพ็กเกจธุรกิจ = ชุด 1,999 บาท ได้เมนูเหมือนแพ็กเกจอื่นและเพิ่มเอกสารภาษี ภ.ง.ด.53 กับ 50 ทวิ → ใช้ข้อความที่ pr-a §5 เสนอได้ (ทั้ง `:244`, `line-staff-menu.logic.ts:310`, `line-public-policy.logic.ts:16`) |

