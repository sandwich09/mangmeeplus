# ผู้บริหารมั่งมี — กราฟการใช้ใบเสร็จ อันดับการใช้งาน และ 80/20

คำที่แสดงบนหน้าจอล่าสุด: [ใช้คำที่คนทั่วไปเข้าใจ](mangmee-executive-plain-language-spec-th.md) — เมนู “รายรับ”, แท็บ “ลูกค้าที่สร้างรายรับสูง”; identifiers/สูตรเดิมคงไว้

โครงหน้าล่าสุด: [เมนูย่อยและการเปรียบเทียบ](mangmee-executive-navigation-comparison-spec-th.md) แยกหน้าสรุป/วิเคราะห์เพื่อไม่ต้องเลื่อนทุกหัวข้อรวมกัน; เป็นข้อเสนอ UX และเดโม

วันที่: 2026-10-01
สถานะ: ออกแบบและเพิ่ม local demo; ยังไม่ implement application/API
อ้างอิง: [UI](mangmee-executive-business-ui-spec-th.md), [BE](mangmee-executive-business-backend-spec-th.md), [audit](../research/mangmee-executive-business-be-gap-impact-2026-10-01-th.md)

## 1. มติและขอบเขต

Owner ขอกราฟแยกสี คลิกเจาะข้อมูลได้ เรียงตามการใช้งาน ตัวอย่างหลังตัดบริษัททดสอบ 72 บริษัท เคยเพิ่มใบเสร็จ40 (55.6%) / ยังไม่เคย32 (44.4%) และนำ 80/20 Top spender มาใช้
ตัวเลข72/40/32 เป็น fixture สำหรับออกแบบ ไม่ใช่การตรวจข้อมูลลูกค้าจริง
คง B6 เซลล์หรือช่องทาง, paid-not-started กลุ่มเดียว, ธีม shared fields และการซ่อน deletion ตามมติล่าสุด
Owner ยืนยันนิยาม Top spender: เงินที่บริษัทจ่ายให้มั่งมีหักคืนเงินตามช่วงรายงาน; แยกจากค่าใช้จ่ายในใบเสร็จของบริษัทลูกค้าและต้นทุน AI/OCR
การจัดอันดับทั้งหมดใช้แค่ข้อมูลวิเคราะห์ที่ executive มีสิทธิ์อ่าน ไม่มีลิงก์เปิดไฟล์ใบเสร็จลูกค้าจากกราฟนี้

## 2. ฐานบริษัทและเวลา

- ใช้ eligible population เดียวกับ BE§12: distinct companyId, CUSTOMER, สมัครก่อน effectiveEnd; ตัด TEST/INTERNAL ก่อน aggregate/rank/denominator
- ใช้เดือนและ shared industry/discovery/referrer filters เดียวกัน พร้อม snapshotId/definitionVersion/dataThrough
- กราฟแสดงฐาน N หลังกรองเสมอ; N=0 แสดง empty และเปอร์เซ็นต์เป็น null ไม่ทำ 0/0
- “เคยเพิ่ม” = ตั้งแต่สมัครจนถึง cutoff; “จำนวนใบเสร็จในเดือน” = ช่วงรายงาน half-open เวลา Bangkok
- ไม่ใช้ population เฉพาะหน้าตารางหรือเฉพาะบริษัทที่มีรายรับเป็น denominator โดยไม่เปลี่ยนชื่อฐาน
- ไม่รวมบริษัท test จากการค้นชื่อเอง; classification unknown ต้องแจ้ง coverage ไม่เดาเป็นลูกค้าจริง
- เดโมใหม่78แถว =72 CUSTOMER +4 TEST +2 INTERNAL; รายงานทุกหน้าตัด6แถวก่อนสรุป ยอดในเดโมเดิม12บริษัทเป็น historical baseline

## 3. ใบเสร็จและ coverage

metric นี้หมายถึง **ใบเสร็จค่าใช้จ่ายที่ลูกค้าเพิ่มเข้าสู่ระบบ** ไม่ใช่ `companiesWithReceipts` เดิมที่หมายถึงบริษัทที่จ่ายเงินให้มั่งมี
ใช้ชื่อใหม่ `expenseReceiptAdoption` และ `expenseReceiptCountInPeriod` เพื่อไม่ชน billing receipts

ข้อเสนอสำหรับ Q03: นับใบเสร็จเมื่อผูก primary receipt กับ canonical expense สำเร็จ มีหลักฐาน commit; deduplicate ต่อ companyId+expenseId
ไม่นับ upload reservation/presigned URL, draft ที่ไม่มีไฟล์, OCR admission หรือ failed upload
OCR ไม่สำเร็จภายหลังไม่ยกเลิกเหตุการณ์เพิ่มไฟล์สำเร็จ; แยก “เพิ่มสำเร็จ” จากอ่าน OCR/ลงบัญชีสำเร็จ
หลายหน้า/ภาพแนบเสริม/replace/retry ของ expense เดียวไม่นับเป็นใบเสร็จใหม่; merge ต้อง resolve canonical identity
ตัวอย่างนี้ไม่นับเอกสารทดแทนใบเสร็จหรือ manual expense ที่ไม่มี primary receipt โดยอัตโนมัติ; ต้องสรุป inclusion policy ใน Q03 ก่อน integration
การลบ/เปลี่ยนไฟล์ภายหลังไม่ทำให้บริษัทที่เคยใช้กลับเป็น “ไม่เคย” จากการดู active attachment ปัจจุบันอย่างเดียว

Source ที่ตรวจใน working tree:

- [expense upload](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts): complete ตรวจ scope/permission และ commit ก่อน `expense.upload.complete` / `expense.receipt_uploaded`
- [LINE expense upload](../../apps/api/src/modules/expenses/application/use-cases/expense-document.use-case.ts): `expense.line_receipt_uploaded` มีทางเข้าอีกแบบ
- audit/outbox ถูกเรียกแบบ `void` บางจุด จึงยังพิสูจน์ lifetime completeness ไม่ได้จากการพบ event เหล่านี้เท่านั้น
- ต้อง reconcile persisted source และ deduplicate สองช่องทาง; เพิ่ม coverage start/provenance ก่อน backfill ห้ามใช้ current file count สรุป never

| หลักฐานก่อน cutoff | สถานะ | สี/การแสดง |
|---|---|---|
| เคยมี qualifying receipt ≥1 | EVER | เขียว; จำนวนบริษัท / N |
| ไม่พบ และประวัติครบตั้งแต่สมัคร | NEVER | น้ำเงิน; จำนวนบริษัท / N |
| ไม่พบ แต่ประวัติไม่ครบ | UNKNOWN | เทา; “ยังประเมินไม่ได้”; ห้ามรวม NEVER |

สมการ EVER+NEVER+UNKNOWN=N; `% = count/N*100`, ปัดหนึ่งตำแหน่งเฉพาะแสดงผล
40/72=55.555…→55.6%;32/72=44.444…→44.4%; ห้ามเอาค่าที่ปัดแล้วไปคำนวณเงินหรืออันดับ
UNKNOWN เป็นสถานะ coverage ของ metric ไม่ใช่ paid usage business cohort ใหม่

## 4. การคลิก สี และอันดับ

- แถบกราฟและคำอธิบายทุกกลุ่มคลิก/Enter/Space ได้ มี label+จำนวน+% ไม่สื่อด้วยสีอย่างเดียว
- สีของ EVER/NEVER/UNKNOWN และ Top20/ส่วนที่เหลือคงความหมายข้ามกรอง/เปลี่ยนอันดับ ใช้ tokens ของแอป
- กลุ่มธุรกิจ/ช่องทาง/เซลล์มีแถบจำนวนบริษัทแยกสีและคลิกได้; key สีผูก category ID ไม่เปลี่ยนตาม sort
- เปิด directory ด้วย shared filters/snapshot เดิมและ cohort ที่กด; reset list-only entity/usage/service/query ที่ไม่เกี่ยวข้อง เพื่อแก้สาเหตุ G22 ในเดโม
- แสดง chip/ข้อความฐาน cohort และ sort ชัด; เปลี่ยน shared filter หลังเลือก cohort ให้คำนวณสมาชิกกลุ่มใหม่จาก snapshot ใหม่
- ค่าเริ่มต้นอันดับการใช้ = จำนวนใบเสร็จในเดือนมาก→น้อย; เลือกวันใช้งาน/AI requests ได้ ไม่สร้างคะแนนรวมข้ามหน่วย
- null เรียงท้าย ไม่ถือเป็น0; ค่าเท่ากัน tie-break companyId ASC; จำนวนที่แสดงเป็น known count หาก coverage ไม่ครบ
- chart แสดง10อันดับแรกและปุ่มดูอันดับทั้งหมด; list pagination ไม่เปลี่ยนค่า total/denominator/rank
- กลับจาก detail คง cohort/sort/page; เปลี่ยน filter/sort/cohort reset page1; out-of-range clamp; “ล้างตัวกรอง” clear cohort/sort/page โดยคงเดือน

## 5. Top spender / Pareto

นิยามเงินที่ Owner ยืนยัน: `net_i = verified receipts_i − actual refunds_i` ในช่วงที่เลือก ตาม BE§14
ให้ดูยอดรับสุทธิจริงในตารางเสมอ; ข้อเสนอทางคำนวณสำหรับกรณีค่าติดลบคือส่วนกราฟ concentration ใช้ `w_i = max(net_i,0)` เพราะส่วนแบ่งสะสมต้องไม่ลดลง
`positiveNetTotal = sum(w_i)` ต้องมีชื่อฐานชัดว่า “ยอดรับสุทธิที่เป็นบวก” ไม่อ้างว่าเท่ากับยอดรับสุทธิทั้งแพลตฟอร์ม
แสดงยอดติดลบรวม/จำนวนบริษัทที่ net≤0 แยก เมื่อมี; platform net ยังคงรวมค่าติดลบตามจริง

- N = บริษัทจริงทั้งหมดหลัง shared filters แม้ไม่มีการจ่าย; K=ceil(N*0.2)
- เรียงเฉพาะ w_i>0 มาก→น้อย, tie companyId ASC; topCount=min(K,positiveCount)
- Top20 share = sum(w ของ topCount)/positiveNetTotal; แสดงจำนวนจริงและ topCount/N เสมอ เพราะการปัดขึ้นอาจเกิน20%
- ถ้าผู้จ่ายบวกน้อยกว่า K ให้บอกว่ามีผู้จ่ายบวกไม่ถึง20%; ไม่เติมบริษัท0บาทแล้วเรียก spender
- กลุ่มถึง80% = minimal prefix ที่ cumulative >= 80% ของ positiveNetTotal; ใช้ integer satang เปรียบเทียบ `cumulative*100 >= total*80` ก่อนปัด
- tie ที่ขอบไม่ขยายกลุ่มอัตโนมัติ; แสดงกฎ tie-break และบริษัทที่เงินเท่ากันได้อันดับ deterministic
- สีน้ำเงิน Top20 และสีเทากลุ่มนอกTop20; กดแถบหรือจำนวนไปยังสมาชิกกลุ่มเดียวกัน โดย directory เรียง net DESC
- “นอกTop20” ใช้ N ลบสมาชิกTop20 จึงรวมผู้ไม่มี net บวกด้วย; รายการระบุยอด0/ติดลบตามจริง
- คลิก “บริษัทที่รวมกันถึง80%” เปิด exact prefix; อย่าใช้ top20 แทน prefix80 เพราะจำนวนอาจต่างกัน
- total=0 ไม่มี Pareto/share/80% group; แสดงเหตุผล ไม่วาดกราฟปลอม
- cash coverage ขาดแม้บริษัทเดียว: แสดงยังจัดอันดับครบไม่ได้ ปิด exact Top20/80% actions; ไม่เผยอันดับที่อาจเปลี่ยนจาก unknown
- การต่ออายุ/ส่วนเสริมรวมตาม net cash; sales credit และต้นทุนไม่ใช่ยอดจ่าย ไม่รวม currency ต่างกันโดยไม่กำหนด policy

## 6. API extension proposal

Reuse API02/API04/API03/API05 ไม่สร้าง generic analytics engine หรือ service ใหม่โดยไม่มีความจำเป็น
API02/API04 เพิ่ม `expenseReceiptAdoption {population,ever,never,unknown,cutoff,coverage,segments[]}`,
`usageRanking {metric,period,total,items[],coverage}` และ API04 เพิ่ม `spendConcentration`
ส่วน Pareto คืน population/positiveCompanyCount/positiveNetTotalSatang/signedNetTotalSatang/negativeNetSatang/topTargetCount/topCount/topShare/prefix80Count/prefix80Share/coverage
items ใช้ companyId/displayName/rank/value/cumulativeShare และ allowlisted drilldown descriptor ไม่ส่ง customer document/file locator
API03 query เพิ่ม `receiptAdoption=ALL|EVER|NEVER|UNKNOWN`, `spendCohort=ALL|TOP20|REST|TO80`, `sort=RECEIPTS_DESC|ACTIVE_DAYS_DESC|AI_DESC|NET_DESC`
validate enum, incompatible cohort+sort/source snapshot, reject altered cursor/filter mismatch; scope/permission ตรวจซ้ำจาก session
BE derive cohort membership; ไม่รับ client array ของ companyIds หรือ % เพื่อใช้เป็น authority
companyId tie-break และ null-last ต้องตรงระหว่าง charts/SQL/page cursor; money integer satang, count nonnegative integer และ timestamp UTC
API05 usage เพิ่ม receipt count ในช่วง / lifetime adoption / coverage; รายการใบเสร็จจริงยังต้องผ่าน expense permission แยก
current receipt/document aggregation แยกจาก billing payments และจาก documents metric เดิมที่กว้างกว่า

## 7. Impact / gaps เพิ่มเติม

| ID | ช่องว่าง/ผลกระทบ | สถานะ/แนวปิด |
|---|---|---|
| A01 | source upload web/LINE/replace/supporting/retry และ event completeness ไม่พอพิสูจน์ never | OPEN: Q03 + expense/attachment/event owners; durable coverage+dedup+backfill evidence |
| A02 | sourceบริษัทจริง/unknown classification กระทบฐาน72และ% | OPEN: reuse G13/Q02; ไม่ใช้ fixtureเป็นclassification |
| A03 | cash refunds/unknown/signednet/ties กระทบParetoและrank | OPEN: reuse G11/G12/G19/G21/Q04; reconciliation และ counterexample tests |
| A04 | chart/list/detail/filter/page/restoredstate drift | DEMO CHECK REQUIRED / APP OPEN: reuse G22/G23/G27/G35; same cohort/query snapshot |
| A05 | quantity receipt ต่างจาก documents/billing receipts และการเปิด PII | OPEN: explicit contract/allowlist/expense permissions; label ไม่ใช้ชื่อกำกวม |

G01–G35 เดิมยังคงสถานะ application 22 OPEN +13 DEFERRED; A01–A05 เป็น extension register แยก ไม่แอบเปลี่ยนเป็น CLOSED
ข้อเสนอ Q03/Q04 ยังต้องยืนยันก่อน application integration แม้เดโมคำนวณตามกติกานี้

## 8. Verification / acceptance

- 78 records รวม high-usage/high-spend TEST/INTERNAL ต้องเหลือ72ก่อนรวมยอดทุกกราฟ; 40/32 ตรงกับรายการครบทุกpage
- EVER/NEVER/UNKNOWN partition, 0population, allnever/allever, incomplete history, prior-month-only upload, failed upload, duplicate/replace/supporting/LINE retry
- การกด segment/legend/category/อันดับ/Top20/Rest/80%, detailและBack, shared filter change, sortและpaging มี contextเดียวกัน
- Pareto N=72→K15; N=1/4/5/6 rounding; 0cash/allrefunded/negative-only/mixednegative; fewpayers; ties; exact80boundary; incompletecash; renewalsและrefundperiod
- receipt metric/AI/day sort ไม่ผสมหน่วย; null-last/ties deterministic; ranking10ไม่ตัด populationtotal
- แป้นพิมพ์ มือถือ ธีม dropdown ภายใต้ darkOS; unknown/empty ไม่แสดง falsezero; hidden deletion ยังหาย
- pure local math และ browserdemo ตรวจจริงแยกจาก spec scenarios; ไม่มีผล FE→HTTP→DB ของ extension นี้จน implement


## 9. ผลตรวจเดโมรอบนี้

Owner ตอบยืนยัน Top spender = “เงินจ่ายให้มั่งมี หักคืนเงิน” แล้ว; ข้อกำหนด source/coverage/Q03/Q04 ที่ยังเปิดไม่ถูกถือว่าอนุมัติด้วยคำตอบนี้

Oracle ของ fixture ใหม่:

- 78 records ตัด TEST4/INTERNAL2 →72 CUSTOMER; receipt EVER40/NEVER32/UNKNOWN0
- ภาพรวม active อย่างน้อย38 (อีก1 usage coverage ไม่ครบ), positive receipt companies59; net24580600สตางค์
- ผู้มี net บวก58; Top20 target=ceil(72×0.2)=15, actual15 (20.8% ของฐาน)
- Top15 net20493000สตางค์ /24580600 =83.4% เมื่อปัดหนึ่งตำแหน่ง; rest57บริษัท/16.6%
- prefix80 ใช้13บริษัท รวม19895000สตางค์ =80.9%; กลุ่มนี้คิดเป็น18.1% ของบริษัท
- counts และ sums มาจากแถวเดียวกันกับ directory; fixture เดิม12บริษัทเก็บอยู่ใน72บริษัทนี้ ไม่ใช่ยอดจริงของระบบ

ผลตรวจจริง local:

- `check-analytics.ts` PASS: 40/72,32/72, unknown/zero, null-last/tie, ceil20% N0/1/4/5/6/72, exact80/below80, zero/refunded/negative/mixed net, cash incomplete และ positive payersน้อยกว่าK
- `check-demo.cjs` PASS: 40/32ครบทุกหน้า; chart→directory/detail/Back; hidden list filters reset; Top15/prefix13/Rest57 membershipและยอดรวม; อันดับตามวันใช้งาน/ใบเสร็จ; source/sellerและcredit; account states; HIDE-01–04; theme controls/responsive
- พบและแก้ local analysis grid min-content ทำหน้ามือถือล้น; constrain grid track ด้วย minmax(0,1fr) และย่อปุ่ม80%; ตรวจซ้ำ PASS overview1440/1024/768/390/320, analysis1024/390/320 และ darkOS
- ภาพ `overview-v3.png`, `analysis-v3.png`, `pareto-v3.png`, `pareto-mobile-v3.png`, `mobile-v3.png` ในพื้นที่เดโมตาม memory; ตรวจภาพ Pareto desktop/mobile แล้ว
- ขนาด inline fragment470390bytes; ไม่มี dependency, application/API/schema หรือ live data เปลี่ยน

ข้อจำกัด: null receipt/cash branches ตรวจใน pure math; data72ชุดแสดงปกติมี receipt/cash coverageครบ. ยังไม่รัน backend source reconciliation หรือ FE→HTTP→DB ใหม่

เพิ่มเติมการตรวจ: category bar ผ่าน Enter, receipt legend ผ่าน Space; กรองร้านอาหารได้ฐาน14/EVER10(71.4%)/NEVER4(28.6%) และ directory10ตรงกัน; AI sort มาก→น้อยและเปิดอันดับทั้งหมดผ่าน. ลด follow-up preview เหลือ5ตัวอย่างพร้อมจำนวนทั้งหมด และใช้ category color mapping คงที่ตามkey
