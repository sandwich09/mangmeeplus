# Agent Memory: legal-acceptance หน้ายืนยัน — ตัดค่าตรวจสอบไฟล์ และเปลี่ยนข้อ 3 เป็นการลบข้อมูล

Status: implemented + unit-verified (2026-08-15) — ยังไม่ได้รัน e2e (ต้องมี API/web/DB จริง)
Owner: supapron (เจ้าของสั่งตรงในเซสชัน 2026-08-15)

Scope:

- `apps/web/src/features/auth/LegalAcceptancePage.tsx`, `legal-acceptance.logic.ts`, `apps/web/src/common/legal/legal.css`
- `packages/contracts/src/legal-acceptance.ts`
- `apps/api/src/modules/auth/application/legal-acceptance.service.ts`, `presentation/auth.controller.ts`
- specs ที่ผูกกับ field/statement เดิม + `e2e/harness/auth.ts`, `e2e/legal-acceptance.spec.ts`

Decisions (จากคำสั่งเจ้าของ + คำถามยืนยัน 2 ข้อในเซสชันเดียวกัน):

1. เอาแถบ `ค่าตรวจสอบไฟล์ (SHA-256)` ออกจากหน้ายืนยันทั้งสองเอกสาร (ข้อ 1, ข้อ 2)
   - หลักฐานยังบันทึก `releaseFingerprintSha256` ลง DB เหมือนเดิม ตัดเฉพาะการแสดงผล
   - ค่า hash ของ artifact v3 ไม่ถูกแตะ (ตามข้อตกลง artifact ต้อง freeze)
2. ข้อ 3 เปลี่ยนจาก "อำนาจในการยืนยันแทนกิจการ" เป็น "การลบข้อมูล"
   - ข้อความยืนยันเปลี่ยนเป็นการรับทราบขั้นตอนการขอลบข้อมูลจริง ไม่ใช่แค่เปลี่ยนหัวข้อ
   - ประโยคยืนยัน "อำนาจกระทำการแทนกิจการ" ถูก **ตัดออกทั้งหมด** (เจ้าของเลือกเอง หลังแจ้งว่าเสียหลักฐาน
     ว่าผู้กดมีอำนาจผูกพันกิจการ) — `actorCapacity` ยังบันทึกจาก role ฝั่ง server เหมือนเดิม
3. `/data-deletion` เป็นหน้า live ไม่ใช่ artifact ที่ freeze ไว้พร้อม hash → ข้อ 3 ผูกกับข้อความยืนยัน +
   `statementVersion` + URL ของหน้า ไม่ผูกกับ SHA-256

Consequence ที่แจ้งเจ้าของแล้ว:

- ชุดข้อความเปลี่ยน → `legalStatementTemplateFingerprint()` เปลี่ยน → `scopeRef` เปลี่ยน และ
  `LEGAL_ACCEPTANCE_STATEMENT_VERSION` bump `v1` → `v2` → **ผู้ใช้ที่เคยยอมรับแล้วจะถูกถามใหม่ทุกคน**
  (surface = `MATERIAL_UPDATE`) หลักฐานเดิมยังอยู่ครบแบบ append-only

Plan:

1. contracts: `LegalAcceptanceStatements.capacity` → `deletion`; `legalAcceptanceStatements(locale)`
   (ไม่ต้องใช้ capacity/companyName อีก); `AcceptLegalDocumentsInput.capacityConfirmed` →
   `deletionAcknowledged`; เพิ่ม `LEGAL_DATA_DELETION_HREF`; bump statement version เป็น `v2`
2. api: ตัด `\n${statements.capacity}` ออกจาก terms row, ต่อ `statements.deletion` ท้าย privacy row
   (enum `LegalDocumentType` มีแค่ TERMS_OF_USE/PRIVACY_NOTICE → ไม่เพิ่ม migration),
   display challenge ใช้ `statements.deletion` + href ของหน้าการลบข้อมูล, DTO เปลี่ยนชื่อ field
3. web: ลบบล็อก hash + `shortFingerprint` + `.doc-gate-hash*` ใน legal.css, ข้อ 3 หัวข้อ "การลบข้อมูล"
   พร้อมลิงก์เปิด `/data-deletion` และ checkbox ชื่อ `deletionAcknowledged`
4. อัปเดต spec ทั้งฝั่ง contracts / api / web / e2e harness

Artifacts:

- `packages/contracts/src/legal-acceptance.ts` (+ spec): `deletion` statement, `LEGAL_DATA_DELETION_HREF`,
  `deletionAcknowledged`, `legalAcceptanceStatements(locale)`, statement version `v2`
- `apps/api/.../legal-acceptance.service.ts`: terms row เก็บประโยคข้อกำหนดอย่างเดียว,
  privacy row = `privacy \n deletion`, challenge ผูก `/data-deletion` + ข้อความข้อ 3
- `apps/api/.../auth.controller.ts`: DTO `@Equals(true) deletionAcknowledged`
- `apps/web/.../LegalAcceptancePage.tsx`: ตัดบล็อก SHA-256 ทั้งสองข้อ, ข้อ 3 = "การลบข้อมูล"
  พร้อมลิงก์เปิด `/data-deletion`; `apps/web/src/common/legal/legal.css` ตัด `.doc-gate-hash*`
- `e2e/harness/auth.ts`, `e2e/legal-acceptance.spec.ts` (ลิงก์เอกสารเต็มเป็น 3 รายการ),
  `docs/qa/manual-test-playbook-2026-08.html` step 4

Verification:

- `pnpm --filter @watchdog-bms/contracts test` → 121 pass / 0 fail
- api: `tsx --test legal-acceptance.service.spec.ts auth.controller.spec.ts auth-endpoints.spec.ts auth.guard.spec.ts`
  → 85 pass / 0 fail
- web: `tsx --test legal-acceptance.logic.spec.ts legal-content.spec.ts` → 8 pass / 0 fail
  (legal-content.spec ยืนยันว่า byte/hash ของ artifact v3 ไม่ถูกแตะ)
- `apps/web` `tsc --noEmit` ผ่านสะอาด; `apps/api` `tsc --noEmit` เหลือ error 34 รายการเท่ากับก่อนแก้
  (ของเดิมจาก generated Prisma client ที่ค้าง — expenses/ledger/platform-access ไม่เกี่ยวกับงานนี้)
- ยังไม่ได้รัน `e2e/legal-acceptance.spec.ts` เพราะต้องยกสแตกจริง (API + web + Postgres)

Next:

- รัน e2e legal-acceptance เมื่อยกสแตกได้ แล้วบันทึกผลที่นี่
- ก่อน deploy: แจ้งผู้ใช้ว่าทุกคนจะถูกขอยืนยันใหม่หนึ่งรอบ (statement v2)
