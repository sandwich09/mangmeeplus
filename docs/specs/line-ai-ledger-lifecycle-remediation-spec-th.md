# Spec: LINE AI — NOGROUP, budget errors, intake cost และเพดานแชต/OCR

## 1. สถานะและขอบเขต

- วันที่: 2026-09-17
- สถานะ: รวมขอบเขตตามคำขอ owner แล้ว; ยังไม่ implement / deploy / live acceptance
- ผู้ใช้: เจ้าของร้านและพนักงานที่เชื่อม shared LINE OA, ผู้ส่งใบเสร็จผ่านเว็บ และ System Admin ผู้ดูแลต้นทุน
- เป้าหมาย: แชตใหม่/ledger หมดอายุเริ่มคุยได้, แจ้ง budget refusal ตรงเหตุ, รับเอกสารและกรอกเองได้เมื่อ AI หยุด, ลดต้นทุน intake โดยไม่ลดความถูกต้อง และแยกเพดานแชตกับ OCR ที่ผู้ดูแลตรวจสอบได้
- [แผนงาน](../plans/line-ai-ledger-lifecycle-remediation-plan-th.md)
- [หลักฐาน UAT และ task memory](../agent-memory/uat-line-chat-nogroup-2026-09-17.md)
- [หลักฐานต้นทุนและ receipt flow](../agent-memory/line-intake-cost-and-budget-receipt-behavior-2026-09-17.md)
- [Impact/bug-gap review รอบ 2](../research/line-ai-remediation-impact-review-2026-09-17-th.md): findings, source anchors และเงื่อนไขที่ยังต้องพิสูจน์ก่อนเปิดใช้

Owner 2026-09-17 ขอรวมงานทั้งหมดใน spec NOGROUP เดิม และเลือก **แยกเพดานแชตและ OCR: แต่ละส่วนใช้ได้ไม่เกินงบของตัวเอง** ไม่ใช่กันงบส่วนหนึ่งที่ OCR สามารถยืมงบแชตได้ ชื่อไฟล์เดิมคงไว้เพื่อไม่ให้ลิงก์สูญหาย; scope แบ่งเป็น 5 งานในเอกสารเดียว:

| งาน | ข้อกำหนด | ผลที่ต้องได้ |
| --- | --- | --- |
| A: Ledger lifecycle | §4–7 | ยืนยัน stream absent แล้วคุยต่อได้; group/store/marker failure ยังหยุดอย่างปลอดภัย |
| B: Budget refusal และ receipt fallback | §9 | ข้อความ/terminal ตรงเหตุ, บอกสถานะไฟล์จริง, ไม่เรียก AI ซ้ำเมื่อถูกปฏิเสธ |
| C: Intake cost | §10 | ลดต้นทุนทั้ง journey โดยคง routing/OCR quality และ permission boundaries |
| D: AI Budget visibility | §11 | เห็นข้อความ/รูป/ต้นทุน cache/ยอดแยกและข้อจำกัดข้อมูลย้อนหลัง |
| E: Separate chat/OCR caps | §12 | แยกเพดานสองส่วนภายใต้เพดานรวม ไม่มีการยืมงบและไม่มี provider action ที่ไม่ได้จองงบในโหมดใหม่ |

การอนุมัติทำ spec ไม่ใช่การเพิ่มงบหรือเปิด policy บนบริษัทจริง ข้อ A–D ทำเป็นช่วงส่งมอบได้ แต่ห้ามปิดงานทั้งหมดว่าเสร็จก่อนข้อ E ผ่าน acceptance ด้วย

กรณี Production ที่ผู้ใช้รายงานว่า “พิมพ์เองไม่ตอบ แต่กดคุยกับน้องมั่งมีมีคำทักทาย” ตรวจพบ monthly AI budget denial ในลำดับเวลาเกาหลีที่ตรงกับภาพ (รายละเอียด §8.1) เป็นคนละ blocking cause กับ UAT NOGROUP ห้ามถือว่าได้รับการแก้แล้วเพียงเพราะแก้ ledger สำเร็จ

## 2. หลักฐานและข้อจำกัด

| หลักฐาน | ข้อสรุปที่ยืนยันได้ |
| --- | --- |
| UAT 2026-09-17 19:12:00–19:12:01 เวลาไทย | webhook รับข้อความ 200 แล้ว `XPENDING` ตอบ `NOGROUP`; จบ `marker_unavailable` / `CONSUMPTION_MARKER_UNAVAILABLE` ก่อนถึง AI |
| UAT source `1468ea7088a961af81ebce173df9a5d4028c96bd` | `openWaitingUser()` แปลง Redis read error ทุกแบบเป็น unavailable; การสร้าง stream/group อยู่ใน `append()` ซึ่ง turn นี้ไปไม่ถึง |
| ทดสอบจำลอง Redis ปัจจุบัน | `FakeRedis.xpending()` คืนรายการว่างเมื่อไม่มี group แทนการโยน NOGROUP จึงไม่เปิดเผยบั๊กแชตแรก |
| Production API runtime readback 2026-09-17 | task ที่รันอยู่ใช้ source `fc2838c4cb691033f41595c0d43587f10377d33c`, ledger enabled, serving mode live |
| Exact Production source | Redis read error ใน `openWaitingUser()` ยังคืน `[]`; durable marker read failure จึงเป็นอีกเส้นทางหนึ่ง ห้ามนำ causal chain ของ UAT ไปสรุป Production |
| Production log 2026-09-17 19:00–19:20 เวลาไทย อ่านครบพร้อมตรวจหน้าถัดไป | เมนู greeting ส่งสำเร็จ 19:06:26; free-text casual turn รับ 19:10:05 และ LINE รับคำตอบสำเร็จ 19:10:18 แม้มี NOGROUP warning ระหว่างทาง; ยังจับคู่ไม่ได้ว่าเป็นผู้รายงานในภาพ |
| Production log หลัง owner ระบุเวลาเกาหลี 18:00–22:00 | อ่านได้ถึง 21:30:29 KST ณ เวลาตรวจ; 20:29 มี text สองครั้งถูกบล็อกด้วย `ai_budget_exceeded`, company override 8,000 สตางค์ และยอดใช้ 8,062 สตางค์; เมนูทักทาย/โปรโมชั่นช่วง 20:28–20:29 ส่งสำเร็จ |
| ปุ่มคุยกับน้องมั่งมี | เป็น public deterministic greeting/resume ก่อนเส้นทาง AI; คำทักทายสำเร็จไม่พิสูจน์ว่า free-text turn หรือ model สำเร็จ |

NOGROUP เพียงอย่างเดียวแยกไม่ได้ว่า stream ไม่มีหรือ consumer group หาย และไม่พิสูจน์ว่าเกิดจาก TTL, ไม่เคยสร้าง, หรือการลบภายนอก จึงห้ามเดาสาเหตุการหายจาก error string อย่างเดียว

ภาพที่แนบเป็นหลักฐานอาการ ไม่ใช่คำสั่งให้เปิดทดลองใช้ฟรี เปลี่ยนแพ็กเกจ ติดต่อบุคคลในภาพ หรือกดปุ่มใดใน Production

Owner ระบุภายหลังว่าให้เทียบเวลาเกาหลี การตรวจช่วงใหม่พบลำดับเมนูเวลา 20:28 และ budget refusal เวลา 20:29 ที่ตรงกับอาการ ส่วน free-text ที่สำเร็จเวลา 21:10 KST เป็นอีกบริษัท จึงไม่ใช่หลักฐานว่า budget ของบริษัทที่ถูกบล็อกกลับมาใช้ได้แล้ว ตัวตนบัญชีในภาพยังไม่ได้ยืนยันจากข้อมูลบัญชี

## 3. เอกสารที่มีผลร่วมกัน

- [ADR 0010: Redis Streams ledger](../adr/0010-line-ai-turn-ledger-redis-streams.md): storage, group, ack, TTL และ bounded scan เดิม
- [Capture correction §8](line-ai-capture-correction-spec.md): durable consumption markers, no duplicate mutation และ marker-read fail-closed
- [Conversation reliability](line-ai-conversation-reliability-spec.md): ผู้ใช้ได้รับคำตอบ/คำชี้แจงที่ตรงกับผลจริง และ delivery เป็นส่วนหนึ่งของ terminal outcome
- [Rich menu §6.4](line-rich-menu-v2-spec.md): ไม่ต้องกดปุ่มก่อนคุย; menu greeting ไม่เรียก model
- [Support request](line-support-request-spec-th.md): การพัก AI และ explicit resume เดิม
- [AI metering and monthly budget](ai-usage-metering-and-monthly-budget-spec.md): satang, recorded FX, source ledger, System Admin permissions และ Bangkok month
- [Company OCR governance](company-ocr-governance-spec-th.md): OCR switch/count quota, stable request identity และขอบเขต web/LINE/statement
- [Onboarding/trial receipt fixes — Issue 4](onboarding-trial-receipt-fixes-spec.md): amendment เรื่องคืนสิทธิ์อ่านเมื่อไม่ได้ usable persisted result; มีผลเหนือข้อความนับ failure คงไว้ใน OCR governance รุ่นก่อน
- [Prompt caching](ai-prompt-caching-usage-logging-spec.md): provider usage counters และ cache ที่มีอยู่แล้ว
- [Business document image intake](business-document-image-intake-spec.md): classification, transcription และ pending media
- [Message buffering](line-ai-message-buffering-spec.md): media lane, context ordering และการคุยระหว่างอ่านรูป

เอกสารนี้ขยายงานเดิมเฉพาะข้อ A–E; ข้อห้ามแก้ intake payload ในงาน caching เก่าไม่ครอบคลุมงาน C ครั้งนี้ นโยบาย bounded overshoot ของ monthly budget เดิมยังอธิบายโหมด `SHARED` เดิม แต่ถูกแทนด้วย reservation ในโหมด `SPLIT` ตาม §12 ไม่เปลี่ยน OCR count/refund, paid receipt grants หรือ package entitlement โดยอาศัย spec นี้

สำหรับ clarification read boundary เอกสารนี้กำหนดความต่างระหว่าง **ยืนยันว่าไม่มี ledger ปัจจุบัน** กับ **อ่าน ledger ไม่ได้** ข้อความ fail-open แบบกว้างใน ADR เก่าไม่ใช่เหตุให้ละเว้น marker/Redis failure แล้ว dispatch mutation ต่อ ส่วน append/ack best-effort ที่ไม่ได้อยู่ใน read boundary นี้ไม่ถูกขยายขอบเขตในงานนี้

## 4. พฤติกรรมที่ต้องได้

| สถานะ | พฤติกรรม |
| --- | --- |
| ledger ถูกปิดอย่างชัดเจนด้วย config | รักษาพฤติกรรม disabled เดิม ไม่สร้าง Redis client/group เพิ่ม |
| stream และ group ปกติ แต่ไม่มี pending | คืน clarification ว่างและไปตามเส้นทางปกติ |
| Redis ตอบ NOGROUP และตรวจยืนยัน exact stream key ไม่มีอยู่ | ถือว่าไม่มี clarification ใน ledger ปัจจุบัน; ไปตามเส้นทางปกติ การ append ภายหลังสร้าง stream/group ตามเดิม |
| Redis ตอบ NOGROUP แต่ exact stream key ยังอยู่ | หยุดด้วย unavailable และบันทึกเหตุ `group_missing`; ไม่สร้าง group ทับหรือ reset pending state อัตโนมัติ |
| ตรวจการมีอยู่ของ key ไม่สำเร็จ, timeout, connection error, WRONGTYPE หรือ error อื่น | หยุดด้วย unavailable; ไม่แปลงเป็น empty context |
| อ่าน pending entries ได้และมีคำถามของผู้ถาม | รักษาการกรอง user/company/chat, อายุคำถาม, source provenance และ durable consumption marker ตามเดิม |
| durable marker lookup ล้มเหลว | หยุดก่อน routing/capture/correction; ห้าม mutation |

ใช้ key จาก company/chat ที่ server resolve และตรวจสิทธิ์แล้ว ห้ามใช้ key จากข้อความผู้ใช้ หรืออ่านหลาย tenant เพื่อหาทางผ่าน

### 4.1 แชตใหม่และคิวหมดอายุ

ผู้ใช้ที่มีสิทธิ์พิมพ์ “ว่าไง” ได้ทันทีโดยไม่ต้องกดเมนู เมื่อยืนยันว่า stream ไม่มี ให้ผ่านเข้าสู่ casual routing และตอบตามปกติ ไม่ต้องแจ้งเตือนเรื่อง Redis หรือสร้างขั้นตอนให้ผู้ใช้เริ่มระบบเอง

การไม่มี Redis ledger ไม่ล้าง `AiTurn`, pending media, intake workflow, draft, support pause หรือข้อมูลธุรกิจอื่นที่มีแหล่งเก็บของตัวเอง และไม่ยกเว้นการตรวจ source-state/permission เดิม การตอบเพียงตัวเลขหลังบริบทหมดอายุไม่ใช่สิทธิ์สร้าง/แก้รายการ ต้องผ่านหลักฐานและ clarification ตาม intake contract เดิม

TTL และ clarification window คงเดิม งานนี้ไม่ยืดอายุ key ด้วยการอ่าน และไม่ออกแบบการกู้ประวัติที่หมด retention ไปแล้ว

### 4.2 Stream มีอยู่แต่ group หาย

ถือว่า operational state ไม่สมบูรณ์ คง unavailable และส่งเหตุที่แยกแยะได้ให้ผู้ดูแล ไม่ใช้ `XGROUP CREATE ... 0` เพื่อ replay ทุกข้อความ หรือ `$` เพื่อข้ามข้อความเก่าอัตโนมัติ เพราะไม่สามารถอนุมาน pending/acked state ที่หายไปได้

การซ่อม state จริงต้องตรวจ stream, durable outcome/consumption markers และ delivery ก่อน ภายใต้การอนุญาตงาน recovery แยกต่างหาก ไม่มี blanket flush, delete, reset หรือ replay live messages ในการแก้ครั้งนี้

### 4.3 Race และ error boundary

แนวทางขั้นต่ำที่ยอมรับได้: เรียก `XPENDING` ตามเดิม จับเฉพาะ error code/prefix `NOGROUP` แล้วอ่าน `EXISTS` ของ exact key ถ้าได้ 0 จึงคืน empty; ถ้าได้ 1 หรือ read ล้มเหลวให้ fail-closed

- ไม่เช็ค `EXISTS` ล่วงหน้าแล้วสมมติว่า `XPENDING` ภายหลังไม่มีทางเจอ key expiry
- กรณี key/group ถูกสร้างระหว่างสองคำสั่ง ยอมให้ turn นี้ unavailable อย่างปลอดภัย ไม่ reset/retry แบบไม่จำกัด
- `EXISTS=0` เป็นการยืนยัน ณ เวลาอ่าน ไม่ใช่ข้ออ้างว่าตรวจไม่พบข้อมูลสูญหายทุกกรณี
- คง per-chat serialization, webhook dedup, append/ack และ delivery outcome เดิม
- ขอบเขต catch ต้องแคบ: error จาก marker DB หรือการ parse/อ่าน entry ห้ามตกเข้า NOGROUP exemption

### 4.4 Adjacent read/reclaim boundaries จาก impact review

`openWaitingUser` ปัจจุบันอ่าน XPENDING เพียง 50 รายการแรกของ chat และค่อยกรอง user จึงห้ามตีความว่าหมด 50 แล้วไม่พบคำถามของผู้ถาม = ยืนยันว่าไม่มีคำถาม เพิ่ม bounded pagination ตาม stream ID จนจบหรือได้ context limit เดิม; ถ้าใช้ scan budget จนหมดโดยยังพิสูจน์ absence ไม่ได้ ให้ explicit unavailable/incomplete แทน empty ที่ชวนเริ่มรายการใหม่ ไม่สแกนไม่จำกัดหรือข้าม tenant/user

ตรวจ array/entry shape ที่ใช้เป็น absence proof; protocol/malformed response ไม่ใช่ empty pending และ durable intake state ยังคงเป็นเจ้าของการต่อข้อมูลทางการเงิน Redis key ที่ถูกลบหรือ MAXLEN trim ระหว่าง XPENDING/XRANGE ไม่อนุญาตให้เดาข้อมูลที่หายขึ้นใหม่

Reclaim loop ต้อง isolate known missing/expired stream ต่อ key: key A ที่ NOGROUP ไม่ทำให้ key B ทั้ง batch ไม่ถูกประมวลผล แต่ไม่ recreate group/reset/replay key A หาก stream ยังอยู่ และไม่วน retry Redis outage ทั้ง batchแบบไม่จำกัด บันทึก existing-group corruption ต่างจาก normal expiry ขอบเขตนี้ไม่เปลี่ยน append/ack จาก best effort เป็น financial authority

## 5. สถาปัตยกรรมและผลกระทบ

- งาน A อยู่ที่ `apps/api` / `LineAiLedgerService`; งาน B อยู่ที่ API adapters/dispatcher และ frontend error states; งาน C อยู่ที่ gateway router/prompt; งาน D–E ใช้ contracts, API metering/admin และ web ที่มีอยู่
- AI Gateway ยังคงใช้ permission-checked APIs/tools และไม่อ่าน Redis/DB โดยตรง API เป็นเจ้าของ company, budget classification, reservation, usage ledger และ audit
- งาน A ไม่ต้อง migration; งาน D–E ต้อง additive metadata/config/reservation migration ตาม §11–12 ไม่ทำลายยอดเดิม
- ไม่เพิ่ม dependency หรือแก้ `package.json` เพื่อเพิ่ม scripts/metadata จากงานนี้
- ไม่เปลี่ยนสิทธิ์, package entitlement, final-mutation boundary, receipt approval หรือราคาที่เรียกเก็บลูกค้า; DTO เพิ่มแบบ compatible และ error branches เพิ่มตาม §9
- การอ่านข้อความโดยตรงและข้อความหลังเปิด keyboard ใช้ pipeline เดียวกัน; ปุ่ม greeting ไม่กลายเป็น health check หรือสวิตช์เปิด AI

## 6. Observability และ privacy

- ยืนยัน stream absent เป็น normal lifecycle outcome ไม่ใช่ warning ว่าระบบล่ม
- Group missing, Redis unavailable และ marker unavailable ต้องแยกเหตุภายในได้ โดย reuse structured logging เดิม
- ใช้ webhook/request correlation และ hash ของ chat เท่าที่จำเป็น ห้ามพิมพ์ raw Redis key ที่มี LINE user/group ID หรือ full provider error ที่ฝัง key ลง log ใหม่
- รักษา delivery truth และไม่บันทึก unavailable ว่า completed; เพิ่ม explicit budget classification ตาม §9 แทนการจัด refusal ที่รู้เหตุเป็น generic failure
- ไม่มีข้อความถึงลูกค้าอัตโนมัติจากการตรวจ log หรือการเตรียม spec

## 7. เกณฑ์ยอมรับ

- [x] AC-01 Redis จริง: chat key ที่ยังไม่มีให้ NOGROUP; service คืน empty และ text turn ไปถึง routing ได้
- [x] AC-02 Redis จริง: key หมด TTL แล้วให้ผลเหมือนแชตใหม่ โดยไม่ restart service หรือกด menu
- [x] AC-03 Existing stream + missing group ยัง unavailable, entries เดิมไม่เปลี่ยน และไม่เกิด group reset/replay
- [x] AC-04 Existing group + empty pending ยังคุยได้ตามเดิม
- [x] AC-05 Waiting clarification ของผู้ถามยังส่งต่อครบ รวม source proof/pending media; อีก user/company/chat ใช้แทนกันไม่ได้
- [x] AC-06 Consumed clarification ถูกกรองแม้ XACK ล้มเหลว; marker lookup ล้มเหลวต้องไม่ dispatch mutation
- [x] AC-07 Redis connection/timeout/WRONGTYPE และการตรวจ EXISTS ที่ล้มเหลว fail-closed
- [x] AC-08 ครอบคลุม key expiry และ concurrent creation ระหว่าง XPENDING กับ absence read; ไม่มี unbounded retry หรือ destructive repair
- [x] AC-09 FakeRedis โยน NOGROUP ตาม Redis จริง; regression test ต้องแดงบนโค้ดที่เป็นต้นเหตุและเขียวหลังแก้
- [ ] AC-10 แชตใหม่และหลัง expiry: พิมพ์ “ว่าไง” โดยตรงได้คำตอบที่ส่งสำเร็จ; เมนู greeting สำเร็จอย่างเดียวไม่นับผ่าน
- [ ] AC-11 Support pause, explicit resume, unlinked, legal acceptance, entitlement/permission denial และ company selection ยังคงผลเดิม
- [ ] AC-12 ข้อความเลขล้วน/คำตอบเก่าหลัง context หมดอายุไม่สร้างหรือแก้ draft จากการเดา; webhook redelivery ไม่เพิ่ม mutation/delivery ซ้ำจาก fix นี้
- [x] AC-13 Logs ใหม่ไม่เปิดเผย raw chat/provider ID หรือ secret; normal absence ไม่ถูกนับเป็น outage
- [ ] AC-14 ผ่าน focused automated checks + Redis จริงที่แยกจาก live data และ UAT real-LINE journey พร้อม terminal/delivery evidence
- [ ] AC-15 Production promotion ใช้ protocol และ exact signed release evidence ตาม runbook; แยกผล incident ในภาพออกจากผล acceptance ของ fix
- [ ] AC-16 Missing-ledger recovery ไม่ bypass monthly AI budget: เมื่อยอดใช้ถึงงบ effective ของบริษัท ต้องยังปฏิเสธ provider call และส่งการ์ดโควตาเต็มตาม contract เดิม; static menu greeting ไม่ reset งบ

ข้อที่ติ๊กแล้วใช้หลักฐานตาม verification matrix ช่วง A คือ fake regression ร่วมกับ isolated real Redis (db index แยก, synthetic tagged keys, ลบเฉพาะ key ของตัวเอง) ไม่ใช่ unit test อย่างเดียวตาม §14; evidence class ต่อข้อและส่วนที่พิสูจน์ด้วย fake เท่านั้นบันทึกไว้ใน [task memory](../agent-memory/uat-line-chat-nogroup-2026-09-17.md) ส่วน AC-10, AC-11, AC-12, AC-14, AC-15 และ AC-16 ยังเปิด เพราะต้องใช้ UAT real-LINE journey, release protocol และผลรวมของช่วงอื่น

## 8. Production investigation ที่ต้องปิดแยก

ผูกข้อความจริงกับวันเวลา/บัญชีที่ผู้รายงานระบุ → webhook receipt → buffer/identity/access/support outcome → intake/gateway → LINE delivery ตาม source/digest ที่รัน ณ เหตุการณ์นั้น

แยกอย่างน้อย: ไม่ได้รับ webhook, event duplicate, support pause, unlinked/company selection, legal/permission/entitlement denial, marker failure, model/provider failure และ delivery failure ห้ามสรุปจากคำทักทายหรือ health GET อย่างเดียว

ไม่เปิด public chatbot ให้คนยังไม่เชื่อมบัญชีโดยปริยาย และไม่ปิด support pause เพื่อทำให้ test ผ่าน ถ้าผลการตรวจต้องเปลี่ยน product policy ให้ถาม owner เฉพาะจุดนั้นก่อนทำ implementation

### 8.1 ผลตรวจหลังระบุ timezone — monthly AI budget

2026-09-17 เวลาเกาหลี 20:28:59 และ 20:29:09 รับข้อความจริงสองรายการ แล้วปฏิเสธ AI ด้วย `AI_MONTHLY_BUDGET_EXCEEDED` / `ai_budget_exceeded` ทั้งคู่ `CompanyAiUsageMeter` บันทึกบริษัทเดียวกันใช้ 80.62 บาท จาก company override 80 บาทต่อเดือน ก่อนอนุญาต provider call การ์ดแจ้งโควตาเต็มผ่าน delivery stage สำเร็จ; คำทักทายจากปุ่มไม่ใช้ model จึงส่งได้

นี่เป็นการบังคับงบตาม [AI metering spec](ai-usage-metering-and-monthly-budget-spec.md) ไม่ใช่เหตุให้รีเซ็ต Redis หรือเพิ่มงบอัตโนมัติ ยอดนี้เป็นต้นทุน AI ที่ meter บันทึก ไม่ใช่จำนวนใบเสร็จหรือยอดเรียกเก็บแพ็กเกจจากลูกค้า การปรับ company override ต้องเป็นงาน admin ที่ได้รับอนุญาตต่างหาก พร้อม audit ตามระบบเดิม การรอเดือนใหม่อิง Asia/Bangkok ตาม metering contract

ช่วงที่ขอ 18:00–22:00 KST = UTC09:00–13:00; ณ เวลาตรวจอ่านได้ครบถึง 21:30:29 KST รวม 16 accepted/16 terminal ไม่อ้างว่าอ่าน log ของช่วงอนาคตแล้ว การจับคู่ตัวบุคคลในภาพยังไม่ยืนยัน แต่เหตุ budget denial และลำดับเวลาเมนูเป็นหลักฐานจริง

พบช่องว่าง observability เพิ่มเติม: `ai_budget_exceeded` ถูก classifier ปัจจุบันจัดเป็น `failed_terminal` แม้เป็น explicit budget refusal และส่งการ์ดสำเร็จ Owner รวมการแก้ classifier นี้ในงาน B §9.3 แล้ว โดยยังแยกเหตุ budget refusal ออกจาก ledger failure และไม่เปลี่ยน live budget จากงานเอกสาร

### 8.2 ผลตรวจต้นทุนและการส่งใบเสร็จหลังงบเต็ม

ตรวจ usage ของบริษัทจากเหตุการณ์ข้างต้นด้วย Production T1 read-only แล้ว ยอดตรงภาพ: 92 calls รวม 80.62 บาท; `line.intake-route` 48 calls รวม 55.67 บาท (ประมาณ 69%) ทั้งหมดใช้ Sonnet 4.6 และต้นทุนรายครั้งตรงสูตรที่ deploy อยู่ ไม่มี failed-provider row ในยอดนี้ รายละเอียดและข้อจำกัดอยู่ใน [หลักฐานต้นทุนและ receipt flow](../agent-memory/line-intake-cost-and-budget-receipt-behavior-2026-09-17.md)

Tag นี้รวมการเลือกเส้นทาง/วางแผนและถอดข้อความจากรูป จึงไม่ใช่ค่า classifier อย่างเดียว prompt/context และ cache write มีผลกับต้นทุน ส่วน OCR ขั้นถัดไป reuse ข้อความที่อ่านแล้วตามโค้ดเดิม ไม่เสนอเพิ่มการ reuse ที่มีอยู่แล้วเป็นวิธีแก้ใหม่

งบ AI เงินต่อเดือนใช้ร่วมกันระหว่างแชตกับ OCR เมื่อเต็ม เว็บยังอัปโหลดไฟล์/กรอกเองได้ตามสิทธิ์เดิม แต่ OCR ถูกปฏิเสธ สำหรับ LINE เส้นทางรูปใหม่สามารถเก็บ pending media เพื่อถามต่อ แต่ยังไม่สร้าง expense อัตโนมัติ ข้อนี้เป็นผล trace source ที่รันจริง ไม่ใช่ผลทดสอบส่งรูปล่าสุดบน Production

พบ defect: catch ใน intake/OCR ทำรหัส `AI_MONTHLY_BUDGET_EXCEEDED` หาย และ fallback ฝั่งรูปแจ้งว่าระบบอ่านเอกสารขัดข้องชั่วคราว งาน B ต้องรักษา typed budget outcome ตลอดทาง แจ้งว่ารับรูปไว้หรือยังตามผล persistence จริง และอธิบายว่า OCR หยุดเพราะงบเต็มโดยไม่สื่อว่าบันทึกค่าใช้จ่ายเสร็จแล้ว ต้องไม่ bypass cap, ไม่เรียก provider ต่อ, ไม่ลบ attachment และไม่สัญญา retry อัตโนมัติที่ยังไม่มี

Owner รวม defect นี้, cost/reporting และ separate caps เข้า scope เดียวกับ NOGROUP แล้วตาม §1; ยังไม่มีการเปลี่ยน application หรือ live policy ส่วนการเปลี่ยนรุ่นโมเดลไม่ใช่ข้อกำหนดของงานลดต้นทุนนี้

## 9. Budget refusal และการส่งใบเสร็จ

### 9.1 Typed outcome ที่ต้องส่งถึงปลายทาง

Reuse error/result envelopes เดิม เพิ่ม optional `budgetScope: 'TOTAL' | 'CHAT' | 'OCR'` จาก API ที่ตรวจเงินจริง ไม่อนุมานจากข้อความ error ของ provider หรือข้อความผู้ใช้

| เหตุ | การจัดการ |
| --- | --- |
| `AI_MONTHLY_BUDGET_EXCEEDED` | งบรวมถึงเพดาน หรือ bucket ถึงเพดาน; คง code เดิมและระบุ scope ตามจริง |
| `AI_BUDGET_INSUFFICIENT` (ใหม่สำหรับ §12) | ยังมียอดคงเหลือ แต่ไม่พอจองต้นทุนสูงสุดของงานนี้; ห้ามบอกว่ายอดใช้เต็มแล้ว |
| `AI_BUDGET_BUSY` | งานอื่นกำลังใช้ admission; retry ได้เฉพาะขอบเขตเวลาเดิม ไม่แปลงเป็นหมดโควตา |
| `AI_BUDGET_UNAVAILABLE` | ตรวจงบ/ราคา/reservation ไม่ได้; หยุด AI และแจ้งว่ายังตรวจสอบไม่ได้ ไม่อ้างว่างบเต็ม |
| OCR disabled/count quota/paid receipt quota | คง stable reason และ contract เดิม แยกจากงบเงิน |
| timeout/provider/parser/delivery failure | รักษาชนิดจริง ไม่ย้ายไป budget refusal หรือบันทึกว่าสำเร็จ |

`tryRouteIntake`, `tryExtractReceiptFields`, `AiGatewayClient`, web OCR client และ error classifier ต้องส่ง known budget result โดยไม่ยุบเป็น `ROUTER_UNREACHABLE`, `OCR_FAILED` ที่ไม่มี code หรือ `RATE_LIMITED` อย่างเดียว ถ้า intake ปฏิเสธเพราะงบแล้ว ห้ามลอง OCR/provider อื่นเพื่อหวังผ่าน gate เดิมอีก แต่ยังทำขั้นตอนเก็บไฟล์ที่ไม่ใช้ AI ได้ตามสิทธิ์

อนุญาตให้ catch เฉพาะ error ที่ trust boundary ตรวจรูปแบบและที่มาแล้ว; HTTP/provider error ที่คล้ายชื่อไม่ใช่สิทธิ์แก้ยอด, refund หรือ bypass สิทธิ์

Code/scope ต้องอยู่ใน durable result ด้วย ได้แก่ saved web extraction summary, LINE outcome/pending clarification และ async job result ที่ใช้ recovery การส่งคำตอบเดิมซ้ำใช้เหตุของ attempt เดิม ไม่สร้างคำตอบใหม่จากงบล่าสุดจนสื่อว่า attempt เก่าสำเร็จ และไม่เก็บตัวเลขงบภายในลง tenant-visible DTO

### 9.2 Journey เมื่อ AI ใช้ไม่ได้

- **Web:** upload/attachment/draft และ manual edit คงเดิม หลัง upload สำเร็จแสดงไฟล์และสถานะ “ยังไม่ได้อ่านด้วย AI” พร้อมเหตุและทางกรอกเอง; ไม่ลบไฟล์หรือ clear ข้อมูลที่กรอกแล้วเพราะ OCR refusal ปุ่ม OCR ไม่หมุนค้างและไม่ retry budget denial อัตโนมัติ
- **LINE รูปใหม่:** ตรวจสิทธิ์และ persist pending media ก่อนอ้างว่าเก็บรูปแล้ว หาก persistence สำเร็จตอบ เช่น “รับรูปไว้แล้วค่ะ แต่งบ AI สำหรับอ่านเอกสารเดือนนี้เต็มแล้ว ยังไม่ได้บันทึกรายการค่าใช้จ่าย” และใช้ทางเข้าเว็บ/clarification ที่ระบบมีจริง ไม่สร้างลิงก์ไป expense ที่ยังไม่มี
- ถ้างบไม่พอจองแต่ยังไม่เต็ม เปลี่ยนเป็น “งบ AI ที่เหลือไม่พอเริ่มอ่านรูปนี้” ไม่แสดงว่ายอดใช้เป็นศูนย์หรือครบ 100% โดยไม่มีหลักฐาน
- ถ้าเก็บไฟล์ไม่สำเร็จ ให้แจ้งว่ายังเก็บรูปไม่สำเร็จ; ห้ามยืนยันการเก็บจากการรับ webhook อย่างเดียว ผู้ไม่มีสิทธิ์ capture ยังใช้ denied flow เดิม
- **LINE ข้อความ:** scope CHAT เต็มให้บอกส่วนแชต; scope TOTAL เต็มให้บอกงบ AI รวม การบอกว่า “ยังส่งใบเสร็จให้อ่านได้” ต้องมี saved split policy และผล OCR eligibility ปัจจุบันรองรับ ไม่รับประกันข้าม OCR switch/count/plan/file gates
- เมนู deterministic และการเปิดเอกสารเดิมยังทำงานตามสิทธิ์ ไม่ใช้ model เขียนข้อความแจ้งงบ และไม่บังคับกดเมนูก่อนพิมพ์
- การมี pending media ไม่ถือว่า expense สร้างแล้ว ไม่ยืด retention และไม่สร้าง auto-resume/auto-retry หลังเพิ่มงบหรือขึ้นเดือนใหม่ งานซ้ำใช้ existing webhook/attachment/OCR identity และ source-state checks
- ห้ามเปิดเผยยอดเงิน/config ของบริษัทใน customer reply เพราะหน้าต้นทุนยังเป็น System Admin only; ใช้เหตุและทางดำเนินการต่อเท่าที่ผู้ใช้มีสิทธิ์

### 9.3 Terminal และ telemetry

เพิ่ม `budget_refusal` ใน terminal class สำหรับ known exceeded/insufficient เมื่อ reply ผ่าน delivery แล้ว เก็บ `budgetScope`, error code และ media persistence state เป็น structured fields หากเก็บรูปไว้รอคำตอบให้รักษา clarification state โดยแนบ budget reason ไม่บังคับเปลี่ยน workflow เป็น completed

Delivery pending/failure ยังมาก่อน semantic result; refusal ที่ส่งไม่สำเร็จห้ามนับเป็น delivered หรือซ่อน alarm ปรับ classifier/contract/metrics consumers พร้อมกัน; `support_follow_up` ที่ตั้งใจพักให้ explicit `intentional_noop` ตาม support state เดิม Unknown statuses ยังเป็น `failed_terminal` ไม่เพิ่ม catch-all ที่ปิดบังข้อผิดพลาด

### 9.4 Worker และผู้ใช้ error นอก live LINE

- `DrainLineLedgerUseCase`: เมื่อ known exceeded/insufficient ไม่เข้า generic catch/reclaim จนชน delivery cap ให้จบ durable refusal ด้วย delivery owner เดิม หากยังอยู่ใน reply window ส่ง deterministic notice ตามสิทธิ์; stale sub-request ไม่สร้าง unsolicited notice และไม่ฟื้นขึ้นเองหลังเติมเงิน/เดือนใหม่
- Busy/unavailable เป็น hold/retry ตาม existing bounded deadline และเก็บเหตุเดิม ไม่เปลี่ยนเป็นหมดงบหรือทำให้เงินจอง/การส่งซ้ำกลายเป็น execution ใหม่ กรณี original outcome มีเจ้าของ delivery แล้ว drain ต้องไม่ claim model execution ใหม่
- Receipt web, statement import และ CRM ที่ใช้ HTTP 429 รวมถึง draft-generation ที่ใช้ result union ต้องรองรับ scope/insufficient แยกกัน และไม่ retry permanent refusal ใน worker/provider retry loop
- ยืนยัน bank statement source/import state และ draft job status ยัง recover ได้ตามผลจริง; ปฏิเสธงบไม่ลบ uploaded source หรือ undo ERP result ที่ commit ไปแล้ว การส่งต่อหลังเพิ่มงบต้องเป็น action ใหม่ที่ผู้ใช้สั่งตาม workflow เดิม

## 10. ลดต้นทุน intake โดยรักษาคุณภาพ

### 10.1 Baseline และการวัด

Baseline Production ใน §8.2 เป็นหลักฐานก่อนงาน: intake 48 calls/55.67 บาท; input 129,913, output 36,628, cache read 391,280, cache write 168,877 tokens; 15 cache writes และ 33 cache reads Cost components โดยประมาณ input 12.84, output 18.09, cache read 3.87, cache write 20.86 บาท (ต่าง 0.01 บาทจากการปัดรายครั้ง)

ใช้ corpus ที่ไม่มีข้อมูลลูกค้าจริง ครอบคลุม text greeting, business query, capture/correction, pending clarification, denied capability, ภาพใบเสร็จสั้น/ยาว/หลายรายการ/อ่านยาก และภาพที่ไม่ใช่ใบเสร็จ วัดต่อ **successful user task** รวม intake, plan, OCR, compose, retry/fallback ไม่ใช้ค่า intake tag ที่ลดเพราะย้ายไปอีก tag เป็นหลักฐานว่าประหยัด

รายงานก่อน/หลังแยกข้อความและรูป, cold/warm cache, model/config, call counts, token components, latency และ routing/field accuracy ใช้ราคา/FX เดียวกันในการเปรียบเทียบ test; usage ledger จริงยังใช้ราคาที่ตรึงตามแต่ละ action

ก่อน optimize ให้ freeze corpus manifest, expected route/fields/permissions, baseline revision และจำนวน repetitions เดียวกัน ห้ามตัด failed cases ออกจากตัวหารเพื่อให้ค่าเฉลี่ยดีขึ้น รายงาน completion/refusal/parse/truncation rates และต้นทุนรวมต่อ attempted task ควบคู่ successful task; reservation-insufficient ถือว่า task ไม่สำเร็จในการวัด ไม่ใช่ free saving ต้องผ่านกรณี invalid/forged prepared plan ด้วย ไม่แค่ valid reuse

### 10.2 ขอบเขต implementation

1. ทำ prompt/catalog ให้เฉพาะ capabilities ที่ server เปิดและต้องใช้จริง โดยใช้ builder/registry เดิม; capability gating มีอยู่แล้ว ต้องพิสูจน์ส่วนซ้ำ/ไม่จำเป็นก่อนตัดเพิ่ม
2. จำกัด context ตาม existing intake provenance/recency bounds และลบข้อมูลซ้ำที่ผลเหมือนเดิม ห้ามตัด permission, active clarification, source reference หรือ correction proof เพื่อประหยัด token และห้ามใช้ keyword classifier ใหม่แทน semantic routing โดยไม่มี coverage
3. รักษา byte-stable cache prefix; dynamic user/company data ไม่ทำให้ส่วน stable เปลี่ยนโดยไม่จำเป็น ไม่ hard-code ว่า cache hit ทุกครั้ง หรือเพิ่ม TTL/เปลี่ยน provider setting โดยไม่วัด
4. ปรับ output ตามงานโดยยังได้ JSON contract และข้อความเอกสารครบพอสำหรับ extraction; เพดาน image 8,000 tokens ปัจจุบันเป็น maximum ไม่ใช่ค่าใช้จ่ายคงที่ ห้ามลดจนบิลยาวถูกตัด/ตัวเลขสูญหายแล้ว retry จนแพงกว่าเดิม
5. รักษาการ reuse `documentText` และ prepared plan ที่ validate แล้ว; ถ้ามีเส้นทางอ่านรูป/วางแผนซ้ำที่ไม่จำเป็นจริง ให้กำจัดพร้อม regression test ไม่อ้างว่า reuse ที่มีอยู่แล้วเป็น optimization ใหม่
6. คง model policy ที่ admin เลือก ไม่มี auto-switch ไปโมเดลถูกกว่า ไม่เปลี่ยนคุณภาพ/ราคาแฝง และไม่เพิ่ม provider call เพื่อจำแนก budget bucket

ผ่านงาน C เมื่อ total cost ต่อ successful task ลดลงบน corpus เดียวกัน, ทั้ง text/image ไม่แพงขึ้นโดยไม่มีเหตุที่ยอมรับ, critical routing/permission/correction tests ผ่านครบ และ OCR field accuracy ไม่ถดถอย ต้องแนบตัวเลขจริงก่อน/หลัง; ยังไม่รับประกันเปอร์เซ็นต์ประหยัดจากการตรวจ 48 rows นี้

## 11. หน้า AI Budget และ usage contract

### 11.1 ข้อมูลที่ต้องเห็น

System Admin เปิดหน้าบริษัทเดิมแล้วเห็นเดือน Asia/Bangkok, total cost, provider calls, ค่าเฉลี่ยบาทต่อ provider call, ordinary input/output และ cache read/write tokens มีคำอธิบายว่า calls ไม่เท่ากับจำนวนใบเสร็จ และ intake อาจรวมการอ่านรูป

- แยก `TEXT`, `IMAGE`, `OTHER`, `UNKNOWN` จาก request metadata ที่ server รู้ก่อนเรียก AI; ข้อมูลย้อนหลังที่ไม่มี metadata ต้องแสดง “ไม่ทราบประเภท” ไม่เดาจาก OCR peer หรือชื่อ tag
- แยกแถว budget `CHAT` (“แชตและ AI ทั่วไป”) กับ `OCR` (“AI อ่านเอกสาร”) ตาม §12; `UNKNOWN` ในรายงานไม่ถูกอ้างว่าเป็นแชต/ใบเสร็จทั้งหมด
- แสดงค่าใช้จ่าย, calls, ค่าเฉลี่ย, token components และต้นทุน cache เมื่อมีหลักฐานราคาที่บันทึกไว้ เลือกดู tag เดิมต่อได้ ไม่เปลี่ยนชื่อย้อนหลังหรือลบ `line.intake-route`
- Top tags ที่จำกัด 10 แถวต้องมี “อื่น ๆ”/ยอดที่เหลือ เพื่อ reconcile กับ total ได้ ไม่ทำให้ผู้ใช้คิดว่า top 10 คือทั้งหมด
- แสดง spent, reserved และ available แยกกันใน SPLIT; เงินที่จองยังไม่ใช่ spent และยังไม่เพิ่ม provider call count
- OCR reads, uploaded receipt documents, package grants และเงิน AI เป็นคนละ metric ตาม governance เดิม; pending media ไม่รวม uploaded expense receipt count

### 11.2 Additive data/DTO

ขยาย `AiUsageEvent` ด้วย nullable `requestKind`, `budgetBucket`, `pricingSnapshot`/component costs และ execution identity สำหรับ idempotent settlement; API เป็นผู้ระบุ bucket/request kind จาก trusted seam ส่วน actual provider counters ยังมาจาก gateway จำนวน bytes/prompt content ไม่ถูกเก็บใน metadata นี้

เพิ่ม `usageBasis` (`PROVIDER_REPORTED` / `CONSERVATIVE_ESTIMATE`; null = legacy unknown) ตลอด gateway → API → ledger → report เพราะ `usageEstimated` ปัจจุบันอยู่ใน log แต่หายจาก `AiUsageEntry` ค่า timeout estimate ห้ามแสดงเป็น measured provider tokens ส่วน unresolved execution แสดงใน reservation ไม่สร้าง usage 0 เพื่อปิดงาน

Reconciliation ใช้ append-only correction ใน ledger เดิม: `eventKind=MODEL_CALL` (default สำหรับ rows เดิม) หรือ `COST_ADJUSTMENT` ที่ผูก original invocation/settlement revision และมี unique correction identity Adjustment เก็บ delta ของ cost/components/counters ตามหลักฐานที่เปลี่ยน ไม่เป็น provider call ใหม่ Aggregate รวม delta แต่ callCount นับเฉพาะ MODEL_CALL; topTags/averages ใช้กติกาเดียวกัน ไม่ใช้ `_count._all` นับ adjustment เป็น calls ผลรวม cost/counters ห้ามติดลบ และ public APIs ส่ง adjustment ตามใจไม่ได้

สำหรับ rows ใหม่ บันทึก component costs จาก unit rates/FX ที่ใช้คิดเงินจริง ณ action เดียวกัน และ rounding adjustment เพื่อให้ sum components = `costSatang` พอดี; ไม่คำนวณประวัติใหม่ด้วยราคาปัจจุบัน Rows เดิมที่ไม่มี pricing snapshot ให้ cache token counts ได้ แต่ cost components เป็น unavailable ไม่ใช่ 0

ขยาย `PartnerAiUsageDto` / `GET /v1/system/partners/:partnerCompanyId/ai-usage` แบบ additive: policy/version, totals/reserved/available per bucket, request-kind breakdown, enriched topTags, otherTags totals และ metadata coverage (`complete`/`partial` พร้อมช่วงเริ่มเก็บ) ค่าเงินบน wire ใช้ integer satang, ค่าเฉลี่ยคำนวณแสดงผลจาก cost/calls เมื่อ calls=0 แสดง “—”

Read permission คง `system.partner_dashboard.read`; config write ใช้ `system.partner_ai_model.manage` และ existing protected admin adjustment flow ห้ามเพิ่ม tenant endpoint สำหรับอ่าน usage/budget ใช้ RepeatableRead snapshot เดียวสำหรับ total/breakdowns/OCR/reservations/config โดยไม่ส่ง raw request IDs หรือข้อมูลเอกสารออกหน้า admin

### 11.3 UI states และ migration

รักษา loading/error/retry/read-only, saved-versus-draft state, request cancellation เมื่อเปลี่ยนบริษัท, stale version conflict และ audit history แสดงค่า default/override ของ total กับค่า split ของบริษัทชัดเจน ปุ่มบันทึก disabled ระหว่างโหลด/บันทึก และยอดบนหน้าต้องไม่เปลี่ยนตาม draft ที่ยังไม่ save

Migration เป็น additive nullable columns/defaults ที่รองรับ old reader/writer; ไม่มี backfill ที่เดาประเภท intake หรือ rewrite cost เดิม Dashboard ระบุ partial coverage ของเดือน rollout ชัดเจน API response และ chart aggregates ต้องไม่ double count และ unknown ต้องรวมใน total เสมอ

### 11.4 Readiness และ admin surfaces ที่ได้รับผลกระทบ

ใช้ effective budget projection เดียวกับ admission ใน partner support timeline, receipt-grant preview, paid-plan adjustment warnings และ signup/ops budget observations ที่เกี่ยวข้อง ไม่อ่านเฉพาะ `monthlyBudgetSatang`/total spend แล้วอ้างว่า OCR พร้อมเสมอเมื่อ total ยังเหลือ

- Readiness ต้องแยก CHAT/OCR/TOTAL exhausted, funds reserved/insufficient สำหรับงานที่ทราบ bound และ config unavailable; readiness ทั่วไปที่ยังไม่รู้ bound บอกได้เพียง “ยังมีงบ” ไม่รับประกันว่ารูปถัดไปเริ่มได้
- การเพิ่มจำนวนใบเสร็จ/ต่อแพ็กเกจไม่เพิ่ม AI money budget และไม่แก้ OCR cap โดยปริยาย warning ใช้สิทธิ์เดิม ไม่มีการเพิ่ม budget approval เข้า financial receipt-grant command
- Preserve system-admin auth, locked-company state, per-field saved/draft/conflict, current password/approval rules ของแต่ละ surface เดิม และ audit-history allowlist ของ mode/caps/pending changes; ไม่ส่ง internal spend ผ่านหน้า owner ที่เดิมเห็นเฉพาะ warning
- Signup provisioning/retry ที่ตั้ง trial total และ OCR-config writers ต้องรักษา active/pending split policy, version และ lock ตาม §12.7 ไม่ใช้ default/upsert ล้างค่าที่ Admin ตั้งไว้แล้ว

## 12. แยกเพดานแชตและ OCR ตาม owner decision

### 12.1 กติกาและการตั้งค่า

ให้ `T` = effective monthly total เดิม (override หรือ platform default), `C` = chat/general cap, `O` = OCR cap หน่วย satang และเดือน Asia/Bangkok เดียวกัน

- โหมดใหม่ `SPLIT`: `C >= 0`, `O >= 0`, `C + O <= T`; `0` หมายถึงไม่อนุญาต AI ของ bucket นั้น ไม่มีการยืมหรือโอนยอดเหลือระหว่าง bucket ส่วนที่ไม่จัดสรรไม่เปิดให้ใช้เอง
- Total gate ยังอยู่ทุก seam; CHAT เต็มและ OCR เหลือจึงอ่านเอกสารต่อได้ แต่ OCR เต็มไม่ตัดสิทธิ์ CHAT ที่ยังเหลือ และ TOTAL เต็มหยุดทั้งสองส่วน
- ไม่กำหนดตัวเลข/สัดส่วนให้บริษัทใดจากภาพ 80 บาท ตัวอย่างหน่วยบาทสำหรับ test เท่านั้น: `T=100`, `C=30`, `O=70`; CHAT ใช้ครบ 30 แล้ว OCR ยังเริ่มงานที่จองได้ภายในส่วน 70 ได้
- บริษัทเดิมคง `SHARED` จนผู้ดูแลตั้ง split ทั้งสองค่าและวันมีผลอย่างชัดเจน `null` ใน cap ของ SHARED หมายถึงยังไม่ตั้ง ไม่ใช่ unlimited; UI เสนอ SPLIT สำหรับการตั้งค่าใหม่ แต่ไม่ save/activate เอง
- OCR bucket ครอบคลุม AI อ่านเอกสารตาม existing OCR governance ทั้งใบเสร็จและ statement; OCR count quota, OCR disabled, paid receipt grants และ permission ยังบังคับแยกตามเดิม การมีเงินไม่ใช่สิทธิ์ผ่าน gate เหล่านั้น

### 12.2 Server-derived classification

| Action | Bucket |
| --- | --- |
| LINE text intake, business/advisor/plan/compose/tool loop, CRM AI, draft generation และ AI ที่ไม่ใช่อ่านเอกสาร | CHAT |
| LINE JPEG/PNG ที่เข้า governed image-intake reader, แม้ผลภายหลังไม่ใช่ใบเสร็จ | OCR |
| Receipt read/extract/re-read บนเว็บหรือ LINE, statement AI extraction | OCR |
| deterministic menu, upload-only, manual entry, parser ที่ไม่เรียก AI | ไม่สร้าง spend event/reservation |

รูปพร้อม caption ที่ intake ทำ route และ transcription ใน provider call เดียว ให้ทั้ง call เป็น OCR เพราะแยกต้นทุนย่อยจริงไม่ได้ แต่ AI แชต/ERP reasoning ถัดไปต้อง admit เป็น CHAT ใหม่; การแนบรูปไม่ใช่สิทธิ์ให้งานแชตทั้งหมดใช้ OCR budget

ทุก API caller กำหนด bucket ก่อน provider, รวมทาง retry/fallback; gateway/client/user text ห้าม override bucket ไม่ใช้ `usageTag.startsWith('ocr')` เพียงอย่างเดียว เพราะ intake image ใช้ tag `line.intake-route` และห้ามใช้ผลจำแนกจาก model เพื่ออนุมัติงบย้อนหลัง Unknown ใช้รายงานประวัติได้ แต่ action ใหม่ใน SPLIT ที่ยังไม่มี trusted bucket ต้อง unavailable ก่อนเรียก provider

### 12.3 Hard cap และ concurrent admission

โค้ดปัจจุบันตรวจ actual spend ก่อนเริ่มแล้วบันทึกหลังจบ จึงอาจเกินเพดาน; checkout ยังมี chat/media lease แยกกัน ห้ามนำการเช็ค aggregate อย่างเดียวมาอ้างว่า SPLIT ใช้ไม่เกินงบตาม owner decision

ใน SPLIT ต้อง **reserve ก่อนเริ่ม provider invocation แต่ละ step** ภายใต้ API-owned transaction/lock ที่ครอบคลุม company + pinned Bangkok month + total/bucket balances Logical request ที่มีหลาย calls ไม่จอง worst case ของทั้ง chain ซ้ำอีกก้อน:

```text
admit iff spentTotal + reservedTotal + upperBound <= T
      and spentBucket + reservedBucket + upperBound <= bucketCap
```

- `upperBound` ของ step ต้องครอบคลุม max input/image/cache-write/output, SDK attempts ที่อนุญาตใน step และ timeout accounting ของระบบ โดยตรึง pricing/FX/model ไว้กับ reservation; ห้ามใช้ราคาเฉลี่ยหรือสมมติ cache hit เป็นวงเงินจอง ทุก provider ใน chain ต้องใช้ gate นี้ ไม่มี implicit allowance สำหรับ step ถัดไป
- การปัด satang เกิด **ต่อ provider invocation**: upper bound ของหลาย calls ต้องรวมเพดานที่ปัดขึ้นราย call ไม่ round เพียงครั้งเดียวหลังรวม เพราะหลาย fractional satang อาจทำให้ actual ที่รวมรายครั้งเกินเงินจอง
- Reuse input/call/output bounds และ model policy ที่มีอยู่ กำหนด bounded execution envelope ระหว่าง API กับ gateway ให้ตรวจตรงกัน Gateway ห้ามเรียกเกิน envelope หรือใช้ approved model อื่นที่วงเงินไม่ครอบคลุม ถ้าคำนวณ/พิสูจน์ upper bound ไม่ได้ให้ `AI_BUDGET_UNAVAILABLE` และยังไม่เปิด SPLIT สำหรับ seam นั้น
- ไม่ใช้ cached spend หรือ process-local mutex เป็นตัวรับรองเพดาน ถ้าระบบปัจจุบันมีส่วนที่คิด input ceiling แบบ conservative เช่น timeout 200,000 tokens ต้องครอบคลุมในการจอง หรือแก้ accounting ให้มี bound ที่พิสูจน์ได้ก่อน ห้ามลดค่า timeout เป็น 0 เพื่อให้ gate ผ่าน
- ถือ DB lock เฉพาะช่วง reserve/settle ไม่ถือระหว่างรอ model เพื่อรักษา journey คุยระหว่างอ่านรูป; chat/media queue และ bounded busy retry คงอยู่เพื่อ scheduling แต่ไม่ใช่เจ้าของ balance
- หากยอดใช้ถึง cap ตอบ exceeded; หากยังเหลือแต่ `upperBound` ไม่พอ ตอบ insufficient พร้อม scope ที่บล็อก ตรวจ TOTAL ก่อน แล้ว bucket ไม่เริ่ม provider และไม่เพิ่ม OCR read count
- Settle actual usage + event rows + monthly/bucket aggregate + release ส่วนจองที่เหลือใน transaction เดียวและ exactly once ตาม execution identity การส่งคำตอบ LINE ซ้ำไม่สร้าง reservation/model execution ใหม่
- ถ้า money reserve สำเร็จแล้ว OCR switch/count/plan/source readiness ปฏิเสธก่อน dispatch ต้อง cancel/release เฉพาะ reservation นั้นพร้อม proof ว่ายังไม่มี invocation เริ่ม; **คืนสิทธิ์ OCR หลัง provider failure ไม่ใช่ proof ให้คืนเงิน** Actual/estimated provider cost และ uncertain holds ต้องคงอยู่ตาม evidence แม้ usable-result quota ถูก refund ตาม onboarding amendment
- API/Gateway crash หรือ timeout ที่ไม่รู้ว่า provider ทำงานแล้วหรือยัง ห้ามปล่อยเงินจองด้วย TTL อย่างเดียว ต้อง settle ตาม conservative accounting หรือคงสถานะรอตรวจจนมีหลักฐาน ผู้ใช้เห็น “กำลังตรวจสอบยอดที่จอง” ไม่อ้างว่า spent เท่ากับ reserved
- หาก meter write ล้มหลัง model สำเร็จ ไม่เปลี่ยนผลธุรกิจที่เสร็จแล้วเป็นล้ม แต่คง reservation ป้องกันการใช้เงินซ้ำและส่ง operational alert ตามระบบเดิม การ release ต้องมี proof และ audit; ไม่มี auto-reset/replay งานลูกค้า
- ถ้า actual เกิน bound ถือเป็น invariant breach: บันทึกต้นทุนจริงให้ครบ, ปิด admission ของ scope ที่เกี่ยวข้องและแจ้ง operator ห้าม clamp actual ให้เท่ากับ cap รายงานว่าผ่าน hard-cap acceptance ไม่ได้จนแก้ bound และ regression แล้ว

Hard cap นี้รับรองต้นทุนตาม application meter/price snapshot ไม่ใช่ยอด invoice รวมภาษีหรือ FX ของ AWS ภายนอก การจองแบบ conservative อาจปฏิเสธก่อนยอด spent ถึง cap จึงต้องผ่าน near-limit UX และวัด utilization ก่อน release ไม่ซ่อนข้อจำกัดนี้ด้วยการเพิ่มงบเอง

ต้องปิด feasibility gap ก่อนรับ implementation E: ปัจจุบัน receipt route อาจเรียก 4 providers และ timeout fallback ต่อ call ใช้ 200,000 input tokens ตัวอย่างสูตรในระบบที่ input USD3/ล้านและ FX33: input ceiling ของ 4 calls อย่างเดียว = 79.20 บาท ก่อน output/cache ดังนั้นจอง worst case ทั้ง route โดยไม่วัดอาจทำให้งบ OCR 70 บาทเริ่มอ่านไม่ได้แม้ยังใช้ 0 บาท ตัวเลขนี้เป็นตัวอย่างทางคณิตศาสตร์ ไม่ใช่ต้นทุนจริงของบิลหนึ่งใบหรือราคาปัจจุบันของ vendor

จึงกำหนดใช้ provider-call steps เป็นทางเดียวของ SPLIT: reserve ขั้นแรกก่อนเรียก ขั้นถัดไปต้อง reserve เพิ่มแบบ atomic **ก่อน** dispatch และรักษา usable partial result/ไฟล์เมื่อเงินไม่พอทำต่อ ไม่เริ่ม step ถัดไปด้วยการยืมงบหรือโยก bucket Simple one-call route ใช้ API-side reserve เดิมที่ขยายแล้วได้; multi-call gateway ใช้ authenticated API budget-step seam ก่อน invocation ตาม parent execution envelope ไม่เพิ่ม LLM call เพื่อขออนุมัติงบ

ยังต้องส่งตาราง upper bounds/ขั้นต่ำที่เริ่มได้ของทุก seam พร้อมหลักฐานว่า supported caps ใช้งานหลักได้ รวม intake ที่อ่านรูปสำเร็จแล้วแต่ OCR extraction step ไม่มีเงินพอ ส่วน image/transcription ที่ใช้งานได้เก็บตาม source/permission contract ไม่แจ้งว่า expense complete และไม่คืนต้นทุน intake ที่เกิดแล้ว

### 12.4 Data model และ config contract

ใช้ `CompanyAiConfiguration` เดิม เพิ่ม active `budgetMode` (default `SHARED`), `chatMonthlyBudgetSatang`, `ocrMonthlyBudgetSatang` และ `budgetConfigVersion` แยกจาก OCR count config version สำหรับค่าที่เริ่มเดือนถัดไปมี nullable `pendingBudgetPolicy` ซึ่ง validate เป็น `{ mode, chatMonthlyBudgetSatang, ocrMonthlyBudgetSatang, effectiveMonthKey }` เท่านั้น คง active policy ไว้จน pending มีผล ไม่ใช้ columns ชุดเดียวเขียนทับ cap ปัจจุบันเมื่อผู้ดูแลตั้งเดือนหน้า และไม่สร้าง policy service ใหม่

ขยาย `PUT /v1/system/partners/:partnerCompanyId/ai-model` / `SetPartnerAiModelDto` ให้รับ mode/caps/effective month/expected budget version พร้อม reason ตาม admin adjustment เดิม การแก้ total/mode/caps ต้อง validate ทั้งชุดใน transaction เดียวและเก็บ before/after + version ใน audit; stale desired state ที่ต่างตอบ conflict ส่วน exact replay เป็น no-op ไม่ audit ซ้ำ

รวม HTTP `SetAiModelBodyDto`, controller argument mapping, response DTO, web save/reload และ adjustment-history field allowlist ด้วย ไม่แก้เพียง TypeScript type/use case แล้วให้ validation strip/ignore fields ใหม่ คง semantics absent=preserve, null=clear เฉพาะ field ที่อนุญาต, numeric 0=closed bucket และ total ยังต้องเป็นบวกตาม contract เดิม

ไม่เปลี่ยน total ผ่าน writer เก่าให้ split allocation ผิดเงื่อนไข; split mode ต้องใช้ version-aware writer การลด platform default ต้องตรวจ active/pending SPLIT ของบริษัทที่ inherit ภายใต้ lock เดียวกับ admission และปฏิเสธ write ถ้าค่าใหม่ทำให้ allocation หรือ committed+reserved เกิน total ไม่ปล่อยให้ Admin save สำเร็จแล้วร้านหยุดเงียบ ๆ ให้คืน scoped impact/conflict ที่ผู้มีสิทธิ์ตรวจได้ ค่า external/config drift ที่เกิดนอก governed writer ยัง fail closed พร้อมเหตุ ไม่ clamp/กระจายใหม่

การตั้ง effective total/cap ต่ำกว่า spent + active reservation ปัจจุบันถูกปฏิเสธ; การลด bucket caps เดือนถัดไปใช้ pending policy ได้ ส่วน total override ยังเป็น existing immediate setting และไม่ได้เพิ่ม scheduled platform-total editor ในงานนี้ Lowering platform **ceiling** เป็น validation ของ writes ใหม่ตาม grandfathering เดิม ไม่ใช่การลด effective cap ของ override เดิม ต้องแยก default กับ ceiling ใน tests

เพิ่ม durable reservation ที่ผูก company/month/bucket/server execution identity, upper bound, pricing snapshot, status และ settlement evidence; reuse `AiUsageEvent`/monthly aggregate เป็น actual ledger และเพิ่ม bucket aggregate ใน transaction เดียว ไม่มี ledger ค่าใช้จ่ายอีกชุดที่ reconcile แยกกัน

Migration/index ต้องรองรับ lookup company/month/bucket และ unique settlement; execution identity ห้ามมี prompt, raw LINE ID หรือ secrets Gateway ได้เฉพาะ bounded execution envelope ที่ตรวจ internal auth เดิม ไม่ได้อ่านหรือเขียน budget DB เอง

### 12.5 Cutover, historical data และ rollback

- เก็บ metadata งาน D ก่อน เปิด SPLIT ได้เมื่อ writers ทุก seam รองรับ reservation/settlement และไม่มี legacy in-flight action ที่เข้ามา charge นอก bucket; service version เก่าต้องไม่รับ SPLIT traffic
- บริษัทที่มี spend หรือ unresolved action อยู่แล้วในเดือนนี้ ให้ตั้ง SPLIT มีผล **เดือน Bangkok ถัดไป**; ไม่เดาแบ่ง 55.67 บาทย้อนหลัง และไม่ย้ายค่าใช้จ่ายเก่าเข้าก้อนใดเพื่อทำให้มีวงเงินใหม่ บริษัทเดือนปัจจุบันที่ยังไม่มี usage/reservation สามารถเริ่ม SPLIT ได้หลังตรวจภายใต้ lock
- `pendingBudgetPolicy.effectiveMonthKey` ในอนาคตไม่แทน active policy: บริษัทที่ยัง SHARED ใช้ shared total เดิม บริษัทที่ SPLIT แล้วใช้ caps ปัจจุบันจนเดือนที่ระบุ Resolver ที่ admission และ admin read ต้องเลือก effective policy ด้วยกติกาเดียวกัน ไม่ต้องพึ่ง cron เพื่อให้ cap มีผลตรงเดือน และตรวจ C+O กับ live T อีกครั้งตอน activation
- แก้/ยกเลิก pending policy ต้องผ่าน reason/CAS/audit เดิม; UI แยก “ใช้อยู่” กับ “เริ่มเดือน...” เมื่อ policy มีผลแล้วการบันทึกครั้งถัดไปต้องเก็บ active/current state ให้ถูกต้องก่อนรับ pending ชุดใหม่ ไม่ทับประวัติ audit
- Pending ที่ถึงวันมีผลแล้วไม่ใช่ future draft ที่ลบทิ้งแล้วกลับ SHARED ได้ Write ต้อง resolve/materialize effective predecessor ภายใต้ lock ก่อนตรวจ CAS/clear; response/read revision ต้องผูก resolved policy + Bangkok month ด้วยเพื่อให้หน้า Admin ที่ค้างข้ามเดือนถูกตรวจ conflict แม้ raw row version ยังไม่ขยับ
- การเปลี่ยน SPLIT → SHARED หรือย้ายเงินจาก bucket ที่ใช้ไปแล้วมีผลเดือนถัดไปเท่านั้น และยัง reconcile holds เดือนเก่า ห้ามสลับ mode กลางเดือนเพื่อเปิดเงินของอีก bucket; known same-mode cap adjustment ทำได้ตาม validation/CAS และไม่ลดต่ำกว่า committed+reserved
- Month pinned ที่ reserve ใช้ไปจน settle แม้ข้ามเที่ยงคืน/ขึ้นเดือนใหม่; ยอดเดือนเก่าห้ามหายจาก reservation reconciliation
- Mode/cap changes ไม่ทำให้ไฟล์หาย, ไม่เปลี่ยน OCR count/quota และไม่ย้อนเขียนประวัติ usage การเพิ่มงบในเดือนที่ total เต็มไม่เกิดขึ้นจากงานนี้เอง
- Rollback ต้องคง schema/usage/reservations ไว้; ห้าม downgrade ไป binary ที่ละเลย SPLIT หรือเปลี่ยนเป็น SHARED เพื่อเลี่ยง error โดยอัตโนมัติ หากต้องพัก ให้หยุด AI admission เฉพาะที่ได้รับอนุญาตตาม runbook และยังเปิด upload/manual ตามสิทธิ์

### 12.6 Execution identity, usage evidence และ late completion

แยก 3 identity: transport/request correlation, logical user attempt และ provider invocation ไม่ใช้ `requestId` อย่างเดียวเป็น unique charge เพราะ intake/OCR หลาย calls ใช้ request เดียวได้ ขณะ drain สร้าง random request ใหม่เมื่อ reclaim

- Server attempt key ผูก company, original webhook/expense-extraction/draft job identity, source version/hash และ ordinal ที่จำเป็น; same transport retry/reclaim ใช้ attempt เดิม Known user-requested re-read หลังผลจบเป็น attempt ใหม่
- Invocation key ผูก attempt + bounded stage/call ordinal + allowed retry attempt; duplicate invocation result ไม่เพิ่ม cost/callCount ซ้ำ แต่งานต่างขั้นที่ request ID เดียวกันต้องคิดครบ ไม่ใช้ usageTag เป็น unique key
- Execution envelope ผูก company, bucket, pinned month, model/provider/price/FX version, source fingerprint, allowed bounds และ attempt identity ผ่าน internal auth เดิม ทุก cost-bearing caller ต้องมี required governance wiring และ server tenant identity; missing Prisma/config/company ใน production ต้องปฏิเสธ ไม่ใช้ optional-DI test fallback เพื่อผ่าน SPLIT
- Duplicate HTTP/internal dispatch ต้อง claim execution ownership แบบ durable ก่อน provider ไม่แค่ dedup ตอนรับ usage; lost response ห้ามทำ Converse/ERP mutation ซ้ำบน attempt เดิมโดยอ้างว่าคิดเงินครั้งเดียวแล้วจึงปลอดภัย ถ้าพิสูจน์ว่า invocation เดิมไม่เริ่มไม่ได้ ให้ unresolved/hold
- SDK retries, runtime adapters และทุก provider ที่อนุญาตต้องประกาศ retry/call/input/output bounds และใช้ envelope เดียวกัน ถ้าไม่รองรับให้ refuse สำหรับ SPLIT ไม่ silently fallback ไป runtime/โมเดลที่ไม่มี reservation
- `AiUsageInterceptor` ที่แนบ usage เฉพาะ success response ไม่พอ: provider success แล้ว parser/controller error, partial chain และ HTTP response สูญหายต้องไม่กลายเป็น cost=0 Gateway ส่ง evidence ตาม invocation ผ่าน API-owned authenticated settlement/recovery seam; Gateway ไม่มี DB access และ error DTO ที่ส่งผู้ใช้ไม่บรรทุก internal usage evidence
- ไม่อ้างว่าเพิ่ม caller timeout ทำให้ unknown result หมดไป ยังต้องรองรับ process/network failure, response after cancellation และ provider response ที่มาถึงหลัง owner เปลี่ยน
- Reservation state อย่างน้อย `RESERVED` → `DISPATCHED` → `SETTLED` หรือ `UNRESOLVED`; `CANCELLED` ใช้ได้เฉพาะ proof ว่าไม่มี provider start Durable fencing token กัน delayed callback/compensation ของ owner เก่าไม่ให้ release reservation ของ owner ใหม่
- Settlement ที่มี provider-reported usage มี invocation unique fence; conservative settlement ต้องบันทึก basis และ evidence Late actual ของ invocation เดิมไม่สร้าง charge ใหม่ การแก้ estimate ใช้ audited idempotent reconciliation/delta ภายใต้ original month/locks ไม่แก้ประวัติ cost เงียบ ๆ และไม่เพิ่ม provider callCount อีก
- Parent attempt ตรึง Bangkok month/mode/effective-policy reference ตั้งแต่เริ่ม ส่วนทุก step ใช้ company/bucket เดิมและ read balances ของเดือนที่ตรึงไว้ ไม่หยิบ allowance เดือนใหม่มาเติม chain เก่า เมื่อข้ามเดือนต้องมี original-month budget snapshot ที่ตรวจจาก durable evidence ได้สำหรับ step ถัดไป; ไม่มี snapshot ให้หยุดพร้อม partial result โดยไม่ย้ายเงินเงียบ ๆ
- กระบวนการ reconciliation ต้องเห็น original reservation/invocation/source/evidence และคืนได้เฉพาะส่วนที่พิสูจน์ว่าเหลือ ไม่ reset ทั้งบริษัทหรือย้ายไปเดือนปัจจุบัน การ reconcile เงินไม่ใช่คำสั่ง retry AI หรือ replay ERP mutation

### 12.7 Lock order, effective policy และ late work

Reuse existing company locks โดยกำหนด order เดียวสำหรับ config, reserve, settle และ OCR compensation: company OCR/config → company/plan-term เมื่อ action นั้นต้องใช้ → platform-budget → original company-month budget → bucket rows ตามลำดับคงที่ ไม่ reacquire lock นอก transaction/client คนละตัวระหว่างถือ lock และไม่ถือ DB lock ระหว่าง provider/network call

Platform-default writer ถือ platform lock และอ่าน affected allocations/committed balances เพื่อ validate โดยไม่ไล่ถือ company lock ในลำดับย้อนกลับ Company/config/provisioning writers ต้องผ่าน platform validation ก่อนเขียน effective total; pure settlement ใช้ pinned price/month แต่ยัง serialize กับ cap changes

เงิน reserve ที่ทำภายใต้ policy เก่าต้องนับต่อจน settle แม้มี Admin เปลี่ยน policy/โมเดลหรือขึ้นเดือนใหม่ คำขอที่ยังไม่ dispatch ต้องผ่าน current access/source checks ก่อนเริ่มตาม contract เดิม การถูก revoke ก่อน provider เป็น no-call cancellation ที่ต้องคืนทั้ง hold และ count admission ที่ไม่ถูกใช้ ส่วน revoke หลัง provider ไม่ลบต้นทุนที่เกิดแล้ว

Cutover ต้องมีหลักฐาน **ครบทุก writer/runtime/worker** ว่ารองรับ SPLIT ไม่ใช่ version เฉพาะ API web; delayed SHARED response จากเดือนก่อนยังลงเดือนเดิมและไม่หายจาก total reconciliation Runtime ที่ยังไม่รู้ invocation envelope ห้ามรับ traffic ของบริษัท SPLIT

## 13. เกณฑ์ยอมรับเพิ่มเติมของงานรวม

ทุกข้อด้านล่างเป็นงานที่ต้องทดสอบ ยังไม่ใช่ผลผ่าน รวมกับ AC-01–16 ของ ledger:

- [ ] B-01 Text/LINE image/web OCR คง typed budget reason/scope; exceeded, insufficient, busy, unavailable, OCR quota และ provider error ไม่ปนกัน
- [ ] B-02 Intake budget denied ไม่เรียก OCR/provider fallback; ไม่เพิ่ม usage/OCR read count จาก refusal
- [ ] B-03 Web upload/manual ยังสำเร็จตามสิทธิ์เมื่อเงิน AI เต็ม; ไฟล์และข้อมูลเดิมยังอยู่ และ UI ไม่แสดงว่า OCR สำเร็จ
- [ ] B-04 LINE แจ้ง retained เฉพาะเมื่อ persist สำเร็จ; no-permission, save failure, pending retention และ duplicate webhook ไม่สร้าง expense/ส่งข้อความซ้ำผิดสถานะ
- [ ] B-05 Scope CHAT เต็มไม่รับประกัน OCR ถ้า OCR/count/plan/total gate ปิด; static menu ยังเป็น deterministic
- [ ] B-06 Known budget refusal/support pause ไม่ถูกนับ generic outage; delivery failure/pending และ unknown statuses ยังมองเห็นจริง
- [x] C-01 มีก่อน/หลังบน corpus text/image, cold/warm cache และ cost ต่อ successful task รวมทุก tag/retry — [benchmark §4/§10](../research/line-ai-intake-cost-benchmark-2026-09-17.md) corpus hash `cf9bce44…` เดียวกันทั้งสองรอบ, THB/successful 0.93 → 0.79, cold/warm รายคอลใน §10.4, per-tag ครบทุก tag ใน §10.3
- [x] C-02 ต้นทุนลดตาม §10 โดย critical routing/permission/correction cases ผ่าน และ OCR field accuracy ไม่ลด; ไม่เพียงย้ายค่าใช้จ่ายไป tag อื่น — routing 95.1% → 96.3%, successful 76 → 77 (ไม่มี task ใด success → fail), correction/clarification/denied-capability rows ผ่านทั้งหมด, OCR fields เท่าเดิม, และการประหยัดทั้งหมดอยู่ใน `line.intake-route` โดย tag อื่นไม่ขยับเกิน THB 0.25
- [x] C-03 บิลยาว/รูปอ่านยากไม่เกิด truncation หรือ retry เพิ่มจากลด output; valid transcription/plan reuse ยังคงถูกต้อง — truncation 0 → 0, calls/task 2.59 เท่าเดิม, `ocr.receipt.image-reread` 8 → 8 และ `ocr.receipt.image-read` 10 → 10, `documentText` ไม่หด (152–1,276 chars) และ 22-item bill กับ low-contrast slip ยังอ่านยอด/วันที่/ร้านถูกต้อง
- [ ] C-04 Cache metrics บันทึกตามจริง; โมเดล/config เดิม และไม่มี extra call เพื่อหา budget bucket — cache read/write บันทึกตามจริงทุกคอล และโมเดล/region/config เดิมไม่เปลี่ยน แต่ข้อ "ไม่มี extra call เพื่อหา budget bucket" เป็นของงาน E (bucket classification ยังไม่ implement) จึงยังไม่ปิด
- [x] D-01 API/web แสดง total, kinds, buckets, cache, average, other tags และ partial history ได้ตรง snapshot และ reconcile กับ ledger — ฝั่ง API และการ reconcile กับ ledger ผ่านด้วย focused specs + real-PostgreSQL breakdown (D1, 2026-09-17); ฝั่ง web ผ่านด้วยหลักฐานเบราว์เซอร์จริง `docs/qa/evidence/ai-budget-split-2026-09-17/shared-no-split-{1440,390}.png` (total, byBudgetBucket, byRequestKind, byUsageBasis, ค่าเฉลี่ย, ต้นทุน cache ทั้งแบบมีหลักฐานราคาและ “ไม่มีข้อมูล”, coverage บางส่วน และรายการปรับปรุงต้นทุนที่ไม่นับเป็น calls). แถวยอดที่เหลือของ top-10 ไม่มีภาพเพราะเดือนที่ seed มีสอง tag; ส่วนนั้นคง proof เดิมจาก D1 (2026-09-17, D2)
- [x] D-02 Historical unknown ไม่ถูกเดา, missing pricing ไม่เป็น 0, component rounding มีหลักฐาน และ calls ไม่ถูกแสดงเป็นจำนวนใบเสร็จ — ผ่านด้วย focused specs + real-PostgreSQL breakdown (2026-09-17, D1)
- [ ] D-03 Loading/error/retry/read-only, saved/draft, stale version, company switch, desktop/mobile และ audit history ผ่าน; tenant API อ่าน/แก้ budget ไม่ได้ — ผ่านแล้วด้วยหลักฐานเบราว์เซอร์ (2026-09-17, D2): read-only (`read-only-operator-*`, `canManage` จาก permission ของผู้เรียก), saved-versus-draft (`validation-caps-exceed-total-*` พร้อม assertion ว่ายอดที่บันทึกไม่ขยับตาม draft), stale version (`conflict-409-after-second-tab-*`) และ desktop/mobile ครบทุกภาพที่ 1440 กับ 390 px โดยไม่มี horizontal scroll (assert ทุกภาพ). audit history (`audit-history-*`), locked company (`locked-company-*`) และ tenant API อ่าน/แก้ budget ไม่ได้ — ข้อสุดท้าย assert กับ `DenyByDefaultGuard` ตัวจริงใน `partner.controller.spec.ts` ทั้ง `aiUsage` และ `setAiModelConfig` (ผู้เรียกระดับ tenant, ไม่มี session เลย และผู้ที่มีเฉพาะ permission อ่าน). **ยังเปิด**: loading/error/retry และ company switch ยังไม่มีภาพ — เป็นพฤติกรรมเดิมของการ์ดนี้ (generation token + remount key) ที่งาน D2 ไม่ได้แก้
- [ ] E-01 Split validation: C/O เป็น satang ไม่ติดลบ, zero closes bucket, C+O<=T; null/malformed/unauthorized/stale writes ไม่ผ่าน
- [x] E-02 CHAT เต็ม/OCR เหลือ อ่านได้ตามวงเงินจอง; OCR เต็ม/CHAT เหลือ คุยได้; TOTAL เต็มหยุดทั้งคู่ โดยไม่ยืมเงิน — ผ่านด้วย decision-table specs (ทั้งสองทิศ + TOTAL) และ real-PostgreSQL bucket invariants (2026-09-17, E1b)
- [x] E-03 LINE image intake, caption, receipt extract/re-read, statement, CRM/draft และ fallback ถูก bucket ก่อน provider; attached image ไม่ย้าย general tool reasoning ไป OCR — ผ่านด้วย step/bucket จาก `classifyAiUsageRequest` ก่อน reserve ทั้งห้า seam และ seam specs (line-turn ยัง CHAT แม้มีรูป) (2026-09-17, E1b)
- [x] E-04 Simultaneous multi-instance chat/media/web admissions reserve ทั้ง total/bucket atomically; ใช้ไม่เกิน cap รวม active reservations และไม่ block แชตตลอดช่วง OCR — ผ่านด้วย real-PostgreSQL 20-way concurrent reserve (4 CHAT + 3 OCR ตามคาด, invariant ครบ) และ lane lease เดิมยังแยก chat/media (2026-09-17, E1b)
- [ ] E-05 Upper bound ครอบคลุม cold cache, max output, images, bounded multi-call/retry และ timeout estimate; missing bound/config/price/DB ปฏิเสธก่อน provider
- [ ] E-06 Near-limit insufficient ไม่อ้างว่า spent เต็ม; reservation/actual/available ถูกต้องหลัง success, known no-call, timeout, crash และ settlement write failure — API side ผ่าน (insufficient แยก exceeded พร้อม scope, spent/reserved/available ใน admin read, sweep ไม่ปล่อยเงิน); timeout accounting ยังรอ gateway (E1c) และ UI ยังไม่แสดง (D2)
- [x] E-07 Same execution/redelivery settles once; uncertain reservation ไม่ถูก TTL ปล่อยให้ใช้เงินซ้ำ และ invariant breach บันทึก actual/alert โดยไม่ clamp — ผ่านด้วย real-PostgreSQL concurrent settle (1 event, aggregate ขยับครั้งเดียว), DISPATCHED → UNRESOLVED ไม่ปล่อยเงิน + late settle ปิดได้ และ breach บันทึก actual เต็มพร้อม HIGH event และปิด scope (2026-09-17, E1b)
- [ ] E-08 Bangkok month rollover/pending activation, nonempty-month next-month cutover, scheduled cap change ของบริษัทที่ SPLIT อยู่แล้ว, cancel/stale pending, old writers/in-flight และ additive migration/rollback ผ่าน
- [ ] E-09 Admin cap/mode/total changes มี reason/CAS/audit; invalid inherited total ปิดอย่างเห็นเหตุ; ลดต่ำกว่า committed/reserved ไม่ผ่าน
- [x] E-10 OCR count/refund/paid receipt grants และ permission ยังตรง spec ปัจจุบัน ไม่ถูก money reservation เปลี่ยนความหมาย — ผ่าน: `admitCompanyOcr`/`releaseCompanyOcrAdmission` ไม่เปลี่ยนสัญญาเลย, reserve มาก่อน count, refund ของ count เข้าถึง reservation ไม่ได้ และ seam spec ยืนยัน retryable provider failure ไม่คืนเงิน (2026-09-17, E1b)
- [ ] X-01 End-to-end: missing ledger + CHAT exhausted + OCR funded ใช้ข้อความแจ้งถูกเหตุและส่งรูปได้; missing group on existing stream ยัง fail closed ก่อน mutation
- [ ] X-02 UAT มี real LINE + web journey, exact source, correlation, file/expense state, usage/reservation และ delivery evidence; release acceptance แยกจากการปิด incident ในภาพ

เกณฑ์เพิ่มจาก impact review รอบ 2:

- [ ] R-01 Upper-bound feasibility table ครบทุก seam; งบที่ product รองรับเริ่มงานหลักได้จริง; per-step continuation ที่เงินไม่พอรักษา partial result/file และไม่ใช้เกิน cap
- [ ] R-02 Envelope ครอบคลุม per-invocation rounding, cache, SDK retries, mixed provider/runtime และ multi-call; unknown runtime/config ไม่ผ่านแบบ unmetered
- [x] R-03 Stable attempt/invocation fence: transport retry, same-request different stage, drain reclaim, replay after month rollover และ explicit new re-read คิดเงิน/เรียก providerถูกจำนวน — ผ่านด้วย attempt key ต่อ seam (webhook/attachment/import/job id, hash LINE id), drain retry ordinal จาก `deliveryCount`, unique invocation fence และ real-PostgreSQL duplicate-claim + month-pin evidence (2026-09-17, E1b)
- [ ] R-04 Parser/controller error หลัง provider, partial chain, lost HTTP response, late result และ stale owner compensation ไม่ทำให้ usage หาย/ซ้ำหรือ release active hold
- [x] R-05 OCR count refund หลัง unusable/persistence failure ไม่คืน actual AI money; no-provider OCR refusal คืน hold ได้; successful result + delivery failure ไม่อ่านใหม่หรือคืน count ผิด — ผ่านโดยโครงสร้าง (cancel ต้องมี proof + owner token, `releaseCompanyOcrAdmission` ไม่รับทั้งสอง) พร้อม seam spec และ real-PostgreSQL fencing evidence (2026-09-17, E1b)
- [x] R-06 Config/default writes แข่ง reserve/settle/receipt grants/signup retry โดยไม่ deadlock; ลดต่ำกว่า allocation/committed ปฏิเสธก่อน save และ ceiling grandfathering คงเดิม — ผ่านด้วย canonical lock order เดียวทุกทาง, real-PostgreSQL reserve-vs-writer 50 รอบไม่ deadlock, cap/total ต่ำกว่า spent+reserved ถูกปฏิเสธ และ platform-default writer ตรวจ committed+reserved ใต้ platform lock เดียว (2026-09-17, E1b)
- [ ] R-07 Month-boundary stale UI, activation แล้ว cancel pending, SPLIT→SHARED และ old-mode late result ไม่เปิดช่องใช้เงินข้าม bucket/เดือน
- [x] R-08 Real HTTP DTO/controller/web save ส่ง split fields ครบ; absent/null/zero/CAS/read-only/locked company/audit-history ถูกต้อง ไม่เพียง test use case โดยตรง — ผ่านทุกข้อผ่าน HTTP จริงจากหน้าเว็บ (2026-09-17, D2), ดู `docs/qa/evidence/ai-budget-split-2026-09-17/`: split fields ครบทั้งชุด (mode/caps/effective month/`expectedBudgetRevision`); **zero** = `zero-cap-saved-*` (cap `0` แสดงเป็น “ปิดส่วนนี้ (0 บาท)” ส่วนเงินที่เหลือของก้อนนั้นเป็น ฿0.00 — คนละความหมาย); **null** = `pending-cancelled-*` (`budgetPolicy: null` ลบค่าที่ตั้งล่วงหน้าโดยไม่แตะ active policy); **absent** = การบันทึก policy ทุกครั้งไม่ส่ง `monthlyBudgetSatang`/`modelId` แต่งบรวมยังเป็น ฿10,000.00 และ SPLIT บันทึกสำเร็จได้ก็เพราะรุ่น AI ที่บันทึกไว้ก่อนยังอยู่ (เห็นในภาพเดียวกัน); **CAS** = `conflict-409-after-second-tab-*` (assert ว่าอีกแท็บขยับ revision จริงก่อน); **read-only** = `read-only-operator-*` และ **locked company** = `locked-company-*` (assert ว่าทุกฟอร์มบนการ์ด disabled จริง ไม่ใช่ดูจากภาพ พร้อม control case ว่าผู้มีสิทธิ์บนบริษัท ACTIVE ยังแก้ได้); **audit-history** = `audit-history-*` (ตั้งล่วงหน้า → แก้ค่าที่ตั้งไว้ → ยกเลิก สามรายการจริงเรียงเป็น before/after ภาษาไทย)
- [ ] R-09 Drain/CRM/draft/statement permanent budget refusal ไม่วน retry จนกลายเป็น poison/error อื่น และ reply recovery คง reason/scope ของ attempt เดิม
- [ ] R-10 Partner support/billing grant/plan warnings เห็น OCR-only exhaustion/active holds; เพิ่ม receipt grants ไม่สื่อว่าเพิ่มเงิน AI และไม่รั่ว internal money fields — **OCR-only exhaustion ผ่านแล้ว** (2026-09-17, D2): ทั้งสี่ทางเรียก (`get-partner-timeline`, `billing-receipt-adjustments.readWarnings`, `billing-plan-adjustments.unchanged`, `signup-ops-alert.sweepTrialBudgets`) ใช้ `readAiBudgetReadiness` ซึ่งมาจาก resolver เดียวกับ admission บวก `readAiBudgetMonthSnapshot` เดียว; SHARED ให้ผลเดิมทุกตัวอักษร (spec เดิมไม่แก้), SPLIT ได้ `AI_OCR_BUDGET_REACHED` / `aiOcrBudgetReached` เป็นคำพูดล้วน มี spec assert ว่าไม่มีตัวเลขหลุดเข้า warning และไม่มี money field ใหม่บนหน้า owner; บรรทัดอธิบายเดิมยังบอกว่าเพิ่มใบเสร็จไม่ได้เพิ่มงบ AI. **ยังเปิด**: active holds ยังเห็นได้เฉพาะหน้า partner AI budget (`split-reserved-unresolved-*`) — warning ของ billing grant/plan ยังไม่บอกเรื่อง hold เพราะ §11.4 ให้ readiness ที่ไม่รู้ bound พูดได้เพียง “ยังมีงบ”; ต้องให้เจ้าของงานตัดสินว่าจะถือว่าครบหรือเพิ่ม
- [x] R-11 Pending มากกว่า 50/หลาย user/trim ระหว่าง read ไม่ถูกอ้างว่า empty; malformed Redis read fail closed; corrupt key ไม่ทำให้ reclaim ของ key อื่นทั้ง batch หาย
- [ ] R-12 Estimated/legacy/unknown usage แสดงตาม basis; evidence corrections reconcile cost โดยไม่เพิ่ม calls; cost corpus ไม่ตัด failures/refusals จาก denominator — สองข้อแรกผ่านแล้วใน D1 (2026-09-17); ยังเปิดเพราะ cost corpus เป็นของงาน C

## 14. ส่งมอบและขอบเขตที่ไม่ทำ

Implementation แบ่ง A → B → D metadata/baseline → C → E → integrated acceptance ตาม [แผนรวม](../plans/line-ai-ledger-lifecycle-remediation-plan-th.md) อัปเดตหลักฐาน Product/Architecture/Implementation/Integration ใน memory ทุกช่วง ห้าม tick acceptance จากการมี spec หรือ unit tests เพียงอย่างเดียว

ไม่รวมการตั้งงบจริงให้บริษัท, เปลี่ยนแพ็กเกจ/ราคาโมเดล, ส่งข้อความหาลูกค้า, reset live Redis, background retry เอกสารเก่า หรือ deploy โดยอัตโนมัติ ก่อน UAT/Production deploy/promotion/recovery ต้องอ่าน runbook ปัจจุบันและใช้ exact run IDs + signed results + customer OPEN ตาม protocol เดิม
