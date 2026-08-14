# Agent Memory: legal-acceptance หน้ายืนยัน — ตัดค่าตรวจสอบไฟล์ และเปลี่ยนข้อ 3 เป็นการลบข้อมูล

Status: acceptance identity correction implemented + unit/typecheck/deployment-contract verified (2026-08-15) — เป็นการแก้ไขภายใน/UAT เท่านั้น ยังไม่ได้แสดงบน Production หรือเปิดใช้จริง; ยังไม่ได้รัน live e2e (ต้องมี API/web/DB จริง)
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
4. Internal release version กับ display version ยังไม่ตรงกันโดยเจตนาในช่วงเตรียม UAT:
   - ระบบเก็บ `CURRENT_LEGAL_DOCUMENTS.*.version = v3` และ artifact URL `/legal/releases/v3/...`
   - หน้าจอแสดงผู้ใช้เป็น `ฉบับที่ 1 (1.0)`
   - mapping นี้เป็นการแก้ไขภายในที่ยังไม่ได้แสดงบน Production/ยังไม่ได้เปิดใช้จริง จึงห้ามถือว่า
     ค่า `v3` ในหลักฐาน UAT คือ version ที่ผู้ใช้ Production รับทราบแล้ว
   - ก่อนเปิดใช้จริงต้องตัดสินใจและบันทึก mapping ให้ชัดเจน หรือทำให้ version ที่แสดงกับ version ที่เก็บตรงกัน

Consequence เดิม (ยกเลิกโดยคำตัดสินเจ้าของ 2026-08-15):

- ชุดข้อความเปลี่ยน → `legalStatementTemplateFingerprint()` เปลี่ยน → `scopeRef` เปลี่ยน และ
  `LEGAL_ACCEPTANCE_STATEMENT_VERSION` bump `v1` → `v2` → **ผู้ใช้ที่เคยยอมรับแล้วจะถูกถามใหม่ทุกคน**
  (surface = `MATERIAL_UPDATE`) หลักฐานเดิมยังอยู่ครบแบบ append-only — พฤติกรรมนี้เป็น root cause
  ที่ต้องแก้ เพราะ Terms/Privacy artifact hash pair ไม่ได้เปลี่ยน

Decision ใหม่ 2026-08-15:

- re-acceptance ผูกเฉพาะ user + current Terms/Privacy artifact SHA-256 pair
- internal version/URL, display label, statement version/template และ redeploy ไม่ใช่ trigger
- หลักฐาน v3 เดิมที่เป็น coherent pair และ hash ตรง current pair ต้องใช้ต่อได้โดยไม่ update/backfill DB
- display challenge ยังผูกข้อความล่าสุดเพื่อ reject form ที่เปิดค้าง แต่ไม่ invalidate หลักฐานที่บันทึกแล้ว
- ถ้า Data Deletion เปลี่ยนสาระจนต้องรับทราบใหม่ ต้องออก immutable Terms/Privacy release ใหม่ระหว่างที่
  Data Deletion ยังไม่มี frozen artifact ของตัวเอง

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

Verification 2026-08-15 — acceptance identity correction:

- Contracts legal release tests 3/3 ผ่าน
- API legal/auth focused tests 89/89 ผ่าน; ในนี้ LegalAcceptanceService 18/18 ครอบ statement-only deploy,
  internal release-id/URL change, changed artifact hash, legacy idempotency, cross-company/role และหลาย legacy batch
- API `tsc --noEmit` ผ่านสะอาด
- production maintenance pin sync/check และ maintenance release validator ผ่าน
- production image security aggregate ผ่าน รวม workflow/READY/passport/migration/security contracts
- `git diff --check` ผ่าน; ไม่มี migration, backfill, update หรือ delete หลักฐาน acceptance เดิม
- ยังไม่ได้รัน browser e2e บน deployed UAT candidate

Next:

- รัน e2e legal-acceptance เมื่อยกสแตกได้ แล้วบันทึกผลที่นี่
- หลัง deploy candidate: ยืนยันด้วยผู้ใช้ที่มี v3 hash pair เดิมว่า `required=false` และเข้า business route ได้
- ก่อน Production launch: resolve ความไม่ตรงกันระหว่าง internal `v3` กับ display `ฉบับที่ 1 (1.0)` และยืนยัน
  ว่า evidence ที่เกิดใน UAT ไม่ถูกนับเป็น Production/customer acceptance
