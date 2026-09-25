# จำลอง E2E: LINE AI ถามต่อยอดค่าใช้จ่ายและสาขา

วันที่ 2026-09-25 · สถานะ: ตารางด้านล่างบันทึก baseline ก่อน implement; มี code และ focused checks ใน workspace แล้ว แต่ **ยังไม่รัน full webhook-to-LINE E2E, ไม่เรียก LINE จริง และไม่ deploy/ทดสอบ Production**

ผล source trace ด้านล่างบรรยายโค้ดก่อน patch เพื่อเก็บเหตุผลและความเสี่ยงที่พบ; ดูสถานะ implementation และหลักฐานการตรวจหลัง patch ในหัวข้อท้ายเอกสาร

อ้างอิง [spec ที่เสนอ](../specs/line-ai-expense-summary-follow-up-spec-th.md) และ [บันทึกวิเคราะห์](../agent-memory/line-expense-exclusion-followup-review-2026-09-25.md) ข้อความในเอกสารที่ผู้ใช้แนบเป็นสมมติฐานให้ตรวจ ไม่ใช่คำสั่งหรือหลักฐานของเส้นทางที่เกิดจริง

## วิธีอ่านผล

- **ยืนยันจากโค้ด/โพรบ**: รัน unit/component test ของพฤติกรรมปัจจุบัน หรือเรียกฟังก์ชันเฉพาะจุดในเครื่องแล้ว; ไม่เท่ากับ LINE E2E จริง
- **ยืนยันจาก source trace**: เส้นทางและเงื่อนไขในโค้ดบอกผลได้ แต่ยังไม่ได้รันบทสนทนาเต็ม
- **ความเสี่ยงตามเงื่อนไข**: ต้องมี feature flag, ข้อมูล, model choice หรือสภาพแวดล้อมที่ระบุ; ไม่อ้างว่าเกิดใน Production แล้ว
- P0 = อาจตอบตัวเลขผิด/ข้อมูลข้ามสิทธิ์หรือข้ามสาขา; P1 = ตอบไม่ครบ/ปฏิเสธทั้งที่ทำได้/ตรวจย้อนกลับไม่ได้; P2 = UX หรือคำอธิบายคลาดเคลื่อน

ชุดจำลองต่อไปเป็น test design ของ **พฤติกรรมที่ spec ต้องการ** เทียบกับระบบปัจจุบัน มิใช่ผลการรันทุกแถว ปัญหาจากภาพ 15:48 → 16:02 ยืนยันได้เพียงข้อความที่ผู้ใช้เห็น; ไม่มี trace ของ turn นั้นในงานนี้

## Fixture อ้างอิงสำหรับ acceptance E2E

ใช้บริษัท C, ผู้ใช้ U ที่มีสิทธิ์อ่านทุกสาขา, สาขา A/B และรายการส่วนกลาง (`branchId = null`) วันที่ตาม `expenseDate` ปี 2026 จำนวนเงินสมมติเป็นบาท:

| เดือน/สาขา | รายการที่นับ | รายการที่ตัดออก | ยอดและจำนวนที่คาด |
| --- | --- | --- | --- |
| ก.ค. / A | DRAFT 100, CONFIRMED 200 | REJECTED 900, VOIDED 800 | 300 / 2 |
| ก.ค. / B | CONFIRMED 300 | — | 300 / 1 |
| ก.ค. / ส่วนกลาง | CONFIRMED 50 | — | 50 / 1 |
| ส.ค. / A | NEEDS_REVIEW 110, CONFIRMED 220 | REJECTED 990, VOIDED 880 | 330 / 2 |
| ส.ค. / B | CONFIRMED 330 | — | 330 / 1 |
| ส.ค. / ส่วนกลาง | CONFIRMED 60 | — | 60 / 1 |

ดังนั้นยอดทุกสาขา ก.ค. = 650/4, ส.ค. = 720/4; เฉพาะ A = 300/2 และ 330/2 ตามลำดับ รายการรอตรวจสอบถูกนับในยอดปกติ รายการส่วนกลางรวมในยอดทุกสาขา แต่ไม่รวมเมื่อระบุ A หรือ B ชัดเจน ตัวเลขนี้ใช้ตรวจ test fixture เท่านั้น ห้ามแสดงแทนยอดลูกค้า

## เมทริกซ์เคสจำลอง

| ID | บทสนทนา/สภาพตั้งต้น | ผลที่ spec ต้องการ | สิ่งที่พบในระบบปัจจุบัน / ช่องว่าง | ระดับ |
| --- | --- | --- | --- | --- |
| E01 | ได้สรุป ก.ค.+ส.ค. ครบ ส่งถึง LINE; ถาม `เอาแบบไม่รวมยอดยกเลิกและปฏิเสธ` | ยืนยันว่าเกณฑ์เดิมตัดสองสถานะอยู่แล้ว; ไม่ทวนเลข/ไม่เรียก tool ซ้ำ | API tool ตัดจริง; แต่ไม่มี prior-result descriptor ส่งให้ Gateway และ exact phrase ยังหลุด deterministic composer guard หลังมี tool result **(โพรบ)**; route ของภาพยังไม่ทราบ | P1 |
| E02 | เปลี่ยนเป็น `ไม่รวมยกเลิกและปฏิเสธ`, `ไม่รวมรายการที่ถูกปฏิเสธและยกเลิก`, `อันนี้ไม่รวมใช่ไหม` | ถือเป็นการยืนยันเกณฑ์หากอ้างผลเดียวชัด | guard รับบางรูปคำ แต่ไม่มีตัวจำแนก follow-up ที่ผูกกับหลักฐานผลก่อนหน้า **(source trace)** | P1 |
| E03 | ไม่มีผลก่อนหน้า; ถาม `ไม่รวมยกเลิกหรือยัง` | ตอบกติกาทั่วไปหลัง gate; ไม่กล่าวว่าเคยแสดงยอด | context ปัจจุบันไม่มีผลก่อนหน้าให้ตรวจ; ต้องกันการอ้างผลที่ไม่มีจริง **(gap)** | P1 |
| E04 | เคยได้ผลแต่ขอ `ยอดเท่าไร`, `แสดงยอดเดิมอีก`, `ยอดตอนนี้` | re-query ตามสิทธิ์/ช่วงที่ระบุ; ตอบ `asOf` ใหม่ | ไม่มี verified prior query ให้ carry ช่วงเดิม; ถ้า input ว่าง tool default เดือนปัจจุบัน **(โพรบ)** | P0 |
| E05 | สรุป ก.ค.+ส.ค. แต่มี tool result เฉพาะ ก.ค.; ถามยืนยันเกณฑ์ | ห้ามยืนยันว่า *ผลสองเดือน* ครบ; re-query หรือถามกลับ | JSON tool loop ลบชื่อ tool หลังเรียกครั้งแรก จึงเรียก `expense.list_recent` สองรอบใน loop นั้นไม่ได้; native loop ทำได้; พบ Production turn **คนละ turn กับภาพ** เคยเรียกเพียง ก.ค. **(source trace/บันทึกเดิม)** | P0 |
| E06 | ผลก่อนหน้ามี `truncated=true` จากเกิน 1,000 records | ไม่ยืนยันยอดเต็ม; ระบุว่าข้อมูลไม่ครบ | tool ส่ง `truncated`; composer มีคำตอบเฉพาะกรณีนี้ แต่ prior descriptor ไม่ส่งต่อให้ turn ใหม่ **(source trace)** | P0 |
| E07 | ผลก่อนหน้า ERROR, REFUSED หรือส่ง LINE ไม่สำเร็จ | ไม่อ้างว่าเป็นผลที่ผู้ใช้เห็น | context โหลด COMPLETED/REFUSED ไม่มี delivery proof หรือ query binding; `LineTurnOutcome.deliveredAt` แยกอยู่ **(source trace)** | P1 |
| E08 | ภายใน 15 นาทีมีสรุปหลายชุด เช่น ก.ค. และ ส.ค. คนละ turn; ถาม `อันนี้` | ถามว่าอ้างชุดไหน หากชี้ไม่ได้ | context มี user text/intent แต่ไม่มีผล, period, branch ที่ยืนยันแล้ว **(source trace)** | P1 |
| E09 | เกิน 15 นาทีแล้วถามยืนยันผลเก่า | ตอบกติกาทั่วไปหรือถามช่วง; ไม่อ้างผลนั้น | context จำกัด 15 นาที แต่ต้องมี no-reference behavior ชัดใน flow ใหม่ **(gap)** | P1 |
| E10 | อ้างตัวเลขที่ model เคยตอบแต่ไม่มี tool result ครบ | ไม่ใช้ข้อความโมเดลเป็นหลักฐาน | `replyPreview` ถูกละจาก model context โดยตั้งใจ; `LineReadEvidence.resultHash` อย่างเดียวพิสูจน์คำตอบหลายเดือนไม่ครบ **(source trace)** | P0 |
| E11 | ผู้ใช้พูด `ค่าใช้จ่ายเดือนกรกฎาคมและสิงหาคม 2569` | อ่านสองช่วงและแสดงผลสองเดือน | extractor ให้ ก.ค.+ส.ค. แต่ JSON loop เรียก tool ชนิดเดียวได้ครั้งเดียว; native loop รองรับ distinct inputs **(โพรบ/source trace)** | P0 |
| E12 | พิมพ์ `กรกฏาคมและสิงหาคม 2569` | ไม่เงียบแล้วตอบเฉพาะ ส.ค.; ถามหรือระบุเดือนที่อ่านไม่ได้ | extractor ให้เฉพาะ ส.ค. **(โพรบ)**; ไม่มี completeness guard ที่เทียบคำขอทุกช่วงครบ | P0 |
| E13 | หลังผล ก.ค.+ส.ค. ถาม `เอาเฉพาะสิงหาคม` | อ่าน ส.ค. ใหม่; ยืนยันว่าตัด ก.ค. | extractor ให้ช่วง ส.ค. 2026 **(โพรบ)**; ควรทดสอบว่า branch เดิมคงอยู่เมื่ออ้างผลเดียว | P1 |
| E14 | หลังผล ส.ค. ถาม `แล้วเดือนก่อนหน้าล่ะ` ในเดือน ก.ย. | หากอ้าง ส.ค. ชัด ให้หมายถึง ก.ค.; ถ้าไม่ชัดถามกลับ | extractor ปัจจุบันคืน ส.ค. (เดือนก่อนหน้า *วันนี้*) **(โพรบ)**; อาจตอบเดือนเดิมซ้ำ | P0 |
| E15 | หลังผล ก.ค.+ส.ค. ถาม `แล้วเดือนก่อนหน้าล่ะ` | ถามว่าเดือนก่อน ก.ค. หรือก่อน ส.ค. หากไม่มี anchor เดียว | spec เดิมยังไม่ได้แยก relative anchor หลายช่วง **(gap)** | P1 |
| E16 | ขอสรุปเดือนเดิมแต่ไม่ระบุปี / ปี พ.ศ. / ข้าม ธ.ค.→ม.ค. | ใช้ candidate ที่ resolve ได้และระบุปี/ช่วงจริง; กำกวมต้องถาม | API สร้าง `valueCandidates` แต่ Gateway ส่งเข้า AgentCore ไม่ครบ; เมื่อไม่มี candidate full loop date guard เปิด **(source trace)** | P0 |
| E17 | ขอสองเดือน แต่เกิน tool-call budget, tool ช่วงที่สอง timeout | ตอบเฉพาะช่วงที่ตรวจแล้วพร้อมระบุส่วนขาด หรือถามกลับ; ห้ามอ้างครบ | budget มีเพดาน; ไม่มี proof ของ requested-period set เทียบ successful-result set **(gap)** | P0 |
| B01 | หลังสรุป ก.ค.+ส.ค. ถาม `ดูเฉพาะสาขา A` | คงทั้งสองเดือนตามผลเดิมและ re-query A; ได้ 300/2, 330/2 | branch input มีจริง แต่ branch-only ไม่มี period candidate; tool input ว่าง default ก.ย. 1–25 **(โพรบ)** | P0 |
| B02 | ขอ `ส.ค. เฉพาะสาขา A` ด้วยรหัสหรือ ID ที่ตรง | ได้ 330/2 ตามสิทธิ์และ `expenseDate` | tool resolve ID/name/code แบบ exact และใช้ ABAC **(unit test/source trace)**; ยังต้องตรวจ end-to-end ผ่าน router/composer | P1 |
| B03 | ขอชื่อสาขาพิมพ์ผิดหรืออยู่นอกสิทธิ์ | ไม่ตอบยอดศูนย์อย่างมั่นใจ; ถามเลือกเฉพาะสาขาที่เปิดเผยได้ | tool คืน `branchUnresolved` และ catalog ที่จำกัดสิทธิ์ **(unit test/source trace)**; model retry/clarify ต้องตรวจ | P1 |
| B04 | มีสาขา A สองแห่งชื่อเดียวกันแต่รหัสต่างกัน | แจ้งว่าชื่อสาขาซ้ำและให้เลือกจากหน้าเว็บ; ไม่สุ่มเลือกหรือแสดงรหัสภายใน | schema บังคับ unique เฉพาะ `(companyId, code)`; tool เดิมเลือกชื่อแรกในผลที่ไม่กำหนดลำดับ **(source trace, ต้องมีข้อมูลชนกัน)** | P0 |
| B05 | มีสาขา active ที่ผู้ใช้เห็นได้ >100 แห่ง; ขอแห่งที่ไม่อยู่ 100 แรก | ค้นได้หรือแจ้งข้อจำกัดอย่างถูกต้อง | lookup `take: 100` ก่อน exact match; อาจคืน unresolved ทั้งที่มีสาขาจริง **(source trace, ขึ้นกับข้อมูล)** | P1 |
| B06 | ผู้ใช้มีสิทธิ์เฉพาะ A; ขอ B หรือขอทุกสาขา | ไม่รั่วชื่อ/ยอด B; ผลทุกสาขาต้องอยู่ใน scope ที่ได้รับ | ERP tool รับ `ctx.branchIds`; branch catalog จำกัด scope; ต้องทดสอบ reply/link และการเปลี่ยน scope ระหว่าง turn **(unit test/source trace)** | P0 |
| B07 | ผู้ใช้ถาม `เฉพาะ A` แต่ prepared simple-read path เปิดใช้งาน | ต้องไม่ทิ้ง branch แล้วตอบยอดรวม | intake prompt ห้ามใส่ branch ใน prepared call; parser ปฏิเสธ key branch; eligibility ไม่ตรวจว่า user ระบุ branch; เสี่ยง query `{}` แล้วตอบทุกสาขา **(เงื่อนไข: lane เปิดและ model เลือก plan นี้)** | P0 |
| B08 | A → B หรือ A → ทุกสาขาใน follow-up | re-query scope ใหม่; ห้ามใช้ยอด A เดิม | ไม่มี prior branch descriptor ให้ patch แบบปลอดภัย **(gap)** | P0 |
| B09 | รายการส่วนกลาง `branchId=null` เทียบ A/ทุกสาขา | A ไม่รวมส่วนกลาง; ทุกสาขารวมตาม ABAC; อธิบายฐานให้ชัด | explicit branch filter จำกัด `branchId=A`; spec เดิมยังไม่ระบุคำถาม `ส่วนกลาง` ว่าหมายถึงอะไร **(source trace/gap)** | P1 |
| B10 | สิทธิ์สาขาถูกถอนหลังผล A ก่อนถามย้ำ | ไม่ยืนยันผล A อีก; ไม่มีเลขเก่าหรือ link ที่เข้าถึงไม่ได้ | ต้อง recheck current identity/membership/ABAC ก่อนใช้ reference; context ปัจจุบันยังไม่เก็บ descriptor สาขา **(gap)** | P0 |
| F01 | ขอ `เฉพาะยืนยันแล้ว`, `เฉพาะจ่ายแล้ว`, `รวมยกเลิก`, `เฉพาะหมวดเดินทาง` | ระบุความสามารถที่ยังไม่มีอย่างตรง; ไม่ส่งยอดปกติปลอมเป็นยอดกรอง | summary tool ไม่มี filter เหล่านี้; `paidAmount` เป็น metric ในฐานรวม ไม่ใช่ paid-only filter; breakdown เป็น group ไม่ใช่ category-only filter **(source trace)** | P0 |
| F02 | tool ส่ง `items` ที่มี REJECTED/VOIDED ขณะที่ total ตัดออก | headline และ preview ต้องไม่ชวนให้เข้าใจว่ารายการเหล่านั้นถูกรวม | summary reducer ตัด แต่ `items` มาจาก raw expenses 5 รายการแรก **(source trace)** | P1 |
| F03 | `countedItems=0` แต่ raw rows เป็น REJECTED/VOIDED ทั้งหมด | อธิบายว่าไม่มีรายการ *ที่นับตามเกณฑ์* ไม่ใช่ไม่มีเอกสาร | `total` คือจำนวนที่นับ, `cancelledCount` อีก field; formatter/reply ต้องรักษาความหมาย **(source trace)** | P1 |
| F04 | ผู้ใช้ถาม `จ่ายจริงเท่าไร` หลังได้ยอดปกติ | ห้ามตีความ `totalAmount` เป็นเงินที่จ่ายจริง | ยอดปกติรวม pending; ต้องใช้สัญญา metric ที่ชัดหรือบอกข้อจำกัด **(source trace)** | P1 |
| S01 | เปลี่ยนบริษัท, คนละกลุ่ม LINE/DM, user เดียวกัน | prior reference ต้องไม่ข้าม company/chat | context ปัจจุบันกรอง company/user แต่ไม่ chat; `AiTurn` ไม่มี chat hash; `LineReadEvidence.inputJson` อาจมี chat hash แต่ไม่มี link ตรงถึง turn **(source trace)** | P0 |
| S02 | มี expense เปลี่ยนสถานะ/จำนวนหลังผลก่อนหน้า | ถ้าขอยอดอีกต้องอ่านใหม่; ถ้าถามเกณฑ์ให้ระบุว่าเกณฑ์ของผล ณ เวลานั้น | `LineReadEvidence.verify()` เรียก ERP tool ใหม่และเทียบ hash; ใช้เป็น no-query confirmation โดยตรงไม่ได้ **(source trace)** | P0 |
| S03 | ERP timeout/error/forbidden ระหว่าง refresh | ไม่ fallback ไปเลขเก่า ไม่ตอบ `0`; แจ้งสาเหตุเหมาะสม | ต้องตรวจ API→Gateway→composer→LINE ทั้ง timeout/forbidden **(gap การทดสอบ)** | P0 |
| S04 | LINE ส่งซ้ำ webhook/retry หลังคำตอบตัดสินแล้ว | ใช้ terminal outcome เดิมโดยไม่คำนวณใหม่ตามข้อมูลที่เปลี่ยน | มี `LineTurnOutcome` เก็บ messages เพื่อ replay; flow ใหม่ต้องไม่ข้าม idempotency/delivery gate **(source trace)** | P1 |
| W01 | กดลิงก์เว็บจากคำตอบ ส.ค. เฉพาะ A | เว็บต้องไม่ถูกอ้างว่าแสดงชุดเดียวกันทันที ถ้ายังไม่ส่ง period/status basis | link มีแค่ `branchId`; web default ใช้ upload date และทุกสถานะ **(source trace)** | P1 |

## จุดที่กระทบหลายโมดูลและลำดับแก้ตามความเสี่ยง

1. **P0 ตัวเลขผิดช่วง/สาขา**: API ส่ง period candidates แต่ Gateway→AgentCore ทำหาย; branch-only follow-up ไม่มีช่วงเดิม; relative month ผูกกับวันนี้; JSON loop เรียก tool ชนิดเดิมซ้ำไม่ได้; prepared lane อาจทิ้ง branch; branch name ซ้ำอาจเลือกผิด สัญญาใหม่ต้องปิดทุก route ที่เปิดใช้ ไม่ใช่เฉพาะ composer
2. **P0 หลักฐานผลเดิมไม่ครบ**: `AiTurn`/context ไม่มี tool input/result completeness/chat binding; `LineReadEvidence` บันทึก query/hash แต่ไม่ผูก delivery และ `verify()` re-query จึงไม่ใช่หลักฐาน no-query โดยลำพัง ต้องกำหนด descriptor ที่ผูก turn, request, evidence, `LineTurnOutcome.deliveredAt` และ scope โดยไม่ใช้เลขเก่าเป็น source ใหม่
3. **P1 ตอบผิดความหมาย**: ยืนยันเกณฑ์เดิมกับขอ filter ใหม่ต้องแยกก่อนเข้า unsupported; exact phrase ในภาพยังหลุด guard เฉพาะจุด; raw preview และ web link อาจขัด headline แม้ aggregate ถูก
4. **P1 แยกข้อจำกัดจริง**: status/payment/category-only ต้องตอบตาม capability จริง; สาขา/ช่วงเวลาทำได้เมื่อ resolve และเช็คสิทธิ์; unresolved branch ต้องถาม ไม่ตีเป็น 0

## จุดอ้างอิงข้ามโมดูล

| โมดูล | หลักฐานที่ใช้จำลอง |
| --- | --- |
| API expense tool | [`resolvePeriodInput`, `ExpenseListRecentTool`](../../apps/api/src/modules/line-ai/application/use-cases/erp-tools.use-case.ts): default เดือนปัจจุบัน, branch lookup 100 รายการ, excluded statuses, page cap, preview และ web path |
| Expense/Branch schema | [`Branch`, `ExpenseRecord`, `AiTurn`, `LineReadEvidence`, `LineTurnOutcome`](../../apps/api/prisma/schema.prisma): branch code unique แต่ชื่อไม่ unique; query evidence และ delivery แยกกัน |
| API conversation | [`loadConversationContext`](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts): 15 turn/15 นาทีตาม company/user, ไม่ส่ง reply/tool state และไม่กรอง chat |
| API read evidence | [`LineReadEvidenceService`](../../apps/api/src/modules/line-ai/application/line-read-evidence.service.ts): input/hash/request ID, current permission check และ verify ที่ re-query |
| Gateway orchestration | [`orchestrator.agent.ts`](../../apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts), [`intent-router.agent.ts`](../../apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts), [`prepared-simple-read.logic.ts`](../../apps/ai-gateway/src/modules/line-ai/domain/logic/prepared-simple-read.logic.ts): candidate guard, tool loop และ prepared lane |
| Reply/web | [`response-composer.agent.ts`](../../apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts), [`ExpensesPages.tsx`](../../apps/web/src/features/expenses/ExpensesPages.tsx): wording guard และ web filter/date basis |

## Full end-to-end acceptance ที่ยังเหลือ

- ใช้ fixture ด้านบนทดสอบผ่าน API webhook → intake → Gateway → AgentCore (ทั้ง native/JSON/prepared lane ที่เปิดใช้) → ERP tool → composer → persisted outcome → LINE adapter stub; assert **input ที่ส่งให้ tool, จำนวน call, output, source refs และ delivery** ไม่ assert เพียงข้อความสวย
- ใช้ table cases E01–E17, B01–B10, F01–F04, S01–S04, W01; ทดสอบ E05/E11/E17 ด้วยหนึ่งและสอง tool results, B07 เมื่อเปิด lane, B04/B05 ด้วยข้อมูลสาขาตามเงื่อนไข, S01/S02/S03/S04 ด้วย scope/source/delivery เปลี่ยนระหว่าง turn
- Assert invariant: จำนวนผลที่สำเร็จครอบคลุมทุกช่วงที่ตอบ, status basis ของยอดถูก, explicit branch ID ตรงกับที่ขอและอยู่ในสิทธิ์, ไม่ repeat ตัวเลขโดยไม่มี current read, ไม่ส่งข้อมูลข้าม chat/company, และไม่อ้างว่าเว็บแสดงผลเดียวกันหากลิงก์ไม่พา filter ครบ

## หลักฐาน focused checks หลัง implement

- `pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/application/line-read-evidence.spec.ts src/modules/line-ai/application/use-cases/erp-expense-list-recent.use-case.spec.ts src/modules/line-ai/application/use-cases/drain-line-ledger.use-case.spec.ts` — 84/84 ผ่าน; ครอบคลุม proof binding, permission/entitlement, one/two periods, default current month, truncation, branch รวม Thai name→resolved ID, chat/membership และ replay
- `pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — 346/346 ผ่าน
- `pnpm --filter @watchdog-bms/ai-gateway exec tsx --test src/modules/line-ai/agents/orchestrator.agent.spec.ts src/modules/line-ai/application/use-cases/line-ai-turn.use-case.spec.ts src/modules/line-ai/agents/orchestrator-native-loop.agent.spec.ts src/modules/line-ai/agents/orchestrator-model-loop.agent.spec.ts src/agentcore/runtime.spec.ts` — 177/177 ผ่าน; ครอบคลุม full-loop หลายช่วง, mixed-intent sales+expense, filter/criterion routing, sales-only status wording, misspelled status/month clarification, Thai branch name resolving to an ID, duplicate/unresolved branch copy, no-provider path และ deterministic current-month/detail behavior
- โพรบ `extractValueCandidates` ให้ ก.ค.+ส.ค. เมื่อสะกดถูก, ส.ค. เท่านั้นเมื่อสะกด `กรกฏาคม`, และ `แล้วเดือนก่อนหน้าล่ะ` ให้ ส.ค. เมื่อวันนี้อยู่ใน ก.ย.; โพรบ `resolvePeriodInput` ให้ ก.ย. เมื่อ input ไม่มีวันที่; โพรบ composer พบว่าคำ `ไม่รวมยอดยกเลิกและปฏิเสธ` ยังเข้าสู่ model path แม้มี expense tool result แต่คำ `ไม่รวมยกเลิกและปฏิเสธ` เข้า deterministic path
- `pnpm --filter @watchdog-bms/ai-gateway typecheck` — ผ่าน
- `pnpm --filter @watchdog-bms/api typecheck` — ยังรายงาน 2 diagnostics เดิมใน `counterparty.use-case.ts:257` และ `counterparty.controller.ts:128`; ไม่มี diagnostic ในไฟล์ที่แก้ รายละเอียดเต็มอยู่ใน task memory
- `git diff --check` — ผ่าน

Focused mixed-intent tests also assert actual sales tool calls, absence of expense reads, and that unsupported or misspelled filters never display the unfiltered expense total. These remain component/agent-loop tests; they do not replace the API webhook → hosted AgentCore → ERP → LINE adapter delivery E2E listed above.

Focused checks validate service proof binding and agent-loop tool inputs/output. Full API webhook → hosted runtime → ERP → LINE adapter delivery E2E and real LINE/UAT remain unrun.
