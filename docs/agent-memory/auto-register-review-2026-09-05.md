# Agent Memory: auto-register-review-2026-09-05

Status: REVIEW COMPLETE — พบข้อผิดพลาดที่ยืนยันได้; ยังไม่แก้ implementation
Owner: thawatchai
Scope: ตรวจ Flow B บน checkout HEAD `91957572` ตั้งแต่ public form → review → email/claim → onboarding/plan term → LINE/merge; รวม recovery, security, multi-company, operations และ UX ภาษาไทย
Decisions: งานนี้เป็น review; ใช้ application code จริงผ่าน in-memory seams และ local browser ที่ mock public API; ไม่มี cloud read/write, deployment, email จริง หรือการแก้ข้อมูลลูกค้า
Open questions: นโยบายรักษาบทบาทเมื่อ merge memberships ซ้ำ; trial หลังหมดอายุและเส้นต่ออายุที่ต้องการแสดงผู้สมัคร; UAT บน LINE iOS/Android จริงสำหรับการข้าม browser
Artifacts: รายงานในไฟล์นี้; สคริปต์จำลองและภาพ local ชั่วคราวอยู่ `/tmp/mangmee-auto-register-review-20260905/`
Verification: API 192/192 และ web 46/46 ผ่าน; targeted probes และ mobile browser checks ยืนยัน gaps ด้านล่าง
Next: P1 ปิดแล้วบน `codex/flow-b-p1-fixes` (ดู "รอบแก้ P1 2026-09-05" ท้ายไฟล์); P2 และ integration matrix ยังค้าง; ยังไม่มี production acceptance จากการรีวิวนี้

## ข้อสรุป

Flow หลักมีโครงสร้างที่ดี แต่ยัง handle ไม่ครบ โดยเฉพาะการเชื่อมหลาย use case และการกลับมาทำต่อหลังเกิดความผิดพลาด ไม่ควรใช้ผล unit tests ที่ผ่านเป็นหลักฐานว่าพร้อมสำหรับผู้ใช้จริงครบทุกเส้นทาง

Priority ในรายงาน: **P1** = ควรแก้ก่อนขยายการใช้งาน เพราะเกี่ยวกับ credential, สิทธิ์, บริษัทซ้ำ/ค้าง หรือผู้สมัครทั้งกลุ่มติดขัด; **P2** = ควรแก้รอบถัดไปสำหรับ recovery, support และ UX ที่ใช้จริง

## Findings

### R01 — P1: Claim token หลุดเข้า request log แม้เปิด redaction

- จุดเกิด: `apps/api/src/modules/external-signup/presentation/http/public-company-signup.controller.ts` ใช้ `GET signup-claims/:token`; `apps/api/src/common/middleware/request-logger.middleware.ts:26` log `req.path` ตรง ๆ
- `createLogger()` ใช้ recursive key redaction แต่ `path` ไม่ใช่ sensitive key; string scrub ใน `packages/config/src/index.ts` จัดการ DSN credentials ไม่ได้ลบ token ที่อยู่ใน path
- ผลกระทบ: การเปิด claim page อย่างเดียวก็ทำให้ bearer token ที่ยังไม่ใช้เข้า log ผู้ที่ได้ log และใช้ลิงก์ทันก่อนผู้สมัครอาจตั้ง credential/claim ร้านที่อนุมัติแล้วได้ ไม่ได้หมายความว่าพบเหตุการณ์โจมตีจริง
- พิสูจน์: ป้อน token สังเคราะห์ผ่าน `RequestLoggerMiddleware` → `createLogger(redactionEnabled: true)` แล้ว assert ว่า output ยังมี token — ยืนยัน
- แก้ขั้นต่ำ: log route template หรือ sanitize path สำหรับ secret-bearing routes ก่อน emit; ตรวจ reverse proxy/access-log path ด้วย ก่อนอ้างว่าปิดครบทุกชั้น; อย่าย้ายไป query โดยไม่ตรวจ log ของ query

### R02 — P1: สมัคร PRO trial แต่สิทธิ์จริงเริ่มเป็น STARTER

- จุดเกิด: `apps/api/src/modules/system-onboarding/application/use-cases/create-company-onboarding.use-case.ts:456` เรียก default STARTER หลังสร้างบริษัท; `apps/api/src/modules/external-signup/application/provision-signup.use-case.ts:96` เรียก PRO อีกครั้ง
- `applyPlanTermPreset()` ใน `company-plan-term.use-cases.ts:181` ใช้ `upsert(update: {})` ดังนั้น PRO call จะเก็บ STARTER row เดิม
- ผลกระทบ: ฟอร์มเสนอ PRO 5 สาขา/10 คน แต่บริษัทปกติได้รับ STARTER 1 สาขา/2 คน และ stored monthlySlipLimit 30; หน้า welcome ยัง hardcode ว่า PRO ความเชื่อมั่นและเส้นเพิ่มสาขา/พนักงานเสียตั้งแต่วันแรก การบังคับ slip quota เป็นอีกระบบหนึ่ง ไม่ได้ยืนยัน enforcement จาก field นี้
- พิสูจน์: เรียก `ProvisionSignupUseCase` จริงต่อ `CreateCompanyOnboardingUseCase` จริง ใช้ DB transaction stub และ upsert ที่จำลอง semantics จริง — final row = STARTER, 1/2
- แก้ขั้นต่ำ: ส่ง initial plan ที่อนุมัติจาก signup ลง onboarding ให้เขียนครั้งเดียว และรักษาพฤติกรรมไม่ทับ term ที่ admin แก้ภายหลัง
- `modulePackage: 'starter'` เป็น Owner decision เรื่องเมนูที่บันทึกไว้แล้ว ไม่ใช่บั๊กเดียวกับ plan tier; ไม่เสนอเปลี่ยนเมนูโดยอัตโนมัติ

### R03 — P1: ผู้ใช้ที่ล็อกอินแล้วสมัครร้านเพิ่ม/ขอ resend ไม่ได้

- จุดเกิด: `apps/web/src/features/external-signup/external-signup.api.ts:25` ส่ง `credentials: include` แต่ไม่มี CSRF header; `apps/web/proxy.ts` บังคับ double-submit สำหรับทุก mutation `/api/v1/*` ที่มี access cookie
- ผลกระทบ: เส้นสำคัญ "พนักงานเดิมเปิดร้านของตัวเอง" และเจ้าของเพิ่มร้าน ถูก 403 ก่อนถึง API แม้มีสิทธิ์สมัครปกติ; cookie เก่าที่ยังอยู่ก็ทำให้เกิดได้ ข้อความ fallback กลายเป็นไม่มีสิทธิ์และให้ติดต่อเจ้าของร้าน
- พิสูจน์: เรียก proxy จริงด้วย same-origin NextRequest และ synthetic cookie ทั้ง submit/resend — 403 `csrf_token_invalid`
- แก้ขั้นต่ำ: public endpoints ที่ไม่ใช้ session ส่งโดยไม่พ่วง ambient credential หรือใช้ CSRF helper เดิมให้ถูกต้องตาม boundary; ไม่ปิด CSRF ทั้งระบบ

### R04 — P1: สร้างบริษัทสำเร็จบางส่วนแล้วกู้ต่อไม่ได้ และ retry อาจสร้างซ้ำ

- จุดเกิด: `signup-claim.use-case.ts:89` consume token แยกจากบันทึก hash/attach/state; `provision-signup.use-case.ts:61` onboarding commit ก่อน VAT/term/complete signup; catch ที่ `:142` เปลี่ยนเป็น PROVISIONING_FAILED โดยไม่รู้ว่า onboarding commit ไปแล้ว
- ผลกระทบเมื่อ write หลัง onboarding fail: บริษัทมีจริง แต่ request.companyId ยัง null; new-user retry ชน username/email ที่สร้างไปแล้ว ส่วน attach retry สร้างบริษัทที่สองได้ เพราะ onboarding ไม่มี durable signup key ผูกผลเดิม
- ถ้า process หยุดหลัง consume ก่อนบันทึก pending hash/state ลิงก์ถูกใช้แต่ flow ยังไม่พร้อม provision; ถ้าหยุดหลัง EMAIL_VERIFIED หรือระหว่าง PROVISIONING ผู้สมัครกลับมาคลิกลิงก์เดิมไม่ได้
- Admin queue มีเฉพาะ PENDING_REVIEW/EMAIL_PENDING/EMAIL_FAILED/EXPIRED และ controller ไม่มี retry/reconcile provisioning endpoint จึงไม่มีทางกู้จากหน้าคิว
- พิสูจน์: fault injection หลัง fake onboarding commit ผ่าน provision/core จริง → request.companyId null และ retry ผ่าน use case สร้างสอง company IDs; ไม่ได้ทดลองสร้างข้อมูลใน DB จริง
- แก้ขั้นต่ำ: ผูก onboarding result กับ signupRequestId ใน transaction ที่สร้างบริษัท; resume จากผลที่มีอยู่ก่อน retry และทำ claim material/state ให้ atomic; เปิด recovery queue/action ที่ reconcile ได้ ตรวจ hash cleanup และ chosen username ซึ่งปัจจุบันไม่ได้ persist สำหรับ retry ด้วย

### R05 — P1: Merge อาจทำสิทธิ์เจ้าของร้านหาย

- จุดเกิด: `apps/api/src/modules/auth/application/use-cases/account-merge.use-case.ts:90-107` ถ้า target มี membership บริษัทเดียวกันอยู่แล้ว จะ DISABLED source membership และเก็บ target roles เดิม โดยไม่ตรวจ role หรือ status ของ target membership
- ตัวอย่าง: บัญชีใหม่เป็น OWNER คนเดียวของร้าน A; บัญชี LINE เดิมเป็นพนักงานร้าน A → กดรวม → OWNER membership ถูกปิด เหลือ target เป็นพนักงาน; ถ้า target membership เดิม DISABLED จะไม่เหลือ access ที่ ACTIVE เลย
- แถม source user ถูก DISABLED เสมอ และไม่มี merge summary บอกว่า username/password ชุดใหม่จะใช้ต่อไม่ได้ อีเมลจาก source ไม่ย้ายถ้า target มีอีเมลแล้ว
- พิสูจน์: ใช้ `AccountMergeUseCase` จริงกับสอง fixture (target ACTIVE employee / DISABLED employee) — ทั้งสองไม่มี active OWNER หลัง merge
- แก้ขั้นต่ำ: fail closed สำหรับ overlapping memberships จนมี policy บทบาท/branch scope ที่ชัด และตรวจอย่างน้อยหนึ่ง active OWNER; อย่า union สิทธิ์เองแบบเดา แสดงผลที่จะเกิดกับร้าน บทบาท และวิธีเข้าสู่ระบบก่อนยืนยัน

### R06 — P1: Claim BFF ทำ rate limit ของคนละ IP รวมกัน

- จุดเกิด: `apps/web/app/api/auth/signup-claim/route.ts:50-54` และ `:70-74` forward เฉพาะ Content-Type ไป API โดยไม่มี trusted visitor-IP context
- `trustedClientIp()` จึงเห็น BFF/proxy peer; `AuthRateLimitService` จำกัด claim ที่ 20 requests/IP/hour ก่อน peek token ทำให้ malformed/invalid-but-well-shaped claims ก็กิน bucket เดียวกับลูกค้าจริง
- ผลกระทบ: quota มีโอกาสกลายเป็น 20 ครั้งต่อ BFF instance/egress แทนต่อผู้สมัคร ส่งผลให้คนอื่นถูก throttle; login failure bucket ในเส้น attach ก็มีปัญหาคล้ายกัน ขนาด blast radius ขึ้นกับ topology ซึ่งรอบนี้ไม่ได้อ่าน live cloud
- พิสูจน์: mock API fetch แล้วเรียก handler จริงด้วย incoming IP สองค่า — outgoing headers ของทั้ง claim และ login ไม่มี visitor IP
- แก้ขั้นต่ำ: ส่งต่อ IP ผ่าน trust boundary เดิมที่ตรวจ proxy chain ได้ หรือ enforce limiter บน BFF ด้วย verified client IP; ห้ามเชื่อ XFF ที่ผู้เรียกปลอมเอง

### R07 — P2: แก้อีเมลหลัง MX fail แล้ว submit ติด 409

- จุดเกิด: `SignupPage.tsx:113` mint UUID ครั้งเดียวตลอด form; submit service durable receive ก่อนตรวจ MX ที่ `submit-company-signup.use-case.ts:31-47`
- เมื่อ MX fail request ถูกเก็บเป็น RECEIVED พร้อม payload hash เดิม; ผู้สมัครแก้อีเมลแล้วส่งด้วย UUID เดิมจึงได้ `external_signup_payload_conflict`
- ข้อความ MX ไม่ได้แปลให้แก้อีเมลตามที่ comment อ้าง: API ส่ง `email_domain_has_no_mx` ภาษาอังกฤษ; translator ไม่มี mapping จึงบอก "ข้อมูลจากหน้าจอไม่ตรงกับที่ระบบรองรับ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง"
- พิสูจน์: core + submit จริงกับ MX stub → 422 แล้วแก้อีเมล → 409; web translator จริงยืนยันข้อความที่ไม่ชี้จุดแก้
- แก้ขั้นต่ำ: แยก retry payload เดิมจาก edit หลัง definite validation rejection; หมุน key สำหรับการแก้ที่ยืนยันแล้วว่ายังไม่เข้าคิว และคง key เดิมสำหรับ unknown network outcome พร้อม field-level error ภาษาไทย

### R08 — P1: Retry ของ submit/approve อาจตอบสำเร็จทั้งที่งานจำเป็นหาย

- `submit-company-signup.use-case.ts:35` short-circuit ทุก state ที่ไม่ใช่ RECEIVED: ถ้าหยุดหลัง VALIDATED ก่อน PENDING_REVIEW จะตอบ requestId เดิม แต่ไม่เดินเข้าคิว; ถ้า enqueue admin notification fail หลังเข้า PENDING_REVIEW retry ก็ไม่ enqueue ซ่อม
- `signup-admin-queue.use-case.ts:69-79` เปลี่ยน state → เขียน approvedAt/admin → enqueue mail แยกกัน; ถ้า enqueue fail retry APPROVE พบ EMAIL_PENDING แล้ว return ไม่ส่งเมลใหม่ ถ้า fail ก่อน approvedAt update ข้อมูล approval ก็ไม่ครบ
- ผลกระทบ: ผู้สมัครรอโดยไม่มีงานที่พาไปขั้นถัดไป และ admin เห็นผลสำเร็จที่ยังไม่มี mail event
- พิสูจน์: replay VALIDATED คงค้าง VALIDATED; approve พร้อม enqueue error แล้ว retry ไม่เรียก enqueue รอบสอง — ทั้งคู่ยืนยันด้วย real use cases/core
- แก้ขั้นต่ำ: state + required outbox/approval metadata ใน transaction เดียว หรือ resume idempotent missing side effect ตาม state โดยไม่เพิ่ม event ซ้ำ

### R09 — P2: Admin reissue คำขอเก่าแล้ว sweep ปิดลิงก์ใหม่อีก

- จุดเกิด: `signup-admin-queue.use-case.ts:115-137` reissue เปลี่ยนกลับ EMAIL_PENDING แต่ไม่บันทึก activation window ใหม่; `signup-claim-email.service.ts:194-209` expire จาก approvedAt เดิมที่เกิน 30 วัน
- ผลกระทบ: หลังทีมงานกดส่งใหม่ คำขอเดิมเข้าเงื่อนไขหมดอายุอีกทันทีเมื่อรอบ sweep ทำงาน ถ้ายังไม่ส่งเมล consumer จะข้าม; ถ้าส่งแล้ว peek token ก็ reject เพราะ request ไม่ใช่ EMAIL_PENDING
- พิสูจน์: reissue คำขออายุ 31 วัน → EMAIL_PENDING → เรียก sweep → EXPIRED
- แก้ขั้นต่ำ: แยก approvedAt ที่เป็น audit fact ออกจากเวลา reissue/activation expiry; sweep ต้องเคารพ window ใหม่ ไม่แก้วันอนุมัติย้อนหลังให้หลักฐานผิด

### R10 — P2: หมวดธุรกิจสุขภาพภาษาไทยไม่ผ่าน tripwire ที่ออกแบบไว้

- จุดเกิด: `provision-signup.use-case.ts:161-165` exact enum mapping; input "คลินิก"/ข้อความไทยตก OTHER และ approval DTO/UI ไม่มีช่องเลือก businessCategory
- ผลกระทบ: safeguard แจ้งเตือน tenant หมวดสุขภาพที่ onboarding มีอยู่ไม่ทำงานกับข้อมูลที่คนไทยกรอกตามธรรมชาติ ทั้งที่ admin เห็นคำว่าคลินิก ไม่ใช่ข้อวินิจฉัยการปฏิบัติตามกฎหมาย
- พิสูจน์: mapping จริงให้ OTHER; existing tests ยัง assert ว่าคลินิกต้องเป็น OTHER
- ข้อนี้เคยอยู่ใน follow-up ของ `auto-register-flow-b.md` แล้ว แต่ current implementation ยังไม่ปิด
- แก้ขั้นต่ำ: ให้ admin เลือก enum ที่ review ก่อน approve; ไม่ใช้ heuristic เดาจากข้อความเพื่อข้ามการ review

### R11 — P2: สถานะและ error copy บอกสิ่งที่ยังไม่ได้เกิด

- `domain/account-claim.logic.ts:44-49` map EMAIL_VERIFIED/PROVISIONING เป็น READY; `signup.logic.ts` บอก "ร้านของคุณพร้อมใช้งาน" และมี login CTA ทั้งที่ company อาจยังไม่เกิด
- PROVISIONING_FAILED กลายเป็น CHECKING พร้อม "ยังไม่ต้องทำอะไรเพิ่ม" ทั้งที่ไม่มี automatic retry; EMAIL_FAILED กลายเป็น AWAITING_CLAIM พร้อม "เราส่งอีเมล...ไปให้แล้ว" แม้รู้ว่า bounce
- `SignupStatusPage.tsx` บอก "ส่งอีเมลใหม่ให้แล้ว" เมื่อได้เพียง queued=true; `ClaimAccountPage.tsx` จัด network/429/5xx ตอนโหลดเป็น unusable token; availability outage กลายเป็นปิดรับสมัคร
- แก้ขั้นต่ำ: แยกกำลังจัดเตรียม/จัดเตรียมติดขัด/ส่งเมลติดขัดออกจาก READY; ใช้ "รับคำขอส่งอีเมลใหม่แล้ว" จนมี send evidence; transient errors มี retry และไม่บอกว่าลิงก์เสีย

### R12 — P2: ผู้สมัครทำลิงก์ติดตามสถานะหายได้ง่าย และทางกู้ลิงก์ไม่ครบ

- `SignupPage.tsx` เก็บ requestId แค่ React state; submit สำเร็จยังอยู่ URL `/signup` แต่บอก "เก็บลิงก์หน้านี้ไว้ตรวจสถานะได้ตลอด" — bookmark/share จะเก็บหน้าฟอร์มที่ไม่มี ID
- Reload คืนฟอร์มเปล่าและ key ใหม่; ไม่มี pre-approval email ตาม Flow B จึงไม่มีช่องทางสำรองหากผู้สมัครไม่กด/เก็บลิงก์สถานะ
- `ClaimAccountPage.tsx:20-32` บอกให้ขอลิงก์ใหม่จากหน้าสถานะ แต่มีปุ่มเดียวไป login คนที่เปิดเมลบนอีกเครื่องหรือยังไม่ตั้งรหัสจึงทำต่อไม่ได้
- ข้อความ "หากอีเมลไม่มาภายใน 2 วัน กดขอส่งอีเมลใหม่" ใช้ไม่ได้เมื่อยัง PENDING_REVIEW เพราะยังไม่มี resend action
- พิสูจน์ด้วย browser local 390px และ mocked public API: submit ค้าง `/signup`; reload คืน form; unusable claim ไม่มี href หน้าสถานะ
- แก้ขั้นต่ำ: redirect/replace URL เป็น `/signup/status/:id` หลัง success พร้อม copy-link CTA; ออกแบบ recovery จาก claim/email ให้มี status locator ที่ไม่เปิด PII และ support fallback

### R13 — P2: คิว admin มีเพดาน 200 แถว แต่ไม่มี pagination

- จุดเกิด: `signup-admin-queue.use-case.ts:33-36` take 200 หลังเรียง state/createdAt; EXPIRED ยังรวมใน queue states; `SignupQueuePage.tsx` filter และนับเฉพาะ array ที่โหลดมา
- ผลกระทบ: เมื่อ backlog โต รายการนอก 200 มองไม่เห็นจากหน้าคิว แม้เปลี่ยน tab; อาจแสดงไม่มีรายการในกลุ่มนั้นทั้งที่ DB มีจริง EXPIRED ไม่ได้ออกจาก dataset ตามที่ comment sweep บอก
- หลักฐาน: source trace; ยังไม่ได้ทำ load test/real DB backlog
- แก้ขั้นต่ำ: server-side filtering + pagination/cursor และจำนวนที่บอกขอบเขตตรงจริง; แยก archived/expired view ที่ค้นคืนได้

## UX และ wording ที่ควรปรับพร้อม logic

ภาพ mobile 390px ที่ตรวจมีปุ่มหลักใหญ่ อ่านลำดับง่าย และไม่เห็น horizontal overflow ในภาพที่ตรวจ แต่รายละเอียดสำคัญหลายจุดยังไม่ช่วยผู้ใช้ตัดสินใจหรือแก้ปัญหา

| จุด | ปัจจุบัน/ปัญหา | ข้อเสนอ |
|---|---|---|
| แพ็กเกจ | PRO ฿999/เดือน + badge ทดลองฟรี แต่ไม่มี 30 วัน/วันเริ่ม/สิ่งที่เกิดหลังหมด | "ทดลองแพ็กเกจ PRO ฟรี 30 วัน เริ่มเมื่อเปิดใช้งานร้าน" พร้อมบอกว่าจะหยุดใช้เมื่อหมดระยะและต้องติดต่อทีมงานต่ออายุ; แยกราคาหลังทดลอง ไม่สื่อว่าตัดเงินอัตโนมัติ |
| หน้ารับคำขอ | บอกตั้งรหัสเสมอ แม้คนมีบัญชีเดิม | "เมื่ออนุมัติ เราจะส่งลิงก์เปิดใช้งานทางอีเมล ตั้งรหัสใหม่หรือใช้บัญชีเดิมได้" |
| รออนุมัติ | บอกให้ resend ใน 2 วัน แต่ยังไม่ได้อนุมัติ | "เมื่ออนุมัติแล้วจึงขอส่งลิงก์ใหม่ได้ หากรอนาน ติดต่อ..." โดยไม่สัญญาเวลาอนุมัติ |
| Username | Client ตรวจแค่ไม่ว่าง; API ต้อง 3–40 ตัว `[A-Za-z0-9._-]` | hint + maxLength + validation ตรงกัน; เช่น "3–40 ตัว ใช้ภาษาอังกฤษ ตัวเลข จุด ขีดกลาง หรือขีดล่าง" |
| การแก้ validation | server 400/422 หลายตัวให้ reload | แสดงข้อความใต้ช่องที่ผิดและ focus/scroll ไป error แรก โดยเฉพาะ submit อยู่ล่างจอยาว |
| required/optional | businessType ไม่บังคับแต่ไม่บอก; first/last/phone บังคับไม่มี marker | ระบุ "ไม่บังคับ" และชื่อ/นามสกุลเป็นชื่อบุคคลที่ใช้แสดง ไม่ใช่ชื่อสำหรับ login |
| claim เดิม | มีเพียง username/password; ลืมรหัสแสดงเฉพาะ emailMatchesExistingUser | เส้นผู้ใช้ LINE-only/รหัสชั่วคราวหมดอายุควรมี recovery หรือ attach ด้วย LINE ตาม spec; อย่าพาไปสร้างบัญชีใหม่โดยไม่อธิบายผล |
| Merge | อธิบายย้ายร้าน แต่ไม่บอก credentials ที่จะหาย/ใช้ต่อ | แสดงบัญชีปลายทาง รายการร้าน และช่องทางเข้าสู่ระบบหลังรวม; ทดสอบ source/target email ต่างกัน |
| LINE | "กดปุ่มเดียว...เพิ่มเพื่อนให้" แต่ flow ยังไม่มี friend-state check ใน welcome | อธิบายว่าเปิด LINE เพื่อยืนยัน และเลือกเพิ่มเพื่อนตามหน้าที่แสดง; เสนอเปิดแชต OA/ตรวจ friend state หลัง link ก่อนสัญญาว่าส่งใบเสร็จได้เลย |
| สถานะ LINE สำเร็จ | ดูเพียง query `line=linked`; reopen จาก sidebar ไม่มี query จะเสนอ connect อีก | อ่าน account link state ที่ backend ยืนยัน; แยก link account / OA friend / พร้อมส่งเอกสาร |

ข้อเสนอ wording ต้องทำควบคู่กับ behavior โดยเฉพาะ plan tier ใน R02; การเปลี่ยนป้ายอย่างเดียวไม่ได้แก้สิทธิ์ผิด

## สิ่งที่ต้องตรวจเพิ่มก่อนรับเป็น mobile/live acceptance

รายการนี้เป็นขอบเขตที่ยังไม่พิสูจน์บนระบบจริง ไม่รวมเป็นผลทดสอบผ่าน:

- **ข้าม LINE in-app browser ไป Safari/Chrome:** `SignupWelcomePage.tsx:33` ย้าย browser ที่ขั้น link แต่ session จาก claim อยู่ browser เดิม; callback เลือก link/login จาก access cookie ถ้าเครื่องใหม่ไม่มี cookie จะเดิน login lane ถ้ามีอีกบัญชีค้างอยู่จะใช้บัญชีนั้น ต้องตรวจด้วยสอง browser contexts/มือถือจริง และ bind intent ให้ชัด
- **บริษัทที่ active หลัง attach:** BFF login ไม่ได้ส่ง companyId ที่เพิ่ง provision ไปเลือก session; welcome เรียก `fetchPlanTermNotice()` โดยไม่ระบุ companyId และปุ่มสำเร็จ LINE ไป `/` จึงอาจใช้ context ร้านเดิม ตรวจคนที่มีสองร้านและ term ต่างกัน
- **Merge ขณะใช้งานต่อเนื่อง:** pending approvals/งานที่ผูก userId, merge response loss หลัง revoke source session, target LINE identity เปลี่ยนระหว่าง mint ticket กับ confirm และสอง tickets แข่งขันกัน ยังไม่มีหลักฐาน integration ครบจาก review นี้
- **Email delivery จริง:** DNS/SES/SNS suppression/bounce, reminder ที่ mint token ใหม่จนลิงก์เดิมตาย, worker downtime และ outbox DEAD ต้องมี ops view/notification ตรวจ live ตาม runbook; review นี้ไม่อ่าน cloud ตาม scope
- **SLA และ retention:** โค้ดที่ตรวจมี initial admin notify แต่ไม่ได้ยืนยัน recurring alert เมื่อค้าง review 24h; request ที่ MX ไม่ผ่านหรือ claim ล้มเหลวมี PII/pending hash ต้องผูกนโยบาย retention/recovery ที่ตรวจสอบได้
- **Docs drift:** spec P10 ตอนต้นยังกล่าวว่าไม่มี public signup และหลาย section ยังเป็น target/spec-only; มีบรรทัด paid/free branch ลำดับเก่าข้าม claim ทั้งที่ implementation มีแล้ว ควร reconcile current truth และ acceptance checklist ก่อน handoff รอบแก้

## สิ่งที่มี handle อยู่แล้ว

- Public intake flag แยกจาก claim/status ทำให้ปิดรับคำขอใหม่ได้โดยไม่ปิด claim ที่อนุมัติแล้ว
- Admin permissions ใช้ onboarding permission เดิม; state machine ไม่เปิดเส้นข้าม PENDING_REVIEW ไป provision โดยตรง
- Token ใช้ random 32 bytes, hash-only ในตาราง, TTL 72h, read-only peek และ single-use CAS; ข้อยกเว้นการเก็บลับนอก DB คือ R01
- Password hash และ attach credential validation; wrong password ไม่ควร consume token; existing email ชี้ให้ไปบัญชีเดิม
- Public status DTO ไม่คืนชื่อ/email/tax ID; rejection notice opt-in และ HTML escaping
- Rate limit แบบ fail-closed, outbox event dedupe/lease, SNS topic/signature verification และ stale-state guards มีพื้นฐานที่ดี แต่ยังต้องปิดรอยต่อ R06/R08/R09
- Welcome มี skip LINE, conflict dialog และ callback feedback; legal acceptance บังคับแยกในแอปตาม Owner decision จึงไม่เสนอคืน consent checkbox ที่หน้า signup

## Verification evidence

### Existing focused suites

รันจาก `apps/api`:

```sh
pnpm exec tsx --test src/modules/external-signup/domain/*.spec.ts src/modules/external-signup/application/*.spec.ts src/modules/external-signup/infrastructure/*.spec.ts src/modules/auth/application/use-cases/account-merge.use-case.spec.ts src/modules/auth/infrastructure/account-claim-email.template.spec.ts src/modules/system-onboarding/application/use-cases/create-company-onboarding.spec.ts
```

ผล: **192 tests / 41 suites / 192 pass / 0 fail**

รันจาก `apps/web`:

```sh
pnpm exec tsx --test src/features/external-signup/*.spec.ts src/features/system-signup-requests/*.spec.ts src/features/auth/line-login-callback-route.spec.ts src/features/auth/account-merge-bff.logic.spec.ts
```

ผล: **46 tests / 14 suites / 46 pass / 0 fail**

เหตุที่ suites ผ่านแต่พบ defects: provisioning test mock onboarding และ assert เฉพาะ PRO upsert call; onboarding test assert STARTER แยกกัน ไม่ได้ดู final row เมื่อใช้ร่วมกัน ส่วน state/retry/merge fixtures ยังไม่ได้ครอบคลุม failure window และ overlapping roles

### Targeted review probes

ไฟล์ชั่วคราวนอก repo ไม่ใช่ regression tests ที่ merge แล้ว:

```sh
# cwd apps/api
pnpm exec tsx --tsconfig tsconfig.json /tmp/mangmee-auto-register-review-20260905/api-probes.ts
pnpm exec tsx --tsconfig tsconfig.json /tmp/mangmee-auto-register-review-20260905/merge-probe.ts
# cwd apps/web
pnpm exec tsx --tsconfig tsconfig.json /tmp/mangmee-auto-register-review-20260905/web-probes.ts
# browser: frontend local ที่กำลังทำงาน; public API responses mocked
node /tmp/mangmee-auto-register-review-20260905/browser-probe.cjs
```

ทั้งหมด exit 0; assertions ยืนยันพฤติกรรมที่เป็นข้อผิดพลาด ไม่ใช่ acceptance ว่าระบบถูกต้อง

ตรวจภาพ `signup-mobile.png`, `submitted-mobile.png`, `expired-claim-mobile.png` ที่ viewport 390×844 แล้ว; browser checks ยืนยัน URL/state/recovery เท่านั้น ไม่ใช่ real SES/LINE end-to-end

### Regression acceptance ที่ควรเพิ่มรอบแก้

| Journey | Expected evidence |
|---|---|
| signup → real onboarding → term | หนึ่งบริษัท PRO / 5 สาขา / 10 คน; ไม่เขียนทับ renewal เดิม |
| existing session → signup/resend | ไม่ติด CSRF; public boundary ยังไม่พึ่ง session |
| typo → MX fail → edit → retry | ส่งสำเร็จหนึ่งคำขอ และ error ชี้ที่อีเมล |
| network retry/payload replay | key เดิมไม่ซ้ำ; pending steps resume ได้ |
| fail หลัง consume/VALIDATED/approve/onboarding commit | ไม่มี dead end; correlation ครบ; ไม่มี company/user/membership ซ้ำ |
| old approval → reissue → sweep | fresh link ใช้ได้เต็ม activation window |
| overlap merge OWNER/employee/disabled | ไม่ทำ last OWNER หาย; policy ของสิทธิ์ชัดก่อน mutation |
| two clients/one BFF | rate limit แยก client ที่ตรวจสอบได้; ไม่รับ spoofed IP |
| request logging | token ไม่ปรากฏในทุก log channel ที่เส้นนี้ใช้ |
| bounce/worker down/provision failure | UI บอก state จริงและมี next action; admin หาเคสได้ |
| refresh/share/new device | status URL ใช้กลับมาติดตามได้; expired claim มี recovery |
| LINE two browser contexts/multi-company | ผูกกับ intended user; กลับร้านใหม่และ legal gate ถูกต้อง |

## ลำดับแก้ที่เสนอ

1. Credential leakage, final PRO term, existing-session CSRF และ shared-IP limiter
2. Durable claim/provision/replay recovery พร้อมคิวของ failure และ activation expiry ที่ reissue ได้จริง
3. Merge overlapping membership guard/policy และหมวดธุรกิจตอน approve
4. Status/wording/recovery, input validation, queue pagination แล้วทำ mobile LINE/SES UAT จริง

ไม่จำเป็นต้องรื้อ flow หรือเพิ่ม framework ใหม่เพื่อแก้ข้อเหล่านี้ ส่วนใหญ่เป็นการแก้ transaction boundary, initial parameters, request context และ copy ให้ตรง state

## รอบแก้ P1 2026-09-05 — branch `codex/flow-b-p1-fixes`

รายงานข้างบนเขียนบน checkout `91957572`; รอบแก้นี้ทำบน `origin/develop` (`91704151`) ซึ่งใหม่กว่าและมี P10-L slices, stale-identity fixes และ CI pg step อยู่แล้ว จึงมีบางข้อที่ **ไม่ reproduce** — บันทึกไว้พร้อมเทสต์ที่พิสูจน์ ไม่ได้แก้ทับ

| ข้อ | reproduce บน develop? | สถานะ |
|---|---|---|
| R01 token ใน log | ใช่ (ทั้งสองชั้น) | แก้แล้ว: `POST /public/signup-claims/info` (token อยู่ใน body) และ `RequestLoggerMiddleware` log route template / mask segment ที่ยาวพอจะเป็น credential |
| R02 PRO trial ได้ STARTER | **ไม่** — onboarding รับ `planTier` มาแล้วเขียนครั้งเดียว | เปลี่ยนตาม Owner 2026-09-05 แทน: ทุก self-signup ได้ free trial (`FREE_TRIAL_15` 30 วัน) ทั้ง web และ LINE; `requestedOfferKey` เป็น attribution อย่างเดียว ไม่ปฏิเสธคำขออีกต่อไป |
| R03 CSRF ตัดผู้ใช้ที่ล็อกอินอยู่ | ใช่ | แก้แล้ว: public `/api/v1/*` ส่ง `credentials: 'omit'`; `/api/auth/*` (BFF ที่ตั้ง cookie) ยังส่ง credentials เหมือนเดิม; CSRF ที่อื่นไม่ถูกลด |
| R04 บริษัทซ้ำ / request ค้าง | **ไม่** — stamp อยู่ใน company transaction, ผู้แพ้ rollback ทั้ง transaction, retry adopt ได้ทั้ง new-user และ attach (pg spec ยืนยัน 3 เคส) | ส่วนที่ reproduce คือ claim: consume token แยกจากการบันทึก → แก้ให้เป็น transaction เดียว |
| R05 merge ทำ OWNER หาย | ใช่ (ทั้งสอง fixture) | แก้แล้ว: fail closed `account_merge_role_conflict` + invariant "ต้องเหลือ ACTIVE OWNER" + preview รายร้านและวิธีเข้าสู่ระบบที่เหลือ |
| R06 rate limit รวมเป็น IP เดียว | ใช่ (ฝั่ง BFF) | แก้แล้ว: claim BFF forward `x-forwarded-for` ทั้ง claim และ login lane ผ่าน `forwardedClientHeaders`; ฝั่ง API `trustedClientIp` ถูกต้องอยู่แล้ว (มี property guard เพิ่ม) |
| R08 retry ตอบสำเร็จทั้งที่งานหาย | ใช่ (ทั้ง submit และ approve) | แก้แล้ว: submit resume จาก state ที่ค้าง; approve เขียน state + approvedAt + outbox ใน transaction เดียว; retry ซ่อม email ที่หาย |
| R09 reissue แล้วโดน sweep ปิดซ้ำ | ใช่ | แก้แล้ว: คอลัมน์ใหม่ `claimWindowStartedAt` (additive + backfill); approve เริ่ม, reissue รีสตาร์ท, sweep และ self-serve resend อ่านคอลัมน์นี้; `approvedAt` ยังเป็น audit fact |

ยังไม่ได้แก้ในรอบนี้ (ตั้งใจ):

- **R01 ชั้น infra:** ALB / Cloudflare access log ก็บันทึก path เดิมด้วย ลิงก์ claim ที่ส่งไปแล้วก่อนรอบนี้จึงเคยผ่าน log ชั้นนั้น — เป็นงาน infra (log retention / redaction ที่ edge) ไม่ได้อยู่ในโค้ดนี้
- **`apps/web/app/api/auth/login/route.ts`** มีอาการ R06 แบบเดียวกัน แต่ไฟล์นี้อยู่ใน maintenance pins ของ production deploy จึงไม่แตะในรอบนี้
- **AI budget ของ free trial ทาง web:** `applyLineTrialGuards` (warm-up + `companyAiConfiguration`) ยังรันเฉพาะ source `line-oa` ตามเดิม การเปลี่ยน tier รอบนี้ไม่ได้ทำให้แย่ลง แต่ตอนนี้ร้านจากฟอร์มเว็บก็เป็น free trial แล้ว จึงควรมี Owner decision ว่าจะให้ AI budget เท่ากับ LINE หรือไม่
- **P2 ทั้งหมด (R07, R10–R13)** และ integration matrix ท้ายรายงาน
