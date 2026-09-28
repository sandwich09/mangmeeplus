# PR C — Billing API "ซื้อโดยไม่ต้องตั้งค่าก่อน" (schema + gate removal + Customer/Checkout + recipient capture + recipient OTP + post-payment email/bounce + resend)

> ตรวจ anchor ใหม่บน develop 03438bde (2026-09-28); ฐานเดิม ddcdcadf

Spec: [../../specs/mangmee-purchase-without-setup-spec-th.md](../../specs/mangmee-purchase-without-setup-spec-th.md) §18.2 (R-A1..R-A11, R-D1, §9, §11, RV01–06, RV16–22) · Plan: [../mangmee-purchase-without-setup-plan-th.md](../mangmee-purchase-without-setup-plan-th.md) "แก้ไขแผน 2026-09-27" P0/P2/P3 · Readme: [00-readme.md](00-readme.md) · Memory: `docs/agent-memory/purchase-without-setup-2026-09-26.md`

ฐานโค้ด: `origin/develop` ddcdcadf — ทุกเลขบรรทัดในไฟล์นี้ตรวจกับโค้ดจริงบน ddcdcadf แล้ว (2026-09-27); re-verify กับ `03438bde` 2026-09-28 (ทุกไฟล์ที่ brief นี้อ้างไม่เปลี่ยน ยกเว้น `schema.prisma`, `packages/config/src/index.ts`, `extended-tests.yml`, `api-error-message.ts`, `workflow-outbox-drain.use-case.ts` — เลขบรรทัดในนี้อัปเดตแล้ว). ถ้า PR A merge ก่อน (ควรเป็นเช่นนั้น) ให้ rebase worktree แล้วเลื่อนบรรทัดตาม แต่ชื่อฟังก์ชัน/ลำดับ statement ที่อ้างในนี้เป็นตัวชี้จริง

ข้อขัดแย้งที่พบระหว่างตรวจ (ต้องรู้ก่อนเริ่ม):

1. contracts `billing.ts:134` มี `'SCHEDULED_CHANGE' | 'ADVANCE_DEAL'` ใน purchase-kind union อยู่แล้วบน ddcdcadf — งาน "เพิ่ม SCHEDULED_CHANGE/ADVANCE_DEAL" ไม่ต้องทำ (audit F26 stale)
2. `billing-repeat.ts`: profile assert อยู่ที่ `:210` ไม่ใช่ `:209`; proofs `:207-208`; equality `:281`; profile settle `:239-243`; profile sync `:282-286`; Checkout params `:289-295` (journal-hashed ผ่าน `command('checkout', …)` `:200-216`)
3. DQ6 "แยก Postmark stream" ทำไม่ได้โดยไม่มี env ใหม่: stream เดียวมาจาก `POSTMARK_MESSAGE_STREAM` (`packages/config/src/index.ts:409` default `outbound`); webhook ปฏิเสธ stream อื่น (`postmark-events.service.ts:57`); suppression/monitor/retention/reconcile ทุกตัว key ด้วย stream เดียว (`email-delivery.service.ts:47,53,72,163`, `system-email-delivery.service.ts:41-44`, `email-history-retention`). ทางออกที่ไม่ผิด D-PF-8: **ไม่แยก stream**; ใช้ `Tag: purpose` ที่ส่งอยู่แล้ว (`email-delivery.service.ts:125` — `billing_status` vs `email_verification`) เป็นตัวแยกใน Postmark และแยกในระบบเราด้วย `intentKey`/`purpose` (§9.4)
4. `session.customer_details` มีทั้ง session โหมด `payment` และ `subscription` (audit F17 บอกว่ามีเฉพาะ one-time — ไม่จริง) → ใช้ session เป็นแหล่งแรกทั้งสองทาง, GET Customer เป็น fallback
5. spec §18.2 R-A8 ให้ "purpose `billing_recipient` ผูก companyId" — ตาราง `EmailVerificationToken` (`schema.prisma:792-815`) ไม่มีคอลัมน์ companyId → ต้องเพิ่มคอลัมน์ additive `companyId String?` (นอกรายการ §9 ที่มีแค่ `BillingAccount`) หรือสร้างตารางใหม่; brief นี้เลือกเพิ่มคอลัมน์ (diff เล็กสุด, ใช้ limiter/index เดิม) — ระบุใน §3
6. `billing-portal-smoke.ts:70-77` และ `billing-notification-smoke.ts:112-115` ทดสอบพฤติกรรมที่ DQ2/R-A7 ยกเลิก → ต้องเขียน assertion ใหม่ (ไม่ใช่แค่แก้ให้ผ่าน) — §6
7. เอกสาร `mangmee-billing-subscription-spec-th.md:254` ห้าม "ส่ง receipt ซ้ำด้วย Postmark" — brief นี้ส่ง **อีเมลแจ้งพร้อมลิงก์เข้าแอป** (ไม่ใช่ตัวใบเสร็จ) ตาม R-A7 → amend บรรทัดนั้น (§7)

---

## 1. Scope & Definition of Done

### 1.1 In scope (API + workers + schema + contracts + api-error map)

| # | งาน | R |
|---|---|---|
| S1 | schema additive: `BillingAccount.recipientEmail/recipientSource/recipientBouncedAt/recipientBounceNotifiedAt/checkoutAddressJson` + `EmailVerificationToken.companyId`; migration; backfill script; lazy backfill ใน `emailRecipient.current()` | §9 |
| S2 | ถอด gate อีเมล/โปรไฟล์ทุกจุด (quote, checkout ×3, repeat, portal, collection, Customer creation, DTO/controller/contracts); recipient/profile drift → `BILLING_QUOTE_STALE` เท่านั้น; retire แหล่ง `BILLING_RECIPIENT_UPDATE_REQUIRED` | R-A1/A5/A6/A10, DQ2 |
| S3 | `stripeCustomerSyncPayload(snapshot)` + `stripeCustomerSynced(customer, snapshot)` ใช้ 3 จุด (service, repeat, reconciler) — bytes เดิมทุกจุดสำหรับ key `mm:<attempt>:billing-profile` | R-A2 |
| S4 | Checkout params: `customer_update.address` never/auto + `cancel_url&checkout=canceled` ทั้ง 3 จุด | R-A3 |
| S5 | recipient capture ใน apply ทั้ง 4 ทาง + admin apply (held) — อ่านก่อน transaction ใต้ lease, เขียนเฉพาะเมื่อว่าง, `checkoutAddressJson`, audit `billing.recipient.captured` | R-A4 (ก) |
| S6 | recipient OTP flow ใหม่ (company-scoped): `POST recipient/otp/request`, `POST recipient/otp/confirm`, `recipient/preview {recipientProofId}`; op `UPDATE_BILLING_EMAIL` รับ target แบบ proof; worker ไม่ assert account email; เขียน `recipientEmail/source`, ล้างธง bounce; แจ้งผู้รับเดิม (email) + LINE/web ถึงผู้จัดการแพ็กเกจ; allowlist `auth.guard.ts` + sync pins | R-A8/R-D2 |
| S7 | อีเมลชำระสำเร็จไปผู้รับเอกสาร (outbox intent ใหม่ อ่านคอลัมน์), `recipientUserId` nullable (contracts + monitor join), ตัวตรวจ bounce ใน billing notifications drain → ธง + LINE/web push ครั้งเดียว; status DTO `recipient` | R-A7 |
| S8 | ส่งเอกสารซ้ำ `POST documents/:invoiceId/resend` (sync ใต้ lease, limiter 3/ใบ/วัน inspect→Stripe→consume, `invoices/:id/send`, `charges/:id receipt_email` เมื่อผู้รับต่างจาก `receipt_email`, อีเมลแจ้งของเราพร้อมลิงก์เข้าแอป, audit) + allowlist | R-D1 (Phase 3 folded) |
| S9 | status DTO `recipient`, history `documentActions.canResend`; error codes ใหม่ + Thai ใน `apps/web/src/common/api/api-error-message.ts` (map เท่านั้น — UI เป็น PR D) | §11 |
| S10 | tests: แก้ smoke/spec ที่จะแดง, spec ใหม่ (unit/PG/smoke), ลงทะเบียน ci.yml/extended-tests | RV13 |
| S11 | docs amend ตาม §7 + memory | — |

### 1.2 Out of scope (PR อื่น)

- web ทุกอย่าง (`BillingPage`, `BillingEmailRecipientPanel` rewrite, return page, banner ตีกลับ, `BillingDeliveryPanel` label, `BillingPage.errorText`, e2e/fixture) → PR D; admin resend/recipient/lookup → PR E; `planManagersOf` helper + LINE sites → PR A; `LineSupportRequest` → ไม่แตะ; reissue → สเปกแยก (DQ1)

### 1.3 Definition of Done

- ร้านที่ไม่มีอีเมลบัญชี/ที่อยู่: `POST quote` 200 (`billingEmail: null`, `billingProfile.missingFields` ไม่ว่าง) → `POST checkout` 200 → Customer สร้างโดยไม่มี `email` และไม่มี `address` → session มี `customer_update[address]=auto` และ `cancel_url` ลงท้าย `&checkout=canceled` — ทุก purchase kind (INITIAL/RESTART/REPEAT/UPGRADE/FULL_PACKAGE_UPGRADE/SCHEDULED_CHANGE/ADVANCE_DEAL/deal)
- simulated paid (one-time + subscription + repeat + advance-deal) → `BillingAccount.recipientEmail` = อีเมลจาก `customer_details`, `recipientSource='STRIPE_CHECKOUT'` (หรือ `ACCOUNT_EMAIL` เมื่อ snapshot มีอีเมล), `checkoutAddressJson` = address จาก Checkout; replay reconcile ไม่เขียนทับ, ไม่เรียก Stripe Customer ซ้ำเมื่อมีผู้รับแล้ว
- หลัง apply: outbox `billing:notice-email:<invoiceId>:recipient` → Postmark To = `recipientEmail`; OWNER ที่ยัง unverified ไม่ทำให้ไม่ส่ง; bounce (SUPPRESSED บน intent `billing-notice:*` ที่ผู้รับตรงกับคอลัมน์) → `recipientBouncedAt` + push 1 ครั้ง; `GET billing` คืน `recipient {email, source, bouncedAt, canChange}`
- เปลี่ยนผู้รับด้วย OTP ไปอีเมลใหม่: request → confirm → preview(proof) → submit → reconcile → Stripe Customer email ใหม่ + คอลัมน์ใหม่ + ธงล้าง + อีเมลแจ้งผู้รับเดิม + LINE/web แจ้งผู้จัดการแพ็กเกจ; flow "ใช้อีเมลบัญชี" เดิมยังทำงาน; op ค้างจาก release ก่อน (proposed แบบเก่า) ยัง advance ได้
- resend: 3 ครั้ง/ใบ/วัน; ครั้งที่ 4 → 429 `BILLING_RESEND_LIMIT`; Stripe ล้ม → 409 `BILLING_RESEND_UNAVAILABLE` ไม่นับครั้ง; audit `billing.document.resent`
- ไม่มี diff ใน `paid-invoice.ts`, `paid-checkout-invoice.ts`, `billing-schedule.ts`; ไม่มี env/flag ใหม่; migration additive; `package.json` ไม่แตะ; pins `--check` ผ่าน; typecheck api/contracts/web ผ่าน; `test:boot` ผ่าน; spec ที่แตะ + spec ใหม่ผ่าน; Extended Tests (billing backend+customer) run id บันทึกใน memory

---

## 2. Contracts (types / DTOs / endpoints / error codes + Thai)

### 2.1 `packages/contracts/src/billing.ts`

```ts
// :127 เดิม  billingEmail: string;
billingEmail: string | null;                       // null = "อีเมลจะกรอกที่หน้าชำระเงิน"

// เพิ่ม (วางหลัง BillingEmailRecipient :396)
export type BillingRecipientSource = 'ACCOUNT_EMAIL' | 'CUSTOMER_OTP' | 'STRIPE_CHECKOUT' | 'ADMIN';
export type BillingRecipientInfo = { email: string | null; source: BillingRecipientSource | null; bouncedAt: string | null;
  /** hasCustomer && ไม่มี op/attempt ค้าง — ปุ่ม "แก้อีเมลรับเอกสาร" เปิดเมื่อ true (R-A8: เปิดที่ APPLIED) */
  canChange: boolean };
export type BillingRecipientOtpChallenge = { challengeId: string; email: string; expiresAt: string; retryAt: string;
  attemptsRemaining: number; deliveryStatus: string; delivered: boolean };
export type BillingRecipientOtpProof = { recipientProofId: string; email: string; expiresAt: string };
export type BillingDocumentResendResult = { invoiceSent: boolean; receiptUpdated: boolean; recipientEmail: string; remainingToday: number };

// BillingStatus (:150-193) เพิ่ม optional
recipient?: BillingRecipientInfo;
// BillingInvoiceItem (:210-212) เพิ่ม optional
documentActions?: { canResend: boolean };
// BillingStatus เพิ่ม (ตัดสิน 2026-09-27 — PR D ใช้ปุ่ม "ใช้ที่อยู่จากการชำระเงิน" DQ5)
checkoutAddress?: CompanyLegalAddress | null;   // แปลงจาก checkoutAddressJson (Stripe): line1, line2, district←city, province←state, postalCode←postal_code, subdistrict:''; import type จาก './company-tax-identity.js'
// BillingAdjustments (:220-221) เพิ่ม optional (หน้าเอกสารของ PR D ไม่มี history item ให้อ่าน)
documentActions?: { canResend: boolean }; recipientEmail?: string | null;
// BillingEmailRecipientOperation (:394) เพิ่ม optional
source?: BillingRecipientSource;
// BillingEmailRecipient (:396) เพิ่ม optional — ค่าในคอลัมน์ (Stripe email ยังคืนใน `email`)
stored?: BillingRecipientInfo;
// BillingDeliveryView (:319)  recipientUserId: string;  →  recipientUserId: string | null;
```

ทุกฟิลด์ใหม่ optional → e2e preview fixture (`BillingStatus` literal เต็ม) คอมไพล์ต่อได้ (readme กติการ่วม). `billing-labels.ts` เพิ่ม blocked reason `RECIPIENT_MISSING: 'ยังไม่มีอีเมลรับเอกสาร'` ในตาราง delivery blocked reasons (ค้นหาที่ `VERIFIED_EMAIL_REQUIRED` แล้ววางถัดไป)

### 2.2 DTOs `apps/api/src/modules/billing/presentation/billing.dto.ts`

```ts
// :94 เดิม  @IsString() @MinLength(1) @MaxLength(320) billingEmail!: string;
@IsOptional() @IsString() @MaxLength(320) billingEmail?: string;   // คง key; client เก่าส่งได้; '' ถือว่าไม่ส่ง
export class BillingRecipientPreviewDto { @IsOptional() @IsUUID() recipientProofId?: string; }   // แทน BillingEmptyDto ที่ :487
export class BillingRecipientOtpRequestDto { @IsString() @MaxLength(320) email!: string; @IsUUID('4') requestKey!: string; }
export class BillingRecipientOtpConfirmDto { @IsUUID() challengeId!: string; @IsString() @Matches(/^\d{6}$/) code!: string; }
```
(`Matches` มี import อยู่แล้วที่ `:1`? — ไม่มี: เพิ่ม `Matches` ใน import บรรทัด 1) — body ใหม่ทุกตัวเป็น class (`body-validation-coverage.spec.ts`, `forbidNonWhitelisted`)

### 2.3 Endpoints (ทั้งหมดใต้ `companies/:companyId/billing`, `@RequirePermissions('account.session.read')` + `assertOwner` + limiter `billing-command` 30/นาที เดิม `billing.controller.ts:479-483`)

| Method/Path | Body | 2xx | Errors |
|---|---|---|---|
| `POST quote` (เดิม `:529-543`) | `billingEmail` optional | `BillingQuote` (`billingEmail` = ผู้รับปัจจุบัน ?? verified account email ?? null) | เดิม ยกเว้นไม่มี `BILLING_EMAIL_VERIFICATION_REQUIRED`/`BILLING_COMPANY_PROFILE_REQUIRED`/`BILLING_RECIPIENT_UPDATE_REQUIRED` |
| `POST checkout` (เดิม) | เดิม | เดิม | `BILLING_QUOTE_STALE` แทนทุกกรณีผู้รับ/โปรไฟล์เปลี่ยน |
| `POST recipient/otp/request` | `{ email, requestKey }` | 202 `BillingRecipientOtpChallenge` | `EMAIL_OTP_TARGET_INVALID` 400, `BILLING_RECIPIENT_UNAVAILABLE` 409, `BILLING_RECIPIENT_UNCHANGED` 409, `EMAIL_OTP_RATE_LIMITED` 429, `EMAIL_DELIVERY_UNAVAILABLE` 503, `EMAIL_REAUTH_REQUIRED` 401 (ไม่มี session), `EMAIL_STATE_CHANGED` 409 (requestKey ซ้ำแต่ fingerprint ต่าง) |
| `POST recipient/otp/confirm` | `{ challengeId, code }` | 200 `BillingRecipientOtpProof` | `EMAIL_OTP_NOT_FOUND` 404, `EMAIL_REAUTH_REQUIRED` 409, `EMAIL_STATE_CHANGED` 409, `EMAIL_OTP_EXPIRED` 409, `EMAIL_OTP_INVALID` 409, `EMAIL_OTP_ATTEMPTS_EXCEEDED` 409, `EMAIL_OTP_RATE_LIMITED` 429 |
| `POST recipient/preview` (เดิม `:486-487`) | `{ recipientProofId? }` | 200 `BillingEmailRecipientOperation` (+`source`) | เดิม + `BILLING_RECIPIENT_PROOF_INVALID` 409, `BILLING_RECIPIENT_UNCHANGED` 409 |
| `POST recipient/:id/submit|cancel` (เดิม) | เดิม | เดิม | เดิม |
| `GET recipient` (เดิม `:485`) | — | `BillingEmailRecipient` + `stored` | เดิม |
| `POST documents/:documentId/resend` | `{}` (`BillingEmptyDto`) | 200 `BillingDocumentResendResult` | `BILLING_RESEND_LIMIT` 429 `{retryAfterSeconds}`, `BILLING_RESEND_UNAVAILABLE` 409, `BILLING_EMAIL_UPDATE_PENDING` 409, `BILLING_PURCHASE_PENDING` 409 (lease ไม่ว่าง), 404 |
| `GET` status/history (เดิม) | — | + `recipient`, `documentActions` | เดิม |

### 2.4 Error codes ใหม่ (ทั้งหมดต้องมี Thai ใน `apps/web/src/common/api/api-error-message.ts` ใน PR นี้ — coverage spec `api-error-coverage.spec.ts:44-75` ไล่ `code:'X'` ทุกไฟล์ใน `modules/billing`; `BillingPage.errorText` เป็น PR D)

| Code | HTTP | ข้อความ API (ไทย) | api-error-message.ts |
|---|---|---|---|
| `BILLING_RESEND_LIMIT` | 429 | `ส่งเอกสารซ้ำได้สูงสุด 3 ครั้งต่อวันสำหรับใบนี้ กรุณาลองใหม่พรุ่งนี้` | `'วันนี้ส่งเอกสารใบนี้ซ้ำครบ 3 ครั้งแล้ว ลองใหม่ได้พรุ่งนี้ หรือเปิดเอกสารจากหน้านี้ได้ทันที'` |
| `BILLING_RESEND_UNAVAILABLE` | 409 | `ยังส่งเอกสารซ้ำไม่ได้ กรุณาลองใหม่ภายหลัง` (Stripe ล้ม) / `ยังไม่มีอีเมลรับเอกสาร กรุณาตั้งอีเมลรับเอกสารก่อน` (ไม่มีผู้รับ) | `'ยังส่งเอกสารซ้ำไม่ได้ในตอนนี้ ตรวจอีเมลรับเอกสารแล้วลองใหม่ หรือเปิดเอกสารจากหน้านี้'` |
| `BILLING_RECIPIENT_UNAVAILABLE` | 409 | `ยังไม่มีเอกสารให้ตั้งอีเมลรับ กรุณาซื้อแพ็กเกจก่อน` | `'ตั้งอีเมลรับเอกสารได้หลังชำระเงินครั้งแรก'` |
| `BILLING_RECIPIENT_UNCHANGED` | 409 | `อีเมลนี้เป็นอีเมลรับเอกสารปัจจุบันอยู่แล้ว` | `'อีเมลนี้เป็นอีเมลรับเอกสารปัจจุบันอยู่แล้ว ไม่ต้องเปลี่ยน'` |
| `BILLING_RECIPIENT_PROOF_INVALID` | 409 | `การยืนยันอีเมลนี้ใช้ไม่ได้แล้ว กรุณาขอรหัสยืนยันใหม่` | `'การยืนยันอีเมลนี้หมดอายุหรือถูกใช้แล้ว กรุณาขอรหัสยืนยันใหม่'` |
| `BILLING_RECIPIENT_BOUNCED` (สงวน — ไม่โยนใน PR นี้; spec §11 ระบุ) | — | — | `'อีเมลรับเอกสารส่งไม่ถึง กรุณาแก้อีเมลรับเอกสารก่อน'` |

Codes เดิมที่**ยังคง**ข้อความไว้ 1 release แต่ไม่มีแหล่งโยนจากเส้นทางซื้ออีก: `BILLING_EMAIL_VERIFICATION_REQUIRED` (แหล่งเดียวที่เหลือ = `account-email-state.ts:38` ผ่าน `verifiedAccountEmailProof` ใน `billing-email-recipient.ts:59` เส้นทาง "ใช้อีเมลบัญชี"), `BILLING_EMAIL_CHANGED` (เหลือ `billing-email-recipient.ts:18 review()` + `account-email-state.ts:50` เส้นทางเดียวกัน), `BILLING_COMPANY_PROFILE_REQUIRED` (ไม่มีแหล่งเลยหลัง PR นี้ — คง mapping), `BILLING_RECIPIENT_UPDATE_REQUIRED` (ไม่มีแหล่ง — คง mapping). Codes EMAIL_OTP_* ที่ reuse มี Thai แล้ว (`api-error-message.ts:21-32`)

---

## 3. Data (Prisma diff, migration SQL, backfill)

### 3.1 Prisma diff (`apps/api/prisma/schema.prisma`)

```prisma
model BillingAccount {                       // :9791 — เพิ่มหลัง leaseUntil (:9816) ก่อน createdAt
  // R-A4/R-A7 (§18.2 §9): ผู้รับเอกสารของบริษัท = สำเนาของอีเมลบน Stripe Customer ที่ระบบเราเป็นเจ้าของ;
  // billing ใช้ String ไม่ใช่ enum (prisma-enum-parity: billing columns เป็น String)
  recipientEmail            String?   @db.VarChar(320)
  recipientSource           String?              // ACCOUNT_EMAIL | CUSTOMER_OTP | STRIPE_CHECKOUT | ADMIN
  recipientBouncedAt        DateTime?
  recipientBounceNotifiedAt DateTime?
  checkoutAddressJson       Json?                // ที่อยู่ที่ Stripe Checkout เก็บ (snapshot เอกสาร; ห้ามเขียนลง Company — RV02/DQ5)
  ...
  @@index([recipientEmail])
}

model EmailVerificationToken {              // :792 — เพิ่มหลัง requestFingerprint (:809)
  companyId String?                          // proofKind 'BILLING_RECIPIENT' เท่านั้น; ผูก challenge กับบริษัท (R-A8)
  ...
  @@index([companyId, proofKind, status])
}
```

ไม่มี enum ใหม่, ไม่มี relation ใหม่ (companyId เป็น string ธรรมดาเหมือน `BillingOperation.companyId`)

### 3.2 Migration `apps/api/prisma/migrations/20260928200000_billing_recipient_columns/migration.sql`

(ชื่อตาม convention `YYYYMMDDHHMMSS_snake`; ล่าสุดคือ `20260926120000_counterparty_receipt_uploader`; รูปแบบ `ADD COLUMN IF NOT EXISTS` ตามไฟล์นั้น)

```sql
-- Purchase without setup (spec §18.2 §9): the document recipient is a column we own, not only Stripe Customer.email.
ALTER TABLE "BillingAccount"
  ADD COLUMN IF NOT EXISTS "recipientEmail" VARCHAR(320),
  ADD COLUMN IF NOT EXISTS "recipientSource" TEXT,
  ADD COLUMN IF NOT EXISTS "recipientBouncedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "recipientBounceNotifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "checkoutAddressJson" JSONB;
CREATE INDEX IF NOT EXISTS "BillingAccount_recipientEmail_idx" ON "BillingAccount"("recipientEmail");

-- Company-scoped recipient OTP challenge (R-A8) reuses the account OTP table; only this proofKind sets companyId.
ALTER TABLE "EmailVerificationToken" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
CREATE INDEX IF NOT EXISTS "EmailVerificationToken_companyId_proofKind_status_idx"
  ON "EmailVerificationToken"("companyId", "proofKind", "status");
```

กติกา: additive เท่านั้น (auto-promotion ปฏิเสธ DROP/TRUNCATE/DELETE — `verify-applied-migration-catalog.ts:125`); CI `migration:review` (`ci.yml:755`) diff จาก schema ว่าง ไม่เทียบกับไฟล์ migration → PG spec ใหม่ (§6.3) ต้องแตะทุกคอลัมน์ใหม่เพื่อพิสูจน์ว่า SQL กับ schema ตรงกัน; migration ที่ค้างทำให้ UAT ต้องเริ่มใหม่และ READY ต้อง clone/rehearse (runbook :25,:139)

### 3.3 Backfill script `apps/api/src/scripts/backfill-billing-recipients.ts`

รูปแบบตาม `backfill-dashboard-entitlement.ts` (PrismaPg + JSON log + exit 1) และ flag ตาม `create-catalog-prices.ts:46-86` (`--dry-run`, `--yes` บังคับเมื่อ live)

```ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { StripeClient, stripeId } from '../modules/billing/infrastructure/stripe.client';

// env: DATABASE_URL, STRIPE_SECRET_KEY, STRIPE_ACCOUNT_ID, BILLING_MODE=test|live ; flags: --dry-run --yes --limit=N
async function main() {
  const dryRun = process.argv.includes('--dry-run'), livemode = process.env.BILLING_MODE === 'live';
  if (livemode && !dryRun && !process.argv.includes('--yes')) throw new Error('backfill_billing_recipients_live_requires_yes');
  const stripe = new StripeClient({ billingMode: process.env.BILLING_MODE ?? 'disabled', stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    stripeAccountId: process.env.STRIPE_ACCOUNT_ID } as any, globalThis.fetch.bind(globalThis));   // ctor = (config, fetcher) stripe.client.ts:48
  await stripe.assertAccount();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const summary = { scanned: 0, updated: 0, noEmail: 0, bindingMismatch: 0, dryRun };
  try {
    const rows = await prisma.billingAccount.findMany({ where: { stripeAccountId: stripe.accountId, livemode, customerId: { not: null }, recipientEmail: null },
      orderBy: { createdAt: 'asc' }, take: Number(process.argv.find(a => a.startsWith('--limit='))?.slice(8) ?? 10000), select: { id: true, companyId: true, customerId: true } });
    for (const row of rows) {
      summary.scanned++;
      const customer = await stripe.request('GET', `/customers/${row.customerId}`);
      if (customer.id !== row.customerId || customer.deleted || customer.metadata?.billingAccountId !== row.id) { summary.bindingMismatch++; continue; }
      const email = typeof customer.email === 'string' ? customer.email.trim().toLowerCase() : '';
      if (!email) { summary.noEmail++; continue; }
      if (dryRun) { summary.updated++; continue; }
      // idempotent: เขียนเฉพาะเมื่อยังว่าง (reconciler/OTP ที่วิ่งพร้อมกันชนะได้ ไม่ทับ)
      const changed = await prisma.$transaction(async tx => {
        const r = await tx.billingAccount.updateMany({ where: { id: row.id, recipientEmail: null }, data: { recipientEmail: email, recipientSource: 'ACCOUNT_EMAIL' } });
        if (r.count) await tx.auditLog.create({ data: { companyId: row.companyId, action: 'billing.recipient.backfilled', targetType: 'BillingAccount', targetId: row.id,
          requestId: `backfill-billing-recipients:${row.id}`, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { source: 'ACCOUNT_EMAIL' } } });   // ไม่มีอีเมลใน metadata
        return r.count;
      });
      summary.updated += changed;
    }
    console.log(JSON.stringify({ event: 'backfill_billing_recipients_complete', ...summary }));
  } finally { await prisma.$disconnect(); }
}
void main().catch(error => { console.error(JSON.stringify({ event: 'backfill_billing_recipients_failed', errorCode: error instanceof Error ? error.message : 'unknown' })); process.exit(1); });
```

- `recipientSource='ACCOUNT_EMAIL'` = legacy (ผู้รับที่มีอยู่ทุกแถวมาจาก verified account email ของผู้ซื้อตามกติกาเดิม `billing.service.ts:624`)
- **วิธีรันใน release step** (runbook ไม่มีขั้น "one-off script"; migration-tool image รันได้แค่ `migrate deploy` — runbook :304): รันจากเครื่อง controller ผ่านอุโมงค์ DB หลัง `migrate deploy` ของ release เดียวกันและก่อน customer acceptance:
  - UAT: `DATABASE_URL="$(infra/uat/db-port-forward.sh --url)" STRIPE_SECRET_KEY=<uat test key> STRIPE_ACCOUNT_ID=<acct> BILLING_MODE=test pnpm --filter @watchdog-bms/api exec tsx src/scripts/backfill-billing-recipients.ts --dry-run` → อ่านผล → รันซ้ำโดยไม่มี `--dry-run` (recipe `cloud-environment-operations.md:651-664`)
  - Production: recipe memory `prod-bastion-tunnel-recipe` (fetch secret ในเครื่อง + SSM port-forward 55433; **บอก Owner ก่อนเปิดอุโมงค์** เพราะมีเมลแจ้งเตือน; ปิดด้วย `pkill -f session-manager-plugin` + `terminate-session`); `BILLING_MODE=live --yes`; บันทึก summary JSON ใน memory
  - ไม่ใช่ hard gate ของ release: แถวที่ยังว่างจะได้ค่าจาก (1) lazy backfill ใน `emailRecipient.current()` (§4.10) เมื่อผู้ใช้เปิดหน้าแพ็กเกจ, (2) capture ตอนซื้อครั้งถัดไป; อีเมลชำระสำเร็จของแถวว่างใช้ fallback fan-out เจ้าของเดิม (§4.12)
- ต้องไม่ลงทะเบียนใน `package.json` (กติกา) — เรียกด้วย `tsx` ตรง ๆ ตามข้างบน; ไฟล์เป็น `.ts` ไม่ใช่ `.spec.ts` จึงไม่ติด `spec-suite-coverage`

### 3.4 ความหมายของคอลัมน์ (single source)

| คอลัมน์ | ผู้เขียน | เมื่อไร |
|---|---|---|
| `recipientEmail` | reconciler capture (set-if-null), OTP op finish (overwrite), backfill/lazy (set-if-null), admin op (PR E, overwrite) | §4.7, §4.9, §3.3 |
| `recipientSource` | เขียนคู่กับ `recipientEmail` เสมอ | เดิมกัน |
| `recipientBouncedAt` | bounce observer (set-if-null, ต้อง `recipientEmail = attempt.recipient`) ; ล้างเมื่อผู้รับเปลี่ยนสำเร็จ | §4.13 |
| `recipientBounceNotifiedAt` | bounce observer หลังสร้าง NotificationEvent; ล้างพร้อม bouncedAt | §4.13 |
| `checkoutAddressJson` | reconciler capture — เขียนทุกครั้งที่ session/Customer มี address (ค่าล่าสุด); รูปแบบ Stripe `{country,line1,line2,city,state,postal_code}` ตามที่ Stripe ให้ ไม่แปลง | §4.7 |

Authority: คอลัมน์ = ผู้รับสำหรับอีเมลของเรา + ตัวเทียบ drift ที่ quote/checkout (ไม่เรียก Stripe); Stripe `Customer.email` = ผู้รับสำหรับเอกสาร Stripe; op `UPDATE_BILLING_EMAIL` เป็นตัวเดียวที่เขียนทั้งสองที่ให้ตรงกัน

---

## 4. Code changes per file (current → new; เรียงตาม dependency)

ลำดับทำ: 4.1 contracts → 4.2 helpers (profile/sync payload, otp logic, exports จาก auth) → 4.3 schema/migration (§3) → 4.4 service quote/checkout → 4.5 repeat → 4.6 collection/portal → 4.7 reconciler capture → 4.8 recipient OTP service → 4.9 email-recipient op → 4.10 resend → 4.11 notifications (recipient email, review, recipient-changed, bounce) → 4.12 status/history DTO → 4.13 controller/DTO/module → 4.14 auth.guard allowlist + pins → 4.15 web error map + templates

### 4.1 `packages/contracts/src/billing.ts` — ตาม §2.1 (ไม่แตะ `billing-company-profile.ts` ใน contracts: `companyBillingProfile()` ยังคืน `missingFields` และ spec ของมันยังผ่าน)

### 4.2 `apps/api/src/modules/billing/application/billing-company-profile.ts` (31 บรรทัด → เขียนใหม่ทั้งไฟล์)

ปัจจุบัน: `requireBillingProfile` (:7-12 โยน `BILLING_COMPANY_PROFILE_REQUIRED`), `assertBillingProfileUnchanged` (:14-19 เรียก require แล้วเทียบ deep-equal → `BILLING_QUOTE_STALE`), `stripeBillingProfile(profile)` (:21-26 name+address เสมอ), `stripeBillingProfileMatches(customer, profile)` (:28-31)

ใหม่:

```ts
import { isDeepStrictEqual } from 'node:util';
import { companyBillingProfile, type BillingCompanySource, type BillingCompanyProfile, type BillingQuote } from '@watchdog-bms/contracts';
import { billingError } from '../domain/billing-policy';
import type { StripeObject } from '../infrastructure/stripe.client';

/** R-A1: โปรไฟล์ไม่ครบไม่ใช่เหตุปฏิเสธการซื้อ; quote pin ค่าที่เห็น ณ ตอนนั้น (อาจมี missingFields) */
export const billingProfileComplete = (profile: BillingCompanyProfile | undefined) => !!profile && profile.missingFields.length === 0;

/** R-A10: drift ตั้งแต่ quote = QUOTE_STALE เสมอ (ไม่โยน PROFILE_REQUIRED อีก); quote เก่าที่ไม่มี billingProfile = stale เหมือนเดิม */
export function assertBillingProfileUnchanged(company: BillingCompanySource, quote: BillingQuote): BillingCompanyProfile {
  const current = companyBillingProfile(company);
  if (!quote.billingProfile || !isDeepStrictEqual(current, quote.billingProfile))
    throw billingError('BILLING_QUOTE_STALE', 'ชื่อหรือที่อยู่บนเอกสารเปลี่ยน กรุณาตรวจสอบรายการใหม่');
  return current;
}

/** R-A2: payload เดียวใช้ทั้ง 3 จุด (service :636-648, repeat :240/:283, reconciler :68-69) — derive จาก snapshot ล้วน ๆ
 *  เพื่อให้ key `mm:<attempt>:billing-profile` ได้ bytes เดิมทุกครั้ง: name เสมอ; address เฉพาะครบ 5 ช่อง
 *  (ห้ามส่งช่องว่างทับที่อยู่ที่ Stripe เก็บจาก Checkout — RV16); email เฉพาะที่ quote pin ไว้ (verified account email หรือผู้รับปัจจุบัน) */
export function stripeCustomerSyncPayload(snapshot: { quote: Pick<BillingQuote, 'billingProfile' | 'billingEmail' | 'companyName'> }) {
  const profile = snapshot.quote.billingProfile, address = profile?.address;
  return { name: profile?.name || snapshot.quote.companyName.trim(),
    ...(billingProfileComplete(profile) && address ? { address: { country: 'TH', line1: address.line1,
      line2: [address.line2, address.subdistrict].filter(Boolean).join(' '), city: address.district, state: address.province, postal_code: address.postalCode } } : {}),
    ...(snapshot.quote.billingEmail ? { email: snapshot.quote.billingEmail } : {}) };
}
/** เทียบเฉพาะ key ที่ payload ส่ง — Customer ที่มี address จาก Checkout ขณะที่โปรไฟล์ไม่ครบถือว่าตรง */
export function stripeCustomerSynced(customer: StripeObject, snapshot: Parameters<typeof stripeCustomerSyncPayload>[0]): boolean {
  const expected = stripeCustomerSyncPayload(snapshot);
  return customer.name === expected.name && (!expected.email || customer.email === expected.email) &&
    (!expected.address || Object.entries(expected.address).every(([key, value]) => customer.address?.[key] === value));
}
```

ลบ `requireBillingProfile`, `stripeBillingProfile`, `stripeBillingProfileMatches` (ผู้ใช้ทั้งหมดอยู่ใน billing.service/repeat/reconciler/spec — แก้ครบใน PR นี้; grep ยืนยันไม่มีที่อื่น)

### 4.3 exports ใหม่จาก `apps/api/src/modules/auth/application/account-email-otp.service.ts` (ไฟล์ไม่ pinned; ไม่แตะ `auth.module.ts`)

ย้าย private method 3 ตัวออกเป็นฟังก์ชันระดับ module (class เดิมเรียกใช้ต่อ; พฤติกรรมเท่าเดิม) เพื่อให้ billing ใช้ร่วม:

```ts
export function emailOtpEnvironment(config: AppConfigService): string { /* body ของ environment() :28-33 */ }
export function assertEmailOtpDeliveryReady(config: AppConfigService, email: string): void { /* body ของ assertReady() :35-46 (postmark+HMAC key+UAT allowlist) */ }
export async function activeSessionOf(tx: Prisma.TransactionClient, caller: { userId: string; tokenId: string }, now: Date) { /* body ของ session() :48-55 */ }
/** limiter เดิม :156-172 ยกมาเป็นฟังก์ชัน; นับ proofKind ทุกชนิดในโควตาต่อผู้รับ เพื่อให้ account OTP กับ recipient OTP ใช้งบเดียวกัน */
export async function emailOtpRetryAfterSeconds(tx: Prisma.TransactionClient, input: { userId: string; email: string; now: Date; proofKind: string }): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`email-otp-recipient:${input.email}`}, 0))`;
  const recent = await tx.emailVerificationToken.findMany({ where: { userId: input.userId, proofKind: input.proofKind, createdAt: { gt: new Date(input.now.getTime() - 86_400_000) } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  const hourly = recent.filter(t => t.createdAt.getTime() > input.now.getTime() - 3_600_000);
  const recipientRecent = await tx.emailVerificationToken.findMany({ where: { newEmail: input.email, proofKind: { in: ['OTP', 'BILLING_RECIPIENT'] }, createdAt: { gt: new Date(input.now.getTime() - 3_600_000) } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
  const accessRecent = await tx.emailAccessChallenge.findMany({ where: { email: input.email, createdAt: { gt: new Date(input.now.getTime() - 3_600_000) } }, select: { createdAt: true } });
  /* :164-171 เหมือนเดิม → return retryAfterSeconds (อาจ ≤ 0) */
}
export const OTP_WRONG_ACTION = 'auth.email.otp.invalid';   // :19 เปลี่ยนจาก const เป็น export (โควตากรอกผิด 20/ชม./ผู้ใช้ ใช้ร่วมกัน :257-262)
```

`request()` :158-172 เปลี่ยนเป็น `const retryAfterSeconds = await emailOtpRetryAfterSeconds(tx, { userId: user.id, email, now, proofKind: 'OTP' });` — ผลเท่าเดิมยกเว้นโควตาต่อผู้รับที่นับ BILLING_RECIPIENT ด้วย (ตั้งใจ). `account-email-otp.postgres.spec.ts` ต้องยังผ่าน (ไม่เปลี่ยน public API)

### 4.4 `apps/api/src/modules/billing/application/billing.service.ts`

**imports (:2, :4)**
```ts
// เดิม :2  import { assertBillingProfileUnchanged, requireBillingProfile, stripeBillingProfile, stripeBillingProfileMatches } from './billing-company-profile';
import { assertBillingProfileUnchanged, billingProfileComplete, stripeCustomerSyncPayload, stripeCustomerSynced } from './billing-company-profile';
// เดิม :4  import { assertAccountEmailProof, lockAccountEmail, verifiedAccountEmailProof } from '../../auth/application/account-email-state';
import { accountEmailState } from '../../auth/application/account-email-state';
import type { EmailProof } from ...   // :5 คงไว้ — BillingSnapshot.emailProof? ยังอ่านได้จาก snapshot เก่า (ไม่ใช้)
```

**`BillingSnapshot` (:54)**: คง `emailProof?: EmailProof` ไว้ (snapshot เก่าใน `BillingAttempt.quoteSnapshot`/`BillingQuote.snapshotJson`); quote ใหม่ไม่ใส่

**quote() :275-508**
```ts
// :275 signature  body: { …; billingEmail?: string; … }   (ไม่ใช้ค่า; คงเพื่อ shape)
// :301 เดิม  const emailProof = await verifiedAccountEmailProof(this.prisma.client, context.userId);
const emailState = await accountEmailState(this.prisma.client, context.userId);            // non-throwing (:22-34)
const verifiedAccountEmail = emailState.requirement === 'READY' ? emailState.user.email!.trim().toLowerCase() : null;
// :306 เดิม  const billingProfile = requireBillingProfile(company);
const billingProfile = companyBillingProfile(company);                                        // import จาก contracts มีอยู่แล้ว :3
// :308 existing = await this.account(company.id)  (เดิม)
const recipientEmail = existing?.recipientEmail ?? verifiedAccountEmail;                     // R-A2: ผู้รับปัจจุบันก่อน, แล้ว verified account email, ไม่มี → null
// :332-336 เดิม (GET customer + เทียบ email → RECIPIENT_UPDATE_REQUIRED)  →  ลบทั้งบล็อก
//   binding ของ customer id/account/livemode ยังถูกตรวจที่ checkout (:633-634 ใหม่) และทุก apply path — ไม่หายไป
// :339 คงไว้: activeEmailOperationId → BILLING_EMAIL_UPDATE_PENDING (op เปลี่ยนผู้รับค้าง = กรณีเดียวที่ยังบล็อก R-A5)
// :464 เดิม  billingEmail: emailProof.email, billingProfile,
billingEmail: recipientEmail, billingProfile,
// :504 เดิม  { ...(trialCarryover…), emailProof, ... }  →  ตัด `emailProof` ออก
```
ผล: `quote.billingEmail` = ค่าที่ Customer จะได้ (หรือ null = Checkout ถาม); `quote.billingProfile.missingFields` บอกหน้ายืนยัน (PR D ใช้แทน `documentProfile`)

**checkout() reservation tx :514-603**
```ts
// :529-530 เดิม  await lockAccountEmail(tx, context.userId); await assertAccountEmailProof(tx, context.userId, snapshot.emailProof);  → ลบ 2 บรรทัด
// :532 คงไว้ (EMAIL_UPDATE_PENDING)
// :550 เดิม  assertBillingProfileUnchanged(company, snapshot.quote);  → คงบรรทัดนี้ (ฟังก์ชันใหม่ไม่โยน PROFILE_REQUIRED แล้ว)
// เพิ่มหลัง :550 — recipient drift (R-A5/R-A10) เทียบกับ DB ไม่ใช่ Stripe
if ((account?.recipientEmail ?? null) !== (snapshot.quote.billingEmail ?? null) && account?.recipientEmail)
  throw billingError('BILLING_QUOTE_STALE', 'อีเมลรับเอกสารเปลี่ยน กรุณาตรวจสอบรายการใหม่');
//   หมายเหตุ: ถ้า account.recipientEmail ยัง null แต่ snapshot มี verified account email → ไม่ stale (Customer จะได้อีเมลนั้น)
```

**checkout() Customer creation :615-632**
```ts
if (!customerId) {
  await this.prisma.client.$transaction(async tx => {                     // :617-622 เดิม ลบ :620-621 (lockAccountEmail/assertAccountEmailProof)
    await lockPlanTermCompany(tx, context.companyId);
    await this.assertOwner(context, tx);
  });
  customerRequestUnconfirmed = true;
  // :624 เดิม  { ...stripeBillingProfile(snapshot.quote.billingProfile!), email: snapshot.quote.billingEmail, metadata }
  const customer = await this.stripe.request('POST', '/customers', { ...stripeCustomerSyncPayload(snapshot), metadata: { billingAccountId: account.id } }, `mm:${account.id}:customer`);
  // ไม่มี email เมื่อ snapshot.quote.billingEmail null → Checkout ถามและบันทึกลง Customer เอง (R-A2, Stripe docs ยืนยัน 2026-09-27)
  …เดิม :626-631
}
```

**checkout() Customer read + profile sync :633-648**
```ts
const customer = await this.stripe.request('GET', `/customers/${customerId}`);
// :634 เดิม  … || customer.email !== snapshot.quote.billingEmail || …   →  ตัดเงื่อนไข email ออก เหลือ binding
if (customer.id !== customerId || customer.metadata?.billingAccountId !== account.id)
  throw billingError('BILLING_MAPPING_MISMATCH', 'ข้อมูลลูกค้าใน Stripe ไม่ตรงกับบริษัท กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง');   // code เดิมของโปรเจกต์ (มี Thai แล้ว)
// :636 เดิม  if (!stripeBillingProfileMatches(customer, snapshot.quote.billingProfile!)) {
if (!stripeCustomerSynced(customer, snapshot)) {
  …:639-641 เดิม
  // :642-643 เดิม  stripeBillingProfile(snapshot.quote.billingProfile!), `mm:${attempt.id}:billing-profile`
  const updated = await this.stripe.request('POST', `/customers/${customerId}`, stripeCustomerSyncPayload(snapshot), `mm:${attempt.id}:billing-profile`);
  // :644 เดิม  !stripeBillingProfileMatches(updated, …)  →  !stripeCustomerSynced(updated, snapshot)
  …:646-647 เดิม
}
```
(payload อาจมี `email` เมื่อ Customer ยังไม่มีอีเมลแต่ snapshot มี verified account email → Stripe ตั้งให้; ถ้า Customer มีอีเมลอื่นอยู่และ snapshot มีอีเมล = ผู้รับใน DB (ผ่าน QUOTE_STALE แล้ว) → เขียนทับให้ตรง DB ตามกติกา authority §3.4)

**checkout() stop-barrier tx :650-679**
```ts
// :659 คง assertBillingProfileUnchanged(company, snapshot.quote) (ไม่โยน PROFILE_REQUIRED แล้ว)
// เพิ่มหลัง :659 recipient drift แบบเดียวกับ reservation (อ่าน account ใหม่ใน tx: มี `await this.account(context.companyId, tx)` ที่ :660 อยู่แล้ว — ดึงมาเป็นตัวแปรก่อน)
// :675-676 เดิม  await lockAccountEmail(tx, context.userId); await assertAccountEmailProof(tx, context.userId, snapshot.emailProof);  → ลบ
```

**checkout() second Customer read :683-687**
```ts
// เดิม :685  … || customer.email !== snapshot.quote.billingEmail || …  → RECIPIENT_UPDATE_REQUIRED
if (account.customerId) {
  const customer = await this.stripe.request('GET', `/customers/${customerId}`);
  if (customer.id !== customerId || customer.metadata?.billingAccountId !== account.id)
    throw billingError('BILLING_MAPPING_MISMATCH', 'ข้อมูลลูกค้าใน Stripe ไม่ตรงกับบริษัท กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง');
}
```

**checkout() Checkout params :711-729 (R-A3)**
```ts
const returnUrl = new URL(`/companies/${context.companyId}/billing/return?attempt=${attempt.id}`, origin).toString();   // :682 เดิม
const cancelUrl = `${returnUrl}&checkout=canceled`;                                                                      // G12/RV29 — เว็บอ่าน ?checkout=canceled (PR D)
const customerUpdate = { address: billingProfileComplete(snapshot.quote.billingProfile) ? 'never' : 'auto' } as const; // RV16: 'auto' ทับ address ที่ sync ไว้; ไม่ตั้ง name
const session = await this.stripe.request('POST', '/checkout/sessions', once ? {
  mode: 'payment', customer: customerId, client_reference_id: attempt.id,
  payment_method_types: [snapshot.quote.purchaseMode?.startsWith('PROMPTPAY') ? 'promptpay' : 'card'],
  metadata, payment_intent_data: { metadata, ...(snapshot.advanceDeal && snapshot.quote.purchaseMode === 'CARD_AUTO' ? { setup_future_usage: 'off_session' } : {}) },
  invoice_creation: { enabled: true, invoice_data: { metadata, ...(taxIds เดิม :717) } },
  line_items: [ …เดิม :718-720 ],
  success_url: returnUrl, cancel_url: cancelUrl, locale: 'th', billing_address_collection: 'required',
  customer_update: customerUpdate,
  expires_at: Math.floor(Date.now() / 1000) + 1800,
} : {
  mode: 'subscription', customer: customerId, client_reference_id: attempt.id, payment_method_types: ['card'],
  line_items: [ …เดิม :725 ],
  success_url: returnUrl, cancel_url: cancelUrl, locale: 'th', billing_address_collection: 'required',
  customer_update: customerUpdate,
  metadata, subscription_data: { billing_mode: { type: 'classic' }, metadata },
  expires_at: Math.floor(Date.now() / 1000) + 1800,
}, `mm:${attempt.id}:checkout`);
```
ความเข้ากันได้ (Stripe API reference ตรวจ 2026-09-27): `customer_update` ใช้ได้เฉพาะเมื่อส่ง `customer` (เราส่งเสมอ); ไม่ขัดกับ `invoice_creation` (payment mode) หรือ `setup_future_usage`; `customer_update.name` ไม่ตั้ง = default `never` (ชื่อบนเอกสารคงเป็นชื่อร้าน R-A3); `billing_address_collection: 'required'` คงไว้ตาม Q1 (prefill มาจากบัตรที่บันทึกล่าสุด ไม่ใช่ Customer.address — G27 ต้องพิสูจน์ทั้ง never/auto). `appendForm` (`stripe.client.ts:38-44`) แปลง `customer_update[address]=auto` ถูกต้อง

**portal() :920-964 (DQ2)**: ลบ `:922` (`verifiedAccountEmailProof`) และ `:928-929` (`lockAccountEmail`/`assertAccountEmailProof`) ใน `assertCurrent`; `:924` คง `account.activeEmailOperationId` ไว้ (op ผู้รับค้างยังกัน portal — Stripe portal config ห้ามแก้อีเมลอยู่แล้ว). ไม่มีการเปลี่ยน key/params อื่น

**status() :761-918**: เพิ่ม `recipient` (§4.12); `allowedActions` ไม่เคยขึ้นกับอีเมล/โปรไฟล์อยู่แล้ว (:803-818 ตรวจ gates/account เท่านั้น) — ไม่แก้

**history() :1008-1022**: เพิ่ม `documentActions` (§4.12)

**getter ใหม่/แก้**
```ts
get emailRecipient() { return new BillingEmailRecipient(this.prisma, this.stripe, this, this.config); }   // :76 — ส่ง config เพื่อสร้าง notice (§4.9)
get documentResend() { return new BillingDocumentResend(this.prisma, this.stripe, this); }                 // ใหม่ (§4.10)
```

### 4.5 `apps/api/src/modules/billing/application/billing-repeat.ts`

```ts
// :1 เดิม  import { assertAccountEmailProof, lockAccountEmail } from '../../auth/application/account-email-state';  → ลบทั้งบรรทัด
// :23 เดิม  import { assertBillingProfileUnchanged, stripeBillingProfile, stripeBillingProfileMatches } from './billing-company-profile';
import { assertBillingProfileUnchanged, billingProfileComplete, stripeCustomerSyncPayload, stripeCustomerSynced } from './billing-company-profile';
```

`command()` :203-213 — ขั้นตรวจสิทธิ์ก่อนคำสั่งแรก
```ts
if (!old && ['hold', 'billingEmail', 'billingProfile', 'checkout'].includes(step) && !journal.commands.checkout) {
  await this.prisma.client.$transaction(async tx => {
    await this.fence(tx, account, attempt, lease);
    await this.billing.assertOwner({ companyId: account.companyId, userId: attempt.initiatingUserId } as RequestContext, tx);
    // :207-208 (lockAccountEmail / assertAccountEmailProof) ลบ
    const company = await tx.company.findUniqueOrThrow({ where: { id: account.companyId } });
    assertBillingProfileUnchanged(company, snapshot.quote);                                    // :210 คง (non-throwing PROFILE_REQUIRED)
    const current = await tx.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
    if (current.recipientEmail && current.recipientEmail !== (snapshot.quote.billingEmail ?? null)) throw review();   // R-A5 drift = BILLING_REPEAT_REVIEW (ผลเดิมของเส้นทางนี้)
    journal.commands[step] = { at: new Date().toISOString(), hash };
    …:212
  });
}
```

`advance()` profile settle :239-243
```ts
if (journal.commands.billingProfile && !journal.profileSynced) {
  const customer = await command('billingProfile', `/customers/${account.customerId}`, stripeCustomerSyncPayload(snapshot));   // bytes เดิมกับ key mm:<attempt>:billingProfile
  if (customer.id !== account.customerId || customer.metadata?.billingAccountId !== account.id || !stripeCustomerSynced(customer, snapshot)) throw review();
  journal.profileSynced = true; await save();
}
```

`advance()` Customer read :279-286
```ts
let customer = await this.stripe.request('GET', `/customers/${account.customerId}`);
if (customer.id !== account.customerId || customer.metadata?.billingAccountId !== account.id) throw review();
// :281 เดิม  if (customer.email !== snapshot.quote.billingEmail) throw review();  → ลบ (drift ตรวจกับ DB ใน command() แล้ว)
if (!journal.commands.checkout && !stripeCustomerSynced(customer, snapshot)) {
  customer = await command('billingProfile', `/customers/${account.customerId}`, stripeCustomerSyncPayload(snapshot));
  if (customer.id !== account.customerId || customer.metadata?.billingAccountId !== account.id || !stripeCustomerSynced(customer, snapshot)) throw review();
  journal.profileSynced = true; await save();
}
```

`advance()` Checkout params :287-295 (**journal-hashed** — `command('checkout', path, params)` :200-202 เทียบ `hashBilling([path, params])` กับ `journal.commands.checkout.hash`; attempt ที่ journal ไว้ด้วย params เก่าจะ `review()` หลัง deploy → deploy note §9)
```ts
const returnUrl = new URL(`/companies/${account.companyId}/billing/return?attempt=${attempt.id}`, origin).toString();
const metadata = { billingAttemptId: attempt.id, billingAccountId: account.id };
sessions = [await command('checkout', '/checkout/sessions', { mode: 'payment', customer: account.customerId,
  client_reference_id: attempt.id, payment_method_types: ['card'], metadata, invoice_creation: { enabled: true, invoice_data: { metadata, …:291 } },
  payment_intent_data: { metadata }, line_items: [ …:292-294 ],
  success_url: returnUrl, cancel_url: `${returnUrl}&checkout=canceled`, locale: 'th', billing_address_collection: 'required',
  customer_update: { address: billingProfileComplete(snapshot.quote.billingProfile) ? 'never' : 'auto' }, expires_at: journal.checkoutExpiresAt })];
```

`apply()` :471-542 — recipient capture (§4.7 ข้อ D): รับ `capture` เพิ่ม; caller ที่ :361 อ่าน capture ก่อน (`const capture = await this.captureRecipient(account, session)` — helper ใน reconciler; repeat มี `this.stripe` เอง → ใส่ฟังก์ชัน `readRecipientCapture` ใน `billing-recipient-capture.ts` ใช้ร่วม 2 คลาส)

### 4.6 `apps/api/src/modules/billing/application/billing-collection.ts` (DQ2 — RESUME_RENEWAL/CANCEL_DOWNGRADE เลิกบังคับ verified account email)

```ts
// :1 ลบ import { assertAccountEmailProof, lockAccountEmail, verifiedAccountEmailProof }
// :2 คง import type { EmailProof }  (Proposed.emailProof? ยังอยู่เพื่ออ่านแถวค้าง :20)
// :24 ลบ  const needsEmail = …
// :75 เดิม  const emailProof = needsEmail(action) ? await verifiedAccountEmailProof(…) : undefined;  → ลบ
// :80 เดิม  … || (needsEmail(action) && account.activeEmailOperationId) || …   → ตัดเงื่อนไขนี้ออก (op ผู้รับไม่เกี่ยวกับการต่ออายุอีก)
// :144 เดิม  { ...(emailProof ? { emailProof } : {}), accountId, … }  →  { accountId, … }
// :164 เดิม  if (needsEmail(proposed.action)) { await lockAccountEmail(…); await assertAccountEmailProof(…); }  → ลบ
// :167 เดิม  … || (needsEmail(proposed.action) && account.activeEmailOperationId) || …  → ตัดออก
// :261-264 เดิม  if (!journal.startedAt && needsEmail(proposed.action)) { lockAccountEmail; assertAccountEmailProof }  → ลบ
```
`assertOwner` (:259) ยังตรวจสิทธิ์ก่อน side effect; `billing-collection.spec.ts` (catalog) ต้องปรับถ้าอ้าง `emailProof` (ตรวจตอนทำ — grep `emailProof` ใน spec นั้น)

### 4.7 Recipient capture (R-A4 ก) — ไฟล์ใหม่ `apps/api/src/modules/billing/application/billing-recipient-capture.ts` + แก้ apply 4 ทาง + admin apply

```ts
import type { BillingAccount, Prisma } from '../../../generated/prisma/client';
import type { StripeClient, StripeObject } from '../infrastructure/stripe.client';
import type { BillingSnapshot } from './billing.service';

export type RecipientCapture = { email: string | null; address: Record<string, unknown> | null };
const emailOf = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null;
const addressOf = (v: unknown) => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** กฎ: ห้ามเรียก provider ใน transaction (RV/F16) — เรียกก่อน tx ภายใต้ account lease; ข้ามเมื่อมีผู้รับแล้วและไม่มี session address ใหม่ */
export async function readRecipientCapture(stripe: StripeClient, account: BillingAccount, session?: StripeObject | null): Promise<RecipientCapture | null> {
  const details = session?.customer_details;                       // มีทั้ง mode payment และ subscription หลัง complete
  if (details && (emailOf(details.email) || addressOf(details.address))) return { email: emailOf(details.email), address: addressOf(details.address) };
  if (account.recipientEmail || !account.customerId) return null;   // ไม่มีอะไรต้องอ่าน → ไม่แตะ provider (replay ไม่เรียกซ้ำ)
  const customer = await stripe.request('GET', `/customers/${account.customerId}`);
  if (customer.id !== account.customerId || customer.metadata?.billingAccountId !== account.id) throw new Error('billing.customer_binding');
  return { email: emailOf(customer.email), address: addressOf(customer.address) };
}

/** เรียกใน tx หลัง upsert invoice; idempotent: recipient set-if-null, address = ค่าล่าสุดเมื่อมี; audit ครั้งเดียว (ไม่มี PII) */
export async function recordRecipientCapture(tx: Prisma.TransactionClient, account: Pick<BillingAccount, 'id' | 'companyId'>, snapshot: BillingSnapshot,
  capture: RecipientCapture | null, invoiceId: string, actorUserId: string | null) {
  if (!capture) return;
  if (capture.address) await tx.billingAccount.updateMany({ where: { id: account.id }, data: { checkoutAddressJson: capture.address as Prisma.InputJsonValue } });
  if (!capture.email) return;
  const source = snapshot.quote.billingEmail ? 'ACCOUNT_EMAIL' : 'STRIPE_CHECKOUT';       // §18.2 R-A4: STRIPE_CHECKOUT เฉพาะเมื่อ snapshot ไม่มีอีเมล
  const changed = await tx.billingAccount.updateMany({ where: { id: account.id, recipientEmail: null }, data: { recipientEmail: capture.email, recipientSource: source } });
  if (!changed.count) return;
  await tx.auditLog.create({ data: { companyId: account.companyId, actorUserId, action: 'billing.recipient.captured', targetType: 'BillingInvoice', targetId: invoiceId,
    requestId: invoiceId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { source, addressCaptured: !!capture.address } } });
}
```

ตำแหน่งแทรก (อ่านก่อน tx, เขียนหลัง upsert ก่อน `if (row.appliedAt) return`):

| Path | อ่าน (นอก tx, ใต้ lease) | เขียน (ใน tx) |
|---|---|---|
| A one-time `reconcileOneTime` :468-687 | หลัง :513 (`evidence`) — `const capture = await readRecipientCapture(this.stripe, account, session);` (session จาก :481) | หลัง `recordBillingFinancials` :547, ก่อน :548 — `await recordRecipientCapture(tx, account, snapshot, capture, row.id, attempt.initiatingUserId);` |
| B advance deal `reconcileAdvanceDeal` :690-749 | รับ `capture` เป็น param เพิ่ม (คำนวณใน A ก่อน :514 แล้วส่งต่อ :515) | หลัง :714 ก่อน :715 |
| C subscription INITIAL `reconcileAccount` :245-274 + `verifyAndApplyInvoice` :1135 → `applyInvoice` :1251 | ใน `reconcileAccount` หลัง :253 (session ผูกแล้ว): `const capture = attempt ? await readRecipientCapture(this.stripe, account, session) : null;` ส่งผ่าน `verifyAndApplyInvoice(…, snapshot, leaseToken, recordOnly, capture)` → `applyInvoice(…, recordOnly, capture)` | หลัง :1275 ก่อน :1276 — เฉพาะ `evidence.kind === 'INITIAL'` (renewal ไม่ capture) |
| D repeat `billing-repeat.ts` `advance` :361 → `apply` :471 | ก่อน :361: `const capture = await readRecipientCapture(this.stripe, account, session);` ส่งเข้า `apply(…, lease, capture)` | ใน `apply` หลัง :476 (`invoice`) ก่อน :477 |
| E admin apply held `reconcileOriginalInvoice` :437-466 | สาย one-time/repeat วิ่งกลับเข้า A/D อยู่แล้ว (:447, :451); สาย subscription :454-465 ไม่มี session → `const capture = await readRecipientCapture(this.stripe, account, null);` (GET Customer เฉพาะเมื่อยังว่าง) ส่งเข้า `verifyAndApplyInvoice` | เหมือน C |
| `importDiscoveredInvoice` :374-435 (recordOnly) | ไม่ capture (evidence import ไม่ใช่ apply) — ส่ง `null` | — |

ทั้งหมดเป็น additive param ท้ายสุด (optional) จึงไม่กระทบ call site อื่น. Replay: A/B/C/D กลับเข้ามาเมื่อ `row.appliedAt` แล้ว — `readRecipientCapture` ยังอ่าน `session.customer_details` (ไม่มี provider call เพิ่มเพราะ session ถูก GET อยู่แล้วทุกรอบ) แล้ว `recordRecipientCapture` เขียน address ค่าเดิม + recipient set-if-null → no-op ✓

RV20 (PROMPTPAY_RENEW binding `:1100-1107` ต้องมี Customer email สำหรับ `send_invoice`): หลัง G27 ถ้าพบว่า Checkout **ไม่**เขียนอีเมลลง Customer ให้เพิ่มก่อน `:1100`: `if (!customer.email && capture?.email) await this.stripe.request('POST', `/customers/${account.customerId}`, { email: capture.email }, `mm:${attempt.id}:recipient-email`)` (journal ใน `attempt.collectionJson.recipientEmailRequestedAt` แบบ `qrSubscriptionRequestedAt` :1088-1098). ค่าเริ่มต้น: ไม่ทำ (Stripe docs ระบุว่า Checkout เขียนให้)

### 4.8 Recipient OTP (R-A8/R-D2) — ไฟล์ใหม่ 2 ไฟล์ + ลงทะเบียนใน `billing.module.ts`

**`apps/api/src/modules/billing/domain/billing-recipient-otp.logic.ts`** (pure; unit spec ใหม่)
```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
export const BILLING_RECIPIENT_OTP_POLICY = 'BILLING_RECIPIENT_OTP_V1';
export const BILLING_RECIPIENT_PROOF_TTL_MS = 30 * 60_000;      // proof ใช้เปิด preview ได้ 30 นาทีหลัง confirm
export type RecipientOtpBinding = { environment: string; id: string; userId: string; companyId: string; email: string; sessionId: string; keyVersion: string; expiresAt: Date };
export function recipientOtpDigest(code: string, b: RecipientOtpBinding, key: string): string {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid email OTP key configuration.');
  return createHmac('sha256', Buffer.from(key, 'hex')).update(JSON.stringify([BILLING_RECIPIENT_OTP_POLICY, b.environment, b.id, b.userId, b.companyId, b.email,
    b.sessionId, b.keyVersion, b.expiresAt.toISOString(), code])).digest('hex');
}
export function matchesRecipientOtp(code: string, digest: string, b: RecipientOtpBinding, key: string): boolean {
  if (!/^\d{6}$/.test(code) || !/^[a-f0-9]{64}$/.test(digest)) return false;
  return timingSafeEqual(Buffer.from(recipientOtpDigest(code, b, key), 'hex'), Buffer.from(digest, 'hex'));
}
```
(แยกจาก `emailOtpDigest` เพราะ tuple เดิมผูก `emailRevision`/`securityBindingHash` ของบัญชี — challenge ของบริษัทผูก `companyId` แทน; `EMAIL_OTP_TTL_MS`/`EMAIL_OTP_COOLDOWN_MS`/`newEmailOtp` ใช้ของเดิมจาก `email-otp.logic.ts`)

**`apps/api/src/modules/billing/application/billing-recipient-otp.service.ts`** (`@Injectable`, providers ใน `billing.module.ts:29`; deps: `PrismaService`, `AppConfigService`, `EmailDeliveryService` (export จาก AuthModule `auth.module.ts:178` ✓), `BillingService`)

```ts
type Caller = { companyId: string; userId: string; tokenId: string; requestId: string };
const PROOF_KIND = 'BILLING_RECIPIENT';
const lockRecipientOtp = (tx, companyId) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing-recipient-otp:${companyId}`}))`;

async request(input: Caller & { email: string; requestKey: string }): Promise<BillingRecipientOtpChallenge> {
  await this.billing.assertOwner(input);                                                     // company.plan.manage
  let email: string; try { email = requireLineContactEmail(input.email); } catch { throw emailError('EMAIL_OTP_TARGET_INVALID', 'กรุณาระบุอีเมลให้ถูกต้อง', 400); }
  const account = await this.billing.account(input.companyId);
  if (!account?.customerId) throw billingError('BILLING_RECIPIENT_UNAVAILABLE', 'ยังไม่มีเอกสารให้ตั้งอีเมลรับ กรุณาซื้อแพ็กเกจก่อน');
  if (account.recipientEmail === email) throw billingError('BILLING_RECIPIENT_UNCHANGED', 'อีเมลนี้เป็นอีเมลรับเอกสารปัจจุบันอยู่แล้ว');
  const fingerprint = hashToken(JSON.stringify([input.companyId, email])), code = newEmailOtp();
  const reserved = await this.prisma.client.$transaction(async tx => {
    await lockRecipientOtp(tx, input.companyId);
    const now = await databaseNow(tx), session = await activeSessionOf(tx, input, now);   // EMAIL_REAUTH_REQUIRED 401 ถ้าไม่มี session
    const replay = await tx.emailVerificationToken.findUnique({ where: { userId_requestKey: { userId: input.userId, requestKey: input.requestKey } } });
    if (replay) { if (replay.requestFingerprint !== fingerprint || replay.proofKind !== PROOF_KIND) throw emailError('EMAIL_STATE_CHANGED', 'รายการนี้เปลี่ยนแล้ว กรุณาตรวจข้อมูลอีกครั้ง'); return { id: replay.id, send: false }; }
    assertEmailOtpDeliveryReady(this.config, email);                                        // postmark + HMAC key + UAT allowlist (§9)
    const retryAfterSeconds = await emailOtpRetryAfterSeconds(tx, { userId: input.userId, email, now, proofKind: PROOF_KIND });
    if (retryAfterSeconds > 0) throw emailError('EMAIL_OTP_RATE_LIMITED', 'กรุณารอก่อนขอรหัสใหม่', 429, { retryAfterSeconds });
    const id = randomUUID(), expiresAt = new Date(now.getTime() + EMAIL_OTP_TTL_MS);
    const attempt = await this.delivery.prepare({ purpose: 'email_verification', recipient: email, deadlineAt: expiresAt, intentKey: `billing-recipient-otp:${id}` }, tx)
      .catch(error => { if (error instanceof PostmarkSendError) throw emailError('EMAIL_DELIVERY_UNAVAILABLE', 'ยังส่งรหัสไม่ได้ กรุณาตรวจอีเมลหรือติดต่อทีมงาน', 503); throw error; });
    await tx.emailVerificationToken.updateMany({ where: { userId: input.userId, companyId: input.companyId, proofKind: PROOF_KIND, status: 'PENDING' }, data: { status: 'REVOKED' } });
    const binding: RecipientOtpBinding = { environment: emailOtpEnvironment(this.config), id, userId: input.userId, companyId: input.companyId, email, sessionId: session.id, keyVersion: this.config.emailOtpHmacKeyVersion!, expiresAt };
    await tx.emailVerificationToken.create({ data: { id, userId: input.userId, companyId: input.companyId, newEmail: email, tokenHash: recipientOtpDigest(code, binding, this.config.emailOtpHmacKey!),
      proofKind: PROOF_KIND, sessionId: session.id, keyVersion: binding.keyVersion, sendAttemptId: attempt.id, requestKey: input.requestKey, requestFingerprint: fingerprint, expiresAt, createdAt: now } });
    await this.audit(tx, input, 'billing.recipient.otp.requested', id);                     // targetType EmailVerificationToken; metadata { challengeId } เท่านั้น
    return { id, send: true, attempt, expiresAt };
  });
  if (reserved.send) { try { await this.delivery.send(reserved.attempt, renderEmailOtp(code, reserved.expiresAt), async () => { /* re-check PENDING + session ใน tx ก่อน POST (แบบ :198-206) */ }); }
    catch { await this.prisma.client.emailSendAttempt.updateMany({ where: { id: reserved.attempt.id, status: 'READY', dispatchStartedAt: null }, data: { status: 'PERMANENT', errorCode: 'otp_not_dispatched' } }); } }
  return this.challenge(input, reserved.id);
}

async confirm(input: Caller & { challengeId: string; code: string }): Promise<BillingRecipientOtpProof> {
  await this.billing.assertOwner(input);
  const result = await this.prisma.client.$transaction(async tx => {
    await lockRecipientOtp(tx, input.companyId);
    const now = await databaseNow(tx), session = await activeSessionOf(tx, input, now);
    const token = await tx.emailVerificationToken.findFirst({ where: { id: input.challengeId, userId: input.userId, companyId: input.companyId, proofKind: PROOF_KIND } });
    if (!token) return 'EMAIL_OTP_NOT_FOUND';
    if (token.sessionId !== session.id) return 'EMAIL_REAUTH_REQUIRED';
    if (token.status === 'USED') return null;                                                // idempotent confirm
    if (token.status !== 'PENDING') return 'EMAIL_STATE_CHANGED';
    if (token.expiresAt <= now) { await tx.emailVerificationToken.update({ where: { id: token.id }, data: { status: 'EXPIRED' } }); return 'EMAIL_OTP_EXPIRED'; }
    if (token.keyVersion !== this.config.emailOtpHmacKeyVersion) return 'EMAIL_STATE_CHANGED';
    const wrong = await tx.auditLog.count({ where: { actorUserId: input.userId, action: OTP_WRONG_ACTION, createdAt: { gt: new Date(now.getTime() - 3_600_000) } } });
    if (wrong >= 20) throw emailError('EMAIL_OTP_RATE_LIMITED', 'กรุณารอก่อนลองยืนยันใหม่', 429, { retryAfterSeconds: 3600 });   // โควตาเดียวกับ account OTP :257-262
    if (!this.config.emailOtpHmacKey) return 'EMAIL_DELIVERY_UNAVAILABLE';
    const binding = { environment: emailOtpEnvironment(this.config), id: token.id, userId: token.userId, companyId: input.companyId, email: token.newEmail, sessionId: token.sessionId!, keyVersion: token.keyVersion!, expiresAt: token.expiresAt };
    if (!matchesRecipientOtp(input.code, token.tokenHash, binding, this.config.emailOtpHmacKey)) {
      const failedAttempts = token.failedAttempts + 1;
      await tx.emailVerificationToken.update({ where: { id: token.id }, data: { failedAttempts, ...(failedAttempts >= 5 ? { status: 'REVOKED' } : {}) } });
      await this.audit(tx, input, OTP_WRONG_ACTION, token.id);
      return failedAttempts >= 5 ? 'EMAIL_OTP_ATTEMPTS_EXCEEDED' : 'EMAIL_OTP_INVALID';
    }
    await tx.emailVerificationToken.update({ where: { id: token.id }, data: { status: 'USED', usedAt: now } });
    await this.audit(tx, input, 'billing.recipient.otp.verified', token.id);
    return null;
  });
  if (result) throw emailError(result, MESSAGES[result], result === 'EMAIL_OTP_RATE_LIMITED' ? 429 : result === 'EMAIL_OTP_NOT_FOUND' ? 404 : 409);   // ข้อความไทยชุดเดียวกับ account-email-otp.service.ts:302-306
  const token = await this.prisma.client.emailVerificationToken.findUniqueOrThrow({ where: { id: input.challengeId } });
  return { recipientProofId: token.id, email: token.newEmail, expiresAt: new Date(token.usedAt!.getTime() + BILLING_RECIPIENT_PROOF_TTL_MS).toISOString() };
}

/** proof ที่ใช้เปิด/ยืนยัน/advance op — ใช้ร่วมโดย BillingEmailRecipient (static helper export) */
export async function assertRecipientProof(tx: Prisma.TransactionClient, proof: { challengeId: string; companyId: string; userId: string; email: string }, opId?: string) {
  const token = await tx.emailVerificationToken.findFirst({ where: { id: proof.challengeId, companyId: proof.companyId, userId: proof.userId, proofKind: 'BILLING_RECIPIENT', status: 'USED' } });
  if (!token || token.newEmail !== proof.email || !token.usedAt) throw billingError('BILLING_RECIPIENT_PROOF_INVALID', 'การยืนยันอีเมลนี้ใช้ไม่ได้แล้ว กรุณาขอรหัสยืนยันใหม่');
  // ใช้ได้ครั้งเดียว: op อื่นที่ยังไม่จบห้ามอ้าง challenge เดียวกัน (Prisma JSON path filter แบบ :257)
  const other = await tx.billingOperation.findFirst({ where: { type: 'UPDATE_BILLING_EMAIL', companyId: proof.companyId, state: { notIn: ['CANCELLED', 'FAILED'] },
    proposedJson: { path: ['target', 'challengeId'], equals: proof.challengeId }, ...(opId ? { id: { not: opId } } : {}) }, select: { id: true } });
  if (other) throw billingError('BILLING_RECIPIENT_PROOF_INVALID', 'การยืนยันอีเมลนี้ถูกใช้แล้ว กรุณาขอรหัสยืนยันใหม่');
  // หน้าต่าง 30 นาทีบังคับเฉพาะตอนเปิด preview (opId undefined); op ที่ตั้งแล้วอ้าง proof ต่อได้จนจบ
  if (!opId && Date.now() - token.usedAt.getTime() > BILLING_RECIPIENT_PROOF_TTL_MS) throw billingError('BILLING_RECIPIENT_PROOF_INVALID', 'การยืนยันอีเมลนี้หมดอายุแล้ว กรุณาขอรหัสยืนยันใหม่');
  return token;
}
```

การตัดสินใจที่ต้องให้ Owner รับทราบ (§10): flow นี้**ไม่**บังคับรหัสผ่าน/LINE reauth (ต่างจาก account OTP :145-152) เพราะ (1) พิสูจน์ครอบครอง mailbox ใหม่ด้วย OTP อยู่แล้ว, (2) ผู้กดต้องมี session + `company.plan.manage`, (3) reauth LINE ในเบราว์เซอร์ของ LINE คือทางตันเดิม (G03/RV23), (4) ผู้รับเดิม + ผู้จัดการแพ็กเกจได้แจ้งเตือนทันที (§4.9/§4.11) จึงตรวจจับได้

### 4.9 `apps/api/src/modules/billing/application/billing-email-recipient.ts` (170 บรรทัด) — op `UPDATE_BILLING_EMAIL` รับ target แบบ proof

```ts
// :14 เดิม  type Proposed = { accountId; customerId; previousEmail; emailProof: EmailProof };
type Target = { email: string; source: 'ACCOUNT_EMAIL' | 'CUSTOMER_OTP'; emailProof?: EmailProof; challengeId?: string };
type Proposed = { accountId: string; customerId: string; previousEmail: string | null; target?: Target; emailProof?: EmailProof /* แถวก่อน release นี้ */ };
const targetOf = (p: Proposed): Target => p.target ?? { email: p.emailProof!.email, source: 'ACCOUNT_EMAIL', emailProof: p.emailProof };
// ctor :20-21 เพิ่ม  private readonly config: Pick<AppConfigService, 'postmarkServerId' | 'postmarkMessageStream'>
// view() :36  newEmail: targetOf(proposed).email, source: targetOf(proposed).source
```

`preview(context, recipientProofId?: string)` :57-76
```ts
await this.billing.assertOwner(context);
const account = await this.billing.account(context.companyId);
if (!account?.customerId) throw review();
// assertRecipientProof (§4.8) รับ `email?: string` — ไม่ส่ง = ไม่เทียบอีเมล (ใช้ตอนเปิด preview เพื่ออ่านอีเมลจาก token)
const target: Target = recipientProofId
  ? await this.prisma.client.$transaction(async tx => { const token = await assertRecipientProof(tx, { challengeId: recipientProofId, companyId: context.companyId, userId: context.userId });
      return { email: token.newEmail, source: 'CUSTOMER_OTP' as const, challengeId: token.id }; })
  : (() => { const emailProof = await verifiedAccountEmailProof(this.prisma.client, context.userId); return { email: emailProof.email, source: 'ACCOUNT_EMAIL' as const, emailProof }; })();   // สายเดิม :59
if (target.email === account.recipientEmail) throw billingError('BILLING_RECIPIENT_UNCHANGED', 'อีเมลนี้เป็นอีเมลรับเอกสารปัจจุบันอยู่แล้ว');
const previousEmail = this.customer(await this.stripe.request('GET', `/customers/${account.customerId}`), account);     // :62 เดิม
const proposed: Proposed = { accountId: account.id, customerId: account.customerId, previousEmail, target };
return this.prisma.client.$transaction(async tx => {
  await lockPlanTermCompany(tx, context.companyId); await this.billing.assertOwner(context, tx); await this.company(context, tx);
  if (target.source === 'ACCOUNT_EMAIL') { await lockAccountEmail(tx, context.userId); await assertAccountEmailProof(tx, context.userId, target.emailProof); }   // :67 เดิม เฉพาะสายอีเมลบัญชี
  else await assertRecipientProof(tx, { challengeId: target.challengeId!, companyId: context.companyId, userId: context.userId, email: target.email });
  …:68-74 เดิม (reason: 'เปลี่ยนผู้รับเอกสารของบริษัทที่เลือก')
});
```
`command('submit')` :90-96: แทน `:92` ด้วยเงื่อนไขเดียวกัน (ACCOUNT_EMAIL → assert proof; CUSTOMER_OTP → `assertRecipientProof(tx, …, row.id)`)

`advance()` :118-169
```ts
// :133-135 คงไว้ (อ่าน Customer email ปัจจุบัน; `email === proposed.previousEmail` ยังบังคับ — ถ้า Stripe เปลี่ยนไปแล้วให้ review)
// :134  if (journal.startedAt && email === targetOf(proposed).email) { await finish(); return; }
// :140-142 เดิม  assertOwner; company; lockAccountEmail+assertAccountEmailProof
await this.billing.assertOwner({ companyId: account.companyId, userId: row.initiatorUserId } as RequestContext, tx);
await this.company({ companyId: account.companyId } as RequestContext, tx);
const target = targetOf(proposed);
if (target.source === 'ACCOUNT_EMAIL') { await lockAccountEmail(tx, row.initiatorUserId); await assertAccountEmailProof(tx, row.initiatorUserId, target.emailProof); }
else await assertRecipientProof(tx, { challengeId: target.challengeId!, companyId: account.companyId, userId: row.initiatorUserId, email: target.email }, row.id);
// :149  { email: targetOf(proposed).email }  key เดิม mm:email-recipient:<row.id>
// :150  … !== targetOf(proposed).email
```
`finish()` :124-130 เพิ่มหลัง :127
```ts
const target = targetOf(proposed);
await tx.billingAccount.update({ where: { id: account.id }, data: { recipientEmail: target.email, recipientSource: target.source, recipientBouncedAt: null, recipientBounceNotifiedAt: null, version: { increment: 1 } } });
await tx.auditLog.create({ data: { companyId: account.companyId, actorUserId: row.initiatorUserId, action: 'billing.recipient.changed', targetType: 'BillingAccount', targetId: account.id,
  requestId: row.id, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { source: target.source, operationId: row.id, hadPrevious: !!proposed.previousEmail } } });   // ไม่มีอีเมล
// แจ้งผู้รับเดิม (email) + ผู้จัดการแพ็กเกจ (LINE/web) ผ่าน outbox ที่ billing notifications drain รับ (§4.11.4) — ทำเฉพาะเมื่อผู้รับเดิมมีและต่างจากใหม่
let noticeAttemptId: string | undefined;
if (proposed.previousEmail && proposed.previousEmail !== target.email && this.config.postmarkServerId) {
  const notice = await tx.emailSendAttempt.create({ data: { id: randomUUID(), intentKey: `billing-recipient-notice:${row.id}`, generation: 1, purpose: 'billing_status',
    recipient: proposed.previousEmail, provider: 'postmark', providerServerId: this.config.postmarkServerId, stream: this.config.postmarkMessageStream, status: 'READY' } });   // แบบ account-email-otp.service.ts:284-286
  noticeAttemptId = notice.id;
}
await tx.outboxEvent.upsert({ where: { eventKey: `billing:recipient-changed:${row.id}` }, update: {}, create: { companyId: account.companyId, eventType: 'billing.recipient.changed',
  aggregateType: 'BillingAccount', aggregateId: account.id, eventKey: `billing:recipient-changed:${row.id}`, payloadJson: { schemaVersion: 1, data: { operationId: row.id, ...(noticeAttemptId ? { noticeAttemptId } : {}) } } } });
```
(`recipientSource` = `target.source`; แถวเก่าที่ไม่มี target → `ACCOUNT_EMAIL`). ข้อความ Thai ใน `reason` :73 คงเดิม

`current()` :47-56 — lazy backfill + ค่าในคอลัมน์
```ts
const email = this.customer(customer, account);
if (email && !account.recipientEmail) await this.prisma.client.billingAccount.updateMany({ where: { id: account.id, recipientEmail: null }, data: { recipientEmail: email, recipientSource: 'ACCOUNT_EMAIL' } });
const stored = await this.billing.account(context.companyId);
return { email, hasCustomer: true, operation: …, busy: Boolean(operation),
  stored: { email: stored?.recipientEmail ?? null, source: stored?.recipientSource as BillingRecipientSource | null ?? null, bouncedAt: stored?.recipientBouncedAt?.toISOString() ?? null,
    canChange: !operation && !stored?.activeAttemptId } };
```

### 4.10 Resend (R-D1) — ไฟล์ใหม่ `apps/api/src/modules/billing/application/billing-document-resend.ts`

```ts
const RESEND_LIMIT = 3, RESEND_WINDOW = 86_400;

/** ส่วน Stripe ล้วน — export ให้ PR E (admin resend ใต้ lease/limiter ของตัวเอง `billing-resend-admin:<invoiceId>` 10/วัน) ใช้ร่วม; โยน StripeRequestError ให้ caller map เป็น BILLING_RESEND_UNAVAILABLE (ตัดสิน 2026-09-27) */
export async function resendStripeDocuments(stripe: StripeClient, account: BillingAccount, row: BillingInvoice, recipient: string): Promise<{ invoiceSent: boolean; receiptUpdated: boolean }> {
  const invoice = await originalInvoice(stripe, account, row);                                   // binding เดิม billing-invoice-details.ts:14-23
  const sent = await stripe.request('POST', `/invoices/${row.providerInvoiceId}/send`, {}, `mm:resend:${row.id}:${randomUUID()}`);   // path regex stripe.client.ts:62 ผ่าน
  let receiptUpdated = false;
  if (row.providerChargeId) {
    const charge = await stripe.request('GET', `/charges/${row.providerChargeId}`); assertMappedCharge(charge, account, row);
    if (charge.receipt_email !== recipient) {                                                    // Stripe ส่งใบเสร็จเมื่อค่าเปลี่ยนเท่านั้น (A13)
      const updated = await stripe.request('POST', `/charges/${row.providerChargeId}`, { receipt_email: recipient }, `mm:resend-receipt:${row.id}:${randomUUID()}`);
      receiptUpdated = updated.receipt_email === recipient;
    }
  }
  return { invoiceSent: sent.id === invoice.id, receiptUpdated };
}

export class BillingDocumentResend {
  constructor(private readonly prisma: PrismaService, private readonly stripe: StripeClient, private readonly billing: Pick<BillingService, 'assertOwner' | 'account'>) {}
  async run(context: RequestContext, invoiceId: string, limits: RedisRateLimitService): Promise<BillingDocumentResendResult> {
    await this.billing.assertOwner(context);
    const company = await this.prisma.client.company.findUnique({ where: { id: context.companyId }, select: { status: true, name: true, planTerm: { select: { termDisabledAt: true } } } });
    if (!company || (company.status !== 'ACTIVE' && !(company.status === 'DISABLED' && company.planTerm?.termDisabledAt))) throw new ForbiddenException();   // แบบ ownedInvoice :1024-1031
    const account = await this.billing.account(context.companyId);
    const row = account ? await this.prisma.client.billingInvoice.findFirst({ where: { id: invoiceId, billingAccountId: account.id } }) : null;
    if (!account || !row) throw new NotFoundException();
    if (row.providerStatus !== 'paid' || row.applyStatus !== 'APPLIED') throw billingError('BILLING_RESEND_UNAVAILABLE', 'ส่งซ้ำได้เฉพาะเอกสารที่ชำระและเปิดสิทธิ์แล้ว');
    if (account.activeEmailOperationId) throw billingError('BILLING_EMAIL_UPDATE_PENDING', 'กรุณาตรวจรายการเปลี่ยนผู้รับเอกสารให้เสร็จก่อน');
    const recipient = account.recipientEmail;
    if (!recipient) throw billingError('BILLING_RESEND_UNAVAILABLE', 'ยังไม่มีอีเมลรับเอกสาร กรุณาตั้งอีเมลรับเอกสารก่อน');
    if (account.recipientBouncedAt) throw billingError('BILLING_RECIPIENT_BOUNCED', 'อีเมลรับเอกสารส่งไม่ถึง กรุณาแก้อีเมลรับเอกสารก่อน');   // ตัดสิน 2026-09-27 (spec §11 code; ใช้กับ admin resend ของ PR E ด้วย)
    // limiter: inspect → Stripe → consume (A30): ครั้งที่ล้มเหลวไม่นับ
    const budget = await limits.inspect('billing-resend', row.id, RESEND_LIMIT, RESEND_WINDOW);
    if (!budget.allowed) throw new HttpException({ code: 'BILLING_RESEND_LIMIT', message: 'ส่งเอกสารซ้ำได้สูงสุด 3 ครั้งต่อวันสำหรับใบนี้ กรุณาลองใหม่พรุ่งนี้', retryAfterSeconds: budget.retryAfterSeconds }, 429);
    const lease = randomUUID();                                                                   // แบบ cancelOwn billing-checkout-expiry.service.ts:61-80
    const claimed = await this.prisma.client.billingAccount.updateMany({ where: { id: account.id, OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] }, data: { leaseToken: lease, leaseUntil: new Date(Date.now() + 120_000) } });
    if (!claimed.count) throw billingError('BILLING_PURCHASE_PENDING', 'กำลังตรวจรายการเดิม กรุณาลองใหม่อีกครั้ง');
    let invoiceSent = false, receiptUpdated = false;
    try {
      ({ invoiceSent, receiptUpdated } = await resendStripeDocuments(this.stripe, account, row, recipient));
    } catch (error) {
      if (error instanceof StripeRequestError) throw billingError('BILLING_RESEND_UNAVAILABLE', 'ยังส่งเอกสารซ้ำไม่ได้ กรุณาลองใหม่ภายหลัง');
      throw error;
    } finally { await this.prisma.client.billingAccount.updateMany({ where: { id: account.id, leaseToken: lease }, data: { leaseToken: null, leaseUntil: null } }); }
    const consumed = await limits.consume('billing-resend', row.id, RESEND_LIMIT, RESEND_WINDOW);
    await this.prisma.client.$transaction(async tx => {
      await lockPlanTermCompany(tx, context.companyId);
      // อีเมลของเรา (ลิงก์เข้าแอป) ไปผู้รับปัจจุบัน — เส้นทางเดียวที่พิสูจน์ได้ใน test mode (Stripe /send ไม่ส่งเมลใน test mode: A13)
      await tx.outboxEvent.upsert({ where: { eventKey: `billing:notice-email:${row.id}:resend:${consumed.count}` }, update: {}, create: { companyId: context.companyId, eventType: BILLING_NOTICE_EMAIL,
        aggregateType: 'BillingInvoice', aggregateId: row.id, eventKey: `billing:notice-email:${row.id}:resend:${consumed.count}`, payloadJson: { schemaVersion: 2, data: { recipientUserId: null, resend: true } } } });
      await tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: 'billing.document.resent', targetType: 'BillingInvoice', targetId: row.id,
        requestId: context.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { invoiceSent, receiptUpdated, attempt: consumed.count } } });
    });
    return { invoiceSent, receiptUpdated, recipientEmail: recipient, remainingToday: Math.max(0, RESEND_LIMIT - consumed.count) };
  }
}
```
หมายเหตุ: `BILLING_NOTICE_EMAIL` export จาก `billing-notifications.service.ts:22` (import type-free constant — ไม่มี DI cycle เพราะ resend ไม่ inject service); Stripe `/send` ส่งไปอีเมลของใบ (customer_email แช่แข็งตอน finalize — ไม่รู้แน่ว่าใช้ Customer.email ปัจจุบันหรือไม่, A13) จึงถือเป็น best-effort; receipt_email + อีเมลของเราคือทางที่แน่นอน

### 4.11 `apps/api/src/modules/billing/application/billing-notifications.service.ts` (R-A7)

**4.11.1 produce() :230-255 — อีเมลชำระสำเร็จไปผู้รับเอกสาร**
```ts
const account = await tx.billingAccount.findUniqueOrThrow({ where: { id: invoice.billingAccountId } });   // มี `invoice` จาก source() แล้ว
// :245-247 LINE/web event เดิม (recipientUserIds: owners → PR A เปลี่ยนเป็น planManagersOf)
if (account.recipientEmail) {
  await tx.outboxEvent.upsert({ where: { eventKey: `billing:notice-email:${invoice.id}:recipient` }, update: {}, create: { companyId: company.id, eventType: BILLING_NOTICE_EMAIL,
    aggregateType: 'BillingInvoice', aggregateId: invoice.id, eventKey: `billing:notice-email:${invoice.id}:recipient`, payloadJson: { schemaVersion: 2, data: { recipientUserId: null } } } });
} else for (const owner of owners.filter(m => m.user.email && m.user.emailVerifiedAt)) { …:249-252 เดิม (legacy fan-out จนกว่า backfill/capture จะเติมคอลัมน์) }
```
eventType เดิม `billing.status.email` + intentKey เดิม `billing-notice:<outboxId>` → drain candidates (:176-184), monitor join (`system-email-delivery.service.ts:94-102`), recovery (`prepareReviewedBilling`), resolve (:291-299) ทำงานต่อโดยไม่แก้ query

**4.11.2 sendEmail() :257-289 — ผู้รับจากคอลัมน์เมื่อ `recipientUserId === null`**
```ts
const { company, invoice } = await this.source(row);
const userId = (row.payloadJson as { data?: { recipientUserId?: unknown } }).data?.recipientUserId;
if (userId !== null && typeof userId !== 'string') throw new Error('billing.notification_recipient_missing');
const resolveRecipient = async () => {
  if (typeof userId === 'string') { const owner = (await this.owners(company.id)).find(m => m.userId === userId); return owner?.user.email && owner.user.emailVerifiedAt ? owner.user.email.trim().toLowerCase() : null; }
  return (await this.prisma.client.billingAccount.findUniqueOrThrow({ where: { id: invoice.billingAccountId } })).recipientEmail;
};
const recipient = await resolveRecipient();
if (!recipient) { await this.billing.issue(company.id, 'NOTIFICATION_RECIPIENT_CHANGED', row.id); return; }        // :261-263 เดิม
…:264-273 เดิม โดยแทน `owner.user.email…` ด้วย `recipient` (prepare intentKey เดิม `billing-notice:${row.id}`)
// :280-281 pre-send recheck:  const fresh = await resolveRecipient(); if (fresh !== attempt.recipient) throw new PostmarkSendError('SUPPRESSED', 'recipient_changed');
```
เนื้อหาอีเมล: `renderBillingStatusEmail(company.name, href)` เดิม (:134) — ลิงก์เข้าแอปอยู่แล้ว (`billingHref`); เพิ่มย่อหน้า "เอกสารการชำระเงินเปิดได้จากหน้านี้" ไม่จำเป็น (F27: เปลี่ยนเนื้อหา = binding ของ recovery ค้างเปลี่ยน → **ไม่แก้ template**)

**4.11.3 reviewEmailDelivery() :95-132 — `recipientUserId` null ได้**
```ts
const userId = (outbox.payloadJson as {data?:{recipientUserId?:unknown}}).data?.recipientUserId;
if (userId !== null && typeof userId !== 'string') throw new NotFoundException();
const owner = typeof userId === 'string' ? (await this.owners(companyId, tx)).find(m => m.userId === userId) : undefined;
const recipient = typeof userId === 'string' ? owner?.user.email?.trim().toLowerCase() ?? null : account.recipientEmail;
// :113  else if (typeof userId === 'string' ? (!owner?.user.emailVerifiedAt || !recipient) : !recipient) blockedReason = typeof userId === 'string' ? 'VERIFIED_EMAIL_REQUIRED' : 'RECIPIENT_MISSING';
// :125-127 row.recipient.userId → userId (string | null)
// :130 recipientName: owner?.user.displayName ?? null  (null สำหรับ recipient path → web แสดง 'ผู้รับเอกสารของบริษัท' ใน PR D)
```
`delivery()` :51-61: `recipientUserId: row.recipient.userId` → type `string | null` (contracts §2.1). `BillingDeliveryView.recipientUserId` ใช้ที่ `BillingDeliveryPanel.tsx:32` (แสดง id ในรายละเอียด — null แสดงว่าง; PR D ปรับ copy)

**4.11.4 drain() :170-205 — รับ outbox `billing.recipient.changed` (aggregate BillingAccount)**
```ts
const rows = await this.prisma.client.$queryRaw<OutboxEvent[]>`
  WITH candidates AS (
    SELECT o.id FROM "OutboxEvent" o JOIN "BillingInvoice" i ON o."aggregateType" = 'BillingInvoice' AND o."aggregateId" = i.id
    JOIN "BillingAccount" a ON i."billingAccountId" = a.id AND o."companyId" = a."companyId"
    WHERE a."stripeAccountId" = ${stripeAccountId} AND a.livemode = ${livemode}
      AND o."eventType" IN (${APPLIED}, ${BILLING_NOTICE_EMAIL}) AND o.status IN ('PENDING', 'FAILED') AND o."availableAt" <= now()
    UNION ALL
    SELECT o.id FROM "OutboxEvent" o JOIN "BillingAccount" a ON o."aggregateType" = 'BillingAccount' AND o."aggregateId" = a.id AND o."companyId" = a."companyId"
    WHERE a."stripeAccountId" = ${stripeAccountId} AND a.livemode = ${livemode}
      AND o."eventType" = ${RECIPIENT_CHANGED} AND o.status IN ('PENDING', 'FAILED') AND o."availableAt" <= now()
    ORDER BY 1 LIMIT 10 FOR UPDATE SKIP LOCKED
  ) UPDATE … (เดิม)`;
// loop :188-189:  if (row.eventType === APPLIED) produce; else if (row.eventType === RECIPIENT_CHANGED) recipientChanged(row); else sendEmail(row);
```
(`ORDER BY o."createdAt", o.id` เดิมใช้กับ UNION ไม่ได้ตรง ๆ → เลือกคอลัมน์ `o.id, o."createdAt"` ใน subquery แล้ว `ORDER BY 2, 1`; `FOR UPDATE OF o SKIP LOCKED` ต้องอยู่ในแต่ละ branch หรือครอบด้วย subselect — ให้ผู้ implement รัน spec `billing-notification-smoke.ts` เพื่อพิสูจน์ SQL)

```ts
private async recipientChanged(row: OutboxEvent) {
  const account = await this.prisma.client.billingAccount.findUnique({ where: { id: row.aggregateId } });
  if (!this.billing.stripe.enabled || !account || account.companyId !== row.companyId || account.stripeAccountId !== this.billing.stripe.accountId || account.livemode !== this.billing.stripe.livemode) throw new Error('billing.notification_source_changed');
  const company = await this.prisma.client.company.findUniqueOrThrow({ where: { id: account.companyId } });
  const data = (row.payloadJson as { data?: { operationId?: string; noticeAttemptId?: string } }).data ?? {};
  if (data.noticeAttemptId && this.email.isPostmark) {                                                                   // อีเมลถึงผู้รับเดิม
    const attempt = await this.prisma.client.emailSendAttempt.findFirst({ where: { id: data.noticeAttemptId, intentKey: `billing-recipient-notice:${data.operationId}`, purpose: 'billing_status' } });
    if (attempt && ['READY', 'SENDING'].includes(attempt.status) && !attempt.dispatchStartedAt) {
      try { await this.email.send(attempt, renderBillingRecipientChangedEmail(company.name, this.billingHref(company.id))); }
      catch (error) { if (!(error instanceof PostmarkSendError) || error.kind !== 'SUPPRESSED') throw error; /* ผู้รับเดิมตีกลับอยู่แล้ว: ไม่มีอะไรจะบอก */ }
    }
  }
  const latest = await this.prisma.client.billingInvoice.findFirst({ where: { billingAccountId: account.id, applyStatus: 'APPLIED', appliedAt: { not: null } }, orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }] });
  if (!latest) return;                                                                                                    // ไม่มีใบที่เปิดสิทธิ์ → LINE/web ส่งไม่ได้ (drainDeliveries join invoice) ข้าม
  await this.prisma.client.$transaction(async tx => {
    await lockPlanTermCompany(tx, company.id);
    const owners = await this.planManagers(company.id, tx);   // PR A (pr-a §3.18 ซ): ผู้รับ LINE/เว็บ = ผู้มี company.plan.manage (ลำดับ A→C)
    await this.events.executeInTransaction({ companyId: company.id, triggerKey: 'billing.package_updated', sourceModule: 'billing', sourceType: 'invoice', sourceId: latest.id,
      periodKey: `recipient-changed:${data.operationId}`,   // dedupKey ต่างจาก event "อัปเดตแพ็กเกจ" ของใบเดียวกัน (buildDedupKey รวม periodKey) → เหตุการณ์ใหม่ ส่งได้
      severity: 'info', title: 'เปลี่ยนอีเมลรับเอกสารแล้ว', body: 'อีเมลรับเอกสารการชำระเงินของบริษัทถูกเปลี่ยนแล้ว หากไม่ได้ทำรายการนี้ กรุณาติดต่อทีมงานทันที',
      deepLinkHref: `/companies/${encodeURIComponent(company.id)}/billing`, recipientUserIds: owners.map(m => m.userId) }, tx);
  });
}
```
`renderBillingRecipientChangedEmail(companyName, href)` ใหม่ใน `auth-email.templates.ts` (ข้าง `renderBillingStatusEmail` :46): title `อีเมลรับเอกสารของบริษัทถูกเปลี่ยน`, ย่อหน้า `บริษัท ${companyName} เปลี่ยนอีเมลรับเอกสารการชำระเงินแล้ว อีเมลนี้จะไม่ได้รับเอกสารใบถัดไป`, `หากไม่ได้ทำรายการนี้ กรุณาติดต่อทีมงานทันทีผ่านหน้าบริษัท`, ปุ่ม `เปิดหน้าบริษัท` (ไม่ระบุอีเมลใหม่ — ไม่ leak ให้ mailbox เดิม)

trigger key เดิม `billing.package_updated` (อยู่ใน `IMPLEMENTED_TRIGGER_KEYS` `notification.model.ts:114`; key ใหม่ถูก preference เดิมบล็อก — F12); LINE delivery ถูก drain โดย `drainDeliveries` :308-332 (join invoice ผ่าน `sourceId`) และ `deliver()` :334-419 (ตรวจ `invoiceSource` = APPLIED ✓, owner ✓, preference `billing.package_updated` ✓)

**4.11.5 bounce observer (R-A7) — เมธอดใหม่ เรียกใน `drain()` ก่อน `drainDeliveries()` :203**
```ts
private async observeRecipientBounces() {
  const due = await this.prisma.client.$queryRaw<Array<{ attemptId: string; accountId: string; companyId: string; suppressedAt: Date; kind: string | null }>>`
    SELECT a.id AS "attemptId", b.id AS "accountId", b."companyId", a."suppressedAt", a."errorCode" AS kind
    FROM "EmailSendAttempt" a JOIN "OutboxEvent" o ON a."intentKey" = 'billing-notice:' || o.id AND o."aggregateType" = 'BillingInvoice'
    JOIN "BillingInvoice" i ON i.id = o."aggregateId" JOIN "BillingAccount" b ON b.id = i."billingAccountId" AND b."companyId" = o."companyId"
    WHERE a."suppressedAt" IS NOT NULL AND a."suppressedAt" >= now() - interval '30 days'
      AND b."recipientEmail" = a.recipient AND b."recipientBouncedAt" IS NULL
      AND b."stripeAccountId" = ${this.billing.stripe.accountId} AND b.livemode = ${this.billing.stripe.livemode}
    ORDER BY a."suppressedAt" LIMIT 20`;
  for (const row of due) {
    await this.prisma.client.$transaction(async tx => {
      await lockPlanTermCompany(tx, row.companyId);
      const attempt = await tx.emailSendAttempt.findUniqueOrThrow({ where: { id: row.attemptId } });
      const flagged = await tx.billingAccount.updateMany({ where: { id: row.accountId, recipientEmail: attempt.recipient, recipientBouncedAt: null }, data: { recipientBouncedAt: attempt.suppressedAt! } });
      if (!flagged.count) return;                                                                                      // ผู้รับเปลี่ยนไปแล้วระหว่างนั้น
      await tx.auditLog.create({ data: { companyId: row.companyId, action: 'billing.recipient.bounced', targetType: 'BillingAccount', targetId: row.accountId, requestId: row.attemptId,
        result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { attemptId: row.attemptId, kind: attempt.errorCode ?? 'suppressed' } } });
      const latest = await tx.billingInvoice.findFirst({ where: { billingAccountId: row.accountId, applyStatus: 'APPLIED', appliedAt: { not: null } }, orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }] });
      if (!latest) return;
      const owners = await this.planManagers(row.companyId, tx);   // PR A helper (ดู §4.11.4)
      await this.events.executeInTransaction({ companyId: row.companyId, triggerKey: 'billing.package_updated', sourceModule: 'billing', sourceType: 'invoice', sourceId: latest.id,
        periodKey: `recipient-bounce:${row.accountId}:${attempt.suppressedAt!.toISOString()}`, severity: 'warning', title: 'อีเมลรับเอกสารส่งไม่ถึง',
        body: 'อีเมลรับเอกสารการชำระเงินของบริษัทส่งไม่ถึง กรุณาแก้อีเมลรับเอกสารในหน้าแพ็กเกจ', deepLinkHref: `/companies/${encodeURIComponent(row.companyId)}/billing`, recipientUserIds: owners.map(m => m.userId) }, tx);
      await tx.billingAccount.update({ where: { id: row.accountId }, data: { recipientBounceNotifiedAt: new Date() } });
    });
  }
}
```
- แหล่งความจริงของ bounce = `PostmarkEventsService.apply()` (`postmark-events.service.ts:84-88`: `suppress` = SpamComplaint | Inactive | HardBounce | TypeCode 1 → `status:'SUPPRESSED'`, `suppressedAt`) ซึ่งถูก drain โดย workflow outbox (`workflow-outbox-drain.use-case.ts:91`) — billing **ไม่**เรียก auth (F10 module cycle); soft bounce ไม่ตั้งธง (ตั้งใจ — ข้อความ R-A7 พูดถึง Bounce/SpamComplaint ที่ Postmark จัดเป็น inactive)
- idempotent: predicate `recipientBouncedAt IS NULL` + `recipientEmail = attempt.recipient`; ธงล้างเมื่อ op ผู้รับ COMPLETED (§4.9) แล้ว attempt เก่าของอีเมลเก่าไม่ตรง `recipientEmail` ใหม่จึงไม่ติดซ้ำ; bounce ครั้งใหม่ของอีเมลใหม่มี `suppressedAt` ใหม่ → periodKey ใหม่ → push ใหม่ 1 ครั้ง
- ครอบทั้ง intent เจ้าของ (legacy) และ intent ผู้รับ (`billing-notice:*` ทั้งคู่) และ resend (`billing:notice-email:…:resend:n` → intentKey เดียวกันรูปแบบ `billing-notice:<outboxId>`)

### 4.12 status/history DTO (`billing.service.ts`)

```ts
// status() :883 return เพิ่ม
recipient: { email: account?.recipientEmail ?? null, source: (account?.recipientSource as BillingRecipientSource | null) ?? null, bouncedAt: account?.recipientBouncedAt?.toISOString() ?? null,
  canChange: !!account?.customerId && !account.activeEmailOperationId && !account.activeAttemptId },
// history() :1018 map เพิ่ม
documentActions: { canResend: row.providerStatus === 'paid' && row.applyStatus === 'APPLIED' && !!account.recipientEmail && !account.activeEmailOperationId },
// status() เพิ่ม (DQ5 — ตัดสิน 2026-09-27; helper `checkoutAddressOf` ใน billing-recipient-capture.ts: null เมื่อไม่มี; map Stripe {line1,line2,city,state,postal_code} → CompanyLegalAddress {line1,line2,district:city,province:state,postalCode:postal_code,subdistrict:''})
checkoutAddress: checkoutAddressOf(account?.checkoutAddressJson),
// adjustments (GET invoices/:id/adjustments/:kind — จุดที่สร้าง BillingAdjustments ใน billing.service.ts ถัดจาก history()) เพิ่ม
documentActions: { canResend: /* เงื่อนไขเดียวกับ history */ }, recipientEmail: account.recipientEmail ?? null,
```
`billing-admin.service.ts:197-205` (admin invoice list) ไม่แตะ

### 4.13 Controller + module

`billing.controller.ts`
```ts
// :9 import เพิ่ม BillingRecipientPreviewDto, BillingRecipientOtpRequestDto, BillingRecipientOtpConfirmDto ; import { extractSid } from '../../auth/presentation/auth.controller'; import { BillingRecipientOtpService } from '../application/billing-recipient-otp.service';
// :477 ctor เพิ่ม  private readonly recipientOtp: BillingRecipientOtpService
function otpCaller(req: AuthedRequest) { const tokenId = extractSid(req); if (!tokenId) throw new UnauthorizedException('Session is required.'); return { companyId: req.context.companyId, userId: req.context.userId, tokenId, requestId: req.context.requestId }; }   // แบบ account-email-otp.controller.ts:31-35
@Post('recipient/otp/request') @HttpCode(202) async recipientOtpRequest(@Req() req: AuthedRequest, @Body() body: BillingRecipientOtpRequestDto) {
  const f = bodyFields(body, ['email', 'requestKey']); await this.limit(req);
  return this.recipientOtp.request({ ...otpCaller(req), email: textField(f.email, 320), requestKey: uuid(f.requestKey) }); }
@Post('recipient/otp/confirm') @HttpCode(200) async recipientOtpConfirm(@Req() req: AuthedRequest, @Body() body: BillingRecipientOtpConfirmDto) {
  const f = bodyFields(body, ['challengeId', 'code']); await this.limit(req);
  return this.recipientOtp.confirm({ ...otpCaller(req), challengeId: uuid(f.challengeId), code: textField(f.code, 6) }); }
// :486-487 recipientPreview: @Body() body: BillingRecipientPreviewDto → const f = bodyFields(body, ['recipientProofId']); … this.billing.emailRecipient.preview(req.context, f.recipientProofId === undefined ? undefined : uuid(f.recipientProofId))
@Post('documents/:documentId/resend') @HttpCode(200) @Header('Cache-Control', 'no-store') async resend(@Req() req: AuthedRequest, @Param('documentId') id: string, @Body() body: BillingEmptyDto) {
  bodyFields(body, []); await this.limit(req); return this.billing.documentResend.run(req.context, textField(id, 128), this.limits); }
// quote :537-538  billingEmail: textField(fields.billingEmail, 320)  →  ...(typeof fields.billingEmail === 'string' && fields.billingEmail !== '' ? { billingEmail: textField(fields.billingEmail, 320) } : {})   // RV05: เว็บเก่าส่ง '' ได้
```
`billing.module.ts:29` providers เพิ่ม `BillingRecipientOtpService` (AuthModule import อยู่แล้ว :27 → `EmailDeliveryService` inject ได้; `test:boot` พิสูจน์ DI)

### 4.14 `apps/api/src/modules/auth/presentation/auth.guard.ts:98-104` (pinned) + pins

```ts
: method === 'POST' && new RegExp(`^${prefix}/(?:quote|checkout|portal|refresh|recipient/preview|recipient/otp/(?:request|confirm)|recipient/[^/]+/(?:submit|cancel)|collection/preview|collection/[^/]+/(?:submit|withdraw|capacity)|attempts/[^/]+/(?:resume|cancel|capacity)|documents/[^/]+/(?:open|resend))$`).test(clean);
```
(`recipient/otp/request` ไม่ชนกับ `recipient/[^/]+/(submit|cancel)`; comment `:65-66` "Account email proof is a prerequisite for payment" ล้าสมัย → แก้เป็น "Account email OTP stays reachable for the optional backup login (R-A6); payment no longer requires it") → หลังแก้: `node infra/security/sync-production-maintenance-release-pins.mjs` (rewrite `validate-production-maintenance-release.sh:25` + `deploy-production.yml:421`) → `--check` → รัน `.spec.sh` สองไฟล์ → commit ใน PR เดียวกัน + twin main (P0). `auth.guard.spec.ts:710` เพิ่ม `'recipient/otp/request', 'recipient/otp/confirm', 'documents/d/resend'` ในรายการอนุญาต และเพิ่ม negative `'recipient/otp/other'`, `'documents/d/resend/x'`

### 4.15 web error map + monitor join + template

- `apps/web/src/common/api/api-error-message.ts` เพิ่ม 6 รายการ §2.4 ถัดจาก `:20` (`BILLING_EMAIL_UPDATE_PENDING`)
- `apps/api/src/modules/auth/application/system-email-delivery.service.ts:101` ลบเงื่อนไข `AND jsonb_typeof(o."payloadJson"->'data'->'recipientUserId') = 'string'` (join ด้วย intentKey+eventType+account พอ; แถว recipient มี `recipientUserId: null`)
- `auth-email.templates.ts` เพิ่ม `renderBillingRecipientChangedEmail` (§4.11.4); **ไม่แก้** `renderBillingStatusEmail` (F27)

---

## 5. Sequences / state machines (ข้อความ)

### 5.1 Checkout เมื่อไม่มีอีเมล/ที่อยู่ (INITIAL, ร้าน LINE-first)

```
web → POST quote {offerKey, interval}                       (billingEmail ไม่ส่ง)
  quote(): accountEmailState → requirement MISSING → verifiedAccountEmail=null; account=null → recipientEmail=null
           companyBillingProfile → missingFields [line1,…]; snapshot { quote.billingEmail:null, billingProfile{missing…} } (ไม่มี emailProof)
  ← 200 { billingEmail:null, billingProfile.missingFields:[…], purchase.kind:'INITIAL' }
web → POST checkout {quoteId, consent…}
  tx1: assertOwner; quote/settings/gates; assertBillingProfileUnchanged (drift → QUOTE_STALE); recipient drift: account null → ผ่าน; create account+attempt
  Stripe POST /customers { name:'ชื่อร้าน', metadata } (ไม่มี email/address) key mm:<account>:customer
  GET /customers/cus → binding ok; stripeCustomerSynced → name ตรง, ไม่มี email/address ให้เทียบ → ผ่าน (ไม่มี profile POST)
  tx2 (stop barrier): gates/policy/company/profile-drift/recipient-drift; attempt CREATING→REQUESTING
  Stripe POST /checkout/sessions { customer, billing_address_collection:'required', customer_update:{address:'auto'}, success_url, cancel_url=…&checkout=canceled, … } key mm:<attempt>:checkout
  ← 200 { checkoutUrl }
Stripe Checkout: ถามอีเมล (Customer ไม่มี) + ที่อยู่ + บัตร/QR → เขียน email+address ลง Customer (Stripe docs) → redirect success_url
webhook checkout.session.completed / invoice.paid → BillingProviderEvent → drain → reconcileAccount (lease)
  one-time: reconcileOneTime → GET session (customer_details{email,address}) → evidence → readRecipientCapture(session) [ไม่มี provider call เพิ่ม]
    tx: upsert invoice → recordBillingFinancials → recordRecipientCapture: checkoutAddressJson=addr; recipientEmail set-if-null (source STRIPE_CHECKOUT) + audit billing.recipient.captured → apply… → outbox billing:applied
  subscription: reconcileAccount → GET session → capture → verifyAndApplyInvoice(capture) → applyInvoice: upsert → financials → recordRecipientCapture (INITIAL เท่านั้น) → apply…
notifications drain: produce(applied) → NotificationEvent(billing.package_updated → web+LINE ถึง owners/plan managers) + outbox billing:notice-email:<inv>:recipient {recipientUserId:null}
  → sendEmail: recipient = account.recipientEmail → EmailSendAttempt billing-notice:<outbox> → Postmark (UAT: อีเมลต้องอยู่ใน POSTMARK_UAT_ALLOWED_RECIPIENTS)
web return page: GET billing → recipient{email, source:'STRIPE_CHECKOUT', canChange:true เมื่อ attempt จบ}  (PR D แสดง "ส่งเอกสารไปที่ …")
cancel: Stripe → cancel_url?attempt=…&checkout=canceled → PR D แสดง "ยังไม่ได้ชำระ" + ปุ่มยุติรายการ (attempts/:id/cancel เดิม)
```
กรณีมี verified account email แต่ไม่มีที่อยู่: quote.billingEmail = อีเมลนั้น → Customer สร้างพร้อม email → Checkout ล็อกอีเมล (AC1 ถือเฉพาะผู้ซื้อที่ไม่มี verified email — §18.2) → capture: `session.customer_details.email` = อีเมลเดียวกัน → source `ACCOUNT_EMAIL`
กรณีโปรไฟล์ครบ: payload มี address → Customer มี address → `customer_update.address:'never'` → Checkout ยังถามที่อยู่ (required) แต่ไม่ทับ Customer; `checkoutAddressJson` เก็บสิ่งที่ผู้ใช้กรอก

### 5.2 Capture — ตารางสถานะ `recipientEmail`

```
null ──capture(session/customer email)──▶ email@A (source STRIPE_CHECKOUT | ACCOUNT_EMAIL)
null ──backfill/lazy(Customer.email)────▶ email@A (ACCOUNT_EMAIL)
email@A ──capture ซ้ำ/replay───────────▶ email@A (no-op: set-if-null)
email@A ──op UPDATE_BILLING_EMAIL COMPLETED─▶ email@B (CUSTOMER_OTP | ACCOUNT_EMAIL) ; bouncedAt/notifiedAt=null
email@A ──admin op (PR E)───────────────▶ email@C (ADMIN)
```
`checkoutAddressJson`: เขียนทุก capture ที่มี address (ค่าล่าสุด), ไม่ลบ

### 5.3 Recipient OTP + op (R-A8/R-D2)

```
[UI PR D] กรอกอีเมลใหม่ → POST recipient/otp/request {email, requestKey}
  assertOwner; normalize; account.customerId ต้องมี; ≠ recipientEmail ปัจจุบัน
  tx: advisory lock company; session active (tokenId); replay by requestKey; assertReady (postmark/HMAC/UAT allowlist); limiter (1/นาที, 5/ชม./ผู้ใช้, 10/วัน/ผู้ใช้, 5/ชม./ผู้รับ รวม account OTP)
      prepare EmailSendAttempt (email_verification, intent billing-recipient-otp:<id>); revoke PENDING เดิมของ (user,company); create token proofKind BILLING_RECIPIENT companyId=…; audit
  send OTP (Postmark) ; ← 202 { challengeId, email, expiresAt(+10 นาที), retryAt(+60 วิ), attemptsRemaining 5, deliveryStatus }
กรอกรหัส → POST recipient/otp/confirm {challengeId, code}
  tx: token ของ (id,user,company,kind); session เดิม; PENDING/expiry/keyVersion; wrong-code quota 20/ชม.; HMAC match → USED usedAt; audit
  ← 200 { recipientProofId, email, expiresAt(+30 นาที) }
POST recipient/preview {recipientProofId}
  assertRecipientProof (USED, บริษัท/ผู้ใช้ตรง, ยังไม่มี op อ้าง, ≤30 นาที) → target {email, CUSTOMER_OTP, challengeId}; ≠ recipient ปัจจุบัน; GET Customer → previousEmail
  create BillingOperation UPDATE_BILLING_EMAIL state PREVIEW (10 นาที) ← view { newEmail, source:'CUSTOMER_OTP', canSubmit }
POST recipient/:id/submit {expectedVersion, previewHash, accepted:true}
  tx: proof ยังใช้ได้ (opId=row.id) ; account slot ว่าง (ไม่มี attempt/collection/email op) → QUEUED; activeEmailOperationId=row.id; nextReconcileAt=now
worker (billing-events drain 10 วิ) → reconcileAccount → emailRecipient.advance(lease)
  GET Customer (email==previousEmail มิฉะนั้น review) → tx: fence; assertOwner(initiator); company; proof (CUSTOMER_OTP) ; RUNNING+journal.startedAt
  POST /customers/:id {email:new} key mm:email-recipient:<row.id> → GET readback == new → finish():
     op COMPLETED; account.activeEmailOperationId=null; recipientEmail=new, source, bounce flags null; audit billing.recipient.changed
     EmailSendAttempt billing-recipient-notice:<row.id> (to previousEmail, READY) + outbox billing:recipient-changed:<row.id> {operationId, noticeAttemptId}
notifications drain → recipientChanged(): email ถึงผู้รับเดิม (renderBillingRecipientChangedEmail) ; NotificationEvent periodKey recipient-changed:<op> → web + LINE (plan managers)
[UI] หลัง COMPLETED เสนอ "ส่งเอกสารล่าสุดไปอีเมลใหม่" → §5.5
```
สถานะ op: `PREVIEW → QUEUED → RUNNING → COMPLETED` | `PREVIEW/QUEUED/BLOCKED → CANCELLED` | `RUNNING → RECONCILING (provider unknown) → COMPLETED/BLOCKED` | `RUNNING → FAILED (provider REJECTED)` — เหมือนเดิม (`billing-email-recipient.ts:152-167`); ต่างเพียงเงื่อนไข authority ตาม `target.source`
Token: `PENDING → USED (confirm)` | `PENDING → EXPIRED (10 นาที)` | `PENDING → REVOKED (request ใหม่ / ผิด 5 ครั้ง)`; proof `USED` ใช้เปิด preview ได้ใน 30 นาทีและถูกอ้างโดย op เดียว

### 5.4 Bounce

```
Postmark webhook (Bounce/SpamComplaint, stream เดียว) → PostmarkEventsService.receive → OutboxEvent email.postmark.event.received
workflow outbox drain → apply(): attempt (by Metadata.sendAttemptId | messageId) → suppress=true → EmailSuppression upsert + attempt SUPPRESSED suppressedAt
billing notifications drain (ทุก 10 วิ) → observeRecipientBounces(): attempt intent billing-notice:* ที่ recipient == account.recipientEmail และ bouncedAt IS NULL
  tx: recipientBouncedAt=suppressedAt; audit billing.recipient.bounced; NotificationEvent (periodKey recipient-bounce:<acct>:<ts>) → web+LINE; recipientBounceNotifiedAt=now
GET billing → recipient.bouncedAt ≠ null → [PR D] แบนเนอร์ "อีเมลรับเอกสารส่งไม่ถึง แก้ไขได้ที่นี่" → §5.3 → COMPLETED → ธงล้าง
```

### 5.5 Resend (R-D1)

```
[UI PR D] หน้าเอกสาร /billing/invoices/:id ปุ่ม "ส่งเอกสารไปอีเมลอีกครั้ง" → POST documents/:id/resend {}
  assertOwner; company ไม่ hold; invoice paid+APPLIED; ไม่มี op ผู้รับค้าง; recipientEmail มี
  limits.inspect billing-resend:<invoiceId> 3/86400 → เต็ม → 429 BILLING_RESEND_LIMIT {retryAfterSeconds}
  lease account (120 วิ) → originalInvoice binding → POST /invoices/:id/send → [charge: GET; receipt_email ≠ recipient → POST /charges/:id {receipt_email}] → release lease
  Stripe error → 409 BILLING_RESEND_UNAVAILABLE (ไม่ consume)
  limits.consume → tx: outbox billing:notice-email:<inv>:resend:<n> {recipientUserId:null, resend:true} + audit billing.document.resent {invoiceSent, receiptUpdated, attempt}
  ← 200 { invoiceSent, receiptUpdated, recipientEmail, remainingToday }
notifications drain → sendEmail (ผู้รับจากคอลัมน์) → Postmark
```

---

## 6. Tests

### 6.1 Spec/smoke ที่จะแดง — แก้อย่างไร (บรรทัดบน ddcdcadf)

| ไฟล์:บรรทัด | สิ่งที่ยืนยันอยู่ | แก้เป็น |
|---|---|---|
| `apps/api/src/scripts/billing-http-smoke.ts:269-273` | `addressJson:{}` → quote 409 `BILLING_COMPANY_PROFILE_REQUIRED` + `missingFields` 5 ช่อง; `provider.customers.length===0` | quote **200**; `body.billingProfile.missingFields` deep-equal `['line1','subdistrict','district','province','postalCode']`; `body.billingEmail === 'owner verified email'` (fixture มี verified owner) ; ยัง `customers.length===0` (quote ไม่สร้าง Customer) |
| `:274-276` fallbackQuote | 200 + `billingProfile.name==='Synthetic billing company'` | คงเดิม |
| `:277-279` stale after registeredName change | `BILLING_QUOTE_STALE` | คงเดิม (drift ยัง stale) |
| `:280-281` postalCode '1011a' → checkout `BILLING_COMPANY_PROFILE_REQUIRED` | | เปลี่ยน expectation เป็น `BILLING_QUOTE_STALE` (โปรไฟล์ต่างจาก snapshot) ; เพิ่ม case ใหม่: quote ใหม่ขณะ postalCode ผิด → checkout **200** (สร้าง Customer โดยไม่มี address; assert `provider.customers[0].address === undefined`; session form มี `customer_update[address]=auto`) แล้ว expire/cleanup attempt ก่อนไป case ถัดไป (ใช้ `attempts/:id/cancel` + fake session status expired) |
| `:282` `billingAttempt.count===0` | | ปรับตาม case ใหม่ (นับหลัง cleanup) |
| `:295` ชื่อ case | | `'company-profile-optional-before-quote-or-checkout-registered-name-priority-fallback-stale-quote-expired-owner-repair'` |
| `:305,306` quote hidden tiers ด้วย `billingEmail:'owner@example.test'` | 409/400 | คงได้ (billingEmail optional ยังรับ) |
| `:310-346` browser (BILLING_BROWSER_E2E): dialog `'กรอกข้อมูลบริษัทก่อนซื้อแพ็กเกจ'` `:326`, ลิงก์ `'กรอกข้อมูลบริษัท'`, screenshots | UI เก่า | **PR D เป็นเจ้าของ** (ต้องเขียนใหม่ตาม copy ใหม่ R-A9/R-A11: กล่องข้อมูล "เอกสารจะออกในชื่อ … · ที่อยู่กรอกได้ที่หน้าชำระเงิน"); PR C **ไม่แตะ** บล็อกนี้และไม่เพิ่ม env เพื่อข้าม (D-PF-8) → บันทึกใน PR body + memory ว่า Extended Tests customer suite จะแดงจนกว่า PR D merge; หลักฐานของ PR C = backend suite (§6.2) + unit + boot |
| `:372-388` checkout → `provider.customers[0].name/address` | name + address ครบ | คงเดิม (โปรไฟล์ครบใน case นี้ `:275`); เพิ่ม assert `form.get('customer_update[address]')==='never'` และ `cancel_url` ลงท้าย `&checkout=canceled` ใน fake handler `:116-130` |
| `:399` completion `Object.assign(session,{status:'complete', subscription})` | ไม่มี customer_details | เพิ่ม `customer_details: { email: <owner verified email>, address: { country:'TH', line1:…, city:…, state:…, postal_code:… } }` และ **fake ต้องตั้ง `provider.customers[0].email` เมื่อยังว่าง** (พฤติกรรม Stripe) → หลัง reconcile assert `billingAccount.recipientEmail === owner email`, `recipientSource==='ACCOUNT_EMAIL'`, `checkoutAddressJson.postal_code==='10110'` |
| `apps/api/src/scripts/email-verification-smoke.ts:77-78` | quote (ยังไม่ verified) → `BILLING_EMAIL_VERIFICATION_REQUIRED` | quote **200** และ `body.billingEmail === null`; ชื่อ case `'unverified-billing-gate'` (:151) → `'unverified-account-email-quote-open'` |
| `:134-150` recipient preview/submit/reconcile (สาย ACCOUNT_EMAIL) | `preview {}` → newEmail = verified; `{email:'injected'}` → 400 | คงเดิม ทั้งหมด (DTO ใหม่รับเฉพาะ `recipientProofId` → `{email}` ยัง 400); เพิ่มหลัง `:143`: assert `billingAccount.recipientEmail === command.newEmail`, `recipientSource==='ACCOUNT_EMAIL'`, outbox `billing:recipient-changed:<op>` ถูกสร้าง; เพิ่ม case OTP ใหม่ (§6.2 ข้อ 3) ต่อท้ายก่อน cleanup `:158-160` (ลบ `emailVerificationToken` proofKind BILLING_RECIPIENT ของ user ด้วย) |
| `apps/api/src/scripts/billing-free-days-smoke.ts:117-118` | `repeat.body.billingEmail === ownerEmail` | คงได้ — ค่ามาจาก `recipientEmail` ที่ capture/lazy ตั้งไว้ (= ownerEmail); ถ้า fixture ไม่ผ่าน apply ให้ตั้ง `recipientEmail` ใน fixture account ตรง ๆ (`:` ที่สร้าง billingAccount) |
| `apps/api/src/scripts/billing-portal-smoke.ts:70-77` | เปลี่ยน `emailRevision` ระหว่าง POST portal → `BILLING_EMAIL_CHANGED` | DQ2: portal ไม่ผูกอีเมล → ลบ case; แทนด้วย "portal ระหว่างมี op ผู้รับค้าง → `BILLING_PORTAL_UNAVAILABLE`" (ตั้ง `activeEmailOperationId` ชั่วคราวใน `during`); ชื่อ case `'portal-independent-of-account-email-but-blocked-by-pending-recipient-operation'` |
| `apps/api/src/scripts/billing-notification-smoke.ts:61-64` | `mail[0].To === `${userId}@example.test`` (owner verified) | คงได้ก็ต่อเมื่อ `billingAccount.recipientEmail` ของ fixture = owner email (มาจาก capture ใน http-smoke ก่อนหน้า) — เพิ่ม assert `recipientEmail` ก่อน; outbox key ตอนนี้คือ `billing:notice-email:<inv>:recipient` (แก้ `queueEmail` `:65-66` payload → `{data:{recipientUserId:null}}`) |
| `:112-115` เจ้าของ `emailVerifiedAt=null` → ไม่ส่ง | | R-A7: ไม่ขึ้นกับ verified อีก → เปลี่ยนเป็น (ก) `recipientEmail=null` ชั่วคราว → queueEmail → drain → ไม่ส่ง + issue `NOTIFICATION_RECIPIENT_CHANGED`; (ข) ตั้ง `EmailSuppression` สำหรับ recipient → attempt SUPPRESSED → drain → `recipientBouncedAt` ตั้ง + NotificationEvent ใหม่ (periodKey recipient-bounce) + `recipientBounceNotifiedAt` ; รันซ้ำ → ไม่มี event เพิ่ม; ชื่อ case `'billing-recipient-column-drives-mail-and-bounce-flags-once'` |
| `apps/api/src/scripts/billing-mail-recovery-smoke.ts:14-21,116` | outbox payload `{data:{recipientUserId:user.id}}` + verified user | legacy path ยังรองรับ → คงเดิม; เพิ่มแถว recipient-path 1 แถว (`recipientUserId:null`, account.recipientEmail = user email) และ assert `reviewDelivery` คืน `recipientName===null`, `recipientUserId===null`, retry preview ทำงาน (`prepareReviewedBilling` recipient จากคอลัมน์) |
| `apps/api/src/modules/billing/application/billing-company-profile.spec.ts:10-17` | `requireBillingProfile` โยน; `assertBillingProfileUnchanged` | เขียนใหม่: (1) `assertBillingProfileUnchanged` โปรไฟล์ไม่ครบ+snapshot เดิม → **ไม่โยน**; เปลี่ยน → `BILLING_QUOTE_STALE`; `{}` → STALE; jsonb reorder ผ่าน (:12-14 คง); (2) `stripeCustomerSyncPayload`: ครบ → `{name,address{…},email?}`; ไม่ครบ → ไม่มี `address`; `billingEmail:null` → ไม่มี `email`; `name` fallback `companyName`; (3) `stripeCustomerSynced`: Customer ที่มี address จาก Checkout + โปรไฟล์ไม่ครบ → true; email ต่างเมื่อ payload มี email → false; ชื่อไฟล์**คงเดิม** (ตั้งชื่อใน `ci.yml:543`) |
| `packages/contracts/src/billing-company-profile.spec.ts` | `companyBillingProfile` | **ไม่แก้** (contracts logic ไม่เปลี่ยน) |
| `apps/api/src/modules/billing/application/billing-profile-recovery.spec.ts:7-32` | `requireBillingProfile` + `stripeBillingProfile(profile)` + calls deep-equal `['POST','/customers/cus_test', stripeBillingProfile(profile), 'mm:attempt:billing-profile']` | `profile = companyBillingProfile({…})`; `attempt.quoteSnapshot.quote` เพิ่ม `billingEmail:null, companyName:'ร้านทดสอบ'`; expectation → `stripeCustomerSyncPayload({quote})`; เพิ่ม case โปรไฟล์ไม่ครบ → payload ไม่มี address และ `stripeCustomerSynced` ผ่านแม้ Customer มี address; ชื่อไฟล์คงเดิม (`ci.yml:543`) |
| `apps/api/src/modules/billing/application/billing-email-recipient.postgres.spec.ts:23-33` | fixture ผู้ใช้ verified; `preview(context)` ไม่มี proof; stripe stub `Object.keys(body)===['email']`; `billing` stub `{prisma, stripe, config:{stripeAccountId}}` | คงสาย ACCOUNT_EMAIL; `new BillingEmailRecipient(prisma, stripe, billing, { postmarkServerId: undefined, postmarkMessageStream: 'outbound' })` (notice ข้าม); เพิ่ม assert หลัง advance: `recipientEmail===a.email`, `recipientSource==='ACCOUNT_EMAIL'`, outbox `billing:recipient-changed:<op>`; เพิ่ม test สาย CUSTOMER_OTP (§6.3 ข้อ 2) |
| typecheck-only: `billing-grace.pg.spec.ts:47` (`src/modules/billing/`), `domain/billing-package.spec.ts:59`, `billing-purchase-source.pg.spec.ts:91,215`, `billing-advance-deal.pg.spec.ts:127` | ส่ง/สร้าง `billingEmail: string` | **ไม่ต้องแก้** (`billingEmail?: string` ใน body และ `string|null` ใน quote type รับ string ได้); รัน typecheck ยืนยัน |
| seeding smokes `billing-upgrade-smoke.ts:58`, `billing-restart-smoke.ts:45`, `billing-plan-change-smoke.ts:60` (`provider.customers.push({email: snapshot.quote.billingEmail})`) และ quote bodies `:77,80,92,181` | | คงได้; เพิ่ม `recipientEmail: snapshot.quote.billingEmail, recipientSource:'ACCOUNT_EMAIL'` ตอน `billingAccount.create` ใน fixture ทั้งสาม (repeat/upgrade drift check ใช้ DB) |
| `billing-collection.spec.ts` (catalog `:375`) | อาจอ้าง `emailProof` ใน Proposed | grep แล้วลบ field ถ้ามี |
| `apps/api/src/modules/auth/auth.guard.spec.ts:664-715` | allowlist | เพิ่มตาม §4.14 |
| `apps/api/src/modules/auth/application/account-email-otp.postgres.spec.ts` | limiter/pattern เดิม | ต้องยังผ่านหลัง refactor §4.3 (รันใน extended backend step `:266`) |
| e2e `customer-billing-ux.spec.ts:63-89,137-143`, `billing-advance-deal.spec.ts:25,55,74,87,121`, `plan-term-billing-readiness.spec.ts:631,643-648`, web `billing-profile-navigation.spec.ts` | UI/mocks | PR D (API shape ยัง compatible: quote body มี billingEmail ได้; status literal เพิ่ม optional) |

### 6.2 Smoke ใหม่ `checkBillingNoSetup()` — ไฟล์ `apps/api/src/scripts/billing-no-setup-smoke.ts` เรียกจาก `billing-http-smoke.ts` selector `BILLING_NO_SETUP_ONLY=1` (pattern `:207-258`; signature เหมือน `checkBillingPortal` `billing-portal-smoke.ts:5`: `{ request, prisma, app, companyId, userIds, membershipId, stripeAccountId, browser?, transport, drain, reconcile }`)

1. ร้านใหม่: user ไม่มี email (`email:null`), company `addressJson:{}`, `registeredName:null`; `POST quote` 200 `billingEmail:null`; `POST checkout` 200 → fake `POST /customers` ไม่มี `email`/`address[…]` ใน form; session form `customer_update[address]=auto`, `cancel_url` ลงท้าย `&checkout=canceled`; `attempts/:id` PENDING
2. simulate paid (one-time `CARD_ONCE`): session complete + `customer_details {email:'typed-…@example.test', address}`; fake ตั้ง `customer.email` เมื่อว่าง; invoice/intent/charge เหมือน `:399-413`; webhook `checkout.session.completed` → drain → `recipientEmail` = typed, `recipientSource='STRIPE_CHECKOUT'`, `checkoutAddressJson` = address; reconcile ซ้ำ 2 ครั้ง → `GET /customers` ไม่ถูกเรียกเพิ่ม (นับผ่าน `providerReadHook`), audit `billing.recipient.captured` 1 แถว; `GET billing` → `recipient {email, source, bouncedAt:null, canChange:true}`, history item `documentActions.canResend===true`
3. notifications drain → outbox `billing:notice-email:<inv>:recipient` PUBLISHED; Postmark fixture `To === typed`; owner ไม่มี email ก็ส่งได้ (R-A7)
4. OTP ผู้รับใหม่: `POST recipient/otp/request {email:'new-…@example.test', requestKey}` 202 (Postmark fixture รับ Tag `email_verification`, อ่าน code จาก TextBody); request ซ้ำ requestKey เดิม → challenge เดิม ไม่ส่งซ้ำ; ผิด code → `EMAIL_OTP_INVALID`; ถูก → 200 `recipientProofId`; `recipient/preview {recipientProofId}` 200 `source:'CUSTOMER_OTP'`; `{recipientProofId}` เดิมซ้ำ → `BILLING_RECIPIENT_PROOF_INVALID`; submit → reconcile → fake `POST /customers/:id {email:new}` 1 ครั้ง; `recipientEmail===new`, `source==='CUSTOMER_OTP'`; outbox `billing:recipient-changed:<op>` → drain → Postmark To = typed (ผู้รับเดิม) เนื้อหาไม่มีอีเมลใหม่; NotificationEvent ใหม่ (title 'เปลี่ยนอีเมลรับเอกสารแล้ว')
5. resend: `POST documents/:id/resend {}` ×3 → 200 (`invoiceSent`, `receiptUpdated` true ครั้งแรก, false ครั้งถัดไปเพราะ fake charge `receipt_email` ตรงแล้ว), fake นับ `POST /invoices/:id/send`===3; ครั้งที่ 4 → 429 `BILLING_RESEND_LIMIT`; fake ให้ `/send` ตอบ 500 → 409 `BILLING_RESEND_UNAVAILABLE` และ counter ไม่เพิ่ม (ตรวจด้วย `limits.inspect`); audit `billing.document.resent` 3 แถว; outbox resend PUBLISHED ×3
6. bounce: ตั้ง `EmailSuppression` + attempt SUPPRESSED ของ intent ล่าสุด → drain → `recipientBouncedAt`, `recipientBounceNotifiedAt`, event 'อีเมลรับเอกสารส่งไม่ถึง' 1 ครั้ง; ทำ OTP change อีกรอบ → ธงล้าง
7. quote/checkout กับ recipient drift: quote (snapshot billingEmail=new) → เปลี่ยน `recipientEmail` ใน DB → checkout → `BILLING_QUOTE_STALE`
8. ผลลัพธ์ JSON `{layer:'real-Nest-HTTP-PostgreSQL-provider-simulation', simulatedProviders:['Stripe','Postmark'], realProviderPayment:false}`; step ใน `.github/workflows/extended-tests.yml` backend suite หลัง `:290`: `BILLING_NO_SETUP_ONLY=1 node apps/api/dist/apps/api/src/scripts/billing-http-smoke.js`

### 6.3 Spec ใหม่ + การลงทะเบียน (`spec-suite-coverage.spec.ts:43-75` บังคับ; ห้ามแตะ `package.json`)

| Spec | ทดสอบ | ลงทะเบียน |
|---|---|---|
| `apps/api/src/modules/billing/domain/billing-recipient-otp.logic.spec.ts` | digest deterministic; เปลี่ยน companyId/sessionId/email/expiresAt → ไม่ match; code ไม่ใช่ 6 หลัก → false; key ผิด → throw | เพิ่มชื่อใน `scripts/line-ai-whole-chain-acceptance.catalog.mjs` api-behavior args (ข้าง `:439 stripe.client.spec.ts`) |
| `apps/api/src/modules/billing/billing-recipient-capture.pg.spec.ts` (suffix `.pg.spec.ts` — coverage ยกเว้น) | ใช้ PG จริง (`BILLING_RECIPIENT_TEST_DATABASE_URL` guard แบบ `billing-email-recipient.postgres.spec.ts:11-17`): (1) `recordRecipientCapture` set-if-null + address latest + audit ครั้งเดียว; (2) replay ไม่เขียน; (3) `readRecipientCapture` ข้าม provider เมื่อมีผู้รับ; (4) คอลัมน์ทั้ง 5 + `EmailVerificationToken.companyId` เขียน/อ่านได้ (พิสูจน์ migration=schema); (5) reconciler `reconcileOneTime` กับ stripe stub session `customer_details` → capture (สร้าง `BillingReconcilerService` แบบ `billing-profile-recovery.spec.ts:24`) | `ci.yml` job "Migrations and Boot" หลัง `:778`: `BILLING_RECIPIENT_TEST_DATABASE_URL="$DATABASE_URL" pnpm --filter @watchdog-bms/api exec tsx --test src/modules/billing/billing-recipient-capture.pg.spec.ts` **และ** `extended-tests.yml` backend step `:289` (DB `watchdog_postmark_ci`) — ci.yml เปลี่ยน → parity main ก่อน UAT all (P0) |
| `billing-email-recipient.postgres.spec.ts` (เพิ่ม test) | สาย CUSTOMER_OTP: token USED ของบริษัท/ผู้ใช้ → preview/submit/advance; token ของบริษัทอื่น/ผู้ใช้อื่น/ยัง PENDING/หมด 30 นาที → `BILLING_RECIPIENT_PROOF_INVALID`; proof ถูก op ที่ยังไม่จบอ้าง → INVALID; op แถวเก่า (`proposedJson.emailProof` ไม่มี target) → advance ได้ | มีใน `extended-tests.yml:266` แล้ว |
| `apps/api/src/modules/billing/application/billing-recipient-otp.service.spec.ts` (unit, mock prisma) | request: ไม่มี customerId → `BILLING_RECIPIENT_UNAVAILABLE`; email เดิม → `UNCHANGED`; limiter คืน >0 → 429; confirm: state machine ทุกแขนง (ไม่พบ/session ต่าง/EXPIRED/ผิด 5 ครั้ง/ถูก/idempotent) | catalog api-behavior |
| `apps/api/src/modules/billing/application/billing-document-resend.spec.ts` (unit, stub stripe/limits) | inspect→Stripe→consume; 429 ไม่เรียก Stripe; Stripe REJECTED/UNKNOWN → 409 + consume ไม่ถูกเรียก; `receipt_email` เท่ากัน → ไม่ POST charge; ไม่มี recipient → 409; lease ไม่ว่าง → `BILLING_PURCHASE_PENDING`; lease ปล่อยเสมอ | catalog api-behavior |
| `apps/api/src/modules/billing/application/billing-notifications-recipient.spec.ts` (unit) | `sendEmail` recipient จากคอลัมน์; `recipientUserId` ไม่ใช่ string/null → throw; recheck recipient เปลี่ยน → SUPPRESSED `recipient_changed`; `observeRecipientBounces` idempotent | catalog api-behavior |
| `apps/web/src/common/api/api-error-coverage.spec.ts` | มีอยู่ — จะบังคับ Thai ของ code ใหม่เอง (ค้น `code:'X'` ใน `modules/billing`) | ไม่ต้องลงทะเบียน (web glob) |
| `apps/api/src/modules/auth/auth.guard.spec.ts` | allowlist ใหม่ | อยู่ใน `package.json test` แล้ว |

fake Stripe ต้องรองรับใน smoke: `POST /invoices/:id/send` (คืน invoice), `POST /charges/:id` (อัปเดต `receipt_email`), `customer_details` บน session, ตั้ง `customer.email` เมื่อ complete และ Customer ไม่มี email, นับ `GET /customers/:id`

---

## 7. Docs to amend (บรรทัดบน ddcdcadf; แก้ใน PR เดียวกัน)

| ไฟล์:บรรทัด | ปัจจุบัน | แก้เป็น |
|---|---|---|
| `docs/specs/billing-company-profile-gate-spec-th.md:1-3` | หัวข้อ + Owner decision 2026-09-17 | เพิ่มบรรทัดสถานะใต้หัวข้อ: `**Superseded สำหรับการซื้อ (2026-09-26 D-PF-1, spec purchase-without-setup §18.2 R-A1/R-A2/R-A3): ที่อยู่/อีเมลไม่ใช่เงื่อนไขก่อน quote/checkout อีก; ข้อ 5–13 ด้านล่างคงไว้เป็นประวัติ ยกเว้นที่ระบุ**` |
| `:5` "ก่อนเริ่มซื้อใหม่ … ต้องมีที่อยู่ …" | บังคับ | ขึ้นต้น `~~` (strike) + `→ ยกเลิก: ที่อยู่กรอกได้ที่ Stripe Checkout (customer_update.address=auto) และเก็บเป็น BillingAccount.checkoutAddressJson` |
| `:6` "ใช้ verified account email ตามกติกาเดิม" | | `→ ยกเลิก: ผู้รับเอกสาร = BillingAccount.recipientEmail (capture จาก Checkout / OTP บริษัท / แอดมิน)` |
| `:7-8` เตือน/Modal | | `→ PR D: กล่องข้อมูลไม่บล็อก แทน Modal` |
| `:10` "Backend ตรวจที่ quote และก่อน checkout mutation …" | | `→ Backend ไม่ปฏิเสธเพราะโปรไฟล์ไม่ครบ; drift ตั้งแต่ quote → BILLING_QUOTE_STALE เท่านั้น` |
| `:11` "ส่งชื่อ/ที่อยู่ไป Customer … รักษา verified email" | | `→ payload เดียว stripeCustomerSyncPayload: name เสมอ, address เฉพาะครบ 5 ช่อง, email เฉพาะ verified account email หรือผู้รับปัจจุบัน` |
| `:13` "Quote เก่าที่ไม่มี profile ต้องสร้างใหม่ …" | | คง (ยัง QUOTE_STALE) |
| `docs/specs/signup-optional-email-otp-billing-spec-th.md:20` "ก่อน user เริ่มชำระเงิน … ต้องมี current verified account email" | | `→ ยกเลิก (D-PF-1/R-A6): อีเมลบัญชีเป็นทางเลือก; ผู้รับเอกสารแยกเป็น recipientEmail ของบริษัท` |
| `:21` D01 recipient = verified account email | | `→ D01 แทนที่: ผู้รับ = BillingAccount.recipientEmail; company-scoped recipient OTP มีแล้ว (purpose BILLING_RECIPIENT ผูก companyId) ตามที่ D01 เคยเสนอ` |
| `:82` copy "ก่อนชำระแพ็กเกจจะให้ยืนยันอีเมลสำหรับรับเอกสาร" | | `"เพิ่มภายหลังได้ อีเมลรับเอกสารกรอกที่หน้าชำระเงิน"` (PR A RV33 แก้ `auth.controller.ts:580` ให้ตรง) |
| `:86` journey "ถ้าไม่มี verified email แสดงขั้น ยืนยันอีเมลก่อนชำระเงิน" | | `→ ไม่มีขั้นนี้; Stripe Checkout ถามอีเมล` |
| `:181-182` ตาราง gate | | `→ ทั้งสองแถว: ไม่ต้องมี verified email; op ผู้รับค้าง (BILLING_EMAIL_UPDATE_PENDING) เป็นตัวบล็อกเดียว; portal/RESUME/CANCEL_DOWNGRADE ไม่ผูกอีเมล (DQ2)` |
| `:189` quote อ่าน email จาก user | | `→ quote.billingEmail = recipientEmail ?? verified account email ?? null; body billingEmail optional และถูกละเลย` |
| `:121` reauth rule | คง (R-B3 ตัดทิ้ง) | คง + หมายเหตุ "recipient OTP ของบริษัท (PR C §4.8) ไม่บังคับ reauth — ดูเหตุผลใน brief" |
| `:355` portal recheck email proof | | `→ portal ไม่ตรวจ email proof (DQ2); ยังตรวจ company/customer/settings/authority และ portal config ห้ามแก้อีเมล` |
| `docs/specs/mangmee-sales-deals-and-locked-signup-spec-th.md:51` J2 "กรอกที่ขาด (ที่อยู่บริษัท, อีเมล)" | | `→ ไม่มีขั้นกรอกในแอป (D-PF-1)` |
| `:53` J3 (ถ้ามีข้อความอีเมล/ที่อยู่) | | ตัดวงเล็บเดียวกัน |
| `:112` quote ดีล "ต้องมีอีเมลยืนยัน … และที่อยู่บริษัท (D4)" | | `→ ไม่ต้อง (D-PF-1 ทับ D4)` |
| `:120` nav ร้านล็อก badge "ยังกรอกไม่ครบ" | | คง badge แต่เพิ่ม "ไม่บล็อกการซื้อ" |
| `:152` S16 | | เพิ่ม "แก้แล้วโดย purchase-without-setup PR C (ถอด proof ที่ quote/checkout/repeat)" |
| `:184`, `:194` D4 | | `→ ทับโดย D-PF-1 (2026-09-26)` |
| `:350` D-P3-8 ขั้นกรอกที่อยู่/อีเมลของดีลใช้ `billingProfileHref` | | `→ ไม่มีขั้นบังคับ; ลิงก์โปรไฟล์เป็นทางเลือก (PR D)` |
| `docs/specs/mangmee-transactional-email-provider-spec-th.md:128` "verified billing recipient ของบริษัท" | | `→ ผู้รับเอกสารของบริษัท = BillingAccount.recipientEmail (แหล่ง: Checkout/OTP/แอดมิน) ไม่ผูก verified account email; อีเมล "ชำระสำเร็จ" ของเราส่งถึงผู้รับนี้ผ่าน Postmark stream เดียว (Tag=billing_status) — DQ6 ไม่แยก stream` |
| `docs/specs/mangmee-line-web-billing-ui-spec-th.md:78` "เก็บ billing email สำหรับ Stripe documents แยกจาก account recovery" | สอดคล้องแล้ว | เพิ่ม "= BillingAccount.recipientEmail; แก้ได้ด้วย OTP บริษัท (PR C §4.8)" |
| `docs/specs/mangmee-billing-subscription-spec-th.md:254` "ไม่สร้าง invoice/PDF ใหม่หรือส่ง receipt ซ้ำด้วย Postmark" | | `→ คงห้ามส่งตัวใบเสร็จ/PDF ผ่าน Postmark; ส่งได้เฉพาะอีเมลแจ้งพร้อมลิงก์เข้าแอป (R-A7/R-D1) และ operator/ลูกค้า resend ผ่าน Stripe (/invoices/:id/send, charge receipt_email) จำกัด 3/ใบ/วัน` |
| `docs/plans/mangmee-sales-deals-and-locked-signup-plan-th.md:19` และ `:83` "ห้ามแตะ … `billing-collection.ts`, `billing-schedule.ts`, `billing-upgrade.ts`, `billing-refund-source.ts`" | 6 ไฟล์ | `→ เหลือ 2 ไฟล์หลักฐาน: paid-invoice.ts, paid-checkout-invoice.ts (RV34; purchase-without-setup PR C แก้ billing-collection.ts ตาม DQ2)`; `billing-schedule.ts` ยังไม่แตะใน PR C (P0) แต่ไม่อยู่ในรายการห้ามของแผนนั้นอีก |
| `docs/agent-memory/purchase-without-setup-2026-09-26.md` | Status/Verification/Next | อัปเดตเมื่อ PR C เปิด/merge: ระบุ PR no., run ids (Extended Tests backend), ผล backfill dry-run, ข้อที่รอ PR D (browser block ใน http-smoke) |
| `docs/plans/mangmee-purchase-without-setup-plan-th.md` P2 ข้อ 2 "(+ SCHEDULED_CHANGE/ADVANCE_DEAL ใน purchase-kind list)" | | ลบวงเล็บ (มีอยู่แล้ว — ข้อขัดแย้ง 1) |

---

## 8. Verification commands (ตามคำสั่ง Owner 2026-09-21: typecheck + boot + spec ที่แตะ; CI ครั้งเดียวตอน merge; PG/smoke ผ่าน Extended Tests)

```bash
# ใน worktree ของ PR C (จาก origin/develop ล่าสุด, หลัง PR A ถ้ามี)
pnpm install --frozen-lockfile
pnpm --filter @watchdog-bms/contracts build
pnpm --filter @watchdog-bms/api exec prisma generate --schema prisma/schema.prisma   # หลังแก้ schema (stale-worktree-prisma-client)
pnpm --filter @watchdog-bms/api migration:review > /tmp/prc-migration-review.sql && grep -n "recipientEmail\|checkoutAddressJson\|EmailVerificationToken" /tmp/prc-migration-review.sql
pnpm --filter @watchdog-bms/api typecheck            # script มี heap flag; อ่าน exit code จริง ห้าม pipe
pnpm --filter @watchdog-bms/contracts typecheck 2>/dev/null || pnpm --filter @watchdog-bms/contracts build
pnpm --filter @watchdog-bms/web typecheck             # contracts เปลี่ยน + api-error-message
# unit specs ที่แตะ/ใหม่
pnpm exec tsx --test packages/contracts/src/billing-company-profile.spec.ts
pnpm --filter @watchdog-bms/api exec tsx --test src/modules/billing/application/billing-company-profile.spec.ts src/modules/billing/application/billing-profile-recovery.spec.ts src/modules/billing/domain/billing-recipient-otp.logic.spec.ts src/modules/billing/application/billing-recipient-otp.service.spec.ts src/modules/billing/application/billing-document-resend.spec.ts src/modules/billing/application/billing-notifications-recipient.spec.ts src/modules/auth/auth.guard.spec.ts src/modules/billing/application/billing-collection.spec.ts src/spec-suite-coverage.spec.ts src/common/pipes/body-validation-coverage.spec.ts
pnpm --filter @watchdog-bms/web exec tsx --test src/common/api/api-error-coverage.spec.ts
# DI/boot
pnpm --filter @watchdog-bms/api test:boot
# pins (auth.guard.ts แตะ)
node infra/security/sync-production-maintenance-release-pins.mjs && node infra/security/sync-production-maintenance-release-pins.mjs --check
bash infra/security/sync-production-maintenance-release-pins.spec.sh && bash infra/security/validate-production-maintenance-release.spec.sh
# ไฟล์หลักฐานต้องไม่มี diff
git diff --stat origin/develop -- apps/api/src/modules/billing/domain/paid-invoice.ts apps/api/src/modules/billing/domain/paid-checkout-invoice.ts apps/api/src/modules/billing/application/billing-schedule.ts package.json apps/*/package.json packages/*/package.json   # ต้องว่าง
# PG spec (ถ้ามี PG local :15432 ตาม local-dev-server-recipe; ไม่บังคับก่อน push)
EMAIL_OTP_TEST_DATABASE_URL=postgresql://…/email_otp_test pnpm --filter @watchdog-bms/api exec tsx --test src/modules/billing/application/billing-email-recipient.postgres.spec.ts
BILLING_RECIPIENT_TEST_DATABASE_URL=postgresql://…/watchdog pnpm --filter @watchdog-bms/api exec tsx --test src/modules/billing/billing-recipient-capture.pg.spec.ts
# หลัง merge develop: dispatch Extended Tests (Actions → Extended Tests → Run workflow, branch develop) → บันทึก run id ของ Billing Integration (backend) ใน memory; customer suite จะแดงจนกว่า PR D (§6.1)
# backfill (release step): §3.3 — dry-run ก่อนเสมอ; บันทึก summary JSON
```

---

## 9. Risks / guards

1. **ไฟล์หลักฐานไม่แตะ**: `paid-invoice.ts`, `paid-checkout-invoice.ts` (ไม่ตรวจอีเมล/ที่อยู่อยู่แล้ว), `billing-schedule.ts` — ตรวจด้วย `git diff --stat` (§8); AC8
2. **repeat journal hash (RV17)**: `billing-repeat.ts` params ของ `command('checkout')` เปลี่ยน → attempt REPEAT/UPGRADE ที่ journal `commands.checkout` ไว้ก่อน deploy จะ `review()` (BILLING_REPEAT_REVIEW → issue REPEAT_RECOVERY) เมื่อ advance หลัง deploy. Deploy note: ก่อน UAT/prod รัน `SELECT id FROM "BillingAttempt" WHERE status IN ('OPEN','REQUESTING','UNKNOWN','CREATING') AND "quoteSnapshot"->'repeat' IS NOT NULL` ต้องว่าง (production: ผ่านอุโมงค์ read-only recipe) — มิฉะนั้นรอให้จบ/ยุติก่อน
3. **R-A5 ก่อน admin recipient change (PR E, A11)**: PR C ถอดการเทียบอีเมล Stripe ที่ quote/checkout/repeat แล้ว → PR E จึงเปลี่ยนผู้รับได้โดยไม่ทำให้การซื้อพัง; ห้าม merge PR E ก่อน PR C
4. **Stripe email lock (R-A2)**: ห้ามใส่อีเมลที่ไม่ verified ลง Customer — payload ใช้เฉพาะ `quote.billingEmail` (recipient ปัจจุบัน / verified) ✓; ผู้ซื้อที่มี verified email จะไม่ได้แก้อีเมลใน Checkout (AC1 ข้อยกเว้น)
5. **G27 ต้องพิสูจน์บน UAT test mode**: Checkout ถามอีเมลเมื่อ Customer ไม่มีและเขียนลง Customer; `customer_update.address` never/auto; `/invoices/:id/send` กับใบ paid (test mode ไม่ส่งเมล — ดู `invoice.sent` event); `receipt_email` เปลี่ยนแล้วส่ง; PROMPTPAY_RENEW binding เมื่ออีเมลมาจาก Checkout (RV20; fallback §4.7)
6. **UAT Postmark allowlist** (`POSTMARK_UAT_ALLOWED_RECIPIENTS` `config/index.ts:412`): อีเมลที่พิมพ์ที่ Checkout บน UAT ต้องอยู่ใน allowlist มิฉะนั้น attempt CONFIG/PERMANENT → ต้องใช้ allowlist ในแผนทดสอบ; `assertEmailOtpDeliveryReady` ปฏิเสธ OTP ผู้รับนอก allowlist ด้วย `EMAIL_DELIVERY_UNAVAILABLE` (ข้อความบอกชัด)
7. **Stream เดียว (DQ6)**: hard bounce ของอีเมลผู้รับทำให้ `EmailSuppression` บล็อกอีเมลนั้นทั้ง OTP/claim/billing บน stream นี้ — ยอมรับ (อีเมลตาย); แยกด้วย Tag ใน Postmark dashboard
8. **DB ↔ Stripe drift**: แอดมินแก้อีเมลใน Stripe Dashboard → DB ไม่รู้; `emailRecipient.current()` แสดงทั้ง `email` (Stripe) และ `stored` (DB) ให้ UI/แอดมินเห็นความต่าง; ไม่มี auto-sync (ตั้งใจ — op เท่านั้นที่เขียนทั้งสอง)
9. **Op ค้างข้าม release**: `proposedJson` แบบเก่า (`emailProof`) ยัง advance ได้ผ่าน `targetOf` ✓; snapshot quote เก่าที่มี `emailProof` ถูกละเลย ✓; attempt ที่ checkout แล้วก่อน deploy ยัง apply ได้ (capture set-if-null) ✓
10. **ci.yml parity + pins**: PR C แก้ `ci.yml` (PG spec) และ `auth.guard.ts` → twin main ต้อง byte-identical ก่อน UAT all (`deploy-uat.yml:79-93`); pins sync ใน PR เดียวกัน
11. **Extended Tests customer suite แดงชั่วคราว** จนกว่า PR D (browser block `billing-http-smoke.ts:310-346`) — บันทึกใน PR body + memory; หลักฐาน PR C = backend suite + unit + boot
12. **Security ของ recipient OTP ไม่มี reauth** (§4.8): session ถูกขโมย → เปลี่ยนผู้รับได้ → mitigations: ต้อง `company.plan.manage`, OTP ไป mailbox ใหม่, อีเมลแจ้งผู้รับเดิม + push ผู้จัดการแพ็กเกจทันที, limiter, audit; ถ้า Owner ต้องการ reauth ให้เพิ่ม `activeSessionOf` + `emailReauthenticatedAt` check (5 นาที) ที่ `request()` — 3 บรรทัด (§10)
13. **PII**: ไม่มีอีเมล/ที่อยู่ใน `metadataJson`/outbox payload (ตรวจใน spec ใหม่ §6.3); `checkoutAddressJson` เป็นข้อมูลบริษัท (เหมือน `Company.addressJson`)
14. **Rate limit ของ endpoint** ใช้ `billing-command` 30/นาที เดิม + limiter ของ OTP (DB-based) + `billing-resend` (Redis; production fail-closed เมื่อ Redis ล่ม → 503 เหมือน endpoint อื่น)

---

## 10. ต้องตรวจ (ก่อน/ระหว่าง implement)

1. DQ11 (spec §18.4/§18.5 — ค่าเริ่มต้น = ไม่บังคับ): recipient OTP ไม่บังคับรหัสผ่าน/LINE reauth (§4.8, risk 12); ถ้า Owner ไม่รับ ให้ใส่ reauth 5 นาทีแบบ account OTP (3 บรรทัด)
2. ตัดสินแล้ว 2026-09-27 (spec §18.5 A1, DQ6): ไม่แยก stream; แยกด้วย Tag `purpose` + intentKey
3. ตัดสินแล้ว: ลำดับ A→B→C — PR C ใช้ `planManagers()` ของ PR A สำหรับผู้รับ LINE/เว็บ (§4.11.4/§4.11.5) และคง `owners()` สำหรับอีเมล legacy fan-out
4. `billing-collection.spec.ts` (catalog) และ `billing-notification-smoke.ts` fixture: grep `emailProof`/`recipientUserId` ตอนทำจริง
5. SQL ของ drain candidates แบบ UNION + `FOR UPDATE … SKIP LOCKED` (§4.11.4) — พิสูจน์ด้วย `billing-notification-smoke.ts` ว่า claim/skip-locked ยังถูกต้อง (หรือแยกเป็น 2 query claim ถ้า Postgres ปฏิเสธ `FOR UPDATE` ใต้ UNION)
6. Stripe `/invoices/:id/send` ใช้อีเมลใด (customer_email แช่แข็ง vs Customer.email ปัจจุบัน — A13) — พิสูจน์บน production ด้วยการซื้อทดสอบของ Owner (P6); ถ้าใช้ค่าแช่แข็ง ถือว่าอีเมลของเรา + receipt_email คือทาง J4 ที่ใช้งานได้จริง และ UI (PR D) ควรบอกว่า "ใบแจ้งหนี้จาก Stripe อาจไปอีเมลเดิม"
7. G27 บน UAT: (ก) Customer ไม่มี email → Checkout ถามและเขียน; (ข) `customer_update.address` never/auto; (ค) PROMPTPAY_RENEW binding หลัง capture (RV20)
8. Backfill: dry-run summary บน UAT (นับ noEmail/bindingMismatch) ก่อนตัดสินใจรันบน production; production ผ่านอุโมงค์ต้องแจ้ง Owner ก่อน (security alert)
9. `billing-http-smoke.ts:310-346` ให้ PR D rewrite; ระหว่างนี้ customer suite แดง — ตกลงกับ controller ว่า acceptance ของ PR C ใช้ backend suite
10. ตัดสินแล้ว: เพิ่มคอลัมน์ `EmailVerificationToken.companyId` (spec §18.5 A2 แก้ §9)
11. ข้อความไทย/label ใหม่ทั้งหมด (§2.4, §4.11 title/body, template) ให้ Owner sign-off ตามกติกา plain-Thai (ไม่มี code/enum ใน UI)
12. ตรวจว่า `RedisRateLimitService.inspect` นับ `count < max` (`:184`) — ครั้งที่ 3 ยัง allowed (count 2 <3) และครั้งที่ 4 ปฏิเสธ (count 3) ✓ ตรงกับ "3 ครั้ง/วัน"
