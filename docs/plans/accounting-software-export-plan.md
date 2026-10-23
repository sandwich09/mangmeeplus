# Accounting Software Export Plan

Status: READY (docs-first) — reviewed 3 rounds + focused blocker checks 2026-10-24, no HIGH open (implementation still starts after accountant-export cleanup plan Phase 1, see the plan)
Spec: `docs/specs/accounting-software-export-spec.md`
Memory: `docs/agent-memory/accountant-exports.md`
Baseline: main 6c54ba208 (2026-10-23)
Depends on: `docs/plans/accountant-export-cleanup-plan.md` Phase 1 (label map ใน contracts, `AccountantPackageDto` ที่มี `page`/`pageSize`, `withholdingFormFor`, แผ่น `เกี่ยวกับไฟล์นี้`, `advancedBy`, วันที่จ่ายจากแถวการจ่าย)
หลักการ: ponytail full — ใช้ `readPackageRows`/`buildWorkbook`/ประตูสิทธิ์/helper หัก ณ ที่จ่ายเดิม, ตารางใหม่ตารางเดียว, ไม่มี dependency ใหม่, ไม่มี feature switch (ตัวเลือก FlowAccount ใส่ในโค้ดเมื่อผ่านประตูเท่านั้น)

## 0. Must close before coding

### Blockers — after the focused review and re-check (2026-10-24)

Focused checks (Codex, ultra, 2026-10-24) **closed R3-F1, R3-F2, R3-F3 and RC-F1**. The last focused check found one new HIGH, **RC-F2**, in the accountant-export cleanup plan §1.4 only; its fix is designed below and **needs review before cleanup Phase 1.4** (and 1.5, which follows it) starts. No further focused check is scheduled for the export documents. RC-F2 does not touch the accounting-software export documents, which have no HIGH open. Phase S and cleanup Phase 1.1–1.3 can start.

| # | State | Owner doc | Failing scenario | Designed fix | Gate |
|---|---|---|---|---|---|
| R3-F1 (security, current code) | **CLOSED** by the focused review 2026-10-24 — the scoped load (`apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts:1111`, `where: { id, companyId, ...branchScopeWhere(scopes) }`) plus the detail-read rule rejects cross-branch access before any attachment read or PDF queuing, and keeps uploader-own access | `accountant-export-cleanup-spec.md` B26; plan Phase S | A user restricted to branch A, holding `expense.ocr.request` or `expense.review`, calls `POST /expenses/<branch-B draft id>/extraction-request`; `ExpenseExtractionUseCase.extract` loads the draft by company only (`apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts:92`), reads the attachment and returns the recognised `fields` (`:216`) | Load through the same scoped read as the expense detail (`findByIdWithRelations(companyId, id, …, ctx.scopes)` + `isBranchInScope` + the own/related/all read rule of `GetExpenseUseCase`, `expense-draft.use-case.ts:222-240`) before any attachment read, provider admission or PDF queuing; out of scope → the same `NotFoundException` as a missing id + an audit outcome; regression in the registered `expense-extraction.use-case.spec.ts` | None left — **Phase S can ship first, on its own** |
| R3-F2 | **CLOSED** by the focused re-check 2026-10-24 | `accounting-software-export-spec.md` R2/R5, column 16, `vat_not_representable`, AC-14/AC-15; its plan 1.3–1.4 | (a) Fixed in round 3: a `V7` line (`CLAIMABLE`) and an `ND` line (`NONDEDUCTIBLE_EXPENSE`, `apps/api/src/modules/tax/domain/tax-code-template.catalog.ts:47-48`) of 100 + 7 each in one account merged into one 200 + 14 row labelled claimable. (b) **Found by the focused review:** the round-3 design let the line's `CLAIMABLE` snapshot win over the document. A reviewer who later denies VAT for personal use (`decideInputVat` writes `inputVatClaimStatus: input.toStatus` at `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts:644`; test `prisma-expense.repository.tax-snapshot.spec.ts:541` `{ toStatus: 'NON_CLAIMABLE', reason: 'ใช้ส่วนตัว' }`) leaves the line snapshot `CLAIMABLE`, so the export would label the 7.00 usable and could send it to FlowAccount, while the ledger and the tax sync both drop it | **Effective claimability = the current document gate AND the line restriction; neither side can lift the other.** Document gate = the one the ledger and the sync already use: `inputVatClaimStatus === 'CLAIMABLE' && taxEvidenceStatus === 'USABLE_FOR_TAX'` (`apps/api/src/modules/ledger/domain/logic/posting-engine.logic.ts:298-299`, `apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts:139`). Line restriction, only when `taxComponentsJson` is set: `claimabilitySnapshot` and the line evidence review `taxEvidenceReviewStatus` (null counts as `REVIEW_REQUIRED`, `prisma-expense.repository.ts:345`; sync drops non-`VERIFIED` at `sync-tax-events.use-case.ts:148`). Label = the most restrictive result: `ใช้ไม่ได้` (document `NON_CLAIMABLE`; evidence `SUPPORTING_ONLY`/`NOT_TAX_EVIDENCE`; line `NONDEDUCTIBLE_*`; line review `REJECTED`) › `รอตรวจสอบ` (document or evidence `NEEDS_REVIEW`; line `PENDING_EVIDENCE`; line review `DRAFT`/`REVIEW_REQUIRED`) › `ใช้ได้บางส่วน` (line `PARTIAL`) › `ใช้ได้ตามเงื่อนไข`; no VAT → `ไม่มี VAT`. One pure function feeds grouping, the label and `flowAccountEligibility`. Fixtures: V7 + ND → two rows; V7 line, document `CLAIMABLE` then `NON_CLAIMABLE` 'ใช้ส่วนตัว' → `ใช้ไม่ได้` and FlowAccount excluded; back to `CLAIMABLE` → `ใช้ได้ตามเงื่อนไข`; document `CLAIMABLE` + evidence `NEEDS_REVIEW` → `รอตรวจสอบ`; document `CLAIMABLE` + `ND` line → `ใช้ไม่ได้` | None left |
| R3-F3 | **CLOSED** by the focused re-check 2026-10-24 (pagination follow-up: RC-F1) | `accountant-export-cleanup-spec.md` §5.3, AC-5; its plan 1.4 | (a) Fixed in round 3: a filing line saved before payment keys existed (no `payment[13]`), or an aggregate key `payment:p1` later split into `payment:p1:line:<id>`, found no snapshot by exact key. (b) **Found by the focused review:** the round-3 design filtered live rows by the export's date range first and then swapped in filed snapshots. A September keyless filing covers every payment of its source, including a later October instalment (`apps/api/src/modules/tax/application/services/withholding-filing-state.ts:63`, `!key \|\| key === eventKey`), so the October file would show September's filed income again, dated September | **Resolve coverage before any date filter, then filter each row by its own authoritative date.** (1) Sources = `page.rows` after expansion ∪ expenses that pass the same scope and filters as the main sheet except the date, and have a line in a `FILED` filing whose `periodKey` is a month of the range. (2) Live projection for those sources **without** a date filter, and every `FILED` line of those sources. (3) Coverage with `filedLineCoversPayment` over the full sets. (4) Output each filed line once from `lineJson.payment`, kept only when its frozen date `payment[2]` (shop time zone, same rule as live rows) is in range; output an uncovered live row only when its payment date is in range; a covered live row is **never** output, even when its covering filed row is outside the range — the count of such rows in range goes to `เกี่ยวกับไฟล์นี้`. Fixtures: September keyless filing + October instalment → September file shows the filed row once; October file has neither that row nor a live October row, and the about sheet counts 1; a line filed for an October payment later re-dated to November (no in-range live payment, expense dated September) → still in the October file as `ยื่นแล้ว`, absent from November | None left for coverage; Phase 1.4 still waits on RC-F2 |
| RC-F1 (pagination) | **CLOSED** by the last focused check 2026-10-24 | `accountant-export-cleanup-spec.md` §5.3 step 0, sheet 3, sheet 5, AC-5; its plan 1.4 | **Found by the focused re-check:** the filing-source union (`periodKey: { in: monthsOf(range) }`) ignored explicit pagination. Today an explicitly paged workbook request drops the expansion list (`apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts:372`, `extraIds.length = 0`) and the repository pages rows with `skip: (page - 1) * pageSize` (`apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts:4779`). With two October filed expenses A and B and `pageSize: 1`, both pages would add A + B, and the withholding amounts repeat when the pages are combined | Filing-source candidates join the **same expansion list** as payments, paid vouchers and handoffs (`extraIds`, `expense-evidence.use-case.ts:369-371`), so the existing rule at `:372` drops them for an explicitly paged request. Each page then reads filed lines only for its own `page.rows`, which the repository pages in a stable order (`orderBy: [{ [dateField]: 'desc' }, { id: 'desc' }]`, `prisma-expense.repository.ts:4778`), so each filed line lands on at most one page. The unpaged workbook and the ZIP read the whole selection (`expense-evidence.use-case.ts:325`) and keep the full union. A paged file says so in `เกี่ยวกับไฟล์นี้`: `หน้า` = `หน้าที่ N — การจ่ายและหัก ณ ที่จ่ายมีเฉพาะรายการในหน้านี้`. Regression: A and B filed in October, `pageSize: 1` → page 1 has only A's filed row, page 2 only B's, the two pages together list each once; the unpaged file lists A and B once | None left |
| RC-F2 (selection intersect) | **Designed, needs review before Phase 1.4** | `accountant-export-cleanup-spec.md` §5.3 step 0, AC-5, §14; its plan 1.4 | **Found by the last focused check:** the RC-F1 design loads filing-source candidates through the expansion loader (`expense-evidence.use-case.ts:373-376`), which replaces the selection with `expenseIds: extraIds.slice(offset, offset + 500)` (`:375`). A request that selects only A (`expenseIds: ['A']`), unpaged or ZIP, would then also carry unselected expense B's filed withholding rows and attachments; an explicitly empty selection (`[]`, which matches nothing — `packages/contracts/src/expenses.ts:1663`) could also return B | **Intersect filing-source candidates with `request.expenseIds` whenever it is present, before they join `extraIds`:** the filing query adds `sourceId: { in: request.expenseIds }`; an empty selection skips the query, so it adds nothing. This matches the other expansion sources, which already honour the selection (payments through `expenseWhere`, vouchers through `lines.some.expenseId`, handoffs through `sourcePaymentId`, `expense-evidence.use-case.ts:350`, `:359`, `:367`). Regressions for the workbook and the ZIP: A and B both filed in the month — selection `['A']` → only A's rows and files; selection `[]` → no rows, no B; no selection → A and B once | Review before cleanup plan Phase 1.4 starts |

## ลำดับ

Phase 0 (ขนานได้ เมื่อเจ้าของตอบ Q2) ─┐
Phase 1 (mapping + สมุดรายวันซื้อ) ────┴→ Phase 2 (FlowAccount) → Phase 3 ปิดงาน
PEAK / Express: ไม่อยู่ในแผนจนกว่าจะได้แม่แบบจริง (Q3) — เมื่อได้ ให้เขียนตารางคอลัมน์ลงสเปกก่อน แล้วทำเป็น preset ใน `accounting-software-export.logic.ts` แบบเดียวกับ FlowAccount

---

## Phase 0 — ประตูตรวจ FlowAccount ของจริง (ไม่มีโค้ด; controller + เจ้าของ)

ทำเมื่อเจ้าของตอบ Q2 ว่าได้ ใช้ Claude in Chrome แบบดูอย่างเดียว (หน่วยความจำ "FlowAccount is the owner's UX reference")

1. FlowAccount บริษัทของเจ้าของ › ค่าใช้จ่าย › นำเข้าบิลและใบเสร็จ › ดาวน์โหลดแม่แบบ (ขออนุญาตทุกครั้ง บอกชื่อไฟล์/ที่มา/ขนาด) — **ไม่กดนำเข้าในบริษัทจริง**
2. บันทึกใน memory: ชื่อแผ่น, หัวคอลัมน์ตามลำดับ, dropdown, ตัวเลือก "ภาษี" "วิธีการชำระ" "แบบฟอร์ม" "ประเภทเงินได้" ทุกข้อความ, คอลัมน์ "คำอธิบายประเภทเงินได้", มีคอลัมน์ยอด VAT/ยอดหักหรือไม่, รูปแบบวันที่ตัวอย่าง
3. นำเข้าไฟล์ทดลองมือเข้า **บริษัททดลอง** ของ FlowAccount ครบ 9 เอกสาร: (ก) สองบัญชี (ข) ผสม 7% กับยกเว้นในบัญชีเดียว (ค) ฐาน 300 VAT 21.01 (ง) หัก 3% ค่าบริการนิติบุคคล (จ) หักข้อ 6 อื่น ๆ พร้อมคำอธิบาย (ฉ) จ่ายด้วยบัตร ไม่มีหัก (ช) ผู้ขายไม่จด VAT (ซ) หักแต่ไม่ระบุวิธีการชำระ — คาดว่าถูกปฏิเสธ (ฌ) สองประเภทเงินได้ในเลขอ้างอิงเดียว — คาดว่าถูกปฏิเสธ — บันทึกผล: เซลล์วันที่อ่านได้ไหม, ผู้จำหน่ายใส่ชื่ออย่างเดียวได้ไหม, FA ปัด VAT รายบรรทัดหรือท้ายเอกสาร (เทียบ 21.01), การใช้ `ยกเว้นภาษี` แทน "ไม่มี VAT", ค่าวิธีการชำระที่รับ
4. ให้นักบัญชีของเจ้าของยืนยันวิธีบันทึก VAT ที่ใช้สิทธิไม่ได้ใน FlowAccount
5. แก้สเปก §7.4: ทุกแถว "ยังไม่ยืนยัน" → ยืนยันแล้ว/เปลี่ยน; ปรับตาราง exclude (`vat_not_representable`, `wht_not_representable`) ให้แคบลงถ้า FA มีคอลัมน์ยอด; ถ้าผู้จำหน่ายต้องเป็น "รหัส / ชื่อ" → เพิ่ม mapping ผู้จำหน่าย (ตารางแบบ §6 บนคู่ค้า) ในสเปกก่อนเขียนโค้ด

Exit: memory มีหัวคอลัมน์จริง + ผลนำเข้า 9 เอกสาร (แถวที่ควรเข้าเข้าได้ 0 แถวแดง)

---

## Phase 1 — รหัสบัญชีของสำนักงานบัญชี + สมุดรายวันซื้อ

### 1.1 Schema + contracts (หนึ่ง lane)

- `apps/api/prisma/schema.prisma`: model `ExpenseCategoryAccountantAccount` (สเปก §6) + back-relation ใน `Company` และ `ExpenseCategory`
- migration ใหม่ `apps/api/prisma/migrations/2026102<ts>_expense_category_accountant_account/migration.sql` (CREATE TABLE, UNIQUE (companyId, expenseCategoryId), INDEX companyId, FK cascade ×2) — timestamp หลัง `20261022100000_public_home_theme_setting`
- `packages/contracts/src/expenses.ts`: types สเปก §7.1 (`ACCOUNTING_SOFTWARE_EXPORT_PRESETS = ['purchase_journal']` ใน Phase 1), `ACCOUNTING_EXPORT_EXCLUSION_REASONS` + `ACCOUNTING_EXPORT_EXCLUSION_LABELS`, `PURCHASE_JOURNAL_COLUMNS` + ป้าย, `ExpenseCategorySummary.accountantAccount?`/`referencedOnly?`

Verify: `pnpm --filter @watchdog-bms/api prisma:validate`; `pnpm --filter @watchdog-bms/contracts build`; Postgres ในเครื่อง (:15432 ตามสูตร local stack) `prisma migrate deploy` สะอาด; `prisma generate` ใหม่ใน worktree

### 1.2 API mapping (หนึ่ง lane, ~5 รายการ)

- `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts`:
  - `listAllCategories` (:3966): หมวดตาม `selectExpenseCategoryScope` (:491) + **หมวดที่รายจ่าย/บรรทัดของร้านอ้างแต่ถูกซ่อน** (`referencedOnly: true`; คิวรี `expenseCategoryId` ที่ใช้จริงใน `expenseRecord`/`expenseLine` ของ `companyId`) + mapping ของร้าน
  - `upsertCategoryAccountantAccount(companyId, categoryId, input, userId)`: หมวดต้องอยู่ใน (scope ∪ ถูกอ้าง) ไม่งั้น `NotFoundException`; `deleteCategoryAccountantAccount`; `findCategoryAccountantAccounts(companyId, categoryIds)`
- `apps/api/src/modules/expenses/application/use-cases/expense-document.use-case.ts`: `SetExpenseCategoryAccountantAccountUseCase` / `ClearExpenseCategoryAccountantAccountUseCase` ข้าง `UpdateExpenseCategoryUseCase` (:421) + audit (LOW)
- `apps/api/src/modules/expenses/presentation/http/expense.dtos.ts`: `SetExpenseCategoryAccountantAccountDto` — trim; `@Length(1,20)` / `@Length(1,120)`; `@Matches(/^[^=+\-@\u0000-\u001F\u007F][^\u0000-\u001F\u007F]*$/)` ทั้งสองช่อง (ตัวแรกไม่ใช่สูตร **และไม่มีอักขระควบคุมทั้งค่า**)
- `expense.controller.ts` (`ExpenseCategoryController` :721): `@Put(':categoryId/accountant-account')`, `@Delete(':categoryId/accountant-account') @HttpCode(204)`, `@RequirePermissions('expense.category.manage')`
- `apps/api/src/modules/expenses/expenses.module.ts`: register

Tests:
- `src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts`: set/clear; หมวดร้านอื่น 404; หมวดกลางที่ร้านเห็นตั้งได้; หมวดกลางที่ซ่อนหลัง bootstrap แต่รายการร้านอ้าง → ตั้งได้และขึ้น `referencedOnly`; หมวดกลางที่ไม่เกี่ยว → 404; audit
- `src/modules/expenses/presentation/http/expense.dtos.spec.ts`: ยาวเกิน, ว่าง, ขึ้นต้น `=`, แท็บ/ขึ้นบรรทัดกลางค่า
- PostgreSQL จริง `src/modules/expenses/infrastructure/prisma-expense.repository.tax-snapshot.spec.ts` (ลงทะเบียนแล้ว): upsert สองครั้ง = แถวเดียว; ลบหมวด → mapping หาย; ร้าน A ไม่เห็นของร้าน B

Verify: สาม spec (`npx tsx --test …`; PG ตาม recipe) + api typecheck + lint

### 1.3 Logic สมุดรายวันซื้อ (หนึ่ง lane)

- ไฟล์ใหม่ `apps/api/src/modules/expenses/domain/logic/accounting-software-export.logic.ts`:
  - `groupExpenseLines(record, lines, mappingByCategory)` — กลุ่ม (บัญชี, การใช้ VAT, อัตรา VAT, **สิทธิภาษีซื้อที่มีผลของบรรทัด (R3-F2 — ปิดแล้ว §0)**: ฟังก์ชันบริสุทธิ์ `effectiveInputVatRight(record, line)` = ประตูเอกสารปัจจุบัน (`inputVatClaimStatus === 'CLAIMABLE' && taxEvidenceStatus === 'USABLE_FOR_TAX'`, แบบ `posting-engine.logic.ts:298-299`) **และ** ข้อจำกัดบรรทัดเมื่อ `taxComponentsJson` ไม่ว่าง (`claimabilitySnapshot` + `taxEvidenceReviewStatus ?? 'REVIEW_REQUIRED'`); ผลเข้มที่สุดชนะตามคอลัมน์ 16 ของสเปก; ใช้ค่าเดียวกันกับ key กลุ่ม ป้าย และ `flowAccountEligibility`, **หมวดเงินได้ + อัตราหักของบรรทัดเมื่อเป็นบรรทัดเก่าที่หักแยก**, หัก/ไม่หัก) R2 — แต่ละแถวมีชุดหักเดียว
  - `allocateToHeader(groups, header)` — R3 คงยอด VAT ที่บันทึก ส่วนต่างเข้าแถวมากสุดในกลุ่ม VAT เดียวกัน
  - `withholdingForGroups(record, lines, groups)` — R4: บรรทัดเก่า (`!whtInputJson && lines > 1`) → ฐาน/ยอดรวมของบรรทัดในแถว หมวด/อัตราของชุด; หักทั้งใบ → แถวมากสุด ฐาน `expenseWhtIncomeBase`, อัตรา `expenseWhtHeaderRate`; แบบ `withholdingFormFor`
  - `flowAccountEligibility(record, lines, payments)` — ตัวจำแนกบริสุทธิ์ (สเปก §16): คืนรายการเหตุผลจากตาราง §7.4 ที่รู้ได้โดยไม่ต้องมีผล Phase 0 (สกุล, รูปหัก, ภ.ง.ด.2, ประเภทผู้รับเงิน, ไม่มีเลขผู้เสียภาษี, หลายประเภทเงินได้ — ใช้รหัสหมวดของเราแทนตัวเลือก FA, การจ่าย 5 แบบ) + ตัวแทน VAT (VAT ที่บันทึก ≠ round2(อัตรา × มูลค่า) ต่อแถว)
  - `buildPurchaseJournalRows(records, …)` → คอลัมน์สเปก §7.3; ต่างสกุล → `excluded` (`foreign_currency`)
  - `buildPurchaseJournalWorkbook(rows, excluded, about)` → แผ่น `สมุดรายวันซื้อ` + `เกี่ยวกับไฟล์นี้` (มีรายการที่ไม่ได้ใส่); วันที่ style 4; เลขผู้เสียภาษี/สาขาเป็นข้อความ
- Tests ใน `src/modules/expenses/domain/logic/expense-export.logic.spec.ts` (ลงทะเบียนแล้ว; import โมดูลใหม่): AC-2, AC-3 (7% + ยกเว้น → 2 แถว), VAT 21.01 คงอยู่, VAT_INCLUDED, ค่าบริการเพิ่ม, ส่วนต่าง 0.01 ในกลุ่ม VAT, **ค่าเช่า 5% + ค่าบริการ 2% บัญชีและ VAT เดียวกัน → 2 แถว (fixture `expense-source.adapter.spec.ts:100-109`)**, **100+7 `V7` + 100+7 `ND` บัญชีเดียว → 2 แถว สิทธิต่างกัน (R3-F2)**, **(R3-F2) `V7` + เอกสาร `CLAIMABLE` → `NON_CLAIMABLE` 'ใช้ส่วนตัว' (แบบ `prisma-expense.repository.tax-snapshot.spec.ts:541`) → `ใช้ไม่ได้` + `vat_not_representable`; กลับเป็น `CLAIMABLE` → `ใช้ได้ตามเงื่อนไข`; หลักฐาน `NEEDS_REVIEW` → `รอตรวจสอบ`; เอกสาร `CLAIMABLE` + `ND` → `ใช้ไม่ได้`; ผลตรวจบรรทัด `REVIEW_REQUIRED` → `รอตรวจสอบ`**, บรรทัดหักกับไม่หักบัญชีเดียว → 2 แถว, ฐานกรอกเอง 270.50, `flowAccountEligibility` ทุกเหตุผล, หักแบบยอดเงิน → อัตรา `ยังไม่ระบุ`, `SEPARATE_PND2` → `ภ.ง.ด.2`, ต่างสกุล excluded, ไม่มี cuid/URL, เซลล์วันที่เป็น serial

Verify: spec + typecheck

### 1.4 Export use-case + endpoint (หนึ่ง lane)

- `apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts`: ยก `readPackageRows` (:317) เป็นฟังก์ชันระดับไฟล์ใช้ร่วม; `CreateAccountingSoftwareExportUseCase.execute(ctx, request)`:
  - `status` ว่าง → `CONFIRMED` (ก่อนตรวจ); ส่งมาไม่ใช่ `CONFIRMED` → `UnprocessableEntityException({ code: 'accounting_export_confirmed_only' })`
  - โหลดบรรทัด (`expenseLine.findMany` ด้วย `companyId` + ids: `expenseCategoryId`, `taxableAmount`, `vatAmount`, `vatRate`, `vatTreatment`, `whtAmount`, `whtRate`, `whtCategoryCode`, `chargeKind`, **`claimabilitySnapshot`, `taxEvidenceReviewStatus`, `externalTaxCodeSnapshot`, `taxTreatmentSnapshot`, `taxComponentsJson`** — schema.prisma:2964-2986; หัวเอกสาร `inputVatClaimStatus` + `taxEvidenceStatus` **อ่านค่าปัจจุบัน** ในคิวรีเดียวกับรายการ ไม่ใช้ค่าที่จำไว้), mapping, `whtIncomeCategory` (catalog กลาง), ประเภทคู่ค้าเมื่อไม่มี snapshot, การจ่าย `RECORDED` (วันที่จ่ายล่าสุด/สถานะ)
  - คืน `AccountingSoftwareExportResult`; audit `expense.accounting_software_export.create` (MEDIUM) `{ preset, documentCount, rowCount, excludedCount, excludedByReason, flowAccountIneligibleByReason }` — ค่าสุดท้ายจาก `flowAccountEligibility` ทุกเอกสาร (ใช้ตัดสินลงทุน Phase 2)
- `expense.dtos.ts`: `AccountingSoftwareExportDto extends AccountantPackageDto { @IsIn(ACCOUNTING_SOFTWARE_EXPORT_PRESETS) preset }`
- `expense.controller.ts`: `@Post('accounting-software-export') @HttpCode(200) @RequirePermissions('expense.export')`
- `expenses.module.ts`: register
- Tests `expense-document.use-case.spec.ts`: status ว่าง (หน้ารายการ) ผ่าน; `VOIDED` 422; ไม่มี `expense.export`/`expense.read` 403; สาขานอกขอบเขต 403; 0 รายการ `files: []`; ทุกเอกสารต่างสกุล → `files: []` + `excluded`; `unmappedCategories`; audit

Verify: spec + api typecheck + lint

### 1.5 เว็บ (หนึ่ง lane, ~5 รายการ)

- `apps/web/src/features/expenses/expenses.api.ts`: `setCategoryAccountantAccount`, `clearCategoryAccountantAccount`, `createAccountingSoftwareExport`, ดาวน์โหลดหลายไฟล์ต่อเนื่อง (`downloadBlob` เดิม)
- `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx` `CategoryManagePanel`: สองช่อง + ส่วน `หมวดเก่าที่ยังมีรายการ` + T6/T7
- `apps/web/src/features/expenses/ExpensesPages.tsx` dialog: `รูปแบบไฟล์` (`useMenuFilterState('expenses.export.format')`), T1/T4/T9/T10/T11 + `ดูรายการ`
- `ExpensesWorkspacePanels.tsx` การ์ดส่งออก: select เดียวกัน + T8 + T11
- `apps/web/src/common/i18n/workspace-dictionary.ts`: คำทั้งหมดในสเปก §10.3 (th + en)
- Tests: `CategoryManagePanel.spec.ts`, `ExpenseList.rendered.spec.ts`, `EvidencePanel.qa.spec.ts`

Verify: `pnpm --filter @watchdog-bms/web typecheck && pnpm --filter @watchdog-bms/web test`

### 1.6 E2E + หลักฐานหน้าจอ (thai-ux-standard.md §7)

- `e2e/journeys/evidence-and-settings.journey.spec.ts`: ใส่รหัสบัญชีหนึ่งหมวด → รีเฟรชยังอยู่ → ส่งออกสมุดรายวันซื้อ → unzip xlsx ตรวจหัว + ผลรวมมูลค่า/VAT = ผลรวมหัวเอกสาร; ล้างรหัสคืนตอนจบ
- `e2e/expenses.spec.ts` EXP-EXPORT: combobox `รูปแบบไฟล์` คงค่าหลังปิด/เปิด; body `preset`
- controller: ภาพ 390, 1280, ~1,556 px ของหน้าหมวดหมู่ dialog และการ์ด; วัดปุ่ม; กดผ่านรวมหนึ่งทางผิด; W00 spec ผ่านไม่ regenerate

---

## Phase 2 — FlowAccount (หลัง Phase 0 ผ่านเท่านั้น)

### 2.1 Logic

- `accounting-software-export.logic.ts`: `buildFlowAccountRows` ตามสเปก §7.4 (หัวคอลัมน์จาก memory Phase 0); `flowAccountVatValue(group)`; `flowAccountExpectedVat(groups)` ตามวิธีปัดที่ Phase 0 พบ → เทียบยอด VAT ที่บันทึก; `flowAccountPayment(record, payments)` (คืนวิธี+วันที่คู่กัน หรือว่างทั้งคู่; `paymentNotExported` เฉพาะเอกสารไม่มีหักที่จ่ายแล้ว/บางส่วน; เอกสารมีหักที่ส่งคู่ไม่ได้ → exclude `wht_unpaid`/`wht_partly_paid`/`wht_paid_in_several_payments`/`wht_paid_date_unconfirmed`/`wht_payment_method_not_supported`); `flowAccountWithholding(...)` (สามช่อง + คำอธิบาย; ตัวเลือก FA ต่างกันในเอกสารเดียว → `wht_mixed_income_types`; อื่น ๆ ตามตาราง §7.4) — ใช้ `flowAccountEligibility` จาก Phase 1 เป็นฐาน แล้วแทนตัวแทน VAT/หมวดด้วยกติกาจริงจาก Phase 0; `uniqueFlowAccountReference(records)`; `splitFlowAccountFiles(rows, 500)` (ไม่แยกเอกสาร); ตาราง `WHT_INCOME_CATEGORY_TO_FLOWACCOUNT` + ธง `requiresDescription` ใน contracts จากตัวเลือกจริง
- Tests ใน `expense-export.logic.spec.ts`: ทุกเหตุผล exclude ในสเปก §7.4 (รวมสองบัญชีคนละประเภทเงินได้ในเอกสารเดียว, หักแต่จ่ายด้วยบัตร); ทุกกรณี `paymentNotExported` และไม่มีกรณีเอกสารไม่มีหักที่ยังไม่จ่าย; ไม่มีเอกสารมีหักที่ไม่มีวิธีการชำระ; ไม่มีแถวใดมีวันที่ชำระโดยไม่มีวิธี; คำอธิบายประเภทเงินได้ข้อ 6/4(ข)(2.5)/4(ข)(1.3); เลขอ้างอิงซ้ำสองผู้ขาย; 501 แถว → 2 ไฟล์ไม่แยกเอกสาร; ภ.ง.ด.2 excluded

### 2.2 เปิดตัวเลือก

- contracts: `ACCOUNTING_SOFTWARE_EXPORT_PRESETS` + `'flowaccount'`; use-case: หมวดที่ใช้ในช่วงนี้ไม่ map → 422 `accounting_export_accounts_unmapped`; เว็บ: ตัวเลือก `FlowAccount`, T2/T3/T11/T12
- Tests: use-case 422; เว็บ T3 ทั้งแบบมี/ไม่มี `expense.category.manage`; T12

### 2.3 ตรวจของจริง

- ดาวน์โหลดจาก local stack (ข้อมูล AC-2/AC-3/AC-5 + ใบไม่มี VAT) → นำเข้า FlowAccount บริษัททดลอง → 0 แถวแดง VAT/หักตรงทุกสตางค์ (AC-8) — บันทึกภาพ/ผลใน memory
- การตัดสินลงทุน Phase 2 ใช้ `flowAccountIneligibleByReason` จาก audit ของ Phase 1 (มีตั้งแต่ Phase 1.4) — ไม่ต้องรอ Phase 2 เพื่อวัด

---

## Phase 3 — ปิดงาน

- memory: ผลคำสั่งจริงทุกขั้น, ผล Phase 0, ภาพหน้าจอ
- release note: "ส่งออกสมุดรายวันซื้อแยกตามรหัสบัญชีของสำนักงานบัญชีได้แล้ว" (+ FlowAccount เมื่อ Phase 2 ออก)
- ไม่เปิด PR/ไม่เรียก Actions; push ตรงหลังตรวจในเครื่อง; รอคำสั่งก่อน UAT/Production (runbook)

## การตัดสินใจที่ล็อกแล้ว

1. รหัสบัญชีของสำนักงานบัญชีเก็บแยกตาราง ต่อร้าน ต่อหมวด; ตั้งได้ทั้งหมวดที่ร้านเห็นและหมวดที่รายการของร้านอ้าง
2. หนึ่งแถว = เอกสาร × บัญชี × การใช้ VAT; คงยอดที่บันทึกทุกตัว (VAT บนใบ ฐานหัก) และผลรวมเท่าหัวเอกสาร
3. ไฟล์นำเข้าใส่เฉพาะรายการยืนยันแล้ว (status ว่าง = ยืนยันแล้ว) และเงินบาท
4. รูปแบบปลายทางแทนข้อเท็จจริงไม่ได้ → ไม่ใส่และบอกเหตุผลบนหน้าจอ ไม่ส่งข้อมูลผิดเงียบ ๆ
5. สมุดรายวันซื้อก่อน; FlowAccount หลังประตูตรวจ; PEAK และ Express (มีโปรแกรมเสริมนำเข้า) รอแม่แบบจริง
6. ไม่มีคีย์ entitlement ใหม่ (คำแนะนำ Q1) — ถ้าเจ้าของจำกัดแพ็ก ต้องเพิ่มคีย์ + regenerate W00 + whole-chain ก่อนปล่อย
7. ไม่มี API integration และไม่ทำ CSV ในรอบนี้
