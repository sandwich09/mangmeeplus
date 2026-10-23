# Cash Advance and Clearing Plan

Status: READY (docs-first) — reviewed 3 rounds + focused blocker check 2026-10-24, no HIGH open; see Must close before coding (Phase 3 waits for budget Phase 0.3)
Spec: `docs/specs/cash-advance-and-clearing-spec.md`
Memory: `docs/agent-memory/cash-advance-and-budgets.md`
Baseline: main 6c54ba208 (2026-10-23)
Scope: เงินทดรองจ่ายบนเว็บและ LINE ได้แก่
- ขอ อนุมัติ จ่าย และยืนยันรับเงิน
- เคลียร์ทาง A (ใบเคลียร์) และทาง B (จ่ายบิลของร้านจากเงินทดรอง)
- คืนเงิน จ่ายส่วนเพิ่ม ย้อนการเคลียร์ และ runoff
- ถอด env flag ของร่างใบเบิกใน LINE
- แจ้งเตือน และการลงบัญชีของบริษัทที่เปิดสมุดบัญชี

หลักการ: ponytail full ใช้เครื่องใบเบิกเดิม ไม่มี permission key ใหม่ ไม่มี feature key ใหม่ และไม่เพิ่ม env flag ส่วน flag เดิมที่เส้นทางนี้ต้องใช้ ถอดออกใน Phase 5.0

## ลำดับที่บังคับ

- Phase 3 รอ budget Phase 0.3 เสร็จ (budget Phase 0 คือหมวดของใบเบิกและ B7 ยอดซ้ำ 0.3 ต้องรีวิว F2 ก่อน) เพราะใบเคลียร์ต้องใช้หมวดที่ resolve ได้ (spec §5.6) Phase 1–2 และ 4–6 ที่ไม่แตะใบเคลียร์เริ่มได้
- Phase 1 → 2 → 3 ตามลำดับ
  - Phase 4 (เว็บ) เริ่มได้หลัง Phase 2
  - Phase 5.0 (ถอด flag) ทำเมื่อใดก็ได้ และต้องเสร็จก่อน Phase 5.1
  - Phase 6 รอ Phase 2
  - Phase 7 รอ Phase 3
- หนึ่ง lane ต่อหนึ่งขั้นย่อย (ประมาณไม่เกิน 5 ไฟล์) และไม่เกิน 3 lane พร้อมกัน

## คำสั่งตรวจมาตรฐาน

```bash
pnpm --filter @watchdog-bms/contracts build
pnpm --filter @watchdog-bms/api prisma:validate
pnpm --filter @watchdog-bms/api typecheck          # script มี heap flag
cd apps/api && ../../node_modules/.bin/tsx --test <path ทีละไฟล์>   # zsh: ห้ามใช้ตัวแปรที่ไม่ split
pnpm --filter @watchdog-bms/web typecheck && pnpm --filter @watchdog-bms/web test
```

- test ฝั่ง API ใหม่ต้องอยู่ในไฟล์ที่ `apps/api/package.json` ระบุแล้วเท่านั้น ไฟล์ของชุด whole-chain เป็นแค่ส่วนเสริม
- UI ทุกขั้นต้องเปิดใน browser จริงที่ 390, 1,280 และ ~1,556 px ([thai-ux-standard.md:114](../guidelines/thai-ux-standard.md)) วัดกลุ่มปุ่ม และกด journey หลักหนึ่งรอบรวมทางผิดหนึ่งครั้ง
- บันทึกจำนวน test กับ exit code จริงลง memory

---

## Phase 1 — Schema, contracts, pure logic

### 1.1 Schema + migration + เลขเอกสาร

- `apps/api/prisma/schema.prisma`:
  - `CashAdvanceStatus`, `CashAdvanceMovementKind`, `CashAdvance`, `CashAdvanceMovement`
  - `ReimbursementRequest.cashAdvanceId`, `cashAdvanceOffsetAmount`, `cashAdvanceReversalStartedAt`, `cashAdvanceReversalStartedByUserId`, `cashAdvanceOffsetReleasedAt`
  - `ExpenseSubstituteReceiptEvidence.cashAdvanceId` (+ CHECK เฉพาะ `COMPANY`)
  - `ReimbursementDraftAction.cashAdvanceId` + FK และสร้าง CHECK `operation`, `target_kind` และ `state` ใหม่ (รอบ 2 F5 ตาม spec §6 แถวเดิมผ่านโดยไม่ต้อง backfill)
  - `ExpensePayment.cashAdvanceId`, `ReimbursementPolicy.cashAdvanceClearDays` และ back-relations
  - รอบ 3 F10: `receiptConfirmedAt/ByUserId`, `receiptDisputedAt` และ `receiptDisputeNote` อยู่บน `CashAdvanceMovement` (PAYOUT) ไม่อยู่บน `CashAdvance`
- `apps/api/prisma/migrations/20261024xxxxxx_cash_advance/migration.sql`: partial unique + CHECK ตาม spec §6
- `apps/api/src/modules/data-model-core/domain/logic/document-sequence.logic.ts` (บรรทัด 34) + `apps/api/prisma/seed.ts` (บรรทัด 3021): `cash_advance.request`
- ตรวจ: `prisma:validate`, migrate deploy กับ Postgres ในเครื่อง, `document-sequence.logic.spec.ts`

### 1.2 Contracts

- ใหม่ `packages/contracts/src/cash-advances.ts` (+ export) ประกอบด้วย DTO, `CashAdvancePolicySnapshotV1`, `CashAdvanceAction` และ phase/outcome
- `packages/contracts/src/reimbursements.ts`:
  - `cashAdvanceId` และ `cashAdvance` ใน detail/create
  - `ReimbursementPolicySnapshotV1.cashAdvance?`
  - policy `cashAdvanceClearDays`
- `packages/contracts/src/expenses.ts`: `RecordExpensePaymentInput.cashAdvanceId?`
- `packages/contracts/src/line-reimbursement-draft.ts`: `advanceChoiceId?`, choice `ADVANCE` และ operation `ADVANCE_CREATE`
- ตรวจ: contracts build และ typecheck ของ api/web

### 1.3 Domain logic + parser (F6)

- ใหม่ `apps/api/src/modules/reimbursements/domain/logic/cash-advance.logic.ts`:
  - `openAmount` (หักทาง B), `clearingOffset`, `clearingOutcome`, `clearingPhase`
  - `deriveCashAdvanceStatus`, `defaultClearByDate`, `validateReturnAmount`, `validateDirectSpend`, `allocateOffsetToLines`
  - `canVoidPayout`, `canReverseClearing`, `parseCashAdvancePolicySnapshot` (strict)
- `apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic.ts`: `claimPayableAmount` และแก้ `ALLOWED_TRANSITIONS` (B5)
- `apps/api/src/modules/reimbursements/domain/reimbursement.constants.ts` (บรรทัด 83-126): เพิ่ม `cashAdvance` ใน `POLICY_SNAPSHOT_KEYS` และตรวจ strict
- tests ใน `reimbursement.logic.spec.ts`: ทุกแถว §9 ของ spec, phase, parser (snapshot เก่าผ่าน, ใหม่ผ่าน, ผิดรูปถูกปฏิเสธ)

### 1.4 Model + mapper

- `domain/models/reimbursement.model.ts`: record types
- `application/dto/reimbursement.mapper.ts`: `toCashAdvanceDetail` (บัญชีปิดบัง, `actions[]`, `desk`, `clearing.phase`)
- ตรวจ: typecheck

---

## Phase 2 — วงจรเงินทดรองฝั่ง API

### 2.1 Repository

- ใหม่ `apps/api/src/modules/reimbursements/infrastructure/prisma-cash-advance.repository.ts`:
  - `createDraft`, `updateDraft` (CAS)
  - `submitAtomic`: เลขเอกสาร, snapshot, assignment ที่ตรึง และ payout ที่ตรึงด้วย `sealPayoutDestination`/`payoutFingerprint` ของ `payout-destination.logic.ts` (บรรทัด 39, 59)
  - `decide`, `cancel`, `reopen`
  - `recordPayout`, `confirmReceipt`, `disputeReceipt` (เขียนที่แถว PAYOUT ที่ RECORDED อยู่ ถ้า void แล้วจ่ายใหม่ แถวใหม่เริ่มที่ยังไม่ยืนยัน รอบ 3 F10)
  - `voidMovement` (guard R1/R1b และ journal reversal ใน tx ตาม Phase 7), `attachReturnSlip`, `recordReturn` (≤ open/due)
- `export async function refreshCashAdvance(tx, companyId, advanceId)`
- Serializable ทุก write และแปลง serialization failure เป็น `cash_advance_state_changed`

### 2.2 Use-cases

- ใหม่ `application/use-cases/cash-advance.use-case.ts`: List/Detail/Create/Update/Submit/Approve/Reject/Cancel/Reopen/RecordPayout/ConfirmReceipt/VoidMovement/AttachReturnSlip/RecordReturn/RevealPayout/OpenSlip
- ใช้ซ้ำ: `resolveSubmissionRoute`, `assertReimbursementBranchInScope`, `isSelfApproval`, `validateRejectionReason`, `reimbursementPaymentSlipRequired` และกลุ่มผู้เห็นจาก `reimbursement-payout-reveal.use-case.ts` และ `canOpenReimbursementPaymentSlip`
- outbox events `cash_advance.*` และ audit `cash_advance.*`

### 2.3 ไฟล์แนบระดับสลิป (F1/F7)

- ใหม่ `application/use-cases/cash-advance-slip.use-case.ts`:
  - Init/Complete แบบรู้จักเงินทดรอง PAYOUT ต้องมี `payment.record` ส่วน RETURN ทำได้โดยผู้ขอของใบหรือ `payment.record`
  - metadata `{ generatedFor: REIMBURSEMENT_PAYMENT_SLIP_UPLOAD_TAG, cashAdvanceId, slipKind }`
  - completion จับคู่ tag, cashAdvanceId และผู้อัปโหลด ใช้ `withAttachmentCreate` เดิม
- `apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-attachment.repository.ts` (บรรทัด 32-40, 104-115) และ `apps/api/src/modules/data-model-core/domain/logic/attachment.logic.ts` (บรรทัด 106-151): link ใหม่สามคู่นับเป็นไฟล์ลับ
- `apps/api/src/modules/data-model-core/application/use-cases/create-download-url.use-case.ts` (บรรทัด 88-100): ปฏิเสธสำเนาที่เซ็นของเงินทดรองด้วย
- endpoint เปิดไฟล์ใน controller ของเงินทดรอง พร้อม audit ทั้งสำเร็จและปฏิเสธ
- tests: `create-download-url.use-case.spec.ts`, `delete-attachment.use-case.spec.ts`, `prisma-attachment.repository.spec.ts`, `attachment.logic.spec.ts`, `complete-attachment-upload.use-case.spec.ts`

### 2.4 Controller + DTO + module + นโยบาย + สาขา

- ใหม่ `presentation/http/cash-advance.controller.ts` (spec §7) ใช้ `ReimbursementWriteQuiesceGuard`
- `presentation/http/reimbursement.dtos.ts`: validators
- `reimbursements.module.ts`: register
- นโยบาย: `reimbursement-policy.use-case.ts`, `reimbursement-policy.controller.ts`, `upsertPolicy`/`toPolicy` และ `reimbursement.constants.ts` (ค่าเริ่มต้น 7)
- สาขา: `application/branch-in-flight.ts` นับเงินทดรองที่ยังไม่จบ
- tests: `reimbursement-request.use-case.spec.ts`, `reimbursement-approval.use-case.spec.ts`, `reimbursement-finance.use-case.spec.ts`, `reimbursement.dtos.spec.ts`, `reimbursement-branch-scope.use-case.spec.ts`, `reimbursement-related-access.use-case.spec.ts` และ `prisma-reimbursement.repository.draft-submit-race.spec.ts` (PostgreSQL จริง: submit ซ้ำ, payout idempotency, CHECK)

### 2.5 คำอธิบาย pack + runoff (F17/F27)

- `apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts` (บรรทัด 326-363): คำอธิบายของ `self`, `approve`, `review` และ `finance` ตาม spec §8
- `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts` (บรรทัด 68-95): ชุดสิทธิ์ runoff แบบจำกัด ได้แก่ create, update_own_draft, submit และ cancel_own
- `assertFeatureEnabled('reimbursement')` ใช้เฉพาะใน use-case สร้างหรือส่งคำขอเงินทดรองใหม่ และสร้างหรือส่งใบเบิกปกติ งานอื่นของวงจรเงินทดรองห้ามตรวจ (รอบ 2 F9/P17 ตาม spec §5.9)
- tests: `feature-gate.logic.spec.ts`, `capability.logic.spec.ts`, `reimbursement-request.use-case.spec.ts` (ใบเบิกปกติยังถูกปฏิเสธ ใบเคลียร์ทำได้), `reimbursement-approval.use-case.spec.ts` และ `reimbursement-finance.use-case.spec.ts` (อนุมัติ จ่ายส่วนเพิ่ม ยืนยันรับคืน และย้อน ทำได้ในช่วง runoff)

---

## Phase 3 — การเคลียร์

### 3.1 สร้างและแก้ใบเคลียร์ (ทาง A)

- `reimbursement-request.use-case.ts` (Create/Update):
  - รับ `cashAdvanceId` ตรวจ advance `PAID` ผู้ขอ สาขา และสกุลเงิน
  - ถ้า unique violation ตอบ 409 `cash_advance_clearing_exists`
  - ถ้าผูก source แบบ `PERSONAL_ADVANCE` ให้ปฏิเสธด้วย `cash_advance_source_personal_not_allowed` (R8)
- `prisma-reimbursement.repository.ts`: create/update เขียน `cashAdvanceId`
- รอบ 3 F4: reopen (REJECTED → DRAFT) และการดึงกลับเป็นร่างของใบเคลียร์ ล้าง `cashAdvanceOffsetAmount` และยอดค้างเป็น 0 ใน tx เดียวกัน (CHECK `offset ≤ amount` จึงไม่ชนเมื่อลดยอด) และ submit คำนวณใหม่ (test ใน `reimbursement-request.use-case.spec.ts`)
- tests: `reimbursement-request.use-case.spec.ts`

### 3.2 ส่งใบเคลียร์

- `SubmitReimbursementUseCase` (`reimbursement-request.use-case.ts:592-800`):
  - อ่าน open ใน tx แล้วตรึง O และ `outstandingAmount = T − O` (แทนบรรทัด 767)
  - เพิ่ม `snapshot.cashAdvance`
  - payout gate ข้ามเมื่อยอดค้างเป็น 0
- `submitDraftAtomic`: refresh เป็น CLEARING
- tests: request spec และ PG race (RETURN และทาง B พร้อมกับ submit)

### 3.3 Projection และการปิดยอด

- `materialize-claim-expenses.service.ts`: `vendorNameSnapshot` ของใบเคลียร์
- `prisma-reimbursement.repository.ts` (projection ประมาณบรรทัด 2300-2420):
  - ยอดค้าง 0 → PAID + mirror ด้วยวิธีและวันที่ของ PAYOUT
  - มีส่วนเพิ่ม → ปัน O
  - refresh
- `reimbursement-projection-reconciler.service.ts`: ตรวจแคชของเงินทดรองที่ไม่ตรงกับ derive
- tests: `materialize-claim-expenses.service.spec.ts`, `prisma-reimbursement.repository.payment-mirror.spec.ts`, `reimbursement-projection-reconciler.service.spec.ts`

### 3.4 จ่ายส่วนเพิ่มและยกเลิกการจ่าย

- `prisma-reimbursement.repository.ts:3765-3767` และ `:4282-4286` ใช้ `claimPayableAmount` mirror และคืน mirror ตามส่วน แล้ว refresh
- void การจ่ายส่วนเพิ่มต้อง refresh เงินทดรองเป็น CLEARING (`AWAITING_TOP_UP`) ไม่ใช่ PAID (รอบ 2 F4) มี test ว่าทาง B ถูกปฏิเสธหลัง void
- tests: `reimbursement-finance.use-case.spec.ts`, `void-reimbursement-payment-reversal.use-case.spec.ts`, payment-mirror spec และยืนยันว่าใบเบิกปกติให้ผลเท่าเดิม

### 3.5 ยกเลิกใบเคลียร์ ย้อนการเคลียร์ และการเปลี่ยนสถานะอื่น (F5, รอบ 2 F2/F3/P5/P15)

- `prisma-reimbursement.repository.ts` `completeCancellationAtomic` (บรรทัด 1299): เมื่อใบมี `cashAdvanceOffsetAmount > 0` และ `cashAdvanceOffsetReleasedAt` ว่าง ให้ทำใน tx เดียวกัน
  - ย้อนบัญชี `cash_advance.offset` (Phase 7 ถ้างวดปิดให้ tx ล้มทั้งหมด)
  - ตั้ง `cashAdvanceOffsetReleasedAt`
  - refresh เงินทดรองเป็น PAID
  - ใช้กับทุกใบเคลียร์ที่อนุมัติแล้ว รวมใบที่มีส่วนเพิ่มหลัง void การจ่าย
- ใหม่ `ReverseCashAdvanceClearingUseCase` (เฉพาะใบที่หักกลบครบและเป็น PAID):
  - เงื่อนไข R10/R11
  - ใน tx เดียว: PAID → READY_FOR_PAYMENT (`paymentStatus` UNPAID, ยอดค้าง 0), คืน mirror ส่วน O, ตั้ง `cashAdvanceReversalStartedAt/ByUserId`, เริ่ม cancellation intent ด้วยเหตุผลเดียวกัน แล้ว refresh เป็น CLEARING (`CANCELLING`)
  - ห้ามย้อนบัญชีตรงนี้ เพราะย้อนที่การจบ
- `prisma-reimbursement.repository.ts` withdraw cancellation (บรรทัด 1430-1460): ถ้า `cashAdvanceReversalStartedAt` มีค่า ให้ปฏิเสธด้วย `cash_advance_reversal_not_withdrawable` (R15) การถอนแบบปกติคงกติกาเดิม
- reject/reopen/cancel-intent/withdraw ใน `reimbursement-approval.use-case.ts`, `reimbursement-request.use-case.ts` และ repository ต้อง refresh ทุกจุด ค้นทุกจุดที่เขียน `reimbursementRequest.update*` แล้วบันทึก checklist ลง memory
- tests:
  - `reimbursement-finance.use-case.spec.ts` (reverse และ R10/R11)
  - `reimbursement-approval.use-case.spec.ts`
  - `prisma-reimbursement.repository.draft-submit-race.spec.ts` (PostgreSQL จริง): R15, ยกเลิกใบมีส่วนเพิ่มแล้วปล่อย O ตอนจบเท่านั้น, ถอนการยกเลิกปกติไม่แตะ O, งวดปิดตอนจบ, ย้อนแล้วสร้างใบเคลียร์ใหม่ได้

### 3.6 ทาง B: จ่ายรายจ่ายจากเงินทดรอง (F3/F4, รอบ 2 F1/P4/F14)

- `apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts` (`RecordExpensePaymentUseCase` บรรทัด 1928) และ repository การจ่ายรายจ่าย:
  - รับ `cashAdvanceId` ตรวจตาม spec §5.7 และเขียนใน tx พร้อม refresh
  - `CancelExpensePaymentUseCase` (บรรทัด 2063 สิทธิ์ `expense.payment.record`) refresh ด้วย
  - รอบ 3 F5: `apps/api/src/modules/expenses/infrastructure/expense-void-blocker.ts` (บรรทัด 147-150)
    - การจ่ายที่มี `cashAdvanceId` และ journal POSTED ในงวด OPEN/REOPENED ไม่ได้ `ledger_posted` แต่ได้ `canCancel`
    - การยกเลิกย้อนบัญชีด้วย `reverseExpenseJournalInTx` (`prisma-expense.repository.ts:3233`) ใน tx เดียวกัน
    - งวดปิดได้ blocker `accounting_period_locked` (R11)
    - หน้ารายจ่ายแสดงปุ่มตาม capability ใหม่
    - tests: `record-expense-payment.use-case.spec.ts`, `prisma-expense.repository.payment.spec.ts` (PG)
  - รอบ 3 F12: ข้อความ R8 ชี้ไปที่การยกเลิกใบรับรองแล้วสร้างใหม่แบบเงินของร้าน (แหล่งเงินแก้ไม่ได้ `prisma-expense.repository.ts:2633-2634`)
- **ใบรับรองแบบเงินของร้าน** `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts` (การจ่ายอัตโนมัติที่บรรทัด 3081-3112):
  - เมื่อ evidence มี `cashAdvanceId` ให้ `expensePayment.create` เขียน `cashAdvanceId`
  - ก่อนสร้าง ตรวจตาม spec §5.7 ภายใต้ lock ของเงินทดรอง แล้ว `refreshCashAdvance` ใน tx เดียวกัน
  - ถ้าตรวจไม่ผ่าน ให้ปฏิเสธการออกใบ (R13) ถ้า `paidBefore > 0` ห้ามผูก (R14)
- `apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts` + DTO: รับและตรวจ `cashAdvanceId` (เฉพาะ `COMPANY`, CHECK ใน migration)
- `apps/web/src/features/expenses/SubstituteReceiptWizardPage.tsx` (บรรทัด 2022-2027): ตัวเลือก "จ่ายจากเงินทดรอง" เมื่อเลือกเงินของร้าน และคำใบ้ H2 (ต้องมี endpoint อ่านเงินทดรองที่ผูกได้ของผู้จ่าย)
- `apps/api/src/modules/banking/infrastructure/prisma-match-source.query.ts`: ตัด `cashAdvanceId IS NOT NULL`
- tests: `record-expense-payment.use-case.spec.ts`, `prisma-expense.repository.payment.spec.ts` (PG), `substitute-receipt.use-case.spec.ts`, `prisma-expense.repository.substitute-payment.spec.ts` (PG: การจ่ายอัตโนมัติผูกเงินทดรอง, R13, R14), `prisma-match-source.query.spec.ts`

---

## Phase 4 — เว็บ

### 4.1 API client + logic

- ใหม่ `apps/web/src/features/reimbursements/cash-advance.api.ts` และ `cash-advance.logic.ts` (S1–S5, P1–P3, C1–C3, R1–R12, A1/A2, H2/H3, V1)
- ใหม่ `cash-advance.logic.spec.ts` ครอบตาราง spec §10.2 ทุกเซลล์
- errorText map

### 4.2 ฟอร์มขอเงินทดรอง

- ใหม่ `apps/web/app/(workspace)/companies/[companyId]/reimbursements/advances/new/page.tsx` และ `CashAdvanceCreatePage.tsx` ใช้ `ClaimPayoutFormSection` แบบบัญชีของผู้ขอเท่านั้น
- ตรวจด้วย browser ที่ 390, 1,280 และ ~1,556 px

### 4.3 หน้า journey

- ใหม่ `advances/[advanceId]/page.tsx` และ `CashAdvanceJourneyPage.tsx`:
  - ThemedSteps แบบ `ReimbursementJourneyPage.tsx`
  - ฟอร์มจ่ายใช้ชิ้นส่วนจาก `PaymentForm` (`ReimbursementDetailSections.tsx:410`)
  - ปุ่มยืนยัน/โต้แย้งรับเงิน, ยืนยันรับคืน, ย้อนการเคลียร์ และเปิดสลิปผ่าน endpoint ใหม่

### 4.4 Hub + ใบเคลียร์ + นโยบาย + รายจ่าย

- `ReimbursementsPages.tsx`: เมนู, แท็บ, ป้าย และ `PolicySettings` (วันเคลียร์)
- `ReimbursementCreatePage.tsx`: `?advanceId=` (หัวการ์ด, C1–C3 สด, H3, วิธีรับเงินเฉพาะเมื่อมีส่วนเพิ่ม)
- `ReimbursementDetailSections.tsx`: บล็อกหักเงินทดรอง
- `apps/web/src/features/expenses/` (ฟอร์มบันทึกจ่ายรายจ่าย): วิธีจ่าย "จ่ายจากเงินทดรอง"
- tests: `ReimbursementsPages.rendered.spec.ts`, `ReimbursementCreatePage.qa.spec.ts`, `ReimbursementPages.plain-thai.qa.spec.ts` และ spec ของหน้ารายจ่ายที่แตะ

### 4.5 ใบพิมพ์ + คู่มือ

- `apps/api/src/modules/reimbursements/domain/logic/claim-form.logic.ts`: ใบขอเงินทดรองและบล็อกหักกลบ (`claim-form.logic.spec.ts`)
- `apps/web/src/features/user-guide/reimbursement-guide.content.ts`: หัวข้อเงินทดรองและทาง B

---

## Phase 5 — LINE + AI

### 5.0 ถอด `LINE_AI_REIMBURSEMENT_DRAFT_WRITE_ENABLED` (F18/F25, B9)

- ถือว่าเปิดเสมอ ลบการอ่าน flag ทุกจุด:
  - `packages/config/src/index.ts:34` (+ `index.test.ts:1701`) และ `apps/api/src/common/config/app-config.service.ts:153`
  - `packages/contracts/src/ai-tools.ts:37-42` (ทะเบียนไม่รับ `reimbursementDraftWriteEnabled` อีก)
  - `apps/api/src/modules/line-ai/presentation/http/internal-tools.controller.ts:670-672`
  - `apps/api/src/modules/reimbursements/application/use-cases/line-reimbursement-draft.use-case.ts:332, 534`
  - `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:495, 2544, 7713, 7803, 9663, 11276`
  - `apps/api/src/modules/line-ai/line-ai-capability-manifest.ts:65, 139, 435, 449`
  - ข้อความ `feature_disabled` ใน `line-reimbursement-draft-card.logic.ts:157`
  - gateway: `apps/ai-gateway/src/modules/line-ai/agents/semantic-turn-v2.ts:624, 712, 714, 745, 790` (`reimbursementDraftEnabled`) และจุดที่ API ส่งค่านี้ไปให้
- ก่อน deploy ตรวจ env ของ UAT/Production ว่าไม่มีใครตั้ง false แล้วบันทึกใน runbook
- tests: `internal-tools.controller.spec.ts` และ `process-line-webhook.use-case.spec.ts` (ร่างใบเบิกทำงานโดยไม่มี flag) ส่วนเสริมคือ `line-ai-capability-manifest.spec.ts`

### 5.1 Tool contracts

- `packages/contracts/src/ai-tools.ts`:
  - `reimbursement.advance.preview_create` (`draft_create`) เพิ่มใน `LINE_REIMBURSEMENT_DRAFT_TOOL_NAMES` และ `reimbursement.advance.list_open` (read)
  - `expense.action.preview` เพิ่ม ADVANCE_* 7 ตัว และ `advanceId`
  - แก้ B3 (บรรทัด 1289) และการ์ดความสามารถ

### 5.2 API ฝั่ง LINE (F10/F19)

- `internal-tools.controller.ts`: inject tool ใหม่และ `toolMap.set` (แบบบรรทัด 271-281) แล้วยืนยันว่า category admission ผ่าน
- ใหม่ `apps/api/src/modules/line-ai/infrastructure/reimbursement-advance-tools.ts` + `line-ai.module.ts`
- `line-reimbursement-draft-adapter.service.ts` + `line-reimbursement-draft.service.ts` + `reimbursements/application/use-cases/line-reimbursement-draft.use-case.ts`: operation `ADVANCE_CREATE` (preview และ ACTION ref) และการยืนยันผ่าน postback เดิมที่เรียก create + submit แล้วตั้ง APPLIED + `cashAdvanceId` ใน tx เดียว (constraint จาก 1.1) replay ได้ผลเดิม
- รอบ 2 F6/P10: helper `isLineDraftActionTool(name)` ใน `packages/contracts/src/ai-tools.ts` แทน prefix `reimbursement.draft.` ใน
  - `line-read-evidence.service.ts:437` และ `process-line-webhook.use-case.ts:8855`
  - `line-ai-capability-manifest.ts` (`operationRelease`)
  - gateway `semantic-turn-v2.ts:712-714` และ `reimbursement-draft-input.ts:86`
- `erp-reimbursement-tools.use-case.ts`: `list_open`
- `apps/api/src/modules/line-ai/application/line-read-evidence.service.ts` (บรรทัด 58-65): `READ_MEMORY_TOOLS` + `READ_MEMORY_ANSWER_SHAPE` + การสกัด shownItems
- `line-expense-action.service.ts`: ADVANCE_* (สลิปจากแชตแบบ REIMBURSEMENT_RECORD_PAYMENT), `canAct`, REFUSAL ไทย และ action target validation ว่า `advanceId` มาจาก shownItems
- **รอบ 3 F1 (blocker)** `apps/ai-gateway/src/modules/line-ai/agents/semantic-turn-v2.ts`:
  - บรรทัด 393-399: กิ่ง `ADVANCE_*` ใช้ `advanceId` และ freshIds จากผล `reimbursement.advance.list_open` (items[].id) และ recentReads
  - บรรทัด 728 และ 965: เพิ่ม `reimbursement.advance.list_open` ใน allowlist ของรอบวางแผนถัดไปและรายการต่อเนื่อง
  - tests: gateway `line-ai-turn.use-case.spec.ts` (gateway ระบุแล้ว) ครอบ lookup → preview, การอ้างใบจากรอบก่อน และ id ปลอม ส่วนเสริมคือ semantic-turn spec ในชุด whole-chain
- tests: `internal-tools.controller.spec.ts`, `erp-reimbursement-tools.use-case.spec.ts` (`readMemoryEvidence`), `reimbursement-approval.use-case.spec.ts`, `process-line-webhook.use-case.spec.ts`

### 5.3 เคลียร์ด้วยรูปใน LINE

- adapter: choice `ADVANCE` และ `advanceChoiceId` → `cashAdvanceId`
- การ์ด: `line-reimbursement-draft-card.logic.ts` (C1–C3)
- tests หลักใน `process-line-webhook.use-case.spec.ts` และ `reimbursement-request.use-case.spec.ts` ส่วนเสริมคือ `line-reimbursement-draft-card.logic.spec.ts` และ `line-reimbursement-draft-adapter.pg.spec.ts`

### 5.4 ปุ่มในแจ้งเตือน (F26)

- `apps/api/src/modules/line-ai/domain/logic/line-reimbursement-approval-control.logic.ts`: token `line-cash-advance-open-v1` มี `exp` อยู่ใน HMAC และ verify ตรวจ exp ส่วนของใบเบิกเดิมไม่เปลี่ยน (B8 บันทึกไว้)
- `notification.use-cases.ts` (บรรทัด 551, 656): แนบปุ่มเมื่อ `workflow.cash_advance_pending_approval`
- `waiting-notification.ts`: map trigger
- tests: `process-line-webhook.use-case.spec.ts` (หมดอายุแล้วได้ X1)

### 5.5 Gateway, help, W00, whole-chain

- `apps/ai-gateway`:
  - router รู้จัก tool ใหม่
  - `erp-tool.client.ts` (บรรทัด 121-125) ใช้รายชื่อเดิมซึ่งตอนนี้รวม tool ใหม่ (test ใน `erp-tool.client.spec.ts` ซึ่ง gateway ระบุไว้แล้ว)
  - `approved-product-help.ts` การ์ดใหม่ + version + contentHash
- `line-ai-capability-manifest.ts`: regenerate (`UPDATE_LINE_AI_CAPABILITY_MANIFEST=1`)
- `scripts/line-ai-whole-chain-acceptance.catalog.mjs`: scenario `cash-advance-request-and-photo-clearing`
- ตรวจ: `node scripts/run-line-ai-whole-chain-acceptance.mjs` ก่อน push

---

## Phase 6 — แจ้งเตือน (F8/F9)

- 6.1 `apps/api/src/modules/workflow/domain/workflow-template-catalog.ts`:
  - แม่แบบ EVENT 7 ตัว + SLA_SCAN 1 ตัว (autoEnable, cooldown 0)
  - รอบ 3 F8: ตัดผู้ทำ (`excludeRecipientPayloadKeys: ['actorUserId']`) แยกตามเหตุการณ์
    - `cash_advance_ready_for_payout` **ไม่ตัด** ตามแม่แบบพร้อมจ่ายของใบเบิก (`workflow-template-catalog.ts:526-536`) ผู้อนุมัติที่จ่ายได้และเจ้าของคนเดียวจึงได้งานจ่าย
    - ตัวอื่นตัดผู้ทำ
  - `WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG` และ `WORKFLOW_TEMPLATE_DEFAULT_COOLDOWN_SECONDS`
- 6.2b (รอบ 2 F10, รอบ 3 F9/F10) `apps/api/src/modules/dashboard-notifications/infrastructure/document-notification-state.ts`: รายการ `cash_advance` ใน `DOCUMENT_NOTIFICATION_STATES` (บรรทัด 16-38) ตาม spec §10.4 โดย `return_slip_submitted` เปิดทั้ง PAID และ SETTLING และ `paid_requester`/`receipt_disputed` อ่านจาก PAYOUT ที่ RECORDED อยู่ ให้ `completedDocumentNotificationIds` โหลด `cashAdvance` และ `finishDocumentWaitingNotifications` (บรรทัด 115) รับ `cash_advance` แล้วเรียกหลังทุก transition ใน `cash-advance.use-case.ts` และหลังยกเลิกหรือย้อนใบเคลียร์ test ใน `dashboard-notification-correctness.spec.ts` (PG)
- 6.2 `apps/api/src/modules/dashboard-notifications/domain/models/notification.model.ts`: trigger ใหม่ทุกตัวใน `IMPLEMENTED_TRIGGER_KEYS` (134), `ALWAYS_DELIVERED_TRIGGER_KEYS` (205) และ `NOTIFICATION_TRIGGER_FEATURE_KEYS` (250) = `['reimbursement']`
- 6.3 `apps/api/src/modules/workflow/infrastructure/prisma-workflow.repository.ts` (บรรทัด 172-182): `findSourceBranchId` รู้จัก `cash_advance`
- 6.4 `workflow-scan-candidates.use-case.ts`: `cash_advance_clearing_due` (spec §10.4) พร้อม payload `notificationPeriodKey = clearing_due:{advanceId}:{reminderNo}` ที่คงเดิมเมื่อ retry (รอบ 3 F11 ตาม `workflow-action-runner.use-case.ts:64-70`) และ `workflow-action-runner.use-case.ts`: ลำดับผู้ถึงคิวจ่าย
- 6.5 รัน `apps/api/prisma/sync-workflow-templates.ts` ใน release
- tests: `notification.logic.spec.ts`, `workflow-action-runner.use-case.spec.ts` (สาขา), `workflow-scan.use-case.spec.ts`, `workflow-template.use-case.spec.ts`, `workflow-template-auto-enable.spec.ts`, `process-due-deliveries.use-case.spec.ts` (ไม่ถูก suppress เพราะ preference เก่า)

## Phase 7 — ลงบัญชี (เฉพาะบริษัทที่เปิดสมุดบัญชี) (F15/F16)

- 7.1 `apps/api/src/modules/ledger/domain/logic/posting-engine.logic.ts`:
  - `CASH_ADVANCE = '1152-00'`
  - case `cash_advance.payout`, `.return`, `.offset` และ `expense.payment` ที่มี `cashAdvanceId` ซึ่ง Dr AP / Cr 1152-00 ด้วยยอดที่จ่าย แทนเงินสด/ธนาคาร และไม่ลง WHT ซ้ำ เพราะ WHT ลงตอนตั้งรายจ่ายแล้วที่บรรทัด 183 (รอบ 2 F8)
  - B4
- 7.2 `journal.use-case.ts` + `expense-auto-post.use-case.ts`: source ใหม่ และบริษัท template ที่ไม่มี rule ให้ fail closed `posting_rule_missing`
- 7.3 true reversal ใน tx ของ void movement, void ทาง B และย้อนการเคลียร์ ตามแบบ `reversePaymentJournalInTx` (`prisma-reimbursement.repository.ts:4145-4170`) ให้ idempotent ด้วย REVERSAL row และถ้างวดปิดให้ปฏิเสธด้วย R11
- 7.4 `apps/api/src/modules/ledger/application/use-cases/period.use-case.ts` (บรรทัด 132-170): นับรายการค้างลงบัญชีของ movement และ offset
- 7.5 tests: `reimbursement-payment-posting.use-case.spec.ts`, `reimbursement-expense-posting.logic.spec.ts`, `expense-payment-posting.use-case.spec.ts`, `template-company-posting.use-case.spec.ts`, `period-reimbursement-close.use-case.spec.ts`
- ให้นักบัญชีทบทวนตาราง Dr/Cr ก่อนรวมงาน

## Phase 8 — Seed, journey, เอกสาร

- `apps/api/prisma/seed-plain-shop.ts`: ตัวอย่างสามสถานะ และหนึ่งรายการทาง B
- ใหม่ `e2e/journeys/cash-advance-paid-then-cleared.journey.spec.ts` (`journey-kit.ts` บน proof stack ที่ล้างได้) ที่ 390, 1,280 และ ~1,556 px
- `docs/specs/reimbursement-approval-spec.md` §22, `docs/plans/master-implementation-checklist.md` และ memory

## การตัดสินใจที่ล็อกแล้ว

1. เงินทดรองเป็นตารางของตัวเอง ทาง A ใบเคลียร์เป็นใบเบิกจริง ทาง B ใช้การจ่ายรายจ่ายของร้านที่ชี้เงินทดรอง ไม่มีรายจ่ายซ้ำ
2. การอนุมัติและบัญชีรับเงินอยู่ในแถวเงินทดรอง แบบ DisbursementVoucher
3. ตรึง O ตอนส่งใบเคลียร์ และระหว่าง CLEARING ห้ามคืน ห้ามจ่ายทาง B และห้าม void PAYOUT
4. ใบเคลียร์ยอด 0 จบเป็น PAID O ถูกปล่อยและย้อนบัญชีเฉพาะตอนการยกเลิกใบเคลียร์จบ (ทุกแบบ) "ย้อนการเคลียร์" ใช้กับใบที่หักกลบครบเท่านั้น และถอนไม่ได้ (รอบ 2)
5. สถานะ derive แล้ว refresh ใน tx ทุกจุด และมี reconciler
6. สลิปเงินทดรองใช้ tag เดียวกับสลิปใบเบิก และ link ใหม่ถูกนับเป็นไฟล์ลับทุกชั้น อัปโหลดแบบรู้จักเงินทดรอง
7. ยืนยันรับเงินในระบบแทนลายเซ็นภาพ ส่วนกระดาษเป็นทางเลือก
8. ไม่มี permission key ใหม่และไม่มี feature key ใหม่ ถอด env flag ของร่างใบเบิกใน LINE ในงานนี้
9. runoff ใช้สิทธิ์ที่เก็บไว้แบบจำกัด และตรวจ entitlement เฉพาะการสร้างหรือส่งงานใหม่
10. ใบรับรองแบบเงินของร้านผูกเงินทดรองที่การจ่ายอัตโนมัติตอนออกใบ ไม่ใช่จ่ายซ้ำทีหลัง (รอบ 2)
11. ทาง B ลงบัญชี Dr AP / Cr 1152-00 ด้วยยอดที่จ่าย ไม่ลง WHT ซ้ำ
12. `ReimbursementDraftAction` ขยายด้วย migration constraint ไม่สร้างตารางใหม่ และใช้ helper `isLineDraftActionTool` แทน prefix ทุกจุด

## Must close before coding

### Blockers หลังการตรวจ blocker แบบเจาะจง (2026-10-24)

รีวิวเต็มครบสามรอบ และตรวจ blocker แบบเจาะจงแล้ว ผลของ spec และ plan นี้คือไม่มี HIGH เปิดค้าง แต่ Phase 3 (การเคลียร์) รอ budget Phase 0.3 ซึ่ง F2 ต้องรีวิวก่อน (ดู budget plan "Must close before coding")

| # | สถานะ | เกี่ยวกับ spec นี้อย่างไร | Gate ก่อนเริ่ม |
|---|---|---|---|
| F1 | **ปิดแล้ว** (ตรวจ blocker 2026-10-24) | gateway รู้จัก `ADVANCE_*` และ `advanceId` (§7) | test ใน gateway `line-ai-turn.use-case.spec.ts` ต้องผ่านตอน implement |
| F2 | ออกแบบแล้ว ต้องรีวิวก่อน budget Phase 0.3 (ฝั่งงบ) | ใบเคลียร์ที่ผูกใบรับรองที่หมวดไม่ชัดใช้เอกสารแก้ไขแบบแก้หมวดที่พักค่าไว้และเขียนตอนออกใบ | **cash Phase 3 ทั้งหมดรอ budget Phase 0.3** |
| F3 | **ปิดแล้ว** (ตรวจซ้ำ 2026-10-24) | ยอดของใบเคลียร์ในงบต้องไม่นับซ้ำ | budget Phase 0.5/2.2 ผ่านการตรวจ ก่อนเริ่ม cash Phase 3.3 |
| F4 | **ปิดแล้ว** (ตรวจซ้ำ 2026-10-24) | รายจ่ายจากใบเคลียร์ที่ผูกต้นทางแบบมีแค่ hint ต้องได้หมวด | budget Phase 0.2 ผ่านการตรวจ ก่อนเริ่ม cash Phase 3.3 |

