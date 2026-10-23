# Accountant Export Cleanup Plan

Status: DRAFT — blocked on: RC-F2 (selection intersect) review before Phase 1.4; Phase S and 1.1–1.3 can start. Review rounds 1–3 + focused blocker checks (last one 2026-10-24) applied
Spec: `docs/specs/accountant-export-cleanup-spec.md`
Memory: `docs/agent-memory/accountant-exports.md`
Baseline: main 6c54ba208 (2026-10-23)
Scope: ไฟล์ Excel/สารบัญ ZIP ให้นักบัญชี (Phase 1–2), สมุดรายรับ–รายจ่าย, ไฟล์ ภ.ง.ด. ให้ผู้ทำบัญชี และการตรวจเลขที่เอกสารฝั่ง LINE (Phase 3)
หลักการ: ponytail full — ใช้ builder/label map/permission gate/projection ภ.ง.ด. เดิม, ไม่มี migration, ไม่มี dependency ใหม่, ไม่มี feature switch, CSV/`indexRows`/manifest คงไบต์

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

## ลำดับที่บังคับ

**Phase S (ความปลอดภัย B26) ส่งก่อนทุกอย่าง แยกเดี่ยว — R3-F1 ปิดแล้วโดยรีวิวเฉพาะจุด 2026-10-24 เริ่มได้ทันที** → Phase 1 (API; ขั้น 1.4–1.5 รอรีวิว RC-F2 §0; 1.1–1.3 เริ่มได้) → Phase 2 (เว็บ + journey) → Phase 4 ปิดงาน; Phase 3 อิสระ ทำขนานกับ 2 ได้

---

## Phase S — แก้ช่องโหว่อ่านเอกสารข้ามสาขา (B26) — ส่งเดี่ยว

- `apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts:91-100`: แทน `this.repo.findById(ctx.companyId, expenseId)` ด้วยการโหลดแบบมีขอบเขตแบบเดียวกับหน้ารายละเอียด (`GetExpenseUseCase`, `expense-draft.use-case.ts:222-240`: `findByIdWithRelations(companyId, id, …, ctx.scopes)` + `isBranchInScope(ctx.scopes, expense.branchId)` + สิทธิ์อ่านทั้งหมด/ที่เกี่ยวข้อง/ของตัวเอง) **ก่อน** อ่าน attachment, ขออนุญาตใช้ผู้อ่าน (`admitCompanyOcr`) หรือเข้าคิว PDF (:119); นอกขอบเขต → `auditOutcome(ctx, expenseId, 'not_found')` + `NotFoundException` ข้อความเดียวกับ id ที่ไม่มี (ไม่บอกว่ามีอยู่)
- ตรวจผู้เรียกอื่นของ `extract`/`queueCaptureRead` ใน use-case เดียวกันว่าผ่านจุดนี้หมด
- Tests: `src/modules/expenses/application/use-cases/expense-extraction.use-case.spec.ts` (ลงทะเบียนแล้ว) — สาขา A + `expense.review` ขอร่างสาขา B → 404 และไม่มีการเรียก storage/ผู้อ่าน/คิว; สาขา B ผ่าน; ผู้ส่งเอกสารที่มีแค่ `expense.receipt.upload` ผ่านเฉพาะร่างของตัวเองในสาขาที่มีสิทธิ์; ผู้ใช้ไม่จำกัดสาขาผ่านเหมือนเดิม
- Verify: `cd apps/api && npx tsx --test src/modules/expenses/application/use-cases/expense-extraction.use-case.spec.ts` + `pnpm --filter @watchdog-bms/api typecheck` + lint; ส่งผ่านเส้นทาง hotfix ได้ (หน่วยความจำ "Prod hotfix path recipe") หลังเจ้าของสั่ง
แผนข้อ 13 เริ่มได้หลัง Phase 1 (ใช้ label map, `AccountantPackageDto`, `withholdingFormFor`, แผ่น `เกี่ยวกับไฟล์นี้`)

---

## Phase 1 — API

### 1.1 Contracts (หนึ่ง lane)

- `packages/contracts/src/expenses.ts`:
  - `ACCOUNTANT_WORKBOOK_SHEETS`, `ACCOUNTANT_WORKBOOK_COLUMNS` (แผ่นหลัก 25 + `primary_file`), `ACCOUNTANT_WORKBOOK_OPTIONAL_COLUMNS` (`shop_branch`, `posting_status`, `journal_entry_number`), `ACCOUNTANT_PAYMENT_SHEET_COLUMNS`, `ACCOUNTANT_WITHHOLDING_SHEET_COLUMNS`, `ACCOUNTANT_FILES_SHEET_COLUMNS` + ป้ายไทย (spec §7.2)
  - ย้าย `PAYMENT_METHOD_LABELS` → `EXPENSE_PAYMENT_METHOD_LABELS`, `POSTING_STATUS_LABELS`, `POSTING_ERROR_LABELS` จาก `apps/web/src/features/expenses/expenses.model.ts:999-1032` (คำเดิมทุกตัว); `expenseCurrencyLabel(code)` (`Intl.DisplayNames(['th'], { type: 'currency' })`, ไม่รู้จัก → `สกุลเงินอื่น`)
  - `AccountantPackageResult` + `indexFileName`, `paymentRowCount`, `withholdingRowCount`; `@deprecated` ที่ `columnSet`, `ACCOUNTANT_INDEX_SUMMARY_COLUMNS`, `accountantIndexColumns`; JSDoc ของ `indexCsv`/`indexRows` = projection รุ่นแรกที่ตรึงไว้ (spec §7.1, G8)
- `apps/web/src/features/expenses/expenses.model.ts`: re-export สามแผนที่จาก contracts
- ห้ามแตะ `ACCOUNTANT_INDEX_COLUMNS`/`ACCOUNTANT_INDEX_COLUMN_LABELS`

Verify: `pnpm --filter @watchdog-bms/contracts build && pnpm --filter @watchdog-bms/web typecheck`

### 1.2 Tax: projection หัก ณ ที่จ่ายใช้ร่วม (หนึ่ง lane เล็ก)

- `apps/api/src/modules/tax/domain/logic/` ไฟล์ใหม่หรือข้าง `expense-payment-withholding.logic.ts`: `withholdingFormFor(kind, filingRoute): 'PND2'|'PND3'|'PND53'|null` ยกจาก `sync-tax-events.use-case.ts:60-77` (ไม่เปลี่ยนพฤติกรรม sync — sync เรียกฟังก์ชันนี้)
- `apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.ts:70`: `findConfirmedWithWhtByCompany(companyId, since?, filter?: { expenseIds?: string[] })` — `expenseIds` เพิ่มใน `where`; ไม่ส่ง = ผลเดิม
- `apps/api/src/modules/tax/tax.module.ts:68`: เพิ่ม `ExpenseSourceAdapter` ใน `exports`
- `apps/api/src/modules/tax/application/services/withholding-filing-validation.ts:86-110`: ยกการตรวจรายแถว (ผู้รับเงิน/เลขประจำตัว/สาขา/ที่อยู่และความยาว, หมวดรู้จักและตรงแบบ, อัตรา/ภาษี, ประเภทผู้รับเงิน) เป็นฟังก์ชันบริสุทธิ์ `withholdingRowFaults(event, ctx)` คืนรายการข้อผิดเป็นคำไทยเดิม; `validateWithholdingFiling` เรียกฟังก์ชันนี้ (ผลเดิมทุกกรณี — เทสต์ใน `generate-tax-filing-package.use-case.spec.ts`)
- Tests `src/modules/tax/application/use-cases/sync-tax-events-wht-form.use-case.spec.ts` (ลงทะเบียนแล้ว): `withholdingFormFor` ครบทุกกรณีเดิม; adapter กรอง `expenseIds`; จ่ายสองงวด → สองแถว 500/15; `SEPARATE_PND2`; บรรทัดเก่าสองอัตรา; ฐานกรอกเอง 270.50; หักแบบยอดเงิน → อัตรา null; การจ่ายไม่ยืนยันวันที่ → ไม่มีแถว

Verify: `cd apps/api && npx tsx --test src/modules/tax/application/use-cases/sync-tax-events-wht-form.use-case.spec.ts` + `pnpm --filter @watchdog-bms/api typecheck` (ใช้สคริปต์แพ็กเกจ — `tsc` เปล่า OOM)

### 1.3 Pure logic workbook (หนึ่ง lane)

`apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts` (ไม่แตะ `buildAccountantIndexRow`/`buildAccountantIndexCsv`):
- types `AccountantWorkbookRow`, `AccountantPaymentRow`, `AccountantWithholdingRow`, `AccountantWorkbookFile` (`expenseNumber`, `kind`, `path`, `part`, `version?: 'current'|'superseded'`, `replacedBy?`, `skippedReason?`)
- `vendorBranchLabel`, `shopBranchLabel`, `accountantNotes`, `primaryFileCell(file, currentPart)`, `paidAtLabel(paidAt, confirmed)`
- `buildAccountantWorkbook({ rows, payments, withholding, files?, part?, visible, about })` → แผ่นตาม spec §7.2 (แผ่นที่ไม่มีแถวไม่ใส่); `buildWorkbook` เดิม; ลิงก์ `HYPERLINK("<relative path>","<relative path>")` (escape `"` แบบเดิม); เงิน style 3; วันที่ `formatThaiExportDate`; ข้อความช่องว่าง R5
- ย้ายผู้เรียก `buildAccountantIndexXlsx` ทั้งหมดก่อนลบ:
  - `src/modules/expenses/domain/logic/expense-export.logic.spec.ts:7,47-49,248,274,287,302`
  - `src/modules/expenses/domain/logic/expense-document.logic.spec.ts:7,402,419,435` (เลิก `'summary'`)
  - `src/common/export/thai-date.logic.spec.ts:11,80` (**ไม่ได้ลงทะเบียน** แต่ต้อง compile ใน typecheck)
- Tests (`expense-export.logic.spec.ts`, `expense-document.logic.spec.ts`): หัวทุกแผ่น; scan ทุกเซลล์ไม่มี `http`/`/companies/`/cuid/enum อังกฤษ; ทุกแถวของตาราง spec §7.3; `primary_file` 4 แบบ; ตามเงื่อนไข; **CSV golden เดิม (:266) ผ่านทุกไบต์**

Verify: สอง spec ด้วย `npx tsx --test …` + api typecheck

### 1.4 Use-case + ZIP (หนึ่ง lane, ~5 รายการ)

`apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts`:
- `bundleContents`: ย้ายการตั้งชื่อเดิม (:383-430) เป็น `legacyBundleFileName(...)` ทุกบรรทัด; เพิ่ม `fileName` ใหม่ตาม spec §7.4; `BundleFile` เก็บทั้งสองชื่อ + `part` หลังแบ่งชุด + `version`/`replacedBy` ของใบรับรองแทนใบเสร็จ (จาก `isHistorical`/`substituteReceiptStatus` ของ attachment); ZIP ใช้ `fileName`; `indexRows[i].bundle_file_names` (:237) ใช้ `legacyFileName` → CSV ไม่เปลี่ยน
- `createIndex` อ่านเพิ่ม (คิวรีละครั้ง ทุกตัวมี `companyId`):
  - การจ่าย: `expensePayment.findMany({ where: { companyId, status: 'RECORDED', expenseId: { in } } })` → `last_paid_at` (max `paidAt` + `paidAtConfirmed` ของรายการล่าสุด) และแถวแผ่น `การจ่าย` (ช่วงวันที่เดียวกับ `payments` เดิม :351-352)
  - ใบสำคัญจ่ายต่อการจ่าย: `disbursementVoucherLine.findMany({ where: { companyId, expensePaymentId: { in } }, select: { expensePaymentId, voucher: { select: { documentNumber, status } } } })` (ตารางมี `companyId` [schema.prisma:2886](../../apps/api/prisma/schema.prisma)) เฉพาะเมื่อ `visible.vouchers` และใบสถานะ `PAID`
  - หัก ณ ที่จ่าย: inject `ExpenseSourceAdapter` → `findConfirmedWithWhtByCompany(ctx.companyId, undefined, { expenseIds: ชุดแหล่ง })` — ชุดแหล่งเริ่มจาก `page.rows` หลังขยาย (:376) ไม่ใช่ชุด `expenseIds` ของ :339 (ชุดนั้นใช้เลือกแถวแผ่นหลักอย่างเดียว) แล้วเพิ่มตามข้อย่อยแรก — **ยังไม่กรองวันที่** (R3-F3 ปิดแล้ว §0; ลำดับนี้บังคับ):
    - ชุดแหล่ง: `page.rows` หลังขยาย ∪ `whtFilingLine.findMany({ where: { sourceType: 'expense.record', filing: { companyId, status: 'FILED', periodKey: { in: monthsOf(range) } } }, select: { sourceId } })` — **ใส่ sourceId เหล่านี้เข้า `extraIds` (:369-371) ร่วมกับการจ่าย/ใบสำคัญจ่าย/handoff ก่อนบรรทัด :372** เพื่อให้กติกาเดิม `if (!bundle && (request.page !== undefined || request.pageSize !== undefined)) extraIds.length = 0` ตัดทิ้งพร้อมกันในคำขอแบ่งหน้า (RC-F1 ปิดแล้ว; หน้าเรียงคงที่ `prisma-expense.repository.ts:4778-4779` บรรทัดที่ยื่นจึงอยู่ได้ไม่เกินหนึ่งหน้า); **(RC-F2 รอรีวิว §0) เมื่อ `request.expenseIds !== undefined`: คิวรีบรรทัดที่ยื่นเพิ่ม `sourceId: { in: request.expenseIds }` และข้ามคิวรีเมื่อเป็น `[]`** — ตัวโหลดด้านล่างแทนที่การเลือกด้วย `extraIds.slice(...)` (:375) จึงต้องตัดก่อนเข้า `extraIds` แบบเดียวกับที่การจ่าย/ใบสำคัญจ่าย/handoff เคารพการเลือกอยู่แล้ว (:350, :359, :367); แล้วโหลดผ่าน `listSharedEvidence` ด้วย where เดียวกับแผ่นหลักยกเว้นวันที่ (ลูป :373-376 เดิม) เพื่อไม่ให้รายการนอกขอบเขตหลุดเข้ามา; คำขอแบ่งหน้าใส่แถว `หน้า` ในแผ่น `เกี่ยวกับไฟล์นี้`
    - projection ของชุดแหล่งทั้งชุด (ไม่กรองวันที่) + `whtFilingLine.findMany({ where: { sourceType: 'expense.record', sourceId: { in: ชุดแหล่ง }, filing: { companyId, status: 'FILED' } }, select: { id, sourceType, sourceId, lineJson, filing: { select: { formType } } } })` (ทุกงวด)
    - ตัดสินการครอบบนชุดเต็มด้วย `filedLineCoversPayment(line, row)` (`withholding-filing-state.ts:60-65` — บรรทัดไม่มีคีย์ครอบทุกการจ่ายของแหล่ง; คีย์รวมครอบคีย์ `:line:` ที่แยกภายหลัง)
    - แล้วจึงกรอง: บรรทัดที่ยื่นแต่ละบรรทัด (ไม่ซ้ำตาม `id`) ออกเมื่อ `payment[2]` (วันตามเขตเวลาร้าน) อยู่ในช่วง → แถวจาก `lineJson.payment` + `ยื่นแล้ว`; แถวสดที่ไม่ถูกครอบออกเมื่อวันที่จ่ายอยู่ในช่วง; แถวสดที่ถูกครอบไม่ออกเลย — นับตัวที่วันที่จ่ายอยู่ในช่วงแต่ตัวครอบอยู่นอกช่วง → `coveredOutsideRangeCount` ให้แผ่น `เกี่ยวกับไฟล์นี้`
    - แถวสดที่ไม่ถูกครอบ (หลังกรอง) แยกสถานะต่อ:
      - งวดแบบนั้นปิด (`taxPeriod` `FILED|PAID|CLOSED` ของ `formPeriodKey(form, date)`) → `งวดปิดแล้ว ตรวจกับแบบที่ยื่น`
      - งวดเปิด: เงื่อนไขที่ sync ไม่สร้าง event (`sync-tax-events.use-case.ts:283-304`) + `withholdingRowFaults` → `ยังไม่ยื่น · ต้องตรวจ: <ข้อผิดแรก>`; ไม่มีข้อผิด → `ยังไม่ยื่น · ข้อมูลครบตามแบบ` (ไม่ใช้คำ `พร้อมยื่น`)
    - `withholdingFormFor` + `whtIncomeCategory.findMany({ where: { code: { in } } })` (catalog กลาง ไม่กรอง companyId) + handoff `SYSTEM_ISSUED`/`EXTERNAL_LINKED` (ขอบเขตสาขาแบบ :368) เมื่อมีสิทธิ์ wht; นับการจ่ายที่ไม่ยืนยันวันที่
  - ใบรับรองแทนใบเสร็จ: เดินสาย `correctionOfEvidenceId` ไปข้างหน้าจาก `certificates` ของแถว (A→B→C); ปลายสายเป็น `ISSUED` → ทุกใบก่อนหน้าเป็น `ฉบับเดิม (มีฉบับใหม่แทนแล้ว)` และ `แทนด้วย` = ปลายสาย; ปลายสายไม่ใช่ `ISSUED` → `ยกเลิกแล้ว (ไม่มีฉบับใหม่)` (spec §7.2 แผ่น 4)
  - สาขา: select `{ id, name, taxBranchCode, isVatEstablishment }` + `branch.count({ where: { companyId } }) > 1`
  - ledger: `companyFeatureEntitlement` กติกาเดียวกับ `prisma-expense.repository.ts:623`
  - สกุลเงิน: `r.currency` ใส่ `AccountantWorkbookRow`
- `downloadBundle`: อ่านไฟล์ก่อน (เดิม) → ส่ง `{ part, included, skipped }` ให้ `createIndex` → ลิงก์เฉพาะชุดนี้; `ไฟล์ทั้งหมด` ครบทุกชุด
- `indexFileName`, ชื่อ ZIP ใหม่, `paymentRowCount`, `withholdingRowCount`; audit `workbook: 'accountant-v2'`
- `apps/api/src/modules/expenses/expenses.module.ts`: ไม่ต้องเพิ่ม import (TaxModule อยู่แล้ว :136)

Tests (`src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts` ชุด `CreateAccountantPackageUseCase` :1083): 61 ไฟล์ → 2 ชุด ลิงก์เฉพาะชุด; 404 → `ไม่ได้รวม: ไม่พบไฟล์`; ชื่อไฟล์ใหม่ไม่มี id **และ `indexCsv` ยังเป็นชื่อรุ่นแรก**; ไม่มี `expense.disbursement.read` → ไม่มีคอลัมน์ใบสำคัญจ่าย; external handoff → เลขขึ้นแผ่นหัก; ไม่มี ledger → ไม่มีคอลัมน์ลงบัญชี; 2 สาขา → `สาขาของร้าน`; แผ่นหักตรงกับแถว projection ทุกช่อง (จ่ายสองงวด, ภ.ง.ด.2); ยืนยันวันที่จ่ายใหม่ → `วันที่จ่ายล่าสุด` ใหม่; USD → `ดอลลาร์สหรัฐ`; ใบรับรองฉบับเดิม/ใหม่ และยกเลิกไม่มีใบใหม่; มีแต่การจ่าย → `rowCount 0`, `paymentRowCount > 0`; **บิลกันยายนจ่ายตุลาคม** → แผ่นหัก/การจ่ายของไฟล์ตุลาคมมีแถว; **แถวที่ยื่นแล้ว + แก้ที่อยู่ทะเบียนคู่ค้า** → แสดงที่อยู่ตามภาพที่ยื่น; **(R3-F3) ยื่นกันยายนแบบไม่มีคีย์ + งวดจ่ายตุลาคม** → ไฟล์กันยายนมีแถวที่ยื่นครั้งเดียว, ไฟล์ตุลาคมไม่มีแถวกันยายนและไม่มีแถวสดตุลาคม, `coveredOutsideRangeCount` = 1; **(R3-F3) ยื่นสำหรับการจ่ายตุลาคม แล้วแก้วันที่จ่ายเป็นพฤศจิกายน (บิลลงวันที่กันยายน)** → ไฟล์ตุลาคมมีแถว `ยื่นแล้ว` (มาจากชุดแหล่งส่วน filing), ไฟล์พฤศจิกายนไม่มี; รายการสาขาอื่นที่มีบรรทัดยื่นในเดือนเดียวกันไม่หลุดเข้าไฟล์ของผู้ใช้สาขาเดียว; **(RC-F1) A และ B ยื่นตุลาคม, `pageSize: 1`** → หน้า 1 มีแถวที่ยื่นของ A เท่านั้น หน้า 2 ของ B เท่านั้น รวมสองหน้าอย่างละครั้ง, แผ่น `เกี่ยวกับไฟล์นี้` มี `หน้า`; ไม่แบ่งหน้า/ZIP → A และ B อย่างละครั้ง; **(RC-F2) ทั้ง `accountant-package` และ `downloadBundle`: A/B ยื่นเดือนเดียวกัน, `expenseIds: ['A']` → แผ่นหัก/การจ่าย/ไฟล์มีแต่ A; `expenseIds: []` → ว่าง ไม่มี B และไม่มีคิวรีบรรทัดที่ยื่น;** งวดปิด / ไม่รู้ประเภท / ไม่มีเลขผู้เสียภาษี / ต่างสกุล → สถานะถูก

Verify: spec + api typecheck + lint

### 1.5 DTO (เล็ก ต่อท้าย 1.4)

- `apps/api/src/modules/expenses/presentation/http/expense.dtos.ts`: `export class AccountantPackageDto extends AccountantEvidenceBundleDto { @IsOptional() @IsIn(['summary','full']) columnSet?; @IsOptional() @IsIn(['csv']) format?; @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?; @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) pageSize?; }` (ใช้ pattern ตัวเลขที่ DTO อื่นในไฟล์นี้ใช้)
- `expense.controller.ts:272-276` ใช้ DTO นี้
- Tests `src/modules/expenses/presentation/http/expense.dtos.spec.ts` กับ `GLOBAL_VALIDATION_PIPE_OPTIONS` (`src/common/pipes/validation-pipe.options.ts`): `expenseIds: "x"` ปฏิเสธ; `{ page: 2, pageSize: 100 }` ผ่าน; `pageSize: 501` ปฏิเสธ; body เดิมของเว็บทั้งสองหน้า ผ่าน

Verify: spec + `pnpm --filter @watchdog-bms/api lint`

---

## Phase 2 — เว็บ + journey

### 2.1 หน้ารายการ (หนึ่ง lane)

- `apps/web/src/features/expenses/ExpensesPages.tsx`: ลบ `columnSet` state (:2726) + select (:2994-2999) + ส่ง `columnSet` (:2914); เงื่อนไขว่าง (:2918) → `rowCount + paymentRowCount + withholdingRowCount === 0`; ลบข้อความข้ามไฟล์ (:2922-2924); `downloadIndexXlsx(result, result.indexFileName)`; T1 ผ่าน `EvidenceBundleDownload`
- `apps/web/src/common/i18n/workspace-dictionary.ts`: ลบ `expenses.export_columns*` (th/en) ถ้าไม่มีผู้ใช้อื่น
- `packages/contracts/src/expenses.ts`: ลบ `ACCOUNTANT_INDEX_SUMMARY_COLUMNS`/`accountantIndexColumns` (API เลิกใช้ใน 1.3)
- Tests: `apps/web/src/features/expenses/ExpenseList.rendered.spec.ts`

### 2.2 หน้าหลักฐาน + ปุ่มชุดเอกสาร (หนึ่ง lane)

- `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:899-915`: เอา `MoreActions` ออก วางปุ่มรอง "ดาวน์โหลด Excel" ข้างปุ่มชุดเอกสาร (`ActionGroup` เดิม ขนาดเท่ากัน); **ปุ่มปิดเฉพาะ `exporting || loading`** (เอา `!visibleRows.length` ที่ :904 ออก — เดือนที่มีแต่การจ่ายต้องกดได้ แล้วบอกผลเมื่อกด); เงื่อนไขว่าง (:773) แบบ 2.1; toast T5; `indexFileName`
- `apps/web/src/features/expenses/EvidenceBundleDownload.tsx`: `เอกสารค่าใช้จ่าย N` / `หลักฐานการจ่าย N`; T1 เมื่อ `plan.fileCount > 0`
- Tests: `EvidenceBundleDownload.spec.ts`, `EvidencePanel.qa.spec.ts`

Verify 2.1–2.2: `pnpm --filter @watchdog-bms/web typecheck && pnpm --filter @watchdog-bms/web test`

### 2.3 E2E + journey (หนึ่ง lane)

- `e2e/expenses.spec.ts`:
  - EXP-EXPORT (:1235-1276): ไม่มี combobox `รายละเอียดในไฟล์`; body ไม่มี `columnSet`; ขนาด 390/1280/1556
  - EXP-20/21/22/23 (:1136-1210, `chooseFullColumns` :1141): เปลี่ยนตัวตรวจเป็นลำดับวันที่ (`dateOrder`) — กดเรียงเก่าไปใหม่ แล้วตรวจว่าคงค่า (EXP-20) / กลับเป็นใหม่ไปเก่า (EXP-21/22/23)
- `e2e/journeys/evidence-and-settings.journey.spec.ts:65-82`: ปุ่มชื่อใหม่ "ดาวน์โหลด Excel" (:67); เพิ่ม helper คืน buffer เต็มใน `e2e/journeys/journey-kit.ts` ข้าง `pressForDownload` (:200); unzip xlsx ตรวจหัวทุกแผ่น + ไม่มี `HYPERLINK("http`; ZIP มี `สารบัญ.xlsx` และไม่มีชื่อที่มี cuid
- ขั้นเตรียมใน journey: รายจ่ายหัก 3% จ่ายสองครั้งในสองวัน (ไม่แตะ seed)

Verify: รันเฉพาะสองไฟล์นี้บน local stack (สูตร `local-dev-server-recipe` ในหน่วยความจำ); บันทึกผลจริง

### 2.4 หลักฐานหน้าจอจริง (controller ทำเอง — thai-ux-standard.md §7)

- เปิด dialog/การ์ดที่ 390, 1280, ~1,556 px ถ่ายภาพ วัดปุ่ม (สูง/กว้างเท่ากัน) กดผ่านหนึ่งรอบรวมหนึ่งทางผิด (กดเดือนว่าง)
- แตก ZIP จริง (≥ 61 ไฟล์ ได้ 2 ชุด) เปิด `สารบัญ.xlsx` บน Excel Windows, Excel Mac, LibreOffice กดลิงก์สามชนิด — บันทึกผล; ถ้า Windows ไม่รับ `/` → ข้อความอย่างเดียว แล้วแก้ spec §5.5
- W00: `cd apps/api && npx tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts` ผ่านโดยไม่ regenerate

---

## Phase 3 — ไฟล์อื่น + เลขที่เอกสาร (ขนานกับ Phase 2 ได้)

### 3.1 สมุดรายรับ–รายจ่าย (E5)

- `apps/api/src/modules/accounting-documents/application/use-cases/income-expense-ledger.use-case.ts:344-356`: ตัดคอลัมน์ `หลักฐานต้นทาง`; `สถานะ` ผ่าน `EXPENSE_STATUS_LABELS` / `ACCOUNTING_DOCUMENT_STATUS_LABELS` ([accounting-documents.ts:532](../../packages/contracts/src/accounting-documents.ts)); XLSX วันที่ `formatThaiExportDate` (CSV คงวันที่ ISO); **สกุลเงิน (B24)**: เพิ่ม `currency` ใน `IncomeExpenseLedgerEntry` (contracts) จาก `row.currency` ของเอกสาร/รายจ่าย (:291-314) และคอลัมน์ `สกุลเงิน` ใน CSV/XLSX (CSV ใช้รหัส ISO, XLSX ใช้ `expenseCurrencyLabel`); **ยอดสรุป** (:155 `_sum` และตัวคำนวณ `calculateIncomeExpenseLedgerAmounts`) รวมเฉพาะสกุลหลักของร้าน และคืนจำนวน/ยอดของสกุลอื่นแยก (`otherCurrencies: { currency, count, amount }[]` ใน contracts แบบเพิ่ม); **หน้าจอ** `apps/web/src/features/accounting-documents/IncomeExpenseLedgerPage.tsx:265` แสดงสกุลของแถว (ไม่ใส่ `฿` ให้แถวต่างสกุล) และบรรทัดเดียวใต้ยอดสรุป `มีรายการสกุลเงินอื่น N รายการ ไม่รวมในยอดนี้` เมื่อมี (จริงทุกกรณี: แสดงเฉพาะเมื่อ N > 0)
- Test: `src/modules/accounting-documents/infrastructure/prisma-accounting.repository.atomic-issue.spec.ts` (PostgreSQL จริง) ขยาย assert ที่ :1248 + รายจ่าย USD

### 3.2 ไฟล์ ภ.ง.ด. ให้ผู้ทำบัญชี (E6)

- `apps/api/src/modules/tax/application/services/withholding-accountant-export.ts:32-45`: หัว `อัตรา (%)`; แผ่น `ภ.ง.ด.2` เฉพาะเมื่อมีแถว; **สกุลเงิน (B25)**: คอลัมน์ `สกุลเงิน` จาก `event.currency` และแถว `รวม` แยกต่อสกุล (หนึ่งแถวต่อสกุล) แทนการบวกข้ามสกุล (:41)
- Test: `src/modules/tax/application/use-cases/generate-tax-filing-package.use-case.spec.ts` — event THB + USD หมวด `SEPARATE_PND2`

### 3.3 เลขที่เอกสารปลอมผ่านการตรวจ (B17)

- `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts:1692-1706`: นอกจากสลิป ให้ `invalid` เมื่อ `digitRuns.length === 0` หรือเมื่อไม่ผ่านทั้งสองทาง: (ก) ค่าที่ตัดช่องว่างและ `-._` ทั้งก้อนปรากฏใน `collapsedText` ที่ตัดแบบเดียวกัน; (ข) ค่าเป็น `A/B` และพบ `A` ตามหลังป้ายเล่มที่ กับ `B` ตามหลังป้ายเลขที่ ในข้อความ (คงกติกาประกอบเล่มที่/เลขที่ของ 19j [expense-receipt-upload-spec.md:1492](../../docs/specs/expense-receipt-upload-spec.md)); คงกติกาวันที่เต็มและความยาวเดิม
- Tests: `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.spec.ts` (อยู่ในสคริปต์ `test` ของ ai-gateway): `FAKE` ลบ; `FAKE-180` ที่มีแค่ยอด 180 ลบ; `INV-0012` เมื่อข้อความพิมพ์ `INV - 0012` ผ่าน; `เล่มที่ 12 เลขที่ 345` → `12/345` ผ่าน; `12/345` ที่ไม่มีป้ายเล่มที่/เลขที่และไม่ปรากฏทั้งก้อน ลบ; `123/2569` ผ่าน; สลิปเดิมไม่เปลี่ยน
- Verify: spec ข้างบน + `pnpm --filter @watchdog-bms/ai-gateway typecheck` + `node scripts/run-line-ai-whole-chain-acceptance.mjs` ก่อน push; W00 ไม่ต้อง regenerate (ไฟล์นี้ไม่อยู่ในรายการ hash)

### 3.4 handoff 50 ทวิ ของบุคคลธรรมดาใช้แบบตามหมวด (B22)

- `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts:4946-4947`: `formType` ของ prefill = `withholdingFormFor(vendorEntityKindSnapshot, category.filingRoute)` (ฟังก์ชันจาก 1.2) แทน `INDIVIDUAL → 'PND3'`
- `apps/api/src/modules/tax/application/use-cases/wht-certificate-handoff.use-case.ts:211`: ตัวกรองรับ `PND2` ด้วย (คำปฏิเสธเดิมเพิ่ม ภ.ง.ด.2)
- สัญญา/หน้าจอ handoff: เพิ่มชนิดเฉพาะของ handoff `WhtHandoffFormType = 'PND2' | 'PND3' | 'PND53'` ใน `packages/contracts/src/tax.ts` (ใช้ที่ handoff `formType` :476 และตัวกรอง) **โดยไม่แก้ชนิดที่ใช้กับการออกใบในระบบ** (`:55`); เว็บ `apps/web/src/features/expenses/WhtCertificatesPage.tsx:43` ป้าย `ภ.ง.ด.2` (แทน `ยังไม่รู้แบบภาษี` สำหรับค่านี้), การอ่าน `formType` จาก URL และตัวเลือกกรองมี ภ.ง.ด.2; ปุ่มออกใบในระบบสำหรับ ภ.ง.ด.2 ยังปฏิเสธพร้อมทางออกเดิม
- Tests เว็บ: spec ของหน้า 50 ทวิที่มีอยู่ (glob) — ป้าย/ตัวกรอง/URL ภ.ง.ด.2
- ซ่อมแถวเดิม: สคริปต์ครั้งเดียวใน `apps/api/src/scripts/` (แบบสคริปต์ซ่อมที่มีอยู่) แก้ `prefillSnapshotJson.formType` ของ handoff สถานะ `REQUIRED` ที่หมวดเป็น `SEPARATE_PND2` และผู้รับเป็นบุคคล; ไม่แตะแถวที่ออกใบแล้ว; **คงการปฏิเสธการออกใบในระบบสำหรับแบบที่ระบบไม่รองรับ** (ตรวจ guard ของ `IssueWhtCertificateFromHandoffUseCase` ก่อน — ถ้าออก 50 ทวิ ภ.ง.ด.2 ไม่ได้ ต้องยังปฏิเสธพร้อมคำบอกทางออก)
- Tests: `src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts` (PostgreSQL จริง), `src/modules/tax/application/use-cases/wht-certificate-handoff.use-case.spec.ts`

### 3.5 PDF ทาง LINE ที่สร้างงานอ่านไม่สำเร็จ (B23)

- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:11018-11022`: เก็บผล `readJobId`; `:11094` (และจุดเรียก `fileStoredReply` อื่น :11060, :12463): ถ้า `readJobId === null` ตอบการ์ดปุ่ม (LINE ใช้ปุ่ม ไม่ใช้รายการตัวเลข) ข้อความ `📄 เก็บไฟล์แล้วค่ะ แต่ยังเริ่มอ่านเอกสารไม่ได้ กดปุ่มด้านล่างให้น้องเริ่มอ่านอีกครั้งได้เลยค่ะ` + ปุ่ม `เริ่มอ่านอีกครั้ง` (postback ผูก `expenseId` + `attachmentId` ของร่างเดิม แบบ postback ที่ลงนามซึ่งมีอยู่) และ `fileStoredReply` เดิมใช้เฉพาะเมื่อมีงาน
- **ไม่ใช้ "ส่งไฟล์เดิมอีกครั้ง" เป็นทางออก**: การกันซ้ำใช้ `lineMessageId` (:11057) ข้อความใหม่จึงสร้างร่างใหม่ (`expense-upload.use-case.ts:136` `existing ?? await createExpense()`); การแยก "LINE ส่ง webhook ซ้ำ" (message id เดิม — คืนร่างเดิม) ออกจาก "คนส่งไฟล์ซ้ำ" (message id ใหม่ — ร่างใหม่ที่ระบบจับซ้ำด้วย checksum ตามเดิม) คงไว้
- postback `เริ่มอ่านอีกครั้ง`: ตรวจเจ้าของร่าง/แชต/สาขาแบบเดียวกับเส้นทางกันซ้ำ (`expense-document.use-case.ts:124-131`), ร่างยังไม่มีงานอ่าน → `queueExpenseRead` (idempotent ด้วย checksum ของไฟล์) แล้วตอบข้อความเดิม (กำลังอ่าน); สร้างไม่สำเร็จอีก → การ์ดเดิม; มีงานแล้ว → บอกสถานะเดิม
- Tests: `src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` (ลงทะเบียน): `queueExpenseRead` throw → การ์ดปุ่ม; กดปุ่ม → งานอ่านถูกสร้างครั้งเดียวกับร่างเดิม; **สอง message id ต่างกันที่ไฟล์เดียวกัน → สองร่าง (พฤติกรรมเดิม) และปุ่มของร่างแรกไม่สร้างร่างใหม่**; webhook ซ้ำ message id เดิม → ร่างเดิม
- Verify: spec + api typecheck + **W00: ไฟล์นี้ถูก hash** → `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1` แล้วรัน `line-ai-capability-manifest.spec.ts` + `node scripts/run-line-ai-whole-chain-acceptance.mjs` (หน่วยความจำ "W00 manifest hashes web files")
- ข้อความใหม่ตารางพื้นผิว × กรณี: งานสร้างไม่สำเร็จ → การ์ดปุ่ม จริง; งานสร้างสำเร็จ → ข้อความเดิม; กดปุ่มแล้วสร้างได้ → ข้อความเดิม (กำลังอ่าน) จริง; กดปุ่มแต่มีงานแล้ว → บอกสถานะงาน จริง

### 3.6 การจับตัวตนผู้ขายฝั่ง gateway (B27, B28)

- `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts:1712-1718`: รหัสสาขาต้องพบ**ตามหลังป้ายสาขา** (`สาขาที่`/`สาขา`/`Branch`) ในข้อความฝั่งผู้ออก ไม่ใช่แค่เป็นสตริงย่อย (กันชนกับเลขผู้เสียภาษี/ที่อยู่); ใบพิมพ์สำนักงานใหญ่ → `00000` ชนะค่าที่โมเดลตอบ
- `apps/ai-gateway/src/modules/line-ai/domain/logic/expense-capture-read.logic.ts:560-570`: บล็อกคู่กรณีอื่น (`ผู้ป่วย`/`ลูกค้า`/`buyer`…) จบที่บรรทัดว่าง หรือบรรทัดป้ายเลขผู้เสียภาษี/ผู้ออก/ส่วนท้ายใบ — ไม่ค้างจนจบเอกสาร
- Tests: `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.spec.ts` (ลงทะเบียน) + spec ของ `expense-capture-read.logic.ts` ถ้าอยู่ในสคริปต์ `test` ของ ai-gateway (ตรวจก่อน ไม่สร้างไฟล์ใหม่ที่ไม่ลงทะเบียน): `00016` ในเลข `0994000163011` ถูกลบ; สำนักงานใหญ่ชนะ; หัวโรงพยาบาล + `ผู้ป่วย` + เลขผู้เสียภาษีท้ายใบ → จับ/กู้ได้; เคสเดิมทั้งหมดผ่าน
- Verify: `pnpm --filter @watchdog-bms/ai-gateway typecheck` + spec + `node scripts/run-line-ai-whole-chain-acceptance.mjs`; W00 ไม่ต้อง regenerate (ไฟล์ gateway ไม่อยู่ในรายการ hash)

Verify 3.1–3.2, 3.4: spec ที่ระบุ + api typecheck + web typecheck/test (3.1 หน้าจอ, 3.4 หน้า 50 ทวิ)

---

## Phase 4 — ปิดงาน

- memory: ผลคำสั่งจริง, ภาพหน้าจอ 390/1280/1556, ผลลิงก์บน Excel แต่ละโปรแกรม, ผล whole-chain
- release note หนึ่งบรรทัด (ไทยง่าย): "ไฟล์ Excel ให้สำนักงานบัญชีเหลือแค่ช่องที่ใช้ลงบัญชีและยื่นภาษี แยกแผ่นการจ่ายและหัก ณ ที่จ่าย ไม่มีลิงก์เข้าแอปแล้ว"
- กฎเจ้าของ: ไม่เปิด PR/ไม่เรียก Actions; push ตรง develop+main หลังตรวจในเครื่อง; UAT/Production ตาม runbook และรอคำสั่ง

## การตัดสินใจที่ล็อกแล้ว

1. CSV/`indexRows`/manifest คงไบต์ด้วย projection แยก — `legacyFileName` สำหรับ CSV, `fileName` สำหรับ ZIP/workbook (ผู้ประสานงาน 2026-10-24)
2. หัก ณ ที่จ่ายในไฟล์มาจาก projection เดียวกับ ภ.ง.ด. (ต่อการจ่าย ต่อบรรทัดเก่า, frozen, `paidAtConfirmed`) และแบบ ภ.ง.ด. จาก `withholdingFormFor` ที่ sync ใช้ — ไม่มีสูตรที่สอง
3. วันที่จ่าย/วิธีจ่าย/จ่ายจาก/ใบสำคัญจ่าย อ่านจากแถวการจ่ายจริง ไม่ใช่หัวเอกสาร
4. ซ่อนคอลัมน์ตามโครงสร้าง (แพ็ก สาขา สิทธิ์คนกด) ไม่ตามข้อมูลรายเดือน; แผ่นว่างไม่ใส่
5. ไม่มีลิงก์เข้าแอป ลิงก์เดียวคือ path สัมพัทธ์ใน ZIP ชุดเดียวกัน
6. ไม่มีชื่อพนักงานนอกจากผู้ที่ร้านต้องคืนเงิน (PDPA ม.22/27 ฉบับประกาศใช้)
7. คอลัมน์ VAT คงแม้ร้านไม่จด VAT; วันที่เป็นข้อความไทย (การตัดสินใจเดิม)
8. ไม่มี migration
