# Contract appendix: capture group, bounded PDF reading, derived expense sources (W00)

Status: W00 decisions v1, 2026-09-18 — implementation contract for W01–W08 of [spec v0.11](marketplace-buyer-expense-capture-spec-th.md) / [plan v0.11](../plans/marketplace-buyer-expense-capture-plan-th.md). เอกสารนี้ปิด D01/D02/D06/D07/D09 ในระดับที่โค้ดใช้ได้ และเสนอค่าเริ่มต้นของ D03/D04/D08 ที่เจ้าของต้องยืนยัน (ข้อ 15) ทุกข้อในเอกสารนี้อ้างโค้ดจริงบน `origin/develop` `70d1359d` (2026-09-18) ตัวเลขบรรทัดอาจเลื่อนเมื่อโค้ดเปลี่ยน
Owner: Product owner (นโยบาย) / controller session (contract)
Scope: ไม่เปลี่ยนกติกาเงิน/สิทธิ/ใบรับรองของ spec; ถ้าข้อใดขัดกับ spec ให้ถือ spec และแก้เอกสารนี้ในงานเดียวกัน

## 1. Slice ที่ส่งมอบในรอบนี้ (2026-09-18)

รอบนี้ implement ทั้ง W01–W07 และส่วนที่เครื่องทำได้ของ W08 บน branch เดียว รวมเป็น PR ต่อ `develop` และ `main` อย่างละหนึ่ง (คำสั่งเจ้าของ) โดย:

- ทำได้ในรอบนี้: schema/API/gateway/web/LINE ของ capture group, multi-file, bounded PDF 10 MiB/หลายหน้า, allocation, derived sources, ใบรับรองต่อ source, handoff/resolver/export, §17 error copy + Web recovery link, §17.5 LINE ถามย้อนหลัง, §18.4 NR replies, unit/PG/browser evidence บน throwaway stack, synthetic fixtures
- บันทึกเป็น NOT_RUN/owner-owned (ไม่อ้างผ่าน): UX 40+ กับผู้ใช้จริง (D05), authorized Thai golden bundles/real electronic originals (D05/D09), การวัด accuracy บน corpus จริง, UAT/Production deploy และ acceptance บน LINE จริง (runbook), นโยบายบริษัทจริง (D03 ต่อบริษัท)
- ไม่ทำ: automated e-Tax signature/timestamp verification (D09 baseline = not-checked), automatic mailbox/URL fetching, refund posting, BNPL/foreign settlement, multi-payer

## 2. D01 — Persistence ที่เล็กที่สุดที่บังคับ invariants ได้

### 2.1 ทางเลือกและเหตุผล

| ทางเลือก | ผล | ตัดสิน |
|---|---|---|
| A. `ExpenseRecord` เป็น parent แบบ capture-only (discriminator `sourceRole`) | ต้องเพิ่ม guard ใน consumer ทุกตัวของ `ExpenseRecord` (list/count/export/dashboard/LINE tools/duplicate/confirm/pay/claim/certificate — inventory ข้อ 12 มี ≥ 20 จุด) และ binary เก่าที่ไม่รู้จัก discriminator จะปฏิบัติกับ parent เป็นค่าใช้จ่ายจริง (IG03/IG13/A38) | **ไม่เลือก** |
| B. Capture group เป็น aggregate แยก ไม่มี `ExpenseRecord` จน handoff; derived source = `ExpenseRecord` ปกติที่มี lineage columns | parent ไม่มีทางเข้า list/report/confirm/claim โดยโครงสร้าง; binary เก่าไม่เห็นตารางใหม่ และเห็น derived source เป็นค่าใช้จ่ายปกติซึ่งถูกต้องทางการเงิน; consumer ที่ต้องแก้เหลือ resolver ambiguity + duplicate scoring + picker/evidence payer (ข้อ 6) | **เลือก** |

ทาง B รักษา A01: การอัปโหลดรูปเดียว/PDF เดียวบนเว็บยังสร้าง `ExpenseRecord` ตอน init เหมือนเดิม (ข้อ 3) กลุ่มเกิดเฉพาะเมื่อมีหลายไฟล์, ผู้ใช้ประกาศของส่วนตัว/หลายร้าน, หรือช่องทาง LINE ส่งไฟล์ (PDF)

### 2.2 ตารางใหม่ (additive migration เดียว; ทุก id เป็น cuid เหมือนโมดูล; เงินเป็น `Decimal(18,4)` string ตาม repo)

**`ExpenseCaptureGroup`** — งานรวมหลักฐานหนึ่งงาน (บริษัท/สาขาเดียว)
- `id, companyId, branchId, createdByUserId, intakeChannel ExpenseCaptureIntakeChannel (WEB|LINE)`
- `status ExpenseCaptureGroupStatus`: `OPEN` (รับไฟล์/อ่าน/ตรวจ) → `HANDED_OFF` (สร้าง derived sources แล้ว, handoff ACTIVE) → `CLOSED_NO_HANDOFF` (ยืนยันว่าไม่มีส่วนบริษัท/ส่วนตัวทั้งหมด) | `CANCELLED`
- `revision Int @default(1)` — เพิ่มทุก mutation; ทุก mutation รับ `expectedRevision` (409 `expense_capture_group_revision_conflict`)
- `businessUse ExpenseCaptureBusinessUse (UNKNOWN|ALL_COMPANY|MIXED)`, `fundingRoute ExpenseCaptureFundingRoute (UNKNOWN|COMPANY|EMPLOYEE)`, `payerUserId String?` (สมาชิก ACTIVE ที่ server ตรวจ)
- `taxReviewJson Json?` — ผลตรวจภาษีต่อ scope โดยผู้มีสิทธิ (`{ [scopeKey]: { vatMode, inputVatClaimStatus, taxEvidenceStatus, reviewedByUserId, reviewedAt } }`)
- `expenseDateSourceJson Json?` — วันที่ต่อเหตุการณ์ที่ตรวจแล้ว (`order|payment|document|upload` + เลือกใช้ค่าไหนเป็น `expenseDate` ต่อ scope)
- `lineChatKeyHash String?` (LINE binding), `acceptedAllocationId String?`, `handoffBatchKey String? @unique` (`<groupId>:<allocationRevision>`), `handoffState ExpenseCaptureHandoffState (NONE|ACTIVE|RELEASED)`
- `closedReason String?, closedAt DateTime?, createdAt, updatedAt`
- `@@unique([companyId, id])`, `@@index([companyId, createdByUserId, status])`, `@@index([companyId, status, updatedAt])`

**`ExpenseCaptureFile`** — manifest รายไฟล์ (per-file identity/status สำหรับ resume)
- `id, companyId, groupId, attachmentId @unique, position Int, uploadState ExpenseCaptureFileState (PENDING_UPLOAD|STORED|REJECTED|DETACHED)`
- `originalFileName, mimeType, byteSize Int, checksumSha256 String?, pageCount Int?, addedByUserId, lineMessageId String?, detachedAt DateTime?, detachedReason String?, createdAt, updatedAt`
- `electronicVerificationJson Json` default `{ "status": "NOT_CHECKED", "method": null, "checkedAt": null }` (D09 baseline; ค่า `UNAVAILABLE` เมื่อไฟล์ติดรหัส/เสีย)
- `@@unique([companyId, groupId, attachmentId])`, `@@unique([companyId, lineMessageId])` (partial where not null), `@@index([companyId, groupId, position])`

**`ExpenseCaptureReadJob`** — งานอ่านแบบ durable ต่อไฟล์ (ใช้ได้ทั้ง group และ expense เดี่ยว)
- `id, companyId, ownerType ExpenseCaptureReadOwner (CAPTURE_GROUP|EXPENSE), groupId String?, expenseId String?, fileId String?, attachmentId, attachmentChecksum, objectVersionId String?`
- `preprocessVersion Int @default(1)`, `contractVersion Int @default(1)`, `status ExpenseCaptureReadStatus (QUEUED|PREPARING|READING|PARTIAL|PAUSED|FAILED|DONE|CANCELLED)`
- `ocrAdmissionRequestId String` (= OCR count admission fence ครั้งเดียวต่อ job), `manifestJson Json` (ข้อ 5.4), `checkpointJson Json` (ผล chunk/window ที่สำเร็จ), `attempts Int @default(0)`, `leaseOwner String?, leasedUntil DateTime?`, `pausedReason String?, lastErrorCode String?, lastErrorAt DateTime?`, `providerCallCount Int @default(0)`, `expectedSourceUpdatedAt DateTime?` (fence สำหรับ ownerType EXPENSE), `createdAt, updatedAt, completedAt DateTime?`
- `@@index([status, leasedUntil])`, `@@index([companyId, groupId])`, `@@index([companyId, expenseId])`

**`ExpenseCaptureObservation`** — facts ที่ประกอบแล้วต่อไฟล์ (versioned)
- `id, companyId, groupId String?, expenseId String?, fileId String?, jobId String?, version Int, source ExpenseCaptureObservationSource (AI|HUMAN|EXPENSE_FACTS), basedOnVersion Int?, payloadJson Json` (document graph ข้อ 5.3 พร้อม completeness/reconciliation), `modelLineageJson Json?`, `stale Boolean @default(false)`, `createdByUserId String?`, `createdAt`
- `@@unique([companyId, fileId, version])`

**`ExpenseCaptureAllocation`** — reviewed business allocation snapshot
- `id, companyId, groupId, groupRevision Int, policyVersion String` (`shared-discount-v1`, `shipping-by-eligible-item-v1`), `selectionJson Json` (item → companyQuantity), `inputJson Json` (observation versions ที่ใช้), `resultJson Json` (ต่อ scope: issuer, บรรทัด, charges, discount shares, provenance, totals ที่ผ่าน identity), `fundingRoute, payerUserId String?, computedByUserId, computedAt, status ExpenseCaptureAllocationStatus (PREVIEW|ACCEPTED|SUPERSEDED|INVALIDATED)`, `acceptedByUserId String?, acceptedAt DateTime?, invalidatedReason String?`
- `@@index([companyId, groupId, status])`; มี ACCEPTED ได้ครั้งละหนึ่ง (บังคับใน transaction ใต้ lock กลุ่ม)

**`LineIntakeAttempt`** — safe pre-capture diagnostic (§17.5) — ไม่เก็บ raw payload/ชื่อไฟล์ดิบ/secret
- `id, companyId String?, lineUserIdHash, chatKeyHash String?, webhookEventId String?, lineMessageId String?, messageType (image|file), fileNameSanitized String?` (ตัดเหลือ ≤ 80 ตัวอักษร ไม่มี path), `declaredFileSize Int?, measuredByteSize Int?, capabilityJson Json` (`{ maxBytes, allowedMimeTypes, pdfAutomaticRead: true }` ณ เวลานั้น), `stage LineIntakeAttemptStage (DOWNLOAD|SECURITY|PERSIST|READ|ROUTE)`, `reasonCode String`, `outcome LineIntakeAttemptOutcome (REJECTED|STORED|STORED_READING|STORED_READ_FAILED|STORED_READ_PARTIAL|STORED_READ_DONE|UNKNOWN)`, `targetType String?` (`capture_group|pending_media|expense`), `targetId String?`, `createdAt, updatedAt`
- `@@index([companyId, lineUserIdHash, createdAt])`; purge ด้วย `AI_DATA_RETENTION_DAYS` ใน sweep เดียวกับ `LineWebhookEventLog`

### 2.3 คอลัมน์เพิ่มบนตารางเดิม (additive, nullable)

- `ExpenseRecord`: `captureGroupId String?`, `captureAllocationId String?`, `captureScopeKey String?`, `payerUserId String?` (D06); `@@unique([companyId, captureGroupId, captureScopeKey])` (partial, non-null); `@@index([companyId, payerUserId])`
- `AttachmentLink.targetType` ค่าใหม่ `'expense.capture_group'` กับ purpose `'expense.capture.evidence'`; `isAllowedAttachmentTarget` (`attachment.logic.ts:24-39`) รับ target ใหม่; ไฟล์ของกลุ่มเป็น canonical owner; derived source ได้ link `expense.receipt.primary`/`supporting` ของไฟล์ที่เกี่ยวข้อง (validated lineage ข้อ 6)
- Legacy rows ทุกตารางคง semantics เดิม (ค่า null = ไม่ใช่งาน capture) ไม่มี backfill

### 2.4 Lock order (ต่อจาก canonical order เดิม)

`<companyId>:duplicate-reconciliation` → `<companyId>:reimbursement-evidence:*` (sorted; `lockFundingEvidence`) → `<companyId>:expense-capture:<groupId>` → `<companyId>:<expenseId>:substitute-receipt` → `ai-budget:<company>:<month>` ทุก transaction ที่แตะ group + expense ต้องเรียงตามนี้ (pg spec พิสูจน์ไม่ deadlock กับ reserve/settle เดิม)

## 3. Lanes: ทางเข้าสามทางกับสองรูปแบบไฟล์

| ทางเข้า | รูป 1 ไฟล์ | PDF 1 ไฟล์ (≤ 10,485,760 bytes) | หลายไฟล์ / เพิ่มหลักฐาน / ประกาศของส่วนตัว-หลายร้าน |
|---|---|---|---|
| Web อัปโหลดใหม่ | เหมือนเดิมทุกขั้น (init → complete → sync OCR) | `ExpenseRecord` ตอน init เหมือนเดิม; การอ่านเป็น `ExpenseCaptureReadJob(ownerType EXPENSE)` async; หน้า review แสดง "อ่านแล้ว n จาก m หน้า"; ผลเอกสารเดียว apply ผ่าน `receipt-ocr-apply` เดิม; พบหลายเอกสาร/หลายร้าน → notice + ปุ่ม "แยกเป็นกลุ่มหลักฐาน" (แปลงเป็นกลุ่ม ข้อ 3.1) | สร้าง `ExpenseCaptureGroup` (ช่อง WEB) หนึ่ง job ต่อไฟล์; หน้า `/companies/{c}/expenses/capture/{groupId}` |
| Web เปลี่ยนใบเสร็จ / แนบเพิ่ม | replace เดิม + `expectedAttachmentId/expectedUpdatedAt` + state matrix §16.4; รูป → sync reread ตาม policy เดิม | เหมือนซ้าย แต่ reread เป็น job async ผูก attachment/objectVersion ปัจจุบัน | "แนบหลักฐานเพิ่ม" = append (supporting ในงานเดิม) ไม่เรียก primary-replace; ถ้าผู้ใช้บอกว่าเป็นคนละร้าน/ซื้อใหม่ → แยกกลุ่ม/งานใหม่ |
| LINE | เหมือนเดิม (sync preflight) + copy §17.6/§18.4 | `message.type = file`: download → security → สร้าง `ExpenseCaptureGroup` (ช่อง LINE, ไฟล์เดียว, ผูก chatKeyHash/user) → ตอบ "เก็บไฟล์แล้วค่ะ กำลังอ่านเอกสาร" → job async → push ผล: เอกสารค่าใช้จ่ายเดียว = auto-handoff เป็น `ExpenseRecord` เดียว (สรุปแบบเดียวกับใบเสร็จวันนี้ + ลิงก์รายการ); หลายเอกสาร/ผสม = สรุป + ลิงก์หน้ากลุ่ม; NR01–NR09 ตาม §18.4; failed/partial = §17.6 + ปุ่ม **กรอกข้อมูลต่อ** | ไฟล์ที่ตามมาในแชตเดียวกัน (ภายในหน้าต่างงานเปิด) ถามว่า "ของงานเดิมหรือใบใหม่" เมื่อกำกวม ไม่รวมจากเวลาใกล้กันเอง |

### 3.1 การแปลง expense เดี่ยวเป็นกลุ่ม ("มีของส่วนตัวด้วย" / "แยกเป็นกลุ่มหลักฐาน")

`POST /v1/companies/{c}/expenses/{expenseId}/capture-group` (`expectedUpdatedAt`): อนุญาตเมื่อ expense ยังไม่ถูกใช้ (status DRAFT|NEEDS_REVIEW|READY_FOR_CONFIRMATION, ไม่มี payment/posting/claim line/certificate ≥ PREPARED) → สร้างกลุ่ม, ไฟล์ของ expense เข้า manifest (link `expense.capture.evidence`), facts ปัจจุบันของ expense เป็น observation `source: EXPENSE_FACTS` v1, expense ได้ `captureGroupId` และเป็น derived source ของ scope = ผู้ออกของมัน (`captureScopeKey`) ตั้งแต่ตอนนี้ (ยังไม่ปรับยอดจน allocation ACCEPTED) — deep link เดิมของ expense ยังใช้ได้

### 3.2 Auto-handoff ของกลุ่ม LINE ไฟล์เดียว

เงื่อนไข: อ่านครบ (`DONE`), พบเอกสารเดียว, ผู้ออกเดียว, `isExpenseExtractionEligible` ผ่าน, ไม่มี blocker (ยอดขัดกัน/ไม่ทราบยอด) → สร้าง derived source เดียวโดยไม่มี allocation (facts เต็มใบ ยังไม่แบ่งส่วน) สถานะ NEEDS_REVIEW เหมือนใบเสร็จ LINE ปัจจุบัน; กลุ่มเป็น `HANDED_OFF`; ผู้ใช้ประกาศของส่วนตัวได้ภายหลังจากหน้า expense (ข้อ 3.1 ใช้กลุ่มเดิม) กรณีอื่นกลุ่มคง `OPEN` และผู้ใช้ตรวจบนเว็บ

## 4. D02 — ขนาด ขอบเขต และ pipeline การอ่าน

### 4.1 ขอบไฟล์ต้นฉบับ (ทั้งสามทาง, หน่วย bytes)

- ต้นฉบับ ≤ **10,485,760** (= `UPLOAD_MAX_BYTES` default; `validateAttachmentMeta` เดิม) ทั้งรูปและ PDF; UI/LINE อ่านค่านี้จาก capability (`GET /v1/companies/{c}/expenses/capture-capability` → `{ maxBytes, allowedMimeTypes, pdfAutomaticRead: true, pdfMaxPagesAutomatic }`) ไม่ hard-code
- ยกเลิก gate PDF 4,000,000 ใน `expense-extraction.use-case.ts:20` และ 4,194,304 ใน `expense-upload.logic.ts:18` สำหรับเส้นทางที่ใช้ job; ข้อความ `expenses.upload_pdf_too_large` ถูกแทนด้วยสถานะ "เก็บไฟล์แล้ว กำลังอ่านเอกสาร"
- ขอบภายในต่อ provider call (Bedrock Converse ตรวจ 2026-09-18: document ≤ 4.5 MB, ≤ 5 documents; image ≤ 3.75 MB, ≤ 8000 px, ≤ 20 images): **PDF chunk ≤ 4,000,000 bytes และ ≤ 3 หน้า**; **ภาพ/region ≤ 3,500,000 bytes, ≤ 8000 px ต่อด้าน**; วัด `Buffer.byteLength` ของ output จริง ไม่ประมาณจากหน้า
- Serialized payload ต่อ call ≤ 16 MB ตาม `BASE64_MEDIA_ROUTES` (gateway `main.ts:53`) — ตรวจ `contentBase64.length` ก่อนส่ง
- เพดานหน้าที่ประกาศรองรับอ่านอัตโนมัติ: **≤ 60 หน้าต่อไฟล์** (`pdfMaxPagesAutomatic`, config `EXPENSE_CAPTURE_PDF_MAX_PAGES` default 60); เกินนั้น = `PAUSED` เหตุ `page_limit` พร้อมผลที่อ่านแล้วและทางแนบ/กรอกต่อ (ไม่ตัดหน้าเงียบ) ตัวเลขนี้เป็น declared scope ของรอบนี้ ไม่ใช่ SLA

### 4.2 Preprocessing (API เป็นผู้ทำ; reuse `pdf-lib`, `pdfjs-dist` + `@napi-rs/canvas` ที่ image production มีแล้ว, `sharp`)

1. โหลด PDF ด้วย `pdf-lib` (`ignoreEncryption: false`): ติดรหัส → `FAILED/encrypted_pdf` (UXE-06), เปิดไม่ได้ → `FAILED/corrupt_pdf` (UXE-07); นับหน้า → manifest
2. จัด chunk: copy หน้าต่อเนื่อง ≤ 3 หน้าเป็น PDF ใหม่ (`copyPages`), วัด bytes; เกิน 4,000,000 → ลดจำนวนหน้าจน 1 หน้า; หน้าเดียวยังเกิน หรือหน้าเดียวเป็นภาพสแกนใหญ่ → render หน้าเป็นภาพด้วย pdfjs (scale ให้ด้านยาว ≤ 4000 px, JPEG q85 ผ่าน sharp) ตรวจ ≤ 3,500,000 bytes; ยังเกินหรือความสูง/กว้าง > 8000 → แบ่ง tiles 2×N พร้อม overview (ลดขนาด) และ overlap 5% ส่งเป็น images หลายภาพใน call เดียว (≤ 20)
3. Text layer (pdfjs `getTextContent`) เก็บเป็น evidence ต่อหน้าใน manifest (ไม่ส่งแทนภาพ; ใช้เทียบ/ค้นหา span เท่านั้น — ไม่เปลี่ยน vision policy)
4. ต้นฉบับไม่ถูกเขียนทับ; derivative อยู่ในหน่วยความจำ/ชั่วคราวเท่านั้น (ไม่เก็บถาวร) และ manifest อ้าง `attachmentChecksum` + `objectVersionId` ของต้นฉบับ

### 4.3 สัญญา gateway (ใหม่, versioned) — `packages/contracts/src/expense-capture.ts`

`EXPENSE_CAPTURE_CONTRACT_VERSION = 1`

- `POST /v1/internal/ai/capture-read` — stage 1 ต่อ chunk: request `{ requestId, companyId, userId, contractVersion: 1, chunk: { id, kind: 'pdf'|'image'|'tiles', mimeType, contentBase64?, images?: Array<{ contentBase64, mimeType, role: 'overview'|'tile', index }>, pageIndexes: number[], fileLabel: string }, modelPolicy?, budgetEnvelope? }`; response `{ status: 'ok'|'not_configured'|'failed', contractVersion, pages?: Array<{ pageIndex, text, truncated: boolean, blank: boolean }>, errorCode?, budgetScope?, usage?, modelLineage? }` — prompt = transcription เดียวกับ `bedrockOcrPrompt` เดิม + คั่นหน้า `=== PAGE <n> ===` + กติกาห้ามคำนวณ; `maxTokens 8192`; `max_tokens` → `truncated: true` ต่อหน้าท้ายสุด (API แบ่ง chunk ใหม่ ไม่ทิ้งหน้าที่สมบูรณ์)
- `POST /v1/internal/ai/capture-extract` — stage 2 ต่อ window: request `{ requestId, companyId, userId, contractVersion: 1, window: { fileLabel, pageIndexes, pages: Array<{ pageIndex, text }>, priorDocuments?: Array<{ ref, issuerName?, documentNumber?, documentDate?, currency?, openTotals: boolean }> }, activeCategories?, modelPolicy?, budgetEnvelope? }` (รวม text ≤ 12,000 ตัวอักษรต่อ window; API แบ่ง window ตามหน้า); response `{ status, contractVersion, observations?: ExpenseCaptureObservations, errorCode?, budgetScope?, usage?, modelLineage? }`
- ห้ามแตะ `receipt-ocr` เดิม (bank statement ใช้ร่วม); `MULTI_DOCUMENT` guard ของ contract เดิมคงอยู่

`ExpenseCaptureObservations` (ค่าเงินเป็น string; ทุก `evidenceSpan` ต้องเป็น substring ของ text หน้าที่อ้าง มิฉะนั้น field นั้นถูกทิ้งเป็น unknown — ใช้แนวเดียวกับ `applyOcrValueCrossCheck`):
- `documents[]`: `{ ref, pageIndexes, kind: BusinessDocumentKind, family, issuer: { name?, taxId?, branchCode?, storefront?, platform? }, buyer?: { name?, taxId? }, documentNumber?, documentDate?, currency?, printedPage?: { number?, of? }, continuationOfRef?, classification: BusinessDocumentClassification }`
- `items[]`: `{ id: '<page>:<line>', documentRef, description, quantity?, unit?, packSize?, unitPrice?, amount?, listPrice?, taxMarker?, event: 'sale'|'void'|'discount'|'price_correction'|'zero_price_promo'|'reward'|'info'|'unknown', linkedItemId?, evidenceSpan }`
- `components[]`: `{ id, documentRef, label, amount?, currency?, role: 'charge'|'applied_discount'|'tax_included'|'tax_additional'|'tax_unknown'|'tender'|'change'|'future_reward'|'refund'|'balance'|'summary'|'unclassified', scope: 'item'|'order'|'shipping'|'checkout'|'document', parentId?, appliedStatus: 'applied'|'pending'|'unknown', evidenceSpan }`
- `totals[]`: `{ documentRef, kind: 'merchandise'|'shipping'|'tax'|'document_total'|'buyer_payable'|'reported_paid', amount, evidenceSpan }`
- `payments[]`: `{ documentRef, method?, status: 'paid'|'pending'|'unknown', amount?, occurredAt?, reference?, evidenceSpan }`; `refunds[]`: `{ documentRef, state: 'requested'|'approved'|'processing'|'completed'|'unknown', amount?, destination?, evidenceSpan }`
- `completeness`: `{ itemsTruncated: boolean, unreadableRows: number, pagesCovered: number[], notes: string[] }`
- ขอบ: items ≤ 120 ต่อ window, components ≤ 40, documents ≤ 10; เกินขอบ → `itemsTruncated: true` (ไม่อ้างครบ)

### 4.4 Manifest / assembly / reconciliation (deterministic, API `expenses/domain/logic/expense-capture-*.logic.ts`)

- `manifestJson = { pageCount, pages: [{ index, printedNumber?, state: 'pending'|'read'|'partial'|'failed'|'blank', chunkId?, textLayerChars? }], chunks: [{ id, kind, pageIndexes, bytes, state: 'pending'|'done'|'failed', calls, errorCode? }], windows: [{ id, pageIndexes, state }], electronicVerification: { status: 'NOT_CHECKED'|'UNAVAILABLE' } }`
- ประกอบ document graph: หน้าต่อเนื่องที่ `continuationOfRef`/เลขเอกสาร+ผู้ออกเดียวกันรวมเป็นเอกสารเดียว; header/footer ซ้ำ (issuer/docNumber/total ที่ปรากฏซ้ำต่างหน้า) นับครั้งเดียวโดยอ้าง span แรก; items ไม่ dedup ด้วยชื่อ; void ที่ `linkedItemId` หักล้าง; `printedPage.of > pageCount` → `suspectedMissingPages`
- Reconciliation ด้วย `decimal.js`: ต่อเอกสาร `Σ sale − Σ void − Σ applied_discount(scope order/document) + Σ charge` เทียบ `document_total` (tolerance 0.05) → `reconciliation: 'reconciled'|'mismatch'|'insufficient'`; `buyer_payable`, `reported_paid`, `tender/change` (`68 = 500 − 432`) และ `future_reward` แยกค่า ไม่แตะกัน; ไม่สร้าง balancing component
- ผลรวมเป็น `ExpenseCaptureObservation(source: AI)` version ใหม่; ผลที่กลับหลัง revision/ไฟล์เปลี่ยน → `stale: true` ไม่ทับค่า HUMAN

### 4.5 Job runner (reuse pattern: OutboxEvent-style claim + BullMQ scan worker → internal route)

- ใน repo ไม่มี NestJS cron; งานเป็นคาบทุกอย่างคือ BullMQ repeatable job ใน `apps/workers` ที่ POST route `internal/*` ของ API ด้วย `X-Worker-Token` ผ่าน `postInternal` (`apps/workers/src/common/internal-api.ts:51`, มี 404 gate สำหรับ rolling deploy) — ต้องใช้ pattern นี้ ไม่ใช้ `setInterval` ใน API
- ตาราง `ExpenseCaptureReadJob` เป็น queue; claim หนึ่ง statement แบบ `prisma-outbox.repository.ts:92-105` (`UPDATE … WHERE id IN (SELECT id … WHERE status IN ('QUEUED','READING','PARTIAL') AND (leasedUntil IS NULL OR leasedUntil < now()) ORDER BY createdAt LIMIT n FOR UPDATE SKIP LOCKED) RETURNING *`) ตั้ง `leaseOwner`, `leasedUntil = now + 120 s`, `attempts + 1`; ต่ออายุ lease หลังทุก chunk; checkpoint หลังทุก chunk/window ก่อนรับงานถัดไป; ทุก write หลัง claim เป็น `updateMany` fenced ด้วย `leaseOwner` (คืน boolean)
- ผู้รัน: `ExpenseCaptureReadRunnerService` ใน API: (1) kick ทันทีหลัง persist ใน process เดียวกัน (claim ตัวเองแล้วประมวลผลแบบ fire-and-forget) (2) `POST /v1/internal/expenses/capture-read/drain` (`assertWorkerToken`, DTO class `batchSize ≤ 5`) claim งานที่ lease หมด/ค้าง แล้วเริ่มประมวลผลใน process โดยไม่ await (ตอบ `{ claimed }` ทันที) — เรียกจาก scan worker ใหม่ `apps/workers/src/modules/expense-capture-read/expense-capture-read-worker.ts` (`startScanWorker`, interval 30,000 ms) ลงทะเบียนใน `apps/workers/src/main.ts` (ไฟล์ pinned → re-pin) + แถวใน `SHADOW_SURFACE_CATALOG` + `main.spec.ts`; concurrency ต่อ process ≤ 2 jobs, ต่อบริษัท ≤ 1 job (`EXPENSE_CAPTURE_READ_CONCURRENCY`)
- อ่านต้นฉบับผ่าน `AttachmentStoragePort.getObject` (ไม่แตะไฟล์ pinned `create-upload-intent`/`create-download-url`/`s3-storage.adapter`)
- งบต่อ job: `providerCallCount ≤ 40`, เวลา ≤ 15 นาที (สะสมทุกครั้งที่รัน — W07-int), pixels ต่อ render ≤ 32M (reuse `SUBSTITUTE_RECEIPT_PDF_LIMITS.maxRasterPixels`), memory: ประมวลผลทีละ chunk และ derivative รวมต่อ job ≤ `EXPENSE_CAPTURE_DERIVATIVE_MAX_BYTES` (default 64 MiB — W07-int); เกิน → `PAUSED` พร้อม `pausedReason` (`call_budget|time_budget|page_limit|ai_credit|memory_budget`) และผลที่เก็บแล้ว
- Cancel/stale: replace primary หรือ detach ไฟล์ → job `CANCELLED`; ผลที่กลับหลัง cancel ไม่ apply; ตรวจ actor/company/branch/revision ก่อน apply/notify ทุกครั้ง; ownerType EXPENSE ใช้ `expectedSourceUpdatedAt` กับ `receipt-ocr-apply` fence เดิม

### 4.6 Quota/เงิน (reuse governance เดิม)

- OCR count: `admitCompanyOcr` ครั้งเดียวต่อ job (`sourceRoute 'receipt-capture-web'|'receipt-capture-line'`, `requestId = job.ocrAdmissionRequestId`) — หนึ่งไฟล์ = หนึ่งครั้งอ่าน ไม่ว่ากี่ chunk; retry ของ job เดิมไม่นับเพิ่ม; job ที่ไม่ได้ผลใช้ได้เลย → release เหมือนเดิม (`SYSTEM_FAILURE_NO_USABLE_RESULT`)
- เงิน: ทุก provider call เป็น step ของตัวเองผ่าน `runWithCompanyAiBudgetAdmission` (`stepKind 'receipt-capture-read'` bound `{ maxInputTokens 30,000, maxOutputTokens 8,192, maxCalls 1 }`, `'receipt-capture-extract'` `{ 30,000, 8,192, 1 }` ใน `ai-budget-bounds.ts`; `AI_BUDGET_DOCUMENT_MAX_PAGES` ใช้ 3 กับ chunk PDF); `attemptKey = capture:<jobId>:<chunkId|windowId>`; refusal → job `PAUSED/ai_credit` ข้อความ "เครดิตสำหรับการอ่านเอกสารไม่พอ" ตามคำศัพท์ wave 2 พร้อมผลที่อ่านแล้ว
- Usage events ต่อ call (`ocr.capture.read`, `ocr.capture.extract`) ตามเดิม; ไม่มี call ใดไม่ผ่าน envelope เมื่อบริษัท SPLIT

## 5. D06 — payer, lineage, consumer ที่ต้องรู้จัก sibling

- `ExpenseRecord.payerUserId` ตั้งได้เฉพาะโดย server จาก `group.payerUserId` ตอน handoff หรือจาก review ของ expense เดี่ยว (ผู้ตั้งต้องมี `expense.review` เมื่อไม่ใช่ตัวเอง) และถูก audit; ห้าม client ส่งค่าใน DTO ทั่วไป
- Resolver `readReimbursementSource` (`reimbursement-source.ts:26-35`): ลำดับ payer = certificate.payerUserId (กฎเดิม) → `expense.payerUserId` → `createdByUserId`; `ReimbursementEvidenceService.validate` (`:38-46`) และ picker (`prisma-reimbursement.repository.ts:319-323`) รับ `payerUserId = requester` เพิ่ม (OR)
- Ambiguity (`reimbursement-source.ts:96-99`): เมื่อมี `linkedExpenseId` ชัดและ expense อื่นที่ใช้ไฟล์เดียวกันมี `captureGroupId` เดียวกัน → ไม่ ambiguous; ไม่มี `linkedExpenseId` และมี > 1 → ยัง ambiguous; ไฟล์ร่วมกับ expense นอกกลุ่ม → ยัง ambiguous (A09/A16)
- Duplicate scoring (`expense-duplicate-detection.ts:41-58`, `findNearDuplicates :2745`): ข้าม candidate ที่ `captureGroupId` เดียวกัน; กลุ่มอื่นที่ใช้ไฟล์เดิม/เลขเอกสารเดิมยัง flag
- `retireReplacedPrimaryReceipts` ไม่ retire ไฟล์ที่กลุ่มอ้าง (`expense.capture.evidence` link = shared)
- Export/list: derived source เป็นเอกสารการเงินปกติ; `evidenceRef` เพิ่ม `captureGroupId`; งาน capture ไม่มีในรายการค่าใช้จ่าย/KPI/ledger (เป็น aggregate แยก มี list ของตัวเอง)

## 6. D07 — สิทธิ, launch route, flag

| การกระทำ | Permission (server) | หมายเหตุ |
|---|---|---|
| ดูกลุ่ม/ไฟล์/ผลอ่าน | `expense.read` หรือ (`expense.read_own` และเป็น creator) | ดาวน์โหลดไฟล์ผ่าน `attachment.read` + branch scope เดิม |
| สร้างกลุ่ม/เพิ่มไฟล์/เริ่มอ่าน | `expense.receipt.upload` \| `expense.receipt.line_upload` \| `expense.create` + `assertExpenseRootOpen` (route `expenses/DEFAULT` เดิม) + flag ข้างล่าง | pending-bytes quota เดิม |
| แก้ selection/businessUse/วันที่/ตัดไฟล์ | `expense.update` (creator) หรือ `expense.review` | ทุก mutation มี `expectedRevision` |
| ตั้ง payer เป็นผู้อื่น, tax review, ยอมรับ allocation | `expense.review` | payer = ตัวเอง ใช้ `expense.update` ได้ |
| handoff (สร้าง derived sources) / regenerate | `expense.create` \| `expense.receipt.upload` (creator) หรือ `expense.review` | ไม่มี financial finalization; expense ที่ได้ใช้ guard เดิมของมัน |
| ใบรับรอง / claim / confirm / pay | สิทธิเดิมของ route นั้น | ไม่เปลี่ยน |

Flag: `EXPENSE_CAPTURE_GROUP_INTAKE_ENABLED` (`packages/config` api schema, default `true`; `deploy.sh` input default `true`, `maintenance_only` บังคับ `false`; `infra/kamal/config.json` `"true"` ทั้ง production/uat) ปิด = ปฏิเสธการสร้างกลุ่ม/ไฟล์ใหม่ (`FEATURE_TEMPORARILY_UNAVAILABLE`) แต่ read/handoff/recovery ของกลุ่มเดิมยังทำงาน; job ที่ค้างยังจบได้ (A47)

## 7. D03/D04 — นโยบายเงินและใบรับรอง (ค่าเริ่มต้นที่เจ้าของต้องยืนยัน ข้อ 15)

- `shared-discount-v1`: ส่วนลดที่ scope order/checkout แบ่งตามสัดส่วนยอดสินค้าหลังส่วนลดร้าน (net) ของสินค้าที่มีสิทธิในโปรโมชั่น รวมสินค้าส่วนตัวในฐาน แล้วจึงตัดส่วนตัวออก; ส่วนลดระดับ item ติดกับ item; largest remainder ถึงสตางค์ tie-break ตาม item id; Σ share = ส่วนลดต้นทาง
- `shipping-by-eligible-item-v1`: ค่าส่งของพัสดุ/ร้านแบ่งตามสัดส่วน net ของสินค้าในพัสดุนั้น (บริษัท:ส่วนตัว); ค่าส่ง net (gross − ส่วนลดส่ง) นับครั้งเดียว
- Coins ที่ใช้แล้วและมีหลักฐาน = `applied_discount`; coins/cashback ที่จะได้รับ = `future_reward` ไม่ลดยอด; wallet เป็น tender
- Company-funded + มีของส่วนตัว (A05): allocation คำนวณและแสดงได้ แต่ handoff ถูก block ด้วยเหตุ "รอทางเรียกคืนส่วนตัวจากบริษัท (ยังไม่รองรับ)" — ไม่สร้าง expense ยอดบริษัทเพื่อซ่อนเงินบริษัทที่จ่ายส่วนตัว
- Tax review: ค่าเริ่มต้นจาก facts (ใบกำกับภาษี/VAT ปรากฏ → `VAT_INCLUDED` + `NEEDS_REVIEW` ใน FULL mode; ไม่มี VAT → `NO_VAT` + `NON_CLAIMABLE`); employee route ต้องการ `NON_CLAIMABLE`/ไม่มี WHT — ผู้มี `expense.review` ตัดสินตาม facts; ไม่บังคับค่าเพื่อให้ผ่าน resolver; ยังไม่ตัดสิน = derived source `NEEDS_REVIEW` และ claim ยังไม่ได้ ("รอตรวจภาษี")
- `expenseDate` ของ derived source = วันที่ชำระที่ตรวจแล้ว ถ้าไม่มีใช้วันที่เอกสาร; ผู้ review เลือกได้; วันอัปโหลดไม่ใช้
- D04 ใบรับรอง: prefill จาก allocation; wording ในใบ/preview "ใบรับรองนี้รับรองส่วนของบริษัท {companyAmount} บาท จากยอดที่จ่ายจริง {paidTotal} บาท ตามการจัดส่วนที่ตรวจแล้ว (กลุ่มหลักฐาน {groupRef} ครั้งที่ {allocationRevision})"; eligibility/payment-once/PAPER/DIGITAL ตามกฎเดิมทุกข้อ

## 8. D08/D09

- D08: ไฟล์ของกลุ่มอยู่ใต้ processor/retention เดิมของ attachment (Postgres blob, ClamAV, AI provider เดิม); กลุ่มที่จบ `CLOSED_NO_HANDOFF`/`CANCELLED` หรือ `OPEN` ที่ไม่มีการเปลี่ยนแปลง ≥ `EXPENSE_CAPTURE_RETENTION_DAYS` (default 90 = `AI_DATA_RETENTION_DAYS`) → ไฟล์ที่ไม่มี expense/certificate อ้าง ถูก `markDeleted` โดย sweep เดียวกับ purge; บันทึกใน ROPA ว่าเป็น "เอกสารหลักฐานค่าใช้จ่าย" ฐานสัญญา/ประโยชน์อันชอบธรรม เจ้าของยืนยันข้อ 15
- D09: ทุกไฟล์มี `electronicVerification.status ∈ {NOT_CHECKED, UNAVAILABLE}` เท่านั้นในรอบนี้; UI แสดง "ยังไม่ได้ตรวจสอบเอกสารอิเล็กทรอนิกส์"; ไม่มีคำว่า passed/verified จากการอ่านสำเร็จ

## 9. API ของกลุ่ม (NestJS `expenses` module; ทุก endpoint ตรวจ company/branch/permission ที่ server)

```
GET    /v1/companies/{c}/expenses/capture-capability
POST   /v1/companies/{c}/expenses/capture-groups                       { branchId?, note? }                         → { groupId, revision }
GET    /v1/companies/{c}/expenses/capture-groups?status=&page=          รายการงานรับหลักฐาน (แยกจากรายการค่าใช้จ่าย)
GET    /v1/companies/{c}/expenses/capture-groups/{g}                    facts ปัจจุบัน, ไฟล์+สถานะอ่าน, allocation preview/accepted, derived sources, blockers, allowedActions
POST   /v1/companies/{c}/expenses/capture-groups/{g}/files             { originalFileName, mimeType, byteSize, expectedRevision } → { fileId, attachmentId, uploadUrl, uploadMethod, uploadHeaders }
POST   /v1/companies/{c}/expenses/capture-groups/{g}/files/{f}/complete { byteSize, checksumSha256?, expectedRevision }   → job queued (idempotent เมื่อ STORED แล้ว)
POST   /v1/companies/{c}/expenses/capture-groups/{g}/files/{f}/detach  { reason, expectedRevision }
GET    /v1/companies/{c}/expenses/capture-groups/{g}/read-status       { files: [{ fileId, status, pagesRead, pageCount, pausedReason }] } (polling; ไม่เริ่มอ่าน)
POST   /v1/companies/{c}/expenses/capture-groups/{g}/facts             { fileId, patch (HUMAN observation ใหม่: แก้ item/total/unknown), expectedRevision }
POST   /v1/companies/{c}/expenses/capture-groups/{g}/review            { businessUse, selection, fundingRoute, payerUserId?, taxReview?, expenseDateChoice?, expectedRevision } → allocation PREVIEW
POST   /v1/companies/{c}/expenses/capture-groups/{g}/allocations/{a}/accept { expectedRevision }
POST   /v1/companies/{c}/expenses/capture-groups/{g}/handoff           { allocationId, expectedRevision, idempotencyKey } → { expenses: [{ expenseId, scopeKey }] }  (batch เดียว; retry คืนชุดเดิม)
POST   /v1/companies/{c}/expenses/capture-groups/{g}/close             { reason: 'NO_COMPANY_PORTION'|'CANCELLED', expectedRevision }
POST   /v1/companies/{c}/expenses/{expenseId}/capture-group            { expectedUpdatedAt } (ข้อ 3.1)
POST   /v1/companies/{c}/expenses/{expenseId}/receipt-uploads/{attachmentId}/complete  (เดิม) + { expectedUpdatedAt, expectedPrimaryAttachmentId, intent: 'replace'|'append', operationId }
GET    /v1/companies/{c}/expenses/{expenseId}/read-status              (job ของ expense เดี่ยว)
```
- ทุก 409/422 มี code snake_case + ข้อความไทยใน `api-error-message.ts` (spec ของ web บังคับ)
- Handoff idempotency: `idempotencyKey` ผูก `(groupId, allocationId)`; DB unique `handoffBatchKey` + `(companyId, captureGroupId, captureScopeKey)` กันสองผู้ใช้/สองแท็บ (A10)
- Regenerate: `POST …/handoff` ใหม่หลัง allocation ใหม่ อนุญาตเมื่อ derived sources เดิมทุกตัวยังไม่ถูกใช้ (status DRAFT|NEEDS_REVIEW|READY_FOR_CONFIRMATION, `paidAmount = 0`, `postingStatus not_required`, ไม่มี `ReimbursementLine` ที่ไม่ terminal, ไม่มี certificate ≥ PREPARED) — server ลบ (delete use-case เดิม) แล้วสร้างชุดใหม่ใน transaction เดียว; มิฉะนั้น 409 `expense_capture_handoff_consumed` พร้อมทางแก้ (correction ของรายการนั้น)

## 10. §17 — reason → สถานะ → ปุ่ม (mapping ที่ implement)

| กรณี | reason code (server) | persist-state | ข้อความ/ปุ่ม (§17.2) | ที่ใช้ |
|---|---|---|---|---|
| upload ไม่ถึง (web) | client `upload_transport_failed` | unsaved | UXE-01 ส่งไฟล์นี้อีกครั้ง | UploadPanel/กลุ่ม |
| complete ไม่ทราบผล | client unknown response | unknown | UXE-02 ตรวจสอบสถานะ (GET group/read-status ด้วย operation เดิม) | web |
| LINE download null | `LINE_MEDIA_DOWNLOAD_FAILED` (+ `oversize_declared`/`oversize_measured`/`download_http`/`download_timeout`/`credentials` ใน attempt) | REJECTED | UXE-03 "ยังรับไฟล์นี้จาก LINE ไม่สำเร็จ" (ไฟล์/รูป ตามชนิดจริง) | LINE |
| mime/นามสกุล | `METADATA_REJECTED`/`EXTENSION_MIME_MISMATCH` | REJECTED | UXE-04 | ทั้งสามทาง |
| เกินขนาด | `attachment_too_large` (bytes + limit) | REJECTED | UXE-05 (ตัวเลขจาก capability) | ทั้งสามทาง |
| PDF ติดรหัส/เสีย | job `encrypted_pdf`/`corrupt_pdf` | STORED_READ_FAILED | UXE-06/07 + กรอกข้อมูลต่อ (ไฟล์ยังอยู่) | job |
| security | `CONTENT_REJECTED`/`MALWARE_DETECTED`/`MALWARE_SCAN_FAILED` | REJECTED/QUARANTINED | UXE-08/09 | ทั้งสามทาง |
| AI failed หลังเก็บ | job `FAILED` (`provider_*`, `OCR_*`) | STORED_READ_FAILED | UXE-10 "อ่านข้อมูลไม่สำเร็จค่ะ เก็บไฟล์ไว้แล้ว กดกรอกข้อมูลต่อได้ที่นี่" + **กรอกข้อมูลต่อ** | LINE push/web notice |
| บริษัทปิด AI/ไม่มี provider | `OCR_FEATURE_DISABLED`/`not_configured` | STORED | UXE-11 | |
| เครดิต/โควตาหมด | `OCR_MONTHLY_LIMIT_EXCEEDED`/`AI_MONTHLY_BUDGET_EXCEEDED`/`AI_BUDGET_INSUFFICIENT` | STORED / PAUSED(ai_credit) | UXE-12 (คำว่า เครดิต) | |
| อ่านบางส่วน | job `PARTIAL` | STORED_READ_PARTIAL | UXE-13 | |
| หยุดเพราะขอบ | job `PAUSED` (`page_limit|call_budget|time_budget|memory_budget`) | STORED_READ_PARTIAL | UXE-14 | |
| หน้าขาด | assembly `suspectedMissingPages` | DONE | UXE-15 แนบหลักฐานเพิ่ม | web group page |
| ยอดขัดกัน | `reconciliation: mismatch`/ambiguous grouping | DONE | UXE-16 ตรวจจุดที่ไม่ตรง | |
| electronic | `electronicVerification.NOT_CHECKED/UNAVAILABLE` | — | UXE-17 (ยังตรวจไม่ได้) | |
| session/สิทธิ์ | 401/403 codes | — | UXE-18 (login?next= / กลับรายการที่มีสิทธิ์) | web |
| replace fail (ไม่ bind) | `expense_receipt_replace_failed` | current เดิม | UXE-19 | |
| replace bind แล้ว AI fail | job FAILED บน attachment ใหม่ | STORED_READ_FAILED | UXE-20 | |
| revision conflict | `expense_capture_group_revision_conflict`/`expense_revision_conflict` | — | UXE-21 เปิดข้อมูลล่าสุด | |
| locked state | `substitute_evidence_locks_expense`/`expense_receipt_removal_locked`/… | — | UXE-22 | |
| duplicate | `POSSIBLE_DUPLICATE` | — | UXE-23 | |
| handoff/certificate ผลหาย/บางร้าน | operation/handoffBatchKey เดิม | — | UXE-24 ตรวจสอบสถานะรายการ | |
| LINE delivery fail | `LINE_DELIVERY_FAILED` (outcome เก็บ) | DONE | UXE-25 | |
| หลักฐานไม่พอ | `missing_receipt`/eligibility | — | UXE-26 เพิ่มหลักฐาน (ใบรับรองเฉพาะ eligibility) | |
| อื่น ๆ | unknown | unknown | UXE-27 ตรวจสอบสถานะ + รหัสอ้างอิง (requestId) | |

ปุ่ม **กรอกข้อมูลต่อ**: expense มีอยู่ → `/companies/{c}/expenses/{expenseId}`; งานเป็นกลุ่ม → `/companies/{c}/expenses/capture/{groupId}`; URL สร้างจาก `absoluteWebLink(webBaseUrl, …)` เดิม; GET ไม่สร้าง/ไม่อ่านซ้ำ/ไม่ส่งเบิก; login-return ผ่าน `?next=` เดิม; LINE ใช้ `/l/{token}` handoff เดิมเมื่อผู้ใช้ยังไม่ login

### 10.1 §17.5 LINE ถามย้อนหลัง (deterministic ก่อน AI)

- ตัวจับคำถาม (regex ใน `line-receipt-status.logic.ts`): "ไฟล์/รูป เมื่อกี้|เมื่อสักครู่|ล่าสุด", "ส่งไม่ได้|รับไม่ได้|ทำไม", "ใหญ่ไป|ขนาด", "รองรับ PDF|ส่ง PDF ได้", "ต้องส่งใหม่", "บันทึกไปหรือยัง|เก็บไว้หรือยัง" → handler อ่าน `LineIntakeAttempt` (actor/company/chat, ≤ 24 ชม., ≤ 5 รายการ) และสถานะปัจจุบันของ target (job/expense/group): 1 รายการ → ตอบตามตาราง §17.5; หลายรายการ → "หมายถึงไฟล์ไหนคะ" + ตัวเลือก (ชื่อย่อ/เวลา/สถานะ) ผูกคำตอบถัดไป; ไม่พบ → "ตอนนี้ยังไม่พบไฟล์ที่จะอ่านค่ะ กด + → ไฟล์ …"; lookup ล่ม → "ตอนนี้ยังตรวจสอบสถานะไม่ได้ …"
- Read tool สำหรับเส้นทาง LLM: `line.explain_file_attempt` (category read_detail, permissions capture เดิม) คืน `{ attempts: [{ ref, messageType, fileNameSanitized, stage, reasonCode, capability, outcome, currentStatus, recoveryAction: { kind, url? } }] }` — ข้อความยืนยันสาเหตุมาจาก template ของ API เท่านั้น; ไม่มี mutation/ไม่ OCR

### 10.2 §18.4 NR01–NR09

`formatBusinessDocumentReply` (`process-line-webhook.use-case.ts:617-647`) + reference branch (`:6093-6139`): จำแนก `DELIVERY_NOTE` ที่มี signal ใบปะหน้า/ใบนำฝาก (คำว่า "ใบปะหน้า|Shipping Label|AWB|Tracking" / "ใบนำฝาก|ใบรับฝาก|Drop-off") ผ่าน `classification.evidenceSignals` (gateway เพิ่ม reasonCode `PARCEL_LABEL_SIGNAL`/`DEPOSIT_SLIP_SIGNAL` โดยไม่เพิ่ม documentKind) → NR01/NR02; `QUOTATION|PURCHASE_ORDER|DELIVERY_NOTE` → NR03; `SUPPLIER_INVOICE_OR_BILL` ที่ผ่าน eligibility → NR04 (เข้า review เดิม); `TRANSFER_SLIP|MARKETPLACE_ORDER` → NR05; check-bill → NR06 (continuation เดิม); `NON_FINANCIAL_IMAGE` → NR07; `NEEDS_REVIEW|AMBIGUOUS` → NR08; failed/partial → NR09 (= §17.6). NR01–NR03/NR08 ที่มี expense intent + สิทธิ → เก็บ pending media/กลุ่ม (LINE file = กลุ่มอยู่แล้ว; รูป = `ensurePendingMedia` เดิม) ก่อนบอก "เก็บไฟล์ไว้แล้ว" และให้ลิงก์ **กรอกข้อมูลต่อ** ไปงานเดิม; NR07 ไม่เก็บ

## 11. Web (Next.js) — surfaces

- `UploadPanel`: `multiple` + drop หลายไฟล์; 1 รูป → path เดิม; อื่น → กลุ่ม; รายการไฟล์แสดงสถานะรายไฟล์ (กำลังอัปโหลด / เก็บไฟล์แล้ว กำลังอ่าน / อ่านแล้ว n/m หน้า / อ่านไม่สำเร็จ / ส่งไม่สำเร็จ → ส่งไฟล์นี้อีกครั้ง) และ resume จาก manifest server หลังปิดหน้า (ไฟล์ที่ bytes ยังไม่ถึงต้องเลือกใหม่)
- หน้า `/companies/{c}/expenses/capture/{groupId}` (`ExpenseCaptureGroupPage`): สรุป "พบ N ร้าน • M รายการ (อ่านครบ/ยังไม่ครบ)", ยอดจ่ายรวมที่พบ, ส่วนของบริษัท, ผู้จ่าย, รายการที่ต้องตรวจ (blockers ก่อนปุ่ม), ตารางสินค้ารายร้านพร้อม stepper "ส่วนตัวกี่ชิ้น", คำถาม "ใช้สำหรับบริษัททั้งหมด / มีของส่วนตัวด้วย" และ "ใครเป็นคนจ่ายรายการนี้" (เฉพาะเมื่อยังไม่รู้; รับคำตอบบางส่วน), รายละเอียดส่วนลด/ค่าส่งเปิดเพิ่ม, ปุ่มหลักหนึ่งปุ่มตามสถานะ (สร้างรายการค่าใช้จ่าย / เตรียมใบเบิก / ตรวจภาษี), "เก็บไว้ก่อน" ทุก state, ไฟล์: ดู/แนบเพิ่ม/เปลี่ยนไฟล์นี้/ตัดออก, สถานะ electronic "ยังไม่ได้ตรวจ", derived sources พร้อมสถานะ/ใบรับรอง/ใบเบิกรายร้าน; mobile 390 ไม่มี horizontal scroll, ตัวอักษร 18 px, ปุ่ม ≥ 44 px
- `ExpenseReviewPage`: สถานะอ่าน job (n/m หน้า), notice ตาม §17 (ไม่มี "ลองอ่านเอกสารอีกครั้ง" ใน terminal failed), "มีของส่วนตัวด้วย"/"แยกเป็นกลุ่มหลักฐาน" (ข้อ 3.1), ป้าย "จากกลุ่มหลักฐาน" + ลิงก์กลุ่ม
- Dictionary: ทุกข้อความไทยใหม่อยู่ใน `workspace-dictionary.ts` (th + en) และ `api-error-message.ts`; guard spec ห้ามคำว่า "งบ AI/โควตา AI" ยังมีผล

## 12. Consumer inventory ที่ต้องแก้/ยืนยัน (จากการอ่านโค้ด 2026-09-18)

| จุด | ไฟล์ | ต้องทำ |
|---|---|---|
| ambiguity/review-required/payer | `reimbursements/infrastructure/reimbursement-source.ts:26-35, 96-99, 123-130` | ข้อ 5 |
| picker/evidence payer | `prisma-reimbursement.repository.ts:316-338`, `reimbursement-evidence.service.ts:22-48` | รับ payerUserId |
| duplicate | `expense-duplicate-detection.ts:10-70`, `prisma-expense.repository.ts:2745-2809` | sibling exclusion |
| upload complete/retire | `expense-upload.use-case.ts:181-315` | expected target/intent/operation; shared-file retention |
| extraction gate | `expense-extraction.use-case.ts:17-21, 104-109` | route PDF ไป job |
| apply fences | `receipt-ocr-apply.service.ts:918-1218` | reuse (ownerType EXPENSE) |
| remove receipt | `remove-expense-receipt.use-case.ts:21-62` | ไฟล์ที่กลุ่มอ้าง = ไม่ลบ object |
| export/list | `expense-export.logic.ts:78-114`, `prisma-expense.repository.ts:773-788` | evidenceRef group; ไม่มี parent ให้กรอง |
| LINE media | `process-line-webhook.use-case.ts:5511-6420, 6470-6530, 7218-7308, 7586-7687` | file lane, attempts, copy |
| LINE status | `:3771-3812`, `erp-core-detail-tools.use-case.ts:237-344` | attempt Q&A + tool |
| gateway | `line-ai-internal.controller.ts` (ใหม่ 2 routes), `ai-budget-bounds.ts`, `ai-budget-provider.ts:92-146` | capture contract, step kinds |
| config/deploy | `packages/config/src/index.ts`, `infra/prod-ecs-express/deploy.sh` (pinned → re-pin; 8 จุดตามแบบ `AI_BUDGET_SPLIT_ACTIVATION_ENABLED` + `production-serving-mode.spec.sh`), `infra/kamal/config.json` | flag + limits |
| workers | `apps/workers/src/main.ts` (pinned → re-pin), `apps/workers/src/modules/expense-capture-read/*`, `feature-launch/domain/shadow-surface.catalog.ts` | scan worker + internal drain |
| audit | `audit/domain/models/audit-action.ts` (const object; อย่าแตะบรรทัด `PLATFORM_ACCESS_STATE_UPDATE`) | `expense.capture_group.*`, `expense.capture_handoff.*`, `expense.payer.set` |
| web link | `common/http/web-link.ts` `absoluteWebLink(config.webBaseUrl, path)`; handoff wrapper `line-handoff-link.service.ts` surface ใหม่ `line_capture_result` | ลิงก์กรอกข้อมูลต่อ |
| PG specs | `<AREA>_TEST_DATABASE_URL` + `<AREA>_REQUIRE_POSTGRES`, local-host guard (`company-ai-credit-holds.pg.spec.ts:112`), wire ใน `ci.yml` step P27 | `EXPENSE_CAPTURE_TEST_DATABASE_URL` |
| web | `ExpensesPages.tsx` UploadPanel, `ExpenseReviewPage.tsx`, `expenses.api.ts`, `expense-upload.logic.ts`, dictionary, error map | ข้อ 11 |

## 13. Fixture manifest (synthetic, ไม่มีข้อมูลบุคคลจริง; สร้างด้วยสคริปต์ใน repo)

| ID | ไฟล์ | ใช้พิสูจน์ |
|---|---|---|
| FX-PDF-02/05/10/20 | PDF native text 2/5/10/20 หน้า ใบเดียว (header หน้าแรก, รายการต่อเนื่อง, total หน้าสุดท้าย, ยอดยกไป) | A81/A77/A75 |
| FX-PDF-MULTI-03 | PDF 3 ใบเสร็จคนละร้านในไฟล์เดียว (หน้าละใบ) | A65/A82/A54 |
| FX-PDF-SCAN-05 | PDF หน้าสแกน (ภาพ) 5 หน้า ~9.9 MB | A75/A76 |
| FX-PDF-MIXED-06 | text + scan ผสม | A81 |
| FX-PDF-BIG-01 | หน้าเดียวภาพใหญ่ (8500 px) ~10 MB | A76 tiles |
| FX-PDF-ENC-01 / FX-PDF-CORRUPT-01 | ติดรหัส / bytes เสีย | UXE-06/07, A64/A80 |
| FX-PDF-MISSING-01 | เลขหน้า 1/3 และ 3/3 ใน 2 หน้า | UXE-15/A82 |
| FX-PDF-50/100 | 50/100 หน้า (บาง) | A79 page_limit/PAUSED |
| FX-IMG-MP-A03 | ภาพ checkout: 1,500 − 100 − 140 + 100 − 70 = 1,290, สองร้าน | A03/A04/A05 allocation |
| FX-IMG-RETAIL-R7-02 | cash 500 change 432 (68) | A49 |
| FX-IMG-VOID | void 59/−59/53 | A52 |
| FX-BOUNDARY | 4,000,000 / 4,000,001 / 4,194,304 / 4,194,305 / 10,485,760 / 10,485,761 bytes | A67 |
| FX-LINE-FILE-* | raw webhook `message.type=file` (no contentBase64) ± caption, expired media, oversize declared | A68/A86–A88 |

## 14. ลำดับงานและ verification ของรอบนี้

W01 (schema/contracts/guards/pg) → W02-web (multi-file, replace intent, resume, notices) ∥ W02-LINE (file lane, attempts, §17.5/17.6/18.4) ∥ W03 (preprocess, job, gateway contract, assembly) → W04 (allocation + group page) → W05+W07 (handoff, resolver, export, LINE status) → W06 (certificate per source) → W08 (regression matrix, evidence bundle, docs) → gate → PRs ทุก wave ต้องผ่าน: contracts/config build, api/gateway/web full test + typecheck, whole-chain runner, harness, pg specs ที่ตนเพิ่ม, pins `--check`, `git diff --check`

## 15. ข้อที่เจ้าของต้องยืนยัน (ใช้ค่าเริ่มต้นนี้จนกว่าจะแย้ง)

1. D03: `shared-discount-v1` / `shipping-by-eligible-item-v1` เป็นค่าเริ่มต้นทั้งระบบในรุ่นแรก (ไม่มีหน้าตั้งค่ารายบริษัท; บันทึก policyVersion ใน snapshot เพื่อเปลี่ยนภายหลังได้)
2. D07: `EXPENSE_CAPTURE_GROUP_INTAKE_ENABLED = true` ทั้ง UAT และ Production ตั้งแต่ deploy ถัดไป (เหมือน `AI_BUDGET_SPLIT_ACTIVATION_ENABLED`)
3. D08: กลุ่มที่ไม่มีเอกสารการเงิน — ลบไฟล์หลัง 90 วัน (`EXPENSE_CAPTURE_RETENTION_DAYS`)
4. D04 wording ใบรับรองส่วนบริษัท (ข้อ 7)
5. Bedrock replay ด้วย fixture สังเคราะห์เพื่อพิสูจน์ pipeline จริง (ประมาณ ≤ THB 100 ภายใต้ ledger เดิม `watchdog-bedrock`)

## 16. Implementation notes (W01, 2026-09-18)

สิ่งที่ implement ต่างจากตัวอักษรของเอกสารนี้ พร้อมเหตุผล (ทุกข้อไม่เปลี่ยนกติกาเงิน/สิทธิ):

1. **Partial unique index ข้อ 2.3 ใช้ unique index ธรรมดา** `@@unique([companyId, captureGroupId, captureScopeKey])` แทน raw SQL `… WHERE "captureGroupId" IS NOT NULL` — Postgres นับ NULL เป็นค่าต่างกัน ผลบังคับจึงเท่ากันทุกกรณี (แถวเดิม/ค่าใช้จ่ายธรรมดา `captureGroupId` เป็น null จึงไม่ถูกบังคับ) แต่เขียนใน `schema.prisma` ได้ ทำให้ `prisma migrate diff` ไม่มองว่า index นี้เป็น drift ที่ต้อง drop; pg spec พิสูจน์ว่า derived source ที่สองของ scope เดิมถูกปฏิเสธด้วย P2002 จริง
2. **`ExpenseCaptureGroup.note`** เป็นคอลัมน์เพิ่ม (ข้อ 2.2 ไม่ได้ระบุ) เพราะ body ของ `POST capture-groups` ในข้อ 9 รับ `note?`
3. **`ExpenseCaptureObservation` มี `@@index([companyId, groupId])`** เพิ่มจากข้อ 2.2 เพราะหน้ารายละเอียดกลุ่มอ่าน observation ทั้งกลุ่มเป็น query หลัก; **`LineIntakeAttempt` มี `@@index([createdAt])`** เพราะ purge กวาดข้ามบริษัทตามอายุ
4. **ความสัมพันธ์**: relation ไป `Company` เป็น `Cascade` เหมือนทุกตารางในสคีมานี้; relation ของ `ExpenseCaptureFile` ไป group/`AttachmentObject` เป็น `Restrict`; ส่วนคอลัมน์ lineage บน `ExpenseRecord` (`captureGroupId`, `captureAllocationId`) เป็นคอลัมน์เปล่าไม่มี FK ตามที่ข้อ 2.3 เขียนไว้ — FK แบบ Restrict ที่ Company cascade ลงไปทั้งสองฝั่งจะทำให้ลบบริษัทล้มเหลวตามลำดับที่ Postgres เลือก
5. **`checkpointJson`** มี default `{}` (ข้อ 2.2 ระบุว่าไม่ nullable แต่ไม่ได้ให้ค่าเริ่มต้น)
6. **flag ปิด = ปฏิเสธเฉพาะการรับหลักฐานใหม่** (สร้างกลุ่ม / เพิ่มไฟล์ / แปลง expense เป็นกลุ่ม) ส่วน `POST …/files/{f}/complete` ยังทำงานได้ เพราะเป็นการปิดงานอัปโหลดที่จองไว้แล้ว (recovery) ตามเจตนา A47 ที่ให้ job ค้างจบได้ — มี unit test ยืนยันทั้งสองฝั่ง
7. **payer ใน snapshot ของ resolver**: ใส่ `payerUserId` เฉพาะเมื่อมีค่า (ไม่ใส่ `null`) เพราะ `assertReimbursementSources` เทียบ snapshot ที่ปักไว้กับที่อ่านใหม่แบบ deep-equal — การใส่ `null` จะทำให้ใบเบิกทุกใบที่ร่างไว้ก่อน deploy กลายเป็น `reimbursement_source_changed`
8. **ค่าที่ยังไม่ทำใน W01** (ตามลำดับงานข้อ 14): runner/lease/checkpoint ของ job, preprocessing, gateway routes สองเส้น, allocation math, handoff, web/LINE surface — W01 วางเฉพาะ schema, contract, config/flag, API ของกลุ่ม, guard ของ lineage และ pg proof

## 17. Implementation notes (W04a — allocation engine + review/accept API, 2026-09-18)

W04a ส่ง 3 ส่วน: `assembleCaptureFacts` (§4.4), `computeCaptureAllocation` (§7) และ 3 endpoint ของข้อ 9 (`facts`, `review`, `allocations/{a}/accept`) หน้ากลุ่ม (W04b) และ handoff (W05) ยังไม่ทำในรอบนี้

### 17.1 ลำดับการคิดเงิน (policy `shared-discount-v1+shipping-by-eligible-item-v1`)

ทุกขั้นใช้ largest remainder ถึงสตางค์ tie-break ตาม item id (`shareByBasis`) และ Σ share = ยอดต้นทางเสมอ

1. `base_i` = `amount` ถ้ามี ไม่มีจึงใช้ `quantity × unitPrice` (ไม่คูณซ้ำ, spec §6 ข้อ 1); อ่านไม่ได้ = unknown ไม่ใช่ 0
2. − `applied_discount` scope `item` ที่ `parentId` ชี้มาที่แถวนั้น → `net1`
3. − `applied_discount` scope `order|document` แบ่งตามสัดส่วน `net1` ของสินค้าในเอกสารนั้น → `net2`
4. − `applied_discount` scope `checkout` แบ่งตามสัดส่วน `net2` ของสินค้าทุกเอกสาร**ในไฟล์เดียวกัน** (= "หลังส่วนลดร้าน" ข้อ 7) → `net3`
5. + `charge` scope `shipping|order` หัก `applied_discount` scope `shipping` ของเอกสารเดียวกันก่อน (นับครั้งเดียว) แล้วแบ่งตาม `net3`; charge scope อื่นแบ่งแบบเดียวกัน
6. ส่วนของบริษัทต่อแถว = ยอดแต่ละก้อน × `companyQty / (quantity − voidedQuantity)` ปัดสตางค์ HALF_UP; ที่เหลือเป็นส่วนตัว (ข้อ 5 ของ spec §6: ส่วนลดของสินค้าส่วนตัวถูกทิ้ง ไม่ย้ายมาให้บริษัท)
7. ต่อ scope (ผู้ออกเอกสาร) สร้างบรรทัดผ่าน `calcLineTotals` + `calcDocumentTotals` → `expenseTotalsIdentityError` เป็น null โดยโครงสร้าง (ยืนยันทุก fixture + property test 200 ชุด); ไม่ผ่านเมื่อไรคืน blocker `expense_capture_totals_identity_failed` พร้อมข้อความ ไม่มีการปัดยอดให้ตรง

**ตัวอย่าง A03 (basis ที่บันทึกไว้ในเทสต์):** ร้านเอ 1,000.00 + ร้านบี 500.00 = 1,500.00; ส่วนลดร้าน 100.00 (scope order, ร้านเอ); คูปอง 140.00 (scope checkout) แบ่งตามฐานหลังส่วนลดร้าน 900 : 500 จาก 1,400 → ร้านเอ 90.00 / ร้านบี 50.00; ค่าส่ง 100.00 − ส่วนลดค่าส่ง 70.00 = 30.00 อยู่กับพัสดุของร้านบี → **ร้านเอ 810.00 / ร้านบี 480.00 / รวมจ่าย 1,290.00** และทั้งสองเอกสาร `reconciled`

### 17.2 Blocker (code → เมื่อไรเกิด → อะไรทำให้หาย)

| code | ระดับ | เกิดเมื่อ | หายเมื่อ |
|---|---|---|---|
| `expense_capture_business_use_required` | group | `businessUse = UNKNOWN` | ส่ง `businessUse` ใน `review` |
| `expense_capture_funding_route_required` | group | `fundingRoute = UNKNOWN` | ส่ง `fundingRoute` |
| `expense_capture_payer_required` | group | route `EMPLOYEE` ไม่มี `payerUserId` | ระบุผู้จ่ายที่เป็นสมาชิก ACTIVE |
| `expense_capture_company_paid_personal_portion` | group | route `COMPANY` และมีส่วนตัว > 0 (A05) | เปลี่ยน selection หรือเปลี่ยน route |
| `expense_capture_item_amount_unknown` | scope + group | สินค้าที่เลือกเป็นของบริษัทยังไม่มียอด (A28/A41) | แก้ผ่าน `POST …/facts` |
| `expense_capture_document_mismatch` | scope + group | เอกสารใน scope `reconciliation = mismatch` (A24/A34/A58) | แก้ facts ให้ตรงหลักฐาน |
| `expense_capture_component_unclassified` | scope + group | มี `unclassified`/`tax_unknown` และเอกสารยังไม่ reconciled | ระบุ `role` ผ่าน `facts` |
| `expense_capture_expense_date_required` | scope + group | ไม่มีวันที่ หรือวันที่ที่เลือกเป็นอนาคต (A42) | `expenseDateChoice` หรือแก้ facts |
| `expense_capture_currency_unsupported` | scope + group | `currency ≠ THB` (A31) | ยังไม่รองรับในรุ่นนี้ |
| `expense_capture_totals_identity_failed` | scope + group | identity ไม่ผ่าน (bug guard) | แจ้งผู้ดูแลระบบ |
| `expense_capture_tax_review_pending` | scope เท่านั้น | route `EMPLOYEE` ที่ยังไม่ `NON_CLAIMABLE` + ไม่มี `NEEDS_REVIEW` | `taxReview` โดยผู้มี `expense.review` |
| `expense_capture_review_required` | group (read model) | มี facts แต่ยังไม่มี allocation | กด `review` |

`outcome = BLOCKED` เมื่อมี group blocker; `NO_COMPANY_PORTION` เมื่อไม่มี blocker และส่วนบริษัท = 0; มิฉะนั้น `READY` — `tax_review_pending` เป็น scope-level เท่านั้นจึงไม่บล็อกการ accept (§7: source เกิดได้ ใบเบิกรอตรวจภาษี)

### 17.3 สิ่งที่ต่างจากตัวอักษรของเอกสารนี้ พร้อมเหตุผล (ไม่มีข้อใดเปลี่ยนกติกาเงิน/สิทธิ)

1. **Blocker code มี prefix `expense_capture_`** (brief เขียน `payer_required` ฯลฯ) เพราะ `api-error-message.ts` เป็น map ไทยแบน ๆ ของทั้งระบบ — key ชื่อ `payer_required` จะถูกฟีเจอร์แรกที่เขียนยึดไป suffix ตรงกับชื่อเดิมทุกตัว
2. **Item/component id ถูก namespace เป็น `<fileId>:<id>`** เหมือน documentRef (ข้อนี้ระบุเฉพาะ documentRef) — `id` ของ item คือ `<page>:<line>` ซึ่งซ้ำกันได้ข้ามไฟล์ และ `selection` ต้องชี้แถวเดียวได้แน่นอน; endpoint `facts` รับทั้งแบบ namespace และแบบดิบ
3. **สูตร reconciliation ของ §4.4 ขยายเป็น** `Σ sale − Σ void − Σ applied_discount (ทุก scope) + Σ charge (ทุก scope) + Σ tax_additional` เพราะ §4.4 เขียนเฉพาะ `scope order/document`: ส่วนลดค่าส่งและส่วนลดระดับ item เป็นเงินจริงบนเอกสารเช่นกัน และใบกำกับภาษีแบบ VAT บวกเพิ่มต้องบวก `tax_additional` มิฉะนั้นทุกใบจะ `mismatch`
4. **ส่วนลด scope `checkout` ถูกปันให้แต่ละเอกสารด้วยสัดส่วนเดียวกับ allocation** ก่อนเทียบ `document_total` — ไม่เช่นนั้นคูปองที่พิมพ์ใต้ร้านเดียวจะทำให้ทั้งสองเอกสารของ A03 `mismatch` ทั้งที่ยอดถูกต้อง
5. **ค่าเริ่มต้นของภาษี**: เอกสารมี tax component แต่ผู้ออกไม่มีเลขภาษี 13 หลัก → `NEEDS_REVIEW` (ข้อ 7 เขียนว่า "else NO_VAT") เพราะการตั้ง `NO_VAT` บนเอกสารที่พิมพ์ VAT คือการแปลง VAT เป็น 0 ซึ่ง A08 ห้าม; `taxEvidenceStatus` ไม่มีค่าเริ่มต้นที่ผ่าน resolver (คง `NEEDS_REVIEW` จนผู้มีสิทธิ์ตัดสิน) ตามข้อ 7 "ไม่บังคับค่าเพื่อให้ผ่าน resolver"
6. **`vatRate` ต่อบรรทัด** มาจาก `taxMarker` ของแถวเมื่อมีแถวใดแถวหนึ่งมี marker; ถ้าไม่มีแถวใดมีเลย จึงใช้ rate ที่อ่านได้จาก label ของ tax component (legend ของทั้งใบ) — ทั้งสองทางเป็นเลขที่พิมพ์จริง ไม่มี 7% โดยปริยาย (A53) และ code1/code2 ไม่เป็น rate
7. **`quantity` ที่เอกสารไม่ได้พิมพ์** ถือเป็น 1 หน่วยแบบแบ่งไม่ได้ (เลือกได้แค่ 0 หรือทั้งแถว) และบันทึก `quantityInferred: true` ใน provenance ตาม §16.2 ที่ห้ามเปิดแบ่งจำนวนที่ไม่รู้
8. **บรรทัดที่ `companyGross / companyQty` ไม่ลงตัวที่ 4 ตำแหน่ง** ถูกออกเป็น `quantity = 1, unitPrice = ส่วนของบริษัททั้งก้อน` และเก็บจำนวนจริงไว้ใน provenance เพื่อให้ `round2(qty × unitPrice)` ตรงกับยอดเป๊ะหลังเก็บลงคอลัมน์ `Decimal(18,4)`
9. **scope ที่ส่วนบริษัท = 0 และไม่มี unknown ถูกตัดออกจาก `scopes[]` พร้อม blocker ของมัน** (ข้อ 8 ของ brief) แต่ยอดส่วนตัวยังนับใน `summary` และ facts ยังแสดงทุกเอกสาร — scope ที่เป็น 0 เพราะ "อ่านยอดไม่ได้" ไม่ถูกตัด (A41)
10. **`charge` scope `document|checkout|item` ออกเป็น `chargeKind: OTHER`** (ข้อ 3 ของ brief กำหนดเฉพาะ shipping → `DELIVERY`) ไม่เดา `SERVICE_CHARGE` จาก label
11. **`allowedActions` ไม่มี `edit_facts`** เพราะ `EXPENSE_CAPTURE_ACTIONS` ของ W01 มี 6 ค่าและเป็น contract ที่ wave นี้ไม่แก้ — สิทธิ์แก้ facts เท่ากับ `review` (§6 แถวเดียวกัน)
12. **`facts` ใน group detail dto** เป็น `CaptureFactsView` ซึ่ง assignable กับ `ExpenseCaptureObservations` (มี 6 array + `completeness`) จึงเป็นการเพิ่มฟิลด์ล้วน ๆ ไม่แก้ `expense-capture.ts`
13. **หน่วยของตัวเลขใน snapshot**: `totals`/`lines`/`charges` เป็น 4 ตำแหน่งตาม `calcDocumentTotals` (คอลัมน์เงินของ repo) ส่วน `companyAmount`/`personalAmount`/`paidTotal`/`summary`/provenance share เป็น 2 ตำแหน่ง (ตัวเลขที่คนอ่านและใบรับรองอ้าง)
14. **`accept` ของ creator**: อนุญาตเฉพาะ `outcome = READY` + route `EMPLOYEE` + `payerUserId = ผู้กด` (self-claim) และบันทึก `rule` ใน audit; กรณีอื่นต้อง `expense.review`
15. **`review` ซ้ำเมื่อมี ACCEPTED อยู่** (และ `handoffState = NONE`) จะ `INVALIDATED` ตัวเก่าด้วยเหตุ `review_recomputed` และล้าง `acceptedAllocationId` (A11); ถ้า `handoffState = ACTIVE` ทั้ง `facts`/`review`/`accept` ตอบ 409 `expense_capture_handoff_active` (แก้ที่รายการค่าใช้จ่ายแทน)
## 18. Implementation notes (W02-web, 2026-09-19)

สิ่งที่ implement ต่างจากตัวอักษรของเอกสารนี้ พร้อมเหตุผล (ไม่เปลี่ยนกติกาเงิน/สิทธิ):

1. **เส้นแบ่ง lane คือ "จำนวนไฟล์" ไม่ใช่ "ชนิดไฟล์"** — ข้อ 3 เขียนว่า PDF เดี่ยวอยู่เส้นทาง expense เดิม; โค้ดจึงใช้เงื่อนไขเดียว: 1 ไฟล์ (รูปหรือ PDF) = `initReceiptUpload` เดิมทุก request, ≥ 2 ไฟล์ = กลุ่ม กล้องบนมือถือยังถ่ายได้ทีละใบ (ไม่มี `multiple`) ส่วน picker/dropzone รับหลายไฟล์
2. **`GET …/read-status` ทั้งสองเส้นเป็นของ W02-web** (ข้อ 9 ระบุไว้แต่ W01 ไม่ได้ทำ) — `expense-capture-read-status.use-case.ts` อ่าน `ExpenseCaptureReadJob` อย่างเดียว ไม่เริ่ม/ไม่คิดเงินการอ่าน; รูป response (`files[] { fileId, attachmentId, status, pagesRead, pageCount, pausedReason, lastErrorCode, updatedAt }`) ประกาศไว้ใน use case ฝั่ง API และ mirror ใน `expense-capture-status.logic.ts` ฝั่งเว็บ **ไม่ใส่ใน `packages/contracts/src/expense-capture.ts`** เพราะไฟล์นั้นเป็นของ W03 การประกาศชื่อเดียวกันสองที่จะชนกันที่ barrel — W03 ควรย้ายชนิดนี้เข้า contract เดียวเมื่อถึงคิว
3. **`ExpenseExtractionResult` เพิ่ม `readJobId?`/`readStatus?` แบบ additive** ใน `packages/contracts/src/expenses.ts` (เจ้าของคือ wave นี้) ไว้ให้ W03 เติมค่า; เว็บถือว่า "ไม่มีสองฟิลด์นี้ = อ่านแบบ sync เหมือนเดิม"
4. **UXE-22 ของ READY_FOR_CONFIRMATION ตอบ 409 `expense_receipt_replace_locked` ไม่ใช่ 403** เมื่อผู้ใช้ไม่มี `expense.review` — ข้อความบอกสถานะจริงและบอกว่าใครทำได้ ตามรูป "รายการนี้ {สถานะจริง} แล้ว" ของ §17.2 (403 จะกลายเป็นข้อความสิทธิ์ทั่วไปที่ไม่บอกทางต่อ)
5. **`operationId` เก็บที่ `sourceChannelMetadataJson.replaceOperations`** (ข้อ 9 เสนอสองทาง) เพราะเป็นคอลัมน์ JSON ที่มีอยู่แล้วบน `ExpenseRecord` และเขียนในทรานแซกชันเดียวกับการ bind ไฟล์ — ไม่ต้องมีตารางใหม่; บันทึกล่าสุด 10 รายการ, ซ้ำ operation เดิม + ไฟล์เดิม = ตอบผลเดิมโดยไม่เขียนซ้ำ, ไฟล์/intent ต่างกัน = 409 `expense_receipt_replace_operation_conflict` **ตรวจ operation ก่อน revision** เพราะ retry ย่อมถือ revision เก่าเสมอ
6. **`sourceStale` ถูกล้างตอนคนกดบันทึกการตรวจ** ใน `UpdateExpenseDraftUseCase` (พร้อม `missingFields` เดิม) — W03 ยังต้องล้างตอน apply ผลอ่านใหม่; ตอนตั้ง flag จะถอด `extractionAttachmentId` ออกจาก summary ด้วย เพื่อไม่ให้ fence ของ `updateExpense` (ผล OCR ที่กลับช้า) ชี้ไปยังไฟล์ที่ถูกแทนแล้ว
7. **หน้า `/expenses/capture/{groupId}` ส่งเฉพาะโครง** ตามลำดับงาน: header/สถานะ, รายการไฟล์ + สถานะอ่านต่อไฟล์ + polling 3 วินาที, แนบเพิ่ม/ตัดออก/เก็บไว้ก่อน/ไม่มีส่วนของบริษัท, preview เดิม และ slot ว่าง `CaptureFactsSection`/`CaptureAllocationSection` ให้ W04; ปุ่มทุกปุ่มมาจาก `allowedActions` ของ server
8. **ยังไม่ได้ทำใน W02-web**: LINE lane ทั้งหมด (W02-LINE), การอ่านจริง/manifest ที่มีหน้า (W03), สรุปร้าน/สินค้า/ยอด/ผู้จ่ายบนหน้ากลุ่ม (W04) — ข้อความ "ทั้งสามทางรับ PDF 10 MiB แล้ว save→queue/read" ยังติ๊กไม่ได้จนกว่า W03 จะมี runner จริง
## 19. Implementation notes (W02-LINE, 2026-09-19)

### 19.1 ข้อความที่ส่งจริง (UXE แถว LINE + NR01–NR09 + wait texts)

| กรณี | ข้อความที่ shipped | ที่มาในโค้ด |
|---|---|---|
| ได้รับไฟล์ (wait ladder) | `ได้รับไฟล์แล้วค่ะ 📄 กำลังอ่านเอกสารอยู่ เสร็จแล้วน้องจะสรุปให้ทางแชตนี้นะคะ ระหว่างนี้คุยกับน้องต่อได้เลยค่ะ` | `LINE_FILE_RECEIVED_TEXT` (ไม่มี slow-stage เพราะผลมาทาง push) |
| ได้รับรูป (wait ladder) | เดิมทุกตัวอักษร | `LINE_MEDIA_RECEIVED_TEXT` + slow stage |
| เก็บไฟล์แล้ว (file lane) | `📄 เก็บไฟล์แล้วค่ะ กำลังอ่านเอกสาร เสร็จแล้วน้องจะสรุปให้ทางแชตนี้ ระหว่างนี้เปิดดูได้ที่: <group link>` | `fileStoredReply` |
| A45 ถามงานเดิม/ใบใหม่ | `📎 เก็บไฟล์แล้วค่ะ ไฟล์นี้เป็นเอกสารของงานเดิม (<ชื่อไฟล์แรก · เวลา>) หรือใบใหม่คะ` + `1) งานเดิม` `2) ใบใหม่` | `sameWorkQuestionText` + quick reply |
| A45 ตอบ 1 | `📄 รวมไฟล์เข้างานเดิมให้แล้วค่ะ เปิดดูได้ที่: <link งานเดิม>` | `resolveSameWorkAnswer` |
| A45 ตอบ 2 | `📄 รับทราบค่ะ เก็บเป็นงานใหม่ให้แล้ว เปิดดูได้ที่: <link งานใหม่>` | `resolveSameWorkAnswer` |
| A45 merge ล้มเหลว | `ตอนนี้ยังรวมไฟล์เข้างานเดิมให้ไม่ได้ค่ะ ไฟล์ทั้งสองยังเก็บไว้ครบ เปิดตรวจในเว็บได้ที่: <link>` | `resolveSameWorkAnswer` (ไม่มีไบต์หาย) |
| UXE-03 download (ไฟล์) | `📄 น้องยังรับไฟล์จาก LINE ไม่สำเร็จค่ะ ยังไม่ได้บันทึกรายการใด ๆ จากไฟล์นี้นะคะ รบกวนส่งไฟล์เดิมอีกครั้งค่ะ` | `mediaDownloadFailedReply('file')` |
| UXE-03 download (รูป) | เดิมทุกตัวอักษร | `mediaDownloadFailedReply('image')` |
| UXE-04/08/09 security | เดิมทุกตัวอักษร | `MEDIA_SECURITY_REJECTED_REPLY` |
| UXE-10 / NR09 failed | `อ่านข้อมูลไม่สำเร็จค่ะ เก็บไฟล์ไว้แล้ว กดกรอกข้อมูลต่อได้ที่นี่\n<link>` | `CAPTURE_READ_FAILED_REPLY` |
| UXE-13 / NR09 partial | `อ่านข้อมูลได้บางส่วนค่ะ เก็บไฟล์ไว้แล้ว กดกรอกข้อมูลส่วนที่ขาดต่อได้ที่นี่\n<link>` | `CAPTURE_READ_PARTIAL_REPLY` |
| UXE-14 paused | `เก็บไฟล์ไว้แล้วค่ะ แต่ยังอ่านข้อมูลไม่ครบ (<เหตุผลไทย>) กดกรอกข้อมูลส่วนที่ขาดต่อได้ที่นี่\n<link>` | `CAPTURE_READ_PAUSED_REPLY`; `ai_credit` = "เครดิตสำหรับการอ่านเอกสารไม่พอ" (คำศัพท์ wave 2) |
| DONE เอกสารเดียว | `📄 อ่านเอกสารแล้วค่ะ พบ <ผู้ออก> ยอด <ยอด> — ตรวจและสร้างรายการค่าใช้จ่ายในเว็บ: <link>` | `formatCaptureReadFinishedReply` (มี `TODO(W05)` สำหรับ auto-handoff) |
| DONE หลายฉบับ | `📄 อ่านเอกสารแล้วค่ะ พบ <n> ฉบับ กรุณาตรวจการจัดกลุ่มในเว็บ: <link>` | เดียวกัน |
| NR01 ใบปะหน้า | `ใบนี้เป็นใบปะหน้าพัสดุค่ะ ยังไม่พบหลักฐานการจ่ายค่าส่ง จึงยังไม่ได้สร้างรายการค่าใช้จ่าย หากมีใบเสร็จค่าส่ง ส่งเพิ่มได้เลยค่ะ` (+ `กรอกข้อมูลต่อได้ที่นี่: <link>` เมื่อ persist สำเร็จ) | `nonReceiptReply('NR01')` |
| NR02 ใบนำฝาก | `ใบนี้ยืนยันการรับฝากพัสดุค่ะ แต่ยังไม่พบข้อมูลการจ่ายค่าส่ง หากมีใบเสร็จค่าส่ง ส่งเพิ่มได้เลยค่ะ` (+ CTA) | `nonReceiptReply('NR02')` |
| NR03 quote/PO/ใบส่งของ | `ใบนี้เป็น<ใบเสนอราคา\|ใบสั่งซื้อ\|ใบส่งของ>ค่ะ ยังมีข้อมูลไม่พอสำหรับบันทึกค่าใช้จ่าย ส่งใบแจ้งหนี้หรือใบเสร็จของรายการนี้เพิ่มได้เลยค่ะ` (+ CTA) | `nonReceiptReply('NR03')` |
| NR04 ใบแจ้งหนี้ | `ใบนี้เป็นใบแจ้งหนี้ ยอด <ยอด> บาทค่ะ ยังไม่พบหลักฐานการชำระ กรุณาตรวจข้อมูลก่อนบันทึก` (ไม่มียอด = ตัดวลียอดออก) | `expensePathNonReceiptLead` นำหน้าสรุป expense เดิม |
| NR05 สลิป / คำสั่งซื้อ | `พบสลิปโอนเงินค่ะ กรุณาตรวจว่าจ่ายค่าอะไรและให้ใคร` / `พบหลักฐานคำสั่งซื้อค่ะ กรุณาตรวจรายการและสถานะชำระเงิน` | เดียวกัน |
| NR06 เช็กบิล | เดิมทุกตัวอักษร (`formatCheckBillDecisionReply` + 3 ตัวเลือก) | ไม่เปลี่ยน |
| NR07 ภาพไม่เกี่ยวข้อง | `ภาพนี้ไม่ใช่เอกสารค่าใช้จ่ายค่ะ จึงไม่ได้สร้างรายการ ส่งเอกสารค่าใช้จ่ายที่ต้องการบันทึกได้เลยค่ะ` — ไม่มีลิงก์ ไม่ persist; ถ้ามาจากผล read กลุ่มถูกปิด `CANCELLED/NON_BUSINESS_IMAGE` | `nonReceiptReply('NR07')` |
| NR08 ไม่แน่ใจชนิด | `ยังไม่แน่ใจว่าเป็นเอกสารประเภทใดค่ะ` (+ CTA) | `nonReceiptReply('NR08')` |

### 19.2 §17.5 decision table (deterministic ก่อน AI)

| ผู้ใช้ถาม | สิ่งที่ระบบอ่าน | คำตอบ |
|---|---|---|
| regex ใด ๆ ใน `FILE_ATTEMPT_PATTERNS` (ไฟล์/รูปเมื่อกี้, ส่งไม่ได้, ใหญ่ไป/ขนาด, รองรับ PDF, ต้องส่งใหม่, บันทึกยัง + English) | `LineIntakeAttempt` ของ (company, lineUserIdHash, chatKeyHash) ใน 24 ชม. ≤ 5 รายการ (ตัดแถว `ROUTE` ออก) | ตามแถวด้านล่าง |
| ไม่พบแถวเลย | — | `ตอนนี้ยังไม่พบไฟล์ที่จะอ่านค่ะ กด + → ไฟล์ …` |
| lookup โยน error | — | `ตอนนี้ยังตรวจสอบสถานะไม่ได้ จึงยังยืนยันไม่ได้ว่าไฟล์ถูกเก็บหรือยัง` |
| 1 แถว: oversize | `capabilityJson.maxBytes` + declared/measured | `ไฟล์ <ชื่อ> ขนาด <x> MB เกินขนาดที่ระบบรับได้ <limit> MB จึงยังไม่ได้เก็บไฟล์นี้ — เลือกไฟล์ที่เล็กกว่าแล้วส่งอีกครั้งได้เลยค่ะ` |
| 1 แถว: ชนิดไม่รองรับ | `capabilityJson.allowedMimeTypes` | `ไฟล์ชนิดนี้ยังไม่รองรับค่ะ … กรุณาเลือก PDF, PNG, JPG …` |
| 1 แถว: security | — | `…ไม่ผ่านการตรวจความปลอดภัยค่ะ …` |
| 1 แถว: download ไม่ทราบสาเหตุ | — | `ตอนนั้นระบบรับไฟล์จาก LINE ไม่สำเร็จ แต่ยังระบุสาเหตุแน่ชัดไม่ได้ค่ะ …` |
| 1 แถว: เก็บแล้ว | สถานะ job ปัจจุบันของกลุ่ม (permission-checked) | reading / read-failed / partial / done — พร้อมลิงก์กลุ่ม |
| หลายแถว | — | `หมายถึงไฟล์ไหนคะ` + รายการเลข (ชื่อ · เวลา · สถานะ) และเขียนแถว `ROUTE/file_attempt_select` ผูกคำตอบถัดไป |
| ปัญหาถูกแก้แล้ว | แถวเก่า REJECTED + แถวใหม่ของ `lineMessageId` เดียวกัน | `ตอนแรก <เหตุ> ตอนนี้ <สถานะล่าสุด> แล้วค่ะ` |
| ส่งผลไม่สำเร็จ (UXE-25) | `reasonCode = LINE_DELIVERY_FAILED` บน attempt | `อ่านเอกสารเสร็จแล้วค่ะ แต่ส่งผลให้ทางแชตนี้ไม่สำเร็จ …` |

ทุกแถวเป็น read-only: ไม่เรียก OCR, ไม่สร้าง/แก้ expense, ไม่หัก quota และตอบได้แม้ AI ไม่พร้อม

### 19.3 `LineIntakeAttempt` ที่เขียนจริง

| จุด | stage | reasonCode | outcome | target |
|---|---|---|---|---|
| download ล้มเหลว | `DOWNLOAD` | `credentials_unavailable` \| `oversize_declared` \| `oversize_measured` \| `download_http` \| `download_timeout` \| `download_failed` | `REJECTED` | — |
| security ปฏิเสธ | `SECURITY` | `METADATA_REJECTED` \| `EXTENSION_MIME_MISMATCH` \| `CONTENT_REJECTED` \| `MALWARE_DETECTED` \| `MALWARE_SCAN_FAILED` | `REJECTED` | — |
| persist ล้มเหลว | `PERSIST` | `persist_failed` | `REJECTED` | — |
| file lane เก็บสำเร็จ | `PERSIST` | `stored` | `STORED_READING` | `capture_group` |
| image lane §17.6 (อ่านแล้วล้ม) | `READ` | `<OCR error code>` | `STORED_READ_FAILED` | `capture_group` |
| A45 ถามงานเดิม | `ROUTE` | `same_work_question:<earlierGroupId>` → `same_work_answered` | `STORED_READING` | `capture_group` (กลุ่มใหม่) |
| §17.5 ambiguity list | `ROUTE` | `file_attempt_select` | `UNKNOWN` | `attempt_list` (`targetId` = refs คั่นด้วย comma) |
| ผลอ่านถูก push | `READ` | `result_delivered` \| `LINE_DELIVERY_FAILED` | `STORED_READ_DONE` \| `STORED_READ_PARTIAL` \| `STORED_READ_FAILED` | `capture_group` |

`capabilityJson` = `{ maxBytes, allowedMimeTypes, pdfAutomaticRead: true }` ณ เวลานั้น; `lineUserIdHash` = `hashMessagePreview(lineUserId)` (ตัวเดียวกับ event log); `chatKeyHash` = `chatKeyHashOf(event)`; `fileNameSanitized` ผ่าน `sanitizeAttemptFileName` (basename, ≤ 80, ตัด control chars) ไม่มี raw payload / reply token / bytes; purge ใช้ `AI_DATA_RETENTION_DAYS` ใน sweep เดียวกับ `LineWebhookEventLog` (W01 ต่อไว้แล้ว — ตรวจแล้วว่ามีจริงใน `recover-orphan-line-events.use-case.ts`)

### 19.4 ส่วนที่ต่างจากตัวอักษรของเอกสารนี้ (W02-LINE)

1. **A45 / §17.5 ambiguity ผูกคำตอบด้วย `LineIntakeAttempt` ไม่ใช่ ledger `waiting_user`** — เอกสารข้อ 10.1 เสนอ ledger kind ใหม่ แต่คำตอบ "1" ย้ายไบต์ระหว่างกลุ่มจริง การผูกจึงต้องทนต่อ Redis ล่ม; `LineIntakeAttempt` เป็น Postgres, มี (company, userHash, chatHash) ครบ, และถูก purge ตาม retention เดียวกันอยู่แล้ว ผลข้างเคียง: ไม่ต้องขยาย `clarificationSourceCurrent` ซึ่งเป็นเส้นทางตรวจ source ที่ยาวที่สุดในไฟล์
2. **push ผลอ่านไปได้เฉพาะแชต 1:1** — `lineChatKeyHash` เป็น hash จึงกู้ group id กลับไม่ได้ กรณีกลุ่มแชตจึงบันทึกเป็น undelivered (`LINE_DELIVERY_FAILED`) ให้ §17.5 ตอบ UXE-25 แทนการเดาปลายทาง — **แทนที่โดย W07-int (ข้อ 23.2 ข้อ 1)**: กลุ่มเก็บ `linePushTargetId` ไว้แล้ว แชตกลุ่มจึงตอบได้ในแชตที่ไฟล์มา ส่วน hash ยังเป็นตัวยืนยันปลายทาง
3. **ไม่มี scan worker ใหม่** — drain ใหม่ขี่ tick เดิมของ `line-ai-ledger-worker.ts` (`callInternal` เส้นที่สาม) เพราะ `apps/workers/src/main.ts` เป็นไฟล์ pinned และ worker ใหม่ไม่ได้ให้พฤติกรรมเพิ่ม
4. **`line.explain_file_attempt` ยังไม่อยู่ใน router catalog** — spec §17.5 บังคับให้มีคำตอบ deterministic เมื่อ AI ไม่พร้อม ซึ่งทำครบแล้วใน handler; แถวใน `LINE_AI_FEATURE_COVERAGE` จึงเป็น `feature_gated` พร้อมเหตุผล ไม่ใช่ `covered` และไม่ได้เพิ่มบรรทัด system prompt (ไฟล์ agents เป็นของ wave อื่น)
5. **tool ฝั่ง LLM เห็นเฉพาะ attempt ที่ผูกกับผู้ใช้คนนั้น** — `ErpToolContext` มี `chatKeyHash` แต่ไม่มี LINE user id การอ่านทั้งแชตในกลุ่มจะเปิดชื่อไฟล์ของสมาชิกคนอื่น จึงระบุตัวผู้ใช้ทางอ้อมจากกลุ่มที่เขาสร้าง (`listChatIntakeAttempts`) ผู้ใช้ที่ยังไม่มี target ในหน้าต่างนั้นจะไม่เห็นอะไรเลย — handler deterministic (ซึ่งมี lineUserId) ยังตอบได้ตามปกติ
6. **`file` ที่มาระหว่างงาน substitute receipt เปิดอยู่ ยังเข้า handler เดิม** — สแกน PDF ของใบรับรองที่เซ็นแล้วเป็นคำตอบของคำถามนั้น ไม่ใช่กลุ่มหลักฐานใหม่
## 20. Implementation notes (W03, 2026-09-18)

สิ่งที่ implement ต่างจากตัวอักษรของเอกสารนี้ พร้อมเหตุผล (ทุกข้อไม่เปลี่ยนกติกาเงิน/สิทธิ):

1. **`maxImagesPerChunk` = 12 ไม่ใช่ 20** (ข้อ 4.2 tiles): 20 เป็นขอบของ Bedrock แต่ขอบที่แคบกว่าและบังคับจริงคือ *เงิน* — `receipt-capture-read` ประกาศ `maxInputTokens 30,000` และ gateway คิดภาพละ `AI_BUDGET_IMAGE_TOKEN_CEILING` (2,000) ดังนั้น 20 ภาพ = 40,000 tokens ซึ่งจะถูก `input_bound_exceeded` ปฏิเสธ *หลังจาก* เรนเดอร์หน้าไปแล้ว; 12 (overview + tile ≤ 10) เหลือ margin
2. **เกณฑ์ตัดสิน tiles เป็น "อ่านออกไหม" ไม่ใช่ "ใหญ่ไปไหม"**: หน้าถูกแบ่ง tiles เมื่อ scale ของการเรนเดอร์ทั้งหน้า < 0.5 (`tileScaleFloor`) คือย่อจนตัวเลข/ภาษาไทยเล็กเกินเกณฑ์ตาม spec §16.7 ข้อ 3; ถ้าเกิน 3,500,000 bytes เฉย ๆ จะ *ลด quality* (85→75→65) ก่อน เพราะลด quality รักษาความสูงตัวอักษรไว้ ส่วนการแบ่งภาพทำให้เสียบริบท — ถ้ายัง q65 ไม่พอจึงแบ่ง tiles
3. **หน้าสแกนที่ render**: เกณฑ์คือ (ก) สำเนา 1 หน้ายังเกิน `maxPdfChunkBytes` หรือ (ข) หน้านั้นไม่มี text layer (< 20 ตัวอักษร) และสำเนา 1 หน้าเกิน 3,500,000 bytes — ข้อ (ข) ทำให้สแกนใหญ่ถูกอ่านเป็น pixels ที่ provider เห็นจริง แทนที่จะส่ง document block ที่โมเดลอ่านไม่ออก
4. **`ExpenseCaptureObservations` เพิ่ม 3 ฟิลด์แบบ additive**: `documents[].printedPages` (เลขหน้าที่พิมพ์ทุกหน้าของเอกสารเดียวกัน ใช้ตรวจ 1/3 + 3/3), `ExpenseCaptureAssembledObservations = observations + reconciliation[] + multiDocument` (payload ที่ job เก็บจริงตามข้อ 4.4) และ `ExpenseCaptureReadStatusDto` (ข้อ 9 `read-status`); `ExpenseExtractionResult` เพิ่ม `readJobId`/`readStatus`
5. **`budgetScope` ของสอง route แคบเป็น `AiBudgetScope`** (เดิม `string` ใน W01) ให้ตรงกับ `ReceiptOcrResponse`
6. **Reconciliation ใช้ Σ items เป็นฐานเสมอเมื่อมี items** และใช้ total `merchandise` เป็นฐานเฉพาะเมื่อไม่มี item เลย — เพราะ subtotal ที่พิมพ์รวมค่าส่งอยู่แล้วจะถูกบวกค่าส่งซ้ำ (A25); `applied_discount` ที่นับคือ scope `order|checkout|document` (ระดับ item ถือว่าอยู่ในยอดแถวแล้ว) และ void หักล้างเฉพาะเมื่อ `linkedItemId` ชี้แถวที่มีจริง
7. **`ExpenseCaptureFieldsLogic` (map → draft เดิม) ไม่รวมส่วนลดสองรายการเป็นค่าเดียว**: ช่อง `discountAmount` มีช่องเดียว ถ้าเอกสารพิมพ์ส่วนลดระดับบิลสองรายการ จะปล่อยว่างและใส่ `discountAmount` ใน `missingFields` แทนการบวก (กฎเงินข้อ 9)
8. **`vatMode` จาก facts**: `tax_included` → `VAT_INCLUDED`, `tax_additional` → `VAT_EXCLUDED`, `tax_unknown`/มี total `tax` อย่างเดียว → `NEEDS_REVIEW`, ไม่มี tax fact เลย → `NO_VAT` ยกเว้นเอกสารที่เป็น `TAX_INVOICE`/`ABBREVIATED_TAX_INVOICE` ซึ่งได้ `NEEDS_REVIEW` (ใบกำกับที่อ่าน VAT ไม่ได้ ไม่ใช่ใบที่ไม่มี VAT)
9. **Claim ทีละ 1 แถว วนจนครบ batch** แทน `UPDATE … LIMIT n` เดียว: subquery ใน statement เดียวเห็น snapshot ก่อน update ทำให้ 5 job ของบริษัทเดียวผ่านเพดาน "1 job ต่อบริษัท" พร้อมกันได้; batch ≤ 5 จึงเสียแค่ 5 statement (pg spec พิสูจน์ทั้ง disjoint และเพดานต่อบริษัท)
10. **`usable` ที่ตัดสิน release ของ OCR count คือ "มี document อย่างน้อยหนึ่ง" ไม่ใช่สถานะ**: `PARTIAL` ที่ได้ร้าน+ยอดถือว่าคุ้มการอ่านที่ลูกค้าจ่าย ส่วน `DONE` ที่ไม่ได้อะไรเลยคืน count ให้ลูกค้า
11. **`GET .../capture-groups/{g}/read-status` ยังไม่ทำเป็น route แยก** — สถานะรายไฟล์อยู่ใน `GET capture-groups/{g}` (W01) ครบแล้ว และ W04 เป็นผู้ใช้; route ของ expense เดี่ยว (`GET .../expenses/{e}/read-status`) ทำแล้วเพราะ W02-web poll
12. **งบจริงที่ตั้งไว้**: `providerCallCount ≤ 40`, เวลา ≤ 15 นาทีต่อการรันหนึ่งครั้ง, lease 120 s ต่ออายุหลังทุก chunk, `attempts ≥ 5` → `FAILED/attempts_exhausted`, window ≤ 12,000 ตัวอักษร, ข้อความต่อหน้าที่เก็บใน checkpoint ≤ 20,000 ตัวอักษร
13. **ยังไม่ทำใน W03**: LINE auto-handoff (ข้อ 3.2 = W05/W07 — **ผู้เรียกจริงส่งใน W07-int ข้อ 23.2 ข้อ 2**), allocation (W04), การบริโภค outbox event `expense.capture_read.finished` (LINE wave — ส่งใน W02-LINE), และ Bedrock replay จริงด้วย fixture สังเคราะห์ (controller session ตามข้อ 15.5)

## 21. Implementation notes (W04b — หน้ากลุ่ม/รายการงานรับหลักฐาน, 2026-09-19)

W04b ส่งเฉพาะ `apps/web/**`: หน้า `/companies/{c}/expenses/capture/{groupId}` เต็มรูป (สรุป §13.4, facts ราย
เอกสาร + แก้ข้อมูล, คำถามสองข้อ + ส่วนของบริษัท, ยอมรับการจัดส่วน, ปุ่มสร้างรายการค่าใช้จ่าย, derived sources)
และหน้ารายการ `/companies/{c}/expenses/capture` ไม่มีการแก้ API/contract/gateway ในรอบนี้

สิ่งที่ต่างจากตัวอักษรของเอกสารนี้ พร้อมเหตุผล (ไม่เปลี่ยนกติกาเงิน/สิทธิ):

1. **ปุ่ม handoff ยิง `POST …/handoff` ที่ W05 ยังไม่ส่ง** — 404 = "ยังสร้างรายการค่าใช้จ่ายจากงานนี้ไม่ได้ในตอนนี้"
   (ไม่ใช่ข้อความว่าสร้างไม่สำเร็จ), 5xx/หลุดเน็ต = UXE-24 "กำลังตรวจสอบผลรายการก่อนทำต่อ" แล้ว re-GET กลุ่มเพื่อดู
   `derivedSources` จริง ชนิดผลลัพธ์ประกาศไว้ใน `expenses.api.ts` ตามข้อ 9 (W05 ย้ายเข้า contract เมื่อถึงคิว)
2. **`claimReady` ของ derived source อ่านจาก scope ของ allocation ที่ยอมรับแล้ว** เพราะ `ExpenseCaptureDerivedSourceDto`
   (ข้อ 9/W01) ไม่มีฟิลด์นี้ — จับคู่ด้วย `captureScopeKey`; ปุ่ม "เตรียมใบเบิก" จึงขึ้นเฉพาะ route `EMPLOYEE` +
   `claimReady` มิฉะนั้นเป็นข้อความ "รอตรวจภาษีก่อนเตรียมใบเบิก" (ไม่พาไปหน้าที่ resolver จะปฏิเสธ)
3. **จำนวน "ส่วนตัว" ตอนเปิดหน้าใหม่สร้างกลับจาก `result.scopes[].lines[].provenance`** เพราะ
   `ExpenseCaptureAllocationDto` ไม่ได้ส่ง `selectionJson` — แถวที่ไม่มีบรรทัดในผล = ส่วนบริษัท 0 (ส่วนตัวทั้งแถว)
   ยกเว้นแถวที่ "อ่านยอดไม่ได้" ซึ่งคงไว้ที่ส่วนตัว 0 เพื่อไม่พลิกคำตอบของผู้ตรวจเอง (A28/A41) — ทางแก้ถาวรคือเพิ่ม
   `selection` ลง dto (มี `ponytail:` note ไว้ในโค้ด)
4. **ป้าย "แก้โดยผู้ใช้" เป็นระดับไฟล์ ไม่ใช่ระดับฟิลด์** เพราะ `CaptureFactsView` (ข้อ 17.12) ไม่ได้พา
   `provenance` ของ observation `source: HUMAN` ออกมา — ใช้ `facts.files[].source === 'HUMAN'`
5. **ตัวเลือกผู้จ่ายคนอื่นใช้ `GET …/settings/employees`** (ไม่มี endpoint รายชื่อสมาชิกแบบเบาในข้อ 9) โหลดเฉพาะเมื่อ
   ผู้ใช้มี `expense.review` และเลือก "พนักงานสำรองจ่าย"; ถ้า 403 รายการจะเหลือ "ฉัน" อย่างเดียวและ server ยังตรวจ
   สมาชิก/สาขาเองทุกครั้ง (ข้อ 6)
6. **"ดูหน้าที่อ้างอิง" ใช้ fragment `#page=n` ของตัวอ่าน PDF ในเบราว์เซอร์** (เอกสารเก็บ `pageIndexes` ไว้ที่ระดับ
   เอกสาร ไม่ใช่ระดับแถว) ไม่เพิ่ม prop ให้ `DocumentPreviewModal`
7. **`taxReview` ถูกส่งเฉพาะเมื่อผู้มี `expense.review` แตะค่าจริง** และ `expenseDateChoice` ส่งเฉพาะ scope ที่เลือก —
   ค่าเริ่มต้นบนจอคือค่าที่ server คืนมา (`scope.vatMode/…/expenseDateSource`) จึงไม่มีการ "ประทับ" การตัดสินที่ไม่มี
   คนตัดสิน (ข้อ 7 / §17.3 ข้อ 5)
8. **ยังไม่ทำใน W04b**: LINE summary (W02-LINE), หน้าจอ regenerate หลัง handoff (server คืน `allowedActions: []`
   เมื่อกลุ่มไม่ `OPEN` แล้ว จึงยังไม่มีปุ่มให้กด — W05 ตัดสินว่าจะเปิดทางไหน), ใบรับรองต่อ source (W06 เติมบรรทัด
   "ใบรับรอง: —"), `?expenseId=` บนหน้าใบเบิกใหม่ยังไม่ถูกอ่านโดย `ReimbursementCreatePage` (ลิงก์พาไปหน้าร่างเปล่า)
   — **ปิดแล้วใน W07-int (ข้อ 23.2 ข้อ 14)**

## 18. Implementation notes (W05 — handoff, single use, lineage in list/export, 2026-09-19)

W05 ส่ง `POST …/handoff` (ข้อ 9), กติกาการสร้างใหม่ (regenerate), auto-handoff ของกลุ่ม LINE ไฟล์เดียว (ข้อ 3.2), และ lineage ใน read model/export (ข้อ 5) หน้าเว็บของ derived sources (W04b) กับใบรับรองรายร้าน (W06) ยังไม่ทำในรอบนี้

### 18.1 ตารางแปลง scope → ExpenseRecord/ExpenseLine

`buildDerivedSourceDraft` (`expense-capture-handoff.logic.ts`) เป็นที่เดียวที่แปลง ทุกค่าคัดลอกจาก snapshot ที่ยอมรับแล้ว ไม่มีการคำนวณใหม่

| ค่าปลายทาง | มาจาก |
|---|---|
| `captureSource` | `group.intakeChannel = LINE` → `LINE_UPLOAD`, อื่น → `WEB_UPLOAD` |
| `status` / `aiVerificationStatus` | `NEEDS_REVIEW` เสมอ |
| `createdByUserId` | `ctx.userId` ของผู้กด (auto-handoff ใช้ `group.createdByUserId`) — ไม่ปลอม |
| `payerUserId` | `allocation.payerUserId` เมื่อ `fundingRoute = EMPLOYEE`; route อื่นเป็น null |
| `branchId` | `group.branchId` |
| `expenseDate` | `scope.expenseDate` (ผู้ตรวจเลือกแล้ว; ไม่มี → 422 ไม่ default เป็นวันนี้) |
| `currency` / `vatMode` / `inputVatClaimStatus` / `taxEvidenceStatus` | `scope.*` ตรงตัว (§7 ไม่บังคับค่าให้ผ่าน resolver) |
| `sourceDocumentType` | `sourceDocumentTypeFromClassification` → `toSourceDocumentType` ของเอกสารแรกใน scope ที่แปลงได้; อื่น `NEEDS_REVIEW` |
| `vendorNameSnapshot` / `vendorTaxIdSnapshot` / `vendorBranchCodeSnapshot` | `scope.issuer.name` / `.taxId` / `.branchCode` |
| `vendorDocumentNumber` | `documentNumber` ของเอกสารแรกใน `scope.documentRefs` ที่มีเลข |
| `subtotal/discount/taxable/vat/grandTotal/netPayable/outstandingAmount` | `scope.totals.*` (`outstanding = netPayable`, ยังไม่จ่าย) |
| `whtAmount` | `'0.0000'` — เส้นทาง capture ไม่หัก ณ ที่จ่าย |
| `aiVerificationSummaryJson` | `{ dateStatus: 'verified', expenseDateSource, captureGroupId, allocationId, scopeKey, paidTotal, companyAmount, personalAmount, policyVersion }` |
| `sourceChannelMetadataJson` | `{ channel, kind: 'capture_group', captureGroupId, allocationId, scopeKey, chatKeyHash? }` |
| `captureGroupId` / `captureAllocationId` / `captureScopeKey` | จาก context/scope |
| `primaryAttachmentId` + links | ไฟล์ของ scope ตามลำดับ manifest: ตัวแรก `expense.receipt.primary`, ที่เหลือ `expense.receipt.supporting` |
| `ExpenseLine[]` | `scope.lines` (สินค้า) แล้วต่อด้วย `scope.charges` (`chargeKind`); `quantity/unitPrice/discountAmount/vatRate` และ `totals.*` ตรงตัว, `whtRate = null`, `reviewStatus = NEEDS_REVIEW`, `expenseCategoryId/accountHintKey/taxCategory = null` |

ก่อนเขียนทุกครั้ง: `expenseTotalsIdentityError` ต้องเป็น null บน "แถวที่กำลังจะเขียน" มิฉะนั้น 422 `expense_capture_handoff_totals_invalid` (ไม่ปัดยอดให้ตรง) และ scope ที่ยังมี blocker อื่นนอกจาก `expense_capture_tax_review_pending` ถูกปฏิเสธด้วย 422 `expense_capture_handoff_blocked`

### 18.2 สถานะของ `handoffState`/`status` และ guard ของแต่ละทาง

| จาก | action | guard | ไป |
|---|---|---|---|
| `OPEN` / `NONE` | `handoff` | สิทธิ์ §6 · `expectedRevision` · `acceptedAllocationId = allocationId` · allocation `ACCEPTED` · `outcome READY` · `group.revision = allocation.groupRevision + 1` · derived sources เดิม (ถ้ามี จาก ข้อ 3.1) ยังไม่ถูกใช้ | `HANDED_OFF` / `ACTIVE` + `handoffBatchKey` |
| `HANDED_OFF` / `ACTIVE` | `handoff` ด้วย batch key เดิม | — | ตอบ batch เดิม `replayed: true` ไม่เขียนอะไร |
| `HANDED_OFF` / `ACTIVE` | `facts`/`review`/`accept` | `isReopenableAfterHandoff` = มี derived source ≥ 1 และไม่มีตัวใดถูกใช้ | คงอยู่ `HANDED_OFF` / `ACTIVE` (allocation ใหม่) |
| `HANDED_OFF` / `ACTIVE` | `handoff` ด้วย allocation ใหม่ | เหมือนแถวแรก + ทุก derived source ยังไม่ถูกใช้ | `HANDED_OFF` / `ACTIVE` + batch key ใหม่ |
| `HANDED_OFF` / `ACTIVE` | `close` | — | 409 `expense_capture_handoff_active` (ตามเดิมของ W01) |
| `CLOSED_NO_HANDOFF` / `CANCELLED` | `handoff` | — | 409 `expense_capture_group_closed` |

### 18.3 การตรวจ "ถูกใช้ไปแล้ว" ของ regenerate (`findHandoffConsumers`)

ต่อ derived source ทุกตัวของกลุ่ม คืนเหตุผลแรกที่เข้าเงื่อนไข: `status` (ไม่อยู่ใน DRAFT|NEEDS_REVIEW|READY_FOR_CONFIRMATION) → `paid` (`paymentStatus ≠ UNPAID` หรือ `paidAmount > 0`) → `posted` (`postingStatus ≠ not_required` หรือมี `journalEntryId`) → `claim_projection` (`sourceReimbursementRequestId`) → `claim` (`ReimbursementLine.linkedExpenseId` ในคำขอที่ไม่ terminal) → `certificate` (`ExpenseSubstituteReceiptEvidence` สถานะ PREPARED|PAYER_CERTIFIED|ISSUED) มีตัวใดตัวหนึ่ง = 409 `expense_capture_handoff_consumed` พร้อม `expenseIds`

ในการสร้างใหม่: scope ที่ allocation ใหม่ยังมี → เขียนทับ expense เดิมในที่เดิม (CAS `updatedAt` → 409 `EXPENSE_UPDATE_CONFLICT`; `ReceiptExtraction`/ไฟล์คงอยู่); scope ที่หายไป → ลบ expense กับ `AttachmentLink` ของมัน แต่ไม่แตะ `AttachmentObject` เพราะกลุ่มยังอ้างไฟล์เดิมอยู่

### 18.4 เงื่อนไข auto-handoff (ข้อ 3.2)

`AutoHandoffSingleDocumentCaptureUseCase` (ไม่มี HTTP route; wave LINE เป็นผู้เรียก) คืน `{ expenseId }` หรือ `{ skipped }` โดย skip เมื่อ: `handoff_exists` · `group_not_open` · `not_line_channel` · `not_single_file` (ไฟล์ที่ยังอยู่ ≠ 1 หรือยังไม่ STORED) · `read_not_done` · `not_single_document` / `not_single_issuer` · `not_expense_document` (ชนิดไม่อยู่ในชุดของเส้นทางใบเสร็จเดี่ยว) · `document_mismatch` · `unknown_amounts` · `blocked` (allocation ไม่ได้ให้ scope เดียวที่ไม่มี blocker) — ผลลัพธ์คือ expense `NEEDS_REVIEW` เหมือนใบเสร็จ LINE วันนี้, `acceptedAllocationId = null`, `handoffBatchKey = <groupId>:auto`

### 18.5 สิ่งที่ต่างจากตัวอักษรของเอกสารนี้ พร้อมเหตุผล (ไม่มีข้อใดเปลี่ยนกติกาเงิน/สิทธิ)

1. **ไม่มีคอลัมน์ `handoffIdempotencyKey` และไม่มี migration ในรอบนี้** — ข้อ 9 กำหนดว่า `idempotencyKey` ผูกกับ `(groupId, allocationId)` ซึ่งก็คือ `handoffBatchKey` ที่ unique อยู่แล้ว การเรียกซ้ำด้วยคู่เดิมคือเจตนาเดียวกันไม่ว่าจะถือ key อะไร จึงเก็บคอลัมน์ที่สองไม่ได้ประโยชน์; DTO ยังรับและตรวจรูป `idempotencyKey` ตามสัญญา
2. **`group.revision = allocation.groupRevision + 1` ไม่ใช่ `=`** — `accept` ของ W04a bump revision หลังสร้าง allocation เสมอ ดังนั้นเงื่อนไข "เท่ากัน" ตามตัวอักษรจะ 409 ทุกครั้ง ค่าที่ถูกคือ "ไม่มีอะไรเกิดขึ้นหลังการยอมรับ" = ห่างกันหนึ่งขั้น (เพิ่มไฟล์/ตัดไฟล์หลัง accept จะทำให้ห่างมากกว่านั้นและต้องตรวจใหม่)
3. **`handoffState = RELEASED` ไม่ถูกบันทึกจริง** — การปล่อยกับการสร้างชุดใหม่อยู่ในทรานแซกชันเดียว ผู้อ่านจึงไม่มีทางเห็นสถานะกลาง การเขียน `RELEASED` แล้วทับด้วย `ACTIVE` ทันทีเป็น write ที่ไม่มีใครสังเกตได้; ร่องรอยการปล่อยอยู่ใน audit `releasedExpenseIds`/`rewrittenExpenseIds` แทน
4. **`review`/`accept` เปิดใหม่ได้บนกลุ่มที่ handoff แล้วเมื่อทุก derived source ยังไม่ถูกใช้** (`isReopenableAfterHandoff`) — brief ขอข้อยกเว้นนี้เฉพาะกลุ่ม auto-handoff แต่ข้อ 9 ต้องการ regenerate ด้วย และเงื่อนไขทางการเงินเหมือนกันทุกประการ กลุ่มที่ handoff แล้วแต่ไม่มี derived source เลยยังตอบ 409 `expense_capture_handoff_active` ตามเดิม
5. **ไม่เพิ่ม `expense.capture_handoff.created` ใน `excludeEventTypes` ของ `workflow-outbox-drain`** — generic drain แปลง event ที่ไม่มี rule เป็นแถว `WorkflowEventInbox` สถานะ `SKIPPED` ซึ่งเป็นพฤติกรรมเดียวกับ `expense.receipt_uploaded` ของทุก draft วันนี้ ไม่มีผู้บริโภคเฉพาะให้แย่ง และ event ถูก append **หลัง** commit เพราะ `OutboxAppendService` เขียนด้วย client ของตัวเอง
6. **`evidenceRef` ของ derived source เป็น `<ref เดิม>-g<8 ตัวท้ายของ groupId>`** — ข้อ 5 บอกให้ "เพิ่ม captureGroupId" แต่ไม่มีคอลัมน์ใหม่ใน accountant index (ข้อ 12 ห้าม) การใส่ใน ref ทำให้ผู้ทำบัญชีเห็นว่าใบสองใบมาจากงานเดียวกัน และ ref ของค่าใช้จ่ายทั่วไป**ไม่เปลี่ยนแม้แต่ไบต์เดียว** (golden CSV เดิมจึงยังผ่าน)
7. **`source_channel` ของ export ใช้ fallback `'OTHER'`** แทนการพ่นชื่อ enum ดิบ — enum เก็บของที่เพิ่มภายหลังจะกลายเป็นคอลัมน์ที่เปลี่ยนรูปในไฟล์ที่ส่งออกนอกระบบ
8. **`PrismaExpenseRepository.createExpense` รับ `db?` เพิ่ม** และ `CreateExpenseRecordInput` รับ `status`/`aiVerificationStatus`/`vendor*`/lineage/`payerUserId` — derived source ต้องเกิดในทรานแซกชันเดียวกับ lock ของกลุ่ม และเขียนครบในคำสั่งเดียว (`UpdateExpenseRecordInput` ตัด lineage ออกโดยตั้งใจ เพราะ `updateExpense` ไม่ได้พา field เหล่านี้)
9. **`ExpenseSummary.captureGroupId` / `ExpenseDetail.captureGroup` เป็นการเพิ่มฟิลด์ล้วน ๆ** และ `captureGroup` อ่านยอดจาก `aiVerificationSummaryJson` ที่ handoff เขียนไว้ จึงไม่ต้อง query ตาราง capture ในหน้ารายละเอียด
10. **`allowedActions` ของกลุ่มที่ `HANDED_OFF`** คืน `review` (+`accept_allocation`/`handoff` ตามสถานะ allocation) เมื่อ reopen ได้ และคืน `[]` พร้อม blocker `expense_capture_handoff_consumed` เมื่อใช้ไปแล้ว — W01 คืน `[]` เสมอสำหรับสถานะที่ไม่ใช่ `OPEN`
11. **ยังไม่ได้ทำใน W05**: หน้าเว็บของ derived sources บนหน้ากลุ่ม (W04b), ใบรับรองรายร้าน (W06), การต่อ claim/projection/ledger ทั้งหมดของ W07, และผู้เรียก auto-handoff จริงจาก lane LINE (W02-LINE) — **ผู้เรียกส่งแล้วใน W07-int**: `LineCaptureResultNotifierUseCase` เรียกเมื่อผลเป็น `DONE`, ไม่ใช่เคส NR และ `documentCount ≤ 1`

## 22. Implementation notes (W06 — ใบรับรองต่อ derived source, 2026-09-19)

W06 ส่ง: กติกาเพิ่มของ eligibility บน derived source (ข้อ 7 D04 / spec §12.1–§12.2), ประโยคส่วนบริษัทในใบรับรอง
(D04 wording), ความคืบหน้ารายร้านใน `derivedSources[]` (§14.3 / A40) และทางกลับกลุ่มหลักฐานจาก wizard (§12.3)
ไม่มี migration และไม่แตะกติกาเงิน/สิทธิ/PAPER/DIGITAL/`assertFullSubstitutePayment` เดิมแม้แต่ข้อเดียว

### 22.1 Eligibility matrix ที่ implement (เพิ่มจากกฎเดิม ไม่ได้แทน)

`captureCertificateGate` (`expenses/domain/logic/expense-capture-certificate.logic.ts`) ทำงาน **หลัง**
`collectSubstituteReceiptEligibilityIssues` เดิมทุกครั้ง และเฉพาะกับ expense ที่มี `captureAllocationId`:

| เงื่อนไข (ตามลำดับที่ตรวจ) | ผล | code / HTTP |
|---|---|---|
| ไม่มี allocation ทั้งสองฝั่ง (§3.1 แปลงจาก expense, §3.2 auto-handoff) | ปล่อยให้กฎเดิมตัดสิน | — |
| `handoffState ≠ ACTIVE` หรือ `captureAllocationId ≠ group.acceptedAllocationId` | ปฏิเสธ | `substitute_capture_allocation_superseded` / 409 |
| scope ไม่มีเอกสารใน facts ปัจจุบัน | ปฏิเสธ | `substitute_capture_unpaid_evidence` / 422 |
| scope มีเอกสาร `RECEIPT|TAX_INVOICE|ABBREVIATED_TAX_INVOICE` ที่มียอดพิมพ์ | ไม่เสนอใบรับรอง (A18/A19) | `nextAction = receipt_present`; prepare ยังตอบด้วยกฎเดิม `valid_receipt_normal_path` |
| ไม่มีเอกสารใดใน scope ที่ `paymentStatus = paid` (A23) | ปฏิเสธ | `substitute_capture_unpaid_evidence` / 422 |
| มีเอกสารใน scope ที่ `reconciliation = mismatch` (A34) | ปฏิเสธ | `substitute_capture_document_mismatch` / 422 |
| `fundingSource` ไม่ตรง `fundingRoute` ของ allocation ที่สร้าง source นั้น (EMPLOYEE↔PERSONAL_ADVANCE, COMPANY↔COMPANY; ไม่ใช่ค่าที่กลุ่มกำลังถูกตรวจใหม่) | ปฏิเสธ | `substitute_capture_funding_route_mismatch` / 422 |
| อื่น ๆ | ทำใบรับรองได้ | `nextAction = certificate_available` |

กลุ่มไม่มีใบรับรองของตัวเองโดยโครงสร้าง: route ของใบรับรองรับ `expenseId` และกลุ่มไม่ใช่ `ExpenseRecord`
(ทาง B ของข้อ 2.1) การส่ง groupId จึงได้ 404 จาก `findByIdWithRelations` — มีเทสต์ยืนยัน

### 22.2 Prefill และประโยคที่พิมพ์

- Prefill อยู่ฝั่งเว็บ (`captureCertificatePrefill`): ผู้จ่าย/แหล่งเงินจาก `fundingRoute` + `derivedSources[].payerUserId`,
  วันที่/วิธีจ่ายจาก `facts.payments` ของ scope นั้น (`status = paid`), ผู้รับเงินและเลขภาษีมาจาก
  `vendorNameSnapshot`/`vendorTaxIdSnapshot` ที่ handoff คัดลอกจาก issuer อยู่แล้ว, ยอด = ยอดของ derived source เอง
- **เหตุผลที่ไม่มีใบเสร็จเป็น "ข้อเสนอ" ไม่ใช่ค่าเริ่มต้น**: ช่องนี้เป็นข้อความที่พิมพ์ลงเอกสารตามกฎหมาย โค้ดเดิม
  (`payerWrittenMissingReason`) ห้ามใส่ข้อความของระบบลงไป W06 จึงแสดงข้อเสนอใต้ช่องพร้อมปุ่ม "ใช้ข้อความนี้" — ผู้จ่ายกดเอง
- `snapshotJson.captureAllocation = { groupId, groupRef, allocationId, allocationRevision, scopeKey, paidTotal,
  companyAmount, personalAmount, policyVersion }` อยู่ในค่า checksum ที่ผู้จ่ายรับรอง
- ประโยคที่พิมพ์ใต้ยอด (และเป็นแถวหนึ่งในหน้ารับรองของ PAPER):
  `ใบรับรองนี้รับรองส่วนของบริษัท 810.00 บาท จากยอดที่จ่ายจริง 1,290.00 บาท ตามการจัดส่วนที่ตรวจแล้ว (กลุ่มหลักฐาน g11112222 ครั้งที่ 4)`
  — ตัวเลขผ่าน `money()` (มีลูกน้ำ 2 ตำแหน่ง) และ **ไม่พิมพ์เลยเมื่อ `companyAmount = paidTotal`**

### 22.3 สิ่งที่ต่างจากตัวอักษรของเอกสารนี้ พร้อมเหตุผล (ไม่มีข้อใดเปลี่ยนกติกาเงิน/สิทธิ)

1. **`captureAllocation` มี `allocationRevision` และ `groupRef` เพิ่มจากที่ brief ระบุ** — wording D04 อ้างสองค่านี้
   ถ้าไม่เก็บใน snapshot เอกสารที่ลงนามแล้วจะพิมพ์ค่าที่อ่านใหม่ทุกครั้ง; `groupRef = g<8 ตัวท้ายของ groupId>`
   ใช้ตัวเดียวกับ `evidenceRef` ของ export (ข้อ 18.6) ผู้ทำบัญชีจึงเห็น token เดียวกันทั้งสองที่;
   `allocationRevision = allocation.groupRevision` (ค่าที่มีอยู่จริงบนแถว allocation ไม่ได้นับ allocation ใหม่)
2. **ประโยคพิมพ์ "ใต้บล็อกยอด" ไม่ใช่ "ในกล่องยอด"** — เส้นคอลัมน์ของตาราง (x=630, x=730) ลากถึงขอบล่างของกล่อง
   การวางข้อความในกล่องจะถูกเส้นผ่ากลาง จึงวางถัดจากกล่องและเลื่อนบล็อกเหตุผล/วัตถุประสงค์ลงตามจำนวนบรรทัด
3. **gate ผูกกับ `captureAllocationId` ไม่ใช่ `captureGroupId`** — §3.1 (แปลง expense เป็นกลุ่ม) และ §3.2
   (auto-handoff ของ LINE ไฟล์เดียว) สร้าง source ที่ไม่มี allocation การบังคับ "ต้องมี allocation ที่ยอมรับแล้ว"
   กับสองกรณีนั้นจะปิดเส้นทางใบรับรองของใบเสร็จ LINE ที่ใช้งานอยู่วันนี้
4. **`substitute_capture_funding_route_mismatch` เป็น code ที่ brief ไม่ได้ขอ** — §12.4 บังคับให้ใช้ funding route
   เดียวกับ source ทั้งสาย ถ้าไม่ตรวจ ใบรับรอง COMPANY บนของที่พนักงานจ่ายจะบันทึก `ExpensePayment` ของบริษัทที่ไม่เคยเกิดขึ้น
   (guard เดิมไม่จับ เพราะ `paidAmount = 0` ผ่าน `assertFullSubstitutePayment` ได้)
5. **"มีใบเสร็จใช้ได้" ไม่ได้ถูกทำเป็น 422 ใหม่** — กฎเดิม `valid_receipt_normal_path` ตรวจจาก `sourceDocumentType`
   ของ derived source (ซึ่ง handoff คัดลอกจากชนิดเอกสารของ scope) และเปิดทางไว้ให้ระบุ `RECEIPT_UNAVAILABLE` /
   `RECEIPT_MATERIALLY_INCOMPLETE` ตาม §12.1 W06 จึงใช้ `receipt_present` เพื่อ **ไม่เสนอ** ปุ่มบนหน้ากลุ่มเท่านั้น
6. **`nextAction` ของ derived source ที่ไม่มี allocation คือ `certificate_available`** (ไม่ใช่ `blocked`) —
   หน้ากลุ่มเป็นการเสนอ ไม่ใช่การรับประกัน; wizard เป็นที่ที่กฎ eligibility เต็มรูปตอบพร้อมเหตุผล
7. **prefill ทำฝั่งเว็บ ไม่ได้ทำ default ฝั่ง API** — ถ้า API เติมวันที่จ่ายเองเมื่อ client ไม่ส่ง ค่าที่ผู้ใช้เห็นบนจอ
   (วันนี้) กับค่าที่บันทึกจะต่างกัน; API จึงยังตอบ 400 เหมือนเดิมเมื่อไม่มีวันที่จ่าย และเว็บเป็นผู้เสนอค่าที่ตรวจแล้ว
8. **`payee` ของใบรับรองไม่มีช่องสาขาผู้ขาย** — `vendorBranchCodeSnapshot` จึงไม่ถูกพิมพ์ (เอกสารนี้เขียนว่า prefill
   "issuer name/taxId/branch") การเพิ่มช่องใหม่ในเอกสารที่ลงนามแล้วเป็นการเปลี่ยนแบบฟอร์ม ซึ่งเกินขอบเขต W06
9. **ยอดที่พิมพ์กับยอดใน `captureAllocation` แยกกัน**: ถ้าผู้ตรวจแก้ยอดของ derived source หลัง handoff ใบรับรองจะพิมพ์
   ยอดใหม่ของตัวเอง แต่ประโยค D04 ยังอ้างการจัดส่วนที่ตรวจแล้วตามที่บันทึกไว้ (เป็นข้อความเกี่ยวกับ allocation ไม่ใช่
   เกี่ยวกับยอดในใบ) — การแก้ยอดบังคับให้ลงนามใหม่อยู่แล้ว ผู้ลงนามจึงเห็นทั้งสองค่าก่อนเซ็น
10. **ยังไม่ได้ทำใน W06**: ทางขอเอกสารจากร้าน (spec §16.5), หลักฐาน UX 40+ และ PDF ที่เรนเดอร์จริงบนเบราว์เซอร์ (W08),
    การต่อ claim/projection ของ W07 และการ deploy ใด ๆ
11. **gate ทำงานเฉพาะตอน prepare** — **แก้ใน W07-int (ข้อ 23.2 ข้อ 15)**: preview/certify/approve เรียกซ้ำทุกครั้ง
    (ยกเว้น correction) มิฉะนั้น allocation ที่ถูกแทนที่ระหว่าง prepare กับ approve จะออกใบรับรองที่อ้างการแบ่งส่วนที่กลุ่มไม่บันทึกแล้ว

## 23. Implementation notes (W07-int — เย็บตะเข็บระหว่าง wave, 2026-09-19)

W07-int ไม่ได้ส่ง slice ใหม่ แต่ต่อสิ่งที่ wave ก่อนหน้าเขียนขนานกันแล้วไม่ได้บรรจบ: ผู้เรียก auto-handoff ของ LINE
(ข้อ 3.2), ปลายทาง push ของแชตกลุ่ม, read-status บนหน้าเว็บ, ความเท่ากันของสามทาง, ช่องว่างที่แต่ละ wave บันทึกไว้เอง,
deep link ใบเบิก และ gate ใบรับรองหลังขั้น prepare

### 23.1 Migration เดียว (`20260919120000_expense_capture_push_target`)

1. `ExpenseCaptureGroup.linePushTargetId String?` — chat id ที่ผลการอ่านถูก push กลับเข้าไปได้ (`event.pushTargetId ?? event.lineUserId`
   ค่าเดียวกับที่ ledger ใช้เป็น `chatKey`) server ตั้งเท่านั้น ไม่มีใน dto ใด และ sweep retention ล้างทิ้ง
2. Partial unique index `ExpenseCaptureObservation_companyId_expenseId_version_key ... WHERE "fileId" IS NULL` — raw SQL
   เพราะ Prisma เขียน partial unique ไม่ได้; schema มีคอมเมนต์ชี้ไว้และ `migrate diff` ไม่มองว่าเป็น drift (ตรวจแล้วบน throwaway DB)

### 23.2 สิ่งที่ต่างจากตัวอักษรของเอกสารนี้ พร้อมเหตุผล (ไม่มีข้อใดเปลี่ยนกติกาเงิน/สิทธิ)

1. **ข้อ 19.4 ข้อ 2 (W02-LINE) ถูกแทนที่**: "push ผลอ่านไปได้เฉพาะแชต 1:1" ไม่ใช่ข้อจำกัดอีกต่อไป — `lineChatKeyHash`
   ยัง**ยืนยัน**ปลายทางเท่านั้น (hash กู้กลับไม่ได้จริง) แต่ `linePushTargetId` เป็นปลายทางเอง; กลุ่มที่ไม่มีค่านี้
   (ทุกกลุ่มก่อน migration นี้) fallback ไปแชต 1:1 ของผู้ส่งเหมือนเดิม และทั้งสองทางถูกเทียบกับ hash ที่บันทึกไว้ก่อน push
2. **auto-handoff ถูกเรียกเมื่อ `documentCount ≤ 1` และไม่ใช่เคส NR** — use case เป็นผู้ตัดสินจริง (`captureAutoHandoffEligibility`)
   แต่การถามล่วงหน้าด้วยค่าที่ event พกมาแล้ว ทำให้ผลหลายฉบับไม่ต้องเปิดทรานแซกชันและ lock กลุ่มโดยเปล่าประโยชน์;
   NR01–NR08 ไม่เข้าเส้นทางนี้เลยตาม §18.4 ("ไม่ auto-handoff ผล NR")
3. **สรุปของ auto-handoff อยู่ใน `formatCaptureAutoHandoffReply`** (`line-non-receipt-reply.logic.ts`) ไม่ได้ reuse
   `formatPaypersReply` — ตัวนั้นอยู่ใน `process-line-webhook.use-case.ts` (ไฟล์ 8,000 บรรทัดที่ import logic module นี้อยู่แล้ว
   จึงเป็น cycle) และ CTA ที่ข้อนี้ต้องการคือ "ตรวจสอบและยืนยันในเว็บแอป" ไม่ใช่ "เปิดดูรายการ" ของโหมด compact;
   แถวที่พิมพ์คือ ร้าน / ยอด / ประเภทเอกสาร (`SOURCE_DOCUMENT_TYPE_LABELS` จาก contracts) / วันที่ / "ยังไม่ยืนยันรายการ"
4. **`ExpenseCapturePausedReason` เพิ่ม `memory_budget`** (ข้อ 4.6 ระบุ 4 ค่า) — งบ derivative ต่อ job
   (`EXPENSE_CAPTURE_DERIVATIVE_MAX_BYTES` default 67,108,864) หยุดแบบเดียวกับ `call_budget` คือเก็บผลที่อ่านแล้วไว้;
   ข้อความไทย "ไฟล์ใหญ่เกินที่อ่านอัตโนมัติได้ในรอบเดียว" ทั้ง LINE และ dictionary ของเว็บ
5. **เวลา 15 นาทีของข้อ 4.6 เป็นของ JOB ไม่ใช่ของการรันครั้งเดียว** — `checkpointJson.runMillis` สะสมทุกครั้งที่รัน
   (`derivativeBytes` เช่นกัน); ก่อนหน้านี้ job ที่ตายนาทีที่ 14 ได้เวลาใหม่เต็ม 15 นาทีทุกครั้งที่ถูก claim
6. **`findGroupAllocation` ถาม 2 statement** — `orderBy: { status: 'asc' }` ไม่ได้แปลว่า ACCEPTED มาก่อน: Postgres
   เรียง enum ตามลำดับที่ประกาศ และ enum นี้ประกาศ `PREVIEW` ก่อน `ACCEPTED` กลุ่มที่ reopen แล้ว (§18.2) จึงเคยตอบด้วย
   ข้อเสนอแทนการตัดสินที่ derived source ถูกสร้างจาก
7. **`megabytes` ของ §17.5 เปลี่ยนเป็นทศนิยมหนึ่งตำแหน่งเสมอ** ให้ตรงกับ `captureMegabytes` ของเว็บ — ไฟล์เดียวกันกับ
   ขอบเดียวกันเคยพิมพ์ "10 MB" ที่ LINE และ "10.0 MB" ที่เว็บ
8. **`readJobId` ของ `complete` เป็น `null` ไม่ใช่ `''`** (W01) และ dto ทั้งสองฝั่งตามนั้น — `''` เป็นค่าที่ผู้เรียกส่งต่อได้
   ราวกับเป็น id (`markReadFailed('')` ตอบ false ซึ่งอ่านเหมือน "terminal แล้ว")
9. **caption ที่เป็นคำถามมากับ `file` ตอบเป็น text turn ของตัวเอง** (`defer_text` ที่ buffer รองรับอยู่แล้ว) และไม่ถูกเก็บเป็น
   `note` ของกลุ่ม; ยกเว้นเคส A45 ที่เพิ่งถาม "งานเดิม/ใบใหม่" ไป — turn ที่สองจะทับคำถามที่รอคำตอบอยู่
10. **`ensurePendingMedia` P2002: intent ที่แพ้ race ไม่ถูกส่งให้ `ObjectVersionCleanupService`** — service นั้นลบ *version*
    ของ object ที่มีอยู่ ส่วนผู้แพ้ข้าม `uploadLineMedia` ไปเลยจึงไม่เคยมี version ให้ลบ และ prefix ของ producer ก็ไม่รับ;
    สิ่งที่เหลือคือแถว `AttachmentObject` สถานะ `PENDING_UPLOAD` ที่ไม่มีไบต์ และหลุดจาก `sumPendingBytes`
    (หน้าต่าง `createdAfter`) ไปเอง — **ยอมรับ** พร้อมเหตุผลนี้ในโค้ด
11. **`multiDocument` บนหน้า review อ่านจาก `GET …/read-status`** เมื่อมี read job; เส้นทางรูปเดี่ยวแบบ sync ที่ไม่มี job
    ยังใช้ `classification.contentKind` ของตัวเอง (ถ้าตัดทิ้งจะทำให้ notice ของ lane นั้นหายไปทั้งหมด)
12. **`receipt-ocr-apply` รับ `sourceAttachmentId` เพิ่ม** และล้าง `sourceStale`/`sourceAttachmentId` เมื่ออ่านไฟล์ที่เป็น
    primary ปัจจุบัน — เส้นทาง sync ประกอบ summary ใหม่ทั้งก้อนจึงล้างให้ฟรีอยู่แล้ว ส่วน job lane ไม่เขียน summary เลย
13. **§8 ยังไม่มี sweep ลบไฟล์ของกลุ่ม** (`EXPENSE_CAPTURE_RETENTION_DAYS` ประกาศไว้แต่ไม่มีผู้ใช้) W07-int จึงล้าง
    `linePushTargetId` ตามอายุในสweep เดียวกับ `LineIntakeAttempt` เท่านั้น — การลบไฟล์เป็นงานที่ยังเปิดอยู่
14. **`?expenseId=` ของหน้าใบเบิกใหม่ถาม server เสมอ** (`getReimbursementSourceOptions(…, { expenseId })`) แล้วจึงเติมบรรทัดที่ 1
    ผ่าน builder ตัวเดียวกับ picker; source ที่เบิกไม่ได้พิมพ์เหตุผลของ server แทนที่จะปล่อยฟอร์มเปล่า (ปิดช่องว่างข้อ 21.8)
15. **capture gate ทำงานซ้ำที่ preview/certify/approve** ไม่ใช่เฉพาะ prepare — `assertPreparedExpenseUnchanged` เห็นแค่
    expense ไม่เห็นกลุ่มยอมรับ allocation ใหม่; เอกสาร correction ยังใช้เส้นทางเดิมด้วยเหตุผลเดียวกับ `validateEligibility`
16. **ยังไม่ได้ทำใน W07-int**: ส่วนที่เหลือของ W07 (claim revalidate ตอน submit/approve, finance projection, ledger),
    §16.5 ทางขอเอกสารจากร้าน, sweep ลบไฟล์ของ §8, W08 และการ deploy ใด ๆ
