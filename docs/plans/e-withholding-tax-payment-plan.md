# e-Withholding Tax Payment Plan — จ่ายผ่าน e-WHT (ธนาคารนำส่ง อัตรา 1%)

Status: READY (docs-first) — reviewed 4 rounds + focused blocker checks 2026-10-24, no HIGH open; see Must close before coding (owner Q1–Q4 answered 2026-11-04; engineering gates remain) · **2026-10-26: steps 1.7 and 3.6 added for the owner's shop setting (spec §5.5); focused Codex review F1–F6 (MEDIUM) applied, not re-reviewed**; Re-anchored to develop e7c422802 on 2026-11-04 (citations only; controller checked 2026-11-04); owner answers recorded 2026-11-04
Owner: Expenses + Tax lane
Related: `docs/specs/e-withholding-tax-payment-spec.md`, `docs/agent-memory/e-withholding-tax-payment.md`, `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md` (ข้อ 7)
Baseline: develop `e7c4228026eec3c696fa76986420d2c97cb26676`, tree `1034bf4789c15b460ff2e293be912142f62954c9`, citations rechecked in this worktree 2026-11-04; original review/research dates remain historical

Free path (R1–R21): these e-WHT requirements apply to paid-package workflows only; a free source-drafts shop has no WHT/remittance choice and cannot confirm, under `apps/api/src/modules/expenses/application/expense-commercial-access.ts:22–25` and its confirmation call at `apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts:1361`; preserve the existing free route/permission allowlists (`apps/api/src/modules/system-partner-management/application/free-expense-access.ts:58–83`), source facts and three-read allowance without opening a tax workflow.
หลักการ: ponytail full — ใช้สถานะ `EXCLUDED` ที่มีอยู่แทนคอลัมน์ใหม่ใน `TaxEvent`, ฟังก์ชันบังคับวิธีจ่ายฟังก์ชันเดียวเรียกจากทุกทางที่สร้าง/พรีวิวการจ่าย, endpoint ใหม่หนึ่งตัว (ไฟล์ e-WHT อ่านอย่างเดียว), ไม่มีสิทธิ์/feature key/สวิตช์ใหม่, ไม่มี dependency ใหม่, ทุกประโยคอยู่ใน `E_WHT_WORDS` ที่เดียว

## ลำดับและการพึ่งพา

```
Phase 0 (Q1–Q4 answered 2026-11-04; MC1 CLOSED)
1.1 ─▶ 1.2 ─▶ 1.3 ─▶ { 1.4, 1.5, 1.6, 1.7 }  (API + contracts)
1.1 ─▶ 2.1 ─▶ 2.2 ─▶ { 2.3, 2.4 } ; 1.1 ─▶ 2.5
{1.x, 2.x} ─▶ 3.1..3.4, 3.6 ─▶ 3.5          (เว็บ + browser)
{1.x, 2.x} ─▶ 4.1, 4.2, 4.3 ; MC2 ─▶ 4.4 ─▶ 4.5   (LINE/AI/คู่มือ)
ทั้งหมด ─▶ Phase 5
```

รอบละไม่เกิน ~5 ข้อ, ไม่เกิน 3 lane พร้อมกัน; ทุก lane ใน worktree ของตัวเอง, ห้าม `pkill` แบบ pattern, ห้าม `git stash`, stage เฉพาะไฟล์ที่แก้; เทสต์หนักใช้ล็อก `mkdir /tmp/mangmee-heavy.lock` แล้ว `rmdir` ในคำสั่งเดียว

คำสั่งตรวจที่ใช้ซ้ำ (เขียน path ทีละไฟล์ — zsh ไม่แตกตัวแปร):
- `pnpm --filter @watchdog-bms/contracts build`
- `pnpm --filter @watchdog-bms/api typecheck` (heap flag อยู่ในสคริปต์ — ห้าม `tsc` เปล่า)
- `cd apps/api && ../../node_modules/.bin/tsx --test <spec files>`
- `pnpm --filter @watchdog-bms/web typecheck` และ `cd apps/web && ../../node_modules/.bin/tsx --test <spec files>`
- PG specs: `DATABASE_URL=postgresql://…@localhost:15432/<db ที่อนุญาต>` ตาม `local-dev-server-recipe`

---

## Phase 0 — คำตอบเจ้าของ (answered 2026-11-04)

- **Q1 — answered 2026-11-04:** ทุกแพ็ก; คงเงื่อนไขเปิดใช้ที่ตั้งค่าร้านตามสเปก §5.5
- **Q2 — answered 2026-11-04:** ไม่ออกกระดาษ 50 ทวิ สำหรับรายการ e-WHT; ขั้น 1.3 ไม่รอคำตอบเจ้าของแล้ว
- **Q3 — answered 2026-11-04:** รอบ 1 ตั้งต้นเป็น "ร้านยื่นแบบเอง" ทุกครั้ง
- **Q4 — answered 2026-11-04:** อนุมัติ L-7/L-8/H-1/H-2 ตามที่เขียน; ขั้น 4.4 ไม่รอคำตอบเจ้าของแล้ว
- MC1 ปิดแล้วตามสเปก §18; ประตูเดิมจาก review รอบ 4 F9 ปรับตามคำตอบข้างต้น โดยไม่เปลี่ยนแบบ: BL1/BL2/BL3 ปิดแล้วจาก focused checks 2026-10-24; ประตูที่ยังเหลือคือ MC2 (3.1/4.4) และ MC3 (1.2) ไม่ใช่คำตอบเจ้าของ

## Phase 1 — ข้อมูล กติกา และการบันทึก (API + contracts)

### 1.1 Schema + สัญญา
- `apps/api/prisma/schema.prisma`: `enum WhtRemittance { PAYER_FILES E_WHT }`; `ExpenseRecord.whtRemittance WhtRemittance?`
- migration ใหม่ `apps/api/prisma/migrations/2026102412xxxx_expense_wht_remittance/migration.sql` (สองคำสั่ง ไม่ backfill)
- `packages/contracts/src/tax.ts`: `WHT_REMITTANCES`, `WhtRemittance`; `packages/contracts/src/prisma-enum-parity.spec.ts` เพิ่มแถว
- `packages/contracts/src/expenses.ts`: `ExpenseDetail.whtRemittance` (:1070), `CreateExpenseDraftInput.whtRemittance?` (:1152), `UpdateExpenseDraftInput` (:1200)
- ตรวจ: `pnpm --filter @watchdog-bms/api prisma:validate`; contracts build; `cd packages/contracts && ../../node_modules/.bin/tsx --test src/prisma-enum-parity.spec.ts`; `prisma migrate deploy` บน Postgres เครื่อง

### 1.2 กติกา e-WHT + ถ้อยคำที่เดียว
- `packages/contracts/src/tax.ts`: `E_WHT_REDUCED_RATE`, `eWhtRateKind`, `eWhtReducedRateOn`, `eWhtPaymentMethodAllowed` (false เฉพาะ CASH/CARD)
- `E_WHT_WORDS`: ทุกประโยค W-*/N-1/L-*/H-* ของสเปก §10.1
- `apps/api/src/modules/tax/domain/logic/tax-period.logic.ts`: `makeReviewIssue('WHT_RATE_MISMATCH')` ไทยตาม W-T4 severity WARNING; `PND3_FILING_REVIEW_MESSAGES.bank_remitted_only` = W-T3 (รับชื่อแบบ/สาขา)
- เทสต์ `apps/api/src/modules/tax/domain/logic/tax-period.logic.spec.ts`: ทุกรหัส §5.2, ขอบวันที่หกจุด, `eWhtPaymentMethodAllowed`, ข้อความไม่มีอังกฤษ
- ตรวจ: contracts build; spec; api typecheck

### 1.3 Persistence ครบชั้น + ยืนยันโดยไม่สร้าง 50 ทวิ (F3)
- `apps/api/src/modules/expenses/domain/models/expense.model.ts`: `ExpenseRecord.whtRemittance` + input types ของ repository (create/update)
- `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts`: `createExpense` data, `updateExpense` whitelist (:1914-1915 — เพิ่ม `'whtRemittance'`), `mapExpense` (:252); สองจุดยืนยัน `confirmExpenseCas` (:3616) และ `finalizeAndConfirmExpenseCas` (:3798) เรียก `createWhtHandoffForExpense` เฉพาะเมื่อไม่ใช่ `E_WHT`
- `apps/api/src/modules/expenses/domain/logic/expense-status.logic.ts`: `normalizeWhtRemittance(value, whtAmount)` → `null` เมื่อ 0; ค่าผิด → `expense_wht_remittance_invalid`
- `apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts`: create (:120) และ update (ใกล้ :1060) ส่งค่าหลัง normalize
- เทสต์: `src/modules/expenses/domain/logic/expense-status.logic.spec.ts`; PG `src/modules/expenses/infrastructure/prisma-expense.repository.atomic-confirm.spec.ts` (บันทึก/อ่านคืนผ่าน create+update+map; E_WHT ไม่มี handoff; ร้านยื่นเอง `REQUIRED`)
- ตรวจ: api typecheck; สอง spec

### 1.4 ห้ามเงินสด/บัตรทุกทางจ่าย (F1, F21)
- `prisma-expense.repository.ts`: `export function assertEWhtPaymentMethod(expense, method)` ข้าง `assertExpensePaymentSource` (:547) → 409 `expense_ewht_payment_method`; เรียกใน `recordPaymentInTransaction` (:681 ก่อน create) — ครอบใบเตรียมจ่าย (`disbursement-voucher.use-case.ts:764`)
- `expense-draft.use-case.ts`: `RecordExpensePaymentUseCase.previewLineAction` (:2041-2051)
- `apps/api/src/modules/expenses/application/use-cases/disbursement-voucher.use-case.ts`: พรีวิว pay ใช้ `payment.paymentMethod ?? voucher.plannedMethod` ตรวจทุก source (:149-153); สร้าง/แก้/ส่งร่างที่ `plannedMethod` เป็น CASH/CARD และมีรายการ `E_WHT` → 409 `disbursement_ewht_planned_method` (:57, :111, :184)
- ช่องทางต้องมาถึงตัวตรวจ (review รอบ 2 F4/P21): `readDisbursementExpenseSources` (`prisma-expense.repository.ts:1310-1319`) เพิ่ม `whtRemittance: true` ใน `select`; `payableExpenses` (`apps/api/src/modules/expenses/application/use-cases/disbursement-voucher-read.use-case.ts:83-92`) ส่ง `whtRemittance`; `packages/contracts/src/disbursement-vouchers.ts` `DisbursementPayableExpense.whtRemittance` (:226)
- เทสต์: `src/modules/expenses/application/use-cases/record-expense-payment.use-case.spec.ts`; PG `src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts` (จ่ายใบด้วยเงินสด ⇒ ปฏิเสธ ไม่มีรายการจ่ายใหม่); `src/modules/line-ai/application/use-cases/erp-tax-tools.use-case.spec.ts` (พรีวิว VOUCHER_PAY plannedMethod CASH ⇒ 409 ก่อนการ์ด)
- ตรวจ: api typecheck; สาม spec

### 1.5 ห้ามเปลี่ยนเป็น e-WHT เมื่อมีการจ่ายเงินสด/บัตร + ใบรับรองแทนใบเสร็จ (F1)
- `expense-draft.use-case.ts` (`UpdateExpenseDraftUseCase`): ค่าที่จะบันทึกเป็น `E_WHT` และมี `ExpensePayment` `RECORDED` CASH/CARD → 409 `expense_ewht_cash_payment_exists`
- `prisma-expense.repository.ts`: ตรวจซ้ำในธุรกรรมยืนยันข้าง `assertExpensePaidWithinPayable` (:3601 ใน `confirmExpenseCas`, :3726 ใน `finalizeAndConfirmExpenseCas`)
- `apps/api/src/modules/expenses/domain/logic/substitute-funding.logic.ts:19` `assertSubstitutePaymentDetails` (import ที่ `substitute-receipt.use-case.ts:36` — review รอบ 2 F10; รับ `whtRemittance` ของรายจ่ายเพิ่ม): รายจ่าย `E_WHT` และใบจะสร้างรายการจ่าย (`fundingSource='COMPANY'`) วิธีจ่าย CASH/CARD → 409 `substitute_receipt_ewht_payment_method` — ครอบ `substitute-receipt.use-case.ts:382`, :806 และ `issueSubstituteEvidence` (repository :2957-3098)
- เทสต์: PG `prisma-expense.repository.atomic-confirm.spec.ts` (เปิดแก้รายจ่ายที่จ่ายเงินสดแล้วเลือก E_WHT ⇒ 409 ทั้งบันทึกและยืนยัน); `src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts`; PG `src/modules/expenses/infrastructure/prisma-expense.repository.substitute-payment.spec.ts` (ออกใบด้วยเงินสด ⇒ ไม่มีรายการจ่าย)
- ตรวจ: api typecheck; สาม spec

### 1.6 คอลัมน์ไฟล์ส่งออก + ข้อความแจ้งเตือน (F25, F17, F10)
- `packages/contracts/src/expenses.ts`: `wht_remittance` **ท้ายสุด** ของ `ACCOUNTANT_INDEX_COLUMNS` (หลัง `bundle_file_names`) และของ `ACCOUNTANT_INDEX_SUMMARY_COLUMNS` (หลัง `notes`), label W-X1
- `apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts` (:152, :188): ค่า W-X2
- `expense-draft.use-case.ts:2104`: ท้ายข้อความเปิดแก้ = N-1
- `apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts:25` `AccountantIndexSource.whtRemittance`; ผู้เรียก `apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts:165-207` ส่งค่าจากแถว และ query ของหน้านั้น select ฟิลด์นี้ (review รอบ 2 F5)
- เทสต์: `src/modules/expenses/domain/logic/expense-export.logic.spec.ts` (ค่าสี่กรณี, คอลัมน์สุดท้าย, ตำแหน่งเดิม, ผ่านผู้เรียกจริงได้ "ธนาคารนำส่ง (e-WHT)" ไม่ใช่ "ไม่ได้ระบุ"); `record-expense-payment.use-case.spec.ts` (assertion :259-264 เป็น N-1); PG `atomic-confirm.spec.ts` (ออกใบแล้ว → เปิดแก้ → E_WHT → ยืนยัน ⇒ ไม่มี `REQUIRED`; e-WHT จ่ายบางส่วน 5,000 → ร้านยื่นเอง 2% ⇒ ยืนยันได้; จ่ายครบ 10,600 → 2% ⇒ `expense_paid_exceeds_payable`)
- ตรวจ: contracts build; api typecheck; specs

### 1.7 การตั้งค่า e-WHT ของร้าน + ตัวบังคับฝั่งเซิร์ฟเวอร์ (สเปก §5.5, §7.6)
- `apps/api/prisma/schema.prisma`: `CompanyTaxProfile.eWhtUsed Boolean @default(false)`; เพิ่มคำสั่ง `ALTER TABLE "CompanyTaxProfile" ADD COLUMN "eWhtUsed" BOOLEAN NOT NULL DEFAULT false;` ใน migration เดียวกับ 1.1
- `packages/contracts/src/expenses.ts`: `ExpenseEWhtSetting`, `UpdateExpenseEWhtSettingInput`; error `expense_e_wht_not_enabled`
- ใหม่ `apps/api/src/modules/expenses/application/use-cases/expense-e-wht-setting.use-case.ts` (get/update แบบ `substitute-receipt-policy.use-case.ts`; upsert ตาม `companyId`; audit `company.e_wht_setting.updated` เฉพาะเมื่อค่าเปลี่ยน); ลงทะเบียนใน module และ `ExpenseSettingsController` (`expense.controller.ts:788`) — `GET`/`PATCH expense-settings/e-wht` ตาม guard ในสเปก §7.6; body เป็นคลาส `UpdateExpenseEWhtSettingDto` (`@IsBoolean()`) ใน `expense.dtos.ts` ไม่ใช่ interface (F6)
- `apps/api/src/modules/expenses/domain/logic/expense-status.logic.ts`: `eWhtRemittanceAllowed({ requested, stored, shopUsesEWht })`; เรียกใน create (`expense-draft.use-case.ts:120`) และ update (ใกล้ `expense-draft.use-case.ts:1060`) ของ `expense-draft.use-case.ts` ก่อนเขียน — อ่าน `eWhtUsed` เฉพาะเมื่อคำขอเป็น `E_WHT`; create ที่มี `draftIdempotencyKey` ซึ่งมีแถวเดิมแล้ว ให้ repository replay ตามเดิม (`prisma-expense.repository.ts:904-915`) ไม่ตรวจการตั้งค่า (F5)
- เทสต์: `src/modules/expenses/domain/logic/expense-status.logic.spec.ts`, `src/modules/expenses/application/use-cases/expense-draft-amount-validation.use-case.spec.ts` (รวม replay — F5), `src/modules/expenses/application/use-cases/substitute-receipt-policy.use-case.spec.ts` (describe "e-WHT setting"), `src/modules/expenses/presentation/http/expense.dtos.spec.ts` (DTO — F6), `src/common/pipes/body-validation-coverage.spec.ts` — ทั้งหมดอยู่ใน `apps/api/package.json` แล้ว
- ตรวจ: contracts build; api typecheck; ห้า spec

## Phase 2 — ภาษี

### 2.1 ต้นทาง + repository รู้จัก `EXCLUDED` (F5, F7, F8)
- `apps/api/src/modules/tax/domain/ports/source-reader.port.ts` + `apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.ts` (:98-133): ส่ง `whtRemittance`
- `apps/api/src/modules/tax/infrastructure/repositories/prisma-tax.repository.ts`: `findActiveEventBySourceComponent` (:200-205) รวม `EXCLUDED`; `upsertEvent` guard (:226-233) — `EXCLUDED` ตรวจแค่การจ่ายยัง `RECORDED`+`paidAtConfirmed` และไม่มีแถวแบบ FILED ครอบ (ไม่ใช้ล็อกเดือนแบบเก่า); `retireObsoleteExpenseWithholding` (:367-380) supersede `EXCLUDED` โดยไม่ตรวจล็อก + resolve `WHT_RATE_MISMATCH` ของ source+งวด; `resolveSourceIssues` (:395-400) รับตัวกรอง formType
- `apps/api/src/modules/expenses/infrastructure/expense-void-blocker.ts` `retireExpenseTaxEvents` (:212-216): `ACTIVE|EXCLUDED` + resolve `WHT_RATE_MISMATCH` (งวด WHT)
- `expense-void-blocker.ts` ตัวตรวจเปิดแก้ (:137, :196-208 — review รอบ 2 F7): เมื่อรายจ่าย `E_WHT` ใช้เฉพาะแถวแบบ FILED ที่ครอบจริง (ไม่ใช้ล็อกเดือนแบบเก่าใน `filedWithholdingPaymentPeriods` :206) และไม่นับงวดของ event `EXCLUDED` ใน `eventPeriodIds`; ล็อกงวดบัญชีและ ภ.พ.30 คงเดิม
- `prisma-expense.repository.ts` ทาง void จาก CONFIRMED (:3570): supersede `EXCLUDED` ของรายจ่ายในธุรกรรมเดียวกัน + resolve `WHT_RATE_MISMATCH`
- เทสต์: `src/modules/tax/infrastructure/repositories/prisma-tax.repository.spec.ts`; PG `src/modules/expenses/infrastructure/prisma-expense.repository.void.spec.ts` (void จาก CONFIRMED ⇒ `SUPERSEDED` ก่อน sync; เปิดแก้ ⇒ เช่นกัน; เปิดแก้รายจ่าย e-WHT ที่จ่ายในเดือนล็อกแบบเก่า ⇒ ได้ แต่ร้านยื่นเองเดือนเดียวกัน ⇒ ยังบล็อก — รอบ 2 F7)
- ตรวจ: api typecheck; สอง spec

### 2.2 Sync (F2, F5, F6, F7)
- `apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts` ลูป expense WHT (:276-330) ตามสเปก §7.4:
  - `E_WHT`: ข้ามเฉพาะเมื่อมีแถวแบบ FILED ครอบ (ไม่ใช้ `isWithholdingPaymentFiled` แบบล็อกเดือนเก่าที่ :282/:288 และไม่ใช้ `assertPeriodUnlocked` ของ PND2 :297); formType เดิม (ไม่รู้ประเภทผู้รับเงิน → ข้าม ไม่สร้าง issue); resolve KIND/MISSING_TAX_ID/FX/RATE_MISMATCH เฉพาะงวด WHT; hash + remittance; `upsertEvent({ status: 'EXCLUDED', sourceEventType: 'expense.wht.e_wht' })`; `SyncResult.whtBankRemittedRecorded`
  - `PAYER_FILES`/`null`: เดิม + สะสม mismatch ต่อ `(sourceId, taxPeriodId)`; หลังลูป create หรือ resolve ครั้งเดียว
  - แก้ B5: `withholdingForm` (:70-73) resolve MISSING_TAX_ID/FX ด้วยตัวกรอง formType WHT
  - แก้ B6 (review รอบ 2 F3): `MISSING_TAX_ID`/`FUNCTIONAL_CURRENCY_FX_MISSING` ของแถว `SYSTEM_FILLS` สะสมต่อ `(sourceId, taxPeriodId)` แล้ว create/resolve ครั้งเดียวหลังลูป — เลิก resolve ทันทีต่อแถวที่ :72 และ :307-308
  - ตัวบล็อกเก่า (review รอบ 4 F4): หลังลูป resolve `MISSING_TAX_ID`/`FUNCTIONAL_CURRENCY_FX_MISSING`/`WHT_PAYEE_KIND_UNKNOWN`/`WHT_RATE_MISMATCH` ในงวด WHT ของ `expense.record` ที่ (รายจ่าย, งวด) ไม่อยู่ในชุดที่ต้องการของรอบนี้ (ตัวอ่านเป็นชุดเต็มทุกรอบ); void และ `retireExpenseTaxEvents` resolve ทันที
  - แก้ B9 (review รอบ 3 F2): `supersedeUnclassifiedWithholding` (`prisma-tax.repository.ts:386-393`) รับ `sourceLineKey`; `withholdingForm` (:75) ส่ง `sourceLineKey` ของแถวนั้น ⇒ supersede เฉพาะ event แบบอื่นของบรรทัด/การจ่ายเดียวกัน; ทางไม่รู้ประเภทผู้รับเงิน (:66) ยังทั้งรายจ่าย
  - สกุลเงิน (review รอบ 2 F2): event `EXCLUDED` เก็บ `currency` ของรายการตามเดิม ไม่แปลง
- `apps/web/src/features/tax/tax.logic.ts:36`: ป้าย `WHT_RATE_MISMATCH` → "ตรวจอัตรา"
- เทสต์: `src/modules/tax/application/use-cases/sync-tax-events-wht-form.use-case.spec.ts` (ครบตามสเปก §14 รวม FX ของ PP30 ยัง OPEN, สองบรรทัดคงที่สองรอบ, เดือนล็อกแบบเก่า, B6 สองลำดับบรรทัด, สกุลเงินคงเดิม, B9 บรรทัด ภ.ง.ด.3 + ภ.ง.ด.2 ทั้งสองลำดับ sync สองรอบ ⇒ event ทั้งสองแบบอยู่ครบ); `sync-tax-events-payee-address.use-case.spec.ts` และ `sync-tax-events-supplier-payment-wht.use-case.spec.ts` เดิมยังผ่าน
- ตรวจ: api typecheck; specs

### 2.3 หน้าเดือน + ข้อความแบบว่าง (F16)
- `packages/contracts/src/tax.ts`: `WithholdingMonthDto.bankRemitted?` (:941-952)
- `apps/api/src/modules/tax/application/use-cases/generate-wht-report.use-case.ts` `getMonth` (:44-48, :240): อ่าน `EXCLUDED` ด้วย `branchScopeWhere` → ผ่าน `currentWithholdingPayments` → map แบบ `separatePnd2` + `currency` → `bankRemitted`; (review รอบ 2 F6) รวม establishment ของ event `EXCLUDED` (ผ่าน `partitionWithholdingPayments`) เข้ากับรายการที่ :143 เพื่อให้สาขาที่มีแต่ e-WHT ปรากฏ และยกเว้น `*_FILING_BANK_REMITTED_ONLY` จากตัวกรองฟอร์มว่างที่ :171
- `packages/contracts/src/tax.ts` `WithholdingMonthPaymentDto.currency?` (:923-940)
- `apps/api/src/modules/tax/application/services/withholding-filing-validation.ts` (:51): ไม่มี event ของแบบในขอบเขตกระดาษ (สาขา) แต่มี `EXCLUDED` ของแบบ+สาขาเดียวกัน (ใช้ `partitionWithholdingPayments` แบบเดียวกับแบบ) → fault `bank_remitted_only` พร้อมชื่อแบบ/สาขา
- WARNING ไม่บล็อก (ไม่แตะ :119-120 ของ `generate-tax-filing-package.use-case.ts`)
- แก้ B8 (review รอบ 3 F1/P28 + รอบ 4 F8): `withholding-filing-validation.ts:68-70` ทางผู้ทำบัญชีจัดทำ คืน issue ต้นทางทั้ง BLOCKING และ WARNING (ไม่ใช่เฉพาะ fault สาขา/ผู้จ่าย) — W-T4 ต้องแสดงในเดือนที่มีประเภท "อื่นๆ"
- แก้ B12 (review รอบ 4 F3 — BL3 ปิดโดย focused re-check 2026-10-24): ฟังก์ชันเดียว `withholdingPaperBlockers(db, ctx, period, establishment, events)` ใน `apps/api/src/modules/tax/application/services/withholding-filing-validation.ts` (issue ต้นทาง BLOCKING ในขอบเขต + ต้นทางไม่มี event ผูกตามสาขา + `WHT_PAYEE_KIND_UNKNOWN` ของสาขาเดียวกันสำหรับทั้ง ภ.ง.ด.3/53 + ซ่อนรายละเอียดนอกขอบเขต) ใช้ที่ `validateWithholdingFiling` (เลิกตัดที่ :14), `getMonth` และ **`markFiled`** (`apps/api/src/modules/tax/presentation/http/tax.controller.ts:333-336` — เลิกตัด `WHT_PAYEE_KIND_UNKNOWN` และเลิกนับเฉพาะต้นทางที่มี event); `apps/web/src/features/tax/WithholdingPage.tsx:85` นับเป็นตัวบล็อก; replay ของกระดาษ FILED (`generate-tax-filing-package.use-case.ts:57-71`) คงเดิม แต่ `getMonth` แสดง W-T6 บนกระดาษ FILED ที่มีตัวบล็อกผูกอยู่; เทสต์ `src/modules/tax/presentation/http/tax.controller.spec.ts` (EXPORTED → ตัวบล็อกผู้รับเงินไม่รู้ประเภท → บันทึกว่ายื่นถูกปฏิเสธ — สเปก A37) และ `generate-tax-filing-package.use-case.spec.ts` (W-T6 + แบบเดิมเสนอแบบเพิ่มเติมหลังแก้ — A38/W-T6a; และกรณีมีแต่ ภ.ง.ด.53 FILED แล้วรายการไม่รู้ประเภทกลายเป็นบุคคลธรรมดา ⇒ event เป็น `WHT_PND3`, ภ.ง.ด.3 เปิดเป็นแบบปกติไม่ใช่เพิ่มเติม และถ้าพ้นกำหนดถูก fault `overdue` เดิมบล็อก — A38b/W-T6b; ต่อยอด `sync-tax-events-wht-form.use-case.spec.ts:91`)
- แก้ B11 (review รอบ 4 F2 — BL2, ต้องผ่านการตรวจอิสระก่อน): `generate-tax-filing-package.use-case.ts:76`, :88 (`paperIssues`) และ `generate-wht-report.use-case.ts:159` (`periodIssues`) คง issue ต้นทาง BLOCKING ของต้นทางที่ไม่มี event ในงวดนั้น **ผูกกับกระดาษตามสาขาของรายจ่าย** (`resolveWhtEstablishment`/`partitionWithholdingPayments`) ไม่ใช่ทุกกระดาษ; สาขาของต้นทางนอกขอบเขตผู้เรียก ⇒ ส่งเป็น W-T5 โดยไม่มี `payeeName`/`expenseId`/`counterpartyId`/ข้อความที่มีชื่อ; ยังไม่ตอบโหมดผู้จ่าย ⇒ `WHT_PAYER_MODE_REQUIRED` เดิม
- `bank_remitted_only` (W-T3) เฉพาะเมื่อไม่มี issue ต้นทาง BLOCKING ในขอบเขต (รวมข้อบน — review รอบ 3 F4)
- เทสต์: `src/modules/tax/application/use-cases/generate-tax-filing-package.use-case.spec.ts` (เดือน PND3 มีแต่ e-WHT + PND53 มีแถวปกติ ⇒ PND53 ไม่ได้ W-T3; WARNING ไม่บล็อก; ไฟล์แบบไม่มีชีต e-WHT, checksum ไม่เปลี่ยน; `getMonth`: สาขาที่มีแต่ e-WHT ปรากฏพร้อม W-T3 และ fault ไม่ถูกตัด, `bankRemitted` มีสกุลเงิน — รอบ 2 F6/F2; ไฟล์นี้ครอบ `GenerateWhtReportUseCase` อยู่แล้ว; sync → export จริงของ A22 ทั้งสองลำดับ ⇒ PDF และ Excel ทางผู้ทำบัญชีจัดทำถูกบล็อก (B8, B11); ต้นทางไม่มี event + รายการอื่นมี event ⇒ การ์ดแสดงตัวบล็อก (B11); e-WHT + รายการปกติขาดเลขผู้เสียภาษี ⇒ ไม่มี W-T3 (รอบ 3 F4))
- ตรวจ: contracts build; api typecheck; spec

### 2.4 Endpoint ไฟล์ e-WHT (F9)
- `apps/api/src/modules/tax/presentation/http/tax.controller.ts`: `@Get('tax/withholding/months/:periodKey/e-wht-export')` guard เดียวกับ :92-93
- service ข้าง `generate-wht-report.use-case.ts`: อ่าน `EXCLUDED` (current + ขอบเขตสาขา + `establishmentCode` ถ้ามี) → `buildWorkbook` ชีต W-X3 (มีคอลัมน์สกุลเงิน, แถวรวมแยกต่อสกุลเงิน — รอบ 2 F2) → คืน artifact; ไม่ validate แบบ ไม่จองเลข ไม่เก็บไฟล์ ไม่สร้าง package; audit `tax.withholding.e_wht_export`
- `withholding-accountant-export.ts` **ไม่แก้**
- เทสต์: `src/modules/tax/presentation/http/tax.controller.spec.ts` (สิทธิ์; เดือนมีแต่ e-WHT; เดือนที่ยื่นแล้วเห็นรายการใหม่; สาขานอกขอบเขต; ไม่มี package ใหม่)
- ตรวจ: api typecheck; spec

### 2.5 สถานะใบเตรียมจ่าย
- `packages/contracts/src/disbursement-vouchers.ts:217`: state `'E_WHT'`
- `apps/api/src/modules/expenses/infrastructure/prisma-disbursement-voucher.repository.ts` (:120-134): `E_WHT` ก่อนวน handoff; `detailInclude` (:35-39) เพิ่ม `whtRemittance`, `whtCategoryCode`, `whtRate`, `whtInputJson`, `whtAmount` และบรรทัด**ทั้งหมด**พร้อม `whtAmount`/`whtRate`/`taxableAmount` — เลิก `take: 1` ที่ :38 สำหรับข้อมูลนี้ (คำอธิบายยังใช้บรรทัดแรก) เพราะ `expenseWhtHeaderRate` ใช้อัตราบรรทัดก่อนอัตราหัวเอกสารเมื่อ `whtInputJson` ว่าง (review รอบ 3 F5/P11 + รอบ 4 F7/P42)
- `apps/api/src/modules/expenses/application/use-cases/disbursement-voucher.use-case.ts` mapper (:276-285): ส่ง `whtRemittance` และ `eWhtReducedRateApplied` (ประเภท `REDUCED` + อัตราหัวเอกสาร 1 ด้วย `expenseWhtHeaderRate`) ในบรรทัดของ `DisbursementVoucherDetail`
- เทสต์: PG `prisma-expense.repository.payment.spec.ts` (อ่านใบได้ `E_WHT`, `whtRemittance` และ `eWhtReducedRateApplied` ถูกต่อบรรทัด: ค่าโฆษณา 1% = true, ค่าขนส่ง 1% = false)
- ตรวจ: contracts build; api typecheck; spec

## Phase 3 — เว็บ

### 3.1 ฟอร์มตรวจ (F4, F14, F15)
- `apps/web/src/features/expenses/ExpensesPages.tsx` (fieldset :2521-2600): select W-F1..F3; autofill เฉพาะโหมด RATE ตาม `eWhtReducedRateOn(...) ?? defaultRate` เมื่อเลือกประเภทหรือเปลี่ยนช่องทาง; คำใบ้ W-F4..F11 ตามตาราง §10.2; **ซ่อน `whtFilingRouteHint` (:2566) เมื่อ e-WHT**
- state/payload ฟอร์ม: `whtRemittance` (ตั้งต้น `PAYER_FILES` เมื่อ "หัก"; "ไม่หัก" ⇒ `null`)
- `apps/web/src/features/expenses/useExpenseReviewTotals.ts` (:28-29): ตัด `whtRemittance` ออกจาก preview payload แบบเดียวกับ `whtCategoryCode`/`whtRate`
- `apps/web/src/common/i18n/workspace-dictionary.ts`: key ชี้ `E_WHT_WORDS`
- เทสต์: `apps/web/src/features/expenses/expense-withholding-ux.spec.ts` (ตาราง §10.2, AMOUNT ไม่เติม, ไม่มี route hint เมื่อ e-WHT, preview payload ไม่มี `whtRemittance`)
- ตรวจ: web typecheck; spec

### 3.2 หน้ารายจ่าย + ใบรับรองแทนใบเสร็จ (F11)
- `apps/web/src/features/expenses/ExpenseReviewPage.tsx`: `certificateCardVisible` (:1310) → W-D1 เมื่อ e-WHT และมีการจ่าย `RECORDED`, W-D1u เมื่อยังไม่มี (review รอบ 3 F9); วิธีจ่ายตัดเงินสด/บัตร + W-P1, W-P2 (:246); W-C1 ในกล่องเปิดแก้/ยกเลิก/ยกเลิกรายการจ่าย; แสดง W-R2 จาก 409
- `apps/web/src/features/expenses/SubstituteReceiptWizardPage.tsx` (:268, :532): ตัดเงินสด/บัตรเมื่อรายจ่าย e-WHT; แสดง W-R3; ช่องวันจ่ายเงินบริษัท (:2063) แสดง W-P2 เมื่อ e-WHT + `REDUCED` + อัตรา 1 + วันนอกช่วง (review รอบ 3 F8)
- `apps/web/src/features/expenses/PaymentDateConfirmation.tsx` (:18, :26) + ผู้เรียกที่ `ExpenseReviewPage.tsx:1858` (review รอบ 2 F9): รับ `whtRemittance`/ประเภท/อัตรา; e-WHT ⇒ W-PD1 และ W-PD2 แทนข้อความ "…ยื่นภาษี"/"อยู่ในแบบเดือน…"; W-P2 เมื่อวันที่ที่กรอกอยู่นอกช่วง + อัตรา 1 + `REDUCED`; ร้านยื่นเอง/`null` ข้อความเดิม; เทสต์ `apps/web/src/features/expenses/PaymentDateConfirmation.spec.ts`
- เทสต์: web spec ที่ทดสอบหน้ารายจ่าย/ใบรับรองแทนใบเสร็จอยู่แล้ว หรือไฟล์ใหม่ใต้ `src/`
- ตรวจ: web typecheck; spec

### 3.3 ใบเตรียมจ่าย (F11, F21)
- `apps/web/src/features/expenses/disbursement-vouchers/disbursement-voucher-payment.logic.ts` (:42-46): กลุ่ม `E_WHT`
- `DisbursementVoucherWithholding.tsx`: W-V1 (ใบ `PAID`) / W-V1u (ยังไม่จ่าย — review รอบ 3 F9) ไม่มีปุ่ม; การ์ดจ่ายใช้ `eWhtReducedRateApplied` ของบรรทัดเพื่อตัดสิน W-P2 (รอบ 3 F5)
- `DisbursementVoucherPayCard.tsx` + ฟอร์มร่าง (วิธีจ่ายที่วางแผน): ตัดเงินสด/บัตรเมื่อมีรายการ e-WHT (ร่างอ่านจาก `DisbursementPayableExpense.whtRemittance` — รอบ 2 F4) + W-P1, W-P2; แสดง 409
- เทสต์: `disbursement-voucher-payment.logic.spec.ts`, `DisbursementVoucherPayCard.qa.spec.ts`
- ตรวจ: web typecheck; สอง spec

### 3.4 หน้า ภาษีหัก ณ ที่จ่าย (F9, F16)
- `apps/web/src/features/tax/WithholdingPage.tsx`: การ์ด W-T1/W-T2 + ปุ่ม W-T2b (เรียก endpoint 2.4) ต่อจากการ์ด ภ.ง.ด.2 (:209); การ์ด "ควรตรวจก่อนยื่น" แยกจาก "ต้องแก้ก่อนยื่น" (:230); W-T3 ต่อแบบ/สาขาแทนปุ่มดาวน์โหลดแบบ
- `apps/web/src/features/tax/tax.api.ts`: `bankRemitted`, ฟังก์ชันดาวน์โหลด e-WHT
- เทสต์: `apps/web/src/features/tax/WithholdingPage.spec.ts`
- ตรวจ: web typecheck; spec

### 3.5 Journey + seed + ตรวจด้วยตา (F23)
- ใหม่ `e2e/journeys/e-wht-payment.journey.spec.ts`; ขยาย `e2e/journeys/withholding-forms.journey.spec.ts` (เดือนผสม + ดาวน์โหลด e-WHT)
- `apps/api/prisma/seed-expenses.ts`: e-WHT 1 + ร้านยื่นเอง 1 เดือนเดียวกัน
- ตรวจ: `pnpm exec playwright test --project=journeys-mobile e2e/journeys/e-wht-payment.journey.spec.ts e2e/journeys/withholding-forms.journey.spec.ts`; เปิดเบราว์เซอร์จริงที่ **390 และ 1,280** (ตาม `docs/guidelines/thai-ux-standard.md:114`) และ ~1,556 ด้วยข้อมูลไทย: ฟอร์มตรวจ, หน้ารายจ่าย, ฟอร์มจ่าย, กล่องเปิดแก้, ใบเตรียมจ่าย, ใบรับรองแทนใบเสร็จ, หน้า ภาษีหัก ณ ที่จ่าย — ถ่ายภาพ ดูภาพ วัดปุ่มในกลุ่ม กดผิดหนึ่งครั้ง; จดว่ากดอะไร/ไม่ได้กดอะไร ต่อบทบาท (ผู้ตรวจ, ผู้จ่าย, ผู้ทำบัญชีแพ็ก 1,999, ร้านแพ็ก 249)

### 3.6 หน้าตั้งค่า e-WHT + ฟอร์มซ่อนช่องเมื่อยังไม่ได้สมัคร (สเปก §5.5, §10.1 S-1..S-8, W-F10o, §10.2)
- `apps/web/src/features/web-core-workspace/settings-menu.logic.ts`: การ์ด `{ key: 'e-wht', href: '/settings/e-wht', title: S-1, desc: S-2 }` ต่อจาก `substitute-receipt`; เพิ่ม `'e-wht'` ใน `SETTINGS_SIDEBAR_KEYS` ต่อจาก `'substitute-receipt'`
- `apps/web/src/features/web-core-workspace/route-permissions.ts`: `{ path: '/settings/e-wht', anyOf: ['company.setup.manage'] }`
- ใหม่ `apps/web/app/(workspace)/companies/[companyId]/settings/e-wht/page.tsx` + `apps/web/src/features/expenses/EWhtSettingsPage.tsx` (`ChoiceRow` แบบ `SubstituteReceiptSettingsPage.tsx`; ปุ่มใน `FormActionBar` แบบ `branch-settings/WhtPayerModeSettings.tsx`; toast) + `getExpenseEWhtSetting`/`updateExpenseEWhtSetting` ใน `expenses.api.ts`
- `apps/web/src/features/expenses/ExpensesPages.tsx` (fieldset ของ 3.1): โหลดการตั้งค่า; แสดง W-F1..F3 เมื่อ `used || expense.whtRemittance === 'E_WHT'`; ช่องถูกซ่อนแล้ว **ยังส่ง** `whtRemittance` ตามค่าตั้งต้นของ 3.1 (`PAYER_FILES` เมื่อหัก, `null` เมื่อไม่หัก — F1); W-F10o (มี `company.setup.manage` + ลิงก์) / W-F10o' แทน W-F10; อ่านการตั้งค่าไม่สำเร็จ ⇒ `used = false` แต่รายจ่ายที่เก็บ E_WHT ยังเห็นช่อง (F2) — เซิร์ฟเวอร์เป็นผู้ตัดสิน
- เทสต์: `expense-withholding-ux.spec.ts` (แถวการตั้งค่าใน §10.2), `settings-menu.logic.spec.ts` (การ์ดตามสิทธิ์)
- 3.5: journey `e-wht-payment` เริ่มด้วยการเปิดตั้งค่า e-WHT ของร้าน; seed ร้าน e-WHT ตั้ง `eWhtUsed = true`; กดเองเพิ่ม: ร้านที่ยังไม่ได้สมัครไม่เห็นช่อง, หน้าตั้งค่าที่ 390/1,280/~1,556
- ตรวจ: web typecheck; สอง spec

## Phase 4 — LINE, ผู้ช่วย, คู่มือ

### 4.1 LINE การ์ดและข้อความ (F11)
- `apps/api/src/modules/line-ai/application/line-expense-action.service.ts`: L-2 (ข้อความอนาคต — รอบ 3 F9)/L-9 ในรายละเอียด RECORD_PAYMENT (:566); L-3 แทน :500-501 เมื่อ `E_WHT`; ค่าตั้งต้น `BANK_TRANSFER` เมื่อรายจ่าย `E_WHT` และผู้ใช้ไม่ได้บอก (:533-541)
- `apps/api/src/modules/line-ai/application/line-voucher-action.service.ts`: L-4 "หักภาษีทั้งเอกสาร" ทุกบรรทัด (:127, :166 — บั๊ก B10, รอบ 3 F7); L-2/L-9 ในการ์ด VOUCHER_PAY โดย L-9 ใช้ `eWhtReducedRateApplied` ของบรรทัด (รอบ 3 F5); ค่าตั้งต้น `BANK_TRANSFER` เมื่อมีรายการ `E_WHT` (:160-163)
- เทสต์: `src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` (L-2 อนาคต), `src/modules/line-ai/application/use-cases/erp-tax-tools.use-case.spec.ts` (การ์ดใบเตรียมจ่ายจ่ายบางส่วน ⇒ "หักภาษีทั้งเอกสาร" — B10; VOUCHER_PAY ค่าขนส่ง 1% ปี 2028 ⇒ ไม่มี L-9)
- ตรวจ: api typecheck; สอง spec

### 4.2 LINE ปฏิเสธพร้อมสถานะลองใหม่ (F22)
- `line-expense-action.service.ts`: map `expense_ewht_payment_method`/`disbursement_ewht_planned_method` → L-1 (:156, :1050); เมื่อเกิดในพรีวิว RECORD_PAYMENT/VOUCHER_PAY บันทึก `StoredAction` (`awaitingField: 'paymentMethod'`, revision/digest, `preview.payment`, `allowedPaymentMethods`) + ปุ่ม [โอนเงิน] [เปิดรายการ]; คำตอบที่ :991 ส่งยอด/วันที่เดิมต่อ (:995-997); `question()` (:333-338) ใช้ L-10 + ปุ่ม [โอนเงิน] [เช็ค] เมื่อมี `allowedPaymentMethods`; ตอบเงินสดซ้ำ → L-1 โดยไม่สร้างสถานะใหม่
- เทสต์: `process-line-webhook.use-case.spec.ts` (กด "โอนเงิน" ⇒ พรีวิวยอด/วันเดิม; รายการเปลี่ยน ⇒ ข้อความเดิม; อ่านไม่ออก ⇒ L-10; "ยกเลิก" ⇒ ทิ้ง)
- ตรวจ: api typecheck; spec

### 4.3 เครื่องมือ AI + แนวทางผู้ช่วย (F18, F19, F20)
- `apps/api/src/modules/line-ai/application/use-cases/erp-advisor-document-tools.use-case.ts`: `WhtCalculateWithholdingTool` (:124-151) L-5 + `eWht*` เมื่อประเภทที่เลือก `REDUCED` และวันนี้ในช่วง (ไม่แตะการจับคู่ชื่อเต็ม :131-133); `WhtGetMonthSummaryTool` (:62-121) L-12 แทน :108 (บั๊ก B7 — รอบ 2 F8: บอกว่าเป็นรายการใบ 50 ทวิที่นับรายการยังไม่จ่ายด้วย และใช้ "ยอดหักตามเอกสาร") + L-11 + `eWht` จาก `EXCLUDED` **เฉพาะเมื่อ `pnd53Readable`** (รอบ 2 F1), ขอบเขตสาขา/`input.branchId`, current sources, ยอดแยกต่อสกุลเงิน (รอบ 2 F2)
- `WhtGetMonthSummaryTool` ยอดซ้อน B13 (review รอบ 4 F5): แถว REQUIRED ระดับเอกสารที่มีใบของบางการจ่ายแล้ว นับยอดคงเหลือ = ยอดเอกสาร − ยอดใบที่ออก/บันทึกแล้ว (ไม่ติดลบ; 0 ไม่นับรายการ) ที่ :84-90; เทสต์ใน `erp-tax-tools.use-case.spec.ts` (จ่ายสองงวด ออกใบงวดแรก ⇒ 10,000/100)
- `WhtGetMonthSummaryTool` ทำ B7 ให้ครบ (review รอบ 3 F6/P33): ประโยคอังกฤษ :102 → L-12en, ท้ายข้อความ :107 → L-13en และ :114 → L-13, ฟิลด์ผลลัพธ์ `certificateItemCount`/`totalIncome`/`totalDocumentWithholding`/`byIncomeType[].itemCount…` + `countBasis`
- registry `packages/contracts/src/ai-tools.ts`: แก้**เฉพาะคำอธิบาย** `wht.get_month_summary` (:1351) ตามสเปก §7.1; สิทธิ์ featureKeys และการผูกเครื่องมือเดิม (เครื่องมือยังแพ็ก 1,999); W00 regenerate ใน 4.5
- `apps/ai-gateway/src/modules/line-ai/agents/advisor-domain-guidance.ts`: บรรทัด e-WHT (อังกฤษภายใน — รวมข้อเท็จจริง: โรงแรม/ภัตตาคาร/เบี้ยประกันชีวิตไม่ใช่ค่าบริการหัก 3%, ค่าเช่าเรือขนส่งระหว่างประเทศ 1% ปกติ) + แหล่งในคอมเมนต์หัวไฟล์ (mr389, mr402, 2494.html, 3479.html, news5_2564, news14_2569)
- เทสต์: `erp-tax-tools.use-case.spec.ts` ("ค่าโฆษณา" ⇒ ปุ่ม; เลือกชื่อเต็ม ⇒ 200 + L-5 100; ขนส่ง/2028 ⇒ ไม่ต่อท้าย; สรุปเดือน e-WHT ล้วน ⇒ L-12 ศูนย์ + L-11; สาขานอกขอบเขต; ผู้มีแค่ `wht.certificate.read` ⇒ ไม่มี L-11; สองสกุลเงิน ⇒ แยกยอด; ใบแจ้งหนี้ยังไม่จ่าย ⇒ L-12 ไม่เรียกว่าการจ่าย; ภาษาอังกฤษ L-12en/L-13en และชื่อฟิลด์ใหม่ + `countBasis`); `apps/ai-gateway/src/modules/line-ai/agents/tool-availability.spec.ts` (แพ็ก starter ไม่ได้เครื่องคิดเลข)
- ตรวจ: api typecheck; ai-gateway typecheck; specs

### 4.4 แพ็กคำตอบ + คู่มือ (Q4 answered 2026-11-04; ยังต้องผ่าน MC2; F24)
- `apps/web/src/features/user-guide/tax-guide.content.ts`: H-1 ในแท็บ WHT (:107-133), H-2 แทน :109
- `apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts:8`: `sources.tax.hash` ใหม่
- `apps/ai-gateway/src/modules/line-ai/agents/product-help-draft-cards.ts`: `wht.e-wht` สร้างเป็น object ตรง (ไม่ใช้ `card()` :3-12 ที่ตรึง getting-started): `sourceURL '/companies/{companyId}/user-guide/tax#wht'`, `sourceFile 'apps/web/src/features/user-guide/tax-guide.content.ts'`, `sourceHash` = sha256 ไฟล์คู่มือภาษีใหม่, `featureKeys: []`, `permissionAnyOf: ['expense.read','expense.read_own']`, คำถาม "e-WHT คืออะไร", "จ่ายผ่าน e-WHT ต้องยื่น ภงด53 ไหม", "e-WHT หักกี่เปอร์เซ็นต์", "จ่ายผ่าน e-WHT ต้องออก 50 ทวิไหม", body L-7, `contentHash` คำนวณ; `V6_REVISED_BODIES['wht.calculation']` = L-8 (:138); reviewers v6 + บันทึกอนุมัติเจ้าของพร้อมวันที่
- v4 ไม่เพิ่มการ์ด (`approved-knowledge.spec.ts:64`)
- `apps/ai-gateway/src/modules/line-ai/domain/logic/line-ai-scope-policy.logic.ts` (review รอบ 4 F6): ใน `documentExplanationTopic` (:355-365) จับ `e-?wht|e-?withholding` ก่อนทาง `หัก ณ ที่จ่าย|withhold|wht` และให้ `documentExplanationReply` (:429-441) ตอบ L-14 (= L-7 จาก `E_WHT_WORDS`) แทนคำอธิบายทั่วไปที่บอกว่าผู้จ่ายนำส่ง; เทสต์ `line-ai-scope-policy.logic.spec.ts` + spec semantic-turn-v2 ในชุด gateway ของ whole-chain (คำตอบที่ส่งจริงผ่าน `semantic-turn-v2.ts:1510`)
- `apps/ai-gateway/src/modules/line-ai/agents/agent-tools.registry.spec.ts` (:351-362 — review รอบ 2 F11): v6 จาก 68 เป็น 69 การ์ด, `reviewers` เพิ่มบันทึกอนุมัติเจ้าของ (Q4 answered 2026-11-04), assertion ของ v4 คงเดิม; ไฟล์นี้อยู่ในสคริปต์ `test` และ `test:line-ai-business-coverage` ของ ai-gateway แล้ว
- เทสต์: `apps/ai-gateway/src/modules/line-ai/agents/agent-tools.registry.spec.ts`; `apps/ai-gateway/src/modules/line-ai/agents/approved-knowledge.spec.ts` (source ของ `wht.e-wht` คือ tax-guide และ hash ตรง); `apps/web/src/features/user-guide/user-guide.content.spec.ts`
- ตรวจ: สอง spec; web typecheck

### 4.5 W00 + whole-chain
- `cd apps/api && UPDATE_LINE_AI_CAPABILITY_MANIFEST=1 ../../node_modules/.bin/tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts` แล้วรีวิว diff (เปลี่ยนเฉพาะ source hash ที่ตั้งใจ)
- `node scripts/run-line-ai-whole-chain-acceptance.mjs` ก่อน push
- ไม่เพิ่ม suite ใน `scripts/line-ai-whole-chain-acceptance.catalog.mjs`

## Phase 5 — ปิดงาน

- สเปก/memory: สถานะ + คำสั่งที่รันจริง/ผล/สิ่งที่ไม่ได้รันพร้อมเหตุผล
- `docs/plans/master-implementation-checklist.md`: Reorder Log ชี้สเปก/แผนนี้; backlog ข้อ 7 ชี้สเปก
- ชุดย้อนกลับ R (review รอบ 3 F3 + รอบ 4 F1/P40 — สเปก §16, **BL1 ต้องผ่านการตรวจอิสระก่อน**): branch จากรุ่นก่อนหน้า + schema ที่มี `whtRemittance` + **ตัวป้องกันฝั่งเขียนทุกจุดที่อ่าน `whtRemittance`** (แผน 1.3 ไม่สร้าง handoff ตอนยืนยัน, 1.4 และ 1.5 จุดบังคับวิธีจ่ายทั้งหมดรวม `recordPaymentInTransaction` `prisma-expense.repository.ts:681-690` และการตรวจตอนยืนยันใหม่) + เงื่อนไขตัด `E_WHT` ใน `findConfirmedWithWhtByCompany` (`expense-source.adapter.ts:70-80`); ไม่ต้องคง UI; build/publish image ไว้; ซ้อมบน UAT: เปิดหน้า ภาษีหัก ณ ที่จ่าย (sync ทั้งบริษัท) ⇒ ไม่มี event `ACTIVE` ของรายจ่าย e-WHT, บันทึกจ่ายเงินสดให้รายจ่าย e-WHT ⇒ 409, เปิดแก้แล้วยืนยันใหม่ ⇒ ไม่มี handoff (สเปก A32); ห้ามย้อน API ด้วยรุ่นเก่าตรง ๆ
- ก่อน deploy (BL3): query อ่านอย่างเดียวหา `WhtFiling` สถานะ FILED ที่เดือน/แบบ/สาขาเดียวกันมี issue OPEN `WHT_PAYEE_KIND_UNKNOWN` หรือ `MISSING_TAX_ID` ของต้นทางที่ไม่มี event (กระดาษที่อาจยื่นไปโดยขาดรายการ) แล้วรายงานเจ้าของเป็นภาษาไทยง่าย ๆ ให้ผู้ทำบัญชีแก้ข้อมูลและยื่นแบบเพิ่มเติม
- ก่อน deploy: query อ่านอย่างเดียวนับรายจ่าย CONFIRMED `whtAmount>0` + ประเภท `REDUCED` + อัตรา 1 (runbook bastion — แจ้งเจ้าของก่อน, SQL ทุกไฟล์ใน session เดียว) แล้วรายงานภาษาไทยง่าย ๆ
- UAT ตาม `docs/runbooks/uat-production-v2-deployment.md`; Production เมื่อเจ้าของสั่งเท่านั้น
- push ตรง develop และ main หลังตรวจในเครื่อง (ไม่เปิด PR ไม่เรียก Actions) — fetch develop ก่อน push

## การตัดสินใจที่ล็อกแล้ว (อย่ารื้อโดยไม่บันทึก)

1. ช่องทางอยู่ที่ `ExpenseRecord` ไม่ใช่ต่อการจ่าย
2. e-WHT ใช้ `TaxEvent.status = EXCLUDED` + `sourceEventType = 'expense.wht.e_wht'`; `EXCLUDED` ไม่เคยอยู่ในแบบ จึงไม่ถูกล็อกเดือนแบบเก่าบล็อก และไม่เปลี่ยนสถานะงวด
3. ไม่สร้าง 50 ทวิ handoff ให้ e-WHT (Q2 answered 2026-11-04: ไม่ออกกระดาษ 50 ทวิ)
4. เซิร์ฟเวอร์ไม่บังคับอัตรา; บังคับข้อเดียว "e-WHT ห้ามเงินสด/บัตร" ทุกทางที่สร้างหรือพรีวิวการจ่าย และตอนเปลี่ยน/ยืนยันช่องทาง
5. กติกา 1% เป็นค่าคงที่ใน contracts พร้อม URL
6. แถวเก่า `null` = ร้านยื่นเอง ไม่ backfill; ไฟล์ส่งออก "ไม่ได้ระบุ"; คอลัมน์ใหม่อยู่ท้ายสุด
7. ตั้งช่องทางบนเว็บ; LINE แสดงผล ปฏิเสธพร้อมสถานะลองใหม่ที่ผูกกับรายการ และใช้ค่าตั้งต้น ไม่ถาม
8. `WHT_RATE_MISMATCH` เป็น WARNING หนึ่งรายการต่อรายจ่ายต่องวด ข้อความเป็นเงื่อนไข ไม่ทึกทักว่า 1% คือ e-WHT
9. ไฟล์รายการ e-WHT เป็น endpoint อ่านอย่างเดียวแยกจากแบบ — ไฟล์แบบไม่เปลี่ยน
10. การ resolve issue ของ source จำกัดเฉพาะงวด WHT (แก้ B5) และตัดสินรวมต่อ (รายจ่าย, งวด) หลังลูป (แก้ B6)
11. ยอด e-WHT ไม่แปลงสกุลเงิน — แยกตามสกุลเงินทุกที่ (การ์ด, ไฟล์, LINE)
12. บรรทัด e-WHT ในสรุปรายเดือน LINE เฉพาะผู้มี `wht.pnd53.read`
13. การเปิดแก้รายจ่าย e-WHT ถูกบล็อกเฉพาะเมื่อมีแถวแบบที่ยื่นจริงครอบ
14. issue ต้นทาง BLOCKING ไม่หายจากกระดาษ ทั้งทางผู้ทำบัญชีจัดทำ (B8) และต้นทางที่ไม่มี event (B11)
15. supersede แบบอื่นทำต่อบรรทัด/การจ่าย ไม่ใช่ทั้งรายจ่าย (B9)
16. ข้อความก่อนจ่ายเป็นอนาคต (W-D1u, W-V1u, L-2); ยอดหักในการ์ดใบเตรียมจ่ายระบุว่าเป็นของทั้งเอกสาร (B10)
17. ย้อนกลับด้วยชุด R ที่คงตัวป้องกันฝั่งเขียนที่อ่าน `whtRemittance` ทั้งหมด + ตัด `E_WHT` ออกจากตัวอ่าน sync — ห้ามรุ่นเก่าตรง ๆ (รอบ 4 F1)
18. ตัวบล็อกของต้นทางที่ไม่มี event ผูกตามสาขาของรายจ่าย และซ่อนรายละเอียดเมื่อนอกขอบเขตผู้เรียก (รอบ 4 F2)
19. `WHT_PAYEE_KIND_UNKNOWN` บล็อกกระดาษทั้ง ภ.ง.ด.3 และ 53 ของสาขาเดียวกัน ทั้งตอนดาวน์โหลดและตอนบันทึกว่ายื่นแล้ว ผ่าน `withholdingPaperBlockers` ฟังก์ชันเดียว; กระดาษที่ FILED แล้วไม่ถูกแก้ แต่ติดธง W-T6; หลังแก้ข้อมูล แบบเดิม ⇒ แบบเพิ่มเติม, อีกแบบที่ยังไม่ยื่น ⇒ แบบปกติ (อาจยื่นช้า — ข้อความ overdue เดิม) (รอบ 4 F3 / B12 + focused review + BL3 re-check)
20. ทางผู้ทำบัญชีจัดทำเก็บ issue ต้นทางทั้ง BLOCKING และ WARNING; ตัวบล็อกของต้นทางที่ไม่ส่งผลแล้วถูก resolve ทุก sync (รอบ 4 F4, F8)
21. (เจ้าของ 2026-10-26) ตัวเลือก e-WHT มีเฉพาะร้านที่ตอบ "สมัครแล้ว" ที่ตั้งค่าร้าน (`CompanyTaxProfile.eWhtUsed`, ค่าตั้งต้น false); เซิร์ฟเวอร์ปฏิเสธ E_WHT ใหม่เมื่อยังไม่ได้สมัคร; รายจ่ายที่เป็น E_WHT อยู่แล้วแสดงและแก้ได้เสมอ; การเปลี่ยนการตั้งค่าไม่แก้ข้อมูลเดิมและไม่เข้า sync

## Traceability

This section indexes the existing design with owner-answer gates updated on 2026-11-04. R1–R21 resolve to the spec's Traceability table, which provides code evidence, exact proposed test names and A1–A44 acceptance mapping. R16–R21 cover §5.5, plan 1.7/3.6 and A39–A44. Dependencies retain the existing engineering guards; owner Q1–Q4 are answered 2026-11-04, with no implementation redesign. Existing blocker/number fixes integrate trust/money P11–P12/P08 rather than being implemented twice.

Command notation for the listed checks: **API** = `pnpm --filter @watchdog-bms/api exec node --import tsx --test <listed file relative to apps/api>`; **TYPE_API/TYPE_WEB** = `bash scripts/local-proof/tsc.sh api` / `bash scripts/local-proof/tsc.sh web`; **WEB** = `pnpm --filter @watchdog-bms/web exec tsx --test <listed file relative to apps/web>`; **GATEWAY** = `pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx --test <listed file relative to apps/ai-gateway>`; **SCHEMA** = `pnpm --filter @watchdog-bms/api exec prisma validate --schema prisma/schema.prisma` then `pnpm --filter @watchdog-bms/api exec prisma generate --schema prisma/schema.prisma`, additive migrations on isolated local PostgreSQL only. **PG** means the listed registered API spec's real-database block with the documented local proof URL, never a skip. Browser checks preserve §3.5's 390/1280/~1556 requirement. No command ran in this documents round.

Review in small rounds (up to five steps): 1.1–1.5; 1.6/1.7/2.1/2.2/2.3; 2.4/2.5/3.1/3.2/3.3; 3.4/3.6/3.5/4.1/4.2; 4.3/4.4/4.5/Phase 5. Original owner/proof gates and technical dependencies take precedence; these are review groupings, not a redesign.

| Existing step | Requirement ids | Existing dependency / integration prerequisite | Exact test files, proposed names in spec trace | Verification |
|---|---|---|---|---|
| Phase 0 | R5/R13/R15–R21 | Q1–Q4 answered 2026-11-04; MC1 CLOSED | No code test | Owner decisions only; no new question added |
| 1.1 | R1/R16 | Existing Phase 0 gates; no new gate | packages/contracts/src/prisma-enum-parity.spec.ts | SCHEMA; contracts build; additive local migration |
| 1.2 | R2/R3/R7/R11/R12 | 1.1 | apps/api/src/modules/tax/domain/logic/tax-period.logic.spec.ts | API; TYPE_API; contracts build |
| 1.3 | R1/R5 | 1.2; Q2 answered 2026-11-04 | apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.atomic-confirm.spec.ts; apps/api/src/modules/expenses/domain/logic/expense-status.logic.spec.ts | API; TYPE_API; PG |
| 1.4 | R3 | 1.3 | apps/api/src/modules/expenses/application/use-cases/record-expense-payment.use-case.spec.ts; apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts; apps/api/src/modules/line-ai/application/use-cases/erp-tax-tools.use-case.spec.ts | API; TYPE_API; PG |
| 1.5 | R4 | 1.3 | apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.atomic-confirm.spec.ts; apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts; apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.substitute-payment.spec.ts | API; TYPE_API; PG |
| 1.6 | R5/R9 | 1.3 | apps/api/src/modules/expenses/domain/logic/expense-export.logic.spec.ts; apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.atomic-confirm.spec.ts | API; TYPE_API |
| 1.7 | R11/R16–R20 | 1.3 | apps/api/src/modules/expenses/domain/logic/expense-status.logic.spec.ts; apps/api/src/modules/expenses/application/use-cases/expense-draft-amount-validation.use-case.spec.ts; apps/api/src/modules/expenses/application/use-cases/substitute-receipt-policy.use-case.spec.ts; apps/api/src/modules/expenses/presentation/http/expense.dtos.spec.ts; apps/api/src/common/pipes/body-validation-coverage.spec.ts | API; TYPE_API; SCHEMA |
| 2.1 | R6 | 1.1 | apps/api/src/modules/tax/infrastructure/repositories/prisma-tax.repository.spec.ts; apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.void.spec.ts | API; TYPE_API; PG |
| 2.2 | R6/R7 | 2.1 | apps/api/src/modules/tax/application/use-cases/sync-tax-events-wht-form.use-case.spec.ts | API; TYPE_API; B5 PP30 compatibility side effect only for unsold thai_tax |
| 2.3 | R8/R10 | 2.2; reuse already-owned trust/money blocker result | apps/api/src/modules/tax/application/use-cases/generate-tax-filing-package.use-case.spec.ts; apps/api/src/modules/tax/presentation/http/tax.controller.spec.ts | API; TYPE_API; PG blocker regressions |
| 2.4 | R10/R11 | 2.2 | apps/api/src/modules/tax/presentation/http/tax.controller.spec.ts | API; TYPE_API |
| 2.5 | R5 | 1.1 | apps/api/src/modules/line-ai/application/use-cases/erp-tax-tools.use-case.spec.ts | API; TYPE_API |
| 3.1 | R2/R14 | All 1.x/2.x as original graph | apps/web/src/features/expenses/expense-withholding-ux.spec.ts | WEB; TYPE_WEB |
| 3.2 | R3/R4/R5/R14 | All 1.x/2.x as original graph | apps/web/src/features/expenses/expense-withholding-ux.spec.ts | WEB; TYPE_WEB |
| 3.3 | R3/R5/R14 | All 1.x/2.x as original graph | apps/web/src/features/expenses/disbursement-vouchers/disbursement-voucher-payment.logic.spec.ts; apps/web/src/features/expenses/disbursement-vouchers/DisbursementVoucherPayCard.qa.spec.ts | WEB; TYPE_WEB |
| 3.4 | R8/R10/R11/R14 | All 1.x/2.x as original graph | apps/web/src/features/tax/WithholdingPage.spec.ts | WEB; TYPE_WEB |
| 3.5 | R3/R10/R14/R15–R21 | 3.1–3.4/3.6 | e2e/journeys/e-wht-payment.journey.spec.ts (proposed); e2e/journeys/withholding-forms.journey.spec.ts | BROWSER at 390/1280/~1556; photos and measured buttons |
| 3.6 | R11/R16–R21 | All 1.x/2.x as original graph | apps/web/src/features/expenses/expense-withholding-ux.spec.ts; apps/web/src/features/web-core-workspace/settings-menu.logic.spec.ts | WEB; TYPE_WEB |
| 4.1 | R3/R5/R12 | All 1.x/2.x as original graph | apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts; apps/api/src/modules/line-ai/application/use-cases/erp-tax-tools.use-case.spec.ts | API; TYPE_API |
| 4.2 | R3/R12 | All 1.x/2.x as original graph | apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts | API; TYPE_API |
| 4.3 | R11/R13 | All 1.x/2.x; reuse prior trust/money number fix | apps/api/src/modules/line-ai/application/use-cases/erp-tax-tools.use-case.spec.ts; apps/ai-gateway/src/modules/line-ai/agents/tool-availability.spec.ts | API; GATEWAY; TYPE_API |
| 4.4 | R13 | MC2; Q4 answered 2026-11-04 | apps/ai-gateway/src/modules/line-ai/agents/agent-tools.registry.spec.ts; apps/ai-gateway/src/modules/line-ai/agents/approved-knowledge.spec.ts; apps/ai-gateway/src/modules/line-ai/domain/logic/line-ai-scope-policy.logic.spec.ts; apps/web/src/features/user-guide/user-guide.content.spec.ts | GATEWAY; WEB; TYPE_WEB |
| 4.5 | R13/R15 | 4.4; existing whole-chain gate | Existing W00 regression only; scripts/line-ai-whole-chain-acceptance.catalog.mjs | Existing whole-chain + manifest commands; no new unregistered API assertions |
| Phase 5 | R14/R15 | All existing gates, rollback rehearsal, original owner release instruction | e2e/journeys/withholding-forms.journey.spec.ts; signed release results | Mandatory runbook UAT/READY/Production ids; signed result and customer OPEN |

API registration checked locally on 2026-10-26 using `grep -c "<file>" apps/api/package.json`; counts below are not test execution. Existing manifest regression is not package-listed and gets no new test case; no package.json edit.

| API file (relative to apps/api) | grep count |
|---|---|
| `src/common/pipes/body-validation-coverage.spec.ts` | 1 |
| `src/modules/expenses/application/use-cases/expense-draft-amount-validation.use-case.spec.ts` | 1 |
| `src/modules/expenses/application/use-cases/record-expense-payment.use-case.spec.ts` | 1 |
| `src/modules/expenses/application/use-cases/substitute-receipt-policy.use-case.spec.ts` | 1 |
| `src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts` | 2 |
| `src/modules/expenses/domain/logic/expense-export.logic.spec.ts` | 1 |
| `src/modules/expenses/domain/logic/expense-status.logic.spec.ts` | 2 |
| `src/modules/expenses/infrastructure/prisma-expense.repository.atomic-confirm.spec.ts` | 2 |
| `src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts` | 1 |
| `src/modules/expenses/infrastructure/prisma-expense.repository.substitute-payment.spec.ts` | 1 |
| `src/modules/expenses/infrastructure/prisma-expense.repository.void.spec.ts` | 1 |
| `src/modules/expenses/presentation/http/expense.dtos.spec.ts` | 1 |
| `src/modules/line-ai/application/use-cases/erp-tax-tools.use-case.spec.ts` | 3 |
| `src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` | 2 |
| `src/modules/tax/application/use-cases/generate-tax-filing-package.use-case.spec.ts` | 2 |
| `src/modules/tax/application/use-cases/sync-tax-events-wht-form.use-case.spec.ts` | 1 |
| `src/modules/tax/domain/logic/tax-period.logic.spec.ts` | 1 |
| `src/modules/tax/infrastructure/repositories/prisma-tax.repository.spec.ts` | 1 |
| `src/modules/tax/presentation/http/tax.controller.spec.ts` | 2 |
