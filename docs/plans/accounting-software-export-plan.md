# Accounting Software Export Plan

Status: DRAFT — sold-feature ceiling and traceability updated 2026-10-26; controller checked 2026-11-04; FlowAccount Phase 0 still required; Re-anchored to develop e7c422802 on 2026-11-04
Owner: Expenses documents lane (controller review)
Related: `docs/specs/accounting-software-export-spec.md`, `docs/plans/accountant-export-cleanup-plan.md`, `docs/agent-memory/accountant-exports.md`
Baseline: develop `e7c4228026eec3c696fa76986420d2c97cb26676`, re-read 2026-11-04 in this worktree; supersedes citation baseline `0f938a361` (2026-10-26).
Depends on: `docs/plans/accountant-export-cleanup-plan.md` Phase 1 (label map ใน contracts, `AccountantPackageDto` ที่มี `page`/`pageSize`, `withholdingFormFor`, แผ่น `เกี่ยวกับไฟล์นี้`, `advancedBy`, วันที่จ่ายจากแถวการจ่าย)
หลักการ: ponytail full — ใช้ `readPackageRows`/`buildWorkbook`/ประตูสิทธิ์/helper หัก ณ ที่จ่ายเดิม, ตารางใหม่ตารางเดียว, ไม่มี dependency ใหม่, ไม่มี feature switch (ตัวเลือก FlowAccount ใส่ในโค้ดเมื่อผ่านประตูเท่านั้น)

## 0. Accepted design and implementation boundary

The 2026-10-24 R3-F2 design review (document VAT decision AND line restriction) is retained; it is not an implementation claim. Cleanup RC-F2 is a current co-voucher selection leak, redesigned 2026-10-26; design accepted by controller 2026-11-04, implementation pending. See `docs/specs/accountant-export-cleanup-spec.md` R8 and plan 0.1/1.2/1.4. This export uses the scoped `readPackageRows` path, not raw filing/voucher expansion IDs; do not reintroduce a union after the load.

**Sold scope:** starter expense screens and their recorded facts only (`packages/contracts/src/menu-entitlements.ts:432-450`, `:496-501`). No income–expense ledger, internal posting/JV columns, bank reconciliation, procurement, CRM, inventory, sales documents, reports, VAT/ภ.พ.30 workspace or shop LINE OA. Reading expense category codes and existing VAT/WHT snapshots is allowed; do not require ledger enrollment, a ledger account lookup or a tax-workspace permission. No new feature/permission key or environment feature switch.

This round edits documents only. External vendor/legal research below is retained from the dated previous research and has not been re-opened here (no network in this brief). FlowAccount still waits for the real template/import proof in Phase 0; no new claim of vendor compatibility is made.

## Re-anchor delta and path coverage (R6/R8/R12/R14/R16/R17)

The spec §0.1–0.2 records current findings/commits. Preserve the accepted RC-F2 dependency and cleanup **0.2** commercial guard. `8c112ea70` already changed row/month semantics for unusual dates (`expense-export.logic.ts:148`, `prisma-expense.repository.ts:561-567`); 1.3/1.4 adapt tests, not that predicate. Existing free drafts, welcome/advisor, human-history modal and delivered-confirmation suppression need no implementation here. Mapping/output requirements are paid-only; R12/R14/R16/R17 also prove free denial. All format changes keep free dialogs hidden and the model-free LINE boundary intact.

## ลำดับ

Phase 0 (ขนานได้ เมื่อเจ้าของตอบ Q2) ─┐
Phase 1 (mapping + สมุดรายวันซื้อ) ────┴→ Phase 2 (FlowAccount) → Phase 3 ปิดงาน
PEAK / Express: ไม่อยู่ในแผนจนกว่าจะได้แม่แบบจริง (Q3) — เมื่อได้ ให้เขียนตารางคอลัมน์ลงสเปกก่อน แล้วทำเป็น preset ใน `accounting-software-export.logic.ts` แบบเดียวกับ FlowAccount

---

## Phase 0 — R13: ประตูตรวจ FlowAccount ของจริง (ไม่มีโค้ด; controller + เจ้าของ)

ทำเมื่อเจ้าของตอบ Q2 ว่าได้ ใช้ช่องทางที่เจ้าของอนุญาต: บริษัทจริงอ่านแม่แบบเท่านั้น; บริษัททดลองจึงทดสอบนำเข้า

1. FlowAccount บริษัทของเจ้าของ › ค่าใช้จ่าย › นำเข้าบิลและใบเสร็จ › ดาวน์โหลดแม่แบบ (บันทึกชื่อไฟล์/ที่มา/ขนาดภายใต้สิทธิ์ที่เจ้าของให้ใน Q2; ไม่ถามซ้ำเมื่อครอบคลุมแล้ว) — **ไม่กดนำเข้าในบริษัทจริง**
2. บันทึกใน memory: ชื่อแผ่น, หัวคอลัมน์ตามลำดับ, dropdown, ตัวเลือก "ภาษี" "วิธีการชำระ" "แบบฟอร์ม" "ประเภทเงินได้" ทุกข้อความ, คอลัมน์ "คำอธิบายประเภทเงินได้", มีคอลัมน์ยอด VAT/ยอดหักหรือไม่, รูปแบบวันที่ตัวอย่าง
3. นำเข้าไฟล์ทดลองมือเข้า **บริษัททดลอง** ของ FlowAccount ครบ 9 เอกสาร: (ก) สองบัญชี (ข) ผสม 7% กับยกเว้นในบัญชีเดียว (ค) ฐาน 300 VAT 21.01 (ง) หัก 3% ค่าบริการนิติบุคคล (จ) หักข้อ 6 อื่น ๆ พร้อมคำอธิบาย (ฉ) จ่ายด้วยบัตร ไม่มีหัก (ช) ผู้ขายไม่จด VAT (ซ) หักแต่ไม่ระบุวิธีการชำระ — คาดว่าถูกปฏิเสธ (ฌ) สองประเภทเงินได้ในเลขอ้างอิงเดียว — คาดว่าถูกปฏิเสธ — บันทึกผล: เซลล์วันที่อ่านได้ไหม, ผู้จำหน่ายใส่ชื่ออย่างเดียวได้ไหม, FA ปัด VAT รายบรรทัดหรือท้ายเอกสาร (เทียบ 21.01), การใช้ `ยกเว้นภาษี` แทน "ไม่มี VAT", ค่าวิธีการชำระที่รับ
4. ให้นักบัญชีของเจ้าของยืนยันวิธีบันทึก VAT ที่ใช้สิทธิไม่ได้ใน FlowAccount
5. แก้สเปก §7.4: ทุกแถว "ยังไม่ยืนยัน" → ยืนยันแล้ว/เปลี่ยน; ปรับตาราง exclude (`vat_not_representable`, `wht_not_representable`) ให้แคบลงถ้า FA มีคอลัมน์ยอด; ถ้าผู้จำหน่ายต้องเป็น "รหัส / ชื่อ" → เพิ่ม mapping ผู้จำหน่าย (ตารางแบบ §6 บนคู่ค้า) ในสเปกก่อนเขียนโค้ด

Exit: memory มีหัวคอลัมน์จริง + ผลนำเข้า 9 เอกสาร (แถวที่ควรเข้าเข้าได้ 0 แถวแดง)

---

## Phase 1 — รหัสบัญชีของสำนักงานบัญชี + สมุดรายวันซื้อ

### 1.1 Schema + contracts (R8/R11/R14; after cleanup Phase 1)

- `apps/api/prisma/schema.prisma`: model `ExpenseCategoryAccountantAccount` (สเปก §6) + back-relation ใน `Company` และ `ExpenseCategory`
- migration ใหม่ `apps/api/prisma/migrations/2026102<ts>_expense_category_accountant_account/migration.sql` (CREATE TABLE, UNIQUE (companyId, expenseCategoryId), INDEX companyId, FK cascade ×2) — เลือก timestamp ใหม่หลัง migration ล่าสุดใน checkout ตอน implementation; additive only
- `packages/contracts/src/expenses.ts`: types สเปก §7.1 (`ACCOUNTING_SOFTWARE_EXPORT_PRESETS = ['purchase_journal']` ใน Phase 1), `ACCOUNTING_EXPORT_EXCLUSION_REASONS` + `ACCOUNTING_EXPORT_EXCLUSION_LABELS`, `PURCHASE_JOURNAL_COLUMNS` + ป้าย, `ExpenseCategorySummary.accountantAccount?`/`referencedOnly?`

Verify: `pnpm --filter @watchdog-bms/api prisma:validate`; `pnpm --filter @watchdog-bms/contracts build`; Postgres ในเครื่อง (:15432 ตามสูตร local stack) `prisma migrate deploy` สะอาด; `prisma generate` ใหม่ใน worktree

### 1.2 API mapping (R11/R14; after 1.1)

- `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts`:
  - `listAllCategories` (:4060): หมวดตาม `selectExpenseCategoryScope` (:499) + **หมวดที่รายจ่าย/บรรทัดของร้านอ้างแต่ถูกซ่อน** (`referencedOnly: true`; คิวรี `expenseCategoryId` ที่ใช้จริงใน `expenseRecord`/`expenseLine` ของ `companyId`) + mapping ของร้าน
  - `upsertCategoryAccountantAccount(companyId, categoryId, input, userId)`: หมวดต้องอยู่ใน (scope ∪ ถูกอ้าง) ไม่งั้น `NotFoundException`; `deleteCategoryAccountantAccount`; `findCategoryAccountantAccounts(companyId, categoryIds)`
- `apps/api/src/modules/expenses/application/use-cases/expense-document.use-case.ts`: `SetExpenseCategoryAccountantAccountUseCase` / `ClearExpenseCategoryAccountantAccountUseCase` ข้าง `UpdateExpenseCategoryUseCase` (:421) + audit (LOW)
- `apps/api/src/modules/expenses/presentation/http/expense.dtos.ts`: `SetExpenseCategoryAccountantAccountDto` — trim; `@Length(1,20)` / `@Length(1,120)`; `@Matches(/^[^=+\-@\u0000-\u001F\u007F][^\u0000-\u001F\u007F]*$/)` ทั้งสองช่อง (ตัวแรกไม่ใช่สูตร **และไม่มีอักขระควบคุมทั้งค่า**)
- `expense.controller.ts` (`ExpenseCategoryController` :729): `@Put(':categoryId/accountant-account')`, `@Delete(':categoryId/accountant-account') @HttpCode(204)`, `@RequirePermissions('expense.category.manage')`
- `apps/api/src/modules/expenses/expenses.module.ts`: register

Tests:
- `src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts`: set/clear; หมวดร้านอื่น 404; `ledgerAccountCode` เดิมไม่ถูกเขียน; หมวดกลางที่ร้านเห็นตั้งได้; หมวดกลางที่ซ่อนหลัง bootstrap แต่รายการร้านอ้าง → ตั้งได้และขึ้น `referencedOnly`; หมวดกลางที่ไม่เกี่ยว → 404; audit
- `src/modules/expenses/presentation/http/expense.dtos.spec.ts`: ยาวเกิน, ว่าง, ขึ้นต้น `=`, แท็บ/ขึ้นบรรทัดกลางค่า
- PostgreSQL จริง `src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts` (ลงทะเบียนแล้ว; ใช้ harness :415-443; tax-snapshot spec เป็น mock): upsert สองครั้ง = แถวเดียว; ลบหมวด → mapping หาย; ร้าน A ไม่เห็นของร้าน B

Verify: สาม spec (V-DOC/V-DTO/V-PG ด้านล่าง; PG ตาม recipe) + api typecheck + lint

### 1.3 Logic สมุดรายวันซื้อ (R2–R7/R10/R15; after 1.1)

- ไฟล์ใหม่ `apps/api/src/modules/expenses/domain/logic/accounting-software-export.logic.ts`:
  - `groupExpenseLines(record, lines, mappingByCategory)` — กลุ่ม (บัญชี, การใช้ VAT, อัตรา VAT, **สิทธิภาษีซื้อที่มีผลของบรรทัด (R3-F2 — ปิดแล้ว §0)**: ฟังก์ชันบริสุทธิ์ `effectiveInputVatRight(record, line)` = ประตูเอกสารปัจจุบัน (`inputVatClaimStatus === 'CLAIMABLE' && taxEvidenceStatus === 'USABLE_FOR_TAX'`, แบบ `posting-engine.logic.ts:298-299`) **และ** ข้อจำกัดบรรทัดเมื่อ `taxComponentsJson` ไม่ว่าง (`claimabilitySnapshot` + `taxEvidenceReviewStatus ?? 'REVIEW_REQUIRED'`); ผลเข้มที่สุดชนะตามคอลัมน์ 16 ของสเปก; ใช้ค่าเดียวกันกับ key กลุ่ม ป้าย และ `flowAccountEligibility`, **หมวดเงินได้ + อัตราหักของบรรทัดเมื่อเป็นบรรทัดเก่าที่หักแยก**, หัก/ไม่หัก) R2 — แต่ละแถวมีชุดหักเดียว
  - `allocateToHeader(groups, header)` — R3 คงยอด VAT ที่บันทึก ส่วนต่างเข้าแถวมากสุดในกลุ่ม VAT เดียวกัน
  - `withholdingForGroups(record, lines, groups)` — R4: บรรทัดเก่า (`!whtInputJson && lines > 1`) → ฐาน/ยอดรวมของบรรทัดในแถว หมวด/อัตราของชุด; หักทั้งใบ → แถวมากสุด ฐาน `expenseWhtIncomeBase`, อัตรา `expenseWhtHeaderRate`; แบบ `withholdingFormFor`
  - `flowAccountEligibility(record, lines, payments)` — ตัวจำแนกบริสุทธิ์ (สเปก §16): คืนรายการเหตุผลจากตาราง §7.4 ที่รู้ได้โดยไม่ต้องมีผล Phase 0 (สกุล, รูปหัก, ภ.ง.ด.2, ประเภทผู้รับเงิน, ไม่มีเลขผู้เสียภาษี, หลายประเภทเงินได้ — ใช้รหัสหมวดของเราแทนตัวเลือก FA, การจ่าย 5 แบบ) + ตัวแทน VAT (VAT ที่บันทึก ≠ round2(อัตรา × มูลค่า) ต่อแถว)
  - `buildPurchaseJournalRows(records, …)` → คอลัมน์สเปก §7.3; ต่างสกุล → `excluded` (`foreign_currency`)
  - `buildPurchaseJournalWorkbook(rows, excluded, about)` → แผ่น `สมุดรายวันซื้อ` + `เกี่ยวกับไฟล์นี้` (มีรายการที่ไม่ได้ใส่); วันที่ style 4; เลขผู้เสียภาษี/สาขาเป็นข้อความ
- Tests ใน `src/modules/expenses/domain/logic/expense-export.logic.spec.ts` (ลงทะเบียนแล้ว; import โมดูลใหม่): AC-2, AC-3 (7% + ยกเว้น → 2 แถว), VAT 21.01 คงอยู่, VAT_INCLUDED, ค่าบริการเพิ่ม, ส่วนต่าง 0.01 ในกลุ่ม VAT, **ค่าเช่า 5% + ค่าบริการ 2% บัญชีและ VAT เดียวกัน → 2 แถว (fixture `expense-source.adapter.spec.ts:100-109`)**, **100+7 `V7` + 100+7 `ND` บัญชีเดียว → 2 แถว สิทธิต่างกัน (R3-F2)**, **(R3-F2) `V7` + เอกสาร `CLAIMABLE` → `NON_CLAIMABLE` 'ใช้ส่วนตัว' (แบบ `prisma-expense.repository.tax-snapshot.spec.ts:541`) → `ใช้ไม่ได้` + `vat_not_representable`; กลับเป็น `CLAIMABLE` → `ใช้ได้ตามเงื่อนไข`; หลักฐาน `NEEDS_REVIEW` → `รอตรวจสอบ`; เอกสาร `CLAIMABLE` + `ND` → `ใช้ไม่ได้`; ผลตรวจบรรทัด `REVIEW_REQUIRED` → `รอตรวจสอบ`**, บรรทัดหักกับไม่หักบัญชีเดียว → 2 แถว, ฐานกรอกเอง 270.50, `flowAccountEligibility` ทุกเหตุผล, หักแบบยอดเงิน → อัตรา `ยังไม่ระบุ`, `SEPARATE_PND2` → `ภ.ง.ด.2`, ต่างสกุล excluded, ไม่มี cuid/URL, เซลล์วันที่เป็น serial

Re-anchor tests in `src/modules/expenses/domain/logic/expense-export.logic.spec.ts`: **software export preserves document-month semantics without relaxing confirmed-only selection**. Retain existing date cases (`:119-137`); for eligible confirmed input use the stored date/month, while `NEEDS_REVIEW` still fails R1 in the use-case spec. Never revive the old implausible-as-unread rule. No change to tax/payment dates.

Verify: spec + typecheck

### 1.4 Export use-case + endpoint (R1/R6/R7/R8/R10/R14/R17; after 1.2–1.3 and cleanup 0.2)

- Reuse the guard already added by cleanup 0.2 when extracting `readPackageRows`; do not create a second free-policy resolver. Tests first in `src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts`: **software export rechecks free access before loading rows** (current free state + stale trial-era export permissions → 403/no rows/files; paid same-tenant/scope passes). Extend `src/modules/auth/auth.guard.spec.ts` **free draft mode denies both export routes and bundle parts** to the new endpoint; the existing POST allowlist must remain closed to it. No LINE export tool is added.
- `apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts`: ยก `readPackageRows` (:317) เป็นฟังก์ชันระดับไฟล์ใช้ร่วม; `CreateAccountingSoftwareExportUseCase.execute(ctx, request)`:
  - `status` ว่าง → `CONFIRMED` (ก่อนตรวจ); ส่งมาไม่ใช่ `CONFIRMED` → `UnprocessableEntityException({ code: 'accounting_export_confirmed_only' })`
  - โหลดบรรทัด (`expenseLine.findMany` ด้วย `companyId` + ids: `expenseCategoryId`, `taxableAmount`, `vatAmount`, `vatRate`, `vatTreatment`, `whtAmount`, `whtRate`, `whtCategoryCode`, `chargeKind`, **`claimabilitySnapshot`, `taxEvidenceReviewStatus`, `externalTaxCodeSnapshot`, `taxTreatmentSnapshot`, `taxComponentsJson`** — schema.prisma:2964-2986; หัวเอกสาร `inputVatClaimStatus` + `taxEvidenceStatus` **อ่านค่าปัจจุบัน** ในคิวรีเดียวกับรายการ ไม่ใช้ค่าที่จำไว้), mapping, `whtIncomeCategory` (catalog กลาง), ประเภทคู่ค้าเมื่อไม่มี snapshot, การจ่าย `RECORDED` (วันที่จ่ายล่าสุด/สถานะ)
  - คืน `AccountingSoftwareExportResult`; audit `expense.accounting_software_export.create` (MEDIUM) `{ preset, documentCount, rowCount, excludedCount, excludedByReason, flowAccountIneligibleByReason }` — ค่าสุดท้ายจาก `flowAccountEligibility` ทุกเอกสาร (ใช้ตัดสินลงทุน Phase 2)
- `expense.dtos.ts`: `AccountingSoftwareExportDto extends AccountantPackageDto { @IsIn(ACCOUNTING_SOFTWARE_EXPORT_PRESETS) preset }`
- `expense.controller.ts`: `@Post('accounting-software-export') @HttpCode(200) @RequirePermissions('expense.export')`
- `expenses.module.ts`: register
- Tests `expense-document.use-case.spec.ts`: status ว่าง (หน้ารายการ) ผ่าน; `VOIDED` 422; ไม่มี `expense.export`/`expense.read` 403; สาขานอกขอบเขต 403; 0 รายการ `files: []`; ทุกเอกสารต่างสกุล → `files: []` + `excluded`; `unmappedCategories`; audit

Verify: spec + api typecheck + lint

### 1.5 เว็บ (R12/R15/R17; after 1.4)

- `apps/web/src/features/expenses/expenses.api.ts`: `setCategoryAccountantAccount`, `clearCategoryAccountantAccount`, `createAccountingSoftwareExport`, ดาวน์โหลดหลายไฟล์ต่อเนื่อง (`downloadBlob` เดิม)
- `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx` `CategoryManagePanel`: สองช่อง `รหัสหมวดในไฟล์`/`ชื่อหมวดในไฟล์` + ส่วน `หมวดเก่าที่ยังมีรายการ` + T6/T7
- `apps/web/src/features/expenses/ExpensesPages.tsx` dialog: `รูปแบบไฟล์` (UI เรียก purchase_journal ว่า `ไฟล์แยกตามหมวด`; หัวในไฟล์คง `สมุดรายวันซื้อ`) (`useMenuFilterState('expenses.export.format')`), T1/T4/T9/T10/T11 + `ดูรายการ`
- `ExpensesWorkspacePanels.tsx` การ์ดส่งออก: select เดียวกัน + T8 + T11
- `apps/web/src/common/i18n/workspace-dictionary.ts`: คำทั้งหมดในสเปก §10.3 (th + en)
- Tests: `CategoryManagePanel.spec.ts`, `ExpenseList.rendered.spec.ts`, `EvidencePanel.qa.spec.ts`

Verify: `bash scripts/local-proof/tsc.sh web && pnpm --filter @watchdog-bms/web test`

### 1.6 E2E + หลักฐานหน้าจอ (R16/R17; after 1.5)

- `e2e/journeys/evidence-and-settings.journey.spec.ts`: extend **free shops cannot open either export at 390, 1280 and 1556** from cleanup with the new route/preset; no export controls/files on free web/LINE, stale links denied, draft/menu exit usable, paid company switch restores only permitted actions. Open/close existing activity history without losing export selection; do not change its projection.
- `e2e/journeys/evidence-and-settings.journey.spec.ts`: ใส่รหัสบัญชีหนึ่งหมวด → รีเฟรชยังอยู่ → ส่งออกสมุดรายวันซื้อ → unzip xlsx ตรวจหัว + ผลรวมมูลค่า/VAT = ผลรวมหัวเอกสาร; ล้างรหัสคืนตอนจบ
- `e2e/expenses.spec.ts` EXP-EXPORT: combobox `รูปแบบไฟล์` คงค่าหลังปิด/เปิด; body `preset`
- controller: ภาพ 390, 1280, ~1,556 px ของหน้าหมวดหมู่ dialog และการ์ด; วัดปุ่ม; กดผ่านรวมหนึ่งทางผิด; W00 spec ผ่านไม่ regenerate

---

## Phase 2 — FlowAccount (หลัง Phase 0 ผ่านเท่านั้น)

### 2.1 Logic (R9/R10/R13; after Phase 0 and Phase 1)

- `accounting-software-export.logic.ts`: `buildFlowAccountRows` ตามสเปก §7.4 (หัวคอลัมน์จาก memory Phase 0); `flowAccountVatValue(group)`; `flowAccountExpectedVat(groups)` ตามวิธีปัดที่ Phase 0 พบ → เทียบยอด VAT ที่บันทึก; `flowAccountPayment(record, payments)` (คืนวิธี+วันที่คู่กัน หรือว่างทั้งคู่; `paymentNotExported` เฉพาะเอกสารไม่มีหักที่จ่ายแล้ว/บางส่วน; เอกสารมีหักที่ส่งคู่ไม่ได้ → exclude `wht_unpaid`/`wht_partly_paid`/`wht_paid_in_several_payments`/`wht_paid_date_unconfirmed`/`wht_payment_method_not_supported`); `flowAccountWithholding(...)` (สามช่อง + คำอธิบาย; ตัวเลือก FA ต่างกันในเอกสารเดียว → `wht_mixed_income_types`; อื่น ๆ ตามตาราง §7.4) — ใช้ `flowAccountEligibility` จาก Phase 1 เป็นฐาน แล้วแทนตัวแทน VAT/หมวดด้วยกติกาจริงจาก Phase 0; `uniqueFlowAccountReference(records)`; `splitFlowAccountFiles(rows, 500)` (ไม่แยกเอกสาร); ตาราง `WHT_INCOME_CATEGORY_TO_FLOWACCOUNT` + ธง `requiresDescription` ใน contracts จากตัวเลือกจริง
- Tests ใน `expense-export.logic.spec.ts`: ทุกเหตุผล exclude ในสเปก §7.4 (รวมสองบัญชีคนละประเภทเงินได้ในเอกสารเดียว, หักแต่จ่ายด้วยบัตร); ทุกกรณี `paymentNotExported` และไม่มีกรณีเอกสารไม่มีหักที่ยังไม่จ่าย; ไม่มีเอกสารมีหักที่ไม่มีวิธีการชำระ; ไม่มีแถวใดมีวันที่ชำระโดยไม่มีวิธี; คำอธิบายประเภทเงินได้ข้อ 6/4(ข)(2.5)/4(ข)(1.3); เลขอ้างอิงซ้ำสองผู้ขาย; 501 แถว → 2 ไฟล์ไม่แยกเอกสาร; ภ.ง.ด.2 excluded

### 2.2 เปิดตัวเลือก (R8/R12/R13; after 2.1)

- contracts: `ACCOUNTING_SOFTWARE_EXPORT_PRESETS` + `'flowaccount'`; use-case: หมวดที่ใช้ในช่วงนี้ไม่ map → 422 `accounting_export_accounts_unmapped`; เว็บ: ตัวเลือก `FlowAccount`, T2/T3/T11/T12
- Tests: use-case 422; เว็บ T3 ทั้งแบบมี/ไม่มี `expense.category.manage`; T12

### 2.3 ตรวจของจริง (R13/R16; after 2.2)

- ดาวน์โหลดจาก local stack (ข้อมูล AC-2/AC-3/AC-5 + ใบไม่มี VAT) → นำเข้า FlowAccount บริษัททดลอง → 0 แถวแดง VAT/หักตรงทุกสตางค์ (AC-8) — บันทึกภาพ/ผลใน memory
- การตัดสินลงทุน Phase 2 ใช้ `flowAccountIneligibleByReason` จาก audit ของ Phase 1 (มีตั้งแต่ Phase 1.4) — ไม่ต้องรอ Phase 2 เพื่อวัด

---

## Phase 3 — R16: ปิดงาน

- memory: ผลคำสั่งจริงทุกขั้น, ผล Phase 0, ภาพหน้าจอ
- release note: "ส่งออกสมุดรายวันซื้อแยกตามรหัสบัญชีของสำนักงานบัญชีได้แล้ว" (+ FlowAccount เมื่อ Phase 2 ออก)
- รอบเอกสารนี้ไม่ commit/push หรือ deploy; release จริงรอคำสั่งและทำตาม runbook

## การตัดสินใจที่ล็อกแล้ว

1. รหัสบัญชีของสำนักงานบัญชีเก็บแยกตาราง ต่อร้าน ต่อหมวด; ตั้งได้ทั้งหมวดที่ร้านเห็นและหมวดที่รายการของร้านอ้าง
2. หนึ่งแถว = เอกสาร × บัญชี × การใช้ VAT; คงยอดที่บันทึกทุกตัว (VAT บนใบ ฐานหัก) และผลรวมเท่าหัวเอกสาร
3. ไฟล์นำเข้าใส่เฉพาะรายการยืนยันแล้ว (status ว่าง = ยืนยันแล้ว) และเงินบาท
4. รูปแบบปลายทางแทนข้อเท็จจริงไม่ได้ → ไม่ใส่และบอกเหตุผลบนหน้าจอ ไม่ส่งข้อมูลผิดเงียบ ๆ
5. สมุดรายวันซื้อก่อน; FlowAccount หลังประตูตรวจ; PEAK และ Express (มีโปรแกรมเสริมนำเข้า) รอแม่แบบจริง
6. ไม่มีคีย์ entitlement/permission ใหม่ ไม่มี ledger หรือ VAT workspace prerequisite (owner ceiling 2026-10-26); Q1 ไม่ต้องถามซ้ำ
7. ไม่มี API integration และไม่ทำ CSV ในรอบนี้

## Removal / dependency check

Removing cleanup E5 and posting columns does not block any step here. Phase 1 depends only on cleanup's scoped loader, payment/currency labels, workbook primitives, DTO and `withholdingFormFor`; `ExpenseCategory.ledgerAccountCode` and stored VAT fields are source facts, not a dependency on the ledger or VAT workspace. No new calls/imports into those modules are planned. `sync-tax-events` and its procurement callers retain their existing side effects; exports only read. The optional FlowAccount vendor mapping remains a Phase 0 finding to design first, not permission to build CRM.

## Execution / verification map

Test names are in spec Traceability. Write the money/tax/permission/mapping regressions first, then the smallest implementation. Approximately five steps per round: schema/mapping/logic/export/UI in Phase 1; 1.6 is the acceptance pass. All commands below are future gates, not results from this documents round.

| Step | Requirements | Depends on | Verification |
|---|---|---|---|
| 0 | R13 | owner Q2 access; no cleanup dependency | real template + nine import cases, evidence in memory, no production mutation |
| 1.1 | R8/R11/R14 | cleanup Phase 1 | V-PRISMA; additive migration on local DB; V-PG after repository is ready |
| 1.2 | R11/R14 | 1.1 | V-DOC + V-DTO + V-PG + API tsc |
| 1.3 | R2–R7/R10/R15 | 1.1 | V-LOGIC + API tsc |
| 1.4 | R1/R6/R7/R8/R10/R14/R17 | 1.2–1.3; cleanup 0.2 | V-AUTH + V-DOC + V-DTO + API tsc |
| 1.5 | R12/R15/R17 | 1.4 | CategoryManagePanel.spec.ts, ExpenseList.rendered.spec.ts, EvidencePanel.qa.spec.ts + web tsc |
| 1.6 | R16/R17 | 1.5 | V-BROWSER at 390/1280/~1556; V-W00; record actual measured buttons and failed-input journey |
| 2.1 | R9/R10/R13 | 0 and 1 | V-LOGIC + API tsc |
| 2.2 | R8/R12/R13 | 2.1 | V-DOC + named web specs + API/web tsc |
| 2.3 | R13/R16 | 2.2 | local download → authorized FlowAccount test company; compare all amounts |
| 3 | R16 | applicable acceptance rows | record commands/results/screenshots and remaining vendor limitations |

```sh
# V-AUTH
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/auth/auth.guard.spec.ts
# V-DOC
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts
# V-DTO
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/presentation/http/expense.dtos.spec.ts
# V-LOGIC
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/domain/logic/expense-export.logic.spec.ts
# V-PG — existing local DB gate; zero skipped mapping checks required
EXPENSE_PAYMENT_REQUIRE_POSTGRES=true pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts
# V-PRISMA — local isolated database only; migration SQL is additive
pnpm --filter @watchdog-bms/api exec prisma validate
pnpm --filter @watchdog-bms/api exec prisma generate
pnpm --filter @watchdog-bms/api exec prisma migrate deploy
bash scripts/local-proof/tsc.sh api
bash scripts/local-proof/tsc.sh web
# V-W00
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts
# V-BROWSER
pnpm exec playwright test e2e/journeys/evidence-and-settings.journey.spec.ts e2e/expenses.spec.ts
```

`grep -c` registration rechecked 2026-11-04: V-DOC 1, V-DTO 1, V-LOGIC 1, V-PG 1; no new API spec file or package.json change. See memory for the complete registry check.

W00 is an existing **manual check**, not a registered package test (`grep -c` = 0); do not add assertions or new test cases to that file. Its existing frozen-artifact comparison is ancillary evidence only. No package.json edits are authorized by this plan. New API regressions use the registered files in the spec Traceability table.

R17 LINE verification reuses cleanup V-LINE (**free export requests remain model-free with a menu exit**); no software-specific LINE parser. `free-expense-access.spec.ts` remains unregistered (0); add no new tests there.
