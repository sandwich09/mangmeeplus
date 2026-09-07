# MANGMEE: ISO/IEC 29110 และ SME Spring Board — ผลค้นคว้าและเทียบหลักฐาน

วันที่ตรวจ: 6 กันยายน 2569 (2026-09-06)

สถานะ: Research / preliminary evidence mapping; ยังไม่ใช่ผลประเมินรับรอง

ขอบเขต: อ่านแหล่งทางการ ISO, IEC, depa, สสว./BDS และสุ่มตรวจเอกสารใน checkout นี้ โดยตีความว่ามั่งมีต้องการเป็นผู้ให้บริการซอฟต์แวร์ให้ลูกค้า SME เลือกซื้อผ่านโครงการ ไม่ใช่สมัครรับอุดหนุนในฐานะผู้ซื้อเทคโนโลยี ไม่มีการตรวจบริษัทในระบบทะเบียน ไม่มีการเข้าระบบ GitHub/AWS เพื่อตรวจหลักฐานย้อนหลัง และไม่มีการสมัครหรือส่งข้อมูลภายนอก

## 1. ข้อสรุปที่ใช้ตัดสินใจได้

- ใช้ของเดิมเป็นหลักได้: repo มี spec, plan, guidelines, QA evidence, deployment runbook, deployment memory และ bug board อยู่จริง
- ยังไม่มีฐานให้สรุปว่า “พร้อม 70–80%” หรือ “เหลือเพียง 4 ตัว”: การมีเนื้อหาไม่เท่ากับมีหลักฐานที่ครบและอยู่ในโครงการ/รุ่นเดียวกัน
- Development Guideline, Release/Deployment Record และ Maintenance Record มีต้นทางแล้ว จึงควรรวบรวมและเติมช่องว่างก่อนสร้างระบบใหม่
- ไม่พบชุด CR กลางที่ตรวจได้ครบทั้งผู้ขอ เหตุผล ผลกระทบ การตัดสินใจของผู้อนุมัติ และผลการนำไปใช้จากเอกสารที่ตรวจ แต่ไม่ได้พิสูจน์ว่าองค์กรไม่มีข้อมูลเหล่านี้ใน PR, email หรือเครื่องมืออื่น
- ต้องตรวจเรื่อง project baseline/approval, traceability, acceptance/closure, configuration/repository control เพิ่มด้วย รายการ 13 ชื่อของผู้ใช้ใช้เป็นดัชนีภายในได้ แต่ยังไม่พบว่าเป็น checklist ทางการของหน่วยรับรองที่มั่งมีจะใช้

## 2. โครงการและมาตรฐานที่เกี่ยวข้อง

### SME Spring Board

โครงการอยู่ภายใต้ สสว./BDS โดยร่วมกับ depa และ SME D BANK สนับสนุนฝั่ง SME ที่เลือกใช้เทคโนโลยี 50% สูงสุด 500,000 บาทต่อรายตามวงเงินคงเหลือและเงื่อนไข ผู้ให้บริการซอฟต์แวร์ต้องได้รับการรับรองขึ้นทะเบียนบัญชีบริการดิจิทัลของ depa ดังนั้นใบ ISO เพียงอย่างเดียวยังไม่ใช่หลักฐานว่ามั่งมีพร้อมให้ลูกค้าเลือกซื้อใน BDS แล้ว [หน้าโครงการ BDS](https://bds.sme.go.th/Project/Detail/15)

รอบที่หน้าโครงการแสดง ณ วันตรวจ รับข้อเสนอ 5 สิงหาคม–30 กันยายน 2569 เวลา 17:00 และกำหนดดำเนินโครงการเสร็จภายใน 30 กันยายน 2570 วันที่นี้เป็นรอบยื่นข้อเสนอของ SME ไม่ใช่การยืนยันว่าการขึ้นทะเบียนผู้ให้บริการใหม่จะเสร็จทัน [รายละเอียดกำหนดการ](https://bds.sme.go.th/Project/Detail/15)

เส้นทางที่ควรวางแผนสำหรับมั่งมี: กำหนดขอบเขตรับรองกระบวนการพัฒนาซอฟต์แวร์ → รับรองตามเกณฑ์ที่ยอมรับ → ขึ้นทะเบียนผลิตภัณฑ์ใน Thailand Digital Catalog → ตรวจสถานะผู้ให้บริการและแพ็กเกจบริการใน BDS ของรอบที่ต้องการเข้าร่วม ขั้นตอน/เอกสารเฉพาะผู้ให้บริการต้องยืนยันกับเจ้าหน้าที่ก่อนถือว่าพร้อมขายผ่านโครงการ

ช่องทางสอบถามหน่วยงานผู้ให้บริการทางธุรกิจที่ BDS ระบุ: 02-142-9077, 02-142-9078; bds@sme.go.th [ข้อมูลติดต่อ BDS](https://bds.sme.go.th/Project/Detail/15)

### โครงการสนับสนุนค่ารับรอง ISO ของ depa ปี 2569

หน้า depa ใช้ชื่อ Batch 2 แต่ PDF ที่ลิงก์อยู่มีตาราง “รอบที่ 1” และช่วงสมัคร 1–30 มิถุนายน 2569 จึงใช้ยืนยันได้ว่าเอกสารปี 2569 ระบุอะไร แต่ยังยืนยันไม่ได้ว่ารับสมัครใหม่อยู่ในวันที่ตรวจ ห้ามใช้ชื่อ Batch 2 เป็นหลักฐานว่ายังเปิดรับ [ประกาศ depa](https://www.depa.or.th/en/article-view/iso-29110-2569)

เงื่อนไขสำคัญใน PDF หน้า 1–4:

- รับรอง ISO/IEC 29110 4-1 Basic Profile สำหรับผู้พัฒนาซอฟต์แวร์
- นิติบุคคลเอกชน ไทยถือหุ้นอย่างน้อย 51%; เป็นผู้พัฒนาซอฟต์แวร์หรือมีหน่วยพัฒนาซอฟต์แวร์
- บุคลากรในองค์กรอย่างน้อย 5 คน; ข้อ 4 ของเอกสารระบุรายได้ไม่เกิน 300 ล้านบาทและจ้างงานไม่เกิน 100 คน
- ไม่เคยรับทุนโครงการ ISO/IEC 29110 ของ depa มาก่อน; มีสินค้าที่ขึ้นบัญชีบริการดิจิทัลได้ และต้องนำเข้าอย่างน้อย 1 ผลิตภัณฑ์เมื่อจบโครงการ
- ใช้โครงการนำร่องอย่างน้อย 1 โครงการ มี gap analysis, consult, pre-assessment และ assessment
- มูลค่าโครงการ 85,000 บาท; depa สนับสนุนไม่เกิน 30,000 บาท; ผู้ประกอบการจ่าย 55,000 บาทไม่รวม VAT 7%; ค่าสมัคร 40 บาท ตามเงื่อนไขการคัดเลือก/โควตา

ทั้งหมดข้างต้นเป็นเงื่อนไขของโครงการสนับสนุนตามเอกสาร ไม่ใช่ข้อกำหนดว่าทุกองค์กรที่จะทำ ISO ต้องมีพนักงานอย่างน้อย 5 คน [PDF ต้นทางที่ depa แนบ](https://drive.google.com/file/d/1PrVpzOqsgDtMwy_GDcUopY6xfx3VL8yI/view)

### ฉบับมาตรฐาน

- ISO/IEC 29110-4-1:2018 เป็น profile specification ของ Software Basic Profile; ISO ระบุว่ายืนยันความเป็นปัจจุบันในปี 2024 [ISO 4-1:2018](https://www.iso.org/standard/67223.html)
- คู่มือปัจจุบัน ISO/IEC 29110-5-1-2:2025 ครอบคลุม Project Management และ Software Implementation สำหรับทีม/ผลิตภัณฑ์เดียว และรองรับข้อตกลงภายในหรือภายนอกองค์กร [ISO 5-1-2:2025](https://www.iso.org/standard/82669.html)
- คู่มือ 2025 แทน TR ฉบับ 2011; หน้า IEC แสดงราคา CHF 0 ณ วันตรวจ สามารถใช้เป็นแหล่งศึกษาทางการ และควรให้หน่วยรับรองยืนยัน edition/profile/checklist ที่จะใช้ประเมิน [IEC](https://webstore.iec.ch/en/publication/105848)

## 3. เทียบ 13 รายการกับสิ่งที่พบในมั่งมี

จัดเลขใหม่เพื่อไม่ให้ซ้ำตามข้อความต้นฉบับ “พบต้นทาง” หมายถึงอ่านเอกสารที่เกี่ยวข้องแล้ว ไม่ได้หมายความว่าผ่าน audit หรืออนุมัติครบ “ยังไม่ยืนยัน” หมายถึงไม่พบหลักฐานครบในขอบเขตที่ตรวจ ไม่ใช่ยืนยันว่าไม่มีทั้งองค์กร

| # | รายการ | ต้นทางที่ตรวจ | สถานะและงานที่ยังต้องทำ |
|---|---|---|---|
| 1 | Project Plan | [Master plan index](../plans/mangmee-master-plan-index-th.md), [Master checklist](../plans/master-implementation-checklist.md) | มีโครงแผน/ขอบเขต ต้องเลือกโครงการนำร่องและผูกรุ่นแผนกับผู้รับผิดชอบ ทรัพยากร สิ่งส่งมอบ เกณฑ์รับมอบ และการอนุมัติ; Proposal ทางธุรกิจที่ผู้ใช้อ้างยังไม่ได้รับมาตรวจ |
| 2 | Project Schedule | [Roadmap](../plans/implementation-roadmap.md), master plan index | มีลำดับและสถานะงาน ต้องยืนยันกำหนดเริ่ม/จบ ผู้รับผิดชอบ แผนเทียบผลจริง และการปรับแผนของโครงการนำร่อง; ลำดับ milestone อย่างเดียวไม่แสดง schedule baseline |
| 3 | Risk Management | [Risk register ของ VAT reconciliation](../plans/expense-vat-source-reconciliation-plan.md#risk-register) | มีรายการความเสี่ยงเชิงเทคนิค/การป้องกัน/การตรวจจับ ยังไม่ยืนยัน project risk matrix ที่มีระดับความเสี่ยง เจ้าของความเสี่ยง การตอบสนอง และการติดตาม; Risk Matrix ที่ผู้ใช้กล่าวถึงอาจอยู่นอก repo |
| 4 | Requirement Specification | [Requirements coverage](../specs/requirements-coverage.md), [Overview](../specs/sme-business-os-overview.md), feature specs | มี requirement จำนวนมาก เลือกเฉพาะที่เข้า scope นำร่อง ตรึงรุ่นและยืนยัน acceptance criteria/การยอมรับของผู้เกี่ยวข้อง |
| 5 | User Story / User Flow | [Business use cases](../product/business-use-cases.md) | มี actors, goals และ use cases แต่ catalogue ระบุ Draft; ไม่จำเป็นต้องแปลงทั้งหมดเป็นรูปแบบ User Story หาก requirement/ผู้ใช้/เส้นทาง/เกณฑ์ยอมรับตรวจได้ |
| 6 | System Design | [Architecture](../specs/enterprise-architecture-spec.md), [Permission matrix](../specs/permission-matrix.md) | มีต้นทางมาก ต้องผูก requirement กับ design ของรุ่นนำร่องและหลักฐาน review |
| 7 | Test Plan & Test Case | [Auto-register UAT plan](../plans/mangmee-auto-register-uat-test-plan-th.md), [QA playbook](../qa/manual-test-playbook-2026-08.html) | มีแผนและขั้นตอนทดสอบ ต้องเลือกชุดตรง scope พร้อม expected result, environment, version และผู้ทดสอบ; แผน UAT ไม่ใช่ผล UAT |
| 8 | Test Result & UAT | [UI regression evidence](../evidence/main-complete-ui-regression-2026-08-28/README.md), [Release manifest](../../release-evidence/manifest.md) | มีรายงานผลและลิงก์หลักฐานจริง แต่บางรายการระบุยังไม่ทดสอบ/รอคนจริง ยังไม่ยืนยัน customer acceptance ของโครงการนำร่องครบ; local/automated/AI evaluation ไม่แทนรับมอบโดยอัตโนมัติ |
| 9 | Quality Checklist | [Frontend review checklist](../guidelines/web-frontend-code-style.md#review-checklist), [Working instructions](../../AGENTS.md), UI regression evidence | มี checklist และผลแก้ปัญหา ต้องผูกผลตรวจ ผู้ตรวจ วันที่ ข้อบกพร่อง และผลยืนยันหลังแก้ในขอบเขตเดียวกัน |
| 10 | Change Request | decision sections ใน spec/plan/memory และ PR references ใน master index | มีต้นทางการตัดสินใจ แต่ยังไม่พบ CR register ที่ครอบคลุมผู้ขอ เหตุผล ผลกระทบ ผู้ตัดสินใจ/วันที่ สถานะ และลิงก์การเปลี่ยนแปลงครบ; เริ่มใช้ record เดียวต่อคำขอ |
| 11 | Development Guideline | [Backend guideline](../guidelines/backend-hexagonal-code-style.md), [Frontend guideline](../guidelines/web-frontend-code-style.md), [CI](../../.github/workflows/ci.yml), [Deployment runbook](../runbooks/uat-production-v2-deployment.md) | มีอยู่แล้วหลายส่วน รวบรวม workflow 1–2 หน้าพร้อมผู้รับผิดชอบจริงและลิงก์กฎเดิม; ไม่ต้องเขียนคู่มือ coding ใหม่ |
| 12 | Release & Deployment Record | [UAT deploy 2026-08-10](../agent-memory/uat-deploy-2026-08-10.md), deployment runbook, release manifest | มีวัน/environment/SHA/run ID/ผลตรวจใน memory; ทำดัชนี release แล้วตรวจไฟล์ต้นฉบับ CI/approval/ผล deploy ของแต่ละแถวเพิ่ม อย่านับ manifest สถานะ DRAFT เป็น completed release |
| 13 | Maintenance Record | [AI incident memory](../agent-memory/uat-ai-not-responding.md), [Bug board ใน release manifest](../../release-evidence/manifest.md) | มีเหตุขัดข้อง สาเหตุ การแก้ และผลตรวจบางรายการอยู่แล้ว รวม index ที่มี ID/severity/วันที่/ผู้รับผิดชอบที่เป็นคน/สถานะ/หลักฐานปิดงาน และแยก bug ระหว่างพัฒนาจาก incident หลังส่งมอบ |

ตัวอย่างที่ยืนยันได้จากเนื้อหาเอกสาร: memory UAT วันที่ 2026-08-10 บันทึก successful run `31348984824` และ source SHA `54566d1b3e1ed9dec6abc837f2af7a16b315240b` จึงไม่ควรจัด Deployment Record ว่า “ไม่มี” การตรวจครั้งนี้ไม่ได้เปิด run ดังกล่าวซ้ำเพื่อรับรองความถูกต้องของบันทึก

ตัวอย่างข้อจำกัด: release manifest ระบุ DRAFT และ owner fields บางช่องเป็น TBD; Gate E ผู้ใช้จริง 40+ สามคนระบุยังไม่ได้ทำ และบาง AI/UAT evidence ยังเปิดอยู่ ณ เวลาของบันทึกนั้น ต้องหาหลักฐานที่ใหม่กว่าก่อนสรุปสถานะปัจจุบัน ห้ามอ่านคำว่า test pass ของบางส่วนเป็นการรับมอบทั้งระบบ

## 4. ช่องว่างที่ควรตรวจเพิ่มจากรายการเดิม

รายการต่อไปนี้เป็นข้อเสนอจากการเทียบเอกสาร ไม่ใช่การเพิ่มแบบฟอร์มบังคับโดยอ้าง ISO จำนวนตายตัว หลักสูตร depa ปี 2569 ระบุ CM/repository, QA/traceability, project tracking และ requirements/change อย่างชัดเจนใน PDF หน้า 3–4

1. **Baseline และ approval ของโครงการนำร่อง:** ใครว่าจ้างหรือเป็นเจ้าของโครงการ ขอบเขต สิ่งส่งมอบ ตารางเวลา ทรัพยากร และผู้มีสิทธิ์อนุมัติ ต้องเห็นรุ่นและวันจริง โครงการพัฒนาภายในก็มีข้อตกลงภายในได้ตาม scope ของคู่มือ ISO
2. **Traceability ที่ตรวจต่อได้:** `Requirement → Design → PR/commit → Test case → Test result → Release → Acceptance` ใช้ IDs/links เดิมได้ ตาราง requirements coverage ปัจจุบันอธิบายความครอบคลุมของ docs เป็นหลัก จึงยังไม่พิสูจน์สายหลักฐานนี้ครบ
3. **Acceptance และ closure:** ผู้รับมอบที่มีอำนาจจริงยืนยันว่ารุ่นใดผ่านเกณฑ์ใด มีข้อค้างอะไร รับแบบมีเงื่อนไขหรือยังไม่รับ พร้อมวันและ reference การยอมรับ แยกจากบอตรายงาน CI ผ่าน
4. **Configuration/repository/document control:** ต้นฉบับและ version อยู่ไหน สิทธิ์แก้/อนุมัติ ใครดูแล baseline เก็บหลักฐานนานเท่าไร สำรอง/กู้คืนอย่างไร ตรวจความเพียงพอของกฎเดิมก่อนเพิ่มเอกสาร
5. **Progress/review/correction evidence:** มี plan-vs-actual, review decisions และการตามปิดข้อพบอย่างตรวจได้ สำหรับ scope ที่จะประเมิน; ไม่จำเป็นต้องสร้างแบบฟอร์มหลายไฟล์หาก records เดิมเก็บสาระครบ

ตรวจขอบเขตคู่มือผู้ใช้/ติดตั้ง/ปฏิบัติการและสิ่งส่งมอบกับหน่วยรับรองด้วย ไม่ควรถือว่ารายการ 13 ชื่อครอบคลุมสิ่งส่งมอบทั้งหมดแล้ว

## 5. ทำต่ออย่างน้อยที่สุด

### งานเอกสารสี่ตัวเดิม

- **CR:** ใช้ฟอร์มหรือ issue template เดียว: ID/วันที่/ผู้ขอ/สิ่งที่เปลี่ยน/เหตุผล/baseline/ผลกระทบขอบเขต-เวลา-ทรัพยากร-ความเสี่ยง-เอกสาร/ผู้อนุมัติและหลักฐาน/สถานะ/PR-test-release refs ไม่มีลายเซ็นหรืออนุมัติย้อนหลังที่ไม่มีหลักฐาน
- **Development Guideline:** หน้าสรุป workflow `requirement → branch → code → review → test → merge → release` อ้างอิง guidelines/CI/runbook เดิม พร้อมชื่อคนที่รับผิดชอบและวันเริ่มใช้จริง
- **Deployment index:** หนึ่งแถวต่อ release/run: version/SHA/digest/วันเวลา/environment/operator/approval/changes/CI-UAT result/deploy outcome/rollback/หลักฐานต้นทาง ระบุ failed/closed/live ตามจริง
- **Maintenance index:** หนึ่งแถวต่อ bug/incident: ID/วันที่/ผู้แจ้ง/environment/รุ่นที่กระทบ/severity/owner/status/สาเหตุ/การแก้/PR/ผลตรวจ/รุ่นแก้/วันที่ปิด แถวที่ยังไม่ทราบให้ระบุ pending

### ลำดับที่แนะนำ

1. ตรวจคุณสมบัตินิติบุคคล/บุคลากร สถานะทุน ISO และสถานะ Catalog/BDS รวมถึงรอบเวลาที่จะเข้าให้ชัด
2. ขอ profile/edition/checklist และขอบเขตหลักฐานจากหน่วยรับรองที่ใช้จริง โดยไม่ตั้งสมมติฐานว่า 13 ไฟล์พอ
3. เลือกโครงการนำร่องขนาดเล็กในมั่งมี เช่น รอบพัฒนา/ปรับปรุงการรับใบเสร็จและอนุมัติค่าใช้จ่ายที่มี spec/test/release evidence เชื่อมกันได้ ยืนยัน scope กับผู้ประเมินก่อนนำไปเป็นขอบเขตรับรอง
4. ทำ Evidence Index หนึ่งตารางเชื่อมไฟล์เดิม ระบุ `พบต้นทาง / ครบบางส่วน / ยังไม่พบ / ไม่อยู่ใน scope ที่ตกลง` พร้อมเจ้าของและงานที่ต้องเติม
5. เก็บ approval, UAT/acceptance และ records ที่ยังขาดจากการทำงานจริงรอบต่อไป ทำ pre-assessment แล้วแก้เฉพาะข้อพบ

การรวบรวมย้อนหลังที่อ้างหลักฐานจริงทำได้ในเชิงการจัดข้อมูล: บอกว่า “รวบรวมวันที่ 2026-09-06 จากบันทึกวันที่ … / run …” แยกวันที่จัดทำจากวันที่เกิดเหตุ ข้อมูลไม่ทราบให้คงเป็นไม่ทราบ ห้ามเปลี่ยนวันที่ให้ดูเหมือนจัดทำหรืออนุมัติไว้แล้ว

## 6. ข้อที่ยังต้องยืนยัน

- ที่มาของ checklist 13 รายการและหน่วยรับรองที่จะตรวจ
- ชื่อนิติบุคคล/สัดส่วนผู้ถือหุ้น/จำนวนบุคลากร/ประวัติทุน และสถานะ Catalog/BDSP ของมั่งมี
- Batch ISO ที่ยังรับสมัครได้จริง; PDF ที่แนบไม่ยืนยันรอบเปิดปัจจุบัน
- ระยะเวลารับรองและขึ้นทะเบียนทันรอบ SME Spring Board ที่ตั้งเป้าหรือไม่
- Proposal, Risk Matrix, Pilot Test และ customer approval นอก repo ที่ผู้ใช้กล่าวถึง
- ผู้รับผิดชอบ/ผู้อนุมัติ/ผู้รับมอบที่เป็นบุคคลจริง; ชื่อเครื่องมือ AI ใน agent-memory ไม่ทดแทนความรับผิดชอบของบุคคล

## 7. วิธีตรวจและข้อจำกัด

อ่าน AGENTS.md, docs/README.md, ค้นไฟล์/คำด้วย rg และตรวจเอกสารตัวอย่างตามตาราง ไม่ได้ทำ exhaustive audit ของทุกไฟล์ ไม่ได้รันทดสอบซอฟต์แวร์ใหม่และไม่เปลี่ยนโค้ด/runtime ตรวจหน้าเว็บทางการตามลิงก์ และดาวน์โหลด PDF จากลิงก์สาธารณะของ depa อ่านเนื้อหาทั้ง 6 หน้าและตรวจภาพหน้า 1–4 ที่มีเกณฑ์/ตาราง/ค่าใช้จ่าย ไม่ถือ metadata วัน crawl ของผลค้นหาเป็นปีโครงการ

เอกสารนี้เป็นบันทึกข้อค้นพบวันที่จัดทำ ไม่มีการสร้าง test result, approval, deployment หรือ maintenance event ใหม่แทนสิ่งที่ยังไม่มี
