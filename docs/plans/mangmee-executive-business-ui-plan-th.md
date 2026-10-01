# แผนหน้าจอผู้บริหารมั่งมี

คำที่แสดงบนหน้าจอล่าสุด: [ใช้คำที่คนทั่วไปเข้าใจ](../specs/mangmee-executive-plain-language-spec-th.md) — เมนู “รายรับ”, แท็บ “ลูกค้าที่สร้างรายรับสูง”; identifiers/สูตรเดิมคงไว้

มติล่าสุด 2026-10-01: **พักและซ่อน EX-05/06 และคำร้องใน EX-04**; scope ปัจจุบันเป็นรายงานและบัญชีผู้บริหาร. Checkmarks เกี่ยวกับโครงคำร้อง/hold ด้านล่างเป็นประวัติเดโมเดิม ไม่ใช่ feature ที่เปิดในเดโมปัจจุบันหรือเกณฑ์ตรวจรับรอบนี้

สถานะ: **สเปกฝั่งหน้าจอแก้ตามผลตรวจทานอิสระ 2026-10-01 แล้ว — ต้นแบบเป็นรุ่นรอบแก้คำ 2026-10-01 และยังไม่ตรงกับสเปกที่แก้ — ยังไม่เริ่ม application/backend integration**
วันที่: 2026-10-01
Spec: [หน้าจอและธีม](../specs/mangmee-executive-business-ui-spec-th.md)
Backend: [มติธุรกิจและโครงหลังบ้าน](../specs/mangmee-executive-business-backend-spec-th.md)
Memory: [Executive business demo](../agent-memory/executive-business-demo.md)
ผลตรวจทาน: [หน้าจอ](../research/mangmee-executive-spec-review-ui-2026-10-01-th.md), [หลังบ้าน](../research/mangmee-executive-spec-review-backend-2026-10-01-th.md), [ข้อบกพร่องของต้นแบบ](../research/mangmee-executive-prototype-defects-2026-10-01-th.md)

## แก้ไขหลังการตรวจทานอิสระ 2026-10-01

| ส่วน | สิ่งที่เปลี่ยน | ข้อค้นพบ | เหตุผล |
|---|---|---|---|
| หัวเอกสาร | สถานะไม่ใช่ “เดโม v2” แล้ว | RU-28 | ต้นแบบผ่านหลายรอบหลัง v2 และสเปกเพิ่งแก้ |
| §2 | ลำดับงานใหม่ตามชุดหน้าเดียว (EX-01, EX-03A–D, EX-02, EX-04, EX-07/08) มีประตูก่อนเริ่ม และของใช้ร่วมที่ต้องมีก่อนหน้าแรก | RU-06, RU-02, RU-05, RU-07, RU-13 | ฉบับเดิมเขียน “EX-01/02/03” ซึ่งไม่ตรงกับหน้าที่ต้องสร้าง และไม่มีขั้นของเงิน URL และเมนู |
| §2.1 | รายการ “ห้ามยกจากต้นแบบ” | RU-24, RU-02, RU-04, RU-09 | ต้นแบบมีข้อมูลสมมติที่ดูเหมือนกติกา และมีโค้ดหน้าคำขอหลังสวิตช์ |
| §2 ข้อ 6 | การซ่อนหมายถึงไม่สร้าง และไม่มีสวิตช์ | RU-09 | กติกาเจ้าของ: ไม่มีสวิตช์เปิดปิดฟีเจอร์ |
| §3 | ชุดตรวจเริ่มที่ 390×844 และเพิ่มข้อตรวจการกดกลับ URL ตัวเลขที่ต้องตรงกัน ค่ายาว สี และการเข้าถึง | RU-01, RU-04, RU-05, RU-11, RU-14, RU-16, RU-23, RU-30 | ชุดเดิมตรวจจากจอใหญ่และไม่มีข้อเหล่านี้ |
| §3 | คำในชุดตรวจใช้คำชุดใหม่ | RU-27 | ให้ตรงกับเอกสารคำบนหน้าจอ |
| §1, §2, §3 (รอบสาม) | ประตูก่อนเริ่มอ้างรหัสข้อตัดสินใจ Q ของสเปกหลังบ้าน §21.2; เพิ่มขั้นช่องสำหรับรายงานในหน้าบริษัทของผู้ดูแล; การเทียบบริษัทเริ่มจากรายชื่อ; เลขหน้า 20 ต่อหน้า; สิทธิ์รายคนสองตัว | RU-03, RU-05, RU-19, RU-20, RU-22 | สเปกหลังบ้านแก้ตามผลตรวจทานแล้ว และเป็นสัญญาชุดเดียวที่หน้าจอใช้ |

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
- [x] ตรวจทานอิสระ 2026-10-01 และแก้เอกสารฝั่งหน้าจอทั้งหกฉบับให้ตรงกัน (ชุดหน้าเดียว กติกา URL กติกาตารางบนมือถือ นิยามตัวเลขเดียว)
- [ ] เจ้าของยืนยันข้อเสนอของหน้าจอ D2 และ D7 และข้อเสนอ Q10 ถึง Q33 ในทะเบียนของสเปกหลังบ้าน §21.2 ที่เปลี่ยนสิ่งที่หน้าจอแสดง (ตารางในสเปกหน้าจอ หัวข้อ “ข้อเสนอที่รอเจ้าของยืนยัน”)
- [ ] ผู้ดูแลต้นแบบแก้ต้นแบบและตัวตรวจตามเอกสารข้อบกพร่องของต้นแบบ (ไม่ใช่เงื่อนไขก่อนสร้างแอป แต่ก่อนนั้นห้ามใช้ต้นแบบเป็นเกณฑ์รับงาน)
- [ ] ตกลง logic/backend spec และ data/permission contracts
- [ ] Implement หน้าจอจริงและเชื่อมข้อมูล
- [ ] ผ่าน browser/theme/integration evidence

รายการที่ติ๊กแล้วข้างบนซึ่งอ้าง “เดโม v2” เป็นประวัติของรอบนั้น ไม่ใช่สถานะปัจจุบันของต้นแบบ

รอบแก้ consistency ปรับเอกสารและเดโมในพื้นที่ visualization; ไม่มี application route ใหม่ ไม่มี API/schema/migration และไม่มี deploy
เดโมใช้ components จริงโดย bundle แบบ local; locale ถูกตรึงเป็นไทยแทน session/localStorage ของ application
ผลทดสอบเดโมยืนยัน presentation ของ components ใน sandbox ไม่แทน system-shell/API integration

## 2. ลำดับ implementation หลังคุยหลังบ้าน

1. **ประตูก่อนเริ่ม** — ไม่เริ่มเขียนหน้าจนกว่าครบสามข้อ
   (ก) เจ้าของตอบข้อเสนอที่ขั้นนั้นใช้: D2 และ D7 ก่อนขั้นใด ๆ; Q29, Q30, Q31, Q32 ก่อน EX-01; Q18, Q19, Q26, Q27, Q28 ก่อน EX-02 และ EX-04; Q20, Q22, Q23, Q24, Q25 ก่อน EX-03A ถึง EX-03D; Q13, Q14, Q33 ก่อนแผงส่งออก; Q10, Q11, Q12, Q15 ก่อน EX-07/08
   (ข) สัญญาหลังบ้านที่หน้านั้นใช้ (สเปกหลังบ้าน §12.4 และ §16) มีการทำงานจริงให้เรียกได้ และสี่เรื่องที่สัญญายังไม่ได้เขียนไว้ชัดในสเปกหน้าจอ §13.1 ได้ข้อสรุป
   (ค) ผู้ดูแลระบบจัดประเภทบริษัทเดิมครบหนึ่งรอบ (Q16) ก่อนใช้ข้อมูลจริง; data-rights DEFERRED
   บันทึกสิ่งที่ตัดสินใน backend spec/plan และปรับคำในเอกสารคำบนหน้าจอหากนิยามเปลี่ยน

2. **ของใช้ร่วมก่อนหน้าแรก** — ใช้ system shell เดิม; เพิ่ม feature folder ของหน้าผู้บริหารและ thin routes ตาม pattern repo; reuse shared client, permission presentation, i18n และ components
   - ตัวจัดรูปแบบเงินตัวเดียว รับสตางค์เป็นจำนวนเต็ม คืน “1,234.50 บาท” พร้อม spec ของค่าติดลบ ศูนย์ และยอด 9 หลัก (สเปกหน้าจอ §4.3) ถ้าหน้าเว็บมีตัวกลางแล้วให้ใช้ตัวนั้น ถ้ายังไม่มีให้สร้างเป็นของกลางหนึ่งตัว ไม่แก้ `money()` ของหน้าเบิกจ่ายในงานนี้ และไม่ใช้ `formatBaht` ของหน้าทีมขาย
   - วันที่และเดือนใช้ `apps/web/src/common/i18n/thai-date.ts`
   - สถานะของหน้าใน URL ใช้ `apps/web/src/common/functions/list-query.ts` ตามสเปกหน้าจอ §3.2
   - ข้อความไทยของรหัสข้อผิดพลาดและรหัสเหตุผลทุกตัว ลงทะเบียนใน `apps/web/src/common/api/api-error-message.ts` ก่อนหน้าแรกใช้
   - ข้อความทุกจุดรวมไว้ที่เดียวตามเอกสารคำบนหน้าจอ ไม่ฝังใน JSX
3. **ประตูเข้า หน้าแรก และเมนู** ตามสเปกหน้าจอ §3.1: ประตูของ `apps/web/app/system/layout.tsx`, การกรองรายการของ `SystemHeader` สำหรับบัญชีผู้บริหาร, หน้าแรกหลังเข้าระบบใน `session-gate.logic.ts` และบัญชีผู้บริหารไม่เห็น “คำขอเกี่ยวกับข้อมูล” (RU-07 → RB-24)
   ช่องสำหรับรายงานสองช่องในหน้าบริษัทของผู้ดูแลระบบเดิม (ประเภทบริษัทสำหรับรายงาน และกลุ่มธุรกิจสำหรับรายงาน) ตามสเปกหน้าจอ §9.3 ทำในขั้นนี้ เพราะรายงานใช้ข้อมูลสองช่องนี้
4. **EX-01 ภาพรวม** ออกแบบที่ 390×844 ก่อน: การ์ด 4 ใบในจอแรก ตัวกรองร่วม เวลาของข้อมูล
5. **EX-02 รายชื่อ และ EX-04 รายละเอียด** ก่อนหน้าวิเคราะห์ เพราะเป็นปลายทางของการกดเจาะ: รายการแบบการ์ดบนมือถือ ค้นหา แบ่งหน้า 20 ต่อหน้า เรียง ช่องติ๊กเลือกสองบริษัทเพื่อเปรียบเทียบ และการกลับคืนสถานะเดิม
6. **ไม่สร้าง data-rights** — ซ่อนทุกทางเข้าของ executive: เมนู ปุ่ม case history และ saved routes; ไม่ query API11/API12 จากหน้าชุดนี้; integration และโครงช่วงคงข้อมูลพักไว้ทั้งหมด
   การซ่อนหมายถึง **ไม่สร้างหน้า ไม่มีโค้ดหน้าคำขอ และไม่มีสวิตช์เปิดปิด** ไม่ยกโค้ดส่วนคำขอจากต้นแบบไปแอป (RU-09)
7. **EX-03A การใช้งาน, EX-03B รายรับ, EX-03C ลูกค้าและที่มา** พร้อมการกดเจาะตามสเปกหน้าจอ §3.3 และกติกาสี §10.5
8. **EX-03D เปรียบเทียบ** สี่มิติ โดยการเทียบบริษัทรับสองบริษัทที่เลือกจากรายชื่อ และรูปแบบบล็อกบนมือถือ
9. **แผงส่งออก Excel** หลังฝั่งหลังบ้านประเมินตัวเขียนไฟล์เสร็จ (เอกสารส่งออก Excel §6) และตรวจการดาวน์โหลดบนมือถือจริง
10. **EX-07/08 บัญชีผู้บริหาร** ตามแบบแผนบัญชีทีมขายเดิม: รหัสผ่านชั่วคราวครั้งเดียว สถานะสี่ค่า สิทธิ์รายคนสองตัว และเหตุผลกับทุกคำสั่ง; ไม่ให้ผู้บริหารได้ System Admin หรือสิทธิ์ลบจากการสร้างบัญชี; ต้องเสร็จก่อนเปิดให้ผู้บริหารคนอื่นใช้
11. ตรวจ frontend-to-backend contract, loading/error/permission และ browser journey ตาม §3
    บันทึกคำสั่ง ผล และภาพของ application จริงก่อน handoff

ทุกขั้นทดสอบกับ fixtures ที่ระบุชัดในพื้นที่ทดสอบก่อนเชื่อมข้อมูลจริง ไม่ปล่อยตัวเลขเดโมใน production

### 2.1 ห้ามยกจากต้นแบบ

ต้นแบบใช้ดูแนวคิดและลำดับเนื้อหาได้ แต่สิ่งต่อไปนี้เป็นข้อมูลสมมติหรือทางลัดของต้นแบบ ไม่ใช่กติกา ห้ามคัดไปแอป (รายละเอียดและตำแหน่งในไฟล์อยู่ในเอกสารข้อบกพร่องของต้นแบบ):

- ตัวจัดรูปแบบเงินที่คืน “฿…” และข้อยืนยันของตัวตรวจที่ตรวจหา ฿
- รหัสบริษัทแบบ `MM###` และการแสดงหรือค้นด้วยรหัส
- การเก็บสถานะหน้าใน localStorage และฟังก์ชันกดเจาะที่เขียนทับตัวกรองร่วม
- เมนูมือถือแบบ dropdown และโครง sidebar ของต้นแบบ (แอปใช้ `SystemHeader` เดิม)
- โค้ดหน้าคำขอ ข้อมูลคำขอ และสวิตช์ `DATA_RIGHTS_ENABLED`
- ค่าธรรมเนียม 3%, สูตรกราฟแนวโน้ม, ช่วงใบเสร็จ 0/1–5/6+, จำนวนต่อหน้า 12 (แอปใช้ 20), คู่เปรียบเทียบเริ่มต้น, ช่วงเดือนที่เลือกได้ และเวลา “ข้อมูลถึง” ที่ตายตัว
- ชื่อแพ็กเกจและสถานะที่ต้นแบบตั้งเอง (“ทดลองใช้”, “ใช้งานได้ / หมดอายุ / เก็บถาวร” ในตัวกรองเดียว, บัญชี “เปิดใช้งาน / ระงับ” สองค่า)
- ตัวกรอง การจัดกลุ่ม และช่องของ “รูปแบบกิจการ” (ไม่อยู่ในรุ่นแรก — Q27) และช่อง “เข้าสู่ระบบล่าสุด” ช่องเดียว (แอปแยกเป็นเข้าเว็บล่าสุดกับใช้ผ่าน LINE ล่าสุด)
- กล่องสถานะที่ทำเอง (`Empty`) แทน component กลาง
- ชุดสีที่ประกาศเอง (สีน้ำเงินของส่วนที่กดได้ สีของตัวอย่างไฟล์ Excel) และตัวอย่างไฟล์บนแผงส่งออก
- ตาราง `Table` ที่อยู่ใน `mangmee-table-scroll`
- การสร้างบัญชีที่ใช้งานได้ทันที และการระงับด้วยการกดครั้งเดียว

ไม่มี dependency ใหม่สำหรับ dropdown/input/month picker
ห้ามแก้ `package.json` เพื่อเพิ่ม scripts หรือ metadata; ใช้ commands ที่มีอยู่
ก่อนเขียน Next.js code ให้อ่าน guide ใน installed Next.js ตาม `apps/web/AGENTS.md`

## 3. ชุดตรวจที่ต้องใช้

### Product / interaction

- ภาพรวม → เลือก industry/source/sales → รายชื่อ → detail → Back
- กดเจาะจากกราฟ ตาราง และการ์ด แล้วกลับ: จำนวนแถวและค่าการ์ดของหน้าต้นทางเท่ากับก่อนกดโดยไม่กด “ล้างตัวกรอง” ทั้งปุ่มกลับในหน้าและปุ่ม Back ของเบราว์เซอร์ (สเปกหน้าจอ §3.3)
- ตั้งตัวกรองร่วม → ไปหน้าเปรียบเทียบ → ดูรายชื่อฝั่งใดฝั่งหนึ่ง → กลับ → ไปหน้าอื่นทางเมนู: ตัวกรองร่วมยังอยู่
- โหลดใหม่และเปิดลิงก์ตรงของทุกหน้า ทุกแท็บ รายละเอียดบริษัท และแผงส่งออก ได้หน้าเดิม (สเปกหน้าจอ §3.2); คำค้นไม่อยู่ใน URL
- บัญชีผู้บริหารอย่างเดียว: เข้าระบบแล้วถึงหน้าภาพรวม เห็นเฉพาะกลุ่มเมนู “รายงานผู้บริหาร” ไม่เห็น “คำขอเกี่ยวกับข้อมูล” และเปิด URL ของหน้าผู้ดูแลระบบไม่ได้ (สเปกหน้าจอ §3.1)
- ตัวเลขรหัส N เดียวกันเท่ากันทุกหน้าและในไฟล์ Excel; จุดที่ต่างกันโดยชอบมีบรรทัดอธิบาย; “อย่างน้อย” ใช้แบบเดียวทุกที่ (สเปกหน้าจอ §4.2)
- วันแรกของเดือน: เดือนเริ่มต้น ป้าย “เดือนนี้ยังไม่จบ” และปุ่ม “ดูเดือนที่แล้ว” (สเปกหน้าจอ §4.1)
- ขอบกลุ่มที่ตัดกลางบริษัทที่จ่ายเท่ากัน อันดับที่ค่าเท่ากัน และกลุ่มที่มีบริษัทน้อยกว่า 10 ราย (เอกสารกราฟและอันดับ §4–§5)
- แยก “ไม่มีเซลล์ผู้แนะนำ” / “ไม่ระบุ” / “เซลล์ที่ได้รับยอดขายครั้งแรก”; signup คงรหัสเซลล์เฉพาะช่องทางเซลล์ตาม B6
- การชำระและใช้งาน: “จ่ายแล้ว ยังไม่เริ่มใช้” กลุ่มเดียว / “เคยใช้ แต่ไม่ใช้ในเดือน” / “จ่ายแล้ว ใช้งานในเดือน”;
  ไม่มีรอเปิดบริการซ้ำ และข้อมูลไม่พอเป็นหมายเหตุแยก ไม่จัดเป็นไม่ใช้
- การเคยจ่าย การจ่ายในเดือน และสิทธิ์ใช้งานปัจจุบันไม่ถูกใช้แทนกัน; แสดงปริมาณ/ความถี่จริง
- ค้นหาไทย/ชื่อซ้ำ, empty combination, pagination, เดือนก่อนสมัคร และข้อมูลขาด
- เปลี่ยนตัวกรองระหว่างอ่านข้อมูล: response เก่าไม่ทับ state ใหม่
- DEFERRED: รับคำร้องไม่เท่ากับอนุมัติ/ลบ; มีสิทธิ์อ่านไม่เท่ากับมีสิทธิ์จัดการ
- DEFERRED: โครงคำขอลบ: อนุมัติ → คงข้อมูลทั้งหมด 14 วัน → ครบกำหนด → ผลจริงแยกลบ/เก็บต่อ/ข้อยกเว้น
- สร้างบัญชี: ข้อมูลซ้ำ/สิทธิ์ไม่พอ/error/pending และไม่เพิ่ม tenant membership หรือสิทธิ์ลบโดยอัตโนมัติ; สิทธิ์ส่งออกและสิทธิ์ดูข้อมูลติดต่อตั้งเป็นรายคนแยกกัน; สถานะบัญชีสี่ค่า; ระงับต้องยืนยันและมีเหตุผล (สเปกหน้าจอ §9.2)
- ไม่มี ฿, THB, รหัสภายใน, คำระบบ, เดือนแบบ 2026-09 หรือคำในคอลัมน์ “คำที่เลิกใช้” ของเอกสารคำบนหน้าจอ ในข้อความที่แสดงทุกหน้าและทุกสถานะ
- ค่ายาวและค่าสุดขอบตามสเปกหน้าจอ §11.3: ชื่อ 120 ตัวอักษรไม่มีช่องว่าง, “อื่น ๆ” 200 ตัวอักษร, ยอด 9 หลัก, ยอดรับสุทธิติดลบ, ทุกบริษัทเป็น 0, บริษัทเดียว, ไม่มีบริษัท
- การเข้าถึง: แท็บบอกสถานะที่เลือกแบบไม่พึ่งสี; พื้นที่ประกาศของโปรแกรมอ่านหน้าจอจำกัดเฉพาะบรรทัดสรุปผล ไม่ครอบทั้งหน้า; ตารางมี caption และ scope; แถบกราฟที่กดได้มีชื่อที่ถูกอ่าน (RU-30)

### Theme matrix — ต้องเปิด control จริง

| Control | ภาพและพฤติกรรมที่ต้องเก็บ |
|---|---|
| Dropdown ทุกชนิด | closed, open, hover, selected, long label, disabled, empty search, keyboard, outside click, Escape, เปิดอีกเมนู |
| Dropdown ภายใน table/modal | portal ไม่ถูก clip, ตำแหน่งหลัง scroll/resize, ชิดขอบล่าง/ขอบขวาบนมือถือ |
| Text/search/textarea | empty, placeholder, filled, focus, error, disabled, readonly, autofill, ข้อความยาว |
| Month/date | popup ภายในธีม, locale/ปีถูก, ค่าเดิม/ล้าง/disabled ตามการใช้งาน |
| Buttons/tabs/status | brand accent, loading, disabled, focus, permission state |
| Layout | 390×844 ก่อน แล้ว 320/768/1024/1440px, zoom 200%, ภาษาไทย (รุ่นแรก — D7), OS dark setting |
| มือถือ 390×844 | การ์ด 4 ใบของภาพรวมอยู่ในจอแรก; ไม่มีองค์ประกอบใดกว้างเกินกรอบของตัวเอง รวมกรอบตาราง; ทุกสิ่งที่แตะได้สูงและกว้างอย่างน้อย 44 px; คำอธิบายตัวเลขไม่เล็กกว่า 14 px; ปุ่มหลักของแผงอยู่ในจอแรก (สเปกหน้าจอ §11.1) |
| ตารางและรายการ | ต่ำกว่า 768 px เป็นรายการแบบการ์ดและอ่านครบทุกค่าโดยไม่เลื่อนแนวนอน; ตั้งแต่ 768 px เป็นตารางความกว้างคงที่; ไม่มีตารางข้อความอิสระใน `mangmee-table-scroll` (สเปกหน้าจอ §11.2) |
| กราฟและสี | ภาพขาวดำของกราฟยังแยกกลุ่มได้; ส่วนที่ติดกันต่างกันอย่างน้อย 3:1; ไม่มีสีน้ำเงินในส่วนที่กดได้; ส่วน “ยังประเมินไม่ได้” ถูกวาดจริงอย่างน้อยหนึ่งกรณี (สเปกหน้าจอ §10.5) |

เก็บภาพ mobile 390×844 ของทุกหน้าก่อน แล้วจึง default page + dropdown เปิด + text focus/error/disabled
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
- ตรวจทานอิสระ 2026-10-01: ผล PASS ของ `check-demo.cjs`, `check-export.cjs` และ `check-analytics.ts` ยืนยันได้เฉพาะพฤติกรรมของต้นแบบรุ่นนั้น ตัวตรวจยืนยันรูปแบบเงิน “฿” และเดือน “2026-09” ซึ่งผิดกติกา เรียก reset หลังกดกลับจึงไม่เห็นตัวกรองค้าง และไม่ได้ตรวจตารางบนมือถือ จึงไม่ใช้เป็นเกณฑ์รับงานของแอป (RU-25)

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
- [ ] ในแอปจริง เมนูมือถือใช้ปุ่ม “เมนู” เดิมของ `SystemHeader` ไม่ใช้ dropdown ของต้นแบบ และชุดหน้าเป็นไปตามสเปกหน้าจอ §3 ซึ่งเอกสารโครงหน้าแก้ให้ตรงกันแล้ว (RU-06, RU-07)


## Export Excel — scope extension 2026-10-01

ตาม [Excel spec](../specs/mangmee-executive-excel-export-spec-th.md): local header action → scoped manifest/fixed Dashboard + source/sheet preview → simulated preparing/ready/error/expired; คง context เมื่อกลับและซ่อนจาก accounts
ออกแบบ API13 bounded binary request, read+export capability, immutable snapshot/all-row query และ typed multi-sheet XLSX โดยต่อยอด shared writer เดิม
ก่อน implement: ยืนยัน Q01 export grants / Q09 limits และ actual source gates; ตรวจ shared writer backward compatibility, source definitions และ all-page membership
ตรวจ local EXL01–09 และ existing navigation suite; EXL10–12 ต้องตรวจ backend/workbookจริงภายหลัง. ไม่เพิ่ม dependencies/app code/cloud mutations รอบออกแบบ
หลังการตรวจทานอิสระ 2026-10-01: แผงของแอปจริงไม่มีตัวอย่างไฟล์ (Excel spec §2 ข้อ 6) หัวคอลัมน์และค่าเป็นภาษาไทยตาม §4.1 เพดานและบันทึกการส่งออกตาม §5 สิทธิ์ส่งออกเป็นรายบัญชีตาม §6 และเพิ่ม EXL-16 ถึง EXL-20 ซึ่งต้องตรวจกับไฟล์จริงทั้งหมด


### Owner template amendment — Excel Dashboard v4

Ownerระบุ `outputs/company-infographic-20261001/company-receipts-dashboard-v4.xlsx` เป็นแม่แบบตาม [Excel spec §8](../specs/mangmee-executive-excel-export-spec-th.md#8-แม่แบบและหลักฐานตรวจอ่าน-2026-10-01)
มตินี้แทนsummary-only/optional-company/values-only: ค่าเริ่มต้นเป็นDashboardเขียว–ทอง + nativecharts/สูตร + รายบริษัทที่เป็นsource, 2ชีตหลัก; ตารางคำนวณใต้Dashboardและmetadataในsource
ต้องแยกsource28ก.ย.ของแม่แบบจากfictional30ก.ย.ของเดโม; ไม่ยกสูตรblank=0หรือreceiptทุกสถานะมาเปลี่ยนBE Q03โดยปริยาย
API13รับtemplateKeyแทนincludeCompanies; serverเลือกversion/hash. XG03ต้องตรวจnativechart/formula/cache/renderเพิ่ม; writerเดิมsingle-sheetยังทำไม่ได้
EXL13–14เพิ่มintegrationacceptance; baseline188/47deferredไม่เปลี่ยนและไม่มีgapimplementationปิดจากการอ่านแม่แบบ. ไม่แก้ไฟล์อ้างอิงและไม่สร้างXLSXใหม่รอบนี้
แม่แบบที่จะเก็บใน repository ต้องสร้างใหม่จากข้อมูลสมมติ ไม่ใช่ไฟล์ของ Owner ที่ตัดแถวออก และ server ต้องเขียนค่าที่คำนวณแล้วของทุกสูตร (Excel spec §8, RB-27)


## ตรวจคำและนำเข้ากิ่งหลัก — 2026-10-01

- [x] ตรวจข้อความทุกหน้าที่เปิดในต้นแบบ รวมส่งออกและข้อความสำหรับโปรแกรมอ่านหน้าจอ ตาม plain-language spec
- [x] เก็บต้นแบบที่มีแต่ข้อมูลสมมติไว้ใน `docs/prototypes/mangmee-executive/` พร้อมคำสั่งสร้างและตรวจที่ใช้ได้จาก repo
- [x] ตรวจ browser ทุกหน้า/ธีม/ตัวกรอง/ตัวเลข และคำใน Excel ให้ตรงกัน
- [ ] นำเฉพาะเอกสารและต้นแบบส่วนผู้บริหารเข้า main/develop ผ่าน PR และ CI; ไม่รวมไฟล์ลูกค้าจริงหรืองานค้างของส่วนอื่น

ขอบเขตนี้ไม่เริ่ม application/API implementation และไม่ deploy UAT/Production
