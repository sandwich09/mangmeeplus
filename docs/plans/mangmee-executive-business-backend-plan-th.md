# แผนหลังบ้านและการเชื่อมระบบผู้บริหารมั่งมี

คำที่แสดงบนหน้าจอล่าสุด: [ใช้คำที่คนทั่วไปเข้าใจ](../specs/mangmee-executive-plain-language-spec-th.md) — เมนู “รายรับ”, แท็บ “ลูกค้าที่สร้างรายรับสูง”; identifiers/สูตรเดิมคงไว้

มติล่าสุด 2026-10-01: พักและซ่อนฟีเจอร์ลบข้อมูล; G ทั้ง 35 ข้อยังไม่ปิดใน application — 22 OPEN และ 13 DEFERRED ตาม audit. ผล 188 scenarios/58 tests ด้านล่างเป็น baseline ก่อนพัก ไม่ใช่ acceptance ของ scope ปัจจุบันทั้งหมด

วันที่: 2026-10-01
สถานะ: **จบรอบออกแบบและจำลอง — ยังไม่เขียน application code ตามคำขอผู้ใช้**
Spec: [Backend](../specs/mangmee-executive-business-backend-spec-th.md)
Audit: [Bug gap impact](../research/mangmee-executive-business-be-gap-impact-2026-10-01-th.md)
QA: [E2E simulation](../qa/mangmee-executive-business-e2e-simulation-2026-10-01-th.md)
UI: [Screen and theme](../specs/mangmee-executive-business-ui-spec-th.md)
Memory: [Task state](../agent-memory/executive-business-demo.md)

## 1. ผลรอบออกแบบ

- [x] เก็บมติ B1–B8 และ paid-not-started กลุ่มเดียว
- [x] ตรวจ FE demo/source, API/controller/service, contracts, Prisma, permissions และ existing tests
- [x] แยก current implementation, proposed contract, demo limitation และ open product policy
- [x] นิยาม 16 requirements, proposed API01–10/API12 และ reuse API11 data-rights
- [x] นิยาม population/time/filter/snapshot/coverage, cash movements, usage taxonomy, attribution และบัญชี
- [x] ตรวจ 35 findings พร้อม source และผลกระทบ 19 module groups
- [x] จำลอง 12 journeys และ 188 scenario cases รวม negative/boundary/replay/race/recovery
- [x] รัน existing browser demo check ผ่าน และ existing focused BE tests 58 ผ่าน
- [ ] ปิด Q01–Q05/Q09 สำหรับรายงานและบัญชี; Q06–Q08 DEFERRED
- [ ] เขียน implementation หลังผู้ใช้เริ่มงานรอบถัดไปเท่านั้น
- [ ] รัน FE→HTTP→DB integration, concurrency, failure injection และ release acceptance

## 2. ลำดับ implementation ที่เสนอ

| Stage | งานขั้นต่ำ | ขึ้นกับ | Acceptance / stop condition |
|---|---|---|---|
| S0 Decisions | ปิด Q01 บัญชี/สิทธิ์, Q02 ประชากร, Q03 usage, Q04 cash, Q05 dimension; Q09 freshness/scale; data-rights Q06–08 DEFERRED | Owner/domain owners | มีคำตอบเป็นมติ ไม่ใช้ fixture แทน policy |
| S1 Platform access | reader role/permission, platform context, shell/menu/landing และ revocation | Q01 | SEC ผ่าน; tenant/billing/sales สิทธิ์ไม่ขยาย |
| S2 Source readiness | classification/entity/mapping, activity coverage และ cash facts ที่ billing เป็น owner | Q02–05 | source reconciliation/backfill coverage; unknown ไม่กลายเป็น 0 |
| S3 Read API | context/overview/directory/analysis/detail/history, snapshot/pagination/errors | S1/S2,Q09 | REP/PAY/USE/SRC/PX01–04/12 ผ่านด้วย DB fixtures |
| S4 FE integration | ต่อ EX-01–04 ด้วย shared components; แก้ hidden filters/negative chart/partial counts | S3 | browser network และ theme states จริง; ไม่มี fixture ใน production |
| S5 Account commands | identity enrollment/activation/status/audit/outbox/version ใน EX-07/08 | Q01,S1 | USR/PX05–06 ผ่าน; existing user ไม่ duplicate/global disable |
| S6 Case integration — DEFERRED | existing flow ครบ, safe visibility, intake mapping, hold readiness | Q06/Q07 | DR01–28 ผ่าน; policy ไม่ครบปิด execute; ไม่ข้าม guards |
| S7 P31 executor — DEFERRED | inventory, all-data hold, writer fence, legal retention, execution/evidence/restore | Q06–08,S6 | DR29–32/OPS08–16/PX07–11 ผ่าน; ห้ามเปิดจากเวลาอย่างเดียว |
| S8 Acceptance | reconciliation/latency/lag/rollbacks/regressions | stage ที่จะ release | หลักฐานตาม QA§7; อ่าน deployment runbook ก่อน live operations |

Current scope คือ S0–S5 และ S8 เฉพาะรายงาน/บัญชี; S6/S7 พักและไม่เป็น acceptance gate รอบนี้
EX-05/06 และ case summaries/actions ต้องซ่อนทั้งหมด รวม saved route เดิม; API06 ไม่มี case data
งานรอบนี้ไม่ได้อนุมัติให้เริ่ม S1–S8 เขียนโค้ดโดยอัตโนมัติ

## 3. Product และ architecture evidence

- Product goal/journeys/source of truth อยู่ใน spec R01–R16/B1–B8
- Actor/target scope, financial/activity grain, states, hold/evidence และ final mutation boundaries อยู่ BE§11–19
- Migration candidates เป็นข้อเสนอ ต้อง reuse existing primitives ก่อนเพิ่ม table/dependency
- Inventory ของ direct Company relation ไม่ใช่คำสั่งเพิ่ม CASCADE; ตรวจ indirect FK และ retention basis ด้วย
- Auth/data-rights/billing safeguards ต้องมี regression ไม่ถอด guard เพื่อให้ demo flow ผ่าน
- ไม่แก้ package.json เพื่อเพิ่ม script; ไม่มี dependency ใหม่
- ก่อน code edits อ่าน ponytail full จาก repo และ apps/web/AGENTS.md หากแก้ web

## 4. Verification ที่ดำเนินการแล้ว

| ระดับ | ผลรอบ 2026-10-01 | สิ่งที่ไม่พิสูจน์ |
|---|---|---|
| Source/contract audit | E01–E18, พบ G01–G35 | deployed service หรือข้อมูลจริง |
| Local demo browser | PASS: controls/data/local forms/roles/hold presentation/responsive | real auth/HTTP/DB/retention execution |
| Existing focused BE | 58 PASS/0 FAIL/0 SKIP; คำสั่งใน audit§6 | executive endpoints และ hold guard ที่ยังไม่มี |
| Spec simulation | 188 unique cases +12 walkthroughs | runtime ของ 188 cases |
| Documentation | links/IDs/whitespace/fences/traceability/fixture arithmetic ก่อน handoff | legal review/performance/actual integration |

ไม่รัน full app build/typecheck/E2E ทั้งหมด เพราะไม่มี application code เปลี่ยนและยังไม่มี feature backend ให้เชื่อม
การตรวจครั้งต่อไปต้องเพิ่ม focused tests จาก catalog ตาม stage ที่ implement จริง

## 5. Next state

เริ่มปิด Q01 บัญชีและสิทธิ์ จากนั้น Q03 นิยามการใช้ และ Q04 เงินรับ
รายละเอียด deletion Q06–08 พักทั้งหมดตามมติล่าสุด; เปิดกลับมาคุยเมื่อ Owner ขอ
ไม่มีบัญชีจริง คำเชิญ cloud/provider operation การ deploy หรือการลบข้อมูลในรอบเอกสารนี้


## ส่วนเพิ่มกราฟและอันดับ 2026-10-01

- [x] [Extension spec](../specs/mangmee-executive-usage-pareto-spec-th.md): receipt adoption แยก billing receipts, population/coverage, cohort drilldown/sort/paging และ Top spender/Pareto
- [x] Owner ยืนยัน Top spender เป็นเงินจ่ายให้มั่งมีหักคืนเงิน; demo72บริษัทแทนฐานเดิม12บริษัท
- [x] Local math และ browser checks PASS รวม graph→list→detail→Back, all-page cohort reconciliation, responsive และ hidden deletion
- [ ] ปิด source/coverage/metric policy ก่อน integration; reuse API02/03/04/05 โดยเพิ่ม explicit contracts ตาม extension
- [ ] ตรวจ real HTTP/DB/snapshot/concurrency/permission และ source completeness เมื่อเริ่ม implementation

ไม่มี application implementation ในรอบนี้; Q01–Q05/Q09 ยังเปิดตามส่วนที่ยังไม่ยืนยัน, Q06–Q08 ยังคง deferred


## ปรับโครงหน้าผู้บริหาร 2026-10-01

- [x] [Navigation/comparison spec](../specs/mangmee-executive-navigation-comparison-spec-th.md): summary→analysis→companylist→detail, one-level submenu, focused tabs, compact filters และA/B
- [x] Localdemo แยกusage/revenue/customers/compare; overviewสั้น; mobilemenuใช้themedselector; deletionยังซ่อน
- [x] Localbrowserตรวจroutes/Back/A-B/groupdenominator/theme และsaved-state migration
- [ ] เมื่อimplement เพิ่มroute/sectionและcomparisoncontractพร้อมsnapshot/coverage/permissionตามspec; ไม่ส่งทุกanalysisdatasetทุกครั้งโดยไม่จำเป็น
- [ ] แหล่งข้อมูลเดือนก่อนและequal-period comparisonยังรอintegration; ห้ามเปิดgrowth%จากข้อมูลตัวอย่างไม่ครบ


## Export Excel — scope extension 2026-10-01

ตาม [Excel spec](../specs/mangmee-executive-excel-export-spec-th.md): local header action → scoped manifest/fixed Dashboard + source/sheet preview → simulated preparing/ready/error/expired; คง context เมื่อกลับและซ่อนจาก accounts
ออกแบบ API13 bounded binary request, read+export capability, immutable snapshot/all-row query และ typed multi-sheet XLSX โดยต่อยอด shared writer เดิม
ก่อน implement: ยืนยัน Q01 export grants / Q09 limits และ actual source gates; ตรวจ shared writer backward compatibility, source definitions และ all-page membership
ตรวจ local EXL01–09 และ existing navigation suite; EXL10–12 ต้องตรวจ backend/workbookจริงภายหลัง. ไม่เพิ่ม dependencies/app code/cloud mutations รอบออกแบบ


### Owner template amendment — Excel Dashboard v4

Ownerระบุ `outputs/company-infographic-20261001/company-receipts-dashboard-v4.xlsx` เป็นแม่แบบตาม [Excel spec §8](../specs/mangmee-executive-excel-export-spec-th.md#8-แม่แบบและหลักฐานตรวจอ่าน-2026-10-01)
มตินี้แทนsummary-only/optional-company/values-only: ค่าเริ่มต้นเป็นDashboardเขียว–ทอง + nativecharts/สูตร + รายบริษัทที่เป็นsource, 2ชีตหลัก; ตารางคำนวณใต้Dashboardและmetadataในsource
ต้องแยกsource28ก.ย.ของแม่แบบจากfictional30ก.ย.ของเดโม; ไม่ยกสูตรblank=0หรือreceiptทุกสถานะมาเปลี่ยนBE Q03โดยปริยาย
API13รับtemplateKeyแทนincludeCompanies; serverเลือกversion/hash. XG03ต้องตรวจnativechart/formula/cache/renderเพิ่ม; writerเดิมsingle-sheetยังทำไม่ได้
EXL13–14เพิ่มintegrationacceptance; baseline188/47deferredไม่เปลี่ยนและไม่มีgapimplementationปิดจากการอ่านแม่แบบ. ไม่แก้ไฟล์อ้างอิงและไม่สร้างXLSXใหม่รอบนี้
