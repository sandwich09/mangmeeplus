# Accountant Export Cleanup Spec — ไฟล์ที่ส่งให้นักบัญชี มีแค่ที่จำเป็น อ่านเข้าใจ และไม่มีลิงก์ที่เปิดไม่ได้

Status: DRAFT — blocked on: RC-F2 (selection intersect) review before Phase 1.4; Phase S and 1.1–1.3 can start. Review rounds 1–3 + focused blocker checks (last one 2026-10-24) applied
Owner: Expenses lane (controller review)
Related: backlog ข้อ 25 ใน `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md`, `docs/specs/expense-receipt-upload-spec.md` (Amendment 2026-10-23 ชี้มาที่นี่), `docs/specs/vat-registration-aware-expense-capture-spec.md` §12.1, `docs/specs/accounting-software-export-spec.md` (ข้อ 13), `docs/plans/accountant-export-cleanup-plan.md`, `docs/agent-memory/accountant-exports.md`, `docs/guidelines/thai-ux-standard.md`
Baseline: main 6c54ba208 (2026-10-23) — worktree `claude/expense-specs-20261023` tree เดียวกัน (`7593ad1f…`)

คำของเจ้าของ (2026-10-23):
- "ฟีลด์บน excel และไฟล์ที่ส่งออกให้บัญชี หรือ export ออกไปควรมีแค่สิ่งที่จำเป็นจริงๆเท่านั้น บางอย่างที่ลิ้งค์กลับมาที่ระบบแล้วกดไม่ได้ กดเข้ามาก็ติดสิทธิ์หรือล็อคอินไม่ได้ก็ไม่ควรใส่"
- "รวมถึงหัวข้อ คอลัมภ์ต่างๆด้วย ต้องสื่อความเป็นภาษาที่เข้าใจได้"

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

### 1.1 ไฟล์ทุกชนิดที่ร้านในแพ็กที่ขายส่งออกได้ (ตรวจจากโค้ด)

แพ็กที่ขาย: 249/499/999/1999 ใช้ชุด `starter` เดียวกัน ([menu-entitlements.ts:432-450](../../packages/contracts/src/menu-entitlements.ts), [:496-501](../../packages/contracts/src/menu-entitlements.ts)) ซึ่งมี `expenses.list`, `expenses.evidence`, `reimbursement` แต่ไม่มี `thai_tax`, `double_entry_ledger`, `reports`; ENTERPRISE_1999 เพิ่มแค่ `wht_pnd53` + `wht_50bis`

| # | ไฟล์ | ปุ่ม/ที่มา | แพ็ก | รูปแบบ | หมายเหตุจากโค้ด |
|---|---|---|---|---|---|
| E1 | `สรุปรายจ่าย-YYYY-MM.xlsx` | หน้ารายการค่าใช้จ่าย → "ส่งออก Excel ให้สำนักงานบัญชี" → "ดาวน์โหลด Excel" ([ExpensesPages.tsx:2909-2934](../../apps/web/src/features/expenses/ExpensesPages.tsx), dialog [:2987-3007](../../apps/web/src/features/expenses/ExpensesPages.tsx)) | ทุกแพ็ก (`expense.export`) | xlsx | เลือก "แบบย่อ" 12 ช่อง หรือ "แบบเต็มสำหรับสำนักงานบัญชี" 56 ช่อง ([:2996-2999](../../apps/web/src/features/expenses/ExpensesPages.tsx)) |
| E2 | `สรุปรายจ่าย-YYYY-MM.xlsx` | หน้า "หลักฐานทางบัญชี" → "เพิ่มเติม" → "ส่งออก Excel ให้สำนักงานบัญชี" ([ExpensesWorkspacePanels.tsx:765-787](../../apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx), [:903-905](../../apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx)) | ทุกแพ็ก | xlsx | บังคับชุดเต็ม (`columnSet: 'full'` [:770](../../apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx)) |
| E3 | `หลักฐาน-YYYY-MM[-ชุดที่-N].zip` | "ดาวน์โหลดชุดเอกสารให้สำนักงานบัญชี" ทั้งสองหน้า ([EvidenceBundleDownload.tsx:25-28](../../apps/web/src/features/expenses/EvidenceBundleDownload.tsx)) | ทุกแพ็ก | zip | ไฟล์เอกสาร + `สารบัญ.xlsx` ชุดเต็ม + `ไฟล์ที่ไม่ได้รวม.txt` ([expense-evidence.use-case.ts:459-493](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts)); ไฟล์ถูกอ่านฝั่งเซิร์ฟเวอร์ตอนกด (`readBytes`) จึงตรวจสิทธิ์ ณ เวลาที่กด |
| E4 | CSV คีย์เครื่อง + `evidenceManifest` (JSON ใน response) | `POST …/accountant-package` | — | json | หน้าเว็บไม่ได้ใช้ทั้งคู่ (grep `evidenceManifest`/`indexCsv` ใน `apps/web` ไม่พบ) — **คงไบต์เดิม** ด้วยการแยก projection (§7.1); manifest มีลิงก์ presigned ใช้ได้จนหมดอายุ (ค่าตั้งต้น 900 วินาที [s3-storage.adapter.ts:94](../../apps/api/src/modules/data-model-core/infrastructure/storage/s3-storage.adapter.ts)) |
| E5 | `สมุดรายรับรายจ่าย_<from>_<to>.csv` + `.xlsx` | หน้า `/income-expense-ledger` ([IncomeExpenseLedgerPage.tsx:632](../../apps/web/src/features/accounting-documents/IncomeExpenseLedgerPage.tsx)) | เปิดด้วย URL ได้ถ้ามี `expense.read` ([route-permissions.ts:75](../../apps/web/src/features/web-core-workspace/route-permissions.ts)) แต่ **ไม่มีเมนูหรือลิงก์ใดชี้มา** | csv+xlsx | 9 ช่อง ([income-expense-ledger.use-case.ts:344-356](../../apps/api/src/modules/accounting-documents/application/use-cases/income-expense-ledger.use-case.ts)) |
| E6 | `รายการให้ผู้ทำบัญชี-PND53-YYYY-MM.xlsx` + แบบ ภ.ง.ด. PDF | หน้า ภ.ง.ด.53 | ENTERPRISE (`wht_pnd53`) | xlsx/pdf | 10 ช่อง ไม่มีลิงก์ แถวมาจาก tax event รายการจ่าย — **ตัวอย่างที่ดี** ([withholding-accountant-export.ts:32](../../apps/api/src/modules/tax/application/services/withholding-accountant-export.ts)) |
| E7 | หนังสือรับรอง 50 ทวิ PDF | รายจ่าย / LINE | ENTERPRISE (`wht_50bis`) | pdf | แบบฟอร์มกรมสรรพากร ไม่มีลิงก์ |
| E8 | ใบสำคัญจ่าย PDF, ใบรับรองแทนใบเสร็จ PDF, ใบเบิกพิมพ์ | หน้าเอกสาร | ทุกแพ็ก | pdf | ไม่มีลิงก์กลับเข้าระบบ (grep `http`/`webLink`/`companies/${` ใน `disbursement-voucher-pdf.logic.ts`, `substitute-receipt-pdf.logic.ts`, `payment-voucher.logic.ts`, `reimbursement-claim-form.use-case.ts` ไม่พบ) |
| E9 | ชุดยื่นภาษี (`tax/periods/:id/filing-packages`) | Tax workspace | `thai_tax` — **ไม่ได้ขาย** | — | gap (§12) |
| E10 | LINE | — | — | — | ไม่ส่งไฟล์ให้นักบัญชี ลิงก์ในการ์ดไปหาสมาชิกที่ล็อกอินผ่าน handoff ([line-handoff-link.service.ts:89-106](../../apps/api/src/modules/line-ai/application/line-handoff-link.service.ts)) |

export ใน billing-admin / sales-console / executive (`system/…`) เป็นเครื่องมือทีมงานมั่งมี — นอกขอบเขต

### 1.2 สิ่งที่ผิดในไฟล์ให้นักบัญชี (E1–E3)

ชุดเต็มมี **56 ช่อง** (นับจาก [expenses.ts:1731-1797](../../packages/contracts/src/expenses.ts) — backlog เขียน 57) ชุดย่อ 12 ช่อง ([:1862-1871](../../packages/contracts/src/expenses.ts))

1. **ลิงก์ "เปิดไฟล์" ไม่ได้เปิดไฟล์** — `HYPERLINK(webLink(row.web_url),"เปิดไฟล์")` ([expense-export.logic.ts:260-261](../../apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts)), `web_url = /companies/<companyId>/expenses/<expenseId>` ([expense-evidence.use-case.ts:229](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts)) = หน้าแอปที่ต้องล็อกอินและมีสิทธิ์; อยู่ทั้งชุดย่อ ชุดเต็ม แผ่น "หลักฐานการจ่าย" ([:268-270](../../apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts)) และสารบัญใน ZIP; ไม่ตั้ง `WEB_BASE_URL` → path เปล่า ([web-link.ts:23-27](../../apps/api/src/common/http/web-link.ts)); สเปกเก่ากำหนดเป็น "ลิงก์เปิดในระบบ" ([expense-receipt-upload-spec.md:229](expense-receipt-upload-spec.md))
2. **ช่องลงบัญชีผิดความหมายในแพ็กที่ขาย** — ยืนยันแล้วทุกใบได้ `postingStatus = 'pending'` ([expense-status.logic.ts:338-343](../../apps/api/src/modules/expenses/domain/logic/expense-status.logic.ts)) และเขียน `pending` ดิบ
3. **รหัสภายในในเซลล์** — แผนที่คำไทยมีแค่ 5 ช่อง ([expense-export.logic.ts:231-237](../../apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts)); หลุดดิบ: `WEB/LINE/API/OTHER` ([:90-104](../../apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts)), `pending/not_required`, `expense.office_supplies` ([:181](../../apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts)), `BANK_TRANSFER` ([:193](../../apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts)), `COMPANY/PERSONAL_ADVANCE/LEGACY_UNSPECIFIED` ([expense-evidence.use-case.ts:218](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts)), `verified/assumed/…` ([expense-export.logic.ts:208](../../apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts)), JSON ประวัติใบรับรองที่มี id/checksum/path ([expense-evidence.use-case.ts:220-225](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts))
4. **ชื่อพนักงานที่ไม่ต้องใช้ลงบัญชี** — ผู้ส่งเอกสาร ผู้ตรวจ ([expense-evidence.use-case.ts:189-190](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts)) ผู้ตรวจสิทธิภาษีซื้อ + เวลา ([expense-export.logic.ts:155-156](../../apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts))
5. **อ้างอิงไฟล์สองระบบไม่ตรงกัน** — `EXP-…-ab12cd34` ([expense-export.logic.ts:112-120](../../apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts)) อ้าง manifest ที่หน้าเว็บไม่ให้ดาวน์โหลด; ชื่อจริงใน ZIP คือ `ใบเสร็จ/EXP-…-1.jpg` ([expense-evidence.use-case.ts:386-389](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts))
6. **ช่องว่างทุกแถว** — `quantity: null` ตายตัว ([expense-evidence.use-case.ts:201](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts))
7. **หัก ณ ที่จ่ายผิดงวด ผิดแบบ ผิดฐานได้** — ไฟล์มีแค่ยอดหักทั้งเอกสาร แต่ ภ.ง.ด. ยื่นตาม**การจ่ายแต่ละครั้ง**: ระบบแบ่งฐานและภาษีตามรายการจ่ายที่ยืนยันวันที่แล้ว และแยกบรรทัดเก่าที่มีหมวด/อัตราของตัวเอง ([expense-source.adapter.ts:96-131](../../apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.ts), [expense-payment-withholding.logic.ts:6-20](../../apps/api/src/modules/tax/domain/logic/expense-payment-withholding.logic.ts)) — บิลฐาน 1,000 หัก 30 จ่ายครึ่งในกันยายนครึ่งในตุลาคม ต้องเป็นฐาน 500/หัก 15 ต่อเดือน; บุคคลธรรมดาเป็น ภ.ง.ด.2 เมื่อหมวดกำหนด `SEPARATE_PND2` ([sync-tax-events.use-case.ts:74](../../apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts)); ฐานหักไม่จำเป็นต้องเท่ามูลค่าเอกสาร (fixture มูลค่า 70.50 ฐาน 270.50 หัก 2.71 [expense-totals.logic.spec.ts:178-185](../../apps/api/src/modules/expenses/domain/logic/expense-totals.logic.spec.ts)); เลข 50 ทวิ ที่ออกนอกระบบ (pack ไม่ผูกแพ็ก [capability-pack.registry.ts:495-506](../../apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts)) ไม่ถูกใส่ ([expense-evidence.use-case.ts:236](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts), [:366](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts))
8. **วันที่จ่ายอาจเก่า** — ยืนยันวันที่จ่ายอัปเดตแถวการจ่าย แต่หัวเอกสารแตะแค่ `updatedAt` ([prisma-expense.repository.ts:831-833](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) ขณะที่ไฟล์อ่าน `ExpenseRecord.paidAt` ([expense-evidence.use-case.ts:213](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts))
9. **ไม่บอกสกุลเงิน** — ร่างรับ `currency` อื่นได้ ([expense-draft.use-case.ts:166](../../apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts)) แต่ไฟล์ไม่มีคอลัมน์สกุลเงิน ([expense-evidence.use-case.ts:208](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts))
10. **หัวคอลัมน์ไม่ตรงความจริง/อภิธานศัพท์** — `เลขอ้างอิงการจ่าย` ([expenses.ts:1840](../../packages/contracts/src/expenses.ts)) แต่ค่าคือ "จ่ายจาก (ถ้ามี)" ([DisbursementVoucherPayCard.tsx:146](../../apps/web/src/features/expenses/disbursement-vouchers/DisbursementVoucherPayCard.tsx)); `สาขา` เป็น `Branch.code` ภายใน ([expense-evidence.use-case.ts:150-151](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts)) ไม่ใช่ `taxBranchCode` ([schema.prisma:1129-1131](../../apps/api/prisma/schema.prisma)); `บริษัท` (อภิธานศัพท์ `ร้าน`); โฟลเดอร์ `สลิปการจ่าย` ([expense-evidence.use-case.ts:400](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts)) (อภิธานศัพท์ `หลักฐานการจ่าย`)
11. **ZIP หลายชุดชี้ไฟล์ข้ามชุด** ([expense-evidence.use-case.ts:233-238](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts), [:483](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts))
12. **ชื่อไฟล์ใน ZIP มี id ภายใน** ([:389](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts), [:400](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts), [:414](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts)); ใบรับรองแทนใบเสร็จฉบับเดิมที่ถูกแทนแล้วยังอยู่ใน ZIP ([expense-evidence-sources.ts:75-81](../../apps/api/src/modules/expenses/infrastructure/expense-evidence-sources.ts), [expense-evidence.use-case.ts:383](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts)) — เมื่อตัด JSON ประวัติแล้วต้องมีคำบอกว่าฉบับไหนใช้อยู่
13. **เดือนที่มีแต่การจ่ายถูกปฏิเสธ** — ทั้งสองหน้าหยุดเมื่อ `rowCount === 0` ([ExpensesPages.tsx:2918](../../apps/web/src/features/expenses/ExpensesPages.tsx), [ExpensesWorkspacePanels.tsx:773](../../apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx)) แม้มีการจ่ายของรายการเดือนก่อน

### 1.3 สิ่งที่ผิดในไฟล์อื่น

- E5: `สถานะ` enum ดิบ, `หลักฐานต้นทาง` path แอปไม่มีโดเมน ([income-expense-ledger.use-case.ts:304](../../apps/api/src/modules/accounting-documents/application/use-cases/income-expense-ledger.use-case.ts), [:314](../../apps/api/src/modules/accounting-documents/application/use-cases/income-expense-ledger.use-case.ts), [:344-347](../../apps/api/src/modules/accounting-documents/application/use-cases/income-expense-ledger.use-case.ts)); วันที่ ISO; **ไม่บอกสกุลเงิน** — รายจ่ายต่างสกุลที่ยืนยันแล้วออกเป็นตัวเลขเปล่า ([:312](../../apps/api/src/modules/accounting-documents/application/use-cases/income-expense-ledger.use-case.ts))
- E6: แผ่น `ภ.ง.ด.2` ใส่เสมอแม้ว่าง ([withholding-accountant-export.ts:45](../../apps/api/src/modules/tax/application/services/withholding-accountant-export.ts)); หัว `อัตรา` ไม่บอกหน่วย; **รวมยอดข้ามสกุล** — event ต่างสกุลของหมวด `SEPARATE_PND2`/`ACCOUNTANT_PREPARES` ผ่านด่านสกุลเงินได้ (ด่านตรวจเฉพาะ `SYSTEM_FILLS` [sync-tax-events.use-case.ts:291](../../apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts)) แล้วไฟล์ไม่มีคอลัมน์สกุลและรวมยอดทุกแถวเป็นตัวเลขเดียว ([withholding-accountant-export.ts:41](../../apps/api/src/modules/tax/application/services/withholding-accountant-export.ts))

## 2. เป้าหมาย

1. **กติกาเดียว**: ช่องอยู่ได้เมื่อนักบัญชีใช้ (ก) บันทึกบัญชี (ข) ใช้สิทธิภาษีซื้อ/ยื่นภาษีหัก ณ ที่จ่าย หรือ (ค) หาเอกสารกระดาษเจอ
2. **ไม่มีลิงก์เข้าแอป** — ลิงก์ได้เฉพาะไฟล์ใน ZIP ชุดเดียวกัน แบบ path สัมพัทธ์
3. **หัวคอลัมน์และค่าทุกเซลล์เป็นภาษาไทยที่นักบัญชีเข้าใจ**
4. **ซ่อนคอลัมน์ตามโครงสร้างร้าน/สิทธิ์เท่านั้น** ตำแหน่งคงที่ทุกเดือน
5. **หัก ณ ที่จ่ายในไฟล์ใช้ข้อเท็จจริงชุดเดียวกับ ภ.ง.ด.** — แถวต่อการจ่าย จาก projection เดียวกับการ sync; แถวที่ยื่นแล้วใช้ภาพที่ยื่นจริง; ทุกแถวบอกสถานะว่ายื่นแล้ว / งวดปิดแล้ว / ยังไม่ยื่น (ข้อมูลครบตามแบบ หรือต้องตรวจพร้อมเหตุผล) — ไม่สัญญาว่าตรงกับ tax event หรือยื่นผ่านทุกแถว (§5.3)
6. มีทุกช่องที่รายงานภาษีซื้อ (VAT ฉบับ 89/202) และใบแนบ ภ.ง.ด. ต้องใช้
7. ไม่เปิดเผยชื่อพนักงานเกินจำเป็น
8. CSV คีย์เครื่อง/`indexRows`/manifest คงไบต์เดิม

## 3. Non-goals

- เปลี่ยน CSV คีย์เครื่อง / `indexRows` / `evidenceManifest` (§7.1)
- ไฟล์นำเข้าโปรแกรมบัญชี — `accounting-software-export-spec.md`
- ชุดยื่นภาษี `thai_tax` (E9) — gap
- ส่งไฟล์ผ่าน LINE / อีเมล
- เปลี่ยนหน้าตา PDF (ไม่มีลิงก์)
- แปลงเงินต่างสกุลเป็นบาท (ไฟล์บอกสกุลตามจริง)
- วันที่เป็นเซลล์วันที่จริง — คงข้อความวันที่ไทยตามการตัดสินใจเดิม ([xlsx.logic.ts:158](../../apps/api/src/common/export/xlsx.logic.ts))
- ซ่อน VAT ของร้านที่ไม่ได้จด VAT — คงการตัดสินใจเดิม ([vat-registration-aware-expense-capture-spec.md §12.1](vat-registration-aware-expense-capture-spec.md))
- ทำให้ลิงก์ presigned ใน manifest หมดสิทธิ์ทันทีเมื่อถอนสิทธิ์ (ไฟล์ใหม่ไม่มีลิงก์ presigned; ข้อจำกัดบันทึกใน Amendment)

## 4. ผู้ใช้และ journey

| ผู้ใช้ | สิทธิ์ | เว็บ | LINE |
|---|---|---|---|
| เจ้าของกิจการ / การเงิน | `expense.export` + `expense.read` (`pack.expense.view` / `pack.expense.finance` [capability-pack.registry.ts:265-292](../../apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts)) | J1 หน้ารายการ → "ส่งออก Excel ให้สำนักงานบัญชี" → Excel และ/หรือ ZIP; J2 หน้าหลักฐานทางบัญชี → เลือกเดือน → ZIP / Excel | การ์ดคู่มือ `expense.export` ([approved-product-help.ts:54-55](../../apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts)) — **ยังจริง ไม่แตะ** |
| นักบัญชีสมาชิก / ผู้ตรวจ | เหมือนแถวบน | J2 เป็นหลัก | เหมือนแถวบน |
| สำนักงานบัญชีภายนอก | ไม่มี | J3 แตก ZIP → เปิด `สารบัญ.xlsx` → `รายการค่าใช้จ่าย` (ลงบัญชี/ภาษีซื้อ), `การจ่าย` (ลงจ่าย), `หัก ณ ที่จ่าย` (ทำ ภ.ง.ด.) → กด `ไฟล์เอกสาร` | — |
| ร้าน ENTERPRISE | `wht.pnd53.prepare` | J4 หน้า ภ.ง.ด.53 → "ดาวน์โหลดรายการให้ผู้ทำบัญชี" | — |

## 5. กติกา/ข้อยกเว้น

### 5.1 กติกาเลือกคอลัมน์

- R1 คอลัมน์อยู่ได้เมื่อมีเหตุผล (ก)/(ข)/(ค) — ตาราง §7.2
- R2 ไม่มี URL แอป ไม่มีลิงก์ presigned ไม่มี cuid ในเซลล์หรือชื่อไฟล์
- R3 ซ่อนคอลัมน์ตาม "โครงสร้าง" เท่านั้น: แพ็ก, จำนวนสาขา, สิทธิ์ของคนกด — ไม่ตามข้อมูลรายเดือน; แผ่นที่ไม่มีแถว (`การจ่าย`, `หัก ณ ที่จ่าย`) ไม่ใส่ และแผ่น `เกี่ยวกับไฟล์นี้` บอกว่าไม่มี
- R4 ทุกค่าจาก enum ผ่านแผนที่คำไทยใน contracts; ไม่รู้จัก → `อื่น ๆ`
- R5 ช่องว่าง (บอกครั้งเดียวในแผ่น `เกี่ยวกับไฟล์นี้`): `ช่องว่าง = ไม่มีข้อมูลนี้ในมั่งมี หรือไม่เกี่ยวกับรายการนี้ (เช่น รายการที่ไม่มีหัก ณ ที่จ่าย)`; ข้อมูลที่ต้องใช้แต่ยังไม่มี → `ยังไม่ระบุ`; ห้ามเว้นว่างเพราะสิทธิ์ — ซ่อนทั้งคอลัมน์
- R6 เงินเป็นสกุลตามคอลัมน์ `สกุลเงิน` ของแถว ไม่แปลง ไม่รวมข้ามสกุล

### 5.2 รายงานภาษีซื้อ (ประกาศอธิบดีฯ VAT ฉบับ 89 แก้โดยฉบับ 202)

แหล่ง: https://rd.go.th/3374.html (ฉบับ 89), https://rd.go.th/27985.html (ฉบับ 202), แบบแนบท้ายฉบับ 202 https://www.rd.go.th/fileadmin/images/image_law/images/vat-202-02.pdf (เปิดหน้า 1), แบบเดิม https://www.rd.go.th/fileadmin/images/image_law/images/buy.pdf

- ข้อ 8(2) ลง "เป็นรายใบกำกับภาษี … เรียงตามลำดับใบกำกับภาษีที่ได้รับโดยไม่คำนึงว่าใบกำกับภาษีนั้นจะลงวันเดือนปีใด" ภายในสามวันทำการ
- ข้อ 8(1)(ข) เก็บเรียงตามลำดับที่ได้รับ; ลงเฉพาะใบกำกับภาษีเต็มรูป ใบเสร็จกรมสรรพากร/ศุลกากร/สรรพสามิต
- ข้อ 2/3 (ฉบับ 202) ลงเลขประจำตัวและสถานประกอบการของผู้ขาย สำหรับใบกำกับภาษีตั้งแต่ 1 ม.ค. 2558
- ข้อ 10 คอมพิวเตอร์ได้ ไทยหรืออังกฤษได้
- แบบ (vat-202-02.pdf): หัว เดือนภาษี/ปี, ชื่อผู้ประกอบการ, เลขประจำตัว (13 ช่อง), ชื่อสถานประกอบการ, สำนักงานใหญ่/สาขาที่ (5 ช่อง); ตาราง ลำดับที่ | ใบกำกับภาษี (วัน เดือน ปี | เลขที่/เล่มที่) | ชื่อผู้ขาย | เลขประจำตัวผู้ขาย | สถานประกอบการ* (สำนักงานใหญ่ | สาขาที่) | มูลค่าสินค้าหรือบริการ | จำนวนเงินภาษีมูลค่าเพิ่ม | รวม (หน้า 2 อธิบาย * — **ยังไม่ได้อ่าน**)

| ช่องในแบบ | คอลัมน์ในไฟล์ (แผ่น `รายการค่าใช้จ่าย`) | ผล |
|---|---|---|
| เดือนภาษี/ปี | ไม่ใส่ — นักบัญชีเลือกจาก `วันที่เอกสาร` + `วันที่ส่งเข้ามั่งมี` | พอ |
| ชื่อ/เลขประจำตัว/สถานประกอบการของร้าน | แผ่น `เกี่ยวกับไฟล์นี้` + `สาขาของร้าน` เมื่อมีหลายสาขา (ข้อ 5) | ครบ |
| ลำดับที่ | ไม่ใส่ | พอ |
| วันที่ใบกำกับ | `วันที่เอกสาร` | ครบ |
| เลขที่/เล่มที่ | `เลขที่ตามเอกสาร` | ครบ |
| ชื่อผู้ขาย / เลขประจำตัว / สาขา | `ผู้ขาย/ผู้รับเงิน` / `เลขประจำตัวผู้เสียภาษีผู้ขาย` / `สาขาผู้ขาย` | ครบ |
| มูลค่าสินค้าหรือบริการ | `มูลค่าก่อน VAT` (`taxableAmount` [expense-totals.logic.ts:150-155](../../apps/api/src/modules/expenses/domain/logic/expense-totals.logic.ts)) | ครบ |
| จำนวนเงินภาษีมูลค่าเพิ่ม | `VAT` (ยอดที่บันทึก — คงยอดบนใบเมื่อผู้ใช้กรอกยอด VAT) | ครบ |
| ลงเฉพาะใบที่ใช้สิทธิได้ | `ประเภทเอกสาร` + `สิทธิภาษีซื้อ` | ครบ |
| เรียงตามลำดับที่ได้รับ | `วันที่ส่งเข้ามั่งมี` (`receivedAt` ไม่มีหน้าจอบันทึก) | ใกล้เคียง (G1) |
| เป็นเงินบาท | `สกุลเงิน` | G7 |

### 5.3 ภ.ง.ด.2/3/53 — แผ่น `หัก ณ ที่จ่าย`

แหล่ง: https://rd.go.th/62377.html ; ใบแนบ ภ.ง.ด.53 https://www.rd.go.th/fileadmin/tax_pdf/withhold/290360_attach53.pdf (เปิดหน้า 1 ฉบับ มี.ค. 2560); ใบแนบ ภ.ง.ด.3 https://www.rd.go.th/fileadmin/tax_pdf/withhold/270360_attach3.pdf (**ไม่ได้เปิด**)

- ใบแนบ ภ.ง.ด.53: ลำดับที่ | เลขประจำตัวผู้เสียภาษี (ผู้มีเงินได้) + ชื่อและที่อยู่ | สาขาที่ | วัน เดือน ปี ที่จ่าย | ประเภทเงินได้พึงประเมินที่จ่าย | อัตราภาษีร้อยละ | จำนวนเงินที่จ่ายในครั้งนี้ | จำนวนเงินภาษีที่หักและนำส่งในครั้งนี้ | เงื่อนไข (1 หัก ณ ที่จ่าย / 2 ออกภาษีให้)
- **หน่วยของแถว = การจ่ายหนึ่งครั้ง × หนึ่งบรรทัดหัก** จาก projection เดียวกับการ sync ภ.ง.ด. (`ExpenseSourceAdapter.findConfirmedWithWhtByCompany` [expense-source.adapter.ts:70-136](../../apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.ts)): แบ่งฐาน/ภาษีด้วย `allocateExpenseWithholding`, แยกบรรทัดเก่าที่มีหมวด/อัตราของตัวเอง (`split` [:104](../../apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.ts)), ใส่เฉพาะการจ่ายที่ยืนยันวันที่แล้ว, วันที่จ่ายตามเขตเวลาร้าน — ไม่มีการคำนวณซ้ำฝั่งรายจ่าย
- **projection ไม่ใช่ภาพที่ยื่น** — adapter ตรึงเฉพาะ*ยอด*ฐาน/ภาษีของบรรทัดที่ยื่นแล้ว ([expense-source.adapter.ts:91-96](../../apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.ts)) ส่วนวันที่ หมวด อัตรา ผู้รับเงิน ที่อยู่ (ที่อยู่ดึงจากทะเบียนคู่ค้าเมื่อไม่มี snapshot [:126](../../apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.ts)) อ่านสด และ sync ข้ามแถวที่ยื่นแล้ว/งวดปิด (`skippedLocked` [sync-tax-events.use-case.ts:282](../../apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts), [:297-298](../../apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts)) และไม่สร้าง event เมื่อไม่รู้ประเภทผู้รับเงิน ([:283-284](../../apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts)), สกุลไม่ใช่สกุลหลักแบบ `SYSTEM_FILLS` ([:291-295](../../apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts)) หรือไม่มีเลขผู้เสียภาษีแบบ `SYSTEM_FILLS` ([:300-304](../../apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts)). ดังนั้นแต่ละแถวเลือกแหล่งข้อมูลและบอกสถานะ (คอลัมน์ `สถานะ`):
  0. **ลำดับ (R3-F3 — ปิดแล้ว ดู §0): หาว่าอะไรถูกครอบก่อน แล้วค่อยกรองวันที่ของแต่ละแถวด้วยวันที่ของมันเอง** — ชุดแหล่ง = `page.rows` หลังขยาย ∪ รายการที่ผ่านขอบเขตและตัวกรองเดียวกับแผ่นหลัก (ยกเว้นเงื่อนไขวันที่) และมีบรรทัดในแบบ `FILED` ที่ `periodKey` เป็นเดือนในช่วง — **รายการกลุ่มหลังนี้เข้ารายการขยายเดียวกับการจ่าย/ใบสำคัญจ่าย/50 ทวิ (`extraIds` [expense-evidence.use-case.ts:369-371](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts)) จึงถูกตัดทิ้งพร้อมกันเมื่อคำขอระบุ `page`/`pageSize` ([:372](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts))** — แต่ละหน้าอ่านบรรทัดที่ยื่นเฉพาะของ `page.rows` ของหน้านั้น (แบ่งหน้าเรียงคงที่ [prisma-expense.repository.ts:4778-4779](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) บรรทัดที่ยื่นจึงอยู่ได้ไม่เกินหนึ่งหน้า (RC-F1 ปิดแล้ว); **เมื่อคำขอระบุ `expenseIds` ให้ตัดรายการกลุ่มนี้ให้เหลือเฉพาะที่เลือก ก่อนเข้า `extraIds` — เลือกว่าง `[]` = ไม่เพิ่มเลย** เพราะตัวโหลดรายการขยายแทนที่การเลือกด้วย `extraIds` ([:375](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts)) และ `[]` แปลว่าไม่ตรงกับอะไร ([expenses.ts:1663](../../packages/contracts/src/expenses.ts)) (RC-F2 รอรีวิว §0); ไฟล์ที่ไม่แบ่งหน้าและ ZIP อ่านทั้งชุด; อ่าน projection ของชุดนี้**โดยไม่กรองวันที่** และอ่านบรรทัดที่ยื่นทั้งหมดของชุดนี้; ตัดสินการครอบบนชุดเต็ม; แล้วจึงกรอง — แถวที่ยื่นใช้วันที่ที่ยื่น `payment[2]` (อ่านเป็นวันตามเขตเวลาร้านแบบเดียวกับแถวสด), แถวสดที่ไม่ถูกครอบใช้วันที่จ่าย; **แถวสดที่ถูกครอบไม่แสดงเลย** แม้แถวที่ยื่นซึ่งครอบมันอยู่นอกช่วง — นับจำนวนที่อยู่ในช่วงใส่ `เกี่ยวกับไฟล์นี้`: `การจ่ายหัก ณ ที่จ่าย N รายการในช่วงนี้ ระบบถือว่ารวมอยู่ในแบบที่ยื่นแล้วซึ่งลงวันที่จ่ายนอกช่วงนี้ จึงไม่แสดงในแผ่นนี้` (ไม่มีแล้วไม่ใส่บรรทัด). เหตุ: บรรทัดเก่าที่ไม่มีคีย์ครอบทุกการจ่ายของแหล่ง ([withholding-filing-state.ts:63](../../apps/api/src/modules/tax/application/services/withholding-filing-state.ts)) — ถ้ากรองวันที่ก่อน แบบที่ยื่นเดือนกันยายนจะถูกดึงมาแทนงวดจ่ายเดือนตุลาคม และรายได้เดือนกันยายนไปโผล่ในไฟล์ตุลาคม
  1. **แบบที่ยื่นแล้ว (R3-F3 — ปิดแล้ว ดู §0)**: อ่าน `WhtFilingLine` ของ filing `FILED` ของแหล่ง (`sourceType = 'expense.record'`, `sourceId` ในชุดแหล่งของข้อ 0) แล้วจับคู่กับแถว projection ด้วยกติกาที่ระบบใช้อยู่ `filedLineCoversPayment` ([withholding-filing-state.ts:60-65](../../apps/api/src/modules/tax/application/services/withholding-filing-state.ts)) — บรรทัดเก่าที่ไม่มีคีย์การจ่าย (`payment[13]` ว่าง) ครอบทุกการจ่ายของแหล่งนั้น และคีย์การจ่ายรวม `payment:<id>` ครอบคีย์ที่ถูกแยกภายหลัง `payment:<id>:line:<lineId>`. ส่งออก**แต่ละบรรทัดที่ยื่นหนึ่งครั้ง** จากภาพ `lineJson.payment` (วันที่ [2], สกุล [4], หมวด [5], ฐาน [6], ภาษี [7], อัตรา [8], ชื่อ [9], เลขประจำตัว [10], สาขา [11], ที่อยู่ [12] — `withholdingPaymentFacts` [:10-17](../../apps/api/src/modules/tax/application/services/withholding-filing-state.ts)) + แบบจาก filing → `ยื่นแล้ว` (อยู่ในไฟล์ตามวันที่ที่ยื่น `payment[2]`); แถว projection ที่ถูกครอบทั้งหมดถูกตัดออก (ไม่แสดงซ้ำด้วยข้อมูลสด ไม่ว่าวันที่จ่ายสดจะอยู่ในช่วงหรือไม่)
  2. ไม่ถูกครอบแต่งวดของแบบนั้นปิดแล้ว (`FILED`/`PAID`/`CLOSED`) → ข้อมูลสด + `งวดปิดแล้ว ตรวจกับแบบที่ยื่น`
  3. ไม่ถูกครอบและงวดยังเปิด → `ยังไม่ยื่น` ตามด้วยผลตรวจรายแถวชุดเดียวกับที่การตรวจก่อนยื่นใช้ (ยกการตรวจต่อแถวใน `withholding-filing-validation.ts:86-110` — ชื่อ/เลขประจำตัว 13 หลัก/สาขา 5 หลัก/ที่อยู่และความยาว, หมวดเงินได้ที่รู้จักและตรงแบบ, อัตรา > 0 และภาษีตรงอัตรา, ประเภทผู้รับเงิน — เป็นฟังก์ชันบริสุทธิ์ `withholdingRowFaults` ที่ทั้งการตรวจก่อนยื่นและไฟล์เรียก) + เงื่อนไขที่ sync ไม่สร้าง event (ไม่รู้ประเภทผู้รับเงิน, `SYSTEM_FILLS` + ต่างสกุลหลัก, `SYSTEM_FILLS` + ไม่มีเลขผู้เสียภาษี): มีข้อผิด → `ยังไม่ยื่น · ต้องตรวจ: <คำของข้อผิดแรก>`; ไม่มี → `ยังไม่ยื่น · ข้อมูลครบตามแบบ` (ไม่สัญญาว่ายื่นผ่าน — การตรวจระดับแบบ เช่น สถานประกอบการ/ลำดับใบแนบ ยังทำตอนยื่น)
- **แบบ ภ.ง.ด.** กติกาเดียวกับ sync ([sync-tax-events.use-case.ts:60-77](../../apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts)): บุคคลธรรมดา → `ภ.ง.ด.2` เมื่อหมวด `filingRoute = SEPARATE_PND2` มิฉะนั้น `ภ.ง.ด.3`; นิติบุคคล → `ภ.ง.ด.53`; ไม่รู้ประเภท → `ยังไม่ระบุ` (sync ไม่สร้างรายการและเปิดประเด็น `WHT_PAYEE_KIND_UNKNOWN`); หมวด `ACCOUNTANT_PREPARES` → หมายเหตุ `ผู้ทำบัญชีจัดทำแบบนี้เอง`
- `จำนวนเงินที่จ่าย` = ฐานของแถว projection (ไม่ใช่มูลค่าเอกสาร); อัตรา = ของแถว (หักแบบกรอกยอดเงินอย่างเดียวไม่มีอัตรา [expense-wht-input.logic.ts:8-9](../../apps/api/src/modules/expenses/domain/logic/expense-wht-input.logic.ts) → `ยังไม่ระบุ`)
- เงื่อนไข: ระบบมีแต่ "หัก ณ ที่จ่าย" — ไม่ใส่คอลัมน์
- การจ่ายยังไม่ยืนยันวันที่ → ไม่อยู่แผ่นนี้ (เหมือน ภ.ง.ด.) นับจำนวนใน `เกี่ยวกับไฟล์นี้`
- ร้าน ENTERPRISE ยังใช้ E6 ได้ตามเดิม (E6 อ่านจาก tax event ที่ sync แล้ว); แผ่นนี้ใช้ข้อเท็จจริงชุดเดียวกันสำหรับทุกแพ็ก และบอกด้วยคอลัมน์ `สถานะ` เมื่อแถวต่างจาก event ได้

### 5.4 ข้อมูลส่วนบุคคล

- พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 ฉบับที่ประกาศใช้ (กระทรวงดิจิทัลฯ https://www.mdes.go.th/law/detail/3541-พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล-พ-ศ--๒๕๖๒ — เปิด PDF 37 หน้า 2026-10-24):
  - มาตรา 22 (หน้า 9): "การเก็บรวบรวมข้อมูลส่วนบุคคล ให้เก็บรวบรวมได้เท่าที่จำเป็นภายใต้วัตถุประสงค์อันชอบด้วยกฎหมายของผู้ควบคุมข้อมูลส่วนบุคคล"
  - มาตรา 27 (หน้า 12): ห้ามใช้หรือเปิดเผยโดยไม่ได้รับความยินยอม เว้นแต่เก็บได้โดยได้รับยกเว้นตามมาตรา 24 หรือ 26 — ส่งไฟล์ให้สำนักงานบัญชีภายนอกคือ "การเปิดเผย"
  - ไม่ใช้บทความ iLaw ที่ backlog อ้าง (https://www.ilaw.or.th/articles/1378) — อธิบาย**ร่าง**กฎหมายปี 2557
- ชื่อคนในไฟล์: ผู้ขาย/ผู้รับเงิน (จำเป็นต่อรายงานภาษีซื้อและ ภ.ง.ด.) และคนที่ร้านต้องคืนเงิน (`สำรองจ่ายโดย`) เท่านั้น

### 5.5 ลิงก์ในไฟล์

- Excel สำหรับเว็บรองรับ `HYPERLINK` เฉพาะ URL (https://support.microsoft.com/en-us/office/hyperlink-function-333c7ce6-c5ae-4164-9c47-7de9b76f577f) — path สัมพัทธ์ใช้ได้กับโปรแกรมในคอมพิวเตอร์หลังแตก ZIP (Excel Windows/Mac, LibreOffice **ยังไม่ยืนยัน** — AC-6); ข้อความในเซลล์เป็น path เสมอ
- ZIP ใช้ธง UTF-8 กับชื่อไทยอยู่แล้ว ([xlsx.logic.ts:83](../../apps/api/src/common/export/xlsx.logic.ts))

## 6. Data model

ไม่มี migration: `ExpenseRecord` (snapshot, `currency`, `uploadedAt`, ยอด), `ExpensePayment.amount/currency/paymentMethod/paidAtConfirmed/paidAt/bankAccountRef/status` ([schema.prisma:2901-2913](../../apps/api/prisma/schema.prisma)), `DisbursementVoucherLine.expensePaymentId` ([:2892](../../apps/api/prisma/schema.prisma)), `WhtIncomeCategory.nameTh/filingRoute` (catalog กลาง ไม่มี `companyId` [:5600-5616](../../apps/api/prisma/schema.prisma)), `WhtCertificateHandoff`, `Branch.name/taxBranchCode/isVatEstablishment`, `CompanyFeatureEntitlement`

## 7. Contracts/API

### 7.1 สิ่งที่คงไบต์เดิม — แยก projection

- `ACCOUNTANT_INDEX_COLUMNS` (56), `ACCOUNTANT_INDEX_COLUMN_LABELS`, `AccountantPackageIndexRow`, `buildAccountantIndexRow`, `buildAccountantIndexCsv`, `indexCsv`, `indexRows`, `evidenceManifest`, `skippedEvidence` — **ไม่แก้โค้ดที่สร้างค่าเหล่านี้** (golden [expense-export.logic.spec.ts:266](../../apps/api/src/modules/expenses/domain/logic/expense-export.logic.spec.ts))
- `bundle_file_names` ของ `indexRows`/CSV มาจากชื่อไฟล์ ([expense-evidence.use-case.ts:237](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts)) — เปลี่ยนชื่อไฟล์ใน ZIP (§7.4) จะเปลี่ยนไบต์ CSV จึงให้ `bundleContents` เก็บสองชื่อต่อไฟล์: `legacyFileName` (ฟังก์ชันตั้งชื่อเดิมทุกบรรทัด แยกเป็นฟังก์ชัน) ใช้กับ `indexRows`/CSV เท่านั้น และ `fileName` ใหม่ใช้กับ ZIP + workbook; JSDoc ของ `indexCsv`/`indexRows` ระบุว่าเป็น projection รุ่นแรกที่ตรึงไว้ ชื่อไฟล์ในนั้นเป็นชื่อรุ่นแรก ไม่ใช่ path ใน ZIP ปัจจุบัน (G8; ไม่มีผู้ใช้ CSV ในรีโป)
- workbook ใหม่ใช้ projection แยก (`AccountantWorkbookRow` ฯลฯ) ไม่แก้ `AccountantPackageIndexRow`
- endpoint เดิมทั้งสาม ([expense.controller.ts:255-276](../../apps/api/src/modules/expenses/presentation/http/expense.controller.ts))

### 7.2 ชุดแผ่นและคอลัมน์ใหม่ (สารบัญใน ZIP และ Excel เดี่ยวใช้ชุดเดียวกัน)

contracts (`packages/contracts/src/expenses.ts`): `ACCOUNTANT_WORKBOOK_SHEETS`, `ACCOUNTANT_WORKBOOK_COLUMNS`, `ACCOUNTANT_PAYMENT_SHEET_COLUMNS`, `ACCOUNTANT_WITHHOLDING_SHEET_COLUMNS`, `ACCOUNTANT_FILES_SHEET_COLUMNS` + ป้าย; ย้าย `EXPENSE_PAYMENT_METHOD_LABELS`, `POSTING_STATUS_LABELS`, `POSTING_ERROR_LABELS` จากเว็บ ([expenses.model.ts:999-1032](../../apps/web/src/features/expenses/expenses.model.ts)); `expenseCurrencyLabel(code)` ใช้ `Intl.DisplayNames(['th'], { type: 'currency' })` แบบเว็บ ([ForeignCurrencyNotice.tsx:12-22](../../apps/web/src/features/expenses/ForeignCurrencyNotice.tsx)) ไม่รู้จัก → `สกุลเงินอื่น`

**แผ่น 1 `รายการค่าใช้จ่าย`** — หนึ่งแถวต่อรายการ เรียง `วันที่เอกสาร` แล้ว `เลขที่รายการ`

| # | key | หัวคอลัมน์ | ที่มา | เหตุผล | แสดงเมื่อ |
|---|---|---|---|---|---|
| 1 | `document_date` | วันที่เอกสาร | `expenseDate` เมื่ออ่านได้ | ก ข ค | เสมอ |
| 2 | `uploaded_at` | วันที่ส่งเข้ามั่งมี | `uploadedAt` | ข | เสมอ |
| — | `shop_branch` | สาขาของร้าน | `Branch.name` + `taxBranchCode` | ข | ร้านมีมากกว่า 1 สาขา (นับทุกสถานะ) |
| 3 | `expense_number` | เลขที่รายการ | `expenseNumber` | ค | เสมอ |
| 4 | `vendor_document_number` | เลขที่ตามเอกสาร | `vendorDocumentNumber` / snapshot ใบรับรอง | ก ข ค | เสมอ |
| 5 | `source_document_type` | ประเภทเอกสาร | `sourceDocumentType` | ข | เสมอ |
| 6 | `vendor_name` | ผู้ขาย/ผู้รับเงิน | snapshot เดิม ([expense-evidence.use-case.ts:191](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts)) | ก ข | เสมอ |
| 7 | `vendor_tax_id` | เลขประจำตัวผู้เสียภาษีผู้ขาย | snapshot | ข | เสมอ |
| 8 | `vendor_branch` | สาขาผู้ขาย | `vendorBranchCodeSnapshot` | ข | เสมอ |
| 9 | `vendor_address` | ที่อยู่ผู้ขาย | `vendorAddressSnapshot` | ข | เสมอ |
| 10 | `category_name` | หมวดค่าใช้จ่าย | ชื่อหมวด | ก | เสมอ |
| 11 | `description` | รายละเอียด | `note` | ก | เสมอ |
| 12 | `currency` | สกุลเงิน | `currency` | ก (R6) | เสมอ |
| 13 | `taxable_amount` | มูลค่าก่อน VAT | `taxableAmount` | ก ข | เสมอ |
| 14 | `vat_amount` | VAT | `vatAmount` | ก ข | เสมอ |
| 15 | `grand_total_amount` | ยอดรวมตามเอกสาร | `grandTotalAmount` (= 13 + 14) | ก | เสมอ |
| 16 | `input_vat_right` | สิทธิภาษีซื้อ | `inputVatClaimStatus` | ข | เสมอ |
| 17 | `tax_evidence_status` | หลักฐานรายจ่าย | `taxEvidenceStatus` | ก | เสมอ |
| 18 | `wht_amount` | หัก ณ ที่จ่าย (ทั้งเอกสาร) | `whtAmount` (รายละเอียดต่อการจ่ายอยู่แผ่น 3) | ก | เสมอ |
| 19 | `net_payable_amount` | ยอดจ่ายสุทธิ | `netPayableAmount` (= 15 − 18) | ก | เสมอ |
| 20 | `paid_amount` | จ่ายแล้ว | `paidAmount` | ก | เสมอ |
| 21 | `outstanding_amount` | ค้างจ่าย | `outstandingAmount` | ก | เสมอ |
| 22 | `last_paid_at` | วันที่จ่ายล่าสุด | `max(ExpensePayment.paidAt)` ของ `RECORDED` (ไม่อ่าน `ExpenseRecord.paidAt`) | ก | เสมอ |
| 23 | `advanced_by` | สำรองจ่ายโดย | ผู้เบิกของใบเบิก (`evidenceSources.requesterName`) หรือผู้จ่ายในใบรับรองแทนใบเสร็จ `fundingSource = PERSONAL_ADVANCE` | ก | เสมอ |
| 24 | `expense_status` | สถานะ | `status` | ก | เสมอ |
| — | `posting_status` | สถานะลงบัญชี | `postingStatus` | ก | ร้านเปิด `expenses` + `double_entry_ledger` + `expense_auto_post` ([prisma-expense.repository.ts:623](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) |
| — | `journal_entry_number` | เลขที่สมุดรายวัน | `journalEntryNumber` | ก | เงื่อนไขเดียวกัน |
| 25 | `notes` | หมายเหตุ | §7.3 | ก ข | เสมอ |
| 26 | `primary_file` | ไฟล์เอกสาร | ไฟล์หลักใน ZIP | ค | **เฉพาะสารบัญใน ZIP** |

**แผ่น 2 `การจ่าย`** (แทนแผ่น "หลักฐานการจ่าย" เดิม) — หนึ่งแถวต่อ `ExpensePayment` สถานะ `RECORDED` ที่ `paidAt` อยู่ในช่วงวันที่ของการส่งออก ทั้งของรายการในช่วงและรายการเดือนก่อน (ชุดเดียวกับที่ ZIP ดึงหลักฐานการจ่าย [expense-evidence.use-case.ts:351-352](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts)); "ทุกเดือน" ไม่กรองวันที่; เรียงตามวันที่จ่าย

| # | หัวคอลัมน์ | ที่มา | แสดงเมื่อ |
|---|---|---|---|
| 1 | วันที่จ่าย | `ExpensePayment.paidAt` เขตเวลาร้าน; `paidAtConfirmed = false` → `ยังไม่ยืนยัน (13 ต.ค. 2569)` | เสมอ |
| 2 | เลขที่รายการ | `expenseNumber` | เสมอ |
| 3 | ผู้ขาย/ผู้รับเงิน | snapshot | เสมอ |
| 4 | ยอดจ่าย | `amount` | เสมอ |
| 5 | สกุลเงิน | `currency` | เสมอ |
| 6 | วิธีจ่าย | `paymentMethod` | เสมอ |
| 7 | จ่ายจาก | `bankAccountRef` | เสมอ |
| 8 | เลขที่ใบสำคัญจ่าย | ใบที่ `DisbursementVoucherLine.expensePaymentId` = การจ่ายนี้ | `expense.disbursement.read` และไม่ใช่ LINE ([expense-evidence.use-case.ts:356](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts)) |
| 9 | ไฟล์หลักฐานการจ่าย | ไฟล์หลักฐานของการจ่ายนี้ | เฉพาะสารบัญใน ZIP |

**แผ่น 3 `หัก ณ ที่จ่าย`** — หนึ่งแถวต่อแถวผลของ §5.3 ที่วันที่ของแถวเองอยู่ในช่วง (แถวที่ยื่น = วันที่ที่ยื่น `payment[2]`; แถวสด = วันที่จ่าย; "ทุกเดือน" ไม่กรอง) หลังตัดสินการครอบบนชุดเต็มแล้ว (§5.3 ข้อ 0); **รายการที่ใช้ค้น = `page.rows` หลังขยายด้วยรายการเดือนก่อนที่มีการจ่าย/ใบสำคัญจ่าย/50 ทวิ ในช่วง ∪ รายการในขอบเขตเดียวกันที่มีบรรทัดยื่นในเดือนของช่วง** (คำขอแบ่งหน้าไม่ขยายทั้งสองแบบ — RC-F1) ([expense-evidence.use-case.ts:369-377](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts) — ผ่าน `listSharedEvidence` ตามขอบเขตแล้ว) ไม่ใช่ชุด `expenseIds` เดิม ([:339](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts)) ที่ใช้เลือกแถวแผ่นหลัก — บิลเดือนกันยายนที่จ่ายเดือนตุลาคมจึงอยู่ในไฟล์ตุลาคม; เรียงตามวันที่จ่าย

| # | หัวคอลัมน์ | ที่มา | แสดงเมื่อ |
|---|---|---|---|
| 1 | วันที่จ่าย | `expenseDate` ของแถว projection (วันที่จ่ายตามปฏิทินร้าน) | เสมอ |
| 2 | เลขที่รายการ | | เสมอ |
| 3 | ผู้รับเงิน | `vendorName` | เสมอ |
| 4 | เลขประจำตัวผู้เสียภาษี | `vendorTaxId` | เสมอ |
| 5 | สาขา | `vendorBranchCode` | เสมอ |
| 6 | ที่อยู่ | `vendorAddress` (snapshot › ทะเบียนคู่ค้า) | เสมอ |
| 7 | แบบ ภ.ง.ด. | §5.3 | เสมอ |
| 8 | ประเภทเงินได้ | `WhtIncomeCategory.nameTh` | เสมอ |
| 9 | อัตรา (%) | `whtRate` ของแถว | เสมอ |
| 10 | จำนวนเงินที่จ่าย | `grossAmount` ของแถว | เสมอ |
| 11 | ภาษีที่หัก | `whtAmount` ของแถว | เสมอ |
| 12 | สกุลเงิน | `currency` | เสมอ |
| 13 | เลขที่หนังสือรับรอง 50 ทวิ | handoff `SYSTEM_ISSUED` (เลขใบที่ออก) / `EXTERNAL_LINKED` (`externalCertificateNumber`) | สิทธิ์ `wht.certificate.read|issue|correct` หรือ `wht.external_certificate.link` ([expense-evidence.use-case.ts:362](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts)) |
| 14 | สถานะ | `ยื่นแล้ว` / `งวดปิดแล้ว ตรวจกับแบบที่ยื่น` / `ยังไม่ยื่น · ต้องตรวจ: <เหตุผล>` / `ยังไม่ยื่น · ข้อมูลครบตามแบบ` (§5.3) | เสมอ |
| 15 | หมายเหตุ | `ผู้ทำบัญชีจัดทำแบบนี้เอง` (`ACCOUNTANT_PREPARES`) | เสมอ |

**แผ่น 4 `ไฟล์ทั้งหมด`** (ZIP เท่านั้น หนึ่งแถวต่อไฟล์ในทุกชุด): `เลขที่รายการ` | `ชนิดเอกสาร` | `ฉบับ` | `แทนด้วย` | `ไฟล์` | `ชุดที่` (เมื่อแบ่งมากกว่า 1 ชุด). `ฉบับ` มีค่าเฉพาะใบรับรองแทนใบเสร็จ: `ฉบับที่ใช้อยู่` (สถานะไม่ใช่ `SUPERSEDED`); `ฉบับเดิม (มีฉบับใหม่แทนแล้ว)` **เฉพาะเมื่อตามสายการแก้ไขไปข้างหน้า (`correctionOfEvidenceId` [schema.prisma:3144](../../apps/api/prisma/schema.prisma); การแก้ไขสร้างใบใหม่ที่ชี้ใบเดิม [substitute-receipt.use-case.ts:666](../../apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts) และใบเดิมได้ `supersedeReason = NEW_VERSION_ISSUED` [prisma-expense.repository.ts:3045](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) แล้วปลายสายเป็นใบ `ISSUED`** — A→B→C: ทั้ง A และ B เป็นฉบับเดิม และ `แทนด้วย` = path ของ C (ฉบับที่ใช้อยู่ปลายสาย ไม่ใช่ใบถัดไปที่ถูกแทนแล้ว); ใบที่ถูกยกเลิกโดยไม่มีใบใหม่ (การยกเลิกตั้ง `SUPERSEDED` + `supersedeReason` [prisma-expense.repository.ts:2103-2105](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) → `ยกเลิกแล้ว (ไม่มีฉบับใหม่)` และ `แทนด้วย` ว่าง — สถานะต้นทางจาก `isHistorical`/`substituteReceiptStatus` ([expense-evidence-sources.ts:75-81](../../apps/api/src/modules/expenses/infrastructure/expense-evidence-sources.ts)) + `certificates` ของแถว

**แผ่น 5 `เกี่ยวกับไฟล์นี้`** (`หัวข้อ` | `ค่า`): `ร้าน`, `เลขประจำตัวผู้เสียภาษีของร้าน`, `ช่วงวันที่`, `นับตาม`, `สถานะเอกสาร`, `สาขา`, `จำนวนรายการ`, `จำนวนการจ่าย`, `หัก ณ ที่จ่าย` (`N แถว` หรือ `ไม่มีรายการหัก ณ ที่จ่ายในช่วงนี้`), `การจ่ายที่ยังไม่ยืนยันวันที่` (`N รายการ ไม่อยู่ในแผ่นหัก ณ ที่จ่าย`), (คำขอที่ระบุ `page`/`pageSize`) `หน้า` (`หน้าที่ N — การจ่ายและหัก ณ ที่จ่ายมีเฉพาะรายการในหน้านี้`), (เมื่อ N > 0) `รวมในแบบที่ยื่นแล้ว` (`การจ่ายหัก ณ ที่จ่าย N รายการในช่วงนี้ ระบบถือว่ารวมอยู่ในแบบที่ยื่นแล้วซึ่งลงวันที่จ่ายนอกช่วงนี้ จึงไม่แสดงในแผ่นนี้` — §5.3 ข้อ 0), `สร้างเมื่อ`, (ZIP) `ชุดที่`, `สกุลเงิน` = `ยอดเงินเป็นสกุลตามคอลัมน์สกุลเงิน อย่ารวมต่างสกุล`, `ช่องว่าง` = ข้อความ R5, (ZIP ที่มีไฟล์) `วิธีเปิดไฟล์` = `แตกไฟล์ ZIP ก่อน แล้วเปิดไฟล์นี้ในคอมพิวเตอร์ ลิงก์ในคอลัมน์ไฟล์จึงจะเปิดเอกสารได้`

ตัดออกจากชุดเต็มเดิม: `company_name`, `company_tax_id` (→ `เกี่ยวกับไฟล์นี้`), `branch_code` (→ `shop_branch`), `accounting_period`, `source_channel`, `tax_evidence_reason` + `input_vat_reason` + `posting_error` (→ `notes`), `requester_name` + `funding_source` + `certifying_payer_name` (→ `advanced_by`), `uploader_name`, `reviewer_name`, `input_vat_decided_by`, `input_vat_decided_at`, `account_hint_key`, `quantity`, `subtotal_amount`, `discount_amount`, `additional_charges_amount`, `payment_method` + `paid_at` + `payment_reference` + `voucher_numbers` (→ แผ่น `การจ่าย` จากแถวการจ่ายจริง), `wht_certificate_numbers` (→ แผ่น `หัก ณ ที่จ่าย`), `substitute_receipt_ref`, `primary_evidence_ref`, `supporting_evidence_refs`, `bundle_file_names` (→ `primary_file` + `ไฟล์ทั้งหมด`), `web_url`, `document_date_status`, `substitute_evidence_provenance` (→ `ฉบับ`/`แทนด้วย`) — **แผ่นหลัก 56 → 25 คอลัมน์ที่แสดงเสมอ (1–25) (+`ไฟล์เอกสาร` ใน ZIP, + ไม่เกิน 3 ตามโครงสร้างร้าน)**

### 7.3 ตารางคำของค่า

| คอลัมน์ | ค่าที่เก็บ → คำในไฟล์ |
|---|---|
| วันที่ทุกช่อง | `13 ต.ค. 2569` เขตเวลากรุงเทพ (`formatThaiExportDate`); วันที่เอกสารอ่านไม่ได้ (เกิดได้กับรายการยกเลิก) → `ยังไม่ระบุ` |
| เลขที่รายการ | `expenseNumber`; ไม่มี → `ยังไม่มีเลขที่` (workbook ไม่ใช้ id — CSV คงเดิม) |
| ประเภทเอกสาร | `SOURCE_DOCUMENT_TYPE_LABELS` ([expenses.ts:456-470](../../packages/contracts/src/expenses.ts)); โน้ตไม่มีใบเสร็จ → `ไม่มีใบเสร็จ` ([expense-export.logic.ts:138-141](../../apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts)) |
| สาขาผู้ขาย / สาขา | `00000` → `สำนักงานใหญ่`; 5 หลักอื่น → `สาขา 00012`; ไม่มี → ว่าง |
| สาขาของร้าน | ชื่อสาขา; `isVatEstablishment` ต่อ ` · สำนักงานใหญ่` / ` · สาขา 00012` |
| สกุลเงิน | `expenseCurrencyLabel` เช่น `บาท`, `ดอลลาร์สหรัฐ`; ไม่รู้จัก → `สกุลเงินอื่น` |
| เงินทุกช่อง | ตัวเลข 2 ตำแหน่ง `#,##0.00` (style 3 เดิม) |
| สิทธิภาษีซื้อ | `ใช้ได้ตามเงื่อนไข` / `ใช้ไม่ได้` / `รอตรวจสอบ`; บันทึกก่อนมีการตรวจสิทธิ → `ไม่ได้ใช้ภาษีซื้อ (บันทึกก่อนมีการตรวจสิทธิ)` ([expenses.ts:481-483](../../packages/contracts/src/expenses.ts), [expense-export.logic.ts:151](../../apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts)) |
| หลักฐานรายจ่าย | `ใช้ได้` / `ใช้ได้เมื่อมีหลักฐานอื่นประกอบ` / `ใช้ไม่ได้` / `รอตรวจ` ([expenses.ts:472-477](../../packages/contracts/src/expenses.ts)) |
| หัก ณ ที่จ่าย (ทั้งเอกสาร) | ตัวเลข; ไม่มีหัก → `0.00` (ยอดจริงคือศูนย์) |
| วันที่จ่ายล่าสุด | วันที่การจ่ายล่าสุด; ยังไม่จ่าย → ว่าง (ไม่เกี่ยว); ยังไม่ยืนยันวันที่ → `ยังไม่ยืนยัน (13 ต.ค. 2569)` |
| วิธีจ่าย | `เงินสด` / `โอนเงิน` / `บัตรเครดิต` / `เช็ค` / `อื่นๆ` (คำเดิมของเว็บ); ไม่ระบุ → `ยังไม่ระบุ` |
| สำรองจ่ายโดย | ชื่อผู้เบิก หรือผู้จ่ายในใบรับรองที่ใช้เงินส่วนตัว; อื่น ๆ → ว่าง (ไม่เกี่ยว) |
| สถานะ | `EXPENSE_STATUS_LABELS` |
| สถานะลงบัญชี | `POSTING_STATUS_LABELS` (`รอบันทึกบัญชี` / `บันทึกแล้ว` / `บันทึกผิดพลาด` / `ยกเลิกแล้ว` / `-`) |
| แบบ ภ.ง.ด. | `ภ.ง.ด.2` / `ภ.ง.ด.3` / `ภ.ง.ด.53` / `ยังไม่ระบุ` |
| ประเภทเงินได้ | `nameTh` เช่น `ค่าบริการ (นิติบุคคล)`; ไม่มีรหัส/ไม่รู้จัก → `ยังไม่ระบุ` |
| อัตรา (%) | ตัวเลข เช่น `3`; ไม่มีอัตรา → `ยังไม่ระบุ` |
| เลขที่หนังสือรับรอง 50 ทวิ | คั่นด้วย `, `; ยังไม่ออก → ว่าง |
| หมายเหตุ (แผ่นหลัก) | ต่อด้วย ` · `: `ยังไม่มีรูปเอกสาร`; `หมายเหตุ: <โน้ตจากการตรวจหลักฐาน>`; เหตุผลหลักฐานรายจ่ายเมื่อไม่ใช่ `ใช้ได้`; `สิทธิภาษีซื้อ: <เหตุผลผู้ตรวจ>` เมื่อ `ใช้ไม่ได้`/`รอตรวจสอบ`; ข้อผิดพลาดลงบัญชีเมื่อแสดงคอลัมน์ลงบัญชี; **ไม่ใส่ `internalMemo`** (ไม่มีหน้าจอในแพ็กที่ขายเขียนค่านี้) |
| ไฟล์เอกสาร / ไฟล์หลักฐานการจ่าย / ไฟล์ | ชุดนี้ → `HYPERLINK("<path>","<path>")` เช่น `เอกสารค่าใช้จ่าย/EXP-2569-10-0001-1.jpg`; ชุดอื่น → `อยู่ในชุดที่ 2: <path>`; ดาวน์โหลดไม่สำเร็จ → `ไม่ได้รวม: <เหตุผลเดิม>` ([expense-evidence.use-case.ts:463-479](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts)); ไม่มีไฟล์ → `ไม่มีไฟล์` |
| ชนิดเอกสาร | `เอกสารค่าใช้จ่าย` / `ใบรับรองแทนใบเสร็จ` / `หลักฐานการจ่าย` / `ใบสำคัญจ่าย` / `เอกสารประกอบการจ่าย` / `หนังสือรับรอง 50 ทวิ` |

### 7.4 ชื่อโฟลเดอร์และไฟล์ใน ZIP

| `legacyFileName` (ยังใช้ใน CSV) | `fileName` ใหม่ (ZIP + workbook) |
|---|---|
| `ใบเสร็จ/<เลขที่>-<n>.<ext>` | `เอกสารค่าใช้จ่าย/<เลขที่>-<n>.<ext>` |
| `ใบรับรองแทนใบเสร็จ/…` | `ใบรับรองแทนใบเสร็จ/<เลขที่>-<n>.<ext>` (ฉบับเดิมต่อ `-ฉบับเดิม`) |
| `สลิปการจ่าย/<เลขที่>-<id การจ่าย>.<ext>` | `หลักฐานการจ่าย/<เลขที่>-จ่าย-<n>.<ext>` |
| `ใบสำคัญจ่าย/<เลขที่>-<เลขใบ>-<id>.pdf` | `ใบสำคัญจ่าย/<เลขใบ>.pdf` |
| `เอกสารประกอบการจ่าย/<เลขใบ>-<n>.<ext>` | คงเดิม |
| `50ทวิ/<เลขที่>-<เลข 50 ทวิ>-<id>.pdf` | `หนังสือรับรอง 50 ทวิ/<เลข 50 ทวิ>.pdf` |
| ชื่อชน → ต่อ id ([:389](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts)) | ต่อ `-2`, `-3` |
| ZIP `หลักฐาน-YYYY-MM[-ชุดที่-N].zip` | `หลักฐาน-<ชื่อร้าน>-<ช่วง>[-ชุดที่-N].zip` |
| Excel `สรุปรายจ่าย-<month>.xlsx` (เว็บตั้ง [ExpensesPages.tsx:2925](../../apps/web/src/features/expenses/ExpensesPages.tsx)) | `รายจ่าย-<ชื่อร้าน>-<ช่วง>.xlsx` จาก API `indexFileName` |

`<ชื่อร้าน>` ผ่าน `bundleName` เดิม ([:55](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts)) ตัด 40 ตัว; `<ช่วง>` = `YYYY-MM` / `<from>_<to>` / `ทุกเดือน`

### 7.5 DTO / response / projection หัก ณ ที่จ่าย

- `POST …/accountant-package`: คลาส `AccountantPackageDto extends AccountantEvidenceBundleDto` ([expense.dtos.ts:260-277](../../apps/api/src/modules/expenses/presentation/http/expense.dtos.ts)) + `columnSet?` (`summary|full` รับเพื่อเข้ากันได้ ไม่ใช้) + `format?` (`csv`) + **`page?`/`pageSize?`** (`@Type(() => Number) @IsInt() @Min(1)`, `pageSize @Max(500)`) — `SharedEvidenceFilter` มีสองฟิลด์นี้ ([expenses.ts:1678-1679](../../packages/contracts/src/expenses.ts)) และ `forbidNonWhitelisted: true` ([validation-pipe.options.ts:7](../../apps/api/src/common/pipes/validation-pipe.options.ts)) — ไม่ประกาศ = คำขอแบ่งหน้าได้ 400
- `AccountantPackageResult` + `indexFileName`, `paymentRowCount`, `withholdingRowCount`; `columnSet` ค่า `'full'` เสมอ (`@deprecated`)
- `ExpenseSourceAdapter.findConfirmedWithWhtByCompany(companyId, since?, filter?: { expenseIds?: string[] })` — `expenseIds` เพิ่มใน `where`; ไม่ส่ง = ผลเดิมทุกไบต์; export adapter จาก `TaxModule` (ปัจจุบันไม่ได้ export [tax.module.ts:68](../../apps/api/src/modules/tax/tax.module.ts)); ฟังก์ชันตัดสินแบบ ภ.ง.ด. ยกจาก `withholdingForm` ([sync-tax-events.use-case.ts:60-77](../../apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts)) เป็นฟังก์ชันบริสุทธิ์ `withholdingFormFor(kind, filingRoute)` ใน tax domain logic ใช้ทั้ง sync และไฟล์ (ไม่มีสองกติกา)
- `buildAccountantWorkbook({ rows, payments, withholding, files?, part?, visible, about })` แทน `buildAccountantIndexXlsx` (ลบหลังย้ายผู้เรียกทุกตัว — §14)

## 8. สิทธิ์ ABAC และขอบเขต tenant

- ไม่มีสิทธิ์ใหม่: `expense.export` + `expense.read` + สาขาในขอบเขต ([expense-evidence.use-case.ts:317-320](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts))
- คอลัมน์/ไฟล์ใบสำคัญจ่าย: `expense.disbursement.read` และไม่ใช่ LINE; เลข/ไฟล์ 50 ทวิ: สิทธิ์ wht หนึ่งในสี่
- คิวรีข้อมูลร้านทุกตัวมี `companyId: ctx.companyId`; handoff กรอง `sourceBranchId` ตามขอบเขต ([expense-evidence.use-case.ts:368](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts)); projection หัก ณ ที่จ่ายรับ `companyId` + `expenseIds` ที่ผ่านขอบเขตแล้วเท่านั้น
- **ยกเว้น** `WhtIncomeCategory` — catalog กลาง ไม่มี `companyId` (`@@unique([code])` [schema.prisma:5600-5616](../../apps/api/prisma/schema.prisma)) อ่านด้วย `code` อย่างเดียว
- ZIP ตรวจสิทธิ์ตอนกด; workbook ไม่มีลิงก์ presigned
- audit เดิม + metadata `workbook: 'accountant-v2'`

## 9. State transitions

ไม่มี — อ่านอย่างเดียว ไม่เรียก AI ไม่คิดเครดิต

## 10. UI

### 10.1 หน้ารายการ — dialog "ส่งออก Excel ให้สำนักงานบัญชี"

- ตัด select "รายละเอียดในไฟล์" ([ExpensesPages.tsx:2994-2999](../../apps/web/src/features/expenses/ExpensesPages.tsx)) และ state `expenses.list.columnSet` ([:2726](../../apps/web/src/features/expenses/ExpensesPages.tsx)) (ถ้า Q1 = คงไว้: "แบบย่อ" = แผ่นหลักคอลัมน์ 1, 3, 6, 10, 11, 12, 14, 15, 24, 25 ไม่มีลิงก์)
- ลำดับ (390 px ซ้อน; 1280/~1,556 px กล่อง `sm` เดิม): บรรทัดสรุป → นับไฟล์ → ปุ่มชุดเอกสาร → T1 → ผล → ท้ายกล่อง "ดาวน์โหลด Excel"
- ดาวน์โหลดได้เมื่อ `rowCount + paymentRowCount + withholdingRowCount > 0` (แก้ [:2918](../../apps/web/src/features/expenses/ExpensesPages.tsx)); ศูนย์ทั้งหมด → คำเดิม `ช่วงนี้ยังไม่มีรายการที่ยืนยันแล้ว`
- ลบ `ข้ามไฟล์แนบ N ไฟล์ที่คุณไม่มีสิทธิ์เปิด` ([:2922-2924](../../apps/web/src/features/expenses/ExpensesPages.tsx))
- ชื่อไฟล์ `result.indexFileName`

### 10.2 หน้าหลักฐานทางบัญชี

- เอา `MoreActions` ที่ห่อปุ่มเดียวออก ([ExpensesWorkspacePanels.tsx:903-905](../../apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx)) — UX standard 2.7; ปุ่มรอง "ดาวน์โหลด Excel" ข้างปุ่มชุดเอกสาร สูง/กว้างเท่ากัน
- 390 px: ปุ่มชุดเอกสาร (หลัก) บน → "ดาวน์โหลด Excel" → T1; 1280/~1,556 px: การ์ดเต็มพื้นที่ ปุ่มเรียงแถวชิดซ้าย
- กติกาศูนย์เหมือน 10.1 (แก้ [:773](../../apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx)) **และปุ่มต้องกดได้แม้ตารางหน้านี้ว่าง** — วันนี้ปุ่มปิดเมื่อ `!visibleRows.length` ([:904](../../apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx)) ซึ่งกันเดือนที่มีแต่การจ่าย; เหลือปิดเฉพาะ `exporting || loading` แล้วบอกผลเมื่อกด (UX standard 2.9): ศูนย์ทั้งหมด → คำเดิม `ช่วงนี้ยังไม่มีรายการที่ยืนยันแล้ว`
- `สลิป N` ([EvidenceBundleDownload.tsx:16](../../apps/web/src/features/expenses/EvidenceBundleDownload.tsx)) → `หลักฐานการจ่าย N`; `ใบเสร็จ N` → `เอกสารค่าใช้จ่าย N`

### 10.3 ข้อความใหม่ (คำตรงตัว)

| id | ข้อความ | ที่แสดง |
|---|---|---|
| T1 | `แตกไฟล์ ZIP ก่อน แล้วเปิด สารบัญ.xlsx ในคอมพิวเตอร์ เพื่อกดเปิดเอกสาร` | ใต้ปุ่มชุดเอกสาร เมื่อ `plan.fileCount > 0` |
| T2 | `เอกสารค่าใช้จ่าย N` / `หลักฐานการจ่าย N` | บรรทัดนับไฟล์ |
| T3 | หัว §7.2, ค่า §7.3, ชื่อแผ่น `รายการค่าใช้จ่าย` `การจ่าย` `หัก ณ ที่จ่าย` `ไฟล์ทั้งหมด` `เกี่ยวกับไฟล์นี้` | ในไฟล์ |
| T4 | ข้อความแผ่น `เกี่ยวกับไฟล์นี้` (§7.2) | ในไฟล์ |
| T5 | toast เดิม `ดาวน์โหลด Excel แล้ว N รายการ`; เมื่อ `rowCount = 0` แต่มีการจ่าย → `ดาวน์โหลด Excel แล้ว มีการจ่าย N รายการ` | หน้าหลักฐาน |

ตารางพื้นผิว × กรณี:

| ประโยค | ZIP มีไฟล์ | ZIP ไม่มีไฟล์ | หลายชุด | บางไฟล์ไม่ได้รวม | Excel เดี่ยว | Excel เว็บ/Google Sheets | มีแต่การจ่าย |
|---|---|---|---|---|---|---|---|
| T1 | จริง | ไม่แสดง | จริง | จริง | — | จริง (ระบุคอมพิวเตอร์) | จริงถ้ามีไฟล์ |
| `วิธีเปิดไฟล์` | มี | ไม่มีแถว | มี | มี | ไม่มีแถว | จริง | ตาม ZIP |
| `อยู่ในชุดที่ N: …` | — | — | จริง | — | ไม่มีคอลัมน์ | จริง | จริง |
| `ไม่ได้รวม: <เหตุผล>` | จริง (เหตุผลจากผลอ่านจริง) | — | จริง | จริง | ไม่มีคอลัมน์ | จริง | จริง |
| `ไม่มีไฟล์` | จริง | จริง | จริง | — | ไม่มีคอลัมน์ | จริง | จริง |
| ข้อความช่องว่าง (R5) | จริง | จริง | จริง | จริง | จริง | จริง | จริง |
| `ยังไม่ยืนยัน (<date>)` | จริง (`paidAtConfirmed = false`) | | | | จริง | | จริง |
| `ไม่มีรายการหัก ณ ที่จ่ายในช่วงนี้` | จริงเมื่อ projection ว่าง | | | | จริง | | จริง |
| T5 แบบมีแต่การจ่าย | — | — | — | — | จริง | — | จริง |
| `แบบ ภ.ง.ด. = ยังไม่ระบุ` | จริง (sync ก็ไม่สร้างรายการ) | | | | จริง | | |
| `สำรองจ่ายโดย` ว่าง | จริง (R5 "ไม่เกี่ยว") | | | | จริง | | |

### 10.4 LINE

ไม่มีการ์ด/ข้อความใหม่; การ์ด `expense.export` ยังจริง — ไม่แก้ ([approved-product-help.ts:40-42](../../apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts))

## 11. Impact analysis

| พื้นที่ | กระทบ | Phase |
|---|---|---|
| contracts `expenses.ts` | แผ่น/คอลัมน์/ป้าย/แผนที่คำ, `expenseCurrencyLabel`, result fields; ลบชุดย่อหลังเว็บเลิกใช้ | 1 |
| API `expense-export.logic.ts` | `buildAccountantWorkbook`; CSV path ไม่แตะ | 1 |
| API `expense-evidence.use-case.ts` | `legacyFileName`/`fileName`, การจ่าย, projection หัก, สาขา, entitlement, สารบัญรายชุด, `indexFileName`, counts | 1 |
| API tax: `expense-source.adapter.ts`, `sync-tax-events.use-case.ts`, `tax.module.ts` | filter `expenseIds` (ผลเดิมเมื่อไม่ส่ง), `withholdingFormFor` ใช้ร่วม, export adapter | 1 |
| API DTO/controller | `AccountantPackageDto` (รวม page/pageSize) | 1 |
| เว็บ `ExpensesPages.tsx`, `ExpensesWorkspacePanels.tsx`, `EvidenceBundleDownload.tsx`, `expenses.api.ts`, `expenses.model.ts`, `workspace-dictionary.ts` | §10 | 2 |
| เทสต์ที่เรียก builder/selector เดิม | `thai-date.logic.spec.ts:11,80` (**ไม่ได้ลงทะเบียน** แต่อยู่ใน typecheck), `expense-export.logic.spec.ts:7,47-49,248,274,287,302`, `expense-document.logic.spec.ts:7,402,419,435`, e2e EXP-20/21/22/23 (`e2e/expenses.spec.ts:1136-1210`) และ EXP-EXPORT (`:1235-1276`) | 1–2 |
| ความปลอดภัย: อ่านเอกสาร (B26) | `expense-extraction.use-case.ts` ตรวจขอบเขตก่อนอ่านไฟล์ — ส่งแยกก่อนทุกอย่าง | S |
| E5 ledger, E6 PND | §1.3 รวมสกุลเงิน (B24 รวมยอดสรุปและหน้าจอ `IncomeExpenseLedgerPage.tsx`, B25) | 3 |
| AI gateway | แก้ B17 (`line-ai-internal.controller.ts:1696-1701`) คงการประกอบเล่มที่/เลขที่ | 3 |
| การอ่านตัวตนผู้ขายฝั่ง gateway (B27, B28) | `line-ai-internal.controller.ts:1712-1718`, `expense-capture-read.logic.ts:560-570` | 3 |
| handoff 50 ทวิ (expenses + tax + contracts + เว็บ `WhtCertificatesPage.tsx`) | แก้ B22 (`prisma-expense.repository.ts:4946-4947`, `wht-certificate-handoff.use-case.ts:211-215`) + ซ่อมแถวเดิม | 3 |
| LINE webhook | แก้ B23 (`process-line-webhook.use-case.ts:11018-11022`, `:11094`) — แตะไฟล์ที่ W00 hash (`ProcessLineWebhookUseCase` อยู่ในรายการ [line-ai-capability-manifest.ts:232](../../apps/api/src/modules/line-ai/line-ai-capability-manifest.ts)) → `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1` + whole-chain | 3 |
| LINE / เครื่องมือ AI / การแจ้งเตือน / billing / migration | ไม่กระทบ | — |
| W00 manifest | Phase 1–2 และ 3.1–3.4 ไม่แตะไฟล์ที่ hash (`line-ai-internal.controller.ts` ฝั่ง gateway ไม่อยู่ในรายการ [line-ai-capability-manifest.ts:120-256](../../apps/api/src/modules/line-ai/line-ai-capability-manifest.ts)) → รัน `line-ai-capability-manifest.spec.ts` ยืนยันไม่เปลี่ยน; **Phase 3.5 แตะ `process-line-webhook.use-case.ts` ซึ่งถูก hash** → regenerate แล้วรัน whole-chain | 2, 3 |
| whole-chain catalog | ไม่มี scenario ส่งออก; Phase 3.3 และ 3.5 แตะการอ่านใบเสร็จ/ไฟล์ทาง LINE → รัน `node scripts/run-line-ai-whole-chain-acceptance.mjs` ก่อน push; 3.5 เพิ่ม scenario "สร้างงานอ่านไม่สำเร็จ" ถ้า catalog มีกลุ่ม capture | 3 |
| browser journeys | `evidence-and-settings.journey.spec.ts:65-82`, e2e ข้างบน | 2 |
| seed | ไม่ต้อง: journey สร้างรายจ่ายหัก + จ่ายสองครั้งเอง | 2 |
| เอกสาร | Amendment + รายการคำล้าสมัยใน `expense-receipt-upload-spec.md`, memory | ทำแล้ว |

## 12. Gaps

- G1 `receivedAt` ไม่มีหน้าจอบันทึก
- G2 ใบเบิกที่เซ็นแล้ว และไฟล์ 50 ทวิ ที่แนบจากการออกนอกระบบ ไม่เข้า ZIP ([expense-evidence.use-case.ts:362-368](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts))
- G3 ชุดยื่นภาษี `thai_tax` (E9) หัวคีย์เครื่อง แผ่น `Tax Review` PDF ฟอนต์ไม่มีอักษรไทย ([tax-export.logic.ts:53-105](../../apps/api/src/modules/tax/domain/logic/tax-export.logic.ts))
- G4 วันที่เป็นข้อความ (ไฟล์เรียงให้แล้ว)
- G5 ไม่มีเล่มที่แยก
- G6 Excel เว็บ/Google Sheets เปิดลิงก์ไฟล์ไม่ได้
- G7 ไม่มียอดเทียบบาทของรายการต่างสกุล; ภ.ง.ด. ต่างสกุลติด `FUNCTIONAL_CURRENCY_FX_MISSING` ฝั่ง sync
- G8 `indexCsv`/`indexRows.bundle_file_names` ตรึงชื่อไฟล์รุ่นแรก ไม่ตรงกับ path ใน ZIP ใหม่

## 13. Bugs ที่พบในโค้ดปัจจุบัน (อ่านโค้ด ยังไม่ได้รัน)

| # | ที่ | สถานการณ์ที่พัง | ระดับ |
|---|---|---|---|
| B1 | [expense-export.logic.ts:260-261](../../apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts) + [expense-evidence.use-case.ts:229](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts) | สำนักงานบัญชีกด "เปิดไฟล์" → หน้าล็อกอิน/ปฏิเสธ; companyId/expenseId ออกนอกร้าน; ไม่ตั้ง `WEB_BASE_URL` → path เปล่า | กลาง |
| B2 | [expense-status.logic.ts:338-343](../../apps/api/src/modules/expenses/domain/logic/expense-status.logic.ts) + [expense-export.logic.ts:169](../../apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts) | ร้านแพ็ก 249 → ทุกแถว `pending` | กลาง |
| B3 | [expense-export.logic.ts:231-237](../../apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts) | enum อังกฤษ/คีย์ภายในในเซลล์ | กลาง |
| B4 | [expense-evidence.use-case.ts:220-225](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts) | JSON มี id/checksum/path | กลาง |
| B5 | [expense-evidence.use-case.ts:233-238](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts), [:483](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts) | 70 ไฟล์ → 2 ชุด สารบัญชุด 1 ระบุไฟล์ชุด 2 | ต่ำ–กลาง |
| B6 | [expense-evidence.use-case.ts:463-484](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts) | ไฟล์ 404 → ไม่อยู่ใน ZIP แต่สารบัญยังเขียนชื่อ | ต่ำ |
| B7 | [expense-evidence.use-case.ts:201](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts) | `จำนวน` ว่างทุกแถว | ต่ำ |
| B8 | [expense-evidence.use-case.ts:236](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts), [:366](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts) | เลข 50 ทวิ ออกนอกระบบไม่ขึ้น | กลาง |
| B9 | [ExpensesPages.tsx:2922-2924](../../apps/web/src/features/expenses/ExpensesPages.tsx) + [expense-evidence.use-case.ts:242-244](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts), [:266-275](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts) | ข้ามไฟล์เพราะต้นทาง/ไฟล์หาย → เว็บบอก "ไม่มีสิทธิ์เปิด" | ต่ำ–กลาง |
| B10 | [expense-evidence.use-case.ts:150-151](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts) | `สาขา` รหัสภายใน | ต่ำ–กลาง |
| B11 | [expenses.ts:1840](../../packages/contracts/src/expenses.ts) + [expense-evidence.use-case.ts:214](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts) | หัว `เลขอ้างอิงการจ่าย` ค่าคือ "จ่ายจาก" | ต่ำ |
| B12 | [expense-evidence.use-case.ts:400](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts), [:414](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts) | cuid ในชื่อไฟล์ ZIP | ต่ำ |
| B13 | [expense-export.logic.ts:163](../../apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts), [expense-evidence.use-case.ts:167](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts) | ไม่มีเลขที่/ชื่อร้าน → id | ต่ำ |
| B14 | [income-expense-ledger.use-case.ts:344-347](../../apps/api/src/modules/accounting-documents/application/use-cases/income-expense-ledger.use-case.ts) | `CONFIRMED` ดิบ + path แอป | ต่ำ (ไม่มีเมนู) |
| B15 | [expense.controller.ts:272-276](../../apps/api/src/modules/expenses/presentation/http/expense.controller.ts) | body เป็น TS type → validator ตรวจไม่ได้ (**ยังไม่ได้รัน**) | ต่ำ |
| B16 | [withholding-accountant-export.ts:45](../../apps/api/src/modules/tax/application/services/withholding-accountant-export.ts) | แผ่น ภ.ง.ด.2 ว่าง | ต่ำ |
| B17 | [line-ai-internal.controller.ts:1696-1701](../../apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts) | เลขที่เอกสารผ่านถ้า "ทุกกลุ่มตัวเลขอยู่ในข้อความ": `FAKE` ไม่มีตัวเลข → `[].every(...)` เป็นจริง ผ่าน; `FAKE-180` ผ่านเมื่อ `180` เป็นแค่ยอดรวม → เลขที่ปลอมถูกบันทึก ยกระดับหลักฐาน และไหลเข้าไฟล์ให้นักบัญชี/รายงานภาษีซื้อ — **แก้ใน plan Phase 3.3**: ต้องมีตัวเลขอย่างน้อยหนึ่งกลุ่ม และ (ก) ค่าทั้งก้อน (ตัดช่องว่างและ `-._`) ปรากฏในข้อความที่ตัดตัวคั่นแบบเดียวกัน **หรือ** (ข) ค่าเป็นรูป `A/B` ที่ประกอบจากเล่มที่/เลขที่ตามกติกา 19j (`เล่มที่ 12 เลขที่ 345` → `12/345` [expense-receipt-upload-spec.md:1492](expense-receipt-upload-spec.md)) และพบ `A` หลังป้ายเล่มที่ กับ `B` หลังป้ายเลขที่ในข้อความ | กลาง |
| B18 | [ExpensesPages.tsx:2918](../../apps/web/src/features/expenses/ExpensesPages.tsx), [ExpensesWorkspacePanels.tsx:773](../../apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx) | เดือนที่มีแต่การจ่าย → ปฏิเสธดาวน์โหลด | กลาง |
| B19 | [prisma-expense.repository.ts:831-833](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts) + [expense-evidence.use-case.ts:213](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts) | ยืนยันวันที่จ่ายใหม่ → ไฟล์ยังแสดงวันเดิม | กลาง |
| B20 | [expense-evidence.use-case.ts:208](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts) | รายจ่าย USD → ยอดไม่มีสกุล อ่านเป็นบาท | กลาง |
| B21 | [expense-evidence.use-case.ts:236](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts) + ไม่มีคอลัมน์ฐาน/งวด | บิลจ่ายสองงวดหัก ณ ที่จ่าย → ไฟล์มียอดหักทั้งใบในแถวเดียว นักบัญชียื่นผิดเดือน (ภ.ง.ด. ของระบบแบ่งถูก [expense-source.adapter.ts:109](../../apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.ts)) | กลาง |
| B22 | [prisma-expense.repository.ts:4946-4947](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts) + [wht-certificate-handoff.use-case.ts:211-215](../../apps/api/src/modules/tax/application/use-cases/wht-certificate-handoff.use-case.ts) | handoff 50 ทวิ ของรายจ่ายบุคคลธรรมดาเก็บ `formType = 'PND3'` เสมอ แม้หมวด (เช่น ดอกเบี้ย) ส่งไป ภ.ง.ด.2 ใน sync/ไฟล์ → รายการถูกกรองเป็น ภ.ง.ด.3 ในหน้า handoff และตัวกรองรับแค่ `PND3|PND53` — **แก้ใน plan Phase 3.4** ด้วย `withholdingFormFor` + ซ่อมแถวเดิมที่ยัง `REQUIRED` (คงการปฏิเสธการออกใบที่ระบบไม่รองรับไว้); สัญญาและหน้าจอ handoff ยังรู้จักแค่ `'PND3' | 'PND53'` ([tax.ts:55](../../packages/contracts/src/tax.ts), `formType: WhtFormType | null` [:476](../../packages/contracts/src/tax.ts)) และแสดง `ยังไม่รู้แบบภาษี` เมื่อเป็นค่าอื่น ([WhtCertificatesPage.tsx:43](../../apps/web/src/features/expenses/WhtCertificatesPage.tsx)) — ต้องขยายชนิดเฉพาะของ handoff ป้าย การอ่าน URL และตัวเลือกกรองให้มี ภ.ง.ด.2 โดยไม่ขยายชนิดที่ใช้กับการออกใบในระบบ | กลาง |
| B23 | [process-line-webhook.use-case.ts:11018-11022](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts) + [:11094](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts), [:11146-11150](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts) | ไฟล์ PDF ทาง LINE ถูกเก็บแล้ว แต่สร้างงานอ่านไม่สำเร็จ (`.catch(() => null)`) → ยังตอบ "เก็บไฟล์แล้วค่ะ กำลังอ่านเอกสาร … เสร็จแล้วน้องจะสรุปให้" ทั้งที่ไม่มีงานอ่าน ผู้ใช้รอผลที่ไม่มีวันมา; และการ "ส่งไฟล์เดิมอีกครั้ง" ไม่ใช่ทางออก — การกันซ้ำใช้ `lineMessageId` ([:11057](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts)) ข้อความใหม่จึงสร้างร่างใหม่ ([expense-upload.use-case.ts:136](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts)) — **แก้ใน plan Phase 3.5** ด้วยปุ่ม `เริ่มอ่านอีกครั้ง` ที่ผูกกับรายจ่ายเดิม | กลาง |
| B24 | [income-expense-ledger.use-case.ts:155](../../apps/api/src/modules/accounting-documents/application/use-cases/income-expense-ledger.use-case.ts), [:312](../../apps/api/src/modules/accounting-documents/application/use-cases/income-expense-ledger.use-case.ts), [:344](../../apps/api/src/modules/accounting-documents/application/use-cases/income-expense-ledger.use-case.ts) + [IncomeExpenseLedgerPage.tsx:265](../../apps/web/src/features/accounting-documents/IncomeExpenseLedgerPage.tsx) | สมุดรายรับ–รายจ่าย: THB 100 + USD 100 → ยอดสรุป 200 แสดงเป็นบาท (`_sum` ไม่แยกสกุล); แถว USD บนหน้าจอขึ้น `฿`; ไฟล์ส่งออกไม่มีสกุล — แก้ใน Phase 3.1 | ต่ำ (ไม่มีเมนู) |
| B26 | [expense-extraction.use-case.ts:92](../../apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts), [:97-100](../../apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts), [:216](../../apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts) | **ความปลอดภัย (ปัจจุบัน)**: ผู้ใช้ที่จำกัดสาขา A และมี `expense.ocr.request` หรือ `expense.review` ขออ่านเอกสารของร่างสาขา B ด้วย id ได้ — โหลดด้วย `companyId` อย่างเดียว ไม่ตรวจสาขา/ขอบเขตการอ่าน แล้วอ่านไฟล์ ส่งเข้าผู้อ่าน (หรือเข้าคิว PDF) และคืน `fields` ที่อ่านได้ — ข้อมูลใบเสร็จข้ามสาขารั่ว — **แก้ใน plan Phase S (ส่งก่อนทุกอย่าง แยกเดี่ยว — การออกแบบผ่านรีวิวเฉพาะจุด 2026-10-24, §0 R3-F1 ปิดแล้ว)** | สูง |
| B27 | [line-ai-internal.controller.ts:1712-1718](../../apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts) + [receipt-ocr-apply.service.ts:1026](../../apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts) | รหัสสาขาผู้ขายตรวจแค่ "ตัวเลขปรากฏในข้อความฝั่งผู้ออก": สาขา `00016` ที่โมเดลแต่งขึ้นผ่านเพราะเป็นส่วนหนึ่งของเลขผู้เสียภาษี `0994000163011` แล้วถูกบันทึกแม้ใบพิมพ์ "สำนักงานใหญ่" → `สาขาผู้ขาย` ในรายงานภาษีซื้อผิด — แก้ใน plan Phase 3.6 (ต้องพบตามหลังป้ายสาขา; สำนักงานใหญ่ที่พิมพ์ชนะ) | กลาง |
| B28 | [expense-capture-read.logic.ts:560-570](../../apps/ai-gateway/src/modules/line-ai/domain/logic/expense-capture-read.logic.ts) | ข้อความ OCR ธรรมดาที่มีหัวโรงพยาบาล บรรทัด `ผู้ป่วย` แล้วตามด้วยเลขผู้เสียภาษีผู้ขายท้ายใบ: เมื่อเจอบรรทัดคู่กรณีอื่น สถานะ `otherParty` ค้างจนจบ (รีเซ็ตเฉพาะป้ายผู้ขาย) จึงตัดท้ายใบทิ้ง ทั้งการจับและการกู้เลขผู้เสียภาษีล้ม — แก้ใน plan Phase 3.6 (ขอบเขตบล็อกคู่กรณีอื่นจบที่บรรทัดว่าง/ป้ายเลขผู้เสียภาษี/ท้ายใบ) | กลาง |
| B25 | [sync-tax-events.use-case.ts:291](../../apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts) + [withholding-accountant-export.ts:32-41](../../apps/api/src/modules/tax/application/services/withholding-accountant-export.ts) | ไฟล์ ภ.ง.ด. ให้ผู้ทำบัญชี: event ต่างสกุลของหมวด `SEPARATE_PND2`/`ACCOUNTANT_PREPARES` เข้าไฟล์โดยไม่มีสกุล และแถว `รวม` บวกข้ามสกุล — แก้ใน Phase 3.2 | กลาง (ENTERPRISE) |

## 14. Test plan (ยังไม่ได้รัน — worktree ไม่มี node_modules)

API (ไฟล์ที่ลงทะเบียนใน `apps/api/package.json`):
- `src/modules/expenses/domain/logic/expense-export.logic.spec.ts`: หัวทุกแผ่น §7.2; scan ทุกเซลล์ไม่มี `http`, `/companies/`, cuid (`/\bc[a-z0-9]{24}\b/`), enum อังกฤษ; ทุกแถว §7.3; `primary_file` 4 แบบ; คอลัมน์ตามเงื่อนไข; ข้อความช่องว่าง; **CSV golden เดิมผ่านทุกไบต์**; ย้ายการเรียก `buildAccountantIndexXlsx` (บรรทัด 7, 47-49, 248, 274, 287, 302) ไป `buildAccountantWorkbook`
- `src/modules/expenses/domain/logic/expense-document.logic.spec.ts`: ย้ายการเรียกที่ 402, 419, 435
- `src/common/export/thai-date.logic.spec.ts` (**ไม่ได้ลงทะเบียน** — แก้ให้ compile; การตรวจวันที่ไทยของ workbook อยู่ใน `expense-export.logic.spec.ts`)
- `src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts` ([:1083](../../apps/api/src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts)): 61 ไฟล์ → 2 ชุด ลิงก์เฉพาะชุดตัวเอง; ไฟล์ 404 → `ไม่ได้รวม: ไม่พบไฟล์`; ชื่อไฟล์ใหม่ไม่มี id **และ** `indexCsv` ใช้ชื่อรุ่นแรก; ไม่มี `expense.disbursement.read` → ไม่มีคอลัมน์ใบสำคัญจ่าย; external handoff → เลขขึ้น; ไม่มี ledger → ไม่มีคอลัมน์ลงบัญชี; 2 สาขา → `สาขาของร้าน`; ยืนยันวันที่จ่ายใหม่ → `วันที่จ่ายล่าสุด` ใหม่; USD → `ดอลลาร์สหรัฐ`; ใบรับรองฉบับเดิม/ใหม่ → `ฉบับ`/`แทนด้วย`; มีแต่การจ่าย → `rowCount 0`, `paymentRowCount > 0`; `indexFileName`
- `src/modules/tax/application/use-cases/sync-tax-events-wht-form.use-case.spec.ts` (ลงทะเบียนแล้ว): `withholdingFormFor` ให้ผลเดิมทุกกรณี; adapter + `expenseIds` กรองถูก, ไม่ส่ง = ผลเดิม; **ฐาน 1,000 หัก 30 จ่ายสองงวด** → สองแถว 500/15; **บุคคลธรรมดา + `SEPARATE_PND2`** → PND2; **บรรทัดเก่าสองหมวดสองอัตรา** → สองแถว; **ฐานกรอกเอง 270.50** → ฐาน 270.50; **หักแบบยอดเงิน** → อัตรา null; การจ่ายไม่ยืนยันวันที่ → ไม่มีแถว — และ use-case ส่งออกให้แผ่น `หัก ณ ที่จ่าย` ตรงกับแถวเหล่านี้ทุกช่อง (เทสต์ฝั่ง `expense-document.use-case.spec.ts`)
- `src/modules/expenses/presentation/http/expense.dtos.spec.ts`: `AccountantPackageDto` กับ `GLOBAL_VALIDATION_PIPE_OPTIONS` — `expenseIds: "x"` ถูกปฏิเสธ; `{ page: 2, pageSize: 100 }` ผ่าน; body เดิมของเว็บผ่าน
- เพิ่มใน `expense-document.use-case.spec.ts` (รอบรีวิว 2): **บิลกันยายนจ่ายตุลาคม** ส่งออกตุลาคม → ไม่อยู่แผ่นหลัก แต่อยู่แผ่น `หัก ณ ที่จ่าย` และ `การจ่าย`; **แถวที่ยื่นแล้ว** (มี `WhtFilingLine` FILED) แล้วแก้ที่อยู่ในทะเบียนคู่ค้า → แผ่นยังแสดงที่อยู่ตามภาพที่ยื่น สถานะ `ยื่นแล้ว`; งวด ภ.ง.ด.2 ปิด → `งวดปิดแล้ว…`; ไม่รู้ประเภทผู้รับเงิน / ไม่มีเลขผู้เสียภาษี (`SYSTEM_FILLS`) / ต่างสกุล (`SYSTEM_FILLS`) → `ต้องตรวจ: …`; ใบรับรองถูกยกเลิกไม่มีใบใหม่ → `ยกเลิกแล้ว (ไม่มีฉบับใหม่)`
- `src/modules/accounting-documents/infrastructure/prisma-accounting.repository.atomic-issue.spec.ts` (PostgreSQL จริง [:1248](../../apps/api/src/modules/accounting-documents/infrastructure/prisma-accounting.repository.atomic-issue.spec.ts)): E5 สถานะไทย ไม่มีลิงก์ และรายจ่าย USD มีคอลัมน์สกุลเงิน
- `src/modules/tax/application/use-cases/generate-tax-filing-package.use-case.spec.ts`: E6 แผ่นเดียวเมื่อไม่มี ภ.ง.ด.2; event THB + USD (หมวด `SEPARATE_PND2`) → คอลัมน์สกุล + แถวรวมแยกต่อสกุล
- B22: `src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts` (ลงทะเบียน, PostgreSQL จริง, มีเทสต์ `formType` ของ handoff อยู่แล้ว) บุคคล + หมวด `SEPARATE_PND2` → handoff `formType = 'PND2'`; ตัวกรอง handoff รับ `PND2` ใน `src/modules/tax/application/use-cases/wht-certificate-handoff.use-case.spec.ts` (ลงทะเบียน); ซ่อมแถว `REQUIRED` เดิม
- B23: `src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` (ลงทะเบียน): `queueExpenseRead` throw → คำตอบ "เก็บไฟล์แล้ว" ที่ไม่สัญญาว่ากำลังอ่าน + ส่งซ้ำไฟล์เดิมสร้างงานอ่านได้ (ไม่สร้างร่างซ้ำ)
- AI gateway (สคริปต์ `test` ของ `apps/ai-gateway` มี `line-ai-internal.controller.spec.ts`): `FAKE` ถูกลบ; `FAKE-180` ที่มีแค่ยอด 180 ถูกลบ; `INV-0012` ที่พิมพ์ `INV - 0012` ยังผ่าน; `เล่มที่ 12 เลขที่ 345` → `12/345` ยังผ่าน; `123/2569` ยังผ่าน; สลิปโอนไม่เปลี่ยน
- (RC-F1) `expense-document.use-case.spec.ts` ชุด `CreateAccountantPackageUseCase`: A/B ยื่นตุลาคม + `pageSize: 1` สองหน้า — แต่ละแถวที่ยื่นปรากฏครั้งเดียวรวมทุกหน้า; ไฟล์ไม่แบ่งหน้าและ ZIP มีครบ
- (RC-F2) ไฟล์เดียวกัน ทั้ง `accountant-package` และ `downloadBundle`: A/B ยื่นเดือนเดียวกัน — `expenseIds: ['A']` → แผ่นหัก/การจ่าย/ไฟล์มีแต่ A; `expenseIds: []` → ว่าง ไม่มี B และไม่คิวรีบรรทัดที่ยื่น; ไม่ระบุ → A และ B อย่างละครั้ง
- รอบรีวิว 3: (R3-F3, ปรับหลังรีวิวเฉพาะจุด) ตัดสินการครอบก่อนกรองวันที่ — fixture ข้ามเดือน (ยื่นกันยายนไม่มีคีย์ + งวดตุลาคม) และ fixture แถวที่ยื่นโดยไม่มีการจ่ายสดในช่วง (แก้วันที่จ่ายเป็นพฤศจิกายน) ตาม AC-5; บรรทัดที่ยื่นแบบไม่มีคีย์การจ่าย → ครอบทุกการจ่ายของแหล่ง แสดงครั้งเดียวจากภาพที่ยื่น; คีย์รวม `payment:p1` + projection ปัจจุบันแยก `payment:p1:line:rent`/`:service` → แสดงบรรทัดที่ยื่นครั้งเดียว ไม่มีแถวสดซ้ำ (เทสต์ใน `expense-document.use-case.spec.ts` ใช้ fixture แบบ `wht-report.logic.spec.ts:268`); (F6) ไม่มีที่อยู่ / หมวดไม่รู้จัก / หักแบบยอดเงินไม่มีอัตรา → `ยังไม่ยื่น · ต้องตรวจ: …` และ `withholdingRowFaults` ให้ผลเหมือนการตรวจก่อนยื่นเดิม (`generate-tax-filing-package.use-case.spec.ts`); (F7) สาย A→B→C
- B26 (Phase S): `src/modules/expenses/application/use-cases/expense-extraction.use-case.spec.ts` (ลงทะเบียน) — ผู้ใช้สาขา A + `expense.review` ขอร่างสาขา B → `NotFoundException`, ไม่มีการเรียก storage/ผู้อ่าน/คิว PDF; ผู้ใช้สาขา B ผ่าน; เจ้าของร่างที่มีแค่ `expense.receipt.upload` ผ่านเฉพาะร่างตัวเองในสาขาที่มีสิทธิ์
- B27/B28: `apps/ai-gateway/.../line-ai-internal.controller.spec.ts` — สาขา `00016` ที่เป็นแค่ส่วนของเลขผู้เสียภาษีถูกลบ; ใบพิมพ์สำนักงานใหญ่ + โมเดลตอบสาขาอื่น → `00000`; ข้อความหัวโรงพยาบาล + `ผู้ป่วย` + เลขผู้เสียภาษีท้ายใบ → จับ/กู้ได้ (เทสต์ `receiptIssuerText` ในไฟล์ spec ของ `expense-capture-read.logic.ts` ถ้าลงทะเบียน — ตรวจก่อน)
- ไม่มี invariant ฐานข้อมูลใหม่ → ไม่เพิ่ม PostgreSQL spec ฝั่งรายจ่าย

เว็บ (glob): `EvidenceBundleDownload.spec.ts`, `ExpenseList.rendered.spec.ts` (ไม่มี select, ดาวน์โหลดเมื่อมีแต่การจ่าย), `EvidencePanel.qa.spec.ts` (ปุ่ม "ดาวน์โหลด Excel" กดได้เมื่อตารางว่าง — ไม่ปิดด้วย `!visibleRows.length`)

เบราว์เซอร์ (thai-ux-standard.md §7, บรรทัด 110-118):
- `e2e/journeys/evidence-and-settings.journey.spec.ts`: unzip xlsx ตรวจหัวทุกแผ่น + ไม่มี `HYPERLINK("http`; ปุ่ม "ดาวน์โหลด Excel"
- `e2e/expenses.spec.ts`: EXP-EXPORT ที่ 390/1280/~1556 ไม่มี select; EXP-20/21/22/23 ใช้ `dateOrder` เป็นตัวตรวจ (คงค่า / รีเซ็ตเป็น `newest`)
- ภาพจริงที่ 390, 1280, ~1,556 px + วัดปุ่ม; ตรวจมือสารบัญจาก ZIP ที่แตกบน Excel Windows, Excel Mac, LibreOffice

## 15. Acceptance criteria

- AC-1 แผ่นหลัก 25 คอลัมน์ที่แสดงเสมอ (+`ไฟล์เอกสาร` ใน ZIP, + ไม่เกิน 3 ตามโครงสร้าง); `การจ่าย` 7–9; `หัก ณ ที่จ่าย` 14–15 ตาม §7.2
- AC-2 ไม่มีเซลล์ใดในไฟล์ E1–E3, E5 มี `http`, `/companies/`, cuid หรือ enum อังกฤษ
- AC-3 ร้านแพ็ก 249 ไม่เห็นคอลัมน์ลงบัญชี; ร้าน ledger + auto-post เห็นคำไทย
- AC-4 ร้านสาขาเดียวไม่มี `สาขาของร้าน`; สองสาขามี
- AC-5 แผ่น `หัก ณ ที่จ่าย`: แถว `ยังไม่ยื่น · ข้อมูลครบตามแบบ` ตรงกับ tax event ที่ sync สร้างจากข้อมูลเดียวกันและผ่านการตรวจรายแถวของการตรวจก่อนยื่น; แถวที่ขาดที่อยู่/อัตรา/หมวด แสดง `ยังไม่ยื่น · ต้องตรวจ: …`; บรรทัดที่ยื่นแบบไม่มีคีย์การจ่าย และคีย์รวมที่ถูกแยกภายหลัง แสดงจากภาพที่ยื่น**ครั้งเดียว**ไม่ซ้ำกับข้อมูลสด; (วันที่จ่าย แบบ ประเภท อัตรา ฐาน ภาษี) รวมจ่ายสองงวด, ภ.ง.ด.2, บรรทัดเก่าหลายอัตรา, ฐานกรอกเอง, หักแบบยอดเงิน; แถว `ยื่นแล้ว` ตรงกับ `lineJson.payment` ของแบบที่ยื่นทุกช่อง แม้ที่อยู่ในทะเบียนคู่ค้าเปลี่ยนภายหลัง; แถวที่ sync ไม่สร้าง event (ไม่รู้ประเภทผู้รับเงิน, ไม่มีเลขผู้เสียภาษี, ต่างสกุล) แสดง `ยังไม่ยื่น · ต้องตรวจ: …`; บิลเดือนกันยายนที่จ่ายเดือนตุลาคมอยู่ในไฟล์ตุลาคม; (R3-F3) แบบที่ยื่นเดือนกันยายนแบบไม่มีคีย์ + งวดจ่ายเดือนตุลาคม → ไฟล์กันยายนมีแถวที่ยื่นครั้งเดียว, ไฟล์ตุลาคมไม่มีทั้งแถวที่ยื่นนั้นและแถวสดของงวดตุลาคม และ `เกี่ยวกับไฟล์นี้` นับ 1; บรรทัดที่ยื่นสำหรับการจ่ายเดือนตุลาคมซึ่งภายหลังแก้วันที่จ่ายเป็นพฤศจิกายน (บิลลงวันที่กันยายน ไม่มีการจ่ายสดในช่วง) → ยังอยู่ไฟล์ตุลาคมเป็น `ยื่นแล้ว` และไม่อยู่ไฟล์พฤศจิกายน; (RC-F1) รายการ A และ B ยื่นในเดือนตุลาคม ขอแบบ `pageSize: 1` → หน้า 1 มีแถวที่ยื่นของ A เท่านั้น หน้า 2 ของ B เท่านั้น สองหน้ารวมกันมีอย่างละครั้ง และไฟล์ไม่แบ่งหน้ามี A และ B อย่างละครั้ง; (RC-F2) A และ B ยื่นในเดือนเดียวกัน ทั้ง workbook และ ZIP: เลือก `['A']` → มีแถวและไฟล์ของ A เท่านั้น, เลือก `[]` → ไม่มีแถว ไม่มี B
- AC-6 แตก ZIP แล้วเปิด `สารบัญ.xlsx` บน Excel Windows และ Mac กดลิงก์เปิดไฟล์ได้; หลายชุด เซลล์ชุดอื่นเป็นข้อความ
- AC-7 `indexCsv`/`indexRows`/`evidenceManifest` เท่าเดิมทุกไบต์สำหรับข้อมูลเดิม (golden)
- AC-8 ชื่อไฟล์/โฟลเดอร์ใน ZIP ไม่มี id; ชื่อ ZIP/Excel มีชื่อร้าน
- AC-9 dialog ไม่มี select และข้อความ "ไม่มีสิทธิ์เปิด"; หน้าหลักฐานไม่มี `เพิ่มเติม`; ปุ่มคู่สูง/กว้างเท่ากัน — ภาพเบราว์เซอร์จริงและวัดที่ 390, 1280, ~1,556 px
- AC-10 เดือนที่มีแต่การจ่ายดาวน์โหลดได้จากทั้งสองหน้า (ปุ่มหน้าหลักฐานกดได้แม้ตารางว่าง) มีแผ่นการจ่าย
- AC-11 รายการต่างสกุลแสดงสกุลไทย (ทั้งไฟล์นักบัญชี E5 และ E6); ยืนยันวันที่จ่ายใหม่แสดงวันใหม่
- AC-12 ไฟล์ ภ.ง.ด. เดือนที่ไม่มี ภ.ง.ด.2 มีแผ่นเดียว; มีแถวต่างสกุล → มีคอลัมน์สกุลและยอดรวมแยกต่อสกุล
- AC-13 เลขที่เอกสาร `FAKE`/`FAKE-180` ไม่ถูกบันทึกจาก LINE; `เล่มที่ 12 เลขที่ 345` → `12/345` ยังผ่าน
- AC-15 ใบรับรองแทนใบเสร็จที่ถูกยกเลิกโดยไม่มีใบใหม่ แสดง `ยกเลิกแล้ว (ไม่มีฉบับใหม่)` ไม่มี `แทนด้วย`; สาย A→B→C แสดง A และ B เป็นฉบับเดิม `แทนด้วย` = C
- AC-16 (Phase S) ผู้ใช้สาขา A ขออ่านเอกสารของร่างสาขา B → ได้คำตอบแบบ "ไม่พบ" ไม่มีการอ่านไฟล์ ไม่มีการเรียกผู้อ่าน ไม่มีงานอ่าน PDF และ audit บันทึก; ผู้ใช้ในขอบเขตยังขออ่านได้ตามเดิม
- AC-14 คู่มือ LINE ไม่เปลี่ยน; W00: Phase S, 1, 2, 3.1–3.4 และ 3.6 ผ่าน `line-ai-capability-manifest.spec.ts` โดยไม่ regenerate (ไม่แตะไฟล์ที่ hash); Phase 3.5 แตะ `process-line-webhook.use-case.ts` ที่ถูก hash จึง regenerate แล้วต้องผ่าน spec เดียวกันและ whole-chain

## 16. Risks / rollout

- มาโครของสำนักงานบัญชีที่อ่าน Excel เดิมตามตำแหน่งจะเลื่อน — ไม่มีผู้ใช้อัตโนมัติที่รู้จัก; CSV คงไบต์; release note หนึ่งบรรทัด
- G8 ทางเลือกที่ไม่เลือก: (ก) ไม่เปลี่ยนชื่อไฟล์ใน ZIP (ทิ้ง B12 และชื่อโฟลเดอร์ตามอภิธานศัพท์) (ข) CSV ใช้ชื่อใหม่ (ไบต์เปลี่ยน) — ผู้ประสานงานกำหนดให้คงไบต์ (2026-10-24)
- ลิงก์ path สัมพัทธ์อาจไม่ทำงานบางโปรแกรม — ข้อความเป็น path เสมอ; AC-6 ก่อนเรียกว่าเสร็จ
- เรียก projection ของ tax module ข้ามโมดูล (แบบเดียวกับ `IssueWhtCertificateFromHandoffUseCase` ที่ inject อยู่แล้ว [expense-evidence.use-case.ts:15](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts)); ไม่ copy ตรรกะ
- B17 แก้ฝั่ง gateway อาจทำให้เลขที่จริงบางแบบหลุดไปรอตรวจ — เทสต์รูปแบบเลขที่จริง (`INV-0012`, `123/2569`, สลิป) ก่อนปล่อย
- ไม่มี feature switch; revert commit เดียว (ไม่มี migration)

## 17. Open questions (เรื่องธุรกิจเท่านั้น)

- Q1 ตัดตัวเลือก "แบบย่อ/แบบเต็ม" ให้เหลือไฟล์เดียวสำหรับนักบัญชี? — **แนะนำ: ตัด** (แผ่นหลักเหลือ 25 คอลัมน์ หัก ณ ที่จ่ายและการจ่ายแยกแผ่น) — ไม่ block งาน
