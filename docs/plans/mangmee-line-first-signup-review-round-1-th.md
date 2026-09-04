# Review รอบ 1 — LINE-first Signup (P10-L): impact / gap / bug ทั้ง SDLC

วันที่: 2026-09-04 · ผู้รีวิว: Claude (Fable) ตามคำสั่ง Owner · ฐานหลักฐาน: code sweep บน develop `91957572` (18 หัวข้อ A–R, อ้าง file:line ทุกข้อ) · ผลลัพธ์: spec **v4** + plan **v2** (แก้ตามตารางนี้)
มุมที่ใช้: **UX** (สิ่งที่ลูกค้าเห็น/อ่าน) · **BA** (กติกาธุรกิจ/รายได้) · **SEC** (ความปลอดภัย/PDPA) · **ROI** (ต้นทุน-ความคุ้มค่าของเจ้าของระบบ) · **SUP** (support ง่าย ลูกค้าอยากใช้ต่อ) · **SDLC** (build/test/deploy/ops)

## 0. สรุปสำหรับ Owner (อ่านแค่นี้ก็พอ)

1. **กำแพง "15 ใบ" ที่เป็นท่อรายได้ ยังไม่มีอยู่จริงในระบบ** — `monthlySlipLimit` ถูกเก็บและแสดง แต่**ไม่มีตัวนับและไม่มีการบังคับที่ไหนเลย** (ทั้ง LINE และเว็บ) ต้องสร้างใหม่ใน P10-L (งานเพิ่ม ~1 slice ย่อย แต่จำเป็น ไม่งั้นทดลองฟรีไม่มีเพดาน)
2. **ไม่มีหน้าให้เจ้าของร้านกรอกข้อมูลบริษัทเองบนเว็บ** (ชื่อจดทะเบียน/เลขภาษี/ที่อยู่/VAT แก้ได้เฉพาะแอดมิน; อีเมล/เบอร์ของตัวเองก็แก้เองไม่ได้) → เส้นทาง "กรอกที่เหลือทีหลัง" ต้องมี **หน้า "ข้อมูลร้านและบัญชีของฉัน" + การ์ดเช็คลิสต์ความครบ** (Slice ใหม่ L-E) — ได้ประโยชน์กับลูกค้าทุกช่องทาง ไม่ใช่แค่ LINE
3. **บั๊ก 3 ตัวในระบบเดิม** ที่จะโผล่ทันทีเมื่อเปิด flow นี้: webhook ไม่รับ event "add เพื่อน" (การ์ดต้อนรับไม่ออก) · งบ AI หมดแล้วลูกค้าถูกบอกว่า "ระบบกำลังประมวลผลข้อความก่อนหน้า" (ผิดเรื่อง) · **ต้องสงสัยว่า Flow B เว็บให้ tier ผิด** (ตั้งใจให้ PRO 30 วัน แต่กลไก upsert อาจทิ้งไว้ที่ STARTER) — ตรวจและแก้ก่อนเขียนของใหม่
4. **ช่องเตรียมพร้อมจ่ายเงิน/อีเมล** วางเป็น "ตะขอ" ในตาราง/port ตั้งแต่รอบนี้ โดยไม่สร้างระบบจ่ายเงินหรือส่งเมล — วัน P26/Resend มาถึงแค่เสียบ
5. ต้นทุน/ความเสี่ยงที่ควบคุมได้ทั้งหมด: push ต่อราย ≤ 6, งบ AI 80 บาท/ร้าน, เพดาน auto 20/วัน, rate limit บน Redis แบบ fail-closed อยู่แล้ว, ถอยหลังได้ด้วย flag เดียว (migration เป็น additive)

## 1. ทะเบียนสิ่งที่พบ (ID · มุม · ระดับ · หลักฐาน · ผลกระทบ · วิธีแก้ · slice)

### 1A. ของที่ "คิดว่ามี" แต่ไม่มี

| ID | มุม | ระดับ | พบอะไร (หลักฐาน) | ผลกระทบ | วิธีแก้ | slice |
|---|---|---|---|---|---|---|
| G-01 | BA/ROI | **สูง** | ไม่มีตัวนับสลิปและไม่มีการบังคับ `monthlySlipLimit` เลย (`plan-term-limit.ts:22-47` มีแค่ branch/employee; spec P29 `:73` "ยังไม่ตัดจริง") | ทดลองฟรี 15 ใบ = ไม่มีเพดาน; กำแพงอัปเกรดไม่เกิด; งบ AI 80 บาทเป็นเพดานเดียว | สร้าง `CompanyReceiptUsage(companyId, monthKey, count)` + CAS increment (pattern `prisma-crm-channel-cap.repository.ts`) นับตอน**ก่อน**ส่ง OCR ทั้งทาง LINE และเว็บ; บังคับ `min(monthlySlipLimit, warmupSlipLimit)`; copy ไทย + การ์ด "ขอเปลี่ยนแพ็กเกจ"; เว็บ: แบนเนอร์ + ปุ่มอัปโหลดปิด | **L-A2 (ใหม่)** |
| G-02 | UX/SUP | **สูง** | ไม่มีหน้าเว็บให้ OWNER แก้ `registeredName/taxId/address/VAT` (มีแต่ API `PATCH /companies/:id/identity` perm `company.legal_identity.manage` — ไม่มีหน้าใช้) และไม่มีที่แก้อีเมล/เบอร์ของตัวเอง (`settings-menu.logic.ts:16-88`) | ลูกค้า LINE มีแค่ชื่อร้าน+เบอร์ แล้ว**ไม่มีที่ไปกรอกที่เหลือ** ต้องโทรหาแอดมินทุกครั้ง | **Slice L-E "ข้อมูลร้านและบัญชีของฉัน":** หน้าเดียวใต้ตั้งค่า (ใช้ API เดิม identity/VAT) + ส่วน "บัญชีของฉัน" (อีเมล → EmailVerificationToken เดิม, เบอร์, ตั้งรหัสผ่านสำรอง) + **การ์ดเช็คลิสต์ความครบ** บน dashboard (ไม่บล็อก) + prompt ตามบริบท (จะออกเอกสารภาษี → ขอเลขภาษีตรงนั้น) | **L-E (ใหม่)** |
| G-03 | UX | สูง | webhook ไม่จัดการ event `follow` (`line-webhook.controller.ts:71-120` มีแค่ text/image/file/postback rich-talk) และ Greeting ของ OA ปิด | คน add เพื่อนแล้ว**เงียบ** ไม่ได้การ์ด 3 ประตู | รับ `follow` → enqueue synthetic greeting → การ์ด 3 ประตู (reply token ของ follow ใช้ได้) | L-B |
| G-04 | UX | สูง | ไม่รองรับ `postback` ทั่วไป (มีแค่ `action=line-rich-talk`) | ปุ่ม "ขอเปลี่ยนแพ็กเกจ/ใส่เลย/ไว้ก่อน" บนการ์ดกดแล้วไม่มีอะไรเกิด | เพิ่ม postback dispatcher `action=<name>&…` → intent เท่านั้น (ตรวจสิทธิ์/สถานะฝั่งเซิร์ฟเวอร์เสมอ — SEC-04) | L-B |
| G-05 | UX/ROI | สูง | งบ AI หมด → 429 `AI_MONTHLY_BUDGET_EXCEEDED` ถูก map เป็น `rate_limited` → ลูกค้าได้ "⏳ ระบบกำลังประมวลผลข้อความก่อนหน้า" (`line-ai-terminal-outcome.logic.ts:109-111`, `process-line-webhook.use-case.ts:167`) | ร้านฟรีชนงบ 80 บาทแล้ว**งง** คิดว่าระบบค้าง → ticket + เสียโอกาสขาย | แยก reply เฉพาะ `AI_MONTHLY_BUDGET_EXCEEDED`: "โควตา AI ช่วงทดลองเดือนนี้ครบแล้ว" + ปุ่มขอเปลี่ยนแพ็กเกจ (บั๊กเดิม แก้ให้ทุกร้าน) | L-B |
| G-06 | ROI | กลาง | งบ AI ต่อร้านไม่ถูกตั้งตอน provisioning ที่ไหนเลย (`CompanyAiConfiguration` ไม่ถูกแตะใน onboarding/provision) | ร้านทดลองใช้งบ platform default | ตั้ง `monthlyBudgetSatang = 8000` ใน provisioning source line-oa | L-A |
| G-07 | ROI/SDLC | กลาง | ไม่มีตัวนับ push ต่อเดือน; `system-line-push.ts` ไม่จัดการ 429/retry-after (`:17-19`) ต่างจาก `line-messaging.adapter.ts:124,150` | เกินโควตา OA แล้วไม่รู้; push หายเงียบ | ส่ง push ของ flow นี้ผ่าน adapter ที่จัดการ 429 + บันทึกจำนวน push/เดือนใน outbox (eventType นับได้) → หน้าปัด L-D | L-B/L-D |
| G-08 | SDLC | กลาง | Catalog สัญญาณ customer-journey สำหรับ signup เป็น `PLANNED` และ catalog ถูกอ่านแค่โดย spec test (`security-event.spec.ts`) ไม่มี dashboard/alarm | "หน้าปัด" ต้องสร้างจาก audit + AiUsageEvent ไม่ใช่จาก catalog | L-D อ่านจาก audit `signup.line.*` + `AiUsageEvent`; เพิ่ม signal rows ใน catalog ให้ครบเพื่อความสม่ำเสมอ (ถูก) | L-D |

### 1B. บั๊ก/กับดักในระบบเดิมที่จะโผล่เมื่อเปิด flow นี้

| ID | มุม | ระดับ | พบอะไร (หลักฐาน) | ผลกระทบ | วิธีแก้ | slice |
|---|---|---|---|---|---|---|
| B-01 | BA | **สูง (ต้องสงสัย — ยืนยันก่อน)** | `applyPlanTermPreset` ใช้ `upsert … update: {}` (ไม่เขียนทับ, `company-plan-term.use-cases.ts:181-206`); onboarding เรียกด้วย `ONBOARDING_DEFAULT_TIER=STARTER_249` หลัง commit (`create-company-onboarding.use-case.ts:463-469`) แล้ว `provision-signup.use-case.ts:96` ค่อยเรียกด้วย `PRO_999` → แถวมีอยู่แล้ว → **PRO_999 ไม่ถูกเขียน** (unit test ผ่านเพราะ mock onboarding) | Flow B เว็บอาจให้ลูกค้าได้ STARTER 30 ใบ แทน PRO ทดลอง; และ LINE จะได้ STARTER แทน FREE_TRIAL_15 (**30 ใบแทน 15**) | ก่อนเขียนของใหม่: เขียน integration test พิสูจน์; แก้โดยเพิ่ม `planTier?/planDays?` ใน `CreateCompanyOnboardingCommand` ให้ onboarding เขียน tier ที่ถูกต้องครั้งเดียว และตัดการเรียกซ้ำใน provision-signup | L-A (pre-flight) |
| B-02 | SDLC | สูง | `TRANSITIONS` ตารางเดียว ไม่มีขอบ `VALIDATED→PROVISIONING` / `PENDING_REVIEW→PROVISIONING`; `decide` รับแค่ APPROVE/REJECT และ APPROVE บังคับไป `EMAIL_PENDING` (`signup-admin-queue.use-case.ts:60-107`, contract `action: 'APPROVE'|'REJECT'`) | LINE path เดินไม่ได้; AUTO_FREE เดินไม่ได้ | TRANSITIONS แยกตาม source; `decide` แยกทางตาม source; เพิ่ม `SUSPEND` (contract additive) | L-A |
| B-03 | SDLC | สูง | `contactEmail` non-null ถูกอ่านแบบ assume ทุกชั้น: normalize/regex (`company-signup.logic.ts:81`), MX (`submit…:39,47`), rate-limit bucket ต่อ email (`auth-rate-limit.service.ts:130`), queue DTO required string (`external-signup.ts:85`), claim/provision `suggestedUsernameFromEmail` (`provision-signup.use-case.ts:66`), web queue | ทำ nullable แล้วพังเงียบหลายจุด | `contactEmail?` ในตาราง/contract (widening); LINE path มี validator/use-case ของตัวเอง ไม่ผ่าน normalize ของ Flow B; queue DTO/หน้าเว็บแสดง "—"; provisioning LINE ไม่เรียก username fallback | L-A |
| B-04 | SDLC | สูง | `CreateCompanyOnboardingCommand.ownerUsername: string` บังคับ; user.create ใช้ค่านี้ (`:224`); temp password ถูกสร้างเว้นแต่ attach/claim (`:178`); ไม่แตะ `ExternalIdentity`/`LegalDocumentActionRecord`/`LineCompanyContext` | LINE user จะได้ username บังคับ + temp password | `ownerAuth` union: `line` → `username: null`, ไม่มี credential, สร้าง `ExternalIdentity` + `LegalDocumentActionRecord` ในธุรกรรมเดียวกัน; ผลลัพธ์ไม่มี `temporaryPassword` (spec test `:835` ยืนยันไม่รั่ว) | L-A |
| B-05 | SEC/SDLC | กลาง | `externalSignupId @unique` + advisory lock เป็น idempotency key เดียว (`company-signup-core.service.ts:35-37`); web mint UUID ฝั่ง client | LINE ต้องมี key ของตัวเอง; กดสมัคร 2 ครั้งเร็วๆ อาจได้ 2 คำขอ | server mint `externalSignupId = line:<channel>:<userId>:<uuid>` + **partial unique index** `(lineChannelId, lineProviderUserId) WHERE state IN (open states)` = 1 คำขอค้าง/คน ระดับ DB | L-A |
| B-06 | UX | กลาง | มี ≥2 membership → picker เสมอ ถ้าไม่มี `LineCompanyContext` (`process-line-webhook.use-case.ts:1034-1038`); การสร้าง membership ใหม่ไม่ตั้ง context | ลูกค้าเพิ่มร้านที่ 2 แล้วส่งใบเสร็จ → เจอ picker แทนที่จะเข้าร้านใหม่ที่เพิ่งเปิด | provisioning source line-oa: `upsertCompanyContext(lineUserId → companyId ใหม่)` (มี use-case `link-line-identity.use-case.ts:157-165` ให้ reuse) | L-A |
| B-07 | UX | กลาง | `isSafeHandoffPath` รับเฉพาะใต้ `/companies/<id>` (`line-handoff.logic.ts:42-59`) | target อื่น (welcome/legal) mint ไม่ได้ | target = `/companies/<id>/expenses/upload` (มีอยู่: `app/(workspace)/companies/[companyId]/expenses/upload/page.tsx`); legal gate ทำงานหลัง landing เองถ้าจำเป็น — ไม่ต้องแก้ handoff | L-B |
| B-08 | SDLC | ต่ำ | `PLAN_TIER_KEYS = Object.keys(PLAN_TIER_PRESETS)` ทำให้ tier ใหม่โผล่ใน dropdown แอดมินอัตโนมัติ; public web `@IsIn([...])` hardcode ไม่รวม | FREE_TRIAL_15 เลือกได้จากหน้า partner (ดี: แอดมินให้ทดลองได้), เว็บ Flow B ไม่เห็น (ดี) | รับพฤติกรรมนี้; เพิ่ม test ยืนยัน 2 ด้าน; ข้าม `SignupOfferKey` | L-A |
| B-09 | SDLC | ต่ำ | sweeps/queue กรองด้วย state เท่านั้น (`signup-claim-email.service.ts:160-222`, `QUEUE_STATES`) | LINE ไม่เข้า EMAIL_* จึงไม่โดน sweep (ดี) แต่แถว auto-approve (COMPLETED) ไม่โผล่ในคิว | query แยก "auto-approved 14 วัน" สำหรับแท็บตรวจย้อนหลัง | L-C |

### 1C. ความปลอดภัย / PDPA

| ID | ระดับ | ประเด็น | วิธีแก้ | slice |
|---|---|---|---|---|
| SEC-01 | สูง | ตัวตน = LIFF ID token; ต้อง reuse verifier เดิม (`complete-employee-line-link.use-case.ts:23`) ห้ามเชื่อ profile จาก client | service กลาง `line-id-token.service.ts` + test token ปลอม/หมดอายุ/คนละ channel | L-A |
| SEC-02 | กลาง | rate limit อยู่บน Redis, default **fail-closed** (`redis-rate-limit.service.ts:30`) — ดี; bucket ใหม่ต้องไม่เปิด degrade โดยไม่ตั้งใจ | ประกาศ bucket ใหม่ด้วย policy เดิม + test | L-A |
| SEC-03 | กลาง | `LegalDocumentActionRecord` fingerprint = SHA ของไฟล์ข้อกำหนดที่เสิร์ฟ (`legal-acceptance.ts:12-14`) ไม่ใช่ build id → หลักฐานจาก LIFF เสถียร (ดี); `documentVersion` ต้องตรง `/^v\d+$/` และมีไฟล์ release | LIFF ฝังค่าจาก `CURRENT_LEGAL_DOCUMENTS` เดียวกัน; ตรวจตอน submit ว่าตรง | L-A/L-B |
| SEC-04 | กลาง | postback data ปลอมได้จาก client ใดๆ | postback = intent เท่านั้น; ทุก action ตรวจ membership/สถานะ/tier ฝั่งเซิร์ฟเวอร์; ไม่ใส่ id ลับใน data | L-B |
| SEC-05 | กลาง | กล่อง "ส่งข้อความถึงร้าน" จากแอดมิน = push ในนามระบบ | จำกัดความยาว, ห้ามลิงก์นอกโดเมนเรา, audit ทุกครั้ง, แสดงชื่อผู้ส่ง | L-C |
| SEC-06 | ต่ำ | Data rights (DSAR) ไม่มีคอลัมน์อีเมล/username — LINE-only ไม่พัง; แต่การยืนยันตัวตนผู้ร้องไม่มีทาง LINE ในโค้ด | ใส่ขั้นตอนยืนยันทาง LINE ใน runbook กู้บัญชี/DSAR (คนทำ) | L-C docs |
| SEC-07 | ต่ำ | ข้อมูลที่เก็บ: displayName + ชื่อร้าน + เบอร์ (DATA-MIN-01) — ไม่มีรูป | ยืนยันใน migration ว่าไม่มีคอลัมน์รูป; test | L-A |

### 1D. ช่องเตรียมพร้อม (ตะขอ) — ทำวันนี้ ใช้วันหน้า

| ID | มุม | ตะขอ | ทำอะไรรอบนี้ | เสียบอะไรวันหน้า |
|---|---|---|---|---|
| H-01 | BA/ROI | **จ่ายเงิน** | `PackageChangeRequest` มีคอลัมน์ nullable: `amountSatang`, `offerSnapshotJson`, `paymentState (NONE\|PENDING\|VERIFIED\|FAILED)`, `paymentRef`, `slipAttachmentId`, `verifiedAt`; การเปลี่ยน tier ผ่าน `PUT /system/partners/:id/plan-term` เดิมเท่านั้น (จุดเดียว) | P26/EasySlip ตั้ง `paymentState=VERIFIED` → auto-approve; การ์ดราคาแสดงจาก `PLAN_TIER_PRESETS` เดิม |
| H-02 | UX/SUP | **อีเมล** | `AuthMailerPort` เพิ่ม `sendLineSignupWelcome` + `sendPackageChangeNotice` (no-op ใน disabled/local-console/SES-sandbox); อีเมลของผู้ใช้เก็บผ่าน L-E ด้วย `EmailVerificationToken` เดิม | Resend/SES production adapter implement 2 เมธอด → เมลต้อนรับ/ใบเสร็จออกอัตโนมัติ |
| H-03 | SUP | **ตอบมือจากแอป LINE** | ข้อความจากแอดมินผ่านกล่องในหน้า partner (push) | Owner เปิด Chat ใน OA เมื่อไหร่ก็ตอบจากแอปได้ ไม่ต้องแก้โค้ด |
| H-04 | BA | **ทดลองฟรีทางเว็บ** | tier `FREE_TRIAL_15` อยู่ใน contracts แล้ว; เว็บ Flow B ยังใช้ PRO_999 (หลังแก้ B-01) | ถ้าอยากให้เว็บได้ทดลองแบบเดียวกัน เปลี่ยน 1 บรรทัดใน provision-signup |

### 1E. ฝั่ง admin onboard ที่ต้องเพิ่ม

| ID | มุม | รายการ | slice |
|---|---|---|---|
| A-01 | SUP | คิว: ป้าย LINE, ชื่อ LINE, เบอร์ (tap-to-call), เวลายอมรับข้อกำหนด, hint "LINE นี้มีบัญชี → ร้านที่ 2", **hint เบอร์ซ้ำกับร้านเดิม** (กันลูกค้าที่แอดมินเปิดร้านให้แล้วมาสมัครซ้ำ), ปุ่ม SUSPEND, toggle แจ้ง reject | L-C |
| A-02 | SUP | แท็บ "อนุมัติอัตโนมัติ 14 วัน" (B-09) + แท็บ "คำขอเปลี่ยนแพ็กเกจ" → ปุ่มเปิดหน้า partner (เปลี่ยนแพ็กเกจด้วย `PUT plan-term` เดิม) | L-C |
| A-03 | SUP | หน้า partner: timeline ต่อร้าน, กล่องส่งข้อความ (SEC-05), ปุ่ม "ตรวจแล้ว" ปลด warm-up, ปุ่มต่ออายุทดลอง (มีแล้ว: `POST plan-term/renew`), แสดงงบ AI/การใช้ (มีแล้ว `GET ai-usage`) | L-C |
| A-04 | SEC/UX | หน้า "เปิดบริษัทใหม่" (แอดมินสร้างเอง): เพิ่มตัวเลือก **"ลูกค้าใช้ LINE เท่านั้น"** → ไม่ออก temp password, ให้ owner LINE QR (มีแล้ว) — ลด temp password ในระบบ | L-C (เล็ก) |
| A-05 | SUP | `/system/users` แสดง LINE-only user (ค้นหา displayName ทำงานอยู่แล้ว `lookup-users.use-case.ts:50-56`) + ป้าย LINE | L-C |

### 1F. UX / SUP — สิ่งที่ลูกค้าเห็น (แก้จากรอบนี้)

- **ทุกข้อความ** (ประตู, สถานะ, พร้อมใช้, ชนโควตา, งบ AI หมด, หมดอายุ, ปฏิเสธ, กันหลุด) มีตารางเดียวใน spec §7 — เพิ่มแถว "งบ AI ช่วงทดลองครบ" (G-05) และ "ข้อมูลยังอยู่" ตอนหมดอายุ (retention)
- **หมดอายุ 30 วัน = ร้านปิดแต่ข้อมูลอยู่** — copy ต้องบอกชัด + ปุ่มขอเปลี่ยนแพ็กเกจ + แอดมินต่ออายุได้ (`renew` มีแล้ว) → ลูกค้าไม่กลัวเสียงาน = อยากกลับมา
- **ครั้งแรกที่ส่งใบเสร็จสำเร็จ** = จังหวะที่ลูกค้า "เก็ต" — reply ของ AI ที่มีอยู่แสดงผลอ่านอยู่แล้ว; เพิ่มบรรทัดเดียว "นี่คือใบที่ 1 จาก 15 ในช่วงทดลอง" (โปร่งใส ไม่กดดัน)
- เช็คลิสต์ความครบ (L-E) ไม่บล็อกอะไร — เตือนเฉพาะตอนจำเป็นจริง

## 2. Scope หลังรีวิว (แผน v2)

| slice | เดิม | เพิ่ม/เปลี่ยน |
|---|---|---|
| L-A core | migration, tier, submit/status, transitions, provisioning, warm-up, budget, business hours | + **pre-flight B-01 ตรวจและแก้ tier** · + partial unique index (B-05) · + `upsertCompanyContext` (B-06) · + ตะขอจ่ายเงิน/อีเมล (H-01/H-02 เฉพาะ schema+port) · + `SUSPEND` |
| **L-A2 ตัวนับสลิป (ใหม่)** | — | `CompanyReceiptUsage` + CAS + บังคับก่อน OCR (LINE + เว็บ) + copy + การ์ด + แบนเนอร์เว็บ |
| L-B LIFF/handoff/ข้อความ | LIFF 2 mode, session, การ์ด, push, กันหลุด | + `follow` (G-03) · + postback dispatcher (G-04) · + reply งบ AI หมด (G-05) · + push adapter จัดการ 429 (G-07) · + บรรทัด "ใบที่ n/15" |
| L-C admin/support/flags | คิว, partner, users, playbook, deploy.sh | + A-01…A-05 · + แท็บ auto 14 วัน · + hint เบอร์ซ้ำ |
| L-D หน้าปัด | funnel + ต้นทุน | + push/เดือน · + catalog signals (G-08) |
| **L-E ข้อมูลร้านและบัญชีของฉัน (ใหม่)** | — | หน้าเดียว + เช็คลิสต์ + prompt ตามบริบท (ใช้ API identity/VAT/email-verification เดิม; เพิ่ม endpoint เบอร์/รหัสผ่านสำรองถ้ายังไม่มี) |

ลำดับ: **L-A (รวม pre-flight) → L-A2 → L-B → L-C → L-E → UAT รอบแรก → L-D** (L-D จำเป็นก่อน AUTO_FREE บน prod ไม่ใช่ก่อน UAT)

## 3. SDLC checklist (ต้องตอบ "มีหลักฐาน" ทุกข้อก่อน PR)

- **Requirements/Design:** spec v4 + plan v2 อ้าง file:line; Owner ตอบครบ (§13)
- **Build:** ทุก slice = branch เดียว จาก develop ล่าสุด; contracts → api → web ตามลำดับ; ไม่แตะ package.json; pinned files re-sync
- **Test:** unit ตาม spec §11 + ของใหม่ (ตัวนับสลิป CAS พร้อมกัน 2 request, B-01 integration, follow/postback, budget reply); full api/web suites เขียว; typecheck เขียว; E2E เดิมไม่หัก; UAT script 12 เคส (มือถือจริง)
- **Data:** migration additive ทั้งหมด (nullable/ตารางใหม่/index ใหม่); ไม่มี backfill; ตรวจ `contactEmail` readers ทุกตัว (B-03) ด้วย grep + test
- **Deploy:** flag `LINE_SIGNUP_ENABLED=false` บน prod จน Owner สั่ง (deploy.sh hard-stop); UAT true; deploy ตามโปรโตคอล runbook V2 (บันทึก run id)
- **Rollback:** ปิด flag = LIFF/endpoints 403 ทันที; ร้านที่สร้างแล้วเป็นบริษัทปกติ ไม่ต้อง rollback ข้อมูล; ตัวนับสลิปมีผลกับทุกร้าน → ต้องมี flag แยก `RECEIPT_QUOTA_ENFORCED` (default: UAT true / prod false จนกว่าจะพร้อม) เพราะกระทบลูกค้าเดิม
- **Ops/Monitoring:** แจ้ง SYSTEM_ADMIN (dashboard+LINE ผ่าน notify pattern เดิม) เมื่อ: ชนเพดาน auto/วัน, push 429, provisioning ล้มเหลว, งบ AI ร้านทดลองหมด > N ราย/วัน; หน้าปัด L-D
- **Docs:** support playbook + runbook กู้บัญชี + rich menu console update + agent-memory
- **Security review:** SEC-01…07 มี test/บันทึกครบ; PDPA: LEGAL-LIFF-01 record + DATA-MIN-01

## 4. คำตัดสินที่ยังต้องการจาก Owner (3 ข้อ สั้นๆ)

1. **ตัวนับสลิปมีผลกับลูกค้าเดิมด้วยไหม** — เมื่อเปิดบังคับ ร้านเดิมที่ tier STARTER_249 (30 ใบ) จะถูกจำกัดจริงเป็นครั้งแรก (ไม่เคยถูกจำกัดมาก่อน) → เสนอ: เปิดบน UAT ก่อน, prod เปิดพร้อมประกาศล่วงหน้าทางไลน์ให้ลูกค้าเดิม 7 วัน
2. **Slice L-E (หน้าข้อมูลร้าน/บัญชีของฉัน)** ยืนยันให้ทำในรอบนี้ (จำเป็นสำหรับ "กรอกที่เหลือทีหลัง" และช่วยลูกค้าทุกช่องทาง)
3. **A-04 ตัวเลือก "ลูกค้าใช้ LINE เท่านั้น" ในหน้าเปิดบริษัทใหม่** — ทำรอบนี้ (เล็ก) หรือ Phase 2

ถ้าไม่ตอบ ผมใช้ค่าเริ่มต้น: (1) เปิด UAT / prod ปิดไว้ก่อน (2) ทำ (3) ทำรอบนี้ — และเดินหน้า L-A ทันทีเพราะไม่ขึ้นกับ 3 ข้อนี้
