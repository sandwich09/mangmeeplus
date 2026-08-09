# Agent Memory: LINE AI จำบริบทรูปข้ามเทิร์นไม่ได้ → ถามวน

Status: DONE 2026-08-09 — ครบทั้ง 7 ข้อ เทสผ่าน
Owner: thawatchai
Scope: `packages/contracts/src/line-ai.ts`, `apps/api/src/modules/line-ai` (ledger service + process-line-webhook)

## อาการที่ผู้ใช้รายงาน

ส่งรูป → AI ถามกลับว่าเป็นอะไร → ตอบ → AI บอกให้ส่งรูป → ส่งรูป → ถามอีก วนไม่จบ

## ต้นเหตุ (ยืนยันจากโค้ดแล้ว)

เส้นทาง **ข้อความ** ตอนถามกลับ เขียน `waiting_user` เข้า ledger
(`process-line-webhook.use-case.ts:1107-1118`) → เทิร์นถัดไปโหลดผ่าน `openWaitingUser` แล้วส่งให้โมเดลเป็น
`openClarifications` → โมเดลตีความคำตอบเองได้ ยืดหยุ่น

เส้นทาง **รูป** ไม่ได้เขียน ledger เลย ไปใช้ `classifyPendingMediaReply` ซึ่งเป็น substring match
6 คำ (`ใบเสร็จ, บันทึก, ใช่, receipt, บิล, สลิป`) แทน คอมเมนต์ในโค้ดเขียนเองว่า
*"ponytail: substring match over a fixed keyword set … swap for the intake router only if free-form
replies start slipping through"* — เงื่อนไขนั้นเกิดแล้ว

วัดจริง 2026-08-09: คำตอบที่คนไทยพิมพ์ **16/18 แบบได้ `ambiguous`** รวมถึง `1`, `ครับ`, `โอเค`,
`ใบกำกับภาษี`, และ **`เอกสารค่าใช้จ่าย` ซึ่งเป็นคำที่อยู่ในคำถามของระบบเอง**

ลูป:
1. `ambiguous` → แถว `LineIntakePendingMedia` ค้าง `PENDING` และคำตอบถูก route เหมือนข้อความใหม่
2. โมเดลไม่รู้ว่ามีรูปค้าง (ไม่มีทั้งใน ledger และใน `conversationContext`) → ตอบ "ส่งรูปมา"
3. ผู้ใช้ส่งรูปใหม่ → `lineMessageId` เปลี่ยน → `ensurePendingMedia` สร้างแถวใหม่ (unique key คือ
   `companyId_lineMessageId`) → ถามซ้ำ + **เก็บไฟล์ซ้ำอีกชุด**
4. `findFirst … orderBy createdAt desc` หยิบแถวใหม่สุดเสมอ แถวเก่าค้างจน TTL 30 นาที

ปัจจัยร่วมที่ทำให้ "ลืม" ด้วย:
- `conversationContext` เก็บรูปเป็นสตริง `[ผู้ใช้ส่งรูป/ไฟล์]` **ไม่มี id ของไฟล์** โมเดลอ้างถึงรูปเดิมไม่ได้
- context window = 15 นาที / 16 เทิร์น (`LINE_AI_CONTEXT_WINDOW_MINUTES|MAX_TURNS`)
- เทิร์นที่ส่งข้อความไม่สำเร็จถูกบันทึก `ERROR` ซึ่งถูกกรองออกจาก context (`status IN ('COMPLETED','REFUSED')`)
- AgentCore สร้าง session ใหม่ทุก invoke (`randomUUID()`) — ตั้งใจ ความจำอยู่ฝั่งแอปล้วน

## ดีไซน์ที่จะทำ

1. **contracts** — `LineAiOpenClarification` เพิ่ม `pendingMedia?: { pendingMediaId, attachmentId, mimeType }`
   เพื่อให้โมเดลรู้ว่ามีไฟล์ค้างอยู่จริงและอ้างถึงได้ ไม่ใช่แค่รู้ว่า "เคยส่งรูป"
2. **ledger** — `LedgerSubRequestInput` + การ serialize/parse เพิ่มฟิลด์เดียวกัน (เก็บเป็น field แบน ๆ ใน
   XADD ตามรูปแบบเดิม)
3. **media path** — ตอน `ensurePendingMedia` สำเร็จและถามคำถาม ให้ `appendSubRequests` แบบ
   `state: 'waiting_user'`, `clarifyQuestion: MEDIA_CLARIFY_REPLY`, `text: caption`,
   `clarifyForIntent: 'EXPENSE_DOCUMENT_CAPTURE'`, พร้อม `pendingMedia`
4. **preview** — `[ผู้ใช้ส่งรูป/ไฟล์ #<attachmentId>]` เพื่อให้ `conversationContext` อ้างไฟล์ได้
5. **text path** — คง `classifyPendingMediaReply` เป็น fast path (ตอบตรง ๆ ก็จบเร็ว ไม่ต้องเรียกโมเดล)
   แต่ขยายชุดคำให้ครอบคลุมเลขข้อ/คำรับสั้น/ชื่อเอกสารภาษีไทย และเมื่อ `ambiguous` ให้ **ส่งต่อไปโมเดลพร้อม
   `openClarifications` ที่มี `pendingMedia`** แทนการ route เป็นข้อความใหม่ลอย ๆ
6. **ack** — เมื่อ resolve เป็น receipt/illustration ให้ `ledger.ack(...)` ปิด entry ไม่ให้ค้างถาม
7. **กันสร้างซ้ำ** — ก่อนสร้าง pending ใหม่ ถ้ามีแถว PENDING ที่ยังไม่หมดอายุของ user เดิมอยู่แล้ว
   ให้ผูกกับของเดิมแทนการถามใหม่ (ตัดลูปข้อ 3 และหยุด storage leak)

## ข้อควรระวัง

- ledger **fail-open**: Redis ล่ม = no-op ที่ log warn เท่านั้น ดังนั้น `LineIntakePendingMedia` ใน Postgres
  ต้องยังเป็น source of truth ของ "มีรูปค้าง" — ledger เป็นตัวพาไปให้โมเดลเท่านั้น ห้ามย้าย state ไปอยู่ Redis อย่างเดียว
- `ensurePendingMedia` มี unique race handling อยู่แล้ว (ผู้ชนะเท่านั้นที่อัปโหลด bytes) อย่าทำลาย invariant นั้น
- redelivery (webhookEventId ใหม่ lineMessageId เดิม) ต้องเงียบเหมือนเดิม — `created: false` ห้ามถามซ้ำ

## สิ่งที่ทำจริง (ครบทั้ง 7)

1. `LineAiOpenClarification.pendingMedia?{pendingMediaId, attachmentId, mimeType}`
2. ledger: `LedgerPendingMedia`, serialize 3 field แบน (`pendingMediaId|AttachmentId|MimeType`),
   parse แบบ **all-or-nothing** กัน trio เขียนไม่ครบแล้วได้ handle ที่ resolve ไม่ได้, ส่งผ่าน `openWaitingUser`
3. `appendMediaClarification()` — media path เขียน `waiting_user` + `clarifyForIntent: EXPENSE_DOCUMENT_CAPTURE`
   ทั้งสอง call site; caption ว่างใช้ `MEDIA_PENDING_REQUEST_TEXT` แทนการเก็บ ask ว่าง
4. `mediaPreviewLabel()` → `[ผู้ใช้ส่งรูป/ไฟล์ #<attachmentId>]`
5. คำถามเปลี่ยนเป็นเมนูมีเลข + fast path รับเลขข้อ/ลำดับไทย/ชื่อเอกสาร; **ไม่รับคำรับสั้น**
   (`ครับ/ok`) โดยตั้งใจ เพราะคำถามเป็น A-หรือ-B การเดาข้างคือบั๊กเดิม — ปล่อยให้โมเดลตัดสินโดยมี
   `pendingMedia` ติดไปด้วย
6. `ackMediaClarification()` ปิด entry เมื่อ resolve แล้ว best-effort ไม่ให้ล้มคำตอบที่ลูกค้ารออยู่
7. `ensurePendingMedia` เจอแถว PENDING ที่ยังไม่หมดอายุ → ผูกกับของเดิม ไม่ถามซ้ำ ไม่เก็บไฟล์ซ้ำ
   (ตัดลูปข้อ 3 + หยุด storage leak) และผลพลอยได้: ผู้แพ้ race ไม่จอง upload intent ทิ้งอีกต่อไป

## Verification

- probe คำตอบจริง 18 แบบ: ไม่เข้าใจ **16 → 7** ที่เหลือคือคำรับสั้นซึ่งจงใจส่งต่อให้โมเดล
- เทสใหม่: ledger เขียน `waiting_user` พร้อม `attachmentId`, preview มี `#<attachmentId>`,
  ส่งรูปซ้ำไม่ถามซ้ำ/ไม่เก็บซ้ำ, เลขข้อ+ลำดับไทย, ไม่อ่าน `1500` เป็นตัวเลือก, ชื่อเอกสาร,
  คำรับสั้นยังกำกวม, negation ที่มีชื่อเอกสารยังไม่เป็น receipt
- อัปเดตเทสเดิม 5 จุด (ถ้อยคำคำถาม 4 + race 1) — invariant เดิมยังคุ้มครบ
- `src/modules/line-ai` + `ai-draft` ผ่านทั้งหมด; ทั้ง api fail 10 = suite ที่ต้องมี `DATABASE_URL`;
  `tsc` 14 error pre-existing

## ยังไม่ได้ทำ (เสนอไว้)

- `conversationContext` ยังกรอง `status IN ('COMPLETED','REFUSED')` → เทิร์นที่ส่งข้อความไม่สำเร็จ (`ERROR`)
  ยังหายจากความจำ
- window 15 นาที / 16 เทิร์น ยังเท่าเดิม
- ยังไม่ได้ตรวจ CRM inbox AI
