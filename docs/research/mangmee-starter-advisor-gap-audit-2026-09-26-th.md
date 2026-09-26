# AI มั่งมี: ช่องว่างและประสบการณ์แรกของ Starter

> Scope update — 26 September 2026: เจ้าของขยายงานเป็นทุกแพ็กเกจ/ความถูกต้องจริงของ AI/Financial Intelligence สำหรับ SME และธนาคาร รายงานนี้เป็นการตรวจ Starter รอบแรกจาก checkout เก่า โปรดใช้ `docs/research/mangmee-financial-intelligence-readiness-audit-2026-09-26-th.md` เป็นผลล่าสุด โดยเฉพาะ Enterprise rights, WHT launch state และ AI multiple-month fixes ที่เปลี่ยนแล้วใน recorded Production release `277722ff`.

วันที่: 2026-09-26
สถานะ: SOURCE AUDIT / PRODUCT PROPOSAL — ยังไม่ใช่ spec ที่อนุมัติให้ implement

## 1. ขอบเขตและวิธีตรวจ

- ตรวจ checkout `codex/sales-deal-card-auto-conversion-20260922`, HEAD `4a5817b4` รวมสภาพ working tree ขณะอ่าน
- มีงานแก้ expense correction / gateway runtime ค้างอยู่ก่อนเริ่ม audit; ไม่แก้ ทับ หรือถือว่างานเหล่านั้น release แล้ว
- อ่าน contracts, frontend, API, AI Gateway, worker, schema, existing tests และเอกสารประกอบ ครอบคลุมเส้นทาง Starter ตั้งแต่ signup/เปิดสิทธิ์ → LINE/web → ใบเสร็จ/รายจ่าย → เบิก/จ่าย → dashboard/notification รวมบริบทพนักงาน สิทธิ์ และตั้งค่าบริษัท
- ไม่ได้ audit ทุกโมดูล Enterprise อย่างละเอียด ไม่ได้เปิด cloud, อ่าน live flags, ส่ง LINE, เรียก model provider หรือ deploy
- ผล code inspection และ pure/mocked tests ไม่ใช่หลักฐาน browser UX, production activation, latency จริง หรือความชอบของลูกค้า
- คำว่า “ไม่พบ” จำกัดเฉพาะ surfaces และ source ที่ตรวจ ไม่ใช้แทนข้อพิสูจน์ว่าไม่มีความสามารถนั้นในทุกส่วนของระบบ

## 2. ข้อสรุปสำหรับผลิตภัณฑ์

Starter มีฐานเหมาะกับ “ผู้ช่วยดูรายจ่าย เอกสาร และงานค้าง” แล้ว สิ่งที่ควรเพิ่มก่อนคือการพาผู้ใช้เห็นประโยชน์จากข้อมูลจริง และจัดลำดับสิ่งที่ทำต่อได้ โดยใช้เครื่องมือและระบบแจ้งเตือนเดิม

คำสัญญาที่เหมาะกับข้อมูลปัจจุบัน:

> มั่งมีช่วยเก็บรายจ่ายให้เป็นระเบียบ รู้ว่าอะไรยังค้าง และวันนี้ควรจัดการอะไรต่อ

ยังไม่ควรใช้ข้อมูล Starter เพื่ออ้างกำไร เงินสดทั้งหมด หรือสุขภาพกิจการครบวงจร เพราะ Starter ไม่รวมรายรับ/ยอดธนาคาร/สต็อกครบวงจร และแม้รายการที่บันทึกไว้จะถูกต้องก็ยังไม่ยืนยันว่าบันทึกครบทุกธุรกรรม

## 3. สิ่งที่มีจริงและควรนำกลับมาใช้

| พื้นที่ | Source truth ที่ตรวจ | ผลต่อข้อเสนอ |
|---|---|---|
| แพ็กเกจ | `packages/contracts/src/menu-entitlements.ts:422` เปิด expenses, reimbursement, dashboard_notifications, ai_line_assistant, employee_access, company_settings; `:490` STARTER/BASIC/PRO ใช้ starter preset | ข้อเสนอระยะแรกไม่ต้องเปิด CRM, sales, inventory, banking หรือ ledger เพิ่ม |
| Signup | `apps/web/src/features/auth/EmailAccessPage.tsx:87` public email signup ใหม่ให้เปิดร้านแล้วเลือกแพ็กเกจ; `SignupWelcomePage.tsx:294` ตรวจ term ก่อนบอกพร้อมใช้ | ประสบการณ์ใบแรกเริ่มหลังสิทธิ์พร้อม; ไม่สมมติว่า signup ใหม่มี free trial ส่วน legacy term อาจยังมี |
| ข้อมูลบริษัท | `apps/web/src/features/company-profile/ProfileCompletenessCard.tsx:13` checklist ไม่บล็อกการใช้และพักไว้ได้ | ไม่ต้องเพิ่มแบบสอบถามยาวก่อนใบแรก |
| ทีม | `apps/web/src/features/employee-access/EmployeeAccessPages.tsx:408` มี QR เชื่อม LINE ต่อพนักงาน; `:588` มี branch scope | การเพิ่มพนักงานและสิทธิ์เป็นความสามารถเดิม ไม่ใช่ feature gap; นำเสนอเมื่อเจ้าของมีทีมเบิกจริง |
| Capture | `apps/web/src/features/expenses/ExpensesPages.tsx:401`, `ExpenseReviewPage.tsx:992` มี upload หลายไฟล์, OCR, request/recovery state | ไม่ต้องสร้าง upload/OCR ใหม่เพื่อทำ onboarding |
| ตรวจเอกสาร | `ExpenseReviewPage.tsx:805`, `:1301` มี steps, missing fields, duplicate/source-state checks | ต้องรักษาความต่างระหว่างอ่านสำเร็จ รอตรวจ และยืนยันแล้ว |
| รายจ่าย/ส่งบัญชี | `ExpensesPages.tsx:2363` มียอด/ค้าง/เกินกำหนดและ accountant XLSX export | สิ่งที่ขาดคือการสรุปความพร้อมและพาเก็บงาน ไม่ใช่ export ทั้งชุด |
| เบิกจ่าย | `apps/web/src/features/reimbursements/ReimbursementCreatePage.tsx:165` reuse source และตรวจ eligibility; `apps/api/src/modules/reimbursements/application/use-cases/reimbursement-summary.use-case.ts:16` มี pending approval, overdue approval, approved unpaid | พร้อมต่อยอด “รอเราอนุมัติ / เงินสำรองจ่ายรอคืน” ตามสิทธิ์ผู้ใช้ |
| Daily closing | `apps/api/src/modules/line-ai/application/use-cases/erp-expense-daily-closing.use-case.ts:148`, `:282` มี occurred, paid, outstanding, due, overdue, unscheduled, pending review, evidence blockers, duplicate risks พร้อม scope/source/asOf | ใช้ facts เดิมเป็นฐานการ์ดงานสำคัญได้ |
| Dashboard | `apps/api/src/modules/dashboard-notifications/application/use-cases/generate-snapshot.use-case.ts:21` มี scoped snapshot/cache; `application/providers/expense-summary.provider.ts:39` มี expense totals/queues | ไม่ต้องสร้าง business-state store ใหญ่ก่อนพิสูจน์การ์ด Starter |
| Notification | `apps/workers/src/modules/notifications/notification-jobs.ts:55` มี delivery sweep, snapshot sweep และ owner summary เวลา 07:00 Bangkok; delivery มี retry/dedup/preferences/quiet hours | มีโครง proactive จริงแล้ว แต่ไม่ได้ยืนยันว่ารันบน live ขณะนี้ |
| Workflow | `apps/api/prisma/schema.prisma:7628` WorkflowTask มี source/assignee/priority/due/snooze/completion; `apps/api/src/modules/workflow/domain/workflow-template-catalog.ts:123` มี reimbursement events | ใช้ติดตามงานเดิมก่อนสร้างระบบ task อีกชุด; ต้องตรวจขอบเขตสิทธิ์ Starter ทุก surface |
| AI เร็ว | `apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts:542` มี prepared simple-read; `:1012` native loop รองรับ parallel และ tool เดิม input ต่างกัน | ไม่ควรเสนอว่า parallel/fast path ยังไม่มี |
| ตัวอย่างใกล้เคียงใน repo | `apps/api/src/modules/crm-inbox/domain/logic/crm-daily-brief.logic.ts:63` ทำ facts → severity + deep link; `DashboardPages.tsx:328` จำกัด CRM card ด้วยสิทธิ์ | เรียนแบบการจัด brief ได้ แต่ไม่เปิด CRM ให้ Starter และไม่ถือว่า Starter ได้ brief นี้แล้ว |

## 4. ช่องว่างที่ตรวจพบ

### G1 — ยังไม่มีเส้นทางใบแรกที่ทำให้เห็นประโยชน์ครบในหน้าเริ่มต้น

`apps/web/src/features/dashboard-notifications/DashboardPages.tsx:323–355` แสดง checklist, CRM section ที่มีสิทธิ์ และ generic widget/no-data state ไม่มี Starter-specific first-success card ใน surface นี้

การยืนยันเอกสารใช้ reload/refresh/toast ที่ `ExpenseReviewPage.tsx:356` และข้อความยืนยันที่ `:951`; ไม่พบ result card บน path นี้ที่เชื่อมใบที่ยืนยันแล้วกับภาพรวมและ next action

ข้อเสนอ: หลังเปิดสิทธิ์ พาไป “ส่งใบเสร็จใบแรก → ตรวจเฉพาะจุดที่จำเป็น → ยืนยัน → เห็นรายการและยอดที่บันทึกจริง → เลือกทำต่อหนึ่งอย่าง” ใช้ flow เดิม และรองรับ manual เมื่อไม่มีใบเสร็จ โดยไม่บังคับตั้งค่าที่ไม่จำเป็นก่อน

### G2 — ข้อมูลมีแล้ว แต่ยังไม่มี Starter brief ที่จัดอันดับงาน

Daily closing และ reimbursement summary มี facts แต่ Starter dashboard ยังไม่ประกอบเป็น 1–3 เรื่องที่ควรทำก่อน พร้อมเหตุผล ผู้รับผิดชอบ และลิงก์ไปต้นทาง

ข้อเสนอ: เริ่มจากกฎที่ชัดเจน เช่น เรื่องเกินกำหนดที่ผู้ใช้จัดการได้ → รออนุมัติ → เอกสารที่ต้องตรวจ จากนั้นค่อยพิจารณา amount/age ห้ามบวกจำนวน/ยอดข้าม bucket ที่ทับซ้อน และห้ามรวม expense projection กับ reimbursement เป็นเงินคนละก้อนโดยไม่มี source identity

### G3 — สรุปประจำวันมีชื่อ แต่เนื้อหายังไม่ช่วยตัดสินใจ

`apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts:276–299` สร้าง title “สรุปธุรกิจประจำวัน” แต่ body เป็น `แดชบอร์ดอัปเดตแล้ว ${snapshot.widgets.length} วิดเจ็ต` พร้อมลิงก์ dashboard

ข้อเสนอ: เปลี่ยนเป็น brief จาก facts เดียวกับหน้าเว็บ มีเรื่องที่ทำต่อได้และ deep link งดข้อความซ้ำที่ไม่มีข้อมูลใหม่ ใช้ preference/quiet hours/delivery เดิม กำหนดให้ชัดว่า morning brief แสดงผลเมื่อวานหรือภาระวันนี้ ไม่เรียกยอดรายการวันนี้ตอน 07:00 ว่าเป็นผลทั้งวัน

ข้อควรตรวจเพิ่มก่อน implementation: worker context ใน `notification-sweeps.use-cases.ts:23` มี dashboard permissions ขณะที่ snapshot output กรอง module read permissions จึงมีเส้นทางที่อาจได้ศูนย์ widgets แม้ stored snapshot มีข้อมูล นี่เป็นข้ออนุมานจาก source ยังไม่มี integration reproduction ใน audit นี้ การทำ brief ต้องอ่านภายใต้สิทธิ์ผู้รับที่ถูกต้อง ไม่ขยาย worker permission แล้วส่งทุกคนเท่ากัน

### G4 — คำสัญญาและนิยามตัวเลขต้องตรงกับความสามารถจริง

- `SignupWelcomePage.tsx:22` มี “ถ่ายรูปใบเสร็จส่งในแชต ระบบลงบัญชีให้” แต่ starter ไม่รวม ledger/auto_post: ควรใช้ข้อความช่วยอ่าน/เตรียมรายจ่ายให้ตรวจยืนยัน
- `erp-expense-daily-closing.use-case.ts:282` ค่า `occurredToday.paid` เป็นยอดจ่ายของรายการที่เกิดในวันนั้น ไม่ใช่กระแสเงินสดออกทุกธุรกรรมในวันนั้น
- `expense-summary.provider.ts:39` ยอดในช่วงเป็น CONFIRMED ขณะที่ daily closing ใช้ active non-cancelled; pending/ค้างบางตัวนับทุกช่วงเวลา และ pending dashboard ตัด issued PERSONAL_ADVANCE evidence บางรายการออก
- ความต่างเหล่านี้ไม่ใช่ข้อพิสูจน์ว่า query ผิด ต้องพก period/status/payment basis/scope/asOf ไปกับคำอธิบาย อย่ารวมตัวเลขเพียงเพราะชื่อคล้ายกัน
- งานแก้ capability/status/correction ที่มีอยู่ใน working tree ถูกบันทึกแยกใน `docs/agent-memory/line-ai-expense-edit-capability-consistency-2026-09-26.md`; audit นี้ไม่สร้างงานซ้ำและไม่ถือว่าแก้เสร็จบน live

### G5 — ความครบของคำตอบยังมีข้อจำกัดต่างกันตามเส้นทาง AI

- Native loop รองรับ tool เดิมต่าง input และมี coverage retry จริง พร้อม existing tests ผ่าน
- JSON fallback ที่ `orchestrator.agent.ts:986–1008` ลบ tool name ออกจาก available หลังเรียกครั้งแรก จึงเรียก expense tool เดิมสำหรับอีกช่วงเวลาใน loop นี้ไม่ได้ ไม่ได้หมายความว่าทุกคำถามหลายเดือนพัง
- บันทึกเหตุการณ์ `docs/agent-memory/prod-mangmee-two-month-expense-answer-2026-09-25.md` กล่าวถึง date-candidate passthrough; ใน source gateway turn/runtime ที่อ่านยังไม่พบ `valueCandidates` ต้องตาม integration path นี้แยกจากงาน correction ที่กำลังแก้
- ก่อนทำ advisor เปรียบเทียบช่วงเวลา ต้องพิสูจน์คำตอบครบทุกเดือน/ประเด็นทั้ง native, fallback, prepared และ runtime bridge; tests ที่ผ่านวันนี้ไม่พิสูจน์ส่วน end-to-end นี้ครบ

### G6 — ความจำเป้าหมายและผลคำแนะนำยังไม่ปรากฏใน Starter advisor path

`packages/contracts/src/line-ai.ts:153` และ `process-line-webhook.use-case.ts:5995` ใช้ context 15 นาที/15 turns และอ่าน facts ใหม่ ส่วน `line-advisor-direct-answer.logic.ts:60–77` direct advisor จำกัด SOCIAL_CHAT และปฏิเสธ cards/profile ใน lane นี้

ข้อเสนอระยะถัดไป: ให้เจ้าของเลือกเป้าหมายหนึ่งข้อ เช่น เก็บเอกสารให้ครบ / คุมรายจ่าย / เคลียร์เบิกจ่าย เก็บเป็น preference ที่แก้/ลบได้ แล้วปรับอันดับ brief งานที่เลือกติดตามใช้ task เดิมเมื่อเหมาะสม ไม่ทำ vector memory ของทุกข้อความ และไม่ถือว่ามี recommendation-outcome loop แล้วเพราะมี task table

### G7 — ยังวัด “ได้คุณค่าครั้งแรก” ไม่ตรงกับผลสำเร็จธุรกิจ

`apps/api/src/modules/system-partner-management/application/use-cases/get-partner-timeline.use-case.ts:59` ใช้ OCR usage event และแสดง “ให้ AI อ่านรูปครั้งแรก” ที่ `:114` ซึ่งมีประโยชน์ต่อ support แต่ไม่ยืนยันว่าผู้ใช้ได้รายการที่ตรวจถูกต้องและใช้งานต่อได้

ข้อเสนอ: แยก first read, first confirmed usable expense, first summary viewed, first relevant action completed และ D1/D7 meaningful return ใช้ events ที่มีได้ก่อนเพิ่ม telemetry ใหม่ ไม่ให้การเรียกโมเดลเท่ากับ activation

### G8 — สรุปตามความถี่และ insight รายจ่ายยังมีช่องว่าง

พบ `digestFrequency`/`digestPolicy` ใน DTO/store แต่ไม่พบ consumer รวม digest ตามค่านี้ใน flow ที่ค้น; UI `NotificationPages.tsx:301` ให้ช่องทาง/quiet hours โดยยังไม่ expose schedule/topic ครบ ต้องแยกจาก daily owner summary scheduler ซึ่งมีจริง

ไม่พบ expense anomaly/baseline detector หรือคำแนะนำพร้อมติดตามผลใน modules ที่ตรวจ แม้ breakdown ตามหมวด/สาขามีแล้ว (`erp-business-tools.use-case.ts:295`)

ข้อเสนอ: หลังเก็บข้อมูลเพียงพอ ค่อยเพิ่มเทียบรายจ่ายในช่วงที่เทียบกันได้ พร้อมใบต้นทางและความครบของข้อมูล ไม่สรุปว่า “ประหยัดได้/กำไรเพิ่ม” จากรายจ่ายลดเพียงอย่างเดียว

## 5. ลำดับที่เสนอ

| ลำดับ | ชุดงาน | สิ่งที่ผู้ใช้ได้รับ | ขอบเขตเล็กที่สุด |
|---|---|---|---|
| 0 | ความไว้ใจ | สถานะเอกสารและตัวเลขที่เข้าใจตรงกัน คำถามหลายช่วงได้รับคำตอบครบ | Copy + data semantics + capability consistency ที่กำลังทำ + completeness ของ affected paths |
| 1 | ใบแรกเห็นผล | เก็บรายจ่ายจริงสำเร็จและรู้ว่าจะทำอะไรต่อ | Starter home entry + existing capture/review + result card ไม่มีเมนูใหม่ |
| 2 | วันนี้จัดการอะไร | 1–3 เรื่องสำคัญ มีเหตุผลและเปิดต้นทางได้ | Daily-closing/reimbursement facts + small deterministic ranking + permission-aware deep links |
| 3 | สรุปที่มีประโยชน์ | อ่าน LINE แล้วเห็นเรื่องที่ต้องทำ และกลับมาเห็นว่างานจบแล้ว | Reuse notification/event/task states; ถ้าไม่มีเรื่องใหม่ให้เงียบตาม preference |
| 4 | สัปดาห์นี้อะไรเปลี่ยน | เห็นหมวด/รายการที่ทำให้รายจ่ายต่างจากเดิม | Comparable periods + source references + explicit missing-data handling |
| 5 | จำความต้องการ | Brief ตรงกับปัญหาของร้านขึ้น | Preference เล็กหนึ่งเป้าหมาย + วัน/เวลา/ความถี่; outcome tracking ภายหลัง |

ไม่เสนอเพิ่มพร้อมกัน: agent แปดตัว, open-web ทุกคำถาม, forecast กำไร/เงินสดของ Starter, onboarding questionnaire ยาว, เมนู advisor แยกใหม่, rewrite OCR/notification/export หรือ full business digital twin

ข้อเสนอ acquisition แยกต่างหาก: หากต้องการให้เห็นประโยชน์ก่อนจ่าย ให้พิจารณาตัวอย่างใบเสร็จ/ร้านสมมติที่ติดป้ายชัด ไม่ปะปนบัญชีจริง นี่เป็น product decision เพิ่ม ไม่ใช่เปลี่ยน trial policy โดยปริยาย

## 6. ตัวอย่างประสบการณ์ที่เสนอ (ข้อมูลสมมติ)

1. หลังแพ็กเกจพร้อม เจ้าของเห็นทางเข้า “เริ่มจากใบเสร็จหนึ่งใบ” ถ่ายรูปหรือใช้ LINE ได้
2. มั่งมีอ่านพบ 980 บาท แต่เรียกว่ายอดที่อ่านได้จนกว่าจะผ่านการตรวจ/ยืนยัน; ถ้าข้อมูลไม่ครบถามเฉพาะจุดสำคัญ
3. หลังยืนยัน แสดงว่าบันทึกรายจ่ายอะไรแล้ว พร้อมลิงก์ต้นทางและยอดรายจ่ายที่ยืนยันในช่วงนั้นจาก query จริง เลือกส่งใบถัดไปหรือดูรายการค้างได้
4. เมื่อมีข้อมูลมากขึ้น หน้าแรก/LINE แสดง “มีใบเสร็จรอตรวจ 2 ใบ และรายการถึงกำหนด 1 ใบ” พร้อมปุ่มที่เปิดตรงรายการ; จำนวนเหล่านี้ไม่บวกเป็นจำนวนธุรกรรมรวมถ้าเป็นใบซ้ำกัน
5. เมื่องานต้นทางปิด เรื่องนั้นออกจาก brief; การอ่านหรือ dismiss แจ้งเตือนไม่ถือว่าชำระเงินหรือยืนยันเอกสารแล้ว

## 7. เกณฑ์พิสูจน์ก่อนยอมรับ implementation

- First value: ผู้ใช้ใหม่หลังสิทธิ์พร้อมทำใบแรกจนได้รายการที่ตรวจถูกต้องได้ โดยไม่ต้องให้ทีมงานบอกเมนู; วัดเวลาจริงแล้วค่อยกำหนดเป้าหมาย
- Data truth: เงิน ช่วงเวลา สถานะ สาขา สกุลเงิน และขอบเขตข้อมูลชัดเจน; ไม่รวม bucket ทับซ้อน/เงินเบิกซ้ำ
- Action quality: ทุกการ์ดมีเหตุผลและ action ที่ผู้รับมีสิทธิ์ทำได้; ลิงก์เปิดรายการตามที่นับจริง และ stale/resolved state ไม่หลอกให้ทำซ้ำ
- Repeat value: วัด D1/D7 meaningful return, first action completion และอัตราปิด/ปิดเสียง notification โดยยังไม่อ้างว่าฟีเจอร์จะเพิ่ม retention จนกว่าจะทดสอบกับลูกค้า
- AI quality/speed: answer completeness, correction rate, fast-path hit rate, model calls และ p50/p95 เวลาจนได้คำตอบที่ใช้ได้; ไม่ใช้เวลาขึ้น loading เป็นเวลาตอบสำเร็จ
- Browser/LINE: ทดสอบทั้งผู้ใช้ใหม่/ไม่มีข้อมูล, owner/staff, web/mobile, ลิงก์เข้า LINE, unavailable/retry, policy/entitlement denied และคำถามหลายเดือน

## 8. Verification ของ audit นี้

Existing pure/mocked/source-assertion tests ผ่านรวม **365/365**, 0 failures จากรายงานแต่ละชุด:

| ชุด | จำนวนผ่าน |
|---|---:|
| Contracts feature-entitlements | 24 |
| Web welcome-handoff | 10 |
| Web dashboard home + dashboard logic + expense review steps + capture status + reimbursement logic | 152 |
| API expense-summary provider + notification logic | 22 |
| API advisor direct answer + classifier | 36 |
| Gateway business-query regression + prepared formatter + tool availability | 74 |
| Gateway native loop + JSON/model loop + coverage critic + prepared eligibility | 47 |

คำสั่ง root ที่รัน:

```sh
# cwd packages/contracts
pnpm exec tsx --test --test-reporter=spec src/feature-entitlements.spec.ts
# cwd apps/web
pnpm exec tsx --test --test-reporter=spec src/features/external-signup/welcome-handoff.logic.spec.ts
```

คำสั่ง web audit ที่รัน:

```sh
pnpm --filter @watchdog-bms/web exec tsx --test src/features/dashboard-notifications/dashboard-home.logic.spec.ts src/features/dashboard-notifications/dashboard-notifications.logic.spec.ts src/features/expenses/expense-review-steps.logic.spec.ts src/features/expenses/expense-capture-status.logic.spec.ts src/features/reimbursements/reimbursements.logic.spec.ts
```

ชุด API/Gateway ที่ audit agents รันด้วย `pnpm exec tsx --test` ภายใต้ package ของตน:

- API: `src/modules/dashboard-notifications/application/providers/expense-summary.provider.spec.ts`, `src/modules/dashboard-notifications/domain/logic/notification.logic.spec.ts`
- API: `src/modules/line-ai/domain/logic/line-advisor-direct-answer.logic.spec.ts`, `src/modules/line-ai/domain/logic/line-ai-classifier.spec.ts`
- Gateway: `src/modules/line-ai/agents/line-ai-business-query-regression.spec.ts`, `src/modules/line-ai/agents/prepared-simple-read-formatter.spec.ts`, `src/modules/line-ai/agents/tool-availability.spec.ts`
- Gateway: `src/modules/line-ai/agents/orchestrator-native-loop.agent.spec.ts`, `src/modules/line-ai/agents/orchestrator-model-loop.agent.spec.ts`, `src/modules/line-ai/agents/coverage-critic.agent.spec.ts`, `src/modules/line-ai/domain/logic/prepared-simple-read.logic.spec.ts`

ไม่ได้รัน browser/end-to-end/provider/cloud ในรอบนี้ เพราะขอบเขตคือ source audit และ brainstorm ไม่มี implementation หรือคำขอ release; tests เหล่านี้ไม่ใช้รับรอง live readiness

## 9. การตัดสินใจถัดไป

ข้อเสนอเริ่มต้นคือเลือกหนึ่ง journey: “ใบแรกสำเร็จ → วันนี้มีอะไรต้องทำ → กลับมาตรวจงานที่จบแล้ว” ก่อนแตก spec/plan ของงานใหม่ กำหนดนิยามยอด กฎจัดอันดับ และขอบเขตการแจ้งเตือนให้ชัด แล้วใช้ existing helpers/contracts/permissions ก่อนเพิ่มโครงสร้างใหม่
