# Agent Memory: ฟอร์มข้อมูลหัวหน้าเซลล์

Status: IMPLEMENTED — scoped profile access added and locally verified; DB/browser integration pending services
Owner: Codex
Scope: ฟอร์มสร้างบัญชีทีมขายของ SYSTEM_ADMIN และหัวหน้าเซลล์; หัวหน้าอ่าน profile เซลล์ในทีม; เซลล์และหัวหน้าอ่าน/แก้ profile ตนเอง; admin อ่าน/แก้ทุก profile
Decisions: ใช้ ThaiAddressFields และ address master เดิมในฟอร์มสร้าง; รวมที่อยู่เป็นข้อความ `SalesAgentProfile.address` ตาม contract เดิม จึงใช้ช่องข้อความที่กรอกค่าเดิมได้ตรง ๆ ในฟอร์มแก้; จำกัดเลขบัตร/ภาษี 13 หลัก; รายชื่อธนาคารไทยหลักจาก [ธนาคารแห่งประเทศไทย](https://www.bot.or.th/th/fi-list.html) พร้อมช่องธนาคารอื่น; temp password แสดงหลังสร้าง; อัตราหัก ณ ที่จ่ายให้ admin แก้เท่านั้น; service จำกัดการอ่านตามทีม/ตัวเองก่อนดึง PII และ audit การอ่าน/แก้โดยไม่ใส่ PII
Open questions: ไม่มี
Artifacts: `docs/specs/mangmee-sales-deals-and-locked-signup-spec-th.md`, `docs/plans/sales-agent-profile-access-2026-09-23.md`, `SalesTeamPage.tsx`, `SalesMyProfilePage.tsx`, `SalesProfileEditor.tsx`, `sales.controller.ts`, `sales-agents.service.ts`, `sales-console.pg.spec.ts`, `e2e/sales-console.spec.ts`
Verification: web sales logic/QA tests 89/89 ผ่าน; web `tsc --noEmit` ผ่าน; API focused DTO/permission/encryption tests 4/4 และ permission registry tests 40/40 ผ่าน; API `typecheck` ผ่านด้วย Node heap 8 GB; API `test:boot` ผ่าน (Nest resolve providers ทั้งหมด); `playwright test e2e/sales-console.spec.ts --list` ผ่าน; `git diff --check` ผ่าน. PG integration suite ยังไม่รันเพราะ `SALES_CONSOLE_TEST_DATABASE_URL` ไม่ได้ตั้งและไม่มี PostgreSQL local; browser test ยังไม่รันเพราะไม่มี web local service และ Docker daemon ไม่ได้เปิด
Next: รัน `sales-console.pg.spec.ts` บน disposable PostgreSQL และ `e2e/sales-console.spec.ts` เมื่อมี local stack ก่อน release
