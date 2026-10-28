# Company OCR Governance Spec (Platform Admin)

เพิ่มเติม 2026-09-17: [spec รวม NOGROUP / budget / intake cost](line-ai-ledger-lifecycle-remediation-spec-th.md) §9–12 กำหนดข้อความเมื่อเงิน AI เต็มและเพดานเงิน CHAT/OCR แยกตาม owner decision งานใหม่นี้ยังไม่ implement/activate และไม่เปลี่ยนความหมาย OCR count quota, receipt grants, permissions หรือการอัปโหลด/กรอกเองในเอกสารนี้

สำหรับ failure/refund ให้ใช้ amendment [Onboarding/trial receipt fixes — Issue 4](onboarding-trial-receipt-fixes-spec.md): customer read admission ที่ไม่ได้ usable persisted result ต้องคืนตาม exact identity แม้ provider อาจทำงานแล้ว ข้อนี้ supersedes ข้อความ retained failure counts ใน §3.1/§5 ด้านล่าง ส่วนเงินจริงที่เกิดกับ provider ไม่ถูกคืนเพราะ refund จำนวนสิทธิ์ OCR

สถานะ: `IMPLEMENTED / LOCAL VERIFIED`
วันที่: 2026-08-27 (Asia/Bangkok)
Owner: Platform / AI / Finance Operations
ไม่อยู่ใน scope: Subscribe, billing, ราคาแพ็กเกจ และการเก็บเงิน

## 1. ปัญหาที่พิสูจน์จากระบบปัจจุบัน

ระบบมี AI cost budget รายเดือนและ rate limit OCR กลางอยู่แล้ว แต่ยังตอบคำถามของผู้ดูแลไม่ได้ว่า
“บริษัทนี้เปิด OCR อยู่หรือไม่”, “เดือนนี้อ่านได้กี่ครั้ง/ใช้ไปเท่าไร” และ “อัปโหลดเอกสารใบเสร็จกี่ฉบับ”

หลักฐานจากโค้ด:

- `ReceiptOcrClient`, LINE `AiGatewayClient.requestReceiptOcr` และ `StatementAiExtractClient`
  ใช้ `AI_OCR_MAX_PER_COMPANY` ค่าเดียวกันทุกบริษัทในหน้าต่างเวลาเดียวกัน
- `CompanyAiConfiguration` มี model และ AI spend budget แต่ไม่มี OCR switch/quota
- `expenses.upload` entitlement ปิดทั้งทางอัปโหลด/ตรวจด้วยมือ และครอบคลุมเฉพาะ expense;
  ใช้เป็น OCR switch ไม่ได้ เพราะ statement OCR อยู่ใน banking และผู้ใช้ต้องยังอัปโหลด/กรอกเองได้เมื่อ OCR ปิด
- `AiUsageEvent` หนึ่ง OCR action อาจมีหลาย model-call rows และ provider/transport failure อาจไม่มี row;
  จึงใช้ `AiUsageEvent.callCount` เป็นจำนวนเอกสารที่ OCR อ่านไม่ได้
- attachment ทั้งระบบมีลายเซ็นและไฟล์ที่ระบบสร้างด้วย การนับ `AttachmentObject` ทุกแถวจะเกินจริง

## 2. เป้าหมาย

Platform Admin ต้องทำได้จากหน้ารายละเอียดบริษัท:

1. เปิดหรือปิด OCR เฉพาะบริษัท โดยไม่ปิดการอัปโหลดและการกรอก/ตรวจด้วยมือ
2. ตั้งจำนวน OCR สูงสุดต่อเดือน หรือเว้นว่างเป็นไม่จำกัด
3. เห็นเดือนปัจจุบัน/เดือนก่อน: OCR ที่ใช้, คงเหลือ, แยกใบเสร็จกับ statement และจำนวนเอกสารใบเสร็จที่อัปโหลดสำเร็จ
4. การเปลี่ยน config ต้อง tenant-safe, audit ได้ และการรับสิทธิ์ quota ต้องไม่ทะลุเมื่อยิงพร้อมกัน

## 3. คำจำกัดความที่ใช้จริง

### 3.1 OCR read

นับ 1 ครั้งเมื่อ request ผ่าน rate limit, AI spend admission และได้รับ OCR admission จากฐานข้อมูลแล้ว
ก่อนเรียก OCR provider โดยนับทั้งผลสำเร็จและ provider/transport failure หลัง admission เพราะต้นทุนอาจเกิดแล้ว

ไม่นับ:

- ไฟล์ชนิด/ขนาดไม่รองรับก่อนเรียก provider
- provider credential/config ไม่พร้อมจนเริ่มเรียก provider ไม่ได้
- request ที่ feature ปิด, quota เต็ม, AI spend เต็ม หรือ rate limit ปฏิเสธ
- retry ที่ส่ง request key เดิม; เว็บ expense และ statement ใช้ `X-Request-Id` คงที่ตลอด transport retry
  ส่วน LINE ใช้ attachment/message identity ที่คงเดิมแม้ webhook redelivery ได้ request id ใหม่;
  middleware เก็บ inbound id ไม่เกิน 256 bytes และ hash ค่าใหญ่กว่านั้นแบบ deterministic เพื่อไม่ให้ unique index ล้ม
  หรือ retry กลายเป็น request ใหม่
- สำหรับ JPEG/PNG จาก LINE ต้อง reserve ก่อน image intent router ซึ่งอ่านเนื้อหาเอกสารได้ แล้ว reuse
  admission เดิมหาก route ต่อไปที่ receipt extraction: เอกสาร LINE หนึ่งชิ้นจึงนับหนึ่งครั้งแม้มี model call มากกว่าหนึ่ง
  และ webhook redelivery จะไม่ increment/เรียก image provider ซ้ำ
- LINE PDF ปัจจุบันส่งเข้า router เป็น metadata โดยไม่มี bytes และไม่เข้า receipt extraction จึงไม่ reserve/ไม่นับ OCR;
  หากเพิ่ม PDF content extraction ภายหลังต้องผ่าน admission ที่ seam นั้นก่อน provider

ทุกช่องทางใช้ quota ก้อนเดียวต่อบริษัทต่อเดือน:

- `receipt-ocr-web` จากหน้าเว็บ
- `receipt-ocr-line` สำหรับรูป JPEG/PNG จาก LINE ที่ AI ตรวจใน image intent router (รวมรูปที่ภายหลังพบว่าไม่ใช่เอกสาร
  เพราะ provider cost เกิดก่อนรู้ intent); หน้า admin ต้องใช้ label ที่บอกว่าเป็นรูปที่ AI ตรวจ ไม่เรียกทั้งหมดว่าใบเสร็จ
- `bank-statement-extract` เฉพาะ JPEG/PNG ที่เข้า OCR; PDF text/CSV ไม่ใช่ OCR

### 3.2 เดือน

ใช้ `YYYY-MM` ตาม Asia/Bangkok เหมือน AI spend meter เดิม เพื่อไม่ให้หน้า admin สองส่วนตัดเดือนคนละเวลา

### 3.3 เอกสารใบเสร็จที่อัปโหลด

นับ `AttachmentObject` สถานะ `ACTIVE` ที่ `uploadedAt` อยู่ในเดือน และมี link ไป
`expense.record` ด้วย purpose `expense.receipt.primary` หรือ `expense.receipt.supporting` เท่านั้น

จงใจไม่นับ payment evidence, ลายเซ็น, PDF/รูปที่ระบบสร้าง, upload intent ที่ยังไม่จบ,
ไฟล์ quarantine/deleted และ LINE pending media ที่ผู้ใช้ยังไม่ยืนยันว่าเป็นใบเสร็จ
Statement upload ปัจจุบันส่ง inline และไม่เก็บเป็น `AttachmentObject`; จึงแสดงผ่าน OCR source breakdown
ไม่แอบรวมเป็น “เอกสารใบเสร็จที่อัปโหลด”

## 4. ข้อมูลและสัญญา

ขยาย `CompanyAiConfiguration`:

- `ocrEnabled Boolean @default(true)` — ไม่มี row = เปิด เพื่อคงพฤติกรรมเดิม
- `ocrMonthlyLimit Int?` — `null` = ไม่จำกัด; ค่าอื่นต้องเป็นจำนวนเต็ม 1–1,000,000
- `ocrConfigVersion Int @default(0)` — CAS monotonic เฉพาะ config OCR; การเปลี่ยน AI model/budget
  หรือ timestamp อื่นต้องไม่ทำให้ version นี้ขยับ

เพิ่ม:

- `CompanyOcrUsageEvent(companyId, monthKey, sourceRoute, requestId, createdAt)` โดย `requestId`
  คือ request key ที่ผ่าน trust boundary แล้ว พร้อม unique `(companyId, sourceRoute, requestId)` เป็น idempotency fence
- `CompanyOcrMonthlyUsage(companyId, monthKey, usedCount)` พร้อม unique `(companyId, monthKey)`

API:

- `PUT /v1/system/partners/:partnerCompanyId/ocr-config`
  permission `system.partner_ai_model.manage`; body `{ enabled, monthlyLimit, expectedVersion }`
  และ response `{ enabled, monthlyLimit, version, updatedAt }`
- `GET .../ai-usage` เพิ่ม `ocr` แบบ additive; read permission คง
  `system.partner_dashboard.read`
- ไม่มี tenant-facing config endpoint

## 5. Enforcement และ concurrency

OCR client ทั้งสามเส้นทางต้องผ่าน helper เดียว หลัง rate/spend admission และก่อน provider call

- Prisma governance เป็น dependency บังคับของทั้งสาม client; DI ขาดต้องทำให้ API boot ไม่ผ่าน ไม่ใช่เปิดทาง OCR
- ตรวจ internal credential และ resolve tenant model policy ก่อน admission; local readiness failure ห้ามสร้าง event
- เพราะ Typhoon/PDF capability และ internal HTTP preflight อยู่หลัง AI Gateway จึงใช้ reservation + atomic
  compensation เมื่อ exact status/error pair พิสูจน์ว่า provider ยังไม่ถูกเรียก เช่น HTTP 400/401/403/404
  ที่ client สังเกตจาก HTTP status จริง (ห้ามเชื่อ code เลียนแบบจาก JSON),
  `PROVIDER_CONFIG_MISSING`, `PDF_PROVIDER_UNSUPPORTED` หรือ `UNSUPPORTED_MIME_TYPE`; ห้ามเชื่อ error code
  ที่ขัดกับ status สำเร็จ ต้องลบ event และ decrement aggregate ใน transaction/lock ชุดเดียวกัน แล้ว request key เดิม retry ได้
- LINE router ที่ตอบ `UNAVAILABLE/PROVIDER_DISABLED` หรือ `PROVIDER_CONFIG_MISSING` ต้องคืน quota แล้วให้ receipt OCR
  ซึ่งอาจใช้คนละ provider admit/call ต่อได้; timeout/throttle/parse failure ซึ่ง provider อาจทำงานแล้วต้องคงหนึ่ง admission
  และห้ามเรียก image provider รอบสอง
- compensation ลอง transaction 4 ครั้งด้วย bounded backoff 50/250/1,000 ms เมื่อฐานข้อมูลล้มชั่วคราว;
  ถ้ายังยืนยันการคืนไม่ได้ให้ fail closed, คงยอดไว้แบบ conservative และ log
  `actionRequired=OCR_QUOTA_COMPENSATION_REQUIRED`, `riskLevel=HIGH` พร้อม company/source/request
  สำหรับ operator ตรวจและชดเชยผ่าน production security alarm เดิม

1. เปิด transaction
2. ถือ PostgreSQL transaction advisory lock ร่วมกับ config write ที่ `companyId` แล้วถือ lock
   `companyId + Bangkok month` เพื่อให้การปิด/เปลี่ยน limit ไม่วิ่งสวนกับ admission
3. อ่าน config และ aggregate ภายใน lock
4. ปฏิเสธเมื่อ config อ่านไม่ได้, ปิด feature หรือใช้ถึง limit
5. ตรวจ unique request fence
6. สร้าง event และ increment aggregate ใน transaction เดียวกัน

Config write ถือ company advisory lock เดียวกับ admission แล้วอ่าน `ocrConfigVersion` ภายใน lock:

- ถ้า desired state ตรงกับค่าปัจจุบัน ให้ตอบค่าปัจจุบันแบบ no-op แม้ `expectedVersion` เก่า
  เพื่อให้ exact retry หลัง response หายปลอดภัยและไม่ audit ซ้ำ
- ถ้า desired state ต่างและ `expectedVersion` ไม่ตรง ให้ตอบ 409 `ocr_config_version_conflict` โดยไม่เขียนอะไร
- ถ้าตรง ให้เขียน config + increment version + CRITICAL audit ที่มี from/to version ใน transaction เดียว
- หน้า Platform Admin ต้องส่ง version จาก usage read; เมื่อได้ 409 ให้โหลดค่าล่าสุดกลับลง switch/input
  และแจ้งภาษาไทยว่าผู้ดูแลอีกคนเปลี่ยนค่าแล้ว ห้ามเก็บ draft เก่าไว้ให้กดทับซ้ำ

ผลลัพธ์คงรูปของแต่ละ caller แต่มี stable reason:

- `OCR_FEATURE_DISABLED`
- `OCR_MONTHLY_LIMIT_EXCEEDED`
- `OCR_REQUEST_ALREADY_ADMITTED`
- `OCR_QUOTA_UNAVAILABLE`

การอ่าน config/quota ล้มเหลวต้อง fail closed; การปิด OCR ไม่ลบไฟล์/ผลเดิมและไม่ปิด manual review
หน้า usage ต้องอ่าน monthly aggregate, source breakdown และ uploaded-document counts ภายใต้ PostgreSQL
`RepeatableRead` snapshot เดียว เพื่อไม่แสดงยอดรวมกับยอดแยกคนละจังหวะระหว่าง concurrent admission

## 6. Audit และ security

- config mutation เขียน `CRITICAL` audit ใน transaction เดียวกับ upsert
- metadata เก็บ before/after ของ `enabled`, `monthlyLimit` และ `ocrConfigVersion`; ไม่เก็บเนื้อหาเอกสาร
- OCR usage event เก็บ company/source/request id เท่านั้น ไม่มี OCR text, file name หรือ bytes
- route ใช้ `:partnerCompanyId` ไม่ใช้ `:companyId` เพื่อไม่หลอก auth guard ว่า System Admin เป็นสมาชิก tenant
- runtime helper รับ companyId จาก server-derived request envelope เท่านั้น

## 7. UX สำหรับผู้ใช้ 40+ ที่ไม่เก่งเทคโนโลยี

- ภาษาไทยตรงไปตรงมา: “เปิดให้ AI อ่านเอกสาร”, “อ่านแล้ว”, “คงเหลือ”, “ไม่จำกัด”
- อธิบายชัดว่าปิด OCR แล้วยังอัปโหลดและกรอกเองได้
- input อย่างน้อย 16px, ปุ่ม/สวิตช์สูงอย่างน้อย 44px, ไม่พึ่งสีอย่างเดียว
- สวิตช์เป็น draft จนกด “บันทึก OCR”: badge/banner ต้องอิงสถานะที่บันทึกจริงและมีข้อความ “ยังไม่...” เมื่อ draft ต่าง
- แสดงเดือนและขอบเขต metric ชัด ไม่ใช้คำว่า calls ลอย ๆ
- มี loading/error/retry/read-only state และข้อความ quota เต็มที่นำผู้ใช้ไปกรอกเองได้

## 8. Migration/backfill

- config เดิมคง `ocrEnabled=true`, `ocrMonthlyLimit=null` จึงไม่เปลี่ยน behavior หลัง deploy
- ไม่ backfill OCR usage จาก `AiUsageEvent` หรือ audit เพราะหลักฐานเดิมนับไม่เท่ากับหนึ่งเอกสารและ LINE failure
  เคยบันทึกไม่ครบ; การเดาตัวเลขย้อนหลังจะทำให้ admin ตัดสินใจผิด
- หน้า Platform Admin ต้องบอกชัดว่าเดือน rollout (ส.ค. 2569) เริ่มนับวันที่ 27 และไม่ใช่ยอดเต็มเดือน;
  note หายเองตั้งแต่เดือนถัดไป
- uploaded-receipt count อ่านจาก source rows จริง จึงย้อนหลังได้เท่าที่ `uploadedAt` และ attachment link มีอยู่

## 9. Acceptance criteria

1. บริษัท A ปิด OCR แล้ว receipt web, LINE image intent router/receipt OCR และ statement image ไม่เรียก provider;
   บริษัท B ไม่ได้รับผล
2. ปิด OCR แล้วยังอัปโหลดใบเสร็จ เปิดเอกสารเดิม และกรอก/ตรวจด้วยมือได้
3. limit 2: สอง request คนละ id ผ่าน, request ที่สามถูกปฏิเสธ; สอง request ที่แข่งกันตอนเหลือ 1 สิทธิ์ผ่านเพียงหนึ่ง
4. request id เดิมไม่ increment ซ้ำและไม่เรียก providerซ้ำ
5. เปลี่ยน config เขียนข้อมูลและ CRITICAL audit atomically พร้อม before/after
6. tenant route อ่าน/แก้ config ไม่ได้; cross-company usage ไม่รั่ว
7. หน้า Platform Admin แสดง enabled/limit/current/previous/remaining/source breakdown/uploaded receipts พร้อม error/retry
8. receipt upload count ไม่รวม signature/generated/payment evidence/quarantine/pending intent
9. ผู้ดูแลสองคนเปิดหน้า version เดียวกัน: คนแรกเปลี่ยนสำเร็จ คนที่สองเปลี่ยนคนละค่าได้ 409;
   replay payload ของคนแรกด้วย version เก่ายังเป็น no-op และไม่ audit ซ้ำ
10. focused tests, API/web typecheck และ browser QA desktop/mobile ผ่านโดยไม่มี console error
11. LINE document หนึ่งชิ้น reserve ก่อน image router, reuse admission เดิมใน receipt extraction และนับเพียงหนึ่งครั้ง
12. web transport retry ที่ไม่รับ response ใช้ request id เดิม; retry หลังได้รับ provider failure ใช้ request id ใหม่
13. LINE router provider-disabled/config-missing คืน quota แล้ว receipt OCR แยกยังทำงานได้; router timeout/5xx
    ที่ไม่พิสูจน์ว่า provider ไม่ทำงานต้องไม่เรียก image provider รอบสอง


## Amendment 2026-10-28 — free expense drafts

FREE_MONTHLY_3 ใช้ CompanyOcrUsageEvent เดิม แยก successful/in-flight และ freeze month/source; success ต้อง commit พร้อม usable source, failed ใช้ exact compensation และคง cost guards เดิม รายละเอียดที่มีผลเฉพาะ cohort นี้อยู่ใน [free expense drafts spec](free-expense-drafts-spec-th.md); หลักฐาน local และข้อจำกัด live อยู่ใน [task memory](../agent-memory/free-expense-drafts.md).
