# Auto-register จาก LINE OA (LINE-first Signup) — Spec P10-L

สถานะ: **DRAFT v2 — 2026-09-04** (v1 ผ่านมุม UX/BA; v2 รวมมุมความปลอดภัย, support, ความคุ้มค่า — Owner เคาะ "ยอมรับข้อกำหนดบน LIFF ได้เลย" และ "โปรโมชั่นแบบลูกค้ากดดูเอง ไม่ broadcast"); ยังไม่ implement
เจ้าของ: Owner (มั่งมีพลัส) / ผู้เขียน: Claude (Fable)
ความสัมพันธ์: **companion ของ P10** ([mangmee-external-signup-contract-spec-th.md](mangmee-external-signup-contract-spec-th.md)) — P10 §4F จดไว้แล้วว่า "ฟอร์มเวอร์ชัน LIFF สำหรับคนสมัครจาก rich menu — รู้ตัวตน LINE ตั้งแต่กรอก" คืองานอนาคต; เอกสารนี้คือการทำงานชิ้นนั้นให้เป็นสัญญา โดย**ไม่หัก**กฎ P10/P11/P12 ที่ production แล้ว
เกี่ยวข้อง: P11 email claim, P12 LINE login/handoff ([line-web-deeplink-handoff-spec.md](line-web-deeplink-handoff-spec.md)), แผนหลัก §13.6 + LINE-ONBOARD-01 + AUTH-02, rich menu v2 ([line-rich-menu-v2-spec.md](line-rich-menu-v2-spec.md)), legal acceptance (challenge-evidence model ใน `legal-acceptance.service.ts`)

**เปลี่ยนจาก v1 → v2:** ยอมรับข้อกำหนดแบบมีผลผูกพันบน LIFF ตอนสมัคร (§3.2/§6 — ทำให้ LINE AI ใช้ได้ทันทีหลังอนุมัติจริงตามที่ push บอก); เส้นกู้บัญชีเมื่อ LINE หาย + ชวนใส่อีเมล/เบอร์วันที่ 7 (§3.6/§9); โควตาอุ่นเครื่อง 7 วัน + งบ AI ต่อร้านฟรี (§9/§10); เครื่องมือ support: timeline ต่อร้าน, ค้นชื่อ LINE, เตือนคิว 60 นาที, คีย์เวิร์ดติดต่อเจ้าหน้าที่ (§8); นโยบายข้อความ reply-first + โปรโมชั่นแบบ pull เท่านั้น + ปุ่ม "ขอเปลี่ยนแพ็กเกจ" (§7/§8/§9); หน้าสรุป funnel + ต้นทุนต่อร้านเป็นเงื่อนไขก่อน AUTO_FREE (§11); ตัด consent การตลาดออกโดยการออกแบบ (§12)

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
| Push/Reply ข้อความหา LINE userId (env channel token) | `line-reply.adapter.ts:43-45`, `auth/infrastructure/system-line-push.ts:8` | แจ้งสถานะ; นโยบาย reply-first (§7) |
| Unlinked-user reply ใน webhook | `process-line-webhook.use-case.ts:1799-1802`, copy `:154` | เปลี่ยนเป็นการ์ด 3 ประตู (§3.1) |
| ด่านยอมรับข้อกำหนด: guard + `LegalDocumentActionRecord` (มี field `surface`, `authProvider`, `displayChallenge`, `statementSha256`, `releaseFingerprintSha256`) + การ์ดใน LINE + หน้าเว็บ `/legal-acceptance` | `auth.guard.ts:33`, `legal-acceptance.service.ts:115,:144,:169`, `line-business-card.logic.ts:303`, `schema.prisma:629` | หลักฐาน PDPA ชุดเดียวกัน แต่เก็บตั้งแต่ LIFF (§3.2/§6) |
| Promotion tile ใน rich menu v2 + การ์ดโปรโมชั่นแบบ reply | `line-staff-menu.logic.ts:171 buildPromotionCard` | โปรโมชั่นแบบลูกค้ากดดูเอง (§7) |
| มิเตอร์เงิน AI ต่อร้าน + งบต่อร้าน | `AiUsageEvent`, `CompanyAiConfiguration.monthlyBudgetSatang` | คุมต้นทุนร้านฟรี (§9/§11) |
| แพ็กเกจ "เริ่มต้น" | `packages/contracts/src/menu-entitlements.ts:421` `.starter` | Free tier |
| Rate-limit buckets ต่อ IP/email | `auth-rate-limit.service.ts:130-154` | เพิ่ม bucket ต่อ LINE userId (ยังไม่มี) |
| Flags `EXTERNAL_SIGNUP_ENABLED`, `LINE_LIFF_ID`, `LINE_WEB_HANDOFF_ENABLED` + deploy.sh wiring (prod hard-stop) | `app-config.service.ts:66-70`; `deploy.sh:184-193,:1515` | เพิ่ม flag ชุด LINE signup แบบเดียวกัน |
| หน้า system: Unlink LINE, Reissue owner LINE QR, `/system/users` | `PartnerDetailPage.tsx`, `SystemOnboardingNewPage.tsx`, `lookup-users.use-case.ts` | เส้นกู้บัญชี (§9) และเครื่องมือ support (§8) |

สิ่งที่**ยังไม่มี** (ต้องสร้าง): คอลัมน์ LINE identity + หลักฐานยอมรับบนคำขอ; LIFF mode `signup`/`start`; endpoint LIFF ID-token → handoff session; per-LINE-user rate limit; การ์ด 3 ประตู; ตัวเลือก auto-approve; timeline ต่อร้าน; คำขอเปลี่ยนแพ็กเกจ; หน้าสรุป funnel/ต้นทุน; rich menu ต่อผู้ใช้ (Phase 2)

## 2. หลักการที่ห้ามละเมิด (สืบทอด P10 + เพิ่มของ P10-L)

1. **SIGNUP-01 คงเดิม:** ทุก retry เดินต่อจาก state เดิมแบบ idempotent — ห้ามสร้าง Company/User/Membership/ExternalIdentity/LegalDocumentActionRecord ซ้ำ
2. **SIGNUP-02 ตีความใหม่สำหรับ source นี้:** "ไม่ provision จนกว่าจะพิสูจน์ว่ามีคนจริง" — ใน Flow B พิสูจน์ด้วย mailbox; ใน P10-L พิสูจน์ด้วย **LIFF ID token ที่เซิร์ฟเวอร์ตรวจแล้ว** (คนคนนั้นอยู่ในแชท OA ของเราจริง ณ ตอนกรอก) → provision ได้ทันทีหลังอนุมัติ ไม่มีขั้น claim
3. **LINE-ONBOARD-01 คงเดิมและเข้มขึ้น:** ไม่มี temporary password, ไม่มี token ส่วนตัวในข้อความ LINE/อีเมล — ปุ่มทุกปุ่มที่ส่งไปคือ URL LIFF **กลาง** (ไม่มี token) แล้ว mint handoff **ตอนแตะ**
4. **AUTH-02 คงเดิม:** LIFF ใช้ credential ชุดเดียว (`LINE_LIFF_ID` + Messaging channel เดิม)
5. **ไม่ถามรหัสผ่านและอีเมลตอนสมัคร** — ตั้งได้ทีหลังจากหน้าตั้งค่า พร้อมเหตุผลที่ลูกค้าเข้าใจ (§3.6)
6. Provision ผ่าน `CreateCompanyOnboardingUseCase` เดิมเท่านั้น (กฎสร้างบริษัทชุดเดียว) — ขยาย input ไม่ทำทางลัด
7. การเข้าใช้งาน**ต้องไม่พึ่งอีเมลในทุกขั้น** — อีเมลใน flow นี้เป็นใบเสร็จ/สำเนา ล้มเหลวได้โดยไม่กระทบ state
8. **LEGAL-LIFF-01 (Owner 2026-09-04):** การยอมรับข้อกำหนดแบบมีผลผูกพันเกิด**บน LIFF ตอนสมัคร** โดยใช้หลักฐาน**ชุดเดียวกับในแอป** (เวอร์ชันเอกสาร + statementSha256 + releaseFingerprint + displayChallenge + เวลา + ตัวตน LINE + userAgent/locale) และถูกบันทึกเป็น `LegalDocumentActionRecord` ตอน provisioning — ห้ามมี "ยอมรับแบบอ่อน" ที่ไม่มีหลักฐานเทียบเท่า
9. **MSG-01 reply-first:** ข้อความถึงลูกค้าใช้ reply (ฟรี ไม่กินโควตา OA) ทุกครั้งที่มี reply token; push ใช้เฉพาะเหตุการณ์ที่ลูกค้าไม่ได้เป็นฝ่ายเริ่ม (อนุมัติ/ปฏิเสธ/ระงับ) และ**ไม่มี broadcast/โฆษณาเชิงรุก** — โปรโมชั่นเป็นแบบลูกค้ากดดูเองเท่านั้น จึงไม่ต้องมี consent การตลาด

## 3. Journey ฝั่งลูกค้า (ทุกจอต้องผ่านมือถือ 390px, ภาษาไทยธรรมดา, ห้ามมีเครื่องหมาย "+")

### 3.1 ประตูเข้า — การ์ด 3 ประตู (แทน unlinked reply เดิม; ส่งเป็น reply)

เมื่อ LINE user ที่ยังไม่ผูกบัญชีส่งข้อความใดๆ (หรือ add เพื่อนแล้วได้ greeting) ระบบตอบการ์ดเดียว:

- **"เปิดร้านใหม่ ใช้ฟรี"** → LIFF `https://liff.line.me/<LINE_LIFF_ID>/signup`
- **"ฉันเป็นพนักงาน"** → ข้อความสั้น: ให้เจ้าของร้านส่งลิงก์เชื่อม LINE จากเมนู "พนักงาน" (ใช้ระบบ employee link เดิม) — ปิดกับดัก "พนักงานเผลอสมัครร้านซ้ำ"
- **"มีบัญชีอยู่แล้ว เชื่อม LINE"** → LIFF account link-page เดิม (`GET /v1/auth/line/link-page`)

ถ้า LINE user นี้มีคำขอค้าง (§5) การ์ดเปลี่ยนเป็น**การ์ดสถานะ**: "ได้รับคำขอแล้ว กำลังตรวจสอบ ปกติไม่เกิน 1 ชั่วโมงในเวลาทำการ" (SLA ปรับได้ตาม §13; นอกเวลาทำการใช้ข้อความ "จะดูให้ในเช้าวันทำการถัดไป")

### 3.2 ฟอร์ม LIFF `signup` — 1 ช่อง + ยอมรับข้อกำหนด (มีผลผูกพัน)

- หัว: รูป+ชื่อจากโปรไฟล์ LINE ("สวัสดีคุณ นิด") — ดึงจาก `liff.getProfile()` ฝั่ง client แสดงเท่านั้น; ค่าที่เชื่อถือได้มาจาก ID token ที่เซิร์ฟเวอร์ตรวจ
- ช่องเดียว: **ชื่อร้าน** (บังคับ, 1–120 ตัวอักษร, ซ้ำกับร้านอื่นได้ตาม P10 §4C)
- ตัวเลือกเสริมแบบ chip แตะได้ ไม่บังคับ: **ประเภทธุรกิจ** (map เข้า `businessType` เดิม) — ไม่มีช่องพิมพ์เพิ่ม
- **บล็อกยอมรับข้อกำหนด (LEGAL-LIFF-01):** หน้า LIFF ถูกเรนเดอร์จาก API จึงฝัง**ข้อความยอมรับฉบับปัจจุบัน** (statement text + เวอร์ชัน + ลิงก์ประกาศความเป็นส่วนตัว/ข้อกำหนด) และ **displayChallenge** แบบเดียวกับหน้า `/legal-acceptance` ในแอป; ปุ่มเดียว **"ยอมรับและสมัครใช้งานฟรี"**; การแตะ = ส่ง `{ documentVersion, statementSha256, releaseFingerprintSha256, displayChallenge, locale }` กลับพร้อมฟอร์ม; เซิร์ฟเวอร์ตรวจว่าตรงกับ release ปัจจุบัน (ไม่ตรง → 409 ให้โหลดหน้าใหม่) แล้วเก็บเป็นหลักฐานบนคำขอ (§5) — เวลาที่ยอมรับ = เวลาที่เซิร์ฟเวอร์รับ ไม่ใช่เวลาจาก client
- **ไม่มี** ช่องอีเมล เบอร์โทร รหัสผ่าน เลขภาษี — ถามทีหลังในจังหวะที่มีเหตุผล (§3.6)
- ถ้า `?ref=<code>` มากับ LIFF URL (QR อินฟลูฯ ตาม §13.6B) → เก็บ `referralCode` เดิม
- ส่งแล้ว: หน้าเดียวกันเปลี่ยนเป็น **"ได้รับแล้ว"** บอกชัดว่า *จะเกิดอะไรต่อ / นานแค่ไหน / จะรู้ได้ยังไง* ("เราจะส่งข้อความในแชทนี้เมื่อพร้อมใช้") + ปุ่ม "ปิด"

### 3.3 การรอ (ถ้าโหมด MANUAL) — ต้องไม่เงียบ

- ทันทีหลังส่ง: หน้า LIFF แสดง "ได้รับแล้ว" (ไม่ต้อง push — MSG-01); ถ้าผู้ใช้พิมพ์อะไรมา → reply การ์ดสถานะ (§3.1)
- แอดมินได้แจ้งเตือนคิวตามเดิม (dashboard + LINE) พร้อมป้าย "จาก LINE"; **ค้างเกิน 60 นาทีในเวลาทำการ → เตือนแอดมินซ้ำทาง LINE อีกครั้ง** (exactly-once ต่อคำขอ)
- โหมด **AUTO_FREE** (§10): ไม่มีการรอ — ข้ามไป §3.4 ทันที; แอดมินเห็นแถว "อนุมัติอัตโนมัติ" ไว้ตรวจย้อนหลังและระงับได้

### 3.4 อนุมัติ → พร้อมใช้ทันที (จริง)

- provisioning สร้างบริษัท+เจ้าของ (§6), **ผูก `ExternalIdentity` LINE และบันทึก `LegalDocumentActionRecord` ในธุรกรรมเดียวกัน** → LINE AI ใช้ได้ทันที: webhook หาตัวตนเจอและด่านยอมรับผ่านแล้ว (ไม่มีการ์ด "ยอมรับข้อกำหนดก่อน" สำหรับคนที่มาจาก flow นี้)
- push (1 ครั้ง — เหตุการณ์เดียวที่ต้อง push): "ร้าน <ชื่อร้าน> พร้อมใช้แล้ว" + ปุ่ม **"เริ่มใช้งาน"** → LIFF `https://liff.line.me/<LINE_LIFF_ID>/start` (URL กลาง ไม่มี token) + บรรทัด "ลองเลย: ส่งรูปใบเสร็จมาในแชทนี้ได้ทันที" — ประโยคนี้เป็นจริงเพราะ §3.2/§6

### 3.5 "เริ่มใช้งาน" = แตะแล้วอยู่ในระบบ ไม่มีหน้า login

LIFF `start` → ขอ ID token → `POST /v1/auth/line/liff/session` (§4) → เซิร์ฟเวอร์ตรวจ token → หา `ExternalIdentity` ACTIVE → เลือกบริษัท (ถ้ามีหลายร้าน ใช้ `LineCompanyContext` เดิม หรือให้เลือกในหน้า LIFF) → mint handoff token (15 นาที) → ตอบ URL `/l/<token>` → LIFF เปิดใน**เบราว์เซอร์ภายนอก** (`liff.openWindow({external:true})` — คุกกี้ไปอยู่ใน Safari/Chrome ไม่ใช่ในแอป LINE; บทเรียน QR fix 2026-09-01) → route `/l/[token]` ตั้งคุกกี้ → 303 ไป target

target ครั้งแรก = **หน้า "ทำสิ่งแรกให้สำเร็จ"** (อัปโหลด/ส่งใบเสร็จใบแรก) ไม่ใช่ dashboard เปล่า; ด่าน `/legal-acceptance` จะโผล่**เฉพาะ**เมื่อมี release ข้อกำหนดใหม่กว่าที่ยอมรับไว้ (พฤติกรรม guard เดิม)

### 3.6 ของ "ทีหลัง" — progressive profiling (ไม่อยู่ในฟอร์มสมัคร)

| ข้อมูล | ถามเมื่อ | ทำไมลูกค้ายอมให้ |
|---|---|---|
| **อีเมลหรือเบอร์ "กันหลุด"** | **วันที่ 7 หลังใช้จริง** (หรือหลังส่งใบเสร็จครบ 5 ใบ แล้วแต่ถึงก่อน) — การ์ดใน LINE 1 ใบ exactly-once: "ใส่อีเมลหรือเบอร์ไว้ เผื่อเปลี่ยนมือถือแล้ว LINE หลุด" [ใส่เลย] [ไว้ก่อน] | เห็นความเสี่ยงของตัวเอง ไม่ใช่ของเรา |
| อีเมล (ใช้งาน) | ตั้งค่า → "รับสำเนา/สำรองบัญชี" หรือครั้งแรกที่ขอส่งออกรายงาน | เห็นประโยชน์ทันที |
| รหัสผ่าน | ตั้งค่า → "เข้าใช้บนคอมโดยไม่ใช้มือถือ" (ทางเลือก; บนคอมมี QR สแกนอยู่แล้ว) | ไม่บังคับใคร |
| เลขผู้เสียภาษี/VAT | ครั้งแรกที่จะออกเอกสารภาษี | จำเป็นจริงตอนนั้น |
| เบอร์โทร | ตอนแอดมินต้องติดต่อ (ขอผ่านการ์ด LINE) | เข้าใจเหตุผล |

อีเมลที่ตั้งทีหลังต้องผ่าน `EmailVerificationToken` เดิม; ถ้าอีเมลนั้นเป็นของ User อื่นที่มีอยู่ → เสนอ "รวมบัญชี" ผ่าน `AccountMergeTicket` เดิม (P10 §4F) ไม่ผูกอัตโนมัติ; เบอร์โทร "กันหลุด" เก็บบน User เป็นข้อมูลติดต่อ (ไม่ใช่ OTP login ในรอบนี้)

### 3.7 ปฏิเสธ / ระงับ / ชนโควตา / ขอเปลี่ยนแพ็กเกจ

- **Reject:** push ข้อความนุ่ม ไม่เปิดเหตุผลภายใน + ทางไปต่อ ("ติดต่อ 098-256-5628 หรือส่งข้อมูลเพิ่มในแชทนี้") — **ค่าเริ่มต้น = แจ้ง** (ต่างจาก Flow B ที่เงียบ เพราะที่นี่ตัวตนพิสูจน์แล้วและเป็นแชทของเขาเอง) — Owner ยืนยัน §13
- **Suspend หลัง auto-approve:** state `SUSPENDED` เดิม + company DISABLED → LINE AI ตอบข้อความระงับ (แนว expired-owner เดิม)
- **ชนโควตา Free (ข้อความบริการ ส่ง 1 ครั้งตอนชนจริง — ไม่เตือนซ้ำรายวัน):** reply/การ์ด "เดือนนี้ใช้ครบ N ใบแล้ว" + ปุ่ม **"ดูแพ็กเกจ"** (LIFF/การ์ดโปรโมชั่น — pull) และ **"ขอเปลี่ยนแพ็กเกจ"** → สร้าง **คำขอเปลี่ยนแพ็กเกจ** เข้าคิวแอดมิน (§8) — การชำระเงินช่วงแรกทำมือในแชทเดิม + แอดมินเปิดแพ็กเกจจากหน้า partner; ระบบจ่ายอัตโนมัติเป็นของ P10 §4E/P26 ภายหลัง
- **โปรโมชั่น = pull เท่านั้น:** ปุ่ม Promotion ใน rich menu / พิมพ์ "โปรโมชั่น" → reply การ์ดโปรโมชั่น (มีอยู่แล้ว) + ปุ่ม "ขอเปลี่ยนแพ็กเกจ"; **ไม่มี broadcast** ทุกกรณี

## 4. สัญญา (API / LIFF)

ทุก endpoint ใหม่อยู่ใต้ flag `LINE_SIGNUP_ENABLED` (ปิด = 403 `line_signup_disabled` แบบเดียวกับ `external_signup_disabled`)

| ทาง | เมธอด/เส้นทาง | สิทธิ์ | หน้าที่ |
|---|---|---|---|
| LIFF หน้า signup | `GET /v1/auth/line/signup-page` (+ `/signup-page.js` ผ่าน `LIFF_PAGE_SCRIPT` mode `signup`) | `@Public()` | HTML ฟอร์ม 1 ช่อง + บล็อกยอมรับที่ฝัง statement/challenge ปัจจุบัน; ใช้ CSP เดิม |
| ส่งคำขอ | `POST /v1/public/line-signups` body `{ idToken, companyName, businessType?, referralCode?, legal: { documentVersion, statementSha256, releaseFingerprintSha256, displayChallenge, locale } }` | `@Public()` + rate-limit ip + **per-LINE-user** | ตรวจ ID token → ตรวจ legal ตรง release ปัจจุบัน (ไม่ตรง 409 `legal_release_changed`) → สร้าง `CompanySignupRequest` source `line-oa` (§5) → ตอบ `{ requestId, state, existingAccount: boolean }` |
| สถานะของฉัน | `GET /v1/public/line-signups/me` (ID token ใน header) | `@Public()` + rate-limit | คำขอล่าสุดของ LINE user นี้ (ใช้โดยหน้า LIFF และการ์ดสถานะ) |
| LIFF หน้า start | `GET /v1/auth/line/start-page` (mode `start`) | `@Public()` | ขอ ID token แล้วเรียก session |
| แลก session | `POST /v1/auth/line/liff/session` body `{ idToken, companyId? }` | `@Public()` + rate-limit ใหม่ `line-liff-session-user` | ตรวจ token → identity ACTIVE → mint handoff → `{ handoffUrl }`; ไม่มี identity → `{ needsSignup: true }` |
| ขอเปลี่ยนแพ็กเกจ | `POST /v1/companies/:companyId/package-change-requests` body `{ requestedTierKey }` | สมาชิก OWNER ของบริษัท (permission เดิมกลุ่ม company_settings) — และจาก LINE ผ่าน webhook action | สร้างคำขอเข้าคิว (§8); idempotent ต่อ (company, tier, open) |
| คิวแอดมิน | เดิม `GET /system/signup-requests` + `decision` | เดิม | DTO เพิ่ม `source`, `lineDisplayName`, `linePictureUrl?`, `autoApproved`, `legalAcceptedAt` |
| ระงับ | เดิม decision `SUSPEND` (ถ้ายังไม่มี ให้เพิ่มใน `decide`) | `system.company_onboarding.create` | ใช้กับแถว auto-approve |
| Timeline ต่อร้าน | `GET /system/partners/:companyId/timeline` | `system.company_onboarding.read` | เหตุการณ์สำคัญของร้าน (§8) |

ตัวตรวจ ID token = ตัวเดียวกับ `complete-employee-line-link` (audience = `LINE_LIFF_ID`/Login channel เดิม, AUTH-02); ห้ามเชื่อค่าใดๆ จาก client นอกจาก token และค่า legal ที่ถูกตรวจกับ release ปัจจุบันเท่านั้น

Contract types ใน `packages/contracts/src/external-signup.ts` (FROZEN สำหรับ Flow B — เพิ่มได้แบบ additive เท่านั้น): `LineSignupSubmitDto`, `LineSignupStatusDto`, `PackageChangeRequestDto`, ขยาย `AdminSignupQueueItemDto` ด้วย field optional ข้างต้น

## 5. Durable state

ใช้ตาราง+enum เดิม เพิ่มคอลัมน์บน `CompanySignupRequest` (migration additive):

- `source` ค่าใหม่ `'line-oa'` (คอลัมน์มีอยู่ default `official-site`)
- `lineProviderUserId String?`, `lineChannelId String?`, `lineDisplayName String?`, `linePictureUrl String?` — **index** `(lineChannelId, lineProviderUserId, state)`; กติกา app-level: **1 LINE user มีคำขอ open (RECEIVED/VALIDATED/PENDING_REVIEW/PROVISIONING) ได้ครั้งละ 1** (ตรวจใน use-case ภายในธุรกรรม)
- **หลักฐานยอมรับข้อกำหนด (LEGAL-LIFF-01):** `legalDocumentVersion String?`, `legalStatementSha256 String?`, `legalReleaseFingerprintSha256 String?`, `legalDisplayChallenge String?`, `legalLocale String?`, `legalUserAgent String?`, `legalAcceptedAt DateTime?` — ตั้งค่าครั้งเดียวตอน submit, ห้ามแก้; ใช้เขียน `LegalDocumentActionRecord` ตอน provisioning (§6)
- `contactEmail` เปลี่ยนเป็น **nullable** (Flow B ยังบังคับกรอกที่ validator ชั้นบน; DB ไม่บังคับ) — `mxValid` เป็น null เมื่อไม่มีอีเมล
- `autoApproved Boolean @default(false)`, `approvedByUserId` = null เมื่ออัตโนมัติ (audit actor = `line-signup-auto-approve`)
- `adminReminderSentAt DateTime?` — เตือนคิว 60 นาที exactly-once

ตารางใหม่ `PackageChangeRequest`: `id, companyId, requestedByUserId, requestedTierKey, status (OPEN|APPROVED|REJECTED|CANCELLED), note?, decidedByUserId?, decidedAt?, createdAt` + unique partial (companyId, status=OPEN)

ลำดับสถานะ source `line-oa` (ใช้ค่าจาก enum เดิม ไม่เพิ่มค่า):

```text
RECEIVED
  → VALIDATED         (schema + legal ตรง release + rate limit + dedupe "LINE นี้มีบัญชี/คำขอค้างไหม" — ไม่มี MX ไม่มีอีเมล)
  → PENDING_REVIEW    (MANUAL: เข้าคิว + แจ้งแอดมิน; ค้าง 60 นาที → เตือนซ้ำ)
  → PROVISIONING      (แอดมินอนุมัติ หรือ AUTO_FREE ข้ามคิว: VALIDATED → PROVISIONING ทันที)
  → READY → COMPLETED (ExternalIdentity + LegalDocumentActionRecord ในธุรกรรม provisioning → ข้าม LINE_LINK_PENDING; push "พร้อมใช้")

ข้างเคียง: REJECTED (จาก PENDING_REVIEW; push แจ้งเป็นค่าเริ่มต้น)
          / PROVISIONING_FAILED (ปล่อย fence, retry idempotent) / SUSPENDED (หลัง auto-approve)
ไม่ใช้กับ source นี้: EMAIL_PENDING, EMAIL_VERIFIED, EMAIL_FAILED, EXPIRED, LINE_LINK_PENDING
```

`TRANSITIONS` ใน `company-signup.logic.ts` ต้องแยกตาม source (Flow B ห้ามข้าม EMAIL_*; line-oa ห้ามเข้า EMAIL_*) — ทดสอบทั้งสองตาราง

`attachUserId`: ตั้งค่า**ตอน submit** เมื่อ ID token map ไป `ExternalIdentity` ACTIVE ของ User ที่ ACTIVE อยู่แล้ว (หลักฐานแรงกว่า mailbox) → provisioning เดิน `attachedExistingOwner` (เพิ่มร้านที่ 2 ให้ User เดิม) และการ์ดตอบ "เพิ่มร้านที่ 2 ให้บัญชีของคุณ" ไม่ใช่ "สร้างบัญชีใหม่"; หลักฐาน legal ของ submit นี้ยังถูกบันทึกให้ User เดิมถ้า release ปัจจุบันยังไม่มี record

## 6. Provisioning delta (ใน `CreateCompanyOnboardingUseCase` เดิม)

เพิ่ม input แบบ additive `ownerAuth: { kind: 'password' } | { kind: 'line', providerUserId, channelId, displayName, pictureUrl? }` (ค่าเดิม = password) และ `legalAcceptance?: { …ค่าจาก §5 }`:

- `kind: 'line'` → สร้าง `User` โดย `username = null`, `email = null`, `displayName` จาก LINE, **ไม่สร้าง `UserCredential`** (ไม่มี temporary password — LINE-ONBOARD-01), สร้าง `ExternalIdentity` ACTIVE ในธุรกรรมเดียวกัน (ชน unique → คือเคส attach ที่ควรถูกจับตั้งแต่ §5 → ถือเป็นบั๊ก ต้อง fail ธุรกรรมและปล่อย fence)
- `legalAcceptance` มา → เขียน `LegalDocumentActionRecord` ในธุรกรรมเดียวกัน: `surface='liff'`, `authProvider='LINE'`, `acceptedByUserId` = User ใหม่/เดิม, `companyId`+`membershipId` ของร้านใหม่, `actorCapacity` = owner, `rolesJson` = [OWNER], `sessionTokenId = null` (ไม่มี session), `requestId` = ของ provisioning, `acceptedAt` = `legalAcceptedAt` จากคำขอ (**ไม่ใช่เวลา provisioning**), `displayChallenge/statementSha256/releaseFingerprintSha256/documentVersion/locale/userAgent` จากหลักฐาน; unique `(scopeRef, documentType, documentVersion, action)` ทำให้ retry ไม่ซ้ำ — ถ้า record มีอยู่แล้ว (User เดิม) ให้ข้าม
- `attachUserId` มา → ไม่สร้าง User/ExternalIdentity ใหม่ (พฤติกรรม `attachedExistingOwner` เดิม)
- `modulePackage: 'starter'` เดิม; plan term = **preset ใหม่ `FREE`** (ค่า Owner §13 — ค่าเริ่มต้นเสนอ: `tierKey 'FREE'`, `monthlySlipLimit 30`, `branchLimit 1`, `employeeLimit 2`, ไม่มีวันหมดอายุ = `termEndsAt` ไกล และไม่เข้า P29 ladder) — ต่างจาก Flow B ที่ให้ `PRO_999` 30 วัน; **โควตาอุ่นเครื่อง 7 วันแรก** (§9) เก็บเป็น `warmupUntil`/`warmupSlipLimit` บน `CompanyPlanTerm` (additive)
- **งบ AI ต่อร้านฟรี:** ตั้ง `CompanyAiConfiguration.monthlyBudgetSatang` = `LINE_FREE_AI_BUDGET_SATANG` (§10) ตอน provisioning
- `CompanyOnboardingRun` ยังถูกสร้าง (ตาม use-case เดิม) เพื่อให้ปุ่ม Reissue owner LINE QR ในหน้า system ใช้ได้กับร้านจาก LINE ด้วย (เส้นกู้บัญชี §9)
- ผลลัพธ์ `temporaryPassword` ต้องเป็น `undefined` สำหรับ `kind:'line'` และ**ห้าม**หลุดไปใน response/log/push
- Password login กับ User ที่ไม่มี credential = ตอบเหมือน "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" (ไม่บอกว่าไม่มีรหัส); `mustChangePassword` gate ไม่เกี่ยว (ไม่มี credential)

## 7. ข้อความ LINE (copy ร่าง — Owner แก้ได้) + ช่องทางส่ง

| จังหวะ | ข้อความ | ปุ่ม | ช่องทาง |
|---|---|---|---|
| ประตู (unlinked) | "สวัสดีค่ะ ยังไม่ได้เชื่อมบัญชีมั่งมีพลัสกับ LINE นี้ เลือกทางที่ตรงกับคุณได้เลย" | เปิดร้านใหม่ ใช้ฟรี / ฉันเป็นพนักงาน / มีบัญชีอยู่แล้ว | reply |
| สถานะระหว่างรอ | "ได้รับคำขอเปิดร้าน **<ชื่อร้าน>** แล้ว กำลังตรวจสอบ ปกติไม่เกิน 1 ชั่วโมงในเวลาทำการ พร้อมเมื่อไหร่จะแจ้งในแชทนี้" | — | reply (ทุกครั้งที่พิมพ์มา) |
| พร้อมใช้ | "ร้าน **<ชื่อร้าน>** พร้อมใช้แล้ว 🎉 ลองส่งรูปใบเสร็จมาในแชทนี้ได้เลย หรือกดเปิดหน้าเว็บ" | เริ่มใช้งาน (LIFF start) | **push** (1 ครั้ง) |
| เพิ่มร้านที่ 2 | "เพิ่มร้าน **<ชื่อร้าน>** ให้บัญชีของคุณแล้ว สลับร้านได้ในเมนู" | เริ่มใช้งาน | push (1 ครั้ง) |
| ปฏิเสธ | "ขออภัย ยังเปิดร้าน <ชื่อร้าน> ให้ไม่ได้ในตอนนี้ ติดต่อ 098-256-5628 หรือส่งข้อมูลเพิ่มในแชทนี้ได้เลย" | — | push (1 ครั้ง) |
| กันหลุด วันที่ 7 | "ใช้มาครบสัปดาห์แล้ว 👍 ใส่อีเมลหรือเบอร์ไว้หน่อยไหม เผื่อเปลี่ยนมือถือแล้ว LINE หลุด จะได้กู้ร้านคืนได้" | ใส่เลย / ไว้ก่อน | push (1 ครั้ง exactly-once) — เหตุผล: ข้อความบริการเพื่อความปลอดภัยบัญชี |
| ชนโควตา | "เดือนนี้ใช้ครบ N ใบแล้ว ใช้ต่อได้เดือนหน้า หรือดูแพ็กเกจที่ใหญ่ขึ้น" | ดูแพ็กเกจ / ขอเปลี่ยนแพ็กเกจ | reply ต่อใบเสร็จที่ชน (ไม่ push ซ้ำ) |
| ติดต่อเจ้าหน้าที่ | ผู้ใช้พิมพ์ "ติดต่อเจ้าหน้าที่" → "รับเรื่องแล้ว เจ้าหน้าที่จะตอบในแชทนี้ในเวลาทำการ" + แจ้งแอดมินทาง LINE พร้อมลิงก์หน้า partner ของร้าน | — | reply + push หาแอดมิน |
| โปรโมชั่น (pull) | ปุ่ม Promotion ใน rich menu / พิมพ์ "โปรโมชั่น" → การ์ดโปรโมชั่นเดิม | ขอเปลี่ยนแพ็กเกจ | reply |

งบข้อความ: ที่ 100 สมัคร/เดือน ใช้ push ≈ 100 (พร้อมใช้) + ≤100 (กันหลุด) = ยังอยู่ในโควตาฟรี ~500/เดือนของ OA; **ห้ามเพิ่ม push ใหม่โดยไม่ผ่านการนับในตารางนี้**

## 8. คิวแอดมินและเครื่องมือ support (delta)

- แถวจาก LINE: ป้าย "LINE" + ชื่อ/รูปโปรไฟล์ + ชื่อร้าน + ประเภท (ถ้ามี) + ref + เวลายอมรับข้อกำหนด + hint "LINE นี้มีบัญชีอยู่แล้ว → จะเพิ่มเป็นร้านที่ 2"
- ไม่มีข้อมูล MX/อีเมล/เบอร์ (ช่องว่าง "—" ตามกติกา 2026-09-01)
- ปุ่ม Approve/Reject เดิม; Reject มี toggle "แจ้งทางไลน์" **เปิดเป็นค่าเริ่มต้น**
- โหมด AUTO_FREE: แท็บ/ตัวกรอง "อนุมัติอัตโนมัติ (N รายวันนี้)" + ปุ่ม **ระงับ** ต่อแถว; SLA เตือน 24 ชม. ของ PENDING_REVIEW ใช้เดิม + เตือน 60 นาที (§3.3)
- **แท็บ "คำขอเปลี่ยนแพ็กเกจ"** ในคิวเดียวกัน: ร้าน / แพ็กเกจที่ขอ / ผู้ขอ / เวลา → ปุ่ม "เปิดหน้า partner" (เปลี่ยนแพ็กเกจที่นั่นตามเดิม) + ปิดคำขอ
- **Timeline ต่อร้าน** ในหน้า partner: สมัคร (source) → อนุมัติ (ใคร/auto) → ยอมรับข้อกำหนด → เข้าเว็บครั้งแรก → ใบเสร็จแรก → ใช้ล่าสุด → เหตุที่ AI ไม่ตอบล่าสุด (ระงับ/โควตา/งบ AI/ยังไม่ผูก) → คำขอเปลี่ยนแพ็กเกจ — อ่านจาก audit/event เดิม ไม่สร้าง log ใหม่
- `/system/users`: ค้นด้วย**ชื่อ LINE** และแสดง LINE-only user (ไม่มี username/email — โชว์ displayName + ป้าย LINE)
- **คีย์เวิร์ด "ติดต่อเจ้าหน้าที่"**: AI หยุดตอบใน thread นั้น 24 ชม. (state ใน `LineCompanyContext`/context เดิม) + แจ้งแอดมิน; แอดมินตอบมือจาก LINE OA Manager — **ต้องตรวจการตั้งค่า OA ว่าเปิด Chat คู่ webhook ได้** ก่อนรับปากลูกค้า (ถ้าไม่ได้ ให้ตอบผ่าน push จากหน้า partner แทน — งานเพิ่มเล็ก)
- **Support playbook** (เอกสารสั้นใน docs/runbooks): 4 ticket ที่คาดไว้ (กดแล้วไม่เข้า / เปลี่ยนมือถือ / ส่งใบเสร็จแล้วไม่ตอบ / สมัครแล้วเงียบ) พร้อมสาเหตุที่พบบ่อยและปุ่มที่ต้องกด

## 9. ความปลอดภัย / PDPA / การปั่น / การกู้บัญชี

- **ตัวตน:** เชื่อเฉพาะ ID token ที่ตรวจลายเซ็นและ audience ฝั่งเซิร์ฟเวอร์; `providerChannelId` ต้องเท่ากับ channel ของเรา; token หมดอายุ → 401 ให้ LIFF ขอใหม่; token เดียวกันใช้ซ้ำภายในอายุได้แต่ทำอะไรเกินสิทธิ์ของเจ้าของไม่ได้ (คำขอค้าง 1/คน, session = ของตัวเอง)
- **Rate limit ใหม่:** `line-signup-user` 3/วัน ต่อ LINE userId, `line-signup-ip` 20/ชม., `line-liff-session-user` 30/ชม.; อ่านสถานะ 60/ชม.
- **1 LINE = 1 คำขอค้าง** (§5) และ `ExternalIdentity` unique = 1 LINE = 1 บัญชี; ร้านที่ 2+ ผ่าน attach เท่านั้น
- **กันปั่นเพื่อเผางบ AI:** (1) โควตาอุ่นเครื่อง 7 วันแรก `LINE_SIGNUP_WARMUP_SLIPS` (เสนอ 10 ใบ) จนกว่าแอดมินกด "ตรวจแล้ว" หรือครบ 7 วัน; (2) งบ AI ต่อร้านฟรี `LINE_FREE_AI_BUDGET_SATANG` ตั้งตอน provisioning; (3) เพดานอนุมัติอัตโนมัติต่อวัน `LINE_SIGNUP_AUTO_DAILY_CAP` (เกิน → ตกเป็น MANUAL อัตโนมัติ + แจ้งแอดมิน); (4) ระงับได้ทันทีจากคิว; (5) ทุกอย่าง audit (`signup.line.submitted / auto_approved / suspended / package_change_requested`)
- **กู้บัญชีเมื่อ LINE หาย (ไม่มีอีเมล/รหัสผ่าน):** ขั้นตอนแอดมิน — ① ผู้ติดต่อบอกชื่อร้าน + ข้อมูลที่รู้เฉพาะเจ้าของ (ยอด/รายการล่าสุด 2 รายการ, เบอร์/อีเมลกันหลุดถ้าเคยใส่) ② แอดมินตรวจกับ timeline ③ Unlink LINE เดิม (ปุ่มมีอยู่) ④ Reissue owner LINE QR (ปุ่มมีอยู่ ใช้ `CompanyOnboardingRun`) ส่งให้สแกนด้วย LINE ใหม่ ⑤ audit `system.account_recovery.line_relink` riskLevel CRITICAL; ห้ามทำถ้าตรวจข้อ ① ไม่ผ่าน — เขียนเป็น runbook คู่กับ playbook §8
- **PDPA:** การยอมรับที่มีผลผูกพันเกิดบน LIFF (LEGAL-LIFF-01) ด้วยหลักฐานชุดเดียวกับในแอปและถูกบันทึกเป็น `LegalDocumentActionRecord` ตอน provisioning (`surface='liff'`); ข้อมูล LINE profile (ชื่อ/รูป) เก็บเพื่อแสดงตัวตนในคิวและบัญชี — ระบุใน privacy notice ข้อ "ข้อมูลจาก LINE"; **ไม่มี consent การตลาด**เพราะไม่มีการส่งเชิงรุก (MSG-01) — ถ้าวันหน้าจะ broadcast ต้องเพิ่ม consent แยกก่อน (Phase 2)
- **ไม่มีข้อมูลส่วนตัวใน URL** (ไม่มี token/ชื่อใน query) ยกเว้น `ref` code สาธารณะ
- LIFF page ใช้ CSP เดิม (`LIFF_PAGE_CSP`) ห้าม inline script นอก `LIFF_PAGE_SCRIPT`; OA ของเราเป็น Verified Account แล้ว (Owner 2026-09-04) — ใส่โล่ในการ์ดประตูเพื่อกัน OA ปลอม

## 10. Config & rollout

| ตัวแปร | ค่า UAT | ค่า production (จนกว่า Owner สั่ง) |
|---|---|---|
| `LINE_SIGNUP_ENABLED` | `true` | `false` — `true` บน prod = deploy.sh exit 2 แบบเดียวกับ `EXTERNAL_SIGNUP_ENABLED` |
| `LINE_SIGNUP_APPROVAL_MODE` | `MANUAL` (ทดสอบทั้งสองโหมด) | `MANUAL` |
| `LINE_SIGNUP_AUTO_DAILY_CAP` | `20` | `20` |
| `LINE_SIGNUP_WARMUP_SLIPS` | `10` | `10` |
| `LINE_FREE_AI_BUDGET_SATANG` | ค่า Owner §13 | เท่ากัน |
| `LINE_SIGNUP_ADMIN_REMINDER_MINUTES` | `60` | `60` |
| `LINE_LIFF_ID` เดิม | มี | มี |

deploy.sh เป็นไฟล์ pinned → แก้แล้วต้อง `node infra/security/sync-production-maintenance-release-pins.mjs`; rich menu v2 ตั้งปุ่ม "สมัครใช้งานฟรี" ผ่าน console ตาม runbook เดิม (ไม่มีโค้ด); ตรวจโหมด Chat/webhook ของ OA ก่อนเปิด "ติดต่อเจ้าหน้าที่"

ลำดับส่งมอบ (แต่ละ slice = PR เดียว, verify ก่อนต่อ):
- **Slice L-A (backend core):** migration (§5) + submit/status use-cases + ID-token verify reuse + legal evidence ตรวจกับ release + TRANSITIONS แยก source + provisioning `ownerAuth`/`legalAcceptance` + FREE preset + warm-up + งบ AI + tests
- **Slice L-B (LIFF + handoff + ข้อความ):** LIFF modes `signup`/`start` + `/v1/auth/line/liff/session` + การ์ด 3 ประตู/สถานะ/ชนโควตา/ติดต่อเจ้าหน้าที่ใน webhook + push ตามตาราง §7 + กันหลุดวันที่ 7 (worker sweep)
- **Slice L-C (admin + support + flags):** คิว delta + AUTO_FREE + suspend + เตือน 60 นาที + คำขอเปลี่ยนแพ็กเกจ + timeline + ค้นชื่อ LINE + playbook/recovery runbook + deploy.sh wiring + pins + UAT deploy
- **Slice L-D (หน้าปัด):** หน้าสรุป funnel + ต้นทุน AI ต่อร้าน (§11) — **ต้องเสร็จก่อนเปิด AUTO_FREE บน production**
- **Phase 2 (แยก spec เล็ก):** rich menu ต่อผู้ใช้ตามสถานะ, "ลองอ่านใบเสร็จระหว่างรอ" (OCR ไม่มี company context — หมดความจำเป็นถ้าใช้ AUTO_FREE), อีเมลต้อนรับเมื่อผู้ให้บริการเมลพร้อม, consent การตลาด (เฉพาะถ้าจะ broadcast), ระบบจ่ายเงินอัตโนมัติ (P26)

## 11. Gates / tests (ต้องมีหลักฐานจริงก่อนปิดงาน)

Unit/integration (api):
- TRANSITIONS: line-oa ห้ามเข้า EMAIL_*; official-site ห้ามข้าม EMAIL_* (ตารางทั้งสอง)
- submit: token ปลอม/หมดอายุ/คนละ channel → 401; legal ไม่ตรง release → 409; LINE เดิมมีคำขอค้าง → 409; LINE เดิมมีบัญชี → `attachUserId` ตั้ง + `existingAccount:true`; หลักฐาน legal ถูกเก็บครบทุก field และ `legalAcceptedAt` = เวลาเซิร์ฟเวอร์
- provisioning idempotent: approve ซ้ำ/retry หลัง fail → บริษัทเดียว, ExternalIdentity เดียว, **LegalDocumentActionRecord เดียว (surface liff, acceptedAt = ของคำขอ)**, ไม่มี UserCredential, `temporaryPassword` undefined, งบ AI/warm-up ถูกตั้ง
- legal gate: User ใหม่จาก LINE **ไม่ถูก** guard พาไป legal-acceptance และ LINE AI ตอบทันที; เมื่อ release ใหม่กว่า → ถูกพาไปตามเดิม
- AUTO_FREE: VALIDATED → PROVISIONING โดยไม่มีแถวคิว; เกิน daily cap → PENDING_REVIEW + แจ้ง; warm-up: ใบที่ 11 ใน 7 วันแรก → ตอบชนโควตาอุ่นเครื่อง
- webhook: unlinked → การ์ด 3 ประตู (reply); มีคำขอค้าง → การ์ดสถานะ; หลังอนุมัติ → ตอบปกติ; ชนโควตา → การ์ดครั้งเดียว ไม่ซ้ำวันถัดไป; "ติดต่อเจ้าหน้าที่" → AI หยุด + แจ้งแอดมิน; "โปรโมชั่น" → การ์ด pull
- liff/session: identity ACTIVE → handoffUrl ใน `/l/`; ไม่มี identity → needsSignup; rate limit
- reminders: เตือนแอดมิน 60 นาที exactly-once; กันหลุดวันที่ 7 exactly-once และไม่ส่งถ้ามีอีเมล/เบอร์แล้ว
- package change: idempotent ต่อ (company, tier, open); แถวโผล่ในคิว
- push budget: ทดสอบนับว่า flow ปกติ 1 รายใช้ push ≤ 2

Web/E2E: คิวแสดงแถว LINE + suspend + แท็บคำขอเปลี่ยนแพ็กเกจ; timeline ต่อร้าน; `/system/users` ค้นชื่อ LINE; `/l/<token>` จาก session endpoint ลงหน้าเป้าหมาย (mock LIFF ด้วยการยิง endpoint ตรง — LIFF จริงทดสอบใน UAT ด้วยมือ)

UAT (มือ, มือถือจริง): add OA → การ์ด → สมัคร 1 ช่อง + ยอมรับ → (MANUAL) อนุมัติ → push พร้อมใช้ → **ส่งใบเสร็จทาง LINE ได้ทันทีโดยไม่เจอการ์ดยอมรับ** → แตะเริ่มใช้งาน → หน้าใบเสร็จแรก (ไม่ผ่าน legal page); ซ้ำด้วย AUTO_FREE; เคสพนักงาน; เคสมีบัญชีแล้ว (ร้านที่ 2); เคสปฏิเสธ; ชนโควตา → ขอเปลี่ยนแพ็กเกจ → โผล่ในคิว; กู้บัญชีด้วย Unlink + Reissue QR

**หน้าปัดก่อน AUTO_FREE (Slice L-D):** funnel `card_shown → liff_opened → submitted → approved(auto|manual) → first_receipt → active_week2` + ต้นทุน AI ต่อร้าน (จาก `AiUsageEvent`) + อัตราแปลงเป็นคำขอเปลี่ยนแพ็กเกจ — ไม่มีหน้าปัด = ไม่เปิด AUTO_FREE บน production

## 12. สิ่งที่ไม่ทำในรอบนี้

Paid tier / ชำระเงินอัตโนมัติ (P10 §4E/P26 — ช่วงแรกทำมือในแชท); rich menu ต่อผู้ใช้; OCR ระหว่างรอ; อีเมลต้อนรับ (จนกว่าผู้ให้บริการเมลพร้อม — ทางสำรอง Resend จดไว้แล้ว); พนักงานสมัครเองเข้าร้านที่มีอยู่ (ยังใช้ employee link ที่เจ้าของออก); เปลี่ยนแปลง Flow B เว็บฟอร์มเดิม (คงอยู่คู่กัน — ประตูที่สอง ลดการพึ่ง LINE เจ้าเดียว); **broadcast/consent การตลาด** (ไม่จำเป็นโดยการออกแบบ); OTP เบอร์โทรเป็นทาง login

## 13. คำถาม Owner (ตอบแล้วค่อยเริ่ม Slice L-A)

ตอบแล้ว: ยอมรับข้อกำหนดบน LIFF = ทำได้ (LEGAL-LIFF-01); OA Verified แล้ว; โปรโมชั่นแบบ pull ไม่ broadcast; ชำระเงินช่วงแรกทำมือ

1. **Free tier:** `monthlySlipLimit 30`, 1 สาขา, พนักงาน 2 คน, ไม่มีวันหมดอายุ — ตัวเลขโอเคไหม? (ตัวเลขนี้คือ "กำแพงอัปเกรด" = ท่อรายได้)
2. **โหมดวันแรก:** MANUAL (คุณอนุมัติเอง SLA 1 ชม.) 2 สัปดาห์แรก แล้วสลับ AUTO_FREE เมื่อหน้าปัด L-D พร้อม — เห็นด้วยไหม?
3. **Reject แจ้งทางไลน์เป็นค่าเริ่มต้น** — ยืนยัน?
4. **ประเภทธุรกิจ** เป็น chip ไม่บังคับในฟอร์ม หรือตัดออกให้เหลือ 1 ช่องจริงๆ?
5. **ชื่อ/รูปโปรไฟล์ LINE** แสดงในคิวแอดมินและบัญชี — โอเคตาม privacy notice?
6. **ตัวเลขกันปั่น:** เพดาน auto 20/วัน, อุ่นเครื่อง 10 ใบใน 7 วันแรก, งบ AI ต่อร้านฟรี (บาท/เดือน) = เท่าไร?
7. **SLA ที่บอกลูกค้า** "ไม่เกิน 1 ชั่วโมงในเวลาทำการ" — ทำได้จริงไหม (ถ้าไม่ ให้บอกเป็น "ภายในวันนี้") และ "เวลาทำการ" ของเราคือช่วงไหน?
8. **โหมด OA:** ให้ผมตรวจการตั้งค่า LINE OA Manager ว่าเปิด Chat คู่ webhook ได้ไหม (สำหรับ "ติดต่อเจ้าหน้าที่") — อนุญาตให้เข้าไปดูตั้งค่าไหม?

## 14. เหตุผลเชิง UX/BA/ต้นทุน (หลักฐาน)

- LINE OA: ข้อความเปิดอ่าน 60–80% vs อีเมล 15–20%; 85% ของผู้บริโภคไทยคุยกับแบรนด์ทาง LINE OA ก่อนเข้าเว็บ; SME = 90% ของผู้ถือ LINE OA — [Sphere Agency, LINE OA Setup Guide Thailand 2026](https://sphereagency.com/articles/line-oa-setup-guide-thailand), [Bangkok Post](https://www.bangkokpost.com/business/general/2272307/line-oa-signups-surge-as-smes-go-digital)
- ราคาข้อความ OA: แผนฟรี ~500 push/เดือน, แผนเสียเงินเริ่ม ~฿1,500/เดือน, reply ฟรีไม่จำกัด — [LINE Messaging API pricing](https://developers.line.biz/en/docs/messaging-api/pricing/), [LINE OA pricing guide 2026](https://linebot.pro/blog/line-official-account-pricing-guide)
- ฟอร์ม: 3 ช่องแปลงดีสุด (~25%); ทุกช่องเพิ่มลด ~4.1%; หน้าผาช่วง 5→7 ช่อง — [HubSpot](https://blog.hubspot.com/marketing/optimize-conversion-forms), [Form conversion benchmarks 2026](https://www.digitalapplied.com/blog/form-conversion-rate-benchmarks-2026-data-points)
- ป้าย "ไม่บังคับ" ดีกว่าดอกจันบังคับ ~25% (Baymard 2024) — [สรุปโดย Brixon](https://brixongroup.com/en/lead-forms-in-b2b-the-perfect-balancing-act-between-data-depth-and-conversion-rate)
- Onboarding: one-tap/SSO, ข้ามได้, progressive disclosure, ค่าเริ่มต้นฉลาด — [Appcues](https://www.appcues.com/blog/mobile-onboarding-best-practices)
- บทเรียนภายใน: LINE in-app browser คุกกี้แยกจาก Safari/Chrome (QR fix 2026-09-01) → ทุกลิงก์เข้าเว็บจาก LINE ต้องเปิดภายนอก; พนักงานไม่มีอีเมล → กับดักบัญชีซ้ำ (P10 §4F) → ประตู "ฉันเป็นพนักงาน"; ด่านยอมรับข้อกำหนดปฏิเสธ AI จนกว่าจะยอมรับ (`refusePendingLegalAcceptance`) → ต้องยอมรับตั้งแต่ LIFF ไม่งั้น "ส่งใบเสร็จได้เลย" เป็นคำโกหก
