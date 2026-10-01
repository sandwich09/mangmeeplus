# ผู้บริหารมั่งมี — ออกแบบ Export Excel

คำที่แสดงบนหน้าจอล่าสุด: [ใช้คำที่คนทั่วไปเข้าใจ](mangmee-executive-plain-language-spec-th.md) — เมนู “รายรับ”, แท็บ “ลูกค้าที่สร้างรายรับสูง”; identifiers/สูตรเดิมคงไว้

วันที่: 2026-10-01
สถานะ: UX / FE–BE contract proposal + local demo; ยังไม่มี application export หรือไฟล์จริงจากเดโม
ที่มา: Owner ขอเพิ่มการส่งออก Excel และให้ออกแบบ flow ก่อนเขียนระบบจริง
อ้างอิง [UI](mangmee-executive-business-ui-spec-th.md), [BE](mangmee-executive-business-backend-spec-th.md), [navigation/comparison](mangmee-executive-navigation-comparison-spec-th.md), [receipt/Pareto](mangmee-executive-usage-pareto-spec-th.md)

## มติล่าสุด: ใช้ไฟล์ Dashboard v4 เป็นแม่แบบ

Owner ระบุ `company-receipts-dashboard-v4.xlsx` (ไฟล์อ้างอิงในเครื่องของ Owner; ไม่แนบข้อมูลบริษัทจริงเข้า repository) เป็นรูปแบบ Export ที่ต้องการ
มตินี้แทนตัวเลือก summary-only/optional company sheet และข้อเสนอ values-only ในฉบับก่อน: ค่าเริ่มต้นเป็น **Excel Dashboard พร้อมกราฟจริง สูตร และข้อมูลต้นทาง**
สองชีตหลัก **ภาพรวม** และ **รายบริษัท** ตามแม่แบบ; ตารางคำนวณอยู่ใต้ Dashboard และเงื่อนไขอยู่ในหัวข้อมูลต้นทาง ไม่เพิ่มชีตเทคนิคหลายแท็บ
แม่แบบกำหนด layout/สี/โครงสูตร ไม่ใช่แหล่งตัวเลขสำหรับเดือนใหม่; ไม่แก้หรือเขียนทับไฟล์อ้างอิง

## 1. เป้าหมายและขอบเขต

ผู้บริหารนำสิ่งที่กำลังวิเคราะห์ไปประชุมหรือวิเคราะห์ต่อได้ โดยจำนวนบริษัท ยอดเงิน สูตร ฐาน และเงื่อนไขตรงหน้าจอ
เพิ่มปุ่ม **Export Excel** ที่หัวของหน้ารายงานและรายละเอียดบริษัท ไม่เพิ่มเมนูหลักหรือหน้าตั้งค่ารายงานอีกชุด
ไม่ใส่ในหน้าบัญชีผู้บริหาร ไม่ส่งออกเอกสาร/รูปใบเสร็จ/บทสนทนา/ข้อมูลคำร้องลบ และไม่เพิ่มการส่งอีเมลหรือการตั้งเวลา
รุ่นแรกใช้ `.xlsx`, Dashboard สีเขียว–ทอง, KPI และ native editable Excel charts ผูกกับสูตร/ตารางคำนวณและข้อมูล ณ snapshot; ไม่มี macro/external link/pivot หรือสูตรที่ผู้ใช้ส่งเข้ามา
ส่งออกกราฟเป็น chart object ไม่ใช่ภาพกราฟแปะ; มีตารางตัวเลขที่ใช้วิเคราะห์ต่อได้; การส่งออกรายงานสรุปนี้เข้าขอบเขตใหม่ ส่วนเอกสารธุรกรรมลูกค้าโดยละเอียดยังอยู่นอกขอบเขต

## 2. เส้นทางผู้ใช้

1. เลือกหน้า แท็บ เดือน ตัวกรอง หรือกลุ่มจากกราฟตามปกติ
2. กด Export Excel → เปิดแผงเตรียมไฟล์ในพื้นที่รายงานแทนเนื้อหาเดิม; คงเมนู/ชื่อหน้า ไม่ต่อแผงท้ายหน้าให้ยาวขึ้น
3. แสดงชื่อรายงาน/แท็บ เดือน ข้อมูลถึงเวลาใด ตัวกรองทั้งหมด จำนวนบริษัท และการไม่รวม TEST/INTERNAL
4. ใช้รูปแบบเดียว **Excel Dashboard พร้อมข้อมูลต้นทาง**; ไม่ต้องเลือกระหว่างสรุปกับข้อมูลรายบริษัทอีก เพราะกราฟต้องมีข้อมูลรองรับ
5. แสดงสองชีต: ภาพรวมและรายบริษัท พร้อมจำนวนบริษัท; เปิดตัวอย่าง Dashboard สีเขียว–ทองหรือข้อมูลต้นทางสูงสุด 5 แถวได้; ตัวอย่างแถวไม่ใช่เพดานส่งออก
6. กด **สร้างไฟล์ Excel** → preparing → download เมื่อได้ไฟล์สมบูรณ์; กันกดซ้ำ และแสดงข้อความหากเบราว์เซอร์ดาวน์โหลดไม่สำเร็จ
7. กลับรายงานแล้วยังคงแท็บ/ตัวกรอง/หน้าเดิม; การเปลี่ยนหน้า/เดือน/สิทธิ์ระหว่างเตรียมยกเลิกผลเก่า ไม่ดาวน์โหลดไฟล์ผิดบริบท

เดโมใช้ปุ่ม **จำลองสร้าง Excel** และระบุชัดว่าไม่ได้สร้างหรือดาวน์โหลดไฟล์จริง; มี ready/error/snapshot-expired ให้ตรวจ flow
ไม่แสดงปุ่มดาวน์โหลดที่ไม่มีไฟล์ ไม่สร้าง CSV แล้วตั้งนามสกุลเป็น xlsx
ใช้ Button/SelectField/ตาราง/theme เดิมทั้งหมด; มือถือแผงเต็มความกว้างและตารางเลื่อนภายในได้ ไม่มี outer overflow

## 3. แต่ละหน้าได้อะไร

ทุกไฟล์มีชีต **ภาพรวม** เป็นหน้าหลัก และ **รายบริษัท** เป็นแหล่งข้อมูลครบทุกบริษัทที่อยู่ในขอบเขตพร้อม metadata
ตารางคำนวณอยู่ใต้พื้นที่ Dashboard; ปรับชนิด/จำนวนกราฟตามคำถามของหน้าที่ส่งออก ไม่ยัดกราฟทั้งระบบในไฟล์เดียว

| หน้าที่กด | ชีตภาพรวม | ชีตรายบริษัท |
|---|---|---|
| ภาพรวม | KPI, doughnut การเริ่มใช้, ประเด็นติดตามจากข้อมูลที่มี | บริษัทหลัง shared filters และคอลัมน์ที่ใช้คำนวณ |
| การใช้งาน / การเริ่มใช้ | doughnut EVER/NEVER/UNKNOWN + bar 0/1–5/6+ จาก receipt lifetime; หน่วย/ขอบเขตชัด | lifetime/period receipt, usage/coverage และ profile ที่อนุญาต |
| การใช้งาน / อันดับ | bar Top 10 ตาม sort; ตารางอันดับครบทุกบริษัทอยู่ด้านล่าง | ทั้งฐานตาม sort ไม่จำกัด Top 10 |
| รายรับ / รายรับ | KPI รับ/คืน/สุทธิ และ bar; trend เฉพาะมี source ครบ | receipts/refunds/net และค่าธรรมเนียมแยก |
| รายรับ / ลูกค้าที่สร้างรายรับสูง | ส่วนแบ่ง Top20/Rest, อันดับและ cumulative 80% พร้อมฐาน/negative disclosure | ทั้งฐานพร้อมอันดับ positive weight/share/cumulative/membership ที่จำเป็น |
| ลูกค้าและที่มา | bar breakdown ของแท็บและมุมที่เลือก: industry/entity/channel/referrer/credit | บริษัทในฐาน; referrer/credit แยก ไม่ปนยอดรับเดือนกับยอดเปิดสะสม |
| เปรียบเทียบ | KPI A/B และ bar คู่ + ตาราง A/B/A−B ทั้ง totals/per-company/rate | สมาชิก A/B พร้อม side label และ coverage |
| บริษัทลูกค้า | KPI สรุปกลุ่มที่เลือก + receipt adoption; ไม่ใช่ภาพรวมทั้งระบบ | ตรงทุกเงื่อนไขครบทุกหน้า ตาม sort |
| รายละเอียดบริษัท | profile + KPI/การใช้/ที่มา; ไม่สร้าง doughnut 100% ที่ไม่ช่วยวิเคราะห์ | หนึ่งบริษัทพร้อมข้อมูลที่อนุญาตทุกแท็บ |

ไม่บังคับให้มี4กราฟทุกหน้า: แม่แบบ4กราฟเป็นตัวอย่าง usage report; reportอื่นใช้กราฟที่มีความหมายและsourceครบ
กราฟ7/30วันและpackage breakdownของแม่แบบไม่สร้างค่าขึ้นจากmonth count/lastUsedAtหรือplanตัวอย่าง; ถ้า source ไม่ครบแสดง unavailable หรือเว้นpanelพร้อมเหตุผล

ไม่เสนอ “หน้าปัจจุบันเท่านั้น” ในรุ่นแรก เพราะเสี่ยงเอา 12 แถวที่เห็นไปแทน 40 บริษัทที่เลือก
กลุ่มจากกราฟต้องรวม cohort/search/list filters จริงทั้งหมด; ห้ามนำ dormant list filters ไปใช้กับ overview/analysis
Top20 ในรายชื่อหมายถึง Top20 ที่คำนวณบน shared base ก่อน list-only filters; metadata เก็บฐานนี้ด้วย ไม่คำนวณ Top20 ใหม่จากผลย่อย
Comparison ใช้ common eligible population และ A/B ตาม navigation spec; rate delta เป็นจุดเปอร์เซ็นต์ ไม่ใช่ %growth
รายงานเดือนเทียบเดือน/selection invalid/เดือนที่ไม่มี source ยังสร้างไฟล์ไม่ได้ ไม่ส่งออกตารางปลอมเป็นศูนย์
กรณีไม่พบบริษัท: แสดง empty และปิดสร้างไฟล์ ไม่สร้างไฟล์มีแต่หัวตาราง
unknown บาง metric ไม่ปิดทั้งรายงาน: ช่องค่าว่าง + coverage/status/เหตุผล; delta ที่พึ่ง unknown ว่างด้วย
Cash trend เดือนก่อนในเดโมเป็นภาพประกอบ ไม่ใช่ source ครบ จึงไม่ส่งออกเป็นยอดจริง; ระบุข้อจำกัดในแผงและเงื่อนไขบนชีตรายบริษัท

## 4. โครงสร้างไฟล์และข้อมูล

- ชื่อเสนอ `mangmee-executive-{reportKey}-{YYYY-MM}-{exportedAtBangkok}-{shortRequestId}.xlsx`; company ID ใช้ได้ แต่ไม่ใส่ชื่อบริษัท/query/PII ในชื่อไฟล์
- ชีตภาษาไทยชื่อคงที่ ปลอดภัย ไม่เอาชื่อบริษัท/ตัวกรองมาตั้งชื่อชีตโดยตรง
- หัวตาราง freeze, filter, ความกว้างอ่านได้, wrap headers, เงินชิดขวา; data sheets ไม่มี merged cells
- เงินเก็บตัวเลขหน่วยบาท 2 ตำแหน่งจากจำนวนสตางค์; counts เป็น integer, rates เป็น numeric fraction พร้อม percent format; จุดเปอร์เซ็นต์เป็น numeric difference ×100 พร้อมหน่วยแยก
- รหัสบริษัท/เซลล์เป็น text รักษา leading zeros; วันที่เป็นค่า Excel date/time ที่จัดรูปแบบ พร้อม timezone Asia/Bangkok ใน metadata; month เป็น YYYY-MM
- unknown ไม่แปลงเป็น 0 หรือ string ใน numeric column: เว้นค่าว่างและมี status/coverage กำกับ; zero ใช้เมื่อ source ครบและไม่มีจริงเท่านั้น
- ข้อมูลต้นทางเป็น typed snapshot values; สูตรที่ template กำหนดเท่านั้นคำนวณสรุป/อัตรา/คำอธิบายและเป็นแหล่งของ chart objects. ทุก user text ใช้ explicit string cell แม้ขึ้นต้นด้วย =,+,-,@,tab หรือ CR
- สูตรใช้ bounded ranges ที่ปรับตามจำนวนแถวจริงหรือ Excel Table; ไม่คงช่วง72แถวจากแม่แบบ. Coverage/blankต้องตรวจแยกก่อน COUNTIFS/SUMIFS; unknownไม่ถูกนับเป็นNEVERหรือ0 และ rateฐาน0ใช้ unavailable
- ค่าเมื่อเปิดครั้งแรกต้องตรง server snapshot ทั้งค่าตัวเลข/สูตร cached values/chart cache. การแก้ข้อมูลในExcelคำนวณใหม่ในไฟล์เท่านั้น ไม่ส่งกลับระบบ; filteringตารางเฉยๆไม่เปลี่ยนฐานDashboardโดยปริยาย
- สูตร/กราฟอ้างชีตในไฟล์เดียว ไม่ใช้ TODAY/NOW ทำให้lookbackเลื่อนเมื่อเปิดภายหลัง. Snapshot/date/definitionคงที่; lookback7/30วันอิง cutoffเดียวกันและไม่บวกกลุ่มซ้อนทับ
- Escape XML/control characters และ validate finite number, sheet name, row/byte limits; ห้าม truncation เงียบหรือ return ไฟล์เสีย
- metadata: report/subview, actual applied filters (ไม่รวม page/cursor), canonical sort/tie breaker, period start/end/cutoff, snapshotId/asOf/definitionVersion/dimensionVersion, watermark/coverage ต่อ source, excluded classifications, generatedAt และหน่วย/นิยาม
- company standard projection: contactEmail/contactPhone (ท้ายตาราง; บัญชีเจ้าของ), contactSource/contactUserId/contactStatus/contactCoverage/sourceAsOf ตาม §9.2, ID/name, primary industry/activity/entity/province/joinedAt, plan/service, discovery code/label/other, referrer ID/name, credit seller ID/name/first sale amount/date, paidEver/usageGroup/coverage, receipt lifetime state/count and period count, active days/users/documents/AI, receipts/refunds/net/fees, first/last feature-use and last login (labels แยกชัด)
- รวมอีเมลและเบอร์โทรล่าสุดของบัญชีเจ้าของที่ผูกกับบริษัทลูกค้าตามมติ Owner; ไม่รวม tax ID, ที่อยู่เต็ม, bank data, invoice lines, customer documents, access tokens หรือรายชื่อ/ข้อมูลติดต่อพนักงานและลูกค้าปลายทางของบริษัท
- สมาชิกที่อยู่หลายกลุ่มในอนาคตต้องมี distinct company count แยก row count; รุ่นแรก single-value dimensions ทำให้ A/B คนละกลุ่มไม่ overlap

## 5. สัญญา FE → BE (ข้อเสนอ)

Reuse executive report projections/definitions ของ API02–05; ห้ามใช้ DOM หรือ client paginated rows เป็นแหล่งข้อมูลจริง
เสนอ `POST /v1/system/executive/exports` (API13) คืน binary xlsx ใน request เดียวสำหรับขอบเขตที่ bounded
body allowlist: `{snapshotId, reportKey, subview, month, filters, sort, comparison?, companyId?, templateKey:"executive-dashboard-v1", format:"xlsx"}`
ไม่รับ arbitrary SQL/field names/member IDs/client totals/page/cursor; unknown keys/enum และ field ที่ไม่ใช้กับ report นั้นต้อง reject
FE canonicalize context ก่อนส่ง; BE normalize/validate กับ immutable snapshot + definition version + actor scope เสมอ
BE query ทั้งผลลัพธ์ของ snapshot, derive cohort/Pareto/comparison ที่ server; ตรง membership/count/sum/order กับหน้าจอ
Detail context ใช้ companyId และเดือน ไม่รับ shared segment/list filters; compare context ใช้ A/B ของตน ไม่รับ dormant report filters
Serverเลือก templateVersion/hashที่อนุมัติ ไม่รับtemplate/formula/font/chart configจากclient; บันทึกtemplateVersionคู่definitionVersionในmetadata/audit
Response: XLSX MIME + safe Content-Disposition + requestId/rowCount/บริษัทที่ไม่ซ้ำ + no-store; headers/errors ไม่มี PII
คืน 200 เมื่อสร้างครบเท่านั้น; failure คืน JSON error ก่อนเริ่มส่ง binary ไม่มี partial success

รุ่นแรกไม่สร้าง queue/storage/export history เพิ่มเพื่อข้อมูลหลักสิบ/หลักร้อยบริษัท:

- ใช้ snapshot TTL เดิม; recheck expiry/revocation ก่อนส่งไฟล์ หากหมดอายุคืน 409 `EXECUTIVE_SNAPSHOT_EXPIRED` ให้กลับโหลดรายงานใหม่โดยผู้ใช้ ไม่สลับ snapshot เงียบ
- เสนอ guard เริ่มต้นรวม data rows ≤10,000, output ≤20MiB, build deadline ≤30s และ active export ต่อ actor 1 งาน; ตัวเลขเหล่านี้รอยืนยัน Q09 และ capacity test ไม่ใช่ SLA ที่พิสูจน์แล้ว
- เกิน limit คืน 422 `EXECUTIVE_EXPORT_LIMIT_EXCEEDED` พร้อมให้ลดขอบเขต ห้ามแอบแบ่ง/ตัดข้อมูล; หาก scale จริงเกินขอบเขตค่อยออกแบบ async และ storage lifecycle แยก
- 403 ไม่มี read/export capability, 409 snapshot expired/source invalidated, 422 invalid comparison/empty/unsupported source/limit, 429 busy/rate limit, 5xx build failure
- ทำงานอ่านอย่างเดียว; retry ไม่เปลี่ยน billing/usage/sales state. กัน duplicate click/active build และบันทึก audit ต่อ attempt/requestId โดยไม่เพิ่ม generic command/job system
- abort/เปลี่ยน context: FE ทิ้ง response เก่าและไม่ download; BE bounded cleanup/abort เมื่อทำได้ ไม่อ้างยกเลิกสำเร็จหาก engine ยังจบงานอยู่
- ไม่มีการเก็บ XLSX server-side ถาวรใน proposal นี้; audit เก็บ actor/report/snapshot/normalized scope hash/row counts/outcome/เวลา/bytes ไม่เก็บ cell payload หรือ raw search text

## 6. สิทธิ์และโมดูลข้างเคียง

เสนอ capability `system.executive.export` เพิ่มจาก `system.executive.read`, ต้อง active platform membership/system-owned role ตาม BE§17
UI ใช้ capabilities; server recheck ทุกครั้งและก่อนส่ง binary. Account manager ไม่ได้อ่าน/ส่งออกโดยอัตโนมัติ; tenant role ที่ชื่อเหมือนกันส่งออก cross-tenant ไม่ได้
ข้อเสนอให้ผู้บริหารทั้ง 4 คนเปิดใช้ได้ แต่การผูก role/default grant ต้องยืนยันใน Q01 ก่อน implement; เดโมเป็นการเลือก allowed/denied เท่านั้น
ไม่แตะ customer/export permissions เดิม; export new report ไม่ได้ให้สิทธิ์อ่านต้นฉบับ
ไฟล์ที่ผู้ใช้ดาวน์โหลดสำเร็จแล้วไม่สามารถเพิกถอนย้อนหลังจากเครื่องผู้ใช้; ห้ามสัญญาว่าถอนสิทธิ์แล้วลบสำเนาได้
Deletion feature ยังคง deferred/hidden และไม่รวมใน workbook; export นี้ไม่เปิด workflow ลบกลับมา

หลักฐาน code ที่อ่านรอบออกแบบ:

- [shared xlsx writer](../../apps/api/src/common/export/xlsx.logic.ts): numeric/text cells, freeze header, single sheet, fixed widths, ไม่มี multi-sheet/styles/date/auto-filter ครบตามข้อเสนอนี้
- [billing history export](../../apps/api/src/modules/billing/application/billing-history-export.ts): CSV จาก bounded timeline page พร้อม metadata; reuse แนวคิด metadata ได้ แต่ห้าม reuse pagination semantics หรือ rename เป็น xlsx
- ก่อน implement ให้ประเมินความสามารถ native chart/formula/cache/style/multi-sheet ของ writer กับแม่แบบจริงก่อนเลือก extend หรือ approved template-capable writer. ห้ามรับปากว่าต่อ single-sheet helper เล็กน้อยก็พอ และห้ามลดกราฟเป็นภาพ/values-onlyโดยเงียบ; regression tax/expense exports ที่ใช้ helper ร่วมเป็นเงื่อนไขส่งมอบ
- โมดูลที่ได้รับผล: executive FE/read projection, auth registry/enrollment, snapshots/coverage, XLSX helper, audit/rate limits; billing/receipt/usage/sales เป็น read sources ไม่เปลี่ยน ledger/credits

## 7. เกณฑ์ตรวจรับและ gap ใหม่

EXL-01: header export ทุก report/detail แต่ไม่มีใน account; no permission ซ่อน; loading/error ปิดใช้งาน
EXL-02: receipt EVER40 ที่ list page2 ส่งออก40 IDsไม่ซ้ำ ไม่ใช่12; search/entity/usage/serviceร่วมครบ; Backคืนpage2
EXL-03: รายงานหลัง Facebook filter16 ส่งออก16; analysisไม่ติดreceipt/spend/searchที่ค้างจากlist
EXL-04: Top20 list15/sum204930, prefix80 list13/sum198950; whole Pareto72/positive58/top15/83.4% ใช้ฐานเดิม
EXL-05: comparison restaurant14/retail13 ไม่ติดFacebook; cash58464/54464/delta4000, avg4176/4189.54, rate delta17.6pp; member sheet27
EXL-06: same A/B, invalid selection, period-unavailable, month-unavailable และ empty ปิดสร้าง; unknown MM009ไม่ปลอม active=0/delta
EXL-07: company detailส่งออก1บริษัท รวมprofile/usage/attribution; ไม่มีคำร้องหรือhiddencase data
EXL-08: fixed Dashboard format/sheet preview selector ใช้ธีมและkeyboard, mobile320/390 และdarkOSไม่มีหลุดหรือoverflow
EXL-09: preparingกันกดซ้ำ, successdemoระบุจำลอง, errorretry, expiredต้องกลับโหลดใหม่, context/rolechangeทิ้งผลเก่า
EXL-10 (integration): read+exportgrant/revoke/tenantspoof/snapshot actorbinding; request forgedtotals/IDs/dormantfilters rejected
EXL-11 (integration): typed money/date/rate/text/blank; Thai/leadingzero/XML/formulalike text; workbook opens with matchingrows/counts/sums, approved formulas/native editable charts and no external links
EXL-12 (integration): cap/timeout/abort/concurrent/disklessbuffer/failure no partial binary; audit privacy; shared tax/expense export regression

Gap XG01–XG04 ใหม่: capability policy, snapshot-bound all-row query, multi-sheet typed/styled writer, bounded delivery/audit. ทั้งหมด DESIGN_ONLY / NOT_IMPLEMENTED
ไม่ปิด G01–G35 จากการออกแบบหรือ local browser checks; baselineยัง22OPEN/13DEFERRED. QAแยก EXL-01–12 จาก188baseline/47deferredเดิม


## 8. แม่แบบและหลักฐานตรวจอ่าน 2026-10-01

- ไฟล์v4มีสองชีต ภาพรวม/รายบริษัท; source72แถวที่A7:H78, 26สูตร, 4nativecharts (doughnut1 +bar3) และไม่มีcell formula errorsจาก read-onlyinspect
- ภาพรวมA1:X46: หัวสีเขียวเข้ม ขีดทอง, KPI3, panel2×2, doughnutซ้าย/barขวา, ข้อสรุปแถบทอง; ตารางคำนวณเริ่มแถว48ด้านล่าง, ตารางบริษัทเริ่มheaderแถว6
- Palette: forest#14532D, main#15803D/#16A34A/#22C55E, mint#DCFCE7, gold#F59E0B/palegold; เขียว=เคยเพิ่ม, ทอง=ยังไม่เคยเพิ่ม, unknownใช้เทาและlabelแยก. ส่วนอื่นใช้สีแยกA/Bหรือseriesพร้อมlegend ไม่ตีความทองเป็นสถานะผิดพลาด
- แม่แบบใช้72บริษัท, lifetime receipts130, EVER40/NEVER32 และช่วงsnapshot28ก.ย.2026. ตัวเลขนี้ไม่ใช่fixture30ก.ย.ในinline demo; ห้ามคัด130/33หรือ7/30วันไปใช้โดยไม่มีsourceของreportเดียวกัน
- นิยามแม่แบบนับreceipt recordsทุกสถานะ ขณะที่BE Q03ยังต้องสรุปsuccessful capture/inclusion; การเลือกtemplateไม่ถือว่าปิดQ03หรือเปลี่ยนนิยามแอป. ต้องใช้definitionVersionเดียวกันระหว่างFE/BE/Excelและแสดงความหมายบนไฟล์
- ตรวจ source→calculation→KPI/chart bindings โดยimport artifact-tool แบบread-onlyและrender; ไม่แก้/ส่งออกworkbookใหม่. Source SHA256 `04296d1455b7c216620e1a52409c52cd44201a6942f445e8879183492716eb05`
- Inline previewเป็นHTMLจำลองรูปแบบ, ใช้fictionalreport dataเดิม; ไม่ใช่renderของXLSXที่ระบบสร้างและไม่พิสูจน์nativeExcelclick drilldown. Excelมีchart/tableที่แก้และfilterได้; การคลิกส่วนกราฟไม่เท่ากับnavigateเว็บ

EXL-13 (integration): เปิดไฟล์แล้วมี2ชีตหลักตามแม่แบบ; nativechart bindings/formulas/cacheถูกต้อง, เปลี่ยนinputในสำเนาแล้วKPI/chartเปลี่ยน, restoreแล้วกลับเดิม; จำนวนแถวอื่นนอกจาก72/null/zero/negative/tiesถูกต้อง
EXL-14 (integration): renderทุกชีตกับreference; Thai/สี/labels/units/printarea/fonts/ไม่มีclipping; compare/Pareto/filtered/detailtemplatesมีความหมาย; cutoffไม่เลื่อนเมื่อเปิดภายหลัง; never use chart imageแทนnativegraph

เพิ่มEXL-13–14จาก12exportcasesเดิม; XG03ขยายเป็นtemplate/nativechart/formula/cache/render compatibility และยังNOT_IMPLEMENTED


## 9. มติข้อมูลติดต่อ — 2026-10-01

Owner ยืนยันใช้ **ข้อมูลล่าสุดของบัญชีเจ้าของที่ใช้มั่งมี**. ให้รวม **อีเมลเจ้าของบัญชี** และ **เบอร์โทรเจ้าของบัญชี** เป็นคอลัมน์มาตรฐานท้ายชีตรายบริษัทในทุก export ที่มีบริษัทอยู่ในขอบเขต
ยกเลิกการตัดสอง field นี้ออกในฉบับก่อน; ช่องเหล่านี้หมายถึง contact ของบัญชีเจ้าของที่ผูกกับบริษัท ไม่ใช่ Company.email/phone หรือ export address book/พนักงาน/ลูกค้าของ tenant
**มติแก้ไขล่าสุด: Owner หมายถึงข้อมูลที่อยู่ในระบบมั่งมี** ต้องอ่านจากฐานข้อมูลระบบผ่าน read projection ที่ตรวจสิทธิ์และผูกด้วย companyId/userId ตามความสัมพันธ์จริง; Gmail, Google Sheet และการจับคู่ชื่อบริษัทไม่ใช่ source หรือ fallback ของรายงานระบบ
รักษา source company ID/userId และ provenance; ห้ามเลือกอีเมลสมาชิกคนแรกหรือคัดจากคนชื่อคล้ายกันเป็น fallback. Q-EXL-CONTACT ตอบแล้วว่าเป็นบัญชีเจ้าของ; ใช้กฎ §9.2 และแสดง missing/ambiguous เมื่อระบุเจ้าของคนเดียวไม่ได้
ค่า phone เป็น text รักษา0นำหน้า/+country code/รูปแบบต้นฉบับ; email/phone เป็น literal strings ไม่ตีความเป็นสูตร. Blankไม่ใช่0และไม่เติมข้อมูลสมมติในไฟล์จริง
ใช้ read+export capability และ company scopeเดิมสำหรับallowlistedcontact fieldsนี้; ห้ามขยายไปอ่านทุกcontactในtenant. ไม่ใส่PIIในfilename/querylog/auditpayload. Searchcontactsยังไม่เพิ่มโดยอนุมาน
วันที่contact sourceอาจต่างจาก receipt snapshot จึงระบุแยก ไม่ทำให้ผู้ใช้เข้าใจว่าreceipt dataเป็นปัจจุบันด้วย
Excel v5 ก่อนคำชี้แจงนี้เพิ่ม I:J จาก local Sheet snapshot โดยเลือก include flag=1 และจับคู่ชื่อ; **ต้นทางไม่ตรงกับข้อกำหนดระบบที่ Owner ชี้แจง จึงใช้ยืนยันความถูกต้องของข้อมูลติดต่อระบบไม่ได้**. เก็บไว้เป็นหลักฐานการทำไฟล์เดิม ไม่ใช้ยอด 64/61 เป็น coverage ของระบบ และยังไม่ได้สร้างไฟล์ใหม่จากฐานข้อมูลจริง
Inline demoแสดงcontactsสมมติด้วยexample.comและเบอร์maskedเท่านั้น ไม่มีcustomercontactsจริงปะปนในHTML
EXL-15 (integration): email/phone ท้าย source ตรงชนิดผู้ติดต่อที่ตกลงและ join ด้วย stable ID จากระบบ; null/ambiguous/source-date ถูกต้อง, zero-prefix และ literal text รักษา, role/snapshot binding และ PII log ไม่รั่ว; preserve Dashboard สูตร/กราฟและข้อมูลเดิม. ทดสอบชื่อบริษัทซ้ำ, เจ้าของหลายบริษัท, หลาย OWNER/ไม่มี OWNER, contact เปลี่ยนหรือถูกล้างหลังสมัคร, email ยังไม่ verified และการไม่ fallback ไป Gmail/Sheet/signup เก่า

ผลไฟล์ตัวอย่างv5: เพิ่มอีเมล64/เบอร์61จาก72บริษัท; ช่องอีเมลว่าง8และโทรว่าง11. รวม2บริษัทชื่อซ้ำจับคู่ผู้ติดต่อไม่ได้และ3emailcellsเป็นข้อความไม่ใช่อีเมล จึงเว้นว่างและทำสีเหลือง; ไม่เดาชื่อ/เลือกcontactแรก. โทร61เป็นstring10หลักขึ้นต้น0ตรงต้นทาง. ไม่ได้แก้source workbookเดิมหรืออ่านข้อมูลสดเพิ่ม.

### 9.1 แหล่งข้อมูลภายในที่ตรวจพบ และมติ Owner

ตรวจจาก source code ใน workspace เท่านั้น ไม่ใช่การอ่านข้อมูลที่ deploy หรือฐานข้อมูล Production:

| ความหมาย | แหล่งข้อมูลปัจจุบัน | ความสัมพันธ์/ข้อจำกัด |
|---|---|---|
| ข้อมูลติดต่อบริษัท | `Company.email`, `Company.phone` | เลือกด้วย `Company.id`; nullable และเป็นคนละชุดกับบัญชีผู้ใช้ |
| ข้อมูลติดต่อบัญชีผู้ใช้ | `User.email`, `User.phoneNumber` | ผูกบริษัทผ่าน `CompanyMembership.companyId/userId` และ roles; หน้าข้อมูลบัญชีและ admin partner members ใช้ชุดนี้ |
| ข้อมูลที่กรอกตอนสมัคร | `CompanySignupRequest.contactEmail`, `phoneNumber` | ผูกคำขอที่ provision แล้วด้วย `companyId/ownerUserId`; เป็นข้อมูล ณ สมัคร ไม่ใช่ fallback ของค่าปัจจุบันที่ผู้ใช้แก้หรือล้างแล้ว |

หลักฐาน: [schema](../../apps/api/prisma/schema.prisma), [signup provisioning](../../apps/api/src/modules/external-signup/application/provision-signup.use-case.ts), [onboarding transaction](../../apps/api/src/modules/system-onboarding/application/use-cases/create-company-onboarding.use-case.ts), [account contact update](../../apps/api/src/modules/auth/application/use-cases/account-profile.use-case.ts), [admin member projection](../../apps/api/src/modules/system-partner-management/application/use-cases/list-partner-members.use-case.ts).

LINE signup ส่ง contactEmail ไป Company.email และพยายามเติม User.email เฉพาะเงื่อนไขที่อนุญาต; เบอร์สมัครส่งไป User.phoneNumber. บัญชีเดิมที่มี contact อยู่แล้วไม่ถูกเขียนทับด้วยคำขอร้านใหม่ จึงห้ามถือว่า Company/User/signup เป็นค่าเดียวกันเสมอ หรือใช้ `COALESCE` ปะปนโดยไม่มีมติ
`User.emailVerifiedAt` บอก verification ของ account email เท่านั้น ไม่รับรอง Company.email หรือเบอร์โทร และอีเมลที่ยังไม่ verified ไม่เท่ากับไม่มีข้อมูล

**Q-EXL-CONTACT RESOLVED — 2026-10-01:** Owner เลือก “เจ้าของบัญชีที่ใช้มั่งมี — ข้อมูลล่าสุดในบัญชี”. แหล่งจริงคือ `User.email` และ `User.phoneNumber` ของเจ้าของปัจจุบันที่ผูกบริษัท; Company contact, signup contact และ Sheet ไม่ใช่ fallback. มตินี้ปิดคำถามด้านความหมายของข้อมูล ยังไม่ใช่การ implement/readback ระบบจริง

### 9.2 กฎ projection ร่วม FE/detail/Excel

1. เริ่มจาก companyId ใน report scope → CompanyMembership ของบริษัทนั้นที่ status=ACTIVE → MembershipRole ที่อ้าง role OWNER ของระบบเดิม (resolve identity ด้วย scopeKey=system/key=OWNER และ role ACTIVE) → User ด้วย userId. ห้ามตรวจเพียงชื่อ role ของ tenant หรือใช้ผู้สร้างบริษัท/ผู้สมัครคนแรกแทนเจ้าของปัจจุบัน
2. ใช้ distinct userId: พบหนึ่งบัญชีจึงคืน contactUserId และ `User.email`/`User.phoneNumber` จาก user เดียวกัน; ตรวจ email/phone แยก field. null/ว่าง/ค่าที่ใช้ไม่ได้ทำให้เฉพาะ field นั้นว่างพร้อม coverage ตามจริง; ไม่ล้างอีก field ที่ยังมีข้อมูล
3. ไม่มีเจ้าของปัจจุบัน: contactStatus=NO_CURRENT_OWNER; หลายบัญชี: MULTIPLE_OWNERS; อ่าน source ไม่ได้: SOURCE_UNAVAILABLE. ทั้งสามกรณี contactUserId/email/phone เป็น null และแสดงเหตุผล ไม่เลือกคนแรก/คนสมัคร/คนเข้าใช้ล่าสุดเอง. สถานะหนึ่งเจ้าของคือ RESOLVED แม้ contact บาง field ขาด. ไม่เพิ่มรายชื่อสมาชิกทั้งหมดใน export นี้
4. สถานะ User เป็นข้อมูลอีกมิติ: SUSPENDED/DISABLED ไม่เปลี่ยนตัวตนเจ้าของที่ยังมี active membership หรือทำให้เลือกคนอื่น; ส่ง accountStatus เพื่ออธิบายสถานะบัญชีในรายละเอียด. หาก membership ถูกระงับ/ปิดหรือ OWNER ถูกถอด จะไม่อยู่ในชุดเจ้าของปัจจุบัน. รายงานนี้ไม่ให้สิทธิ์ login/เปลี่ยนบัญชี/ส่งข้อความ
5. contactSource=OWNER_ACCOUNT; เก็บ contactStatus, contactCoverage แยก email/phone และ sourceAsOf ใน projection. emailVerified อ้าง User.emailVerifiedAt ของ email ปัจจุบันเท่านั้น; อีเมลยังไม่ verified ยังคงแสดงพร้อมสถานะตามจริง และไม่ถือว่าเบอร์ผ่าน OTP
6. “ล่าสุด” คือค่าปัจจุบันตอนสร้าง snapshot รายงาน ไม่ใช่ contact ย้อนหลังตามเดือนที่วิเคราะห์. FE/detail/Excel ใช้ค่าจาก snapshot เดียวกัน; แสดงเวลาข้อมูลบัญชีแยกจาก receipt cutoff. เมื่อแก้/ล้าง contact แล้ว reload รายงานต้องเห็นค่าใหม่; export จาก snapshot เดิมยังใช้ค่าเดิมภายใน TTL และ recheck สิทธิ์ตาม §5
7. หนึ่งบริษัทคงหนึ่งแถวและใช้ฐาน KPI เดิม; เจ้าของหนึ่งคนหลายบริษัทแสดง contact เดียวกันในแต่ละบริษัทที่ผูกจริง ไม่ deduplicate บริษัทด้วย email/phone และไม่ join ด้วยชื่อบริษัท
8. FE ใช้ label “อีเมลเจ้าของบัญชี”/“เบอร์โทรเจ้าของบัญชี” และ — พร้อมเหตุผลเมื่อไม่มี; Excel เว้นเซลล์ว่างจริง มีสถานะข้อมูลติดต่อกำกับ ไม่ใส่ —/0 แทนข้อมูล. phone เป็น string รักษา 0/+; ไม่รวมค่าจากสองบัญชีมาประกอบเป็นผู้ติดต่อหนึ่งคน

EXL-15 เคสย่อยสำหรับ integration: (a) ชื่อบริษัทซ้ำแต่ ID ต่างได้คนละบัญชี; (b) OWNER คนเดียวมี email/phone ต่างจาก Company/signup ใช้ User; (c) ล้างเฉพาะ email แล้ว phone ยังอยู่และไม่ fallback; (d) เปลี่ยน contact แล้ว snapshot ใหม่เห็นใหม่/เดิมไม่ drift; (e) หลาย OWNER ว่างพร้อม MULTIPLE_OWNERS; (f) ไม่มี OWNER ว่างพร้อม NO_CURRENT_OWNER; (g) user หลายบริษัท/หลาย role ไม่คูณแถวหรือ KPI; (h) role ชื่อ OWNER ที่ tenant สร้างเองไม่ผ่าน; (i) account suspended แต่ ownership ยังมี แสดงสถานะจริง/ถูกถอดสมาชิกแล้วไม่เลือก; (j) unverified/invalid/null แยกจาก source failure; (k) ย้ายเจ้าของแล้ว snapshot ใหม่ใช้เจ้าของใหม่; (l) FE/detail/Excel/coverage ตรงกันและไม่รั่ว PII ใน log. ทั้งหมดเป็นเกณฑ์ออกแบบ ยังไม่ได้ยิง API จริง
