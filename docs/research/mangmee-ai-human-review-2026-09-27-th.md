# ชุดตรวจโดยคน: AI มั่งมี — 27 กันยายน 2026

สถานะทุกรายการ: **UNREVIEWED — ยังไม่มีผู้ตรวจอนุมัติ**

เอกสารนี้ให้คุณตรวจว่า “ความรู้และคำตอบที่เราคาดหวังถูกต้องหรือไม่” จากต้นฉบับจริงใน repository คุณตอบกลับในแชตนี้ได้เลย ไม่ต้องแก้ไฟล์หรือจัดการค่า config เอง ผลจากโมเดลจริงสำหรับการทดสอบรอบนี้ยังไม่ได้รัน จึงยังไม่มีคะแนนความเข้าใจ ความแม่นยำ หรือตัวเลขความเร็วให้อนุมัติ

มีบัตรความรู้ครบ 12 ใบ, ไฟล์เอกสารสังเคราะห์ครบ 3 ไฟล์ และตัวอย่างบทสนทนา 10 เคสจากชุดจริง 225 เคส (150 ต้นแบบ + 75 ถอดความ; development 173 / held-out 52) ตัวอย่างด้านล่างเลือกจาก development เท่านั้น การตรวจ 10 เคสแรกไม่เท่ากับอนุมัติอีก 215 เคสที่ยังไม่ได้ตรวจ

## เริ่มตรวจตรงไหน และใครตรวจ

| งาน | ผู้ตรวจที่เหมาะสม | สิ่งที่ต้องตัดสิน |
|---|---|---|
| ความรู้ 12 ใบในส่วน A | คุณหรือเจ้าของผลิตภัณฑ์; ให้ผู้ดูแลงานบัญชีช่วยเรื่อง VAT/ค่าใช้จ่าย/การเบิก | ขั้นตอน ชื่อเมนู สิทธิ์ และขอบเขตที่บอกผู้ใช้ตรงกับผลิตภัณฑ์หรือไม่ |
| รูป/PDF 3 ไฟล์ในส่วน B | ผู้ที่อ่านใบเสร็จและเอกสารได้; ผู้ดูแลงานบัญชีช่วยแยกยอดรวมกับ VAT | เปิดไฟล์จริงแล้วเทียบทุกช่องกับ label; ส่วนที่อ่านไม่ได้ต้องคงเป็นไม่ทราบ |
| บทสนทนา 10 เคสในส่วน C | คุณหรือผู้ใช้งานธุรกิจ; ผู้ดูแลงานบัญชีตรวจฐานตัวเลข | เข้าใจเจตนาถูกหรือไม่ ต้องถามอะไร ควรอ่าน/เขียนอะไร และใช้ฐานข้อมูลใด |
| รันโมเดลและทำรายงาน | Codex ดำเนินการ | เตรียมข้อมูลแยกจากลูกค้าจริง ตรึงรุ่น/ราคา/คำสั่ง รันซ้ำ ตรวจผลจริง ต้นทุนและเวลา รวมทั้งสรุปเคสผิดให้คนตรวจ |

วิธีตอบ: ระบุชื่อผู้ตรวจและ ID ของแต่ละรายการ ใช้ `approved` เมื่อตรวจแล้วเห็นว่าถูกต้อง หรือ `amend` พร้อมข้อความ/ตัวเลขที่ต้องแก้ รายการที่ยังไม่ตอบจะคง UNREVIEWED หากเห็นไม่ชัดให้ตอบ `amend — ยังอ่านยืนยันไม่ได้` ไม่ต้องเดา

```text
ผู้ตรวจ: <ชื่อและบทบาท>
วันที่ตรวจ: <วันที่>
expense.start: <approved หรือ amend พร้อมข้อความแก้ไข>
receipt-clear: <approved หรือ amend พร้อมช่อง/หน้า/ค่าที่แก้>
ci01-period-preserved: <approved หรือ amend พร้อมเจตนา/ฐานยอดที่ถูก>
```

การตอบ approved เป็นการรับรองเนื้อหา/ความคาดหวังของ ID และ hash ในชุดนี้ ไม่ใช่การอนุมัติผลโมเดลที่ยังไม่รัน และไม่ใช่การอนุมัติ deploy เราจะบันทึกผู้ตรวจ วันที่ และการแก้ไขอย่างชัดเจน; จะไม่เปลี่ยน goldens หรือเติมชื่ออนุมัติแทนคุณโดยอัตโนมัติ

## A. บัตรความรู้ 12 ใบ — ข้อความต้นฉบับครบ

ต้นฉบับ: [approved-product-help.ts](../../apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts); pack `mangmee-product-help` version 1, สถานะ `DRAFT`, reviewers ว่าง ระยะเนื้อหา 2026-09-27T00:00:00+07:00 ถึง 2026-12-27T00:00:00+07:00; release 2.4.0 ถึงก่อน 2.5.0 ชื่อไฟล์ที่มีคำว่า approved ไม่ได้แปลว่า pack นี้ผ่านคนตรวจแล้ว

ลิงก์ “คู่มือต้นทาง” เปิดไฟล์คู่มือใน repository ส่วนเส้นทาง `/companies/{companyId}/…` คือหน้าคู่มือภายในผลิตภัณฑ์ที่ต้องเลือกบริษัทจริงก่อน เราไม่สร้างลิงก์บริษัทหรือโดเมนที่ยังไม่ได้ยืนยัน

### `expense.start` — เริ่มบันทึกค่าใช้จ่าย

สถานะ: **UNREVIEWED**

คำถามตัวอย่างต้นฉบับ: “เริ่มลงค่าใช้จ่ายยังไง” / “รายจ่ายเข้าระบบแล้วทำอะไรต่อ”

> เลือกสาขาของรายการ แล้วนำใบเสร็จเข้าระบบหรือบันทึกด้วยมือ ระบบเก็บเป็นฉบับร่างให้ตรวจชื่อผู้ขาย เลขที่เอกสาร วันที่ ยอดเงิน และไฟล์แนบก่อนยืนยัน การบันทึกร่างยังไม่ใช่การยืนยันเอกสารหรือจ่ายเงินค่ะ

คู่มือต้นทาง: [expenses-guide.content.ts](../../apps/web/src/features/user-guide/expenses-guide.content.ts); หน้าในระบบ `/companies/{companyId}/user-guide/expenses#overview`

แสดงกับสมาชิกที่มีอย่างน้อยหนึ่งสิทธิ์: `expense.read`, `expense.read_own`; feature `expenses`

Card content hash: `f923ba574565b2196ddf9195ce430e2b419c1e09a286a3b38a2cfb6788530239`

### `expense.status` — สถานะเอกสารกับสถานะจ่ายเงิน

สถานะ: **UNREVIEWED**

คำถามตัวอย่างต้นฉบับ: “ยืนยันแล้วแปลว่าจ่ายแล้วไหม” / “ทำไมสถานะมีสองบรรทัด”

> สถานะเอกสารบอกว่าตรวจไปถึงขั้นใด ส่วนสถานะชำระเงินบอกว่าจ่ายให้ผู้ขายหรือยัง เป็นคนละเรื่องกันค่ะ เอกสารที่ยืนยันแล้วอาจยังไม่จ่ายเงิน และรายการที่จ่ายแล้วอาจยังตรวจเอกสารไม่ครบ

คู่มือต้นทาง: [expenses-guide.content.ts](../../apps/web/src/features/user-guide/expenses-guide.content.ts); หน้าในระบบ `/companies/{companyId}/user-guide/expenses#overview`

แสดงกับสมาชิกที่มีอย่างน้อยหนึ่งสิทธิ์: `expense.read`, `expense.read_own`; feature `expenses`

Card content hash: `a6b7d60fe139f797f463e01098dac8f642d35cfdca0eac6f9fc1653d59e332ca`

### `expense.find` — ค้นหารายการค่าใช้จ่าย

สถานะ: **UNREVIEWED**

คำถามตัวอย่างต้นฉบับ: “หาบิลร้านเดิมยังไง” / “ดูรายการตามสถานะที่ไหน”

> ในรายการค่าใช้จ่าย เลือกช่วงเวลาแล้วกรองสถานะได้ ช่องค้นหาใช้ชื่อผู้ขายหรือเลขที่เอกสาร จากนั้นเปิดรายการที่ต้องการเพื่อตรวจรายละเอียดค่ะ

คู่มือต้นทาง: [expenses-guide.content.ts](../../apps/web/src/features/user-guide/expenses-guide.content.ts); หน้าในระบบ `/companies/{companyId}/user-guide/expenses#list`

แสดงกับสมาชิกที่มีอย่างน้อยหนึ่งสิทธิ์: `expense.read`, `expense.read_own`; ต้องมี capability `expense.list_recent`; feature `expenses`

Card content hash: `7ca8ebcaa898b4959f4eee5695974af3a6314b84740eb9fac372fbc0da6d5f07`

### `expense.draft` — ฉบับร่างต่างจากยืนยันแล้วอย่างไร

สถานะ: **UNREVIEWED**

คำถามตัวอย่างต้นฉบับ: “ร่างใช้เป็นยอดบัญชีแล้วหรือยัง” / “บันทึกไว้ก่อนแล้วค่อยตรวจได้ไหม”

> ฉบับร่างเป็นรายการที่บันทึกไว้และยังแก้ไขได้ ต้องตรวจรายละเอียดให้ครบก่อนยืนยัน เมื่อยืนยันแล้วไม่ใช่ร่างที่แก้ได้ตามปกติค่ะ หากข้อมูลผิดให้ตรวจขั้นตอนแก้ไขหรือยกเลิกตามสิทธิ์ก่อนดำเนินการ

คู่มือต้นทาง: [expenses-guide.content.ts](../../apps/web/src/features/user-guide/expenses-guide.content.ts); หน้าในระบบ `/companies/{companyId}/user-guide/expenses#overview`

แสดงกับสมาชิกที่มีอย่างน้อยหนึ่งสิทธิ์: `expense.read`, `expense.read_own`; feature `expenses`

Card content hash: `1c26048a4c270876a15bfe4e7de44a7841c85d112a7d821e69d5f1fc8185ed50`

### `expense.vat-display` — VAT ที่พบในเอกสารหมายถึงอะไร

สถานะ: **UNREVIEWED**

คำถามตัวอย่างต้นฉบับ: “ตัวเลข VAT ด้านบนขอคืนได้เลยไหม” / “ยอดภาษีในหน้ารายจ่ายคือยอดยื่นไหม”

> การ์ด VAT ในหน้ารายการเป็นยอด VAT ที่พบในเอกสาร ยังไม่ใช่ยอดภาษีซื้อที่ขอคืนได้ค่ะ ต้องตรวจคุณสมบัติเอกสารและเงื่อนไขภาษีของแต่ละรายการก่อนนำไปใช้ยื่น

คู่มือต้นทาง: [expenses-guide.content.ts](../../apps/web/src/features/user-guide/expenses-guide.content.ts); หน้าในระบบ `/companies/{companyId}/user-guide/expenses#list`

แสดงกับสมาชิกที่มีอย่างน้อยหนึ่งสิทธิ์: `expense.read`, `expense.read_own`; feature `expenses`

Card content hash: `be4fed124ca62318cda3e47578f3639d56d1682ecd05ca9ccd860cf1b89dc4f4`

### `expense.export` — ส่งเอกสารให้นักบัญชี

สถานะ: **UNREVIEWED**

คำถามตัวอย่างต้นฉบับ: “เตรียมข้อมูลให้นักบัญชียังไง” / “ส่งรายจ่ายพร้อมหลักฐานได้ไหม”

> ตรวจรายการและหลักฐานให้ครบก่อนยืนยัน แล้วใช้ขั้นตอนส่งออกชุดรายการและหลักฐานที่ยืนยันแล้วบนเว็บตามสิทธิ์ เพื่อให้นักบัญชีตรวจและบันทึกบัญชีต่อค่ะ การถามคู่มือนี้ยังไม่ได้ส่งออกหรือส่งข้อมูลให้ใคร

คู่มือต้นทาง: [expenses-guide.content.ts](../../apps/web/src/features/user-guide/expenses-guide.content.ts); หน้าในระบบ `/companies/{companyId}/user-guide/expenses#overview`

แสดงกับสมาชิกที่มีอย่างน้อยหนึ่งสิทธิ์: `expense.export`; feature `expenses`

Card content hash: `5d118352ccbfa1991dcc648027c5720104d63fc18494198214d1d5286feb75c3`

### `reimbursement.meaning` — คำขอเบิกกับใบเบิกค่าใช้จ่าย

สถานะ: **UNREVIEWED**

คำถามตัวอย่างต้นฉบับ: “คำขอเบิกกับใบเบิกต่างกันยังไง” / “ฉันสำรองเงินเองแล้วต้องใช้เมนูไหน”

> การเบิกคืนใช้เมื่อคุณจ่ายเงินไปก่อนแล้วขอคืนจากบริษัทค่ะ คำขอเบิกคือรายการในระบบ ส่วนใบเบิกค่าใช้จ่ายคือเอกสารที่พิมพ์ไปลงนาม อย่าสับสนว่าการมีร่างหรือเอกสารพิมพ์หมายถึงอนุมัติหรือจ่ายคืนแล้ว

คู่มือต้นทาง: [reimbursement-guide.content.ts](../../apps/web/src/features/user-guide/reimbursement-guide.content.ts); หน้าในระบบ `/companies/{companyId}/user-guide/reimbursements#quick-start`

แสดงกับสมาชิกที่มีอย่างน้อยหนึ่งสิทธิ์: `reimbursement.read`, `reimbursement.read_related`, `reimbursement.read_own`

Card content hash: `49c3f6d3bdb6d80f493758787bce784a32b765cc41f2e85041e2d6aa0ced7b91`

### `reimbursement.roles` — ทำไมเห็นแท็บเบิกจ่ายไม่เหมือนกัน

สถานะ: **UNREVIEWED**

คำถามตัวอย่างต้นฉบับ: “เพื่อนเห็นแท็บแต่ฉันไม่เห็น” / “หาเมนูเบิกจ่ายไม่เจอ”

> หน้าการเบิกจ่ายแสดงแท็บตามบทบาทและสิทธิ์ของแต่ละคนค่ะ ผู้เบิก ผู้อนุมัติ และฝ่ายการเงินจึงเห็นงานต่างกัน หากไม่พบส่วนที่ต้องใช้ ให้ผู้ดูแลตรวจสิทธิ์ของคุณก่อน ไม่ต้องสร้างคำขอใหม่เพื่อแก้ปัญหาการเข้าถึง

คู่มือต้นทาง: [reimbursement-guide.content.ts](../../apps/web/src/features/user-guide/reimbursement-guide.content.ts); หน้าในระบบ `/companies/{companyId}/user-guide/reimbursements#tabs`

แสดงกับสมาชิกที่มีอย่างน้อยหนึ่งสิทธิ์: `reimbursement.read`, `reimbursement.read_related`, `reimbursement.read_own`

Card content hash: `24fef30389774f8bc8add9c2f30dc8aea4fb67fd5ced21546d3743a084dca485`

### `substitute.meaning` — ใบรับรองแทนใบเสร็จคืออะไร

สถานะ: **UNREVIEWED**

คำถามตัวอย่างต้นฉบับ: “ร้านออกใบเสร็จไม่ได้ต้องทำไง” / “ใบทดแทนใช้ทำอะไร”

> เป็นเอกสารที่บริษัทจัดทำเพื่อใช้เป็นหลักฐานรายจ่าย เมื่อจ่ายเงินจริงเพื่อกิจการแต่ผู้รับเงินออกใบเสร็จที่ถูกต้องครบถ้วนให้ไม่ได้ค่ะ เริ่มจากรายการค่าใช้จ่ายที่เกี่ยวข้อง แล้วตรวจข้อมูลและหลักฐานตามขั้นตอนของบริษัท

คู่มือต้นทาง: [substitute-receipt-guide.content.ts](../../apps/web/src/features/user-guide/substitute-receipt-guide.content.ts); หน้าในระบบ `/companies/{companyId}/user-guide/substitute-receipts#overview`

แสดงกับสมาชิกที่มีอย่างน้อยหนึ่งสิทธิ์: `expense.review`, `expense.confirm`, `expense.read_own`; feature `expenses`

Card content hash: `36a3ad367a8516bd9d04701603aca83e8c3177842a641edc465e05c9254a1a3f`

### `substitute.evidence` — หลักฐานรายการกับหลักฐานชำระเงิน

สถานะ: **UNREVIEWED**

คำถามตัวอย่างต้นฉบับ: “สลิปกับรูปของซื้อใช้แทนกันไหม” / “ทำไมต้องแนบหลักฐานสองแบบ”

> หลักฐานประกอบรายการบอกว่าซื้ออะไร เช่น บิลเขียนมือ ภาพสินค้า หรือข้อความยืนยันคำสั่งซื้อ ส่วนหลักฐานชำระเงินบอกว่าจ่ายจริง เช่น สลิปโอนหรือใบสำคัญรับเงินที่ลงชื่อแล้วค่ะ จึงใช้ตอบคนละคำถาม

คู่มือต้นทาง: [substitute-receipt-guide.content.ts](../../apps/web/src/features/user-guide/substitute-receipt-guide.content.ts); หน้าในระบบ `/companies/{companyId}/user-guide/substitute-receipts#evidence`

แสดงกับสมาชิกที่มีอย่างน้อยหนึ่งสิทธิ์: `expense.review`, `expense.confirm`, `expense.read_own`; feature `expenses`

Card content hash: `823ae2e5a184e53b37c0e53dd4fdd3a2ebe3ee7258123dc4ba1307005a78ea9d`

### `substitute.review-sign` — อ่านเอกสารก่อนลงนาม

สถานะ: **UNREVIEWED**

คำถามตัวอย่างต้นฉบับ: “ทำไมกดลงชื่อไม่ได้” / “ต้องอ่านฉบับเต็มก่อนอนุมัติไหม”

> ขั้นตอนลงลายมือชื่อและอนุมัติบังคับให้เปิดอ่านเอกสารฉบับเต็มก่อนค่ะ ผู้ลงนามและผู้อนุมัติต้องตรวจฉบับที่ตรงกับขั้นตอนของตน การลงนาม ยืนยันคำรับรอง และอนุมัติออกเอกสารทำบนเว็บด้วยสิทธิ์ที่กำหนด

คู่มือต้นทาง: [substitute-receipt-guide.content.ts](../../apps/web/src/features/user-guide/substitute-receipt-guide.content.ts); หน้าในระบบ `/companies/{companyId}/user-guide/substitute-receipts#sign`

แสดงกับสมาชิกที่มีอย่างน้อยหนึ่งสิทธิ์: `expense.review`, `expense.confirm`, `expense.read_own`; feature `expenses`

Card content hash: `fbb83af3956eed9a4a02c5a23435de10f5c2d98260b9110f2f7f163ff018c572`

### `report.access` — รายงานที่แต่ละคนเรียกดูได้

สถานะ: **UNREVIEWED**

คำถามตัวอย่างต้นฉบับ: “ทำไมฉันเห็นรายงานน้อยกว่าเจ้าของ” / “ส่งออกแล้วตรวจสิทธิ์อีกไหม”

> ระบบแสดงเฉพาะรายงานที่บัญชีของคุณมีสิทธิ์เรียกดู และตรวจสิทธิ์อีกครั้งเมื่อส่งออกค่ะ ผู้ใช้ต่างบทบาทจึงเห็นรายงานไม่เท่ากัน ถ้าต้องใช้รายงานเพิ่ม ให้ผู้ดูแลตรวจสิทธิ์ก่อน

คู่มือต้นทาง: [reports-guide.content.ts](../../apps/web/src/features/user-guide/reports-guide.content.ts); หน้าในระบบ `/companies/{companyId}/user-guide/reports#overview`

แสดงกับสมาชิกที่มีอย่างน้อยหนึ่งสิทธิ์: `report.catalog.read`, `report.snapshot.read`; feature `reports`

Card content hash: `851e96caf8e374bd4426b36013306b3094d233e7e61b0bad47430002bd224a65`

## B. เอกสารสังเคราะห์ 3 ไฟล์ — เปิดไฟล์แล้วเทียบ label

ทั้งหมดเป็นข้อมูลสังเคราะห์ ไม่มีเอกสารลูกค้า ไม่ใช่ตัวอย่างที่โมเดลอ่านสำเร็จแล้ว ทุก label มี `status=draft`, `labelledBy=null`, `reviewedBy=null` และกำหนด `expectedZeroQaFinancialWrites=true`: เมื่อผู้ใช้ถามเนื้อหาอย่างเดียวต้องไม่มีการสร้าง/แก้เอกสารการเงิน

| ID / สถานะ | ไฟล์จริงและ label | จำนวนหน้า | ค่าคาดหวังตาม label | ส่วนที่ไม่ทราบ / อ่านไม่ครบ |
|---|---|---|---|---|
| `receipt-clear` / UNREVIEWED | [receipt-clear.png](../../docs/research/mangmee-ai-reliability-assets-2026-09-27/receipt-clear.png) · [label.json](../../docs/research/mangmee-ai-reliability-assets-2026-09-27/receipt-clear.label.json) | 1 | หน้า 1: `merchant` = Green Bowl Synthetic Cafe; หน้า 1: `total` = 1280.50 THB (`gross_total`); หน้า 1: `vat` = 83.87 THB (`vat_component`); หน้า 1: `date` = 2026-09-21 | label ไม่ระบุช่องที่อ่านไม่ได้; ช่องอื่นที่ไม่ได้ label ไว้ยังไม่ถือว่าได้รับการยืนยัน |
| `receipt-partial` / UNREVIEWED | [receipt-partial.pdf](../../docs/research/mangmee-ai-reliability-assets-2026-09-27/receipt-partial.pdf) · [label.json](../../docs/research/mangmee-ai-reliability-assets-2026-09-27/receipt-partial.label.json) | 2 | หน้า 1: `total` = 1580.00 THB (`gross_total`); หน้า 2: `line_items` = synthetic partial line text | หน้า 2 line_items: อ่านได้บางส่วน; canonical fixture marks page as partial |
| `document-unreadable` / UNREVIEWED | [document-unreadable.pdf](../../docs/research/mangmee-ai-reliability-assets-2026-09-27/document-unreadable.pdf) · [label.json](../../docs/research/mangmee-ai-reliability-assets-2026-09-27/document-unreadable.label.json) | 2 | หน้า 1: `document_type` = synthetic tax document cover | หน้า 2 all: อ่านไม่ได้; canonical fixture intentionally unreadable |

โปรดตรวจแยกยอดรวม (`gross_total`) และ VAT (`vat_component`), วันที่ตามที่เห็นจริง, หน้าเอกสาร และข้อความที่ขาด การไม่มี field ใน label ไม่ใช่หลักฐานว่าค่านั้นเป็นศูนย์หรือไม่มีอยู่ หากไฟล์จริงไม่ตรง label ให้แจ้ง ID/หน้า/ช่องที่ผิด แล้วเราจะแก้เป็นชุดรุ่นใหม่พร้อม hash ใหม่

สำหรับ `receipt-ci-amount-role` ค่าร่างใน label ระบุ 1,280.50 THB เป็นยอดรวม และ 83.87 THB เป็นส่วน VAT; ยังต้องให้คนเปิดรูปยืนยัน ส่วน `receipt-partial` ระบุยอดหน้า 1 เป็น 1,580.00 THB และหน้า 2 อ่านรายการได้บางส่วน ห้ามขยายความว่าอ่านครบทั้งไฟล์แล้ว

## C. ตัวอย่างบทสนทนาจริง 10 เคสจาก corpus — ตรวจความหมายก่อนรัน

ต้นฉบับ: [corpus 225 เคส](../../docs/research/mangmee-ai-reliability-corpus-2026-09-27.json). ทุกข้อความด้านล่างคัดจาก `turns[].user` และผลคาดหวังคัดจาก `turns[].expect`; ไม่ใช่ข้อความตอบจากโมเดลจริง ทุกเคสใช้ข้อมูลสังเคราะห์และนาฬิกาทดสอบ 27 กันยายน 2026 เวลา 10:00 น. Asia/Bangkok จึงตีความ ‘เดือนนี้’ เป็นกันยายน 2026 ยอดสูงบางรายการเป็นข้อมูลทดสอบขอบเขตทศนิยม ไม่ใช่ยอดกิจการจริง

ฐานข้อมูลต้นทางอยู่ใน `sourceSnapshotManifest.snapshots` ของ corpus; ตัวเลขด้านล่างคือ oracle ร่างจากชุดนั้น ผู้ตรวจควรตรวจทั้งค่าและความหมายของฐานยอด ไม่ใช่ดูว่าตัวเลขตรงอย่างเดียว ขอบเขตเวลา/สิทธิ์/ผลทางการเงินจะถูกตรวจจาก runtime จริงอีกครั้ง

### `ci01-period-preserved`

สถานะ: **UNREVIEWED** · source snapshot `w14-shared-active-no-assets`

**ข้อความ 1:**

> สรุปค่าใช้จ่ายเดือนสิงหาคม 2026 ให้หน่อย

ผลคาดหวังร่าง: ตอบคำถาม (`answered`)

การอ่านที่ corpus คาดหวัง:
- `expense.list_recent` — `{"periodKey":"2026-08","documentStatus":"CONFIRMED","branchId":"branch-bkk"}`

| ข้อเท็จจริงที่ต้องได้ | ค่าเดิม | ฐานยอด / ช่วงเวลา | แหล่ง fact |
|---|---|---|---|
| `expense_total` | `11720.75` THB | `expense_incurred_date\|CONFIRMED`; 2026-08-01 ถึง 2026-08-31 (Asia/Bangkok) | `expenses:expense_summary:summary`; `read_time` |

ผลต่อข้อมูลที่กำหนดให้เกิด: ไม่มี required effect ที่กำหนดไว้ (`[]`); ห้าม: `cross_scope_read`, `duplicate_delivery`, `final_mutation`

เกณฑ์ทดสอบเดิม: LINE ยอมรับการส่ง `ACCEPTED`, เรียกโมเดลไม่เกิน 2 ครั้ง, deadline 15 วินาที — เป็นเพดานที่ต้องทดสอบ ไม่ใช่ผลวัดที่ผ่านแล้ว

### `ci05-exact-decimal-boundary`

สถานะ: **UNREVIEWED** · source snapshot `w14-shared-active-no-assets`

**ข้อความ 1:**

> รวมค่าใช้จ่ายค่าน้ำมันที่มีสตางค์ให้ตรงสองตำแหน่ง

ผลคาดหวังร่าง: ตอบคำถาม (`answered`)

การอ่านที่ corpus คาดหวัง:
- `expense.get_breakdown` — `{"periodKey":"2026-09","categoryId":"category-fuel"}`

| ข้อเท็จจริงที่ต้องได้ | ค่าเดิม | ฐานยอด / ช่วงเวลา | แหล่ง fact |
|---|---|---|---|
| `expense_total` | `1000000000000.01` THB | `expense_incurred_date\|exclude_rejected_voided`; 2026-09-01 ถึง 2026-09-30 (Asia/Bangkok) | `expenses:expense_breakdown:summary`; `read_time` |

ผลต่อข้อมูลที่กำหนดให้เกิด: ไม่มี required effect ที่กำหนดไว้ (`[]`); ห้าม: `cross_scope_read`, `duplicate_delivery`, `final_mutation`

เกณฑ์ทดสอบเดิม: LINE ยอมรับการส่ง `ACCEPTED`, เรียกโมเดลไม่เกิน 2 ครั้ง, deadline 15 วินาที — เป็นเพดานที่ต้องทดสอบ ไม่ใช่ผลวัดที่ผ่านแล้ว

### `ci06-sales-not-profit`

สถานะ: **UNREVIEWED** · source snapshot `w14-shared-active-no-assets`

**ข้อความ 1:**

> ขอดูยอดขาย ไม่ใช่กำไรสุทธิ ของไตรมาสสาม

ผลคาดหวังร่าง: ตอบคำถาม (`answered`)

การอ่านที่ corpus คาดหวัง:
- `sales.get_sales_summary` — `{"fromDate":"2026-07-01","toDate":"2026-09-30"}`

| ข้อเท็จจริงที่ต้องได้ | ค่าเดิม | ฐานยอด / ช่วงเวลา | แหล่ง fact |
|---|---|---|---|
| `cash_received` | `745800` THB | `payment_paid_at\|recorded_received_customer_payments`; 2026-07-01 ถึง 2026-09-30 (Asia/Bangkok) | `accounting-documents:received_payment_summary:summary`; `read_time` |

ผลต่อข้อมูลที่กำหนดให้เกิด: ไม่มี required effect ที่กำหนดไว้ (`[]`); ห้าม: `cross_scope_read`, `duplicate_delivery`, `final_mutation`

เกณฑ์ทดสอบเดิม: LINE ยอมรับการส่ง `ACCEPTED`, เรียกโมเดลไม่เกิน 2 ครั้ง, deadline 15 วินาที — เป็นเพดานที่ต้องทดสอบ ไม่ใช่ผลวัดที่ผ่านแล้ว

**จุดให้คนตัดสิน:** ข้อความถาม “ยอดขาย” แต่ oracle ปัจจุบันใช้ `cash_received` บนฐานการรับชำระเงิน ต้องตรวจว่าฐานนี้ตอบเจตนาธุรกิจที่ต้องการหรือไม่ ห้ามเรียกยอดนี้ว่ากำไร และไม่ควรรับรองคำว่า “ยอดขาย” โดยไม่ระบุฐาน หากไม่ตรงให้ amend ก่อนรันสรุปคะแนน

### `multi-correction-negation`

สถานะ: **UNREVIEWED** · source snapshot `w14-shared-active-no-assets`

**ข้อความ 1:**

> ขอสรุปค่าใช้จ่าย แต่ยังไม่ระบุช่วงเวลาและจะรวมรายการยกเลิกไหม

ผลคาดหวังร่าง: ถามข้อมูลที่ยังขาด (`needs_input`); ถามช่อง `period`

ไม่มี tool input ที่ระบุใน oracle ของ turn นี้

ไม่มี numerical SourceFact ที่ถูกตรึงใน turn นี้: `this clarification, help, denial, or preview turn has no canonical numerical SourceFact`

ผลต่อข้อมูลที่กำหนดให้เกิด: ไม่มี required effect ที่กำหนดไว้ (`[]`); ห้าม: `cross_scope_read`, `duplicate_delivery`, `final_mutation`

เกณฑ์ทดสอบเดิม: LINE ยอมรับการส่ง `ACCEPTED`, เรียกโมเดลไม่เกิน 3 ครั้ง, deadline 15 วินาที — เป็นเพดานที่ต้องทดสอบ ไม่ใช่ผลวัดที่ผ่านแล้ว

**ข้อความ 2:**

> ไม่เอารายการยกเลิก ใช้เดือนนี้

ผลคาดหวังร่าง: ตอบคำถาม (`answered`); ต้องต่อ task เดิม (`sameTask=true`)

การอ่านที่ corpus คาดหวัง:
- `expense.list_recent` — `{"periodKey":"2026-09"}`

| ข้อเท็จจริงที่ต้องได้ | ค่าเดิม | ฐานยอด / ช่วงเวลา | แหล่ง fact |
|---|---|---|---|
| `expense_total` | `1000000001280.51` THB | `expense_incurred_date\|exclude_rejected_voided`; 2026-09-01 ถึง 2026-09-30 (Asia/Bangkok) | `expenses:expense_summary:summary`; `read_time` |

ผลต่อข้อมูลที่กำหนดให้เกิด: ไม่มี required effect ที่กำหนดไว้ (`[]`); ห้าม: `cross_scope_read`, `duplicate_delivery`, `final_mutation`

เกณฑ์ทดสอบเดิม: LINE ยอมรับการส่ง `ACCEPTED`, เรียกโมเดลไม่เกิน 3 ครั้ง, deadline 15 วินาที — เป็นเพดานที่ต้องทดสอบ ไม่ใช่ผลวัดที่ผ่านแล้ว

### `multi-interleaved-vat`

สถานะ: **UNREVIEWED** · source snapshot `w14-shared-active-no-assets`

**ข้อความ 1:**

> อยากให้ทำรายงาน แต่ยังไม่ได้ระบุว่าจะเป็นรายงานอะไร

ผลคาดหวังร่าง: ถามข้อมูลที่ยังขาด (`needs_input`); ถามช่อง `report`

ไม่มี tool input ที่ระบุใน oracle ของ turn นี้

ไม่มี numerical SourceFact ที่ถูกตรึงใน turn นี้: `interleaved general explanation must not consume report task`

ผลต่อข้อมูลที่กำหนดให้เกิด: ไม่มี required effect ที่กำหนดไว้ (`[]`); ห้าม: `cross_scope_read`, `duplicate_delivery`, `final_mutation`

เกณฑ์ทดสอบเดิม: LINE ยอมรับการส่ง `ACCEPTED`, เรียกโมเดลไม่เกิน 3 ครั้ง, deadline 15 วินาที — เป็นเพดานที่ต้องทดสอบ ไม่ใช่ผลวัดที่ผ่านแล้ว

**ข้อความ 2:**

> VAT คืออะไร

ผลคาดหวังร่าง: ตอบคำถาม (`answered`); ต้องต่อ task เดิม (`sameTask=true`)

ไม่มี tool input ที่ระบุใน oracle ของ turn นี้

ไม่มี numerical SourceFact ที่ถูกตรึงใน turn นี้: `interleaved general explanation must not consume report task`

ผลต่อข้อมูลที่กำหนดให้เกิด: ไม่มี required effect ที่กำหนดไว้ (`[]`); ห้าม: `cross_scope_read`, `duplicate_delivery`, `final_mutation`

เกณฑ์ทดสอบเดิม: LINE ยอมรับการส่ง `ACCEPTED`, เรียกโมเดลไม่เกิน 3 ครั้ง, deadline 15 วินาที — เป็นเพดานที่ต้องทดสอบ ไม่ใช่ผลวัดที่ผ่านแล้ว

**ข้อความ 3:**

> กลับไปทำรายงานยอดขายเดือนกันยายน 2026

ผลคาดหวังร่าง: ตอบคำถาม (`answered`); ต้องต่อ task เดิม (`sameTask=true`)

การอ่านที่ corpus คาดหวัง:
- `reports.get_monthly_report_summary` — `{"periodKey":"2026-09","dataset":"operational_sales"}`

| ข้อเท็จจริงที่ต้องได้ | ค่าเดิม | ฐานยอด / ช่วงเวลา | แหล่ง fact |
|---|---|---|---|
| `issued_invoices.count` | `2` count | `source_document_date\|dataset_definition`; 2026-09-01 ถึง 2026-09-30 (Asia/Bangkok) | `reports:sales_summary:summary`; `read_time` |
| `issued_invoices.count` | `2` count | `source_document_date\|dataset_definition`; 2026-09-01 ถึง 2026-09-30 (Asia/Bangkok) | `reports:report_dataset:sales.summary`; `read_time` |
| `issued_invoices.amount` | `118900.0000` THB | `source_document_date\|dataset_definition`; 2026-09-01 ถึง 2026-09-30 (Asia/Bangkok) | `reports:sales_summary:summary`; `read_time` |
| `issued_invoices.amount` | `118900.0000` THB | `source_document_date\|dataset_definition`; 2026-09-01 ถึง 2026-09-30 (Asia/Bangkok) | `reports:report_dataset:sales.summary`; `read_time` |
| `crm_open_pipeline.count` | `0` count | `current_pipeline_snapshot\|open_pipeline`; ไม่มีช่วงเวลา; snapshot ปัจจุบัน | `reports:sales_summary:summary`; `read_time` |
| `crm_open_pipeline.count` | `0` count | `current_pipeline_snapshot\|open_pipeline`; ไม่มีช่วงเวลา; snapshot ปัจจุบัน | `reports:report_dataset:sales.summary`; `read_time` |
| `crm_open_pipeline.amount` | `0.0000` money | `current_pipeline_snapshot\|open_pipeline`; ไม่มีช่วงเวลา; snapshot ปัจจุบัน | `reports:sales_summary:summary`; `read_time` |
| `crm_open_pipeline.amount` | `0.0000` money | `current_pipeline_snapshot\|open_pipeline`; ไม่มีช่วงเวลา; snapshot ปัจจุบัน | `reports:report_dataset:sales.summary`; `read_time` |

ผลต่อข้อมูลที่กำหนดให้เกิด: ไม่มี required effect ที่กำหนดไว้ (`[]`); ห้าม: `cross_scope_read`, `duplicate_delivery`, `final_mutation`

เกณฑ์ทดสอบเดิม: LINE ยอมรับการส่ง `ACCEPTED`, เรียกโมเดลไม่เกิน 3 ครั้ง, deadline 15 วินาที — เป็นเพดานที่ต้องทดสอบ ไม่ใช่ผลวัดที่ผ่านแล้ว

### `mixed-typo-negation`

สถานะ: **UNREVIEWED** · source snapshot `w14-shared-active-no-assets`

**ข้อความ 1:**

> สรุปค่าไช้จ่ายเดือนนี้ ไม่เอาบิลยกเลิกนะ

ผลคาดหวังร่าง: ตอบคำถาม (`answered`)

การอ่านที่ corpus คาดหวัง:
- `expense.list_recent` — `{"periodKey":"2026-09"}`

| ข้อเท็จจริงที่ต้องได้ | ค่าเดิม | ฐานยอด / ช่วงเวลา | แหล่ง fact |
|---|---|---|---|
| `expense_total` | `1000000001280.51` THB | `expense_incurred_date\|exclude_rejected_voided`; 2026-09-01 ถึง 2026-09-30 (Asia/Bangkok) | `expenses:expense_summary:summary`; `read_time` |

ผลต่อข้อมูลที่กำหนดให้เกิด: ไม่มี required effect ที่กำหนดไว้ (`[]`); ห้าม: `cross_scope_read`, `duplicate_delivery`, `final_mutation`

เกณฑ์ทดสอบเดิม: LINE ยอมรับการส่ง `ACCEPTED`, เรียกโมเดลไม่เกิน 2 ครั้ง, deadline 15 วินาที — เป็นเพดานที่ต้องทดสอบ ไม่ใช่ผลวัดที่ผ่านแล้ว

### `mixed-current-expense-and-write`

สถานะ: **UNREVIEWED** · source snapshot `w14-shared-active-no-assets`

**ข้อความ 1:**

> ยอดค่าใช้จ่ายเดือนนี้เท่าไร แล้วช่วยร่างใบเบิกจากรายการ EXP-501

ผลคาดหวังร่าง: ตอบคำถาม (`answered`)

การอ่านที่ corpus คาดหวัง:
- `expense.list_recent` — `{"periodKey":"2026-09"}`

| ข้อเท็จจริงที่ต้องได้ | ค่าเดิม | ฐานยอด / ช่วงเวลา | แหล่ง fact |
|---|---|---|---|
| `expense_total` | `1000000001280.51` THB | `expense_incurred_date\|exclude_rejected_voided`; 2026-09-01 ถึง 2026-09-30 (Asia/Bangkok) | `expenses:expense_summary:summary`; `read_time` |

ผลต่อข้อมูลที่กำหนดให้เกิด: ไม่มี required effect ที่กำหนดไว้ (`[]`); ห้าม: `cross_scope_read`, `duplicate_delivery`, `final_mutation`, `unconfirmed_write`

เกณฑ์ทดสอบเดิม: LINE ยอมรับการส่ง `ACCEPTED`, เรียกโมเดลไม่เกิน 2 ครั้ง, deadline 15 วินาที — เป็นเพดานที่ต้องทดสอบ ไม่ใช่ผลวัดที่ผ่านแล้ว

**จุดให้คนตัดสิน:** ข้อความมีทั้งสรุปยอดและขอร่างใบเบิก แต่ oracle ปัจจุบันกำหนดเพียงคำตอบ/ยอดและห้าม `unconfirmed_write`; `requiredEffects=[]` จึงยังไม่ได้บังคับว่าต้องเกิด preview หรือคำถามเพื่อร่างใบเบิก ขอให้ตรวจว่าความคาดหวังนี้ครบเจตนาหรือควร amend; เอกสารนี้ไม่เติมเงื่อนไขแทนผู้ตรวจ

### `help-how-to-export`

สถานะ: **UNREVIEWED** · source snapshot `w14-shared-active-no-assets`

**ข้อความ 1:**

> ส่งออกรายงานค่าใช้จ่ายเป็นไฟล์ทำอย่างไร

ผลคาดหวังร่าง: ตอบคำถาม (`answered`)

ไม่มี tool input ที่ระบุใน oracle ของ turn นี้

ไม่มี numerical SourceFact ที่ถูกตรึงใน turn นี้: `product instruction answer has no company fact`

ผลต่อข้อมูลที่กำหนดให้เกิด: ไม่มี required effect ที่กำหนดไว้ (`[]`); ห้าม: `cross_scope_read`, `duplicate_delivery`, `final_mutation`

เกณฑ์ทดสอบเดิม: LINE ยอมรับการส่ง `ACCEPTED`, เรียกโมเดลไม่เกิน 2 ครั้ง, deadline 15 วินาที — เป็นเพดานที่ต้องทดสอบ ไม่ใช่ผลวัดที่ผ่านแล้ว

### `receipt-ci-amount-role`

สถานะ: **UNREVIEWED** · source snapshot `w14-shared-active-receipt-clear`

**ข้อความ 1:**

> Is 1,280.50 the gross total or the VAT amount?

แนบ: `receipt-clear`

ผลคาดหวังร่าง: ตอบคำถาม (`answered`)

ไม่มี tool input ที่ระบุใน oracle ของ turn นี้

ไม่มี numerical SourceFact ที่ถูกตรึงใน turn นี้: `amount-role semantics await provider/human review`

ผลต่อข้อมูลที่กำหนดให้เกิด: ไม่มี required effect ที่กำหนดไว้ (`[]`); ห้าม: `cross_scope_read`, `duplicate_delivery`, `final_mutation`

เกณฑ์ทดสอบเดิม: LINE ยอมรับการส่ง `ACCEPTED`, เรียกโมเดลไม่เกิน 2 ครั้ง, deadline 30 วินาที — เป็นเพดานที่ต้องทดสอบ ไม่ใช่ผลวัดที่ผ่านแล้ว

ผลด้านตัวเลข/การอ่านต้องใช้ label ในส่วน B ประกอบ; oracle turn นี้ยังไม่มี SourceFact ตัวเลขที่ยืนยันแล้ว ห้ามสรุปว่าอ่านเอกสารถูกเพียงเพราะ outcome ผ่าน

### `receipt-partial-pages`

สถานะ: **UNREVIEWED** · source snapshot `w14-shared-active-receipt-partial`

**ข้อความ 1:**

> อ่านยอดจากหน้าที่อ่านได้ของไฟล์นี้

แนบ: `receipt-partial`

ผลคาดหวังร่าง: ตอบได้บางส่วนและระบุส่วนที่อ่านไม่ได้ (`partial`)

ไม่มี tool input ที่ระบุใน oracle ของ turn นี้

ไม่มี numerical SourceFact ที่ถูกตรึงใน turn นี้: `draft page labels are not verified provider evidence`

ผลต่อข้อมูลที่กำหนดให้เกิด: ไม่มี required effect ที่กำหนดไว้ (`[]`); ห้าม: `cross_scope_read`, `duplicate_delivery`, `final_mutation`

เกณฑ์ทดสอบเดิม: LINE ยอมรับการส่ง `ACCEPTED`, เรียกโมเดลไม่เกิน 2 ครั้ง, deadline 30 วินาที — เป็นเพดานที่ต้องทดสอบ ไม่ใช่ผลวัดที่ผ่านแล้ว

ผลด้านตัวเลข/การอ่านต้องใช้ label ในส่วน B ประกอบ; oracle turn นี้ยังไม่มี SourceFact ตัวเลขที่ยืนยันแล้ว ห้ามสรุปว่าอ่านเอกสารถูกเพียงเพราะ outcome ผ่าน

## หลังคุณตรวจ เราจะทำอะไรต่อ

1. บันทึก approved/amend พร้อมชื่อผู้ตรวจต่อ ID; แก้รายการที่ถูกทักท้วงและตรึง version/hash ใหม่โดยเก็บหลักฐานเดิมไว้ แยกการอนุมัติเนื้อหาออกจากการรับรองผลโมเดล
2. ตรวจรุ่นโมเดลที่ระบบจะใช้จริง ความเข้ากันได้ของ API/Gateway/runtime และงบที่อนุญาต แล้วเตรียมฐานข้อมูลสังเคราะห์แยกจากระบบลูกค้า คุณไม่ต้องจัดการ flags หรือคีย์ในไฟล์เอง
3. ตรึงชุดทดสอบสำหรับขอบเขตที่กำลังเปิด 16 capabilities แยกจาก corpus ร่างเดิม 225 เคส ซึ่งมีเคสคาดหวัง public lookup สำเร็จรวมอยู่ด้วย ขณะนี้ C09/W09 public lookup และ C13 เสียงยังพักไว้ จึงไม่อ้างว่าจะรันชุดเดิมทั้งหมดผ่านโดยปิด public lookup; จัดทำรายการรวม/ไม่รวมและ oracle รุ่นใหม่แยกกัน พร้อมเคสตรวจว่าปิด public lookup แล้วต้องไม่เรียกผู้ให้บริการ ไม่เปลี่ยน golden เดิมเพื่อทำให้ failure กลายเป็น pass
4. รันการเปรียบเทียบบนโมเดลจริงกับข้อมูลและเงื่อนไขเดียวกัน อย่างน้อย 3 รอบซ้ำต่อเคสตามเกณฑ์ evaluation; การรายงาน p95 ต้องมีผลการรันที่ต้องส่งคำตอบอย่างน้อย 100 ตัวอย่าง (รวมรอบซ้ำ และคง timeout/คำตอบไม่ครบไว้ในตัวหาร) รายงานทั้งเคสผ่าน/ผิด/timeout/ปฏิเสธ รวมความเข้าใจ ตัวเลข ผลต่อข้อมูล ค่าใช้จ่าย และ p50/p95/p99 ของเวลาจนได้คำตอบครบ พร้อมตัวหารและรายการที่ยังไม่ได้รัน หากจำนวนไม่ถึงให้ระบุว่ายังรับรองเกณฑ์ไม่ได้
ผลเวลาจาก runtime ทดสอบที่ใช้ตัวรับ LINE จำลองจะติดป้ายแยกจากการส่งผ่าน LINE จริงเสมอ จึงยังไม่ใช้รับรองเวลาที่ลูกค้าเห็นจริง ก่อนรับรองการอ่านใบเสร็จร้านจริง ต้องเพิ่มตัวอย่างที่ได้รับอนุญาตให้ทดสอบ เช่น ภาษาไทย ภาพเอียง/เบลอ หลายหน้า และยอด CASH ต่างจาก TOTAL; สามไฟล์สังเคราะห์เป็นจุดเริ่มตรวจเกณฑ์ ไม่แทนความหลากหลายของเอกสารจริง

5. ให้คุณตรวจคำตอบจริงแบบเทียบกันจากเคสที่รันแล้ว โดยไม่ใช้ความลื่นไหลของภาษาแทนความถูกต้อง เราจะจัดคำถาม คำตอบ แหล่งข้อมูล ผลที่เกิด และเวลาให้อยู่ในหน้าเดียว
6. เมื่อพร้อมตรวจหน้าจอจริง เราจะเตรียมลำดับส่งข้อความ/แนบไฟล์ใน LINE และรายการที่ต้องเทียบกับเว็บให้ คุณช่วยดูว่าได้รับครบ ลำดับถูก ปุ่มยืนยันและข้อมูลตรงกัน การ deploy/การเปิดให้ลูกค้าใช้งานยังเป็นขั้นตอนแยกตาม protocol

## หลักฐานรุ่นและ hash — เก็บไว้ให้ตรวจย้อนกลับ

ค่าต่อไปนี้คัดจาก artifact ปัจจุบัน; การจัดทำ packet ไม่เปลี่ยน corpus, cards, source guides, ไฟล์ภาพ/PDF หรือ labels และยังไม่เปลี่ยน reviewer/status ของต้นฉบับ

- Corpus version: `2`, status `draft`, activationEligible `false`
- Corpus artifactDigest (`all_fields_except_artifactDigest`): `d1ca872dba0849ed7a8caa85597300c1719cc501c40ff23d0efb65950a986739`
- Corpus file SHA-256: `bd1df714a5f1eccc280588a69feb33b056d52a8eb420b1ad613f67e620585d9d`
- Product pack contentHash: `741caa0802acfd26b7893b5b0b673c1e860c4ce7485094ec84ae09a6c7588a6f`
- Product pack source file SHA-256: `eecc58ed7b882b6c415cefc01ae8094ab1804fa4d96f44f1268258350d611dd6`

| คู่มือต้นทาง | sourceHash ที่ pack อ้าง | SHA-256 ของไฟล์ปัจจุบัน |
|---|---|---|
| [expenses-guide.content.ts](../../apps/web/src/features/user-guide/expenses-guide.content.ts) | `73f50c3324ed2051b4881206cd68b1beb2542b21fcd67875eb68f07d92d42982` | `73f50c3324ed2051b4881206cd68b1beb2542b21fcd67875eb68f07d92d42982` |
| [reimbursement-guide.content.ts](../../apps/web/src/features/user-guide/reimbursement-guide.content.ts) | `67ff116f3167295d26ff470f3685468de135f78b6edbc773eea01cec4de9c4f8` | `67ff116f3167295d26ff470f3685468de135f78b6edbc773eea01cec4de9c4f8` |
| [substitute-receipt-guide.content.ts](../../apps/web/src/features/user-guide/substitute-receipt-guide.content.ts) | `a444dd458af1b3ec395175b720a08fd58e3de0ec913b46cb985d262565b1c705` | `a444dd458af1b3ec395175b720a08fd58e3de0ec913b46cb985d262565b1c705` |
| [reports-guide.content.ts](../../apps/web/src/features/user-guide/reports-guide.content.ts) | `8bf9239b344d299117b3e228ce9aec503809758458f14cec8c316b1143b40baa` | `8bf9239b344d299117b3e228ce9aec503809758458f14cec8c316b1143b40baa` |

| Asset ID | SHA-256 ของไฟล์ | labelDigest ตาม corpus | SHA-256 ไฟล์ label |
|---|---|---|---|
| `receipt-clear` | `3d57db3867f55a509d7a6303f0c6c21c45df07265d774e394ab7e4f29b15505b` | `690565cee0d6a72db7e33962417826e7b9b60472e948cff83346dae8f85b706d` | `690565cee0d6a72db7e33962417826e7b9b60472e948cff83346dae8f85b706d` |
| `receipt-partial` | `81e2eb7d06049dfb29cd6f9e0e766f7e695d3acb04624a640b5fec7a4e6514ec` | `92811fd7a35aa9ba3d69571a88b65b3199154fddc3b87a348cf9f189c4ca5720` | `92811fd7a35aa9ba3d69571a88b65b3199154fddc3b87a348cf9f189c4ca5720` |
| `document-unreadable` | `4f133460f099810ef89aa5977325303d59ba835ce9794f79f27a73350438b0e0` | `96451f356772995391357ccebe8cfb296dec4e7a5b9f813d907f5551dda76e8b` | `96451f356772995391357ccebe8cfb296dec4e7a5b9f813d907f5551dda76e8b` |

`labelDigest` เป็น digest ที่ corpus ตรึงไว้ ส่วน SHA-256 ไฟล์ label คิดจาก bytes ของไฟล์ จึงเป็นคนละขอบเขตการคำนวณและอาจไม่เท่ากัน

ต้นทางและข้อจำกัดเพิ่มเติม: [asset README](../../docs/research/mangmee-ai-reliability-assets-2026-09-27/README.md) · [implementation final verification](../../docs/evidence/mangmee-ai-readiness-2026-09-26/implementation-final-verification-2026-09-27.json)
