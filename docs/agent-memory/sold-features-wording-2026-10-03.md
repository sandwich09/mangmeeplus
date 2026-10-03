# Agent Memory: sold-features-wording-2026-10-03

Status: Implementation complete; final focused tests, locked web/API typechecks and full web suite passed. Uncommitted for controller review and 390 px browser verification.
Owner: Codex implementation lane; controller commits and performs integration/browser checks.
Scope: STARTER features in TIER_FEATURE_PRESETS plus account/login/LINE linking/package invariants; ENTERPRISE PND53 and 50 ทวิ. No unsold module page, API mutation, database, dependency, deployment or package.json change.

Decisions:
- Follow local AGENTS.md and .agents/skills/ponytail/SKILL.md (full). Work only here, no Git writes, network, database, browser or servers.
- Settings accounting/tax wizard, tax codes/accounts and chart-of-accounts cards require ledger/tax permissions stripped when those features are disabled. Existing settings-menu.logic.spec.ts covers this. Do not translate those unsold screens or change visibility.
- Labels name permissions rather than claiming the shop administrator can grant rights: ROLE_GRANTS.ADMIN omits access.role.manage and company.plan.manage. Standard role names come from THAI_SYSTEM_ROLE_NAMES.
- Thai locale wording only; preserve English locale, machine contracts, business document numbers and shop-entered data.
- Upload hints must reuse shared labels; limits and accepted formats stay unchanged.

Open questions:
- No product decision taken. Unexpected behaviour will be listed for the controller rather than changed.

Artifacts:
- Route inventory: expenses list/upload/manual/categories/evidence/signatures/substitute receipts/detail; reimbursements list/new/detail/edit/payout/draft-action; settings employees/roles/permissions/access-overview/branches/profile/substitute-receipt; dashboard/notifications/preferences/rules; billing/renew/invoices; auth/account/LINE; contextual AI suggestions; expense/reimbursement/substitute guides; enterprise tax/pnd53 and settings/tax-signature plus 50 ทวิ on expense payment.
- Discovery scan below includes candidates reviewed before editing, including intentional exclusions. Final wording table and classifications follow after implementation.

## Found list (before changes)

| Where | Old text | Why reviewed |
|---|---|---|
| apps/web/src/features/expenses/ExpenseReviewPage.tsx:1104 | สร้างและผ่านรายการ JV | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/ExpenseReviewPage.tsx:1287 | JV ของเอกสารนี้ถูกกลับรายการแล้ว | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/ExpenseReviewPage.tsx:1289 | เอกสารยืนยันแล้ว รอผู้มีสิทธิ์สร้าง JV | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/ExpensesPages.tsx:527 | แจ้งเจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจให้เปลี่ยนแพ็กเกจ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/expenses/ExpensesPages.tsx:2018 | รหัสภาษีซื้อในประเทศเลือกได้เมื่อเอกสารถูกจัดประเภทเป็นใบกำกับภาษีเท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:191 | AI จะเลือกได้เฉพาะหมวดหมู่ที่เปิดใช้งานเท่านั้น · ระบบไม่อนุญาตให้ AI สร้าง/แก้ไขหมวดหมู่เอง | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:201 | Tax Code เริ่มต้น | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:255 | Tax Code เริ่มต้น | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:260 | ใช้เป็นค่าตั้งต้นของรายการที่ยังไม่ได้เลือก Tax Code เท่านั้น ผู้ตรวจเปลี่ยนได้เสมอ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:373 | รองรับไฟล์ PNG, JPG/JPEG/JPE, HEIC/HEIF และ GIF | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:384 | ไม่สามารถอ่านไฟล์ HEIC/HEIF ได้ กรุณาลองถ่ายใหม่หรือใช้ไฟล์ JPG | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:602 | PNG, JPG/JPEG/JPE, HEIC/HEIF หรือ GIF | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:875 | ตรวจรายการเก่าก่อน Auto-post | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:1025 | ดู JV | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:1080 | ดู JV | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:1115 | รายการหลักฐาน (JSON) — ลิงก์ดาวน์โหลดไฟล์แนบทุกไฟล์ มีวันหมดอายุ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:1116 | ดาวน์โหลดรายการหลักฐาน (JSON) | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:1137 | เฉพาะเอกสารก่อนเปิด Auto-post เมื่อ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:1140 | ไม่ถูก backfill | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/SubstitutePaperSigningPanel.tsx:62 | PDF ไม่เกิน 5 หน้า หรือภาพ PNG/JPEG ขนาดไม่เกิน 10 MB ให้เห็นครบทุกหน้าและอ่านได้ชัดเจน | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/SubstituteReceiptSettingsPage.tsx:111 | เจ้าของกิจการลงนามและอนุมัติด้วยตนเอง (ค่าเริ่มต้น) | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/expenses/SubstituteReceiptSettingsPage.tsx:112 | เหมาะกับกิจการเจ้าของคนเดียว เมื่อ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/expenses/SubstituteReceiptSettingsPage.tsx:134 | ผู้อนุมัติเดิมบางคนไม่มีสิทธิ์หรือไม่ active แล้ว กรุณาเลือกผู้อนุมัติใหม่ก่อนบันทึก | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/SubstituteReceiptSettingsPage.tsx:196 | การตั้งค่านี้เป็น control ภายในบริษัท ไม่ทำให้เอกสารกลายเป็นใบกำกับภาษี และไม่สร้างสิทธิ์ภาษีซื้อโดยอัตโนมัติ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/SubstituteReceiptWizardPage.tsx:2894 | เอกสารยกเลิกแล้ว ดูข้อมูลและประวัติได้เท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/expenses/SubstituteSignerPositionField.tsx:9 | เจ้าของกิจการ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/expenses/SubstituteSignerPositionField.tsx:9 | ผู้จัดการ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/expenses/expenses.api.ts:75 | ยังไม่พบ API endpoint นี้ หรือ backend ยังไม่ได้รัน | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/expenses.api.ts:318 | ไม่สามารถโหลดไฟล์เพื่อดูตัวอย่างได้ (HTTP | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/expenses.api.ts:702 | ใช้ PDF, PNG หรือ JPEG ขนาดไม่เกิน 10 MB | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/expenses.model.ts:966 | รหัสภาษี O0 ต้องระบุบริบทอัตราศูนย์และผ่านการตรวจสอบก่อนลงบัญชี | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/expenses.model.ts:983 | เป็นหลักฐานการจ่ายเงินเท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/expenses/expenses.model.ts:984 | เป็นภาพคำสั่งซื้อจากมาร์เก็ตเพลสเท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/expenses/expenses.model.ts:1236 | รูปภาพ JPEG | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/expenses.model.ts:1237 | รูปภาพ JPEG | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/expenses.model.ts:1238 | รูปภาพ PNG | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/expenses.model.ts:1239 | เอกสาร SVG | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/expenses/expenses.model.ts:1246 | ยกเลิก version นี้แล้ว | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/reimbursements/ReimbursementCreatePage.tsx:359 | เฉพาะผู้เบิกที่มีสิทธิ์แก้ไขร่างเท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/ReimbursementCreatePage.tsx:514 | รองรับ PDF, JPG/JPEG, PNG, HEIC/HEIF และ GIF ระบบจะแปลงรูปให้อัตโนมัติก่อนแนบ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/reimbursements/ReimbursementDetailSections.tsx:173 | ทุกคนที่เปิดใบนี้เห็นเหตุผลนี้ อย่าพิมพ์เลขบัญชี | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/ReimbursementDetailSections.tsx:310 | ช่องนี้สำหรับใบเบิกที่มีลายเซ็นเท่านั้น ไม่ใช่ที่แนบสลิปโอนเงิน สลิปโอนเงินแนบที่ขั้นจ่ายเงินคืน ตอนกดบันทึกจ่าย | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/ReimbursementDetailSections.tsx:444 | · PDF, JPG/JPEG, PNG, HEIC/HEIF หรือ GIF ขนาดไม่เกิน 10 MB | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/reimbursements/ReimbursementDetailSections.tsx:752 | PDF, JPG/JPEG, PNG, HEIC/HEIF หรือ GIF | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/reimbursements/ReimbursementDetailSections.tsx:938 | แนบใบเบิกที่เซ็นแล้ว (PDF/JPG/PNG) | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/reimbursements/ReimbursementDraftActionPage.tsx:132 | ระบบจะบันทึกเป็นร่างเท่านั้น ไม่ส่งอนุมัติ ไม่อนุมัติ และไม่จ่ายเงิน | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/ReimbursementPayout.tsx:230 | บันทึกบัญชีรับเงินคืนแล้ว ระบบแจ้งเจ้าของบัญชีให้ตรวจ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/ReimbursementPayout.tsx:269 | หลังบันทึก คุณจะเห็นเฉพาะ 4 ตัวท้าย และเจ้าของบัญชีจะได้รับแจ้งเตือนให้ตรวจ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/ReimbursementPayout.tsx:299 | บัญชีนี้ตั้งหรือแก้ได้โดยเจ้าของบัญชี | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/ReimbursementPayoutCorrection.tsx:118 | ผู้เบิกและทุกคนที่เปิดใบนี้เห็นหมายเหตุนี้ อย่าพิมพ์เลขบัญชี | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/ReimbursementsPages.tsx:1050 | เลือกได้หลายบทบาท ทุกคนในบทบาทที่เลือกอนุมัติได้ ระบบใช้ผลจากคนแรกที่อนุมัติหรือปฏิเสธ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/ReimbursementsPages.tsx:1060 | ยังไม่มีบทบาทที่พร้อมอนุมัติ กรุณาให้ผู้ดูแลเพิ่มสิทธิ์และพนักงานในหน้าบทบาทและสิทธิ์ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/ReimbursementsPages.tsx:1068 | ถ้ายังไม่มีคนในบทบาทที่เลือก เจ้าของกิจการเป็นผู้อนุมัติ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/reimbursement-payout.logic.ts:60 | อย่าพิมพ์เลขบัญชีในช่องเหตุผล เพราะเหตุผลนี้แสดงในประวัติการจ่ายให้ทุกคนที่เปิดใบเบิกเห็น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/reimbursements.logic.ts:62 | ยื่นแบบหรือปิดแล้ว ระบบจึงยกเลิกรายการค่าใช้จ่ายของใบนี้ไม่ได้ ต้องให้ผู้ดูแลบัญชีปรับปรุงรายการแทน | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/reimbursements.logic.ts:63 | รายการบัญชีของค่าใช้จ่ายในใบนี้ยังลงบัญชีไม่เรียบร้อย ต้องให้ผู้ดูแลบัญชีตรวจการลงบัญชีก่อน | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/reimbursements.logic.ts:64 | รายการค่าใช้จ่ายของใบนี้อยู่ในสถานะที่ระบบยกเลิกให้ไม่ได้ กรุณาติดต่อผู้ดูแลระบบ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/reimbursements.logic.ts:171 | ยังไม่มีผู้อนุมัติใบเบิกนี้ ขอให้เจ้าของกิจการเลือกผู้อนุมัติใน | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/reimbursements.logic.ts:235 | ต้องจ่ายเต็มจำนวนคงค้างเท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/reimbursements.logic.ts:1267 | ขอให้เจ้าของกิจการเปิดใน | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/reimbursements.logic.ts:1305 | ใบนี้ไม่ได้ระบุสาขา ระบบจึงยังบันทึกจ่ายไม่ได้ กรุณาติดต่อผู้ดูแลระบบ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/reimbursements.logic.ts:1307 | ยังไม่มีผู้ที่บันทึกจ่ายใบของสาขานี้ได้ ขอให้เจ้าของกิจการบันทึกจ่ายหรือเพิ่มสิทธิ์ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/reimbursements.logic.ts:1309 | ถ้าต้องการจ่ายเอง ขอให้เจ้าของกิจการเพิ่มสิทธิ์บันทึกจ่ายให้บทบาทของคุณ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/reimbursements.logic.ts:1475 | (ถ้าไม่มี เจ้าของกิจการ) | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/reimbursements.model.ts:309 | ยังไม่มีผู้อนุมัติที่รับผิดชอบใบเบิกนี้ กรุณาให้ผู้ดูแลตรวจบทบาท สิทธิ์ และสาขา แล้วส่งใหม่ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/reimbursements.model.ts:312 | พบนโยบายบริษัทซ้ำ ระบบยังไม่บันทึก กรุณาติดต่อผู้ดูแลระบบ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/reimbursements.model.ts:313 | ข้อมูลนโยบายของใบเบิกนี้ไม่สมบูรณ์ ระบบจึงหยุดรายการไว้เพื่อความปลอดภัย กรุณาติดต่อผู้ดูแลระบบ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/reimbursements.model.ts:326 | ต้องจ่ายเต็มจำนวนคงค้างเท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/reimbursements/reimbursements.model.ts:337 | ไฟล์ลายเซ็นต้องเป็น PNG/JPEG ขนาดไม่เกิน 2 MB | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/reimbursements/reimbursements.model.ts:341 | ไฟล์ลายเซ็นต้องมีขนาดไม่เกิน 2 MB | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/reimbursements/reimbursements.model.ts:345 | ใบเบิกที่เซ็นแล้วต้องเป็นไฟล์ PDF/JPG/PNG | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/employee-access/AddEmployeePrototypePage.tsx:132 | L | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/employee-access/AddEmployeePrototypePage.tsx:651 | เช่น เจ้าหน้าที่บุคคล พนักงานขาย หรือหัวหน้าคลัง | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/employee-access/AddEmployeePrototypePage.tsx:663 | บทบาทของตัวเองต้องให้ผู้ดูแลคนอื่นเปลี่ยนให้ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/employee-access/AddEmployeePrototypePage.tsx:663 | บทบาทระดับนี้ต้องให้เจ้าของหรือผู้ดูแลสิทธิ์เป็นผู้เปลี่ยน | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/employee-access/AddEmployeePrototypePage.tsx:792 | หากเป็นคนเดียวกัน (เช่น เจ้าของอีกบริษัท) กด “ยืนยันเพิ่มเข้าบริษัท” เพื่อเพิ่มเข้าบริษัทนี้โดยใช้บัญชีเดิม — พนักงานจะเข้าระบบด้วยรหัสผ่านเดิม ไม่มีการตั้งรหัสใหม่ · | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/employee-access/EmployeeAccessPages.tsx:367 | ใช้วันเดือนปีเกิดรูปแบบ DDMMYYYY — ไม่ต้องเปลี่ยนรหัสผ่านตอนเข้าสู่ระบบครั้งแรก | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/employee-access/EmployeeAccessPages.tsx:370 | QR เชื่อม LINE ของพนักงานคนนี้ (ใช้ได้ครั้งเดียว ผูกกับผู้ใช้นี้เท่านั้น) — หากหมดอายุ สร้างใหม่ได้จากปุ่ม “สร้าง QR เชื่อม LINE” | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/employee-access/EmployeeAccessPages.tsx:476 | Username | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/employee-access/EmployeeAccessPages.tsx:575 | เลือกสาขาหลักสำหรับขอบเขตแบบสาขาหลักเท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/employee-access/EmployeeAccessPages.tsx:635 | เฉพาะสาขาหลักเท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/employee-access/EmployeeAccessPages.tsx:791 | ตั้งชื่อได้ตามบริษัท เช่น CEO, CTO หรือ CFO แล้วเลือกว่างานอะไรที่คนชื่อนี้ทำได้ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/employee-access/EmployeeAccessPages.tsx:1044 | พนักงานทุกคนเข้าใช้ระบบ ดูหน้าหลัก และรับการแจ้งเตือนได้อยู่แล้ว | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/employee-access/EmployeeAccessPages.tsx:1188 | พื้นฐานเท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/employee-access/EmployeeAccessPages.tsx:1204 | สิทธิ์พื้นฐานเท่านั้น (เข้าสู่ระบบ, แดชบอร์ด, แจ้งเตือน) | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/employee-access/IndividualPermissionsPrototypePage.tsx:652 | บทบาทของตัวเองต้องให้ผู้ดูแลคนอื่นเปลี่ยนให้ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/employee-access/IndividualPermissionsPrototypePage.tsx:716 | — พนักงานทุกคนที่ใช้บทบาทนี้ได้สิทธิ์ชุดเดียวกัน | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/employee-access/IndividualPermissionsPrototypePage.tsx:959 | — แสดงครั้งเดียวเท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/employee-access/discount-policy.model.ts:28 | เท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/branch-settings/BranchSettingsPage.tsx:170 | รหัสสาขา (A-Z, 0-9) | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/branch-settings/BranchSettingsPage.tsx:171 | เช่น BKK01 | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/company-profile/CompanyProfilePage.tsx:47 | ติดต่อทีมงานได้ที่ โทร 098-256-5628 หรืออีเมล contact@mangmeeplus.com นะคะ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/company-profile/CompanyProfilePage.tsx:374 | บัญชีของคุณดูข้อมูลนี้ได้อย่างเดียว ถ้าต้องการแก้ไข ให้เจ้าของร้านเป็นคนแก้นะคะ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/company-profile/CompanyProfilePage.tsx:375 | บัญชีของคุณเห็นข้อมูลนี้ได้บางส่วน ถ้าต้องการดูหรือแก้ไขทั้งหมด ให้เจ้าของร้านเป็นคนทำนะคะ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/company-profile/CompanyProfilePage.tsx:398 | ค้นหาชื่อธุรกิจหรือรหัส TSIC | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/company-profile/CompanyProfilePage.tsx:409 | รหัสธุรกิจ DBD (TSIC) | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/company-profile/CompanyProfilePage.tsx:461 | บัญชีของคุณดูได้อย่างเดียว ให้เจ้าของร้านหรือผู้ทำบัญชีเป็นคนตอบนะคะ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/company-profile/CompanyProfilePage.tsx:567 | ใช้คู่กับรหัสผ่านตอนเข้าจากคอมพิวเตอร์ ตัวอักษร a-z ตัวเลข จุด ขีด อย่างน้อย 4 ตัว | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/company-profile/company-profile.logic.ts:378 | เลือกประเภทธุรกิจจากรายการ DBD หรือเลือกอื่น ๆ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/company-profile/company-profile.logic.ts:432 | ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 จุด ขีด และขีดล่าง ยาว 4 ถึง 64 ตัว (ภาษาไทยใช้ไม่ได้ค่ะ) | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/dashboard-notifications/NotificationPages.tsx:344 | หน้าเว็บบันทึกทุกการแจ้งเตือนเสมอ ส่วน LINE จะส่งตามการตั้งค่าและช่วงเวลางดแจ้งเตือน | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/dashboard-notifications/dashboard-notifications.api.ts:50 | ยังไม่พบ API endpoint นี้ หรือ backend ยังไม่ได้รัน | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/web-core-workspace/WorkspaceLayout.tsx:312 | ฟีเจอร์ที่คุณมีสิทธิ์อาจถูกปิดใช้งานอยู่ กรุณาติดต่อผู้ดูแลบริษัทเพื่อเปิดฟีเจอร์หรือปรับสิทธิ์ให้ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/web-core-workspace/settings-menu.logic.ts:31 | เชื่อมต่อ LINE OA | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/web-core-workspace/settings-menu.logic.ts:32 | เชื่อม LINE OA ของบริษัทให้ข้อความลูกค้าเข้าสู่ CRM Inbox โดยอัตโนมัติ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/web-core-workspace/settings-menu.logic.ts:39 | สินค้าและบริการสำหรับ CRM | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/web-core-workspace/settings-menu.logic.ts:59 | ทำตามลำดับตั้งแต่ผังบัญชี ชุดรหัสภาษี (Tax Profile) การผูกบัญชีและรายงาน จนพร้อมเปิดใช้งาน | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/web-core-workspace/settings-menu.logic.ts:75 | Tax Code และ Tax Profile | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/web-core-workspace/settings-menu.logic.ts:76 | จัดการ SAP-compatible Tax Code ตาม profile บริบท อัตรา และช่วงวันที่มีผล | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/web-core-workspace/settings-menu.logic.ts:85 | ผูก Tax Code กับผังบัญชี บทบาทบัญชี และช่องรายงาน ภ.พ.30/ภ.พ.36 | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/web-core-workspace/settings-menu.logic.ts:93 | ผังบัญชี Master Data | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/web-core-workspace/settings-menu.logic.ts:94 | ตรวจผังบัญชี ที่มาของ Template ความพร้อม และผลกระทบก่อนเพิ่มหรือแทนที่บัญชี | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/web-core-workspace/components/PlannedModulePage.tsx:22 | ยังไม่มี workflow ที่เปิดใช้งานจริง | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/AccountEmailOtpPanel.tsx:11 | ยืนยันรหัส OTP | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/AccountEmailOtpPanel.tsx:133 | ยืนยันตัวตนผ่าน LINE ทำในเบราว์เซอร์ของ LINE ไม่ได้ กรุณาเปิดหน้านี้ใน Safari หรือ Chrome ก่อน | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/AccountEmailOtpPanel.tsx:133 | เปิดหน้านี้ใน Safari/Chrome | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/AccountEmailOtpPanel.tsx:140 | ใช้เข้าสู่ระบบด้วยรหัส OTP และรับแจ้งเตือนบัญชี · ถ้ายืนยันแล้ว การซื้อครั้งแรกจะใช้อีเมลนี้รับเอกสาร · เปลี่ยนอีเมลรับเอกสารได้ที่หน้าแพ็กเกจ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/AccountEmailOtpPanel.tsx:180 | ยืนยันตัวตนเพื่อส่งรหัส OTP 6 หลักไปที่ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/AccountEmailOtpPanel.tsx:195 | เมื่อเปิดใช้งาน ระบบจะส่งรหัสยืนยันแบบใช้ครั้งเดียว (OTP) 6 หลักไปที่อีเมลของคุณทุกครั้งที่เข้าสู่ระบบ ใช้รหัสนี้แทนรหัสผ่าน | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/EmailAccessPage.tsx:73 | เข้าสู่ระบบด้วยรหัส OTP | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/EmailAccessPage.tsx:74 | กรอกอีเมลเพื่อรับรหัสยืนยันแบบใช้ครั้งเดียว (OTP) 6 หลัก แล้วนำรหัสมากรอกในขั้นตอนถัดไป | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/EmailAccessPage.tsx:78 | ส่งรหัส OTP ไปที่อีเมล | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/EmailAccessPage.tsx:98 | ยืนยันอีเมลสำเร็จแล้ว แต่บัญชีนี้ใช้ OTP เข้าไม่ได้ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/ForgotPasswordPage.tsx:66 | ลิงก์ใช้ได้ 30 นาที ตรวจโฟลเดอร์สแปมด้วย หากยังไม่ได้รับ รอ 1 นาทีแล้วขอใหม่ หรือติดต่อผู้ดูแลบริษัท | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/auth/LegalAcceptancePage.tsx:52 | ก่อนเริ่มใช้งาน MangmeePlus | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/LegalAcceptancePage.tsx:61 | การรับทราบนี้ไม่ใช่การให้ความยินยอม ไม่เป็นการสละสิทธิของคุณตาม PDPA และไม่ทำให้ MangmeePlus ใช้ข้อมูลนอกเหนือจากฐานกฎหมายและวัตถุประสงค์ที่แจ้งไว้ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/LegalAcceptancePage.tsx:234 | MangmeePlus | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/LegalAcceptancePage.tsx:236 | Secure business workspace | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/LegalAcceptancePage.tsx:241 | Legal acceptance | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/LineQrApprovePage.tsx:33 | L | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/LineQrApprovePage.tsx:128 | มีการขอเข้าสู่ระบบ MangmeePlus จากเบราว์เซอร์บนคอมพิวเตอร์ ถ้าไม่ใช่คุณ อย่ากดยืนยัน | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/LoginPage.tsx:30 | เชื่อมบัญชี LINE ไม่สำเร็จ (บัญชี LINE นี้อาจถูกเชื่อมกับผู้ใช้อื่นอยู่แล้ว) กรุณาลองใหม่อีกครั้งหรือติดต่อผู้ดูแลระบบ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/auth/LoginPage.tsx:33 | บัญชี LINE นี้เชื่อมกับผู้ใช้อื่นในระบบอยู่แล้ว จึงเชื่อมกับบัญชีนี้ไม่ได้ กรุณาติดต่อผู้ดูแลระบบ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/auth/LoginPage.tsx:94 | LIVE | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/LoginPage.tsx:470 | L | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/LoginPage.tsx:611 | contact@mangmeeplus.com | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/LoginPage.tsx:649 | เข้าสู่ระบบด้วยรหัส OTP | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/LoginPage.tsx:662 | ยังไม่เปิดให้เข้าสู่ระบบด้วย LINE ในขณะนี้ ใช้รหัสผ่านหรือเข้าสู่ระบบด้วยรหัส OTP ทางอีเมลได้ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/LoginPage.tsx:691 | Dev sign-in (local seed OWNER) | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/LoginPage.tsx:725 | L | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/VerifyEmailPage.tsx:17 | ยืนยันอีเมลด้วยรหัส OTP | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/VerifyEmailPage.tsx:20 | เข้าสู่ระบบเพื่อขอรหัส OTP | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/auth/auth.logic.ts:128 | บริษัทอาจถูกปิดใช้งาน หรือสิทธิ์ของคุณถูกยกเลิก กรุณาติดต่อผู้ดูแลบริษัท หากต้องการเปลี่ยนบัญชีให้ออกจากระบบแล้วเข้าสู่ระบบใหม่ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/auth/auth.logic.ts:135 | หากลิงก์นี้มาจากอีกบัญชีหนึ่ง ให้ออกจากระบบแล้วเข้าสู่ระบบใหม่ด้วยบัญชีนั้น หรือติดต่อผู้ดูแลบริษัท | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/billing/BillingAdjustmentsPage.tsx:23 | ข้อมูลรายการนี้ยังยืนยันกับ Stripe ไม่ได้ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingAdjustmentsPage.tsx:23 | ระบบยังเปิดเอกสารไม่ได้ เพราะข้อมูลการชำระเงินของรายการนี้ไม่ตรงหรือไม่ครบสำหรับตรวจสอบกับ Stripe | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingAdjustmentsPage.tsx:24 | Stripe ยังไม่มีเอกสารหรือหลักฐานที่ครบสำหรับรายการนี้ ลองตรวจข้อมูลอีกครั้งภายหลัง | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingAdjustmentsPage.tsx:25 | ยังเชื่อมต่อเอกสารจาก Stripe ไม่ได้ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingAdjustmentsPage.tsx:26 | อ่านข้อมูลจาก Stripe ไม่สำเร็จ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingAdjustmentsPage.tsx:28 | Stripe ดำเนินการคืนเงินสำเร็จ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingAdjustmentsPage.tsx:101 | เปิดเอกสารจาก Stripe ของรายการชำระเงินนี้ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingAdjustmentsPage.tsx:102 | กำลังตรวจข้อมูลกับ Stripe… | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingAdjustmentsPage.tsx:105 | ดูสถานะการเชื่อมต่อ Stripe | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingAdjustmentsPage.tsx:109 | เอกสารจาก Stripe | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingAdjustmentsPage.tsx:122 | ดูผลคืนเงินจาก Stripe และเอกสารปรับยอด ธนาคารอาจใช้เวลาบันทึกเงินคืน ส่วนแพ็กเกจลูกค้าต้องตรวจแยก | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingAdjustmentsPage.tsx:126 | ตรวจคำแนะนำจาก Stripe และผลคำขอคืนเงินเดิมก่อนดำเนินการต่อ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingAdjustmentsPage.tsx:126 | ตรวจอีเมลคำแนะนำจาก Stripe หรือติดต่อทีมงาน | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingAdjustmentsPage.tsx:127 | ตรวจผลคืนเงินของรายการเดิมใน Stripe ก่อนสร้างคำขอเพิ่ม | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingAdjustmentsPage.tsx:155 | บริษัทนี้ยังไม่มีบัญชีลูกค้าใน Stripe จึงยังไม่มีผู้รับเอกสารให้เปลี่ยน | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingAdjustmentsPage.tsx:162 | เปิดเอกสารจาก Stripe ของรายการชำระเงินนี้ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingCapacityPicker.tsx:62 | รวมเจ้าของ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/billing/BillingCapacityPicker.tsx:87 | ต้องคงสำนักงานใหญ่และเจ้าของ เลือกไม่เกินจำนวนที่แพ็กเกจรองรับ และกำหนดสาขาที่มีสิทธิ์ให้ผู้ใช้ทุกคน | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/billing/BillingCollectionPanel.tsx:123 | สิทธิ์พิเศษที่ผู้ดูแลกำหนดให้เฉพาะร้านนี้ยังคงอยู่ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/billing/BillingCollectionPanel.tsx:126 | ผู้ดูแลกำลังดำเนินการแถมวัน ไม่เพิ่มโควตาหรือเรียกเก็บเงินจากรายการนี้ ตรวจสถานะล่าสุดเพื่อดูวันที่ยืนยันแล้ว | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/billing/BillingPage.tsx:447 | พรีวิวขั้นตอน (local) | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingPage.tsx:482 | ถูกพักใช้งานโดยผู้ดูแล | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/billing/BillingPage.tsx:485 | กำลังรอผลการชำระเงินจาก Stripe | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingPage.tsx:507 | ผู้ดูแลให้สิทธิ์ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/billing/BillingPage.tsx:524 | ร้านนี้ถูกพักใช้งานโดยผู้ดูแล กรุณาติดต่อทีมงาน ข้อมูลยังอยู่ครบ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/billing/BillingPage.tsx:536 | กำลังตรวจผลรายการเดิมกับ Stripe กรุณารอสักครู่แล้วกดอัปเดตข้อมูล | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingPage.tsx:547 | ยุติหน้าชำระเงินรายการนี้ใช่ไหม? ระบบจะตรวจผลกับ Stripe ก่อนให้เริ่มรายการใหม่ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingPage.tsx:571 | บิล PromptPay รอบปัจจุบัน | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingPage.tsx:577 | เปลี่ยนบัตรสำหรับการต่ออายุผ่าน Stripe | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingPage.tsx:625 | หากร้านมีค่าเครดิตพิเศษที่ผู้ดูแลตั้งไว้ จะคงค่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/billing/BillingPage.tsx:652 | แพ็กเกจปัจจุบันเป็นแบบจ่ายครั้งเดียว ระหว่างที่ยังไม่หมดอายุ ซื้อแพ็กเกจอื่นได้ด้วยบัตรจ่ายครั้งเดียวหรือ PromptPay จ่ายครั้งเดียว หากต้องการต่ออายุอัตโนมัติให้เริ่มหลังแพ็กเกจนี้หมดอายุ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingPage.tsx:711 | ผู้ใช้ รวมเจ้าของ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/billing/BillingPage.tsx:747 | ส่วนลดใช้กับบิลแรกเท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/billing/BillingPage.tsx:747 | ส่วนลดใช้กับการจ่ายครั้งนี้เท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/billing/BillingPage.tsx:772 | เริ่มแพ็กเกจใหม่เมื่อชำระสำเร็จ แพ็กเกจเดิมที่ผู้ดูแลให้ไว้ถึง | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/billing/BillingPage.tsx:786 | สิทธิ์พิเศษที่ผู้ดูแลกำหนดให้เฉพาะร้านนี้ยังคงอยู่ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/billing/BillingPage.tsx:807 | กำลังตรวจกับ Stripe ว่าหน้าชำระเงินถูกสร้างหรือไม่ กรุณารอสักครู่แล้วกดอัปเดตข้อมูล ยังไม่ต้องเริ่มรายการใหม่ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingPage.tsx:809 | ยืนยันและไปชำระที่ Stripe | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingPage.tsx:818 | ยอดคืนเงินที่ Stripe บันทึก | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingPreviewPage.tsx:48 | พรีวิวทุกขั้นตอน · เฉพาะ local | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingPreviewPage.tsx:60 | ระบบจริงจะเปิด Stripe หน้านี้ใช้เลือกผลลัพธ์เพื่อดูหน้าถัดไป ไม่ใช่หน้าตาของ Stripe และไม่ต้องกรอกข้อมูลบัตร | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingPreviewPage.tsx:72 | ระบบจริงจะเปิดหน้าจัดการบัตรของ Stripe พรีวิวนี้ไม่รับข้อมูลบัตรและไม่เปลี่ยนวิธีชำระเงิน | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingPreviewPage.tsx:72 | ระบบจริงเปิดเอกสารของรายการจาก Stripe ข้อมูลด้านล่างใช้ดูทางเข้าและทางกลับเท่านั้น ไม่ใช่เอกสารทางบัญชี | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingPreviewPage.tsx:73 | PREVIEW-0001 | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/BillingPreviewPage.tsx:73 | preview@example.com | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/billing-display.ts:16 | · ผู้ดูแลเพิ่มให้ เหลือ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/billing/billing-display.ts:56 | PromptPay QR · จ่ายครั้งเดียว | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/billing-display.ts:56 | PromptPay QR · สแกนบิลทุกงวด | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/billing-display.ts:60 | ยืนยันโดยผู้ดูแลระบบคนเดียว | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/billing/billing-error-text.ts:16 | ระบบกำลังตรวจรายการชำระเงินเดิมกับ Stripe กรุณารอสักครู่แล้วกดลองใหม่ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/billing/billing-error-text.ts:33 | บัญชีนี้ยังไม่มีสิทธิ์จัดการแพ็กเกจของร้านนี้ ให้เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจดำเนินการ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/billing/billing-event-discount.ts:47 | ใช้ได้เมื่อจ่ายครั้งเดียวด้วยบัตรหรือ PromptPay | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/plan-term/CompanyTermExpiredPage.tsx:63 | ยังตรวจสอบสถานะไม่ได้ กรุณาลองใหม่หรือติดต่อผู้ดูแล | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/plan-term/plan-term.logic.ts:62 | ร้านนี้ยังไม่มีแพ็กเกจ ให้เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจเลือกแพ็กเกจเพื่อเริ่มใช้งาน | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/plan-term/plan-term.logic.ts:68 | แพ็กเกจของร้านหมดอายุแล้ว ให้เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจเลือกแพ็กเกจเพื่อใช้งานต่อ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/ai-suggestions/AiSuggestionsPages.tsx:219 | รหัสลูกค้า (customerId) | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/ai-suggestions/ai-suggestions.logic.ts:66 | ส่งต่อให้เจ้าของตรวจสอบ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/components/app-shell/AppSidebar.tsx:505 | การรับข้อความ LINE ต้องตรวจการเชื่อมต่อ กรุณาติดต่อผู้ดูแลเพื่อออก QR ใหม่ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/i18n/workspace-dictionary.ts:52 | รายงาน CRM | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/i18n/workspace-dictionary.ts:80 | เชื่อมต่อ LINE OA | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/i18n/workspace-dictionary.ts:91 | ติดต่อผู้ดูแลระบบ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/i18n/workspace-dictionary.ts:116 | จัดการ recovery email และ session ที่ผูกกับบัญชีของคุณ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/i18n/workspace-dictionary.ts:118 | อุปกรณ์นี้จะยังใช้งานต่อได้ แต่อุปกรณ์หรือ browser อื่นที่ยัง login อยู่จะถูกบังคับออกจากระบบในการเรียก API ครั้งถัดไป | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/i18n/workspace-dictionary.ts:121 | ระบบจะ revoke session ที่ยัง active ทั้งหมดของบัญชีนี้ ยกเว้น session ปัจจุบัน | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/i18n/workspace-dictionary.ts:122 | ออกจากระบบอุปกรณ์อื่นสำเร็จ {count} session | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/i18n/workspace-dictionary.ts:326 | ติดต่อเจ้าของร้าน | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/i18n/workspace-dictionary.ts:329 | ไม่สามารถเปิด Mangmee Plus ได้ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/i18n/workspace-dictionary.ts:336 | รหัสผ่านชั่วคราวหมดอายุ กรุณาติดต่อผู้ดูแลเพื่อออกรหัสใหม่ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/i18n/workspace-dictionary.ts:337 | บริษัทถูกปิดใช้งานหรือสิทธิ์ของคุณถูกยกเลิก กรุณาติดต่อผู้ดูแลระบบ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/i18n/workspace-dictionary.ts:353 | รหัสเดิมยังใช้ได้ จนกว่าจะใช้รหัสชั่วคราว หากไม่ได้รับข้อความหรือยังไม่ได้ผูก LINE ให้ติดต่อผู้ดูแลบริษัทหรือทีมช่วยเหลือมั่งมี | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/i18n/workspace-dictionary.ts:702 | ผู้ดูแลปิด OCR ของบริษัทนี้ไว้ — เอกสารถูกเก็บแล้ว คุณยังเปิดและกรอกข้อมูลเองได้ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/i18n/workspace-dictionary.ts:703 | ใช้ OCR ครบจำนวนของเดือนนี้แล้ว — เอกสารถูกเก็บแล้ว กรุณากรอกข้อมูลเองหรือติดต่อผู้ดูแล | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/i18n/workspace-dictionary.ts:705 | ตรวจสอบสิทธิ์ OCR ไม่สำเร็จชั่วคราว — เอกสารถูกเก็บแล้ว กรุณาลองใหม่ภายหลังหรือกรอกข้อมูลเอง | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/i18n/workspace-dictionary.ts:708 | เครดิต AI ของเดือนนี้หมดแล้ว จึงยังไม่ได้อ่านด้วย AI — เอกสารถูกเก็บแล้ว กรุณากรอกข้อมูลเอง หรือติดต่อผู้ดูแลเพื่อปรับแพ็กเกจ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/i18n/workspace-dictionary.ts:709 | เครดิตสำหรับการอ่านเอกสารของเดือนนี้หมดแล้ว จึงยังไม่ได้อ่านด้วย AI — เอกสารถูกเก็บแล้ว กรุณากรอกข้อมูลเอง หรือติดต่อผู้ดูแลเพื่อปรับแพ็กเกจ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/i18n/workspace-dictionary.ts:710 | เครดิต AI ที่เหลือไม่พอเริ่มอ่านเอกสารนี้ จึงยังไม่ได้อ่านด้วย AI — เอกสารถูกเก็บแล้ว กรุณากรอกข้อมูลเอง หรือติดต่อผู้ดูแลเพื่อปรับแพ็กเกจ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/i18n/workspace-dictionary.ts:717 | รองรับเฉพาะไฟล์ JPG/JPEG, PNG, HEIC/HEIF หรือ PDF | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/i18n/workspace-dictionary.ts:718 | แปลงไฟล์ HEIC ไม่สำเร็จ ไฟล์อาจเสียหาย — กรุณาส่งรูปเป็น JPG หรือ PNG | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/i18n/workspace-dictionary.ts:775 | รองรับ JPG/JPEG PNG HEIC (รูปจากไอโฟน) หรือ PDF · รูปใหญ่จะถูกย่ออัตโนมัติ · หรือส่งจาก LINE ได้เลย | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/i18n/workspace-dictionary.ts:836 | ประทับลายเซ็นแล้ว (บันทึกผู้ทำรายการ/เวลาไว้ใน audit) | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/i18n/workspace-dictionary.ts:916 | ใบนี้ยื่นภาษีซื้อตาม “ประเภทภาษีของรายการ” ถ้าใช้ภาษีซื้อไม่ได้ ให้เปลี่ยนแต่ละรายการเป็นแบบ “ภาษีซื้อขอคืนไม่ได้” แล้วบันทึก ถ้าไม่มีให้เลือก ให้ผู้ดูแลเพิ่มที่หน้าตั้งค่าภาษี | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/i18n/workspace-dictionary.ts:921 | ให้เจ้าของร้านตั้งค่าที่หน้า ข้อมูลร้าน | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/i18n/workspace-dictionary.ts:1051 | ประเภท VAT นี้ต้องใช้อัตรา 0% เท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/i18n/workspace-dictionary.ts:1069 | รหัสที่ใช้แยกประเภทภาษีซื้อในรายงานภาษี เลือกได้เมื่อเอกสารเป็นใบกำกับภาษีเท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/i18n/workspace-dictionary.ts:1180 | เลขรายจ่าย (EXP) | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/i18n/workspace-dictionary.ts:1201 | เลือกสาขาของรายการก่อน จึงจะอัปโหลดหรือบันทึกได้ — ตอนนี้เลือก “ทุกสาขา (รวม)” อยู่ ซึ่งใช้ดูรายงานเท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/i18n/workspace-dictionary.ts:1363 | บริษัทยังไม่มีหมวดหมู่ค่าใช้จ่าย จึงยังสร้างรายการจากหน้านี้ไม่ได้ กรุณาเพิ่มหมวดหมู่หรือติดต่อผู้ดูแลก่อน | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/i18n/workspace-dictionary.ts:1388 | เช่น เดินทางไปพบลูกค้าโครงการ A เพื่อเก็บความต้องการ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/i18n/workspace-dictionary.ts:1450 | ใช้ขั้นตอนนี้เมื่อผู้รับเงินออกใบเสร็จให้ไม่ได้เท่านั้น หากใบเสร็จสูญหายควรขอสำเนาหรือใบแทนจากผู้ขายก่อน และใบทดแทนไม่ยกเว้นภาษีหัก ณ ที่จ่าย | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/i18n/workspace-dictionary.ts:1476 | ยังไม่พบสมาชิกที่เลือกเป็นผู้รับรองการจ่ายได้ กรุณาให้ผู้ดูแลเพิ่มสมาชิกที่ใช้งานได้และกำหนดสิทธิ์สาขาก่อน | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/i18n/workspace-dictionary.ts:1526 | ระบบจะฝังไฟล์ PNG โปร่งใสที่ตรวจสอบแล้วลงในเอกสารฉบับนี้ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/i18n/workspace-dictionary.ts:1527 | กรุณาเลือกไฟล์ลายมือชื่อ PNG หรือ JPEG | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/i18n/workspace-dictionary.ts:1605 | ขอสิทธิ์ ดูทะเบียนคู่ค้า จากเจ้าของหรือผู้ดูแลระบบ แล้วเปิดหน้านี้อีกครั้ง ระหว่างนี้ยังพิมพ์ที่อยู่ผู้ขายบนหน้าตรวจรายจ่ายได้ตามปกติ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/i18n/workspace-dictionary.ts:1658 | ดูอย่างเดียว ขอสิทธิ์ จัดการคู่ค้า จากเจ้าของหรือผู้ดูแลระบบจึงจะแก้ไขได้ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:16 | บัญชีผู้ดูแลระบบต้องใช้วิธีเข้าสู่ระบบเดิม | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:36 | บริษัทนี้ยังไม่มีบัญชีลูกค้าใน Stripe จึงยังไม่มีผู้รับเอกสารให้เปลี่ยน | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:42 | กรุณาโหลดหน้านี้ใหม่เพื่อยืนยันอีเมลด้วยรหัส OTP | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:252 | ยอดที่แบ่งได้ยังไม่ตรงกับยอดรวมของเอกสาร กรุณาแจ้งผู้ดูแลระบบพร้อมรหัสอ้างอิง | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:256 | ยอดของรายการที่จะสร้างยังไม่ตรงกับยอดที่ตรวจไว้ กรุณาแจ้งผู้ดูแลระบบพร้อมรหัสอ้างอิง | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:269 | คุณไม่มีสิทธิ์ทำรายการนี้ กรุณาติดต่อผู้ดูแลสิทธิ์ของบริษัท | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:275 | ยังเปิดระบบไม่ได้จนกว่า production release จะผ่านการตรวจสอบครบถ้วน | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:320 | ต้องเปิดระบบบัญชีแยกประเภทและ Auto-post ค่าใช้จ่ายก่อน | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:324 | ผังบัญชีเริ่มต้นยังไม่มีบัญชีที่หมวดค่าใช้จ่ายมาตรฐานต้องใช้ ระบบจึงยังไม่ได้สร้างหมวดค่าใช้จ่าย กรุณาติดต่อผู้ดูแลระบบ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:344 | การตั้งค่า OCR ถูกแก้ไขโดยผู้ดูแลคนอื่น ระบบยังไม่ได้บันทึก กรุณาโหลดค่าล่าสุดแล้วตรวจสอบอีกครั้ง | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:358 | ไม่พบ Template ผังบัญชีที่เลือก กรุณารีเฟรชแล้วลองใหม่ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:359 | Template ผังบัญชีไม่ผ่านการตรวจสอบ ระบบยังไม่เปลี่ยนข้อมูล | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:360 | Template ผังบัญชีมีเวอร์ชันใหม่ กรุณา Preview ผลกระทบอีกครั้ง | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:361 | ผังบัญชีหรือข้อมูลอ้างอิงเปลี่ยนหลัง Preview กรุณาตรวจผลกระทบอีกครั้ง | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:378 | Tax Code ที่หัวเอกสารไม่ตรงกับรายการภาษี กรุณาตรวจ Tax Code ก่อนบันทึก | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:393 | รายการภาษีเปลี่ยนไประหว่างยืนยัน กรุณาตรวจ Tax Code แล้วลองอีกครั้ง | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:407 | เลขรายจ่ายไม่ตรงกับทะเบียน กรุณาติดต่อผู้ดูแลเพื่อตรวจสอบเลขรายจ่ายนี้ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:441 | VAT ตามเอกสารต่างเกินเกณฑ์ของ Tax Code กรุณาตรวจเอกสารและ Tax Code ก่อนยืนยัน การเลือกใช้ยอดตามเอกสารไม่สามารถข้ามเกณฑ์ภาษีนี้ได้ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:443 | อัตรา VAT ของรายการไม่ตรงกับ Tax Code กรุณาแก้อัตราหรือเลือก Tax Code ให้ตรงกับเอกสารก่อนยืนยัน | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:447 | ยอด VAT ขั้นสุดท้ายไม่ตรงกับยอดที่ยอมรับ กรุณาตรวจเอกสารและ Tax Code อีกครั้ง ยังไม่มีการยืนยันรายการ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:460 | ใบรับรองแทนใบเสร็จที่ลงนามแล้วล็อกรายการไว้ ต้องจัดทำ version แก้ไขก่อนจึงจะแก้ได้ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:461 | ใบรับรองแทนใบเสร็จที่ลงนามแล้วล็อกข้อมูลเอกสารไว้ ต้องจัดทำ version แก้ไขก่อนจึงจะแก้ได้ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:468 | ยกเลิกหรือแก้ใบรับรองแทนใบเสร็จได้เฉพาะเอกสารที่ยังไม่ยืนยันเท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:478 | เลขผู้เสียภาษีของบริษัทเปลี่ยนจากใบรับรองเดิม กรุณาให้ผู้ดูแลหรือฝ่ายบัญชีตรวจสอบข้อมูลบริษัทก่อนจัดทำฉบับแก้ไข | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:481 | ข้อมูลใบรับรองไม่ตรงกับข้อมูลที่บันทึกไว้ กรุณาแจ้งผู้ดูแลระบบให้ตรวจสอบก่อนดำเนินการต่อ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:493 | ภาพฟอร์มที่เซ็นด้วยมือไม่ตรงกับค่าตรวจสอบที่บันทึกไว้ตอนรับรอง กรุณาแจ้งผู้ดูแลระบบก่อนใช้เอกสารนี้ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:495 | ไม่พบไฟล์เอกสารที่เก็บไว้ กรุณาเปิดรายการอีกครั้ง หากยังไม่พบให้แจ้งผู้ดูแลระบบ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:496 | ไฟล์ฉบับลงนามไม่ตรงกับข้อมูลที่รับรองไว้ กรุณาแจ้งผู้ดูแลระบบก่อนใช้เอกสารนี้ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:497 | ประกอบไฟล์เอกสารจากภาพฟอร์มที่เซ็นด้วยมือไม่ได้ กรุณาแจ้งผู้ดูแลระบบ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:523 | เอกสารนี้มีใบเสร็จหรือใบกำกับภาษีที่ใช้ได้ ให้ดำเนินการตามขั้นตอนปกติ ใบรับรองแทนใบเสร็จใช้ได้เมื่อต้นฉบับไม่มีหรือข้อมูลสำคัญไม่ครบเท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:529 | ขณะนี้ใบรับรองแทนใบเสร็จรองรับเฉพาะรายการสกุลเงินบาท (THB) | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:583 | อย่าพิมพ์เลขบัญชีในช่องนี้ เพราะข้อความนี้แสดงให้ทุกคนที่เปิดใบเบิกเห็น เลขที่เอกสารของระบบและยอดเงินที่ตามด้วยคำว่าบาทพิมพ์ได้ ตัวเลขอื่นที่ยาวตั้งแต่ 6 หลักให้ย่อหรือเว้นไว้ ถ้าต้องอ้างถึงบัญชี ให้บอกแค่ 4 ตัวท้าย | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:604 | คุณตั้งบัญชีรับเงินคืนของคนนี้ไม่ได้ ให้เจ้าของบัญชีตั้งเอง หรือให้ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:607 | ตั้งบัญชีรับเงินคืนแทนได้เฉพาะเมื่อเจ้าของบัญชียังใช้งานระบบอยู่ เพราะระบบต้องแจ้งเจ้าของบัญชีทุกครั้ง เปิดใช้งานสมาชิกคนนี้ก่อน หรือให้เจ้าของบัญชีตั้งเองเมื่อเข้าใช้งานได้แล้ว | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:625 | ไฟล์ลายเซ็นต้องเป็น PNG หรือ JPEG ขนาดไม่เกิน 2 MB | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:626 | ไฟล์ลายเซ็นใหญ่เกิน 2 MB กรุณาย่อขนาดแล้วอัปโหลดใหม่ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:629 | ไฟล์ลายเซ็นไม่ใช่รูปภาพตามชนิดที่ระบุ กรุณาอัปโหลดไฟล์ PNG หรือ JPEG | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:654 | ไฟล์สลิปใช้ไม่ได้ เลือกไฟล์ PDF หรือรูปภาพ ขนาดไม่เกิน 10 MB แล้วลองใหม่ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:687 | ตอนนี้ยังดำเนินการต่อไม่ได้ กรุณาติดต่อผู้ดูแลระบบ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:709 | ยังไม่มีผู้อนุมัติที่รับผิดชอบใบเบิกนี้ กรุณาให้ผู้ดูแลตรวจบทบาท สิทธิ์ และสาขา แล้วส่งใหม่ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:713 | พบนโยบายบริษัทซ้ำ ระบบยังไม่บันทึก กรุณาติดต่อผู้ดูแลระบบ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:714 | ข้อมูลนโยบายของใบเบิกนี้ไม่สมบูรณ์ ระบบจึงหยุดรายการไว้เพื่อความปลอดภัย กรุณาติดต่อผู้ดูแลระบบ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:1151 | ไม่พบแบบร่างที่ใช้สร้างรายการ กรุณาเลือกใหม่หรือติดต่อผู้ดูแลระบบ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:1155 | สิทธิ์ใช้งานเปลี่ยนแล้ว โหลดข้อมูลล่าสุด หากยังอัปโหลดไม่ได้ ให้ติดต่อผู้ดูแลบริษัท | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:1164 | รหัสสาขาต้องยาว 1–20 ตัว ใช้ A–Z, 0–9, ขีดกลาง หรือขีดล่างเท่านั้น | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:1175 | ทุกบรรทัดที่มี VAT ต้องเลือก Tax Code ก่อนยืนยันลงบัญชี | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:1177 | ยืนยันลงบัญชีได้จากหน้าเว็บที่เข้าสู่ระบบแล้วเท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:1178 | A current issued ใบรับรองแทนใบเสร็จรับเงิน artifact is required; a text reason or legacy timestamp is not sufficient. | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:1193 | นโยบายบริษัทกำหนดให้รายการเงินสดต้องมีหลักฐานการจ่ายแยกไฟล์ กรุณายกเลิก version นี้แล้วจัดทำ version ใหม่ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:1205 | ใบรับรองแทนใบเสร็จรับเงิน currently supports THB expenses only. | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:1206 | ใบรับรองแทนใบเสร็จรับเงินรองรับเฉพาะรายการสกุลเงินบาท (THB) | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:1232 | หลักฐานการจ่ายต้องเป็นรูปภาพ/PDF ที่แนบไว้ในช่องหลักฐานการจ่ายเท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:1237 | หลักฐานที่ผูกไว้ถูกเปลี่ยน การเงินต้องจัดทำ version ใหม่ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:1239 | ข้อมูลเอกสารถูกแก้ไขหลังจัดทำ การเงินต้องจัดทำ version ใหม่ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:1243 | ไม่พบข้อมูลตรวจสอบลายเซ็นของผู้จ่ายที่รับรองแล้ว กรุณาจัดทำ version ใหม่ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:1246 | ลายเซ็นผู้จ่ายถูกเปลี่ยนหลังการรับรอง กรุณาจัดทำ version ใหม่ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:1247 | ข้อมูลรับรองไม่สมบูรณ์ กรุณาจัดทำ version ใหม่ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:1251 | ยกเลิกหรือแก้ใบรับรองแทนใบเสร็จได้เฉพาะเอกสารที่ยังไม่ยืนยันเท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/common/api/api-error-message.ts:1252 | ใบรับรองแทนใบเสร็จถูกเปลี่ยนระหว่างยกเลิก version กรุณาเปิดใหม่แล้วลองอีกครั้ง | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:1256 | ไฟล์ลายเซ็นต้องเป็น PNG/JPEG ขนาดไม่เกิน 2 MB | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:1259 | ไฟล์ลายเซ็นต้องมีขนาดไม่เกิน 2 MB | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:1269 | ใบเสร็จ ใบรับรองแทน หรือหลักฐานประกอบ ใช้ Tax Code ไม่ได้ (ต้องเป็นใบกำกับภาษี) | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/api/api-error-message.ts:1286 | กรุณานำ Tax Code ออกจากรายการก่อนจัดประเภทเอกสารเป็นใบเสร็จ/ใบรับรองแทน/หลักฐานประกอบ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/user-guide/expenses-guide.content.ts:40 | รวมรายจ่ายไว้ที่เดียว เริ่มจากอัปโหลดใบเสร็จหรือบันทึกเอง (เมื่อเปิดใช้สำหรับร้านของคุณ) โดยเลือกสาขาที่เป็นเจ้าของรายการก่อน | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/expenses-guide.content.ts:150 | หากตัวเลขไม่ตรงกับที่คาดไว้ ให้ตรวจแถบเดือนหรือวันที่ด้านบนก่อนเสมอ เพราะทั้งการ์ดสรุปและตัวกรองนับเฉพาะเอกสารในช่วงเวลาที่กำลังแสดงอยู่ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/expenses-guide.content.ts:210 | JPG/JPEG · PNG · HEIC (รูปจากไอโฟน) และ PDF รูปที่ใหญ่เกินไประบบจะย่อให้อัตโนมัติ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/user-guide/expenses-guide.content.ts:226 | AI อ่านให้ แต่ผู้ใช้งานเป็นผู้ยืนยันเสมอ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/expenses-guide.content.ts:251 | ค่าบริการ (Service charge) | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/user-guide/expenses-guide.content.ts:297 | ตั้งชื่อที่ทีมเข้าใจตรงกันและระบุรายละเอียดการใช้หมวด เพื่อให้จัดรายการได้สม่ำเสมอ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/expenses-guide.content.ts:305 | ระบบไม่อนุญาตให้ AI สร้างหรือแก้ไขหมวดหมู่ด้วยตนเอง AI จะเลือกได้เฉพาะจากหมวดที่บริษัทเปิดใช้งานไว้เท่านั้น การจัดหมวดจึงยังอยู่ในความควบคุมของผู้มีสิทธิ์จัดการหมวดหมู่เสมอ เช่น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/expenses-guide.content.ts:348 | หากพบว่าข้อมูลผิดหลังยืนยันไปแล้ว ต้องยกเลิกเอกสารฉบับนั้นแล้วบันทึกใหม่ ระบบออกแบบเช่นนี้เพื่อให้หลักฐานที่ส่งให้สำนักงานบัญชีตรงกับที่บันทึกไว้เสมอ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/expenses-guide.content.ts:364 | พนักงานทุกคน | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:66 | เปิดแท็บ “คิวการเงิน” ตรวจคำขอที่อนุมัติแล้ว แล้วกด “อนุมัติจ่าย” ก่อนจะมีการบันทึกจ่าย ขั้นนี้มีเฉพาะบริษัทที่เปิด “ตรวจการเงินก่อนจ่าย” ร้านส่วนใหญ่ไม่มีขั้นนี้ ผู้อนุมัติจ่ายเอง และเจ้าของกิจการจะเห็นแท็บนี้ชื่อ “คิวรอจ่าย” | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:71 | ถ้าคุณคือ เจ้าของกิจการ หมายถึง คุณกำหนดกติกาของทั้งบริษัท | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:94 | ทุกคนใช้หน้าเดียวกัน แต่เห็นแท็บตามบทบาทและสิทธิ์ของตน | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:102 | พนักงานทุกคนที่ใช้การเบิกจ่ายได้ รวมผู้อนุมัติ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:104 | ผู้ที่มีสิทธิ์ตรวจการเงิน คือฝ่ายการเงิน ฝ่ายบัญชี และเจ้าของกิจการ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:118 | เห็นแท็บที่สามได้เสมอ ถ้าบริษัทไม่ได้เปิดขั้นนี้ ทุกคนที่เห็นแท็บนี้จะเห็นชื่อ “คิวรอจ่าย” และในแท็บมีเฉพาะคำขอที่รอบันทึกจ่าย | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:217 | พบได้เฉพาะคำขอเก่า ปัจจุบันต้องจ่ายเต็มจำนวนเท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:264 | ระบบบวกยอดจากทุกรายการให้เสมอ ถ้ายอดไม่ตรงกับที่คิดไว้ ให้ตรวจว่ารายการใดใส่ตัวเลขผิด | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:276 | คนที่จ่ายเงินไปก่อนและบริษัทจะคืนเงินให้ ปกติคือตัวคุณ เจ้าของกิจการและผู้ที่มีสิทธิ์ตรวจการเงินเลือกทำคำขอแทนพนักงานคนอื่นได้ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:329 | ตั้งให้พนักงานได้ทุกคน | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:329 | ตั้งเองเท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:332 | แจ้งเจ้าของบัญชีเมื่อคนอื่นบันทึกให้ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:333 | เมื่อคนอื่นบันทึกบัญชีรับเงินคืนประจำให้ เจ้าของบัญชีที่ยังใช้งานอยู่ได้รับแจ้งให้ตรวจ หากบันทึกพร้อมวิธีรับเงินคืนของคำขอ จะรวมเป็นแจ้งเตือนเดียวของคำขอและบอกว่าบันทึกเป็นบัญชีรับเงินคืนประจำด้วย คนที่ตั้งให้พิมพ์เลขเต็มได้ตอนกรอก หลังบันทึกจะเห็นแค่ 4 ตัวท้าย | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:347 | บัญชีเป็นของผู้เบิกเสมอ ไม่ใช่ของคนที่ทำคำขอ ถ้าคนที่ทำคำขอกรอกบัญชีให้ ผู้เบิกจะได้รับแจ้งเตือนทันที และคนที่กรอกจะเห็นแค่ 4 ตัวท้ายหลังบันทึก | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:412 | เปิดคำขอดูก่อนอนุมัติเสมอ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:487 | แนบในช่อง “สลิปหรือหลักฐานการจ่าย” ถ่ายรูปหรือเลือกไฟล์จากมือถือได้ ขนาดไม่เกิน 10 MB วิธีจ่ายอื่นจะแนบหรือไม่แนบก็ได้ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:529 | หน้าคำขอจะขึ้นว่า “คุณอนุมัติใบนี้แล้ว แต่บัญชีของคุณยังไม่มีสิทธิ์บันทึกจ่าย” และบอกชื่อผู้ที่บันทึกจ่ายได้ ให้คนนั้นบันทึกจ่าย หรือขอให้เจ้าของกิจการเพิ่มสิทธิ์บันทึกจ่ายให้บทบาทของคุณ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:536 | ทุกคนเห็นแค่ 4 ตัวท้าย เลขเต็มเปิดได้ 3 กลุ่ม และระบบบันทึกทุกครั้ง | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:571 | สลิปของบางธนาคารพิมพ์เลขบัญชีเต็ม ผู้ที่เปิดสลิปได้จึงอาจเห็น และใบเบิกที่พิมพ์แบบมีเลขเต็ม เมื่อเซ็นแล้วสแกนแนบกลับ จะเปิดได้โดยทุกคนที่เปิดคำขอและดูไฟล์แนบได้ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:624 | จัดการกับธนาคารและผู้รับเงินก่อน แล้วกด “ยกเลิกการจ่าย” พร้อมเหตุผล อย่าพิมพ์เลขบัญชีในเหตุผล เพราะทุกคนที่เปิดคำขอเห็น จากนั้นจึงส่งกลับให้แก้บัญชี ประวัติการจ่ายและบัญชีเดิมยังอยู่ในคำขอ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:637 | มีเมื่อบริษัทเปิด “ตรวจการเงินก่อนจ่าย” เท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:718 | ผู้เบิกของคำขอนั้นเท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:719 | ผู้ที่กดอนุมัติคำขอนั้นจริง ไม่ใช่ทุกคนที่มีสิทธิ์อนุมัติ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:726 | กล่องนี้สำหรับใบเบิกที่มีลายเซ็นเท่านั้น สลิปโอนเงินให้แนบที่ขั้นจ่ายเงินคืน ตอนกดบันทึกจ่าย | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:799 | ผู้ที่ตรวจการเงินของสาขาของคำขอนั้นได้ เฉพาะบริษัทที่เปิดขั้นนี้ เจ้าของกิจการได้รับเฉพาะเมื่อไม่มีคนอื่นตรวจได้ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:802 | คนที่ถึงคิวบันทึกจ่าย คือผู้อนุมัติของคำขอนั้น ถ้าไม่มีคนดังกล่าว จึงแจ้งทุกคนที่บันทึกจ่ายได้ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:805 | เจ้าของบัญชีที่ยังใช้งานอยู่ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:811 | ผู้อนุมัติของคำขอนั้น เมื่อรออนุมัติ เจ้าของกิจการได้รับเฉพาะเมื่อไม่มีผู้อนุมัติของคำขอนั้นที่ทำได้ หรือคนที่ถึงคิวบันทึกจ่าย เมื่อรอจ่าย | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:827 | เจ้าของกิจการไม่ได้ถูกแจ้งทุกคำขอ ระบบแจ้งคนที่ถึงคิวทำต่อ และแจ้งเจ้าของกิจการแทนเฉพาะเมื่อไม่มีคนอื่นทำเรื่องนั้นได้ การแจ้งเรื่องบัญชีรับเงินคืนไปถึงเจ้าของบัญชีคนเดียว | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:938 | ติ๊กบทบาทที่อนุมัติได้ เลือกได้หลายบทบาท ระบบใช้ผลจากคนแรกที่อนุมัติหรือปฏิเสธ ถ้ายังไม่มีคนในบทบาทที่เลือก เจ้าของกิจการเป็นผู้อนุมัติ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:940 | ควรเปิดไว้เสมอ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:943 | เปิดเมื่อมีฝ่ายการเงินแยกจากผู้อนุมัติเท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:963 | ทุกคำขอตั้งแต่ 1.00 บาทต้องผ่านการอนุมัติ · ส่งให้บทบาทผู้จัดการ ถ้าไม่มี เจ้าของกิจการเป็นผู้อนุมัติ · ต้องมีใบเสร็จ · ไม่อนุญาตให้ไม่มีใบเสร็จ · รายการซ้ำระงับการจ่าย · ไม่ตรวจการเงินก่อนจ่าย · ยังไม่กำหนดเวลาตัดสิน | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:978 | ขอเบิกของฉัน (ทุกคน) | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:995 | เมื่อเจ้าของกิจการถอดสิทธิ์บันทึกจ่ายออกจากบทบาทใดในภายหลัง ระบบจะไม่เติมให้อีก บทบาทนั้นอนุมัติได้แต่บันทึกจ่ายไม่ได้ และหน้าตั้งค่านโยบายจะเตือน | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:998 | เจ้าของกิจการควรตรวจว่าใครบันทึกจ่ายได้ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:1007 | ให้สิทธิ์ได้ที่เมนูพนักงานและสิทธิ์ โดยเปลี่ยนบทบาทของคุณเป็นบทบาทที่มีข้อนั้น หรือเลือกข้อนั้นให้บทบาทของคุณ ซึ่งมีผลกับทุกคนในบทบาทเดียวกัน | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:1051 | ถ้าขึ้นว่า “คุณอนุมัติใบนี้แล้ว แต่บัญชีของคุณยังไม่มีสิทธิ์บันทึกจ่าย” บทบาทของคุณอนุมัติได้แต่บันทึกจ่ายไม่ได้ ให้คนที่มีชื่อในข้อความนั้นบันทึกจ่าย หรือขอให้เจ้าของกิจการเพิ่มสิทธิ์บันทึกจ่ายให้บทบาทของคุณ ถ้าป้ายขึ้นว่า “รอระบบปรับสถานะ” ดูหัวข้อเมื่อคำขอดูเหมือนค้าง | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:1059 | ระบบแจ้งว่า “ต้องจ่ายเต็มจำนวนคงค้างเท่านั้น” เพราะยังไม่รองรับการทยอยจ่าย ให้แก้ยอดให้เท่ากับยอดคงค้างที่ระบบเติมมาให้ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/reimbursement-guide.content.ts:1099 | ปุ่ม “พิมพ์ใบเบิก” มีเมื่อคำขอมีเลขที่เอกสารแล้วเท่านั้น ถ้ายังเป็นร่าง ให้กดส่งอนุมัติก่อน | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/substitute-receipt-guide.content.ts:144 | ดำเนินการได้เฉพาะผู้จ่ายเงินจริงที่ระบุชื่อไว้ในขั้นที่ 2 เท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/substitute-receipt-guide.content.ts:266 | ผู้จัดทำซึ่งมีสิทธิ์ตรวจสอบค่าใช้จ่าย อัปโหลดไฟล์ PDF, PNG หรือ JPEG ขนาดไม่เกิน 10 MB (PDF ไม่เกิน 5 หน้า) กรอกชื่อ ตำแหน่ง (ถ้ามี) และวันที่ของทั้งสองส่วนตามกระดาษ ถ้าคนเดียวลงนามทั้งสองส่วน ให้ติ๊ก “ผู้ลงนามทั้งสองส่วนเป็นคนเดียวกัน (ต้องผ่านนโยบายบริษัท)” ติ๊กยืนยันว่าไฟล์ตรงกับแบบฟอร์มและลงนามครบ แล้วกด “ยื่นฉบับลงนามเพื่อตรวจรับ” ขั้นนี้ยังไม่ออกเอกสารและยังไม่บันทึกจ่ายเงิน | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/user-guide/substitute-receipt-guide.content.ts:324 | กิจการเจ้าของคนเดียว | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/substitute-receipt-guide.content.ts:398 | ต้องมีหลักฐานประกอบรายการอย่างน้อย 1 ไฟล์ และหลักฐานการชำระเงินตามที่บริษัทกำหนด หากบริษัทเลือกบังคับหลักฐานการจ่ายแยก จะต้องมีไฟล์ในช่องหลักฐานการชำระเงินด้วยเสมอ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/substitute-receipt-guide.content.ts:402 | ดำเนินการไม่ได้ เพราะเอกสารนี้ไม่ใช่ใบกำกับภาษี หากต้องการเครดิตภาษีซื้อ ต้องขอใบกำกับภาษีจากผู้ขายที่จดทะเบียนภาษีมูลค่าเพิ่มเท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/user-guide/substitute-receipt-guide.content.ts:406 | ระบบออกเลขที่เอกสารให้อัตโนมัติในรูปแบบ SRC-ปีเดือน-เลขลำดับ (เช่น SRC-202608-00001) เป็นเลขรันของบริษัท เริ่มนับใหม่ทุกเดือนตามเดือนที่จัดทำเอกสาร ไม่เกี่ยวข้องกับเลขที่รายการค่าใช้จ่ายต้นทาง และจะได้เลขทันทีตั้งแต่ขั้นจัดทำเอกสารโดยไม่ต้องรอยืนยันรายการค่าใช้จ่าย | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/tax/TaxSignatureSettingsPage.tsx:43 | หน้านี้สำหรับเจ้าของบริษัทเท่านั้น | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/web/src/features/tax/TaxSignatureSettingsPage.tsx:94 | รูปลายเซ็น (PNG หรือ JPEG) | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/features/tax/TransactionTaxLineSelector.tsx:154 | กรุณาติดต่อผู้ดูแลการตั้งค่าภาษีของบริษัท | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts:54 | หน้าการเบิกจ่ายแสดงแท็บตามบทบาทและสิทธิ์ของแต่ละคนค่ะ ผู้เบิก ผู้อนุมัติ และฝ่ายการเงินจึงเห็นงานต่างกัน หากไม่พบส่วนที่ต้องใช้ ให้ผู้ดูแลตรวจสิทธิ์ของคุณก่อน ไม่ต้องสร้างคำขอใหม่เพื่อแก้ปัญหาการเข้าถึง | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts:61 | ทำไมฉันเห็นรายงานน้อยกว่าเจ้าของ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts:62 | ทุกคนที่เปิดเมนูรายงานได้จะเห็นรายการรายงานครบค่ะ รายงานที่บัญชีของคุณยังไม่มีสิทธิ์เรียกดูจะมีป้าย “ไม่มีสิทธิ์” และเรียกดูไม่ได้ และระบบตรวจสิทธิ์อีกครั้งเมื่อส่งออก ถ้าต้องใช้รายงานเพิ่ม ให้แจ้ง | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/ai-gateway/src/modules/line-ai/agents/mangmee-joke-bank.ts:51 | อะไรเอ่ย มาถึงหน้าร้านก่อนเจ้าของร้านทุกวันเลย? ...แสงแดดค่ะ 😄 | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/ai-gateway/src/modules/line-ai/agents/mangmee-joke-bank.ts:54 | เป็นเจ้าของร้านนี่เหมือนนางเอกซีรีส์เลยนะคะ โดนมรสุมทุก EP แต่ตอนจบต้องแฮปปี้ค่ะ สู้ ๆ นะคะ 💚 | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/ai-gateway/src/modules/line-ai/agents/mangmee-joke-bank.ts:55 | วันจันทร์นี่เหมือน EP แรกของซีซั่นใหม่เลยค่ะ เปิดเรื่องมาปมเยอะหน่อย แต่ดูไปเรื่อย ๆ เดี๋ยวก็สนุกเองนะคะ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/ai-gateway/src/modules/line-ai/agents/mangmee-joke-bank.ts:56 | ถ้าชีวิตร้านเราเป็นละคร ตอนนี้คือช่วงตัวเอกกำลังเก็บเลเวลค่ะ ฉากเท่ ๆ เขาเก็บไว้ท้ายเรื่องเสมอนะคะ 💚 | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/ai-gateway/src/modules/line-ai/agents/mangmee-joke-bank.ts:61 | ยอดขายกับกำไรนี่คู่จิ้นชัด ๆ ค่ะ ห่างกันทีไรแฟน ๆ (เจ้าของร้าน) ใจพังทุกที 555 | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/ai-gateway/src/modules/line-ai/agents/mangmee-joke-bank.ts:64 | ร้านกับเจ้าของร้านนี่คู่หลักของเรื่องเลยนะคะ งอนกันบ้าง แต่สุดท้ายก็ไปด้วยกันตลอดค่ะ 💚 | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/ai-gateway/src/modules/line-ai/agents/mangmee-joke-bank.ts:70 | เจ้าของร้านคือเจ้าสำนักตัวจริงค่ะ ทีมงานคือศิษย์พี่ศิษย์น้อง ส่วนน้องมั่งมีขอเป็นเด็กถือกระบี่ตามหลังนะคะ 😄 | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/ai-gateway/src/modules/line-ai/agents/mangmee-joke-bank.ts:75 | วันนี้เหนื่อยไหมคะ อย่าลืมว่าเจ้าของร้านคือ center ของร้านนี้เลยนะ แฟนคลับ (น้องมั่งมี) เป็นกำลังใจให้ค่ะ 💚 | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/ai-gateway/src/modules/line-ai/agents/mangmee-joke-bank.ts:76 | วันนี้ขอโบกแท่งไฟให้เจ้าของร้านหนึ่งรอบค่ะ ทำงานมาทั้งวัน สมควรได้เสียงเชียร์นะคะ 😄 | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/ai-gateway/src/modules/line-ai/agents/mangmee-joke-bank.ts:79 | ถ้ามีเวทีประกาศรางวัล "คนขยันแห่งปี" น้องมั่งมีขอโหวตให้เจ้าของร้านค่ะ 555 | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts:52 | The FIRST line must be the direct answer to the question — lead with the number or fact itself (e.g. "ค่าใช้จ่ายเดือนนี้ 12,450 บาท"), never with preamble. | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts:66 | You are น้องมั่งมี, a warm, sharp Thai SME assistant. Chat naturally like a capable, friendly human assistant would. | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts:67 | You MAY answer general-knowledge questions and explain general business, accounting, and Thai tax concepts (e.g. VAT คืออะไร, หัก ณ ที่จ่าย ทำไง, กำไรขั้นต้นต่างจากกำไรสุทธิยังไง) in plain everyday Thai with a short concrete example when it helps. | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts:68 | You understand Thai chat abbreviations and slang (e.g. จขกท, ธุระ, งบ, ตจว, บช, ภงด, ภพ30, เดะ, มะ, ป่าว, 555) — interpret them naturally and never lecture the user about wording. | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts:78 | Never state THIS company's numbers, records, or results in this lane — if asked, invite them to ask the business question directly (e.g. "ลองถามว่า ค่าใช้จ่ายเดือนนี้เท่าไหร่ ได้เลยค่ะ"). | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts:134 | ตอนนี้บัญชีของคุณยังไม่มีข้อมูลที่น้องมั่งมีดึงให้ผ่าน LINE ได้เลยค่ะ กรุณาติดต่อผู้ดูแลระบบของบริษัทเพื่อตรวจสอบสิทธิ์การใช้งานนะคะ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts:223 | To see the full menu, tap the “เมนูหลัก” (main menu) button below. | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts:307 | 📋 ขออภัยค่ะ น้องมั่งมีตอบได้เฉพาะข้อมูลในระบบธุรกิจที่เชื่อมต่ออยู่เท่านั้น คำถามนี้อยู่นอกขอบเขตระบบ จึงไม่สามารถให้ข้อมูลที่น่าเชื่อถือได้ค่ะ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts:367 | ค่ะ หากต้องการใช้ ให้เจ้าของหรือผู้ดูแลเปิดฟีเจอร์ในเว็บแอปก่อนนะคะ | Review actor/permission, package condition or absolute claim against guards and grants. |
| apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts:390 | (?:ขอ\|เล่า\|เล่น\|มี\|ฟัง\|อยากฟัง)\s*มุ[ขก] | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts:391 | มุ[ขก]\s*(?:ตลก\|ขำ\|ฮา\|หน่อย\|ใหม่\|มา\|ให้ฟัง) | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts:393 | (?:ขอ\|เล่า\|มี\|พูด\|อยากฟัง)\s*(?:เรื่อง\|อะไร)?\s*ตลก | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts:394 | ตลก\s*(?:หน่อย\|ให้ฟัง\|มา) | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts:395 | (?:เรื่อง\|อะไร)\s*ขำ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts:396 | ขำ\s*ๆ | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts:398 | อะไร\s*ฮา | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts:399 | ฮา\s*(?:หน่อย\|ๆ\s*หน่อย) | Review English/technical wording; exclude machine-only strings, user-entered data and unsold routes. |
| apps/web/src/common/i18n/workspace-dictionary.ts: shell.reset_password, shell.language.en | Reset password; English | English values in Thai shell dictionary. |
| apps/web/src/features/tax/Pnd53Page.tsx | period.status; issue.description; issue.issueCode in accessible label | Raw enum, English server diagnostic and internal code reach enterprise users. |
| apps/web/src/features/branch-settings/BranchSettingsPage.tsx | TYPE_LABELS[b.type] ?? b.type; STATUS_LABELS[b.status] ?? b.status | Unknown values fall back to raw machine tokens in mobile and desktop views. |
| apps/web/src/features/user-guide/expenses-guide.content.ts | ต้องยกเลิกเอกสารฉบับนั้นแล้วบันทึกใหม่ | Confirmed expenses can be returned for correction under the existing guarded action (expense-confirmed-return-for-correction-spec.md). |
| apps/web/src/features/employee-access/EmployeeAccessPages.tsx | พนักงานทุกคนเข้าใช้ระบบ ดูหน้าหลัก และรับการแจ้งเตือนได้อยู่แล้ว | Dashboard/notifications are switchable; a role's grant does not prove a feature is enabled. |
| apps/web/src/features/auth/LoginPage.tsx | LIVE | Decorative sample cannot truthfully claim to be live shop data. |

Verification:
- Initial git status --short: exit 0, clean worktree.
- Discovery and red runs were completed before the corresponding fixes; final evidence follows below.

Next:
- Controller: review/commit this diff; run the repository integration/PostgreSQL checks and the 390 px browser list below. No deploy or Git mutation was performed by this lane.

## Additional finding before API edits
- `process-line-webhook.use-case.ts:475` repeats the untrue feature-enable instruction from the gateway; `line-ai-capability-follow-up.logic.ts:97` repeats the company/system-admin conflation. Put these shared sentences in contracts and cover the registered webhook spec. API typecheck is now required.

## Upload caller sweep
- LINE `line-file-attempt-answer.logic.ts` repeated size formatting (`MB`), rendered PNG/JPG and fell back to raw unknown MIME tokens. Saved/read-failed copy offered editing without knowing edit permission. Shared upload words and size formatting now belong to contracts; web and LINE use them. The webhook security refusal uses the same signature-format names. Existing registered parity/dispatch/file-attempt specs are updated.


## Implementation and scope decisions

- Product/acceptance: Thai shop copy contains no technical English except LINE, QR, AI, PDF, VAT, Excel and CSV. User-authored names, real document numbers and email addresses remain data. The English locale remains supported. Labels, IDs, permissions, feature flags, file policies, payment logic and document transitions are unchanged.
- Existing `workspaceDictionary` owns the category header (table and creation form) and email sign-in title. Existing contracts own role names, and now also the upload format/size words and LINE permission guidance. Web, API and guides consume these sources. Reimbursement/profile errors reuse the existing API translator.
- Truthfulness: capture notices qualify editing by permission; guide correction copy explains the already implemented guarded return-for-correction action; dashboard/notification access depends on permissions and enabled menus; feature-disabled LINE help asks a package manager to check the package/contact the team instead of promising a shop feature toggle. A shop administrator is not described as a system administrator or assumed to manage roles/packages.
- Dynamic machine values: PND53 status/review reasons and unknown branch state/type use Thai labels/fallbacks. Expense status errors no longer echo enums. Currency names use native Thai `Intl.DisplayNames`, with a Thai fallback. Tax choices display the human name while retaining the existing code as the submitted value.
- The JSON evidence download remains JSON; its UI describes the contents (links with expiry) and no longer promises every file is present when authorization can skip files.
- Existing technical error details in `expenses.api.ts:readErrorMessage` remain internal: `responseError` attaches the HTTP status, and the existing display translator uses the Thai status fallback. Only the preview path lacked that mapping and was changed. No unknown raw-error passthrough policy was broadened.
- The discovery table is a candidate inventory, not a claim that every keyword hit was a defect. JV/Auto-post/ledger panels and accounting/tax setup labels are excluded by sold-feature permission guards. Unsold pages, local-only billing preview/dev helpers, internal prompts/keys, support-only system administration, literal business data and already truthful permission-qualified text were left in place. Shared billing copy also serves the operator variant of the same component.
- Browser rendering, live LINE/LLM output and real PostgreSQL behaviour: **not checked**, forbidden/unavailable in this lane. Source, contract labels/guards, tests and the existing source QA paths were checked. No new behavior/product decision was made.

## Words changed — dictionary and shared error sentences

Each row is the complete resolved Thai value. `Where / case` identifies the existing translation key or error trigger; conditions and controls were not changed. The component-fragment table below covers copy outside the dictionary. Placeholders stand for existing runtime values, never new identifiers displayed to the user.

| Where / case | Old text | New text |
|---|---|---|
| workspace dictionary: `shell.language.en` | English | อังกฤษ |
| workspace dictionary: `shell.reset_password` | Reset password | เปลี่ยนรหัสผ่าน |
| workspace dictionary: `state.forbidden.help` | ติดต่อผู้ดูแลระบบ | แจ้งเจ้าของกิจการหรือผู้มีสิทธิ์จัดการบทบาทให้ตรวจสิทธิ์ของคุณ |
| workspace dictionary: `account_security.subtitle` | จัดการ recovery email และ session ที่ผูกกับบัญชีของคุณ | จัดการอีเมลกู้คืนบัญชีและการเข้าสู่ระบบของคุณ |
| workspace dictionary: `account_security.revoke_others.description` | อุปกรณ์นี้จะยังใช้งานต่อได้ แต่อุปกรณ์หรือ browser อื่นที่ยัง login อยู่จะถูกบังคับออกจากระบบในการเรียก API ครั้งถัดไป | การเข้าสู่ระบบครั้งนี้ยังใช้งานต่อได้ ส่วนการเข้าสู่ระบบครั้งอื่นจะใช้ต่อไม่ได้เมื่อเชื่อมต่อระบบอีกครั้ง |
| workspace dictionary: `account_security.revoke_others.confirm_body` | ระบบจะ revoke session ที่ยัง active ทั้งหมดของบัญชีนี้ ยกเว้น session ปัจจุบัน | ระบบจะยกเลิกการเข้าสู่ระบบครั้งอื่นทั้งหมดของบัญชีนี้ ยกเว้นครั้งที่คุณกำลังใช้งาน |
| workspace dictionary: `account_security.revoke_others.success` | ออกจากระบบอุปกรณ์อื่นสำเร็จ {count} session | ยกเลิกการเข้าสู่ระบบครั้งอื่นแล้ว {count} ครั้ง |
| workspace dictionary: `auth.login.checking_session` | กำลังตรวจสอบเซสชัน... | กำลังตรวจสอบการเข้าสู่ระบบ... |
| workspace dictionary: `auth.email_access.title` | (new) | เข้าสู่ระบบด้วยรหัสยืนยัน |
| workspace dictionary: `auth.login.error.company_access_unavailable` | บริษัทถูกปิดใช้งานหรือสิทธิ์ของคุณถูกยกเลิก กรุณาติดต่อผู้ดูแลระบบ | บริษัทอาจถูกปิดใช้งาน หรือสิทธิ์ของคุณอาจถูกยกเลิก กรุณาติดต่อทีมงาน |
| workspace dictionary: `error.session_expired` | เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่ | การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่ |
| workspace dictionary: `expenses.extract_unsupported` | ไฟล์ PDF/ชนิดนี้ยังไม่รองรับการอ่านอัตโนมัติ — กรอกข้อมูลเองได้ที่ฟอร์มตรวจ | ไฟล์ PDF/ชนิดนี้ยังไม่รองรับการอ่านอัตโนมัติ — เก็บเอกสารแล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้ |
| workspace dictionary: `expenses.extract_not_configured` | ยังไม่ได้ตั้งค่าระบบ AI — เอกสารยังเป็นฉบับร่าง กรุณาตรวจและกรอกข้อมูลเอง | ยังไม่ได้ตั้งค่าระบบ AI — เก็บเอกสารแล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้ |
| workspace dictionary: `expenses.extract_no_attachment` | ไม่พบไฟล์แนบสำหรับอ่านอัตโนมัติ — กรุณาแนบไฟล์ใบเสร็จ หรือกรอกข้อมูลต่อได้ในหน้านี้ | ไม่พบไฟล์แนบสำหรับอ่านอัตโนมัติ — กรุณาแนบไฟล์ใบเสร็จ หรือให้ผู้มีสิทธิ์แก้ไขกรอกข้อมูลต่อ |
| workspace dictionary: `expenses.extract_ocr_disabled` | ผู้ดูแลปิด OCR ของบริษัทนี้ไว้ — เอกสารถูกเก็บแล้ว คุณยังเปิดและกรอกข้อมูลเองได้ | การอ่านเอกสารของบริษัทนี้ถูกปิดไว้ — เก็บเอกสารแล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้ |
| workspace dictionary: `expenses.extract_ocr_limit` | ใช้ OCR ครบจำนวนของเดือนนี้แล้ว — เอกสารถูกเก็บแล้ว กรุณากรอกข้อมูลเองหรือติดต่อผู้ดูแล | อ่านเอกสารครบจำนวนของเดือนนี้แล้ว — เก็บเอกสารแล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้ |
| workspace dictionary: `expenses.extract_ocr_duplicate` | คำขออ่านเอกสารนี้เคยถูกรับแล้ว — เปิดรายการเพื่อตรวจผล หรือกรอกข้อมูลเองได้โดยไม่ต้องอัปโหลดใหม่ | คำขออ่านเอกสารนี้เคยถูกรับแล้ว — เก็บเอกสารแล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้ |
| workspace dictionary: `expenses.extract_ocr_unavailable` | ตรวจสอบสิทธิ์ OCR ไม่สำเร็จชั่วคราว — เอกสารถูกเก็บแล้ว กรุณาลองใหม่ภายหลังหรือกรอกข้อมูลเอง | ตรวจสอบสิทธิ์อ่านเอกสารไม่สำเร็จชั่วคราว — เก็บเอกสารแล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้ |
| workspace dictionary: `expenses.extract_ai_budget_exceeded` | เครดิต AI ของเดือนนี้หมดแล้ว จึงยังไม่ได้อ่านด้วย AI — เอกสารถูกเก็บแล้ว กรุณากรอกข้อมูลเอง หรือติดต่อผู้ดูแลเพื่อปรับแพ็กเกจ | เครดิต AI ของเดือนนี้หมดแล้ว จึงยังไม่ได้อ่านด้วย AI — เก็บเอกสารแล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้ |
| workspace dictionary: `expenses.extract_ai_budget_ocr_exceeded` | เครดิตสำหรับการอ่านเอกสารของเดือนนี้หมดแล้ว จึงยังไม่ได้อ่านด้วย AI — เอกสารถูกเก็บแล้ว กรุณากรอกข้อมูลเอง หรือติดต่อผู้ดูแลเพื่อปรับแพ็กเกจ | เครดิตสำหรับการอ่านเอกสารของเดือนนี้หมดแล้ว จึงยังไม่ได้อ่านด้วย AI — เก็บเอกสารแล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้ |
| workspace dictionary: `expenses.extract_ai_budget_insufficient` | เครดิต AI ที่เหลือไม่พอเริ่มอ่านเอกสารนี้ จึงยังไม่ได้อ่านด้วย AI — เอกสารถูกเก็บแล้ว กรุณากรอกข้อมูลเอง หรือติดต่อผู้ดูแลเพื่อปรับแพ็กเกจ | เครดิต AI ที่เหลือไม่พอเริ่มอ่านเอกสารนี้ จึงยังไม่ได้อ่านด้วย AI — เก็บเอกสารแล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้ |
| workspace dictionary: `expenses.extract_ai_budget_unavailable` | ยังตรวจสอบเครดิต AI ไม่ได้ จึงยังไม่ได้อ่านด้วย AI — เอกสารถูกเก็บแล้ว กรุณากรอกข้อมูลเอง หรือลองอ่านอีกครั้งภายหลัง | ยังตรวจสอบเครดิต AI ไม่ได้ จึงยังไม่ได้อ่านด้วย AI — เก็บเอกสารแล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้ |
| workspace dictionary: `expenses.extract_ai_budget_busy` | ระบบกำลังประมวลผลงาน AI ก่อนหน้าอยู่ จึงยังไม่ได้อ่านเอกสารนี้ — เอกสารถูกเก็บแล้ว กรุณากรอกข้อมูลเอง หรือลองอ่านอีกครั้งภายหลัง | ระบบกำลังประมวลผลงาน AI ก่อนหน้าอยู่ จึงยังไม่ได้อ่านเอกสารนี้ — เก็บเอกสารแล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้ |
| workspace dictionary: `expenses.extract_failed` | อ่านข้อมูลไม่สำเร็จค่ะ เก็บไฟล์ไว้แล้ว กรอกข้อมูลต่อได้ในหน้านี้ | อ่านข้อมูลไม่สำเร็จค่ะ เก็บไฟล์ไว้แล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้ |
| workspace dictionary: `expenses.upload_unsupported_file` | รองรับเฉพาะไฟล์ JPG/JPEG, PNG, HEIC/HEIF หรือ PDF | รองรับเฉพาะไฟล์ PDF หรือรูปภาพ (เจเพ็ก, พีเอ็นจี, ฮีอิก, ฮีฟ, กิฟ) |
| workspace dictionary: `expenses.upload_heic_unsupported` | แปลงไฟล์ HEIC ไม่สำเร็จ ไฟล์อาจเสียหาย — กรุณาส่งรูปเป็น JPG หรือ PNG | แปลงรูปไม่สำเร็จ กรุณาบันทึกรูปเป็นรูปภาพ (เจเพ็ก, พีเอ็นจี) แล้วลองอีกครั้ง |
| workspace dictionary: `expenses.upload_extract_failed_suffix` | เก็บไฟล์ไว้แล้ว กรอกข้อมูลต่อได้ในหน้านี้ | เก็บไฟล์ไว้แล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้ |
| workspace dictionary: `expenses.capture.read_partial` | อ่านข้อมูลได้บางส่วน เก็บไฟล์ไว้แล้ว กรอกข้อมูลส่วนที่ขาดต่อได้ในหน้านี้ | อ่านข้อมูลได้บางส่วนค่ะ เก็บไฟล์ไว้แล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้ |
| workspace dictionary: `expenses.capture.read_failed` | อ่านข้อมูลไม่สำเร็จค่ะ เก็บไฟล์ไว้แล้ว กรอกข้อมูลต่อได้ในหน้านี้ | อ่านข้อมูลไม่สำเร็จค่ะ เก็บไฟล์ไว้แล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้ |
| workspace dictionary: `expenses.capture.read_paused` | เก็บไฟล์ไว้แล้ว แต่ยังอ่านข้อมูลไม่ครบ กรอกข้อมูลส่วนที่ขาดต่อได้ในหน้านี้ | เก็บไฟล์ไว้แล้ว แต่ยังอ่านข้อมูลไม่ครบ ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้ |
| workspace dictionary: `expenses.upload_dropzone_hint` | รองรับ JPG/JPEG PNG HEIC (รูปจากไอโฟน) หรือ PDF · รูปใหญ่จะถูกย่ออัตโนมัติ · หรือส่งจาก LINE ได้เลย | รองรับ PDF หรือรูปภาพ (เจเพ็ก, พีเอ็นจี, ฮีอิก, ฮีฟ, กิฟ) · รูปใหญ่จะถูกย่ออัตโนมัติ |
| workspace dictionary: `expenses.signature_applied` | ประทับลายเซ็นแล้ว (บันทึกผู้ทำรายการ/เวลาไว้ใน audit) | ประทับลายเซ็นแล้ว (บันทึกผู้ทำรายการและเวลาไว้ในประวัติ) |
| workspace dictionary: `expenses.col_expense_number` | เลขรายจ่าย (EXP) | เลขรายจ่าย |
| workspace dictionary: `expenses.category_default_tax_code` | (new) | รหัสภาษีเริ่มต้น |
| workspace dictionary: `expenses.substitute_wizard.business_purpose_placeholder` | เช่น เดินทางไปพบลูกค้าโครงการ A เพื่อเก็บความต้องการ | เช่น เดินทางไปพบลูกค้าเพื่อสอบถามความต้องการ |
| workspace dictionary: `expenses.substitute_wizard.signature_help` | ระบบจะฝังไฟล์ PNG โปร่งใสที่ตรวจสอบแล้วลงในเอกสารฉบับนี้ | ระบบจะใส่รูปลายเซ็นพื้นหลังโปร่งใสที่ตรวจสอบแล้วลงในเอกสารฉบับนี้ |
| workspace dictionary: `expenses.substitute_wizard.signature_required` | กรุณาเลือกไฟล์ลายมือชื่อ PNG หรือ JPEG | กรุณาเลือกไฟล์ลายมือชื่อเป็นรูปภาพ (เจเพ็ก, พีเอ็นจี) |
| workspace dictionary: `counterparties.forbidden_help` | ขอสิทธิ์ ดูทะเบียนคู่ค้า จากเจ้าของหรือผู้ดูแลระบบ แล้วเปิดหน้านี้อีกครั้ง ระหว่างนี้ยังพิมพ์ที่อยู่ผู้ขายบนหน้าตรวจรายจ่ายได้ตามปกติ | ขอสิทธิ์ดูทะเบียนคู่ค้าจากเจ้าของกิจการหรือผู้มีสิทธิ์จัดการบทบาท แล้วเปิดหน้านี้อีกครั้ง ผู้มีสิทธิ์แก้ไขรายจ่ายยังกรอกที่อยู่ผู้ขายบนหน้าตรวจรายจ่ายได้ |
| workspace dictionary: `counterparties.read_only` | ดูอย่างเดียว ขอสิทธิ์ จัดการคู่ค้า จากเจ้าของหรือผู้ดูแลระบบจึงจะแก้ไขได้ | ดูอย่างเดียว ขอสิทธิ์จัดการคู่ค้าจากเจ้าของกิจการหรือผู้มีสิทธิ์จัดการบทบาทจึงจะแก้ไขได้ |
| API error: `BILLING_RECIPIENT_NO_CUSTOMER` | บริษัทนี้ยังไม่มีบัญชีลูกค้าใน Stripe จึงยังไม่มีผู้รับเอกสารให้เปลี่ยน | บริษัทนี้ยังไม่มีบัญชีลูกค้ากับผู้ให้บริการรับชำระเงิน จึงยังไม่มีผู้รับเอกสารให้เปลี่ยน |
| API error: `EMAIL_OTP_REQUIRED` | กรุณาโหลดหน้านี้ใหม่เพื่อยืนยันอีเมลด้วยรหัส OTP | กรุณาโหลดหน้านี้ใหม่เพื่อยืนยันอีเมลด้วยรหัสยืนยัน |
| API error: `BILLING_CHECKOUT_PENDING` | ระบบกำลังตรวจรายการชำระเงินเดิมกับ Stripe กรุณารอสักครู่แล้วกดอัปเดตข้อมูล | ระบบกำลังตรวจรายการชำระเงินเดิมกับผู้ให้บริการรับชำระเงิน กรุณารอสักครู่แล้วกดอัปเดตข้อมูล |
| API error: `BILLING_DOCUMENT_BINDING` | ข้อมูลรายการนี้ยังยืนยันกับ Stripe ไม่ได้ กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง | ข้อมูลรายการนี้ยังยืนยันกับผู้ให้บริการรับชำระเงินไม่ได้ กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง |
| API error: `BILLING_MAPPING_MISMATCH` | ข้อมูลการชำระเงินของร้านไม่ตรงกับ Stripe กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง | ข้อมูลการชำระเงินของร้านไม่ตรงกับผู้ให้บริการรับชำระเงิน กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง |
| API error: `BILLING_PRICE_MISMATCH` | ราคาในระบบไม่ตรงกับ Stripe กรุณาลองใหม่ภายหลัง หากยังไม่ได้ให้ติดต่อทีมงาน | ราคาในระบบไม่ตรงกับผู้ให้บริการรับชำระเงิน กรุณาลองใหม่ภายหลัง หากยังไม่ได้ให้ติดต่อทีมงาน |
| API error: `BILLING_DOCUMENT_PENDING` | Stripe กำลังเตรียมเอกสาร กรุณาลองเปิดอีกครั้ง | ผู้ให้บริการรับชำระเงินกำลังเตรียมเอกสาร กรุณาลองเปิดอีกครั้ง |
| API error: `output_tax_code_line_mismatch` | Tax Code ที่หัวเอกสารไม่ตรงกับรายการภาษี กรุณาตรวจ Tax Code ก่อนบันทึก | รหัสภาษีที่หัวเอกสารไม่ตรงกับรายการภาษี กรุณาตรวจรหัสภาษีก่อนบันทึก |
| API error: `expense_confirmation_tax_line_changed` | รายการภาษีเปลี่ยนไประหว่างยืนยัน กรุณาตรวจ Tax Code แล้วลองอีกครั้ง | รายการภาษีเปลี่ยนไประหว่างยืนยัน กรุณาตรวจรหัสภาษีแล้วลองอีกครั้ง |
| API error: `EXPENSE_VAT_TAX_TOLERANCE_REQUIRED` | VAT ตามเอกสารต่างเกินเกณฑ์ของ Tax Code กรุณาตรวจเอกสารและ Tax Code ก่อนยืนยัน การเลือกใช้ยอดตามเอกสารไม่สามารถข้ามเกณฑ์ภาษีนี้ได้ | VAT ตามเอกสารต่างเกินเกณฑ์ของรหัสภาษี กรุณาตรวจเอกสารและรหัสภาษีก่อนยืนยัน การเลือกใช้ยอดตามเอกสารไม่สามารถข้ามเกณฑ์ภาษีนี้ได้ |
| API error: `EXPENSE_VAT_TAX_RATE_CONFLICT` | อัตรา VAT ของรายการไม่ตรงกับ Tax Code กรุณาแก้อัตราหรือเลือก Tax Code ให้ตรงกับเอกสารก่อนยืนยัน | อัตรา VAT ของรายการไม่ตรงกับรหัสภาษี กรุณาแก้อัตราหรือเลือกรหัสภาษีให้ตรงกับเอกสารก่อนยืนยัน |
| API error: `expense_confirmation_accepted_vat_changed` | ยอด VAT ขั้นสุดท้ายไม่ตรงกับยอดที่ยอมรับ กรุณาตรวจเอกสารและ Tax Code อีกครั้ง ยังไม่มีการยืนยันรายการ | ยอด VAT ขั้นสุดท้ายไม่ตรงกับยอดที่ยอมรับ กรุณาตรวจเอกสารและรหัสภาษีอีกครั้ง ยังไม่มีการยืนยันรายการ |
| API error: `substitute_evidence_locks_lines` | ใบรับรองแทนใบเสร็จที่ลงนามแล้วล็อกรายการไว้ ต้องจัดทำ version แก้ไขก่อนจึงจะแก้ได้ | ใบรับรองแทนใบเสร็จที่ลงนามแล้วล็อกรายการไว้ ต้องจัดทำฉบับแก้ไขก่อนจึงจะแก้ได้ |
| API error: `substitute_evidence_locks_expense` | ใบรับรองแทนใบเสร็จที่ลงนามแล้วล็อกข้อมูลเอกสารไว้ ต้องจัดทำ version แก้ไขก่อนจึงจะแก้ได้ | ใบรับรองแทนใบเสร็จที่ลงนามแล้วล็อกข้อมูลเอกสารไว้ ต้องจัดทำฉบับแก้ไขก่อนจึงจะแก้ได้ |
| API error: `currency_not_supported` | ขณะนี้ใบรับรองแทนใบเสร็จรองรับเฉพาะรายการสกุลเงินบาท (THB) | ขณะนี้ใบรับรองแทนใบเสร็จรองรับเฉพาะรายการสกุลเงินบาท |
| API error: `claim_signature_must_be_png_or_jpeg_max_2mb` | ไฟล์ลายเซ็นต้องเป็น PNG หรือ JPEG ขนาดไม่เกิน 2 MB | ไฟล์ลายเซ็นต้องเป็นรูปภาพ (เจเพ็ก, พีเอ็นจี) ขนาดไม่เกิน 2 เมกะไบต์ |
| API error: `claim_signature_too_large` | ไฟล์ลายเซ็นใหญ่เกิน 2 MB กรุณาย่อขนาดแล้วอัปโหลดใหม่ | ไฟล์ลายเซ็นใหญ่เกิน 2 เมกะไบต์ กรุณาย่อขนาดแล้วอัปโหลดใหม่ |
| API error: `claim_signature_bytes_mismatch` | ไฟล์ลายเซ็นไม่ใช่รูปภาพตามชนิดที่ระบุ กรุณาอัปโหลดไฟล์ PNG หรือ JPEG | ไฟล์ลายเซ็นไม่ใช่รูปภาพตามชนิดที่ระบุ กรุณาอัปโหลดรูปภาพ (เจเพ็ก, พีเอ็นจี) |
| API error: `payment_slip_invalid` | ไฟล์สลิปใช้ไม่ได้ เลือกไฟล์ PDF หรือรูปภาพ ขนาดไม่เกิน 10 MB แล้วลองใหม่ | ไฟล์สลิปใช้ไม่ได้ เลือกไฟล์ PDF หรือรูปภาพที่รองรับ ขนาดไม่เกิน 10 เมกะไบต์ แล้วลองใหม่ |
| API error: `invalid_username` | ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 จุด ขีด และขีดล่าง ยาว 4 ถึง 64 ตัว (ภาษาไทยใช้ไม่ได้ค่ะ) | ชื่อผู้ใช้ใช้ได้เฉพาะตัวอักษรอังกฤษพิมพ์เล็ก ตัวเลข จุด ขีด และขีดล่าง ยาว 4 ถึง 64 ตัว (ภาษาไทยใช้ไม่ได้ค่ะ) |
| API error: `company_business_type_invalid` | เลือกประเภทธุรกิจจากรายการ DBD หรือเลือกอื่น ๆ | เลือกประเภทธุรกิจจากรายการของกรมพัฒนาธุรกิจการค้า หรือเลือกอื่น ๆ |
| API error: `legacy_o0_tax_review_required` | รายการภาษีอัตรา 0% ต้องระบุเหตุผลและใช้ Tax Code ที่ตรวจสอบแล้วก่อนลงบัญชี | รายการภาษีอัตรา 0% ต้องระบุเหตุผลและใช้รหัสภาษีที่ตรวจสอบแล้วก่อนลงบัญชี |
| API error: `legacy_tax_snapshot_review_required` | ข้อมูลภาษีเดิมยังไม่ผ่านการตรวจสอบ กรุณาตรวจ Tax Code ของรายการก่อนลงบัญชี | ข้อมูลภาษีเดิมยังไม่ผ่านการตรวจสอบ กรุณาตรวจรหัสภาษีของรายการก่อนลงบัญชี |
| API error: `tax_code_import_blocked` | ยังนำเข้า Tax Code ไม่ได้ กรุณาแก้ข้อผิดพลาดในตัวอย่างก่อนยืนยัน | ยังนำเข้ารหัสภาษีไม่ได้ กรุณาแก้ข้อผิดพลาดในตัวอย่างก่อนยืนยัน |
| API error: `invalid_tax_code_definition` | ข้อมูล Tax Code ไม่ถูกต้อง กรุณาตรวจรหัส อัตรา และเงื่อนไข | ข้อมูลรหัสภาษีไม่ถูกต้อง กรุณาตรวจรหัส อัตรา และเงื่อนไข |
| API error: `missing_account_rule` | Tax Code นี้ยังไม่มีกฎผูกบัญชีที่จำเป็น กรุณาตั้งค่าบัญชีให้ครบ | รหัสภาษีนี้ยังไม่มีกฎผูกบัญชีที่จำเป็น กรุณาตั้งค่าบัญชีให้ครบ |
| API error: `missing_report_rule` | Tax Code นี้ยังไม่มีกฎลงแบบภาษีที่จำเป็น กรุณาตั้งค่าช่องรายงานให้ครบ | รหัสภาษีนี้ยังไม่มีกฎลงแบบภาษีที่จำเป็น กรุณาตั้งค่าช่องรายงานให้ครบ |
| API error: `profile_has_no_definitions` | ชุดตั้งค่าภาษียังไม่มี Tax Code กรุณาเพิ่มอย่างน้อยหนึ่งรายการ | ชุดตั้งค่าภาษียังไม่มีรหัสภาษี กรุณาเพิ่มอย่างน้อยหนึ่งรายการ |
| API error: `invalid_tax_code_semantics` | ความหมายหรือเงื่อนไขของ Tax Code ขัดกัน กรุณาตรวจประเภทภาษีและอัตรา | ความหมายหรือเงื่อนไขของรหัสภาษีขัดกัน กรุณาตรวจประเภทภาษีและอัตรา |
| API error: `Branch code must be 1-20 uppercase alphanumeric characters, underscores, or hyphens.` | รหัสสาขาต้องยาว 1–20 ตัว ใช้ A–Z, 0–9, ขีดกลาง หรือขีดล่างเท่านั้น | รหัสสาขาต้องยาว 1–20 ตัว ใช้ตัวอักษรอังกฤษพิมพ์ใหญ่ ตัวเลข ขีดกลาง หรือขีดล่างเท่านั้น |
| API error: `Every VAT-bearing expense line requires a server-resolved Tax Code snapshot before confirmation.` | ทุกบรรทัดที่มี VAT ต้องเลือก Tax Code ก่อนยืนยันลงบัญชี | ทุกบรรทัดที่มี VAT ต้องเลือกรหัสภาษีก่อนยืนยันลงบัญชี |
| API error: `Current company policy requires separate payment evidence for cash expenses. Supersede and prepare a new version.` | นโยบายบริษัทกำหนดให้รายการเงินสดต้องมีหลักฐานการจ่ายแยกไฟล์ กรุณายกเลิก version นี้แล้วจัดทำ version ใหม่ | นโยบายบริษัทกำหนดให้รายการเงินสดต้องมีหลักฐานการจ่ายแยกไฟล์ กรุณายกเลิกฉบับนี้แล้วจัดทำฉบับใหม่ |
| API error: `ใบรับรองแทนใบเสร็จรับเงิน currently supports THB expenses only.` | ใบรับรองแทนใบเสร็จรับเงินรองรับเฉพาะรายการสกุลเงินบาท (THB) | ใบรับรองแทนใบเสร็จรับเงินรองรับเฉพาะรายการสกุลเงินบาท |
| API error: `Linked source/payment evidence changed. Finance must prepare a new version.` | หลักฐานที่ผูกไว้ถูกเปลี่ยน การเงินต้องจัดทำ version ใหม่ | หลักฐานที่ผูกไว้ถูกเปลี่ยน การเงินต้องจัดทำฉบับใหม่ |
| API error: `Expense details changed after preparation. Finance must prepare a new version.` | ข้อมูลเอกสารถูกแก้ไขหลังจัดทำ การเงินต้องจัดทำ version ใหม่ | ข้อมูลเอกสารถูกแก้ไขหลังจัดทำ การเงินต้องจัดทำฉบับใหม่ |
| API error: `The certified payer signature checksum is missing.` | ไม่พบข้อมูลตรวจสอบลายเซ็นของผู้จ่ายที่รับรองแล้ว กรุณาจัดทำ version ใหม่ | ไม่พบข้อมูลตรวจสอบลายเซ็นของผู้จ่ายที่รับรองแล้ว กรุณาจัดทำฉบับใหม่ |
| API error: `The payer signature changed after certification.` | ลายเซ็นผู้จ่ายถูกเปลี่ยนหลังการรับรอง กรุณาจัดทำ version ใหม่ | ลายเซ็นผู้จ่ายถูกเปลี่ยนหลังการรับรอง กรุณาจัดทำฉบับใหม่ |
| API error: `Certified snapshot checksum is invalid.` | ข้อมูลรับรองไม่สมบูรณ์ กรุณาจัดทำ version ใหม่ | ข้อมูลรับรองไม่สมบูรณ์ กรุณาจัดทำฉบับใหม่ |
| API error: `Substitute evidence changed while superseding.` | ใบรับรองแทนใบเสร็จถูกเปลี่ยนระหว่างยกเลิก version กรุณาเปิดใหม่แล้วลองอีกครั้ง | ใบรับรองแทนใบเสร็จถูกเปลี่ยนระหว่างยกเลิกฉบับ กรุณาเปิดใหม่แล้วลองอีกครั้ง |
| API error: `Per-certificate signature must be a PNG/JPEG file up to 2 MB.` | ไฟล์ลายเซ็นต้องเป็น PNG/JPEG ขนาดไม่เกิน 2 MB | ไฟล์ลายเซ็นต้องเป็นรูปภาพ (เจเพ็ก, พีเอ็นจี) ขนาดไม่เกิน 2 เมกะไบต์ |
| API error: `Signature image must be at most 2 MB.` | ไฟล์ลายเซ็นต้องมีขนาดไม่เกิน 2 MB | ไฟล์ลายเซ็นต้องมีขนาดไม่เกิน 2 เมกะไบต์ |
| API error: `A receipt, substitute receipt, or supporting-only document cannot retain a Tax Code.` | ใบเสร็จ ใบรับรองแทน หรือหลักฐานประกอบ ใช้ Tax Code ไม่ได้ (ต้องเป็นใบกำกับภาษี) | ใบเสร็จ ใบรับรองแทน หรือหลักฐานประกอบ ใช้รหัสภาษีไม่ได้ (ต้องเป็นใบกำกับภาษี) |
| API error: `Remove the existing Tax Code lines before classifying this document as a receipt, substitute receipt, or supporting-only evidence.` | กรุณานำ Tax Code ออกจากรายการก่อนจัดประเภทเอกสารเป็นใบเสร็จ/ใบรับรองแทน/หลักฐานประกอบ | กรุณานำรหัสภาษีออกจากรายการก่อนจัดประเภทเอกสารเป็นใบเสร็จ/ใบรับรองแทน/หลักฐานประกอบ |
| API error: `Uploaded object MIME type does not match attachment metadata.` | ไฟล์นี้มีชนิดไฟล์ไม่ตรงกับข้อมูลภายใน ระบบจึงแนบไม่ได้ กรุณาเลือกไฟล์ใหม่ หรือบันทึกเป็น PDF/JPG/PNG แล้วลองอีกครั้ง | ไฟล์นี้มีชนิดไฟล์ไม่ตรงกับข้อมูลภายใน ระบบจึงแนบไม่ได้ กรุณาเลือกไฟล์ใหม่ หรือบันทึกเป็น PDF หรือรูปภาพ (เจเพ็ก, พีเอ็นจี) แล้วลองอีกครั้ง |
| API error: `Uploaded bytes have an unexpected MIME type.` | ไฟล์นี้มีชนิดไฟล์ไม่ตรงกับข้อมูลภายใน ระบบจึงแนบไม่ได้ กรุณาเลือกไฟล์ใหม่ หรือบันทึกเป็น PDF/JPG/PNG แล้วลองอีกครั้ง | ไฟล์นี้มีชนิดไฟล์ไม่ตรงกับข้อมูลภายใน ระบบจึงแนบไม่ได้ กรุณาเลือกไฟล์ใหม่ หรือบันทึกเป็น PDF หรือรูปภาพ (เจเพ็ก, พีเอ็นจี) แล้วลองอีกครั้ง |
| API error: `File signature does not match the declared MIME type.` | ไฟล์นี้มีชนิดไฟล์ไม่ตรงกับข้อมูลภายใน ระบบจึงแนบไม่ได้ กรุณาเลือกไฟล์ใหม่ หรือบันทึกเป็น PDF/JPG/PNG แล้วลองอีกครั้ง | ไฟล์นี้มีชนิดไฟล์ไม่ตรงกับข้อมูลภายใน ระบบจึงแนบไม่ได้ กรุณาเลือกไฟล์ใหม่ หรือบันทึกเป็น PDF หรือรูปภาพ (เจเพ็ก, พีเอ็นจี) แล้วลองอีกครั้ง |

The new English-locale entries are `auth.email_access.title = Sign in with an email code` and `expenses.category_default_tax_code = Default tax code`; the Thai rows above are the shop copy requested in this lane.

## Words changed — component and LINE fragments

Rows group adjacent changed fragments in source order. Repeated dictionary values are included where they are consumed. Shared labels are expanded where static; brace expressions describe runtime data. A removed duplicate that now calls the API translator uses the corresponding shared sentence in the table above. Source paths and line numbers are for locating the existing conditional branch, not user-visible copy.

| Where / existing case | Old text or fragments | New text or fragments |
|---|---|---|
| `apps/ai-gateway/src/modules/line-ai/agents/accounting-summary.agent.ts:517` | ไม่พบข้อมูลบัญชี (endpoint ยังไม่พร้อม) | ยังไม่มีข้อมูลที่พร้อมแสดงในขณะนี้ |
| `apps/ai-gateway/src/modules/line-ai/agents/mangmee-joke-bank.ts:54` | เป็นเจ้าของร้านนี่เหมือนนางเอกซีรีส์เลยนะคะ โดนมรสุมทุก EP แต่ตอนจบต้องแฮปปี้ค่ะ สู้ ๆ นะคะ 💚 | เป็นเจ้าของร้านนี่เหมือนนางเอกซีรีส์เลยนะคะ โดนมรสุมทุกตอน แต่ตอนจบต้องแฮปปี้ค่ะ สู้ ๆ นะคะ 💚 |
| `apps/ai-gateway/src/modules/line-ai/agents/mangmee-joke-bank.ts:55` | วันจันทร์นี่เหมือน EP แรกของซีซั่นใหม่เลยค่ะ เปิดเรื่องมาปมเยอะหน่อย แต่ดูไปเรื่อย ๆ เดี๋ยวก็สนุกเองนะคะ | วันจันทร์นี่เหมือนตอนแรกของซีซั่นใหม่เลยค่ะ เปิดเรื่องมาปมเยอะหน่อย แต่ดูไปเรื่อย ๆ เดี๋ยวก็สนุกเองนะคะ |
| `apps/ai-gateway/src/modules/line-ai/agents/mangmee-joke-bank.ts:75` | วันนี้เหนื่อยไหมคะ อย่าลืมว่าเจ้าของร้านคือ center ของร้านนี้เลยนะ แฟนคลับ (น้องมั่งมี) เป็นกำลังใจให้ค่ะ 💚 | วันนี้เหนื่อยไหมคะ อย่าลืมว่าเจ้าของร้านคือคนสำคัญของร้านนี้เลยนะ แฟนคลับ (น้องมั่งมี) เป็นกำลังใจให้ค่ะ 💚 |
| `apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts:76` | Fandom banter is welcome in GENRE terms — ซีรีส์/ละคร, วายไทย, ยุทธภพ/เทพเซียน, ไอดอล tropes such as มรสุมทุก EP, คู่จิ้น, ฝึกวิชา, or center — but NEVER volunteer the name of a real person, group, show, or brand yourself. When the user names one and asks for its current news or status, the live-facts rule below applies; add no staleness disclaimer of any kind. | Fandom banter is welcome in GENRE terms — ซีรีส์/ละคร, วายไทย, ยุทธภพ/เทพเซียน, ไอดอล tropes such as มรสุมทุกตอน, คู่จิ้น, ฝึกวิชา, or คนสำคัญ — but NEVER volunteer the name of a real person, group, show, or brand yourself. When the user names one and asks for its current news or status, the live-facts rule below applies; add no staleness disclaimer of any kind. |
| `apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts:134` | ตอนนี้บัญชีของคุณยังไม่มีข้อมูลที่น้องมั่งมีดึงให้ผ่าน LINE ได้เลยค่ะ กรุณาติดต่อผู้ดูแลระบบของบริษัทเพื่อตรวจสอบสิทธิ์การใช้งานนะคะ | ตอนนี้บัญชีของคุณยังไม่มีรายการที่น้องมั่งมีเปิดให้ผ่าน LINE ได้ค่ะ กรุณาให้ผู้มีสิทธิ์จัดการบทบาทตรวจสิทธิ์ของคุณ และให้ผู้มีสิทธิ์จัดการแพ็กเกจตรวจเมนูที่ร้านเปิดใช้นะคะ |
| `apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts:367` | 📋 บริษัทนี้ยังไม่ได้เปิดใช้งาน{joined}ค่ะ หากต้องการใช้ ให้เจ้าของหรือผู้ดูแลเปิดฟีเจอร์ในเว็บแอปก่อนนะคะ | 📋 บริษัทนี้ยังไม่ได้เปิดใช้งาน{joined}ค่ะ หากต้องการใช้ ให้ผู้มีสิทธิ์จัดการแพ็กเกจตรวจแพ็กเกจหรือติดต่อทีมงานนะคะ |
| `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:476` | 📋 บริษัทนี้ยังไม่ได้เปิดใช้งานระบบค่าใช้จ่ายและเอกสารค่ะ หากต้องการใช้ ให้เจ้าของหรือผู้ดูแลเปิดฟีเจอร์ในเว็บแอปก่อนนะคะ | 📋 บริษัทนี้ยังไม่ได้เปิดใช้งานระบบค่าใช้จ่ายและเอกสารค่ะ หากต้องการใช้ ให้ผู้มีสิทธิ์จัดการแพ็กเกจตรวจแพ็กเกจหรือติดต่อทีมงานนะคะ |
| `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:506` | 🔒 น้องมั่งมีไม่สามารถทำรายการอนุมัติ/จ่ายเงิน/ลงบัญชี หรือยื่นภาษีได้ค่ะ กรุณาทำรายการในเว็บแอป MangmeePlus นะคะ | 🔒 น้องมั่งมีไม่สามารถทำรายการอนุมัติ/จ่ายเงิน/ลงบัญชี หรือยื่นภาษีได้ค่ะ กรุณาทำรายการในเว็บมั่งมีนะคะ |
| `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:508` | ⚠️ ไม่สามารถรับไฟล์นี้ได้ค่ะ กรุณาส่งไฟล์ PDF, PNG, JPG หรือ JPEG ที่ไฟล์ไม่เสียหายและผ่านการตรวจสอบความปลอดภัยนะคะ | ⚠️ ไม่สามารถรับไฟล์นี้ได้ค่ะ กรุณาส่งไฟล์ PDF หรือรูปภาพ (เจเพ็ก, พีเอ็นจี) ที่ไฟล์ไม่เสียหายและผ่านการตรวจสอบความปลอดภัยนะคะ |
| `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:8683` | 🔒 น้องมั่งมีไม่สามารถทำรายการอนุมัติ/จ่ายเงิน/ลงบัญชี หรือยื่นภาษีได้ค่ะ กรุณาทำรายการในเว็บแอป MangmeePlus นะคะ | 🔒 น้องมั่งมีไม่สามารถทำรายการอนุมัติ/จ่ายเงิน/ลงบัญชี หรือยื่นภาษีได้ค่ะ กรุณาทำรายการในเว็บมั่งมีนะคะ |
| `apps/api/src/modules/line-ai/domain/logic/line-ai-capability-follow-up.logic.ts:97` | ตอนนี้บัญชีของคุณยังไม่มีข้อมูลที่น้องมั่งมีดึงให้ผ่าน LINE ได้เลยค่ะ กรุณาติดต่อผู้ดูแลระบบของบริษัทเพื่อตรวจสอบสิทธิ์การใช้งานนะคะ | ตอนนี้บัญชีของคุณยังไม่มีรายการที่น้องมั่งมีเปิดให้ผ่าน LINE ได้ค่ะ กรุณาให้ผู้มีสิทธิ์จัดการบทบาทตรวจสิทธิ์ของคุณ และให้ผู้มีสิทธิ์จัดการแพ็กเกจตรวจเมนูที่ร้านเปิดใช้นะคะ |
| `apps/api/src/modules/line-ai/domain/logic/line-file-attempt-answer.logic.ts:122` | ไฟล์ {attempt.fileNameSanitized ?? 'ที่ส่งมา'} ขนาด {megabytes(measured)} MB<br>เกินขนาดที่ระบบรับได้ {megabytes(limit)} MB จึงยังไม่ได้เก็บไฟล์นี้ — | ไฟล์ {attempt.fileNameSanitized ?? 'ที่ส่งมา'} ขนาด {expenseCaptureMegabytes(measured)}<br>เกินขนาดที่ระบบรับได้ {expenseCaptureMegabytes(limit)} จึงยังไม่ได้เก็บไฟล์นี้ — |
| `apps/api/src/modules/line-ai/domain/logic/line-file-attempt-answer.logic.ts:129` | — (shared wording added) | PDF หรือรูปภาพ (เจเพ็ก, พีเอ็นจี) |
| `apps/api/src/modules/line-ai/domain/logic/line-file-attempt-answer.logic.ts:152` | เก็บ{namedInline(attempt)}ไว้แล้วค่ะ แต่อ่านข้อมูลไม่สำเร็จ กดกรอกข้อมูลต่อได้ที่นี่{link \|\| ''}<br>เก็บ{namedInline(attempt)}ไว้แล้วค่ะ แต่ยังอ่านข้อมูลไม่ครบ กดกรอกข้อมูลส่วนที่ขาดต่อได้ที่นี่{link \|\| ''} | เก็บ{namedInline(attempt)}ไว้แล้วค่ะ แต่อ่านข้อมูลไม่สำเร็จ ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้{link \|\| ''}<br>เก็บ{namedInline(attempt)}ไว้แล้วค่ะ แต่ยังอ่านข้อมูลไม่ครบ ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้{link \|\| ''} |
| `apps/api/src/modules/line-ai/domain/logic/line-file-attempt-answer.logic.ts:172` | — (shared wording added) | ไฟล์ชนิดที่ระบบรองรับ |
| `apps/api/src/modules/line-ai/domain/logic/line-non-receipt-reply.logic.ts:28` | เก็บไฟล์ไว้ในรายการร่างแล้ว ยังไม่ยืนยัน กดกรอกข้อมูลต่อได้ที่นี่: {link}<br>กรอกข้อมูลต่อได้ที่นี่: {link} | เก็บไฟล์ไว้ในรายการร่างแล้ว ยังไม่ยืนยัน ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้: {link}<br>ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้: {link} |
| `apps/api/src/modules/line-ai/domain/logic/line-non-receipt-reply.logic.ts:155` | อ่านข้อมูลไม่สำเร็จค่ะ เก็บไฟล์ไว้แล้ว กดกรอกข้อมูลต่อได้ที่นี่ {link}<br>อ่านข้อมูลได้บางส่วนค่ะ เก็บไฟล์ไว้แล้ว กดกรอกข้อมูลส่วนที่ขาดต่อได้ที่นี่ {link} | อ่านข้อมูลไม่สำเร็จค่ะ เก็บไฟล์ไว้แล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้ {link}<br>อ่านข้อมูลได้บางส่วนค่ะ เก็บไฟล์ไว้แล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้ {link} |
| `apps/api/src/modules/line-ai/domain/logic/line-non-receipt-reply.logic.ts:162` | กดกรอกข้อมูลส่วนที่ขาดต่อได้ที่นี่ {link} | ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้ {link} |
| `apps/web/src/common/files/upload-file.logic.ts:12` | ไฟล์นี้มีชนิดไฟล์ไม่ตรงกับข้อมูลภายใน ระบบจึงแนบไม่ได้ กรุณาเลือกไฟล์ใหม่ หรือบันทึกเป็น PDF/JPG/PNG แล้วลองอีกครั้ง<br>ระบบอ่านรูปนี้ไม่ได้ กรุณาเลือกรูปใหม่ หรือบันทึกเป็น JPG/PNG แล้วลองอีกครั้ง<br>แปลงรูป HEIC/HEIF ไม่สำเร็จ กรุณาบันทึกรูปเป็น JPG/PNG แล้วลองอีกครั้ง<br>รองรับเฉพาะไฟล์ PDF, JPG/JPEG, PNG, HEIC/HEIF และ GIF<br>รองรับเฉพาะไฟล์ JPG/JPEG, PNG, HEIC/HEIF และ GIF<br>รองรับเฉพาะไฟล์ PNG, JPG และ JPEG<br>รองรับเฉพาะไฟล์ PDF, PNG, JPG และ JPEG | ระบบอ่านรูปนี้ไม่ได้ กรุณาเลือกรูปใหม่ หรือบันทึกเป็นรูปภาพ (เจเพ็ก, พีเอ็นจี) แล้วลองอีกครั้ง<br>รองรับเฉพาะไฟล์ PDF หรือรูปภาพ (เจเพ็ก, พีเอ็นจี, ฮีอิก, ฮีฟ, กิฟ)<br>รองรับเฉพาะไฟล์ รูปภาพ (เจเพ็ก, พีเอ็นจี, ฮีอิก, ฮีฟ, กิฟ)<br>รองรับเฉพาะไฟล์ รูปภาพ (เจเพ็ก, พีเอ็นจี)<br>รองรับเฉพาะไฟล์ PDF หรือรูปภาพ (เจเพ็ก, พีเอ็นจี) |
| `apps/web/src/features/auth/AccountEmailOtpPanel.tsx:11` | ยืนยันรหัส OTP | กรอกรหัสยืนยัน |
| `apps/web/src/features/auth/AccountEmailOtpPanel.tsx:133` | ยืนยันตัวตนผ่าน LINE ทำในเบราว์เซอร์ของ LINE ไม่ได้ กรุณาเปิดหน้านี้ใน Safari หรือ Chrome ก่อน<br>เปิดหน้านี้ใน Safari/Chrome | ยืนยันตัวตนผ่าน LINE ทำในเบราว์เซอร์ของ LINE ไม่ได้ กรุณาเปิดหน้านี้ในเบราว์เซอร์ภายนอกก่อน<br>เปิดหน้านี้ในเบราว์เซอร์ภายนอก |
| `apps/web/src/features/auth/AccountEmailOtpPanel.tsx:140` | ใช้เข้าสู่ระบบด้วยรหัส OTP และรับแจ้งเตือนบัญชี · ถ้ายืนยันแล้ว การซื้อครั้งแรกจะใช้อีเมลนี้รับเอกสาร · เปลี่ยนอีเมลรับเอกสารได้ที่หน้าแพ็กเกจ | ใช้เข้าสู่ระบบด้วยรหัสยืนยัน และรับแจ้งเตือนบัญชี · ถ้ายืนยันแล้ว การซื้อครั้งแรกจะใช้อีเมลนี้รับเอกสาร · เปลี่ยนอีเมลรับเอกสารได้ที่หน้าแพ็กเกจ |
| `apps/web/src/features/auth/AccountEmailOtpPanel.tsx:180` | ยืนยันตัวตนเพื่อส่งรหัส OTP 6 หลักไปที่ | ยืนยันตัวตนเพื่อส่งรหัสยืนยัน 6 หลักไปที่ |
| `apps/web/src/features/auth/AccountEmailOtpPanel.tsx:195` | เมื่อเปิดใช้งาน ระบบจะส่งรหัสยืนยันแบบใช้ครั้งเดียว (OTP) 6 หลักไปที่อีเมลของคุณทุกครั้งที่เข้าสู่ระบบ ใช้รหัสนี้แทนรหัสผ่าน | เมื่อเปิดใช้งาน ระบบจะส่งรหัสยืนยันแบบใช้ครั้งเดียว 6 หลักไปที่อีเมลของคุณทุกครั้งที่เข้าสู่ระบบ ใช้รหัสนี้แทนรหัสผ่าน |
| `apps/web/src/features/auth/EmailAccessPage.tsx:74` | เข้าสู่ระบบด้วยรหัส OTP<br>กรอกอีเมลเพื่อรับรหัสยืนยันแบบใช้ครั้งเดียว (OTP) 6 หลัก แล้วนำรหัสมากรอกในขั้นตอนถัดไป | เข้าสู่ระบบด้วยรหัสยืนยัน<br>กรอกอีเมลเพื่อรับรหัสยืนยันแบบใช้ครั้งเดียว 6 หลัก แล้วนำรหัสมากรอกในขั้นตอนถัดไป |
| `apps/web/src/features/auth/EmailAccessPage.tsx:79` | ส่งรหัส OTP ไปที่อีเมล | ส่งรหัสยืนยัน ไปที่อีเมล |
| `apps/web/src/features/auth/EmailAccessPage.tsx:99` | ยืนยันอีเมลสำเร็จแล้ว แต่บัญชีนี้ใช้ OTP เข้าไม่ได้ | ยืนยันอีเมลสำเร็จแล้ว แต่บัญชีนี้เข้าสู่ระบบด้วยรหัสยืนยันทางอีเมลไม่ได้ |
| `apps/web/src/features/auth/LegalAcceptancePage.tsx:52` | ก่อนเริ่มใช้งาน MangmeePlus | ก่อนเริ่มใช้งานมั่งมี |
| `apps/web/src/features/auth/LegalAcceptancePage.tsx:61` | การรับทราบนี้ไม่ใช่การให้ความยินยอม ไม่เป็นการสละสิทธิของคุณตาม PDPA และไม่ทำให้ MangmeePlus ใช้ข้อมูลนอกเหนือจากฐานกฎหมายและวัตถุประสงค์ที่แจ้งไว้ | การรับทราบนี้ไม่ใช่การให้ความยินยอม ไม่เป็นการสละสิทธิของคุณตามกฎหมายคุ้มครองข้อมูลส่วนบุคคล และไม่ทำให้มั่งมีใช้ข้อมูลนอกเหนือจากฐานกฎหมายและวัตถุประสงค์ที่แจ้งไว้ |
| `apps/web/src/features/auth/LegalAcceptancePage.tsx:236` | Secure business workspace<br>Legal acceptance | พื้นที่ทำงานของร้าน<br>รับทราบข้อกำหนด |
| `apps/web/src/features/auth/LineQrApprovePage.tsx:23` | เซสชันหมดอายุ<br>เซสชันบนเบราว์เซอร์นี้หมดอายุแล้ว เข้าสู่ระบบอีกครั้ง แล้วระบบจะพากลับมาที่หน้านี้เพื่อกดยืนยัน QR เดิมยังใช้ได้ถ้ายังไม่หมดเวลา | การเข้าสู่ระบบหมดอายุ<br>การเข้าสู่ระบบบนเบราว์เซอร์นี้หมดอายุแล้ว เข้าสู่ระบบอีกครั้ง แล้วระบบจะพากลับมาที่หน้านี้เพื่อกดยืนยัน QR เดิมยังใช้ได้ถ้ายังไม่หมดเวลา |
| `apps/web/src/features/auth/LineQrApprovePage.tsx:128` | มีการขอเข้าสู่ระบบ MangmeePlus จากเบราว์เซอร์บนคอมพิวเตอร์ ถ้าไม่ใช่คุณ อย่ากดยืนยัน | มีการขอเข้าสู่ระบบ มั่งมี จากเบราว์เซอร์บนคอมพิวเตอร์ ถ้าไม่ใช่คุณ อย่ากดยืนยัน |
| `apps/web/src/features/auth/LoginPage.tsx:94` | LIVE | ตัวอย่าง |
| `apps/web/src/features/auth/LoginPage.tsx:425` | กำลังตรวจสอบเซสชัน... | กำลังตรวจสอบการเข้าสู่ระบบ... |
| `apps/web/src/features/auth/LoginPage.tsx:649` | เข้าสู่ระบบด้วยรหัส OTP | เข้าสู่ระบบด้วยรหัสยืนยัน |
| `apps/web/src/features/auth/LoginPage.tsx:662` | ยังไม่เปิดให้เข้าสู่ระบบด้วย LINE ในขณะนี้ ใช้รหัสผ่านหรือเข้าสู่ระบบด้วยรหัส OTP ทางอีเมลได้ | ยังไม่เปิดให้เข้าสู่ระบบด้วย LINE ในขณะนี้ ใช้รหัสผ่านหรือเข้าสู่ระบบด้วยรหัสยืนยันทางอีเมลได้ |
| `apps/web/src/features/auth/VerifyEmailPage.tsx:17` | ยืนยันอีเมลด้วยรหัส OTP | ยืนยันอีเมลด้วยรหัสยืนยัน |
| `apps/web/src/features/auth/VerifyEmailPage.tsx:20` | เข้าสู่ระบบเพื่อขอรหัส OTP | เข้าสู่ระบบเพื่อขอรหัสยืนยัน |
| `apps/web/src/features/billing/BillingAdjustmentsPage.tsx:23` | ข้อมูลรายการนี้ยังยืนยันกับ Stripe ไม่ได้<br>ระบบยังเปิดเอกสารไม่ได้ เพราะข้อมูลการชำระเงินของรายการนี้ไม่ตรงหรือไม่ครบสำหรับตรวจสอบกับ Stripe | ข้อมูลรายการนี้ยังยืนยันกับผู้ให้บริการรับชำระเงินไม่ได้<br>ระบบยังเปิดเอกสารไม่ได้ เพราะข้อมูลการชำระเงินของรายการนี้ไม่ตรงหรือไม่ครบสำหรับตรวจสอบกับผู้ให้บริการรับชำระเงิน |
| `apps/web/src/features/billing/BillingAdjustmentsPage.tsx:24` | Stripe ยังไม่มีเอกสารหรือหลักฐานที่ครบสำหรับรายการนี้ ลองตรวจข้อมูลอีกครั้งภายหลัง<br>ยังเชื่อมต่อเอกสารจาก Stripe ไม่ได้ | ผู้ให้บริการรับชำระเงินยังไม่มีเอกสารหรือหลักฐานที่ครบสำหรับรายการนี้ ลองตรวจข้อมูลอีกครั้งภายหลัง<br>ยังเชื่อมต่อเอกสารจากผู้ให้บริการรับชำระเงินไม่ได้ |
| `apps/web/src/features/billing/BillingAdjustmentsPage.tsx:26` | อ่านข้อมูลจาก Stripe ไม่สำเร็จ | อ่านข้อมูลจากผู้ให้บริการรับชำระเงินไม่สำเร็จ |
| `apps/web/src/features/billing/BillingAdjustmentsPage.tsx:28` | Stripe ดำเนินการคืนเงินสำเร็จ | ผู้ให้บริการรับชำระเงินดำเนินการคืนเงินสำเร็จ |
| `apps/web/src/features/billing/BillingAdjustmentsPage.tsx:101` | เปิดเอกสารจาก Stripe ของรายการชำระเงินนี้<br>กำลังตรวจข้อมูลกับ Stripe… | เปิดเอกสารจากผู้ให้บริการรับชำระเงินสำหรับรายการชำระเงินนี้<br>กำลังตรวจข้อมูลกับผู้ให้บริการรับชำระเงิน… |
| `apps/web/src/features/billing/BillingAdjustmentsPage.tsx:105` | ดูสถานะการเชื่อมต่อ Stripe | ดูสถานะการเชื่อมต่อ ผู้ให้บริการรับชำระเงิน |
| `apps/web/src/features/billing/BillingAdjustmentsPage.tsx:109` | เอกสารจาก Stripe | เอกสารจากผู้ให้บริการรับชำระเงิน |
| `apps/web/src/features/billing/BillingAdjustmentsPage.tsx:122` | ดูผลคืนเงินจาก Stripe และเอกสารปรับยอด ธนาคารอาจใช้เวลาบันทึกเงินคืน ส่วนแพ็กเกจลูกค้าต้องตรวจแยก | ดูผลคืนเงินจากผู้ให้บริการรับชำระเงิน และเอกสารปรับยอด ธนาคารอาจใช้เวลาบันทึกเงินคืน ส่วนแพ็กเกจลูกค้าต้องตรวจแยก |
| `apps/web/src/features/billing/BillingAdjustmentsPage.tsx:126` | ตรวจคำแนะนำจาก Stripe และผลคำขอคืนเงินเดิมก่อนดำเนินการต่อ<br>ตรวจอีเมลคำแนะนำจาก Stripe หรือติดต่อทีมงาน<br>ตรวจผลคืนเงินของรายการเดิมใน Stripe ก่อนสร้างคำขอเพิ่ม | ตรวจคำแนะนำจากผู้ให้บริการรับชำระเงิน และผลคำขอคืนเงินเดิมก่อนดำเนินการต่อ<br>ตรวจอีเมลคำแนะนำจากผู้ให้บริการรับชำระเงิน หรือติดต่อทีมงาน<br>ตรวจผลคืนเงินของรายการเดิมกับผู้ให้บริการรับชำระเงิน ก่อนสร้างคำขอเพิ่ม |
| `apps/web/src/features/billing/BillingAdjustmentsPage.tsx:155` | บริษัทนี้ยังไม่มีบัญชีลูกค้าใน Stripe จึงยังไม่มีผู้รับเอกสารให้เปลี่ยน | บริษัทนี้ยังไม่มีบัญชีลูกค้ากับผู้ให้บริการรับชำระเงิน จึงยังไม่มีผู้รับเอกสารให้เปลี่ยน |
| `apps/web/src/features/billing/BillingAdjustmentsPage.tsx:162` | เปิดเอกสารจาก Stripe ของรายการชำระเงินนี้ | เปิดเอกสารจากผู้ให้บริการรับชำระเงินสำหรับรายการชำระเงินนี้ |
| `apps/web/src/features/billing/BillingPage.tsx:485` | กำลังรอผลการชำระเงินจาก Stripe | กำลังรอผลการชำระเงินจากผู้ให้บริการรับชำระเงิน |
| `apps/web/src/features/billing/BillingPage.tsx:536` | กำลังตรวจผลรายการเดิมกับ Stripe กรุณารอสักครู่แล้วกดอัปเดตข้อมูล | กำลังตรวจผลรายการเดิมกับผู้ให้บริการรับชำระเงิน กรุณารอสักครู่แล้วกดอัปเดตข้อมูล |
| `apps/web/src/features/billing/BillingPage.tsx:547` | ยุติหน้าชำระเงินรายการนี้ใช่ไหม? ระบบจะตรวจผลกับ Stripe ก่อนให้เริ่มรายการใหม่ | ยุติหน้าชำระเงินรายการนี้ใช่ไหม? ระบบจะตรวจผลกับผู้ให้บริการรับชำระเงิน ก่อนให้เริ่มรายการใหม่ |
| `apps/web/src/features/billing/BillingPage.tsx:571` | บิล PromptPay รอบปัจจุบัน | บิล พร้อมเพย์ รอบปัจจุบัน |
| `apps/web/src/features/billing/BillingPage.tsx:577` | เปลี่ยนบัตรสำหรับการต่ออายุผ่าน Stripe | เปลี่ยนบัตรสำหรับการต่ออายุผ่านผู้ให้บริการรับชำระเงิน |
| `apps/web/src/features/billing/BillingPage.tsx:652` | แพ็กเกจปัจจุบันเป็นแบบจ่ายครั้งเดียว ระหว่างที่ยังไม่หมดอายุ ซื้อแพ็กเกจอื่นได้ด้วยบัตรจ่ายครั้งเดียวหรือ PromptPay จ่ายครั้งเดียว หากต้องการต่ออายุอัตโนมัติให้เริ่มหลังแพ็กเกจนี้หมดอายุ | แพ็กเกจปัจจุบันเป็นแบบจ่ายครั้งเดียว ระหว่างที่ยังไม่หมดอายุ ซื้อแพ็กเกจอื่นได้ด้วยบัตรจ่ายครั้งเดียวหรือพร้อมเพย์จ่ายครั้งเดียว หากต้องการต่ออายุอัตโนมัติให้เริ่มหลังแพ็กเกจนี้หมดอายุ |
| `apps/web/src/features/billing/BillingPage.tsx:807` | กำลังตรวจกับ Stripe ว่าหน้าชำระเงินถูกสร้างหรือไม่ กรุณารอสักครู่แล้วกดอัปเดตข้อมูล ยังไม่ต้องเริ่มรายการใหม่ | กำลังตรวจกับผู้ให้บริการรับชำระเงินว่าหน้าชำระเงินถูกสร้างหรือไม่ กรุณารอสักครู่แล้วกดอัปเดตข้อมูล ยังไม่ต้องเริ่มรายการใหม่ |
| `apps/web/src/features/billing/BillingPage.tsx:809` | ยืนยันและไปชำระที่ Stripe | ยืนยันและไปหน้าชำระเงิน |
| `apps/web/src/features/billing/BillingPage.tsx:818` | ยอดคืนเงินที่ Stripe บันทึก {money(invoice.refundedSatang)} · | ยอดคืนเงินที่ผู้ให้บริการรับชำระเงินบันทึก {money(invoice.refundedSatang)} · |
| `apps/web/src/features/billing/billing-display.ts:56` | PromptPay QR · จ่ายครั้งเดียว<br>PromptPay QR · สแกนบิลทุกงวด | พร้อมเพย์ QR · จ่ายครั้งเดียว<br>พร้อมเพย์ QR · สแกนบิลทุกงวด |
| `apps/web/src/features/billing/billing-error-text.ts:16` | ระบบกำลังตรวจรายการชำระเงินเดิมกับ Stripe กรุณารอสักครู่แล้วกดลองใหม่ | ระบบกำลังตรวจรายการชำระเงินเดิมกับผู้ให้บริการรับชำระเงิน กรุณารอสักครู่แล้วกดลองใหม่ |
| `apps/web/src/features/billing/billing-event-discount.ts:47` | มีส่วนลดจากงาน {view.eventName} ใช้ได้เมื่อจ่ายครั้งเดียวด้วยบัตรหรือ PromptPay | มีส่วนลดจากงาน {view.eventName} ใช้ได้เมื่อจ่ายครั้งเดียวด้วยบัตรหรือพร้อมเพย์ |
| `apps/web/src/features/branch-settings/BranchSettingsPage.tsx:152` | ค่าชนิดหรือสถานะที่ระบบไม่รู้จัก (แสดงรหัสดิบ) | ไม่ทราบประเภท |
| `apps/web/src/features/branch-settings/BranchSettingsPage.tsx:154` | ค่าชนิดหรือสถานะที่ระบบไม่รู้จัก (แสดงรหัสดิบ) | ไม่ทราบสถานะ |
| `apps/web/src/features/branch-settings/BranchSettingsPage.tsx:160` | ค่าชนิดหรือสถานะที่ระบบไม่รู้จัก (แสดงรหัสดิบ) | ไม่ทราบสถานะ |
| `apps/web/src/features/branch-settings/BranchSettingsPage.tsx:161` | ค่าชนิดหรือสถานะที่ระบบไม่รู้จัก (แสดงรหัสดิบ) | ไม่ทราบประเภท |
| `apps/web/src/features/branch-settings/BranchSettingsPage.tsx:170` | รหัสสาขา (A-Z, 0-9)<br>เช่น BKK01 | รหัสสาขา (ตัวอักษรอังกฤษหรือตัวเลข)<br>เช่น 001 |
| `apps/web/src/features/company-profile/CompanyProfilePage.tsx:398` | ค้นหาชื่อธุรกิจหรือรหัส TSIC | ค้นหาชื่อธุรกิจหรือรหัสประเภทธุรกิจ |
| `apps/web/src/features/company-profile/CompanyProfilePage.tsx:409` | รหัสธุรกิจ DBD (TSIC) | รหัสประเภทธุรกิจของกรมพัฒนาธุรกิจการค้า |
| `apps/web/src/features/company-profile/CompanyProfilePage.tsx:567` | ใช้คู่กับรหัสผ่านตอนเข้าจากคอมพิวเตอร์ ตัวอักษร a-z ตัวเลข จุด ขีด อย่างน้อย 4 ตัว | ใช้คู่กับรหัสผ่านตอนเข้าจากคอมพิวเตอร์ ตัวอักษรอังกฤษพิมพ์เล็ก ตัวเลข จุด ขีดกลาง หรือขีดล่าง ตั้งแต่ 4 ถึง 64 ตัว |
| `apps/web/src/features/company-profile/company-profile.logic.ts:378` | เลือกประเภทธุรกิจจากรายการ DBD หรือเลือกอื่น ๆ | ใช้ข้อความร่วมของข้อผิดพลาด company_business_type_invalid หรือ invalid_username ตามกรณี (ตารางด้านบน) |
| `apps/web/src/features/company-profile/company-profile.logic.ts:432` | ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 จุด ขีด และขีดล่าง ยาว 4 ถึง 64 ตัว (ภาษาไทยใช้ไม่ได้ค่ะ) | ใช้ข้อความร่วมของข้อผิดพลาด company_business_type_invalid หรือ invalid_username ตามกรณี (ตารางด้านบน) |
| `apps/web/src/features/employee-access/EmployeeAccessPages.tsx:367` | ใช้วันเดือนปีเกิดรูปแบบ DDMMYYYY — ไม่ต้องเปลี่ยนรหัสผ่านตอนเข้าสู่ระบบครั้งแรก | ใช้วันเดือนปีเกิดเป็นตัวเลข 8 หลัก เรียงวัน เดือน ปี ค.ศ. — ไม่ต้องเปลี่ยนรหัสผ่านตอนเข้าสู่ระบบครั้งแรก |
| `apps/web/src/features/employee-access/EmployeeAccessPages.tsx:476` | Username | ชื่อผู้ใช้ |
| `apps/web/src/features/employee-access/EmployeeAccessPages.tsx:791` | ตั้งชื่อได้ตามบริษัท เช่น CEO, CTO หรือ CFO แล้วเลือกว่างานอะไรที่คนชื่อนี้ทำได้ | ตั้งชื่อตามหน้าที่ในบริษัท แล้วเลือกงานที่บทบาทนี้ทำได้ |
| `apps/web/src/features/employee-access/EmployeeAccessPages.tsx:1044` | พนักงานทุกคนเข้าใช้ระบบ ดูหน้าหลัก และรับการแจ้งเตือนได้อยู่แล้ว | การเข้าใช้งานขึ้นอยู่กับสถานะบัญชี สิทธิ์ และเมนูที่ร้านเปิดใช้ |
| `apps/web/src/features/employee-access/EmployeeAccessPages.tsx:1204` | สิทธิ์พื้นฐานเท่านั้น (เข้าสู่ระบบ, แดชบอร์ด, แจ้งเตือน) | สิทธิ์พื้นฐานตามเมนูที่ร้านเปิดใช้ |
| `apps/web/src/features/expenses/ExpensesPages.tsx:264` | ไฟล์ PDF/ชนิดนี้ยังไม่รองรับการอ่านอัตโนมัติ — กรอกข้อมูลเองได้ที่ฟอร์มตรวจ<br>ยังไม่ได้ตั้งค่าระบบ AI — เอกสารยังเป็นฉบับร่าง กรุณาตรวจและกรอกข้อมูลเอง<br>ไม่พบไฟล์แนบสำหรับอ่านอัตโนมัติ — กรุณาแนบไฟล์ใบเสร็จ หรือกรอกข้อมูลต่อได้ในหน้านี้<br>ผู้ดูแลปิด OCR ของบริษัทนี้ไว้ — เอกสารถูกเก็บแล้ว คุณยังเปิดและกรอกข้อมูลเองได้<br>ใช้ OCR ครบจำนวนของเดือนนี้แล้ว — เอกสารถูกเก็บแล้ว กรุณากรอกข้อมูลเองหรือติดต่อผู้ดูแล<br>คำขออ่านเอกสารนี้เคยถูกรับแล้ว — เปิดรายการเพื่อตรวจผล หรือกรอกข้อมูลเองได้โดยไม่ต้องอัปโหลดใหม่<br>ตรวจสอบสิทธิ์ OCR ไม่สำเร็จชั่วคราว — เอกสารถูกเก็บแล้ว กรุณาลองใหม่ภายหลังหรือกรอกข้อมูลเอง<br>เครดิต AI ที่เหลือไม่พอเริ่มอ่านเอกสารนี้ จึงยังไม่ได้อ่านด้วย AI — เอกสารถูกเก็บแล้ว กรุณากรอกข้อมูลเอง หรือติดต่อผู้ดูแลเพื่อปรับแพ็กเกจ<br>ยังตรวจสอบเครดิต AI ไม่ได้ จึงยังไม่ได้อ่านด้วย AI — เอกสารถูกเก็บแล้ว กรุณากรอกข้อมูลเอง หรือลองอ่านอีกครั้งภายหลัง<br>ระบบกำลังประมวลผลงาน AI ก่อนหน้าอยู่ จึงยังไม่ได้อ่านเอกสารนี้ — เอกสารถูกเก็บแล้ว กรุณากรอกข้อมูลเอง หรือลองอ่านอีกครั้งภายหลัง<br>อ่านข้อมูลไม่สำเร็จค่ะ เก็บไฟล์ไว้แล้ว กรอกข้อมูลต่อได้ในหน้านี้<br>✓ ย่อรูปเหลือ {(ready.file.size / 1024 / 1024).toFixed(2)} MB | ไฟล์ PDF/ชนิดนี้ยังไม่รองรับการอ่านอัตโนมัติ — เก็บเอกสารแล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้<br>ยังไม่ได้ตั้งค่าระบบ AI — เก็บเอกสารแล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้<br>ไม่พบไฟล์แนบสำหรับอ่านอัตโนมัติ — กรุณาแนบไฟล์ใบเสร็จ หรือให้ผู้มีสิทธิ์แก้ไขกรอกข้อมูลต่อ<br>การอ่านเอกสารของบริษัทนี้ถูกปิดไว้ — เก็บเอกสารแล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้<br>อ่านเอกสารครบจำนวนของเดือนนี้แล้ว — เก็บเอกสารแล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้<br>คำขออ่านเอกสารนี้เคยถูกรับแล้ว — เก็บเอกสารแล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้<br>ตรวจสอบสิทธิ์อ่านเอกสารไม่สำเร็จชั่วคราว — เก็บเอกสารแล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้<br>เครดิต AI ที่เหลือไม่พอเริ่มอ่านเอกสารนี้ จึงยังไม่ได้อ่านด้วย AI — เก็บเอกสารแล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้<br>ยังตรวจสอบเครดิต AI ไม่ได้ จึงยังไม่ได้อ่านด้วย AI — เก็บเอกสารแล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้<br>ระบบกำลังประมวลผลงาน AI ก่อนหน้าอยู่ จึงยังไม่ได้อ่านเอกสารนี้ — เก็บเอกสารแล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้<br>อ่านข้อมูลไม่สำเร็จค่ะ เก็บไฟล์ไว้แล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้<br>PDF หรือรูปภาพ (เจเพ็ก, พีเอ็นจี, ฮีอิก, ฮีฟ, กิฟ)<br>✓ ย่อรูปเหลือ {(ready.file.size / 1024 / 1024).toFixed(2)} เมกะไบต์ |
| `apps/web/src/features/expenses/ExpensesPages.tsx:451` | อัปโหลดสำเร็จแล้ว แต่ AI อ่านเอกสารไม่สำเร็จ — {err(e)} เก็บไฟล์ไว้แล้ว กรอกข้อมูลต่อได้ในหน้านี้ | อัปโหลดสำเร็จแล้ว แต่ AI อ่านเอกสารไม่สำเร็จ — {err(e)} เก็บไฟล์ไว้แล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้ |
| `apps/web/src/features/expenses/ExpensesPages.tsx:570` | รองรับ JPG/JPEG PNG HEIC (รูปจากไอโฟน) หรือ PDF · รูปใหญ่จะถูกย่ออัตโนมัติ · หรือส่งจาก LINE ได้เลย | รองรับ PDF หรือรูปภาพ (เจเพ็ก, พีเอ็นจี, ฮีอิก, ฮีฟ, กิฟ) · รูปใหญ่จะถูกย่ออัตโนมัติ |
| `apps/web/src/features/expenses/ExpensesPages.tsx:2557` | เลขรายจ่าย (EXP) | เลขรายจ่าย |
| `apps/web/src/features/expenses/ExpensesPages.tsx:2606` | เลขรายจ่าย (EXP) | เลขรายจ่าย |
| `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:201` | Tax Code เริ่มต้น | Shared dictionary label above |
| `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:232` | — (shared wording added) | รหัสภาษีเดิม |
| `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:260` | Tax Code เริ่มต้น | รหัสภาษีเริ่มต้น |
| `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:265` | ใช้เป็นค่าตั้งต้นของรายการที่ยังไม่ได้เลือก Tax Code เท่านั้น ผู้ตรวจเปลี่ยนได้เสมอ | ใช้เป็นค่าตั้งต้นของรายการที่ยังไม่ได้เลือกรหัสภาษี ผู้มีสิทธิ์แก้ไขเปลี่ยนได้ก่อนยืนยันเอกสาร |
| `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:378` | รองรับไฟล์ PNG, JPG/JPEG/JPE, HEIC/HEIF และ GIF<br>ไม่สามารถอ่านไฟล์ HEIC/HEIF ได้ กรุณาลองถ่ายใหม่หรือใช้ไฟล์ JPG | รองรับรูปภาพ (เจเพ็ก, พีเอ็นจี, ฮีอิก, ฮีฟ, กิฟ) |
| `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:607` | PNG, JPG/JPEG/JPE, HEIC/HEIF หรือ GIF | เจเพ็ก, พีเอ็นจี, ฮีอิก, ฮีฟ, กิฟ |
| `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:1120` | รายการหลักฐาน (JSON) — ลิงก์ดาวน์โหลดไฟล์แนบทุกไฟล์ มีวันหมดอายุ<br>ดาวน์โหลดรายการหลักฐาน (JSON) | รายการลิงก์ดาวน์โหลดหลักฐาน — ลิงก์มีวันหมดอายุ<br>ดาวน์โหลดรายการลิงก์หลักฐาน |
| `apps/web/src/features/expenses/ForeignCurrencyNotice.tsx:22` | สกุลเงิน {code} | สกุลเงิน {ชื่อสกุลเงินภาษาไทย} หรือ “ต่างประเทศ” เมื่อไม่รู้จักรหัส |
| `apps/web/src/features/expenses/SubstitutePaperSigningPanel.tsx:64` | PDF ไม่เกิน 5 หน้า หรือภาพ PNG/JPEG ขนาดไม่เกิน 10 MB ให้เห็นครบทุกหน้าและอ่านได้ชัดเจน | PDF ไม่เกิน 5 หน้า หรือ<br>รูปภาพ (เจเพ็ก, พีเอ็นจี)<br>ขนาดไม่เกิน 10 เมกะไบต์ ให้เห็นครบทุกหน้าและอ่านได้ชัดเจน |
| `apps/web/src/features/expenses/SubstituteReceiptSettingsPage.tsx:134` | ผู้อนุมัติเดิมบางคนไม่มีสิทธิ์หรือไม่ active แล้ว กรุณาเลือกผู้อนุมัติใหม่ก่อนบันทึก | ผู้อนุมัติเดิมบางคนไม่มีสิทธิ์หรือไม่ได้ใช้งานแล้ว กรุณาเลือกผู้อนุมัติใหม่ก่อนบันทึก |
| `apps/web/src/features/expenses/SubstituteReceiptSettingsPage.tsx:196` | การตั้งค่านี้เป็น control ภายในบริษัท ไม่ทำให้เอกสารกลายเป็นใบกำกับภาษี และไม่สร้างสิทธิ์ภาษีซื้อโดยอัตโนมัติ | การตั้งค่านี้เป็นการควบคุมภายในบริษัท ไม่ทำให้เอกสารกลายเป็นใบกำกับภาษี และไม่สร้างสิทธิ์ภาษีซื้อโดยอัตโนมัติ |
| `apps/web/src/features/expenses/expenses.api.ts:318` | ไม่สามารถโหลดไฟล์เพื่อดูตัวอย่างได้ (HTTP {response.status}) | ข้อความสถานะ HTTP ภาษาไทยจาก API translator (ตรวจกรณีไม่พบไฟล์ใน expenses.api.spec.ts) |
| `apps/web/src/features/expenses/expenses.api.ts:703` | ใช้ PDF, PNG หรือ JPEG ขนาดไม่เกิน 10 MB | ใช้ PDF หรือรูปภาพ (เจเพ็ก, พีเอ็นจี) ขนาดไม่เกิน 10 เมกะไบต์ |
| `apps/web/src/features/expenses/expenses.model.ts:1237` | รูปภาพ JPEG<br>รูปภาพ JPEG<br>รูปภาพ PNG<br>เอกสาร SVG | รูปภาพเจเพ็ก<br>รูปภาพเจเพ็ก<br>รูปภาพพีเอ็นจี<br>ภาพเวกเตอร์ |
| `apps/web/src/features/expenses/expenses.model.ts:1247` | ยกเลิก version นี้แล้ว | ยกเลิกฉบับนี้แล้ว |
| `apps/web/src/features/reimbursements/ReimbursementCreatePage.tsx:516` | รองรับ PDF, JPG/JPEG, PNG, HEIC/HEIF และ GIF ระบบจะแปลงรูปให้อัตโนมัติก่อนแนบ | รองรับ<br>PDF หรือรูปภาพ (เจเพ็ก, พีเอ็นจี, ฮีอิก, ฮีฟ, กิฟ)<br>ระบบจะแปลงรูปให้อัตโนมัติก่อนแนบ |
| `apps/web/src/features/reimbursements/ReimbursementDetailSections.tsx:446` | · PDF, JPG/JPEG, PNG, HEIC/HEIF หรือ GIF ขนาดไม่เกิน 10 MB | PDF หรือรูปภาพ (เจเพ็ก, พีเอ็นจี, ฮีอิก, ฮีฟ, กิฟ)<br>ขนาดไม่เกิน 10 เมกะไบต์ |
| `apps/web/src/features/reimbursements/ReimbursementDetailSections.tsx:754` | PDF, JPG/JPEG, PNG, HEIC/HEIF หรือ GIF | PDF หรือรูปภาพ (เจเพ็ก, พีเอ็นจี, ฮีอิก, ฮีฟ, กิฟ) |
| `apps/web/src/features/reimbursements/ReimbursementDetailSections.tsx:940` | แนบใบเบิกที่เซ็นแล้ว (PDF/JPG/PNG) | แนบใบเบิกที่เซ็นแล้ว |
| `apps/web/src/features/reimbursements/reimbursements.model.ts:312` | พบนโยบายบริษัทซ้ำ ระบบยังไม่บันทึก กรุณาติดต่อผู้ดูแลระบบ<br>ข้อมูลนโยบายของใบเบิกนี้ไม่สมบูรณ์ ระบบจึงหยุดรายการไว้เพื่อความปลอดภัย กรุณาติดต่อผู้ดูแลระบบ | ใช้ข้อความร่วมของข้อผิดพลาดเดิมจาก API translator; ข้อผิดพลาดลายเซ็นใช้ชนิดไฟล์ภาษาไทยและเมกะไบต์; สำเนาที่ลงนามใช้ “สำเนาแบบฟอร์มที่ลงนามต้องเป็นไฟล์ PDF หรือรูปภาพ” |
| `apps/web/src/features/reimbursements/reimbursements.model.ts:337` | ไฟล์ลายเซ็นต้องเป็น PNG/JPEG ขนาดไม่เกิน 2 MB | ใช้ข้อความร่วมของข้อผิดพลาดเดิมจาก API translator; ข้อผิดพลาดลายเซ็นใช้ชนิดไฟล์ภาษาไทยและเมกะไบต์; สำเนาที่ลงนามใช้ “สำเนาแบบฟอร์มที่ลงนามต้องเป็นไฟล์ PDF หรือรูปภาพ” |
| `apps/web/src/features/reimbursements/reimbursements.model.ts:341` | ไฟล์ลายเซ็นต้องมีขนาดไม่เกิน 2 MB | ใช้ข้อความร่วมของข้อผิดพลาดเดิมจาก API translator; ข้อผิดพลาดลายเซ็นใช้ชนิดไฟล์ภาษาไทยและเมกะไบต์; สำเนาที่ลงนามใช้ “สำเนาแบบฟอร์มที่ลงนามต้องเป็นไฟล์ PDF หรือรูปภาพ” |
| `apps/web/src/features/reimbursements/reimbursements.model.ts:345` | ใบเบิกที่เซ็นแล้วต้องเป็นไฟล์ PDF/JPG/PNG | ใช้ข้อความร่วมของข้อผิดพลาดเดิมจาก API translator; ข้อผิดพลาดลายเซ็นใช้ชนิดไฟล์ภาษาไทยและเมกะไบต์; สำเนาที่ลงนามใช้ “สำเนาแบบฟอร์มที่ลงนามต้องเป็นไฟล์ PDF หรือรูปภาพ” |
| `apps/web/src/features/tax/Pnd53Page.tsx:114` | เหตุผลปิดข้อทักท้วง {issue.issueCode} | เหตุผลปิดข้อทักท้วง {index + 1} |
| `apps/web/src/features/tax/TaxSignatureSettingsPage.tsx:45` | หน้านี้สำหรับเจ้าของบริษัทเท่านั้น | คุณยังไม่มีสิทธิ์จัดการลายเซ็นผู้จ่ายเงินของบริษัท |
| `apps/web/src/features/tax/TaxSignatureSettingsPage.tsx:96` | รูปลายเซ็น (PNG หรือ JPEG) | รูปลายเซ็น (<br>รูปภาพ (เจเพ็ก, พีเอ็นจี) |
| `apps/web/src/features/tax/tax.logic.ts:24` | รหัสสถานะ/คำอธิบายข้อทักท้วงภาษาอังกฤษจากระบบ | เปิดงวด<br>ต้องตรวจสอบ<br>พร้อมตรวจสอบ<br>ปรับปรุงแบบแล้ว<br>ตรวจสอบแล้ว<br>ส่งออกแล้ว<br>ยื่นแบบแล้ว<br>ชำระแล้ว<br>ปิดงวด<br>ไม่ทราบสถานะ<br>ยังไม่มีเลขประจำตัวผู้เสียภาษี กรุณาตรวจข้อมูลต้นทาง<br>ยังไม่มีรหัสสาขาภาษี กรุณาตรวจข้อมูลต้นทาง<br>ยังระบุวิธีคิด VAT ไม่ได้ กรุณาตรวจข้อมูลต้นทาง<br>ภาษีซื้อของรายการนี้ใช้ขอคืนไม่ได้<br>อัตราภาษีหัก ณ ที่จ่ายไม่ตรงกับข้อมูลที่กำหนด กรุณาตรวจข้อมูลต้นทาง<br>ยังไม่มีข้อมูลอ้างอิงใบกำกับภาษี กรุณาตรวจข้อมูลต้นทาง<br>พบรายการต้นทางซ้ำ กรุณาตรวจสอบก่อนออกแบบ<br>รายการต้นทางอยู่ในงวดที่ปิดแล้ว กรุณาตรวจสอบก่อนออกแบบ<br>ยังไม่มีข้อมูลบัญชีที่ใช้ตรวจสอบรายการนี้<br>ข้อมูลต้นทางยังไม่ครบ กรุณาตรวจสอบก่อนออกแบบ<br>ข้อมูลแปลงสกุลเงินของรายการต้นทางยังไม่ครบ กรุณาตรวจสอบก่อนออกแบบ<br>ข้อมูลสกุลเงินไม่ตรงกับบริษัทหรือเอกสารต้นทาง กรุณาตรวจสอบก่อนออกแบบ<br>เอกสารต้นทางถูกยกเลิกหลังปิดงวดภาษี กรุณาตรวจขั้นตอนปรับปรุงรายการ<br>ข้อมูลภาษีต้นทางเปลี่ยนหลังปิดงวดภาษี กรุณาตรวจขั้นตอนปรับปรุงรายการ<br>ยังไม่ได้ตรวจรับรองหลักฐานภาษีของรายการต้นทาง<br>พบรายการที่ต้องตรวจสอบ กรุณาให้ผู้มีสิทธิ์จัดทำแบบภาษีตรวจข้อมูลต้นทาง |
| `apps/web/src/features/user-guide/expenses-guide.content.ts:17` | — (shared wording added) | หากข้อมูลผิดหลังยืนยัน ให้ผู้มีสิทธิ์ตรวจว่ารายการส่งกลับแก้ไขได้หรือไม่ ถ้าทำได้ ให้กด “ส่งกลับแก้ไข” ก่อนแก้ข้อมูล หากทำไม่ได้ ให้ตรวจเงื่อนไขการยกเลิกเอกสารก่อนดำเนินการ |
| `apps/web/src/features/user-guide/expenses-guide.content.ts:62` | เมื่อยืนยันแล้วจะแก้ไขไม่ได้ หากผิดต้องยกเลิกแล้วบันทึกใหม่ | หากข้อมูลผิดหลังยืนยัน ให้ผู้มีสิทธิ์ตรวจว่ารายการส่งกลับแก้ไขได้หรือไม่ ถ้าทำได้ ให้กด “ส่งกลับแก้ไข” ก่อนแก้ข้อมูล หากทำไม่ได้ ให้ตรวจเงื่อนไขการยกเลิกเอกสารก่อนดำเนินการ |
| `apps/web/src/features/user-guide/expenses-guide.content.ts:73` | ใช้เป็นหลักฐานทางบัญชีได้ และแก้ไขไม่ได้อีก | ยืนยันแล้ว ต้องตรวจเงื่อนไขก่อนส่งกลับแก้ไขหรือยกเลิก |
| `apps/web/src/features/user-guide/expenses-guide.content.ts:212` | JPG/JPEG · PNG · HEIC (รูปจากไอโฟน) และ PDF รูปที่ใหญ่เกินไประบบจะย่อให้อัตโนมัติ | PDF หรือรูปภาพ (เจเพ็ก, พีเอ็นจี, ฮีอิก, ฮีฟ, กิฟ) รูปที่ใหญ่เกินไประบบจะย่อให้อัตโนมัติ |
| `apps/web/src/features/user-guide/expenses-guide.content.ts:253` | ค่าบริการ (Service charge) | ค่าบริการ |
| `apps/web/src/features/user-guide/expenses-guide.content.ts:322` | คลิกแถวนั้นเพื่อดูรายละเอียด (เอกสารที่ยืนยันแล้วแก้ไขไม่ได้) | คลิกแถวนั้นเพื่อดูรายละเอียดและขั้นตอนที่ทำต่อได้ตามสถานะและสิทธิ์ |
| `apps/web/src/features/user-guide/expenses-guide.content.ts:349` | เอกสารที่ยืนยันแล้วแก้ไขไม่ได้<br>หากพบว่าข้อมูลผิดหลังยืนยันไปแล้ว ต้องยกเลิกเอกสารฉบับนั้นแล้วบันทึกใหม่ ระบบออกแบบเช่นนี้เพื่อให้หลักฐานที่ส่งให้สำนักงานบัญชีตรงกับที่บันทึกไว้เสมอ | แก้ข้อมูลหลังยืนยันเอกสาร<br>หากข้อมูลผิดหลังยืนยัน ให้ผู้มีสิทธิ์ตรวจว่ารายการส่งกลับแก้ไขได้หรือไม่ ถ้าทำได้ ให้กด “ส่งกลับแก้ไข” ก่อนแก้ข้อมูล หากทำไม่ได้ ให้ตรวจเงื่อนไขการยกเลิกเอกสารก่อนดำเนินการ |
| `apps/web/src/features/user-guide/expenses-guide.content.ts:366` | พนักงานทุกคน | ผู้มีสิทธิ์ดูค่าใช้จ่ายของตนเอง |
| `apps/web/src/features/user-guide/expenses-guide.content.ts:405` | เอกสารที่ยืนยันแล้วแก้ไขไม่ได้ หากเป็นต้นทางของใบเบิกที่ส่งแล้ว ให้เปิดใบเบิกเพื่อดูสถานะและดำเนินการแก้ไขตามขั้นตอนของใบเบิก | หากข้อมูลผิดหลังยืนยัน ให้ผู้มีสิทธิ์ตรวจว่ารายการส่งกลับแก้ไขได้หรือไม่ ถ้าทำได้ ให้กด “ส่งกลับแก้ไข” ก่อนแก้ข้อมูล หากทำไม่ได้ ให้ตรวจเงื่อนไขการยกเลิกเอกสารก่อนดำเนินการ หากเป็นต้นทางของใบเบิกที่ส่งแล้ว ให้เปิดใบเบิกเพื่อดูสถานะและขั้นตอนแก้ไขของใบเบิก |
| `apps/web/src/features/user-guide/reimbursement-guide.content.ts:487` | แนบในช่อง “สลิปหรือหลักฐานการจ่าย” ถ่ายรูปหรือเลือกไฟล์จากมือถือได้ ขนาดไม่เกิน 10 MB วิธีจ่ายอื่นจะแนบหรือไม่แนบก็ได้ | แนบในช่อง “สลิปหรือหลักฐานการจ่าย” ถ่ายรูปหรือเลือกไฟล์จากมือถือได้ ขนาดไม่เกิน 10 เมกะไบต์ วิธีจ่ายอื่นจะแนบหรือไม่แนบก็ได้ |
| `apps/web/src/features/user-guide/substitute-receipt-guide.content.ts:266` | ผู้จัดทำซึ่งมีสิทธิ์ตรวจสอบค่าใช้จ่าย อัปโหลดไฟล์ PDF, PNG หรือ JPEG ขนาดไม่เกิน 10 MB (PDF ไม่เกิน 5 หน้า) กรอกชื่อ ตำแหน่ง (ถ้ามี) และวันที่ของทั้งสองส่วนตามกระดาษ ถ้าคนเดียวลงนามทั้งสองส่วน ให้ติ๊ก “ผู้ลงนามทั้งสองส่วนเป็นคนเดียวกัน (ต้องผ่านนโยบายบริษัท)” ติ๊กยืนยันว่าไฟล์ตรงกับแบบฟอร์มและลงนามครบ แล้วกด “ยื่นฉบับลงนามเพื่อตรวจรับ” ขั้นนี้ยังไม่ออกเอกสารและยังไม่บันทึกจ่ายเงิน | ผู้จัดทำซึ่งมีสิทธิ์ตรวจสอบค่าใช้จ่าย อัปโหลดไฟล์ PDF หรือรูปภาพที่รองรับ ขนาดไม่เกิน 10 เมกะไบต์ (PDF ไม่เกิน 5 หน้า) กรอกชื่อ ตำแหน่ง (ถ้ามี) และวันที่ของทั้งสองส่วนตามกระดาษ ถ้าคนเดียวลงนามทั้งสองส่วน ให้ติ๊ก “ผู้ลงนามทั้งสองส่วนเป็นคนเดียวกัน (ต้องผ่านนโยบายบริษัท)” ติ๊กยืนยันว่าไฟล์ตรงกับแบบฟอร์มและลงนามครบ แล้วกด “ยื่นฉบับลงนามเพื่อตรวจรับ” ขั้นนี้ยังไม่ออกเอกสารและยังไม่บันทึกจ่ายเงิน |
| `apps/web/src/features/user-guide/substitute-receipt-guide.content.ts:406` | ระบบออกเลขที่เอกสารให้อัตโนมัติในรูปแบบ SRC-ปีเดือน-เลขลำดับ (เช่น SRC-202608-00001) เป็นเลขรันของบริษัท เริ่มนับใหม่ทุกเดือนตามเดือนที่จัดทำเอกสาร ไม่เกี่ยวข้องกับเลขที่รายการค่าใช้จ่ายต้นทาง และจะได้เลขทันทีตั้งแต่ขั้นจัดทำเอกสารโดยไม่ต้องรอยืนยันรายการค่าใช้จ่าย | ระบบออกเลขที่เอกสารให้อัตโนมัติตามปี เดือน และเลขลำดับ เป็นเลขรันของบริษัท เริ่มนับใหม่ทุกเดือนตามเดือนที่จัดทำเอกสาร ไม่เกี่ยวข้องกับเลขที่รายการค่าใช้จ่ายต้นทาง และจะได้เลขทันทีตั้งแต่ขั้นจัดทำเอกสารโดยไม่ต้องรอยืนยันรายการค่าใช้จ่าย |
| `apps/web/src/features/web-core-workspace/WorkspaceLayout.tsx:312` | ฟีเจอร์ที่คุณมีสิทธิ์อาจถูกปิดใช้งานอยู่ กรุณาติดต่อผู้ดูแลบริษัทเพื่อเปิดฟีเจอร์หรือปรับสิทธิ์ให้ | ยังเปิดหน้างานไม่ได้ กรุณาให้ผู้มีสิทธิ์จัดการบทบาทตรวจสิทธิ์ของคุณ และให้ผู้มีสิทธิ์จัดการแพ็กเกจตรวจเมนูที่ร้านเปิดใช้ |

Additional expression-only changes: tax-code options in category management and `TransactionTaxLineSelector` show `displayName` instead of a code prefix/suffix; unavailable existing category codes show “รหัสภาษีเดิม”. The PND53 selector shows the Thai month and translated status instead of `periodKey · status`. Expense confirmation/preparation errors now say respectively “ยืนยันค่าใช้จ่ายไม่ได้ในสถานะปัจจุบัน กรุณาเปิดรายการเพื่อตรวจสถานะล่าสุด” and “จัดทำใบรับรองแทนใบเสร็จไม่ได้ในสถานะปัจจุบัน กรุณาเปิดรายการเพื่อตรวจสถานะล่าสุด”. The legal-page brand suffix “MangmeePlus” is removed; the Thai name remains. Branch-code example “BKK01” becomes “001”. Size templates change `{size} MB` to `{size} เมกะไบต์`, retaining one decimal and the original byte divisor. Signature format templates use “รูปภาพ (เจเพ็ก, พีเอ็นจี)”; source image templates additionally list “ฮีอิก, ฮีฟ, กิฟ”. Unknown MIME types are described as “ไฟล์ชนิดที่ระบบรองรับ”, never echoed.

## Pinned guide verification

Computed with `shasum -a 256` after the final guide edits:

| Guide | SHA-256 |
|---|---|
| expenses-guide.content.ts | 08dbb27a0465a294b243976f814717518938888e9af979e6ae0424002a1212d5 |
| reimbursement-guide.content.ts | 013078416e268b89892e90c3dba2a1ae505e9f487b3f7a98f49efd634d6c4432 |
| substitute-receipt-guide.content.ts | 8abcde427c8df626472db6d8709e144d843b83e8655b1934c343b410765bfc99 |

The three pins were moved to these actual hashes. All citing cards were checked: expense.start, expense.status, expense.find, expense.draft, expense.vat-display, expense.export, reimbursement.meaning, reimbursement.roles, substitute.meaning, substitute.evidence, substitute.review-sign. Card bodies changed: **none**. In particular expense.draft already directs the reader to the permitted correction/cancellation steps. The unsold reports guide/pin/cards are unchanged.

## Verification commands and results

Red proof restored original production source bodies for the main wording sweep with read-only `git show HEAD:<file>`, ran the changed specs, and restored every final source body in `finally` (45 app production files, content equality checked). No Git checkout/reset or index mutation. New contracts/build output was retained only to let the regression tests import the new shared labels; old production callers did not use those labels. Results below are observed exits, not inferred from a command launch.

| Run | Original source exit; tests/pass/fail | Fixed source exit; tests/pass/fail (main sweep) |
|---|---|---|
| web | 1; 229/204/25 | 0; 229/229/0 |
| api-0 | 1; 4/3/1 | 0; 4/4/0 |
| api-1 | 1; 360/356/4 | 0; 360/360/0 |
| api-2 | 1; 405/403/2 | 0; 405/405/0 |
| api-3 | 1; 33/28/5 | 0; 33/33/0 |
| api-4 | 1; 14/12/2 | 0; 14/14/0 |
| line | 1; 113/108/5 | 0; 113/113/0 |

`web` command:

```sh
pnpm --filter @watchdog-bms/web exec node --import tsx --test src/common/api/api-error-message.spec.ts src/common/i18n/workspace-i18n.spec.ts src/features/auth/AccountEmailOtpPanel.qa.spec.ts src/features/billing/BillingPage.qa.spec.ts src/features/billing/billing-display.spec.ts src/features/billing/billing-error-text.spec.ts src/features/branch-settings/BranchSettingsPage.spec.ts src/features/expenses/ForeignCurrencyNotice.spec.ts src/features/expenses/expense-capture-upload.logic.spec.ts src/features/expenses/expenses.api.spec.ts src/features/reimbursements/ReimbursementPages.plain-thai.qa.spec.ts src/features/reimbursements/ReimbursementPaymentForm.qa.spec.ts src/features/reimbursements/reimbursements.payment-slip.spec.ts src/common/i18n/sold-features-wording.spec.ts
```

`api-0` command:

```sh
pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/expenses/expense-capture-lane-parity.spec.ts
```

`api-1` command:

```sh
pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts
```

`api-2` command:

```sh
pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts
```

`api-3` command:

```sh
pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/line-ai/domain/logic/line-file-attempt-answer.logic.spec.ts
```

`api-4` command:

```sh
pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/line-ai/domain/logic/line-non-receipt-reply.logic.spec.ts
```

`line` command:

```sh
pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx --test src/modules/line-ai/agents/response-composer.agent.spec.ts
```

### Every changed/new assertion that failed on original source

**web** (all below pass in its final run):

- explains document VAT acceptance without suggesting a bypass of Tax Code rules
- translates chart-template and posting-readiness failures
- keeps human period references while hiding expense status enums
- sold Thai dictionary and starter settings menus contain no technical English
- sold expense, employee, profile and login copy removes technical words at every touched surface
- upload validation and failure guidance uses Thai format names and retains its limits
- expense API messages never echo a raw status or an internal tax/version token
- permission guidance does not promise disabled features or shop-admin role management
- expense guide explains the existing return-for-correction route and guides use Thai upload words
- PND53 renders Thai period statuses and review issues, with a Thai fallback for new codes
- customer package payment names and provider messages are Thai
- explains each money reason without mixing them up (th)
- inside the LINE browser, reauth offers a reopen instead of a dead-end redirect
- a success return waits for Stripe: no cancel, resume, new choice or banner CTA while the attempt is open
- every purchase mode has Thai wording, with no enum name left on screen
- answers a network failure and a 5xx with the shared retry sentences, never the team-and-reference one
- historical warehouse branches retain their label and editing does not rewrite their type
- a foreign-currency document warns with its own code, and never offers a converted amount
- unknown foreign currencies keep the warning without echoing a code
- prints megabytes the way the message does, to one decimal
- is the same boundary and the same two numbers the other two lanes print
- rejects empty, unsupported, mismatched, and failed attachment preview responses
- shows each line as a card below xl, with the same receipt upload, and keeps the table from xl up
- takes a file from a phone camera or photo library, in the file types receipts accept
- never tells a payer who has transferred the money to transfer it again
**line** (all below pass in its final run):

- does not invent capabilities for a member whose permissions open nothing
- falls back honestly when the caller can reach nothing (AC-7)
- sold feature help names an owner permission check without promising a shop feature switch
- curated LINE jokes use plain Thai words
- the shared specialist fallback describes unavailable data without guessing an endpoint failure

**api-0** (all below pass in its final run):

- prints the size and the limit the same way the web does: `{size} เมกะไบต์ … {limit} เมกะไบต์`

**api-1** (all below pass in its final run):

- follow-up examples name only what this caller can reach
- OCR unavailable without a caption persists clarification and creates no expense
- quotation returns bounded guidance with no expense mutation
- §17.5: an oversize rejection is explained with its real size and the real limit

**api-2** (all below pass in its final run):

- reports an expenses feature switch instead of blaming the member permission
- capability follow-up distinguishes shop permission management from platform administration

**api-3** (all below pass in its final run):

- oversize quotes the real size and the real limit, and never widens into another cause
- an unsupported type names the kinds the capability really listed
- a STORED_READ_FAILED file reports its own state with the link
- a STORED_READ_PARTIAL file reports its own state with the link
- unknown allowed file types never expose MIME tokens

**api-4** (all below pass in its final run):

- only NR01–NR03 and NR08 may offer the Web CTA, and only with a real link
- NR09 / §17.6: the three read outcomes each name their own state and never each other

These main-sweep focused runs precede the final login-expiry wording refinement; its separate red/green evidence is below and the complete final web suite includes every refinement.

The final capture-permission extension was also tested before its remaining web fixes:
`pnpm --filter @watchdog-bms/web exec node --import tsx --test --test-name-pattern='permission guidance' src/common/i18n/sold-features-wording.spec.ts`: exit 1, 1 test / 0 pass / 1 fail on the unqualified “กรอกข้อมูลต่อได้ในหน้านี้”; final focused web run includes it and passes 229/229.

Other checks:

- `pnpm --filter @watchdog-bms/contracts build`: final exit 0. Rebuilt after the last shared-copy additions before final checks.
- `pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx --test src/modules/line-ai/agents/approved-knowledge.spec.ts`: exit 0, 10 tests / 10 pass / 0 fail.
- Locked web typecheck: exit 0; route types generated and TypeScript reported no errors (no test count).
- Locked API typecheck: exit 0; TypeScript reported no errors (no test count).
- Locked complete web suite, with every `S3_*` environment entry removed: final exit 0, 2,780 tests / 2,780 pass / 0 fail / 0 skipped, 571 suites (including the final login-expiry regression).
- Earlier whole-web runs: exit 1 with 2,767 pass / 12 fail (old wording assertions), then exit 1 with 2,777 pass / 2 fail (new shared values were undefined while the contracts build was being updated). The final source/build snapshot and both typechecks were rerun sequentially; final results above supersede these runs. Earlier focused failures were stale assertions and were corrected; the original-source red proof remained failing on those cases.
- A verification-loop script first failed with a Python list-index TypeError before running any specs; corrected the loop structure and ran all commands listed above.
- `ps -axo pid,command | rg 'sold-wording-backtest|node --import tsx --test|pnpm --filter'`: sandbox refused process inspection with “operation not permitted”, exit 1. Not retried by another method; restored source was checked by exact saved-content comparison instead. No feature check depends on this command.

Heavy commands used the required wrapper, each with all `S3_*` variables removed:

```sh
/private/tmp/claude-501/-Users-thawatchai-Project-MangmeeYungYuen-mangmeeplus/6fadd91a-5682-4234-a498-2e23f77e8587/scratchpad/codex/heavy.sh pnpm --filter @watchdog-bms/web typecheck
/private/tmp/claude-501/-Users-thawatchai-Project-MangmeeYungYuen-mangmeeplus/6fadd91a-5682-4234-a498-2e23f77e8587/scratchpad/codex/heavy.sh pnpm --filter @watchdog-bms/api typecheck
/private/tmp/claude-501/-Users-thawatchai-Project-MangmeeYungYuen-mangmeeplus/6fadd91a-5682-4234-a498-2e23f77e8587/scratchpad/codex/heavy.sh pnpm --filter @watchdog-bms/web exec node --import tsx --test 'src/**/*.spec.ts'
```

No package.json, Prisma schema/migration, paid-invoice.ts or billing-schedule.ts change. API specs used here all already appear in the API test script.

## Controller browser checklist — 390 px, Thai locale

Use STARTER with owner, a normal employee, an upload-only/custom role and disabled sold submenus; use ENTERPRISE for the withholding screens. These are **not checked in a browser here**.

| Page / flow | Text and case to inspect at 390 px |
|---|---|
| Login; email login/verify; legal acceptance; LINE QR approval | “ตัวอย่าง”, “เข้าสู่ระบบด้วยรหัสยืนยัน”, “รหัสยืนยัน”, Thai brand/legal captions; long error/help wrapping. |
| Account/profile and account email panel inside LINE | “ชื่อผู้ใช้”; Thai allowed-character explanation; “เปิดหน้านี้ในเบราว์เซอร์ภายนอก”; current/other login-session explanations. |
| Sidebar, dashboard, notifications, settings hub | Sold menu visibility; language/reset-password labels; no unsold Master Data/tax-account links in a STARTER shop; permission/package-qualified empty state. |
| settings/employees, settings/roles, settings/access-overview | Thai username/date/job examples; base-access explanation when dashboard notifications are switched off. |
| settings/branches and settings/profile | Thai branch format/example and unknown-state fallback; “กรมพัฒนาธุรกิจการค้า” label. |
| expenses list and manual/detail pages | “เลขรายจ่าย”; human tax-code names; translated status conflicts; known/unknown foreign-currency names. |
| expenses/categories | Both table header and creation label “รหัสภาษีเริ่มต้น”; human dropdown names; unavailable default “รหัสภาษีเดิม”. |
| expenses/upload and detail/capture status | Shared Thai formats, 10-megabyte/oversize messages, failed/partial/paused and quota notices; upload-only reader sees qualified manual-edit help. |
| expenses/evidence | “รายการลิงก์ดาวน์โหลดหลักฐาน — ลิงก์มีวันหมดอายุ”; omitted inaccessible evidence is still reported honestly. |
| expenses/signatures; substitute-receipt wizard/paper-signing; settings/substitute-receipt | Thai image types/limits; “ประวัติ”; “ใช้งาน”; internal-control wording; superseded “ยกเลิกฉบับนี้แล้ว”. |
| reimbursements/new, detail, edit and signed-form upload | Thai image hints and size errors, signed-copy button, validation; financial/payout actions unchanged. |
| billing, return and invoices/{invoiceId} | “พร้อมเพย์”, “ผู้ให้บริการรับชำระเงิน”, “ยืนยันและไปหน้าชำระเงิน”; pending/unknown/refund/document error wrapping. |
| tax/pnd53 (ENTERPRISE) | Thai month/status, translated issue body and ordinal accessible label, Thai unknown-code fallback. |
| settings/tax-signature and 50 ทวิ entry (ENTERPRISE) | Permission notice does not misname a role; Thai signature-file types. |
| user-guide/expenses, reimbursements, substitute-receipts | Corrected return-for-correction guidance, upload formats/limits, Thai substitute-number description. |
| LINE capability and file follow-up answers | Empty capability list/disabled feature directs the right permission holder; oversized/unsupported file and stored failed/partial/paused answers use the same Thai source; no raw MIME codes. |

## Files changed

- `apps/ai-gateway/src/modules/line-ai/agents/accounting-summary.agent.ts` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts` — Three final guide SHA-256 pins; card bodies unchanged.
- `apps/ai-gateway/src/modules/line-ai/agents/mangmee-joke-bank.ts` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.spec.ts` — Regression coverage / updated Thai wording expectations.
- `apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/api/src/modules/expenses/expense-capture-lane-parity.spec.ts` — Regression coverage / updated Thai wording expectations.
- `apps/api/src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts` — Regression coverage / updated Thai wording expectations.
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — Regression coverage / updated Thai wording expectations.
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/api/src/modules/line-ai/domain/logic/line-ai-capability-follow-up.logic.ts` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/api/src/modules/line-ai/domain/logic/line-file-attempt-answer.logic.spec.ts` — Regression coverage / updated Thai wording expectations.
- `apps/api/src/modules/line-ai/domain/logic/line-file-attempt-answer.logic.ts` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/api/src/modules/line-ai/domain/logic/line-non-receipt-reply.logic.spec.ts` — Regression coverage / updated Thai wording expectations.
- `apps/api/src/modules/line-ai/domain/logic/line-non-receipt-reply.logic.ts` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/common/api/api-error-message.spec.ts` — Regression coverage / updated Thai wording expectations.
- `apps/web/src/common/api/api-error-message.ts` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/common/files/upload-file.logic.ts` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/common/i18n/workspace-dictionary.ts` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/common/i18n/workspace-i18n.spec.ts` — Regression coverage / updated Thai wording expectations.
- `apps/web/src/features/auth/AccountEmailOtpPanel.qa.spec.ts` — Regression coverage / updated Thai wording expectations.
- `apps/web/src/features/auth/AccountEmailOtpPanel.tsx` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/auth/ChangePasswordPage.spec.ts` — Regression coverage / updated Thai wording expectations.
- `apps/web/src/features/auth/EmailAccessPage.tsx` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/auth/LegalAcceptancePage.tsx` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/auth/LineQrApprovePage.tsx` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/auth/LoginPage.tsx` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/auth/VerifyEmailPage.tsx` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/auth/auth.api.spec.ts` — Regression coverage / updated Thai wording expectations.
- `apps/web/src/features/billing/BillingAdjustmentsPage.tsx` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/billing/BillingPage.qa.spec.ts` — Regression coverage / updated Thai wording expectations.
- `apps/web/src/features/billing/BillingPage.tsx` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/billing/billing-display.spec.ts` — Regression coverage / updated Thai wording expectations.
- `apps/web/src/features/billing/billing-display.ts` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/billing/billing-error-text.spec.ts` — Regression coverage / updated Thai wording expectations.
- `apps/web/src/features/billing/billing-error-text.ts` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/billing/billing-event-discount.ts` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/branch-settings/BranchSettingsPage.spec.ts` — Regression coverage / updated Thai wording expectations.
- `apps/web/src/features/branch-settings/BranchSettingsPage.tsx` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/company-profile/CompanyProfilePage.tsx` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/company-profile/company-profile.logic.ts` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/employee-access/EmployeeAccessPages.tsx` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/expenses/ExpensesPages.tsx` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/expenses/ForeignCurrencyNotice.spec.ts` — Regression coverage / updated Thai wording expectations.
- `apps/web/src/features/expenses/ForeignCurrencyNotice.tsx` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/expenses/SubstitutePaperSigningPanel.tsx` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/expenses/SubstituteReceiptSettingsPage.tsx` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/expenses/expense-capture-upload.logic.spec.ts` — Regression coverage / updated Thai wording expectations.
- `apps/web/src/features/expenses/expense-capture-upload.logic.ts` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/expenses/expenses.api.spec.ts` — Regression coverage / updated Thai wording expectations.
- `apps/web/src/features/expenses/expenses.api.ts` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/expenses/expenses.model.ts` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/reimbursements/ReimbursementCreatePage.tsx` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/reimbursements/ReimbursementDetailSections.tsx` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/reimbursements/ReimbursementPages.plain-thai.qa.spec.ts` — Regression coverage / updated Thai wording expectations.
- `apps/web/src/features/reimbursements/ReimbursementPaymentForm.qa.spec.ts` — Regression coverage / updated Thai wording expectations.
- `apps/web/src/features/reimbursements/reimbursements.model.ts` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/reimbursements/reimbursements.payment-slip.spec.ts` — Regression coverage / updated Thai wording expectations.
- `apps/web/src/features/tax/Pnd53Page.tsx` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/tax/TaxSignatureSettingsPage.tsx` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/tax/TransactionTaxLineSelector.tsx` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/tax/tax.logic.ts` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/user-guide/expenses-guide.content.ts` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/user-guide/reimbursement-guide.content.ts` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/user-guide/substitute-receipt-guide.content.ts` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `apps/web/src/features/web-core-workspace/WorkspaceLayout.tsx` — Sold-surface Thai text or shared display helper; existing guards/actions retained.
- `docs/specs/employee-access-role-management-v2-phase1-spec.md` — Source-of-truth wording/conditions updated.
- `docs/specs/expense-category-default-tax-code-spec.md` — Source-of-truth wording/conditions updated.
- `docs/specs/expense-confirmed-return-for-correction-spec.md` — Source-of-truth wording/conditions updated.
- `docs/specs/expense-receipt-upload-spec.md` — Source-of-truth wording/conditions updated.
- `docs/specs/expense-running-number-flowaccount-spec-th.md` — Source-of-truth wording/conditions updated.
- `docs/specs/line-ai-capability-help-entitlement-spec.md` — Source-of-truth wording/conditions updated.
- `docs/specs/mangmee-line-web-billing-ui-spec-th.md` — Source-of-truth wording/conditions updated.
- `docs/specs/marketplace-buyer-expense-capture-contract-appendix-th.md` — Source-of-truth wording/conditions updated.
- `docs/specs/marketplace-buyer-expense-capture-spec-th.md` — Source-of-truth wording/conditions updated.
- `docs/specs/signup-optional-email-otp-billing-spec-th.md` — Source-of-truth wording/conditions updated.
- `docs/specs/wht-settlement-capture-spec.md` — Source-of-truth wording/conditions updated.
- `packages/contracts/src/ai-tools.ts` — Shared Thai labels/messages reused by web and LINE.
- `packages/contracts/src/expenses.ts` — Shared Thai labels/messages reused by web and LINE.
- `apps/web/src/common/i18n/sold-features-wording.spec.ts` — Regression coverage / updated Thai wording expectations.
- `docs/agent-memory/sold-features-wording-2026-10-03.md` — Discovery, decisions, complete text inventory, red/green evidence and controller checklist.


- `docs/specs/user-facing-error-message-safety-spec.md` — The exact shared 401 sentence uses plain Thai.

## Final login-expiry refinement and verification

Finding recorded before the fix: the technical loanword “เซสชัน” remained in login progress, the shared 401 sentence and LINE QR approval expiry. The wording now uses “การเข้าสู่ระบบ”; the API translator consumes the existing dictionary sentence instead of keeping a duplicate. The corresponding signup spec is updated. No lifetime or authentication behavior changed.

Exact command used for both the old-line proof and final source:

```sh
pnpm --filter @watchdog-bms/web exec node --import tsx --test src/common/i18n/sold-features-wording.spec.ts src/common/api/api-error-message.spec.ts src/features/auth/auth.api.spec.ts src/features/auth/ChangePasswordPage.spec.ts
```

Old production lines restored temporarily: exit 1, 76 tests / 72 pass / 4 fail. Final source restored: exit 0, 76 tests / 76 pass / 0 fail. The four red-then-green tests are:

- `login progress and expiry use shared plain Thai copy`
- `distinguishes a wrong current password from an expired session`
- `localizes the specific wrong-current-password code without relabeling a genuine 401`
- `retains session-expiry guidance when a genuine 401 cannot refresh`

The initial focused run after the wording edit exposed one stale assertion (57 pass / 1 fail), then the other expiry assertions were updated and the old-line proof above was run. The final locked web typecheck exited 0 and the final locked whole-web run exited 0 with **2,780 / 2,780 passing**, 0 failures and 0 skipped. The API typecheck had already passed after its final source changes; this last refinement touches only web copy/tests.


## Final handoff checks

- Final `git diff --check`: exit 0, no whitespace errors.
- Scope audit: no package.json, paid-invoice.ts, billing-schedule.ts, Prisma schema or migration changed; all 5 changed API specs appear in the existing API test script.
- Controller-only database examples (not run here; require the real PostgreSQL test environment): `pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/expense-capture-read.pg.spec.ts src/modules/line-ai/application/line-capture-delivery.pg.spec.ts`. Run the normal CI PostgreSQL gates as well. No database skip is counted as a pass.
- Browser checks: use the 390 px table above; no browser/server was started here.
- Temporary discovery scripts, original-source backups and test logs were removed after recording the exact evidence here. Source changes remain uncommitted for the controller.

## Final feature-promise caller finding (before change)

`expenses.upload_capture_hint`, consumed by `ExpensesPages.tsx`, still said “หรือส่งเข้ามาทาง LINE ก็ได้”. This repeats the optional-feature promise already removed from the dropzone hint. Keep the camera instruction (“ถ่ายใบเสร็จให้เห็นยอดรวมและวันที่ชัด ๆ”) and remove the unrelated LINE invitation. No feature availability or upload action changes.


| Where / case | Old text | New text |
|---|---|---|
| expenses.upload_capture_hint; camera card on the web upload page | ถ่ายใบเสร็จให้เห็นยอดรวมและวันที่ชัด ๆ · หรือส่งเข้ามาทาง LINE ก็ได้ | ถ่ายใบเสร็จให้เห็นยอดรวมและวันที่ชัด ๆ |

Camera/dropzone promise regression: `pnpm --filter @watchdog-bms/web exec node --import tsx --test --test-name-pattern='permission guidance' src/common/i18n/sold-features-wording.spec.ts` exited 1 before the camera-copy fix (1 test / 0 pass / 1 fail). After the fix, `pnpm --filter @watchdog-bms/web exec node --import tsx --test src/common/i18n/sold-features-wording.spec.ts` exited 0 (9 tests / 9 pass / 0 fail). The required locked web typecheck was rerun and exited 0; the complete web suite was rerun with all S3_* variables removed and exited 0 (2,780 tests / 2,780 pass / 0 fail / 0 skipped, 571 suites). Final `git diff --check` exited 0. Temporary logs removed after recording these results.
