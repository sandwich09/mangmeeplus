# WHT Certificate System Issuance Plan — ออกเอกสาร 50 ทวิ ในระบบ

## Print-format correction (2026-09-23)

Replace the custom 50 ทวิ SVG page with an overlay on the published Revenue Department master. Normalize legacy serialized addresses at the render boundary and constrain each value to its printed field. Compare rendered A4 pages with the master and with a long Thai payer/payee fixture; verify ordinary, blank-signature, signed, and ใบแทน paths. Recheck the existing ภ.ง.ด.53 main/annex overlay on the Revenue Department masters in the same pass.

Status: READY (docs-first; ยังไม่เริ่ม implement)
Spec: `docs/specs/wht-certificate-system-issuance-spec.md`
Memory: `docs/agent-memory/wht-certificate-system-issuance.md`
Scope: เปิดปุ่ม "ออกเอกสารในระบบ" ที่สองจุดเข้า (AP payment WHT tab, Expenses ยืนยันเอกสาร) — ยังปิดด้วย
`cap.wht50bis/SYSTEM_INITIAL_ISSUE` (SPECIALIST_LEGAL, seed CLOSED) จนกว่าจะมี evidence จริง (Phase 6)
หลักการ: ponytail full — reuse `WhtCertificate`/`WhtCertificateHandoff`/`ReserveDocumentNumberUseCase`/
`TaxArtifactRendererService`/`substitute-receipt-pdf.logic.ts`'s raster pipeline ทุกจุด ไม่มี abstraction ใหม่,
ไม่มี dependency ใหม่, ไม่ redesign data model ที่มีอยู่แล้ว
Baseline discovery ใหม่ (docs-only, ยืนยันจาก source ณ commit `18768642`, 2026-09-22 — ดู "สิ่งที่ต่างจาก spec" ท้ายไฟล์)

## Owner/controller decisions ที่เพิ่มเข้ามาหลัง draft แรก (2026-09-22)

- **Decision A — v1 มีแค่ลายเซ็น เลื่อนตราประทับไปทำทีหลัง:** owner คำต่อคำ "ตอนนี้ใช้แค่ลายเซ็นไปก่อน
  ตราประทับเดี๋ยวตามมาทีหลัง" — ตัด `companySealImageAttachmentId` ออกจาก v1 ทั้งหมด (schema, upload UI, PDF
  wiring) เหลือแค่ `signatureMode`/`signatureImageAttachmentId` ช่องตราประทับบนแบบฟอร์มจริงเว้นว่างต่อไปแม้
  `AUTO_STAMP` (ไม่ทำ placeholder ใด ๆ) — เป็น known visual gap เทียบกับแบบฟอร์มจริงที่ตั้งใจเลื่อนไป slice
  ถัดไป ไม่ใช่บั๊ก สเปก §5/§6/§10/§11 (S10) ยังพูดถึงตราประทับคู่กับลายเซ็นเสมอ — plan นี้แคบกว่าสเปกเฉพาะจุดนี้
  ตาม owner decision ที่มาทีหลัง ไม่ได้แก้ไฟล์สเปก (นอกสโคปงาน docs นี้)
- **Decision B — แยก permission อัปโหลด/ตั้งค่าลายเซ็นออกจาก permission ออกเอกสาร ให้แคบกว่า (OWNER เท่านั้น):**
  พบว่าการให้ FINANCE/ACCOUNTANT ตั้งค่า/อัปโหลดรูปลายเซ็นผู้มีอำนาจลงนามของบริษัทได้เหมือนกับที่ตั้งไว้แต่แรก
  (มิเรอร์ role ของ `wht.certificate.read`/`.issue`) กว้างกว่าทุก precedent ที่ใกล้เคียงในโค้ดจริง — ลายเซ็นส่วน
  บุคคล (`CompanySignatureAsset`) อ่านได้เฉพาะเจ้าของแม้ผู้ถือ `attachment.read`
  (`create-download-url.use-case.ts:42-52`) และการแก้ตัวตนภาษี/VAT ของบริษัทเป็น OWNER-only อยู่แล้ว
  (`company.legal_identity.manage`, permission-registry.ts:930-932) ลายเซ็นผู้มีอำนาจลงนามของบริษัทที่จะไป
  ประทับบนเอกสารกฎหมายทุกใบที่ระบบออก อ่อนไหวไม่น้อยไปกว่านั้น — แยกเป็นสอง permission คนละเรื่อง:
  ออกเอกสาร (`wht.certificate.issue`, FINANCE/ACCOUNTANT/OWNER ตามเดิม ไม่กระทบ) ต่างจาก
  ตั้งค่า/อัปโหลดลายเซ็น (`company.tax_signature.manage`, **OWNER เท่านั้น** — ใหม่) ดูรายละเอียดใน Phase 3.3
  และ 2.1 (permission registration)

## ลำดับที่บังคับ

Phase 1 → 2 → 3 (Phase 3 เขียนคอลัมน์ที่ Phase 2's PDF ใช้ได้เลย ถ้ายังไม่ตั้งค่าคือ BLANK) → 4 → 5 → 6
Phase 4 ต้อง Phase 1+2+3 เสร็จก่อน (ปุ่มต้องมีทั้ง use case, permission, และ signature field ให้เรียก) แต่ 1/2/3
ส่งแยก commit ได้ระหว่างกัน — ทุก phase ก่อน 6 ไม่เปิด gate จึงไม่ user-facing สำหรับปุ่มออกเอกสารเอง (ยกเว้น 1.2 ที่เป็น
ฟิลด์บังคับใหม่ฝั่ง Expenses ซึ่งตั้งใจ user-facing ทันทีตาม S2/S3 ไม่ว่า gate จะเปิดหรือปิด)

---

## Phase 1 — Prerequisite fixes (เล็ก, ยังไม่เปิดความสามารถใหม่)

### 1.1 Payer branch-code bug fix (AP)

- `apps/api/src/modules/procurement/infrastructure/prisma-procurement.repository.ts`,
  `createWhtHandoffForPayment` (บรรทัด ~1799-1863): แก้ `payerSnapshot.branchCode: null` ที่ hardcode ไว้ที่บรรทัด
  1816 — query `tx.branch.findUnique({ where: { companyId_id: { companyId, id: data.branchId } }, select: {
  taxBranchCode: true } })` เมื่อ `data.branchId` มีค่า แล้วใช้ `.taxBranchCode` แทน `null` (`Branch` มี
  `@@unique([companyId, id])` อยู่แล้ว, `taxBranchCode` เป็น field ที่มีอยู่แล้วเพื่อจุดประสงค์นี้พอดี — ไม่ต้อง
  migration) ไม่มี `data.branchId` (จ่ายที่ระดับบริษัทไม่ผูกสาขา) → คงเป็น `null` เหมือนเดิม ไม่ใช่ regression
- **หมายเหตุ:** `CreateWhtCertificateUseCase` (บรรทัด 71) ก็ hardcode `branchCode: null` เหมือนกัน — ใช้
  `company`-level lookup เท่านั้น ไม่มี branch context ในเส้นทางนั้นเลย (`input`/`TaxPeriod` ไม่มี branchId) จึง
  **ไม่แก้จุดนั้นใน v1** (คนละ endpoint คนละ input shape, อยู่นอก scope ของ spec นี้ที่จำกัดที่ AP/Expenses
  entry point) — บันทึกไว้เป็นข้อสังเกตแยก ไม่ใช่ inconsistency ที่ v1 ต้องปิด
- Verify: เพิ่มเคสใน `apps/api/src/modules/procurement/infrastructure/prisma-procurement-integrity.repository.spec.ts`
  — payment ผูก branch ที่มี `taxBranchCode` ตั้งไว้ → assert `prefillSnapshotJson.payerSnapshot.branchCode`
  ตรงกับค่านั้น (ไม่ใช่ `null`)

### 1.2 Expenses WHT income-category field + endpoint

ExpenseRecord วันนี้มีแค่ `whtAmount` (schema.prisma:~2508) ไม่มี field เทียบเท่า `SupplierPayment.whtCategoryCode`/
`whtRate` เลย (ยืนยันจากการอ่าน model ตรง ๆ — ไม่มี `whtInputJson` หรือฟิลด์อื่นซ่อนอยู่) ต้องเพิ่มเป็น flat column
คู่ขนานกับที่ `wht-settlement-capture-plan.md` §1.1 ทำฝั่ง `SupplierPayment` (ไม่ใช่ JSON blob — เพื่อความสม่ำเสมอ):

- `apps/api/prisma/schema.prisma`: `ExpenseRecord` เพิ่ม `whtCategoryCode String?`, `whtRate Decimal? @db.Decimal(8,4)`
  — migration additive ใหม่ (ชื่อแนว `2026xxxx_expense_record_wht_category`)
- `packages/contracts/src/expenses.ts`: DTO ที่ confirm/update expense รับ `whtCategoryCode?`, `whtRate?`
- **Endpoint ใหม่ฝั่ง Expenses (ไม่ใช้ `tax.config.read` — เหตุผลเดียวกับที่ AP ไม่ใช้):** เพิ่ม
  `GET companies/:companyId/expenses/wht-income-categories` ใน `apps/api/src/modules/expenses/presentation/http/expense.controller.ts`
  guard ด้วย `expense.create` (permission เดียวกับที่คุมการกรอก/บันทึกฝั่งนี้อยู่แล้ว) เรียก use case ที่มีอยู่แล้ว
  **`ListWhtIncomeCategoriesUseCase`** (`apps/api/src/modules/procurement/application/use-cases/wht-income-category.use-case.ts`,
  export จาก `procurement.module.ts` อยู่แล้ว) — เพิ่ม `ProcurementModule` เข้า `imports` ของ
  `apps/api/src/modules/expenses/expenses.module.ts` (ไม่มี cycle: `ProcurementModule` imports
  `AuditModule/DataModelCoreModule/InventoryModule/TaxModule` เท่านั้น ไม่ import กลับมาที่ Expenses) — reuse
  ตรง ๆ ไม่ copy query
- `expense-status.logic.ts`: เติมกติกาบล็อกใหม่ต่อจาก RA-18 rule ที่มีอยู่แล้ว (บรรทัด ~318-323 —
  `if (parseFloat(input.whtAmount) > 0 && !input.vendorEntityKindSnapshot)`) เพิ่มเงื่อนไขคู่ขนาน:
  `whtAmount > 0 && !input.whtCategoryCode` → บล็อกด้วยข้อความเหตุผล (mirror รูปแบบข้อความเดิม) — ตรงกับ S2
- `apps/web/src/features/expenses/ExpenseReviewPage.tsx`: dropdown ใหม่ "ประเภทเงินได้ (หัก ณ ที่จ่าย)" แสดงเมื่อ
  `whtAmount > 0` (mirror dropdown ที่มีอยู่แล้วสำหรับ `vendorEntityKindSnapshot`) ดึงตัวเลือกจาก endpoint ข้างบน
- **สร้าง `WhtCertificateHandoff(REQUIRED)` ที่จุด confirm เสมอเมื่อ `whtAmount > 0`** (S3, mirror
  `createWhtHandoffForPayment` ฝั่ง AP) — ต้องต่อเข้ากับ transaction ที่ confirm จริง ไม่ใช่ post-hoc: มีสอง entry
  point ที่ยืนยันเอกสารจริงใน `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts`
  — `confirmExpenseCas` (บรรทัด ~2415) และ `finalizeAndConfirmExpenseCas` (บรรทัด ~2462) — ทั้งสองต้องเรียก
  ฟังก์ชันคู่ขนานกับ `createWhtHandoffForPayment` ภายใน `$transaction`/`serializableTransaction` เดียวกัน
  (`sourcePaymentType: 'expense.record'`, `sourceFeatureKey: 'expenses'`, prefill จาก
  `vendorSnapshotJson`/`vendorEntityKindSnapshot`/`whtCategoryCode`/`whtRate`/`whtAmount` ที่มีอยู่ในแถวแล้ว)
- Verify: `apps/api/src/modules/expenses/domain/logic/expense-status.logic.spec.ts` (เคสบล็อกใหม่),
  `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.atomic-confirm.spec.ts` (เคส handoff
  ถูกสร้างเมื่อ confirm ที่ whtAmount>0), web: dropdown component spec ที่มีอยู่แล้วสำหรับ payee-entity-kind
  (mirror เพิ่มเคส income-category)

**หมายเหตุ scope:** ข้อนี้เป็น "prerequisite" ในแง่ที่ไม่แตะ gate/permission ใหม่ใด ๆ เลย แต่**เป็นการเปลี่ยนแปลงที่
ผู้ใช้เห็นทันที** (ฟิลด์บังคับใหม่) — ไม่ใช่ของที่ "invisible จนกว่า gate เปิด" เหมือน Phase 2-4 ที่เหลือ ตรงตาม
S2/S3 ที่ต้องทำงานไม่ว่า gate จะ OPEN หรือ CLOSED

---

## Phase 2 — Permission/pack ใหม่ + use case ใหม่ + PDF template ใหม่ (ยังปิดด้วย gate — ไม่ user-facing)

### 2.1 Permission + pack

- `apps/api/src/modules/auth/permission-registry.ts`: เพิ่มนิยาม permission ใหม่ใกล้บรรทัด 217-223 (ข้าง
  `wht.certificate.read`/`wht.external_certificate.link`):
  ```
  { key: 'wht.certificate.issue', description: 'Issue a 50 ทวิ WHT certificate directly from a settlement/expense confirm (SYSTEM issuance)', riskLevel: 'HIGH' },
  ```
  เพิ่ม `'wht.certificate.issue'` เข้า role grant ของ **FINANCE** (บรรทัด 875) และ **ACCOUNTANT** (บรรทัด 941)
  ต่อท้าย `'wht.certificate.read', 'wht.external_certificate.link'` ทันที (role เดียวกับที่ยืนยันไว้ในสเปก)
- `apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts`: เพิ่ม pack ใหม่ต่อจาก
  `pack.wht.certificate.manage` (บรรทัด ~454):
  ```
  {
    key: 'pack.wht.certificate.issue', module: 'tax', featureEntitlementKey: 'thai_tax',
    nameTh: 'ออกหนังสือรับรองหัก ณ ที่จ่ายในระบบ', nameEn: 'System-issue WHT certificate',
    description: 'ออกหนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) เป็น PDF ในระบบทันทีที่ยืนยันจ่าย/ยืนยันเอกสาร',
    permissionKeys: ['wht.certificate.issue'],
  },
  ```
  ยืนยันจาก `filterPermissionsByEntitlement`/`pack.wht.certificate.manage` comment (บรรทัด 445-454) ว่า pack
  ที่ไม่มี `featureEntitlementKey` ชนะ pack ที่มี เมื่อ permission เดียวกันอยู่สองที่ — `wht.certificate.issue`
  เป็น key ใหม่ที่ไม่อยู่ใน `pack.wht.certificate.manage` เลย จึงไม่ชนกัน ไม่ต้องแก้ pack เดิม
- ไม่แก้ `pack.tax.prepare`/`tax.certificate.issue` — คงเดิมทั้งหมด

### 2.1b Permission แยกต่างหากสำหรับตั้งค่า/อัปโหลดลายเซ็น — OWNER เท่านั้น (Decision B)

**คนละ permission จากการ "ออกเอกสาร"** — mirror precedent ที่มีอยู่แล้วเป๊ะ ๆ: `company.legal_identity.manage`
(company facts ที่อ่อนไหว) เป็น OWNER-only โดยไม่ต้องมี allow-list พิเศษ แค่**ไม่เพิ่มเข้า role อื่นเลย** —
`OWNER: COMPANY_PERMISSION_KEYS` (permission-registry.ts:506) ทำให้ OWNER ได้ permission ทุกตัวที่ไม่ถูกยกให้
role อื่นโดยอัตโนมัติอยู่แล้ว ไม่ต้องเขียน allow-list ใหม่

- `apps/api/src/modules/auth/permission-registry.ts`: เพิ่มนิยามใหม่ใกล้บล็อก WHT (บรรทัด 217-223):
  ```
  { key: 'company.tax_signature.manage', description: "Upload/manage the company's WHT-certificate signature image (authorized signatory)", riskLevel: 'HIGH' },
  ```
  **ห้ามเพิ่มเข้า role list ของ FINANCE (875) หรือ ACCOUNTANT (941)** — การไม่เพิ่มคือกลไกที่ทำให้เป็น
  OWNER-only เอง (เหมือน `company.legal_identity.manage` ที่ไม่ปรากฏใน role list ไหนเลยนอกจาก OWNER)
- `capability-pack.registry.ts`: เพิ่ม pack ใหม่ต่อจาก `pack.wht.certificate.issue` (2.1):
  ```
  {
    key: 'pack.company.tax_signature.manage', module: 'tax', featureEntitlementKey: 'thai_tax',
    nameTh: 'จัดการลายเซ็นผู้จ่ายเงินสำหรับ 50 ทวิ', nameEn: 'Manage WHT certificate signature',
    description: 'อัปโหลด/จัดการรูปลายเซ็นผู้มีอำนาจลงนามที่จะประทับลงหนังสือรับรองหัก ณ ที่จ่ายที่ระบบออกให้',
    permissionKeys: ['company.tax_signature.manage'],
  },
  ```
  `featureEntitlementKey: 'thai_tax'` ตั้งใจ — ตั้งค่านี้ไม่มีความหมายถ้าบริษัทไม่มีสิทธิ์ออกเอกสารในระบบเลย
  (ตรงข้ามกับ `pack.company.legal_identity.manage` ที่ ungated เพราะข้อมูลนิติบุคคลจำเป็นทุกบริษัทเสมอ — ที่นี่
  ไม่ใช่กรณีนั้น) รวมกับการไม่ให้ FINANCE/ACCOUNTANT ถือ permission นี้เลย ทำให้ต้องผ่านทั้งสองเงื่อนไข: มี
  `thai_tax` **และ** เป็น OWNER

### 2.2 Use case ใหม่ — mint ตรงจาก handoff (ตอบ "must resolve" ข้อ 1)

**ชื่อ:** `IssueWhtCertificateFromHandoffUseCase`
**ไฟล์ใหม่:** `apps/api/src/modules/tax/application/use-cases/issue-wht-certificate-from-handoff.use-case.ts`
(sibling ของ `create-wht-certificate.use-case.ts` และ `wht-certificate-handoff.use-case.ts`)

**Input:** `{ ctx: RequestContext, handoffId: string }` — **ไม่รับ TaxPeriod/TaxEventIds เลย** ทำงานบน
`WhtCertificateHandoff` row ที่มีอยู่แล้วเท่านั้น (ทั้ง AP และ Expenses สร้าง handoff ไว้ก่อนเสมอตาม Phase 1.2/
`createWhtHandoffForPayment` ที่มีอยู่แล้ว — ปุ่ม "ออกเอกสารในระบบ" ในทั้งสอง UI จึงเรียก endpoint เดียวกันตัวนี้
โดยอ้างอิงแค่ `handoffId` ไม่ต้องแยก use case ต่อ entry point)

**Dependencies:** `PrismaTaxRepository`, `ReserveDocumentNumberUseCase`, `CommitDocumentNumberUseCase`,
`AuditService`, `LaunchGateGuardService` (ผ่าน `isLaunchRouteOpen` helper ที่ export อยู่แล้วใน
`wht-certificate-handoff.use-case.ts`), `TaxArtifactRendererService`

**Logic (แก้จุดแยกทาง finding 8a ตรง ๆ):**

1. โหลด handoff row, tenant check (`row.companyId === ctx.companyId`), 404 ถ้าไม่พบ
2. `if (row.status !== 'REQUIRED')` → `ConflictException('wht_handoff_not_issuable', ...)` — บังคับ mutually
   exclusive กับ `linkExternal` (ผู้ใช้เลือกทางใดทางหนึ่งตาม spec §4.1)
3. `if (!(await this.isSystemIssuanceOpen()))` → `ConflictException` (defense-in-depth: permission+entitlement
   กันไว้ที่ชั้น UI/route อยู่แล้ว แต่ route-readiness gate เป็นคนละแกน ต้อง re-check เหมือนที่
   `CreateWhtCertificateUseCase` ทำ)
4. ดึงฟิลด์ทั้งหมดจาก `row.prefillSnapshotJson` (`WhtHandoffPrefillDto`) ตรง ๆ — payerSnapshot (มี branchCode
   จริงแล้วหลัง Phase 1.1), payeeSnapshot, formType, incomeCategoryCode/Name, whtRate, grossAmount,
   withheldAmount, paymentDate — **ไม่มีการคำนวณใหม่ เพราะ AP/Expenses ป้อนไว้ครบตั้งแต่สร้าง handoff แล้ว**
5. **หา/สร้าง `TaxPeriod` โดยไม่ต้องมี `TaxEventIds` มาก่อน** — นี่คือคำตอบรูปธรรมของ finding 8a:
   `const periodKey = formPeriodKey(formType, paymentDate)` (reuse `tax-period.logic.ts` ตรง ๆ) แล้ว
   `const period = await this.taxRepo.upsertPeriod({ companyId, taxType: 'WHT', formType, periodKey })`
   — **`upsertPeriod` เป็น find-or-create helper ที่ `sync-tax-events.use-case.ts` ใช้อยู่แล้วทุก loop**
   (บรรทัด 80,97,152,161,203,256,314) เรียกมันตรง ๆ แทนที่จะ reuse shape ของ `CreateWhtCertificateUseCase`
   ที่ต้องการ `TaxEventIds` ที่มีอยู่ก่อน — วิธีนี้ตอบโจทย์ "ออกได้ทันทีตอนยืนยัน" โดยไม่ง้อ `POST tax/sync`
   เลย และยังคง FK `WhtCertificate.taxPeriodId` (NOT NULL ในสคีมา, บรรทัด 5116) ให้ถูกต้องเสมอ
   `WhtCertificate.taxEventIdsJson` เขียนเป็น `[]` (ค่า default อยู่แล้ว) เพราะไม่มี `TaxEvent` แถวไหนถูกผูกจริง
   — certificate นี้ mint ตรงจาก settlement/expense facts ไม่ใช่จาก tax event
6. **Reserve number พร้อม P2002 catch-and-replay** (ตอบ finding 2 — จำกัดเฉพาะ use case ใหม่นี้ ไม่แก้
   `ReserveDocumentNumberUseCase`/`reserveNumberInTransaction` ที่ document type อื่นอีกนับสิบใช้ร่วมกันอยู่
   — แก้ตรงนั้นเสี่ยงเกิน scope): `idempotencyKey = wht_certificate_from_handoff:${row.id}` (คงที่ต่อ handoff
   หนึ่งใบ) — `try { await this.reserveNumber.execute(...) } catch (P2002) { reload WhtCertificate ที่ผูกกับ
   handoff.certificateId (ซึ่งผู้ชนะ race เขียนไว้แล้ว) แล้ว return แถวนั้นแทนที่จะโยน error ดิบ }` — mirror
   shape เดียวกับ `WhtCertificateHandoffUseCase.createOrReplay` (บรรทัด 113-142)
7. Render PDF ผ่าน `TaxArtifactRendererService` เมธอดใหม่ (ดู 2.3) — ไม่ใช่ `.render('PDF', ...)` เดิม
8. ใน Prisma `$transaction` เดียว: create `WhtCertificate` row (`taxPeriodId: period.id`, snapshots,
   `status:'ISSUED'`, `issuedAt`, `issuedByUserId`) → `commitNumber.execute(...)` → 
   `whtCertificateHandoff.updateMany({ where: { id: row.id, companyId, status:'REQUIRED' }, data: {
   status:'SYSTEM_ISSUED', certificateId: newRow.id } })` — conditional `updateMany` (ไม่ใช่ `update` ตรง ๆ)
   เพื่อให้แข่งกับ `linkExternal` (ที่ใช้ pattern เดียวกัน) แล้วชนะแค่ผู้เดียวเสมอ
9. `audit.log({ action: 'tax.wht_certificate.issue', riskLevel: 'HIGH', metadataJson: { source: 'handoff',
   handoffId: row.id, certificateNumber, ... } })` — reuse action key เดิมของ `CreateWhtCertificateUseCase`
   ตรง ๆ ตามที่สเปก §7 สั่งไว้ ("reuse ทั้งชุด ไม่คิด audit schema ใหม่") เติมแค่ `source` ใน metadata
10. คืน DTO เดียวกับ `CreateWhtCertificateUseCase.toDto()` + `pdfArtifact`

### 2.3 Route ใหม่ (ตอบ "must resolve" ข้อ 4)

**คำตอบ:** endpoint ใหม่ sibling กับ `linkExternalWhtCertificate` ใน `wht/payment-handoffs` family — **ไม่ใช่**
การ overload `POST tax/wht-certificates` เดิม

`apps/api/src/modules/tax/presentation/http/tax.controller.ts` เพิ่มต่อจาก `linkExternalWhtCertificate`
(บรรทัด ~241-253):
```ts
@Post('wht/payment-handoffs/:handoffId/system-certificate')
@HttpCode(200)
@RequirePermissions('wht.certificate.issue')
@ApiOperation({ summary: 'Issue a 50 Tawi certificate directly from a settlement/expense WHT handoff' })
async issueSystemWhtCertificate(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('handoffId') handoffId: string) {
  assertRouteCompany(ctx, companyId);
  return this.issueFromHandoff.execute(ctx, handoffId);
}
```
**เหตุผล:** (a) `POST tax/wht-certificates` รับ body shape ของ `CreateWhtCertificateDto` ทั้งชุด
(`taxPeriodId`+`taxEventIds` บังคับ) ซึ่งเป็นคนละ input กับ use case ใหม่ที่รับแค่ `handoffId` — การ overload
ด้วย permission ที่สองจะต้องแตกกิ่ง logic ในเมธอดเดียวจนอ่านยากกว่าการแยก route ตรง ๆ (b) route ตระกูล
`wht/payment-handoffs/*` **จงใจไม่อยู่ใต้ prefix `tax/`** อยู่แล้ว (comment บรรทัด 196-200 ในไฟล์เดียวกัน) เพื่อ
ให้ทำงานได้แม้บริษัทไม่มี `thai_tax` — งานนี้กลับกัน (ต้องมี `thai_tax`) แต่ URL family เดิมยังเหมาะสมที่สุดเพราะ
ปุ่มทั้งสอง UI (AP/Expenses) อ่าน handoff จาก endpoint ตระกูลนี้อยู่แล้ว (`GET wht/payment-handoffs/:handoffId`)
ไม่ต้องผูก id คนละชุด (c) permission แยก (`wht.certificate.issue`) คุมเองอยู่แล้วว่าใครเรียกได้ ไม่ต้องพึ่ง URL
prefix เป็นกลไก gating

Inject `IssueWhtCertificateFromHandoffUseCase` เป็น constructor param ใหม่ของ `TaxController`
(`issueFromHandoff`), register ใน `apps/api/src/modules/tax/tax.module.ts` providers

### 2.4 เปิดทางให้ frontend รู้ว่า gate เปิดหรือปิด

`WhtCertificateHandoffUseCase.list`/`.get`/`toDto()` (`wht-certificate-handoff.use-case.ts`) เพิ่ม
`systemIssuanceOpen: boolean` ในผลลัพธ์ — คำนวณครั้งเดียวต่อ request จาก `isSystemIssuanceOpen()` ที่มีอยู่แล้ว
บนคลาสเดียวกัน ไม่ต้องเพิ่ม endpoint แยก — เพิ่ม field นี้ใน `WhtCertificateHandoffDto`
(`packages/contracts/src/tax.ts`, บรรทัด ~356-370) แบบ additive เพื่อให้ AP/Expenses UI (Phase 4) ตัดสินใจ
แสดง/ซ่อนปุ่มได้โดยไม่ต้อง fetch เพิ่ม (permission axis อ่านจาก `permissions` prop ที่ UI มีอยู่แล้ว —
ดู Phase 4)

### 2.5 PDF template ใหม่ (SVG) — **ไม่แทนที่ `buildMinimalPdf` ในที่เดิม**

**สิ่งที่ต่างจากสเปก (พบระหว่างอ่านโค้ดจริง — สำคัญ):** สเปก §6 บอกว่า "ต้องแทนที่ `buildMinimalPdf`" แต่
`buildMinimalPdf`/`buildTaxExportArtifact` **ถูกใช้ร่วมกันโดย `GenerateTaxFilingPackageUseCase`** ด้วย
(`generate-tax-filing-package.use-case.ts:64` เรียก `buildTaxExportArtifact(exportFormat, ...)` สำหรับ
export package ภาษี VAT/WHT ทั้งชุด — คนละเอกสารกับ 50 ทวิ) การแทนที่ `buildMinimalPdf` ตรง ๆ จะเปลี่ยน PDF ของ
filing package ไปด้วยโดยไม่ตั้งใจ นอกสโคปและไม่มี test คลุม — **v1 ต้องไม่แตะ `buildMinimalPdf`/
`buildTaxExportArtifact` เลย**

**ทำแทน:** ไฟล์ใหม่ `apps/api/src/modules/tax/domain/logic/wht-certificate-pdf.logic.ts` — ฟังก์ชัน pure
`buildWhtCertificateSvg(fields, payerSnapshot, payeeSnapshot, signature?: { mode: 'AUTO_STAMP'|'BLANK';
signatureImageBase64?: string }): Buffer` ประกอบ SVG string ตามฟิลด์ 50 ทวิ จริง (เลขประจำตัวผู้เสียภาษี/สาขา,
เล่มที่-เลขที่, checkbox ภ.ง.ด.3/53, ตารางประเภทเงินได้/อัตรา/จำนวนเงิน/ภาษีที่หัก, ช่องผู้จ่ายเงินลงชื่อ — วาง
`<image>` base64 เมื่อ `AUTO_STAMP`, เว้นว่างเมื่อ `BLANK`) — **Decision A (2026-09-22): v1 มีแค่ `signature`,
ไม่มี `seal` เลย** ช่องตราประทับบนแบบฟอร์มจริงเว้นว่างเสมอในรอบนี้ (ไม่ใช่ placeholder — แค่ไม่วาดอะไรตรงนั้น) —
เลื่อนไป slice ถัดไปตาม owner decision แล้วเรียก
**`renderSubstituteReceiptPdf(svgBuffer, certificateNumber)`** ที่ export อยู่แล้วจาก
`apps/api/src/modules/expenses/domain/logic/substitute-receipt-pdf.logic.ts:341` **ตรง ๆ** — ฟังก์ชันนี้เป็น
primitive ทั่วไป (rasterize SVG ด้วย sharp + Noto Sans Thai, dark-pixel-ratio guard, compose pdf-lib) ไม่มี
expense-specific logic ผูกอยู่เลย (`import` ข้าม module domain-logic เป็น pattern ที่มีอยู่แล้วในไฟล์เดียวกับที่
`wht-certificate-handoff.use-case.ts` import `vendor-counterparty-match.logic` จาก `accounting-documents`
module) — **ไม่ fork raster pipeline ใหม่**

`TaxArtifactRendererService` เพิ่มเมธอดใหม่ `renderWhtCertificate(fields, payerSnapshot, payeeSnapshot,
signature)` ที่เรียก `buildWhtCertificateSvg` + `renderSubstituteReceiptPdf` — คง `.render('PDF', ...)` เดิม
(buildMinimalPdf) ไว้ให้ filing package ใช้ต่อไปไม่เปลี่ยนแปลง `CreateWhtCertificateUseCase` (บรรทัด 117-129)
เปลี่ยนจาก `this.renderer.render('PDF', ...)` เป็น `this.renderer.renderWhtCertificate(...)` ด้วย (gate เดียวกัน
คุมทั้งสอง entry point — Tax-workspace และ AP/Expenses — จึงต้องได้ PDF จริงแบบเดียวกันทั้งคู่ ไม่ใช่แค่ path ใหม่)

**Font/raster caveat (spec finding 3, ยืนยันแล้วไม่เปลี่ยน):** Noto Sans Thai ติดตั้งเฉพาะใน API Docker image
(`apps/api/Dockerfile:5,99-101` ยืนยันแล้วตรงกับสเปก) ข้อความในผลลัพธ์เป็น raster ไม่ใช่ text ที่ select ได้ —
ยอมรับได้ต่อ v1 ตาม pattern เดิม

### 2.6 Verify (Phase gate)

```bash
pnpm --filter @watchdog-bms/contracts build && pnpm --filter @watchdog-bms/api lint && pnpm --filter @watchdog-bms/api test
pnpm --filter @watchdog-bms/api prisma:validate
```
- ไฟล์ทดสอบใหม่ (เพิ่มเข้า `apps/api/package.json` "test" list ตาม convention ที่ repo enumerate รายไฟล์):
  `issue-wht-certificate-from-handoff.use-case.spec.ts` (เคส: mint จาก handoff โดยไม่มี TaxPeriod มาก่อน,
  P2002 double-click race, mutual-exclusion กับ EXTERNAL_LINKED, gate ปิด → ConflictException,
  permission ไม่มี `thai_tax` → 403 ผ่าน pack ที่ gate)
- ไม่มีอะไร user-facing เปลี่ยนเพราะ gate ยังปิด — verify ด้วย unit test ตรง ๆ ไม่ใช่ manual UI check

---

## Phase 3 — ค่าตั้งค่าลายเซ็นระดับบริษัท (v1: ลายเซ็นเท่านั้น — Decision A)

**Decision A (2026-09-22, owner):** "ตอนนี้ใช้แค่ลายเซ็นไปก่อน ตราประทับเดี๋ยวตามมาทีหลัง" — v1 ทำแค่ลายเซ็น
ไม่มีตราประทับบริษัทเลย (ตัดออกจากทุกจุด: schema, upload UI, PDF wiring) ช่องตราประทับบนแบบฟอร์มจริงเว้นว่างไว้
เสมอในรอบนี้ — เป็น known gap เทียบกับแบบฟอร์มจริงที่ตั้งใจเลื่อนไปทำใน slice ถัดไป ไม่ใช่บั๊ก

### 3.1 Schema (additive บน `CompanyTaxProfile`)

ยืนยันแล้วว่า `CompanyTaxProfile` (schema.prisma:4544-4561) ยังเป็นที่ที่เหมาะสม — เป็น per-company
(`companyId @unique`), เก็บ tax-related company setting อยู่แล้ว (`taxReviewerRole`, `branchPolicy`) ไม่มีอะไร
ในโมเดลที่ขัดกับการเพิ่มฟิลด์ signature — เพิ่ม (เฉพาะสองฟิลด์นี้ ไม่มี seal ใน v1):
```prisma
signatureMode              String    @default("BLANK")
signatureImageAttachmentId String?
```
Migration additive ใหม่ (ชื่อแนว `2026xxxx_company_tax_profile_signature_mode`) — default `BLANK` ทำให้บริษัทที่
ยังไม่ตั้งค่าอะไรเลยพฤติกรรมเดิมทุกประการ **การเพิ่มคอลัมน์ `companySealImageAttachmentId` ในอนาคต (slice ถัดไป)
เป็น additive เช่นกัน ไม่กระทบ migration รอบนี้**

### 3.2 Upload/link (reuse ปฐมภูมิที่มีอยู่แล้ว ไม่ใช่ `CompanySignatureAsset`)

**ห้าม reuse `CompanySignatureAsset`** — model เดิม comment ไว้ชัดว่าเป็น "PERSONAL asset" ต่อพนักงาน
(schema.prisma:2805-2831 ยืนยันแล้วไม่เปลี่ยน) คนละ concept กับผู้มีอำนาจลงนามของบริษัท — **reuse
plumbing ทั่วไปแทน:** `CreateUploadIntentUseCase`/`CompleteAttachmentUploadUseCase`
(`apps/api/src/modules/data-model-core/application/use-cases/`) เขียนลง `AttachmentObject` — ทั้งสองอยู่ใน
`DataModelCoreModule` ที่ `tax.module.ts` import อยู่แล้ว (บรรทัด 3,30) **ไม่ต้อง import ProcurementModule/
ExpensesModule เพิ่มสำหรับจุดนี้**

Linking: เพิ่มเมธอดเล็ก ๆ บน `PrismaTaxRepository` เอง (`apps/api/src/modules/tax/infrastructure/repositories/prisma-tax.repository.ts`)
ที่เขียนลงตาราง `attachmentLink` ตรง ๆ (`targetType: 'company.tax_signature'`) — mirror รูปแบบเดียวกับ
`linkAttachmentToTarget` ที่ `prisma-expense.repository.ts:3405`/`prisma-procurement.repository.ts`/
`prisma-reimbursement.repository.ts`/`prisma-crm-inbox.repository.ts` **แต่ละโมดูลมีสำเนาของตัวเองอยู่แล้ว**
(convention ของ repo คือแต่ละโมดูลมีสำเนาเล็ก ๆ ของตัวเอง ไม่ใช่ shared service ข้ามโมดูล) — เพิ่มสำเนาที่ห้าใน
`tax` module ตาม pattern เดิมทุกประการ ไม่สร้าง abstraction ใหม่ข้ามโมดูล

### 3.3 API + UI

- `TaxController`: endpoint ใหม่ `PATCH companies/:companyId/tax/profile/signature` — **guard ด้วย
  `company.tax_signature.manage` (Decision B — OWNER เท่านั้น, ไม่ใช่ `tax.profile.manage`)** เพราะลายเซ็น
  ผู้มีอำนาจลงนามของบริษัทอ่อนไหวกว่าการตั้งค่าภาษีทั่วไปที่ FINANCE/ACCOUNTANT ถือ `tax.profile.manage` อยู่
  แล้ว — ดู 2.1b รับ `{ signatureMode, signatureAttachmentId? }` (ไม่มี `sealAttachmentId` ใน v1), validate
  `AUTO_STAMP` ต้องมี `signatureAttachmentId`
- Web: หน้าตั้งค่าเล็ก ๆ ใหม่ระดับบริษัท (เช่นใน `apps/web/src/features/tax/` หรือหน้า company-settings ที่มีอยู่
  แล้ว — ต้องสำรวจ ณ ตอน implement ว่ามีหน้า tax settings อยู่แล้วหรือต้องสร้างใหม่ทั้งหน้า) toggle
  BLANK/AUTO_STAMP + upload **รูปเดียว (ลายเซ็น)** — แสดงเฉพาะ OWNER (permission ใหม่ไม่ให้ FINANCE/ACCOUNTANT
  เห็นเมนูนี้เลย)

### 3.4 PDF template wiring

`IssueWhtCertificateFromHandoffUseCase` (2.2 ข้อ 7) query `CompanyTaxProfile` ก่อน render, ถ้า `AUTO_STAMP`
โหลด bytes ของ signature attachment แปลงเป็น base64 ส่งเข้า `buildWhtCertificateSvg`'s `signature` param — ถ้า
`BLANK`/ไม่มี profile เลย ส่ง `undefined` (เว้นว่างเหมือนเดิม) **ช่องตราประทับบนแบบฟอร์มไม่ถูกวาดเลยใน v1**
(ไม่ใช่ placeholder — เพียงไม่มี logic ใด ๆ อ้างถึงตราประทับในรอบนี้)

### 3.5 Verify

- `prisma-tax.repository.spec.ts` (หรือไฟล์ signature setting ใหม่): เคส set `AUTO_STAMP` ต้องมี
  `signatureAttachmentId`, `BLANK` ไม่ต้องมี; เคส permission — FINANCE/ACCOUNTANT เรียก endpoint นี้ต้องถูก
  ปฏิเสธ (403), มีแค่ OWNER ที่ผ่าน
- `wht-certificate-pdf.logic.spec.ts` ใหม่: `AUTO_STAMP` → SVG มี `<image>` ของลายเซ็นหนึ่งจุด (ไม่มีตราประทับ),
  `BLANK`/ไม่ตั้งค่า → ไม่มีรูปเลย (ตรง S11; **S10 ในสเปกเดิมอ้างถึงทั้งลายเซ็น+ตราประทับ — v1 ครอบคลุมแค่ส่วน
  ลายเซ็นตาม Decision A เท่านั้น สเปกไฟล์เดิมไม่ได้ถูกแก้ในรอบนี้**)

---

## Phase 4 — Frontend wiring ที่สองจุดเข้า (ยังปิดด้วย gate)

### 4.1 AP — `WhtHandoffDetail` (`apps/web/src/features/accounts-payable/AccountsPayablePages.tsx`)

**พบระหว่างอ่านโค้ดจริง:** `const linked = handoff.status === 'EXTERNAL_LINKED'` (บรรทัด ~980) **ไม่ครอบคลุม
`SYSTEM_ISSUED` เลยวันนี้** — ถ้าไม่แก้ แถวที่ระบบออกให้แล้วจะยังโชว์ฟอร์ม "แนบเอกสาร" อยู่ (ผิด) ต้องแก้เป็น
`const issued = handoff.status === 'SYSTEM_ISSUED'`, `const linked = handoff.status === 'EXTERNAL_LINKED'`

การเปลี่ยนแปลง:
- ปุ่มใหม่ "ออกเอกสารในระบบ" แสดงเมื่อ `handoff.status === 'REQUIRED' && handoff.systemIssuanceOpen &&
  permissions.includes('wht.certificate.issue')` (ทั้งสองแกนจาก §8 — permission axis รวม entitlement แล้ว
  เพราะ pack ที่ gate ด้วย `thai_tax` กรอง permission ออกจาก effective set ก่อนถึง frontend) วางคู่กับฟอร์ม
  "แนบเอกสาร" เดิม ในบล็อก `canLink` (บรรทัด ~1090-1116) — ผู้ใช้เลือกทางใดทางหนึ่ง
- คลิกแล้วเรียก endpoint ใหม่ `POST .../wht/payment-handoffs/:handoffId/system-certificate` (เพิ่ม client fn
  ใน `accounts-payable.api.ts` เช่น `issueSystemWhtCertificate(companyId, handoffId)`) สำเร็จแล้ว `onLinked()`
  (reload panel — ใช้ callback เดิม ไม่ต้องเพิ่ม)
- เมื่อ `issued === true`: โชว์ banner คู่กับ `linked` block เดิม (บรรทัด 1086-1089) พร้อมลิงก์ดาวน์โหลด PDF
  (`pdfAttachmentId` จาก certificate — ต้อง `GET`/download attachment ตาม pattern ดาวน์โหลดไฟล์ที่มีอยู่แล้วใน
  repo)
- S9 (ไม่มี `thai_tax`): ปุ่มไม่แสดงเลย (ไม่ใช่ disabled) เพราะ `permissions.includes(...)` เป็น false ตรง ๆ —
  data-capture fields และฟอร์มแนบเอกสารเดิมทำงานปกติไม่กระทบ

### 4.2 Expenses — `ExpenseReviewPage.tsx` confirm flow

- Dropdown ใหม่จาก Phase 1.2 (บังคับกรอกก่อน confirm ได้เมื่อ `whtAmount > 0`)
- หลัง `confirmExpense` สำเร็จ (handoff ถูกสร้างจาก Phase 1.2 แล้วในธุรกรรมเดียวกัน): ถ้า response ส่ง
  `handoffId`/`systemIssuanceOpen` กลับมา (ต้องเติมใน `ConfirmExpenseDto` response หรือ query handoff แยกทันที
  หลัง confirm — เลือกแบบหลังถ้า response เดิมไม่อยากแก้ shape เยอะ: `GET wht/payment-handoffs` filter ด้วย
  `sourcePaymentId=expenseId` ที่มีอยู่แล้วในรูปแบบ `WhtCertificateHandoffUseCase.list`) และ
  `permissions.includes('wht.certificate.issue')` → เสนอปุ่ม/prompt "ออกเอกสารในระบบ" ในหน้าเดียวกัน (ไม่บังคับ
  ตามสเปก §4.2 ข้อ 3 — ปิดไปได้)
- เรียก endpoint เดียวกันกับ AP (`POST .../wht/payment-handoffs/:handoffId/system-certificate`)

### 4.3 Verify

- `accounts-payable.model.spec.ts` / component test ใหม่: ปุ่มแสดงเมื่อ permission+gate ผ่านเท่านั้น (S9),
  `issued` state แสดง banner ถูกต้อง (ไม่ใช่ฟอร์มแนบเอกสาร)
- `expense-capture-status.logic.spec.ts` / web spec ใหม่: prompt หลัง confirm แสดงเมื่อเงื่อนไขผ่าน
- Manual/E2E ถ้ารันได้ local: เปิด gate ชั่วคราวใน local env (ตั้ง seed OPEN เฉพาะ dev) แล้วคลิกจริงหนึ่งรอบ
  ต่อ entry point — บันทึกผลใน memory ถ้าไม่ได้รันให้บันทึกเหตุผล

---

## Phase 5 — Tests (รายการที่ต้องเพิ่ม/ต่อยอด นอกเหนือจาก per-phase ด้านบน)

รายการที่มีอยู่แล้วต้องเขียวต่อ (สเปก §12 finding 4 — ไม่ทำซ้ำที่นี่): `create-wht-certificate.use-case.spec.ts`,
`wht-certificate-handoff.use-case.spec.ts`, `wht-income-category.use-case.spec.ts`, `wht-report.logic.spec.ts`,
`sync-tax-events-supplier-payment-wht.use-case.spec.ts`, `expense-status.logic.spec.ts`,
`prisma-expense.repository.atomic-confirm.spec.ts`, `accounts-payable.logic.spec.ts`/`.model.spec.ts` (web)

ไฟล์ใหม่ที่ต้องมี (รวมจากทุก phase ด้านบน):

1. `apps/api/src/modules/tax/application/use-cases/issue-wht-certificate-from-handoff.use-case.spec.ts` —
   mint สำเร็จไม่มี TaxPeriod มาก่อน, P2002 replay, mutual-exclusion กับ EXTERNAL_LINKED, gate ปิด
2. `apps/api/src/modules/tax/domain/logic/wht-certificate-pdf.logic.spec.ts` — SVG มีฟิลด์ครบ, AUTO_STAMP vs
   BLANK image placement, ผ่าน dark-pixel-ratio guard เดิม (ยืม fixture รูปแบบเดียวกับ substitute-receipt spec)
3. ต่อยอด `apps/api/src/modules/procurement/infrastructure/prisma-procurement-integrity.repository.spec.ts` —
   payer branchCode ไม่ null (1.1)
4. ต่อยอด `expense-status.logic.spec.ts` — บล็อก confirm เมื่อไม่มี whtCategoryCode (S2)
5. ต่อยอด `prisma-expense.repository.atomic-confirm.spec.ts` — handoff ถูกสร้างที่ confirm (S3)
6. ต่อยอด `apps/api/src/modules/procurement/infrastructure/prisma-procurement.repository.spec.ts` (void path)
   — void payment ที่ handoff เป็น `SYSTEM_ISSUED` ยัง block ด้วย `wht_certificate_linked_requires_review`
   เหมือนเดิม (โค้ด guard มีอยู่แล้วที่บรรทัด 1602 — เพิ่มแค่ test ตาม S7 ไม่ต้องแก้โค้ด)
7. Web: `accounts-payable.model.spec.ts` เคสปุ่มใหม่ (S9), component test ปุ่ม/banner ใน `WhtHandoffDetail`
8. Web: expense confirm-flow spec ใหม่ (dropdown บังคับ + post-confirm prompt)
9. `permission-registry.spec.ts`/`capability-pack.registry.spec.ts` (ถ้ามี) — `wht.certificate.issue` อยู่ใน
   pack ที่ gate ด้วย `thai_tax` เท่านั้น ไม่หลุดเข้า `pack.wht.certificate.manage`
10. `permission-registry.spec.ts` (ถ้ามี) — `company.tax_signature.manage` ไม่ปรากฏใน FINANCE/ACCOUNTANT role
    grant list เลย (Decision B, OWNER-only ผ่าน `COMPANY_PERMISSION_KEYS` เท่านั้น)

Verify รวมทุก phase:
```bash
pnpm --filter @watchdog-bms/contracts build && pnpm --filter @watchdog-bms/api lint && pnpm --filter @watchdog-bms/api test
pnpm --filter @watchdog-bms/api prisma:validate
pnpm --filter @watchdog-bms/web typecheck && pnpm --filter @watchdog-bms/web test
node scripts/run-line-ai-whole-chain-acceptance.mjs  # ไม่เกี่ยวกับ WHT โดยตรง แต่ตาม CI whole-chain lesson (memory) รันก่อน push เสมอถ้าแตะ apps/api
```

---

## Phase 6 — Evidence/rollout (เปิด gate จริง — process, ไม่ใช่โค้ด)

`cap.wht50bis/SYSTEM_INITIAL_ISSUE` เป็น `routeClass: SPECIALIST_LEGAL`, `specialistApprovalRequired: true`
(launch-matrix.catalog.ts:190-197, ยืนยันไม่เปลี่ยน) — เปิดได้เฉพาะ**หลังจาก** Phase 1-5 merge และมี evidence
ต่อไปนี้ (ไม่ใช่โค้ด เป็นสิ่งประดิษฐ์ที่ต้องผลิต):

### Golden-fixture ตัวอย่างจริงที่ใช้ทดสอบ

Owner ให้ตัวอย่างหนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) จริงที่บริษัทตัวเองเคยออกแล้วหนึ่งใบ ใช้เป็น**เคสหลัก**ของ
golden-fixture review ข้อ 1 ด้านล่าง (เพิ่มเติมจากเคสอื่นที่ผู้รีวิวเลือกทดสอบเองได้) — **ไฟล์ต้นฉบับเก็บไว้นอก git
repo เสมอ** (โฟลเดอร์ Downloads ของ owner บนเครื่อง — คำสั่ง owner ชัดเจน ไม่ใช่แค่ default ของ ponytail: ห้าม
commit ไฟล์จริงเข้า repo แม้ชั่วคราว เพราะเป็นเอกสารธุรกิจจริงของบุคคลที่สามที่มีชื่อ/เลขผู้เสียภาษีจริง) ไฟล์นี้จะ
ถูกเก็บไว้นอก repo ต่อไปเพื่อให้ผู้รีวิว (นักบัญชี/ผู้เชี่ยวชาญภาษี) ใช้ประกอบการรีวิวจริงตอน Phase 6 แล้ว**ลบทิ้ง
หลังรีวิวเสร็จ** (owner confirmed) — เอกสารชุดนี้ (spec/plan) บันทึกเฉพาะ**ค่าฟิลด์**ที่ transcribe มาเป็น plain
text/table ด้านล่างเท่านั้น ตาม pattern เดียวกับ test-fixture spec อื่นในเรพอที่อธิบายข้อมูลจริงด้วยค่า ไม่ฝังไฟล์
จริงไว้

ค่าฟิลด์ที่ต้อง reproduce (transcribe จากไฟล์จริงเมื่อ 2026-09-22):

| ฟิลด์ | ค่า |
|---|---|
| ผู้จ่ายเงิน (payer) — ชื่อ | บริษัท มั่งมียั่งยืน จำกัด (สำนักงานใหญ่) |
| ผู้จ่ายเงิน — เลขประจำตัวผู้เสียภาษีอากร (13 หลัก) | 0105569135722 |
| ผู้จ่ายเงิน — ที่อยู่ | 123/219 หมู่ 11 แขวงบางขุนเทียน เขตจอมทอง กรุงเทพมหานคร 10150 |
| ผู้ถูกหักภาษี (payee) — ชื่อ | บริษัท เลิฟไดร์ฟ คาร์เร้นท์ จำกัด (สำนักงานใหญ่) |
| ผู้ถูกหักภาษี — เลขประจำตัวผู้เสียภาษีอากร (13 หลัก) | 0105563047775 |
| ผู้ถูกหักภาษี — ที่อยู่ | 703 ถนนวงศ์สว่าง แขวงวงศ์สว่าง เขตบางซื่อ กรุงเทพมหานคร 10800 |
| ในแบบ (ภ.ง.ด.) | (7) ภ.ง.ด.53 — checked |
| ประเภทเงินได้พึงประเมินจ่าย | ข้อ 5 "การจ่ายเงินได้ที่ต้องหักภาษี ณ ที่จ่ายตามคำสั่งกรมสรรพากรที่ออกตามมาตรา 3 เตรส" (แถวที่มีค่ากรอก — เข้าเกณฑ์ค่าเช่า/ค่าบริการที่ระบุในรายการเดียวกัน สอดคล้องกับชื่อผู้รับเงินที่เป็นบริษัทให้เช่ารถ) |
| วันที่จ่ายเงิน | 12/09/2026 |
| จำนวนเงินที่จ่าย (gross) | 1,000.00 บาท |
| ภาษีที่หักและนำส่งไว้ (withheld) | 50.00 บาท |
| อัตราภาษีหัก ณ ที่จ่าย | 5% (50.00 ÷ 1,000.00) |
| รวมเงินภาษีที่หักนำส่ง (ตัวอักษร) | ห้าสิบบาทถ้วน |
| ผู้จ่ายเงิน (checkbox ด้านล่างฟอร์ม) | (1) หัก ณ ที่จ่าย — checked |
| เล่มที่ / เลขที่ (เอกสาร) | เล่มที่ ว่าง (ไม่ระบุ) / เลขที่ `WT2026090002` |
| รูปแบบเลขที่เอกสาร | `WT` + ปี ค.ศ. 4 หลัก + เดือน 2 หลัก + running number 4 หลัก (`WT2026090002` = WT + 2026 + 09 + 0002) |
| วันที่ออกหนังสือรับรองฯ | 12/9/2026 |
| ลายเซ็นผู้จ่ายเงิน / ตราประทับนิติบุคคล | ว่างทั้งคู่ในตัวอย่างจริง (ไม่มีชื่อลงนาม ไม่มีตราประทับ) — ใช้เป็นเคส `BLANK` (S11) ได้พอดีโดยไม่ต้องดัดแปลงอะไร |

**วิธีใช้เป็นเคสทดสอบ:** implementer สร้างรายการจ่าย/เอกสารค่าใช้จ่ายในระบบด้วยชุด payer/payee/จำนวนเงิน/อัตรา/
ประเภทเงินได้ตรงตามตารางข้างต้นเป๊ะ ๆ แล้วออก PDF ผ่าน use case ใหม่ (Phase 2, `IssueWhtCertificateFromHandoffUseCase`)
ให้นักบัญชี/ผู้เชี่ยวชาญภาษีเทียบ PDF ที่ระบบออกกับไฟล์จริง (ที่ยังอยู่นอก repo ตามข้างต้น จนกว่าจะรีวิวเสร็จแล้วลบทิ้ง)
ทีละฟิลด์ตามตารางนี้ — เป็น**เคสหลัก (primary acceptance case)** ของ item 1 ด้านล่าง เพิ่มเติมจากเคสอื่นที่ผู้รีวิว
เลือกทดสอบเองได้ตามต้องการ

1. **Golden-fixture accountant review (S8):** เจ้าของ Finance/Accounting lane (นักบัญชี/ผู้เชี่ยวชาญภาษีที่
   owner มอบหมาย — ไม่ใช่ agent) เปรียบเทียบ PDF ที่ออกจริงจาก use case ใหม่ (Phase 2) กับแบบ 50 ทวิ ตัวจริงทีละ
   ฟิลด์ อย่างน้อยหนึ่งรอบ (**เคสหลัก = ตัวอย่างจริงในตารางด้านบน**) ต้องรวมเคส `AUTO_STAMP` (ลายเซ็นเท่านั้น —
   ไม่มีตราประทับใน v1 ตาม Decision A) และ `BLANK` (Phase 3, ตัวอย่างจริงข้างต้นเข้าเคสนี้พอดี) อย่างละหนึ่งรอบ —
   รีวิวต้องรับทราบด้วยว่าช่องตราประทับเว้นว่างเป็นความตั้งใจของ v1 ไม่ใช่ข้อ
   บกพร่องที่รอแก้ก่อน OPEN
2. **บันทึกผลเป็น artifact:** `validationEvidenceRef` (ลิงก์/เอกสารผลรีวิว) + `validationEvidenceHash` (checksum
   ของ PDF ชุดที่รีวิว) ตาม field ที่ `feature-entitlement-decoupling-spec.md:86-87` นิยามไว้แล้วสำหรับ
   `FEATURE_LAUNCH_MATRIX` OPEN transition — ไม่ต้องออกแบบ field ใหม่
3. **`specialistApprovedByUserId`:** ผู้เชี่ยวชาญที่รีวิวเซ็นอนุมัติ (user id จริงในระบบ) ตาม field เดียวกัน
4. เปิด gate ผ่านกลไก launch-matrix ที่มีอยู่แล้ว (นอก scope ของ plan นี้ที่จะกำหนดวิธี — ใช้ mechanism เดิมของ
   `cap.*` gate อื่นที่เคย OPEN มาแล้ว)
5. Deploy note (จากสเปก §13): query audit `whtAmount > 0` payments/expenses ก่อน deploy Phase 1-2 เพื่อรู้ปริมาณ
   ที่จะมี handoff ใหม่เกิดขึ้นทันที (ไม่ใช่ blocker แค่ sizing)
6. **ข้อขัดแย้งเอกสารที่ยังไม่แก้ (สเปก §13, นอกสโคป):** แจ้งผู้ดูแล `feature-entitlement-decoupling-spec.md:331`
   และ `mangmee-package-entitlements-spec-th.md:99,105` ให้ทราบว่า spec/plan ชุดนี้กลับคำ design เดิมเฉพาะปุ่ม
   SYSTEM-issue — plan นี้ไม่แก้สองไฟล์นั้น (นอก scope ของ docs task ที่สร้าง plan นี้)

---

## สิ่งที่ต่างจากสเปก (พบระหว่างอ่านโค้ดจริง 2026-09-22, commit `18768642`)

1. **`WhtCertificate.taxPeriodId` เป็น NOT NULL + required relation ต่อ `TaxPeriod`** (schema.prisma:5116-5117,
   5137) — สเปก §5 บอกว่า "ไม่ต้อง migration ใหม่สำหรับฟิลด์เหล่านี้" ซึ่งถูกในแง่ไม่ต้องเพิ่มคอลัมน์ แต่ไม่ได้
   บอกว่า field นี้บังคับต้องมีค่า ทำให้ finding 8a ("mint ตรงจาก settlement facts") ต้องมีคำตอบว่าจะได้
   `taxPeriodId` มาจากไหนโดยไม่มี `POST tax/sync` มาก่อน — Phase 2.2 ข้อ 5 แก้ด้วยการ reuse `upsertPeriod`
   find-or-create helper ที่ `sync-tax-events.use-case.ts` มีอยู่แล้ว (ไม่ต้องเพิ่ม field ใหม่ แค่ต้องรู้ว่าต้อง
   เรียก helper ตัวไหน)
2. **`buildMinimalPdf`/`buildTaxExportArtifact` ถูกใช้ร่วมกับ `GenerateTaxFilingPackageUseCase`** ไม่ใช่แค่
   `CreateWhtCertificateUseCase` — สเปก §6 สั่ง "แทนที่ buildMinimalPdf" แบบเหมารวม ซึ่งจะกระทบ tax filing
   package PDF ที่ไม่เกี่ยวข้องกันเลยถ้าทำตามตัวอักษร — Phase 2.5 แก้โดยเพิ่มฟังก์ชัน/เมธอด renderer ใหม่แยก
   ต่างหาก ไม่แตะ `buildMinimalPdf` เดิมเลย
3. **`AccountsPayablePages.tsx`'s `WhtHandoffDetail` เช็คแค่ `status === 'EXTERNAL_LINKED'`** เพื่อซ่อนฟอร์ม
   แนบเอกสาร — ไม่ครอบคลุม `SYSTEM_ISSUED` เลยวันนี้ (เพราะยังไม่มีอะไรเขียนค่านั้น) ต้องเพิ่ม branch ใหม่ใน
   Phase 4.1 ไม่ใช่แค่เติมปุ่ม
4. **`ListWhtIncomeCategoriesUseCase` เป็น use case ที่มีอยู่แล้วใน procurement module และ export ไว้แล้ว** —
   สเปก finding 8b พูดถึงแค่ "endpoint คู่ขนาน" แต่ไม่ได้เจาะจงว่ามี use case สำเร็จรูปให้ import ตรง ๆ ได้เลย
   (Phase 1.2 ระบุ import path ที่แน่นอนแล้ว ประหยัดงานได้จริงเมื่อ implement)
5. `CompanyTaxProfile` (4544-4561), `Branch.taxBranchCode`, `CreateWhtCertificateUseCase`,
   `WhtCertificateHandoffUseCase`/`createOrReplay`, `TaxController`'s `wht/payment-handoffs` family,
   `capability-pack.registry.ts`'s `pack.tax.prepare`/`pack.wht.certificate.manage`,
   `permission-registry.ts`'s FINANCE/ACCOUNTANT grants, `CompanySignatureAsset`, Dockerfile font install,
   `renderSubstituteReceiptPdf` — **ยืนยันตรงกับสเปกทุกจุด ไม่มี drift** (บรรทัดที่ต่างจากสเปกเล็กน้อยในบางจุด
   อยู่ในช่วง ±1-5 บรรทัด ซึ่งเป็น normal churn ไม่ใช่ปัญหา)
