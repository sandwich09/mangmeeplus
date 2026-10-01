# แผนหน้าจอผู้บริหารมั่งมี

คำที่แสดงบนหน้าจอล่าสุด: [ใช้คำที่คนทั่วไปเข้าใจ](../specs/mangmee-executive-plain-language-spec-th.md) — เมนู “รายรับ”, แท็บ “ลูกค้าที่สร้างรายรับสูง”; identifiers/สูตรเดิมคงไว้

มติล่าสุด 2026-10-01: **พักและซ่อน EX-05/06 และคำร้องใน EX-04**; scope ปัจจุบันเป็นรายงานและบัญชีผู้บริหาร. Checkmarks เกี่ยวกับโครงคำร้อง/hold ด้านล่างเป็นประวัติเดโมเดิม ไม่ใช่ feature ที่เปิดในเดโมปัจจุบันหรือเกณฑ์ตรวจรับรอบนี้

สถานะ: **สเปกและเดโม v2 พร้อมตรวจ — ยังไม่เริ่ม application/backend integration**
วันที่: 2026-10-01
Spec: [หน้าจอและธีม](../specs/mangmee-executive-business-ui-spec-th.md)
Backend: [มติธุรกิจและโครงหลังบ้าน](../specs/mangmee-executive-business-backend-spec-th.md)
Memory: [Executive business demo](../agent-memory/executive-business-demo.md)

อัปเดต 2026-10-01: มี [BE และ integration plan](mangmee-executive-business-backend-plan-th.md)
พร้อม [35 findings](../research/mangmee-executive-business-be-gap-impact-2026-10-01-th.md)
และ [188 E2E scenarios](../qa/mangmee-executive-business-e2e-simulation-2026-10-01-th.md)
เดโมผ่าน browser check เดิมอีกครั้ง แต่ยังมี contract gaps ตาม audit และยังไม่ได้แก้โค้ดในรอบนี้

## 1. Scope และ evidence ปัจจุบัน

- [x] ยืนยันผู้ใช้เป็นผู้บริหารแพลตฟอร์มมั่งมี
- [x] ทำเดโมภาพรวม/รายบริษัท/วิเคราะห์/คำร้อง พร้อมช่องทางที่รู้จักและเซลล์ผู้แนะนำ
- [x] ตรวจ shared shell, tokens, field wrappers, themed select/date, popover และสถานะกลาง
- [x] เขียน UI spec พร้อม acceptance และรายการคุยหลังบ้าน
- [x] บันทึกมติ B1–B5/B7/B8: ผู้บริหารปัจจุบัน 4 คน, บริษัทจริง, paid usage, เงินรับจริง, สองบทบาทเซลล์, กลุ่มธุรกิจ และช่วงคงข้อมูล 14 วัน
- [x] เพิ่มสเปกโครง EX-07/08 บัญชีผู้บริหาร และขยาย EX-01/02/04/05/06 ตามมติล่าสุด
- [x] ปรับ P31 ให้มติ 14 วันแทน 1 วัน/ทางลัดเดิม โดยเก็บรายละเอียดที่ยังไม่ตกลงไว้ชัด
- [x] ตกลง B6: คง flow เดิม มาจากเซลล์ระบุเซลล์ มาจากช่องทางระบุช่องทาง ไม่เพิ่มรหัสเซลล์คู่กับทุกช่องทาง
- [x] ตรวจเทียบสเปก/เดโม/source code และบันทึกช่องว่างใน backend draft §8; ยังไม่รับรอง integration
- [x] ปรับเดโมตามมติล่าสุด: ที่มาเซลล์หรือช่องทาง, เครดิตยอดเปิด, paid usage, บัญชีผู้บริหาร และช่วงคงข้อมูล 14 วัน
- [x] เดโมใช้ shared fields/buttons/cards และ tokens/fonts จริง; แทน native selects และ custom theme เดิม
- [x] กำหนด presentation/data contract ใน backend draft §9; แยกส่วนที่ต้องปิดกติกาก่อนเชื่อมจริง
- [x] เดโม v2 ผ่าน browser check: data/permission/form/hold states, dropdown keyboard/dismiss และ responsive 1440–320px; รายละเอียดและภาพอยู่ใน memory
- [x] ตามมติล่าสุด รวมก่อนเริ่มใช้เป็น “จ่ายแล้ว ยังไม่เริ่มใช้” กลุ่มเดียว; coverage ไม่ครบเป็นหมายเหตุแยก และ browser check ผ่านหลังปรับ
- [ ] ตกลง logic/backend spec และ data/permission contracts
- [ ] Implement หน้าจอจริงและเชื่อมข้อมูล
- [ ] ผ่าน browser/theme/integration evidence

รอบแก้ consistency ปรับเอกสารและเดโมในพื้นที่ visualization; ไม่มี application route ใหม่ ไม่มี API/schema/migration และไม่มี deploy
เดโมใช้ components จริงโดย bundle แบบ local; locale ถูกตรึงเป็นไทยแทน session/localStorage ของ application
ผลทดสอบเดโมยืนยัน presentation ของ components ใน sandbox ไม่แทน system-shell/API integration

## 2. ลำดับ implementation หลังคุยหลังบ้าน

1. ตกลง metric/attribution/permission/account contracts ตามคำถามท้าย spec; data-rights DEFERRED
   บันทึกสิ่งที่ตัดสินใน backend spec/plan และปรับ UI copy หากนิยามเปลี่ยน
2. ใช้ system shell เดิม; เพิ่ม feature folder ที่รับผิดชอบหน้าผู้บริหารและ thin routes ตาม pattern repo
   reuse shared client, permission presentation, formatter, i18n และ components
3. สร้าง EX-01/02/03 และ EX-04 โดยใช้ field family เดียวกัน
   ทดสอบกับ fixtures ที่ระบุชัดในพื้นที่ทดสอบก่อนเชื่อมข้อมูลจริง ไม่ปล่อยตัวเลขเดโมใน production
4. ซ่อน data-rights ทุกทางเข้าของ executive: เมนู ปุ่ม case history และ saved routes
   ไม่ query API11/API12 จากหน้าชุดนี้; integration และโครงช่วงคงข้อมูลพักไว้ทั้งหมด
5. สร้าง EX-07/08 ด้วย identity/permission เดิมหลังตกลงผู้จัดการบัญชีและวิธีเปิดใช้งาน
   ไม่ให้ผู้บริหารได้ System Admin หรือสิทธิ์ลบจากการสร้างบัญชี
6. ตรวจ frontend-to-backend contract, loading/error/permission และ browser journey
   บันทึกคำสั่ง ผล และภาพของ application จริงก่อน handoff

ไม่มี dependency ใหม่สำหรับ dropdown/input/month picker
ห้ามแก้ `package.json` เพื่อเพิ่ม scripts หรือ metadata; ใช้ commands ที่มีอยู่
ก่อนเขียน Next.js code ให้อ่าน guide ใน installed Next.js ตาม `apps/web/AGENTS.md`

## 3. ชุดตรวจที่ต้องใช้

### Product / interaction

- ภาพรวม → เลือก industry/source/sales → รายชื่อ → detail → Back
- แยกไม่มีเซลล์/ยังไม่ระบุ/ผู้ได้เครดิตยอดเปิด; signup คงรหัสเซลล์เฉพาะช่องทางเซลล์ตาม B6
- paid usage: จ่ายแล้ว ยังไม่เริ่มใช้กลุ่มเดียว / เคยใช้แต่ช่วงนี้ไม่ใช้ / ใช้ในช่วง;
  ไม่มีรอเปิดบริการซ้ำ และข้อมูลไม่พอเป็นหมายเหตุแยก ไม่จัดเป็นไม่ใช้
- การเคยจ่าย การจ่ายในเดือน และสิทธิ์ใช้งานปัจจุบันไม่ถูกใช้แทนกัน; แสดงปริมาณ/ความถี่จริง
- ค้นหาไทย/ชื่อซ้ำ, empty combination, pagination, เดือนก่อนสมัคร และข้อมูลขาด
- เปลี่ยนตัวกรองระหว่างอ่านข้อมูล: response เก่าไม่ทับ state ใหม่
- DEFERRED: รับคำร้องไม่เท่ากับอนุมัติ/ลบ; มีสิทธิ์อ่านไม่เท่ากับมีสิทธิ์จัดการ
- DEFERRED: โครงคำขอลบ: อนุมัติ → คงข้อมูลทั้งหมด 14 วัน → ครบกำหนด → ผลจริงแยกลบ/เก็บต่อ/ข้อยกเว้น
- สร้างบัญชี: อีเมลซ้ำ/สิทธิ์ไม่พอ/error/pending และไม่เพิ่ม tenant membership หรือสิทธิ์ลบโดยอัตโนมัติ

### Theme matrix — ต้องเปิด control จริง

| Control | ภาพและพฤติกรรมที่ต้องเก็บ |
|---|---|
| Dropdown ทุกชนิด | closed, open, hover, selected, long label, disabled, empty search, keyboard, outside click, Escape, เปิดอีกเมนู |
| Dropdown ภายใน table/modal | portal ไม่ถูก clip, ตำแหน่งหลัง scroll/resize, ชิดขอบล่าง/ขอบขวาบนมือถือ |
| Text/search/textarea | empty, placeholder, filled, focus, error, disabled, readonly, autofill, ข้อความยาว |
| Month/date | popup ภายในธีม, locale/ปีถูก, ค่าเดิม/ล้าง/disabled ตามการใช้งาน |
| Buttons/tabs/status | brand accent, loading, disabled, focus, permission state |
| Layout | 1440/1024/768/390/320px, zoom 200%, Thai/English, OS dark setting |

เก็บภาพ default page + dropdown เปิด + text focus/error/disabled + mobile
เทียบ font/background/border/radius/focus/selected กับ shared components ใน shell เดียวกัน
ห้ามรับงานจากภาพหน้า default ที่ยังไม่เปิด dropdown เพียงอย่างเดียว

### Runnable checks หลังมี implementation

Focused shared checks ที่มีอยู่แล้ว:

```sh
pnpm --filter @watchdog-bms/web exec tsx --test src/common/components/field/Field.spec.ts src/common/components/field/ThemedSelect.spec.ts src/common/components/field/ThemedDate.spec.ts src/common/components/mangmee/mangmee-interactive-theme.spec.ts
pnpm --filter @watchdog-bms/web typecheck
```

เพิ่ม focused feature check สำหรับ mapping/filter/unknown-state ที่มี logic จริง
และ browser scenario ของหน้าชุดนี้ตาม harness เดิม เช่น `e2e/system-settings-ux.spec.ts`
ไม่ต้องรัน E2E ทั้งระบบซ้ำหากไม่มีผลกระทบที่ต้องตรวจเพิ่ม
ถ้าแตะ shared controls ต้องตรวจผู้ใช้เดิมที่ได้รับผลกระทบด้วย

Static review: scan เฉพาะไฟล์ใหม่/ที่แตะหา rendered `<select>`, raw visible `<input>`/`<textarea>`,
inline สี/font และ legacy interactive accent; ตรวจ exception ของ hidden/internal shared controls ด้วยคน
static check อย่างเดียวไม่ยืนยัน open dropdown, CSS cascade หรือ autofill

## 4. สถานะการตรวจรอบเอกสาร

- อ่าน source code ของ controls และ system shell; อ้างอิงไฟล์ที่มีอยู่จริง
- ตรวจ local links, component/route references, ข้อกำหนด theme และขอบเขต backend-pending
- Consistency repair: เดโม v2 และ presentation contract ตามมติแล้ว; canonical channels มาจาก signup contract จริง
- Browser check ของเดโม: `check-demo.cjs` ใน directory ตาม task memory; ครอบคลุมยอดรวม, attribution,
  paid cohorts, account form/status, request/hold states, permissions, field states และ responsive theme
- ผล v2: PASS ไม่มี page errors/native select/outer overflow; ตรวจ open popover และ app light theme บน OS dark แล้ว
  browser zoom/autofill และ system-shell/API integration ยังเป็นเกณฑ์ตรวจ application ภายหลัง
- ไม่รัน application tests/typecheck/E2E ทั้งแอป เพราะไม่มี application code เปลี่ยน; ต้องตรวจ integration อีกครั้งเมื่อเชื่อมจริง
- Next: ปิด identity/permission และ event/receipt source ก่อน implementation; รายละเอียดการลบแยกคุยภายหลังตาม Owner

## 5. ผลปรับ scope ตามมติล่าสุด 2026-10-01

- [x] ซ่อนเมนู/action/case history/permission labels ของ deletion ในเดโม; saved routes ทั้งสามกลับ overview
- [x] ปรับ UI/BE spec, plans, gap status และ QA ให้แยก DEFERRED ชัด
- [x] Build/preview/browser check PASS รวม HIDE-01–04 และรายงาน/บัญชี/theme; ไม่มี page errors
- [ ] ปิด 22 findings ที่ยังเปิดด้วย implementation และหลักฐานตาม acceptance เมื่อ Owner สั่งเริ่มงาน


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


## ตรวจคำและนำเข้ากิ่งหลัก — 2026-10-01

- [x] ตรวจข้อความทุกหน้าที่เปิดในต้นแบบ รวมส่งออกและข้อความสำหรับโปรแกรมอ่านหน้าจอ ตาม plain-language spec
- [x] เก็บต้นแบบที่มีแต่ข้อมูลสมมติไว้ใน `docs/prototypes/mangmee-executive/` พร้อมคำสั่งสร้างและตรวจที่ใช้ได้จาก repo
- [x] ตรวจ browser ทุกหน้า/ธีม/ตัวกรอง/ตัวเลข และคำใน Excel ให้ตรงกัน
- [ ] นำเฉพาะเอกสารและต้นแบบส่วนผู้บริหารเข้า main/develop ผ่าน PR และ CI; ไม่รวมไฟล์ลูกค้าจริงหรืองานค้างของส่วนอื่น

ขอบเขตนี้ไม่เริ่ม application/API implementation และไม่ deploy UAT/Production
