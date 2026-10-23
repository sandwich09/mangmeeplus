# e-Tax Invoice Email Intake Spec — รับใบกำกับภาษีอิเล็กทรอนิกส์และใบเสร็จทางอีเมลเข้าร้าน

Status: DRAFT — blocked on: BL2 (OCR unit recovery on early exits) review before P2.4; P1 scanner fix can ship first — revision 6 (review rounds 1–4 + focused check 2026-10-24: BL1 closed, BL2 redesigned — §19)
Owner: Expense lane (intake + tax evidence)
Related: `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md` (#12), `docs/plans/e-tax-invoice-email-intake-plan.md`, `docs/agent-memory/e-tax-invoice-email-intake.md`, `docs/specs/receipt-authenticity-signals-spec.md` (§12 G3 — PDF embedded file; ใช้ตัวตรวจไฟล์ร่วมกัน), `docs/specs/marketplace-buyer-expense-capture-contract-appendix-th.md` (D08/D09), `docs/specs/expense-input-vat-right-spec.md`, `docs/research/thai-retail-buyer-receipt-survey-2026-09-17-th.md` (§76–77, RC-A18), `docs/specs/mangmee-transactional-email-provider-spec-th.md`, `docs/runbooks/postmark-environment-activation.md`, `docs/plans/rd-taxpayer-verification-plan.md`, `docs/specs/p1-security-remediation-m04-m18-spec.md` (M-14), `docs/guidelines/thai-ux-standard.md` (§7)
Baseline: main 6c54ba208 (2026-10-23) — อ่านโค้ดจาก worktree `expense-specs-20261023` (tree เดียวกับ main)

หลักใหญ่: **ร้านมีอีเมลรับบิลหนึ่งที่อยู่ ไฟล์ที่ส่งเข้ามากลายเป็นรายการรอตรวจแบบเดียวกับที่อัปโหลดเอง** ถ้าไฟล์ตรงรูปแบบ e-Tax และมีข้อมูล XML ฝังอยู่ ระบบอ่านค่าจาก XML ตรง ๆ ไม่เรียก AI และบอกผลตรวจลายมือชื่อหรือตราประทับเวลาเท่าที่ตรวจได้จริง (ไม่ตรวจว่าผู้ขายอยู่ในรายชื่อผู้มีสิทธิ์ออก e-Tax จึงไม่อ้างเรื่องนั้น) ระบบไม่ยืนยัน ไม่จ่าย และไม่ตอบอีเมลผู้ส่งเอง ส่วนตรวจ e-Tax ใช้กับทุกช่องทางรับใบเสร็จ (เว็บ, LINE, อีเมล, capture group) งานแรกที่ต้องปล่อยก่อนทุกอย่างคือแก้ช่องโหว่ตัวตรวจ PDF (B1) ซึ่งปล่อยได้เดี่ยว ๆ

---

## 1. ปัญหา (พฤติกรรมปัจจุบัน)

### 1.1 ไม่มีช่องทางอีเมล

- ช่องทางรับรายจ่ายมี 4 ค่า `WEB_UPLOAD | WEB_MANUAL | LINE_UPLOAD | API_INTERNAL` ([schema.prisma:2433-2438](../../apps/api/prisma/schema.prisma)); capture group รู้จักแค่ `WEB | LINE` ([schema.prisma:3242-3245](../../apps/api/prisma/schema.prisma))
- `InitReceiptUploadUseCase` รับ `captureSource` แค่ `'WEB_UPLOAD' | 'LINE_UPLOAD'` ([expense-upload.use-case.ts:57, :104](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts)); ทางเว็บสร้าง attachment ก่อนรายจ่าย (`webIntent` [:93](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts)) มีแต่ทาง LINE ที่จองตัวตนรายจ่ายก่อนแล้ว resume attachment เดิมได้ ([:86, :164-179, :358-361](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts))
- Postmark เป็นผู้ส่งอีเมลของ UAT และ Production ([infra/postmark/config.json](../../infra/postmark/config.json)) แต่โค้ดรับแค่เหตุการณ์ขาออก `Delivery | Bounce | SpamComplaint` ([postmark-events.service.ts:14-31](../../apps/api/src/modules/auth/application/postmark-events.service.ts)) ผ่าน parser 256 KB ที่ตอบข้อผิดพลาดแบบไม่มีเนื้อหา ([provider-events-body.middleware.ts:5-21](../../apps/api/src/common/middleware/provider-events-body.middleware.ts)); ตัวตรวจ config deploy ยอมรับเฉพาะคีย์ที่รู้จัก ([infra/postmark/config.py:12-14, :27](../../infra/postmark/config.py)); ไม่มี inbound mail หรือ MIME parser ใน `apps/`
- ทางเข้าสาธารณะที่ผ่าน `AuthGuard` ตอนระบบปิดรับลูกค้ามีแค่ `stripe-events|postmark-events` ([auth.guard.ts:166](../../apps/api/src/modules/auth/presentation/auth.guard.ts))

### 1.2 ไฟล์ที่รับได้

- รับแค่ `image/jpeg`, `image/png`, `application/pdf` ([attachment.logic.ts:10-13](../../apps/api/src/modules/data-model-core/domain/logic/attachment.logic.ts)); 10 MiB ตั้งต้น ([packages/config/src/index.ts:200](../../packages/config/src/index.ts)), เพดานโค้ด 25 MB ([attachment.logic.ts:154](../../apps/api/src/modules/data-model-core/domain/logic/attachment.logic.ts)); นามสกุลต้องตรงชนิด ([:166-175](../../apps/api/src/modules/data-model-core/domain/logic/attachment.logic.ts))

### 1.3 ตัวตรวจ PDF ทำงานกับไบต์ดิบ (ทั้งพลาดของอันตรายและปฏิเสธของจริง)

- `inspectAttachmentBytes` ตัด payload ของ stream แล้วหา `/(javascript|js|openaction|launch|richmedia|embeddedfile|xfa)\b` แบบตัวอักษรตรงตัว ([attachment.logic.ts:206-222](../../apps/api/src/modules/data-model-core/domain/logic/attachment.logic.ts))
  - ชื่อใน PDF เขียนแบบ hex escape ได้ทั้งตัวพิมพ์ใหญ่และเล็ก (`/Java#53cript`, `/#4fbjStm`; ISO 32000-1 §7.3.5; [PDF Association](https://pdfa.org/pdf-malformations-and-more/)) → regex ไม่เห็น (B1)
  - ดิกชันนารีใน object stream (PDF 1.5+) ถูกตัดทิ้งพร้อม payload — คอมเมนต์ในโค้ดยอมรับข้อจำกัดนี้ ([:196-204](../../apps/api/src/modules/data-model-core/domain/logic/attachment.logic.ts))
  - การตัด payload ใช้ regex `/>>\s*stream\b[\s\S]*?endstream/g` ([:203](../../apps/api/src/modules/data-model-core/domain/logic/attachment.logic.ts)) ซึ่งไม่รู้จัก literal string, comment และ whitespace แบบ NUL ของ PDF — ข้อความ `(>> stream)` ใน string ก่อน catalog ทำให้ทุกอย่างจนถึง `endstream` จริงถัดไปถูกตัดทิ้ง รวม `/OpenAction`/`/JS` (B1)
  - pdf-lib ที่ repo ใช้ (1.17.1) ถอดชื่อเฉพาะ hex ตัวพิมพ์ใหญ่ (`/#([\dABCDEF]{2})/g` [PDFName.ts](https://raw.githubusercontent.com/Hopding/pdf-lib/v1.17.1/src/core/objects/PDFName.ts)) และ `DecodeStream` อ่านจนจบ stream โดยไม่มีเพดาน ([DecodeStream.ts](https://raw.githubusercontent.com/Hopding/pdf-lib/v1.17.1/src/core/streams/DecodeStream.ts)) — **ใช้ pdf-lib parse ไฟล์ในเส้นอัปโหลดไม่ได้** ทั้งเพราะ `/Type /#4fbjStm` ทำให้ไม่ขยาย object stream และเพราะเสี่ยง decompression bomb
  - PDF/A-3 ตาม ขมธอ.11-2560 ต้องฝัง XML เป็น embedded file; stream object อยู่ใน object stream ไม่ได้ (ISO 32000-1 §7.5.7) ดิกชันนารี `/Type /EmbeddedFile` จึงอยู่นอก payload เมื่อผู้สร้างเขียน `/Type` — ตัวสร้างอ้างอิงของ ETDA ใช้ iTextSharp `PdfFileSpecification.FileEmbedded` ([PDFA3Invoice.cs:81-89](https://github.com/ETDA/e-TaxInvoice-PDFgen/blob/master/eTaxInvoicePdfGenerator/PDFA3/PDFA3Invoice.cs)); **ยังไม่ยืนยันกับไฟล์จริง** (MC1) (B2)
- เว็บ: ผ่าน `CompleteAttachmentUploadUseCase` (:119-120) ซึ่งเส้นใบเสร็จ, capture group ([expense-capture-group.use-case.ts:527](../../apps/api/src/modules/expenses/application/use-cases/expense-capture-group.use-case.ts)) และเส้น attachment ทั่วไป ([attachment.controller.ts:30-40](../../apps/api/src/modules/data-model-core/presentation/http/attachment.controller.ts)) ใช้ร่วมกัน; ปฏิเสธแล้ว `QUARANTINED` + audit HIGH + security event HIGH ([complete-attachment-upload.use-case.ts:180-199](../../apps/api/src/modules/data-model-core/application/use-cases/complete-attachment-upload.use-case.ts)); ผู้ใช้เห็น "…มีคำสั่งอัตโนมัติฝังอยู่ … สั่งพิมพ์เป็น PDF ใหม่ …" ([api-error-message.ts:1534-1535](../../apps/web/src/common/api/api-error-message.ts))
- LINE: `CONTENT_REJECTED` ([process-line-webhook.use-case.ts:13154-13165](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts)) → "…กรุณาส่งไฟล์ต้นฉบับที่ดาวน์โหลดจากต้นทางอีกครั้งนะคะ" ([line-file-attempt-answer.logic.ts:143-145](../../apps/api/src/modules/line-ai/domain/logic/line-file-attempt-answer.logic.ts))
- ผู้เรียกอื่น: ใบแจ้งยอดธนาคาร (`statement-import.use-case.ts:110`), CRM inbox (`process-inbound-line-message.use-case.ts:1545`, `retry-crm-inbox-deliveries.use-case.ts:234`), LINE document QA (`line-document-qa.service.ts:479, :488`)
- การปฏิเสธ embedded file ตั้งใจตาม M-14 ([m14 corpus:54](../security-evidence/m14-upload-scanner-isolated-corpus.md)); สเปกข้อสังเกตเอกสารเจอปัญหาเดียวกันกับ C2PA ([receipt-authenticity-signals-spec.md §12 G3](receipt-authenticity-signals-spec.md))

### 1.4 ไม่มีตัวอ่าน XML/ตรวจลายมือชื่อ และงานอ่านมีจุดหายข้อมูล

- ไม่มี dependency XML หรือ CMS/ASN.1 ([apps/api/package.json](../../apps/api/package.json))
- `electronicVerificationJson` จำกัดที่ `NOT_CHECKED | UNAVAILABLE` (D09 [schema.prisma:3386-3388](../../apps/api/prisma/schema.prisma), [expense-capture.ts:36-40](../../packages/contracts/src/expense-capture.ts))
- ตัวอ่าน PDF เรียก AI ทุกครั้ง ([expense-capture-read-runner.service.ts:257-380](../../apps/api/src/modules/expenses/application/services/expense-capture-read-runner.service.ts)); อ่านเฉพาะไฟล์หลัก — job ของไฟล์ที่ไม่ใช่ `primaryAttachmentId` ถูกยกเลิก ([:504](../../apps/api/src/modules/expenses/application/services/expense-capture-read-runner.service.ts)) ไฟล์ประกอบจึงไม่เคยถูกอ่านหรือตรวจ
- `finish()` เขียนสถานะสุดท้าย (:658) แล้วค่อย append outbox (:674) แยกกัน ทั้งที่คอมเมนต์ :630 บอกว่าอยู่ใน transaction เดียว; `OutboxAppendService.append` กลืน error ([outbox-append.service.ts:86](../../apps/api/src/modules/data-model-core/application/services/outbox-append.service.ts)); job DONE ไม่ถูก claim ซ้ำ ([prisma-expense-capture.repository.ts:349](../../apps/api/src/modules/expenses/infrastructure/prisma-expense-capture.repository.ts)) (B4)
- `storeObservation` กลืน error ตอนบันทึก observation แล้วงานยังจบ DONE ([:509-531](../../apps/api/src/modules/expenses/application/services/expense-capture-read-runner.service.ts)) → `read-status` รายงาน 0 เอกสาร ([expense-capture-read-status.use-case.ts:133](../../apps/api/src/modules/expenses/application/use-cases/expense-capture-read-status.use-case.ts)) (B6)
- idempotency ของการสร้างงานอ่านนับเฉพาะ job ที่ยังไม่จบ (`status notIn DONE/FAILED/CANCELLED` [prisma-expense-capture.repository.ts:300-311](../../apps/api/src/modules/expenses/infrastructure/prisma-expense-capture.repository.ts)) และ `queueExpenseRead` ค้นแล้วสร้างแยกกันโดยไม่มี lock พร้อม `ocrAdmissionRequestId: randomUUID()` ใหม่ทุกครั้ง ([expense-capture-line.use-case.ts:71-83](../../apps/api/src/modules/expenses/application/use-cases/expense-capture-line.use-case.ts)) — ทำซ้ำหลัง job จบ หรือสอง worker ทำพร้อมกัน จะได้ job ใหม่และ OCR admission ใหม่
- `apply` ติดป้ายว่าค่ามาจาก AI (`aiVerifiedFieldsJson` [receipt-ocr-apply.service.ts:1018-1019](../../apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts)); บรรทัดสรุป `'รายการตามใบเสร็จ (AI สรุปยอดรวม)'` เมื่อบรรทัดสินค้า < 2 ([:611, :815, :861](../../apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts)); อัตรา VAT ในสัญญาเป็นเศษส่วน `[0,1)` ([:167-185](../../apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts)); ส่วนลดที่ยอดก่อนส่วนลดไม่ยืนยันถูกลบ ([:203-233](../../apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts)); หน้าเว็บ "ข้อมูลจาก AI (ต้องตรวจสอบก่อนยืนยัน)" ([workspace-dictionary.ts:1613](../../apps/web/src/common/i18n/workspace-dictionary.ts))
- เปลี่ยนไฟล์หลักแล้ว summary เดิมถูกเก็บทุกคีย์ยกเว้น `extractionAttachmentId` ([expense-upload.use-case.ts:385-393](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts))

### 1.5 สิทธิ์และหน้าจอ

- `PAPER_ATTACHED` ผ่านเมื่อมีไฟล์ใดก็ได้หรือผู้ตรวจติ๊กมีตัวจริง ([expense-input-vat-decision.ts:55-57](../../apps/api/src/modules/expenses/infrastructure/expense-input-vat-decision.ts)); ป้าย "แนบเอกสารแล้ว"/"มีเอกสารตัวจริง" ([ExpenseInputVatRight.tsx:92](../../apps/web/src/features/expenses/ExpenseInputVatRight.tsx))
- อัปโหลดต้องมี `attachment.create` ([create-upload-intent.use-case.ts:66](../../apps/api/src/modules/data-model-core/application/use-cases/create-upload-intent.use-case.ts), [complete-attachment-upload.use-case.ts:79](../../apps/api/src/modules/data-model-core/application/use-cases/complete-attachment-upload.use-case.ts)) และสิทธิ์อัปโหลดใบเสร็จของเจ้าของร่าง หรือ `expense.review` ([expense-upload.use-case.ts:337-339](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts))
- การอ่านรายจ่ายหนึ่งรายการมี predicate กลางอยู่แล้ว: `expense.read|review|confirm` ทั้งหมด, `read_own` (ผู้สร้าง/ผู้จ่าย), `read_related`, และ "ผู้สร้าง" (`expense.create|receipt.upload|receipt.line_upload` + `createdByUserId`) พร้อมขอบเขตสาขา ([expense-draft.use-case.ts:225-241](../../apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts))
- แท็บอัปโหลดเว็บเปิดได้เฉพาะ `expense.receipt.upload` ([expenses.model.ts:1599, :1805](../../apps/web/src/features/expenses/expenses.model.ts))
- สาขา: ไม่ระบุ → ใช้สาขาเดียวที่ ACTIVE ในขอบเขตของผู้ใช้ มากกว่าหนึ่งต้องเลือก ([transaction-branch.ts:34-38](../../apps/api/src/modules/data-model-core/application/services/transaction-branch.ts))

### 1.6 แจ้งเตือน

- ระบบแจ้งเตือนรายคน ([notification.use-cases.ts:188-283](../../apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts)) ตอนส่งจริงตรวจแค่ entitlement และ membership ACTIVE ([:497-524](../../apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts)); การ์ด LINE มีปุ่ม "เปิดรายการในเว็บ" ปุ่มเดียว เว้นแต่ trigger ใส่ปุ่มเอง ([:551, :768-833](../../apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts))
- ตัวแจ้งผลอ่านทาง LINE ข้ามรายการที่ไม่ได้มาจาก LINE ([line-capture-result-notifier.use-case.ts:140](../../apps/api/src/modules/line-ai/application/use-cases/line-capture-result-notifier.use-case.ts)) และเป็นผู้ใช้ event `expense.capture_read.finished` คนเดียว ([workflow-outbox-drain.use-case.ts:105-107](../../apps/api/src/modules/workflow/application/use-cases/workflow-outbox-drain.use-case.ts))

## 2. เป้าหมาย

1. **ปิดช่องโหว่ตัวตรวจ PDF (B1) ก่อนทุกอย่าง** — ปฏิเสธชื่อที่อำพราง, ขยาย object stream แบบมีเพดาน, ตรวจไม่ได้ = ปฏิเสธ; ปล่อยได้เดี่ยว
2. **อีเมลรับบิลต่อร้าน** — เข้าท่อเดิมด้วยขั้นตอนที่ทำต่อจากจุดค้างได้และไม่เปิด OCR ซ้ำ
3. **อ่าน e-Tax จาก XML ไม่ใช้ AI** — PDF/A-3 + XML (ขมธอ.3-2560) ทุกช่องทางรับใบเสร็จ
4. **บอกผลตรวจตามจริง** — แยก "ลายมือชื่อถูกต้อง" จาก "ตรงรูปแบบ e-Tax" และไม่อ้างสิทธิ์ผู้ออก (§3); ไม่ใช้เวลาที่ผู้ลงนามเขียนเอง; ตรวจ ByteRange, วัตถุประสงค์ใบรับรอง และรูปแบบ PDF/A-3 ที่ประกาศ
5. **ปลอดภัยและคุมสิ่งที่เก็บ** — tenant จาก envelope, ผู้ส่งยืนยันด้วย `DKIM_VALID_AU`, เพดานก่อนเก็บ (ระดับที่อยู่และระดับบริษัท), parser ไม่รั่วเนื้อหา, ตรวจสิทธิ์ซ้ำตอนแจ้งด้วย predicate กลาง
6. **แจ้งเฉพาะคนที่เกี่ยว** — สมาชิกได้เรื่องของตัวเอง (รวมที่ถูกพัก และจัดการได้), เอกสารผู้ขายได้ผู้รับเอกสารคนเดียว
7. **ไม่มีสวิตช์** — สิทธิ์ใช้ผ่านแพ็กที่ขาย (`expenses.upload` อยู่ใน `starter` ทุกแพ็ก [menu-entitlements.ts:432-449, :496-501](../../packages/contracts/src/menu-entitlements.ts))
8. **แก้ B2–B4, B6** และบันทึก B5

## 3. Non-goals

- ตรวจ XAdES ใน XML ล้วน และรับ XML ล้วนเป็นหลักฐาน
- ตรวจการเพิกถอนใบรับรอง (CRL/OCSP) — `revocation: NOT_CHECKED`; คำที่แสดงไม่อ้างเรื่องนี้
- **ตรวจ PDF/A แบบเต็ม** (ระดับ veraPDF) — ตรวจเฉพาะการประกาศ PDF/A-3 และโครงไฟล์แนบที่ e-Tax ต้องมี (§9.4); ป้ายไม่อ้างว่า "ผ่าน PDF/A"
- ตรวจรายชื่อผู้มีสิทธิ์ออก e-Tax ([rd.go.th/62829](https://www.rd.go.th/62829.html)) — งานต่อของ [rd-taxpayer-verification-plan](../plans/rd-taxpayer-verification-plan.md). **ผลบังคับ (F1)**: กฎกระทรวง 384 ข้อ 12 ให้ทำใบกำกับภาษีอิเล็กทรอนิกส์ได้เฉพาะผู้ประกอบการ "ตามรายชื่อที่อธิบดีประกาศ" (R1) — ระบบจึง**ไม่อ้าง**ว่าไฟล์เป็นใบกำกับภาษีอิเล็กทรอนิกส์ของผู้ออกที่มีสิทธิ์ หรือเป็น "ตัวจริง"; ป้าย ข้อความ fact และคอลัมน์ export บอกเฉพาะคุณสมบัติของไฟล์ที่ตรวจ (รูปแบบ, ลายมือชื่อ/ตราประทับ, ไม่ถูกแก้)
- เรียก validation.teda.th (ไม่มี API; R10)
- ใบเพิ่มหนี้/ลดหนี้/ยกเลิก (80/81/T07) อัตโนมัติ — พัก
- อ่านเนื้อหาอีเมล ตอบกลับ เปิดลิงก์ ดึงไฟล์จาก URL, Gmail/IMAP, ที่อยู่รายพนักงาน/รายสาขา
- อ่าน e-Tax แบบมีโครงสร้างใน capture group (ownerType `CAPTURE_GROUP`) — ใช้ AI เดิม แต่ไฟล์ผ่านตัวตรวจ `'receipt'` และบันทึกผลตรวจ
- ค้นรายจ่ายตามช่องทางผ่าน LINE AI (`expense.list_recent` [erp-tools.use-case.ts:509-520](../../apps/api/src/modules/line-ai/application/use-cases/erp-tools.use-case.ts) คงเดิม)
- กฎบล็อกระดับ Postmark ตามคำขอของร้านใดร้านหนึ่ง (R15e) — บล็อกของร้านอยู่ในแอปเท่านั้น
- แก้ป้ายช่องทาง OCR usage (B5) และเปลี่ยนราคา/โควตา

## 4. ผู้ใช้และ journey

| ผู้ใช้ | ใครในระบบ | ทำอะไร |
|---|---|---|
| ผู้ดูแลรายจ่าย | สิทธิ์ใหม่ `expense.email_intake.manage` (แม่แบบ/pack เดียวกับ `expense.category.manage`) | สร้าง/หมุนอีเมล, เลือกผู้รับเอกสาร/สาขาตั้งต้น, รับเข้า/ไม่รับอีเมลที่พัก, จำ/บล็อกผู้ส่ง |
| ผู้รับเอกสาร (handler) | ACTIVE + `attachment.create` + (`expense.receipt.upload` ∨ `expense.receipt.line_upload`) + สาขาตั้งต้นในขอบเขต | เจ้าของร่างจากผู้ขาย, ได้รับแจ้งคนเดียว, รับเข้า/ไม่รับอีเมลที่พัก |
| สมาชิกที่ส่งต่อเอง | สิทธิ์ชุดเดียวกับผู้รับเอกสาร + `User.email` ยืนยันแล้ว ([schema.prisma:580-581](../../apps/api/prisma/schema.prisma)) | ส่งต่อจากอีเมลตัวเอง → ร่างของตัวเอง; ถูกพัก → ได้รับแจ้งและจัดการเองในเว็บ (สมาชิกที่มีแค่ `line_upload` เปิดแท็บได้ — §8) |
| ผู้ขาย | ไม่ใช่ผู้ใช้ | ส่งใบกำกับภาษี/e-Tax by Time Stamp |
| ผู้ตรวจ/ผู้ยืนยัน | สิทธิ์เดิม | ตรวจร่าง เห็นป้ายผลตรวจ ตัดสินสิทธิภาษีซื้อ |
| นักบัญชี | `expense.export` | ไฟล์ต้นฉบับเดิม + คอลัมน์ผลตรวจ |

Journey:

- **J1 ตั้งค่า (เว็บ)** — ค่าใช้จ่าย › อัปโหลด → การ์ด "ส่งบิลทางอีเมล" → [สร้างอีเมลรับบิล] → ผู้รับเอกสาร (ตั้งต้น = ผู้สร้างถ้าผ่านเงื่อนไข) + สาขาตั้งต้น (เมื่อผู้รับเข้าถึง > 1 สาขา) → [คัดลอก]
- **J2 e-Tax PDF/A-3 จากผู้ขาย** — ลายมือชื่อถูกต้อง **และ** ตรงรูปแบบ e-Tax (§9.4) → ร่างของผู้รับเอกสาร ค่าจาก XML → การ์ด LINE [ดูในแชต] [เปิดในเว็บ]
- **J3 e-Tax by Time Stamp** — 2 ฉบับ (ร่าง + ETDA ประทับเวลา) → ร่างพักรอ → ฉบับประทับเวลาผ่าน → สร้างร่าง (อ่านด้วย AI) + จับคู่ด้วยตัวตนผู้ออก+เอกสาร (§9.3) → 48 ชม. (การตัดสินใจของผลิตภัณฑ์) → สร้างจากฉบับร่าง; ฉบับประทับเวลามาทีหลัง → เข้ารายการเดิม
- **J4 ผู้ขายใหม่ส่ง PDF ธรรมดา** — พัก → แจ้งผู้รับเอกสาร → [รับเข้า] (จำผู้ส่ง) → ครั้งถัดไปเข้าเอง
- **J5 สมาชิกส่งต่อ** — DKIM ตรงโดเมน + อีเมลตรงบัญชี → ร่างของสมาชิก → การ์ดถึงสมาชิกคนเดียว; ถูกพัก → แจ้งสมาชิก + ลิงก์เปิดเว็บ (LINE handoff) จัดการเอง
- **J6 ไฟล์ไม่ผ่าน** — สมาชิก: แจ้งพร้อมทางออก; ภายนอก: บันทึกเท่านั้น
- **J7 อัปโหลด e-Tax ทางเว็บ/LINE/capture group** — PDF/A-3 + XML ผ่านตัวตรวจ (แก้ B2); ไฟล์หลักทาง EXPENSE อ่านจาก XML; ไฟล์ประกอบได้ผลตรวจตอนอัปโหลด
- **J8 ถามน้องมั่งมี** — "ส่งบิลทางอีเมลได้ไหม" → การ์ดช่วยเหลือ (help pack v7 หลังเจ้าของอนุมัติ) + [เปิดหน้าอัปโหลด]

## 5. กติกา / ข้อยกเว้น

**V** = อ่านต้นฉบับเอง, **R** = ตรวจโดยรอบค้นคว้า/ผู้ทบทวน, **U** = ยังยืนยันไม่ได้

| # | กติกา | ผลต่อระบบ | แหล่ง |
|---|---|---|---|
| R1 | ผู้ประกอบการจดทะเบียนตามรายชื่อที่อธิบดีประกาศทำใบกำกับภาษีอิเล็กทรอนิกส์ได้ (ข้อ 12); ลงลายมือชื่อด้วยใบรับรองจาก CA ที่ NRCA รับรอง หรือให้ สพธอ. รับรองแทน (ข้อ 13); ผู้ให้บริการลงนามแทนได้ (ข้อ 14) | ลายมือชื่อถูกต้องจำเป็นแต่ไม่พอ (§9.4); ผู้ลงนามอาจไม่ใช่ผู้ขาย; ระบบไม่ตรวจรายชื่อตามข้อ 12 (ข้อ 19 นับผู้ได้รับอนุญาตก่อนกฎกระทรวงใช้บังคับเข้ารายชื่อด้วย) จึงไม่อ้างสิทธิ์ผู้ออก (§3, F1) | [mr384.pdf](https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/mr384.pdf) (ราชกิจจาฯ 2022-07-20) **V** — อ่านข้อ 12–19 ซ้ำ 2026-10-24 |
| R2 | XML ตาม ขมธอ.3-2560 หรือ PDF/A-3 ฝัง XML ตาม ขมธอ.11-2560; XAdES ตาม ขมธอ.14-2560 | รองรับ PDF/A-3+XML | [RD seminar หน้า 16](https://www.rd.go.th/publish/seminar/Seminar_190819.pdf) **R** |
| R3 | root `rsm:<Name>_CrossIndustryInvoice` namespace `urn:etda:uncefact:data:standard:<Name>_CrossIndustryInvoice:2` (Name = TaxInvoice, Receipt, DebitCreditNote, AbbreviatedTaxInvoice, Invoice, CancellationNote) | อ่านตาม local name ภายใต้ namespace เหล่านี้ | XSD 2.0.6 [gitlab ETDA](https://gitlab.com/etdath-teda-schema/teda-objects/common/e-tax-invoice-receipt) **V**; [ETDA Rec 3-2560 v2.0](https://www.etda.or.th/getattachment/43f4a6d7-946e-4fc3-b5d4-e3c64f9d197a/20250515_ETDA-Rec-3-2560_English-V03.pdf.aspx) **R** |
| R3b | `CalculatedRate` เป็นเปอร์เซ็นต์ (ตัวอย่าง `<ram:CalculatedRate>7</ram:CalculatedRate>`; ตาราง element ระบุ `PercentageRate`) | แปลงเป็นเศษส่วนของสัญญา `"7" → "0.0700"` | ETDA Rec 3 v2 หน้า 47, ตัวอย่างภาคผนวก **V** |
| R3c | ตัวอย่างภาคผนวกของ ETDA: บรรทัด `NetLineTotalAmount` 52,350 (หลังส่วนลดบรรทัด 1,500) + 10,700 (หลังส่วนลดบรรทัด 1,000) → `LineTotalAmount` 63,050; ส่วนลดหัวบิล `HTS/ram:SpecifiedTradeAllowanceCharge` (`ChargeIndicator` false) 500; `AllowanceTotalAmount` **3,000 = ส่วนลดบรรทัด + ส่วนลดหัวบิล**; `TaxBasisTotalAmount` 62,550 = 63,050 − 500 | ส่วนลดของร่าง = ผลรวม allowance **ระดับหัวบิล** ที่อ่านจาก `SpecifiedTradeAllowanceCharge` ใต้ HTS — **ไม่ใช้** `AllowanceTotalAmount` (§6.7) | ETDA Rec 3 v2 หน้า 59-61 (ตัวอย่าง XML) **V** |
| R4 | TypeCode: 388, T02, T03, T04 ใบกำกับภาษี; T05, T06 อย่างย่อ; T01 ใบรับ; 380 ใบแจ้งหนี้; 80/81 เพิ่ม/ลดหนี้; T07 ยกเลิก | §6.7 | ETDA Rec 3 B.2 + RD deck หน้า 18 **R** |
| R5 | `SpecifiedTaxRegistration/ID` `schemeID="TXID"` = 13 หลัก + สาขา 5 หลัก; `NIDN`; `OTHR`=`N/A`; ไม่มี schemeID = TXID | แยก 13+5 | ETDA Rec 3 B.16 **R**; XSD **V** |
| R6 | PDF/A-3: XML ที่เป็นข้อมูลของเอกสารแนบระดับเอกสาร โดยระบุ `AFRelationship` เป็น **Alternative** (§5.2.1(4.1)); `Data`/`Source` ใช้กับไฟล์ประกอบอื่น ไม่ใช่ XML หลัก; `text/xml`; PAdES + RFC 3161 | §9.4 ต้องเป็น `Alternative` เท่านั้น | ขมธอ.11-2560 [etda](https://www.etda.or.th/getattachment/f951411b-c94a-4cfd-9818-d23bf2ea2e4e/ขมธอ-11-2560-%281%29.aspx) **R** |
| R7 | Time Stamp: ผู้ขายส่ง To ผู้ซื้อ 1 อีเมล + CC csemail@etax.teda.th; ใบกำกับภาษีคือไฟล์ที่ได้รับทางอีเมล **ที่ประทับเวลาแล้ว** (ข้อ 5 วรรคสอง); ใบกำกับภาษี/เพิ่มหนี้/ลดหนี้ (ข้อ 5, 8) | ฉบับร่างไม่ใช่ใบกำกับภาษี → พักรอ | [pa_time_stampA.pdf](https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/pa_time_stampA.pdf) **V** |
| R8 | Time Stamp: PDF/A-3 1 ฉบับต่อไฟล์ ≤ 3 MB (FP-02-2566 ระบุ 2 MB) ไม่เข้ารหัส; ระบบส่งไฟล์ประทับเวลาให้ผู้ขายและอีเมลในช่อง To; ผู้ซื้อได้ 2 ไฟล์; เก็บไฟล์และอีเมล; ตราประทับอยู่ใน "คุณสมบัติของไฟล์"; ออกแบบสำหรับรายได้ ≤ 30 ล้าน | จับคู่ 2 ไฟล์; โครงสร้างตราประทับ **U** | [คู่มือ (14 ก.พ. 2568)](https://www.rd.go.th/fileadmin/user_upload/eTax/manual_time_stamp_010666.pdf) หน้า 1-3, 29-30 **V**; [FP-02-2566](https://www.rd.go.th/fileadmin/user_upload/tortor/standard/FP-02-2566_e-Tax_Invoice_by_Time_Stamp_V01.00.0000.pdf) **R** |
| R8b | "ภายใน 2 วัน" ในคู่มือเป็นเรื่องเปิดสิทธิ์อีเมล **ของผู้ขาย** | 48 ชม. เป็นการตัดสินใจของผลิตภัณฑ์ | คู่มือ หน้า 17-18 **V** |
| R9 | หัวเรื่อง `[วันเดือนปี][INV][เลขที่]` ฯลฯ ตัวอย่าง `[12012560][INV][INV0001]` | ข้อมูลประกอบการจับคู่ ใช้เดี่ยวไม่ได้ | ประกาศ ข้อ 9 **V**; คู่มือ หน้า 28 **V** |
| R10 | validation.teda.th ตรวจ PAdES/XAdES/JWS ไม่ตรวจเนื้อหา ไม่เก็บไฟล์ ไม่มี API | ลิงก์ให้ตรวจเอง | [FAQ](https://validation.teda.th/th/faq) **V** |
| R11 | ใบรับรองราก/TSA ของ NRCA ดาวน์โหลดได้ | trust store ในโค้ดพร้อมเวอร์ชัน | [nrca.go.th](https://nrca.go.th/home/certificates) **R** |
| R12 | ภาษีซื้อห้ามใช้เมื่อไม่มีใบกำกับภาษี/ไม่ครบสาระสำคัญ/ผู้ออกไม่มีสิทธิ (82/5); 86/4; สำเนาใช้ไม่ได้ | ไฟล์ที่ตรวจผ่านบอกได้แค่ว่าเป็นไฟล์อิเล็กทรอนิกส์ที่ลงนาม/ประทับเวลาถูกต้องและไม่ถูกแก้ — ใช้เป็นใบกำกับภาษีได้หรือไม่ยังขึ้นกับสิทธิ์ผู้ออก (R1 ข้อ 12) และสาระสำคัญ ซึ่งคนตัดสิน (P4); PDF ธรรมดาทางอีเมลไม่ใช่ใบกำกับภาษีอิเล็กทรอนิกส์ (ตีความ **U**) | [82/5](https://www.rd.go.th/5206.html), [86/4](https://www.rd.go.th/5208.html), [กค 0702/371](https://www.rd.go.th/37818.html) **R** |
| R13 | ผู้จัดทำ **หรือได้รับ** ต้องเก็บรูปแบบเดิม (ข้อ 18); Time Stamp ข้อ 10: ไฟล์ + แหล่งกำเนิด ต้นทาง ปลายทาง วันเวลา | เก็บไบต์เดิม + หัวอีเมลที่จำเป็น | mr384 ข้อ 18 **V**; ประกาศ ข้อ 10 **V** |
| R14 | เก็บเอกสาร ≥ 5 ปี (87/3) | ระยะเก็บเดิม; อีเมลไม่รับเข้าลบ 30 วัน (Q7) | [87/3](https://www.rd.go.th/5209.html) **R** |
| R15 | Postmark inbound JSON (`FromFull/To/Cc/OriginalRecipient/Subject/MessageID/Date/Headers/Attachments/MessageStream`), SPF/DKIM ใน `X-Spam-Tests`, retry 10 ครั้ง (~10 ชม.) ยกเว้น 403, ไฟล์แนบรวม ≤ 35 MB, Basic Auth ใน URL, MX `inbound.postmarkapp.com` priority 10 | §7.2 | [inbound webhook](https://postmarkapp.com/developer/webhooks/inbound-webhook), [parse](https://postmarkapp.com/developer/user-guide/inbound/parse-an-email), [inbound domain](https://postmarkapp.com/developer/user-guide/inbound/inbound-domain-forwarding), [webhooks](https://postmarkapp.com/developer/webhooks/webhooks-overview) **V** |
| R15b | Postmark เก็บเนื้อหา 45 วันโดยตั้งต้น และบันทึกไบต์ไฟล์แนบใน Raw Source | ข้อมูลผู้ประมวลผลรวมไฟล์แนบ | [retention](https://postmarkapp.com/support/article/how-long-are-inbound-and-outbound-messages-stored-in-activity) **V** |
| R15c | Retention add-on (7–365 วัน) **ระดับบัญชี** ทุก server/stream; ราคาขึ้นกับแผนและจำนวนวัน — ตัวอย่างในบทความ: แผน 10K **7 วัน = $45** (45 วัน = $0; ยิ่งสั้นยิ่งแพง); หน้าราคาเขียน "starts at $5 per month" (ระยะอื่น) และมีเฉพาะแผน Pro ขึ้นไป | Q3: 7 วันบนแผน 10K ประมาณ $45/เดือน และกระทบขาออกด้วย; ราคาจริงของบัญชีตาม MC3 | [add-on](https://postmarkapp.com/support/article/how-does-the-retention-add-on-work) (หน้าแสดง "Last updated" 2025-12-08 — F12) **V**; [pricing](https://postmarkapp.com/pricing) **V** |
| R15d | ราคาตามหน้า pricing ที่อ่าน 2026-10-24: Basic $15/10K **ไม่มี inbound**; Pro $16.50/10K มี inbound เกิน $1.30/1,000; Platform $18/10K เกิน $1.20/1,000; ข้อความ inbound ที่ประมวลผลนับ 1 อีเมล (บทความประกาศการเปลี่ยนแผนเผยแพร่ 2025-08-06 ปรับปรุง 2026-03-26 — ไม่ได้ระบุวันมีผลของราคานี้) | ต้องใช้ Pro ขึ้นไป; ต้นทุนเกิดแม้ไม่เรียก AI และแม้ถูกพัก/ปฏิเสธในแอป | [pricing](https://postmarkapp.com/pricing) **V**; [pricing announcement](https://postmarkapp.com/blog/new-we-made-pro-and-platform-tier-features-accessible-to-lower-volume-email-plans) **R**; [monthly pricing](https://postmarkapp.com/support/article/1107-how-does-monthly-pricing-work) **V** |
| R15e | Inbound blocking (spam threshold/inbound rules) ตั้งต่อ server; ข้อความที่ถูกบล็อก "doesn't count toward your monthly usage" | กฎระดับ Postmark กระทบทุกร้านที่ใช้ server เดียวกัน → ใช้เฉพาะการตัดสินใจต่อต้านการละเมิดระดับแพลตฟอร์ม | [inbound blocking](https://postmarkapp.com/developer/user-guide/inbound/configure-inbound-blocking) **V** |
| R16 | `DKIM_VALID_AU` = "valid DKIM … signature from author's domain" | ยืนยันผู้ส่ง | [SpamAssassin DKIM](https://spamassassin.apache.org/full/4.0.x/doc/Mail_SpamAssassin_Plugin_DKIM.html) **V** |
| R17 | พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562: ม.22, ม.24(6), ม.28 | ไม่เก็บเนื้อหาอีเมล; ภาคผนวกผู้ประมวลผลรวม R15b | [MDES](https://www.mdes.go.th/law/detail/3541-พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล-พ-ศ--๒๕๖๒) **R** (ไฟล์สแกน) |
| R18 | พ.ร.บ.ธุรกรรมทางอิเล็กทรอนิกส์ 2544 ม.8, 10, 12 | สนับสนุน R13 | **R** (ถ้อยคำ **U**) |
| R19 | CMS `signingTime`: "No requirement is imposed concerning the correctness of the signing time" | ไม่ใช้ `signingTime` | [RFC 5652 §11.3](https://www.rfc-editor.org/rfc/rfc5652.html#section-11.3) **R** |
| R20 | ByteRange ครอบไฟล์รวมดิกชันนารีลายมือชื่อยกเว้น Contents; revision ก่อนหน้าจบที่ `%%EOF` ของ revision นั้น | §9.3, §9.4 | [ISO 32000-2 §12.8.1](https://pdf-issues.pdfa.org/32000-2-2020/clause12.html) **R**; ISO 32000-1 §7.5.6 **R** |
| R21 | ชื่อ PDF ใช้ `#xx` แทนอักขระได้ (hex ไม่จำกัดตัวพิมพ์); whitespace ของ PDF รวม NUL (0x00), HT, LF, FF, CR, SP; literal string `( … )` ซ้อนวงเล็บได้และมี backslash escape; comment `%` ถึงท้ายบรรทัด; stream ยาวตาม `/Length` | ตัวตรวจต้องแยก token ตามกติกานี้ ไม่ใช้ regex ตัด payload (B1) | ISO 32000-1 §7.2–7.3 **R**; [PDF Association](https://pdfa.org/pdf-malformations-and-more/) **R** |
| R22 | ใบรับรองที่มี EKU "MUST only be used for one of the purposes indicated"; KeyUsage จำกัดการใช้กุญแจ; TSA ต้องมี EKU `id-kp-timeStamping` เท่านั้นและเป็น critical | §9.4 ตรวจวัตถุประสงค์ของผู้ลงนามและ TSA | [RFC 5280 §4.2.1.3, §4.2.1.12](https://www.rfc-editor.org/rfc/rfc5280.html#section-4.2.1.12) **R**; RFC 3161 §2.3 **R** |
| R23 | Node `zlib` sync มี `maxOutputLength` (ตั้งแต่ v12.19/v14.5) จำกัดขนาดผลลัพธ์ | ขยาย stream แบบมีเพดานโดยไม่ใช้ pdf-lib | [Node zlib](https://nodejs.org/api/zlib.html) **V** (พฤติกรรมเมื่อเกิน **U** → test) |
| R24 | pdf-lib 1.17.1 ถอดชื่อเฉพาะ hex ตัวใหญ่ และ `DecodeStream` อ่านจนจบ | ห้าม parse ไฟล์อัปโหลดด้วย pdf-lib ในตัวตรวจ | [PDFName.ts](https://raw.githubusercontent.com/Hopding/pdf-lib/v1.17.1/src/core/objects/PDFName.ts), [DecodeStream.ts](https://raw.githubusercontent.com/Hopding/pdf-lib/v1.17.1/src/core/streams/DecodeStream.ts) **R** |

กติกาผลิตภัณฑ์:

- **P1** "ลายมือชื่อถูกต้อง" = ByteRange ผ่าน + digest ตรง + CMS ถูก + สายถึง trust store + วัตถุประสงค์ใบรับรองถูก (R22) + มีผล ณ เวลาที่เชื่อถือได้
- **P2** "ตรงรูปแบบ e-Tax" (`etaxEligible`) แยกจาก P1 และต้องผ่านรูปแบบ PDF/A-3 + โครงไฟล์แนบ (§9.4); คำว่า "รูปแบบ e-Tax" และ fact `verifiedElectronicFile` ใช้ได้เฉพาะ `etaxEligible && VERIFIED` และหมายถึงคุณสมบัติของไฟล์เท่านั้น ไม่ใช่สิทธิ์ผู้ออก (R1 ข้อ 12, F1)
- **P3** ค่าจาก XML ไม่เท่ากับตรวจผ่าน — เติมร่างได้ ป้ายบอกผลจริง เทียบกับข้อความในหน้า PDF
- **P4** สิทธิภาษีซื้อเป็นการตัดสินของคน
- **P5** tenant จาก `OriginalRecipient` เท่านั้น (MC2)
- **P6** ไม่ส่งหัวเรื่อง/เนื้อหาอีเมลให้ AI; ไม่ตอบผู้ส่ง
- **P7** ทุกขั้นรับเข้าบันทึกจุดที่ทำถึงแล้ว ทำซ้ำได้โดยไม่สร้างของซ้ำ ไม่ข้ามขั้น และไม่เปิด OCR admission ซ้ำ
- **P8** ตัวตรวจไฟล์ตรวจไม่ได้ (เกินเพดาน, parse ไม่ได้, filter ไม่รองรับ) = **ปฏิเสธ** ไม่ใช่ผ่าน
- **P9** ทุกงานอ่านที่ได้ OCR admission จบด้วย release (ไม่มีผลที่ใช้ได้) หรือ settle (มีผล) **หนึ่งครั้ง** — ไม่คิดหน่วยกับการอ่านที่ล้ม และไม่ค้างหน่วยที่จอง (§7.4 ข้อ 3b, B7)

## 6. Data model (additive ทั้งหมด)

### 6.1 Enum เพิ่มค่า

- `ExpenseCaptureSource` + `EMAIL_INBOUND` — migration ไฟล์ของตัวเอง
- `ExpenseCaptureObservationSource` + `ELECTRONIC_DOCUMENT` — ตรวจผู้อ่าน enum ทุกจุด กติกา "AI ไม่ทับ HUMAN" ถือ `ELECTRONIC_DOCUMENT` เหมือน AI

### 6.2 `CompanyEmailIntakeAddress`

```prisma
enum EmailIntakeAddressStatus { ACTIVE RETIRED }

model CompanyEmailIntakeAddress {
  id              String                   @id @default(cuid())
  companyId       String
  localPart       String                   @unique @db.VarChar(32)  // 10 ตัว a-z/2-9 ไม่มีตัวสับสน; ไม่ใช้ซ้ำแม้ RETIRED
  status          EmailIntakeAddressStatus @default(ACTIVE)
  handlerUserId   String
  defaultBranchId String?
  revision        Int                      @default(1)
  createdByUserId String
  retiredByUserId String?
  retiredAt       DateTime?
  createdAt       DateTime                 @default(now())
  updatedAt       DateTime                 @updatedAt
  company         Company                  @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@unique([companyId, id])
  @@index([companyId, status])
}
```
หนึ่ง ACTIVE ต่อบริษัท: partial unique index raw SQL ตามแนวทางปัจจุบันของ repo (Prisma 7.4+ มี `partialIndexes` แบบ preview [changelog 2026-02-11](https://www.prisma.io/changelog/2026-02-11); repo ใช้ 7.8 แต่ไม่เปิด `previewFeatures` — งานนี้ไม่เปิด)

### 6.3 `InboundEmailMessage`

```prisma
enum InboundEmailStatus { RECEIVED PROCESSING DONE HELD DISCARDED }
enum InboundEmailSenderKind { MEMBER TRUSTED EXTERNAL BLOCKED }

model InboundEmailMessage {
  id                String                 @id @default(cuid())
  companyId         String
  addressId         String
  provider          String                 // 'postmark'
  providerMessageId String
  rfcMessageIdHash  String?
  fromAddress       String                 @db.VarChar(320)
  fromName          String?                @db.VarChar(200)
  fromDomain        String                 @db.VarChar(255)
  subject           String?                @db.VarChar(300)
  sentAt            DateTime?
  receivedAt        DateTime               @default(now())
  intakeDay         String                 @db.VarChar(10)   // วันที่ไทย YYYY-MM-DD
  authJson          Json                   // { spfPass, dkimValid, dkimValidAuthor, spamFlag, spamScore }
  headersJson       Json                   // From, To, Cc, Date, Message-ID hash, Received ≤10 บรรทัด ≤500 ตัวอักษร, OriginalRecipient
  storedBytes       Int                    @default(0)
  senderKind        InboundEmailSenderKind
  senderUserId      String?
  actingUserId      String?
  status            InboundEmailStatus     @default(RECEIVED)
  heldReason        String?
  decidedByUserId   String?
  decidedAt         DateTime?
  attempts          Int                    @default(0)
  leaseOwner        String?
  leasedUntil       DateTime?
  lastErrorCode     String?
  purgeAfter        DateTime?              // ลบแถวข้อความ — ตั้งเฉพาะเมื่อไม่มีไฟล์ใดผูกรายจ่าย (§7.5 ข้อ 5, F7)
  createdAt         DateTime               @default(now())
  updatedAt         DateTime               @updatedAt
  company           Company                @relation(fields: [companyId], references: [id], onDelete: Cascade)
  files             InboundEmailFile[]

  @@unique([provider, providerMessageId])
  @@unique([companyId, id])
  @@index([addressId, intakeDay])
  @@index([companyId, status, receivedAt])
  @@index([status, leasedUntil])
  @@index([purgeAfter])
}
```

### 6.4 `InboundEmailFile`

```prisma
enum InboundEmailFileOutcome { PENDING STORED DUPLICATE AWAITING_STAMP PAIRED HELD SKIPPED REJECTED }
enum InboundEmailIngestStep { NONE EXPENSE_RESERVED ATTACHMENT_RESERVED BYTES_UPLOADED COMPLETED READ_QUEUED }

model InboundEmailFile {
  id                      String                  @id @default(cuid())
  companyId               String
  messageId               String
  position                Int
  fileNameSanitized       String                  @db.VarChar(120)
  declaredMimeType        String                  @db.VarChar(100)
  detectedMimeType        String?                 @db.VarChar(100)
  byteSize                Int
  checksumSha256          String
  data                    Bytes?
  outcome                 InboundEmailFileOutcome @default(PENDING)
  reasonCode              String?
  ingestStep              InboundEmailIngestStep  @default(NONE)
  readJobId               String?                 // งานอ่านที่ผูกกับไฟล์นี้ บันทึกพร้อม READ_QUEUED
  etaxKind                String?
  stampSubjectKey         String?
  stampSellerTaxId        String?
  stampPrevRevisionSha256 String?
  pairedFileId            String?
  targetBranchId          String?
  acceptedByUserId        String?                 // ตั้ง = การรับเข้าของคน (override เหตุพักตาม §9.2) คงอยู่ข้าม restart
  acceptedAt              DateTime?
  autoSlotReservedAt      DateTime?               // จองช่อง auto ของ (ที่อยู่, intakeDay) แล้ว — idempotent (§7.5, F8)
  dataPurgeAfter          DateTime?               // ลบไบต์ `data` ของไฟล์นี้: 30 วันนับจากที่ไฟล์เข้าสถานะที่ไม่ผูกรายจ่าย; ล้างเมื่อถูกรับเข้า (F7)
  verificationId          String?
  attachmentId            String?
  expenseId               String?
  createdAt               DateTime                @default(now())
  updatedAt               DateTime                @updatedAt
  message                 InboundEmailMessage     @relation(fields: [companyId, messageId], references: [companyId, id], onDelete: Cascade)

  @@unique([companyId, messageId, position])
  @@index([companyId, checksumSha256])
  @@index([companyId, outcome, stampSubjectKey])
  @@index([dataPurgeAfter])
}
```

### 6.5 `EmailIntakeSender`

```prisma
enum EmailIntakeSenderTrust { TRUSTED BLOCKED }

model EmailIntakeSender {
  id              String                 @id @default(cuid())
  companyId       String
  email           String                 @db.VarChar(320)
  trust           EmailIntakeSenderTrust
  decidedByUserId String
  createdAt       DateTime               @default(now())
  updatedAt       DateTime               @updatedAt
  company         Company                @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@unique([companyId, email])
}
```

### 6.6 `ElectronicDocumentVerification`

```prisma
enum ElectronicVerificationStatus { VERIFIED FAILED UNAVAILABLE NOT_CHECKED }

model ElectronicDocumentVerification {
  id                   String                       @id @default(cuid())
  companyId            String
  checksumSha256       String
  verifierVersion      Int
  trustStoreVersion    String
  format               String     // ETAX_PDF_XML | ETAX_TIME_STAMP_PDF | SIGNED_PDF | PLAIN_PDF
  etaxCandidate        Boolean    @default(false)
  etaxEligible         Boolean    @default(false)
  etaxIneligibleReason String?    // NO_PDFA3_DECLARATION | ATTACHMENT_PROFILE_INVALID | TYPECODE_NOT_ELIGIBLE | NO_SELLER_TAX_ID | TSA_NOT_ETDA | SIGNATURE_NOT_VERIFIED
  status               ElectronicVerificationStatus
  method               String?    // ETAX_PDF_SIGNATURE | ETDA_TIME_STAMP | PDF_SIGNATURE
  reasonCode           String?    // §9.4
  signerName           String?    @db.VarChar(200)
  signerCertSha256     String?
  trustAnchor          String?    @db.VarChar(200)
  trustedTime          DateTime?  // genTime ของ timestamp ที่ตรวจผ่านเท่านั้น
  timeBasis            String     // TRUSTED_TIMESTAMP | VALIDATION_TIME
  coversWholeFile      Boolean    @default(false)
  revocation           String     @default("NOT_CHECKED")
  etaxTypeCode         String?    @db.VarChar(8)
  recheckAfter         DateTime?  // VERIFIED แบบ VALIDATION_TIME → notAfter ที่เร็วที่สุดในสาย; VERIFIER_ERROR → +1 ชม.; อื่น ๆ null
  checkedAt            DateTime   @default(now())
  company              Company    @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@unique([companyId, checksumSha256, verifierVersion, trustStoreVersion])
}
```
แถวที่ใช้ได้ = ตรง `verifierVersion` และ `trustStoreVersion` ปัจจุบัน **และ** (`recheckAfter` ว่าง หรือ > ตอนนี้). **การเขียน (P56/F4)**: ไม่มีแถวของเวอร์ชันปัจจุบัน → คำนวณ (เพดาน 2 วิ) แล้ว `INSERT … ON CONFLICT DO NOTHING` แล้วอ่านแถวที่อยู่ในฐาน; มีแถวแต่ `recheckAfter` ผ่าน → คำนวณใหม่แล้ว **update แถวเดิมในที่** (ทุกคอลัมน์ผลตรวจ + `recheckAfter` + `checkedAt`) แบบ CAS `WHERE checkedAt = ค่าที่อ่านมา` (แพ้ → อ่านแถวใหม่) — unique key จึงไม่ชน; ประวัติ = แถวของ verifier/trust store เวอร์ชันเก่า (คงไว้) + audit `expense.electronic_verification.changed` เมื่อ update ทำให้ `status` หรือ `etaxEligible` เปลี่ยน; trust manifest เปลี่ยน = `trustStoreVersion` ใหม่ จึงไม่มีป้ายค้างจาก trust เดิม (F7)

- **ไม่เพิ่มคอลัมน์ใน `ExpenseRecord`**: `captureSource = EMAIL_INBOUND`, `draftIdempotencyKey = 'email:' + inboundFileId` ([schema.prisma:2745](../../apps/api/prisma/schema.prisma), [prisma-expense.repository.ts:894-907](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)), `draftPayloadHash = checksum`, `sourceChannelMetadataJson = { channel: 'EMAIL', inboundMessageId, inboundFileId }`
- `aiVerificationSummaryJson.readSource` (`'AI' | 'ETAX_XML'`) + `readAttachmentId` — เขียนทุก apply; ลบตอนเปลี่ยนไฟล์หลัก
- `ExecutiveCompanyMonth` ([schema.prisma:4185-4186](../../apps/api/prisma/schema.prisma)) + `expenseReceiptsEmail`, `confirmedExpensesEmail` (Int @default(0))
- `ExpenseCaptureReadJob`: raw SQL partial unique index `("companyId", "ocrAdmissionRequestId") WHERE "ocrAdmissionRequestId" LIKE 'email-intake:%'` — งานอ่านจากอีเมลมีได้หนึ่งงานต่อไฟล์ (§7.5); แถวเดิมใช้ UUID จึงไม่ชน

### 6.7 แผนที่ XML → `ReceiptOcrFieldResult` ([line-ai.ts:729-835](../../packages/contracts/src/line-ai.ts))

`HTA` = `rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement`, `HTS` = `…/ram:ApplicableHeaderTradeSettlement`, `SUM` = `HTS/ram:SpecifiedTradeSettlementHeaderMonetarySummation`

| ฟิลด์ | XML | กติกา |
|---|---|---|
| `documentNumber` | `rsm:ExchangedDocument/ram:ID` | trim |
| `expenseDate` | `rsm:ExchangedDocument/ram:IssueDateTime` | ส่วนวันที่; มีโซน → วันที่กรุงเทพฯ |
| classification (ไม่ใช่ฟิลด์ของ `ReceiptOcrFieldResult`) | `ram:TypeCode` | **F5**: `readEtaxXml` คืน `{ fields, classification }`; `BusinessDocumentClassification` ([line-ai.ts:919](../../packages/contracts/src/line-ai.ts)) สร้างแบบตายตัว: 388/T02/T03/T04 → `documentKind TAX_INVOICE`; T05/T06 → `ABBREVIATED_TAX_INVOICE`; T01 → `RECEIPT` (`transactionState PAID` + settlement signal `ETAX_TYPECODE_T01`); 380 → `SUPPLIER_INVOICE_OR_BILL`; 80/81/T07 → พัก `NOT_TAX_DOCUMENT` ไม่ apply; ทุกแบบ `contentKind DOCUMENT`, `documentFamily EXPENSE_EVIDENCE`, `businessDirection PURCHASE_EXPENSE`, amount signal = `GrandTotalAmount`. runner ใส่ classification ใน observation และส่ง `ocrDocumentType`/`sourceDocumentType` = `toSourceDocumentType(sourceDocumentTypeFromClassification(classification))` เข้า apply แบบทาง AI ([runner :577-578](../../apps/api/src/modules/expenses/application/services/expense-capture-read-runner.service.ts), [receipt-ocr-apply.service.ts:1017](../../apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts)) จึงผ่าน `isExpenseExtractionEligible` เดิมและได้ `sourceDocumentType = TAX_INVOICE` ที่ `verifiedElectronicFile` ต้องใช้ |
| `vendorName`, `vendorIdentityEvidence` | `HTA/ram:SellerTradeParty/ram:Name` | |
| `vendorTaxId`, `vendorBranchCode`, `vendorEntityKind` | `HTA/ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID` | R5; checksum ผิด → ไม่ใส่ + review reason |
| `vendorAddress` | `…/ram:PostalTradeAddress` (`LineOne`, `LineTwo`, `PostcodeCode`) | รหัสจังหวัดยังไม่แปลง (G6) |
| `buyerAsPrinted` | `HTA/ram:BuyerTradeParty/{Name, SpecifiedTaxRegistration/ID}` | compare เดิม |
| `subtotalAmount` | `SUM/ram:LineTotalAmount` | ผลรวม `NetLineTotalAmount` (หลังส่วนลดรายบรรทัด ก่อนส่วนลดหัวบิล — R3c) — **ต้องใส่** ไม่งั้น `verifyDiscountAmount` ลบส่วนลด ([:203-233](../../apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts)) |
| `discountAmount` | ผลรวม `HTS/ram:SpecifiedTradeAllowanceCharge[ChargeIndicator=false]/ram:ActualAmount` | ส่วนลด **ระดับหัวบิล** เท่านั้น (ค่า `ChargeIndicator` ไม่สนตัวพิมพ์); **ไม่ใช้** `SUM/ram:AllowanceTotalAmount` เพราะรวมส่วนลดรายบรรทัดด้วย (R3c: 3,000 = 1,500 + 1,000 + 500) |
| `additionalCharges` | ผลรวม `HTS/ram:SpecifiedTradeAllowanceCharge[ChargeIndicator=true]/ram:ActualAmount` > 0 | `[{ kind: 'OTHER', description: 'ค่าใช้จ่ายเพิ่มตามข้อมูลในไฟล์', amount, evidenceSignal: 'SpecifiedTradeAllowanceCharge' }]`; ไม่ใช้ `ChargeTotalAmount` ด้วยเหตุผลเดียวกับส่วนลด |
| `taxableAmount`, `vatAmount`, `grandTotalAmount` | `SUM/{TaxBasisTotalAmount, TaxTotalAmount, GrandTotalAmount}` | สตริงเท่านั้น; `GrandTotalAmount` ซ้ำได้ → THB/ไม่มีสกุล; ขัดกัน → ตกทาง AI |
| `vatRate` | `HTS/ram:ApplicableTradeTax/ram:CalculatedRate` | **เปอร์เซ็นต์ → เศษส่วน** (`"7"` → `"0.0700"`, R3b); อัตราเดียวเท่านั้น |
| `vatMode` | คำนวณ | VAT > 0 → `VAT_EXCLUDED`; = 0 → `NO_VAT` + review reason |
| `currency` | `HTS/ram:InvoiceCurrencyCode` | |
| `lines[]` | `IncludedSupplyChainTradeLineItem`: `description` ← `SpecifiedTradeProduct/ram:Name`; `quantity` ← `SpecifiedLineTradeDelivery/ram:BilledQuantity`; `amount` ← `…/SpecifiedTradeSettlementLineMonetarySummation/ram:NetLineTotalAmount`; `unitPrice` ← `GrossPriceProductTradePrice/ram:ChargeAmount` **เฉพาะบรรทัดที่ไม่มีส่วนลด/ค่าใช้จ่ายรายบรรทัด** (สัญญาให้ `amount` = quantity × unitPrice [line-ai.ts:746-750](../../packages/contracts/src/line-ai.ts)); บรรทัดที่มีส่วนลด: ไม่ใส่ `unitPrice` และต่อท้ายชื่อ "(หักส่วนลด {ยอด})"; `vatRate` ← บรรทัด `ApplicableTradeTax/CalculatedRate` แปลงเป็นเศษส่วน; `evidenceSignal` ← `LineID` | > 200 บรรทัด → ไม่ใส่ + review reason; ผลรวม `amount` = `subtotalAmount` จึงกระทบยอดได้ |
| `description` | บรรทัดเดียว → ชื่อสินค้า; อื่น ๆ `'รายการตามข้อมูล XML ในไฟล์'` | ตั้งเสมอ (ไม่ตกไปข้อความ "AI สรุปยอดรวม" [:815, :861](../../apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts)); ข้อความที่ **เก็บ** ไม่ใช้คำว่า e-Tax เพราะผลตรวจเปลี่ยนได้ภายหลัง (F8) |
| `confidence` / `categorySuggestion` | 1 / ไม่ใส่ | |

ตรวจความสอดคล้องก่อน apply: `LineTotalAmount − ส่วนลดหัวบิล + ค่าใช้จ่ายหัวบิล = TaxBasisTotalAmount` (ตัวอย่าง R3c: 63,050 − 500 = 62,550) และ `TaxBasisTotalAmount + TaxTotalAmount = GrandTotalAmount` (±0.01) ไม่ตรง → ยังเติมร่าง + review reason "ยอดในข้อมูล XML ไม่เข้ากัน ตรวจกับเอกสาร"

## 7. Contracts / API

### 7.1 Contracts

- `expenses.ts:59` `ExpenseCaptureSource` + `'EMAIL_INBOUND'`; `expense-capture.ts` status 4 ค่า (gateway ไม่อ่าน [line-ai-internal.controller.ts:868, :941](../../apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts))
- ใหม่ `expense-email-intake.ts`:

```ts
export type ExpenseElectronicEvidenceDto = {
  status: 'VERIFIED' | 'FAILED' | 'UNAVAILABLE' | 'NOT_CHECKED';
  etaxEligible: boolean;
  etaxCandidate: boolean;
  method: 'ETAX_PDF_SIGNATURE' | 'ETDA_TIME_STAMP' | 'PDF_SIGNATURE' | null;
  reasonCode: ExpenseElectronicEvidenceReason | null;
  signerName: string | null;
  timestampedAt: string | null;   // trustedTime เท่านั้น
  checkedAt: string;
  readFromXml: boolean;           // readSource === 'ETAX_XML' && readAttachmentId === primaryAttachmentId
};
export type ExpenseElectronicEvidenceReason =
  | 'MODIFIED_AFTER_SIGNING' | 'SIGNATURE_INVALID' | 'CERT_NOT_VALID_AT_SIGNING' | 'CERT_PURPOSE_INVALID'
  | 'INVALID_BYTE_RANGE' | 'CHAIN_NOT_ESTABLISHED' | 'CONTENT_AFTER_SIGNATURE' | 'NO_TRUSTED_TIME'
  | 'UNSUPPORTED_SIGNATURE' | 'CORRUPT_OR_ENCRYPTED' | 'VERIFIER_ERROR';
export type EmailIntakeHeldReason =
  | 'NEW_SENDER' | 'SENDER_NOT_CONFIRMED' | 'SPAM_SUSPECTED' | 'BUYER_MISMATCH' | 'BRANCH_REQUIRED'
  | 'XML_ONLY' | 'NOT_TAX_DOCUMENT' | 'HANDLER_UNAVAILABLE' | 'DAILY_LIMIT';
export type EmailIntakeOverviewDto = {
  address: { addressId: string; email: string; revision: number; handlerUserId: string; handlerName: string;
             handlerEligible: boolean; defaultBranchId: string | null; createdAt: string } | null;
  canManage: boolean; isHandler: boolean;
  myVerifiedEmail: string | null; myForwardEligible: boolean;
  heldCount: number;   // manage/ผู้รับ: ทั้งร้าน; สมาชิก: ของตัวเอง
  limits: { maxFilesPerMessage: number; maxBytesPerFile: number; maxBytesPerMessage: number; allowedMimeTypes: string[] };
};
export type EmailIntakeMessageDto = {
  messageId: string; receivedAt: string; fromName: string | null; fromAddress: string; subject: string | null;
  status: 'HELD' | 'DONE' | 'DISCARDED'; heldReason: EmailIntakeHeldReason | null; senderConfirmed: boolean;
  files: Array<{ fileId: string; fileName: string; byteSize: number;
    outcome: 'STORED' | 'DUPLICATE' | 'AWAITING_STAMP' | 'PAIRED' | 'HELD' | 'SKIPPED' | 'REJECTED';
    reasonCode: string | null;
    expenseId: string | null;   // เฉพาะเมื่อผู้ดูผ่าน canReadExpense ของรายจ่ายนั้น (F6)
    etax: boolean }>;          // etaxEligible && VERIFIED ของไฟล์ (คุณสมบัติไฟล์ ไม่ใช่สิทธิ์ผู้ออก)
  allowedActions: Array<'accept' | 'discard'>;
};
```

### 7.2 Webhook ขาเข้า

`POST /v1/public/postmark-inbound` — `@Public()`; Basic Auth ชุดแยก (≥ 24 ตัว) timing-safe แบบ [postmark-events.service.ts:44-50](../../apps/api/src/modules/auth/application/postmark-events.service.ts)

- **Parser**: wrapper แบบ `providerEventsJson` ([:14-21](../../apps/api/src/common/middleware/provider-events-body.middleware.ts)) — `json({ limit: '28mb', inflate: false })` → `PayloadTooLargeException('Inbound mail body is too large')` / `BadRequestException('Invalid inbound mail body')` ข้อความตายตัว; log แค่ path ขนาด requestId
- ลำดับ: Basic Auth → `MessageStream` → `OriginalRecipient` เป็นโดเมนเรา → ที่อยู่ → เพดานก่อนเก็บ → บันทึก

| ผล | HTTP |
|---|---|
| Basic Auth ผิด/ไม่มี | 401 |
| stream ผิด / body ผิดรูป / ผู้รับไม่ใช่โดเมนเรา | 403 |
| ที่อยู่ไม่มี/RETIRED | 200 ไม่เก็บไฟล์ |
| ซ้ำ | 200 |
| เกินเพดาน | 200, DISCARDED `INTAKE_LIMIT` ไม่มีไบต์ |
| บันทึกไม่ได้ | 503 |
| สำเร็จ | 200 (ข้อความ + ไฟล์ใน tx เดียว แล้ว kick) |

**เพดาน (ค่าคงที่ในโค้ด) — ตรวจใน tx เดียวกับการบันทึก ใต้ advisory lock สองตัวตามลำดับเสมอ: (1) `email-intake-company:${companyId}` (2) `email-intake-address:${addressId}:${intakeDay}`**: ต่อข้อความ ≤ 10 ไฟล์, ไฟล์ละ ≤ `UPLOAD_MAX_BYTES`, รวม ≤ 20 MiB; ต่อที่อยู่ต่อวัน ≤ 200 ข้อความและ ≤ 200 MiB; ต่อผู้ส่งที่ไม่ใช่ TRUSTED/MEMBER ≤ 20 ข้อความ/วัน; **ต่อบริษัท** ไบต์ที่พักอยู่ (`data` ไม่ null) ≤ 500 MiB — lock ระดับบริษัททำให้ข้อความที่คร่อมเที่ยงคืนหรือข้ามการหมุนที่อยู่ไม่ใช้โควตาเดียวกันซ้อน (worker ที่ลด `storedBytes` ก็จับ lock ระดับบริษัทก่อน); รูป < 20 KB และ `.p7s` ข้าม

### 7.3 ภายในและหน้าเว็บ

```
POST /v1/internal/expenses/email-intake/drain               { batchSize? } (x-worker-token) → { claimed, purged }
GET  /v1/companies/{c}/expenses/email-intake                 → EmailIntakeOverviewDto
POST /v1/companies/{c}/expenses/email-intake/address         { handlerUserId, defaultBranchId? }
POST /v1/companies/{c}/expenses/email-intake/address/rotate  { expectedRevision }
PATCH /v1/companies/{c}/expenses/email-intake/address        { expectedRevision, handlerUserId?, defaultBranchId? }
GET  /v1/companies/{c}/expenses/email-intake/messages?status=HELD|RECENT&page=
POST /v1/companies/{c}/expenses/email-intake/messages/{m}/accept  { trustSender, branchId? }
POST /v1/companies/{c}/expenses/email-intake/messages/{m}/discard { blockSender }
GET  /v1/companies/{c}/expenses/{e}   (เดิม) + electronicEvidence: ExpenseElectronicEvidenceDto | null
```
รับเข้า: tx เดียว — ไฟล์ HELD → `PENDING` + `targetBranchId` + `acceptedByUserId` + `acceptedAt`, ข้อความ → `RECEIVED` + `decidedBy/At` (+ TRUSTED ถ้าติ๊ก); worker ใช้ค่าที่บันทึกและ **ข้ามเหตุพักที่การรับเข้าของคนแทนได้** ตามตาราง §9.2 แม้ `trustSender=false` (การรับเข้ามีผลกับข้อความนี้ครั้งเดียว) (F3)

รหัสปฏิเสธ: `email_intake_address_exists` 409, `email_intake_revision_conflict` 409, `email_intake_handler_not_eligible` 422, `email_intake_branch_required` 422, `email_intake_message_not_held` 409, `email_intake_no_acceptable_file` 422, `email_intake_forbidden` 403

### 7.4 การตรวจและการอ่าน

**ตรวจไฟล์ (verification) — ทุกไฟล์ใบเสร็จ PDF ไม่ว่าหลักหรือประกอบ**: `CompleteReceiptUploadUseCase` และ capture-group completion หลังเก็บไฟล์สำเร็จเรียก `ElectronicDocumentVerifier.verify(bytes)` (เพดาน 2 วิ) → insert ตาม `(companyId, checksum, verifierVersion, trustStoreVersion)`; เกินเวลา → ไม่มีแถว; ทุกจุดที่อ่าน (detail endpoint / `inputVatDecisionFacts` / runner / export) ใช้กติกา "แถวที่ใช้ได้" ของ §6.6 — ไม่มีหรือหมดอายุ → คำนวณใหม่ด้วยเพดานเดียวกัน; group → สะท้อนลง `ExpenseCaptureFile.electronicVerificationJson`

**อ่าน (runner, เฉพาะไฟล์หลักตามเดิม)** หลัง checksum ([:223-226](../../apps/api/src/modules/expenses/application/services/expense-capture-read-runner.service.ts)):

1. ใช้แถว verification ที่ใช้ได้ตาม §6.6 (ไม่มี/หมดอายุ/trust store เปลี่ยน → คำนวณใหม่)
2. `ownerType EXPENSE` + XML อ่านได้ (ผ่านตัวแยกไฟล์แนบแบบมีเพดาน §10.5): `apply(…, { readSource: 'ETAX_XML', sourceDocumentType, ocrDocumentType, … })` (จาก classification ของ XML — §6.7, F5) → manifest (pageCount, หน้า `read`) + observation `ELECTRONIC_DOCUMENT` รูป `ExpenseCaptureAssembledObservations` (1 document) → outcome จาก `common()` ([:712-724](../../apps/api/src/modules/expenses/application/services/expense-capture-read-runner.service.ts)) → `finish()` ไม่เปิด OCR admission ไม่เรียก gateway
3. อ่านไม่ได้ → ทาง AI เดิม
3b. **ทาง AI — หน่วย OCR ที่จองแล้วต้องจบหนึ่งครั้งเสมอ (B7, F2, BL2 v2)**: (1) **กู้ก่อนทุกทางออก**: `finish()` ([:633-704](../../apps/api/src/modules/expenses/application/services/expense-capture-read-runner.service.ts)) ถูกเรียกกับทุกผลลัพธ์ รวมทางออกเร็วก่อน/หลัง admission — `attempts_exhausted`, `ownerStillValid` → `CANCELLED` ([:212](../../apps/api/src/modules/expenses/application/services/expense-capture-read-runner.service.ts) เช่นไฟล์หลักถูกเปลี่ยนหลังรอบก่อน admission แล้วตาย), `source_changed`, เปิดไฟล์ไม่ได้, `PAUSED` — เมื่อ checkpoint ไม่มี `ocrEventId` จะอ่าน event ของ requestId ของงานนี้จาก unique `(companyId, sourceRoute, requestId)` ภายใน transaction ของ finish (helper `findCompanyOcrAdmissionEventId(tx, …)`) จึงคืนหน่วยได้แม้งานจบโดยไม่ถึงขั้น admission ในรอบนี้; (2) **ชดเชยเฉพาะเจ้าของงาน แบบ atomic**: release/settle ย้ายเข้า `$transaction` เดียวกับการเขียนสถานะสุดท้ายแบบ fenced และ outbox (B4) — ลำดับใน tx: `updateJobFenced({ db: tx })` ถ้าได้ 0 แถว (lease หลุด) → rollback ทั้งก้อน **ไม่ชดเชยอะไร**; ได้ → `releaseCompanyOcrAdmissionTx(tx, …)` (ไม่มีผลที่ใช้ได้) หรือ `settleCompanyOcrAdmissionTx(tx, …)` (มีผล) ซึ่งยัง fence ด้วย event id ([company-ocr-governance.ts:483-484, :551](../../apps/api/src/modules/line-ai/application/company-ocr-governance.ts)) และใช้ advisory lock เดิมใน tx เดียวกัน → outbox → commit; ชดเชยล้ม → rollback ทั้งก้อน งานถูก claim ใหม่ได้แล้วชดเชยอีกครั้งแบบ idempotent — runner เก่า (A) ที่ lease หลุดจึงคืนหน่วยของ event ที่ runner ใหม่ (B) กู้ไปใช้ไม่ได้; (3) `admitOcrRead` ได้ `duplicate` โดยไม่มี `ocrEventId` → อ่าน event ด้วย helper เดียวกัน; ไม่พบ (ถูก release แล้ว) → admit ใหม่หนึ่งครั้ง; ได้ eventId แล้ว persist checkpoint แบบ fenced ก่อนเรียก provider ครั้งแรก — persist ไม่สำเร็จ (lease หลุด) → หยุด ไม่เรียก provider และ **ไม่ชดเชย** (finish ของ runner นี้ fenced ล้ม; เจ้าของใหม่กู้ event เองตาม (1)/(3)). ผลคือทุก requestId ที่ admitted จบด้วย release หรือ settle หนึ่งครั้งโดยผู้ถือ lease ที่ commit สถานะสุดท้าย (P9); ใช้กับงานอ่านทุกช่องทางเพราะเป็นบั๊กเดิม (B7); งานจากอีเมลมี requestId คงที่ `email-intake:<fileId>`
4. **`finish()` (แก้ B4 + B6)**: observation (ถ้ามี), สถานะสุดท้าย และ outbox ใน `$transaction` เดียว (`createObservation({ db: tx })`, `updateJobFenced({ db: tx })`, `PrismaOutboxRepository.append(input, tx)` [prisma-outbox.repository.ts:33](../../apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-outbox.repository.ts)); อย่างใดล้ม → rollback ทั้งหมด job ถูก claim ได้อีก (ไม่มี DONE ที่ไม่มี observation หรือ event); `storeObservation` ที่กลืน error ([:509-531](../../apps/api/src/modules/expenses/application/services/expense-capture-read-runner.service.ts)) ถูกแทน

`apply` option `readSource?: 'AI' | 'ETAX_XML'` (ตั้งต้น `AI`): เขียน `readSource` + `readAttachmentId` เสมอ; `ETAX_XML` ไม่รับ `categorySuggestion`; ทุกข้อความที่ระบบเขียนลงรายจ่ายไม่อ้าง AI และไม่อ้าง "e-Tax" เมื่อ `ETAX_XML` (ใช้คำกลาง "ข้อมูล XML ในไฟล์" — F8); เปลี่ยนไฟล์หลัก ([expense-upload.use-case.ts:385-393](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts)) ลบ `readSource`/`readAttachmentId`; หน้าเว็บหาผลตรวจจาก checksum ของไฟล์หลักปัจจุบัน

### 7.5 ตัวประมวลผลอีเมล — ทำต่อจากจุดค้างได้ ไม่เปิด OCR ซ้ำ

timer 30 วิ ([expense-capture-read-worker.ts:11-22](../../apps/workers/src/modules/expense-capture-read/expense-capture-read-worker.ts) เป็นแบบ), lease ต่อข้อความ:

1. จัดผู้ส่ง (§9.1)
2. คัดไฟล์ (`ingestStep = NONE`): magic byte ([attachment.logic.ts:177-191](../../apps/api/src/modules/data-model-core/domain/logic/attachment.logic.ts)) → ขนาด → `inspectAttachmentContent(…, 'receipt')` + ClamAV → ซ้ำ (checksum ตรงไฟล์ ACTIVE ที่ผูกรายจ่าย **ที่ไม่ใช่** `email:${fileId}` → `DUPLICATE` เก็บ `expenseId` ไว้ภายใน แต่ DTO/ข้อความ/ลิงก์ให้เฉพาะผู้ดูหรือผู้ได้รับแจ้งที่ผ่าน `canReadExpense` ของรายการเดิม ไม่งั้น S11t3 — F6) → verification → จับคู่ (§9.3) → ตัดสิน (§9.2) → **จองช่อง auto (F8)** เฉพาะไฟล์ที่ auto (ไม่ใช่ไฟล์ที่คนกดรับ): tx เดียวใต้ `pg_advisory_xact_lock(hashtext('email-intake-auto:' || addressId || ':' || intakeDay))` — ไฟล์มี `autoSlotReservedAt` แล้ว → ใช้ต่อ (ข้าม restart ไม่นับซ้ำ); ไม่มี → นับไฟล์ที่จองแล้วของ (ที่อยู่, วัน) < 50 → ตั้ง `autoSlotReservedAt` ใน tx นั้น; ครบ → `HELD DAILY_LIMIT`; worker สองตัวที่เห็น 49 จึงได้ช่องที่ 50 ตัวเดียว
3. auto — ctx จาก membership ปัจจุบัน แล้วเดินขั้นที่บันทึก (CAS ทุกขั้น):
   - `NONE → EXPENSE_RESERVED`: `InitReceiptUploadUseCase` `emailCapture` จองรายจ่ายก่อนแบบ LINE
   - `→ ATTACHMENT_RESERVED`: attachment ใต้ lock `email-receipt-attachment:${expenseId}` metadata `{ emailReceiptExpenseId }` / `createIntent.resume` (แบบ [:164-179](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts))
   - `→ BYTES_UPLOADED`: PUT ไบต์ (helper คัดลอกจาก `putLineMediaUpload`)
   - `→ COMPLETED`: `CompleteReceiptUploadUseCase` (resume ครอบ `EMAIL_INBOUND` [:358-361](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts)) policy `'receipt'`
   - `→ READ_QUEUED` (atomic — F2/P6/P35): **transaction เดียว** — `SELECT … FROM "InboundEmailFile" WHERE id = $1 FOR UPDATE` → ยืนยัน `ingestStep = COMPLETED` และ lease ของ worker นี้ยังเป็นเจ้าของข้อความ (fenced แบบ `updateJobFenced`) → ค้นงานของ (expense, attachment, checksum) **ทุกสถานะ** (`findAnyJobForAttachment(tx)` ใหม่ — ไม่ใช้ `findLiveJobForAttachment` [:300-311](../../apps/api/src/modules/expenses/infrastructure/prisma-expense-capture.repository.ts)) → ไม่มี: `createReadJob(tx, { …, ocrAdmissionRequestId: 'email-intake:' + fileId })` (ไม่เรียก `queueExpenseRead` ที่สร้าง UUID ใหม่ [expense-capture-line.use-case.ts:71-83](../../apps/api/src/modules/expenses/application/use-cases/expense-capture-line.use-case.ts)) → เขียน `ingestStep = READ_QUEUED` + `readJobId` + `data = null` + `outcome = STORED` → commit แล้วค่อย `runner.kick`; worker ที่สอง (lease หมดแล้วทับซ้อน) รอ row lock แล้วเห็น `READ_QUEUED` จึงหยุด; กันชั้นที่สอง: partial unique index `("companyId", "ocrAdmissionRequestId") WHERE "ocrAdmissionRequestId" LIKE 'email-intake:%'` บน `ExpenseCaptureReadJob` และ admission ใช้ requestId เดียวกันจึงตอบ `duplicate` ไม่คิดซ้ำ
   - `EXPENSE_DRAFT_DELETED` → `SKIPPED DRAFT_DELETED`
4. ชื่อไฟล์ไม่มีนามสกุล → `canonicalAttachmentExtension` ([:193-195](../../apps/api/src/modules/data-model-core/domain/logic/attachment.logic.ts))
5. drain: ปล่อย AWAITING_STAMP ครบ 48 ชม.; purge **รายไฟล์** (F7) — ไฟล์ที่ `dataPurgeAfter` ผ่าน → `data = null` (ลด `storedBytes` ใต้ lock ระดับบริษัท) แถวไฟล์คงอยู่; ลบแถวข้อความ (cascade ไฟล์) **เฉพาะ** เมื่อ `purgeAfter` ผ่านและไม่มีไฟล์ใดมี `expenseId`/`attachmentId` — ข้อความที่มีไฟล์ผูกรายจ่ายเก็บหัวอีเมลที่จำเป็น (R13) ตราบที่รายจ่ายยังอยู่

### 7.6 ค่าตั้ง (ไม่ใช่สวิตช์)

`EMAIL_INTAKE_DOMAIN`, `POSTMARK_INBOUND_STREAM` (ตั้งต้น `inbound`), `POSTMARK_INBOUND_WEBHOOK_USERNAME`, `POSTMARK_INBOUND_WEBHOOK_PASSWORD` — ไม่ใช่ local ต้องครบ ไม่งั้น boot ไม่ขึ้น ([auth.module.ts:81-89](../../apps/api/src/modules/auth/auth.module.ts) เป็นแบบ); `infra/postmark/config.py` (`ENV_KEYS`/`SECRET_KEYS`/`REQUIRED_SECRETS`, โดเมนต่อสภาพแวดล้อม, native preflight inbound แบบอ่านอย่างเดียว) + `config_test.py`

## 8. สิทธิ์ ABAC และขอบเขต tenant

| การกระทำ | เงื่อนไข |
|---|---|
| เปิดแท็บอัปโหลด (เว็บ) | `canUploadReceipts ∨ canManageEmailIntake ∨ isEmailIntakeHandler ∨ canForwardEmail` (`canForwardEmail` = `attachment.create` ∧ (`expense.receipt.upload` ∨ `expense.receipt.line_upload`)) — แก้ gate จริงที่ [expenses.model.ts:1599, :1805](../../apps/web/src/features/expenses/expenses.model.ts); พื้นที่อัปโหลดเดิมยังต้อง `expense.receipt.upload` (สมาชิก LINE อย่างเดียวเห็นเฉพาะการ์ดอีเมลและรายการพักของตัวเอง) |
| เห็นที่อยู่ | `canForwardEmail` ∨ manage ∨ ผู้รับ; บริษัทมี `expenses.upload` |
| ส่งต่อจากอีเมลตัวเอง (MEMBER) | `canForwardEmail` + อีเมลยืนยัน + `DKIM_VALID_AU` |
| ผู้รับเอกสาร | `canForwardEmail` + สาขาตั้งต้นในขอบเขต |
| สร้าง/หมุน/แก้ที่อยู่ | `expense.email_intake.manage` + `expenses.upload` |
| ดู/รับเข้า/ไม่รับ อีเมลที่พัก | manage ∨ ผู้รับ: ทั้งร้าน; สมาชิก: `senderUserId` = ตัวเอง; ผู้กดรับเข้าเป็น acting user จึงต้อง `canForwardEmail` + สาขาเป้าหมายในขอบเขต |
| ร่างที่เกิด | สิทธิ์รายจ่ายเดิม |
| แจ้งเตือน (ส่งจริง + อ่านในกระดิ่ง) | **ใช้ predicate การอ่านรายจ่ายกลาง** ([expense-draft.use-case.ts:225-241](../../apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts) — แยกเป็นฟังก์ชันที่ use case เดิมและ guard ใช้ร่วม) กับ ctx ของผู้รับที่ resolve ใหม่ (`PermissionResolverService.resolveAccess`) รวมขอบเขตสาขา; เรื่องพัก: ยังเป็น manage/ผู้รับ/เจ้าของข้อความ; แหล่งยังอยู่สถานะเดิม — ไม่ผ่าน → `SUPPRESSED`/ซ่อน (ผู้รับที่มีแค่ `expense.receipt.upload` + เป็นผู้สร้างร่าง จึงยังได้แจ้งตามที่ read predicate เดิมอนุญาต); **จำนวนยังไม่อ่าน** (`GetUnreadCountUseCase` [notification.use-cases.ts:47-54](../../apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts)) ใช้ guard เดียวกันกับ event `expense.email_*` และ recipient ที่ไม่ผ่านถูกปิดอ่านโดยระบบ (`dismissedAt`) จึงไม่ค้างในตัวเลขกระดิ่ง (F11) |

- สิทธิ์ใหม่ `expense.email_intake.manage` (MEDIUM) ใน [permission-registry.ts](../../apps/api/src/modules/auth/permission-registry.ts) แม่แบบเดียวกับ `expense.category.manage` (:704, :921), pack [capability-pack.registry.ts:285](../../apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts), ผูก `expenses.upload` ([feature-entitlements.ts:85-90](../../packages/contracts/src/feature-entitlements.ts))
- Tenant จาก `OriginalRecipient` → `localPart`; ทุก query มี `companyId`; ผลตรวจผูก `(companyId, checksum)`

## 9. State transitions

### 9.1 ผู้ส่ง

| ผล | เงื่อนไข |
|---|---|
| `BLOCKED` | `EmailIntakeSender(BLOCKED)` |
| `MEMBER` | From = `User.email` ยืนยันแล้ว, user/membership ACTIVE, `canForwardEmail`, `DKIM_VALID_AU`, ไม่ติดธงสแปม |
| `TRUSTED` | `EmailIntakeSender(TRUSTED)` + `DKIM_VALID_AU` + ไม่ติดธงสแปม |
| `EXTERNAL` | อื่น ๆ (From ตรงสมาชิกแต่ DKIM ไม่ตรง → `SENDER_NOT_CONFIRMED`) |

### 9.2 ข้อความ / ไฟล์

```
RECEIVED ─claim─▶ PROCESSING ─▶ DONE
                      ├─▶ HELD ─accept(tx: targetBranchId, acceptedBy)─▶ RECEIVED ─▶ … ─▶ DONE
                      │     └─discard─▶ DISCARDED ─purge 30 วัน─▶ ลบ
                      └─▶ DISCARDED (BLOCKED / RETIRED / INTAKE_LIMIT)
ไฟล์: NONE ─▶ EXPENSE_RESERVED ─▶ ATTACHMENT_RESERVED ─▶ BYTES_UPLOADED ─▶ COMPLETED ─▶ READ_QUEUED(+readJobId)
AWAITING_STAMP ─คู่ถูกต้อง─▶ PAIRED  ;  ─48 ชม.─▶ ไฟล์ธรรมดา
```
**สถานะข้อความ = สรุปจากไฟล์ (F7)** คำนวณใหม่ใน tx เดียวกับทุกการเปลี่ยนของไฟล์: มีไฟล์ `PENDING`/กำลังเดินขั้น → `RECEIVED`/`PROCESSING`; ไม่มีแต่มี `HELD` → `HELD`; ทุกไฟล์จบ (`STORED`/`DUPLICATE`/`PAIRED`/`SKIPPED`/`REJECTED`) → `DONE`. กด "ไม่รับ" → ไฟล์ `HELD` ที่เหลือเป็น `SKIPPED DISCARDED_BY_USER` (+ `dataPurgeAfter`) และข้อความเป็น `DISCARDED` เฉพาะเมื่อไม่มีไฟล์ใดผูกรายจ่าย (ไม่งั้น `DONE`); ตัวอย่างข้อความผสม: e-Tax ไฟล์หนึ่ง auto เป็นร่างแล้ว + PDF ธรรมดาอีกไฟล์พัก `NEW_SENDER` → ข้อความ `HELD` จนคนเลือก; ไม่รับ PDF นั้นไม่กระทบร่างและหัวอีเมลของ e-Tax. `purgeAfter` ของข้อความตั้งเมื่อจบโดยไม่มีไฟล์ผูกรายจ่ายเท่านั้น

ตัดสินต่อไฟล์:

1. `etaxEligible && VERIFIED` → auto ยกเว้น `BLOCKED`; ผู้ซื้อ 13 หลักใน XML ≠ `Company.taxId` (เมื่อตั้งไว้) → `BUYER_MISMATCH`; 80/81/T07 → `NOT_TAX_DOCUMENT`
2. `MEMBER`/`TRUSTED` → auto
3. ธงสแปม → `SPAM_SUSPECTED`; From ตรงสมาชิกแต่ DKIM ไม่ตรง → `SENDER_NOT_CONFIRMED`; อื่น → `NEW_SENDER`
4. จองช่อง auto ของ (ที่อยู่, วันที่ไทย) ไม่ได้ (ครบ 50) → `DAILY_LIMIT` — จองแบบ atomic + idempotent ตาม §7.5 ข้อ 2 (F8)
5. สาขา: `targetBranchId` → XML สาขาผู้ซื้อในขอบเขต acting user → `defaultBranchId` → สาขาเดียวที่เข้าถึง → `BRANCH_REQUIRED`
6. acting user ไม่ผ่านเงื่อนไข → `HANDLER_UNAVAILABLE`
7. มีแต่ XML → `XML_ONLY`

ผู้ได้รับแจ้งเรื่องพัก: ข้อความ `MEMBER` → สมาชิกคนนั้น (ยกเว้นข้อ 6 → ผู้รับเอกสาร); อื่น ๆ → ผู้รับเอกสาร

**การรับเข้าของคน (`acceptedByUserId` ตั้งแล้ว) — ผลต่อเหตุพัก (F3)**

| เหตุพัก | หลังรับเข้า |
|---|---|
| `NEW_SENDER`, `SENDER_NOT_CONFIRMED`, `SPAM_SUSPECTED`, `DAILY_LIMIT` | ข้าม — คนตัดสินแล้วสำหรับข้อความนี้ |
| `BUYER_MISMATCH`, `NOT_TAX_DOCUMENT` | ข้าม — สร้างร่างตามที่คนเลือก (review reason/ป้ายเดิมยังแสดง) |
| `BRANCH_REQUIRED` | ใช้ `targetBranchId` ที่บันทึก (รับเข้าไม่ได้ถ้าไม่เลือกสาขา — 422 `email_intake_branch_required`) |
| `HANDLER_UNAVAILABLE` | acting user = ผู้กดรับ ต้องผ่าน `canForwardEmail` + สาขาเป้าหมายในขอบเขต ตรวจซ้ำตอนประมวลผล ไม่ผ่าน → พักอีกครั้งเหตุ `HANDLER_UNAVAILABLE` |
| `XML_ONLY` | รับเข้าไม่ได้ (ไม่มีปุ่ม) |
| ผลการตรวจความปลอดภัย (ชนิด, ขนาด, `inspectAttachmentContent`, ClamAV) | **ไม่ข้ามเด็ดขาด** — ไฟล์ที่ไม่ผ่านเป็น `REJECTED` ไม่เคยถูกพัก; ถ้า `verifierVersion` ของตัวตรวจเปลี่ยนระหว่างพัก ตรวจซ้ำก่อนเดินขั้นต่อ |

### 9.3 จับคู่ e-Tax by Time Stamp

- PDF ไม่มีตราประทับ ETDA + หัวเรื่องตรง R9 → `AWAITING_STAMP` (`stampSubjectKey`, `stampSellerTaxId` จาก text layer)
- ฉบับ `ETDA_TIME_STAMP` ผ่าน → สร้างตาม 9.2 แล้วหาคู่ในบริษัทเดียวกันภายใน 7 วัน ต้องเข้าข้อใดข้อหนึ่ง:
  - (ก) **ไบต์**: sha256 ของ revision ก่อนตราประทับ (0 ถึงปลาย `%%EOF` ที่ trailer `/Prev` ชี้ — ไม่ใช่ส่วนแรกของ ByteRange R20) = checksum ของไฟล์ที่รอ; หาขอบไม่ได้ → (ข)
  - (ข) **เนื้อหา**: `stampSubjectKey` ตรง **และ** text layer ทั้งสองไฟล์มีเลขผู้ขาย 13 หลักเดียวกัน (checksum ผ่าน) **และ** เลขที่เอกสารจากหัวเรื่องปรากฏทั้งสองไฟล์
  - ไม่เข้า → ไม่จับคู่
- จับคู่: ไฟล์ที่รอ → `PAIRED` + `pairedFileId`, ไม่ลบไบต์ทันที (`purgeAfter` 30 วัน)
- ครบ 48 ชม. (R8b) → ไฟล์ธรรมดา ตัดสินตามผู้ส่ง; สร้างร่างได้ → S23
- ฉบับประทับเวลามาหลังปล่อยและคู่ถูกต้อง: รายจ่ายยังเปิดแก้ได้ → replace (provenance รีเซ็ต); แทนไม่ได้ → แนบเป็น `expense.receipt.supporting` (ได้ผลตรวจตอนแนบตาม §7.4) + S23b; ไม่สร้างรายจ่ายใหม่
- ฉบับประทับเวลามาก่อน → ฉบับร่างที่ตามมาจับคู่ด้วยเงื่อนไขเดียวกัน

### 9.4 ผลตรวจไฟล์

ตัวตรวจอ่าน PDF ด้วยตัวแยกแบบมีเพดาน (§10.5) ไม่ใช้ pdf-lib load (R24)

**ByteRange ถูกต้อง** (ทุกข้อ): จำนวนเต็มไม่ติดลบ 4 ค่า `[0, a, b, c]`; `0 < a < b`; `b + c ≤ fileLength`; ช่อง `[a, b)` = `<hex>` ของ `/Contents` ของดิกชันนารีลายมือชื่อนี้พอดี; ดิกชันนารีลายมือชื่ออยู่ในส่วนที่ครอบ; ช่องว่างเดียว — ไม่ครบ → `FAILED INVALID_BYTE_RANGE`; `b + c < fileLength` → `UNAVAILABLE CONTENT_AFTER_SIGNATURE`; ลายมือชื่อ ≤ 5 ชุดต่อไฟล์ (เกิน → `UNAVAILABLE UNSUPPORTED_SIGNATURE`)

**วัตถุประสงค์ใบรับรอง (F5, R22)**: ผู้ลงนาม — มี KeyUsage ต้องรวม `digitalSignature` หรือ `nonRepudiation`; มี EKU ต้องรวมค่าที่อยู่ในรายการเอกสารใน trust manifest (`anyExtendedKeyUsage`, `id-kp-documentSigning` 1.3.6.1.5.5.7.3.36, `emailProtection` 1.3.6.1.5.5.7.3.4, Adobe 1.2.840.113583.1.1.5, Microsoft 1.3.6.1.4.1.311.10.3.12 — รายการยืนยันกับไฟล์จริง MC14); EKU มีแต่ `serverAuth`/`clientAuth` → `FAILED CERT_PURPOSE_INVALID`. TSA — EKU ต้องเป็น `id-kp-timeStamping` อย่างเดียวและ critical ไม่ใช่ → token นั้นไม่ใช่เวลาที่เชื่อถือได้

**เวลา**: genTime ของ RFC 3161 token ที่ตรวจผ่าน (TSA ถึง trust store + R22 + messageImprint ตรง); ไม่มี → ตรวจ ณ ตอนนี้ (`VALIDATION_TIME`); ใบรับรองหมดอายุแล้วและไม่มีเวลาที่เชื่อถือได้ → `UNAVAILABLE NO_TRUSTED_TIME`; ไม่ใช้ `signingTime` (R19)

| ผล | เมื่อ | reasonCode |
|---|---|---|
| `NOT_CHECKED` | ไม่ใช่ PDF หรือไม่มีลายมือชื่อ/ตราประทับ | null |
| `VERIFIED` | P1 ครบ | null |
| `FAILED` (พิสูจน์ได้ว่าผิด) | ByteRange ผิดรูป / digest ไม่ตรง / CMS ไม่ถูก / วัตถุประสงค์ใบรับรองผิด / ใบรับรองไม่มีผล ณ genTime | `INVALID_BYTE_RANGE` / `MODIFIED_AFTER_SIGNING` / `SIGNATURE_INVALID` / `CERT_PURPOSE_INVALID` / `CERT_NOT_VALID_AT_SIGNING` |
| `UNAVAILABLE` (ยืนยันไม่ได้) | สายใบรับรองถึง trust store ไม่ได้ (ขาด intermediate, รากใน bundle เก่า) / ไบต์ต่อท้าย / ไม่มีเวลาที่เชื่อถือได้ / ไม่รองรับ / เสียหรือเข้ารหัส / ล้มหรือเกิน 2 วิ | `CHAIN_NOT_ESTABLISHED` / `CONTENT_AFTER_SIGNATURE` / `NO_TRUSTED_TIME` / `UNSUPPORTED_SIGNATURE` / `CORRUPT_OR_ENCRYPTED` / `VERIFIER_ERROR` |

**`etaxCandidate`** = มี XML root namespace R3 ฝังอยู่ หรือ document timestamp ที่ subject ของ TSA ตรงรายการ ETDA ใน manifest หรือมาพร้อมหัวเรื่อง R9

**`etaxEligible`** = `VERIFIED` และอย่างใดอย่างหนึ่ง (ไม่ผ่าน → `etaxIneligibleReason`):
- `ETAX_PDF_XML` (F4): (1) XMP metadata ของ catalog (`/Metadata`, ขยายแบบมีเพดาน) ประกาศ `pdfaid:part="3"` → ไม่มี `NO_PDFA3_DECLARATION`; (2) โครงไฟล์แนบ: มี embedded XML ETDA **หนึ่งไฟล์เท่านั้น** (นับตามตัวตน Filespec/embedded stream ที่ไม่ซ้ำ — ไฟล์เดียวกันที่ถูกอ้างทั้งจาก `Names/EmbeddedFiles` และ `Catalog/AF` นับหนึ่ง), Filespec ของมันอยู่ในทั้ง `Catalog/AF` และ `Names/EmbeddedFiles`, `/AFRelationship` เป็น **`Alternative` เท่านั้น** (R6), `/Subtype` เป็น `text/xml` (เขียน `text#2Fxml` ได้) → ไม่ครบ `ATTACHMENT_PROFILE_INVALID`; (3) PAdES ครอบทั้งไฟล์ (จึงครอบ XML); (4) TypeCode ในชุด 388/T01–T06/380 (`TYPECODE_NOT_ELIGIBLE`); (5) มีเลขผู้ขาย (`NO_SELLER_TAX_ID`) → `method ETAX_PDF_SIGNATURE`
- `ETAX_TIME_STAMP_PDF`: document timestamp `ETSI.RFC3161` จาก TSA ที่ตรงรายการ ETDA (ชื่อ + fingerprint) และไฟล์ประกาศ PDF/A-3 (R8) → `method ETDA_TIME_STAMP`; TSA อื่น → `TSA_NOT_ETDA`

`VERIFIED` อื่น ๆ → `method PDF_SIGNATURE`, `etaxEligible = false`: ไม่แสดงป้าย ไม่มี `verifiedElectronicFile`

`verifiedElectronicFile` (เดิมชื่อ `electronicOriginal` — เปลี่ยนชื่อเพราะไม่ได้ตรวจสิทธิ์ผู้ออก, F1) = มีไฟล์ใบเสร็จที่ผูกกับรายจ่าย (หลักหรือประกอบ — ทั้งคู่ได้ผลตรวจตอนอัปโหลด §7.4) ที่ `etaxEligible && VERIFIED` จากแถวที่ใช้ได้ และ `sourceDocumentType = TAX_INVOICE` (มาจาก classification ของ XML — F5). **ความหมายเท่านี้**: ไฟล์อิเล็กทรอนิกส์ตรงรูปแบบ e-Tax ลงนาม/ประทับเวลาถูกต้อง และไม่ถูกแก้ — ไม่ได้บอกว่าผู้ขายอยู่ในรายชื่อตาม กฎกระทรวง 384 ข้อ 12 หรือว่าใช้ภาษีซื้อได้ (P4)

### 9.5 ที่อยู่

`(ไม่มี) ─create─▶ ACTIVE ─rotate─▶ RETIRED + ACTIVE ใหม่ (tx เดียว)`; `ACTIVE ─patch─▶ ACTIVE (revision+1)`

## 10. UI — เว็บ (390 / 1280 / ~1,556 px) และ LINE

### 10.1 การ์ด "ส่งบิลทางอีเมล" ในแท็บ ค่าใช้จ่าย › อัปโหลด ([ExpensesPages.tsx:3491](../../apps/web/src/features/expenses/ExpensesPages.tsx))

- 390 px: การ์ดเต็มกว้างต่อจากพื้นที่อัปโหลด (บนสุดเมื่อไม่มีสิทธิ์อัปโหลดเว็บ); ที่อยู่ `break-all`; ปุ่มกลุ่มเดียวกัน `grid-cols-2` เท่ากัน ≥ 44 px
- 1280 และ ~1,556 px: `lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]` ซ้ายพื้นที่อัปโหลด ขวาการ์ด (ไม่มีพื้นที่อัปโหลด → การ์ดและรายการพักเต็มกว้าง); ใต้ลงมาเต็มกว้างคือตาราง "อีเมลรอรับเข้า"
- dialog ใช้ action bar ด้านล่าง ปุ่มเท่ากัน

### 10.2 ข้อความ

| # | ข้อความ | ที่แสดง |
|---|---|---|
| S1 | ส่งบิลทางอีเมล | หัวการ์ด |
| S2 | ให้ผู้ขายส่ง PDF หรือรูปไม่เกิน {ขนาด} MB มาที่อีเมลนี้ | ใต้หัว |
| S3 | ผู้รับเอกสาร: {ชื่อ} | ใต้ที่อยู่ |
| S3b | ผู้รับเอกสารใช้งานไม่ได้แล้ว เลือกคนใหม่ | `handlerEligible=false` (+ [เปลี่ยนผู้รับเอกสาร] ผู้ดูแล) |
| S4 | ส่งต่อจาก {อีเมลของคุณ} ได้ ระบบตรวจว่าเป็นคุณก่อนบันทึกเป็นรายการของคุณ | `myForwardEligible` |
| S4b | ยืนยันอีเมลในบัญชีของคุณก่อน จึงส่งต่อบิลจากอีเมลตัวเองได้ | `canForwardEmail` แต่ไม่มีอีเมลยืนยัน + [ไปตั้งค่าบัญชี] |
| S5 | ร้านยังไม่มีอีเมลรับบิล | ไม่มีที่อยู่ + manage → [สร้างอีเมลรับบิล] |
| S6 | ร้านยังไม่มีอีเมลรับบิล ผู้ดูแลรายจ่ายของร้านสร้างได้ที่หน้านี้ | ไม่มีที่อยู่ + ไม่ใช่ manage |
| S7 | เลือกคนที่รับเอกสารจากผู้ขาย ระบบแจ้งคนนี้คนเดียว | dialog สร้าง [สร้าง] [ยกเลิก] |
| S7t | สร้างอีเมลรับบิลแล้ว คัดลอกไปให้ผู้ขายได้เลย | toast |
| S8 | เอกสารที่เข้ามาหลังจากนี้จะไปที่ผู้รับเอกสารคนใหม่ | dialog [บันทึก] [ยกเลิก] |
| S9 | อีเมลเดิมจะรับเอกสารไม่ได้ทันที แจ้งอีเมลใหม่ให้ผู้ขายด้วย | dialog [ขออีเมลใหม่] [ยกเลิก] |
| S9t | ได้อีเมลใหม่แล้ว อีเมลเดิมไม่รับเอกสารแล้ว | toast |
| S10 | อีเมลรอรับเข้า ({n}) | หัวตาราง (n > 0) |
| S10h | กดรับเพื่อสร้างรายการรอตรวจ หรือกดไม่รับ | ใต้หัว |
| S11 | สร้างรายการรอตรวจจาก {n} ไฟล์ของ {ผู้ส่ง} | dialog + checkbox "รับจากผู้ส่งนี้เองครั้งต่อไป" (+ สาขาเมื่อ `BRANCH_REQUIRED`) [รับเข้า] [ยกเลิก] |
| S11d | ยืนยันผู้ส่งไม่ได้ จึงจำผู้ส่งนี้ไม่ได้ | แทน checkbox เมื่อ `senderConfirmed=false` |
| S11t | รับเข้าแล้ว ระบบกำลังอ่านเอกสาร | toast มีร่าง ≥ 1 |
| S11t2 | ไฟล์นี้มีในร้านแล้ว เปิดรายการเดิมได้ | toast ทุกไฟล์ซ้ำ และผู้กดผ่าน `canReadExpense` ของรายการเดิมทุกรายการ (+ ลิงก์) |
| S11t3 | ไฟล์นี้มีในร้านแล้ว ถามผู้ดูแลรายจ่ายถ้าต้องการดูรายการเดิม | toast ทุกไฟล์ซ้ำ แต่ผู้กดอ่านรายการเดิมไม่ได้อย่างน้อยหนึ่งรายการ — ไม่มีลิงก์และไม่ส่ง `expenseId` (F6) |
| S12 | ไม่รับเอกสารนี้ ไฟล์ที่พักไว้ในร้านจะถูกลบภายใน 30 วัน | dialog + checkbox "ไม่รับจากผู้ส่งนี้อีก" [ไม่รับ] [ยกเลิก] |
| S12t | ไม่รับแล้ว | toast |
| C1–C9 | ผู้ส่งใหม่ · ยืนยันผู้ส่งไม่ได้ · อาจเป็นอีเมลขยะ · ผู้ซื้อในใบไม่ใช่ร้านนี้ · ต้องเลือกสาขา · มีแต่ไฟล์ XML · ใบเพิ่มหนี้/ลดหนี้/ยกเลิก · ยังไม่มีผู้รับเอกสาร · เกินจำนวนต่อวัน | chip เหตุพัก |
| C6h | ขอไฟล์ PDF จากผู้ขาย แล้วให้ส่งมาใหม่ | ใต้ "มีแต่ไฟล์ XML" (มีแต่ [ไม่รับ]) |
| S13a | รูปแบบ e-Tax · ลงนามด้วยใบรับรองที่รัฐรับรอง ไฟล์ไม่ถูกแก้ | `etaxEligible` + `ETAX_PDF_SIGNATURE`; รอง "ลงนามโดย {signerName}" + (`timestampedAt` ? " · ประทับเวลา {วันที่}" : "") |
| S13b | รูปแบบ e-Tax · ประทับเวลาโดย สพธอ. ไฟล์ไม่ถูกแก้ | `etaxEligible` + `ETDA_TIME_STAMP`; รอง "ประทับเวลาเมื่อ {วันที่}" |
| S13c | ไฟล์ถูกแก้หลังลงนาม ขอไฟล์ต้นฉบับจากผู้ขาย | `MODIFIED_AFTER_SIGNING` |
| S13d | ลายมือชื่อในไฟล์ไม่ถูกต้อง ขอไฟล์ใหม่จากผู้ขาย | `SIGNATURE_INVALID`, `INVALID_BYTE_RANGE` |
| S13e | ใบรับรองของผู้ลงนามไม่ได้ออกมาสำหรับลงนามเอกสาร ขอไฟล์ใหม่จากผู้ขาย | `CERT_PURPOSE_INVALID` |
| S13f | ใบรับรองของผู้ลงนามใช้ไม่ได้ ณ เวลาที่ประทับ ขอไฟล์ใหม่จากผู้ขาย | `CERT_NOT_VALID_AT_SIGNING` |
| S13g | ระบบยืนยันลายมือชื่อในไฟล์นี้ไม่ได้ ตรวจเองได้ที่ validation.teda.th | `UNAVAILABLE` ทุกเหตุ (รวม `CHAIN_NOT_ESTABLISHED`) เฉพาะ `etaxCandidate` |
| S14 | กรอกจากข้อมูลในไฟล์รูปแบบ e-Tax แล้ว ตรวจก่อนยืนยัน | banner เมื่อ `readFromXml` **และ** ไฟล์หลัก `etaxEligible && VERIFIED` (คำนวณตอนแสดง) |
| S14n | กรอกจากข้อมูล XML ในไฟล์แล้ว ตรวจก่อนยืนยัน | banner เมื่อ `readFromXml` แต่ไม่ eligible หรือไม่ VERIFIED |
| S14b | ข้อมูลจากไฟล์รูปแบบ e-Tax (ต้องตรวจสอบก่อนยืนยัน) | หัวกล่อง เงื่อนไขเดียวกับ S14 |
| S14bn | ข้อมูลจาก XML ในไฟล์ (ต้องตรวจสอบก่อนยืนยัน) | หัวกล่อง เงื่อนไขเดียวกับ S14n |
| S15 | ข้อมูล XML ในไฟล์ไม่ตรงกับตัวเลขที่เห็นในเอกสาร ตรวจกับเอกสารก่อนยืนยัน | review reason (ข้อความเก็บถาวร จึงเป็นคำกลาง) |
| S16 | อีเมล | `CAPTURE_SOURCE_LABELS.EMAIL_INBOUND` |
| S17 | แนบไฟล์อิเล็กทรอนิกส์ที่ลงนามถูกต้องแล้ว | ป้ายเงื่อนไข `PAPER_ATTACHED` เมื่อ `verifiedElectronicFile` (ไม่ใช้คำว่า "ตัวจริง" — F1) |
| S18 | ไฟล์ PDF นี้มีไฟล์อื่นแนบอยู่ข้างในที่ระบบรับไม่ได้ ขอไฟล์จากต้นทางที่ไม่มีไฟล์แนบ หรือถ่ายรูปเอกสารแทน | เว็บ `'PDF embedded file is not allowed.'` |
| S18b | ระบบตรวจไฟล์ PDF นี้ไม่ได้ จึงไม่รับ ขอไฟล์ใหม่จากต้นทาง หรือถ่ายรูปเอกสารแทน | เว็บ `'PDF could not be inspected.'` (เกินเพดาน/ชื่ออำพราง/filter ไม่รองรับ) |
| S18L | {ไฟล์}มีไฟล์อื่นแนบอยู่ข้างในที่ระบบรับไม่ได้ค่ะ จึงยังไม่ได้เก็บไฟล์นี้ — ถ่ายรูปเอกสารส่งมาแทนได้เลยค่ะ | LINE `EMBEDDED_FILE_REJECTED` |
| S18Lb | ระบบตรวจ{ไฟล์}ไม่ได้ค่ะ จึงยังไม่ได้เก็บไฟล์นี้ — ขอไฟล์ใหม่จากต้นทางหรือถ่ายรูปเอกสารส่งมาแทนได้เลยค่ะ | LINE `CONTENT_UNINSPECTABLE` |
| S19 | ได้รับเอกสารทางอีเมล | หัว (ร่างจากผู้ขาย) |
| S19b | {ผู้ขาย} ยอด {ยอด} บาท พร้อมให้ตรวจแล้วค่ะ | ไฟล์เดียว [ดูในแชต] [เปิดในเว็บ] — การ์ดที่เปิดในแชตแสดงเฉพาะปุ่มที่ผู้รับมีสิทธิ์ (`LineExpenseActionService` [line-expense-action.service.ts:1009-1012](../../apps/api/src/modules/line-ai/application/line-expense-action.service.ts)) |
| S19c | ได้รับ {n} ฉบับจาก {ผู้ส่ง} พร้อมให้ตรวจแล้วค่ะ | หลายไฟล์ [เปิดในเว็บ] |
| S19d | ได้รับเอกสารจาก {ผู้ส่ง} อ่านได้ไม่ครบ เปิดตรวจในเว็บได้เลยค่ะ | อ่านไม่ครบ [เปิดในเว็บ] |
| S20 | อีเมลรอรับเข้า | หัว (พัก) — แจ้งเตือน `expense.email_held` (ACTION) อยู่ใน "ยังรออยู่" (F9) |
| S20r | อีเมลรับเข้าแล้ว / อีเมลไม่รับแล้ว | หัวของแจ้งเตือนที่จบแล้ว (`finishedNoticeTitle` แทนคำว่า "รอรับเข้า") ตามสถานะข้อความ |
| S20b | {ผู้ส่ง} ส่งเอกสาร {n} ไฟล์ เลือกรับหรือไม่รับในเว็บได้เลยค่ะ | ภายนอก → ผู้รับเอกสาร [เปิดในเว็บ] |
| S20c | อีเมลที่คุณส่งต่อรอให้คุณเลือก{เหตุ} เลือกในเว็บได้เลยค่ะ | สมาชิก → สมาชิก ({เหตุ}: "สาขา" / " เพราะเกินจำนวนต่อวัน") [เปิดในเว็บ] (ลิงก์ LINE handoff เข้าเว็บ) |
| S21 | รับบิลจากอีเมลของคุณแล้ว | หัว (สมาชิก) |
| S21b | {ผู้ขาย} ยอด {ยอด} บาท ตรวจแล้วกดยืนยันได้เลยค่ะ | สมาชิกมี `expense.confirm` [ดูในแชต] [เปิดในเว็บ] |
| S21c | {ผู้ขาย} ยอด {ยอด} บาท ตรวจแล้วกดส่งตรวจได้เลยค่ะ | สมาชิกไม่มี `expense.confirm` แต่มี `expense.update` (ส่งตรวจ = `MARK_READY` ของผู้สร้าง [line-expense-action.service.ts:1011](../../apps/api/src/modules/line-ai/application/line-expense-action.service.ts)) [ดูในแชต] [เปิดในเว็บ] |
| S21d | {ผู้ขาย} ยอด {ยอด} บาท เปิดดูรายการในเว็บได้เลยค่ะ | สมาชิกไม่มีทั้งสองสิทธิ์ [เปิดในเว็บ] |
| S22 | ไฟล์ {ชื่อ} รับไม่ได้ เพราะ{เหตุ} ส่งเป็น PDF หรือรูป JPG/PNG ไม่เกิน {ขนาด} MB ได้เลยค่ะ | สมาชิก + REJECTED |
| S23 | ยังไม่ได้รับไฟล์ประทับเวลาจาก สพธอ. ระบบสร้างรายการจากไฟล์ของผู้ขายให้ตรวจแล้วค่ะ | 48 ชม. แล้วสร้างร่าง |
| S23b | ได้รับไฟล์ประทับเวลาจาก สพธอ. แล้ว แนบกับรายการเดิมแล้วค่ะ | ฉบับประทับเวลามาหลังปล่อย |
| S24 | อีเมลรับบิลของร้านอยู่ที่หน้าค่าใช้จ่าย › อัปโหลด ถ้ายังไม่มี ผู้ดูแลรายจ่ายสร้างได้ที่หน้าเดียวกันค่ะ ไฟล์ที่ส่งเข้ามาจะเป็นรายการรอตรวจหรือรอให้คนกดรับ ระบบไม่ยืนยันให้เองค่ะ | การ์ดช่วยเหลือ `expense.email-intake` [เปิดหน้าอัปโหลด] |
| S25 | อ่านจากข้อมูลในไฟล์รูปแบบ e-Tax | หมายเหตุการ์ดร่าง LINE เงื่อนไขเดียวกับ S14 (คำนวณตอนสร้างการ์ด) |
| S25n | อ่านจากข้อมูล XML ในไฟล์ | หมายเหตุการ์ดร่าง LINE เงื่อนไขเดียวกับ S14n |
| S26 | วันนี้มีอีเมลเข้าเกินจำนวนที่รับได้ อีเมลที่เกินไม่ได้เก็บไว้ ให้ผู้ขายส่งใหม่พรุ่งนี้ | ผู้รับเอกสาร ครั้งเดียวต่อวัน |
| S27 | ผู้ให้บริการรับอีเมลเก็บสำเนาอีเมลที่ส่งเข้ามาไว้ {n} วันแล้วลบเอง ส่วนไฟล์ที่ร้านไม่รับ ระบบลบสำเนาในร้านภายใน 30 วัน | คู่มือส่วนอีเมลรับบิล (`email-intake-guide.content.ts`) + ROPA; {n} = ค่าคงที่ `EMAIL_PROVIDER_RETENTION_DAYS` ตามผล Q3 (F11) |

LINE ใช้ปุ่มเสมอ; น้องมั่งมีลงท้าย "ค่ะ" เฉพาะประโยคคำพูด

### 10.3 ตารางความจริง surface × case

| ประโยค | แสดงเมื่อ | ห้ามแสดงเมื่อ | จริงทุกกรณีเพราะ |
|---|---|---|---|
| S2 | มีที่อยู่ ACTIVE | ไม่มี | คำแนะนำ ไม่อ้างผล |
| S3/S3b | มีที่อยู่ | — | `handlerEligible` ตรวจเงื่อนไขเต็มตอนอ่านหน้า |
| S4/S4b | `canForwardEmail` | ไม่มีสิทธิ์ | S4 บอกว่าตรวจก่อน ไม่สัญญาผล |
| S5/S6 | ไม่มีที่อยู่ | มีที่อยู่ | S6 ชี้คนที่ทำได้ |
| S7 | dialog สร้าง | — | เอกสารผู้ขายแจ้งผู้รับคนเดียว |
| S8, S9/S9t | เปลี่ยนผู้รับ/หมุน | — | มีผลกับของที่เข้าหลังจากนั้น; RETIRED ใน tx เดียว |
| S10h, S11 | มีรายการพักที่รับได้ | XML_ONLY | ปุ่มตาม `allowedActions` |
| S11t/S11t2/S11t3/S12/S12t | หลังกด | S11t2 เมื่อผู้กดอ่านรายการเดิมไม่ได้ (ใช้ S11t3) | ตามผลจริง; S12 สัญญาเฉพาะสำเนาในร้าน (purge รายไฟล์ 30 วัน §7.5) ไม่พูดถึงสำเนาที่ผู้ให้บริการ — ระยะนั้นอยู่ใน S27 (F11) |
| S13a | `etaxEligible` + `ETAX_PDF_SIGNATURE` | `PDF_SIGNATURE`, ไม่ VERIFIED | "รัฐรับรอง" = ถึงราก NRCA; "ไม่ถูกแก้" = ByteRange + digest; "รูปแบบ e-Tax" = คุณสมบัติไฟล์ §9.4; ไม่อ้างเรื่องเพิกถอน PDF/A เต็มรูป หรือว่าผู้ขายอยู่ในรายชื่อตาม กฎกระทรวง 384 ข้อ 12 (F1) |
| S13b | `etaxEligible` + `ETDA_TIME_STAMP` | TSA อื่น | method นี้ให้เฉพาะ TSA ตรง manifest |
| S13c–f | `FAILED` ตามเหตุ (ไฟล์ที่มีลายมือชื่อ) | — | ทุกเหตุพิสูจน์จากไฟล์ได้ (ไม่รวมกรณียืนยันสายไม่ได้) |
| S13g | `UNAVAILABLE` + `etaxCandidate` | ไฟล์ธรรมดา | บอกว่าระบบยืนยันไม่ได้ ไม่ได้บอกว่าไฟล์หรือใบรับรองผิด (F16) |
| S14/S14b/S25 | `readFromXml` ∧ ไฟล์ `readAttachmentId` มีแถว verification ที่ใช้ได้ (§6.6) เป็น `etaxEligible && VERIFIED` ตอนแสดง | ไม่ eligible, ไม่ VERIFIED, แถวหมดอายุ/trust store เปลี่ยน (ใช้ S14n/S14bn/S25n แทน), ค่าจาก AI, ไฟล์หลักเปลี่ยน | คำว่า "e-Tax" อ้างเฉพาะไฟล์ที่ระบบยืนยันแล้ว (F8); คำนวณตอนแสดงจึงตามผลตรวจล่าสุด |
| S14n/S14bn/S25n | `readFromXml` แต่ไม่เข้าเงื่อนไขบน | ค่าจาก AI, ไฟล์หลักเปลี่ยน | บอกแค่ว่าอ่านจาก XML ในไฟล์ ซึ่งจริงเสมอเมื่อ `readSource = ETAX_XML` |
| S15 | text layer ไม่มีเลขที่/ยอดตาม XML | ไม่มี text layer | ข้อเท็จจริงจากการเทียบ; ข้อความเก็บถาวรจึงใช้คำกลาง "ข้อมูล XML" ไม่อ้าง e-Tax |
| S17 | `verifiedElectronicFile` | อื่น ๆ | บอกเฉพาะสิ่งที่ตรวจ (ลายมือชื่อ/ตราประทับ + ไม่ถูกแก้); ไม่อ้าง "ตัวจริง" หรือสิทธิ์ผู้ออก (R1, F1); เงื่อนไขผ่านอยู่แล้วเพราะมีไฟล์แนบ ป้ายนี้แค่บอกชนิดไฟล์ |
| S18/S18L | embedded ที่ไม่ใช่ XML e-Tax | active content (ข้อความเดิม) / ตรวจไม่ได้ (S18b) | บอกสิ่งที่พบ |
| S18b/S18Lb | ตรวจไม่ได้ตาม P8 | ตรวจได้ | ไม่กล่าวหาไฟล์ บอกทางออก |
| S19b | ไฟล์เดียว อ่านได้ผู้ขายและยอด | อ่านไม่ครบ (S19d) | ค่าจากร่างที่บันทึก; ตรวจสิทธิ์ซ้ำด้วย predicate กลาง; ไม่สัญญาการกระทำ — การ์ดที่ [ดูในแชต] เปิดคำนวณปุ่มตามสิทธิ์ผู้รับเอง |
| S21b / S21c / S21d | สมาชิก: มี `expense.confirm` / ไม่มีแต่มี `expense.update` / ไม่มีทั้งสอง (resolve สิทธิ์ใหม่ตอนส่ง ด้วยสาขาของร่าง) | สลับกันไม่ได้; อ่านไม่ครบ (S19d) | ประโยคบอกเฉพาะการกระทำที่ผู้รับทำได้จริงตามกติกาเดียวกับ [line-expense-action.service.ts:1009-1012](../../apps/api/src/modules/line-ai/application/line-expense-action.service.ts) (F9); S21d ไม่มี [ดูในแชต] เพราะการ์ดในแชตจะไม่มีปุ่มให้กด |
| S19c | ร่าง ≥ 2 | — | ครั้งเดียวเมื่อไฟล์สุดท้ายจบ |
| S20b/S20c | พัก (ภายนอก/สมาชิก) | — | ผู้ได้รับแจ้งตาม §9.2; สมาชิกเปิดแท็บได้ตาม §8 |
| S22 | สมาชิก + REJECTED | ภายนอก | เหตุตาม reasonCode |
| S23/S23b | ตาม §9.3 | เขียนไม่สำเร็จ | ส่งหลังเขียนสำเร็จ |
| S24 | การ์ดเดียว: `requiredPermissions: ['attachment.create']` **และ** `permissionAnyOf: ['expense.receipt.upload', 'expense.receipt.line_upload', 'expense.email_intake.manage']` — โมเดลการ์ดรองรับ AND + any-of อยู่แล้ว ([approved-knowledge.ts:113-114](../../apps/ai-gateway/src/modules/line-ai/agents/approved-knowledge.ts), F10) จึงรวมสมาชิก LINE ที่ส่งต่อได้ | ไม่มี `attachment.create` (เช่น manage อย่างเดียว — ได้คำตอบจำกัดสิทธิ์เดิม ไม่ผิดแต่ไม่ครบ) | ทุกคนที่ได้การ์ดผ่าน gate แท็บ §8 (`canForwardEmail` หรือ `canManageEmailIntake`) จึงเปิดแท็บได้แน่; ครอบร้านที่มี/ไม่มีที่อยู่ และ auto/พัก |
| S26 | มี `INTAKE_LIMIT` วันนั้น | — | ข้อความที่เกินไม่ถูกเก็บจริง |
| S20 / S20r | `expense.email_held` และข้อความยัง HELD / ข้อความไม่ HELD แล้ว (รับเข้า ไม่รับ หรือ purge) | สลับกัน | สถานะอ่านจากแถวข้อความตอนแสดง (`completedDocumentNotificationIds`) จึงไม่ค้างใน "ยังรออยู่" |
| S27 | คู่มือ + ROPA | — | {n} มาจากค่าคงที่เดียว ต้องตรงกับค่าตั้งบัญชี Postmark (MC3) |

### 10.4 หน้าตรวจรายจ่าย

- chip ข้างชื่อไฟล์หลัก (และไฟล์ประกอบที่ `etaxEligible`); ลิงก์ validation.teda.th แท็บใหม่ `noopener noreferrer`
- banner/กล่องสลับตาม `readFromXml` ([ExpenseReviewPage.tsx:1715-1745](../../apps/web/src/features/expenses/ExpenseReviewPage.tsx)); ป้าย S17 ([ExpenseInputVatRight.tsx:92](../../apps/web/src/features/expenses/ExpenseInputVatRight.tsx))

### 10.5 ตัวตรวจ PDF — แบบมีเพดาน ไม่ใช้ pdf-lib ในเส้นอัปโหลด

**ขั้นแรก — B1 ปล่อยเดี่ยว ทุกผู้เรียก (F1, F2)**: `inspectAttachmentContent(mime, bytes, policy: 'strict' | 'receipt')` (async) แทน `inspectAttachmentBytes` ที่ 6 จุด:

0. **ตัวแยกคำแบบมีเพดาน แทนการตัด payload ด้วย regex** (F1/P4): regex เดิม `/>>\s*stream\b[\s\S]*?endstream/g` ([attachment.logic.ts:203](../../apps/api/src/modules/data-model-core/domain/logic/attachment.logic.ts)) **เลิกใช้** — literal string `(>> stream)` ก่อน catalog ทำให้ regex กลืนดิกชันนารี `/OpenAction`, `/JS` ทั้งหมดจนถึง `endstream` จริงตัวถัดไป และการขยาย object stream ก็เอากลับมาไม่ได้. ตัวใหม่อ่านไบต์ตามกฎ lexical ของ ISO 32000-1 §7.2–7.3 (R21) ครั้งเดียวจากต้นไฟล์:
   - whitespace = NUL `0x00`, HT, LF, FF, CR, space; delimiter = `( ) < > [ ] { } / %`
   - comment `%` ถึงท้ายบรรทัด ข้ามเฉพาะเมื่ออยู่นอก string
   - literal string `( … )` นับวงเล็บซ้อน, `\` escape ตัวถัดไป (`\(`, `\)`, `\\`, octal 1–3 หลัก); **เนื้อใน string ไม่ถูกตีความเป็นโครงสร้างเลย** (`(>> stream)`, `(% x)`, `(/JavaScript)` เป็นข้อมูล)
   - hex string `<…>` แยกจาก `<<`; ความลึกดิกชันนารี + array รวม ≤ 64
   - `stream` หลังดิกชันนารี: ข้าม payload ตาม `/Length` ที่เป็นเลขตรง หรือ `n g R` ที่หา `n g obj <int> endobj` ได้ในไฟล์ (ตัวแยกเดียวกัน ภายในเพดานเวลา); ตำแหน่งหลังข้ามต้องเป็น EOL? + `endstream`
   - `/Length` หาไม่ได้/ไม่ตรงกับ `endstream` → ตรวจ **ทั้งสองแบบ** (ข้ามตาม `/Length` และข้ามถึง `endstream` แรกหลัง EOL) แล้วส่วนนอก payload ของทั้งสองแบบต้องผ่านข้อ 1–3 (กันกรณีโปรแกรมอ่าน PDF ซ่อมไฟล์แล้วเห็นต่างจากเรา — G13); แบบใดแยกคำต่อไม่ได้ → ปฏิเสธ
   - จบไฟล์ขณะอยู่ใน string/ดิกชันนารี/array/stream, วงเล็บไม่สมดุล, ไบต์ที่ไม่ใช่ token ที่รู้จักในโครงสร้าง → ปฏิเสธ (ตรวจไม่ได้ — ข้อ 4)
   - payload ของ stream ที่ไม่ใช่ `/ObjStm` (content, รูป, ฟอนต์) ไม่ถูกแยกคำ — เหมือนพฤติกรรมเดิมที่ไม่ตีความ payload; เพดานเวลา/object ของข้อ 3 ใช้ร่วม
   - ค่าของ string ไม่เป็นโครงสร้าง แต่ยังถูกตรวจตามข้อ 2b
1. **ชื่ออำพราง**: ใน name token ที่ตัวแยกคำ (ข้อ 0) ให้มา (`/[^\s/<>\[\]()%{}]*` ตามตาราง delimiter ของข้อ 0); มี `#xx` (ตัวพิมพ์ใดก็ได้) ที่ถอดแล้วเป็น **ตัวอักษรหรือตัวเลข** (`[A-Za-z0-9]` — ไม่มีเหตุต้อง escape) → ปฏิเสธ `'PDF could not be inspected.'`; escape ที่จำเป็น (ช่องว่าง, ตัวคั่น, `#`, ไบต์นอก ASCII เช่น `/text#2Fxml`, `/Arial#20Bold`) ถอดแล้วเทียบต่อ
2. **ชื่อต้องห้าม**: เทียบหลังถอด แบบไม่สนตัวพิมพ์ (`JavaScript`, `JS`, `OpenAction`, `Launch`, `RichMedia`, `XFA`, `EmbeddedFile`) → ข้อความเดิม
2b. **URI/สคริปต์ที่ทำงานได้ — คงของเดิม (F3)**: การตรวจ `<script`, `<svg`, `javascript:`, `vbscript:`, `data:text/html` ([attachment.logic.ts:214](../../apps/api/src/modules/data-model-core/domain/logic/attachment.logic.ts)) ยังอยู่ แยกจากการแยกคำ; สำหรับ PDF ตรวจทั้ง (ก) ข้อความโครงสร้างนอก payload และ (ข) **ค่าของ string ทุกตัวหลังถอด** (literal: escape + octal; hex string: ถอดเป็นไบต์) ที่ตัดอักขระควบคุมและช่องว่าง ASCII แล้ว เทียบแบบไม่สนตัวพิมพ์ — `/S /URI /URI (javascript:…)` ไม่มีชื่อต้องห้ามแต่ยังถูกปฏิเสธ `'Active content is not allowed in attachments.'`; EICAR ยังตรวจบนไบต์ทั้งไฟล์; ทุกแถวของ M-14 corpus ([m14-upload-scanner-isolated-corpus.md:51](../security-evidence/m14-upload-scanner-isolated-corpus.md)) ได้ข้อความเดิม
3. **object stream**: ทุก stream ที่ดิกชันนารี (หลังข้อ 1) มี `/Type /ObjStm` → ขยายด้วย `zlib.inflateSync(payload, { maxOutputLength })` (R23) เท่านั้น — filter อื่นหรือหลาย filter → ปฏิเสธ (ตรวจไม่ได้); เพดาน: ≤ 8 MiB ต่อ stream, ≤ 32 MiB รวมทุก stream ที่ขยายในไฟล์, ≤ 2,000 object stream, จำนวน `obj` เดิม ≤ 100,000, ความลึกดิกชันนารี ≤ 64, เวลาเครื่อง ≤ 2 วิ ต่อไฟล์; เกิน → ปฏิเสธ; เนื้อหาที่ขยายผ่านข้อ 0–2 ซ้ำ ด้วยตัวแยกคำเดียวกัน (object stream ซ้อนไม่ได้ตาม ISO 32000-1 §7.5.7 — พบ `stream` ข้างในจึงปฏิเสธ)
4. parse/ขยายไม่ได้ → **ปฏิเสธ** (P8) ไม่ใช่ผ่าน; เว็บ S18b, LINE `CONTENT_UNINSPECTABLE` (S18Lb), audit ระดับ MEDIUM (ไม่ใช่ security event HIGH เพราะไม่ได้พบของอันตราย)
5. ไม่มีการ parse ด้วย pdf-lib/pdfjs ในตัวตรวจ (R24); ตัวอ่าน (runner) ยังใช้ pdf-lib/pdfjs เดิมกับไฟล์ที่ผ่านตัวตรวจแล้วและอยู่ใต้งบหน่วยความจำของ runner

**ขั้นที่สอง — B2**: `'receipt'` เท่านั้นที่ผ่อน `EmbeddedFile` เมื่อ:
- นับ**ตัวตนที่ไม่ซ้ำ**หลังตัดซ้ำ (F6): Filespec นับตาม object number/generation (Filespec แบบ direct นับตามตำแหน่งไบต์ของดิกชันนารีนั้น) ที่ถูกอ้างจาก `Names/EmbeddedFiles`, `Catalog/AF` หรือ annotation `FileAttachment` — Filespec เดียวที่ถูกอ้างจากทั้ง Names และ AF (ตามที่ §9.4 ต้องการ) นับ **หนึ่ง**; embedded stream นับตาม object ที่ `/EF /F` (หรือ `/UF`) ชี้ ไม่ซ้ำกัน; ทุก stream ที่ `/Type /EmbeddedFile` (หลังถอด) ต้องถูกชี้จาก Filespec ที่นับแล้ว — stream กำพร้า หรือ Filespec ที่ชี้ stream ไม่ได้ → ปฏิเสธ (ดิกชันนารีอาจอยู่ใน object stream ที่ขยายแล้วตามข้อ 3)
- 1–2 embedded stream ที่ไม่ซ้ำ; ขยาย embedded stream ด้วยเพดาน 3 MiB; `text/xml`/`application/xml` หรือ `.xml`; ไม่มี `<!DOCTYPE`/`<!ENTITY`; root namespace R3
- ผ่าน → null; ไม่ผ่าน → `'PDF embedded file is not allowed.'`
- `'receipt'` มาจาก `CompleteReceiptUploadUseCase`, **capture-group completion** ([expense-capture-group.use-case.ts:527](../../apps/api/src/modules/expenses/application/use-cases/expense-capture-group.use-case.ts) — F11), LINE media ของใบเสร็จ และ worker อีเมล; เส้น attachment ทั่วไปและผู้เรียกอื่น `'strict'`
- เคส M-14 `pdf /EmbeddedFile` ยังถูกปฏิเสธใน `'strict'`; สเปก [receipt-authenticity-signals](receipt-authenticity-signals-spec.md) เพิ่ม C2PA ด้วย allowlist ในฟังก์ชันเดียวกัน ใช้ตัวถอดชื่อและเพดานชุดเดียวกัน — ประสานถ้อยคำและลำดับ merge (B1 เข้าก่อน)

**ตัวแยกที่ใช้ร่วม**: ตัวตรวจลายมือชื่อ (หา `/ByteRange`, `/Contents`, `/SubFilter`, catalog `/Metadata`, `/AF`), ตัวดึง XML ให้ runner และการหา revision ก่อนหน้า (`/Prev`, `%%EOF`) ใช้ตัวแยกและเพดานเดียวกันนี้

## 11. Impact analysis

| ส่วน | ผลกระทบ | ไฟล์ |
|---|---|---|
| ตัวตรวจไฟล์ (B1) | ชื่ออำพราง + ขยาย object stream มีเพดาน + ตรวจไม่ได้ = ปฏิเสธ ทุกผู้เรียก | `attachment.logic.ts`, `complete-attachment-upload.use-case.ts`, `statement-import.use-case.ts`, `process-inbound-line-message.use-case.ts`, `retry-crm-inbox-deliveries.use-case.ts`, `line-document-qa.service.ts`, `process-line-webhook.use-case.ts` (**W00 hash**), `api-error-message.ts`, `line-file-attempt-answer.logic.ts` |
| ข้อยกเว้น B2 | policy `'receipt'` ในเส้นใบเสร็จ + capture group | `expense-upload.use-case.ts`, `expense-capture-group.use-case.ts:527` |
| Prisma | enum 2 ค่า + 5 ตาราง + partial unique (ที่อยู่ ACTIVE; `ExpenseCaptureReadJob (companyId, ocrAdmissionRequestId) WHERE ocrAdmissionRequestId LIKE 'email-intake:%'` — F2) + `trustStoreVersion`/`recheckAfter` ใน verification (F7) + 2 คอลัมน์ executive | `schema.prisma`, migration ใหม่ (raw SQL สำหรับ partial index) |
| Contracts | source, verification union/reasons, DTO ใหม่, executive | `expenses.ts`, `expense-capture.ts`, `expense-email-intake.ts` (ใหม่), `executive-business.ts:356`, `index.ts` |
| Config | 4 ค่า + boot validation; deploy allowlist/preflight/tests | `packages/config/src/index.ts` (**W00 hash**), `app-config.service.ts`, `infra/postmark/config.py:12-14,:27`, `config_test.py`, `config.json`; ตรวจ `infra/kamal/release.py`, `infra/prod-ecs-express/deploy.sh` |
| HTTP | parser wrapper, public allowlist | `main.ts:80-93`, `provider-events-body.middleware.ts`, `auth.guard.ts:166` |
| Expenses | webhook, worker (ingest + `readJobId` + ค้นงานทุกสถานะ), use-cases ที่อยู่/พัก, controller, verification ตอน completion, runner (e-Tax + B4 + B6), apply แยกแหล่ง + แผนที่ subtotal/allowance/อัตรา, replace รีเซ็ต provenance, auto-split คงช่องทาง (`expense-capture-auto-split.service.ts:182,216`), read-status | `apps/api/src/modules/expenses/**`, `prisma-expense-capture.repository.ts` (`findAnyJobForAttachment`, `createObservation({db})`) |
| OCR admission (B7, F2, BL2) | กู้ eventId ก่อนทุกทางออก + persist ก่อนเรียก provider + release/settle ใน tx เดียวกับการเขียนสถานะแบบ fenced (ทุกช่องทาง) | `expense-capture-read-runner.service.ts:212, :259-261, :478-488, :633-704`, `company-ocr-governance.ts` (`findCompanyOcrAdmissionEventId`, `releaseCompanyOcrAdmissionTx`, `settleCompanyOcrAdmissionTx` — ตัวเดิมเรียกตัว tx ภายใน พฤติกรรมเดิมของผู้เรียกอื่นไม่เปลี่ยน) |
| สิทธิภาษีซื้อ | fact `verifiedElectronicFile` (หลัก + ประกอบ; แค่ป้าย S17 — F1) | `expense-input-vat-decision.ts:55-57`, `ExpenseInputVatRight.tsx:92` |
| สิทธิ์ | `expense.email_intake.manage` + gate แท็บ (รวม `canForwardEmail`) + predicate อ่านรายจ่ายกลาง | `permission-registry.ts`, `capability-pack.registry.ts`, `feature-entitlements.ts` (**W00 hash**), `expenses.model.ts:1599,1805`, `web-core-workspace/route-permissions.ts`, `expense-draft.use-case.ts:225-241` (แยกฟังก์ชัน) |
| แพ็ก/บิล | ทุกแพ็กผ่าน `expenses.upload`; ทาง XML ไม่เปิด admission (Q2) | — |
| แจ้งเตือน | 4 trigger → `['expenses']`; ตัวตนเดียว `inbound_email_message` + `sourceRefs[0]` รายจ่าย; ปุ่ม [ดูในแชต] ตามสิทธิ์ (S21b/c/d); guard ด้วย predicate กลางตอนส่ง ตอนอ่าน และตอนนับยังไม่อ่าน (F11); trigger: `expense.email_document_ready` (S19/S21), `expense.email_held` (ACTION, S20), `expense.email_file_rejected` (S22), `expense.email_limit_reached` (S26); **`expense.email_held` ลงทะเบียนใน "ยังรออยู่" (F9)**: `ACTIONS` + `waitingNoticeKey` รับ sourceType `inbound_email_message` ([waiting-notification.ts:2-16](../../apps/api/src/modules/dashboard-notifications/infrastructure/waiting-notification.ts)), `DOCUMENT_NOTIFICATION_STATES` `{ sourceType: 'inbound_email_message', statuses: ['HELD'] }` + ตัวโหลดแถวข้อความใน `completedDocumentNotificationIds` ([document-notification-state.ts:16-41](../../apps/api/src/modules/dashboard-notifications/infrastructure/document-notification-state.ts)), คำสถานะใน `documentStateWords` และ "รอรับเข้า" ใน `finishedNoticeTitle` (S20r); filter `waiting` ที่ [prisma-notification.repository.ts:141](../../apps/api/src/modules/dashboard-notifications/infrastructure/prisma-notification.repository.ts) จึงเห็นเอง | `notification.model.ts:134,205,250`, `notification.use-cases.ts:47-54,497-524,551,656`, `ListNotificationsUseCase`, `GetUnreadCountUseCase`, `waiting-notification.ts`, `document-notification-state.ts` |
| LINE | notifier อีเมล, postback `expense_email_open`, reason `EMBEDDED_FILE_REJECTED`/`CONTENT_UNINSPECTABLE`, S25, ลิงก์ handoff | `line-capture-result-notifier.use-case.ts:140`, `expense-capture-line.use-case.ts:99`, `process-line-webhook.use-case.ts` (**W00 hash**), `line-file-attempt-answer.logic.ts`, `line-business-card.logic.ts`, `line-email-intake-control.logic.ts` (ใหม่) |
| Help pack (F9) | **ไม่แตะ v6**: คู่มือส่วนใหม่อยู่ในไฟล์ใหม่ `apps/web/src/features/user-guide/email-intake-guide.content.ts` (`withEmailIntakeGuide` ประกอบใน [user-guide/expenses/page.tsx:19](../../apps/web/app/(workspace)/companies/[companyId]/user-guide/expenses/page.tsx) แบบ `withDisbursementVoucherGuide`) → `expenses-guide.content.ts` และ hash ของการ์ด v6 ไม่เปลี่ยน; การ์ดใหม่อยู่ใน array ใหม่ `V7_PRODUCT_HELP_CARDS` (ไม่ใช่ `NEW_PRODUCT_HELP_CARDS` ที่ v6 ใช้ที่ [approved-product-help.ts:122](../../apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts)) + key ใหม่ใน `sources`; การ์ด S24 `requiredPermissions: ['attachment.create']` + `permissionAnyOf` สามสิทธิ์ (F10); `PRODUCT_HELP_V7_PACK` = v6 + `V7_PRODUCT_HELP_CARDS` สถานะ DRAFT; `activeProductHelpPack()` ใช้ v7 เมื่อ APPROVED เท่านั้น | `email-intake-guide.content.ts` (ใหม่), `user-guide/expenses/page.tsx`, `product-help-draft-cards.ts`, `approved-product-help.ts` (**W00 hash**) |
| W00 / whole-chain | manifest ใหม่; scenario `email-document-line-follow-up` พร้อม `evidence` (ไฟล์ + ชื่อ test ที่ harness รันจริง) และเพิ่ม id นี้ใน `EXPECTED_IDS` ท้ายรายการ ([catalog spec:12-37, :40](../../scripts/line-ai-whole-chain-acceptance-catalog.spec.mjs) — F12) | `line-ai-capability-manifest.spec.ts`, `scripts/line-ai-whole-chain-acceptance.catalog.mjs`, `scripts/line-ai-whole-chain-acceptance-catalog.spec.mjs` |
| Export (F10) | `EMAIL_INBOUND → EMAIL`; คอลัมน์ `electronic_evidence_status` ลงทะเบียนใน `ACCOUNTANT_INDEX_COLUMNS` ([expenses.ts:1731](../../packages/contracts/src/expenses.ts)) ชุด `full` เท่านั้น (ไม่อยู่ใน `ACCOUNTANT_INDEX_SUMMARY_COLUMNS` — เลือกชุดที่ [:1877](../../packages/contracts/src/expenses.ts)) + ป้าย "ผลตรวจไฟล์อิเล็กทรอนิกส์" ใน `ACCOUNTANT_INDEX_COLUMN_LABELS` (:1802); `AccountantPackageIndexRow` เป็น `Record` ของ column จึงได้ type ตาม; ค่า: `รูปแบบ e-Tax ลงนามถูกต้อง` (eligible + VERIFIED), `PDF ลงนามถูกต้อง` (VERIFIED ไม่ eligible), `ลายมือชื่อไม่ถูกต้อง` (FAILED), `ตรวจไม่ได้` (UNAVAILABLE), ว่าง (ไม่มีลายมือชื่อ/ไม่ใช่ PDF) — ไม่มีคำว่า "ตัวจริง" (F1); header ผ่าน [expense-export.logic.ts:214](../../apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts) เดิม; ตำแหน่งใน workbook ใหม่ตาม [accountant-export-cleanup-spec](accountant-export-cleanup-spec.md) (MC15) | `packages/contracts/src/expenses.ts`, `expense-export.logic.ts:90-104, :214`, `expense-evidence.use-case.ts:483` |
| รายงานผู้บริหาร | 2 คอลัมน์ + SQL + helpers + read + contract; test อยู่ใน PG spec เดิม `executive-report-build.pg.spec.ts` / `executive-report-read.pg.spec.ts` (MC12) | `schema.prisma:4185-4186`, `executive-report-build.use-case.ts:105,121,373,402-404`, `executive-read.logic.ts:14-15`, `executive-report.logic.ts`, `executive-report-read.service.ts`, `executive-business.ts:356` |
| หน้าเว็บ | การ์ด/ตาราง/dialog, ป้าย, gate | `ExpensesPages.tsx`, `EmailIntakeCard.tsx` (ใหม่), `ExpenseReviewPage.tsx`, `expenses.model.ts`, `expenses.api.ts`, `workspace-dictionary.ts` |
| Workers | timer 30 วิ | `apps/workers/src/modules/email-intake/email-intake-worker.ts` (ใหม่), `apps/workers/src/main.ts` |
| Infra/ops | inbound stream, MX, webhook Basic Auth, secrets, แผน Pro+ (R15d), retention, ingress | runbook postmark |
| PDPA | ROPA + ภาคผนวกผู้ประมวลผล (R15b) | `docs/legal-review/mangmeeplus-pdpa-external-completion-guide-th.md` |
| ต้นทุน | inbound ทุกฉบับนับในโควตา Postmark ยกเว้นที่ Postmark บล็อก (R15d/e) | §16, MC4 |
| Seed / journey | ที่อยู่ + ข้อความพัก + e-Tax สังเคราะห์ | `seed-expenses.ts`, `e2e/journeys/supplier-etax-by-email.journey.spec.ts` (ใหม่) |
| Dependencies | `fast-xml-parser` (สตริงเท่านั้น, ปฏิเสธ DOCTYPE ก่อน), `pkijs` (+`asn1js`) — เพิ่ม dependency เท่านั้น; ตัวตรวจ PDF ใช้ `node:zlib` | `apps/api/package.json`, `pnpm-lock.yaml` |

## 12. Gaps

- **G1** ไม่มีไฟล์ e-Tax จริง (MC1) · **G2** โครงสร้างตราประทับ ETDA/TSA **U** (MC5) · **G3** ETDA incremental update/คงหัวเรื่อง **U** · **G4** `OriginalRecipient` (MC2)
- **G5** ไม่ตรวจการเพิกถอน; ไม่ตรวจ XAdES · **G6** รหัสจังหวัดใน XML ยังไม่แปลง · **G7** ข้อความ > 28 MB → 413 ร้านไม่รู้
- **G8** ใบรับรอง CA ไทยใส่เลขผู้เสียภาษีผู้ลงนามที่ไหน — แสดงชื่ออย่างเดียว · **G9** `IssueDateTime` ไม่มีโซน · **G10** R12 เป็นการตีความ
- **G11** ชื่อต้องห้ามเพิ่ม (`/AA`, `/SubmitForm`, `/ImportData`, `/GoToR`) นอก B1 · **G12** LINE AI ค้นตามช่องทางไม่ได้
- **G13** stream ที่ `/Length` ไม่ตรงกับตำแหน่ง `endstream`: ตัวแยกคำตรวจทั้งสองแบบ (§10.5 ข้อ 0) แต่โปรแกรมอ่าน PDF บางตัวซ่อมไฟล์ด้วยการสร้าง xref ใหม่ซึ่งอาจเห็นต่างได้อีก — วัด false refusal และลองไฟล์ที่ตั้งใจทำ Length ผิดกับโปรแกรมอ่านหลัก ๆ ใน MC7
- **G14** ไม่ตรวจ PDF/A เต็มรูป (non-goal) — เฉพาะการประกาศและโครงไฟล์แนบ
- **G15** ไม่ตรวจรายชื่อผู้มีสิทธิ์ออกตาม กฎกระทรวง 384 ข้อ 12 — ถ้อยคำจำกัดตาม §19 BL1; ถ้าจะอ้างสิทธิ์ผู้ออกต้องทำ rd-taxpayer-verification ก่อน

## 13. Bugs ในโค้ดปัจจุบัน (ยืนยันจากการอ่านโค้ด)

| # | ที่ | สถานการณ์ที่ล้ม | ความรุนแรง |
|---|---|---|---|
| B1 | [attachment.logic.ts:203, :209-218](../../apps/api/src/modules/data-model-core/domain/logic/attachment.logic.ts) | ผู้มีสิทธิ์อัปโหลดส่ง `receipt.pdf` ที่ catalog มี `/Open#41ction << /S /Java#53cript /JS (…) >>` (หรือ `/open#41ction` ตัวเล็ก, หรือ action ใน object stream ที่ประกาศเป็น `/Type /#4fbjStm`, **หรือ** ใส่ literal string `(>> stream)` ในดิกชันนารีก่อน catalog ที่มี `/OpenAction`/`/JS` ตัวสะกดปกติ — regex ตัด payload :203 กลืนทุกอย่างจนถึง `endstream` จริงตัวถัดไป) → regex เทียบชื่อไม่พบ → ผ่านไป ClamAV (ไม่ได้ออกแบบให้จับ JavaScript ใน PDF ทั่วไป) แล้ว ACTIVE; ผู้ตรวจ/ผู้อนุมัติ/นักบัญชีเปิดไฟล์ (ดาวน์โหลด หรือ `disposition=inline` ที่ยอมให้ PDF [:240](../../apps/api/src/modules/data-model-core/domain/logic/attachment.logic.ts)) ในโปรแกรมอ่าน PDF ที่รัน JavaScript → active content ทำงาน; เกิดทั้ง 6 ผู้เรียก | **สูง (ความปลอดภัย)** — ขั้นแรก แยกปล่อย |
| B2 | [attachment.logic.ts:217-218](../../apps/api/src/modules/data-model-core/domain/logic/attachment.logic.ts) + [complete-attachment-upload.use-case.ts:119-120, :180-199](../../apps/api/src/modules/data-model-core/application/use-cases/complete-attachment-upload.use-case.ts) + [process-line-webhook.use-case.ts:13157](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts) | e-Tax PDF/A-3 ที่เขียน `/Type /EmbeddedFile` → เว็บ quarantine + audit/security event HIGH (ลวง), LINE `CONTENT_REJECTED` (ไฟล์จริงรอ MC1) | สูง |
| B3 | [api-error-message.ts:1534-1535](../../apps/web/src/common/api/api-error-message.ts), [line-file-attempt-answer.logic.ts:143-145](../../apps/api/src/modules/line-ai/domain/logic/line-file-attempt-answer.logic.ts) | ต่อจาก B2: "มีคำสั่งอัตโนมัติฝังอยู่" (ไม่จริง) + "สั่งพิมพ์เป็น PDF ใหม่" (ทำลายต้นฉบับ R13); LINE ให้ส่งซ้ำซึ่งถูกปฏิเสธซ้ำ | กลาง |
| B4 | [expense-capture-read-runner.service.ts:630, :658, :674](../../apps/api/src/modules/expenses/application/services/expense-capture-read-runner.service.ts), [outbox-append.service.ts:86](../../apps/api/src/modules/data-model-core/application/services/outbox-append.service.ts) | DONE กับ event แยก transaction (คอมเมนต์ :630 บอกว่าเดียวกัน); ตาย/append ล้ม (กลืน) → job DONE ไม่ถูก claim ซ้ำ ([:349](../../apps/api/src/modules/expenses/infrastructure/prisma-expense-capture.repository.ts)) → ลูกค้า LINE ไม่ได้การ์ดผลอ่านตลอดไป | สูง |
| B5 | [expense-capture-read-runner.service.ts:708-710](../../apps/api/src/modules/expenses/application/services/expense-capture-read-runner.service.ts) | ป้าย OCR route ตาม `ownerType` (PDF ทาง LINE → web, group เว็บ → line); โควตาไม่ผิด ([company-ocr-governance.ts:31-33](../../apps/api/src/modules/line-ai/application/company-ocr-governance.ts)) | ต่ำ (บันทึก) |
| B6 | [expense-capture-read-runner.service.ts:509-531](../../apps/api/src/modules/expenses/application/services/expense-capture-read-runner.service.ts) | บันทึก observation ล้ม (เช่นชน unique version จากการอ่านซ้ำพร้อมกัน หรือฐานข้อมูลสะดุด) → warn แล้วงานยังเขียนรายจ่ายและจบ DONE → `read-status` บอก 0 เอกสาร (:133) ทั้งที่ร่างถูกเติมแล้ว และการ์ด LINE ได้ `documentCount` จาก assembled ในหน่วยความจำ ซึ่งไม่ตรงกับที่หน้าเว็บอ่าน | กลาง |

| B7 | [expense-capture-read-runner.service.ts:259-261, :487, :644-656](../../apps/api/src/modules/expenses/application/services/expense-capture-read-runner.service.ts) + [company-ocr-governance.ts:247](../../apps/api/src/modules/line-ai/application/company-ocr-governance.ts) | admission commit แล้ว process ตาย (deploy, OOM) ก่อน persist ครั้งแรก (eventId อยู่แค่ในหน่วยความจำ) → รอบใหม่ได้ `duplicate` ไม่มี eventId → `finish()` ข้าม release/settle: อ่านไม่ได้ผล → ลูกค้าเสียหน่วยใบเสร็จ (ขัดกติกา "เรียก AI ไม่สำเร็จไม่คิดเงิน"); ได้ผล → หน่วยที่จองไม่ถูก CONSUME ค้าง | **สูง (เงินลูกค้า)** — §7.4 ข้อ 3b, §19 BL2. ทางเดียวกัน: รอบใหม่จบเร็ว (`ownerStillValid` → `CANCELLED` [:212](../../apps/api/src/modules/expenses/application/services/expense-capture-read-runner.service.ts), `source_changed`, `attempts_exhausted`) ก่อนกู้ event → หน่วยค้าง; และ release/settle อยู่ก่อนการเขียนสถานะแบบ fenced ([:644-658](../../apps/api/src/modules/expenses/application/services/expense-capture-read-runner.service.ts)) — runner ที่ lease หลุดยังคืนหน่วยของ event ที่ runner ใหม่ใช้อยู่ได้ |

(ข้อสังเกตที่ยังไม่ยืนยันเป็นบั๊ก: ทาง LINE file lane เรียก `queueExpenseRead` ซ้ำได้ถ้า event เดิมถูกส่งซ้ำหลังงานจบ เพราะ `findLiveJobForAttachment` ตัดงานจบแล้ว — ต้องตรวจว่า webhook ซ้ำถูกกันก่อนถึงจุดนี้หรือไม่ (MC13))

## 14. Test plan

กติกา: test API ใหม่อยู่ในไฟล์ที่อยู่ใน `apps/api/package.json` แล้วเท่านั้น; PG spec ของรายจ่ายอยู่แค่ใน `extended-tests.yml` จึงไม่ใช้; invariant ฐานข้อมูลใส่ใน `src/modules/data-model-core/infrastructure/company-tax-identity-migration.pg.spec.ts` (`test:tax-identity-pg`); ตัวนับ executive: ไม่มีไฟล์ executive ใน `apps/api/package.json` และกติกาของเจ้าของครอบ **เคส test ใหม่** ไม่ใช่แค่ไฟล์ใหม่ (P49) — ที่อยู่ของเคสเป็น**การตัดสินของเจ้าของ** (MC12)

| ไฟล์ (อยู่ในรายการ) | เคส |
|---|---|
| `data-model-core/domain/logic/attachment.logic.spec.ts` | **ตัวแยกคำ (F1)**: `(>> stream)` ในดิกชันนารีก่อน catalog ที่มี `/OpenAction` + `/JS` → ปฏิเสธ; `(\) >> stream)` (escape) และ `((>> stream))` (ซ้อน) → ปฏิเสธ; `% >> stream` ใน comment ก่อน action → ปฏิเสธ; `(% /OpenAction)` เป็นข้อมูลใน string → ไม่ปฏิเสธเพราะชื่อ; NUL เป็นตัวคั่น `/OpenAction\0<<` → ปฏิเสธ; `/Length 5 0 R` ชี้เลขถูก → ผ่าน; `/Length` สั้นกว่าจริงซ่อน `/JS` หลัง payload → ปฏิเสธ (ตรวจทั้งสองแบบ); string ไม่ปิดจนจบไฟล์ → ปฏิเสธ; `stream` ใน ObjStm ที่ขยายแล้ว → ปฏิเสธ. **B1**: `/Java#53cript`, `/java#53cript`, `/Open#41ction`, `/open#41ction`, `/J#53`, `/Embed#64edFile`, `/Type /#4fbjStm` (และ `/#4FbjStm`) ซ่อน OpenAction → ปฏิเสธ; ObjStm ปกติที่มี OpenAction → ปฏิเสธ; **ObjStm ขยายเกิน 8 MiB / รวมเกิน 32 MiB → ปฏิเสธ**; filter LZW บน ObjStm → ปฏิเสธ; ดิกชันนารีลึก 65 ชั้น → ปฏิเสธ; ไฟล์ตัดกลางทาง → ปฏิเสธ; `/Arial#20Bold`, `/text#2Fxml` → ไม่ปฏิเสธเพราะชื่อ; PDF ปกติ/สแกนหลายหน้า → ผ่าน. **B2**: PDF/A-3 + XML ETDA ผ่านเฉพาะ `'receipt'`; `'strict'` ปฏิเสธ; **Filespec เดียวอ้างทั้ง Names และ AF → นับ 1 ผ่าน (F6)**; embedded stream กำพร้า → ปฏิเสธ; embedded ไม่ใช่ XML/DOCTYPE/ซ่อน/เกิน 3 MiB/namespace อื่น → ปฏิเสธ; M-14 เดิมยังปฏิเสธ. **URI (F3)**: `/S /URI /URI (javascript:alert(1))`, hex string ของ `javascript:`, octal `(\152avascript:…)`, `(java\nscript:…)`, `vbscript:`, `data:text/html` → `'Active content is not allowed in attachments.'`; รัน M-14 corpus ทั้งชุด ข้อความเดิมทุกแถว |
| `data-model-core/application/use-cases/complete-attachment-upload.use-case.spec.ts` | `'receipt'` → ACTIVE + verification row; ไม่ส่ง policy → quarantine; ตรวจไม่ได้ → ปฏิเสธด้วย audit MEDIUM |
| `expenses/application/use-cases/expense-capture-group.use-case.spec.ts` | completion ของ group ส่ง `'receipt'` (F11); สถานะ 4 ค่าบนแถวไฟล์; use-case ที่อยู่/พัก (สิทธิ์ manage/ผู้รับ/สมาชิกของตัวเอง, revision, ผู้รับไม่ผ่านเงื่อนไข → 422, `targetBranchId` คงหลัง restart, XML_ONLY ไม่มี accept) |
| `line-ai/domain/logic/line-file-attempt-answer.logic.spec.ts` | `EMBEDDED_FILE_REJECTED` → S18L; `CONTENT_UNINSPECTABLE` → S18Lb |
| `expenses/domain/logic/expense-capture-preprocess.logic.spec.ts` | ตัวแปลง XML: ทุกแถว §6.7; **`CalculatedRate` "7" → "0.0700"** ทั้งหัวและบรรทัด; **ตัวอย่าง ETDA Rec.3 (R3c)**: `LineTotalAmount` 63,050, header allowance 500, `AllowanceTotalAmount` 3,000 → `subtotalAmount` 63,050, `discountAmount` 500, ตรวจความสอดคล้อง 63,050 − 500 = 62,550 ผ่าน **ไม่มี** review reason ยอดไม่เข้ากัน (F4); บรรทัดที่มีส่วนลด → ไม่มี `unitPrice` + "(หักส่วนลด …)"; ไม่หายผ่าน `verifyDiscountAmount`; header charge (`ChargeIndicator=true`) → additionalCharges; TXID/NIDN/OTHR; GrandTotal หลายสกุล; ยอดไม่เข้ากัน; TypeCode 11 ค่า; เงินเป็นสตริง; DOCTYPE; `description` ตั้งเสมอ |
| `expenses/domain/logic/expense-document.logic.spec.ts` | ตัวตรวจ: VERIFIED; แก้ 1 ไบต์; ByteRange ร้าย; ไบต์ต่อท้าย; สายไม่ถึง → `UNAVAILABLE CHAIN_NOT_ESTABLISHED`; **EKU serverAuth อย่างเดียว → `CERT_PURPOSE_INVALID`**; KeyUsage ไม่มี digitalSignature/nonRepudiation → `CERT_PURPOSE_INVALID`; TSA ไม่มี EKU timeStamping critical → ไม่นับเป็นเวลาที่เชื่อถือได้; signingTime ย้อนหลัง → `NO_TRUSTED_TIME`; genTime ก่อน/หลังหมดอายุ; **PDF ลงนาม + XML ETDA แต่ไม่มี `pdfaid:part=3` → `etaxEligible=false NO_PDFA3_DECLARATION`; XML ไม่อยู่ใน `/AF` → `ATTACHMENT_PROFILE_INVALID`; `/AFRelationship /Data` หรือ `/Source` บน XML → `ATTACHMENT_PROFILE_INVALID` (Alternative เท่านั้น — F5)**; Filespec เดียวอ้างทั้ง Names และ AF → นับหนึ่ง eligible (F6); **trust store เปลี่ยน (`trustStoreVersion` ใหม่) → แถวเดิมไม่ถูกใช้ คำนวณใหม่; `recheckAfter` ผ่านแล้ว → คำนวณใหม่ (F7)**; XML สองไฟล์ → ไม่ eligible; ใบเสนอราคาที่ลงนาม → `PDF_SIGNATURE`; TSA อื่น → `TSA_NOT_ETDA`; revision ก่อนหน้าจาก `/Prev`; ลายมือชื่อ 6 ชุด → UNSUPPORTED; timeout |
| `expenses/application/services/expense-capture-read-runner.service.spec.ts` | XML path: providerCallCount 0, ไม่มี admission, manifest + observation, event; **B4**: append ล้ม → rollback; **B6**: observation insert ล้ม → ไม่มี DONE, job ถูก claim ใหม่; ไฟล์ประกอบไม่ถูก runner อ่าน (คงเดิม) แต่มี verification จาก completion; **B7 (F2, BL2)**: (a) admission commit → ตายก่อน persist → รอบใหม่ `duplicate` → กู้ eventId → อ่านไม่ได้ผล → release หนึ่งครั้ง (`usedCount` กลับ) / (b) ได้ผล → settle CONSUME หนึ่งครั้ง; (c) persist หลัง admission เสีย lease → ไม่เรียก provider ไม่ชดเชย; (d) checkpoint มี eventId อยู่แล้ว → พฤติกรรมเดิม; **(e) admission → ตาย → ไฟล์หลักถูกเปลี่ยน → รอบใหม่ `CANCELLED` ที่ `ownerStillValid` → release หนึ่งครั้ง** (เช่นเดียวกับ `source_changed`/`attempts_exhausted`); **(f) A admitted แล้ว lease หมด → B claim กู้ event เดียวกัน อ่านได้ผล → A เสีย fence ตอน finish → A ไม่ release; B settle หนึ่งครั้ง (คิดหนึ่งหน่วยพอดี)**; (g) release/settle ล้มใน tx ของ finish → rollback ทั้งก้อน งาน claim ใหม่ได้ ชดเชยครั้งเดียว; **F5**: XML TypeCode 388 → `sourceDocumentType TAX_INVOICE`, T01 → `RECEIPT` ผ่าน gate, 80 → ไม่ apply |
| `expenses/application/use-cases/expense-capture-read-status.use-case.spec.ts` | XML job → documentCount 1 |
| `expenses/application/services/receipt-ocr-apply.service.spec.ts` | `ETAX_XML`: readSource/readAttachmentId, ไม่มีคำ "AI" และข้อความที่เก็บ (description, review reason) ไม่มีคำ "e-Tax" (F8); อัตราเศษส่วนไม่ถูกทิ้ง (`ocrVatSource` ได้ `RATE`/`BOTH`) |
| `expenses/application/use-cases/expense-upload.use-case.spec.ts` | `emailCapture`; replace ลบ provenance; email logic pure (parse, route, ผู้ส่ง, เพดานรวมระดับบริษัท, กติกา §9.2, ผู้ได้รับแจ้ง, จับคู่ผู้ขายต่างกันไม่จับ); **ingest: crash หลังสร้างงานอ่านแต่ก่อนบันทึก READ_QUEUED แล้วงานจบ DONE → รอบถัดไปใช้งานเดิม ไม่มี admission ที่สอง**; **worker สองตัวทับซ้อนหลัง lease หมด → งานอ่านหนึ่งงาน admission หนึ่งครั้ง worker ที่แพ้หยุดที่ `READ_QUEUED` (F2)**; **รับเข้าข้อความ `NEW_SENDER` ด้วย `trustSender=false` → worker สร้างร่าง ไม่กลับไป HELD; ผู้ส่งยังไม่ TRUSTED; ข้อความถัดไปจากผู้ส่งเดิมยังพัก (F3)**; รับเข้าแล้วผู้กดรับเสียสิทธิ์ → `HANDLER_UNAVAILABLE`; **F6**: ไฟล์ซ้ำกับรายจ่ายของสาขา/คนอื่นที่สมาชิกอ่านไม่ได้ → DTO ไม่มี `expenseId` + S11t3; **F7**: ข้อความผสม (ไฟล์ STORED + ไฟล์ HELD) → `HELD`; ไม่รับ → ไฟล์ที่เหลือ `SKIPPED` ข้อความ `DONE`; purge ลบไบต์ไฟล์ที่ไม่รับ แต่คงแถวข้อความ/หัวอีเมลของไฟล์ที่ผูกรายจ่าย; **F8**: จองช่อง auto ซ้ำหลัง restart → ไม่นับซ้ำ, ไฟล์ที่คนกดรับไม่ใช้ช่อง; crash ทุกขั้นอื่น |
| `expenses/domain/logic/expense-export.logic.spec.ts` | `EMAIL`; `electronic_evidence_status` อยู่ในชุด full ไม่อยู่ใน summary, ค่าห้าแบบ, header ไทย, ไม่มีคำว่า "ตัวจริง" (F10) |
| `expenses/infrastructure/prisma-expense.repository.tax-snapshot.spec.ts` | `verifiedElectronicFile` หลัก/ประกอบ; `PDF_SIGNATURE` ไม่ให้ |
| `auth/auth.guard.spec.ts`, `auth/auth-endpoints.spec.ts` | public route ตอน CLOSED; webhook ตาราง §7.2; parser ข้อความตายตัวไม่มีเนื้อหาใน response/log |
| `auth/permission-registry.spec.ts`, `employee-access/domain/logic/role-template-system-role-parity.spec.ts`, `feature-gate.logic.spec.ts`, `capability.logic.spec.ts` | สิทธิ์ใหม่ |
| `dashboard-notifications/dashboard-notification-correctness.spec.ts` | trigger 4 ตัว; ตัวตนเดียว + ref → ปุ่ม; **ผู้รับที่มีแค่ `attachment.create` + `expense.receipt.upload` และเป็นผู้สร้างร่าง → ได้แจ้ง (predicate กลาง)**; เสียสิทธิ์/สาขา → SUPPRESSED และไม่แสดงในกระดิ่ง **และตัวเลขยังไม่อ่านลดลงตาม (F11)**; **F9**: `expense.email_held` อยู่ใน `waiting` แม้อ่านแล้ว และหายเมื่อรับเข้า/ไม่รับ/purge พร้อมหัว S20r |
| `line-ai/application/use-cases/line-capture-result-notifier.use-case.spec.ts`, `process-line-webhook.use-case.spec.ts`, `line-ai/domain/logic/line-business-card.logic.spec.ts` | notifier อีเมล; postback token; B1 ผ่าน LINE media; S25/S25n ตามผลตรวจ; **S21b/S21c/S21d ตาม `expense.confirm`/`expense.update`/ไม่มีทั้งสอง (F9)** |
| `data-model-core/infrastructure/company-tax-identity-migration.pg.spec.ts` (PG) | one ACTIVE, localPart, provider+messageId, `draftIdempotencyKey` แข่ง, CAS `ingestStep`, **เพดานไบต์บริษัท: สองคำขอคร่อมเที่ยงคืน/ต่างที่อยู่พร้อมกัน → รวมไม่เกิน**, purge, cascade, enum ใหม่, unique verification (รวม `trustStoreVersion`), **partial unique `email-intake:` บน `ExpenseCaptureReadJob`: insert ซ้ำ → P2002, แถว UUID เดิมไม่ชน**; **F8**: สอง worker เห็น 49 ช่อง → ได้ช่องที่ 50 ตัวเดียว อีกตัว `DAILY_LIMIT`; **P56/F4**: verification insert แข่ง → แถวเดียว, `recheckAfter` ผ่าน → update ในที่ ไม่ P2002 |
| `executive-business/executive-report-build.pg.spec.ts`, `executive-report-read.pg.spec.ts` (PG เดิม — **รอเจ้าของตัดสิน MC12**) | `expenseReceiptsEmail`/`confirmedExpensesEmail` นับเฉพาะ `EMAIL_INBOUND`; อ่านกลับผ่าน read service; สองคอลัมน์ไม่กระทบตัวนับเดิม |
| web `EmailIntakeCard.spec.ts` (ใหม่ — web suite รันทุกไฟล์), `ExpenseReviewPage.rendered.spec.ts`, spec ของ `expenses.model` | ข้อความตามสิทธิ์/สถานะ, gate แท็บรวม `canForwardEmail`, ปุ่มเท่ากัน, S13e/S13g |
| Help pack | `agent-tools.registry.spec.ts`, `approved-knowledge.spec.ts`: hash ของ v6 ไม่เปลี่ยน; การ์ดใหม่อยู่เฉพาะ v7; v7 ไม่ active จนอนุมัติ; **S24: `attachment.create` + `line_upload` ได้การ์ด, `line_upload` ไม่มี `attachment.create` ไม่ได้, manage + `attachment.create` ได้ (F10)** |
| Browser journey `e2e/journeys/supplier-etax-by-email.journey.spec.ts` | 390/1280/~1556 px |
| Whole-chain + W00 | หลังแตะไฟล์ LINE/hash; `scripts/line-ai-whole-chain-acceptance-catalog.spec.mjs` ผ่านเมื่อเพิ่ม id ใน `EXPECTED_IDS` และ evidence ของ scenario ใหม่ชี้ test ที่อยู่ใน `LINE_AI_WHOLE_CHAIN_SUITES` (F12) |
| หลักฐานหน้าจอจริง ([thai-ux-standard.md:114](../guidelines/thai-ux-standard.md)) | ทุกหน้าจอ/dialog ที่เปลี่ยน ที่ 390 และ 1280 (+ ~1556) |

งานเอกสารนี้ **not run** (ไม่มี node_modules)

## 15. Acceptance criteria

| # | Scenario | ผลที่ต้องได้ |
|---|---|---|
| A0 | อัปโหลด PDF ที่ใช้ชื่อ hex escape ตัวใหญ่/เล็ก หรือซ่อน action ใน object stream (เว็บ, LINE, ใบแจ้งยอด, CRM) | ปฏิเสธทุกช่องทาง; PDF ปกติยังผ่าน (ปล่อยได้ก่อนทุกอย่าง) |
| A0b | PDF ที่ object stream ขยายเกินเพดาน | ปฏิเสธภายใน 2 วิ หน่วยความจำ API ไม่เกินเพดานที่ตั้ง |
| A0c | PDF ที่มี `(>> stream)` ใน literal string ก่อน catalog ที่มี `/OpenAction` + `/JS`, หรือซ่อนด้วย comment/NUL/`/Length` ผิด | ปฏิเสธทุกช่องทาง; ไม่มีการตัด payload ด้วย regex เหลือในโค้ด (F1) |
| A1 | สร้างที่อยู่ | 10 ตัว; ซ้ำ 409; ACTIVE เดียว |
| A2 | หมุน | เดิม RETIRED; ไม่เก็บไฟล์ |
| A3 | e-Tax PDF/A-3 ลงนามถูก จากผู้ขายใหม่ | ร่าง `EMAIL_INBOUND`, ค่าตาม §6.7 (อัตรา 0.07, ส่วนลดหัวบิลแยกจากส่วนลดรายบรรทัด — ตัวอย่าง R3c ได้ 63,050 / 500 / 62,550 ไม่มี review reason ยอดไม่เข้ากัน), ไม่เรียก AI, read-status 1, S13a, แจ้งผู้รับคนเดียว |
| A3b | ใบเสนอราคาที่ลงนามถูก | `PDF_SIGNATURE`, ไม่มีป้าย, พัก |
| A3c | PDF ลงนามถูก ฝัง XML ETDA แต่ไม่ประกาศ PDF/A-3 หรือ `/AFRelationship` ไม่ใช่ `Alternative` | `etaxEligible=false`, ไม่มีป้าย e-Tax; ถ้าอ่าน XML ได้ ข้อความเป็นแบบกลาง S14n/S25n (F5, F8) |
| A3d | ใบรับรองผู้ลงนามมีแค่ EKU serverAuth | `FAILED CERT_PURPOSE_INVALID`, S13e |
| A4 | แก้ 1 ไบต์ / ByteRange ร้าย | FAILED, ไม่ auto |
| A4b | ใบรับรองหมดอายุ signingTime ย้อนหลัง | `UNAVAILABLE NO_TRUSTED_TIME` |
| A4c | ขาด intermediate certificate | `UNAVAILABLE CHAIN_NOT_ESTABLISHED`, S13g |
| A5 / A5b | Time Stamp คู่ถูก / ผู้ขาย 2 รายเลขที่วันเดียวกัน | PAIRED รายการเดียว S13b / ไม่จับคู่ข้ามผู้ขาย |
| A6 | 48 ชม. ไม่มีฉบับประทับเวลา แล้วมาทีหลัง | สร้างจากฉบับร่าง (S23); ฉบับประทับเวลาแทน/แนบ + S23b; ไม่มีรายการที่สอง; ไฟล์ที่แนบประกอบได้ผลตรวจ |
| A7 / A8 | ผู้ขายใหม่ PDF ธรรมดา / From ปลอม ไม่มี DKIM ตรง | พัก รับเข้าแล้วจำ / พัก |
| A9 / A10 / A10b | สมาชิกส่งต่อ DKIM ตรง / ไม่ตรง / ต้องเลือกสาขา | ร่างของสมาชิก / `SENDER_NOT_CONFIRMED` / แจ้งสมาชิก S20c สมาชิก (รวมที่มีแค่ `line_upload`) เปิดแท็บรับเข้าเองได้ |
| A11 | To ร้าน B แต่ OriginalRecipient ร้าน A | เข้าร้าน A เท่านั้น |
| A12 / A12b | ไฟล์ไม่ผ่าน / เกินเพดานรายวัน หรือไบต์ที่พักของบริษัท (รวมคร่อมเที่ยงคืน) | ตามกติกา; ส่วนที่เกินไม่ถูกเก็บ; S26 |
| A13 / A13b / A13c | Postmark retry / worker ตายทุกขั้น รวมหลังสร้างงานอ่านก่อนบันทึก READ_QUEUED / worker สองตัวทับซ้อนหลัง lease หมด | ไม่มีของซ้ำ; **งานอ่านหนึ่งงานและ OCR admission ต่อไฟล์หนึ่งครั้งเท่านั้น** (F2) |
| A14–A17 | ซ้ำ / ผู้ซื้อไม่ตรง / สาขาที่เลือกคงหลัง restart / ผู้รับปิดบัญชี | DUPLICATE / BUYER_MISMATCH / ใช้สาขาที่บันทึก / HANDLER_UNAVAILABLE + S3b |
| A16b | ผู้รับกด "รับเข้า" PDF จากผู้ส่งใหม่โดยไม่ติ๊กจำผู้ส่ง | เกิดร่างหนึ่งรายการ ไม่กลับไปพัก; ฉบับถัดไปจากผู้ส่งเดิมยังพัก (F3) |
| A18 / A18b | e-Tax ทางเว็บ, LINE / ทาง capture group | อ่าน XML / ผ่านตัวตรวจ `'receipt'` + มีผลตรวจ (อ่านด้วย AI) |
| A19 | PDF ฝัง .docx / เส้น attachment ทั่วไป | S18 / ยังเข้ม |
| A20 | แพ็ก 249; บริษัทปิด `expenses.upload` | ใช้ได้; ไม่แสดง 403 |
| A21 | ไม่รับ | ลบใน 30 วัน |
| A22 / A22b | ดูในแชต / ผู้รับเสียสิทธิ์อ่านก่อนส่ง | การ์ดร่างเดิม + ปุ่มยืนยันที่ลงนาม / ไม่ได้การ์ด ไม่เห็นในกระดิ่ง |
| A23 | ถาม "ส่งบิลทางอีเมลได้ไหม" ก่อน/หลังเจ้าของอนุมัติ v7 | ก่อน: pack v6 ตอบเหมือนเดิม hash v6 ไม่เปลี่ยน; หลัง: S24 + ปุ่ม |
| A24 | เบราว์เซอร์จริง 390, 1280, ~1556 px | ไม่ล้น ปุ่มเท่ากัน (วัด) ≥ 44 px มือถือ หน้าเต็มกว้าง; บันทึกภาพและสิ่งที่ไม่ได้ดู |
| A25 | outbox หรือ observation ล้มตอนจบงาน | job ไม่เป็น DONE จนกว่าทั้งคู่เขียนได้ |
| A26 | trust manifest เปลี่ยน (ถอน root) หรือใบรับรองในสายหมดอายุหลังตรวจแบบ `VALIDATION_TIME` | ครั้งถัดไปที่แสดง/ตรวจ คำนวณใหม่; ป้าย S13a/S14 หายเมื่อไม่ผ่านแล้ว ไม่ค้างจาก trust เดิม (F7) |
| A27 | แจ้ง LINE ถึงสมาชิกที่ส่งต่อได้แต่ไม่มี `expense.confirm` | ได้ S21c (มี `expense.update`) หรือ S21d (ไม่มีทั้งสอง) ไม่ได้ "กดยืนยันได้เลย" (F9) |
| A28 | กระดิ่งของผู้รับที่เสียสิทธิ์อ่านรายจ่ายหลังได้แจ้ง | รายการหายจากกระดิ่งและตัวเลขยังไม่อ่านลดลงตาม (F11) |
| A29 | ไฟล์รูปแบบ e-Tax ลงนามถูกต้อง จากผู้ขายที่ไม่อยู่ในรายชื่อตามข้อ 12 | ป้าย S13a/S17 บอกแค่คุณสมบัติไฟล์ ไม่มีคำว่า "ตัวจริง"; สิทธิภาษีซื้อยังรอคนตัดสิน (F1) |
| A30 | ตายหลัง OCR admission ก่อนบันทึก checkpoint แล้วรอบใหม่: อ่านไม่ได้ผล / ได้ผล / จบเร็วเพราะไฟล์หลักถูกเปลี่ยน / runner เก่าที่ lease หลุดพยายามจบงาน | หน่วยคืนครบ / ใช้หนึ่งหน่วย / คืนครบ / runner เก่าไม่คืนหน่วยของ runner ใหม่ — ทุกกรณีหนึ่งหน่วยหรือศูนย์ ไม่ค้าง (F2, B7, BL2) |
| A31 | PDF ที่มี `/URI (javascript:…)` | ปฏิเสธเหมือนเดิม (F3) |
| A32 | XML TypeCode 388 | `sourceDocumentType = TAX_INVOICE`; S17 แสดงได้เมื่อ VERIFIED (F5) |
| A33 | สมาชิกส่งต่อไฟล์ที่ซ้ำกับรายจ่ายของสาขาอื่น | S11t3 ไม่มีลิงก์/รหัสรายการ (F6) |
| A34 | ข้อความเดียว: e-Tax auto + PDF ธรรมดาพัก แล้วไม่รับส่วนที่พัก | ร่างเดิมคงอยู่พร้อมหัวอีเมล; ไบต์ไฟล์ที่ไม่รับถูกลบใน 30 วัน (F7) |
| A35 | สองข้อความพร้อมกันตอนช่อง auto เหลือ 1 | ร่างเพิ่มหนึ่งรายการ อีกไฟล์ `DAILY_LIMIT` (F8) |
| A36 | เรื่องพักในกระดิ่ง "ยังรออยู่" | อยู่จนกดรับ/ไม่รับ แล้วเป็น S20r (F9) |
| A37 | export ชุด full / summary | มี / ไม่มีคอลัมน์ผลตรวจไฟล์อิเล็กทรอนิกส์ (F10) |

## 16. Risks / rollout

- **ลำดับ**: (0) B1 แยกปล่อยก่อน (UAT → ถามเจ้าของก่อน Production) → (1) B2 + อ่าน/ตรวจ e-Tax + B4/B6 → (2) อีเมล (MX/stream/secrets/MC2) ตาม [deployment protocol](../runbooks/uat-production-v2-deployment.md) และ [cloud runbook](../runbooks/cloud-environment-operations.md)
- **B1 อาจปฏิเสธ PDF ที่เคยผ่าน** (ชื่ออำพราง, object stream ที่ไม่ใช่ Flate, ไฟล์ใหญ่มาก, ไฟล์โครงสร้างเสียที่ตัวแยกคำอ่านไม่จบ, `/Length` ผิดแล้วสองแบบให้ผลต่างกัน) — วัดด้วย corpus ใบเสร็จจริงก่อนปล่อย (MC7); ข้อความ S18b บอกทางออก
- **ไม่มีสวิตช์**: ห้าม deploy การ์ดเว็บก่อน inbound ของสภาพแวดล้อมนั้นทำงาน
- **ไฟล์จริง** ต้องมีก่อนเรียกว่าเสร็จ (MC1); **trust store** ผิด/หมดอายุ → ป้ายหาย (fail safe)
- **ต้นทุน**: บัญชี Postmark ต้องเป็น Pro ขึ้นไป (Basic ไม่มี inbound — R15d); inbound ทุกฉบับนับ (Pro เกิน $1.30/1,000) ยกเว้นที่ Postmark บล็อก; การบล็อกระดับ Postmark กระทบทุกร้าน (R15e) จึงใช้เฉพาะการต่อต้านการละเมิดระดับแพลตฟอร์ม ที่ได้รับอนุมัติแยก
- **PDPA**: Postmark เก็บเนื้อหาและไบต์ไฟล์แนบตาม retention ของบัญชี (R15b, R15c) แยกจากสำเนาในร้าน — คำว่า "ลบภายใน 30 วัน" ใช้กับสำเนาในร้านเท่านั้น; ระยะของผู้ให้บริการบอกใน S27 และ ROPA (F11) — MC11
- **ถ้อยคำ e-Tax (F1)**: ไม่ตรวจรายชื่อตามข้อ 12 — ถ้าเจ้าของต้องการให้ระบบบอกว่าผู้ออกมีสิทธิ์ ต้องทำงาน rd-taxpayer-verification ก่อน
- **Help pack**: การ์ดใหม่ใน v7 เท่านั้น; v6 ไม่เปลี่ยน
- **Backlog #25**: รวมคอลัมน์ export กับงานลดคอลัมน์

## 17. Open questions (การตัดสินใจธุรกิจของเจ้าของ — มีคำแนะนำ)

| # | คำถาม | คำแนะนำ |
|---|---|---|
| Q1 | PDF ธรรมดาจากผู้ส่งใหม่: พักครั้งแรกแล้วจำ หรือสร้างร่างทันที | **พักครั้งแรกแล้วจำ** |
| Q2 | เอกสารที่อ่านจาก XML นับในโควตาใบเสร็จหรือไม่ | **ไม่นับ** — ไม่มีต้นทุน AI |
| Q3 | ระยะเก็บข้อมูลที่ Postmark: คง 45 วัน (ค่าตั้งต้น $0) หรือซื้อ Retention add-on 7 วัน (ทั้งบัญชี รวมขาออก; ตัวอย่างที่ประกาศบนแผน 10K = **$45/เดือน** — R15c; หน้าราคาเขียน "starts at $5" สำหรับระยะอื่น) | **คง 45 วันตอนเปิดใช้** แล้วเขียนระยะนี้ในภาคผนวกผู้ประมวลผล/ROPA (MC11) — ฝั่งเราลบสำเนาที่พักใน 30 วัน (Q7); ทบทวน 7 วันเมื่อได้ราคาจริงของบัญชี (MC3) และปริมาณ (MC4); ถ้าเจ้าของให้น้ำหนักการลดข้อมูลมากกว่า $45/เดือน (~1,500 บาท) เลือก 7 วันได้ ข้อมูลขาออกของเราอยู่ใน `EmailSendAttempt` แล้วจึงไม่เสียอะไร |
| Q4 | ทุกแพ็กหรือแพ็กสูง | **ทุกแพ็ก** |
| Q5 | โดเมน | **`bill.mangmeeplus.com`** / `bill.uat.mangmeeplus.com` |
| Q6 | ผู้รับเอกสารตั้งต้น | **ผู้สร้าง** (ถ้าผ่านเงื่อนไข) |
| Q7 | เก็บไฟล์ที่พัก/ไม่รับ (สำเนาในร้าน) | **30 วัน นับรายไฟล์** — หัวอีเมลของไฟล์ที่ผูกรายจ่ายเก็บตามรายจ่าย (§7.5, F7); สำเนาที่ Postmark ตาม Q3 (S27) |
| Q8 | รับต้นทุน Postmark ขาเข้า (แผน Pro+ $16.50/10K, เกิน $1.30/1,000, นับรวมที่ถูกพัก/ปฏิเสธในแอป) ภายใต้เพดาน §7.2 | **รับ** — ทบทวนเมื่อได้ตัวเลขจาก MC4 |

## 18. Must close before coding

| # | เรื่อง | เจ้าของ | ขั้นต่อไป | กั้นขั้นไหน |
|---|---|---|---|---|
| MC1 | ไฟล์ e-Tax จริง ≥ 3 แบบ (PDF/A-3 ลงนาม CA, คู่ Time Stamp + .eml, ไฟล์ผู้ให้บริการ) | เจ้าของ/controller | ขอจากผู้ขายที่ยินยอม เก็บนอก git | P2, P3 จับคู่ |
| MC2 | `OriginalRecipient` เป็น envelope recipient หรือไม่ | controller + ops | inbound stream UAT (ขออนุญาตแตะ cloud) ทดสอบ To/Cc/Bcc/forward | P3.2 |
| MC3 | แผนบัญชี Postmark ปัจจุบัน (Pro+?) และราคา Retention add-on จริงของบัญชีนี้ (ตัวอย่างประกาศ: แผน 10K 7 วัน $45 — ยังไม่ใช่ใบเสนอราคาของเรา) | controller | อ่านหน้าบัญชี (อ่านอย่างเดียว) | Q3, P3 |
| MC4 | ปริมาณ inbound ต่อร้าน | controller | ประมาณจากจำนวนร้าน | Q8 |
| MC5 | ใบรับรอง TSA ของ ETDA และโครงสร้างตราประทับ | controller | อ่านจากไฟล์จริง (MC1) + nrca.go.th | trust manifest |
| MC6 | NRCA root PEM + fingerprint | controller | ดาวน์โหลดและเทียบ | trust store |
| MC7 | corpus false-refusal ของตัวตรวจใหม่ (ใบเสร็จ PDF จริงของ proof stack + M-14 corpus) และพฤติกรรม `zlib maxOutputLength` เมื่อเกิน | lane P1 | รัน scanner บน corpus ในเครื่อง บันทึกจำนวนที่ถูกปฏิเสธพร้อมเหตุ | P1 ปล่อย |
| MC8 | เวอร์ชัน `fast-xml-parser`/`pkijs` | controller | advisory + audit | P2 |
| MC9 | อนุมัติ help pack v7 | เจ้าของ | หน้าทบทวนคู่มือ | การ์ด S24 |
| MC10 | ingress ส่ง `Authorization` ถึง API | ops | ทดสอบ UAT | P3 deploy |
| MC11 | ภาคผนวกผู้ประมวลผล/ROPA รวมไฟล์แนบใน Postmark | เจ้าของ/ที่ปรึกษากฎหมาย | ร่างตาม R15b, R17 | Production |
| MC12 | ที่อยู่ของเคส test ตัวนับ executive — **การตัดสินของเจ้าของ (P49)**: ไม่มีไฟล์ executive ใน `apps/api/package.json`; ตัวนับเป็น SQL จึงทดสอบจริงได้แค่ใน PG spec (`executive-report-build.pg.spec.ts` / `executive-report-read.pg.spec.ts` ซึ่งอยู่แค่ใน [ci.yml:811, :815](../../.github/workflows/ci.yml)) | เจ้าของ | เลือก (ก) **แนะนำ**: อนุญาตเคสใหม่ในสอง PG spec เดิมเป็นข้อยกเว้นของกติกา รันในเครื่องด้วย `EXECUTIVE_REPORT_*_TEST_DATABASE_URL` ตาม ci.yml (จำนวน test > 0, skip 0); หรือ (ข) ตัดตัวนับ executive ออกเป็นงานแยก — ระหว่างนั้นรายงานผู้บริหารไม่นับใบเสร็จทางอีเมล และนับรายการทางอีเมลที่ยืนยันแล้วเป็น "เว็บ" ([executive-report-build.use-case.ts:373](../../apps/api/src/modules/executive-business/application/executive-report-build.use-case.ts)) | P6.1 |
| MC13 | LINE file lane: event ซ้ำหลังงานอ่านจบ ถึง `queueExpenseRead` ได้หรือไม่ (ถ้าได้ = admission ซ้ำ เป็นบั๊กเดิม) | controller | อ่านการกัน event ซ้ำของ webhook/ledger ก่อน `process-line-webhook.use-case.ts:11018` | บันทึกบั๊ก (ไม่กั้น) |
| MC14 | EKU/KeyUsage ที่ CA ไทยใส่ในใบรับรองลงนามเอกสาร | controller | อ่านจากไฟล์จริง (MC1) แล้วตั้งรายการใน trust manifest | P2.3 |
| MC15 | ตำแหน่งคอลัมน์ `electronic_evidence_status` ใน workbook ใหม่ของ accountant-export-cleanup | controller + เจ้าของสเปก export | ตกลงว่าแสดงเป็นคอลัมน์ตามโครงสร้าง (แสดงเมื่อมีค่า) หรือชุด full เท่านั้น | P6.1 |

## 19. Unreviewed fixes from round 4 — BLOCKERS

รอบที่ 4 เป็นรอบทบทวนเต็มรอบสุดท้าย; การตรวจเฉพาะจุด (2026-10-24) **ปิด BL1** และ**ยังเปิด BL2** — แบบของ BL2 ด้านล่างแก้ตามผลตรวจนั้นแล้ว (v2) แต่ยังไม่มีใครทบทวน จึงเป็น blocker ที่มีชื่อ: ห้ามเริ่ม P2.4 (ทาง AI ของ runner) และขั้นที่ต่อจากมัน จนกว่าการทบทวน BL2 v2 ผ่าน; P1 (B1 ตัวตรวจ PDF) ไม่ขึ้นกับ BL2 ปล่อยก่อนได้

| # | สถานการณ์ที่ล้ม | การแก้ที่ออกแบบ | ด่านทบทวน (focused check) | กั้นขั้น |
|---|---|---|---|---|
| BL1 (F1, HIGH) — **CLOSED** 2026-10-24 (focused check: ป้าย fact และ export บอกคุณสมบัติไฟล์ สิทธิ์ผู้ออกยังเป็นการตัดสินของคน) | ผู้ขายที่**ไม่อยู่**ในรายชื่อตาม กฎกระทรวง 384 ข้อ 12 ส่ง PDF/A-3 ที่ลงนามถูกต้องด้วยใบรับรองจาก CA ที่ NRCA รับรอง + XML ETDA + TypeCode 388 + เลขผู้ขาย → แบบเดิมได้ป้าย "e-Tax" และ S17 "มีไฟล์ e-Tax ตัวจริง" ทั้งที่ใบนี้อาจใช้เป็นใบกำกับภาษีไม่ได้ (82/5) | ไม่ตรวจรายชื่อ (non-goal §3) จึงจำกัดถ้อยคำและข้อมูลที่ได้ให้เท่าคุณสมบัติที่ตรวจ: fact เปลี่ยนชื่อเป็น `verifiedElectronicFile` (§9.4), ป้าย "รูปแบบ e-Tax" (S13a/S13b/S14/S14b/S25), S17 "แนบไฟล์อิเล็กทรอนิกส์ที่ลงนามถูกต้องแล้ว", ค่าคอลัมน์ export ไม่ใช้คำว่าตัวจริง (§11), สิทธิภาษีซื้อยังเป็นของคน (P4); R1/R12 แก้ตามต้นฉบับ (A29) | ผู้ทบทวนอ่าน mr384 ข้อ 12–19 เอง แล้วยืนยัน (1) ไม่มีถ้อยคำ fact หรือคอลัมน์ใดเหลือที่อ้างสิทธิ์ผู้ออกหรือ "ตัวจริง" (grep `ตัวจริง`, `electronicOriginal`, `e-Tax ·` ในสามไฟล์) (2) auto-intake ตาม §9.2 ข้อ 1 ยอมรับได้แม้ไม่ตรวจรายชื่อ (ร่างยังต้องคนยืนยัน) (3) ป้าย "รูปแบบ e-Tax" ไม่ทำให้ผู้ใช้เข้าใจว่าเป็นใบที่ใช้ภาษีซื้อได้ | P2.5, P5.2, P6.1 (ป้าย ข้อความ export) |
| BL2 (F2, HIGH) — **OPEN** (v2 รอทบทวน) | (ก) งานอ่านผ่าน OCR admission แล้ว process ตายก่อน persist ครั้งแรก → รอบใหม่ได้ `duplicate` ไม่มี `ocrEventId` → ไม่ release/settle; (ข) **ผลตรวจเฉพาะจุด**: admission → ตาย → ไฟล์หลักถูกเปลี่ยน → รอบใหม่จบ `CANCELLED` ที่ `ownerStillValid` (:212) ก่อนกู้ event → หน่วยรั่ว; (ค) **ผลตรวจเฉพาะจุด**: B กู้ event ของ A แล้วอ่านได้ผล แต่ A เสีย fence และ release event เดียวกันก่อนเช็กความเป็นเจ้าของ (release อยู่ก่อน `updateJobFenced` :644-658) → การอ่านของ B ไม่ถูกคิด | §7.4 ข้อ 3b v2: (1) กู้ event ด้วย unique key ใน tx ของ `finish()` สำหรับ**ทุก**ผลลัพธ์รวมทางออกเร็ว; (2) release/settle อยู่ใน `$transaction` เดียวกับการเขียนสถานะแบบ fenced + outbox — fence ได้ 0 แถว → rollback ไม่ชดเชย; ชดเชยล้ม → rollback งาน claim ใหม่ได้; (3) `duplicate` ไม่มี id → กู้/admit ใหม่หนึ่งครั้ง, persist ก่อน provider, persist ล้ม → หยุดโดยไม่ชดเชย; test (a)–(g) ใน runner spec + เคส PG ของ tx release/settle ซ้อนใน tx ที่ fenced ใน `company-tax-identity-migration.pg.spec.ts` (§14, A30) | ผู้ทบทวนไล่ทุกทางออกของ `execute()` (:209-…) หลังและก่อน admission และทุก interleaving ของสอง runner บน requestId เดียว แล้วยืนยันว่า (1) ทุก requestId ที่ admitted จบด้วย release หรือ settle หนึ่งครั้ง (2) การชดเชยเกิดเฉพาะเมื่อ terminal write ของผู้ถือ lease commit (3) advisory lock ของ governance ใน tx ของ finish ไม่ทำให้ deadlock กับ admission (ลำดับ lock เดิม `partner-ocr-config` → `ocr-quota`) | P2.4 (ทาง AI ของ runner) และขั้นที่ต่อจากมัน (P3.3) |
