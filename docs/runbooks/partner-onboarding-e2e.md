# Partner Onboarding E2E Runbook — เพิ่ม partner company + LINE OA จนถึงลูกค้าคุย AI และพนักงานตอบผ่าน CRM

Created 2026-07-10. Operational runbook ครอบ flow ทั้งเส้น: system admin สร้าง partner
company → เชื่อม LINE OA ของ partner → end customer ทักแชท → AI ตอบ/ช่วยร่าง →
พนักงานตอบผ่าน CRM Inbox. ทุก step ยืนยันกับโค้ดจริงแล้ว ณ 2026-07-10 (§verified paths ท้ายเอกสาร).

รายละเอียด LINE console ฉบับเต็มอยู่ใน [[runbooks/b1-b2-line-external-setup]] —
เอกสารนี้เป็นภาพรวม E2E และเก็บส่วนที่ runbook นั้นไม่ครอบ (onboarding, สิทธิ์, AI stack, verification).

---

## ภาพรวม: ระบบมี LINE OA 2 แบบ (อย่าสับสน)

| | WatchDog shared OA | **Company LINE OA (ของ partner)** ← เอกสารนี้ |
|---|---|---|
| ใครคุย | พนักงานของ partner (ถาม AI ภายใน, รับ alert) | **end customer ของ partner** |
| Credentials | ของ platform (env `LINE_MESSAGING_*`) | ของแต่ละบริษัท เก็บ AES-256-GCM ใน DB |
| Webhook | `POST /v1/line/webhook` | `POST /v1/crm/line/webhook/<webhookKey>` |
| Company resolution | จาก linked identity + context (ห้ามใช้ channel) | จาก channel record ตรง ๆ (ปลอดภัยเพราะ OA เป็นของบริษัทเดียว) |

Flow ที่ตั้งค่า: **ลูกค้าทัก OA ของ partner → CRM Inbox → AI ตอบเอง (ถ้าเปิด) หรือ
holding message + ร่างให้พนักงาน → พนักงานตอบจากเว็บ → ลูกค้าเห็นใน LINE**

---

## เตรียมก่อนเริ่ม (Prerequisites)

- บัญชี system admin (`thawatchai.watchdog`) — permission `system.company_onboarding.create`
- บัญชี **LINE Business ID** ของ partner + สิทธิ์เข้า `developers.line.biz` และ `manager.line.biz`
- Prod origin: `https://mangmeeplus.com`
- ถ้าจะเปิด AI: env stack ตาม §Phase 5 ต้อง deploy ครบ (AI Gateway + workers + kill switch)

---

## Phase 1 — System admin สร้าง partner company

1. Login เป็น system admin → เข้า **`/system/partners`** → กดปุ่มสร้าง partner
   (ลิงก์ไป `/system/company-onboardings/new`)
2. กรอกฟอร์ม — ช่องบังคับมี 3 ช่อง:
   - **ชื่อบริษัท** (`companyName`)
   - **ชื่อ owner** (`ownerDisplayName`)
   - **username ของ owner** (`ownerUsername`)
   - ตัวเลือก: ผูก owner user ที่มีอยู่แล้ว (`attachExistingOwner`), module package,
     LINE OA add URL / account-link URL สำหรับ handoff
   - ระบบสร้าง company จากชื่ออย่างเดียว — ข้อมูลบริษัทอื่น (tax id ฯลฯ) เติมทีหลัง
3. ระบบสร้างครบใน transaction เดียว: company + branch สำนักงานใหญ่ (`HO`) + owner user +
   membership + role OWNER + feature entitlements + onboarding run + audit
   - Package มาตรฐานเปิด feature: `expenses`, `crm`, `ai_line_assistant`
   - key ที่ gate CRM Inbox จริงคือ **`crm`** (`crm_line_inbox` เป็นแค่ vocabulary ในแผน
     ยังไม่มีอะไร honor — เปิดแค่ตัวนั้นสิทธิ์ `crm.*` จะโดน strip ทั้งชุด)
4. ระบบโชว์ **handoff package ครั้งเดียว**: web URL, username,
   **รหัสผ่านชั่วคราว (อายุ 72 ชม. ไม่โชว์ซ้ำ)**, dashboard URL, LINE QR/URL
5. ส่ง handoff ให้ลูกค้าผ่านช่องทางที่ปลอดภัย
   - รหัสหมดอายุ/หาย → regenerate ที่ `POST /v1/system/company-onboardings/:id/regenerate-temporary-password`
     (มีปุ่มในหน้า partner detail)
   - แก้ profile / lifecycle (ACTIVE, DISABLED, ARCHIVED) / features / AI model ทีหลังได้ที่
     **`/system/partners/[companyId]`**

## Phase 2 — Owner เข้าระบบครั้งแรก + ตั้งทีม

6. Owner login ด้วยรหัสชั่วคราว → ระบบ**บังคับเปลี่ยนรหัสผ่าน** →
   เข้า `/companies/<companyId>/dashboard`
7. Owner เชิญ/สร้างพนักงานและให้ role — สิทธิ์ CRM ตามโค้ดจริง:

| Role | ทำอะไรได้ใน CRM |
|---|---|
| ADMIN | ทุกอย่าง รวม **เชื่อม/จัดการ LINE OA + เปิด auto-reply** (`crm.channel.manage`, risk CRITICAL — role เดียวที่มี) |
| MANAGER | อ่าน/ตอบ/โน้ต/resolve + **assign ให้คนอื่น** + AI assist |
| SALES | อ่าน/ตอบ/โน้ต/resolve + AI assist + **หยิบงานเข้าตัวเอง** (assign ให้คนอื่นไม่ได้) |
| COMPANY_VIEW / AUDITOR | อ่านอย่างเดียว |

## Phase 3 — สร้างและเชื่อม LINE OA ของ partner

> ฉบับละเอียดพร้อมภาพหน้าจอ console: [[runbooks/b1-b2-line-external-setup]]

8. **LINE Developers Console**: สร้าง Provider ชื่อแบรนด์ partner → Create channel →
   **Messaging API** → เก็บ 3 ค่า: **Channel ID**, **Channel secret** (Basic settings),
   **Channel access token แบบ long-lived** (แท็บ Messaging API กด Issue)
9. **OA Manager** (`manager.line.biz`) → Settings → Response settings:
   **Chat = เปิด, Auto-response = ปิด** (ไม่งั้น LINE ตอบทับ), **Webhooks = เปิด**
10. ในแอป (user ที่เป็น ADMIN): **`/companies/<companyId>/settings/line-oa`** →
    กรอก 4 ช่อง (ชื่อที่แสดง, Channel ID, Channel Secret, Access Token) → กด **เชื่อมต่อ**
    - ระบบ verify กับ LINE ทันทีทั้ง 3 ค่า: access token (`GET /v2/bot/info`),
      token↔Channel ID ต้องตรงกัน, และ **Channel Secret** (probe `POST /v2/oauth/accessToken`
      แล้ว revoke ทันที) — secret ผิดจะโดนปฏิเสธตั้งแต่กดเชื่อมต่อ, LINE ล่ม = fail-open
    - credentials เก็บ AES-256-GCM ต่อบริษัท (`CompanyMessagingChannel.encryptedSecretJson`)
    - หน้าเดียวกันมีปุ่ม **ทดสอบการเชื่อมต่อ / เปลี่ยน Credential / ดู Credential (บันทึก audit) /
      ปิดการใช้งาน** — ปุ่มทดสอบเช็คแค่ access token ไม่ได้พิสูจน์ว่า secret ถูก
11. กดปุ่ม**คัดลอก Webhook URL** ที่ระบบสุ่มให้ — รูปแบบ
    `https://mangmeeplus.com/v1/crm/line/webhook/<webhookKey>` (**อย่าพิมพ์เอง**) →
    วางใน LINE Console → Messaging API → Webhook settings →
    **Use webhook = ON → กด Verify ต้องได้ Success**

## Phase 4 — Smoke test ข้อความเข้า

12. แอด OA เป็นเพื่อน → ทัก 1 ข้อความ
13. เช็ค 2 จุด:
    - หน้า LINE OA settings: "Webhook ล่าสุด" (`lastWebhookAt`) อัปเดตเป็นเวลาปัจจุบัน
    - **`/companies/<companyId>/inbox`**: เห็นข้อความ + ระบบสร้าง customer
      "ลูกค้า LINE" + conversation อัตโนมัติ (ชื่อ/รูปจริง enrich ตามหลังจาก LINE profile)
14. Verify ผ่านแต่ข้อความไม่เข้า → เช็ค Auto-response ใน OA Manager ต้องปิด,
    channel `status` ต้องไม่ใช่ `DISABLED` (webhook ของ channel ที่ disabled ถูก drop เงียบ)

## Phase 5 — เปิด AI คุยกับลูกค้า

ต้องเปิดครบ **3 ชั้น** — ขาดชั้นไหน AI เงียบ (fail-closed, inbox ยังใช้ตอบมือได้ปกติ):

| ชั้น | ค่า | หมายเหตุ |
|---|---|---|
| AI Gateway | `MODEL_PROVIDER=bedrock` + `BEDROCK_MODEL_ID` + `BEDROCK_REGION` | default `disabled` = ปุ่ม AI ขึ้น "ไม่พร้อมใช้งาน" |
| API ↔ Gateway | `AI_GATEWAY_INTERNAL_URL` + `AI_GATEWAY_INTERNAL_SECRET` | prod บังคับต้องมี |
| Kill switch | `CRM_AUTO_REPLY_ENABLED=true` | global, default false |

15. Deploy env ข้างบน + **workers ต้องรัน** (`QUEUE_ENABLED=true` + `REDIS_URL`):
    auto-reply ครั้งแรกยิง best-effort ทันทีจาก webhook แต่ **retry เมื่อพลาด, SLA alert,
    แจ้งเตือนแชทใหม่, เตือนนัดหมาย อยู่ใน workers ทั้งหมด** — ไม่รัน = ฟีเจอร์เหล่านี้เงียบ
16. เปิดรายช่องที่หน้า `/companies/<companyId>/settings/line-oa` (ADMIN):
    - **toggle auto-reply** (default OFF)
    - **`autoReplyDailyCap`** (default 50/วัน, `0` = หยุด) — เริ่มต่ำ ๆ:
      push quota ฟรี ~300 ข้อความ/เดือน ใช้ร่วมกับ staff notification
    - **default booking staff/branch** ถ้าจะให้ AI จองนัดเอง
17. พฤติกรรมที่ได้ (autonomy ladder, spec §27–28):
    - **L0**: คำถามข้อมูลทั่วไป AI ตอบลูกค้าเองทุกคนรวมลูกค้าใหม่ เมื่อ
      confidence ≥ `CRM_AI_MIN_CONFIDENCE` (default 0.7) — ใช้ reply-token ฟรีก่อน push fallback
    - เคสที่ไม่ตอบเอง (ร้องเรียน / จองไม่ชัด / เสียง-วิดีโอ / confidence ต่ำ / เกิน cap):
      ลูกค้าได้ **holding message** แล้วแชทเข้าคิวพนักงานพร้อม AI draft
    - **Auto-booking**: จองให้เองเมื่อ gate deterministic ครบ (toggle + cap + consent +
      confidence + staff/branch resolve ได้ + slot ว่างแบบ race-safe)
    - Cap ต่อบทสนทนา 5 ข้อความ AI/วัน; consent `REVOKED` = ไม่ auto ส่งทุกกรณี;
      ทุกข้อความ AI mark `authorType: AI` ใน thread + audit
18. **ปิด/เปิด AI รายแชทได้** (spec §29, shipped 2026-07-10): checkbox "AI ตอบแชทนี้"
    ใน header ของบทสนทนา (สิทธิ์ `crm.inbox.reply` — SALES/MANAGER/ADMIN กดได้)
    - ปิดแล้ว = staff mode ล้วนสำหรับแชทนั้น: ไม่ auto-reply, ไม่ auto-booking,
      ไม่มี holding message + badge "AI ปิดอยู่ (แชทนี้)" ชัดเจน
    - กัน race แล้ว: job ที่ค้างคิว/AI ที่กำลังคิดอยู่ re-check flag สด ๆ อีกครั้ง
      ที่ขอบสุดท้ายก่อนส่ง/จอง (เหลือ race ระดับ ms เป็น accepted bound)
    - ทุกการสลับถูก audit (`crm.inbox.auto_reply_override` พร้อมค่าเก่า/ใหม่)
    - กันชนตอบซ้ำเดิมยังอยู่: พนักงานตอบก่อน job retry → job ยกเลิกตัวเอง

## Phase 6 — พนักงานตอบโต้ผ่าน CRM

19. เปิด **`/companies/<companyId>/inbox`** — 3 คอลัมน์: รายการแชท (filter
    All / Assigned / Unassigned / Overdue SLA), หน้าต่างแชท, Customer 360 sidebar
    - SLA default: ตอบครั้งแรกใน 30 นาที เวลาทำการ 09:00–18:00 Asia/Bangkok
      (ปรับได้ที่ inbox policy) — มีสี countdown + แจ้งเตือน assignee/manager เมื่อ breach
20. ปุ่ม AI ฝั่งพนักงาน (สิทธิ์ `crm.ai.assist`): สรุปบทสนทนา / **ร่างคำตอบ** / insights —
    เป็น draft เสมอ แก้แล้วกดส่งเอง ไม่มี endpoint ที่ generate แล้วส่งในตัว
21. กดส่ง → push ไป LINE OA ของ partner → ลูกค้าเห็นในแชทเดิม
    - ส่ง fail → retry อัตโนมัติ exponential backoff สูงสุด 5 ครั้ง; terminal error
      (token เสีย) ขึ้น FAILED บน bubble + channel status `ERROR` + banner
    - **Internal note** แยกแท็บ/สี ส่งไป LINE ไม่ได้เชิงโครงสร้าง
22. งานต่อยอดจาก conversation: assign, เปลี่ยนสถานะ/แท็ก/priority, สร้างดีล/นัดหมาย/
    ใบเสนอราคา, mark resolved — owner ดูภาพรวมที่ Daily Brief บน dashboard
23. (ทางเลือก) ส่งลิงก์ **LIFF registration** ให้ลูกค้าลงทะเบียน + ยืนยัน PDPA consent —
    ระบบ stamp `verifiedLinkAt` + `consentStatus: GRANTED` ให้ customer record

---

## Checklist ยืนยัน E2E ผ่าน

- [ ] ลูกค้าทัก OA → ข้อความโผล่ inbox ภายในไม่กี่วินาที, company scope ถูกต้อง
- [ ] เปิด toggle แล้ว: คำถามทั่วไป → AI ตอบเองใน LINE พร้อม mark AI ใน thread
- [ ] เคสร้องเรียน/กำกวม → holding message + เข้าคิว staff พร้อม draft
- [ ] พนักงานตอบจากเว็บ → ลูกค้าได้รับใน LINE; ส่ง fail มี retry/สถานะบน bubble
- [ ] Internal note ไม่หลุดไป LINE
- [ ] Disable channel → webhook ถูก drop เงียบ ไม่มีข้อมูลหาย

## Troubleshooting

| อาการ | เช็ค |
|---|---|
| Verify webhook ไม่ผ่าน | URL ต้องมาจากปุ่มคัดลอก (webhookKey สุ่ม), OA Manager Webhooks = เปิด |
| Verify webhook ได้ **401** | Channel Secret ที่เก็บไว้ไม่ตรงกับ channel (เราปฏิเสธ signature เอง — channel record ที่ผูกไว้เก็บ secret ผิด เจอได้กับ channel ที่ connect ก่อนมี secret probe) → กด **ดู Credential (บันทึก audit)** เทียบ secret กับ Basic settings ใน console → **เปลี่ยน Credential** ใส่ secret+token ที่ถูก (**อย่ากดเชื่อมต่อใหม่** — webhook URL จะถูกสุ่มใหม่ ต้องวางใน LINE Console ซ้ำ) → Verify อีกครั้ง; "ทดสอบการเชื่อมต่อ" เขียวไม่ได้แปลว่า secret ถูก |
| Verify ผ่านแต่ข้อความไม่เข้า inbox | Auto-response ใน OA Manager ต้องปิด; channel ไม่ `DISABLED` |
| AI ไม่ตอบทั้งที่เปิด toggle | ไล่ 3 ชั้น §Phase 5: `MODEL_PROVIDER` ≠ disabled → `AI_GATEWAY_INTERNAL_*` → `CRM_AUTO_REPLY_ENABLED`; แล้วเช็ค cap หมด (`autoReplyDailyCap`, 5/บทสนทนา/วัน), consent `REVOKED`, confidence ต่ำ (เจตนา — ตกไป staff path) |
| ตอบจากเว็บแล้วลูกค้าไม่ได้รับ | ลูกค้า block/เลิกติดตาม OA (FAILED พร้อมเหตุผล), access token ถูก revoke (channel `ERROR` → Rotate credentials) |
| ปุ่ม AI ขึ้นไม่พร้อมใช้งาน | AI Gateway ยัง `MODEL_PROVIDER=disabled` หรือ gateway ไม่ได้รัน — fail-closed ตามดีไซน์ |
| ทดสอบ local | LINE ไม่รับ `localhost` — ต้องมี HTTPS tunnel แล้ววาง URL tunnel ใน LINE Console (`<tunnel>/v1/crm/line/webhook/<key>`) |

## Verified code paths (สำหรับ maintainer, ยืนยัน 2026-07-10)

- Onboarding API: `POST /v1/system/company-onboardings`
  (`apps/api/src/modules/system-onboarding/presentation/http/system-onboarding.controller.ts`,
  use case `create-company-onboarding.use-case.ts` — company/owner/membership/OWNER role/
  branch HO/entitlements/audit ใน transaction เดียว, temp password 72h)
- Partner UI: `apps/web/app/system/partners/page.tsx` (+ create CTA → `company-onboardings/new`),
  partner detail `partners/[companyId]/page.tsx`
- Feature gate จริง: `CRM_INBOX_ENTITLEMENT_KEY = 'crm'`
  (`apps/api/src/modules/crm-inbox/domain/crm-inbox.constants.ts`)
- Connect channel: `POST /v1/companies/:companyId/crm/channels`
  (`messaging-channel.controller.ts`, perm `crm.channel.manage`), verify กับ LINE ก่อน persist
  (token + secret probe `LineMessagingAdapter.verifyChannelSecret` — ใช้ทั้ง connect และ rotate),
  AES-256-GCM ด้วย `CREDENTIAL_ENCRYPTION_KEY`
- Webhook: `POST /v1/crm/line/webhook/:webhookKey` (`crm-line-webhook.controller.ts`) —
  resolve channel จาก key → verify `x-line-signature` ด้วย secret ของ channel นั้น →
  company = `channel.companyId`
- Ingest + auto-reply orchestration: `process-inbound-line-message.use-case.ts`
  (dedup ด้วย providerMessageId/webhookEventId, สร้าง customer/conversation/message,
  `CrmAutonomyJob` durable + inline best-effort, reply-token ก่อน push fallback)
- Auto-reply gates: `crm-ai-auto-reply.use-case.ts` (env → channel toggle → consent →
  cap/บทสนทนา 5 → cap/ช่อง → confidence → turn class)
- Staff send: `POST .../crm/conversations/:id/messages` (`crm-conversation.controller.ts`,
  perm `crm.inbox.reply`); AI assist: `POST .../ai/{summary,reply-draft,insights}` +
  `GET .../ai/trust` (`crm-ai-assist.controller.ts`, perm `crm.ai.assist`)
- AI Gateway: `apps/ai-gateway/src/modules/crm-customer-ai/` (`POST /internal/ai/crm-*`,
  mode `STAFF_ASSIST` | `AUTONOMOUS`) — แยก module จาก employee agent family
- Workers: `apps/workers/src/modules/crm-inbox/crm-sla-worker.ts` (autonomy retry scan,
  reply retry + media re-fetch, SLA scan, new-conversation scan, booking reminder)
- Inbox UI: `apps/web/app/(workspace)/companies/[companyId]/inbox/page.tsx` →
  `apps/web/src/features/crm-inbox/InboxPrototypePage.tsx`
- LIFF customer register: `POST /v1/auth/line/customer-register` + register page
  (`customer-line-register.controller.ts`)
- Roles/permissions: `apps/api/src/modules/auth/permission-registry.ts`
  (`crm.channel.manage` = ADMIN เท่านั้น; SALES self-pickup only)

## Links

- LINE console ละเอียด: [[runbooks/b1-b2-line-external-setup]]
- Onboarding spec: [[specs/admin-company-onboarding-spec]]
- CRM + AI behavior: [[specs/crm-line-oa-customer-os-spec]] §27–28 (autonomy ladder, caps)
- Shared OA (คนละเส้นทาง): [[specs/line-ai-channel-auth-spec]]
