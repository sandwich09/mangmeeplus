# แผนส่งมอบ Auto-register จากเว็บไซต์ทางการ — P10

> **Implementation update 2026-09-14 — IN PROGRESS:** actual Next/Nest/PostgreSQL/Chromium + isolated marketing ผ่าน158กลุ่มกับ Stripe/Postmark/LINE จำลอง รวมAdminกู้สิทธิ์จากใบเสร็จเดิมที่เลือกและตรวจeventตกหล่น. สมัครเว็บ8และยืนยันอีเมล6เป็นหลักฐานแยก ไม่รวมใน158. API/web typechecks, billing/DTO29, PostgreSQL35ผ่าน. Root CI34801493799(7ca2d7a8)ผ่าน; รอบ34803284452(6da65148)ติดจังหวะlegal redirectในsignup fixture ซึ่งแก้และรันsignup8ผ่านแล้ว รอCIใหม่ของโค้ดรอบนี้. Marketing CI34802725764(0cd88eb)ผ่าน. Controls/fullsignup/fullLINE/mailยังมีงานค้าง; email password recoveryรอOwner. Receipt-only HIDDEN/Enterprise Coming soon; ยังไม่merge/deploy. ดู[หลักฐาน](../evidence/billing-integration-2026-09-13/README.md).

> **Package amendment 2026-09-11:** [สิทธิ์/ราคา/7เมนู default](../specs/mangmee-package-entitlements-spec-th.md) และ [PE-S0–S5 / PE01–PE36](mangmee-package-entitlements-plan-th.md) เป็นข้อกำหนดล่าสุด: สมัครอย่างเดียวได้ starter7เมนู + FREE_TRIAL_15 (1สาขา/ผู้ใช้รวม2คน/15ใบต่อเดือน/30วัน) ไม่ผูกบัตร; paid รองรับ month/year ตามรูป; มติ2026-09-13ให้ annual quota12เท่าทันทีและซื้อแพ็กเกจเต็มซ้ำต่ออายุจากวันเดิม. Trial/manualคงโควตารายเดือนเดิม. ENTERPRISE_1999 ทั้งเดือน/ปี + ภ.ง.ด.53/50ทวิ Coming soon ห้ามจ่าย; ไม่กระทบ PRO_999. B01/B02/B09 ตัดสินแล้วเฉพาะขอบเขตนี้; นโยบายอื่นคงเดิม. Full spec/native provider acceptance ยังไม่ครบ; local simulated browser/HTTP checkpoint ดูหลักฐาน integration ล่าสุด ไม่ใช้แทน native provider acceptance.

สถานะ: **Slice A+B+C IMPLEMENTED บน branch `codex/auto-register-round1` (2026-08-30, Opus implements / Fable supervises+integrates); flag `EXTERNAL_SIGNUP_ENABLED` ปิดทุก env; Slice D (SES ops) รอ Owner ตาม [runbook](../runbooks/ses-email-setup.md); Slice E รอ SES + UAT ตาม [test plan](mangmee-auto-register-uat-test-plan-th.md)**

Source of truth: [External Signup Contract Spec](../specs/mangmee-external-signup-contract-spec-th.md) (Flow B) + [Email Delivery/Claim Spec P11](../specs/mangmee-email-delivery-claim-spec-th.md)

## เป้าหมายและเส้นแบ่ง

รับคำขอจากหน้า public ในแอปให้เป็น durable state ก่อนทำ side effect, retry ได้โดยไม่สร้าง Company/User/Membership ซ้ำ, ลำดับด่าน = **System Admin อนุมัติ → email claim → provision** และอีเมลออกฉบับเดียวเฉพาะรายที่อนุมัติ งานนี้ไม่ให้ package/offer เปิด entitlement, ไม่รวม subscription/payment, และไม่บังคับโควตา trial (P26)

## Phase 0 — Durable core (เสร็จ — หลักฐานท้ายไฟล์)

- [x] `CompanySignupRequest` + state/version + unique `externalSignupId` + provisioning attempt fence
- [x] normalize/hash payload, idempotency replay/409, advisory lock + CAS, one-winner provisioning
- [x] audit/outbox ทุก transition แบบไม่มี PII; module ไม่มี public route

## Slice A — ประตูเข้า + ฟอร์ม + คิวเข้า state (พร้อมเริ่ม ไม่ติดอะไร)

- Delta migration: เพิ่มค่า enum `PENDING_REVIEW`, `REJECTED` + field `pendingPasswordHash`, `attachUserId` (nullable ทั้งคู่) — additive เท่านั้น; transition map ใหม่ตาม spec §4 + test ชุดใหม่ (ห้ามนับหลักฐาน P10-0)
- `POST /v1/public/company-signups` + `GET /v1/public/company-signups/:requestId` แบบ `@Public()` ตาม precedent customer-line-register: DTO bounded/pattern (payload spec §3 รวม `businessType`/`phoneNumber`/`vatRegistered`), rate limit fail-closed bucket `public-signup-ip`/`public-signup-email` ก่อน use case, ตอบ `202 {requestId}`/state allowlist เท่านั้น
- Validation ที่ VALIDATED: schema + normalize + MX lookup (`dns.promises.resolveMx` + timeout) + dedupe hints (email→User/คำขอเดิม, taxId→Company) → เข้าคิว `PENDING_REVIEW` ทันที ไม่มีเมลออก
- หน้าเว็บ `/signup` + หน้าเช็คสถานะ (mobile-first 390px, offer preview 4 tier ตาม spec §3A ชุด 2026-08-30 — `PRO_TRIAL` เลือกได้อย่างเดียว), ข้อความหลัง submit ห้ามอ้างสร้างบริษัทสำเร็จ
- Gate: idempotent replay/409, MX fail message, rate-limit hit, state โผล่ในคิวถูกต้อง, ไม่มี secret ใน response

## Slice B — Claim + token (พร้อมเริ่มด้วย provider `local-console`; email จริงรอ Slice D)

- ตาราง `AccountClaimToken` (hash unique, single-use atomic H-09, TTL 7 วัน, resend = mint ใหม่ revoke เก่า) + outbox event `email.account_claim.requested` (พกแค่ `signupRequestId`) + consumer mint-at-send ใน workers ตาม P11 F-EM-3
- หน้า claim: expired/used/unknown ตอบ public message เดียวกัน; ทางแยก "มีบัญชีอยู่แล้วหรือยัง" — ใหม่ → ตั้งรหัส (hash ลง `pendingPasswordHash`); มีแล้ว → login รหัสเดิม/LINE (P12) → เก็บ `attachUserId`
- Resend จากหน้าเช็คสถานะ (จำกัดความถี่ — ใช้ได้ทั้ง EMAIL_PENDING และหลังลิงก์หมดอายุตาม spec §4D กรณีไม่มา claim) + เมลเตือน exactly-once ก่อนหมดอายุ 2 วัน + ธง "ยังไม่เริ่มใช้งาน N วัน" ในคิว + EXPIRED ถาวรหลัง 30 วัน
- Gate: hash-only (สแกนว่า raw token ไม่แตะ DB/outbox/log), single-use/replay/expiry/concurrency, ทางแยกทั้งสองเส้นจบที่ EMAIL_VERIFIED พร้อมข้อมูลถูกช่อง

## Slice C — คิวแอดมิน + provisioning (พร้อมเริ่ม)

- หน้า System Admin: list คำขอ + ผล MX/dedupe hints/ธง bounce + map `businessType` → enum + Approve/Reject idempotent + audit; Reject ค่าเริ่มต้นเงียบ + ตัวเลือก "แจ้งผู้สมัคร" รายกรณี; แจ้งเตือน dashboard เมื่อค้างเกิน 24 ชม.
- Approve → EMAIL_PENDING (ยิง outbox event); ไม่ provision ที่จุดนี้
- Provisioning adapter หลัง claim: เรียก `CreateCompanyOnboardingUseCase` เดิมผ่าน provisioning claim ที่ P10-0 มีแล้ว; เพิ่มการเขียน `User.email`/`emailVerifiedAt`; เส้น `attachUserId` = ผูก membership เข้า User เดิมไม่สร้างใหม่; ตรวจว่าไม่มี app-level unique ชื่อบริษัทขวาง; ลบ `pendingPasswordHash` เมื่อสำเร็จ; ตั้ง term row preset PRO + 30 วันตาม [P29 plan T3](mangmee-company-plan-term-plan-th.md)
- หน้าสำเร็จ + ขั้น LINE ตาม spec §4F (ปุ่ม OAuth/QR จาก P12, add-friend OA, ข้ามได้) + dialog merge เมื่อ LINE ชนบัญชีอื่น (รวม/ไว้ก่อน — ไม่มีตัวเลือกย้าย LINE) + label บทบาทใน company picker (web + LINE) + เปลี่ยน label ช่อง login เป็น "ชื่อผู้ใช้ หรือ อีเมล" (backend รับอีเมลอยู่แล้ว) — mockup 3 จอรับรองโดย Owner อยู่ที่ scratchpad `mangmee-claim-success-mockup.html`
- Gate: same-request concurrency = Company/User/Membership อย่างละหนึ่ง; attach ไม่สร้าง User ซ้ำ; merge ย้าย membership + ปิดบัญชีว่างโดย audit เดิมอยู่ครบ; reject ลบ hash ไม่ทิ้ง User กำพร้า

## Slice D — Email จริงผ่าน SES (ops คู่ขนาน — **ติด Owner ตาม P11 §5 ข้อ 1–2**)

- ยืนยันโดเมนผู้ส่ง + DKIM/SPF/DMARC (DNS อยู่ Cloudflare — Owner วาง records หรือเปิดทาง), region ap-southeast-1, configuration set + bounce/complaint event → ธง `EMAIL_FAILED` ในคิว, ขอออกจาก SES sandbox (lead time ~1 วัน — เริ่มก่อนโค้ดเสร็จ)
- สลับ `EMAIL_PROVIDER=ses` ใน UAT ก่อน แล้วพิสูจน์ inbox จริง + DKIM pass + bounce round-trip ตาม P11 §4
- **ผู้ใช้เดิมไม่มีอีเมลในระบบ**: ✅ ปิดบางส่วนแล้ว 2026-08-30 — Partner console เพิ่มช่อง email+mobile ต่อ member (`PATCH .../members/:id/contact`, `User.email` unique เดิม + `User.phoneNumber` ใหม่, audit HIGH; Owner กรอกย้อนหลังเอง ไม่มี script migrate) → login ด้วยอีเมลใช้ได้ทันทีที่กรอก; ที่เหลือของ Slice D: UI "เพิ่ม/ยืนยันอีเมล" ฝั่งผู้ใช้เอง (รอ SES) — admin-entered email ไม่ตั้ง `emailVerifiedAt` (การยืนยันจริงยังเป็นของ flow ยืนยัน)

## Slice E — Rollout

- Flag `EXTERNAL_SIGNUP_ENABLED` default OFF ทุก env → UAT e2e ครบวง (สมัคร→อนุมัติ→เมล→claim ทั้งสองทางแยก→LINE ทั้ง link/merge/ไว้ก่อน) → production ตาม runbook V2 → ค่อยชี้ลิงก์จากเว็บ official + rich menu
- ตัวเลข trial (P10 §8 ข้อ 5) ใส่เป็น config แสดงผลก่อนเปิดจริง

## Verification evidence P10-0 (2026-08-26)

- Prisma: format/validate/generate ผ่าน; migration `20260826200000_external_signup_core` apply สำเร็จ; local DB 151 migrations up to date และ apply ทั้ง 151 migrations จากฐานว่างได้ (`151|1|1` = applied/type/table); ลบฐานทดสอบชั่วคราวแล้ว
- Focused Node test: normalization/hash/state, idempotency conflict/replay, mocked 8-way receive + 6-way claim, retry/fencing, PII-free audit/outbox ผ่าน
- Real PostgreSQL: 16 receive calls → 1 durable row; 8 claims → 1 winner; stale attempt ถูกปฏิเสธ; 8 audit + 8 outbox unique; evidence ไม่มี PII
- Regression: full API test, API typecheck และ DI boot smoke ผ่าน (`Nest resolved every provider`)
- UI/browser: N/A ใน Phase 0 เพราะไม่มี route/page/public behavior เปลี่ยน; ใช้ API boot regression แทน
