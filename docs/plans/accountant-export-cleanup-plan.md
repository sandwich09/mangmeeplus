# Accountant Export Cleanup Plan

Status: DRAFT — RC-F2 co-voucher intersect redesigned 2026-10-26; controller checked the design against code 2026-11-04 (accepted; implementation pending); Re-anchored to develop e7c422802 on 2026-11-04; owner answers recorded 2026-11-04
Owner: Expenses documents lane (controller review)
Related: `docs/specs/accountant-export-cleanup-spec.md`, `docs/agent-memory/accountant-exports.md`, `docs/plans/accounting-software-export-plan.md`
Baseline: develop `e7c4228026eec3c696fa76986420d2c97cb26676`, re-read 2026-11-04 in this worktree; supersedes citation baseline `0f938a361` (2026-10-26).
Scope: ไฟล์ Excel/สารบัญ ZIP ให้นักบัญชี (Phase 1–2), ไฟล์ ภ.ง.ด. ให้ผู้ทำบัญชี และการตรวจเลขที่เอกสารฝั่ง LINE (Phase 3)
หลักการ: ponytail full — ใช้ builder/label map/permission gate/projection ภ.ง.ด. เดิม, ไม่มี migration, ไม่มี dependency ใหม่, ไม่มี feature switch, CSV/`indexRows`/manifest คง schema/serializer ตาม R10

## 0. Accepted design and implementation boundary

**RC-F2 is a current-code bug with an accepted design; implementation is pending.** The 2026-10-24 design filtered only filing-source candidates; that did not protect the other members of `extraIds`. The controller checked this redesign against code on 2026-11-04 and accepted it; it is not yet implemented. Historical R3-F1/R3-F2/R3-F3/RC-F1 reviews are recorded in `docs/agent-memory/accountant-exports.md`; “closed” there means a design review, not a shipped fix.

| Finding | Verified current flow | Closing design | Gate |
|---|---|---|---|
| RC-F2 / B29 | `apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts:359` selects voucher V on `lines: { some: ... }`; `:370` collects **all** V's line IDs; `:375` replaces the original selection. Select A from V(A,B): B joins `page.rows`, the payment-evidence worksheet, attachments and ZIP. | R8: intersect the **complete merged** `extraIds` with a present `request.expenseIds` before the page rule and 500-ID batches; preserve full `voucher.lines`, `addDocument` all-source guard (`:404`) and supporting-file guard (`:421`). In Phase 1.4 both WHT reads receive only IDs of rows actually loaded. | First commit: plan 0.1 fixes today's expansion; Phase 1.2/1.4 adds and proves the WHT boundary. Design accepted by controller 2026-11-04. |

This is a documents-only round: no code, tests, migrations, commits or deployment executed. External research cited below is retained from the dated earlier round, not re-opened or newly verified here; FlowAccount still needs its Phase 0 proof.

## Re-anchor delta (R10/R16/R19/R21/R22)

Use the spec §0.1–0.2 disposition and current line numbers. `8c112ea70` already fixed unusual document dates; preserve it in 1.3/1.4 tests, with no repository date patch. `049aa51de` added free-source restrictions; adapt S/3.5, do not replace them. `9036b8552` welcome/advisor, `1fbba874e`/`884ba5307` history, and `3f6db1729` accepted-confirmation suppression are existing behavior, not new steps. The buffer's company-command ordering is unchanged between anchors (`line-message-buffer.service.ts:506-516`). No unsold dependency returns.

Path coverage is in the spec Traceability: output changes apply to paid exports; free requests are refused under R22. Receipt/security/identity changes S/3.3/3.5/3.6 and their wording cover both paths. Free does not gain typed questions, confirmation, payments, tax or exports. Do not reinterpret welcome/advisor access as a paid capability.

## ลำดับที่บังคับ

**0.1 RC-F2 current-code hotfix (own commit)** → **0.2 existing free/paid export boundary** → Phase S (B26; implemented once as `docs/plans/expense-trust-and-money-fixes-plan.md` P03 / R3, owner step 1, not repeated here) → Phase 1.1–1.5 → Phase 2. Phase 3.2–3.6 are five separate small steps after their dependencies; Phase 3.1 was removed by the sold-feature ceiling. Phase 4 records evidence. These are future implementation steps; this documents round executes none.

### 0.1 RC-F2 — first commit, independent of workbook redesign (R8/R13)

Dependency: none (controller accepted the design 2026-11-04); no dependency on Phase 1 or the software-export feature.

1. **Test first**, in `src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts`: **"selection excludes an unselected co-voucher expense from workbook, WHT and ZIP"**. Build paid V with complete lines A+B, both same company/branch and confirmed, with separate attachments and WHT certificates. Select A → current payment-evidence worksheet/manifest/ZIP contains no B. Assert V's PDF, slip and supporting-file loaders are not called. Exercise `['A']`, `[]`, omitted selection, explicit pages (including a page with no rows), and a second fixture whose B fails an existing filter/scope. Fixtures must honor query predicates instead of returning A+B regardless of the query.
2. In `apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts`, `bundleContents` at `:370-371`: intersect the **complete merged** `extraIds` with `new Set(request.expenseIds)` when `request.expenseIds !== undefined`, before `:372` and the 500-ID loader. Keep every existing filter, scope and loader argument at `:374-375`. Do not change `readPackageRows`' original `expenseIds` set or count semantics.
3. Keep `voucher.lines` complete and retain both all-source checks (`:404`, `:421`); A-only must exclude the entire V(A,B) artifact, not render its full contents behind an A-only label. Omitted selection still includes V when all its sources pass.
4. Preserve empty behavior: workbook contains no data rows; `planBundle.partCount = 0` (`:445`); `downloadBundle(..., 1)` throws 404 (`:462`). Explicit workbook pages do not expand; ZIP still reads the entire selection, independent of page requests at the internal use-case level.
5. Verify: `pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts` and `bash scripts/local-proof/tsc.sh api`. Commit only this selector fix and its test in the later implementation round. Do not call RC-F2 closed: Phase 1.4 must extend the same regression to the new WHT sheet and its two reads.

Impact/risk: current E1/E2 workbook, E3 ZIP and E4 manifest consume `page.rows`; B used to leak into the payment-evidence sheet, not the main `indexRows` (`:288-310`). R8 intentionally removes leaked B and the combined V(A,B) artifacts; A therefore also loses V in `voucher_numbers`/`bundle_file_names` (`:234-237`). Legacy-content goldens compare identical eligible rows/artifacts, with the serializer unchanged. No LINE/AI Gateway/notification/tax-sync mutation, schema, environment switch or permission change.

---

### 0.2 R22 — preserve free denial at every export entry (after 0.1; separate from its commit)

1. Tests first: `src/modules/auth/auth.guard.spec.ts` — **free draft mode denies both export routes and bundle parts** (existing auth fixture at `:486-501`); `src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts` — **free shops cannot export accountant files through HTTP or direct calls**. Cover explicit free context and a stale trial-era export-capable context whose current DB state is free, plus paid/branch-denied controls; assert no row, file, WHT or successful-export audit work. Use real commercial-state test doubles, not the no-DB fixture fallback.
2. `apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts`, `readPackageRows` (`:317-324`): after existing permission/scope checks, call existing `assertExpenseFinancialAccess(ctx, this.prisma.client)` (`apps/api/src/modules/expenses/application/expense-commercial-access.ts:22-24`) before loading for customer contexts, preserving the existing `SYSTEM_ADMIN` exception (`auth.guard.ts:325`). All accountant package/plan/download paths already enter here; the software plan will share it. Keep HTTP allowlist and permission intersection unchanged; no new key, switch or schema.
3. `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`, existing free branch (`:6933-6941`): keep its refusal and early return; add a `เมนูหลัก` action with `lineChoiceQuickReply` through `deliverReply` (`:2659-2669`). No new text intent or export tool. Test in `src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — **free export requests remain model-free with a menu exit**; pressing the action reaches the existing draft menu without model, charge or notification to another person.
4. `apps/web/src/features/expenses/ExpensesPages.tsx`/`ExpensesWorkspacePanels.tsx`: keep `canExportExpenseList` and free permission filtering; the stale/denied export error offers `กลับไปรายการค่าใช้จ่าย`. `apps/web/src/features/expenses/ExpenseList.rendered.spec.ts` — **free and stale sessions cannot open export and can return to drafts**. Extend `e2e/journeys/evidence-and-settings.journey.spec.ts` — **free shops cannot open either export at 390, 1280 and 1556**; free→paid company switching keeps the right actor/company and current permissions. Exercise accountant now; add software endpoint assertions in its Phase 1.6.

Verify: V-AUTH + V-DOC + V-LINE, API/web local-proof tsc, named web spec and V-BROWSER. The webhook is a hashed source (`apps/api/src/modules/line-ai/line-ai-capability-manifest.ts:232`): update the existing W00 artifact in this later implementation step, then V-W00 + whole-chain; add no tests to the unregistered manifest spec. Risk: stale contexts or fixtures must not bypass commercial state; denial must not consume receipt allowance. No export is enabled for free shops. Existing `free-expense-access.spec.ts` is unregistered (0), so add no test there.

---

## Phase S — R16: แก้ช่องโหว่อ่านเอกสารข้ามสาขา (B26) — moved 2026-11-04 to `docs/plans/expense-trust-and-money-fixes-plan.md` P03 (R3, owner step 1)

Do not implement this twice. That plan's R3 consolidates B26/Phase S and owns the code change, tests and acceptance (AC3). The bullets below stay as a cross-check: P03 must satisfy each one. Later steps that depend on "S" depend on P03 being merged.

- `apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts:94-104`: แทน `this.repo.findById(ctx.companyId, expenseId)` ด้วยการโหลดแบบมีขอบเขตแบบเดียวกับหน้ารายละเอียด (`GetExpenseUseCase`, `expense-draft.use-case.ts:227-244`: `findByIdWithRelations(companyId, id, …, ctx.scopes)` + `assertBranchInScope(ctx, expense.branchId)` + สิทธิ์อ่านทั้งหมด/ที่เกี่ยวข้อง/ของตัวเอง) **ก่อน** อ่าน attachment, ขออนุญาตใช้ผู้อ่าน (`admitCompanyOcr`) หรือเข้าคิว PDF (`expense-extraction.use-case.ts:126`); นอกขอบเขต → `auditOutcome(ctx, expenseId, 'not_found')` + `NotFoundException` ข้อความเดียวกับ id ที่ไม่มี (ไม่บอกว่ามีอยู่)
- ตรวจผู้เรียกอื่นของ `extract`/`queueCaptureRead` ใน use-case เดียวกันว่าผ่านจุดนี้หมด
- `049aa51de` เพิ่ม `isFreeExpenseDraftCompany` และ free creator/draft check แล้ว (`expense-extraction.use-case.ts:95-114`): คงไว้พร้อม source-only apply (`:243-250`), reservation/refund และ usable-result commit; เติม branch/own/related check ก่อน storage/provider/queue บนทั้ง free และ paid. ตรวจ free ข้ามสาขา, ผู้สร้างคนอื่น, quota หมด และผลอ่านใช้ไม่ได้ โดยไม่เพิ่ม charge/จำนวนใบหรือ final mutation.
- Tests: `src/modules/expenses/application/use-cases/expense-extraction.use-case.spec.ts` (ลงทะเบียนแล้ว) — สาขา A + `expense.review` ขอร่างสาขา B → 404 และไม่มีการเรียก storage/ผู้อ่าน/คิว; สาขา B ผ่าน; ผู้ส่งเอกสารที่มีแค่ `expense.receipt.upload` ผ่านเฉพาะร่างของตัวเองในสาขาที่มีสิทธิ์; ผู้ใช้ไม่จำกัดสาขาผ่านเหมือนเดิม
- Verify: `pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/application/use-cases/expense-extraction.use-case.spec.ts` + `bash scripts/local-proof/tsc.sh api` + lint; ขั้นนี้ไม่มีการ deploy; ทำตาม runbook เมื่อมีคำสั่ง release
แผนข้อ 13 เริ่มได้หลัง Phase 1 (ใช้ label map, `AccountantPackageDto`, `withholdingFormFor`, แผ่น `เกี่ยวกับไฟล์นี้`)

---

## Phase 1 — API

### 1.1 Contracts (R1–R7/R10/R12)

- `packages/contracts/src/expenses.ts`:
  - `ACCOUNTANT_WORKBOOK_SHEETS`, `ACCOUNTANT_WORKBOOK_COLUMNS` (แผ่นหลัก 25 + `primary_file`), `ACCOUNTANT_WORKBOOK_OPTIONAL_COLUMNS` (`shop_branch` เท่านั้น), `ACCOUNTANT_PAYMENT_SHEET_COLUMNS`, `ACCOUNTANT_WITHHOLDING_SHEET_COLUMNS`, `ACCOUNTANT_FILES_SHEET_COLUMNS` + ป้ายไทย (spec §7.2)
  - ย้าย `PAYMENT_METHOD_LABELS` → `EXPENSE_PAYMENT_METHOD_LABELS` เท่านั้น จาก `apps/web/src/features/expenses/expenses.model.ts:999-1005` (คำเดิมทุกตัว); `expenseCurrencyLabel(code)` (`Intl.DisplayNames(['th'], { type: 'currency' })`, ไม่รู้จัก → `สกุลเงินอื่น`)
  - `AccountantPackageResult` + `indexFileName`, `paymentRowCount`, `withholdingRowCount`; `@deprecated` ที่ `columnSet`, `ACCOUNTANT_INDEX_SUMMARY_COLUMNS`, `accountantIndexColumns`; JSDoc ของ `indexCsv`/`indexRows` = projection รุ่นแรกที่ตรึงไว้ (spec §7.1, G8)
- `apps/web/src/features/expenses/expenses.model.ts`: re-export แผนที่วิธีจ่ายจาก contracts; ไม่ย้าย posting labels/errors
- ห้ามแตะ `ACCOUNTANT_INDEX_COLUMNS`/`ACCOUNTANT_INDEX_COLUMN_LABELS`

Verify: `pnpm --filter @watchdog-bms/contracts build && bash scripts/local-proof/tsc.sh web`

### 1.2 Tax: projection หัก ณ ที่จ่ายใช้ร่วม (R8/R9/R13)

- `apps/api/src/modules/tax/domain/logic/` ไฟล์ใหม่หรือข้าง `expense-payment-withholding.logic.ts`: `withholdingFormFor(kind, filingRoute): 'PND2'|'PND3'|'PND53'|null` ยกจาก `sync-tax-events.use-case.ts:60-77` (ไม่เปลี่ยนพฤติกรรม sync — sync เรียกฟังก์ชันนี้)
- `apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.ts:70`: `findConfirmedWithWhtByCompany(companyId, since?, filter?: { expenseIds?: string[] })` — `[]` return `[]` ก่อน query; nonempty เพิ่ม `id: { in: expenseIds }`; omitted filter/omitted IDs = ผลเดิม. ปรับ `ExpenseSourcePort` ใน `apps/api/src/modules/tax/domain/ports/source-reader.port.ts:127` ด้วย; `SyncTaxEventsUseCase.execute` ที่ `:277` ยังส่งสอง arguments เดิม
- `apps/api/src/modules/tax/tax.module.ts:68`: เพิ่ม `ExpenseSourceAdapter` ใน `exports`
- `apps/api/src/modules/tax/application/services/withholding-filing-validation.ts:86-110`: ยกการตรวจรายแถว (ผู้รับเงิน/เลขประจำตัว/สาขา/ที่อยู่และความยาว, หมวดรู้จักและตรงแบบ, อัตรา/ภาษี, ประเภทผู้รับเงิน) เป็นฟังก์ชันบริสุทธิ์ `withholdingRowFaults(event, ctx)` คืนรายการข้อผิดเป็นคำไทยเดิม; `validateWithholdingFiling` เรียกฟังก์ชันนี้ (ผลเดิมทุกกรณี — เทสต์ใน `generate-tax-filing-package.use-case.spec.ts`)
- Tests **ก่อนแก้** `src/modules/tax/application/use-cases/sync-tax-events-wht-form.use-case.spec.ts` (ลงทะเบียนแล้ว): `withholdingFormFor` ครบทุกกรณีเดิม; **"WHT selection distinguishes empty from omitted IDs"**: adapter `[]` ไม่มี query/rows, `[A]` ไม่คืน B, omitted/`{}` คงผลเดิม และ sync ยังเรียกโดยไม่ส่ง selection; จ่ายสองงวด → สองแถว 500/15; `SEPARATE_PND2`; บรรทัดเก่าสองอัตรา; ฐานกรอกเอง 270.50; หักแบบยอดเงิน → อัตรา null; การจ่ายไม่ยืนยันวันที่ → ไม่มีแถว

Verify: `pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/tax/application/use-cases/sync-tax-events-wht-form.use-case.spec.ts` + `bash scripts/local-proof/tsc.sh api` (ใช้สคริปต์แพ็กเกจ — `tsc` เปล่า OOM)

### 1.3 Pure logic workbook (R1–R7/R10–R12)

`apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts` (ไม่แตะ `buildAccountantIndexRow`/`buildAccountantIndexCsv`):
- types `AccountantWorkbookRow`, `AccountantPaymentRow`, `AccountantWithholdingRow`, `AccountantWorkbookFile` (`expenseNumber`, `kind`, `path`, `part`, `version?: 'current'|'superseded'`, `replacedBy?`, `skippedReason?`)
- `vendorBranchLabel`, `shopBranchLabel`, `accountantNotes`, `primaryFileCell(file, currentPart)`, `paidAtLabel(paidAt, confirmed)`
- `buildAccountantWorkbook({ rows, payments, withholding, files?, part?, visible, about })` → แผ่นตาม spec §7.2 (แผ่นที่ไม่มีแถวไม่ใส่); `buildWorkbook` เดิม; ลิงก์ `HYPERLINK("<relative path>","<relative path>")` (escape `"` แบบเดิม); เงิน style 3; วันที่ `formatThaiExportDate`; ข้อความช่องว่าง R5
- ย้ายผู้เรียก `buildAccountantIndexXlsx` ทั้งหมดก่อนลบ:
  - `src/modules/expenses/domain/logic/expense-export.logic.spec.ts:7,47-49,259,285,298,313`
  - `src/modules/expenses/domain/logic/expense-document.logic.spec.ts:7,402,419,435` (เลิก `'summary'`)
  - `src/common/export/thai-date.logic.spec.ts:11,80` (**ไม่ลงทะเบียนโดยตรง**; แก้ caller เดิม แล้วรันผ่าน registered `expense-export.logic.spec.ts:3`; ไม่เพิ่ม assertions ในไฟล์นี้)
- Tests (`expense-export.logic.spec.ts`, `expense-document.logic.spec.ts`): หัวทุกแผ่น; scan ทุกเซลล์ไม่มี `http`/`/companies/`/cuid/enum อังกฤษ; ทุกแถวของตาราง spec §7.3; `primary_file` 4 แบบ; ตามเงื่อนไข; **CSV golden ปัจจุบัน (`expense-export.logic.spec.ts:277-284`) ผ่านทุกไบต์สำหรับ rows/artifacts เดียวกันตาม R10**

Verify: commands V-LOGIC and V-DOCLOGIC below + `bash scripts/local-proof/tsc.sh api`

Re-anchor test in 1.3: retain the existing `src/modules/expenses/domain/logic/expense-export.logic.spec.ts:119-137` date cases; extend **workbook retains unusual document dates and unread-date fallback** to the new builder. `implausible` keeps date/month and review note; `unverified` stays unknown, using upload month. Current CSV goldens use e7c422802. No reimplementation of `documentDateWhere`.

### 1.4 Use-case + ZIP (R8–R13/R22; after 0.1, 0.2, 1.1–1.3)

`apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts`:
- `bundleContents`: ย้ายการตั้งชื่อเดิม (:383-430) เป็น `legacyBundleFileName(...)` ทุกบรรทัด; เพิ่ม `fileName` ใหม่ตาม spec §7.4; `BundleFile` เก็บทั้งสองชื่อ + `part` หลังแบ่งชุด + `version`/`replacedBy` ของใบรับรองแทนใบเสร็จ (จาก `isHistorical`/`substituteReceiptStatus` ของ attachment); ZIP ใช้ `fileName`; `indexRows[i].bundle_file_names` (:237) ใช้ `legacyFileName` → การเปลี่ยนชื่อ ZIP ไม่เปลี่ยนค่า CSV ของไฟล์ที่ยังผ่าน R8
- `createIndex` อ่านเพิ่ม (คิวรีละครั้ง ทุกตัวมี `companyId`):
  - การจ่าย: `expensePayment.findMany({ where: { companyId, status: 'RECORDED', expenseId: { in } } })` → `last_paid_at` (max `paidAt` + `paidAtConfirmed` ของรายการล่าสุด) และแถวแผ่น `การจ่าย` (ช่วงวันที่เดียวกับ `payments` เดิม :351-352)
  - ใบสำคัญจ่ายต่อการจ่าย: `disbursementVoucherLine.findMany({ where: { companyId, expensePaymentId: { in } }, select: { expensePaymentId, voucher: { select: { documentNumber, status } } } })` (ตารางมี `companyId` [schema.prisma:2886](../../apps/api/prisma/schema.prisma)) เฉพาะเมื่อ `visible.vouchers` และใบสถานะ `PAID`
  - หัก ณ ที่จ่าย (**new reads, test first**): inject `ExpenseSourceAdapter`; source candidates are added only inside `bundleContents`, never by unioning IDs in `createIndex`:
    - Query `whtFilingLine` candidates for `sourceType: 'expense.record'`, `filing: { companyId, status: 'FILED', periodKey: { in: monthsOf(range) } }` (no month predicate for all dates). A present selection may narrow this query and `[]` skips it, but that is only an optimization.
    - Merge candidate source IDs with payments + all paid-voucher line IDs + handoffs into the **same complete `extraIds`** before 0.1's intersect. Keep the explicit-page clearing at `:372` and scoped `listSharedEvidence` loader at `:374-375` unchanged. Preserve full `voucher.lines` and all-source guards at `:404`/`:421`.
    - In `createIndex`, compute `loadedRowIds = page.rows.map(row => row.id)` only after loading. Pass that exact array to **both** reads: `findConfirmedWithWhtByCompany(ctx.companyId, undefined, { expenseIds: loadedRowIds })` and `whtFilingLine.findMany({ where: { sourceType: 'expense.record', sourceId: { in: loadedRowIds }, filing: { companyId: ctx.companyId, status: 'FILED' } }, ... })`. Empty array produces no rows (or skip both); never omit the filter on empty. Do not reuse the original main-sheet ID set at `:339`, the entire request selection on a page, or raw candidates.
    - Both reads cover all payment dates/FILED periods of those loaded rows; date filtering comes only after the coverage decision below. Explicit pages add the `หน้า` row in `เกี่ยวกับไฟล์นี้`.
    - ตัดสินการครอบบนชุดเต็มด้วย `filedLineCoversPayment(line, row)` (`withholding-filing-state.ts:60-65` — บรรทัดไม่มีคีย์ครอบทุกการจ่ายของแหล่ง; คีย์รวมครอบคีย์ `:line:` ที่แยกภายหลัง)
    - แล้วจึงกรอง: บรรทัดที่ยื่นแต่ละบรรทัด (ไม่ซ้ำตาม `id`) ออกเมื่อ `payment[2]` (วันตามเขตเวลาร้าน) อยู่ในช่วง → แถวจาก `lineJson.payment` + `ยื่นแล้ว`; แถวสดที่ไม่ถูกครอบออกเมื่อวันที่จ่ายอยู่ในช่วง; แถวสดที่ถูกครอบไม่ออกเลย — นับตัวที่วันที่จ่ายอยู่ในช่วงแต่ตัวครอบอยู่นอกช่วง → `coveredOutsideRangeCount` ให้แผ่น `เกี่ยวกับไฟล์นี้`
    - แถวสดที่ไม่ถูกครอบ (หลังกรอง) แยกสถานะต่อ:
      - งวดแบบนั้นปิด (`taxPeriod` `FILED|PAID|CLOSED` ของ `formPeriodKey(form, date)`) → `งวดปิดแล้ว ตรวจกับแบบที่ยื่น`
      - งวดเปิด: เงื่อนไขที่ sync ไม่สร้าง event (`sync-tax-events.use-case.ts:283-304`) + `withholdingRowFaults` → `ยังไม่ยื่น · ต้องตรวจ: <ข้อผิดแรก>`; ไม่มีข้อผิด → `ยังไม่ยื่น · ข้อมูลครบตามแบบ` (ไม่ใช้คำ `พร้อมยื่น`)
    - `withholdingFormFor` + `whtIncomeCategory.findMany({ where: { code: { in } } })` (catalog กลาง ไม่กรอง companyId) + handoff `SYSTEM_ISSUED`/`EXTERNAL_LINKED` (ขอบเขตสาขาแบบ :368) เมื่อมีสิทธิ์ wht; นับการจ่ายที่ไม่ยืนยันวันที่
  - ใบรับรองแทนใบเสร็จ: เดินสาย `correctionOfEvidenceId` ไปข้างหน้าจาก `certificates` ของแถว (A→B→C); ปลายสายเป็น `ISSUED` → ทุกใบก่อนหน้าเป็น `ฉบับเดิม (มีฉบับใหม่แทนแล้ว)` และ `แทนด้วย` = ปลายสาย; ปลายสายไม่ใช่ `ISSUED` → `ยกเลิกแล้ว (ไม่มีฉบับใหม่)` (spec §7.2 แผ่น 4)
  - สาขา: select `{ id, name, taxBranchCode, isVatEstablishment }` + `branch.count({ where: { companyId } }) > 1`
  - สกุลเงิน: `r.currency` ใส่ `AccountantWorkbookRow`
- `downloadBundle`: อ่านไฟล์ก่อน (เดิม) → ส่ง `{ part, included, skipped }` ให้ `createIndex` → ลิงก์เฉพาะชุดนี้; `ไฟล์ทั้งหมด` ครบทุกชุด
- `indexFileName`, ชื่อ ZIP ใหม่, `paymentRowCount`, `withholdingRowCount`; audit `workbook: 'accountant-v2'`
- `apps/api/src/modules/expenses/expenses.module.ts`: ไม่ต้องเพิ่ม import (TaxModule อยู่แล้ว :137)

Tests (`src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts` ชุด `CreateAccountantPackageUseCase` :1083): 61 ไฟล์ → 2 ชุด ลิงก์เฉพาะชุด; 404 → `ไม่ได้รวม: ไม่พบไฟล์`; ชื่อไฟล์ใหม่ไม่มี id **และ `indexCsv` ยังเป็นชื่อรุ่นแรก**; ไม่มี `expense.disbursement.read` → ไม่มีคอลัมน์ใบสำคัญจ่าย; external handoff → เลขขึ้นแผ่นหัก; ทุก sold tier → ไม่มี posting columns/errors แม้ fixture มีค่าจาก ledger เดิม; 2 สาขา → `สาขาของร้าน`; แผ่นหักตรงกับแถว projection ทุกช่อง (จ่ายสองงวด, ภ.ง.ด.2); ยืนยันวันที่จ่ายใหม่ → `วันที่จ่ายล่าสุด` ใหม่; USD → `ดอลลาร์สหรัฐ`; ใบรับรองฉบับเดิม/ใหม่ และยกเลิกไม่มีใบใหม่; มีแต่การจ่าย → `rowCount 0`, `paymentRowCount > 0`; **บิลกันยายนจ่ายตุลาคม** → แผ่นหัก/การจ่ายของไฟล์ตุลาคมมีแถว; **แถวที่ยื่นแล้ว + แก้ที่อยู่ทะเบียนคู่ค้า** → แสดงที่อยู่ตามภาพที่ยื่น; **(R3-F3) ยื่นกันยายนแบบไม่มีคีย์ + งวดจ่ายตุลาคม** → ไฟล์กันยายนมีแถวที่ยื่นครั้งเดียว, ไฟล์ตุลาคมไม่มีแถวกันยายนและไม่มีแถวสดตุลาคม, `coveredOutsideRangeCount` = 1; **(R3-F3) ยื่นสำหรับการจ่ายตุลาคม แล้วแก้วันที่จ่ายเป็นพฤศจิกายน (บิลลงวันที่กันยายน)** → ไฟล์ตุลาคมมีแถว `ยื่นแล้ว` (มาจากชุดแหล่งส่วน filing), ไฟล์พฤศจิกายนไม่มี; รายการสาขาอื่นที่มีบรรทัดยื่นในเดือนเดียวกันไม่หลุดเข้าไฟล์ของผู้ใช้สาขาเดียว; **(RC-F1) A และ B ยื่นตุลาคม, `pageSize: 1`** → หน้า 1 มีแถวที่ยื่นของ A เท่านั้น หน้า 2 ของ B เท่านั้น รวมสองหน้าอย่างละครั้ง, แผ่น `เกี่ยวกับไฟล์นี้` มี `หน้า`; ไม่แบ่งหน้า/ZIP → A และ B อย่างละครั้ง; **(RC-F2) ขยาย test ชื่อเดียวกับ 0.1 ให้มี V(A,B) และ filed A/B: `['A']` เฉพาะ A ทุกแผ่น/manifest/ZIP; `[]` ไม่มี WHT reads/rows, 0 parts และ download 404; omitted ครบครั้งเดียว; explicit pages และหน้าว่างใช้ loaded IDs ของหน้านั้นเท่านั้น; assert query arguments ของ WHT ทั้งสอง read;** งวดปิด / ไม่รู้ประเภท / ไม่มีเลขผู้เสียภาษี / ต่างสกุล → สถานะถูก

Verify: spec + api typecheck + lint

### 1.5 DTO (R13; after 1.4)

- `apps/api/src/modules/expenses/presentation/http/expense.dtos.ts`: `export class AccountantPackageDto extends AccountantEvidenceBundleDto { @IsOptional() @IsIn(['summary','full']) columnSet?; @IsOptional() @IsIn(['csv']) format?; @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?; @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) pageSize?; }` (ใช้ pattern ตัวเลขที่ DTO อื่นในไฟล์นี้ใช้)
- `expense.controller.ts:274-278` ใช้ DTO นี้
- Tests `src/modules/expenses/presentation/http/expense.dtos.spec.ts` กับ `GLOBAL_VALIDATION_PIPE_OPTIONS` (`src/common/pipes/validation-pipe.options.ts`): `expenseIds: "x"` ปฏิเสธ; `{ page: 2, pageSize: 100 }` ผ่าน; `pageSize: 501` ปฏิเสธ; body เดิมของเว็บทั้งสองหน้า ผ่าน

Verify: spec + `pnpm --filter @watchdog-bms/api lint`

---

## Phase 2 — เว็บ + journey

### 2.1 หน้ารายการ (R14; after 1.5; Q1 answered 2026-11-04 — ไฟล์เดียวสำหรับนักบัญชี)

- `apps/web/src/features/expenses/ExpensesPages.tsx`: ลบ `columnSet` state (:2739) + select (:3008-3013) + ส่ง `columnSet` (:2927); เงื่อนไขว่าง (:2931) → `rowCount + paymentRowCount + withholdingRowCount === 0`; ลบข้อความข้ามไฟล์ (:2935-2937); `downloadIndexXlsx(result, result.indexFileName)`; T1 ผ่าน `EvidenceBundleDownload`
- `apps/web/src/common/i18n/workspace-dictionary.ts`: ลบ `expenses.export_columns*` (th/en) ถ้าไม่มีผู้ใช้อื่น
- `packages/contracts/src/expenses.ts`: ลบ `ACCOUNTANT_INDEX_SUMMARY_COLUMNS`/`accountantIndexColumns` (API เลิกใช้ใน 1.3)
- Tests: `apps/web/src/features/expenses/ExpenseList.rendered.spec.ts`

### 2.2 หน้าหลักฐาน + ปุ่มชุดเอกสาร (R14; after 1.5)

- `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:899-915`: เอา `MoreActions` ออก วางปุ่มรอง "ดาวน์โหลด Excel" ข้างปุ่มชุดเอกสาร (`ActionGroup` เดิม ขนาดเท่ากัน); **ปุ่มปิดเฉพาะ `exporting || loading`** (เอา `!visibleRows.length` ที่ :904 ออก — เดือนที่มีแต่การจ่ายต้องกดได้ แล้วบอกผลเมื่อกด); เงื่อนไขว่าง (:773) แบบ 2.1; toast T5; `indexFileName`
- `apps/web/src/features/expenses/EvidenceBundleDownload.tsx`: `เอกสารค่าใช้จ่าย N` / `หลักฐานการจ่าย N`; T1 เมื่อ `plan.fileCount > 0`
- Tests: `EvidenceBundleDownload.spec.ts`, `EvidencePanel.qa.spec.ts`

Verify 2.1–2.2: `bash scripts/local-proof/tsc.sh web && pnpm --filter @watchdog-bms/web test`

### 2.3 E2E + journey (R14/R21; after 2.1–2.2)

- `e2e/expenses.spec.ts`:
  - EXP-EXPORT (:1235-1276): ไม่มี combobox `รายละเอียดในไฟล์`; body ไม่มี `columnSet`; ขนาด 390/1280/1556
  - EXP-20/21/22/23 (:1136-1210, `chooseFullColumns` :1141): เปลี่ยนตัวตรวจเป็นลำดับวันที่ (`dateOrder`) — กดเรียงเก่าไปใหม่ แล้วตรวจว่าคงค่า (EXP-20) / กลับเป็นใหม่ไปเก่า (EXP-21/22/23)
- `e2e/journeys/evidence-and-settings.journey.spec.ts:65-82`: ปุ่มชื่อใหม่ "ดาวน์โหลด Excel" (:67); เพิ่ม helper คืน buffer เต็มใน `e2e/journeys/journey-kit.ts` ข้าง `pressForDownload` (:200); unzip xlsx ตรวจหัวทุกแผ่น + ไม่มี `HYPERLINK("http`; ZIP มี `สารบัญ.xlsx` และไม่มีชื่อที่มี cuid
- ขั้นเตรียมใน journey: รายจ่ายหัก 3% จ่ายสองครั้งในสองวัน (ไม่แตะ seed)

Verify: รันเฉพาะสองไฟล์นี้บน local stack (สูตร `local-dev-server-recipe` ในหน่วยความจำ); บันทึกผลจริง

### 2.4 R21 — หลักฐานหน้าจอจริง (controller ทำเอง — thai-ux-standard.md §7)

- เปิด dialog/การ์ดที่ 390, 1280, ~1,556 px ถ่ายภาพ วัดปุ่ม (สูง/กว้างเท่ากัน) กดผ่านหนึ่งรอบรวมหนึ่งทางผิด (กดเดือนว่าง)
- แตก ZIP จริง (≥ 61 ไฟล์ ได้ 2 ชุด) เปิด `สารบัญ.xlsx` บน Excel Windows, Excel Mac, LibreOffice กดลิงก์สามชนิด — บันทึกผล; ถ้า Windows ไม่รับ `/` → ข้อความอย่างเดียว แล้วแก้ spec §5.5
- W00: `pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts` ผ่านโดยไม่ regenerate

---

## Phase 3 — ไฟล์อื่น + เลขที่เอกสาร (ขนานกับ Phase 2 ได้)

Phase 3.1 (E5) removed, not deferred: no edits to accounting-documents contracts, ledger API, `IncomeExpenseLedgerPage.tsx` or its tests. See spec §14.1 for the removal check; no remaining step depends on it.

### 3.2 R15 — ไฟล์ ภ.ง.ด. ให้ผู้ทำบัญชี (E6)

- `apps/api/src/modules/tax/application/services/withholding-accountant-export.ts:32-45`: หัว `อัตรา (%)`; แผ่น `ภ.ง.ด.2` เฉพาะเมื่อมีแถว; **สกุลเงิน (B25)**: คอลัมน์ `สกุลเงิน` จาก `event.currency` และแถว `รวม` แยกต่อสกุล (หนึ่งแถวต่อสกุล) แทนการบวกข้ามสกุล (:41)
- Test: `src/modules/tax/application/use-cases/generate-tax-filing-package.use-case.spec.ts` — event THB + USD หมวด `SEPARATE_PND2`

### 3.3 R17 — เลขที่เอกสารปลอมผ่านการตรวจ (B17)

- `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts:1692-1706`: นอกจากสลิป ให้ `invalid` เมื่อ `digitRuns.length === 0` หรือเมื่อไม่ผ่านทั้งสองทาง: (ก) ค่าที่ตัดช่องว่างและ `-._` ทั้งก้อนปรากฏใน `collapsedText` ที่ตัดแบบเดียวกัน; (ข) ค่าเป็น `A/B` และพบ `A` ตามหลังป้ายเล่มที่ กับ `B` ตามหลังป้ายเลขที่ ในข้อความ (คงกติกาประกอบเล่มที่/เลขที่ของ 19j [expense-receipt-upload-spec.md:1492](../../docs/specs/expense-receipt-upload-spec.md)); คงกติกาวันที่เต็มและความยาวเดิม
- Tests: `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.spec.ts` (อยู่ในสคริปต์ `test` ของ ai-gateway): `FAKE` ลบ; `FAKE-180` ที่มีแค่ยอด 180 ลบ; `INV-0012` เมื่อข้อความพิมพ์ `INV - 0012` ผ่าน; `เล่มที่ 12 เลขที่ 345` → `12/345` ผ่าน; `12/345` ที่ไม่มีป้ายเล่มที่/เลขที่และไม่ปรากฏทั้งก้อน ลบ; `123/2569` ผ่าน; สลิปเดิมไม่เปลี่ยน
- Verify: spec ข้างบน + `pnpm --filter @watchdog-bms/ai-gateway typecheck` + `node scripts/run-line-ai-whole-chain-acceptance.mjs` ก่อน push; W00 ไม่ต้อง regenerate (ไฟล์นี้ไม่อยู่ในรายการ hash)

### 3.4 R18 — handoff 50 ทวิ ของบุคคลธรรมดาใช้แบบตามหมวด (B22)

- `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts:5040-5041`: `formType` ของ prefill = `withholdingFormFor(vendorEntityKindSnapshot, category.filingRoute)` (ฟังก์ชันจาก 1.2) แทน `INDIVIDUAL → 'PND3'`
- `apps/api/src/modules/tax/application/use-cases/wht-certificate-handoff.use-case.ts:211`: ตัวกรองรับ `PND2` ด้วย (คำปฏิเสธเดิมเพิ่ม ภ.ง.ด.2)
- สัญญา/หน้าจอ handoff: เพิ่มชนิดเฉพาะของ handoff `WhtHandoffFormType = 'PND2' | 'PND3' | 'PND53'` ใน `packages/contracts/src/tax.ts` (ใช้ที่ handoff `formType` :476 และตัวกรอง) **โดยไม่แก้ชนิดที่ใช้กับการออกใบในระบบ** (`:55`); เว็บ `apps/web/src/features/expenses/WhtCertificatesPage.tsx:43` ป้าย `ภ.ง.ด.2` (แทน `ยังไม่รู้แบบภาษี` สำหรับค่านี้), การอ่าน `formType` จาก URL และตัวเลือกกรองมี ภ.ง.ด.2; ปุ่มออกใบในระบบสำหรับ ภ.ง.ด.2 ยังปฏิเสธพร้อมทางออกเดิม
- Tests เว็บ: `apps/web/src/features/expenses/WhtCertificatesPage.spec.ts` — ป้าย/ตัวกรอง/URL ภ.ง.ด.2
- ซ่อมแถวเดิม: สคริปต์ครั้งเดียวใน `apps/api/src/scripts/` (แบบสคริปต์ซ่อมที่มีอยู่) แก้ `prefillSnapshotJson.formType` ของ handoff สถานะ `REQUIRED` ที่หมวดเป็น `SEPARATE_PND2` และผู้รับเป็นบุคคล; ไม่แตะแถวที่ออกใบแล้ว; **คงการปฏิเสธการออกใบในระบบสำหรับแบบที่ระบบไม่รองรับ** (ตรวจ guard ของ `IssueWhtCertificateFromHandoffUseCase` ก่อน — ถ้าออก 50 ทวิ ภ.ง.ด.2 ไม่ได้ ต้องยังปฏิเสธพร้อมคำบอกทางออก)
- Tests: `src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts` (PostgreSQL จริง), `src/modules/tax/application/use-cases/wht-certificate-handoff.use-case.spec.ts`

### 3.5 R19 — PDF ทาง LINE ที่สร้างงานอ่านไม่สำเร็จ (B23)

Re-anchor: B23 still exists at `process-line-webhook.use-case.ts:11136-11140`/`:11212`; free PDFs take the same file path (`:9931-9939`). Apply the queue-failure change only when a read was requested, not `persistLineFileExpense(..., read: 'none')` (`:11243-11244`). Preserve `freeExpenseAttachmentSource` (`apps/api/src/modules/data-model-core/application/use-cases/free-expense-attachment.ts:14-35`) and existing quota admission/refund. Add free and paid fixtures to the named test: retry the same source, exhausted/in-flight allowance, failed/unusable read releases reservation, usable-result delivery retry does not read/count twice. Keep D04 model-free controls and the actor's original company; do not reset allowance after welcome/advisor or upgrade.

Keep existing confirmation suppression (`process-line-webhook.use-case.ts:3717-3731`, commit `3f6db1729`): receipt retry is not authority to resend an accepted financial confirmation. Keep company-switch queue order (`line-message-buffer.service.ts:506-516`); run registered `src/modules/line-ai/application/line-message-buffer.service.spec.ts` with **company selection stays ordered while receipt result delivery is pending**. No buffer rewrite.

- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:11136-11140`: เก็บผล `readJobId`; `:11212` (และจุดเรียก `fileStoredReply` อื่น :11178, :12587): ถ้า `readJobId === null` ตอบการ์ดปุ่ม (LINE ใช้ปุ่ม ไม่ใช้รายการตัวเลข) ข้อความ `เก็บไฟล์แล้วค่ะ กดเริ่มอ่านอีกครั้งได้เลย` + ปุ่ม `เริ่มอ่านอีกครั้ง` (postback ผูก `expenseId` + `attachmentId` ของร่างเดิม แบบ postback ที่ลงนามซึ่งมีอยู่) และ `fileStoredReply` เดิมใช้เฉพาะเมื่อมีงาน
- **ไม่ใช้ "ส่งไฟล์เดิมอีกครั้ง" เป็นทางออก**: การกันซ้ำใช้ `lineMessageId` (:11175) ข้อความใหม่จึงสร้างร่างใหม่ (`expense-upload.use-case.ts:163` `existing ?? await createExpense()`); การแยก "LINE ส่ง webhook ซ้ำ" (message id เดิม — คืนร่างเดิม) ออกจาก "คนส่งไฟล์ซ้ำ" (message id ใหม่ — ร่างใหม่ที่ระบบจับซ้ำด้วย checksum ตามเดิม) คงไว้
- postback `เริ่มอ่านอีกครั้ง`: ตรวจเจ้าของร่าง/แชต/สาขาแบบเดียวกับเส้นทางกันซ้ำ (`expense-document.use-case.ts:124-131`), ร่างยังไม่มีงานอ่าน → `queueExpenseRead` (idempotent ด้วย checksum ของไฟล์) แล้วตอบข้อความเดิม (กำลังอ่าน); สร้างไม่สำเร็จอีก → การ์ดเดิม; มีงานแล้ว → บอกสถานะเดิม
- Tests: `src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` (ลงทะเบียน): `queueExpenseRead` throw → การ์ดปุ่ม; กดปุ่ม → งานอ่านถูกสร้างครั้งเดียวกับร่างเดิม; **สอง message id ต่างกันที่ไฟล์เดียวกัน → สองร่าง (พฤติกรรมเดิม) และปุ่มของร่างแรกไม่สร้างร่างใหม่**; webhook ซ้ำ message id เดิม → ร่างเดิม
- Verify: spec + api typecheck + **W00: ไฟล์นี้ถูก hash** → `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1` แล้วรัน `line-ai-capability-manifest.spec.ts` + `node scripts/run-line-ai-whole-chain-acceptance.mjs`
- ข้อความใหม่ตารางพื้นผิว × กรณี: งานสร้างไม่สำเร็จ → การ์ดปุ่ม จริง; งานสร้างสำเร็จ → ข้อความเดิม; กดปุ่มแล้วสร้างได้ → ข้อความเดิม (กำลังอ่าน) จริง; กดปุ่มแต่มีงานแล้ว → บอกสถานะงาน จริง

### 3.6 R20 — การจับตัวตนผู้ขายฝั่ง gateway (B27, B28)

- `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts:1712-1718`: รหัสสาขาต้องพบ**ตามหลังป้ายสาขา** (`สาขาที่`/`สาขา`/`Branch`) ในข้อความฝั่งผู้ออก ไม่ใช่แค่เป็นสตริงย่อย (กันชนกับเลขผู้เสียภาษี/ที่อยู่); ใบพิมพ์สำนักงานใหญ่ → `00000` ชนะค่าที่โมเดลตอบ
- `apps/ai-gateway/src/modules/line-ai/domain/logic/expense-capture-read.logic.ts:560-570`: บล็อกคู่กรณีอื่น (`ผู้ป่วย`/`ลูกค้า`/`buyer`…) กลับเป็นฝั่งผู้ขายเฉพาะเมื่อมีหลักฐานระบุผู้ออก; บรรทัดว่างหรือเลขผู้เสียภาษีลอย ๆ ไม่พอ ต้องกันข้อมูลผู้ซื้อ/ผู้ป่วยก่อนกู้ส่วนท้ายใบ
- Tests: `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.spec.ts` (ลงทะเบียน): `00016` ในเลข `0994000163011` ถูกลบ; สำนักงานใหญ่ชนะ; หัวโรงพยาบาล + `ผู้ป่วย` + ส่วนท้ายที่ระบุผู้ออก → จับ/กู้ได้; บรรทัดว่าง/เลขผู้เสียภาษีของผู้ป่วยไม่กลับเป็นผู้ขาย; เคสเดิมทั้งหมดผ่าน
- Verify: `pnpm --filter @watchdog-bms/ai-gateway typecheck` + spec + `node scripts/run-line-ai-whole-chain-acceptance.mjs`; W00 ไม่ต้อง regenerate (ไฟล์ gateway ไม่อยู่ในรายการ hash)

Verify 3.2, 3.4: spec ที่ระบุ + api typecheck + web typecheck/test (3.4 หน้า 50 ทวิ)

---

## Phase 4 — R21: ปิดงาน

- memory: ผลคำสั่งจริง, ภาพหน้าจอ 390/1280/1556, ผลลิงก์บน Excel แต่ละโปรแกรม, ผล whole-chain
- release note หนึ่งบรรทัด (ไทยง่าย): "ไฟล์ Excel ให้สำนักงานบัญชีเหลือแค่ช่องที่ใช้ลงบัญชีและยื่นภาษี แยกแผ่นการจ่ายและหัก ณ ที่จ่าย ไม่มีลิงก์เข้าแอปแล้ว"
- รอบเอกสารนี้ไม่ commit/push หรือ deploy; การปล่อยจริงต้องมีคำสั่งและทำตาม `docs/runbooks/uat-production-v2-deployment.md`

## การตัดสินใจที่ล็อกแล้ว

1. CSV/`indexRows`/manifest คง schema/serializer ตาม R10ด้วย projection แยก — `legacyFileName` สำหรับ CSV, `fileName` สำหรับ ZIP/workbook (ผู้ประสานงาน 2026-10-24)
2. หัก ณ ที่จ่ายในไฟล์มาจาก projection เดียวกับ ภ.ง.ด. (ต่อการจ่าย ต่อบรรทัดเก่า, frozen, `paidAtConfirmed`) และแบบ ภ.ง.ด. จาก `withholdingFormFor` ที่ sync ใช้ — ไม่มีสูตรที่สอง
3. วันที่จ่าย/วิธีจ่าย/จ่ายจาก/ใบสำคัญจ่าย อ่านจากแถวการจ่ายจริง ไม่ใช่หัวเอกสาร
4. ซ่อนคอลัมน์ตามโครงสร้าง (แพ็ก สาขา สิทธิ์คนกด) ไม่ตามข้อมูลรายเดือน; แผ่นว่างไม่ใส่
5. ไม่มีลิงก์เข้าแอป ลิงก์เดียวคือ path สัมพัทธ์ใน ZIP ชุดเดียวกัน
6. ไม่มีชื่อพนักงานนอกจากผู้ที่ร้านต้องคืนเงิน (PDPA ม.22/27 ฉบับประกาศใช้)
7. คอลัมน์ VAT คงแม้ร้านไม่จด VAT; วันที่เป็นข้อความไทย (การตัดสินใจเดิม)
8. ไม่มี migration

## Execution / verification map

All API money/tax/permission regressions below are written first. Each command runs from the repository root; API paths are relative to `apps/api`. Test names and acceptance IDs are in the spec's final traceability table. No package.json edit is planned. Cleanup has no schema change, so Prisma validate/generate is not a gate for it.

| Step | Requirements | Depends on | Focused command / evidence |
|---|---|---|---|
| 0.1 | R8/R13 | none (design accepted 2026-11-04) | V-DOC + `bash scripts/local-proof/tsc.sh api`; independent commit |
| 0.2 | R22 | 0.1 | V-AUTH + V-DOC + V-LINE + API/web tsc + free journey + updated W00/whole-chain |
| S | R16 → trust/money R3 | moved 2026-11-04: done by trust/money P03 | P03's V-EXTRACT + API tsc |
| 1.1 | R1–R7/R10/R12 | 0.1 | V-LOGIC + API/web tsc after consumers compile |
| 1.2 | R8/R9/R13 | 0.1 | V-WHT + V-FILING + API tsc |
| 1.3 | R1–R7/R10–R12 | 1.1 | V-LOGIC + V-DOCLOGIC + API tsc |
| 1.4 | R8–R13/R22 | 0.1, 0.2, 1.1–1.3 | V-DOC + V-WHT + API tsc |
| 1.5 | R13 | 1.4 | V-DTO + API tsc |
| 2.1, 2.2 | R14 | 1.5; Q1 answered 2026-11-04 — remove brief/full selector, one accountant file | named web specs in those steps + `bash scripts/local-proof/tsc.sh web` |
| 2.3, 2.4 | R14/R21 | 2.1, 2.2 | V-BROWSER + desktop spreadsheet checks; V-W00 |
| 3.2 | R6/R15 | 1.1 currency helper | V-FILING + API tsc |
| 3.3 | R17 | S | V-GATEWAY + whole-chain |
| 3.4 | R18 | 1.2 | V-PAYMENT + V-HANDOFF + API/web tsc + WhtCertificatesPage.spec.ts |
| 3.5 | R19 | S | V-LINE + V-BUFFER + API tsc; regenerate W00 for this changed hashed source (as in 0.2), then V-W00 + whole-chain |
| 3.6 | R20 | S | V-GATEWAY + whole-chain |
| 4 | R21 | applicable steps and AC evidence | memory records exact results; no runtime claim from a docs review |

```sh
# V-AUTH
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/auth/auth.guard.spec.ts
# V-BUFFER
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/application/line-message-buffer.service.spec.ts
# V-DOC
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts
# V-WHT
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/tax/application/use-cases/sync-tax-events-wht-form.use-case.spec.ts
# V-LOGIC
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/domain/logic/expense-export.logic.spec.ts
# V-DOCLOGIC
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/domain/logic/expense-document.logic.spec.ts
# V-DTO
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/presentation/http/expense.dtos.spec.ts
# V-EXTRACT
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/application/use-cases/expense-extraction.use-case.spec.ts
# V-FILING
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/tax/application/use-cases/generate-tax-filing-package.use-case.spec.ts
# V-PAYMENT — require the existing local PostgreSQL gate; a skipped test is not proof
EXPENSE_PAYMENT_REQUIRE_POSTGRES=true pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts
# V-HANDOFF
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/tax/application/use-cases/wht-certificate-handoff.use-case.spec.ts
# V-LINE
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts
# V-W00
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts
# V-GATEWAY
pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx --test src/modules/line-ai/presentation/http/line-ai-internal.controller.spec.ts
# V-BROWSER — local stack, at 390, 1280 and approximately 1556 px
pnpm exec playwright test e2e/journeys/evidence-and-settings.journey.spec.ts e2e/expenses.spec.ts
```

For 3.3/3.5/3.6, keep the existing failed/unusable-AI credit-release path and notify only the actor in their own chat. Add no broadcast, owner-default notice or direct gateway database access. Test this in the named API/gateway regressions; changing a shared helper must not change procurement, VAT workspace, ledger or shop LINE OA behavior.

W00 is an existing **manual check**, not a registered package test (`grep -c` = 0); do not add assertions or new test cases to that file. Its existing frozen-artifact comparison is ancillary evidence only. No package.json edits are authorized by this plan. New API regressions use the registered files in the spec Traceability table.
