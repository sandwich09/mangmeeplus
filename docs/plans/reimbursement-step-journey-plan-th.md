# แผนงาน: การเบิกจ่ายแบบขั้นตอน (ผู้เบิกกับผู้อนุมัติ รองรับเจ้าของร้านคนเดียว)

## เอกสารที่เชื่อมโยง

- สเปค: [reimbursement-step-journey-spec-th.md](../specs/reimbursement-step-journey-spec-th.md)
- สถานะงาน: [reimbursement-step-journey.md](../agent-memory/reimbursement-step-journey.md)
- สเปคที่เกี่ยวข้อง: [reimbursement-approval-spec.md](../specs/reimbursement-approval-spec.md), [reimbursement-approver-routing-policy-spec.md](../specs/reimbursement-approver-routing-policy-spec.md), [reimbursement-journey-uplift-spec.md](../specs/reimbursement-journey-uplift-spec.md), [substitute-receipt-company-payer-spec.md](../specs/substitute-receipt-company-payer-spec.md)
- แนวทาง: `docs/guidelines/web-frontend-code-style.md`, `docs/guidelines/backend-hexagonal-code-style.md`, `.agents/skills/ponytail/SKILL.md`

## จุดประสงค์

ทำให้คำขอเบิก 1 ใบเดินจบบนหน้าเดียวเป็นขั้นตอน โดยไม่แตะ state machine ไม่เพิ่มสถานะ ไม่เพิ่ม permission key และไม่เพิ่มตาราง งานส่วนใหญ่อยู่ฝั่งเว็บ ฝั่ง API มีเฉพาะค่าเริ่มต้นนโยบาย สิทธิ์ renderer ใบเบิก ลิงก์แจ้งเตือน และการตัดผู้กระทำออกจากผู้รับแจ้งเตือน

## บริบทในโค้ดปัจจุบัน

- API: `apps/api/src/modules/reimbursements/**` (logic, use cases, repository, controller), `apps/api/src/modules/auth/permission-registry.ts`, `apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts`, `apps/api/src/modules/workflow/domain/workflow-template-catalog.ts`, `apps/api/src/modules/workflow/application/use-cases/workflow-action-runner.use-case.ts`, `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts`, `apps/api/prisma/schema.prisma`
- Web: `apps/web/src/features/reimbursements/**`, `apps/web/app/(workspace)/companies/[companyId]/reimbursements/**`, `apps/web/src/features/expenses/SubstituteReceiptWizardPage.tsx`, `apps/web/src/features/expenses/SubstituteReceiptHubPage.tsx`, `apps/web/src/common/components/steps/ThemedSteps.tsx`, `apps/web/src/features/user-guide/reimbursement-guide.content.ts`
- แบบแผนที่นำกลับมาใช้: ThemedSteps ของ wizard ใบทดแทน, `currentDesk()` และ `buildClaimTimeline()`, section ของ drawer ใน `ReimbursementsPages.tsx`, ตัวกรอง `expenseId` ของ endpoint ตัวเลือกต้นทาง, `reopenReimbursement`, การลงนามใบเบิก Lane F
- ความเสี่ยงที่รู้อยู่: hub ยาว 1,970 บรรทัด ต้องถอด section ออกทีละส่วน; e2e เบิกจ่ายอิงแท็บและ drawer; แม่แบบแจ้งเตือนถูกซิงก์ด้วยสคริปต์ release task ต้องไม่เขียนทับกฎที่แอดมินแก้เอง; migration ตั้งค่าแถวเดิม (A1) ต้อง idempotent

## กติกาการทำงาน

- ทำตาม ponytail full: diff สั้นที่สุด ใช้แบบแผนเดิม ไม่สร้าง abstraction ล่วงหน้า ไม่เพิ่ม dependency
- ไม่แก้ `package.json` ยกเว้นเพิ่ม/ลด dependency ทดสอบใหม่ให้อยู่ในไฟล์ spec เดิมของโมดูล หรือรันด้วย `node scripts/run-line-ai-whole-chain-acceptance.mjs` ซึ่งครอบคลุม spec ที่ไม่อยู่ในรายการ
- ไม่ย้าย mutation ใดไป LINE/AI
- ทุก phase จบด้วยการตรวจอย่างน้อยหนึ่งอย่างที่รันได้จริง และบันทึกผลใน memory

## ขอบเขต

อยู่ในขอบเขต: ตามสเปค §3

นอกขอบเขต: state machine, endpoint ใหม่, การจ่ายจาก LINE, จ่ายบางส่วน, ใบสำคัญจ่ายรวม, deploy (ใช้ runbook UAT/Production ตามปกติเมื่อถึงเวลา)

## Phase 0: Discovery และยืนยันสมมติฐาน

เป้าหมาย: เจ้าของยืนยันหรือยกเลิก A1 (สลับแถวนโยบายเดิม) และ A2 (ผู้อนุมัติยกเลิกการจ่ายได้) หลังดูตัวอย่างหน้าจอ

งาน:

- [x] เจ้าของดูตัวอย่าง artboard 9 หน้า และตอบ A1/A2 (ยืนยันทั้งสองข้อ 19 ก.ย. 2569)
- [x] เจ้าของยืนยัน A4 สำเนากระดาษที่เซ็นครบนับว่าขั้นเอกสารเสร็จ (ยืนยัน 19 ก.ย. 2569 หลังถามว่า "อัปโหลดแบบกระดาษที่มีลายเซ็นแล้ว ระบบยอมรับว่าผ่านไหม")
- [x] อ่านโค้ดจุดที่จะแก้อีกครั้งก่อนเริ่ม (drawer section, catalog, runner, renderer)
- [x] บันทึกคำตอบลง memory

เกณฑ์ออก: ผ่านแล้ว A1, A2, A4 ยืนยันครบ เหลือเพียงอ่านโค้ดจุดที่จะแก้อีกครั้งตอนเริ่ม Phase 1

## Phase 1: ค่าเริ่มต้นนโยบายและสิทธิ์ (API)

เป้าหมาย: บริษัทใหม่และเดิมได้ค่าเริ่มต้นตาม D2 และผู้อนุมัติจ่ายได้ตาม D1

งาน:

- [x] `schema.prisma`: `financeReviewRequired @default(false)` และ migration idempotent ที่ตั้งแถวเดิมเป็น false (A1)
- [x] `reimbursement.constants.ts`: `REIMBURSEMENT_POLICY_DEFAULTS.financeReviewRequired = false`
- [x] `permission-registry.ts`: ADMIN และ MANAGER เพิ่ม `reimbursement.payment.record`, `reimbursement.payment.void`
- [x] `capability-pack.registry.ts`: `pack.reimbursement.approve` เพิ่มสองคีย์เดียวกัน
- [x] `docs/specs/permission-matrix.md`: บรรทัด ADMIN/MANAGER และหมายเหตุคำตัดสิน 19 ก.ย. 2569
- [x] หน้าตั้งค่านโยบาย: ข้อความสวิตช์ตรวจการเงิน บรรทัดใต้ตัวเลือกผู้อนุมัติ และ decision preview ตามสเปค §7

ทดสอบ:

- `permission-registry.spec.ts` เพิ่มกรณี ADMIN/MANAGER มี payment.record/void; spec ค่าเริ่มต้นนโยบาย; spec หน้า policy (web logic) สำหรับ preview
- migration รันสองครั้งบนฐานข้อมูล local ให้ผลเท่ากัน

เกณฑ์ออก: ทดสอบผ่าน และบันทึกคำสั่งที่รันไว้ใน memory

## Phase 2: หน้า journey (Web)

เป้าหมาย: หน้า `/reimbursements/[requestId]` แสดงขั้นตอนและปุ่มของขั้นปัจจุบันครบตามสเปค §5 และ §6

งาน:

- [x] เพิ่ม pure function `buildJourneySteps(detail, viewerPermissions, viewerUserId)` ใน `reimbursements.logic.ts` คืนรายการขั้น (key, label, state, ปุ่มที่เปิด) โดยอ่าน `currentDesk`, snapshot นโยบาย, สถานะ และ step อนุมัติ
- [x] ถอด section ของ drawer (ตารางรายการ, timeline, ลายเซ็น/สำเนา, ประวัติการจ่าย, ฟอร์มบันทึกจ่าย, dialog ปฏิเสธ/ยกเลิก) ออกเป็น component ในไฟล์ใหม่ที่ทั้ง drawer และหน้า journey ใช้ร่วมกันชั่วคราว
- [x] สร้าง `ReimbursementJourneyPage.tsx` ประกอบจาก ThemedSteps + การ์ดขั้นปัจจุบัน + section ข้างต้น
- [x] route `[requestId]/page.tsx` เปลี่ยนจาก redirect เป็นหน้า journey โดยส่ง permissions/userId แบบเดียวกับหน้า hub
- [x] hub: `?focus=` และ `?tab=…&focus=` redirect ไปหน้า journey แถวรายการเป็นลิงก์ไปหน้า journey
- [x] หน้าสร้าง/แก้ไข: รับ `?expenseId=` เลือกต้นทางล่วงหน้า และหลังบันทึกร่างพาไปหน้า journey
- [x] หลังอนุมัติ: โหลดรายละเอียดใหม่ ถ้าผู้ดูถือ payment.record และใบอยู่ขั้นจ่ายเงินคืน ให้เปิดฟอร์มบันทึกจ่ายในการ์ดทันที

ทดสอบ:

- `reimbursements.logic.spec.ts`: 4/5 ขั้น, ขั้นปัจจุบันทุกสถานะ, ปฏิเสธ/ยกเลิก/เพิกถอน, auto-approve, ปุ่มตามสิทธิ์
- browser ที่ 390 px: เดินทั้ง 4 ขั้นด้วย dev-login OWNER บน local stack

เกณฑ์ออก: AC02, AC03, AC12, AC13, AC14 ผ่านบน local

## Phase 3: ใบเบิก 2 ช่องลงนาม (API + Web)

เป้าหมาย: D3

งาน:

- [x] `claim-form.logic.ts`: ผัง 2 ช่อง + บรรทัดการจ่ายเงินคืน + ข้อความคนเดียวกัน + คง "ไม่ต้องอนุมัติตามนโยบาย"; เลือกผัง legacy 4 ช่องเมื่อมีแถวลายเซ็น FINANCE_REVIEW/PAYER
- [x] `reimbursement-claim-signature.use-case.ts`: `eligibleClaimSignatureRoles` คืนเฉพาะ REQUESTER/APPROVER เมื่อผัง 2 ช่อง
- [x] รายละเอียดใบเพิ่ม `claimFormLayout` (contract เสริม ไม่บังคับ)
- [x] เว็บ: ส่วนลายเซ็นแสดง 2 ช่อง ปุ่ม "ลงนาม" เรียกอัปโหลด+ลงนามหนึ่งครั้งต่อบทบาทที่มีสิทธิ์ (คนเดียวกันได้สองแถวจากการกดครั้งเดียว)
- [x] เส้นทางเซ็นกระดาษ (A4): `LinkSignedClaimFormCopyUseCase` รับ `acknowledgedComplete: true` และเลขที่ใบที่ผู้แนบยืนยัน บันทึก checksum ของ attachment ลง audit metadata; รายละเอียดใบเพิ่ม `documentSignedVia`; เว็บ: dialog คำรับรองก่อนแนบ, ช่องลงนามแสดง "ลงนามบนกระดาษ (ดูสำเนา)", timeline แถวเอกสารผ่านเมื่อมีสำเนา; renderer ไม่เปลี่ยน (ไม่วาดลายเซ็นจำลอง)

ทดสอบ:

- `claim-form.logic.spec.ts` ทุกกรณีใน §9; `reimbursement-claim-signature.use-case.spec.ts` บทบาทที่เลือกได้; `reimbursements.model.spec.ts` ฝั่งเว็บ
- render ตัวอย่าง SVG ลง scratchpad แล้วดูด้วยตา

เกณฑ์ออก: AC06, AC07, AC17 ผ่าน

## Phase 4: ลิงก์และแจ้งเตือน (API)

เป้าหมาย: D5 และสเปค §11

งาน:

- [x] `workflow-template-catalog.ts`: `reimbursementHubLink` เปลี่ยนเป็น `/companies/{{companyId}}/reimbursements/{{requestId}}`
- [x] `workflow-action-runner.use-case.ts`: `sourceWebPath` ของ reimbursement_request ชี้หน้า journey; ตัดผู้กระทำเหตุการณ์ (`actorUserId` ใน payload) ออกจากผู้รับทุกแม่แบบเบิกจ่าย; ถ้า payload ยังไม่มี actor ให้ use case ที่ publish เหตุการณ์ใส่เพิ่ม
- [x] `line-staff-menu.logic.ts`: การ์ดคงเปิดแท็บคิวอนุมัติ ไม่แก้ นอกจากทดสอบยืนยัน
- [x] คำตอบ AI สถานะใบเบิก: path ลิงก์ใหม่ (`erp-reimbursement-tools.use-case.ts` หรือ composer ที่ประกอบลิงก์)

ทดสอบ:

- spec ของ catalog/runner: path ใหม่ทุกแม่แบบ, ผู้กระทำถูกตัด, ผู้รับอื่นคงเดิม, ซิงก์แม่แบบสองครั้งไม่แก้กฎที่แอดมินปิด
- API level: ส่งใบโดย OWNER คนเดียว → ไม่มี notification ถึงตัวเอง; ส่งโดย STAFF → MANAGER/OWNER ได้รับพร้อมลิงก์หน้า journey

เกณฑ์ออก: AC10, AC11 ผ่าน

## Phase 5: ใบทดแทน → คำขอเบิก (Web)

เป้าหมาย: D4

งาน:

- [x] `SubstituteReceiptWizardPage.tsx` ขั้นรับเอกสาร: ปุ่มหลัก "สร้างคำขอเบิกจากใบนี้" และข้อความใหม่ตามสเปค §10 เงื่อนไขแสดงตาม status/fundingSource/payerUserId/สิทธิ์
- [x] `SubstituteReceiptHubPage.tsx`: การกระทำเดียวกันบนแถวที่เข้าเงื่อนไข
- [x] หน้าสร้างคำขอ: ถ้าต้นทางจาก `?expenseId=` ไม่เข้าเงื่อนไข แสดงเหตุผลจากรหัสเดิมของตัวเลือกต้นทาง

ทดสอบ:

- web model spec เงื่อนไขการแสดงปุ่ม
- integration API (ใช้ fixture ใบทดแทน PERSONAL_ADVANCE ที่มีอยู่ใน spec ใบทดแทน): เบิก → จ่าย → ตรวจว่า ExpensePayment ต้นทางไม่เพิ่ม
- e2e: เส้นทางใบทดแทน → ใบเบิก อย่างน้อยหนึ่งกรณี

เกณฑ์ออก: AC08, AC09 ผ่าน

## Phase 6: ปลด drawer คู่มือ และ e2e

เป้าหมาย: เหลือหน้ารายละเอียดเดียว และเอกสารผู้ใช้ตรงกับระบบ

งาน:

- [x] checklist parity: ส่งอนุมัติ, อนุมัติ, ปฏิเสธ, ยกเลิกคำขอ, เปิดกลับเป็นร่าง, อนุมัติจ่าย/ขอข้อมูล/บล็อก, บันทึกจ่าย, ยกเลิกการจ่าย, ลงนาม, พิมพ์, แนบสำเนา, ดูไฟล์หลักฐาน, ปลดรายการซ้ำ, ส่งออกหลักฐาน ทุกข้อทำได้จากหน้า journey
- [x] ลบ drawer และ state ที่ใช้เฉพาะ drawer ออกจาก `ReimbursementsPages.tsx`
- [x] `reimbursement-guide.content.ts`: เส้นทาง 4 ขั้น + ขั้นตรวจการเงินแบบมีเงื่อนไข, ผู้อนุมัติบันทึกจ่ายได้, ใบเบิก 2 ช่อง
- [x] `e2e/reimbursements.spec.ts`, `e2e/reimbursement-receipt.spec.ts`: เดินบนหน้า journey

ทดสอบ:

- `pnpm --filter @watchdog-bms/web test`, `pnpm --filter @watchdog-bms/web typecheck`
- e2e rig ตามสูตรใน `docs/agent-memory` (local dev server recipe)

เกณฑ์ออก: AC15 ผ่าน และ AC01 ถึง AC16 มีหลักฐานครบ

## การตรวจสอบเชิงบูรณาการ

- สัญญา API ↔ เว็บ: รายละเอียดใบ (`ReimbursementRequestDetail`) เพิ่มเฉพาะ field เสริม เว็บเดิมยังอ่านได้
- เส้นทางผู้ใช้: เจ้าของคนเดียว (4 ขั้น), พนักงาน + เจ้าของ (แจ้งเตือน → ลิงก์ → อนุมัติ → จ่าย), บริษัทเปิดตรวจการเงิน (5 ขั้น), ใบทดแทน → ใบเบิก
- สถานะ loading/error/permission ทุกหน้าที่แตะ
- คำสั่ง:

```bash
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/reimbursements/domain/logic/reimbursement.logic.spec.ts src/modules/reimbursements/domain/logic/claim-form.logic.spec.ts src/modules/auth/permission-registry.spec.ts
```

```bash
pnpm --filter @watchdog-bms/web test
```

```bash
node scripts/run-line-ai-whole-chain-acceptance.mjs
```

## ความเสี่ยง

- A1 สลับแถวนโยบายเดิม: ถ้ามีบริษัทที่ตั้งใจเปิดตรวจการเงินไว้ จะต้องเปิดกลับเอง แจ้งใน release note
- MANAGER ได้สิทธิ์ยกเลิกการจ่าย (A2, ระดับ CRITICAL ในทะเบียน): ทบทวนกับเจ้าของก่อน Phase 1
- การถอด section จาก hub อาจกระทบ e2e ที่อิง `data-testid` เดิม ต้องคง testid ไว้ที่ component ที่ถอดออก
- แม่แบบแจ้งเตือน: การเปลี่ยน path ต้องซิงก์ผ่าน release task ในทุก environment ก่อนใช้ลิงก์ใหม่ ใบที่ส่งก่อนซิงก์ยังใช้ลิงก์ `?focus=` ซึ่ง redirect ได้

## คำถามเปิด

- ไม่มี ทุกคำตัดสินและสมมติฐานยืนยันแล้ว 19 ก.ย. 2569

## สถานะ implement (21 ก.ย. 2569)

- Phase 0–6 implement ครบบน branch เดียว พร้อมแก้ช่องว่างที่รีวิวเจอ: ปลดรายการซ้ำในขั้นจ่ายเงินเมื่อปิดตรวจการเงิน (ผู้บันทึกจ่ายปลดได้ ตามคำตัดสินเจ้าของ 21 ก.ย.), ผู้เบิกดึงใบกลับจากรออนุมัติ, คำแนะนำเมื่ออนุมัติใบตัวเองไม่ได้, จำนวนขั้นก่อนอนุมัติ
- ข้ามตามคำสั่งเจ้าของ (บันทึกเป็นหนี้ตรวจ): browser 390 px, รัน e2e, รัน migration บนฐานข้อมูลจริง, integration Postgres; e2e เขียนแล้วแต่ไม่ได้รัน
