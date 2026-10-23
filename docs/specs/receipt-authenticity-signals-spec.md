# Receipt Authenticity Signals Spec — ข้อสังเกตว่าใบเสร็จหรือสลิปอาจทำด้วย AI หรือถูกแก้

Status: READY (docs-first) — reviewed 4 rounds 2026-10-24, no HIGH open; see ต้องปิดก่อนเขียนโค้ด (§18)
Owner: Expense/Reimbursement lane
Related: `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md` (#8), `docs/plans/receipt-authenticity-signals-plan.md`, `docs/agent-memory/receipt-authenticity-signals.md`, `docs/specs/expense-receipt-upload-spec.md` (duplicate lifecycle บรรทัด 1307), `docs/specs/vendor-address-and-counterparty-autosave-spec-th.md` (buyer-as-printed warn-only), `docs/specs/line-payment-evidence-pairing-spec.md`, `docs/specs/reimbursement-step-journey-spec-th.md`, `docs/plans/rd-taxpayer-verification-plan.md` (DRAFT ต้อง spike), `docs/guidelines/thai-ux-standard.md`
Baseline: main 6c54ba208 (2026-10-23) — อ่านโค้ดจาก worktree `expense-specs-20261023` (tree เดียวกับ main)

หลักใหญ่: **เตือนผู้มีอำนาจตัดสินใจ ไม่บล็อก ไม่กล่าวหาผู้ส่ง ไม่ออกนอกบริษัท อธิบายได้ด้วยข้อเท็จจริง และไม่เพิ่มค่า AI ต่อใบ** ผู้ใช้เห็นชื่อ "ข้อสังเกตเอกสาร"; ในโค้ดใช้ `authenticity` ป้าย "(รีวิว Fn)" = รอบ 1, "(R2-Fn)" = รอบ 2

---

## 1. ปัญหา (พฤติกรรมปัจจุบัน)

### 1.1 ไม่มีการตรวจว่าไฟล์ทำด้วย AI หรือถูกแก้

- รับไฟล์ได้แค่ `image/jpeg`, `image/png`, `application/pdf` ([attachment.logic.ts:10-13](../../apps/api/src/modules/data-model-core/domain/logic/attachment.logic.ts))
- ตอนอัปโหลดเสร็จ ตรวจแค่ขนาด/ชนิด ลายเซ็นไฟล์และ active content มัลแวร์ checksum SHA-256 และ pHash 64 บิต ([complete-attachment-upload.use-case.ts:101-131](../../apps/api/src/modules/data-model-core/application/use-cases/complete-attachment-upload.use-case.ts)); ไม่มีโค้ดอ่าน EXIF/XMP/IPTC/C2PA/ผู้ผลิต PDF (ค้นทั้ง `apps/` `packages/`)
- API เก็บไบต์ที่ได้รับโดยไม่ re-encode ([complete-attachment-upload.use-case.ts:133-137](../../apps/api/src/modules/data-model-core/application/use-cases/complete-attachment-upload.use-case.ts))
- **แต่เว็บอาจแปลงรูปก่อนส่ง (รีวิว F4):** `prepareUploadFile` ส่งไบต์เดิมเฉพาะ PDF หรือ JPEG/PNG ที่ ≤ 6 MB และชนิดไฟล์ตรงกับไบต์จริง ([expense-upload.logic.ts:17, 302-304](../../apps/web/src/features/expenses/expense-upload.logic.ts)); นอกนั้น — JPEG/PNG เกิน 6 MB, HEIC/HEIF (รวม HEIC ที่ซ่อนหลังนามสกุล .jpg), GIF และรูปชนิดอื่น — ถูก decode แล้ววาดลง canvas เป็น JPEG ใหม่ หรือแปลงด้วย `heic-to` ([expense-upload.logic.ts:273-276, 305-343](../../apps/web/src/features/expenses/expense-upload.logic.ts)) ซึ่ง**ไม่มี EXIF/XMP/C2PA ติดมา**; ใบเบิกบนเว็บใช้ทางเดียวกัน (`prepareAttachmentUpload` [upload-file.logic.ts:49-56](../../apps/web/src/common/files/upload-file.logic.ts) ← `uploadReceiptFile` [reimbursements.api.ts:118-121](../../apps/web/src/features/reimbursements/reimbursements.api.ts)) → รูป HEIC จาก iPhone และรูปกล้องขนาดใหญ่จะไม่มี metadata ให้ตรวจ
- ภาพย่อ/ไทล์สำหรับ OCR อยู่ในหน่วยความจำ manifest ชี้ไฟล์ต้นฉบับ ([expense-capture-preprocess.logic.ts:1-12](../../apps/api/src/modules/expenses/domain/logic/expense-capture-preprocess.logic.ts))
- LINE: ดึงไบต์จาก content API ([process-line-webhook.use-case.ts:13174-13215](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts)) แล้วทุกทางปิดอัปโหลดผ่าน `CompleteAttachmentUploadUseCase` ตัวเดียวกับเว็บ (ใบเสร็จ [process-line-webhook.use-case.ts:10471](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts) → [expense-upload.use-case.ts:364](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts); ไฟล์ถามตอบ/ใบเบิก/สื่อรอถาม [process-line-webhook.use-case.ts:11316, 11326, 11360, 11636](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts); สลิปจ่าย [expense-upload.use-case.ts:715](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts))
- LINE ลบ metadata หรือไม่: **ยังยืนยันไม่ได้** (ไม่พบเอกสารทางการ) — ออกแบบให้ถูกทั้งสองกรณีและวัดด้วย telemetry (§11.9)

ความครอบคลุมของกลุ่ม A (ข้อมูลในไฟล์):

| ช่องทาง | ไบต์ถึง API แบบเดิม? | กลุ่ม A ใช้ได้? |
|---|---|---|
| เว็บ PDF | ใช่ | ใช่ (ผู้ผลิต PDF) |
| เว็บ JPEG/PNG ≤ 6 MB ชนิดตรง | ใช่ | ใช่ |
| เว็บ JPEG/PNG > 6 MB, HEIC/HEIF, GIF, ชนิดไม่ตรง | ไม่ (canvas/heic-to) | ไม่ |
| LINE รูป / LINE ส่งเป็นไฟล์ | ไม่ทราบ (G1) | วัดจาก telemetry |

กลุ่ม C (ตัวเลข) และ D (QR สลิป) ไม่พึ่ง metadata จึงใช้ได้ทุกช่องทาง (QR ต้องอ่านออกหลังการบีบอัด — plan Phase 0.2)

### 1.2 สิ่งที่มีอยู่แล้ว (ใช้ซ้ำ)

| เรื่อง | ที่มีอยู่ | หลักฐาน |
|---|---|---|
| ใบซ้ำ | checksum (ไม่จำกัดเวลา), pHash ≤ 6 บิต, เลขเอกสาร, ผู้ขาย+วัน+ยอด, เลขผู้เสียภาษี+ยอด ±3 วัน | [expense-duplicate.logic.ts:80-165](../../apps/api/src/modules/expenses/domain/logic/expense-duplicate.logic.ts), [expense-duplicate-detection.ts:21, 50-68](../../apps/api/src/modules/expenses/application/services/expense-duplicate-detection.ts) |
| ใบเบิกที่อาจซ้ำ | ค่าตั้งต้น `BLOCK_PAYMENT` | [reimbursement.constants.ts:57](../../apps/api/src/modules/reimbursements/domain/reimbursement.constants.ts), [reimbursement.logic.ts:790-791](../../apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic.ts), [reimbursement-request.use-case.ts:638-647](../../apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.ts) |
| สลิปคู่ใบเสร็จใน LINE | จับคู่อัตโนมัติเมื่อในช่วง 2 ชม. มีใบเสร็จยอดตรง **ใบเดียว** และวันที่ตรงกัน **หรือฝั่งใดฝั่งหนึ่งไม่มีวันที่** (รีวิว F27) | [line-payment-evidence.logic.ts:3, 27-40](../../apps/api/src/modules/expenses/domain/logic/line-payment-evidence.logic.ts) (เงื่อนไขวันที่บรรทัด 37) |
| เลขอ้างอิงบนสลิป | OCR ใส่ "รหัสอ้างอิง/เลขที่รายการ" ลงเลขเอกสาร | [line-ai-internal.controller.ts:1270](../../apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts) → [receipt-ocr-apply.service.ts:1027](../../apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts) |
| ตัวเลขไม่ลงตัว | `ITEMS_DID_NOT_RECONCILE` + `itemsSumAmount` — **เส้นทาง PDF ไม่เก็บค่านี้ (B7)** | [receipt-ocr-apply.service.ts:884-903](../../apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts), [expense-extraction.use-case.ts:277-282](../../apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts) |
| เลขผู้เสียภาษีผิดหลัก | `thaiTaxIdChecksumValid` (เตือนเท่านั้น) ใช้ในหน้าเว็บรายจ่าย, ช่องคู่ค้าบนเว็บ และการ์ดแก้คู่ค้าใน LINE — แต่ไม่ถึงผู้อนุมัติใบเบิก (R3-F7) | [company-tax-identity.ts:143-149](../../packages/contracts/src/company-tax-identity.ts), [expenses.model.ts:1380-1391](../../apps/web/src/features/expenses/expenses.model.ts), [CounterpartyFields.tsx:23](../../apps/web/src/features/counterparties/CounterpartyFields.tsx), [line-counterparty.service.ts:159](../../apps/api/src/modules/line-ai/application/line-counterparty.service.ts) |
| แบบอย่าง warn-only + เหตุผล | buyer-as-printed | [buyer-as-printed.logic.ts:1-11](../../apps/api/src/modules/expenses/domain/logic/buyer-as-printed.logic.ts), [expense-upload.use-case.ts:654-669](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts), [prisma-expense.repository.ts:4497-4521](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts) |
| อำนาจอนุมัติใบเบิก | อนุมัติได้จากสิทธิ์ปัจจุบัน**หรือ**การมอบหมายที่แช่แข็งตอนส่ง (`assignedBySnapshot`); endpoint ใช้ `@RequirePermissions('account.session.read')` แล้วตัดสินใน use case; detail คำนวณ `approvalActions` ให้แล้ว | [reimbursement-approval.use-case.ts:133-160, 162-175](../../apps/api/src/modules/reimbursements/application/use-cases/reimbursement-approval.use-case.ts), [reimbursement.controller.ts:322-327](../../apps/api/src/modules/reimbursements/presentation/http/reimbursement.controller.ts), [reimbursement-request.use-case.ts:409](../../apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.ts) |
| ช่องตรวจ e-Tax | ยังไม่ตรวจจริง ค่าเป็น `NOT_CHECKED` หรือ `UNAVAILABLE` (รีวิว F26) | [schema.prisma:3386-3388](../../apps/api/prisma/schema.prisma), [expense-capture-read-runner.service.ts:597-604](../../apps/api/src/modules/expenses/application/services/expense-capture-read-runner.service.ts) |

### 1.3 ใครเห็นอะไรวันนี้

- ผู้ตรวจรายจ่ายเห็นข้อเตือนตัวเลขไม่ลงตัว**เฉพาะในขั้น "ข้อมูล"** ของหน้าแบบ guided (`aiPrefillBanner` อยู่ใน `step === 'data'` [ExpenseReviewPage.tsx:2212-2215](../../apps/web/src/features/expenses/ExpenseReviewPage.tsx); ตัวป้าย [ExpenseReviewPage.tsx:1745-1752](../../apps/web/src/features/expenses/ExpenseReviewPage.tsx)) ไม่เห็นในขั้นตรวจสุดท้ายและหน้าอ่านอย่างเดียว (รีวิว F6); เลขผู้เสียภาษีผิดหลักอยู่ใน `auditCard`
- ผู้อนุมัติใบเบิกไม่เห็นทั้งสองอย่าง — หน้าใบเบิกมีแค่ "เอกสารที่อาจซ้ำ" ([ReimbursementJourneyPage.tsx:710-727](../../apps/web/src/features/reimbursements/ReimbursementJourneyPage.tsx))
- การ์ดอนุมัติใน LINE แสดงแค่บัญชีรับเงิน ([line-expense-action.service.ts:565](../../apps/api/src/modules/line-ai/application/line-expense-action.service.ts))
- ผู้สร้างอ่านรายละเอียดรายจ่ายของตัวเองได้ ([expense-draft.use-case.ts:225-245](../../apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts)); พนักงานมีแค่ `*_own/*_related` ([permission-registry.ts:527-540](../../apps/api/src/modules/auth/permission-registry.ts))
- เครื่องมืออ่านของน้องมั่งมี map ฟิลด์ทีละตัว ([erp-core-detail-tools.use-case.ts:206](../../apps/api/src/modules/line-ai/application/use-cases/erp-core-detail-tools.use-case.ts))
- `AttachmentObject.metadataJson` **ผู้เรียกตั้งค่าเองได้** — DTO สาธารณะรับ `metadataJson` ([data-model-core.dtos.ts:30](../../apps/api/src/modules/data-model-core/presentation/http/data-model-core.dtos.ts)) แล้วเก็บตรง ([create-upload-intent.use-case.ts:110](../../apps/api/src/modules/data-model-core/application/use-cases/create-upload-intent.use-case.ts)) → `generatedBy` และป้ายอื่นในนั้นห้ามใช้ยกเว้นการตรวจใด ๆ (รีวิว F1)

## 2. เป้าหมาย

1. ผู้ตรวจรายจ่าย ผู้อนุมัติ และฝ่ายการเงิน เห็น "ข้อสังเกตเอกสาร" พร้อมข้อเท็จจริงที่เป็นเหตุ ทั้งเว็บ (390, 1280, ~1,556 px) และการ์ดอนุมัติ/ยืนยันใน LINE
2. ผู้ส่งที่ไม่มีอำนาจตัดสินใจไม่เห็นข้อสังเกตทุกช่องทาง รวมคำตอบของน้องมั่งมี (ข้อยกเว้นตั้งใจ: ผู้ส่งที่ถืออำนาจตัดสินใจเอง — §4)
3. ผู้มีอำนาจบันทึก "ตรวจแล้ว" ได้ ผูกกับรายการ ไฟล์ และข้อเท็จจริงชุดที่เห็น — ข้อเท็จจริงเปลี่ยนแล้วกลับเป็นค้าง
4. ไม่บล็อกการยืนยัน อนุมัติ จ่าย ไม่เปลี่ยนสถานะภาษี ไม่มีสวิตช์
5. ไม่มีค่า AI เพิ่ม ไม่เรียกบริการนอก ไม่จับคู่ข้ามบริษัท
6. ไม่พบ = ไม่แสดงอะไร (ไม่มีป้าย "ผ่าน")

## 3. Non-goals (พร้อมเหตุผล)

- **ไม่ใช้ AI ตัดสินว่าภาพปลอม** — AIForge-Doc (ก.พ. 2569): GPT-4o zero-shot AUC 0.509 "essentially at chance" ([arXiv 2602.20569](https://arxiv.org/abs/2602.20569)); งานใหม่กว่าของทีมเดียวกัน AIForge-Doc v2 (28 เม.ย. 2569) กับเอกสารที่ปลอมด้วย GPT-Image-2: ผู้ตรวจที่เป็นคนได้ค่าเทียบ AUC 0.501, TruFor 0.599, DocTamper 0.585, ให้โมเดลตัดสินงานของตัวเอง 0.532 (ไม่เกิน 0.59 ทุก prompt) ขณะที่ตัวตรวจเดียวกันได้ 0.962/0.852 กับการปลอมแบบเดิม ([arXiv 2604.25213](https://arxiv.org/abs/2604.25213)) (R2-F12)
- **ไม่ทำ pixel forensics** — DOCFORGE-BENCH: เกณฑ์ตั้งต้นใช้ไม่ได้ ชุดข้อมูลเก่ากว่างานแก้ด้วย generative AI ([arXiv 2603.01433](https://arxiv.org/abs/2603.01433))
- ไม่ตรวจลายเซ็น/ความถูกต้องของ C2PA — อ่านแค่ว่าไฟล์**ประกาศ**เรื่อง AI (คนโกงไม่มีเหตุให้ปลอมคำประกาศนี้เพิ่ม); ไม่ดึง manifest ภายนอก (remote/sidecar); ไม่อ่าน C2PA ใน PDF (ถูกปฏิเสธตั้งแต่อัปโหลด G3)
- **ไม่เรียกบริการตรวจภายนอกใด ๆ โดยตั้งใจ** — OpenAI มีเครื่องมือ Verify สาธารณะ (research preview) สำหรับรูปของ OpenAI เอง และ Google ตรวจ SynthID ในแอป Gemini; เราไม่เรียกบริการเหล่านี้ (รีวิว F19)
- ไม่เรียก API ตรวจสลิปของธนาคาร/ผู้ให้บริการกลาง (§5.3, Q2)
- ไม่ตรวจกับกรมสรรพากร — รอแผน RD; ผลจะเป็นรหัสใหม่หนึ่งรหัสในตาราง §6.3
- ไม่แสดงในรายการ/คิว ไม่ใส่ไฟล์ส่งออก ไม่ส่งแจ้งเตือนใหม่ ไม่ backfill ไฟล์เก่า
- ไม่มีปุ่มบันทึก "ตรวจแล้ว" ใน LINE (ไม่มีการเขียนจาก LINE/AI)
- ไม่แก้ให้เว็บเลิกแปลงรูป (การย่อ/แปลง HEIC เป็นเรื่องขนาดไฟล์และ OCR ที่มีอยู่แล้ว) — บันทึกเป็น G13
- ไม่ตรวจลายเซ็น e-Tax (backlog #12); VAT ไม่ลงตัวกับฐานยังไม่ทำ (G6)

## 4. ผู้ใช้และ journey

| บทบาท | เว็บ | LINE |
|---|---|---|
| **พนักงาน/ผู้ส่ง** ที่ไม่มีอำนาจตัดสินใจ | ส่งเหมือนเดิม **ไม่เห็นข้อสังเกต** | ส่งเหมือนเดิม การ์ดบันทึกไม่เปลี่ยน น้องมั่งมีไม่พูดถึงข้อสังเกตของรายการใด |
| **ผู้อนุมัติใบเบิก** (อำนาจจาก `approvalDecisionActions` — สิทธิ์ปัจจุบันหรือการมอบหมายที่แช่แข็ง รวมผู้อนุมัติตามบทบาท) | การ์ดขั้นตอนมี "มีเอกสาร n ใบควรเทียบกับใบจริงก่อนอนุมัติ" + ลิงก์ไปการ์ด → ขอดูใบจริง/ถามผู้ส่ง → "ตรวจแล้ว" (ไม่บังคับ) → อนุมัติ/ไม่อนุมัติตามปกติ | การ์ดอนุมัติมีบรรทัดเดียวกัน + ปุ่ม "ดูเอกสาร" → อนุมัติด้วยการ์ดลงนามเดิม |
| **ฝ่ายการเงิน/ผู้จ่าย** (`reimbursement.finance_review` / `reimbursement.payment.record`) | เห็นการ์ดในขั้นตรวจการเงิน/จ่าย บันทึกได้ | ไม่เพิ่ม |
| **ผู้ตรวจ/ฝ่ายบัญชีรายจ่าย** (`expense.review`/`expense.confirm`) | การ์ดถัดจากการ์ดรายการซ้ำ แสดงข้อสังเกตค้างทุกกลุ่ม → "ตรวจแล้ว" | การ์ดยืนยันมี "มีเอกสาร n ใบควรเทียบกับใบจริงก่อนยืนยัน" + "ดูเอกสาร" |
| **ผู้ดูอย่างเดียว** (`expense.read`, `reimbursement.read`) | เห็นการ์ดและประวัติ ไม่มีปุ่ม | — |
| **ผู้ส่งที่มีอำนาจตัดสินใจเอง** (เจ้าของร้านคนเดียว, นักบัญชีส่งใบของตัวเอง) | เห็นและบันทึกได้ตามอำนาจ ประวัติต่อท้าย "(ผู้ส่งเอกสาร)" ตามจริง | เหมือนผู้อนุมัติ |

## 5. กติกาและข้อยกเว้น

### 5.1 กฎหมาย/ภาษี

- เก็บเอกสารประกอบการลงบัญชีไม่น้อยกว่า 5 ปี (พ.ร.บ.การบัญชี พ.ศ. 2543 ม.14 — [ฉบับแปล DBD](https://www2.dbd.go.th/dbdweb_en/download/pdf_law/ACCOUNTING_ACT_BE2543/act/act_accout_be2543.pdf), [หนังสือตอบข้อหารือ กรมสรรพากร](https://rd.go.th/25306.html)) — หน้าที่เก็บ**ไม่ได้รับประกัน**ว่าใบจริงยังมีอยู่: ม.15 กำหนดว่าถ้าบัญชีหรือเอกสารประกอบการลงบัญชีสูญหายหรือเสียหายต้องแจ้งภายในเวลาที่กำหนด ([พ.ร.บ.การบัญชี ฉบับรวม DBD](https://www.dbd.go.th/storage/law/9718f7ee-dd9f-463e-aa79-c7157355cec5.pdf)) (R3-F8) → คำแนะนำในการ์ดเป็นทางเลือก ("ขอดูใบจริง **หรือ**ขอไฟล์/สำเนาจากผู้ขาย") ไม่อ้างว่าใบจริงมีเสมอ; ถ้าใบจริงหายและผู้ขายออกสำเนาไม่ได้ ใช้ขั้นตอน "ใบรับรองแทนใบเสร็จ" ที่มีอยู่ (คำนี้อยู่ในคู่มือ Phase H ไม่ใส่บนการ์ด)
- ใบกำกับภาษีเต็มรูปต้องมีชื่อ ที่อยู่ และเลขประจำตัวผู้เสียภาษีของผู้ออก (ม.86/4 — [rd.go.th/5208](https://www.rd.go.th/5208.html))
- เลขประจำตัวผู้เสียภาษี 13 หลัก นิติบุคคลใช้เลขทะเบียนนิติบุคคล ([คำชี้แจงกรมสรรพากร 16 มี.ค. 2555, rd.go.th/30302](https://rd.go.th/30302.html)) (รีวิว F24)
- เลขตรวจหลักที่ 13: ระบบใช้ mod-11 อยู่แล้ว ([company-tax-identity.ts:143-149](../../packages/contracts/src/company-tax-identity.ts)); **ไม่พบเอกสารต้นฉบับของ DBD ที่ระบุสูตรของเลขนิติบุคคล** — ตรวจมือกับเลขบริษัทมหาชน 3 ราย (0107542000011, 0107536000102, 0107536000315) ผ่านหมด → ระดับกลาง ไม่ใช่ข้อสรุป + fixture test
- PDPA ม.22 เก็บเท่าที่จำเป็น ([ราชกิจจานุเบกษา](https://www.ratchakitcha.soc.go.th/DATA/PDF/2562/A/069/T_0052.PDF)) → ไม่เก็บ EXIF ดิบ (GPS, รุ่น/ซีเรียล) เก็บแค่ boolean และชื่อโปรแกรมจากรายการที่กำหนด
- ส่งสลิปให้ผู้ตรวจภายนอก = ผู้ประมวลผลรายใหม่ ต้องเข้าภาคผนวก sub-processor ของ DPA ก่อน (Q2)

### 5.2 หลักฐานภายนอก

| เรื่อง | ข้อเท็จจริง | แหล่ง |
|---|---|---|
| ขนาดปัญหา | ใบปลอมจาก AI 0% (มี.ค. 2568) → 70.8% ของใบปลอมที่จับได้ (กลาง พ.ค. 2569) ตัวอย่าง 1,471 ใบ 745 คน 174 บริษัท เฉลี่ยราว $100; metadata "still worth reading" แต่ไม่ใช่สัญญาณหลักเพราะ screenshot ลบข้อมูล | [AppZen](https://www.appzen.com/learn/receipt-fraud-the-four-types-and-how-finance-teams-detect-them) |
| พฤติกรรมคน | 34% ของ 2,000 คน (สหรัฐฯ 40%, อังกฤษ 29%) เคยใช้ AI ทำใบปลอม (5-8 พ.ค. 2569) | [Emburse](https://emburse.com/blog/ai-generated-receipts-expense-fraud) |
| สัญญาณที่ได้ผล | "the dominant forensic signals in AI-generated receipts are arithmetic errors" | [arXiv 2603.11442](https://arxiv.org/abs/2603.11442) |
| C2PA เวอร์ชันที่ใช้ (รีวิว F8, R2-F1) | **2.4 (เม.ย. 2569)**: assertion `c2pa.ai-disclosure` (§18.28) มี `modelType` บังคับ + `modelName`/`modelIdentifier`/`contentProfile` ไม่บังคับ — **ใช้บอกการใช้ AI เท่านั้น ไม่มีช่องบอกว่า "ไม่ได้ใช้ AI"** (กรณีไม่ใช้ AI คือไม่แนบ assertion นี้); `digitalSourceType` เป็น property (tstr) ของแต่ละ action ใน `c2pa.actions.v2` (§18.15.4.5) ค่าเป็นคำของ IPTC ควรอยู่กับ `c2pa.created`; "Custom labelled metadata assertions can contain any values from any schemas" (§18.17.3) จึง**ห้ามค้นแบบไบต์**; ตั้งแต่ 1.4 manifest บีบอัดในกล่อง `brob` ได้ (รีวิว F9) | [C2PA 2.4](https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html) (อ่าน §18.15, §18.28 เมื่อ 2026-10-24) |
| C2PA ฝังที่ไหน | JPEG: APP11 หลาย segment ต่อกัน (JUMBF); PNG: chunk `caBX`; PDF: embedded file `application/c2pa` | [C2PA annex embedding (2.2)](https://spec.c2pa.org/specifications/specifications/2.2/specs/C2PA_Specification.html) — changelog 2.4 ไม่ได้บอกว่าเปลี่ยน; ต้องยืนยันกับ annex ของ 2.4 ตอน implement |
| คำบอกว่าเป็น AI | `trainedAlgorithmicMedia` สร้างด้วย generative AI; `compositeWithTrainedAlgorithmicMedia` แก้/เติมด้วย generative AI; `compositeSynthetic` ผสมที่มี AI | [IPTC Digital Source Type](https://cv.iptc.org/newscodes/digitalsourcetype/) |
| ผู้ผลิตโมเดล (รีวิว F25) | OpenAI: ใส่ C2PA ในรูป DALL·E 3/ChatGPT ตั้งแต่ ก.พ. 2567; ประกาศลายน้ำ SynthID ในรูป **19 พ.ค. 2569** (คนละเหตุการณ์); ยอมรับว่า metadata ลบได้ง่าย; Google: Nano Banana Pro ฝัง C2PA (พ.ย. 2568) | [OpenAI advancing content provenance](https://openai.com/index/advancing-content-provenance/) (เปิดตรงได้ 403 — อ่านผ่านรายงานรอง), [OpenAI help 8912793](https://help.openai.com/en/articles/8912793-c2pa-in-chatgpt-images), [Google blog](https://blog.google/technology/ai/ai-image-verification-gemini-app/) |
| อ่าน metadata ด้วยของที่มี | sharp `metadata()` คืน `exif` (บัฟเฟอร์ดิบ), `xmpAsString`, `iptc`, `comments` (PNG text) | [sharp API](https://sharp.pixelplumbing.com/api-input/) |
| EXIF tag ที่อ่าน (รีวิว F7) | IFD0 `Software` (0x0131), `ProcessingSoftware` (0x000B) เท่านั้น — **ไม่อ่าน** `ImageDescription`, `UserComment`, `Artist` ฯลฯ ที่เป็นข้อความอิสระ | [ExifTool Exif.pm](https://raw.githubusercontent.com/exiftool/exiftool/master/lib/Image/ExifTool/Exif.pm) |
| ComfyUI (รีวิว F10, R2-F13) | SaveImage เขียน text `prompt`/`workflow` **เมื่อไม่ได้ปิด metadata** (`if not args.disable_metadata`) และมี input นั้น — ไม่ใช่ทุกครั้ง; เขียนแม้ workflow แค่ LoadImage→ImageScale→SaveImage → **ไม่ใช่หลักฐานว่าสร้างด้วย AI** และไฟล์ที่ปิด metadata ไม่มีร่องรอย | [ComfyUI nodes.py](https://raw.githubusercontent.com/Comfy-Org/ComfyUI/master/nodes.py) |
| PNG text keyword (R2-F11) | "Other keywords MAY be defined by any application" — ชื่อ keyword ทั่วไป (`parameters`, `prompt`, `workflow`) ไม่ระบุโปรแกรม | [PNG Third Edition §11.3.3](https://www.w3.org/TR/png-3/) |
| QR บนสลิป | TLV: root `00` (sub `00` = `000001` Verify Pay Slip, `01` ธนาคารผู้โอน 3 หลัก, `02` transRef ≤ 25), `51` = `TH`, `91` CRC; TrueMoney คนละรูปแบบ | [SCB mini QR](https://developer.scb.co.th/assets/documents/documentation/qr-payment/extracting-data-from-mini-qr.pdf) (อ่านผ่านผลค้นหา — DNS), [thai-qr-payment](https://thai-qr-payment.js.org/guide/slip-verify/) (ไลบรารีบุคคลที่สาม) |

### 5.3 สลิปโอนเงิน: ธนาคารให้อะไรกับ SME

- SCB: endpoint ตรวจสลิปที่พบระบุว่า "supports the slip verification of a QR 30 type payment" และต้องใช้ token ของคู่สัญญา ([SCB get billpayment transactions](https://developer.scb/assets/documents/api-reference-index/qr-payments/get-billpayment-transactions.html)) — เอกสารนี้ไม่ได้บอกว่าใช้ตรวจสลิปโอนทั่วไปที่ไม่ใช่ QR 30 ได้หรือไม่ และไม่ได้บอกว่าจำกัดเฉพาะ biller ของคู่สัญญา; **ขอบเขตและสิทธิ์ใช้สำหรับใบเบิกของเรา ยังยืนยันไม่ได้** (R2-P20)
- **ธนาคารอื่น (KBank, BBL, KTB ฯลฯ): สิทธิ์ตามสัญญาและขอบเขต API ตรวจสลิปสำหรับ SME ยังยืนยันไม่ได้** ไม่พบเอกสารสาธารณะ — ไม่สรุปว่าทุกธนาคารจำกัดแบบเดียวกัน (รีวิว F20)
- ผู้ให้บริการกลางคิดต่อสลิป เช่น แพ็กเกจ AIS ที่รวม SlipOK 500 สลิป/เดือน ส่วนเกิน 0.42 บาท ([AIS](https://www.ais.th/consumers/package/postpaid/rsme/slip-ok))
- ทางฟรี: ผู้อนุมัติสแกน QR ด้วยแอปธนาคารเอง — K PLUS "Verified by K+" ตรวจสลิปอายุไม่เกิน 90 วัน ([KBank help](https://support.linebk.com/en/personal/Digital-banking/kplus/help/Pages/verify-e-slip.html)); BBL มีหน้า "ตรวจสอบสลิปได้ทุกธนาคาร" ([BBL](https://www.bangkokbank.com/th-TH/personal/Grow-Club/Verify-eSlip), เปิดตรงหมดเวลา) → คำแนะนำใช้ "ลองสแกน"
- ในระบบเราเอง (Phase 4 ฟรี): QR ผิดรูปแบบ, เลขที่ OCR อ่านได้ไม่ตรง QR, transRef เดียวกันบนสลิปอีกไฟล์ในบริษัท

### 5.4 กติกาผลิตภัณฑ์ (บังคับ)

1. **เตือนเท่านั้น** — ไม่เปลี่ยน `status`, `taxEvidenceStatus`, `inputVatClaimStatus`, `duplicateStatus`, ไม่แตะประตูส่ง/อนุมัติ/จ่าย ไม่ผูก `duplicatePolicy`
2. **ไม่กล่าวหา** — คำบอกข้อเท็จจริงของไฟล์/ตัวเลข ไม่มีคำ "ปลอม/โกง/ทุจริต"; ไม่แสดงต่อผู้ส่งที่ไม่มีอำนาจตัดสินใจ
3. **ในบริษัทเท่านั้น** — ทุก query มี `companyId` + ขอบเขตสาขาของผู้ดู
4. **อธิบายได้** — แสดงข้อเท็จจริงที่เป็นเหตุ
5. **ไม่มีค่า AI/บริการนอก**
6. **ไม่พบ = เงียบ**
7. อ่านไฟล์ล้มเหลวไม่ทำให้อัปโหลดล้ม (fail-open แบบ pHash [complete-attachment-upload.use-case.ts:60-64](../../apps/api/src/modules/data-model-core/application/use-cases/complete-attachment-upload.use-case.ts))
8. ข้อสังเกตคำนวณตอนอ่านจากข้อเท็จจริงปัจจุบัน
9. `STRONG`/`MEDIUM` แสดงทุกช่องทางรวม LINE; `WEAK` แสดงเฉพาะเว็บ
10. **บันทึกตรวจแล้วผูก (รายการ, ไฟล์, code, ลายนิ้วมือข้อเท็จจริง)** — ไม่ใช้ร่วมข้ามรายการ ไม่ปิดถาวรทั้ง code (รีวิว F2)
11. ปุ่ม "ตรวจแล้ว" ส่งได้เฉพาะข้อสังเกตที่**แสดงอยู่และยังค้าง**ทุกตัว (รีวิว F3, F6)

### 5.5 ไฟล์ที่นับ (รีวิว F1, F11)

- **รายจ่าย — นับ:** ไฟล์ชุดเดียวกับที่หน้ารายจ่ายแสดงเป็นหลักฐาน คือผลของ `loadExpenseEvidenceSources` ([expense-evidence-sources.ts:13, 60-71](../../apps/api/src/modules/expenses/infrastructure/expense-evidence-sources.ts)) — ไม่ใช่ query `AttachmentLink` เอง (R2-P11) เพราะไฟล์ที่ปักไว้ในรายจ่ายที่ฉายจากใบเบิกถูกประกอบจาก snapshot ไม่มีแถว link: ครอบ purpose `expense.receipt.primary`, `expense.receipt.supporting`, `expense.payment.evidence`, `expense.review.evidence` (ไฟล์ปักจาก snapshot ที่ checksum ตรง และสแกนเอกสารเซ็นมือที่อัปโหลด [prisma-expense.repository.ts:2405-2415](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) และ `expense.capture.evidence`; ไม่นับรายการที่ resolver ทำเครื่องหมาย `isHistorical`
- **ใบเบิก — นับ (R2-F4):** ไฟล์จาก **snapshot ที่ปักไว้** ของบรรทัด — `line.sourceExpenseSnapshot.attachments` (id + checksum) ซึ่งเป็นชุดที่หน้าใบเบิกแสดง ([ReimbursementDetailSections.tsx:832](../../apps/web/src/features/reimbursements/ReimbursementDetailSections.tsx), type [reimbursements.ts:595-620](../../packages/contracts/src/reimbursements.ts)) และนับเฉพาะเมื่อไฟล์จริงยัง ACTIVE และ `checksumSha256` เท่ากับที่ปัก; บรรทัดที่ไม่มี snapshot ใช้ `line.attachmentId`; **ไม่อ่านหลักฐานสดของรายจ่ายที่ผูก** (ไฟล์ที่เพิ่มทีหลังไม่ใช่สิ่งที่ผู้อนุมัติเห็น)
- **ไม่นับ** เฉพาะเมื่อความสัมพันธ์ที่ server เขียนบอกว่าเป็นไฟล์ที่ระบบสร้างหรือไม่ใช่หลักฐานค่าใช้จ่าย: `ExpenseSubstituteReceiptEvidence.certifiedArtifactAttachmentId` / `artifactAttachmentId` (ไฟล์ที่ระบบสร้าง [schema.prisma:3180-3203](../../apps/api/prisma/schema.prisma)) — แต่ `wetSignedScanAttachmentId` (สแกนที่คนอัปโหลด) **นับ**; สลิปจ่ายคืนพนักงานของ `ReimbursementPayment`; ไฟล์ใบเตรียมจ่าย/50 ทวิที่ระบบสร้าง
- **ไฟล์ลายเซ็น (R2-F5):** ไม่ใช่การยกเว้นแบบเงียบ — ไฟล์ที่มี link `company.signature_asset` (`findSignatureAssetOwner` [prisma-attachment.repository.ts:85-97](../../apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-attachment.repository.ts)) ต้อง**ถูกปฏิเสธตั้งแต่ตอนแนบเป็นหลักฐานใบเบิก** (บั๊ก B6 §13); ระหว่างที่ยังไม่แก้ ถ้าพบไฟล์แบบนี้ในใบเบิก ให้นับและแสดงตามปกติ (ไม่ซ่อนข้อสังเกต)
- **ห้ามใช้ `metadataJson.generatedBy` / `generatedFor` ยกเว้นอะไรทั้งสิ้น** (ผู้เรียกตั้งค่าเองได้ §1.3); test: อัปโหลดพร้อม `metadataJson: { generatedBy: 'substitute_receipt' }` ยังได้ข้อสังเกต
- ชั้นป้องกันที่สอง: ไฟล์ที่ระบบสร้างถูกเขียนตรงด้วย `attachmentObject.create` ไม่ผ่าน `CompleteAttachmentUploadUseCase` จึงไม่มี `fileSignalsJson` (เช่น [prisma-expense.repository.ts:2915, 3030](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts))
- **ที่มาของการอ่านทาง LINE (R4-F1):** การเขียน summary ของรูปทาง LINE เก็บ `recognizedFields`, `classification` แต่**ไม่เก็บ `extractionAttachmentId`** ([process-line-webhook.use-case.ts:10599-10612](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts)) → ก่อน Phase 2 ต้องแก้ D-P1 ให้เขียน id ของไฟล์ที่ส่งให้ OCR ในการเขียนเดียวกัน; **ไม่มี fallback ไป `primaryAttachmentId`** — รายการ LINE ที่บันทึกก่อนแก้ไม่มีกลุ่ม C/`SLIP_REF_MISMATCH` (G15)
- **ไฟล์ที่ "ถูกอ่าน" (R2-F6)** ใช้กับ `FIGURES_DONT_ADD_UP`, `SELLER_TAX_ID_INVALID`, `SLIP_REF_MISMATCH`: = `aiVerificationSummaryJson.extractionAttachmentId` เมื่อ `sourceStale !== true` **และ** ไฟล์นั้นยังนับเป็นหลักฐานของรายการ; ไม่มีการเดาจาก `primaryAttachmentId` — เมื่อเปลี่ยนไฟล์หลักแล้ว ระบบเก็บค่าที่อ่านจากไฟล์เก่าไว้พร้อม `sourceAttachmentId` + `sourceStale: true` และลบ `extractionAttachmentId` ([expense-upload.use-case.ts:385-394](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts)) → **ไม่สร้างกลุ่ม C และ `SLIP_REF_MISMATCH` จนกว่าจะอ่านไฟล์ใหม่**; รายจ่ายที่ไม่เคยอ่าน (กรอกมือ) ไม่มีไฟล์ที่ถูกอ่าน จึงไม่มีกลุ่ม C บนการ์ด (G15) — แถวเตือนเดิมของหน้ารายจ่ายยังทำงาน
- **ใบเบิก (R2-F4, R3-F4) — กฎเดียว:** snapshot ไม่เก็บ `extractionAttachmentId`/`chargeReconciliation`/ผล OCR ดิบ จึงสร้างกลุ่ม C และ `SLIP_REF_MISMATCH` ของบรรทัดที่มี snapshot **ได้ก็ต่อเมื่อครบทั้งสาม**: (1) `expense.updatedAt` สดเท่ากับ `snapshot.expenseUpdatedAt` (ข้อเท็จจริงยังเป็นชุดที่ปัก [reimbursement-source.ts:49-63](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts)) (2) ไฟล์ที่ถูกอ่านของรายจ่ายสด (ไม่ stale) อยู่ใน `snapshot.attachments` และ checksum ตรง (3) ผล OCR ที่ใช้เปรียบเทียบมาจาก summary ของรายจ่ายนั้น; ขาดข้อใด → **ไม่สร้างข้อสังเกตที่พึ่งที่มาเหล่านี้เลย** (รวม `SELLER_TAX_ID_INVALID`) ไม่ใช้ค่าใน snapshot อย่างเดียว; กลุ่ม A และ QR อื่นของไฟล์ที่ปักยังสร้างได้

## 6. Data model (additive)

### 6.1 Migration

```prisma
model AttachmentObject {
  // ...ฟิลด์เดิม
  /// Receipt-authenticity spec §6.2: facts read from the stored bytes at upload completion.
  /// Server-set only by CompleteAttachmentUploadUseCase; never accepted from any DTO.
  fileSignalsJson     Json?
  /// Phase 4: `<sendingBank>:<TRANSREF>` from a bank slip's verification QR. Same-company lookup only.
  slipRefKey          String?  @db.VarChar(40)
  authenticityReviews DocumentAuthenticityReview[]

  @@index([companyId, slipRefKey])
}

/// Receipt-authenticity spec §6.4: one row per reviewed (target, file, code, facts). Insert-only;
/// a signal is "reviewed" on a target only while a row with its CURRENT factsHash exists.
model DocumentAuthenticityReview {
  id               String           @id @default(cuid())
  companyId        String
  attachmentId     String
  targetType       String           @db.VarChar(40)   // 'expense.record' | 'reimbursement.request'
  targetId         String
  code             String           @db.VarChar(40)   // AuthenticitySignalCode
  factsHash        String           @db.VarChar(64)   // sha256 hex, §6.4
  sourceRevision   String           @db.VarChar(40)   // target updatedAt the reviewer saw (ISO)
  note             String           @db.VarChar(300)
  reviewedByUserId String
  reviewedAt       DateTime         @default(now())
  company          Company          @relation(fields: [companyId], references: [id], onDelete: Cascade)
  attachment       AttachmentObject @relation(fields: [companyId, attachmentId], references: [companyId, id], onDelete: Cascade)

  @@unique([companyId, targetType, targetId, attachmentId, code, factsHash])
  @@index([companyId, targetType, targetId])
}
```

สาม migration additive: `fileSignalsJson` (Phase 1), ตาราง `DocumentAuthenticityReview` (Phase 2a), `slipRefKey` + index (Phase 4)

เหตุผล: ไม่ใช้ `metadataJson` (ผู้เรียกตั้งค่าได้); review แยกตารางเพราะต้องผูกรายการ+ข้อเท็จจริง (F2) และ insert แบบ `skipDuplicates` ทำให้กดพร้อมกันไม่ชน; การบันทึกไม่แตะ `updatedAt` ของรายจ่าย/ใบเบิก จึงไม่ทำให้ preview token ของ LINE หมดอายุ

### 6.2 `fileSignalsJson` (v1)

```ts
type AttachmentFileSignalsV1 = {
  v: 1;
  checkedAt: string;
  /** What the stored bytes carry. Booleans only — telemetry; never shown as "authentic". */
  present: { exif: boolean; xmp: boolean; iptc: boolean; c2pa: boolean; pngText: boolean; pdfInfo: boolean };
  /** A structured declaration of generative-AI creation/editing (C2PA or IPTC only). */
  aiDeclared?: { source: 'C2PA' | 'IPTC_XMP'; marker: 'c2pa.ai-disclosure' | 'trainedAlgorithmicMedia' | 'compositeWithTrainedAlgorithmicMedia' | 'compositeSynthetic' };
  /** A program named in a structured software field. */
  tool?: { field: 'EXIF_SOFTWARE' | 'EXIF_PROCESSING_SOFTWARE' | 'XMP_CREATOR_TOOL' | 'XMP_SOFTWARE_AGENT' | 'PNG_SOFTWARE' | 'PNG_GENERATOR_KEYS' | 'PDF_PRODUCER' | 'PDF_CREATOR';
           kind: 'AI_TOOL' | 'EDITOR'; name: string };                  // canonical name from TOOL_CATALOGUE
  c2paUnsupported?: 'COMPRESSED_TOO_LARGE' | 'MALFORMED';             // disclosed, never a signal
  slipQr?: { format: 'BANK'; sendingBank: string; transRef: string; crcValid: boolean }
         | { format: 'TRUEMONEY' } | { format: 'NONE' } | { format: 'NOT_RUN'; reason: 'TIMEOUT' | 'NOT_IMAGE' };  // Phase 4
  error?: 'UNREADABLE';
};
```

กติกาการอ่าน (`readAttachmentFileSignals(bytes, mimeType)` ฟังก์ชันบริสุทธิ์ ไม่มี dependency ใหม่ใน Phase 1):

- **C2PA (รีวิว F8, F9, R2-F1):** JPEG — เดิน marker จนถึง SOS, รวม APP11 (`0xFFEB`) ที่เป็น JUMBF ของ C2PA ตามลำดับ box instance/sequence ให้เป็น manifest store เดียว; PNG — chunk `caBX`; กล่อง `brob` คลายด้วย `zlib.brotliDecompressSync` ของ Node (มีในตัว) จำกัด `maxOutputLength` 2 MB; แล้ว **parse โครง JUMBF จริง** (superbox `jumb` + description box `jumd` ที่มี label) → manifest store → **active manifest (ตัวสุดท้าย)** → assertion store → อ่านเฉพาะ assertion ที่ label เป็น:
  - `c2pa.actions` / `c2pa.actions.v2` (content box `cbor`; รวมทุก instance ที่ label มี `__N` ต่อท้าย) ของ **active manifest เท่านั้น**: decode CBOR แล้วหาค่า **`digitalSourceType` ที่มีผลจริงของแต่ละ action ที่ถูกบันทึกใน `actions[]`** ตาม C2PA 2.4 §18.15.6.1 (R3-F1): template ใช้กับ action ที่ชื่อเดียวกันเท่านั้น ("with actions of the same name"), เริ่มจาก template `"*"` (ถ้ามี) แล้วตามด้วย template ชื่อเดียวกันตามลำดับใน `templates[]` จากนั้น**ทับด้วยค่าของ action เอง** → ค่าของ action ชนะเสมอ; **template ไม่เคยสร้าง action เอง** — template ที่ไม่มี action ชื่อตรงกัน (หรือ `"*"` เมื่อไม่มี action เลย) ไม่มีผล; action ใน manifest ของ ingredient/manifest ก่อนหน้าไม่นับ; ค่าที่มีผลเท่ากับ URI เต็ม `http://cv.iptc.org/newscodes/digitalsourcetype/{trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia|compositeSynthetic}` อย่างน้อยหนึ่ง action → `aiDeclared{source:'C2PA', marker:<ค่านั้น>}`; ตัวอย่าง: `c2pa.created` ที่มีค่าเองเป็น `digitalCapture` + template `"*"` เป็น AI → **ไม่มี** ข้อสังเกต; template AI ของชื่อ `c2pa.edited` แต่ไม่มี action `c2pa.edited` → **ไม่มี**; action `c2pa.edited` ไม่มีค่าเอง + template `"*"` เป็น `compositeWithTrainedAlgorithmicMedia` → **มี**
  - **related actions (R4-F4, C2PA 2.4 §18.15.8):** action แบบ v2 มี `related[]` = action เพิ่มเติมที่เกี่ยวข้อง แต่ละตัวเป็น "subset of the primary action, only including those fields that differ" → ค่าที่มีผลของ related = ค่าที่มีผลของ action แม่ (หลัง template) แล้ว**ทับด้วยค่าของ related เอง**; อ่านแบบเรียกซ้ำมีขอบเขต (ลึก ≤ 4, รวม related ≤ 256 ต่อ assertion เกิน → `c2paUnsupported: 'MALFORMED'`); related ตัวใดมีค่าที่มีผลเป็น URI AI → `aiDeclared`; related ที่ตั้ง `digitalCapture` เองไม่ลบ AI ของแม่ และกลับกัน (แต่ละ action นับแยก); รอบนี้**ไม่**ใช้ template ชื่อของ related กับ related (สเปกไม่ระบุตรง — MC12)
  - `c2pa.ai-disclosure`: decode CBOR ได้เป็น map ที่มี `modelType` → `aiDeclared{source:'C2PA', marker:'c2pa.ai-disclosure'}` (assertion นี้บอกได้แต่ว่าใช้ AI §5.2)
  - **ไม่อ่าน** assertion อื่น รวม `c2pa.metadata`, custom/metadata assertion, ingredient และ claim — ข้อความใด ๆ ที่อ้าง URI ใน caption/คำบรรยายจึงไม่เกิดข้อสังเกต (negative fixture §14.1)
  - CBOR decoder ขนาดเล็กในโค้ด ไม่เพิ่ม dependency — decode ครบ major type 0–7 ได้แก่ int ทั้งบวกลบ, bytes, text, array, map, tag (เช่น `#6.37` ของ `buuid`, `tdate`), และ simple/float: `false`/`true`/`null`/`undefined`, half/single/double float (R3-F6 — CDDL ของ actions ใช้ `bool` เช่น `multipleInstances`/`allActionsIncluded`, ใช้ `float` เช่นช่วงฟอนต์ §18.15.12); ค่าที่ไม่ต้องใช้ข้ามได้แต่ต้อง decode ขนาดได้ถูก; ขอบเขต ลึก ≤ 16, รายการ ≤ 4,096, ขนาด ≤ 2 MB; indefinite-length → ยืนยันใน §18 MC9; โครงเสีย/เกินขอบเขต → `c2paUnsupported: 'MALFORMED' | 'COMPRESSED_TOO_LARGE'` (ไม่เป็นข้อสังเกต)
  - **ไม่ตรวจลายเซ็น/ความถูกต้องของ manifest** และ UI ไม่อ้างว่า "ยืนยันแล้ว"; ไม่รองรับ (ระบุชัด): manifest ภายนอก/remote, sidecar `.c2pa`, ใน PDF, manifest บีบอัดเกินขนาด
- **XMP (R2-F1):** parse เป็น XML (ไม่ใช่ค้นสตริงทั้งก้อน) อ่านค่า property `Iptc4xmpExt:DigitalSourceType` ทั้งรูปแบบ attribute, element และ `rdf:resource` ต้อง**เท่ากับ** URI เต็มสามค่า → `aiDeclared{source:'IPTC_XMP'}`; `xmp:CreatorTool`, `stEvt:softwareAgent` → `tool`; ไม่อ่าน `dc:description`/`dc:title` หรือข้อความอิสระอื่น (caption ที่อ้าง URI → ไม่เกิดข้อสังเกต)
- **EXIF (รีวิว F7):** parser TIFF ขนาดเล็กแบบ bounds-checked (byte order, IFD0 ≤ 512 entries, type ASCII) อ่านเฉพาะ `Software` (0x0131) และ `ProcessingSoftware` (0x000B) → เทียบ `TOOL_CATALOGUE`; **ไม่สแกนบัฟเฟอร์ดิบหาคำ**
- **PNG text (รีวิว F10, R2-F11, R2-F13):** keyword `Software` → เทียบ catalogue; ชื่อ keyword อย่างเดียว**ไม่ระบุโปรแกรม** — ต้องตรงโครงของเนื้อหา: `parameters` ระบุ "Stable Diffusion WebUI" เฉพาะเมื่อข้อความมีบรรทัดที่มีครบ `Steps:`, `Sampler:`, `CFG scale:`, `Seed:` (รูปแบบของ WebUI — ยืนยันกับซอร์สใน §18); `prompt` + `workflow` ระบุ "ComfyUI" เฉพาะเมื่อ `prompt` เป็น JSON object ที่ค่าทุกตัวมี `class_type` และ `workflow` เป็น JSON ที่มี array `nodes` → `tool{field:'PNG_GENERATOR_KEYS', kind:'AI_TOOL'}`; ไม่ตรงโครง (เช่น `parameters="exposure 1/50"`) → ไม่มี tool; ไม่ว่ากรณีใด**ไม่ใช่ `aiDeclared`**; ComfyUI ที่ปิด metadata ไม่มีร่องรอย (ไม่ใช่ความผิดพลาด)
- **PDF (R4-F5):** `PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: false })` **เท่านั้น** — ค่าตั้งต้นของ pdf-lib เขียน Producer/ModDate ใหม่เป็นของ pdf-lib ตอนโหลด (`this.setProducer(pdfLib)` [pdf-lib v1.17.1 PDFDocument.ts](https://raw.githubusercontent.com/Hopding/pdf-lib/v1.17.1/src/api/PDFDocument.ts)) ซึ่งจะทำให้ `getProducer()` คืนค่าของ pdf-lib แทนค่าในไฟล์; แล้วอ่าน `getProducer()`/`getCreator()` → เทียบ catalogue; fixture ที่มีแค่ Producer ของโปรแกรมแก้ PDF ต้องได้ `tool`
- `TOOL_CATALOGUE` (ค่าคงที่เดียว เทียบคำ/prefix ไม่สนตัวพิมพ์): `EDITOR` — Adobe Photoshop, Photoshop Express, Lightroom, GIMP, Canva, Picsart, Snapseed, Pixlr, Photopea, Affinity Photo, Meitu, Fotor, paint.net, PDFescape, Sejda, Smallpdf, iLovePDF, PDF-XChange Editor, Foxit PDF Editor/PhantomPDF, Nitro Pro, PDFelement; `AI_TOOL` — DALL·E/DALL-E, ChatGPT, Midjourney, Adobe Firefly, Stable Diffusion, NovelAI, Imagen, Gemini, Ideogram, Leonardo, ComfyUI; **ไม่รวม** แอปสแกน (CamScanner, Adobe Scan, Microsoft Lens, Genius Scan, Google Drive) และตัวพิมพ์ PDF ทั่วไป (Microsoft Word, Print to PDF, Chrome/Skia, wkhtmltopdf, iText, LibreOffice)
- เก็บแค่ชื่อ canonical ไม่เก็บสตริงดิบ/GPS/ซีเรียล
- **เวลา (รีวิว F17):** parser Phase 1 ทำงาน synchronous จำกัดด้วยขนาดอินพุต (≤ 10 MB, เดิน segment/chunk เชิงเส้น, คลาย Brotli ≤ 2 MB) — **ตัดกลางไม่ได้ เป็น best-effort** และต้องวัด event-loop delay (`perf_hooks.monitorEventLoopDelay`); Phase 4 อ่าน QR ใน `worker_threads` (มีใน Node) ส่งภาพ RGBA ที่ย่อด้านยาว ≤ 1,200 px แล้ว `worker.terminate()` เมื่อเกิน 1,000 ms → `slipQr{format:'NOT_RUN', reason:'TIMEOUT'}`
- **Phase 4 QR:** ภาพเท่านั้น → `jsQR` (dependency ใหม่ตัวเดียว Apache-2.0 [licenses.dev](https://licenses.dev/npm/jsqr/1.4.0)) → TLV root `00` sub `00` = `000001` → `BANK` (`sendingBank`, `transRef`, CRC-16/CCITT-FALSE; ยอมรับ CRC ที่ขาดเลข 0 นำหน้า 1-3 ตัว); TrueMoney → `TRUEMONEY`; ไม่พบ → `NONE`; `BANK && crcValid` → `slipRefKey = sendingBank + ':' + transRef` **ตรงตามไบต์ ไม่แปลงตัวพิมพ์** (R4-F3 — ตัวอย่างใน SCB API reference เป็นตัวพิมพ์ผสม เช่น `201904227kAylzNUdnJ1z0w` และไม่มีเอกสารว่าตัวพิมพ์เล็ก/ใหญ่เทียบเท่ากัน — **ยังยืนยันไม่ได้** จึงไม่ fold; ถ้า fixture ของธนาคารใดพิสูจน์ได้ว่าเทียบเท่า ค่อยเพิ่มกติการายธนาคาร (MC5))

### 6.3 ตารางข้อสังเกต (derived — แหล่งคำเดียว `packages/contracts/src/receipt-authenticity.ts`)

| กลุ่ม | code | ระดับ | เกิดเมื่อ | ไฟล์ที่ใช้ | ค่าใน factsHash |
|---|---|---|---|---|---|
| A | `FILE_SAYS_AI` | STRONG | `fileSignalsJson.aiDeclared` | ทุกไฟล์ที่นับ | checksum, source, marker |
| A | `FILE_NAMES_TOOL` | MEDIUM ถ้า `AI_TOOL`; WEAK ถ้า `EDITOR` | `fileSignalsJson.tool` และไม่มี `aiDeclared` | ทุกไฟล์ที่นับ | checksum, field, name |
| C | `FIGURES_DONT_ADD_UP` | MEDIUM | `chargeReconciliation.status === 'ITEMS_DID_NOT_RECONCILE'` และ `itemsSumAmount` ≠ `grandTotalAmount` ปัจจุบัน (2 ตำแหน่ง) | ไฟล์ที่ถูกอ่าน | checksum, itemsSum, total |
| C | `SELLER_TAX_ID_INVALID` | MEDIUM | ตัวเลข `vendorTaxIdSnapshot` ยาว 13 และ checksum ไม่ผ่าน | ไฟล์ที่ถูกอ่าน | checksum, taxId |
| D (P4) | `SLIP_QR_INVALID` | STRONG | `slipQr.format === 'BANK' && !crcValid` — **ไม่พึ่ง OCR** (รีวิว F12) | ทุกไฟล์ที่นับ (รวมแนบตรงในใบเบิกและสลิปหลักฐานจ่าย) | checksum |
| D (P4) | `SLIP_REF_MISMATCH` | STRONG | ใช้**ผล OCR ที่ผูกกับไฟล์** ไม่ใช่ช่องที่แก้ได้ (R3-F5): `aiVerificationSummaryJson.classification.documentKind === 'TRANSFER_SLIP'` และ `recognizedFields.documentNumber` ของการอ่านไฟล์นั้น (ไม่ stale), `slipQr` BANK+crcValid, ธนาคาร ∈ `SLIP_PRINTED_REF_IS_QR_REF_BANKS` และค่าต่างกันหลังตัด**ช่องว่างและ zero-width เท่านั้น** (ตรงกับที่ prompt OCR ให้ตัดอยู่แล้ว [line-ai-internal.controller.ts:1270](../../apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts)) — ไม่ fold ตัวพิมพ์ ไม่ตัดเครื่องหมาย (R4-F3) เว้นแต่ fixture ของธนาคารนั้นยืนยันกติกาอื่น (MC5); ผู้ใช้แก้ `vendorDocumentNumber` หรือ `sourceDocumentType` ทีหลังไม่ทำให้เกิดหรือหาย | ไฟล์ที่ถูกอ่าน**เท่านั้น** | checksum, printedRef (จาก OCR), qrRef |
| D (P4) | `SLIP_REF_REUSED` | STRONG | ไฟล์อื่นที่ `ACTIVE`, `slipRefKey` เดียวกันตรงตามไบต์ แต่ `checksumSha256` ต่าง และเป็นหลักฐานของรายจ่ายหรือใบเบิกใดก็ได้ในบริษัท — ทั้ง**ในรายการเดียวกัน** (รีวิว F13) และรายการอื่น (**ไม่ขึ้นกับสถานะปิดของรายการอีกฝั่ง** เพื่อลดสิ่งที่ต้องล็อก R4-F2; สลิปที่ใช้ในใบที่ถูกปฏิเสธแล้วยังเป็นข้อเท็จจริงที่ควรเห็น) | ทุกไฟล์ที่นับ — **ไม่พึ่ง OCR** | checksum, slipRefKey, id ไฟล์อีกฝั่ง (เรียง) |

- `SLIP_PRINTED_REF_IS_QR_REF_BANKS` เริ่มว่าง เติมทีละธนาคารเมื่อ fixture จริงยืนยัน (plan Phase 0.1) — กติกาโดเมน ไม่ใช่สวิตช์
- รหัสในอนาคต: `SELLER_NOT_VAT_REGISTERED` (แผน RD)

### 6.4 การตรวจแล้วและ factsHash (รีวิว F2, F3)

- `factsHash = sha256(code + '\n' + ค่าในคอลัมน์ขวาสุดของ §6.3 คั่นด้วย '\n')` — normalize ทุกค่า (เงิน 2 ตำแหน่ง, เลขผู้เสียภาษีตัวเลขล้วน, ref ตัวพิมพ์ใหญ่)
- ข้อสังเกต S ของไฟล์ F บนรายการ T "ตรวจแล้ว" ⇔ มีแถว `(T, F, S.code, S.factsHash)`
- ตัวอย่าง: เลขผู้เสียภาษี A ผิดหลัก บันทึกตรวจแล้ว → แก้เป็น B ที่ก็ผิดหลัก → factsHash ใหม่ → **ค้างใหม่** (แถวเก่าเป็นประวัติ); เปลี่ยนไฟล์ → ค้างใหม่; ไฟล์เดียวกันในรายจ่ายอีกรายการ → คนละ target ไม่ถูกปิดตาม
- `sourceRevision` = `updatedAt` ของรายการที่ผู้ตรวจเห็น ใช้เป็น CAS ตอนเขียนและเก็บไว้ตรวจย้อนหลัง

## 7. Contracts / API

### 7.1 Types (`packages/contracts/src/receipt-authenticity.ts`, export จาก index — ห้ามแตะ `line-ai.ts` ที่อยู่ใน W00 hash)

```ts
export const AUTHENTICITY_SIGNAL_CODES = ['FILE_SAYS_AI', 'FILE_NAMES_TOOL', 'FIGURES_DONT_ADD_UP',
  'SELLER_TAX_ID_INVALID', 'SLIP_QR_INVALID', 'SLIP_REF_MISMATCH', 'SLIP_REF_REUSED'] as const;
export type AuthenticitySignalCode = (typeof AUTHENTICITY_SIGNAL_CODES)[number];
export type AuthenticitySignalStrength = 'STRONG' | 'MEDIUM' | 'WEAK';
export type AuthenticitySignal = {
  code: AuthenticitySignalCode; strength: AuthenticitySignalStrength; factsHash: string;
  toolName?: string; toolKind?: 'AI_TOOL' | 'EDITOR'; itemsSumAmount?: string; totalAmount?: string; taxId?: string;
  printedRef?: string; qrRef?: string;
  other?: { kind: 'expense' | 'claim' | 'same_target'; id?: string; canOpen: boolean };
};
export type DocumentAuthenticityView = {
  attachmentId: string; fileName: string; lineNo?: number;
  open: AuthenticitySignal[];                         // not reviewed with the current factsHash
  reviewed: Array<{ codes: AuthenticitySignalCode[]; note: string; byName: string; at: string; byUploader: boolean }>; // rows whose factsHash is current
};
export type AuthenticityPanel = {
  revision: string;                                   // target updatedAt (CAS token for the POST)
  canRecordCheck: boolean;
  closed: boolean;                                    // §9 closed-target policy
  documents: DocumentAuthenticityView[];
};
export type RecordAuthenticityReviewInput = {
  attachmentId: string;
  signals: Array<{ code: AuthenticitySignalCode; factsHash: string }>;   // exactly what the card displays
  note: string; expectedRevision: string;
};
export const AUTHENTICITY_WORDS: { … };               // every sentence of §10, one place
export function authenticityOpenCountForLine(panel: AuthenticityPanel): number;  // documents with an open STRONG/MEDIUM signal
```

### 7.2 Read

| Endpoint | เพิ่ม | หมายเหตุ |
|---|---|---|
| `GET /v1/companies/:companyId/expenses/:expenseId` ([expense.controller.ts:302-310](../../apps/api/src/modules/expenses/presentation/http/expense.controller.ts)) | `authenticity?: AuthenticityPanel` | ไม่มี key เมื่อผู้ดูไม่มีอำนาจ (§8); `GetExpenseUseCase.authenticity(ctx, expense)` (LINE CONFIRM ใช้ตัวเดียวกัน) |
| `GET /v1/companies/:companyId/reimbursements/:requestId` (`detailWithFileNames` [reimbursement.mapper.ts:419](../../apps/api/src/modules/reimbursements/application/dto/reimbursement.mapper.ts)) | `authenticity?: AuthenticityPanel` | ระดับบนสุด ห้ามซ้อนใน `lines` (digest การ์ด LINE คำนวณจาก `lines` [line-expense-action.service.ts:349-350](../../apps/api/src/modules/line-ai/application/line-expense-action.service.ts)); ใช้ `approvalActions` ที่ detail คำนวณแล้ว ([reimbursement-request.use-case.ts:409](../../apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.ts)) |

การคำนวณ (อ่านอย่างเดียว): รายจ่ายใช้รายการไฟล์จาก `loadExpenseEvidenceSources`, ใบเบิกใช้ snapshot ที่ปักของแต่ละบรรทัด (§5.5); หนึ่ง query โหลดข้อเท็จจริงไฟล์ (`id, originalFileName, uploadedByUserId, checksumSha256, fileSignalsJson, slipRefKey`) + ความสัมพันธ์ยกเว้น §5.5; หนึ่ง query `DocumentAuthenticityReview` ของ target; Phase 4 หนึ่ง query `slipRefKey in (...)` ทั้งบริษัท **โดยไม่ตัดไฟล์ในชุดแรกออก** แล้วเทียบกันเองในหน่วยความจำ (รีวิว F13); `deriveAuthenticitySignals(...)` (pure) — ไม่มี N+1

### 7.3 Write

```
POST /v1/companies/:companyId/expenses/:expenseId/authenticity-review
  @RequireAnyPermission('expense.review', 'expense.confirm')
POST /v1/companies/:companyId/reimbursements/:requestId/authenticity-review
  @RequirePermissions('account.session.read')        // authority decided inside, like approve (รีวิว F5)
Body: RecordAuthenticityReviewInput   (DTO: attachmentId cuid; signals 1–7 ไม่ซ้ำ code ∈ AUTHENTICITY_SIGNAL_CODES, factsHash hex 64; note 3–300; expectedRevision ISO)
200: AuthenticityPanel
```

ลำดับ (หนึ่ง transaction — ทำให้การตรวจ เทียบ revision และเขียน เป็นหน่วยเดียวกับการแก้/ปิดรายการ, R2-P2/F3):
0. **ล็อกหลักฐานร่วมก่อน (R3-F3, P2/P31):** `lockFundingEvidence(tx, companyId, { attachmentIds: [attachmentId], expenseIds: [รายจ่าย target หรือรายจ่ายที่บรรทัดใบเบิกผูก] })` — ตัวเดียวกับที่การลบไฟล์ใช้ก่อนเปลี่ยนเป็น `DELETED` ([prisma-attachment.repository.ts:261, 285](../../apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-attachment.repository.ts)) และตามลำดับเดิม "ล็อกหลักฐาน → ล็อกแถว" ของ [link-line-payment-evidence.use-case.ts:136-139](../../apps/api/src/modules/expenses/application/use-cases/link-line-payment-evidence.use-case.ts); การลบแบบ soft delete ไม่แตะแถว target และ cascade ของ FK ไม่ทำงานกับ soft delete จึงต้องกันด้วยล็อกนี้; **ไฟล์อีกฝั่งของ `SLIP_REF_REUSED` (R4-F2):** ก่อนล็อก หา id ไฟล์ทั้งหมดในบริษัทที่ `slipRefKey` เดียวกัน แล้วใส่รวมใน `attachmentIds` ชุดเดียวกัน — `lockFundingEvidence` ขยายกราฟของแต่ละไฟล์ (link → expense, [substitute-funding.guard.ts:11-19](../../apps/api/src/modules/expenses/infrastructure/substitute-funding.guard.ts)) และล็อกตามลำดับที่เรียงแล้ว จึงกันการลบไฟล์อีกฝั่งระหว่าง derive กับ insert ได้; หลังได้ล็อก derive ใหม่ ถ้ามีไฟล์ใหม่ key เดียวกันโผล่มา factsHash จะเปลี่ยน → 422 ตามข้อ 6 (ไม่บันทึกสิ่งที่ไม่ได้แสดง); การเขียน link ที่ไม่ถือ `lockFundingEvidence` ต้องไล่ใน MC11
1. **ล็อกแถว target** ด้วย `SELECT id FROM "ExpenseRecord"|"ReimbursementRequest" WHERE id = … AND "companyId" = … FOR UPDATE` (แบบเดียวกับ [link-line-payment-evidence.use-case.ts:137-139](../../apps/api/src/modules/expenses/application/use-cases/link-line-payment-evidence.use-case.ts)); ใบเบิกที่ใช้ข้อเท็จจริงสดของรายจ่ายที่ผูก (§5.5) ล็อกแถวรายจ่ายเหล่านั้นด้วย เรียง id ตามลำดับล็อกเดิมของระบบ (ยืนยันลำดับใน §18); การแก้และการปิดรายการเป็น UPDATE แถวเดียวกัน จึงรอหรือถูกรอ — **ไม่แตะ `updatedAt`** ของ target
2. อ่าน target ใหม่หลังได้ล็อก ในขอบเขตสาขา; ปิดตาม §9 → 409 `authenticity_target_closed`; **อ่านไฟล์ใหม่ว่ายัง `ACTIVE` และยังนับเป็นหลักฐาน** (หลังล็อกหลักฐาน) ไม่ใช่ → 404 `authenticity_attachment_not_on_target`
3. อำนาจ: รายจ่าย — สิทธิ์ใน decorator; ใบเบิก — `reimbursement.finance_review` หรือ `reimbursement.payment.record` หรือ `approvalDecisionActions(ctx, req, repo)` ให้ `canApprove || canReject` (รวมผู้ได้รับมอบหมายแช่แข็งและผู้อนุมัติตามบทบาท) → ไม่ผ่าน 403 `authenticity_review_not_allowed`
4. `expectedRevision !== target.updatedAt.toISOString()` (อ่านหลังล็อก) → 409 `authenticity_review_conflict`
5. ไฟล์ต้องนับเป็นหลักฐานของ target (§5.5) → ไม่ใช่ 404 `authenticity_attachment_not_on_target`
6. derive ใหม่ภายใต้ล็อก แล้วจัดแต่ละตัวใน `signals` (**ความหมายแบบ idempotent ที่ชัดเจน**, R2-F8): (ก) ค้างอยู่และ factsHash ตรง → เขียนแถว; (ข) ตรวจแล้วบน target นี้ด้วย factsHash เดียวกัน → ถือว่าสำเร็จ ไม่เขียนซ้ำ; (ค) อย่างอื่น (code ไม่เคยค้าง, factsHash ไม่ตรง, ข้อสังเกตหายไป) → 422 `authenticity_signal_not_open` ทั้งคำขอ ไม่บันทึกอะไร (รีวิว F3)
7. ใบเบิก: `looksLikeAccountNumber(note)` → 400 `note_contains_account_number` (แบบ [expense-upload.use-case.ts:624](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts))
8. `createMany({ data: rows(ก), skipDuplicates: true })`, `sourceRevision = expectedRevision`; ถ้า (ก) ว่าง (ทุกตัวเป็น (ข)) ไม่เขียนและไม่ audit ซ้ำ
9. audit `attachment.authenticity.review` (`MEDIUM`, metadata `{ targetType, targetId, attachmentId, signals: [{code, factsHash}], note }`) ใน transaction เดียวกัน

ผลกับคำขอซ้อนกัน: สองคนส่งชุดเดียวกันพร้อมกัน → คนแรกได้ล็อกและเขียน คนที่สองได้ล็อกต่อแล้วพบเป็น (ข) → **สำเร็จทั้งคู่ มีแถวชุดเดียว**; แก้/ปิดรายการระหว่างนั้น → รอล็อก หรือ review ที่มาทีหลังเห็น revision/สถานะใหม่แล้วได้ 409

## 8. สิทธิ์ (ABAC) และขอบเขต tenant

| การกระทำ | รายจ่าย | ใบเบิก |
|---|---|---|
| เห็น `authenticity` | `expense.read` / `expense.review` / `expense.confirm` + สาขาในขอบเขต | `reimbursement.read` / `reimbursement.finance_review` / `reimbursement.payment.record` / อำนาจตัดสินขั้นปัจจุบัน (`approvalActions.canApprove || canReject`) / ผู้ตัดสินขั้นใดขั้นหนึ่งของใบนี้แล้ว (`decisionByUserId`) + สาขาในขอบเขต (รีวิว F5) |
| ไม่มี key | มีแค่ `expense.read_own/read_related/create/receipt.*` | มีแค่ `reimbursement.read_own/read_related` และไม่มีอำนาจตัดสิน |
| บันทึกตรวจแล้ว | `expense.review` / `expense.confirm` | `finance_review` / `payment.record` / `canApprove || canReject` ของขั้นที่รออยู่ |
| `other.id` ของ `SLIP_REF_REUSED` | เฉพาะเมื่อผู้ดูเปิดรายการอีกฝั่งได้ (`evidence.canReadExpense` / `assertCanReadRequestOrAssignment` [reimbursement.mapper.ts:469-480](../../apps/api/src/modules/reimbursements/application/dto/reimbursement.mapper.ts)); `same_target` เปิดได้เสมอ | เหมือนกัน |
| AI tools | ไม่ map `authenticity` ใน read tool ใด | เหมือนกัน |
| บริษัทอื่น | ทุก query มี `companyId`; `slipRefKey` ค้นในบริษัทเดียว | เหมือนกัน |

ผู้ส่งที่ถืออำนาจตัดสินใจเอง เห็นและบันทึกได้ ประวัติแสดง `byUploader` — การบันทึกไม่ปลดล็อกอะไร จึงไม่มีช่องโหว่ dual control

## 9. State transitions

ต่อ (target, ไฟล์, code):

```
ไม่มี ──(ข้อเท็จจริงเข้าเงื่อนไข §6.3)──▶ ค้าง (factsHash = h)
ค้าง(h) ──(ผู้มีอำนาจบันทึก (code, h) ที่แสดงอยู่)──▶ ตรวจแล้ว(h)
ตรวจแล้ว(h) ──(ข้อเท็จจริงเปลี่ยน → h′)──▶ ค้าง(h′)   [แถว h เป็นประวัติ]
ค้าง/ตรวจแล้ว ──(ข้อเท็จจริงไม่เข้าเงื่อนไขแล้ว)──▶ ไม่มี
ตรวจแล้ว(h) ──(ข้อเท็จจริงกลับมาเป็น h)──▶ ตรวจแล้ว(h)
```

**นโยบายรายการปิด (เดียวกันทั้ง API และ UI — รีวิว F21):** รายจ่าย `REJECTED`, `VOIDED`; ใบเบิก `REJECTED`, `CANCELLED`, `VOIDED` → การ์ดอ่านอย่างเดียว (`closed: true`, ไม่มีปุ่ม), POST ตอบ 409 `authenticity_target_closed`; สถานะอื่นทั้งหมด (รวมหลังอนุมัติ/จ่ายแล้ว) บันทึกได้ — ข้อสังเกตไม่เปลี่ยนสถานะ target ใด ๆ

## 10. UI และถ้อยคำ (ไทย)

### 10.1 หน้าใบเบิก (`ReimbursementJourneyPage.tsx`)

- **การ์ดขั้นตอน** (อนุมัติ / ตรวจการเงิน / จ่าย) เมื่อมีไฟล์ที่มี STRONG/MEDIUM ค้าง: บรรทัดเดียวเหนือปุ่ม **"มีเอกสาร {n} ใบควรเทียบกับใบจริงก่อน{อนุมัติ|จ่าย}"** + ลิงก์ "ดูข้อสังเกต" — ไม่เปลี่ยนปุ่ม
- **การ์ด "ข้อสังเกตเอกสาร"** ในคอลัมน์เนื้อหา ถัด `ClaimSummaryCard` ก่อน "เอกสารที่อาจซ้ำ": หัว **ข้อสังเกตเอกสาร**, บรรทัดรอง **ไม่ได้แปลว่าเอกสารผิด**, ต่อไฟล์ "รายการที่ {lineNo} · {fileName}" + ปุ่ม "ดูไฟล์" (ตัวเปิดไฟล์เดิม) + ข้อสังเกตค้าง (ป้ายตัวหนา + คำแนะนำหนึ่งบรรทัด) + ปุ่ม **"ตรวจแล้ว"** เมื่อ `canRecordCheck && !closed`; ประวัติ "{ชื่อ}{ (ผู้ส่งเอกสาร)} ตรวจแล้ว {วันเวลา} · {note}"
- 390 px: เต็มกว้าง ปุ่มซ้อนเต็มแถวขนาดเท่ากัน **"ตรวจแล้ว" อยู่บน "ดูไฟล์" อยู่ล่าง**; 1280 px และ ~1,556 px: อยู่ในคอลัมน์เนื้อหาเดิม ยืดเต็มคอลัมน์ ปุ่มสองตัวชิดขวาใน `ActionGroup` เดียว ขนาดเท่ากัน **"ดูไฟล์" ก่อน "ตรวจแล้ว" ขวาสุด** (กติกาลำดับปุ่ม [thai-ux-standard.md:67](../guidelines/thai-ux-standard.md), R4-F7)

### 10.2 หน้ารายจ่าย (`ExpenseReviewPage.tsx`) (รีวิว F6)

- การ์ดเดียวกัน (component เดียว) ปรากฏใน**ทุกเลย์เอาต์ของหน้า**: ถัด `duplicatesCard` ในขั้น "review" แบบ guided และหน้าอ่านอย่างเดียว ([ExpenseReviewPage.tsx:2237-2238, 2256](../../apps/web/src/features/expenses/ExpenseReviewPage.tsx)) **และ**ในเลย์เอาต์ source-only ซึ่งไม่มี `duplicatesCard` (`sourceOnlyDraft` [ExpenseReviewPage.tsx:2195](../../apps/web/src/features/expenses/ExpenseReviewPage.tsx), เงื่อนไข [expenses.model.ts:1516](../../apps/web/src/features/expenses/expenses.model.ts)) — วางใต้ตัวแก้ร่างจากต้นทาง เช่นผู้ถือ `expense.read` อย่างเดียวเปิดร่าง LINE สถานะ READY_FOR_CONFIRMATION ที่ยังไม่ครบ (R2-F9)
- **แสดงข้อสังเกตค้างทุกกลุ่ม** ข้อเท็จจริงอยู่ในการ์ดเอง ปุ่ม "ตรวจแล้ว" ส่งเฉพาะข้อสังเกตที่การ์ดแสดง
- กันพูดซ้ำในขั้นเดียวกัน: เมื่อการ์ดแสดง `SELLER_TAX_ID_INVALID` แถวเตือนเลขผู้เสียภาษีของ `deriveExpenseAuditChecks` ([expenses.model.ts:1380-1391](../../apps/web/src/features/expenses/expenses.model.ts)) ไม่แสดง (ผู้ดูที่ไม่มี `authenticity` ยังเห็นแถวเดิม); ป้ายตัวเลขไม่ลงตัวในขั้น "ข้อมูล" คงไว้เพราะอยู่คนละขั้นและช่วยตอนแก้ข้อมูล (ทำให้ถ้อยคำถูกด้วย Phase D-B3)
- ≥ lg: คอลัมน์ขวาของ grid ที่มีตัวดูเอกสารซ้าย ([ExpenseReviewPage.tsx:2104](../../apps/web/src/features/expenses/ExpenseReviewPage.tsx)) ยืดเต็มคอลัมน์

### 10.3 Dialog "ตรวจแล้ว"

- หัว **บันทึกว่าตรวจแล้ว**; ช่อง "ตรวจอย่างไร" (บังคับ 3–300) placeholder "เช่น ดูใบจริงแล้ว ยอดตรงกัน"; ปุ่มล่างขนาดเท่ากัน ตามกติกาลำดับปุ่ม ([thai-ux-standard.md:67](../guidelines/thai-ux-standard.md), R4-F7): บนแถวกว้าง **ยกเลิก** ก่อน **บันทึก** (ขวาสุด); บนมือถือซ้อนกัน **บันทึก** อยู่บน **ยกเลิก** อยู่ล่าง; สำเร็จ toast **"บันทึกแล้ว"**
- ปฏิเสธ (มีทางออกทุกข้อ):
  - 409 `authenticity_review_conflict` / 422 `authenticity_signal_not_open` → **"เอกสารนี้เปลี่ยนไปแล้ว โหลดใหม่แล้วลองอีกครั้ง"** + ปุ่ม "โหลดใหม่"
  - 404 `authenticity_attachment_not_on_target` (ไฟล์ถูกลบหรือไม่อยู่ในรายการนี้แล้ว, R4-F6) → **"ไฟล์นี้ไม่อยู่ในรายการนี้แล้ว โหลดใหม่เพื่อดูไฟล์ล่าสุด"** + ปุ่ม "โหลดใหม่"
  - ทุกคำปฏิเสธที่มีปุ่ม "โหลดใหม่": **ข้อความใน "ตรวจอย่างไร" ถูกเก็บไว้** (state ฝั่งหน้าเว็บ ผูกกับรายการ+ไฟล์) แล้วเติมกลับเมื่อเปิด dialog ของไฟล์เดิมหลังโหลด; ถ้าไฟล์ไม่อยู่แล้ว ข้อความถูกทิ้งพร้อมการ์ดของไฟล์นั้น
  - 403 `authenticity_review_not_allowed` → ใบเบิก **"ให้ผู้อนุมัติของใบนี้หรือฝ่ายการเงินเป็นผู้บันทึก"**; รายจ่าย **"ให้ผู้ตรวจรายจ่ายเป็นผู้บันทึก"**
  - 409 `authenticity_target_closed` → **"รายการนี้ปิดแล้ว ไม่ต้องบันทึกการตรวจ"** + ปิด dialog
  - 400 `note_contains_account_number` → **"อย่าใส่เลขบัญชีในหมายเหตุ"**

### 10.4 ถ้อยคำของข้อสังเกต (`AUTHENTICITY_WORDS`)

| code | ป้าย | คำแนะนำหนึ่งบรรทัด |
|---|---|---|
| `FILE_SAYS_AI` | ข้อมูลในไฟล์ระบุว่าสร้างหรือแก้ด้วย AI | ขอดูใบจริง หรือขอไฟล์จากผู้ขายโดยตรง |
| `FILE_NAMES_TOOL` (AI_TOOL) | ข้อมูลในไฟล์ระบุโปรแกรม {toolName} | โปรแกรมนี้สร้างหรือแก้ภาพได้ ขอดูใบจริง |
| `FILE_NAMES_TOOL` (EDITOR) | ข้อมูลในไฟล์ระบุโปรแกรม {toolName} | อาจแค่ครอปหรือปรับแสง ถ้าสงสัยให้ขอดูใบจริง |
| `FIGURES_DONT_ADD_UP` | รายการที่อ่านได้รวม {itemsSum} แต่ยอดรวมที่บันทึก {total} | เทียบตัวเลขกับใบจริง |
| `SELLER_TAX_ID_INVALID` | เลขผู้เสียภาษีผู้ขายที่บันทึก {taxId} ไม่ผ่านการตรวจเลขท้าย | เทียบกับใบจริง |
| `SLIP_QR_INVALID` | QR บนสลิปมีข้อมูลไม่ครบหรือผิดรูปแบบ | ลองสแกน QR ด้วยแอปธนาคารของคุณ |
| `SLIP_REF_MISMATCH` | เลขอ้างอิงที่อ่านได้บนสลิป ({printedRef}) ไม่ตรงกับ QR ({qrRef}) | ลองสแกน QR ด้วยแอปธนาคารของคุณ |

(R3-F5) "ที่อ่านได้" ใช้เฉพาะค่าที่มาจากผล OCR ของไฟล์นั้น; ค่าที่ผู้ใช้กรอก/แก้ใช้คำว่า "ที่บันทึก"
| `SLIP_REF_REUSED` | สลิปนี้มีเลขรายการเดียวกับสลิปอีกใบ{ในรายการนี้|ในบริษัท} | `canOpen` → ลิงก์ "เปิดสลิปอีกใบ"; ไม่ได้ → "สลิปอีกใบอยู่ในรายการที่คุณเปิดไม่ได้" |

### 10.5 LINE (การ์ด System OA `buildExpenseActionCard`)

- preview `REIMBURSEMENT_APPROVE` และ `CONFIRM`: `n = authenticityOpenCountForLine(panel)` > 0 → การ์ดมีบรรทัดเพิ่มหนึ่งบรรทัด (มาจาก `authenticityNotice` ไม่ใช่ `details`) **"มีเอกสาร {n} ใบควรเทียบกับใบจริงก่อน{อนุมัติ|ยืนยัน}ค่ะ"** (en: "{n} document(s) should be checked against the original before {approving|confirming}.") + ปุ่ม URI **"ดูเอกสาร"**
- CONFIRM ที่มี `documentImageUrl` อยู่แล้ว ([line-expense-action.service.ts:578-581](../../apps/api/src/modules/line-ai/application/line-expense-action.service.ts)) → บรรทัดอย่างเดียว ไม่เพิ่มปุ่มที่สอง
- ปุ่มขนาดเท่ากัน (buttons ของ `drawLineSystemCard`), ไม่มีรายการเลขข้อความ, persona ค่ะ; ผู้ส่งไม่ได้ข้อความใหม่
- **ไม่ให้ถึงโมเดล (R2-F2):** preview ที่ `ExpenseActionPreviewTool` คืนเป็น `data: result` ([line-expense-action.service.ts:1089-1096](../../apps/api/src/modules/line-ai/application/line-expense-action.service.ts)) ถูกส่งเข้าตัวเขียนคำตอบใน `toolResults` ([semantic-turn-v2.ts:1151](../../apps/ai-gateway/src/modules/line-ai/agents/semantic-turn-v2.ts)) → ข้อความนี้**ห้ามอยู่ใน `details`/`summary`/`reply` ของ preview ที่คืนจาก tool**: เก็บเป็น field แยก `authenticityNotice: { count, action }` ใน `StoredAction` (รวมในลายเซ็นของ entry) และให้ตัวสร้างการ์ดฝั่ง API ใส่บรรทัดและปุ่มจาก entry ที่เก็บไว้ตอนส่งการ์ด; tool result ที่ส่งออกตัด field นี้ทิ้ง (ทางที่การ์ดได้ preview มายืนยันใน §18); test คำขอผสม "อนุมัติ + ถามยอด" ว่า input ของตัวเขียนคำตอบไม่มีข้อความนี้

### 10.6 ตาราง surface × case

| ประโยค | กรณี | จริงไหม | เหตุ |
|---|---|---|---|
| "ไม่ได้แปลว่าเอกสารผิด" | เอกสารจริง / ปลอม / ตรวจแล้ว | จริงทุกกรณี | ข้อสังเกตไม่ใช่ข้อพิสูจน์ |
| `FILE_SAYS_AI` | C2PA `c2pa.ai-disclosure` / C2PA digitalSourceType generated / inpainting / IPTC XMP / รูปจริงที่มือถือใช้ AI ปรับแล้วประกาศ composite | จริงทุกกรณี | อ้างเฉพาะคำประกาศเชิงโครงสร้าง; "สร้างหรือแก้" ครอบทั้งสอง |
| `FILE_SAYS_AI` | EXIF ImageDescription="ChatGPT subscription receipt" | **ไม่แสดง** | ไม่อ่านข้อความอิสระ (F7) |
| `FILE_SAYS_AI` | C2PA custom metadata assertion หรือ XMP `dc:description` ที่ยกข้อความ URI `…/trainedAlgorithmicMedia` | **ไม่แสดง** | อ่านเฉพาะ property `digitalSourceType` ของ actions และ assertion `c2pa.ai-disclosure` (R2-F1) |
| `FILE_NAMES_TOOL` | PNG `parameters="exposure 1/50"` / ComfyUI ที่ปิด metadata | **ไม่แสดง** ทั้งสอง | ต้องตรงโครงเนื้อหา; ไม่มีร่องรอยก็ไม่มีข้อสังเกต (R2-F11, F13) |
| กลุ่ม C | เปลี่ยนไฟล์หลักแล้วค่าเก่ายังอยู่ (`sourceStale`) | **ไม่แสดง** จนอ่านใหม่ | ไม่โยงค่าจากไฟล์เก่าไปไฟล์ใหม่ (R2-F6) |
| ทุกข้อในใบเบิก | รายจ่ายที่ผูกถูกเพิ่มไฟล์หลังปัก snapshot | ไฟล์ใหม่**ไม่แสดง** | ใช้ชุดที่ปัก (R2-F4) |
| `FILE_NAMES_TOOL` (AI_TOOL) | Software=Gemini / PNG keys ComfyUI ที่แค่ย่อรูป | จริง | อ้างแค่ชื่อโปรแกรม; คำแนะนำบอกว่า "สร้างหรือแก้ภาพ**ได้**" ไม่อ้างว่าทำแล้ว (F10) |
| `FILE_NAMES_TOOL` (EDITOR) | Photoshop แก้ยอด / Snapseed ครอป / Sejda รวมหน้า | จริงทุกกรณี | ไม่อ้างว่าแก้เนื้อหา |
| `FIGURES_DONT_ADD_UP` | OCR อ่านแถวผิด / เอกสารคำนวณผิด / ผู้ตรวจแก้ยอดให้ตรงแล้ว | สองกรณีแรกจริง; กรณีสามไม่แสดง | "ที่อ่านได้" + เงื่อนไข ≠ ยอดปัจจุบัน |
| `SELLER_TAX_ID_INVALID` | ใบพิมพ์ผิด / OCR ผิด / ผู้ใช้กรอกผิด / ใบปลอม | จริงทุกกรณี | พูดถึงเลขที่บันทึก |
| `SLIP_QR_INVALID` | QR สร้างผิด / แอปธนาคารตัดเลข 0 ใน CRC | กรณีสองไม่แสดง | ยอมรับ CRC ขาด 0 |
| `SLIP_REF_MISMATCH` | OCR อ่านผิด / เลขบนภาพสลิปถูกแก้ / ธนาคารพิมพ์เลขอื่น / ผู้ใช้แก้เลขที่บันทึกทีหลัง | สองกรณีแรกจริง; กรณีสามกันด้วยรายชื่อธนาคาร; กรณีสี่ไม่มีผล (เทียบผล OCR ไม่ใช่ช่องที่แก้ได้) | "ที่อ่านได้" = ผล OCR จริง (R3-F5) |
| `SLIP_REF_REUSED` | ภาพสองภาพของสลิปเดียวในใบเบิกเดียว / สลิปถูกแก้แล้วส่งซ้ำอีกใบ / ไฟล์เดียวกันผูกสองรายการ | สองกรณีแรกจริง ("ในรายการนี้"/"ในบริษัท"); กรณีสามไม่แสดง (id/checksum เดียวกัน) | |
| "มีเอกสาร {n} ใบควรเทียบ…ก่อนอนุมัติ" | n ≥ 1 STRONG/MEDIUM ค้าง / ตรวจแล้วทั้งหมด / มีแต่ WEAK / ผู้ดูไม่มีอำนาจ | แสดงเฉพาะกรณีแรก | |
| "{ชื่อ} (ผู้ส่งเอกสาร) ตรวจแล้ว…" | ผู้บันทึกเป็น/ไม่เป็นผู้อัปโหลด | จริงทั้งสอง | วงเล็บเมื่อ `byUploader` |
| "เอกสารนี้เปลี่ยนไปแล้ว โหลดใหม่…" | revision เปลี่ยน / factsHash เปลี่ยน / ข้อสังเกตหายไปแล้ว | จริงทุกกรณี | สิ่งที่แสดงไม่ใช่ปัจจุบันแล้ว |
| "รายการนี้ปิดแล้ว ไม่ต้องบันทึกการตรวจ" | REJECTED / CANCELLED / VOIDED | จริงทุกกรณี | ทั้งสามเป็นสถานะปิด |
| "บันทึกแล้ว" | เขียนสำเร็จ (รวมแถวซ้ำที่ skipDuplicates ข้าม) | จริง | ไม่สัญญาว่าจะไม่กลับมา |
| "ลองสแกน QR ด้วยแอปธนาคารของคุณ" | แอปรองรับ / ไม่รองรับ / สลิปเกิน 90 วัน | จริงทุกกรณี | "ลอง" |

## 11. Impact analysis

| พื้นที่ | ผลกระทบ |
|---|---|
| 11.1 data-model-core | `attachment-file-signals.logic.ts` (ใหม่, pure); `CompleteAttachmentUploadUseCase` เรียกหลัง checksum/pHash ส่งเข้า `markActive` ([prisma-attachment.repository.ts:226](../../apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-attachment.repository.ts)); ไม่แสดงใน DTO attachment; **แก้ B4** (ตรวจผู้อัปโหลด+สาขาตอน complete) และ **B8** (ตรวจสาขาตอนลบ — ส่งแยกได้) และ `resume` คืนว่าไฟล์ ACTIVE แล้วหรือยัง (ใช้แก้ B5) |
| 11.2 expenses | `receipt-authenticity.logic.ts` (ใหม่, pure); `GetExpenseUseCase.authenticity` ใช้ `loadExpenseEvidenceSources`; `RecordExpenseAuthenticityReviewUseCase` ข้าง `ConfirmBuyerMatchUseCase` (ล็อกแถว §7.3); repo อ่าน/เขียน `DocumentAuthenticityReview`; controller GET/POST; **แก้ B7** ให้เส้นทาง PDF เก็บ `chargeReconciliation` + `extractionAttachmentId` ในการเขียนแบบ fenced ([receipt-ocr-apply.service.ts:1295-1302](../../apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts)) |
| 11.3 reimbursements | `detailWithFileNames` เพิ่ม `authenticity` จาก snapshot ที่ปัก (ใช้ `approvalActions` ที่มีอยู่); `RecordClaimAuthenticityReviewUseCase` ตัดสินอำนาจด้วย `approvalDecisionActions` และล็อกแถว; **แก้ B6** ปฏิเสธไฟล์ลายเซ็นเป็นหลักฐานใบเบิกใน `reimbursement-evidence.service.ts` (ข้างการปฏิเสธสลิปที่บรรทัด 37-42) |
| 11.4 contracts | ไฟล์ใหม่ `receipt-authenticity.ts`; `ExpenseDetail`, `ReimbursementRequestDetail` เพิ่ม `authenticity?` |
| 11.5 เว็บ | `DocumentAuthenticityCard.tsx` (ใหม่), `ExpenseReviewPage.tsx`, `ReimbursementJourneyPage.tsx`, `expenses.model.ts` (กันพูดซ้ำแถวเลขผู้เสียภาษี), api clients, `workspace-dictionary.ts` |
| 11.6 LINE | `line-expense-action.service.ts` (preview APPROVE/CONFIRM; `authenticityNotice` เก็บใน `StoredAction` และ**ตัดออกจาก tool result ที่ส่งให้ gateway** §10.5), `line-expense-action-card.logic.ts` (บรรทัด + ปุ่ม "ดูเอกสาร" จาก entry ที่เก็บ); ทุกทางรับไฟล์ได้ file signals ผ่าน completion เดียว; **B5** ต้องแก้ `process-line-webhook.use-case.ts` (ไฟล์ใบเบิกและไฟล์ถามตอบที่ retry หลัง ACTIVE) — อยู่ในขอบเขต (รีวิว F16); **D-P1** เขียน `extractionAttachmentId` ใน summary ของรูปทาง LINE (R4-F1) |
| 11.7 AI / help (รีวิว F18, F23) | read tools ไม่ map `authenticity` (มี test); คำอธิบายทั่วไปสำหรับผู้มีสิทธิ์ตรวจ — ชุดคำตอบที่ใช้อยู่คือ **v6 ที่เจ้าของอนุมัติ** ([approved-product-help.ts:113-115](../../apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts)) การ์ดผูก `sourceFile/sourceHash` ของคู่มือในเว็บ → เพิ่มผ่าน workflow เดิม: เพิ่มเนื้อหาในคู่มือ (`apps/web/src/features/user-guide/…`) → ชุดใหม่สถานะ DRAFT → เจ้าของตรวจในหน้ารีวิว → APPROVED; เป็นขั้นที่**ต้องรอเจ้าของอนุมัติ** ไม่บล็อกงานหลัก; **ตัวเลือกชุดปัจจุบัน fallback ไป v4** เมื่อชุด draft ไม่ใช่ APPROVED (`PRODUCT_HELP_DRAFT_PACK.status === 'APPROVED' ? … : PRODUCT_HELP_PACK` [approved-product-help.ts:128](../../apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts), v4 ที่บรรทัด 38) → ก่อนสร้างชุดใหม่ต้องแช่ v6 เป็นค่าคงที่ APPROVED แยก และให้ fallback ไป v6 พร้อม test source-hash/fallback (R2-F10) |
| 11.8 Export / notification | ไม่เปลี่ยน |
| 11.9 Telemetry | log `attachment.file_signals` `{ channel, mimeType, present, aiDeclared: bool, tool: kind|null, c2paUnsupported, slipQr: format|null, ms }` + event-loop delay p99 ของ parser; ไม่มีค่าดิบ |
| 11.10 Billing / entitlement | ไม่มี feature key ใหม่: `expenses.evidence` + `reimbursement` ใน starter ([menu-entitlements.ts:432-450](../../packages/contracts/src/menu-entitlements.ts)) ที่ 249/499/999/1999 ใช้ร่วม ([menu-entitlements.ts:497-500](../../packages/contracts/src/menu-entitlements.ts)) |
| 11.11 Migration | สามไฟล์ additive (§6.1); ไม่ backfill |
| 11.12 W00 | `line-expense-action.service.ts` และ `process-line-webhook.use-case.ts` อยู่ใน source hashes ([line-ai-capability-manifest.ts:40, 240](../../apps/api/src/modules/line-ai/line-ai-capability-manifest.ts)) → regenerate `docs/research/mangmee-ai-capability-manifest-2026-09-27.json` ด้วย `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1` แล้วรีวิว diff |
| 11.13 Whole-chain | ไม่เพิ่มแถวใน `LINE_AI_WHOLE_CHAIN_SCENARIOS` (`EXPECTED_IDS` ตายตัว [line-ai-whole-chain-acceptance-catalog.spec.mjs:12-37](../../scripts/line-ai-whole-chain-acceptance-catalog.spec.mjs)); เพิ่ม `src/modules/reimbursements/application/use-cases/reimbursement-approval.use-case.spec.ts` เข้า suite `reliability-api-v2`; รัน `node scripts/run-line-ai-whole-chain-acceptance.mjs` |
| 11.14 Browser journeys (รีวิว F22) | ใหม่ `e2e/journeys/receipt-second-look.journey.spec.ts` ที่ **390, 1280 และ 1,556 px** ตามมาตรฐาน ([thai-ux-standard.md:77, 114](../guidelines/thai-ux-standard.md)) รวม dialog; journey เดิมเขียว |
| 11.15 Seed | ไม่แก้ seed; helper fixture ใน `e2e/journeys/journey-kit.ts` |
| 11.16 Dependency | Phase 1–3 ไม่มี (Brotli/worker_threads/zlib อยู่ใน Node); Phase 4 `jsqr` 1.4.0 ใน dependencies เท่านั้น; c2patool ใช้บนเครื่อง dev สร้าง fixture เท่านั้น ไม่เป็น dependency |
| 11.17 ประสิทธิภาพ | parser: เชิงเส้นตามขนาด วัด event-loop delay; QR: worker thread terminate 1,000 ms |

## 12. Gaps

- **G1** LINE ลบ metadata หรือไม่ — telemetry §11.9
- **G2** pHash ชนกันในใบแม่แบบ POS เดียวกันได้แค่ไหน ยังไม่วัด ([expense-duplicate.logic.ts:96-99, 113-123](../../apps/api/src/modules/expenses/domain/logic/expense-duplicate.logic.ts))
- **G3** PDF ที่มี `/EmbeddedFile` ถูกปฏิเสธ ([attachment.logic.ts:217-218](../../apps/api/src/modules/data-model-core/domain/logic/attachment.logic.ts)) → C2PA ใน PDF เข้าไม่ได้ และ e-Tax PDF/A-3 ที่แนบ XML อาจถูกปฏิเสธด้วย (ยังไม่ยืนยัน) — backlog #12
- **G4** ยังไม่มีการตรวจ e-Tax (`NOT_CHECKED`/`UNAVAILABLE`)
- **G5** ตรวจทะเบียน VAT ผู้ขายรอแผน RD
- **G6** VAT ไม่ลงตัวกับฐานยังไม่เป็นข้อสังเกต
- **G7** ลายน้ำล่องหนตรวจจากฝั่งเราไม่ได้ (เราไม่เรียกบริการภายนอก); metadata ลบง่าย → กลุ่ม A เป็นตัวกรองราคาถูก ไม่ใช่ตัวจับหลัก
- **G8** สูตรเลขตรวจเลขนิติบุคคลไม่พบเอกสารต้นฉบับ
- **G9** ธนาคารใดพิมพ์เลข = transRef ยังไม่ยืนยัน (allowlist เริ่มว่าง)
- **G10** ไฟล์แนบตรงในใบเบิกไม่ถูก OCR ([reimbursements.api.ts:161-167](../../apps/web/src/features/reimbursements/reimbursements.api.ts)) → ได้กลุ่ม A, `SLIP_QR_INVALID`, `SLIP_REF_REUSED` แต่ไม่มีกลุ่ม C และ `SLIP_REF_MISMATCH`
- **G11** ไม่มีเครื่องหมายในรายการ/คิว
- **G12** ไม่ตรวจความถูกต้อง/ลายเซ็นของ manifest C2PA และไม่ดึง manifest ภายนอก
- **G13** เว็บแปลงรูปใหญ่/HEIC/GIF ก่อนส่ง (§1.1) — metadata หายบนเว็บสำหรับรูป iPhone ส่วนใหญ่
- **G15** รายจ่ายที่กรอกมือ (ไม่เคยอ่าน), ที่ไฟล์หลักเปลี่ยนแล้วยังไม่อ่านใหม่ หรือรายการรูปทาง LINE ที่บันทึกก่อน D-P1 ไม่มีไฟล์ที่ถูกอ่าน → ไม่มีกลุ่ม C บนการ์ด/ใบเบิก/LINE (หน้ารายจ่ายยังมีแถวเตือนเดิม)
- **G16** ใบเบิกที่รายจ่ายต้นทางถูกแก้หลังปัก snapshot ไม่มีกลุ่ม C และ `SLIP_REF_MISMATCH` เลย (รวม `SELLER_TAX_ID_INVALID`) เพราะ snapshot ไม่เก็บที่มาของการอ่าน (เพิ่มลง snapshot จะเปลี่ยน approval hash — ไม่ทำรอบนี้) (R3-F4)
- **G14** `metadataJson` ที่ผู้เรียกตั้งได้ยังถูกใช้เป็นป้ายในประตูดาวน์โหลด/ลบ (`generatedFor` [create-download-url.use-case.ts:72-98](../../apps/api/src/modules/data-model-core/application/use-cases/create-download-url.use-case.ts), [delete-attachment.use-case.ts:30](../../apps/api/src/modules/data-model-core/application/use-cases/delete-attachment.use-case.ts)) — สเปกนี้ไม่ใช้ป้ายนั้น แต่ผลด้านความปลอดภัยของประตูเหล่านั้นยังไม่ได้วิเคราะห์ ควรรีวิวแยก

## 13. Bugs ที่พบในโค้ดปัจจุบัน (ยืนยันจากการอ่านโค้ด)

| # | ที่ | สถานการณ์ที่ล้ม | ระดับ |
|---|---|---|---|
| **B1** | กฎเลขเอกสารซ้ำไม่ดูผู้ขาย [expense-duplicate.logic.ts:101-111](../../apps/api/src/modules/expenses/domain/logic/expense-duplicate.logic.ts) + normalize ลบเครื่องหมายทั้งหมด [:41-43](../../apps/api/src/modules/expenses/domain/logic/expense-duplicate.logic.ts) ขณะ prompt รวมเล่ม/เลขเป็น "X/Y" [line-ai-internal.controller.ts:1270](../../apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts) | (ก) ร้าน A "เล่มที่ 1 เลขที่ 12" กับร้าน B ที่ใช้สมุดแบบเดียวกัน → `1/12` ทั้งคู่ → `POSSIBLE_DUPLICATE` (ข) ร้านเดียวกัน "1/12" กับ "11/2" → `112` ทั้งคู่; ใบเบิกถูกห้ามจ่ายตามค่าตั้งต้น `BLOCK_PAYMENT` จนกว่าจะปลด | Medium |
| **B2** | สเปกบอก "bounded 180-day scan" ([expense-receipt-upload-spec.md:1307](expense-receipt-upload-spec.md)) แต่ `findNearDuplicates` เอาแค่ 200 รายการล่าสุด ([prisma-expense.repository.ts:3985-3995](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) | ร้าน ~3 ใบ/วัน ถ่ายกระดาษใบเดิมใหม่หลัง ~67 วัน → ไม่มีกฎใดนอกจาก checksum ได้ตรวจ | Medium |
| **B3** | ป้าย "รายการในใบรวมแล้วไม่เท่ายอดรวมที่พิมพ์ไว้" ใช้สถานะที่เขียนตอนอ่าน ([expense-extraction.use-case.ts:277-282](../../apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts)) คู่กับยอดปัจจุบัน ([ExpenseReviewPage.tsx:1745-1752](../../apps/web/src/features/expenses/ExpenseReviewPage.tsx)) | แก้ยอดเป็น 1,040 ให้ตรงแถว → ป้ายยังขึ้น "(1040.00 / 1040.00)" | Low |
| **B4** (รีวิว F15) | `CompleteAttachmentUploadUseCase.execute` โหลดไฟล์ด้วย `companyId` อย่างเดียว ([complete-attachment-upload.use-case.ts:88-92](../../apps/api/src/modules/data-model-core/application/use-cases/complete-attachment-upload.use-case.ts)) ไม่ตรวจผู้อัปโหลดและสาขา ขณะที่ `resume` ตรวจทั้งสอง ([create-upload-intent.use-case.ts:48](../../apps/api/src/modules/data-model-core/application/use-cases/create-upload-intent.use-case.ts)); endpoint ต้องการแค่ `attachment.create` ([attachment.controller.ts:30-31](../../apps/api/src/modules/data-model-core/presentation/http/attachment.controller.ts)) ซึ่งพนักงานทุกคนมี ([permission-registry.ts:530](../../apps/api/src/modules/auth/permission-registry.ts)) | พนักงานสาขา X ที่รู้ id ของไฟล์ที่ค้าง `PENDING_UPLOAD` ของคนสาขา Y ในบริษัทเดียวกัน เรียก `POST …/attachments/{id}/complete` → ไฟล์ถูกทำให้ ACTIVE และเขาได้ record ของไฟล์กลับ (ข้ามขอบเขตสาขา) — ต้องรู้ cuid และไฟล์ต้องยังค้าง (≤ 24 ชม.) | Medium (ความปลอดภัย) |
| **B5** (รีวิว F16) | ทางไฟล์ใบเบิกใน LINE (`stageReimbursementMedia` [process-line-webhook.use-case.ts:11348-11360](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts)) และไฟล์ถามตอบ ([:11311-11316](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts)) เรียก completion ทุกครั้งหลัง `resume` แม้ `resume` คืนว่าไฟล์ ACTIVE แล้ว ([create-upload-intent.use-case.ts:50-51](../../apps/api/src/modules/data-model-core/application/use-cases/create-upload-intent.use-case.ts)) ซึ่ง completion ปฏิเสธ ([complete-attachment-upload.use-case.ts:90-92](../../apps/api/src/modules/data-model-core/application/use-cases/complete-attachment-upload.use-case.ts)) | completion ครั้งแรกสำเร็จแต่ขั้นถัดไปล้ม (เช่นอัปเดต pending media) → LINE redeliver → `resume` เห็น ACTIVE → completion ตอบ 400 "not in PENDING_UPLOAD" ทุกครั้ง → retry ไม่สำเร็จ; ทางใบเสร็จแก้แล้วด้วยการรับไฟล์ ACTIVE ของผู้อัปโหลดเดิม ([expense-upload.use-case.ts:358-364](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts)) และ capture group อธิบายไว้ ([expense-capture-group.use-case.ts:478-486](../../apps/api/src/modules/expenses/application/use-cases/expense-capture-group.use-case.ts)); ทางสื่อรอถาม (:11636) สร้าง intent ใหม่ทุกครั้ง ไม่โดน | Medium |
| **B6** (R2-F5) | การรับหลักฐานใบเบิกปฏิเสธสลิปจ่ายคืน (`generatedFor === REIMBURSEMENT_PAYMENT_SLIP_UPLOAD_TAG` หรือ `isReimbursementPaymentSlip`) แต่**ไม่ปฏิเสธไฟล์ลายเซ็น** ([reimbursement-evidence.service.ts:37-42](../../apps/api/src/modules/reimbursements/application/services/reimbursement-evidence.service.ts)); การลงทะเบียนลายเซ็นอ้างไฟล์ที่อัปโหลดตรง ๆ (`originalAttachmentId: cmd.attachmentId` [signature-asset.use-case.ts:201](../../apps/api/src/modules/expenses/application/use-cases/signature-asset.use-case.ts)) | พนักงานอัปโหลดรูป → ลงทะเบียนเป็นลายเซ็นของตัวเอง → ใส่ id ไฟล์เดียวกันเป็นหลักฐานบรรทัดใบเบิก → บันทึกผ่าน; ตอนอนุมัติ ระบบสร้างรายจ่ายและผูกไฟล์ แต่การผูกไฟล์ลายเซ็นกับรายการอื่นถูกปฏิเสธ ([attachment.logic.ts:66-83](../../apps/api/src/modules/data-model-core/domain/logic/attachment.logic.ts) (`findAttachmentLinkConflict`)) → ใบเบิกค้างหน้าผู้อนุมัติ | Medium |
| **B7** (R2-F7) | เส้นทาง PDF อ่านด้วย job (`if (isPdf) return this.queueCaptureRead(...)` [expense-extraction.use-case.ts:119](../../apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts)); apply คืน `chargeReconciliationStatus` ([receipt-ocr-apply.service.ts:1364](../../apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts)) แต่การเขียน summary แบบ fenced เก็บแค่ `dateStatus`, `missingFields`, `recognizedFields` ([receipt-ocr-apply.service.ts:1295-1302](../../apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts)) | ใบกำกับ PDF ที่แถวรวมไม่ตรงยอด → ไม่มี `chargeReconciliation` ใน summary → ป้ายเตือนเดิมในหน้ารายจ่ายไม่ขึ้นเลยสำหรับ PDF และ `FIGURES_DONT_ADD_UP` จะไม่เกิดกับ PDF | Medium |
| **B8** (R3-F2) | `DeleteAttachmentUseCase` โหลดไฟล์ด้วย `companyId` อย่างเดียว ([delete-attachment.use-case.ts:28](../../apps/api/src/modules/data-model-core/application/use-cases/delete-attachment.use-case.ts)) แล้วไปถึง `markDeleted` ([:69](../../apps/api/src/modules/data-model-core/application/use-cases/delete-attachment.use-case.ts)) **โดยไม่ตรวจขอบเขตสาขาหรือเจ้าของ** — ด่านที่มีคือ retention hold เฉพาะบางชนิด (แบบภาษี, ใบเตรียมจ่าย, สลิปจ่ายคืน, ใบรับรองแทนใบเสร็จ, ใบเบิกที่ส่งแล้ว [prisma-attachment.repository.ts:252-285](../../apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-attachment.repository.ts)) | ผู้ใช้ที่ถูกจำกัดสาขา X และมี `attachment.delete` รู้ id ใบเสร็จของรายจ่ายสาขา Y (ไม่ติด retention) → เรียกลบ → ไฟล์เป็น `DELETED` หลักฐานของสาขาอื่นหายไปพร้อมข้อสังเกตที่ได้จากไฟล์ | Medium (ความปลอดภัย) — แก้แยกและส่งได้เดี่ยว |

แนวแก้ (plan Phase D): B1 — เลขเอกสารต้องผู้ขายเดียวกัน ยกเว้นสลิปทั้งสองฝั่ง และ normalize เก็บ "/" เป็นตัวคั่นเดียว; B2 — query เพิ่มทุกแถวใน 180 วันที่ยอดเท่ากัน **หรือ** เลขเอกสารดิบเท่ากันแบบไม่สนตัวพิมพ์ รวมกับ 200 ล่าสุด และ**ระบุข้อจำกัดที่เหลือตรง ๆ**: เกิน 200 แถวแล้ว pHash อย่างเดียว หรือเลขเอกสารที่ต่างแค่เครื่องหมาย/ช่องว่างและยอดต่างกัน ยังไม่ถูกจับ (Hamming distance ทำ index ไม่ได้) — แก้ถ้อยคำในสเปกเดิมให้ตรง (รีวิว F14); B3 — helper เดียวกับ `FIGURES_DONT_ADD_UP`; B4 — ตรวจ `uploadedByUserId === ctx.userId && isBranchInScope` แบบ `resume` + ตรวจผู้เรียกภายในทุกจุดว่าส่ง ctx ของผู้อัปโหลด; B5 — `resume` คืน `active: boolean` และผู้เรียกรับไฟล์ ACTIVE ของผู้อัปโหลดเดิมเมื่อ checksum ตรง แทนการ complete ซ้ำ; B6 — ปฏิเสธ `invalid_primary_attachment` เมื่อ `findSignatureAssetOwner(...)` ไม่เป็น null; B7 — ใส่ `chargeReconciliation {status, chargesApplied, itemsSumAmount}`, `classification` (ขอบเขตเดียวกับเส้นทางรูป) และ `extractionAttachmentId: options.sourceAttachmentId` ในการเขียน fenced เดียวกัน; B8 — หลังโหลดไฟล์ ตรวจ `isBranchInScope(ctx.scopes ?? {}, existing.branchId)` (ไม่ผ่าน → audit DENIED + 403) แบบเดียวกับ `resume` และ B4; ไม่เพิ่มเงื่อนไขเจ้าของ เพราะ `attachment.delete` ไม่อยู่ในสิทธิ์พนักงานทั่วไป ([permission-registry.ts:527-540](../../apps/api/src/modules/auth/permission-registry.ts)) ผู้ถือคือบทบาทผู้ตรวจ/ผู้ดูแลที่ลบไฟล์ของคนอื่นในสาขาได้ตามเดิม

## 14. Test plan

API test ใหม่อยู่ในไฟล์ที่ลงทะเบียนแล้วใน `apps/api/package.json` (สเปกนี้ไม่ได้รัน test — not run)

### 14.1 Unit (API)

| ไฟล์ | เคส |
|---|---|
| `src/modules/data-model-core/domain/logic/attachment.logic.spec.ts` | **manifest C2PA จริง** (fixture สร้างด้วย c2patool บนเครื่อง dev แล้ว commit ไฟล์เล็ก บันทึกที่มา) แบบไม่บีบอัดและแบบ `brob`, หลาย APP11 segment, `c2pa.ai-disclosure` (มี `modelType`), digitalSourceType ทั้งสามใน `c2pa.actions.v2`; manifest ไม่มีคำ AI → แค่ `present.c2pa`; **negative (R2-F1): custom metadata assertion ที่มีคำบรรยายยกข้อความ URI `trainedAlgorithmicMedia` → ไม่มี aiDeclared; XMP `dc:description` ที่ยก URI → ไม่มี aiDeclared; digitalSourceType อยู่ใน ingredient/manifest ที่ไม่ใช่ active → ไม่มี aiDeclared**; CBOR ลึก/ใหญ่เกิน → `c2paUnsupported`; **related actions (R4-F4)**: AI อยู่บน related ของ action ที่จับภาพจริง → มี, related ทับค่าแม่ที่เป็น AI ด้วย `digitalCapture` → แม่ยังนับ, related ลึกเกินขอบเขต → `c2paUnsupported`; **PDF producer อย่างเดียว (R4-F5)**: Producer = "Sejda" ไม่มี Creator → `tool`; PNG `parameters="exposure 1/50"` → ไม่มี tool, PNG แบบ WebUI ครบ 4 ฟิลด์ → tool, ComfyUI JSON ครบโครง → tool (R2-F11); Brotli เกิน 2 MB → `c2paUnsupported`; XMP DigitalSourceType; EXIF Software "Adobe Photoshop 25.0" → `tool EDITOR`; **ImageDescription="ChatGPT subscription receipt" → ไม่มี aiDeclared และไม่มี tool** (F7); PNG ComfyUI keys → `tool AI_TOOL` ไม่ใช่ aiDeclared (F10); CamScanner/Word → ไม่มี tool; ไบต์เสีย → `error` ไม่ throw; ผลไม่มีสตริงดิบ/GPS; Phase 4: payload CRC ถูก/ผิด/ขาด 0, TrueMoney, ไม่มี QR |
| `src/modules/data-model-core/application/use-cases/delete-attachment.use-case.spec.ts` | **B8**: ผู้ใช้จำกัดสาขาลบไฟล์สาขาอื่น → 403 ไม่มี mutation; สาขาเดียวกันยังลบได้; retention เดิมยังทำงาน |
| `src/modules/data-model-core/application/use-cases/complete-attachment-upload.use-case.spec.ts` | เขียน `fileSignalsJson` คู่ `perceptualHash`; อ่านล้ม → อัปโหลดสำเร็จ; **B4**: ผู้อื่น/สาขาอื่น → 403 ไม่มี mutation; Phase 4 `slipRefKey` เฉพาะ BANK+crcValid, QR timeout → `NOT_RUN` |
| `src/modules/expenses/domain/logic/expense-duplicate.logic.spec.ts` | `deriveAuthenticitySignals` ทุกแถว §6.3/§10.6; factsHash เปลี่ยนเมื่อเลขผู้เสียภาษี A→B, ไฟล์เปลี่ยน, ยอดเปลี่ยน; review รายการหนึ่งไม่ปิดอีกรายการที่ใช้ไฟล์เดียวกัน (F2); สองภาพสลิปเดียวในรายการเดียว → `SLIP_REF_REUSED same_target` (F13); `SLIP_QR_INVALID` บนไฟล์ที่ไม่ได้ OCR (F12); ไฟล์ที่ `metadataJson.generatedBy:'substitute_receipt'` แต่ไม่มีความสัมพันธ์ artifact → ยังนับ (F1); `expense.review.evidence` ที่เป็นสแกนเซ็นมือ → นับ, artifact ใบรับรอง → ไม่นับ (F11); B1 |
| `src/modules/expenses/application/services/expense-duplicate-detection.spec.ts` | B2 รวมเคสข้อจำกัดที่ระบุ (pHash อย่างเดียวเกิน 200 → ไม่จับ เป็นพฤติกรรมที่ตั้งใจและเขียนไว้) |
| `src/modules/expenses/application/use-cases/expense-upload.use-case.spec.ts` | POST รายจ่าย: สิทธิ์, สาขา, ไฟล์ไม่อยู่ใน target, **ส่ง signal ที่ไม่ค้างและไม่ได้ตรวจแล้วด้วย factsHash เดียวกันปนมา → 422 ไม่บันทึกเลย** (F3); ส่งซ้ำชุดที่ตรวจแล้ว → 200 ไม่มีแถว/audit ใหม่ (R2-F8); revision เก่า → 409, factsHash เก่า → 422, REJECTED/VOIDED → 409, audit ใน tx; ใช้ `SELECT … FOR UPDATE` ก่อนอ่าน |
| `src/modules/reimbursements/application/use-cases/reimbursement-related-access.use-case.spec.ts` | ผู้ส่ง `read_own` ไม่ได้ key; ผู้มอบหมายแช่แข็งที่ถูกถอดสิทธิ์ `reimbursement.approve` แล้ว**ยังเห็น** (F5); ผู้อนุมัติตามบทบาทไม่มีชื่อในขั้นเห็น; `other.id` ซ่อนเมื่อเปิดไม่ได้ |
| `src/modules/reimbursements/application/use-cases/reimbursement-approval.use-case.spec.ts` | POST ใบเบิก: frozen assignee บันทึกได้, role-routed บันทึกได้, คนนอกขั้น 403; มีข้อสังเกตค้างยังอนุมัติได้; preview LINE มีบรรทัด + "ดูเอกสาร"; WEAK อย่างเดียวไม่มีบรรทัด; การบันทึกไม่เปลี่ยน digest/updatedAt |
| `src/modules/reimbursements/application/use-cases/reimbursement-finance.use-case.spec.ts` | finance/payer บันทึกได้; เลขบัญชีใน note → 400; ใบ CANCELLED/REJECTED → 409 (F21) |
| `src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` | **B5**: redeliver หลังไฟล์ใบเบิก/ไฟล์ถามตอบ ACTIVE แล้ว → รับไฟล์เดิม ไม่ 400; **D-P1 (R4-F1)**: รูปใบเสร็จทาง LINE ที่อ่านสำเร็จ → summary มี `extractionAttachmentId` = id ไฟล์ที่ส่ง OCR; ไม่มี fallback ไป primary |
| `src/modules/line-ai/application/use-cases/erp-core-detail-tools.use-case.spec.ts`, `erp-reimbursement-tools.use-case.spec.ts` | read tool ไม่มี `authenticity` และคำใน §10.4 |
| `src/modules/line-ai/domain/logic/line-business-card.logic.spec.ts` | ปุ่ม "ดูเอกสาร" ขนาดเท่าปุ่มอื่น ไม่ซ้ำ "ส่งรูปเอกสาร"; บรรทัดมาจาก `authenticityNotice` ใน entry |
| `src/modules/expenses/domain/logic/expense-duplicate.logic.spec.ts` (เพิ่ม) | ใบเบิก: ไฟล์ที่เพิ่มในรายจ่ายหลังปัก snapshot ไม่ถูกนับ; checksum ไม่ตรง snapshot → ไม่นับ; รายจ่ายถูกแก้หลังปัก → ไม่มีกลุ่ม C และ `SLIP_REF_MISMATCH` เลย รวม `SELLER_TAX_ID_INVALID` (R3-F4); ไฟล์ที่ถูกอ่านไม่อยู่ใน snapshot หรือ checksum ไม่ตรง → ไม่มีกลุ่ม C; **C2PA (R3-F1):** created=digitalCapture + `"*"` AI template → ไม่มี, AI template ชื่อที่ไม่มี action → ไม่มี, action ไม่มีค่าเอง + `"*"` AI → มี; **CBOR (R3-F6):** assertion ที่มี bool/float/tag → อ่านได้ ไม่ MALFORMED; **R3-F5:** OCR อ่าน ref A, QR A, ผู้ใช้แก้เลขเป็น B → ไม่มี `SLIP_REF_MISMATCH`; ผู้ใช้เปลี่ยนชนิดเอกสาร → ไม่เปลี่ยนผล; รายจ่ายฉายจากใบเบิก: ไฟล์ปักที่ resolver ประกอบจาก snapshot นับ (R2-P11/F4); `sourceStale` → ไม่มีกลุ่ม C/`SLIP_REF_MISMATCH` (R2-F6) |
| `src/modules/expenses/application/services/receipt-ocr-apply.service.spec.ts`, `src/modules/expenses/application/services/expense-capture-read-runner.service.spec.ts` | **B7**: PDF ที่แถวไม่ตรงยอด → summary มี `chargeReconciliation.status = ITEMS_DID_NOT_RECONCILE` + `itemsSumAmount` + `extractionAttachmentId` |
| `src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.spec.ts` | **B6**: ไฟล์ที่มี link `company.signature_asset` เป็นหลักฐานบรรทัด → 422 `invalid_primary_attachment` |
| `src/modules/reimbursements/application/use-cases/reimbursement-approval.use-case.spec.ts` (เพิ่ม) | **R2-F2**: `ExpenseActionPreviewTool.execute(...).data` ไม่มี `authenticityNotice` และไม่มีข้อความ "ใบจริง" ใน `details/summary/reply` |
| `apps/ai-gateway/src/modules/line-ai/agents/semantic-turn-v2-grounding.spec.ts` (suite `reliability-gateway-v2`) | **R2-F2**: คำขอผสม "อนุมัติใบเบิก + ถามยอดวันนี้" → `toolResults` ที่ส่งให้ตัวเขียนคำตอบไม่มีข้อความข้อสังเกต |

### 14.2 Real PostgreSQL

`src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.draft-submit-race.spec.ts` (อยู่ใน `pretest` ข้ามเมื่อไม่มี `DATABASE_URL`): migration มีตาราง/คอลัมน์/index; สองคนบันทึกชุดเดียวกันพร้อมกัน → แถวเดียวต่อ (target, ไฟล์, code, factsHash) ทั้งสองคำขอสำเร็จ (ความหมาย idempotent §7.3 ข้อ 6ข); **review ชนกับการปิด: ยกเลิก/ไม่อนุมัติใบเบิกในอีก transaction ระหว่าง review → ฝั่งที่ได้ล็อกทีหลังเห็นสถานะ/revision ใหม่ (review ได้ 409 หรือการปิดรอจน review เสร็จ) ไม่มีแถว review ที่อ้าง revision ซึ่งไม่เคยเป็นปัจจุบันขณะเขียน; review ชนกับการแก้รายจ่าย (เปลี่ยนเลขผู้เสียภาษี) แบบเดียวกัน** (R2-P2/F3); ****review ของ A ชนกับการลบไฟล์ B ที่มี `slipRefKey` เดียวกัน (กราฟคนละชุด) → การลบ B รอจน review เสร็จ หรือ review เห็น B หายแล้วได้ 422 (R4-F2)**; review ชนกับการลบไฟล์แบบ soft delete: ฝั่งที่ได้ `lockFundingEvidence` ทีหลังเห็นสถานะใหม่ — review หลังลบได้ 404, ลบหลัง review สำเร็จตามกติกาเดิม; ไม่มีแถว review ที่เขียนหลังไฟล์เป็น `DELETED`** (R3-F3); `slipRefKey` บริษัท A ไม่เห็นบริษัท B; ลบไฟล์ (cascade) ไม่ทิ้งแถว review ค้าง

### 14.3 Contracts / gateway / web

- `packages/contracts/src/company-tax-identity.spec.ts`: เลขนิติบุคคล 3 ราย; `AUTHENTICITY_WORDS` ครบทุก code ไม่มีคำ "ปลอม/โกง/ทุจริต"; `authenticityOpenCountForLine`
- `apps/ai-gateway/src/modules/line-ai/agents/approved-knowledge.spec.ts` (suite `reliability-gateway-v2`): ระหว่างชุดใหม่ยังเป็น DRAFT ตัวเลือกคืน **v6** ไม่ใช่ v4 และ source-hash ของ v6 ไม่เปลี่ยน (R2-F10); เมื่อเจ้าของอนุมัติแล้ว การ์ดเห็นเฉพาะสิทธิ์ผู้ตรวจ/ผู้อนุมัติ
- เว็บ (เพิ่ม): `expenses.model.spec.ts` — เลย์เอาต์ source-only (`sourceOnly` [expenses.model.ts:1516](../../apps/web/src/features/expenses/expenses.model.ts)) มีการ์ดเมื่อมี `authenticity` (R2-F9)
- เว็บ: `apps/web/src/features/expenses/expenses.model.spec.ts` (แถวเลขผู้เสียภาษีไม่ซ้ำเมื่อมีการ์ด, B3), `apps/web/src/features/reimbursements/reimbursements.model.spec.ts` (บรรทัด n ใบ, ปุ่มซ่อนเมื่อ `closed`, คำปฏิเสธ)

### 14.4 Browser journey (local proof stack, 390 / 1280 / 1,556 px)

`e2e/journeys/receipt-second-look.journey.spec.ts`:
1. พนักงานส่งใบเบิกแนบ `aiDeclaredPng()` (manifest C2PA จริงจาก fixture ขนาดเล็ก) → หน้าพนักงานไม่มี "ข้อสังเกตเอกสาร"
2. ผู้อนุมัติเปิดใบ → บรรทัดในการ์ดขั้นตอน + การ์ด → `expectFitsScreen` ทั้งสามความกว้าง รวม dialog
3. บันทึก "ตรวจแล้ว" → ประวัติแสดงชื่อ → อนุมัติสำเร็จ
4. อีกใบที่ค้างอยู่ก็อนุมัติได้
5. ฝ่ายบัญชีเปิดรายจ่ายแนบ `editorJpeg()` (≤ 6 MB เพื่อให้เว็บไม่แปลง) → "ข้อมูลในไฟล์ระบุโปรแกรม Adobe Photoshop"; แนบ JPEG 7 MB ที่มี EXIF → ไม่มีข้อสังเกต (ยืนยัน G13)
6. Phase 4: สลิป fixture QR ≠ เลขที่พิมพ์ (ธนาคารใน allowlist) → "เลขอ้างอิงที่อ่านได้บนสลิป…ไม่ตรงกับ QR"; สองภาพสลิปเดียวในใบเบิกเดียว → "…ในรายการนี้"
7. ผู้ถือ `expense.read` อย่างเดียวเปิดร่าง LINE ที่ READY_FOR_CONFIRMATION แต่ยังไม่ครบ (เลย์เอาต์ source-only) → เห็นการ์ด ไม่มีปุ่ม "ตรวจแล้ว" (R2-F9)
8. ใบเบิกที่รายจ่ายต้นทางถูกเพิ่มไฟล์หลังส่ง → การ์ดของผู้อนุมัติไม่มีไฟล์ใหม่นั้น (R2-F4)

## 15. Acceptance criteria

1. อัปโหลดทั้งเว็บและ LINE แล้วมี `fileSignalsJson` (หรือ `error`) โดยอัปโหลดไม่ล้มเพราะขั้นนี้ ไม่มี EXIF ดิบในฐานข้อมูล
2. ผู้ไม่มีอำนาจตาม §8 ไม่ได้ key `authenticity`; frozen assignee และ role-routed approver ได้
3. ทุกแถว §6.3 เกิด/ไม่เกิดตาม §10.6 (unit test ครบ) รวมกรณีข้อความอิสระใน EXIF และ ComfyUI
4. ไม่มีป้ายใดยกเว้นไฟล์จากการตรวจ (`metadataJson` ไม่มีผล)
5. บันทึกตรวจแล้วผูก (target, ไฟล์, code, factsHash); ข้อเท็จจริงเปลี่ยนแล้วค้างใหม่; ส่ง signal ที่ไม่ค้างและไม่ได้ตรวจแล้วด้วย factsHash เดียวกันแม้ตัวเดียว → 422 ไม่บันทึก; ส่งซ้ำ = สำเร็จแบบไม่เขียนซ้ำ; ทุกคำปฏิเสธมีทางออก; audit อยู่ใน transaction เดียวกัน; กดพร้อมกันได้แถวเดียว และ review ชนกับการปิด/แก้ไม่ทำให้มีแถวที่อ้าง revision เก่า (real PG, ล็อกแถว target)
5a. ข้อสังเกตของใบเบิกมาจาก snapshot ที่ปักเท่านั้น; ไฟล์ที่เพิ่มทีหลังไม่ปรากฏ (R2-F4); กลุ่ม C ไม่โยงไปไฟล์ที่ยังไม่ถูกอ่าน (R2-F6)
5b. `FILE_SAYS_AI` เกิดจาก property `digitalSourceType` ของ actions ใน active manifest หรือ assertion `c2pa.ai-disclosure` หรือ XMP `Iptc4xmpExt:DigitalSourceType` เท่านั้น — caption/metadata ที่ยกข้อความ URI ไม่เกิด (R2-F1)
6. ยืนยัน/อนุมัติ/จ่ายทำได้เหมือนเดิมแม้มีข้อสังเกตค้าง
7. นโยบายรายการปิดเหมือนกันทั้ง API และ UI (REJECTED/CANCELLED/VOIDED)
8. การ์ด LINE APPROVE/CONFIRM มีบรรทัด + "ดูเอกสาร" เฉพาะเมื่อมี STRONG/MEDIUM ค้าง; การ์ดผู้ส่งไม่เปลี่ยน; preview token ไม่หมดอายุเพราะการบันทึก
9. ไม่มี model call ใหม่ ไม่มีการเรียกบริการนอก
10. **น้องมั่งมีไม่เปิดเผยข้อสังเกตของรายการใด ๆ** (read tool test); คำอธิบายทั่วไปผ่านคู่มือที่เจ้าของอนุมัติ ให้เฉพาะผู้มีสิทธิ์ตรวจ เป็นข้อยกเว้นที่ตั้งใจ (รีวิว F23)
11. journey §14.4 ผ่านที่ 390, 1280, 1,556 px; journey เดิมผ่าน
12. W00 regenerate แล้ว และ whole-chain ผ่าน
13. Phase 4: `slipRefKey` ค้นในบริษัทเดียว; `SLIP_REF_MISMATCH` เฉพาะธนาคารที่มี fixture; QR อ่านใน worker ที่ถูก terminate ได้
14. B1–B8 มี test ที่เคยล้มและผ่านหลังแก้
14a. `FILE_SAYS_AI` จาก C2PA คิดค่าที่มีผลจริงของ action ที่บันทึกตาม §18.15.6.1 — template ที่ไม่ได้ใช้ไม่สร้าง และ template ไม่ทับค่าของ action (R3-F1); CBOR ที่มี bool/float/tag อ่านได้ (R3-F6)
14b. "ที่อ่านได้" ปรากฏเฉพาะค่าจากผล OCR ของไฟล์; ค่าที่ผู้ใช้แก้ใช้ "ที่บันทึก" (R3-F5)
14c. review ไม่เขียนแถวหลังไฟล์ถูกลบ รวมไฟล์อีกฝั่งของ `SLIP_REF_REUSED` (real PG, `lockFundingEvidence` รวมไฟล์ key เดียวกันก่อนล็อกแถว) (R3-F3, R4-F2)
14d. related actions นับตาม §18.15.8; PDF อ่านด้วย `updateMetadata: false`; `slipRefKey` ตรงตามไบต์; dialog มีคำปฏิเสธ 404 พร้อมโหลดใหม่และเก็บข้อความ; ลำดับปุ่มตามมาตรฐาน (R4-F3…F7)
14e. รูปใบเสร็จทาง LINE มี `extractionAttachmentId` หลัง D-P1 (R4-F1)
15. tool result ของ `expense.action.preview` และ input ของตัวเขียนคำตอบไม่มีข้อความข้อสังเกต (R2-F2)
16. เลย์เอาต์ source-only ของหน้ารายจ่ายแสดงการ์ดเมื่อผู้ดูได้ `authenticity` (R2-F9)

## 16. ความเสี่ยงและการปล่อย

| ความเสี่ยง | ระดับ | รับมือ |
|---|---|---|
| เตือนผิดจนผู้อนุมัติเมิน | กลาง | WEAK ไม่ขึ้น LINE; ไม่อ่านข้อความอิสระ; ComfyUI/A1111 เป็นแค่ "ระบุโปรแกรม"; สรุปจำนวนต่อ code หลัง 30 วัน แล้วตัด/ลดระดับ |
| metadata หาย (screenshot, เว็บแปลงรูป, LINE?) | สูง (รู้อยู่แล้ว) | ไม่อ้างว่าจับได้; กลุ่ม C/D ไม่พึ่ง metadata; ใบซ้ำยังเป็นด่านหลัก |
| การตรวจแล้วเก่าปิดข้อเท็จจริงใหม่ | — | factsHash + ผูก target (F2) |
| สอนวิธีหลบ | กลาง | ไม่แสดงต่อผู้ส่ง (Q1) |
| event loop ค้างจาก parser/QR | ต่ำ-กลาง | parser เชิงเส้น วัด delay; QR ใน worker terminate ได้ (F17) |
| PDPA | ต่ำ | boolean/ชื่อจากรายการ; transRef อยู่ในบริษัทเดียว |
| `jsqr` ไม่ถูกดูแล (อัปเดตล่าสุด 2021 ตาม [depscope](https://depscope.dev/pkg/npm/jsqr)) | ต่ำ | pixel buffer จาก sharp, รันใน worker, pin, `pnpm audit`; Phase 4 ถอดได้ |
| ช่องโหว่ completion (B4) ถูกใช้ก่อนแก้ | กลาง | ทำ Phase D-B4 ก่อน Phase 1 หรือพร้อมกัน |
| ช่องโหว่ลบไฟล์ข้ามสาขา (B8) | กลาง | Phase D-B8 แยก ส่งได้เดี่ยว ทำก่อนสุดพร้อม B4 |
| ล็อกแถวใน review ทำให้ deadlock หรือรอนาน | ต่ำ-กลาง | transaction สั้น (ไม่มี I/O ภายนอกระหว่างล็อก), ใช้ลำดับล็อกเดิมของระบบ (MC2), pg test สองทิศทาง |
| ข้อสังเกตหลุดไปถึงโมเดล | กลาง | `authenticityNotice` แยกจาก `details`, ตัดออกจาก tool result, test คำขอผสม (R2-F2) |

การปล่อย: Phase D-B8 และ D-B4 ก่อน (ความปลอดภัย ส่งแยกได้) → Phase 1 → 2a → 2b → 3 → 4; B1/B2/B3/B5/B6/B7 อิสระ (B7 ก่อนคาดหวังกลุ่ม C บน PDF); ไม่มีสวิตช์; ตรวจบน local proof stack → UAT ตาม runbook → Production เมื่อเจ้าของสั่ง

## 17. คำถามสำหรับเจ้าของ (เรื่องธุรกิจเท่านั้น)

| # | คำถาม | คำตอบที่แนะนำ |
|---|---|---|
| Q1 | บอกผู้ส่ง (พนักงาน) ไหมว่าไฟล์ของเขามีข้อสังเกต | **ไม่บอกรอบนี้** — ไม่ให้รู้สึกถูกกล่าวหา และไม่สอนวิธีหลบ; ถ้าต้องการภายหลังใช้ข้อความทั่วไปที่ทุกคนเห็นเท่ากัน |
| Q2 | ซื้อบริการตรวจสลิปภายนอก (~0.4 บาท/สลิป ส่งข้อมูลออก ต้องเพิ่มในภาคผนวก DPA) ไหม | **ยังไม่ซื้อ** — ใช้การตรวจ QR ในระบบ + ให้ผู้อนุมัติสแกนเอง; ทบทวนเมื่อข้อสังเกตกลุ่มสลิปเกินเดือนละ 20 ครั้ง |
| Q3 | ใส่ข้อสังเกต/การตรวจแล้วลงไฟล์ส่งออกให้นักบัญชีไหม | **ไม่ใส่** — ไม่จำเป็นต่อการลงบัญชี สอดคล้องการตัดช่องที่ไม่จำเป็น (backlog #25) |

## 18. ต้องปิดก่อนเขียนโค้ด (MEDIUM/LOW ที่ปิดด้วยการอ่านโค้ดหรือเอกสารไม่ได้)

สถานะ HIGH: ไม่มีค้าง — R2-F1 (parse assertion จริง) และ R3-F1 (template ของ action ตาม §18.15.6.1) ได้รับการยืนยันในรีวิวรอบ 4 (รอบสุดท้าย) 2026-10-24; ไม่มี BLOCKER ข้อต่อไปนี้ (MEDIUM/LOW) ต้องปิดใน lane แรกที่แตะส่วนนั้น และบันทึกผลในหน่วยความจำก่อนเขียนโค้ดส่วนนั้น:

| # | เรื่อง | ทำไมยังปิดไม่ได้ | วิธีปิด | บล็อก phase |
|---|---|---|---|---|
| MC1 | การ์ด LINE ได้ preview มาจาก `StoredAction` ที่เก็บไว้ หรือจากผลที่ผ่าน gateway (R2-F2) | ยังไม่ได้ไล่เส้นทางส่งการ์ดครบ | ไล่ตั้งแต่ `ExpenseActionPreviewTool` → ตัวส่งการ์ด; ถ้าการ์ดสร้างจากผลที่ผ่าน gateway ให้ตัวส่งการ์ดอ่าน `authenticityNotice` จาก store ด้วย `previewId` แทน | 3L |
| MC2 | ลำดับล็อกระหว่างแถวใบเบิกกับแถวรายจ่ายที่ผูก (R2-F3) | ต้องเทียบกับทุกเส้นทางที่ล็อกทั้งสองแบบ (`lockFundingEvidence`, อนุมัติ/จ่าย/ฉายรายจ่าย) เพื่อไม่ให้ deadlock | อ่านลำดับล็อกเดิม แล้วใช้ลำดับเดียวกัน + pg test สองทิศทาง | 2b |
| MC3 | c2patool สร้าง assertion `c2pa.ai-disclosure` (2.4) และ `brob` ได้หรือไม่ | ยังไม่ได้ลองเครื่องมือ | ลองบนเครื่อง dev; ไม่ได้ให้ประกอบ JUMBF fixture เองตามสเปก และบันทึกที่มา | 1 |
| MC4 | รูปแบบ `parameters` ของ Stable Diffusion WebUI (`Steps:`/`Sampler:`/`CFG scale:`/`Seed:`) | ยังไม่ได้เปิดซอร์ส WebUI | อ่านซอร์สที่เขียน infotext แล้วปรับเงื่อนไข; ถ้าไม่ชัดให้ตัดการระบุ WebUI ออก (ไม่ระบุโปรแกรม) | 1 |
| MC5 | ธนาคารใดพิมพ์เลขอ้างอิง = transRef ใน QR (G9) และตัวพิมพ์/เครื่องหมายเทียบเท่ากันหรือไม่ (R4-F3) | ต้องใช้สลิปจริง; SCB ไม่มีเอกสารเรื่อง case equivalence | plan Phase 0.1; ไม่มีหลักฐาน = เทียบตรงตามไบต์ | 4 |
| MC6 | jsQR อ่าน QR ได้หลัง LINE บีบอัดหรือไม่ (G1) | ต้องส่งผ่าน LINE จริง | plan Phase 0.2 | 4 |
| MC7 | ผู้เรียก `CompleteAttachmentUploadUseCase` ภายในทุกจุดส่ง ctx ของผู้อัปโหลด (B4) | ต้องไล่ทีละจุด | plan D-B4 — พบจุดที่ทำแทนผู้อื่นโดยชอบ ให้หยุดและบันทึก | D-B4 |
| MC8 | `snapshot.totals` มี key `grandTotalAmount` ทุกเวอร์ชัน snapshot | อ่านแค่ตัวสร้างปัจจุบัน ([reimbursement-source.ts:49-63](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts)) | ตรวจ snapshot เก่าใน test fixture/seed; ไม่มี key → ไม่สร้างข้อที่ใช้ยอด | 2b |
| MC9 | C2PA บังคับ CBOR แบบ definite-length/deterministic หรือไม่ (R3-F6) | ยังไม่ได้อ่านข้อกำหนดการเข้ารหัสของ C2PA ส่วนนั้น | อ่านสเปก; ถ้าไม่บังคับ ให้ decoder รองรับ indefinite-length ภายใต้ขอบเขตเดียวกัน + fixture | 1 |
| MC10 | เส้นทางรูปเก็บ `classification.documentKind` และ `recognizedFields.documentNumber` ใน summary ทุกครั้ง และเส้นทาง PDF หลังแก้ B7 เก็บครบ (R3-F5) | อ่านแค่ [expense-extraction.use-case.ts:266-282](../../apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts) และทาง LINE ยังไม่ได้ไล่ | ไล่ทั้งเส้นทางเว็บ/LINE/PDF; ขาดที่ใดให้ `SLIP_REF_MISMATCH` ไม่เกิดในเส้นทางนั้นจนกว่าจะเก็บ | 4 (และ D-B7) |
| MC11 | ทุกการเขียน/ลบ `AttachmentLink` ของหลักฐานรายจ่าย/ใบเบิกถือ `lockFundingEvidence` หรือไม่ (R4-F2) | ยังไม่ได้ไล่ทุกจุดที่เขียน link | ไล่จุดเขียน link; จุดที่ไม่ถือ ให้ถือก่อนเขียน หรือบันทึกว่ายอมรับความเสี่ยงที่ข้อสังเกต REUSED อาจหายหลังบันทึก (ไม่กระทบเงิน/สิทธิ์) | 4 |
| MC12 | template ของชื่อ related action ใช้กับ related ด้วยหรือไม่ (R4-F4) | §18.15.8 บอกแค่ว่า merge "just as with an action template" | อ่านตัวอย่าง/test vector ของ C2PA หรือ c2pa-rs; จนกว่าจะยืนยัน ไม่ใช้ (ลด false positive) | 1 |
| MC13 | ทาง LINE รูปภาพเก็บ `extractionAttachmentId` หลังแก้ D-P1 ครบทุกทาง (ใบเสร็จใหม่, resume, ร่างจากต้นทาง) (R4-F1) | อ่านแค่การเขียน summary ที่ [process-line-webhook.use-case.ts:10599-10612](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts) | ไล่ทุกที่ที่เขียน `aiVerificationSummaryJson` ของ `LINE_UPLOAD` | D-P1 |
