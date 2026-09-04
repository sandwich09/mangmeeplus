# Auto-register จาก LINE OA (LINE-first Signup) — Spec P10-L

สถานะ: **DRAFT v1 — 2026-09-04** รอ Owner รีวิวหลายมุม (UX/BA ผ่านแล้วในหลักการ; ยังไม่ implement)
เจ้าของ: Owner (มั่งมีพลัส) / ผู้เขียน: Claude (Fable)
ความสัมพันธ์: **companion ของ P10** ([mangmee-external-signup-contract-spec-th.md](mangmee-external-signup-contract-spec-th.md)) — P10 §4F จดไว้แล้วว่า "ฟอร์มเวอร์ชัน LIFF สำหรับคนสมัครจาก rich menu — รู้ตัวตน LINE ตั้งแต่กรอก" คืองานอนาคต; เอกสารนี้คือการทำงานชิ้นนั้นให้เป็นสัญญา โดย**ไม่หัก**กฎ P10/P11/P12 ที่ production แล้ว
เกี่ยวข้อง: P11 email claim, P12 LINE login/handoff ([line-web-deeplink-handoff-spec.md](line-web-deeplink-handoff-spec.md)), แผนหลัก §13.6 + LINE-ONBOARD-01 + AUTH-02, rich menu v2 ([line-rich-menu-v2-spec.md](line-rich-menu-v2-spec.md))

## 0. ทำไมต้องมี flow นี้ (ปัญหาจริงจากลูกค้า)

ลูกค้าเป้าหมาย = เจ้าของร้านเล็ก วัย 35–55 ใช้ชีวิตบน LINE ไม่เปิดอีเมล เจอฟอร์มยาวแล้วถอย และมีคำถามเดียวตอนกดสมัคร: *"มันจะช่วยฉันยังไง ขอเห็นเลย"* — ความตั้งใจสูงสุดอยู่ใน 2 นาทีแรก

Flow B (P10) ใช้อีเมลเป็นจุดพิสูจน์ตัวตนและเป็นช่องส่งลิงก์ ทำให้เกิด pain 3 อย่างที่ Owner เห็นจากลูกค้าจริง (2026-09-04): **ขี้เกียจกรอก / ขี้เกียจเข้าเมล / ไม่รู้ว่าต้องเข้าไปดูเมลตอนไหน** และวันเดียวกัน AWS SES ปฏิเสธ production access — flow ที่พึ่งอีเมลจึงเป็นความเสี่ยงต่อการเปิดตัวโดยตรง

หลักฐานที่ใช้ตัดสินใจ (ดู §14): ข้อความ LINE เปิดอ่าน 60–80% เทียบอีเมล 15–20%; ฟอร์ม 3 ช่องแปลงเป็นลูกค้าดีสุด ทุกช่องที่เพิ่มลดอัตราสมัคร ~4%; ป้าย "ไม่บังคับ" ดีกว่าดอกจันบังคับ ~25%

**เป้าหมาย:** ลูกค้าที่ add LINE OA แล้ว สมัครได้ใน **1 ช่องกรอก + 1 แตะยอมรับ** และเข้าใช้งานได้โดย**ไม่ต้องแตะอีเมลหรือรหัสผ่านเลย** ตัวตน = LINE ที่ผูกตั้งแต่วินาทีแรก; อีเมล/รหัสผ่านเป็นของ "ทีหลัง เมื่อมีเหตุผล"

## 1. Current truth (จากโค้ด ณ develop `91957572`)

สิ่งที่มีอยู่แล้วและ flow นี้**ใช้ซ้ำ**:

| ชิ้น | ที่อยู่ | ใช้ทำอะไรใน P10-L |
|---|---|---|
| Flow B core: `CompanySignupRequest` + enum `CompanySignupState` (14 ค่า) + `TRANSITIONS` | `apps/api/prisma/schema.prisma:3071`, `:2841`; `external-signup/domain/company-signup.logic.ts:45` | ตาราง/สถานะเดิม เพิ่ม source ใหม่ ไม่สร้างตารางคู่ขนาน |
| คิวแอดมิน + decide/reissue + แจ้งเตือน SYSTEM_ADMIN ทาง dashboard+LINE | `signup-admin-queue.use-case.ts`, `signup-admin-notify.service.ts` | คิวเดียวกัน แถวจาก LINE โชว์ป้าย LINE |
| `attachUserId` บนคำขอ → provisioning ผูกบริษัทใหม่เข้า User เดิม (`attachedExistingOwner`) | `signup-claim.use-case.ts`, `provision-signup.use-case.ts:29` | เคส "LINE นี้มีบัญชีอยู่แล้ว" = เพิ่มร้านที่ 2 โดยไม่สร้าง User ซ้ำ |
| `ProvisionSignupUseCase` → `CreateCompanyOnboardingUseCase` (กฎสร้างบริษัทชุดเดียว; fence `claimProvisioning`; `modulePackage:'starter'`; plan term preset) | `provision-signup.use-case.ts:41,:72,:75,:96` | ทางเดียวที่สร้าง Company/User/Membership |
| `ExternalIdentity` (LINE) `@@unique([provider, providerChannelId, providerUserId])` | `schema.prisma:786` | รั้ว "1 LINE = 1 บัญชี" เชิงโครงสร้าง |
| LIFF page pattern: HTML เสิร์ฟจาก API + `LIFF_PAGE_SCRIPT` modes `account/employee/customer` + CSP | `auth.controller.ts:432,:569`; `common/security/liff-page.security.ts` | เพิ่ม mode `signup` และ `start` ในแบบเดียวกัน (ไม่มีหน้า LIFF ใน Next.js) |
| ตรวจ LIFF ID token ฝั่งเซิร์ฟเวอร์ (employee link) | `auth.controller.ts:612` → `complete-employee-line-link.use-case.ts:23` | ตัวพิสูจน์ตัวตน LINE ที่ใช้ซ้ำสำหรับ signup/start |
| Handoff token (15 นาที, path ใน `/companies/<id>` เท่านั้น) + route `/l/[token]` ตั้งคุกกี้แล้ว 303 | `mint-line-handoff-token.use-case.ts:35`, `line-handoff.logic.ts:11,:46`; `apps/web/app/l/[token]/route.ts` | "กดลิงก์แล้วอยู่ในระบบเลย" โดย mint **ตอนแตะ** ไม่ใช่ตอนส่งข้อความ |
| Push ข้อความหา LINE userId (env channel token) | `line-reply.adapter.ts:43-45`, `auth/infrastructure/system-line-push.ts:8` | แจ้ง "ได้รับ/อนุมัติ/ปฏิเสธ" ทางไลน์ |
| Unlinked-user reply ใน webhook | `process-line-webhook.use-case.ts:1799-1802`, copy `:154` | เปลี่ยนเป็นการ์ด 3 ประตู (§3.1) |
| ด่านยอมรับข้อกำหนด: guard + `LegalDocumentActionRecord` + การ์ดใน LINE + หน้าเว็บ `/legal-acceptance` | `auth.guard.ts:33`, `legal-acceptance.service.ts:169`, `line-business-card.logic.ts:303` | หลักฐาน PDPA แบบ challenge เดิม เกิดตอนแตะเข้าครั้งแรก |
| แพ็กเกจ "เริ่มต้น" | `packages/contracts/src/menu-entitlements.ts:421` `.starter` | Free tier |
| Rate-limit buckets ต่อ IP/email | `auth-rate-limit.service.ts:130-154` | เพิ่ม bucket ต่อ LINE userId (ยังไม่มี) |
| Flags `EXTERNAL_SIGNUP_ENABLED`, `LINE_LIFF_ID`, `LINE_WEB_HANDOFF_ENABLED` + deploy.sh wiring (prod hard-stop) | `app-config.service.ts:66-70`; `deploy.sh:184-193,:1515` | เพิ่ม flag ชุด LINE signup แบบเดียวกัน |

สิ่งที่**ยังไม่มี** (ต้องสร้าง): คอลัมน์ LINE identity บนคำขอ; LIFF mode `signup`/`start`; endpoint LIFF ID-token → handoff session; per-LINE-user rate limit; การ์ด 3 ประตู; ตัวเลือก auto-approve; rich menu ต่อผู้ใช้ (Phase 2)

## 2. หลักการที่ห้ามละเมิด (สืบทอด P10 + เพิ่มของ P10-L)

1. **SIGNUP-01 คงเดิม:** ทุก retry เดินต่อจาก state เดิมแบบ idempotent — ห้ามสร้าง Company/User/Membership/ExternalIdentity ซ้ำ
2. **SIGNUP-02 ตีความใหม่สำหรับ source นี้:** "ไม่ provision จนกว่าจะพิสูจน์ว่ามีคนจริง" — ใน Flow B พิสูจน์ด้วย mailbox; ใน P10-L พิสูจน์ด้วย **LIFF ID token ที่เซิร์ฟเวอร์ตรวจแล้ว** (คนคนนั้นอยู่ในแชท OA ของเราจริง ณ ตอนกรอก) → provision ได้ทันทีหลังอนุมัติ ไม่มีขั้น claim
3. **LINE-ONBOARD-01 คงเดิมและเข้มขึ้น:** ไม่มี temporary password, ไม่มี token ส่วนตัวในข้อความ LINE/อีเมล — ปุ่มทุกปุ่มที่ส่งไปคือ URL LIFF **กลาง** (ไม่มี token) แล้ว mint handoff **ตอนแตะ**
4. **AUTH-02 คงเดิม:** LIFF ใช้ credential ชุดเดียว (`LINE_LIFF_ID` + Messaging channel เดิม)
5. **ไม่ถามรหัสผ่านและอีเมลตอนสมัคร** (UX principle ที่ Owner เห็นด้วย 2026-09-04) — ตั้งได้ทีหลังจากหน้าตั้งค่า พร้อมเหตุผลที่ลูกค้าเข้าใจ
6. Provision ผ่าน `CreateCompanyOnboardingUseCase` เดิมเท่านั้น (กฎสร้างบริษัทชุดเดียว) — ขยาย input ไม่ทำทางลัด
7. การเข้าใช้งาน**ต้องไม่พึ่งอีเมลในทุกขั้น** — อีเมลใน flow นี้เป็นใบเสร็จ/สำเนา ล้มเหลวได้โดยไม่กระทบ state

## 3. Journey ฝั่งลูกค้า (ทุกจอต้องผ่านมือถือ 390px, ภาษาไทยธรรมดา, ห้ามมีเครื่องหมาย "+")

### 3.1 ประตูเข้า — การ์ด 3 ประตู (แทน unlinked reply เดิม)

เมื่อ LINE user ที่ยังไม่ผูกบัญชีส่งข้อความใดๆ (หรือ add เพื่อนแล้วได้ greeting) ระบบตอบการ์ดเดียว:

- **"เปิดร้านใหม่ ใช้ฟรี"** → LIFF `https://liff.line.me/<LINE_LIFF_ID>/signup`
- **"ฉันเป็นพนักงาน"** → ข้อความสั้น: ให้เจ้าของร้านส่งลิงก์เชื่อม LINE จากเมนู "พนักงาน" (ใช้ระบบ employee link เดิม) — ปิดกับดัก "พนักงานเผลอสมัครร้านซ้ำ"
- **"มีบัญชีอยู่แล้ว เชื่อม LINE"** → LIFF account link-page เดิม (`GET /v1/auth/line/link-page`)

ถ้า LINE user นี้มีคำขอค้าง (§5) การ์ดเปลี่ยนเป็น**การ์ดสถานะ**: "ได้รับคำขอแล้ว กำลังตรวจสอบ ปกติไม่เกิน 1 ชั่วโมงในเวลาทำการ" (copy/SLA ปรับได้ตาม Owner)

### 3.2 ฟอร์ม LIFF `signup` — 1 ช่อง

- หัว: รูป+ชื่อจากโปรไฟล์ LINE ("สวัสดีคุณ นิด") — ดึงจาก `liff.getProfile()` ฝั่ง client แสดงเท่านั้น; ค่าที่เชื่อถือได้มาจาก ID token ที่เซิร์ฟเวอร์ตรวจ
- ช่องเดียว: **ชื่อร้าน** (บังคับ, 1–120 ตัวอักษร, ซ้ำกับร้านอื่นได้ตาม P10 §4C)
- ตัวเลือกเสริมแบบ chip แตะได้ ไม่บังคับ: **ประเภทธุรกิจ** (map เข้า `businessType` เดิม) — ไม่มีช่องพิมพ์เพิ่ม
- ข้อความยอมรับ 1 บรรทัด + ลิงก์ "ประกาศความเป็นส่วนตัว"/"ข้อกำหนด" + ปุ่มเดียว **"สมัครใช้งานฟรี"** (การแตะปุ่ม = ยอมรับเวอร์ชันที่แสดง → เก็บ `consentVersion` เป็น pre-consent; การยอมรับแบบมีผลผูกพันตาม challenge-evidence เกิดที่ §3.5)
- **ไม่มี** ช่องอีเมล เบอร์โทร รหัสผ่าน เลขภาษี — ถามทีหลังในจังหวะที่มีเหตุผล (§3.6)
- ถ้า `?ref=<code>` มากับ LIFF URL (QR อินฟลูฯ ตาม §13.6B) → เก็บ `referralCode` เดิม
- ส่งแล้ว: หน้าเดียวกันเปลี่ยนเป็น **"ได้รับแล้ว"** บอกชัดว่า *จะเกิดอะไรต่อ / นานแค่ไหน / จะรู้ได้ยังไง* ("เราจะส่งข้อความในแชทนี้เมื่อพร้อมใช้") + ปุ่ม "ปิด"

### 3.3 การรอ (ถ้าโหมด MANUAL) — ต้องไม่เงียบ

- ทันทีหลังส่ง: push ยืนยัน "ได้รับคำขอเปิดร้าน <ชื่อร้าน> แล้ว"
- แอดมินได้แจ้งเตือนคิวตามเดิม (dashboard + LINE) พร้อมป้าย "จาก LINE"
- ระหว่างรอ ผู้ใช้พิมพ์อะไรมา → การ์ดสถานะ (§3.1) ไม่ใช่ unlinked reply
- โหมด **AUTO_FREE** (§10): ไม่มีการรอ — ข้ามไป §3.4 ทันที; แอดมินเห็นแถว "อนุมัติอัตโนมัติ" ไว้ตรวจย้อนหลังและระงับได้

### 3.4 อนุมัติ → พร้อมใช้ทันที

- provisioning สร้างบริษัท+เจ้าของ (§6) และ **ผูก `ExternalIdentity` LINE ให้เสร็จในธุรกรรมเดียวกัน** → LINE AI ใช้ได้ทันที (webhook หาตัวตนเจอ)
- push ข้อความต้อนรับ: "ร้าน <ชื่อร้าน> พร้อมใช้แล้ว" + ปุ่ม **"เริ่มใช้งาน"** → LIFF `https://liff.line.me/<LINE_LIFF_ID>/start` (URL กลาง ไม่มี token) + บรรทัด "ลองเลย: ส่งรูปใบเสร็จมาในแชทนี้ได้ทันที" (aha moment โดยไม่ต้องเปิดเว็บ)

### 3.5 "เริ่มใช้งาน" = แตะแล้วอยู่ในระบบ ไม่มีหน้า login

LIFF `start` → ขอ ID token → `POST /v1/auth/line/liff/session` (§4) → เซิร์ฟเวอร์ตรวจ token → หา `ExternalIdentity` ACTIVE → เลือกบริษัท (ถ้ามีหลายร้าน ใช้ `LineCompanyContext` เดิม หรือให้เลือกในหน้า LIFF) → mint handoff token (15 นาที) → ตอบ URL `/l/<token>` → LIFF เปิดใน**เบราว์เซอร์ภายนอก** (`liff.openWindow({external:true})` — คุกกี้ไปอยู่ใน Safari/Chrome ไม่ใช่ในแอป LINE; บทเรียน QR fix 2026-09-01) → route `/l/[token]` ตั้งคุกกี้ → 303 ไป target

target ครั้งแรก = ด่านยอมรับข้อกำหนด (guard เดิมพาไป `/legal-acceptance` เอง) → แล้วต่อไป **หน้า "ทำสิ่งแรกให้สำเร็จ"** = อัปโหลด/ส่งใบเสร็จใบแรก ไม่ใช่ dashboard เปล่า

### 3.6 ของ "ทีหลัง" — progressive profiling (ไม่อยู่ในฟอร์มสมัคร)

| ข้อมูล | ถามเมื่อ | ทำไมลูกค้ายอมให้ |
|---|---|---|
| อีเมล | ตั้งค่า → "รับสำเนา/สำรองบัญชี" หรือครั้งแรกที่ขอส่งออกรายงาน | เห็นประโยชน์ทันที |
| รหัสผ่าน | ตั้งค่า → "เข้าใช้บนคอมโดยไม่ใช้มือถือ" (ทางเลือก; บนคอมมี QR สแกนอยู่แล้ว) | ไม่บังคับใคร |
| เลขผู้เสียภาษี/VAT | ครั้งแรกที่จะออกเอกสารภาษี | จำเป็นจริงตอนนั้น |
| เบอร์โทร | ตอนแอดมินต้องติดต่อ (ขอผ่านการ์ด LINE) | เข้าใจเหตุผล |

อีเมลที่ตั้งทีหลังต้องผ่าน `EmailVerificationToken` เดิม; ถ้าอีเมลนั้นเป็นของ User อื่นที่มีอยู่ → เสนอ "รวมบัญชี" ผ่าน `AccountMergeTicket` เดิม (P10 §4F) ไม่ผูกอัตโนมัติ

### 3.7 ปฏิเสธ / ระงับ

- Reject: push ข้อความนุ่ม ไม่เปิดเหตุผลภายใน + ทางไปต่อ ("ติดต่อ 098-256-5628 หรือส่งข้อมูลเพิ่มในแชทนี้") — **ค่าเริ่มต้น = แจ้ง** (ต่างจาก Flow B ที่เงียบ เพราะที่นี่ตัวตนพิสูจน์แล้วและเป็นแชทของเขาเอง) — Owner ยืนยัน §13
- Suspend หลัง auto-approve: state `SUSPENDED` เดิม + company DISABLED → LINE AI ตอบข้อความระงับ (แนว expired-owner เดิม)

## 4. สัญญา (API / LIFF)

ทุก endpoint ใหม่อยู่ใต้ flag `LINE_SIGNUP_ENABLED` (ปิด = 403 `line_signup_disabled` แบบเดียวกับ `external_signup_disabled`)

| ทาง | เมธอด/เส้นทาง | สิทธิ์ | หน้าที่ |
|---|---|---|---|
| LIFF หน้า signup | `GET /v1/auth/line/signup-page` (+ `/signup-page.js` ผ่าน `LIFF_PAGE_SCRIPT` mode `signup`) | `@Public()` | HTML ฟอร์ม 1 ช่อง; ใช้ CSP เดิม |
| ส่งคำขอ | `POST /v1/public/line-signups` body `{ idToken, companyName, businessType?, consentVersion, referralCode? }` | `@Public()` + rate-limit ip + **per-LINE-user** | ตรวจ ID token → สร้าง `CompanySignupRequest` source `line-oa` (§5) → ตอบ `{ requestId, state, existingAccount: boolean }` |
| สถานะของฉัน | `GET /v1/public/line-signups/me` header/body `idToken` | `@Public()` + rate-limit | คำขอล่าสุดของ LINE user นี้ (ใช้โดยหน้า LIFF และการ์ดสถานะ) |
| LIFF หน้า start | `GET /v1/auth/line/start-page` (mode `start`) | `@Public()` | ขอ ID token แล้วเรียก session |
| แลก session | `POST /v1/auth/line/liff/session` body `{ idToken, companyId? }` | `@Public()` + rate-limit ใหม่ `line-liff-session-user` | ตรวจ token → identity ACTIVE → mint handoff → `{ handoffUrl }`; ไม่มี identity → `{ needsSignup: true }` |
| คิวแอดมิน | เดิม `GET /system/signup-requests` + `decision` | เดิม | DTO เพิ่ม `source`, `lineDisplayName`, `linePictureUrl?`, `autoApproved` |
| ระงับ | เดิม decision `SUSPEND` (ถ้ายังไม่มี ให้เพิ่มใน `decide`) | `system.company_onboarding.create` | ใช้กับแถว auto-approve |

ตัวตรวจ ID token = ตัวเดียวกับ `complete-employee-line-link` (audience = `LINE_LIFF_ID`/Login channel เดิม, AUTH-02); ห้ามเชื่อค่าใดๆ จาก client นอกจาก token

Contract types ใน `packages/contracts/src/external-signup.ts` (FROZEN สำหรับ Flow B — เพิ่มได้แบบ additive เท่านั้น): `LineSignupSubmitDto`, `LineSignupStatusDto`, ขยาย `AdminSignupQueueItemDto` ด้วย field optional ข้างต้น

## 5. Durable state

ใช้ตาราง+enum เดิม เพิ่มคอลัมน์บน `CompanySignupRequest` (migration additive):

- `source` ค่าใหม่ `'line-oa'` (คอลัมน์มีอยู่ default `official-site`)
- `lineProviderUserId String?`, `lineChannelId String?`, `lineDisplayName String?`, `linePictureUrl String?` — **index** `(lineChannelId, lineProviderUserId, state)`; กติกา app-level: **1 LINE user มีคำขอ open (RECEIVED/VALIDATED/PENDING_REVIEW/PROVISIONING) ได้ครั้งละ 1** (ตรวจใน use-case ภายในธุรกรรม)
- `contactEmail` เปลี่ยนเป็น **nullable** (Flow B ยังบังคับกรอกที่ validator ชั้นบน; DB ไม่บังคับ) — `mxValid` เป็น null เมื่อไม่มีอีเมล
- `autoApproved Boolean @default(false)`, `approvedByUserId` = null เมื่ออัตโนมัติ (audit actor = `line-signup-auto-approve`)

ลำดับสถานะ source `line-oa` (ใช้ค่าจาก enum เดิม ไม่เพิ่มค่า):

```text
RECEIVED
  → VALIDATED         (schema + rate limit + dedupe "LINE นี้มีบัญชี/คำขอค้างไหม" — ไม่มี MX ไม่มีอีเมล)
  → PENDING_REVIEW    (MANUAL: เข้าคิว + แจ้งแอดมิน + push "ได้รับแล้ว")
  → PROVISIONING      (แอดมินอนุมัติ หรือ AUTO_FREE ข้ามคิว: VALIDATED → PROVISIONING ทันที)
  → READY → COMPLETED (ExternalIdentity ผูกในธุรกรรม provisioning → ข้าม LINE_LINK_PENDING; push "พร้อมใช้")

ข้างเคียง: REJECTED (จาก PENDING_REVIEW; push แจ้งเป็นค่าเริ่มต้น)
          / PROVISIONING_FAILED (ปล่อย fence, retry idempotent) / SUSPENDED (หลัง auto-approve)
ไม่ใช้กับ source นี้: EMAIL_PENDING, EMAIL_VERIFIED, EMAIL_FAILED, EXPIRED, LINE_LINK_PENDING
```

`TRANSITIONS` ใน `company-signup.logic.ts` ต้องแยกตาม source (Flow B ห้ามข้าม EMAIL_*; line-oa ห้ามเข้า EMAIL_*) — ทดสอบทั้งสองตาราง

`attachUserId`: ตั้งค่า**ตอน submit** เมื่อ ID token map ไป `ExternalIdentity` ACTIVE ของ User ที่ ACTIVE อยู่แล้ว (หลักฐานแรงกว่า mailbox) → provisioning เดิน `attachedExistingOwner` (เพิ่มร้านที่ 2 ให้ User เดิม) และการ์ดตอบ "เพิ่มร้านที่ 2 ให้บัญชีของคุณ" ไม่ใช่ "สร้างบัญชีใหม่"

## 6. Provisioning delta (ใน `CreateCompanyOnboardingUseCase` เดิม)

เพิ่ม input แบบ additive `ownerAuth: { kind: 'password' } | { kind: 'line', providerUserId, channelId, displayName }` (ค่าเดิม = password):

- `kind: 'line'` → สร้าง `User` โดย `username = null`, `email = null`, `displayName` จาก LINE, **ไม่สร้าง `UserCredential`** (ไม่มี temporary password — LINE-ONBOARD-01), สร้าง `ExternalIdentity` ACTIVE ในธุรกรรมเดียวกัน (ชน unique → คือเคส attach ที่ควรถูกจับตั้งแต่ §5 → ถือเป็นบั๊ก ต้อง fail ธุรกรรมและปล่อย fence)
- `attachUserId` มา → ไม่สร้าง User/ExternalIdentity ใหม่ (พฤติกรรม `attachedExistingOwner` เดิม)
- `modulePackage: 'starter'` เดิม; plan term = **preset ใหม่ `FREE`** (ค่า Owner §13 — ค่าเริ่มต้นเสนอ: `tierKey 'FREE'`, `monthlySlipLimit` ต่ำ, `branchLimit 1`, `employeeLimit` เล็ก, `termEndsAt` = ไกล/ไม่ใช้ P29 ladder) — ต่างจาก Flow B ที่ให้ `PRO_999` 30 วัน
- `CompanyOnboardingRun` ยังถูกสร้าง (ตาม use-case เดิม) เพื่อให้ปุ่ม Reissue owner LINE QR ในหน้า system ใช้ได้กับร้านจาก LINE ด้วย
- ผลลัพธ์ `temporaryPassword` ต้องเป็น `undefined` สำหรับ `kind:'line'` และ**ห้าม**หลุดไปใน response/log/push
- Password login กับ User ที่ไม่มี credential = ตอบเหมือน "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" (ไม่บอกว่าไม่มีรหัส); `mustChangePassword` gate ไม่เกี่ยว (ไม่มี credential)

## 7. ข้อความ LINE (copy ร่าง — Owner แก้ได้)

| จังหวะ | ข้อความ | ปุ่ม |
|---|---|---|
| ประตู (unlinked) | "สวัสดีค่ะ ยังไม่ได้เชื่อมบัญชีมั่งมีพลัสกับ LINE นี้ เลือกทางที่ตรงกับคุณได้เลย" | เปิดร้านใหม่ ใช้ฟรี / ฉันเป็นพนักงาน / มีบัญชีอยู่แล้ว |
| ได้รับคำขอ | "ได้รับคำขอเปิดร้าน **<ชื่อร้าน>** แล้ว กำลังตรวจสอบ ปกติไม่เกิน 1 ชั่วโมงในเวลาทำการ พร้อมเมื่อไหร่จะแจ้งในแชทนี้" | — |
| พร้อมใช้ | "ร้าน **<ชื่อร้าน>** พร้อมใช้แล้ว 🎉 ลองส่งรูปใบเสร็จมาในแชทนี้ได้เลย หรือกดเปิดหน้าเว็บ" | เริ่มใช้งาน (LIFF start) |
| เพิ่มร้านที่ 2 | "เพิ่มร้าน **<ชื่อร้าน>** ให้บัญชีของคุณแล้ว สลับร้านได้ในเมนู" | เริ่มใช้งาน |
| ปฏิเสธ | "ขออภัย ยังเปิดร้าน <ชื่อร้าน> ให้ไม่ได้ในตอนนี้ ติดต่อ 098-256-5628 หรือส่งข้อมูลเพิ่มในแชทนี้ได้เลย" | — |

ทุกปุ่มเป็น URL LIFF กลาง (ไม่มี token); handoff เกิดตอนแตะ (§3.5)

## 8. คิวแอดมิน (delta)

- แถวจาก LINE: ป้าย "LINE" + ชื่อ/รูปโปรไฟล์ + ชื่อร้าน + ประเภท (ถ้ามี) + ref + hint "LINE นี้มีบัญชีอยู่แล้ว → จะเพิ่มเป็นร้านที่ 2"
- ไม่มีข้อมูล MX/อีเมล/เบอร์ (ช่องว่าง "—" ตามกติกา 2026-09-01)
- ปุ่ม Approve/Reject เดิม; Reject มี toggle "แจ้งทางไลน์" **เปิดเป็นค่าเริ่มต้น**
- โหมด AUTO_FREE: แท็บ/ตัวกรอง "อนุมัติอัตโนมัติ (N รายวันนี้)" + ปุ่ม **ระงับ** ต่อแถว; SLA เตือน 24 ชม. ของ PENDING_REVIEW ใช้เดิม
- หน้า `/system/users` (lookup) แสดง LINE-only user ได้ (ไม่มี username/email — โชว์ displayName + ป้าย LINE)

## 9. ความปลอดภัย / PDPA / การปั่น

- **ตัวตน:** เชื่อเฉพาะ ID token ที่ตรวจลายเซ็นและ audience ฝั่งเซิร์ฟเวอร์; `providerChannelId` ต้องเท่ากับ channel ของเรา; token หมดอายุ → 401 ให้ LIFF ขอใหม่
- **Rate limit ใหม่:** `line-signup-user` 3/วัน ต่อ LINE userId, `line-signup-ip` 20/ชม., `line-liff-session-user` 30/ชม.; อ่านสถานะ 60/ชม.
- **1 LINE = 1 คำขอค้าง** (§5) และ `ExternalIdentity` unique = 1 LINE = 1 บัญชี; ร้านที่ 2+ ผ่าน attach เท่านั้น
- **AUTO_FREE guardrails:** เพดานอนุมัติอัตโนมัติต่อวัน `LINE_SIGNUP_AUTO_DAILY_CAP` (เกิน → ตกเป็น MANUAL อัตโนมัติ + แจ้งแอดมิน); Free quota ต่ำจริง; ระงับได้ทันทีจากคิว; ทุกอย่าง audit (`signup.line.submitted / auto_approved / suspended`)
- **PDPA:** pre-consent เก็บ `consentVersion` + เวลาบนคำขอ; การยอมรับที่มีผลผูกพันคือ `LegalDocumentActionRecord` ตอนแตะเข้าครั้งแรก (guard เดิม, การ์ด LINE เดิมถ้าใช้ AI ก่อนเปิดเว็บ); ข้อมูล LINE profile (ชื่อ/รูป) เก็บเพื่อแสดงตัวตนในคิวและบัญชี — ระบุใน privacy notice ข้อ "ข้อมูลจาก LINE"
- **ไม่มีข้อมูลส่วนตัวใน URL** (ไม่มี token/ชื่อใน query) ยกเว้น `ref` code สาธารณะ
- LIFF page ใช้ CSP เดิม (`LIFF_PAGE_CSP`) ห้าม inline script นอก `LIFF_PAGE_SCRIPT`

## 10. Config & rollout

| ตัวแปร | ค่า UAT | ค่า production (จนกว่า Owner สั่ง) |
|---|---|---|
| `LINE_SIGNUP_ENABLED` | `true` | `false` — `true` บน prod = deploy.sh exit 2 แบบเดียวกับ `EXTERNAL_SIGNUP_ENABLED` |
| `LINE_SIGNUP_APPROVAL_MODE` | `MANUAL` (ทดสอบทั้งสองโหมด) | `MANUAL` |
| `LINE_SIGNUP_AUTO_DAILY_CAP` | `20` | `20` |
| `LINE_LIFF_ID` เดิม | มี | มี |

deploy.sh เป็นไฟล์ pinned → แก้แล้วต้อง `node infra/security/sync-production-maintenance-release-pins.mjs`; rich menu v2 ตั้งปุ่ม "สมัครใช้งานฟรี" ผ่าน console ตาม runbook เดิม (ไม่มีโค้ด)

ลำดับส่งมอบ (แต่ละ slice = PR เดียว, verify ก่อนต่อ):
- **Slice L-A (backend core):** migration + submit/status use-cases + ID-token verify reuse + TRANSITIONS แยก source + provisioning `ownerAuth` + FREE preset + tests
- **Slice L-B (LIFF + handoff):** LIFF modes `signup`/`start` + `/v1/auth/line/liff/session` + การ์ด 3 ประตู/สถานะใน webhook + push ทุกจังหวะ
- **Slice L-C (admin + flags):** คิว delta + AUTO_FREE + suspend + deploy.sh wiring + pins + UAT deploy
- **Phase 2 (แยก spec เล็ก):** rich menu ต่อผู้ใช้ตามสถานะ (Messaging API link rich menu), "ลองอ่านใบเสร็จระหว่างรอ" (OCR ไม่มี company context), อีเมลต้อนรับเมื่อผู้ให้บริการเมลพร้อม

## 11. Gates / tests (ต้องมีหลักฐานจริงก่อนปิดงาน)

Unit/integration (api):
- TRANSITIONS: line-oa ห้ามเข้า EMAIL_*; official-site ห้ามข้าม EMAIL_* (ตารางทั้งสอง)
- submit: token ปลอม/หมดอายุ/คนละ channel → 401; LINE เดิมมีคำขอค้าง → 409; LINE เดิมมีบัญชี → `attachUserId` ตั้ง + `existingAccount:true`
- provisioning idempotent: approve ซ้ำ/retry หลัง fail → บริษัทเดียว, ExternalIdentity เดียว, ไม่มี UserCredential, `temporaryPassword` undefined
- AUTO_FREE: VALIDATED → PROVISIONING โดยไม่มีแถวคิว; เกิน daily cap → PENDING_REVIEW + แจ้ง
- webhook: unlinked → การ์ด 3 ประตู; มีคำขอค้าง → การ์ดสถานะ; หลังอนุมัติ → ตอบปกติ (identity เจอ)
- liff/session: identity ACTIVE → handoffUrl ใน `/l/`; ไม่มี identity → needsSignup; rate limit
- legal: User ใหม่จาก LINE ถูก guard พาไป legal-acceptance ก่อนทุก route อื่น (ยกเว้น exempt เดิม)

Web/E2E: หน้า system queue แสดงแถว LINE + ปุ่ม suspend; `/system/users` แสดง LINE-only user; `/l/<token>` จาก session endpoint ลงหน้าเป้าหมาย (mock LIFF ด้วยการยิง endpoint ตรง — LIFF จริงทดสอบใน UAT ด้วยมือตาม test plan)

UAT (มือ, มือถือจริง): add OA → การ์ด → สมัคร 1 ช่อง → (MANUAL) push ได้รับ → อนุมัติ → push พร้อมใช้ → แตะเริ่มใช้งาน → ยอมรับข้อกำหนด → ส่งใบเสร็จใบแรกทาง LINE สำเร็จ; ซ้ำด้วยโหมด AUTO_FREE; เคสพนักงาน; เคสมีบัญชีแล้ว (ร้านที่ 2); เคสปฏิเสธ

Funnel metrics ที่ต้องมีตั้งแต่วันแรก (audit/outbox → หน้าสรุปเล็กใน system ภายหลัง): `card_shown → liff_opened → submitted → approved(auto|manual) → first_receipt → active_week2`

## 12. สิ่งที่ไม่ทำในรอบนี้

Paid tier / ชำระเงิน (P10 §4E); rich menu ต่อผู้ใช้; OCR ระหว่างรอ; อีเมลต้อนรับ (จนกว่าผู้ให้บริการเมลพร้อม — ทางสำรอง Resend จดไว้แล้ว); พนักงานสมัครเองเข้าร้านที่มีอยู่ (ยังใช้ employee link ที่เจ้าของออก); เปลี่ยนแปลง Flow B เว็บฟอร์มเดิม (คงอยู่คู่กัน — ลูกค้าจากเว็บทางการยังใช้ได้)

## 13. คำถาม Owner (ตอบแล้วค่อยเริ่ม Slice L-A)

1. **Free tier:** แพ็กเกจ "เริ่มต้น" ไม่มีวันหมดอายุ + โควตาต่ำ (เสนอ: สลิป 30 ใบ/เดือน, 1 สาขา, พนักงาน 2 คน) — หรือทดลอง 30 วันแบบ Flow B?
2. **โหมดวันแรก:** MANUAL (คุณอนุมัติเอง มี SLA 1 ชม.) หรือ AUTO_FREE ตั้งแต่เปิด? (เสนอ MANUAL 2 สัปดาห์แรก ดูคุณภาพ แล้วสลับ AUTO_FREE)
3. **Reject แจ้งทางไลน์เป็นค่าเริ่มต้น** — ยืนยัน?
4. **ประเภทธุรกิจ** เป็น chip ไม่บังคับในฟอร์ม หรือตัดออกให้เหลือ 1 ช่องจริงๆ?
5. **ชื่อ/รูปโปรไฟล์ LINE** แสดงในคิวแอดมินและบัญชี — โอเคตาม privacy notice?
6. **เพดาน auto ต่อวัน** 20 พอไหม?
7. **SLA ที่บอกลูกค้า** "ไม่เกิน 1 ชั่วโมงในเวลาทำการ" — ทำได้จริงไหม (ถ้าไม่ ให้บอกเป็น "ภายในวันนี้")

## 14. เหตุผลเชิง UX/BA (หลักฐาน)

- LINE OA: ข้อความเปิดอ่าน 60–80% vs อีเมล 15–20%; 85% ของผู้บริโภคไทยคุยกับแบรนด์ทาง LINE OA ก่อนเข้าเว็บ; SME = 90% ของผู้ถือ LINE OA — [Sphere Agency, LINE OA Setup Guide Thailand 2026](https://sphereagency.com/articles/line-oa-setup-guide-thailand), [Bangkok Post](https://www.bangkokpost.com/business/general/2272307/line-oa-signups-surge-as-smes-go-digital)
- ฟอร์ม: 3 ช่องแปลงดีสุด (~25%); ทุกช่องเพิ่มลด ~4.1%; หน้าผาช่วง 5→7 ช่อง — [HubSpot](https://blog.hubspot.com/marketing/optimize-conversion-forms), [Form conversion benchmarks 2026](https://www.digitalapplied.com/blog/form-conversion-rate-benchmarks-2026-data-points)
- ป้าย "ไม่บังคับ" ดีกว่าดอกจันบังคับ ~25% (Baymard 2024) — [สรุปโดย Brixon](https://brixongroup.com/en/lead-forms-in-b2b-the-perfect-balancing-act-between-data-depth-and-conversion-rate)
- Onboarding: one-tap/SSO, ข้ามได้, progressive disclosure, ค่าเริ่มต้นฉลาด — [Appcues](https://www.appcues.com/blog/mobile-onboarding-best-practices)
- บทเรียนภายใน: LINE in-app browser คุกกี้แยกจาก Safari/Chrome (QR fix 2026-09-01) → ทุกลิงก์เข้าเว็บจาก LINE ต้องเปิดภายนอก; พนักงานไม่มีอีเมล → กับดักบัญชีซ้ำ (P10 §4F) → ประตู "ฉันเป็นพนักงาน"
