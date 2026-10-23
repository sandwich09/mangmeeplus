# Receipt Authenticity Signals Plan

Status: READY (docs-first) — reviewed 4 rounds 2026-10-24, no HIGH open; see ต้องปิดก่อนเขียนโค้ด (spec §18, MC1–MC13)
Owner: Expense/Reimbursement lane
Related: `docs/specs/receipt-authenticity-signals-spec.md`, `docs/agent-memory/receipt-authenticity-signals.md`, backlog `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md` (#8)
Baseline: main 6c54ba208 (2026-10-23)
หลักการ: ponytail full — ใช้ของเดิม (sharp, pdf-lib, Node `zlib`/`worker_threads`, `thaiTaxIdChecksumValid`, `approvalDecisionActions`, แบบ buyer-match + audit, การ์ด LINE เดิม), ไม่มี abstraction ใหม่, dependency ใหม่ตัวเดียว (`jsqr`) อยู่ Phase 4, ไม่มีสวิตช์

## ลำดับและการพึ่งกัน

```
Phase D-B8 (ลบไฟล์ข้ามสาขา — ส่งเดี่ยวได้ ทำก่อนสุด)
Phase D-B4 (ช่องโหว่ completion) + D-P1 (ที่มาการอ่านทาง LINE ก่อน Phase 2) ──▶ Phase 1 (เก็บข้อเท็จจริงไฟล์) ──▶ Phase 2a (derive + review table + API รายจ่าย)
  ──▶ Phase 2b (API ใบเบิก) ──▶ Phase 3 (เว็บ + LINE + journey) ──▶ Phase 4 (สลิป QR, ต้องมี Phase 0)
Phase D-B1/B2/B3/B5/B6/B7 อิสระ; D-B8 อิสระและส่งได้เดี่ยว (B5 ควรมาก่อน Phase 4 เพราะแตะ completion ทาง LINE; B7 ก่อนคาดหวังกลุ่ม C บน PDF)
Phase H (help card) ต้องรอเจ้าของอนุมัติชุดคู่มือ ไม่บล็อกอะไร (H.0 แช่ v6 เป็น fallback ทำได้ทันที)
```

Phase 1–2 ไม่มี UI ขึ้นระบบได้โดยผู้ใช้ไม่เห็นความต่าง

การตรวจทุกขั้น (owner directive: typecheck + focused specs; ไม่ trigger GitHub Actions):
- API typecheck ผ่าน package script ที่มี heap flag (ห้าม `tsc --noEmit` เปล่า) และอ่าน exit code จริง
- focused spec: `pnpm --filter @watchdog-bms/api exec tsx --test <ไฟล์>` เขียน path ทีละไฟล์ (ห้ามตัวแปร zsh ที่ไม่ split) แล้วดูจำนวน test ที่รันจริง
- หลัง merge develop ใน worktree ให้ `prisma generate` ใหม่
- migration: local Postgres `:15432` (`prisma migrate deploy` แล้ว `migrate status` สะอาด)
- หน้าจอ: เปิดจริงที่ **390, 1280 และ ~1,556 px** (มาตรฐาน `docs/guidelines/thai-ux-standard.md:77, 114`) ทุก dialog ด้วยข้อมูลไทย บันทึกในหน่วยความจำว่ากดอะไร

---

## Phase 0 — Fixture และการวัด (ไม่มีโค้ดผลิตภัณฑ์)

| ขั้น | งาน | ผลที่ต้องได้ |
|---|---|---|
| 0.1 | ขอสลิปจริงของเจ้าของ 1–2 ใบต่อธนาคารที่ใช้ (KBank 004, SCB 014, BBL 002, KTB 006, BAY 025 ฯลฯ) ดูบนเครื่อง ไม่ commit | ธนาคาร → เลขที่พิมพ์ = transRef ใน QR ไหม (เติม `SLIP_PRINTED_REF_IS_QR_REF_BANKS`) |
| 0.2 | ส่งสลิปเดียวกันผ่าน LINE (รูปปกติ) เข้า local proof stack แล้วลอง decode QR จากไบต์ที่ได้ | jsQR อ่านได้หลัง LINE บีบอัดหรือไม่ |
| 0.3 | วัด jsQR ใน worker บนภาพ 1,200 px 20 ภาพ และ event-loop delay ของ parser Phase 1 บนไฟล์ 10 MB | QR p95 < 500 ms; parser ไม่ทำให้ event loop ค้าง > 50 ms (ถ้าเกิน ย้าย parser ไป worker เดียวกัน) |
| 0.4 | สร้าง fixture C2PA จริงขนาดเล็กด้วย c2patool บนเครื่อง dev (ไม่ใช่ dependency): JPEG หลาย APP11, PNG `caBX`, แบบ `brob`, มี `c2pa.ai-disclosure`, มี digitalSourceType แต่ละค่าใน actions, ไม่มีคำ AI, **custom metadata assertion ที่ caption ยก URI `trainedAlgorithmicMedia` (ต้องไม่เกิดข้อสังเกต)**, digitalSourceType อยู่แค่ใน ingredient, **template ชุดต่าง ๆ ตามตัวอย่าง spec §6.2 (R3-F1)** | ไฟล์ fixture + บันทึกที่มา/เวอร์ชันเครื่องมือ (ปิด MC3) |

Fixture QR สร้างแบบสังเคราะห์ด้วย `qrcode-generator` (dependency เดิมของ API) + sharp — ไม่มีข้อมูลลูกค้าจริงใน repo

---

## Phase D — แก้ bug ที่พบ (D-B8 และ D-B4 ก่อน Phase 1; ที่เหลืออิสระ)

| ขั้น | ไฟล์ | งาน | test (ไฟล์ลงทะเบียนแล้ว) |
|---|---|---|---|
| D-B8 (R3-F2) | `apps/api/src/modules/data-model-core/application/use-cases/delete-attachment.use-case.ts` | หลังโหลดไฟล์ (บรรทัด 28) ตรวจ `isBranchInScope(ctx.scopes ?? {}, existing.branchId)` ไม่ผ่าน → audit DENIED + 403 ก่อนถึง `markDeleted` (บรรทัด 69); ไม่แตะ retention เดิม; **commit เดี่ยว ส่งได้ทันทีโดยไม่รองานอื่น** | `delete-attachment.use-case.spec.ts` (ลงทะเบียนแล้ว): สาขาอื่น → 403 ไม่มี mutation; สาขาเดียวกันลบได้; retention เดิมยังปฏิเสธ |
| D-P1 (R4-F1) | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` (การเขียน summary ของรูปทาง LINE บรรทัด 10599-10612) | เพิ่ม `extractionAttachmentId: <id ไฟล์ที่ส่ง OCR>` ในการเขียนเดียวกัน ไม่ fallback ไป `primaryAttachmentId`; ไล่ทางอื่นที่เขียน summary ของ `LINE_UPLOAD` (MC13); แตะไฟล์ใน W00 hash → regenerate + whole-chain | `process-line-webhook.use-case.spec.ts` (ลงทะเบียนแล้ว) |
| D-B4 | `apps/api/src/modules/data-model-core/application/use-cases/complete-attachment-upload.use-case.ts` | หลังโหลดไฟล์ (บรรทัด 88) ตรวจ `existing.uploadedByUserId === ctx.userId && isBranchInScope(ctx.scopes ?? {}, existing.branchId)` แบบ `resume` ([create-upload-intent.use-case.ts:48](../../apps/api/src/modules/data-model-core/application/use-cases/create-upload-intent.use-case.ts)) ไม่ผ่าน → audit DENIED + 403; ไล่ผู้เรียกภายในทุกจุดว่าส่ง ctx ของผู้อัปโหลด: `expense-upload.use-case.ts:364, 715`, `substitute-receipt.use-case.ts` (constructor 1569/1631/1785), `expense-capture-group.use-case.ts:469`, `signature-asset.use-case.ts:152/354/392`, `process-line-webhook.use-case.ts:11316/11326/11360/11636` — ถ้าพบจุดที่ทำแทนผู้อื่นโดยชอบ ให้หยุดและบันทึกในหน่วยความจำก่อนแก้ | `complete-attachment-upload.use-case.spec.ts` (ผู้อื่น/สาขาอื่น → 403 ไม่มี mutation; ผู้อัปโหลดเดิมผ่าน) |
| D-B5 | `apps/api/src/modules/data-model-core/application/use-cases/create-upload-intent.use-case.ts` (`resume` คืน `active: boolean`), `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` (บรรทัด 11311-11316 และ 11348-11360) | ข้าม completion เมื่อ `active` และ checksum ของไฟล์ตรง `media.checksumSha256` (แบบ [expense-upload.use-case.ts:358-364](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts)); checksum ไม่ตรง → ล้มแบบเดิม | `process-line-webhook.use-case.spec.ts` (redeliver หลัง ACTIVE ไม่ 400) |
| D-B1 | `apps/api/src/modules/expenses/domain/logic/expense-duplicate.logic.ts` | เลขเอกสารต้องผู้ขายเดียวกัน (counterparty / ชื่อ normalize / เลขผู้เสียภาษี) ยกเว้นทั้งสองฝั่งเป็นสลิป (เพิ่ม `sourceDocumentType` ใน input และ select ของ `findNearDuplicates`); normalize แปลงกลุ่มเครื่องหมาย/ช่องว่างเป็น `/` ตัวเดียวแทนการลบ | `expense-duplicate.logic.spec.ts` |
| D-B2 | `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts` (`findNearDuplicates`), `apps/api/src/modules/expenses/application/services/expense-duplicate-detection.ts` | query ที่สอง: ทุกแถวใน 180 วันที่ `grandTotalAmount` เท่ากัน **หรือ** `vendorDocumentNumber` เท่ากันแบบ `mode: 'insensitive'` รวมกับ 200 ล่าสุดแบบไม่ซ้ำ id; **ข้อจำกัดที่คงไว้ (เขียนใน test และสเปก):** เกิน 200 แถว pHash อย่างเดียว หรือเลขเอกสารต่างแค่เครื่องหมาย/ช่องว่างและยอดต่าง ยังไม่จับ (รีวิว F14) | `expense-duplicate-detection.spec.ts` |
| D-B3 | `apps/web/src/features/expenses/ExpenseReviewPage.tsx` | แสดงป้าย `ai_items_not_reconciled` เมื่อ `itemsSumAmount ≠ grandTotalAmount` ปัจจุบันเท่านั้น (helper เดียวกับ 2a.2 ผ่าน contracts) | `apps/web/src/features/expenses/expenses.model.spec.ts` |
| D-B6 | `apps/api/src/modules/reimbursements/application/services/reimbursement-evidence.service.ts` (ข้างการปฏิเสธสลิปบรรทัด 37-42) | ปฏิเสธ `invalid_primary_attachment` เมื่อ `attachments.findSignatureAssetOwner({ id, companyId })` ไม่เป็น null (R2-F5) | `reimbursement-request.use-case.spec.ts` |
| D-B7 | `apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts` (การเขียน fenced บรรทัด 1295-1302) | ใส่ `chargeReconciliation {status, chargesApplied, itemsSumAmount}`, `classification` และ `extractionAttachmentId: options.sourceAttachmentId` (R2-F7, MC10) | `receipt-ocr-apply.service.spec.ts`, `expense-capture-read-runner.service.spec.ts` |
| D-doc | `docs/specs/expense-receipt-upload-spec.md` บรรทัด 1307 | แก้ "bounded 180-day scan" ให้ตรงพฤติกรรมหลัง D-B2 และข้อจำกัดที่เหลือ (ขั้นนี้แตะไฟล์อื่นนอกสามไฟล์ของ lane เอกสารนี้ — ทำตอน implement) | — |

ตรวจ: API typecheck; spec ที่แตะ + `prisma-expense.repository.duplicate-resolve.spec.ts`; D-B5 แตะ `process-line-webhook.use-case.ts` → regenerate W00 (`UPDATE_LINE_AI_CAPABILITY_MANIFEST=1` แล้วรีวิว diff) + `node scripts/run-line-ai-whole-chain-acceptance.mjs`; journey `staff-receipt-from-phone`

---

## Phase 1 — เก็บข้อเท็จจริงของไฟล์ตอนอัปโหลด (หนึ่ง lane)

| ขั้น | ไฟล์ | งาน |
|---|---|---|
| 1.1 | `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/2026xxxx_attachment_file_signals/migration.sql` | `AttachmentObject.fileSignalsJson Json?` |
| 1.2 | ใหม่ `apps/api/src/modules/data-model-core/domain/logic/attachment-file-signals.logic.ts` | `readAttachmentFileSignals(bytes, mimeType)` ตาม spec §6.2: เดิน JPEG segment + ประกอบ APP11, PNG `caBX`/text, คลาย `brob` ด้วย `zlib.brotliDecompressSync({ maxOutputLength: 2 MB })`; **parse JUMBF → active manifest → assertion `c2pa.actions(.v2)` ทุก instance (CBOR) แล้วคิด `digitalSourceType` ที่มีผลจริงของแต่ละ action ที่บันทึกตาม §18.15.6.1 (`"*"` → template ชื่อเดียวกันตามลำดับ → ทับด้วยค่าของ action; template ไม่สร้าง action) และ `c2pa.ai-disclosure` (มี `modelType`) เท่านั้น** (R2-F1, R3-F1) ด้วย CBOR reader ขนาดเล็กที่ decode major type 0–7 ครบ รวม bool/null/undefined/half-single-double float/tag (R3-F6, MC9); **related actions ตาม §18.15.8 แบบเรียกซ้ำมีขอบเขต: related = ค่าที่มีผลของแม่ ทับด้วยค่าของ related (R4-F4, MC12)**; **PDF โหลดด้วย `PDFDocument.load(bytes, { updateMetadata: false })` เท่านั้น ก่อนอ่าน Producer/Creator (R4-F5)**; XMP parse เป็น XML อ่าน 3 property แบบค่าเท่ากัน; parser TIFF IFD0 อ่านแค่ 0x0131/0x000B; PNG keys ต้องตรงโครงเนื้อหา (R2-F11); PDF producer/creator; `TOOL_CATALOGUE`; ไม่ throw; ไม่อ่านข้อความอิสระ; ปิด MC3/MC4 ก่อน |
| 1.3 | `.../use-cases/complete-attachment-upload.use-case.ts`, `.../repositories/prisma-attachment.repository.ts` (`markActive`), `.../models/attachment.model.ts` | เรียกหลัง checksum/pHash (บรรทัด 127-131) เขียนคู่ `perceptualHash`; ห้ามอยู่ใน record/DTO ที่ส่งออก |
| 1.4 | เดียวกับ 1.3 | log `attachment.file_signals` (spec §11.9) + เวลา parser; channel จาก `ctx.authProvider === 'line'` |
| 1.5 | `src/modules/data-model-core/domain/logic/attachment.logic.spec.ts`, `src/modules/data-model-core/application/use-cases/complete-attachment-upload.use-case.spec.ts` | spec §14.1 สองแถวแรก (ไม่รวม QR) ด้วย fixture Phase 0.4 รวม negative: custom metadata/caption ที่ยก URI, XMP `dc:description`, digitalSourceType ใน ingredient, **created=digitalCapture + `"*"` template AI, template AI ที่ไม่มี action ชื่อตรง** (R3-F1), assertion ที่มี bool/float ต้องอ่านได้ (R3-F6), AI บน related action → มี / related ทับด้วย digitalCapture → แม่ยังนับ (R4-F4), PDF ที่มีแค่ Producer ของโปรแกรมแก้ PDF → tool (R4-F5), ImageDescription, `parameters="exposure 1/50"`, ComfyUI ปิด metadata, Brotli เกิน |

ตรวจ: `pnpm --filter @watchdog-bms/api prisma:validate`; API typecheck; สอง spec; migrate deploy ที่ local; อัปโหลดเว็บ local สามแบบ (JPEG ≤ 6 MB มี EXIF Software, JPEG 7 MB มี EXIF, HEIC) แล้ว query ว่า `present` ตรงตามตาราง spec §1.1 และไม่มีสตริงดิบ

---

## Phase 2a — Derive + ตาราง review + API รายจ่าย (หนึ่ง lane)

| ขั้น | ไฟล์ | งาน |
|---|---|---|
| 2a.1 | `apps/api/prisma/schema.prisma`, migration `2026xxxx_document_authenticity_review` | ตาราง `DocumentAuthenticityReview` + relation บน `AttachmentObject` และ `Company` (spec §6.1) |
| 2a.2 | ใหม่ `packages/contracts/src/receipt-authenticity.ts`, `packages/contracts/src/index.ts`, `packages/contracts/src/expenses.ts`, `packages/contracts/src/reimbursements.ts` | types §7.1, `AUTHENTICITY_WORDS`, `authenticityOpenCountForLine`, `itemsStillDisagree` (ใช้ใน D-B3); ห้ามแตะ `line-ai.ts` |
| 2a.3 | ใหม่ `apps/api/src/modules/expenses/domain/logic/receipt-authenticity.logic.ts` | `eligibleEvidenceFiles(...)` (spec §5.5 — รายจ่ายรับรายการจาก `loadExpenseEvidenceSources` (R2-P11), ใบเบิกรับ snapshot ที่ปัก (R2-F4), ยกเว้นด้วยความสัมพันธ์ที่ server เขียนเท่านั้น ไม่อ่าน `metadataJson`), `readFileFor(expense)` เคารพ `sourceStale`/`extractionAttachmentId` (R2-F6), `deriveAuthenticitySignals(...)` กลุ่ม A, C (D รับข้อมูลได้แต่ว่างจน Phase 4), `factsHash(...)` §6.4, `mergeReviews(signals, rows)` |
| 2a.4 | `apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-attachment.repository.ts` | `findAuthenticityFacts(companyId, ids)` และ `recordAuthenticityReviews(rows, auditWithinTx)` ด้วย `createMany({ skipDuplicates: true })` ใน transaction |
| 2a.5 | `apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts` (`GetExpenseUseCase.authenticity`), `apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts` (`RecordExpenseAuthenticityReviewUseCase`), `apps/api/src/modules/expenses/presentation/http/expense.controller.ts` (GET เพิ่ม `authenticity`, POST `:expenseId/authenticity-review`), `apps/api/src/modules/expenses/presentation/http/expense.dtos.ts`, module providers | ลำดับ §7.3: `lockFundingEvidence(tx, companyId, { attachmentIds:[id, …ไฟล์ทุกไฟล์ในบริษัทที่ `slipRefKey` เดียวกัน], expenseIds:[expenseId] })` ก่อน (R3-F3, R4-F2) → `SELECT … FOR UPDATE` แถวรายจ่าย → อ่านไฟล์ใหม่ว่ายัง ACTIVE และนับเป็นหลักฐาน → สถานะ/revision หลังล็อก → derive → จัด (ก) เขียน / (ข) ตรวจแล้ว = สำเร็จไม่เขียน / (ค) 422 (R2-P2/F3/F8) |
| 2a.6 | `src/modules/expenses/domain/logic/expense-duplicate.logic.spec.ts`, `src/modules/expenses/application/use-cases/expense-upload.use-case.spec.ts`, `src/modules/expenses/presentation/http/expense.dtos.spec.ts`, `packages/contracts/src/company-tax-identity.spec.ts` | spec §14 (รวม F1 metadataJson bypass, F2 factsHash/target, F3 code ไม่ค้าง, F11 review evidence, F21 REJECTED) |

ตรวจ: contracts build; API typecheck; spec ในขั้น 2a.6; GET รายจ่ายใน local ด้วย staff (ไม่มี key) และ owner (มี key)

---

## Phase 2b — API ใบเบิก (หนึ่ง lane หลัง 2a)

| ขั้น | ไฟล์ | งาน |
|---|---|---|
| 2b.1 | `apps/api/src/modules/reimbursements/application/dto/reimbursement.mapper.ts` (`detailWithFileNames`), `apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.ts` (ส่ง `approvalActions` ที่คำนวณแล้วที่บรรทัด 409 เข้า mapper) | `authenticity` ระดับบนสุดตาม §8; ไฟล์จาก **`line.sourceExpenseSnapshot.attachments` ที่ checksum ตรง** หรือ `line.attachmentId` — ไม่อ่านหลักฐานสดของรายจ่ายที่ผูก; กลุ่ม C และ `SLIP_REF_MISMATCH` เกิดได้เฉพาะเมื่อ `expense.updatedAt == snapshot.expenseUpdatedAt` **และ**ไฟล์ที่ถูกอ่าน (ไม่ stale) อยู่ใน snapshot ที่ checksum ตรง ไม่งั้นไม่สร้างเลย รวม `SELLER_TAX_ID_INVALID` (R2-F4, R3-F4, MC8); `other.canOpen` ด้วยตัวตรวจเดิม |
| 2b.2 | `apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic.ts` | `mayRecordClaimDocumentCheck(ctx, req, approvalActions)` และ `isClaimClosedForAuthenticity(status)` (REJECTED/CANCELLED/VOIDED) |
| 2b.3 | `apps/api/src/modules/reimbursements/application/use-cases/reimbursement-finance.use-case.ts` (`RecordClaimAuthenticityReviewUseCase` เรียก `approvalDecisionActions`; `lockFundingEvidence` กับไฟล์ ไฟล์ทุกไฟล์ที่ `slipRefKey` เดียวกัน และรายจ่ายที่บรรทัดผูกก่อน (R4-F2) แล้วล็อกแถวใบเบิก (+ รายจ่ายที่ใช้ค่าสด) ตามลำดับล็อกเดิม — ปิด MC2 ก่อน (R3-F3)), `apps/api/src/modules/reimbursements/presentation/http/reimbursement.controller.ts` (POST `:requestId/authenticity-review` + `@RequirePermissions('account.session.read')`), `apps/api/src/modules/reimbursements/presentation/http/reimbursement.dtos.ts` | ลำดับ §7.3; `looksLikeAccountNumber`; ผ่าน write-quiesce guard เดิม |
| 2b.4 | `src/modules/reimbursements/application/use-cases/reimbursement-related-access.use-case.spec.ts`, `reimbursement-approval.use-case.spec.ts`, `reimbursement-finance.use-case.spec.ts`, `src/modules/reimbursements/presentation/http/reimbursement.dtos.spec.ts` | ผู้ส่งไม่ได้ key; frozen assignee ที่ถูกถอดสิทธิ์ยังเห็นและบันทึกได้; role-routed ได้; คนนอกขั้น 403; อนุมัติได้แม้ค้าง; digest/updatedAt ไม่เปลี่ยน; CANCELLED/REJECTED 409 |
| 2b.5 | `src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.draft-submit-race.spec.ts` | real PG §14.2 รวม review ชนการปิด/การแก้/**การลบไฟล์แบบ soft delete** ทั้งสองทิศทาง, **review ของ A ชนการลบไฟล์ B ที่ key เดียวกันแต่กราฟคนละชุด (R4-F2)** และไม่มี deadlock (R3-F3) |
| 2b.6 | `src/modules/line-ai/application/use-cases/erp-core-detail-tools.use-case.spec.ts`, `erp-reimbursement-tools.use-case.spec.ts` | read tool ไม่มี `authenticity` (ไม่แก้ tool code) |

ตรวจ: API typecheck; spec 2b.4–2b.6; pg spec กับฐานทดสอบ local ที่อนุญาต

---

## Phase 3 — เว็บ + LINE + journey (สอง lane ขนานหลัง 2b)

### 3W เว็บ

| ขั้น | ไฟล์ | งาน |
|---|---|---|
| 3W.1 | ใหม่ `apps/web/src/features/expenses/DocumentAuthenticityCard.tsx` | การ์ด + dialog §10.1–§10.4; ส่ง `signals` = สิ่งที่แสดงเท่านั้น; ซ่อนปุ่มเมื่อ `closed` หรือ `!canRecordCheck`; ปุ่มกลุ่มเดียวกันขนาดเท่ากัน **ลำดับ: ปุ่มถอยก่อน ปุ่มทำขวาสุด/บนสุดเมื่อซ้อน** (`thai-ux-standard.md:67`, R4-F7); คำปฏิเสธ 404 `authenticity_attachment_not_on_target` + "โหลดใหม่" และ**เก็บข้อความ "ตรวจอย่างไร" ข้ามการโหลดใหม่** (R4-F6) |
| 3W.2 | `apps/web/src/features/expenses/ExpenseReviewPage.tsx`, `apps/web/src/features/expenses/expenses.model.ts` | วางถัด `duplicatesCard` (บรรทัด 2237-2238, 2256) **และในเลย์เอาต์ source-only** (บรรทัด 2195, `sourceOnly` ที่ expenses.model.ts:1516) (R2-F9); แสดงทุกกลุ่ม; `deriveExpenseAuditChecks` ไม่ออกแถวเลขผู้เสียภาษีผิดหลักเมื่อการ์ดแสดง `SELLER_TAX_ID_INVALID` |
| 3W.3 | `apps/web/src/features/reimbursements/ReimbursementJourneyPage.tsx` | การ์ดถัด `ClaimSummaryCard`; บรรทัดในการ์ดขั้นตอนอนุมัติ/ตรวจการเงิน/จ่าย + ลิงก์เลื่อน |
| 3W.4 | `apps/web/src/features/expenses/expenses.api.ts`, `apps/web/src/features/reimbursements/reimbursements.api.ts`, `apps/web/src/common/i18n/workspace-dictionary.ts` | client POST; คำปฏิเสธ §10.3 ไทย/อังกฤษ |
| 3W.5 | `apps/web/src/features/expenses/expenses.model.spec.ts`, `apps/web/src/features/reimbursements/reimbursements.model.spec.ts` | กันพูดซ้ำ, บรรทัด n ใบ, ไม่มีการ์ดเมื่อไม่มี key, closed |

ตรวจ: `pnpm --filter @watchdog-bms/web typecheck` + web suite; กดจริงบน local stack ที่ 390, 1280, ~1,556 px ด้วยพนักงาน/ผู้อนุมัติ/ฝ่ายบัญชี รวม dialog และคำปฏิเสธแต่ละแบบ

### 3L LINE

| ขั้น | ไฟล์ | งาน |
|---|---|---|
| 3L.1 | `apps/api/src/modules/line-ai/application/line-expense-action.service.ts` | preview `REIMBURSEMENT_APPROVE` ใช้ `record.claim.authenticity`; `CONFIRM` ใช้ `getExpense.authenticity(ctx, record)`; **เก็บเป็น `authenticityNotice` ใน `StoredAction` (รวมในลายเซ็น) ไม่ใส่ใน `details/summary/reply`**; `ExpenseActionPreviewTool.execute` (บรรทัด 1089-1096) ตัด field นี้ก่อนคืน `data`; `reviewUrl` (ไม่ใส่เมื่อมี `documentImageUrl`) — ปิด MC1 ก่อน (R2-F2) |
| 3L.2 | `apps/api/src/modules/line-ai/domain/logic/line-expense-action-card.logic.ts` | ปุ่ม URI "ดูเอกสาร" จาก `preview.reviewUrl` |
| 3L.3 | `src/modules/reimbursements/application/use-cases/reimbursement-approval.use-case.spec.ts`, `src/modules/line-ai/domain/logic/line-business-card.logic.spec.ts`, `apps/ai-gateway/src/modules/line-ai/agents/semantic-turn-v2-grounding.spec.ts` | spec §14.1 รวม tool result ไม่มีข้อความ และคำขอผสมอนุมัติ+อ่าน |
| 3L.4 | `docs/research/mangmee-ai-capability-manifest-2026-09-27.json`, `scripts/line-ai-whole-chain-acceptance.catalog.mjs` (เพิ่ม `src/modules/reimbursements/application/use-cases/reimbursement-approval.use-case.spec.ts` ใน `reliability-api-v2`) | regenerate W00 (คาดว่าเปลี่ยนแค่ sha ของไฟล์ที่แตะ) แล้ว `node scripts/run-line-ai-whole-chain-acceptance.mjs` |

### 3J Journey

| ขั้น | ไฟล์ | งาน |
|---|---|---|
| 3J.1 | `e2e/journeys/journey-kit.ts` (+ fixture จาก Phase 0.4 ใต้ `e2e/journeys/fixtures/`) | `aiDeclaredPng()` (manifest C2PA จริง), `editorJpeg()` (sharp `withExif({ IFD0: { Software: 'Adobe Photoshop 25.0' } })` ≤ 6 MB), `largeExifJpeg()` (> 6 MB) |
| 3J.2 | ใหม่ `e2e/journeys/receipt-second-look.journey.spec.ts` | ขั้น 1–5, 7, 8 ของ spec §14.4 ที่ 390, 1280, ~1,556 px บน proof stack (ล้างฐานก่อนรัน) |

ตรวจ: journey ใหม่ + `claim-declined-then-paid`, `staff-receipt-from-phone`, `evidence-and-settings`

---

## Phase 4 — สลิป QR (หนึ่ง lane หลัง Phase 0, 3 และ D-B5)

| ขั้น | ไฟล์ | งาน |
|---|---|---|
| 4.1 | `apps/api/package.json` (dependencies เท่านั้น `"jsqr": "1.4.0"`), lockfile | `pnpm audit --audit-level=high` ผ่าน |
| 4.2 | `apps/api/prisma/schema.prisma`, migration `2026xxxx_attachment_slip_ref_key` | `slipRefKey` + index |
| 4.3 | ใหม่ `apps/api/src/modules/data-model-core/infrastructure/slip-qr.worker.ts` (`slipRefKey` ตรงตามไบต์ ไม่ fold ตัวพิมพ์ R4-F3) + ตัวเรียกใน `attachment-file-signals.logic.ts` / `complete-attachment-upload.use-case.ts` | ย่อด้วย sharp เป็น RGBA ≤ 1,200 px → ส่งเข้า `worker_threads` → jsQR + parse TLV/CRC; `worker.terminate()` ที่ 1,000 ms → `NOT_RUN/TIMEOUT` (รีวิว F17); เขียน `slipRefKey` |
| 4.4 | `receipt-authenticity.logic.ts`, `findAuthenticityFacts` | `SLIP_QR_INVALID` และ `SLIP_REF_REUSED` บนทุกไฟล์ที่นับโดยไม่พึ่ง OCR (F12); `SLIP_REF_MISMATCH` เฉพาะไฟล์ที่ถูกอ่าน + allowlist และเทียบกับ `recognizedFields.documentNumber`/`classification.documentKind` ของการอ่านนั้น ไม่ใช่ช่องที่ผู้ใช้แก้ได้ (R3-F5, MC10); เทียบหลังตัดช่องว่าง/zero-width เท่านั้น (R4-F3, MC5); `SLIP_REF_REUSED` ไม่ขึ้นกับสถานะปิดของรายการอีกฝั่ง (R4-F2); query `slipRefKey in` ไม่ตัดไฟล์ชุดแรกและเทียบกันเองในรายการเดียว (F13) |
| 4.5 | `attachment.logic.spec.ts`, `complete-attachment-upload.use-case.spec.ts`, `expense-duplicate.logic.spec.ts`, `prisma-reimbursement.repository.draft-submit-race.spec.ts`, journey ขั้น 6 + `slipPng()` | spec §14 |

ตรวจ: เหมือน Phase 1 + pg spec + journey ขั้น 6; วัดเวลาอัปโหลด LINE และ event-loop delay ใน local ก่อน/หลัง

---

## Phase H — คำอธิบายทั่วไปในคู่มือ (รอเจ้าของ ไม่บล็อก)

| ขั้น | ไฟล์ | งาน |
|---|---|---|
| H.0 | `apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts`, `apps/ai-gateway/src/modules/line-ai/agents/approved-knowledge.spec.ts` | **ก่อนสร้างชุดใหม่:** แช่ v6 เป็นค่าคงที่ APPROVED แยก แล้วให้ตัวเลือกที่บรรทัด 128 fallback ไป v6 แทน v4 (บรรทัด 38); test ว่าเมื่อชุดใหม่เป็น DRAFT ยังได้ v6 และ source-hash ของ v6 ไม่เปลี่ยน (R2-F10) |
| H.1 | `apps/web/src/features/user-guide/…` (หน้าคู่มือที่การ์ดผูก `sourceFile/sourceHash`), `apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts` | เพิ่มเนื้อหา "ข้อสังเกตเอกสาร" สำหรับผู้ตรวจ/ผู้อนุมัติ; ต่อจากชุด **v6 ที่เจ้าของอนุมัติ** (บรรทัด 113-115) เป็นชุดใหม่สถานะ DRAFT ผ่าน workflow เดิม (ไม่ใช่ "4 → 5") (รีวิว F18) |
| H.2 | หน้ารีวิวคู่มือเดิม | เจ้าของอ่านและอนุมัติ → APPROVED; ระหว่างรอ ชุดที่ใช้งานยังเป็น v6 (เป็นจริงได้เพราะ H.0) |
| H.3 | `apps/ai-gateway/src/modules/line-ai/agents/approved-knowledge.spec.ts` | สิทธิ์ที่เห็นการ์ด + ชุดที่ใช้งาน; การ์ดพูดเรื่องทั่วไป ไม่มีข้อมูลของรายการใด (F23) |

---

## ปิดงาน (ทุก phase)

- อัปเดต `docs/agent-memory/receipt-authenticity-signals.md`: สิ่งที่รันจริง ผล และสิ่งที่ไม่ได้รันพร้อมเหตุผล
- ก่อน push: fetch develop, merge, ตรวจซ้ำ; push ตรงเข้า develop และ main ตามคำสั่งเจ้าของ (ไม่เปิด PR ไม่ trigger Actions)
- UAT ตาม `docs/runbooks/uat-production-v2-deployment.md`; Production รอเจ้าของสั่ง
- 30 วันหลัง Phase 3 ขึ้น Production: สรุปจำนวนต่อ code + สัดส่วนไฟล์ที่มี metadata แยกช่องทาง ให้เจ้าของเป็นภาษาไทยง่าย ๆ

## การตัดสินใจที่ล็อกแล้ว (อย่ารื้อโดยไม่บันทึก)

1. เตือนเท่านั้น ไม่มีประตูใหม่ ไม่ผูก `duplicatePolicy`
2. ไม่มี AI judge — AIForge-Doc GPT-4o AUC 0.509 (ก.พ. 2569) และ AIForge-Doc v2 กับ GPT-Image-2: คน 0.501, TruFor 0.599, DocTamper 0.585, โมเดลตัดสินงานตัวเอง 0.532 (เม.ย. 2569, arXiv 2604.25213); สัญญาณเลขไม่ลงตัวคำนวณเองฟรี (GPT4o-Receipt)
3. ไฟล์ที่นับ/ไม่นับตัดสินจากความสัมพันธ์ที่ server เขียนเท่านั้น — `metadataJson` ไม่มีผลใด ๆ (F1)
4. การตรวจแล้วอยู่ในตาราง `DocumentAuthenticityReview` ผูก (target, ไฟล์, code, factsHash); ไม่ใช้ร่วมข้ามรายการ; `lockFundingEvidence` ก่อน แล้วล็อกแถว target (`FOR UPDATE`) ก่อนอ่าน และอ่านสถานะไฟล์ใหม่หลังล็อก ไม่แตะ `updatedAt`; ความหมาย idempotent: ค้าง→เขียน, ตรวจแล้วชุดเดิม→สำเร็จไม่เขียน, อย่างอื่น→422 (F2, F3, R2-P2/F3/F8)
5. ข้อสังเกตคำนวณตอนอ่าน ไม่เก็บสถานะค้าง
6. การ์ดแสดงข้อสังเกตค้างทุกกลุ่มทุกหน้า; หน้ารายจ่ายตัดแถวเลขผู้เสียภาษีที่ซ้ำในขั้นเดียวกัน (F6)
7. `FILE_SAYS_AI` มาจากค่า `digitalSourceType` ที่มีผลจริง (template ตาม §18.15.6.1) ของ action ที่บันทึกใน active manifest, assertion `c2pa.ai-disclosure` หรือ XMP `Iptc4xmpExt:DigitalSourceType` เท่านั้น — parse จริง ไม่ค้นไบต์; ชื่อโปรแกรม (รวม ComfyUI/A1111 ที่ตรงโครงเนื้อหา) เป็น `FILE_NAMES_TOOL` (F7, F10, R2-F1, R2-F11)
8. อำนาจใบเบิกใช้ `approvalDecisionActions` ตัวเดียวกับปุ่มอนุมัติ (F5)
9. นโยบายรายการปิดเดียว: รายจ่าย REJECTED/VOIDED, ใบเบิก REJECTED/CANCELLED/VOIDED (F21)
10. `jsqr` dependency เดียว รันใน worker ที่ terminate ได้ (F17); ไม่เรียกบริการตรวจภายนอก
11. ไม่เพิ่มแถวในเมทริกซ์ whole-chain — เพิ่มไฟล์ test เข้า suite แทน

12. ใบเบิกใช้ snapshot ที่ปัก; รายจ่ายใช้ `loadExpenseEvidenceSources`; กลุ่ม C ผูกกับไฟล์ที่ถูกอ่านจริงและไม่ stale (R2-P11/F4/F6)
13. ข้อสังเกตไม่อยู่ในผลที่ส่งให้โมเดล (`authenticityNotice` แยกจาก `details`) (R2-F2)
14. ชุดคู่มือที่ใช้งาน fallback ไป v6 ที่เจ้าของอนุมัติ ไม่ใช่ v4 (R2-F10)
15. "ที่อ่านได้" ใช้กับผล OCR เท่านั้น ค่าที่ผู้ใช้แก้ใช้ "ที่บันทึก" (R3-F5)
16. B8 (ลบไฟล์ข้ามสาขา) แก้แยกเป็น commit เดี่ยว ส่งได้ก่อนงานอื่นทั้งหมด (R3-F2)
17. ที่มาการอ่านทาง LINE ต้องเก็บ `extractionAttachmentId` (D-P1) ก่อน Phase 2 — ไม่มี fallback ไป primary (R4-F1)
18. `slipRefKey` และการเทียบเลขอ้างอิงตรงตามไบต์ จนกว่า fixture ของธนาคารจะพิสูจน์กติกาอื่น (R4-F3)
19. ตัวอ่าน C2PA รวม related actions (§18.15.8); PDF อ่านด้วย `updateMetadata: false` (R4-F4, F5)
