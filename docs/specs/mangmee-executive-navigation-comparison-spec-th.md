# ผู้บริหารมั่งมี — โครงหน้า การนำทาง และการเปรียบเทียบ

คำที่แสดงบนหน้าจอล่าสุด: [ใช้คำที่คนทั่วไปเข้าใจ](mangmee-executive-plain-language-spec-th.md) — เมนู “รายรับ”, แท็บ “ลูกค้าที่สร้างรายรับสูง”; identifiers/สูตรเดิมคงไว้

ส่งออกล่าสุด: [Export Excel](mangmee-executive-excel-export-spec-th.md) — Excel Dashboard เขียว–ทองตามไฟล์v4, native charts/สูตร/ข้อมูลต้นทางสองชีต; ขอบเขตตามหน้าที่ดูและทุกหน้าของผลกรอง; ยังเป็นสเปก/เดโม

วันที่: 2026-10-01
สถานะ: UX proposal + local demo; ไม่มี application/API implementation
ที่มา: Owner พบหัวข้อมากและเลื่อนยาว ต้องการออกแบบจากคำถามผู้บริหารและการเปรียบเทียบ
อ้างอิง [UI](mangmee-executive-business-ui-spec-th.md), [BE](mangmee-executive-business-backend-spec-th.md), [กราฟและ Pareto](mangmee-executive-usage-pareto-spec-th.md)

## 1. หลักการและคำถาม

ใช้ภาพรวมเป็นจุดเริ่ม 30 วินาที: ขนาดลูกค้า / ใช้งานจริง / รับเงิน / เรื่องที่ควรดูต่อ
รายละเอียดแยกหน้าตามงานวิเคราะห์; ไม่รวมกราฟทุกชนิดไว้ใต้ “วิเคราะห์ธุรกิจ” ยาวหน้าเดียว
ผู้บริหารควรเดิน Summary → Analysis → Company list → Company detail และย้อนกลับพร้อมบริบทได้
หนึ่งหน้าเจาะลึกแสดงประเด็นหลักเดียว; ใช้ tabs สลับมุมมองของประเด็นเดียว ไม่ซ่อนทุกงานไว้ใน tab ชั้นเดียวจำนวนมาก
ไม่เพิ่มคะแนนสุขภาพ/คำแนะนำอัตโนมัติหรือข้อสรุปเหตุและผลจากข้อมูลเพียงเดือนเดียว

## 2. Information architecture

| เมนู | คำถามผู้บริหาร | เนื้อหาเริ่มต้น | ทางไปต่อ |
|---|---|---|---|
| ภาพรวมธุรกิจมั่งมี | ตอนนี้ธุรกิจเป็นอย่างไร ควรสนใจอะไร | KPI4, สรุป receipt adoption, paid-not-started และความกระจุกตัวของรายรับแบบสั้น | ไปหน้าวิเคราะห์ที่เกี่ยวข้องหรือกลุ่มบริษัท |
| วิเคราะห์ › การใช้งาน | ลูกค้าเริ่มใช้หรือยัง ใช้มากแค่ไหน | tab การเริ่มใช้: receipt40/32 +paid cohorts; tab อันดับ: receipt/day/AI | เจาะรายชื่อ/รายละเอียดบริษัท |
| วิเคราะห์ › รายรับ | รับเงินจริงเท่าไร พึ่งลูกค้ากลุ่มใด | tab รายรับ: cash summary+trend; tab ลูกค้าที่สร้างรายรับสูง: concentration+prefix | รายชื่อ Top20/Rest/prefix80 /อันดับตามเงิน |
| วิเคราะห์ › ลูกค้าและที่มา | ธุรกิจ/ช่องทาง/เซลล์ไหนสร้างลูกค้าและรายรับ | tab ธุรกิจ/ช่องทาง/เซลล์; แสดงเพียง breakdown ที่เลือก | เปิดบริษัทในกลุ่ม /ไปเปรียบเทียบ |
| วิเคราะห์ › เปรียบเทียบ | สองกลุ่มต่างกันตรงไหน | เลือก dimension และ A/B; ค่าเดียวกัน หน่วย/ช่วงเดียวกัน พร้อมขนาดฐาน | รายชื่อกลุ่ม A/B หรือรายละเอียดบริษัท |
| บริษัทลูกค้า | บริษัทไหนต้องตาม ดูรายละเอียดร้านใด | search+sort/table; filter เพิ่มเติมแบบเปิดเมื่อใช้ | detail; กลับพร้อม cohort/sort/page |
| จัดการ › บัญชีผู้บริหาร | ใครเข้าถึงรายงานได้ | เฉพาะผู้ดูแลบัญชี; แยกจากงานรายงาน | create/detail/status เดิม |

เมนูวิเคราะห์ลึกเพียง1ชั้นและเห็นรายการลูกชัด; มือถือมีเมนูหน้าเป็น themed selector ไม่เรียงปุ่มทุกเมนูจนกินพื้นที่
route proposal: `/system/executive/{usage,revenue,customers,compare}`; บริษัท/account ใช้ proposal เดิม
EX-03 เดิมแยกเป็น EX-03U/R/C/Compare ไม่เพิ่มสิทธิ์ cross-tenant ใหม่และไม่เพิ่ม generic analytics service
legacy local route `analysis` ย้ายไป revenue เมื่อมี spend cohort เดิม ไม่เช่นนั้น usage; deletion routes ยังกลับ overview

## 3. ความหนาแน่นหน้าจอ

- แถวเวลา: เดือน +ข้อมูลถึงเวลาใด +ปุ่มตัวกรอง; ไม่วาง4fieldใหญ่ในทุกหน้า
- industry/source/referrer panel เปิดเมื่อผู้ใช้ขอ; เมื่อปิดต้องมี label/จำนวน filter ที่ใช้อยู่และล้างได้ ห้าม hidden filter
- directory แสดง search/sort ก่อน และตัวกรองละเอียดใน panel; cohortจากกราฟต้องมีชื่อและจำนวนแม้ panel ปิด
- ภาพรวมไม่ใส่ตารางแยกธุรกิจ/รายชื่อTop10/ตารางเซลล์/ทุกchart; แต่ละสรุปมีทางไปหน้ารับผิดชอบ
- หน้า usage/revenue/customer ใช้ tabs เพื่อลดการเลื่อน; ไม่ shrink font/control เพื่อยัดทั้งหมด
- คง tokens/shared fields/buttons/month picker; mobile dropdown/filter keyboard/portal ไม่หลุดธีม
- Demo footer สำหรับตรวจ permission/state พับได้ ไม่เป็นเนื้อหาของ dashboard

## 4. Comparison contract

### เปรียบเทียบกลุ่ม/บริษัท

- รองรับ industry A/B, discovery A/B, referring salesperson A/B, company A/B
- ไม่ใช้ credited salesperson แทน referrer; เครดิตยอดเปิดเป็นคนละมุมในหน้าลูกค้าและที่มา
- ช่วงเวลาเดียวกัน, eligible CUSTOMER population และ cutoff เดียวกัน; source policy/coverage ตามสเปกเดิม
- หน้านี้เริ่มจากบริษัทจริงทั้งหมดในเดือนที่เลือก ไม่ใช้ shared segment filter ที่ซ่อนอยู่จากหน้าอื่น; label ฐานต้องชัด
- ค่าA/Bแยกจาก global report filters; ไม่เปลี่ยน/ทิ้ง global filters ของหน้ารายงานเดิมเมื่อกลับไป
- เมื่อคลิกดูสมาชิกฝั่งA/B ให้เปิด directory ด้วยเดือนและ dimension ของฝั่งนั้น, resetเงื่อนไขรายการอื่น; breadcrumb “กลับหน้าเปรียบเทียบ” กลับค่าฝั่งเดิม
- company A/B ต้องคนละบริษัท; กลุ่มA/Bต้องต่างกัน; ถ้าเหมือนให้ขอเลือกต่างกัน ไม่ทำผลชนะ/แพ้ปลอม
- บริษัทต้องอยู่ใน eligible population ของช่วงนั้น; กรอง options ตามเดือน; invalid restored id ไม่เปลี่ยนเป็นบริษัทแรกเงียบ ๆ
- ตารางแสดงจำนวนบริษัท, เงินรับสุทธิ, เงินรับสุทธิต่อบริษัท, จำนวนใบเสร็จในเดือน, ใบเสร็จต่อบริษัท, อัตราเคยเพิ่มใบเสร็จ และ active companies ตามcoverage
- ค่าเฉลี่ยต่อบริษัทใช้ฐานบริษัทจริงทั้งหมดของแต่ละฝั่ง ไม่ใช่เฉพาะผู้จ่าย/ผู้ใช้; ตั้งชื่อให้ชัด
- raw total ใช้ดูขนาด; per-company/rate ใช้ประกอบการเทียบกลุ่มขนาดไม่เท่ากัน; ไม่กล่าวว่าเป็น causal conversion หรือ ROI
- ส่วนต่างกำหนด A−B; อัตราแสดงเป็น percentage points (จุดเปอร์เซ็นต์) ไม่สลับกับ percent change
- unknown/null แสดง—หรือ lower bound ตาม metric; ไม่แสดง deltaที่ต้องใช้ค่าที่ไม่ครบ; ไม่มีฐานเป็น0ใช้—สำหรับrate/average
- roundingเพื่อแสดงผลเท่านั้น; signed cashไม่clipเป็น0ในตาราง
- period snapshot/provenance/permission ต้องตรงทั้งสองฝั่ง; requestหนึ่งฝั่งล้ม ไม่วางฝั่งเก่าเทียบกับฝั่งใหม่

### เปรียบเทียบช่วงเวลา (ข้อเสนอสำหรับ integration)

- ตัวเลือกเดือนนี้เทียบเดือนก่อน; ปัจจุบันมี fixtureเต็มที่ใช้งานได้เฉพาะกันยายน จึงแสดง unavailable แทนสร้าง %โตปลอม
- ช่วงยังไม่ครบเดือนต้องเทียบ elapsed interval เท่ากันใน Bangkok และโชว์วันcutoffทั้งสองช่วง; เดือนเต็มเทียบเดือนเต็มได้
- ระบุ population mode: cohortเดียวกัน หรือประชากรของแต่ละช่วง; cohort/lifecycle changes ต้องอธิบายแยก
- ฐานก่อนหน้า0/unknown ห้ามหารเพื่อแสดงgrowth%; แสดงจำนวนเปลี่ยนหรือไม่มีฐานตามความหมาย
- trend fixtureเดิมไม่ใช่หลักฐาน month-level company/activity sourceครบ ใช้สร้าง delta/KPIgrowthไม่ได้

## 5. Navigation and state

- หน้าปลายทางมีชื่อชัดและ navigation selected; subviewของusage/revenue/customerรักษาระหว่างไปdetailและกลับ
- shared filter/monthอยู่ต่อเมื่อเปลี่ยนรายงาน; compareอธิบายฐานของตัวเองและไม่ทิ้ง filterซ่อน
- drilldownreset list-onlyfiltersตามข้อแก้G22; list→detail→Backคงpage/sort/cohort; compare→list→detail→list→compareครบ
- saved stateเก็บroute/subview/comparevalues/filterเฉพาะpresentationภายใต้16KiB; ไม่บันทึกfixtureรายบริษัททั้งหมด
- host state eventต้องใช้กฎmigrationเดียวกับinitialrender; ไม่เขียนstateบนloadหรือevent
- loading/error/forbiddenต้องครอบคลุมหน้าวิเคราะห์ใหม่ทุกหน้า; accountmanagementและdeletionboundariesคงเดิม

## 6. Backend impact และการตรวจรับ

Reuse API02/04 แยกrequestsectionตามหน้าหรือparameterที่allowlist; API03/05drilldownเดิม
เพิ่ม comparative read contract ใน API04 หรือ endpointเฉพาะเมื่อ implementation พิสูจน์จำเป็น; ห้ามทำgenericqueryDSL
request `{mode,dimension,sideA,sideB,month,snapshotId}`; serverderiveeligiblemembersจากauthorizedsources ไม่รับclientmemberlist
responseคืน commonperiod/snapshot พร้อมmetrics/coverage/denominatorsแต่ละฝั่งและdeltaที่คำนวณได้เท่านั้น
ต้องปิด Q02/Q03/Q04/Q05/Q09 ที่เกี่ยวข้องก่อนใช้ข้อมูลจริง; โครงnavigationไม่ใช่การปิดgapเหล่านี้

Checks: หน้าสรุปไม่มีlongtables; ทุกanalysisแสดงเฉพาะtabปัจจุบัน; menu/mobile/state restore; comparisonA/B/swap/samechoice/empty/null; drilldown/Back; role/status/theme; ห้ามให้deletionกลับมา
ยังเป็นlocaldemo/specเท่านั้น ไม่มีapplication/APIจริงหรือrealHTTPE2E


## 7. ตัวอย่างและผลตรวจ local demo

- Desktop1440px หน้าภาพรวม mainสูง785px; 4KPI+2หัวข้อหลัก ไม่มีtableยาว. เป็นค่าที่วัดจากfixtureนี้ ไม่ใช่การรับประกันทุกlocale/zoom/ข้อมูล
- การใช้งานแสดงadoptionหรือrankingเท่านั้น; รายรับแสดงcashหรือParetoเท่านั้น; ลูกค้าแสดงindustry/source/salesมุมเดียว ไม่renderทุกตารางต่อกัน
- Comparisonร้านอาหาร14บริษัท vs ค้าปลีก13บริษัท: net58464 vs54464บาท; netต่อบริษัท4176 vs4189.54บาท. ผลrawtotalกับper-companyจึงตอบคนละคำถาม
- Receipt adoption71.4% vs53.8%, ส่วนต่าง17.6จุดเปอร์เซ็นต์; swapทำส่วนต่างกลับเครื่องหมาย; unknownusageของMM009แสดง—และไม่คำนวณdelta
- เดือนเทียบเดือนแสดงunavailableชัดเจน; ไม่ยกderivedtrendfixtureมาอ้างเป็นแหล่งข้อมูลรายบริษัทของเดือนก่อน
- Browser `check-demo.cjs`: overview density, isolatedtabs/pages, chart→list→detail→Back, all-page40/Top15/prefix13 totals, A/B/normalize/swap/same/null, foldedfiltervisibility/comparisonbase, account/role/readstates, migration/deletionhidden, desktop/mobilemenu/theme
- Layoutตรวจ1440/1024/768/390/320pxทุกหน้าใหม่; ไม่มีouteroverflow; dropdownkeyboard/search/Escapeและfixedapp lightthemeบนOSdarkผ่าน
- ภาพตรวจoverview-v4.png,comparison-v4.png,overview-mobile-v4.png,comparison-mobile-v4.png ในพื้นที่เดโมตามmemory
- Previouscheck-demo-v3-historical.cjs เก็บเป็นbaselineเดิม ไม่ใช้รันกับnavigationใหม่; currentcheck-demo.cjs เป็นverificationปัจจุบัน
- ไม่มีapplication/API/cloud/live dataเปลี่ยน; checksนี้ไม่ใช่realHTTP/DBE2E และไม่ปิด22applicationgaps
