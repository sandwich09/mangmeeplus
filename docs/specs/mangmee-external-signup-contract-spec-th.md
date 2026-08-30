# Auto-register จากเว็บไซต์ทางการ (External Signup Contract) — Spec P10

สถานะ: **P10-0 CORE IMPLEMENTED + LOCAL VERIFIED; target flow ล็อกเป็น Flow B (amendment v2 2026-08-30)** — durable state/idempotency/audit/outbox/provisioning fence พร้อม; public ingress, admin queue, claim และ provision จริงยังไม่ implement; ตัวปลดล็อกที่เหลือคือ SES operations (P11 §5 ข้อ 1–2) และตัวเลข trial (แสดงผลเท่านั้น ไม่ block โค้ด); offer preview/EasySlip paid branch เป็น **spec-only และยังไม่มี payment implementation**; แผนส่งมอบอยู่ใน [แผน P10](../plans/mangmee-external-signup-plan-th.md) และ [Four-lane Gap Closure Plan](../plans/mangmee-four-lane-gap-closure-plan-th.md#p10--external-signup)

> **Owner amendment v2 2026-08-30 ("Flow B" — ยืนยันในแชต, แทนลำดับของ amendment 2026-08-29):**
> ① **อนุมัติก่อน แล้วค่อยยืนยันอีเมล**: ฟอร์ม → ระบบตรวจอัตโนมัติ (schema + MX + rate limit + dedupe hints) → เข้าคิว System Admin ทันที → อนุมัติแล้วจึงส่งอีเมล **ฉบับเดียว** "อนุมัติแล้ว กดตั้งรหัสเพื่อเริ่มใช้งาน" → การกดลิงก์ = พิสูจน์ความเป็นเจ้าของอีเมล + ตั้งรหัส (หรือ login บัญชีเดิม) → provision ตอนนั้น (§4, §4A)
> ② **email ซ้ำได้** — 1 อีเมล = 1 บัญชีผู้ใช้ = หลายบริษัท (โมเดล multi-company P13); email ที่ยืนยันแล้วใช้ระบุว่าเป็นคนเดียวกันเพื่อ **ผูกบริษัทใหม่เข้าบัญชีเดิม** ไม่ใช่กติกาห้ามซ้ำ; taxId ตรวจเฉพาะรายที่กรอก; **ชื่อบริษัท/ร้านซ้ำกันได้เสมอ** (§4C)
> ③ ไม่มี temporary password — ตั้งรหัสที่หน้า claim หลังอนุมัติ และหน้า claim ต้องมีทางแยก "มีบัญชีอยู่แล้ว → เข้าสู่ระบบเพื่อผูกบริษัทใหม่" (§4B)
> ④ ขั้น LINE อยู่ท้ายสุดบนหน้าสำเร็จ ใช้ P12 ที่ production แล้ว + กติกา merge เมื่อ LINE ชนบัญชีเดิม (§4F)
> ⑤ ประตูเข้าหลัก = หน้า public บนเว็บแอปเราเอง ไม่ใช่ signed API จากเว็บ official (§3)
>
> Amendment นี้เป็น **spec-only**; P10-0 core ที่มีอยู่ยังไม่รวม state/field/UI ใหม่ใน §4A–§4F และห้ามอ้างว่า implement แล้ว.

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
3. Provision ต้องผ่าน **ทั้งสองด่านเรียงลำดับ: System Admin อนุมัติก่อน → email claim สำเร็จ → จึง provision** (Flow B); ไม่มี Company/User/Membership เกิดก่อน claim ไม่ว่ากรณีใด (SIGNUP-02 คงอยู่ครบ — คำขอที่อนุมัติแต่ไม่มีใคร claim ภายใน TTL แค่ EXPIRED ไม่ทิ้งซาก); pre-approved partner ที่ provision ก่อนต้องใช้ state/idempotency ชุดเดียวกัน
4. ไม่มี temporary password และไม่มี QR account-link ส่วนตัวในอีเมล/response ใด ๆ (LINE-ONBOARD-01)
5. Provision ผ่าน onboarding application service เดิมเท่านั้น (กฎสร้างบริษัทชุดเดียว)

## 3. สัญญา (แก้ตาม amendment v2 ข้อ ⑤ — ประตูเข้าหลักคือหน้าในแอปเราเอง)

- **Ingress หลัก**: หน้า public `/signup` บนเว็บแอป (`mangmeeplus.com`) เรียก `POST /v1/public/company-signups` แบบ `@Public()` same-origin ตาม precedent `customer-line-register.controller.ts` (rate limit ก่อน use case, DTO bounded/pattern ทุกช่อง, consent flag, CSP/no-store) — **ไม่มี secret/HMAC/JWT** เพราะไม่ใช่ server-to-server; เว็บ official + ปุ่ม rich menu "เริ่มต้นใช้งานฟรี" เป็นแค่ลิงก์มาหน้านี้ (ห้ามฝังฟอร์ม cross-site)
- Signed integration API สำหรับฟอร์มที่โฮสต์บนเว็บ official (`POST /v1/integrations/official/company-signups` + HMAC/JWT ตาม §13.6C เดิม) เลื่อนเป็น **future/optional** — จะเปิดเมื่อ Owner ต้องการฝังฟอร์มบนโดเมนอื่นจริง; ห้าม implement รอบนี้
- ตรวจอัตโนมัติที่ VALIDATED: schema + normalize + **MX lookup ของโดเมนอีเมล** (`dns.promises.resolveMx` พร้อม timeout; โดเมนไม่มี MX → ปฏิเสธที่ฟอร์มด้วยข้อความชัดเจน) — MX พิสูจน์ได้แค่โดเมนรับเมล การพิสูจน์ mailbox+ความเป็นเจ้าของทำที่ขั้น claim เท่านั้น
- Idempotency: field ใน payload `externalSignupId` (client มินท์ UUID ต่อการสมัครหนึ่งครั้ง ใช้ซ้ำตอน retry) + DB `@@unique([externalSignupId])` ที่มีแล้วบน `CompanySignupRequest` — ไม่ประดิษฐ์ middleware ใหม่
- Payload ขั้นต่ำ: `externalSignupId, companyName, taxId?, ownerDisplayName, contactEmail, consentVersion, referralCode?, requestedOfferKey?`; DTO ทุกช่อง bounded/pattern ตามแบบ customer-register
- **เพิ่มตามฟอร์มจริง (Owner 2026-08-29):** `businessType?` (free text — map เข้า `CompanyBusinessCategory` enum ตอน review/provision โดยแอดมินเลือกได้; หมวดสุขภาพเป็น PDPA tripwire ต้อง map ถูก), `phoneNumber?` (ช่องทางติดต่อ ไม่ใช้ dedupe/OTP ในเฟสแรก), `vatRegistered?` (boolean — provision เป็น state เท่านั้น ไม่สร้าง `VatFact` เพราะไม่มี `effectiveFrom`; Owner เติมในหน้าตั้งค่าภายหลัง)
- `requestedOfferKey` เป็นเพียงรหัส attribution/onboarding offer แบบ versioned ที่ตรวจจาก allowlist และเก็บ audit; **P10 ห้ามพึ่ง `BillingPackage`, ราคา, subscription หรือ quota ของ P26** และห้ามให้ field นี้เปิด entitlement เอง — provisioning ใช้ policy ฝั่ง server ที่อนุมัติไว้เท่านั้น
- ตอบ `202 { requestId }` เสมอ — ไม่มีการยืนยันสร้างบริษัทก่อน durable state; ไม่มี secret ใด ๆ ใน response
- request เดิม+payload เดิม → ผลเดิม; key เดิม+payload ต่าง → `409`; email/taxId/externalSignupId ชนของเดิม → deterministic attach/review policy (ห้ามเดาจากชื่อบริษัท)
- Rate limit: bucket ใหม่ `public-signup-ip` + `public-signup-email` (normalize lowercase ตามแบบ L-06) — fail-closed; abuse: schema allowlist + audit `source='public-web'` (คง `source` ไว้รองรับ partner/official-site ในอนาคต)
- Status: `GET /v1/public/company-signups/:requestId` (public, rate-limited) — `requestId` เป็น cuid เดายาก และตอบเฉพาะ state หยาบจาก allowlist (`กำลังตรวจ/รออนุมัติ/อนุมัติแล้ว-รอตั้งรหัส/เปิดใช้แล้ว/ปฏิเสธ`) ไม่มี PII/เหตุผลภายใน; หน้าเช็คสถานะใช้ endpoint นี้ + ปุ่มขอส่งอีเมลตั้งรหัสซ้ำ (จำกัดความถี่ ใช้ได้เฉพาะ state อนุมัติแล้ว)

### 3A. Offer preview สำหรับหน้า auto-register — **spec-only 2026-08-29**

- Source of truth ของราคาและ enable state คือ [Billing §8](mangmee-billing-subscription-spec-th.md#billing-offer-catalog) ชุด 2026-08-30 (ตรงเว็บ official): `PRO_TRIAL` (ทดลองใช้ฟรีบน PRO), `STARTER_249`, `BASIC_499`, `PRO_999`, `ENTERPRISE_1999`.
- หน้า auto-register แสดงครบ 4 tier (เริ่มต้น/เติบโต/มืออาชีพ/ธุรกิจ) ให้เห็น journey จริง แต่เลือกได้เฉพาะ `PRO_TRIAL` — trial ผูกกับแพ็กเกจ PRO ตามเว็บ ("สามารถเริ่มต้นด้วยแพ็กเกจ PRO ทดลองใช้ฟรี"); tier อื่น disabled พร้อมข้อความ “เร็ว ๆ นี้” และเหตุผลที่อ่านได้ด้วย assistive technology.
- Allowlist ฝั่ง server สำหรับการสมัครปัจจุบันรับเฉพาะ `PRO_TRIAL`; ถ้าผู้เรียกส่ง key อื่นโดยตรงให้คืน `offer_not_available` และ **ห้าม fallback เป็น trial เงียบ ๆ**.
- แม้รับ `PRO_TRIAL` แล้ว `requestedOfferKey` ยังคงเป็น attribution/audit เท่านั้นตาม §3; P10 ห้ามสร้าง `BillingPackage`, payment attempt, entitlement หรืออนุมาน quota enforcement (ตัวเลขประกาศต่อ tier อยู่ Billing §8; การบังคับเป็น P26).

<a id="external-signup-owner-amendment"></a>
## 4. Durable state — **target Flow B (amendment v2 2026-08-30); delta ยังไม่ implement**

P10-0 core ที่ implement แล้วคง durable/idempotency/fencing เดิม; target ใหม่ย้ายคิวอนุมัติมาก่อน แล้วให้การกดลิงก์ครั้งเดียว = พิสูจน์อีเมล + ตั้งรหัส + provision:

```text
RECEIVED
  → VALIDATED            (schema + MX + rate limit + dedupe hints อัตโนมัติ — ไม่มีเมลออก)
  → PENDING_REVIEW       (เข้าคิว System Admin ทันที — §4C)
  → EMAIL_PENDING        (แอดมินอนุมัติ → ส่งเมลฉบับเดียว "อนุมัติแล้ว กดตั้งรหัส" ผ่าน outbox/P11)
  → EMAIL_VERIFIED       (ผู้สมัครกดลิงก์: ตั้งรหัสใหม่ หรือ login บัญชีเดิม — §4B)
  → PROVISIONING         (ต่อทันทีจาก claim → CreateCompanyOnboardingUseCase เดิม ผูก signupRequestId)
  → READY → LINE_LINK_PENDING → COMPLETED   (ขั้น LINE บนหน้าสำเร็จ — §4F)

ข้างเคียง: REJECTED (จาก PENDING_REVIEW) / EMAIL_FAILED (bounce หลังอนุมัติ — §4D)
          / EXPIRED (ไม่ claim ภายใน TTL) / PROVISIONING_FAILED / SUSPENDED
```

Enum เดิมใช้ซ้ำได้ทั้งชุด (`EMAIL_PENDING`/`EMAIL_VERIFIED` เปลี่ยนเฉพาะลำดับ ไม่เปลี่ยนชื่อ); delta migration เพิ่มเฉพาะค่า `PENDING_REVIEW`, `REJECTED` และ field ใหม่ (`pendingPasswordHash`, `attachUserId` — §4B). ทุก transition append audit; ทุก retry เดินต่อจาก state เดิม idempotent. ห้ามนับหลักฐาน P10-0 เดิมเป็นหลักฐานของ delta นี้.

### 4A. เหตุผลของลำดับ Flow B

ผู้สมัครแตะระบบแค่ 2 ครั้ง (กรอกฟอร์ม / กดลิงก์+ตั้งรหัส) และอีเมลออก**ฉบับเดียวเฉพาะรายที่อนุมัติแล้ว** (ดีต่อ SES reputation); ไม่มี Company/User เกิดก่อนมีคนจริงยืนยันอีเมล+ตั้งรหัส (SIGNUP-02 คงเดิม — แค่ย้ายจุดพิสูจน์ไปท้าย); คำขอที่อนุมัติแต่ไม่มีใคร claim = EXPIRED เฉย ๆ ไม่ทิ้งซาก. **จุดแลกที่รับรู้แล้ว:** คิวแอดมินเห็นคำขอที่ยังไม่พิสูจน์อีเมล (กันด้วย rate limit + MX + ปริมาณช่วงแรกต่ำ) และคนพิมพ์อีเมลตัวเองผิดจะเงียบหาย (กู้ด้วยธง bounce ใน queue + เบอร์โทรจากฟอร์ม — §4D).

### 4B. หน้า claim หลังอนุมัติ = พิสูจน์อีเมล + ตั้งรหัส **หรือ login บัญชีเดิม**

- Claim token: hash-only + single-use + atomic + TTL **7 วัน** (ค่าเริ่มต้นที่ Owner รับ 2026-08-30; ปรับได้) + resend ได้จากหน้าเช็คสถานะแบบจำกัดความถี่ (token ใหม่ revoke เก่า) ตาม P11 F-EM-3.
- หน้า claim มี **ทางแยกบังคับถาม**: "มีบัญชี Mangmee อยู่แล้วหรือยัง (เช่น เป็นพนักงานในระบบ)?"
  - **ยังไม่มี** → ตั้งรหัสใหม่: เก็บ **hash เท่านั้น** บน `CompanySignupRequest.pendingPasswordHash` (policy เดียวกับ `UserCredential`) → PROVISIONING สร้าง User + `UserCredential` (`mustChangePassword=false`) + เขียน `User.email`/`emailVerifiedAt` → ลบ hash จากคำขอเมื่อสำเร็จ; username เริ่มจาก local-part ของ email แก้ได้ที่หน้านี้.
  - **มีแล้ว** → login ด้วยรหัสเดิมหรือ LINE (P12) บนหน้านั้น → เก็บ `attachUserId` → PROVISIONING **ผูกบริษัทใหม่เข้า User เดิม** (ไม่สร้าง User ใหม่) + เขียน email/`emailVerifiedAt` ให้บัญชีนั้นถ้ายังไม่มี; ไม่มีขั้นตั้งรหัสเลย.
  - การ attach เข้า User เดิมเกิด **หลังพิสูจน์ mailbox แล้วเท่านั้น** — ห้าม attach จากแค่ข้อมูลฟอร์ม.
- ห้ามเก็บ/ส่ง plaintext ทุกกรณี; `REJECTED`/`EXPIRED` ต้องลบ pendingPasswordHash และไม่ทิ้ง User กำพร้า.

### 4C. นโยบาย duplicate + คิวอนุมัติ

- **email ซ้ำได้โดยออกแบบ** — ความหมายคือคนเดิมเปิดหลายบริษัท: ถ้า email ตรง `User` ที่มีอยู่ (หรือมีคำขอ/บริษัทเดิมร่วม email) คิวแสดง hint "น่าจะเป็นบัญชีเดิม → จะ attach ตอน claim" ; การตัดสินใจจริงเกิดที่หน้า claim (§4B) ไม่ใช่ในคิว.
- **taxId ตรวจเฉพาะรายที่กรอก:** ถ้าชนบริษัทเดิมให้ติดธง review ห้ามระบบเดา.
- **ชื่อบริษัท/ร้านซ้ำกันได้เสมอ:** DB ไม่มี unique บน `Company.name` อยู่แล้ว — implementation ต้องตรวจว่า onboarding use-case/validator ไม่มี app-level unique-name check ขวางเส้นทางนี้; ใช้ taxId/email/จังหวัดเป็น review hints.
- คิว System Admin แสดงข้อมูลคำขอ + ผล MX + dedupe hints + ธง bounce + การ map `businessType` + offer/trial policy พร้อม Approve/Reject แบบ idempotent และ audit ทุก action.
- `PENDING_REVIEW` ค้างเกิน **24 ชม.** (ค่าเริ่มต้น ปรับได้) เตือนผ่าน dashboard-notifications.

### 4D. อีเมล การแจ้งผล และเส้นกู้คืน

- อีเมลของ flow นี้มี**ฉบับเดียว** = เมลอนุมัติ+ลิงก์ตั้งรหัส (§4B); ไม่มีเมลยืนยันแยก และไม่มีเมล "เปิดใช้แล้ว" แยกอีกฉบับ (หน้าสำเร็จทำหน้าที่นั้น).
- **Reject ค่าเริ่มต้น = เงียบ** (ไม่ส่งเมล เพราะอีเมลยังไม่พิสูจน์ — กันระบบกลายเป็นเครื่องยิงสแปมใส่เมลคนอื่น); แอดมินเลือก "ปฏิเสธพร้อมแจ้ง" ได้เป็นรายกรณี ข้อความไม่เปิดเหตุผลภายใน.
- เมลอนุมัติ bounce → state `EMAIL_FAILED` + ติดธงในคิว → แอดมินโทรตามด้วย `phoneNumber` จากฟอร์ม แล้วแก้อีเมล/ส่งใหม่ได้ (การแก้อีเมลบนคำขอ = audit + reset เป็น EMAIL_PENDING ใหม่).
- ผู้สมัครใช้รหัสที่ตั้งเอง ไม่ส่ง temporary password ทุกกรณี.
- **กรณีไม่มา claim (Owner 2026-08-30):** ① ก่อนลิงก์หมดอายุ 2 วัน ส่งเมลเตือน 1 ฉบับ exactly-once (ออก token ใหม่ revoke เก่า ตามกติกา mint-at-send) ② ลิงก์หมดอายุแล้วการอนุมัติ**ยังคงอยู่**: ผู้สมัครกด "ขอลิงก์ใหม่" จากหน้าเช็คสถานะ หรือแอดมิน resend จากคิว → กลับ `EMAIL_PENDING` พร้อม token ใหม่ ไม่ต้องยื่น/อนุมัติซ้ำ ③ คิวแสดงธง "อนุมัติแล้ว ยังไม่เริ่มใช้งาน N วัน" ให้โทรตามด้วยเบอร์จากฟอร์ม ④ เกิน **30 วันหลังอนุมัติ** (config ได้) โดยไม่มี claim → คำขอย้ายไปมุมมองพัก (พ้นคิวหลัก) แต่ **แอดมิน reissue ลิงก์ได้เสมอ ไม่มีทางตันให้สมัครใหม่** (Owner 2026-08-30: เขาสมัครแล้ว มีข้อมูลแล้ว — และในอนาคต paid tier อาจจ่ายเงินแล้ว); self-serve resend ของผู้สมัครจำกัดที่ 30 วันแรก หลังจากนั้นผ่านแอดมิน ⑤ นาฬิกา trial 30 วันเริ่มนับตอน **provision (หลัง claim)** ไม่ใช่ตอนอนุมัติ — มา claim ช้าไม่เสียวันใช้งาน (สอดคล้อง P29 T3).

### 4E. Paid branch ในอนาคต — **planned/disabled**

- Free เดิน `PENDING_REVIEW --approve--> PROVISIONING` และต้องไม่เรียก EasySlip.
- เมื่อ Owner เปิด paid offer และ P26 ผ่าน gate จึงเดิน `PENDING_REVIEW --approve paid--> PAYMENT_PENDING → PAYMENT_VERIFIED → PROVISIONING`; วางการชำระหลังอนุมัติเพื่อไม่รับเงินจากคำขอที่อาจถูก Reject.
- Backend snapshot offer version + ราคาเป็น satang แล้วแสดง K BIZ Thai QR ที่ล็อกยอด; EasySlip v2 ตรวจ receiver/amount/duplicate ตาม [Billing F-BILL-3](mangmee-billing-subscription-spec-th.md#billing-easyslip-v2). `transRef` claim ได้ครั้งเดียว และผล verify อย่างเดียวห้ามข้าม admin approval.
- รอบปัจจุบันไม่มี payment state/table/API/UI/config/secret/provider call; ส่วนนี้เป็น migration ของ P26 ไม่ใช่การรื้อ signup/email/idempotency core.

### 4F. ขั้น LINE บนหน้าสำเร็จ + กติกา merge (ใช้ P12 ที่ production แล้ว)

- หน้าสำเร็จหลัง provision: ปุ่ม "เชื่อมบัญชี LINE" (mobile = OAuth link P12-2; desktop = QR P12-3a) + ปุ่ม/QR "เพิ่มเพื่อน OA" (ลิงก์กลาง ไม่มี token ส่วนตัว); ข้ามได้ → state ค้าง `LINE_LINK_PENDING`, เชื่อมทีหลังจากหน้าตั้งค่า + แบนเนอร์เตือนในเว็บ; เมลอนุมัติแนบลิงก์เพิ่มเพื่อน OA กลางได้ตามกติกา P11.
- **LINE ชนบัญชีอื่น** (เช่น เป็นพนักงานอยู่แล้วแต่เผลอสร้างบัญชีใหม่): เสนอ 2 ทางเท่านั้น — **"รวมเข้าบัญชีเดิม"** (ย้าย membership บริษัทใหม่ไป User เดิม + ย้าย email; บัญชีใหม่ที่ว่างถูกปิดไม่ลบ audit) หรือ **"ไว้ก่อน"** (สองบัญชีอยู่ต่อ พร้อมข้อความบอกผลชัด: บริษัทใหม่ใช้ผ่านเว็บ+รหัสผ่าน, LINE ยังใช้กับงานบริษัทเดิมเท่านั้น, เปลี่ยนใจมารวมทีหลังได้); **ห้ามมีตัวเลือก "ย้าย LINE ออกจากบัญชีเดิม" ในจอนี้** — การย้ายต้องไปทำใน flow ตั้งค่าเดิมแบบตั้งใจ.
- ข้อเสนอ merge เด้งซ้ำทุกครั้งที่กดเชื่อมแล้วชน ไม่ใช่ครั้งเดียวทิ้ง.
- Scope ร่วมรอบนี้: ตัวเลือกบริษัท (web + LINE picker) ต้องแสดง **label บทบาท** ("เจ้าของ"/"พนักงานบัญชี"/…) ปิด gap ความงงจาก P13.
- Future (จดไว้ ไม่ทำรอบนี้): ฟอร์มเวอร์ชัน LIFF สำหรับคนสมัครจาก rich menu — รู้ตัวตน LINE ตั้งแต่กรอก เชื่อมอัตโนมัติไม่ต้องเห็นปุ่ม/QR; และ "ลิงก์เชิญพนักงาน" ให้พนักงานใหม่รับด้วยบัญชีเดิมได้ (ปิดเคสเจ้าของร้านไปเป็นพนักงานที่อื่น).

## 5. หน้าเว็บฝั่งผู้สมัคร (กติกา F-LED-7)

ตาม §13.6A + checklist ของ §13.6D ปรับเข้า Flow B: หน้าหลังกด submit บอกว่า "ได้รับคำขอแล้ว กำลังตรวจสอบ — เราจะส่งอีเมลเมื่ออนุมัติ" **ห้ามอ้างว่าสร้างบริษัทสำเร็จและห้ามสัญญาเวลาอนุมัติ**; หน้าเช็คสถานะ mapping ตรง state จริง (§3 allowlist) + ปุ่มขอส่งเมลตั้งรหัสซ้ำเมื่ออยู่ EMAIL_PENDING; ฟอร์ม mobile-first 390px ตามผู้ใช้จริง (ผู้ใช้ 40+, ปุ่ม/ฟอนต์ใหญ่)

ส่วนเลือก offer แสดงรายการตาม §3A (4 tier ชุด 2026-08-30): `PRO_TRIAL` เลือกได้; tier อื่นแสดงราคาแต่ control disabled + “เร็ว ๆ นี้”; ห้ามแสดง upload slip, payment pending หรือ payment success ใน flow ปัจจุบัน.

## 6. Gates/tests (ยกจากแผนหลัก §15 แถว "Official signup API" คำต่อคำ)

invalid/expired/replayed signature ถูกปฏิเสธ; same-request concurrency สร้าง signup/company/user/membership อย่างละหนึ่ง; key เดิม payload ต่าง 409; duplicate email/taxId deterministic; response ไม่มี secret; state/retry/audit ตรวจย้อนหลังได้ — ทุกข้อเป็น integration test บังคับ

## 7. สิ่งที่ไม่ทำ

ช่องทางสมัครอื่น (มือถือ app), การอนุมัติ partner หลายเจ้า (contract รองรับ `source` ไว้), SMS, payment runtime/การเก็บเงินจริง/การบังคับโควตา; ยกเว้น catalog แบบ display-only ใน §3A เพื่อเก็บทิศทางผลิตภัณฑ์

## 8. คำถาม Owner

1. ~~HMAC หรือ service JWT~~ → **ปิดแล้ว 2026-08-30 (§3):** ingress หลักเป็นหน้า public ในแอปเราเอง ไม่ต้องมี secret; signed API เลื่อนเป็น future
2. ~~Claim TTL/resend~~ → **ตอบแล้ว 2026-08-30 (§4B):** 7 วัน (ค่าเริ่มต้น ปรับได้); ผู้สมัคร resend เองจากหน้าเช็คสถานะแบบจำกัดความถี่; System Admin revoke/resend ได้จากคิว
3. ~~นโยบาย duplicate~~ → **ตอบแล้ว 2026-08-29 + ขยาย 2026-08-30 (§4C):** email ซ้ำได้ = คนเดิมหลายบริษัท attach ตอน claim; taxId ชนแล้ว review; ชื่อบริษัทซ้ำได้
4. ~~ลำดับ approve/claim + ข้อความ reject~~ → **ตอบแล้ว 2026-08-30 (§4, §4D):** Flow B; reject ค่าเริ่มต้นเงียบ + แอดมินเลือกแจ้งเป็นรายกรณี; SLA เตือนคิวเริ่มที่ 24 ชม.
5. **อัปเดต 2026-08-30 รอบสอง:** โควตา trial = PRO (5 สาขา · 10 คน · 100 ใบ/เดือน); ระยะเวลา = default 30 วันชั่วโมงจริง + ไม่ต่อ = disable บริษัท → กลไกทั้งหมดอยู่ [P29 Company Plan Term](mangmee-company-plan-term-spec-th.md) (provision ตอน approve ตั้ง preset PRO+30 วัน — P29 plan T3); ยังเปิด: นโยบาย "100 ร้านแรก", งบ AI ต่อเดือน
6. **ยังเปิด (block เฉพาะ email จริง):** SES operations ตาม P11 §5 ข้อ 1–2 — โดเมนผู้ส่ง (แนะนำ `no-reply@mangmeeplus.com`; DNS อยู่ Cloudflare ต้องให้ Owner วาง records หรือเปิดสิทธิ์), region (แนะนำ ap-southeast-1), สิทธิ์ IAM ให้ตั้งค่า SES + ขอออกจาก SES sandbox (AWS ใช้เวลา ~1 วัน)
