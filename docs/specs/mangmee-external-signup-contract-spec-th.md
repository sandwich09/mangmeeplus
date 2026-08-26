# Auto-register จากเว็บไซต์ทางการ (External Signup Contract) — Spec P10

สถานะ: DRAFT — กลไก/สัญญาครบ รอ Owner ตอบ §8 ก่อนเข้าคิว implement; แผนส่งมอบเขียนตอนเข้าคิว

ที่มา: [แผนหลัก P10 + §13.6](../plans/mangmee-brain-2-5-day-priority-plan-th.md) (flow, states, contract ขั้นต่ำ กำหนดไว้แล้วคำต่อคำ — spec นี้ยกมาเป็นทางการ + ผูกหลักฐานโค้ด); STOP-SHIP ที่ต้องปิด: SIGNUP-01, SIGNUP-02 (§13.3)

หลักฐานโค้ด `develop` (สำรวจ 2026-08-26)

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

## 2. หลักการที่ห้ามละเมิด

1. เว็บไซต์ทางการ**ห้ามเรียก System Admin browser API** ด้วย cookie/API key ถาวร — ต้องมี integration boundary แยก (§13.6)
2. Retry ทุกชนิดเดินต่อจาก state เดิม idempotent — **ห้ามสร้าง Company/User/Membership/email/LINE link ซ้ำ** (SIGNUP-01)
3. Default provision **หลัง** email claim สำเร็จ (กันบริษัทขยะ — SIGNUP-02); pre-approved partner ที่ provision ก่อนต้องใช้ state/idempotency ชุดเดียวกัน
4. ไม่มี temporary password และไม่มี QR account-link ส่วนตัวในอีเมล/response ใด ๆ (LINE-ONBOARD-01)
5. Provision ผ่าน onboarding application service เดิมเท่านั้น (กฎสร้างบริษัทชุดเดียว)

## 3. สัญญา (จาก §13.6C — ยกเป็นข้อกำหนดทางการ)

- `POST /v1/integrations/official/company-signups`
- Auth: HMAC (sha256 raw body ตามแบบ `line-webhook-verifier`) **หรือ** short-lived service JWT — เลือกที่ §8 ข้อ 1; + timestamp + nonce (กัน replay), secret rotation ได้
- Header idempotency: ใช้รูปแบบ repo = field ใน payload `externalSignupId` + DB `@@unique([externalSignupId])` บน `SignupRequest` (แบบ `schema.prisma:3812`) — ไม่ประดิษฐ์ middleware ใหม่
- Payload ขั้นต่ำ: `externalSignupId, companyName, taxId?, ownerDisplayName, contactEmail, consentVersion, referralCode?, requestedPackage (จาก BillingPackage ของ P26)`; DTO ทุกช่อง bounded/pattern ตามแบบ customer-register
- ตอบ `202 { requestId }` เสมอ — ไม่มีการยืนยันสร้างบริษัทก่อน durable state; ไม่มี secret ใด ๆ ใน response
- request เดิม+payload เดิม → ผลเดิม; key เดิม+payload ต่าง → `409`; email/taxId/externalSignupId ชนของเดิม → deterministic attach/review policy (ห้ามเดาจากชื่อบริษัท)
- Rate limit: bucket ใหม่ `official-signup-ip` + `official-signup-email` (normalize lowercase ตามแบบ L-06) — fail-closed; abuse: schema allowlist + audit `source='official-site'`
- Status: `GET /v1/integrations/official/company-signups/:requestId` (signed เช่นกัน) คืน state ปัจจุบันเท่านั้น

## 4. Durable state (ตาราง `CompanySignupRequest` ใหม่)

State ตาม §13.6 คำต่อคำ: `RECEIVED → VALIDATED → EMAIL_PENDING → EMAIL_VERIFIED → PROVISIONING → READY → LINE_LINK_PENDING → COMPLETED` + ข้างเคียง `EMAIL_FAILED / PROVISIONING_FAILED / SUSPENDED / EXPIRED`; ทุก transition append audit; email ส่งผ่าน outbox (P11); provisioning เรียก `CreateCompanyOnboardingUseCase` เดิม **ครั้งเดียว** โดยผูก `signupRequestId` กันซ้ำ

## 5. หน้าเว็บฝั่งผู้สมัคร (กติกา F-LED-7)

ตาม §13.6A ขั้น 1–2 + checklist 3 ขั้นของ §13.6D: หน้า "กรุณาตรวจอีเมล" ห้ามอ้างว่าสร้างบริษัทสำเร็จ; ทุกข้อความสถานะ mapping ตรงกับ state จริง

## 6. Gates/tests (ยกจากแผนหลัก §15 แถว "Official signup API" คำต่อคำ)

invalid/expired/replayed signature ถูกปฏิเสธ; same-request concurrency สร้าง signup/company/user/membership อย่างละหนึ่ง; key เดิม payload ต่าง 409; duplicate email/taxId deterministic; response ไม่มี secret; state/retry/audit ตรวจย้อนหลังได้ — ทุกข้อเป็น integration test บังคับ

## 7. สิ่งที่ไม่ทำ

ช่องทางสมัครอื่น (มือถือ app), การอนุมัติ partner หลายเจ้า (contract รองรับ `source` ไว้), SMS

## 8. คำถาม Owner (จาก §11 แผนหลักข้อ 7–8 ที่ยังไม่ตอบ)

1. เว็บไซต์ทางการถือ secret ได้ไหม → เลือก **HMAC** (ถือ secret ฝั่งเว็บ) หรือ **service JWT** (ออกจาก identity กลาง)
2. Claim link หมดอายุกี่ชั่วโมง (แนะนำ 24 ชม. — สั้นกว่า 72 ชม.ของ temp password ภายใน) และใครมีสิทธิ์ resend/revoke
3. นโยบายชน taxId ของบริษัทที่มีอยู่: attach ให้ Owner เดิม (ต้อง verify อย่างไร) หรือส่ง review คิว Admin
