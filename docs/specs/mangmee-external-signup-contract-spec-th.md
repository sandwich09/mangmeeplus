# Auto-register จากเว็บไซต์ทางการ (External Signup Contract) — Spec P10

สถานะ: **P10-0 CORE IMPLEMENTED + LOCAL VERIFIED** — durable state/idempotency/audit/outbox/provisioning fence พร้อม; public ingress, email claim และ provision จริงยังปิดจน Owner ตอบ §8 และ P11 พร้อม; offer preview/EasySlip paid branch เป็น **spec-only และยังไม่มี payment implementation**; แผนส่งมอบอยู่ใน [Four-lane Gap Closure Plan](../plans/mangmee-four-lane-gap-closure-plan-th.md#p10--external-signup)

> **Owner amendment 2026-08-29:** ① ผู้สมัครทำอัตโนมัติจนจบขั้นยืนยันอีเมล + ตั้งรหัสผ่าน แล้ว **System Admin กดอนุมัติครั้งเดียวก่อน provision** (§4) ② email ที่ยืนยันแล้วเป็นกุญแจหลัก, taxId ตรวจเฉพาะรายที่กรอก, **ชื่อบริษัท/ร้านซ้ำกันได้เสมอ** (§4C) ③ ไม่มี temporary password — ผู้สมัครตั้งรหัสเองที่หน้า claim (§4B). Amendment นี้เป็น **spec-only**; P10-0 core ที่มีอยู่ยังไม่รวม state/field/UI ใหม่ใน §4A–§4E และห้ามอ้างว่า implement แล้ว.

ที่มา: [แผนหลัก P10 + §13.6](../plans/mangmee-brain-2-5-day-priority-plan-th.md) (flow, states, contract ขั้นต่ำ กำหนดไว้แล้วคำต่อคำ — spec นี้ยกมาเป็นทางการ + ผูกหลักฐานโค้ด); STOP-SHIP ที่ต้องปิด: SIGNUP-01, SIGNUP-02 (§13.3)

หลักฐานฐานเดิม `develop` (สำรวจ 2026-08-26) และ candidate P10-0: [แผนส่งมอบ P10](../plans/mangmee-external-signup-plan-th.md)

## 1. Current truth

| ข้อเท็จจริง | หลักฐาน |
|---|---|
| **ไม่มีโค้ด public signup ใด ๆ** (คำค้น auto-register/self-signup/external-signup = 0 hit) | ยืนยัน NOT FOUND ทั้ง apps/packages |
| Onboarding ภายในเป็น admin-only ทั้งโมดูล (ไม่มี `@Public()` route เลย) และ **ไม่มีช่อง email**: `CreateCompanyOnboardingCommand` ไม่มี field email, ไม่มี path ใดเขียน `User.email` | `create-company-onboarding.use-case.ts:45-70`; `system-onboarding.controller.ts:22-40`; ยืนยันซ้ำใน forgot-password spec :27 |
| admin-company-onboarding-spec ประกาศ non-goal ชัด: "Public self-service signup" / "Email/SMS delivery provider" | spec :24-27,:143 |
| **Precedent ที่ลอกได้ทั้งชุด**: `POST /v1/auth/line/customer-register` — endpoint `@Public()` จริงที่มี rate limit ก่อน use case (key `ip:lineChannelId`), DTO bounded+pattern ทุกช่อง, consent flag, LIFF page ติด CSP/no-store/no-referrer | `customer-line-register.controller.ts:24-68`; bucket `assertCustomerRegisterAllowed` (`auth-rate-limit.service.ts:66`) |
| Service-auth precedents: `assertInternalSecret` (timing-safe, L-07 duplication contract) + HMAC verifier ของ LINE webhook (sha256 raw body, timingSafeEqual) | `secret-compare.ts`; `line-webhook-verifier.ts:14-22` |
| Idempotency pattern ของ repo = **DB unique บน key ที่ผู้เรียกส่ง** (ไม่มี middleware Idempotency-Key กลาง); มีรูป unique แบบไม่มี company (`@@unique([idempotencyKey])` — `schema.prisma:3812`) ซึ่งเป็น shape ที่ signup ก่อนมี tenant ต้องใช้ | ตาราง unique 8 จุด + helper `buildIdempotencyKey` |
| Outbox durable มีครบ (PENDING→PROCESSING→PUBLISHED/FAILED/DEAD, claimToken CAS, `companyId` nullable = event ระดับ platform ได้) | `schema.prisma:917-946`; `outbox-append.service.ts:61-75` |
| Rate-limit policy taxonomy ประกาศแล้ว: bucket ที่คุ้มครอง credential/เงิน = fail-closed default | `redis-rate-limit.service.ts:19-30` |

### 1.1 สิ่งที่ P10-0 เพิ่มแล้ว (ยังไม่มี public route)

| Contract | หลักฐาน candidate |
|---|---|
| durable request + state/version + normalized payload hash | `schema.prisma` model `CompanySignupRequest`; migration `20260826200000_external_signup_core`; `company-signup.logic.ts` |
| key เดิม/payload เดิมคืน request เดิม; key เดิม/payloadต่างคืน 409; race key เดียวสร้างหนึ่ง row | `CompanySignupCoreService.receive()` ใช้ transaction advisory lock + unique key; focused test และ real-PostgreSQL smoke 16 concurrent calls |
| transition/retry ไม่ข้าม state; provisioning มีผู้ชนะหนึ่งรายและ attempt fencing | `advance()`, `claimProvisioning()`, `completeProvisioning()`, `failProvisioning()`; real-PostgreSQL smoke 8 concurrent claims + stale-attempt rejection |
| ทุก transition มี audit + outbox ที่ไม่บันทึก PII | `appendEvidence()`; smoke ยืนยัน 8 audit/8 outbox และไม่มี email/company/owner/tax ID ใน evidence payload |
| public surface ยังปิด | `ExternalSignupModule` มี provider/export เท่านั้น ไม่มี controller และไม่มี `@Public()` route |

ขอบเขตที่ยัง **ไม่ถือว่า implemented**: signed ingress/nonce/rate limit/status API, duplicate email/tax-ID policy, email delivery/claim token, verified owner credential, onboarding adapter, LINE handoff และ UI ทุกหน้า

## 2. หลักการที่ห้ามละเมิด

1. เว็บไซต์ทางการ**ห้ามเรียก System Admin browser API** ด้วย cookie/API key ถาวร — ต้องมี integration boundary แยก (§13.6)
2. Retry ทุกชนิดเดินต่อจาก state เดิม idempotent — **ห้ามสร้าง Company/User/Membership/email/LINE link ซ้ำ** (SIGNUP-01)
3. Default provision **หลัง** email claim สำเร็จ (กันบริษัทขยะ — SIGNUP-02) **และหลัง System Admin อนุมัติ (Owner amendment §4)**; pre-approved partner ที่ provision ก่อนต้องใช้ state/idempotency ชุดเดียวกัน
4. ไม่มี temporary password และไม่มี QR account-link ส่วนตัวในอีเมล/response ใด ๆ (LINE-ONBOARD-01)
5. Provision ผ่าน onboarding application service เดิมเท่านั้น (กฎสร้างบริษัทชุดเดียว)

## 3. สัญญา (จาก §13.6C — ยกเป็นข้อกำหนดทางการ)

- `POST /v1/integrations/official/company-signups`
- Auth: HMAC (sha256 raw body ตามแบบ `line-webhook-verifier`) **หรือ** short-lived service JWT — เลือกที่ §8 ข้อ 1; + timestamp + nonce (กัน replay), secret rotation ได้
- Header idempotency: ใช้รูปแบบ repo = field ใน payload `externalSignupId` + DB `@@unique([externalSignupId])` บน `SignupRequest` (แบบ `schema.prisma:3812`) — ไม่ประดิษฐ์ middleware ใหม่
- Payload ขั้นต่ำ: `externalSignupId, companyName, taxId?, ownerDisplayName, contactEmail, consentVersion, referralCode?, requestedOfferKey?`; DTO ทุกช่อง bounded/pattern ตามแบบ customer-register
- **เพิ่มตามฟอร์มจริง (Owner 2026-08-29):** `businessType?` (free text — map เข้า `CompanyBusinessCategory` enum ตอน review/provision โดยแอดมินเลือกได้; หมวดสุขภาพเป็น PDPA tripwire ต้อง map ถูก), `phoneNumber?` (ช่องทางติดต่อ ไม่ใช้ dedupe/OTP ในเฟสแรก), `vatRegistered?` (boolean — provision เป็น state เท่านั้น ไม่สร้าง `VatFact` เพราะไม่มี `effectiveFrom`; Owner เติมในหน้าตั้งค่าภายหลัง)
- `requestedOfferKey` เป็นเพียงรหัส attribution/onboarding offer แบบ versioned ที่ตรวจจาก allowlist และเก็บ audit; **P10 ห้ามพึ่ง `BillingPackage`, ราคา, subscription หรือ quota ของ P26** และห้ามให้ field นี้เปิด entitlement เอง — provisioning ใช้ policy ฝั่ง server ที่อนุมัติไว้เท่านั้น
- ตอบ `202 { requestId }` เสมอ — ไม่มีการยืนยันสร้างบริษัทก่อน durable state; ไม่มี secret ใด ๆ ใน response
- request เดิม+payload เดิม → ผลเดิม; key เดิม+payload ต่าง → `409`; email/taxId/externalSignupId ชนของเดิม → deterministic attach/review policy (ห้ามเดาจากชื่อบริษัท)
- Rate limit: bucket ใหม่ `official-signup-ip` + `official-signup-email` (normalize lowercase ตามแบบ L-06) — fail-closed; abuse: schema allowlist + audit `source='official-site'`
- Status: `GET /v1/integrations/official/company-signups/:requestId` (signed เช่นกัน) คืน state ปัจจุบันเท่านั้น

### 3A. Offer preview สำหรับหน้า auto-register — **spec-only 2026-08-29**

- Source of truth ของราคาและ enable state คือ [Billing §8](mangmee-billing-subscription-spec-th.md#billing-offer-catalog): `FREE_TRIAL`, `MONTHLY_259`, `MONTHLY_599`, `MONTHLY_999`, `MONTHLY_1299`.
- หน้า auto-register แสดงครบทั้ง 5 offer เพื่อให้เห็น journey จริง แต่เลือกได้เฉพาะ `FREE_TRIAL`; paid tiers ต้อง disabled พร้อมข้อความ “เร็ว ๆ นี้” และเหตุผลที่อ่านได้ด้วย assistive technology.
- Allowlist ฝั่ง server สำหรับการสมัครปัจจุบันรับเฉพาะ `FREE_TRIAL`; ถ้าผู้เรียกส่ง paid key โดยตรงให้คืน `offer_not_available` และ **ห้าม fallback เป็น Free เงียบ ๆ**.
- แม้รับ `FREE_TRIAL` แล้ว `requestedOfferKey` ยังคงเป็น attribution/audit เท่านั้นตาม §3; P10 ห้ามสร้าง `BillingPackage`, payment attempt, entitlement หรืออนุมาน quota/feature ที่ยังเป็น TBD.

<a id="external-signup-owner-amendment"></a>
## 4. Durable state — **target amendment 2026-08-29; delta ยังไม่ implement**

P10-0 core ที่ implement แล้วคง durable/idempotency/fencing เดิม แต่ target state ต้องแทรกขั้นอนุมัติและย้าย provisioning ไปหลังอนุมัติ:

```text
RECEIVED
  → VALIDATED            (schema + rate limit + dedupe ตรวจอัตโนมัติ)
  → EMAIL_PENDING        (ส่งเมลยืนยันทันทีผ่าน outbox/P11)
  → EMAIL_VERIFIED       (ผู้สมัครกดลิงก์ + ตั้งรหัสผ่านที่หน้า claim — §4B)
  → PENDING_REVIEW       (เข้าคิว System Admin — §4C)
  → PROVISIONING         (แอดมินอนุมัติครั้งเดียว → CreateCompanyOnboardingUseCase เดิม ผูก signupRequestId)
  → READY → LINE_LINK_PENDING → COMPLETED

ข้างเคียง: EMAIL_FAILED / PROVISIONING_FAILED / SUSPENDED / EXPIRED / REJECTED
```

ทุก transition append audit; ทุก retry เดินต่อจาก state เดิม idempotent. การเพิ่ม `PENDING_REVIEW`/`REJECTED` และ field ใน amendment ต้องมี migration/test ใหม่ ห้ามนับหลักฐาน P10-0 เดิมเป็นหลักฐานของ delta นี้.

### 4A. เหตุผลของลำดับใหม่

ผู้สมัครทำครบในรอบที่ตั้งใจสมัคร (กรอกฟอร์ม → ยืนยันเมล → ตั้งรหัส) โดยไม่ต้องรอใคร; คิวแอดมินเห็นเฉพาะคำขอที่ยืนยันเมลแล้ว และคลิกอนุมัติเดียวจึง provision. วิธีนี้ลดสแปมและไม่สร้าง Company/User ก่อน review.

### 4B. หน้า claim = ยืนยันอีเมล + ตั้งรหัสผ่าน (ก่อนมี User)

- ณ จุด claim ยังไม่มี `User`; รหัสเก็บเป็น **hash เท่านั้น** บน `CompanySignupRequest.pendingPasswordHash` ด้วย policy เดียวกับ `UserCredential` แล้ว move เป็น `UserCredential` (`mustChangePassword=false`) ตอน PROVISIONING; สำเร็จแล้วลบ hash จากคำขอ.
- ห้ามเก็บ/ส่ง plaintext; claim token เป็น hash-only + single-use + atomic ตาม P11.
- `REJECTED` ต้องลบ pending password hash และไม่ทิ้ง User กำพร้า; แจ้งผู้สมัครโดยไม่เปิดเหตุผลภายใน.
- username เริ่มจาก local-part ของ email และให้แก้ได้ที่หน้า claim; เขียน `User.email` + `emailVerifiedAt` ตอน provision.

### 4C. นโยบาย duplicate + คิวอนุมัติ

- **email ที่ยืนยันแล้ว = กุญแจระบุตัวตนหลัก:** ถ้าซ้ำ `User` เดิม คิวเสนอ “attach เข้า user เดิม” เป็นค่าแนะนำก่อนสร้างใหม่.
- **taxId ตรวจเฉพาะรายที่กรอก:** ถ้าชนบริษัทเดิมให้ติดธง review ห้ามระบบเดา.
- **ชื่อบริษัท/ร้านซ้ำกันได้เสมอ:** implementation ต้องปลด platform-wide unique-name assumption สำหรับเส้นทางนี้; ใช้ taxId/email/จังหวัดเป็น review hints.
- คิว System Admin แสดงข้อมูลคำขอ + dedupe hints + การ map `businessType` + offer/trial policy/quota override พร้อม Approve/Reject แบบ idempotent และ audit ทุก action.
- `PENDING_REVIEW` เกิน SLA ต้องเตือนผ่าน dashboard-notifications; ค่า SLA ยังเป็น Owner question §8.

### 4D. แจ้งผลหลังอนุมัติ

Provision สำเร็จ → ส่งเมล “เปิดใช้งานแล้ว เข้าสู่ระบบได้เลย” ผ่าน outbox โดยไม่มี secret; ถ้าผูก LINE แล้วใช้ช่องแจ้งเตือนเดิม. ผู้สมัครใช้รหัสที่ตั้งเอง ไม่ส่ง temporary password.

### 4E. Paid branch ในอนาคต — **planned/disabled**

- Free เดิน `PENDING_REVIEW --approve--> PROVISIONING` และต้องไม่เรียก EasySlip.
- เมื่อ Owner เปิด paid offer และ P26 ผ่าน gate จึงเดิน `PENDING_REVIEW --approve paid--> PAYMENT_PENDING → PAYMENT_VERIFIED → PROVISIONING`; วางการชำระหลังอนุมัติเพื่อไม่รับเงินจากคำขอที่อาจถูก Reject.
- Backend snapshot offer version + ราคาเป็น satang แล้วแสดง K BIZ Thai QR ที่ล็อกยอด; EasySlip v2 ตรวจ receiver/amount/duplicate ตาม [Billing F-BILL-3](mangmee-billing-subscription-spec-th.md#billing-easyslip-v2). `transRef` claim ได้ครั้งเดียว และผล verify อย่างเดียวห้ามข้าม admin approval.
- รอบปัจจุบันไม่มี payment state/table/API/UI/config/secret/provider call; ส่วนนี้เป็น migration ของ P26 ไม่ใช่การรื้อ signup/email/idempotency core.

## 5. หน้าเว็บฝั่งผู้สมัคร (กติกา F-LED-7)

ตาม §13.6A ขั้น 1–2 + checklist 3 ขั้นของ §13.6D: หน้า "กรุณาตรวจอีเมล" ห้ามอ้างว่าสร้างบริษัทสำเร็จ; ทุกข้อความสถานะ mapping ตรงกับ state จริง

ส่วนเลือก offer แสดงรายการตาม §3A: Free เลือกได้; paid แสดงราคาแต่ control disabled + “เร็ว ๆ นี้”; ห้ามแสดง upload slip, payment pending หรือ payment success ใน flow ปัจจุบัน.

## 6. Gates/tests (ยกจากแผนหลัก §15 แถว "Official signup API" คำต่อคำ)

invalid/expired/replayed signature ถูกปฏิเสธ; same-request concurrency สร้าง signup/company/user/membership อย่างละหนึ่ง; key เดิม payload ต่าง 409; duplicate email/taxId deterministic; response ไม่มี secret; state/retry/audit ตรวจย้อนหลังได้ — ทุกข้อเป็น integration test บังคับ

## 7. สิ่งที่ไม่ทำ

ช่องทางสมัครอื่น (มือถือ app), การอนุมัติ partner หลายเจ้า (contract รองรับ `source` ไว้), SMS, payment runtime/การเก็บเงินจริง/การบังคับโควตา; ยกเว้น catalog แบบ display-only ใน §3A เพื่อเก็บทิศทางผลิตภัณฑ์

## 8. คำถาม Owner

1. **ยังเปิด:** เว็บไซต์ทางการถือ secret ได้ไหม → เลือก **HMAC** หรือ **service JWT**
2. **ยังเปิด:** Claim link หมดอายุกี่ชั่วโมง (แนะนำ 24 ชม.) และใครมีสิทธิ์ resend/revoke
3. ~~นโยบาย duplicate~~ → **ตอบแล้ว 2026-08-29 (§4C):** email verified เป็นกุญแจหลัก; taxId ตรวจเมื่อมีและชนแล้ว review; ชื่อบริษัทซ้ำได้
4. **ยังเปิด:** SLA/ช่องทางเตือนคิว, ข้อความ reject, TTL ของ `EMAIL_PENDING`/`PENDING_REVIEW`, Free trial duration/quota และ paid quota/feature snapshot
