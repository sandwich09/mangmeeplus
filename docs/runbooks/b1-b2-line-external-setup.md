# B1 / B2 — LINE OA External Setup Runbook

Created 2026-07-09. Operational runbook สำหรับ [[plans/mvp-1-two-dev-parallel-plan]] Lane B
items **B1** (MVP1-0 LINE external) และ **B2** (MVP1-2 shared OA / rich menu).
Caps และ behavior ของ auto-reply อ้างอิง [[specs/crm-line-oa-customer-os-spec]] §27.

> **สถานะโค้ด (อัปเดต 2026-07-10):** ทุกอย่างฝั่ง ERP พร้อมแล้ว (connect wizard, webhook receiver,
> signature verify, encrypted credential store, prod `/v1/*` routing). B1/B2 เป็นงาน
> **console + กรอกข้อมูลในแอป** ล้วน. Verified paths อยู่ท้ายเอกสาร (§8).
> เพิ่มเติมจาก harness GC (2026-07-10): auto-reply เปิดได้จริงแล้วผ่าน per-channel toggle
> ในหน้า ตั้งค่า LINE OA (ต้องมี `crm.channel.manage`) + global env `CRM_AUTO_REPLY_ENABLED`
> ใน deploy; autonomous reply ใช้ reply-token ก่อน (push เป็น fallback); API มี rate limiter
> ตาม `RATE_LIMIT_*` แล้ว — ขั้นตอน enable auto-reply หลัง B1/B2 คือเปิด env + เปิด toggle รายช่อง

---

## เตรียมก่อนเริ่ม (Prerequisites)

- บัญชี **LINE Business ID** + สิทธิ์เข้า `developers.line.biz` และ `manager.line.biz`
- ล็อกอินแอปด้วย user ที่เป็น **ADMIN** — สิทธิ์ `crm.channel.manage` (risk `CRITICAL`)
  ผูกกับ ADMIN เท่านั้น (permission-registry §Item 15A)
- รู้ `companyId` ของบริษัทที่จะเชื่อม
- Prod origin: `https://mangmeeplus.com`

---

## 1. สร้าง Channel ใน LINE Developers Console

1. เข้า **LINE Developers Console** → สร้าง **Provider** (ถ้ายังไม่มี) ชื่อแบรนด์บริษัท
2. ใน Provider → **Create a new channel** → เลือก **Messaging API**
3. กรอกข้อมูล OA (ชื่อ, รูป, category) → สร้าง
4. เก็บ **3 ค่า** เพื่อไปกรอกในแอป:

| ค่าใน LINE Console | อยู่แท็บ | ช่องในแอป |
|---|---|---|
| **Channel ID** | Basic settings | Channel ID |
| **Channel secret** | Basic settings | Channel Secret |
| **Channel access token** (long-lived) | Messaging API → กด **Issue** | Access Token |

> ⚠️ ต้องใช้ access token แบบ **long-lived** (ปุ่ม Issue ในแท็บ Messaging API)
> ระบบจะ verify ว่า token ผูกกับ Channel ID นี้จริง — ถ้าไม่ตรงจะเชื่อมต่อไม่ผ่าน

---

## 2. ตั้งค่า OA behavior (LINE Official Account Manager)

เข้า `manager.line.biz` → เลือก OA → **Settings → Response settings**:

- **Chat** = เปิด
- **Auto-response messages** = **ปิด** (ให้ AI/staff ของเราคุมแทน ไม่ให้ LINE ตอบทับ)
- **Greeting messages** = ปิด หรือปรับตามต้องการ
- **Webhooks** = **เปิด**

---

## 3. เชื่อมต่อในแอป (Connect wizard)

1. เข้า **Settings → LINE OA**
   URL: `https://mangmeeplus.com/companies/<companyId>/settings/line-oa`
2. กรอก 4 ช่อง: **ชื่อที่แสดง**, **Channel ID**, **Channel Secret**, **Access Token**
3. กด **"เชื่อมต่อ LINE OA"** → ระบบยิงเช็คกับ LINE ทันที
   (`GET /v2/bot/info` + `oauth2/v2.1/verify` ยืนยันว่า token ↔ Channel ID ตรงกัน)
4. สำเร็จจะขึ้น **"เชื่อมต่อสำเร็จ — บอท '...' พร้อมใช้งาน"** พร้อมโชว์ **Webhook URL + ปุ่มคัดลอก**

> credentials ถูกเก็บ **AES-256-GCM encrypted** ต่อบริษัท (`CompanyMessagingChannel.encryptedSecretJson`) —
> ไม่ได้อยู่ใน env. หน้านี้มีปุ่ม **ทดสอบการเชื่อมต่อ**, **Rotate**, **Reveal (audited)**, **Disable** ด้วย

---

## 4. วาง Webhook URL กลับใน LINE Console

1. ในแอป กด **"คัดลอก"** ที่ Webhook URL — รูปแบบ:
   ```
   https://mangmeeplus.com/v1/crm/line/webhook/<webhookKey>
   ```
   `webhookKey` ระบบสุ่มให้ตอน connect (base64url) — **อย่าพิมพ์เอง ใช้ปุ่มคัดลอก**
2. กลับไป **LINE Developers Console → Messaging API → Webhook settings**:
   - วางในช่อง **Webhook URL**
   - **Use webhook** = ON
   - กด **Verify** → ต้องได้ **Success**

Signature ถูกตรวจอัตโนมัติ: HMAC-SHA256(rawBody, channelSecret) เทียบกับ header
`x-line-signature` (timing-safe). ตรวจ signature **ก่อน** ทุกอย่างเสมอ — ถ้าไม่ผ่าน
ตอบ 401, unknown key ตอบ 404 (generic, ไม่รั่ว channel state).

---

## 5. Rich menu (B2) — 3 ช่องตามแผน (rich menu DECIDED 2026-07-09)

สร้างใน OA Manager → Rich menu:

1. **แจ้งเตือน** → deep link เข้าศูนย์แจ้งเตือน
2. **สรุปค่าใช้จ่าย** → message action เข้า pipeline เดิม (10B/09)
3. **เปิดเว็บ** → deep link เข้าเว็บบริษัท

+ first-run link states + dev-OA journeys + หลักฐานตัดสิน 10F flags (ดู B2 ในแผน)

---

## 6. ⚠️ §27 ที่ต้อง verify ตอนตั้งค่า (สำคัญ)

สเปก §27 ตั้งสมมติฐานไว้ — ต้องยืนยันของจริงระหว่าง MVP1-0:

- **reply-token lifetime** — auto-reply ระดับ L0 ขี่ reply-token ฟรีจาก webhook
  (ยืนยันอายุ token ปัจจุบันของ LINE)
- **free-tier push quota** (~300 ข้อความ/เดือน) — **ใช้ร่วมกับ staff notification**
  อย่าให้ auto-reply กินโควตาหมด
- เริ่มปลอดภัย: ตั้ง **`autoReplyDailyCap` ต่ำ** (default 50, `0` = paused) หรือคง
  **AI toggle = OFF** จนกว่า smoke ผ่าน — B7 auto-reply ยังไม่ deploy อยู่แล้ว (รอ H3)

Cap semantics (§27): channel-level `autoReplyDailyCap` bound ปริมาณ L0 รวมทุกลูกค้า +
per-conversation cap (default 5/วัน, นับจาก `CrmMessage.authorType='AI'`) กัน abuse รายคน.
Cap หมด → staff path + holding message. Global kill switch env แยกต่างหาก.

---

## 7. Smoke test

1. แอด OA เป็นเพื่อน → ทักข้อความเข้าไป
2. หน้า LINE OA settings: **"Webhook ล่าสุด"** ต้องอัปเดตเป็นเวลาปัจจุบัน (`lastWebhookAt`)
3. หน้า **Inbox** (`/companies/<companyId>/inbox`): ต้องเห็นข้อความเข้ามา

ถ้า Verify ผ่านแต่ข้อความไม่เข้า: เช็ค OA response settings (auto-reply ต้องปิด),
channel `status` ต้องไม่ใช่ `DISABLED` (webhook ของ channel ที่ disabled จะถูก drop).

---

## 8. Verified code paths (สำหรับ maintainer)

ยืนยันแล้ว ณ 2026-07-09 ว่าเส้นทางครบและถูกต้อง:

- **Connect wizard route:** `apps/web/app/(workspace)/companies/[companyId]/settings/line-oa/page.tsx`
  → `apps/web/src/features/crm-inbox/LineOaSettingsPage.tsx`
- **Connect API:** `POST /v1/companies/:companyId/crm/channels`
  (`messaging-channel.controller.ts`, perm `crm.channel.manage`), body =
  `{ displayName, lineChannelId, channelSecret, accessToken }`
- **Webhook receiver:** `POST /v1/crm/line/webhook/:webhookKey`
  (`crm-line-webhook.controller.ts`, `@HttpCode(200)`)
- **Webhook URL builder:** `crm-inbox.mapper.ts` = `PUBLIC_BASE_URL` +
  `CRM_LINE_WEBHOOK_PATH_PREFIX('/v1/crm/line/webhook/')` + `webhookKey`.
  Prod `PUBLIC_BASE_URL=https://mangmeeplus.com` (deploy.sh api-web container).
- **Prod routing:** ALB → container:3000 = `infra/prod-app-runner/web-api-proxy.mjs`.
  Proxy route `/v1/*` **ตรงเข้า API :3001** (ไม่ผ่าน Next rewrite ซึ่งจับแค่ `/api/*`).
  จึงทำให้ URL `https://mangmeeplus.com/v1/crm/line/webhook/<key>` ใช้ได้บน prod.
  Body ส่งผ่านแบบ stream (`req.pipe`) → rawBody ถึง API ครบสำหรับ HMAC.
- **rawBody:** `main.ts` สร้าง Nest ด้วย `bodyParser:false` + `json({ verify: saveRawBody })`
  → `req.rawBody` ถูก populate → signature verify ใช้ได้
- **Signature:** `line-webhook-verifier.ts` HMAC-SHA256 base64 + `timingSafeEqual`

---

## Links

- แผน lane: [[plans/mvp-1-two-dev-parallel-plan]] (B1, B2)
- Sequence: [[plans/mvp-1-crm-line-bill-capture-sequence]] (MVP1-0, MVP1-2)
- Spec: [[specs/crm-line-oa-customer-os-spec]] §27 (autonomy ladder, caps, reply-token)
- AI agent memory: [[agent-memory/crm-customer-ai-agent-family]]
