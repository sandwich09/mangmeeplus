# Bulk Payment File Export Plan — ชุดโอน (จ่ายหลายรายการผ่านธนาคาร)

Status: READY (docs-first) — reviewed 3 rounds 2026-10-24, no HIGH open; see Must close before coding (spec §12.1, M1–M9) · ยังไม่เริ่ม implement
Owner: thawatchai (เจ้าของ) · lane: รายจ่าย + การเบิกจ่าย
Spec: `docs/specs/bulk-payment-file-export-spec.md`
Memory: `docs/agent-memory/bulk-payment-file-export.md`
Related: backlog ข้อ 11 (`docs/research/expense-leadership-verified-backlog-2026-10-23-th.md`), `docs/specs/e-withholding-tax-payment-spec.md` (`ExpenseRecord.whtRemittance`), `docs/guidelines/thai-ux-standard.md`
Baseline: main 6c54ba208 (2026-10-23)
หลักการ: ponytail full — ใช้ use-case จ่ายเดิมและล็อกเดิมของใบเตรียมจ่าย/ใบเบิกทุกครั้ง, endpoint เปิดเลขบัญชีเดิม, `buildWorkbook` เดิม, ไม่มี dependency/สิทธิ์/เมนู/สวิตช์ใหม่; spec ฝั่ง API ลงไฟล์ที่ลงทะเบียนแล้วเท่านั้น (`apps/api/package.json` หรือ whole-chain catalog สำหรับ manifest)

## ลำดับที่บังคับ

- Phase 0 ก่อน Phase 1 (แผ่นงานจะพาชื่อในใบเตรียมจ่ายไปด้วย — ต้องกัน B1 รวมข้อมูลที่บันทึกแล้วก่อน; B4 ต้องปิดก่อนเพิ่มไฟล์หลักฐานชนิดใหม่)
- Phase 1: 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7 → 1.8 → (1.9a → 1.9b) → 1.10
- 1.7 ข้อยกเว้นสลิป (`batchEvidence`) รอ Q2 — ถ้ายังไม่ตอบ ทำทุกอย่างยกเว้นบรรทัด `hasSlip` แล้วบันทึกใน memory
- Phase 2 รอ Q1 + G-1 · Phase 3 ทำเมื่อเจ้าของสั่ง
- รอบ Codex ≤ ~5 ข้อ, ≤3 lane; หยุด process ด้วย PID/พอร์ตของตัวเองเท่านั้น

## การตรวจที่ใช้ทุกขั้น (คำสั่งเจ้าของ: typecheck + boot + spec ที่แตะ)

```bash
pnpm --filter @watchdog-bms/contracts build
pnpm --filter @watchdog-bms/api typecheck          # script ของ package มี heap flag; อ่าน exit code จริง
pnpm --filter @watchdog-bms/api prisma:validate     # เมื่อแตะ schema
cd apps/api && ../../node_modules/.bin/tsx --test <เขียน path spec ทีละไฟล์ ห้ามตัวแปร zsh ที่ไม่แยกคำ>
pnpm --filter @watchdog-bms/web typecheck && pnpm --filter @watchdog-bms/web test
```
ตรวจจำนวน test ที่รันจริง; spec PostgreSQL ใช้ docker postgres `:15432`; หน้าจอตรวจที่ 390, 1280, ≥1536 px เปิดเมนูข้าง พร้อมภาพหน้าจอที่ดูแล้ว (`docs/guidelines/thai-ux-standard.md:77`)

---

## Phase 0 — แก้บั๊กเดิมของใบเตรียมจ่าย (spec §13)

### 0.1 B1: ชื่อธนาคาร/ชื่อบัญชี/ชื่อผู้รับ ที่ API (รวมทางคัดลอกและข้อมูลที่บันทึกแล้ว)
- `apps/api/src/modules/expenses/application/use-cases/disbursement-voucher.use-case.ts`: `validateInput` (`:44-60`), `account()` (`:115-126`) ใช้ `PAYOUT_BANK_NAME_MAX_LENGTH` 80, `PAYOUT_ACCOUNT_NAME_MAX_LENGTH` 140, `payeeName` ≤200 และ `looksLikeAccountNumber` (`packages/contracts/src/reimbursements.ts`)
- ทางคัดลอก `payeeAccountFromVoucherId` (`:201-211`): ตรวจชื่อของใบต้นทางด้วยกติกาเดียวกัน ไม่ผ่าน → `disbursement_account_name_invalid`
- B7 (F8 รอบ 3): ตรวจ **ชื่อผู้รับค่าสุดท้ายหลัง fallback** ที่ `:108` (`body.payeeName || vendorNameSnapshot || …`) ด้วยกติกาเดียวกัน ไม่ผ่าน → `disbursement_payee_name_invalid` ("ชื่อผู้รับดูเหมือนมีเลขบัญชี พิมพ์ชื่อผู้รับใหม่")
- ฟังก์ชัน pure `disbursementAccountTextIssue(voucher)` ใช้ซ้ำใน 1.2 เพื่อตรวจข้อมูลที่บันทึกไว้แล้วตอนเข้าชุด (`account_name_invalid`)
- `packages/contracts/src/disbursement-vouchers.ts`: `disbursement_account_bank_invalid`, `disbursement_account_name_invalid` (ประโยคเดียว + ทางแก้ "ช่องนี้ใส่ชื่อเท่านั้น ใส่เลขบัญชีในช่องเลขบัญชี")
- เว็บ: **ไม่แก้ความยาว** (มี `maxLength={140}` แล้ว `DisbursementVoucherAccountFields.tsx:69`, ธนาคารอื่น 80 `:66`) แสดงเฉพาะ error ใหม่ที่ช่อง
- Test: `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts` — ชื่อมีเลข 10 หลัก → 400; ยาวเกิน → 400; คัดลอกจากใบที่ชื่อมีเลข → 400; ชื่อปกติผ่าน
- ตรวจ: contracts build, api typecheck, spec นี้, web typecheck

### 0.2 B2: กติกาสถานะของการเปิดเลข + PDF
- `revealAccount` (`:159-172`): ร่างเปิดได้เฉพาะผู้ที่ `disbursementVoucherActions(...).edit`; ยกเลิกแล้วเปิดไม่ได้; error `disbursement_account_reveal_not_now`
- `documentPdf` (`:344-349`): ตรวจกติกาเดียวกันแบบไม่โยนก่อนเรียก `revealAccount` — ไม่ผ่าน → คืน PDF ฉบับปิดบัง (ใบยกเลิกก่อนจ่าย/ร่างของคนอื่น) ไม่ให้ PDF พัง (F13)
- ทางคัดลอกบัญชี (B6, F2 รอบ 3): ใน `saveDraft` ทางคัดลอก `payeeAccountFromVoucherId` (`disbursement-voucher.use-case.ts:201-211`) ใบต้นทางต้องผ่านกติกาเดียวกับ `revealAccount` (ไม่ใช่ `CANCELLED`, ไม่ใช่ร่างของคนอื่น) นอกจากการอ่านได้และผู้รับตรงกัน (`:202`) ก่อนคัดลอก ciphertext (`:211`); ไม่ผ่าน → `disbursement_account_source_denied` เดิม
- บัญชีแนะนำ (F6 รอบ 2): `apps/api/src/modules/expenses/infrastructure/prisma-disbursement-voucher.repository.ts` `payeeAccount()` (`:104-115`) ไม่เสนอใบ `CANCELLED` และร่างของคนอื่น (แก้ `rank` `:111` เป็นตัวกรอง) และคืน `canReveal` จากกติกาเดียวกับ `revealAccount`; contracts `DisbursementPayeeAccount` (`packages/contracts/src/disbursement-vouchers.ts:280`) เพิ่ม `canReveal`
- เว็บ `DisbursementVoucherAccount.tsx`: ซ่อนปุ่มแสดงเลขตาม actions ของ API; `DisbursementVoucherAccountFields.tsx` (`:30-41`) ใช้ `canReveal` ของบัญชีแนะนำแทน `canRevealDisbursementAccount(permissions, 'DRAFT', …)`
- Test: ไฟล์เดียวกับ 0.1 — ส่ง `payeeAccountFromVoucherId` ของใบยกเลิก/ร่างคนอื่นตรง ๆ → 403 (B6); ผู้จ่ายเปิดร่างคนอื่น → 403; ผู้จัดทำเปิดร่างตน → ได้; ใบยกเลิก → 403; PDF ใบยกเลิกก่อนจ่ายโดยผู้อนุมัติ → 200 ฉบับปิดบัง; บัญชีแนะนำไม่มาจากใบยกเลิก และ `canReveal` ตรงกับผลของ reveal แบบ `prefill`
- ตรวจ: เหมือน 0.1

### 0.3 B4: ไฟล์ของใบเตรียมจ่ายไม่ใช่ใบเสร็จใบเบิก (P1/F3 รอบ 2)
- `apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-attachment.repository.ts`: `NOT_PAYMENT_EVIDENCE_WHERE` = เงื่อนไขของ `NOT_REIMBURSEMENT_PAYMENT_SLIP_WHERE` (`:32-40`) + ไม่มีลิงก์ `disbursement_voucher` และป้าย `generatedFor` ไม่ใช่ `DISBURSEMENT_VOUCHER_SLIP_UPLOAD_TAG`/`DISBURSEMENT_VOUCHER_SUPPORTING_UPLOAD_TAG` และ `generatedBy` ไม่ใช่ `disbursement_voucher` (ระวัง NULL ของ JSON path แบบที่คอมเมนต์ `:28-31` อธิบาย)
- `apps/api/src/modules/line-ai/application/line-reimbursement-draft-adapter.service.ts:802`: ใช้ตัวกรองใหม่
- `apps/api/src/modules/reimbursements/application/services/reimbursement-evidence.service.ts:37-43`: ปฏิเสธ `invalid_primary_attachment` เมื่อ `isDisbursementVoucherFile` หรือป้ายของใบเตรียมจ่าย
- Test (ไฟล์ใน `apps/api/package.json` เท่านั้น — F6 รอบ 3): `apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.spec.ts` (บันทึกบรรทัดด้วยสลิปใบเตรียมจ่าย → 422), `apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.draft-submit-race.spec.ts` (PG จริง ใน `pretest`; สร้าง `LineReimbursementDraftAdapterService` อยู่แล้ว: ไฟล์ใบเตรียมจ่ายไม่อยู่ในตัวเลือก) — ไม่ใช้ `line-reimbursement-draft-adapter.pg.spec.ts` และ `reimbursement-evidence.service.spec.ts` ซึ่งอยู่แค่ใน whole-chain catalog (`:545`, `:591`) (spec §12.1 M7)
- ตรวจ: api typecheck + สองไฟล์ + whole-chain (ไฟล์ adapter อยู่ใน LINE path)

### 0.4 B5: การจ่ายรายจ่ายตรวจงวดบัญชีที่ปิดแล้ว (F1 รอบ 3)
- `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts` `recordPaymentInTransaction` (`:670-723`): ภายในธุรกรรม ก่อน `expensePayment.create` (`:723`) ตรวจ `AccountingPeriod` ของเดือน `paidAt` แบบเดียวกับ `assertPaymentPeriodOpen` ของใบเบิก (`prisma-reimbursement.repository.ts:3602-3610`) → `expense_payment_accounting_period_locked:{periodKey}` + ข้อความไทยใน contracts (ทางออก: "เลือกวันที่จ่ายในงวดที่ยังเปิด หรือให้ผู้ดูแลบัญชีเปิดงวด")
- ใบเบิก: ย้ายการตรวจงวดเข้าไปใน `recordPaymentAtomic` ด้วย (คงการตรวจก่อนธุรกรรมไว้เป็นข้อความล่วงหน้า)
- อะตอมกับคำสั่งปิดงวด = spec §12.1 M8 (ไม่ทำในงานนี้)
- Test: `apps/api/src/modules/expenses/application/use-cases/record-expense-payment.use-case.spec.ts` (ลงทะเบียนแล้ว) และ `prisma-expense.repository.payment.spec.ts` (จ่ายตามใบเตรียมจ่ายในงวดปิด → ปฏิเสธ)
- ตรวจ: api typecheck + สองไฟล์

---

## Phase 1 — ชุดโอน: แผ่นงานทุกธนาคาร + รายการคัดลอกบนมือถือ + บันทึกผล

### 1.1 Schema, migration, contracts, เลขชุด
- `apps/api/prisma/schema.prisma`: enum 3, model `PaymentBatch`, `PaymentBatchItem`, `PaymentBatchCommand`, `ReimbursementPayment.paymentBatchItemId`, relation `Company` (spec §6)
- `apps/api/prisma/migrations/2026MMDDhhmmss_payment_batches/migration.sql`: ตาราง/index + CHECK 4 ตัว (spec §6 รวม `PaymentBatch_file_check` ที่ยอม CLOSED ไม่มีข้อมูลดาวน์โหลด — F5)
- `packages/contracts/src/payment-batches.ts` + export ใน `packages/contracts/src/index.ts` (ค่าคงที่ ชนิด คำทุกประโยคของ spec §10 ป้ายสถานะ error words)
- `apps/api/src/modules/data-model-core/domain/logic/document-sequence.logic.ts`: `payment.batch`
- ตรวจ: `prisma:validate`, `prisma generate`, contracts build, `prisma migrate deploy` บน local สะอาด, ขั้น migration catalog ตาม `docs/runbooks/uat-production-v2-deployment.md`

### 1.2 Domain logic ล้วน
- `apps/api/src/modules/payment-batches/domain/payment-batch.logic.ts`: เหตุผล §5.1 (รวม `account_name_invalid`, `ewht` เมื่อมี `whtRemittance`), ปัดยอด, ลายนิ้วมือ `sourceVersion` (ใบเตรียมจ่ายไม่รวม `version`/`slipAttachmentId`; ใบเบิก = status+outstanding+payoutDestinationVersion+payoutFingerprint), transition §9, ผู้รับซ้ำ, ค่าตรึงและ digest canonical, สามสถานะผล
- `apps/api/src/modules/payment-batches/domain/payment-batch-file.logic.ts`: `buildGenericBatchWorkbook(frozenRows, summary)` ด้วย `buildWorkbook` (`apps/api/src/common/export/xlsx.logic.ts:192`)
- Test: `apps/api/src/modules/banking/domain/logic/banking.logic.spec.ts` (ทุก reason, 580.0042/580.0050, ลายนิ้วมือไม่เปลี่ยนเมื่อแนบสลิป, export = เฉพาะ PENDING, digest คงที่, คอลัมน์ต้องห้าม, ศูนย์นำหน้า)
- ตรวจ: api typecheck + spec นี้

### 1.3 ล็อก/hook ของต้นทาง + invariant บน PostgreSQL
- **ลำดับล็อกเดียว (spec §5.5)**: ① advisory ชุด → ② advisory ต้นทางเรียง key → ③ แถว `PaymentBatch` `FOR UPDATE` → ④ แถว item `FOR UPDATE` เรียง id; ข้ามขั้นได้ ห้ามย้อน
- **isolation (F3 รอบ 3)**: การจ่ายใบเบิกเป็น `Serializable` (`prisma-reimbursement.repository.ts:3828`) ส่วนใบเตรียมจ่ายเป็น `ReadCommitted` (`prisma-disbursement-voucher.repository.ts:308`) → hook ในธุรกรรมการจ่ายแตะ **เฉพาะแถว item (④)** และต้อง `FOR UPDATE` แถว item เปิดของต้นทางเสมอ (ทำให้การจ่ายที่ snapshot เก่ากว่าการตรึงล้มด้วย serialization failure); การนับ PENDING และปิดชุดอยู่ใน `closeBatchIfDone` (ธุรกรรม `ReadCommitted` แยก หลัง commit)
- `apps/api/src/modules/payment-batches/domain/payment-batch-source.ts`: `assertSourceNotInSentBatch(tx, …, allowItem?)` (อ่านธรรมดาใต้ล็อกต้นทาง), `markBatchItemPaid(tx, …, expectedItem?)` (④ เท่านั้น; มี `expectedItem` แต่ไม่ PENDING → โยน; เขียน `resultAttachmentId`/`resultsCommandId`), `markBatchItemFailed(tx, …)`, `closeBatchIfDone(companyId, batchId)` (ธุรกรรมแยก ① → ③ → นับ → `CLOSED` + ลบ ciphertext ตรึง; idempotent; เรียกซ่อมตอนอ่านชุดด้วย), `lockBatchSources(tx, items)` (ล็อกชุด → ต้นทางเรียง key: voucher `…:disbursement-voucher-lifecycle`; claim `…:reimbursement-payment` แล้ว `…:reimbursement-request`)
- Test (PG): `apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.draft-submit-race.spec.ts` — unique `openSourceKey`, CHECK ทั้งสี่ (รวม CLOSED ไม่มีข้อมูลดาวน์โหลด), hook ใน tx ที่ rollback → item ยัง PENDING, `expectedItem` ไม่ PENDING → การจ่าย rollback, **จ่าย vs นำออก, จ่าย vs ยกเลิก/ปิด, จ่ายรายการสุดท้ายสองรายการพร้อมกัน** (ไม่มี deadlock, ชุดปิดครั้งเดียว)
- ตรวจ: api typecheck + spec นี้ (PG)

### 1.4 Repository + use-case สร้าง/แก้/ยกเลิก/อ่าน + controller + module + preview แบบ deferred
- `apps/api/src/modules/payment-batches/infrastructure/prisma-payment-batch.repository.ts`: create (จองเลขใน tx), add/remove/refresh (CAS version), cancel (`POST :id/cancel`, ไม่มี PAID) / close (`POST :id/close` + `ClosePaymentBatchInput`, DRAFT ที่มี PAID ≥1 และ PENDING ≥1: เฉพาะ PENDING → DROPPED, ชุด → CLOSED, `droppedOnClose` — F4 รอบ 3) / cancel FILE_READY (`lockBatchSources` + ไม่มี PAID); `actions.cancel`/`actions.close` ไม่จริงพร้อมกัน, list/detail (§8), `PaymentBatchCommand` replay เฉพาะคำสั่งที่เปลี่ยนข้อมูล (fingerprint ตรง → ผลเดิมแม้ version เดิน; ต่าง → 409); `download` บันทึกเฉพาะการตรึง ไม่ใช่ replay ไบต์ (F5)
- `apps/api/src/modules/payment-batches/application/payment-batch.use-case.ts`: `candidates()` — voucher ผ่าน `previewLineAction(ctx, 'pay', …)` (`disbursement-voucher.use-case.ts:135-157`); claim ผ่าน `RecordReimbursementPaymentUseCase.execute(…, { previewOnly: true, evidence: 'deferred' })`; audit `create|items.change|cancel`
- `apps/api/src/modules/reimbursements/application/use-cases/reimbursement-finance.use-case.ts`: โหมด `evidence: 'deferred'` — เฉพาะเมื่อ `previewOnly` ส่ง `hasSlip: true` ที่ `:463` และข้ามการตรวจอ้างอิง ไม่เขียน ไม่จองเลข (F7)
- `presentation/http/payment-batch.controller.ts`, `payment-batch.dtos.ts`, `payment-batches.module.ts` (import `ExpensesModule`, `ReimbursementsModule`, `AuditModule`, `DataModelCoreModule`), ลงทะเบียน `apps/api/src/app.module.ts`; LINE session ถูกปฏิเสธ
- Test: `apps/api/src/modules/banking/presentation/http/banking.dtos.spec.ts` (DTO), `apps/api/src/modules/reimbursements/application/use-cases/reimbursement-finance.use-case.spec.ts` (deferred preview ผ่านโดยไม่มีสลิป; ทางปกติยังบังคับสลิป; legacy/เงินสด/ซ้ำ/นอกสาขา), `prisma-expense.repository.payment.spec.ts` (ใบเตรียมจ่ายไม่มีบัญชี/จ่ายแบบอื่น/อยู่ชุดอื่น/ชื่อมีเลข)
- ตรวจ: api typecheck + `test:boot` + สามไฟล์

### 1.5 ดาวน์โหลดครั้งแรก (ตรึง) และดาวน์โหลดซ้ำ (F3, F4, F8, F10)
- ครั้งแรกในธุรกรรมเดียว: `lockBatchSources` → อ่านต้นทางใหม่ เทียบลายนิ้วมือ → อำนาจจ่ายต่อรายการ (voucher `expense.disbursement.pay`; claim `reimbursement.payment.record` + สาขา + มีบัญชีของใบ — **ไม่อิงชื่อกลุ่ม reveal**) → audit `payment_batch.file.download` ใน tx → ถอดรหัสต้นทาง (`openPayoutAccountNumber`) แล้ว `encryptCredential` เก็บ `exportAccountCiphertext` + ค่าตรึงอื่น + `exportItemCount/TotalAmount/DigestSha256` เฉพาะรายการ PENDING → FILE_READY → commit → สร้างไฟล์จากค่าตรึง (นอก tx)
- ซ้ำ (รวมการส่งคำสั่งดาวน์โหลดเดิมซ้ำ): เฉพาะชุด `FILE_READY` · เปิดชุดได้ + อำนาจจ่ายของทุกรายการที่ตรึง → `audit.logOrThrow` → ถอดรหัสค่าตรึง → digest ต้องตรง → สร้างไฟล์ · ชุด `CLOSED`/`CANCELLED` → 409 `payment_batch_file_unavailable` (F5)
- วัดเวลาธุรกรรมที่ล็อก 100 ต้นทางบน local PostgreSQL บันทึกใน memory (spec §12.1 M6)
- controller `POST :id/file`: `XLSX_MIME_TYPE`, `Content-Disposition` `{เลขชุด}.xlsx`, `Cache-Control: no-store`
- Test: `banking.logic.spec.ts` (สร้างไฟล์จากค่าตรึง), `reimbursement-finance.use-case.spec.ts` (ผู้จ่ายที่เป็นผู้อนุมัติใบนั้นด้วยผ่าน; audit ล้ม → ไม่ตรึง ไม่มีไฟล์; ดาวน์โหลดซ้ำหลังใบที่ FAILED ถูกแก้บัญชี → แถวเดิม), PG spec 1.3 (แข่ง: จ่ายปกติ vs ดาวน์โหลดครั้งแรก → อย่างใดอย่างหนึ่ง; ciphertext หายเมื่อชุดจบ)
- ตรวจ: api typecheck + spec ที่แตะ; เปิดไฟล์ตัวอย่างใน Excel/Numbers (บันทึกใน memory)

### 1.6 ไฟล์ผลจากธนาคาร + รั้วไฟล์แนบ (F1)
- อัปโหลด: `POST :id/result-upload-intent`, `:id/result-uploads/:attachmentId/complete` copy ท่อสลิปใบเตรียมจ่าย (`disbursement-voucher.use-case.ts:365-500`, controller `:157-172`) ติดป้าย `generatedFor: 'payment_batch_result'` + `batchId`, ผูก `payment_batch` / `payment_batch.bank_result`; `GET :id/result-files/:attachmentId` หลังตรวจเปิดชุด
- `apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-attachment.repository.ts`: `isPaymentBatchResultFile(input, tx?)`; `markDeleted` ปฏิเสธ `payment_batch_result_retained` ใต้ล็อก retention (คู่กับ `:266-276`); เพิ่มไฟล์ผลชุดเข้า `NOT_PAYMENT_EVIDENCE_WHERE` จาก 0.3 (ตัวเลือกไฟล์ร่างใบเบิก LINE `:802`) และเข้าการตรวจใบเสร็จ `reimbursement-evidence.service.ts:37-43` (P1)
- `apps/api/src/modules/data-model-core/application/use-cases/create-download-url.use-case.ts`: ปฏิเสธดาวน์โหลดทั่วไป (คู่กับ `:79-101`)
- `apps/api/src/modules/data-model-core/domain/logic/attachment.logic.ts` `findAttachmentLinkConflict` (`:83`): purpose นี้ผูกได้ชุดเดียว
- `apps/api/src/modules/reimbursements/application/use-cases/reimbursement-claim-signature.use-case.ts` (`:250-251`): ปฏิเสธเป็นภาพลายเซ็น
- Test: `apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-attachment.repository.spec.ts` (ลงทะเบียนแล้ว) — ดาวน์โหลดทั่วไป/ลบ/ผูกใหม่/เสนอแนบ ถูกปฏิเสธทั้งหมด
- ตรวจ: api typecheck + spec นี้

### 1.7 บันทึกผล (รอบ, ต่อแถว, หลักฐาน) + ล็อกในทางเดิม (F2, F3, F6, F9, F11, F14)
- รอบ: tx สั้น ล็อกชุด → CAS `version` → ตั้ง `resultsRunCommandId/StartedAt` (lease 10 นาที) → บันทึก `PaymentBatchCommand` (resultJson ว่าง); ส่งซ้ำคำสั่งเดิม = ทำต่อเฉพาะแถว PENDING; รับเฉพาะแถวที่เลือกผล
- "สำเร็จ" ใบเตรียมจ่าย: อ่าน `version` ปัจจุบัน → `pay(ctx, id, { commandId: 'bt:'+batchId+':'+itemId, expectedVersion, paidDate, paymentMethod: 'BANK_TRANSFER', paidFromRef: 'ชุดโอน '+เลขชุด }, false, { paymentBatchItem })` — `pay()` (`disbursement-voucher.use-case.ts:731`) รับ option; ใน `lifecycleAtomic` (`apps/api/src/modules/expenses/infrastructure/prisma-disbursement-voucher.repository.ts:280-310`) หลังล็อก: `assertSourceNotInSentBatch(allowItem)` + ตรวจลายนิ้วมือ + `markBatchItemPaid(expectedItem)`
- "สำเร็จ" ใบเบิก: `execute(…, { paymentBatchItem: { batchId, itemId, resultAttachmentId, resultsCommandId } })` — **preflight ของ use-case (F1 รอบ 2, HIGH)**: `reimbursement-finance.use-case.ts:463` ใช้ `hasSlip: Boolean(input.slipAttachmentId) || batchEvidencePreflightOk` (อ่านอย่างเดียว: รายการของชุดนี้/ต้นทางนี้ `PENDING`, ชุด `FILE_READY`, ไฟล์ผลผูกกับชุดและ ACTIVE) (`assertPaymentSlipUsable` ที่ `:483-488` ทำงานเฉพาะเมื่อมีสลิปอยู่แล้ว ไม่ต้องแก้) → `recordPaymentAtomic` (`apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts:3644-3760`) รับ `batchEvidence`; หลัง `:3645`: `assertSourceNotInSentBatch(allowItem)`, ตรวจ item `FOR UPDATE` + ไฟล์ผลผูกกับชุดและ ACTIVE → `hasSlip: Boolean(data.slipAttachmentId) || batchEvidenceVerified` แทน `:3706` (Q2) → เก็บ `paymentBatchItemId`; `onPaymentPersisted` (`reimbursement-finance.use-case.ts:501`) เรียก `markBatchItemPaid(expectedItem)`; `isSamePaymentRequest` (`reimbursement.logic.ts:878-900`) เทียบ `paymentBatchItemId`
- "ไม่สำเร็จ": tx ล็อกต้นทาง (key เดียวกับข้างบน) → `markBatchItemFailed` (ต้อง PENDING และไม่มีการจ่าย key `bt:…`) → ปลดล็อก
- ถูกปฏิเสธ: เก็บ `lastRefusalCode/Message/AttemptAt` คง PENDING; ชนกับการตัดสินอื่น → `ALREADY_DECIDED`
- serialization failure ของใบเบิก (409 `reimbursement_payment_state_changed`): ตัววนผล **ลองทั้งธุรกรรมใหม่ไม่เกิน 3 ครั้ง** ด้วย key เดิม แล้วจึงเก็บเป็น refusal; หลังแต่ละแถว commit เรียก `closeBatchIfDone` (F3 รอบ 3)
- Test เพิ่ม (PG `prisma-reimbursement.repository.draft-submit-race.spec.ts`): จ่ายใบเบิกรายการสุดท้ายสองรายการพร้อมกันผ่าน `recordPaymentAtomic` จริง → ทั้งคู่ PAID, ชุดปิดครั้งเดียว; การจ่ายใบเบิกที่ snapshot ก่อนการตรึง → rollback ไม่มีการจ่าย
- ล็อกในทางเดิม (ใน tx หลังล็อกต้นทาง): voucher `command()` (`disbursement-voucher.use-case.ts:561`) `withdraw|return|cancel` และ `pay()` จากหน้าใบ; claim `recordPaymentAtomic` ทั่วไป; เมธอด repository ของ `CancelReimbursementUseCase` (`reimbursement-request.use-case.ts:1076`) และ `RequestPayoutCorrectionUseCase` (`reimbursement-payout-correction.use-case.ts:33`) หลัง `lockRequest`; `attachSlipAtomic` **ไม่ล็อก** (ลายนิ้วมือไม่เปลี่ยน)
- ที่มาของหลักฐาน (F4 รอบ 2): ทุกการตัดสินเขียน `resultAttachmentId` + `resultsCommandId` ลงรายการในธุรกรรมเดียวกัน
- Test: `prisma-expense.repository.payment.spec.ts` (ล็อก 4 คำสั่ง, ยอมเฉพาะรายการที่ตรง, แนบสลิปแล้วจ่ายผ่านชุดได้, replay `bt:`, รายการได้ `resultAttachmentId` ของรอบตัวเอง), `reimbursement-finance.use-case.spec.ts` (**จ่ายผ่านชุดโดยไม่มีสลิปไม่ล้มที่ preflight**, `batchEvidence` ถูก/ผิด/ไฟล์ถูกลบ/ชุดอื่น, ไม่มีสลิปผ่านเมื่อหลักฐานชุดถูก, `paymentBatchItemId` ใน replay, จ่ายจากหน้าใบถูกล็อก), `apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.spec.ts` (ยกเลิกถูกล็อก), PG spec 1.3 (แข่ง "สำเร็จ" vs "ไม่สำเร็จ" แถวเดียวกัน → ผลเดียว ไม่มีการจ่ายค้างกับ FAILED; ยกเลิกใบเบิกระหว่าง FILE_READY ถูกปฏิเสธ)
- ตรวจ: api typecheck + สี่ไฟล์ + `node scripts/run-line-ai-whole-chain-acceptance.mjs`

### 1.8 LINE: ข้อความปฏิเสธ + ปุ่ม (F16)
- `apps/api/src/modules/line-ai/application/line-expense-action.service.ts`: `refusal()` (`:1014`) แปล `payment_batch_source_locked` ก่อนบรรทัด Conflict ทั่วไป (`:1083`); ทุกจุดคืน refusal (`:594`, `:709`, `:850`, `:955`, `:975`) แนบ `webPath`/`webLabel` "เปิดชุดโอน" เมื่อ `canOpenBatch` (ชนิดผลรองรับแล้ว `:106`)
- ตัวส่งข้อความต่อเนื่อง (P16): `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` ทางตอบเหตุผล (`:6776-6785`) ส่งการ์ดข้อความระบบพร้อมปุ่มเมื่อ `answer.webPath` มี (แทน `{ type: 'text', text: answer.reply }`); ทางสลิป (`:9779-9784`) ใช้ `slip.webLabel` เมื่อมี
- Test: `apps/api/src/modules/expenses/application/use-cases/line-draft-update.security.spec.ts` (ลงทะเบียนแล้ว; มีเคส VOUCHER_PAY `:1364-1378`) — preview และ signed confirm ได้ข้อความ + ปุ่มเมื่อเปิดชุดได้, ไม่มีปุ่มเมื่อเปิดไม่ได้; `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` (ลงทะเบียนทั้ง package.json และ catalog) — ข้อความที่ส่งจริงของสองทางต่อเนื่องมีปุ่ม/ป้ายที่ถูกต้อง
- W00: ทั้งสองไฟล์ถูก hash (`apps/api/src/modules/line-ai/line-ai-capability-manifest.ts:40`, `:240`) → สร้าง manifest ใหม่ใน 1.10
- ตรวจ: api typecheck + spec นี้

### 1.9a เว็บ: client, logic, หน้ารายการ, หน้าสร้าง, ทางเข้า
- `apps/web/src/features/payment-batches/payment-batches.api.ts`, `payment-batch.logic.ts` (+ `payment-batch.logic.spec.ts`)
- หน้า `apps/web/app/(workspace)/companies/[companyId]/payment-batches/page.tsx`, `.../new/page.tsx` + `PaymentBatchListPage.tsx`, `PaymentBatchNewPage.tsx` (spec §10.2, §10.4)
- ทางเข้า: `apps/web/src/features/expenses/disbursement-vouchers/DisbursementVoucherListPage.tsx`, แท็บรอจ่ายใน `apps/web/src/features/reimbursements/ReimbursementsPages.tsx`
- สิทธิ์หน้า (F7 รอบ 3): `apps/web/src/features/web-core-workspace/route-permissions.ts` (`ROUTE_PERMISSION_RULES` `:9`) เพิ่ม `/payment-batches/new`, `/payment-batches/`, `/payment-batches` anyOf `expense.disbursement.pay`, `reimbursement.payment.record` แบบกติกาใบเตรียมจ่าย (`:113-115`) — test ในไฟล์ spec ของ web ที่ใช้ `findRoutePermissionRule` อยู่แล้ว (`settings-menu.logic.spec.ts`) หรือ `payment-batch.logic.spec.ts`
- ตรวจ: web typecheck + web test; กดจริงที่ 390/1280/≥1536 px พร้อมภาพหน้าจอที่ดูแล้ว (วัดขนาดปุ่ม)

### 1.9b เว็บ: หน้าชุด, ดาวน์โหลด, บันทึกผล, แถบบนหน้าใบ
- `.../payment-batches/[batchId]/page.tsx` + `PaymentBatchPage.tsx` (§10.3 — ลิงก์ "นำออก" แสดงตรง ไม่ซ่อนในเมนู; "ยอดในแผ่นงาน" เฉพาะเมื่อต่าง; ข้อความขั้นต่อไปไม่อ้างการอัปโหลด; ปุ่ม "ยกเลิกชุด"/"ปิดชุด" ตาม `actions.cancel`/`actions.close` พร้อมกล่องยืนยันสองแบบ — F8; ป้าย CLOSED = "ปิดแล้ว" และบรรทัดสถานะตาม `droppedOnClose` ("บันทึกผลครบแล้ว" เฉพาะเมื่อ 0) — F5 รอบ 3; ชุดที่จบแล้วไม่มีปุ่มดาวน์โหลด — F5)
- `PaymentBatchResultsPanel.tsx`: สามสถานะต่อแถว ค่าเริ่มต้น "ยังไม่ทราบผล", ปุ่ม "แถวที่เหลือสำเร็จทั้งหมด", ส่งเฉพาะแถวที่เลือก, สรุปซ้ายของแถบล่าง
- "บันทึกจ่าย" ต่อแถว: `DisbursementVoucherPayCard.tsx` / ฟอร์มจ่ายใน `ReimbursementDetailSections.tsx` ในแผ่นเลื่อน
- คัดลอกเลข: `revealDisbursementVoucherAccount` (`apps/web/src/features/expenses/disbursement-vouchers/disbursement-vouchers.api.ts:76`) / `revealClaimPayoutAccount` (`apps/web/src/features/reimbursements/reimbursement-payout.api.ts:31-33`) แล้ว `navigator.clipboard.writeText`
- แถบ "อยู่ในชุดโอน …" + ข้อความล็อก §10.6 บนหน้าใบทั้งสองชนิด
- ตรวจ: web typecheck + web test; กดจริง journey A, A2, B ที่สามความกว้าง; memory บันทึกว่ากดอะไรแล้ว/ยังไม่ได้กด

### 1.10 คู่มือ, การ์ด LINE, W00, journey, เอกสาร (F17, F22, F26)
- `apps/web/src/features/user-guide/payment-batch-guide.content.ts` (ใหม่) บนหน้าคู่มือรายจ่าย anchor `payment-batches`
- `apps/web/src/features/user-guide/payment-batch-guide.content.ts` สองหัวข้อ (anchor `payment-batches`, `bank-connection`) ประกอบเข้าหน้าคู่มือรายจ่าย
- `apps/ai-gateway/src/modules/line-ai/agents/product-help-draft-cards.ts` (P17): ตัวสร้าง `card()` (`:3-13`) ฝัง URL/ไฟล์/hash ของ getting-started (`:6-8`) → เพิ่มพารามิเตอร์ `{ guidePath, sourceFile, sourceHash }` (การ์ดเดิมส่งค่าเดิม ไม่เปลี่ยน hash ของการ์ดเดิม) แล้วสร้างการ์ด DRAFT สองใบตาม spec §10.5 (การ์ด 1 ไม่มีคำถามเรื่องเชื่อมธนาคาร; การ์ด 2 "เชื่อมธนาคาร" ตอบ "ยังไม่ได้ค่ะ" — F9) ด้วย `guidePath: 'expenses'` และ hash ของ `payment-batch-guide.content.ts`; ปุ่ม = ชื่อการ์ด (`approved-knowledge.ts:94`, `:160`); `approved-product-help.ts` ไม่ต้องแก้ ถ้าการ์ดอยู่ในรายการ draft เท่านั้น
- W00: `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1` รัน `apps/api/src/modules/line-ai/line-ai-capability-manifest.spec.ts` (ลงทะเบียนใน `scripts/line-ai-whole-chain-acceptance.catalog.mjs:398` ไม่ใช่ package.json) แล้วรันซ้ำไม่ตั้งค่า + `node scripts/run-line-ai-whole-chain-acceptance.mjs`
- Journey `e2e/journeys/pay-many-by-bank-file.journey.spec.ts` (A, A2, B, D ที่ 390/1280/1536 ด้วย `expectFitsScreen` + ภาพหน้าจอ, `pressForDownload` ตรวจหัวคอลัมน์และจำนวนแถว) + journey เดิม `payment-document-two-people`, `claim-declined-then-paid`, `voucher-supporting-files` บน proof stack ที่ล้างใหม่
- เอกสาร: `docs/specs/permission-matrix.md`, `docs/specs/mangmee-package-entitlements-spec-th.md`, ชี้มาจาก `expense-payment-preparation-voucher-spec-th.md` §16 และ `reimbursement-payout-account-and-payment-slip-spec-th.md:101`; ปรับ D3 ตาม Q2; memory

---

## Phase 2 — SCB Business Anywhere (รอ Q1 + G-1)

### 2.1 ยืนยันแม่แบบ
- ขอไฟล์แม่แบบนำเข้า (SCB Transfer / ORFT / Smart วันถัดไป / PromptPay) จากบัญชีจริง บันทึกลำดับคอลัมน์ รูปแบบวันที่/ยอด รายการธนาคาร และ **รหัสบริษัท: Corporate ID (ลูกค้าย้ายจาก Business Net) หรือ System Reference ID** ตรวจซ้ำกับคู่มือ PromptPay import ฉบับปัจจุบัน https://www.scb.co.th/getmedia/ccc95101-9391-42ed-b954-d445a5bd1afb/transfer-importfile-promptpay.pdf (F18) ลง memory พร้อมวันที่ — ห้ามเดา
### 2.2 Logic
- `packages/contracts/src/reimbursements.ts`: `THAI_BANK_CODES` (เฉพาะที่ตรงแม่แบบ) ข้าง `THAI_BANK_NAMES` (`:2001-2008`)
- `payment-batch-file.logic.ts`: `buildScbBusinessAnywhereWorkbook` แผ่นละช่องทาง fee `OUR` แผ่นสรุปหัวไฟล์รวมรหัสบริษัท; `bank_not_supported`
- Test: `banking.logic.spec.ts`
### 2.3 UI + journey
- ตัวเลือกรูปแบบ/ช่องทางในกล่องดาวน์โหลด, ทางออก "ใช้แผ่นงานทุกธนาคาร", ข้อความขั้นต่อไปที่บอกการอัปโหลดเฉพาะรูปแบบที่ผ่าน 2.4; journey variant
### 2.4 ตรวจกับธนาคารจริง
- วางข้อมูลลงแม่แบบ SCB แล้ว "Generate Text file" ได้ (คนที่มีบัญชีกดเอง) — ไม่ผ่านห้ามปล่อย

## Phase 3 — ทางเลือก (เมื่อเจ้าของสั่ง)

- 3.1 กสิกร KCC+: ยืนยันเส้นทางดาวน์โหลด "KBank Excel Template" ตามคู่มือ enable-macro (สาธารณะหรือไม่) และรุ่นปัจจุบัน (G-2, F19) แล้วทำแบบ 2.1–2.4
- 3.2 ตัวอ่านไฟล์ผลจากธนาคาร (P23) — ต้องมีตัวอย่างไฟล์จริงก่อน (spec §12.1 M5):
  - `apps/api/src/modules/banking/infrastructure/pdf-statement-text.extractor.ts`: เพิ่มเมธอดคืนข้อความพร้อมตำแหน่ง (ก่อน `clusterPdfTextRows` ที่ `:50`) โดยไม่เปลี่ยน `extractRows`
  - `apps/api/src/modules/payment-batches/domain/bank-result.logic.ts`: ตัวแยกต่อธนาคาร (SCB Payment Status Report ก่อน) → `{ payeeName, accountLast4, amount, outcome, reason }` ไม่ใช้กติกาหัวตาราง "วันที่+ยอด" ของรายการเดินบัญชี (`banking.logic.ts:577`)
  - รูปภาพ: schema สกัดใหม่ใน AI Gateway ผ่านสัญญางบเดิม เรียกไม่สำเร็จ/หมดเวลาไม่คิดเงิน
  - use-case ใหม่ใน `payment-batches` ตรวจสิทธิ์เปิดชุด (ไม่ใช่ `bank.statement.import` `statement-import.use-case.ts:93-95`) ผลเป็นค่าตั้งต้นในหน้าบันทึกผล ผู้ใช้ยืนยันเอง
- 3.3 ร้านที่เปิดกระทบยอด: แนะนำรายการถอนที่ยอดตรงบนชุด FILE_READY (ไม่บันทึกจ่ายเอง)

## การตัดสินใจที่ล็อกแล้ว (อย่ารื้อโดยไม่บันทึก)

1. ไม่โอนเงิน ไม่เชื่อม API ธนาคาร ไม่ดึงรายการเดินบัญชี (spec §5.10)
2. Phase 1 เป็นแผ่นงานสำหรับกรอก/คัดลอก ไม่อ้างว่าอัปโหลดตรงได้; รูปแบบนำเข้าเฉพาะธนาคารทำเมื่อตรวจกับธนาคารนั้นจริง (การตัดสินใจของผลิตภัณฑ์)
3. การจ่ายทุกรายการผ่าน use-case และล็อกเดิมของใบ; การตรวจล็อกของชุดทำ **ในธุรกรรมของคำสั่ง หลังได้ล็อกต้นทาง**
4. ลำดับล็อก: advisory ชุด → advisory ต้นทาง (เรียง key) → แถวชุด → แถว item; ทางเดิมไม่ขอล็อกของชุด; hook ในธุรกรรมการจ่ายแตะเฉพาะแถว item และการปิดชุดอยู่ในธุรกรรมแยก (รองรับใบเบิกที่เป็น Serializable)
5. ดาวน์โหลดครั้งแรกตรึงเฉพาะ PENDING พร้อมยอดตรึงและ ciphertext ตรึง; ดาวน์โหลดซ้ำจากค่าตรึงเท่านั้น; ciphertext ตรึงลบเมื่อชุดจบ
6. ลายนิ้วมือข้อมูลการจ่ายแทน `version` ดิบ (แนบสลิปไม่ทำให้รายการเสีย)
7. ผลต่อแถวตัดสินใต้ล็อกต้นทาง+แถว; "สำเร็จ" ที่ชนกับ "ไม่สำเร็จ" ทำให้การจ่าย rollback; ตัววนผลลองใบเบิกใหม่ ≤3 ครั้งเมื่อ serialization failure
8. ไฟล์ผลจากธนาคารได้รั้วเดียวกับสลิป และไม่ผูกเป็นสลิปของใบใด
9. อำนาจจ่ายตรวจตรง ไม่อิงชื่อกลุ่ม reveal
10. ไม่มีสิทธิ์/เมนู/สวิตช์ใหม่ (รอ Q3 ยืนยัน); ค่าธรรมเนียม OUR; แผ่นงานทุกธนาคารไม่มีรหัสธนาคาร
11. ยกเลิก/ปิดชุด: เฉพาะรายการที่ยังไม่จ่ายออกจากชุด การจ่ายที่บันทึกแล้วคงอยู่เสมอ
12. การดาวน์โหลดไม่ใช่การ replay ไบต์; ชุดที่จบแล้วดาวน์โหลดไม่ได้
13. preflight ของ use-case และการตรวจใต้ล็อกต้องรู้จักหลักฐานของชุดทั้งคู่ (preflight อ่านอย่างเดียว ข้อตัดสินอยู่ใต้ล็อก)
14. ไฟล์หลักฐานการจ่ายทุกชนิด (สลิปใบเบิก, ไฟล์ใบเตรียมจ่าย, ไฟล์ผลชุด) ไม่เป็นใบเสร็จใบเบิก
