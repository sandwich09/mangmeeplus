# Spec: "ติดต่อเจ้าหน้าที่" ต้องถึงคนจริง (P10-L §8 delta, v1)

สถานะ: APPROVED-FOR-BUILD (Owner 2026-09-05: ตอบลูกค้าจาก "กล่องในหน้า partner ของเว็บ") · เจ้าของ: Owner · ผู้เขียน: Fable · ผู้ทำ: Opus · deploy: รวมรอบเดียวกับชุด 2026-09

## 0. หลักฐาน (UAT 2026-09-05, build 1399bb83)

| # | เห็นอะไร | สาเหตุในโค้ด (develop `c7b1d138`) |
|---|---|---|
| E1 | Owner กด "ติดต่อเจ้าหน้าที่" 16:38 → "รับเรื่องแล้วค่ะ" แต่ไม่มีใครรู้เรื่อง | `deliverSupportNotice` (`line-signup-notify.service.ts:191`) push หาเฉพาะ SYSTEM_ADMIN ที่มี `ExternalIdentity` LINE ACTIVE; UAT (และ production) ไม่มีแอดมินผูก LINE → ส่ง 0 ข้อความ แต่ outbox = PUBLISHED, ไม่มี log/alert |
| E2 | การแจ้งเตือน (ถ้าส่งได้) จะบอกว่า "The lobby clube" ทั้งที่ผู้กดเลิกผูกจากร้านนั้นตั้งแต่ 2026-09-02 และกำลังสมัครร้านใหม่ "The sun coffee" | `LineCompanyContext` (ต่อ LINE user) ไม่ถูกลบตอน unlink; `pauseAssistant` (`process-line-webhook.use-case.ts:1611`) ใช้ `companyId` จากแถวค้างนั้นทั้งตั้ง pause และตั้งชื่อร้านในข้อความแอดมิน + ลิงก์หน้า partner ผิดร้าน |
| E3 | AI ของแชทนั้นหยุด 24 ชม. ไม่มีปุ่มปลด ไม่มีหน้าให้เห็นว่ามีใครรอ | ไม่มี UI ใน /system; pause หมดเองอย่างเดียว (`SUPPORT_PAUSE_MS`) |
| E4 | แจ้งเตือนได้วันละครั้งต่อร้าน/ต่อคน (outbox key) — กดซ้ำเงียบ | ออกแบบไว้เพื่อกัน spam; ไม่มีที่ให้ย้อนดู |

## 1. หลักการ

- คำว่า "รับเรื่องแล้ว" ต้องเป็นจริง: ระบบต้องรู้ว่าส่งถึง **ใคร** และถ้าส่งถึงใครไม่ได้ต้อง **ดัง** (ops alert) ไม่ใช่ PUBLISHED เงียบ ๆ
- ผู้กดเป็นใครตอนนี้ ไม่ใช่ตอนที่เคยผูก: ร้านที่ผูกกับคำขอ = ร้านที่ผู้กดเป็นสมาชิก ACTIVE อยู่จริง ณ ตอนกด (ผ่าน identity ACTIVE) มิฉะนั้น = "ยังไม่มีร้าน" (ถ้ามีคำขอสมัครค้าง ให้ลิงก์ไปคิวสมัคร)
- แอดมินตอบจาก **กล่อง "ส่งข้อความถึงร้าน" ในหน้า partner** (endpoint เดิม `POST /system/partners/:companyId/line-message`) — ไม่เปิด Chat ใน OA
- ลูกค้าไม่ควรติดอยู่กับ AI ที่เงียบ: ปลดเองได้ด้วยคำสั่ง

## 2. สิ่งที่ต้องเปลี่ยน

### 2.1 ตอนกด (`handleStaffContact`)
1. หา "ร้านปัจจุบัน" ใหม่ทุกครั้ง: identity LINE ACTIVE → user → membership ACTIVE ในร้าน ACTIVE (ถ้าหลายร้าน ใช้ร้านที่ context ชี้ **เฉพาะเมื่อ** ยังเป็นสมาชิกอยู่ ไม่งั้นร้านแรก); ไม่มี → `companyId = null` + หา `CompanySignupRequest` ที่ค้าง (`lineProviderUserId` = ผู้กด, state ยังไม่จบ) เพื่อใส่ลิงก์คิวสมัคร
2. ตั้ง pause เฉพาะเมื่อผู้กดผูกกับร้านนั้นจริง (identity ACTIVE); ผู้ที่เลิกผูกแล้วไม่มี AI ให้หยุด → ไม่ตั้ง pause แต่ยังแจ้งแอดมิน
3. บันทึกแถว **`LineSupportRequest`** (ตารางใหม่ เล็ก): id, companyId?, lineUserId (เก็บ hash + providerUserId ตามแบบ audit เดิม — ดูว่า audit ใช้อะไร), signupRequestId?, requestedAt, lastMessageText (ข้อความล่าสุดที่ผู้ใช้พิมพ์ก่อนกด ≤ 200 ตัวอักษร ถ้ามี), notifiedAdminCount, status `OPEN | ANSWERED | CLOSED`, answeredAt, answeredByUserId, closedAt, closedReason (`admin | customer_resumed | expired`)
4. ตอบลูกค้า: "รับเรื่องแล้วค่ะ ทีมงานจะตอบในแชทนี้ในเวลาทำการ (จันทร์–เสาร์ 9:00–18:00) หากรีบ โทร 098-256-5628 ได้เลยค่ะ · พิมพ์ 'คุยกับ AI ต่อ' ถ้าต้องการให้น้องมั่งมีตอบต่อ"

### 2.2 ส่งถึงแอดมิน (`deliverSupportNotice`)
1. ข้อความถึงแอดมิน: "📮 ลูกค้าขอคุยกับเจ้าหน้าที่: <ร้าน | ผู้ที่ยังไม่ได้เปิดร้าน (มีคำขอสมัคร: <ชื่อร้านที่ขอ>)> · <ข้อความล่าสุด> · ตอบที่: <ลิงก์หน้า partner หรือคิวสมัคร>"
2. นับผู้รับจริง: `notifiedAdminCount` = จำนวน push ที่ LINE ตอบสำเร็จ; log info `signup.support.notified` {count}
3. **ศูนย์ผู้รับ** (ไม่มีแอดมิน ACTIVE ที่ผูก LINE หรือ push ล้มทุกคน): log warn `signup.support.unreachable` (HIGH), ops alert `support_unreachable` ผ่าน `SignupOpsAlertService` (วันละครั้ง) และ **อีเมล** ไปกล่อง support (`contact@mangmeeplus.com` — ใช้ทาง SES เดิมของ ops alert; ถ้า SES ยังไม่พร้อม ให้ enqueue แบบเดิม ไม่ throw) — แถว outbox จบเป็น PUBLISHED ได้ (งานคือ "พยายามส่ง") แต่ `LineSupportRequest` ต้องเห็น `notifiedAdminCount = 0` ในหน้า /system
4. dedup วันละครั้ง **ต่อคำขอที่ยัง OPEN** (ไม่ใช่ต่อวัน): ถ้าคำขอเดิม OPEN อยู่ ให้ตอบลูกค้าว่า "ยังอยู่ในคิวค่ะ" ไม่แจ้งซ้ำ; ถ้าปิดไปแล้ว กดใหม่ = คำขอใหม่ + แจ้งใหม่

### 2.3 หน้า /system "คำขอคุยกับเจ้าหน้าที่" (เว็บ)
- เมนู `/system/support-requests`: ตาราง OPEN ก่อน (ร้าน/ผู้ขอ, เวลา, รอมานาน, ข้อความล่าสุด, แจ้งถึงแอดมินกี่คน, สถานะ) → กดเปิดหน้า partner (มีกล่องส่งข้อความเดิม) หรือคิวสมัคร
- ปุ่ม "ตอบแล้ว" (ANSWERED, เก็บผู้ตอบ) และ "ให้ AI ทำงานต่อ" (ล้าง `aiPausedUntil` ของ LINE user นั้น + CLOSED `admin`) — สิทธิ์เดียวกับหน้า partner (`system.company_onboarding.create` หรือสิทธิ์อ่าน/เขียนที่หน้า partner ใช้ — อ่านจากโค้ดจริง); audit ทุกปุ่ม
- badge จำนวน OPEN บนเมนู system (ถ้ามีแบบเดิมของคิวสมัคร ใช้แบบเดียวกัน)
- API: `GET /system/support-requests?status=`, `POST /system/support-requests/:id/answered`, `POST /system/support-requests/:id/resume-ai`; contracts ใน `packages/contracts`
- การส่งข้อความจากหน้า partner ถึงร้านที่มีคำขอ OPEN → ตั้ง ANSWERED อัตโนมัติ (hook ใน `send-partner-line-message.use-case.ts`)

### 2.4 ลูกค้าปลดเอง
- คำสั่ง "คุยกับ AI ต่อ" / "ให้ AI ตอบ" (exact match แบบ `STAFF_CONTACT_COMMAND`) → ล้าง pause ของ LINE user นั้น + CLOSED `customer_resumed` + ตอบ "น้องมั่งมีกลับมาแล้วค่ะ" — ไม่ต้องผูกก็พิมพ์ได้ (ไม่มี pause ก็ตอบเหมือนกัน)
- pause หมดเอง 24 ชม. → worker sweep ปิดคำขอเป็น `expired` (วันละครั้ง ใช้ sweep เดิมของ P10-L)

### 2.5 unlink ต้องเก็บกวาด
- `unlink-line-identity` และ `partner-member-line-unlink`: ลบ/ล้าง `LineCompanyContext` ของ LINE user นั้น (companyId ไม่ควรชี้ร้านที่เลิกผูกแล้ว) — ดู impact: company switcher, pending media/intake state ที่ key ด้วย (companyId,userId) ไม่กระทบเพราะ userId เดิม

## 3. ความปลอดภัย/PDPA
- ไม่มี LINE id ดิบในหน้า /system (แสดงชื่อร้าน/ชื่อ LINE ที่มีอยู่แล้วในคำขอสมัคร หรือ hash 6 ตัวท้าย)
- ข้อความล่าสุด ≤ 200 ตัวอักษร, ไม่เก็บรูป; ลบเมื่อคำขอ CLOSED เกิน 90 วัน (sweep เดิม)
- คำสั่งปลดเป็น exact match กันสั่งจากรูป/ข้อความแทรก; ปุ่ม /system ตรวจสิทธิ์ + audit

## 4. Gates
- unit + pg spec: ร้านปัจจุบัน re-derive (linked / unlinked-with-pending-signup / unlinked-no-request / multi-shop), pause เฉพาะ linked, ศูนย์ผู้รับ → warn + ops alert + email enqueue, dedup ต่อ OPEN, resume command, /system endpoints (สิทธิ์, audit, resume ล้าง pause), unlink ล้าง context
- mutations ≥ 4: ตัด unreachable alert; ใช้ context ค้างแทน membership; resume ไม่ล้าง pause; unlink ไม่ล้าง context
- web QA spec หน้าใหม่ + `next build`; local LINE-fake drive: กด → แถว OPEN → ตอบจากหน้า partner → ANSWERED → "คุยกับ AI ต่อ" → CLOSED
- migration additive (ตารางใหม่ + index (status, requestedAt))

## 5. ไม่ทำรอบนี้
เปิด Chat ใน OA; SLA timer/escalation; แชทสองทางในเว็บ (ตอบทีละข้อความผ่านกล่องเดิมพอ)
