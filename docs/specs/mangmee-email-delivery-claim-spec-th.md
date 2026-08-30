# Email Delivery และ Claim Account — Spec P11

สถานะ: **PARTIAL — Phase 0 disabled-safe provider foundation MERGED DEVELOP `d8d9808e` ผ่าน PR #290** (2026-08-27T05:08:55Z); exact-head CI `33040896057` SUCCESS บน `6f85339d`. Phase 1 durable claim send ปลดล็อกแล้ว (secret-lifecycle ตัดสินเป็น mint-at-send — §5 ข้อ 3, 2026-08-30) และปรับเข้า P10 Flow B; live delivery ยังรอ Owner/operations §5 ข้อ 1–2. ดู [แผน P11](../plans/mangmee-email-delivery-claim-plan-th.md); ไม่ใช่การเปิด email/claim หรือปิด EMAIL-01.

ที่มา: [แผนหลัก P11 + §13.6](../plans/mangmee-brain-2-5-day-priority-plan-th.md); STOP-SHIP: EMAIL-01 (§13.3); AUTH-02 (credential ชุดเดียว) บังคับกับหน้า claim

หลักฐานฐานโค้ดสำรวจ 2026-08-26; ผลส่ง Phase 0 ยืนยัน 2026-08-27

## 1. Current truth

| ข้อเท็จจริง | หลักฐาน |
|---|---|
| develop รองรับ `EMAIL_PROVIDER: disabled/local-console/ses` โดย default disabled; production ปฏิเสธ console และบังคับ `SES_REGION`/`SES_FROM_ADDRESS`/explicit `WEB_BASE_URL` เมื่อเลือก ses | `packages/config/src/index.ts`; provider factory ใน `auth.module.ts` |
| PR290 นำเฉพาะ provider/config/dependency จาก `ec03bc6f` พร้อม explicit frontend-base hardening มารวม; ไม่ merge P9/P10 stack ของ PR272 และไม่เปิด provider | `auth.module.ts`; [PR290](https://github.com/MangmeeDev/mangmeeplus/pull/290) |
| Port เดิมมี verify/reset; Phase 0 เพิ่ม `sendAccountClaim` แบบ additive แต่ยังไม่มี production caller/claim route/outbox producer | `auth-mailer.port.ts`; adapters ใน `auth/infrastructure` |
| ADR-0009 Accepted: `disabled` เป็น no-op แท้ทุก env; "shipping without real delivery is a fully valid, secure state" | `docs/adr/0009-auth-security-email-delivery.md` |
| Token pattern สำเร็จรูป: reset token single-use + atomic claim + TTL 30 นาที + ขอใหม่ revoke ของเก่า + reset สำเร็จ revoke ทุก session อื่น + audit HIGH fail-closed | forgot-password-reset-spec :78-81,:120 (backend use-cases park อยู่ใน `auth.module.ts:58-59` ไม่มี route — ตาม password-reset-line-flow decision 5) |
| `User.email` ไม่มีใครเขียนตอนสร้างบัญชี; ความ eligible ผูก `emailVerifiedAt` เท่านั้น | forgot-password spec :27,:77 (ยืนยันกับโค้ดแล้ว) |
| Outbox durable ใช้ได้กับ email (companyId nullable) แต่ `NotificationChannel = { WEB, LINE }` — **ไม่มี EMAIL** และ workers ไม่มี email adapter | `schema.prisma:917-946,1225-1228`; `notification-delivery-adapters.ts` |
| Gotcha ภายใน: `regenerate-temporary-password` **หมุนรหัสเสมอ** (ล็อก Owner ที่ตั้งรหัสถาวรแล้วได้) — จึงมี `reissue-owner-line-link` เป็น QR-only escape (audit CRITICAL) | `regenerate-temporary-password.use-case.ts:24-68`; `reissue-owner-line-link.use-case.ts:16-68` |
| ฐานเดิมเลือก console ใน local แม้ provider เป็น `disabled`; Phase 0 แก้แล้วให้ disabled ไม่ส่ง/ไม่ log และ console ต้อง opt-in | `auth.module.ts` provider factory |
| Account email change/resend มี route และเรียก mailer อยู่แล้ว; หากเปิด SES ภายหลังจะเริ่มส่ง verification mail ได้ทันที ไม่ใช่แค่เตรียม claim | `auth.controller.ts` account/email + account/email/resend; request/resend-email-verification use-cases |
| Durable claim link ยังตัดสินไม่ได้: generic outbox redact key ที่มี `token` แต่ claim ต้อง hash-only; ห้ามเปลี่ยนชื่อ field เพื่อซ่อน raw secret | `outbox.logic.ts`; §2 และ §5 ข้อ 3 |

### 1.1 Acceptance เฉพาะ Phase 0

- ค่าเริ่มต้นและ runtime config คง `EMAIL_PROVIDER=disabled`: ทุก environment ไม่ส่งและไม่ log raw auth link/token.
- Console ใช้ได้เฉพาะ explicit `EMAIL_PROVIDER=local-console` + `APP_ENV=local`; non-local factory/production validation ต้องปฏิเสธ.
- SES factory ปฏิเสธ region/from/explicit `WEB_BASE_URL` ที่ขาด; getter `sesWebBaseUrl` ต้องไม่ fallback ไป `PUBLIC_BASE_URL` ซึ่งเป็น API origin. Production validation บังคับ WEB_BASE_URL เมื่อเลือก ses; general `webBaseUrl`/local console คง fallback เดิม. Adapter ตรวจ HTTPS ก่อนส่ง (ไม่อ้างว่า HTTPS ถูกตรวจตั้งแต่ boot), escape HTML และ propagate provider error.
- Verify/reset/claim template ใช้ UTF-8 text+HTML; claim มีเฉพาะ service/company/recipient, link, expiry และ OA Add URL กลางบน official LINE host ไม่มี temporary password/tax ID/password hash/personal QR.
- มี local provider/config regression, current-base API/config typecheck, DI boot แบบ disabled และ complete synthetic SES config โดยไม่ส่ง mail; maintenance pins ต้องตรงโค้ดที่รีวิว.
- ไม่เพิ่ม schema/migration, signup event, outbox consumer, claim route/page หรือ provider activation. ผลทดสอบ Phase 0 ไม่ใช่หลักฐาน inbox/DKIM/bounce/complaint.

หลักฐาน current-base 2026-08-27 หลัง explicit-frontend follow-up: auth/reset 44/44 (provider 6/6) + DI/spec registration 6/6 รวม 50/50, config 138/138, API/config typecheck และ config/contracts/API build ผ่าน. Deny-network DI boot 4 cases ยืนยัน default disabled/complete synthetic SES บูตได้ แต่ missing/empty WEB_BASE_URL แม้มี PUBLIC_BASE_URL บูตไม่ผ่าน; ไม่มี network attempts. Root default API หลัง follow-up บน `11153296`: 5325 ผ่าน/5423 ทั้งหมด, skipped98; pretest16/30, skipped14; ไม่มี failure ไม่อ้าง skipped เป็น integration pass. Root source review, maintenance pin check + generator/validator regression ผ่าน; exact-head CI `33040896057` SUCCESS ก่อน merge PR290. รายละเอียดคำสั่ง/ข้อจำกัดอยู่ใน [task memory](../agent-memory/p11-email-provider-foundation.md); ไม่ใช่ live email acceptance.

## 2. หลักการที่ห้ามละเมิด

1. อีเมลมีแค่: ชื่อบริการ, email/ชื่อบริษัทที่สมัคร, **claim link ครั้งเดียว + เวลาหมดอายุ**, OA Add link กลาง — **ห้ามมี temporary password, QR token ส่วนตัว, tax data** (§13.6)
2. Claim token: เก็บเฉพาะ hash, single-use (atomic claim ตามแบบ `EmployeeLineLinkToken` H-09), replay-safe
3. หน้า claim ตั้งรหัสผ่าน **`UserCredential` ชุดเดียวกับเว็บ/LIFF** ผ่าน use-case เปลี่ยนรหัสเดิม (AUTH-02) + ตั้ง `mustChangePassword=false` + ลบสำเนา temp + revoke session ตาม policy (กฎ §13.6C)
4. Email fail → retry ผ่าน outbox; **signup/company ที่ transaction สำเร็จแล้วห้าม rollback เพราะ email provider ล่ม** (§13.6 contract)
5. ข้อความหน้า claim ต้องบอกชัด: "รหัสนี้ใช้เข้าเว็บ Mangmee ... ไม่ใช่รหัสผ่านของ LINE" (§13.6D)

## 3. ขอบเขต

### F-EM-1 SES adapter + boot state ที่สาม

- Implement `SesAuthMailerAdapter` (พอร์ตเดิม 2 method + method ใหม่ `sendAccountClaim` — ขยาย port แบบ additive) ด้วย AWS SDK v3 (มี `@aws-sdk` ใช้อยู่แล้วใน gateway — ตรวจ dependency ตอน implement ตามกติกา no-new-dep)
- Factory: `disabled → noop`, explicit local-only `local-console → console`, `ses → SesAdapter` (แทน throw); production validation คุม region/from/explicit frontend WEB_BASE_URL และ factory คุม config ที่ขาด โดยไม่ใช้ API-origin fallback สำหรับ SES
- Sender identity ต้องยืนยันโดเมนและตั้ง SPF/DKIM/DMARC; ใช้ SES configuration set แยก transactional claim mail และส่ง delivery/bounce/complaint event ไป consumer ที่ durable — หลักฐาน live คือ inbox + authentication result + event round-trip ไม่ใช่แค่ API ตอบ 2xx

### F-EM-2 Durable send ผ่าน outbox

- Event `email.account_claim.requested` (companyId null ได้) → consumer ใหม่ (workers) เรียก adapter; retry/backoff/DEAD ตาม outbox กลไกเดิม; `eventKey` = `email:claim:<signupRequestId>` กันส่งซ้ำ
- Bounce/complaint: SES event destination เขียนสถานะกลับ `CompanySignupRequest.EMAIL_FAILED`, เพิ่ม address ลง suppression policy ของบัญชีเมื่อเข้าเงื่อนไข, และโชว์ใน System Admin (ตาม §13.4 ข้อ 3 "แสดงว่าอีเมลส่งแล้ว/ตีกลับ/รอ retry"); ห้าม retry hard bounce/complaint แบบไม่จำกัด

### F-EM-3 Claim flow — **อัปเดตตาม P10 Flow B (Owner 2026-08-30)**

- เมล claim ส่ง **หลัง System Admin อนุมัติเท่านั้น** (P10 state `PENDING_REVIEW → EMAIL_PENDING`) และเป็นอีเมล**ฉบับเดียว**ของ flow — ไม่มีเมลยืนยันแยกก่อนคิว และไม่มีเมล "เปิดใช้แล้ว" แยกอีกฉบับ
- **Token mint-at-send (Owner รับข้อเสนอ 2026-08-30 — ปิด §5 ข้อ 3):** outbox event `email.account_claim.requested` พก `signupRequestId` เท่านั้น ไม่มี token; consumer ใน workers เป็นผู้มินท์ token ตอนจะส่งจริง → เขียน hash ลง `AccountClaimToken` → ประกอบ raw link ใส่เมลครั้งเดียวแล้วทิ้ง — raw token ไม่เคยแตะ DB/outbox/log; retry หรือ resend = มินท์ใหม่ + revoke เก่า
- ตาราง `AccountClaimToken` (hash unique, TTL **7 วัน** — ค่าเริ่มต้นที่ Owner รับ 2026-08-30 ปรับได้, single-use atomic claim H-09, ขอใหม่ revoke เก่า — กติกาเดียวกับ reset token)
- Token ที่หมดอายุ ใช้ไปแล้ว หรือไม่รู้จัก (expired/used/unknown) ต้องตอบข้อความ public ทั่วไปเดียวกัน; Phase 2 acceptance ต้องตรวจทั้งสามกรณี ตาม [canonical plan เดิม:37](https://github.com/MangmeeDev/mangmeeplus/blob/384d72a5720a58efde943831124e85765ebbc5cb/docs/plans/mangmee-email-delivery-claim-plan-th.md#L37). เป็นข้อกำหนดเดิม ไม่เลือก TTL/token representation หรือเปิด route ใหม่.
- หน้า claim (public, CSP/no-store ตามแบบ LIFF pages): ยืนยัน email (`emailVerifiedAt` เขียนที่นี่ — จุดแรกที่ระบบเขียน email อย่างเป็นทางการ) → **ทางแยกบังคับถาม "มีบัญชีอยู่แล้วหรือยัง"** ตาม P10 §4B: ยังไม่มี → ตั้งรหัส (policy เดิม); มีแล้ว → login ด้วยรหัสเดิม/LINE แล้ว attach บริษัทใหม่เข้าบัญชีเดิมโดยไม่ตั้งรหัส → provision (P10 state PROVISIONING→READY) → success + ปุ่ม "เพิ่มเพื่อนและเชื่อม LINE" (P12 — กติกา merge เมื่อ LINE ชนบัญชีอื่นอยู่ที่ P10 §4F)
- Claim ใช้กับ onboarding ภายในด้วย (PLATFORM-02: เปลี่ยน handoff จาก copy รหัสเป็น claim link) — admin flow เดิมคงอยู่เป็น fallback

## 4. Gates/tests (ยกจาก §15 แถว Email/Claim คำต่อคำ)

SES delivery ถึง inbox ทดสอบ, DKIM ผ่าน, bounce/complaint ถูกบันทึก; outbox retry ไม่ส่ง claim ซ้ำ; claim hash-only/single-use/expiry/replay/concurrency ผ่าน; email ไม่มี temporary password หรือ personal LINE token; + AUTH-02 contract test: ตั้งรหัสจาก claim แล้ว login เว็บและ LIFF ได้ทันที

## 5. คำถาม Owner

1. **ยังเปิด (บล็อก live delivery):** โดเมนผู้ส่ง (`SES_FROM_ADDRESS`) — แนะนำ `no-reply@mangmeeplus.com`; ข้อเท็จจริง 2026-08-30: DNS ของ mangmeeplus.com อยู่ **Cloudflare** (ไม่ใช่ Route53) → Owner ต้องวาง DKIM/SPF/DMARC records เองหรือเปิดทางให้ทำแทน
2. **ยังเปิด (บล็อก live delivery):** SES region — แนะนำ ap-southeast-1; ข้อเท็จจริง 2026-08-30: IAM user ฝั่ง dev ไม่มีสิทธิ์ SES ใด ๆ (ยังไม่เคยตั้งค่า SES ในบัญชี = ยังอยู่ sandbox) → ต้องเพิ่มสิทธิ์หรือ Owner กด console ตามขั้นตอน + ยื่นขอ production access (AWS ใช้เวลา ~1 วัน) — ควรเริ่มก่อนงานโค้ดเสร็จ
3. ~~กลไกกัน raw token ใน outbox~~ → **ตอบแล้ว 2026-08-30 (F-EM-3):** consumer mint-at-send, event พกแค่ `signupRequestId`, hash-only คงเดิม, resend = มินท์ใหม่+revoke เก่า
4. ~~Claim TTL / สิทธิ์ resend-revoke~~ → **ตอบแล้ว 2026-08-30 (F-EM-3 + P10 §4B/§8):** 7 วัน; ผู้สมัคร resend จากหน้าเช็คสถานะ (จำกัดความถี่); System Admin resend/revoke จากคิว; ไม่ยืม TTL ของ reset/verify

## 6. หลักฐานภายนอกที่ต้องตรวจซ้ำตอน implement

- [AWS SES — configuring identities](https://docs.aws.amazon.com/en_en/ses/latest/dg/configure-identities.html): sender authentication ครอบ SPF, DKIM และ DMARC
- [AWS SES — configuration sets](https://docs.aws.amazon.com/en_en/ses/latest/dg/using-configuration-sets.html): ผูก configuration set กับ identity/header และ event destinations
- [AWS SES — account-level suppression](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_PutAccountSuppressionAttributes.html): suppression reason เป็น `BOUNCE`/`COMPLAINT`; config production ต้องมี test ยืนยัน policy จริง
