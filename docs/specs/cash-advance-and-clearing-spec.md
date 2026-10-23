# Cash Advance and Clearing Spec — เงินทดรองจ่าย: ขอ → อนุมัติ → จ่าย → ยืนยันรับเงิน → เคลียร์ → คืนส่วนเกิน/จ่ายส่วนขาด

Status: READY (docs-first) — reviewed 3 rounds + focused blocker check 2026-10-24, no HIGH open; see Must close before coding (Phase 3 waits for budget Phase 0.3)
Owner: Expense/Reimbursement lane
Related: backlog ข้อ 9 ใน `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md`, `docs/specs/reimbursement-approval-spec.md` (§3 บรรทัด 48, §22 บรรทัด 985), `docs/specs/reimbursement-step-journey-spec-th.md`, `docs/specs/reimbursement-payout-account-and-payment-slip-spec-th.md`, `docs/specs/reimbursement-multi-payout-accounts-spec-th.md`, `docs/specs/reimbursement-approver-routing-policy-spec.md`, `docs/specs/line-claim-submit-z-20261019.md`, `docs/specs/expense-budget-and-limits-spec.md` (Phase 0 หมวดของใบเบิก และ B7 ยอดซ้ำใน LINE), `docs/plans/cash-advance-and-clearing-plan.md`, `docs/agent-memory/cash-advance-and-budgets.md`
Baseline: main 6c54ba208 (2026-10-23)

## 1. ปัญหา

ร้านที่ให้เงินพนักงานไปก่อน (ไปตลาด ออกบูธ เดินทาง) ทำในระบบไม่ได้เลย ต้องจดนอกระบบ ไม่มีบันทึกว่าใครถือเงินบริษัทอยู่เท่าไร ไม่มีการเคลียร์ และไม่มีการเตือน

### 1.1 สิ่งที่ยังไม่มี

- ไม่มีแบบจำลองข้อมูลเงินทดรอง: schema มีแต่ `ReimbursementRequest` ([schema.prisma:7320](../../apps/api/prisma/schema.prisma)) ซึ่งเป็นเงินที่พนักงานสำรองจ่ายไปก่อนแล้วบริษัทคืนทีหลัง ค้นคำว่า "ทดรอง" ในโค้ดเจอแค่คำบรรยายบรรทัดบัญชีหนึ่งบรรทัด ([posting-engine.logic.ts:194](../../apps/api/src/modules/ledger/domain/logic/posting-engine.logic.ts))
- สเปกใบเบิกตัดเรื่องนี้ออกไว้: "employee advance" เป็น non-goal ([reimbursement-approval-spec.md:48](../specs/reimbursement-approval-spec.md)) และ "Cash advance and travel advance settlement" อยู่ใน backlog ([:985](../specs/reimbursement-approval-spec.md))
- ผังบัญชี TH SME มี `1152-00 เงินทดลองจ่ายพนักงาน` อยู่แล้ว ([th-sme-chart-of-accounts-v1.ts:54](../../apps/api/src/modules/ledger/domain/catalog/th-sme-chart-of-accounts-v1.ts)) แต่ไม่มีโค้ดใดลงบัญชีนี้
- ทางที่มีวันนี้ไม่ตรงกับการให้เงินก่อนทั้งสองทาง:
  - ใบเบิกตรึงยอดค้างจ่าย = ยอดใบตอนส่ง ([reimbursement-request.use-case.ts:767](../../apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.ts)) จ่ายเต็มจำนวนครั้งเดียว ([reimbursement.logic.ts:842-867](../../apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic.ts)) และคิดสถานะจ่ายจาก `request.amount` ([prisma-reimbursement.repository.ts:3765-3767](../../apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts), [:4282-4286](../../apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts))
  - ใบสำคัญจ่ายผูกกับรายจ่าย ([schema.prisma:2884-2899](../../apps/api/prisma/schema.prisma)) รับเฉพาะรายจ่ายที่ยืนยันแล้ว ([disbursement-voucher.use-case.ts:835](../../apps/api/src/modules/expenses/application/use-cases/disbursement-voucher.use-case.ts)) และปฏิเสธรายจ่ายที่มาจากใบเบิก ([:831](../../apps/api/src/modules/expenses/application/use-cases/disbursement-voucher.use-case.ts))

### 1.2 เครื่องของใบเบิกที่นำมาใช้ซ้ำ

- นโยบายเดียวทั้งบริษัท (`findPolicy(companyId, null)` [reimbursement-request.use-case.ts:623](../../apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.ts))
- ผู้อนุมัติเป็นบทบาท ใครคนหนึ่งตัดสินได้ ([schema.prisma:7301-7302](../../apps/api/prisma/schema.prisma), [reimbursement-policy.use-case.ts:219-271](../../apps/api/src/modules/reimbursements/application/use-cases/reimbursement-policy.use-case.ts)) อนุมัติขั้นเดียว ([reimbursement-request.use-case.ts:744](../../apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.ts)) และ `DIRECT_MANAGER` ไม่มีโค้ดใช้ ([schema.prisma:7244-7250](../../apps/api/prisma/schema.prisma))
- ร้านคนเดียวอนุมัติเองได้ และระบบตรึงข้อนี้ไว้ตอนส่ง ([reimbursement-policy.use-case.ts:256-262](../../apps/api/src/modules/reimbursements/application/use-cases/reimbursement-policy.use-case.ts))
- รายจ่ายที่สร้างจากใบเบิกเป็น `NO_VAT` / `NON_CLAIMABLE` ([materialize-claim-expenses.service.ts:49-63](../../apps/api/src/modules/reimbursements/application/services/materialize-claim-expenses.service.ts)) และเมื่อจ่ายครบจะ mirror เป็นจ่ายแล้ว ([prisma-reimbursement.repository.ts:3786-3807](../../apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts))
- บัญชีรับเงินถูกตรึงแบบเข้ารหัส และแสดงเลขเต็มเฉพาะกลุ่มที่กำหนด ([reimbursement-payout-reveal.use-case.ts:9-17](../../apps/api/src/modules/reimbursements/application/use-cases/reimbursement-payout-reveal.use-case.ts)) ใบสำคัญจ่ายเก็บบัญชีผู้รับในแถวของตัวเอง และมี `selfApproved` ([schema.prisma:2799](../../apps/api/prisma/schema.prisma), [:2815](../../apps/api/prisma/schema.prisma))

### 1.3 ข้อเท็จจริงที่บังคับการออกแบบ (ยืนยันจากรีวิว 2026-10-24)

- **สลิปเป็นไฟล์ลับ** ระบบป้องกันสองชั้น
  - ด้วย tag: `generatedFor = reimbursement_payment_slip` ทำให้ดาวน์โหลดผ่านทางทั่วไปไม่ได้ ([create-download-url.use-case.ts:88-100](../../apps/api/src/modules/data-model-core/application/use-cases/create-download-url.use-case.ts)) ไม่ขึ้นในรายการไฟล์ ([prisma-attachment.repository.ts:32-40](../../apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-attachment.repository.ts)) และใช้เป็นใบเสร็จไม่ได้ ([attachment.logic.ts:133-151](../../apps/api/src/modules/data-model-core/domain/logic/attachment.logic.ts))
  - ด้วย link: `reimbursement_payment` + purpose สลิป ทำให้ลบไม่ได้ ([delete-attachment.use-case.ts:54-56](../../apps/api/src/modules/data-model-core/application/use-cases/delete-attachment.use-case.ts), [prisma-attachment.repository.ts:104-115](../../apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-attachment.repository.ts))
  - การอัปโหลดสลิปทำได้เฉพาะผู้ถือ `reimbursement.payment.record` และผูกกับใบเบิก (`findRequestById`) ([reimbursement-payment-slip.use-case.ts:46-51](../../apps/api/src/modules/reimbursements/application/use-cases/reimbursement-payment-slip.use-case.ts)) เงินทดรองจึงใช้ use-case นี้ตรง ๆ ไม่ได้
- **ใบเบิกที่จ่ายแล้วยกเลิกไม่ได้** การยกเลิกปฏิเสธใบที่ `paymentStatus = PAID` ([prisma-reimbursement.repository.ts:1266-1270](../../apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts)) ใบเคลียร์ที่หักกลบครบ (จ่ายแล้วโดยไม่มีแถว payment) ต้องมีทางย้อนของตัวเอง (§5.8)
- **ใบรับรองแทนใบเสร็จ** ให้เลือกแหล่งเงินระหว่าง "เงินของร้าน" (`COMPANY`) กับ "เงินส่วนตัวของพนักงาน" (`PERSONAL_ADVANCE`) ([SubstituteReceiptWizardPage.tsx:2022-2027](../../apps/web/src/features/expenses/SubstituteReceiptWizardPage.tsx)) แต่บรรทัดใบเบิกรับเฉพาะ `PERSONAL_ADVANCE` ([reimbursement-source.ts:27](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts)) และรับเฉพาะรายจ่ายที่ยังไม่ยืนยัน ไม่มีหัก ณ ที่จ่าย และภาษีตรวจแล้ว ([:23](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts), [:39-41](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts))
- **ไฟล์ต้นทางของใบเบิกไม่ถูกแตะ** เมื่อระบบสร้างรายจ่ายใหม่จากใบเบิก ([prisma-reimbursement.repository.ts:2408](../../apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts)) ยอดใน LINE จึงนับซ้ำ (budget spec B7)
- **แจ้งเตือนต้องลงทะเบียน trigger** มิฉะนั้นถูกทิ้ง
  - ownership ([notification.model.ts:250](../../apps/api/src/modules/dashboard-notifications/domain/models/notification.model.ts), [notification.use-cases.ts:241-243](../../apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts))
  - รายการ trigger ที่ทำแล้วและที่ต้องส่งเสมอ ([notification.model.ts:134](../../apps/api/src/modules/dashboard-notifications/domain/models/notification.model.ts), [:205](../../apps/api/src/modules/dashboard-notifications/domain/models/notification.model.ts), [notification.use-cases.ts:370-372](../../apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts))
  - workflow รู้สาขาของต้นทางเฉพาะใบเบิกและบิลผู้ขาย ([prisma-workflow.repository.ts:172-182](../../apps/api/src/modules/workflow/infrastructure/prisma-workflow.repository.ts)) ต้นทางอื่นถือเป็นทั้งบริษัท ([branch.logic.ts:69-74](../../apps/api/src/modules/data-model-core/domain/logic/branch.logic.ts))
- **ร่างใบเบิกใน LINE ยังผูกกับ env flag**
  - `LINE_AI_REIMBURSEMENT_DRAFT_WRITE_ENABLED` ([packages/config/src/index.ts:34](../../packages/config/src/index.ts)) ถูกอ่านในทะเบียน tool ([ai-tools.ts:37-42](../../packages/contracts/src/ai-tools.ts)) และในการรับ tool ([internal-tools.controller.ts:670-672](../../apps/api/src/modules/line-ai/presentation/http/internal-tools.controller.ts)) ซึ่งขัดกติกาไม่มีสวิตช์
  - tool ใหม่ต้องลงใน `toolMap` ([internal-tools.controller.ts:565-566](../../apps/api/src/modules/line-ai/presentation/http/internal-tools.controller.ts)) และผ่านการตรวจ ACTION source ของ gateway ([erp-tool.client.ts:121-125](../../apps/ai-gateway/src/modules/line-ai/infrastructure/erp-tool.client.ts))
  - การต่อคำถามด้วย read tool ต้องลงใน `READ_MEMORY_TOOLS` ([line-read-evidence.service.ts:58-65](../../apps/api/src/modules/line-ai/application/line-read-evidence.service.ts), [:140](../../apps/api/src/modules/line-ai/application/line-read-evidence.service.ts))
- **ปุ่มเปิดการอนุมัติในแจ้งเตือนไม่มีวันหมดอายุ** token ของปุ่มเป็น HMAC ที่ไม่มีเวลาอยู่ข้างใน ([line-reimbursement-approval-control.logic.ts:5-11](../../apps/api/src/modules/line-ai/domain/logic/line-reimbursement-approval-control.logic.ts)) การเขียนจริงไปเกิดที่การ์ดยืนยันที่ตรวจสถานะซ้ำ
- **Runoff ไม่เก็บสิทธิ์สร้างหรือส่ง** ([feature-gate.logic.ts:80-95](../../apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts)) การสร้างและส่งใบเบิกจึงตรวจสิทธิ์ ([reimbursement-request.use-case.ts:146](../../apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.ts), [:604](../../apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.ts)) ส่วนครอบครัวรายงานมีแบบอย่างของการเก็บสิทธิ์แล้วตรวจต่อใน use-case ([feature-gate.logic.ts:68-79](../../apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts))
- **รอบ 2: ใบรับรองแบบเงินของร้านจ่ายรายจ่ายให้เองตอนออกใบ** ถ้ายังไม่มีการจ่าย การออกใบสร้าง `ExpensePayment` และตั้งรายจ่ายเป็น PAID ทันที ([prisma-expense.repository.ts:3081-3112](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) ทาง B จึงต้องผูกเงินทดรองที่จุดนี้ ไม่ใช่จ่ายซ้ำทีหลัง
- **รอบ 2: การยกเลิกใบเบิกที่อนุมัติแล้ว** void รายจ่ายทีละรายการแล้วจึงปิดใบ ([reimbursement-request.use-case.ts:1218-1235](../../apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.ts)) และถอนการยกเลิกได้จนกว่าจะมีรายจ่ายถูก void ([prisma-reimbursement.repository.ts:1443-1450](../../apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts))
- **รอบ 2: `ReimbursementDraftAction` รับเฉพาะใบเบิก** CHECK `operation IN ('CREATE','UPDATE')`, สถานะ APPLIED ต้องมี `requestId` และ FK ไปที่ `ReimbursementRequest` ([migration 20260927140000_line_reimbursement_draft_action:35, :52-54, :66](../../apps/api/prisma/migrations/20260927140000_line_reimbursement_draft_action/migration.sql))
- **รอบ 2: ร่างใบเบิกใน LINE ใช้การตรวจด้วย prefix `reimbursement.draft.`** ทั้งการตรวจหลักฐาน ACTION ([line-read-evidence.service.ts:437](../../apps/api/src/modules/line-ai/application/line-read-evidence.service.ts)), การโหลดการ์ดยืนยัน ([process-line-webhook.use-case.ts:8855](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts)) และใน gateway ([semantic-turn-v2.ts:712-714](../../apps/ai-gateway/src/modules/line-ai/agents/semantic-turn-v2.ts), [reimbursement-draft-input.ts:86](../../apps/ai-gateway/src/modules/line-ai/agents/reimbursement-draft-input.ts))
- **รอบ 2: แจ้งเตือนที่ต้องทำงานจะปิดเองตามสถานะของเอกสาร** ผ่าน `DOCUMENT_NOTIFICATION_STATES` และรองรับเฉพาะใบสำคัญจ่ายกับใบเบิก ([document-notification-state.ts:16-38](../../apps/api/src/modules/dashboard-notifications/infrastructure/document-notification-state.ts), [:115](../../apps/api/src/modules/dashboard-notifications/infrastructure/document-notification-state.ts))
- **รอบ 2: ยกเลิกการจ่ายรายจ่ายใช้สิทธิ์ `expense.payment.record`** ([expense-draft.use-case.ts:2063](../../apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts)) ไม่มี `expense.payment.void`
- **การย้อนบัญชีของใบเบิกรู้จักแค่ `reimbursement.payment`** ([prisma-reimbursement.repository.ts:4145-4170](../../apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts)) การปิดงวดตรวจรายการค้างลงบัญชีตามรายชื่อต้นทาง ([period.use-case.ts:132-170](../../apps/api/src/modules/ledger/application/use-cases/period.use-case.ts))

## 2. เป้าหมาย

1. ขอเงินทดรองได้ทั้งเว็บและ LINE: บอกยอดและใช้ทำอะไร แล้วส่งขออนุมัติ
2. อนุมัติใช้เส้นทางของใบเบิก รวมทั้งร้านคนเดียวที่อนุมัติเอง
3. ผู้มีสิทธิ์จ่ายบันทึกจ่ายพร้อมสลิป ผู้ขอกด "ได้รับเงินแล้ว" (หรือ "ยังไม่ได้รับ") หลังบันทึกจ่าย เรียงเป็น ส่ง → อนุมัติ → จ่าย → ยืนยันหรือเซ็นรับ
4. เคลียร์ได้สองทาง และใช้ร่วมกันได้:
   - **ทาง A** ใบเสร็จทั่วไป ถ่ายรูปส่งใน LINE ได้: ใบเคลียร์คือใบเบิกที่ผูกกับเงินทดรอง
   - **ทาง B** บิลของบริษัทที่มีภาษีซื้อ หัก ณ ที่จ่าย หรือใบรับรองแทนใบเสร็จแบบ "เงินของร้าน": บันทึกเป็นรายจ่ายของร้านตามปกติครั้งเดียว แล้ว "จ่ายจากเงินทดรอง" ไม่มีรายจ่ายซ้ำ
5. ส่วนต่างปิดได้ทุกกรณี: ใช้พอดี, คืนส่วนเกิน, บริษัทจ่ายส่วนขาด และไม่ได้ใช้จึงคืนทั้งหมด การเคลียร์ที่ผิดย้อนได้ (§5.8)
6. เห็นว่าใครถือเงินบริษัทอยู่เท่าไรและเลยกำหนดหรือยัง เตือนผู้ถือเงินก่อนถึงวันและเมื่อเลยกำหนด
7. ทุกแพ็กที่ขายใช้ได้ (`reimbursement` อยู่ใน starter) ไม่มีสวิตช์ใหม่ และถอด env flag ของร่างใบเบิกใน LINE ที่เส้นทางนี้ต้องใช้ออกในงานนี้ (§11, plan Phase 5.0)

## 3. Non-goals

- เงินสดย่อย (imprest) ซึ่งเป็นวงเงินคงที่และเติมเงิน ([FlowAccount](https://flowaccount.com/blog/petty-cash-advanced-payment/), [PEAK เงินสดย่อย](https://intercom.help/peak/en/articles/13165510-การบันทึก-เงินสดย-อย-ใน-peak))
- เบี้ยเลี้ยงรายวันและค่ารถต่อกิโลเมตร (budget spec §3.1) แต่คำขอเงินทดรองเก็บจุดประสงค์ ช่วงวันที่ และการอนุมัติในระบบไว้ ซึ่งรอบถัดไปจะใช้เป็นหลักฐานการอนุมัติการเดินทางได้
- อนุมัติยอดน้อยกว่าที่ขอ จ่ายเป็นงวด และสกุลเงินอื่นนอกจากสกุลหลักของบริษัท
- ใบเคลียร์ (ทาง A) หลายใบต่อเงินทดรองหนึ่งใบ รอบนี้มีใบที่ยังไม่ยกเลิกได้หนึ่งใบ แต่ทาง B ใช้ได้หลายรายการ
- จ่ายเงินทดรองเข้าบัญชีของคนอื่น
- ตัดเงินทดรองที่ไม่เคลียร์เป็นเงินได้พนักงาน หรือหักเงินเดือนอัตโนมัติ (บันทึกคืนด้วยวิธี `OTHER` พร้อมอ้างอิงได้)
- จ่ายใบสำคัญจ่าย (disbursement voucher) จากเงินทดรอง (G1) และทาง B ผ่าน LINE (G2) ทาง B รอบนี้ทำบนเว็บเท่านั้น
- จับคู่รายการเดินบัญชี (bank reconciliation ยังไม่ได้ขาย) แต่การจ่ายด้วยเงินทดรองต้องไม่ถูกเสนอให้จับคู่ (§11)
- นับเงินทดรองที่ยังไม่เคลียร์ในงบ (budget spec §3)

## 4. ผู้ใช้และ journey

| บทบาท | เว็บ | LINE |
|---|---|---|
| ผู้ขอ (ทุกบทบาทของร้าน ใช้สิทธิ์ใบเบิกของตัวเอง) | การเบิกจ่าย → เพิ่มเติม → "ขอเงินทดรอง" → กรอก → ส่งขออนุมัติ → เมื่อบันทึกจ่ายแล้ว กด [ได้รับเงินแล้ว] หรือ [ยังไม่ได้รับ] → [ส่งใบเสร็จเคลียร์] (ทาง A) → ถ้าต้องคืน แนบสลิปคืนเงิน | พิมพ์ "ขอเบิกเงินทดรอง 5,000 ซื้อของออกบูธ" → การ์ด [ส่งขออนุมัติ] → การ์ด [ได้รับเงินแล้ว] [ยังไม่ได้รับ] → [ส่งใบเสร็จเคลียร์] แล้วส่งรูป → การ์ดใบเคลียร์ → ส่งสลิปคืนในแชต |
| ผู้อนุมัติ | แท็บ "รออนุมัติ" (ป้าย "เงินทดรอง") → journey → อนุมัติหรือไม่อนุมัติ | การ์ดพร้อม [อนุมัติ] [ไม่อนุมัติ] ปุ่มเปิดการ์ดยืนยัน และการ์ดยืนยันเป็นตัวเขียน |
| ผู้บันทึกจ่าย (`reimbursement.payment.record`) | แท็บงานจ่าย → "จ่ายเงินทดรอง" → แนบสลิป → บันทึกจ่าย; ยืนยันรับเงินคืน; ย้อนการเคลียร์ (ต้องมี `payment.void`) | [บันทึกจ่าย] → ส่งสลิป → [ยืนยันจ่าย]; [ยืนยันรับเงินคืน] |
| ผู้บันทึกจ่ายรายจ่าย (`expense.payment.record`) | หน้ารายจ่าย → บันทึกจ่าย → วิธีจ่าย "จ่ายจากเงินทดรอง" → เลือกใบ (ทาง B) | — (G2) |
| ผู้ตรวจการเงิน (`reimbursement.finance_review`, รวม pack "ตรวจใบเบิก") | ทำแทนผู้ขอได้: สร้าง/ส่ง/ยกเลิกคำขอ และสร้างใบเคลียร์แทน | action เดียวกัน |
| เจ้าของร้านคนเดียว | ทำครบเองได้ หน้า journey บอก A1 | เหมือนกัน |
| ผู้อ่านทั้งร้าน | แท็บ "เงินทดรอง" ในสาขาที่ดูแล | ถาม "ใครยังไม่เคลียร์เงินทดรอง" (read tool) |

## 5. กติกา/ข้อยกเว้น

### 5.1 ความหมายทางบัญชี

- เงินทดรองเป็นสินทรัพย์ แยกจากเงินสด ยังไม่เป็นค่าใช้จ่ายตอนจ่ายออก เป็นค่าใช้จ่ายเมื่อเคลียร์ด้วยเอกสาร และส่วนที่เหลือต้องคืน ([FlowAccount](https://flowaccount.com/blog/petty-cash-advanced-payment/) "ยังไม่ถือเป็นค่าใช้จ่ายของกิจการทันที")
- PEAK ใช้ช่องทางเงินสดแยก: โอนเข้า จ่ายรายจ่ายจากช่องทางนั้น แล้วฝากส่วนที่เหลือคืน ([PEAK](https://intercom.help/peak/en/articles/13153079-การบันทึก-เงินทดรองจ-าย-ใน-peak)) ทาง B ของเราตรงกับแบบนี้
- บัญชี `1152-00` ([th-sme-chart-of-accounts-v1.ts:54](../../apps/api/src/modules/ledger/domain/catalog/th-sme-chart-of-accounts-v1.ts))
- รายการบัญชีด้านล่างตัดสินเองจากหลักข้างบน ยังไม่พบหน้าวิชาชีพที่พิมพ์ไว้ตรง ๆ ให้ถือว่า **ยังยืนยันจากแหล่งภายนอกไม่ได้** และให้นักบัญชีทบทวนก่อน Phase 7:

| เหตุการณ์ | Dr | Cr |
|---|---|---|
| จ่ายเงินทดรอง | 1152-00 | เงินสด/ธนาคาร |
| ทาง A: ใบเคลียร์อนุมัติ (ใบเบิกเดิม) | ค่าใช้จ่าย | เจ้าหนี้พนักงาน |
| ทาง A: หักกลบ O | เจ้าหนี้พนักงาน | 1152-00 |
| ทาง B: จ่ายบิลจากเงินทดรอง | เจ้าหนี้การค้า (ยอดที่จ่าย) | 1152-00 แทนเงินสด/ธนาคาร ไม่ลงภาษีหัก ณ ที่จ่ายซ้ำ เพราะลงไว้ตอนตั้งรายจ่ายแล้ว ([posting-engine.logic.ts:183](../../apps/api/src/modules/ledger/domain/logic/posting-engine.logic.ts)) |
| คืนส่วนเกิน | เงินสด/ธนาคาร | 1152-00 |
| บริษัทจ่ายส่วนขาด | เจ้าหนี้พนักงาน | เงินสด/ธนาคาร (`reimbursement.payment` เดิม [posting-engine.logic.ts:192-197](../../apps/api/src/modules/ledger/domain/logic/posting-engine.logic.ts)) |
| ยกเลิกหรือย้อนรายการใด ๆ | กลับด้านของรายการเดิม (§5.8) | |

### 5.2 หลักฐาน และแหล่งเงินของใบรับรองแทนใบเสร็จ

- รายจ่ายที่ผู้จ่ายพิสูจน์ไม่ได้ว่าใครเป็นผู้รับ หักเป็นรายจ่ายไม่ได้ (มาตรา 65 ตรี (18) [rd.go.th/5939](https://www.rd.go.th/5939.html) "รายจ่ายซึ่งผู้จ่ายพิสูจน์ไม่ได้ว่าใครเป็นผู้รับ")
- กรมสรรพากรไม่รับใบรับเงินที่พนักงานลงชื่อเองเมื่อผู้ขายมีหน้าที่ออกใบรับ ([กค 0706/11976](https://rd.go.th/37195.html))
- ใบสำคัญจ่ายที่มีชื่อ ที่อยู่ เลขประจำตัวผู้รับ วันที่ ยอด รายการ และผู้รับลงชื่อ ใช้เป็นหลักฐานได้ ([กค 0706/4722](https://rd.go.th/31914.html)) ใบขอเงินทดรองจึงพิมพ์ข้อมูลเหล่านี้ มีช่องลงชื่อผู้รับเงิน และระบบเก็บการยืนยันรับเงินในระบบและสลิปไว้
- **ของที่ซื้อด้วยเงินทดรองเป็นการจ่ายด้วยเงินของร้าน** ใบรับรองแทนใบเสร็จของของเหล่านี้ต้องเลือก "เงินของร้าน" (`COMPANY`) ห้ามเลือก "เงินส่วนตัวของพนักงาน"
  - ใบรับรองแบบ `COMPANY` เป็นบรรทัดใบเคลียร์ (ทาง A) ไม่ได้ เพราะ source รับเฉพาะ `PERSONAL_ADVANCE` ([reimbursement-source.ts:27](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts))
  - ให้ปิดยอดด้วยทาง B **ที่จุดออกใบรับรอง** (รอบ 2 P4/F1) การออกใบรับรองแบบเงินของร้านสร้างการจ่ายให้เองและทำให้ยอดค้างเป็น 0 ([prisma-expense.repository.ts:3081-3112](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) ถ้ารอไปจ่ายจากเงินทดรองทีหลังจะทำไม่ได้
    - wizard ส่วน "ใช้เงินของใครจ่าย" เมื่อเลือก "เงินของร้าน" และผู้จ่ายมีเงินทดรอง PAID/SETTLING ในสาขาเดียวกัน จะแสดงตัวเลือก "จ่ายจากเงินทดรอง" แล้วให้เลือกใบ AD-…
    - เก็บ `ExpenseSubstituteReceiptEvidence.cashAdvanceId`
    - ตอนออกใบ การจ่ายอัตโนมัติ (`substitute-receipt:{evidenceId}`) เขียน `cashAdvanceId` และตรวจตาม §5.7 แล้ว `refreshCashAdvance` ใน transaction เดียวกัน
    - ถ้าเงินทดรองรับไม่ได้ตอนออกใบ (กำลังเคลียร์ ยอดไม่พอ หรือปิดแล้ว) ให้ปฏิเสธการออกใบด้วย R13 ไม่ออกใบแล้วจ่ายเป็นเงินสดแทนเงียบ ๆ
    - ถ้ารายจ่ายมีการจ่ายบันทึกไว้ก่อนแล้ว (`paidBefore > 0` ซึ่งการออกใบจะไม่สร้างการจ่าย) ผูกเงินทดรองไม่ได้ ให้ยกเลิกการจ่ายนั้นก่อน (R14)
  - Wizard แสดงคำใบ้หนึ่งบรรทัดเมื่อผู้จ่ายมีเงินทดรองค้าง: "ใช้เงินทดรองจ่าย เลือก เงินของร้าน แล้วเลือกใบเงินทดรอง" (H2)
- บรรทัดใบเคลียร์ (ทาง A) ใช้กติกาใบเสร็จของนโยบายใบเบิกเดิม (`requireReceipt`, `allowMissingReceiptWithReason`)
- ใบเสร็จทั่วไปของทาง A ผูกรายจ่ายต้นทางที่เป็น `PERSONAL_ADVANCE` ไม่ได้ เพราะเงินเป็นของร้าน ถ้าผู้ขอพยายามผูก ให้ปฏิเสธด้วย R8

### 5.3 เงินทดรองที่ไม่เคลียร์

- ยังไม่พบข้อหารือที่ตรงเรื่อง ที่ใกล้ที่สุดคือ นายจ้างชำระหนี้แทนลูกจ้างเป็นเงินได้ 40(1) ([กค 0702/4669](https://rd.go.th/46546.html))
- ลูกหนี้ที่ค้างนานโดยไม่มีเหตุอันสมควรอาจถูกประเมินดอกเบี้ยตาม 65 ทวิ (4) ([กค 0811/12593](https://rd.go.th/23163.html), [กค 0706/4260](https://rd.go.th/28308.html)) สองลิงก์นี้มาจาก subagent และ **ยังไม่ได้เปิดซ้ำ**
- ระบบไม่ตัดเอง แสดงวันที่เลยกำหนด เตือน และให้นักบัญชีตัดสินนอกระบบ

### 5.4 ภาษีซื้อและหัก ณ ที่จ่าย

- ไม่มีใบกำกับก็ขอคืนภาษีซื้อไม่ได้ และใบกำกับต้องมีรายการครบตามมาตรา 86/4 ([VAT ฉบับที่ 17](https://rd.go.th/3409.html))
- เมื่อใบเสร็จออกในนามองค์กร องค์กรเป็นผู้จ่าย ([กค 0811/4393](https://rd.go.th/25045.html) เป็นกรณีหน่วยงานรัฐ 1%)
- **ทาง A** (ใบเคลียร์) ใช้กติกาใบเบิก: ไม่มี VAT และไม่มีหัก ณ ที่จ่าย ([materialize-claim-expenses.service.ts:55-63](../../apps/api/src/modules/reimbursements/application/services/materialize-claim-expenses.service.ts), [reimbursement-source.ts:39-41](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts)) จึงเหมาะกับใบเสร็จทั่วไปเท่านั้น
- **ทาง B** สำหรับใบกำกับเต็มรูปในนามบริษัท ค่าบริการที่ต้องหัก ณ ที่จ่าย และใบรับรองแทนใบเสร็จแบบเงินของร้าน
  - บันทึกเป็นรายจ่ายของร้านตามปกติ (VAT, หัก ณ ที่จ่าย และ 50 ทวิ ทำงานตามเดิม) แล้วจ่ายจากเงินทดรอง (§5.7)
  - รายจ่ายมีรายการเดียว และเงินทดรองลดลงเท่ายอดที่จ่าย
- หน้าใบเคลียร์บอกหนึ่งบรรทัดว่า "บิลที่มี VAT หรือหัก ณ ที่จ่าย ให้บันทึกเป็นรายจ่ายของร้านแล้วจ่ายจากเงินทดรอง" (H3)

### 5.5 กติกาเงิน

- สกุลเงินต้องเป็นสกุลหลักของบริษัท ยอดขอต้องมากกว่า 0 ทศนิยมไม่เกิน 2 ตำแหน่ง และไม่เกิน `REIMBURSEMENT_MAX_AMOUNT` ([reimbursement.logic.ts:44](../../apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic.ts))
- จ่ายครั้งเดียวเต็มยอด ถ้าโอนต้องมีสลิป ([reimbursement.logic.ts:865](../../apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic.ts))
- `openAmount` = Σ PAYOUT − Σ RETURN − Σ `ExpensePayment` ที่ `cashAdvanceId` ชี้มา (นับเฉพาะที่ RECORDED)
- ส่งใบเคลียร์แล้ว ระบบตรึง `O = min(T, openAmount)` และยอดค้างจ่ายของใบเคลียร์ = `T − O`
  - รอบ 3 F4: เมื่อใบเคลียร์ที่ยังไม่อนุมัติกลับเป็นร่างที่แก้ได้ (ถูกตีกลับแล้ว reopen หรือดึงกลับจาก PENDING_APPROVAL) ให้ล้าง `cashAdvanceOffsetAmount` เป็น 0 และยอดค้างใน tx เดียวกับการเปิดร่าง แล้วคำนวณใหม่ตอนส่ง
  - การแก้ยอดในร่าง เช่น ลดใบที่ถูกตีกลับจาก 5,000 เป็น 4,000 จึงไม่ชน CHECK `offset ≤ amount`
- ระหว่างที่ใบเคลียร์ส่งแล้วและยังไม่จบ (`CLEARING`) ห้ามทำสามอย่าง ได้แก่ คืนเงิน, จ่ายจากเงินทดรอง (ทาง B) และยกเลิกการจ่ายเงินทดรอง (R1, R2a/R2b, R9)
- ใบเคลียร์อนุมัติแล้วและ `T − O = 0`: ใบเคลียร์จบเป็นจ่ายแล้ว ถ้า `openAmount − O > 0` เงินทดรองเป็น `SETTLING` และ `returnDueAmount = openAmount − O`
- `T − O > 0`: จ่ายส่วนเพิ่มผ่านขั้นจ่ายของใบเคลียร์ เมื่อครบ เงินทดรองเป็น `CLOSED`
  - ถ้ายกเลิกการจ่ายส่วนเพิ่ม ใบเคลียร์กลับเป็น `READY_FOR_PAYMENT` เงินทดรองต้องกลับเป็น `CLEARING` (ช่วง `AWAITING_TOP_UP`) ไม่ใช่ `PAID` (รอบ 2 F4)
  - เพราะ O ยังถูกหักกลบอยู่ ทาง B และการคืนเงินจึงยังถูกปฏิเสธ (R9/R2b) เช่น เงินทดรอง 5,000 กับใบเคลียร์ 5,600 เมื่อ void การจ่าย 600 เงิน 5,000 ต้องไม่กลับมาใช้จ่ายได้
- การคืนเงินทำในสถานะ `PAID` (ไม่เกิน openAmount) หรือ `SETTLING` (ไม่เกิน returnDue)
  - ทาง B ทำได้ใน `PAID` และ `SETTLING` (ไม่เกิน openAmount หรือ returnDue) ถ้าทำให้ returnDue เป็น 0 เงินทดรองเป็น `CLOSED`
  - เมื่อ openAmount เป็น 0 และไม่มีใบเคลียร์ที่ยังเดินอยู่ เงินทดรองเป็น `CLOSED`
- วิธีคืน: `BANK_TRANSFER` ต้องมีสลิป, `CASH` ผู้รับเงินยืนยันได้เลย, `OTHER` ต้องมีเลขอ้างอิงหรือหมายเหตุ
- ใช้ round2 และเก็บ Decimal(18,4)

### 5.6 กติกากระบวนงาน

- ทุกคำขอต้องมีคนอนุมัติ ไม่ใช้เกณฑ์ยอด (Q3) ร้านคนเดียวใช้ solo exemption ที่ตรึงตอนส่ง และบันทึก `selfApproved = true`
- เส้นทางผู้อนุมัติใช้ `resolveSubmissionRoute` เดิม
- `clearByDate` ค่าเริ่มต้น = (`useToDate` หรือวันที่ส่ง) + `cashAdvanceClearDays` (ค่าเริ่มต้น 7, Q2) ต้องไม่ก่อนวันนี้ และไม่เกิน 365 วัน
- เคลียร์ก่อนหรือหลังกำหนดก็ได้ ระบบไม่ล็อก
- ใบเคลียร์ต้องมีผู้เบิกคนเดียวกับผู้ขอ อยู่สาขาเดียวกัน และสกุลเงินเดียวกัน มีใบที่ยังไม่ยกเลิกได้ใบเดียว (partial unique)
- ใบเคลียร์ที่ยอดค้างเป็น 0 ไม่ต้องมีวิธีรับเงิน ถ้ามีส่วนเพิ่มให้ใช้บัญชีของผู้ขอหรือเงินสด
- บรรทัดใบเคลียร์ต้องมีหมวดที่ resolve ได้ (budget spec §5.3) ใบที่หมวดไม่ชัดส่งไม่ได้
- คำขอใหม่ระหว่างที่มีเงินทดรองค้าง ส่งได้ และการ์ดผู้อนุมัติแสดง A2 (Q1)
- ปิดสาขาไม่ได้ถ้ายังมีเงินทดรองที่ไม่จบ ขยาย [branch-in-flight.ts](../../apps/api/src/modules/reimbursements/application/branch-in-flight.ts)
- **ยืนยันรับเงิน**
  - หลังบันทึกจ่าย ผู้ขอกด [ได้รับเงินแล้ว] หรือ [ยังไม่ได้รับ] ซึ่งแจ้งผู้จ่าย
  - รอบ 3 F10: การยืนยันและการโต้แย้ง **ผูกกับแถว PAYOUT** (`CashAdvanceMovement.receiptConfirmedAt/receiptDisputedAt`) ไม่ใช่แถวเงินทดรอง
    - void PAYOUT ทำให้การยืนยันตายไปพร้อมแถวนั้น
    - PAYOUT ใหม่เริ่มที่ยังไม่ยืนยัน ระบบจึงไม่บอกว่าการจ่ายใหม่ได้รับแล้ว และยังเตือนตามปกติ
    - สถานะรับเงินบนหน้าจออ่านจาก PAYOUT ที่ RECORDED อยู่ตอนนี้
  - การยืนยันไม่ใช่เงื่อนไขของการเคลียร์ เพราะการจ่ายมีสลิปอยู่แล้ว แต่หน้าจอและข้อความต้องไม่บอกว่า "ได้รับเงินแล้ว" ก่อนที่ผู้ขอจะยืนยัน
- **การเซ็นบนกระดาษ** พิมพ์ใบขอเงินทดรอง เซ็น แล้วแนบสำเนา เป็นทางเลือกที่เทียบเท่าการยืนยันในระบบ รอบนี้ไม่มีลายเซ็นภาพแบบดิจิทัล เพื่อไม่ต้องสร้างการจัดการไฟล์ลายเซ็นส่วนตัวเพิ่ม

### 5.7 ทาง B: จ่ายรายจ่ายของร้านจากเงินทดรอง

- `RecordExpensePaymentUseCase` ([expense-draft.use-case.ts:1928](../../apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts)) รับ `cashAdvanceId?`
- ตรวจห้าข้อ:
  1. ผู้ทำมี `expense.payment.record`
  2. เงินทดรองอยู่ใน `PAID` หรือ `SETTLING` อยู่ในขอบเขตสาขาของผู้ทำ และเป็นสาขาเดียวกับรายจ่าย
  3. สกุลเงินตรงกัน
  4. ยอดไม่เกิน openAmount (SETTLING ไม่เกิน returnDue)
  5. รายจ่ายต้องไม่ใช่รายจ่ายที่สร้างจากใบเบิก (ระบบปฏิเสธอยู่แล้วที่ [journal.use-case.ts:584](../../apps/api/src/modules/ledger/application/use-cases/journal.use-case.ts))
- ใน transaction เดียวกัน: เขียน `ExpensePayment.cashAdvanceId` แล้ว `refreshCashAdvance`
- ยกเลิกการจ่ายรายจ่าย (ใช้ทางเดิม) แล้ว refresh เงินทดรองซึ่งอาจกลับจาก `CLOSED` เป็น `PAID` หรือ `SETTLING`
- ระหว่าง `CLEARING` ปฏิเสธด้วย R9
- รอบ 3 F5: ยกเลิกการจ่ายทาง B ที่ลงบัญชีแล้ว ([expense-void-blocker.ts:150](../../apps/api/src/modules/expenses/infrastructure/expense-void-blocker.ts) วันนี้ตอบ `ledger_posted` ก่อนถึงการย้อน)
  - สำหรับ `ExpensePayment` ที่มี `cashAdvanceId` และงวดยังเปิด capability ต้องอนุญาต แล้วย้อนบัญชีแบบ true reversal ด้วย `reverseExpenseJournalInTx` ([prisma-expense.repository.ts:3233](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) ใน tx ของการยกเลิก
  - ถ้างวดปิดได้ R11
  - UI ของหน้ารายจ่ายแสดงปุ่มยกเลิกการจ่ายตาม capability ใหม่ R10 จึงมีทางออกจริง
- การจ่ายแบบนี้ไม่ใช่การเคลื่อนไหวของบัญชีธนาคาร จึงตัดออกจาก match source ของ bank reconciliation

### 5.8 ย้อนการเคลียร์และยกเลิกรายการ

หลักของรอบ 2 (F2/F3/P5/P15): ยอดหักกลบ O ถูกปล่อยคืนและย้อนบัญชี **ตอนการยกเลิกใบเคลียร์จบ** (`completeCancellationAtomic`) เท่านั้น สำหรับทุกใบเคลียร์ที่ `cashAdvanceOffsetAmount > 0` ไม่ว่าจะหักกลบครบหรือมีส่วนเพิ่ม ระหว่างที่ยังยกเลิกไม่เสร็จ O ยังถูกถือไว้ และเงินทดรองยังเป็น `CLEARING` (ช่วง `CANCELLING`)

- **ใบเคลียร์ที่ยังไม่อนุมัติ** (ร่าง ถูกตีกลับ หรือรออนุมัติ) ยกเลิกด้วยทางเดิม ไม่มีรายจ่ายให้ void ใบจบเป็น `CANCELLED` แล้ว refresh เงินทดรองเป็น `PAID`
- **ใบเคลียร์ที่อนุมัติแล้วและรอจ่ายส่วนเพิ่ม** (`READY_FOR_PAYMENT`)
  - ถ้ามีการจ่ายส่วนเพิ่มแล้ว ให้ยกเลิกการจ่ายก่อนด้วยทางเดิม ใบจะกลับเป็น `READY_FOR_PAYMENT` และเงินทดรองยังเป็น `CLEARING`
  - จากนั้นยกเลิกด้วยทางเดิม ซึ่ง void รายจ่ายทีละรายการ ([reimbursement-request.use-case.ts:1218-1235](../../apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.ts))
  - เมื่อจบ `completeCancellationAtomic` ทำสามอย่างใน transaction เดียวกัน: ย้อนบัญชี `cash_advance.offset` (Phase 7), ตั้ง `cashAdvanceOffsetReleasedAt` และ refresh เงินทดรองเป็น `PAID` (open กลับมาเต็ม)
  - ถอนการยกเลิกได้ตามกติกาเดิม (ก่อนมีรายจ่ายถูก void [prisma-reimbursement.repository.ts:1443-1450](../../apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts)) และปลอดภัย เพราะ O และบัญชีหักกลบยังไม่ถูกแตะ
- **ใบเคลียร์ที่หักกลบครบ** (`PAID` โดยไม่มีแถว payment) ทางยกเลิกเดิมปฏิเสธใบที่จ่ายแล้ว ([:1266-1270](../../apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts)) จึงใช้ action ใหม่ "ย้อนการเคลียร์" (`ReverseCashAdvanceClearingUseCase`)
  - สิทธิ์ `reimbursement.payment.void` + ขอบเขตสาขา ต้องมีเหตุผล
  - เงื่อนไข:
    - ไม่มี RETURN และไม่มีทาง B ที่บันทึกหลังการเคลียร์ ถ้ามีให้ยกเลิกก่อน (R10)
    - งวดบัญชีของรายการหักกลบยังเปิด (R11) ในบริษัทที่เปิดสมุดบัญชี
  - ผลใน transaction เดียว:
    1. ใบเคลียร์ `PAID → READY_FOR_PAYMENT` ด้วย `paymentStatus = UNPAID` และยอดค้างยังเป็น 0
    2. mirror ของรายจ่ายที่มาจาก O กลับเป็นยังไม่จ่าย
    3. ตั้ง `cashAdvanceReversalStartedAt/ByUserId`
    4. เริ่ม cancellation intent ของใบด้วยเหตุผลเดียวกัน
    5. refresh เงินทดรองเป็น `CLEARING` (ช่วง `CANCELLING`)
  - **ถอนไม่ได้** (F3): `withdrawCancellation` ปฏิเสธเมื่อ `cashAdvanceReversalStartedAt` มีค่า (R15) ใบที่ยอดค้าง 0 จึงไม่ฟื้นกลับมาเป็นใบรอจ่าย
  - ทางยกเลิกเดิมทำต่อ (void รายจ่าย แล้วจบ) ถ้าค้างกลางทาง reconciler ของการยกเลิกที่มีอยู่จะทำต่อ
  - เมื่อจบ จะย้อนบัญชี offset และปล่อย O เหมือนกรณีข้างบน แล้วเงินทดรองเป็น `PAID`
- ถ้างวดปิดระหว่างที่การยกเลิกกำลังจบ การจบจะล้มทั้ง transaction ใบยังอยู่ในช่วง `CANCELLING` journey แสดง R11 ให้ผู้มีสิทธิ์ และ reconciler ลองใหม่เมื่อเปิดงวด ไม่มีสถานะครึ่ง ๆ กลาง ๆ
- **ยกเลิกรายการเงิน** (PAYOUT, RETURN, การจ่ายจากเงินทดรอง)
  - PAYOUT/RETURN ใช้ `reimbursement.payment.void` ทาง B ใช้ `expense.payment.record` ตามทางยกเลิกการจ่ายรายจ่ายเดิม ([expense-draft.use-case.ts:2063](../../apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts), รอบ 2 F14) ต้องมีเหตุผลทุกกรณี
  - ย้อนบัญชีแบบ true reversal ใน transaction เดียวกันตามแบบ `reversePaymentJournalInTx` ([prisma-reimbursement.repository.ts:4145-4170](../../apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts))
  - ถ้างวดปิดแล้วให้ปฏิเสธ (R11) และ idempotent ด้วย REVERSAL row
- ห้าม void PAYOUT เมื่อมีรายการอื่นที่ใช้เงินทดรองนั้นแล้ว (RETURN, ทาง B หรือใบเคลียร์ที่ส่งแล้ว) ให้ย้อนรายการเหล่านั้นก่อน (R1/R1b)

### 5.9 เมื่อร้านถูกปิดฟีเจอร์ใบเบิก (runoff)

- เงินทดรองที่จ่ายไปแล้วเป็นเงินก่อนตัดฟีเจอร์ ต้องเคลียร์ได้ (ข้อยกเว้นแบบจำกัด ตามแบบครอบครัวรายงาน [feature-gate.logic.ts:68-79](../../apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts))
- เพิ่ม `reimbursement.create`, `update_own_draft`, `submit` และ `cancel_own` เข้าชุดสิทธิ์ที่เก็บไว้เฉพาะช่วง runoff
- รอบ 2 (F9/P17) **ตรวจ entitlement เฉพาะงานใหม่** คือ use-case สี่ตัวนี้ต้อง `assertFeatureEnabled('reimbursement')` เมื่อ entitlement ปิด:
  - สร้างหรือส่งคำขอเงินทดรองใหม่
  - สร้างหรือส่งใบเบิกปกติ (ไม่มี `cashAdvanceId`)
- งานอื่นทั้งหมดของเงินทดรองที่จ่ายก่อนตัดฟีเจอร์ **ต้องไม่ตรวจ entitlement** วงจรจึงจบได้ ได้แก่:
  - อ่าน
  - สร้าง แก้ ส่ง และยกเลิกใบเคลียร์
  - อนุมัติหรือไม่อนุมัติใบเคลียร์ และตรวจการเงิน
  - จ่ายส่วนเพิ่มและยกเลิกการจ่าย
  - ยืนยันรับเงิน แนบสลิปคืน และยืนยันรับเงินคืน
  - ทาง B ฝั่งเงินทดรอง (ส่วนการจ่ายรายจ่ายใช้ entitlement `expenses` ของมันเอง)
  - ย้อนการเคลียร์ ยกเลิกรายการ และยกเลิกคำขอที่ยังไม่จ่าย
- สิทธิ์ของงานเหล่านี้ส่วนใหญ่อยู่ใน `RETAINED_REIMBURSEMENT_PERMISSIONS` แล้ว ได้แก่ read, approve, reject, finance_review, payment.record และ payment.void ส่วนที่เพิ่มคือชุดจำกัดสี่ตัวข้างบน
- คำขอเงินทดรองใหม่และใบเบิกปกติถูกปฏิเสธด้วยข้อความ feature-disabled เดิม (ผลลัพธ์เดียวกับวันนี้ แต่ปฏิเสธที่ use-case แทน guard) ต้องมี test ว่าใบเบิกปกติยังสร้างไม่ได้
- แจ้งเตือนช่วง runoff ใช้ ownership `reimbursement` เหมือนใบเบิก จึงไม่ถูกส่ง (G6)

## 6. Data model (migration additive)

```prisma
enum CashAdvanceStatus { DRAFT PENDING_APPROVAL APPROVED REJECTED CANCELLED PAID CLEARING SETTLING CLOSED }
enum CashAdvanceMovementKind { PAYOUT RETURN }

model CashAdvance {
  id                           String                      @id @default(cuid())
  companyId                    String
  branchId                     String
  advanceNo                    String?                     // AD-YYYYMM-00001 ตอนส่ง
  requesterUserId              String
  requesterDisplayNameSnapshot String
  purpose                      String                      @db.VarChar(500)
  amount                       Decimal                     @db.Decimal(18, 4)
  currency                     String                      @default("THB")
  useFromDate                  DateTime?                   @db.Date
  useToDate                    DateTime?                   @db.Date
  clearByDate                  DateTime                    @db.Date
  status                       CashAdvanceStatus           @default(DRAFT)
  submittedAt                  DateTime?
  submittedByUserId            String?
  /// CashAdvancePolicySnapshotV1 (parser ของตัวเอง ไม่ใช้ parser ของใบเบิก §7)
  approvalPolicySnapshotJson   Json?
  approverRoleSnapshot         String?
  assignedApproverUserIdsJson  Json?
  decidedAt                    DateTime?
  decidedByUserId              String?
  selfApproved                 Boolean                     @default(false)
  rejectionReason              String?
  cancelledAt                  DateTime?
  cancelledByUserId            String?
  cancelReason                 String?
  payoutMethod                 ReimbursementPaymentMethod? // BANK_TRANSFER | CASH (CHECK)
  payoutKind                   String?
  payoutBankName               String?
  payoutAccountName            String?
  payoutAccountLast4           String?
  payoutAccountCiphertext      String?
  payoutFingerprint            String?
  payoutSource                 String?                     // DEFAULT_ACCOUNT | SAVED_ACCOUNT (SELF) | REQUESTER
  /// แคช: คำนวณใหม่ในทุก transaction ที่แตะเงิน (§9)
  paidAmount                   Decimal                     @default(0) @db.Decimal(18, 4)
  returnedAmount               Decimal                     @default(0) @db.Decimal(18, 4)
  spentDirectAmount            Decimal                     @default(0) @db.Decimal(18, 4) // ทาง B
  offsetAmount                 Decimal                     @default(0) @db.Decimal(18, 4) // ทาง A
  returnDueAmount              Decimal                     @default(0) @db.Decimal(18, 4)
  returnSlipAttachmentId       String?
  returnSlipSubmittedAt        DateTime?
  lastReminderAt               DateTime?
  reminderCount                Int                         @default(0)
  idempotencyKey               String?
  createdByUserId              String
  updatedByUserId              String?
  createdAt                    DateTime                    @default(now())
  updatedAt                    DateTime                    @updatedAt
  company                      Company                     @relation(fields: [companyId], references: [id], onDelete: Cascade)
  branch                       Branch                      @relation(fields: [companyId, branchId], references: [companyId, id], onDelete: Restrict)
  movements                    CashAdvanceMovement[]
  clearingClaims               ReimbursementRequest[]      @relation("CashAdvanceClearing")
  expensePayments              ExpensePayment[]            @relation("CashAdvanceExpensePayment")

  @@unique([companyId, id])
  @@unique([companyId, advanceNo])
  @@unique([companyId, idempotencyKey])
  @@index([companyId, requesterUserId, status])
  @@index([companyId, status, clearByDate])
  @@index([companyId, branchId, status])
}

model CashAdvanceMovement {
  id                 String                           @id @default(cuid())
  companyId          String
  cashAdvanceId      String
  kind               CashAdvanceMovementKind
  amount             Decimal                          @db.Decimal(18, 4)
  currency           String                           @default("THB")
  method             ReimbursementPaymentMethod
  occurredAt         DateTime
  reference          String?                          @db.VarChar(128)
  note               String?                          @db.VarChar(500)
  slipAttachmentId   String?
  slipChecksumSha256 String?
  payoutConfirmedAt  DateTime?
  /// PAYOUT เท่านั้น: การยืนยันหรือโต้แย้งของผู้ขอผูกกับแถวนี้ (รอบ 3 F10)
  receiptConfirmedAt       DateTime?
  receiptConfirmedByUserId String?
  receiptDisputedAt        DateTime?
  receiptDisputeNote       String?   @db.VarChar(300)
  status             ReimbursementPaymentRecordStatus @default(RECORDED)
  recordedByUserId   String
  voidedAt           DateTime?
  voidedByUserId     String?
  voidReason         String?
  idempotencyKey     String
  postingStatus      ReimbursementPostingStatus       @default(not_required)
  createdAt          DateTime                         @default(now())
  updatedAt          DateTime                         @updatedAt
  advance            CashAdvance                      @relation(fields: [companyId, cashAdvanceId], references: [companyId, id], onDelete: Restrict)

  @@unique([companyId, idempotencyKey])
  @@index([companyId, cashAdvanceId, status])
  @@index([companyId, occurredAt, method])
}

model ReimbursementRequest {
  // ...
  cashAdvanceId                    String?
  cashAdvanceOffsetAmount          Decimal      @default(0) @db.Decimal(18, 4)
  /// ย้อนการเคลียร์เริ่มแล้ว: ห้ามถอนการยกเลิก (R15)
  cashAdvanceReversalStartedAt       DateTime?
  cashAdvanceReversalStartedByUserId String?
  /// O ถูกปล่อยคืนและย้อนบัญชีแล้ว ตั้งเมื่อการยกเลิกใบเคลียร์จบ
  cashAdvanceOffsetReleasedAt        DateTime?
  cashAdvance                      CashAdvance? @relation("CashAdvanceClearing", fields: [companyId, cashAdvanceId], references: [companyId, id], onDelete: Restrict)
  @@index([companyId, cashAdvanceId])
}

model ExpensePayment {
  // ...
  cashAdvanceId String?   // ทาง B
  cashAdvance   CashAdvance? @relation("CashAdvanceExpensePayment", fields: [companyId, cashAdvanceId], references: [companyId, id], onDelete: Restrict)
  @@index([companyId, cashAdvanceId])
}

model ReimbursementPolicy {
  // ...
  cashAdvanceClearDays Int @default(7)   // CHECK 1..90
}

model ExpenseSubstituteReceiptEvidence {
  // ...
  /// ทาง B ผ่านใบรับรองแบบเงินของร้าน: การจ่ายอัตโนมัติตอนออกใบชี้เงินทดรองนี้ (§5.2)
  cashAdvanceId String?
}

model ReimbursementDraftAction {
  // ...
  operation     String  @db.VarChar(16)   // CREATE | UPDATE | ADVANCE_CREATE
  cashAdvanceId String?                    // ผลของ ADVANCE_CREATE
}
```

SQL เพิ่ม (partial index แบบ `ReimbursementPolicy_company_default_unique` ของ migration `20260821190000_reimbursement_policy_runtime_correctness`):

```sql
CREATE UNIQUE INDEX "ReimbursementRequest_live_clearing_unique"
  ON "ReimbursementRequest" ("companyId", "cashAdvanceId")
  WHERE "cashAdvanceId" IS NOT NULL AND "status" NOT IN ('CANCELLED', 'VOIDED');
ALTER TABLE "CashAdvance" ADD CONSTRAINT "CashAdvance_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "CashAdvance" ADD CONSTRAINT "CashAdvance_payout_method" CHECK ("payoutMethod" IS NULL OR "payoutMethod" IN ('BANK_TRANSFER', 'CASH'));
ALTER TABLE "CashAdvanceMovement" ADD CONSTRAINT "CashAdvanceMovement_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "ReimbursementRequest" ADD CONSTRAINT "ReimbursementRequest_offset_range" CHECK ("cashAdvanceOffsetAmount" >= 0 AND "cashAdvanceOffsetAmount" <= "amount");
ALTER TABLE "ReimbursementPolicy" ADD CONSTRAINT "ReimbursementPolicy_clear_days" CHECK ("cashAdvanceClearDays" BETWEEN 1 AND 90);
ALTER TABLE "ExpenseSubstituteReceiptEvidence" ADD CONSTRAINT "SubstituteEvidence_advance_company_only" CHECK ("cashAdvanceId" IS NULL OR "fundingSource" = 'COMPANY');
-- ReimbursementDraftAction (รอบ 2 F5): constraint เดิมรับเฉพาะใบเบิก
ALTER TABLE "ReimbursementDraftAction" ADD COLUMN "cashAdvanceId" TEXT;
ALTER TABLE "ReimbursementDraftAction" ADD CONSTRAINT "ReimbursementDraftAction_companyId_cashAdvanceId_fkey"
  FOREIGN KEY ("companyId", "cashAdvanceId") REFERENCES "CashAdvance"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "ReimbursementDraftAction_companyId_cashAdvanceId_idx" ON "ReimbursementDraftAction"("companyId", "cashAdvanceId");
ALTER TABLE "ReimbursementDraftAction" DROP CONSTRAINT "ReimbursementDraftAction_operation_check";
ALTER TABLE "ReimbursementDraftAction" ADD CONSTRAINT "ReimbursementDraftAction_operation_check" CHECK ("operation" IN ('CREATE', 'UPDATE', 'ADVANCE_CREATE'));
ALTER TABLE "ReimbursementDraftAction" ADD CONSTRAINT "ReimbursementDraftAction_target_kind_check" CHECK (
  ("operation" = 'ADVANCE_CREATE' AND "requestId" IS NULL) OR ("operation" <> 'ADVANCE_CREATE' AND "cashAdvanceId" IS NULL));
ALTER TABLE "ReimbursementDraftAction" DROP CONSTRAINT "ReimbursementDraftAction_state_check";
ALTER TABLE "ReimbursementDraftAction" ADD CONSTRAINT "ReimbursementDraftAction_state_check" CHECK (
  ("status" = 'COLLECTING' AND "previewRevision" = 0 AND "confirmationDigest" IS NULL)
  OR ("status" = 'PREVIEW' AND "previewRevision" >= 1 AND "previewJson" IS NOT NULL AND "confirmationDigest" IS NOT NULL)
  OR ("status" = 'APPLIED' AND "resultJson" IS NOT NULL AND "appliedAt" IS NOT NULL AND (
        ("operation" IN ('CREATE', 'UPDATE') AND "requestId" IS NOT NULL AND "appliedRequestUpdatedAt" IS NOT NULL)
     OR ("operation" = 'ADVANCE_CREATE' AND "cashAdvanceId" IS NOT NULL)))
  OR "status" IN ('CANCELLED', 'EXPIRED', 'STALE'));
```

แถวเดิมทุกแถวเป็น CREATE/UPDATE จึงผ่าน constraint ใหม่โดยไม่ต้อง backfill ต้องพิสูจน์ด้วย PostgreSQL จริง (§14)

ไฟล์แนบ (F1/F7: ต้องได้การป้องกันระดับสลิปทุกชั้น):

- สลิปจ่ายและสลิปคืนใช้ **tag เดียวกับสลิปใบเบิก** `generatedFor: REIMBURSEMENT_PAYMENT_SLIP_UPLOAD_TAG` และใส่ `cashAdvanceId` กับ `slipKind: 'PAYOUT' | 'RETURN'` ใน metadata การป้องกันที่ตรวจ tag ทุกจุด (ดาวน์โหลด, รายการไฟล์, ใช้เป็นใบเสร็จ, ใช้เป็นลายเซ็น) จึงทำงานทันที
- link ใหม่: `cash_advance_movement` + `cash_advance.movement.slip` และ `cash_advance` + `cash_advance.return_slip` และ `cash_advance.form.signed`
  - ขยายการตรวจแบบ link ทุกตัวให้รู้จักทั้งสามคู่: `isReimbursementPaymentSlip` (ลบและดาวน์โหลด), `NOT_REIMBURSEMENT_PAYMENT_SLIP_WHERE` และ `isReimbursementPaymentSlipFile`
  - สำเนาเอกสารที่เซ็นแล้วก็ห้ามดาวน์โหลดผ่านทางทั่วไป
- เปิดไฟล์ได้เฉพาะผ่าน endpoint ของเงินทดรอง (§7) โดยผู้ขอ ผู้อนุมัติของใบ ผู้ถือ `payment.record` หรือ `finance_review` ในขอบเขต (กติกาเดียวกับ `canOpenReimbursementPaymentSlip`) และเขียน audit ทั้งตอนสำเร็จและตอนถูกปฏิเสธ

เลขเอกสาร: `cash_advance.request` (`AD-{YYYY}{MM}-{SEQ}`) ใน [document-sequence.logic.ts:34](../../apps/api/src/modules/data-model-core/domain/logic/document-sequence.logic.ts) และ [seed.ts:3021](../../apps/api/prisma/seed.ts)

## 7. Contracts/API

ไฟล์ใหม่ `packages/contracts/src/cash-advances.ts` และ controller `cash-advance.controller.ts` ที่ `companies/:companyId/reimbursements/advances` ทุก write ผ่าน `ReimbursementWriteQuiesceGuard`

| Method + path | สิทธิ์ (ตรวจใน use-case) | ใช้ทำอะไร |
|---|---|---|
| `GET /advances?bucket=mine\|approvals\|pay\|open\|all` | read / read_related / read_own | รายการ |
| `POST /advances` · `PATCH /advances/:id` | `reimbursement.create` · `update_own_draft` หรือ `finance_review` | ร่าง |
| `GET /advances/:id` | อ่านได้ | รายละเอียด `actions[]` `desk` |
| `POST /advances/:id/submit` · `/cancel` · `/reopen` | `submit` · own `cancel_own` หรือ `finance_review` · `update_own_draft` | |
| `POST /advances/:id/approve` · `/reject` | ใน assignment ที่ตรึง + approve/reject | |
| `POST /advances/:id/slips/upload-intent` · `/slips/uploads/:attachmentId/complete` | PAYOUT: `payment.record` · RETURN: ผู้ขอของใบ หรือ `payment.record` | อัปโหลดสลิปแบบรู้จักเงินทดรอง (F7) |
| `POST /advances/:id/payout` | `payment.record` | บันทึกจ่าย |
| `POST /advances/:id/receipt-confirmation` | ผู้ขอ | `{ received: true }` หรือ `{ received: false, note }` |
| `POST /advances/:id/return-slip` | ผู้ขอ | ผูกสลิปคืนที่อัปโหลดแล้ว |
| `POST /advances/:id/returns` | `payment.record` | ยืนยันรับเงินคืน |
| `POST /advances/:id/movements/:movementId/void` | `payment.void` | ยกเลิกรายการเงิน (§5.8) |
| `POST /advances/:id/reverse-clearing` | `payment.void` | ย้อนการเคลียร์ (§5.8) |
| `GET /advances/:id/movements/:movementId/slips/:attachmentId/download-url` · `GET /advances/:id/return-slip/download-url` · `GET /advances/:id/signed-copy/download-url` | กลุ่มผู้เห็นสลิป | เปิดไฟล์ลับ (F1) |
| `POST /advances/:id/payout-destination/reveal` | กลุ่มผู้เห็นเลขบัญชี | audit ก่อนถอดรหัส |
| `POST /advances/:id/signed-copy` | ผู้ขอ / `payment.record` | แนบสำเนาที่เซ็น |
| `GET /advances/:id/form.pdf` | อ่านได้ | ใบขอเบิกเงินทดรองจ่าย |

DTO หลัก (ย่อ):

```ts
export type CashAdvanceDetail = { id: string; advanceNo?: string; status: CashAdvanceStatus; requester: { userId: string; displayName: string }; branch: { id: string; name: string };
  purpose: string; amount: string; currency: string; useFromDate?: string; useToDate?: string; clearByDate: string; overdueDays: number;
  paidAmount: string; returnedAmount: string; spentDirectAmount: string; openAmount: string; offsetAmount: string; returnDueAmount: string;
  receipt: { confirmedAt?: string; disputedAt?: string };
  payout: PayoutSummary; movements: CashAdvanceMovementSummary[]; directExpensePayments: Array<{ expenseId: string; expenseNumber?: string; amount: string; paidAt: string }>;
  clearing?: { claimId: string; requestNo?: string; claimStatus: ReimbursementRequestStatus; phase: 'DRAFT' | 'AWAITING_DECISION' | 'AWAITING_TOP_UP' | 'SETTLED' | 'CANCELLING';
    total: string; offsetAmount: string; payableAmount: string; outcome: 'EXACT' | 'RETURN' | 'TOP_UP' };
  approval: { approverNames: string[]; decidedBy?: string; decidedAt?: string; selfApproved: boolean; soloSelfApproval: boolean; rejectionReason?: string };
  actions: CashAdvanceAction[]; desk: { label: string }; openAdvancesOfRequester?: { count: number; total: string } };
```

- `CashAdvancePolicySnapshotV1` เป็นชนิดแยก มี `schemaVersion`, `policyId`, `policyVersion`, `route` (รูปเดียวกับใบเบิก), `allowSelfApproval` และ `clearDays` และมี parser แบบ strict ของตัวเอง `parseCashAdvancePolicySnapshot` (F6)
- ใบเบิก:
  - `CreateReimbursementInput.cashAdvanceId?` และ `ReimbursementRequestDetail.cashAdvance?` (`phase` และ `outcome` เหมือนข้างบน)
  - `ReimbursementPolicySnapshotV1.cashAdvance?: { advanceId; advanceNo?; openAmountAtSubmit; offsetAmount }`
  - `parseReimbursementPolicySnapshot` ([reimbursement.constants.ts:83-126](../../apps/api/src/modules/reimbursements/domain/reimbursement.constants.ts)) เพิ่ม `cashAdvance` ใน `POLICY_SNAPSHOT_KEYS` และตรวจ strict: id ไม่ว่าง ยอดเป็นรูปแบบเงิน และ offset ≤ openAmountAtSubmit ถ้าไม่ทำ snapshot ใหม่จะ throw `invalid_reimbursement_policy_snapshot` ทุกครั้งที่อ่าน
- `RecordExpensePaymentInput.cashAdvanceId?` (ทาง B)
- LINE:
  - `LineReimbursementDraftProposalV1.advanceChoiceId?` และ choice `ADVANCE`
  - คำขอเงินทดรองจาก LINE ใช้ `ReimbursementDraftAction` เดิม `operation: 'ADVANCE_CREATE'` และการยืนยันใช้ postback `line.reimbursement_draft_confirmation` เดิม ซึ่งเรียก create + submit ใน transaction ที่ตั้ง `status = APPLIED` และ `cashAdvanceId`
  - ต้อง migrate constraint ตาม §6 (รอบ 2 F5)
  - การกดซ้ำหรือ replay ใช้ `intentKeyHash` และ `confirmationDigest` เดิม จึงได้ผลเดิมโดยไม่สร้างคำขอซ้ำ
- AI tools ([ai-tools.ts](../../packages/contracts/src/ai-tools.ts)):
  - `reimbursement.advance.preview_create` (category `draft_create`) อยู่ใน `LINE_REIMBURSEMENT_DRAFT_TOOL_NAMES` จึงคืน ACTION ref แบบ `reimbursement_draft_action` หนึ่งตัวที่ gateway ยอมรับ ([erp-tool.client.ts:121-125](../../apps/ai-gateway/src/modules/line-ai/infrastructure/erp-tool.client.ts))
  - **รอบ 2 F6/P10**: ทุกจุดที่ตรวจด้วย prefix `reimbursement.draft.` เปลี่ยนเป็น helper กลาง `isLineDraftActionTool(name)` จาก contracts (อ่านจาก `LINE_REIMBURSEMENT_DRAFT_TOOL_NAMES`)
    - API: [line-read-evidence.service.ts:437](../../apps/api/src/modules/line-ai/application/line-read-evidence.service.ts) (หลักฐาน ACTION), [process-line-webhook.use-case.ts:8855](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts) (โหลดการ์ดยืนยัน) และ manifest `operationRelease`
    - gateway: [semantic-turn-v2.ts:712-714](../../apps/ai-gateway/src/modules/line-ai/agents/semantic-turn-v2.ts) และ [reimbursement-draft-input.ts:86](../../apps/ai-gateway/src/modules/line-ai/agents/reimbursement-draft-input.ts)
    - ถ้าไม่เปลี่ยน preview ที่ไม่มี read row จะไม่ผ่านการตรวจหลักฐาน และการ์ดยืนยันจะไม่ถูกส่ง
  - `reimbursement.advance.list_open` (read) ลงใน `READ_MEMORY_TOOLS` และสกัด shownItems เป็น `advanceId`
  - `expense.action.preview` เพิ่ม `ADVANCE_SUBMIT`, `ADVANCE_CANCEL`, `ADVANCE_APPROVE`, `ADVANCE_REJECT`, `ADVANCE_RECORD_PAYOUT`, `ADVANCE_CONFIRM_RECEIPT`, `ADVANCE_RECORD_RETURN` และ `advanceId` ซึ่งต้องมาจาก shownItems ของ read tool เท่านั้น (ตรวจใน action target validation)
  - **รอบ 3 F1 (blocker §16.1)**: gateway ตรวจ target ของ `expense.action.preview` เอง ([semantic-turn-v2.ts:393-399](../../apps/ai-gateway/src/modules/line-ai/agents/semantic-turn-v2.ts))
    - วันนี้รู้จักแค่ `REIMBURSEMENT_*` (reimbursementId), `VOUCHER_*` (voucherId) และอื่น ๆ ถือว่าเป็น expenseId ADVANCE_* จึงถูกถือเป็น action ของรายจ่าย และถูกปฏิเสธเพราะ `expenseId` ว่าง ก่อนถึง API
    - แก้: เพิ่มกิ่ง `advance = action.startsWith('ADVANCE_')` → ids = [advanceId] และ freshIds จากผลของ `reimbursement.advance.list_open` (items[].id) และจาก `conversationContext.recentReads` ของรอบก่อน
    - เพิ่ม `reimbursement.advance.list_open` ในรายการที่อนุญาตให้รอบวางแผนถัดไปผูก target ([:728](../../apps/ai-gateway/src/modules/line-ai/agents/semantic-turn-v2.ts)) และรายการต่อเนื่อง ([:965](../../apps/ai-gateway/src/modules/line-ai/agents/semantic-turn-v2.ts))
    - `ADVANCE_SUBMIT` ของคำขอที่เพิ่งสร้างใช้ id จากผลยืนยัน ไม่ใช่จาก model
  - ทั้งสอง tool ใหม่ลงใน `toolMap` ของ `internal-tools.controller.ts` (บรรทัด 180, 271-281) และ W00 manifest
  - ถอด env flag ตาม §11 tool ใหม่จึงไม่มี runtime flag
- Token ปุ่มเปิด: namespace ใหม่ `line-cash-advance-open-v1` มี `exp` (ออกเมื่อ + 7 วัน) อยู่ใน HMAC และตรวจตอนรับ ถ้าหมดอายุตอบ X1 (F26) ส่วนการเขียนจริงยังผ่านการ์ดยืนยันที่ re-read สถานะและ CAS
- Error codes ใหม่ (มีข้อความไทยทุกตัว):
  - `cash_advance_not_payable`, `cash_advance_clearing_exists`, `cash_advance_clearing_awaiting_decision`, `cash_advance_clearing_awaiting_top_up`, `cash_advance_return_exceeds_due`
  - `cash_advance_payout_third_party_not_allowed`, `cash_advance_currency_mismatch`, `cash_advance_requester_mismatch`, `cash_advance_state_changed`, `cash_advance_has_later_movements`
  - `cash_advance_period_closed`, `cash_advance_source_personal_not_allowed`, `cash_advance_feature_runoff_new_work`

## 8. สิทธิ์ ABAC และขอบเขต tenant

- ไม่มี permission key ใหม่ ใช้ `reimbursement.*` และ `expense.payment.record` (ทาง B)
- pack ที่ได้ความสามารถเพิ่ม ต้องแก้คำอธิบายให้จริง ([capability-pack.registry.ts:326-363](../../apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts)):

| pack | ได้เพิ่ม |
|---|---|
| `pack.reimbursement.self` | ขอ ยืนยันรับเงิน แนบสลิปคืน และเคลียร์เงินทดรองของตัวเอง |
| `pack.reimbursement.approve` | อนุมัติคำขอเงินทดรอง จ่าย ยืนยันรับคืน ยกเลิกรายการ และย้อนการเคลียร์ |
| `pack.reimbursement.review` (มี `finance_review`) | สร้าง ส่ง ยกเลิกคำขอเงินทดรอง และสร้างใบเคลียร์แทนผู้ขอ แต่จ่ายไม่ได้ (F27) |
| `pack.reimbursement.finance` | ทั้งหมดของ review รวมถึงจ่าย ยืนยันรับคืน และยกเลิกรายการ |

| การกระทำ | เงื่อนไข |
|---|---|
| ของตัวเอง | create/update_own_draft/submit/cancel_own + `requesterUserId = ctx.userId` |
| ทำแทน | `finance_review` + สาขาในขอบเขต (`assertReimbursementBranchInScope`) |
| อนุมัติ | approve/reject + อยู่ใน assignment ที่ตรึง (หรือ frozen assignment เดิม) + สาขาในขอบเขต + บทบาทใช้งาน |
| จ่าย/คืน/ยกเลิก/ย้อน | `payment.record` / `payment.void` + สาขาในขอบเขต |
| ทาง B | `expense.payment.record` + สาขาของรายจ่าย = สาขาของเงินทดรอง ในขอบเขต |
| อ่าน | `read` (สาขาในขอบเขต) / `read_related` (ผู้อนุมัติหรือผู้จ่ายของใบนั้น) / `read_own` |
| เปิดสลิปหรือแสดงเลขบัญชี | ผู้ขอ, ผู้อนุมัติของใบ, `payment.record` หรือ `finance_review` ในขอบเขต + audit |

- Tenant: ทุก query มี `companyId` และ FK compound ไฟล์ต้องเป็นของบริษัทและสาขาเดียวกัน
- Workflow: `findSourceBranchId` ([prisma-workflow.repository.ts:172-182](../../apps/api/src/modules/workflow/infrastructure/prisma-workflow.repository.ts)) เพิ่ม `cash_advance` (F9) ผู้รับที่เลือกตามสิทธิ์จึงอยู่ในสาขาของใบเท่านั้น
- Feature: `reimbursement` ทุก tier ([menu-entitlements.ts:432-449](../../packages/contracts/src/menu-entitlements.ts), [:496-501](../../packages/contracts/src/menu-entitlements.ts)) และ runoff ตาม §5.9
- AI Gateway เรียกเฉพาะ tool ที่ตรวจสิทธิ์ ไม่แตะฐานข้อมูล

## 9. State transitions

`deriveCashAdvanceStatus(facts)` คำนวณสถานะหลังจ่ายจาก movement, ทาง B, ใบเคลียร์ และ `cancellationPendingAt` และ `refreshCashAdvance` ทำในทุก transaction ที่แตะข้อมูลเหล่านี้ (ฝั่งเงินทดรอง ฝั่งใบเบิก และฝั่งการจ่ายรายจ่าย)

| จาก | ไป | เหตุ | Guard |
|---|---|---|---|
| — | DRAFT | สร้าง | สาขา ACTIVE ในขอบเขต (runoff: ปฏิเสธ) |
| DRAFT | PENDING_APPROVAL | submit | payout ครบ, เส้นทางพร้อม |
| DRAFT/PENDING_APPROVAL/APPROVED/REJECTED | CANCELLED | ยกเลิก | ยังไม่มี PAYOUT |
| PENDING_APPROVAL | APPROVED / REJECTED | ตัดสิน | assignment; ไม่อนุมัติต้องมีเหตุผล |
| REJECTED | DRAFT | reopen | — |
| APPROVED | PAID | PAYOUT | สลิป (โอน), จ่ายเต็มยอด |
| PAID | APPROVED | void PAYOUT | ไม่มี RETURN, ทาง B หรือใบเคลียร์ที่ส่งแล้ว (R1/R1b) |
| PAID | CLEARING | ส่งใบเคลียร์ | derive |
| CLEARING | PAID | ใบเคลียร์ถูกตีกลับ หรือการยกเลิกจบ (ปล่อย O และย้อนบัญชีใน tx ของการจบ) | derive |
| CLEARING/SETTLING/CLOSED | CLEARING (`CANCELLING`) | เริ่มยกเลิกใบเคลียร์ที่อนุมัติแล้ว หรือเริ่มย้อนการเคลียร์ | O ยังถือไว้จนการยกเลิกจบ ระหว่างนี้ห้ามคืน ห้ามทาง B และห้าม void PAYOUT |
| CLEARING | SETTLING / CLOSED | ใบเคลียร์จบ | derive จาก T, O และ open |
| PAID/SETTLING | CLOSED | RETURN หรือทาง B จน open/due เป็น 0 | ยอด ≤ open/due |
| CLOSED/SETTLING | PAID/SETTLING | void RETURN หรือ void ทาง B | derive |
| CLOSED | CLEARING (`AWAITING_TOP_UP`) | void การจ่ายส่วนเพิ่ม: ใบเคลียร์กลับเป็น READY_FOR_PAYMENT และ O ยังถือไว้ | derive (รอบ 2 F4) ไม่กลับเป็น PAID |
| ใบเคลียร์ PAID (หักกลบครบ) | READY_FOR_PAYMENT + intent (ถอนไม่ได้) → CANCELLED | ย้อนการเคลียร์ | §5.8 R10/R11/R15 |
| ใบเคลียร์ READY_FOR_PAYMENT (มีส่วนเพิ่ม ยังไม่จ่าย) | intent (ถอนได้ก่อน void รายจ่ายแรก) → CANCELLED | ยกเลิกทางเดิม | §5.8 |

ช่วงของใบเคลียร์ (`clearing.phase`): `DRAFT` (ร่างหรือถูกตีกลับ), `AWAITING_DECISION` (PENDING_APPROVAL, APPROVED ที่ยัง project ไม่เสร็จ, FINANCE_REVIEW), `AWAITING_TOP_UP` (READY_FOR_PAYMENT ที่ค้างจ่าย > 0), `SETTLED` (PAID) และ `CANCELLING` (มี `cancellationPendingAt`)

ใบเคลียร์:

1. หลัง projection ถ้ายอดค้างเป็น 0 ให้ไป `PAID` ใน tx เดียวกัน และ mirror ด้วยวิธีและวันที่ของ PAYOUT
2. ถ้ามีส่วนเพิ่ม ให้ปัน O ตามลำดับบรรทัด
3. `claimPayableAmount(req) = amount − cashAdvanceOffsetAmount` แทน `request.amount` ที่ [:3766-3767](../../apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts) และ [:4284-4285](../../apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts) (ใบเบิกปกติ offset = 0)
4. แก้ `ALLOWED_TRANSITIONS` ให้ตรงกับ void จริง (B5)

## 10. UI

### 10.1 เว็บ

- **Hub**
  - "เพิ่มเติม" มี "ขอเงินทดรอง" ปุ่มกลุ่มยังเป็นสองช่องขนาดเท่ากัน ([ReimbursementsPages.tsx:246-252](../../apps/web/src/features/reimbursements/ReimbursementsPages.tsx))
  - แท็บ "เงินทดรอง" และป้าย "เงินทดรอง" ในคิว
- **ฟอร์ม `/reimbursements/advances/new`**
  - 390 px: คอลัมน์เดียว ปุ่ม [บันทึกร่าง] [ส่งขออนุมัติ] ขนาดเท่ากันในแถบล่าง
  - 1,280 px และ ~1,556 px: เต็มกว้าง grid สองคอลัมน์ ปุ่มอยู่แถบล่าง
  - คำใบ้ "เช่น ซื้อของออกบูธงานวัด" และ "ส่งใบเสร็จเคลียร์ภายในวันนี้"
- **Journey `/reimbursements/advances/:id`**
  - ขั้น: ขอเงิน → อนุมัติ → จ่ายเงิน → เคลียร์ → คืนเงินที่เหลือ (ขั้นสุดท้ายมีเมื่อมีส่วนเกิน)
  - แถบสรุปยอด: รับไป · ใช้ไป · จ่ายบิลจากเงินทดรอง · คืนแล้ว · ค้าง
  - 390 px แนวตั้ง 1,280 px และ ~1,556 px แนวนอนเต็มกว้าง
  - ขั้นจ่ายเงินมีปุ่ม [ได้รับเงินแล้ว] [ยังไม่ได้รับ] ขนาดเท่ากันสำหรับผู้ขอ ขั้นเคลียร์มีลิงก์ใบเคลียร์ และปุ่ม [ย้อนการเคลียร์] สำหรับผู้มีสิทธิ์
- **หน้าสร้างใบเบิกด้วย `?advanceId=`** หัวการ์ด "เคลียร์เงินทดรอง AD-… · ค้างเคลียร์ {open} บาท" แถบล่างแสดง C1–C3 สด และคำใบ้ H3
- **หน้าบันทึกจ่ายรายจ่าย** วิธีจ่าย "จ่ายจากเงินทดรอง" แสดงเฉพาะเมื่อมีเงินทดรอง PAID/SETTLING ในสาขาเดียวกัน แล้วเลือกใบ แต่ละตัวเลือกแสดง "AD-… · {ชื่อ} · ค้าง {open} บาท"
- **ใบพิมพ์**
  - ใบขอเบิกเงินทดรองจ่ายพิมพ์เลขที่ วันที่ ผู้ขอ สาขา ใช้ทำอะไร ช่วงวันที่ ยอดเป็นตัวเลขและตัวอักษร และเคลียร์ภายใน
  - พิมพ์บรรทัด "อนุมัติในระบบโดย … เมื่อ …", บรรทัด "จ่ายเมื่อ … วิธี … อ้างอิง …", บรรทัด "ผู้รับเงินยืนยันในระบบเมื่อ …" หรือ "ยังไม่ได้ยืนยันรับเงิน" และช่องลงชื่อผู้รับเงิน
  - ใบเคลียร์เพิ่มบล็อก "หักเงินทดรอง AD-… X บาท"
- **หลักฐานก่อนเรียกว่าเสร็จ** ([thai-ux-standard.md:112-118](../guidelines/thai-ux-standard.md)) เปิดทุกหน้าและ dialog ที่เปลี่ยนใน browser จริงที่ 390, 1,280 และ ~1,556 px ด้วยข้อมูลไทย วัดกลุ่มปุ่ม กด journey หลักหนึ่งรอบรวมทางผิดหนึ่งครั้ง และเขียนสิ่งที่ไม่ได้ดู

### 10.2 ประโยคใหม่ และตาราง surface × case

| ID | ประโยค | ใช้เมื่อ |
|---|---|---|
| S1 | รอเคลียร์ | PAID |
| S2 | เกินกำหนดเคลียร์ {n} วัน | PAID/CLEARING ที่เลยวัน |
| S3 | กำลังเคลียร์ | CLEARING |
| S4 | รอคืนเงิน {x} บาท | SETTLING |
| S5 | เคลียร์ครบแล้ว | CLOSED |
| P1 | บันทึกจ่ายเงินทดรอง {ยอด} บาทแล้ว รอผู้ขอยืนยันรับเงิน | หลังบันทึกจ่าย ยังไม่ยืนยัน (ผู้จ่ายและผู้อ่าน) |
| P2 | ผู้ขอยืนยันรับเงินแล้ว | PAYOUT ที่ RECORDED อยู่มี `receiptConfirmedAt` |
| P3 | ผู้ขอแจ้งว่ายังไม่ได้รับเงิน: {note} | PAYOUT ที่ RECORDED อยู่มี `receiptDisputedAt` (ผู้จ่ายเห็นปุ่ม [ยกเลิกการจ่าย]) |
| C1 | ใช้เท่ากับเงินทดรองที่ค้างพอดี ไม่ต้องคืนหรือจ่ายเพิ่ม | T = open |
| C2 | ใช้ไป {T} บาท ต้องคืนบริษัท {open−T} บาท | T < open |
| C3 | ใช้ไป {T} บาท บริษัทจ่ายเพิ่มให้ {T−open} บาท | T > open |
| R1 | ยกเลิกการจ่ายไม่ได้ เพราะส่งใบเคลียร์แล้ว ยกเลิกใบเคลียร์ก่อน | void PAYOUT ช่วง `AWAITING_DECISION` หรือ `AWAITING_TOP_UP` [เปิดใบเคลียร์] |
| R1b | ยกเลิกการจ่ายไม่ได้ เพราะมีรายการที่ใช้เงินทดรองนี้แล้ว ยกเลิกรายการนั้นก่อน | void PAYOUT เมื่อมี RETURN, ทาง B หรือใบเคลียร์ที่จบแล้ว [ดูรายการ] |
| R2a | ใบเคลียร์ยังรอตัดสิน ยอดที่ต้องคืนจะรู้หลังอนุมัติ | RETURN ช่วง `AWAITING_DECISION` [เปิดใบเคลียร์] |
| R2b | ใบเคลียร์นี้ใช้เกินเงินทดรอง ไม่มียอดต้องคืน | RETURN ช่วง `AWAITING_TOP_UP` [เปิดใบเคลียร์] |
| R3 | ยอดคืนมากกว่าที่ค้าง {x} บาท แก้ยอดให้ตรง | RETURN เกิน |
| R4 | เงินทดรองจ่ายเข้าบัญชีของคุณเท่านั้น เลือกบัญชีของคุณหรือรับเงินสด | เลือกบัญชีคนอื่น |
| R5 | ตั้งบัญชีรับเงินของคุณก่อน หรือเลือกรับเงินสด | โอน ไม่มีบัญชี (ผู้ทำแทนเห็น "ให้ผู้ขอตั้งบัญชีรับเงินก่อน หรือเลือกรับเงินสด") [ตั้งบัญชีรับเงิน] |
| R6 | เงินทดรองนี้มีใบเคลียร์แล้ว เปิดใบเดิมเพื่อทำต่อ | สร้างใบเคลียร์ซ้ำ [เปิดใบเคลียร์] |
| R8 | ใบนี้บันทึกว่าใช้เงินส่วนตัว จึงใช้เคลียร์เงินทดรองไม่ได้ ถ้าจ่ายด้วยเงินทดรอง ให้ยกเลิกใบรับรองนี้แล้วสร้างใหม่โดยเลือกเงินของร้าน | ผูก source `PERSONAL_ADVANCE` ในใบเคลียร์ ใบรับรองแก้แหล่งเงินไม่ได้ ([prisma-expense.repository.ts:2633-2634](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) [เปิดใบรับรอง] ผู้ที่ไม่มีสิทธิ์ยกเลิกใบรับรองเห็น "ให้ผู้มีสิทธิ์ยกเลิกใบรับรองช่วยยกเลิก แล้วสร้างใหม่โดยเลือกเงินของร้าน" (รอบ 3 F12) |
| R9 | ใบเคลียร์ส่งแล้ว จ่ายจากเงินทดรองนี้ได้หลังใบเคลียร์จบหรือถูกยกเลิก | ทาง B ช่วง CLEARING [เปิดใบเคลียร์] |
| R10 | ย้อนการเคลียร์ไม่ได้ เพราะมีการคืนเงินหรือจ่ายบิลจากเงินทดรองหลังเคลียร์ ยกเลิกรายการนั้นก่อน | ย้อนเมื่อมีรายการภายหลัง [ดูรายการ] |
| R11 | ทำไม่ได้ เพราะงวดบัญชีของรายการนี้ปิดแล้ว ให้นักบัญชีเปิดงวดก่อน | void หรือย้อนในงวดที่ปิด (เฉพาะบริษัทที่เปิดสมุดบัญชี) |
| R12 | ร้านปิดการเบิกจ่ายแล้ว ทำได้เฉพาะเคลียร์เงินทดรองที่รับไปแล้ว | runoff สร้างงานใหม่ |
| A1 | อนุมัติเองเพราะร้านมีผู้อนุมัติคนเดียว | solo |
| A2 | มีเงินทดรองค้างเคลียร์ {n} ใบ รวม {x} บาท | การ์ดผู้อนุมัติ n ≥ 1 |
| H2 | ใช้เงินทดรองจ่าย เลือก เงินของร้าน แล้วเลือกใบเงินทดรอง | wizard ใบรับรอง เมื่อผู้จ่ายมีเงินทดรองค้าง |
| H3 | บิลที่มี VAT หรือหัก ณ ที่จ่าย ให้บันทึกเป็นรายจ่ายของร้านแล้วจ่ายจากเงินทดรอง | หน้าใบเคลียร์ |
| V1 | ย้อนการเคลียร์แล้ว ระบบกำลังยกเลิกใบเคลียร์ เมื่อเสร็จ เงินทดรองจะกลับเป็นรอเคลียร์ | หลังเริ่มย้อน (เงินทดรองยังเป็น CLEARING จนการยกเลิกจบ) |
| X1 | ปุ่มนี้หมดอายุแล้วค่ะ เปิดดูในเว็บได้เลย | token ปุ่มเปิดหมดอายุ (LINE) [ดูรายละเอียด] |
| R13 | ออกใบรับรองไม่ได้ เพราะเงินทดรอง AD-… รับยอดนี้ไม่ได้ ({เหตุ}) เลือกใบอื่น หรือเลือกไม่ใช้เงินทดรอง | ออกใบรับรองแบบผูกเงินทดรองแล้วเงินทดรองกำลังเคลียร์ ยอดไม่พอ หรือปิดแล้ว; {เหตุ} คือ "กำลังเคลียร์" หรือ "เหลือ {open} บาท" หรือ "เคลียร์ครบแล้ว" |
| R14 | รายจ่ายนี้บันทึกการจ่ายไว้แล้ว ยกเลิกการจ่ายนั้นก่อน แล้วจึงเลือกจ่ายจากเงินทดรอง | ผูกเงินทดรองกับรายจ่ายที่มีการจ่ายแล้ว [ดูการจ่าย] |
| R15 | ถอนการย้อนการเคลียร์ไม่ได้ ระบบกำลังยกเลิกใบเคลียร์ เมื่อเสร็จแล้วทำใบเคลียร์ใหม่ได้ | ถอนการยกเลิกหลังย้อนการเคลียร์ |
| R16 | ใบเคลียร์กำลังถูกยกเลิก ทำรายการนี้ได้หลังยกเลิกเสร็จ | คืนเงิน ทาง B หรือ void PAYOUT ในช่วง `CANCELLING` (ใช้แทน R1/R2a/R2b/R9 ในช่วงนี้) [เปิดใบเคลียร์] |

| ประโยค | โอน | เงินสด | ร้านคนเดียว | หลายคน | ผู้ขอถูกปิดบัญชี | มีทาง B | ใบเคลียร์ถูกย้อน | จริงทุกกรณี? |
|---|---|---|---|---|---|---|---|---|
| S1–S5 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | กลับเป็น S3 แล้ว S1 | ใช่: derive จากข้อเท็จจริง |
| P1–P3 | ✓ | ✓ | ผู้ขอคือผู้จ่าย: P1 ยังแสดงจนกดยืนยัน | ✓ | ผู้ทำแทนเห็น P1 | — | — | ใช่: ไม่บอกว่าได้รับก่อนยืนยัน (F21) |
| C1–C3 | ✓ | ✓ | ✓ | ✓ | ✓ | ใช้ open ที่หักทาง B แล้ว | ไม่แสดง | ใช่: open ตรึงตอนส่ง และห้ามคืน ห้ามทาง B ระหว่าง CLEARING |
| R1/R1b/R2a/R2b/R9/R10 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ใช่: เลือกตาม `clearing.phase` และรายการจริง (F22) |
| R11 | เฉพาะบริษัทที่เปิดสมุดบัญชี | | | | | | | ใช่: บริษัทที่ไม่เปิดไม่มีงวด จึงไม่แสดง |
| A1/A2 | ✓ | ✓ | A1 แสดง, A2 ไม่แสดง | A2 | — | — | — | ใช่ |
| H2/H3 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ใช่: เป็นคำแนะนำ ไม่ใช่สถานะ |
| R13 | — | ✓ (ใบรับรองจ่ายเงินสดจากเงินทดรอง) | ✓ | ✓ | ✓ | — | — | ใช่: {เหตุ} มาจากสถานะและยอดจริง ณ เวลาออกใบ |
| R14/R15 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | R15 เกิดเฉพาะกรณีนี้ | ใช่ |

### 10.3 LINE (น้องมั่งมี ค่ะ ใช้ปุ่ม)

| การ์ด | ข้อความ | ปุ่ม |
|---|---|---|
| ตัวอย่างคำขอ | หัว "ขอเงินทดรอง" แถว: ยอด / ใช้ทำ / เคลียร์ภายใน / รับเงิน ธนาคาร ••1234 หรือ "รับเงินสด" ท้าย "ยังไม่ได้ส่งค่ะ" | [ส่งขออนุมัติ] [แก้ในเว็บ] |
| หลังส่ง | ส่งขออนุมัติแล้วค่ะ เลขที่ AD-… | [ดูรายละเอียด] |
| ขาดข้อมูล (ถามครั้งเดียว) | ขอยอดเงินและใช้ทำอะไรด้วยค่ะ (ถามเฉพาะที่ขาด ส่วนอื่นใช้ค่าเริ่มต้น) | — |
| ผู้อนุมัติ | มีคำขอเงินทดรองรออนุมัติค่ะ ชื่อ / ยอด / ใช้ทำ / เคลียร์ภายใน / A2 | [อนุมัติ] [ไม่อนุมัติ] (เปิดการ์ดยืนยัน token มี exp) |
| ไม่อนุมัติ | ขอเหตุผลที่ไม่อนุมัติสั้น ๆ ค่ะ | — |
| ผู้ขอเมื่ออนุมัติ | อนุมัติเงินทดรองแล้วค่ะ รอบันทึกจ่าย | [ดูรายละเอียด] |
| ผู้จ่าย | เงินทดรองพร้อมจ่ายค่ะ {ชื่อ} {ยอด} บาท | [บันทึกจ่าย] → "ส่งสลิปโอนเงินในแชตนี้ได้เลยค่ะ" → [ยืนยันจ่าย] |
| ผู้ขอเมื่อบันทึกจ่าย | บันทึกจ่ายเงินทดรอง {ยอด} บาทแล้วค่ะ ได้รับแล้วกดยืนยันได้เลยค่ะ | [ได้รับเงินแล้ว] [ยังไม่ได้รับ] |
| หลังยืนยันรับ | ยืนยันรับเงินแล้วค่ะ เคลียร์ภายใน {วันที่} | [ส่งใบเสร็จเคลียร์] [ดูรายละเอียด] |
| ยังไม่ได้รับ (ผู้ขอ) | ขอรายละเอียดสั้น ๆ ค่ะ เช่น ยังไม่เห็นเงินเข้า | — แล้ว "แจ้งผู้จ่ายแล้วค่ะ" |
| ยังไม่ได้รับ (ผู้จ่าย) | {ชื่อ} แจ้งว่ายังไม่ได้รับเงินทดรอง AD-… ค่ะ | [ดูรายละเอียด] |
| เริ่มเคลียร์ | ส่งรูปใบเสร็จมาได้เลยค่ะ ส่งครบแล้วกด เสร็จแล้ว | [เสร็จแล้ว] |
| ตัวอย่างใบเคลียร์ | หัว "เคลียร์เงินทดรอง AD-…" ใบเสร็จไม่เกิน 5 แถว (+ "อีก n ใบ") / รวม / C1–C3 / "ยังไม่ได้บันทึกค่ะ" | [บันทึกร่าง] [แก้ในเว็บ] แล้ว [ส่งอนุมัติ] |
| ใกล้ถึงวัน | พรุ่งนี้ครบกำหนดเคลียร์เงินทดรอง AD-… ค่ะ | [ส่งใบเสร็จเคลียร์] |
| เลยกำหนด | เลยกำหนดเคลียร์เงินทดรอง AD-… มา {n} วันแล้วค่ะ | [ส่งใบเสร็จเคลียร์] [คืนเงินทั้งหมด] |
| ต้องคืน | เคลียร์แล้วค่ะ เหลือเงินต้องคืนบริษัท {x} บาท โอนแล้วส่งสลิปในแชตนี้ได้เลยค่ะ | [ส่งสลิปคืนเงิน] |
| ผู้จ่ายตรวจคืน | {ชื่อ} ส่งสลิปคืนเงินทดรอง {x} บาทค่ะ | [ยืนยันรับเงินคืน] [ดูรายละเอียด] |
| ปุ่มหมดอายุ | X1 | [ดูรายละเอียด] |

- ปุ่มเปิดในแจ้งเตือนเป็นแค่ตัวเปิด การ์ดยืนยันเป็นตัวเขียนและ re-read สถานะเสมอ (F26)
- ปุ่ม postback ไม่เรียก model ส่วนการเรียก model ที่ล้มเหลวหรือหมดเวลาไม่คิดเงิน ตามกลไกเครดิตเดิม

### 10.4 แจ้งเตือน (เฉพาะคนที่เกี่ยว)

**ปิดแจ้งเตือนเมื่องานเสร็จ (รอบ 2 F10)** เพิ่มรายการใน `DOCUMENT_NOTIFICATION_STATES` ([document-notification-state.ts:16-38](../../apps/api/src/modules/dashboard-notifications/infrastructure/document-notification-state.ts)) ด้วย `sourceType: 'cash_advance'`:
- `cash_advance_pending_approval` เปิดเมื่อสถานะเป็น PENDING_APPROVAL
- `ready_for_payout` เปิดเมื่อสถานะเป็น APPROVED
- `paid_requester` เปิดเมื่อสถานะเป็น PAID และ PAYOUT ที่ RECORDED อยู่ยังไม่มี `receiptConfirmedAt` (รอบ 3 F10)
- `receipt_disputed` เปิดเมื่อสถานะเป็น PAID และ PAYOUT ที่ RECORDED อยู่มี `receiptDisputedAt`
- `clearing_due` เปิดเมื่อสถานะเป็น PAID
- `return_due` เปิดเมื่อสถานะเป็น SETTLING
- `return_slip_submitted` เปิดเมื่อสถานะเป็น PAID **หรือ** SETTLING และมี `returnSlipAttachmentId` ที่ยังไม่ถูกยืนยัน (รอบ 3 F9: คืนทั้งหมดเกิดตอน PAID)

ขยาย `completedDocumentNotificationIds` ให้โหลด `cashAdvance` และ `finishDocumentWaitingNotifications` ([:115](../../apps/api/src/modules/dashboard-notifications/infrastructure/document-notification-state.ts)) ให้รับ `cash_advance` แล้วเรียกหลังทุก transition (รวมยกเลิก, ปิด, ย้อนการเคลียร์ และ void) แจ้งเตือนที่งานจบแล้วจะปิดเองทั้งในกระดิ่งและในรายการรอทำ

trigger ทุกตัวลงทะเบียนในสามที่ (F8): `IMPLEMENTED_TRIGGER_KEYS`, `ALWAYS_DELIVERED_TRIGGER_KEYS` (เพราะรายการที่ผู้ใช้บันทึกไว้ก่อนหน้าไม่มี trigger ใหม่ และเรื่องนี้เป็นเงินที่ค้างกันอยู่) และ `NOTIFICATION_TRIGGER_FEATURE_KEYS: ['reimbursement']`

| trigger | ผู้รับ | สำรอง |
|---|---|---|
| `workflow.cash_advance_pending_approval` | ผู้อนุมัติที่ตรึง ยกเว้นผู้ทำ | owner fallback เดิม |
| `workflow.cash_advance_decision_requester` | ผู้ขอ | — |
| `workflow.cash_advance_ready_for_payout` | ผู้ที่ถึงคิวจ่าย (ลำดับเดียวกับ "พร้อมจ่าย" ของใบเบิก) ในสาขาของใบ **ไม่ตัดผู้ทำ** ผู้อนุมัติที่จ่ายได้ต้องได้งานจ่ายของตัวเอง ตามแม่แบบใบเบิก ([workflow-template-catalog.ts:526-536](../../apps/api/src/modules/workflow/domain/workflow-template-catalog.ts), รอบ 3 F8) | ทุกคนที่จ่ายได้ในสาขา |
| `workflow.cash_advance_paid_requester` | ผู้ขอ (P1 พร้อมปุ่มยืนยัน) | — |
| `workflow.cash_advance_receipt_disputed` | ผู้ที่บันทึกจ่าย ถ้ายังจ่ายได้ | ทุกคนที่จ่ายได้ในสาขา |
| `workflow.cash_advance_clearing_due` (SLA_SCAN) | ผู้ขอ: 1 วันก่อน, วันแรกที่เลย, แล้วทุก 3 วัน ไม่เกิน 5 ครั้ง แต่ละครั้งมี payload `notificationPeriodKey = clearing_due:{advanceId}:{reminderNo}` ซึ่งคงเดิมเมื่อ retry ไม่งั้น scan จะใช้ delivery เดิมที่ SENT แล้ว ([workflow-action-runner.use-case.ts:64-70](../../apps/api/src/modules/workflow/application/use-cases/workflow-action-runner.use-case.ts), รอบ 3 F11) | ผู้ขอถูกปิด: `finance_review` ของสาขา ถ้าไม่มีให้เจ้าของ |
| `workflow.cash_advance_return_due` | ผู้ขอ | เหมือนข้างบน |
| `workflow.cash_advance_return_slip_submitted` | ผู้ที่จ่ายเงินทดรองใบนั้น ถ้ายังจ่ายได้ | ทุกคนที่จ่ายได้ในสาขา |
| ใบเคลียร์ | แม่แบบใบเบิกเดิม ข้อความเพิ่ม "เคลียร์เงินทดรอง AD-…" | — |

## 11. Impact analysis

| พื้นที่ | ผลกระทบ |
|---|---|
| Prisma/migration | 2 ตาราง + 2 enum; คอลัมน์ใบเบิก 4; `ExpensePayment.cashAdvanceId`; นโยบาย 1; partial unique + CHECK |
| Reimbursements | domain/use-case/repository/controller ใหม่ ได้แก่ submit (O, payout gate), projection (settle 0, ปัน O), payment + void (`claimPayableAmount`, refresh), cancel/reject/reopen (refresh), reverse-clearing, parser snapshot (F6), source (R8), `branch-in-flight.ts` และ reconciler |
| Attachments (F1/F7) | upload intent/complete แบบรู้จักเงินทดรอง; `isReimbursementPaymentSlip`, `NOT_REIMBURSEMENT_PAYMENT_SLIP_WHERE`, `isReimbursementPaymentSlipFile` และ guard ใน `create-download-url.use-case.ts:88-100` รู้จัก link ใหม่; endpoint เปิดไฟล์ของเงินทดรอง |
| Expenses | `RecordExpensePaymentUseCase` (ทาง B) และ void; wizard ใบรับรอง H2; รายจ่ายจากใบเคลียร์ `vendorNameSnapshot = 'เคลียร์เงินทดรอง: {ชื่อ}'`; การออกใบรับรองแบบเงินของร้านผูก `cashAdvanceId` ในการจ่ายอัตโนมัติ (`prisma-expense.repository.ts:3081-3112`, รอบ 2 F1) + R13/R14; ยกเลิกการจ่ายทาง B ใช้ `expense.payment.record` |
| Banking (ไม่ได้ขาย) | `prisma-match-source.query.ts` ตัด `ExpensePayment` ที่มี `cashAdvanceId` และไม่เสนอ movement ของเงินทดรองรอบนี้ |
| Ledger (ไม่ได้ขาย) | source `cash_advance.payout`, `.return`, `.offset`, `expense.payment` ที่มี `cashAdvanceId` (Cr 1152-00); true reversal ใน tx (F15); period close นับรายการค้างลงบัญชีของเงินทดรอง (F16, `period.use-case.ts:132-170`); B4 |
| Notifications/workflow (F8/F9) | แม่แบบ autoEnable 8 ตัว (cooldown 0), ลงทะเบียน trigger สามที่, `findSourceBranchId('cash_advance')`, candidate SLA, `sync-workflow-templates.ts`; `DOCUMENT_NOTIFICATION_STATES` + `finishDocumentWaitingNotifications('cash_advance')` (รอบ 2 F10) |
| LINE/AI (F10/F19) | `toolMap`; `LINE_REIMBURSEMENT_DRAFT_TOOL_NAMES` (ACTION ref); `READ_MEMORY_TOOLS` + shownItems; action target validation; draft adapter (ADVANCE choice); การ์ด §10.3; token มี exp; REFUSAL map; capability cards; helper `isLineDraftActionTool` แทน prefix `reimbursement.draft.` ทั้ง API และ gateway (รอบ 2 F6); migration ของ `ReimbursementDraftAction` (รอบ 2 F5) |
| ถอด env flag (F18) | `LINE_AI_REIMBURSEMENT_DRAFT_WRITE_ENABLED` ถูกถอดออกทั้งหมด ได้แก่ config, app-config getter, `ai-tools.ts:37-42`, `internal-tools.controller.ts:670-672`, `line-reimbursement-draft.use-case.ts:332, 534`, `process-line-webhook.use-case.ts` (495, 2544, 7713, 7803, 9663, 11276), manifest (65, 139, 435, 449) และข้อความ `feature_disabled` ของการ์ดร่าง (ร่างใบเบิกใน LINE จึงเปิดเสมอ) ก่อน deploy ต้องตรวจ env ของ UAT/Production ว่าไม่มีใครตั้งเป็น false (runbook) รวมฝั่ง gateway `semantic-turn-v2.ts` ที่บรรทัด 624, 712, 714, 745 และ 790 (`reimbursementDraftEnabled`) |
| AI Gateway | router รู้จัก tool ใหม่; ตรวจ ACTION ref (ใช้รายชื่อเดิม); B3; approved help การ์ดใหม่ + version + contentHash (หมดอายุ 27 ธ.ค. 2569) |
| W00 manifest | operation/tool ใหม่ ไม่มี runtime flag แล้ว regenerate |
| Whole-chain catalog | scenario `cash-advance-request-and-photo-clearing` (ส่วนเสริม test หลักอยู่ในไฟล์ที่ package.json ระบุ) |
| Employee access | คำอธิบาย pack สี่ตัว (§8); หน้าปิดบัญชีพนักงานเตือนหนึ่งบรรทัดถ้ามีเงินทดรองค้าง |
| Feature gate (F17) | ชุดสิทธิ์ runoff แบบจำกัด + การตรวจใน use-case |
| Audit | `cash_advance.*` รวม reveal, slip open/deny, reverse-clearing |
| Billing/entitlement | ไม่มี key ใหม่ ทุก tier ได้ |
| Journeys/seed | `e2e/journeys/cash-advance-paid-then-cleared.journey.spec.ts`; seed sequence + ตัวอย่าง 3 สถานะ |

## 12. Gaps

- G1 ยังจ่ายใบสำคัญจ่ายจากเงินทดรองไม่ได้ ทาง B ใช้การบันทึกจ่ายรายจ่ายรายการเดียว
- G2 ทาง B ยังทำผ่าน LINE ไม่ได้
- G3 ไม่มีวงเงินทดรองสูงสุดต่อคนหรือต่อครั้ง (มีแค่ A2)
- G4 ไม่มีรายงานอายุเงินทดรองและไฟล์ส่งออก
- G5 ระบบไม่ตรวจว่าวันที่ในใบเสร็จอยู่ในช่วงวันที่ใช้เงิน
- G6 ช่วง runoff ไม่มีแจ้งเตือนของเงินทดรอง ใช้ ownership เดียวกับใบเบิก
- G7 ไม่มีการจับคู่การจ่ายและการคืนเงินทดรองกับรายการเดินบัญชี

## 13. Bugs found in current code

| # | ที่ | สถานการณ์ที่ล้ม | ความรุนแรง |
|---|---|---|---|
| B3 | [ai-tools.ts:1289](../../packages/contracts/src/ai-tools.ts) บอก model ว่า "Approving and paying happen only on the web." แต่ `expense.action.preview` อนุมัติและจ่ายได้ ([ai-tools.ts:626](../../packages/contracts/src/ai-tools.ts), [line-expense-action.service.ts:515-523](../../apps/api/src/modules/line-ai/application/line-expense-action.service.ts)) | ผู้อนุมัติอาจถูกบอกให้ไปทำในเว็บ ทั้งที่ทำใน LINE ได้ (ยังไม่ได้เล่นซ้ำกับ model จริง) | ต่ำ |
| B4 | [posting-engine.logic.ts:194](../../apps/api/src/modules/ledger/domain/logic/posting-engine.logic.ts) บรรยายว่า "จ่ายคืนเงินทดรองพนักงาน" ทั้งที่บรรทัดนี้ล้างเจ้าหนี้พนักงาน | สมุดรายวันใช้คำเดียวกันกับสองเรื่องที่ต่างกัน | ต่ำ |
| B5 | [reimbursement.logic.ts:585-598](../../apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic.ts) บอก `PAID → [VOIDED]` แต่ void เขียน `READY_FOR_PAYMENT` ([prisma-reimbursement.repository.ts:4286-4289](../../apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts)) | โค้ดใหม่ที่ใช้ `canTransition` จะปฏิเสธการย้อนที่ถูกต้อง | ต่ำ (แฝง) |
| B8 | token ปุ่มเปิดอนุมัติใบเบิกไม่มีวันหมดอายุ ([line-reimbursement-approval-control.logic.ts:5-11](../../apps/api/src/modules/line-ai/domain/logic/line-reimbursement-approval-control.logic.ts)) | ข้อความแจ้งเตือนเก่าหรือที่ถูกส่งต่อ ยังเปิดการ์ดยืนยันได้ตลอดไป แม้การเขียนจะตรวจสิทธิ์และสถานะซ้ำ | ต่ำ |
| B9 | ร่างใบเบิกใน LINE ปิดได้ด้วย env flag ([packages/config/src/index.ts:34](../../packages/config/src/index.ts), [internal-tools.controller.ts:670-672](../../apps/api/src/modules/line-ai/presentation/http/internal-tools.controller.ts)) | ขัดกติกาเจ้าของที่ว่าทุกอย่างเปิดเสมอ ถ้ามีคนตั้ง false ลูกค้าจะเห็น "ปิดการบันทึกร่างใบเบิกจาก LINE ชั่วคราว" | ต่ำ–ปานกลาง (กฎ) |
| อ้างอิง | budget spec B1 (หมวด), B2 (สองชุด) และ B7 (LINE นับไฟล์ต้นทางกับรายจ่ายจากใบเบิกซ้ำ) | ใบเคลียร์ติดปัญหาเดียวกัน | ปานกลาง |

## 14. Test plan

ไฟล์ API ทั้งหมดอยู่ใน `apps/api/package.json` แล้ว ไฟล์ที่รันเฉพาะใน whole-chain เป็นแค่ส่วนเสริม

| ไฟล์ | เคส |
|---|---|
| `reimbursement.logic.spec.ts` | `deriveCashAdvanceStatus` ทุกแถว §9 (รวมทาง B และ CANCELLING); offset/outcome/phase; `claimPayableAmount`; transition หลัง B5; parser snapshot (`cashAdvance` ถูก/ผิดรูป) |
| `reimbursement-request.use-case.spec.ts` | สร้าง/ส่งคำขอ; R4; ต้องอนุมัติเสมอ; ใบเคลียร์: mismatch, R6, R8, payout gate ข้ามเมื่อ 0; runoff (§5.9): ใบเคลียร์ทำได้ ใบใหม่ถูกปฏิเสธ |
| `reimbursement-approval.use-case.spec.ts` | ตัดสินคำขอ; LINE ADVANCE_* ผ่าน `LineExpenseActionService`; advanceId ที่ไม่ได้มาจาก shownItems ถูกปฏิเสธ |
| `reimbursement-finance.use-case.spec.ts` | PAYOUT (สลิป), ยืนยัน/โต้แย้งรับเงิน, void PAYOUT (R1/R1b), RETURN (R2a/R2b/R3), จ่ายส่วนเพิ่ม, reverse-clearing (R10/R11 และผล) |
| `prisma-reimbursement.repository.payment-mirror.spec.ts` | ปัน O; settle 0; void ส่วนเพิ่ม; ย้อนการเคลียร์คืน mirror |
| `prisma-reimbursement.repository.draft-submit-race.spec.ts` (PostgreSQL จริง) | partial unique; RETURN กับ submit ใบเคลียร์พร้อมกัน; ทาง B กับ submit ใบเคลียร์พร้อมกัน; CHECK; refresh ใน tx |
| `record-expense-payment.use-case.spec.ts` + `prisma-expense.repository.payment.spec.ts` (PG) | ทาง B: สิทธิ์ สาขา สกุลเงิน ยอดเกิน R9, void แล้ว refresh |
| `create-download-url.use-case.spec.ts`, `delete-attachment.use-case.spec.ts`, `prisma-attachment.repository.spec.ts`, `attachment.logic.spec.ts`, `complete-attachment-upload.use-case.spec.ts` | สลิปเงินทดรองดาวน์โหลดทางทั่วไปไม่ได้ ลบไม่ได้ ไม่ขึ้นในรายการ ใช้เป็นใบเสร็จไม่ได้ อัปโหลด RETURN โดยผู้ขอได้ แต่ PAYOUT โดยผู้ขอไม่ได้ |
| `notification.logic.spec.ts` | trigger ใหม่อยู่ครบสามทะเบียน |
| `workflow-action-runner.use-case.spec.ts` | `findSourceBranchId('cash_advance')`; ผู้รับจากสาขาอื่นไม่ได้รับ |
| `workflow-scan.use-case.spec.ts`, `workflow-template-auto-enable.spec.ts` | SLA เคลียร์ (1 วันก่อน, เลย, ทุก 3 วัน, ไม่เกิน 5, สำรอง) |
| `feature-gate.logic.spec.ts` | ชุดสิทธิ์ runoff แบบจำกัด |
| `internal-tools.controller.spec.ts` | tool ใหม่ผ่าน dispatch และ category admission โดยไม่มี flag; flag เดิมถูกถอด |
| `erp-reimbursement-tools.use-case.spec.ts` | `list_open` และ `readMemoryEvidence` สกัด advanceId |
| `process-line-webhook.use-case.spec.ts` | preview_create → ยืนยัน → create+submit; ถามครั้งเดียว; การ์ดใบเคลียร์ C1–C3; token หมดอายุ X1 |
| `reimbursement-payment-posting.use-case.spec.ts`, `reimbursement-expense-posting.logic.spec.ts`, `expense-payment-posting.use-case.spec.ts`, `period-reimbursement-close.use-case.spec.ts`, `template-company-posting.use-case.spec.ts` | posting ใหม่, true reversal, งวดปิด R11, period close นับรายการค้าง, B4 |
| `prisma-match-source.query.spec.ts` | ExpensePayment ที่มี cashAdvanceId ไม่ถูกเสนอให้จับคู่ |
| `substitute-receipt.use-case.spec.ts` | H2 ไม่เปลี่ยนกติกา; COMPANY certificate จ่ายจากเงินทดรองได้ |
| gateway `erp-tool.client.spec.ts` | ACTION ref ของ `reimbursement.advance.preview_create` ผ่าน |
| รอบ 2: `prisma-reimbursement.repository.draft-submit-race.spec.ts` (PostgreSQL จริง) | `ReimbursementDraftAction` แบบ ADVANCE_CREATE: insert, PREVIEW → APPLIED พร้อม `cashAdvanceId`, replay ได้ผลเดิม, แถว CREATE/UPDATE เดิมผ่าน constraint ใหม่; ถอนการยกเลิกหลังย้อนการเคลียร์ถูกปฏิเสธ (R15); ยกเลิกใบเคลียร์ที่อนุมัติแล้วแบบมีส่วนเพิ่มปล่อย O ตอนจบเท่านั้น; ถอนการยกเลิกปกติก่อน void รายจ่ายแรกไม่แตะ O; งวดปิดตอนจบแล้วทั้ง tx ล้มและใบยังเป็น CANCELLING |
| รอบ 2: `substitute-receipt.use-case.spec.ts` + `prisma-expense.repository.substitute-payment.spec.ts` (PostgreSQL จริง) | ใบรับรองแบบเงินของร้านที่ผูกเงินทดรอง: การจ่ายอัตโนมัติมี `cashAdvanceId` และเงินทดรองถูก refresh ใน tx; R13 (กำลังเคลียร์/ยอดไม่พอ/ปิด); R14 (มีการจ่ายก่อน); CHECK `PERSONAL_ADVANCE` ห้ามผูก |
| รอบ 2: `reimbursement-finance.use-case.spec.ts` + `prisma-reimbursement.repository.payment-mirror.spec.ts` | void การจ่ายส่วนเพิ่มแล้วเงินทดรองเป็น CLEARING ไม่ใช่ PAID และทาง B ถูกปฏิเสธ (R9) |
| รอบ 2: `dashboard-notification-correctness.spec.ts` (PostgreSQL จริง) + `notification.logic.spec.ts` | แจ้งเตือนของเงินทดรองปิดเองเมื่ออนุมัติ จ่าย ยืนยันรับเงิน เคลียร์ คืนครบ ยกเลิก หรือย้อน |
| รอบ 2: `process-line-webhook.use-case.spec.ts` | `isLineDraftActionTool` ครอบ tool ใหม่: หลักฐาน ACTION ผ่าน (line-read-evidence) และการ์ดยืนยันถูกโหลด (บรรทัด 8855) ส่วนเสริมคือ semantic-turn spec ของ gateway ในชุด whole-chain |
| รอบ 2: `reimbursement-request.use-case.spec.ts` / `reimbursement-approval.use-case.spec.ts` | runoff: อนุมัติ ตรวจการเงิน จ่ายส่วนเพิ่ม ยืนยันรับคืน และย้อน ทำได้เมื่อ entitlement ปิด ส่วนสร้างหรือส่งงานใหม่ถูกปฏิเสธ (R12) |
| รอบ 3: gateway `line-ai-turn.use-case.spec.ts` (gateway ระบุแล้ว) + เสริม semantic-turn spec ในชุด whole-chain | F1: lookup → `ADVANCE_APPROVE` preview ผ่าน, อ้างใบจาก recentReads ผ่าน, `advanceId` ที่ไม่ได้มาจากผลอ่านถูกปฏิเสธ |
| รอบ 3: `reimbursement-request.use-case.spec.ts` | F4: ใบเคลียร์ถูกตีกลับ → reopen → offset เป็น 0 → ลดยอดได้ → ส่งใหม่แล้วตรึง O ใหม่ |
| รอบ 3: `record-expense-payment.use-case.spec.ts` + `prisma-expense.repository.payment.spec.ts` (PG) | F5: ทาง B ที่ลงบัญชีแล้วในงวดเปิดยกเลิกได้พร้อม true reversal งวดปิดได้ R11 |
| รอบ 3: `reimbursement-finance.use-case.spec.ts` | F10: ยืนยันรับ → void PAYOUT → PAYOUT ใหม่เป็นยังไม่ยืนยันและเตือนอีกครั้ง |
| รอบ 3: `dashboard-notification-correctness.spec.ts` (PG) + `workflow-action-runner.use-case.spec.ts` + `workflow-scan.use-case.spec.ts` | F9: สลิปคืนตอน PAID ยังเปิดงานของผู้จ่าย; F8: ผู้อนุมัติที่จ่ายได้ได้งานจ่าย; F11: เตือนเลยกำหนดครั้งที่ 2 ส่งได้จริง (period key ต่างกัน) และ retry ไม่ส่งซ้ำ |
| web (glob) | `cash-advance.logic.spec.ts` (ตาราง §10.2 ทุกเซลล์), rendered/qa ของ hub ฟอร์ม และ journey |
| journey | `e2e/journeys/cash-advance-paid-then-cleared.journey.spec.ts` (สองคน และเจ้าของคนเดียว) ที่ 390, 1,280 และ ~1,556 px |
| เสริม | `line-ai-capability-manifest.spec.ts`, `line-reimbursement-draft-card.logic.spec.ts`, `line-reimbursement-draft-adapter.pg.spec.ts` และ `node scripts/run-line-ai-whole-chain-acceptance.mjs` |

## 15. Acceptance criteria

| # | Scenario | ผลที่ต้องได้ |
|---|---|---|
| AC1 | ขอ 5,000 (โอน) → อนุมัติ → ผู้จ่ายแนบสลิปแล้วบันทึกจ่าย | PAID, ผู้ขอได้ "บันทึกจ่ายเงินทดรอง 5,000.00 บาทแล้วค่ะ…" พร้อม [ได้รับเงินแล้ว] [ยังไม่ได้รับ]; journey แสดง P1 จนกว่าจะยืนยัน |
| AC2 | ผู้ขอกด [ยังไม่ได้รับ] | ผู้จ่ายได้แจ้งเตือน journey แสดง P3 และปุ่มยกเลิกการจ่ายของผู้จ่ายใช้ได้ |
| AC3 | เคลียร์ 4,250 (ทาง A) แล้วอนุมัติ | ใบเคลียร์ PAID ไม่มีแถว payment, เงินทดรอง SETTLING returnDue 750 |
| AC4 | แนบสลิปคืน 750 ผู้จ่ายยืนยัน | CLOSED |
| AC5 | ใบกำกับเต็มรูป 1,070 ในนามบริษัทบันทึกเป็นรายจ่ายของร้าน แล้วจ่ายจากเงินทดรอง (ทาง B) จากนั้นเคลียร์ใบเสร็จ 3,000 (ทาง A) | open หลังทาง B = 3,930; O = 3,000; returnDue 930; ภาษีซื้อของบิลยังขอคืนได้; ไม่มีรายจ่ายซ้ำ |
| AC6 | เคลียร์ 5,600 | ใบเคลียร์ค้างจ่าย 600; "ค้างจ่ายทั้งหมด" บนหน้าแรกเพิ่ม 600; จ่ายแล้ว CLOSED |
| AC7 | ไม่ได้ใช้ กด [คืนเงินทั้งหมด] และยืนยัน | CLOSED |
| AC8 | คืนเงินระหว่างใบเคลียร์รออนุมัติ / ระหว่างรอจ่ายส่วนเพิ่ม | R2a / R2b พร้อม [เปิดใบเคลียร์] ไม่มีการเขียน |
| AC9 | ย้อนการเคลียร์ของ AC3 (ยังไม่มีการคืน) | V1; ใบเคลียร์ CANCELLED; รายจ่ายจากใบเคลียร์ VOIDED; เงินทดรอง PAID open 5,000; บัญชีหักกลบถูกย้อน (บริษัทที่เปิดสมุดบัญชี) |
| AC10 | ย้อนการเคลียร์หลัง AC4 | R10; ยกเลิก RETURN ก่อนแล้วย้อนได้ |
| AC11 | สองแท็บสร้างใบเคลียร์พร้อมกัน | สำเร็จหนึ่ง อีกหนึ่ง 409 + R6 |
| AC12 | สลิปเงินทดรอง: เปิดผ่าน `/attachments/:id/download-url` ทั่วไป และลบ | 403 + audit DENIED และลบไม่ได้; เปิดผ่าน endpoint ของเงินทดรองโดยผู้ขอได้ |
| AC13 | ผู้ขอที่ไม่มี `payment.record` อัปโหลดสลิปคืน / สลิปจ่าย | คืนได้ / จ่ายถูกปฏิเสธ |
| AC14 | เจ้าของคนเดียวขอและอนุมัติเอง | `selfApproved`, A1, audit `via: solo` |
| AC15 | เลยกำหนด 1 วัน และผู้ขอถูกปิดบัญชี | ผู้ขอได้หนึ่งครั้ง / ถ้าถูกปิดให้ finance_review ของสาขาได้แทน; ผู้จ่ายสาขาอื่นไม่ได้รับ |
| AC16 | ร้านถูกปิดฟีเจอร์ใบเบิกขณะมีเงินทดรอง PAID | สร้างและส่งใบเคลียร์ได้ คำขอใหม่และใบเบิกปกติได้ R12 |
| AC17 | LINE "ขอเบิกเงินทดรอง 3,000 ซื้อของจัดงาน" บน environment ที่ไม่มี env flag ใด ๆ | การ์ดตัวอย่างค่าเริ่มต้นครบ ไม่ถามซ้ำ ส่งได้; tool ผ่าน controller และ gateway |
| AC18 | ปุ่มอนุมัติในแจ้งเตือนอายุ 8 วัน | X1 ไม่มีการ์ดยืนยัน |
| AC19 | ทุกหน้าและ dialog ที่เปลี่ยน | ภาพจาก browser จริงที่ 390, 1,280 และ ~1,556 px; กลุ่มปุ่มวัดแล้วว่าเท่ากัน; ปุ่มของฟอร์มอยู่แถบล่าง; หน้าเต็มกว้าง |
| AC20 | ใบรับรองแบบเงินของร้าน 450 บาท ผูก AD ที่ค้าง 5,000 แล้วออกใบ | การจ่ายอัตโนมัติ 450 มี `cashAdvanceId` รายจ่าย PAID เงินทดรองค้าง 4,550 ไม่มีการจ่ายซ้ำ |
| AC21 | ออกใบรับรองที่ผูก AD ระหว่างกำลังเคลียร์ | R13 และไม่มีการออกใบ |
| AC22 | ย้อนการเคลียร์แล้วกดถอนการยกเลิก | R15 ใบยกเลิกต่อจนจบ และเงินทดรองเป็น PAID open 5,000 |
| AC23 | AD 5,000 เคลียร์ 5,600 อนุมัติแล้ว จ่าย 600 จากนั้น void 600 | เงินทดรอง CLEARING (`AWAITING_TOP_UP`) ทาง B ถูกปฏิเสธ (R9) |
| AC24 | ต่อจาก AC23 ยกเลิกใบเคลียร์ | ระหว่างยกเลิกเป็น CLEARING (`CANCELLING`) เมื่อจบเป็น PAID open 5,000 และบัญชีหักกลบถูกย้อนครั้งเดียว |
| AC25 | LINE: กดยืนยันการ์ดคำขอเงินทดรองสองครั้ง | คำขอหนึ่งใบ draft action APPLIED พร้อม `cashAdvanceId` และการกดครั้งที่สองได้ผลเดิม |
| AC26 | ผู้อนุมัติอนุมัติแล้ว | แจ้งเตือน "รออนุมัติ" ของเงินทดรองปิดในกระดิ่งของทุกผู้อนุมัติ |
| AC27 | ร้านถูกปิดฟีเจอร์ใบเบิกขณะใบเคลียร์รออนุมัติ | ผู้อนุมัติอนุมัติได้ ผู้จ่ายจ่ายส่วนเพิ่มได้ และเงินทดรองจบได้ |
| AC28 | LINE: "ใครยังไม่เคลียร์เงินทดรอง" แล้ว "อนุมัติใบ AD-…" (F1) | การ์ดยืนยันอนุมัติของใบนั้น ไม่ถูกปฏิเสธที่ gateway |
| AC29 | ยืนยันรับเงินแล้ว ผู้จ่าย void แล้วจ่ายใหม่ (F10) | journey แสดง P1 ไม่ใช่ P2 และผู้ขอได้การ์ด [ได้รับเงินแล้ว] อีกครั้ง |
| AC30 | ไม่ได้ใช้เงิน แนบสลิปคืนทั้งหมดตอน PAID (F9) | ผู้จ่ายได้งาน "ตรวจรับเงินคืน" ที่ยังเปิดอยู่จนยืนยัน |
| AC31 | เลยกำหนด 1 วัน และ 4 วัน (F11) | ผู้ขอได้สองข้อความแยกกัน |

## 16. Risks/rollout

- เส้นจ่ายเงินของใบเบิกถูกแตะ ใบเบิกปกติมี offset 0 ต้องมี test ว่าผลเท่าเดิมทุกไบต์
- `refreshCashAdvance` ต้องอยู่ในทุก tx ที่แตะใบเคลียร์ การจ่ายรายจ่ายที่มี `cashAdvanceId` และ movement ให้ทำ checklist จากการค้น `reimbursementRequest.update*` และ `expensePayment.*` แล้วให้ reconciler ตรวจแคชที่ไม่ตรงกับ derive
- การถอด env flag เปลี่ยนพฤติกรรมเฉพาะ environment ที่ตั้งเป็น false ต้องตรวจ env จริงก่อน deploy และบันทึกใน runbook
- การเปลี่ยนชั้นตรวจของ runoff (§5.9) ต้องมี test ว่าใบเบิกปกติยังถูกปฏิเสธเหมือนเดิม
- ลำดับ deploy: migration → API → web → gateway → `sync-workflow-templates` → W00 regenerate → whole-chain acceptance
- UAT ต้องพิสูจน์ AC1–AC9 ด้วยสลิปจริงก่อนขอเจ้าของเลื่อนขึ้น Production

### 16.1 Must close before coding

#### Blockers หลังการตรวจ blocker แบบเจาะจง (2026-10-24)

รีวิวเต็มครบสามรอบ และตรวจ blocker แบบเจาะจงแล้ว ผลของ spec และ plan นี้คือไม่มี HIGH เปิดค้าง แต่ Phase 3 (การเคลียร์) รอ budget Phase 0.3 ซึ่ง F2 ต้องรีวิวก่อน (ดู budget spec §16.1)

| # | สถานะ | เกี่ยวกับ spec นี้อย่างไร | Gate ก่อนเริ่ม |
|---|---|---|---|
| F1 | **ปิดแล้ว** (ตรวจ blocker 2026-10-24) | gateway รู้จัก `ADVANCE_*` และ `advanceId` (§7) | test ใน gateway `line-ai-turn.use-case.spec.ts` ต้องผ่านตอน implement |
| F2 | ออกแบบแล้ว ต้องรีวิวก่อน budget Phase 0.3 (ฝั่งงบ) | ใบเคลียร์ที่ผูกใบรับรองที่หมวดไม่ชัดใช้เอกสารแก้ไขแบบแก้หมวดที่พักค่าไว้และเขียนตอนออกใบ | **cash Phase 3 ทั้งหมดรอ budget Phase 0.3** |
| F3 | **ปิดแล้ว** (ตรวจซ้ำ 2026-10-24) | ยอดของใบเคลียร์ในงบต้องไม่นับซ้ำ | budget Phase 0.5/2.2 ผ่านการตรวจ ก่อนเริ่ม cash Phase 3.3 |
| F4 | **ปิดแล้ว** (ตรวจซ้ำ 2026-10-24) | รายจ่ายจากใบเคลียร์ที่ผูกต้นทางแบบมีแค่ hint ต้องได้หมวด | budget Phase 0.2 ผ่านการตรวจ ก่อนเริ่ม cash Phase 3.3 |

## 17. Open questions (เรื่องธุรกิจของเจ้าของ)

| # | คำถาม | คำแนะนำ |
|---|---|---|
| Q1 | คนที่ยังมีเงินทดรองค้าง ขอใบใหม่ได้ไหม | ได้ และผู้อนุมัติเห็นยอดค้าง (A2) |
| Q2 | วันเคลียร์ค่าเริ่มต้นหลังวันใช้เงินวันสุดท้าย | 7 วัน (ร้านตั้งได้ 1–90) |
| Q3 | คำขอเงินทดรองต้องอนุมัติทุกใบไหม | ทุกใบ (ร้านคนเดียวอนุมัติเองได้) |
