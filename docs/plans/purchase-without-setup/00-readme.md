# Implementation briefs: ซื้อแพ็กเกจได้ทันทีหลังสมัคร — สารบัญและกติการ่วม

Spec: [../../specs/mangmee-purchase-without-setup-spec-th.md](../../specs/mangmee-purchase-without-setup-spec-th.md) (v0.2, §18 มีผลเหนือ §7/§9/§11) · Plan: [../mangmee-purchase-without-setup-plan-th.md](../mangmee-purchase-without-setup-plan-th.md) ("แก้ไขแผน 2026-09-27") · Memory: [../../agent-memory/purchase-without-setup-2026-09-26.md](../../agent-memory/purchase-without-setup-2026-09-26.md)

แต่ละ brief ต้องพร้อมเขียนโค้ดได้โดยไม่ต้องค้นเพิ่ม: ไฟล์/ฟังก์ชัน/บรรทัด, contract (TypeScript/DTO/endpoint/error code + ข้อความไทย), ลำดับการทำงาน, ข้อความไทยทุกข้อความ, test ที่แก้/เพิ่ม + วิธีลงทะเบียน, docs ที่ต้อง amend, คำสั่ง verify, และรายการ "ต้องตรวจ" ที่เหลือ

| ลำดับ | Brief | ครอบคลุม | PR |
|---|---|---|---|
| 1 | [pr-a-line-liff-api.md](pr-a-line-liff-api.md) | Phase 1 ฝั่ง API/LIFF/LINE: outbound param, R-B2 ทาง (ข), `/l/` HEAD+IP, LIFF DTO/หน้า, liff/session destination, push, copy G19/G20/G25/RV33, R-C11 helper + call sites, sweep/notifications recipients | PR A |
| 2 | [pr-b-web-console-state.md](pr-b-web-console-state.md) | Phase 1 ฝั่ง web/console: `/auth/me/companies` lockReason, contracts helper, picker/switcher/BillingPage labels, partner list/detail (label, คำเตือนต่ออายุ, guard เปิดใช้งาน, queue เปลี่ยนแพ็กเกจ), LoginPage (R-B5 ขยาย), AccountEmailOtpPanel R-B4 (DQ8 session ตัดออก — Owner 2026-09-27 คงเดิม) | PR B |
| 3 | [pr-c-billing-api-no-setup.md](pr-c-billing-api-no-setup.md) | Phase 2 API: schema/migration/backfill, gate removal ทุกจุด, Customer sync payload, Checkout params, recipient capture, flow OTP ผู้รับใหม่, outbox/bounce, resend (Phase 3), allowlist + pins | PR C |
| 4 | [pr-d-web-billing-no-setup.md](pr-d-web-billing-no-setup.md) | Phase 2 web: BillingPage/return/recipient panel/profile page/fixture/e2e + Phase 5 polish ฝั่งเว็บ (cancel path, quote expiry, polling, unlock event, error map, expander) | PR D (+G) |
| 5 | [pr-e-admin-tools.md](pr-e-admin-tools.md) | Phase 4 admin: 2 ปุ่มบนหน้าใบแจ้งหนี้ (reviewed ops), identity path + lock rule, lookup suffix, support reference (LINE + package-change-requests), permissions/audit/labels | PR E |
| 6 | [xx-cross-cutting.md](xx-cross-cutting.md) | ลงทะเบียนเทสต์ (catalog/ci.yml/extended-tests), pins sync, ci.yml parity, migrations rules, docs amendments (บรรทัดที่ต้องแก้), UAT/production acceptance checklist (G27/AC10), readbacks | ทุก PR |

## กติการ่วมทุก PR

- worktree แยกจาก `origin/develop` ล่าสุด; PR ไป develop แล้ว twin ไป main (admin merge ตามที่ Owner สั่ง); controller ไม่แก้ worktree ของ agent ที่กำลังทำงาน
- ห้ามแก้ `package.json` (ยกเว้น dependency); ห้ามแตะ `paid-invoice.ts`, `paid-checkout-invoice.ts`, `billing-schedule.ts`, `app/login/page.tsx`, `session-gate.logic.ts`, `companies/[companyId]/layout.tsx`, `refresh-session.use-case.ts`, `apps/workers/src/main.ts`; ไฟล์ pinned ที่แตะได้แต่ต้อง sync pins: `auth.guard.ts`, `auth.module.ts` (หลีกเลี่ยง), `email-access.service.ts` (หลีกเลี่ยง)
- ไม่มี env/flag ใหม่; DTO ใหม่ทุกตัว optional; ไม่มี enum Prisma ใหม่ (String); migration additive เท่านั้น
- error code ใหม่ต้องมีข้อความไทยใน `apps/web/src/common/api/api-error-message.ts` (map เดียว) — PR ที่โยนรหัสใหม่เป็นคนใส่ (coverage spec บังคับ); `BillingPage.errorText` ไม่คัดลอกซ้ำ: PR D ทำให้ fall-through ไป `translateApiError` และมี spec เดินทุกรหัส; ห้ามแสดงข้อความดิบจาก API (แก้กติกา 2026-09-27)
- ข้อความถึงลูกค้าเป็นภาษาไทยธรรมดา ไม่มีรหัส/คำเทคนิค; ปุ่ม LINE ยาวไม่เกินที่ `line-staff-menu.logic.ts:67-75` กำหนด
- verify ขั้นต่ำต่อ PR (คำสั่ง Owner 2026-09-21): typecheck (api ใช้ script ของ package เพราะ heap), boot, spec ที่แตะ, `node scripts/run-line-ai-whole-chain-acceptance.mjs` เมื่อแตะ LINE-AI; PG/smoke/e2e ผ่าน Extended Tests (บันทึก run id)
- ทุก PR อัปเดต `docs/agent-memory/purchase-without-setup-2026-09-26.md` (Status/Verification/Next)

## กติกา contract ข้าม PR (ตัดสินโดย controller 2026-09-27 หลังอ่าน brief ทั้ง 5 — มีผลเหนือข้อความใน brief ที่ขัดกัน)

### 1. ชนิดข้อมูล/endpoint/รหัส error ของ Phase 2 — **PR C เป็นเจ้าของ (pr-c §2)**; PR D/PR E ใช้ชื่อเหล่านี้เท่านั้น

| เรื่อง | ตัดสิน |
|---|---|
| ผู้รับเอกสารใน status | `BillingStatus.recipient?: BillingRecipientInfo = { email, source, bouncedAt, canChange }` (ไม่ใช่ `null`); `BillingStatus.checkoutAddress?: CompanyLegalAddress \| null` (PR C เพิ่ม — DQ5 ปุ่ม "ใช้ที่อยู่จากการชำระเงิน" ของ PR D) |
| เอกสาร | `BillingInvoiceItem.documentActions?: { canResend }`; `BillingAdjustments.documentActions?` + `recipientEmail?` (PR C เพิ่ม — หน้าเอกสารของ PR D) |
| OTP ผู้รับ | `BillingRecipientOtpChallenge` (ไม่มี `serverNow` — นับถอยหลังจาก `retryAt` − `Date.now()`), `BillingRecipientOtpProof` (ไม่ใช่ `BillingRecipientProof`) |
| ส่งเอกสารซ้ำ | `BillingDocumentResendResult = { invoiceSent, receiptUpdated, recipientEmail, remainingToday }` ใช้ทั้งลูกค้า (PR C/D) และแอดมิน (PR E); `receiptUpdated=false` = Stripe ไม่ส่งใบเสร็จซ้ำเพราะอีเมลไม่เปลี่ยน; ไม่มี `sentTo`/`outcome:'LINK'`/`kind`; body ลูกค้า `{}`, แอดมิน `{ reason }`; ไม่ต้อง `Idempotency-Key` |
| ฟังก์ชัน Stripe ของ resend | `resendStripeDocuments(stripe, account, row, recipient)` export จาก `billing-document-resend.ts` (pr-c §4.10) — PR E เรียกใต้ lease/limiter ของตัวเอง (`billing-resend-admin:<invoiceId>` 10/วัน DQ10) ห้ามเขียนซ้ำ |
| รหัส error flow OTP ผู้รับ | **ไม่มี `BILLING_RECIPIENT_OTP_*`** — ใช้ `EMAIL_OTP_TARGET_INVALID` 400, `EMAIL_OTP_RATE_LIMITED` 429, `EMAIL_DELIVERY_UNAVAILABLE` 503, `EMAIL_REAUTH_REQUIRED` 401/409, `EMAIL_STATE_CHANGED` 409, `EMAIL_OTP_NOT_FOUND` 404, `EMAIL_OTP_INVALID`/`EMAIL_OTP_EXPIRED`/`EMAIL_OTP_ATTEMPTS_EXCEEDED` 409 (ไทยมีแล้ว `api-error-message.ts:21-32`) + ใหม่ 3 รหัส `BILLING_RECIPIENT_UNAVAILABLE`, `BILLING_RECIPIENT_UNCHANGED`, `BILLING_RECIPIENT_PROOF_INVALID` (PR C ใส่ไทย) |
| รหัส error resend | `BILLING_RESEND_LIMIT` 429 (+`retryAfterSeconds`), `BILLING_RESEND_UNAVAILABLE` 409 (ยังไม่ paid/APPLIED, ไม่มีผู้รับ, Stripe ล้ม), `BILLING_RECIPIENT_BOUNCED` 409 (PR C โยนเมื่อ `recipientBouncedAt` ตั้งอยู่ — ทั้งลูกค้าและแอดมิน), `BILLING_EMAIL_UPDATE_PENDING`, `BILLING_PURCHASE_PENDING`; ไม่มี `BILLING_DOCUMENT_PENDING`, `BILLING_RESEND_NO_RECIPIENT`, `BILLING_RESEND_PROVIDER_*` |
| ข้อความไทย `BILLING_RESEND_LIMIT` | ไม่ระบุตัวเลข (ลูกค้า 3/วัน แอดมิน 10/วัน ใช้รหัสเดียว): "วันนี้ส่งเอกสารใบนี้ซ้ำครบจำนวนที่กำหนดแล้ว ลองใหม่ได้พรุ่งนี้ หรือเปิดเอกสารจากหน้านี้ได้ทันที" |
| `status.recipient.email` ระหว่าง PAID→APPLIED | PR C เขียนคอลัมน์ตอน apply เท่านั้น (ไม่อ่าน Customer ใน status) → PR D ใช้ข้อความ fallback "ส่งเอกสารไปที่อีเมลที่กรอกไว้ที่หน้าชำระเงิน" จน APPLIED |
| audit เปลี่ยนผู้รับ | ชื่อเดียว `billing.recipient.changed` (HIGH/CRITICAL ตามผู้ทำ) metadata `{ source: ACCOUNT_EMAIL\|CUSTOMER_OTP\|ADMIN, operationId, hadPrevious }` ไม่มีอีเมล — PR C (OTP/บัญชี) และ PR E (ADMIN) |
| payload sync Customer (PR E `CUSTOMER_PROFILE_SYNC`) | `stripeCustomerSyncPayload({ quote: { billingProfile: companyBillingProfile(company), billingEmail: account.recipientEmail ?? null, companyName: company.name } })` + readback `stripeCustomerSynced(customer, arg)` (pr-c §4.2; `stripeBillingProfileMatches` ถูกลบ) |
| schema | PR C `20260927120000_billing_recipient_columns` (BillingAccount 5 คอลัมน์ + index, `EmailVerificationToken.companyId` + index); PR E `20260927130000_line_support_request_reference` (2 คอลัมน์) |

### 2. เจ้าของงานที่ซ้อนกัน (web)

| งาน | เจ้าของ | อีกฝ่ายทำอะไร |
|---|---|---|
| `PLAN_TERM_CHANGED_EVENT` + `notifyPlanTermChanged()` (`plan-term.api.ts`), listener ใน `WorkspaceLayoutClient`, effect dispatch ใน `BillingPage` หลัง `confirmed` | **PR B §3.14** | PR D ไม่เพิ่ม listener/constant; fallback reload (ถ้าต้องการ) ต่อใน effect เดิม |
| `LockedWorkspaceLayout` ครอบ `BillingWorkspaceContext.Provider` (F22/F20 header/ลิงก์วน) | **PR D §3.8** | PR B คง back link → settings (ไม่ถูก render ใน locked shell — ไม่ต้องถอด) |
| `AccountEmailOtpPanel.tsx` (R-B4 + copy :99/:111) | **PR B** ทั้งไฟล์ — ข้อความ E1/E2 ของ pr-b §4 เป็นข้อความสุดท้าย | PR D ไม่แตะ |
| `account/email/page.tsx` | :23 roles→permissions + `channel=line` = **PR B**; :25 description = **PR D** | — |
| `BillingPage.tsx` | :341-347 label + :306-307 back link + effect RV30 = **PR B**; ส่วนที่เหลือ = **PR D** (rebase หลัง B) | — |
| G17/G18 (การ์ดใกล้หมดอายุ, ลิงก์โควตา) | **PR B §3.15** | PR D ไม่ทำ |
| Thai ของรหัส error | รหัสใหม่ = PR ที่โยน (C/E) ใส่ใน `api-error-message.ts`; 21+3 รหัส legacy + 22 `CONTROL_*` + regex coverage spec = **PR D**; PR B ใส่ 2 รหัสคอนโซลใน `api-error-message.ts` เท่านั้น | — |

### 3. Seam PR A ↔ PR E (LINE)

- ปุ่ม "ให้ทีมงานติดต่อกลับ" (G19) = postback `action=package-callback` **ไม่มี id ใน data** (SEC-04) → `handlePackageCallback` + `openSupportRequest` + `recordSupportFollowUp(..., { extendPause: false })` ของ **PR A §3.15**; ไม่มี `LineTextEvent.supportReference`; `handleStaffContact` ไม่ถูกแตะ
- PR E ต่อยอด: `openSupportRequest`/`recordSupportFollowUp` รับ `reference?` ท้ายสุด; `handlePackageCallback` derive reference **ฝั่ง server จากบริษัทของผู้ส่ง** (attempt ค้างล่าสุด → invoice ล่าสุด → ไม่มี) — pr-e §4.1
- `planManagersOf(db, companyId)` / `planManagerLineUserIds(db, companyId, channelId)` (pr-a §2.7) รับ `prisma.client` หรือ `tx`; PR C ใช้ `planManagers()` ของ PR A สำหรับผู้รับ LINE/เว็บใน notifications (pr-c §4.11)

### 4. ข้อที่ยังต้อง Owner ตัดสิน (มีค่าเริ่มต้น — spec §18.4/§18.5)

DQ1–DQ5, DQ7 (เดิม); DQ6 แก้ค่าเริ่มต้นเป็น **ไม่แยก stream**; DQ8 **คงเดิม 7 วันไปก่อน (Owner 2026-09-27 — ตัดออกจาก PR B)**; **DQ9** permission ฟอร์ม identity ในคอนโซล = ค่าเริ่มต้น (Owner 2026-09-27 ยืนยันว่าแอดมินต้องแก้ได้ — System Admin มีสิทธิ์นี้อยู่แล้ว); **DQ10** เพดาน resend แอดมิน 10/วัน; **DQ11** OTP ผู้รับไม่บังคับ reauth; ข้อความ G20 (`process-line-webhook.use-case.ts:244`) **Owner sign-off แล้ว 2026-09-27** (แพ็กเกจธุรกิจ = ชุด 1,999: เมนูเหมือนแพ็กเกจอื่น + ภ.ง.ด.53 + 50 ทวิ) → PR A ใช้ข้อความที่เสนอได้

### 5. ลำดับปล่อย (xx §9)

A (pins sync เป็น commit แรก) → B → **C+D คู่กัน** → E (หลัง C เพราะ R-A5, หลัง B เพราะ label); ทุก PR: develop แล้ว twin main (admin merge); `ci.yml`/`extended-tests.yml` ต้อง byte-identical บน main ก่อน UAT `all`
