# Email Delivery และ Claim Account — Spec P11

สถานะ: DRAFT — รอเข้าคิว implement คู่กับ P10; แผนส่งมอบเขียนตอนเข้าคิว

ที่มา: [แผนหลัก P11 + §13.6](../plans/mangmee-brain-2-5-day-priority-plan-th.md); STOP-SHIP: EMAIL-01 (§13.3); AUTH-02 (credential ชุดเดียว) บังคับกับหน้า claim

หลักฐานโค้ด `develop` (สำรวจ 2026-08-26)

## 1. Current truth

| ข้อเท็จจริง | หลักฐาน |
|---|---|
| Config พร้อมแล้ว: `EMAIL_PROVIDER: enum(['disabled','ses'])` + production บังคับ `SES_REGION`/`SES_FROM_ADDRESS` เมื่อเลือก ses | `packages/config/src/index.ts:313-315,763-765` |
| **`EMAIL_PROVIDER=ses` = API ไม่ boot**: provider factory `throw` ตอนสร้าง DI container ("not implemented yet") — ตรงตาม EMAIL-01 | `auth.module.ts:73-86` |
| Port มีอยู่และแคบ: `AuthMailerPort` มี 2 method (`sendEmailVerification`, `sendPasswordResetLink`) + adapter `disabled`/`local-console`; **SES adapter NOT FOUND** | `auth-mailer.port.ts`; `disabled-auth-mailer.adapter.ts`; `local-console-auth-mailer.adapter.ts` |
| ADR-0009 Accepted: `disabled` เป็น no-op แท้ทุก env; "shipping without real delivery is a fully valid, secure state" | `docs/adr/0009-auth-security-email-delivery.md` |
| Token pattern สำเร็จรูป: reset token single-use + atomic claim + TTL 30 นาที + ขอใหม่ revoke ของเก่า + reset สำเร็จ revoke ทุก session อื่น + audit HIGH fail-closed | forgot-password-reset-spec :78-81,:120 (backend use-cases park อยู่ใน `auth.module.ts:58-59` ไม่มี route — ตาม password-reset-line-flow decision 5) |
| `User.email` ไม่มีใครเขียนตอนสร้างบัญชี; ความ eligible ผูก `emailVerifiedAt` เท่านั้น | forgot-password spec :27,:77 (ยืนยันกับโค้ดแล้ว) |
| Outbox durable ใช้ได้กับ email (companyId nullable) แต่ `NotificationChannel = { WEB, LINE }` — **ไม่มี EMAIL** และ workers ไม่มี email adapter | `schema.prisma:917-946,1225-1228`; `notification-delivery-adapters.ts` |
| Gotcha ภายใน: `regenerate-temporary-password` **หมุนรหัสเสมอ** (ล็อก Owner ที่ตั้งรหัสถาวรแล้วได้) — จึงมี `reissue-owner-line-link` เป็น QR-only escape (audit CRITICAL) | `regenerate-temporary-password.use-case.ts:24-68`; `reissue-owner-line-link.use-case.ts:16-68` |

## 2. หลักการที่ห้ามละเมิด

1. อีเมลมีแค่: ชื่อบริการ, email/ชื่อบริษัทที่สมัคร, **claim link ครั้งเดียว + เวลาหมดอายุ**, OA Add link กลาง — **ห้ามมี temporary password, QR token ส่วนตัว, tax data** (§13.6)
2. Claim token: เก็บเฉพาะ hash, single-use (atomic claim ตามแบบ `EmployeeLineLinkToken` H-09), replay-safe
3. หน้า claim ตั้งรหัสผ่าน **`UserCredential` ชุดเดียวกับเว็บ/LIFF** ผ่าน use-case เปลี่ยนรหัสเดิม (AUTH-02) + ตั้ง `mustChangePassword=false` + ลบสำเนา temp + revoke session ตาม policy (กฎ §13.6C)
4. Email fail → retry ผ่าน outbox; **signup/company ที่ transaction สำเร็จแล้วห้าม rollback เพราะ email provider ล่ม** (§13.6 contract)
5. ข้อความหน้า claim ต้องบอกชัด: "รหัสนี้ใช้เข้าเว็บ Mangmee ... ไม่ใช่รหัสผ่านของ LINE" (§13.6D)

## 3. ขอบเขต

### F-EM-1 SES adapter + boot state ที่สาม

- Implement `SesAuthMailerAdapter` (พอร์ตเดิม 2 method + method ใหม่ `sendAccountClaim` — ขยาย port แบบ additive) ด้วย AWS SDK v3 (มี `@aws-sdk` ใช้อยู่แล้วใน gateway — ตรวจ dependency ตอน implement ตามกติกา no-new-dep)
- Factory: `disabled → noop`, `local → console`, `ses → SesAdapter` (แทน throw); production validation เดิมคุม region/from
- DKIM/SPF: งาน infra + หลักฐาน delivery ถึง inbox ทดสอบ (gate §15 แถว Email/Claim)

### F-EM-2 Durable send ผ่าน outbox

- Event `email.account_claim.requested` (companyId null ได้) → consumer ใหม่ (workers) เรียก adapter; retry/backoff/DEAD ตาม outbox กลไกเดิม; `eventKey` = `email:claim:<signupRequestId>` กันส่งซ้ำ
- Bounce/complaint: SES notification (SNS→endpoint หรือ poll) เขียนสถานะกลับ `CompanySignupRequest.EMAIL_FAILED` + โชว์ใน System Admin (ตาม §13.4 ข้อ 3 "แสดงว่าอีเมลส่งแล้ว/ตีกลับ/รอ retry")

### F-EM-3 Claim flow

- ตาราง `AccountClaimToken` (hash unique, TTL จาก §8 ของ P10 spec, single-use atomic claim H-09, ขอใหม่ revoke เก่า — กติกาเดียวกับ reset token)
- หน้า claim (public, CSP/no-store ตามแบบ LIFF pages): ยืนยัน email (`emailVerifiedAt` เขียนที่นี่ — จุดแรกที่ระบบเขียน email อย่างเป็นทางการ) → ตั้งรหัส (policy เดิม) → provision (P10 state PROVISIONING→READY) → success + ปุ่ม "เพิ่มเพื่อนและเชื่อม LINE" (ต่อ P12)
- Claim ใช้กับ onboarding ภายในด้วย (PLATFORM-02: เปลี่ยน handoff จาก copy รหัสเป็น claim link) — admin flow เดิมคงอยู่เป็น fallback

## 4. Gates/tests (ยกจาก §15 แถว Email/Claim คำต่อคำ)

SES delivery ถึง inbox ทดสอบ, DKIM ผ่าน, bounce/complaint ถูกบันทึก; outbox retry ไม่ส่ง claim ซ้ำ; claim hash-only/single-use/expiry/replay/concurrency ผ่าน; email ไม่มี temporary password หรือ personal LINE token; + AUTH-02 contract test: ตั้งรหัสจาก claim แล้ว login เว็บและ LIFF ได้ทันที

## 5. คำถาม Owner

1. โดเมนผู้ส่ง (`SES_FROM_ADDRESS`) ใช้โดเมนไหน ใครถือ DNS (ต้องตั้ง DKIM)
2. SES อยู่ region ไหน (แนะนำ ap-southeast-1 ใกล้ผู้ใช้)
