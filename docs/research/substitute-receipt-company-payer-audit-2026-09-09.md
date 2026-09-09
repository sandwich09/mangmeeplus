# Audit: Substitute receipt company payer, signer position and legal company name

> Scope amendment 2026-09-09: รายงานด้านล่างเป็นข้อค้นพบก่อน implementation ผู้ใช้ยืนยันให้ทำเฉพาะใบรับรองแทนใบเสร็จ บริษัทจ่ายเต็ม / พนักงานจ่ายเต็ม งาน Reimbursement/CC2 ที่แนะนำในรายงานนี้ถูกนำออกและเก็บเป็น backlog ไม่ใช่ผลที่แก้แล้วหรือเกณฑ์รับงานปัจจุบัน ให้ใช้ [[specs/substitute-receipt-company-payer-spec]] AC01–16 และ [[plans/substitute-receipt-company-payer-plan]] เป็นสถานะล่าสุด

Date: 2026-09-09
Baseline: local HEAD `e4d0fcf5`; application files inspected without modification.
Scope: Four user screenshots plus the request to prepare a fix specification and inspect surrounding bugs/gaps/impact.
Deliverables: [[specs/substitute-receipt-company-payer-spec]] · [[plans/substitute-receipt-company-payer-plan]]

Follow-up: [[research/substitute-receipt-six-perspective-review-2026-09-09]] เพิ่มข้อค้นพบเรื่อง CC2/VAT/WHT handoff, การแก้ชื่อหลัง posted/paid, actual-payment acknowledgement และวันที่/สถานะ พร้อมปรับสเปกเป็น AC01–28 แล้ว รายงานนี้คงผล diagnostic และ baseline ของรอบแรก ไม่อ้างว่าเป็นผลทดสอบ feature ที่ implement แล้ว

## 1. สรุประดับหลักฐาน

- พิสูจน์ด้วย use-case จำลอง: preview บริษัท A สามารถลงนามแล้วเก็บบริษัท B ได้ เนื่องจากมี business-data read รอบที่สอง
- พิสูจน์ด้วย repository reader จำลอง: เมื่อ registeredName บันทึกอยู่ reader เลือกชื่อนั้นเหนือ display name ถูกต้อง
- พิสูจน์ใน evidence validator: expense ที่สร้างโดย requester และสาขาตรงกันผ่านได้แม้ paymentStatus เป็น PAID; ยังไม่ได้พิสูจน์ว่าจ่ายคืนซ้ำสำเร็จตลอดทั้งระบบ
- ตรวจ source ยืนยันว่า issue บันทึก company payment/PAID และ supersede ใบ ISSUED ยกเลิก pending payments/reset ยอด; เป็นพฤติกรรมเดิมที่มี tests รองรับและต้องเปลี่ยนตาม source-aware design
- Baseline tests ผ่าน **146/146**, ไม่มี skipped; เป็น tests ของพฤติกรรมเดิม ไม่ใช่หลักฐานว่า enhancement ใหม่หรือ race ที่พบได้รับการแก้
- ไม่ได้อ่าน live tenant, database ของลูกค้า, serving build หรือ cloud; จึงยังระบุ root cause ของชื่อบริษัทใน screenshot ไม่ได้

## 2. Findings และ disposition

| ID / ระดับ | ข้อค้นพบและหลักฐาน | ผลกระทบ / ขอบเขตแก้ |
|---|---|---|
| B01 / P1 — reproduced bug | `CertifySubstituteReceiptUseCase` อ่าน snapshot เพื่อเทียบ preview ที่บรรทัด 809 แล้วอ่านใหม่ที่ 820; controlled mock คืน A, A, B และบันทึก B สำเร็จ | เอกสารที่เซ็นมีชื่อบริษัท/หลักฐานต่างจากที่ตรวจ; P1 ใช้ business snapshot ชุดเดียว |
| G02 / P1 — verified behavior requiring redesign | `issueSubstituteEvidence` ไม่รู้แหล่งเงิน แต่สร้าง `ExpensePayment` ตามยอดคงเหลือและตั้ง `PAID` ทุกใบ | เพิ่ม COMPANY ใน dropdown อย่างเดียวไม่พอ; PERSONAL ต้องไม่เกิด company cash settlement และห้ามลง original expense ซ้ำกับ claim projection |
| G03 / P1 — correction impact | `supersedeSubstituteEvidence` ของ ISSUED void ทุก RECORDED/pending payment ของ expense และ reset เป็น UNPAID โดยไม่แยกแก้ชื่อกับแก้การจ่าย | แก้ชื่อ/ตำแหน่งต้องไม่ยกเลิกเงินจริง; ต้องระบุ payment provenance และรักษาประวัติ โดยเฉพาะ legacy ที่ attribution ไม่ชัด |
| G04 / P1 — validator gap, reproduced locally | `ReimbursementEvidenceService.validate` ตรวจ company/creator/branch; fixture PAID ผ่าน ขณะที่ `MaterializeClaimExpensesService` สร้าง employee-payable projection แยกเสมอ | ต้องตรวจ COMPANY/settled/ordinary posted source และ personal source ownership ที่ server; ไม่กล่าวอ้างว่าผู้ใช้จ่ายเงินซ้ำใน Production แล้ว |
| G05 / P1 — version/transaction gap from source | Certificate writes ใช้ `:substitute-receipt` lock; claim ใช้ `:reimbursement-evidence:`; claim hash มี linkedExpenseId แต่ไม่มี certificate version/hash | การตรวจ source แบบ preflight อย่างเดียวมี race; ใช้ shared evidence exclusion, ห้ามแก้ source ระหว่าง live claim และทดสอบ PostgreSQL concurrency |
| G06 / P2 — requested enhancement | Wizard และ embedded signing ใช้ text input; employee contract มี `jobTitle` แต่ signer runtime ยังไม่ส่งคำแนะนำ | เพิ่ม picker + ระบุเอง ผ่านข้อมูลของผู้เรียกเอง; ไม่ใช้ role เป็นตำแหน่งและไม่เปิด HR directory |
| G07 / P2 — source-backed UI gap | `previewScope` ผูก company/expense/evidence revision แต่ไม่รวม signerPosition; onChange ล้าง checksum แต่ไม่ invalidate request sequence/onViewed closure ทั้งชุด | เปลี่ยนตำแหน่งขณะ preview กำลังโหลดหรือยังเปิดอยู่ อาจทำให้ UI แสดงตรวจแล้วของค่าเก่า; server hash ยังกันค่าที่ไม่ตรง จึงเป็น stale-UI/conflict gap ไม่ใช่หลักฐานว่าเซ็นตำแหน่งผิดผ่าน server |
| U08 / P2 — reported symptom, root cause unconfirmed | ภาพเอกสารใช้ MangmeePlus ขณะหน้า settings แสดงชื่อจดทะเบียน; current reader `registeredName ?? name` และ probe ทำงานถูก | ตรวจ persisted save/company context/snapshot timing/build; ห้าม hardcode ชื่อลูกค้าหรือสรุปว่า renderer ใช้ display name เสมอ |
| G09 / P2 — historical compatibility | Evidence/snapshot เดิมไม่มี funding source; approval/render ใช้ snapshot ที่ลงนามแล้ว; supersede ปฏิเสธ confirmed expense | ไม่ backfill PERSONAL, ไม่ re-render ทับเอกสารเดิม, และไม่สัญญาว่าแก้ฉบับ signed ได้ทุกสถานะ |
| G10 / P2 — LINE contract gap | Continuation มี payerUserId/paymentMethod แต่ไม่มีแหล่งเงิน; parser แยก “ฉันเป็นผู้จ่าย” ตาม current user | ต้องเก็บ source/provenance และถามแยก; ห้ามตีความคนกดโอนเท่ากับเจ้าของเงิน |
| G11 / P2 — title rendering gap | `positionLabel` แปลง string เช่น `admin`/`manager` เป็นคำแปล role-like labels ตอนสร้าง certification text/render | Snapshot ใหม่ต้องพิมพ์ตำแหน่งที่ยืนยันตามจริง; legacy ใช้ renderer compatibility เดิมและเก็บ signed bytes |
| G12 / P1 — final source-state check gap from source | `markSubstituteEvidenceCertified` ตรวจ evidence revision/ผู้จ่าย/active attachments ใน transaction แต่ไม่ re-read expense revision; expense ถูกตรวจที่ use-case ก่อนงาน signature/storage | มีหน้าต่างให้ expense เปลี่ยนก่อน certify commit แล้วไปติดตอน approve; เพิ่ม transaction check ของ expense ที่ตรงกับ prepared snapshot และ regression concurrent source edit |

P1 ในตารางหมายถึงควรแก้ก่อนเปิด funding source ใหม่ ไม่ได้หมายถึงทุกแถวเป็น production incident ที่พิสูจน์แล้ว B01 เท่านั้นที่ทำ controlled reproduction ของการเก็บข้อมูลไม่ตรง preview สำเร็จ

## 3. Source map และ impact

| จุด | Source ที่อ่าน | สิ่งที่ต้องตามไปแก้/ตรวจ |
|---|---|---|
| Data | `apps/api/prisma/schema.prisma:2723`, `packages/contracts/src/expenses.ts:964` | funding nullable สำหรับ legacy, typed inputs/outputs, old-client behavior |
| Preparation | `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts:1367` | idempotency payload รวม source; preserve version history |
| Human identity | `prisma-expense.repository.ts:1019`, `substitute-receipt-policy.use-case.ts:executeRuntime` | payer ยังคงเป็นคน; เพิ่ม jobTitle เฉพาะตนใน runtime response |
| Legal name | `prisma-expense.repository.ts:1120`, `substitute-receipt.use-case.ts:226` | registeredName precedence, fallback source, reviewed snapshot |
| Final certification | `substitute-receipt.use-case.ts:809`, `prisma-expense.repository.ts:1545` | ใช้ snapshot เดียวและตรวจ source state ใน transaction |
| Issue/payment | `prisma-expense.repository.ts:1622` | company/personal branching, deterministic payment identity, no duplicate cash |
| Correction | `prisma-expense.repository.ts:962` | document-only versus financial correction; existing confirmed-state refusal |
| Expense payment | `prisma-expense.repository.ts:339`, `expense-draft.use-case.ts:RecordExpensePaymentUseCase` | กัน personal source จ่ายซ้ำและแข่งกับ claim; คง existing reimbursement-projection refusal |
| Claim evidence | `apps/api/src/modules/reimbursements/application/services/reimbursement-evidence.service.ts:22` | funding/payer relationship/settlement gate และ same-attachment source resolution |
| Claim transactions | `apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts:360` | submit source guard; lockEvidence/assertEvidenceAvailable; projection และ payout final recheck |
| Claim projection | `apps/api/src/modules/reimbursements/application/services/materialize-claim-expenses.service.ts:13` | original source เป็นหลักฐาน; projection เป็น accounting owner; preserve evidence provenance |
| Web | `apps/web/src/features/expenses/SubstituteReceiptWizardPage.tsx`, `ExpensesPages.tsx` | source UI, title picker, stale preview callback, done-step routing |
| Profile save | `apps/web/src/features/company-profile/CompanyProfilePage.tsx:saveShop` | identity save แยกจาก VAT save; input บนภาพไม่พิสูจน์ว่า save สำเร็จ |
| Render/export | `substitute-receipt.logic.ts`, `expense-export.logic.ts`, unsigned/download use-cases | ชื่อ/คน/แหล่งเงิน/ตำแหน่งตรงกันทุกช่องทางและ legacy hash ไม่เปลี่ยน |
| LINE | `apps/api/src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.ts` | extraction/readiness/provenance/accepted-values/web handoff |
| Read-side | hub, notification labels, related-user/download scope, user guide | บริษัทไม่ใช่ user/recipient; แยกจ่ายแล้วแก่ร้านกับบริษัทจ่ายคืนแล้ว |

ชื่อไฟล์ API ที่ไม่แสดงเต็มในตารางอยู่ใต้ `apps/api/src/modules/expenses/` ใน directory ตาม source เดิม สัญลักษณ์และเลขบรรทัดอ้าง baseline ด้านบน

## 4. Controlled reproduction

ใช้ `/tmp/substitute-company-spec-probe.ts` ใน session นี้ ไม่แก้ application files และไม่มี network/storage writes จริง (repository/storage/audit/notifications เป็น mocks)

### B01

1. ใช้ fixtures `ctx()`, `expense()`, `prepared()` และ mock signature/storage จาก test `allows only the selected payer and stores a signed immutable snapshot` ใน `substitute-receipt.use-case.spec.ts`
2. ตั้ง `getSubstituteCompanyContext` เป็น `++reads <= 2 ? A : B` โดยทุก field อื่นเหมือนเดิม
3. เรียก `PreviewSubstituteReceiptUseCase.execute` รับ preview checksum ของ A
4. เรียก `CertifySubstituteReceiptUseCase.execute` ด้วย checksum และ expected versions เดิม
5. จับ argument ของ `markSubstituteEvidenceCertified`: พบ snapshot.company.name เป็น B, getCompany ถูกเรียกทั้งหมด 3 ครั้ง

Acceptance regression ต้อง assert ว่า business snapshot ที่เก็บตรง A หรือปฏิเสธก่อนเก็บ B ไม่ใช้ assertion ที่ยอมรับ B เป็น passing feature test

### Reader และ claim validator

- เรียก `PrismaExpenseRepository.prototype.getSubstituteCompanyContext` ด้วย company `{registeredName: 'Registered Co Ltd', name: 'Brand'}` ได้ legal name ถูกต้อง
- เรียก `ReimbursementEvidenceService.validate` ด้วย linked expense ของ requester/branch เดียวกัน, `status=CONFIRMED`, `paymentStatus=PAID`, `paidAmount=65.00`, ไม่มี source reimbursement; validator ไม่ปฏิเสธ เป็นข้อพิสูจน์เฉพาะ boundary นี้

ผลจริง:

```text
PASS registered-name precedence: saved legal name wins over brand
REPRODUCED certification race: reviewed A, stored B; company reads=3
REPRODUCED validator gap: company/creator/branch match accepts an already-paid expense; no end-to-end payout claim
```

## 5. Baseline verification

รันจาก `apps/api`:

```sh
pnpm exec tsx --test src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts src/modules/expenses/domain/logic/substitute-receipt.logic.spec.ts src/modules/reimbursements/application/services/reimbursement-evidence.service.spec.ts
pnpm exec tsx --test src/modules/expenses/infrastructure/prisma-expense.repository.substitute-payment.spec.ts
```

ผล: 49/49 และ 3/3 ผ่าน ตามลำดับ ชุดหลังยืนยันพฤติกรรมปัจจุบันสร้าง payment/mark paid และ reset เมื่อ supersede ไม่ใช่พฤติกรรม target ทั้งสอง funding modes

รันจาก `apps/web`:

```sh
pnpm exec tsx --test src/features/expenses/substitute-receipt-wizard.model.spec.ts src/features/expenses/substitute-receipt-preview.spec.ts src/features/company-profile/company-profile.logic.spec.ts
```

ผล: 94/94 ผ่าน รวมทั้งหมด 146/146 ไม่มี fail/skipped ผลอยู่ใน `/tmp/substitute-company-spec-{api,web,payment}-tests.log` ระหว่าง session นี้

ยังไม่ได้รัน browser, PDF visual QA, real PostgreSQL race, migration/typecheck ของ enhancement หรือ production verification เพราะรอบนี้เขียนสเปก/แผนและตรวจ code path ไม่ได้ implement

## 6. ขอบเขตที่ไม่ควรขยายโดยไม่มีเหตุ

- ไม่เปลี่ยน brand name ของแอป, ข้อมูลบริษัทจริง หรือเอกสาร signed จากรูป screenshot
- ไม่เปิดอ่าน employee directory เพื่อเติมตำแหน่งคนเดียว; ไม่เพิ่ม role เพื่อใช้ฟอร์ม
- ไม่สร้างอีก approval/payment flow; reimbursement projection เป็น accounting owner ของกรณีบุคคลสำรองจ่าย
- ไม่เปลี่ยน WHT/VAT/rounding policy เพราะเพิ่มแหล่งเงิน
- ไม่ถือว่าข้อข้างต้นแปลว่า mapper reimbursement ปัจจุบันถูกต้องตาม tax contract แล้ว; ต้องผ่าน follow-up §3/4 และ spec §7.4 ก่อนเชื่อม PERSONAL อัตโนมัติ
- ไม่ตีความ baseline tests ผ่านว่า B01 ปิดแล้ว หรือว่า U08 เป็นบั๊กเดียวกับ B01
- การคุ้มครองไฟล์ที่รู้ attachment/expense relation ไม่ได้พิสูจน์การป้องกันทุกไฟล์ใหม่ที่หน้าตาเหมือนกัน
