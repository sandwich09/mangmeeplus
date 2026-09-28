# PR D (+G): เว็บลูกค้า — ซื้อโดยไม่ต้องตั้งค่า, หน้า return, ผู้รับเอกสาร, error map, ขัดเกลา — Implementation brief

> ตรวจ anchor ใหม่บน develop 03438bde (2026-09-28); ฐานเดิม ddcdcadf

- วันที่: 2026-09-27 · ฐานโค้ด: `origin/develop` ddcdcadf (ทุกเลขบรรทัดในไฟล์นี้ตรวจกับ commit นี้แล้ว) · Spec: [../../specs/mangmee-purchase-without-setup-spec-th.md](../../specs/mangmee-purchase-without-setup-spec-th.md) §18.2 (R-A6/A8/A9/A11, R-D1, §12 error), §18.3 RV05/RV28/RV29/RV30, §12 เว็บลูกค้า · Plan: [../mangmee-purchase-without-setup-plan-th.md](../mangmee-purchase-without-setup-plan-th.md) "แก้ไขแผน 2026-09-27" P2 ข้อ 7/9 และ P5 · กติการ่วม: [00-readme.md](00-readme.md)
- ขอบเขตไฟล์: `apps/web/**` + `e2e/**` + docs + `.github/workflows/extended-tests.yml` (1 step) เท่านั้น; **ไม่แตะ** `apps/api`, `packages/contracts` (PR C), `package.json`, `app/login/page.tsx`, `session-gate.logic.ts`, `companies/[companyId]/layout.tsx`
- ลำดับ: **branch หลัง PR C merge** (ต้องใช้ contracts §2.1) — ถ้าต้องทำขนาน ให้ branch จาก branch ของ PR C แล้ว rebase; PR B แตะ `BillingPage.tsx:341-347` (label จาก lockReason), `AccountEmailOtpPanel.tsx`, `account/email/page.tsx:23` และอาจแตะ `WorkspaceLayout.tsx` (§3.8) → PR ที่ merge ทีหลัง rebase ก่อน push; ห้ามแตะ worktree ของอีก agent

## 1. Scope และ Definition of Done

### 1.1 ผลลัพธ์ที่ต้องได้ (ลูกค้า)

1. ร้านที่ไม่มีอีเมลบัญชี/ไม่มีที่อยู่ กดเลือกแพ็กเกจ → ยืนยัน → ไป Stripe ได้ทันที: ไม่มีข้อความ "ยืนยันอีเมลบัญชีก่อนซื้อ", ไม่มี modal/กล่องเหลือง "กรอกข้อมูลบริษัทก่อนซื้อ", ปุ่มไม่ถูกปิดด้วย regex อีเมล (RV05, R-A9)
2. หน้ายืนยันแสดงกล่อง "ข้อมูลออกเอกสาร" = ชื่อ · ที่อยู่ (หรือ "จะกรอกที่หน้าชำระเงิน") · อีเมล (หรือ "จะกรอกที่หน้าชำระเงิน") + ลิงก์ "แก้ไขข้อมูลบริษัท" (คง `returnTo=billing`) + ปุ่ม "แก้อีเมลรับเอกสาร" เมื่อมี Stripe Customer แล้ว (R-A11)
3. หน้า return: "ส่งเอกสารไปที่ {อีเมล}" ตั้งแต่ PAID, ปุ่ม "แก้อีเมลรับเอกสาร" เปิดเมื่อ APPLIED (R-A8, F04); polling เฉพาะ attempt 3 นาที (2 วิ × 30 วิ แล้ว 5 วิ), หยุดที่ HELD/FAILED/APPLIED, พักเมื่อซ่อนหน้า, refresh ไม่ถี่กว่า 30 วิ (F12, G13); กลับจาก Stripe ด้วย `?checkout=canceled` → หัวข้อ "ยังไม่ได้ชำระ" + "เลือกแพ็กเกจใหม่" กดเดียว (G12, F09/F10)
4. ปลดล็อก shell ในที่หลัง APPLIED ผ่าน `PLAN_TERM_CHANGED_EVENT` (RV30, G14); หัวข้อ return ไม่รอ status ACTIVE (F34); locked shell ไม่มี header ซ้อน/ลิงก์วนกลับหน้าเลือกบริษัท (F22, F20)
5. เปลี่ยนอีเมลรับเอกสารได้ 2 ทาง (อีเมลบัญชีที่ยืนยันแล้ว / อีเมลใหม่ + OTP) จากหน้า return, แท็บการต่ออายุ, แบนเนอร์ตีกลับ; ส่งเอกสารซ้ำได้จากหน้าเอกสารและหลังเปลี่ยนผู้รับ (R-A8/R-D1/R-D2)
6. error ทุกรหัสในเส้นทางซื้อเป็นไทย ไม่มีข้อความดิบจาก API (§12 error, RV28, G09); route error ไปแท็บอีเมลด้วย code ไม่ใช่ substring (G16)
7. quote หมดอายุมีข้อความ + ปุ่มตรวจสอบราคาใหม่ (G10, F16); Checkout สร้างไม่สำเร็จมีข้อความตามผล FAILED/UNKNOWN (G11, F17); `profile=updated&offer…` ถูกลบจาก URL หลัง resume (F30)
8. โหมดจ่าย: บัตร·ต่ออายุอัตโนมัติ เป็นค่าเริ่มต้นอยู่บนสุด ที่เหลืออยู่ใต้ "วิธีชำระอื่น" ที่เปิดอัตโนมัติเมื่อโหมดที่เลือก/ค่าเริ่มต้นอยู่ข้างใน; การ์ดรายปีมี "เฉลี่ยเดือนละ …" (G24, F24)
9. หน้าข้อมูลร้าน: กลับหน้า billing เมื่อกดบันทึกโดยไม่มีอะไรเปลี่ยน (F29); ปุ่ม "ใช้ที่อยู่จากการชำระเงิน" เติมฟอร์ม (ไม่บันทึกเอง) เมื่อ `status.checkoutAddress` มี (DQ5); hint/required mark ตรงกับกติกาใหม่; `/renew` ลิงก์ข้อมูลร้านเป็นทางเลือก (F28); copy หน้าอีเมลบัญชี (:25)
10. 390 px ไม่ล้น; touch target ≥ 44 px (`min-h-11`) ทุกปุ่ม/ลิงก์ใหม่

### 1.2 DoD (ติ๊กครบก่อน PR)

- [ ] `pnpm --filter @watchdog-bms/web typecheck` ผ่าน (หลัง `pnpm --filter @watchdog-bms/contracts build` ของ PR C)
- [ ] web unit: `api-error-coverage.spec.ts` (regex ใหม่ครอบ `billingError('X'`), `billing-error-text.spec.ts` (ใหม่), `no-raw-api-error-display.spec.ts`, `billing-display.spec.ts`, `billing-profile-navigation.spec.ts`, `company-profile.logic.spec.ts` ผ่าน
- [ ] e2e ที่แก้ (`customer-billing-ux`, `billing-preview`, `billing-advance-deal`) + ใหม่ (`billing-no-setup`) ผ่าน local 1280/390; run id ของ Extended Tests บันทึกใน memory
- [ ] ไม่มี `getAccountEmailOtp`/`readAccountEmail`/`emailReady`/`accountHref`/`profileMissing` เหลือใน `BillingPage.tsx`; ไม่มี `BILLING_LEGACY_REVIEW_REQUIRED`
- [ ] ทุกรหัสในตาราง §2.3 มีไทยใน `api-error-message.ts`; `BillingPage` fall-through ไป `translateApiError` (§3.2)
- [ ] docs §6 แก้แล้ว; `docs/agent-memory/purchase-without-setup-2026-09-26.md` อัปเดต Status/Verification/Next
- [ ] ไม่มี diff นอก `apps/web`, `e2e`, `docs`, `.github/workflows/extended-tests.yml`

## 2. Contracts ที่ PR D บริโภค (จาก PR C) และตาราง error ฝั่งเว็บ

### 2.1 ชนิดข้อมูล (packages/contracts/src/billing.ts — PR C เป็นเจ้าของ; PR D อ่านชื่อฟิลด์ตามนี้ ถ้า PR C ตั้งชื่อต่างให้แก้ในเว็บให้ตรง — ดู §9)

```ts
export type BillingRecipientSource = 'ACCOUNT_EMAIL' | 'CUSTOMER_OTP' | 'STRIPE_CHECKOUT' | 'ADMIN';
// BillingStatus (:150-193) เพิ่ม — ทุกฟิลด์ optional (fixture เดิมเป็น literal เต็ม)
recipient?: BillingRecipientInfo;   // PR C §2.1: { email, source, bouncedAt, canChange } — optional แต่ไม่ใช่ null
checkoutAddress?: CompanyLegalAddress | null; // จาก BillingAccount.checkoutAddressJson (R-A4 ข): line1, line2, district←city, province←state, postalCode←postal_code, subdistrict '' ถ้าแยกไม่ได้
// BillingQuote (:120-138): billingEmail: string | null  ← null = "Checkout จะถามอีเมล"; string = อีเมลที่ Checkout จะใช้ (Customer email หรือ verified account email)
// BillingInvoiceItem (:210-212) เพิ่ม
documentActions?: { canResend: boolean };
// BillingAdjustments (:220-221) เพิ่ม (หน้าเอกสารไม่มี history item ให้อ่าน — §3.7)
documentActions?: { canResend: boolean }; recipientEmail?: string | null;
// ใหม่
export type BillingRecipientOtpChallenge = { challengeId: string; email: string; expiresAt: string; retryAt: string; attemptsRemaining: number;
  deliveryStatus: string; delivered: boolean };   // ไม่มี serverNow (ตัดสิน 2026-09-27): นับถอยหลังจาก retryAt − Date.now()
export type BillingRecipientOtpProof = { recipientProofId: string; email: string; expiresAt: string };   // ชื่อตาม PR C §2.1
export type BillingDocumentResendResult = { invoiceSent: boolean; receiptUpdated: boolean; recipientEmail: string; remainingToday: number };   // รูปตาม PR C §4.10 (ตัดสิน 2026-09-27): receiptUpdated=false = Stripe ไม่ส่งใบเสร็จซ้ำเพราะอีเมลไม่เปลี่ยน
// BillingEmailRecipientOperation (:394-395) เพิ่ม optional: source?: BillingRecipientSource
```

### 2.2 Endpoints (ทั้งหมดใต้ `/v1/companies/:companyId/billing`; `X-Company-Id`; `assertOwner`; limiter `billing-command` 30/นาที เดิม `billing.controller.ts:479-482`)

| Method/Path | Body | ตอบ | รหัส error ที่เว็บต้องรับ |
|---|---|---|---|
| `POST /quote` (เดิม) | `billingEmail` **optional** — เว็บไม่ส่ง key เมื่อว่าง (DTO `billing.dto.ts:94` เปลี่ยนเป็น optional โดย PR C) | `BillingQuote` (`billingEmail` nullable) | เดิม + ไม่มี `BILLING_EMAIL_VERIFICATION_REQUIRED`/`BILLING_COMPANY_PROFILE_REQUIRED` อีก |
| `POST /checkout` (เดิม) | เดิม | `{ attemptId, state: 'OPEN'\|'FAILED'\|'UNKNOWN'\|'PENDING'…, checkoutUrl }` (`billing.service.ts:741-751`) | `BILLING_CONSENT_REQUIRED`, `BILLING_IDEMPOTENCY_*`, `BILLING_QUOTE_STALE` |
| Stripe `cancel_url` | — | `…/billing/return?attempt=<id>&checkout=canceled` (R-A3; `billing.service.ts:682,721,726`, `billing-repeat.ts:287,295`) | — |
| `POST /attempts/:id/cancel` (เดิม) | `{}` | `{ state: 'EXPIRED' \| 'COMPLETED' \| 'PENDING' }` (`billing-checkout-expiry.service.ts:56-85`) | `BILLING_CHECKOUT_PENDING`, `BILLING_PURCHASE_PENDING`, `CONTROL_PREVIEW_STALE` |
| `POST /recipient/otp/request` **ใหม่** | `{ email: string; requestKey: string }` (requestKey = `crypto.randomUUID()` ต่ออีเมลหนึ่งค่า ใช้ซ้ำเมื่อกดขอรหัสใหม่) | `BillingRecipientOtpChallenge` | `EMAIL_OTP_TARGET_INVALID` 400, `BILLING_RECIPIENT_UNAVAILABLE` 409 (ยังไม่มี Customer), `BILLING_RECIPIENT_UNCHANGED` 409, `EMAIL_OTP_RATE_LIMITED` 429 (+ `retryAfterSeconds`), `EMAIL_DELIVERY_UNAVAILABLE` 503, `EMAIL_REAUTH_REQUIRED` 401, `EMAIL_STATE_CHANGED` 409 (รหัสตาม PR C §2.3 — ตัดสิน 2026-09-27) |
| `POST /recipient/otp/confirm` **ใหม่** | `{ challengeId: string; code: string }` | `BillingRecipientOtpProof` | `EMAIL_OTP_NOT_FOUND` 404, `EMAIL_OTP_INVALID` / `EMAIL_OTP_EXPIRED` / `EMAIL_OTP_ATTEMPTS_EXCEEDED` / `EMAIL_REAUTH_REQUIRED` / `EMAIL_STATE_CHANGED` 409, `EMAIL_OTP_RATE_LIMITED` 429 |
| `POST /recipient/preview` (เดิม) | `{ recipientProofId?: string }` — ไม่ส่ง = ทางเดิม "ใช้อีเมลบัญชีที่ยืนยันแล้ว" | `BillingEmailRecipientOperation` | `BILLING_RECIPIENT_PROOF_INVALID` (หมดอายุ 30 นาที / ถูกใช้แล้ว / ไม่ใช่ของบริษัทนี้), `BILLING_RECIPIENT_UNCHANGED`, `BILLING_EMAIL_CHANGED`, `BILLING_EMAIL_VERIFICATION_REQUIRED` (เฉพาะทางเดิม), `BILLING_EMAIL_UPDATE_PENDING` |
| `POST /recipient/:id/submit` · `/cancel` (เดิม) | เดิม | เดิม | เดิม |
| `POST /documents/:invoiceId/resend` **ใหม่** | `{}` | `BillingDocumentResendResult` | `BILLING_RESEND_LIMIT` (429 + `retryAfterSeconds`), `BILLING_RESEND_UNAVAILABLE` 409 (ยังไม่ paid/APPLIED, ไม่มีผู้รับ, Stripe ล้ม), `BILLING_RECIPIENT_BOUNCED` 409, `BILLING_EMAIL_UPDATE_PENDING` 409, `BILLING_PURCHASE_PENDING` 409 (lease ไม่ว่าง) — ไม่ต้องส่ง `Idempotency-Key` |
| `GET /` status (เดิม) | — | + `recipient`, `checkoutAddress` | — |
| `GET /history` (เดิม) | — | item + `documentActions` | — |
| `GET /invoices/:id/adjustments/:kind` (เดิม) | — | + `documentActions`, `recipientEmail` | — |

ข้อสมมติที่ PR C ต้องยืนยัน (ดู §9): (a) `status.recipient.email` = `BillingAccount.recipientEmail` **หรือ** อีเมลบน Customer เมื่อคอลัมน์ยังว่างแต่มี `customerId` (หน้า return ตอน PAID ก่อน apply ต้องมีค่าให้แสดง; ถ้า PR C เลือกไม่อ่าน Customer เว็บจะแสดง fallback "อีเมลที่กรอกไว้ที่หน้าชำระเงิน"); (b) route ใหม่ทั้งสามอยู่ใน allowlist ร้านล็อก `auth.guard.ts:98-104` (pinned — PR C sync pins); (c) `isBillingCustomerRecoveryPath` ไม่ต้องเปลี่ยน เพราะ UI อยู่ที่ `/billing`, `/billing/return`, `/billing/invoices/:id` เท่านั้น

### 2.3 ตาราง error ฝั่งเว็บ (code → ไทย) — เขียนลง `apps/web/src/common/api/api-error-message.ts` `CODE_LABELS`; `BillingPage` อ่านผ่าน fall-through (§3.2) — PR C ต้องใช้รหัสตรงตัวอักษร

หลักการ: ข้อความบอกลูกค้าว่า "เกิดอะไร + ทำอะไรต่อ"; ไม่มีรหัส/คำเทคนิค; "ติดต่อทีมงานพร้อมเลขอ้างอิง" เฉพาะเมื่อลูกค้าทำเองไม่ได้จริง (เลขอ้างอิงมีอยู่แล้วที่ `BillingPage.tsx:371`)

**(ก) 21 รหัสที่ยังไม่มีไทรทั้งสองที่ (RV28/G09) + 3 รหัส domain ที่ regex ใหม่จะเจอ**

| code | ที่โยน (API) | ไทย |
|---|---|---|
| `BILLING_CHECKOUT_PENDING` | `billing-checkout-expiry.service.ts:60,81` | ระบบกำลังตรวจรายการชำระเงินเดิมกับ Stripe กรุณารอสักครู่แล้วกดอัปเดตข้อมูล |
| `BILLING_PURCHASE_PENDING` | `billing-checkout-expiry.service.ts:68`, `billing.service.ts` | มีรายการชำระเงินเดิมที่ระบบกำลังตรวจอยู่ กรุณารอสักครู่แล้วลองใหม่ |
| `BILLING_COLLECTION_PENDING` | `billing.service.ts:340,533` | มีคำสั่งเรื่องการต่ออายุที่ยังไม่เสร็จ กรุณาตรวจในแท็บการต่ออายุและชำระเงินให้เสร็จก่อนซื้อเพิ่ม |
| `BILLING_COLLECTION_CLOSED` | `billing-collection.ts` | ยังจัดการการต่ออายุผ่านเว็บไม่ได้ในตอนนี้ กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง |
| `BILLING_COLLECTION_REVIEW` | `billing-collection.ts` | ข้อมูลการต่ออายุเปลี่ยนไปแล้ว กรุณาโหลดข้อมูลล่าสุดแล้วเริ่มคำสั่งใหม่ หากยังไม่ได้ให้ติดต่อทีมงานพร้อมเลขอ้างอิง |
| `BILLING_CONSENT_REQUIRED` | `billing.service.ts:541` | กรุณาติ๊กยอมรับเงื่อนไขก่อนไปชำระเงิน |
| `BILLING_DOCUMENT_BINDING` | `billing-invoice-details.ts` | ข้อมูลรายการนี้ยังยืนยันกับ Stripe ไม่ได้ กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง |
| `BILLING_EXISTING_SUBSCRIPTION` | `billing.service.ts:326` | มีรายการชำระเงินเดิมที่ยังไม่จบ กรุณาตรวจสถานะรายการเดิมก่อนเริ่มรายการใหม่ |
| `BILLING_IDEMPOTENCY_CONFLICT` | `billing.service.ts:520` | รายการนี้ถูกส่งซ้ำด้วยข้อมูลที่ต่างจากเดิม กรุณาโหลดหน้าใหม่แล้วเริ่มรายการอีกครั้ง |
| `BILLING_IDEMPOTENCY_REQUIRED` | `billing.service.ts:511` | ส่งรายการไม่ครบ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง |
| `BILLING_MAPPING_MISMATCH` | `billing.service.ts:826,832,994` | ข้อมูลบิลต่ออายุไม่ตรงกับ Stripe กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง |
| `BILLING_MODE_CHANGE_PENDING` | `billing.service.ts:320,323,370,699` | เปลี่ยนวิธีชำระเงินได้เมื่อแพ็กเกจปัจจุบันสิ้นสุด ตอนนี้เลือกวิธีชำระแบบเดิม หรือรอให้ครบกำหนดก่อน |
| `BILLING_OFFER_UNAVAILABLE` | `billing.service.ts:300` | แพ็กเกจนี้ยังไม่เปิดรับชำระเงิน กรุณาเลือกแพ็กเกจอื่น |
| `BILLING_PACKAGE_STATE_INVALID` | `billing.service.ts:372,381,390,409` | ข้อมูลแพ็กเกจเดิมของบริษัทต้องให้ทีมงานตรวจก่อน กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง |
| `BILLING_PLAN_CHANGE_PENDING` | `billing.service.ts:328` | มีแพ็กเกจที่ชำระล่วงหน้ารอเริ่มใช้งานอยู่ กรุณาตรวจรายการเดิมในแท็บการต่ออายุและชำระเงิน |
| `BILLING_PRICE_MISMATCH` | `billing.service.ts:355,364,439,696,706` | ราคาในระบบไม่ตรงกับ Stripe กรุณาลองใหม่ภายหลัง หากยังไม่ได้ให้ติดต่อทีมงาน |
| `BILLING_REPEAT_REVIEW` | `billing-repeat.ts` | รายการซื้อซ้ำต้องให้ทีมงานตรวจก่อน กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง |
| `BILLING_TAX_MISMATCH` | `billing.service.ts` (`assertTaxSettings`) | การตั้งค่าภาษีของระบบยังไม่พร้อม กรุณาลองใหม่ภายหลัง หรือติดต่อทีมงาน |
| `BILLING_UPGRADE_BOUNDARY` | `billing.service.ts:413,442` | ใกล้วันเปลี่ยนรอบแล้ว กรุณาตรวจสถานะใหม่หลังเปลี่ยนรอบ หรือติดต่อทีมงาน |
| `BILLING_UPGRADE_GIFT_ONLY` | `billing-upgrade.ts` | เวลาที่เหลือของแพ็กเกจเป็นวันที่ทีมงานให้ไว้ กรุณาซื้อแพ็กเกจเดิมเพิ่มก่อน แล้วจึงเปลี่ยนเป็นแพ็กเกจที่สูงขึ้น |
| `BILLING_UPGRADE_REVIEW` | `billing-upgrade.ts` | ข้อมูลส่วนต่างของแพ็กเกจต้องให้ทีมงานตรวจก่อน กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง |
| `BILLING_CHECKOUT_INVOICE_MISMATCH` (domain) | `paid-checkout-invoice.ts` (ห้ามแตะ) | หลักฐานการชำระเงินของรายการนี้ต้องให้ทีมงานตรวจก่อนเปิดสิทธิ์ กรุณาดูสถานะรายการเดิม |
| `BILLING_INVOICE_MISMATCH` (domain) | `paid-invoice.ts` (ห้ามแตะ) | หลักฐานใบแจ้งหนี้ของรายการนี้ต้องให้ทีมงานตรวจก่อนเปิดสิทธิ์ กรุณาดูสถานะรายการเดิม |
| `SPECIAL_PRICE_RETURN_REVIEW` | `billing-price-return.ts` | ราคาพิเศษของร้านยังปรับกลับเป็นราคาปกติไม่ได้ ทีมงานกำลังตรวจสอบ |

**(ข) 5 รหัสที่มีเฉพาะใน `api-error-message.ts` (ไม่มีใน `BillingPage.errorText`)** — ครอบด้วย fall-through §3.2 ไม่ต้องคัดลอก: `BILLING_COMPANY_SALES_CLOSED` (:107), `BILLING_EMAIL_UPDATE_PENDING` (:20), `BILLING_INPUT_INVALID` (:898), `CONTROL_POLICY_NOT_READY` (:91), `CONTROL_PREVIEW_STALE` (:94 — ลูกค้าเจอเมื่อกดยุติรายการแล้วข้อมูลเปลี่ยน `billing-checkout-expiry.service.ts:16`). ปรับ 2 ข้อความให้เข้ากับหน้าลูกค้า: `BILLING_EMAIL_UPDATE_PENDING` → "มีคำขอเปลี่ยนอีเมลรับเอกสารค้างอยู่ กรุณายืนยันหรือยกเลิกคำขอในแท็บการต่ออายุและชำระเงินก่อนเริ่มรายการใหม่"; `CONTROL_PREVIEW_STALE` คงเดิม (ใช้ทั้งแอดมิน/ลูกค้า)

**(ค) รหัสใหม่ — PR C ใส่ไทยใน `api-error-message.ts` เอง (coverage spec ของ PR C ต้องผ่าน); PR D ตรวจว่าครบและปรับถ้อยคำได้ แต่ห้ามเปลี่ยนชื่อรหัส (ตัดสิน 2026-09-27)**

| code | HTTP | ไทย |
|---|---|---|
| `BILLING_RESEND_LIMIT` | 429 + `retryAfterSeconds` | วันนี้ส่งเอกสารใบนี้ซ้ำครบจำนวนที่กำหนดแล้ว ลองใหม่ได้พรุ่งนี้ หรือเปิดเอกสารจากหน้านี้ได้ทันที (ไม่ระบุตัวเลข — ลูกค้า 3/วัน แอดมิน 10/วัน ใช้รหัสเดียวกัน) |
| `BILLING_RESEND_UNAVAILABLE` | 409 | ยังส่งเอกสารนี้ซ้ำไม่ได้ในตอนนี้ กรุณาลองใหม่ภายหลัง หรือเปิดเอกสารจากปุ่มด้านบนแทน |
| `BILLING_RECIPIENT_BOUNCED` | 409 | อีเมลรับเอกสารปัจจุบันส่งไม่ถึง กรุณาแก้อีเมลรับเอกสารก่อน แล้วจึงส่งเอกสารซ้ำ |
| (ตัดสิน 2026-09-27) flow OTP ผู้รับ **ไม่มีรหัส `BILLING_RECIPIENT_OTP_*`** — PR C ใช้รหัส `EMAIL_OTP_*`/`EMAIL_*` เดิมที่มีไทยแล้ว (`api-error-message.ts:21-32`) + 3 รหัสใหม่ด้านล่าง | — | เทียบชื่อที่ brief นี้เคยใช้ → รหัสจริง: TARGET_INVALID→`EMAIL_OTP_TARGET_INVALID`, SAME_RECIPIENT→`BILLING_RECIPIENT_UNCHANGED`, RATE_LIMITED→`EMAIL_OTP_RATE_LIMITED`, DELIVERY_UNAVAILABLE→`EMAIL_DELIVERY_UNAVAILABLE`, INVALID→`EMAIL_OTP_INVALID`, EXPIRED→`EMAIL_OTP_EXPIRED`, ATTEMPTS_EXCEEDED→`EMAIL_OTP_ATTEMPTS_EXCEEDED`, PROOF_EXPIRED→`BILLING_RECIPIENT_PROOF_INVALID` |
| `BILLING_RECIPIENT_UNAVAILABLE` | 409 | ตั้งอีเมลรับเอกสารได้หลังชำระเงินครั้งแรก |
| `BILLING_RECIPIENT_UNCHANGED` | 409 | อีเมลนี้เป็นอีเมลรับเอกสารปัจจุบันอยู่แล้ว ไม่ต้องเปลี่ยน |
| `BILLING_RECIPIENT_PROOF_INVALID` | 409 | การยืนยันอีเมลนี้หมดอายุหรือถูกใช้แล้ว กรุณาขอรหัสยืนยันใหม่ |

**(ง) แก้ 2 ข้อความผิดสถานการณ์ + ลบ mapping ตาย (`BillingPage.tsx:33-65`)**

| บรรทัด | เดิม | ใหม่ (ย้ายไป `billing-error-text.ts` §3.2) |
|---|---|---|
| :40 `BILLING_PLAN_CHANGE_REQUIRED` | "กรุณากลับไปเลือกแพ็กเกจ เพื่อตรวจสอบวิธีเปลี่ยนแพ็กเกจและรอบชำระ" (ไม่ตรง `billing.service.ts:318` = สมาชิก QR ที่กำลังใช้งาน) | "แพ็กเกจปัจจุบันชำระด้วยบิล QR ทุกงวด ซื้อหรือเปลี่ยนแพ็กเกจใหม่ได้เมื่อรอบปัจจุบันสิ้นสุด หรือจัดการบิลในแท็บการต่ออายุและชำระเงิน" (ครอบอีกจุด "ใช้รายการเปลี่ยนแพ็กเกจ" ด้วยประโยคหลัง) |
| :42 `BILLING_REPEAT_NOT_READY` | "การซื้อแพ็กเกจซ้ำยังไม่เปิดให้บริการ กรุณาติดต่อทีมงาน" (ไม่ตรง `:395/:435` = gate `plan_changes` ปิดตอนเปลี่ยนแพ็กเกจ) | "การซื้อซ้ำหรือเปลี่ยนแพ็กเกจระหว่างรอบยังไม่เปิดให้บริการ กรุณาติดต่อทีมงาน หรือรอให้แพ็กเกจปัจจุบันสิ้นสุดแล้วซื้อใหม่" |
| :51 `BILLING_LEGACY_REVIEW_REQUIRED` | mapping ตาย (API ไม่โยนแล้ว) | ลบ |
| :39,:44,:45 `BILLING_COMPANY_PROFILE_REQUIRED`, `BILLING_RECIPIENT_UPDATE_REQUIRED`, `BILLING_EMAIL_CHANGED`/`BILLING_EMAIL_VERIFICATION_REQUIRED` | คงไว้ 1 release (R-A1 client เก่า) | ย้ายไปไฟล์ใหม่ตามเดิม; ใส่ comment `// R-A1: ลบใน release ถัดไป` |

**(จ) `CONTROL_*` ที่ `billingError` ปล่อยและยังไม่มีไทย (22 รหัส)** — regex ใหม่ใน coverage spec (§5.1) จะเจอ; ใส่ไทยแบบ operator (แอดมินอ่านผ่าน `apiErrorMessage`) แทนการทำ exemption list:

| code | ไทย |
|---|---|
| `CONTROL_ASSIGNEE_REVIEW` | ผู้รับงานหรือผู้สำรองไม่มีสิทธิ์ดูแลบริษัทนี้แล้ว กรุณาเลือกใหม่หรือคืนเคสเข้าคิว |
| `CONTROL_CHECKOUT_OUTCOME_UNKNOWN` | ยังยืนยันผลยุติหน้าชำระเงินเดิมไม่ได้ กรุณาตรวจรายการเดิมอีกครั้ง |
| `CONTROL_CHECKOUT_SOURCE_CHANGED` | ข้อมูลหน้าชำระเงินเดิมเปลี่ยนหรือยังไม่ครบ กรุณาตรวจรายการเดิมอีกครั้ง |
| `CONTROL_COLLECTION_REVIEW` | ข้อมูลการเก็บเงินเปลี่ยนหรือยังยืนยันไม่ได้ เปิดรายการเดิมเพื่อตรวจสอบ |
| `CONTROL_EXPORT_CHANGED` | ข้อมูลหรือสิทธิ์เปลี่ยนแล้ว โหลดประวัติล่าสุดก่อนดาวน์โหลดอีกครั้ง |
| `CONTROL_FREE_DAYS_REVIEW` | ยังปรับวันไม่ได้ ตรวจรายการต่ออายุเดิมแล้วลองรายการนี้อีกครั้ง |
| `CONTROL_IDEMPOTENCY_CONFLICT` | คำขอนี้ต่างจากรายการเดิม เปิดรายการเดิมเพื่อตรวจสอบ |
| `CONTROL_INVOICE_IDENTITY_NOT_READY` | ตั้งค่าเลขภาษีนี้เป็นค่าเริ่มต้นของเอกสารใน Stripe แล้วตรวจสอบใหม่ |
| `CONTROL_INVOICE_SOURCE_CHANGED` | บัญชีหรือผลตรวจต้นทางเปลี่ยนแล้ว ยกเลิกคำสั่งเดิมและตรวจใหม่ |
| `CONTROL_INVOICE_TARGET_REQUIRED` | เลือกใบเสร็จหรือผลตรวจใบแจ้งหนี้เดิมก่อน แล้วตรวจผลกระทบใหม่ |
| `CONTROL_ISSUER_REQUIRED` | กรุณาระบุข้อมูลกิจการและเลขภาษีที่ตั้งค่าใน Stripe |
| `CONTROL_OPERATION_IN_PROGRESS` | มีคำสั่งเดิมที่ยังตรวจไม่จบ เปิดประวัติคำสั่งของบริษัทเพื่อดำเนินการต่อ |
| `CONTROL_POLICY_NOT_SUPPORTED` | นโยบายปัจจุบันให้เริ่มและชำระทันที รายการนี้จึงทำไม่ได้ |
| `CONTROL_PROVIDER_DISABLED` | ยังไม่ได้ตั้งค่าบัญชีผู้ให้บริการ ติดต่อผู้ดูแลการเชื่อมต่อ |
| `CONTROL_REFUNDS_CLOSED` | ยังไม่เปิดรับคำขอคืนเงิน ติดต่อผู้ดูแลการตั้งค่า |
| `CONTROL_REFUND_AGED_UNKNOWN` | ยังยืนยันรายการเดิมไม่ได้ ให้เจ้าหน้าที่ตรวจ Stripe ก่อนดำเนินการต่อ |
| `CONTROL_REFUND_CONFIG_REQUIRED` | กำหนดวงเงินคืนเงินและขออนุมัตินโยบายก่อนเปิดการคืนเงิน |
| `CONTROL_REFUND_LIMIT` | ยอดนี้เกินวงเงินต่อคำขอ กรุณาติดต่อผู้ดูแลวงเงิน |
| `CONTROL_REFUND_SOURCE_CHANGED` | หลักฐานการคืนเงินเปลี่ยนหรือยังไม่ครบ กรุณาตรวจรายการเดิมอีกครั้ง |
| `CONTROL_SCAN_BUSY` | มีงานตรวจที่ยังไม่จบ กรุณาเปิดงานเดิมก่อน |
| `CONTROL_SCOPE_TARGET_INVALID` | เลือกเจ้าหน้าที่ที่มีบทบาทระดับระบบสำหรับงานการเงินอยู่แล้ว ผู้ดูแลระบบมีขอบเขตทั้งหมดอยู่แล้ว |
| `CONTROL_SCHEDULE_INVALID` | กำหนดเวลาไม่ถูกต้อง กรุณาเลือกเวลาใหม่แล้วตรวจผลกระทบอีกครั้ง |

## 3. การแก้โค้ดรายไฟล์ (current → new)

### 3.1 `apps/web/src/features/billing/billing.api.ts`

- `:24-25` `quote(offerKey, interval, billingEmail, capacity?, purchaseMode, dealId?, purchaseIntent?)` — **คง positional param** (fixture `:105` และ `BillingPage` เรียกแบบเดิม) แต่ body ไม่ส่ง key เมื่อว่าง:
  ```ts
  post<BillingQuote>('/quote', { offerKey, interval, ...(billingEmail ? { billingEmail } : {}), capacity, purchaseMode, ...(dealId ? { dealId } : {}), ...(purchaseIntent ? { purchaseIntent } : {}) }),
  ```
- `:14` `recipientPreview: () => post(...,'/recipient/preview', {})` → `recipientPreview: (recipientProofId?: string) => post<BillingEmailRecipientOperation>('/recipient/preview', recipientProofId ? { recipientProofId } : {})`
- เพิ่ม 3 ฟังก์ชัน (ต่อจาก `:18`):
  ```ts
  recipientOtpRequest: (email: string, requestKey: string) => post<BillingRecipientOtpChallenge>('/recipient/otp/request', { email, requestKey }),
  recipientOtpConfirm: (challengeId: string, code: string) => post<BillingRecipientOtpProof>('/recipient/otp/confirm', { challengeId, code }),
  resendDocument: (invoiceId: string) => post<BillingDocumentResendResult>(`/documents/${encodeURIComponent(invoiceId)}/resend`, {}, `billing-resend-${invoiceId}-${Date.now()}`),
  ```
  (Idempotency-Key ของ resend เป็นค่าใหม่ทุกครั้ง — คำสั่ง sync ใต้ lease R-D1 ไม่ใช่ durable op; header ส่งเพื่อให้ controller ที่บังคับ key ไม่ปฏิเสธ — PR C ยืนยันว่าไม่บังคับ → ตัดออกได้)
- import type เพิ่ม `BillingRecipientOtpChallenge, BillingRecipientOtpProof, BillingDocumentResendResult, BillingRecipientInfo`
- `ReturnType<typeof billingApi>` ใช้เป็น type ของ preview fixture → **fixture ต้องเพิ่ม stub ทั้ง 3** (§3.5) ไม่งั้น typecheck แดง

### 3.2 ใหม่ `apps/web/src/features/billing/billing-error-text.ts` (ย้าย `errorStatus`/`errorText` ออกจาก `BillingPage.tsx:27-65` เป็นโมดูลไม่มี React เพื่อให้ spec เดินได้)

```ts
import { apiErrorCode, translateApiError } from '@/common/api/api-error-message';
export const BILLING_GENERIC_ERROR = 'ยังยืนยันผลรายการไม่ได้ กรุณาตรวจสอบสถานะหรือติดต่อทีมงานพร้อมเลขอ้างอิง';
export function errorStatus(error: unknown): number | undefined { /* :27-32 เดิม */ }
/** ไทยสำหรับหน้าแพ็กเกจ: สถานะ → รหัสที่หน้านี้ใช้คำเฉพาะ → ตารางกลาง → ประโยคกลางของหน้านี้ (ห้ามข้อความดิบจาก API — §12) */
export function errorText(error: unknown): string {
  const status = errorStatus(error), code = apiErrorCode(error);
  if (status === 401) return 'กรุณาเข้าสู่ระบบอีกครั้ง';
  if (status === 403) return 'บัญชีนี้ยังไม่มีสิทธิ์จัดการแพ็กเกจและการชำระเงินของบริษัท';
  if (status === 429 && code !== 'BILLING_RESEND_LIMIT' && code !== 'EMAIL_OTP_RATE_LIMITED') return 'กรุณารอสักครู่แล้วลองใหม่';
  const page = code ? PAGE_LABELS[code] : undefined;  // รายการเดิม :38-63 ลบ :51, แก้ :40/:42 ตาม §2.3(ง)
  if (page) return page;
  const shared = code ? translateApiError(code) : null;      // §2.3 (ก)(ข)(ค)(จ)
  return shared ?? BILLING_GENERIC_ERROR;
}
```
- `PAGE_LABELS` = รายการเดิมของ `:38-63` (ที่หน้านี้มีคำเฉพาะ เช่น QUOTE_STALE, CAP_SELECTION, DEAL_*, MODE_NOT_READY, SALES_CLOSED/NOT_READY, COMPANY_HELD, PORTAL_*, DOCUMENT_PENDING, REFUND_PENDING, SOURCE/ENTITLEMENT_REVIEW, RESTART_REVIEW, CADENCE_PENDING_CHANGE, SALES_DEAL_PRICE_PENDING, CONTROL_DEAL_SUBSCRIPTION_REVIEW) + 4 รหัส R-A1 คง 1 release
- ผล: 5 รหัส (ข) และรหัสใหม่ทั้งหมดถูกครอบโดยไม่ต้องคัดลอกสองที่; กติกา readme "มีไทยทั้งสองที่" ถือว่าครบเพราะ `BillingPage` ให้คำตอบไทยเสมอผ่าน fall-through และ spec §5.1 ข้อ 2 พิสูจน์ทุกรหัส (controller ตัดสินถ้าต้องการคัดลอกจริง — §9)
- `billing-advance-deal.spec.ts:121` (`503 BILLING_PROVIDER_UNAVAILABLE` ไม่มี mapping) และ `customer-billing-ux.spec.ts:111` ยังได้ `BILLING_GENERIC_ERROR` ตามเดิม (ไม่มี passthrough ข้อความอังกฤษ — F14)

### 3.3 `apps/web/src/common/api/api-error-message.ts`

- `CODE_LABELS`: เพิ่มทุกแถวใน §2.3 (ก)(ค)(จ) ไว้ถัดจาก `:110` (กลุ่ม BILLING_) และ `:20`; แก้ `:20` ตาม (ข); `:19` `BILLING_EMAIL_VERIFICATION_REQUIRED` "…ก่อนชำระเงิน" → "การเปลี่ยนผู้รับเอกสารด้วยอีเมลบัญชีต้องยืนยันอีเมลบัญชีก่อน หรือเลือก "ใช้อีเมลอื่น" เพื่อยืนยันด้วยรหัสที่ส่งไปอีเมลนั้น" (ใช้ในแผงผู้รับเอกสารทางเดิม — F06)
- `apiErrorMessage` (`:1276-1281`) มี branch `BILLING_RATE_LIMIT` + `retryAfterSeconds` อยู่แล้ว → ขยายเงื่อนไขให้ครอบ `BILLING_RESEND_LIMIT` และ `EMAIL_OTP_RATE_LIMITED`: ข้อความ = ตาราง + ` (ลองใหม่ได้ใน ${seconds} วินาที)` เมื่อ `1 ≤ seconds ≤ 300`; เกิน 300 ใช้ข้อความตารางเฉย ๆ

### 3.4 `apps/web/src/features/billing/BillingPage.tsx` (อ่านไฟล์ทั้ง 595 บรรทัดก่อนแก้)

**(a) imports**

| บรรทัด | เดิม | ใหม่ |
|---|---|---|
| :3 | `import { Modal } from '@/common/components/modal';` | ลบ (ใช้ที่ modal :308 เท่านั้น) |
| :4 | `import { BILLING_PROFILE_FIELD_LABELS, type BillingProfileField } from '@watchdog-bms/contracts';` | ลบ (ใช้ที่ :78,:215,:313,:333 ซึ่งลบทั้งหมด) |
| :10 | `import { getAccountEmailOtp, type AccountEmailOtpState } from '@/features/auth/account-email-otp.api';` | ลบ |
| :13 | `import { apiErrorCode } from '@/common/api/api-error-message';` | คง (ใช้ที่ :256 และ errorCode ใหม่ (h)) |
| :27-65 | `errorStatus`/`errorText` ในไฟล์ | ลบ → `import { errorText, errorStatus } from './billing-error-text';` |
| ใหม่ | — | `import { notifyPlanTermChanged } from '@/features/plan-term/plan-term.api'; /* helper ของ PR B */ import { useLockedShell } from '@/features/plan-term/LockedShellScope';` |

**(b) props/state — ถอด gate อีเมลบัญชี (RV05, R-A6/A9; บรรทัด :78,100-109,116,136-155,212-217,239,250-251,257,422,438,441,467,505,508,529,543,577)**

| บรรทัด | เดิม | ใหม่ |
|---|---|---|
| :74 | `preview?: { api; readAccountEmail: typeof getAccountEmailOtp; navigate; openDocumentHistory; startWithPlans?; initialSection? }` | ลบ `readAccountEmail` |
| :78 | `const [profileMissing, setProfileMissing] = useState<BillingProfileField[] \| null>(null);` | ลบ |
| :99-100 | `const [emailState, setEmailState] = …, [emailReadError, setEmailReadError] = …; const email = emailState?.email ?? '', emailReady = emailState?.emailRequirement === 'READY';` | ลบ; ถัดจาก `:84` (`data` state) เพิ่ม `const recipientEmail = data?.status.recipient?.email ?? '';` (ต้องประกาศก่อน effect :101 เพราะอยู่ใน deps — TDZ) |
| :101-109 | `if (resumedProfile.current \|\| !data \|\| !emailReady) return;` … `requestQuote(…, email, …)` … deps `[data, emailReady, email]` | `if (resumedProfile.current \|\| !data) return;` … `requestQuote(…, recipientEmail, …)`; deps `[data]` (`recipientEmail` อ่านค่าตอน resume ครั้งเดียว — ใส่ `// eslint-disable-next-line react-hooks/exhaustive-deps` แบบ `BillingPreviewPage.tsx:32`); **F30**: ก่อน `void action(...)` ลบ param: `const url = new URL(window.location.href); for (const key of ['profile', 'offer', 'interval', 'purchaseMode', 'deal', 'purchaseIntent', 'returnTo']) url.searchParams.delete(key); window.history.replaceState(null, '', url.pathname + url.search + url.hash);` (คง `channel`, `collection`) |
| :114 | `const emailFingerprint = useRef('');` | ลบ |
| :116 | `capacity` state field `billingEmail: string` | คง (ค่าเป็น `recipientEmail` อาจว่าง) |
| :136-155 | effect อ่าน `getAccountEmailOtp` ทุก 15 วิ + reset quote (:144, :147) | **ลบทั้ง effect** (F32) |
| :212-216 | `if (apiErrorCode(e) === 'BILLING_COMPANY_PROFILE_REQUIRED') { … setProfileMissing … }` | ลบ branch; เหลือ `if ([401, 403].includes(errorStatus(e) ?? 0)) setData(null); setError(errorText(e)); setErrorCode(apiErrorCode(e));` (state ใหม่ (h)) |
| :239 | `setCapacity({ options, billingEmail, … })` | คง |
| :250-251 | `if (!latest.billingProfile) throw new Error('billing_company_profile_unavailable'); if (latest.billingProfile.missingFields.length) { setProfileMissing(...); setQuote(null); return; }` | ลบทั้งสองบรรทัด |
| :257 | `setCapacity({ options: await api.capacity(...), billingEmail, … })` | คง |
| :284-285 | `const accountHref = …` | ลบ (ย้ายเข้าแผง §3.6) |
| :422 | `setCapacity({ options: …, billingEmail: email, repair, key })` | `billingEmail: recipientEmail` |
| :438 | `requestQuote(capacity.options.offerKey, capacity.options.interval, capacity.billingEmail, selection)` | คง |
| :440 | `{emailReadError && <p role="alert">ยังตรวจสอบอีเมลบัญชีไม่ได้ …</p>}` | ลบ |
| :441 | `{!emailReady && !emailReadError && <p role="status">{emailState ? <>ยืนยันอีเมลบัญชีก่อนซื้อแพ็กเกจ …</> : 'กำลังตรวจสอบอีเมลบัญชี…'}</p>}` | ลบ |
| :467 | `disabled={busy \|\| !emailReady \|\| !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)}` | `disabled={busy}` |
| :468 | `requestQuote(deal.base, …, email, undefined, chosenDealMode, deal.dealId)` | `…, recipientEmail, …` |
| :505 | `disabled={modeUnavailable \|\| busy \|\| !emailReady \|\| catalogUnavailable \|\| Date.parse(data.catalog.validUntil) <= Date.now() \|\| offer.availability !== 'AVAILABLE' \|\| !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)}` | `disabled={modeUnavailable \|\| busy \|\| catalogUnavailable \|\| Date.parse(data.catalog.validUntil) <= Date.now() \|\| offer.availability !== 'AVAILABLE'}` |
| :506,:509 | `requestQuote(offer.offerKey, interval, email …)` | `recipientEmail` |
| :508 | `disabled={modeUnavailable \|\| busy \|\| !emailReady \|\| …}` | ลบ `!emailReady` |
| :543 (2 จุด) | `requestQuote(quote.offer.offerKey, quote.offer.interval, email, undefined, quote.purchaseMode, …)` | `recipientEmail` |
| :577 | `disabled={busy \|\| !emailReady \|\| (catalogUnavailable && !dealQuote) \|\| !accepted \|\| Date.parse(quote.expiresAt) <= Date.now()}` | `disabled={busy \|\| (catalogUnavailable && !dealQuote) \|\| !accepted \|\| quoteExpired}` (state ใหม่ (f)) |
| :407-410 | `<div ref={emailSettings} className="scroll-mt-24 space-y-4">{emailReadError && …}<BillingEmailRecipientPanel companyId email ready accountHref apiOverride />` | `<div ref={emailSettings} className="scroll-mt-[calc(var(--app-header-h,0px)+1.5rem)] space-y-4">{bounceBanner}<BillingEmailRecipientPanel companyId={companyId} status={status} latestInvoice={latestInvoice} openRequest={recipientOpen} onChanged={() => setReload(value => value + 1)} apiOverride={preview?.api} /></div>` (F15 scroll-mt 96 px < header 112 px บนมือถือ) |

**(c) modal + กล่องเหลือง → กล่องข้อมูลไม่บล็อก (R-A9; :308-315, :326-338)**

- ลบ `:308-315` (`<Modal open={profileMissing !== null} …>`) ทั้งก้อน
- แทน `:326-338` ด้วย:
  ```tsx
  {status.allowedActions.includes('new_sales') && !!status.billingProfile?.missingFields.length && <p role="note" className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm leading-7 text-gray-700">
    เอกสารจะออกในชื่อ <strong className="break-words">{status.billingProfile.name || status.companyName}</strong> · ที่อยู่กรอกได้ที่หน้าชำระเงิน หรือ <Link className="inline-flex min-h-11 items-center font-semibold text-brand-700 underline" href={`/companies/${encodeURIComponent(companyId)}/settings/profile#shop`}>เติมล่วงหน้าที่ข้อมูลร้าน</Link>
  </p>}
  ```
  (ลิงก์นี้เป็นทางเลือก ไม่ต้อง `returnTo` เพราะยังไม่มี offer ที่เลือก; ลิงก์ที่มี `returnTo=billing` อยู่ที่หน้ายืนยัน (d) — F07/F08)
- `pendingPurchase` (`:79`) คง — ใช้ที่ `:225-226` และ `:531` (channel ของลิงก์แก้ไขข้อมูลบริษัท)

**(d) หน้ายืนยัน — กล่อง "ข้อมูลออกเอกสาร" (R-A11; :525-534)**

```tsx
<div className="rounded-xl border border-gray-200 p-4" aria-label="ข้อมูลออกเอกสาร">
  <p className="font-semibold">ข้อมูลออกเอกสาร</p>
  <dl className="mt-2 space-y-1 text-sm sm:text-base">
    <div className="flex flex-wrap gap-x-2"><dt className="text-gray-500">ชื่อบนเอกสาร</dt><dd className="min-w-0 break-words">{quote.billingProfile?.name || quote.companyName}</dd></div>
    <div className="flex flex-wrap gap-x-2"><dt className="text-gray-500">ที่อยู่</dt><dd className="min-w-0 break-words">{quote.billingProfile && quote.billingProfile.missingFields.every(field => field === 'name') ? Object.values(quote.billingProfile.address).filter(Boolean).join(' ') : 'จะกรอกที่หน้าชำระเงิน'}</dd></div>
    <div className="flex flex-wrap gap-x-2"><dt className="text-gray-500">อีเมลรับเอกสาร</dt><dd className="min-w-0 break-all">{quote.billingEmail ?? 'จะกรอกที่หน้าชำระเงิน'}</dd></div>
  </dl>
  <div className="mt-2 flex flex-wrap gap-x-4">
    <Link className="inline-flex min-h-11 items-center text-brand-700 underline" href={billingProfileHref(companyId, { /* :530-534 เดิม */ })}>แก้ไขข้อมูลบริษัท</Link>
    {status.recipient?.email && <button type="button" className="inline-flex min-h-11 items-center text-brand-700 underline" onClick={openRecipientEditor}>แก้อีเมลรับเอกสาร</button>}
  </div>
</div>
```
- `openRecipientEditor = () => { setSection('payment'); setRecipientOpen(value => value + 1); emailSettings.current?.scrollIntoView({ block: 'start' }); }`; `const [recipientOpen, setRecipientOpen] = useState(0);` quote ยังอยู่ (section แค่ซ่อน) — ถ้าผู้รับเปลี่ยนสำเร็จ API จะตอบ `BILLING_QUOTE_STALE` ตอน checkout (R-A5) → ผู้ใช้ตรวจราคาใหม่ตามข้อความเดิม
- `quote.billingEmail` เป็น `string | null` (contracts PR C) — `:529` `<p>{quote.billingEmail}</p>` ถูกแทนด้วย dd ด้านบน
- `BillingPreviewPage`/fixture: `billingEmail` ของ quote = `paid ? 'preview@example.com' : null` (§3.5) → e2e เห็น "จะกรอกที่หน้าชำระเงิน" ในฉาก start

**(e) หน้า return + polling + cancel (R-A8, G12/G13, F09/F10/F12/F34; :196-205, :289, :340-393)**

state ใหม่: `const [checkoutCanceled, setCheckoutCanceled] = useState(false); useEffect(() => { setCheckoutCanceled(returning && new URLSearchParams(window.location.search).get('checkout') === 'canceled'); }, [returning]);` (อ่านใน effect กัน hydration mismatch); `const reopenChooser = useRef(false);`; `const latestInvoice = data?.history.items[0] ?? null;`; `const locked = useLockedShell();`

- `:289` `const confirmed = status?.accessState === 'ACTIVE' && (returning ? returnComplete : status.paymentState === 'PAID' && status.applyState === 'APPLIED');` → `const confirmed = returning ? returnComplete : status?.accessState === 'ACTIVE' && status.paymentState === 'PAID' && status.applyState === 'APPLIED';` (F34 หัวข้อไม่รอ status ACTIVE)
- `:196-205` polling → แทนทั้ง effect:
  ```ts
  useEffect(() => {
    if (!returning || !returnAttemptId || returnError) return;
    const terminal = returnComplete || returnAttempt?.paymentState === 'FAILED' || ['HELD', 'FAILED'].includes(returnAttempt?.applyState ?? '');
    if (terminal) return;
    let active = true, timer = 0, lastRefresh = 0, lastPayment = returnAttempt?.paymentState ?? null;
    const startedAt = Date.now();
    const tick = async () => {
      if (!active) return;
      if (Date.now() - startedAt >= 180_000) { setTimedOut(true); return; }
      if (Date.now() - lastRefresh >= 30_000) { lastRefresh = Date.now(); void api.refresh().catch(() => {}); }   // throttle: limiter 30/นาที ใช้ร่วมกับปุ่ม
      try {
        const value = await api.attempt(returnAttemptId);
        if (!active) return;
        setReturnAttempt(value); setReturnError('');
        if (value.paymentState !== lastPayment || value.applyState === 'APPLIED') { lastPayment = value.paymentState; setReload(v => v + 1); }  // อ่าน status/history ใหม่เฉพาะตอนเปลี่ยน (recipient, หัวข้อ)
      } catch (e) { if (active) setReturnError(errorStatus(e) === 404 ? 'ไม่พบรายการนี้ในบริษัทที่เลือก กรุณาดูประวัติหรือติดต่อทีมงาน' : errorText(e)); return; }
      schedule();
    };
    const schedule = () => { if (active && document.visibilityState === 'visible') timer = window.setTimeout(tick, Date.now() - startedAt < 30_000 ? 2_000 : 5_000); };
    const visible = () => { window.clearTimeout(timer); if (document.visibilityState === 'visible') void tick(); };
    void tick();
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; window.clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [api, returning, returnAttemptId, returnComplete, returnError, returnAttempt?.paymentState, returnAttempt?.applyState]);
  ```
  ผล: 1 GET/รอบ (ไม่ใช่ 5), หยุดที่ HELD/FAILED/APPLIED, พักเมื่อซ่อนหน้า, กลับมาเห็นอ่านต่อ (ไม่เริ่มนับ 3 นาทีใหม่), `timedOut` → ข้อความ `:373` เดิม + ปุ่มตรวจเอง `:385-393`; `:164-165` (อ่าน attempt ครั้งแรกใน effect โหลดข้อมูล) คงไว้
- **unlock ในที่ (RV30)** — effect ใหม่:
  ```ts
  const unlockReloaded = useRef(false);
  useEffect(() => {
    if (!confirmed || !locked) return;
    notifyPlanTermChanged();   // helper ของ PR B — PR B ใส่ effect นี้ไว้แล้ว (pr-b §3.14): PR D รวม fallback ด้านล่างเข้า effect เดียว ห้ามมี 2 effect
    // fallback: ถ้า shell ยังล็อกหลัง 5 วิ (listener ไม่มี/notice ยัง EXPIRED) โหลดหน้าครั้งเดียว
    const timer = window.setTimeout(() => { if (!unlockReloaded.current) { unlockReloaded.current = true; window.location.reload(); } }, 5_000);
    return () => window.clearTimeout(timer);
  }, [confirmed, locked]);
  ```
  (เมื่อ layout สลับเป็น business shell คอมโพเนนต์นี้ unmount → cleanup ล้าง timer → ไม่ reload; `locked` มาจาก `useLockedShell()` ซึ่ง `LockedShellProvider` ให้ค่า true เฉพาะ locked shell `WorkspaceLayout.tsx:135`)
- `:340` หัวข้อ: แทรกก่อน `status.attemptId ? 'กำลังตรวจสอบรายการชำระเงิน'`: `checkoutCanceled && returnAttempt?.paymentState !== 'PAID' && !confirmed ? 'ยังไม่ได้ชำระ' : …`
- หลัง `:341-347` (badge/dl) เพิ่มบล็อก return (R-A8):
  ```tsx
  {returning && returnAttempt?.paymentState === 'PAID' && <div className="space-y-2 rounded-xl bg-gray-50 p-4" aria-label="อีเมลรับเอกสาร">
    <p className="break-all">ส่งเอกสารไปที่ <strong>{status.recipient?.email ?? 'อีเมลที่กรอกไว้ที่หน้าชำระเงิน'}</strong></p>
    <button className={button} disabled={busy || !returnComplete} onClick={openRecipientEditor}>แก้อีเมลรับเอกสาร</button>
    {!returnComplete && <p className="text-sm text-gray-600">แก้อีเมลได้เมื่อเปิดสิทธิ์เสร็จ (อีกสักครู่)</p>}
  </div>}
  ```
  (F04: op เดิม `billing-email-recipient.ts:69` ปฏิเสธขณะ `activeAttemptId`; ปุ่มจึงเปิดที่ APPLIED เท่านั้น)
- `:375-383` ยุติรายการ 2 ขั้น → คงไว้สำหรับสถานะที่ไม่ใช่ PENDING (UNKNOWN/ACTION_REQUIRED); เมื่อ `status.canCancelCheckout && status.attemptId && status.paymentState === 'PENDING'` แสดง **ปุ่มเดียว** แทน (F09/F10; ทั้งหน้าแพ็กเกจและ return):
  ```tsx
  <button className="mangmee-btn mangmee-btn-primary" disabled={busy} aria-busy={busy} onClick={() => action(async () => {
    const result = await api.cancelCheckout(status.attemptId!);
    if (result.state === 'EXPIRED') { reopenChooser.current = true; setCheckoutCancelNotice('ยุติหน้าชำระเงินเดิมแล้ว เลือกแพ็กเกจใหม่ได้เลย'); }
    else if (result.state === 'COMPLETED') setCheckoutCancelNotice('รายการเดิมชำระสำเร็จแล้ว ระบบกำลังเปิดสิทธิ์ให้ ไม่ต้องซื้อใหม่');
    else setCheckoutCancelNotice('กำลังตรวจผลรายการเดิมกับ Stripe กรุณารอสักครู่แล้วกดอัปเดตข้อมูล');
    setReload(value => value + 1);   // อ่าน status ใหม่ก่อนเปิด chooser เสมอ
  })}>เลือกแพ็กเกจใหม่</button>
  ```
  และใน effect โหลดข้อมูล (`:159-161` `.then`): หลัง `setData(...)` เพิ่ม `if (reopenChooser.current && status.allowedActions.includes('new_sales') && !status.attemptId) { reopenChooser.current = false; setChoosing(true); setSection('package'); }` (ไม่เปิดเมื่อ COMPLETED/PENDING เพราะ `allowedActions` ไม่มี `new_sales` ขณะ `activeAttemptId` ค้าง — `billing.service.ts:803-809`); บนหน้า return ที่ `checkoutCanceled` ให้ปุ่มนี้อยู่ใต้หัวข้อ "ยังไม่ได้ชำระ" ก่อนปุ่ม "กลับไปยังรายการเดิม" (`:374` คง — ลูกค้าที่แค่กด back แต่ยังอยากจ่ายรายการเดิม)
- `:373` timedOut copy คง; `:371` เลขอ้างอิง คง

**(f) quote หมดอายุ + Checkout ไม่มี URL (G10/G11, F16/F17; :577-581)**

```ts
const [quoteExpired, setQuoteExpired] = useState(false);
useEffect(() => {
  setQuoteExpired(false);
  if (!quote) return;
  const remaining = Date.parse(quote.expiresAt) - Date.now();   // billing.service.ts:462 = 10 นาที
  if (remaining <= 0) { setQuoteExpired(true); return; }
  const timer = window.setTimeout(() => setQuoteExpired(true), remaining);
  return () => window.clearTimeout(timer);
}, [quote?.quoteId, quote?.expiresAt]);
const requoteSame = () => action(async () => { await requestQuote(quote!.offer.offerKey, quote!.offer.interval, recipientEmail, capacityDraft.current?.initialSelection, quote!.purchaseMode, dealQuote?.dealId, quote!.purchase?.kind === 'FULL_PACKAGE_UPGRADE' ? 'FULL_PACKAGE' : undefined); });
```
- `:577-581` แทนด้วย:
  ```tsx
  {quoteExpired ? <div role="status" className="space-y-3 rounded-xl bg-amber-50 p-4"><p>ราคานี้หมดอายุแล้ว กดตรวจสอบราคาใหม่</p><button className="mangmee-btn mangmee-btn-primary" disabled={busy} aria-busy={busy} onClick={requoteSame}>ตรวจสอบราคาใหม่</button></div>
  : <div className="flex flex-wrap gap-3"><button className="mangmee-btn mangmee-btn-primary" disabled={busy || (catalogUnavailable && !dealQuote) || !accepted} aria-busy={Boolean(busy)} onClick={() => action(async navigate => {
      const params = new URLSearchParams(window.location.search);
      const result = await api.checkout({ quoteId: quote.quoteId, consentRevision: quote.consentRevision, accepted: true, channel: params.get('channel') === 'line' ? 'line' : 'web' }, key.current);
      if (result.checkoutUrl) navigate(result.checkoutUrl, 'checkout');
      else if (result.state === 'FAILED') { setQuote(null); setAccepted(false); setError('ยังเปิดหน้าชำระเงินไม่ได้ กรุณาตรวจสอบราคาใหม่แล้วลองอีกครั้ง'); }           // quote ถูกใช้ไปแล้ว (billing.service.ts:741-747) → กลับ chooser (choosing ยัง true)
      else if (result.state === 'UNKNOWN') { setQuote(null); setChoosing(false); setCheckoutCancelNotice('กำลังตรวจกับ Stripe ว่าหน้าชำระเงินถูกสร้างหรือไม่ กรุณารอสักครู่แล้วกดอัปเดตข้อมูล ยังไม่ต้องเริ่มรายการใหม่'); setReload(value => value + 1); }   // reservation ค้าง (billing.service.ts:749-751) ห้าม retry
      else { setQuote(null); setChoosing(false); setReload(value => value + 1); }   // เดิม (PENDING ฯลฯ — billing-advance-deal.spec.ts:89,125-130)
    })}>{busy ? 'กำลังตรวจสอบ…' : 'ยืนยันและไปชำระที่ Stripe'}</button></div>}
  ```
- `setError` ของ FAILED เป็นข้อความ UI-authored (ไม่ใช่ `.message` ของ API) → ผ่าน `no-raw-api-error-display.spec.ts`

**(g) โหมดจ่าย (G24; :472-475, :497-498)**

```tsx
const otherModesId = useId();
const [otherModesOpen, setOtherModesOpen] = useState(false);
const primaryMode: BillingPurchaseMode = 'CARD_AUTO';
const otherModes = displayedModes.filter(mode => mode !== primaryMode);
const otherModesExpanded = otherModesOpen || !displayedModes.includes(primaryMode) || chosenMode !== primaryMode;   // auto-open เมื่อค่าเริ่มต้น/ที่เลือกอยู่ข้างใน
const modeRadio = (mode: BillingPurchaseMode) => <label key={mode} className="flex min-h-11 items-center gap-3"><input type="radio" name="purchaseMode" checked={chosenMode === mode} onChange={() => { setPurchaseMode(mode); setQuote(null); setCapacity(null); }} />{billingPurchaseModeLabel(mode)}</label>;
<fieldset className="space-y-2"><legend className="font-semibold">วิธีชำระและต่ออายุ</legend>
  {displayedModes.includes(primaryMode) && modeRadio(primaryMode)}
  {otherModes.length > 0 && <>
    <button type="button" className={billingBackControl} aria-expanded={otherModesExpanded} aria-controls={otherModesId} onClick={() => setOtherModesOpen(value => !value)}>วิธีชำระอื่น</button>
    <div id={otherModesId} hidden={!otherModesExpanded} className="space-y-2">{otherModes.map(modeRadio)}</div>
  </>}
</fieldset>
```
- ใช้ `<button aria-expanded>` (ไม่ใช่ `<details>`) เพื่อให้ e2e `getByRole('button', { name: 'วิธีชำระอื่น' })` และ `aria-expanded` ตรวจได้เหมือน `เลือกพนักงานเพิ่ม`; label radio **ไม่เปลี่ยน** (`billing-display.spec.ts:35`, `billingPurchaseModeLabel` `billing-display.ts:42-45`); การ์ดดีล `:460-463` **ไม่แตะ**
- `:497-498` การ์ดรายปี: หลัง `<p className="text-xl font-bold">{money(offer.priceSatang)} / ปี</p>` เพิ่ม `{interval === 'year' && <p className="text-sm text-gray-600">เฉลี่ยเดือนละ {money(Math.round(offer.priceSatang / 12))}</p>}` (บรรทัด "ใช้งาน 12 เดือน · ประหยัด …" คง — `billing-preview.spec.ts:36`); ถ้า `data.catalog.taxTreatment === 'EXCLUSIVE_VAT_7'` เพิ่ม `<p className="text-sm text-gray-600">ราคายังไม่รวม VAT 7%</p>` ทุกการ์ด (plan P5 ข้อ 3; นโยบายปัจจุบัน NOT_VAT_REGISTERED จึงไม่แสดง)

**(h) route error ด้วย code + แบนเนอร์ตีกลับ (G16/F15, R-A7)**

- state `const [errorCode, setErrorCode] = useState<string | null>(null);` ตั้งพร้อม `setError` ทุกจุด (action catch, :161, :199); ล้างพร้อม `setError('')`
- `:123` ครึ่งหลัง `useEffect(() => { if (error.includes('อีเมล') || error.includes('ผู้รับเอกสาร')) {…} }, [error])` → `useEffect(() => { if (error && ['BILLING_EMAIL_UPDATE_PENDING', 'BILLING_RECIPIENT_UPDATE_REQUIRED', 'BILLING_EMAIL_CHANGED', 'BILLING_RECIPIENT_BOUNCED'].includes(errorCode ?? '')) { setSection('payment'); emailSettings.current?.scrollIntoView({ block: 'start' }); } }, [error, errorCode]);`
- `bounceBanner` (แสดงทั้งใน overview ใต้ `:341` และเหนือแผงผู้รับ (b)):
  ```tsx
  const bounceBanner = status.recipient?.bouncedAt ? <div role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
    <p className="font-semibold">อีเมลรับเอกสารส่งไม่ถึง แก้ไขได้ที่นี่</p>
    <p className="text-sm break-all">ระบบส่งเอกสารไปที่ {status.recipient.email} ไม่สำเร็จ กรุณาแก้อีเมลรับเอกสาร แล้วกดส่งเอกสารอีกครั้ง</p>
    <button className={button} disabled={busy} onClick={openRecipientEditor}>แก้อีเมลรับเอกสาร</button>
  </div> : null;
  ```

**(i) locked shell (F20/F22)** — ไม่แก้ `:304-307` (frame); การซ่อน header/ลิงก์วนทำที่ layout (§3.8); ใน bare recovery view (`BillingWorkspaceLayout` 'recovery' — notice ไม่ EXPIRED แต่ status ไม่ ACTIVE เช่น HELD) ลิงก์ `กลับหน้าเลือกบริษัท` คงเดิม (`customer-billing-ux.spec.ts:124-133`)

**(j) label ร้านล็อก `:341-347`** — PR B แก้ (helper `planTermStateLabel`); PR D ไม่แตะ

### 3.5 `BillingPreviewPage.tsx` + `billing-preview.fixture.ts`

- `BillingPreviewPage.tsx:22-23` ลบ `readAccountEmail: async () => ({ … })` (prop ถูกถอด)
- fixture (`ReturnType<typeof billingApi>` ต้องครบ):
  - `:37` status เพิ่ม `recipient: paid ? { email: 'preview@example.com', source: 'STRIPE_CHECKOUT', bouncedAt: null } : null, checkoutAddress: paid ? { line1: '99 ถนนตัวอย่าง', line2: null, subdistrict: '', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110' } : null`
  - `:98` history item เพิ่ม `documentActions: { canResend: true }`
  - `:105` quote: `billingEmail` ใน object quote (2 จุด `:128`, `:151`) → `billingEmail: paid ? 'preview@example.com' : null` (ฉาก start/expired/manual = "จะกรอกที่หน้าชำระเงิน")
  - `:193` `recipient` คง; `:195` `recipientPreview: async () => { throw … }` → `recipientPreview: async proofId => { recipient = { id: 'preview-recipient-op', state: 'PREVIEW', version: 1, previewHash: 'preview-hash', expiresAt: date(1), previousEmail: 'preview@example.com', newEmail: proofId ? 'new@example.com' : 'preview@example.com', canSubmit: true, canCancel: true }; return recipient; }`
  - เพิ่ม `recipientOtpRequest: async email => ({ challengeId: 'preview-challenge', email, expiresAt: date(1), retryAt: date(), attemptsRemaining: 5, deliveryStatus: 'ACCEPTED', delivered: true, serverNow: date() })`, `recipientOtpConfirm: async () => ({ recipientProofId: 'preview-proof', email: 'new@example.com', expiresAt: date(1) })`, `resendDocument: async () => ({ sentTo: 'preview@example.com', invoice: 'SENT', receipt: 'SENT', remainingToday: 2 })`
  - ไม่เพิ่มฉากใหม่ (ฉาก `pending` ใช้ทดสอบ one-tap; `?checkout=canceled` ทดสอบใน e2e ใหม่)

### 3.6 `apps/web/src/features/billing/BillingEmailRecipientPanel.tsx` — rewrite (R-A8/R-D2, F03/F04/F06)

Props ใหม่: `{ companyId: string; status: BillingStatus; latestInvoice?: BillingInvoiceItem | null; openRequest?: number; onChanged?: () => void; apiOverride?: ReturnType<typeof billingApi> }` (ถอด `email/ready/accountHref`)

โครงสร้าง state:
```ts
type Step = 'idle' | 'choose' | 'code_sent' | 'previewed' | 'op_pending' | 'done';
const [current, setCurrent] = useState<BillingEmailRecipient | null>(null);   // GET /recipient เหมือนเดิม :11-15
const [account, setAccount] = useState<AccountEmailOtpState | null>(null);   // อ่าน getAccountEmailOtp() ครั้งเดียวตอนเปิด editor (ไม่ poll) เพื่อตัดสินว่าจะเสนอทาง A ไหม
const [step, setStep] = useState<Step>('idle'); const [newEmail, setNewEmail] = useState(''); const [code, setCode] = useState('');
const [challenge, setChallenge] = useState<BillingRecipientOtpChallenge | null>(null); const [proof, setProof] = useState<BillingRecipientProof | null>(null);
const [operation, setOperation] = useState<BillingEmailRecipientOperation | null>(null);   // polling QUEUED/RUNNING/RECONCILING ทุก 4 วิ เหมือน :16-24
const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false); const [retryAt, setRetryAt] = useState(0); const [resent, setResent] = useState<BillingDocumentResendResult | null>(null);
const requestKey = useRef<{ email: string; key: string } | null>(null);
const attemptActive = Boolean(status.attemptId && status.applyState !== 'APPLIED' && status.paymentState !== 'FAILED');   // F04
const canEdit = Boolean(current?.hasCustomer) && !attemptActive && !current?.busy;
```
- `useEffect(() => { if (openRequest) { setStep('choose'); void loadAccount(); } }, [openRequest]);` — เปิดจาก return page / กล่อง quote / แบนเนอร์ตีกลับ
- ทาง A "ใช้อีเมลบัญชีที่ยืนยันแล้ว": แสดงเมื่อ `account?.emailRequirement === 'READY' && account.email && account.email !== current?.email` → `recipientPreview()` (ไม่มี proof) → `previewed`; error `BILLING_EMAIL_VERIFICATION_REQUIRED` → ข้อความ §3.3 + ลิงก์ `accountHref` (= `status.accessState === 'ACTIVE' ? …/settings/profile#account : /account/email?company=…` ย้ายมาจาก `BillingPage.tsx:284-285`)
- ทาง B "ใช้อีเมลอื่น": `<input type="email" required maxLength={254}>` → "ขอรหัสยืนยัน" → `recipientOtpRequest(email, requestKey)` (`requestKey` = uuid ต่ออีเมล ใช้ซ้ำเมื่อกด "ขอรหัสใหม่") → `code_sent`: input 6 หลัก (`inputMode="numeric" autoComplete="one-time-code"`), "ยืนยันรหัส" → `recipientOtpConfirm(challengeId, code)` → `proof` → `recipientPreview(proof.recipientProofId)` → `previewed`; "ขอรหัสใหม่ได้ใน N วินาที" นับจาก `challenge.retryAt`/`retryAfterSeconds` (tick 1 วิ เฉพาะตอน code_sent); "ยกเลิก" → `choose`
- `previewed`: "จาก {previousEmail ?? 'ยังไม่ระบุ'} เป็น **{newEmail}**" + "ยืนยันเปลี่ยนผู้รับเอกสาร" (`recipientSubmit`, key `billing-recipient-<id>` เดิม) + "ยกเลิกคำขอ" (`recipientCancel`)
- `op_pending`: copy เดิม `:45` (RECONCILING/QUEUED/RUNNING); เมื่อ COMPLETED → `done` + `onChanged()` (BillingPage reload status → `recipient.email` ใหม่, `bouncedAt` ล้าง)
- `done`: "เปลี่ยนผู้รับเอกสารเป็น {newEmail} แล้ว เอกสารใหม่จะส่งไปที่อีเมลนี้" + ถ้า `latestInvoice?.documentActions?.canResend` ปุ่ม "ส่งเอกสารล่าสุดไปอีเมลใหม่" → `resendDocument(latestInvoice.id)` → ข้อความ §4 (resend); ปุ่ม "ปิด" → `idle`
- `idle`: "ผู้รับปัจจุบัน: **{current.email ?? 'ยังไม่ระบุ'}**" + ปุ่ม "แก้อีเมลรับเอกสาร" (`disabled={!canEdit}`) + ถ้า `attemptActive` บรรทัด "แก้อีเมลรับเอกสารได้เมื่อรายการชำระเงินปัจจุบันเปิดสิทธิ์เสร็จ"; ถ้า `current.operation` ค้างจากครั้งก่อน แสดงเป็น `previewed`/`op_pending` ตาม state (เหมือน `:13`)
- ซ่อนทั้งแผงเมื่อ `!current?.hasCustomer && !error` (เหมือน `:36`) — ร้านที่ยังไม่เคยซื้อไม่มีผู้รับให้แก้; heading `aria-label="ผู้รับเอกสารของบริษัท"` และ `<h2>อีเมลรับเอกสารของบริษัท</h2>` คง (e2e เดิมอ้าง)
- error ทั้งหมดผ่าน `apiErrorMessage(e)`; ปุ่มทุกปุ่ม `min-h-11`; input `min-w-0 w-full`; อีเมล `break-all`

### 3.7 `apps/web/src/features/billing/BillingAdjustmentsPage.tsx` (R-D1; customer เท่านั้น `!admin`)

- state: `const [resend, setResend] = useState<{ busy: boolean; result: BillingDocumentResendResult | null; error: string }>({ busy: false, result: null, error: '' });`
- ใต้รายการเอกสาร `:81` (ในบล็อก `data.canOpenDocuments`) เพิ่มเมื่อ `!admin && data.documentActions?.canResend`:
  ```tsx
  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 py-4"><div><h3 className="font-medium">ส่งเอกสารไปอีเมลอีกครั้ง</h3><p className="mt-1 text-gray-600 break-all">ส่งใบแจ้งหนี้และใบเสร็จของรายการนี้ไปที่ {data.recipientEmail ?? 'อีเมลรับเอกสารของบริษัท'}</p></div>
    <button className={button} disabled={resend.busy || opening} aria-busy={resend.busy} onClick={() => void resendDocument()}>ส่งเอกสารไปอีเมลอีกครั้ง</button></div>
  {resend.result && <p role="status" className="rounded-xl bg-green-50 p-3">{resendText(resend.result)}</p>}
  {resend.error && <p role="alert" className="rounded-xl bg-red-50 p-3">{resend.error}</p>}
  ```
  `resendDocument = async () => { setResend({ busy: true, result: null, error: '' }); try { const result = await billingApi(companyId).resendDocument(invoiceId); setResend({ busy: false, result, error: '' }); } catch (cause) { setResend({ busy: false, result: null, error: apiErrorMessage(cause) }); } }` (preview: `preview?.resend?.()` optional — `BillingPreviewPage.tsx:34-38` เพิ่ม `resend: async () => ({ invoiceSent: true, receiptUpdated: true, recipientEmail: 'preview@example.com', remainingToday: 2 })`)
  `resendText(r) = r.receiptUpdated ? 'ส่งเอกสารไปที่ ${r.recipientEmail} แล้ว ตรวจกล่องจดหมายและโฟลเดอร์สแปม · วันนี้ส่งซ้ำได้อีก ${r.remainingToday} ครั้ง' : 'ส่งใบแจ้งหนี้ไปที่ ${r.recipientEmail} แล้ว ใบเสร็จไม่ส่งซ้ำเพราะอีเมลไม่เปลี่ยน เปิดได้จากปุ่มด้านบน · วันนี้ส่งซ้ำได้อีก ${r.remainingToday} ครั้ง'` (รูปผลลัพธ์ตาม PR C §4.10)
- ลิงก์ "แก้อีเมลรับเอกสาร" ในหน้านี้ → `href={\`/companies/${companyId}/billing#billing-recipient\`}` และ BillingPage: ถ้า hash `#billing-recipient` → `setSection('payment'); setRecipientOpen(1)` (เพิ่มในเคส `:91-94` selectHash)
- `:107` เลขอ้างอิง คง; `:110` frame คง

### 3.8 `WorkspaceLayout.tsx` (F22/F20) — **RV30/G14 เป็นของ PR B** (ตัดสิน 2026-09-27)

- `PLAN_TERM_CHANGED_EVENT` + `notifyPlanTermChanged()` ใน `plan-term.api.ts`, listener ใน `WorkspaceLayoutClient` (revision counter + focus/visibility เฉพาะตอนล็อก + `router.refresh()` เมื่อปลดล็อก) และ effect dispatch ใน `BillingPage` หลัง `confirmed` — ทั้งหมดอยู่ใน **pr-b §3.14** และ merge ก่อน PR D; PR D **ห้าม**เพิ่ม listener/constant ซ้ำ; fallback reload 5 วิ (§3.4 e) ให้ต่อใน effect เดิมของ PR B
- งานของ PR D ในไฟล์นี้มีข้อเดียว: `LockedWorkspaceLayout` `:135-139` ครอบ children ด้วย `<BillingWorkspaceContext.Provider value={true}>` (ภายใน `LockedShellProvider` เดิม) → `BillingCustomerFrame.tsx:11-13` render `MangmeePage` (ไม่มี header ที่สอง, ไม่มีลิงก์ "กลับหน้าเลือกบริษัท" ที่วน `/billing/companies → / → /renew`; sidebar มี ตั้งค่า/แพ็กเกจ อยู่แล้ว `web-core-workspace.logic.ts:364-384`); `BillingAdjustmentsPage` ยังมีปุ่ม "กลับไปประวัติการชำระเงิน" เพราะ `showBackInWorkspace` (`:110`); back link ของ PR B (§3.15 F20 → settings) ไม่ถูก render ใน locked shell — ปล่อยไว้ ไม่ต้องถอด
- guard `result !== null &&` ก่อนถือว่าปลดล็อกเมื่อ endpoint ล่ม (pr-b §9) ต้องอยู่ในโค้ดของ PR B แล้ว — PR D ตรวจตอน rebase

### 3.9 `apps/web/src/features/company-profile/CompanyProfilePage.tsx` (+ `company-profile.logic.ts`)

- **F29** `:198-201` `if ('error' in plan) { setShopError(plan.error); return; }` → `if ('error' in plan) { if (plan.error === NO_CHANGES_MESSAGE && billingReturnHref) { window.location.assign(billingReturnHref); return; } setShopError(plan.error); return; }` (import `NO_CHANGES_MESSAGE` จาก logic; spec pins `company-profile.logic.spec.ts:113,474,513` ไม่เปลี่ยนเพราะ logic คืน error เดิม)
- **ปุ่ม "ใช้ที่อยู่จากการชำระเงิน" (DQ5)**: state `const [checkoutAddress, setCheckoutAddress] = useState<CompanyLegalAddress | null>(null);` effect: `if (!canEditShop || !permissions.includes('company.plan.manage')) return; void billingApi(companyId).status().then(status => setCheckoutAddress(status.checkoutAddress ?? null)).catch(() => {});` (status ต้อง `assertOwner` → อ่านเฉพาะผู้มี `company.plan.manage`; ล้มเหลวเงียบ) — ใต้ `:412-416` (address fields) เมื่อ `checkoutAddress && checkoutAddressDiffers(checkoutAddress, address)`:
  ```tsx
  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm sm:col-span-2"><p>มีที่อยู่ที่กรอกไว้ตอนชำระเงิน: <span className="break-words">{checkoutAddressText(checkoutAddress)}</span></p>
    <button type="button" className={`${ACTION_BUTTON} mangmee-btn-secondary mt-2`} disabled={shopSaving} onClick={() => setAddress(current => ({ ...current, ...checkoutAddressToForm(checkoutAddress) }))}>ใช้ที่อยู่จากการชำระเงิน</button>
    <p className="mt-1 text-gray-600">เติมลงฟอร์มให้ตรวจก่อน ยังไม่บันทึกจนกว่าจะกดบันทึกข้อมูลร้าน</p></div>
  ```
  helper ใน `company-profile.logic.ts` (pure, มี spec): `checkoutAddressToForm(a: CompanyLegalAddress): Partial<CompanyLegalAddress>` = คืนเฉพาะช่องที่ไม่ว่าง (`line1, line2, postalCode, province, district, subdistrict`); `checkoutAddressText(a)` = join ช่องที่ไม่ว่างด้วยช่องว่าง; `checkoutAddressDiffers(a, form)` = มีช่องใดใน a ที่ไม่ว่างและต่างจาก form. `ThaiAddressFields` จะ lookup จาก `postalCode` (`ThaiAddressFields.tsx:27-60` debounce 300 ms + `autofillThaiAddress`) และคง province/district ที่เติมไว้ถ้าอยู่ในตัวเลือก; `subdistrict` ว่าง → ผู้ใช้เลือกเอง; บันทึกผ่าน `saveShop` เดิม (identity use case ต้องครบ 5 ช่อง — ถ้าไม่ครบ error ไทยจาก `addressErrorMessages` เดิม `:210-212`)
- **hint/required (`:346`, `:412`)**: `:346` `hint="ใช้ตอนออกใบกำกับภาษีและเอกสารทางการ ถ้ายังไม่มีก็เว้นไว้ก่อนได้ค่ะ"` → `hint="ใช้ออกใบแจ้งหนี้ ใบเสร็จ และเอกสารทางการ ไม่ต้องกรอกก่อนซื้อแพ็กเกจ (กรอกที่หน้าชำระเงินได้) ถ้ากรอกที่อยู่ให้กรอกครบทุกช่องค่ะ"`; `:412` คง `required showRequiredMark` (กติกา identity: ถ้ามีที่อยู่ต้องครบ 5 ช่อง) — ความหมายของเครื่องหมาย * ตรงกับ hint ใหม่
- `:457-459` ปุ่ม "บันทึกและกลับไปซื้อแพ็กเกจ"/"กลับไปซื้อแพ็กเกจ" คง

### 3.10 `apps/web/src/features/plan-term/CompanyTermExpiredPage.tsx:98` (F28)

`<a className="mangmee-btn mangmee-btn-secondary mt-2.5 w-full" href={…/settings/profile}>กรอกข้อมูลบริษัท</a>` → `<a className="mt-3 inline-flex min-h-11 w-full items-center justify-center text-sm text-brand-700 underline" href={\`/companies/${companyId}/settings/profile#shop\`}>เติมข้อมูลร้านไว้ล่วงหน้า (ไม่บังคับ)</a>` และย้ายไปอยู่ **ใต้** ปุ่มโทร/อีเมล (ลำดับ: เลือกแพ็กเกจ → โทร → อีเมล → ลิงก์ข้อมูลร้าน)

### 3.11 `apps/web/app/account/email/page.tsx:25`

`description="ยืนยันอีเมลแล้วกลับไปเลือกแพ็กเกจได้ การยืนยันอีเมลยังไม่ใช่การชำระเงิน"` → `description="อีเมลบัญชีใช้เข้าสู่ระบบสำรองและรับแจ้งเตือน ไม่ต้องยืนยันก่อนซื้อแพ็กเกจ ส่วนอีเมลรับเอกสารกรอกได้ที่หน้าชำระเงิน"`; `:23` (OWNER role → `company.plan.manage`) = PR B; title/backLabel คง (`plan-term-billing-readiness.spec.ts:643-648`, `customer-billing-ux.spec.ts:137-143`)

### 3.12 ไม่แตะ

`billing-profile-navigation.ts` (ใช้ที่ §3.4 d และ `CompanyProfilePage.tsx:4,103`; `ci.yml:545` ตั้งชื่อ spec), `billing-display.ts`, `BillingCollectionPanel.tsx`, `BillingCapacityPicker.tsx`, `BillingCustomerFrame.tsx`, `PlanTermBanner.tsx`, `AccountEmailOtpPanel.tsx` (PR B ทั้งไฟล์ — ข้อความ E1/E2 ของ pr-b §4 เป็นข้อความสุดท้าย ใช้ได้ทั้งก่อน/หลัง PR C; PR D ไม่แตะไฟล์นี้ — ตัดสิน 2026-09-27)

## 4. UI states และข้อความ (ไทย)

| จุด | เงื่อนไข | ข้อความ/ปุ่ม |
|---|---|---|
| overview กล่องข้อมูล | `new_sales` + `billingProfile.missingFields.length > 0` | "เอกสารจะออกในชื่อ **{ชื่อ}** · ที่อยู่กรอกได้ที่หน้าชำระเงิน หรือ [เติมล่วงหน้าที่ข้อมูลร้าน]" |
| overview แบนเนอร์ตีกลับ | `recipient.bouncedAt` | "อีเมลรับเอกสารส่งไม่ถึง แก้ไขได้ที่นี่" / "ระบบส่งเอกสารไปที่ {อีเมล} ไม่สำเร็จ กรุณาแก้อีเมลรับเอกสาร แล้วกดส่งเอกสารอีกครั้ง" [แก้อีเมลรับเอกสาร] |
| chooser โหมดจ่าย | เสมอ | "วิธีชำระและต่ออายุ": ◉ บัตร · ต่ออายุอัตโนมัติ · [วิธีชำระอื่น ▾] → บัตร · จ่ายครั้งเดียว / PromptPay QR · จ่ายครั้งเดียว / PromptPay QR · สแกนบิลทุกงวด |
| การ์ดรายปี | `interval === 'year'` | "฿4,990.00 / ปี" · "เฉลี่ยเดือนละ ฿415.83" · "ใช้งาน 12 เดือน · ประหยัด ฿…" |
| หน้ายืนยัน กล่องเอกสาร | เสมอ | "ข้อมูลออกเอกสาร" ชื่อบนเอกสาร {ชื่อ} · ที่อยู่ {ที่อยู่ \| จะกรอกที่หน้าชำระเงิน} · อีเมลรับเอกสาร {อีเมล \| จะกรอกที่หน้าชำระเงิน} [แก้ไขข้อมูลบริษัท] [แก้อีเมลรับเอกสาร — เมื่อ `recipient.email`] |
| หน้ายืนยัน quote หมดอายุ | `quoteExpired` | "ราคานี้หมดอายุแล้ว กดตรวจสอบราคาใหม่" [ตรวจสอบราคาใหม่] |
| checkout FAILED | `state === 'FAILED'` ไม่มี URL | alert "ยังเปิดหน้าชำระเงินไม่ได้ กรุณาตรวจสอบราคาใหม่แล้วลองอีกครั้ง" (อยู่ที่ chooser) |
| checkout UNKNOWN | `state === 'UNKNOWN'` | status "กำลังตรวจกับ Stripe ว่าหน้าชำระเงินถูกสร้างหรือไม่ กรุณารอสักครู่แล้วกดอัปเดตข้อมูล ยังไม่ต้องเริ่มรายการใหม่" (ไม่มีปุ่ม retry; ปุ่ม "ตรวจผลการชำระเงินอีกครั้ง"/"กลับไปยังรายการเดิม" เดิมแสดงตาม status) |
| return PENDING (ยังไม่ครบ 3 นาที) | polling | หัวข้อ "กำลังตรวจสอบรายการชำระเงิน" (เดิม) |
| return ครบ 3 นาที | `timedOut` | "ยังยืนยันผลไม่ได้ กรุณาตรวจสอบรายการเดิมก่อนชำระใหม่ หรือติดต่อทีมงานพร้อมเลขอ้างอิง" (เดิม :373) + ปุ่มเดิม |
| return PAID ยังไม่ APPLIED | attempt PAID/PENDING | หัวข้อ "ชำระแล้ว กำลังตรวจสอบการเปิดสิทธิ์" (เดิม) · "ส่งเอกสารไปที่ **{อีเมล}**" · [แก้อีเมลรับเอกสาร] disabled · "แก้อีเมลได้เมื่อเปิดสิทธิ์เสร็จ (อีกสักครู่)" |
| return APPLIED | `returnComplete` | หัวข้อ "ชำระแล้ว เปิดใช้งานแล้ว" (เดิม) · "ส่งเอกสารไปที่ **{อีเมล}**" · [แก้อีเมลรับเอกสาร] enabled; shell ปลดล็อกเอง |
| return HELD | applyState HELD | หัวข้อเดิม ("ชำระแล้ว ต้องตรวจสอบก่อนเริ่มดีล" หรือผ่าน pendingDeal) + หยุด polling |
| return canceled | `?checkout=canceled` + ไม่ PAID | หัวข้อ "ยังไม่ได้ชำระ" · [เลือกแพ็กเกจใหม่] (primary) · [กลับไปยังรายการเดิม] (เดิม) |
| one-tap ยุติ | EXPIRED | status "ยุติหน้าชำระเงินเดิมแล้ว เลือกแพ็กเกจใหม่ได้เลย" → chooser เปิด |
| one-tap ยุติ | COMPLETED | status "รายการเดิมชำระสำเร็จแล้ว ระบบกำลังเปิดสิทธิ์ให้ ไม่ต้องซื้อใหม่" (ไม่เปิด chooser) |
| one-tap ยุติ | PENDING | status "กำลังตรวจผลรายการเดิมกับ Stripe กรุณารอสักครู่แล้วกดอัปเดตข้อมูล" |
| แผงผู้รับ idle | `hasCustomer` | "อีเมลรับเอกสารของบริษัท" · "ผู้รับปัจจุบัน: **{อีเมล}**" · [แก้อีเมลรับเอกสาร] (+ "แก้อีเมลรับเอกสารได้เมื่อรายการชำระเงินปัจจุบันเปิดสิทธิ์เสร็จ" เมื่อ attempt ค้าง) |
| แผงผู้รับ choose | — | "เลือกวิธีตั้งอีเมลรับเอกสาร" ◯ ใช้อีเมลบัญชีที่ยืนยันแล้ว ({อีเมลบัญชี}) [เฉพาะ READY] ◯ ใช้อีเมลอื่น → ช่อง "อีเมลรับเอกสารใหม่" [ขอรหัสยืนยัน] [ยกเลิก] |
| แผงผู้รับ code_sent | challenge | "ส่งรหัส 6 หลักไปที่ **{อีเมล}** แล้ว ตรวจกล่องจดหมายและโฟลเดอร์สแปม · กรอกได้อีก {n} ครั้ง" · ช่อง "รหัสยืนยัน 6 หลัก" · [ยืนยันรหัส] [ขอรหัสใหม่ / ขอรหัสใหม่ได้ใน {N} วินาที] [ยกเลิก] ; `delivered=false` → "ยังยืนยันผลการส่งไม่ได้ หากได้รับรหัสกรอกได้เลย หรือรอขอรหัสใหม่" |
| แผงผู้รับ previewed | operation PREVIEW | "จาก {เดิม} เป็น **{ใหม่}** · มีผลกับเอกสารใหม่ของบริษัทนี้" [ยืนยันเปลี่ยนผู้รับเอกสาร] [ยกเลิกคำขอ] |
| แผงผู้รับ op_pending | QUEUED/RUNNING | "กำลังดำเนินการ" · RECONCILING: "กำลังตรวจผลกับผู้ให้บริการ หากยังไม่สำเร็จ ติดต่อทีมมั่งมีพร้อมเลขอ้างอิงด้านล่าง" (เดิม :45) |
| แผงผู้รับ done | COMPLETED | "เปลี่ยนผู้รับเอกสารเป็น **{ใหม่}** แล้ว เอกสารใหม่จะส่งไปที่อีเมลนี้" [ส่งเอกสารล่าสุดไปอีเมลใหม่ — เมื่อ canResend] [ปิด] |
| resend สำเร็จ | `receipt !== 'LINK'` | "ส่งเอกสารไปที่ {อีเมล} แล้ว ตรวจกล่องจดหมายและโฟลเดอร์สแปม · วันนี้ส่งซ้ำได้อีก {n} ครั้ง" |
| resend สำเร็จ | `receiptUpdated === false` | "ส่งใบแจ้งหนี้ไปที่ {อีเมล} แล้ว ใบเสร็จเปิดได้จากปุ่มด้านบน · วันนี้ส่งซ้ำได้อีก {n} ครั้ง" |
| resend/OTP error | ตาม code | ตาราง §2.3 (ค) ผ่าน `apiErrorMessage` |
| `/renew` | canManagePlan | ปุ่มเดิม + ลิงก์ "เติมข้อมูลร้านไว้ล่วงหน้า (ไม่บังคับ)" |
| ข้อมูลร้าน | `checkoutAddress` ต่างจากฟอร์ม | "มีที่อยู่ที่กรอกไว้ตอนชำระเงิน: {ที่อยู่}" [ใช้ที่อยู่จากการชำระเงิน] "เติมลงฟอร์มให้ตรวจก่อน ยังไม่บันทึกจนกว่าจะกดบันทึกข้อมูลร้าน" |

ทุกปุ่ม/ลิงก์ `min-h-11`; ข้อความอีเมล `break-all`; กล่องกว้าง `min-w-0`; ห้ามคำว่า "ทดลองใช้"/รหัส/enum ในข้อความใหม่

## 5. Tests

### 5.1 web unit (auto ผ่าน `pnpm test` → `tsx --test "src/**/*.spec.ts"` `apps/web/package.json:10`; `ci.yml:506`)

1. `apps/web/src/common/api/api-error-coverage.spec.ts:50-53` เพิ่ม regex ตัวที่สาม: `...source.matchAll(/billingError\(\s*'([A-Za-z][A-Za-z0-9_:-]{3,})'/g),` → assertion เดิม (`:70-77`) จะบังคับให้ทุกรหัสใน §2.3 (ก)(จ) มีไทย (RV28); ไม่มี exemption ใหม่
2. ใหม่ `apps/web/src/features/billing/billing-error-text.spec.ts`: สแกน `apps/api/src/modules/billing` ด้วย regex เดียวกับข้อ 1 (คัดลอก `sourceFiles` แบบ `api-error-coverage.spec.ts:32-40`, path `join(__dirname, '../../../../api/src/modules/billing')`) → สำหรับทุก code: `errorText({ code, status: 409 })` ≠ `BILLING_GENERIC_ERROR`, ไม่ match `/[A-Z_]{4,}/`; เพิ่มเคส: `errorText({ status: 429 })` = 'กรุณารอสักครู่แล้วลองใหม่'; `errorText({ status: 503, code: 'BILLING_PROVIDER_UNAVAILABLE', message: 'temporary provider outage' })` = `BILLING_GENERIC_ERROR` (F14: ไม่ passthrough); `errorText({ code: 'BILLING_PLAN_CHANGE_REQUIRED' })` match `/บิล QR/`; `errorText({ code: 'BILLING_LEGACY_REVIEW_REQUIRED' })` = generic (mapping ตายถูกลบ); รหัสใหม่ทั้ง 11 ใน (ค) มีไทย
3. `no-raw-api-error-display.spec.ts` — ไม่แก้; แผงผู้รับ/adjustments ใช้ `apiErrorMessage(` ทุกจุด
4. `billing-display.spec.ts:35` — ไม่แก้ (label เดิม)
5. `company-profile.logic.spec.ts` เพิ่ม 1 test: `checkoutAddressToForm` คืนเฉพาะช่องไม่ว่าง; `checkoutAddressDiffers` false เมื่อฟอร์มเท่ากัน; `:113,474,513` ไม่แตะ
6. `billing-profile-navigation.spec.ts` — คง (ci.yml:545)
7. ถ้าเพิ่ม helper ใน `plan-term.api.ts` ไม่ต้องมี spec (constant)

### 5.2 e2e ที่มีอยู่ (playwright project `chromium` auto glob `e2e/*.spec.ts`; รันจริงใน Extended Tests)

**`e2e/customer-billing-ux.spec.ts`**
- `:63-87` (test "reads account email without an editor…") → เขียนใหม่ชื่อ "BILLING-UX recipient panel offers the verified account email only when it is verified and never reads it for buying": route `**/billing` (GET) = ของจริง + `recipient: { email: 'accounts@example.com', source: 'STRIPE_CHECKOUT', bouncedAt: null }`; route `**/billing/recipient` = `{ hasCustomer: true, email: 'accounts@example.com', operation: null, busy: false }`; route otp GET เหมือนเดิม (`requirement` เปลี่ยนได้); นับ request ไป `/auth/account/email/otp` ก่อนเปิดแท็บ = **0** (BillingPage ไม่อ่านแล้ว); เปิดแท็บ "การต่ออายุและชำระเงิน" → region 'ผู้รับเอกสารของบริษัท' มี 'accounts@example.com'; คลิก 'แก้อีเมลรับเอกสาร' → เห็น radio 'ใช้อีเมลบัญชีที่ยืนยันแล้ว' (มี owner@example.com) และ 'ใช้อีเมลอื่น'; ตั้ง `failRead=true` → คลิก 'ยกเลิก' แล้ว 'แก้อีเมลรับเอกสาร' อีกครั้ง → radio อีเมลบัญชี count 0, 'ใช้อีเมลอื่น' ยังมี, ไม่มี alert 'ยังตรวจสอบอีเมลบัญชีไม่ได้'; `requirement='CHANGE_PENDING'` → radio อีเมลบัญชี count 0; assert เดิม: region 'อีเมลบัญชีของฉัน' count 0, ปุ่ม 'เปลี่ยนอีเมล' count 0
- `:98`, `:111` — คง (503 → 'ยังยืนยันผลรายการไม่ได้')
- `:137-143` — คง; เพิ่ม `await expect(page.getByText('ไม่ต้องยืนยันก่อนซื้อแพ็กเกจ')).toBeVisible()` หลัง `:135`
- test 1 `:8-61` — คง (assert 'ยืนยันอีเมลก่อนชำระเงิน' count 0 ยังจริง)

**`e2e/billing-preview.spec.ts`** (ทุก `.check()` บน radio ที่ซ่อนใน expander ต้องเปิดก่อน — F24)
- หลัง `:36` เพิ่ม `await expect(plans).toContainText('เฉลี่ยเดือนละ ฿415.83');` (STARTER 4,990/ปี? — ใช้ค่าจริงของ `billingOffer('STARTER_249','year')`; คำนวณ `Math.round(price/12)` ตอนเขียน spec)
- หลัง `:48` เพิ่ม `const review = page.getByRole('region', { name: 'ยืนยันซื้อแพ็กเกจ', exact: true }); await expect(review.getByLabel('ข้อมูลออกเอกสาร')).toContainText('จะกรอกที่หน้าชำระเงิน'); await expect(review.getByRole('button', { name: 'แก้อีเมลรับเอกสาร' })).toHaveCount(0);`
- `:228-229` คง + เพิ่ม `await expect(plans.getByRole('button', { name: 'วิธีชำระอื่น' })).toHaveAttribute('aria-expanded', 'true');` (ฉาก one-time: ค่าเริ่มต้น CARD_ONCE อยู่ข้างใน → เปิดอัตโนมัติ)
- `:243` คง (expander เปิดอยู่)
- `:262` ก่อน `.check()` เพิ่ม `await plans.getByRole('button', { name: 'วิธีชำระอื่น' }).click();` (ฉาก upgrade: ค่าเริ่มต้น CARD_AUTO อยู่นอก); `:263`, `:266` คง
- `:463-467` ฉาก pending → แทนด้วย: `await page.getByRole('button', { name: 'เลือกแพ็กเกจใหม่', exact: true }).click(); await expect(page.getByText('ยุติหน้าชำระเงินเดิมแล้ว เลือกแพ็กเกจใหม่ได้เลย', { exact: true })).toBeVisible(); await expect(plans).toBeVisible(); await expect(page.getByRole('button', { name: 'ยุติรายการที่ยังไม่ชำระ' })).toHaveCount(0);`
- `:470`, `:488` ก่อน `.check()` 'บัตร · จ่ายครั้งเดียว' เพิ่มคลิก 'วิธีชำระอื่น'; `:475`, `:479` คง (expander เปิดค้างเพราะโหมดที่เลือกอยู่ข้างใน)
- `:32`, `:51-53`, `:67` คง

**`e2e/billing-advance-deal.spec.ts`**
- `:25` (billingProfile ครบ), `:55` (`billingEmail: 'owner@example.test'` → กล่องเอกสารแสดงอีเมลนี้), `:87` (QUOTE_STALE), `:89`+`:125-130` (checkoutUrl null + PENDING → pendingDeal), `:99-100` (radio ดีล ไม่มี expander), `:121` (503 → generic) — **ทั้งหมดคง**; `:74-77` route otp — ลบได้ (ไม่ถูกเรียก) และเพิ่ม `expect(otpReads).toBe(0)` ถ้าอยากพิสูจน์; หลัง `:106` (review) เพิ่ม `await expect(review.getByLabel('ข้อมูลออกเอกสาร')).toContainText('owner@example.test');`

**`e2e/plan-term-billing-readiness.spec.ts`** — `:631` quote พร้อม `billingEmail` ต้องยัง 409 `BILLING_NOT_READY` (PR C คง key optional) ✓ ไม่แก้; `:643-648` ไม่แก้; RV31 (`:103-110` `{days:30}`) = Phase 6 ไม่ใช่ PR นี้

### 5.3 e2e ใหม่: `e2e/billing-no-setup.fixture.ts` + `e2e/billing-no-setup.spec.ts` (mock-based แบบ `billing-advance-deal.spec.ts`; ไม่แตะ DB; ใช้ `authedPage`/`companyId` จาก `./harness/fixtures`)

**fixture** (`.fixture.ts` ไม่ตรง `testMatch` ของ playwright จึงไม่ถูกรันเป็น test):
```ts
export type Stage = 'locked' | 'checkout' | 'paid' | 'applied' | 'failed' | 'unknown';
export type NoSetupState = { stage: Stage; stripe: 'pay' | 'cancel'; cancelResult: 'EXPIRED' | 'COMPLETED' | 'PENDING'; quoteTtlMs: number; checkoutResult: 'open' | 'FAILED' | 'UNKNOWN'; recipientEmail: string; resendsLeft: number; log: { quotes: Record<string, unknown>[]; checkouts: string[]; cancels: number; otp: string[]; resends: number } };
export const ATTEMPT = '11111111-1111-4111-8111-111111111111', INVOICE = '22222222-2222-4222-8222-222222222222';
export function defaultState(): NoSetupState;
export function noSetupStatus(companyId: string, s: NoSetupState): BillingStatus;   // ตาม stage (ดูตารางล่าง)
export function noSetupNotice(s: NoSetupState): PlanTermNotice;                    // stage 'applied' → ACTIVE, อื่น → EXPIRED no_package
export async function installNoSetupRoutes(page: Page, companyId: string, s: NoSetupState): Promise<void>;  // page.route('**/api/v1/**') + page.route('https://checkout.stripe.com/**')
```
status ต่อ stage (ฐาน = `companyName: 'ร้านใหม่ไม่มีอีเมล'`, `mode: 'TEST'`, `policyRevision: 'policy-nosetup'`, `purchaseEligibility: 'ELIGIBLE'`, `purchaseSource: 'TRIAL'`, `enabledPurchaseModes`/`availablePurchaseModes` ทั้ง 4, `documentState: 'NONE'`, `reference: null`, `observedAt: null`, `cancelAtPeriodEnd: false`, `graceEndsAt: null`, `issues: []`, `billingProfile: { name: 'ร้านใหม่ไม่มีอีเมล', nameSource: 'SHOP', missingFields: ['line1','subdistrict','district','province','postalCode'], address: { line1: '', line2: null, subdistrict: '', district: '', province: '', postalCode: '' } }`, `recipient: null`, `checkoutAddress: null`, `tierKey: 'FREE_TRIAL_15'`, `interval: null`, `paidThrough: null`, `nextChargeAt: null`, `usage: { used: 0, limit: 15, remaining: 15, cadence: 'LEGACY_MONTH', resetsAt: <+30d>, expiresAt: null }`):

| stage | paymentState/applyState | accessState/lockReason | attemptId/canCancel | allowedActions | อื่น |
|---|---|---|---|---|---|
| locked | NONE/NONE | EXPIRED/no_package | null/false | `['new_sales']` | `termEndsAt` = วันนี้ |
| checkout | PENDING/NONE | EXPIRED/no_package | ATTEMPT/true | `[]` | |
| paid | PAID/PENDING | EXPIRED/no_package | ATTEMPT/false | `[]` | `recipient: { email: s.recipientEmail, source: 'STRIPE_CHECKOUT', bouncedAt: null }` |
| applied | PAID/APPLIED | ACTIVE | ATTEMPT/false | `['new_sales','portal_cancel_subscription','plan_changes','portal_payment_method']` | `tierKey 'STARTER_249'`, `interval 'month'`, `renewalMode 'CARD_AUTO'`, `subscriptionState 'active'`, `termEndsAt/paidThrough/nextChargeAt` = +30d, `usage { used: 0, limit: 360, remaining: 360, cadence: 'PAID_GRANTS', resetsAt: null, expiresAt: +30d }`, `recipient` ตาม paid, `checkoutAddress: { line1: '99 ถนนทดสอบ', line2: null, subdistrict: '', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110' }` |
| failed | FAILED/NONE | EXPIRED/no_package | ATTEMPT/false | `['new_sales']` | |
| unknown | UNKNOWN/NONE | EXPIRED/no_package | ATTEMPT/true | `[]` | |

routes: `GET /billing` → status; `GET /billing/catalog` → 8 offers จาก `billingOffer(tier, interval)` (import จาก contracts เหมือน fixture preview `:31-33`) `validUntil` +1 ชม., `taxTreatment 'NOT_VAT_REGISTERED'`; `GET /billing/history` → `[]` ยกเว้น applied → `[{ id: INVOICE, number: 'NOSETUP-0001', currency: 'THB', amountSatang: 24900, refundedSatang: 0, disputed: false, financialObservedAt, paymentState: 'PAID', applyState: 'APPLIED', periodStart, periodEnd, createdAt, hasDocuments: true, documentActions: { canResend: true } }]`; `GET /billing/attempts/ATTEMPT` → `{ attemptId, state, errorCode: null, observedAt, paymentState: checkout→'PENDING' | paid/applied→'PAID' | failed→'FAILED' | unknown→'PENDING', applyState: paid→'PENDING' | applied→'APPLIED' | else 'NONE', invoiceReference: applied ? 'NOSETUP-0001' : null }`; `GET /plan-term/notice` → notice; `GET /billing/recipient` → stage ≥ paid ? `{ email: s.recipientEmail, hasCustomer: true, operation: null, busy: false }` : `{ email: null, hasCustomer: false, operation: null }`; `POST /billing/quote` → push body ลง log, ตอบ quote (`quoteId: 'q-' + n`, `billingEmail: null`, `billingProfile` = ของ status, `expiresAt: now + s.quoteTtlMs`, `purchase: { kind: 'INITIAL', previousPaidThrough: null, projectedPaidThrough: +30d, receiptUnitsAdded: 360, projectedRemainingReceipts: 360 }`, `previousSource: 'NO_TERM'`, `taxTreatment 'NOT_VAT_REGISTERED'`, `consentRevision 'billing-v2'`, `paidStart 'IMMEDIATE'`, `trialEndsAt null`, offer = catalog row ที่ขอ, `purchaseMode` = body); `POST /billing/checkout` → push key; `checkoutResult` 'open' → `{ attemptId: ATTEMPT, state: 'OPEN', checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_nosetup' }` และตั้ง `s.stage='checkout'`; 'FAILED' → `{ attemptId, state: 'FAILED', checkoutUrl: null }`; 'UNKNOWN' → `{ …, state: 'UNKNOWN', checkoutUrl: null }` + `s.stage='unknown'`; `POST /billing/attempts/ATTEMPT/cancel` → `cancels++`, ตอบ `{ state: s.cancelResult }`, EXPIRED → `s.stage='locked'`, COMPLETED → `s.stage='paid'`; `POST /billing/refresh` → `{ queued: true }` (202); `POST /billing/recipient/otp/request` → log email, `{ challengeId: 'chal-1', email, expiresAt +10m, retryAt +60s, attemptsRemaining: 5, deliveryStatus: 'ACCEPTED', delivered: true, serverNow }`; `POST …/otp/confirm` → code `'123456'` ? `{ recipientProofId: 'proof-1', email, expiresAt +10m }` : 400 `{ code: 'EMAIL_OTP_INVALID', message: 'invalid' }`; `POST /billing/recipient/preview` → `{ id: 'op-1', state: 'PREVIEW', version: 1, previewHash: 'h', expiresAt +10m, previousEmail: s.recipientEmail, newEmail: <จาก proof>, canSubmit: true, canCancel: true }`; `POST /billing/recipient/op-1/submit` → `{ …, state: 'COMPLETED', version: 2, canSubmit: false, canCancel: false }` + `s.recipientEmail = newEmail`; `POST /billing/documents/INVOICE/resend` → `resendsLeft > 0` ? `{ sentTo: s.recipientEmail, invoice: 'SENT', receipt: 'SENT', remainingToday: --s.resendsLeft }` : 429 `{ code: 'BILLING_RESEND_LIMIT', message: 'limit', retryAfterSeconds: 3600 }`; อื่น ๆ (`/auth/me/companies`, `/my-context`, `/branches`, `/notifications`, `/profile-checklist`, `/auth/account/email/otp`) → `route.continue()` (บริษัท seed ของจริง ACTIVE ตอบได้); `https://checkout.stripe.com/**` → `route.fulfill({ contentType: 'text/html', body: '<html><body><h1>Stripe (จำลอง)</h1><a id="pay" href="' + returnUrl + '">จ่ายจำลอง</a> <a id="back" href="' + returnUrl + '&checkout=canceled">กลับโดยไม่จ่าย</a></body></html>' })` โดย `returnUrl = /companies/${companyId}/billing/return?attempt=${ATTEMPT}`; คลิก `#pay` ให้ตั้ง `s.stage='paid'` ก่อนคลิก (test ทำเอง)

**spec** (`for (const width of [1280, 390])` ทุกเคส; `page.setViewportSize({ width, height: 900 })`; `expect(scrollWidth ≤ width)` ทุกจุดที่ถ่าย screenshot; `expectNoClientError(page)` ท้ายเคส):

1. `NO-SETUP @p1 locked shop buys STARTER with no email and no address, then unlocks in place at ${width}px`
   - `installNoSetupRoutes` (stage locked) → `goto /companies/:id/billing` → `expect(page.locator('header')).toHaveCount(1)` (F22), ลิงก์ 'กลับหน้าเลือกบริษัท' count 0 (F20), `aside` มี link 'แพ็กเกจ' และ 'ตั้งค่า', banner มี 'ร้านนี้ยังไม่มีแพ็กเกจที่ใช้งานได้', heading 'ยังไม่มีแพ็กเกจ'
   - 'ยืนยันอีเมลบัญชีก่อนซื้อแพ็กเกจ' count 0; 'ตั้งค่าข้อมูลบริษัทก่อนซื้อแพ็กเกจ' count 0; 'กรอกข้อมูลบริษัทก่อนซื้อแพ็กเกจ' count 0; text 'เอกสารจะออกในชื่อ' visible
   - click 'เลือกแพ็กเกจ' → radio 'บัตร · ต่ออายุอัตโนมัติ' checked; button 'วิธีชำระอื่น' `aria-expanded=false`; radio 'PromptPay QR · จ่ายครั้งเดียว' hidden; click 'วิธีชำระอื่น' → visible; click 'รายปี' → text 'เฉลี่ยเดือนละ'; click 'รายเดือน'
   - card 'เริ่มต้น (STARTER)' → 'เลือกแพ็กเกจนี้' enabled → click → `expect(s.log.quotes[0]).not.toHaveProperty('billingEmail')`; review region: label 'ข้อมูลออกเอกสาร' มี 'จะกรอกที่หน้าชำระเงิน' 2 ครั้ง (`toHaveCount(2)` บน `getByText`), ลิงก์ 'แก้ไขข้อมูลบริษัท' href มี `returnTo=billing`, ปุ่ม 'แก้อีเมลรับเอกสาร' count 0
   - check consent → click 'ยืนยันและไปชำระที่ Stripe' → `await page.waitForURL(/checkout\.stripe\.com/)` → heading 'Stripe (จำลอง)'; `s.stage = 'paid'` → click `#pay` → URL `/billing/return?attempt=ATTEMPT`
   - heading 'ชำระแล้ว กำลังตรวจสอบการเปิดสิทธิ์'; text 'ส่งเอกสารไปที่ buyer@example.test'; button 'แก้อีเมลรับเอกสาร' disabled; นับ `page.on('load')` ตั้งแต่ตอนนี้ = `loads`
   - `s.stage = 'applied'` → ภายใน 10 วิ: heading 'ชำระแล้ว เปิดใช้งานแล้ว'; `aside` มี link 'แดชบอร์ด' (business shell); banner ล็อก count 0; `expect(loads).toBe(0)` (ไม่ reload); `expect(page.locator('header')).toHaveCount(1)`
   - button 'แก้อีเมลรับเอกสาร' enabled → click → แท็บ 'การต่ออายุและชำระเงิน' active, region 'ผู้รับเอกสารของบริษัท' visible; radio 'ใช้อีเมลอื่น' check → fill 'อีเมลรับเอกสารใหม่' = 'new@example.test' → 'ขอรหัสยืนยัน' → text 'ส่งรหัส 6 หลักไปที่ new@example.test แล้ว' → fill 'รหัสยืนยัน 6 หลัก' '000000' → 'ยืนยันรหัส' → alert 'รหัสไม่ถูกต้อง' → fill '123456' → 'ยืนยันรหัส' → text 'จาก buyer@example.test เป็น new@example.test' → 'ยืนยันเปลี่ยนผู้รับเอกสาร' → status 'เปลี่ยนผู้รับเอกสารเป็น new@example.test แล้ว' → 'ส่งเอกสารล่าสุดไปอีเมลใหม่' → status 'ส่งเอกสารไปที่ new@example.test แล้ว' และ 'วันนี้ส่งซ้ำได้อีก'; `s.resendsLeft = 0` → click อีกครั้ง → alert 'ส่งเอกสารซ้ำได้ไม่เกิน 3 ครั้งต่อวัน'
   - `expect(s.log.checkouts).toHaveLength(1)`; screenshot `no-setup-return-${width}.png`, `no-setup-recipient-${width}.png`
2. `NO-SETUP cancel from Stripe offers a one-tap new choice and never reopens the chooser on a completed payment at ${width}px`
   - stage locked → ซื้อจนถึงหน้า Stripe จำลอง → click `#back` → URL มี `checkout=canceled` → heading 'ยังไม่ได้ชำระ'; button 'เลือกแพ็กเกจใหม่' visible; button 'ยุติรายการที่ยังไม่ชำระ' count 0
   - `s.cancelResult = 'EXPIRED'` → click → `expect(s.log.cancels).toBe(1)` → status 'ยุติหน้าชำระเงินเดิมแล้ว เลือกแพ็กเกจใหม่ได้เลย' → region 'เลือกแพ็กเกจ' visible (chooser เปิดเอง)
   - รอบสอง: `s.stage='checkout'; s.cancelResult='COMPLETED'` → goto return?…&checkout=canceled → click 'เลือกแพ็กเกจใหม่' → status 'รายการเดิมชำระสำเร็จแล้ว' → region 'เลือกแพ็กเกจ' count 0; heading เปลี่ยนเป็น 'ชำระแล้ว กำลังตรวจสอบการเปิดสิทธิ์' (status paid)
   - รอบสาม: `s.stage='checkout'` → goto `/companies/:id/billing` (หน้าแพ็กเกจ) → button 'เลือกแพ็กเกจใหม่' visible (F09), `s.cancelResult='PENDING'` → click → status 'กำลังตรวจผลรายการเดิมกับ Stripe'; region 'เลือกแพ็กเกจ' count 0
3. `NO-SETUP quote expiry re-quotes with the same choice; checkout FAILED returns to the chooser and UNKNOWN never retries at ${width}px`
   - `s.quoteTtlMs = 1500` → เลือก STARTER รายเดือน PromptPay QR · จ่ายครั้งเดียว (เปิด 'วิธีชำระอื่น' ก่อน) → review → รอ → status 'ราคานี้หมดอายุแล้ว กดตรวจสอบราคาใหม่'; button 'ยืนยันและไปชำระที่ Stripe' count 0 → `s.quoteTtlMs = 600_000` → click 'ตรวจสอบราคาใหม่' → `expect(s.log.quotes[1]).toMatchObject({ offerKey: 'STARTER_249', interval: 'month', purchaseMode: 'PROMPTPAY_ONCE' })` → button checkout visible
   - `s.checkoutResult = 'FAILED'` → consent → click → alert 'ยังเปิดหน้าชำระเงินไม่ได้' → region 'เลือกแพ็กเกจ' visible (chooser) → `expect(s.log.checkouts).toHaveLength(1)`
   - เลือกใหม่ → `s.checkoutResult = 'UNKNOWN'` → click → status 'กำลังตรวจกับ Stripe'; button checkout count 0; รอ 2.5 วิ → `expect(s.log.checkouts).toHaveLength(2)` (ไม่ retry); button 'ตรวจผลการชำระเงินอีกครั้ง' visible
4. `NO-SETUP failed attempt keeps the shop locked and offers the chooser at ${width}px` — stage failed → goto return → heading 'รายการชำระเงินนี้ไม่สำเร็จ', text 'สิทธิ์แพ็กเกจเดิมยังคงเดิม', button 'เลือกแพ็กเกจ' visible; polling หยุด (นับ GET attempts ภายใน 3 วิ ≤ 1)

**การลงทะเบียน**: playwright `chromium` project เก็บ `e2e/*.spec.ts` อัตโนมัติ (`playwright.config.ts:89-93`); เพิ่ม step ใน `.github/workflows/extended-tests.yml` ใต้ step `:307-317` (suite `customer`) ชื่อ "Test purchase without setup in the browser" `run: pnpm exec playwright test e2e/billing-no-setup.spec.ts --workers=1` ด้วย env เดียวกับ `:310-316` (`API_PORT '3155'`, `WEB_PORT '3156'`, `NEXT_DIST_DIR .next/billing-no-setup`) — ไม่แตะ `ci.yml` (ไม่ต้อง parity main)

## 6. Docs ที่ต้อง amend ใน PR นี้

1. `docs/specs/mangmee-line-web-billing-ui-spec-th.md`
   - `:165` "…ทุก 5 วินาทีต่อจนครบ 2 นาที…" → "…ทุก 5 วินาทีต่อจนครบ **3 นาที** (2026-09-27 G13); อ่านเฉพาะ attempt (1 GET/รอบ); `POST refresh` ไม่ถี่กว่า 30 วินาที; หยุดเมื่อ APPLIED/HELD/FAILED…"
   - `:94` U06 "email/ข้อมูลออกเอกสารที่ต้องมี" → "ข้อมูลออกเอกสาร: ชื่อ · ที่อยู่ · อีเมล (ว่างได้ — Checkout ของ Stripe ถาม; D-PF-1)"; `:96` U08 เพิ่ม "canceled → 'ยังไม่ได้ชำระ' + 'เลือกแพ็กเกจใหม่' กดเดียว; paid → 'ส่งเอกสารไปที่ {อีเมล}' + แก้อีเมลรับเอกสารเมื่อ applied"
   - §3.1 U06 (`:118-131`): บรรทัด "ส่งเอกสารไปที่ {billingEmail} [แก้ไข]" → "อีเมลรับเอกสาร {billingEmail | จะกรอกที่หน้าชำระเงิน} [แก้อีเมลรับเอกสาร — เมื่อมี Stripe Customer]"; บรรทัด "{ข้อมูลนิติบุคคล/ภาษีที่ B06 กำหนด} [แก้ไข]" → "ชื่อบนเอกสาร {ชื่อ} · ที่อยู่ {ที่อยู่ | จะกรอกที่หน้าชำระเงิน} [แก้ไขข้อมูลบริษัท]"
   - §3.1 U08 (`:132-140`): เพิ่มหลัง "ใช้งานแพ็กเกจแล้ว · ใช้ได้ถึง {paidThrough}" บรรทัด "ส่งเอกสารไปที่ {อีเมล} [แก้อีเมลรับเอกสาร]" และบล็อกใหม่ "U08 กลับจาก Stripe โดยไม่จ่าย: ยังไม่ได้ชำระ [เลือกแพ็กเกจใหม่] [กลับไปยังรายการเดิม]"
   - `:78` ข้อ 8 ต่อท้าย: "อีเมลรับเอกสารเก็บที่ Stripe Checkout แล้วคัดลอกกลับ (D-PF-1, 2026-09-26); เปลี่ยนภายหลังด้วย OTP ไปอีเมลใหม่จากหน้า return/แท็บการต่ออายุ (R-A8/R-D2)"
2. `docs/specs/billing-company-profile-gate-spec-th.md` `:1-3` เพิ่มบรรทัดสถานะ: "> **Superseded 2026-09-26 (D-PF-1):** เงื่อนไข 'ที่อยู่ก่อนซื้อ', modal และกล่องเตือนบนหน้าแพ็กเกจถูกถอดใน PR D; Stripe Checkout เก็บที่อยู่ (`checkoutAddress`) และหน้าข้อมูลร้านมีปุ่ม 'ใช้ที่อยู่จากการชำระเงิน' — ดู mangmee-purchase-without-setup-spec-th.md §18.2 R-A4/R-A9" (ข้ออื่นใน P2 ข้อ 8 — signup-optional-email, sales-deals, transactional-email — เป็นกติกา API → PR C)
3. `docs/agent-memory/purchase-without-setup-2026-09-26.md` — Status/Verification/Next + run id Extended Tests
4. ไม่มีเอกสาร billing-preview แยก (grep `พรีวิวขั้นตอน`/`BillingPreviewPage` ใน docs พบเฉพาะ memory/spec ที่อ้างถึงชื่อ) → ไม่ต้องแก้

## 7. คำสั่ง verify (ตามคำสั่ง Owner 2026-09-21: typecheck + spec ที่แตะ; e2e เต็มผ่าน Extended Tests)

```bash
# หลัง merge/rebase บน PR C
pnpm --filter @watchdog-bms/contracts build
pnpm --filter @watchdog-bms/web typecheck            # = next typegen && tsc --noEmit (apps/web/package.json:11)
pnpm --filter @watchdog-bms/web exec tsx --test \
  src/common/api/api-error-coverage.spec.ts src/common/api/no-raw-api-error-display.spec.ts \
  src/features/billing/billing-error-text.spec.ts src/features/billing/billing-display.spec.ts \
  src/features/billing/billing-profile-navigation.spec.ts src/features/company-profile/company-profile.logic.spec.ts
pnpm --filter @watchdog-bms/web test                 # ทั้งชุด (glob) — ~1 นาที
# e2e local (stack ตาม docs/agent-memory local-dev-server recipe; playwright.config.ts boot api+web เอง)
DATABASE_URL=postgresql://watchdog:watchdog_local_password@localhost:15432/watchdog_bms?schema=public \
  pnpm exec playwright test e2e/billing-no-setup.spec.ts e2e/billing-preview.spec.ts e2e/customer-billing-ux.spec.ts e2e/billing-advance-deal.spec.ts --workers=1
# ก่อน push: ไม่มี diff นอก apps/web e2e docs .github/workflows/extended-tests.yml
git status --porcelain | grep -vE '^(.. )?(apps/web/|e2e/|docs/|\.github/workflows/extended-tests\.yml)' && echo 'OUT OF SCOPE' || echo ok
```
บันทึกผลลง memory: คำสั่ง + ผล + run id ของ Extended Tests (dispatch โดย controller)

## 8. ความเสี่ยง

1. **ลำดับ PR**: web อ่าน `status.recipient`/`checkoutAddress`/`documentActions`/`billingEmail: null` — ถ้า PR C ยังไม่ merge typecheck แดง; ห้ามประกาศ type ซ้อนในเว็บ (ต้องใช้ contracts จริง)
2. **ชนกับ PR B**: `BillingPage.tsx:341-347`, `WorkspaceLayout.tsx` (listener), `AccountEmailOtpPanel.tsx`, `account/email/page.tsx:23` — rebase ก่อน push; อย่าแก้บรรทัดของกันและกัน
3. **remount หลังปลดล็อก** (F13): layout สลับ → `BillingPage` unmount/mount → state local (แท็บ, quote) หาย; หน้า return กู้จาก URL (`attempt`) ได้; ผู้ใช้ที่อยู่ระหว่างแก้อีเมลบนหน้า return ตอน APPLIED ถูก remount 1 ครั้ง — ปุ่มแก้อีเมลเปิดหลัง APPLIED เท่านั้นจึงไม่หลุดกลางทาง
4. **reload fallback** ต้องยิงครั้งเดียว (ref) และถูก cleanup เมื่อ unmount — ไม่งั้นวน
5. **polling + limiter**: `POST refresh` ใช้ limiter 30/นาทีร่วมกับปุ่มทุกปุ่ม (`billing.controller.ts:481`); throttle 30 วิ → ≤ 6 ครั้งใน 3 นาที
6. **expander ซ่อน radio** → e2e `.check()` บน element hidden ล้มเหลว — แก้ spec ตาม §5.2; ห้ามใช้ `<details>` (Playwright ไม่มอง `<summary>` เป็น button)
7. **hydration**: `checkout=canceled`/hash ต้องอ่านใน effect (server render ไม่มี `window`)
8. **Stripe stub ใน e2e**: `page.route('https://checkout.stripe.com/**')` ต้องติดตั้งก่อน `window.location.assign` — `navigateProvider` ตรวจ hostname `checkout.stripe.com` (`BillingPage.tsx:66-71`) จึงต้องใช้ URL host จริง; ห้าม `route.continue()` ไป Stripe จริง
9. **`status.recipient.email` ว่างตอน PAID** — ตัดสินแล้ว 2026-09-27: PR C เขียนคอลัมน์ตอน apply (ไม่อ่าน Customer ใน status) → ระหว่าง PAID→APPLIED หน้า return ใช้ fallback (§3.4 e) "ส่งเอกสารไปที่อีเมลที่กรอกไว้ที่หน้าชำระเงิน" แล้วสลับเป็นอีเมลจริงเมื่อ APPLIED
10. **`BillingAdjustments.documentActions/recipientEmail`** — ตัดสินแล้ว: PR C เพิ่มใน response ของ adjustments (pr-c §4.12) → ปุ่มส่งซ้ำบนหน้าเอกสารทำได้
11. **ข้อความ R-A1 คง 1 release** (`BILLING_COMPANY_PROFILE_REQUIRED` ฯลฯ) — ถ้า API เก่ายังโยน ผู้ใช้เห็นข้อความเดิมโดยไม่มี modal → ยอมรับได้ในช่วง rollout เดียวกัน (PR C/D deploy release เดียว §17)
12. **G17/G18** — เจ้าของ = PR B (pr-b §3.15); PR D ไม่ทำ

## 9. ต้องตรวจ (ก่อน/ระหว่างเขียน)

1. ตัดสินแล้ว 2026-09-27 (00-readme §กติกา contract): ชนิด/รหัส/endpoint ตาม pr-c §2 (แก้ใน §2 ของ brief นี้แล้ว); resend ไม่ต้องมี `Idempotency-Key`; 429 ทุกตัวมี `retryAfterSeconds` ใน body
2. ตัดสินแล้ว (ข้อ 8.9/8.10)
3. PR C: allowlist `auth.guard.ts:98-104` ครอบ `POST …/recipient/otp/(request|confirm)` และ `POST …/documents/[^/]+/resend` (pins sync) — ไม่งั้นร้านล็อกโดน `authed-fetch.ts:107-113` เด้งไป `/renew`
4. ตัดสินแล้ว: PR B ทำ listener/constant/dispatch (pr-b §3.14) และเป็นเจ้าของ `AccountEmailOtpPanel.tsx` ทั้งไฟล์ (§3.8/§3.12)
5. ตัดสินแล้ว: ใช้ fall-through `BillingPage → translateApiError` + spec เดินทุกรหัส (00-readme แก้กติกาแล้ว)
6. `<header>` ใน locked shell = 1 (AppHeader `AppHeader.tsx:36`) หลัง provider fix — ยืนยันด้วย screenshot 390 px ก่อน commit e2e assertion
7. `billing-preview.spec.ts` ค่าจริงของ "เฉลี่ยเดือนละ" สำหรับการ์ดที่ assert (คำนวณจาก `billingOffer` ใน contracts ตอนเขียน)
8. e2e ข้อ 1 การนับ `page.on('load')` หลังปลดล็อก — ถ้า Next `router.refresh()` ไม่ยิง `load` (ปกติไม่ยิง) assertion ใช้ได้; ถ้าพบ flaky ให้ตรวจแทนด้วย `page.evaluate(() => performance.getEntriesByType('navigation').length)` คงที่
9. `apiErrorMessage` branch 429 + `retryAfterSeconds` (§3.3) ต้องไม่ทำให้ `api-error-coverage.spec.ts:166-175` ("renders throttling…") เปลี่ยนผล
10. ฉาก preview 'start' หลังแก้: `billingEmail: null` → กล่องเอกสารแสดง "จะกรอกที่หน้าชำระเงิน" — ตรวจว่า `BillingPreviewPage` ยังผ่าน `billing-preview.spec.ts` ทั้งไฟล์ (โดยเฉพาะฉาก `deal`/`deal-auto` ที่ quote สร้างจาก `billingEmail` param เดิม)
11. `requestQuote` ตอน requote (F16) กับ `capacityDraft.current?.initialSelection` — ยืนยันว่า quote ที่มี `capacity` ส่ง selection เดิมถูกต้อง (มิฉะนั้น API ตอบ `BILLING_CAP_SELECTION_REQUIRED` แล้ว flow เดิม `:255-257` เปิด picker ให้เอง — ยอมรับได้)
12. ตัดสินแล้ว: G17/G18 = PR B
