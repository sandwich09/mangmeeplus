# แผนส่งมอบ Auto-register จากเว็บไซต์ทางการ — P10

สถานะ: **P10-0 เสร็จและ verify บน local; P10-1 เป็นต้นไปรอ Owner decisions ใน spec §8**

Source of truth: [External Signup Contract Spec](../specs/mangmee-external-signup-contract-spec-th.md)

## เป้าหมายและเส้นแบ่ง

รับคำขอจากเว็บไซต์ให้เป็น durable state ก่อนทำ side effect, retry ได้โดยไม่สร้าง Company/User/Membership ซ้ำ และ provision หลัง email claim สำเร็จเท่านั้น งานนี้ไม่ให้ package/offer เปิด entitlement และไม่รวม subscription/payment

Public API ต้องยังไม่มีจน auth, replay window และ duplicate identity policy ถูกตัดสินครบ การมี core provider ใน DI ไม่เท่ากับเปิด feature

## Phase 0 — Durable core (เสร็จ)

- [x] เพิ่ม `CompanySignupRequest` + state/version + unique `externalSignupId` และ provisioning attempt fence แบบ additive migration
- [x] normalize email/tax ID และ hash canonical payload ก่อน idempotency comparison
- [x] same key/same payload replay; same key/different payload `409`
- [x] transaction advisory lock + unique constraint สำหรับ concurrent receive; version CAS สำหรับ transition
- [x] explicit state graph รวม retry จาก `EMAIL_FAILED` และ `PROVISIONING_FAILED`
- [x] one-winner provisioning claim, attempt-fenced complete/fail และบันทึกเวลาเริ่มเพื่อ reconcile unknown outcome
- [x] append audit/outbox ทุก durable transition โดย evidence payload ไม่มี PII
- [x] module ไม่มี controller/public route

Gate: Prisma validate/generate/migration deploy/status, focused test, full API test/typecheck/boot และ real-PostgreSQL concurrency smoke ต้องผ่าน

## Phase 1 — Signed official-site ingress (BLOCKED)

ต้องได้ Owner decision เรื่อง HMAC หรือ service JWT ก่อน แล้วจึงทำ:

- DTO allowlist/bounds, raw-body signature หรือ JWT audience/issuer, timestamp skew และ nonce single-use
- fail-closed rate limit แยก IP/email โดย key ที่ไม่เก็บ email ดิบใน telemetry
- `POST` ตอบ `202 { requestId }` และ signed `GET` คืน state ที่ allowlist เท่านั้น
- secret rotation, invalid/expired/replayed signature tests และ response-secret scan

ห้าม reuse System Admin cookie/API key และห้ามเปิด route แบบชั่วคราวระหว่างรอคำตอบ

## Phase 2 — Validation และ identity collision (BLOCKED)

ต้องได้ Owner decision เรื่อง email/tax-ID collision และ `businessCategory` ก่อน:

- exact external key ใช้ idempotency; normalized email/tax ID ใช้ deterministic attach/review เท่านั้น
- name similarity ไม่สร้าง/attach/merge อัตโนมัติ
- persist review reason/state โดยไม่รั่ว PII ใน audit/metric
- integration tests สำหรับ existing user, existing company tax ID, concurrent collision และ deny path

## Phase 3 — Email-verified provisioning (ขึ้นกับ P11)

- P11 สร้าง/ยืนยัน owner credential ก่อน; ไม่มี temporary password
- adapter เรียก onboarding application boundary เดิมเฉพาะผู้ถือ provisioning claim
- ผูก `signupRequestId`/attempt กับผล Company+Owner และ complete durable state แบบ idempotent
- unknown outcome ที่ค้าง `PROVISIONING` ต้อง reconcile ผลเดิมก่อน retry; ห้าม blind retry สร้างบริษัทซ้ำ
- provider email ล่มเปลี่ยนเฉพาะ email state/outbox; ห้าม rollback signup/company ที่ commit แล้ว

Gate: same-request concurrency ต้องมี Company/User/Membership อย่างละหนึ่ง, stale worker mutate ไม่ได้, audit/source refs ครบ และไม่มี secret ใน response/log

## Phase 4 — Journey/rollout (ขึ้นกับ P12/P9/P25)

- หน้า “กรุณาตรวจอีเมล” และ status mapping ตาม durable state; ข้อความ/ปุ่มขนาดเหมาะกับผู้ใช้ 40+
- success → OA กลาง/LIFF handoff โดยไม่ส่ง password หรือ personal QR ใน email
- desktop 1440×900 และ mobile 390×844: keyboard/focus/loading/error/expired/resend path ไม่มี overflow หรือ console error
- ผูก P9 funnel/alarms และรัน P25/UAT gate ก่อนเปิด Marketing; external-signup flag คง OFF จนหลักฐานครบ

## Verification evidence P10-0 (2026-08-26)

- Prisma: format/validate/generate ผ่าน; migration `20260826200000_external_signup_core` apply สำเร็จ; local DB 151 migrations up to date และ apply ทั้ง 151 migrations จากฐานว่างได้ (`151|1|1` = applied/type/table); ลบฐานทดสอบชั่วคราวแล้ว
- Focused Node test: normalization/hash/state, idempotency conflict/replay, mocked 8-way receive + 6-way claim, retry/fencing, PII-free audit/outbox ผ่าน
- Real PostgreSQL: 16 receive calls → 1 durable row; 8 claims → 1 winner; stale attempt ถูกปฏิเสธ; 8 audit + 8 outbox unique; evidence ไม่มี PII
- Regression: full API test, API typecheck และ DI boot smoke ผ่าน (`Nest resolved every provider`)
- UI/browser: N/A ใน Phase 0 เพราะไม่มี route/page/public behavior เปลี่ยน; ใช้ API boot regression แทน
