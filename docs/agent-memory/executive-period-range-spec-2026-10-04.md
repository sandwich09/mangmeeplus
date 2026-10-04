# Agent Memory: executive-period-range-spec-2026-10-04

Status:
- สเปกและแผนพร้อมส่ง controller ตรวจ diff; ไม่มี code/test/runtime/prototype/schema/migration/package.json เปลี่ยน ไม่มี commit หรือการแตะระบบจริง
- ช่วงเดือนยังไม่ implement การผ่าน focused specs เดิมไม่ใช่การตรวจรับช่วงเดือน

Owner:
- Codex implementation lane; controller ตรวจ diff/commit และรัน PostgreSQL/browser/capacity acceptance ภายหลัง

Scope:
- API read/export คู่เดือนและ preset context, สูตรทุกตัวเลขบน monthly rows เดิม, distinct/point-in-time/current values, coverage/previous-period/A-B
- แถบตัวกรองร่วม URL/origin/Back/mobile 390 px, layout/charts ต่อหน้า, คำไทยแหล่งเดียว, stages/tests/risks และช่องรอ gap analysis

Decisions:
- อ่าน AGENTS.md และ .agents/skills/ponytail/SKILL.md ก่อนเริ่ม ใช้ ponytail full mode ไม่สร้าง abstraction/dependency/table ช่วงเวลาใหม่
- Q37 เจ้าของตัดสิน 2026-10-04: ช่วงเดือนพร้อมทางลัดหกแบบและกำหนดเอง ไม่มีช่วงวัน
- default คงเดือนปัจจุบันตาม Q32; เลือกขอบที่ built เท่านั้น ช่องกลางขาดไม่ย่อช่วง ALL เริ่มเดือนแรกที่มีข้อมูลทั้งระบบ ไม่ขึ้นกับ segment; การย่อขอบ preset ยังรอ Q38
- จำนวนบริษัทใช้งาน/ชำระเป็น union; เงิน/ตัวนับที่บวกได้รวมเดือน; ค่าสิ้นช่วงแยก CURRENT; ผู้ใช้ไม่ซ้ำ/ใบมีข้อโต้แย้งหลายเดือนไม่บวกจำนวนรายเดือน
- คู่ from/to ใน URL ชน from ที่เคยบอกต้นทาง จึงกำหนด origin และ migration ลิงก์เดือนเดียวเดิมในสเปก ไม่แก้โค้ดใน lane นี้
- คำชุด P01–P53 อยู่ใน plain-language spec ที่เดียว เมื่อ implement ต่อ contracts words เดิม เว็บ re-export/backend export ใช้ชุดเดียว

Open questions:
- Q38: preset ปี/ไตรมาส/12 เดือนที่ขอบต้นยังไม่สร้าง ย่อถึงเดือนแรกที่สร้างแล้วได้หรือไม่? แนะนำย่อเฉพาะขอบต้นและแสดงช่วงจริง ห้ามย่อรูเดือนกลาง/ขอบปลายหรือ ALL ที่ owner กำหนดเดือนแรกของข้อมูล; ยังไม่ทำ branch นี้
- Q39: เลิกใช้คือเหตุการณ์ใด/ไม่ใช้กี่เดือน และกลับมาใช้นับอย่างไร? แนะนำพัก KPI นี้จนมีนิยาม/ประวัติ ไม่ใช้หมดอายุ/ระงับ/INACTIVE แทน
- Q40: ต้องมีผู้ใช้ไม่ซ้ำรวมหลายเดือนหรือแยกเดือนพอ? แนะนำใช้รายเดือนเดิม ถ้ารวมต้องสเปกหลักฐาน distinct/retention/privacy ก่อน ไม่มี schema ใหม่ในแผนช่วงนี้
- Q41: เพดาน 10,000 แถวนับรายบริษัทอย่างเดียวหรือรวมแถวคำนวณเดือนด้วย? แนะนำคงรายบริษัท 10,000 + เพดาน byte/time/capacity ของ monthly source; โค้ดตรวจ input.rows และ spec เดิมยอม 10,000 บริษัทแม้ตารางคำนวณเพิ่ม จึงไม่เปลี่ยนฐานเพดานเอง

Artifacts:
- docs/specs/mangmee-executive-business-backend-spec-th.md — §23/สัญญา/ตารางสูตร/ทะเบียน Q37–Q41
- docs/specs/mangmee-executive-business-ui-spec-th.md — §14/URL/แถบ/layout/ช่องรอ gap analysis
- docs/specs/mangmee-executive-plain-language-spec-th.md — คำชุด P และเงื่อนไขความจริง
- docs/specs/mangmee-executive-navigation-comparison-spec-th.md — ช่วง/previous/origin ตามสัญญาใหม่
- docs/specs/mangmee-executive-usage-pareto-spec-th.md — รวมก่อนจัดอันดับ/cohort และ CURRENT adoption
- docs/specs/mangmee-executive-excel-export-spec-th.md — from/to/แถบ/คำ/รายเดือน/coverage/เพดานที่รอมติ
- docs/plans/mangmee-executive-business-backend-plan-th.md — R1–R4, RP01–RP20, fixture/commands/risks
- docs/plans/mangmee-executive-business-ui-plan-th.md — งานเว็บ/หลักฐานต่อ stage อ้าง checklist ชุดเดียว
- docs/agent-memory/executive-period-range-spec-2026-10-04.md — running note นี้

Verification:
- อ่านเอกสาร/ต้นแบบ source และ contracts/build/read/export จริง; ตรวจ test registration ใน API/contracts package scripts และ CI โดยไม่แก้ package.json
- สแกนคำเดิมของตาราง P 20 ข้อความด้วย rg -l -F ใน spec/test ทุก API/ai-gateway/web/contracts/e2e: exit 0 พบ 3 spec files จึงรันทั้งสามไฟล์ ไม่มีคำ runtime เปลี่ยนและไม่มี stale expectation ที่ต้องแก้ในรอบนี้
- `pnpm --filter @watchdog-bms/web exec node --import tsx --test src/features/executive-reports/executive-reports.logic.spec.ts` — exit 0, 22 pass / 0 fail / 0 skip (tests เดิม)
- `pnpm --filter @watchdog-bms/web exec node --import tsx --test src/features/executive-reports/ExecutiveReportContent.spec.ts` — exit 0, 20 pass / 0 fail / 0 skip (tests เดิม)
- `pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/executive-business/executive-report-read.pg.spec.ts` — exit 0, 32 pass / 0 fail; PostgreSQL suite 1 ชุดถูก SKIP เพราะไม่มี EXECUTIVE_REPORT_READ_TEST_DATABASE_URL (summary ของ node นับ skipped tests=0 เพราะ suite ไม่มี test ถูกสร้าง) ไม่ใช่หลักฐาน real-PG
- ตรวจเอกสารรอบแรก: inline Python 9 เอกสาร/144 ลิงก์ไฟล์/53 รหัสคำ/5 arithmetic assertions: exit 0, 0 errors; รอบท้ายตรวจเพิ่ม 22 anchors ใหม่/11 fixture assertions/คำไม่มีอังกฤษและ scope docs only: exit 0, 0 errors
- `git diff --check` รอบแรกและรอบท้าย exit 0; ตรวจซ้ำหลังอัปเดต note ก่อนส่ง
- ไม่มี test ใหม่หรือเปลี่ยน ไม่มี red/green ของพฤติกรรมช่วงเดือนที่อ้างได้ RP01–RP20 เป็นรายการให้ implementation เขียน test ก่อน fix ไม่ใช่ tests ที่ผ่านแล้ว
- not checked: range runtime/typecheck, PostgreSQL, browser, actual screenshot comparison, export over a range, performance/capacity, deployed service; งานนี้เป็น docs only และ lane ห้าม network/docker/browser/server ไม่มีคำสั่งถูก sandbox ปฏิเสธ

Next:
- ส่ง controller ตรวจ diff และถามเจ้าของ Q38–Q41 ตามข้อแนะนำ
- implementation ต่อ R1–R4 หลังตรวจเอกสาร; รัน red บน production เดิมแล้ว green ตามชื่อ test/command ในแผน; controller ใช้ DB/browser จริงและ merge gap analysis ใน UI §14.5 ก่อนรับ layout
