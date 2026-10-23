# Expense Budget and Limits Spec — งบรายจ่ายรายเดือน (สาขา/หมวด) + วงเงินต่อใบเบิกตามหมวด

Status: DRAFT — blocked on: F2 (staged signed category correction) review before Phase 0.3; Phases 0.1–0.2 can start
Owner: Expense/Reimbursement lane
Related: backlog ข้อ 10 ใน `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md`, `docs/specs/reimbursement-approval-spec.md` (§22 บรรทัด 984 และ 986), `docs/specs/reimbursement-approver-routing-policy-spec.md`, `docs/specs/reimbursement-step-journey-spec-th.md`, `docs/specs/cash-advance-and-clearing-spec.md`, `docs/plans/expense-budget-and-limits-plan.md`, `docs/agent-memory/cash-advance-and-budgets.md`
Baseline: main 6c54ba208 (2026-10-23)

## 1. ปัญหา

เจ้าของร้านตั้งงบไม่ได้ ไม่รู้ว่าเดือนนี้สาขาไหนหรือหมวดไหนใช้เงินเกินที่ตั้งใจ และกำหนดวงเงินต่อใบเบิกของแต่ละหมวดไม่ได้

- ไม่มีแบบจำลองงบรายจ่าย: คำว่า budget ใน schema เป็นงบเครดิต AI ทั้งหมด (`PlatformAiBudgetConfig` [schema.prisma:4603](../../apps/api/prisma/schema.prisma), `AiBudgetReservation` [:4654](../../apps/api/prisma/schema.prisma)) ชื่อใหม่จึงต้องเป็น `ExpenseBudget` เพื่อไม่ชนกัน
- `PurchaseRequest.budgetCode` เป็นข้อความอิสระ ([schema.prisma:6270](../../apps/api/prisma/schema.prisma)) ตรวจแค่ความยาวไม่เกิน 80 ([procurement.dtos.ts:152](../../apps/api/src/modules/procurement/presentation/http/procurement.dtos.ts)) ไม่มีโค้ดใดอ่านไปใช้ และอยู่ในโมดูลจัดซื้อซึ่งไม่ได้ขาย
- รายจ่ายมีมิติแค่สาขาและหมวด (`ExpenseRecord.branchId`, `expenseCategoryId` [schema.prisma:2611-2779](../../apps/api/prisma/schema.prisma)) ไม่มีแผนก โครงการ หรืองาน
- ตัวเลขรายจ่ายที่มีวันนี้:
  - หน้าแรกนับ `CONFIRMED` ตาม `expenseDate` และกรองสาขาได้ ([expense-summary.provider.ts:64-84](../../apps/api/src/modules/dashboard-notifications/application/providers/expense-summary.provider.ts))
  - LINE แยกตามหมวดด้วย `ExpenseRecord.expenseCategoryId` และนับทุกสถานะยกเว้นปฏิเสธและยกเลิก (`statusBasis: exclude_rejected_voided` [erp-business-tools.use-case.ts:446](../../apps/api/src/modules/line-ai/application/use-cases/erp-business-tools.use-case.ts), [prisma-expense.repository.ts:1353](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts))
- รายจ่ายจากใบเบิกไม่มีหมวด (B1) และใบเบิกบนเว็บกับใบเบิกจาก LINE ใช้หมวดคนละชุด (B2) งบตามหมวดจึงจะไม่เห็นเงินที่จ่ายผ่านใบเบิกเลย ถ้าไม่แก้ก่อน
- การอนุมัติใบเบิกมีแค่เกณฑ์ยอดเดียวทั้งบริษัท:
  - `requiresApproval(amount, approvalRequiredFromAmount)` ([reimbursement.logic.ts:54-56](../../apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic.ts)) กับเกณฑ์บังคับอนุมัติเมื่อใช้บัญชีบุคคลอื่น ([:59-61](../../apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic.ts), [reimbursement-request.use-case.ts:652-653](../../apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.ts))
  - นโยบายเดียวทั้งบริษัท (`findPolicy(companyId, null)` [reimbursement-request.use-case.ts:623](../../apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.ts)) ตารางมี `branchId` และ unique (companyId, branchId) ([schema.prisma:7291-7318](../../apps/api/prisma/schema.prisma)) แต่ไม่มีโค้ดใดอ่านนโยบายรายสาขา
  - ไม่มีวงเงินต่อหมวด
- ไม่มีการเตือนเรื่องงบเลย มีเพียงเตือน SLA และเตือนใบซ้ำของใบเบิก ซึ่งเป็นแม่แบบ workflow แบบ autoEnable ([workflow-template-catalog.ts:196-317](../../apps/api/src/modules/workflow/domain/workflow-template-catalog.ts))

## 2. เป้าหมาย

1. แก้หมวดของใบเบิกก่อน (Phase 0): บรรทัดใบเบิกทุกบรรทัดใช้หมวดค่าใช้จ่ายของร้าน และรายจ่ายที่สร้างจากใบเบิกได้หมวดนั้น งบ รายงาน หน้าหลักฐาน และ LINE จึงนับเงินของใบเบิกถูกหมวด
2. ตั้งวงเงินต่อใบเบิกของแต่ละหมวดได้ ใบที่เกินวงเงินต้องมีคนอนุมัติเสมอ ผู้อนุมัติเห็นว่าเกินเท่าไร และใบไม่ถูกปฏิเสธ
3. ตั้งงบรายเดือนได้สามแบบ คือ ตามสาขา ตามหมวด หรือตามสาขาและหมวด ร้านที่ไม่ตั้งสาขาหรือหมวดใช้ "ทุกสาขา" หรือ "ทุกหมวด" ได้
4. เห็นการใช้งบในจุดที่ต้องตัดสินใจ ได้แก่ การ์ดอนุมัติใบเบิกและเงินทดรอง (เว็บและ LINE), หน้างบ, การ์ดบนหน้าแรก และคำถาม "งบเดือนนี้เหลือเท่าไร" ใน LINE
5. เตือนเฉพาะผู้รับผิดชอบงบ เมื่อใช้ถึงเกณฑ์เตือน (ค่าเริ่มต้น 80%) และเมื่อใช้ครบงบ งบแต่ละใบเตือนแต่ละระดับได้ครั้งเดียวต่อเดือน
6. ไม่บล็อกการบันทึกหรือการจ่ายเพราะงบ (Q1) และไม่มีสวิตช์ ทุกแพ็กที่ขายได้ใช้ (`expenses` และ `reimbursement` อยู่ใน starter preset)

## 3. Non-goals

- งบรายไตรมาสหรือรายปี การยกยอดงบที่เหลือไปเดือนถัดไป การตั้งงบแยกรายเดือน (รอบนี้ใช้ยอดเดียวกันทุกเดือน) การขออนุมัติงบ และการพยากรณ์
- ห้ามบันทึกเมื่อเกินงบ (Q1 แนะนำให้ไม่ห้าม)
- วงเงินต่อคน ต่อบทบาท หรือต่อวัน, วงเงินของรายจ่ายที่ไม่ใช่ใบเบิก และวงเงินของเงินทดรอง (cash-advance spec G3)
- นับเงินทดรองที่ยังไม่เคลียร์เป็นการใช้งบ เพราะเงินทดรองเป็นสินทรัพย์ (cash-advance spec §5.1) เมื่อเคลียร์ รายจ่ายของใบเคลียร์จะนับตามปกติ
- งบหลายสกุลเงิน (THB เท่านั้น รายการสกุลอื่นไม่นับ และแสดงจำนวนรายการที่ไม่นับ)
- เชื่อม `PurchaseRequest.budgetCode`
- รายจ่ายที่มีหลายหมวดในเอกสารเดียว: ใช้หมวดระดับเอกสาร (`ExpenseRecord.expenseCategoryId`) เหมือนที่ LINE แยกหมวดอยู่วันนี้ (G1)

### 3.1 การตัดสินใจ: แท็กโครงการ/งาน และเบี้ยเลี้ยง/ค่ารถต่อกิโลเมตร ไม่อยู่ในรอบแรก

**แท็กโครงการหรืองาน: ไม่ทำในรอบแรก**

- ในโค้ดไม่มีมิตินี้เลย ค้นคำว่า Department, Project, `projectId` และ `costCenter` ใน schema ไม่เจอ สิ่งเดียวที่ใกล้เคียงคือ `budgetCode` ข้อความอิสระในโมดูลที่ไม่ได้ขาย (§1)
- ถ้าจะเพิ่ม ต้องแตะทุกเส้นที่สร้างรายจ่าย ได้แก่ `ExpenseRecord`/`ExpenseLine`, `ReimbursementLine`, capture group/OCR draft, ร่างใน LINE, ไฟล์ส่งออกให้นักบัญชี (ชุดเต็ม 56 คอลัมน์ตาม `ACCOUNTANT_INDEX_COLUMNS` [packages/contracts/src/expenses.ts:1731](../../packages/contracts/src/expenses.ts) ไม่ใช่ 57 ตามที่ backlog ข้อ 25 เขียนไว้ รอบ 3 F13), หน้าหลักฐาน, AI read tools และขอบเขตงบ ซึ่งใหญ่กว่างบตามสาขาและหมวดหลายเท่า
- คู่แข่ง: PEAK มี "กลุ่มจัดประเภท" สำหรับสาขา โครงการ หรือแผนก ได้ถึง 4 กลุ่มต่อเอกสาร ([PEAK](https://intercom.help/peak/en/articles/5339428-ฟังก-ชันกลุ-มจัดประเภท-ใน-peak-board), **ยังยืนยันไม่ได้**: เห็นจาก snippet ของผลค้นหาเท่านั้น) ไม่พบหลักฐานว่าลูกค้าของเราขอเรื่องนี้ (Q4)
- สิ่งที่ต้องทำก่อนอยู่แล้วคือหมวดของใบเบิก (B1/B2) ร้านที่มีหลายสาขาใช้สาขาแทนแผนกได้ทันที
- โครงร่างสำหรับรอบสอง (ยังไม่ทำ): `ExpenseTag` ที่ร้านตั้งเองเป็นรายการ ผูกได้หนึ่งแท็กต่อรายจ่ายและหนึ่งแท็กต่อบรรทัดใบเบิก และงบมีขอบเขต `tagId`

**เบี้ยเลี้ยงรายวันและค่ารถต่อกิโลเมตร: ไม่ทำในรอบแรก**

- [คำสั่งกรมสรรพากร ป.59/2538](https://rd.go.th/3588.html) (ตรวจที่ต้นทางแล้ว 2026-10-24) มีกติกาสามชั้น:
  - ข้อ 1(1): ค่าเบี้ยเลี้ยงเดินทางที่จ่ายไปโดยสุจริตเพื่อการปฏิบัติงานและจ่ายไปทั้งหมด ได้รับยกเว้นเมื่อมีหลักฐาน แม้เกินอัตราราชการ
  - ข้อ 1(2): ส่วนที่จ่ายไม่เกินอัตราสูงสุดของทางราชการ ถือว่าจ่ายไปจริง "โดยไม่ต้องมีหลักฐานการจ่ายเงินมาพิสูจน์"
  - ข้อ 1(3): ถ้าเกินอัตราและไม่มีหลักฐาน ยกเว้นได้เฉพาะส่วนที่ไม่เกินอัตรา
  - ทุกกรณีต้องมีหลักฐานการอนุมัติการเดินทางเป็นหนังสือจากนายจ้าง ระบุลักษณะงานและระยะเวลา (ข้อ 2)
- ค่ารถต่อกิโลเมตรใช้กติกาเดียวกัน ([ข้อหารือ กค 0702/1831](https://rd.go.th/26858.html))
- ตัวเลขอัตราราชการ (เบี้ยเลี้ยงต่อวัน และบาทต่อกิโลเมตร) **ยังยืนยันไม่ได้**: ยังเปิดหน้าของกรมบัญชีกลางหรือราชกิจจานุเบกษาที่ระบุตัวเลขไม่ได้ จึงฝังตัวเลขในระบบไม่ได้
- ถ้าจะทำเบี้ยเลี้ยง ระบบต้องรู้ว่าส่วนที่เกินอัตรามีหลักฐานหรือไม่ เพราะส่วนที่เกินและไม่มีหลักฐานไม่ได้รับยกเว้น ซึ่งอาจเป็นเงินได้ที่ต้องหัก ภ.ง.ด.1 ระบบยังไม่มีและไม่ได้ขาย ภ.ง.ด.1 และยังยืนยันตัวเลขอัตราไม่ได้ จึงยังทำในรอบแรกไม่ได้
- ขั้นแรกที่ใช้ได้แล้ว: คำขอเงินทดรองเก็บจุดประสงค์ ช่วงวันที่ใช้เงิน และการอนุมัติในระบบ ซึ่งเป็นหลักฐานอนุมัติเป็นหนังสือที่เบี้ยเลี้ยงต้องใช้ (cash-advance spec §3)

## 4. ผู้ใช้และ journey

| บทบาท | เว็บ | LINE |
|---|---|---|
| เจ้าของ/ผู้ดูแล (`expense.budget.manage`) | ค่าใช้จ่ายและใบเสร็จ → "งบรายจ่าย" → [+ ตั้งงบ] เลือกสาขา (ทุกสาขา/สาขา) หมวด (ทุกหมวด/หมวด) ยอดต่อเดือน เกณฑ์เตือน และผู้รับแจ้ง → บันทึก ดูงบเดือนอื่นได้ แก้หรือเลิกใช้ได้ | ถาม "งบเดือนนี้เหลือเท่าไร" ได้การ์ดสรุป และรับแจ้งเตือนเมื่อตัวเองเป็นผู้รับผิดชอบงบ |
| ผู้ตั้งนโยบายใบเบิก (`reimbursement.policy.manage`) | การเบิกจ่าย → ตั้งค่า → "วงเงินต่อใบตามหมวด" → เพิ่มหมวดและวงเงิน | — |
| ผู้เบิก | หน้าสร้างใบเบิกเลือกหมวดจากรายการหมวดของร้าน ถ้าเกินวงเงิน คำใบ้ใต้บรรทัดบอก "เกินวงเงินต่อใบของหมวดนี้ … ต้องรออนุมัติ" ผู้เบิกไม่เห็นตัวเลขงบรายเดือน | การ์ดร่างใบเบิกแสดงบรรทัดคำเตือนเดียวกัน |
| ผู้อนุมัติใบเบิกหรือเงินทดรอง | การ์ดอนุมัติมีบรรทัด "เกินวงเงินต่อใบ …" (ถ้ามี) และบรรทัดงบของสาขาหรือหมวดที่เกี่ยว เช่น "งบค่าเดินทาง สาขาสยาม เดือนนี้ใช้ไป 92% · เมื่อยืนยันรายจ่ายของใบนี้ จะใช้ไป 104%" (รอบ 2 P23) | การ์ดอนุมัติใน LINE มีบรรทัดเดียวกัน |
| ผู้รับผิดชอบงบ | การแจ้งเตือนในกระดิ่ง → เปิดหน้างบของเดือนนั้น | ข้อความแจ้งเตือนพร้อมปุ่ม [ดูงบ] |
| นักบัญชีหรือผู้อ่านทั้งร้าน (`expense.read` ทั้งบริษัท) | ดูหน้างบได้ แต่แก้ไม่ได้ | ถามได้ |
| ผู้อ่านเฉพาะสาขา | เห็นเฉพาะงบของสาขาตัวเอง | ถามได้เฉพาะสาขาตัวเอง |
| เจ้าของร้านคนเดียว | ตั้งงบเอง ผู้รับแจ้งเป็นตัวเอง อนุมัติใบที่เกินวงเงินด้วยตัวเอง (solo) และการ์ดแสดงบรรทัดเกินวงเงินให้เห็น | เหมือนกัน |

## 5. กติกา/ข้อยกเว้น

### 5.1 การนับงบ

- เดือนนับตามวันที่ในปฏิทินไทย (Asia/Bangkok) จาก `expenseDate` และใช้ `civilDayRangeToUtc` เดียวกับหน้าแรก ([expense-summary.provider.ts:67](../../apps/api/src/modules/dashboard-notifications/application/providers/expense-summary.provider.ts))
- "ใช้แล้ว" = Σ `grandTotalAmount` (ยอดรวมตามเอกสาร รวม VAT) ของ `ExpenseRecord` ที่ `status = CONFIRMED` ตรงสกุลเงินของงบ และตรงขอบเขต
  - ใช้ยอดรวม VAT เพราะการขอคืนภาษีซื้อตัดสินทีหลัง และรายจ่ายจากใบเบิกเป็น `NON_CLAIMABLE` ทั้งหมด ([materialize-claim-expenses.service.ts:55-63](../../apps/api/src/modules/reimbursements/application/services/materialize-claim-expenses.service.ts))
  - คำบนหน้าจอต้องบอกว่า "ยอดตามเอกสาร รวม VAT"
- "รอยืนยัน" = Σ ของสองกลุ่ม:
  - `ExpenseRecord` ที่ `status ∈ {NEEDS_REVIEW, READY_FOR_CONFIRMATION}`
  - บรรทัดของใบเบิกที่ `status ∈ {PENDING_APPROVAL, APPROVED, FINANCE_REVIEW}` และยังไม่มีรายจ่ายที่สร้างจากใบนั้น ใช้ `ReimbursementLine.expenseCategoryId` และ `incurredDate` ของบรรทัด และสาขาของใบ
  - ร่าง (DRAFT) ไม่นับ
- **ไม่นับซ้ำ (F14)**: รายจ่ายต้นทางที่บรรทัดใบเบิกผูกไว้ (`ReimbursementLine.linkedExpenseId`) ไม่ถูกแตะเมื่อสร้างรายจ่ายใหม่จากใบเบิก ([prisma-reimbursement.repository.ts:2408](../../apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts))
  - รอบ 3 F3/P34 (blocker §16.1): ตัดรายจ่ายต้นทางออก **เฉพาะเมื่อ projection ที่แทนมันอยู่ในผลของ query เดียวกัน**
    - helper `replacedLinkedSourceIds(tx, where)` รับ `ExpenseRecordWhereInput` ตัวเดียวกับที่ query ใช้ ได้แก่สถานะที่ระบุเอง ([prisma-expense.repository.ts:1353](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)), การจ่าย, ผู้ขาย, หมวด, ผู้สร้าง, ขอบเขต related, สาขา และวันที่
    - helper อ่าน projection ที่ตรง where นั้นและมี `sourceReimbursementLineId` แล้วคืน `linkedExpenseId` ของบรรทัดเหล่านั้น
    - ตัวอย่าง: filter `NEEDS_REVIEW` หลังอนุมัติ projection เป็น CONFIRMED จึงไม่อยู่ในผล ต้นทาง 1,000 ยังนับ filter ผู้ขาย X ต้นทางที่เป็นผู้ขาย X ยังนับ เพราะ projection ใช้ชื่อ "เบิกคืนพนักงาน: …"
    - **งบ (blocker F3 แก้ใหม่)**: ตัดต้นทางกับ **ประชากรรวม** ของงบก่อนแยกเป็นใช้แล้วกับรอยืนยัน
      - ประชากรรวม = รายจ่ายในขอบเขตงบที่ `status ∈ {CONFIRMED, NEEDS_REVIEW, READY_FOR_CONFIRMATION}`
      - เรียก `replacedLinkedSourceIds(tx, combinedWhere)` ครั้งเดียว ต้นทางที่ projection อยู่ในประชากรรวมถูกตัดออก ไม่ว่าจะอยู่ถังไหน
      - จากนั้นจึงแยกตามสถานะ
      - เช่น projection 1,000 ที่ CONFIRMED กับต้นทาง 1,000 ที่ NEEDS_REVIEW นับเป็นใช้แล้ว 1,000 และรอยืนยัน 0 ไม่ใช่ 1,000 + 1,000
  - ก่อนมี projection (ร่าง ส่งแล้ว รออนุมัติ หรือตรวจการเงิน) รายจ่ายต้นทางยังนับตามปกติ ยอดจึงไม่หายระหว่างรออนุมัติ
  - "รอยืนยัน" ของงบนับบรรทัดใบเบิกที่ยังไม่มี projection เฉพาะเมื่อบรรทัดนั้นไม่ได้ผูกต้นทาง หรือต้นทางไม่ได้อยู่ในชุดสถานะรอยืนยัน (NEEDS_REVIEW/READY_FOR_CONFIRMATION) ดังนั้นเงินก้อนเดียวถูกนับครั้งเดียวในทุกช่วง
  - แนวเดียวกับที่หน้าแรกตัดใบรับรองแบบสำรองจ่ายออกจากยอดรอตรวจ ([expense-summary.provider.ts:76](../../apps/api/src/modules/dashboard-notifications/application/providers/expense-summary.provider.ts))
- ขอบเขต:
  - งบสาขา (หมวดว่าง) นับทุกหมวดของสาขานั้น รวมรายการที่ยังไม่จัดหมวด
  - งบหมวด (สาขาว่าง) นับทุกสาขา รวมส่วนกลางที่ไม่ระบุสาขา (`branchId null`)
  - งบที่ว่างทั้งสองช่องนับทั้งร้าน
- งบที่ซ้อนกันได้ (เช่น งบสาขา A กับงบค่าเดินทางทั้งร้าน) คิดแยกกันอิสระ รายการหนึ่งนับในทุกงบที่ตรงขอบเขต
- งบที่ใช้งานอยู่มีได้หนึ่งใบต่อขอบเขต (บริษัท, สาขาหรือว่าง, หมวดหรือว่าง) ใช้ partial unique index
- หมวดที่เลือกได้ต้องเป็นหมวดชุดเดียวกับ `listCategories` ของร้าน ซึ่งรวมหมวดกลางของร้านเก่าที่ยังไม่ได้ bootstrap ([prisma-expense.repository.ts:491-510](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts), [:3931-3938](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts))
- เกณฑ์ (คิดตามเดือน):
  - เตือน (`WARN`) เมื่อใช้แล้ว ≥ ยอดงบ × `warnAtPercent`/100 ค่าเริ่มต้น 80 ตั้งได้ 1–99
  - ครบงบ (`FULL`) เมื่อใช้แล้ว ≥ ยอดงบ
  - ถ้าข้ามสองระดับในรอบเดียว ส่งเฉพาะ `FULL` และบันทึก `WARN` แบบ `notified=false` จะได้ไม่ส่งซ้ำทีหลัง
- **คำเตือนต้องไม่หาย (F12)**: แถว `ExpenseBudgetAlert` คือภาระที่ต้องส่ง
  - scan เพิ่มแถวของระดับที่เพิ่งถึง และส่ง candidate ให้ทุกแถว `notified=true` ที่ยังไม่มี `NotificationEvent` ซึ่ง `sourceType = 'expense_budget_alert'` และ `sourceId = alert.id`
  - รอบ 2 F11: นับแถวที่สร้างภายใน 40 วันที่ผ่านมา ไม่จำกัดแค่เดือนปัจจุบัน แถวของเดือนก่อนที่ค้างส่งจึงยังถูกส่ง
  - ข้อความระบุชื่อเดือนของแถว (W1/F1/F2 ใช้ `{เดือน}` เช่น "ต.ค. 2569" ไม่ใช้ "เดือนนี้") และยอด used/limit ที่ตรึงในแถว จึงจริงแม้ส่งข้ามเดือน
  - แถวที่ค้างเกิน 40 วันถูกตั้ง `deliveryAbandonedAt` และเขียน audit ไม่ส่ง เพราะงบนั้นไม่ใช่เรื่องที่ทำอะไรได้แล้ว
  - ถ้าระบบล้มระหว่างเพิ่มแถวกับสร้างแจ้งเตือน รอบ scan ถัดไปจะส่งใหม่
  - ไม่ส่งซ้ำ เพราะ dedup ของแจ้งเตือนใช้ sourceId ของแถว
  - run dedup ของ workflow ใช้ id ของแถว WARN และ FULL จึงแยกกันแม้อยู่ในชั่วโมงเดียวกัน
  - payload ใส่ `notificationPeriodKey = alert.id` เพราะ scan ไม่มี period ของตัวเอง ([workflow-action-runner.use-case.ts:64-70](../../apps/api/src/modules/workflow/application/use-cases/workflow-action-runner.use-case.ts), รอบ 3 F11)
- แก้ยอดงบกลางเดือน: ยอดใหม่มีผลกับเดือนปัจจุบันทันที ระดับที่ส่งไปแล้วในเดือนนั้นไม่ส่งซ้ำ ระดับที่ยังไม่ได้ส่งส่งได้ตามยอดใหม่ และระบบไม่ถอนคำเตือนที่ส่งไปแล้ว
- เลิกใช้งบ (`ARCHIVED`) ไม่ลบประวัติคำเตือน ตั้งงบใหม่ในขอบเขตเดิมได้
- ปิดสาขาที่มีงบ: งบของสาขานั้นเลิกใช้อัตโนมัติใน transaction เดียวกับการปิด และ audit
- หมวดถูกเก็บถาวร: งบยังอยู่ หน้างบแสดงชื่อหมวดพร้อม "(เลิกใช้แล้ว)"

### 5.2 วงเงินต่อใบเบิกตามหมวด

- ยอดต่อหมวดของใบหนึ่งใบ = Σ `ReimbursementLine.amount` ของบรรทัดที่หมวด (หลัง resolve ตาม §5.3) ตรงหมวดนั้น
- ถ้ายอดของหมวดใดเกินวงเงินที่ใช้งานอยู่ ใบนั้นต้องมีคนอนุมัติแม้ยอดรวมต่ำกว่า `approvalRequiredFromAmount`
  - ทำด้วยกลไก approval floor เดิม เพิ่มเหตุ `CATEGORY_LIMIT` คู่กับ `THIRD_PARTY_PAYOUT` ([reimbursement-request.use-case.ts:652-653](../../apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.ts))
- ตอนส่ง snapshot ตรึง `categoryLimitBreaches: [{ expenseCategoryId, categoryName, limitAmount, claimedAmount }]` ไว้ใน hash ของการอนุมัติ ใบที่ส่งแล้วไม่ถูกกระทบเมื่อแก้วงเงินทีหลัง ส่วนใบที่ส่งใหม่หลังถูกตีกลับใช้วงเงินปัจจุบัน
- ใช้กับใบเคลียร์เงินทดรองด้วย เพราะใบเคลียร์คือใบเบิก
- ร้านคนเดียวอนุมัติเองได้ตาม solo exemption เดิม การ์ดยังแสดงบรรทัดที่เกิน
- ไม่ปฏิเสธการส่งเพราะเกินวงเงิน (Q2) ส่วนหมวดที่ resolve ไม่ได้ถูกปฏิเสธตาม §5.3 ข้อ 4 จึงเลี่ยงวงเงินไม่ได้
- ใช้กับใบเบิกเท่านั้น ไม่ใช้กับรายจ่ายที่ไม่ใช่ใบเบิก

### 5.3 หมวดของบรรทัดใบเบิก (Phase 0)

- หน้าสร้างใบเบิกบนเว็บเลือกหมวดจากหมวดค่าใช้จ่ายของร้าน (ACTIVE รวมเบ็ดเตล็ด) ซึ่งเป็นชุดเดียวกับที่ร่างใบเบิกใน LINE ใช้อยู่แล้ว ([line-reimbursement-draft-adapter.service.ts:759-763](../../apps/api/src/modules/line-ai/application/line-reimbursement-draft-adapter.service.ts))
- คำใบ้ใต้หมวดหนึ่งบรรทัด: "ใช้หมวดเดียวกับรายจ่ายของร้าน"
- `resolveClaimLineCategory(line, categories)` (pure function ใน contracts):
  1. บรรทัดที่ผูกรายจ่ายต้นทาง (รอบ 3 F2 blocker §16.1) ใช้ตามลำดับ:
     - `sourceExpenseSnapshot.classification.expenseCategoryId` **รับแม้หมวดนั้นเลิกใช้แล้ว** เพราะผู้ตรวจรีวิวหมวดนี้ไว้ และใบรับรองที่ ISSUED ตรึงไว้ ([substitute-receipt.use-case.ts:347](../../apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts))
     - ถ้าไม่มี ใช้หมวดของบรรทัดต้นทางถ้าทุกบรรทัดเป็นหมวดเดียวกัน
     - ถ้ายังไม่มี map `classification.accountHintKey` เป็นหมวด ACTIVE ของร้าน การออกใบรับรองบังคับให้มีหมวดหรือ hint อย่างใดอย่างหนึ่ง ([substitute-receipt.use-case.ts:239-241](../../apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts)) ต้นทางที่มีใบรับรองจึง resolve ได้เกือบทุกกรณี
  2. `categoryKey` ที่เป็น id ของหมวดที่ร้านเลือกได้ ใช้ id นั้น
  3. key เก่าห้าตัวแปลงด้วย `accountHintKey`: `travel` และ `accommodation` เป็น `expense.travel`, `meals` เป็น `expense.meals`, `supplies` เป็น `expense.office_supplies` และ `other` เป็น `expense.miscellaneous` แล้วเลือกหมวด ACTIVE ตัวแรกตาม `sortOrder` อ้างอิงจากแม่แบบหมวด ([expense-category-bootstrap.service.ts:72](../../apps/api/src/modules/expenses/application/services/expense-category-bootstrap.service.ts), [:94-114](../../apps/api/src/modules/expenses/application/services/expense-category-bootstrap.service.ts))
     - ที่พักของการเดินทางไปทำงานนับเป็นค่าเดินทาง ข้อนี้ตัดสินเองตามความหมายของหมวด "ค่าเดินทางและยานพาหนะ"
  4. ถ้าไม่ตรงข้อใด ผลเป็น "หมวดไม่ชัด" และ **ส่งใบไม่ได้** (F2)
     - ตอบ `line_category_unresolved` พร้อมช่องหมวดที่ต้องเลือก ข้อความ L3 ทางออกคือเลือกหมวดของร้าน
     - ถ้าร้านยังไม่มีหมวดที่ใช้งานอยู่ ข้อความบอกให้ผู้ดูแลเพิ่มหมวด ผู้ที่มี `expense.category.manage` ได้ลิงก์ไปหน้าหมวด
     - ตอนบันทึกร่าง `categoryKey` ของ **บรรทัดที่ไม่ผูกต้นทาง** ต้องเป็น key เก่าห้าตัว หรือ id ของหมวด ACTIVE ที่ร้านเลือกได้ ค่าอื่นได้ 400 `line_category_invalid` (DTO วันนี้รับทุกข้อความยาวไม่เกิน 80 [reimbursement.dtos.ts:46](../../apps/api/src/modules/reimbursements/presentation/http/reimbursement.dtos.ts))
     - **ข้อยกเว้นของต้นทางที่เชื่อได้ (blocker F2)**: บรรทัดที่มี `linkedExpenseId` ไม่ตรวจ `categoryKey` จาก client เลย
       - หมวดมาจาก snapshot ของต้นทางที่ server อ่านและ pin เอง ([reimbursement-source.ts](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts)) จึงรับหมวดที่เลิกใช้แล้วของต้นทางได้
       - ค่า `categoryKey` ที่ client ส่งมาไม่ตรงกับ snapshot ถูกปฏิเสธ แบบเดียวกับ `LINKED_SOURCE_OVERRIDE`
     - ผลคือไม่มีบรรทัดใดเลี่ยงวงเงินต่อหมวดด้วยหมวดที่ระบบไม่รู้จัก
- ตอนบันทึกร่างและตอนส่ง ระบบเขียนผลลัพธ์ลง `ReimbursementLine.expenseCategoryId` และตรึงไว้ตอนส่ง ตอนสร้างรายจ่าย ระบบใส่หมวดนี้ทั้งใน `ExpenseRecord.expenseCategoryId` และ `ExpenseLine.expenseCategoryId`
- **F4 ใหม่ (blocker)**: บรรทัดที่ผูกต้นทางต้องพาหมวดที่ resolve แล้วไปด้วย
  - วันนี้ projection กระจาย `sourceExpenseSnapshot.classification` ตรง ๆ ([prisma-reimbursement.repository.ts:2349](../../apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts)) ต้นทางที่มีแค่ `accountHintKey=expense.travel` และ `expenseCategoryId=null` จึงได้ projection ที่ไม่มีหมวด และงบค่าเดินทางเห็น 0
  - แก้: หลังกระจาย classification ให้ตั้ง `expenseCategoryId = classification.expenseCategoryId ?? line.expenseCategoryId` บน projection และบรรทัด cost line ที่ไม่มีหมวดใช้ `line.expenseCategoryId`
  - ต้นทางและใบรับรองที่ลงนามไม่ถูกแตะ เพราะ projection เป็นรายการใหม่
  - การนับ "รอยืนยัน" ของต้นทางที่ผูกกับบรรทัดใบเบิกที่ส่งแล้ว ใช้หมวดของบรรทัด (`ReimbursementLine.expenseCategoryId`) เมื่อต้นทางเองไม่มีหมวด โดยกำหนดที่การรวมยอด ไม่เขียนลงต้นทาง
  - รายจ่ายทั่วไปที่มีแค่ hint ไม่มีหมวดอยู่นอกงบหมวดเหมือนวันนี้ (G7)
- **ต้นทางที่ยังหมวดไม่ชัดหลังข้อ 1** (รอบ 2 F12 แก้ใหม่ในรอบ 3 F2/P39) บรรทัดที่ผูกต้นทางใช้หมวดของต้นทางเสมอ ผู้เบิกเลือกทับไม่ได้ (`LINKED_SOURCE_OVERRIDE` [line-reimbursement-draft-adapter.service.ts:1166](../../apps/api/src/modules/line-ai/application/line-reimbursement-draft-adapter.service.ts)) ทางออกขึ้นกับสถานะของต้นทาง:
  - **ต้นทางไม่มีใบรับรอง หรือใบรับรองยังไม่ลงนาม (PREPARED)**: ผู้ตรวจรายจ่าย (`expense.review` ซึ่งมีอำนาจจัดหมวด `expense.update` อย่างเดียวไม่พอ) แก้หมวดที่ต้นทาง แล้วกด "โหลดข้อมูลต้นทางล่าสุดและตรวจใหม่" ([ReimbursementCreatePage.tsx:302](../../apps/web/src/features/reimbursements/ReimbursementCreatePage.tsx), [:622](../../apps/web/src/features/reimbursements/ReimbursementCreatePage.tsx)) หรือเลือกต้นทางใหม่ใน LINE ข้อความ L3b
  - **ใบรับรองลงนามแล้ว (PAYER_CERTIFIED/ISSUED)**: แก้ข้อมูลสำคัญไม่ได้ (`substitute_evidence_locks_expense` [prisma-expense.repository.ts:1966-1979](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) และใบที่ ISSUED แก้ตรงไม่ได้ ([substitute-receipt-expense-edit-sync-spec.md:13](substitute-receipt-expense-edit-sync-spec.md))
    - ใบที่เป็นเอกสารแก้ไขซึ่ง ISSUED แล้ว ยกเลิกไม่ได้ ระบบบอกให้ทำเอกสารแก้ไขใหม่ ([prisma-expense.repository.ts:2098](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts))
    - เอกสารแก้ไขแบบเดิม (`executeCorrection` [substitute-receipt.use-case.ts:654-678](../../apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts)) คัดลอก snapshot เดิมที่ลงนามแล้ว ([prisma-expense.repository.ts:2837](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) และตอนลงนามใช้ `{ ...original }` ([substitute-receipt.use-case.ts:313-316](../../apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts)) หมวดในหลักฐานที่ลงนามจึงยังเป็นหมวดเดิม ใช้แก้หมวดตรง ๆ ไม่ได้
    - **ทางกู้ที่ออกแบบ (blocker F2): เอกสารแก้ไขแบบแก้หมวด** (`correctionKind: 'CLASSIFICATION'`) ต่อยอดจาก `executeCorrection` สิทธิ์ `expense.review` (มีอำนาจจัดหมวด) ทำบนเว็บ ใช้ได้ทั้งใบปกติและใบแก้ไขที่ ISSUED ใน transaction เดียวภายใต้ funding lock และ substitute lock เดิม:
      1. รับ `revisedExpenseCategoryId` ซึ่งต้องเป็นหมวด ACTIVE ที่ร้านเลือกได้
      2. สร้างเอกสารแก้ไข PREPARED (`correctionOfEvidenceId` ชี้ใบเดิม เลขที่และแหล่งเงินเดิม) โดย `snapshotJson` = snapshot เดิมที่เปลี่ยนเฉพาะ `expense.category` เป็นหมวดใหม่ และ **พักค่าไว้ที่เอกสารแก้ไข** `stagedClassificationJson: { from, to }` **ไม่แตะรายจ่ายต้นทาง** (รอบสุดท้าย F2)
      3. เงื่อนไขตอนเตรียม (คงการป้องกันเดิม): รายจ่ายต้องยังไม่ยืนยัน (`DRAFT`/`NEEDS_REVIEW`/`READY_FOR_CONFIRMATION`) ไม่ได้ลงบัญชี และไม่ได้ผูกกับใบเบิกที่ส่งแล้ว ถ้าไม่ผ่านปฏิเสธ รายจ่ายที่ยืนยันแล้วจึงย้ายงบ "ใช้แล้ว" ด้วยทางนี้ไม่ได้
      4. ผู้รับรองลงนาม และผู้อนุมัติอนุมัติ snapshot ที่มีหมวดใหม่ **ใน transaction ที่ทำให้เป็น ISSUED** (กิ่งเอกสารแก้ไขของการออกใบ [prisma-expense.repository.ts:3066-3072](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) จึงเขียน `to` ลงรายจ่ายต้นทางแบบ CAS
         - CAS ตรวจว่าหมวดยังเป็น `from` และเงื่อนไขข้อ 3 ยังจริง ถ้าไม่ตรงให้ล้มทั้ง tx ใบไม่ออก และให้เปิดใหม่
         - การยกเว้น `substitute_evidence_locks_expense` เกิดเฉพาะในจุดนี้ และเฉพาะการเปลี่ยนหมวด
         - ใบเดิมเป็น SUPERSEDED ตามกลไกเดิม และหลักฐานเดิมยังอยู่ในประวัติ
      5. ยกเลิกเอกสารแก้ไขที่ยัง PREPARED/PAYER_CERTIFIED (SUPERSEDED [prisma-expense.repository.ts:2105](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) หรือรายจ่ายถูก void ([:2715](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) ทิ้งค่าที่พักไว้ไปพร้อมกัน ไม่มีอะไรต้องคืน เพราะรายจ่ายต้นทางยังไม่เคยเปลี่ยน
      6. กลับมาที่ใบเบิกแล้วโหลดต้นทางใหม่
    - ระหว่างนั้นใบเบิกส่งไม่ได้ เพราะ source ต้องเป็นใบรับรองฉบับล่าสุดที่ ISSUED ([reimbursement-source.ts:26-29](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts))
    - **ตรวจความตรงกัน**: `readReimbursementSource` ตรวจว่า `certificate.snapshotJson.expense.category` เท่ากับหมวดที่ resolve ได้จากต้นทาง (`expenseCategoryId ?? accountHintKey`) ถ้าไม่ตรงปฏิเสธด้วย `reimbursement_source_classification_mismatch` และแสดง L3c หลักฐานที่ลงนามจึงตรงกับหมวดของใบเบิกเสมอ
    - ข้อความ L3c และระบบไม่มีการแก้หมวดแบบเลี่ยงลายเซ็น
  - ไม่เพิ่มการเลือกหมวดทับในใบเบิก เพราะหมวดของใบเบิกกับต้นทางจะไม่ตรงกัน
- **ใบเบิกที่ส่งแล้วก่อน deploy และยังไม่มี projection** (รอบ 3 F6) จะไม่ถูกบันทึกหรือส่งซ้ำ:
  - script เตรียมตอน deploy (ตัวเดียวกับ backfill ใช้ `--claim-lines`) เติม `ReimbursementLine.expenseCategoryId` ของใบที่อยู่ใน PENDING_APPROVAL/APPROVED/FINANCE_REVIEW ด้วย resolver เดียวกัน แบบ dry-run ก่อน
  - ตอน materialize ถ้าบรรทัดยังเป็น null ให้ resolve อีกครั้งเป็น fallback
  - `expenseCategoryId` **ไม่อยู่ใน** `claimSnapshotFields`/approval hash การเติมจึงไม่ทำให้การอนุมัติที่มีอยู่ใช้ไม่ได้
  - ใบเหล่านี้ไม่มี `categoryLimitBreaches` (ส่งก่อนมีวงเงิน) parser รับได้
  - บรรทัดที่ resolve ไม่ได้ลงรายงานยกเว้นเดียวกับ backfill และ projection ยังไม่มีหมวดเหมือนวันนี้
- Backfill (deploy-owned script, รอบ 2 F13 ไม่สัญญาว่าได้ทุกแถว):
  - รายจ่ายจากใบเบิกที่ `expenseCategoryId IS NULL` และ `postingStatus <> 'posted'` ที่ resolver ให้หมวดได้ ใส่หมวดและเขียน audit หนึ่งแถวต่อบริษัท
  - แถวที่ resolve ไม่ได้ (key กำหนดเองที่ DTO เดิมเคยรับ [reimbursement.dtos.ts:46](../../apps/api/src/modules/reimbursements/presentation/http/reimbursement.dtos.ts), หมวดเลิกใช้ หรือร้านไม่มีหมวดที่ hint ตรง) ไม่แตะ แต่ลงรายการยกเว้นต่อบริษัทในรายงาน dry-run แยกจากแถวที่ลงบัญชีแล้วซึ่งตั้งใจข้าม
  - การแก้แถวยกเว้นทำทีหลังด้วยไฟล์ map ที่นักบัญชีหรือเจ้าของตรวจแล้ว ผ่าน `--mapping <file>` ของ script เดียวกัน และ audit ทุกแถว ระหว่างนี้แถวเหล่านี้ยังขึ้น "ยังไม่จัดหมวด" เหมือนเดิม

### 5.4 กติกาภายนอกที่เกี่ยว

- งบเป็นการบัญชีบริหาร ไม่มีกฎหมายบังคับรูปแบบ
- เรื่องภาษีที่กระทบตัวเลขงบคือการเลือกใช้ยอดรวม VAT (§5.1) และรายจ่ายที่ไม่มีหลักฐานผู้รับหักเป็นรายจ่ายไม่ได้ ([มาตรา 65 ตรี (18)](https://www.rd.go.th/5939.html)) งบจึงไม่ใช่การรับรองว่ารายจ่ายหักภาษีได้
- ตัวเลขงบเป็นข้อมูลของร้าน ไม่ใช่ข้อมูลส่วนบุคคล จึงไม่อ้าง พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล การจำกัดว่าใครเห็นเป็นการตัดสินใจแบบให้สิทธิ์น้อยที่สุด (least privilege) ผู้เบิกไม่เห็นตัวเลขงบรายเดือน และผู้อนุมัติเห็นเฉพาะงบที่ตรงกับใบที่ตัดสิน (§8) ส่วนชื่อผู้รับผิดชอบงบแสดงเฉพาะผู้ที่อ่านงบนั้นได้

## 6. Data model (migration additive)

```prisma
enum ExpenseBudgetStatus {
  ACTIVE
  ARCHIVED
}

model ExpenseBudget {
  id                String              @id @default(cuid())
  companyId         String
  branchId          String?             // null = ทุกสาขา
  expenseCategoryId String?             // null = ทุกหมวด
  monthlyAmount     Decimal             @db.Decimal(18, 4)
  currency          String              @default("THB")
  warnAtPercent     Int                 @default(80)
  responsibleUserId String
  status            ExpenseBudgetStatus @default(ACTIVE)
  archivedAt        DateTime?
  archivedByUserId  String?
  version           Int                 @default(0)
  createdByUserId   String
  updatedByUserId   String?
  createdAt         DateTime            @default(now())
  updatedAt         DateTime            @updatedAt
  company           Company             @relation(fields: [companyId], references: [id], onDelete: Cascade)
  branch            Branch?             @relation(fields: [companyId, branchId], references: [companyId, id], onDelete: Restrict)
  expenseCategory   ExpenseCategory?    @relation(fields: [expenseCategoryId], references: [id], onDelete: Restrict)
  alerts            ExpenseBudgetAlert[]

  @@unique([companyId, id])
  @@index([companyId, status])
}

model ExpenseBudgetAlert {
  id                   String        @id @default(cuid())
  companyId            String
  budgetId             String
  periodKey            String        @db.Char(7)       // 'YYYY-MM' Asia/Bangkok
  level                String        @db.VarChar(8)    // WARN | FULL (CHECK)
  usedAmount           Decimal       @db.Decimal(18, 4)
  limitAmount          Decimal       @db.Decimal(18, 4)
  notified             Boolean       @default(true)    // false = ถึงแล้วแต่ไม่ส่ง (ข้ามระดับ)
  deliveryAbandonedAt  DateTime?                        // ค้างส่งเกิน 40 วัน เลิกส่ง (audit)
  recipientUserIdsJson Json
  createdAt            DateTime      @default(now())
  budget               ExpenseBudget @relation(fields: [companyId, budgetId], references: [companyId, id], onDelete: Cascade)

  @@unique([budgetId, periodKey, level])
  @@index([companyId, periodKey])
}

model ReimbursementCategoryLimit {
  id                String                    @id @default(cuid())
  companyId         String
  expenseCategoryId String
  perClaimAmount    Decimal                   @db.Decimal(18, 4)
  currency          String                    @default("THB")
  status            ReimbursementPolicyStatus @default(ACTIVE)
  createdByUserId   String
  updatedByUserId   String?
  createdAt         DateTime                  @default(now())
  updatedAt         DateTime                  @updatedAt
  company           Company                   @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@unique([companyId, expenseCategoryId])
}

model ReimbursementLine {
  // ...
  /// หมวดที่ resolve แล้ว (§5.3) ตรึงตอนส่ง; null = ยังไม่จัดหมวด
  expenseCategoryId String?
  @@index([companyId, expenseCategoryId])
}
```

SQL เพิ่ม:

```sql
CREATE UNIQUE INDEX "ExpenseBudget_active_scope_unique"
  ON "ExpenseBudget" ("companyId", COALESCE("branchId", ''), COALESCE("expenseCategoryId", ''))
  WHERE "status" = 'ACTIVE';
ALTER TABLE "ExpenseBudget" ADD CONSTRAINT "ExpenseBudget_amount_positive" CHECK ("monthlyAmount" > 0);
ALTER TABLE "ExpenseBudget" ADD CONSTRAINT "ExpenseBudget_warn_range" CHECK ("warnAtPercent" BETWEEN 1 AND 99);
ALTER TABLE "ExpenseBudgetAlert" ADD CONSTRAINT "ExpenseBudgetAlert_level" CHECK ("level" IN ('WARN', 'FULL'));
ALTER TABLE "ReimbursementCategoryLimit" ADD CONSTRAINT "ReimbursementCategoryLimit_positive" CHECK ("perClaimAmount" > 0);
```

- `ExpenseRecord` ไม่มีคอลัมน์ใหม่ index `@@index([companyId, status, expenseDate])` ที่มีอยู่ครอบ query ของงบ ([schema.prisma:2757](../../apps/api/prisma/schema.prisma))
- `ReimbursementPolicySnapshotV1`:
  - `approvalFloor` ขยายเป็น `'THIRD_PARTY_PAYOUT' | 'CATEGORY_LIMIT'` (เหตุแรกที่พบ) และเพิ่ม `categoryLimitBreaches?` (additive)
  - ละ field เมื่อไม่มีค่า เพื่อให้ hash ของใบเก่าเท่าเดิม
  - **ต้องแก้ parser แบบ strict ด้วย (F6)**: `parseReimbursementPolicySnapshot` ([reimbursement.constants.ts:83-126](../../apps/api/src/modules/reimbursements/domain/reimbursement.constants.ts)) ปฏิเสธ key ที่ไม่รู้จัก (:98) และรับ `approvalFloor` ได้แค่ `THIRD_PARTY_PAYOUT` (:115)
    - เพิ่ม `categoryLimitBreaches` และ `cashAdvance` ใน `POLICY_SNAPSHOT_KEYS`
    - รับ `approvalFloor ∈ {THIRD_PARTY_PAYOUT, CATEGORY_LIMIT}` ที่ `requiresApproval = true`
    - ตรวจ `categoryLimitBreaches` ว่าเป็น array ไม่ว่าง แต่ละรายการมี id ไม่ว่าง ชื่อยาวไม่เกิน 160 ยอดเป็นรูปแบบเงิน และ claimed > limit และเมื่อมีต้อง `requiresApproval = true`
    - ถ้าไม่ทำ ใบใหม่จะ throw ทุกครั้งที่อ่าน (detail, อนุมัติ, projection)
- Backfill ตาม §5.3 เป็น script แยก `apps/api/prisma/backfill-claim-expense-categories.ts` ไม่อยู่ใน migration

## 7. Contracts/API

ไฟล์ใหม่ `packages/contracts/src/expense-budgets.ts` และ controller ใหม่ `expense-budget.controller.ts` ในโมดูล `expenses`

| Method + path | Permission | ใช้ทำอะไร |
|---|---|---|
| `GET /companies/:companyId/expense-budgets?period=YYYY-MM` | `expense.read` หรือ `expense.budget.manage` (+ ขอบเขตสาขา §8) | รายการงบพร้อมการใช้งบของเดือน |
| `POST /companies/:companyId/expense-budgets` | `expense.budget.manage` (ขอบเขตทั้งบริษัท) | ตั้งงบ ถ้าขอบเขตซ้ำได้ 409 `expense_budget_scope_exists` |
| `PATCH /companies/:companyId/expense-budgets/:budgetId` | `expense.budget.manage` | แก้ยอด เกณฑ์เตือน หรือผู้รับแจ้ง (CAS `expectedVersion`) ขอบเขตแก้ไม่ได้ |
| `POST /companies/:companyId/expense-budgets/:budgetId/archive` | `expense.budget.manage` | เลิกใช้ |
| `GET /companies/:companyId/expense-budgets/category-options` | เหมือน GET list | หมวดที่เลือกได้ (ชุดของ `listCategories`) |
| `GET /companies/:companyId/reimbursements/category-options` | `reimbursement.create` / `update_own_draft` / `finance_review` | หมวดสำหรับฟอร์มใบเบิก `{ id, name, perClaimLimit? }` |
| `GET/PUT /companies/:companyId/reimbursement-policy/category-limits` | read: `reimbursement.policy.read`; write: `reimbursement.policy.manage` | วงเงินต่อใบตามหมวด (PUT แทนทั้งชุด CAS `expectedUpdatedAt`) |

DTO:

```ts
export type ExpenseBudgetUsage = { periodKey: string; usedAmount: string; pendingAmount: string; remainingAmount: string; usedPercent: number;
  level: 'NONE' | 'WARN' | 'FULL'; excludedOtherCurrencyCount: number; asOf: string };
export type ExpenseBudgetSummary = { id: string; branch: { id: string; name: string } | null; category: { id: string; name: string; archived: boolean } | null;
  monthlyAmount: string; currency: 'THB'; warnAtPercent: number; responsible: { userId: string; displayName: string; active: boolean };
  status: 'ACTIVE' | 'ARCHIVED'; version: number; usage: ExpenseBudgetUsage; canManage: boolean };
export type CreateExpenseBudgetInput = { branchId?: string | null; expenseCategoryId?: string | null; monthlyAmount: string; warnAtPercent?: number; responsibleUserId?: string };
export type UpdateExpenseBudgetInput = { monthlyAmount?: string; warnAtPercent?: number; responsibleUserId?: string; expectedVersion: number };
/** แนบในรายละเอียดใบเบิก/เงินทดรอง เฉพาะผู้ที่ตัดสินหรือจ่ายใบนั้นได้ และเฉพาะงบที่ผู้ดูเห็นได้ */
export type ClaimBudgetImpact = { budgets: Array<{ budgetId: string; label: string; usedPercent: number; afterPercent: number; level: 'NONE' | 'WARN' | 'FULL' }>;
  categoryLimitBreaches: Array<{ categoryName: string; limitAmount: string; claimedAmount: string }> };
```

- `ReimbursementRequestDetail` เพิ่ม `budgetImpact?: ClaimBudgetImpact` และ `CashAdvanceDetail` เพิ่ม `budgetImpact?` (เฉพาะงบสาขา เพราะเงินทดรองยังไม่มีหมวด)
- `ReimbursementLine` DTO เพิ่ม `expenseCategoryId?` และ `expenseCategoryName?`
- AI tool ใหม่ `expense.get_budget_status` (read, ตระกูล `expenses` ของ W00 manifest [line-ai-capability-manifest.ts:75](../../apps/api/src/modules/line-ai/line-ai-capability-manifest.ts)):
  - input: `period?`, `branchId?`, `categoryId?`
  - คืนงบที่ผู้ถามเห็นได้ พร้อม used/pending/remaining/percent และ `statusBasis: 'confirmed_only'`
  - `requiresErpPermissionCheck: true`, `anyOfPermissions: ['expense.read', 'expense.budget.manage']`
- Error codes ใหม่: `expense_budget_scope_exists`, `expense_budget_changed`, `expense_budget_not_found`, `expense_budget_scope_forbidden`, `reimbursement_category_limit_changed` ทุกตัวมีข้อความไทย

## 8. สิทธิ์ ABAC และขอบเขต tenant

- permission ใหม่หนึ่งตัว `expense.budget.manage` (riskLevel MEDIUM) อยู่ใน pack ใหม่ `pack.expense.budget`
  - module `expense`, `featureEntitlementKey: 'expenses'`, nameTh "ตั้งงบรายจ่าย", description "ตั้งงบรายเดือนของสาขาและหมวด และเลือกผู้รับแจ้งเตือน"
  - ให้บทบาทระบบ OWNER และ ADMIN ผ่าน `permission-registry.ts` และ `sync-permissions.ts`
  - ไม่ backfill ให้บทบาทที่ร้านตั้งเอง เพราะเป็นความสามารถใหม่ ผู้ดูแลติ๊กเองได้
- การอ่านใช้ `expense.read` เดิม ไม่มี key ใหม่
- ขอบเขตสาขา:
  - การตั้งหรือแก้งบต้องมีขอบเขตทั้งบริษัท ผู้ที่ถูกจำกัดสาขาตั้งงบไม่ได้ เพราะงบหมวดและงบทั้งร้านรวมทุกสาขา
  - ผู้อ่านเฉพาะสาขาเห็นเฉพาะงบที่ `branchId ∈ scope` งบหมวดและงบทั้งร้านเห็นได้เฉพาะผู้อ่านทั้งบริษัท
- `budgetImpact` ในรายละเอียดใบเบิกหรือเงินทดรอง ส่งให้เฉพาะผู้ที่ตัดสินหรือจ่ายใบนั้นได้ งบที่แสดง:
  - งบที่ `branchId = สาขาของใบ` (งบสาขา และงบสาขาและหมวด)
  - งบหมวดและงบทั้งร้าน เฉพาะเมื่อผู้ดูอ่านได้ทั้งบริษัท
  - ผู้เบิกเห็นเฉพาะ `categoryLimitBreaches` ของใบตัวเอง (ข้อเท็จจริงของนโยบายที่บอกว่าทำไมต้องรออนุมัติ)
- ผู้รับแจ้งเตือนคือ `responsibleUserId` ถ้ายังเป็นสมาชิกที่ใช้งานและอ่านงบนั้นได้ ถ้าไม่ได้ ส่งให้ผู้ถือบทบาท OWNER ที่ใช้งานอยู่และอ่านงบนั้นได้ แบบเดียวกับ owner fallback ของใบเบิก ไม่ส่งให้ทุกคนที่อ่านได้
- รอบ 3 F7: ตรวจสิทธิ์อ่านงบ (`expense.read` หรือ `expense.budget.manage`) และขอบเขตสาขา **ซ้ำทั้งตอนสร้าง candidate ตอนกู้แถวค้าง และตอนส่ง** (ต่อจากการตรวจ membership ACTIVE ที่มีอยู่ [notification.use-cases.ts:505-515](../../apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts))
  - คนที่เสียสิทธิ์ไม่ได้รับตัวเลขงบ และ delivery ถูก suppress ด้วยเหตุ `recipient_lost_access`
  - ภาระของแถว alert ถือว่าเสร็จก็ต่อเมื่อมี delivery ถึงผู้รับที่มีสิทธิ์อย่างน้อยหนึ่งคน (บนกระดิ่งหรือ LINE) ไม่ใช่แค่มี event
  - ถ้าไม่มีผู้รับที่มีสิทธิ์เลย แถวยังค้างและถูกลองใหม่จนครบ 40 วัน
- Tenant: ทุก query มี `companyId` ใช้ FK compound กับ Branch หมวดต้องเป็นหมวดที่ร้านเลือกได้ (ตรวจด้วยชุดของ `listCategories` ไม่ใช่แค่ id)
- Feature: งบอยู่ใต้ `expenses` และวงเงินต่อหมวดอยู่ใต้ `reimbursement` ทั้งสองอยู่ใน starter preset จึงได้ทุก tier ที่ขาย (249/499/999/1999) ([menu-entitlements.ts:432-449](../../packages/contracts/src/menu-entitlements.ts), [:496-501](../../packages/contracts/src/menu-entitlements.ts))
  - ไม่เพิ่ม feature key ย่อย เพราะ snapshot ที่ลูกค้าจ่ายแล้วไม่เปลี่ยน ([menu-entitlements.ts:503](../../packages/contracts/src/menu-entitlements.ts)) key ใหม่จะไม่ถึงลูกค้าเดิม
  - เมนูย่อยใช้ permission gate แบบใบสำคัญจ่ายและหนังสือรับรองหัก ณ ที่จ่าย ([web-core-workspace.logic.ts:314-328](../../apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts))
- AI Gateway เรียก `expense.get_budget_status` ซึ่ง API ตรวจสิทธิ์และขอบเขตแล้ว ไม่แตะฐานข้อมูล

## 9. State transitions

| สิ่ง | จาก → ไป | ใคร | Guard |
|---|---|---|---|
| ExpenseBudget | — → ACTIVE | ผู้จัดการงบ | ขอบเขตไม่ซ้ำ (unique), หมวดเลือกได้, สาขา ACTIVE |
| ExpenseBudget | ACTIVE → ACTIVE (แก้) | ผู้จัดการงบ | CAS `version` |
| ExpenseBudget | ACTIVE → ARCHIVED | ผู้จัดการงบ หรือระบบเมื่อปิดสาขา | — (ปลายทาง) |
| ระดับต่อเดือน | NONE → WARN → FULL (หรือ NONE → FULL) | scan | ขึ้นอย่างเดียวในเดือนนั้น (unique `budgetId, periodKey, level`) ไม่มีถอยกลับ |
| ReimbursementCategoryLimit | ACTIVE ↔ INACTIVE (แทนทั้งชุดด้วย PUT) | ผู้ตั้งนโยบาย | CAS |
| ใบเบิก | DRAFT → PENDING_APPROVAL แม้ยอดต่ำกว่าเกณฑ์ | ผู้เบิก | เมื่อมี `CATEGORY_LIMIT` |

## 10. UI

### 10.1 หน้า "งบรายจ่าย" `/companies/:companyId/expenses/budgets`

- **390 px**
  - หัวหน้ามีตัวเลือกเดือน [◀] ต.ค. 2569 [▶]
  - งบแต่ละใบเป็นการ์ด: บรรทัดแรก "สาขาสยาม · ค่าเดินทางและยานพาหนะ" บรรทัดสอง "ใช้ไป 9,200.00 / 10,000.00 บาท · 92%" แถบความคืบหน้า และบรรทัดเล็ก "รอยืนยัน 1,500.00 บาท"
  - แถบล่างติดจอมีปุ่ม [+ ตั้งงบ] (เฉพาะผู้จัดการงบ)
- **1,280 px และ ~1,556 px**: ตารางเต็มกว้าง คอลัมน์คือ ขอบเขต · งบต่อเดือน · ใช้ไป · รอยืนยัน · คงเหลือ · ใช้ไป % · ผู้รับแจ้ง · เมนูแถว (แก้ไข / เลิกใช้) ปุ่ม [+ ตั้งงบ] อยู่แถบล่าง
- บรรทัดใต้หัวหน้า: "ยอดตามเอกสาร รวม VAT นับเฉพาะรายการที่ยืนยันแล้ว"
- ยังไม่มีงบ: ผู้จัดการเห็น "ยังไม่ได้ตั้งงบ" และปุ่ม [+ ตั้งงบ] ผู้อ่านเห็น "ร้านยังไม่ได้ตั้งงบ"
- Dialog "ตั้งงบรายเดือน" / "แก้งบรายเดือน"
  - ช่อง: สาขา (ทุกสาขา/สาขา), หมวด (ทุกหมวด/หมวด), งบต่อเดือน (บาท), เตือนเมื่อใช้ถึง (%), ผู้รับแจ้งเตือน (ค่าเริ่มต้นคือตัวเอง)
  - ประโยคเดียว: "ระบบเตือนผู้รับแจ้งเมื่อใช้ถึงเกณฑ์ และไม่บล็อกการบันทึก"
  - ปุ่ม [ยกเลิก] [บันทึก] ขนาดเท่ากัน ตอนแก้ ช่องสาขาและหมวดล็อก
- ขอบเขตซ้ำ: "มีงบของขอบเขตนี้อยู่แล้ว แก้งบเดิมแทน" + [แก้งบเดิม]
- เลิกใช้: confirm "เลิกใช้งบนี้ ประวัติยังดูได้" [ยกเลิก] [เลิกใช้]

### 10.2 วงเงินต่อใบตามหมวด (ในตั้งค่าการเบิกจ่าย `PolicySettings` [ReimbursementsPages.tsx:709](../../apps/web/src/features/reimbursements/ReimbursementsPages.tsx))

- ส่วน "วงเงินต่อใบตามหมวด" เป็นรายการแถว (หมวด · วงเงินต่อใบ · [ลบ]) และปุ่ม [+ เพิ่มหมวด]
- คำใบ้ "ใบที่เกินวงเงินต้องมีคนอนุมัติเสมอ" ปุ่มบันทึกรวมกับนโยบายเดิมในแถบล่าง

### 10.3 จุดที่ตัวเลขปรากฏ

| ID | ประโยค | ที่ |
|---|---|---|
| L1 | เกินวงเงินต่อใบของหมวดนี้ {limit} บาท ต้องรออนุมัติ | ฟอร์มใบเบิก (ใต้บรรทัด), การ์ดร่าง LINE |
| L2 | เกินวงเงินต่อใบ หมวด{name} {limit} บาท (ใบนี้ {claimed} บาท) | การ์ดอนุมัติเว็บ/LINE, หน้า journey ขั้นอนุมัติ |
| L3 | เลือกหมวดของร้านให้รายการนี้ก่อนส่ง | ฟอร์มใบเบิก (ใต้บรรทัดที่หมวดไม่ชัด), LINE ถามหนึ่งครั้งพร้อมปุ่มหมวด |
| L3b | หมวดของรายจ่ายที่เลือกไว้ยังไม่ชัด ให้ผู้ตรวจรายจ่ายแก้หมวดที่รายจ่ายนั้น แล้วโหลดข้อมูลต้นทางใหม่ | ต้นทางไม่มีใบรับรองหรือใบยังไม่ลงนาม [เปิดรายจ่าย] (แสดงเมื่อผู้ดูมี `expense.review`) |
| L3c | ใบรับรองของรายการนี้ลงนามแล้ว ให้ผู้ตรวจรายจ่ายทำเอกสารแก้ไขใบรับรองพร้อมหมวดที่ถูกต้อง เมื่อออกแล้วโหลดข้อมูลต้นทางใหม่ | ต้นทางที่ใบรับรองลงนามแล้ว ทั้งใบปกติและใบแก้ไข [เปิดใบรับรอง] (แสดงปุ่มเมื่อผู้ดูมี `expense.review`) |
| B1t | งบ{scope}เดือนนี้ใช้ไป {p}% | การ์ดอนุมัติ (เมื่อ p ≥ 50 หรือ after ≥ เกณฑ์เตือน), หน้าแรก |
| B2t | เมื่อยืนยันรายจ่ายของใบนี้ จะใช้ไป {after}% | ต่อท้าย B1t บนการ์ดอนุมัติ เมื่อใบนี้นับในงบนั้น การอนุมัติของผู้จัดการอาจยังไม่ทำให้ยอดเปลี่ยน ถ้าร้านเปิดตรวจการเงิน ([reimbursement-approval.use-case.ts:516](../../apps/api/src/modules/reimbursements/application/use-cases/reimbursement-approval.use-case.ts), [:594](../../apps/api/src/modules/reimbursements/application/use-cases/reimbursement-approval.use-case.ts)) จึงพูดถึงตอนยืนยันรายจ่าย (F23) |
| W1 | งบ{scope} {เดือน} ใช้ไป {p}% แล้ว | แจ้งเตือน WARN (`{เดือน}` เป็นเดือนของแถว เช่น ต.ค. 2569) |
| F1 | ใช้ครบงบ{scope} {เดือน} แล้ว | แจ้งเตือน FULL เมื่อ used = limit |
| F2 | เกินงบ{scope} {เดือน} {x} บาท | แจ้งเตือน FULL เมื่อ used > limit, หน้างบ, หน้าแรก |
| N1 | ยอดตามเอกสาร รวม VAT นับเฉพาะรายการที่ยืนยันแล้ว | หน้างบ, การ์ด LINE |

`{scope}` สร้างจากข้อเท็จจริงในที่เดียว (`budgetScopeLabel`) ดังนี้:

| สาขา | หมวด | ข้อความ |
|---|---|---|
| ว่าง | ว่าง | "ทั้งร้าน" |
| สาขา | ว่าง | "สาขา{ชื่อ}" |
| ว่าง | หมวด | "{หมวด}" |
| สาขา | หมวด | "{หมวด} สาขา{ชื่อ}" |

ร้านที่มีสาขาเดียวไม่ต้องแสดงชื่อสาขา

| ประโยค | ร้านคนเดียว | หลายสาขา | สาขาเดียว | หมวดเลิกใช้ | ผู้รับแจ้งถูกปิดบัญชี | มีรายการสกุลอื่น | จริงทุกกรณี? |
|---|---|---|---|---|---|---|---|
| L1/L2 | ✓ (ยังต้องอนุมัติ ผ่าน solo) | ✓ | ✓ | ใช้ชื่อตอนตรึง | — | ไม่เกี่ยว (ใบเบิกเป็น THB) | ใช่: floor บังคับขั้นอนุมัติเสมอ |
| L3 | ✓ | ✓ | ✓ | หมวดที่เลิกใช้ถือว่าไม่ชัดเฉพาะบรรทัดที่ไม่ผูกต้นทาง (บรรทัดที่ผูกใช้หมวดของต้นทางแม้เลิกใช้ §5.3 ข้อ 1) | — | — | ใช่: แสดงเฉพาะบรรทัดที่ resolve ไม่ได้ และเลือกหมวดได้เสมอเมื่อร้านมีหมวด |
| B1t/B2t | ไม่แสดงบนการ์ดของตัวเองถ้าไม่มีงบ | ✓ | ไม่แสดงชื่อสาขา | "(เลิกใช้แล้ว)" | — | ไม่นับ และหน้างบบอก "ไม่รวม {n} รายการสกุลอื่น" | ใช่: แสดงเฉพาะงบที่ผู้ดูเห็นได้ (§8) |
| W1/F1/F2 | ส่งให้ตัวเอง | ✓ | ✓ | ✓ | ส่งให้เจ้าของแทน และข้อความเหมือนกัน | — | ใช่: เลือก F1 หรือ F2 จาก used ที่ตรึงในแถว alert และระบุเดือนของแถว จึงจริงแม้ส่งข้ามเดือน (รอบ 2 F11) |
| N1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ใช่ |

### 10.4 หน้าแรก

- การ์ด "งบเดือนนี้" ต่อจาก `ExpenseMonthsCard` ([DashboardPages.tsx:322](../../apps/web/src/features/dashboard-notifications/DashboardPages.tsx)) แสดงเฉพาะผู้ที่อ่านงบได้และมีงบที่เห็นได้อย่างน้อยหนึ่งใบ ไม่มีการ์ดว่าง
- แสดงไม่เกิน 5 แถว เรียงจาก % สูงสุด แต่ละแถวเป็นตัวเลขล้วน (ชื่อขอบเขต · ใช้ไป/งบ · %) ตามกติกาหน้าแรกของเจ้าของ "numbers only" ([DashboardPages.tsx:109-110](../../apps/web/src/features/dashboard-notifications/DashboardPages.tsx))
- หัวการ์ดเป็นลิงก์ "งบเดือนนี้" ไปหน้างบ ไม่มีปุ่ม
- 390 px: หนึ่งแถวต่องบ ชื่ออยู่ซ้าย ตัวเลขอยู่ขวา 1,280 px และ ~1,556 px: grid สามคอลัมน์
- หลักฐานก่อนเรียกว่าเสร็จ (ใช้กับทุกหน้าใน §10) ([thai-ux-standard.md:112-118](../guidelines/thai-ux-standard.md)): เปิดหน้างบ dialog ตั้งงบและแก้งบ การ์ดหน้าแรก ฟอร์มใบเบิกที่มี L1 และหน้านโยบาย ใน browser จริงที่ 390, 1,280 และ ~1,556 px ด้วยข้อมูลไทย วัดกลุ่มปุ่ม กด journey หลักหนึ่งรอบรวมทางผิดหนึ่งครั้ง (เช่น ตั้งงบซ้ำขอบเขต) แล้วเขียนสิ่งที่ไม่ได้ดูไว้ตรง ๆ

### 10.5 LINE (น้องมั่งมี ค่ะ ใช้ปุ่ม)

| การ์ด | ข้อความ | ปุ่ม |
|---|---|---|
| ตอบ "งบเดือนนี้เหลือเท่าไร" | หัว "งบเดือน ต.ค. 2569" แต่ละแถวเป็น `{scope}` ใช้ไป {used}/{limit} บาท ({p}%) ไม่เกิน 5 แถว + "อีก n งบ" ท้าย N1 | [เปิดงบในเว็บ] |
| ยังไม่มีงบ | ร้านยังไม่ได้ตั้งงบรายเดือนค่ะ (ผู้จัดการงบได้ปุ่ม) | [ตั้งงบในเว็บ] |
| แจ้งเตือน WARN | W1 + "ใช้ไป {used} จาก {limit} บาทค่ะ" | [ดูงบ] |
| แจ้งเตือน FULL | F1 หรือ F2 + "ค่ะ" | [ดูงบ] |
| บรรทัดในการ์ดอนุมัติใบเบิก/เงินทดรอง | L2 และ B1t + B2t (แสดงไม่เกิน 2 งบ) | ใช้ปุ่มเดิม [อนุมัติ] [ไม่อนุมัติ] |

- น้องมั่งมีใช้เดือนปัจจุบันเป็นค่าเริ่มต้น และใช้ทุกงบที่ผู้ถามเห็นได้ ถามกลับได้ไม่เกินหนึ่งครั้ง (เช่น เมื่อผู้ถามพูดถึงสาขาที่มีชื่อซ้ำกัน)
- การ์ดอ่านอย่างเดียว ไม่มีการเขียน งบตั้งและแก้ได้บนเว็บเท่านั้นในรอบนี้

## 11. Impact analysis

| พื้นที่ | ผลกระทบ |
|---|---|
| Prisma/migration | 3 ตาราง + 1 enum + `ReimbursementLine.expenseCategoryId` + partial unique + CHECK; backfill script แยก |
| Contracts | `expense-budgets.ts` ใหม่; `reimbursements.ts` (snapshot, line DTO, budgetImpact); `resolveClaimLineCategory`; `ai-tools.ts` (tool ใหม่ และการ์ดความสามารถ "ดูงบเดือนนี้") |
| Reimbursements | ฟอร์ม/endpoint หมวด; resolve หมวดตอน save/submit; floor `CATEGORY_LIMIT`; projection ใส่หมวด (`materialize-claim-expenses.service.ts`, `prisma-reimbursement.repository.ts` ตอนสร้างรายจ่าย); `budgetImpact` ในรายละเอียด; หน้านโยบาย (วงเงินต่อหมวด) |
| Expenses | โมดูลงบใหม่ (use-case, repository, controller); เมนูย่อย "งบรายจ่าย"; `archive` งบเมื่อปิดสาขา (`branch` use-case) |
| Dashboard | การ์ด "งบเดือนนี้" (provider ใหม่ใน `dashboard-notifications` หรืออ่านจาก endpoint งบ) |
| Notifications/workflow | แม่แบบ `expense_budget_threshold` (THRESHOLD_SCAN, autoEnable, cooldown 0 เพราะ cooldown คิดต่อกฎ [workflow-template-catalog.ts:50-57](../../apps/api/src/modules/workflow/domain/workflow-template-catalog.ts)) + case ใน `workflow-scan-candidates.use-case.ts` (แถว alert เป็นภาระที่ต้องส่ง §5.1); trigger `workflow.expense_budget_threshold` ลงทะเบียนสามที่ ได้แก่ `IMPLEMENTED_TRIGGER_KEYS`, `ALWAYS_DELIVERED_TRIGGER_KEYS` และ `NOTIFICATION_TRIGGER_FEATURE_KEYS: ['expenses']` ([notification.model.ts:134](../../apps/api/src/modules/dashboard-notifications/domain/models/notification.model.ts), [:205](../../apps/api/src/modules/dashboard-notifications/domain/models/notification.model.ts), [:250](../../apps/api/src/modules/dashboard-notifications/domain/models/notification.model.ts)) ไม่ทำจะถูกทิ้งเป็น `feature_not_enabled` หรือ suppress เพราะ preference เก่า (F8); `findSourceBranchId` ([prisma-workflow.repository.ts:172-182](../../apps/api/src/modules/workflow/infrastructure/prisma-workflow.repository.ts)) รู้จัก `expense_budget_alert` ให้ได้สาขาของงบ (F9); `sync-workflow-templates.ts` |
| LINE/AI | tool `expense.get_budget_status` ลงใน `toolMap` และ inject ใน `internal-tools.controller.ts` (ไม่ลงจะได้ `SOURCE_MODULE_NOT_READY` [:565-566](../../apps/api/src/modules/line-ai/presentation/http/internal-tools.controller.ts), F11) และ `READ_MEMORY_TOOLS`; บรรทัดงบในการ์ดอนุมัติ (`line-expense-action.service.ts`) และการ์ดร่างใบเบิก (`line-reimbursement-draft-card.logic.ts`); แก้ B6 และ B7 |
| AI Gateway | router รู้จักคำถามงบ; approved help การ์ด `expense.budget` และ `reimbursement.category_limit` (เพิ่ม version และ contentHash) |
| W00 manifest | tool ใหม่ใน family `expenses` แล้ว regenerate hash |
| Whole-chain catalog | scenario `budget-status-question` (read only, zero mutation) และเพิ่ม spec ที่เกี่ยวในชุด `reliability-api-v2` |
| Billing/entitlement | ไม่มี feature key ใหม่; pack ใหม่ใต้ `expenses`; ทุก tier |
| Employee access | permission ใหม่ + pack ใหม่บนหน้าบทบาท (ชื่อและคำอธิบายไทย) |
| Export | ไม่เปลี่ยนไฟล์ส่งออก แต่หมวดของรายจ่ายจากใบเบิกจะมีค่าใน Excel ที่ส่งนักบัญชีหลัง Phase 0 (ผลดี และต้องตรวจว่าคอลัมน์หมวดแสดงชื่อ ไม่ใช่ id) |
| Evidence screen | คำเตือน "ยังไม่จัดหมวด" ของรายจ่ายจากใบเบิกหายไปหลัง Phase 0 และ backfill |
| User guide | `reimbursement-guide.content.ts:271` ที่บอกห้าหมวดต้องแก้; คู่มือค่าใช้จ่ายเพิ่มหัวข้องบ |
| Browser journeys | `e2e/journeys/budget-warns-before-overspend.journey.spec.ts` (ใหม่); ปรับ `claim-declined-then-paid.journey.spec.ts` ให้เลือกหมวดของร้าน |
| Seed | งบตัวอย่าง 2 ใบ (สาขา และหมวด) และวงเงินต่อใบ 1 หมวดใน `seed-plain-shop.ts`; หมวดของบรรทัดใบเบิกใน `seed-expenses.ts` |

## 12. Gaps

- G1 รายจ่ายหลายหมวดในเอกสารเดียวนับทั้งเอกสารเข้าหมวดระดับเอกสาร ทั้งที่การลงบัญชีแยกตามบรรทัด ([expense-account-binding.logic.ts:29-46](../../apps/api/src/modules/ledger/domain/logic/expense-account-binding.logic.ts)) แต่ตัวเลขจะตรงกับการแยกหมวดใน LINE วันนี้
- G2 ตัวเลข "ค่าใช้จ่ายเดือนนี้" ใน LINE นับทุกสถานะยกเว้นปฏิเสธและยกเลิก ส่วนงบนับเฉพาะยืนยันแล้ว ความต่างจากการเลือกสถานะเป็นความตั้งใจ และคำตอบเรื่องงบต้องบอก N1 แต่ความต่างจากการนับไฟล์ต้นทางซ้ำเป็นบั๊ก (B7) ต้องแก้ใน Phase 0
- G3 ยังไม่มีแท็กโครงการ เบี้ยเลี้ยง หรือค่ารถต่อกิโลเมตร (§3.1)
- G4 เตือนช้าได้ถึง 15 นาที ตามรอบ scan ([workflow-worker.ts:19](../../apps/workers/src/modules/workflow/workflow-worker.ts)) ส่วนตัวเลขบนการ์ดอนุมัติเป็นตัวเลขสด
- G5 งบยังไม่รวมเงินทดรองที่จ่ายออกแต่ยังไม่เคลียร์
- G6 ตั้งงบผ่าน LINE ไม่ได้
- G7 รายจ่ายทั่วไปที่มีแค่ `accountHintKey` แต่ไม่มีหมวด ไม่ถูกนับในงบหมวด (งบสาขาและงบทั้งร้านยังนับ)

## 13. Bugs found in current code

| # | ที่ | สถานการณ์ที่ล้ม | ความรุนแรง |
|---|---|---|---|
| B1 | รายจ่ายที่สร้างจากใบเบิกไม่มีหมวด: `buildItems` ไม่ใส่หมวด ([materialize-claim-expenses.service.ts:32-97](../../apps/api/src/modules/reimbursements/application/services/materialize-claim-expenses.service.ts)) และ repository สร้างทั้ง record และ line โดยไม่มี `expenseCategoryId` ยกเว้นบรรทัดที่ผูกต้นทาง ([prisma-reimbursement.repository.ts:2331-2386](../../apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts)) | พนักงานเบิกค่าแท็กซี่หมวด "เดินทาง" แล้วอนุมัติ ผลที่เกิด: (1) หน้า "หลักฐานทางบัญชี" ที่ขายอยู่ขึ้นคำเตือน "ยังไม่จัดหมวด" ([evidence-audit.logic.ts:52](../../apps/web/src/features/expenses/evidence-audit.logic.ts), `categoryName` เป็น null [prisma-expense.repository.ts:4859](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) และแก้ไม่ได้ เพราะรายจ่ายยืนยันแล้วและเป็นของใบเบิก (2) LINE แยกหมวดให้เป็น "ไม่ระบุหมวด" ([erp-business-tools.use-case.ts:481](../../apps/api/src/modules/line-ai/application/use-cases/erp-business-tools.use-case.ts)) (3) บริษัทที่ใช้ผัง template ลงบัญชีไม่ได้ ได้ `expense_account_unmapped:no_category` ([expense-account-binding.logic.ts:46-53](../../apps/api/src/modules/ledger/domain/logic/expense-account-binding.logic.ts), [journal.use-case.ts:186-188](../../apps/api/src/modules/ledger/application/use-cases/journal.use-case.ts)) ซึ่งสมุดบัญชียังไม่ขาย | ปานกลาง |
| B2 | หมวดของใบเบิกมีสองชุด: เว็บใช้ key ตายตัวห้าตัว ([ReimbursementCreatePage.tsx:30-36](../../apps/web/src/features/reimbursements/ReimbursementCreatePage.tsx)) LINE ใช้ id ของหมวดร้าน ([line-reimbursement-draft-adapter.service.ts:759-763](../../apps/api/src/modules/line-ai/application/line-reimbursement-draft-adapter.service.ts)) และ `REIMBURSEMENT_MANUAL_CATEGORIES` ใน contracts ([line-reimbursement-draft.ts:5-11](../../packages/contracts/src/line-reimbursement-draft.ts)) ไม่มีที่ใดใช้ | ใบที่ทำใน LINE ด้วยหมวด "ค่าเดินทางและยานพาหนะ" กับใบที่ทำบนเว็บด้วยหมวด "เดินทาง" รวมกลุ่มกันไม่ได้ เปิดร่างจาก LINE บนเว็บแล้ว dropdown มีตัวเลือกแปลกเพิ่มขึ้นมา ([ReimbursementCreatePage.tsx:653](../../apps/web/src/features/reimbursements/ReimbursementCreatePage.tsx)) คู่มือบอกว่ามีห้าหมวด ([reimbursement-guide.content.ts:271](../../apps/web/src/features/user-guide/reimbursement-guide.content.ts)) ซึ่งไม่จริงสำหรับใบจาก LINE | ต่ำ–ปานกลาง |
| B6 | การแยกหมวดใน LINE หาชื่อหมวดเฉพาะหมวดของบริษัท ([prisma-expense.repository.ts:1504-1506](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) แต่ร้านที่ไม่ได้ bootstrap เลือกหมวดกลาง (`companyId null`) ได้ ([:491-510](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) และ fallback ส่ง id ดิบเป็นชื่อหมวด ([erp-business-tools.use-case.ts:481](../../apps/api/src/modules/line-ai/application/use-cases/erp-business-tools.use-case.ts)) | ร้านเก่าที่ใช้หมวดกลางถาม "ค่าใช้จ่ายเดือนนี้แยกหมวด" model ได้ชื่อหมวดเป็น cuid กรณีนี้ขึ้นกับข้อมูลจริงที่ยังไม่ได้ตรวจ แก้ด้วย `listCategoryNames` ([prisma-expense.repository.ts:3923-3929](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) ซึ่งรวมหมวดกลางและหมวดที่เลิกใช้ ไม่ใช้ `listCategories` เพราะกรองเฉพาะ ACTIVE (:3937) ชื่อหมวดในอดีตจะหาย | ต่ำ |
| B7 | LINE นับรายจ่ายซ้ำ: การอ่านยอดของ AI นับทุกสถานะยกเว้น `REJECTED`/`VOIDED` ([prisma-expense.repository.ts:1353](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) และรายจ่ายต้นทางที่ผูกกับบรรทัดใบเบิกไม่ถูกแตะเมื่อสร้างรายจ่ายจากใบเบิก ([prisma-reimbursement.repository.ts:2408](../../apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts)) | พนักงานทำใบรับรองแทนใบเสร็จแบบสำรองจ่าย 1,000 บาท แล้วสร้างใบเบิกจากใบนั้น เมื่ออนุมัติ รายจ่ายจากใบเบิก 1,000 ยืนยันแล้ว และรายจ่ายต้นทาง 1,000 ยังไม่ถูกตัดออก เจ้าของถาม "ค่าใช้จ่ายเดือนนี้" ได้ 2,000 บาท (รีวิว 2026-10-24 เปิดโค้ดยืนยันแล้ว ยังไม่ได้รันกับข้อมูลจริง) แก้ใน Phase 0.5 ด้วย `replacedLinkedSourceIds(tx, where)` ซึ่งตัดต้นทางเฉพาะเมื่อ projection ที่แทนมันอยู่ในผลของ query เดียวกัน (รอบ 3 F3 blocker §16.1) ก่อนอนุมัติยอดยังเป็น 1,000 และ query ที่กรอง NEEDS_REVIEW หลังอนุมัติก็ยังเห็น 1,000 | ปานกลาง |

## 14. Test plan

ไฟล์ API ทั้งหมดอยู่ในรายการ `apps/api/package.json` แล้ว

| ไฟล์ (มีอยู่แล้ว) | เคส |
|---|---|
| `reimbursement.logic.spec.ts` | floor `CATEGORY_LIMIT` (ต่ำกว่าเกณฑ์ยังต้องอนุมัติ), ยอดต่อหมวดรวมหลายบรรทัด, snapshot ละ field เมื่อว่าง (hash ใบเก่าเท่าเดิม), parser strict: snapshot ใหม่ที่มี `CATEGORY_LIMIT`/`categoryLimitBreaches` ผ่าน, ผิดรูปถูกปฏิเสธ, snapshot เก่าผ่านเหมือนเดิม (F6) |
| `materialize-claim-expenses.service.spec.ts` | หมวดถูกใส่ทั้ง record และ line; บรรทัดผูกต้นทางใช้ classification เดิม |
| `reimbursement-request.use-case.spec.ts` | resolve หมวด key เก่าห้าตัว, id หมวดร้าน; หมวดเลิกใช้หรือ key แปลกถูกปฏิเสธ (`line_category_invalid` ตอนบันทึก, `line_category_unresolved` ตอนส่ง, F2); ส่งใบเกินวงเงินแล้วต้องอนุมัติ; solo อนุมัติเองได้; ต้นทางที่ผูกไม่มีหมวด ได้ L3b แล้วแก้ต้นทางและโหลดใหม่ จึงส่งได้ (รอบ 2 F12); backfill dry-run แยกรายงานยกเว้นและแถวที่ลงบัญชีแล้ว (รอบ 2 F13) |
| `reimbursement-approval.use-case.spec.ts` | `budgetImpact` ส่งเฉพาะผู้ตัดสิน; ผู้อ่านเฉพาะสาขาไม่เห็นงบหมวด |
| `reimbursement.dtos.spec.ts` | DTO วงเงินต่อหมวด |
| `dashboard-notification-correctness.spec.ts` (PostgreSQL จริง) | การนับงบ: ขอบเขตสี่แบบ, ส่วนกลาง (branch null) อยู่ในงบหมวด, สกุลอื่นไม่นับ, ขอบเดือน Asia/Bangkok (31 ต.ค. 23:30 กับ 1 พ.ย. 00:30), รอยืนยันจากใบเบิกที่ยังไม่มีรายจ่าย; ไม่นับรายจ่ายต้นทางซ้ำทั้งก่อนและหลังอนุมัติ (F14); partial unique ขอบเขตซ้ำ; unique ของ alert ต่อระดับต่อเดือน |
| `expense-summary.provider.spec.ts` | การ์ดหน้าแรกเรียงตาม % และไม่แสดงเมื่อไม่มีงบ |
| `workflow-scan.use-case.spec.ts` | candidate งบ: WARN ครั้งเดียว, ข้ามไป FULL, แก้ยอดกลางเดือน, ผู้รับสำรองเป็นเจ้าของ, cooldown 0 ไม่กลืนงบอื่น, แถว alert ที่ยังไม่มีแจ้งเตือนถูกส่งใหม่รอบถัดไป, WARN และ FULL ในชั่วโมงเดียวกันไม่ชนกัน (F12) |
| `notification.logic.spec.ts` / `process-due-deliveries.use-case.spec.ts` / `workflow-action-runner.use-case.spec.ts` | trigger งบอยู่ครบสามทะเบียน, ไม่ถูก suppress เพราะ preference เก่า, `findSourceBranchId('expense_budget_alert')` (F8/F9) |
| `internal-tools.controller.spec.ts` | `expense.get_budget_status` ผ่าน dispatch ไม่ได้ `SOURCE_MODULE_NOT_READY` (F11) |
| `workflow-template.use-case.spec.ts` / `workflow-template-auto-enable.spec.ts` | แม่แบบใหม่ autoEnable |
| `permission-registry.spec.ts` / `capability.logic.spec.ts` / `feature-gate.logic.spec.ts` | key ใหม่อยู่ใน OWNER/ADMIN, pack ใหม่ผูก `expenses` |
| `erp-business-tools.use-case.spec.ts` | `expense.get_budget_status` ขอบเขตและ statusBasis; B6 ใช้ `listCategoryNames` (หมวดกลางและหมวดเลิกใช้ได้ชื่อ) และไม่ส่ง id; B7 ยอดไม่นับรายจ่ายต้นทางซ้ำ |
| รอบ 3: `erp-business-tools.use-case.spec.ts` + `dashboard-notification-correctness.spec.ts` (PG) | F3: ตาราง filter (ไม่มี, NEEDS_REVIEW, CONFIRMED, ผู้ขาย, ผู้สร้าง, หมวด, related scope) × ช่วงของใบเบิก (ร่าง, ส่ง, ตรวจการเงิน, อนุมัติ, ยกเลิก) โดยยอดต้นทาง 1,000 ต้องนับครั้งเดียวในทุกเซลล์ที่ต้นทางหรือ projection ตรง filter |
| รอบ 3: `reimbursement-request.use-case.spec.ts` + `substitute-receipt.use-case.spec.ts` | F2: ต้นทางที่ใบรับรอง ISSUED หมวดเลิกใช้ resolve ได้; มีแค่ hint ก็ map ได้; กรณีที่เหลือได้ L3c และเส้นยกเลิกแล้วสร้างใหม่แล้วโหลดใหม่ ส่งได้ |
| รอบ 3: `reimbursement-request.use-case.spec.ts` + `materialize-claim-expenses.service.spec.ts` | F6: ใบที่ส่งก่อน deploy ได้หมวดจาก script หรือ fallback ตอน materialize และ approval hash เดิมยังใช้ได้ |
| รอบ 3: `process-due-deliveries.use-case.spec.ts` + `workflow-scan.use-case.spec.ts` | F7: ผู้รับที่เสียสิทธิ์อ่านงบไม่ได้รับ ภาระยังค้างจนมีผู้รับที่มีสิทธิ์ F11: `notificationPeriodKey = alert.id` |
| `erp-business-tools.use-case.spec.ts` (เพิ่ม) | ทะเบียน tool: `expense.get_budget_status` อยู่ใน family expenses เป็น read ไม่มี runtime flag (เรียก `lineToolRegistryFor` ของ manifest) และขยาย `line-ai-capability-manifest.spec.ts` ในชุด whole-chain ตามด้วย (เสริม ไม่ใช่ที่เดียว) |
| web (glob) | `expense-budgets.logic.spec.ts` ใหม่ (`budgetScopeLabel` ตามตาราง §10.3, เลือก F1/F2), `ReimbursementCreatePage.qa.spec.ts` (หมวดของร้าน, L1), `DashboardPages.rendered.spec.ts` (การ์ดงบ) |
| browser journey | `e2e/journeys/budget-warns-before-overspend.journey.spec.ts`: เจ้าของตั้งงบค่าเดินทาง 1,000 → พนักงานเบิก 900 (การ์ดอนุมัติแสดง 90%) → อนุมัติ → แจ้งเตือน WARN ถึงเจ้าของ → เบิกอีก 200 → FULL "เกินงบ … 100.00 บาท" ที่ 390, 1,280 และ ~1,556 px |
| backfill | dry-run กับฐานข้อมูลทดสอบที่ seed: นับแถวที่จะใส่หมวด, แถวที่ข้ามเพราะลงบัญชีแล้ว |

## 15. Acceptance criteria

| # | Scenario | ผลที่ต้องได้ |
|---|---|---|
| AC1 | เบิกค่าแท็กซี่บนเว็บโดยเลือก "ค่าเดินทางและยานพาหนะ" แล้วอนุมัติ | รายจ่ายมีหมวดนั้น หน้าหลักฐานไม่ขึ้น "ยังไม่จัดหมวด" และ LINE แยกหมวดถูก |
| AC2 | ใบเบิกเก่าที่ใช้ key `travel` ถูกส่งหลัง deploy | resolve เป็นหมวด `expense.travel` ของร้าน |
| AC3 | Backfill | แถวที่ resolve ได้ได้หมวด แถวที่ resolve ไม่ได้อยู่ในรายงานยกเว้นและไม่ถูกแตะ แถวที่ลงบัญชีแล้วถูกรายงานแยกและไม่ถูกแก้ ส่วนการใช้ไฟล์ map ที่ตรวจแล้วใส่หมวดให้แถวยกเว้นพร้อม audit |
| AC4 | วงเงินค่าอาหาร 500 ต่อใบ เกณฑ์อนุมัติของร้าน 1,000 ส่งใบค่าอาหาร 650 | ใบไป PENDING_APPROVAL ผู้อนุมัติเห็น L2 "…500 บาท (ใบนี้ 650 บาท)" ผู้เบิกเห็น L1 ตอนกรอก |
| AC5 | ตั้งงบสาขา A 10,000 แล้วยืนยันรายจ่ายรวม 8,000 ในเดือน | ภายใน 15 นาที ผู้รับผิดชอบได้ W1 "…ใช้ไป 80% แล้ว" หนึ่งครั้ง ยืนยันเพิ่มอีก 100 ไม่ได้รับซ้ำ |
| AC6 | ยืนยันจนรวม 10,250 | ได้ F2 "เกินงบสาขาA เดือนนี้ 250.00 บาท" หนึ่งครั้ง |
| AC7 | ข้ามจาก 70% ไป 105% ในรอบ scan เดียว | ส่งเฉพาะ FULL และเดือนนั้นไม่ส่ง WARN อีก |
| AC8 | ตั้งงบซ้ำขอบเขตเดิม (สองแท็บพร้อมกัน) | สำเร็จหนึ่ง อีกหนึ่งได้ 409 พร้อมปุ่ม [แก้งบเดิม] |
| AC9 | ผู้จัดการสาขา B (อ่านเฉพาะสาขา) เปิดหน้างบ | เห็นเฉพาะงบสาขา B ไม่เห็นงบหมวดทั้งร้าน |
| AC10 | ผู้รับผิดชอบงบถูกปิดบัญชีแล้วงบถึงเกณฑ์ | เจ้าของได้แจ้งเตือนแทน และคนอื่นไม่ได้ |
| AC11 | LINE "งบเดือนนี้เหลือเท่าไร" | การ์ดตามงบที่ผู้ถามเห็นได้ มี N1 ไม่ถามกลับเมื่อไม่จำเป็น และไม่มีการเขียนข้อมูล |
| AC12 | การ์ดอนุมัติใบเบิก 900 ที่จะทำให้งบเดินทางจาก 60% เป็น 150% ทั้งในร้านที่เปิดและปิดตรวจการเงิน | บรรทัด "งบค่าเดินทางและยานพาหนะเดือนนี้ใช้ไป 60% · เมื่อยืนยันรายจ่ายของใบนี้ จะใช้ไป 150%" ปุ่มอนุมัติยังกดได้ |
| AC15 | บันทึกร่างใบเบิกด้วย `categoryKey` ที่ระบบไม่รู้จัก หรือส่งใบที่หมวด resolve ไม่ได้ | 400 `line_category_invalid` หรือ L3 พร้อมช่องให้เลือกหมวด และใบที่ต่ำกว่าเกณฑ์อนุมัติเลี่ยงวงเงินด้วยวิธีนี้ไม่ได้ |
| AC16 | ใบรับรองสำรองจ่าย 1,000 แล้วสร้างใบเบิก ส่ง และอนุมัติ | ระหว่างรออนุมัติและตรวจการเงิน LINE ได้ 1,000 และงบรอยืนยัน 1,000 หลังอนุมัติ LINE ได้ 1,000 ไม่ใช่ 2,000 และงบใช้แล้ว 1,000 ไม่มีช่วงไหนเป็น 0 หรือ 2,000 |
| AC18 | ต้นทางที่ผูกไม่มีหมวด แล้วส่งใบเบิก | L3b พร้อมลิงก์ไปต้นทาง แก้หมวดแล้วโหลดต้นทางใหม่ ส่งได้ |
| AC19 | แถว alert ของ 31 ต.ค. ที่ค้างส่ง ถูกส่งตอน 1 พ.ย. | ข้อความระบุ "ต.ค. 2569" และยอดที่ตรึงไว้ |
| AC20 | (F3) ถาม LINE "รายจ่ายรอตรวจเดือนนี้" หลังใบเบิกที่ผูกต้นทาง NEEDS_REVIEW 1,000 ถูกอนุมัติ | ได้ 1,000 (ต้นทางตรง filter แต่ projection ไม่ตรง) |
| AC21 | (F2) ใบเบิกผูกใบรับรอง ISSUED ที่หมวดเลิกใช้ | ส่งได้ด้วยหมวดเดิม ไม่ต้องแก้ใบรับรอง |
| AC22 | (F7) ผู้รับผิดชอบงบถูกถอดสิทธิ์อ่านรายจ่ายหลังแถว alert ถูกสร้าง | ไม่ได้รับตัวเลข เจ้าของที่อ่านได้รับแทน |
| AC23 | (F3 ใหม่) ใบรับรองสำรองจ่าย 1,000 (ต้นทาง NEEDS_REVIEW) → ใบเบิกอนุมัติ | งบ: ใช้แล้ว 1,000 รอยืนยัน 0 |
| AC24 | (F4) ต้นทางมีแค่ hint `expense.travel` → ใบเบิกอนุมัติ | projection มีหมวด "ค่าเดินทางและยานพาหนะ" และงบค่าเดินทางนับ 1,000 ใบรับรองและต้นทางไม่เปลี่ยน |
| AC25 | (F2) ต้นทางเป็นใบรับรอง (ปกติหรือใบแก้ไข) ที่ ISSUED หมวดไม่ชัด | L3c → เอกสารแก้ไขแบบแก้หมวด → ลงนาม/อนุมัติ → ISSUED → โหลดต้นทางใหม่ → ส่งได้ หมวดใน snapshot ที่ลงนามตรงกับหมวดของบรรทัด และ snapshot ของใบเดิมไม่เปลี่ยน |
| AC26 | (F2) ต้นทางที่หมวดของรายจ่ายไม่ตรงกับหมวดใน snapshot ที่ลงนาม | ปฏิเสธด้วย `reimbursement_source_classification_mismatch` และแสดง L3c |
| AC27 | (F2) เตรียมเอกสารแก้ไขแบบแก้หมวด A→B แล้วยกเลิก | หมวดของรายจ่ายต้นทางยังเป็น A ไม่มีงบย้าย |
| AC28 | (F2) พยายามแก้หมวดของรายจ่ายที่ยืนยันแล้วด้วยเอกสารแก้ไข | ปฏิเสธตอนเตรียม |
| AC17 | ระบบล้มหลังเพิ่มแถว alert ก่อนสร้างแจ้งเตือน | รอบ scan ถัดไปส่งแจ้งเตือนหนึ่งครั้ง |
| AC13 | ร้านไม่ได้ตั้งงบเลย | ไม่มีการ์ดงบบนหน้าแรก ไม่มีบรรทัดงบบนการ์ดอนุมัติ |
| AC14 | หน้างบ dialog การ์ดหน้าแรก และฟอร์มใบเบิกที่เปลี่ยน | มีภาพจาก browser จริงที่ 390, 1,280 และ ~1,556 px กลุ่มปุ่มวัดแล้วว่าเท่ากัน ปุ่มของฟอร์มอยู่แถบล่าง และหน้าเต็มความกว้างจอ |

## 16. Risks/rollout

- Phase 0 เปลี่ยนสิ่งที่พนักงานเห็นในฟอร์มใบเบิก จากห้าหมวดเป็นหมวดของร้าน (ราว 12 หมวด) ความเสี่ยงคือพนักงานเลือกหมวดผิด เช่น ค่ารับรองกับค่าอาหาร
  - ลดด้วยคำแนะนำหมวดจากคำบรรยาย (`suggestReimbursementCategory` ปรับให้คืน id ของหมวดร้าน)
  - ผู้ตรวจยังเห็นหมวดบนการ์ดอนุมัติ
- Backfill แตะรายจ่ายที่ยืนยันแล้ว ให้ dry-run และรายงานจำนวนก่อน แล้วรันใน release ตามขั้นตอนของ runbook ต้องไม่รันกับแถวที่ `postingStatus = 'posted'`
- query งบรันใน scan ทุก 15 นาทีต่อบริษัทที่มีงบ ใช้ index เดิม แต่ต้องวัดเวลากับบริษัทที่ข้อมูลมากที่สุดใน UAT
- ไม่ต้องมี flag Phase 0 deploy ก่อนได้ เพราะไม่ขึ้นกับตารางงบ ส่วน Phase 1–3 deploy ตามกัน
- การ์ดบนหน้าแรกต่างจากภาพที่เจ้าของวาดไว้ (Figma HOME-01) จึงเป็นการออกแบบที่เจ้าของมอบหมาย ให้แสดงบน local stack ก่อนรวมงาน

### 16.1 Must close before coding

#### Blockers หลังการตรวจ blocker แบบเจาะจง (2026-10-24)

รีวิวเต็มครบสามรอบแล้ว และตรวจ blocker แบบเจาะจงอีกหนึ่งครั้ง ผลล่าสุด (การตรวจเจาะจงครั้งสุดท้าย 2026-10-24): F1, F3 และ F4 ปิดแล้ว F2 ออกแบบแล้วแต่ยังไม่มีใครรีวิว และต้องรีวิวก่อนเริ่ม Phase 0.3 ส่วน Phase 0.1–0.2 เริ่มได้ Phase 3 ของ cash-advance plan รอ Phase 0.3 นี้

| # | สถานะ | Scenario ที่ล้ม | การแก้ที่ออกแบบไว้ (ล่าสุด) | Review gate |
|---|---|---|---|---|
| F1 | **ปิดแล้ว** (ตรวจ blocker 2026-10-24) | gateway ปฏิเสธ `ADVANCE_*` | cash-advance spec §7 | — |
| F2 | **ออกแบบแล้ว ต้องรีวิวก่อน budget Phase 0.3** | รอบก่อน: แก้หมวดของต้นทางตั้งแต่เตรียมเอกสารแก้ไข และการยกเลิก (`prisma-expense.repository.ts:2105`, `:2715`) ไม่คืนค่า หมวด A→B ของรายจ่ายที่ยืนยันแล้วจึงอยู่ต่อโดยไม่มีลายเซ็นใหม่ และย้ายงบใช้แล้ว | §5.3: พักหมวดใหม่ไว้ที่เอกสารแก้ไข และเขียนลงต้นทางเฉพาะใน tx ที่ออกใบ (CAS) ยกเลิกแล้วทิ้งค่าที่พัก คงการป้องกันของรายจ่ายที่ยืนยันแล้ว ลงบัญชีแล้ว และผูกใบเบิกที่ส่งแล้ว + ตรวจความตรงกันใน `readReimbursementSource` | test gate (plan 0.3): หมวดใน snapshot ที่ลงนาม = หมวดของบรรทัด; **เตรียม → ยกเลิก แล้วหมวดของต้นทางยังเป็น A**; รายจ่ายที่ยืนยันแล้ว ลงบัญชีแล้ว หรือผูกใบเบิกที่ส่งแล้วถูกปฏิเสธตอนเตรียม; หมวดเปลี่ยนระหว่างทางแล้วการออกใบล้ม |
| F3 | **ปิดแล้ว** (ตรวจซ้ำ 2026-10-24) | งบนับซ้ำระหว่างใช้แล้วกับรอยืนยัน | §5.1 ตัดกับประชากรรวมก่อนแยกถัง | — |
| F4 | **ปิดแล้ว** (ตรวจซ้ำ 2026-10-24) | projection ของต้นทางที่มีแค่ hint ไม่มีหมวด | §5.3 F4 | — |

## 17. Open questions (เรื่องธุรกิจของเจ้าของ)

| # | คำถาม | คำแนะนำ |
|---|---|---|
| Q1 | เกินงบรายเดือนแล้วให้ห้ามบันทึกหรือห้ามจ่ายไหม | ไม่ห้าม ให้เตือนผู้รับผิดชอบและแสดงบนการ์ดอนุมัติ ร้านเล็กต้องจ่ายค่าของที่จำเป็นได้ |
| Q2 | ใบเบิกที่เกินวงเงินต่อใบของหมวด ให้ส่งได้แต่ต้องอนุมัติ หรือห้ามส่ง | ส่งได้แต่ต้องอนุมัติทุกใบ ผู้อนุมัติเห็นว่าเกินเท่าไร |
| Q3 | ใครควรได้แจ้งเตือนงบ | ผู้รับผิดชอบที่เลือกตอนตั้งงบ (ค่าเริ่มต้นคือคนตั้ง) ถ้าคนนั้นทำไม่ได้ ส่งให้เจ้าของ |
| Q4 | ลูกค้าต้องการแยกงบตามงานหรือโครงการไหม | ยังไม่ทำในรอบแรก กลับมาดูเมื่อมีลูกค้าขอ (§3.1) |
