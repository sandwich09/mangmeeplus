# Accounting Software Export Spec — ส่งออกไฟล์ที่โปรแกรมบัญชีนำเข้าได้

Status: READY (docs-first) — reviewed 3 rounds + focused blocker checks 2026-10-24, no HIGH open (implementation still starts after accountant-export cleanup plan Phase 1, see the plan)
Owner: Expenses lane (controller review)
Related: backlog ข้อ 13 ใน `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md`, `docs/specs/accountant-export-cleanup-spec.md` (ข้อ 25 — ทำก่อน), `docs/plans/accounting-software-export-plan.md`, `docs/agent-memory/accountant-exports.md`, `docs/specs/expense-category-default-tax-code-spec.md`, `docs/guidelines/thai-ux-standard.md`
Baseline: main 6c54ba208 (2026-10-23)

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

## 1. ปัญหา

### 1.1 วันนี้ในระบบ

- ไฟล์ให้นักบัญชีมีแบบอ่านอย่างเดียว หนึ่งแถวต่อเอกสาร ([expense-export.logic.ts:250-272](../../apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts)); สเปกเดิมสั่ง "Do not copy or depend on a vendor-specific proprietary format" ([expense-receipt-upload-spec.md:181](expense-receipt-upload-spec.md)) — สำนักงานบัญชีต้องคีย์ใหม่ทีละรายการ (backlog ข้อ 13)
- รหัสบัญชีในมั่งมีเป็นผังของเรา `ExpenseCategory.ledgerAccountCode` ตามผัง `TH_SME_COA_V1` ([schema.prisma:2576-2606](../../apps/api/prisma/schema.prisma), [expense-category-bootstrap.service.ts:28-33](../../apps/api/src/modules/expenses/application/services/expense-category-bootstrap.service.ts)) ไม่ใช่ผังของสำนักงานบัญชี
- หมวดที่ร้านเห็นมาจาก `selectExpenseCategoryScope` ([prisma-expense.repository.ts:491-505](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)): ร้านที่ผ่าน bootstrap หมวด (มีหมวดของร้านที่ `ledgerAccountReviewedByUserId = 'system:expense-category-bootstrap'`) เห็น **เฉพาะหมวดของร้าน** ([:497-499](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)); ร้านอื่นเห็นหมวดของร้าน + หมวดกลาง (`companyId = null`) ที่ชื่อ/hint ไม่ซ้ำ — หมวดกลางใช้ร่วมหลายร้าน จึงเก็บรหัสบัญชีของสำนักงานบัญชีบนแถวหมวดไม่ได้; และรายการเก่าอาจอ้างหมวดกลางที่ตอนนี้ถูกซ่อนแล้ว
- บรรทัดรายจ่ายเก็บหมวด อัตรา VAT การยกเว้น VAT ยอด VAT และหัก ณ ที่จ่ายรายบรรทัด ([schema.prisma:2933-2958](../../apps/api/prisma/schema.prisma)); หัวเอกสารเป็นตัวจริงของยอด (`grandTotal = taxable + vat` [expense-totals.logic.ts:150-155](../../apps/api/src/modules/expenses/domain/logic/expense-totals.logic.ts)); เอกสารหนึ่งใบมีบรรทัด 7% ปนยกเว้น/0%/ไม่มี VAT ได้ ([expense-totals.logic.spec.ts:41-45](../../apps/api/src/modules/expenses/domain/logic/expense-totals.logic.spec.ts)); ยอด VAT ที่ผู้ใช้กรอกตามใบถูกเก็บไว้แม้ต่างจากอัตรา×ฐาน (ฐาน 300 VAT 21.01 [:690-697](../../apps/api/src/modules/expenses/domain/logic/expense-totals.logic.spec.ts)); ฐานหัก ณ ที่จ่ายต่างจากมูลค่าได้ (70.50 / 270.50 [:178-185](../../apps/api/src/modules/expenses/domain/logic/expense-totals.logic.spec.ts)); หักแบบกรอกยอดเงินไม่มีอัตรา ([expense-wht-input.logic.ts:8-9](../../apps/api/src/modules/expenses/domain/logic/expense-wht-input.logic.ts))
- รายจ่ายมีสกุลเงินอื่นได้ ([expense-draft.use-case.ts:166](../../apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts))

### 1.2 ผลค้นคว้ารูปแบบนำเข้า (ตรวจ 2026-10-23/24)

| โปรแกรม | สรุป | ยืนยันแล้ว | ยังยืนยันไม่ได้ | แหล่ง |
|---|---|---|---|---|
| FlowAccount — นำเข้าค่าใช้จ่าย | มี | ค่าใช้จ่าย › "นำเข้าบิลและใบเสร็จ" › .xlsx หรือ .csv; แพ็ก Standard ขึ้นไป; ≤ 500 แถวต่อไฟล์, ≤ 300 แถวต่อเลขอ้างอิง; มีขั้น "จับคู่คอลัมน์" (เลือกว่าราคารวมภาษีหรือไม่ ทั้งไฟล์); คอลัมน์บังคับ วันที่เอกสาร, รายละเอียดค่าใช้จ่าย, ผังบัญชี, ราคาต่อหน่วย, ผู้จำหน่าย; ภาษี `7%`/`0%`/`ยกเว้นภาษี` ว่าง = 7%; หัก ณ ที่จ่ายต้องครบ แบบฟอร์ม (ภ.ง.ด.3 หรือ 53) + ประเภทเงินได้ + อัตรา ไม่ครบนำเข้าไม่ได้; ต้องกรอกคำอธิบายประเภทเงินได้เมื่อเลือกข้อ 6 (อื่น ๆ), 4(ข)(2.5), 4(ข)(1.3); ใช้ได้เฉพาะบรรทัดบัญชีค่าใช้จ่ายและผู้จำหน่ายต้องมีเลขผู้เสียภาษี; **ระบุวันที่ชำระโดยไม่มีวิธีการชำระนำเข้าไม่ได้**, วิธีการชำระว่าง = ค้างจ่าย, **เอกสารที่จะออกหนังสือรับรอง (มีหัก) ต้องระบุวิธีการชำระ**, **เลขอ้างอิงเดียวกันต้องใช้ประเภทเงินได้เดียวกัน**; แถวเลขอ้างอิงเดียวกัน = เอกสารเดียว (ข้อมูลระดับเอกสารต้องตรงกัน); **ผู้จำหน่ายต้องมีอยู่แล้ว** (ไม่สร้างให้); ผังบัญชีรูปแบบ "เลข / ชื่อบัญชี" | หัวคอลัมน์/ลำดับจริงของแม่แบบ (ต้องล็อกอิน); เซลล์วันที่แบบไหนอ่านได้; ผู้จำหน่ายใส่ชื่ออย่างเดียวได้ไหม; ข้อความตัวเลือกประเภทเงินได้; มีคอลัมน์ยอด VAT ไหม / FA ปัดเศษ VAT รายบรรทัดหรือท้ายเอกสาร; ค่าวิธีการชำระที่รับ (บัตร/อื่น ๆ) | https://flowaccount.com/help-center/category/expense/import-expense (อ่านเอง 2026-10-23, ผู้ประสานงานตรวจซ้ำ 2026-10-24) |
| FlowAccount — AI Connector | มี | ใช้ได้ทุกแพ็กเกจ ("แพ็กเกจไหนก็ใช้ได้") | ความสามารถสร้างค่าใช้จ่ายครบหรือไม่ | https://flowaccount.com/functions/ai-connector (ผู้ประสานงานตรวจ 2026-10-24) — **นอกขอบเขต** |
| FlowAccount — OpenAPI | มี `POST /expenses` | ต้องใช้แพ็ก Pro Business ตามรอบค้นคว้า (**ไม่ได้เปิดซ้ำ**) | — | https://flowaccount.com/developers — **นอกขอบเขต** |
| PEAK | มี | รายจ่าย › นำเข้าเอกสาร › "รูปแบบ PEAK" › บันทึกค่าใช้จ่าย › "ดาวน์โหลดไฟล์ตัวอย่าง บันทึกค่าใช้จ่าย (.xlsx)"; ให้อ่าน Description ในไฟล์; ฟิลด์บนจอ: วันที่เอกสาร, ผู้รับเงิน/คู่ค้า, เลขที่/วันที่ใบกำกับฯ, ประเภทราคา, ค่าใช้จ่าย/บัญชี, คำอธิบาย (≤ 1,000), จำนวน/ราคา (≤ 4 ตำแหน่ง), ภาษี, หัก ณ ที่จ่าย, ภ.ง.ด., ชำระโดย, ชำระเงิน (0 = ตั้งหนี้) | หัวคอลัมน์/ลำดับ/รหัสของแม่แบบ (ในแอปเท่านั้น); แพ็กและเพดานแถว (รายงาน Pro Plus/5,000 แถว — เปิดซ้ำไม่ได้) | https://www.peakaccount.com/peak-manual/peak-others/import-documents/import-expense-record , https://intercom.help/peak/en/articles/7324017-import-expense-ne004 |
| Express (เอ็กซ์เพรส) | **มีโปรแกรมเสริม** | ผู้ดูแลของ ESG โพสต์ 3 ม.ค. 2567 ว่ามี "โปรแกรมเสริมสำหรับการนำเข้าข้อมูลจากไฟล์ Excel" ครอบคลุม "ทั้งบิลซื้อ บิลขาย" (บทความเคล็ดลับเก่าที่บอกว่านำเข้าเฉพาะข้อมูลหลัก https://esg.co.th/tiptech/showcont.php?clid=113 ไม่มีวันที่และถูกแทนแล้ว) | แม่แบบ/คอลัมน์/ราคาของโปรแกรมเสริม | https://esg.co.th/phpBB3/viewtopic.php?f=1&t=18976 (ผู้ประสานงานตรวจ 2026-10-24) |
| SAP Business One (DTW) | มี | DTW ใช้ไฟล์ `*.txt` และ `*.csv` (หรือ ODBC) ไม่ใช่ xlsx | คอลัมน์ | https://help.sap.com/docs/SAP_BUSINESS_ONE/25bde9551224405e84e69c760e272e89/4925e081b34d14cde10000000a42189b.html?locale=es-ES |
| TRCloud, WINSpeed, Formula, MAC-5, Bplus, AccRevo | TRCloud มีนำเข้ารายการบัญชี | — | คอลัมน์ทั้งหมด | https://www.trcloud.co/tips-item.php?id=234 (รอบค้นคว้า) |
| แบบรายงานภาษีซื้อ (กรมสรรพากร) | — | คอลัมน์ตามแบบแนบท้ายประกาศ VAT ฉบับ 202 (accountant-export-cleanup-spec §5.2) | — | https://rd.go.th/27985.html , https://www.rd.go.th/fileadmin/images/image_law/images/vat-202-02.pdf |

### 1.3 การตัดสินใจจากหลักฐาน

1. **"สมุดรายวันซื้อ" ก่อน** — ไม่ขึ้นกับสิ่งที่ยืนยันไม่ได้, คงยอดเงินทุกตัวตามที่บันทึก (VAT บนใบ ฐานหัก) จึงไม่มีกรณีที่แสดงไม่ได้; ใช้คีย์มือหรือจับคู่คอลัมน์ในโปรแกรมใดก็ได้ที่รับ xlsx
2. **FlowAccount ตัวที่สอง หลังประตู Phase 0** — โปรแกรมเดียวที่ประกาศกติการะดับคอลัมน์ต่อสาธารณะ แพ็ก Standard นำเข้าได้ บริษัทเจ้าของใช้ FlowAccount อยู่; กรณีที่ไฟล์ FlowAccount แทนไม่ได้ **ไม่ใส่และบอกเหตุผล** (§7.4) ไม่ส่งข้อมูลที่ผิดเงียบ ๆ
3. **PEAK และ Express รอแม่แบบจริง** — ทั้งคู่มีการนำเข้า แต่หัวคอลัมน์อยู่ในแอป/โปรแกรมเสริม ยืนยันจากแหล่งสาธารณะไม่ได้; ระหว่างนี้ใช้สมุดรายวันซื้อ
4. **CSV ยังไม่ทำ** — โปรแกรมเป้าหมายที่ยืนยันแล้ว (FlowAccount, PEAK) รับ xlsx; SAP B1 DTW ต้อง txt/csv แต่ไม่ใช่เป้าหมายของร้าน SME ที่ขาย

## 2. เป้าหมาย

1. ร้านดาวน์โหลด "สมุดรายวันซื้อ" แยกแถวตามบัญชีของสำนักงานบัญชีและการใช้ VAT; ผลรวมทุกแถวเท่ายอดหัวเอกสารทุกตัว (มูลค่า VAT หัก ยอดรวม)
2. ร้านใส่รหัสและชื่อบัญชีของสำนักงานบัญชีให้แต่ละหมวดได้ครั้งเดียว (รวมหมวดเก่าที่ยังมีรายการ)
3. (หลัง Phase 0) ไฟล์ FlowAccount นำเข้าได้โดยไม่มีแถวผิด; เอกสารที่แทนไม่ได้ถูกบอกชื่อและเหตุผลบนหน้าจอ
4. ไม่มีลิงก์ ไม่มีรหัสภายใน คำไทยตาม accountant-export-cleanup-spec

## 3. Non-goals

- เชื่อม API/MCP ของโปรแกรมบัญชี (PEAK API, FlowAccount OpenAPI/AI Connector)
- ซิงก์อัตโนมัติ / ส่งทางอีเมลหรือ LINE
- ฝั่งรายรับ (`sales_documents` ไม่ได้ขาย)
- ส่งออกรายชื่อผู้จำหน่ายให้ FlowAccount นำเข้าก่อน — ผลจาก Phase 0 ตัดสิน (G1)
- CSV (§1.3 ข้อ 4)
- แปลงเงินต่างสกุล — ไฟล์นำเข้ารับ THB เท่านั้น ต่างสกุลถูกบอกเป็นรายการที่ไม่ได้ใส่
- เปลี่ยนไฟล์ Excel สำหรับนักบัญชี/ZIP (สเปกข้อ 25)

## 4. ผู้ใช้และ journey

| ผู้ใช้ | สิทธิ์ | เว็บ | LINE |
|---|---|---|---|
| ผู้ดูแลหมวดหมู่ | `expense.category.manage` ([expense.controller.ts:737-753](../../apps/api/src/modules/expenses/presentation/http/expense.controller.ts)) | ค่าใช้จ่าย › หมวดหมู่ › ใส่ "รหัสบัญชี" + "ชื่อบัญชี" ต่อหมวด (รวมส่วน "หมวดเก่าที่ยังมีรายการ") | ไม่มี |
| เจ้าของกิจการ / การเงิน / นักบัญชีสมาชิก | `expense.export` + `expense.read` | J1 หน้ารายการ › "ส่งออก Excel ให้สำนักงานบัญชี" › `รูปแบบไฟล์` › "ดาวน์โหลด Excel"; J2 หน้าหลักฐานทางบัญชี › `รูปแบบไฟล์ Excel` › "ดาวน์โหลด Excel" | การ์ดคู่มือ `expense.export` เดิม (ยังจริง) |
| สำนักงานบัญชีที่ใช้ FlowAccount | บัญชี FlowAccount | สร้างผู้จำหน่ายที่ยังไม่มี › ค่าใช้จ่าย › นำเข้าบิลและใบเสร็จ › จับคู่คอลัมน์ ("ราคาไม่รวมภาษี") › ตรวจ › นำเข้า; บันทึกเอกสารที่ไม่ได้ใส่ด้วยมือจากไฟล์สำหรับนักบัญชี | — |
| สำนักงานบัญชีที่ใช้ PEAK / Express / อื่น ๆ | — | สมุดรายวันซื้อ: คีย์ตามแถว หรือจับคู่คอลัมน์ในโปรแกรม | — |

## 5. กติกา/ข้อยกเว้น

- R1 **รายการที่ใส่**: ตัวกรองและประตูสิทธิ์เดียวกับการส่งออกให้นักบัญชี; **สถานะที่ไม่ส่งมาถือเป็น `CONFIRMED`** (กติกาเดิม `request.status ?? 'CONFIRMED'` [expense-evidence.use-case.ts:321](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts) — DTO ปล่อยว่างได้ [expense.dtos.ts:272](../../apps/api/src/modules/expenses/presentation/http/expense.dtos.ts) และหน้ารายการไม่ส่ง status); สถานะอื่นที่ส่งมาชัดเจน (เช่น `VOIDED`) → ปฏิเสธพร้อมทางออก (T8)
- R2 **แถว** = เอกสาร × บัญชี × การใช้ VAT × สิทธิภาษีซื้อ × ชุดหัก ณ ที่จ่าย: รวมบรรทัดตาม (บัญชีที่ map — ไม่ map ใช้หมวด, `vatTreatment`/ประเภทภาษีของบรรทัด, อัตรา VAT, **สิทธิภาษีซื้อที่มีผลของบรรทัด (R3-F2 — ปิดแล้ว §0)** = ประตูระดับเอกสาร**ปัจจุบัน** **และ** ข้อจำกัดของบรรทัด — ไม่มีฝั่งใดยกข้อจำกัดของอีกฝั่ง: ประตูเอกสารแบบเดียวกับที่บัญชีและการ sync ใช้ (`inputVatClaimStatus === 'CLAIMABLE' && taxEvidenceStatus === 'USABLE_FOR_TAX'` [posting-engine.logic.ts:298-299](../../apps/api/src/modules/ledger/domain/logic/posting-engine.logic.ts), [sync-tax-events.use-case.ts:139](../../apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts)) — ผู้ตรวจที่ปฏิเสธภายหลัง (`NON_CLAIMABLE` 'ใช้ส่วนตัว' [prisma-expense.repository.ts:644](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) จึงชนะ snapshot `CLAIMABLE` ของบรรทัดเสมอ; ข้อจำกัดบรรทัดใช้เมื่อ `taxComponentsJson` ไม่ว่าง: `claimabilitySnapshot` (รหัส `V7` = `CLAIMABLE`, `ND` = `NONDEDUCTIBLE_EXPENSE` [tax-code-template.catalog.ts:47-48](../../apps/api/src/modules/tax/domain/tax-code-template.catalog.ts)) และผลตรวจหลักฐานของบรรทัด `taxEvidenceReviewStatus` (ว่าง = `REVIEW_REQUIRED` [prisma-expense.repository.ts:345](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts); sync ไม่ใช้ที่ไม่ `VERIFIED` [sync-tax-events.use-case.ts:148](../../apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts)); ฟิลด์ [schema.prisma:2964-2986](../../apps/api/prisma/schema.prisma); ผลที่เข้มที่สุดชนะตามคอลัมน์ 16 — บรรทัด 100+7 แบบ V7 กับ 100+7 แบบ ND ในบัญชีเดียวจึงเป็นสองแถว ไม่ถูกรวมเป็น 200+14 ที่ใช้สิทธิได้ทั้งหมด, **หมวดเงินได้และอัตราหักของบรรทัด** เมื่อเป็นบรรทัดเก่าที่หักแยกรายบรรทัด) — บรรทัดค่าเช่าหัก 5% กับค่าบริการหัก 2% ในบัญชีและ VAT เดียวกันจึงเป็นสองแถว (fixture [expense-source.adapter.spec.ts:100-109](../../apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.spec.ts)); บรรทัดที่ไม่หักไม่รวมกับบรรทัดที่หัก; บรรทัดค่าบริการเพิ่ม (`chargeKind`) ใช้หมวดของหัวเอกสาร ([schema.prisma:2939-2943](../../apps/api/prisma/schema.prisma)); เรียง วันที่เอกสาร › เลขที่รายการ › รหัสบัญชี › อัตรา VAT › หมวดเงินได้
- R3 **ยอดรายแถว (คงยอดที่บันทึก)**: มูลค่า = Σ `line.taxableAmount`, VAT = Σ `line.vatAmount` (ยอดหลังกระทบยอดกับใบ — คงสตางค์ที่ผู้ใช้กรอก เช่น 21.01), ยอดรวม = มูลค่า + VAT; ผลรวมทุกแถวต้องเท่าหัวเอกสาร (`taxableAmount`, `vatAmount`) — ส่วนต่างที่เหลือ (ในขอบ 0.05 ของ identity [expense-totals.logic.ts:146](../../apps/api/src/modules/expenses/domain/logic/expense-totals.logic.ts)) ปรับเข้าแถวที่มูลค่ามากที่สุด **ในกลุ่ม VAT เดียวกัน**
- R4 **หัก ณ ที่จ่าย (สมุดรายวันซื้อ)**: ใช้ข้อเท็จจริงชุดเดียวกับ ภ.ง.ด. ระดับเอกสาร — บรรทัดเก่าที่มีหมวด/อัตราของตัวเอง (`!whtInputJson` และหลายบรรทัด แบบ `split` [expense-source.adapter.ts:104-107](../../apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.ts)) อยู่ในแถวที่มีชุดหักเดียวกันตาม R2 (ฐาน = Σ มูลค่าบรรทัดในแถว, อัตรา = อัตราของชุด, ยอด = Σ ยอดหักบรรทัด, หมวด = หมวดของชุด) — แต่ละแถวจึงมีหมวด/อัตราเดียวเสมอ; หักทั้งใบอยู่แถวที่มูลค่ามากที่สุด ฐาน = `expenseWhtIncomeBase` (อาจต่างจากมูลค่า), อัตรา = `expenseWhtHeaderRate` (ไม่มี → `ยังไม่ระบุ`); แบบ ภ.ง.ด. = `withholdingFormFor` (บุคคล → ภ.ง.ด.2 เมื่อ `SEPARATE_PND2` มิฉะนั้น ภ.ง.ด.3; นิติบุคคล → ภ.ง.ด.53; ไม่รู้ → `ยังไม่ระบุ` — [sync-tax-events.use-case.ts:60-77](../../apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts)); **การยื่นรายเดือนตามการจ่ายใช้แผ่น `หัก ณ ที่จ่าย` ของไฟล์สำหรับนักบัญชี** (สเปกข้อ 25 §5.3) ไม่ใช่สมุดรายวันซื้อ
- R5 **VAT ต้องห้าม** ตาม ม.82/5 นำมาหักภาษีขายไม่ได้ (ประกาศ VAT ฉบับ 17 ออกตาม ม.82/5 https://rd.go.th/3409.html) — สมุดรายวันซื้อแยก `VAT` กับ `สิทธิภาษีซื้อ` **ต่อแถว** (ตามสิทธิที่มีผลของบรรทัดใน R2) ให้นักบัญชีตัดสิน; สิทธิที่มีผล = ประตูเอกสารปัจจุบัน **และ** ข้อจำกัดบรรทัด (R2) — การตัดสินระดับเอกสารไม่ยกข้อจำกัด `ND` ของบรรทัด และ snapshot `CLAIMABLE` ของบรรทัดไม่ฟื้นสิทธิที่ผู้ตรวจปฏิเสธระดับเอกสาร
- R6 **วันที่** เป็นเซลล์วันที่จริง (style 4 แสดง `13 ต.ค. 2569` [xlsx.logic.ts:251](../../apps/api/src/common/export/xlsx.logic.ts)); เลขประจำตัว/สาขาผู้ขาย (5 หลัก `00000` = สำนักงานใหญ่) เป็นข้อความ
- R7 **สกุลเงิน**: ไฟล์นำเข้าใส่เฉพาะ THB; ต่างสกุล → ไม่ใส่ + บอกใน `excluded`
- R8 **ไม่ใช้ feature switch**; สิทธิ์ `expense.export` เดิม (Q1)
- R9 **FlowAccount** ≤ 500 แถวต่อไฟล์ แบ่งระหว่างเอกสาร; เอกสารเกิน 300 แถว → ไม่ใส่ + เหตุผล
- R10 **ไม่มีข้อมูลผิดเงียบ ๆ**: ถ้ารูปแบบปลายทางแทนข้อเท็จจริงของเอกสารไม่ได้ครบ ให้ไม่ใส่เอกสารนั้นและส่งชื่อ+เหตุผลใน `excluded` (API และหน้าจอ) — นักบัญชีบันทึกเองจากไฟล์สำหรับนักบัญชี

## 6. Data model (additive)

```prisma
/// รหัสบัญชีในโปรแกรมบัญชีของสำนักงานบัญชี ต่อร้าน ต่อหมวด — แยกตารางเพราะหมวดกลาง (companyId null)
/// ใช้ร่วมหลายร้าน. ไม่ใช่ผังของมั่งมี (`ExpenseCategory.ledgerAccountCode`) และไม่ใช้ลงบัญชีในระบบ.
model ExpenseCategoryAccountantAccount {
  id                String          @id @default(cuid())
  companyId         String
  expenseCategoryId String
  accountCode       String          @db.VarChar(20)
  accountName       String          @db.VarChar(120)
  updatedByUserId   String
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt
  company           Company         @relation(fields: [companyId], references: [id], onDelete: Cascade)
  expenseCategory   ExpenseCategory @relation(fields: [expenseCategoryId], references: [id], onDelete: Cascade)

  @@unique([companyId, expenseCategoryId])
  @@index([companyId])
}
```

- back-relation ใน `Company` และ `ExpenseCategory`; migration ใหม่ (CREATE TABLE + unique + index + 2 FK) ไม่มี backfill
- หมวดที่ตั้ง mapping ได้ = หมวดที่ร้านเห็นตาม `selectExpenseCategoryScope` **∪ หมวดที่รายจ่าย/บรรทัดของร้านนี้อ้างถึง** (รวมหมวดกลางที่ถูกซ่อนหลัง bootstrap) — ไม่งั้นรายการเก่าจะไม่มีทางมีรหัสบัญชี
- หมวดถูกปิด → mapping คงอยู่; หมวดถูกลบ (cascade) → mapping หาย; สองหมวดชี้บัญชีเดียวกันได้

## 7. Contracts/API

### 7.1 Contracts (`packages/contracts/src/expenses.ts`)

```ts
export type ExpenseCategoryAccountantAccount = { accountCode: string; accountName: string };
// ExpenseCategorySummary: + accountantAccount?: ExpenseCategoryAccountantAccount | null; + referencedOnly?: true (หมวดเก่าที่ซ่อนแต่ยังมีรายการ)
export type SetExpenseCategoryAccountantAccountInput = ExpenseCategoryAccountantAccount;
export const ACCOUNTING_SOFTWARE_EXPORT_PRESETS = ['purchase_journal', 'flowaccount'] as const; // Phase 1 มีแค่ 'purchase_journal'
export type AccountingSoftwareExportPreset = (typeof ACCOUNTING_SOFTWARE_EXPORT_PRESETS)[number];
export type AccountingSoftwareExportRequest = SharedEvidenceFilter & { preset: AccountingSoftwareExportPreset };
export const ACCOUNTING_EXPORT_EXCLUSION_REASONS = ['foreign_currency', 'not_confirmed', 'vat_not_representable',
  'wht_not_representable', 'wht_without_vendor_tax_id', 'wht_form_not_supported', 'wht_payee_kind_unknown',
  'wht_mixed_income_types', 'wht_unpaid', 'wht_partly_paid', 'wht_paid_in_several_payments', 'wht_paid_date_unconfirmed',
  'wht_payment_method_not_supported', 'account_unmapped', 'too_many_rows'] as const;
export type AccountingSoftwareExportResult = {
  preset: AccountingSoftwareExportPreset;
  files: { fileName: string; xlsxBase64: string; rowCount: number }[];
  documentCount: number; rowCount: number;
  excluded: { expenseNumber: string; reason: (typeof ACCOUNTING_EXPORT_EXCLUSION_REASONS)[number]; detail: string }[];
  paymentNotExported: { expenseNumber: string; detail: string }[];   // FlowAccount: ส่งเป็นค้างจ่าย
  unmappedCategories: { id: string; name: string }[];
};
export const PURCHASE_JOURNAL_COLUMNS = [...] as const; // §7.3
```

`detail` เป็นคำไทยจาก `ACCOUNTING_EXPORT_EXCLUSION_LABELS` (contracts) เช่น `ยอดเป็นสกุลเงินอื่น นำเข้าได้เฉพาะเงินบาท`

### 7.2 Endpoints

| Method/Path | สิทธิ์ | Body | ผล |
|---|---|---|---|
| `GET /v1/companies/:companyId/expense-categories/manage` (เดิม) | `expense.category.manage` | — | หมวดเดิม + `accountantAccount` + หมวดที่ซ่อนแต่ยังมีรายการ (`referencedOnly: true`) |
| `PUT /v1/companies/:companyId/expense-categories/:categoryId/accountant-account` | `expense.category.manage` | `{ accountCode, accountName }` trim; รหัส 1–20 ชื่อ 1–120; **ทั้งค่าไม่มีอักขระควบคุม** และตัวแรกไม่ใช่ `= + - @` (`@Matches(/^[^=+\-@\u0000-\u001F\u007F][^\u0000-\u001F\u007F]*$/)`) | 200; หมวดไม่อยู่ใน (ที่ร้านเห็น ∪ ที่รายการของร้านอ้าง) → 404; audit `expense.category.accountant_account.set` (LOW) |
| `DELETE …/accountant-account` | `expense.category.manage` | — | 204; audit `…clear` |
| `POST /v1/companies/:companyId/expenses/accounting-software-export` | `expense.export` (+ `expense.read` และสาขาเหมือน `readPackageRows` [expense-evidence.use-case.ts:317-320](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts)) | `AccountingSoftwareExportDto extends AccountantPackageDto` (สเปกข้อ 25 §7.5 — มี `page`/`pageSize`) `{ @IsIn(PRESETS) preset }` | 200 result; `status` ว่าง → `CONFIRMED`; `status` ≠ `CONFIRMED` → 422 `accounting_export_confirmed_only`; FlowAccount + หมวดที่ใช้ในช่วงนี้ไม่ map → 422 `accounting_export_accounts_unmapped` + `categories`; ทุกเอกสารถูก exclude หรือ 0 รายการ → 200 `files: []` + `excluded`; audit `expense.accounting_software_export.create` (MEDIUM) `{ preset, documentCount, rowCount, excludedCount, filterSummary }` |

use-case `CreateAccountingSoftwareExportUseCase` (ไฟล์ `expense-evidence.use-case.ts`, ใช้ `readPackageRows` ร่วม) + logic บริสุทธิ์ใหม่ `apps/api/src/modules/expenses/domain/logic/accounting-software-export.logic.ts`

### 7.3 สมุดรายวันซื้อ (`purchase_journal`)

แผ่น `สมุดรายวันซื้อ` + `เกี่ยวกับไฟล์นี้` (รวมรายการที่ไม่ได้ใส่ + เหตุผล); ชื่อไฟล์ `สมุดรายวันซื้อ-<ชื่อร้าน>-<ช่วง>.xlsx`

| # | หัวคอลัมน์ | ค่า | เซลล์ |
|---|---|---|---|
| 1 | วันที่เอกสาร | `expenseDate` | วันที่ |
| 2 | เลขที่ตามเอกสาร | `vendorDocumentNumber` | ข้อความ |
| 3 | เลขที่รายการ | `expenseNumber` | ข้อความ |
| 4 | ประเภทเอกสาร | `SOURCE_DOCUMENT_TYPE_LABELS` | ข้อความ |
| 5 | ผู้ขาย/ผู้รับเงิน | snapshot | ข้อความ |
| 6 | เลขประจำตัวผู้เสียภาษีผู้ขาย | snapshot | ข้อความ |
| 7 | สาขาผู้ขาย (00000 = สำนักงานใหญ่) | `vendorBranchCodeSnapshot` | ข้อความ 5 หลัก |
| 8 | รหัสบัญชี | mapping; ไม่ map → ว่าง | ข้อความ |
| 9 | ชื่อบัญชี | mapping; ไม่ map → ว่าง | ข้อความ |
| 10 | หมวดค่าใช้จ่าย | ชื่อหมวด (หลายหมวดในบัญชีเดียว → คั่น `, `) | ข้อความ |
| 11 | รายละเอียด | `note`; หลายแถว → ต่อคำอธิบายบรรทัดแรกของกลุ่ม | ข้อความ |
| 12 | การใช้ VAT | `VAT 7%` / `VAT 0%` / `ยกเว้น VAT` / `ไม่มี VAT` (`vatTreatment`/อัตรา) | ข้อความ |
| 13 | มูลค่าก่อน VAT | R3 | เงิน |
| 14 | VAT | R3 (ยอดที่บันทึก) | เงิน |
| 15 | ยอดรวม | 13 + 14 | เงิน |
| 16 | สิทธิภาษีซื้อ | ต่อแถวตาม R2 ผลที่เข้มที่สุดชนะ: `ใช้ไม่ได้` (เอกสาร `NON_CLAIMABLE`; หลักฐาน `SUPPORTING_ONLY`/`NOT_TAX_EVIDENCE`; บรรทัด `NONDEDUCTIBLE_EXPENSE`/`NONDEDUCTIBLE_CAPITALIZED`; ผลตรวจบรรทัด `REJECTED`) › `รอตรวจสอบ` (เอกสารหรือหลักฐาน `NEEDS_REVIEW`; บรรทัด `PENDING_EVIDENCE`; ผลตรวจบรรทัด `DRAFT`/`REVIEW_REQUIRED`) › `ใช้ได้บางส่วน` (บรรทัด `PARTIAL`) › `ใช้ได้ตามเงื่อนไข`; ไม่มี VAT (`NOT_APPLICABLE` หรือ VAT 0) → `ไม่มี VAT` | ข้อความ |
| 17 | แบบ ภ.ง.ด. | R4 (`ภ.ง.ด.2`/`ภ.ง.ด.3`/`ภ.ง.ด.53`/`ยังไม่ระบุ`; ไม่มีหัก → ว่าง) | ข้อความ |
| 18 | ประเภทเงินได้ | `WhtIncomeCategory.nameTh` | ข้อความ |
| 19 | ฐานหัก ณ ที่จ่าย | R4 | เงิน |
| 20 | อัตราหัก (%) | R4 (`ยังไม่ระบุ` เมื่อไม่มีอัตรา) | ตัวเลข/ข้อความ |
| 21 | หัก ณ ที่จ่าย | R4 | เงิน |
| 22 | ยอดจ่ายสุทธิ | 15 − 21 | เงิน |
| 23 | สถานะการจ่าย | `EXPENSE_PAYMENT_STATUS_LABELS` (`ยังไม่ชำระ`/`ชำระบางส่วน`/`ชำระแล้ว` — คำเดิม [expenses.ts:255-260](../../packages/contracts/src/expenses.ts)) | ข้อความ |
| 24 | วันที่จ่ายล่าสุด | `max(ExpensePayment.paidAt)` `RECORDED` (สเปกข้อ 25 §7.2 #22) | วันที่/ข้อความ |
| 25 | สำรองจ่ายโดย | สเปกข้อ 25 §7.3 | ข้อความ |

ไม่ใส่ (exclude) ใน purchase journal เฉพาะ: ต่างสกุล (R7) — นอกนั้นทุกกรณีแทนได้เพราะคงยอดทุกตัว

### 7.4 FlowAccount (`flowaccount`) — **ทุกแถวที่ "ยังไม่ยืนยัน" ต้องผ่าน Phase 0 ก่อนเปิด**

แผ่นเดียว `นำเข้าค่าใช้จ่าย` (ไม่มีแผ่นข้อมูล — `excluded`/`paymentNotExported` อยู่ใน API และหน้าจอเท่านั้น); ชื่อไฟล์ `FlowAccount-ค่าใช้จ่าย-<ชื่อร้าน>-<ช่วง>[-ส่วนที่-N].xlsx`; ผู้ใช้เลือก "ราคาไม่รวมภาษี" ตอนจับคู่คอลัมน์

| หัวคอลัมน์ (คำตามหน้าช่วยเหลือ) | ค่า | สถานะ |
|---|---|---|
| วันที่เอกสาร | `expenseDate` เซลล์วันที่ | ยังไม่ยืนยันรูปแบบเซลล์ |
| เลขอ้างอิง | `vendorDocumentNumber` ถ้าไม่ว่างและไม่ซ้ำกับเอกสารอื่นในไฟล์; ไม่เช่นนั้น `<vendorDocumentNumber> (<expenseNumber>)` หรือ `expenseNumber` — กันสองผู้ขายที่ใช้ "001" ถูกรวม | กติกาจัดกลุ่มยืนยันแล้ว |
| ผู้จำหน่าย | ชื่อผู้ขาย (แม่แบบใช้ "รหัส / ชื่อ" — Phase 0 ตัดสินว่าต้องมี mapping รหัสผู้จำหน่ายหรือไม่) | ยังไม่ยืนยัน |
| เลขประจำตัวผู้เสียภาษี / ที่อยู่ผู้จำหน่าย | snapshot | คอลัมน์มีจริง |
| รายละเอียดค่าใช้จ่าย | `<ชื่อหมวด> · <note>` ตัด 1,000 ตัว | ความยาวสูงสุดยังไม่ยืนยัน |
| ผังบัญชี | `<accountCode> / <accountName>` | ยืนยันรูปแบบแล้ว |
| จำนวน | `1` | มีคอลัมน์ |
| ราคาต่อหน่วย | มูลค่าก่อน VAT ของแถว (R3) | — |
| ภาษี | `VAT 7%` ที่**แถวนั้น**ใช้สิทธิได้ (R2) → `7%`; `ZERO_RATED` → `0%`; ยกเว้น/ไม่มี VAT → `ยกเว้นภาษี` | ค่ายืนยันแล้ว; การใช้ `ยกเว้นภาษี` แทน "ไม่มี VAT" ยังไม่ยืนยัน |
| วิธีการชำระ + วันที่ชำระ | ส่งคู่กันเสมอ: `PAID` ด้วยการจ่ายครั้งเดียวที่ยืนยันวันที่แล้ว และวิธีจ่าย `CASH`/`BANK_TRANSFER`/`CHEQUE` → `เงินสด`/`โอนเงิน`/`เช็ค` + วันที่; มิฉะนั้นเว้นว่างทั้งสองช่อง (วันที่โดยไม่มีวิธีนำเข้าไม่ได้) → เอกสารเข้าเป็นค้างจ่าย. **เอกสารที่ไม่มีหัก**: ยังไม่จ่าย → ค้างจ่ายถูกต้อง ไม่เตือน; จ่ายแล้ว/จ่ายบางส่วน แต่ส่งเป็นค้างจ่าย → อยู่ใน `paymentNotExported` พร้อมเหตุผลจริง (`จ่ายด้วยบัตรหรือวิธีอื่น`, `จ่ายบางส่วน`, `จ่ายหลายครั้ง`, `วันที่จ่ายยังไม่ยืนยัน`). **เอกสารที่มีหัก** ต้องมีวิธีการชำระ (FlowAccount: "เอกสารที่จะออกหนังสือรับรองจึงต้องระบุวิธีการชำระ") → ส่งคู่ไม่ได้ = ไม่ใส่ (ตารางล่าง) | กติกายืนยันแล้ว; ค่าที่รับยังไม่ยืนยัน |
| หัก ณ ที่จ่าย: แบบฟอร์ม / ประเภทเงินได้ / อัตรา (+ คำอธิบายประเภทเงินได้) | `ภ.ง.ด.3`/`ภ.ง.ด.53`; ตาราง map `WHT_*` → ตัวเลือก FlowAccount (จาก Phase 0) พร้อมธง "ต้องมีคำอธิบาย" สำหรับข้อ 6 (อื่น ๆ), 4(ข)(2.5), 4(ข)(1.3) → คำอธิบาย = `<nameTh> · <note>` (เช่น `WHT_OTHER_IND`/`WHT_OTHER_JUR` [seed.ts:2952](../../apps/api/prisma/seed.ts)); อัตรา | กติกาสามช่อง+คำอธิบายยืนยันแล้ว; ข้อความตัวเลือกยังไม่ยืนยัน |
| หมายเหตุ | `มั่งมี <expenseNumber>` | — |

เอกสารที่ **ไม่ใส่** (`excluded`, R10):

| เหตุผล | เงื่อนไข | คำบนหน้าจอ |
|---|---|---|
| `foreign_currency` | `currency ≠ THB` | `ยอดเป็นสกุลเงินอื่น นำเข้าได้เฉพาะเงินบาท` |
| `vat_not_representable` | VAT ที่ FlowAccount จะคำนวณจากราคา×อัตรา (วิธีปัดตาม Phase 0) ≠ VAT ที่บันทึก (เช่น ใบ 300 VAT 21.01); หรือแถวที่มี VAT > 0 แต่สิทธิที่มีผล (R2) ไม่ใช่ `ใช้ได้ตามเงื่อนไข` (วิธีบันทึกใน FlowAccount ยังไม่ยืนยัน) | `VAT บนใบต่างจากที่ FlowAccount คำนวณ` / `มี VAT ที่ใช้สิทธิไม่ได้` / `มี VAT ที่รอตรวจสิทธิ` |
| `wht_not_representable` | หักแบบยอดเงินไม่มีอัตรา; หลายอัตราในแถวเดียว; ฐานหัก ≠ ราคาแถวที่หัก; round2(อัตรา × ฐาน) ≠ ยอดหักที่บันทึก | `หัก ณ ที่จ่ายของเอกสารนี้ใส่ในไฟล์นำเข้าไม่ได้` |
| `wht_without_vendor_tax_id` | หัก > 0 และไม่มีเลขผู้เสียภาษีผู้ขาย (FlowAccount ปฏิเสธ) | `หัก ณ ที่จ่ายแต่ไม่มีเลขประจำตัวผู้เสียภาษีผู้ขาย` |
| `wht_form_not_supported` | แบบ ภ.ง.ด.2 (FlowAccount รับ 3/53) | `แบบ ภ.ง.ด.2 นำเข้า FlowAccount ไม่ได้` |
| `wht_payee_kind_unknown` | หัก > 0 และไม่รู้ประเภทผู้รับเงิน | `ยังไม่ระบุว่าผู้รับเงินเป็นบุคคลหรือนิติบุคคล` |
| `wht_mixed_income_types` | หัก > 0 และแถวของเอกสารเดียวกัน (ทุกบัญชีรวมกัน) map ไปตัวเลือกประเภทเงินได้ของ FlowAccount มากกว่าหนึ่งค่า — FlowAccount: "เลขอ้างอิงเดียวกันต้องใช้ประเภทเงินได้เดียวกัน" (แยกเป็นสองเอกสารไม่ได้เพราะเป็นใบเดียวกันของผู้ขาย) | `เอกสารนี้หัก ณ ที่จ่ายหลายประเภทเงินได้` |
| `wht_unpaid` | หัก > 0 และยังไม่มีการจ่าย | `ยังไม่ได้จ่าย หัก ณ ที่จ่ายต้องนำเข้าพร้อมการจ่าย` |
| `wht_partly_paid` | หัก > 0 และจ่ายยังไม่ครบ | `จ่ายยังไม่ครบ` |
| `wht_paid_in_several_payments` | หัก > 0 และจ่ายครบด้วยการจ่ายมากกว่าหนึ่งครั้ง (ภ.ง.ด. แบ่งตามการจ่าย — ไฟล์นำเข้าแถวเดียวแทนไม่ได้) | `จ่ายหลายครั้ง` |
| `wht_paid_date_unconfirmed` | หัก > 0 และวันที่ของการจ่ายยังไม่ยืนยัน (`paidAtConfirmed = false`) | `วันที่จ่ายยังไม่ยืนยัน` |
| `wht_payment_method_not_supported` | หัก > 0 จ่ายครั้งเดียว แต่วิธีจ่าย `CARD`/`OTHER`/ไม่ระบุ (ยังไม่มีค่าที่ยืนยันใน FlowAccount — Phase 0 อาจเพิ่มได้) | `วิธีจ่ายนี้ใส่ในไฟล์นำเข้าไม่ได้` |
| `too_many_rows` | > 300 แถวในเอกสารเดียว | `เอกสารมีบรรทัดมากเกินที่ FlowAccount รับ` |

## 8. สิทธิ์ ABAC และขอบเขต tenant

- ตั้ง/ลบ mapping: `expense.category.manage`; `companyId` ใน path ต้องตรง `ctx.companyId` (guard เดิม); หมวดต้องอยู่ใน (ที่ร้านเห็น ∪ ที่รายการของร้านอ้าง); ไม่ผูกสาขา (หมวดเป็นของทั้งร้าน)
- ส่งออก: ประตูเดียวกับการส่งออกให้นักบัญชี; แถวจาก `listSharedEvidence` ที่กรองด้วย `ctx.scopes`; mapping/บรรทัด/การจ่ายอ่านด้วย `companyId`; `WhtIncomeCategory` เป็น catalog กลาง อ่านด้วย `code` อย่างเดียว ([schema.prisma:5600-5616](../../apps/api/prisma/schema.prisma))
- ไม่มีสิทธิ์ใหม่; ไม่มี entitlement key ใหม่ (Q1); ไม่เรียก AI ไม่คิดเครดิต ไม่เขียนจาก LINE

## 9. State transitions

- Mapping: ไม่มี → มี (PUT) → แก้ (PUT) → ไม่มี (DELETE); upsert บน unique — สองคนพร้อมกัน คนหลังชนะ; audit ทั้งสองครั้ง
- การส่งออก: อ่านอย่างเดียว (ไม่มีสถานะ "ส่งออกแล้ว" — Q4)

## 10. UI

### 10.1 Dialog หน้ารายการ และการ์ดส่งออกหน้าหลักฐาน

- `รูปแบบไฟล์` (ThemedSelect) แทน "รายละเอียดในไฟล์" ที่สเปกข้อ 25 ตัด; จำค่าด้วย `useMenuFilterState('expenses.export.format')`
- ตัวเลือก: `Excel สำหรับนักบัญชี` (ค่าตั้งต้น) · `สมุดรายวันซื้อ` · `FlowAccount` (หลัง Phase 2)
- ใต้ช่อง: หนึ่งบรรทัดตามตัวเลือก (T1/T2) แล้วคำเตือน (T3–T5)
- หลังดาวน์โหลด: `excluded.length > 0` → บรรทัด T11 + ปุ่ม `ดูรายการ` เปิดรายการเลขที่+เหตุผลในกล่องเดิม (ไม่ซ่อนในไฟล์ เพราะไฟล์ FlowAccount มีแผ่นเดียว); `paymentNotExported.length > 0` → T12; ทุกเอกสารถูก exclude → ไม่มีไฟล์ + T11 + `ดูรายการ`
- 390 px: ช่องและปุ่มเต็มความกว้าง; 1280/~1,556 px: dialog `sm` เดิม; การ์ดหน้าหลักฐานเต็มความกว้าง ช่องรูปแบบ (~18rem) ซ้ายปุ่ม Excel แถวเดียว ปุ่มสูงเท่ากัน

### 10.2 หน้าหมวดหมู่

- คอลัมน์ `รหัสบัญชี` (~8rem) + `ชื่อบัญชี` ต่อจาก "ภาษีซื้อเริ่มต้น" ใน `CategoryManagePanel` ([ExpensesWorkspacePanels.tsx:216-224](../../apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx)); 1280/~1,556 px เป็นคอลัมน์ตาราง; 390 px อยู่ใต้ชื่อหมวดในการ์ดแถว
- ส่วนท้าย `หมวดเก่าที่ยังมีรายการ` (มีเมื่อมี `referencedOnly`) — ใส่รหัสได้ เปิด/ปิดหมวดไม่ได้
- T6 เหนือรายการ; บันทึกเมื่อออกจากช่องที่สองและทั้งสองช่องมีค่า; ล้างทั้งสอง = ลบ; ล้มเหลว → T7 ใต้ช่อง ค่าคงอยู่

### 10.3 ข้อความ (คำตรงตัว)

| id | ข้อความ | เมื่อ |
|---|---|---|
| T1 | `แยกแถวตามรหัสบัญชีและ VAT ของแต่ละเอกสาร` | เลือกสมุดรายวันซื้อ |
| T2 | `ใช้กับ ค่าใช้จ่าย › นำเข้าบิลและใบเสร็จ ใน FlowAccount ผู้จำหน่ายต้องมีใน FlowAccount ก่อน และเลือกราคาไม่รวมภาษี` | เลือก FlowAccount |
| T3 | มีสิทธิ์จัดการหมวด: `ยังไม่ได้ใส่รหัสบัญชี N หมวด` + ปุ่ม `ใส่รหัสบัญชี`; ไม่มีสิทธิ์: `ยังไม่ได้ใส่รหัสบัญชี N หมวด ให้ผู้ดูแลหมวดหมู่ใส่ก่อน` + ปุ่ม `ใช้สมุดรายวันซื้อแทน` | FlowAccount และมีหมวดไม่ map (กดดาวน์โหลดแล้วแสดง — UX standard 2.9) |
| T4 | `ช่องรหัสบัญชีของ N หมวดจะว่าง` | สมุดรายวันซื้อ และมีหมวดไม่ map |
| T6 | `ใส่รหัสและชื่อบัญชีจากโปรแกรมบัญชีของสำนักงานบัญชี ใช้ตอนส่งออกไฟล์` | หน้าหมวดหมู่ |
| T7 | `บันทึกรหัสบัญชีไม่สำเร็จ ข้อมูลที่กรอกยังอยู่ ลองอีกครั้ง` | PUT ล้มเหลว |
| T8 | `ไฟล์นำเข้าใช้ได้กับรายการที่ยืนยันแล้วเท่านั้น` + ปุ่ม `ดูรายการที่ยืนยันแล้ว` | กรองสถานะยกเลิกแล้วเลือกรูปแบบนำเข้า |
| T9 | `ดาวน์โหลดสมุดรายวันซื้อแล้ว N รายการ` / `ดาวน์โหลดไฟล์ FlowAccount แล้ว N รายการ ใน M ไฟล์` | สำเร็จ |
| T10 | `ช่วงนี้ยังไม่มีรายการที่ยืนยันแล้ว` (คำเดิม) | 0 รายการ |
| T11 | `ไม่ได้ใส่ N รายการ บันทึกเองจากไฟล์สำหรับนักบัญชี` + ปุ่ม `ดูรายการ` | `excluded.length > 0` |
| T12 | `N รายการเข้า FlowAccount เป็นค้างจ่าย บันทึกการจ่ายใน FlowAccount เอง` + ปุ่ม `ดูรายการ` | `paymentNotExported.length > 0` |

(T5 เดิมถูกแทนด้วยเหตุผล `wht_without_vendor_tax_id` ใน T11)

ตารางพื้นผิว × กรณี:

| ประโยค | หน้ารายการ | หน้าหลักฐาน | ไม่มีสิทธิ์จัดการหมวด | ไม่มีหมวดไม่ map | > 500 แถว | 0 รายการ | ทุกเอกสารถูก exclude |
|---|---|---|---|---|---|---|---|
| T1/T2 | จริง | จริง | จริง | จริง | จริง | จริง | จริง |
| T3 | จริง | จริง | แบบไม่มีปุ่มไปหน้าหมวด | ไม่แสดง | จริง | ไม่แสดง | ไม่แสดง (422 ก่อน) |
| T4 | จริง | จริง | จริง | ไม่แสดง | — | ไม่แสดง | จริงถ้ามี |
| T9 | จริง (นับจาก response) | จริง | จริง | จริง | `ใน M ไฟล์` จริง | ไม่แสดง (T10) | ไม่แสดง |
| T11 | จริง | จริง | จริง | จริง | จริง | ไม่แสดง | จริง (ไม่มีไฟล์) |
| T12 | จริง | จริง | จริง | จริง | จริง | ไม่แสดง | ไม่แสดง |

### 10.4 LINE

ไม่มีการ์ด/ข้อความใหม่; การ์ด `expense.export` ยังจริง — ไม่แก้

## 11. Impact analysis

| พื้นที่ | กระทบ |
|---|---|
| Prisma schema + migration | ตารางใหม่ 1 ตาราง (additive) |
| contracts `expenses.ts` | §7.1 |
| API expenses | DTO 2 คลาส, controller 3 route, use-case 3 (set/clear/export), repository (mapping + หมวดที่ถูกอ้าง), logic ใหม่ 1 ไฟล์ |
| API tax | ใช้ `withholdingFormFor` (ยกจาก sync ในสเปกข้อ 25) และ `expenseWhtIncomeBase`/`expenseWhtHeaderRate` เดิม |
| เว็บ | `ExpensesPages.tsx`, `ExpensesWorkspacePanels.tsx` (การ์ดส่งออก + CategoryManagePanel), `expenses.api.ts`, `expenses.model.ts`, `workspace-dictionary.ts` |
| AI Gateway / LINE / เครื่องมือ AI / การแจ้งเตือน | ไม่กระทบ |
| billing/entitlement | ไม่มีคีย์ใหม่ (Q1); ถ้าเจ้าของจำกัดแพ็ก → เพิ่มคีย์ใน `FEATURE_CATALOG` + `TIER_FEATURE_PRESETS` → regenerate W00 + whole-chain |
| W00 manifest | ไฟล์ที่ hash ไม่ถูกแตะ → รัน `line-ai-capability-manifest.spec.ts` ยืนยัน |
| whole-chain catalog | ไม่แก้ |
| browser journeys | `evidence-and-settings.journey.spec.ts` (ใส่รหัสบัญชี → ส่งออกสมุดรายวันซื้อ → ตรวจหัวและผลรวม); `e2e/expenses.spec.ts` EXP-EXPORT (select ใหม่, body `preset`) |
| seed | ไม่ต้อง |
| ผังบัญชีของมั่งมี / ledger | ไม่แตะ |

## 12. Gaps

- G1 **ผู้จำหน่ายต้องมีอยู่ใน FlowAccount ก่อน** (FlowAccount ไม่สร้างให้) — สำนักงานบัญชีสร้างเองก่อนนำเข้า (T2 บอก); ถ้า Phase 0 พบว่าต้องใช้ "รหัส / ชื่อ" ต้องเพิ่ม mapping ผู้จำหน่ายก่อนเปิด
- G2 ไม่มีสถานะ "ส่งออกแล้ว" — นำเข้าซ้ำได้; `เลขอ้างอิง` + `มั่งมี <เลขที่>` ช่วยตรวจ (Q4)
- G3 เอกสารที่ FlowAccount แทนไม่ได้ (§7.4) ต้องบันทึกมือ — ลดได้เมื่อ Phase 0 พบคอลัมน์ยอด VAT/ยอดหัก
- G4 PEAK, Express ยังไม่มี preset (รอแม่แบบ); API integration ไม่อยู่ในแผน
- G5 ต่างสกุลไม่อยู่ในไฟล์นำเข้า

## 13. Bugs ที่พบในโค้ดปัจจุบัน

ไม่มีบั๊กใหม่เฉพาะข้อ 13; บั๊กของไฟล์ส่งออกเดิม (B1–B28) อยู่ใน accountant-export-cleanup-spec §13 — B15 (body ไม่ผ่าน validator) ต้องแก้ก่อนเพราะ endpoint ใหม่ใช้ DTO แบบเดียวกัน; B17 (เลขที่เอกสารปลอมผ่านการตรวจ) กระทบคอลัมน์ `เลขที่ตามเอกสาร`/`เลขอ้างอิง` ของไฟล์นี้

## 14. Test plan (ยังไม่ได้รัน)

API (ไฟล์ที่ลงทะเบียน):
- `src/modules/expenses/domain/logic/expense-export.logic.spec.ts` (import โมดูลใหม่): แยกแถวตามบัญชี×VAT (100@7% + 100 ยกเว้น ในบัญชีเดียว → 2 แถว VAT 7.00/0.00); VAT ที่กรอกตามใบ 21.01 คงอยู่ทุกสตางค์; ผลรวมเท่าหัวเอกสารใน VAT_INCLUDED, ค่าบริการเพิ่ม, ส่วนต่าง 0.01; **ค่าเช่า 5% + ค่าบริการ 2% ในบัญชีและ VAT เดียวกัน (fixture adapter) → สองแถว หมวด/อัตรา/ฐาน/ยอดของตัวเอง**; **100+7 `V7` + 100+7 `ND` บัญชีเดียว → สองแถว สิทธิต่างกัน และ `flowAccountEligibility` ให้ `vat_not_representable`**; **(R3-F2) บรรทัด `V7` เอกสาร `CLAIMABLE` → `NON_CLAIMABLE` 'ใช้ส่วนตัว' → `ใช้ไม่ได้` + excluded, กลับเป็น `CLAIMABLE` → `ใช้ได้ตามเงื่อนไข`; เอกสาร `CLAIMABLE` + หลักฐาน `NEEDS_REVIEW` → `รอตรวจสอบ`; เอกสาร `CLAIMABLE` + บรรทัด `ND` → `ใช้ไม่ได้`; ผลตรวจบรรทัด `REVIEW_REQUIRED` → `รอตรวจสอบ`**; บรรทัดหักกับไม่หักในบัญชีเดียว → สองแถว; หักทั้งใบฐาน 270.50 → ฐาน 270.50; หักแบบยอดเงิน → อัตรา `ยังไม่ระบุ`; ภ.ง.ด.2; ต่างสกุล → excluded; `flowAccountEligibility` (Phase 1, §16) ให้เหตุผลถูกทุกกรณีด้านล่าง; FlowAccount (Phase 2): ทุกเหตุผลใน §7.4 รวม `wht_mixed_income_types` (สองบัญชีคนละประเภทเงินได้ในเอกสารเดียว), `wht_unpaid`/`wht_partly_paid`/`wht_paid_in_several_payments`/`wht_paid_date_unconfirmed`/`wht_payment_method_not_supported`; เอกสารไม่มีหักที่ยังไม่จ่าย → ไม่อยู่ใน `paymentNotExported`; เอกสารไม่มีหักที่จ่ายด้วยบัตร → ค้างจ่าย + `paymentNotExported`; ไม่มีแถวใดมีวันที่ชำระโดยไม่มีวิธี; ไม่มีเอกสารมีหักแถวใดไม่มีวิธีการชำระ; คำอธิบายประเภทเงินได้สำหรับข้อ 6; เลขอ้างอิงไม่ซ้ำ; แบ่ง 500 แถว
- `src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts`: status ว่าง → ใช้ CONFIRMED (หน้ารายการ); `VOIDED` → 422; FlowAccount ไม่ map → 422; ไม่มีสิทธิ์ 403; สาขานอกขอบเขต 403; ทุกเอกสาร excluded → `files: []`; mapping set/clear, หมวดร้านอื่น 404, หมวดกลางที่ซ่อนแต่รายการร้านอ้าง → ตั้งได้, หมวดกลางที่ไม่เกี่ยว → 404; audit
- `src/modules/expenses/presentation/http/expense.dtos.spec.ts`: preset ไม่รู้จัก; รหัสยาวเกิน; ขึ้นต้น `=`; **แท็บ/ขึ้นบรรทัดกลางค่า** ถูกปฏิเสธ; `page`/`pageSize` ผ่าน
- PostgreSQL จริง `src/modules/expenses/infrastructure/prisma-expense.repository.tax-snapshot.spec.ts`: upsert สองครั้งแถวเดียว; ลบหมวด cascade; ร้าน A ไม่เห็น mapping ร้าน B; migration deploy สะอาด
- `pnpm --filter @watchdog-bms/api prisma:validate`

เว็บ: `CategoryManagePanel.spec.ts` (รวมส่วนหมวดเก่า), `ExpenseList.rendered.spec.ts` (select, T1–T4, T11–T12), `EvidencePanel.qa.spec.ts`

เบราว์เซอร์ (thai-ux-standard.md §7): journey ข้างบน ภาพจริงที่ 390, 1280, ~1,556 px + วัดปุ่ม

Phase 0 (มือ บันทึกใน memory): นำเข้าไฟล์ตัวอย่างเข้า FlowAccount บริษัททดลอง: สองบัญชี; ผสม 7% กับยกเว้น; VAT 21.01 บนฐาน 300; หัก 3% นิติบุคคล; หักข้อ 6 (อื่น ๆ); จ่ายด้วยบัตร (ไม่มีหัก) — ยืนยันว่าเข้าเป็นค้างจ่าย; หักแต่ไม่มีวิธีการชำระ — ยืนยันว่า FlowAccount ปฏิเสธ; สองประเภทเงินได้ในเลขอ้างอิงเดียว — ยืนยันว่า FlowAccount ปฏิเสธ; ร้านไม่จด VAT

## 15. Acceptance criteria

- AC-1 ใส่รหัสบัญชี "ค่าขนส่ง" = `52031` / `ค่าขนส่ง` ได้จากหน้าหมวดหมู่ทั้งที่ 390, 1280, ~1,556 px (ภาพจริง); รีเฟรชแล้วยังอยู่; ร้านอื่นไม่เห็น; หมวดเก่าที่ยังมีรายการตั้งได้
- AC-2 เอกสาร 1,070 (1,000 + VAT 70) สองหมวด (600/400) → 2 แถว ผลรวม 1,000.00 / 70.00 / 1,070.00
- AC-3 เอกสาร 100@7% + 100 ยกเว้น หมวดเดียว → 2 แถว VAT 7.00 และ 0.00
- AC-4 เอกสารฐาน 300 VAT 21.01 → สมุดรายวันซื้อ VAT 21.01; FlowAccount → อยู่ใน `excluded` (`vat_not_representable`) เว้นแต่ Phase 0 พบทางแทน
- AC-5 หักค่าบริการ 3% นิติบุคคล → `ภ.ง.ด.53`, `ค่าบริการ (นิติบุคคล)`, ฐาน 1,000.00, `3`, 30.00; บุคคลธรรมดา + `SEPARATE_PND2` → `ภ.ง.ด.2` (FlowAccount: excluded)
- AC-6 ไม่มี URL, cuid, enum อังกฤษ; วันที่เปิดใน Excel เป็นวันที่
- AC-7 ตัวกรองยกเลิก + รูปแบบนำเข้า → T8 ไม่มีไฟล์; หน้ารายการ (ไม่ส่ง status) ส่งออกได้
- AC-8 (Phase 2) ไฟล์ FlowAccount จาก AC-2/AC-3/AC-5 + ใบไม่มี VAT นำเข้าบริษัททดลองผ่าน 0 แถวแดง VAT/หักตรงทุกสตางค์; ไม่มีแถวใดมีวันที่ชำระโดยไม่มีวิธี; ทุกเอกสารที่มีหักมีวิธีการชำระ; ไม่มีเลขอ้างอิงใดมีประเภทเงินได้สองค่า
- AC-13 สมุดรายวันซื้อของเอกสารค่าเช่า 5% + ค่าบริการ 2% บัญชีเดียวกัน มีสองแถว ผลรวมฐาน/ยอดหักเท่าหัวเอกสาร
- AC-14 (R3-F2) เอกสาร 100+7 (`V7`) + 100+7 (`ND`) บัญชีเดียวกัน → สมุดรายวันซื้อสองแถว `ใช้ได้ตามเงื่อนไข` 7.00 และ `ใช้ไม่ได้` 7.00; FlowAccount → เอกสารอยู่ใน `excluded` (`vat_not_representable`, มี VAT ที่ใช้สิทธิไม่ได้) จนกว่า Phase 0 ยืนยันวิธีบันทึก
- AC-15 (R3-F2) บรรทัด `V7` (snapshot `CLAIMABLE`) ในเอกสารที่ผู้ตรวจเปลี่ยนเป็น `NON_CLAIMABLE` 'ใช้ส่วนตัว' → สมุดรายวันซื้อ `ใช้ไม่ได้` 7.00 และ FlowAccount อยู่ใน `excluded`; ผลตรงกับที่บัญชี (`posting-engine.logic.ts:298-299`) และการ sync (`sync-tax-events.use-case.ts:139`) ไม่นับ VAT นี้; เอกสาร `CLAIMABLE` ไม่ทำให้บรรทัด `ND` เป็น `ใช้ได้ตามเงื่อนไข`
- AC-9 > 500 แถว → หลายไฟล์ ไม่มีเอกสารถูกแบ่ง
- AC-10 รายการที่ไม่ได้ใส่แสดงชื่อและเหตุผลบนหน้าจอ รวมกรณีทุกรายการถูก exclude
- AC-11 W00 spec ผ่านโดยไม่ regenerate
- AC-12 dialog/การ์ด/หน้าหมวดหมู่ มีภาพเบราว์เซอร์จริงที่ 390, 1280, ~1,556 px; ปุ่มกลุ่มเดียวกันสูง/กว้างเท่ากัน (วัด); ไม่มีเลื่อนแนวนอน

## 16. Risks / rollout

- FlowAccount เปลี่ยนแม่แบบ → หัวคอลัมน์อยู่ที่เดียวใน contracts; ขั้นจับคู่คอลัมน์ลดผลกระทบ
- นำเข้าซ้ำ (G2) — Q4
- สัดส่วนเอกสารที่ถูก exclude สูง (เช่น ร้านที่หักแบบยอดเงินบ่อย จ่ายหลายงวด) จะทำให้ FlowAccount preset มีประโยชน์น้อย — **Phase 1 จึงมีตัวจำแนก `flowAccountEligibility(record, lines, payments)`** (ฟังก์ชันบริสุทธิ์ ใช้เฉพาะข้อเท็จจริงในมั่งมี: สกุล, รูปหัก ณ ที่จ่าย, การจ่าย, ภ.ง.ด.2, ประเภทผู้รับเงิน, หลายประเภทเงินได้; VAT ใช้ตัวแทนคือ "VAT ที่บันทึก ≠ round2(อัตรา × มูลค่า) ต่อแถว") และบันทึกจำนวนต่อเหตุผลใน audit ของการส่งออกสมุดรายวันซื้อ (`flowAccountIneligibleByReason`) — ข้อมูลนี้ใช้ตัดสินลงทุน Phase 2; Phase 2 ปรับเฉพาะส่วนที่ขึ้นกับผล Phase 0 (วิธีปัด VAT, ค่าที่รับ)
- ไม่มี feature switch: Phase 1 ออกได้หลังสเปกข้อ 25 Phase 1; ตัวเลือก FlowAccount ใส่ในโค้ดเมื่อ Phase 0 ผ่านเท่านั้น
- migration additive; revert โค้ดไม่ต้องลบตาราง

## 17. Open questions (เรื่องธุรกิจ)

- Q1 ทุกแพ็กที่ขายได้ไฟล์นำเข้าโปรแกรมบัญชี? — **แนะนำ: ทุกแพ็ก** (ชุด `starter` เดียวกัน ไม่เพิ่มคีย์) เป็นส่วนของ "ส่งให้นักบัญชี" ที่ทุกแพ็กมี; FlowAccount ให้ AI Connector ทุกแพ็กเกจของเขา
- Q2 อนุญาตให้ทีมดาวน์โหลดแม่แบบ "นำเข้าบิลและใบเสร็จ" จาก FlowAccount ของบริษัทคุณ (ดูอย่างเดียว) ทดลองนำเข้าใน **บริษัททดลอง** ของ FlowAccount และให้นักบัญชีของคุณดูวิธีบันทึก VAT ที่ใช้สิทธิไม่ได้? — **แนะนำ: ได้** (block เฉพาะ Phase 2)
- Q3 PEAK และ Express: รอให้ลูกค้า/สำนักงานบัญชีที่ใช้ส่งไฟล์แม่แบบ (PEAK) หรือแม่แบบโปรแกรมเสริม (Express) มาก่อน? — **แนะนำ: รอ**
- Q4 ต้องการให้ระบบจำว่ารายการไหน "ส่งออกไปโปรแกรมบัญชีแล้ว"? — **แนะนำ: ยังไม่ต้อง**
