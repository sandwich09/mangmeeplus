# 02e — ข้อกำหนดซอฟต์แวร์ (SRS): LINE และ AI

**จุดประสงค์** เอกสารนี้เป็นข้อกำหนดซอฟต์แวร์ของพื้นผิว LINE และ AI ทั้งหมดของ MangmeePlus / WatchDog-BMS ที่ขายในแพ็กถึง `ENTERPRISE_1999` ครอบคลุมฝั่ง ERP (`apps/api/src/modules/line-ai` และตัวรับ webhook ใน `apps/api/src/modules/auth/presentation`) แอป `apps/ai-gateway` ทั้งตัว (AgentCore runtime, orchestrator, agents, tools, prompts, การเลือกโมเดล, prompt caching, การวัดการใช้และงบ AI) โมดูล `ai-draft` และ `crm-customer-ai` ใน gateway หน้าเว็บตั้งค่า LINE, เพดานค่า AI, ลิงก์เดโม่และแชทจำลอง รวมถึงชุดทดสอบและ evaluation harness ใต้ `scripts/` เขียนขึ้นเพื่อให้ทีมในอนาคตเข้าใจ สร้างใหม่ และดูแลระบบได้จากเอกสารนี้ร่วมกับโค้ดที่เก็บถาวร

**ที่มา** commit `08850deaf` (2026-11-10) บน `origin/main` อ่านจาก checkout `closeout-docs-main` เท่านั้น โค้ดคือความจริง เอกสารใน `docs/` ใช้ประกอบเจตนาและประวัติ

**ข้อจำกัดของการตรวจ** ไฟล์ `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` ยาว 15,534 บรรทัด ผู้เขียนอ่านโครงเมธอด ค่าคงที่ข้อความตอบ และคอมเมนต์กำกับลำดับการทำงานของ `executeText` และ `executeReceiptUploadInner` ไม่ได้อ่านทุกบรรทัด จุดที่ไม่ได้ยืนยันถึงระดับบรรทัดจะเขียนกำกับว่า "ไม่ได้ตรวจละเอียด" และรวมไว้ในหัวข้อ 16

## สารบัญ

1. [ข้อตกลงในเอกสารนี้](#1-ข้อตกลงในเอกสารนี้)
2. [ภาพรวมสถาปัตยกรรม](#2-ภาพรวมสถาปัตยกรรม)
3. [กลุ่ม A — การรับส่งข้อความ LINE](#3-กลุ่ม-a--การรับส่งข้อความ-line)
4. [กลุ่ม B — ตัวตน การผูกบัญชี และการเปิดร้าน](#4-กลุ่ม-b--ตัวตน-การผูกบัญชี-และการเปิดร้าน)
5. [กลุ่ม C — เมนูและคำสั่งที่ตอบด้วยโค้ด](#5-กลุ่ม-c--เมนูและคำสั่งที่ตอบด้วยโค้ด)
6. [กลุ่ม D — แพ็กเกจและการติดต่อเจ้าหน้าที่ผ่าน LINE](#6-กลุ่ม-d--แพ็กเกจและการติดต่อเจ้าหน้าที่ผ่าน-line)
7. [กลุ่ม E — รูป ไฟล์ และเอกสาร](#7-กลุ่ม-e--รูป-ไฟล์-และเอกสาร)
8. [กลุ่ม F — งานที่สั่งทำผ่านแชต (workflow)](#8-กลุ่ม-f--งานที่สั่งทำผ่านแชต-workflow)
9. [กลุ่ม G — AI Gateway](#9-กลุ่ม-g--ai-gateway)
10. [กลุ่ม H — การวัดการใช้ งบ AI และเครดิตแชต](#10-กลุ่ม-h--การวัดการใช้-งบ-ai-และเครดิตแชต)
11. [กลุ่ม I — ลิงก์เดโม่และแชทจำลอง](#11-กลุ่ม-i--ลิงก์เดโม่และแชทจำลอง)
12. [แผนที่ข้อความตอบ (message map)](#12-แผนที่ข้อความตอบ-message-map)
13. [ข้อกำหนดที่ไม่ใช่หน้าที่ (NFR)](#13-ข้อกำหนดที่ไม่ใช่หน้าที่-nfr)
14. [บันทึกการทดสอบ: evaluation harness และ corpus](#14-บันทึกการทดสอบ-evaluation-harness-และ-corpus)
15. [ข้อมูลอ้างอิง: Prisma models, ค่าตั้ง, endpoint ภายใน](#15-ข้อมูลอ้างอิง-prisma-models-ค่าตั้ง-endpoint-ภายใน)
16. [สิ่งที่ยืนยันไม่ได้ และสิ่งที่อยู่ใน docs แต่ไม่พบในโค้ด](#16-สิ่งที่ยืนยันไม่ได้-และสิ่งที่อยู่ใน-docs-แต่ไม่พบในโค้ด)
17. [นอกขอบเขตแพ็ก 1,999 (มีโค้ดแต่ไม่ได้ขาย)](#17-นอกขอบเขตแพ็ก-1999-มีโค้ดแต่ไม่ได้ขาย)

---

## 1. ข้อตกลงในเอกสารนี้

### 1.1 รหัสข้อกำหนด

- ข้อกำหนดหน้าที่ใช้ `FR-LINE-<nnn>` เลขเว้นช่วงตามกลุ่ม (A = 001–009, B = 010–019, C = 020–039, D = 040–049, E = 050–059, F = 060–079, G = 080–109, H = 110–119, I = 120–129)
- ข้อกำหนดที่ไม่ใช่หน้าที่ใช้ `NFR-5<nn>` (ช่วง 501–520) เพื่อไม่ชนกับเอกสาร SRS ฉบับอื่นในชุดเดียวกัน

### 1.2 รหัสย่อของแพ็ก

แพ็กมาจาก `packages/contracts/src/menu-entitlements.ts` (`TIER_FEATURE_PRESETS`, บรรทัด 496–501) และ `packages/contracts/src/plan-term.ts` (`PLAN_TIER_PRESETS`)

| รหัสย่อ | ความหมาย | ที่มาในโค้ด |
|---|---|---|
| **P-ALL** | ทุกแพ็กแบบชำระเงิน: `STARTER_249`, `BASIC_499`, `PRO_999`, `ENTERPRISE_1999` | ทั้งสี่ใช้ `FEATURE_PACKAGE_PRESETS.starter.featureKeys` ซึ่งมี `ai_line_assistant`, `expenses*`, `reimbursement`, `employee_access*`, `company_settings*`, `dashboard_notifications` |
| **P-ENT** | เฉพาะ `ENTERPRISE_1999` | preset นี้เพิ่ม `wht_pnd53` และ `wht_50bis` |
| **P-PUBLIC** | ไม่ผูกกับแพ็ก ใช้ได้แม้ยังไม่มีบัญชีหรือร้านถูกล็อก | คำสั่งที่ตอบก่อนด่านตัวตนใน `executeText` |
| **P-FREE** | ร้านที่เปิดสำเร็จและยังไม่เคยซื้อแพ็ก ได้สิทธิ์อ่านเอกสารรายจ่าย 3 ใบต่อเดือน ไม่รวมการถามตอบกับ AI | `FREE_EXPENSE_MONTHLY_LIMIT = 3` ใน `apps/api/src/modules/line-ai/application/free-expense-quota.ts:9` |

`FREE_TRIAL_15` (ทดลองใช้ฟรีแบบเดิม 15 ใบ) ไม่อยู่ใน `TIER_FEATURE_PRESETS` ชุด feature ที่ร้านทดลองเดิมได้รับไม่ได้ตรวจยืนยันในเอกสารนี้ ข้อความนโยบายในโค้ดระบุเพียงว่า "ร้านที่มีสิทธิ์ทดลองเดิมยังใช้ตามสิทธิ์เดิมจนหมดช่วง" (`line-public-policy.logic.ts`)

เครื่องมืออ่านข้อมูล (read tools) ที่ผูกกับโมดูลนอก preset `starter` เช่น CRM, คลังสินค้า, เอกสารขาย, บัญชีแยกประเภท, ภาษีเต็มชุด, จัดซื้อ, ธนาคาร, workflow automation มีโค้ดครบแต่ไม่มีแพ็กใดเปิดให้ ดูหัวข้อ 17

### 1.3 เงื่อนไขก่อนทำที่ใช้ซ้ำ

| รหัส | เงื่อนไข | หลักฐาน |
|---|---|---|
| **PRE-SIG** | webhook ผ่านการตรวจลายเซ็น และ event ถูกรับเข้า buffer แล้ว | `line-webhook.controller.ts`, `line-message-buffer.service.ts` |
| **PRE-ID** | LINE user ผูกกับ `ExternalIdentity` สถานะ `ACTIVE` ของ channel นี้ และ `User.status = ACTIVE` | `resolveLineIdentity` (`process-line-webhook.use-case.ts:7827`) |
| **PRE-CO** | resolve บริษัทได้หนึ่งบริษัทจาก membership และ `LineCompanyContext` (ไม่ใช้ channel binding เลือกบริษัท) และบริษัทไม่ถูกล็อก | ขั้นที่ 4–5 ของ `executeText` |
| **PRE-LEGAL** | ผู้ใช้ยอมรับเอกสารกฎหมายรุ่นปัจจุบันแล้ว | `refusePendingLegalAcceptance` (`:2570`) |
| **PRE-OPTIN** | ผู้ใช้ไม่ได้ปิดผู้ช่วย AI (`User.aiAssistantOptOutAt` ว่าง) | ด่าน PDPA ใน `executeText` |
| **PRE-AI** | บริษัทมี feature `ai_line_assistant`, launch route ของ `ai_line_assistant` เปิด, ผู้ใช้มี permission `ai.tool.invoke`, ไม่อยู่ในช่วงพัก AI 24 ชั่วโมง, มีเครดิต AI พอ | `lineAssistantDisabledFor`, `refuseWhenLaunchRouteClosed` (`:2445`), `assistantPaused` (`:3129`), `LineAiBudgetAuthorityService` |
| **PRE-BOUND** | ครบ PRE-SIG + PRE-ID + PRE-CO + PRE-LEGAL + PRE-OPTIN | — |

### 1.4 รูปแบบของแต่ละข้อกำหนด

ทุกข้อมีหัวข้อย่อยตาม `_BRIEF.md`: คำอธิบาย, ผู้ใช้/permission, แพ็ก, เงื่อนไขก่อนทำ, ขั้นตอนหลัก, กฎธุรกิจและข้อยกเว้น, การตรวจข้อมูล/ข้อผิดพลาด, ข้อมูล (Prisma models), API, หน้าจอ, การทดสอบ ช่องที่ไม่มีข้อมูลเขียน "—" พาธไฟล์เป็นแบบ repo-relative โดยย่อ `apps/api/src/modules/line-ai/` เป็น `line-ai/` และ `apps/ai-gateway/src/modules/line-ai/` เป็น `gw/line-ai/` เมื่อบริบทชัด

---

## 2. ภาพรวมสถาปัตยกรรม

### 2.1 ช่องทางและผู้เล่น

| ส่วน | บทบาท | ไฟล์หลัก |
|---|---|---|
| LINE OA หลัก (OA ระบบของมั่งมีพลัส ใช้ร่วมทุกร้าน) | ผู้ใช้ทุกร้านคุยกับ "น้องมั่งมี" ใน OA เดียว ระบบเลือกร้านจาก membership ของผู้ใช้ | `apps/api/src/modules/auth/presentation/line-webhook.controller.ts` |
| LINE Official OA (ช่องทางสื่อสารการตลาด) | ตอบคำสำคัญ 2 กลุ่มด้วย Flex สำเร็จรูป ไม่มีสถานะ ERP หรือ AI | `apps/api/src/modules/auth/presentation/line-official-webhook.controller.ts` |
| LINE OA ของร้านเอง (feature `line_oa` + CRM inbox) | มีโค้ด (`crm/line/webhook/:webhookKey`) แต่ไม่อยู่ใน preset ของแพ็กใด | ดูหัวข้อ 17 |
| ERP core (`apps/api`) | เจ้าของตัวตน สิทธิ์ ข้อมูล การเขียนทุกอย่าง งบ AI และข้อความที่ส่งออก | `apps/api/src/modules/line-ai/**` |
| AI Gateway (`apps/ai-gateway`) | ขอบเขตของโมเดล ไม่มีฐานข้อมูล เรียกข้อมูลผ่าน API ภายในของ ERP ที่ตรวจสิทธิ์ซ้ำทุกครั้ง | `apps/ai-gateway/src/**` |
| AgentCore runtime | artifact แยก deploy (`dist/agentcore/runtime.js`, Node 22, HTTP) รัน orchestrator เดียวกัน gateway เรียกด้วย SigV4 | `apps/ai-gateway/agentcore.json`, `apps/ai-gateway/src/agentcore/runtime.ts` |
| Workers (`apps/workers`) | ยิง endpoint drain ภายในตามรอบ (ledger reclaim, capture result, ai-draft) | `apps/workers/src/modules/line-ai-ledger/line-ai-ledger-worker.ts` |

### 2.2 เส้นทางของหนึ่งข้อความ

1. LINE ส่ง `POST /v1/line/webhook` ตัวรับตรวจ `x-line-signature` ด้วย HMAC-SHA256 ของ raw body (FR-LINE-001)
2. `buildLineBufferEnvelope` แปลง event เป็น envelope ชนิด text / media / synthetic command และแยก control ของ postback (FR-LINE-002)
3. `LineMessageBufferService.enqueue` ทำ dedup และเขียนแถว `LineWebhookEventLog` สถานะ `received` ก่อนตอบ 200 แล้ว debounce รวมหลายฟองเป็นหนึ่ง utterance (FR-LINE-003)
4. worker ต่อแชตเรียก `ProcessLineWebhookUseCase.execute` → `executeText` หรือ `executeReceiptUpload`
5. `executeText` ไล่ด่านตามลำดับ: claim event → คำสั่งสาธารณะ → ตัวตน → พัก AI → opt-out → เลือกบริษัท → สิทธิ์ → กฎหมาย → คำสั่งที่ตอบด้วยโค้ด → ด่าน AI → ตัวจำแนกงาน (workflow classifier) → intake router → ช่องเฉพาะทาง (capture, เบิก, แก้ร่าง ฯลฯ) → AI turn
6. AI turn: API ออก budget grant และ actor delegation แล้วเรียก gateway `POST /internal/ai/line-turn` gateway เรียก AgentCore หรือ orchestrator ในตัว orchestrator เรียก read tool กลับมาที่ `POST /v1/internal/ai/tools/invoke` ของ API
7. API บันทึก turn และ audit ก่อนส่ง จากนั้นสร้าง delivery plan แล้วส่งด้วย reply token หรือ push (FR-LINE-006, FR-LINE-007)
8. งานค้างส่งหรือ turn ที่ล่มกลางทางถูกเก็บใน ledger (Redis Streams) ให้ worker reclaim ภายหลัง (FR-LINE-008)

### 2.3 หลักการออกแบบที่โค้ดบังคับใช้

- โมเดลไม่เคยเขียนข้อมูลธุรกิจโดยตรง tool ที่โมเดลเรียกได้ทำได้อย่างมากคือ "เตรียมการ์ดให้คนกดยืนยัน" การเขียนจริงเกิดเมื่อผู้ใช้กดปุ่ม postback ที่มีลายเซ็นของเซิร์ฟเวอร์ (`packages/contracts/src/ai-tools.ts` คอมเมนต์ S-4, `line-expense-action.service.ts:233`)
- gateway ไม่ใช่ด่านสิทธิ์ API resolve สิทธิ์ใหม่จากฐานข้อมูลทุกครั้งที่ tool ถูกเรียก ค่า permission/branch/role ที่ผู้เรียกส่งมาถูกทิ้ง (`internal-tools.controller.ts` SEC-02/SEC-03)
- ตัวเลขในคำตอบต้องมาจากผลของ tool ผู้เรียบเรียงคำตอบถูกตรวจ grounding ถ้าหลุดจะถอยไปใช้ข้อความที่โค้ดประกอบ (`response-composer.agent.ts`, `semantic-turn-v2.ts`)
- ข้อความของผู้ใช้ บริบทสนทนา และผลของ tool ถูกประกาศใน prompt ว่าเป็น DATA ไม่ใช่คำสั่ง (prompt ของ router, tool loop, classifier)
- การเรียกโมเดลที่ล้มเหลวไม่ถูกคิดเงินกับร้าน บริษัทรับต้นทุนเอง (FR-LINE-114)

---

## 3. กลุ่ม A — การรับส่งข้อความ LINE

### FR-LINE-001 รับ webhook ของ OA หลักและตรวจลายเซ็น

- **คำอธิบาย** รับ event จาก LINE Messaging API ของ OA หลัก ตรวจลายเซ็น แล้วส่งต่อเข้า buffer ตอบ 200 ทันทีโดยไม่รอ AI
- **ผู้ใช้/permission** ระบบ LINE เป็นผู้เรียก route เป็น `@Public()` ลายเซ็นคือหลักฐานเดียว
- **แพ็ก** P-PUBLIC
- **เงื่อนไขก่อนทำ** มี channel secret จากฐานข้อมูล (`PlatformLineCredential` ที่ publish แล้ว) หรือจาก environment
- **ขั้นตอนหลัก** (1) อ่าน header `x-line-signature` (2) โหลด credential ด้วย `LineMessagingCredentialsService.get(undefined, 'INBOUND')` (3) คำนวณ HMAC-SHA256(raw body, channel secret) เป็น base64 เทียบด้วย `timingSafeEqual` (4) เรียก `observeSignature` เพื่อ stamp `inboundVerifiedAt` ครั้งแรกของ credential รุ่นนั้น (5) วน event สร้าง envelope แล้ว `enqueue` (6) ตอบ `{}`
- **กฎธุรกิจและข้อยกเว้น** ถ้า enqueue ล้มเหลวให้ throw เพื่อให้ LINE ส่งซ้ำ ไม่ตอบ 200 ให้ event ที่ยังไม่เข้า buffer มีพาธเก่า `POST /v1/webhooks/line` ใช้ตรรกะเดียวกัน
- **การตรวจข้อมูล/ข้อผิดพลาด** ไม่มี header, ไม่มี secret, ไม่มี raw body, หรือลายเซ็นไม่ตรง → 401 กรณีลายเซ็นไม่ตรงออก security event `lineWebhookSignatureInvalid` ระดับ HIGH credential อ่านไม่ได้ → 503 `LINE_CREDENTIAL_UNAVAILABLE`
- **ข้อมูล** `PlatformLineCredential`, `LineWebhookEventLog`
- **API** `POST /v1/line/webhook`, `POST /v1/webhooks/line`
- **หน้าจอ** —
- **การทดสอบ** `apps/api/src/modules/auth/line-webhook.controller.spec.ts`, `apps/api/src/common/config/line-messaging-credentials.fixture.ts`, `apps/api/src/modules/line-ai/line-webhook-local-smoke.ts`

### FR-LINE-002 แปลง event เป็น envelope และแยก control ของ postback

- **คำอธิบาย** จุดเดียวที่ตีความ event ของ LINE และ postback data ใช้ร่วมกับแชทจำลองของเดโม่
- **ผู้ใช้/permission** ระบบ
- **แพ็ก** P-PUBLIC
- **เงื่อนไขก่อนทำ** event มี `replyToken` และ `source.userId`
- **ขั้นตอนหลัก** `buildLineBufferEnvelope` (`line-ai/application/line-buffer-envelope.ts`) คืน `chatId = groupId ?? roomId ?? userId`, `channelKind` (`USER`/`GROUP`/`ROOM`) และ item หนึ่งชนิด:
  - `text` จากข้อความพิมพ์ (เก็บ `quotedMessageId` เมื่อตรงรูปแบบ `[A-Za-z0-9_-]{1,200}`)
  - `media` จาก `image` หรือ `file` (เก็บ `lineMessageId`, `fileName`, `fileSize`)
  - synthetic text จาก postback หรือ `follow` โดยแนบ control ที่ parse แล้ว
- **กฎธุรกิจและข้อยกเว้น** control ที่รู้จักและข้อความ synthetic ที่ใช้แทน:

| control (postback `action=`) | parser | ข้อความ synthetic |
|---|---|---|
| `wf_open`, `wf_choice` | `parseLineWorkflowControl` | `เลือกงานจากการ์ด` |
| `chat-action&id=<workflow id>` (ต้องมี 2 คีย์พอดี) | `LINE_WORKFLOW_IDS` | คำสั่งของ action นั้น หรือ `เริ่มงานจากเมนู` |
| `fixed-read&id=expense_month` | `parseLineFixedReadControl` | `ดูค่าใช้จ่ายเดือนนี้` |
| `reimbursement_choice` | `parseLineReimbursementChoiceControl` | `ส่งรูปใบเสร็จสำหรับใบเบิกนี้` / `ไม่มีใบเสร็จ ขอเบิกรายการใหม่นี้` / `เลือกหมวดค่าใช้จ่ายสำหรับใบเบิกนี้` |
| `counterparty_confirm/cancel` | `parseCounterpartyControl` | `ตรวจข้อมูลคู่ค้า` |
| `package_purchase_confirm/cancel` | `parsePackagePurchaseControl` | `ตรวจลิงก์จ่ายแพ็กเกจ` |
| `expense_action_*` | `parseExpenseActionControl` | `ตรวจผลรายการค่าใช้จ่าย` |
| draft ใบเบิก | `parseLineReimbursementDraftControl` | `ตรวจผลร่างใบเบิก` |
| ส่งคำตอบยาวต่อ/ยกเลิก | `parseLineAnswerDeliveryControl` | `อ่านคำตอบต่อ` / `ยกเลิกการส่งคำตอบ` |
| `draft-update-confirm/cancel&previewId=<uuid>` | `lineDraftUpdatePostbackPreviewId` | `ยืนยันการแก้ไข` / `ยกเลิกการแก้ไข` |
| เมนูทั่วไป (`staff-contact`, `view-packages`, `employee-door`, `query-menu`, `approvals`, `line-rich-talk`, `package-change`, `package-callback`, `profile-guard`, `profile-guard-later`, `company-select`, `company-page`) | `linePostbackCommandText` | คำสั่งภาษาไทยของปุ่มนั้น |
| event `follow` | — | `เพิ่มเพื่อนใหม่` (`LINE_FOLLOW_EVENT_TEXT`) |

- **การตรวจข้อมูล/ข้อผิดพลาด** postback ที่มี `action` เป็น `wf_open`/`wf_choice`/`fixed-read`/`chat-action` แต่รูปแบบไม่ผ่าน parser ถูกทิ้ง (คืน `null`) ไม่เดา postback ที่ไม่รู้จักถูกทิ้ง postback เมนูทั่วไปไม่พกรหัสบริษัทหรือสถานะธุรกิจ (คอมเมนต์ P10-L G-04 / SEC-04) รหัสภาษา (`th`/`en`) ของปุ่มถูกถอดด้วย `lineControlLanguage`
- **ข้อมูล** —
- **API** —
- **หน้าจอ** —
- **การทดสอบ** `line-ai/domain/logic/line-staff-menu.logic.spec.ts`, `line-ai/application/line-message-buffer.service.spec.ts`

### FR-LINE-003 Message buffer: รวมหลายฟอง กันซ้ำ และกู้ event ค้าง

- **คำอธิบาย** ผู้ใช้ LINE มักพิมพ์หลายฟองต่อเนื่อง ระบบรวมเป็นหนึ่งคำขอก่อนเรียก AI และรับประกันว่า event ที่รับแล้วไม่หาย
- **ผู้ใช้/permission** ระบบ
- **แพ็ก** P-PUBLIC
- **เงื่อนไขก่อนทำ** PRE-SIG
- **ขั้นตอนหลัก** (1) `enqueue` กันซ้ำด้วย `webhookEventId` และเขียน `LineWebhookEventLog` (`received`) ก่อน ack (2) เรียก `preflightLegalAcceptance` แบบอ่านอย่างเดียวเพื่อรู้บริษัทและสถานะพัก AI ก่อนเก็บ payload กู้คืน (3) debounce ต่อแชต แล้ว flush เป็น batch (4) `segmentBatch` แยกเป็นกลุ่ม: command แยกเป็นกลุ่มของตัวเองเสมอ, กลุ่ม media กินข้อความในกลุ่มเป็น caption, ที่เหลือเป็นกลุ่ม text (5) worker ประมวลทีละกลุ่มตามลำดับ media ที่ไม่มี caption เดินคิวของตัวเองไม่บล็อกข้อความ
- **กฎธุรกิจและข้อยกเว้น**
  - ค่าตั้ง: `LINE_AI_BUFFER_DEBOUNCE_MS` ค่าเริ่มต้น 2000, `LINE_AI_BUFFER_MAX_WAIT_MS` 8000 (`packages/config/src/index.ts:272–273`)
  - เพดานต่อ buffer: `LINE_BUFFER_MAX_ITEMS = 20`, `LINE_BUFFER_MAX_TEXT_CHARS = 4000`
  - แถว `received` ที่เก่ากว่า `LINE_BUFFER_ORPHAN_REPROCESS_MS` (2 นาที) ถือเป็น orphan ประมวลซ้ำได้
  - shutdown drain จำกัด 25 วินาที (`LINE_BUFFER_SHUTDOWN_DRAIN_TIMEOUT_MS`)
  - การทดลอง debounce cohort (1000/1500/2000 ms) เลือกด้วย HMAC ของ (company, chat) ปิดเป็นค่าเริ่มต้น (`LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED=false`)
  - buffer อยู่ใน memory ของ process instance อื่นมองไม่เห็น (`held` set) การกู้ข้าม instance อาศัย orphan sweep
- **การตรวจข้อมูล/ข้อผิดพลาด** buffer ล้น → ตอบ `⏳ ระบบกำลังประมวลผลข้อความก่อนหน้า กรุณารอสักครู่แล้วส่งอีกครั้ง…` หนึ่งครั้งต่อช่วงแออัด dispatch ล้ม → `⏳ ขออภัยค่ะ ระบบตอบกลับไม่ได้ชั่วคราว กรุณาลองส่งข้อความอีกครั้ง…`
- **ข้อมูล** `LineWebhookEventLog`, `LineIntakeAttempt`, `LineIntakeState`
- **API** `POST /v1/internal/ai/line-ledger/sweep-orphan-events` (กู้ orphan)
- **หน้าจอ** —
- **การทดสอบ** `line-ai/domain/logic/line-message-buffer.logic.spec.ts`, `line-ai/application/line-message-buffer.service.spec.ts`, `line-ai/application/line-input-buffer.pg.spec.ts`, `line-ai/application/use-cases/recover-orphan-line-events.use-case.spec.ts`

### FR-LINE-004 Official OA: ตอบคำสำคัญด้วยการ์ดสำเร็จรูป

- **คำอธิบาย** OA ทางการ (ช่องสื่อสารของแบรนด์) ตอบข้อความตรงตัว 2 กลุ่ม ไม่ใช้ AI ไม่อ่านข้อมูลร้าน
- **ผู้ใช้/permission** ผู้ติดตาม OA ทางการ ไม่ต้องมีบัญชี
- **แพ็ก** P-PUBLIC
- **เงื่อนไขก่อนทำ** `LINE_OFFICIAL_REPLY_ENABLED=true` (ค่าเริ่มต้น `false`) และตั้ง `LINE_OFFICIAL_CHANNEL_SECRET`, `LINE_OFFICIAL_CHANNEL_ACCESS_TOKEN`
- **ขั้นตอนหลัก** (1) ตรวจลายเซ็นแบบเดียวกับ FR-LINE-001 ด้วย secret ของ OA ทางการ (2) รับเฉพาะ event `message` ชนิด `text` จาก `source.type = user` ที่มี `replyToken` (3) `officialOaReplyForText` จับคู่ข้อความ (trim, lowercase, เทียบทั้งสตริง) (4) ส่ง reply ไป `https://api.line.me/v2/bot/message/reply` timeout 5 วินาที
- **กฎธุรกิจและข้อยกเว้น** คำสำคัญ: `ติดต่อมั่งมีทีม`, `ติดต่อเรา`, `contact us` → การ์ดติดต่อ (`line-official-contact-card.json`); `social media`, `โซเชียล`, `ติดตามน้องมั่งมี` → การ์ดโซเชียล (`line-official-social-card.json`, ไอคอนชี้ไป `webBaseUrl`) ข้อความอื่นไม่ตอบ reply token ใช้ครั้งเดียวจึงเป็น idempotency ของการส่ง
- **การตรวจข้อมูล/ข้อผิดพลาด** ปิดสวิตช์ → 404 ลายเซ็นผิด → 401 พร้อม security event (`channel: official`) LINE ตอบ 400 `invalid reply token` ถือว่าส่งแล้ว ความล้มเหลวอื่น → 502 เพื่อให้ LINE ส่งซ้ำ
- **ข้อมูล** —
- **API** `POST /v1/line/official/webhook`
- **หน้าจอ** —
- **การทดสอบ** `apps/api/src/modules/auth/line-official-webhook.controller.spec.ts`

### FR-LINE-005 กุญแจ LINE Messaging ที่ใช้ร่วมกัน: อ่านสถานะและเปลี่ยนกุญแจ

- **คำอธิบาย** ผู้ดูแลระบบดูสถานะการเชื่อมต่อของ OA หลักและเปลี่ยน channel secret / access token รุ่นใหม่โดยไม่ต้อง deploy
- **ผู้ใช้/permission** ผู้ดูแลแพลตฟอร์ม permission `system.shared_line_credential.manage`
- **แพ็ก** ไม่ใช่ของร้าน (พื้นผิวผู้ดูแลระบบ)
- **เงื่อนไขก่อนทำ** session ปัจจุบันใช้ password credential ที่ `ACTIVE` ไม่ถูกบังคับเปลี่ยนรหัสและไม่หมดอายุ
- **ขั้นตอนหลัก** (1) `GET` อ่านสถานะ รุ่น และผลตรวจ (2) ผู้ดูแลกรอก channel id, secret, token, เหตุผล (5–500 ตัวอักษร), รหัสผ่านปัจจุบัน และติ๊กรับทราบ (3) `PUT` ตรวจ optimistic version (`expectedVersion`), ยืนยันรหัสผ่าน, เรียก `https://api.line.me/v2/oauth/verify` ตรวจว่า token เป็นของ channel เดียวกันและยังไม่หมดอายุ (4) เข้ารหัสด้วย `credentialEncryptionKey` บันทึก `PlatformLineCredential` รุ่นใหม่พร้อม audit
- **กฎธุรกิจและข้อยกเว้น** เปลี่ยนได้เฉพาะ `LINE_MESSAGING_API` ของ channel เดิม (`channelId` ต้องตรงกับ `LINE_MESSAGING_CHANNEL_ID`) การย้าย OA ไป channel อื่นถูกปฏิเสธ `LINE_CHANNEL_MIGRATION_REQUIRED` credential จากฐานข้อมูลใช้เมื่อ `runtimePublishedAt` ไม่ว่าง มิฉะนั้นใช้ค่า environment (`resolveLineMessagingCredential`) secret ที่ถอดรหัสแล้วไม่ cache ข้าม request หน้าเว็บบอกชัดว่าหน้านี้ไม่ครอบคลุม LINE Login และ LIFF
- **การตรวจข้อมูล/ข้อผิดพลาด** `LINE_CREDENTIAL_KIND_UNSUPPORTED` (400), `LINE_CREDENTIAL_RATE_LIMIT` (10 ครั้ง/300 วินาทีต่อผู้ใช้), `LINE_REAUTH_FAILED` (403), `LINE_CREDENTIAL_CHANGED` (409), `LINE_TOKEN_REJECTED` (400), `LINE_TOKEN_CHECK_UNAVAILABLE` (503)
- **ข้อมูล** `PlatformLineCredential`, `AuditLog`
- **API** `GET /v1/system/line/shared-credentials`, `PUT /v1/system/line/shared-credentials/:credentialKind`
- **หน้าจอ** `/system/line-settings` (`apps/web/src/features/system-partners/SharedLineSettingsPage.tsx`)
- **การทดสอบ** `apps/api/src/modules/system-partner-management/application/use-cases/set-shared-line-credential.use-case.spec.ts`, `apps/api/src/scripts/line-runtime-credentials-smoke.ts`

### FR-LINE-006 ส่งข้อความกลับ: reply, push, loading และบันไดข้อความรอ

- **คำอธิบาย** ส่งคำตอบกลับแชตต้นทาง แสดงสถานะกำลังทำงานระหว่างรอ และไม่ปล่อยให้ผู้ใช้เจอความเงียบ
- **ผู้ใช้/permission** ระบบ
- **แพ็ก** P-PUBLIC
- **เงื่อนไขก่อนทำ** มี access token ที่ยังไม่หมดอายุ
- **ขั้นตอนหลัก** `LineReplyAdapter` (`line-ai/infrastructure/line-reply.adapter.ts`) ส่ง reply ด้วย reply token ก่อน ถ้าใช้ไม่ได้จึง push ไป `chatId` เรียก `POST https://api.line.me/v2/bot/chat/loading/start` ด้วย `loadingSeconds: 60` สำหรับแชต 1:1
- **กฎธุรกิจและข้อยกเว้น** บันไดข้อความรอ (`lineWaitStages`, `line-message-buffer.logic.ts:210`):

| สถานการณ์ | เวลา (นับจากฟองสุดท้ายถูกรับ) | สิ่งที่ผู้ใช้เห็น |
|---|---|---|
| ข้อความ, loading เปิด (`LINE_AI_LOADING_ANIMATION_ENABLED=true` ค่าเริ่มต้น) | 0–55 วินาที | เฉพาะ loading ของ LINE ไม่มีฟองเพิ่ม |
| ข้อความ, loading ปิด | 5 วินาที (`LINE_WAIT_STATUS_DELAY_MS`) | ข้อความรอตามหัวข้อ เช่น `กำลังคำนวณตัวเลขให้นะคะ 🧮` เลือกจาก `LINE_WAIT_STATUS_RULES` 7 กลุ่มด้วย hash คงที่ของ turn |
| ข้อความที่ช้าจริง | 55 วินาที (`LINE_WAIT_STATUS_SLOW_DELAY_MS`) | `น้องมั่งมียังหาคำตอบอยู่นะคะ คำถามนี้ใช้เวลานานกว่าปกติ ขออีกสักครู่ค่ะ 🙏` แล้ว restart loading (หน่วง 300 ms และ keepalive 1,300 ms) |
| รูป (กลุ่ม media) | ทันทีเมื่อรับ | การ์ด "กำลังสแกน" ครั้งเดียวต่อกลุ่ม ข้อความ `ได้รับรูปแล้วค่ะ 🧾 กำลังอ่านเอกสารอยู่ เสร็จแล้วน้องจะสรุปให้ทางแชตนี้นะคะ ระหว่างนี้คุยกับน้องต่อได้เลยค่ะ` หลายรูปบอกจำนวนและลำดับ |
| รูปที่อ่านช้า | 55 วินาที | `น้องมั่งมียังอ่านเอกสารอยู่นะคะ รูปนี้ใช้เวลานานกว่าปกติ ขออีกสักครู่ค่ะ 🙏` |
| ไฟล์ (PDF) | ทันทีเมื่อรับ | `ได้รับไฟล์แล้วค่ะ 📄 กำลังอ่านเอกสารอยู่…` ไม่มีข้อความเตือนช้า เพราะผลมาเป็น push แยก |

  ข้อความรอเป็นการ์ดดีไซน์ล็อก (`drawLineSystemCard`) เมื่อมี `webBaseUrl` แบบ https ให้ LINE ดึงรูปได้ มิฉะนั้นส่งเป็นข้อความธรรมดา ไม่มีข้อความใดบอกเวลาที่ระบบไม่รู้จริง (คอมเมนต์ design lock 2026-10-04 §8)
- **การตรวจข้อมูล/ข้อผิดพลาด** ข้อจำกัดของ LINE ที่โค้ดยึด: ไม่เกิน 5 ข้อความต่อ reply, ข้อความละไม่เกิน 5,000 ตัวอักษร, body ของ Flex ไม่เกิน 1,200 ตัวอักษร (`process-line-webhook.use-case.ts:797–801`), bubble ไม่เกิน 30,000 ไบต์, carousel ไม่เกิน 50,000 ไบต์, ป้ายปุ่มไม่เกิน 40, postback data ไม่เกิน 300, URI ไม่เกิน 1,000 (`line-system-card-limits.logic.ts:18–31`)
- **ข้อมูล** `LineWebhookEventLog` (สถานะส่ง), `LineDeliveryPlan`
- **API** —
- **หน้าจอ** —
- **การทดสอบ** `line-ai/infrastructure/line-reply.adapter.spec.ts`, `line-ai/domain/logic/line-message-buffer.logic.spec.ts`, `docs/agent-memory/line-ai-error-wait-ux.md` (ประวัติ)

### FR-LINE-007 Delivery plan v2: แช่แข็งคำตอบก่อนส่ง แบ่งชุด และส่งต่อเมื่อผู้ใช้ขอ

- **คำอธิบาย** คำตอบหนึ่งชุดถูกแปลงเป็นแผนส่งที่แช่แข็งไบต์ไว้ก่อน เพื่อให้การส่งซ้ำ การ drain และการ replay ส่งข้อความเดียวกันทุกครั้ง และไม่ตัดข้อความยาวทิ้ง
- **ผู้ใช้/permission** ระบบ ผู้ใช้กดปุ่ม "อ่านต่อ" หรือ "ยกเลิก" ได้
- **แพ็ก** P-PUBLIC
- **เงื่อนไขก่อนทำ** `LINE_AI_DELIVERY_PLAN_V2_ENABLED=true` (ค่าเริ่มต้น)
- **ขั้นตอนหลัก** `buildLineDeliveryPlan` (`line-ai/domain/logic/line-delivery-plan.logic.ts:162`) รับ item ชนิด `answer`/`source`/`business_result`/`decision_diff`/`limitation` แบ่งข้อความด้วย `splitLineDeliveryText` ที่ 4,800 ตัวอักษรโดยไม่ตัดกลาง URL หรือ grapheme คำนวณ `wireHash` และ `pushRetryKey` ต่อชุด เก็บใน `LineDeliveryPlan` แล้วส่งทีละชุด
- **กฎธุรกิจและข้อยกเว้น** ผู้ผลิตแผนมี 3 ชนิด `WEBHOOK`, `LEDGER`, `CAPTURE_OUTBOX` แต่ละชนิดมี fence ของเจ้าของ (`line-ledger-delivery.service.ts:12`) lease 3 นาที สถานะปลายทาง `ACCEPTED`/`CANCELLED`/`REFUSED`/`EXPIRED` ลิงก์เว็บใน Flex ถูกแปลงให้เปิดนอก in-app browser ก่อนคำนวณ hash (คอมเมนต์ R-B1) ปุ่มที่ติดไปกับข้อความต้องอยู่ใน allowlist `INLINE_REAUTHORIZED_ACTIONS` และตรวจสิทธิ์ใหม่เมื่อกด แชตที่ผูกบัญชีแล้วต้องมี `canonicalText` ของการ์ด ไม่งั้นแผนปฏิเสธการ์ดนั้น
- **การตรวจข้อมูล/ข้อผิดพลาด** `validateLineDeliveryPlan` ตรวจว่าทุก item ประกอบกลับจากชิ้นที่แช่แข็งได้ครบ แผนที่สร้างไม่สำเร็จส่งข้อความล้มเหลวกลาง ๆ ที่ไม่มีข้อมูลธุรกิจ postback `continue`/`cancel` ผ่าน `handleAnswerDeliveryControl` (`:6964`)
- **ข้อมูล** `LineDeliveryPlan`, `LineLedgerDelivery`, `LineTurnOutcome`
- **API** —
- **หน้าจอ** —
- **การทดสอบ** `line-ai/domain/logic/line-delivery-plan.logic.spec.ts`, `line-ai/line-delivery-plan.pg.spec.ts`, `line-ai/line-delivery-access.pg.spec.ts`, `line-ai/line-ledger-delivery.pg.spec.ts`

### FR-LINE-008 Ledger ของ turn, การ reclaim และงาน drain ภายใน

- **คำอธิบาย** turn ที่เริ่มแล้วต้องมีคำตอบเสมอ แม้ process ล่ม ledger เก็บ turn และคำถามที่รอผู้ใช้ตอบ worker กลับมาทำต่อ
- **ผู้ใช้/permission** ระบบ endpoint ภายในป้องกันด้วย header `x-internal-secret`
- **แพ็ก** P-ALL (ผูกกับ `ai_line_assistant`)
- **เงื่อนไขก่อนทำ** `LINE_AI_LEDGER_ENABLED` (ค่าเริ่มต้นในโค้ด `false` ต้องเปิดต่อ environment), Redis พร้อม
- **ขั้นตอนหลัก** (1) ก่อนเรียก gateway API เขียน entry ชนิด `turn` ลง Redis Stream คีย์ `lineai:ledger:<companyId>:<chatKey>` กลุ่ม `lineai-turn` (2) ส่งสำเร็จจึง ack (3) คำถามที่ถามกลับผู้ใช้เก็บเป็น `sub_request` สถานะ `waiting_user` (4) worker เรียก `POST /internal/ai/line-ledger/drain` ทุก `LINE_AI_LEDGER_RECLAIM_INTERVAL_MS` (60 วินาที) เพื่อ reclaim entry ที่ idle เกิน `LINE_AI_LEDGER_CLAIM_MIN_IDLE_MS` (120 วินาที)
- **กฎธุรกิจและข้อยกเว้น** `LINE_AI_LEDGER_MAXLEN=200`, `LINE_AI_LEDGER_TTL_SECONDS=86400`, `LINE_AI_LEDGER_DELIVERY_CAP=3` ครั้ง batch ของ drain ไม่เกิน 50 เมื่อ ledger มี entry ของ turn ก่อนหน้า ผู้ใช้ที่ส่งข้อความซ้อนได้ `⏳ น้องมั่งมีกำลังตอบข้อความก่อนหน้าอยู่ค่ะ ข้อความนี้รับไว้แล้ว เดี๋ยวตามมาตอบให้เองนะคะ ไม่ต้องส่งซ้ำค่ะ` แทนข้อความให้ส่งใหม่ เพื่อไม่ให้ได้คำตอบซ้ำสองครั้ง turn ที่ reclaim แล้วเครดิตหมดได้ข้อความจาก `formatAiBudgetRefusalNotice` การ replay ของ orphan ผ่านเพดานเครดิตได้ (`admitOverCap`, มติเจ้าของ 2026-09-30 "ทุกกรณีที่ระบบรับไว้ก่อน")
- **การตรวจข้อมูล/ข้อผิดพลาด** ledger เป็น fail-open (Redis ล่มไม่บล็อกคำตอบ) คู่ขนานที่ fail-closed คือ `LineIntakeState` ใน Postgres ซึ่งปิดอยู่ (`LINE_AI_INTAKE_STATE_MODE=off`)
- **ข้อมูล** Redis Streams, `LineLedgerDelivery`, `LineIntakeState`, `LineTurnOutcome`, `LineAiTaskRun`
- **API** `POST /v1/internal/ai/line-ledger/drain`, `POST /v1/internal/ai/line-ledger/sweep-orphan-events`, `POST /v1/internal/ai/line-capture-results/drain`, `POST /v1/internal/ai/line-document-qa/drain`
- **หน้าจอ** —
- **การทดสอบ** `line-ai/application/line-ai-ledger.service.spec.ts`, `line-ai/application/use-cases/drain-line-ledger.use-case.spec.ts`, `line-ai/application/line-ledger-accepted-request.pg.spec.ts`, `line-ai/application/use-cases/process-line-task-resume.spec.ts`

---

## 4. กลุ่ม B — ตัวตน การผูกบัญชี และการเปิดร้าน

### FR-LINE-010 ระบุตัวตนจาก LINE และการ์ดประตูสำหรับคนที่ยังไม่มีบัญชี

- **คำอธิบาย** ทุก turn หา `ExternalIdentity` ของ LINE user ใน channel ที่รับ webhook คนที่ไม่มีบัญชีได้การ์ดประตูแทนประโยค "กรุณาเชื่อมบัญชี" ที่ไม่มีทางไปต่อ
- **ผู้ใช้/permission** ทุกคนที่ส่งข้อความเข้า OA หลัก
- **แพ็ก** P-PUBLIC
- **เงื่อนไขก่อนทำ** PRE-SIG
- **ขั้นตอนหลัก** (1) `resolveLineIdentity` ค้น `ExternalIdentity` ด้วย `provider = LINE`, `providerUserId`, `status = ACTIVE` ภายใน channel (2) ไม่พบ → ตรวจว่ามีคำขอเปิดร้านค้างอยู่หรือไม่ (`findOpenLineSignup`, สถานะ `RECEIVED`/`VALIDATED`/`PENDING_REVIEW`/`PROVISIONING`/`PROVISIONING_FAILED`/`READY`) (3) มีคำขอค้าง → การ์ดสถานะ "ได้รับคำขอแล้ว ⏳ กำลังตรวจสอบ" (`buildSignupStatusCard`) (4) ไม่มี → `entryDoorMessages` ส่งคำอธิบายสั้นแล้วตามด้วยการ์ดประตู `buildSignupDoorCard`
- **กฎธุรกิจและข้อยกเว้น** การ์ดประตู (หัวการ์ด "มั่งมีพลัส ✅ บัญชีทางการที่ยืนยันแล้ว" ข้อความ `สวัสดีค่ะ ยินดีต้อนรับสู่มั่งมีพลัส เลือกทางที่ตรงกับคุณได้เลยค่ะ`) มีปุ่ม: `เปิดร้านใหม่` (เปิด `https://liff.line.me/<LIFF_ID>/signup` เมื่อ LIFF id ตรง `LIFF_ID_PATTERN`), `ดูแพ็กเกจและราคา`, `ฉันเป็นพนักงาน`, `มีบัญชีอยู่แล้ว เชื่อม LINE`, `ติดต่อเจ้าหน้าที่` (เปิด OA ทีมงาน `STAFF_OA_URL`) คนที่พิมพ์ข้อความ (ไม่ใช่ follow) ได้ประโยค `น้องมั่งมีจะตอบได้หลังเปิดร้านหรือเชื่อมบัญชีแล้วค่ะ เลือกจากการ์ดด้านล่างได้เลย` นำหน้า (มติเจ้าของ 2026-11-05) คนแปลกหน้าที่ถามว่าระบบทำอะไรได้ได้การ์ดความสามารถ (FR-LINE-028) ไม่ใช่การ์ดประตู
- **การตรวจข้อมูล/ข้อผิดพลาด** ข้อความหรือ postback จากคนที่ไม่ผูกบัญชีบันทึก audit `DENIED` ส่วน event `follow` ไม่บันทึกเป็น DENIED (คอมเมนต์ L-B follow-up (c)) ผู้ที่อยู่ในบทสนทนากับเจ้าหน้าที่อยู่แล้ว ข้อความปกติถูกเก็บเข้าคำขอนั้นแทน (FR-LINE-044)
- **ข้อมูล** `ExternalIdentity`, `CompanySignupRequest`, `LineChannelBinding`
- **API** —
- **หน้าจอ** LIFF `line/link-page` (เชื่อมบัญชีที่มีอยู่), LIFF `line/link-page/signup`
- **การทดสอบ** `line-ai/line-first-signup-webhook.spec.ts`, `line-ai/domain/logic/line-business-card.logic.spec.ts`, `apps/api/src/scripts/line-binding-smoke.ts`

### FR-LINE-011 ต้อนรับเมื่อเพิ่มเพื่อน

- **คำอธิบาย** event `follow` ได้คำตอบเสมอ ไม่ต้องพึ่ง Greeting ของ LINE OA console
- **ผู้ใช้/permission** ผู้ที่เพิ่ม OA เป็นเพื่อน
- **แพ็ก** P-PUBLIC
- **เงื่อนไขก่อนทำ** PRE-SIG
- **ขั้นตอนหลัก** `follow` เดินทางเป็นข้อความ synthetic `เพิ่มเพื่อนใหม่` ซึ่ง `staffMenuCommand` รู้จักเป็นคำสั่ง `follow` จึงถูกตอบแยกจากข้อความถัดไป
- **กฎธุรกิจและข้อยกเว้น** คนใหม่: `สวัสดีค่ะ ขอบคุณที่เพิ่มมั่งมีพลัสเป็นเพื่อนนะคะ\nเลือกเปิดร้านใหม่ หรือเชื่อมบัญชีที่มีอยู่ในการ์ดด้านล่างได้ค่ะ หากเป็นพนักงาน ให้ใช้ลิงก์เชื่อม LINE จากเจ้าของกิจการค่ะ` ตามด้วยการ์ดประตู คนที่มีบัญชีแล้ว: `ยินดีต้อนรับกลับมาค่ะ เลือกเมนูที่ต้องการใช้งานได้เลยค่ะ หากต้องการคุยกับทีมงาน พิมพ์ ติดต่อเจ้าหน้าที่ ได้ค่ะ` ถ้าร้านของเขาถูกล็อกจะได้ข้อความล็อก (FR-LINE-017) แทนคำเชิญให้ส่งใบเสร็จ
- **การตรวจข้อมูล/ข้อผิดพลาด** —
- **ข้อมูล** `ExternalIdentity`, `CompanySignupRequest`
- **API** —
- **หน้าจอ** —
- **การทดสอบ** `line-ai/line-first-signup-webhook.spec.ts`, `apps/api/src/modules/auth/line-webhook.controller.spec.ts`

### FR-LINE-012 เปิดร้านใหม่ผ่าน LIFF (สมัครอัตโนมัติ)

- **คำอธิบาย** คนใหม่กด "เปิดร้านใหม่" ในการ์ด เปิดฟอร์มสมัครใน LINE กรอกข้อมูลร้าน ยอมรับเอกสารกฎหมาย แล้วระบบสร้างคำขอเปิดร้านผูกกับ LINE identity นั้น
- **ผู้ใช้/permission** ผู้ที่มี LINE account; LIFF ID token คือหลักฐานตัวตนเดียว
- **แพ็ก** P-PUBLIC (ผลลัพธ์คือร้านใหม่ที่ยังไม่มีแพ็ก; สิทธิ์ P-FREE เริ่มหลังเปิดร้านสำเร็จ)
- **เงื่อนไขก่อนทำ** `LINE_SIGNUP_ENABLED=true` (ค่าเริ่มต้น `false`), ตั้ง `LINE_LIFF_ID`, web base URL พร้อม (ไม่งั้นหน้าสมัครตอบ 503)
- **ขั้นตอนหลัก** (1) API render หน้า `line/link-page/signup` พร้อมข้อความกฎหมายรุ่นปัจจุบันและ challenge จาก `currentLegalRelease()` (2) หน้าเรียก `liff.init` แล้วส่ง `POST /v1/public/line-signups` พร้อม ID token, client UUID, ชื่อร้าน, เบอร์โทร (10 หลัก), อีเมล (ไม่บังคับ), แหล่งที่รู้จัก และรหัสเซลล์ 6 ตัวอักษรเมื่อเลือก "เซลล์" (3) เซิร์ฟเวอร์ตรวจ token, ตรวจว่าข้อความกฎหมายที่ผู้ใช้เห็นตรงกับรุ่นที่เสิร์ฟ, resolve รหัสเซลล์ (4) สร้าง `CompanySignupRequest` (5) ตามโหมดอนุมัติ: `MANUAL` (ค่าเริ่มต้น) เข้าคิวให้ผู้ดูแลตรวจ, `AUTO_FREE` provision ร้านภายใน submit เดียวกันโดยมีเพดาน `LINE_SIGNUP_AUTO_DAILY_CAP` (20/วัน)
- **กฎธุรกิจและข้อยกเว้น** เวลาทำการที่ใช้ในการ์ดและหน้า: จันทร์–เสาร์ 09:00–18:00 (`LINE_SIGNUP_BUSINESS_DAYS`, `LINE_SIGNUP_BUSINESS_HOURS`) ผู้ดูแลได้รับการเตือนคำขอค้างทุก `LINE_SIGNUP_ADMIN_REMINDER_MINUTES` (60) เจ้าของที่ผูกบัญชีแล้วเปิดร้านที่สองได้จากการ์ด "บริษัทของฉัน" (ปุ่ม `เปิดร้านใหม่` แสดงเฉพาะเจ้าของ พนักงานเห็นคำแนะนำให้พิมพ์ `โปรโมชั่น`) คำขอที่ยังค้างซ่อนปุ่มและแสดง `🕒 คำขอเปิดร้าน… รอทีมงานตรวจสอบ ปกติภายในวันทำการ` replay ของ submit เดิม (client key เดิม) คืนผลเดิมไม่สร้างร้านซ้ำ
- **การตรวจข้อมูล/ข้อผิดพลาด** รหัสที่ use case ตอบ (หน้า LIFF แปลเป็นคำแนะนำภาษาไทย ไม่แสดงรหัสดิบ): `line_signup_submission_conflict`, `legal_release_changed`, `line_signup_already_pending`, `line_signup_identity_disabled`, `line_signup_account_blocked`, `line_signup_version_conflict`, `line_signup_contact_update_not_allowed`, `line_signup_legacy_evidence_required`, `line_signup_retry_not_available`, `company_signup_request_not_found`
- **ข้อมูล** `CompanySignupRequest`, `ExternalIdentity`, `Company`, `CompanyMembership`, เอกสารการยอมรับกฎหมาย
- **API** `GET /v1/auth/line/link-page/signup` (alias `line/signup-page`), `GET /v1/auth/line/link-page.js`, `POST /v1/public/line-signups`, `POST /v1/public/line-signups/support`, `POST /v1/public/line-signups/:requestId/retry`, `GET /v1/public/line-signups/me`
- **หน้าจอ** หน้า LIFF ที่ API เสิร์ฟเอง (`apps/api/src/common/security/liff-page.security.ts`) CSP `LIFF_PAGE_CSP` ไม่มี inline script
- **การทดสอบ** `apps/api/src/modules/auth/line-liff-signup.spec.ts`, `line-ai/line-first-signup-webhook.spec.ts`, `e2e/line-signup-contact-email.spec.ts`, `apps/api/src/common/security/liff-page-contrast.spec.ts`
- **หมายเหตุ** รายละเอียดการ provision ร้านและการตรวจของผู้ดูแลอยู่ใน SRS ของ onboarding/ผู้ดูแลระบบ เอกสารนี้ครอบคลุมเฉพาะพื้นผิว LINE

### FR-LINE-013 ประตูพนักงานและการเชื่อม LINE ของพนักงาน

- **คำอธิบาย** พนักงานไม่สมัครร้านเอง เจ้าของออกลิงก์เชื่อม LINE ให้จากเมนูพนักงานในเว็บ
- **ผู้ใช้/permission** พนักงานของร้าน; ผู้ออกลิงก์ต้องมีสิทธิ์จัดการพนักงาน (ดู SRS ของ employee-access)
- **แพ็ก** P-ALL (`employee_access`)
- **เงื่อนไขก่อนทำ** PRE-SIG
- **ขั้นตอนหลัก** (1) คนพิมพ์หรือกด `ฉันเป็นพนักงาน` → ตอบ `👋 ยินดีต้อนรับค่ะ ถ้าคุณเป็นพนักงาน ให้เจ้าของกิจการเปิดเมนู "พนักงาน" ในเว็บแอป แล้วส่งลิงก์เชื่อม LINE มาให้นะคะ กดลิงก์นั้นครั้งเดียวก็ใช้งานได้เลยค่ะ (ไม่ต้องสมัครร้านใหม่นะคะ)` (ชื่อบทบาทมาจาก `THAI_SYSTEM_ROLE_NAMES.OWNER`) (2) เจ้าของออก token ที่ `POST /v1/companies/:companyId/settings/employees/:employeeId/line-link-token` (3) พนักงานกดลิงก์ ระบบผูก `ExternalIdentity` ผ่าน `POST /v1/auth/line/employee-link`
- **กฎธุรกิจและข้อยกเว้น** คำสั่งนี้ตอบก่อนด่านตัวตนโดยเจตนา เพราะผู้ที่มาถึงยังไม่มีบัญชี การยกเลิกการเชื่อมทำได้ที่ `POST /v1/auth/line/unlink` และผู้ดูแลระบบยกเลิกแทนได้
- **การตรวจข้อมูล/ข้อผิดพลาด** ดู SRS ของ auth/employee-access
- **ข้อมูล** `EmployeeLineLinkToken`, `ExternalIdentity`
- **API** `POST /v1/auth/line/employee-link`, `POST /v1/auth/line/link`, `POST /v1/auth/line/link/oauth`, `POST /v1/auth/line/unlink`, `POST …/employees/:employeeId/line-link-token`, `POST …/line-link-token/revoke`
- **หน้าจอ** LIFF `line/link-page` (โหมด `account`)
- **การทดสอบ** `line-ai/domain/logic/line-staff-menu.logic.spec.ts`; spec ของ use case การเชื่อมอยู่ในโมดูล auth

### FR-LINE-014 เลือกบริษัทและการ์ด "บริษัทของฉัน"

- **คำอธิบาย** ผู้ใช้ที่เป็นสมาชิกหลายร้านเลือกร้านที่จะคุยด้วย ผู้ใช้ร้านเดียวเห็นการ์ดร้านของตัวเอง
- **ผู้ใช้/permission** ผู้ใช้ที่ผูกบัญชีแล้ว ไม่ต้องมี permission เฉพาะ
- **แพ็ก** P-PUBLIC (ร้านที่ถูกล็อกยังเลือกได้ เพื่อไปซื้อแพ็ก)
- **เงื่อนไขก่อนทำ** PRE-ID
- **ขั้นตอนหลัก** คำสั่ง: `/companies`, `/company`, `เปลี่ยนบริษัท` (แสดงรายการ), `/companies page <n>`, `/company <ชื่อหรือเลข>`, postback `company-select&companyId=…`, `company-page&page=…` และเลขล้วนเมื่อ turn ก่อนหน้าเพิ่งถามให้เลือก (`parseBareCompanySelection` + `pendingCompanySelectionCommand`) ผลการเลือกเขียน `LineCompanyContext`
- **กฎธุรกิจและข้อยกเว้น** การ์ดเลือกบริษัทเป็น carousel ไม่เกิน 12 bubble ถ้ามากกว่า 12 ร้านแสดงหน้าละ 11 ร้านบวก bubble นำทาง (`companyPickerPage`) ร้านปัจจุบันขึ้นก่อนพร้อมป้าย `✓ ใช้งานอยู่` แต่ละร้านมีปุ่ม `เลือกบริษัทนี้` และ `เปิดเว็บบริษัทนี้` (ลิงก์ handoff `/l/<token>`; มีเมื่อ `LINE_WEB_HANDOFF_ENABLED` เปิดและออก token ได้) พร้อมคำอธิบาย `กดเปิดเว็บ ระบบจะสลับบริษัทในไลน์ให้ด้วยค่ะ` ร้านที่ถูกล็อกแสดงป้าย `🔒 ยังไม่มีแพ็กเกจ` หรือ `🔒 หมดอายุ` คำสั่งบริษัทเป็นกลุ่มของตัวเองใน batch เสมอ เพื่อให้การสลับร้านมีผลตรงตำแหน่งที่พิมพ์ media ที่รับไว้ก่อนสลับยังเป็นของร้านเดิม (`companyIdAtAcceptance`)
- **การตรวจข้อมูล/ข้อผิดพลาด** ไม่มีร้านที่ใช้ได้ → `ไม่พบบริษัทที่ใช้งานได้ในขณะนี้` สมาชิกหลายร้านที่ยังไม่เลือก → ได้การ์ดเลือกบริษัทแทนคำตอบ
- **ข้อมูล** `LineCompanyContext`, `CompanyMembership`, `LineWebHandoffToken`
- **API** —
- **หน้าจอ** —
- **การทดสอบ** `line-ai/domain/logic/line-ai-classifier.spec.ts`, `line-ai/domain/logic/line-staff-menu.logic.spec.ts`, `process-line-webhook.use-case.spec.ts`

### FR-LINE-015 ด่านยอมรับเอกสารกฎหมาย

- **คำอธิบาย** ผู้ใช้ที่ยังไม่ยอมรับข้อกำหนดและนโยบายรุ่นปัจจุบันถูกหยุดก่อนงานใด ๆ ที่แตะข้อมูลหรือ AI
- **ผู้ใช้/permission** ผู้ใช้ที่ผูกบัญชีแล้ว
- **แพ็ก** P-PUBLIC
- **เงื่อนไขก่อนทำ** PRE-ID + PRE-CO
- **ขั้นตอนหลัก** ตรวจสองจุด: `preflightLegalAcceptance` ก่อน buffer เก็บ payload กู้คืน (อ่านอย่างเดียว ไม่รับข้อความหรือ media id) และ `refusePendingLegalAcceptance` หลัง resolve บริษัทและสิทธิ์ ก่อน feature probe, router, tool, การบันทึกบทสนทนา และการเก็บไฟล์แนบ
- **กฎธุรกิจและข้อยกเว้น** ตอบด้วยการ์ด "ยอมรับข้อกำหนดก่อนเริ่มใช้งาน 📄 รอยอมรับข้อกำหนด" ข้อความ `บัญชีของคุณผูก LINE เรียบร้อยแล้ว เหลืออีกขั้นเดียวค่ะ: เข้าเว็บแอป MangmeePlus เพื่อยอมรับข้อกำหนดการใช้งานและรับทราบนโยบายความเป็นส่วนตัว เสร็จแล้วกลับมาใช้งานผ่าน LINE ได้ทันทีนะคะ` พร้อมปุ่ม `เข้าเว็บแอปเพื่อยอมรับข้อกำหนด`
- **การตรวจข้อมูล/ข้อผิดพลาด** เมื่อ resolve บริษัทได้แล้ว ความล้มเหลวของโครงสร้างพื้นฐานในการตรวจจะ throw ให้ webhook ตอบ non-2xx แทนการเก็บข้อความภายใต้การตัดสินใจแบบ fail-open
- **ข้อมูล** บันทึกการยอมรับกฎหมายของผู้ใช้ (ดู SRS กฎหมาย/PDPA)
- **API** —
- **หน้าจอ** หน้าเว็บ `/companies/:companyId` (ยอมรับข้อกำหนด)
- **การทดสอบ** `process-line-webhook.use-case.spec.ts`, `line-ai/application/line-message-buffer.service.spec.ts`

### FR-LINE-016 ด่าน PDPA: ผู้ใช้ปิดการประมวลผลด้วย AI

- **คำอธิบาย** ผู้ใช้ที่ใช้สิทธิ์คัดค้านการประมวลผลด้วย AI จะไม่มีข้อความหรือรูปใดถูกส่งให้โมเดล
- **ผู้ใช้/permission** ผู้ใช้ทุกคน ตั้งค่าที่เว็บแอป → ตั้งค่า → ความปลอดภัย
- **แพ็ก** P-PUBLIC
- **เงื่อนไขก่อนทำ** PRE-ID
- **ขั้นตอนหลัก** ถ้า `User.aiAssistantOptOutAt` มีค่า → ตอบข้อความคงที่ แล้วจบ turn ก่อน model, tool และ gateway ด่านเดียวกันอยู่ในเส้นทางรับรูป และ API ตรวจซ้ำตอน tool ถูกเรียก (`ACTOR_INACTIVE` ใน `internal-tools.controller.ts`)
- **กฎธุรกิจและข้อยกเว้น** ข้อความ: `คุณปิดการใช้งานผู้ช่วย AI ไว้ ข้อความนี้จึงไม่ถูกประมวลผลด้วย AI ค่ะ\nเปิดใช้งานอีกครั้งได้ที่ เว็บแอป → ตั้งค่า → ความปลอดภัย นะคะ` คำสั่งเมนูที่ตอบด้วยโค้ดก่อนด่านนี้ (ติดต่อเจ้าหน้าที่ โปรโมชั่น ติดต่อเรา ฯลฯ) ยังใช้ได้
- **การตรวจข้อมูล/ข้อผิดพลาด** สถานะใน event log ระบุว่าเป็น opt-out
- **ข้อมูล** `User.aiAssistantOptOutAt`
- **API** —
- **หน้าจอ** หน้าตั้งค่าความปลอดภัยของเว็บ (นอกเอกสารนี้)
- **การทดสอบ** `scripts/line-ai-reliability-optout-smoke.ts`, `process-line-webhook.use-case.spec.ts`

### FR-LINE-017 ร้านที่ถูกล็อกและสิทธิ์ใช้ฟรี

- **คำอธิบาย** ร้านที่ยังไม่มีแพ็กหรือแพ็กหมดอายุได้คำเชิญเลือกแพ็กแทนคำตอบ AI โดยไม่ใช้ token ของโมเดล ร้านที่ไม่เคยซื้อแพ็กใช้สิทธิ์อ่านเอกสาร 3 ใบต่อเดือนได้
- **ผู้ใช้/permission** สมาชิกร้านที่ถูกล็อก; ผู้ที่มี `company.plan.manage` ได้การ์ดแพ็กเกจ คนอื่นได้ประโยคกลาง ๆ
- **แพ็ก** P-FREE และร้านที่หมดอายุ
- **เงื่อนไขก่อนทำ** PRE-ID และ resolve บริษัทที่ใช้งานได้ไม่ได้
- **ขั้นตอนหลัก** `replyIfCompanyLocked` (`:2877`) หา `lockedCompanyFor` แล้วตอบด้วย `buildPackageRequiredMessage`: หัวการ์ด `ยังไม่มีแพ็กเกจ` (lockReason `no_package`) หรือ `แพ็กเกจหมดอายุแล้ว` (`trial_ended`) ป้าย `🔒 รอเลือกแพ็กเกจ` ข้อความ `น้องมั่งมียังตอบไม่ได้จนกว่าจะเลือกแพ็กเกจค่ะ ข้อมูลทั้งหมดยังอยู่ครบ` ปุ่ม `เลือกแพ็กเกจ` (ลิงก์ handoff ไปหน้าแพ็กเกจ)
- **กฎธุรกิจและข้อยกเว้น** โหมดใช้ฟรี (`freeExpenseDrafts` ใน access): คำถามทั่วไปได้ `สิทธิ์ใช้ฟรียังไม่รวมคำถาม พิมพ์ ‘เมนูหลัก’ เพื่อดูทางเลือกค่ะ` คำขอแก้ข้อมูลได้ `การแก้ข้อมูลผ่านข้อความยังไม่รวมในสิทธิ์ใช้ฟรีค่ะ เปิดร่างที่คุณมีสิทธิ์แล้วแก้ข้อมูลในเว็บได้ค่ะ` `เมนูหลัก` ได้เมนูข้อความจาก `freeExpenseMenuReply` (ลิงก์รายการ, คำสั่ง `สรุปร่างเดือนนี้`, เชิญส่งบิล, `ติดต่อเจ้าหน้าที่`) คำสั่งสรุปเดือน (`สรุปร่างเดือนนี้`, `ดูค่าใช้จ่ายเดือนนี้` ฯลฯ ตรงตัวทั้งข้อความ) ตอบด้วยโค้ดจาก `freeExpenseMonthSummary` workflow ทุกตัวไม่เสนอให้ (`mayOfferWorkflow` คืน false เมื่อ `freeExpenseDrafts`)
- **การตรวจข้อมูล/ข้อผิดพลาด** ร้านถูกล็อกบันทึกเป็นสถานะ ไม่ใช่ error code ไม่มีสมาชิกภาพเลย → `UNLINKED_REPLY`
- **ข้อมูล** `CompanyPlanTerm` (ชื่อ relation `planTerm`), `CompanyOcrUsageEvent` (`quotaSource = FREE_MONTHLY_3`)
- **API** —
- **หน้าจอ** หน้าแพ็กเกจของเว็บ
- **การทดสอบ** `line-ai/domain/logic/free-expense-line.logic.spec.ts`, `line-ai/application/free-expense-quota.pg.spec.ts`, `apps/api/src/modules/billing/line-billing-entry.spec.ts`

### FR-LINE-018 ลิงก์เข้าเว็บแบบแตะครั้งเดียวและหน้า LIFF "เริ่มใช้งาน"

- **คำอธิบาย** ลิงก์ไปเว็บที่ส่งใน LINE พาผู้ใช้เข้าหน้านั้นโดยล็อกอินให้ และเปิดในเบราว์เซอร์ภายนอกเพื่อให้ cookie อยู่ใน Safari/Chrome
- **ผู้ใช้/permission** ผู้ใช้ที่ผูกบัญชีแล้ว
- **แพ็ก** P-PUBLIC
- **เงื่อนไขก่อนทำ** `LINE_WEB_HANDOFF_ENABLED=true` (ค่าเริ่มต้น `false`) และมี `webBaseUrl`
- **ขั้นตอนหลัก** `LineHandoffLinkService` ทำงานที่ขอบการส่ง: เดินทุกข้อความและทุก `action.uri` ใน Flex แล้วแทน URL ของเว็บใต้ `/companies/` ด้วย `<web>/l/<token>` เว็บแลก token ที่ `POST /v1/auth/line/handoff/exchange` หน้า LIFF `line/link-page/start` พิสูจน์ตัวตนด้วย ID token ที่ `POST /v1/auth/line/liff/session` แล้วเปิดปลายทางในเบราว์เซอร์ภายนอก
- **กฎธุรกิจและข้อยกเว้น** สวิตช์ปิดหรือไม่มี web base → ข้อความไม่ถูกแตะแม้ไบต์เดียว เขียนใหม่เฉพาะ URL ของเว็บตัวเองใต้ `/companies/` การออก token ล้มเหลวคงลิงก์เดิมไว้ token ดิบอยู่ในข้อความที่ส่งเท่านั้น ไม่ถูก log แชทเดโม่ (`Vdemo…`) ได้ลิงก์ธรรมดา ไม่ใช้ LINE login ลิงก์ที่เตรียมในหน้า LIFF หมดอายุตามอายุ token 15 นาทีของเซิร์ฟเวอร์ (คอมเมนต์ใน `liff-page.security.ts`)
- **การตรวจข้อมูล/ข้อผิดพลาด** rate limit ของ exchange: `LINE_HANDOFF_EXCHANGE_MAX_PER_IP=20` ต่อ 60 วินาที
- **ข้อมูล** `LineWebHandoffToken`
- **API** `POST /v1/auth/line/handoff/exchange`, `POST /v1/auth/line/liff/session`, `GET /v1/auth/line/link-page/start` (alias `line/start-page`)
- **หน้าจอ** เว็บ `/l/<token>`, หน้า LIFF start
- **การทดสอบ** `line-ai/application/line-handoff-link.service.spec.ts`, `packages/contracts/src/line-external-browser.spec.ts`
- **หมายเหตุ** LINE Login บนเว็บและการล็อกอินด้วย QR (`/v1/auth/line/login/callback`, `/v1/auth/line/qr/*`, หน้าเว็บ `/line-qr/[code]`) เป็นขอบเขตของ SRS ด้าน auth

### FR-LINE-019 ข้อจำกัดของแชตกลุ่มและห้อง

- **คำอธิบาย** งานที่เกี่ยวกับข้อมูลส่วนตัวหรือการยืนยันทำได้เฉพาะแชต 1:1
- **ผู้ใช้/permission** สมาชิกในกลุ่มหรือห้องที่มี OA
- **แพ็ก** P-ALL
- **เงื่อนไขก่อนทำ** `channelKind` เป็น `GROUP` หรือ `ROOM`
- **ขั้นตอนหลัก** control ที่ต้องทำในแชตส่วนตัวตอบ `กรุณาทำรายการในแชตส่วนตัวค่ะ` ตัวจำแนก workflow ไม่ทำงานเมื่อ `channelKind !== 'USER'` หรือปลายทาง push ไม่ใช่ผู้ส่งเอง (`:4215`) การคุยร่างรายจ่ายแบบหลาย turn จำกัดแชตส่วนตัว loading animation ใช้กับ 1:1 เท่านั้น
- **กฎธุรกิจและข้อยกเว้น** คำตอบและ push ต้องกลับไปแชตต้นทางเสมอ (`chatId = groupId ?? roomId ?? userId`) ความชอบรูปแบบคำตอบ (FR-LINE-033) จำเฉพาะแชตส่วนตัว
- **การตรวจข้อมูล/ข้อผิดพลาด** —
- **ข้อมูล** —
- **API** —
- **หน้าจอ** —
- **การทดสอบ** `process-line-webhook.use-case.spec.ts` (ขอบเขตกรณีกลุ่มไม่ได้ตรวจละเอียด)

---

## 5. กลุ่ม C — เมนูและคำสั่งที่ตอบด้วยโค้ด

คำสั่งในกลุ่มนี้ตอบด้วยการ์ดหรือข้อความที่โค้ดประกอบ ไม่เรียกโมเดล ไม่ใช้เครดิต AI การจับคู่เป็นแบบ "ทั้งข้อความ" หลัง `menuCommandKey` (ตัด emoji `📊✅📷🎁`, ยุบช่องว่าง, lowercase อักษรละติน) ประโยคที่แค่อ้างคำสั่งจึงไม่ทำงาน (`line-staff-menu.logic.ts:954–981`)

### FR-LINE-020 Rich menu ของ OA หลัก

- **คำอธิบาย** เมนูภาพ 6 ช่องใต้แชต เป็นทางเข้าหลักของผู้ใช้
- **ผู้ใช้/permission** ทุกคนที่เปิดแชต OA; ผู้ดูแลระบบเป็นผู้ติดตั้ง
- **แพ็ก** P-PUBLIC
- **เงื่อนไขก่อนทำ** backend ที่รองรับคำสั่งของเมนู deploy แล้ว
- **ขั้นตอนหลัก** profile ปัจจุบัน `line-rich-menu-v2-ver3` (`scripts/line-oa/rich-menu-v2-ver3.manifest.json`) ขนาด 2500×1686 ข้อความแถบ `เมนู`:

| ช่อง | ป้าย | action |
|---|---|---|
| บนซ้าย | แพ็กเกจและราคา | message `โปรโมชั่น` |
| บนกลาง | บริษัทของฉัน | message `/companies` |
| บนขวา | ถ่ายใบเสร็จ | uri `https://line.me/R/nv/camera/` |
| ล่างซ้าย | คุยกับน้องมั่งมี | postback `action=line-rich-talk` (เปิดคีย์บอร์ด) |
| ล่างกลาง | สรุปค่าใช้จ่าย | message `ดูค่าใช้จ่ายเดือนนี้` |
| ล่างขวา | ติดต่อเรา | message `ติดต่อเรา` |

- **กฎธุรกิจและข้อยกเว้น** ติดตั้งด้วย `scripts/line-oa/apply-rich-menu.mjs` คำสั่ง `status` / `stage` / `activate` / `rollback` / `delete` แยก `stage` (สร้างและอัปโหลดโดยไม่กระทบผู้ใช้) ออกจาก `activate` (สลับ default) token อ่านจาก Secrets Manager ตอนรัน ไม่พิมพ์ ไม่เก็บ ไม่รับผ่าน command line manifest ระบุ sha256 และขนาดไฟล์ภาพ profile ver1 และ ver2 คงไว้เป็นจุด rollback
- **การตรวจข้อมูล/ข้อผิดพลาด** spec ของ manifest ตรวจพื้นที่ ขนาด และ action
- **ข้อมูล** —
- **API** LINE Messaging API (`/v2/bot/richmenu*`) เรียกจากสคริปต์
- **หน้าจอ** ภาพ `apps/web/public/assets/line/mangmeeplus-line-rich-menu-v2-ver{1,2,3}-2500x1686.png`
- **การทดสอบ** `scripts/line-oa/rich-menu-v2-ver{1,2,3}.manifest.spec.mjs`; runbook `docs/runbooks/line-rich-menu-v2-console-setup.md`
- **หมายเหตุ** มีไฟล์ภาพ `mangmeeplus-staff-menu-2500x843*.png` ใน repo แต่ไม่พบ manifest หรือโค้ดที่ติดตั้ง rich menu แยกสำหรับพนักงาน "เมนูพนักงาน" ในโค้ดคือ quick reply ของ FR-LINE-021

### FR-LINE-021 เมนูหลัก (เมนูพนักงานแบบ quick reply)

- **คำอธิบาย** พิมพ์ `เมนูหลัก` ได้การ์ดทักทายพร้อมปุ่มลัดเฉพาะสิ่งที่ร้านเปิดใช้และตำแหน่งของผู้ใช้มีสิทธิ์
- **ผู้ใช้/permission** ผู้ใช้ที่ผูกบัญชี ปุ่มแต่ละปุ่มมีเงื่อนไข permission และ feature ของตัวเอง
- **แพ็ก** P-ALL
- **เงื่อนไขก่อนทำ** PRE-BOUND (ใช้ได้แม้ AI ปิดหรือผู้ให้บริการโมเดลล่ม)
- **ขั้นตอนหลัก** `buildStaffMainMenu` ประกอบข้อความ `สวัสดีค่ะ <ชื่อ> 👋 / ตำแหน่ง <บทบาท> · ดูข้อมูลได้ <ขอบเขตสาขา> · เข้าถึง <n> เมนู / เมนูด้านล่างแสดงเฉพาะสิ่งที่บริษัทเปิดใช้และตำแหน่งคุณมีสิทธิ์เข้าถึง` พร้อม quick reply ไม่เกิน 13 ปุ่ม
- **กฎธุรกิจและข้อยกเว้น** ปุ่มงาน (postback `chat-action`) แสดงเมื่อ `mayOfferWorkflow` ผ่าน: `สร้างใบเบิก` (`reimbursement_claim`), `ส่งใบเบิก` (`reimbursement_submit`), `อนุมัติใบเบิก` (`approvals`; ต้องมี `reimbursement.approve` หรือเป็นผู้อนุมัติที่ถูกกำหนด), `บันทึกจ่าย` (`expense_pay`) ปุ่มอ่านข้อมูลตาม `QUERY_ACTIONS`:

| ปุ่ม | ข้อความที่ส่ง | permission (ข้อใดข้อหนึ่ง) | feature (ข้อใดข้อหนึ่ง) | ขายในแพ็ก |
|---|---|---|---|---|
| ค่าใช้จ่ายเดือนนี้ | postback `fixed-read` | `expense.read` | `expenses` | P-ALL |
| ยอดขายวันนี้ | `ดูยอดขายวันนี้` | `dashboard.read` | `sales_documents` | ไม่มีแพ็ก |
| คิว/นัดวันนี้ | `ดูคิววันนี้` | `crm.booking.read` | `crm.bookings` | ไม่มีแพ็ก |
| แชทค้างตอบ | `ดูแชทค้างตอบ` | `crm.inbox.read` | `crm.inbox` | ไม่มีแพ็ก |
| รายงานการเงิน | `ดูรายงานการเงิน` | `report.finance.read`, `ledger.read` | `reports`, `double_entry_ledger` | ไม่มีแพ็ก |
| ใบสั่งซื้อ (PO) | `ดูใบสั่งซื้อ` | `procurement.purchase_order.read(_related)` | `procurement.purchase_orders` | ไม่มีแพ็ก |

  ปุ่มเพิ่ม: `📊 ถามข้อมูล`, `🏢 บริษัทของฉัน` (เฉพาะเจ้าของ ส่ง `/companies`), `✅ รายการรออนุมัติ` (เมื่อมีคิวอนุมัติอย่างน้อยหนึ่งคิวที่ render ได้), `📷 ถ่ายใบเสร็จ` (action `camera`; ต้องมี `expense.receipt.line_upload` / `expense.receipt.upload` / `expense.create` และ feature `expenses.upload`) `entitledFeatureKeys = null` คือร้านรุ่นเก่าที่ไม่มีแถว entitlement ถือว่าเปิดทุก feature (fail-open)
- **การตรวจข้อมูล/ข้อผิดพลาด** ร้านโหมดใช้ฟรีได้เมนูข้อความของ FR-LINE-017 แทน
- **ข้อมูล** —
- **API** —
- **หน้าจอ** —
- **การทดสอบ** `line-ai/domain/logic/line-staff-menu.logic.spec.ts`, `docs/agent-memory/line-ai-card-menu-ux.md`

### FR-LINE-022 เมนูถามข้อมูล

- **คำอธิบาย** พิมพ์หรือกด `ถามข้อมูล` ได้รายการปุ่มอ่านข้อมูลที่ใช้ได้
- **ผู้ใช้/permission** ตามตารางของ FR-LINE-021
- **แพ็ก** P-ALL
- **เงื่อนไขก่อนทำ** PRE-BOUND
- **ขั้นตอนหลัก** `buildStaffQueryMenu` ตอบ `อยากดูข้อมูลส่วนไหนดีคะ 📊 / แสดงเฉพาะเมนูที่บริษัทเปิดใช้และตำแหน่งคุณมีสิทธิ์เ…` พร้อมปุ่มและ `« เมนูหลัก`
- **กฎธุรกิจและข้อยกเว้น** ปุ่มที่ส่งเป็นข้อความธรรมดาจะเข้าทาง AI turn ปกติและผ่านด่านเครดิต ยกเว้น `ค่าใช้จ่ายเดือนนี้` ที่เป็น fixed read (FR-LINE-031)
- **การตรวจข้อมูล/ข้อผิดพลาด** —
- **ข้อมูล** — **API** — **หน้าจอ** —
- **การทดสอบ** `line-ai/domain/logic/line-staff-menu.logic.spec.ts`

### FR-LINE-023 การ์ดรายการรออนุมัติ

- **คำอธิบาย** ผู้อนุมัติดูรายการที่รอตนอนุมัติเป็นรายการสั้นใน LINE แล้วเข้าเว็บหรือกดเตรียมการ์ดอนุมัติ
- **ผู้ใช้/permission** `reimbursement.approve` (คิวใบเบิก) หรือผู้อนุมัติที่ถูกกำหนดตามนโยบาย; `procurement.purchase_request.approve` / `procurement.purchase_order.approve` (คิวจัดซื้อ)
- **แพ็ก** คิวใบเบิก P-ALL (`reimbursement`); คิวจัดซื้อไม่มีแพ็ก
- **เงื่อนไขก่อนทำ** PRE-BOUND
- **ขั้นตอนหลัก** คำสั่ง `รายการรออนุมัติ` หรือ postback `approvals` → `loadPendingApprovals` อ่านคิวที่ผู้ใช้มีสิทธิ์ → การ์ดดีไซน์ล็อกบริบท "งานค้าง"
- **กฎธุรกิจและข้อยกเว้น** แสดงไม่เกิน 5 รายการ (`PENDING_APPROVAL_ITEM_LIMIT`) หัวการ์ด `ใบเบิกรออนุมัติ` เมื่อมีคิวใบเบิกอย่างเดียว ไม่งั้น `รายการรออนุมัติ` ผล: `พบ N รายการ`, `ไม่พบรายการ`, `ยังอ่านได้ไม่ครบ`, `ยังอ่านไม่ได้`, `ยังดูผ่าน LINE ไม่ได้` การ์ดพูดเฉพาะสิ่งที่อ่านได้จริง คิวที่อ่านไม่ได้ถูกเรียกชื่อ ไม่แสดงเป็นศูนย์ หมายเหตุ `ตรวจเฉพาะใบเบิกที่รอคุณอนุมัติ ตามสิทธิ์ของคุณ` และ `แสดง N รายการแรก ดูทั้งหมดได้ในเว็บ` ปุ่มเปิดหน้ารายการของคิว (`reimbursements?tab=approvals`) ไม่เปิดใบเดียว รายการใบเบิกมีปุ่มอนุมัติ/ไม่อนุมัติที่มี token ลงลายเซ็นผูกกับบริษัท ผู้ใช้ และใบเบิก การกดเปิดเฉพาะการ์ดตรวจทานซึ่งมีปุ่มยืนยันของตัวเอง (FR-LINE-064)
- **การตรวจข้อมูล/ข้อผิดพลาด** ไม่มี https base สำหรับรูปของการ์ด หรือค่าเกินขนาดแถว → ถอยไปการ์ดธรรมดารุ่นก่อน
- **ข้อมูล** `ReimbursementRequest` (ผ่าน use case ของโมดูล reimbursements)
- **API** —
- **หน้าจอ** เว็บ `/companies/:companyId/reimbursements?tab=approvals`
- **การทดสอบ** `line-ai/domain/logic/line-staff-menu.logic.spec.ts`, `line-ai/application/use-cases/erp-reimbursement-tools.use-case.spec.ts`

### FR-LINE-024 เชิญส่งใบเสร็จ

- **คำอธิบาย** คำสั่ง `ถ่ายใบเสร็จ` หรือ `ลองส่งใบเสร็จ` ได้การ์ดพร้อมปุ่มเปิดกล้องและแนบรูป
- **ผู้ใช้/permission** `expense.receipt.line_upload`, `expense.receipt.upload` หรือ `expense.create`
- **แพ็ก** P-ALL และ P-FREE (`expenses.upload`)
- **เงื่อนไขก่อนทำ** PRE-BOUND
- **ขั้นตอนหลัก** `buildReceiptCapturePrompt`: หัวข้อ `แนบรูปใบเสร็จเข้าระบบ` quick reply `🖼 แนบรูปใบเสร็จ` (cameraRoll), `📷 เปิดกล้อง` (camera), `« เมนูหลัก` รุ่นต้อนรับ (`ลองส่งใบเสร็จ`): `ถ่ายรูปใบเสร็จให้เห็นทั้งใบ แล้วส่งในแชตนี้ได้เลยค่ะ เดี๋ยวมั่งมีช่วยอ่านและเ…`
- **กฎธุรกิจและข้อยกเว้น** ไม่มีสิทธิ์ → `🔒 คุณไม่มีสิทธิ์อัปโหลดบิลหรือใบเสร็จผ่าน LINE ค่ะ` ร้านไม่มี feature → `📋 บริษัทนี้ยังไม่ได้เปิดใช้งานระบบค่าใช้จ่ายและเอกสารค่ะ` ตามด้วยคำแนะนำ
- **การตรวจข้อมูล/ข้อผิดพลาด** —
- **ข้อมูล** — **API** — **หน้าจอ** —
- **การทดสอบ** `line-ai/domain/logic/line-staff-menu.logic.spec.ts`

### FR-LINE-025 การ์ดบริการที่ร้านเปิดใช้

- **คำอธิบาย** คำสั่ง `บริการของเรา` แสดงรายชื่อ feature ที่ร้านเปิดใช้
- **ผู้ใช้/permission** ผู้ใช้ที่ผูกบัญชี
- **แพ็ก** P-ALL
- **เงื่อนไขก่อนทำ** PRE-BOUND
- **ขั้นตอนหลัก** `buildServiceEntitlementMessage` กรอง `FEATURE_CATALOG` ที่ `sellable` และอยู่ใน entitlement แสดงหน้าละ 8 รายการ หลายหน้าเป็น carousel หัวข้อ `บริการที่บริษัทของคุณเปิดใช้`
- **กฎธุรกิจและข้อยกเว้น** ไม่มีรายการ → `บริษัทนี้ยังไม่มีบริการที่เปิดใช้งานผ่าน LINE` ส่งเป็นการ์ดเต็ม (`asCompleteLineCard`) เพื่อให้ delivery plan ส่งการ์ด ไม่ใช่ข้อความแทน
- **การตรวจข้อมูล/ข้อผิดพลาด** — **ข้อมูล** entitlement ของบริษัท **API** — **หน้าจอ** —
- **การทดสอบ** `line-ai/domain/logic/line-staff-menu.logic.spec.ts`

### FR-LINE-026 การ์ดติดต่อเรา

- **คำอธิบาย** คำสั่ง `ติดต่อเรา` ได้ช่องทางติดต่อของมั่งมีพลัส
- **ผู้ใช้/permission** ทุกคน
- **แพ็ก** P-PUBLIC
- **เงื่อนไขก่อนทำ** PRE-SIG (ตอบก่อนด่านตัวตน)
- **ขั้นตอนหลัก** `buildContactCard`: altText `ติดต่อมั่งมี Plus: contact@mangmeeplus.com โทร 098-256-5628` ปุ่มเปิด OA ทีมงานและเว็บทางการ `https://mangmeeplus.com/`
- **กฎธุรกิจและข้อยกเว้น** ต่างจาก `ติดต่อเจ้าหน้าที่` (FR-LINE-044) ซึ่งเปิดคำขอในกล่องข้อความของทีมงานและพัก AI
- **การตรวจข้อมูล/ข้อผิดพลาด** — **ข้อมูล** — **API** — **หน้าจอ** —
- **การทดสอบ** `line-ai/domain/logic/line-staff-menu.logic.spec.ts`

### FR-LINE-027 ปุ่ม "คุยกับน้องมั่งมี" และคำทักทายตรงตัว

- **คำอธิบาย** ปุ่มเปิดบทสนทนากับผู้ช่วย และเป็นทางกลับจากการพัก AI
- **ผู้ใช้/permission** ทุกคน
- **แพ็ก** P-PUBLIC (คำตอบ AI ที่ตามมาต้องผ่าน PRE-AI)
- **เงื่อนไขก่อนทำ** PRE-SIG
- **ขั้นตอนหลัก** คำสั่ง `คุยกับน้องมั่งมี` (หรือ postback `line-rich-talk`): ถ้ากำลังพัก AI → ยกเลิกการพัก (FR-LINE-044) ไม่งั้นตอบ `น้องมั่งมีมาแล้วค่ะ เลือกเมนูที่ต้องการใช้งานได้เลยค่ะ`
- **กฎธุรกิจและข้อยกเว้น** คำทักทายตรงตัวแบบยืนเดี่ยว (เช่น สวัสดี) ตอบด้วยโค้ด `สวัสดีค่ะ 😊 วันนี้มีอะไรให้น้องมั่งมีช่วยไหมคะ?` ไม่เรียกโมเดล หลังผ่านด่านสิทธิ์และอ่านงานที่ค้างแล้ว (รายการคำทักทายที่ถือว่าตรงตัวไม่ได้ตรวจละเอียด)
- **การตรวจข้อมูล/ข้อผิดพลาด** — **ข้อมูล** `LineCompanyContext.aiPausedUntil` **API** — **หน้าจอ** —
- **การทดสอบ** `docs/agent-memory/line-ai-greeting-fallback-2026-09-29.md`, `process-line-webhook.use-case.spec.ts`

### FR-LINE-028 คำถาม "ทำอะไรได้บ้าง"

- **คำอธิบาย** คำถามถึงความสามารถของผู้ช่วยต้องไม่โฆษณาสิ่งที่ไม่มี
- **ผู้ใช้/permission** ทุกคน
- **แพ็ก** P-PUBLIC (คนแปลกหน้า), P-ALL (ผู้ใช้ที่ผูกบัญชี)
- **เงื่อนไขก่อนทำ** PRE-SIG
- **ขั้นตอนหลัก** `isCapabilityQuestion` (ข้อความไม่เกิน 40 ตัวอักษร มีคำอย่าง `ทำอะไรได้`, `ช่วยอะไรได้`, `มีฟีเจอร์อะไร`, รูปคำขอ `สอน…ใช้/หน่อย`, หรือ `ใช้ยังไง` คู่กับ `มั่งมี/ระบบ/แอป/เมนู`) คนแปลกหน้าได้การ์ด `น้องมั่งมีช่วยอะไรได้บ้าง` (`buildCapabilityCard`, หกหน้าที่จริงตาม rich menu) ผู้ใช้ที่ผูกบัญชีไปทาง AI turn intent `capability_help` ซึ่ง gateway ประกอบจากสิทธิ์และ entitlement ของผู้ถาม (`buildCapabilityHelp`, `buildCapabilityTeaching` ใน `gw/line-ai/agents/response-composer.agent.ts`)
- **กฎธุรกิจและข้อยกเว้น** คำว่า "สอน" ที่เป็นรายจ่าย (`ค่าสอนพิเศษ 500`) ไม่นับ: มีตัวเลขหรือคำ `ค่าเรียน`, `ค่าสอน`, `บิลสอน` ถือเป็นรายจ่าย (`TUTORING_EXPENSE`) เมื่อช่อง AI ปิด (launch route ปิด หรือร้านไม่มี feature) คำถามความสามารถยังได้คำตอบของด่านนั้นบวกการ์ด entitlement คำถามต่อเนื่องหลังการ์ด (`ต้องทำยังไงต่อ`) ตอบด้วย `capabilityFollowUpReply`
- **การตรวจข้อมูล/ข้อผิดพลาด** —
- **ข้อมูล** — **API** — **หน้าจอ** —
- **การทดสอบ** `line-ai/domain/logic/line-staff-menu.logic.spec.ts`, `gw/line-ai/agents/response-composer.agent.spec.ts`, `docs/agent-memory/line-ai-capability-help-entitlement.md`

### FR-LINE-029 โปรโมชั่นและแพ็กเกจ

- **คำอธิบาย** คำสั่ง `โปรโมชั่น`, `แพ็กเกจ`, `แพ็คเกจ` หรือ postback `view-packages` ได้โปสเตอร์แพ็กเกจตามด้วยการ์ด
- **ผู้ใช้/permission** ทุกคน ปุ่มหลักขึ้นกับผู้กด
- **แพ็ก** P-PUBLIC
- **เงื่อนไขก่อนทำ** PRE-SIG (อ่านเฉพาะตัวตนและร้านที่เป็นเจ้าของเพื่อเลือกปุ่ม)
- **ขั้นตอนหลัก** (1) `buildPackagePosterMessage` ส่งภาพ `/assets/line/package-poster-20260930.png` เมื่อ web base เป็น https (2) `promotionCard` → `buildPromotionCard(audience)`
- **กฎธุรกิจและข้อยกเว้น** เจ้าของ: ปุ่ม `เลือกแพ็กเกจ` เปิดหน้าแพ็กเกจของร้าน (ลิงก์ handoff) คนแปลกหน้า: ปุ่ม `เปิดร้านใหม่` เปิดฟอร์ม LIFF พนักงาน: ไม่มีปุ่มซื้อ มีข้อความ `เจ้าของกิจการหรือผู้มีสิทธิ์จัดการแพ็กเกจเป็นคนเลือกแพ็กเกจให้ร้านนะคะ` ไม่มีปุ่ม "ให้ทีมงานติดต่อกลับ" บนการ์ดแล้ว (มติเจ้าของ 2026-09-30) แต่ postback เดิมยังทำงาน (FR-LINE-042) ชื่อไฟล์โปสเตอร์มีวันที่เพราะ LINE และ CDN cache ตาม URL
- **การตรวจข้อมูล/ข้อผิดพลาด** URL ใช้ไม่ได้ → ตัดปุ่มนั้นออก การ์ดยังส่ง
- **ข้อมูล** — **API** — **หน้าจอ** หน้าแพ็กเกจของเว็บ, LIFF signup
- **การทดสอบ** `line-ai/domain/logic/line-staff-menu.logic.spec.ts`, `apps/api/src/modules/billing/line-billing-entry.spec.ts`

### FR-LINE-030 คำตอบนโยบายสาธารณะ

- **คำอธิบาย** คำถามเรื่องการใช้ฟรี การคิดเงิน การต่ออายุ ข้อมูลหลังหมดอายุ และการยกเลิก ตอบด้วยข้อความที่ตรวจทานแล้ว ไม่ใช้ AI ไม่อ่านข้อมูลบัญชี
- **ผู้ใช้/permission** ทุกคน
- **แพ็ก** P-PUBLIC
- **เงื่อนไขก่อนทำ** PRE-SIG; ไม่อยู่ในบทสนทนากับเจ้าหน้าที่
- **ขั้นตอนหลัก** `resolvePublicPolicyAnswer` (`line-ai/domain/logic/line-public-policy.logic.ts`) normalize ข้อความ (ไม่เกิน 160 ตัวอักษร, ตัดช่องว่าง, คำลงท้าย, `แพ็คเกจ`→`แพ็กเกจ`, `มั้ย`→`ไหม`) แล้วจับคู่ทั้งสตริงกับหัวข้อ ส่งเป็นการ์ด `buildPublicPolicyCardMessage`
- **กฎธุรกิจและข้อยกเว้น** หัวข้อ 11 เรื่อง:

| topic | หัวการ์ด | ตัวอย่างคำถามที่จับ |
|---|---|---|
| `trial` | การเริ่มใช้งานและการต่ออายุ | "หมดทดลองใช้ฟรีแล้วต้องเสียเงินไหม", "แอปนี้เสียค่าบริการไหม" |
| `trial_limits` | เปิดร้านแล้วใช้อะไรได้บ้าง | "ทดลองใช้ฟรีได้กี่ใบ" |
| `package_features` | เมนูในแพ็กเกจ | "แพ็กเกจธุรกิจได้อะไรบ้าง" |
| `card` | เริ่มใช้งานอย่างไร | "ใช้ฟรีต้องผูกบัตรไหม", "อยากเปิดร้านใหม่ทำยังไง" |
| `data` | ข้อมูลเมื่อยังไม่มีแพ็กเกจหรือหมดอายุ | "ไม่ต่อแพ็กเกจแล้วข้อมูลหายไหม" |
| `paid_renewal` | การต่ออายุแพ็กเกจที่ซื้อแล้ว | "ต่ออายุแพ็กเกจอัตโนมัติไหม" |
| `buy_early` | ซื้อแพ็กเกจก่อนช่วงเดิมหมด | "ซื้อแพ็กเกจระหว่างใช้ฟรีคิดเงินเมื่อไหร่" |
| `quota` | นับสิทธิ์อ่านใบเสร็จอย่างไร | "อ่านใบเสร็จไม่สำเร็จเสียสิทธิ์ไหม" |
| `plan_change` | ต่ออายุและเปลี่ยนแพ็กเกจ | "อัปเกรดแพ็กเกจคิดเงินยังไง" |
| `cancellation` | ยกเลิกแพ็กเกจและขอคืนเงิน | "ยกเลิกแพ็กเกจได้เงินคืนไหม" |
| `payment_failure` | เมื่อชำระต่ออายุไม่สำเร็จ | "แพ็กเกจผ่อนผันกี่วัน" |

  ทุกคำตอบลงท้าย `มีคำถามเพิ่มเติม กดติดต่อเจ้าหน้าที่ได้เลยค่ะ` คำถามต่อเนื่องสั้น ๆ (`ต้องจ่ายไหม`, `แน่นะ`, `แล้วข้อมูลหายไหม`) อ่านหัวข้อที่ส่งล่าสุดจากหลักฐานการส่ง (`lastDeliveredPublicPolicy`) ไม่ใช่ประวัติของโมเดล event อื่นที่แทรกเข้ามาจบหัวข้อนั้น คำถามต่อเนื่องของหัวข้อแพ็กที่ชำระเงินไม่สืบทอดคำรับรองของสิทธิ์ฟรี ข้อเท็จจริงในข้อความ: สิทธิ์ฟรี 3 ใบต่อเดือน, แพ็ก 249/499/999 เมนูชุดเดียวกัน, แพ็ก 1,999 เพิ่ม ภ.ง.ด.53 และ 50 ทวิ, ช่วงผ่อนผัน 7 วัน, สิทธิ์อ่านนับเมื่ออ่านและบันทึกสำเร็จ
- **การตรวจข้อมูล/ข้อผิดพลาด** การจับคู่ทั้งสตริงทำให้คำขอผสม คำอ้าง และคำสั่งธุรกิจไม่ถูกดักโดยไม่ตั้งใจ มีสำเนาอังกฤษของทุกหัวข้อ (`publicPolicyAnswerLanguage`)
- **ข้อมูล** `LineDeliveryPlan` (อ่านหัวข้อล่าสุด)
- **API** —
- **หน้าจอ** —
- **การทดสอบ** `line-ai/application/use-cases/line-public-general.spec.ts`, `line-ai/domain/logic/line-business-card.logic.spec.ts`, `docs/agent-memory/line-trial-policy-conversation-20260918.md` (ที่มาของข้อความ)

### FR-LINE-031 Fixed read: ค่าใช้จ่ายเดือนนี้

- **คำอธิบาย** ปุ่ม `ค่าใช้จ่ายเดือนนี้` (postback `action=fixed-read&id=expense_month`) อ่านยอดเดือนปัจจุบันด้วยเครื่องมือและรูปคำตอบที่กำหนดตายตัว
- **ผู้ใช้/permission** `expense.read` (ปุ่ม); ตัว tool `expense.list_recent` ใช้นโยบาย own/related/company ของโมดูลรายจ่าย
- **แพ็ก** P-ALL
- **เงื่อนไขก่อนทำ** PRE-BOUND
- **ขั้นตอนหลัก** `handleFixedRead` (`:3866`) ใช้ `FIXED_READ.expense_month` = tool `expense.list_recent`, answerShape `single_metric`, ลิงก์ `/companies/{companyId}/expenses`
- **กฎธุรกิจและข้อยกเว้น** control ต้องมี 2 คีย์พอดีและไม่เกิน 300 ตัวอักษร ปุ่มใน rich menu ช่อง "สรุปค่าใช้จ่าย" ส่งเป็นข้อความ `ดูค่าใช้จ่ายเดือนนี้` ไม่ใช่ postback จึงเดินทางข้อความปกติ
- **การตรวจข้อมูล/ข้อผิดพลาด** —
- **ข้อมูล** `ExpenseRecord` (ผ่าน tool)
- **API** `POST /v1/internal/ai/tools/invoke` (ถ้าไปทาง gateway; เส้นทางภายในของ `handleFixedRead` ไม่ได้ตรวจละเอียด)
- **หน้าจอ** เว็บ `/companies/:companyId/expenses`
- **การทดสอบ** `line-ai/application/use-cases/process-line-webhook.fixed-read.spec.ts`, `gw/line-ai/application/use-cases/line-ai-turn.fixed-read.spec.ts`
- **หมายเหตุ** บันทึกงานของทีม (นอก repo) ระบุว่าปุ่ม quick reply นี้เคยปฏิเสธเสมอบน main และมีการแก้บนกิ่งเดโม่ สถานะที่ commit `08850deaf` ไม่ได้ยืนยันด้วยการรัน

### FR-LINE-032 "ฉันมีส่วนลดไหม" (ส่วนลดจากงานอีเวนต์)

- **คำอธิบาย** ผู้ถือส่วนลดจากงานขายถามสิทธิ์ของตัวเอง ตอบด้วยโค้ดก่อน AI turn
- **ผู้ใช้/permission** เจ้าของร้าน (อ่านด้วยสิทธิ์เจ้าของของหน้าแพ็กเกจ) สมาชิกอื่นได้ข้อความ `EVENT_DISCOUNT_MEMBER_REPLY`
- **แพ็ก** P-PUBLIC ถึง P-ALL
- **เงื่อนไขก่อนทำ** PRE-BOUND
- **ขั้นตอนหลัก** `isMangmeeDiscountQuestion` → `eventDiscountCard` (`:3050`) อ่านส่วนลดผ่าน BillingModule → `buildEventDiscountCard` พร้อมปุ่มไปหน้าแพ็กเกจเมื่อใช้ได้
- **กฎธุรกิจและข้อยกเว้น** คำถามถึงส่วนลดบนบิล ("ส่วนลดในบิลนี้") ไม่เข้าเงื่อนไข ยังอยู่กับงานใบเสร็จ การสแกน QR ที่บูธเปิดหน้า LIFF `line/link-page/event-discount` ซึ่งเคลมด้วย ID token ที่ `POST /v1/public/event-discounts/claim`
- **การตรวจข้อมูล/ข้อผิดพลาด** ดู SRS ของ sales-event
- **ข้อมูล** ตารางส่วนลดงานขาย (นอกเอกสารนี้)
- **API** `GET /v1/auth/line/link-page/event-discount`
- **หน้าจอ** หน้า LIFF event-discount
- **การทดสอบ** `line-ai/domain/logic/line-event-discount.logic.spec.ts`

### FR-LINE-033 จำรูปแบบคำตอบที่ชอบ

- **คำอธิบาย** ผู้ใช้สั่งให้จำภาษา ความยาว และรูปแบบการนำเสนอของคำตอบ ดูสิ่งที่จำไว้ และสั่งลืม
- **ผู้ใช้/permission** ผู้ใช้ที่ผูกบัญชี ในแชตส่วนตัว
- **แพ็ก** P-ALL
- **เงื่อนไขก่อนทำ** PRE-BOUND, `LINE_AI_PREFERENCES_ENABLED=true` (ค่าเริ่มต้น)
- **ขั้นตอนหลัก** `parseLinePreferenceCommand` (คำสั่งทั้งข้อความ):

| ผู้ใช้พิมพ์ | ผล |
|---|---|
| `จำไว้ว่าชอบสั้น`, `จำว่าตอบสั้น`, `remember that i prefer short answers` | detail = short |
| `จำไว้ว่าชอบคำตอบปกติ` / `…ละเอียด` | detail = normal / detailed |
| `จำไว้ว่าชอบภาษาไทย` / `…ภาษาอังกฤษ` | language = th / en |
| `จำไว้ว่าชอบตอบเป็นข้อ` / `…ตาราง` / `…ขั้นตอน` / `…ย่อหน้า` | presentation = bullets / table / steps / prose |
| `จำอะไรไว้บ้าง`, `ดูรูปแบบคำตอบที่จำไว้` | แสดงรายการ |
| `ลืมรูปแบบคำตอบทั้งหมด`, `ลืมความชอบทั้งหมด` | ลบทั้งหมด |
| `ลืมภาษาที่ชอบ`, `ลืมความยาวคำตอบที่ชอบ`, `ลืมรูปแบบการนำเสนอ` | ลบทีละค่า |

- **กฎธุรกิจและข้อยกเว้น** ตอบ `จำไว้แล้วค่ะ ต่อไปจะตอบแบบ<ค่า>` ตามด้วยประกาศ `จำเฉพาะรูปแบบคำตอบในแชตส่วนตัวของคุณกับบริษัทนี้นาน 90 วัน อ่านค่าได้ด้วย “จำอะไรไว้บ้าง” และลบได้ด้ว…` คำขอรูปแบบเฉพาะ turn เดียวไม่ถูกเก็บถาวร intake router เสนอคำสั่งเดียวกันได้ผ่านช่อง `responsePreference` (`handleRoutedPreference`) การลืมความชอบไม่ลบงานที่ค้างของแชต ภาษาของข้อความปัจจุบันชนะค่าที่จำไว้เสมอ (persona)
- **การตรวจข้อมูล/ข้อผิดพลาด** ขอลืมสิ่งที่ไม่ได้จำ → `ไม่พบรูปแบบคำตอบนี้ที่จำไว้ค่ะ จึงไม่ได้ลบอะไร` ยังไม่มีค่า → `ยังไม่มีรูปแบบคำตอบที่จำไว้ค่ะ`
- **ข้อมูล** สถานะบทสนทนาที่ `LineConversationContextService` ดูแล (`AiConversation` และแถวความชอบ; ชื่อคอลัมน์ไม่ได้ตรวจละเอียด)
- **API** — **หน้าจอ** —
- **การทดสอบ** `line-ai/domain/logic/line-preference-command.logic.spec.ts`, `line-ai/application/line-conversation-context.pg.spec.ts`

### FR-LINE-034 ชวนใส่อีเมลหรือเบอร์กันบัญชีหลุด

- **คำอธิบาย** หลังใช้งานครบสัปดาห์ ระบบชวนผู้ใช้ที่มีแต่ LINE ให้เพิ่มช่องทางกู้บัญชี
- **ผู้ใช้/permission** ผู้ใช้ที่ผูกบัญชี
- **แพ็ก** P-PUBLIC
- **เงื่อนไขก่อนทำ** PRE-ID
- **ขั้นตอนหลัก** การ์ด `buildProfileGuardNudgeCard`: หัว `กันร้านหลุด` ป้าย `🔐 เผื่อเปลี่ยนมือถือ` ข้อความ `ใช้มาครบสัปดาห์แล้วค่ะ 👍 ใส่อีเมลหรือเบอร์ไว้หน่อยไหมคะ เผื่อเปลี่ยนมือถือแล้ว LINE หลุด จะได้กู้ร้านคืนได้` ปุ่ม `ใส่เลย` / `ไว้ก่อน`
- **กฎธุรกิจและข้อยกเว้น** `ใส่เลย` → `🔐 ได้เลยค่ะ ใส่อีเมลหรือเบอร์ไว้ในหน้าตั้งค่าได้ที่ลิงก์นี้นะคะ` พร้อมลิงก์ `ไว้ก่อน` → `👍 ได้ค่ะ ไว้พร้อมเมื่อไหร่พิมพ์ "ตั้งค่า" มาได้เลยนะคะ` คำสั่งนี้ทำงานเหนือการพัก AI (จุดที่ระบบส่งการ์ดนี้ครั้งแรกไม่ได้ตรวจละเอียด)
- **การตรวจข้อมูล/ข้อผิดพลาด** — **ข้อมูล** — **API** — **หน้าจอ** หน้าตั้งค่าบัญชีของเว็บ
- **การทดสอบ** `line-ai/domain/logic/line-staff-menu.logic.spec.ts`

---

## 6. กลุ่ม D — แพ็กเกจและการติดต่อเจ้าหน้าที่ผ่าน LINE

### FR-LINE-040 ซื้อหรือเปลี่ยนแพ็กเกจผ่านแชต

- **คำอธิบาย** ผู้มีสิทธิ์จัดการแพ็กเกจบอกแพ็กที่ต้องการในแชต ระบบเตรียมการ์ดสรุปให้ตรวจ กดปุ่มที่มีลายเซ็นแล้วจึงสร้างลิงก์ชำระเงิน
- **ผู้ใช้/permission** เจ้าของหรือบทบาทที่มี `company.plan.manage` (ตรวจด้วย `billing.assertOwner`)
- **แพ็ก** P-PUBLIC (ใช้ได้กับร้านที่ถูกล็อกและร้านที่ไม่มี AI)
- **เงื่อนไขก่อนทำ** PRE-ID, แชตส่วนตัว, ที่เก็บ preview พร้อม, ตั้ง internal secret (ใช้ลงลายเซ็น token)
- **ขั้นตอนหลัก** (1) `isPackagePurchaseIntent` จับคำกริยา (`ซื้อ`, `อัปเกรด`, `ต่ออายุ`, `เปลี่ยน`) คู่กับคำแพ็ก (`แพ็กเกจ`, `โปร`, `ธุรกิจ`, `starter`…`enterprise`, `249/499/999/1999`) หรือ `แพ็กเกจ 499` (2) `LinePackagePurchaseService.prepare` อ่านสถานะ billing และ catalog วันนี้ แล้ว resolve แพ็กจากชื่อหรือราคา (`resolvePackageOffer`; ต้องตรงแพ็กเดียว) รอบจ่าย (`รายเดือน`/`รายปี`) วิธีจ่าย (`บัตร`/`พร้อมเพย์`) และการต่ออายุ (`ครั้งเดียว`/`อัตโนมัติ`) (3) ถามสิ่งที่ยังขาดทีละอย่าง คำตอบสั้น ๆ ของผู้ใช้เข้าเงื่อนไข `isPackagePurchaseAnswer` (4) สร้างการ์ด `buildPackagePurchaseCard` บรรทัดแรก `ตรวจรายละเอียดแล้วกดสร้างลิงก์จ่ายค่ะ` ตามด้วยชื่อร้าน แพ็ก ราคา และเงื่อนไขของวิธีจ่าย (5) ผู้ใช้กด `package_purchase_confirm` → `apply` สร้าง checkout ผ่าน use case เดียวกับเว็บ แล้วตอบลิงก์ชำระเงินพร้อมเวลาหมดอายุ
- **กฎธุรกิจและข้อยกเว้น** preview หมดอายุใน 600 วินาที ราคาและชื่อมาจาก catalog ไม่ hard-code token รูปแบบ `<uuid>.<43 ตัวอักษร base64url>` ผูกกับบริษัท ผู้ใช้ membership แชต และ epoch ของบทสนทนา การกดซ้ำใช้ idempotency key เดิม ต่อรายการเดิม ไม่สร้างรายการใหม่ มีรายการชำระเงินค้างอยู่ → ตอบ `มีรายการเดิมอยู่ค่ะ …` พร้อมลิงก์เดิม แพ็กที่ยังไม่เปิดขาย → `<ชื่อแพ็ก> ยังไม่เปิดขายค่ะ` พร้อมตัวเลือกไม่เกิน 4 แพ็กที่ซื้อได้ ข้อความเงื่อนไขตามโหมด: บัตรต่ออายุอัตโนมัติ, QR พร้อมเพย์ทุกงวดต้องสแกนเอง, จ่ายครั้งเดียวไม่ตัดงวดถัดไป เจ้าของหลายร้านต้องยืนยันร้านก่อน (การ์ดเลือกร้านพร้อมป้ายล็อก)
- **การตรวจข้อมูล/ข้อผิดพลาด** ไม่มีสิทธิ์ → `ให้เจ้าของร้านหรือแอดมินที่มีสิทธิ์จัดการแพ็กเกจเป็นผู้ซื้อค่ะ` การ์ดหมดอายุ → `การ์ดนี้หมดอายุหรือข้อมูลเปลี่ยนแล้วค่ะ กรุณาบอกแพ็กเกจที่ต้องการอีกครั้ง` ยกเลิก → `ไม่ทำรายการนี้ค่ะ` เกินจำนวนสาขา/ผู้ใช้ของแพ็กใหม่ → `ต้องเลือกสาขาหรือผู้ใช้ที่จะคงไว้ก่อนซื้อแพ็กเกจนี้…` รหัสภายในของผู้ให้บริการชำระเงินไม่ถูกแสดง
- **ข้อมูล** `BillingQuote` และตาราง billing (ดู SRS billing), ที่เก็บ preview แบบ TTL (`LineDraftPreviewStore`)
- **API** ภายในเรียก use case ของ BillingModule; ไม่มี endpoint ใหม่
- **หน้าจอ** เว็บ `/companies/:companyId/billing?channel=line`
- **การทดสอบ** `apps/api/src/modules/billing/line-billing-entry.spec.ts`, `process-line-webhook.use-case.spec.ts`

### FR-LINE-041 คำขอเปลี่ยนแพ็กเกจ (ทางสำรอง)

- **คำอธิบาย** คำสั่ง `ขอเปลี่ยนแพ็กเกจ` / `ขอเปลี่ยนแพ็คเกจ` หรือ postback `package-change` เมื่อทางซื้อใน FR-LINE-040 ไม่รับ ระบบตอบการ์ดทบทวนแพ็กหรือเปิดคำขอให้ทีมงาน
- **ผู้ใช้/permission** ผู้มีสิทธิ์จัดการแพ็กเกจ
- **แพ็ก** P-PUBLIC (รวมร้านที่หมดอายุ ซึ่งมาที่แชตเพื่อทำสิ่งนี้)
- **เงื่อนไขก่อนทำ** PRE-ID; ไม่ต้อง resolve บริษัทที่ active
- **ขั้นตอนหลัก** `handlePackageChangeRequest` (`:3706`) ผู้ซื้อได้ → การ์ด `buildPackageReviewCard` (`📦 <ชื่อร้าน>` ข้อความ `เลือกแพ็กเกจ ตรวจสอบการชำระเงิน และเปิดใบเสร็จได้ที่หน้าแพ็กเกจ … ตรวจสอบราคาและยืนยันบนเว็บก่อนชำระเงินนะคะ` ปุ่มเดียวเปิดหน้าแพ็กเกจ) หรือสร้าง `PackageChangeRequest` พร้อมหมายเหตุ `ขอผ่าน LINE ยังไม่ได้เลือกแพ็กเกจ ทีมงานคุยกับร้านแล้วปรับได้` โดยตั้งแพ็กเริ่มต้นเป็นขั้นถัดไป (`nextPlanTierKey`)
- **กฎธุรกิจและข้อยกเว้น** ทำงานเหนือการพัก AI โดยเจตนา (ปุ่มที่ระบบวางให้ต้องไม่ถูกกลืน) ตอบรับ: `📦 รับคำขอแล้วค่ะ ทีมงานจะติดต่อกลับในเวลาทำการ (จันทร์–เสาร์ 9:00–18:00) นะคะ` ไม่ใช่ผู้มีสิทธิ์: `📦 หากต้องการเปลี่ยนแพ็กเกจ รบกวนแจ้งเจ้าของกิจการหรือผู้มีสิทธิ์จัดการแพ็กเกจให้พิมพ์ "ขอเปลี่ยนแพ็กเกจ" ในแชตนี้ได้เลยค่ะ`
- **การตรวจข้อมูล/ข้อผิดพลาด** เปิดคำขอไม่ได้ → `📦 ตอนนี้เปิดคำขอเปลี่ยนแพ็กเกจให้ไม่ได้ค่ะ รบกวนติดต่อทีมงานที่ 098-256-5628 นะคะ`
- **ข้อมูล** `PackageChangeRequest`
- **API** — **หน้าจอ** หน้าแพ็กเกจของเว็บ; คิวของผู้ดูแลระบบ (SRS ผู้ดูแล)
- **การทดสอบ** `process-line-webhook.use-case.spec.ts`

### FR-LINE-042 ขอให้ทีมงานติดต่อกลับเรื่องแพ็กเกจ

- **คำอธิบาย** คำสั่ง `ให้ทีมงานติดต่อกลับ` หรือ postback `package-callback` เปิดคำขอในกล่องข้อความทีมงานโดยไม่พัก AI
- **ผู้ใช้/permission** ทุกคน
- **แพ็ก** P-PUBLIC
- **เงื่อนไขก่อนทำ** PRE-SIG
- **ขั้นตอนหลัก** `handlePackageCallback` (`:3285`) สร้าง `LineSupportRequest` ด้วยข้อความ `ขอให้ทีมงานติดต่อกลับเรื่องแพ็กเกจ`
- **กฎธุรกิจและข้อยกเว้น** ตอบ `📮 รับเรื่องแล้วค่ะ ทีมงานจะติดต่อกลับเรื่องแพ็กเกจในเวลาทำการ (จันทร์–เสาร์ 9:00–18:00) ระหว่างนี้ถามน้องมั่งมีต่อได้เลยนะคะ` (ถ้าไม่มีร้าน active ตัดประโยคสุดท้าย) คำขอเดิมยังเปิด → `📮 คำขอของคุณยังอยู่ในคิวค่ะ …` ปุ่มนี้ถูกถอดจากการ์ดโปรโมชั่นแล้ว แต่การ์ดเก่าในแชตยังกดได้
- **การตรวจข้อมูล/ข้อผิดพลาด** ใช้เพดานคำขอต่อวันร่วมกับ FR-LINE-044
- **ข้อมูล** `LineSupportRequest`, `LineSupportMessage`
- **API** — **หน้าจอ** กล่องข้อความสนับสนุนของผู้ดูแลระบบ
- **การทดสอบ** `process-line-webhook.use-case.spec.ts`

### FR-LINE-043 ผู้ช่วยเลือกแพ็กเกจ (LIFF package advisor)

- **คำอธิบาย** หน้า LIFF ถาม 4 คำถามแล้วแนะนำแพ็กรายเดือนจาก catalog สด ไม่ใช้โมเดล
- **ผู้ใช้/permission** ทุกคนที่เปิดหน้า; การไปหน้าแพ็กเกจของร้านต้องพิสูจน์ตัวตนด้วย LIFF ID token
- **แพ็ก** P-PUBLIC
- **เงื่อนไขก่อนทำ** ตั้ง `LINE_LIFF_ID`
- **ขั้นตอนหลัก** (1) โหลด `GET /v1/billing/catalog` (ไม่ส่ง credential) (2) ถามตามลำดับ: `ที่ร้านมีคนช่วยดูแลใบเสร็จและรายจ่ายกี่คนคะ?` (ตัวเลือกจาก `employeeLimit` ของแพ็กที่ขาย), `แต่ละเดือนมีใบเสร็จให้ดูแลประมาณกี่ใบคะ?` (จาก `monthlySlipLimit` + `ยังไม่แน่ใจ`), `ตอนนี้อยากให้มั่งมีช่วยงานไหนมากที่สุดคะ?` (อ่านและเก็บใบเสร็จ / รวบรวมรายจ่าย / ดูภาพรวมร้าน / ช่วยทีมทำงานร่วมกัน), `ปกติที่ร้านเก็บใบเสร็จและจดรายจ่ายกันอย่างไรคะ?` (กระดาษหรือสมุด / ตาราง / โปรแกรมเดิม / สำนักงานบัญชี) (3) เลือกแพ็กที่ถูกที่สุดซึ่งรองรับจำนวนคนและใบเสร็จ แสดง `จากที่คุณเล่า มั่งมีแนะนำแพ็กเกจนี้ค่ะ …` พร้อมราคาและขีดจำกัด (4) ปุ่มไปต่อเรียก `POST /v1/auth/line/liff/session` เพื่อรับ handoff URL ไปหน้าแพ็กเกจ
- **กฎธุรกิจและข้อยกเว้น** รุ่นแรกแนะนำเฉพาะรายเดือน ใช้เฉพาะแพ็ก `STARTER_249`, `BASIC_499`, `PRO_999`, `ENTERPRISE_1999` ที่ catalog บอกว่าขาย ก่อนไปต่อโหลด catalog ซ้ำ ถ้าราคาหรือสถานะเปลี่ยนแจ้ง `มีการอัปเดตข้อมูลแพ็กเกจค่ะ กรุณาตรวจคำแนะนำและราคาใหม่ก่อนกดไปต่อ` ผู้ใช้หลายร้านเลือกร้านก่อน (`เลือกหาร้านที่ต้องการดูแพ็กเกจ`) ยังไม่มีร้าน → `ยังไม่พบร้านที่ผูกกับ LINE นี้ค่ะ กรุณาเปิดร้านก่อนแล้วค่อยเลือกแพ็กเกจ…`
- **การตรวจข้อมูล/ข้อผิดพลาด** catalog อ่านไม่ได้หรือไม่ครบ → ข้อความลองใหม่ ไม่มีแพ็กรองรับ → `จากจำนวนที่เลือก ยังไม่พบแพ็กเกจที่เปิดขายและรองรับครบค่ะ …`
- **ข้อมูล** —
- **API** `GET /v1/auth/line/link-page/package-advisor` (alias `line/package-advisor-page`), `GET /v1/auth/line/package-advisor.js`, `GET /v1/billing/catalog`, `POST /v1/auth/line/liff/session`
- **หน้าจอ** หน้า LIFF (`apps/api/src/common/security/line-package-advisor.page.ts`)
- **การทดสอบ** `apps/api/src/common/security/line-package-advisor.check.ts`
- **หมายเหตุ** tool `billing.get_package_usage` และ `billing.get_package_catalog` ให้ผู้ช่วย AI ตอบเรื่องการใช้แพ็กและราคาในแชต (FR-LINE-095) เป็นอีกเส้นทางหนึ่ง

### FR-LINE-044 ติดต่อเจ้าหน้าที่ การพัก AI 24 ชั่วโมง และการกลับมาคุยกับ AI

- **คำอธิบาย** ผู้ใช้ขอคุยกับคน ระบบเปิดคำขอในกล่องข้อความทีมงาน หยุดผู้ช่วย AI ไม่ให้ตอบทับ และเก็บทุกข้อความที่ตามมาเข้าคำขอนั้น
- **ผู้ใช้/permission** ทุกคน รวมผู้ที่ยังไม่มีบัญชี
- **แพ็ก** P-PUBLIC
- **เงื่อนไขก่อนทำ** PRE-SIG (ตอบก่อนด่านตัวตน)
- **ขั้นตอนหลัก** (1) คำสั่ง `ติดต่อเจ้าหน้าที่` หรือ postback `staff-contact` → `handleStaffContact` (`:3150`) (2) `openSupportRequest` สร้าง `LineSupportRequest` (ผู้สร้างแถวเพียงจุดเดียว) ระบุร้านและที่มาจากฝั่งเซิร์ฟเวอร์ (`resolveSupportAsker`, `deriveSupportBillingReference`) (3) ถ้าผู้ถามผูกบัญชีและมีคำขอจริง → `pauseAssistant` ตั้ง `LineCompanyContext.aiPausedUntil = now + 24 ชั่วโมง` (`SUPPORT_ASSISTANT_PAUSE_MS`) (4) ตอบรับ (5) ระหว่างพัก ข้อความพิมพ์อิสระถูก `recordSupportFollowUp` เก็บเป็น `LineSupportMessage` รูปและไฟล์ถูกเก็บด้วย `storeSupportMedia` (6) ออกจากการพักด้วย `คุยกับน้องมั่งมี` (กดหรือพิมพ์) หรือคำพ้อง `คุยกับ AI ต่อ`, `ให้ AI ตอบ`, `คุยกับ AI`, `คุยกับมั่งมี` → `handleAssistantResume`
- **กฎธุรกิจและข้อยกเว้น**
  - กันซ้ำต่อคำขอที่ยังมีชีวิต (`OPEN` และ `ANSWERED`) ไม่ใช่ต่อวัน กดซ้ำไม่เรียกทีมงานซ้ำ แต่ต่ออายุการพัก
  - เพดานกันการปั่น: เปิดคำขอใหม่ได้ 3 ครั้งต่อวันต่อ LINE account ครั้งที่ 4 ได้คำตอบอบอุ่นและไม่เขียนอะไร และไม่ถูกพัก AI
  - การพักหยุดเฉพาะข้อความอิสระ คำสั่งที่ตอบด้วยโค้ด (`/companies`, `เมนูหลัก`, `ถ่ายใบเสร็จ`, `บริการของเรา`, ปุ่มยืนยันแก้ร่าง) ยังทำงาน
  - ข้อความตอบรับเต็มพูดครั้งเดียวต่อ 10 นาที (`SUPPORT_FOLLOW_UP_REPLY_INTERVAL_MS`) ระหว่างนั้นตอบสั้น `📮 รับข้อความแล้วค่ะ` ข้อความยังถูกบันทึกทุกครั้ง
  - ขีดจำกัดต่อคำขอ: 500 ข้อความ, 50 ไฟล์ (`SUPPORT_THREAD_MAX_MESSAGES`, `SUPPORT_THREAD_MAX_MEDIA`), ข้อความในเธรดไม่เกิน 2,000 ตัวอักษร, สรุปบนแถวไม่เกิน 200 ตัวอักษร (ลดข้อมูลส่วนบุคคลตามหลัก PDPA)
  - media ที่รับไว้ระหว่างพักไม่ถูกส่งเข้า AI ย้อนหลังเมื่อกลับมา (`assistantPausedAtAcceptance`)
  - ปุ่ม `ติดต่อเจ้าหน้าที่` บนการ์ดเปิด OA ทีมงาน (`STAFF_OA_URL`) ส่วนคำที่พิมพ์เข้ากล่องข้อความ (มติเจ้าของ 2026-09-29)
- **การตรวจข้อมูล/ข้อผิดพลาด** ข้อความสำคัญอยู่ในตารางหัวข้อ 12.2 สถานะคำขอเปลี่ยนระหว่างทาง → `line_support_state_changed` (409 ภายใน)
- **ข้อมูล** `LineSupportRequest`, `LineSupportMessage`, `LineSupportMessageBlob`, `LineCompanyContext`
- **API** ฝั่ง LINE ไม่มี endpoint ใหม่; ผู้ดูแลตอบผ่านกล่องข้อความ `/system` (audit action `system.support_request.*` ใน `external-signup/domain/support-request.constants.ts`) และ `POST /v1/system/partners/:partnerCompanyId/line-message` (`system.partner_company.update`)
- **หน้าจอ** กล่องข้อความสนับสนุนของผู้ดูแลระบบ (SRS ผู้ดูแล)
- **การทดสอบ** `process-line-webhook.use-case.spec.ts`, `line-ai/application/line-message-buffer.service.spec.ts`, `e2e/line-recovery.spec.ts`; spec ต้นทาง `docs/specs/line-support-request-spec-th.md` (อ้างในคอมเมนต์)

---

## 7. กลุ่ม E — รูป ไฟล์ และเอกสาร

### FR-LINE-050 ส่งรูปหรือไฟล์ใบเสร็จผ่าน LINE เพื่อสร้างร่างรายจ่าย

- **คำอธิบาย** ผู้ใช้ส่งรูปใบเสร็จ บิล สลิป หรือไฟล์ PDF ระบบอ่านด้วย AI แล้วสร้างร่างรายจ่ายให้ตรวจ ไม่ยืนยันหรือจ่ายเงินอัตโนมัติ
- **ผู้ใช้/permission** `expense.receipt.line_upload` หรือ `expense.receipt.upload` หรือ `expense.create` (ตามที่ quick reply ใช้); รายละเอียดสิทธิ์การบันทึกอยู่ในโมดูล expenses
- **แพ็ก** P-ALL และ P-FREE (`expenses.upload`); จำนวนใบต่อเดือนตามแพ็ก: FREE 3, STARTER 30, BASIC 50, PRO 100, ENTERPRISE 500 (`PLAN_TIER_PRESETS.monthlySlipLimit`) บวก add-on `RECEIPT_IMAGE_20/50/100`
- **เงื่อนไขก่อนทำ** PRE-BOUND; ไม่ได้อยู่ในบทสนทนากับเจ้าหน้าที่ (ถ้าอยู่ รูปถูกเก็บเข้าคำขอแทน)
- **ขั้นตอนหลัก** (`executeReceiptUploadInner`, `:11498`) (1) ตอบรับการ์ด "กำลังสแกน" ทันที (FR-LINE-006) (2) ด่าน opt-out, ร้านล็อก, สิทธิ์ และ feature ก่อนดาวน์โหลดไบต์ (3) ดาวน์โหลดเนื้อหาจาก LINE ตรวจชนิดและความปลอดภัยของไฟล์ (4) รูป JPEG/PNG ผ่านตัวอ่านเอกสารหนึ่งครั้งเพื่อจำแนกประเภทเอกสารธุรกิจ (`decideLineBusinessDocument`) (5) `admitCompanyOcr` จองสิทธิ์อ่านของแพ็กแบบ atomic (6) เรียก gateway `receipt-ocr` (หรือสายงาน capture-read / capture-extract สำหรับไฟล์) (7) สร้างร่างรายจ่าย (`captureSource = LINE_UPLOAD`, เก็บ `chatKeyHash` เพื่อให้แก้ได้เฉพาะจากแชตนี้) (8) ตอบการ์ดร่าง `buildExpenseDraftCardMessage` / `buildExpenseDraftReviewCard` หมายเหตุ `รายการนี้เป็นร่าง ยังไม่ได้ยืนยันรายการ…`
- **กฎธุรกิจและข้อยกเว้น**
  - รูปที่ไม่มี caption คือรายจ่ายใหม่ เว้นแต่แชตเพิ่งถูกถามหาเอกสารชนิดนั้นพอดี
  - หลายรูปในกลุ่มเดียวอ่านตามลำดับ ตอบรับครั้งเดียว
  - ไฟล์ (PDF) อ่านแบบ async ผลมาเป็น push เมื่อ job เสร็จ ผ่าน `LineCaptureResultNotifierUseCase` และ `POST /internal/ai/line-capture-results/drain` (batch ไม่เกิน 25)
  - วันที่ของเอกสารที่อ่านไม่ได้ถือว่ายังขาด แม้คอลัมน์จะมีค่าวันอัปโหลด
  - การส่งรูปไม่เริ่มชุดคำถาม ข้อมูลที่ยังขาดแก้ต่อได้ด้วยข้อความหรือบนเว็บ
  - รูปซ้ำ (ไบต์เดียวกัน) แจ้งเตือนรายการซ้ำ
  - การอ่านที่ไม่พบใบเสร็จไม่ถูกคิดสิทธิ์ (คอมเมนต์ add-on plan PR B, D4/Q4) การอ่านที่ล้มเหลวคืนสิทธิ์ที่จองไว้
- **การตรวจข้อมูล/ข้อผิดพลาด** ข้อความสำคัญ: ดาวน์โหลดไม่ได้ `📷 น้องยังรับรูปจาก LINE ไม่สำเร็จค่ะ ยังไม่ได้บันทึกรายการใด ๆ จากรูปนี้นะคะ รบกวนส่งรูปเดิมอีกครั้งค่ะ` (ไฟล์ใช้คำว่า "ไฟล์" และ 📄); ประมวลผลไม่สำเร็จ `📷 ขออภัยค่ะ ระบบประมวลผลรูปนี้ไม่สำเร็จ รบกวนส่งรูปเดิมอีกครั้งนะคะ ถ้ารูปนี้เคยบันทึกไว้แล้ว ระบบจะแจ้งเตือนรายการซ้ำให้ค่ะ`; ร้านหลายสาขาที่เลือกสาขาให้ไม่ได้ `🧾 อ่านเอกสารได้แล้วค่ะ แต่บริษัทมีหลายสาขาและน้องเลือกให้เองไม่ได้ จึงยังไม่ได้บันทึกรายการนะคะ\nรบกวนบันทึกผ่านเว็บแอปแล้วเลือกสาขา หรือให้ผู้ดูแลตั้งสาขาประจำตัวให้คุณ` (error code `RECEIPT_BRANCH_SELECTION_REQUIRED`); โควตาครบ การ์ด `โควตาให้ AI อ่านรูปเดือนนี้ครบแล้ว 📄 ครบโควตาเดือนนี้` พร้อมปุ่ม `ดูแพ็กเกจ` และ `ขอเปลี่ยนแพ็กเกจ` (`RECEIPT_QUOTA_EXCEEDED`); เครดิต AI ปิดการอ่าน → การ์ดเครดิต (FR-LINE-115); ไฟล์ไม่ผ่านการตรวจความปลอดภัย → สถานะ `media_security_rejected`
- **ข้อมูล** `ExpenseRecord`, `AttachmentObject`, `LineIntakePendingMedia`, `CompanyOcrUsageEvent`, `CompanyOcrMonthlyUsage`, `ExpenseCaptureReadJob`, `ExpenseCaptureGroup`
- **API** gateway `POST /internal/ai/receipt-ocr`, `POST /internal/ai/capture-read`, `POST /internal/ai/capture-extract`, `POST /internal/ai/line-intake-route`; API `POST /v1/internal/ai/line-capture-results/drain`
- **หน้าจอ** เว็บ หน้าตรวจร่างรายจ่าย (ลิงก์จาก `expenseCaptureLink`)
- **การทดสอบ** `line-ai/receipt-reliability.pg.spec.ts`, `line-ai/onboarding-receipt-allowance.pg.spec.ts`, `line-ai/application/line-capture-delivery.pg.spec.ts`, `line-ai/application/use-cases/line-capture-result-notifier.use-case.spec.ts`, `line-ai/application/use-cases/line-capture-branch-default.spec.ts`, `line-ai/application/use-cases/process-line-webhook.demo-media.spec.ts`, `gw/line-ai/presentation/http/expense-capture-routes.spec.ts`, `e2e/journeys/plain-shop-records-everything.journey.spec.ts`
- **หมายเหตุ** กฎการอ่านใบเสร็จ การเติมฟิลด์ และการตรวจร่าง เป็นของ SRS รายจ่าย เอกสารนี้ครอบคลุมทางเข้าและข้อความตอบฝั่ง LINE

### FR-LINE-051 รูปที่ระบบยังไม่แน่ใจ: ถามกลับ เอกสารที่ไม่ใช่ใบเสร็จ และใบแจ้งยอด (check bill)

- **คำอธิบาย** รูปที่ไม่ชัดว่าเป็นใบเสร็จ หรือมี caption เป็นคำถาม ถูกเก็บไว้รอคำตอบของผู้ใช้ ไม่ทิ้งรูป
- **ผู้ใช้/permission** เหมือน FR-LINE-050
- **แพ็ก** P-ALL, P-FREE
- **เงื่อนไขก่อนทำ** PRE-BOUND
- **ขั้นตอนหลัก** `ensurePendingMedia` (`:13748`) สร้างแถว `LineIntakePendingMedia` แล้วถามผู้ใช้ด้วย `pendingMediaSelectionMessage` คำตอบ (`1`, `ใบเสร็จค่ะ` ฯลฯ) ถูกจัดการโดย `handlePendingMediaControl` และ `resolvePendingRow` ก่อนถึง AI
- **กฎธุรกิจและข้อยกเว้น** แถวรอมีอายุ `PENDING_MEDIA_TTL_MINUTES = 30` ระหว่างนั้นรูปใหม่ถูกตอบด้วยแถวเดิม (`duplicate_media_pending`) จึงบอกผู้ใช้ให้ "ตอบข้อความเดิมอีกครั้ง" ไม่ใช่ส่งรูปใหม่ (`ไฟล์เดิมยังเก็บไว้ให้อยู่ แล้วตอบข้อความเดิมอีกครั้งได้เลยค่ะ`) เอกสารที่ไม่ใช่ใบเสร็จจำแนกเป็นกรณี NR01–NR08 (`classifyNonReceiptCase`) กรณี NR01, NR02, NR03, NR08 เก็บเอกสารไว้ (`NON_RECEIPT_PERSISTING_CASES`) มีสัญญาณเฉพาะ `PARCEL_LABEL_SIGNAL`, `DEPOSIT_SLIP_SIGNAL` ใบแจ้งยอดร้านอาหารถามยอดที่พิมพ์ก่อนบันทึก (`resolvePendingCheckBillAction`) หลายเอกสารในภาพเดียวเป็นคำถาม ไม่รวมเป็นรายจ่ายเดียว
- **การตรวจข้อมูล/ข้อผิดพลาด** การอ่านล้มเหลว/อ่านได้บางส่วน/หยุดชั่วคราว ตอบด้วย `CAPTURE_READ_FAILED_REPLY`, `CAPTURE_READ_PARTIAL_REPLY`, `CAPTURE_READ_PAUSED_REPLY` พร้อมลิงก์ `กรอกข้อมูลต่อ` (`CONTINUE_IN_WEB_LABEL`)
- **ข้อมูล** `LineIntakePendingMedia`, `ExpenseRecord`, `AttachmentObject`
- **API** — **หน้าจอ** หน้าตรวจร่างของเว็บ
- **การทดสอบ** `line-ai/application/line-pending-media.pg.spec.ts`, `line-ai/domain/logic/line-non-receipt-reply.logic.spec.ts`, `gw/line-ai/domain/logic/business-document-classification.logic.spec.ts`

### FR-LINE-052 ถามผลของไฟล์ที่เพิ่งส่ง และปุ่มอ่านซ้ำ

- **คำอธิบาย** ผู้ใช้ถาม "ไฟล์เมื่อกี้ทำไมส่งไม่ได้" หรือ "รูปเมื่อกี้ถึงไหนแล้ว" ระบบตอบจากบันทึกความพยายามของไฟล์ ไม่เดา
- **ผู้ใช้/permission** เจ้าของไฟล์ในแชตนั้น
- **แพ็ก** P-ALL (`expenses`)
- **เงื่อนไขก่อนทำ** PRE-BOUND
- **ขั้นตอนหลัก** `receiptStatusQuestion` จำแนก (`receipt` / `contextual` / `file_attempt`) → `answerFileAttemptQuestion` (`:12821`) อ่านความพยายามย้อนหลัง 24 ชั่วโมง → `fileAttemptAnswer` หลายไฟล์ถาม `หมายถึงไฟล์ไหนคะ` พร้อมรายการให้เลือก โมเดลเรียก tool `line.explain_file_attempt` ได้เช่นกัน
- **กฎธุรกิจและข้อยกเว้น** เหตุผลถูกบันทึกก่อนลบ payload จึงตอบได้แม้ไบต์ไม่ถูกเก็บ ปุ่มอ่านซ้ำ (`file_read_retry`) เรียก `retryStoredFileRead` กับไฟล์ที่เก็บไว้แล้ว ไม่ต้องส่งใหม่ ความคืบหน้าใช้ป้ายจาก `receiptProgressLabel`
- **การตรวจข้อมูล/ข้อผิดพลาด** ไม่มีบันทึก → `FILE_ATTEMPT_NONE_REPLY`; ค้นไม่สำเร็จ → `FILE_ATTEMPT_LOOKUP_FAILED_REPLY`; การปฏิเสธจากการตรวจไฟล์ → `fileInspectionRefusalReply`
- **ข้อมูล** `LineWebhookEventLog`, `LineIntakeAttempt`, `ExpenseCaptureReadJob`
- **API** tool `line.explain_file_attempt`
- **หน้าจอ** —
- **การทดสอบ** `line-ai/domain/logic/line-file-attempt-answer.logic.spec.ts`

### FR-LINE-053 แนบสลิปเป็นหลักฐานการจ่ายของรายจ่ายที่มีอยู่

- **คำอธิบาย** สลิปโอนเงินที่ส่งมาถูกผูกเป็นหลักฐานการจ่ายของรายจ่ายที่ยืนยันแล้ว แทนที่จะสร้างรายจ่ายซ้ำ
- **ผู้ใช้/permission** ผู้มีสิทธิ์บันทึกจ่าย (ดู FR-LINE-067)
- **แพ็ก** P-ALL
- **เงื่อนไขก่อนทำ** PRE-BOUND + PRE-AI (intake route `EXPENSE_PAYMENT_EVIDENCE_LINK`)
- **ขั้นตอนหลัก** `deliverPaymentEvidence` (`:12964`) เรียก use case `link-line-payment-evidence` ของโมดูล expenses ผลชนิด `ASK` ให้ผู้ใช้เลือกรายการ (แบ่งหน้าได้ด้วย `paymentEvidencePage`) คำตอบถูกจัดการโดย `handlePaymentEvidenceText` และ postback ของ `linePaymentEvidencePostbackCommand`
- **กฎธุรกิจและข้อยกเว้น** การผูกหลักฐานและการเปิดการ์ดบันทึกจ่ายตรวจสิทธิ์ใหม่เมื่อกด (อยู่ใน `INLINE_REAUTHORIZED_ACTIONS`)
- **การตรวจข้อมูล/ข้อผิดพลาด** ผูกไม่ได้ → `ยังแนบสลิปจ่ายไม่ได้ค่ะ กรุณาลองบันทึกจ่ายอีกครั้ง`
- **ข้อมูล** `ExpenseRecord`, `AttachmentObject`
- **API** — **หน้าจอ** หน้ารายจ่ายของเว็บ
- **การทดสอบ** spec ของ `link-line-payment-evidence.use-case` ในโมดูล expenses (ไม่ได้เปิดตรวจ)

### FR-LINE-054 ถามคำถามเกี่ยวกับเอกสารที่ส่งมา (Document QA)

- **คำอธิบาย** ผู้ใช้ส่งไฟล์หรือรูปพร้อมคำถามเกี่ยวกับเนื้อหา ระบบอ่านหน้าที่เลือกและตอบโดยอ้างข้อความที่มองเห็นในเอกสาร ไม่บันทึกเป็นรายจ่าย
- **ผู้ใช้/permission** ผู้ใช้ที่ผูกบัญชีและผ่าน PRE-AI
- **แพ็ก** P-ALL
- **เงื่อนไขก่อนทำ** `LINE_AI_DOCUMENT_QA_ENABLED=true` (ค่าเริ่มต้น), แชตส่วนตัว
- **ขั้นตอนหลัก** (1) `routeDocumentQuestionBeforeCapture` (`:13397`) แยกคำถามเอกสารออกจากการบันทึก (2) `LineDocumentQaService` สร้าง `LineDocumentQaJob` (`QUEUED` → `READING` → `ANSWER_READY` / `FAILED` / `EXPIRED` / `CANCELED`) (3) พยายามตอบใน foreground 40 วินาที (`LINE_DOCUMENT_QA_FOREGROUND_MS`) ถ้าไม่ทันส่งความคืบหน้าแล้วให้ worker ทำต่อ (4) gateway `POST /internal/ai/line-document-qa` เรียกโมเดล (timeout ผู้ให้บริการ 45 วินาที, output ไม่เกิน 3,000 token) (5) `deliverDocumentQaResult` ส่งคำตอบ `recoverDocumentQaResults` กู้ผลที่ยังไม่ได้ส่ง
- **กฎธุรกิจและข้อยกเว้น** ขีดจำกัด (`LINE_DOCUMENT_QA_LIMITS`): ไฟล์แนบ 5, หน้าที่เลือก 20, หน้า PDF ต่อไฟล์ 20, ไฟล์ละ 10 MB, คำตอบ 32 KB, คำถาม 48 KB ชนิดไฟล์: JPEG, PNG, WebP, PDF อายุ job 15 นาที, lease 120 วินาที, เก็บผล 24 ชั่วโมง แล้วขอลบไฟล์ดิบ (event `line.document_qa.raw_cleanup_requested`) เวลารอของ API ต่อ gateway = 2 × 45 วินาที + 10 วินาที
- **การตรวจข้อมูล/ข้อผิดพลาด** อ่านหน้าไม่ได้ → `ยังอ่านหน้าที่เลือกไม่ได้ จึงยั…` (`LINE_DOCUMENT_QA_UNREADABLE_ANSWER`) คำถามเอกสารที่ฝังในงานอื่นถูกปฏิเสธด้วย `refuseEmbeddedDocumentQa`
- **ข้อมูล** `LineDocumentQaJob`, `AttachmentObject`
- **API** gateway `POST /internal/ai/line-document-qa`; API `POST /v1/internal/ai/line-document-qa/drain`
- **หน้าจอ** —
- **การทดสอบ** `line-ai/application/line-document-qa.pg.spec.ts`, `line-ai/application/use-cases/process-line-document-qa.bridge.spec.ts`, `gw/line-ai/application/document-qa.integration.spec.ts`, `packages/contracts/src/line-document-qa.spec.ts`

### FR-LINE-055 ส่งรูปลายเซ็นเข้าคลังลายเซ็น

- **คำอธิบาย** ผู้ใช้ส่งรูปลายเซ็นของตัวเองเพื่อใช้กับใบรับรองแทนใบเสร็จ
- **ผู้ใช้/permission** ผู้ที่ `maySubmitSignature(permissions)` ผ่าน (รายการ permission ไม่ได้ตรวจละเอียด)
- **แพ็ก** P-ALL (`expenses.signatures`)
- **เงื่อนไขก่อนทำ** PRE-BOUND + PRE-AI (intake route `SIGNATURE_UPLOAD_TICKET`)
- **ขั้นตอนหลัก** `createLineSignatureAsset` (`:13877`) เก็บรูปเป็นลายเซ็นที่บันทึกไว้ ถ้าข้อความขออัปโหลดลายเซ็นแต่ไม่มีรูปมาด้วย ระบบขอเฉพาะรูป
- **กฎธุรกิจและข้อยกเว้น** รูปลายเซ็นต้องถึงคลังแม้ router ตอบไม่ได้ (คอมเมนต์ A4): เมื่อไม่มี route ใดถูกเลือกและ caption มีคำว่า `ลายเซ็น` ระบบเก็บเข้าคลังแทนการส่งไปทางบันทึกรายจ่าย
- **การตรวจข้อมูล/ข้อผิดพลาด** —
- **ข้อมูล** ลายเซ็นที่บันทึก (โมดูล expenses signatures)
- **API** — **หน้าจอ** เว็บ `expenses/signatures` ("หน้าลายเซ็นของฉันบนเว็บ")
- **การทดสอบ** ไม่ได้ระบุ spec เฉพาะ (ไม่ได้ตรวจละเอียด)

### FR-LINE-056 ใบรับรองแทนใบเสร็จ: เตรียมและทำต่อผ่านแชต

- **คำอธิบาย** ผู้ใช้เริ่มหรือทำต่อใบรับรองแทนใบเสร็จรับเงินของรายจ่ายที่ไม่มีใบเสร็จ การลงนามและการอนุมัติทำบนเว็บ
- **ผู้ใช้/permission** หนึ่งใน `expense.read`, `expense.read_own`, `expense.read_related`, `expense.review`, `expense.confirm` (`mayOfferWorkflow` กรณี `substitute_receipt`)
- **แพ็ก** P-ALL (`expenses`)
- **เงื่อนไขก่อนทำ** PRE-BOUND + PRE-AI
- **ขั้นตอนหลัก** คำสั่ง `ทำใบรับรองแทนใบเสร็จ` (ตัวจำแนก label `substitute_receipt` หรือคำสั่งตรงตัว) → `deliverSubstituteWorkflow` / `continueSubstituteWorkflow` → `LineSubstituteReceiptActionService` เตรียมผ่าน use case เดิมของโมดูล expenses รูปที่ส่งระหว่างงานนี้ถูกจัดกับงาน (`handleSubstituteMediaArrival`, `attachSubstituteMedia`, `linkSubstituteScan`)
- **กฎธุรกิจและข้อยกเว้น** การ์ดลงนามและอนุมัติเป็นการนำทางไปเว็บเท่านั้น (`webOnly`) เพราะต้องอ่านเอกสารทั้งฉบับก่อนลงนาม (`LINE_ACTION_RULES` ใน gateway scope policy) สวิตช์ `LINE_AI_SUBSTITUTE_SEMANTIC_ROUTING_MODE` ค่าเริ่มต้น `off` ใช้การดักด้วย regex แบบเดิมก่อน router โหมด `primary` ให้ intake route `SUBSTITUTE_RECEIPT_CONTINUATION` ตัดสิน คำถาม "ต้องทำยังไงต่อ" ระหว่างงานนี้ถือเป็นคำถามเกี่ยวกับงาน ไม่ใช่คำถามใหม่
- **การตรวจข้อมูล/ข้อผิดพลาด** ถามกลับเมื่อกำกวม: `ต้องการทำใบรับรองแทนใบเสร็จรับเงินต่อ หรือ…` (`SUBSTITUTE_CLARIFY_FALLBACK`)
- **ข้อมูล** เอกสารใบรับรองแทนใบเสร็จและรายจ่าย (โมดูล expenses)
- **API** tool `expense.list_substitute_receipts_to_sign`
- **หน้าจอ** เว็บ `expenses/substitute-receipts`
- **การทดสอบ** `scripts/line-ai-substitute-routing.corpus.ts` + `.spec.ts`, `line-ai/application/use-cases/erp-substitute-receipt-tools.use-case.spec.ts`

---

## 8. กลุ่ม F — งานที่สั่งทำผ่านแชต (workflow)

### 8.1 หลักร่วมของทุก workflow

รายการ workflow ที่ขาย (`LINE_WORKFLOW_IDS`, `packages/contracts/src/line-ai.ts:2271`) มี 14 ตัว: `reimbursement_claim`, `reimbursement_submit`, `reimbursement_cancel`, `approvals`, `reimbursement_reject`, `reimbursement_pay`, `expense_submit`, `expense_confirm`, `expense_delete`, `expense_void`, `expense_pay`, `payment_voucher`, `wht_certificate`, `substitute_receipt`

กฎที่ใช้กับทุกตัว:

1. **เสนอเมื่อมีสิทธิ์** `mayOfferWorkflow` ต้องผ่าน: ร้านมี feature `expenses`, ไม่ใช่โหมดใช้ฟรี และผู้ใช้มี permission ตามตาราง 8.2
2. **เตรียมก่อน เขียนทีหลัง** ทุกงานจบที่การ์ดตรวจทาน (`buildExpenseActionCard`) การเขียนเกิดเมื่อผู้ใช้กดปุ่ม postback `expense_action_confirm` (หรือปุ่มเฉพาะ `expense_action_approve` / `_reject` / `_submit` / `_wht`) ซึ่งพก token ลงลายเซ็น API ตรวจลายเซ็นแล้วเรียก use case เดียวกับเว็บ รวมทุกด่านของเว็บ
3. **เลือกรายการ** ถ้าไม่ระบุรายการ ระบบแสดงตัวเลือก (`buildClaimWorkflowPicker`, `buildExpenseWorkflowPicker`) จากรายการที่ผู้ใช้มีสิทธิ์ทำงานนั้น ผู้ใช้ตอบด้วยลำดับ (`อันแรก`, `ใบที่ 2`, `ข้อ 3`), เลขเอกสารหรือเลขท้าย, ชื่อผู้เบิก, ยอด, รอบ, หรือสาขา (`lineWorkflowPickerText`)
4. **เปิดจากปุ่ม** ปุ่มบนการ์ดใช้ `wf_open` พร้อม `sig` = ลายเซ็นของ (บริษัท, ผู้ใช้, act, id, วิธีจ่าย, วันที่, ยอด) ตรวจด้วย `verifyLineWorkflowOpenSig` ปุ่มเลือกงานใช้ `wf_choice` พร้อม token
5. **อายุของการ์ด** preview หมดอายุใน 600 วินาที (`LINE_DRAFT_PREVIEW_TTL_SECONDS`) การ์ดที่หมดอายุกดแล้วได้ทางกู้ (`expiredRecovery`) ข้อมูลเปลี่ยนระหว่างรอ → `รายการเปลี่ยนไปแล้วค่ะ ขอเตรียมการ์ดใหม่ก่อนยืนยันอีกครั้ง`
6. **พักงาน** ผู้ใช้พิมพ์ `ไว้ก่อน`, `พักเรื่องนี้` ฯลฯ (`isLineWorkflowPutOff`) หรือกด `ไม่ทำ` งานถูกพัก ไม่ถูกตีความเป็นเหตุผลของการยกเลิกหรือการไม่อนุมัติ (`handleWorkflowPutOff`, `:3992`)
7. **คำลงท้ายไม่ใช่ข้อมูล** `stripLineFieldParticles` ตัด `ค่ะ/ครับ/นะ…` ออกจากค่าที่เก็บ โดยอาศัยตัวตัดคำไทย ไม่ตัดพยางค์ท้ายของคำจริง
8. **เครดิต** คำสั่ง workflow ที่พิมพ์เป็น turn ใหม่ต้องผ่านด่านเครดิตก่อนเริ่มหรือถูกปฏิเสธ (คอมเมนต์ R13) คำตอบของช่องที่กำลังถามอยู่ไม่จองเครดิตเพิ่ม
9. **ข้อผิดพลาดของ use case** ถูกแปลเป็นข้อความที่บอกวิธีแก้ผ่านตาราง `EXPENSE_ACTION_REFUSALS` (ประมาณ 60 รหัส, `line-expense-action.service.ts:128`) ไม่ echo exception ให้ลูกค้า

### 8.2 ตารางสิทธิ์และ action ของ workflow

| workflow id | ชื่อในเมนู | คำสั่งเริ่มจากเมนู | action ที่เตรียม | permission (ข้อใดข้อหนึ่ง) | แพ็ก |
|---|---|---|---|---|---|
| `reimbursement_claim` | สร้างใบเบิก | `ช่วยสร้างใบเบิกให้หน่อย` | เก็บข้อมูล → ร่างใบเบิก | `reimbursement.create` (ตามตัว tool) | P-ALL |
| `reimbursement_submit` | ส่งใบเบิกอนุมัติ | `ช่วยส่งใบเบิกอนุมัติให้หน่อย` | `REIMBURSEMENT_SUBMIT` | permission ของ action นั้นใน `LINE_CHAT_ACTIONS` | P-ALL |
| `reimbursement_cancel` | ยกเลิกใบเบิก | `ช่วยยกเลิกใบเบิกให้หน่อย` | `REIMBURSEMENT_CANCEL` | `reimbursement.cancel_own`, `reimbursement.finance_review` | P-ALL |
| `approvals` | อนุมัติใบเบิก | `ขอดูใบเบิกที่รอฉันอนุมัติ` | `REIMBURSEMENT_APPROVE` | `reimbursement.approve` หรือเป็นผู้อนุมัติที่กำหนด | P-ALL |
| `reimbursement_reject` | ไม่อนุมัติใบเบิก | `ช่วยไม่อนุมัติใบเบิกให้หน่อย` | `REIMBURSEMENT_REJECT` | `reimbursement.reject` หรือเป็นผู้อนุมัติที่กำหนด | P-ALL |
| `reimbursement_pay` | บันทึกจ่ายคืนใบเบิก | `ช่วยบันทึกจ่ายคืนใบเบิกให้หน่อย` | `REIMBURSEMENT_RECORD_PAYMENT` | permission ของ action | P-ALL |
| `expense_submit` | ส่งตรวจค่าใช้จ่าย | `ช่วยส่งตรวจค่าใช้จ่ายให้หน่อย` | `MARK_READY` | `expense.review`, `expense.update` | P-ALL |
| `expense_confirm` | ยืนยันค่าใช้จ่าย | `ช่วยยืนยันรายการค่าใช้จ่ายให้หน่อย` | `CONFIRM` | permission ของ action | P-ALL |
| `expense_delete` | ลบร่างค่าใช้จ่าย | `ช่วยลบร่างค่าใช้จ่ายให้หน่อย` | `DELETE_DRAFT` | `expense.delete`, `expense.update` | P-ALL |
| `expense_void` | ยกเลิกค่าใช้จ่าย | `ช่วยยกเลิกรายการค่าใช้จ่ายให้หน่อย` | `VOID` | permission ของ action | P-ALL |
| `expense_pay` | บันทึกจ่ายค่าใช้จ่าย | `ช่วยบันทึกจ่ายค่าใช้จ่ายให้หน่อย` | `RECORD_PAYMENT` | permission ของ action | P-ALL |
| `payment_voucher` | สร้างใบเตรียมจ่าย | `ช่วยสร้างใบเตรียมจ่ายให้หน่อย` | `VOUCHER_CREATE` (+ `SUBMIT`/`APPROVE`/`RETURN`/`PAY`/`CANCEL`) | permission ของ action (`expense.disbursement.*`) | P-ALL |
| `wht_certificate` | ออก 50 ทวิ | `ช่วยออก 50 ทวิให้หน่อย` | `WHT_CERTIFICATE_ISSUE` | `wht.certificate.issue` และร้านมี `wht_50bis` | P-ENT |
| `substitute_receipt` | ทำใบรับรองแทนใบเสร็จ | `ช่วยทำใบรับรองแทนใบเสร็จให้หน่อย` | เตรียมเอกสาร (FR-LINE-056) | `expense.read*`, `expense.review`, `expense.confirm` | P-ALL |

ช่อง "permission ของ action" หมายถึงค่า `permission` ของรายการนั้นใน `LINE_CHAT_ACTIONS` (`packages/contracts/src/ai-tools.ts:262–292`) ซึ่งผู้เขียนไม่ได้คัดลอกค่าทุกตัว เพราะบรรทัดถูกตัดในผลค้น ให้อ่านจากไฟล์ต้นทาง

### FR-LINE-060 ตัวจำแนกงาน (workflow classifier) หนึ่งการเรียกต่อข้อความ

- **คำอธิบาย** ข้อความพิมพ์ใหม่ถูกจำแนกด้วยการเรียกโมเดลหนึ่งครั้งที่บังคับ schema แล้วโค้ดเป็นผู้ดำเนินงานต่อ
- **ผู้ใช้/permission** ผู้ใช้ที่ผ่าน PRE-AI
- **แพ็ก** P-ALL
- **เงื่อนไขก่อนทำ** แชตส่วนตัว, ไม่มีงานค้างที่ข้อความนี้กำลังตอบ, ไม่มีร่างจากการสแกนเปิดอยู่ (ตัวจำแนกหลบให้งานนั้น, คอมเมนต์ R29)
- **ขั้นตอนหลัก** (1) API ออก grant ชนิด `webhook_classify` โปรไฟล์ `line-classify/2` (input ≤ 24,576 token, output ≤ 1,024, เรียกได้ ≤ 2 ครั้ง) (2) `POST /internal/ai/line-workflow-classify` (3) `WorkflowClassifierAgent.classify` (`gw/line-ai/agents/workflow-classifier.agent.ts`) ส่ง system prompt คงที่ (ใช้ร่วมทุกร้านเพื่อ cache) กับข้อความผู้ใช้ `maxTokens: 256`, usageTag `line.workflow-classify`, schema `line_workflow_classifier` (4) ผล: `label`, `second_label`, `confidence`, `second_confidence`, `reference` (`this`/`last_shown`/`named`/`none`), `ordinal` (0–9) และ slot ข้อความ 7 ช่อง (`person_name`, `vendor_name`, `description_text`, `amount_text`, `date_text`, `reason_text`, `category_text`) (5) `tryWorkflowClassify` (`:4200`) ตัดสิน: label เป็น workflow → `startClassifiedWorkflow`; `multi` → ตัวเลือกงาน; `read`/`howto`/`open`/`smalltalk`/`unclear` → ทางเดิม (intake router และ AI turn)
- **กฎธุรกิจและข้อยกเว้น** label ทั้งหมด = 14 workflow + `read`, `howto`, `open`, `smalltalk`, `multi`, `unclear` เส้นตายรวม 5 วินาที (หรือ `workDeadlineAtMs` ของ grant ถ้าสั้นกว่า) ถ้าครั้งแรกยังไม่ตอบที่ 2.2 วินาทีและเหลือเวลา ≥ 1.5 วินาที ยิงครั้งที่สองแข่ง (hedge) คำตอบแรกที่ผ่านการตรวจชนะ อีกเส้นถูกยกเลิก slot ข้อความต้องเป็น substring ตรงตัวของข้อความผู้ใช้ มิฉะนั้นถูกล้าง `amount_text` และ `date_text` ต้องตรงกับ candidate ที่โค้ดสกัดเอง (`extractValueCandidatesV2`) `ordinal` นอกช่วง 0–9 ถือว่าไม่ได้ระบุ ("รอบ 11" คือรอบใบเบิก ไม่ใช่การเลือก) ตัวจับคำสั่งเชิงคำ (`lineWorkflowCommand`, `lineWorkflowListOpener`) ทำงานหลังตัวจำแนก เป็นพื้นรองเมื่อโมเดลไม่ตอบ และใช้ก่อนด่านรับเข้ากับตอนผู้ใช้เปลี่ยนงาน
- **การตรวจข้อมูล/ข้อผิดพลาด** `UNAVAILABLE` พร้อม `errorCode`: `AI_CONTRACT_UNSUPPORTED` (grant ผิดชนิด หลักฐาน input ไม่ผ่าน หรือ candidate ไม่ครบ), `PROVIDER_TIMEOUT`, `PROVIDER_OUTPUT_INCOMPLETE`, รหัสของผู้ให้บริการ output ที่ถูกตัด (`max_tokens`), ถูกบล็อก, ไม่ผ่าน schema, หรือ confidence นอกช่วง ไม่ถูกรับ usage ของการเรียกที่ไม่สำเร็จถูกทำเครื่องหมาย `ok: false` (ไม่คิดเงิน, FR-LINE-114)
- **ข้อมูล** `AiBudgetReservation`, `AiUsageEvent`, `LineAiTaskRun`
- **API** gateway `POST /internal/ai/line-workflow-classify`
- **หน้าจอ** —
- **การทดสอบ** `line-ai/domain/logic/line-ai-classifier.spec.ts`, `scripts/line-ai-expense-advisor/corpus.workflow.tuning.json` (หัวข้อ 14), `docs/plans/line-ai-workflow-first-plan.md`

### FR-LINE-061 เริ่มงานจากเมนู จากคำสั่งพิมพ์ และตัวเลือกงาน

- **คำอธิบาย** ผู้ใช้เริ่ม workflow ได้ 3 ทาง: ปุ่ม `chat-action`, คำสั่งพิมพ์, หรือเลือกจากการ์ดเมื่อข้อความมีหลายงาน
- **ผู้ใช้/permission** ตามตาราง 8.2
- **แพ็ก** ตามตาราง 8.2
- **เงื่อนไขก่อนทำ** PRE-BOUND + PRE-AI
- **ขั้นตอนหลัก** `mayStartWorkflow` / `mayChooseWorkflow` ตรวจสิทธิ์ → `handleWorkflowChoice` (`:4087`) หรือ `startNamedWorkflowTarget` (`:4678`) → `LineWorkflowTargetService` หารายการเป้าหมาย → ตัวเลือกหรือการ์ดตรวจทาน
- **กฎธุรกิจและข้อยกเว้น** คำถามไม่เริ่มงาน (`lineWorkflowPickerText().question`: มี `?`, `ไหม`, `สถานะ`, `ถึงไหนแล้ว` ฯลฯ) คำขอนับหรือรายการ (`กี่`, `เท่าไร`, `อะไรบ้าง`) เป็นการอ่าน เว้นแต่ขอให้ทำด้วย (`isLineWorkflowCountRead`) กริยาที่ถูกปฏิเสธ (`อย่าลบร่าง`, `ไม่ต้องยกเลิกใบเบิก`) ไม่เริ่มงาน หลายกริยาในประโยคเดียวไปตัวเลือกงาน ยกเว้น "ยืนยันแล้วบันทึกจ่าย" ที่รวมเป็น `expense_confirm` พร้อมจ่ายต่อ รองรับคำสะกดที่พบจริง: `คอนเฟิร์ม`/`confirm` = ยืนยัน, `คชจ.` = ค่าใช้จ่าย, `ปฏิเสธ` = ไม่อนุมัติ, `ใบเบก`, `อนุมัด`, `ลบล่าง` และคำอังกฤษ `approve/cancel/reject/submit/pay claim` รายการที่ขอเป็นลิสต์เพื่อทำงานเดียว ("เอาบิลรอยืนยันมาให้เลือก") เปิดตัวเลือกของงานนั้น (`lineWorkflowListOpener`)
- **การตรวจข้อมูล/ข้อผิดพลาด** ไม่มีสิทธิ์ → `refuseWorkflowStart` ตอบ `คุณยังไม่มีสิทธิ์ใช้ผู้ช่วยใน LINE ให้เจ้าของกิจการหรือผู้ดูแลร้านเปิดสิทธิ์ให้ค่ะ` พร้อมปุ่ม `บัญชีของฉัน` และบันทึกผลงานเป็น `REFUSED`
- **ข้อมูล** `LineAiTaskRun` (ผลของงาน: `OPEN`, `REFUSED` ฯลฯ)
- **API** — **หน้าจอ** —
- **การทดสอบ** `line-ai/domain/logic/line-ai-classifier.spec.ts`, `process-line-webhook.use-case.spec.ts`, `e2e/journeys/claim-declined-then-paid.journey.spec.ts`

### FR-LINE-062 สร้างใบเบิกผ่านแชต

- **คำอธิบาย** พนักงานบอกรายการที่สำรองจ่าย ระบบเก็บข้อมูลทีละช่องแล้วเตรียมร่างใบเบิกให้ตรวจและกดบันทึก
- **ผู้ใช้/permission** `reimbursement.create` (tool `reimbursement.draft.preview_create`)
- **แพ็ก** P-ALL (`reimbursement`)
- **เงื่อนไขก่อนทำ** PRE-BOUND + PRE-AI, `LINE_AI_REIMBURSEMENT_DRAFT_WRITE_ENABLED=true` (ค่าเริ่มต้น)
- **ขั้นตอนหลัก** (1) label `reimbursement_claim` หรือ intake route `REIMBURSEMENT_REQUEST_START` (2) ถ้าไม่ชัดว่าใครจ่าย ถามก่อนสิ่งอื่น: `รายการนี้ใครเป็นคนจ่ายคะ? ตอบกลับได้เลยว่า “เบิกคืน” หรือ “บริษัทจ่าย”` (ค่า `fundingSource` ต้องเป็น `EMPLOYEE_PAID` อย่างชัดเจนจึงไปต่อ) (3) เก็บข้อมูล: `เป็นค่าอะไรคะ`, `ยอดเท่าไรคะ` / `รายการนี้ยอดเท่าไรคะ`, หมวด, ใบเสร็จ (ปุ่ม `reimbursement_choice`: ส่งรูป / ไม่มีใบเสร็จ / เลือกหมวด) (4) `LineReimbursementDraftAdapterService` เรียก tool `reimbursement.draft.get_options` → `preview_create` / `preview_update` (5) การ์ด `buildReimbursementDraftMessages` ผู้ใช้กดยืนยัน → `handleReimbursementDraftControl` บันทึกร่าง
- **กฎธุรกิจและข้อยกเว้น** "เบิกบิลเมื่อกี้" หลังสแกนใบเสร็จใช้บิลนั้นเป็นแหล่งของใบเบิกโดยไม่เรียกโมเดลซ้ำ (`linkRecentClaimSource`) "ส่งใบเบิกเมื่อกี้ / ส่งใบเบิกนี้" คือคำสั่งส่ง ไม่ใช่การอ่าน ค่าที่เก็บเป็น span ตรงตัวของผู้ใช้และ candidate ยอดเงิน/วันที่ที่ API ตรวจแล้วเท่านั้น (`parseManualClaimLine`) สวิตช์ `LINE_AI_REIMBURSEMENT_SEMANTIC_MODE` ค่าเริ่มต้น `off`; โหมด `clarify_only` ตอบ `🧾 เข้าใจว่าต้องการเบิกคืนค่าใช้จ่ายที่จ่ายส่วนตัวไปก่อนค่ะ\nน้องมั่งมียังไม่ได้สร้างรายการ…`; โหมด `handoff` ส่งไปเว็บด้วย `น้องมั่งมียังไม่ได้สร้างรายการเบิกคืนให้นะคะ กรุณาเปิดหน้าเว็บเพื่อตรวจสอบและกรอกรายละเอ…`
- **การตรวจข้อมูล/ข้อผิดพลาด** ไม่มีสิทธิ์ → `🔒 ยังไม่สามารถส่งต่อการเบิกคืนค่าใช้จ่ายผ่าน LINE สำหรับบริษัทนี้ได้ค่ะ` ร่างเปลี่ยนระหว่างทาง → ข้อความใน `REIMBURSEMENT_DRAFT_CHANGED`
- **ข้อมูล** `ReimbursementRequest`, `ReimbursementLine`, ที่เก็บ preview
- **API** tools `reimbursement.draft.get_options`, `reimbursement.draft.preview_create`, `reimbursement.draft.preview_update`
- **หน้าจอ** เว็บ หน้าใบเบิก
- **การทดสอบ** `line-ai/application/line-reimbursement-draft-adapter.pg.spec.ts`, `line-ai/application/line-reimbursement-draft.service.spec.ts`, `line-ai/domain/logic/line-reimbursement-draft-card.logic.spec.ts`, `packages/contracts/src/line-reimbursement-draft.spec.ts`

### FR-LINE-063 ส่งใบเบิกเพื่ออนุมัติ และยกเลิกใบเบิก

- **คำอธิบาย** ผู้เบิกส่งใบเบิกที่ตรวจครบเข้าคิวอนุมัติ หรือถอนใบเบิกของตัวเอง
- **ผู้ใช้/permission** ตามตาราง 8.2 (`reimbursement_submit`, `reimbursement_cancel`)
- **แพ็ก** P-ALL
- **เงื่อนไขก่อนทำ** PRE-BOUND + PRE-AI; ใบเบิกมีอยู่แล้ว
- **ขั้นตอนหลัก** คำสั่งตัวอย่าง: `ส่งใบเบิกอนุมัติ`, `ส่งใบเบิกให้หัวหน้า`, `ส่งเลย`, `ยื่นเลย`, `submit it`; `ยกเลิกใบเบิก`, `ถอนใบเบิก`, `ดึงกลับใบเบิก` → เลือกใบ → การ์ดตรวจทาน → กดยืนยัน
- **กฎธุรกิจและข้อยกเว้น** การส่งใช้ด่านของเว็บทั้งหมด รวมบัญชีรับเงินคืนและ token (คอมเมนต์ `:393` ของ `line-expense-action.service.ts`) คำสั่งสั้น "ส่งเลย" หลังเพิ่งบันทึกหรือแสดงใบเบิกหมายถึงใบนั้น โดยใช้ตัวชี้จาก `quotedRecords` / `recentReads` ที่เซิร์ฟเวอร์ให้ โมเดลห้ามคิดรหัสเอง คำถามอย่างเดียวไม่ยกเลิกใบเบิก
- **การตรวจข้อมูล/ข้อผิดพลาด** ผ่านตาราง `EXPENSE_ACTION_REFUSALS`
- **ข้อมูล** `ReimbursementRequest`
- **API** tool `expense.action.preview` (action `REIMBURSEMENT_SUBMIT`, `REIMBURSEMENT_CANCEL`)
- **หน้าจอ** เว็บ หน้าใบเบิก
- **การทดสอบ** `process-line-webhook.use-case.spec.ts`, `e2e/journeys/claim-declined-then-paid.journey.spec.ts`

### FR-LINE-064 อนุมัติและไม่อนุมัติใบเบิก

- **คำอธิบาย** ผู้อนุมัติดูใบเบิกที่รอตน เลือกใบ ตรวจรายละเอียด แล้วอนุมัติหรือไม่อนุมัติพร้อมเหตุผล
- **ผู้ใช้/permission** `reimbursement.approve` / `reimbursement.reject` หรือเป็นผู้อนุมัติที่นโยบายกำหนด (`assignedClaimApprover`)
- **แพ็ก** P-ALL
- **เงื่อนไขก่อนทำ** PRE-BOUND + PRE-AI
- **ขั้นตอนหลัก** คำสั่งตัวอย่าง: `อนุมัติใบเบิกนี้`, `ให้ผ่าน`, `มีใบเบิกรออนุมัติไหม` (อย่างหลังเป็นรายการ); `ไม่อนุมัติใบเบิกนี้`, `ตีกลับ`, `ปัดตก`, `ไม่ให้ผ่าน` → ตัวเลือกใบ (หรือปุ่มบนการ์ดรออนุมัติ) → การ์ดตรวจทาน → ปุ่ม `expense_action_approve` / `expense_action_reject`
- **กฎธุรกิจและข้อยกเว้น** ปุ่มอนุมัติ/ไม่อนุมัติบนการ์ดรายการพก token จาก `reimbursementApprovalOpenToken` ผูกกับบริษัท ผู้ใช้ ใบเบิก และ action การกดเปิดเฉพาะการ์ดตรวจทาน เหตุผลของการไม่อนุมัติคัดลอกจากที่ผู้ใช้พิมพ์เท่านั้น คำว่า "รออนุมัติ" เป็นสถานะ ไม่ใช่คำสั่ง การเปลี่ยนนโยบายการอนุมัติหรือกำหนดผู้อนุมัติไม่ใช่งานนี้ (label `open`) การปฏิเสธที่ไม่มีลิงก์ถูกแก้ให้เปิดใบเบิกนั้นบนเว็บได้ (คอมเมนต์เดโม่ 2026-11-06)
- **การตรวจข้อมูล/ข้อผิดพลาด** ผู้ใช้ไม่ใช่ผู้อนุมัติของใบนั้น → ใบอยู่ในกลุ่ม `notAssigned` ของผลค้น ไม่เสนอให้ทำ
- **ข้อมูล** `ReimbursementRequest`
- **API** tools `reimbursement.list_pending_approvals`, `reimbursement.get_detail`, `expense.action.preview`
- **หน้าจอ** เว็บ `reimbursements?tab=approvals`
- **การทดสอบ** `line-ai/application/use-cases/erp-reimbursement-tools.use-case.spec.ts`, `e2e/journeys/claim-declined-then-paid.journey.spec.ts`

### FR-LINE-065 บันทึกจ่ายคืนใบเบิก

- **คำอธิบาย** ผู้จ่ายเงินบันทึกว่าได้โอนคืนผู้เบิกแล้ว พร้อมวิธีจ่าย วันที่ และหลักฐาน
- **ผู้ใช้/permission** ตามตาราง 8.2 (`reimbursement_pay`)
- **แพ็ก** P-ALL
- **เงื่อนไขก่อนทำ** ใบเบิกอนุมัติแล้วและพร้อมจ่าย
- **ขั้นตอนหลัก** คำสั่ง: `บันทึกจ่ายคืน`, `จ่ายคืนใบเบิก`, `โอนคืนผู้เบิก` หรือปุ่ม `บันทึกจ่ายคืน` (`reimbursementPaymentButton`) → ถามวิธีจ่าย `จ่ายด้วยเงินสด โอนเงิน บัตร หรือเช็คคะ` (ตอบด้วยปุ่มเดียว) → การ์ดตรวจทาน → ยืนยัน
- **กฎธุรกิจและข้อยกเว้น** แยกจาก `expense_pay`: "บันทึกจ่าย/จ่ายเงิน + ค่า…" ที่ไม่มีคำว่าใบเบิก/คืน/ผู้เบิก คือจ่ายรายจ่าย รายจ่ายที่อยู่ในใบเบิกต้องจ่ายผ่านใบเบิก (`claim_expense_settles_via_reimbursement`) ผู้ใช้หนึ่งคนอนุมัติและจ่ายเองได้ตามนโยบายร้าน (ดู SRS ใบเบิก) ลำดับในระบบคือ ส่ง → อนุมัติ → จ่าย → ลงนามรับ
- **การตรวจข้อมูล/ข้อผิดพลาด** วันที่จ่ายในอนาคต วิธีจ่ายไม่ถูกต้อง ยอดเกินคงเหลือ ผ่านข้อความใน `EXPENSE_ACTION_REFUSALS`
- **ข้อมูล** `ReimbursementRequest`, บันทึกการจ่าย
- **API** tool `expense.action.preview` (`REIMBURSEMENT_RECORD_PAYMENT`)
- **หน้าจอ** เว็บ หน้าใบเบิก
- **การทดสอบ** `e2e/journeys/claim-declined-then-paid.journey.spec.ts`

### FR-LINE-066 ส่งตรวจ ยืนยัน ลบร่าง และยกเลิกรายจ่าย

- **คำอธิบาย** การเปลี่ยนสถานะรายจ่ายผ่านแชต
- **ผู้ใช้/permission** ตามตาราง 8.2
- **แพ็ก** P-ALL
- **เงื่อนไขก่อนทำ** PRE-BOUND + PRE-AI
- **ขั้นตอนหลัก** คำสั่ง: `ส่งตรวจ`, `ส่งให้ตรวจ` (`MARK_READY`); `ยืนยันรายการนี้`, `คอนเฟิร์มบิล` (`CONFIRM`); `ลบร่าง`, `ลบร่างอันเมื่อกี้` (`DELETE_DRAFT`); `ยกเลิกรายการนี้เพราะซ้ำ` (`VOID`, ต้องมีเหตุผล) → เลือกรายการ → การ์ด → ยืนยัน
- **กฎธุรกิจและข้อยกเว้น** การยืนยันผ่าน validator ทุกตัวของเว็บ ถ้าขาดหมวด ระบบถามหมวดด้วยปุ่มหรือเสนอแก้ร่าง (FR-LINE-070) ถ้าขาดการตรวจหลักฐาน ระบบเสนอการ์ดตรวจหลักฐานก่อนเมื่อเป็นตัวขวางเดียวที่เหลือ รายจ่ายที่ยืนยันแล้วลบไม่ได้ ต้องยกเลิก (`expense_not_voidable` → `รายการนี้ยังยกเลิกไม่ได้ค่ะ ถ้ายังเป็นร่างให้กดลบร่าง`) การยกเลิกไม่มีเหตุผล → ถาม `ยกเลิกรายการนี้เพราะอะไรคะ` งวดบัญชีหรืองวดภาษีที่ล็อก → `รายการนี้ยังทำต่อไม่ได้ ให้ผู้ทำบัญชีตรวจจากหน้ารายการค่ะ`
- **การตรวจข้อมูล/ข้อผิดพลาด** ตาราง `EXPENSE_ACTION_REFUSALS`
- **ข้อมูล** `ExpenseRecord`, `ExpenseLine`
- **API** tool `expense.action.preview`
- **หน้าจอ** เว็บ หน้ารายจ่าย
- **การทดสอบ** `process-line-webhook.use-case.spec.ts`, `e2e/journeys/paid-expense-reopened.journey.spec.ts`

### FR-LINE-067 บันทึกจ่ายรายจ่าย

- **คำอธิบาย** บันทึกว่าจ่ายเงินให้ผู้ขายแล้ว เต็มจำนวนหรือบางส่วน
- **ผู้ใช้/permission** ตามตาราง 8.2 (`expense_pay`)
- **แพ็ก** P-ALL
- **เงื่อนไขก่อนทำ** รายจ่ายยืนยันแล้ว (`expense_payment_not_confirmed` → `ต้องยืนยันรายการก่อนบันทึกจ่ายค่ะ`)
- **ขั้นตอนหลัก** คำสั่ง: `บันทึกจ่ายค่าบริการค้างจ่าย`, `pay bill` → ระบุวิธีจ่าย (เงินสด/โอนเงิน/บัตร/เช็ค), วันที่, ยอด, เลขอ้างอิงธนาคาร → การ์ด → ยืนยัน ข้อความตอบช่องจ่ายถูกจัดการโดย `handleExpensePaymentText` (`:5058`)
- **กฎธุรกิจและข้อยกเว้น** "ยืนยันแล้วบันทึกจ่าย" ทำต่อเนื่อง: หลังยืนยันสำเร็จระบบเตรียมการ์ดบันทึกจ่ายให้ทันที (`recordPaymentAfterConfirm`) ยอดจ่ายบางส่วนเก็บตามที่ผู้ใช้บอก สลิปหรือคำถามอย่างเดียวไม่ใช่คำสั่ง การจ่ายที่มีหัก ณ ที่จ่ายแบบ e-WHT มีข้อจำกัดวิธีจ่าย (`E_WHT_WORDS['L-1']`)
- **การตรวจข้อมูล/ข้อผิดพลาด** `expense_payment_future_date`, `expense_payment_invalid_method`, `expense_payment_exceeds_outstanding`, `expense_payment_invalid_reference` (ไม่เกิน 128 ตัวอักษร), `expense_payment_idempotency_conflict` แต่ละรหัสมีข้อความบอกวิธีแก้
- **ข้อมูล** `ExpenseRecord` (`paidAmount`, `paidAt`), บันทึกการจ่าย
- **API** tool `expense.action.preview` (`RECORD_PAYMENT`)
- **หน้าจอ** เว็บ หน้ารายจ่าย
- **การทดสอบ** `e2e/journeys/paid-expense-reopened.journey.spec.ts`, `process-line-webhook.use-case.spec.ts`

### FR-LINE-068 ใบเตรียมจ่าย (ใบสำคัญจ่าย)

- **คำอธิบาย** รวมรายจ่ายที่ยืนยันแล้วของผู้รับเงินคนเดียวกันเป็นใบเตรียมจ่าย แล้วส่งอนุมัติ อนุมัติ ตีกลับ จ่าย หรือยกเลิก
- **ผู้ใช้/permission** permission กลุ่ม `expense.disbursement.*` (อ่าน: `expense.disbursement.read` สำหรับ tool `voucher.*`)
- **แพ็ก** P-ALL (`expenses`)
- **เงื่อนไขก่อนทำ** PRE-BOUND + PRE-AI
- **ขั้นตอนหลัก** คำสั่ง: `สร้างใบเตรียมจ่าย`, `ทำใบเตรียมจ่ายรายการนี้`, `ส่งอนุมัติใบเตรียมจ่ายที่มีบิล <เลข>` → ถามผู้รับเงินเมื่อยังไม่ชัด (`showVoucherVendorQuestion`) → `LineVoucherActionService` เตรียม `VOUCHER_CREATE` จาก `expenseId` หรือ `expenseIds` → การ์ด → ยืนยัน action ต่อเนื่อง: `VOUCHER_SUBMIT` (จากสถานะ `DRAFT`), `VOUCHER_APPROVE` (`PENDING_APPROVAL`), `VOUCHER_PAY` (`APPROVED`), `VOUCHER_RETURN`, `VOUCHER_CANCEL`
- **กฎธุรกิจและข้อยกเว้น** จำนวนบิลต่อใบไม่เกิน `DISBURSEMENT_VOUCHER_MAX_LINES`; tool รองรับ 30 บิล แต่ catalog ที่เสนอโมเดลจำกัด 20 จำนวนบิลที่ขอต้องมาจากข้อความของผู้ใช้อย่างชัดเจน ไม่ใช่จากโมเดล (`requestedVoucherBillCount`) `voucherId` คัดลอกจาก `shownItems` ของ tool `voucher.*` เท่านั้น ตีกลับและยกเลิกต้องมีเหตุผล หลังจ่ายใบที่มีหัก ณ ที่จ่าย ระบบเสนอออก 50 ทวิ (เฉพาะร้านที่มีสิทธิ์) รายจ่ายที่ถูกจองในใบเตรียมจ่ายแล้วยกเลิกไม่ได้จนกว่าจะนำออก (`expense_disbursement_reserved`)
- **การตรวจข้อมูล/ข้อผิดพลาด** ข้อความจาก `DISBURSEMENT_VOUCHER_ERROR_WORDS`
- **ข้อมูล** `DisbursementVoucher` (ชื่อ model หลักไม่ได้ตรวจ), `DisbursementVoucherLine`
- **API** tools `voucher.list_recent`, `voucher.get_detail`, `expense.action.preview`
- **หน้าจอ** เว็บ หน้าใบเตรียมจ่าย
- **การทดสอบ** `process-line-webhook.use-case.spec.ts`; รายละเอียดอยู่ใน SRS รายจ่าย

### FR-LINE-069 ออกหนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)

- **คำอธิบาย** ออก 50 ทวิจากใบเตรียมจ่ายที่จ่ายแล้วและมีการหักภาษี
- **ผู้ใช้/permission** `wht.certificate.issue`
- **แพ็ก** P-ENT (`wht_50bis`)
- **เงื่อนไขก่อนทำ** PRE-BOUND + PRE-AI; ใบเตรียมจ่ายที่จ่ายแล้ว
- **ขั้นตอนหลัก** คำสั่ง: `ออก 50 ทวิ`, `ออกหนังสือรับรองหัก ณ ที่จ่าย`, `ทำ 50 ทวิ` → เลือกรายการ → ตรวจชื่อ เลขผู้เสียภาษี และที่อยู่ของผู้ถูกหัก → การ์ด → ปุ่ม `expense_action_wht` / ยืนยัน
- **กฎธุรกิจและข้อยกเว้น** ขาดที่อยู่ผู้รับเงิน → ถามหนึ่งคำถามสั้น เซิร์ฟเวอร์เก็บคำตอบแล้วเตรียมการ์ด ผู้ออกบนเว็บเป็นเจ้าของเงื่อนไขก่อนทำทุกข้อ คำถามเรื่องอัตราภาษี ความหมายของเอกสาร หรือแบบยื่น ไม่ใช่คำสั่งออก (label `howto`) การคำนวณภาษีหัก ณ ที่จ่ายใช้ tool `wht.calculate_withholding` สรุปเดือนใช้ `wht.get_month_summary` (สรุป ภ.ง.ด.53: คำสั่ง `ขอสรุป ภ.ง.ด.53 เดือนนี้`)
- **การตรวจข้อมูล/ข้อผิดพลาด** หนังสือที่ออกแล้วขวางการยกเลิกรายจ่าย (`certificate_issued`)
- **ข้อมูล** หนังสือรับรองและ `WhtFilingLine`, `WhtCertificateHandoff` (รายละเอียดใน SRS ภาษี)
- **API** tools `wht.get_month_summary`, `wht.calculate_withholding`, `expense.action.preview` (`WHT_CERTIFICATE_ISSUE`)
- **หน้าจอ** เว็บ หน้า ภ.ง.ด.53 และ 50 ทวิ
- **การทดสอบ** ชุด corpus ช่วง "tax periods" ใน `corpus.workflow.tuning.json`; spec เฉพาะไม่ได้ระบุ

### FR-LINE-070 แก้ร่างรายจ่ายด้วยข้อความ (S-4 draft edit)

- **คำอธิบาย** ผู้ใช้สั่งแก้ร่างที่แชตนี้เพิ่งสร้าง เช่น เพิ่มค่าบริการ แก้ยอดบรรทัด ลบบรรทัด เปลี่ยนโหมด VAT ระบบแสดงผลต่างก่อน/หลัง แล้วรอการกดยืนยัน
- **ผู้ใช้/permission** `expense.update`
- **แพ็ก** P-ALL
- **เงื่อนไขก่อนทำ** `LINE_AI_DRAFT_EDIT_ENABLED=true` (ค่าเริ่มต้น) ทั้งใน API และ gateway; ร่างถูกสร้างจากแชตนี้ (ตรวจ `chatKeyHash`)
- **ขั้นตอนหลัก** (1) โมเดลเลือกหนึ่งใน 5 tool: `expense.draft.set_header` (วันที่ ผู้ขาย เลขเอกสาร หมายเหตุ หมวดของทุกบรรทัดที่ยังไม่มีหมวด), `expense.draft.set_line` (คำอธิบาย ยอด หมวด VAT ของหนึ่งบรรทัด หรือย้ายเป็นค่าใช้จ่ายเพิ่ม), `expense.draft.add_charge` (ค่าบริการ ค่าส่ง ค่าบรรจุ ค่าธรรมเนียม ทิป ปัดเศษ อื่น ๆ เป็นยอดหรือเปอร์เซ็นต์ของค่าสินค้า), `expense.draft.remove_line`, `expense.draft.set_vat_mode` (แยก VAT / รวม VAT / ไม่มี VAT และอัตรา) (2) API รันเส้นทางเขียนจริงแล้ว rollback เพื่อคำนวณผล เก็บ preview (3) gateway ประกอบคำตอบด้วย `draft-update-formatter.ts` (โมเดลไม่ได้เรียบเรียง) (4) การ์ด `buildDraftUpdatePreviewCard` พร้อมปุ่ม `ยืนยันการแก้ไข` / `ยกเลิกการแก้ไข` ที่พก `previewId` (UUID) (5) `handleDraftUpdatePostback` (`:5123`) ตรวจว่า preview นั้นยังเป็นตัวปัจจุบันของแชต แล้วเขียน
- **กฎธุรกิจและข้อยกเว้น** คำว่า `ยืนยันการแก้ไข` ที่พิมพ์เองไม่มี `previewId` จึงสั่งเขียนไม่ได้ ปิดสวิตช์แล้ว tool ทั้ง 5 หายจาก catalog (ไม่ใช่ถูกปฏิเสธทีหลัง) และ postback ถูกทิ้ง หมวด `draft_update` แยกจาก `final_mutation` โดยเจตนา ข้อความในใบเสร็จที่นำมาแสดงผ่าน `scrubRecordText` เพราะเป็นข้อความที่ผู้ไม่หวังดีพิมพ์ลงบนใบเสร็จได้ การแก้ 5 ฟิลด์แบบเก่า (correction lane: `EXPENSE_CAPTURE_CORRECTION`) ยังอยู่สำหรับการแก้ที่ไม่ใช่เงิน
- **การตรวจข้อมูล/ข้อผิดพลาด** `ยกเลิกแล้วค่ะ ยังไม่ได้แก้อะไรในรายก…`; `ไม่พบรายการที่รอยืนยันในแชทนี้ค่ะ (อา…)`; กดซ้ำ → `แก้ไปแล้วค่ะ …`; กำกวมบรรทัด → ถาม `บรรทัดไหน`; ไม่มีสิทธิ์ → `ยังไม่มีสิทธิ์…`; ถามกลับเมื่อไม่ชัด `ต้องการแก้ไขรายการไหนคะ กรุณาระบุรายการและ…` รหัสปฏิเสธฝั่ง API: `LINE_DRAFT_EDIT_DISABLED`
- **ข้อมูล** `ExpenseRecord`, `ExpenseLine`, ที่เก็บ preview (`LineDraftPreviewStore`)
- **API** tools `expense.draft.*` ผ่าน `POST /v1/internal/ai/tools/invoke`; gateway `POST /internal/ai/line-draft-edit-capability` (ตรวจความสามารถโดยไม่เรียกโมเดล)
- **หน้าจอ** เว็บ หน้าตรวจร่าง (ลิงก์ `withDraftWebLink`)
- **การทดสอบ** `line-ai/domain/logic/line-draft-update-card.logic.spec.ts`, `line-ai/application/use-cases/erp-draft-update-tools.di.spec.ts`, `gw/line-ai/agents/draft-update-formatter.spec.ts`, `docs/agent-memory/line-ai-draft-control.md`

### FR-LINE-071 เพิ่มและแก้ไขคู่ค้า ผู้ขาย หรือผู้รับเงิน

- **คำอธิบาย** ผู้ใช้บอกชื่อและข้อมูลของคู่ค้า ระบบเตรียมการ์ดเก่า → ใหม่ให้ตรวจแล้วกดบันทึก
- **ผู้ใช้/permission** อ่าน: `accounting.counterparty.read` (ค้นหา) และชุด `COUNTERPARTY_DETAIL_PERMISSIONS`; เขียน: ตาม use case ของเว็บ (รวม `accounting.counterparty.manage`)
- **แพ็ก** P-ALL (tool ผูกกับ feature `expenses` หรือ `sales_documents`)
- **เงื่อนไขก่อนทำ** PRE-BOUND + PRE-AI
- **ขั้นตอนหลัก** คำสั่ง: `ช่วยเพิ่มคู่ค้าให้หน่อย`, `เพิ่มผู้ขาย…`, `แก้ที่อยู่…`, `บันทึกเลขผู้เสียภาษี…` → tool `counterparty.search` / `counterparty.get_detail` → `counterparty.action.preview` (`CREATE` / `UPDATE`) → การ์ด `buildCounterpartyCard` → ปุ่ม `counterparty_confirm` / `counterparty_cancel` → บันทึก แล้วตอบการ์ด `buildCounterpartySavedCard` พร้อมปุ่มเปิดบนเว็บ
- **กฎธุรกิจและข้อยกเว้น** เลขผู้เสียภาษีต่างประเทศรับได้ (ยาวถึง 32 ตัวอักษร) เลขไทยตรวจ checksum เป็นคำเตือน ก่อนยืนยันต้องอ่านรายละเอียดครบ (`กรุณาอ่านรายละเอียดคู่ค้า…`) ค่าที่กรอกมาจากข้อความของผู้ใช้ ไม่ให้โมเดลแต่ง ทะเบียนคู่ค้าเป็นระดับบริษัทเหมือนเว็บ
- **การตรวจข้อมูล/ข้อผิดพลาด** หลายรายการตรงกัน → ถามให้เลือก
- **ข้อมูล** ทะเบียนคู่ค้าของโมดูล accounting-documents
- **API** tools `counterparty.search`, `counterparty.get_detail`, `counterparty.action.preview`
- **หน้าจอ** เว็บ หน้าคู่ค้า
- **การทดสอบ** `process-line-webhook.use-case.spec.ts`; ดู SRS คู่ค้า

### FR-LINE-072 เพิ่มและแก้ไขพนักงานและสาขา

- **คำอธิบาย** เจ้าของหรือผู้ดูแลเตรียมการเพิ่มพนักงาน แก้ไข ปิด/เปิดใช้งาน เพิ่มสาขา หรือแก้ไขสาขาผ่านแชต
- **ผู้ใช้/permission** ตาม use case ของ employee-access และ company settings (wizard เดียวกับเว็บ)
- **แพ็ก** P-ALL (`employee_access`, `company_settings.branches`); จำนวนตามแพ็ก (สาขา 1/2/5/10, พนักงาน 2/5/10/30)
- **เงื่อนไขก่อนทำ** PRE-BOUND + PRE-AI
- **ขั้นตอนหลัก** tool `company.action.preview` action `EMPLOYEE_CREATE`, `EMPLOYEE_UPDATE`, `EMPLOYEE_DISABLE`, `EMPLOYEE_ENABLE`, `BRANCH_CREATE`, `BRANCH_UPDATE` → `LineTeamActionService` ถามข้อมูลที่เว็บบังคับ (ตัวตน วันเกิด เบอร์โทร ชื่อผู้ใช้ บทบาท สาขา) → การ์ด → ยืนยัน คำถามเรื่องบทบาทและผู้อนุมัติใช้ tool `company.get_roles` (`employeeName` หรือ `permissionKey = reimbursement.approve`)
- **กฎธุรกิจและข้อยกเว้น** เกินจำนวนของแพ็ก → `teamCapacityReply` รับเฉพาะ input แบบชื่อแบน ๆ คำสั่ง รหัส และบริบทที่โมเดลส่งมาไม่ถึง use case ไม่มี endpoint ที่โมเดลเรียกเพื่อเขียนได้ ป้ายบทบาทอธิบายเป็นไทยโดยไม่มีรหัสภายใน
- **การตรวจข้อมูล/ข้อผิดพลาด** `teamActionRefusal` แปลข้อผิดพลาด
- **ข้อมูล** `CompanyMembership`, `Branch`, ผู้ใช้และบทบาท
- **API** tools `company.action.preview`, `company.get_roles`, `company.get_employee_summary`, `company.get_employee_detail`, `company.list_branches`
- **หน้าจอ** เว็บ เมนูพนักงานและสาขา
- **การทดสอบ** `line-ai/application/use-cases/company-list-branches.tool.spec.ts`, `line-ai/application/use-cases/erp-business-tools.use-case.spec.ts`

### FR-LINE-073 บันทึกรายจ่ายด้วยข้อความ และการแก้ร่างที่เพิ่งบันทึก

- **คำอธิบาย** ผู้ใช้พิมพ์ "ค่าวินไปพบลูกค้า 60 บาท" ระบบสร้างร่างรายจ่ายจากข้อความ
- **ผู้ใช้/permission** สิทธิ์บันทึกรายจ่าย (`expense.create` และที่เกี่ยวข้อง)
- **แพ็ก** P-ALL
- **เงื่อนไขก่อนทำ** PRE-BOUND + PRE-AI; intake route `EXPENSE_DOCUMENT_CAPTURE` หรือ `EXPENSE_DRAFT_CONTINUATION`
- **ขั้นตอนหลัก** router ส่ง `captureHints` (ห้ามแต่งค่า) → ด่านตรวจก่อน `captureExpenseNote.execute` (ทุกการปฏิเสธจึงไม่มีการเขียน) → สร้างร่าง → การ์ดร่าง
- **กฎธุรกิจและข้อยกเว้น** ขาดยอด → `🧾 รับรายการแล้วค่ะ ขอทราบยอดเงินด้วยนะคะ เช่น “60 บาท”`; ขาดรายการ → `🧾 รับยอดเงินแล้วค่ะ ขอทราบรายการหรือวัตถุประสงค์ด้วยนะคะ เช่น “ค่าวินไปพบลูกค้า”`; มียอดมากกว่าหนึ่ง → `🧾 ยังไม่สร้างรายการนะคะ ตอนนี้มียอดเงินมากกว่าหนึ่งจำนวนในบทสนทนา …` ช่องที่รับแล้วไม่ถามซ้ำ การคุยร่างแบบหลาย turn (`LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED`) ปิดเป็นค่าเริ่มต้น การแก้ 5 ฟิลด์ (route `EXPENSE_CAPTURE_CORRECTION`) แก้ได้เฉพาะรายการที่แชตนี้บันทึก ค่าที่แก้ยาวไม่เกิน 200 ตัวอักษร ปี พ.ศ./ค.ศ. ที่ไม่ระบุถือเป็นปีนี้ (ดู `docs/agent-memory/line-ai-assumed-year-note.md`)
- **การตรวจข้อมูล/ข้อผิดพลาด** ความเชื่อมั่นของ route ต่ำกว่า 0.6 (`INTAKE_MIN_ACTION_CONFIDENCE`) ไม่ลงมือ
- **ข้อมูล** `ExpenseRecord`, marker การใช้คำตอบ (`ai.line.clarification.consumed`, `expense.line_correction.applied`)
- **API** gateway `POST /internal/ai/line-intake-route`
- **หน้าจอ** เว็บ หน้าตรวจร่าง
- **การทดสอบ** `line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts`, `line-ai/application/line-ai-consumption-marker.spec.ts`, `docs/agent-memory/line-ai-expense-draft-conversation.md`

---

## 9. กลุ่ม G — AI Gateway

`apps/ai-gateway` เป็นแอป NestJS แยกจาก ERP core ประกอบด้วยโมดูล `HealthModule`, `LineAiModule`, `AiDraftModule`, `CrmCustomerAiModule` และโมดูลร่วม `AiAuthModule`, `AiModule`, `SecurityModule` (`apps/ai-gateway/src/app.module.ts`) gateway ไม่มีฐานข้อมูล ไม่เรียก LINE และไม่ถูกเรียกจาก LINE หรือเว็บโดยตรง

### FR-LINE-080 ขอบเขตภายในของ gateway: ความลับร่วม guard และโหมดบำรุงรักษา

- **คำอธิบาย** ทุก route ของ gateway รับเฉพาะคำขอจาก ERP core
- **ผู้ใช้/permission** ผู้เรียกคือ service ของ API; header `X-Internal-Secret`
- **แพ็ก** ไม่ผูกกับแพ็กโดยตรง (ผู้เรียกเป็นผู้ตรวจแพ็ก)
- **เงื่อนไขก่อนทำ** ตั้ง `AI_GATEWAY_INTERNAL_SECRET` ตรงกันทั้งสองฝั่ง
- **ขั้นตอนหลัก** route ภายในประกาศ `@Public()` แล้วเรียก `assertInternalSecret` ซึ่งเทียบแบบ constant-time ไม่รั่วความยาว (`common/security/internal-secret.ts`) route ที่ไม่ใช่ `@Public()` ต้องผ่าน `AiToolGuard` (Bearer token ที่ `WatchdogContextVerifier` ตรวจ และมี permission `ai.tool.invoke`) ตามด้วย `DenyByDefaultGuard` (ต้องประกาศ `@RequirePermissions` ไม่งั้นปฏิเสธ)
- **กฎธุรกิจและข้อยกเว้น** route ทั้งหมด (prefix `/v1/internal/ai` ตาม `AiUsageInterceptor` ที่อ้างพาธ `/v1/internal/ai/receipt-ocr`):

| route | หน้าที่ | usage tag ของโมเดล |
|---|---|---|
| `POST line-turn` | AI turn หนึ่งรอบ | `line.plan-route`, `line.loop`, `line.compose`, `line.casual`, `line.critic`, `line.polish`, `line.public.lookup` |
| `POST line-intake-route` | intake router (จำแนกเส้นทาง + แผนอ่านแบบเร็ว) | `line.intake-route` |
| `POST line-workflow-classify` | ตัวจำแนกงาน | `line.workflow-classify` |
| `POST line/public-general` | คำถามทั่วไปของผู้ที่ไม่มีบริบทส่วนตัว | `line.public.general` |
| `POST line-document-qa` | ถามตอบเอกสาร | `line.document.qa` |
| `POST receipt-ocr` | อ่านใบเสร็จ (stage 1 อ่าน, stage 2 เข้าใจ) | `ocr.receipt.image-read`, `ocr.receipt.extract`, `ocr.receipt.utility-parts` |
| `POST capture-read`, `POST capture-extract` | อ่านและสกัดเอกสารของสายงาน capture | `ocr.capture.read`, `ocr.receipt.extract` |
| `POST bank-statement-extract` | สกัดรายการเดินบัญชี | `ocr.bank-statement` |
| `POST line-draft-edit-capability` | ตรวจว่า artifact รองรับการแก้ร่าง (ไม่เรียกโมเดล) | — |
| `POST line-reliability-capabilities` | ตรวจสัญญา budget/input v2 ของ runtime (ไม่เรียกโมเดล) | — |
| `GET agents` | รายการ agent และ tool | — |
| `POST draft-generate` | AI แนะนำ (FR-LINE-101) | `ai.draft` |
| `POST crm-*` (8 route) | AI ของ CRM (FR-LINE-102) | `crm.*` |
| `GET /v1/health` | liveness | — |

  โหมด `PRODUCTION_SERVING_MODE=maintenance_only` ตอบทุก route ยกเว้น health ด้วย JSON `{ code: 'global_maintenance' }` สถานะ 200 และ header `X-Mangmee-Maintenance: active` ใน production ต้องตั้งค่านี้เป็น `live` หรือ `maintenance_only` อย่างชัดเจน ไม่งั้น process ไม่ขึ้น
- **การตรวจข้อมูล/ข้อผิดพลาด** ความลับผิด → 401 payload ผิดรูป → 400 ข้อผิดพลาดของผู้ให้บริการส่งกลับเป็นรหัสปลอดภัย ไม่มี stack trace ไปถึง LINE
- **ข้อมูล** — (gateway ไม่มีฐานข้อมูล)
- **API** ตามตาราง
- **หน้าจอ** —
- **การทดสอบ** `common/security/internal-secret.spec.ts`, `auth/ai-auth.spec.ts`, `common/http/production-maintenance.middleware.spec.ts`, `app.boot.spec.ts`, `gw/line-ai/presentation/http/line-ai-internal.controller.spec.ts`

### FR-LINE-081 Intake router: จำแนกเส้นทางของข้อความก่อนลงมือ

- **คำอธิบาย** ข้อความ (และรูป) ถูกจำแนกเป็นหนึ่งเส้นทางรับเข้า ก่อนที่ use case ของโมดูลใดจะทำงาน router ออกแผนเท่านั้น ไม่ลงมือ
- **ผู้ใช้/permission** ผู้ใช้ที่ผ่าน PRE-AI; API ส่งรายชื่อ tool ที่ผู้ใช้เข้าถึงได้จริง (`lineIntakeOfferedToolNames`: ต้องมี `ai.tool.invoke`)
- **แพ็ก** P-ALL
- **เงื่อนไขก่อนทำ** budget grant ถูกต้อง
- **ขั้นตอนหลัก** `IntentRouterAgent.routeIntake` (`gw/line-ai/agents/intent-router.agent.ts`) เรียกโมเดลหนึ่งครั้ง (`line.intake-route`) ด้วย prompt จาก `intakeRouterSystemPrompt(caps, hasImage, semanticV2, …)` ผลถูกถอดรหัสและตรวจด้วย `parseLineIntakeCompactDecision`
- **กฎธุรกิจและข้อยกเว้น** เส้นทาง (`LINE_INTAKE_ROUTE_INTENTS`) 13 ค่า:

| intent | ความหมาย | ผู้รับงานฝั่ง API |
|---|---|---|
| `EXPENSE_DOCUMENT_CAPTURE` | บันทึกรายจ่ายจากรูปหรือข้อความ | FR-LINE-050, FR-LINE-073 |
| `EXPENSE_DRAFT_CONTINUATION` | ทำร่างที่ค้างต่อ | FR-LINE-073 |
| `EXPENSE_CAPTURE_CORRECTION` | แก้รายการที่เพิ่งบันทึก | FR-LINE-070, FR-LINE-073 |
| `EXPENSE_PAYMENT_EVIDENCE_LINK` | ผูกสลิปกับรายจ่าย | FR-LINE-053 |
| `SUBSTITUTE_RECEIPT_CONTINUATION` | ใบรับรองแทนใบเสร็จ | FR-LINE-056 |
| `REIMBURSEMENT_REQUEST_START` | ขอเบิก | FR-LINE-062 |
| `BUSINESS_DOCUMENT_REFERENCE` | เอกสารธุรกิจที่ไม่ใช่รายจ่ายใหม่ | FR-LINE-051 |
| `SIGNATURE_UPLOAD_TICKET` | อัปโหลดลายเซ็น | FR-LINE-055 |
| `BUSINESS_READ_QUESTION` | ถามข้อมูลของร้าน | FR-LINE-082 ถึง 085 |
| `ADVISOR_CONVERSATION` | คุยทั่วไป ความรู้ คำแนะนำ | FR-LINE-088, FR-LINE-089 |
| `MUTATION_REQUEST_REFUSAL` | ขอทำสิ่งที่ LINE ทำไม่ได้ | FR-LINE-093 |
| `CLARIFY` | ต้องถามกลับ | คำถามของ router หรือแม่แบบ |
| `UNSUPPORTED` | นอกขอบเขต | FR-LINE-093 |

  เวลา: ข้อความล้วน 25 วินาที (`LINE_TEXT_INTAKE_TIMEOUT_MS`), มีรูป 45 วินาที หรือ 90 วินาทีสำหรับ PDF และภาพทรงสูง (`aiDocumentOcrTimeoutMs`: อัตราส่วนด้าน ≥ 1.35) เมื่อมีรูปและหมดเวลา ลองใหม่หนึ่งครั้ง ฝั่ง API รอ 30 วินาทีสำหรับข้อความ และ 2 × 90 + 15 = 195 วินาทีสำหรับรูป ข้อความเอกสารที่ส่งให้ router ไม่เกิน 12,000 ตัวอักษร output ของรอบที่มีเอกสารไม่เกิน 8,000 token ความสามารถเสริมของ prompt (`fusedPlan`, `substituteSemantic`, `reimbursementSemantic`, `advisor`, `approvedKnowledge`) เปิดเมื่อ API ส่ง `true` ตัวจริงต่อคีย์ที่รู้จักเท่านั้น และตรวจซ้ำใน `routeIntake` การแก้ร่าง ความรู้ที่อนุมัติ และ family ของ prepared read ถูกตั้งเปิดตายตัวในโค้ดของ controller (มติเจ้าของ 2026-09-29 หลัง environment ของ AgentCore ที่ค้างเก่าเคยปิดความสามารถ) ส่วน public lookup ตาม `LINE_AI_PUBLIC_LOOKUP_ENABLED` (ค่าเริ่มต้น `false`) และ advisor ตาม `LINE_AI_ADVISOR_MODE` (ค่าเริ่มต้น `off`) จำนวน tool ที่เสนอไม่เกิน 128 ชื่อ รูปใบเสร็จที่ router อ่านแล้วส่งผลอ่านต่อให้ OCR เพื่อไม่อ่านซ้ำ (`assessIntakeOnePassReceipt`)
- **การตรวจข้อมูล/ข้อผิดพลาด** ผลที่ถอดรหัสไม่ผ่านมีรหัสเหตุผลและคำใบ้ซ่อม (`INTAKE_REPAIR_HINTS`) สถานะ `UNAVAILABLE` พร้อม `errorCode` ถูก log ทุกครั้ง ค่ากรองชื่อหมวด/ผู้ขาย/ผู้เบิกต้อง grounded กับข้อความของ turn หรือ `recentReads` รหัสรายการต้องมาจาก `shownItems` หรือการอ้างอิงที่ API ออกให้ ไม่ใช่จากข้อความ
- **ข้อมูล** —
- **API** gateway `POST /internal/ai/line-intake-route`
- **หน้าจอ** —
- **การทดสอบ** `gw/line-ai/agents/line-intake-router.agent.spec.ts`, `gw/line-ai/agents/line-intake-compact-decision.spec.ts`, `gw/line-ai/agents/line-intake-reply.spec.ts`, `scripts/line-ai-intake-cost.corpus.ts`, `scripts/run-line-ai-operator-language-eval.ts`

### FR-LINE-082 AI turn: สามเส้นทางของการประมวลผล

- **คำอธิบาย** `LineAiTurnUseCase` รับคำขอ turn แล้วเลือกเส้นทางตามค่าตั้งของ runtime
- **ผู้ใช้/permission** ผู้ใช้ที่ผ่าน PRE-AI
- **แพ็ก** P-ALL
- **เงื่อนไขก่อนทำ** คำขอมี budget grant v2 ที่ตรงกับสถานะ budget ที่ interceptor เปิดไว้; แผนเตรียมล่วงหน้าและ intake intent ถูก parse ใหม่ที่ขาเข้า
- **ขั้นตอนหลัก** (`gw/line-ai/application/use-cases/line-ai-turn.use-case.ts`)
  1. **AgentCore** (`LINE_AI_AGENT_RUNTIME=agentcore`): เรียก runtime ผ่าน `AgentCoreRuntimeClient` (FR-LINE-100) ผลถูกคัดกรองเป็นฟิลด์ตามสัญญา usage ที่ artifact รายงานเป็นแหล่งเดียวของการวัดในเส้นนี้
  2. **Orchestrator ในตัว** (`strands-local`): `OrchestratorAgent` ใน process ของ gateway (FR-LINE-083)
  3. **Deterministic เดิม** (`LINE_AI_AGENT_ORCHESTRATION_ENABLED=false`; ใช้ตอนเสิร์ฟโหมดบำรุงรักษา): จำแนกด้วยคีย์เวิร์ด เรียก read tool ด้วย input ว่าง แล้วประกอบข้อความจากแม่แบบ
- **กฎธุรกิจและข้อยกเว้น** ค่าเริ่มต้นในโค้ดของ `LINE_AI_AGENT_RUNTIME` คือ `disabled` สคริปต์ตรวจ release ของยุค Kamal บังคับให้ gateway ตั้ง `LINE_AI_AGENT_RUNTIME=agentcore` (`infra/dev-kamal/release_inventory.py:80`) ส่วนแม่แบบ ECS รุ่นเก่าใช้ `strands-local` (`infra/ai-gateway/task-definition.template.json:52`) ค่าจริงของ environment ที่ถูกลบแล้วตรวจไม่ได้ บริษัทโหมดงบ `SPLIT` ถูกปฏิเสธบนเส้น AgentCore เมื่อ runtime ไม่เคารพ envelope เพราะ artifact รันโมเดลใน process ของตัวเองและจอง step ล่วงหน้าไม่ได้ สัญญาไม่ตรงรุ่น → `AI_CONTRACT_UNSUPPORTED` ไม่มีการลดรุ่นเป็น v1 เส้น deterministic ถามกลับเมื่อผลก่อนหน้ามีขอบเขตช่วงเวลาหรือสาขา แทนการตอบเดือนปัจจุบันทุกสาขาโดยเงียบ
- **การตรวจข้อมูล/ข้อผิดพลาด** ข้อความปฏิเสธของ gateway: ตารางหัวข้อ 12.4
- **ข้อมูล** —
- **API** gateway `POST /internal/ai/line-turn`; ฝั่ง API รอ 120 วินาที (`LINE_TURN_TIMEOUT_MS`)
- **หน้าจอ** —
- **การทดสอบ** `gw/line-ai/application/use-cases/line-ai-turn.use-case.spec.ts`, `line-ai-turn-v2.integration.spec.ts`, `line-ai-turn.fixed-read.spec.ts`, `gw/line-ai/domain/logic/line-ai-turn.spec.ts`

### FR-LINE-083 Orchestrator และวงเรียก tool

- **คำอธิบาย** orchestrator ประสานงาน: วางแผน intent, ให้โมเดลเลือก read tool ภายใน allowlist, ให้ specialist จัดรูปข้อเท็จจริงแบบกำหนดตายตัว แล้วเรียบเรียงคำตอบ
- **ผู้ใช้/permission** ตาม tool ที่เรียก
- **แพ็ก** P-ALL
- **เงื่อนไขก่อนทำ** มีผู้ให้บริการโมเดล ไม่งั้นถอยเป็นการ dispatch ตามแผนแบบกำหนดตายตัว
- **ขั้นตอนหลัก** (`gw/line-ai/agents/orchestrator.agent.ts`) (1) วางแผน: `IntentRouterAgent.route` (`line.plan-route`, `maxTokens: 500`) คืน `AgentIntentPlan` (`ROUTABLE`/`PARTIAL`/`UNROUTABLE`, intents, refusals) หรือใช้แผนเตรียมล่วงหน้าจาก intake (2) `normalizePlanToolAccess` ตัด tool ที่ผู้ใช้ไม่มีสิทธิ์หรือร้านไม่มี feature (3) วง tool: แบบ native (`generateWithTools`; เรียกหลาย tool ขนานได้ เรียก tool เดิมซ้ำด้วย input ต่างกันได้ มี tool สังเคราะห์ `ask_user` ใช้ได้ครั้งเดียวต่อ turn) หรือแบบ JSON ทีละ tool (`{"callTool"}` / `{"askUser"}` / `{"done"}`) usage tag `line.loop` (4) `sanitizeToolInput` กรอง input ให้เหลือเฉพาะฟิลด์ที่ registry ประกาศ (5) specialist (`AccountingSummaryAgent`, `InventoryAgent` ฯลฯ) แปลงผล tool เป็น `SpecialistOutput` (6) `CoverageCriticAgent` (FR-LINE-091) (7) `ResponseComposerAgent` (FR-LINE-090)
- **กฎธุรกิจและข้อยกเว้น**
  - จำนวนการเรียก tool ต่อ turn ไม่เกิน `AI_MAX_TOOL_CALLS` (ค่าเริ่มต้นและเพดาน 8) API ออก delegation ใช้ครั้งเดียวไม่เกิน 8 ใบต่อ tool (`LINE_AI_ACTOR_DELEGATIONS_PER_TOOL`)
  - ผลของ tool ที่ป้อนกลับโมเดลไม่เกิน 4,000 ตัวอักษร (`MAX_TOOL_RESULT_CHARS`)
  - วันที่: โมเดลต้องคัดลอก `fromDate`/`toDate`/`monthKey` จาก `valueCandidates.periods` ที่โค้ดคำนวณจากคำของผู้ใช้ (`PERIOD_SELECTION_RULE`) วันที่ที่โมเดลคิดเองถูกทิ้ง tool จึงใช้ช่วงเริ่มต้น (เดือนปัจจุบัน; ปิดยอดรายวันใช้วันนี้) และคำตอบระบุช่วงนั้น
  - ชื่อหมวด/ผู้ขายที่โมเดลเสนอต้องสืบได้จากข้อความของ turn หรือ `recentReads` รหัสรายการ (`expenseId`, `reimbursementId`) รับเฉพาะที่ปรากฏใน `shownItems` หรือการอ้างอิง capture/draft ที่ API ออกให้
  - บริบทสนทนา: หน้าต่าง 15 นาที ไม่เกิน 15 turn (`LINE_AI_CONTEXT_WINDOW_MINUTES`, `LINE_AI_CONTEXT_MAX_TURNS`), ข้อความบริบทละไม่เกิน 500 ตัวอักษร, `recentReads` ไม่เกิน 3, `shownItems` ไม่เกิน 10 และไม่มียอดเงิน (R-M6) ใช้เพื่อแก้การอ้างอิงเท่านั้น ไม่ใช่ความจริงทางธุรกิจ สิทธิ์ หรือการเลือกร้าน
  - ตัวกรองรายจ่ายที่ไม่มี tool รองรับ (รวมรายการยกเลิก/ถูกปฏิเสธเข้ายอดรวม) ถูกบอกตรง ๆ ตัวกรองที่สะกดเกือบถูกทำให้ถามกลับ ไม่ตอบยอดรวมกว้างแทน
- **การตรวจข้อมูล/ข้อผิดพลาด** tool ถูกปฏิเสธเพราะ feature ปิดหลังวางแผน → `tool-availability.ts` จัดเป็น `feature_disabled` ไม่ใช่ `forbidden`
- **ข้อมูล** —
- **API** tool ผ่าน `POST /v1/internal/ai/tools/invoke`
- **หน้าจอ** —
- **การทดสอบ** `gw/line-ai/agents/orchestrator.agent.spec.ts`, `orchestrator-model-loop.agent.spec.ts`, `orchestrator-native-loop.agent.spec.ts`, `intent-router.agent.spec.ts`, `read-tool-input.spec.ts`, `tool-availability.spec.ts`, `agent-tools.parity.spec.ts`, `agent-tools.registry.spec.ts`

### FR-LINE-084 Semantic turn v2: วางแผนทั้งคำขอและตอบทุกส่วน

- **คำอธิบาย** เส้นทางหลักของ turn ที่ผูกบัญชี: ข้อความถูกแตกเป็น subrequest (`read`, `general`, `write`, `help`, `public`, `file`) แต่ละส่วนถูกตอบหนึ่งครั้ง
- **ผู้ใช้/permission** ตาม tool ของแต่ละ subrequest
- **แพ็ก** P-ALL
- **เงื่อนไขก่อนทำ** `LINE_AI_RELIABILITY_V2_MODE=on` (ค่าเริ่มต้น) และ delivery plan v2 เปิด; แชตถูก bind (`bindConversation`)
- **ขั้นตอนหลัก** `runSemanticTurnV2` (`gw/line-ai/agents/semantic-turn-v2.ts:659`) (1) นโยบายขอบเขต (FR-LINE-092) ตัดสินก่อนเสนอ tool (2) รอบวางแผนด้วย `CONTROL_PROMPT` (ข้ามได้เมื่อ `plannerSkipCalls` สร้างการเรียกจากคำใบ้ของ intake ได้เอง) (3) ตรวจ input ของแต่ละการเรียกด้วย `validInput` และ `bindRequestedReadFilters` (4) เรียก tool (5) คำตอบ: ถ้าเป็น family ที่มี formatter ใช้ข้อความที่โค้ดประกอบ ไม่งั้นเรียกโมเดลด้วย `ANSWER_PROMPT` + persona (6) ตรวจตัวเลขของคำตอบกับ `allowedAnswerNumbers` (ตัวเลขจากผล tool, ปี พ.ศ. ที่แปลง, เปอร์เซ็นต์ปัดเศษ, เลขอ้างอิงที่ผู้ใช้พิมพ์)
- **กฎธุรกิจและข้อยกเว้น** งานเขียนที่รองรับต้องไปถึง tool `*.action.preview` ไม่ใช่คำปฏิเสธว่า LINE ทำไม่ได้ ถ้ายังไม่รู้เป้าหมายให้อ่านรายการก่อนแล้วเตรียมการ์ดในรอบเดียวกัน ผลอ่านเป็นหลักฐานของเป้าหมายเท่านั้น ไม่ใช่การเขียนที่สำเร็จ "เดือนนี้" ใช้ monthKey ที่โค้ดกำหนด ไม่ถามซ้ำ คำถามใช่/ไม่ใช่ เปิดด้วยคำตอบตรง ผู้ช่วยพูดในฐานะมั่งมีพลัส ไม่เรียกผลิตภัณฑ์ว่า "ระบบของคุณ" คำถามวิธีทำงานที่ไม่มีการ์ดความรู้ครอบคลุมคืน `helpActions:[{index, actionId}]` โดยใช้รหัสจาก `LINE_CHAT_ACTIONS` เซิร์ฟเวอร์เป็นผู้ใส่ประโยคอธิบายและปุ่ม การอ่านที่ผู้ใช้เห็นเฉพาะของตนเองหรือที่เกี่ยวข้องมีบรรทัดขอบเขตกำกับ (`SCOPE_LINE_TEXT`) การถามช่วงเวลาที่กำกวมถามกลับด้วย `periodAskBackText` รหัสภายในรูปแบบ `ABC_DEF` ถูกลบออกจากข้อความ (`withoutInternalCodes`)
- **การตรวจข้อมูล/ข้อผิดพลาด** อ่านไม่ได้ → `READ_UNAVAILABLE_TEXT`; ตอบทั่วไปไม่ได้ → `GENERAL_ANSWER_UNAVAILABLE_TEXT`; คำตอบไม่ผ่าน grounding → `deterministicReadFallback`
- **ข้อมูล** —
- **API** gateway `POST /internal/ai/line-turn`
- **หน้าจอ** —
- **การทดสอบ** `gw/line-ai/agents/semantic-turn-v2-*.spec.ts` (8 ไฟล์: approval-backlog, compose-skip, grounding, memory-filter-grounding, pending-work, persona-sanitize, read-filter-binding, terminal-outcomes), `semantic-retained-source.spec.ts`, `line-ai/application/use-cases/process-line-general-v2.spec.ts`, `process-line-mixed-business-v2.spec.ts`

### FR-LINE-085 Prepared simple read: คำตอบอ่านข้อมูลแบบเร็วที่โค้ดประกอบเอง

- **คำอธิบาย** คำถามอ่านข้อมูลแบบง่ายถูกวางแผนตั้งแต่ intake แล้วตอบด้วย formatter ที่คอมไพล์ไว้ ไม่เรียกโมเดลรอบสอง
- **ผู้ใช้/permission** ตาม tool
- **แพ็ก** P-ALL (family ของ `sales.*` และ `accounting.get_summary` ต้องมี feature ที่ไม่มีแพ็กขาย)
- **เงื่อนไขก่อนทำ** `LINE_AI_PREPARED_SIMPLE_READ_ENABLED=true` (ค่าเริ่มต้น); ความเชื่อมั่นของแผน ≥ 0.75 (`SIMPLE_READ_CONFIDENCE_FLOOR`)
- **ขั้นตอนหลัก** router แนบ `simpleRead {subrequest, tool, subject, agent, answerShape, confidence}` → API ส่งต่อเป็น `preparedPlan` → runtime parse ใหม่ → เรียก tool หนึ่งครั้ง → `formatPreparedSimpleRead(familyKey, output, ctx)`
- **กฎธุรกิจและข้อยกเว้น** family ที่อนุมัติ (`APPROVED_PREPARED_FAMILY_KEYS`, `prepared-simple-read-formatter.ts:1931`): `sales.get_sales_summary::single_metric`, `expense.list_recent::single_metric`, `expense.list_recent::list`, `accounting.get_summary::list`, `expense.get_daily_closing::single_metric`, `expense.get_breakdown::list`, `reimbursement.list_pending_approvals::list`, `reimbursement.get_summary::single_metric`, `expense.get_detail::single_metric`, `reimbursement.get_detail::single_metric` family ที่โค้ดประกอบหลังอ่านแต่ไม่เสนอ router: `voucher.list_recent::list`, `counterparty.search::list`, `company.get_roles::list`, `billing.get_package_catalog::list` รายการนี้ไม่อ่านจาก environment เส้นนี้เข้มกว่าวง tool: ทุกวันที่และ month key ต้องมีหลักฐานแบบกำหนดตายตัว (วันนี้ เดือนปัจจุบัน วันที่ที่ผู้ใช้ระบุชัด หรือขอบของช่วงที่ตัวแก้ช่วงเวลาอ่านจากคำของผู้ใช้) ไม่ผ่าน → ถอยไปเส้นเต็มก่อนเรียก tool คำถาม "ทำไม/เปรียบเทียบ/คำแนะนำ" ไม่เข้าเส้นนี้ (`WHY_COMPARE_ADVICE_PATTERN`) เป้าความเร็วที่วัดได้: fast lane p50 ≈ 5.4 วินาที, p95 ≈ 6.8 วินาที (run 10 ของชุดจูน; หัวข้อ 14)
- **การตรวจข้อมูล/ข้อผิดพลาด** family ไม่มี formatter → `unverified` → เส้นเต็ม
- **ข้อมูล** —
- **API** —
- **หน้าจอ** —
- **การทดสอบ** `gw/line-ai/agents/prepared-simple-read-formatter.spec.ts`, `prepared-simple-read-security.spec.ts`, `gw/line-ai/domain/logic/prepared-simple-read.logic.spec.ts`, `packages/contracts/src/line-ai-prepared-plan.spec.ts`, `scripts/line-ai-latency-autonomy.corpus.ts`

### FR-LINE-086 Agent registry และ specialist

- **คำอธิบาย** ทะเบียน agent กำหนดว่า agent ใดใช้ tool ใดได้ specialist จัดรูปข้อเท็จจริงจากผล tool โดยไม่ใช้โมเดล
- **ผู้ใช้/permission** —
- **แพ็ก** ตาม tool
- **เงื่อนไขก่อนทำ** —
- **ขั้นตอนหลัก** `LINE_AI_AGENT_REGISTRY` (`packages/contracts/src/line-ai.ts`) ประเภท agent: `general`, `inventory`, `notifications`, `cfo`, `sales`, `crm`, `accounting`, `tax`, `marketing` สถานะ `enabled` / `limited` / `planned` router อนุญาต agent: general, accounting, tax, cfo, inventory, notifications, sales, crm
- **กฎธุรกิจและข้อยกเว้น** specialist ในโค้ด: `AccountingSummaryAgent` (`accounting-summary.agent.ts`; อ่านสรุปบัญชี รายจ่าย ใบเบิก), `InventoryAgent` (`inventory.agent.ts`; tool `inventory.list_low_stock`, `inventory.get_stock_balance`, `inventory.summarize_stock_movements`) agent หนึ่งตัวต่อหนึ่งงาน ห้ามเรียก tool นอก `requiredTools` ของ intent และ allowlist ของ specialist tool ที่ `executionReady: false` (`crm.suggest_sales_followups`, `accounting.capture_receipt_evidence`, `hr.get_leave_summary`) อยู่ใน catalog เพื่อการจับคู่ แต่ไม่ถูกเสนอให้เรียก
- **การตรวจข้อมูล/ข้อผิดพลาด** `GET /internal/ai/agents` คืนทะเบียน (ใช้ตรวจการ deploy)
- **ข้อมูล** — **API** gateway `GET /internal/ai/agents` **หน้าจอ** —
- **การทดสอบ** `gw/line-ai/agents/agent-tools.registry.spec.ts`, `agent-tools.parity.spec.ts`, `line-ai-feature-coverage.spec.ts`, `line-ai-business-query-regression.spec.ts`

### FR-LINE-087 อธิบายรายการรายจ่าย ("ทำไมยอดเป็นแบบนี้")

- **คำอธิบาย** ผู้ใช้ถามว่าทำไมบิลที่เพิ่งส่งมียอดหรือบรรทัดแบบนั้น คำตอบประกอบจากผล tool ทั้งหมด โมเดลไม่ได้เรียบเรียง
- **ผู้ใช้/permission** ผู้ที่อ่านรายจ่ายนั้นได้ (นโยบาย own/related/company)
- **แพ็ก** P-ALL
- **เงื่อนไขก่อนทำ** รายการถูกบันทึกในแชตนี้ (ตัวชี้จาก `chatKeyHash`)
- **ขั้นตอนหลัก** tool `expense.explain_record` → `expense-explain-formatter.ts` คัดลอกตัวเลขจากผลและจัดรูป (คั่นหลัก ทศนิยม 2 ตำแหน่ง) ไม่บวก ไม่อนุมาน ไม่ปัดเป็นเลขใหม่
- **กฎธุรกิจและข้อยกเว้น** ชื่อผู้ขายไม่เกิน 60 ตัวอักษร ป้ายค่าใช้จ่ายเพิ่มไม่เกิน 40 ผลที่ไม่มีรูปตามที่ formatter คาด → คืน `undefined` ผู้เรียกใช้เส้นทางปกติแทนการตอบครึ่งเดียว ตัวอย่างคำถามใน prompt: "ทำไม service charge คิดแยกเป็นอีกรายการ"
- **การตรวจข้อมูล/ข้อผิดพลาด** เรื่องที่อยู่ในระบบแต่ยังทำผ่าน LINE ไม่ได้ใช้เหตุผล `unsupported_yet` ไม่ใช่ `unsupported_module`
- **ข้อมูล** `ExpenseRecord`, `ExpenseLine`
- **API** tool `expense.explain_record`
- **หน้าจอ** —
- **การทดสอบ** `gw/line-ai/agents/expense-explain-record.spec.ts`, `line-ai/application/use-cases/expense-explain-record.tool.spec.ts`

### FR-LINE-088 ที่ปรึกษารายจ่าย ความรู้ที่อนุมัติ และคำแนะนำการใช้ผลิตภัณฑ์

- **คำอธิบาย** ผู้ช่วยตอบคำถามความรู้ทั่วไปทางธุรกิจและภาษี วิธีใช้ผลิตภัณฑ์ และคำถามเชิงที่ปรึกษาจากข้อมูลรายจ่ายของร้าน
- **ผู้ใช้/permission** ผู้ใช้ที่ผ่าน PRE-AI; การ์ดความรู้แต่ละใบมี `permissionAnyOf`, `requiredPermissions`, `featureKeys`, `requiredCapabilities`, `audience` (`public` / `member`)
- **แพ็ก** P-ALL; การ์ดและคำแนะนำภาษีหัก ณ ที่จ่ายผูกกับ P-ENT ตาม feature ของการ์ด
- **เงื่อนไขก่อนทำ** `LINE_AI_APPROVED_KNOWLEDGE_ENABLED=true` (ค่าเริ่มต้น) และแชตถูก bind
- **ขั้นตอนหลัก** (1) router เลือก `selectedKnowledgeCardIds` จากชุดการ์ดที่ผู้ใช้เข้าถึงได้ (2) gateway ใส่เนื้อหาการ์ดเป็น `approvedHelp` ให้รอบตอบ (3) คำแนะนำภาษี `taxGuidance` จาก `advisor-domain-guidance.ts` (ข้อเท็จจริงของผลิตภัณฑ์และแหล่งอ้างอิงกรมสรรพากร) ทับความจำที่ผิดของโมเดล (4) คำถามจากเอกสารของร้านใช้ `document-advisor-read.ts` ซึ่งคำนวณด้วย read tool ที่ตรวจสิทธิ์
- **กฎธุรกิจและข้อยกเว้น** ชุดความรู้มีรุ่น (`KNOWLEDGE_RELEASE = '2.4.0'`) สถานะ `DRAFT`/`APPROVED`/`RETIRED` เขตอำนาจ `TH` วันทบทวน และ hash ของแหล่งและเนื้อหา การ์ดระดับความเสี่ยง `R1` การ์ดช่วยเหลือผลิตภัณฑ์ที่อนุมัติอยู่ใน `approved-product-help.ts` (17 ใบจากการนับ `card(`) และร่างเพิ่มใน `product-help-draft-cards.ts` (สถานะการอนุมัติของร่างไม่ได้ตรวจละเอียด) ความรู้ให้คำอธิบายเท่านั้น ไม่ให้อำนาจอ่านระเบียนหรือทำรายการ คำถามแนะนำว่าควรขายสินค้าอะไรถูกตอบว่าไม่รองรับ (`unsupportedRecommendationReply`) เพราะไม่มีข้อมูลอุปสงค์หรือกำไรระดับสินค้า คำตอบตรงของ advisor จาก intake (`ADVISOR_CONVERSATION` + `advisorDirectAnswerText`) ใช้เมื่อ `LINE_AI_ADVISOR_MODE` ไม่ใช่ `off` และ `LINE_AI_ADVISOR_DIRECT_ANSWER_ENABLED=true` (ค่าเริ่มต้นทั้งสองคือปิด)
- **การตรวจข้อมูล/ข้อผิดพลาด** การแก้ข้อความคู่มือผู้ใช้เปลี่ยน hash ของชุดความรู้ ต้องรอชุดที่ทบทวนรอบถัดไป
- **ข้อมูล** — (เนื้อหาอยู่ในโค้ดของ gateway)
- **API** —
- **หน้าจอ** —
- **การทดสอบ** `gw/line-ai/agents/approved-knowledge.spec.ts`, `line-ai/domain/logic/line-advisor-direct-answer.logic.spec.ts`, `packages/contracts/src/line-ai-advisor-answer.spec.ts`, `scripts/line-ai-expense-advisor/*` (หัวข้อ 14)

### FR-LINE-089 บุคลิก "น้องมั่งมี" การคุยเล่น และคลังมุข

- **คำอธิบาย** ข้อความที่โมเดลเขียนถึงลูกค้าทุกช่องใช้บุคลิกเดียวกัน และมีตัวกรองแบบกำหนดตายตัวรองรับ
- **ผู้ใช้/permission** —
- **แพ็ก** P-ALL
- **เงื่อนไขก่อนทำ** —
- **ขั้นตอนหลัก** `MANGMEE_PERSONA_PROMPT` (`gw/line-ai/agents/mangmee-persona.ts`) ถูกใส่ใน prompt ของ composer, router (ช่อง `answerText`), รอบตอบของ semantic v2 และ ai-draft
- **กฎธุรกิจและข้อยกเว้น** กฎของบุคลิก: เป็นเพื่อนร่วมงานหญิงที่อบอุ่นและทำงานเป็น; เรียกตัวเองว่า น้องมั่งมี หรือ มั่งมี เท่านั้น ไม่ใช้ หนู ผม ดิฉัน ไม่เรียกตัวเองว่า WatchDog, MangmeePlus AI หรือ "AI Assistant"; ตอบตามภาษาของข้อความปัจจุบัน (อังกฤษล้วนตอบอังกฤษ มีไทยปนตอบไทย); ใช้ ค่ะ/คะ/นะคะ ไม่ใช้ ครับ; ไม่อ้างว่ามีร่างกายหรือเป็นมนุษย์; ห้ามเขียนว่าบันทึก/สร้าง/ส่ง/อนุมัติ/จ่ายแล้ว (เซิร์ฟเวอร์เท่านั้นที่ยืนยันการเขียน); เรียกรายจ่ายที่ยังไม่ยืนยันว่า "ร่าง"; ไม่ใช้ emoji หุ่นยนต์ 🤖; ใช้คำไทยธรรมดา (ค่าใช้จ่าย, ใบเบิก) และใช้ชื่อเอกสารทางการเฉพาะเมื่อจำเป็น; ไม่ใช้ Markdown; ไม่แสดงรหัสสถานะภายใน ใช้ป้ายไทย (จ่ายแล้ว, ยังไม่จ่าย, จ่ายบางส่วน, ร่าง, รอตรวจสอบ, ยืนยันแล้ว, ถูกปฏิเสธ, ยกเลิก); วันที่ไทยใช้ปี พ.ศ.; กระชับ ประมาณ 80 คำไทยใน 6 บรรทัด รายการไม่เกิน 8 ข้อแล้วบอกว่ายังมีอีกกี่รายการ
  - ตัวกรองหลังโมเดล: `sanitizeMangmeePersonaText` (ครับ → ค่ะ, ผม → น้องมั่งมี), `fixMangmeeSelfReference` (แก้ "หนู…" ที่เป็นเสียงของเธอเอง โดยไม่แตะ "หนู" ที่เป็นสัตว์ เด็ก ชื่อร้าน หรือคำพูดในเครื่องหมายคำพูด), `sanitizeMangmeeComposedText` (ลบ Markdown, แทนรหัสสถานะด้วยป้ายไทย, แปลงปี ค.ศ. หลังชื่อเดือนไทยเป็น พ.ศ., แทนพาธของแอปด้วยชื่อหน้าไทย เช่น "หน้าค่าใช้จ่ายบนเว็บ") ใช้กับข้อความที่โมเดลแต่งเท่านั้น ไม่ใช้กับผลของ formatter หรือค่าข้อมูล
  - คุยเล่น (`casual_conversation`): `CASUAL_CONVERSATION_SYSTEM_PROMPT`, usage tag `line.casual`, คำตอบไม่เกิน 280 ตัวอักษร (`boundCasualReply`) ข้อความที่ไม่ใช่ธุรกิจถูกจำกัด 300 ตัวอักษร (`NON_BUSINESS_CHARS`)
  - มุข: `mangmee-joke-bank.ts` เป็นคลังที่คัดไว้สำหรับเจ้าของ SME ไทย ใช้แบบผสม 50/50 กับมุขตามสถานการณ์ (มติเจ้าของ 2026-08-31) คำขอมุขไม่ถูกปฏิเสธว่าอยู่นอกขอบเขต
- **การตรวจข้อมูล/ข้อผิดพลาด** `claimsCompletedWrite` ตรวจข้อความที่อ้างว่าเขียนสำเร็จ `safeModelLineText` กรองก่อนส่ง
- **ข้อมูล** — **API** — **หน้าจอ** —
- **การทดสอบ** `gw/line-ai/agents/mangmee-persona.spec.ts`, `semantic-turn-v2-persona-sanitize.spec.ts`, `response-composer.agent.spec.ts`

### FR-LINE-090 ผู้เรียบเรียงคำตอบและการตรวจ grounding

- **คำอธิบาย** `ResponseComposerAgent` สร้างคำตอบจากข้อเท็จจริงของ specialist โมเดลช่วยปรับภาษาได้แต่ห้ามเพิ่มหรือเปลี่ยนตัวเลข รหัส การตัดสินใจ หรือผลลัพธ์
- **ผู้ใช้/permission** —
- **แพ็ก** P-ALL
- **เงื่อนไขก่อนทำ** —
- **ขั้นตอนหลัก** `compose()` ประกอบข้อความแบบกำหนดตายตัวพร้อม `sourceRefs` และ `webLinks` → รอบเรียบเรียง (`line.compose`) → `polishLanguage()` (`line.polish`, `maxTokens: 500`) เป็นชั้นภาษาเสริม
- **กฎธุรกิจและข้อยกเว้น** `preservesGrounding` เทียบชุดตัวเลขก่อนและหลัง (รวมเลขไทย) `preservesSemanticGrounding` ตรวจสถานะเชิงความหมาย (จ่าย/ยังไม่จ่าย, อนุมัติ/ไม่อนุมัติ) ตัวเลขที่อนุญาตมาจากข้อมูลของ tool คำถาม candidate และจำนวนสมาชิกของลิสต์ โมเดลไม่ตอบหรือทำลาย grounding → ใช้ข้อความกำหนดตายตัว ลิงก์เว็บและป้ายแหล่งข้อมูลสร้างที่ gateway จาก `sourceRefs` API เพียง render และแปลงเป็นลิงก์ handoff คำตอบที่เป็นการอ่านสำเร็จหนึ่งครั้งได้การ์ดดีไซน์ล็อกของ tool นั้น (`buildAnswerPresentation`) หลายการอ่านคงเป็นประโยค ข้อมูลที่อาจเก่ามีคำเตือน `⚠️ ข้อมูลอาจไม่ใช่ข้อมูลล่าสุด (อัปเดตล่าสุด: …)`
- **การตรวจข้อมูล/ข้อผิดพลาด** ผลว่างอย่างชัดเจน (`isExplicitEmptyData`) ตอบว่าไม่พบ ไม่แต่งตัวเลขศูนย์ ค่า `null` ใน `SourceFact` หมายถึงไม่ทราบ ไม่ใช่ศูนย์
- **ข้อมูล** — **API** — **หน้าจอ** —
- **การทดสอบ** `gw/line-ai/agents/response-composer.agent.spec.ts`, `semantic-turn-v2-grounding.spec.ts`, `business-read-result-semantics.spec.ts`, `line-ai/application/use-cases/erp-empty-result-semantics.spec.ts`

### FR-LINE-091 Coverage critic: ตรวจว่าตอบครบทุกคำขอ

- **คำอธิบาย** หลังวง tool มีการเรียกโมเดลหนึ่งครั้งเพื่อแตกประโยคของผู้ใช้เป็นคำขอย่อยแล้วตัดสินแต่ละข้อเป็น `covered` / `needs_user` / `uncovered`
- **ผู้ใช้/permission** — **แพ็ก** P-ALL **เงื่อนไขก่อนทำ** เส้นวง tool แบบ native
- **ขั้นตอนหลัก** `CoverageCriticAgent` (`gw/line-ai/agents/coverage-critic.agent.ts`, usage tag `line.critic`) ผลใช้ต่อท้ายคำตอบด้วยคำถามกลับไม่เกินหนึ่งข้อและบรรทัดบอกตรง ๆ ว่าส่วนใดยังไม่ได้ตอบ (`appendCoverageLines`) และให้ API ใช้ ack ledger
- **กฎธุรกิจและข้อยกเว้น** fail-open: ผู้ให้บริการหรือการ parse ล้มเหลวคืน `null` คำตอบส่งต่อได้ ความพร้อมใช้สำคัญกว่าความครบ critic ไม่บล็อกคำตอบ คำขอที่ถูกปฏิเสธตามแผนไม่ถูกนับซ้ำ (`withoutRefusedCoverage`)
- **การตรวจข้อมูล/ข้อผิดพลาด** — **ข้อมูล** — **API** — **หน้าจอ** —
- **การทดสอบ** `gw/line-ai/agents/coverage-critic.agent.spec.ts`

### FR-LINE-092 นโยบายขอบเขต: เรื่องนอกแพ็กและคำขอทำรายการ

- **คำอธิบาย** กฎแบบกำหนดตายตัวที่ตัดสินก่อนเสนอ tool ใด ๆ เพื่อไม่ให้คำถามนอกแพ็กถูกตอบด้วยข้อมูลรายจ่ายแทน และให้คำขอทำรายการได้เหตุผลที่ตรง
- **ผู้ใช้/permission** ตัดสินจาก permission และ entitlement ที่เซิร์ฟเวอร์ให้
- **แพ็ก** P-ALL
- **เงื่อนไขก่อนทำ** —
- **ขั้นตอนหลัก** `scopePolicyOverride` (`gw/line-ai/domain/logic/line-ai-scope-policy.logic.ts`) ใช้ทั้งใน orchestrator (subrequest ที่เข้า fast lane) และ semantic v2 (ทุก subrequest เพื่อให้ข้อความผสมยังตอบส่วนที่ทำได้)
- **กฎธุรกิจและข้อยกเว้น**
  - **เรื่องนอกแพ็ก** (`unsoldModuleTopicFor`): ยอดขาย กำไรขาดทุน ลูกหนี้ ใบแจ้งหนี้ เงินเดือน ธนาคาร สต็อก จัดซื้อ ถ้า feature ไม่อยู่ใน entitlement ของร้าน → ข้อความคงที่จาก `unsoldModuleReplyText` เสนอแพ็กเฉพาะที่ catalog ขายจริงและมี feature นั้น (`featurePackageOffer`) ไม่แต่งชื่อแพ็ก เงินเดือนไม่มี feature ใน catalog เลย จึงเป็น "ไม่รองรับ" เสมอ คำกำกวมถูกจำกัด: "ใบกำกับ" นับเป็นเรื่องออกใบกำกับเมื่อคู่กับกริยาออก/ทำ/สร้าง; "สั่งซื้อ" นับเป็นจัดซื้อเมื่อคู่กับคำผู้ขาย; "เหลือ" และ "ใกล้หมด" เดี่ยว ๆ ไม่นับเป็นสต็อก
  - **คำขอทำรายการ** (`LINE_ACTION_RULES`, `lineActionRuleFor`): รายการที่รองรับเตรียมการ์ดให้กด; การลงนามและอนุมัติใบรับรองแทนใบเสร็จอยู่บนเว็บ ต้องมีเครื่องหมายคำขอ (`ช่วย`, `กรุณา`, `หน่อย`, `ที…`) หรือประโยคคำสั่งขึ้นต้นด้วยกริยา คำบอกสถานะ ("รออนุมัติ", "จ่ายแล้ว") และคำถามสถานะ ("ใช่ไหม", "หรือยัง") ไม่ใช่คำสั่ง การตั้งค่าการอนุมัติเป็นอีกเรื่อง (`isApprovalSettingsRequest`)
  - **บทบาทอ่านอย่างเดียว** ที่ขอบันทึกหรืออัปโหลด ได้คำตอบว่าบทบาททำไม่ได้พร้อมทางเลือก (`permissionAlternative`: หน้ารายจ่าย ใบเบิก หรือแพ็กเกจ) ไม่ใช่การ์ดวิธีทำ
- **การตรวจข้อมูล/ข้อผิดพลาด** entitlement `undefined` หรือ `null` = fail-open (ร้านรุ่นเก่า)
- **ข้อมูล** — **API** — **หน้าจอ** —
- **การทดสอบ** `gw/line-ai/domain/logic/line-ai-scope-policy.logic.spec.ts`

### FR-LINE-093 ความปลอดภัยของบทสนทนาและการปฏิเสธ

- **คำอธิบาย** กรณีวิกฤต ข่าวลือเรื่องส่วนตัว และคำขอเปลี่ยนแปลงข้อมูลขั้นสุดท้าย มีการตอบที่กำหนดไว้
- **ผู้ใช้/permission** — **แพ็ก** P-ALL **เงื่อนไขก่อนทำ** —
- **ขั้นตอนหลัก** (`gw/line-ai/agents/intent-router.agent.ts:980–1010`) `isCrisisMessage` จับรูปประโยคไทยและอังกฤษ 11 แบบ (เช่น `ไม่อยากมีชีวิตอยู่`, `อยากตาย`, `want to die`, `kill myself`) → แผน `UNROUTABLE` เหตุผล `safety_crisis`, `requiresHumanReview = true` ชนะทุกคำขออื่นในข้อความเดียวกัน
- **กฎธุรกิจและข้อยกเว้น** เหตุผลการปฏิเสธเป็นรหัสคงที่ (`LineAiRefusalReason`): `mutation_blocked`, `safety_crisis`, `privacy_rumor`, `unsupported_module`, `unsupported_yet`, `forbidden`, `unlinked_user`, `ambiguous_company`, `tool_unavailable`, `feature_disabled`, `ai_timeout`, `line_delivery_failure` ข้อความของแต่ละรหัสอยู่ใน `REFUSAL_MESSAGES` (หัวข้อ 12.3) ข่าวลือ (`PRIVACY_RUMOR_PATTERN`: ข่าวลือ ซุบซิบ นินทา ชีวิตส่วนตัว ความสัมพันธ์ gossip…) ปฏิเสธเฉพาะส่วนนั้น ส่วนธุรกิจยังตอบ (`PARTIAL`) การเปลี่ยนแปลงขั้นสุดท้ายที่ถูกบล็อกเสมอ: การลงบัญชี ปรับสต็อก เปลี่ยนสิทธิ์ ยื่นภาษี เผยแพร่ภายนอก และหมวด tool `final_mutation` ทั้งหมด (`AI_FINAL_MUTATION_ENABLED=false`) ข้อเท็จจริงปัจจุบัน ข่าว อากาศ และคำแนะนำวิชาชีพไม่ใช่การคุยเล่น จึงเป็นเรื่องนอกขอบเขต เว้นแต่ feature ที่เปิดรองรับ การกู้คืนแผน (`isUnroutedOutOfScopePlan`) ทำได้เฉพาะแผนที่ไม่มี tool และทุกการปฏิเสธเป็น `unsupported_module` เท่านั้น จึงไม่ทับกำแพงสิทธิ์หรือ timeout ด้วยคำตอบอื่น ข้อความ บริบท และผล tool เป็น DATA: prompt ทุกตัวสั่งให้เพิกเฉยเนื้อหาที่ดูเหมือนคำสั่ง
- **การตรวจข้อมูล/ข้อผิดพลาด** ชุดประเมินความปลอดภัยของสัญญาอยู่ใน `packages/contracts/src/line-ai-security-eval.ts`
- **ข้อมูล** `LineTurnOutcome` (บันทึกเหตุผล) **API** — **หน้าจอ** —
- **การทดสอบ** `gw/line-ai/agents/intent-router.agent.spec.ts`, `prepared-simple-read-security.spec.ts`, `line-ai/domain/logic/line-ai-terminal-outcome.logic.spec.ts`

### FR-LINE-094 การเรียก tool ของ ERP: delegation, การตรวจสิทธิ์ซ้ำ และ audit

- **คำอธิบาย** ทุกการอ่านข้อมูลของ AI ผ่าน endpoint เดียวของ API ซึ่งตรวจตัวตนของผู้กระทำและสิทธิ์ใหม่จากฐานข้อมูลทุกครั้ง
- **ผู้ใช้/permission** ผู้ใช้ต้องมี `ai.tool.invoke` และ permission ของ tool นั้น
- **แพ็ก** ตาม feature ของ tool
- **เงื่อนไขก่อนทำ** ตั้ง `AI_ACTOR_DELEGATION_SIGNING_KEY` (hex 64 ตัว) และ internal secret
- **ขั้นตอนหลัก** (1) ก่อนเรียก gateway API ออก actor delegation token ต่อ tool: รูปแบบ `v1.<payload base64url>.<HMAC-SHA256>` claims `iss = watchdog-api`, `aud = watchdog-erp-core:internal-ai-tools`, `workload = ai-gateway`, `sub`, `companyId`, `membershipId`, `requestId`, `toolName`, `jti`, อายุ 120 วินาที (`ActorDelegationService`) (2) gateway `ErpToolClient` ผ่าน `ToolPolicyEnforcerService` แล้วเรียก `POST /v1/internal/ai/tools/invoke` พร้อม header `x-internal-secret` และ `x-actor-delegation` timeout `AI_TOOL_TIMEOUT_MS` (ค่าเริ่มต้น 10,000 ms) (3) API `consume` token (ใช้ครั้งเดียว เก็บ `jti` ใน Redis แบบ `SET NX EX`) (4) `PermissionResolverService.resolveAccess(userId, companyId)` จากฐานข้อมูล (5) ไล่ลำดับปฏิเสธ (6) `tool.execute(ctx, input)` (7) บันทึกหลักฐานการอ่าน (`LineReadEvidenceService`) และ audit
- **กฎธุรกิจและข้อยกเว้น** ลำดับปฏิเสธ (คอมเมนต์ L-08): ไม่มีใน registry → `TOOL_NOT_FOUND`; ผู้ใช้ไม่ active หรือ opt-out → `ACTOR_INACTIVE`; หมวดไม่อนุญาตในเฟสนี้ → `AI_TOOL_CATEGORY_DENIED` (เหตุผลย่อย `TOOL_CATEGORY_UNKNOWN`, `AI_FINAL_MUTATION_DISABLED`, `LINE_DRAFT_EDIT_DISABLED`, `LINE_REIMBURSEMENT_DRAFT_WRITE_DISABLED`, `TOOL_CATEGORY_NOT_ALLOWED`); ขาด permission → `ERP_PERMISSION_DENIED` หรือ `FEATURE_NOT_ENABLED` เมื่อ permission ถูกตัดเพราะ feature ปิด; ร้านไม่มี feature ของ tool → `FEATURE_NOT_ENABLED`; tool ยังไม่ผูกใน build → `SOURCE_MODULE_NOT_READY`; ฟิลด์ input นอกที่ประกาศ ค่า enum ผิด หรือความยาวข้อความนอกช่วง → `UNSUPPORTED_FILTER` หมวดที่อนุญาต: `read_summary`, `read_detail`, `report`, `suggestion`, `evidence_capture` บวก `draft_update` เมื่อเปิดการแก้ร่าง และ tool เตรียมการ์ด 3 ตัว (`expense.action.preview`, `counterparty.action.preview`, `company.action.preview`) ที่ผ่านเสมอ permission, branch, role, membership และ company ที่ผู้เรียกส่งมาถูกเพิกเฉย claims ที่ตรวจแล้วชนะ body ผลของ tool ที่ชื่อไม่ตรงกับที่ขอถูกปฏิเสธ (`LINE_READ_RESULT_TOOL_MISMATCH`) ข้อความ grounding ที่ส่งมากับคำขอถูกตัดที่ความยาวเดียวกันทั้งสองฝั่ง (`GROUNDING_TEXT_MAX_CHARS`)
- **การตรวจข้อมูล/ข้อผิดพลาด** delegation ผิด → 401 พร้อม security event `ai.tool.invoke.denied` (ไม่เขียน audit ถาวรเพราะยังไม่มีอะไรถูกยืนยัน) delegation ของบริษัท/สมาชิกภาพอื่น → `STALE_ACTOR_DELEGATION` (เขียน audit กับบริษัทที่ยืนยันแล้ว) การปฏิเสธทุกกรณีหลังยืนยันตัวตนเขียน `AuditLog` แบบ fail-closed (`logOrThrow`) การ consume delegation เขียน `AI_ACTOR_DELEGATION_CONSUME` tool ที่ `sensitiveAudit` เขียน `AI_TOOL_INVOKE` พร้อม `sourceRefs` เมื่อสำเร็จ การรันล้มเหลวเขียน `AI_TOOL_INVOKE_FAILED` metadata ของ audit เก็บเฉพาะชื่อ tool รหัสเหตุผล และระยะเวลา ไม่เก็บ input
- **ข้อมูล** `AuditLog`, `AiToolInvocation`, `AiToolInvocationLog`, `LineReadEvidence`
- **API** `POST /v1/internal/ai/tools/invoke`
- **หน้าจอ** —
- **การทดสอบ** `line-ai/presentation/http/internal-tools.controller.spec.ts`, `line-ai/infrastructure/actor-delegation.service.spec.ts`, `line-ai/application/line-read-evidence.spec.ts`, `line-ai/line-read-evidence.pg.spec.ts`, `gw/line-ai/infrastructure/erp-tool.client.spec.ts`, `common/ai/tool-policy-enforcer.spec.ts`

### FR-LINE-095 ทะเบียน tool

- **คำอธิบาย** `LINE_TOOL_REGISTRY` (`packages/contracts/src/ai-tools.ts:408`) เป็นสัญญาเดียวที่ gateway และ API ใช้ร่วมกัน: ชื่อ หมวด permission feature ฟิลด์ input และค่า enum
- **ผู้ใช้/permission** ตามตาราง
- **แพ็ก** ตามคอลัมน์สุดท้าย
- **เงื่อนไขก่อนทำ** —
- **ขั้นตอนหลัก** `lineToolRegistryFor(flags)` คืนชุดที่ runtime เห็นตามสวิตช์ `hasToolPermissions` และ `hasToolFeature` ใช้ทั้งสองฝั่ง
- **กฎธุรกิจและข้อยกเว้น** tool ที่อยู่ในแพ็กที่ขาย (feature ใน preset `starter` หรือ P-ENT):

| tool | หมวด | permission ที่ registry บังคับ | feature | แพ็ก |
|---|---|---|---|---|
| `company.get_current_context` | read_summary | `company.setup.read` | (ค่าเริ่มต้นของโมดูล) | P-ALL |
| `company.list_branches` | read_summary | `company.branch.read` | (โมดูล) | P-ALL |
| `company.get_employee_summary`, `company.get_employee_detail` | read | `access.employee.read` | (โมดูล) | P-ALL |
| `company.get_roles` | read_detail | (นโยบายใน tool) | — | P-ALL |
| `company.action.preview` | เตรียมการ์ด | (use case ของเว็บ) | — | P-ALL |
| `dashboard.get_business_health_summary` | read_summary | `dashboard.read` | (โมดูล) | P-ALL |
| `notifications.list_open_alerts`, `notifications.get_daily_summary` | read_summary | `notification.read` | (โมดูล) | P-ALL |
| `expense.list_recent`, `expense.get_detail`, `expense.explain_record`, `expense.get_breakdown`, `expense.get_daily_closing`, `expense.list_substitute_receipts_to_sign` | read | (นโยบาย own/related/company ใน tool; `anyOfPermissions`) | (โมดูล expenses) | P-ALL |
| `line.explain_file_attempt` | read_detail | — | `expenses` | P-ALL |
| `expense.action.preview` | เตรียมการ์ด | (ตาม action) | `expenses` | P-ALL |
| `expense.draft.set_header` / `set_line` / `add_charge` / `remove_line` / `set_vat_mode` | draft_update | `expense.update` | (โมดูล) | P-ALL |
| `counterparty.search` | read_detail | `accounting.counterparty.read` | `expenses`, `sales_documents` | P-ALL |
| `counterparty.get_detail`, `counterparty.action.preview` | read / เตรียมการ์ด | (นโยบายใน tool) | `expenses`, `sales_documents` | P-ALL |
| `reimbursement.list_pending_approvals`, `reimbursement.get_summary`, `reimbursement.get_detail`, `reimbursement.get_approval_backlog` | read | (นโยบายใน tool) | (โมดูล reimbursements) | P-ALL |
| `reimbursement.draft.get_options`, `reimbursement.draft.preview_update` | draft_create | (นโยบายใน tool) | (โมดูล) | P-ALL |
| `reimbursement.draft.preview_create` | draft_create | `reimbursement.create` | (โมดูล) | P-ALL |
| `voucher.list_recent`, `voucher.get_detail` | read | `expense.disbursement.read` | `expenses` | P-ALL |
| `billing.get_package_usage`, `billing.get_package_catalog` | read_summary | `ai.tool.invoke` | (billing) | P-ALL |
| `wht.get_month_summary`, `wht.calculate_withholding` | read_summary | (นโยบายใน tool) | `wht_50bis`, `wht_pnd53` | P-ENT |
| `public.lookup` | read_summary | `ai.tool.invoke` | — | ปิดเป็นค่าเริ่มต้น (`LINE_AI_PUBLIC_LOOKUP_ENABLED=false`) |

  `billing.get_package_usage` ถูกเสนอให้ทุกคนเพื่อให้ผู้ที่ไม่ใช่ผู้จัดการแพ็กได้คำปฏิเสธแบบมีชนิด ผู้ที่มี `company.plan.manage` เท่านั้นที่ถูกบอกว่าผู้ช่วยตอบเรื่องนี้ได้ ผลรวมค่าเครดิตต่อเดือนใน catalog ใช้ `DEFAULT_CHAT_CREDIT_SATANG / 100` จังหวะการใช้ของแพ็กคำนวณด้วย `packagePace` (สูตร `package-pace-v1`, ต้องมีข้อมูลอย่างน้อย 7 วัน) รูปผลของ tool (`ToolResult`): `status` (`ok`/`forbidden`/`unsupported_module`/`unavailable`/`error`), `sourceRefs` (ทุกตัว `permissionChecked: true`), `asOf`, `stale`, `queryApplied` (ช่วงเวลา สาขา ฐานวันที่ ฐานสถานะ `accessScope`), `facts` (`SourceFact` พร้อมสถานะ `known`/`empty`/`unknown`/`conflict`), `completeness` tool ที่เหลือใน registry (รวม 85 ชื่อ) เป็นของโมดูลที่ไม่มีแพ็กขาย ดูหัวข้อ 17
- **การตรวจข้อมูล/ข้อผิดพลาด** spec ตรวจความสอดคล้องระหว่าง registry กับ tool ที่ผูกจริงทั้งสองฝั่ง
- **ข้อมูล** ตามโมดูลต้นทาง
- **API** `POST /v1/internal/ai/tools/invoke`
- **หน้าจอ** —
- **การทดสอบ** `gw/line-ai/agents/agent-tools.parity.spec.ts`, `agent-tools.registry.spec.ts`, `line-ai/line-ai-capability-manifest.spec.ts`, ไฟล์ `line-ai/application/use-cases/erp-*-tools.use-case.spec.ts` (12 ไฟล์), `erp-source-reliability.pg.spec.ts`, `package-usage.pg.spec.ts`

### FR-LINE-096 การเลือกผู้ให้บริการและโมเดล

- **คำอธิบาย** จุดเดียวที่สร้างผู้ให้บริการโมเดลคือ `createProvider` ทุก agent ทุกโมดูลผ่านจุดนี้
- **ผู้ใช้/permission** ผู้ดูแลแพลตฟอร์มตั้งโมเดลต่อร้านได้ (`system.partner_ai_model.manage`)
- **แพ็ก** —
- **เงื่อนไขก่อนทำ** ตั้ง `MODEL_PROVIDER` (`disabled` ค่าเริ่มต้น / `bedrock` / `openai`)
- **ขั้นตอนหลัก** (`gw/line-ai/infrastructure/provider/provider.factory.ts`) ลำดับการเลือกโมเดล: โมเดลใน budget grant ที่ลงลายเซ็น → `opts.modelId` ของ route → โมเดลของ envelope → ค่าเริ่มต้นของ deployment (`BEDROCK_MODEL_ID` / `OPENAI_MODEL`) งานเข้าใจเอกสาร (stage 2 ของใบเสร็จและรายการเดินบัญชี) ใช้ `DOCUMENT_AI_MODEL_ID` ได้ ถ้าไม่ตั้งถอยไป `BEDROCK_MODEL_ID` นโยบายต่อร้าน: `CompanyAiConfiguration.modelId` (`resolveCompanyAiModelPolicy`) ค่า `null` คือใช้ค่าเริ่มต้นของแพลตฟอร์ม
- **กฎธุรกิจและข้อยกเว้น** `assertApproved` ตรวจผู้ให้บริการ โมเดล และภูมิภาคกับ allowlist: `APPROVED_AI_PROVIDERS` (ค่าเริ่มต้น `bedrock,openai`), `APPROVED_AI_MODEL_IDS` (ค่าเริ่มต้น `apac.anthropic.claude-3-5-sonnet-20241022-v2:0`, `apac.anthropic.claude-3-haiku-20240307-v1:0`), `APPROVED_AI_REGIONS` (ค่าเริ่มต้น `ap-southeast-1`) การใช้ global inference profile ต้องตั้ง `AI_GLOBAL_INFERENCE_PROFILE_APPROVED=true` พร้อม `AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF` (การประมวลผลข้ามพรมแดน) โมเดลที่มีเพดาน context ที่ทบทวนแล้ว (`reviewed-line-model-capacity.ts`): `global.anthropic.claude-sonnet-4-6` (200,000 / 64,000), `global.anthropic.claude-haiku-5-5` (100,000 / 8,192), Claude 3.5 Sonnet และ 3 Haiku ของ APAC, `gpt-4.1-mini` โมเดลที่ไม่อยู่ในตารางนี้ใช้กับ budget v2 ไม่ได้ `ANTHROPIC_API_KEY` ใช้ได้เฉพาะ `APP_ENV=local` (สำหรับ evaluation) ไม่งั้น process throw โมเดลของร้านที่ไม่อยู่ใน allowlist → `TENANT_AI_MODEL_NOT_APPROVED` (fail-closed) ภายใต้ budget grant ผู้ให้บริการ ภูมิภาค และโมเดลถูกตรึงตาม grant ถ้าภูมิภาคของ deployment ไม่ตรง → `DisabledProvider`
- **การตรวจข้อมูล/ข้อผิดพลาด** `AI_PROVIDER_NOT_APPROVED`, `AI_MODEL_NOT_APPROVED`, `AI_REGION_NOT_APPROVED` Bedrock throttle: ลองใหม่ไม่เกิน 2 ครั้ง (`THROTTLE_MAX_RETRIES`) backoff สุ่ม 400–1,200 ms ภายในการเรียกเดียวและเฉพาะเมื่อยังมีเวลาก่อนเส้นตาย คำตอบของ OpenAI จำกัด 2 MB
- **ข้อมูล** `CompanyAiConfiguration`
- **API** `PUT /v1/system/partners/:partnerCompanyId/ai-model` (`system.partner_ai_model.manage`)
- **หน้าจอ** หน้ารายละเอียดพาร์ทเนอร์ของผู้ดูแลระบบ (`PartnerDetailPage.tsx`)
- **การทดสอบ** `gw/line-ai/infrastructure/provider/bedrock.provider.spec.ts`, `openai.provider.spec.ts`, `disabled.provider.spec.ts`, `line-ai/application/company-ai-model-policy.spec.ts`
- **หมายเหตุ** บันทึกงานของทีมระบุว่ารอบสุดท้ายใช้ Sonnet สำหรับตัวจำแนกงานหลังพบว่า Haiku ติดป้ายผิด 11 จาก 70 กรณี ค่าที่ใช้จริงขึ้นกับ environment ซึ่งตรวจไม่ได้แล้ว

### FR-LINE-097 Prompt caching และโครงสร้างของ prompt

- **คำอธิบาย** prompt ถูกจัดให้ส่วนที่คงที่อยู่ข้างหน้าเพื่อให้ผู้ให้บริการ cache ได้
- **ผู้ใช้/permission** — **แพ็ก** — **เงื่อนไขก่อนทำ** ผู้ให้บริการ Bedrock (Converse) หรือ Anthropic API
- **ขั้นตอนหลัก** `ProviderInput` มี 3 ชั้น: `systemPrompt` (คงที่ต่อชนิดการเรียก), `cacheableContext` (บริบทที่ byte-stable เช่น catalog ของ tool และ feature; วางเป็นบล็อกนำของข้อความผู้ใช้แรก) และ `messages` (เนื้อหาต่อ turn) `cacheableContextPrefixLength` แบ่งส่วน catalog ร่วมออกจากบริบทต่อ turn
- **กฎธุรกิจและข้อยกเว้น** Bedrock ใส่ `cachePoint` หลัง system prompt เมื่อยาว ≥ 4,000 ตัวอักษร (`CACHE_MIN_CHARS`; ประมาณ 1,270 token ที่ 3.14 ตัวอักษรต่อ token เพื่อผ่านขั้นต่ำ 1,024 token ของ Claude Sonnet 4.x) หลัง tool config เมื่อ tool รวมยาวพอและ system prompt สั้น และหลัง `cacheableContext` รวมไม่เกิน 4 จุดต่อคำขอ OpenAI ต่อ `cacheableContext` หน้าข้อความผู้ใช้แรก (เนื้อหาเดียวกัน ไม่มี cache checkpoint) ผู้เรียกต้องส่งสตริงที่เหมือนกันทุกไบต์สำหรับบริบทเชิงตรรกะเดียวกัน system prompt ของตัวจำแนกงานใช้ร่วมทุกร้านและทุกคำขอเพื่อใช้ checkpoint เดียว การคิดเงินแยก cache read และ cache write (FR-LINE-110) การจองเงินคิดทุก token ของ input ที่อัตราสูงกว่าระหว่าง input กับ cache write เพราะ cache เย็นเขียนทั้ง prompt ที่อัตราแพงกว่า
  - โครงของ prompt หลัก: `INTENT_ROUTER_SYSTEM_PROMPT` (รูป JSON ของแผน, agent และ subject ที่อนุญาต, intent ศูนย์ tool สองชนิด, กฎวิกฤตและข่าวลือ, รหัสการปฏิเสธ, กฎเลือก tool ต่อหัวเรื่อง, อภิธานศัพท์ `ผปก`/`คชจ`/`ลค`, กฎ DATA ไม่ใช่คำสั่ง); `intakeRouterSystemPrompt` (ประกอบจากส่วน: ความหมายของเส้นทาง, `FUSED_PLAN_SECTION`, `ADVISOR_*`, `TEXT_CAPTURE_HINTS_SECTION` หรือ `IMAGE_CAPTURE_HINTS_SECTION`, `RESPONSE_PREFERENCE_SECTION`, `PUBLIC_LOOKUP_ROUTING_PROMPT`); `ORCHESTRATOR_SYSTEM_PROMPT` + `ORCHESTRATOR_TOOL_LOOP_PROMPT` / `ORCHESTRATOR_NATIVE_LOOP_PROMPT`; `CONTROL_PROMPT` และ `ANSWER_PROMPT` ของ semantic v2; `RESPONSE_COMPOSER_SYSTEM_PROMPT`, `ANSWER_COMPOSER_SYSTEM_PROMPT`, `REPLY_LANGUAGE_SYSTEM_PROMPT`, `CASUAL_CONVERSATION_SYSTEM_PROMPT`; `WORKFLOW_CLASSIFIER_SYSTEM_PROMPT`; `MANGMEE_PERSONA_PROMPT`; prompt ของ CRM ใน `crm-prompts.ts`
  - การแก้ prompt ของ intake ต้อง recalibrate ตัวประมาณ token (`scripts/recalibrate-line-intake.cjs`, `common/usage/intake-token-calibration.ts`) เพราะ budget v2 ตรวจขอบ input ด้วยตัวประมาณรุ่น `utf8-split-prefix-v4`
- **การตรวจข้อมูล/ข้อผิดพลาด** `AI_PROMPT_LOGGING_ENABLED=false` เป็นค่าเริ่มต้น prompt ไม่ถูก log
- **ข้อมูล** — **API** — **หน้าจอ** —
- **การทดสอบ** `gw/line-ai/infrastructure/provider/bedrock.provider.spec.ts`, `common/logger/log-redaction.spec.ts`

### FR-LINE-098 อ่านเอกสาร: receipt-ocr, capture-read, capture-extract, bank-statement-extract

- **คำอธิบาย** route อ่านเอกสารของ gateway ใช้ทั้งทาง LINE และทางเว็บ
- **ผู้ใช้/permission** ผู้เรียกคือ API ซึ่งตรวจสิทธิ์และจองสิทธิ์อ่านแล้ว
- **แพ็ก** `receipt-ocr`, `capture-*`: P-ALL และ P-FREE; `bank-statement-extract`: โมดูลธนาคารไม่มีแพ็กขาย
- **เงื่อนไขก่อนทำ** budget envelope ถูกต้อง
- **ขั้นตอนหลัก** `receipt-ocr`: stage 1 อ่านภาพ (`ocr.receipt.image-read`) → stage 2 เข้าใจและสกัด (`ocr.receipt.extract`, output ไม่เกิน 8,192 token) → อ่านภาพซ้ำหนึ่งครั้งเมื่อรายการครบแต่ยอดรวมต่างโดยอธิบายไม่ได้ → stage 2 อีกรอบ PDF อ่านผ่าน document block ของ Bedrock
- **กฎธุรกิจและข้อยกเว้น** เวลาต่อการเรียกผู้ให้บริการ 45 วินาที (`AI_DOCUMENT_OCR_TIMEOUT_MS`) หรือ 90 วินาทีสำหรับ PDF และหน้าทรงสูง (`AI_DOCUMENT_PAGE_TIMEOUT_MS`) จำนวนการเรียกสูงสุด: ใบเสร็จ 8, รายการเดินบัญชี 3 ฝั่ง API รอ `จำนวนการเรียก × 90 วินาที + 15 วินาที` (ใบเสร็จ = 735 วินาที) เพื่อให้ timeout ฝั่งผู้เรียกเกิดเฉพาะเมื่อ gateway หายจริง ถ้าผู้เรียกตัดก่อน ต้นทุนจริงจะหลุดจากทั้งสองมิเตอร์ ภาพที่ส่งให้โมเดลไม่เกิน 3,500,000 ไบต์ ข้อความเอกสารที่ส่งต่อ 24–20,000 ตัวอักษร เลขเอกสารไม่เกิน 50 ตัวอักษร ที่อยู่ผู้ขายไม่เกิน 500
- **การตรวจข้อมูล/ข้อผิดพลาด** การปฏิเสธก่อนถึงผู้ให้บริการ (`isOcrPreProviderRefusal`) คืนสิทธิ์ที่จอง ความล้มเหลวของผู้ให้บริการที่ลองใหม่ได้ (`isOcrRetryableProviderFailure`) ใช้ lease `LINE_OCR_RETRY_ACTIVE`
- **ข้อมูล** — (gateway) ; ฝั่ง API `CompanyOcrUsageEvent`
- **API** gateway `POST /internal/ai/receipt-ocr`, `capture-read`, `capture-extract`, `bank-statement-extract`
- **หน้าจอ** —
- **การทดสอบ** `gw/line-ai/presentation/http/expense-capture-routes.spec.ts`, `line-ai-internal.controller.spec.ts`, `scripts/run-line-ai-controlled-image-replay.mjs`

### FR-LINE-099 คำถามทั่วไปของผู้ที่ไม่มีบริบทส่วนตัว และการค้นข้อมูลสาธารณะ

- **คำอธิบาย** ช่องตอบคำถามทั่วไปแบบไม่มีสถานะ ไม่ใช้ membership โปรไฟล์ร้าน บริบท หรือการอ่าน ERP
- **ผู้ใช้/permission** ตัดสินจากการรับเข้าสาธารณะ (`publicAdmission`) ที่ระบุบริษัทผู้จ่าย
- **แพ็ก** ขึ้นกับการรับเข้า; ช่องทางที่อนุญาตตั้งด้วย `LINE_AI_DELIVERY_PLAN_V2_PUBLIC_CHANNEL_IDS`
- **เงื่อนไขก่อนทำ** reliability v2 เปิด; grant และหลักฐาน input ตรงกับสถานะ budget
- **ขั้นตอนหลัก** API `preflightPublicGeneral` → `executePublicGeneral` (`:7911`) → gateway `POST /internal/ai/line/public-general` เรียกโมเดลด้วย `CASUAL_CONVERSATION_SYSTEM_PROMPT`, `maxTokens: 1,536` คำตอบต้องไม่ขึ้นต้นด้วย `[` หรือ `{` และยาวไม่เกิน 8,000 ตัวอักษร
- **กฎธุรกิจและข้อยกเว้น** tool `public.lookup` (ค้นข้อมูลสาธารณะผ่านเครื่องมือของผู้ให้บริการ, โปรไฟล์งบ `public-lookup/2`: 32,000 / 4,096 token, 1 การเรียก, 2 หน่วยเครื่องมือ) ปิดเป็นค่าเริ่มต้น ผลลัพธ์ถูกตรวจด้วย `public-lookup-output.logic.ts`
- **การตรวจข้อมูล/ข้อผิดพลาด** `AI_CONTRACT_UNSUPPORTED`, `PUBLIC_GENERAL_INCOMPLETE`, `PUBLIC_GENERAL_SCHEMA_INVALID`
- **ข้อมูล** `LineDeliveryPlan`, `LineTurnOutcome`
- **API** gateway `POST /internal/ai/line/public-general`
- **หน้าจอ** —
- **การทดสอบ** `line-ai/application/use-cases/line-public-general.spec.ts`, `line-ai/infrastructure/public-lookup.spec.ts`, `gw/line-ai/infrastructure/provider/public-lookup.spec.ts`, `packages/contracts/src/line-ai-public-lookup.spec.ts`
- **หมายเหตุ** เงื่อนไขที่ทำให้ข้อความหนึ่งเข้าช่องนี้แทนการ์ดประตู (FR-LINE-010) ไม่ได้ตรวจละเอียด

### FR-LINE-100 AgentCore runtime

- **คำอธิบาย** orchestrator ถูกแพ็กเป็น artifact ของ Amazon Bedrock AgentCore gateway เรียกแบบ server-to-server
- **ผู้ใช้/permission** IAM (SigV4); LINE และเว็บห้ามเรียกโดยตรง
- **แพ็ก** —
- **เงื่อนไขก่อนทำ** `LINE_AI_AGENT_RUNTIME=agentcore`, ตั้ง `AGENTCORE_REGION`, `AGENTCORE_RUNTIME_ARN`, `AGENTCORE_RUNTIME_QUALIFIER`
- **ขั้นตอนหลัก** `agentcore.json`: runtime ชื่อ `orchestrator`, build `CodeZip`, entrypoint `dist/agentcore/runtime.js`, `NODE_22`, network `PUBLIC`, protocol `HTTP` runtime เปิด `GET /ping` และ `POST /invocations` ที่พอร์ต 8080 (`apps/ai-gateway/src/agentcore/runtime.ts`) `AgentCoreRuntimeClient` ส่ง POST ที่ลงลายเซ็น SigV4 โดยใช้ credential chain ของ `BedrockRuntimeClient` ARN เข้ารหัสในพาธ qualifier เป็น query session id เป็น UUID ต่อการเรียก (ต้องยาว ≥ 33 ตัวอักษร)
- **กฎธุรกิจและข้อยกเว้น** timeout การเรียก `AGENTCORE_INVOKE_TIMEOUT_MS` (ค่าเริ่มต้น 20,000 ms); การ probe ความสามารถไม่เกิน 3,000 ms ขีดจำกัดขาเข้า (บังคับระหว่าง stream ไม่ใช่หลัง buffer): body 1 MiB, ข้อความ 8,000 ตัวอักษร, ไฟล์แนบ 10, การเรียกพร้อมกัน 16 body เกิน → 413 พร้อมรอ 250 ms เพื่อให้ผู้เรียกได้รับคำตอบก่อนปิด socket runtime ดึงความลับของตัวเองจาก ARN ตอน boot เพราะตัวแปรของ AgentCore อ่านได้โดยผู้ที่เรียก `GetAgentRuntime` ได้ การตรวจตัวตนของ artifact: `AGENTCORE_EXPECTED_SOURCE_COMMIT`, `AGENTCORE_EXPECTED_ARTIFACT_SHA256`, `AGENTCORE_EXPECTED_CONTRACT_VERSION` ไม่ตรง → fail-closed ผล "ใช่" ของ probe ความสามารถงบ v2 ถูกจำไว้ใน process ไม่กี่นาที ผล "ไม่" ไม่ถูกจำ ไม่มีเส้นทางใดของ runtime อ่านสวิตช์ความสามารถของ LINE AI จาก environment (มติเจ้าของ 2026-09-29) payload ทุกฟิลด์ถูก parse ใหม่ทีละฟิลด์ ไม่ cast ผลของ artifact เป็น JSON ที่ไม่ไว้ใจ gateway คัดเฉพาะฟิลด์ตามสัญญา
- **การตรวจข้อมูล/ข้อผิดพลาด** timeout → error code `TIMEOUT` พร้อมเวลาที่ใช้ `/ping` ตอบ liveness เท่านั้น ไม่เปิดเผยชื่อ service
- **ข้อมูล** —
- **API** AgentCore `POST /invocations`, `GET /ping`
- **หน้าจอ** —
- **การทดสอบ** `agentcore/runtime.spec.ts`, `agentcore/runtime-minimal-env.spec.ts`, `gw/line-ai/infrastructure/runtime/agentcore-runtime.client.spec.ts`, `gw/line-ai/presentation/http/line-reliability-capabilities.controller.spec.ts`, `scripts/line-ai-reliability-compiled-smoke.cjs`

### FR-LINE-101 AI แนะนำ (ai-draft)

- **คำอธิบาย** ผู้ใช้เว็บขอให้ AI เขียนข้อเสนอแนะทางธุรกิจจากข้อเท็จจริงที่ API รวบรวมให้ AI เสนอได้แต่ไม่อนุมัติ ลงบัญชี จ่าย หรือยื่นอะไร
- **ผู้ใช้/permission** `ai.suggestion.request` (ขอ), `ai.suggestion.read_own` (อ่าน), `ai.draft.review` (ตรวจ action), `ai.draft.create_source_draft` (สร้างร่างต้นทาง), `ai.suggestion.review` (รีวิว) และ permission ของแหล่งข้อมูลตามแม่แบบ
- **แพ็ก** เมนู `ai-suggestions` ผูกกับ `ai_line_assistant` (P-ALL) แต่แม่แบบทั้ง 5 ต้องมี permission ของโมดูลที่ไม่มีแพ็กขาย: `cfo_cash_risk_summary` (`bank.cash.read`), `crm_followup_next_action` (`crm.customer.read`), `inventory_reorder_review` (`inventory.report.read`), `tax_evidence_checklist` (`tax.review_issue.read`), `workflow_review_checklist` (`workflow.task.read`) ในแพ็กที่ขายจึงไม่มีแม่แบบใดใช้ได้จริง (`hasAiSuggestionSourceAccess`)
- **เงื่อนไขก่อนทำ** ร้านมี `ai_line_assistant`
- **ขั้นตอนหลัก** (1) เว็บสร้างคำขอ (`POST …/ai/suggestions/requests`) (2) worker เรียก `POST /v1/internal/ai/draft-requests/drain` ทุก 15 วินาที (3) API รวบรวม facts และ citations แล้วเรียก gateway `POST /internal/ai/draft-generate` (4) `GenerateDraftUseCase` เรียกโมเดล (`ai.draft`, `maxTokens: 900`) ให้คืน JSON `{title, summary, recommendation, riskLevel, confidence, actionTitle, checklistItems}` (5) API ตรวจซ้ำและบันทึก
- **กฎธุรกิจและข้อยกเว้น** system prompt ระบุบุคลิกน้องมั่งมี ให้อ้างเฉพาะ FACTS/CITATIONS ห้ามแต่งตัวเลข รหัส ลูกค้า `riskLevel` รับเฉพาะ `LOW`/`MEDIUM`/`HIGH`; `confidence` ถูกจำกัด 0–1; checklist ไม่เกิน 20 ข้อ โปรไฟล์งบ `draft-generate`: 20,000 / 900 token, 1 การเรียก รหัสปฏิเสธด้านงบชนะรหัสของผู้ให้บริการ เพื่อไม่ให้งานลองซ้ำกับด่านที่ปิด
- **การตรวจข้อมูล/ข้อผิดพลาด** `MODEL_OUTPUT_INVALID` (ไม่ใช่ JSON หรือขาด summary/recommendation), payload ขาด `templateKey`/`facts` → 400
- **ข้อมูล** `AiDraftRequest`, `AiSuggestion`, `AiSuggestionCitation`, `AiDraftArtifact`, `AiCandidateAction`, `AiSuggestionReview`
- **API** `POST/GET /v1/companies/:companyId/ai/suggestions…`, `GET …/ai/suggestion-templates`, `GET …/ai/provider-status`, `POST /v1/internal/ai/draft-requests/drain`, `POST /v1/internal/ai/draft-requests/generate`, gateway `POST /internal/ai/draft-generate`
- **หน้าจอ** `/companies/[companyId]/ai-suggestions`
- **การทดสอบ** `apps/ai-gateway/src/modules/ai-draft/generate-draft.use-case.spec.ts`, `e2e/ai-suggestions.spec.ts`, `apps/web/src/features/ai-suggestions/ai-suggestions.logic.spec.ts`

### FR-LINE-102 AI ของ CRM ใน gateway (crm-customer-ai)

- **คำอธิบาย** 8 route สำหรับกล่องข้อความลูกค้าของร้าน: สกัดการจอง จำแนกข้อความลูกค้า สกัดโปรไฟล์ ร่างคำตอบ คะแนนความน่าเชื่อถือ สรุปบทสนทนา ข้อมูลเชิงลึก และข้อความ broadcast
- **ผู้ใช้/permission** ผู้เรียกคือ API ของ CRM inbox (permission กลุ่ม `crm.ai.*` ผูกกับ `ai_line_assistant` ใน `feature-gate.logic.ts`)
- **แพ็ก** ไม่มีแพ็กขาย (ต้องมี feature `crm` / `crm.inbox` / `line_oa`) ดูหัวข้อ 17
- **เงื่อนไขก่อนทำ** internal secret
- **ขั้นตอนหลัก** `CrmCustomerAiInternalController`: `crm-booking-extract`, `crm-intake`, `crm-customer-profile-extract` (ข้อความ 2–2,000 ตัวอักษร), `crm-reply-draft` (โหมด `STAFF_ASSIST` / `AUTONOMOUS`, โทนไม่เกิน 100 ตัวอักษร), `crm-trust-score` (dormant: คะแนนกำหนดตายตัวไม่ได้มาจากที่นี่), `crm-summary`, `crm-insights`, `crm-broadcast`
- **กฎธุรกิจและข้อยกเว้น** แต่ละ route สร้างผู้ให้บริการด้วยโมเดลจาก `modelPolicy` ของคำขอ โปรไฟล์งบต่อ route: input 20,000 token, output 200–1,600 token, 1 การเรียก (`AI_BUDGET_STEP_BOUNDS`) มี spec แยกยืนยันว่าโมดูลนี้ไม่ใช้ร่วมกับ LINE AI ของพนักงาน (`crm-customer-ai.separation.spec.ts`)
- **การตรวจข้อมูล/ข้อผิดพลาด** payload ไม่ผ่านตัวตรวจ → 400
- **ข้อมูล** — **API** gateway `POST /internal/ai/crm-*` **หน้าจอ** เว็บ CRM inbox และ `/companies/[companyId]/settings/line-oa`
- **การทดสอบ** `apps/ai-gateway/src/modules/crm-customer-ai/**/*.spec.ts` (10 ไฟล์)

---

## 10. กลุ่ม H — การวัดการใช้ งบ AI และเครดิตแชต

หน่วยเงินในกลุ่มนี้เป็นสตางค์จำนวนเต็ม เดือนอ้างอิงตามเวลา Asia/Bangkok (`bangkokMonthKey`) การใช้ AI แบ่งเป็นสองถัง: `CHAT` (ถามตอบและงานผ่านแชต) และ `OCR` (อ่านเอกสาร: source route `receipt-ocr`, `bank-statement-extract`, `receipt-capture` และ intake ที่มีรูป) ตาม `classifyAiUsageRequest` (`line-ai/application/company-ai-usage-meter.ts`)

### FR-LINE-110 วัดการใช้ AI ทุกการเรียก

- **คำอธิบาย** ทุกการเรียกโมเดลถูกบันทึกจำนวน token และต้นทุนเป็นสตางค์ ณ เวลาที่เกิด
- **ผู้ใช้/permission** ระบบ; ผู้ดูแลอ่านได้ด้วย `system.partner_dashboard.read`
- **แพ็ก** ทุกแพ็กที่ใช้ AI
- **เงื่อนไขก่อนทำ** —
- **ขั้นตอนหลัก** (1) ใน gateway ผู้ให้บริการ append `AiUsageEntry` (`modelId`, `tag`, `ok`, `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheWriteInputTokens`, `usageBasis`) ลงตัวเก็บต่อคำขอที่อยู่บน `AsyncLocalStorage` (`common/usage/usage-context.ts`) (2) `AiUsageInterceptor` แนบ usage กับ JSON ของคำตอบ (3) API เรียก `recordCompanyAiUsage` หรือ settle ต่อการเรียก (FR-LINE-113) เขียน `AiUsageEvent` และรวมยอดใน `CompanyAiMonthlyUsage`, `CompanyAiMonthlyBucketUsage`
- **กฎธุรกิจและข้อยกเว้น** ราคา (USD ต่อล้าน token, `AI_MODEL_PRICES` ใน `ai-model-pricing.ts`; จับคู่ด้วย substring ของ model id):

| คีย์ที่จับ | input | output | cache read | cache write |
|---|---|---|---|---|
| `sonnet` | 3 | 15 | 0.3 | 3.75 |
| `claude-haiku-5-5` | 0.10 | 0.50 | 0.01 | 0.125 |
| `haiku` | 0.25 | 1.25 | 0.03 | 0.3 |

  สูตร: `costSatang = round((Σ token × ราคา) × THB/USD × 100 / 1,000,000)` ปัดครึ่งขึ้น คำนวณครั้งเดียวตอนบันทึก ไม่คำนวณย้อนหลัง โมเดลที่ไม่มีในตารางคิดที่ราคาสูงสุดของแต่ละองค์ประกอบและเตือน ไม่คิดเป็นศูนย์ snapshot ราคา (`AiPricingSnapshot`) แยกสตางค์ต่อองค์ประกอบพร้อมช่อง `rounding` ให้ผลรวมตรงกับต้นทุน entry ที่ตัวนับไม่ใช่จำนวนเต็มไม่ติดลบถูกปฏิเสธ (`isMeterableEntry`) ผลของ AgentCore เป็น JSON ที่ไม่ไว้ใจ gateway คัดเฉพาะฟิลด์ตามสัญญาก่อนถึงมิเตอร์
- **การตรวจข้อมูล/ข้อผิดพลาด** การเสีย usage หนึ่งแถวต้องไม่ทำให้งานธุรกิจล้มเหลว (ตัวเก็บไม่ throw) log `ai.usage` มีเฉพาะรหัสและตัวนับ
- **ข้อมูล** `AiUsageEvent`, `CompanyAiMonthlyUsage`, `CompanyAiMonthlyBucketUsage`
- **API** `GET /v1/system/partners/:partnerCompanyId/ai-usage`
- **หน้าจอ** แท็บ AI ของหน้ารายละเอียดพาร์ทเนอร์ (`PartnerDetailPage.tsx`, `ai-budget.logic.ts`)
- **การทดสอบ** `line-ai/application/company-ai-usage-meter.spec.ts`, `ai-model-pricing.spec.ts`, `common/usage/ai-usage.interceptor.spec.ts`, `common/usage/usage-context.spec.ts`, `apps/web/src/features/system-partners/ai-budget.logic.spec.ts`

### FR-LINE-111 เพดานความปลอดภัยค่า AI ต่อเดือน

- **คำอธิบาย** เพดานรวมกันไม่ให้ค่า AI ของร้านหนึ่งเกินต่อเดือน ไม่ใช่เครดิตที่ขาย
- **ผู้ใช้/permission** `system.partner_ai_model.manage`
- **แพ็ก** ทุกแพ็ก
- **เงื่อนไขก่อนทำ** —
- **ขั้นตอนหลัก** ค่าระดับแพลตฟอร์ม: เพดานกลางต่อเดือนและเพดานสูงสุดที่ตั้งให้ร้านได้ อ่าน/ตั้งที่ `GET/PUT /v1/system/ai-budget` (`PlatformAiBudgetConfig` แถวเดียว id `platform`) ถ้าไม่มีแถวใช้ค่า environment `AI_MONTHLY_BUDGET_SATANG` (ค่าเริ่มต้น 200,000 = 2,000 บาท) และ `AI_MONTHLY_BUDGET_SATANG_CEILING` (1,000,000 = 10,000 บาท) ค่าต่อร้าน `CompanyAiConfiguration.monthlyBudgetSatang` (`null` = รับค่ากลาง)
- **กฎธุรกิจและข้อยกเว้น** โหมดงบ (`budgetMode`): `SHARED` (ค่าเริ่มต้น; ถังเดียว โดยผู้ดูแลตั้งเครดิตแชตได้) และ `SPLIT` (เพดาน CHAT และ OCR แยก; ต้อง `C + O ≤ T`) นโยบายที่รอมีผล (`pendingBudgetPolicy` พร้อม `effectiveMonthKey`) มีผลเองเมื่อถึงเดือน ไม่มี cron นโยบายไม่ถูกต้องปฏิเสธการใช้ ไม่ปรับให้พอดี: `SPLIT_CAPS_MISSING`, `SPLIT_EXCEEDS_TOTAL`, `POLICY_MALFORMED` การตัดสินรับเข้า (`decideAiBudgetStep`): ตรวจเพดานรวมก่อนถัง แยก `exceeded` (ถึงเพดานแล้ว) จาก `insufficient` (ยังเหลือแต่ไม่พอขอบของงานนี้) เพดาน 0 คือการปิดโดยผู้ดูแล ไม่ถูกข้ามแม้กรณี replay ร้านใหม่ที่สมัครทาง LINE ได้งบ AI ฟรีตาม `LINE_FREE_AI_BUDGET_SATANG` (ค่าเริ่มต้น 8,000 = 80 บาท; จุดใช้ไม่ได้ตรวจละเอียด)
- **การตรวจข้อมูล/ข้อผิดพลาด** `PUT` ตอบ 422 เมื่อค่าต่ำกว่า 1 สตางค์หรือเพดานสูงสุดต่ำกว่าเพดานกลาง การลดเพดานสูงสุดมีผลกับการตั้งครั้งต่อไป เพดานของร้านที่ตั้งสูงไว้แล้วคงอยู่ (ข้อความบนหน้าเว็บ)
- **ข้อมูล** `PlatformAiBudgetConfig`, `CompanyAiConfiguration`
- **API** `GET /v1/system/ai-budget`, `PUT /v1/system/ai-budget`, `PUT /v1/system/partners/:partnerCompanyId/ocr-config`, `GET /v1/system/partners/:partnerCompanyId/ai-adjustments`
- **หน้าจอ** `/system/ai-budget` (`PlatformAiBudgetPage.tsx`: "เพดานความปลอดภัยค่า AI กลาง"), แท็บ AI ของพาร์ทเนอร์
- **การทดสอบ** `line-ai/application/company-ai-budget-reservation.spec.ts`, `company-ai-budget-reservation.pg.spec.ts`, `apps/api/src/modules/system-partner-management/presentation/http/partner.controller.spec.ts`

### FR-LINE-112 เครดิตแชต AI: ล็อต ลำดับการใช้ และรอบแพ็กเกจ

- **คำอธิบาย** ร้านที่ซื้อแพ็กได้เครดิตแชตต่อรอบ และเติมเพิ่มได้ เครดิต 1 หน่วย = ต้นทุน CHAT 1 บาท
- **ผู้ใช้/permission** ร้านใช้โดยอัตโนมัติ; ผู้ดูแลมอบหรือเพิกถอนด้วย `system.partner_ai_model.manage`
- **แพ็ก** P-ALL: เครดิตเริ่มต้น 50 ต่อรอบ (`DEFAULT_CHAT_CREDIT_SATANG = 5_000`, `packages/contracts/src/line-ai.ts:23`) เท่ากันทุกแพ็ก add-on: `CHAT_50` (299 บาท), `CHAT_100` (549 บาท), `CHAT_300` (1,499 บาท) (`packages/contracts/src/billing.ts:106–108`)
- **เงื่อนไขก่อนทำ** ร้านเปลี่ยนมาใช้เครดิตแล้ว (`CompanyAiConfiguration.aiCreditCutoverAt` มีค่า)
- **ขั้นตอนหลัก** (`line-ai/application/ai-credit-ledger.ts`) หนึ่งล็อตต่อแหล่ง (`AiCreditGrant`) และรายการเปลี่ยนแปลงแบบ append-only (`AiCreditEntry`: `RESERVE`, `CONSUME` และอื่น ๆ) ยอดคงเหลือของล็อต = `units + Σ entries` โดย `RESERVE` นับเฉพาะขณะการจองยังมีชีวิต (`RESERVED`/`DISPATCHED`/`UNRESOLVED`) จึงไม่มีตัวนับที่สองให้คลาดเคลื่อน
- **กฎธุรกิจและข้อยกเว้น**
  - แหล่งของล็อต: `INCLUDED_CYCLE` (มากับแพ็ก), `ADD_ON_ADMIN` (ทีมงานมอบ), `SALES_EVENT` (งานขาย/เดโม่), `ADD_ON_PAID` (ซื้อเพิ่ม)
  - ลำดับการใช้: ของแพ็กก่อน → ที่ทีมงานมอบ (admin และ sales event อันดับเดียวกัน) → ที่ซื้อเพิ่ม ภายในกลุ่ม: หมดอายุก่อนใช้ก่อน → เพิ่มก่อนใช้ก่อน → id (`aiCreditLotOrder`)
  - ล็อตของรอบสร้างเมื่อใช้ครั้งแรก (lazy, idempotent) ไม่สร้างย้อนหลังให้เดือนที่ไม่มีการใช้ การเปิดรอบใหม่ปิดล็อตของรอบก่อน (audit `ai_credit.cycle.opened` ระดับ HIGH)
  - จำนวนเครดิตของรอบมาจาก `aiCreditCycleAllowance`: ค่าที่ผู้ดูแลตั้ง (`ADMIN_CHAT_CREDIT`) ชนะดีลขาย (`SALES_DEAL`, ขณะยังไม่หมดอายุ) ซึ่งแทนค่าเริ่มต้น (`DEFAULT`); โหมด SPLIT ใช้เพดาน CHAT (`SPLIT_CHAT_CAP`) ดีลที่หมดกลางรอบคง snapshot ถึงสิ้นรอบ
  - turn ที่ถือเครดิตอยู่คง `pinnedCycleKey` แม้ข้ามขอบรอบ
  - เครดิตที่ซื้อหรือได้รับเพิ่มหมดอายุ 12 เดือนนับจากวันที่ได้รับ (คอมเมนต์ D1/D8)
  - รอบที่รอต่ออายุ (`RENEWAL_PENDING`) เมื่อชำระแล้วคง `cycleKey` เดิม ไม่ได้เครดิตซ้ำ วิธีจ่ายที่ต่ออายุเอง: `CARD_AUTO`, `PROMPTPAY_RENEW`
  - ร้านเดโม่ (`reportClassification = DEMO`) ใช้เฉพาะล็อตที่เติม ไม่มีล็อตของรอบ
  - เหตุปฏิเสธภายใน: `PACKAGE_REQUIRED`, `EXHAUSTED`, `INSUFFICIENT` (gateway เห็นเป็นรหัสงบเดิม)
- **การตรวจข้อมูล/ข้อผิดพลาด** ผู้เขียนที่ลดเครดิตที่ใช้ได้ทุกตัวทำงานใต้ advisory lock `partner-ocr-config:<company>` การมอบซ้ำด้วยคีย์และ payload เดิมคืนล็อตแรก payload ต่างภายใต้คีย์เดิม throw
- **ข้อมูล** `AiCreditGrant`, `AiCreditEntry`, `AiBudgetReservation`, `CompanyAiConfiguration` (`salesDealChatCreditSatang`, `salesDealChatCreditEndsAt`, `chatMonthlyBudgetSatang`)
- **API** ผ่าน use case ของ billing add-on และแท็บ AI ของผู้ดูแล; tool `billing.get_package_usage`
- **หน้าจอ** หน้าแพ็กเกจของร้าน (ยอดเครดิต), แท็บ AI ของพาร์ทเนอร์
- **การทดสอบ** `line-ai/application/ai-credit-cycles.spec.ts`, `ai-credit-funding.pg.spec.ts`, `ai-credit-demo.spec.ts`, `company-ai-credit-holds.pg.spec.ts`, `line-ai/application/package-usage.pg.spec.ts`
- **หมายเหตุ** คอมเมนต์ใน `company-ai-budget-policy.ts` กล่าวถึง "the default 80" ซึ่งไม่ตรงกับค่าคงที่ปัจจุบัน 5,000 สตางค์ (50 เครดิต) ค่าคงที่ในโค้ดเป็นค่าที่ใช้จริง

### FR-LINE-113 จองก่อนเรียก ชำระหลังเรียก (reservation / step / settle)

- **คำอธิบาย** ก่อนทุกการเรียกโมเดล API จองเงินตามขอบบนของการเรียกนั้น หลังเรียก gateway ส่งหลักฐานการใช้กลับมาชำระครั้งเดียว
- **ผู้ใช้/permission** ระบบ; endpoint ภายในใช้ `x-internal-secret`
- **แพ็ก** ทุกแพ็กที่ใช้ AI
- **เงื่อนไขก่อนทำ** ราคาและอัตราแลกเปลี่ยนอ่านได้
- **ขั้นตอนหลัก** (1) API เปิด attempt ที่ ordinal 0 ด้วย `reserveAiBudgetStep`: กำหนดขอบบน (`priceAiStepUpperBound`: token ขาเข้าสูงสุด × อัตราที่สูงกว่าระหว่าง input กับ cache write + token ขาออกสูงสุด × ราคา output ปัดขึ้นต่อการเรียก) เขียน `AiBudgetReservation` (`RESERVED`) และถ้าร้านใช้เครดิต เขียน `RESERVE` ลงล็อต (2) ทำเครื่องหมาย `DISPATCHED` และ commit ก่อนบอก gateway ว่าเรียกได้ (3) gateway ครอบผู้ให้บริการด้วย `withAiBudgetEnvelope` (`common/usage/ai-budget-provider.ts`): โมเดลต้องตรงกับที่จอง, `maxTokens` ต้องประกาศและไม่เกินขอบ, input ต้องพิสูจน์ได้ว่าไม่เกินขอบ, การเรียกลำดับ ≥ 1 ต้องชนะ `POST /internal/ai/budget-step` ก่อน, เกิน `maxCalls` ไม่เรียก (4) หลังเรียก gateway ส่ง `POST /internal/ai/budget-settle` พร้อม `invocationKey` และตัวนับ ทั้งกรณีสำเร็จ ผิดพลาด และหมดเวลา (5) `settleAiBudgetStep` เขียน `AiUsageEvent` ยอดเดือน ยอดถัง และสถานะปลายทางของการจองในธุรกรรมเดียว กันซ้ำด้วย `AiUsageEvent.invocationKey`
- **กฎธุรกิจและข้อยกเว้น**
  - รหัสการเรียก: `<companyId>#<attemptKey>#<stepKind>#<ordinal>`
  - ขอบของงาน v1 (`AI_BUDGET_STEP_BOUNDS`): `line-intake-text` 20,000/1,500 ×1; `line-intake-image` 30,000/8,000 ×2; `line-turn` 40,000/1,024 ×16; `receipt-ocr` 30,000/8,192 ×8; `bank-statement` 30,000/4,096 ×3; `receipt-capture-read` และ `-extract` 30,000/8,192 ×1; `draft-generate` 20,000/900 ×1; กลุ่ม `crm-*`
  - โปรไฟล์ v2 (`AI_BUDGET_PROFILES_V2`, ตารางรุ่น `budget-profile-table/2`): `line-classify/2` 24,576/1,024 ×2; `line-intake-text/2` 160,000/4,096 ×2; `line-intake-image/2` 160,000/8,000 ×2; `line-control/2` 160,000/2,048 ×3; `line-answer/2` 160,000/4,096 ×2; `document-qa/2` 160,000/8,192 ×2; `public-lookup/2` 32,000/4,096 ×1 grant v2 ออกโดย `LineAiBudgetAuthorityService` ขนาดอำนาจไม่เกิน 32 KiB
  - ภาพคิด 2,000 token หน้าเอกสาร 3,000 token เอกสารไม่เกิน 8 หน้า (ค่าคงที่ใน `ai-budget-bounds.ts`)
  - เงินคิดที่ราคาและอัตราแลกเปลี่ยนที่ตรึงไว้บนการจอง ไม่ใช่ของวันชำระ
  - การจอง `RESERVED` ที่ค้างเกิน 10 นาทีถูกยกเลิก (พิสูจน์ว่าไม่เคยเรียกผู้ให้บริการ) `DISPATCHED` ที่ค้างเกิน 30 นาทีเป็น `UNRESOLVED` ซึ่งยังนับเป็นเงินจอง ไม่คืนตามเวลา การกวาดนี้ทำแบบ lazy ภายในธุรกรรมจองของบริษัท-เดือนนั้น ไม่มี cron
  - ภายใต้ envelope ไคลเอนต์ SDK ถูกตรึงที่ 1 attempt (`AI_BUDGET_STEP_ATTEMPTS`) เพราะการจองหนึ่งครั้งคิดราคาหนึ่ง attempt
  - การขอ step ซ้ำไม่ใช่การรันครั้งที่สอง ตอบ `busy` ให้ gateway รอ
  - settle ล้มเหลวสองครั้งติด → หลักฐานเข้าคิวใน memory ของ gateway แล้วส่งซ้ำด้วย backoff นอกเส้นทางคำขอ (`ai-budget-durability.ts`) เมื่อ SIGTERM gateway รอการเรียกที่ค้างแล้ว flush คิว ภายใน `AI_GATEWAY_SHUTDOWN_DRAIN_MS` (ค่าเริ่มต้น 20,000 ms; ต่ำกว่า stop timeout ของ container)
  - การรับเข้าต่อบริษัทใช้ lease (`ai-monthly-budget`, TTL 180 วินาที) turn สดรอ lease ได้ถึง 25 วินาที (`LINE_AI_LIVE_BUSY_WAIT_MS`) โดยตรวจทุก 1,200 ms
  - ขีดอัตราต่อบริษัท: `AI_LLM_MAX_PER_COMPANY=60`, `AI_OCR_MAX_PER_COMPANY=20` ต่อ `AI_RATE_LIMIT_WINDOW_SECONDS=60`
- **การตรวจข้อมูล/ข้อผิดพลาด** ผล settle: `settled`, `duplicate`, `unknown-invocation`, `invalid-state`, `invalid-evidence`, `settled-anomaly` (หลักฐานมาถึงการจองที่ยัง `RESERVED` หรือ `CANCELLED`: เงินจริงถูกบันทึกเต็มพร้อมแจ้งความผิดปกติ ไม่ทิ้ง), `operator-hold-not-unresolved`, `failed` step ที่ไม่มี parent หรือ parent ถูกยกเลิก → `unavailable`
- **ข้อมูล** `AiBudgetReservation`, `AiUsageEvent`, `CompanyAiMonthlyUsage`, `CompanyAiMonthlyBucketUsage`, `AiCreditEntry`
- **API** `POST /v1/internal/ai/budget-step`, `POST /v1/internal/ai/budget-settle`
- **หน้าจอ** —
- **การทดสอบ** `line-ai/presentation/http/internal-ai-budget.controller.spec.ts`, `line-ai/application/company-ai-budget-reservation.pg.spec.ts`, `line-ai/application/line-ai-budget-authority.pg.spec.ts`, `packages/contracts/src/ai-budget-bounds-v2.spec.ts`; ADR 0013 (อ้างในคอมเมนต์)

### FR-LINE-114 ไม่คิดเงินร้านเมื่อการเรียก AI ล้มเหลว

- **คำอธิบาย** การเรียกโมเดลที่ผู้ให้บริการรายงานว่าไม่สำเร็จ (รวมหมดเวลา) ไม่ถูกหักจากงบหรือเครดิตของร้าน บริษัทรับต้นทุนเอง
- **ผู้ใช้/permission** ระบบ
- **แพ็ก** ทุกแพ็กที่ใช้ AI
- **เงื่อนไขก่อนทำ** —
- **ขั้นตอนหลัก** ใน `settleAiBudgetStep` (`company-ai-budget-reservation.ts:874`): `absorbed = !operator && entry.ok === false` เมื่อ `absorbed`: การจองจบเป็น `CANCELLED`, `settledCostSatang = 0`, `usageBasis = 'COMPANY_ABSORBED'`, `customerChargedSatang = 0` และ evidence เก็บ `reason: 'COMPANY_ABSORBED'` พร้อม `absorbedCostSatang` (ต้นทุนจริงที่บริษัทรับ)
- **กฎธุรกิจและข้อยกเว้น** ตัวจำแนกงานทำเครื่องหมาย usage ของการเรียกที่ไม่ได้ผลเป็น `ok: false` ตัวนับของการเรียก OpenAI ที่หมดเวลาเป็นค่าประมาณภายใน และ "API รับทุกการเรียกที่ล้มเหลว" (คอมเมนต์ `openai.provider.ts:364`) การใช้เกินขอบของการเรียกที่สำเร็จ (v2) ใช้เครดิตที่ยังไม่ถูกจองเพิ่มได้ แต่ไม่ใช้เงินจองของการเรียกอื่น ส่วนที่ขาดบริษัทรับ (`companyAbsorbedSatang = costSatang − customerChargedSatang`) การใช้เกินเป็นการแจ้งเตือน ไม่ใช่การล็อกการรับเข้า (มติเจ้าของ 2026-10-19) ฝั่งอ่านใบเสร็จ: อ่านไม่ได้หรือบันทึกผลไม่สำเร็จคืนสิทธิ์ที่จอง การอ่านที่ไม่พบใบเสร็จไม่คิดสิทธิ์
- **การตรวจข้อมูล/ข้อผิดพลาด** รายงานงานต่อ task (`line-ai-task-metrics.ts`) รวม `customerSatang` และ `companyAbsorbedSatang` แยกกัน
- **ข้อมูล** `AiBudgetReservation.evidenceJson`, `AiUsageEvent`
- **API** `POST /v1/internal/ai/budget-settle`
- **หน้าจอ** —
- **การทดสอบ** `line-ai/application/company-ai-budget-reservation.pg.spec.ts`, `company-ai-credit-holds.pg.spec.ts`

### FR-LINE-115 ข้อความเมื่อเครดิตหรืองบ AI ไม่พอ

- **คำอธิบาย** การปฏิเสธด้านเงินตอบด้วยโค้ด ไม่เรียกโมเดล ไม่แสดงตัวเลขเงินหรือการตั้งค่าของร้าน
- **ผู้ใช้/permission** ผู้ที่มี `company.plan.manage` ได้ปุ่มดูแพ็กเกจ คนอื่นถูกบอกว่าให้ถามใคร
- **แพ็ก** ทุกแพ็ก
- **เงื่อนไขก่อนทำ** —
- **ขั้นตอนหลัก** รหัส (`AI_BUDGET_REFUSAL_CODES`): `AI_MONTHLY_BUDGET_EXCEEDED`, `AI_BUDGET_INSUFFICIENT`, `AI_BUDGET_BUSY`, `AI_BUDGET_UNAVAILABLE` พร้อม `budgetScope` (`TOTAL`/`CHAT`/`OCR`) ที่ API ซึ่งอ่านเงินจริงเป็นผู้ตั้ง turn สดได้การ์ด `buildAiBudgetExceededMessage` ผ่าน `answerAiCreditRefusal` (`:3108`) turn ที่ reclaim ได้ข้อความ `formatAiBudgetRefusalNotice`
- **กฎธุรกิจและข้อยกเว้น** หัวการ์ด: `เครดิต AI เดือนนี้หมดแล้ว` / `…เหลือไม่พอ` หรือ `เครดิต AI ส่วนแชตเดือนนี้…` เมื่อ scope เป็น CHAT ข้อความต่อ: scope CHAT → `เดือนหน้าเริ่มใหม่ การเปลี่ยนแพ็กเกจไม่เติมเครดิตแชตในเดือนนี้ ติดต่อทีมงานเพื่อตรวจสิทธิ์ดีลพิเศษได้ค่ะ` (ไม่เสนอซื้อ); scope อื่นและผู้จัดการแพ็ก → `เดือนหน้าเริ่มใหม่ หรือเปลี่ยนแพ็กเกจเพื่อใช้ต่อได้ค่ะ` พร้อมปุ่ม `ดูแพ็กเกจ` คำว่า "ช่วงทดลอง" ใช้เฉพาะแพ็กทดลอง ร้านเดโม่ได้ปุ่ม `เปิดร้านจริงฟรี` อ่านมิเตอร์ไม่ได้ → `⏳ ตอนนี้ยังตรวจสอบเครดิต AI ของร้านไม่ได้ค่ะ น้องมั่งมีเลยยังไม่เริ่มงานให้ รบกวนลองใหม่อีกครั้งในอีกสักครู่นะคะ ระหว่างนี้ใช้งานผ่านเว็บแอปได้ตามปกติค่ะ` (ข้อความเดียวกันทั้ง API และ gateway) ห้ามใช้คำว่า "เต็ม/ครบ" กับกรณี `insufficient` สถานะ `busy` ไม่ถูกตัดวงจร เพราะ lease ว่างระหว่างการเรียก
- **การตรวจข้อมูล/ข้อผิดพลาด** `isAiBudgetPermanentRefusal` แยกการปฏิเสธถาวร (exceeded/insufficient) ออกจากชั่วคราว ข้อความที่ drain ส่งถูกตรวจความถูกต้องโดยประกอบสตริงเดิมซ้ำ
- **ข้อมูล** `LineTurnOutcome`
- **API** — **หน้าจอ** หน้าแพ็กเกจ
- **การทดสอบ** `line-ai/domain/logic/line-ai-terminal-outcome.logic.spec.ts`, `line-ai/domain/logic/line-business-card.logic.spec.ts`, `docs/agent-memory/line-ai-credit-wording-wave2-2026-09-18.md`

### FR-LINE-116 สิทธิ์อ่านเอกสาร (OCR governance) และอัตราแลกเปลี่ยน

- **คำอธิบาย** จำนวนใบที่ AI อ่านได้ต่อเดือนถูกควบคุมแยกจากเครดิตแชต และต้นทุนถูกแปลงเป็นบาทด้วยอัตราที่ติดตามได้
- **ผู้ใช้/permission** ผู้ดูแลตั้งด้วย `system.partner_ai_model.manage`
- **แพ็ก** ตามจำนวนใบของแพ็ก (FR-LINE-050) และ add-on `RECEIPT_IMAGE_20` (349 บาท), `_50` (799 บาท), `_100` (1,499 บาท)
- **เงื่อนไขก่อนทำ** —
- **ขั้นตอนหลัก** `admitCompanyOcr` (`company-ocr-governance.ts:222`) ตัดสินจาก `CompanyAiConfiguration.ocrEnabled`, `ocrMonthlyLimit` (`null` = ไม่จำกัด), โควตาของแพ็ก และสิทธิ์ฟรี 3 ใบ แล้วเขียน `CompanyOcrUsageEvent` การอ่านจบด้วย `settleCompanyOcrAdmission` หรือ `releaseCompanyOcrAdmission`
- **กฎธุรกิจและข้อยกเว้น** รหัสข้อผิดพลาด (`BillingReceiptReadWarning` / `CompanyOcrErrorCode`): `OCR_DISABLED`, `OCR_LIMIT_REACHED`, `RECEIPT_QUOTA_EXCEEDED`, `AI_BUDGET_REACHED`, `AI_OCR_BUDGET_REACHED`, `AI_CREDIT_HOLDS_PENDING` การแจ้งโควตาครบแจ้งหนึ่งครั้งต่อเดือน (`claimReceiptQuotaNotice`) lease สำหรับการลองอ่านซ้ำทาง LINE = เวลารอ receipt OCR + 105 วินาที อัตราแลกเปลี่ยน (`ai-fx-rate.ts`): ดึงจาก `https://open.er-api.com/v6/latest/USD` timeout 3 วินาที cache 6 ชั่วโมง เก็บแถว `AiFxRate` (id `THB_USD`) รับเฉพาะค่าในช่วง 20–60 ค่าที่เก่ากว่า 7 วันถือว่า stale ทางสำรองสุดท้ายคือ `AI_THB_PER_USD` (ค่าเริ่มต้น 33)
- **การตรวจข้อมูล/ข้อผิดพลาด** อัตราแลกเปลี่ยนใช้ไม่ได้ → การจองคิดราคาไม่ได้ → `AI_BUDGET_UNAVAILABLE`
- **ข้อมูล** `CompanyOcrUsageEvent`, `CompanyOcrMonthlyUsage`, `AiFxRate`, `CompanyAiConfiguration`
- **API** `PUT /v1/system/partners/:partnerCompanyId/ocr-config`
- **หน้าจอ** แท็บ AI ของพาร์ทเนอร์
- **การทดสอบ** `line-ai/application/ai-fx-rate.spec.ts`, `company-ocr-demo.spec.ts`, `line-ai/receipt-reliability.pg.spec.ts`, `line-ai/onboarding-receipt-allowance.pg.spec.ts`

### FR-LINE-117 การจัดการเงินจองที่ค้างโดยผู้ดูแล

- **คำอธิบาย** การจองที่กลายเป็น `UNRESOLVED` (หลักฐานไม่กลับมา) ต้องมีคนตัดสิน: ปล่อย คิดเต็มขอบ หรือรับทราบการใช้เกิน
- **ผู้ใช้/permission** อ่าน `system.partner_dashboard.read`; ตัดสิน `system.partner_ai_model.manage`
- **แพ็ก** —
- **เงื่อนไขก่อนทำ** การจองอยู่ในสถานะ `UNRESOLVED` (หรือมีธง breach ที่ยังไม่รับทราบ)
- **ขั้นตอนหลัก** รายการ: `GET …/ai-credit-holds` (รันการกวาดเดียวกับการรับเข้าก่อนแสดง) การตัดสิน: `POST …/ai-credit-holds/:reservationId/release` (`releaseAiBudgetHoldByOperator`), `…/charge-at-bound` (`chargeAiBudgetHoldAtBound`: ต้นทุน = `upperBoundSatang` ของการจอง บันทึกเป็น `COST_ADJUSTMENT`), `…/acknowledge-breach` (`acknowledgeAiBudgetBreach`)
- **กฎธุรกิจและข้อยกเว้น** การตัดสินของผู้ดูแลถูก fence ที่ `status = 'UNRESOLVED'` และเขียน audit ในธุรกรรมเดียวกัน (ระดับ HIGH หรือ CRITICAL) เงินไม่ถูกคืนตามเวลา ระบบเตือนเมื่อเงินจองค้างเกิน `AI_CREDIT_HOLD_ALERT_AFTER_HOURS` (ค่าเริ่มต้น 24 ชั่วโมง)
- **การตรวจข้อมูล/ข้อผิดพลาด** การจองไม่อยู่ในสถานะที่ตัดสินได้ → 409 (`operator-hold-not-unresolved`)
- **ข้อมูล** `AiBudgetReservation`, `AuditLog`, `AiUsageEvent`
- **API** ตามข้างต้น ใต้ `/v1/system/partners/:partnerCompanyId/`
- **หน้าจอ** แท็บ AI ของพาร์ทเนอร์ (`PartnerAiAdjustmentHistory.tsx`)
- **การทดสอบ** `line-ai/application/company-ai-credit-holds.pg.spec.ts`, `apps/api/src/modules/system-partner-management/presentation/http/partner-support-tools.spec.ts`

---

## 11. กลุ่ม I — ลิงก์เดโม่และแชทจำลอง

### FR-LINE-120 ลิงก์เดโม่สำหรับเซลล์

- **คำอธิบาย** เซลล์หรือผู้ดูแลสร้างลิงก์ที่เปิดร้านตัวอย่างพร้อมข้อมูลจำลอง ให้ลูกค้าเป้าหมายลองใช้ 3 วันโดยไม่ต้องสมัคร
- **ผู้ใช้/permission** `sales.demo_link.create` และต้องอยู่ใน tenant ของแพลตฟอร์ม (`assertPlatformTenant`)
- **แพ็ก** ร้านเดโม่ถูกสร้างเป็น `ENTERPRISE_1999` พร้อม feature ตาม `TIER_FEATURE_PRESETS.ENTERPRISE_1999`
- **เงื่อนไขก่อนทำ** ตั้ง web base URL
- **ขั้นตอนหลัก** (1) `POST /v1/sales/demo-links` พร้อมเครดิตทดลอง (จำนวนเต็ม 1–300, ค่าเริ่มต้น 50) → ลิงก์ `<web>/d/<token>` อายุ 3 วัน (`DEMO_LINK_TTL_MS`) (2) ผู้เปิดลิงก์: เว็บ route `/d/[token]` เรียก `POST /v1/auth/demo/open` (3) เปิดครั้งแรกสร้างบริษัท `ครัวมั่งมี (ร้านตัวอย่าง)` เจ้าของ `คุณมั่งมี (ตัวอย่าง)`, `reportClassification = DEMO`, วันหมดแพ็ก = วันหมดลิงก์, `ExternalIdentity` ปลอม (`providerChannelId = demo-web`, `providerUserId = Vdemo<companyId>`), `LineChannelBinding` ของ `demo-web`, เพดานอ่านเอกสารตามลิงก์, ล็อตเครดิต `SALES_EVENT` เท่ากับเครดิตของลิงก์ × 100 หน่วย และข้อมูลตัวอย่าง (`populateDemoCompany`) (4) ออก session ของเจ้าของร้านเดโม่ที่หมดอายุพร้อมลิงก์ แล้วพาไป `/companies/<id>/dashboard`
- **กฎธุรกิจและข้อยกเว้น** ผู้เปิดลิงก์เดียวกันทุกคนเข้าร้านเดียวกัน การเปิดถูก serialize ด้วย `SELECT … FOR UPDATE` บนแถวของลิงก์ การล้มกลางทาง rollback ทั้งบริษัท ข้อมูล และ session โควตา: สร้างลิงก์ 30 ครั้ง/ชั่วโมงต่อผู้ใช้, เปิด 20 ครั้ง/ชั่วโมงต่อ IP, สร้างบริษัทใหม่ 60 ครั้ง/ชั่วโมงทั้งระบบ จัดการลิงก์: รายการ, แก้ไข (`PATCH`), รีเซ็ตข้อมูล (`POST :id/reset`), ลบ (`DELETE`) ร้านเดโม่ถูกกันจากการกระทำที่มีต้นทุนหรือส่งออกภายนอก (`demo-company-access.ts`: billing, คำขอเปลี่ยนแพ็ก, การสร้าง credential พนักงานและลิงก์ LINE, AI แนะนำ, ช่อง CRM, อีเมล) ตอบ 403 `demo_action_unavailable` เพดานอ่านเอกสารของร้านเดโม่ไม่เกิน 50 (ค่าเริ่มต้น 3 เมื่อไม่ได้ตั้ง)
- **การตรวจข้อมูล/ข้อผิดพลาด** ลิงก์หมดอายุ ถูกเพิกถอน หรือร้านหมดแพ็ก → 410 `demo_link_expired` (เว็บแสดง `/d/expired`) เกินโควตา → 429 `demo_rate_limited` พร้อม `retryAfterSeconds` เครดิตนอกช่วง → 400 `เครดิตทดลองต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง 300 …`
- **ข้อมูล** `SalesDemoLink`, `Company`, `ExternalIdentity`, `LineChannelBinding`, `CompanyAiConfiguration`, `AiCreditGrant`, `AuditLog` (action `sales.demo_link.create` ระดับ HIGH)
- **API** `POST/GET /v1/sales/demo-links`, `PATCH /v1/sales/demo-links/:id`, `POST /v1/sales/demo-links/:id/reset`, `DELETE /v1/sales/demo-links/:id`, `POST /v1/auth/demo/open`
- **หน้าจอ** `/sales/demo-links`, `/system/demo-links` (`SalesDemoLinksPage.tsx`, `SalesDemoLinkDialog.tsx`), `/d/[token]`, `/d/expired`, แถบ `DemoSessionBanner.tsx`
- **การทดสอบ** `apps/api/src/modules/sales-demo/application/sales-demo.service.spec.ts`, `demo-company-access.spec.ts`, `demo-sample-data.spec.ts`, `demo-sample-data.pg.spec.ts`, `apps/api/src/modules/sales-demo/presentation/sales-demo.controller.spec.ts`, `sales-demo-credit.spec.ts`, `apps/api/src/modules/sales-demo/sales-demo.pg.spec.ts`, `apps/web/src/features/sales-demo/demo-open-route.spec.ts`, `line-ai/application/ai-credit-demo.spec.ts`, `line-ai/application/company-ocr-demo.spec.ts`

### FR-LINE-121 แชท LINE จำลองบนเว็บของร้านเดโม่

- **คำอธิบาย** หน้าต่างแชทในเว็บของร้านเดโม่ที่ใช้เส้นทาง LINE AI จริงทั้งหมด (buffer, ด่าน, classifier, gateway, การ์ด) โดยไม่ผ่าน LINE
- **ผู้ใช้/permission** session เดโม่ของเจ้าของร้านเดโม่ (`ctx.isDemo`, บทบาท `OWNER`); permission ของ route `account.session.read`
- **แพ็ก** ร้านเดโม่ (FR-LINE-120)
- **เงื่อนไขก่อนทำ** ลิงก์ยังไม่หมดอายุและร้านยัง active
- **ขั้นตอนหลัก** (1) ส่งข้อความ: `POST …/demo-chat/messages` รับ `{text}` หรือ `{postbackData, displayText?}` (2) ส่งไฟล์: `POST …/demo-chat/files` (3) `DemoChatService.enqueue` สร้าง event ของ LINE ปลอม (`source.userId = Vdemo<companyId>`, `replyToken = vreply:<uuid>`) แล้วใช้ `buildLineBufferEnvelope` ตัวเดียวกับ webhook จริง และ `LineMessageBufferService.enqueue` (4) คำตอบถูกเขียนลง `DemoChatMessage` (`direction = out`) แทนการส่งไป LINE ด้วย `storeDemoReply` (`demo-chat-sink.ts`) ซึ่งหาร้านจากแถวขาเข้าของ `replyToken` ไม่ใช่จากพิกัดที่ client ส่งมา และกันซ้ำด้วย `deliveryKey` (5) เว็บ poll `GET …/demo-chat/messages?after=<cursor>` ได้ `items`, `cursor`, `waiting`, `credit {remaining, total}`, `reads {used, limit}`
- **กฎธุรกิจและข้อยกเว้น** ข้อความ 1–1,000 ตัวอักษร ไฟล์: JPEG, PNG, WebP, HEIC, PDF ไม่เกิน 10 MB (และไม่เกิน `uploadMaxBytes`) ผ่านการสแกนมัลแวร์ WebP/HEIC ถูกแปลงเป็น JPEG คุณภาพ 95 (จำกัด 40 ล้านพิกเซล) ขีดอัตรา: ข้อความ 30 ครั้ง/600 วินาที, ไฟล์ 10 ครั้ง/3,600 วินาที ต่อร้าน เว็บแสดงคำทักทาย `สวัสดีค่ะ น้องมั่งมีเองนะคะ ลองถามเรื่องรายจ่า…` และคำถามลัด (`ส่งรูปใบเสร็จ`, `เดือนนี้จ่ายไปเท่าไหร่`, `ขอเบิกค่าน้ำมัน 500 …`, `มีอะไรรออนุมัติบ้าง`, `ออก 50 ทวิ ให้ช่างแอร์`) การ์ด Flex ถูกวาดด้วย `DemoFlexMessage.tsx` ปุ่มของการ์ดส่ง postback จริง ผู้ใช้เดโม่ได้ลิงก์เว็บธรรมดา ไม่ใช้ลิงก์ handoff และไม่ถูกพาไป LINE login แชทเดโม่เปิด reliability v2 เสมอ
- **การตรวจข้อมูล/ข้อผิดพลาด** `ส่งข้อความได้ครั้งละ 1 ถึง 1,000 ตัวอักษร ลองแก้ข้อความแล้วส่งอีกครั้ง`; `ไฟล์นี้ยังใช้ไม่ได้ เลือกรูปหรือ PDF ขนาดไม่เกิน 10 เมกะไบต์แล้วส่งอีกครั้ง`; `ยังเปิดรูปนี้ไม่ได้ บันทึกเป็น JPG หรือ PNG แล้วส่งอีกครั้ง`; `ปุ่มนี้ใช้ต่อไม่ได้ พิมพ์ข้อความที่ต้องการแล้วส่งอีกครั้ง`; `ยังโหลดแชทต่อไม่ได้ เปิดแชทอีกครั้งเพื่อลองใหม่`; อ่านเอกสารครบโควตา → 403 `demo_read_limit_reached`; เว็บ: `ส่งถี่เกินไปค่ะ รอสักครู่แล้วลองใหม่นะคะ`, `ลิงก์เดโม่นี้หมดอายุแล้วค่ะ`
- **ข้อมูล** `DemoChatMessage`, `AttachmentObject`, `LineWebhookEventLog`, `LineDocumentQaJob`, `ExpenseCaptureReadJob`
- **API** `POST /v1/companies/:companyId/demo-chat/messages` (202), `POST …/demo-chat/files` (202), `GET …/demo-chat/messages`
- **หน้าจอ** หน้าต่างแชท `DemoLineChat.tsx` (ป้าย "มั่งมี Plus · แชทจำลอง", แสดง `เครดิต x/y · อ่านเอกสาร …`)
- **การทดสอบ** `apps/api/src/modules/sales-demo/application/demo-chat.spec.ts`, `apps/web/src/features/sales-demo/DemoLineChat.spec.ts`, `DemoFlexMessage.spec.ts`, `demo-line-chat.logic.spec.ts`, `line-ai/application/line-message-buffer.demo.spec.ts`, `line-ai/infrastructure/line-reply.demo.spec.ts`, `line-ai/application/use-cases/process-line-webhook.demo-media.spec.ts`

---

## 12. แผนที่ข้อความตอบ (message map)

ข้อความคัดลอกจากโค้ด ส่วนที่ลงท้ายด้วย `…` คือถูกตัดในผลค้นของผู้เขียน ให้อ่านข้อความเต็มจากไฟล์ที่อ้าง ทุกข้อความมีสำเนาอังกฤษในโค้ด (เลือกจากภาษาของข้อความผู้ใช้หรือรหัสภาษาของปุ่ม) ข้อความที่ลูกค้าอ่านไม่ใช้เครื่องหมายบวก (เขียน "และ") และไม่เรียกผู้ช่วยว่า "AI" ในข้อความพัก/กลับมา (คอมเมนต์ P10-L §7)

### 12.1 ตัวตน ร้าน และการเข้าถึง (`process-line-webhook.use-case.ts:332–532`)

| สถานการณ์ | ข้อความ |
|---|---|
| ยังไม่ผูกบัญชี (ทางสำรอง) | `🔗 กรุณาเชื่อมต่อบัญชี มั่งมีพลัส กับ LINE ก่อนใช้งานนะคะ\nเปิดเว็บแอปเพื่อเชื่อมต่อได้เลยค่ะ` |
| เพิ่มเพื่อน (คนใหม่) | `สวัสดีค่ะ ขอบคุณที่เพิ่มมั่งมีพลัสเป็นเพื่อนนะคะ\nเลือกเปิดร้านใหม่ หรือเชื่อมบัญชีที่มีอยู่ในการ์ดด้านล่างได้ค่ะ หากเป็นพนักงาน ให้ใช้ลิงก์เชื่อม LINE จากเจ้าของกิจการค่ะ` |
| เพิ่มเพื่อน (มีบัญชีแล้ว) | `ยินดีต้อนรับกลับมาค่ะ เลือกเมนูที่ต้องการใช้งานได้เลยค่ะ หากต้องการคุยกับทีมงาน พิมพ์ ติดต่อเจ้าหน้าที่ ได้ค่ะ` |
| ประตูพนักงาน | `👋 ยินดีต้อนรับค่ะ ถ้าคุณเป็นพนักงาน ให้เจ้าของกิจการเปิดเมนู "พนักงาน" ในเว็บแอป แล้วส่งลิงก์เชื่อม LINE มาให้นะคะ กดลิงก์นั้นครั้งเดียวก็ใช้งานได้เลยค่ะ (ไม่ต้องสมัครร้านใหม่นะคะ)` |
| ปิดผู้ช่วย AI (PDPA) | `คุณปิดการใช้งานผู้ช่วย AI ไว้ ข้อความนี้จึงไม่ถูกประมวลผลด้วย AI ค่ะ\nเปิดใช้งานอีกครั้งได้ที่ เว็บแอป → ตั้งค่า → ความปลอดภัย นะคะ` |
| ยังไม่ยอมรับข้อกำหนด | `📄 กรุณาเข้าสู่เว็บแอป MangmeePlus เพื่อยอมรับข้อกำหนดการใช้งานและรับทราบนโยบายความเป็นส่วนตัว…` |
| ไม่มีสิทธิ์ใช้ผู้ช่วย | `คุณยังไม่มีสิทธิ์ใช้ผู้ช่วยใน LINE ให้เจ้าของกิจการหรือผู้ดูแลร้านเปิดสิทธิ์ให้ค่ะ` |
| ผู้ช่วยปิดชั่วคราว (launch route) | `🔧 ตอนนี้ผู้ช่วยพักให้บริการชั่วคราวค่ะ\nระหว่างนี้ยังใช้งานผ่านเว็บแอปได้ตามปกติ และเราจะ…` |
| ร้านยังไม่เปิด feature รายจ่าย | `📋 บริษัทนี้ยังไม่ได้เปิดใช้งานระบบค่าใช้จ่ายและเอกสารค่ะ` + คำแนะนำ |
| ไม่มีสิทธิ์อัปโหลดใบเสร็จ | `🔒 คุณไม่มีสิทธิ์อัปโหลดบิลหรือใบเสร็จผ่าน LINE ค่ะ` |
| แชตกลุ่ม | `กรุณาทำรายการในแชตส่วนตัวค่ะ` |
| ทักทาย | `สวัสดีค่ะ 😊 วันนี้มีอะไรให้น้องมั่งมีช่วยไหมคะ?` |
| กดคุยกับน้องมั่งมี | `น้องมั่งมีมาแล้วค่ะ เลือกเมนูที่ต้องการใช้งานได้เลยค่ะ` |
| สิทธิ์ใช้ฟรี: ถามคำถาม | `สิทธิ์ใช้ฟรียังไม่รวมคำถาม พิมพ์ ‘เมนูหลัก’ เพื่อดูทางเลือกค่ะ` |

### 12.2 ติดต่อเจ้าหน้าที่และการพัก AI

| สถานการณ์ | ข้อความ |
|---|---|
| รับเรื่อง | `📮 รับเรื่องแล้วค่ะ ทีมงานจะตอบในแชทนี้ในเวลาทำการ (จันทร์–เสาร์ 9:00–18:00) หากรีบ โทร 098-256-5628 ได้เลยค่ะ · กดปุ่ม "คุยกับน้องมั่งมี" หรือพิมพ์ "คุยกับน้องมั่งมี" เมื่ออยากให้น้องมั่งมีตอบต่อ` |
| คำขอเดิมยังเปิด | `📮 คำขอของคุณยังอยู่ในคิวค่ะ ทีมงานจะตอบในแชทนี้ในเวลาทำการ (จันทร์–เสาร์ 9:00–18:00) นะคะ` + คำแนะนำกลับมาคุย |
| ข้อความระหว่างพัก (ครั้งแรกใน 10 นาที) | `📮 ส่งข้อความถึงทีมงานแล้วค่ะ ทีมงานจะตอบกลับในแชทนี้นะคะ` + คำแนะนำกลับมาคุย |
| ข้อความระหว่างพัก (ซ้ำ) | `📮 รับข้อความแล้วค่ะ` |
| รูป / ไฟล์ระหว่างพัก | `📎 รับรูปแล้วค่ะ ส่งให้ทีมงานแล้ว` / `📎 รับไฟล์แล้วค่ะ ส่งให้ทีมงานแล้ว` |
| เก็บเข้าคิวไม่สำเร็จ | `📮 ยังส่งข้อความนี้เข้าคิวทีมงานไม่สำเร็จค่ะ กรุณากด "ติดต่อเจ้าหน้าที่" อีกครั้ง หากยังไม่ได้ โทร 098-256-5628 ได้เลยค่ะ` |
| เกิน 3 คำขอต่อวัน | `📮 วันนี้ยังเปิดคำขอคุยกับเจ้าหน้าที่เพิ่มไม่ได้ค่ะ หากยังต้องการความช่วยเหลือ โทร 098-256-5628 ได้เลยค่ะ` |
| กลับมาคุยกับผู้ช่วย | `💚 น้องมั่งมีกลับมาแล้วค่ะ ถามได้เลยนะคะ` |

### 12.3 การปฏิเสธและข้อผิดพลาดของ AI turn (`line-ai/domain/logic/line-ai-formatter.logic.ts:15–51`)

| รหัส | ข้อความ |
|---|---|
| `mutation_blocked` | `⚠️ ขออภัยค่ะ น้องมั่งมีไม่สามารถดำเนินการนี้ผ่าน LINE ได้\nกรุณาเปิดเว็บแอปเพื่อดำเนินการต่อนะคะ` |
| `safety_crisis` | `น้องมั่งมีเป็นห่วงความปลอดภัยของคุณนะคะ ตอนนี้คุณอยู่ในที่ปลอดภัยและมีคนที่ไว้ใจอยู่ใกล้ๆ ไหมคะ\nถ้าไหว โทรสายด่วนสุขภาพจิต 1323 (24 ชั่วโมง) หรือบอกคนที่ไว้ใจให้อยู่กับคุณตอนนี้ค่ะ\nถ้ามีอันตรายทันทีหรืออาจทำร้ายตัวเอง โทร 1669 หรือไปห้องฉุกเฉินที่ใกล้ที่สุดเดี๋ยวนี้นะคะ` |
| `privacy_rumor` | `น้องมั่งมีไม่ขอเดาหรือขยายข่าวลือเกี่ยวกับชีวิตส่วนตัวของคนอื่นนะคะ` |
| `unsupported_module` | `📋 ขออภัยค่ะ ฟีเจอร์นี้ยังไม่พร้อมใช้งานผ่าน LINE ในขณะนี้\nกรุณาเปิดเว็บแอปเพื่อดูข้อมูลเพิ่มเติมนะคะ` |
| `unsupported_yet` | `📋 เรื่องนี้อยู่ในระบบ แต่น้องมั่งมียังทำผ่าน LINE ไม่ได้ในตอนนี้ค่ะ\nทำได้ในเว็บนะคะ` |
| `forbidden` | `🔒 คุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้ค่ะ\nหากต้องการสิทธิ์เพิ่มเติม กรุณาติดต่อเจ้าของกิจการหรือผู้มีสิทธิ์จัดการบทบาทนะคะ` |
| `unlinked_user` | `🔗 กรุณาเชื่อมต่อบัญชี มั่งมีพลัส กับ LINE ก่อนใช้งานนะคะ\nแตะ "เชื่อมต่อบัญชี" หรือเข้าสู่ระบบผ่านเว็บแอปค่ะ` |
| `ambiguous_company` | `🏢 พบหลายบริษัทที่เชื่อมต่อกับบัญชีของคุณค่ะ\nกรุณาเลือกบริษัทที่ต้องการผ่านเว็บแอปนะคะ` |
| `tool_unavailable` | `⏳ ข้อมูลไม่พร้อมใช้งานในขณะนี้ กรุณาลองใหม่อีกครั้งนะคะ` |
| `feature_disabled` | `📋 ฟีเจอร์นี้ยังไม่ได้เปิดใช้งานหรือยังไม่พร้อมใช้งานในระบบนี้ค่ะ` |
| `ai_timeout` | `⏱ ขออภัยค่ะ รอบนี้ระบบใช้เวลานานเกินไปจนต้องหยุดก่อนค่ะ พิมพ์คำถามเดิมส่งมาใหม่ได้เลยนะคะ` |
| `line_delivery_failure` | `❌ เกิดข้อผิดพลาดในการส่งข้อความ กรุณาลองใหม่อีกครั้งนะคะ` |
| ข้อผิดพลาดชั่วคราวทั่วไป | `⏳ ขออภัยค่ะ เกิดข้อผิดพลาดชั่วคราว กรุณาลองใหม่อีกครั้งนะคะ` |
| กำลังประมวลผลข้อความก่อนหน้า (ไม่มี ledger) | `⏳ ระบบกำลังประมวลผลข้อความก่อนหน้า กรุณารอสักครู่แล้วลองใหม่อีกครั้งนะคะ` |
| กำลังตอบข้อความก่อนหน้า (มี ledger) | `⏳ น้องมั่งมีกำลังตอบข้อความก่อนหน้าอยู่ค่ะ ข้อความนี้รับไว้แล้ว เดี๋ยวตามมาตอบให้เองนะคะ ไม่ต้องส่งซ้ำค่ะ` |

รหัสข้อผิดพลาดของสัญญา (`LINE_AI_ERROR_CODES`, `packages/contracts/src/line-ai.ts:2253`): `LINE_AI_INVALID_SIGNATURE`, `LINE_AI_DUPLICATE_EVENT`, `LINE_AI_UNLINKED_USER`, `LINE_AI_AMBIGUOUS_COMPANY`, `LINE_AI_FORBIDDEN`, `LINE_AI_UNSUPPORTED_MODULE`, `LINE_AI_MUTATION_BLOCKED`, `LINE_AI_TOOL_UNAVAILABLE`, `LINE_AI_AI_TIMEOUT`, `LINE_AI_PROVIDER_UNAVAILABLE`, `LINE_AI_RATE_LIMITED`, `LINE_AI_DELIVERY_FAILURE`

### 12.4 ข้อความของ gateway (`gw/line-ai/application/use-cases/line-ai-turn.use-case.ts:23–45`)

| สถานการณ์ | ข้อความ |
|---|---|
| นอกขอบเขตระบบ | `📋 ขออภัยค่ะ น้องมั่งมีตอบได้เฉพาะข้อมูลในระบบธุรกิจที่เชื่อมต่ออยู่เท่านั้น\nคำถามนี้อยู่นอกขอบเขตระบบ จึงไม่สามารถให้ข้อมูลที่…` |
| ไม่มีสิทธิ์ | `🔒 คุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้ค่ะ` |
| ไม่พบข้อมูล | `📭 ไม่พบข้อมูลที่ตรงกันค่ะ กรุณาลองถามใหม่อีกครั้งนะคะ` |
| ข้อผิดพลาด | `⏳ เกิดข้อผิดพลาดชั่วคราว กรุณาลองใหม่อีกครั้งนะคะ` |
| รับบิลแล้วแต่ยังบันทึกอัตโนมัติไม่ได้ (เส้น deterministic) | `🧾 ได้รับบิล/สลิปแล้วค่ะ / ระบบยังไม่สามารถบันทึกหรือยืนยันความถูกต้องให้อัตโนมัติได้ในตอนนี้ / กรุณาตรวจสอบเลขที่เอกสาร ผู้ขาย/ผู้รับเงิน เลขประจำตัวผู้เสียภาษี ที่อยู่ วันที่ ยอดรวม และ VAT ในเว็บแอปก่อนบันทึกนะคะ` |

### 12.5 ข้อความรอ

ดูตารางใน FR-LINE-006 ข้อความรอตามหัวข้อ (`LINE_WAIT_STATUS_RULES`): รายงาน → `กำลังจัดเตรียมรายงานให้นะคะ 📄`; สรุป → `กำลังสรุปข้อมูลให้อ่านง่ายอยู่นะคะ 📊`; เปรียบเทียบ → `กำลังเปรียบเทียบข้อมูลให้นะคะ 🔎`; คำนวณ → `กำลังคำนวณตัวเลขให้นะคะ 🧮`; วิเคราะห์ → `กำลังวิเคราะห์ข้อมูลให้อยู่นะคะ 📈`; ค้นหา → `กำลังค้นข้อมูลที่เกี่ยวข้องให้อยู่นะคะ 🔍`; ข้อมูลทั่วไป → `กำลังตรวจสอบข้อมูลในระบบให้นะคะ 💻`; อื่น ๆ → หนึ่งใน 4 ข้อความ เช่น `น้องมั่งมีกำลังดูให้อยู่นะคะ ขอบคุณที่รอนะคะ 💚` (แต่ละกลุ่มมี 2 แบบ เลือกด้วย hash คงที่)

### 12.6 แพ็กเกจ เครดิต และโควตา

ดู FR-LINE-040 ถึง 042, FR-LINE-050, FR-LINE-115 ข้อความหลัก: `💚 เครดิต AI ของเดือนนี้หมดแล้วค่ะ น้องมั่งมีจึงยังไม่ได้ตอบข้อความก่อนหน้านี้ให้นะคะ เดือนหน้าเริ่มใหม่ หรือขอเปลี่ยนแพ็กเกจเพื่อใช้ต่อได้เลยค่ะ`; `💚 เครดิต AI ส่วนแชตของเดือนนี้หมดแล้วค่ะ … เดือนหน้าเริ่มใหม่ การเปลี่ยนแพ็กเกจไม่เติมเครดิตแชตในเดือนนี้ หากต้องการตรวจสอบสิทธิ์ดีลพิเศษ กรุณาพิมพ์ “ติดต่อเจ้าหน้าที่” ค่ะ`; `💚 เครดิต AI ที่เหลือของเดือนนี้ไม่พอตอบข้อความก่อนหน้านี้ค่ะ …`


---

## 13. ข้อกำหนดที่ไม่ใช่หน้าที่ (NFR)

| รหัส | ข้อกำหนด | ค่าที่โค้ดบังคับ / หลักฐาน |
|---|---|---|
| **NFR-501** ความถูกต้องของผู้ส่ง webhook | webhook ทุกตัวต้องผ่าน HMAC-SHA256 ของ raw body เทียบแบบ constant-time ลายเซ็นผิดต้องเป็น security event ระดับ HIGH | `line-webhook-verifier.ts`, `emitSecurityEvent(…lineWebhookSignatureInvalid, 'HIGH')` |
| **NFR-502** ไม่ทำ event หาย | ไม่ ack event ที่ยังไม่ถูกเก็บ; event ที่รับแล้วต้องถูกประมวลแม้ process ล่ม | enqueue ล้ม → non-2xx; orphan ≥ 2 นาทีถูก replay; ledger reclaim ทุก 60 วินาที; orphan replay อายุไม่เกิน 60 นาที (`ORPHAN_REPLAY_MAX_AGE_MS`) |
| **NFR-503** ไม่ประมวลซ้ำ | event เดียวกันถูกประมวลครั้งเดียว | dedup ด้วย `webhookEventId`; claim แบบ compare-and-set บน `processedAt`; delegation `jti` ใช้ครั้งเดียว; settle กันซ้ำด้วย `invocationKey`; delivery มี `pushRetryKey` |
| **NFR-504** เวลาตอบ | ทางลัด p50 ≤ 6 วินาที p95 ≤ 8 วินาที; ทางปกติ p95 ≤ 15 วินาที; ไม่มีข้อใดเกิน 30 วินาที (เกณฑ์ A7 ของ `docs/specs/mangmee-ai-expense-advisor-spec-th.md`) | วัดได้: ทางลัด p50 5.4 / p95 6.8 วินาที ผ่าน; ทางปกติ p95 16.5 วินาที (ชุดจูน) และ 15.2 วินาที (ชุดเก็บไว้ทดสอบ) **ไม่ผ่านเกณฑ์** (หัวข้อ 14) |
| **NFR-505** เพดานเวลาของแต่ละชั้น | ผู้เรียกต้องรอนานกว่าผู้ถูกเรียกเสมอ | ตัวจำแนกงาน 5 วินาที; intake ข้อความ 25 วินาที (API รอ 30); intake รูป 45/90 วินาที (API รอ 195); AI turn API รอ 120 วินาที; AgentCore 20 วินาที (ค่าเริ่มต้น); tool ของ ERP 10 วินาที; OCR ต่อการเรียก 45/90 วินาที (API รอ 735 วินาทีสำหรับใบเสร็จ); document QA 45 วินาทีต่อการเรียก |
| **NFR-506** ไม่ปล่อยให้เงียบ | ทุก turn ที่ช้าต้องมีสัญญาณ | loading 60 วินาที + ข้อความรอที่ 5 และ 55 วินาที (FR-LINE-006) |
| **NFR-507** ขอบเขตสิทธิ์ | AI อ่านได้เท่าที่ผู้ใช้อ่านได้ในเว็บ และไม่มากกว่า feature ที่ร้านซื้อ | resolve สิทธิ์ใหม่ทุกการเรียก tool; ลำดับปฏิเสธ 5 ชั้น (FR-LINE-094); เกณฑ์ A5 = 100% |
| **NFR-508** การเขียนต้องมีคนยืนยัน | โมเดลไม่มีทางเขียนข้อมูลธุรกิจ | หมวด `final_mutation` ปิด (`AI_FINAL_MUTATION_ENABLED=false`); การเขียนผ่าน postback ที่ลงลายเซ็นเท่านั้น; W6 (เขียนผิด) ต้องเป็น 0 |
| **NFR-509** ความถูกต้องของตัวเลข | ตัวเลข วันที่ และจำนวนในคำตอบต้องตรงกับผลของ tool | ตรวจ grounding ก่อนส่ง; เกณฑ์ A1 ผิด 0 ครั้ง |
| **NFR-510** ข้อมูลส่วนบุคคล (PDPA) | เคารพการคัดค้านการประมวลผลด้วย AI; เก็บเท่าที่จำเป็น; มีกำหนดลบ | ด่าน opt-out 3 จุด; `AI_DATA_RETENTION_DAYS=90`; สรุปคำขอสนับสนุน 200 ตัวอักษร; ผล document QA 24 ชั่วโมง; ความชอบ 90 วัน; LINE user id ถูก hash ใน event log (`lineUserIdHash`, `chatKeyHash`); `PDPA_PSEUDONYMIZATION_KEY` |
| **NFR-511** การประมวลผลข้ามพรมแดน | โมเดลและภูมิภาคต้องอยู่ใน allowlist; global inference profile ต้องมีเลขอนุมัติ | `APPROVED_AI_*`, `AI_GLOBAL_INFERENCE_PROFILE_APPROVED` + `…_APPROVAL_REF` |
| **NFR-512** ความลับ | ไม่ log prompt, token, ความลับ หรือ token handoff ดิบ; secret ที่ถอดรหัสไม่ cache ข้าม request | `AI_PROMPT_LOGGING_ENABLED=false`; `log-redaction.spec.ts`; `LineMessagingCredentialsService`; สคริปต์ rich menu อ่าน token จาก Secrets Manager |
| **NFR-513** ต้านการฉีดคำสั่ง (prompt injection) | เนื้อหาจากผู้ใช้ เอกสาร และ tool เป็นข้อมูล | คำสั่งใน prompt ทุกตัว; `scrubRecordText` กับข้อความจากใบเสร็จ; ค่ากรองและรหัสรายการต้อง grounded; payload ของ AgentCore parse ใหม่ทุกฟิลด์ |
| **NFR-514** การควบคุมต้นทุน | ไม่มีการเรียกโมเดลนอกเงินที่จอง; ต้นทุนต่อ turn อยู่ในระดับที่วัดได้ | reservation ต่อการเรียก; เพดานรวมต่อเดือน; ขีดอัตรา 60 LLM และ 20 OCR ต่อบริษัทต่อนาที; วัดได้เฉลี่ย 0.60–0.65 บาทต่อ turn (ต่ำสุด 0.39 สูงสุด 2.26; หัวข้อ 14) |
| **NFR-515** ความเป็นธรรมด้านการคิดเงิน | ไม่คิดเงินร้านเมื่อ AI ล้มเหลว; ไม่คิดซ้ำ; ประวัติไม่ถูกคิดราคาใหม่ | FR-LINE-114; ราคาและ FX ตรึงบนการจอง; W15 (ถูกปฏิเสธแต่ถูกคิดเงิน) ต้องเป็น 0 |
| **NFR-516** ความทนทานต่อผู้ให้บริการ | ผู้ให้บริการล่มหรือ throttle ต้องไม่ทำให้เมนูและการ์ดใช้ไม่ได้ | คำสั่งกลุ่ม C ทำงานโดยไม่มีโมเดล; retry throttle 2 ครั้ง; hedge ของตัวจำแนก; critic fail-open; ledger fail-open |
| **NFR-517** ขีดจำกัดขาเข้า | ป้องกันหน่วยความจำและค่าใช้จ่ายบานปลาย | gateway `HTTP_BODY_LIMIT=1mb`; AgentCore body 1 MiB, ข้อความ 8,000 ตัวอักษร, แนบ 10, พร้อมกัน 16; buffer 20 ชิ้น 4,000 ตัวอักษร; tool ≤ 8 ครั้งต่อ turn |
| **NFR-518** การตรวจสอบย้อนหลัง | ทุกการปฏิเสธและทุกการอ่านที่อ่อนไหวมีร่องรอย | `AuditLog` (`ai.line.query.denied`, `AI_TOOL_INVOKE`, `AI_ACTOR_DELEGATION_CONSUME`, `ai_credit.cycle.opened`, `sales.demo_link.create`); `LineTurnOutcome`; `AiToolInvocation`; security events สำหรับ CloudWatch |
| **NFR-519** ภาษาและน้ำเสียง | ตอบตามภาษาของผู้ใช้ ไทยสุภาพแบบผู้หญิง คำธรรมดา ไม่มีรหัสภายใน | persona + ตัวกรอง (FR-LINE-089); เกณฑ์ A8 (machine token 0, คำลงท้ายเพศชาย 0) |
| **NFR-520** การ deploy แยกส่วนอย่างปลอดภัย | gateway, AgentCore artifact และ API ต้องตกลงรุ่นสัญญาก่อนทำงาน | probe ความสามารถ (`line-reliability-capabilities`, `line-draft-edit-capability`); ตรวจ source commit / artifact hash / contract version; ไม่ตรง → `AI_CONTRACT_UNSUPPORTED` ไม่ลดรุ่นเงียบ ๆ; โหมด `maintenance_only` |

---

## 14. บันทึกการทดสอบ: evaluation harness และ corpus

### 14.1 ชั้นของการทดสอบ

| ชั้น | สิ่งที่ตรวจ | ที่อยู่ | ใช้โมเดลจริง |
|---|---|---|---|
| Unit / logic spec | ตรรกะบริสุทธิ์ การ์ด ข้อความ ตัวจับคำสั่ง | `apps/api/src/modules/line-ai/**/*.spec.ts` (92 ไฟล์), `apps/ai-gateway/src/**/*.spec.ts` (73 ไฟล์) | ไม่ |
| PostgreSQL invariant spec | ความสอดคล้องของเงินจอง เครดิต delivery plan หลักฐานการอ่าน | ไฟล์ `*.pg.spec.ts` (ต้องตั้ง `BILLING_TEST_DATABASE_URL`; ห้ามข้ามเงียบ) | ไม่ |
| Whole-chain acceptance | เมทริกซ์ replay บังคับ: tool ที่ไปถึง, การเขียนที่ไปถึง, ผลปลายทาง, เจ้าของการส่ง | `scripts/run-line-ai-whole-chain-acceptance.mjs`, `scripts/line-ai-whole-chain-acceptance.catalog.mjs` (ประมาณ 60 รายการ `id`) | ไม่ (ยกเว้น controlled image replay) |
| Contract eval | ชุดประเมินความปลอดภัยและตัวปรับค่า | `packages/contracts/src/line-ai-security-eval.ts`, `line-ai-value-normalizer.spec.ts` | ไม่ |
| Real-provider eval | ความถูกต้อง ความเร็ว ต้นทุน กับโมเดลจริง | `scripts/line-ai-expense-advisor/*`, `scripts/run-line-ai-*.ts`, `scripts/line-ai-intake-cost-benchmark.ts` | ใช่ **ห้ามรันใน CI** |
| E2E (Playwright) | เส้นทางผู้ใช้บนเว็บที่เชื่อมกับ LINE | `e2e/line-recovery.spec.ts`, `e2e/line-signup-contact-email.spec.ts`, `e2e/ai-suggestions.spec.ts`, `e2e/journeys/*.journey.spec.ts` | ไม่ |

การยืนยันของ whole-chain เป็นเชิงความหมายโดยเจตนา: ถ้อยคำของคำตอบเปลี่ยนได้ แต่ tool ที่เรียก การเขียน ผลปลายทาง และเจ้าของการส่ง เปลี่ยนไม่ได้ พาธภาพของลูกค้าจริงและข้อเท็จจริงที่สกัดจากภาพไม่อยู่ใน catalog ภาพควบคุมถูกผูกตอนรันด้วย SHA-256 ของต้นทาง

### 14.2 Harness ที่ปรึกษารายจ่ายและ workflow (`scripts/line-ai-expense-advisor/`)

| ไฟล์ | หน้าที่ |
|---|---|
| `seed.ts` | ล้างและสร้างฐานข้อมูลประเมินใหม่ (ร้าน บทบาท รายจ่าย ใบเบิก) แบบกำหนดตายตัว |
| `types.ts` | รูปของ corpus v1 (gold เป็น tool/tag) และ v2 (gold เป็น workflow) |
| `oracle.ts` | รัน gold `{tool, input}` ผ่านตัวรัน tool จริงของ API ที่คอมไพล์แล้วใน process กับฐานข้อมูล seed ด้วยบทบาทของผู้ถาม ข้ามเฉพาะชั้น HTTP (secret และ delegation) การตรวจสิทธิ์ใน `execute()` ยังรันจริง ไม่มีการพิมพ์ตัวเลขคาดหวังด้วยมือ |
| `gold-oracle-pass.ts` | รัน gold ทุกข้อ ได้ `factsByTurn`, `resultsByTurn`, `resolvedCallsByTurn` (แทนตัวชี้ `$period`, `$fromShownItems` ด้วยค่าจริง) |
| `run-preflight.ts` | ตรวจรูปของ corpus และ oracle โดยไม่เรียกโมเดล |
| `launch-gateway.mjs` | เปิด gateway ที่คอมไพล์แล้วสำหรับการรันจริง |
| `run-real.ts` | เล่นทุกบทสนทนาผ่าน `runLineReliabilityRuntime`: API ที่คอมไพล์แล้วใน process, webhook ที่ลงลายเซ็น, จับการส่งด้วยการ patch `fetch` แล้วให้คะแนนและเขียนหลักฐาน JSON กับรายงาน markdown |
| `scorer.ts` | ให้คะแนนต่อ turn: (ก) ความเท่ากันของ tool และ input เทียบเฉพาะฟิลด์ที่ gold สนใจ หลังทำช่วงเวลาให้เป็นรูปมาตรฐาน (`periodKey` กับ `fromDate`/`toDate` ที่เทียบเท่านับว่าเท่ากัน) (ข) ข้อเท็จจริงในข้อความ: ทุกยอด จำนวน และยอดต่อกลุ่มที่ oracle พิสูจน์ต้องปรากฏในข้อความที่ส่ง ในรูปแบบไทยที่ยอมรับได้ รวม tag (`no_tool`, `must_answer`, `must_not_refuse`, `must_mention_any`, `must_not_claim`, `forbidden_tools`) และตัวชี้วัด W1–W15 |
| `run-rescore.ts` | ให้คะแนนหลักฐานที่บันทึกไว้ใหม่ โดยไม่เรียกโมเดล |
| `eval-spend.ts` | เพดานเงินของการรัน: `MANGMEE_EVAL_MAX_THB` บังคับด้วย trigger ใน schema `eval_guard` ของฐานข้อมูลประเมิน turn ที่ชนเพดานได้ `AI_BUDGET_UNAVAILABLE` (เป็นผลของ harness ไม่ใช่ของผลิตภัณฑ์) |
| `report.ts`, `period.ts`, `template.ts` | รายงาน ตัวช่วยช่วงเวลา และแม่แบบ corpus |
| `production-ai-env.json` | ค่า environment ด้าน AI ที่ใช้จำลอง production ตอนรัน |

Corpus:

| ไฟล์ | รุ่น | บทสนทนา | turn | ใช้ทำอะไร |
|---|---|---|---|---|
| `corpus.tuning.json` | 1 | 153 | 223 | ชุดจูนของที่ปรึกษารายจ่าย |
| `corpus.heldout.json` | 1 | 43 | 71 | ชุดเก็บไว้ทดสอบ |
| `corpus.sample.json` | 1 | 8 | 20 | ตัวอย่างและ preflight |
| `corpus.workflow.tuning.json` | 2 (seed `m3-tuning-q5-free-a-tax-periods-v1`, สถานะ `draft`) | 115 | 322 | ชุดจูนของ workflow |
| `corpus.workflow.oracle-sample.json` | 2 | 4 | 10 | ตัวอย่างหลายผู้กระทำ |
| `corpus.workflow.sample.json` | 2 | 1 | 2 | ตรวจรูป |

ชุดปิดตา (blind set v2–v14) ที่ใช้ตัดสินขั้นสุดท้ายของ workflow ไม่พบใน repo ที่ commit นี้ (มีเฉพาะชุดจูนและชุดเก็บไว้ทดสอบของที่ปรึกษา)

### 14.3 เกณฑ์และผลที่วัดได้: ที่ปรึกษารายจ่าย

เกณฑ์ A1–A8 จาก `docs/specs/mangmee-ai-expense-advisor-spec-th.md` §2 ผลจาก `docs/agent-memory/mangmee-ai-expense-advisor-2026-09-27.md` (commit ที่ประเมิน `47f46dfb`)

| เกณฑ์ | เป้า | ชุดจูน run 10 (223 turn) | ชุดเก็บไว้ทดสอบ run 3 (71 turn) |
|---|---|---|---|
| ผ่านรวม | — | **97.3%** (217/223) | **91.5%** (65/71) |
| A1 ตัวเลขผิด | 0 | 0 | 0 |
| A2 เครื่องมือและตัวกรอง | ≥ 95% จูน / ≥ 90% ทดสอบ | 98.2% (219/223) | 95.8% (68/71) |
| A3 คำถามต่อเนื่อง | ≥ 90% | 95.7% (67/70) | **82.1% (23/28) ไม่ผ่าน** |
| A4 ปฏิเสธผิด | ≤ 2% | 0 ข้อ | 0 ข้อ |
| A5 ขอบเขตแพ็กและสิทธิ์ | 100% | 40/40 | 12/12 |
| A6 ทางตัน | 0 | 0 | 1 |
| A7 ความเร็ว ทางลัด | p50 ≤ 6 วิ, p95 ≤ 8 วิ | p50 5.4 / p95 6.8 (157 turn) | p50 5.6 / p95 7.9 (54 turn) |
| A7 ความเร็ว ทางปกติ | p95 ≤ 15 วิ | **p95 16.5, สูงสุด 20.0 (66 turn) ไม่ผ่าน** | **p95 15.2 (17 turn) ไม่ผ่าน** |
| A8 ภาษา | machine token 0 | 0/0 | 0/0 |
| ต้นทุนต่อ turn | — | ต่ำสุด 0.39 / เฉลี่ย 0.65 / สูงสุด 2.26 บาท (ทางลัด 0.51, ทางปกติ 0.99) | ต่ำสุด 0.40 / เฉลี่ย 0.60 / สูงสุด 1.18 บาท |

ลำดับของชุดจูน: run 1 39.0% → run 2 55.6% → run 3 65.5% (76.2% หลังแก้ scorer และ corpus) → run 4 83.4% → run 6 96.9% → run 7 94.6% (บั๊ก alias ของช่วงเวลาในทางข้าม planner) → run 8 96.9% → run 9–10 97.3%

### 14.4 เกณฑ์และผลที่วัดได้: workflow-first

ตัวชี้วัด W1–W15 (`scorer.ts:616–622`): W1 ป้ายถูก, W2 และ W3 งานที่ทำสำเร็จ (ต่อ task), W4 ส่วนต่างจำนวน turn, W5 ต้นทุนต่องานที่สำเร็จแยกชนิด, **W6 การเขียนผิด** (applied และ preview), W7 จำนวนการเรียกโมเดลต่องาน, W8 เวลาต่อชั้น (p50/p95), W9 การเรียกที่ไม่ถูกต้อง, W10 การ์ดความเชื่อมั่นต่ำ, W11 A2/A3 ก่อนและหลัง, W12 turn ที่มี machine token, W13 ต้นทุนรวม, W14 timeout ของตัวจำแนก, W15 ถูกปฏิเสธแต่ถูกคิดเงิน

ผลของชุดปิดตา จาก `docs/plans/line-ai-workflow-first-plan.md` (บรรทัด 288–298):

| วันที่ | ชุด | W3 workflow | หมายเหตุ |
|---|---|---|---|
| 2026-11-06 | held-out v2 | 85/156 (54.5%) | มีการเขียนผิดจริง 1 ครั้ง (แก้ใบเบิกผิดร่าง) |
| 2026-11-06 | v3 | 98/164 (59.8%) | เขียนผิด 0 |
| 2026-11-07 | v4 / v5 | 53/119 (44.5%) / 111/169 (65.7%) | v5 พบการเขียนผิด: ร่างใบเบิก 14 ใบเก็บคำลงท้ายเป็นข้อมูล (ที่มาของ `stripLineFieldParticles`) |
| 2026-11-07 | v6 | 82/147 (55.8%) | คำพักงานกลายเป็นเหตุผลใน preview (ที่มาของ `isLineWorkflowPutOff`) |
| 2026-11-08 | v7 / v8 | 101/122 (82.8%) / 126/151 (83.4%) | ที่ปรึกษา 96.0% บน v8 |
| 2026-11-08 | v9 | 123/176 (69.9%) | ถดถอยจากตัวเลือกรายการที่รันก่อนตัวจำแนก (48 จาก 65 ข้อที่ตก) |
| 2026-11-08 | v10 | 171/204 (83.8%) | ที่ปรึกษา 78/81 |
| 2026-11-08 | v11 | 172/189 (91.0%) | ที่ปรึกษา 43/43 |
| 2026-11-08 | v12 | 148/190 (77.9%) | 36 จาก 42 ข้อที่ตก: คำพักงานที่พิมพ์บนการ์ด preview |
| 2026-11-08 | v13 | 198/204 task (97.1%); W3 แบบ scorer แก้แล้ว 297/326 (91.1%), W1 363/398 (91.2%) | W14 3/80 |
| 2026-11-08 | **v14 (สอบรอบสุดท้าย)** | ตามที่รัน 162/181; หลังแก้รอบ 23–23c และตรวจซ้ำเฉพาะจุด **คาดการณ์ 175/181 (96.7%)** | เขียนผิด 0; ไม่มีคำตอบให้ลองใหม่; การอ่านของที่ปรึกษาประมาณ 81% |

ข้อควรระวังในการอ่านตัวเลข: ค่า 96.7% ของ v14 เป็นค่าคาดการณ์จากการตรวจซ้ำเฉพาะจุดหลังแก้ ไม่ใช่การรันทั้งชุดใหม่ เอกสารแผนระบุว่าเวลาตอบบนเส้นทาง Bedrock ของ production ยังต้องตรวจที่ UAT และการรันชุดปิดตาใหม่ต้องขออนุมัติงบเกินเพดานการประเมิน

### 14.5 Harness และ corpus อื่นใต้ `scripts/`

| ไฟล์ | เนื้อหา |
|---|---|
| `line-ai-reliability-corpus.ts`, `line-ai-reliability-fixtures.ts`, `line-ai-reliability-runtime.ts`, `line-ai-reliability-evaluation.ts`, `line-ai-reliability-blind-comparison.ts` | ชุดทดสอบความน่าเชื่อถือ v2: runtime ที่เล่น webhook ผ่าน API ที่คอมไพล์แล้ว เทียบข้อสังเกต A/B/C ที่แช่แข็ง "ไม่อนุมานคุณภาพจากความเร็วหรือ mock" |
| `line-ai-latency-autonomy.corpus.ts` | corpus ของช่องทางเร็วและแผนเตรียมล่วงหน้า |
| `line-ai-intake-cost.corpus.ts`, `line-ai-intake-cost-benchmark.ts` | corpus แช่แข็งและ benchmark ต้นทุนของ intake: เรียก controller จริงและ `OrchestratorAgent` จริงใน process ภายใน `runWithUsageContext` tool ของ ERP เป็น stub รันจาก `apps/ai-gateway` ใช้เงินจริง |
| `line-ai-operator-language.corpus.ts`, `run-line-ai-operator-language-eval.ts`, `run-line-ai-operator-language-replay.ts` | ภาษาของผู้ใช้จริง (คำย่อ คำสะกดผิด) ประเมิน router กับผู้ให้บริการจริง ไม่ใช้ API ฐานข้อมูล ERP LINE หรือ tool เขียน |
| `line-ai-natural-conversation-corpus.ts`, `line-ai-natural-wire-report.ts` | บทสนทนาธรรมชาติหลาย turn และรายงานข้อความบนสาย |
| `line-ai-substitute-routing.corpus.ts` | การ route ใบรับรองแทนใบเสร็จ |
| `brain-family-questions.golden.ts` | คำถามทองของ family การอ่าน |
| `run-line-ai-controlled-conversation.ts` | บทสนทนาควบคุมกับผู้ให้บริการจริง ผล ERP เป็นข้อเท็จจริงคงที่ ไม่เขียนสถานะใด |
| `run-line-ai-controlled-image-replay.mjs` | เล่นภาพควบคุมซ้ำโดยผูกด้วย SHA-256 |
| `line-ai-task-report.ts` | รายงานต่อ task จาก `LineAiTaskRun` |
| `line-ai-reliability-optout-smoke.ts`, `line-ai-reliability-compiled-smoke.cjs` | smoke ของ opt-out และของ artifact ที่คอมไพล์แล้ว |
| `recalibrate-line-intake.cjs` | ปรับตัวประมาณ token ของ intake หลังแก้ prompt |
| `local-proof/*.sh`, `qa/journey-mobile.spec.ts` | ชุดพิสูจน์บนเครื่องและ journey บนมือถือ |

กฎการรันที่สะท้อนในโค้ดและบันทึกงาน: การประเมินกับผู้ให้บริการจริงใช้ `ANTHROPIC_API_KEY` ซึ่งโค้ดอนุญาตเฉพาะ `APP_ENV=local`; ทุกการรันมีเพดานเงิน; ไม่รันชุดเหล่านี้ใน CI

---

## 15. ข้อมูลอ้างอิง: Prisma models, ค่าตั้ง, endpoint ภายใน

### 15.1 Prisma models ของพื้นผิวนี้ (`apps/api/prisma/schema.prisma`)

| กลุ่ม | models |
|---|---|
| ตัวตนและช่องทาง | `ExternalIdentity`, `LineChannelBinding`, `LineCompanyContext`, `PlatformLineCredential`, `LineWebHandoffToken`, `LineWebLoginTransaction`, `EmployeeLineLinkToken` |
| การรับและส่งข้อความ | `LineWebhookEventLog`, `LineIntakeAttempt`, `LineIntakeState`, `LineIntakePendingMedia`, `LineDeliveryPlan`, `LineLedgerDelivery`, `LineTurnOutcome` |
| บทสนทนาและงาน | `AiConversation`, `AiTurn`, `LineAiTaskRun`, `LineReadEvidence`, `AiToolInvocation`, `AiToolInvocationLog`, `LineDocumentQaJob` |
| สนับสนุนและแพ็กเกจ | `LineSupportRequest`, `LineSupportMessage`, `LineSupportMessageBlob`, `PackageChangeRequest`, `CompanySignupRequest` |
| การวัดและงบ | `CompanyAiConfiguration`, `PlatformAiBudgetConfig`, `AiUsageEvent`, `CompanyAiMonthlyUsage`, `CompanyAiMonthlyBucketUsage`, `AiBudgetReservation`, `AiCreditGrant`, `AiCreditEntry`, `AiFxRate`, `CompanyOcrUsageEvent`, `CompanyOcrMonthlyUsage` |
| AI แนะนำ | `AiDraftRequest`, `AiSuggestion`, `AiSuggestionCitation`, `AiDraftArtifact`, `AiCandidateAction`, `AiSuggestionReview` |
| เดโม่ | `SalesDemoLink`, `DemoChatMessage` |

รายละเอียดคอลัมน์อยู่ในเอกสารแบบจำลองข้อมูลของชุดนี้ เอกสารนี้ไม่ได้ตรวจคอลัมน์ทีละตัว

### 15.2 ค่าตั้งสำคัญ (`packages/config/src/index.ts`)

| ตัวแปร | ค่าเริ่มต้นในโค้ด | ค่าที่พบในสคริปต์ deploy |
|---|---|---|
| `LINE_AI_BUFFER_DEBOUNCE_MS` / `…MAX_WAIT_MS` | 2000 / 8000 | 500 ทั้ง UAT และ production (`infra/kamal/config.json`) |
| `LINE_AI_LOADING_ANIMATION_ENABLED` / `…LOADING_ON_ACCEPT_ENABLED` | true / false | — |
| `LINE_AI_RELIABILITY_V2_MODE`, `LINE_AI_DELIVERY_PLAN_V2_ENABLED` | `on`, true | — |
| `LINE_AI_REIMBURSEMENT_DRAFT_WRITE_ENABLED`, `LINE_AI_DOCUMENT_QA_ENABLED`, `LINE_AI_APPROVED_KNOWLEDGE_ENABLED`, `LINE_AI_PREFERENCES_ENABLED`, `LINE_AI_DRAFT_EDIT_ENABLED`, `LINE_AI_PREPARED_SIMPLE_READ_ENABLED`, `LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED` | true | — |
| `LINE_AI_PUBLIC_LOOKUP_ENABLED`, `LINE_AI_ADVISOR_DIRECT_ANSWER_ENABLED`, `LINE_AI_FLEX_TEXT_FALLBACK_ENABLED`, `LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED`, `LINE_AI_FUSED_PLAN_SHADOW_ENABLED`, `LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED` | false | — |
| `LINE_AI_ADVISOR_MODE` | `off` | `social` เป็นค่าเริ่มต้นของ `infra/prod-ecs-express/deploy.sh` (ยุค ECS) |
| `LINE_AI_SUBSTITUTE_SEMANTIC_ROUTING_MODE`, `LINE_AI_REIMBURSEMENT_SEMANTIC_MODE`, `LINE_AI_INTAKE_STATE_MODE` | `off` | — |
| `LINE_AI_LEDGER_ENABLED` | false | ไม่พบค่าในไฟล์ที่ตรวจ |
| `LINE_SIGNUP_ENABLED` / `LINE_SIGNUP_APPROVAL_MODE` | false / `MANUAL` | true / `AUTO_FREE` (ค่าเริ่มต้นของ deploy.sh ยุค ECS) |
| `LINE_WEB_HANDOFF_ENABLED`, `LINE_WEB_LOGIN_ENABLED` | false | handoff = true (deploy.sh ยุค ECS) |
| `LINE_OFFICIAL_REPLY_ENABLED` | false | true ใน production (`infra/kamal/config.json`) |
| `LINE_AI_AGENT_RUNTIME` | `disabled` | `agentcore` (บังคับโดย `infra/dev-kamal/release_inventory.py`) |
| `MODEL_PROVIDER` | `disabled` | `bedrock` (ตามคำอธิบายใน `.env.example`) |
| `BEDROCK_MODEL_ID` | ไม่มี | `global.anthropic.claude-sonnet-4-6` (ค่าเริ่มต้นของ `infra/ai-gateway/agentcore-deploy.sh` และ `.env.example`) |
| `AI_MAX_TOOL_CALLS` / `AI_TOOL_TIMEOUT_MS` | 8 / 10000 | — |
| `AGENTCORE_INVOKE_TIMEOUT_MS` | 20000 | — |
| `AI_MONTHLY_BUDGET_SATANG` / `…_CEILING` | 200000 / 1000000 | — |
| `AI_THB_PER_USD` | 33 | — |
| `AI_LLM_MAX_PER_COMPANY` / `AI_OCR_MAX_PER_COMPANY` / `AI_RATE_LIMIT_WINDOW_SECONDS` | 60 / 20 / 60 | — |
| `AI_DATA_RETENTION_DAYS` | 90 | — |
| `AI_FINAL_MUTATION_ENABLED`, `AI_PROMPT_LOGGING_ENABLED` | false | — |

ตัวแปร `LINE_AI_TOOLUSE_LOOP_ENABLED`, `LINE_AI_COVERAGE_CRITIC_ENABLED` ยังอยู่ใน schema เพื่อให้ environment เดิม validate ผ่าน แต่ไม่มีโค้ดอ่านแล้ว (คอมเมนต์ใน schema) ตัวแปร `LINE_AI_PROVIDER_CLIENT_REUSE_ENABLED`, `LINE_AI_AGENTCORE_SESSION_AFFINITY_ENABLED`, `LINE_AI_SMALL_ROUTER_SHADOW_ENABLED` ถูกสงวนไว้และยังไม่ผูกกับพฤติกรรมใด `LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES` ยังถูกตั้งใน config ของ deploy แต่ gateway ใช้รายการที่ตั้งตายตัวในโค้ด (FR-LINE-085)

### 15.3 Endpoint ภายในฝั่ง API (ทั้งหมด `@Public()` + `x-internal-secret`)

| endpoint | ผู้เรียก | หน้าที่ |
|---|---|---|
| `POST /v1/internal/ai/tools/invoke` | gateway / AgentCore | เรียก read tool (FR-LINE-094) |
| `POST /v1/internal/ai/budget-step`, `POST /v1/internal/ai/budget-settle` | gateway | จองและชำระต่อการเรียก (FR-LINE-113) |
| `POST /v1/internal/ai/line-ledger/drain`, `…/sweep-orphan-events` | worker | reclaim และกู้ orphan (FR-LINE-008) |
| `POST /v1/internal/ai/line-capture-results/drain` | worker | ส่งผลอ่านไฟล์ (FR-LINE-050) |
| `POST /v1/internal/ai/line-document-qa/drain` | worker | ทำงาน document QA ต่อ (FR-LINE-054) |
| `POST /v1/internal/ai/draft-requests/drain`, `…/generate` | worker | AI แนะนำ (FR-LINE-101) |

---

## 16. สิ่งที่ยืนยันไม่ได้ และสิ่งที่อยู่ใน docs แต่ไม่พบในโค้ด

### 16.1 ยืนยันไม่ได้หรือไม่ได้ตรวจละเอียด

1. ลำดับด่านระดับบรรทัดภายใน `executeText` (บรรทัด 8068–10852) และ `executeReceiptUploadInner` (11498–12695) อ่านจากคอมเมนต์และชื่อเมธอด ไม่ได้ตามทุกแขนง
2. ค่า `permission` ของแต่ละรายการใน `LINE_CHAT_ACTIONS` (ตาราง 8.2 ช่อง "permission ของ action") ไม่ได้คัดลอกครบ
3. เส้นทางภายในของ `handleFixedRead` ว่าเรียก tool ผ่าน gateway หรือในตัว และสถานะการทำงานของปุ่ม fixed read ที่ commit นี้ (FR-LINE-031)
4. รายการคำทักทายที่ตอบด้วยโค้ด (FR-LINE-027) และจุดที่ระบบส่งการ์ดกันบัญชีหลุดครั้งแรก (FR-LINE-034)
5. permission ที่ `maySubmitSignature` ตรวจ และ spec ของการอัปโหลดลายเซ็น (FR-LINE-055)
6. ชุด feature และเครดิตของร้าน `FREE_TRIAL_15` รุ่นเก่า และจุดใช้ของ `LINE_FREE_AI_BUDGET_SATANG` (FR-LINE-111)
7. เงื่อนไขที่ข้อความของผู้ไม่มีบริบทส่วนตัวเข้าช่อง public general แทนการ์ดประตู (FR-LINE-099)
8. ค่า environment จริงของ UAT และ production (ระบบคลาวด์ถูกลบแล้ว) โดยเฉพาะ `LINE_AI_LEDGER_ENABLED`, `LINE_AI_ADVISOR_MODE`, โมเดลของตัวจำแนกงาน และ `DOCUMENT_AI_MODEL_ID` ค่าในตาราง 15.2 มาจากสคริปต์ deploy และ config ที่ commit ไว้เท่านั้น
9. จำนวนการ์ดความรู้ที่อนุมัติ (นับจากรูปแบบ `card(` ในไฟล์ ได้ 17 และ 53 ในไฟล์ร่าง) และสถานะการอนุมัติของการ์ดร่าง
10. ชื่อ model หลักของใบเตรียมจ่ายและคอลัมน์ของตารางในหัวข้อ 15.1
11. ผลการวัดในหัวข้อ 14 คัดจากเอกสารใน `docs/` ไม่ได้รันซ้ำ (ข้อกำหนดของงานนี้ห้ามรันทดสอบ) ไฟล์หลักฐานการรัน (JSON และรายงาน) ไม่ได้ค้นหาใน repo

### 16.2 อยู่ใน docs หรือบันทึกงาน แต่ไม่พบในโค้ดที่ commit นี้

1. **ชุดข้อสอบปิดตา workflow v2–v14** `docs/plans/line-ai-workflow-first-plan.md` รายงานผลของชุดปิดตา 13 ชุด แต่ใต้ `scripts/line-ai-expense-advisor/` มีเฉพาะ corpus จูนของ workflow และตัวอย่าง ไม่มีไฟล์ชุดปิดตา
2. **Rich menu แยกสำหรับพนักงาน** มีไฟล์ภาพ `mangmeeplus-staff-menu-2500x843.png` และ `-v2.png` แต่ไม่มี manifest หรือโค้ดติดตั้ง rich menu ต่อผู้ใช้ มีเพียงเมนู quick reply
3. **เครดิตเริ่มต้น 80** คอมเมนต์ใน `company-ai-budget-policy.ts` กล่าวถึง "the default 80" ขณะที่ค่าคงที่คือ 5,000 สตางค์ (50 เครดิต)
4. **สวิตช์ความสามารถหลายตัว** (`LINE_AI_TOOLUSE_LOOP_ENABLED`, `LINE_AI_COVERAGE_CRITIC_ENABLED`, `LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES` ฝั่ง gateway) ยังถูกบรรยายในแผนและตั้งใน config ของ deploy แต่โค้ดไม่อ่านแล้ว หรืออ่านแต่ถูกทับด้วยค่าตายตัว
5. **agent `marketing` และสถานะ `planned`** อยู่ใน type ของ `LineAiAgent` แต่ router ไม่อนุญาต agent นี้
6. **การคุยร่างรายจ่ายหลาย turn, intake state แบบ fail-closed, semantic routing ของใบรับรองแทนใบเสร็จและของใบเบิก** มี spec และโค้ด แต่ค่าเริ่มต้นปิดทั้งหมด (`off`/`false`) ถือเป็นความสามารถที่ยังไม่เปิดใช้ ไม่ใช่ความสามารถที่ส่งมอบ
7. เอกสาร spec ภายใต้ `docs/specs/line-ai-*.md` มีจำนวนมาก (อย่างน้อย 20 ไฟล์) ผู้เขียนไม่ได้เทียบทุก spec กับโค้ดทีละข้อ รายการข้างต้นเป็นเฉพาะจุดที่พบระหว่างอ่านโค้ด

---

## 17. นอกขอบเขตแพ็ก 1,999 (มีโค้ดแต่ไม่ได้ขาย)

รายการต่อไปนี้มีโค้ดครบในพื้นผิว LINE/AI แต่ต้องอาศัย feature ที่ไม่อยู่ใน `TIER_FEATURE_PRESETS` ของแพ็กใด จึงไม่ถูกบรรยายเชิงลึก

- **LINE OA ของร้านเองและกล่องข้อความลูกค้า** (`POST /v1/crm/line/webhook/:webhookKey`, หน้า `/companies/[companyId]/settings/line-oa`, `LineOaSettingsPage.tsx`, การลงทะเบียนลูกค้าทาง LIFF `line/customer-register`) ต้องมี feature `line_oa`, `crm.inbox`
- **AI ของ CRM ใน gateway** (`crm-booking-extract`, `crm-intake`, `crm-customer-profile-extract`, `crm-reply-draft`, `crm-trust-score`, `crm-summary`, `crm-insights`, `crm-broadcast`) ต้องมี feature `crm`
- **Read tools ของ CRM** (`crm.get_customer_summary`, `crm.search_customers`, `crm.get_customer_360`, `crm.get_report_summary`, `crm.get_pipeline_summary`, `crm.list_open_followups`, `crm.get_booking_summary`, `crm.list_bookings`, `crm.get_inbox_summary`, `crm.list_conversations`, `crm.get_conversation_summary`)
- **Read tools ของคลังสินค้า** (`inventory.search_products`, `inventory.get_product_detail`, `inventory.get_stock_balance`, `inventory.list_low_stock`, `inventory.summarize_stock_movements`) และ `InventoryAgent` ต้องมี `product_catalog` / `inventory`
- **Read tools ของยอดขายและเอกสารบัญชี** (`sales.get_sales_summary`, `accounting.get_summary`, `accounting.list_recent_documents`, `accounting.get_document_detail`, `accounting.get_receivable_summary`) ต้องมี `sales_documents`
- **Read tools ของบัญชีแยกประเภทและรายงาน** (`ledger.get_financial_summary`, `ledger.get_period_status`, `ledger.get_report_summary`, `reports.get_monthly_report_summary`) ต้องมี `double_entry_ledger` / `reports`
- **Read tools ของภาษีเต็มชุด** (`tax.get_upcoming_tax_obligations`, `tax.get_vat_summary`, `tax.get_wht_summary`, `tax.get_cit_calendar`, `tax.list_missing_tax_documents`, `tax.get_tax_code_profile`, `tax.get_transaction_tax_summary`, `tax.get_reconciliation_summary`) ต้องมี `thai_tax` (แพ็ก 1,999 ได้เฉพาะ `wht_pnd53` และ `wht_50bis` ไม่เปิดทั้ง workspace ภาษี)
- **Read tools ของจัดซื้อ** (`procurement.get_ap_outstanding`, `procurement.get_summary`, `procurement.search_suppliers`, `procurement.get_purchase_order_detail`) และคิวอนุมัติจัดซื้อบนการ์ดรออนุมัติ
- **Read tools ของธนาคาร** (`bank.get_account_balances`, `bank.get_reconciliation_status`) และ route `bank-statement-extract`
- **Read tools ของ workflow automation** (`workflow.explain_run`, `workflow.list_assigned_tasks`, `workflow.list_recent_failures`, `workflow.summarize_rule_health`)
- **Tools ที่ยังไม่พร้อมรัน** (`executionReady: false`): `crm.suggest_sales_followups`, `accounting.capture_receipt_evidence`, `hr.get_leave_summary`
- **ปุ่มเมนู quick reply** ยอดขายวันนี้, คิว/นัดวันนี้, แชทค้างตอบ, รายงานการเงิน, ใบสั่งซื้อ (PO) ไม่ปรากฏกับร้านในแพ็กที่ขาย เพราะกรองด้วย feature
- **แม่แบบ AI แนะนำทั้ง 5** (`cfo_cash_risk_summary`, `crm_followup_next_action`, `inventory_reorder_review`, `tax_evidence_checklist`, `workflow_review_checklist`) ต้องมี permission ของโมดูลข้างต้น
- **Public lookup** (`public.lookup`, โปรไฟล์งบ `public-lookup/2`) ปิดเป็นค่าเริ่มต้น
- **ผู้ให้บริการ OpenAI** (`openai.provider.ts`, `OPENAI_MODEL=gpt-4.1-mini`) มีโค้ดและอยู่ใน allowlist เริ่มต้น แต่สคริปต์ deploy ที่ตรวจใช้ Bedrock
