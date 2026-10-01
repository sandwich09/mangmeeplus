# การจำลอง E2E ระบบผู้บริหารมั่งมีจากหน้าจอถึงหลังบ้าน

คำที่แสดงบนหน้าจอล่าสุด: [ใช้คำที่คนทั่วไปเข้าใจ](../specs/mangmee-executive-plain-language-spec-th.md) — เมนู “รายรับ”, แท็บ “ลูกค้าที่สร้างรายรับสูง”; identifiers/สูตรเดิมคงไว้

## ผลตรวจทานอิสระ 2026-10-01 — อ่านส่วนนี้ก่อนใช้ชุดเคส

ส่วนนี้เพิ่มเมื่อ 2026-10-01 หลัง[การตรวจทานอิสระฝั่งหน้าจอ](../research/mangmee-executive-spec-review-ui-2026-10-01-th.md) (RU-26) และปรับอีกครั้งหลังแก้เอกสารฝั่งหน้าจอทั้งชุดกับ[สเปกหลังบ้านฉบับแก้](../specs/mangmee-executive-business-backend-spec-th.md) ซึ่งเป็นสัญญาชุดเดียว (§12.4, §16) และทะเบียนข้อตัดสินใจ (§21.2 รหัส Q) **ไม่ได้แก้แถวของ 188 เคสเดิม** รหัสเดิมคงไว้เพื่อย้อนดูได้ รอบปิด 2026-10-02 เพิ่ม REP-33, REP-34 และ SRC-15 กับแก้ REP-29 และ REP-30 หลังสเปกหลังบ้านรับสี่เรื่องของสเปกหน้าจอ §13.1 ข้อ ก ถึง ง และยืนยันลำดับสถานะใบเสร็จ
เคสเดิมที่อยู่ในตาราง ก และ ข ให้อ่านคู่กับส่วนนี้ ถ้าแถวเดิมไม่ตรงกับส่วนนี้ ให้ยึดส่วนนี้และสเปกที่อ้าง
สเปกที่อ้าง: [หน้าจอ](../specs/mangmee-executive-business-ui-spec-th.md), [โครงหน้าและเปรียบเทียบ](../specs/mangmee-executive-navigation-comparison-spec-th.md), [คำบนหน้าจอ](../specs/mangmee-executive-plain-language-spec-th.md), [กราฟและอันดับ](../specs/mangmee-executive-usage-pareto-spec-th.md), [ส่งออก Excel](../specs/mangmee-executive-excel-export-spec-th.md), [ข้อบกพร่องของต้นแบบ](../research/mangmee-executive-prototype-defects-2026-10-01-th.md), [ผลตรวจทานหลังบ้าน](../research/mangmee-executive-spec-review-backend-2026-10-01-th.md)

### ดัชนีชุดเคสทั้งหมด

“188 เคส” ไม่ใช่เกณฑ์รับงานทั้งหมด หน้าวิเคราะห์สี่หน้า การส่งออก คำบนจอ และมือถือ อยู่ในชุดอื่นตามตารางนี้

| ชุด | รหัส | จำนวน | สถานะ |
|---|---|---|---|
| ฐานเดิม รายหมวด | SEC, REP, PAY, USE, SRC, USR, DR, OPS, FE | 176 | จำลองบนเอกสาร; DR-01–32, OPS-08–16, PAY-20 พักไว้ |
| ฐานเดิม เคสผสม | PX-01–12 | 12 | จำลองบนเอกสาร; PX-07–11 พักไว้ |
| ซ่อนคำขอลบ | HIDE-01–04 และ HIDE-05 (ใหม่) | 5 | HIDE-01–04 ผ่านในต้นแบบ; HIDE-05 เป็นเคสของแอปจริง ยังไม่มี |
| โครงหน้าและเปรียบเทียบ | UX-01–12 | 12 | ตรวจในต้นแบบรุ่นก่อนแก้; UX-01 และ UX-11 ต้องแก้ตามตาราง ก |
| ส่งออก Excel | EXL-01–20 | 20 | EXL-01–09 ตรวจเฉพาะแผงในต้นแบบ; EXL-10–20 ต้องตรวจกับไฟล์จริง ยังไม่มี (หัวข้อท้ายเอกสารเขียน “EXL-01–14” ซึ่งเก่าแล้ว) |
| เคสที่เพิ่มในส่วนนี้ | FE-17–25, REP-23–34, SEC-19–21, SRC-15, USR-19–22 | 29 | ใหม่ ยังไม่ได้รันที่ใด |

เกณฑ์ของเอกสารกราฟและอันดับ §8 ซึ่งเดิมไม่มีรหัส ได้รหัส REP-29, REP-30, REP-34 และ FE-21 ในส่วนนี้ การตรวจคำบนหน้าจอได้รหัส FE-19

### ความต้องการใหม่ R17–R21 กับเคส

สเปกหลังบ้าน §10 เพิ่มความต้องการ R17–R21 หลังการตรวจทาน ตาราง §6 ของเอกสารนี้ยังมีเฉพาะ R01–R16 ให้อ่านคู่กับตารางนี้

| ความต้องการ | เคสฝั่งหน้าจอ | หมายเหตุ |
|---|---|---|
| R17 บทบาทและสิทธิ์ของผู้บริหารเป็นของแพลตฟอร์มเท่านั้น | SEC-06, SEC-19, SEC-20 | การตรวจว่าร้านลูกค้าไม่เห็นและมอบบทบาทนี้ไม่ได้ เป็นเคสฝั่งหลังบ้าน |
| R18 บันทึกการอ่านและการส่งออกที่ร้านลูกค้ามองไม่เห็น | — | เคสฝั่งหลังบ้านทั้งหมด (สเปกหลังบ้าน §20.3) หน้าจอไม่มีส่วนแสดงบันทึกนี้ |
| R19 ส่งออก Excel ตามสิทธิ์รายคน โดยตัวเลขตรงกับหน้าจอ | USR-19, SEC-21, REP-28, EXL-17, EXL-19 | — |
| R20 ข้อมูลติดต่อเจ้าของร้านเห็นเฉพาะผู้ได้รับสิทธิ์ ทั้งบนจอและในไฟล์ | SEC-21, USR-19, EXL-20 | — |
| R21 ไม่มีสวิตช์เปิดปิดฟีเจอร์ด้วยค่า environment | HIDE-05 | — |

### ตาราง ก — เคสเดิมที่ไม่ตรงกับสเปกแล้ว

| เคส | สิ่งที่เคสเดิมเขียน | สเปกหลังแก้ | ให้ใช้แทน |
|---|---|---|---|
| FE-12 | “table contained scroll” และเรียงขนาดจอจากใหญ่ไปเล็ก | ตารางที่มีข้อความอิสระห้ามอยู่ในตัวเลื่อนที่กว้างตามเนื้อหา ต่ำกว่า 768 px เป็นรายการแบบการ์ด และตรวจที่ 390×844 ก่อน (สเปกหน้าจอ §11.1–§11.2) | FE-17, FE-18 |
| UX-01 | “desktopmain785px” | ไม่เกิน 1,050 px ที่จอ 1440 (ตัวตรวจวัดได้ 790 px) และที่ 390×844 ต้องเห็นการ์ดครบ 4 ใบในจอแรก (เอกสารโครงหน้า §7; สเปกหน้าจอ §11.1) | FE-17 |
| UX-11 | “responsive menu/dropdown … 1440–320px” | เมนูมือถือของแอปใช้ปุ่ม “เมนู” เดิมของ `SystemHeader` ไม่ใช่ dropdown ของต้นแบบ และเริ่มตรวจที่ 390 px (สเปกหน้าจอ §3.1) | FE-17, SEC-19 |
| REP-17, REP-18, SEC-17 | แบ่งหน้าด้วย cursor (“cursor ปลอม”, “cursor จาก filter/snapshot/user อื่น”) | แบ่งหน้าด้วยเลขหน้า หน้าละ 20 สูงสุด 100; เลขหน้าที่เกินให้แสดงหน้าสุดท้าย; ค่าใน URL ที่ไม่รู้จักใช้ค่าเริ่มต้นโดยไม่ขึ้นข้อผิดพลาด (สเปกหน้าจอ §3.2; สเปกหลังบ้าน §12.4) ไม่มี cursor ให้ปลอม | REP-25; ส่วนของ REP-18 ที่เรื่องชุดข้อมูลเปลี่ยนใช้ FE-23 |
| REP-21, REP-19 | “month/filter/sort/cursor context restore; expired snapshot prompt refresh”; “snapshot ชุดเดียว” | สถานะทั้งหมดอยู่ใน URL ตามสเปกหน้าจอ §3.2; ไม่มี snapshot ที่หมดอายุ: เมื่อชุดข้อมูลเปลี่ยน หลังบ้านตอบ `buildChanged` แล้วหน้าจอโหลดใหม่หนึ่งครั้งโดยคงสถานะและบอกผู้ใช้ (§4.1) | REP-25, FE-23 |
| REP-13 | ค้นด้วย “รหัส” | ค้นด้วยชื่อบริษัท ชื่อจดทะเบียน หรือจังหวัด ไม่ค้นด้วยรหัสภายใน (สเปกหน้าจอ §4 — ข้อเสนอ Q29) | REP-31 |
| REP-15 | ชื่อซ้ำ “ใช้ id แยก row/detail” | รหัสใช้ภายในเท่านั้น บนจอแยกชื่อซ้ำด้วยชื่อจดทะเบียน จังหวัด และวันที่สมัคร (สเปกหน้าจอ §6 — ข้อเสนอ Q29) | REP-31 |
| REP-16 | “stabletiecompanyId” | ค่าเท่ากันเรียงตามวันที่สมัครก่อน แล้วจึงรหัสภายใน และได้เลขอันดับเดียวกัน (เอกสารกราฟและอันดับ §4) | REP-29 |
| REP-20, UX-03, UX-08 | กดเจาะแล้ว “reset irrelevant” / กลับแล้วคง sort กับ page | เพิ่มเกณฑ์: การกดเจาะไม่เขียนทับตัวกรองของหน้าต้นทาง และหลังกลับ จำนวนแถวกับค่าการ์ดของหน้าต้นทางเท่าเดิม (สเปกหน้าจอ §3.3) | REP-23, REP-24 |
| REP-01, J01 | ฐาน 12 บริษัท (12 / อย่างน้อย 6 / 9 / 10,956 บาท) | ใช้เป็นโจทย์ตรวจสูตรได้ แต่ข้อมูลตัวอย่างปัจจุบันของต้นแบบคือ 72 บริษัท (72 / อย่างน้อย 38 / 59 / 245,806.00 บาท) | REP-28 |
| SRC-01, SRC-06, SRC-07 | แสดง “sellerid/code”; “UNKNOWN ไม่ NONE”; “unresolvedlabel” | เซลล์แสดงเป็น “ชื่อ · รหัสเซลล์” ไม่แสดงรหัสภายใน; คำบนจอคือ “ไม่ระบุ”, “ไม่มีเซลล์ผู้แนะนำ”, “เซลล์ที่ไม่พบข้อมูลแล้ว” (เอกสารคำบนหน้าจอ) | FE-19 |
| FE-05, EXL-09 | “snapshot changed / expired” และ 409 จาก version | การอ่านไม่หมดอายุ: หน้าจอโหลดใหม่หนึ่งครั้งเมื่อ `buildChanged`; 409 `EXECUTIVE_SNAPSHOT_EXPIRED` เหลือเฉพาะการส่งออก; ไม่มี 409 จาก version ของคำสั่งบัญชีแล้ว (สเปกหน้าจอ §4.1; สเปกหลังบ้าน §12.3, §16.3) | FE-23 |
| J06, USR-02, USR-05, USR-06, USR-13, USR-18 | สร้างบัญชีด้วยชื่อกับอีเมล ส่งคำเชิญ ผูกกับผู้ใช้เดิม และ “ไม่มี tempPassword field” | สัญญาหลังบ้านฉบับแก้ (ข้อเสนอ Q11, Q12): สร้างแบบเดียวกับบัญชีเซลล์ด้วยชื่อผู้ใช้ รหัสผ่านชั่วคราวคืนครั้งเดียวจาก API08 และ API14 ไม่มีอีเมลเชิญ และเป็นบัญชีใหม่แยกเสมอ USR-06 กับ USR-13 จึงไม่อยู่ในรุ่นแรก USR-05 เปลี่ยนเป็นชื่อผู้ใช้ซ้ำ (`ACCOUNT_ALREADY_EXISTS`) และ USR-18 เปลี่ยนเป็น “รหัสผ่านชั่วคราวไม่อยู่ในคำตอบของรายการหรือรายละเอียด” | USR-21, USR-22 |
| USR-16, PX-06, SEC-09 | “last manager”, ผู้จัดการสองคน, ผู้จัดการที่ไม่มีสิทธิ์ดูรายงาน | สัญญาหลังบ้านฉบับแก้ (ข้อเสนอ Q10): ไม่มีบทบาทผู้จัดการแยก ผู้ดูแลระบบคนเดียวเป็นผู้สร้างและระงับ และดูรายงานได้ คำสั่งกับบัญชีผู้ดูแลระบบถูกปฏิเสธด้วย `ACCOUNT_PROTECTED` ซึ่งรวมการระงับตัวเอง ไม่มีกติกาผู้จัดการคนสุดท้าย | USR-20, SEC-20 |
| USR-09, USR-10, USR-14, USR-15, PX-05, FE-15 | `commandId`, `expectedVersion`, 409 เมื่อ version เก่า | คำสั่งบัญชีไม่มี `commandId` และ `expectedVersion` แล้ว: ระบุสถานะปลายทาง สั่งซ้ำได้ผลเดิม กันชื่อผู้ใช้ซ้ำด้วยความไม่ซ้ำของชื่อผู้ใช้ (สเปกหลังบ้าน §16.3) | USR-20, USR-21 |
| USR-17 | ระงับผู้บริหารที่มีบทบาทในร้านด้วย | ระงับ = ปิดสมาชิกภาพของบริษัทแพลตฟอร์มและยกเลิกการเข้าระบบที่ค้างอยู่ในคำสั่งเดียว และบัญชีผู้บริหารไม่มีบทบาทในร้าน (สเปกหลังบ้าน §17.2–§17.3) | USR-20 |
| SEC-16 | ผลช่วงปิดระบบ “ตาม Q01” | ข้อเสนอ Q15: ช่วงปิดระบบผู้บริหารเข้าไม่ได้ ใช้หน้าปิดปรับปรุงเดิม | — |
| SRC-13, REP-05 | รูปแบบกิจการ (`entity`) และ “service” | รุ่นแรกไม่มีรูปแบบกิจการ (ข้อเสนอ Q27) ให้ตัดส่วน entity ของ SRC-13; สถานะบริการเปลี่ยนชื่อเป็นสถานะแพ็กเกจ (`planState` ห้าค่า) | FE-19 |
| PAY-16 | ภาษี “ตาม Q04” | ข้อเสนอ Q23: ยอดรับเป็นยอดรวมภาษีมูลค่าเพิ่ม และแสดงภาษีเป็นบรรทัดแยก | REP-28 |
| HIDE-03, HIDE-04, UX-10 | saved state และ saved route ของต้นแบบ | เป็นของต้นแบบเท่านั้น แอปจริงไม่เก็บสถานะรายงานใน localStorage และไม่สร้างหน้าคำขอ (สเปกหน้าจอ §3.2; แผนหน้าจอ §2 ข้อ 6) | HIDE-05 |
| EXL-02, EXL-08, EXL-15 (d) และ (k) | “ไม่ใช่12”; “sheet preview selector”; “snapshot ใหม่เห็นใหม่” | แก้ในเอกสารส่งออก Excel §7 และ §9.2 แล้ว: ไม่มีตัวอย่างไฟล์บนแผง และข้อมูลติดต่ออ่าน ณ เวลาที่ตอบ | EXL-08, EXL-15, EXL-20 ฉบับแก้ |
| §1 และ §6 ของเอกสารนี้ | “API01–API12”; แถว “EX-03”; แถว EX-04 อ้าง R12; แถว EX-05/06 ไม่มีเครื่องหมายพัก; ชุดข้อมูล F-HOLD, F-DELETE ไม่มีเครื่องหมายพัก | มี API13 (ส่งออก); EX-03 แตกเป็น EX-03A–D; R12 (คำขอลบ) ไม่อยู่ใน EX-04; EX-05/06, F-HOLD, F-DELETE พักไว้ | อ่านตามนี้จนกว่าจะแก้ตาราง |

คำในแถวของเคสเดิม เช่น `NOT_STARTED`, `INACTIVE`, “เครดิตยอดเปิด” เป็นชื่อภายในหรือคำรุ่นเก่า ใช้ระบุเงื่อนไขได้ แต่ข้อความที่ต้องเห็นบนจอยึดเอกสารคำบนหน้าจอเสมอ

### ตาราง ข — เคสที่ยืนยันสิ่งที่สเปกเดิมไม่ได้เขียน

| เคส | สิ่งที่เคสยืนยัน | สถานะหลังแก้สเปก |
|---|---|---|
| REP-21, FE-16 | กลับมาจาก refresh, bookmark, deep link แล้วได้บริบทเดิม | **มีกติกาแล้ว** ในสเปกหน้าจอ §3.2–§3.3 ตรวจตาม REP-25 |
| FE-06 | 429 แสดงการรอ | **มีกติกาแล้ว** ในสเปกหน้าจอ §11: “เรียกดูถี่เกินไป กรุณารอ N วินาทีแล้วลองใหม่” |
| USR-12 | “confirmation ตาม UX” เมื่อออกจากฟอร์มที่กรอกค้าง | **ตัดสินแล้วว่าไม่มี**: ฟอร์มเพิ่มผู้บริหารสั้น และแอปไม่มีแบบแผนถามยืนยันเมื่อออกจากฟอร์ม กดยกเลิกหรือ Back แล้วไม่มีคำสั่งถูกส่ง (สเปกหน้าจอ §9.2) ให้ตัดคำว่า confirmation ออกจากผลที่คาด |
| SEC-05 | “403 หรือ 404” (สองผลลัพธ์) | **ตัดสินแล้ว** ในสเปกหลังบ้าน §16.3: ไม่มีสิทธิ์หรือบริบทไม่ใช่บริษัทแพลตฟอร์มได้ 403 เสมอ ส่วน 404 ใช้กับบริษัทที่ไม่อยู่ในฐานของรายงาน ฝั่งหน้าจอแสดง `SystemAccessDenied` ให้เจ้าของร้านที่เปิดหน้าผู้บริหาร |
| UX-01 | ความสูงหน้า 785 px | ตัวตรวจรอบตรวจทานวัดได้ 790 px เกณฑ์ที่ตัวตรวจยืนยันจริงคือไม่เกิน 1,050 px (ตาราง ก) |
| EXL-08 | ตัวเลือกดูตัวอย่างชีต | ตัดออกจากแอปจริงแล้ว (เอกสารส่งออก Excel §2 ข้อ 6) |
| REP-02 | คำตอบมี “excluded2” (จำนวนบริษัททดสอบและบริษัทของมั่งมีที่ตัดออก) | **ตัดสินแล้ว** ในสเปกหลังบ้าน §9.6: จำนวนนี้อยู่ในคำตอบเพื่อการทดสอบและการกระทบยอดเท่านั้น หน้าผู้บริหารไม่มีบรรทัดจำนวนนี้ ผู้ดูแลระบบดูได้จากตัวกรองของ SRC-15 |

### ตาราง ค — เคสที่ต้องเพิ่ม

รหัสต่อจากชุดเดิม ทุกเคสเป็นของแอปจริง ยังไม่ได้รันที่ใด ข้อมูลตัวอย่างที่อ้างคือชุด 72 บริษัทของต้นแบบ

| ID | เงื่อนไข | ผลที่ต้องได้ | อ้างอิง |
|---|---|---|---|
| FE-17 | มือถือ 390×844 ทุกหน้า: EX-01, EX-03A–D, EX-02, EX-04, EX-07/08 และแผงส่งออก | การ์ด 4 ใบของภาพรวมอยู่ในจอแรก; ไม่มีองค์ประกอบใดกว้างเกินกรอบของตัวเอง รวมกรอบตาราง; ทุกสิ่งที่แตะได้สูงและกว้างอย่างน้อย 44 px; คำอธิบายตัวเลขไม่เล็กกว่า 14 px; ปุ่มหลักของแผงอยู่ในจอแรก | สเปกหน้าจอ §11.1; RU-01, RU-14 |
| FE-18 | ตารางทุกตารางที่ 390 px และ 768 px | ต่ำกว่า 768 px เป็นรายการแบบการ์ด อ่านครบทุกค่าตามลำดับของสเปกโดยไม่เลื่อนแนวนอน; ตั้งแต่ 768 px เป็นตารางความกว้างคงที่; เปรียบเทียบเป็นบล็อกทีละรายการ; ไม่มีตารางข้อความอิสระใน `mangmee-table-scroll` | สเปกหน้าจอ §11.2; RU-01 |
| FE-19 | ข้อความทุกหน้า ทุกสถานะ และข้อความสำหรับโปรแกรมอ่านหน้าจอ | ไม่มี ฿, THB, รหัสภายใน, คำระบบ, เดือนแบบ 2026-09, วันที่แบบ ISO หรือคำในคอลัมน์ “คำที่เลิกใช้” (รวม “สถานะบริการ”, “เข้าสู่ระบบล่าสุด”, “รูปแบบกิจการ”); เงินเป็น “1,234.50 บาท”; คำตรงกับเอกสารคำบนหน้าจอและตรงกับไฟล์ Excel | สเปกหน้าจอ §4.3; เอกสารคำบนหน้าจอ; RU-02, RU-03, RU-27 |
| FE-20 | ชื่อ 120 ตัวอักษรไม่มีช่องว่างทั้งไทยและอังกฤษ; “อื่น ๆ” 200 ตัวอักษร; ยอด 9 หลัก; ยอดรับสุทธิติดลบ; ทุกบริษัทเป็น 0; บริษัทเดียว; ไม่มีบริษัท | ข้อความตัดบรรทัด ไม่ล้น และไม่ถูกตัดทิ้ง; ยอดติดลบแสดงทุกที่พร้อมคำกำกับ; กราฟแนวโน้มมีเส้นฐาน; ไม่มีศูนย์ปลอม | สเปกหน้าจอ §11.3; RU-23 |
| FE-21 | กราฟทุกตัวเมื่อแปลงเป็นขาวดำ และข้อมูลที่มีบริษัท “ยังประเมินไม่ได้” กับ “ไม่มีในแพ็กเกจ” อย่างน้อยอย่างละหนึ่งราย | แยกกลุ่มได้โดยไม่พึ่งสี; ส่วนที่ติดกันต่างกันอย่างน้อย 3:1; ไม่มีสีน้ำเงินในส่วนที่กดได้; ส่วนเทามีลายขีดถูกวาดจริง | สเปกหน้าจอ §10.5; เอกสารกราฟและอันดับ §4; RU-16, RU-25 |
| FE-22 | เดือนที่ยังไม่จบ; แหล่งเงินช้ากว่าแหล่งการใช้งานเกิน 24 ชั่วโมง | แถวเวลาแสดงเวลาที่เก่าที่สุดของแหล่งที่หน้านั้นใช้; ป้าย “เดือนนี้ยังไม่จบ”; ป้าย “ข้อมูลเงินถึง …” ที่การ์ดของแหล่งนั้น; ค่าปัจจุบันมีคำว่า “ปัจจุบัน” | สเปกหน้าจอ §4.1; RU-12 |
| FE-23 | เปิดหน้าค้างจนชุดข้อมูลของรายงานเปลี่ยน แล้วกดหน้าถัดไป กดเจาะ และส่งออก | หลังบ้านตอบ `buildChanged`: หน้าจอโหลดใหม่หนึ่งครั้งโดยคงเดือน ตัวกรอง แท็บ และเลขหน้า พร้อม “อัปเดตข้อมูลแล้ว ตัวเลขอาจเปลี่ยน”; การ์ดกับตารางไม่มาจากคนละชุด; การส่งออกได้ 409 และข้อความ “ข้อมูลรายงานเก่าแล้ว กรุณาโหลดใหม่ก่อนสร้างไฟล์” | สเปกหน้าจอ §4.1; เอกสารส่งออก Excel §5; สเปกหลังบ้าน §12.3; RU-12 |
| FE-24 | แท็บทุกชุด กราฟที่กดได้ ตาราง และการเปลี่ยนตัวกรอง ด้วยโปรแกรมอ่านหน้าจอและแป้นพิมพ์ | แท็บบอกสถานะที่เลือกแบบไม่พึ่งสี; พื้นที่ประกาศจำกัดเฉพาะบรรทัดสรุปผล; ตารางมี caption และ scope; แถบกราฟมีชื่อที่ถูกอ่าน | แผนหน้าจอ §3; RU-30 |
| FE-25 | รอบสร้างข้อมูลไม่สำเร็จสองรอบติดกัน; เดือนที่จบแล้วถูกคำนวณใหม่แล้วตัวเลขเปลี่ยน | แถบ “ข้อมูลยังไม่ได้อัปเดต ตัวเลขเป็นของ <วันเวลา>” และยังแสดงตัวเลขของรอบก่อน; ป้าย “ปรับปรุงเมื่อ <วันเวลา>” ข้างชื่อเดือนที่ถูกปรับ | สเปกหน้าจอ §4.1, §11; สเปกหลังบ้าน §12.3 (ขึ้นกับ Q30, Q31) |
| REP-23 | กดเจาะจากกราฟ ตารางกลุ่ม และการ์ด อย่างละหนึ่ง แล้วกลับ ทั้งปุ่มกลับในหน้าและปุ่ม Back ของเบราว์เซอร์ | จำนวนแถวและค่าการ์ดของหน้าต้นทางเท่ากับก่อนกดโดยไม่กด “ล้างตัวกรอง” (ข้อมูลตัวอย่าง: ตารางช่องทาง 5 แถวและการ์ด 72 ต้องเท่าเดิมหลังกลับจาก Facebook) | สเปกหน้าจอ §3.3; RU-04 |
| REP-24 | ตั้งตัวกรองร่วม เช่น ช่องทาง Facebook → เปรียบเทียบ → ดูรายชื่อฝั่ง A → กลับ → ไปหน้าอื่นทางเมนู | ตัวกรองร่วมยังเป็น Facebook; รายชื่อฝั่ง A ใช้เฉพาะเดือนกับเงื่อนไขของฝั่งนั้น และบอกว่าไม่ใช้ตัวกรองของรายงาน | สเปกหน้าจอ §3.3; เอกสารโครงหน้า §4; RU-04 |
| REP-25 | โหลดใหม่ และเปิดลิงก์ตรง ของทุกหน้า ทุกแท็บ รายชื่อที่มีตัวกรอง การเรียง และเลขหน้า รายละเอียดบริษัททุกแท็บ และแผงส่งออก | ได้หน้าเดิมทุกค่า; ค่าที่ไม่รู้จักใน URL ใช้ค่าเริ่มต้นโดยไม่ขึ้นข้อผิดพลาด; เลขหน้าเกินได้หน้าสุดท้าย; คำค้นไม่อยู่ใน URL แต่ Back คืนคำค้นเดิม | สเปกหน้าจอ §3.2; RU-05 |
| REP-26 | วันที่ 1 ของเดือน เวลา 00:05 และ 08:00 ตามเวลาไทย | เดือนเริ่มต้นตามข้อเสนอ Q32; ป้าย “เดือนนี้ยังไม่จบ”; ปุ่ม “ดูเดือนที่แล้ว”; ไม่มีศูนย์ปลอมเมื่อเดือนใหม่ยังไม่มีข้อมูล | สเปกหน้าจอ §4.1; RU-12 (ขึ้นกับ Q32) |
| REP-27 | บริษัท 1,000 ราย 12 เดือน ผู้อ่านพร้อมกัน 10 คน (เกณฑ์รับงานรอบแรกของสเปกหลังบ้าน §20.2) | ภาพรวมตอบภายใน 2 วินาทีและรายชื่อภายใน 1 วินาที (ค่า p95); รายชื่อแบ่งหน้าและเรียงได้; ไม่มี dropdown ที่บรรจุทุกบริษัท การเทียบบริษัทเลือกจากรายชื่อ; ตัวกรองเซลล์ค้นได้; ส่งออกได้ตาม EXL-19 | สเปกหน้าจอ §6; เอกสารโครงหน้า §4; RU-22, RU-17 |
| REP-28 | ตัวเลขรหัส N เดียวกันบนทุกหน้าและในไฟล์ ด้วยเดือน ตัวกรอง และเวลาของข้อมูลเดียวกัน | เท่ากันทุกที่; จุดที่ต่างกันโดยชอบมีบรรทัดอธิบาย (ข้อมูลตัวอย่าง: ชำระในเดือน 59 / เคยชำระเงิน 61 / จ่ายมากกว่ายอดคืนในเดือน 58); “อย่างน้อย 38” เหมือนกันทั้งการ์ด เปรียบเทียบ และไฟล์; การ์ดทุกใบเปิดรายชื่อที่มีจำนวนเท่าการ์ด | สเปกหน้าจอ §4.2; RU-11; สเปกหลังบ้าน §12.4, §13.1 |
| REP-29 | ขอบกลุ่ม 20% และขอบกลุ่ม 80% ที่ตัดกลางบริษัทที่จ่ายเท่ากัน; ขอบกลุ่มที่ไม่ตัดกลางยอดที่เท่ากัน; ประชากร 1, 4 และ 9 บริษัท; อันดับที่ค่าเท่ากัน | ประโยค “มีอีก N บริษัทที่จ่ายเท่ากับลำดับสุดท้ายของกลุ่ม (X บาท) แต่อยู่นอกกลุ่ม” ใต้กลุ่ม 20% และใต้กลุ่ม 80% ด้วยเลขที่หลังบ้านคืน (ข้อมูลตัวอย่าง: 7 ที่กลุ่ม 20% และ 9 ที่กลุ่ม 80% ยอด 2,990.00 บาท) กดแล้วเปิดรายชื่อบริษัทที่จ่ายเท่ายอดนั้นทั้งหมด (14 บริษัททั้งสองประโยค); จำนวนเป็น 0 ไม่มีประโยค; รายชื่อที่เรียงตามยอดมีบรรทัด “ถ้ายอดเท่ากัน บริษัทที่สมัครก่อนอยู่ก่อน”; ประชากรน้อยกว่า 10 ไม่แบ่งกลุ่ม ไม่มีประโยคยอดเท่ากัน และแสดง “บริษัทน้อยเกินไปสำหรับการแบ่งกลุ่ม”; ค่าเท่ากันได้เลขอันดับเดียวกัน | เอกสารกราฟและอันดับ §4–§5; สเปกหลังบ้าน §13.6, §12.4; RU-15 (ขึ้นกับ Q24, Q25) |
| REP-30 | สถานะใบเสร็จสี่แบบ ตัดสินตามลำดับ: มีหลักฐาน (รวมร้านที่วันนี้ไม่มีสิทธิ์แล้ว) / ไม่มีหลักฐานและไม่มีสิทธิ์ใช้ฟีเจอร์ ทั้งที่สร้างก่อนและหลัง 2026-08-27 / ไม่มีหลักฐาน มีสิทธิ์ และสร้างก่อน 2026-08-27 / ไม่มีหลักฐาน มีสิทธิ์ และสร้างตั้งแต่วันนั้น; และบริษัทที่ลบใบเสร็จภายหลัง | เคยเพิ่มใบเสร็จ / ไม่มีในแพ็กเกจ / ยังประเมินไม่ได้ / ยังไม่พบการเพิ่มใบเสร็จ ตามลำดับ รวมกันเท่ากับจำนวนบริษัท; บริษัทที่ลบใบเสร็จยังเป็น “เคยเพิ่มใบเสร็จ”; จำนวนรายเดือนของเดือนเก่าไม่ลด | เอกสารกราฟและอันดับ §3; สเปกหลังบ้าน §13.4–§13.5 (ขึ้นกับ Q20) |
| REP-31 | ชื่อบริษัทซ้ำสองแห่ง; คำค้นที่เป็นรหัสภายใน | รายชื่อ ตัวเลือกบริษัทของหน้าเปรียบเทียบ และไฟล์ Excel แยกสองแห่งได้ด้วยชื่อจดทะเบียน จังหวัด และวันที่สมัคร; ไม่มีรหัสภายในบนจอหรือในไฟล์; ค้นด้วยรหัสภายในไม่พบ | สเปกหน้าจอ §4, §6; RU-03 (ขึ้นกับ Q29) |
| REP-32 | มีบริษัทที่ผู้ดูแลยังไม่ได้จัดประเภท; ผู้ดูแลจัดประเภทบริษัทหนึ่งเป็นบริษัททดสอบ | การ์ดบริษัทลูกค้าแสดง “อย่างน้อย N” กับ “ยังไม่ได้จัดประเภท M บริษัท”; หลังรอบสร้างข้อมูลถัดไป บริษัททดสอบไม่อยู่ในรายงานและเปิดรายละเอียดได้ “ไม่พบบริษัทนี้ในรายงาน” | สเปกหน้าจอ §5, §8, §9.3; สเปกหลังบ้าน §12.2 (ขึ้นกับ Q16) |
| REP-33 | บรรทัดสรุปเหนือรายชื่อ: เปิดรายชื่อทั้งหมด; เปิดจากแถวกลุ่มของตารางธุรกิจ ช่องทาง หรือเซลล์; เปิดจากกลุ่มลูกค้าที่จ่ายสูง กลุ่ม 80% และประโยคยอดเท่ากัน; เปลี่ยนหน้า เปลี่ยนการเรียง และค้นหา; เดือนที่ยอดเงินยังอ่านไม่ครบ | “พบ N บริษัท · ยอดรับสุทธิในเดือน X บาท · เรียงตาม …” โดย N กับ X เป็นค่าที่หลังบ้านคืนสำหรับผลกรองทั้งชุด ไม่ใช่ผลรวมของแถวในหน้าที่เห็น; N กับ X ไม่เปลี่ยนเมื่อเปลี่ยนหน้าหรือเปลี่ยนการเรียง และเปลี่ยนตามคำค้น; เปิดจากการ์ดหรือแถวที่มียอดรับสุทธิ N เท่ากับจำนวนบริษัทและ X เท่ากับยอดของการ์ดหรือแถวนั้น (ข้อมูลตัวอย่าง: ทั้งหมด 72 บริษัท 245,806.00 บาท; กลุ่มที่จ่ายสูงสุด 15 บริษัท 204,930.00 บาท; กลุ่ม 80% 13 บริษัท 198,950.00 บาท; รายชื่อจากประโยคยอดเท่ากัน 14 บริษัท 41,860.00 บาท); ยอดเงินยังอ่านไม่ครบมีคำว่า “ยอดเฉพาะรายการที่ยืนยันแล้ว”; เงินที่ยังไม่ผูกบริษัทไม่อยู่ในยอดนี้ | สเปกหน้าจอ §6, §13.1 ข้อ ก; สเปกหลังบ้าน §16.2; RU-11 |
| REP-34 | อันดับการใช้ที่มีบริษัทค่าเท่ากันคร่อมรายการที่สิบ เช่น ลำดับที่ 9 ถึง 13 มีใบเสร็จในเดือนเท่ากัน; ชุดที่ไม่มีค่าเท่ากันคร่อมรายการที่สิบ; เปลี่ยนตัวชี้วัดเป็นวันใช้งานและใช้ผู้ช่วย; บริษัทที่มีข้อมูลน้อยกว่า 10 ราย | กราฟแสดง 10 รายการ รายการที่ 9 และ 10 ได้เลขอันดับ 9 ทั้งคู่; ใต้กราฟแสดง “มีอีก 3 บริษัทที่ค่าเท่ากับอันดับสุดท้ายที่แสดง (V ใบ)” ด้วยจำนวนและค่าที่หลังบ้านคืน หน้าเว็บไม่นับเอง; “ดูอันดับทั้งหมด” เปิดรายชื่อที่ห้าบริษัทนั้นได้เลขอันดับ 9 เท่ากัน และบริษัทถัดไปได้เลข 14; ไม่มีค่าเท่ากันคร่อมรายการที่สิบ หรือมีข้อมูลน้อยกว่า 10 ราย ไม่มีประโยค; หน่วยของค่าตรงกับตัวชี้วัด (ใบ / วัน / ครั้ง) | เอกสารกราฟและอันดับ §4; เอกสารคำบนหน้าจอ (อันดับและสัดส่วน); สเปกหน้าจอ §13.1 ข้อ ค; สเปกหลังบ้าน §13.6, §16.1; RU-15 (ขึ้นกับ Q25) |
| SEC-19 | บัญชีที่มีเฉพาะสิทธิ์ผู้บริหาร | เข้าระบบแล้วถึง `/system/executive`; เห็นเฉพาะกลุ่มเมนู “รายงานผู้บริหาร”; ไม่เห็น “คำขอเกี่ยวกับข้อมูล” และเมนูของผู้ดูแลระบบ; เปิด URL ของหน้าเหล่านั้นตรง ๆ ได้ `SystemAccessDenied`; โลโก้พาไป `/system/executive` | สเปกหน้าจอ §3.1; RU-07; สเปกหลังบ้าน §17.2 |
| SEC-20 | ผู้ดูแลระบบ | เห็นกลุ่ม “รายงานผู้บริหาร” และรายการ “บัญชีผู้บริหาร” ในกลุ่ม “ตั้งค่าระบบ” ดูรายงานและส่งออกได้; บัญชีผู้ดูแลระบบไม่อยู่ในรายการบัญชีผู้บริหาร | สเปกหน้าจอ §3.1, §9.2; RU-07 (ขึ้นกับ Q10) |
| SEC-21 | ผู้บริหารที่ไม่มีสิทธิ์ “ดูข้อมูลติดต่อเจ้าของร้าน” เปิดรายละเอียดบริษัท; ผู้บริหารที่ไม่มีสิทธิ์ “ส่งออก Excel” | ไม่เห็นอีเมลและเบอร์โทร เห็น “ไม่มีสิทธิ์ดูข้อมูลติดต่อ” และคำตอบของ API ไม่มีค่าสองช่องนี้; ผู้ไม่มีสิทธิ์ส่งออกไม่เห็นปุ่ม “ส่งออก Excel” และเรียก API13 ได้ 403 | สเปกหน้าจอ §8.1; เอกสารส่งออก Excel §6; RU-19, RU-20 (ขึ้นกับ Q13, Q14) |
| SRC-15 | ผู้ดูแลระบบเปิดรายชื่อบริษัทของผู้ดูแล (`/system/partners`) แล้วเลือกตัวกรอง “ยังไม่ได้จัดประเภท”; เปิดรายละเอียดบริษัทหนึ่งแห่ง เลือกประเภทบริษัทและกลุ่มธุรกิจสำหรับรายงาน แล้วบันทึก; กรองด้วย “บริษัททดสอบ” “บริษัทของมั่งมี” และกลุ่มธุรกิจ “ไม่ระบุ”; โหลดหน้าใหม่ | รายชื่อแสดงเฉพาะบริษัทที่ยังไม่ได้เลือกประเภท และ “พบ N บริษัท” เท่ากับ “ยังไม่ได้จัดประเภท M บริษัท” ของหน้าผู้บริหาร (เดือนปัจจุบัน ไม่ตั้งตัวกรองร่วม) หลังรอบสร้างชุดข้อมูลถัดไป; หลังบันทึก บริษัทนั้นหายจากผลกรองและ N ลดลงหนึ่ง และรายละเอียดแสดงผู้แก้กับเวลาที่แก้ล่าสุด; ตัวกรองทั้งสองอยู่ใน URL โหลดใหม่ได้ผลเดิม เปลี่ยนตัวกรองแล้วกลับหน้า 1 และ “ล้างตัวกรอง” ล้างทั้งสองตัว; เหลือ 0 แสดงสถานะว่างเดิมของหน้า; “ไม่ระบุ” ได้เฉพาะบริษัทที่ยังไม่มีกลุ่มธุรกิจ; หน้าผู้บริหารไม่มีช่องแก้สองช่องนี้ และบัญชีผู้บริหารเปิดหน้านี้ไม่ได้ (SEC-19) | สเปกหน้าจอ §9.3, §13.1 ข้อ ง; สเปกหลังบ้าน §9.6, §16.1; RU-08 (ขึ้นกับ Q16, Q26) |
| USR-19 | เปิดและปิดสิทธิ์ส่งออก และสิทธิ์ดูข้อมูลติดต่อ เป็นรายคนแยกกัน | ค่าเริ่มต้นปิดทั้งคู่; ทุกครั้งต้องยืนยันและกรอกเหตุผล; เปิดแล้วผู้ใช้นั้นเห็นปุ่มส่งออกหรือข้อมูลติดต่อในคำขอถัดไป; ปิดแล้วหายและหลังบ้านปฏิเสธ; ข้อมูลติดต่อในไฟล์ต้องมีทั้งสองสิทธิ์; การเปลี่ยนสิทธิ์ถูกบันทึก | สเปกหน้าจอ §9.2; RU-20, RU-19 (ขึ้นกับ Q13, Q14) |
| USR-20 | ระงับบัญชี และเปิดใช้อีกครั้ง | มีกล่องยืนยันที่แสดงชื่อบัญชี และช่องเหตุผลที่บังคับกรอก; หลังระงับ ผู้ใช้นั้นถูกปฏิเสธในคำขอถัดไปและเข้าระบบใหม่ด้วยรหัสเดิมก็ยังดูรายงานไม่ได้; คำสั่งกับบัญชีผู้ดูแลระบบได้ข้อความ “บัญชีผู้ดูแลระบบระงับหรือแก้สิทธิ์จากหน้านี้ไม่ได้”; สั่งซ้ำได้ผลเดิม | สเปกหน้าจอ §9.2; สเปกหลังบ้าน §17.3; RU-21 |
| USR-21 | สถานะบัญชีในรายการและรายละเอียด | สี่สถานะตามค่าที่หลังบ้านส่ง: รอเปิดใช้งาน / เปิดใช้งาน / ระงับ / ถอนสิทธิ์แล้ว ไม่เดาจากการมีบัญชี; สร้างบัญชีแล้วขึ้น “รอเปิดใช้งาน” จนเจ้าตัวตั้งรหัสใหม่; ชื่อผู้ใช้ซ้ำขึ้นข้อความที่ช่องชื่อผู้ใช้; ไม่พบบัญชีตามคำค้นแสดงเฉพาะข้อความ ไม่มีตารางเปล่า | สเปกหน้าจอ §9.2; สเปกหลังบ้าน §17.3; RU-21 |
| USR-22 | สร้างบัญชี และออกรหัสผ่านใหม่ | รหัสผ่านชั่วคราวแสดงครั้งเดียวหลังสร้างหรือออกใหม่ ออกจากหน้าแล้วเรียกดูอีกไม่ได้ และไม่อยู่ในคำตอบของรายการหรือรายละเอียด; ออกรหัสใหม่ต้องยืนยันพร้อมเหตุผล แล้วการเข้าระบบที่ค้างอยู่ถูกยกเลิก | สเปกหน้าจอ §9.2; สเปกหลังบ้าน §17.3 (ขึ้นกับ Q11) |
| HIDE-05 | แอปจริง ไม่ใช่ต้นแบบ | ชุดหน้าผู้บริหารไม่มี route หน้าคำขอ ไม่มีโค้ดหน้าคำขอ และไม่มีสวิตช์เปิดปิด; เมนู “คำขอเกี่ยวกับข้อมูล” ของผู้ดูแลระบบเดิมไม่แสดงกับบัญชีผู้บริหาร | สเปกหน้าจอ §9; แผนหน้าจอ §2 ข้อ 6; RU-09; ความต้องการ R21 ของสเปกหลังบ้าน |
| EXL-16–EXL-20 | ข้อความที่ขึ้นต้นด้วยเครื่องหมายสูตร; คำและรูปแบบในไฟล์; ดาวน์โหลดและเปิดบนมือถือ; เพดาน; ช่องติ๊กข้อมูลติดต่อ | ตามเอกสารส่งออก Excel §7 | RU-18, RU-10, RU-17, RU-19 |

## ขอบเขตล่าสุด 2026-10-01

Owner พักและซ่อนการลบข้อมูลทั้งหมด รายการเดิม **188 เคสเป็น baseline การจำลอง** ไม่ใช่ผลรันจริง
คง ID เดิมเพื่อ trace ได้: **47 เคส DEFERRED** ได้แก่ DR-01–32, OPS-08–16, PX-07–11 และ PAY-20
อีก **141 เคสยังอยู่ในงานรายงาน/บัญชี** โดยแยกส่วนคำร้องออกจากเคสผสมตามตารางนี้; J01–J07 active, J08–J12 deferred
API11/API12 และ case summaries ใน API06 ไม่อยู่ใน current integration scope

| เคสผสม | ขอบเขตปัจจุบัน |
|---|---|
| เคส SEC-08 | ตรวจ reader ถูกปฏิเสธ API08/API10; ส่วน API11 พัก |
| OPS-03/04 | transaction rollback/retry เฉพาะบัญชี; ส่วน case พัก |
| OPS-07/17 | read ไม่มี side effects และ log ไม่เปิด PII ยังบังคับ; ไม่ทดสอบ executor |
| เคส OPS-18 | rollback/version ของ report และ account; ส่วน deletion พัก |
| FE-04/05/15 | validation/version/pending/retry ของ report/account; ส่วน case/hold พัก |
| เคส FE-16 | detail/Back/restore ของบริษัทและบัญชี; case route เดิมต้องกลับ overview ตาม HIDE-03/04 |

เกณฑ์ตรวจซ่อนฟีเจอร์เพิ่มเติม (แยกจาก baseline 188):

| ID | Expected |
|---|---|
| HIDE-01 | admin และ reader ไม่เห็นเมนู/ปุ่ม/ข้อความสิทธิ์เกี่ยวกับลบข้อมูล |
| HIDE-02 | ประวัติบริษัทที่เคยมี DR case ไม่แสดง case/reference/reason/link/create action |
| HIDE-03 | รับ saved state event ของ requests/request/new-request แล้วกลับ overview |
| HIDE-04 | เปิดเดโมใหม่พร้อม initial saved route ทั้งสามแบบแล้วกลับ overview |

ผลรันล่าสุด: **HIDE-01–04 PASS** ด้วย `check-demo.cjs`; admin/reader, 3 บริษัทที่มีเคสเดิม, state event และ initial saved route ครบทั้ง 3 เส้นทาง
HIDE เป็นการตรวจเดโม local เท่านั้น ไม่พิสูจน์ server permission หรือเปลี่ยน existing data-rights module
DEFERRED ไม่ใช่ PASS และไม่ถือว่า bug/gap ถูกแก้; เกณฑ์ closure อยู่ใน gap audit

วันที่: 2026-10-01
สถานะ: **SPEC SIMULATION — ไม่มีการยิง executive API จริงหรือทำ mutation กับข้อมูลจริง**
อ้างอิง: [BE spec](../specs/mangmee-executive-business-backend-spec-th.md), [UI spec](../specs/mangmee-executive-business-ui-spec-th.md), [gap/impact audit](../research/mangmee-executive-business-be-gap-impact-2026-10-01-th.md)

เอกสารนี้เดินแต่ละเส้นทางตั้งแต่การกระทำบน FE → request → auth/validation → domain/source → response → FE
ระบุทั้งผลเป้าหมายและผลที่คาดจาก source ปัจจุบัน เพื่อให้เห็นว่าจะหยุดตรงไหนก่อนลงมือเขียนโค้ด
ไม่ใช้คำว่า “E2E ผ่าน” กับ API ที่ยังไม่มี และไม่ถือการเปลี่ยน local state ในเดโมเป็น backend mutation

## 1. วิธีจำลองและการอ่านผล

API01–API12 อ้าง endpoint inventory ใน BE§16; API01–10/API12 เป็นข้อเสนอ ส่วน API11 เป็น data-rights เดิม
ทุก row ด้านล่างคือ **expected scenario ที่ประเมินบนเอกสาร**; column ปัจจุบันมีความหมายดังนี้:

- **N**: endpoint/data/permission ใหม่ยังไม่มี ต้อง implement ก่อนรัน integration
- **E**: พบ guard/logic เดิมรองรับบางส่วนจาก source; ไม่แปลว่า scenario ทั้งเส้นรันจริงผ่านแล้ว
- **D**: ทำได้ใน local demo หรือเป็นข้อจำกัด demo เท่านั้น
- **Qxx**: ผลธุรกิจสุดท้ายรอมติ; มีผล fail-closed/unknown ที่ห้ามเดาไว้ให้
- **R**: จำลองความเสี่ยงจาก dependency/การแข่งขัน; ยังไม่ได้ทำ failure injection จริง

ผลที่รันจริงแยกไว้ท้ายเอกสาร: browser check ของเดโม และ existing unit/domain tests 58 เคส
ชุดนี้ไม่ใช่ข้ออ้างว่าทดสอบทุก permutation ไม่จำกัดแล้ว แต่ครอบคลุม known flows,
ทุก screen/action/API proposal, state transitions, boundary/time, auth, money, data coverage และโมดูลข้างเคียง

## 2. Fixture และ oracle ที่ตรวจยอดได้

### 2.1 เดโมเดิม 12 บริษัท

เดือน `2026-09`, `asOf=2026-09-30T12:00:00+07:00`; เป็นตัวอย่างถึงเวลานี้ ไม่ใช่จบเดือนเต็ม
หน่วยเงินในตารางเป็น **สตางค์**; ทุกบริษัทสมมติเป็น CUSTOMER สำหรับเดโม ไม่ใช่ backfill rule ของจริง

| Company | Discovery | Referrer | Credit seller | Paid ever | Usage | Receipts | Refunds | Net |
|---|---|---|---|---|---|---:|---:|---:|
| MM001 | OTHER | NONE | NONE | true | ACTIVE |149000|0|149000|
| MM002 | SALES | S001 | S001 | true | ACTIVE |149000|0|149000|
| MM003 | WEBSITE | NONE | NONE | true | NOT_STARTED |49900|0|49900|
| MM004 | FACEBOOK | NONE | NONE | false | NOT_PAID; trial มีใช้ |0|0|0|
| MM005 | SALES | S001 | S003 | true | ACTIVE |299000|0|299000|
| MM006 | SALES | S002 | S002 | true | INACTIVE |0|0|0|
| MM007 | OTHER | NONE | NONE | true | INACTIVE |49900|0|49900|
| MM008 | SALES | S003 | S003 | true | NOT_STARTED |49900|0|49900|
| MM009 | WEBSITE | NONE | NONE | true | null; activity unknown |49900|0|49900|
| MM010 | SALES | S002 | S002 | true | ACTIVE |299000|0|299000|
| MM011 | UNKNOWN | UNKNOWN | NONE | true | INACTIVE; archived |0|0|0|
| MM012 | OTHER | NONE | NONE | true | ACTIVE; fully refunded |49900|49900|0|

Oracle:

- population12; paid ever11; confirmed never paid1; receipt companies9
- confirmed active companies6 = paid active5 + active trial1; มี 1 บริษัทข้อมูลกิจกรรมไม่ครบ
  ดังนั้นเป้าหมาย BE คือ value:null,knownValue:6,coverage:partial และ FE แสดง “อย่างน้อย 6”
  ไม่ใช้ paid cohort แทน active KPI และไม่ถือ 6 เป็น exact total ทั้งประชากร
- paid cohorts2 NOT_STARTED +3 INACTIVE +5 ACTIVE +1 unassessable =11
- receipts1,145,500 −refunds49,900 =net1,095,600 สตางค์ =10,956 บาท
- discovery net: SALES796900 +OTHER198900 +WEBSITE99800 +FACEBOOK0 +UNKNOWN0 =1095600
- referrer net: S001448000 +S002299000 +S00349900 +NONE298700 +UNKNOWN0 =1095600
- จำนวนเอกสารที่ยืนยันจาก 11 แถวที่มี usage=2147; AI requests=3466
  มี 1 บริษัท unknown จึงห้ามประกาศตัวเลขนี้เป็น exact total ทั้ง 12 บริษัท
- paidEver หลังคืนเงินและ trial-before-paid ใน fixture เป็นข้อเสนอ Q03 ไม่ใช่มติที่ผู้ใช้ตอบแล้ว
- credited amount ใน fixture ไม่ใช่ oracle ของ salesflags/refundpolicy;ใช้ domainfixtures แยก

### 2.2 Fixtures เพิ่มสำหรับจำลอง BE

| Set | ข้อมูลที่ต้องจัดใน isolated test environment ภายหลัง | Oracle |
|---|---|---|
| F-AUTH | reader A, account manager B, operator C/D, tenant owner T, customrole ชื่อเหมือน platform, revokeduser, multi-membershipuser | role name อย่างเดียวไม่เพิ่ม authority; reader ไม่ mutate |
| F-POP | CUSTOMER12 +TEST1 +INTERNAL1 +UNKNOWN1;owner เดียวมี 2 บริษัท;signup ซ้ำ 2 แถวในบริษัทเดียว | eligible12, excluded2, unclassified1; companycount ไม่คูณ |
| F-MONEY | receipt149000 เวลา 31 ส.ค.23:59 ไทย;refund49900 เวลา 1 ก.ย.00:00; replayevent; secondrefund99900 เดือนต.ค. | ส.ค.+149000;ก.ย.−49900;ต.ค.−99900; lifetime net0 |
| F-USAGE | humancommitsame commandretry3 ครั้ง; deriveddocument2records; failedOCR; modelcalls3 ต่อ turn; trialuse; unknown history | logical business action/เอกสารหนึ่งหน่วยตาม taxonomy;ไม่บวก modelcalls |
| F-SALES | one first activation, renewal, unresolvedflag, clearedflag, referrer≠credited,5001eligibleattributions | salesrules เดิม;completeaggregate หรือ incompleteexplicit |
| F-HOLD | เคสมี hold end=T;nullanchor;retentionexpired;scopechanged;overlap;creator/approver/executor แยก | T−1msdeny;Texact ผ่าน time gate เท่านั้น;missingpolicydeny |
| F-DELETE | companyA/Bshareuser; objectcurrent+versions; externalunknown; queuedwriter; restoredbackup; retained billing fact | scope ไม่ข้าม B;no early purge;no resurrection;no false completion |

## 3. Walkthrough รายเส้นทางจาก FE ไป BE

### J01 เข้ารายงานและกรองถึงบริษัท

1. ผู้บริหารเปิด EX-01 → session helper → auth/me → API01 context
2. BE ตรวจ session, User.status, active platform membership/system-owned role และ executive.read
3. FE ส่ง API02 `month=2026-09&industry=ALL&discovery=ALL&referringSales=ALL`
4. BE สร้าง population/facts/snapshot เดียว → response company12/knownActive6/receiptCompanies9/net1095600
   และ cohorts2/3/5/unknown1; active KPI เป็น partial ตาม§2.1 ไม่ใช่ exact6
5. ผู้ใช้กด NOT_STARTED → API03 month เดิม,snapshot เดิม,usageGroup=NOT_STARTED,pageSize25
6. FE เห็น MM003/MM008,total2 →กด MM008→API05 → กลับรายการได้ context เดิม

ปัจจุบัน: D ผ่านใน browserdemo; N หยุดที่ role/shell/API ใหม่ G01/G02
pass หลัง implementation ต้องตรวจ networkpayload และ DBread-model จริง ไม่ใช้ JSONfixture แทน

### J02 ชื่อเดือนเปลี่ยนระหว่าง response กำลังกลับ

API02 เดือนก.ย.requestA ช้า; ผู้ใช้เลือกส.ค.ส่ง requestB → B กลับก่อน
FE รับเฉพาะ generation/filtersHash ของ B; A กลับทีหลังไม่ทับ
ถ้าส.ค.ไม่มี coverage→แสดง unavailable พร้อมเดือนส.ค. ห้ามคงยอดก.ย.ใต้ label ส.ค.
หลัง revokepermission ทั้ง A/B ห้าม renderprotected data; client ต้อง clear และ BErequest ถัดไป 403
ปัจจุบัน: demo มี mode จำลอง loading/error แต่ไม่มี HTTPordering จริง G23/G27

### J03 Source หรือ seller และเครดิตอีกคน

API04 discovery=SALES → originalreferrerS001 มี MM002/MM005; net448000
MM005detail→referrerS001,creditedS003;เครดิตไม่ทำให้ discovery กลายเป็นอื่น
เปลี่ยน discovery=FACEBOOK พร้อม referringSales=S001→200empty ไม่เลือกค่าใหม่เอง
OTHERdetail ข้อความ“LINE Official Account”ไม่สร้าง enumLINE และไม่ resolve ข้อความเป็น seller
ปัจจุบัน: D ผ่าน; Esignupnormalizer รองรับ sourceconditional; Naggregate ใหม่

### J04 เงินรับข้ามเดือน คืนเงิน และ webhook ส่งซ้ำ

F-MONEY receipt→billing ยืนยัน nativeidentity/effectiveAt→projection หนึ่ง fact
API02 ก.ย.→receipts0/refunds49900/net−49900;กราฟต้องต่ำกว่า baseline
webhookreceipt/refund ซ้ำ→factcount เท่าเดิม; refund ต.ค.ไม่ย้อนลดยอดก.ย.snapshot เดิม
snapshot ใหม่ก.ย.ถ้ามี lateevidence ต้องบอก revision;existinginvoice.refundedSatang149000 ใช้แทน refund ก.ย.ไม่ได้
ปัจจุบัน: G11/G12/G24; E มี billingverification แต่ Ncashprojection ครบทุก path

### J05 จ่ายแล้ว ยังไม่เริ่มใช้ เทียบเคยใช้และข้อมูลไม่พอ

MM003 มี paidproof และ complete history ไม่พบ qualifyingevent→NOT_STARTED
MM006 มี everpaid/history ก่อนเดือนแต่ไม่มีกิจกรรมเดือนนี้และ coverage ครบ→INACTIVE
MM009 ไม่มี event แต่ history ไม่ครบ→usageGroup:null และหมายเหตุ;ไม่เพิ่ม UNKNOWNcard
MM004trialactive→NOT_PAID แต่ activeCompanies นับ;MM012fullrefund→paidEver ตาม Q03
ปัจจุบัน: D ผ่าน labels; Nactivityfacts; Q03 ต้องยืนยัน trial/refund/successdefinition

### J06 เพิ่มผู้บริหารใหม่และเชื่อมผู้ใช้เดิม

EX-08name/email/profile→API08 ตรวจ managergrant,canonicalemail,userexistence,commandId
case ใหม่→identity+platform enrollment+audit(+outbox ถ้า Q01 เลือก invite)commit ร่วมกัน
response มี userId/enrollmentStatus/activationStatus แสดงตามจริง ไม่สมมติว่า login พร้อม
caseemail มีแล้ว→result ที่ให้ managerreview/link ตาม Q01;ห้ามสร้าง User ซ้ำหรือ reactivateglobaldisableduser
timeout หลัง commit→ส่ง commandId เดิม→ผลเดิม;ไม่ส่ง invite ซ้ำ
ปัจจุบัน: localdemo สร้าง active ทันที; NAPI และ Q01activation G05/G26

### J07 ระงับผู้บริหารระหว่างเปิด dashboard

manager อ่าน API09version5→API10statusSUSPENDED,expectedVersion5,commandIdX
transaction ตรวจ target/self/last manager/currentpermission→update executive enrollment+audit+invalidate
reader เปิด snapshot เก่าต่อ→403;tenantmembership อื่นของ user ไม่ถูก disable โดยปริยาย
manager อีกคนส่ง version5 หลัง update→409;หาก response หายส่ง X เดิมได้ผลเดิม
ปัจจุบัน: D แค่ boolean; Nversion/invalidation;Q01sessionpolicy

### J08 รับคำขอลบจากหน้าบริษัท — DEFERRED

demo มี companyId/reference/reason แต่ existingCreateCaseDto ต้องการ payload อย่างน้อยดังตัวอย่าง
ค่าตัวอย่างนี้เป็นเอกสารสัญญา ไม่เคยส่งเข้าระบบ:

```json
{
  "commandId": "exec-case-create-001",
  "requestKey": "support-case-001",
  "caseType": "COMPANY_WORKSPACE_OFFBOARDING",
  "requestSource": "EMAIL",
  "companyId": "MM003",
  "requesterContact": "requester@example.com",
  "receivedAt": "2026-10-01T03:00:00Z",
  "dueAt": "2026-10-15T03:00:00Z"
}
```

dueAt ตัวอย่างเป็น deadline ที่ operator กำหนดเพื่อจำลองเท่านั้น ไม่ใช่ข้อสรุปกฎหมายหรือ hold end
reason/reference ไม่อยู่ CreateCaseDto จึงต้องตกลง field/reference เพิ่มหรือใช้ existing form;
requesterContact ถูก hash อ่านกลับเป็นอีเมลเดิมไม่ได้
BE ตรวจ scope/target/overlap→201 `{caseId,replayed:false,case:{status:RECEIVED,...}}`
retry เดิม→canonicalcase เดียว; no deletion/ไม่มี automatic billing change
ปัจจุบัน: EAPI มี; G06 ถ้าต่อ demobody ตรง ๆ จะไม่ผ่าน strictDTO;Q06 เรื่องผู้สร้าง

### J09 ตรวจและอนุมัติครบขั้น — DEFERRED

API11verify-identity พร้อม method/reference→IDENTITY_VERIFIED
verify-authority สำหรับ company→authority timestamp;begin-retention-review→RETENTION_REVIEW
recorddecision ครบ 12categories ใช้ disposition ที่ scope อนุญาตและ retentionbasis/end/restriction จริง
approve โดย authorizedactor ที่ไม่ใช่ creator ตาม current policy→APPROVED
holddates สร้างได้เมื่อ Q07anchor ยืนยัน;policy ยังไม่พร้อม→readinessblocked
ปัจจุบัน: Eguard เดิม tested; demoapprove ข้ามทั้งหมด G07;single admin ต่างจาก code G09

### J10 รอ 14 วันและแข่งขันกับคำสั่งยกเลิก — DEFERRED

ที่ serverNow=T−1ms ส่ง start-execution→target422HOLD_NOT_ELAPSED ไม่มี state/mutation
ที่ T ส่ง start-execution พร้อม cancel อีกคำสั่ง→lockcase/scope;คำสั่งชนะกำหนด state;อีกคำสั่ง 409
cancel ชนะ→noexecution;execute ชนะ→cancel ไม่อ้าง rollback งานที่ทำลายแล้วได้
client เปลี่ยนนาฬิกาหรือส่ง holdEndsAt เองไม่มีผล;approvedscope เปลี่ยน→ต้อง review ใหม่ตาม Q07
ปัจจุบัน: currentstartExecution ไม่มี timecheck G08;Q07anchor/cancelpolicy ยังเปิด

### J11 ลบได้บางส่วนหรือ provider ไม่ตอบ — DEFERRED

หลัง time gate และ readiness ครบ→jobclaim พร้อม fencingtoken→inventoryversion ตรวจซ้ำ
DBscope สำเร็จ แต่ objectversion ล้ม/processorunknown→checkpointfailed/pending;ไม่ COMPLETED
retry เฉพาะ remainingwork ด้วย sameexecutionidentity;staleleaseworker ห้ามลบเพิ่ม
หลักฐาน verify ต้อง resolve ได้และสอดคล้อง counts;retainedlawfuldata แสดง reason/end/access
ปัจจุบัน: Nexecutor/checkpoints/machine evidence;Q08retention G10/G29/G30

### J12 ลบแล้วรายงาน บัญชีร่วม และ restore — DEFERRED

companyA ถูกลบ→profile/snapshotA หมดสิทธิ์ทันที;user ที่ยังอยู่ companyB ไม่หาย
retainedbillingmovement ถ้า Q08 อนุญาตต้องยังอยู่ platformmoney total แบบไม่เปิด profilePII
latewebhook/LINEjob/restorebackup ห้ามสร้าง A กลับ;restore ต้อง reapplymanifest ก่อนเปิด access
ปัจจุบัน: R/Q08;ไม่มีการ restore/deletion จริงในรอบนี้

## 4. Scenario catalog

ทุก expectedresponse ด้านล่างรวมเงื่อนไขร่วม: mutation ที่ถูกปฏิเสธต้องไม่เปลี่ยน domainstate,
ไม่ส่ง outbox/providercall และไม่สร้าง successaudit; อาจมี deny/securitylog ที่ปลอดภัย
ทุก successcommand ตรวจ canonicalreadback+audit;ทุก read ต้องไม่มี businessmutation

### 4.1 Authentication และ permission

| ID | FE → request/เงื่อนไข | Expected BE → FE | ปัจจุบัน / gap |
|---|---|---|---|
| SEC-01 | EX-01 ไม่มี session→API01 |401/login รักษา returnURL ไม่มีรายงาน | E/N G02 |
| SEC-02 | cookie มีแต่ token ปลอม/ไม่มี sessionclaim |401 ไม่ถือ cookie เป็นหลักฐาน | E E02 |
| SEC-03 | expiredaccess+validrefresh | refresh ตาม helper เดิมครั้งที่กำหนด;ต่อ request เดิม ไม่ loop | E/N G02 |
| SEC-04 | revoked/expiredsession→API02 |401;clear protected state | E/N G27 |
| SEC-05 | tenantOWNER→API02/API05direct |403 หรือ 404 ตาม scope ไม่มี crosscompanydata | N G04 |
| SEC-06 | customerrole ชื่อ MANGMEE_EXECUTIVE และ permission คล้ายจริง |403 จาก platformprovenance | N G04 |
| SEC-07 | reader จริง→EX-01–04 |อ่าน allowedprojections;ไม่เห็น manageactions | N/D G01/G02 |
| SEC-08 | reader เรียก API08/10/11POST เอง |403;ไม่มี mutation | E/N G25 |
| SEC-09 | manager ไม่มี reportread→API02 |403;manage ไม่ implyread | N/Q01 G05 |
| SEC-10 | billingdelegate มี companyscope จำกัด→executiveall |403 เว้นได้ executivepermission แยก | N G04 |
| SEC-11 | salesagent→executiveanalysis |403;เห็น salesconsole ตามเดิม | E/N G04 |
| SEC-12 | multi-membershipuser เปิด deep link |เลือก platformcontext ตามสิทธิ์ ไม่ใช้ oldest tenant | N G03 |
| SEC-13 | targetcompanyB แต่ actorheadercompanyA ที่ไม่ใช่ platform |reject context mismatch;ไม่ใช้ URL เป็น authority | E/N G03/G04 |
| SEC-14 | globalUserSUSPENDED/role inactive |401/403 ก่อน queryreport;ข้อมูลเดิม clear | E/N G27 |
| SEC-15 | legal acceptance required/temporarypassword |ผ่าน gate เดิมแล้วกลับ executivedeep link | E/N G02 |
| SEC-16 | platformCLOSED |ผลตาม Q01;จนตัดสินคง existinggate ไม่ให้ admin เพิ่ม | E/Q01 G02 |
| SEC-17 | withdrawrole ขณะมี snapshot/cursor |nextread403;invalidatecache;ไม่คืน PII ใน error | N/R G27 |
| SEC-18 | reader เปิด businessdocument/providerreceipt/credentials จาก link |ปฏิเสธด้วย modulepermission เดิม;noURLleak | E/N G04/G25 |

### 4.2 Overview directory analysis detail

| ID | FE → request/เงื่อนไข | Expected BE → FE | ปัจจุบัน / gap |
|---|---|---|---|
| REP-01 | API02baseline12fixtures | company12/knownActive6 แบบ partial/receiptCompanies9/net1095600 และ period/asOf ตรง | D/N G01/G16 |
| REP-02 | F-POPclassification |eligible12/excluded2/unclassified1 พร้อม partial | N/Q02 G13 |
| REP-03 | company มีหลาย owner/member/signup/invoice |countdistinctcompany1 | N/R G18 |
| REP-04 | owner เดียวมี 2company |นับ 2workspace ไม่ dedup ด้วย user/taxId | N G13 |
| REP-05 | companyACTIVE/SUSPENDED/DISABLED/ARCHIVED |ALL รวมทุก status;กรอง status ได้แยก service | D/N G13 |
| REP-06 | month ก่อน joinedAt |detailNOT_YET_REGISTERED;exclude จาก population เดือนนั้น | D/N G01 |
| REP-07 | month ปัจจุบันยังไม่จบ |effectiveEnd=snapshotAsOf;partialmonthlabel | N G23 |
| REP-08 | futuremonth/2026-13/ปีพ.ศ.ส่งเป็น 2569 |400invalidmonth ไม่ตีความเงียบ | N G01 |
| REP-09 | เดือนก่อนเริ่มเก็บข้อมูล |unavailable/earliestAvailableMonth ไม่ 0 | D/N G16 |
| REP-10 | industry+discovery+seller ตรงกัน |KPI/groups/list ใช้ filter เดียวและ normalizedecho | D/N G23 |
| REP-11 | validfilters แต่ intersection ว่าง |200items[],total0;ไม่ล้าง filter เอง | D/N G22 |
| REP-12 | discovery/industry invalid enum |400 ไม่ fallthroughALL | N G01 |
| REP-13 | q ชื่อไทย/ชื่อร้าน/รหัส/province/space |trim และ searchallowlist;ไม่มี contactsearch แถม | D/N G35 |
| REP-14 | q เกิน 120 หรือ SQL-likeinput |เกิน limit400;string อื่นเป็น parameter ไม่ execute | N G35 |
| REP-15 | ชื่อบริษัทซ้ำ 2 แห่ง |ใช้ id แยก row/detail;ไม่มี rowkeycollision | N G35 |
| REP-16 | sort เงินเท่ากัน/nullactivity |stabletiecompanyId;nullslast;page ไม่ซ้ำ | N G23 |
| REP-17 | pageSize0/101/cursor ปลอม |400/409 ตาม contract;ไม่ scanunbounded | N G23 |
| REP-18 | cursor จาก filter/snapshot/user อื่น |reject;ไม่ revealrow นอก scope | N G23/G27 |
| REP-19 | insert/update ระหว่าง page1/page2 |snapshot ชุดเดียว;refresh จึงเห็น revision ใหม่ | N/R G23 |
| REP-20 | drilldown หลังมี entity/usage/servicefilter เก่า |resetirrelevant/chips ชัด;count ตรงการ์ด | D gap G22 |
| REP-21 | detail→Back/refresh/bookmark |month/filter/sort/cursor context restore;expired snapshot prompt refresh | D/N G23/G35 |
| REP-22 | groupsunknown/rounding/denominator0 |unknownrow รวมครบ;percent0denominator—;rounddisplayonly | N G14/G15/G18 |

### 4.3 เงินรับ คืนเงิน ต้นทุน และเครดิต

| ID | FE → request/เงื่อนไข | Expected BE → FE | ปัจจุบัน / gap |
|---|---|---|---|
| PAY-01 | verified package cash→API02/05 |receipts ตาม amount/effectivetime จริง | E/N/Q04 G11 |
| PAY-02 | renewal/addon ในเดือน |รวม platformcash;ไม่เพิ่ม salesactivationcredit | E/N G11/G21 |
| PAY-03 | unpaidinvoice/checkoutcreated/quotagrant |ไม่เป็น cashreceipt | E/N G11 |
| PAY-04 | payment สำเร็จแต่ entitlement apply failed |เงินนับ;serviceissue แยก;ไม่กลับ unpaid | E/N G11 |
| PAY-05 | fullrefund เดือนเดียวกัน |receipts/refunds เท่ากัน net0;receiptcompany ยังนับ | D/N/Q03 G12 |
| PAY-06 | partialrefund ข้ามเดือน F-MONEY |ก.ย.net−49900;ไม่ย้อนเปลี่ยนส.ค.เป็น net สะสม | N/Q04 G12 |
| PAY-07 | refundpending/failed/canceled |ไม่นับ cashrefund สำเร็จ | E/N G12 |
| PAY-08 | creditnote กับ refundnative เดียวกัน |หักเงินครั้งเดียว | E/N G12 |
| PAY-09 | refund2 ครั้งคนละเดือน |แต่ละ movement ลงเดือนจริง;reconcilecumulative ได้ | N G12 |
| PAY-10 | webhook/reconcile duplicate |unique provider identity;total ไม่เพิ่ม | E/N G12 |
| PAY-11 | latepayment/refundevent |ลง effectiveperiod;revision/lag ชัด | N G11/G23 |
| PAY-12 | event ตรง Thai00:00 และ UTC17:00 |ลงเดือนใหม่;periodhalf-open | E/N G11 |
| PAY-13 | LIVE/TEST/provideraccount ต่างกัน nativeid ซ้ำ |scopekey แยก;LIVE ไม่ปน TEST | E/N G11 |
| PAY-14 | nonTHB หรือ unsafe integeraggregate |coverage/error explicit;ไม่ sumcurrency หรือ truncate | N G11 |
| PAY-15 | feeunknown/partialrecords |null/partial;ไม่ 0 หรือ 3%fixture | N/D gap G21 |
| PAY-16 | taxincluded/excluded/manualcash/dispute |ตาม Q04;unknown ไม่เดา;ไม่เรียกกำไร | Q04 G11/G12 |
| PAY-17 | AIcostcorrectionnegative |costsum รวม correction;call/activitycount ไม่เพิ่ม | E/N G16 |
| PAY-18 | first activation sales flag/unflag/refundwindow |reusecountableAmountSatang;renewalsexcluded | E/N G21 |
| PAY-19 |5001attributions ตรง range |completeaggregate หรือ explicitincomplete;ไม่เงียบ 5000 | E BUG G19 |
| PAY-20 | company ถูกลบแต่ retainedcashfact |total ไม่หาย;detail ไม่เปิด PII;policyQ08 | **DEFERRED** · R/Q08 G31 |

### 4.4 การใช้งานและ coverage

| ID | FE → request/เงื่อนไข | Expected BE → FE | ปัจจุบัน / gap |
|---|---|---|---|
| USE-01 | paid+complete history ไม่มี event |NOT_STARTED กลุ่มเดียว | D/N/Q03 G16 |
| USE-02 | paid+used ก่อนเดือนแต่เดือนนี้ 0 ครบ |INACTIVE | D/N G16 |
| USE-03 | paid+qualifyingevent เดือนนี้ |ACTIVE | D/N G16 |
| USE-04 | paid+historyunknown ไม่มี event |usageGroup:null;note/—;ไม่ NOT_STARTED | D/N G16 |
| USE-05 | paymenthistoryunknown แต่ activityknown |usageGroup:null paymentreason;activity แสดงได้ | N G11/G16 |
| USE-06 | trialnotpaid แต่ active |NOT_PAID;activeKPI นับ 1;paidcards ไม่นับ | D/N/Q03 G16 |
| USE-07 | เคยใช้ trial แล้วเพิ่งจ่าย |ไม่ neverused ตามข้อเสนอ;รอมติ Q03 ก่อนจริง | Q03 G16 |
| USE-08 | paidannual เดือนก่อนเดือนนี้ไม่มี receipt |ยังอยู่ paidpopulation | D/N G11 |
| USE-09 | fullrefund หลังใช้งาน |everpaid/cohort ตาม Q03;ไม่ใช้ net0 แทน neverpaid | D/Q03 G12 |
| USE-10 | login อย่างเดียว/refreshsession |ไม่ active;loginlabel มีหลักฐานแยก | N G17 |
| USE-11 | OCRadmission แล้ว providerfailed |ไม่ qualifyOCRsuccess;quota/cost ยังตาม owner | E/N G16 |
| USE-12 | AIturn เดียวเรียก model3 ครั้ง |logicalrequest1;cost3calls แยก | E/N G16 |
| USE-13 | retry/replaycommand เดียว 3 ครั้ง |qualifyingaction1;ไม่ dedup ด้วย transportid ที่เปลี่ยน | E/N/R G16 |
| USE-14 | expenseconfirmed มี derived accounting record |document1 ตาม canonicalkey | N/Q03 G18 |
| USE-15 | systemcron/support/admin/executiveread |ไม่ทำให้ customeractive โดยปริยาย;Q03actorpolicy | N/Q03 G16 |
| USE-16 | user เดียวใช้ companyA/B วันเดียว |per-company ถูก;platformusers/daysdistinct ใหม่ | N G18 |
| USE-17 | late event/error→success/rolled back transaction |นับเฉพาะ commit สำเร็จครั้งเดียวใน occurredperiod | N/R G16/G23 |
| USE-18 | coverage บาง feature ครบแต่ feature อื่นขาด |positiveactivity ยืนยัน active ได้;exact counts/neverused ต้องมี coverage พอ | N G16 |

### 4.5 ช่องทาง เซลล์ และประเภทบริษัท

| ID | FE → request/เงื่อนไข | Expected BE → FE | ปัจจุบัน / gap |
|---|---|---|---|
| SRC-01 | SALES+validseller |แสดง canonicalsource และ sellerid/code | E/D/N G20 |
| SRC-02 | FACEBOOK+salescodesent |signup เดิม normalize ตาม B6;report ไม่เพิ่ม seller เอง | E/D G20 |
| SRC-03 | OTHER รายละเอียด LINE/event |เก็บ OTHERtext ไม่เปลี่ยน enum/resolveagent | E/D/N G15 |
| SRC-04 | originalsignup2 แถว/returnexisting |เลือก originallinkedrow ไม่ latestrequest | E/N G18 |
| SRC-05 | nooriginalsignup |discoveryUNKNOWN ไม่เดาจาก rail | E/N G20 |
| SRC-06 | SALES แต่ sellerid หาย |UNKNOWN ไม่ NONE | N/D gap G20 |
| SRC-07 | seller profile deleted/suspended |history คง attribution พร้อม unresolvedlabel | E/N gap G20 |
| SRC-08 | historicalnonSALES+admin referrer repair |แสดง provenance/discrepancy;ไม่ rewritehistory | N G20 |
| SRC-09 | referrerS001/creditedS003 |คนละ field/table;filtersreferrer ไม่สลับ credit | D/N G21 |
| SRC-10 | seller ชื่อซ้ำ/เปลี่ยนชื่อ |idstable;ชื่อ+code แยก;ไม่ doublegroup | N G20 |
| SRC-11 | businessCategoryCLINIC แต่ commercialmapping ต่าง |privacycategory ไม่เป็น commercialindustry | N/Q05 G15 |
| SRC-12 | businessTypeOTHER/ไม่มี code/mappingversion เปลี่ยน |UNKNOWN/OTHERexplicit;version bind snapshot | N/Q05 G15/G23 |
| SRC-13 | entity/province ไม่มี canonicalproof |UNKNOWN;ไม่เดาจากชื่อ/taxId;ยังนับ population | N/Q05 G14 |
| SRC-14 | ไม่มี currentsalesteam/contactpermission |null/hidden;ไม่ copyreferrer หรือเปิด payroll/contact | N/Q01 G20/G25 |

### 4.6 บัญชีผู้บริหาร

| ID | FE → request/เงื่อนไข | Expected BE → FE | ปัจจุบัน / gap |
|---|---|---|---|
| USR-01 | manager เปิด API07 |เฉพาะ executiveenrollments+paging/capabilities | D/N G05 |
| USR-02 | create valid new email |canonicaluser/enrollment/audit;activation state ตามจริง | D/N/Q01 G05 |
| USR-03 | nameblank/whitespace/emailmalformed |400fieldErrors;FE คงค่า/focuserror | D/N G26 |
| USR-04 | name/email เกิน bounds หรือ unicode |validate ตาม identitypolicy;ไม่ truncate เงียบ | N G26 |
| USR-05 | email ต่าง case/space บัญชี executive เดิม |409alreadyenrolled ไม่สร้างซ้ำ | D/N G26 |
| USR-06 | email เป็น existingtenantuser |review/linkuserId ตาม Q01;ไม่ takeover | Q01 G05 |
| USR-07 | existingglobaluserDISABLED |ไม่ reactivate ด้วย createexecutive | Q01/R G05 |
| USR-08 | submit พร้อมกัน 2tab/sameemail |หนึ่ง canonicalidentity;conflict/replay ที่อธิบายได้ | N/R G26 |
| USR-09 | same commandId/same payloadretry |ผลเดิม;noaudit/inviteduplicate | N/R G26 |
| USR-10 | same key different payload/actor |409commandconflict;ไม่คืนข้อมูลเกินสิทธิ์ | N G26 |
| USR-11 | requestroleSYSTEM_ADMIN/arbitrary permissions |403/400;managergrant เฉพาะ profileallowlist | N G04/G05 |
| USR-12 | cancel ฟอร์ม/dirtyback |ไม่มี APIcommand;confirmation ตาม UX ถ้าต้องรักษาค่า | D/N G35 |
| USR-13 | invite ส่งล้มหลัง identitycommit |pendingdelivery;retryoutbox ไม่ createaccount ซ้ำ | Q01/R G05 |
| USR-14 | status change valid version |commitstatus+audit;readback ตรง | D/N G26 |
| USR-15 | status stale version/doubleclick |409 หรือ samekeyreplay;no lostupdate | N/R G26 |
| USR-16 | suspendself/last manager พร้อมกัน |ตาม Q01;ข้อเสนอ denyunderrosterlock | Q01/R G26 |
| USR-17 | suspendexecutive ที่มี tenantrole ด้วย |ไม่ globaldisable;session/cache ตาม Q01 | N/Q01 G05/G27 |
| USR-18 | user detail not found/searchstatus/page/lastloginunknown |404 หรือ empty;null—;ไม่มี credential/tempPasswordfield | D/N G05/G35 |

### 4.7 คำขอลบ การอนุมัติ และช่วงคงข้อมูล

| ID | FE → request/เงื่อนไข | Expected BE → FE | ปัจจุบัน / gap |
|---|---|---|---|
| DR-01 | EX-05/06 reader → API12 list/summary; operator → API11 full detail | reader เห็นสรุปทุกบริษัทแต่ไม่มี contact/reason/evidence; operator ผ่าน guard เดิม; paging/status/due filter ตามแต่ละ API | **DEFERRED** · E/N/Q06 G25 |
| DR-02 | EX-06 ส่ง body ของ demo ตรง API11 | reject required fields/unknown fields; FE ไม่ขึ้น success | **DEFERRED** · E/D gap G06 |
| DR-03 | สร้าง company case ด้วย body ครบ | RECEIVED, canonical caseId, ไม่มีการลบ/ระงับ/คืนเงิน | **DEFERRED** · E G06 |
| DR-04 | target company ไม่มี/ไม่ตรง scope type |404/422; company case รับ companyId เท่านั้น | **DEFERRED** · E G29 |
| DR-05 | membership exit ที่ user/company/member ไม่สัมพันธ์กัน |422; ไม่เปลี่ยน membership ใด | **DEFERRED** · E G29 |
| DR-06 | user erasure ส่ง companyId หรือ company offboard ส่ง userId |422 scope mismatch; ไม่ขยายไป global user | **DEFERRED** · E G29 |
| DR-07 | commandId เดิม payload/actor เดิม | replay case/action เดียว ไม่มี duplicate | **DEFERRED** · E G33 |
| DR-08 | commandId เดิม payload/actor/target ต่าง |409 command conflict | **DEFERRED** · E G33 |
| DR-09 | requestKey ซ้ำคนละ command |409 request-key conflict ไม่สร้าง case ใหม่ | **DEFERRED** · E G33 |
| DR-10 | user/company/member case ซ้อน scope ที่ยัง active |409 overlapping scope; linked remediation ตามกฎเดิม | **DEFERRED** · E G33 |
| DR-11 | receivedAt/dueAt ผิดรูปหรือ due ก่อน received | validation error; due ไม่ใช้แทน hold end | **DEFERRED** · E G32 |
| DR-12 | requesterContact/email อย่างเดียว |ยังไม่ identity verified; hash ไม่ส่งกลับเป็น rawcontact | **DEFERRED** · E G06/G33 |
| DR-13 | verify identity ไม่มี method/reference ที่อนุญาต |400/422; state ไม่เปลี่ยน | **DEFERRED** · E G07 |
| DR-14 | company case ไม่มี authority แล้ว begin review |422; FE บอกให้ตรวจอำนาจก่อน | **DEFERRED** · E G07 |
| DR-15 | user erasure ขอ authority NOT_REQUIRED ผ่าน endpoint | current service ปฏิเสธ unnecessary authority command; ใช้ flow ตาม case type | **DEFERRED** · E E11 |
| DR-16 | approve ตรงจาก RECEIVED |409 invalid transition; demo action ใช้แทนไม่ได้ | **DEFERRED** · E/D gap G07 |
| DR-17 | retention decisions ขาด 1 ใน 12category |422 พร้อม missingcategories;ไม่ APPROVED | **DEFERRED** · E G07 |
| DR-18 | disposition DELETE นอก scope เช่นลบ globaluser จาก companycase |422 disposition out of scope | **DEFERRED** · E G29 |
| DR-19 | RETAIN/RESTRICT ไม่มี basis/end/access หรือหมดอายุ |422 ก่อน approve และ recheck ก่อน execute | **DEFERRED** · E G10 |
| DR-20 | creator approve / approver execute / executor verify เอง |403 ตาม current policy; single-admin mode รอมติ | **DEFERRED** · E/Q06 G09 |
| DR-21 | holdStartsAt/holdEndsAt/policyVersion ไม่มี | readiness=false; targetPOLICY_NOT_READY;ไม่เดาจาก approvedAt | **DEFERRED** · N/Q07 G08 |
| DR-22 | now=end−1ms | targetHOLD_NOT_ELAPSED;คงทุกข้อมูล/stateAPPROVED | **DEFERRED** · N G08 |
| DR-23 | now=end ตรงหรือ end+1ms |ผ่านเฉพาะ time gate;ต้องผ่าน permission/retention/scope/inventory ด้วย | **DEFERRED** · N G08/G10 |
| DR-24 | clientclock เร็ว/ส่ง holdEnd ปลอม/เปลี่ยน timezone |client ไม่มีอำนาจเวลา;requestextra fields ถูก reject | **DEFERRED** · E/N G08/G32 |
| DR-25 | scope/decision/source เปลี่ยนหลัง approval |invalidate readiness;409/blocked;review/reset ตาม Q07 | **DEFERRED** · N/Q07 G32 |
| DR-26 | cancel ก่อน execute/withdrawrequest |allowedtransition ตาม Q07;ไม่ลบ;rollback บริการเฉพาะที่ policy ระบุ | **DEFERRED** · E/Q07 G32 |
| DR-27 | cancel กับ execute พร้อมกัน |serialize;หนึ่ง transition ชนะ อีกคำสั่ง 409;ไม่มี execute หลัง cancel ชนะ | **DEFERRED** · R/N G32 |
| DR-28 | startExecution timeout แล้ว retry |same command replay;ไม่สร้าง job ซ้ำ;HTTP200 ไม่ใช่ลบสำเร็จ | **DEFERRED** · E/N G10 |
| DR-29 | DB ลบได้แต่ object/provider ล้มบางส่วน |partial checkpoints/BLOCKED;ไม่ COMPLETED | **DEFERRED** · N G10/G29 |
| DR-30 | evidenceURI/hashsyntax ถูกแต่ resolve ไม่ได้/คนละ scope |targetreject verification;current format-only ไม่พอ | **DEFERRED** · E gap/N G10 |
| DR-31 | มี retaineddata แต่ส่ง outcomeCOMPLETED |422;ใช้ COMPLETED_WITH_EXCEPTION พร้อม basis/end/access จริง | **DEFERRED** · E/Q08 G10 |
| DR-32 | BLOCKED case เปิดใหม่/independent verification/ครบทุก proof |linkedcase ตามกฎเดิม;complete เมื่อ verifiedoutcome ครบ ไม่ใช้ elapsedtime แทน | **DEFERRED** · E/N G10/G32 |

### 4.8 Failure recovery และผลข้ามโมดูล

| ID | FE → request/เงื่อนไข | Expected BE → FE | ปัจจุบัน / gap |
|---|---|---|---|
| OPS-01 | report source หนึ่งช้าหรือล่ม | sectionpartial/unavailable;authfailure ต้อง fail ทั้ง request | N/R G27 |
| OPS-02 | billing observation เก่า |dataThrough/lag แสดงจริง ไม่ประทับ now แล้วอ้างสด | N G11 |
| OPS-03 | account/case transaction rollback |ไม่มี partialdomain+successaudit+outbox | E/N/R G26/G33 |
| OPS-04 | commandcommit แล้ว network หลุด |same key retry/readback;no duplicate mutation | E/N/R G26/G33 |
| OPS-05 | snapshot หมดอายุหรือ source version เปลี่ยน |409;FErefresh ทั้งชุด ไม่ผสมเงินกับ population คนละ revision | N G23 |
| OPS-06 | scale เกิน 5000/ข้อมูล 1 ล้าน events |ไม่มี silentcap;measurelatency/queryplan;timeout มี error ชัด | N/R/Q09 G19/G23 |
| OPS-07 | report GET ถูกเรียกซ้ำ/หลาย tab |ไม่ trigger billing reconcile, invite, mutation หรือ activity ลูกค้า | N G16/G28 |
| OPS-08 | archive แล้ว billing ยัง active |แสดง service/billing แยก;offboarding ต้องมี cancellationpolicy แยก | **DEFERRED** · E/R/Q07 G28 |
| OPS-09 | latepaidwebhook หลัง purge/ระหว่าง execution |ไม่ recreatecompany/term;financialevidence ตาม retentionpolicy | **DEFERRED** · R/Q08 G28/G31 |
| OPS-10 | queued LINE/outbox/AI worker เริ่มก่อน hold สิ้นสุด |ทุก writer เคารพ scope/fence;hold ห้าม earlypurge | **DEFERRED** · R/Q07 G28/G30 |
| OPS-11 | stale executor lease หลัง retryworker ใหม่ |stale worker ถูก fence ก่อน destructiveeffect | **DEFERRED** · N/R G29 |
| OPS-12 | current+noncurrent object versions/locator ถูกลบก่อน/schema เพิ่ม model หลัง inventory เดิม |manifest ครบจาก schema ปัจจุบันก่อน;ลบ exactversions ตาม policy;ไม่อ้างแค่ row count | **DEFERRED** · N/R G29/G34 |
| OPS-13 | user เดียวอยู่ companyA/B แล้วลบ A |B/user/LINE access ของ B คงตามสิทธิ์;scope ไม่ข้าม | **DEFERRED** · E/N/R G29 |
| OPS-14 | cleanup/TTL/storage lifecycle ระหว่าง 14 วัน |ไม่ลบข้อมูลใน hold scope;conflict กับ TTL ต้องปิดก่อนเปิด flow | **DEFERRED** · N/R/Q07 G30 |
| OPS-15 | restorebackup ก่อนลบแล้วเปิดระบบ |reapplyerasure/restrictionsmanifest ก่อนเปิด access;no resurrection | **DEFERRED** · N/R/Q08 G30 |
| OPS-16 | export/cache/materializedsnapshot ยังมี companyPII |invalidate/purge ตาม scope;ไม่ให้ cache bypass retention | **DEFERRED** · N/R/Q08 G31 |
| OPS-17 | audit/logs/errorpayload |มี correlation และ safeactor/target;ไม่มี password/token/contact/AItext | E/N/R G25 |
| OPS-18 | rollback executive feature/oldclient |ปิด reader/account/deletion แยก;ไม่ย้อนลบ facts/audit;unknown version fail closed | N/R G01/G08 |

### 4.9 FE state และธีมขณะเชื่อม API

| ID | FE → request/เงื่อนไข | Expected BE → FE | ปัจจุบัน / gap |
|---|---|---|---|
| FE-01 | เปิด EX-01/02/03 pending |scope loader;ไม่มีตัวเลขเก่าใต้ context ใหม่ | D/N G27 |
| FE-02 | API timeout/503/retry |unavailable แยก empty;retry ตาม helper ไม่ loop | D/N G27 |
| FE-03 | API403 หลังเคยเห็นข้อมูล |clear protected content;action หาย/disabled มีเหตุผล | D/N G25/G27 |
| FE-04 | API400fieldErrors จาก createuser/case |field เดิมธีมเดิม;คงค่า;focuserror;ไม่ toastsuccess | D/N G06/G26 |
| FE-05 | API409source/version/snapshotchanged |โหลด state ใหม่และให้ review ไม่ submit ใหม่เงียบ | N G23/G26/G32 |
| FE-06 | API429 |แสดงรอพร้อม retryafter;ไม่ submit ซ้ำถี่ | N G35 |
| FE-07 | data:null/partial/zero |—/coverage หมายเหตุ/0 ตามความหมาย;ไม่มี UNKNOWNcohortcard | D/N G16 |
| FE-08 | dropdownsearch/keyboard/Escape/outside/switch |sharedThemedSelect;focus/selected/menu อยู่ใน theme | D ผ่าน;integration รอ G35 |
| FE-09 | Thai/longtext/noresults/unknownoption |label อ่านได้;id เป็น value;search ไม่เปลี่ยน sourceenum | D/N G15/G35 |
| FE-10 | text/textarea focus/error/disabled/readonly/autofill |sharedfieldtokens ทุก state;autofill ต้องตรวจ browser จริง | D บางส่วน;autofill รอ G35 |
| FE-11 | monthpicker พ.ศ./ค.ศ./timezone |UIlocale ถูก;APIYYYY-MM ค.ศ.;dayboundary ถูก | D/N G11 |
| FE-12 | viewport1440/1024/768/390/320 |noouteroverflow;table contained scroll;popover ไม่ clip | D ผ่าน;shell จริงรอ G35 |
| FE-13 | darkOS/zoom200%/keyboard-only |apptheme เดิม;focus และ label ไม่หาย;zoom ยังต้องตรวจ | DdarkOS;zoom รอ G35 |
| FE-14 | negative financial trend/largeamount |bar ใต้ baseline/formatexact;ไม่ clip เป็น positivebar | D gap/N G24 |
| FE-15 | doubleclicksubmit/pending/timeoutback |disabledpending;stablecommandId;ไม่มี optimistic success | D/N G26/G33 |
| FE-16 | detailtab/Back/URLrestore/read-only deep link |context ถูก;GET ไม่มี mutation;reader ไม่เห็น casePII ที่ไม่ได้สิทธิ์ | D/N/Q06 G25/G35 |

## 5. เคสผสมที่เสี่ยงสูง

ใช้เคสผสมเพิ่มจาก equivalence/boundary ใน§4 ไม่อ้างว่าเป็น formal pairwise covering array ของทุก dimension

| ID | ชุดเงื่อนไขร่วม | ผลที่ต้องได้ | อ้างอิง |
|---|---|---|---|
| PX-01 | reader +หลาย membership +old home cookie +expired customer term |เข้า executive ด้วย platformcontext ถ้าสิทธิ์ถูก;ไม่ใช้ customerterm เป็น scope รายงาน | SEC-12, REP-21; G03 |
| PX-02 | refund-onlymonth +sourceUNKNOWN +archivedcompany |net ติดลบยังรวมใน unknown/sourcegroup;ไม่ drop จาก status หรือกราฟ | PAY-06, REP-05; G12/G24 |
| PX-03 | annualpaid +trialuse ก่อนจ่าย +noactivity เดือนนี้ |INACTIVE ตาม Q03;ไม่ NOT_PAID หรือ NOT_STARTED จาก receipt เดือนนี้ 0 | USE-02/07/08; G16 |
| PX-04 | oldentityfilter +cohortdrilldown +emptycombination |context/chips ชัดและ drillcount สอดคล้อง;ไม่ hiddenfilter | REP-11/20; G22 |
| PX-05 | manager2 คน createemail ต่าง case +response คนหนึ่งหาย |identity เดียว;stableidempotency และ readback | USR-05/08/09; G26 |
| PX-06 | manager2 คนปิดกันเอง +last manager protection |commit ไม่ทำให้เหลือ 0manager ตาม Q01 | USR-16; G26 |
| PX-07 | approve สำเร็จ +hold policy ไม่พร้อม +clientclock เร็ว |canExecute=false;noearlydeletion | **DEFERRED** · DR-21/24; G08 |
| PX-08 | hold end ตรงขอบ +permission ถอน +executequeued |authorization ล่าสุด deny ก่อน sideeffect แม้ time gate ผ่าน | **DEFERRED** · SEC-17, DR-23; G08/G27 |
| PX-09 | scope เปลี่ยน +cancel +execute พร้อมกัน |source version/lock กำหนดผลแน่นอน;ไม่มี bypasshold | **DEFERRED** · DR-25/27; G32 |
| PX-10 | partial purge +late billing webhook +workerlease เก่า |checkpoint/fence กัน recreate และ doubledelete;ไม่ complete | **DEFERRED** · DR-29, OPS-09/11; G28/G29 |
| PX-11 | deletedcompany +retainedcash +snapshotcache +restoredbackup |cash ตาม Q08 ยัง reconcile;PII ไม่กลับ;manifest ก่อน access | **DEFERRED** · PAY-20, OPS-15/16; G30/G31 |
| PX-12 | SALESsellerdeleted +creditedseller ต่าง +flaggedcredit +renewal |referrerunresolved ยังอยู่;credit ตาม flag;renewal เพิ่ม cash เท่านั้น | SRC-07/09, PAY-02/18; G20/G21 |

## 6. Traceability ของหน้าจอ ข้อกำหนด และ module

| Screen/requirement | API | Scenario families | Dependency/regression |
|---|---|---|---|
| EX-01 R01–07/R15–16 | API01/02/03 | SEC,REP,PAY,USE,FE,PX01–04 | auth/shell/company/billing/activity/cache |
| EX-02 R02–10/R15–16 | API03/05 | REP,SRC,USE,FE | partnerdirectory/signup/companyidentity |
| EX-03 R07–09 | API04/03 | PAY,SRC,REP22,PX12 | salesreports/billing/industrymapping |
| EX-04 R03–10/R12 | API05/API06 | REP06/21,SRC,USE,PAY,SEC18,FE16 | profile/service/authorizedhistory |
| EX-05/06 R12–16 | API11/API12/API06 | DR,OPS,PX07–11 | data-rights/P31/identity/storage/billing/LINE/restore |
| EX-07/08 R11/R15–16 | API07–10 | USR,SEC08/09/14/17,FE04/05/15,PX05/06 | identity/membership/roles/outbox/audit |

Regression paths เดิมที่ต้องรันภายหลังเมื่อแตะ module นั้น:

- `e2e/system-admin.spec.ts`: partnerlist/detail/search/status/paging; tenant owner blocked
- `e2e/sales-console.spec.ts`: createagent/deal/approve ไม่ถูกขยายสิทธิ์โดย executiverole
- `e2e/billing-admin-directory.spec.ts`, `e2e/billing-admin-menu-ux.spec.ts`: billingdelegate scope/menu
- `apps/api/src/modules/auth/auth.guard.spec.ts`, permission registry/resolver และ web session gate tests
- data-rights service/controller/contract + actual API journey ต้องเพิ่ม hold tests หลังมติครบ
- billing financial/refund source/receipt/apply tests; AI usage/quota tests หากเพิ่ม activityadapters
- sharedfield/theme tests และ browser เปิด popover ทุก state ใน systemshell จริง

## 7. ผลจริง ข้อจำกัด และเกณฑ์ปิดงาน QA

Catalog มี **176 scenario รายหมวด +12 เคสผสม =188 เคสจำลอง** และ 12walkthroughs
ยังไม่มี scenario ของ executive API ใหม่ที่รันแบบ FE→HTTP→DB จริง

ผลรันจริง baseline 2026-10-01 (ก่อนพัก deletion; 58 BE tests ไม่ได้รันซ้ำในรอบซ่อนฟีเจอร์):

- localdemo `check-demo.cjs`: PASS ตาม [audit§6](../research/mangmee-executive-business-be-gap-impact-2026-10-01-th.md#6-หลักฐานที่รันจริงในรอบนี้)
- existing focused tests:58PASS/0FAIL/0SKIP;ไม่ใช่ 188 เคสด้านบน
- static source/contract walkthrough:ครบ screen/APIproposals ตาม§6 และพบ G01–G35
- fixture arithmetic/เอกสาร/IDs/links ตรวจแยกตาม taskmemory

ยังไม่รัน: HTTP/DB integration ใหม่, real concurrency locks, source backfill,
real provider/refund/erasure, restore, large-data performance, nativezoom/autofill ใน shell จริง
ทั้งหมดต้องเป็น isolatedfixtures ไม่ใช้ customerdata ทดสอบ destructive flows

การรับ implementation ภายหลังต้องมีหลักฐานแต่ละ scenario ที่เกี่ยวข้อง: fixtureversion,
actor/scope, sanitizedrequest/response/status, DBbefore/after หรือ queryresult,
audit/command replay, FE screenshot/visiblelabel และ sideeffectabsence ใน negativecases
สำหรับ case ที่รอมติให้สถานะ BLOCKED_DECISION จน Owner ตอบ ห้าม markPASS จาก assumption
ห้ามลบ case ออกเพียงเพราะยังไม่มี UI ปุ่มหรือทำ automation ยาก;ระบุ manual/integrationlevel และเหตุผลแทน

ผลรันหลังพัก deletion: rebuild + sandbox preview + `check-demo.cjs` PASS; ตรวจ HIDE-01–04 และรายงาน/บัญชี/controls/responsive/theme เดิม. ไม่มี real FE→HTTP→DB E2E เพิ่ม

## ส่วนเพิ่มกราฟการใช้งานและ 80/20 (2026-10-01)

ดู [spec extension](../specs/mangmee-executive-usage-pareto-spec-th.md) สำหรับกราฟแยกสี/คลิกเจาะข้อมูล/อันดับ/Top spender และ fixtureใหม่72บริษัทหลังตัดทดสอบ. ตัวเลข12บริษัทในเอกสารนี้เป็น historical baseline; ไม่ใช่เดโมรุ่นล่าสุด. ผล spec simulation เดิมยังไม่ใช่ integration PASS. Deletion ยังคงซ่อน


## Navigation/comparison extension — 2026-10-01

อ้าง [specและผลตรวจ](../specs/mangmee-executive-navigation-comparison-spec-th.md). EX-03 เดิมแตกเป็นusage/revenue/customers/compare; 188baselinecasesยังคงเป็นsimulationไม่ใช่ผลรันruntime

| ID | Current local expected / verification |
|---|---|
| UX-01 | overview4KPI/2หัวข้อ/ไม่มีlongtable; desktopmain785px |
| UX-02 | แต่ละanalysisroute/tabมีเฉพาะเนื้อหาที่เลือก |
| UX-03 | chart→list→detail→Backรักษาsort/page/subview |
| UX-04 | reportsharedfilterคงอยู่/มีlabelแม้พับ; comparisonใช้ฐานแยกชัด |
| UX-05 | industry14vs13, rawnet58464vs54464และper-company4176vs4189.54ถูก |
| UX-06 | rate delta17.6percentagepoints; swapกลับเครื่องหมาย |
| UX-07 | samegroupให้เลือกใหม่; unknownไม่มีfalsezero/delta |
| UX-08 | comparisonA/B→memberlist/detail→comparisonกลับค่าฝั่งเดิม |
| UX-09 | monthcomparisonunavailable ไม่แสดงgrowthปลอม |
| UX-10 | legacyanalysis→usage/revenue, newviewstate restore, olddeletionroutes→overview |
| UX-11 | responsive menu/dropdown/theme/keyboard1440–320px ไม่มีouteroverflow |
| UX-12 | reader/accountpermission, loading/error/forbiddenของทุกหน้าใหม่, deletionยังซ่อน |

UXrowsเป็นชุดเพิ่มจากbaseline188; testscriptปัจจุบันอยู่ในพื้นที่เดโมตามmemory. การตรวจBEsource/HTTP/DBของcomparativecontractยังไม่เกิดขึ้น


## Excel export UX extension — EXL-01–14

รายละเอียดและ expected results อยู่ใน [Excel spec §7](../specs/mangmee-executive-excel-export-spec-th.md#7-เกณฑ์ตรวจรับและ-gap-ใหม่)
EXL-01–09 ส่วน local UX/manifest ตรวจผ่าน `check-export.cjs` ตามผลที่บันทึกใน memory; รวม all-page40, Pareto15/13, A/B27, detail1, source/unknown/empty/role/error/expired และ mobile theme
EXL-10–12 เป็น NOT_IMPLEMENTED: real auth/HTTP/snapshot/typed XLSX/parser/render/limits/audit และ shared writer regression; ไม่อ้างผลจากเดโมเป็นผลไฟล์จริง
ไม่เปลี่ยน188baseline/47deferredหรือ UX-01–12; เพิ่ม12case IDsเดิมและEXL13–14ตามแม่แบบv4แยกต่างหาก. Deletionยังhidden และไม่มี workbook sheet สำหรับข้อมูลคำร้อง


### Owner template amendment — Excel Dashboard v4

Ownerระบุ `outputs/company-infographic-20261001/company-receipts-dashboard-v4.xlsx` เป็นแม่แบบตาม [Excel spec §8](../specs/mangmee-executive-excel-export-spec-th.md#8-แม่แบบและหลักฐานตรวจอ่าน-2026-10-01)
มตินี้แทนsummary-only/optional-company/values-only: ค่าเริ่มต้นเป็นDashboardเขียว–ทอง + nativecharts/สูตร + รายบริษัทที่เป็นsource, 2ชีตหลัก; ตารางคำนวณใต้Dashboardและmetadataในsource
ต้องแยกsource28ก.ย.ของแม่แบบจากfictional30ก.ย.ของเดโม; ไม่ยกสูตรblank=0หรือreceiptทุกสถานะมาเปลี่ยนBE Q03โดยปริยาย
API13รับtemplateKeyแทนincludeCompanies; serverเลือกversion/hash. XG03ต้องตรวจnativechart/formula/cache/renderเพิ่ม; writerเดิมsingle-sheetยังทำไม่ได้
EXL13–14เพิ่มintegrationacceptance; baseline188/47deferredไม่เปลี่ยนและไม่มีgapimplementationปิดจากการอ่านแม่แบบ. ไม่แก้ไฟล์อ้างอิงและไม่สร้างXLSXใหม่รอบนี้

Current local evidence: `check-export.cjs` v6 and `check-demo.cjs` PASS; fixed2-sheet manifest/Dashboard/source preview, all scopes/subviews, unknown and permission/error/expiry/mobile/theme verified. EXL13–14 native XLSX generation/recalculation/render acceptance remains NOT_IMPLEMENTED; inspected reference workbook is read-only evidence, not export-service evidence.

EXL-15 เพิ่ม contact columns ตาม [Excel spec §9](../specs/mangmee-executive-excel-export-spec-th.md#9-มติข้อมูลติดต่อ--2026-10-01); Q-EXL-CONTACT RESOLVED เป็น User.email/phoneNumber ล่าสุดของบัญชีเจ้าของ ผ่าน active membership/canonical OWNER/stable ID. เคส (a)–(l) ใน §9.2 ครอบคลุมชื่อซ้ำ/หลายบริษัท/หลาย role ไม่คูณ KPI, OWNER เดียว/หลาย/ไม่มี/tenant role ปลอม, account suspended กับ membership ถูกถอด, contact แก้หรือล้างแยก field, unverified/invalid/null/source error, เปลี่ยนเจ้าของ และ FE/detail/Excel snapshot ตรงกัน. ห้าม fallback Company/signup/Gmail/Sheet; phone literal text รักษา 0 และ preserve rows/formulas/charts. เป็น design acceptance ยังไม่ได้รัน API จริง; v5 จาก Sheet ไม่ผ่าน system-source acceptance. Local demo ใช้ข้อมูลสมมติเพื่อตรวจ label/contact consistency เท่านั้น
