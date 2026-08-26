# LINE AI UAT Correctness, Reimbursement Intent, and Latency Spec

## 1. สถานะ

- สถานะ: **MERGE-SAFE แบบ default-off; ยังไม่ ACTIVATION-READY และ behavior phases ต้องผ่าน rollout gates ตาม §15**
- วันที่: 2026-08-21
- เจ้าของ: Product / Finance Platform / LINE AI / AI Gateway
- ขอบเขต: LINE OA สำหรับพนักงาน ไม่รวม CRM customer auto-reply
- การเปลี่ยนโค้ด: **มีแล้ว** แต่อยู่หลัง flag ที่ default-off ทั้งหมด
  (`LINE_AI_REIMBURSEMENT_SEMANTIC_MODE='off'`, `LINE_AI_EXACT_GREETING_ENABLED=false`,
  `LINE_AI_MULTIPART_TERMINAL_FLEX_ENABLED=false`) ยังไม่มีการ deploy และไม่มีการเปลี่ยน config ในทุก
  environment ค่า default ให้พฤติกรรมเดิมทุก byte
- ยังไม่ ACTIVATION-READY จนกว่าจะครบทั้งสี่ข้อ: durable replay ของ terminal outcome, DB-backed neutral
  intake state, text fallback เมื่อ Flex delivery ล้ม และ configured-provider replay + UAT canary
- ไม่มี reimbursement writer ในโค้ดนี้ Phase 3B (DRAFT-only) ยังบล็อกที่ owner GO
- 1,000 ms debounce ยังเป็นเพียง experiment candidate หลักของ implementation เดิม PR นี้ไม่ได้เปิดหรือ deploy

เอกสารนี้รวม UAT defect ที่สัมพันธ์กัน 4 กลุ่มไว้ในงานเดียว:

1. ข้อความมีจำนวนเงินและวัตถุประสงค์ครบ แต่ระบบถามซ้ำ
2. คำว่า “ขอเบิก/เบิกคืน” ถูกสร้างเป็น `ExpenseRecord` และลิงก์ `/expenses`
3. คำตอบสำเร็จเป็นข้อความยาวและ LINE link preview แทน first-party Flex card
4. ข้อความง่ายมาก เช่น “สวัสดี” หรือ text capture หนึ่งรายการ ใช้เวลาหลายวินาที

## 2. เอกสารและของเดิมที่ต้องใช้ซ้ำ

- `docs/specs/line-ai-latency-and-autonomy-lanes-spec.md`
- `docs/plans/line-ai-latency-and-autonomy-lanes-plan.md`
- `docs/specs/line-ai-expense-draft-conversation-spec.md`
- `docs/specs/reimbursement-approval-spec.md`
- `docs/specs/reimbursement-journey-uplift-spec.md`
- `docs/specs/permission-matrix.md`
- `docs/specs/line-ai-message-buffering-spec.md`
- `docs/specs/line-substitute-semantic-routing-spec.md`
- `docs/adr/0008-line-ai-access-and-auth.md`
- `docs/adr/0010-line-ai-turn-ledger-redis-streams.md`
- `docs/adr/0011-line-ai-value-normalization-and-thai-date-canon.md`
- `apps/api/src/modules/line-ai/domain/logic/line-business-card.logic.ts`
- `apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.ts`

ห้ามสร้าง router, card renderer, permission model, reimbursement state machine หรือ eval runner ชุดที่สอง

## 3. เป้าหมายผลิตภัณฑ์

ผู้ใช้พูดภาษาธรรมชาติครั้งเดียวแล้วระบบต้อง:

- เข้าใจให้ถูกว่าเป็น “บันทึกค่าใช้จ่ายของบริษัท” หรือ “ขอเบิกคืนเงินให้ผู้จ่าย”
- รับค่าที่ผู้ใช้บอกมาแล้ว ไม่ถามซ้ำในฟิลด์ที่ครบ
- ถ้าข้อมูลไม่ครบ ให้ถามเฉพาะฟิลด์ที่ขาดและจำค่าที่รับแล้วได้
- ถ้าค่ารอบใหม่ขัดกับค่ารอบก่อน ให้ถามยืนยันความขัดแย้ง ไม่เลือกเอง
- ตอบผลสำเร็จเป็น Flex card ที่อ่านง่ายและพาไป object ที่ถูกต้อง
- ใช้ model เฉพาะจุดที่ต้องเข้าใจภาษา และใช้ deterministic code คุม permission, validation, idempotency, state และ mutation
- ลด model calls, latency และ cost โดยคุณภาพภาษา/ความถูกต้องต้องเท่าเดิมหรือดีขึ้น

## 4. หลักฐาน UAT และ root cause

### 4.1 Trace ที่วัดจาก UAT วันที่ 2026-08-21

| เคส | ผลปัจจุบัน | เวลารวม | ส่วนที่ใช้เวลา |
| --- | --- | ---: | --- |
| `สวัสดี` | คิดนานแล้วตอบ casual card | ~12.65s | buffer 2.50s + intake router 3.16s + Gateway 6.54s; รวม 3 model calls |
| `เบิกค่าวินมอไซด์ไปพบลูกค้าหน่อย 50 บาท` | ถามยอดและวัตถุประสงค์ซ้ำ | ~16.03s ใน trace เดิม | buffer 2.50s + intake router 8.34s +ช่วง capture ที่ยังวัดแยกไม่ได้ |
| `เบิกค่ารถวินมอไซต์ 60 บาท ไปพบลูกค้า` | ถามยอดและวัตถุประสงค์ซ้ำ | 11.75s | buffer 2.50s + intake router 8.79s + dispatch/delivery ~0.46s |
| `ค่าเดินทาง 200 บาท วัตถุประสงค์ไปพบลูกค้า` | สร้าง expense draft 200 บาท | 9.11s | buffer 2.50s + intake router 6.20s + capture/delivery ~0.40s |

สองข้อความหลังถูก router เป็น `EXPENSE_DOCUMENT_CAPTURE` ด้วย confidence `0.97` และ
`loadingRequested=false` ทั้งคู่ จึงเห็น status bubble หลังรอ แทน acknowledgement ตั้งแต่รับข้อความ

### 4.2 ทำไมข้อมูลครบแต่ถามซ้ำ

Router สามารถส่ง `amount`, `description`, `businessPurpose` และ `expenseCategoryId` ได้ แต่ final
deterministic gate `isLineTextExpenseCaptureEligible()` ยอมรับ purpose เฉพาะเมื่อ:

- `description` เป็นข้อความที่ grounded ใน source; หรือ
- ชื่อ active expense category ปรากฏตรง ๆ ใน source

gate ไม่อ่าน `businessPurpose` แม้ field นี้อยู่ใน contract และ grounded ในข้อความ จึงเกิด contract
handoff mismatch: AI เข้าใจ “ไปพบลูกค้า” แต่ deterministic code มองว่ายังไม่มี purpose

เมื่อไม่ครบ `LineTextExpenseCaptureIncompleteError` ไม่มี typed `missingFields` และ dispatcher ใช้ข้อความ
คงที่ที่บอกให้กรอก “ยอดเงินและวัตถุประสงค์” เสมอ ผู้ใช้จึงถูกขอให้พิมพ์ยอดซ้ำทั้งที่ระบบอ่าน `60` แล้ว

### 4.3 ทำไม “ขอเบิก” กลายเป็น `/expenses`

- `LineIntakeRouteIntent` ไม่มี intent สำหรับเริ่มคำขอเบิกคืน
- prompt ปัจจุบันนิยามข้อความสั้นที่มี amount + purpose เป็น `EXPENSE_DOCUMENT_CAPTURE`
- dispatcher ของ route นี้เรียก `CaptureLineExpenseNoteUseCase` และสร้าง `ExpenseRecord`
- ระบบ reimbursement บน LINE มีเฉพาะ read/status/deep-link ตาม product decision เดิม และไม่มี create route

นี่ไม่ใช่เพียงการใช้คำว่า “รายจ่าย” ผิดใน UI แต่เป็น domain ownership ผิด: คำขอเบิกต้องเป็น
`ReimbursementRequest` ส่วน `ExpenseRecord` ที่เป็นผลทางบัญชีจะถูกสร้างเป็น claim projection ภายหลังตาม
reimbursement lifecycle การสร้าง expense ก่อนแล้วค่อยทำ claim เสี่ยงรายการซ้ำ, evidence ownership ผิด
และการชำระซ้ำ

### 4.4 ทำไมไม่มีการ์ด

ผล text capture ผ่าน `deliverCompletedReplies()` ซึ่งแปลงทุกส่วนด้วย `buildTextMessage()` แม้มีเพียง
ข้อความเดียว จึงได้ plain text + LINE-generated link preview ตัว renderer ที่ปลอดภัย
`buildLineAssistantTextCardMessage()` มีอยู่แล้ว แต่ใช้ใน singular completed path เท่านั้น

ต้องแก้ transport presentation โดยไม่เปลี่ยน persisted `replyText`; ห้ามให้ model สร้าง raw Flex JSON

### 4.5 ทำไมข้อความง่ายยังช้า

- ทุกข้อความเสีย buffer default 2,500 ms ก่อนเริ่มคิด
- `สวัสดี` ถูก outer intake model จำแนก แล้ว inner intent router จำแนกซ้ำ แล้ว casual composer เขียนคำตอบ
- text expense/reimbursement แม้ไม่มี ERP tool call ก็ยังเสีย outer router 6–9 วินาทีจาก prompt/provider path
- loading-on-accept และ latency lanes ที่ implement ไว้ยัง default-off ใน UAT
- capture execution ไม่มี stage timing ของตัวเอง จึงเห็นเวลาที่เหลือเป็นก้อนเดียว

ปัญหาหลักคือ serial waterfall ไม่ใช่ความยากของคำว่า “สวัสดี” หรือการเขียนฐานข้อมูล

## 5. Product decision และลำดับ release

Product decision เดิมวันที่ 2026-07-26 ระบุว่า LINE ไม่สร้าง reimbursement claim ดังนั้น release แรกของ
เอกสารนี้ต้องรักษา boundary เดิม:

> LINE เข้าใจว่าเป็นคำขอเบิกและส่ง reimbursement handoff card ไปเว็บ แต่ยังไม่สร้าง claim และห้ามส่ง
> เข้า expense capture โดยปริยาย

เฟสถัดไปเสนอ product amendment แบบ DRAFT-only:

> LINE สร้างได้เฉพาะ `ReimbursementRequest` สถานะ `DRAFT` เมื่อผู้ใช้ขอเบิกอย่างชัดเจนและข้อมูลครบ
> เท่านั้น ห้าม submit, approve, reject, finance-review, pay, post ledger หรือออกเลขเอกสารผ่าน LINE

AI ทำหน้าที่จำแนก intent และเสนอค่าที่ grounded เท่านั้น ส่วน source-module use case ทำ permission,
branch scope, entitlement, validation, idempotency และ draft creation ผู้ใช้ตรวจและส่งอนุมัติในเว็บ

ถ้าไม่มี owner GO ให้ระบบคง handoff-only ถาวร ผลเสียคือผู้ใช้ต้องกรอกข้อมูลซ้ำในเว็บ แต่ปลอดภัยกว่า
สร้าง domain record ผิดหรือข้าม product boundary

## 6. Target flow

```text
LINE webhook
  -> verify signature / durable accept / legal & identity gates
  -> loading acknowledgement (1:1, best effort)
  -> 1,000 ms debounce candidate + per-chat serialization
  -> deterministic literal/safety gates
  -> one semantic intake plan
       -> exact standalone casual lane
       -> expense note capture
       -> reimbursement request handoff / optional draft capture
       -> simple business read
       -> full agentic / media / clarify
  -> source-module deterministic authority
  -> persisted reply/audit/ledger state
  -> trusted Flex/text renderer
  -> LINE delivery
```

## 7. Semantic intent contract

### 7.1 ผล semantic สามทางและ intent ใหม่

ก่อนเลือก source module ต้องแยกผลเป็น `BUSINESS_EXPENSE`, `REIMBURSEMENT_CLAIM` หรือ `AMBIGUOUS`

เพิ่ม `REIMBURSEMENT_REQUEST_START` ใน `LineIntakeRouteIntent` และ parser membership ทุก boundary

route plan ต้อง encode สอง field แบบ bounded ชัดเจน ห้ามอนุมานภายหลังจากชื่อ intent:

- `semanticOutcome: 'BUSINESS_EXPENSE' | 'REIMBURSEMENT_CLAIM' | 'AMBIGUOUS'`
- `fundingSource: 'COMPANY_PAID' | 'EMPLOYEE_PAID' | 'UNKNOWN'`

`REIMBURSEMENT_REQUEST_START` ใช้ได้ทั้ง claim และห้อง clarify แต่ `AMBIGUOUS` หรือ
`fundingSource='UNKNOWN'` เป็น deterministic mutation veto เสมอ optional draft ทำได้เฉพาะเมื่อ source
module ยืนยัน `REIMBURSEMENT_CLAIM` + `EMPLOYEE_PAID` แล้วเท่านั้น

ความหมาย: ผู้ใช้ต้องการเบิกคืนเงินจากบริษัทสำหรับค่าใช้จ่ายที่ตนสำรองจ่ายหรือกำลังยื่นเป็นคำขอเบิก
ไม่ใช่เพียงถามสถานะ ไม่ใช่บันทึกเจ้าหนี้/ค่าใช้จ่ายบริษัท และไม่ใช่เบิกสินค้าออกจากสต็อก

- strong claim: `ฉันสำรองจ่าย`, `ขอเบิกคืน`, `ขอเบิกค่า...` -> reimbursement room
- strong business expense: `บริษัทจ่าย`, `ลงค่าใช้จ่ายบริษัท`, `บันทึกค่าใช้จ่าย` -> expense room
- bare `เบิกค่า...` ที่ยังไม่รู้ผู้จ่าย -> reimbursement handoff/clarify room แต่ **zero write** จนยืนยัน
- `AMBIGUOUS` ต้องถามว่าผู้ใช้สำรองจ่ายเพื่อขอคืน หรือเป็นค่าใช้จ่ายที่บริษัทจ่าย ห้าม default เป็น expense

เพิ่ม bounded `reimbursementHints` แยกจาก `captureHints` อย่างน้อย:

- `description`
- `businessPurpose`
- `amount`
- `incurredDate`
- `categoryKey` จาก allowlist ของ reimbursement
- `reason` ที่ grounded สำหรับ header ของ claim
- `confidence`
- `missingFields: ('fundingSource' | 'amount' | 'description' | 'purpose' | 'incurredDate' |
  'categoryKey' | 'reason')[]`

แยก type เพราะ expense category id และ reimbursement category key เป็นคนละ authority

### 7.2 เส้นแบ่งที่ต้องผ่าน eval

| ข้อความ | intent ที่ถูก | mutation |
| --- | --- | --- |
| `ค่าวินไปพบลูกค้า 60 บาท` | `EXPENSE_DOCUMENT_CAPTURE` | expense draft |
| `ช่วยบันทึกค่าวินไปพบลูกค้า 60 บาท` | `EXPENSE_DOCUMENT_CAPTURE` | expense draft |
| `ขอเบิกค่าวิน 60 บาท ไปพบลูกค้า` | `REIMBURSEMENT_REQUEST_START` | handoff; draft เมื่อเปิด amendment และครบ |
| `สำรองจ่ายค่าวินไป 60 บาท ขอเบิกคืน` | `REIMBURSEMENT_REQUEST_START` | handoff; draft เมื่อเปิด amendment และครบ |
| `เบิกค่าวิน 60 บาท ไปพบลูกค้า` | `REIMBURSEMENT_REQUEST_START` + payer clarify | zero write จนยืนยัน |
| `ขอดูใบเบิกที่ค้าง` | `BUSINESS_READ_QUESTION` | ไม่มี write |
| `ขอเบิกได้ไหม` | help/clarify | ไม่มี write |
| `ไม่ต้องเบิกค่าวินแล้ว` | negation/cancel guidance | ห้ามสร้าง |
| `ขอเบิกเงินล่วงหน้า` | unsupported/clarify | ห้ามสร้าง เพราะ advance ยังไม่มี contract |
| `เบิกของจากสต็อก 2 กล่อง` | inventory/clarify | ห้ามสร้าง reimbursement/expense |
| `ทำใบสำคัญรับเงิน` | document-specific route/clarify | ห้ามสร้าง reimbursement/expense |

ข้อความมีคำทักทายร่วมกับธุรกิจให้ธุรกิจชนะ เช่น `สวัสดี ขอเบิกค่าวิน 60 บาท` ห้ามเข้ casual lane

### 7.3 Confidence และ fallback

- `ROUTED` และ confidence >= `INTAKE_MIN_ACTION_CONFIDENCE` (`0.6`) จึงส่ง intent เข้าสู่ dispatcher
- ต่ำกว่าเกณฑ์ให้ถามหนึ่งคำถามและผูก `clarifyForIntent`; ห้ามเดา
- provider ล่ม/invalid output ใช้ deterministic fallback ได้เฉพาะ handoff/clarify ที่ไม่สร้าง record
- fallback ใดที่แยก expense กับ reimbursement ไม่ได้ต้องถาม ไม่ใช่ส่งเข้า expense โดยปริยาย
- route ไม่มี authority; source use case rechecks access และทุก grounded value

## 8. Completeness และ multi-turn state

### 8.1 Expense completeness

final gate ต้องถือว่าครบเมื่อ:

- มีจำนวนเงินบวก exactly one deterministic candidate ที่ตรงกับ model-selected amount; และ
- expense note มี `description` หรือ `businessPurpose` ที่ grounded; reimbursement write ต้องมีทั้ง
  description และ purpose ตาม source-module contract

active category suggestion ห้ามใช้แทน purpose เพราะ “จัดหมวดได้” ไม่ได้แปลว่า “รู้ว่าใช้ทำอะไร”

model amount ที่ไม่ตรง candidate, หลาย amount ที่ยังไม่รู้ว่าอันใดเป็นยอดรายการ หรือ purpose ที่ model
แต่งขึ้นต้องถูกปฏิเสธก่อน write

กติกานี้เปิดใช้งานได้หลัง semantic primary guard เท่านั้น: route ต้องยืนยัน
`semanticOutcome='BUSINESS_EXPENSE'` + `fundingSource='COMPANY_PAID'` ก่อนจึงใช้ `businessPurpose`
ผ่าน expense completeness ได้ `REIMBURSEMENT_CLAIM`, `AMBIGUOUS` และ `UNKNOWN` ต้องถูก veto ออกจาก
expense mutation ก่อนเสมอ ห้าม deploy completeness expansion เดี่ยว ๆ กับ router ปัจจุบัน

### 8.2 Typed incomplete result

`LineTextExpenseCaptureIncompleteError` และ reimbursement equivalent ต้องส่งข้อมูล bounded:

- `acceptedFields`
- `missingFields: ('fundingSource' | 'amount' | 'description' | 'purpose' | 'incurredDate' |
  'categoryKey' | 'reason')[]`
- `conflictingFields`
- ห้ามใส่ raw conversation หรือ PII เพิ่มใน error/log

dispatcher สร้างคำถามตามฟิลด์จริง:

- ขาด amount เท่านั้น: ถามยอด
- ขาด purpose/description เท่านั้น: ถามรายการ/วัตถุประสงค์
- ขาด date สำหรับ reimbursement: ถามวันที่ และยอมรับคำตอบ `วันนี้` ผ่าน deterministic Thai-date parser
- ขาดหลาย field: ถามรวมหนึ่งข้อความสั้น แต่ต้องไม่ขอฟิลด์ที่รับแล้ว

### 8.3 Neutral typed clarification state และ merge rule

financial facts ที่จะถูกนำไป write ห้ามพึ่ง Redis ledger แบบ fail-open เพียงอย่างเดียว ให้เพิ่ม DB-backed
neutral intake state หรือไม่ carry ค่าไปทำ mutationเลย state ต้องมีอย่างน้อย:

- owner binding: `companyId`, `userId`, `chatKeyHash`
- `targetIntent`/semantic result
- `acceptedHints` ที่ผ่าน grounding แล้ว
- `missingFields`/`conflictingFields`
- field provenance จาก original/follow-up
- original event/message hash, version, TTL และ consumed/resolved state

open clarification ใน ledger ส่ง bounded reference ไป state นี้ได้ แต่ไม่เป็น source of truth ของยอดเงิน

กฎ merge:

1. ค่าที่รับแล้วอยู่ต่อจนกว่าจะถูกแก้อย่างชัดเจน
2. follow-up เติมเฉพาะ field ที่ขาดได้
3. ถ้ารอบแรกมี `60` และ follow-up พิมพ์ `200` โดยไม่ได้บอกว่าแก้ยอด ให้ถาม `ยอดเดิม 60 หรือยอดใหม่ 200` และไม่สร้างรายการ
4. `แก้ยอดเป็น 200 บาท` เป็น explicit correction จึงแทน 60 ได้
5. state CAS/consume และ source write ต้อง atomic ใน database transaction เดียว หรือ replay-safe ด้วย unique
   idempotency key; state-store outage ต้อง zero write
6. คำถาม, คำปฏิเสธ และ unrelated turn ไม่ consume clarification ของเดิม

สำหรับ release แรกที่จบด้วย handoff โดยไม่มี source write ให้ persist canonical terminal outcome และ replay
reference ก่อน CAS state จาก `OPEN` เป็น `RESOLVED` ห้ามถือว่า resolved ตอนเริ่มเรียก LINE API การส่งสำเร็จ
หรือ retry เป็น delivery status แยกต่างหาก ถ้า reply token หมดอายุหรือ delivery ล้ม ระบบต้อง replay outcome
เดิมผ่าน safe push/fallback โดยไม่ route ใหม่และไม่ทำ accepted facts สูญหาย

เปิด expense draft conversation flag อย่างเดียวไม่ใช่ fix เพราะจะทำให้ wrong-domain reimbursement กลายเป็น
expense conversation ได้เร็วขึ้น

### 8.4 Single-total service representation

บริการที่แบ่งไม่ได้และมี total เดียว เช่น ค่าวิน/แท็กซี่ ไม่ควรถาม quantity ซ้ำ ถ้า expense schema ต้องมี
`quantity=1` ให้บันทึก provenance เป็น `SYSTEM_SINGLE_TOTAL_REPRESENTATION` ใน AI verification metadata
และห้ามอ้างว่าผู้ใช้เป็นคนบอกค่า 1 กฎนี้ห้ามใช้กับสินค้า/หลายรายการ

## 9. Reimbursement authority

### 9.1 Release แรก: handoff-only

เมื่อได้ `REIMBURSEMENT_REQUEST_START`:

- recheck active linked member, legal acceptance, company/branch create scope, entitlement `reimbursement`
  และ permission `reimbursement.create`
- ถ้ากำกวมถาม payer/source-of-funds หนึ่งคำถาม
- ถ้าชัดและผ่าน authority ทั้งหมด ส่ง reimbursement handoff card ไป `/reimbursements/new`
- CTA ต้องเป็น company-scoped safe URL ที่ไม่มี amount/purpose/financial query params
- ถ้า authority ไม่ผ่าน ให้ตอบ unavailable/permission copy แบบ deterministic ไม่มี CTA และไม่มี financial
  query params ห้ามเปิด route ที่ผู้ใช้เข้าไม่ได้
- mutation count ต้องเป็นศูนย์ และห้ามเรียก expense capture

### 9.2 Optional DRAFT-only หลัง owner GO

เมื่อ `REIMBURSEMENT_REQUEST_START` ครบและ product amendment ได้รับอนุมัติ:

- ต้องเป็น linked active member ใน personal chat
- ต้องผ่าน legal acceptance, company/branch scope และ entitlement `reimbursement`
- ต้องมี `reimbursement.create`
- เรียก `CreateReimbursementDraftUseCase` ผ่าน API/source module; AI Gateway ห้ามแตะ repository
- สร้างสถานะ `DRAFT` เท่านั้น
- ใช้หนึ่ง line จาก grounded description, purpose, category, amount และ incurred date
- ห้ามแต่ง missing-receipt reason; draft เก็บ receipt requirement แล้วเว็บเป็นที่แนบหลักฐาน/ระบุเหตุผล
- ใช้ idempotency key ที่ derive จาก company + LINE event/message id แบบ hash และบังคับ unique ต่อ company
- audit `reimbursement.request.create` ต้องระบุ source `LINE` แบบ bounded
- ห้ามสร้าง `ExpenseRecord` ในขั้นนี้; claim projection เกิดตาม lifecycle เดิมเท่านั้น

ก่อนเริ่ม Phase DRAFT ต้อง amend `reimbursement-approval-spec` และ permission matrix แล้ว map ค่าเข้า
`CreateReimbursementRequestInput` แบบ explicit ดังนี้:

- `branchId`: จาก server-verified create scope เท่านั้น
- `title`: omit ได้ หรือใช้ grounded description แบบ bounded; ห้าม model แต่ง
- `reason`: grounded `businessPurpose`/explicit claim reason; ถ้าไม่มีต้องถาม
- `currency`: omit เพื่อใช้ company policy เว้นแต่ source authority รองรับค่าที่ตรวจแล้ว
- `missingReceiptReason`: ใส่เฉพาะคำตอบ explicit ที่ grounded; มิฉะนั้น omit
- `lines[0].lineNo`: system value `1`
- `lines[0].incurredDate`, `description`, `purpose`, `amount`: grounded + deterministic validation
- `lines[0].categoryKey`: ต้องอยู่ใน active reimbursement category allowlist ณ เวลา create
- `categoryLabel`, `attachmentId`, `linkedExpenseId`: server-owned/ownership-verified เท่านั้น

`AMBIGUOUS`, `UNKNOWN`, inactive category หรือ field ที่ input บังคับแต่ยังขาดต้อง zero write

ถ้าขาด field required ให้เก็บ clarification state และยังไม่สร้าง domain record

## 10. Response presentation

### 10.1 Terminal success

ใช้ renderer เดิมเป็น primitive แต่เพิ่ม dedicated server-owned card contracts; ห้าม parse/accept raw model
Flex JSON และห้ามนำ long canonical reply ไปครอบ generic 1,200-char body ตรง ๆ

- clarification choice card: ใช้เมื่อเลือก business expense vs reimbursement; zero write
- Expense draft card: title `ร่างค่าใช้จ่าย` แสดงยอด, รายการ/วัตถุประสงค์, หมวด, สถานะ และปุ่มไป `/expenses/:id`
- Reimbursement handoff card: title `เริ่มคำขอเบิก` แสดงค่าที่เข้าใจและปุ่มไป `/reimbursements/new`
- Reimbursement draft card (optional amendment): title `ร่างคำขอเบิก` แสดงยอด, รายการ, วันที่,
  สถานะ `ร่าง/ยังไม่ส่ง` และปุ่ม `ตรวจสอบและส่งอนุมัติ` ไป object ที่ถูกต้อง
- persisted `replyText` และ correction/conversation lookup ยังเป็นข้อความ canonical เดิม
- safe tenant-link validation, quick reply permission filter และ LINE limits ใช้ของเดิม

`deliverCompletedReplies()` ต้อง render terminal summary เป็น Flex แม้มีเพียงหนึ่ง reply; multi-part journey
ส่งข้อความรายละเอียดได้ แต่ส่วนสุดท้ายต้องเป็น Flex card และจำนวนรวมไม่เกิน LINE limit

### 10.2 Clarification และ error

- clarification เป็น text สั้นเพื่อให้ตอบต่อได้เร็ว
- permission/feature disabled ใช้ deterministic copy และไม่มี model call เพิ่มหลัง intent พร้อม
- card body ต้องไม่ตัดข้อมูลสำคัญเพราะ generic renderer จำกัด 1,200 ตัวอักษร; expense/reimbursement summary
  ต้องเป็น structured concise card ไม่ใช่นำ long reply มาครอบตรง ๆ; ข้อความ/คำถามที่ยาวต้องส่งเป็น
  lossless text parts แล้วปิดท้ายด้วย summary card ห้าม silent truncation

## 11. Latency lanes และ model-call budget

### 11.1 การเปลี่ยนที่ใช้ของเดิมก่อน

- เปิด trace และ loading-on-accept ตาม spec เดิม
- ใช้ 1,000 ms เป็น debounce experiment candidate หลัก, 1,500 ms fallback, 2,500 ms control
- ใช้ fused prepared plan ที่ implement default-off แล้ว ไม่สร้าง router ใหม่
- เพิ่ม `capture_execute`, `reimbursement_execute`, `render`, `line_delivery` stage timing

### 11.2 Exact standalone casual lane

หลัง signature/legal/identity/company/open-clarification/attachment/crisis/privacy/mixed-intent gates เท่านั้น:

- exact standalone greeting ที่อยู่ใน versioned allowlist เช่น `สวัสดี` ตอบ deterministic Nong Mangmee copy
- ห้ามทำก่อน debounce หรือเมื่อมี second bubble ธุรกิจใน turn เดียวกัน
- ห้ามขยายเป็นคลัง regex เพื่อเข้าใจ business language
- ข้อความ casual ที่ไม่ exact ใช้ fused classification + existing casual composer

### 11.3 Text router performance

- แยก cacheable static prefix ออกจาก dynamic data
- text-only prompt ไม่ต้องแบก media/OCR schema ที่ไม่เกี่ยว แต่ต้องคง intent boundaries, active state,
  active categories และ grounding guards ที่ text path ต้องใช้
- จำกัด output schema/max tokens ให้พอดีกับ route plan
- reuse provider client ตาม region/credential boundary
- prompt change ทุกครั้งต้องผ่าน protected configured-provider corpus ก่อนเปิด

### 11.4 Budget เป้าหมาย

| Journey | ปัจจุบัน | เป้าหมาย |
| --- | ---: | ---: |
| exact `สวัสดี` | 3 model calls | 0 หลัง deterministic gates |
| casual ทั่วไป | 3 | <=2 (fused route + composer) |
| text expense/reimbursement initial | 1 router call | <=1 intake model; no Gateway/composer |
| exact choice/labeled continuation | อาจเรียก routerซ้ำ | 0 model |
| free-text continuation | 1 router | <=1 extraction modelเมื่อ deterministic parserไม่พอ |
| eligible simple business read | หลาย serial calls | 1 ตาม prepared simple-read lane |
| permission/feature terminal ที่รู้ล่วงหน้า | อาจเสีย router | 0 เมื่อ authority รู้ก่อน semantic routing |
| complex/multi-intent/media | หลาย call | ไม่ลด reasoning โดยไม่มี eval proof |

แถว exact `สวัสดี` implement แล้วหลัง `LINE_AI_EXACT_GREETING_ENABLED` (default-off): เมื่อเปิด lane นี้
ข้อความที่ตรง allowlist ทั้งข้อความจะได้ 0 model call (ไม่แตะ intake router/Gateway/composer) จาก 3 calls เดิม
ส่วนข้อความที่มี greeting ปนธุรกิจ — รวมกรณีที่ขึ้นบรรทัดใหม่ เช่น `สวัสดี\nเบิกค่าโดยสารหน่อย` — ยังวิ่ง
semantic route ปกติทุกครั้ง แถวอื่นในตารางยังไม่ implement

## 12. SLO และข้อจำกัดที่ต้องสื่อสารตรงไปตรงมา

| Journey | เป้าหมายหลัง rollout |
| --- | ---: |
| LINE loading request accepted p95 | <=1.0s จาก durable acceptance |
| exact standalone greeting final p50 / p95 | <=1.5s / <=2.5s |
| field-specific clarification final p50 / p95 | <=2.5s / <=6.0s |
| text expense/reimbursement final p50 / p95 | <=3.5s / <=8.0s |
| simple business read final p50 / p95 | <=3.0s / <=8.0s |
| media capture final p50 / p95 | <=8.0s / <=15.0s |

เมื่อยังรอ debounce 1,000 ms อยู่ การรับประกัน final answer ต่ำกว่า 1 วินาทีทุกเคสเป็นไปไม่ได้ เป้าหมาย
ต่ำกว่า 1 วินาทีจึงเป็น visible acknowledgement ส่วน final sub-second ทำได้เฉพาะ cached/precomputed
หรือ journey ที่มี early-dispatch contract แยกและผ่าน split-turn eval แล้ว

## 13. Observability และ cost

ต่อหนึ่ง accepted intent ต้องมองเห็นโดยไม่ log raw message/LINE id:

- intent, lane, route confidence และ fallback reason
- buffer, router, execute, render, persistence, delivery durations
- model/provider/model id, calls, input/output/cache tokens และ cost
- clarification `missingFields`/`conflictingFields` แบบ enum เท่านั้น
- expense-vs-reimbursement shadow agreement และผล adjudication
- object type/id hash ที่สร้าง, idempotent replay และ duplicate-prevented count
- Flex/text delivery kind และ LINE failure class

เป้าหมาย cost คือ model calls ต่อ completed intent ลดลง; ห้ามใช้ model เล็กลงก่อน call-count/prompt win
ผ่าน quality gate ของ model ปัจจุบัน

## 14. Eval dataset contract

ขยาย runner/corpus เดิม ไม่สร้าง runner ใหม่ และ freeze gold labels ก่อน shadow

### 14.1 Semantic routing อย่างน้อย 48 rows

- reimbursement start ไทย 10 / English 4
- ordinary expense negative 8
- reimbursement read/status 4
- question vs command 4
- negation/cancel 4
- stock withdrawal/advance/payment voucher/substitute receipt อย่างละ 3–4
- mixed casual+business, typo, colloquial, multi-bubble อย่างน้อย 6

frozen artifact: `LINE_AI_SEMANTIC_COVERAGE_CASES` ใน `scripts/line-ai-substitute-routing.corpus.ts`
(ชุดเดียวกับ substitute corpus, runner เดิม) และ `SEMANTIC_COVERAGE_MINIMUMS` เป็นเพดานล่างที่ integrity
spec พิสูจน์เชิงกลไก การ freeze นี้เป็น structural evidence เท่านั้น ไม่ใช่ route accuracy หรือหลักฐาน mutation

### 14.2 Completeness/merge อย่างน้อย 20 rows

- exact UAT 50/60 บาท + `ไปพบลูกค้า`
- purpose อยู่ใน `businessPurpose` อย่างเดียว
- amount-only, purpose-only, date-only missing
- ambiguous two amounts
- original 60 + follow-up purpose only -> release นี้รับ purpose แต่ถาม amount ใหม่และ zero-write;
  เป้าหมายหลังมี DB-backed neutral state จึงค่อยเก็บ 60 ได้
- original 60 + follow-up 200 แบบไม่บอกว่าแก้ -> conflict clarify
- original 60 + `แก้ยอดเป็น 200` -> รับว่า 200 เป็นยอดที่แก้ แต่ release นี้ยังถาม purpose ใหม่และ
  zero-write เพราะ purpose เดิมใน Redis ไม่ใช่ mutation authority
- model amount mismatch, invented purpose/category, unrelated answer, redelivery

frozen artifact: `LINE_AI_COMPLETENESS_MERGE_MANIFEST` ใน `scripts/line-ai-latency-autonomy.corpus.ts`
(22 rows, id ไม่ซ้ำ, ไม่มี identity ของผู้ใช้) แต่ละ row พิน message ปัจจุบัน, grounding segment ที่ resolve
มาแล้ว, capture-hint shape, `semanticBusinessExpenseConfirmed` และผล accepted/missing/conflicting +
`writeAllowed` (= `assessLineTextExpenseCapture(...).eligible`)

integrity spec **เรียก `assessLineTextExpenseCapture` จริง** กับทุก row ที่ `lane='expense'` (20 rows) โดยใช้
active-category map ที่ freeze ไว้ ไม่มี DB/network แล้วเทียบครบทั้งสี่ค่า ส่วน 2 rows ที่ `lane='reimbursement'`
ถูกกันออกอย่างชัดเจนเพราะ claim lane ยังไม่มี deterministic assessor จึงพิสูจน์ได้เพียง zero-write

กติกาที่ยังพิสูจน์เชิงกลไกเหมือนเดิม: field ทุกตัวอยู่ใน enum, conflict เป็น zero-write, ข้อความรูปแบบ
“เบิก/สำรองจ่าย” ไม่เคย license write และ input เดียวกันให้ verdict เดียวกัน

สิ่งที่ manifest สะท้อนตามพฤติกรรมจริงของ release นี้:

- row ที่ `semanticBusinessExpenseConfirmed=false` คือ default-off lane ซึ่งคืนค่า legacy boolean และ
  **ไม่มี typed field เลย** สอง UAT message (`เบิก...`) เป็น route-veto row จึง zero-write และยังไม่ได้แก้
  อาการถามยอดซ้ำ การแก้อยู่หลัง guard บน text ที่บอกว่าบริษัทจ่าย
- Redis grounding เป็น veto-only: follow-up ที่มีแต่ purpose ยังต้องถามยอดใหม่ และ explicit correction
  (`แก้ยอดเป็น 200 บาท`) เคลียร์ conflict ได้แต่ยัง zero-write เพราะรายการ/วัตถุประสงค์ไม่ได้อยู่ในข้อความนี้

manifest นี้ยังไม่ใช่หลักฐาน mutation, provider accuracy หรือ UAT

### 14.3 Presentation/permission อย่างน้อย 16 rows

- expense draft/reimbursement handoff/optional draft เป็น Flex และ safe tenant URL ถูก object type
- clarification choice รองรับ text fallback และ zero write
- no permission, feature off, branch denied, legal pending ไม่มี write
- state-store outage, stale/expired/cross-user/chat/company และ duplicate webhook ไม่มี write
- long >1,200/>4,800 characters ไม่สูญคำถาม/required fields; Flex failure fallback เป็น text

frozen artifact: `LINE_AI_PRESENTATION_PERMISSION_MANIFEST` ใน `scripts/line-ai-latency-autonomy.corpus.ts`
(21 rows) แต่ละ row พิน journey, presentation kind, authority condition, CTA policy,
`expectedDomainWriteCount`, route/model constraint และ `evidenceStatus`

`evidenceStatus` มีสองค่าเท่านั้นและ integrity spec นับ/รายงานทั้งสองฝั่ง: `implemented_fixture` 20 rows
(terminal Flex เดี่ยว/multipart, payer clarify card, clarify-only ไม่มี CTA, handoff tenant path ที่ไม่มี
query/hash, permission/entitlement/branch denied, legal pending, duplicate webhook, expired reply-token push,
long reply >1,200/>4,800 แบบ lossless, DB-backed state 4 rows: outage/stale-expired/cross-user/cross-chat-
or-company, durable delivery 2 rows: persisted terminal replay, Flex failure fallback และ expense draft card
เฉพาะทาง §10.1) และ `required_gap` 1 row (optional reimbursement draft card ที่ยัง park รอ owner GO)
ห้าม mark gap เป็น implemented manifest freeze gold expectation ไม่ใช่หลักฐานว่า runtime ทำได้แล้ว

DB-backed state 4 rows ที่ย้ายมาเป็น `implemented_fixture` หมายถึง **code path + spec มีจริงแล้ว** เท่านั้น:
`LineIntakeState` (migration `20260826120000_line_intake_state`, partial unique index บน OPEN row) และ
`LineIntakeStateRepository` ที่ fail **closed** ตรงข้ามกับ Redis ledger ที่ fail open ยังไม่ใช่หลักฐานว่า lane
เปิดใช้งานแล้ว: `LINE_AI_INTAKE_STATE_MODE` default `off` และยังไม่มี provider replay หรือ UAT evidence
สำหรับสี่ row นี้ (`note` ของแต่ละ row ต้องเขียน `DEFAULT OFF` ไว้ และ integrity spec บังคับข้อนี้)

long reply สองแถวนั้นมี fixture จริงหลัง `LINE_AI_MULTIPART_TERMINAL_FLEX_ENABLED` (default-off): terminal ที่
ยาวเกิน 1,200 ส่งเป็น text เต็มแล้วปิดท้ายด้วย concise card, กรณี 4,900 code points พิสูจน์ว่าเกิน 4,800 ไม่หาย
สักตัวและ card ยังต่อท้ายได้เมื่อยังเหลือ message slot, ที่เพดาน 5 messages เลือก text ครบทุกส่วนแทน card และ
part ที่เกิน 5,000 ตัวอักษรถูก **ปฏิเสธ** (`LINE_REPLY_TEXT_PART_TOO_LONG`) ไม่ใช่ตัดเงียบ release นี้ยังไม่ได้
แตก part เดียวที่ยาวเกิน 5,000 ออกเป็นหลาย part

durable delivery 2 rows ที่ย้ายมาเป็น `implemented_fixture` หมายถึง **code path + spec มีจริงแล้ว** เท่านั้น
เหมือน DB-backed state 4 rows:

- `LineTurnOutcome` (migration `20260826140000_line_turn_outcome`, `webhookEventId` unique + FK cascade บน
  `LineWebhookEventLog`) เก็บ **rendered LINE message array จริง** ก่อน send attempt แรก ไม่ใช่ `replyPreview`
  240 ตัวอักษรของ `AiTurn` การเขียน fail **closed**: ถ้าเก็บไม่ได้ให้ mark `delivery_pending`
  (`LINE_OUTCOME_NOT_RECORDED`) แทนการส่งโดยไม่มี record; `deliveredAt` เป็น delivery status แยกตาม §8.3 และ
  orphan sweep push ของเดิมกลับไปโดย **ไม่ route ใหม่** (`LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED` default off)
- Flex failure fallback: adapter แยก `failed_flex` (LINE 400 ที่ body อ้าง `/messages/` และ payload มี flex) ออก
  จาก `failed_token` แบบ refinement เท่านั้น แล้ว retry **หนึ่งครั้ง** ด้วย `altText` ของการ์ดเอง ไม่แต่งข้อความใหม่
  และไม่เพิ่ม model call (`LINE_AI_FLEX_TEXT_FALLBACK_ENABLED` default off) เพดานที่รู้ตัว: `altText` คือ
  `preview(text, 400)` ดังนั้น card body ที่ยาวเกิน 400 จะ fallback เป็น preview ที่มี `…` กำกับ ยังไม่ครบ
  lossless ตาม §10.2 ถ้าพบเคสจริงที่เนื้อหาหาย ให้เพิ่ม canonical-text field ที่ card builder

ทั้งสอง row ยังไม่มี provider replay หรือ UAT evidence (`note` ของแต่ละ row ต้องเขียน `DEFAULT OFF` ไว้ และ
integrity spec บังคับข้อนี้)

`expense-draft-structured-card` ที่ย้ายมาเป็น `implemented_fixture` หมายถึง **code path + spec มีจริงแล้ว**
เท่านั้น เหมือนสอง group ข้างบน: `buildExpenseDraftCardMessage()` ใน
`apps/api/src/modules/line-ai/domain/logic/line-business-card.logic.ts` render card title `ร่างค่าใช้จ่าย`
เป็น structured rows (`ยอดรวม`, `รายการ`, `หมวดหมู่`, `สถานะ`) แทนการนำ canonical reply มาครอบ generic body
1,200 ตัวอักษร (§10.2) กติกาสำคัญ:

- row ที่ capture **ไม่ได้ ground** จะถูก **ตัดทิ้ง** ไม่ใช่ใส่ placeholder `ยังไม่ระบุ` ราวกับเป็นข้อเท็จจริง
  ค่าเงินใช้กติกาเดียวกับ `formatPaypersReply` (`toMoney4` + `th-TH` 2 ตำแหน่ง) และ status เป็น deterministic
  server-owned copy ไม่มี model text
- ถ้าไม่มี row ใด ground เลย card จะ degrade กลับเป็น generic text card ไม่ส่ง frame เปล่า
- `altText` ยังเป็น **canonical reply text** เดิม (เพดาน `preview(text, 400)` เดียวกับ card อื่นทุกใบ ตัดเมื่อไร
  มี `…` กำกับเสมอ) เพื่อให้ chat preview และ Flex→text fallback ของ §8.3 อ่านได้เป็นข้อความชุดเดียวกับ text reply
- CTA เป็น tenant path `/companies/{companyId}/expenses/{expenseId}` เท่านั้น ไม่มี query/hash/financial param
  base ที่ไม่น่าเชื่อถือหรือ id ที่ประกอบ tenant path ไม่ได้ทำให้ **ปุ่มหาย** ไม่ใช่เดา URL

lane นี้ใช้ flag เดิม `LINE_AI_MULTIPART_TERMINAL_FLEX_ENABLED` (default `false`) ไม่ได้เพิ่ม flag ใหม่:
flag นี้ gate อยู่แล้วว่า terminal part เป็น Flex หรือ text ล้วน การเลือก card เฉพาะทาง vs generic card เกิด
**ข้างใน** สาขา flag-on นั้น ดังนั้น flag-off ยังเป็น legacy all-text shape แบบ byte-identical
(pinned ด้วย snapshot test) ยังไม่มี provider replay หรือ UAT evidence และ `note` ของ row ต้องเขียน
`DEFAULT OFF` ไว้ (integrity spec บังคับข้อนี้)

wiring ปัจจุบันครอบ expense capture terminal ที่ **สร้าง draft จริง** สองทาง (text-note capture และ media
capture ที่มี receipt draft) ส่วน terminal อื่นที่ไม่มี grounded draft ยังใช้ generic card ตามเดิม

### 14.4 Latency/protected journeys

- เพิ่ม exact UAT messages ลง `scripts/line-ai-latency-autonomy.corpus.ts`
- update reimbursement negatives ใน `scripts/line-ai-substitute-routing.corpus.ts` ให้ intent ใหม่ถูกต้อง
- รักษา protected set เดิมทั้งหมด; การแก้ prompt ห้ามทำ casual, substitute, correction, media,
  permission, crisis/privacy หรือ business read ถอยหลัง
- configured-provider route accuracy และ deterministic mutation/result fixtures ต้อง 100% สำหรับ fixed facts
- casual blind pairwise quality ใช้เกณฑ์ใน latency/autonomy spec; no-regression ต่อภาษา

## 15. Rollout

1. Trace-only baseline, freeze gold eval และเพิ่ม missing execute stages
2. สร้าง typed state/formatter/card contract แบบ default-off; ยังห้ามเปิด `businessPurpose` completeness
3. Reimbursement intent shadow อย่างน้อย 7 วันและ 500 adjudicated turns ตาม denominator ด้านล่าง
4. สร้างและทดสอบ handoff/clarification card แล้วเปิด semantic primary เป็น `clarify_only` canary เพื่อกัน
   reimbursement/ambiguous ออกจาก expense mutation
5. เมื่อ primary guard ผ่าน จึงเปิด grounded `businessPurpose` completeness สำหรับ
   `BUSINESS_EXPENSE + COMPANY_PAID` และเปิด expense terminal card เป็น canary แยก
6. เปิด handoff-only primary หลัง permission/card/redelivery acceptance ผ่าน โดยยัง freeze debounce
7. หลัง owner อนุมัติ chat-created draft, amend parent spec/permission matrix และ idempotency tests ผ่าน
   จึงเปิด reimbursement DRAFT
   5% -> 25% -> 100%
8. เปิด loading-on-accept และตัดสิน 1,000/1,500/2,500 ms ตาม experiment เดิม
9. เปิด fused casual 3->2 แล้ว exact greeting 0-call ทีละ lane
10. เปิด prepared simple-read families ทีละ family
11. media/provider reuse/prompt tuning แยก canary; ห้ามรวมหลาย latency inference ในหน้าต่างเดียว

shadow GO denominator ต้องครบทุกข้อ: อย่างน้อย 7 วัน, 500 turns ที่ human adjudicate แล้ว, Thai >= 350,
English >= 75, mixed/noisy >= 75 และ critical negative แต่ละกลุ่ม (ordinary expense, read/question,
negation, stock/advance, substitute/document flow) >= 60 รวม negative อย่างน้อย 300 ต้องไม่พบ wrong-domain
critical false positive และ one-sided 95% upper confidence bound ของ critical false-positive rate <= 1%
fixed eval/replay ไม่ทดแทน live shadow denominator แต่ต้องผ่าน 100% แยกต่างหาก

Rollback ของ semantic/reimbursement primary ต้องกลับ `clarify_only` ไม่ใช่ legacy ambiguous capture และ
ไม่ย้อนหรือแปลง draft ที่สร้างแล้ว
Rollback presentation กลับ text ได้โดยไม่แตะ persisted business state

## 16. Acceptance criteria

- [ ] `ขอเบิกค่ารถวิน 60 บาท ไปพบลูกค้า` และ bare `เบิกค่ารถ...` ไม่สร้าง `ExpenseRecord`
- [ ] เมื่อข้อมูล reimbursement ยังขาดวันที่ ระบบถามเฉพาะวันที่และจำ amount/description/purpose เดิม
- [ ] release แรกส่ง reimbursement handoff card และสร้างศูนย์ record
- [ ] `AMBIGUOUS`/`UNKNOWN` veto expense และ reimbursement mutation ทุกครั้ง
- [ ] ผู้ไม่มี active membership/entitlement/`reimbursement.create` ไม่เห็น CTA หรือ financial query params
- [ ] เมื่อ owner อนุมัติ amendment และข้อมูลครบ ระบบสร้าง `ReimbursementRequest(DRAFT)` หนึ่งใบเท่านั้น
- [ ] redelivery/retry สร้าง draft เดิม ไม่สร้างซ้ำ
- [ ] `ค่าวิน 60 บาท ไปพบลูกค้า` ที่ไม่มี reimbursement intent ยังสร้าง expense draft ได้
- [ ] purpose ที่ grounded ใน `businessPurpose` ผ่าน completeness gate
- [ ] completeness expansion เปิดหลัง semantic primary guard เท่านั้นและรับเฉพาะ
  `BUSINESS_EXPENSE + COMPANY_PAID`
- [ ] ระบบไม่ถามยอดซ้ำเมื่อยอดผ่าน validation แล้ว
- [ ] conflicting 60/200 ไม่ถูกเลือกเงียบ ๆ
- [ ] handoff terminal persist ก่อน delivery; reply-token failure replay outcome เดิมโดยไม่ route ใหม่
- [ ] success response เป็น trusted Flex card และลิงก์เข้า domain object ที่ถูกต้อง
- [ ] question/negation/permission/feature/branch/legal cases สร้างศูนย์ record
- [ ] greeting/casual/capture/simple-read call budgets ผ่าน และ protected corpus ไม่ถอยหลัง
- [ ] UAT บันทึก p50/p95, model calls, cost และ result accuracy ก่อน production

## 17. Non-goals

- LINE submit/approve/reject/pay/post reimbursement
- เบิกเงินล่วงหน้า, petty-cash advance หรือ inventory withdrawal
- auto-create substitute receipt จาก claim ที่ไม่มีใบเสร็จ
- ใช้ regex synonym library เข้าใจ business intent
- raw model-generated Flex JSON
- ลด model tier เพื่อให้เร็วโดยไม่มี blind eval
- เปลี่ยน reimbursement approval/payment/projection lifecycle

## 18. คำถามที่ต้องตัดสินก่อน implementation Phase reimbursement write

- เจ้าของอนุมัติให้ LINE สร้าง `ReimbursementRequest(DRAFT)` ตาม boundary ใน §5 หรือให้จบที่
  handoff-only card ตาม product decision เดิม?

คำแนะนำร่วมหลัง review: **ส่ง handoff-only เป็น release แรก** เพื่อปิด wrong-domain write ก่อน แล้วพิจารณา
DRAFT-only หลัง typed DB state, idempotency unique, permission/security tests และ UAT ผ่าน การเลือกนี้รักษา
ความฉลาดของ intent โดยไม่รีบขยาย mutation boundary
