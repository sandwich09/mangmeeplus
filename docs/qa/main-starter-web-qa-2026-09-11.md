# รายงาน QA ผ่านหน้าเว็บ — แพ็กเกจเริ่มต้น — 11 กันยายน 2026

> รายงานนี้เป็นหลักฐานก่อนแก้ ปิดข้อพบในรอบแก้ไขแล้วตาม [ผล regression และผลกระทบ](starter-fixes-regression-2026-09-11.md); ข้อจำกัด external/local ยังคงตามรายงานใหม่นั้น

สถานะ: **ปิดรอบ local ตามคำตอบผู้ใช้ โดยระบุเคสที่ยังทดสอบไม่ได้** ไม่ใช่การรับรองว่าทุกเคสผ่านหรือพร้อมขึ้น Production และยังไม่ได้แก้โค้ดผลิตภัณฑ์

ทดสอบด้วยการใช้งานจริงบนหน้าเว็บทั้ง SYSTEM_ADMIN, OWNER และ STAFF: สร้างบริษัทใหม่ ตั้งแพ็กเกจ เปิดใช้งานบัญชี กรอกผิด/ถูก ย้อนกลับ รีโหลด สลับผู้ทำงาน ลงลายเซ็น อนุมัติ จ่ายเงิน ย้อนรายการ และตรวจไฟล์ที่ดาวน์โหลดจริง ใช้โค้ดและข้อมูลประกอบการหาสาเหตุ ไม่ใช้การเรียก API แทนการทำรายการทางธุรกิจบน UI

พบ **10 ประเด็น** แบ่งระดับเสนอสำหรับ triage เป็น **P1 จำนวน 1, P2 จำนวน 7, P3 จำนวน 2** รวมทั้งบั๊กและช่องว่างการใช้งาน ประเด็นสำคัญที่สุดคือชุดส่งออกบัญชีไม่ตามหลักฐานต้นทางของรายการเบิกคืน และหลักฐานใบแทนฉบับยกเลิกยังปนกับหลักฐานปัจจุบัน

## ขอบเขตและสภาพแวดล้อม

| รายการ | ค่าที่ใช้จริง |
|---|---|
| Git baseline | main / `07824efc9dd6c53c926b7f275a16581f97b8266e` หลัง fetch และ fast-forward |
| Worktree | `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-main-starter-qa-20260911` |
| Checkout เดิม | `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus` บน `codex/substitute-receipt-local-20260910`; เก็บงานที่แก้ค้างไว้ |
| Local web / API / AI gateway | `http://localhost:3000` / `http://localhost:3001/v1` / port3002 |
| Database | สร้างใหม่ `watchdog_starter_qa_20260911`; Redis DB11 แยกคิว |
| Local containers | stop แล้ว start docker-postgres-1, docker-redis-1, docker-minio-1; เก็บ volumes ไว้ |
| Runtime ที่แทนที่ | หยุด web3000 เดิมจาก `/tmp/mangmee-substitute-step3-edit-20260910`; เปิดบริการจาก main worktree |
| Runtime อื่น | ไม่เปลี่ยนบริการทดสอบอื่น ports3006/3007; ไม่แตะ cloud/UAT/Production |
| Browser | Codex in-app browser และ Chrome; responsive Chrome390×844 และ desktop |
| บริษัททดสอบ | QA เริ่มต้น1109 / `cmtwv2xtb0003tek1mpgwuwwc` / RETAIL |
| ผู้ทำรายการ | SYSTEM_ADMIN, owner `qa.starter1109`, staff `qa.starter.staff1109` |
| แพ็กเกจ | term STARTER_249: 1สาขา/2สมาชิก/30slips; feature preset starter:17keys/7menu groups |
| External dependencies | MODEL_PROVIDER=disabled; ไม่มี LINE channel/provider sandbox สำหรับ E2E |

ขอบเขตอิง [starter preset ใน contracts](../../packages/contracts/src/menu-entitlements.ts): dashboard/notifications, expenses/list/upload/manual/categories/evidence/signatures, reimbursements, AI/LINE assistant, employees/roles/access overview และ company/branches/security รวม admin onboarding/package/lifecycle ที่เกี่ยวข้อง ใบรับรองแทนใบเสร็จและนโยบายอยู่ใน flow ค่าใช้จ่าย การทดลอง VAT/WHT เป็นการตรวจหน้าบันทึกค่าใช้จ่าย ไม่ใช่การรับรอง flow ยื่นภาษีหรือลงบัญชีครบระบบ

ผู้ใช้อนุญาตให้จัดการรหัสผ่านและข้อมูลจำลองใน local แล้ว และเลือก “ปิดรายงาน local ระบุเคสที่ยังทดสอบไม่ได้” เมื่อขาด prerequisite ของ AI/OCR/LINE จึงไม่มีคำถามค้างอยู่

## ประเด็นที่พบและวิธีทำซ้ำ

### F09 — P1: รายการเบิกคืนที่ยืนยันแล้วส่งออกโดยขาดหลักฐานต้นทาง

**ผลกระทบ:** ผู้ส่งต่อบัญชีได้ยอดเงินถูกต้อง แต่ชุดส่งออกไม่แสดงใบรับรองต้นทางและผู้รับรอง ทั้งที่ผู้ใช้เห็นหลักฐานในคำขอเบิก ระบบยังเตือนว่าเอกสารยืนยันแล้วไม่มีไฟล์ และแก้แนบเองในรายการที่ยืนยันแล้วไม่ได้

1. STAFF สร้างค่าใช้จ่าย125บาท → ออกใบรับรองเงินสำรองส่วนตัว SRC-202609-00001 โดย STAFF ลงนามผู้จ่ายและ OWNER ลงนามผู้อนุมัติ
2. STAFF สร้าง RB-202609-00001 จากใบรับรองนั้น → OWNER อนุมัติ ตรวจการเงิน และจ่ายครบ125บาท
3. เปิดหลักฐานทางบัญชีแล้วส่งออกชุดสำนักงานบัญชี หรือส่งออก Excel แบบเต็มจากรายการค่าใช้จ่าย
4. ตรวจรายการผลลัพธ์ EXP-202609-00002

**พบจริง:** หน้าเบิกมีไฟล์ใบรับรองต้นทาง แต่ผลส่งออกแถว EXP00002 ไม่มีผู้ขอเบิกในคอลัมน์ P, อ้างอิงใบแทน/หลักฐานใน AM–AO และแหล่งเงิน/ผู้รับรอง/ประวัติต้นทางใน AT–AV; manifest ไม่มีไฟล์ของ EXP00002 หรือ SRC00001 เลย ทั้งยอดรวม/ยอดจ่าย125และค้างจ่าย0ถูกต้อง ยืนยันซ้ำในไฟล์แบบเต็มหลังยกเลิกรายการบริษัทแล้ว

**ควรเป็น:** ส่งออกหรือลิงก์หลักฐานที่ผูกกับคำขอและใบรับรองต้นทาง โดยรักษาสิทธิ์บริษัท/สาขาและความเป็นเอกสารเดิม ไม่จำเป็นต้องคัดลอกไฟล์หรือเปลี่ยน expense ต้นทางเป็นรายการบัญชีซ้ำ

**โค้ดประกอบ:** [materialize-claim-expenses.service.ts](../../apps/api/src/modules/reimbursements/application/services/materialize-claim-expenses.service.ts) บรรทัด30 เก็บ attachment เป็น null เมื่อมี snapshot และบรรทัด57 เก็บ reimbursementSource; [expense-evidence.use-case.ts](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts) บรรทัด130–148 ตามใบรับรองจาก expense ID ที่ส่งออกเท่านั้น และบรรทัด177 กำหนด requesterName เป็น null จึงไม่ตามต้นทางของ projection

หลักฐาน: [หน้าไม่มีหลักฐาน](evidence/starter-web-20260911/12-reimbursement-evidence-missing.png), [ชุดบัญชีเดิม](evidence/starter-web-20260911/expense-index-all.xlsx), [manifest](evidence/starter-web-20260911/evidence-manifest.json), [ตรวจ cells](evidence/starter-web-20260911/export-inspection.json), [แบบเต็มหลัง void](evidence/starter-web-20260911/expense-list-full-after-void.xlsx)

### F11 — P2: ไฟล์ใบแทนฉบับยกเลิกถูกส่งต่อเป็นหลักฐานปัจจุบันโดยไม่บอกสถานะ

1. สร้าง paper certificate SRC-202609-00002 ของ EXP00003 และอัปโหลดไฟล์ลงนามจำลอง
2. ทดสอบผู้จ่าย/ผู้อนุมัติคนเดียวกันจนระบบปฏิเสธตาม policy → ยกเลิกใบรับรองพร้อมเหตุผล
3. สร้าง SRC-202609-00003 คนละผู้ลงนาม → อ่านครบทุกหน้า ตรวจรับ และออกเอกสารสำเร็จ → ยืนยัน expense
4. เปิดหน้า expense และส่งออกชุดบัญชีก่อน void expense

**พบจริง:** ไฟล์ QA-LOCAL-SRC-00002-signed-fixture.pdf ฉบับที่ยกเลิกยังอยู่ในส่วนเอกสารที่ผ่านการตรวจ และใน manifest เป็น expense.review.evidence ไม่มีสถานะยกเลิก/SUPERSEDED กำกับ ส่วนประวัติในคอลัมน์ AV ระบุเฉพาะ SRC00003 ฉบับปัจจุบัน ผู้รับไฟล์อาจเข้าใจว่าฉบับเก่าได้รับการรับรองด้วย

**ควรเป็น:** เก็บประวัติได้ แต่ต้องแยกและระบุฉบับยกเลิกให้ชัดจากหลักฐานปัจจุบัน

**โค้ดประกอบ:** [prisma-expense.repository.ts](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts) บรรทัด1035–1075 เปลี่ยนสถานะใบรับรองเป็น SUPERSEDED; [expense-evidence.use-case.ts](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts) บรรทัด130–148 รวม attachments ของ expense เข้าชุดส่งออก ขณะที่ใบเก่าที่ยังไม่ issued ไม่เข้าชุด provenance ของ certificates

หลักฐาน: [manifest รายการแรกเป็น SRC00002](evidence/starter-web-20260911/evidence-manifest.json), [Excel แถว EXP00003](evidence/starter-web-20260911/expense-index-all.xlsx), [ไฟล์ฉบับเก่า](evidence/starter-web-20260911/QA-LOCAL-SRC-00002-signed-fixture.pdf)

### F05 — P2: คืนเงินครบแล้ว แต่ต้นทางยังเป็นงานรอตรวจและยังไม่ชำระที่ปิดไม่ได้

ทำ flow F09 จน RB00001 เป็น PAID แล้วรีโหลด dashboard และ EXP00001

**พบจริง:** EXP00001 ยัง READY_FOR_CONFIRMATION/ยังไม่ชำระ125บาท ปุ่มยืนยันปิดพร้อมบอกให้ดำเนินการคืนเงินแยก แม้คืนเงินครบแล้ว Dashboard ยังมีงานรอตรวจ1ใบ และรายการค่าใช้จ่ายแสดงยอดเอกสารรับเข้า250บาทจากต้นทาง125 + projection125

**ควรเป็น:** ต้นทางควรแสดงว่าถูกใช้ในคำขอและชำระคืนแล้ว พร้อมทางไปยังคำขอ และไม่เป็นงานค้างที่ไม่มีทางจบ ตัวเลข250เป็นยอดเอกสารรับเข้า ไม่ใช่หลักฐานว่าลงบัญชีซ้ำ; confirmed expense ยังคงเพียง125บาท จึงไม่เสนอให้ยืนยันต้นทางซ้ำ

**โค้ดประกอบ:** [ExpenseReviewPage.tsx](../../apps/web/src/features/expenses/ExpenseReviewPage.tsx) บรรทัด642–653 ปิดการ confirm สำหรับ PERSONAL_ADVANCE ทุกกรณี; reimbursement mapping ตั้งใจแยก expense projection เพื่อรักษาตัวตนทางบัญชี

หลักฐาน: [ต้นทางหลังจ่าย](evidence/starter-web-20260911/07-source-still-pending-after-paid.png), [รายการสุดท้าย](evidence/starter-web-20260911/19-final-expense-list-after-void.png)

### F03 — P2: เกินโควตา starter แต่ข้อความกลับให้โหลดหน้าใหม่

บริษัทมี HO หนึ่งสาขา → เพิ่มสาขาที่สองด้วยข้อมูลถูกต้อง; บริษัทมี OWNER+STAFF สองสมาชิก → เพิ่มพนักงานอีกคนด้วยเลขประจำตัวและ username ไม่ซ้ำ

**พบจริง:** ทั้งสองเคสถูกปฏิเสธถูกต้อง แต่แสดง “ข้อมูลจากหน้าจอไม่ตรงกับที่ระบบรองรับ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง” แทนการบอกโควตาแพ็กเกจ เคส branchLimit=0 ใน admin ก็ใช้ข้อความเดียวกัน ข้อผิดพลาดเพิ่มสาขายังค้างหลังยกเลิกแล้วเปิดแบบฟอร์มแก้สาขา

**ควรเป็น:** ระบุขีดจำกัด1สาขา/2สมาชิกและทางแก้ที่เกี่ยวข้อง โดยไม่ชวนให้ลองกรอกข้อมูลเดิมซ้ำ

**โค้ดประกอบ:** [plan-term-limit.ts](../../apps/api/src/modules/system-partner-management/application/plan-term-limit.ts) ส่งข้อความ quota ผ่าน UnprocessableEntityException; [api-error-message.ts](../../apps/web/src/common/api/api-error-message.ts) บรรทัด700 ใช้ข้อความทั่วไปสำหรับ422ที่ไม่ mapped

หลักฐาน: [สาขา](evidence/starter-web-20260911/02-branch-limit-wrong-message.png), [จำนวนสมาชิก](evidence/starter-web-20260911/10-employee-limit-wrong-message.png)

### F01 — P2 / product decision: ชื่อแพ็กเกจเริ่มต้นไม่สื่อว่า term และ feature preset แยกกัน

สร้างบริษัทใหม่แล้วเปิด partner detail: term เป็น “เริ่มต้น (STARTER)” จำกัด1/2/30 แต่เปิด19menus; กด feature preset “เริ่มต้น” จึงเปลี่ยนเป็น7menusและปิดเพิ่ม21feature keys หลังบันทึก owner session เดิมยังเห็นเมนูก่อน reload แต่กด Customers แล้วถูกปฏิเสธสิทธิ์; หลัง reload เมนูหายตามแพ็กเกจ

ผู้ดูแลอาจเข้าใจว่าตั้ง starter แล้วทั้งระบบ การสร้างบริษัทมีค่า default ที่รวม CRM ตาม [onboarding spec](../specs/admin-company-onboarding-spec.md) บรรทัด121 ขณะที่ starter preset ปัจจุบันไม่รวม CRM จึงเป็นประเด็นการเชื่อม configuration/คำอธิบายที่ต้องตัดสินใจ ไม่สรุปว่าเป็นการข้ามสิทธิ์

จุดตรวจ: [menu-entitlements.ts](../../packages/contracts/src/menu-entitlements.ts) บรรทัด402–427 และหน้า partner term/feature controls

### F10 — P2: starter มี AI ในรายการแพ็กเกจ แต่ไม่มีทางเข้าจาก sidebar และเสนอ template ที่ใช้ไม่ได้

เปิด starter ให้ owner แล้วรีโหลด: sidebar ไม่มี “AI แนะนำ” ทั้งที่ contract มี เมื่อเปิด `/companies/cmtwv2xtb0003tek1mpgwuwwc/ai-suggestions` โดยตรงเข้าหน้าได้ หน้า request แสดง template ข้ามโมดูล เช่น cash risk, CRM, reorder, tax และ workflow เลือก tax evidence แล้วส่ง →403พร้อมบอกให้ติดต่อเจ้าของร้าน แม้บัญชีนี้เป็น OWNER

ควรมีทางเข้าสอดคล้องกับแพ็กเกจ และแสดงตัวเลือกที่แหล่งข้อมูล/สิทธิ์รองรับ หรือบอก prerequisite ก่อนส่ง คำตอบจากโมเดลจริงยังไม่ได้ทดสอบเพราะ provider disabled; แยกจากปัญหา navigation/template นี้

จุดตรวจ: [WorkspaceLayout.tsx](../../apps/web/src/features/web-core-workspace/WorkspaceLayout.tsx) บรรทัด37–56 whitelist ไม่มี ai-suggestions และบรรทัด123กรองทิ้ง; [menu-entitlements.ts](../../packages/contracts/src/menu-entitlements.ts) บรรทัด154–160มีเมนูนี้

หลักฐาน: [owner ส่ง template แล้วถูกปฏิเสธ](evidence/starter-web-20260911/17-ai-starter-template-denied.png)

### F07 — P2: การแจ้งเตือนยังเสนอให้ทำงานที่เสร็จแล้ว

หลังออก SRC00001 และจ่าย RB00001 ครบแล้ว เปิด notifications ของ owner พบรายการเดิมยังบอก “รออนุมัติ/รอตรวจ/พร้อมจ่าย/ต้องดำเนินการ” ต้อง dismiss เอง ทั้งที่งานปลายทางเสร็จ การแจ้งผลปฏิเสธยังแสดงคำ REJECTED ดิบ

ควรเก็บประวัติและสถานะอ่านได้ตามเดิม แต่เปลี่ยนการนำเสนอ action เมื่อรายการปลายทางเสร็จหรือถูกย้อนสถานะแล้ว อ่าน/mark all read/dismiss ทำงานผ่าน รอบนี้ไม่ได้ระบุต้นเหตุ producer ครบทุก event; [dashboard-notifications.logic.ts](../../apps/web/src/features/dashboard-notifications/dashboard-notifications.logic.ts) เป็นจุดเริ่มตรวจข้อความ action

### F08 — P2: คู่มือบอกพฤติกรรมไม่ตรงหน้าเว็บและขอบเขต starter

เปิดคู่มือจาก sidebar แล้วเทียบหน้าทำงานจริง:

- การ์ด VAT จริงระบุว่า “ยังไม่ใช่ยอดภาษีที่ใช้สิทธิ์ได้ ต้องให้บัญชีตรวจ” แต่คู่มือบอกว่า “ภาษีซื้อ (VAT) ที่ขอคืนได้”
- คู่มือบอกมีเมนูย่อย7รายการ แต่หน้าจริงมี8รวม “ลายเซ็นของฉัน”
- คู่มือบอกปุ่มสร้าง/ผ่านรายการ JV และ Tax Code แบบเดิม ซึ่งไม่ตรงหน้าทำงานและสิทธิ์ starter ที่ใช้ทดสอบ
- คู่มือเบิกจ่ายใช้ “คำขอของฉัน” ขณะที่หน้าปัจจุบันใช้ “รายการที่เกี่ยวข้อง”

ควรปรับคำอธิบายให้ตรง UI และบอกขอบเขตสิทธิ์ของขั้นตอนที่ใช้ไม่ได้ใน starter โดยเฉพาะการ์ด VAT ซึ่งทำให้เข้าใจตัวเลขผิด จุดตรวจ: [expenses-guide.content.ts](../../apps/web/src/features/user-guide/expenses-guide.content.ts) บรรทัด81,113,173 และ [reimbursement-guide.content.ts](../../apps/web/src/features/user-guide/reimbursement-guide.content.ts) บรรทัด49,93

หลักฐาน: [คู่มือค่าใช้จ่าย](evidence/starter-web-20260911/guide-expenses.txt), [คู่มือเบิกจ่าย](evidence/starter-web-20260911/guide-reimbursements.txt), [การ์ด VAT จริง](evidence/starter-web-20260911/19-final-expense-list-after-void.png)

### F06 — P3: หน้าแก้ STAFF ไม่แสดงสิทธิ์เดิมผ่าน checkbox งาน

OWNER เปิดแก้ role STAFF: ไม่มี checkbox งานถูกเลือก ทั้งที่ STAFF เพิ่งสร้าง/อัปโหลด/แก้รายการตนเองได้ ทำให้ตรวจทานสิทธิ์ปัจจุบันยาก

ไม่พบหลักฐานว่าสิทธิ์ถูกลบ: ไม่ได้กดบันทึก role มาตรฐาน และโค้ดรักษา unmatched permission keys ใน preservedKeys จึงเป็นปัญหาการมองเห็นสิทธิ์ partial pack ควรแสดงให้ผู้แก้ role เข้าใจ ไม่สรุปเป็น permission loss

จุดตรวจ: [EmployeeAccessPages.tsx](../../apps/web/src/features/employee-access/EmployeeAccessPages.tsx) บรรทัด901–970; หลักฐาน [STAFF ไม่มีงานถูกเลือก](evidence/starter-web-20260911/09-staff-edit-no-tasks-selected.png)

### F02 — P3: หัวข้อแพ็กเกจซ้ำ และ React key ซ้ำบน partner detail

เปิด partner detail ของบริษัทใหม่ พบหัวข้อ “แพ็กเกจและอายุการใช้งาน” ซ้ำติดกัน และ console แจ้ง duplicate child key เท่ากับ company ID ทำซ้ำหลังเปิดหน้าได้ ยังไม่พบข้อมูลสูญหายหรือการบันทึกผิด section

จุดตรวจ: [PartnerDetailPage.tsx](../../apps/web/src/features/system-partners/PartnerDetailPage.tsx) บรรทัด1772,2432–2433,2490; PlanTermSection และ AiUsageBudgetSection ใช้ key เดียวกัน ไม่ยืนยันว่าคำเตือน key เป็นสาเหตุของหัวข้อซ้ำ

หลักฐาน: [admin console](evidence/starter-web-20260911/admin-console.json)

## Coverage ที่รันผ่านหน้าเว็บจริง

PASS หมายถึง assertions ที่ระบุในแถวนั้นผ่าน; FAIL อ้างถึงประเด็นด้านบน; BLOCKED และ NOT RUN แยกด้านล่าง แถวหนึ่งอาจรวมหลายขั้นตอน จึงไม่ใช้จำนวนแถวอ้างว่าเป็นจำนวน test cases ทั้งระบบ

| กลุ่ม | การทดสอบ | ผล |
|---|---|---|
| Login | แบบฟอร์มว่าง,รหัสผิด,admin login ถูกต้อง | PASS |
| Activation | owner/staff ใช้รหัสชั่วคราว → บังคับเปลี่ยนรหัส; direct dashboard ข้ามไม่ได้ | PASS |
| Password | ช่องว่าง/รหัสสั้นถูกปฏิเสธ; รหัสใหม่เข้าได้และรหัสเก่าเข้าไม่ได้ | PASS |
| Legal/logout | ต้องยอมรับครบ3checkbox; logout confirmation | PASS |
| Admin onboarding | required error; สร้างบริษัท/HO/owner/handoff และ chart175รายการ | PASS |
| Admin package | preview19→7,cancel/revert ไม่บันทึก; save17keys/reload คงอยู่ | PASS; ชื่อ term/default ต่างกัน F01 |
| Admin handoff | หลัง owner เปลี่ยนรหัส ไม่เปิดเผยรหัสชั่วคราวเก่า | PASS |
| Admin term | renew0มีข้อความเฉพาะ; +1วันสำเร็จ อายุ31วันถึง12Oct2026 | PASS |
| Admin validation | branchLimit0ถูกปฏิเสธ | FAIL เฉพาะข้อความ F03 |
| Company lifecycle | disable → existing session denied,metadata locked → activate/Retry ใช้ต่อได้ | PASS |
| Tenant/role boundary | owner เข้า system partners และ seed-local-company-2 ไม่ได้ | PASS |
| Entitlement | ปิด CRM แล้ว backend ปฏิเสธ owner เดิม; reload ลบเมนู | PASS สิทธิ์; stale nav ประกอบ F01 |
| Dashboard | วันนี้/สัปดาห์/เดือน/ไตรมาส date range; pending/outstanding รวมตาม UI; empty staff | PASS |
| Dashboard completion | คืนเงินแล้ว confirmed125/outstanding0 แต่ต้นทาง pending1 | FAIL F05 |
| Company profile | tax ID/phoneผิด; ชื่อ/ที่อยู่/tax ID/NOT_REGISTERED/phone ถูก save/reopen คงอยู่ | PASS |
| Branch | tax branch codeผิด; HO rename คงอยู่; ลบ scope สาขาสุดท้ายของ staff ไม่ได้ | PASS |
| Branch quota | สาขาที่สองไม่ถูกสร้าง | FAIL เฉพาะ feedback F03 |
| Employee wizard | name/email/phone/position/role validation; back คงค่าหลัก; create/activate | PASS |
| Employee duplicate | เลขประจำตัวซ้ำกลับ step1พร้อม error; username ถูกล้างเมื่อกลับจาก error | PASS guard; บันทึกพฤติกรรมการคงค่า |
| Employee quota | OWNER+STAFFครบ2แล้วเพิ่มอีกคนถูกปฏิเสธ | FAIL เฉพาะ feedback F03 |
| Employee lifecycle | disable staff → active session denied; enable/Retry กลับเข้าได้ | PASS |
| Custom role | สร้าง QAอ่านค่าใช้จ่าย/assign → staff manual route denied → คืน STAFF | PASS |
| Standard role | STAFF checkbox ไม่สะท้อนสิทธิ์ partial ที่มีอยู่ | FAIL F06 |
| Categories | empty/create/rename/off/on/duplicate/archive; archived ไม่อยู่ picker | PASS |
| Manual expense | คำอธิบายว่าง/ยอด0/จำนวนติดลบ; เพิ่ม/ลบบรรทัด; vendor required; back/save คงค่า | PASS |
| Arithmetic | 2×50.25−0.50=100; ค่าส่ง20+บริการ5รวม125 | PASS |
| Expense permission | STAFF tax controls locked; OWNER ตรวจได้; STAFF เข้า categories/permissions ไม่ได้ | PASS |
| VAT/WHT form | exclusive1000/inclusive1070 → base1000/VAT70/WHT30/net1040; rate/payee type required | PASS คำนวณ; ไม่ใช่ tax filing |
| Review gates | หลักฐาน/การจำแนกไม่ครบห้าม confirm; มีทางไปใบแทน | PASS |
| Upload | empty/TXTถูกปฏิเสธ; PDFเข้า review; reread มี manual fallback เมื่อ provider disabled | PASS upload/fallback; OCRจริง BLOCKED |
| Delete draft | cancelเก็บ draft; confirmลบ OCR draftจำลอง | PASS |
| Signature asset | OWNER/STAFF วาดลายเซ็นจำลองแยก; blank/clear saveไม่ได้; reloadคงอยู่ | PASS |
| Digital certificate | wizard เงินสำรองส่วนตัว125/cash; payer/purpose/company/amountตรง | PASS |
| Signer boundary | OWNERลงนามแทน STAFFไม่ได้; STAFFไม่มี approval action | PASS |
| Digital consent | ต้องเปิดเอกสารเต็ม/ackก่อนเซ็นทั้งสองคน; issuedไม่มี actionซ้ำ | PASS |
| Digital PDF | ดาวน์โหลด/render A4หนึ่งหน้า Thai/125/สองลายเซ็นตรง; Chrome viewer | PASS |
| Claim creation | source SRC issued; date/amount/source locked; reason required; draft/submit | PASS |
| Claim rejection | reason required; STAFF reopen/edit/resubmit serialเดิม/historyคงอยู่/signature cleared | PASS |
| Claim approval | OWNER approve/finance review/payout125/outstanding0 | PASS |
| Claim reversal | reason+ack; payment VOIDED/historyคงอยู่/outstanding125; จ่ายเต็มอีกครั้ง | PASS |
| Claim boundaries | 0/over126/partial50ไม่ผ่านตาม full-only policy | PASS; ข้อความมีคำ MVP |
| Claim duplicate | sourceใช้แล้ว disabledพร้อมเหตุผล; STAFFไม่มี admin queue action | PASS |
| Reimbursement policy | OWNER/missing receipt with reason saveได้ | PASS; MANAGERเดิมแสดง unavailable แต่ runtime fallback OWNER |
| Substitute policy | NAMED_APPROVERSไม่มีคน saveไม่ได้; เลือก OWNER/save/reload | PASS |
| Paper upload | prepared PDF; TXT rejected; signed fixture/ชื่อ/วัน accepted | PASS |
| Paper separation | คนเดียวจ่าย/อนุมัติ uploadได้แต่ตรวจรับไม่ได้ตาม policy | PASS |
| Paper cancel/recreate | cancel SRC00002มีreason/history → SRC00003version2 | PASS transitions; ไฟล์เก่าปน F11 |
| Paper read gate | 1/2หน้าไม่ปลดack; ครบ2หน้าปลด; ปิดไม่ackไม่ปลด review; เปิดใหม่ reset1/2 | PASS |
| Paper review | 2/3checksยังรับรองไม่ได้; ครบ3issued/บันทึก company cash1000ครั้งเดียว | PASS |
| Payment evidence | transferต้องหลักฐาน; cashไม่บังคับไฟล์โอน | PASS guard; ไม่ทำ transferจริง |
| Source freeze | issued/paymentแล้วแก้วันที่ถูกปฏิเสธ/reloadค่าเดิม; confirmแล้ว readonly | PASS |
| Company void | payment1000ครั้งเดียว; voidexpense/reason → paymentVOIDED/history/confirmedเหลือ125 | PASS |
| Evidence page | all/no-file filters; warningส่งออกไม่มีหลักฐาน; ก่อนvoidconfirmed1125 | PASS UI; FAIL F09/F11 |
| Accountant export | XLSX48columns/2rows1000+125; manifest3files; ดาวน์โหลด/อ่านจริง | PASS structure/amount; FAIL provenance F09/F11 |
| List export | หลังvoid short7columns/full48columns มี EXP00002/125เท่านั้น ตัด pending/void | PASS rows/totals; fullยัง F09 |
| Notifications | rejection/payout delivered; markallread/unread/All/history/dismiss | PASS mechanics; FAIL stale F07 |
| AI | direct route/empty states/request modal เปิดได้ | FAIL F10; generated content BLOCKED |
| LINE entry | user menu linkกดแล้วกลับ dashboardใน local | BLOCKED external; feedbackไม่ชัด |
| Guides | เปิดทุกหัวข้อ expense10/substitute12/reimbursement13 และ links; expenseอ่านเทียบละเอียด | PASS opening; FAIL F08; ไม่อ้าง deep reviewทุกย่อหน้า |
| Mobile | Chrome390×844: completed certificate/drawer/expense search found-notfound/bell/claim list-detail | PASS หลังโหลดเสร็จ ไม่พบ horizontal overflow |

## เคสที่ยังทดสอบไม่ได้และเคสที่ไม่ได้รัน

| สถานะ | ขอบเขต | เหตุผล/สิ่งที่ต้องมีเมื่อเปิดรอบใหม่ |
|---|---|---|
| BLOCKED | OCRอ่านจริง ความแม่นยำ confidence/ยอด และ retryกับprovider | MODEL_PROVIDER=disabled; ต้องมี sandbox และเอกสาร expected results |
| BLOCKED | AIคำตอบจริง การใช้ข้อมูลที่อนุญาต usage/quota/provider failure-recovery | ต้องมี provider; ทบทวนสิทธิ์/template F10ด้วย |
| BLOCKED | LINE login/link callback/context/ส่งใบเสร็จ/notifications/deep links | ไม่มี channel/LIFF/webhook sandbox |
| BLOCKED | อีเมล verificationส่งรับจริง | UIระบุ localไม่พร้อม; ต้องมี mail sandbox |
| NOT RUN | ไฟล์ทุกชนิด/ขนาดสูงสุด/จำนวนหน้าสูงสุด เช่น HEIC,10MB,5หน้า และไฟล์เสียทุกแบบ | ทดสอบ empty/TXT/PDF และ paper review2หน้า |
| NOT RUN | ลงนามใบเบิกครบทุกตำแหน่งและพิมพ์ใบเบิก | ทดสอบ requester signature/edit reset และ approval/payment lifecycle |
| NOT RUN | ทุกแขนงแก้ไขใบรับรองหลังissued, transfer payout E2E, multi-line/multi-source claimsทุกแบบ | ทำ digital personal/paper company/cancel-recreate/cash-reversalตามที่ระบุ |
| NOT RUN | simultaneous edits/double-click races, pagination/exportเกิน500, expiry/rate limits, slip quotaทุกช่วงเวลา | human-style sequential local QA ไม่ใช่ load/concurrency suite |
| NOT RUN | archive/reactivateบริษัท, expired-termจริง, multi-branch success | ทดสอบ disable/activate และ1branch ceiling |
| OUT OF SCOPE | CRM/sales/catalog/ledger posting/tax filing, แพ็กเกจอื่น, real payment/delivery, UAT/Production | ผู้ใช้ระบุ starterและปิดรอบlocal |

ข้อสังเกตที่ยังไม่ยกระดับเป็นบั๊กแยก: fallback OCR หลัง uploadแรกไม่เด่นเท่ากด reread; LINE unavailable วนกลับหน้าเดิม; partial payoutมีคำ MVP; empty searchใช้ข้อความอิงช่วงเวลา ไม่รวมเพิ่มในจำนวน10ประเด็น

## ข้อสงสัยที่ไม่ใช่บั๊กผลิตภัณฑ์ที่ยืนยันได้

- **F04 ปิดข้อสงสัย:** in-app browser ค้างเมื่อแสดง issued PDF แต่ไฟล์ดาวน์โหลด renderถูกต้อง และ native Chrome PDF viewerเปิดได้ จึงไม่รวมเป็นบั๊ก PDF ดู [Chrome](evidence/starter-web-20260911/13-chrome-pdf-preview-pass.png) และ [PDF rendered](evidence/starter-web-20260911/05-issued-pdf.png)
- Download-event timeoutของเครื่องมือไม่ได้แปลว่าดาวน์โหลดล้มเหลว: พบไฟล์ PDF/Excelจริงและตรวจเนื้อหาแล้ว
- selectOptionใช้กับ custom comboboxไม่ได้เพราะ UIเป็น summary/listbox; กด optionจริงแล้วส่งออกผ่าน
- sidebarชั่วคราวระหว่างเปลี่ยน viewportหายเมื่อโหลดใหม่; responsiveจากหน้าโหลดสมบูรณ์ผ่าน [expense](evidence/starter-web-20260911/14-mobile-expense-search-pass.png) / [reimbursement](evidence/starter-web-20260911/15-mobile-reimbursement-pass.png)
- ไม่พบหลักฐาน permission lossจาก F06 หรือบัญชีลงค่าใช้จ่ายซ้ำจาก F05; ต้องรักษาเงื่อนไขนี้ในการแก้

## สถานะข้อมูลทดสอบเมื่อปิดรอบ

| Record | สถานะสุดท้าย |
|---|---|
| Company/OWNER/STAFF | ACTIVE; staffกลับ STAFF; companyเปิดใช้งานหลัง lifecycle test |
| HO/profile | สำนักงานใหญ่ QA; บริษัท QA เริ่มต้น จำกัด; identity/addressทั้งหมดdummy |
| Custom role/category | QA อ่านค่าใช้จ่ายไม่มีสมาชิก; QA วัสดุทดสอบ แก้ชื่อถูกarchive |
| EXP00001 `cmtwvf0bl00catek1rhn50dj5` | PERSONAL_ADVANCE125; READY_FOR_CONFIRMATION/ยังไม่ชำระตามF05 |
| SRC00001 `cmtwvld6w001kbuk13j4stoin` | DIGITAL/ISSUED; สองลายเซ็นจำลอง |
| RB00001 `cmtwvv491003pbuk1683cwwn7` | PAID125/outstanding0; RBPAY00001VOIDED,RBPAY00002active |
| EXP00002 `cmtwvy9a1005sbuk1tqead05q` | reimbursement projection CONFIRMED/paid125 |
| SRC00002 | paper version1 SUPERSEDED; signed fixtureเก่ายังประกอบหลักฐานF11 |
| SRC00003 `cmtwwqq4q00e0buk1av6cxy41` | paper version2เคยISSUED/companypaid1000; ภายหลังยกเลิกตามsourcevoid |
| EXP00003 `cmtwwa63i00b6buk1h4jm3myq` | VOIDED; payment1000VOIDEDhistory |
| OCR draft `cmtww5k5n00a3buk1zwt4pbvt` | ลบผ่าน UI หลังทดสอบfallback |
| Final list | history3; active2/ยอดเอกสาร250; pending1; confirmed1/125; confirmed outstanding0 |

expense-index-all.xlsx และ manifest เป็น snapshot **ก่อน** void EXP00003 จึงมี2รายการ/1125; expense-list-*-after-void.xlsx เป็น snapshot **หลัง** void จึงมี1รายการ/125 ความต่างนี้เป็นผลทดสอบที่ตั้งใจ ไม่ใช่ยอดส่งออกผิด

## หลักฐานและการตรวจสภาพแวดล้อม

- [โฟลเดอร์หลักฐาน](evidence/starter-web-20260911/) เก็บ screenshots, PDFดาวน์โหลดจริง, dummy signed fixtures, Excel, manifest และ text/JSONตรวจค่า
- [ตรวจ exportหลังvoid](evidence/starter-web-20260911/expense-list-export-inspection.json): short7/full48columns มีเพียง125บาท
- [company disabled](evidence/starter-web-20260911/16-disabled-company-session-denied.png) และ [expense void history](evidence/starter-web-20260911/18-company-expense-void-payment-history.png)
- PDF fixturesระบุชื่อ/ลายเซ็นสังเคราะห์และไม่มีธุรกรรมจริง ชื่อภาพ04/06แก้ให้ระบุ loadingตามสิ่งที่ภาพแสดง ไม่ใช้เป็นหลักฐาน PDF fail
- Frozen/offline dependency install, Prisma generation, fresh migrations, shared/API/workers/AI builds, design tokens, seed346permissions/13roles และ launch-gate setupผ่าน Logsอยู่ /tmp/starter-qa-*.log
- ปิดรอบตรวจ `curl -fsS http://localhost:3001/v1/health` ได้ status ok เวลา2026-09-11T12:33:17.968Z; postgres/redis healthy,minio running; web/API/workers/AI processesยังทำงาน
- ไม่รัน unit/E2E suiteทั้งrepoซ้ำ เพราะงานนี้เป็น auditผ่านUIและไม่แก้ product logic; verificationคือ browser journeysและไฟล์ผลลัพธ์ที่ระบุ
- Runtime launcher: /tmp/starter-qa-run-20260911.py; logs /tmp/starter-qa-web.log, /tmp/starter-qa-api.log, /tmp/starter-qa-workers.log, /tmp/starter-qa-ai-gateway.log
- คืน generated diffของ apps/web/next-env.d.tsแล้ว ไม่มีการแก้ product code/package.json, commitหรือpushในรอบนี้

ส่งต่องานแก้โดยเริ่ม F09 → F11 → F05/F03/F10 แล้วทดสอบซ้ำด้วยข้อมูลจำลองชุดนี้ ส่วนF01ต้องตกลงความหมาย term/presetก่อนเปลี่ยน default เปิดรอบ externalเมื่อมีsandboxของAI/OCR/LINEตามรายการBLOCKED
