# Expense Budget and Limits Plan

Status: DRAFT — blocked on: F2 (staged signed category correction) review before Phase 0.3; Phases 0.1–0.2 can start
Spec: `docs/specs/expense-budget-and-limits-spec.md`
Memory: `docs/agent-memory/cash-advance-and-budgets.md`
Baseline: main 6c54ba208 (2026-10-23)
Scope: แบ่งเป็นสี่ phase
- Phase 0: หมวดของบรรทัดใบเบิกและรายจ่ายจากใบเบิก (แก้ B1, B2 และ B6)
- Phase 1: วงเงินต่อใบเบิกตามหมวด
- Phase 2: งบรายเดือน (model, API, หน้าเว็บ)
- Phase 3: การใช้งบในจุดตัดสินใจ, การเตือน, LINE และหน้าแรก
หลักการ: ponytail full ใช้กลไกเดิม ได้แก่ approval floor, THRESHOLD_SCAN + autoEnable, `civilDayRangeToUtc`, `listCategories` และ permission gate ของเมนูย่อยแบบใบสำคัญจ่าย มี permission ใหม่ตัวเดียว (`expense.budget.manage`) ไม่มี feature key ใหม่ ไม่มี env flag และไม่มี dependency ใหม่

## ลำดับที่บังคับ

- Phase 0 ทำก่อนและ deploy แยกได้ เพราะแก้บั๊กที่ลูกค้าเห็นอยู่แล้ว และ cash advance ได้ประโยชน์ด้วย
- Phase 1 ต้องมี Phase 0 (วงเงินคิดจากหมวดที่ resolve แล้ว)
- Phase 2 ต้องมี Phase 0 (งบหมวดต้องนับใบเบิกได้)
- Phase 3 ต้องมี Phase 2

## คำสั่งตรวจมาตรฐาน

ใช้ชุดเดียวกับ `docs/plans/cash-advance-and-clearing-plan.md` (contracts build, `prisma:validate`, api typecheck ผ่าน script, tsx --test เฉพาะไฟล์ที่แตะ โดยเขียน path ทีละไฟล์, web typecheck + test) และบันทึกจำนวน test กับ exit code จริงลง memory

UI ทุกขั้นต้องเปิดใน browser จริงที่ 390, 1,280 และ ~1,556 px ด้วยข้อมูลไทย วัดกลุ่มปุ่ม กด journey หลักหนึ่งรอบรวมทางผิดหนึ่งครั้ง แล้วเขียนสิ่งที่ไม่ได้ดูไว้ ([thai-ux-standard.md:114](../guidelines/thai-ux-standard.md))

---

## Phase 0 — หมวดของใบเบิก

### 0.1 Contract + pure resolver

- `packages/contracts/src/reimbursements.ts`:
  - `resolveClaimLineCategory(line, categories)` และ map key เก่า → `accountHintKey` ตามที่ spec §5.3 กำหนด
  - `ReimbursementLine` DTO เพิ่ม `expenseCategoryId?` และ `expenseCategoryName?`
- `packages/contracts/src/line-reimbursement-draft.ts`: ลบ `REIMBURSEMENT_MANUAL_CATEGORIES` ที่ไม่มีใครใช้ หรือเปลี่ยนให้เป็นตาราง map ของ key เก่า (เลือกแบบที่ diff เล็กกว่า)
- tests หลัก: `reimbursement.logic.spec.ts` ฝั่ง API (ระบุใน package.json แล้ว) import resolver จาก contracts ส่วนเสริมคือ `packages/contracts/src/reimbursements.spec.ts` ซึ่งรันผ่านชุดของ catalog เท่านั้น

### 0.2 Schema + backend

- `apps/api/prisma/schema.prisma` + migration `20261024xxxxxx_claim_line_category`: `ReimbursementLine.expenseCategoryId` + index
- `apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.ts`: resolve ตอนบันทึกร่างและตอนส่ง (ตรึงไว้ตอนส่ง) โดยใช้ `listCategories(companyId)` ของ expenses
  - F2 ตอนบันทึก: `categoryKey` ของบรรทัดที่ไม่ผูกต้นทางต้องเป็น key เก่าห้าตัวหรือ id ของหมวด ACTIVE ไม่งั้นได้ 400 `line_category_invalid` (DTO ที่ `reimbursement.dtos.ts:46` รับข้อความใดก็ได้)
  - blocker F2 (ข้อยกเว้นของต้นทางที่เชื่อได้): บรรทัดที่มี `linkedExpenseId` ไม่ตรวจ `categoryKey` จาก client หมวดมาจาก snapshot ที่ server pin (รับหมวดเลิกใช้ได้) ค่าที่ไม่ตรง snapshot ปฏิเสธแบบ `LINKED_SOURCE_OVERRIDE`
  - F2 ตอนส่ง: บรรทัดที่ resolve ไม่ได้ทำให้ได้ 422 `line_category_unresolved` พร้อมเลขบรรทัด
  - รอบ 3 F2: resolver ของบรรทัดที่ผูกต้นทางรับหมวดของต้นทางแม้เลิกใช้ → หมวดของบรรทัดต้นทาง → map `accountHintKey` (spec §5.3 ข้อ 1)
  - รอบ 3 F6: `expenseCategoryId` ไม่เข้า `claimSnapshotFields` (`reimbursement.logic.ts:212`) และ approval hash
  - เส้นทาง LINE draft ใช้ตัวตรวจเดียวกัน
- ใหม่ endpoint `GET /reimbursements/category-options` ใน `reimbursement.controller.ts` (คืน `{ id, name }` แล้วเพิ่ม `perClaimLimit` ใน Phase 1)
- `apps/api/src/modules/reimbursements/application/services/materialize-claim-expenses.service.ts` + `prisma-reimbursement.repository.ts` (สร้างรายจ่ายที่บรรทัด 2331-2386): ใส่ `expenseCategoryId` ให้ทั้ง record และ line ของบรรทัดที่ไม่ได้ผูกต้นทาง
- blocker F4 (ใหม่): บรรทัดที่ผูกต้นทาง หลังกระจาย `classification` (บรรทัด 2349) ให้ตั้ง `expenseCategoryId = classification.expenseCategoryId ?? line.expenseCategoryId` และ cost line ที่ไม่มีหมวดใช้ `line.expenseCategoryId` ไม่แตะต้นทางหรือใบรับรอง
  - tests: `materialize-claim-expenses.service.spec.ts` และ `prisma-reimbursement.repository.payment-mirror.spec.ts` (ต้นทางมีแค่ hint → projection มีหมวด)
- `apps/api/src/modules/line-ai/application/line-reimbursement-draft-adapter.service.ts`: ไม่ต้องเปลี่ยนการเลือก (ใช้ id อยู่แล้ว) แต่ต้องยืนยันว่าเขียน `expenseCategoryId` ผ่าน use-case เดียวกัน
- tests: `materialize-claim-expenses.service.spec.ts`, `reimbursement-request.use-case.spec.ts` (key เก่าห้าตัว, id หมวดร้าน, หมวดเลิกใช้หรือ key แปลกถูกปฏิเสธทั้งตอนบันทึกและตอนส่ง, บรรทัดผูกต้นทาง), `prisma-reimbursement.repository.payment-mirror.spec.ts` (หมวดไม่หายหลังจ่าย), `reimbursement.dtos.spec.ts`

### 0.3 เว็บ

- `apps/web/src/features/reimbursements/ReimbursementCreatePage.tsx`: แทน `CATEGORY_OPTIONS` ที่บรรทัด 30-36 ด้วยรายการจาก `category-options` ร่างเก่าที่มี key เก่ายังแสดงชื่อเดิมได้ และเพิ่มคำใบ้ "ใช้หมวดเดียวกับรายจ่ายของร้าน"
- `apps/web/src/features/reimbursements/reimbursements.logic.ts`: `suggestReimbursementCategory` คืน id ของหมวดร้านผ่าน `accountHintKey`
- `apps/web/src/features/reimbursements/reimbursements.api.ts`: client
- `apps/web/src/features/user-guide/reimbursement-guide.content.ts:271`: แก้คำว่าห้าหมวดให้เป็นคำที่จริง
- รอบ 2 F12 / รอบ 3 F2: บรรทัดที่ผูกต้นทางซึ่งหมวดไม่ชัดแสดง
  - L3b เมื่อต้นทางไม่มีใบรับรองหรือ PREPARED ลิงก์ไปรายจ่ายสำหรับผู้มี `expense.review` และปุ่มโหลดต้นทางใหม่เดิม (บรรทัด 302, 622)
  - L3c เมื่อใบรับรองลงนามแล้ว ทั้งใบปกติและใบแก้ไขที่ ISSUED ซึ่งยกเลิกไม่ได้ (`prisma-expense.repository.ts:2098`) ลิงก์ไปทำ **เอกสารแก้ไขแบบแก้หมวด**
- blocker F2 เอกสารแก้ไขแบบแก้หมวด:
  - `apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts` (`executeCorrection` บรรทัด 654-678) รับ `correctionKind: 'CLASSIFICATION'` และ `revisedExpenseCategoryId` (ACTIVE)
  - `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts` (`createPreparedSubstituteEvidence` ใกล้บรรทัด 2837): snapshot ของเอกสารแก้ไขเปลี่ยนเฉพาะ `expense.category` และพักค่าไว้ใน `stagedClassificationJson` **ไม่แตะรายจ่ายต้นทาง** ตอนเตรียมปฏิเสธเมื่อรายจ่ายยืนยันแล้ว ลงบัญชีแล้ว หรือผูกใบเบิกที่ส่งแล้ว
  - การออกใบ (กิ่งเอกสารแก้ไขใกล้บรรทัด 3066-3072): เขียน `to` ลงรายจ่ายต้นทางแบบ CAS (`from` และเงื่อนไขเดิมยังจริง) ยกเว้น `substitute_evidence_locks_expense` (บรรทัด 1966-1979) เฉพาะที่นี่
  - ยกเลิก (บรรทัด 2105) และ void รายจ่าย (บรรทัด 2715) ทิ้งค่าที่พัก ไม่มีอะไรต้องคืน
  - ตัวสร้าง snapshot ตอนลงนาม (`substitute-receipt.use-case.ts:313-316`) ใช้ snapshot ของเอกสารแก้ไขซึ่งมีหมวดใหม่อยู่แล้ว
  - `apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts`: ตรวจ `certificate.snapshotJson.expense.category` เท่ากับหมวดที่ resolve จากต้นทาง ไม่งั้นปฏิเสธด้วย `reimbursement_source_classification_mismatch`
- **test gate (ต้องผ่านก่อนรวมงาน)**:
  - `substitute-receipt.use-case.spec.ts`: ออกใบ → เอกสารแก้ไขแบบแก้หมวด → ลงนาม/อนุมัติ → ISSUED ยืนยันว่าหมวดใน snapshot ที่ลงนาม = หมวดใหม่ และ snapshot ของใบเดิมไม่เปลี่ยน
  - `reimbursement-request.use-case.spec.ts`: โหลดต้นทางใหม่แล้ว **หมวดใน snapshot ที่ลงนาม = `ReimbursementLine.expenseCategoryId`** และส่งได้ และต้นทางที่ไม่ตรงถูกปฏิเสธ
  - `prisma-expense.repository.substitute-payment.spec.ts` (PG): การเปลี่ยนอื่นนอกจากหมวดยังถูกล็อก; **เตรียม → ยกเลิก แล้วหมวดยังเป็น A**; เตรียม → void รายจ่าย แล้วหมวดยังเป็น A; หมวดเปลี่ยนระหว่างเตรียมกับออกใบแล้วการออกใบล้มทั้ง tx
  - `substitute-receipt.use-case.spec.ts`: รายจ่ายที่ยืนยันแล้ว ลงบัญชีแล้ว หรือผูกใบเบิกที่ส่งแล้วถูกปฏิเสธตอนเตรียม
  - LINE ตอบข้อความเดียวกันพร้อมปุ่มเปิดในเว็บ
- tests: `ReimbursementCreatePage.qa.spec.ts`, `reimbursements.logic.spec.ts` และ `reimbursement-request.use-case.spec.ts` (ต้นทางไม่มีหมวด → ส่งไม่ได้ → แก้ต้นทางและโหลดใหม่ → ส่งได้)

### 0.4 Backfill + B6

- ใหม่ `apps/api/prisma/backfill-claim-expense-categories.ts`:
  - `--dry-run` เป็นค่าเริ่มต้น และ `--apply` ใช้ใน release
  - เลือกรายจ่ายที่ `sourceReimbursementRequestId IS NOT NULL AND expenseCategoryId IS NULL AND postingStatus <> 'posted'` แล้วใส่หมวดทั้ง record และ line
  - เติม `ReimbursementLine.expenseCategoryId` ด้วย
  - เขียน audit หนึ่งแถวต่อบริษัท และรายงานแถวที่ข้าม
  - รอบ 2 F13: รายงานแยกสองกลุ่ม คือแถวที่ resolve ไม่ได้ (key กำหนดเองเดิม, หมวดเลิกใช้, ร้านไม่มี hint ตรง) ซึ่งไม่ถูกแตะ และแถวที่ลงบัญชีแล้วซึ่งตั้งใจข้าม
  - `--mapping <file>` ใช้ไฟล์ map ที่นักบัญชีหรือเจ้าของตรวจแล้ว เพื่อใส่หมวดให้แถวยกเว้นพร้อม audit ต่อแถว
  - รอบ 3 F6: `--claim-lines` เติม `ReimbursementLine.expenseCategoryId` ของใบที่ส่งแล้วแต่ยังไม่มี projection (PENDING_APPROVAL/APPROVED/FINANCE_REVIEW) แบบ dry-run ก่อน และ materialize ใช้ resolver เป็น fallback ถ้ายัง null
  - tests: `reimbursement-request.use-case.spec.ts` และ `materialize-claim-expenses.service.spec.ts`
- B6 ใน `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts` (บรรทัด 1504-1506): หาชื่อหมวดด้วย `listCategoryNames` (บรรทัด 3923-3929 ซึ่งรวมหมวดกลางและหมวดที่เลิกใช้) ไม่ใช้ `listCategories` ที่กรองเฉพาะ ACTIVE (บรรทัด 3937) และ `erp-business-tools.use-case.ts:481` ไม่ส่ง id ดิบ ใช้ "ไม่ระบุหมวด" แทน (F20)
- tests: `erp-business-tools.use-case.spec.ts` (B6) และ dry-run กับฐานข้อมูลทดสอบที่ seed แล้ว (บันทึกตัวเลข)
- Deploy note: dry-run บน UAT แล้วบันทึกจำนวนลง memory ก่อน apply

### 0.5 B7: LINE นับรายจ่ายต้นทางซ้ำ (F13)

- ใหม่ helper `replacedLinkedSourceIds(tx, where)` ใน `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts` (รอบ 3 F3/P34 แทน helper รอบ 2)
  - รับ `ExpenseRecordWhereInput` ตัวเดียวกับที่ query ใช้ (รวม `explicitStatus` ที่บรรทัด 1353, การจ่าย, ผู้ขาย, หมวด, ผู้สร้าง, related scope, สาขา และวันที่)
  - หา projection ที่ตรง where นั้นและมี `sourceReimbursementLineId` แล้วคืน `linkedExpenseId` ของบรรทัดเหล่านั้น
  - ต้นทางถูกตัดเฉพาะเมื่อตัวแทนของมันอยู่ในผลเดียวกัน
- `aiExpenseWhere` (บรรทัด 1347-1360) เพิ่ม `NOT: { id: { in: replacedLinkedSourceIds(tx, where) } }` ใน transaction เดียวกับการอ่าน (ต้องย้ายการสร้าง where เข้าไปใน tx) ใช้กับ summary, breakdown และ groups
- งบใช้ helper เดียวกัน (Phase 2.2) ส่วนยอดรอยืนยันของงบนับบรรทัดใบเบิกเฉพาะเมื่อต้นทางของบรรทัดไม่ได้ถูกนับเป็นรอยืนยันอยู่แล้ว
- tests: `erp-business-tools.use-case.spec.ts` (ใบรับรองสำรองจ่าย 1,000 → ส่งใบเบิก ยอด 1,000 → ตรวจการเงิน ยอด 1,000 → อนุมัติ ยอด 1,000 ไม่มีช่วงเป็น 0 หรือ 2,000) และ `dashboard-notification-correctness.spec.ts` (PostgreSQL จริง)

---

## Phase 1 — วงเงินต่อใบเบิกตามหมวด

### 1.1 Schema + contracts

- `schema.prisma` + migration `20261024xxxxxx_reimbursement_category_limit`: `ReimbursementCategoryLimit` + CHECK
- `packages/contracts/src/reimbursements.ts`:
  - `ReimbursementPolicySnapshotV1.approvalFloor` ขยายเป็น `'THIRD_PARTY_PAYOUT' | 'CATEGORY_LIMIT'` และเพิ่ม `categoryLimitBreaches?`
  - DTO `ReimbursementCategoryLimitsView` และ `ReplaceReimbursementCategoryLimitsInput`

### 1.2 Backend

- `apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic.ts`: `categoryLimitBreaches(lines, limits)` และ `approvalFloorFor(...)`
- `reimbursement-request.use-case.ts` (submit ที่บรรทัด 650-700):
  - `humanApprovalRequired = requiresApproval || thirdPartyFloor || categoryFloor`
  - snapshot เพิ่ม `categoryLimitBreaches` (ละเมื่อว่าง)
- `apps/api/src/modules/reimbursements/domain/reimbursement.constants.ts` (บรรทัด 83-126):
  - `POLICY_SNAPSHOT_KEYS` รับ `categoryLimitBreaches` (และ `cashAdvance` ของ cash-advance plan)
  - `approvalFloor ∈ {THIRD_PARTY_PAYOUT, CATEGORY_LIMIT}`
  - ตรวจรูปของ breaches แบบ strict (F6)
  - ถ้าไม่ทำ snapshot ใหม่จะ throw ทั้งใน detail, อนุมัติ และ projection
- `reimbursement-policy.use-case.ts` + `reimbursement-policy.controller.ts`: `GET/PUT /reimbursement-policy/category-limits` (CAS)
- `prisma-reimbursement.repository.ts`: อ่านและเขียน limits
- tests: `reimbursement.logic.spec.ts` (floor, ยอดรวมหลายบรรทัด, hash ใบเก่าเท่าเดิม, parser ใหม่/เก่า/ผิดรูป), `reimbursement-request.use-case.spec.ts` (ต่ำกว่าเกณฑ์แต่เกินวงเงินต้องอนุมัติ, solo อนุมัติเองได้), `reimbursement.dtos.spec.ts`

### 1.3 เว็บ + LINE (คำเตือน L1/L2)

- `ReimbursementsPages.tsx` `PolicySettings` (บรรทัด 709): ส่วน "วงเงินต่อใบตามหมวด"
- `ReimbursementCreatePage.tsx`: L1 ใต้บรรทัดที่เกิน (ใช้ `perClaimLimit` จาก category-options)
- `ReimbursementDetailSections.tsx` / `ReimbursementJourneyPage.tsx`: L2 ที่ขั้นอนุมัติ
- `apps/api/src/modules/line-ai/domain/logic/line-reimbursement-draft-card.logic.ts`: L1 และ `line-expense-action.service.ts` การ์ดอนุมัติ L2
- tests: web `reimbursements.logic.spec.ts` (ข้อความ L1/L2 ตามตาราง §10.3) และ `process-line-webhook.use-case.spec.ts` (การ์ด LINE)

---

## Phase 2 — งบรายเดือน

### 2.1 Schema + permission

- `schema.prisma` + migration `20261024xxxxxx_expense_budget`: `ExpenseBudgetStatus`, `ExpenseBudget`, `ExpenseBudgetAlert`, partial unique `ExpenseBudget_active_scope_unique` และ CHECK
- `apps/api/src/modules/auth/permission-registry.ts`: `expense.budget.manage` (MEDIUM) ใส่ใน OWNER และ ADMIN
- `apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts`: `pack.expense.budget` (`featureEntitlementKey: 'expenses'`)
- `apps/api/prisma/sync-permissions.ts`: ต้องไม่ต้องแก้ ให้ตรวจว่ารันแล้วบทบาทระบบได้ key ใหม่
- tests: `permission-registry.spec.ts`, `capability.logic.spec.ts`, `feature-gate.logic.spec.ts`, `menu-entitlement-binding.spec.ts`

### 2.2 Usage query (หัวใจ)

- ใหม่ `apps/api/src/modules/expenses/infrastructure/prisma-expense-budget.repository.ts`:
  - `usageFor(companyId, budgets[], periodKey)` ทำ query เดียวต่อบริษัท ใช้ groupBy บน `ExpenseRecord` ตาม (branchId, expenseCategoryId, currency) ในช่วงเดือน (`civilDayRangeToUtc`) แล้วรวมเข้าแต่ละงบในโค้ด
  - ยอดรอยืนยันจาก `ExpenseRecord` ที่ NEEDS_REVIEW/READY_FOR_CONFIRMATION และบรรทัดใบเบิกที่ยังไม่มีรายจ่าย
  - blocker F3: เรียก `replacedLinkedSourceIds(tx, combinedWhere)` **ครั้งเดียวกับประชากรรวม** (ขอบเขตงบ + `status ∈ {CONFIRMED, NEEDS_REVIEW, READY_FOR_CONFIRMATION}`) ตัดต้นทางที่ projection อยู่ในประชากรรวม แล้วจึงแยกเป็นใช้แล้วและรอยืนยัน
  - นับบรรทัดใบเบิกที่ยังไม่มี projection เฉพาะเมื่อต้นทางของบรรทัดไม่อยู่ในประชากรรวม
  - blocker F4: ต้นทางที่ผูกกับบรรทัดใบเบิกที่ส่งแล้วและไม่มีหมวดของตัวเอง ใช้ `ReimbursementLine.expenseCategoryId` ตอนจัดกลุ่ม groupBy จึงต้องรวมยอดในโค้ดสำหรับแถวเหล่านี้ ไม่ใช้ `(branchId, expenseCategoryId, currency)` ของต้นทางตรง ๆ
- ใหม่ `apps/api/src/modules/expenses/domain/logic/expense-budget.logic.ts`:
  - `budgetMatches(budget, row)`, `budgetLevel(used, limit, warn)`, `budgetScopeLabel`
  - `periodKeyOf(date)` (Asia/Bangkok)
- tests: `dashboard-notification-correctness.spec.ts` (PostgreSQL จริง ระบุใน package.json แล้ว) ครอบทั้ง query ตามเคสใน spec §14 และ pure function ของ `expense-budget.logic.ts` (describe แยกในไฟล์เดียวกัน)

### 2.3 Use-cases + controller

- ใหม่ `apps/api/src/modules/expenses/application/use-cases/expense-budget.use-case.ts`:
  - List (ขอบเขตสาขา §8), Create (ขอบเขตทั้งบริษัท, หมวดต้องอยู่ในชุด `listCategories`), Update (CAS), Archive, CategoryOptions
  - audit `expense.budget.create|update|archive`
- ใหม่ `apps/api/src/modules/expenses/presentation/http/expense-budget.controller.ts` + DTO validators ใน `expenses` dtos
- `apps/api/src/modules/expenses/expenses.module.ts`: register
- การปิดสาขา (use-case ของ branch ใน `data-model-core` หรือ company settings ที่เรียก `assertNoInFlightReimbursements`): archive งบของสาขานั้นใน tx เดียวกัน
- tests: `dashboard-notification-correctness.spec.ts` (use-case กับฐานข้อมูลจริง: ขอบเขตซ้ำได้ 409, CAS, archive เมื่อปิดสาขา, ผู้อ่านเฉพาะสาขา) และ `permission-registry.spec.ts` (สิทธิ์)

### 2.4 Contracts + เว็บ

- ใหม่ `packages/contracts/src/expense-budgets.ts` + export
- ใหม่ `apps/web/app/(workspace)/companies/[companyId]/expenses/budgets/page.tsx`, `apps/web/src/features/expenses/ExpenseBudgetsPage.tsx`, `expense-budgets.api.ts` และ `expense-budgets.logic.ts` (+ spec)
- `apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts`: เมนูย่อย "งบรายจ่าย" (gate `expense.read` หรือ `expense.budget.manage`) วางหลังหลักฐานทางบัญชีและก่อนหมวดหมู่
- tests: `expense-budgets.logic.spec.ts` (ตาราง `budgetScopeLabel` และ F1/F2) และ rendered spec ของหน้า

---

## Phase 3 — ใช้งบในจุดตัดสินใจ, เตือน, LINE, หน้าแรก

### 3.1 budgetImpact บนการ์ดอนุมัติ

- `reimbursement-request.use-case.ts` (detail) และ `cash-advance.use-case.ts` (detail ถ้ามีแล้ว): แนบ `budgetImpact` เฉพาะผู้ที่ตัดสินหรือจ่ายได้ และใช้กติกาการมองเห็นตาม §8
- web: `ReimbursementJourneyPage.tsx` (ขั้นอนุมัติ) แสดง B1t/B2t ส่วน LINE: `line-expense-action.service.ts` (การ์ดอนุมัติ ไม่เกิน 2 งบ)
- tests: `reimbursement-approval.use-case.spec.ts` (ผู้อ่านเฉพาะสาขาไม่เห็นงบหมวด และผู้เบิกไม่เห็น)

### 3.2 การเตือน

- `apps/api/src/modules/workflow/domain/workflow-template-catalog.ts`: แม่แบบ `expense_budget_threshold` (THRESHOLD_SCAN, autoEnable, `requiredSourceModules: ['expenses']`) และใส่ `WORKFLOW_TEMPLATE_DEFAULT_COOLDOWN_SECONDS` = 0
- `apps/api/src/modules/workflow/application/use-cases/workflow-scan-candidates.use-case.ts`:
  - case `expense_budget_threshold` คำนวณ usage แล้ว `INSERT … ON CONFLICT DO NOTHING` แถว alert ของระดับที่เพิ่งถึง (ข้ามระดับให้บันทึก WARN แบบ `notified=false`)
  - ส่ง candidate ให้ **ทุกแถว** `notified=true` ที่สร้างภายใน 40 วันและยังไม่มี `NotificationEvent` (`sourceType 'expense_budget_alert'`, `sourceId = alert.id`) แถวที่ค้างจากรอบที่ล้มถูกส่งใหม่ รวมแถวของเดือนก่อน (F12, รอบ 2 F11)
  - แถวที่ค้างเกิน 40 วันตั้ง `deliveryAbandonedAt` และเขียน audit ไม่ส่ง
  - `sourceId` ของ candidate คือ id ของแถว alert run dedup จึงแยก WARN กับ FULL ในชั่วโมงเดียวกัน
  - payload มี `recipientUserIds`, `bodyText` และ `deepLink` โดย W1/F1/F2 ใช้เดือนของแถว และใช้ used/limit ที่ตรึงในแถว ข้อความจึงจริงแม้ส่งข้ามเดือน
  - รอบ 3 F11: payload ใส่ `notificationPeriodKey = alert.id`
  - รอบ 3 F7: เลือกผู้รับใหม่ทุกครั้งที่สร้าง candidate (responsible ถ้ายังอ่านงบได้ในขอบเขต ไม่งั้นเจ้าของที่อ่านได้)
  - `notification.use-cases.ts` (ตอนส่ง บรรทัด 505-515) ตรวจสิทธิ์อ่านงบและขอบเขตซ้ำสำหรับ trigger นี้ ถ้าไม่ผ่านให้ suppress ด้วย `recipient_lost_access`
  - ภาระเสร็จเมื่อมี delivery ถึงผู้รับที่มีสิทธิ์อย่างน้อยหนึ่งคน
- `apps/api/src/modules/dashboard-notifications/domain/models/notification.model.ts` (F8): `workflow.expense_budget_threshold` ใน `IMPLEMENTED_TRIGGER_KEYS` (134), `ALWAYS_DELIVERED_TRIGGER_KEYS` (205) และ `NOTIFICATION_TRIGGER_FEATURE_KEYS` (250) = `['expenses']`
- `apps/api/src/modules/workflow/infrastructure/prisma-workflow.repository.ts` (บรรทัด 172-182, F9): `findSourceBranchId('expense_budget_alert')` คืนสาขาของงบ (งบหมวดและงบทั้งร้านเป็น null และผู้รับถูกเลือกจากผู้อ่านทั้งบริษัทอยู่แล้ว)
- `workflow-action-runner.use-case.ts`: ไม่ต้องแก้ ถ้า SEND_NOTIFICATION ใช้ `recipientPayloadKeys` ได้ ให้ตรวจ
- `apps/api/prisma/sync-workflow-templates.ts`: รันใน release
- tests: `workflow-scan.use-case.spec.ts` (ส่งใหม่เมื่อค้าง, WARN/FULL ชั่วโมงเดียวกัน), `workflow-template-auto-enable.spec.ts`, `workflow-template.use-case.spec.ts`, `notification.logic.spec.ts`, `process-due-deliveries.use-case.spec.ts` (preference เก่าไม่ suppress), `workflow-action-runner.use-case.spec.ts` (สาขา)

### 3.3 LINE + AI

- `packages/contracts/src/ai-tools.ts`: tool `expense.get_budget_status` (read) และการ์ดความสามารถ "ดูงบเดือนนี้"
- `apps/api/src/modules/line-ai/application/use-cases/erp-business-tools.use-case.ts` (หรือไฟล์ tool ของ expense ที่ใกล้ที่สุด): implement โดยเรียก use-case ของงบ ไม่เรียก repository ตรง
- `apps/api/src/modules/line-ai/presentation/http/internal-tools.controller.ts` (F11): inject tool และ `toolMap.set('expense.get_budget_status', …)` แบบบรรทัด 271-281 (ไม่ทำจะได้ `SOURCE_MODULE_NOT_READY` ที่บรรทัด 565-566) แล้วลงทะเบียน provider ใน `line-ai.module.ts`
- `apps/api/src/modules/line-ai/application/line-read-evidence.service.ts` (บรรทัด 58-65): `READ_MEMORY_TOOLS` + `READ_MEMORY_ANSWER_SHAPE` สำหรับคำถามต่อเนื่อง
- `apps/ai-gateway`: router รู้จักคำถามงบ และ `approved-product-help.ts` การ์ด `expense.budget`, `reimbursement.category_limit` + bump version และ contentHash
- `apps/api/src/modules/line-ai/line-ai-capability-manifest.ts`: regenerate hash (`UPDATE_LINE_AI_CAPABILITY_MANIFEST=1`)
- `scripts/line-ai-whole-chain-acceptance.catalog.mjs`: scenario `budget-status-question` (zero mutation)
- tests หลัก: `erp-business-tools.use-case.spec.ts` (ขอบเขต, statusBasis, ทะเบียน tool, `readMemoryEvidence`) และ `internal-tools.controller.spec.ts` (เรียกผ่าน controller ได้จริง) ส่วนเสริมคือขยาย `line-ai-capability-manifest.spec.ts` ในชุด whole-chain และตรวจด้วย `node scripts/run-line-ai-whole-chain-acceptance.mjs`

### 3.4 หน้าแรก

- `apps/api/src/modules/dashboard-notifications/application/providers/`: provider ใหม่ `expense-budget.provider.ts` หรือเรียก use-case งบจาก snapshot (เลือกแบบที่ไม่เพิ่มรอบ query เมื่อร้านไม่มีงบ)
- `apps/web/src/features/dashboard-notifications/DashboardPages.tsx` (ต่อจากบรรทัด 322): การ์ด "งบเดือนนี้" แสดงตัวเลขอย่างเดียว ไม่มีปุ่ม
- tests: `expense-summary.provider.spec.ts`, `DashboardPages.rendered.spec.ts`
- แสดงบน local stack ให้เจ้าของดูก่อนรวมงาน (การ์ดนี้ต่างจาก Figma HOME-01)

### 3.5 Seed + journey + เอกสาร

- `apps/api/prisma/seed-plain-shop.ts`: งบสาขา 1 งบ งบหมวด 1 งบ วงเงินค่าอาหาร 1 รายการ และ `seed-expenses.ts`: บรรทัดใบเบิกมีหมวด
- ใหม่ `e2e/journeys/budget-warns-before-overspend.journey.spec.ts` และปรับ `e2e/journeys/claim-declined-then-paid.journey.spec.ts` ให้เลือกหมวดของร้าน
- อัปเดต `docs/specs/reimbursement-approval-spec.md` §22 (ชี้ spec นี้สำหรับ per-category thresholds), `docs/plans/master-implementation-checklist.md` และ memory

## การตัดสินใจที่ล็อกแล้ว

1. ใช้หมวดชุดเดียวทั้งเว็บและ LINE คือหมวดค่าใช้จ่ายของร้าน key เก่าห้าตัวแปลงด้วย `accountHintKey` และที่พักนับเป็นค่าเดินทาง
2. "ใช้แล้ว" นับเฉพาะรายจ่ายที่ยืนยันแล้ว ยอดรวม VAT ตาม `expenseDate` และเดือนปฏิทินไทย "รอยืนยัน" แยกออกมาต่างหาก
3. หมวดระดับเอกสาร (ไม่แยกตามบรรทัดในรอบนี้)
4. ไม่บล็อกเพราะงบ วงเงินต่อใบทำงานผ่าน approval floor `CATEGORY_LIMIT`
5. เตือนผ่าน THRESHOLD_SCAN, cooldown 0 และ unique ต่อ (งบ, เดือน, ระดับ) เตือนเฉพาะผู้รับผิดชอบ ถ้าคนนั้นทำไม่ได้ให้เจ้าของ
6. เพิ่ม permission `expense.budget.manage` ตัวเดียว การอ่านใช้ `expense.read` และไม่มี feature key ย่อยใหม่
7. แท็กโครงการ เบี้ยเลี้ยง และค่ารถต่อกิโลเมตร ไม่อยู่ในรอบแรก (spec §3.1)
8. หมวดที่ resolve ไม่ได้ทำให้ส่งใบไม่ได้ (F2) จึงไม่มีทางเลี่ยงวงเงินต่อหมวด
9. (แก้ในรอบ 3 F3/P34 ยกเลิกแบบตัดทั้งหมดของรอบ 1) รายจ่ายต้นทางถูกตัดออกจากยอดของ LINE และงบ เฉพาะเมื่อ projection ที่แทนมันอยู่ในผลของ query เดียวกัน (B7/F14) ใช้ `replacedLinkedSourceIds` ตัวเดียว งบใช้ประชากรรวม (ใช้แล้ว + รอยืนยัน) ก่อนแยกถัง (blocker F3)
10. แถว alert เป็นภาระที่ต้องส่ง และส่งใหม่ได้จนมีแจ้งเตือน (F12)

## Must close before coding

### Blockers หลังการตรวจ blocker แบบเจาะจง (2026-10-24)

F1, F3 และ F4 ปิดแล้ว F2 ออกแบบแล้ว (การตรวจเจาะจงครั้งสุดท้าย 2026-10-24) ต้องรีวิวก่อนเริ่ม Phase 0.3 ส่วน Phase 0.1–0.2 เริ่มได้ cash-advance Phase 3 พึ่ง Phase 0 นี้

| # | สถานะ | Scenario ที่ล้ม | การแก้ที่ออกแบบไว้ | Review gate | Block ขั้น |
|---|---|---|---|---|---|
| F1 | **ปิดแล้ว** | gateway ปฏิเสธ `ADVANCE_*` | cash plan 5.2 | — | — |
| F2 | **ออกแบบแล้ว ต้องรีวิวก่อน Phase 0.3** | หมวดถูกแก้ตั้งแต่เตรียมเอกสารแก้ไข และการยกเลิกไม่คืนค่า (`prisma-expense.repository.ts:2105`, `:2715`) | 0.3 พักหมวดไว้ที่เอกสารแก้ไข เขียนลงต้นทางเฉพาะตอนออกใบ (CAS) และคงการป้องกันของรายจ่ายที่ยืนยันแล้ว ลงบัญชีแล้ว และผูกใบเบิกที่ส่งแล้ว | test gate ใน 0.3 รวมกรณีเตรียม → ยกเลิก | 0.3 (0.1–0.2 เริ่มได้) |
| F3 | **ปิดแล้ว** | งบนับซ้ำ | 2.2 ประชากรรวม | — | — |
| F4 | **ปิดแล้ว** | projection ไม่มีหมวด | 0.2 / 2.2 | — | — |
