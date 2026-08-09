# Agent Memory: CR-2 — PostingRule มี guard แต่ไม่มี writer

Status: IN PROGRESS — owner ตัดสิน mapping ครบ 4 ข้อแล้ว 2026-08-09; slice 1 (ค่าใช้จ่ายคงค้างรายหมวด) ลงแล้วและเทสผ่าน
เหลือ slice 2 (WHT แยกตามผู้รับเงิน), slice 3 (เงินสด/ธนาคารตอนจ่าย), slice 4 (writer ของ binding)
Owner: thawatchai
Scope: `apps/api/src/modules/ledger` (posting engine, chart template), onboarding bootstrap, ไม่แตะ web

## Decisions

- **guard `requiresReviewedPostingRules` ถูกต้องและต้องคงไว้** — ตรวจแล้วว่า `DEFAULT_ACCOUNT_CODES`
  (`posting-engine.logic.ts:44-55`) **ไม่ตรงกับผังบัญชี TH_SME_COA_V1 ที่ระบบใช้จริง** ตรงกันแค่ 2 ใน 10 รหัส:

  | บทบาท | รหัสใน DEFAULT_ACCOUNT_CODES | ความหมายจริงใน TH_SME_COA_V1 |
  |---|---|---|
  | ACCOUNTS_RECEIVABLE | `1210-00` | **ลูกหนี้เงินให้กู้ยืม** (ที่ถูกคือ `1130-01`) |
  | EXPENSE_GENERAL | `5310-01` | **เงินเดือน** — ค่าใช้จ่ายทุกใบจะกลายเป็นเงินเดือน |
  | CASH_OR_BANK | `1110-01` | ไม่มีในผัง (ที่ใกล้คือ `1111-00`) |
  | OUTPUT_VAT | `2210-01` | ไม่มีในผัง (ที่ถูกคือ `2135-00`) |
  | INPUT_VAT | `1280-00` | ไม่มีในผัง (ที่ถูกคือ `1154-00`) |
  | WHT_PAYABLE | `2210-02` | ไม่มีในผัง (`2210-00` = เงินกู้ธนาคารระยะยาว) |
  | WHT_RECEIVABLE | `1270-00` | ไม่มีในผัง (ที่ใกล้คือ `1156-00`) |
  | EMPLOYEE_PAYABLE | `2130-01` | ไม่มีในผัง |
  | ACCOUNTS_PAYABLE | `2120-01` | ✅ ตรง |
  | REVENUE | `4100-01` | ✅ ตรง |

  → ถ้า "ปล่อย fallback ให้ทำงาน" ตามที่เคยเสนอไว้ในรายงาน audit **จะได้บัญชีที่ผิดร้ายแรง** ไม่ใช่แค่ไม่สมบูรณ์
  ข้อเสนอนั้นในเอกสาร audit จึงถูกยกเลิก

- **CR-2 ไม่ใช่บั๊ก แต่คือ Phase 6 ของแผนที่ค้างไว้โดยตั้งใจ** — `docs/plans/chart-of-accounts-master-data-bootstrap-plan.md:265`
  `- [ ] Create reviewed company posting rules only for mappings approved in Phase 0.` ยังไม่ติ๊ก และบรรทัด 336 บันทึกไว้ว่า
  *"no posting rule existed to remap, so both missing expense roles remain visible rather than guessed"* = ทีมเลือกไม่เดาไว้แต่แรก

- **spec ห้ามการเดาที่จำเป็นต้องใช้** — `docs/specs/chart-of-accounts-master-data-bootstrap-spec.md` §9.2:
  - "Expense/procurement posting resolves the expense/cost account from reviewed source/category/posting
    configuration; **it must not default to `5310-01`**"
  - "Payment posting resolves cash/bank from the selected payment/bank account when available; **it does not
    guess a generic bank code**"
  - "WHT payable is split by statutory form in the source" (`2132-03` ภ.ง.ด.3 vs `2132-04` ภ.ง.ด.53 → ขึ้นกับผู้รับเงิน)

## กลไกที่มีอยู่แล้ว (ไม่ต้องสร้างใหม่)

- rule shape ที่ engine รองรับ: `mappingJson = { debitAccountCode, creditAccountCode, whtAccountCode? }`
  (`resolvePostingLinesFromRule`) — VAT ไม่ต้องอยู่ใน rule เพราะ `buildTransactionTaxPostingLines` แกะออกจาก
  tax snapshot แล้วเติมบรรทัดภาษีเอง จึงได้รูป 4 บรรทัดถูกต้องจาก rule 2 บัญชี
- readiness check พร้อมแล้ว: `chart-template-query.service.ts:358` รายงาน `requiredPostingRolesMissing` จาก
  `REQUIRED_EXPENSE_AUTO_POST_RULES` = `EXPENSE_CONFIRMED`, `EXPENSE_CLAIM_CONFIRMED` และบังคับว่าบัญชีต้อง
  ACTIVE + isPosting + **ไม่ใช่ controlled** (จึงใช้ `9999-99` บัญชีพักไม่ได้)
- permission `ledger.posting-rule.manage` มีใน registry แล้ว แต่ไม่มี route ไหนใช้ → เป็นที่ว่างสำหรับ writer
- `findActivePostingRule(..., companyOnly = reviewedRulesRequired)` → บริษัทที่ถูก governed ใช้ได้เฉพาะ
  **company-scoped rule** เท่านั้น rule ระดับ platform (`companyId: null`) ถูกมองข้าม

## Owner decisions 2026-08-09 (ปิด open questions เดิม)

1. บัญชีเดบิตค่าใช้จ่าย → **ผูกรายหมวด** `ExpenseCategory` ✅ ทำแล้ว
2. เจ้าหนี้พนักงาน → **`2131-09`** ค่าใช้จ่ายค้างจ่าย-อื่น ๆ ✅ ทำแล้ว
3. WHT → **แยกตามประเภทผู้รับเงิน** `2132-03` (ภ.ง.ด.3) / `2132-04` (ภ.ง.ด.53) ⬜ ยังไม่ทำ
4. เงินสด/ธนาคาร → **resolve จากวิธีจ่ายจริง** ⬜ ยังไม่ทำ

## Slice 1 ที่ลงแล้ว (ค่าใช้จ่ายคงค้าง ลงตามหมวด)

- `ExpenseCategory.ledgerAccountCode` (nullable) + migration `20260809130000_expense_category_ledger_account`
  — nullable โดยตั้งใจ: หมวดที่ยังไม่ map จะถูก **รายงานชื่อออกมา** ไม่ใช่เดาบัญชีให้
- `expense-account-binding.logic.ts` — ปันส่วนยอดรวมเข้าบัญชีของแต่ละหมวด **ตามสัดส่วน net ของบรรทัด**
  (ไม่ใช่บวก net ตรง ๆ เพราะยอดที่ปันคือ gross ส่วน `netAmount` เป็นฐานก่อน VAT) เศษปัดลงบรรทัดที่ใหญ่สุด
  เพื่อให้เดบิตรวมเท่ายอดเป๊ะ ไม่งั้น `validateJournalBalance` ไม่ผ่าน
- `buildBoundExpenseAccrualLines` ใน posting engine — ออกบรรทัดเป็น **gross ทั้งสองข้าง** เหมือน
  `resolvePostingLinesFromRule` เพื่อให้ `buildTransactionTaxPostingLines` แกะ VAT ออกด้วย
  **บัญชีภาษีจาก tax account determination ที่ผ่านการ review** ถ้าออกบรรทัด VAT เองด้วยจะบันทึกภาษีซ้ำ
- `journal.use-case.ts` — เปลี่ยนจาก throw `posting_rule_missing` แบบเหมารวม เป็น resolve binding
  เฉพาะ event ใน `BOUND_EXPENSE_ACCRUAL_EVENTS`; event อื่นยังปิดตายเหมือนเดิม
- `LedgerSourcePostingInput.lines[].expenseCategoryId` (contract) — แยกจาก `categoryKey`/`accountHint`
  ที่เป็นแค่ "คำแนะนำ" ตามที่ spec เตือนไว้ว่าห้ามใช้เป็น authority

รหัส error ที่ผู้ใช้/operator จะเห็น (เขียนลง `postingError` ตรง ๆ ตาม spec §9.2):
`expense_account_unmapped:<categoryId,...>` · `wht_account_unmapped` · `expense_allocation_base_zero`

## Artifacts

- `docs/qa/production-readiness-audit-consolidated-2026-08-09.md` (CR-2 + หัวข้อ "สถานะการแก้ 2026-08-09")
- UI hide ที่ทำไปแล้ว: `ACCOUNTING_UI_HIDDEN` ใน `web-core-workspace.constants.ts`

## Verification

- `expense-account-binding.logic.spec.ts` 8/8 — ครอบคลุมปันส่วนหลายหมวด, รวมหมวดซ้ำ, กรณี gross vs ex-VAT,
  เศษปัดต้องรวมกลับได้เป๊ะ, หมวดที่ไม่ map, บรรทัดไม่มีหมวด, ฐานปันส่วนเป็นศูนย์, ยอดศูนย์
- `template-company-posting.use-case.spec.ts` — เพิ่มเทสว่า **บริษัทที่ governed ลงบัญชีสำเร็จจริง**
  (700/300 เข้า `5320-01`/`5330-01`, เครดิต `2120-01`, เดบิต=เครดิต=1000, ไม่มี `5310-01`) และเทสว่าถ้าหมวดหนึ่ง
  ยังไม่ map ต้องปฏิเสธ ไม่ใช่เดา. เทสเดิมของ gate ยังอยู่ครบ แค่เปลี่ยน expected code ของ expense
- `expense-account-binding.use-case.spec.ts` 8/8 — postable vs unmapped vs mapped-แต่ใช้ไม่ได้, ผูก/ล้าง,
  ปฏิเสธบัญชีคุม `9999-99` โดยไม่เขียนอะไรเลย, query ต้อง scope `companyId`, หมวดข้ามบริษัท = not found,
  permission ทั้งฝั่ง read และ manage
- `ledger.dtos.spec.ts` +5 — `null` ผ่านได้ (คือคำสั่งล้าง) แต่ **ไม่ส่ง field มาเลยต้องไม่ผ่าน**, กัน free text,
  strip field แปลกปลอม
- ledger + expenses + employee-access + reimbursements + procurement + accounting-documents +
  system-onboarding spec ผ่านทั้งหมด
- `tsc --noEmit` เหลือ 14 error เป็น pre-existing ทั้งหมด (substitute-receipt spec, reports spec) ไม่มีในไฟล์ที่แตะ

## Slice writer ที่ลงแล้ว (ตั้งค่า binding ได้จริง)

`expense-account-binding.use-case.ts` + route `GET|PUT /companies/:companyId/posting/expense-account-bindings[/:categoryId]`

- guard ด้วย **`ledger.posting-rule.read|manage` ไม่ใช่ `expense.category.manage`** — การตั้งชื่อหมวดกับการตัดสินว่า
  เงินลงบัญชีไหน เป็นคนละหน้าที่ ไม่ควรให้คนแก้ชื่อหมวดย้ายปลายทางเงินได้เงียบ ๆ
- permission ทั้งคู่อยู่ใน `pack.ledger.view` / `pack.ledger.manage` อยู่แล้ว (`capability-pack.registry.ts:393,405`)
  → route เรียกถึงได้ทันที ไม่ต้องแก้ access matrix และ **`ledger.posting-rule.manage` เลิกเป็นสิทธิ์ลวงแล้ว**
- ตอนเขียนตรวจรหัสกับผังของบริษัทเอง: ต้อง ACTIVE + `isPosting` + ไม่ใช่ `isControlled` + **เป็น row ของบริษัทนี้เท่านั้น**
  (ไม่รับ global system account ต่างจากตอน post ที่ยอมรับได้) ผิดข้อไหนก็คืน `ledger_account_not_postable` รหัสเดียว
  เพราะปลายทางที่ operator ต้องทำเหมือนกันคือเลือกบัญชีใหม่
- `null` = ล้าง binding กลับไปเป็น "ยังไม่ review" — DTO บังคับให้ต้องส่ง field มาเสมอ (required-but-nullable)
  ไม่งั้นการลืมใส่ field จะกลายเป็นการล้างค่าโดยไม่ตั้งใจ
- audit `ledger.expense-account-binding.set` เก็บ `from`/`to` ที่ riskLevel HIGH เท่ากับการแก้ posting rule
- read คืน `postable` แยกจาก `ledgerAccountCode` เพื่อให้เห็นต่างระหว่าง "ยังไม่ map" กับ "map ไว้แต่บัญชีใช้ไม่ได้แล้ว"

## Next

1. **WHT แยกตามผู้รับเงิน**: ต้องพา `entityKind` ของผู้รับเงินเข้ามาใน posting source แล้วเลือก
   `2132-03`/`2132-04` ตอนนี้เอกสารที่มี WHT คืน `wht_account_unmapped` และไม่ลงบัญชี
2. **เงินสด/ธนาคารตอนจ่าย**: `expense.payment` / `reimbursement.payment` ยังคืน `posting_rule_missing`
3. เสร็จแล้วค่อยเปิด `expense_auto_post` — **ห้ามสลับลำดับ** ไม่งั้นได้ `posting_error` ทุกใบแบบไม่มีใครเห็น
