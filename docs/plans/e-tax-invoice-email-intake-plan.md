# e-Tax Invoice Email Intake Plan

Status: DRAFT — blocked on: BL2 (OCR unit recovery on early exits) review before P2.4; P1 scanner fix can ship first (review rounds 1–4 + focused check 2026-10-24: BL1 closed; ยังไม่เริ่ม implement; spec §19)
Spec: `docs/specs/e-tax-invoice-email-intake-spec.md` (revision 6)
Memory: `docs/agent-memory/e-tax-invoice-email-intake.md`
Baseline: main 6c54ba208 (2026-10-23)
Scope: **P1 แก้ช่องโหว่ตัวตรวจ PDF (B1) — ปล่อยเดี่ยว** → P2 B2 + อ่าน/ตรวจ e-Tax + B4/B6 (ทุกช่องทางรับใบเสร็จ) → P3 ท่อรับอีเมล → P4 หน้าเว็บ → P5 แจ้งเตือน + LINE + help pack v7 → P6 export/รายงาน/seed/journey/ops
หลักการ: ponytail full — ใช้ท่อเดิมทุกจุด, ไม่มีสวิตช์, dependency ใหม่ 2 ตัวที่จำเป็นจริง (XML, CMS/TSP); ตัวตรวจ PDF ใช้ `node:zlib` ไม่ใช้ pdf-lib

## ลำดับที่บังคับ

```
P1 (B1, ปล่อยเดี่ยว) ──▶ P2 ──┐
                              ├──▶ P5 ──▶ P6
P0 ───────▶ P3 ──▶ P4 ────────┘
```
- **P1 ไม่ขึ้นกับงานอื่น** เริ่มได้ทันที; ปล่อยหลังปิด MC7 (corpus false-refusal) — UAT ก่อน, Production ตามคำสั่งเจ้าของ; สเปก receipt-authenticity-signals ที่แตะ `attachment.logic.ts` rebase บน P1
- P2 รอ P1, MC1/MC5/MC6/MC8/MC14 และ**การทบทวน BL2 v2 (OCR unit recovery on early exits) ก่อน P2.4 — spec §19** (BL1 ปิดแล้ว); P1 ไม่รอ BL2; P6.1 executive รอเจ้าของตัดสิน MC12
- P3.2 รอ MC2; P3.1 ขนานกับ P2 ได้; P3.3 รอ P2.2
- P4 deploy เว็บเมื่อ inbound ของสภาพแวดล้อมนั้นทำงานแล้ว (และบัญชี Postmark เป็น Pro+ — MC3)
- ทุก lane: `AGENTS.md`, `.agents/skills/ponytail/SKILL.md`; ห้าม `pkill` ตาม pattern; แตะ cloud ต้องอ่าน `docs/runbooks/cloud-environment-operations.md`; owner minimal-testing (typecheck + boot + spec ที่แตะ) + หลักฐานหน้าจอจริง 390/1280/~1556 px สำหรับ UI ([thai-ux-standard.md:114](../guidelines/thai-ux-standard.md)); test API ใหม่อยู่ในไฟล์ที่อยู่ใน `apps/api/package.json` แล้วเท่านั้น

---

## P0 — เตรียม (controller) — ตรงกับ spec §18

| # | งาน |
|---|---|
| 0.1 (MC1, MC5, MC14) | ไฟล์ e-Tax จริง ≥ 3 แบบ (รวมคู่ Time Stamp + .eml) → อ่านใบรับรอง TSA ของ ETDA และ EKU/KeyUsage ของผู้ลงนามจริง |
| 0.2 (MC6) | NRCA root PEM + fingerprint |
| 0.3 (MC8) | เวอร์ชัน `fast-xml-parser`/`pkijs` ≥ 2 สัปดาห์ ไม่มี advisory high |
| 0.4 (MC2, MC10) | ขออนุญาตแตะ cloud → inbound stream UAT ทดสอบ `OriginalRecipient` (To/Cc/Bcc/forward) และ Basic Auth ผ่าน ingress; ไม่ใช่ envelope → แก้ spec ก่อน P3.2 |
| 0.5 (MC3, MC4) | แผนบัญชี Postmark ปัจจุบัน (ต้อง Pro+ สำหรับ inbound), ราคา Retention add-on จริง, ปริมาณข้อความต่อร้าน |
| 0.6 (MC12, MC13, MC15) | **เจ้าของตัดสิน** ที่อยู่เคส test executive (spec §18 MC12: (ก) ข้อยกเว้นให้ใช้ PG spec เดิม — แนะนำ, (ข) ตัดตัวนับ executive เป็นงานแยก); ตกลงตำแหน่งคอลัมน์ export กับสเปก accountant-export-cleanup (MC15); ตรวจการกัน event ซ้ำทาง LINE ก่อน `queueExpenseRead` |
| 0.7 | เจ้าของตอบ Q1–Q8 |

---

## P1 — แก้ช่องโหว่ตัวตรวจ PDF (B1) — ปล่อยเดี่ยว

### 1.1 ตัวตรวจแบบมีเพดาน (lane เดียว)

- `apps/api/src/modules/data-model-core/domain/logic/attachment.logic.ts` (spec §10.5 ขั้นแรก):
  - **`tokenizePdf(bytes, budget)`** (F1/P4): ตัวแยกคำตาม spec §10.5 ข้อ 0 — whitespace รวม NUL, comment, literal string (ซ้อน + `\` escape), hex string, name, `<<`/`>>`/`[`/`]` (ลึก ≤ 64), `stream` ข้ามตาม `/Length` ตรงหรือ indirect; `/Length` หาไม่ได้/ไม่ตรง → ตรวจทั้งสองแบบ; จบไฟล์กลาง token/วงเล็บไม่สมดุล → ปฏิเสธ; **ลบ regex `/>>\s*stream\b[\s\S]*?endstream/g` (:203) ออก ไม่มีการตัด payload ด้วย regex เหลือ**
  - `findObfuscatedPdfNames(tokens)`: name token ที่มี `#xx` (ตัวพิมพ์ใดก็ได้) ถอดแล้วเป็น `[A-Za-z0-9]` → ปฏิเสธ `'PDF could not be inspected.'`; escape ที่จำเป็นถอดแล้วเทียบต่อ
  - เทียบชื่อต้องห้ามหลังถอด แบบไม่สนตัวพิมพ์ (ข้อความปฏิเสธเดิม)
  - **คงการตรวจ `<script`/`<svg`/`javascript:`/`vbscript:`/`data:text/html` (:214) แยกจากการแยกคำ (F3)**: ตรวจข้อความโครงสร้างนอก payload **และค่าของ string ทุกตัวหลังถอด** (literal escape/octal, hex string) ที่ตัดอักขระควบคุม/ช่องว่างแล้ว; EICAR ตรวจบนไบต์ทั้งไฟล์เหมือนเดิม
  - `expandPdfObjectStreams(bytes, budget)`: stream ที่ `/Type /ObjStm` → `zlib.inflateSync(payload, { maxOutputLength })`; เพดาน 8 MiB/stream, 32 MiB รวม, ≤ 2,000 ObjStm, ≤ 100,000 obj, ลึก ≤ 64, 2 วิ; filter อื่น/หลาย filter/ขยายไม่ได้ → ปฏิเสธ (P8); เนื้อหาที่ขยายผ่าน `tokenizePdf` + การตรวจชื่อซ้ำ (พบ `stream` ข้างใน → ปฏิเสธ)
  - `inspectAttachmentContent(mimeType, bytes, policy = 'strict')` (async) รวมทุกชั้น; ใน P1 `'receipt'` = `'strict'`
  - **ไม่ใช้ pdf-lib/pdfjs** ในตัวตรวจ (pdf-lib 1.17.1 ถอดเฉพาะ hex ตัวใหญ่และ DecodeStream ไม่มีเพดาน — spec R24)
- Verify: `attachment.logic.spec.ts` แถว ตัวแยกคำ + B1 + URI ของ spec §14 (`/S /URI /URI (javascript:…)`, hex/octal/`\n` แทรก → `'Active content is not allowed in attachments.'`; `(>> stream)` ก่อน catalog, escape/ซ้อน, comment, NUL, `/Length` indirect/ผิด, string ไม่ปิด; ตัวเล็ก/ใหญ่, `/#4fbjStm`, ObjStm ซ่อน action, เกินเพดานต่อ stream/รวม, LZW, ลึก 65, ไฟล์ตัด, `/Arial#20Bold` ไม่ถูกปฏิเสธ, PDF ปกติผ่าน); `pnpm --filter @watchdog-bms/api exec tsx --test src/modules/data-model-core/domain/logic/attachment.logic.spec.ts`

### 1.2 ผู้เรียก 6 จุด + ข้อความ

- `apps/api/src/modules/data-model-core/application/use-cases/complete-attachment-upload.use-case.ts:119` → `await inspectAttachmentContent(mime, bytes, options?.contentPolicy ?? 'strict')` (อาร์กิวเมนต์ที่สาม `options?: { contentPolicy?: 'strict' | 'receipt' }`; controller ทั่วไป [attachment.controller.ts:39](../../apps/api/src/modules/data-model-core/presentation/http/attachment.controller.ts) ไม่ส่ง); เหตุ "ตรวจไม่ได้" → quarantine + audit MEDIUM (ไม่ยิง security event HIGH)
- `apps/api/src/modules/banking/application/use-cases/statement-import.use-case.ts:110`, `apps/api/src/modules/crm-inbox/application/use-cases/process-inbound-line-message.use-case.ts:1545`, `apps/api/src/modules/crm-inbox/application/use-cases/retry-crm-inbox-deliveries.use-case.ts:234`, `apps/api/src/modules/line-ai/application/line-document-qa.service.ts:479, :488`, `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:13157` (**W00 hash**; ข้อความใหม่ → reason `CONTENT_UNINSPECTABLE`) → `await inspectAttachmentContent(…, 'strict')`
- `apps/web/src/common/api/api-error-message.ts`: `'PDF could not be inspected.'` → S18b; `apps/api/src/modules/line-ai/domain/logic/line-file-attempt-answer.logic.ts`: `CONTENT_UNINSPECTABLE` → S18Lb
- Verify: `complete-attachment-upload.use-case.spec.ts`, `process-line-webhook.use-case.spec.ts`, `line-file-attempt-answer.logic.spec.ts`, spec ที่อยู่ในรายการของ statement import/CRM inbox (ตรวจชื่อใน package.json ก่อน); API typecheck (script ของ package); W00 regen (`UPDATE_LINE_AI_CAPABILITY_MANIFEST=1 … line-ai-capability-manifest.spec.ts` แล้วรันซ้ำ); `node scripts/run-line-ai-whole-chain-acceptance.mjs`
- MC7: รัน scanner บน corpus PDF ใบเสร็จจริงของ proof stack + M-14 corpus (`docs/security-evidence/m14-upload-scanner-isolated-corpus.md` — ทุกแถวต้องได้ข้อความเดิม) บันทึกจำนวนที่ถูกปฏิเสธพร้อมเหตุใน memory; ยืนยันพฤติกรรม `maxOutputLength` (test)
- หลักฐานจริง: local stack อัปโหลด PDF อำพรางบนเว็บ 390/1280 (ปฏิเสธ + S18b) และ PDF จริง 3 ไฟล์ (ผ่าน)
- grep ยืนยันว่าไม่มี regex ตัด stream เหลือใน `attachment.logic.ts`
- **Gate P1**: UAT; Production ตามคำสั่งเจ้าของ; แจ้งเจ้าของสเปก receipt-authenticity ให้ rebase

---

## P2 — B2 + อ่าน/ตรวจ e-Tax + B4/B6

### 2.1 ข้อยกเว้น embedded XML (B2/B3)

- `apps/api/package.json`: เพิ่ม `fast-xml-parser` (dependency เท่านั้น); `pnpm-lock.yaml`
- `attachment.logic.ts`: `ETAX_XML_ROOT_NAMESPACES`, `isEtaxXmlDocument`, `inspectPdfEmbeddedFiles` (นับ**ตัวตนที่ไม่ซ้ำ** — Filespec ตาม object number/generation, embedded stream ตาม object ที่ `/EF` ชี้; Filespec เดียวที่อ้างจากทั้ง `Names/EmbeddedFiles` และ `/AF` นับหนึ่ง (F6); stream `/Type /EmbeddedFile` กำพร้า → ปฏิเสธ; รวมที่อยู่ใน ObjStm ที่ขยายแล้ว; 1–2 stream; ขยาย ≤ 3 MiB; ผ่าน `isEtaxXmlDocument`) → `'PDF embedded file is not allowed.'`; `'receipt'` ผ่อนเฉพาะกรณีนี้
- `apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts` (`CompleteReceiptUploadUseCase` ~:361) และ **`apps/api/src/modules/expenses/application/use-cases/expense-capture-group.use-case.ts:527`** (F11) ส่ง `{ contentPolicy: 'receipt' }`; LINE media ใบเสร็จที่ `process-line-webhook.use-case.ts:13157` → `'receipt'`, reason `EMBEDDED_FILE_REJECTED`
- `line-file-attempt-answer.logic.ts`: S18L; `api-error-message.ts`: S18
- Verify: `attachment.logic.spec.ts` (B2 รวม Names+AF นับหนึ่ง, stream กำพร้า), `complete-attachment-upload.use-case.spec.ts`, `expense-capture-group.use-case.spec.ts` (group completion receipt policy), `line-file-attempt-answer.logic.spec.ts`; web test; W00 regen + whole-chain

### 2.2 Schema ผลตรวจ + contracts

- `apps/api/prisma/schema.prisma`: `ElectronicVerificationStatus`, `ElectronicDocumentVerification` (spec §6.6 รวม `etaxIneligibleReason`, `trustStoreVersion`, `recheckAfter`, unique `[companyId, checksumSha256, verifierVersion, trustStoreVersion]` — เขียนด้วย insert `ON CONFLICT DO NOTHING` ครั้งแรก และ **update ในที่** แบบ CAS `checkedAt` เมื่อ `recheckAfter` ผ่าน (P56/F4)), `ExpenseCaptureObservationSource.ELECTRONIC_DOCUMENT` (grep ผู้อ่าน enum ก่อน); migration additive
- `packages/contracts/src/expense-capture.ts` (union 4 ค่า + คอมเมนต์ D09), ใหม่ `packages/contracts/src/expense-email-intake.ts` (evidence DTO + reasons), `index.ts`; คอมเมนต์ `schema.prisma:3386-3387`
- Verify: contracts build, `prisma:validate`, `company-tax-identity-migration.pg.spec.ts` (enum + unique) ผ่าน `test:tax-identity-pg`

### 2.3 ตัวแปลง XML + ตัวตรวจลายมือชื่อ

- ใหม่ `apps/api/src/modules/expenses/domain/logic/etax-xml.logic.ts`: `readEtaxXml` ตาม spec §6.7 — **`CalculatedRate` เปอร์เซ็นต์ → เศษส่วน**, `subtotalAmount = LineTotalAmount`, **`discountAmount` = ผลรวม `HTS/ram:SpecifiedTradeAllowanceCharge[ChargeIndicator=false]/ram:ActualAmount` (หัวบิลเท่านั้น — ไม่ใช้ `AllowanceTotalAmount` ที่รวมส่วนลดรายบรรทัด: ตัวอย่าง ETDA 3,000 = 1,500 + 1,000 + 500 — F4/P38)**, `additionalCharges OTHER` = ผลรวม `[ChargeIndicator=true]` (ไม่ใช้ `ChargeTotalAmount`), บรรทัด `amount = NetLineTotalAmount` และ `unitPrice` เฉพาะบรรทัดที่ไม่มีส่วนลด/ค่าใช้จ่ายรายบรรทัด (อื่น ๆ ต่อท้าย "(หักส่วนลด …)"), `description` ตั้งเสมอด้วยคำกลาง `'รายการตามข้อมูล XML ในไฟล์'`, ตรวจ `LineTotalAmount − ส่วนลดหัวบิล + ค่าใช้จ่ายหัวบิล = TaxBasisTotalAmount` และ `TaxBasis + TaxTotal = GrandTotal`; `extractEtaxXmlFromPdf` ใช้ตัวแยกมีเพดานจาก P1/2.1; `etaxXmlMatchesTextLayer`; **คืน `{ fields, classification }` (F5)** — `BusinessDocumentClassification` ตายตัวจาก TypeCode ตาม spec §6.7 (388/T02–T04 → `TAX_INVOICE`, T05/T06 → `ABBREVIATED_TAX_INVOICE`, T01 → `RECEIPT` PAID + settlement signal, 380 → `SUPPLIER_INVOICE_OR_BILL`, 80/81/T07 → ไม่ apply)
- `apps/api/package.json`: เพิ่ม `pkijs` (+ `asn1js` ถ้าจำเป็น)
- ใหม่ `apps/api/src/modules/expenses/infrastructure/etax-trust/` (PEM + `manifest.json` `{ version, source, fetchedAt, certs:[{ file, sha256, role }], documentSigningEkus: [...], etdaTsa: [{ subject, sha256 }] }`)
- ใหม่ `apps/api/src/modules/expenses/infrastructure/etax-pdf-signature.ts`: `ElectronicDocumentVerifier` — อ่านด้วยตัวแยกมีเพดาน (ไม่ใช้ pdf-lib load); ByteRange เต็มรูป; digest; CMS (pkijs); **KeyUsage/EKU ผู้ลงนาม และ EKU timeStamping critical ของ TSA (R22)**; เวลาที่เชื่อถือได้เท่านั้น; สายไม่ถึง → `UNAVAILABLE CHAIN_NOT_ESTABLISHED`; `etaxCandidate`/`etaxEligible` + **ตรวจ `pdfaid:part=3` ใน XMP และโครงไฟล์แนบ (`/AF`, `/AFRelationship` = `Alternative` เท่านั้น (F5/P1/P36), `text/xml`, XML เดียวนับตามตัวตน Filespec ที่ไม่ซ้ำ (F6))**; `prevRevisionSha256` จาก `/Prev`; ≤ 5 ลายมือชื่อ; 2 วิ; trust anchors inject ผ่าน constructor; คืน `trustStoreVersion` (= `manifest.version`) และ `recheckAfter` (VALIDATION_TIME → `notAfter` ที่เร็วที่สุดในสาย; `VERIFIER_ERROR` → +1 ชม.)
- Verify: `expense-capture-preprocess.logic.spec.ts` (ตัวแปลง รวมอัตรา; **ตัวอย่าง ETDA: 63,050 / ส่วนลด 500 / 62,550 ไม่มี review reason ยอดไม่เข้ากัน**), `expense-document.logic.spec.ts` (ตัวตรวจ รวม EKU, PDF/A-3 profile, `Data`/`Source` → `ATTACHMENT_PROFILE_INVALID`, Names+AF นับหนึ่ง, chain-not-established, `recheckAfter`)

### 2.4 ต่อเข้า completion + runner + apply + B4/B6

- **verification ตอน completion** (F12): `CompleteReceiptUploadUseCase` (ทั้ง primary/supporting) และ capture-group completion หลังเก็บไฟล์ PDF สำเร็จ → `ElectronicDocumentVerifier.verify` (2 วิ) → `saveElectronicVerification` (method ใหม่ใน `apps/api/src/modules/expenses/infrastructure/prisma-expense-capture.repository.ts`: insert `ON CONFLICT DO NOTHING` / update ในที่แบบ CAS `checkedAt` + audit `expense.electronic_verification.changed` เมื่อ status/eligibility เปลี่ยน — spec §6.6); เกินเวลา → คำนวณใหม่ตอนอ่าน (detail, `inputVatDecisionFacts`, runner)
- `apps/api/src/modules/expenses/application/services/expense-capture-read-runner.service.ts`:
  - ใช้แถว verification **ที่ใช้ได้** (spec §6.6: ตรง `verifierVersion` + `trustStoreVersion` ปัจจุบัน และ `recheckAfter` ว่างหรือยังไม่ถึง) ไม่งั้นคำนวณใหม่แล้ว update แถวเดิมในที่ (เวอร์ชันเดิม) หรือ insert (เวอร์ชันใหม่) (F7, P56) — ใช้กติกาเดียวกันใน detail, `inputVatDecisionFacts`, worker อีเมล; group → `electronicVerificationJson`
  - EXPENSE + XML → apply `ETAX_XML` พร้อม `sourceDocumentType`/`ocrDocumentType` = `toSourceDocumentType(sourceDocumentTypeFromClassification(classification))` แบบ :577-578 และ classification ใน observation (F5) → manifest + observation `ELECTRONIC_DOCUMENT` → `finish()` ไม่เรียก admission/gateway
  - **B7 / F2 (blocker BL2 — spec §19)**: `admitOcrRead` (:478-488) เมื่อได้ `duplicate` และ checkpoint ไม่มี `ocrEventId` → helper ใหม่ `findCompanyOcrAdmissionEventId(prisma, { companyId, sourceRoute, requestId })` ใน `apps/api/src/modules/line-ai/application/company-ocr-governance.ts` (อ่าน `CompanyOcrUsageEvent` ด้วย unique key) → ใช้ id นั้น; ไม่พบ → admit ใหม่หนึ่งครั้ง; หลังได้ eventId เรียก `persist` (fenced) ทันทีก่อน provider ครั้งแรก แทน `save()` ที่อยู่แค่ในหน่วยความจำ (:259-261) — persist ไม่สำเร็จ (lease หลุด) → หยุด ไม่เรียก provider และ**ไม่ชดเชย** (เจ้าของใหม่กู้ event เอง); **v2 (ผลตรวจเฉพาะจุด)**: `finish()` กู้ event ด้วย `findCompanyOcrAdmissionEventId(tx, …)` สำหรับ**ทุก**ผลลัพธ์รวมทางออกเร็ว (`attempts_exhausted`, `ownerStillValid` → `CANCELLED` :212, `source_changed`, เปิดไฟล์ไม่ได้, `PAUSED`); release/settle ย้ายเข้า `$transaction` เดียวกับ `updateJobFenced({ db: tx })` + outbox — fence 0 แถว → rollback ไม่ชดเชย; ใน `company-ocr-governance.ts` แยกตัวในเป็น `releaseCompanyOcrAdmissionTx(tx, …)`/`settleCompanyOcrAdmissionTx(tx, …)` (fence event id เดิม :483-484, :551; ตัวเดิมเรียกตัว tx ใน `$transaction` ของมันเอง ผู้เรียกอื่นไม่เปลี่ยน; ตัว tx โยน error แทนกลืน เพื่อให้ finish rollback)
  - **B4 + B6**: `finish()` ห่อ `createObservation({ db: tx })` + `updateJobFenced({ db: tx })` + `PrismaOutboxRepository.append(…, tx)` ใน `$transaction` เดียว; inject `PrismaOutboxRepository`; ลบการกลืน error ของ `storeObservation` (:509-531) — observation ย้ายเข้า finish
- `apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts`: `readSource` + `readAttachmentId`; ข้อความสรุป :815, :861 และ review reason ตามแหล่ง — **ข้อความที่เก็บใช้คำกลาง "ข้อมูล XML ในไฟล์" ไม่ใช้คำว่า e-Tax** (F8); ไม่รับ `categorySuggestion` เมื่อ ETAX_XML
- `expense-upload.use-case.ts:385-393`: replace ลบ `readSource`, `readAttachmentId`
- `apps/api/src/modules/expenses/infrastructure/expense-input-vat-decision.ts:55-57`: fact `verifiedElectronicFile` (หลัก + ประกอบ; เปลี่ยนชื่อจาก `electronicOriginal` เพราะไม่ได้ตรวจสิทธิ์ผู้ออกตาม กฎกระทรวง 384 ข้อ 12 — F1/BL1)
- Verify: `expense-capture-read-runner.service.spec.ts` (XML path + `sourceDocumentType TAX_INVOICE` จาก 388 / T01 ผ่าน gate / 80 ไม่ apply, B4 rollback, B6 observation ล้ม → ไม่ DONE, **B7 เคส (a)–(g) ตาม spec §14**: ตายหลัง admission ก่อน persist → อ่านไม่ได้ผล release / ได้ผล settle หนึ่งครั้ง; persist เสีย lease → ไม่เรียก provider ไม่ชดเชย; checkpoint มี eventId → เดิม; **รอบใหม่จบเร็ว `CANCELLED`/`source_changed`/`attempts_exhausted` → release หนึ่งครั้ง; A เสีย fence หลัง B กู้ event และ settle → A ไม่ release**; ชดเชยล้มใน tx → rollback แล้วชดเชยครั้งเดียวรอบถัดไป), `company-tax-identity-migration.pg.spec.ts` (release/settle ตัว tx ซ้อนใน tx ที่ fenced: fence 0 แถว → `usedCount` ไม่เปลี่ยน; ลำดับ lock ไม่ deadlock กับ admission), `expense-capture-read-status.use-case.spec.ts`, `receipt-ocr-apply.service.spec.ts` (ไม่มีคำ AI/e-Tax ในข้อความที่เก็บ, อัตราไม่ถูกทิ้ง), `expense-document.logic.spec.ts` (trust store เปลี่ยน/`recheckAfter` ผ่าน → คำนวณใหม่), `complete-attachment-upload.use-case.spec.ts` + `expense-upload.use-case.spec.ts` (verification ตอน completion, replace), `prisma-expense.repository.tax-snapshot.spec.ts` (`verifiedElectronicFile` ต้องมี `sourceDocumentType TAX_INVOICE` จาก XML)

### 2.5 แสดงผลบนเว็บ

- `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts`, `domain/models/expense.model.ts`, `packages/contracts/src/expenses.ts`: `electronicEvidence` (จาก checksum ของไฟล์หลักปัจจุบัน; ไฟล์ประกอบที่ eligible ด้วย)
- `apps/web/src/features/expenses/ExpenseReviewPage.tsx` (:1715-1745 + ส่วนหลักฐาน): S13a–g (ป้าย "รูปแบบ e-Tax" — F1), S14/S14b เฉพาะเมื่อไฟล์ `readAttachmentId` เป็น `etaxEligible && VERIFIED` จากแถวที่ใช้ได้ ตอนแสดง ไม่งั้น S14n/S14bn (F8), S15; `ExpenseInputVatRight.tsx:92`: S17 "แนบไฟล์อิเล็กทรอนิกส์ที่ลงนามถูกต้องแล้ว" (ไม่มีคำว่าตัวจริง — F1); `workspace-dictionary.ts`
- Verify: `ExpenseReviewPage.rendered.spec.ts` (S14 vs S14n ตามผลตรวจ), web typecheck/test; หลักฐานจริง 390/1280/~1556 px: e-Tax fixture, ใบเสนอราคาที่ลงนาม (ไม่มีป้าย), ไฟล์ขาด intermediate (S13g), ใบรับรอง EKU ผิด (S13e)
- **Gate P2**: UAT; Production ตามคำสั่งเจ้าของ

---

## P3 — ท่อรับอีเมล (backend) — webhook รอ MC2

### 3.1 Schema + contracts + config

- `schema.prisma`: `EMAIL_INBOUND` (migration แยก), `CompanyEmailIntakeAddress` (+ partial unique), `InboundEmailMessage`, `InboundEmailFile` (รวม `ingestStep`, **`readJobId`**, `targetBranchId`, `stampPrevRevisionSha256`), `EmailIntakeSender` + enum (spec §6.2–6.5; `InboundEmailFile.acceptedAt`, `autoSlotReservedAt` (F8), `dataPurgeAfter` + index (F7); `InboundEmailMessage.purgeAfter` ตั้งเฉพาะเมื่อไม่มีไฟล์ผูกรายจ่าย); **raw SQL partial unique index `ExpenseCaptureReadJob ("companyId", "ocrAdmissionRequestId") WHERE "ocrAdmissionRequestId" LIKE 'email-intake:%'`** (F2)
- `packages/contracts/src/expenses.ts:59` + `expense-email-intake.ts` (DTO ที่เหลือ)
- `packages/config/src/index.ts` (**W00 hash**) 4 ค่า + refine; `app-config.service.ts`
- `infra/postmark/config.py:12-14`: `ENV_KEYS` (+`EMAIL_INTAKE_DOMAIN`, `POSTMARK_INBOUND_STREAM`), `SECRET_KEYS`/`REQUIRED_SECRETS` (+ inbound webhook username/password), โดเมนต่อสภาพแวดล้อม (Q5), `native_preflight` ตรวจ inbound แบบอ่านอย่างเดียว; `infra/postmark/config_test.py`; ตรวจ `infra/kamal/release.py`, `infra/prod-ecs-express/deploy.sh`
- Verify: contracts build, `prisma:validate`, `packages/config` test, `python3 infra/postmark/config_test.py`, `company-tax-identity-migration.pg.spec.ts` (one ACTIVE, localPart, provider+messageId, cascade, partial unique `email-intake:` ชน → P2002 และแถว UUID เดิมไม่ชน); W00 regen

### 3.2 Webhook ขาเข้า

- ใหม่ `apps/api/src/modules/expenses/domain/logic/email-intake.logic.ts` (pure): parse, route (OriginalRecipient เท่านั้น), auth signals, headers, ชื่อไฟล์, `stampSubjectKey`, triage, `decideFile` (spec §9.2), ผู้ได้รับแจ้งเรื่องพัก, เพดาน (spec §7.2)
- ใหม่ `apps/api/src/modules/expenses/infrastructure/prisma-email-intake.repository.ts`: create ข้อความ+ไฟล์ใน tx เดียว ใต้ advisory lock **ตามลำดับ (1) `email-intake-company:${companyId}` (2) `email-intake-address:${addressId}:${intakeDay}`** (F10) ตรวจเพดานข้อความ/ไบต์/ผู้ส่ง และไบต์ที่พักของบริษัท → เกิน DISCARDED `INTAKE_LIMIT` ไม่มีไบต์; replay; claim/lease; CAS `ingestStep`; purge (จับ lock บริษัทก่อนลด `storedBytes`)
- `apps/api/src/common/middleware/provider-events-body.middleware.ts`: `POSTMARK_INBOUND_PATH` + `postmarkInboundJson` (ข้อความตายตัว แบบ :14-21); `apps/api/src/main.ts:80-93` ใช้ก่อน parser กลาง
- ใหม่ `apps/api/src/modules/expenses/application/services/email-intake-inbound.service.ts` + `presentation/http/postmark-inbound.controller.ts` (`@Public()`, Basic Auth timing-safe, ตาราง HTTP spec §7.2) + `expenses.module.ts`; `auth.guard.ts:166` + `postmark-inbound`
- Verify: `expense-upload.use-case.spec.ts` (logic pure), `auth-endpoints.spec.ts`, `auth.guard.spec.ts`, `company-tax-identity-migration.pg.spec.ts` (สองคำขอคร่อมเที่ยงคืน/ต่างที่อยู่ → ไบต์บริษัทรวมไม่เกิน)

### 3.3 ตัวประมวลผล (worker)

- `expense-upload.use-case.ts`: `emailCapture` (จองรายจ่ายก่อนแบบ LINE, `draftIdempotencyKey`, attachment ใต้ lock `email-receipt-attachment:${expenseId}` + `createIntent.resume`, complete resume ครอบ `EMAIL_INBOUND`)
- `prisma-expense-capture.repository.ts`: ใหม่ `findAnyJobForAttachment(tx, …)` (ทุกสถานะ) และ `createReadJob` รับ `tx` + `ocrAdmissionRequestId` จากผู้เรียก — **ไม่แก้** `findLiveJobForAttachment` (:300-311) และ `queueExpenseRead` ที่ผู้เรียกอื่นใช้
- ใหม่ `apps/api/src/modules/expenses/application/services/email-intake-processor.service.ts`: claim → จัดผู้ส่ง (`resolveAccess`, `canForwardEmail`) → คัดไฟล์ (`inspectAttachmentContent('receipt')`, ClamAV, ซ้ำยกเว้น `email:${fileId}`, verify, จับคู่ spec §9.3) → ตัดสิน → **จองช่อง auto (F8)**: tx ใต้ `pg_advisory_xact_lock(hashtext('email-intake-auto:' || addressId || ':' || intakeDay))`, มี `autoSlotReservedAt` แล้วใช้ต่อ, ไม่มีนับ < 50 แล้วตั้ง, ครบ → `HELD DAILY_LIMIT`; ไฟล์ที่คนกดรับไม่ใช้ช่อง → **ซ้ำ (F6)**: `DUPLICATE` เก็บ `expenseId` ภายใน DTO ส่งเฉพาะเมื่อผู้ดูผ่าน `canReadExpense` (ไม่งั้น S11t3) → **สถานะข้อความสรุปจากไฟล์ใน tx เดียวกับทุกการเปลี่ยนของไฟล์ (F7, spec §9.2)** → เดิน `ingestStep` ด้วย CAS; **ขั้น READ_QUEUED เป็น transaction เดียวที่ fenced (F2/P6/P35 — spec §7.5)**: `SELECT … FOR UPDATE` แถวไฟล์ → ยืนยัน `ingestStep = COMPLETED` + lease ยังเป็นของ worker นี้ → `findAnyJobForAttachment(tx)` → ไม่มี `createReadJob(tx, { ocrAdmissionRequestId: 'email-intake:' + fileId })` (ไม่เรียก `queueExpenseRead` ที่สร้าง UUID — `expense-capture-line.use-case.ts:71-83`) → เขียน `READ_QUEUED` + `readJobId` + `data=null` → commit แล้วค่อย `runner.kick`; ชั้นที่สอง partial unique index + admission ใช้ requestId เดียวกันจึงตอบ duplicate; ปล่อย AWAITING_STAMP 48 ชม.; ฉบับประทับเวลามาทีหลัง (replace/append); purge **รายไฟล์** (`dataPurgeAfter` → `data = null`) และลบแถวข้อความเฉพาะเมื่อไม่มีไฟล์ผูกรายจ่าย (F7)
- `expense-capture-auto-split.service.ts:182,216`: คง `EMAIL_INBOUND`
- ใหม่ `presentation/http/email-intake-internal.controller.ts` (`internal/expenses/email-intake/drain`), ใหม่ `apps/workers/src/modules/email-intake/email-intake-worker.ts` (30 วิ) + `apps/workers/src/main.ts`
- Verify: `expense-upload.use-case.spec.ts` (crash ทุกขั้น; crash หลังสร้างงานก่อน READ_QUEUED แล้วงานจบ → admission ครั้งเดียว; **worker สองตัวทับซ้อนหลัง lease หมด → งานอ่านหนึ่งงาน admission หนึ่งครั้ง**; DRAFT_DELETED; จับคู่ต่างผู้ขายไม่จับ; ฉบับประทับเวลามาทีหลัง; **F6** ซ้ำกับรายจ่ายที่ผู้ส่งต่ออ่านไม่ได้ → ไม่มี `expenseId` + S11t3; **F7** ข้อความผสม STORED + HELD → HELD, ไม่รับ → DONE, purge คงหัวอีเมลของไฟล์ที่ผูกรายจ่าย; **F8** จองช่องซ้ำหลัง restart ไม่นับซ้ำ), `company-tax-identity-migration.pg.spec.ts` (สอง worker แข่งบนฐานจริง: row lock + partial unique → งานอ่านหนึ่งแถว, CAS, purge; **สองข้อความเห็น 49 ช่อง → ช่องที่ 50 ได้ตัวเดียว (F8)**; verification insert แข่ง → แถวเดียว / update ในที่ไม่ P2002 (P56)); local: curl payload สังเคราะห์ + Basic Auth

---

## P4 — หน้าเว็บและ API จัดการ

### 4.1 สิทธิ์ + gate แท็บ

- `apps/api/src/modules/auth/permission-registry.ts` (:704, :921), `apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts:285`, `packages/contracts/src/feature-entitlements.ts:85-90` (**W00 hash**)
- `apps/web/src/features/expenses/expenses.model.ts:1599, :1805`: `canManageEmailIntake`, `isEmailIntakeHandler`, **`canForwardEmail`** → gate upload = `canUploadReceipts || canManageEmailIntake || isEmailIntakeHandler || canForwardEmail` (P24/P25); พื้นที่อัปโหลดเดิมแสดงเฉพาะ `canUploadReceipts`; `web-core-workspace/route-permissions.ts` ตรวจทีละไฟล์
- Verify: `permission-registry.spec.ts`, `role-template-system-role-parity.spec.ts`, `feature-gate.logic.spec.ts`, `capability.logic.spec.ts`, web spec ของ `expenses.model`; W00 regen

### 4.2 API จัดการ

- ใหม่ `apps/api/src/modules/expenses/application/use-cases/email-intake-address.use-case.ts`, `email-intake-held.use-case.ts` (สมาชิกเห็น/รับเข้าของตัวเองได้; accept tx เดียวบันทึก `targetBranchId`/`acceptedByUserId`/`acceptedAt`); **`decideFile` ใน `email-intake.logic.ts` รับ `accepted` แล้วข้ามเหตุพักตามตาราง override ใน spec §9.2 (F3) — ความปลอดภัยไฟล์ไม่ข้าม, `HANDLER_UNAVAILABLE` ตรวจผู้กดรับซ้ำ, `trustSender=false` ไม่เปลี่ยนผู้ส่งเป็น TRUSTED**, `presentation/http/email-intake.controller.ts` + DTO (ก่อน `@Get(':expenseId')`); launch gate แบบ `assertExpenseRootOpen` (`expense-upload.use-case.ts:78`)
- Verify: `expense-capture-group.use-case.spec.ts` (use-case ที่อยู่/พัก), `expense-upload.use-case.spec.ts` (`NEW_SENDER` + รับเข้า `trustSender=false` → ร่าง ไม่กลับ HELD; ฉบับถัดไปยังพัก; ผู้กดรับเสียสิทธิ์ → `HANDLER_UNAVAILABLE`), `company-tax-identity-migration.pg.spec.ts` (rotate tx เดียว)

### 4.3 หน้าเว็บ

- ใหม่ `apps/web/src/features/expenses/EmailIntakeCard.tsx` (S1–S12 รวม S11t3 และ S12 ที่สัญญาเฉพาะสำเนาในร้าน — F6/F11, C1–C9, C6h); `expenses.api.ts`; `expenses.model.ts:993-998` (`EMAIL_INBOUND: 'อีเมล'`); `ExpensesPages.tsx:3491` (grid `lg`; ไม่มีพื้นที่อัปโหลด → การ์ดเต็มกว้าง); `workspace-dictionary.ts`
- Verify: ใหม่ `EmailIntakeCard.spec.ts`, web typecheck/test; **หลักฐานจริง** 390/1280/~1556 px ผู้ใช้ 4 แบบ (manage อย่างเดียว, ผู้รับ, สมาชิกส่งต่อ, LINE-upload อย่างเดียว), วัดปุ่ม, journey + ทางผิด

---

## P5 — แจ้งเตือน, LINE, help pack v7

### 5.1 แจ้งเตือน

- `apps/api/src/modules/dashboard-notifications/domain/models/notification.model.ts:134,205,250`: 4 trigger → `['expenses']`
- ใหม่ `apps/api/src/modules/expenses/application/services/email-intake-notifier.service.ts`: ตัวตนเดียว `inbound_email_message` + `sourceRefs[0]` รายจ่าย; ผู้รับตาม spec §9.2; S26 ต่อวัน
- **predicate อ่านรายจ่ายกลาง** (F8/P11): แยกตรรกะ [expense-draft.use-case.ts:225-241](../../apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts) เป็นฟังก์ชัน `canReadExpense(ctx, expense)` (ไฟล์ domain logic ของ expenses) ที่ use case เดิมและ guard แจ้งเตือนใช้ร่วม — use case เดิมพฤติกรรมไม่เปลี่ยน
- `apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts` (:497-524 + `ListNotificationsUseCase`): hook สำหรับ trigger `expense.email_*` — resolve ctx ผู้รับใหม่ แล้ว `canReadExpense` (+ ขอบเขตสาขา) หรือยังเป็น manage/ผู้รับ/เจ้าของข้อความสำหรับเรื่องพัก + แหล่งยังอยู่ → ไม่ผ่าน `SUPPRESSED`/ซ่อน; **`GetUnreadCountUseCase` (:47-54) ใช้ guard เดียวกันกับ event `expense.email_*` — recipient ที่ไม่ผ่านถูกตั้ง `dismissedAt` โดยระบบตอนอ่าน/นับ จึงไม่ค้างในตัวเลขกระดิ่ง** (F11)
- **"ยังรออยู่" (F9)**: trigger `expense.email_held` (ACTION, sourceType `inbound_email_message`) — `apps/api/src/modules/dashboard-notifications/infrastructure/waiting-notification.ts` (`ACTIONS` + sourceType ใน `waitingNoticeKey` + คำสถานะใน `documentStateWords` + "รอรับเข้า" ใน `finishedNoticeTitle` → S20r); `document-notification-state.ts` (`DOCUMENT_NOTIFICATION_STATES` `{ sourceType: 'inbound_email_message', statuses: ['HELD'] }` + โหลดแถวข้อความใน `completedDocumentNotificationIds`); filter `waiting` ที่ `prisma-notification.repository.ts:141` ใช้ `WAITING_NOTICE_TRIGGERS` จึงเห็นเอง; trigger อื่นสามตัว (`expense.email_document_ready`, `expense.email_file_rejected`, `expense.email_limit_reached`) ไม่ใช่งานที่ต้องทำ จึงไม่อยู่ใน "ยังรออยู่"
- Verify: `dashboard-notification-correctness.spec.ts` (รวมผู้รับที่มีแค่ upload + เป็นผู้สร้าง → ได้แจ้ง; เสียสิทธิ์ → หายจากรายการ **และตัวเลขยังไม่อ่านลด**), `expense-related-access.use-case.spec.ts` (อยู่ในรายการ) ว่าพฤติกรรมการอ่านรายจ่ายเดิมไม่เปลี่ยนหลังแยกฟังก์ชัน; `dashboard-notification-correctness.spec.ts` (F9: เรื่องพักอยู่ใน `waiting` แม้อ่านแล้ว หายเมื่อรับเข้า/ไม่รับ/purge, หัว S20r)

### 5.2 LINE

- `line-capture-result-notifier.use-case.ts:140` (EMAIL_INBOUND → notifier, ครั้งเดียวต่อข้อความ, ไม่แจ้งไฟล์จากการกดรับเข้า), `expense-capture-line.use-case.ts:99` (คืน `captureSource`)
- `notification.use-cases.ts:551,656`: ปุ่ม [ดูในแชต] [เปิดในเว็บ]; **ข้อความแจ้งสมาชิกเลือก S21b/S21c/S21d ตาม `expense.confirm`/`expense.update`/ไม่มีทั้งสอง ที่ resolve ใหม่ตอนส่ง (กติกาเดียวกับ `line-expense-action.service.ts:1009-1012` — F9); S21d ไม่มี [ดูในแชต]**; S20c ใช้ลิงก์ handoff เข้าเว็บ (`LineHandoffLinkService`)
- ใหม่ `apps/api/src/modules/line-ai/domain/logic/line-email-intake-control.logic.ts`; `process-line-webhook.use-case.ts` (**W00 hash**) control `expense_email_open`; `line-business-card.logic.ts` S25/S25n ตามผลตรวจตอนสร้างการ์ด (F8)
- Verify: `line-capture-result-notifier.use-case.spec.ts` (S21b/c/d ตามสิทธิ์), `process-line-webhook.use-case.spec.ts`, `line-business-card.logic.spec.ts` (S25 vs S25n); W00 regen; whole-chain

### 5.3 Help pack v7 แยกจาก v6 (F9/P28)

- ใหม่ `apps/web/src/features/user-guide/email-intake-guide.content.ts`: `withEmailIntakeGuide(guide, companyId, session)` เพิ่มส่วน `email-intake` (S24 + S27 ระยะเก็บของผู้ให้บริการจากค่าคงที่ `EMAIL_PROVIDER_RETENTION_DAYS` — F11) — ประกอบใน `apps/web/app/(workspace)/companies/[companyId]/user-guide/expenses/page.tsx:19` แบบ `withDisbursementVoucherGuide`; **`expenses-guide.content.ts` ไม่แตะ** (hash ของการ์ด v6 คงเดิม)
- `apps/ai-gateway/src/modules/line-ai/agents/product-help-draft-cards.ts`: array ใหม่ `V7_PRODUCT_HELP_CARDS` (การ์ด `expense.email-intake`, **`requiredPermissions: ['attachment.create']` + `permissionAnyOf: ['expense.receipt.upload', 'expense.receipt.line_upload', 'expense.email_intake.manage']`** (โมเดลการ์ดรองรับ AND + any-of — `approved-knowledge.ts:113-114`, F10; spec §10.3 S24), `featureKeys: ['expenses']`, sourceFile = ไฟล์คู่มือใหม่ + hash) — **ไม่ใส่ใน `NEW_PRODUCT_HELP_CARDS`** ที่ v6 ใช้
- `apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts` (**W00 hash**): key ใหม่ใน `sources`; `PRODUCT_HELP_V7_PACK = { ...PRODUCT_HELP_DRAFT_PACK, version: 7, status: 'DRAFT', cards: [...v6 cards, ...V7_PRODUCT_HELP_CARDS] }`; `activeProductHelpPack()` = v7 ถ้า APPROVED, ไม่งั้น v6 ถ้า APPROVED, ไม่งั้น base
- เจ้าของอนุมัติ v7 (MC9) → คอมมิตแยกเปลี่ยนสถานะ/reviewers
- `scripts/line-ai-whole-chain-acceptance.catalog.mjs`: scenario `email-document-line-follow-up` (fixture `repository`, assertions 4 คีย์ — `mutation` ต้องเข้า pattern ที่ catalog spec :70 เช่น `zero_final_mutation`, `evidence` = ไฟล์ + ชื่อ test ใน `line-capture-result-notifier.use-case.spec.ts` ที่อยู่ใน `LINE_AI_WHOLE_CHAIN_SUITES` — เพิ่มไฟล์นั้นใน suite ถ้ายังไม่อยู่); **`scripts/line-ai-whole-chain-acceptance-catalog.spec.mjs`: เพิ่ม id ท้าย `EXPECTED_IDS` (:12-37)** — ไม่งั้น assert :40 ล้ม (F12)
- Verify: `agent-tools.registry.spec.ts`, `approved-knowledge.spec.ts` (hash ไฟล์ตรง, v6 ไม่เปลี่ยน, v7 ไม่ active จนอนุมัติ, S24 ตามสิทธิ์: `attachment.create` + `line_upload` ได้ / `line_upload` อย่างเดียวไม่ได้), W00 parity, `node --test scripts/line-ai-whole-chain-acceptance-catalog.spec.mjs`, whole-chain

---

## P6 — Export, รายงาน, seed, journey, ops

### 6.1 Export + รายงานผู้บริหาร

- `apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts:90-104`: `EMAIL_INBOUND: 'EMAIL'`; **คอลัมน์ `electronic_evidence_status` (F10)**: `packages/contracts/src/expenses.ts` เพิ่มใน `ACCOUNTANT_INDEX_COLUMNS` (:1731, ชุด full เท่านั้น ไม่ใส่ `ACCOUNTANT_INDEX_SUMMARY_COLUMNS`) + ป้าย "ผลตรวจไฟล์อิเล็กทรอนิกส์" ใน `ACCOUNTANT_INDEX_COLUMN_LABELS` (:1802); ค่าห้าแบบตาม spec §11 (ไม่มีคำว่าตัวจริง); header เดิม `expense-export.logic.ts:214`; ตำแหน่งใน workbook ใหม่ตาม MC15 (ประสาน `docs/specs/accountant-export-cleanup-spec.md`); `apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts:483`
- รายงานผู้บริหาร: `schema.prisma` `ExecutiveCompanyMonth` (:4185-4186) + 2 คอลัมน์ (migration additive); `apps/api/src/modules/executive-business/application/executive-report-build.use-case.ts:105,121,373,402-404`; `domain/executive-read.logic.ts:14-15`; `domain/executive-report.logic.ts`; `application/executive-report-read.service.ts`; `packages/contracts/src/executive-business.ts:356`
- Verify: `expense-export.logic.spec.ts` (คอลัมน์อยู่ใน full ไม่อยู่ใน summary, ค่าห้าแบบ, header ไทย); executive **ตามที่เจ้าของเลือกใน MC12** — ถ้า (ก): เคสใหม่ใน PG spec เดิม `apps/api/src/modules/executive-business/executive-report-build.pg.spec.ts` (ตัวนับ `EMAIL_INBOUND`) และ `executive-report-read.pg.spec.ts` (อ่านกลับ) — รันในเครื่อง `EXECUTIVE_REPORT_BUILD_TEST_DATABASE_URL=… pnpm --filter @watchdog-bms/api exec tsx --test src/modules/executive-business/executive-report-build.pg.spec.ts` (และ READ แบบเดียวกัน ตาม `.github/workflows/ci.yml:810-815`); บันทึกจำนวน test ที่รัน (> 0, skip 0) เพราะ spec skip เมื่อไม่มีตัวแปร; ถ้า (ข): ไม่แตะ executive ในงานนี้ และบันทึกผลที่ลูกค้าเห็น (ใบเสร็จทางอีเมลไม่นับ, ที่ยืนยันแล้วนับเป็นเว็บ) ใน backlog

### 6.2 Seed + journey

- `apps/api/prisma/seed-expenses.ts`: ที่อยู่ + ข้อความพัก + e-Tax สังเคราะห์ (CA ทดสอบของ proof stack)
- ใหม่ `e2e/journeys/supplier-etax-by-email.journey.spec.ts` (390/1280/~1556 px, POST webhook สังเคราะห์, วัดปุ่ม)
- Verify: รันบน proof stack (reset DB) — บันทึกผลจริง

### 6.3 Ops + เอกสาร (ต้องได้รับอนุมัติก่อนแตะ cloud)

- `docs/runbooks/postmark-environment-activation.md`: inbound (แผน Pro+, stream, MX `inbound.postmarkapp.com` priority 10, webhook URL Basic Auth, ผล MC2/MC10, retention ระดับบัญชี, **ไม่แปลงการบล็อกของร้านเป็น inbound rule ของ Postmark** — ใช้เฉพาะการต่อต้านการละเมิดระดับแพลตฟอร์มที่อนุมัติแยก)
- `infra/postmark/config.json`: ค่า/secret refs ใหม่ (ห้ามใส่ค่าจริง)
- `docs/legal-review/mangmeeplus-pdpa-external-completion-guide-th.md`: ROPA + Postmark inbound (ไฟล์แนบใน Raw Source) + ระยะเก็บ
- backlog #12 + memory; UAT ตาม `docs/runbooks/uat-production-v2-deployment.md`; Production ตามคำสั่งเจ้าของ

## การตัดสินใจที่ล็อกแล้ว (อย่ารื้อโดยไม่บันทึก)

1. B1 เป็นงานแรก ปล่อยเดี่ยว ทุกผู้เรียก 6 จุด; ตัวตรวจไม่ใช้ pdf-lib/pdfjs และ**ไม่ใช้ regex ตัด stream payload** — ตัวแยกคำแบบมีเพดาน (string/comment/NUL/`/Length` สองแบบ); ปฏิเสธชื่ออำพราง (escape ตัวอักษร/ตัวเลข ทุกตัวพิมพ์), ขยาย ObjStm ด้วย `zlib maxOutputLength` แบบมีเพดาน, ตรวจไม่ได้ = ปฏิเสธ
2. Postmark inbound (แผน Pro+) ไม่ใช่ SES; tenant จาก `OriginalRecipient`; ผู้ส่งยืนยันด้วย `DKIM_VALID_AU`
3. ลายมือชื่อถูกต้อง ≠ ตรงรูปแบบ e-Tax ≠ ผู้ออกมีสิทธิ์ (ไม่ตรวจรายชื่อ กฎกระทรวง 384 ข้อ 12 — ถ้อยคำ/fact/export บอกเฉพาะคุณสมบัติไฟล์, BL1): eligibility ต้องมี `pdfaid:part=3` + โครงไฟล์แนบ + TypeCode + เลขผู้ขาย; ตรวจ KeyUsage/EKU ผู้ลงนามและ TSA; ไม่ใช้ `signingTime`; ยืนยันสายไม่ได้ = UNAVAILABLE ไม่ใช่ FAILED
4. ผลตรวจผูก checksum และคำนวณตอน completion ของทุกไฟล์ใบเสร็จ PDF (หลัก/ประกอบ/group)
5. `finish()` เขียน observation + สถานะ + outbox ใน transaction เดียว (แก้ B4, B6)
6. รับเข้าอีเมลเป็นขั้นที่บันทึก; READ_QUEUED = ค้นงานทุกสถานะ + สร้างงาน + บันทึก `readJobId` ใน transaction เดียวที่ fenced ด้วย row lock + lease; requestId `email-intake:<fileId>` + partial unique index — งานอ่านและ OCR admission ต่อไฟล์หนึ่งครั้ง
7. จับคู่ Time Stamp ผูกผู้ออก+เอกสาร; ไม่ลบไบต์ทันที; 48 ชม. เป็นการตัดสินใจของผลิตภัณฑ์
8. เพดานก่อนเก็บใต้ lock บริษัทแล้วตามด้วย lock ที่อยู่/วัน
9. ข้อยกเว้น embedded XML เฉพาะ `'receipt'` (ใบเสร็จ, capture group, LINE ใบเสร็จ, อีเมล)
10. แผนที่ XML: อัตราเปอร์เซ็นต์ → เศษส่วน; subtotal = `LineTotalAmount`; ส่วนลด = ผลรวม `SpecifiedTradeAllowanceCharge[ChargeIndicator=false]` ระดับหัวบิล (**ไม่ใช่** `AllowanceTotalAmount` ซึ่งรวมส่วนลดรายบรรทัดตามตัวอย่าง ETDA); ค่าใช้จ่ายหัวบิลจาก `[ChargeIndicator=true]`
11. แจ้งเตือนใช้ predicate อ่านรายจ่ายกลางที่แยกออกจาก `expense-draft.use-case.ts:225-241`
12. Help pack v7 แยกจาก v6 (ไฟล์คู่มือใหม่ + array ใหม่); v6 ไม่เปลี่ยน
13. สมาชิกที่มี `line_upload` เปิดแท็บอัปโหลดเพื่อดูการ์ดและเรื่องพักของตัวเองได้
14. ไม่แปลงการบล็อกของร้านเป็นกฎ Postmark
15. ไม่เพิ่มคอลัมน์ใน `ExpenseRecord`; executive เพิ่ม 2 คอลัมน์
16. PG invariant ใน `company-tax-identity-migration.pg.spec.ts`; ที่อยู่เคส test executive เป็นการตัดสินของเจ้าของ (MC12) — ยังไม่ล็อก
17. ไม่ตอบอีเมลผู้ส่ง ไม่เก็บเนื้อหาอีเมล ไม่ส่งหัวเรื่อง/เนื้อหาให้ AI; ไม่แก้ `expense.list_recent`
18. B5 ไม่แก้ในงานนี้
19. การกดรับเข้าเป็น override ของข้อความนั้นครั้งเดียวตามตาราง spec §9.2 — ไม่ข้ามการตรวจความปลอดภัย ไม่ทำให้ผู้ส่ง TRUSTED เอง
20. คำว่า "e-Tax" ในหน้าจอ/LINE ใช้เฉพาะไฟล์ที่ `etaxEligible && VERIFIED` จากแถวที่ใช้ได้ ตอนแสดง; ข้อความที่เก็บใช้คำกลาง "ข้อมูล XML"
21. แถว verification ใช้ได้เมื่อตรง `verifierVersion` + `trustStoreVersion` และยังไม่ถึง `recheckAfter`; ไม่งั้นคำนวณใหม่ — เวอร์ชันเดิม update ในที่ (CAS `checkedAt`), เวอร์ชันใหม่ insert; ไม่มีการ insert แถวซ้ำใต้ key เดิม
22. `/AFRelationship` ของ XML ต้องเป็น `Alternative`; นับไฟล์แนบตามตัวตนที่ไม่ซ้ำ
23. ข้อความ LINE ถึงสมาชิกบอกเฉพาะการกระทำที่ผู้รับทำได้ (S21b/c/d); การ์ด S24 = `attachment.create` AND any-of สามสิทธิ์
24. ทุกงานอ่านที่ได้ OCR admission จบด้วย release หรือ settle หนึ่งครั้ง โดยผู้ถือ lease ที่ commit สถานะสุดท้ายเท่านั้น — กู้ eventId จาก unique key ก่อนทุกทางออก, persist ก่อน provider, ชดเชยใน tx เดียวกับ terminal write แบบ fenced (B7, BL2 v2 — ยังรอทบทวน)
25. การตรวจ URI/สคริปต์เดิม (`javascript:` ฯลฯ) คงอยู่และตรวจค่าของ string ที่ถอดแล้วด้วย (F3)
26. สถานะข้อความสรุปจากไฟล์; purge รายไฟล์; หัวอีเมลของไฟล์ที่ผูกรายจ่ายเก็บตามรายจ่าย (F7)
27. ช่อง auto ต่อ (ที่อยู่, วัน) จองแบบ atomic + idempotent ด้วย `autoSlotReservedAt` (F8)
28. ไฟล์ซ้ำ: ให้ลิงก์/รหัสรายการเดิมเฉพาะผู้ที่อ่านรายการนั้นได้ (F6)
29. คำว่า "ลบภายใน 30 วัน" ใช้กับสำเนาในร้าน; ระยะเก็บของผู้ให้บริการบอกแยก (S27, F11)
