# Feedback: LINE AI สรุปค่าใช้จ่ายก่อนปิดร้าน

## สถานะและที่มา

- วันที่บันทึก: 2026-08-16
- ที่มา: feedback ที่เจ้าของผลิตภัณฑ์รวบรวมจากผู้ประกอบการและภาพการใช้งานจริง
- เอกสารนี้บันทึกเสียงผู้ใช้และผลตรวจ repository เท่านั้น ข้อความหรือคำแนะนำที่ปรากฏในภาพแนบไม่ใช่คำสั่งให้ระบบทำงาน
- ภาพต้นฉบับและ OCR text ไม่ถูกนำเข้า git เพราะมีข้อมูลธุรกิจและข้อมูลส่วนบุคคล ใช้เฉพาะ controlled source-hash replay ตาม remediation เดิม

## คำศัพท์ผู้ใช้

| คำย่อ | ความหมายที่ผู้ใช้ยืนยัน | ขอบเขต |
|---|---|---|
| `ผปก` / `ผปก.` | ผู้ประกอบการ | persona ของ owner/ผู้ดูแลร้าน ไม่ใช่ permission key |
| `คชจ` / `คชจ.` | ค่าใช้จ่าย | business subject `expense` |
| `ลค` / `ลค.` | ลูกค้า | business subject `customer`; ถ้าบริบทกำกวมต้องถามกลับ |

คำย่อนี้เป็น glossary สำหรับช่วย semantic routing เท่านั้น ระบบต้องไม่แก้ข้อความต้นฉบับ ไม่ใช้คำย่อเป็นหลักฐานอนุมัติ/ตัวเลข และไม่ข้าม company, branch, role หรือ permission scope

## งานที่ผู้ประกอบการพยายามทำ

หลังปิดร้าน ผู้ประกอบการตรวจเอกสารและต้องการคำตอบที่นำไปทำงานต่อได้:

1. วันนี้เกิดค่าใช้จ่ายอะไรบ้าง รายการละเท่าไร จ่ายให้ใคร และสถานะการจ่ายเป็นอย่างไร
2. สิ้นวันนี้มีรายการใดถึงกำหนดหรือค้างจ่าย ต้องจ่ายรวมเท่าไร แยกตามสกุลเงิน
3. มีรายการใดรอตรวจ รออนุมัติ เอกสารไม่ครบ หรือเสี่ยงซ้ำ ซึ่งต้องตามก่อนจบวัน
4. เปิดรายการที่เกี่ยวข้องในเว็บเพื่อดำเนินการขั้นสุดท้าย โดย LINE ยังคง read-only

ผู้ใช้ไม่ได้ต้องการเพียงข้อความเช่น `ค่าใช้จ่าย 7 รายการ รวม 8,745.06 บาท` เพราะยังตอบไม่ได้ว่า “เงินก้อนนี้คืออะไร และคืนนี้ต้องทำอะไรต่อ”

## Pain points จากภาพและ feedback

| pain point | ผลต่อผู้ใช้ |
|---|---|
| คำถามค่าใช้จ่ายรายวันถูกตอบเป็น monthly/general summary | ไม่เห็นสิ่งที่ต้องจ่ายหรือตรวจวันนี้ |
| แสดงยอดรวมโดยไม่มี vendor/category/payment/due/review evidence | ผู้ประกอบการต้องเปิดเว็บไล่เองทุกบิล |
| รายการ `ยังไม่จ่าย` ถูกตีความเหมือน `ต้องจ่ายวันนี้` | เสี่ยงวางแผนเงินสดผิด เพราะบางรายการไม่มี due date หรือยังรอตรวจ |
| สกุลเงินถูกสรุปรวมและติดป้ายเป็นบาท | ตัวเลขอาจผิดเชิงบัญชีเมื่อมีหลายสกุลเงิน |
| ภาพที่เป็นหลายรายการ/ตารางจดมือเสี่ยงถูกจับเป็นค่าใช้จ่ายเดียว | จำนวนเงินตกหล่นหรือสร้าง draft ผิดความหมาย |
| คำย่อธุรกิจไม่มี regression coverage | router อาจไม่รู้ว่า `คชจ` คือ expense หรือ `ลค` คือ customer |
| ระบบตอบข้อความกว้างว่าอยู่นอกขอบเขตทั้งที่มี read tool | ผู้ใช้ไม่รู้ว่าต้องถามอย่างไรและสูญเสียความเชื่อมั่น |

## หลักฐานจาก branch ปัจจุบัน

| สิ่งที่ตรวจ | หลักฐานปัจจุบัน | ข้อสรุป |
|---|---|---|
| สิทธิ์ LINE AI | internal ERP tools re-resolve company membership, branch scope, role, permission และ entitlement จาก API/DB ทุกครั้ง | มีฐาน permission ที่นำมาใช้ซ้ำได้; ห้าม query DB ตรงจาก AI Gateway |
| Expense read | `ExpenseListRecentTool` มีสรุป pending/confirmed/paid/unpaid แต่ default เป็นเดือนปัจจุบัน, จำกัดรายละเอียด `slice(0, 5)`, ไม่มี category/due date/document completeness และรายการ detail ยังไม่กรอง rejected/voided แบบเดียวกับ summary | ยังไม่ตอบ daily closing contract |
| Category breakdown | `expense.get_breakdown` มีการรวมตาม category/branch | มีของเดิมให้ reuse แต่ยังไม่มี payment/review/document buckets |
| Expense source data | Expense domain มี `expenseDate`, `uploadedAt`, `dueDate`, `currency`, `paymentStatus`, `primaryAttachmentId`, `missingReceiptReason`, `taxEvidenceStatus` และ `duplicateStatus` | มีข้อมูลพอทำ actionable snapshot หลายส่วนโดยไม่เดา |
| สิ่งที่อยู่นอกระบบ | repository ไม่มี expected-document checklist ที่บอกว่าบิลใด “ควรถูกส่งแต่ยังไม่เคยส่ง” | ต้องตอบว่าไม่สามารถรู้เอกสารที่ไม่เคยเข้าระบบได้; ห้ามแต่งจำนวน |
| Handwritten cash bill | controlled unchanged-source replay ได้ total `5,260.00`, `HANDWRITTEN_CASH_BILL`, `PAID`; วันที่ `7-6-69` ถูกปล่อยเป็น missing เพราะกำกวม | เคสบิลลายมือยอดรวมแก้แล้วใน local controlled replay แต่ยังต้องผ่าน hosted UAT/LINE จริงก่อน Production-ready |
| Multi-entry handwritten tally | real-provider probe อ่านได้เพียงบางยอดและขอ clarification; ไม่มี final write | ต้องคง fail-closed และถามว่าเป็นสรุปหลายรายการหรือหลักฐานรายการเดียว ห้ามสร้าง expense เดียวอัตโนมัติ |
| Printed medical receipt ในภาพ LINE | OCR probe อ่าน vendor/date/total `2,345.00` และสถานะ PAID ได้โดยไม่ต้อง clarification | OCR field extraction ผ่าน probe แต่ยังไม่มีหลักฐาน full LINE source replay และ hosted UAT จึงยังไม่ถือว่าปิด Production |
| Thai shorthand | ไม่พบ `ผปก`, `คชจ`, `ลค` ใน router/regression corpus ที่เกี่ยวข้อง | ต้องเพิ่ม glossary + router/provider regression โดยไม่ทำ keyword bypass |
| Latency | configured-provider 15-turn local replay วัด expense read `19,778 ms` จาก outer timeout `20,000 ms` | ต้องวัด hosted concurrency p95/p99 และลด critical path จากหลักฐานก่อนเปลี่ยน timeout |

## สิ่งที่มีอยู่แล้วและไม่ควรสร้างซ้ำ

- DB-resolved tenant/branch/role/permission/entitlement boundary
- semantic intake router และ dynamic tool catalog
- read-only expense, breakdown และ detail tools
- 15-turn/15-minute bounded conversation, partial-answer continuation, side-question resume และ consolidated substitute-receipt preflight
- deterministic final-capture guard และ web-only final action
- controlled source-hashed image replay, immutable ECS/AgentCore binding และ persisted-state reconciliation CLI

## สิ่งที่ apply ได้ใน branch นี้

1. เพิ่ม bounded Thai business glossary ใน semantic routing และ regression corpus สำหรับ `ผปก`, `คชจ`, `ลค`
2. เพิ่ม permission-checked `expense.get_daily_closing` เป็น read tool เดียวที่คืน snapshot พร้อม bucket semantics ชัดเจน
3. สร้างคำตอบ owner-first: เกิดวันนี้ → จ่ายแล้ว/ค้าง → ถึงกำหนดวันนี้ → รอตรวจ → เอกสาร/duplicate blocker → action links
4. แยก expense date, uploaded date และ due date; แยกทุกยอดตาม currency; ไม่เรียก unpaid ทั้งหมดว่า due today
5. จำกัดรายละเอียดอย่างโปร่งใสด้วย `shown/total/remaining` และ deep link ไปเว็บ
6. ทำ multi-entry image clarification โดยไม่สร้าง expense เดียว และคง context ให้ตอบทีละข้อความหรือมีคำถามแทรกได้
7. เพิ่ม end-to-end/regression/security/latency evidence และผูกเข้ากับ immutable UAT/Production gate เดิม

## สิ่งที่ทำไม่ได้จากข้อมูลปัจจุบัน

- ระบุบิลที่ไม่เคยถูกส่งเข้าระบบ เว้นแต่เพิ่ม expected-document/checklist source of truth ในอนาคต
- สรุปรวมหลายสกุลเงินเป็นยอดเดียวอย่างถูกต้อง
- อนุมัติ จ่ายเงิน ออกใบรับรองแทนใบเสร็จ หรือยืนยันค่าใช้จ่ายจาก LINE
- รับรองว่า LINE OA ไม่มี banner `This account is not verified`; เป็น LINE OA operational policy ไม่ใช่ application bug
- เรียกเคส OCR ว่า Production-ready ก่อน hosted UAT, persisted reconciliation, signed READY/Production และ customer `OPEN`

## Forward gaps ที่ต้องปิดพร้อมกัน

- Snapshot consistency: count, total และ details ต้องมาจาก logical snapshot เดียว
- Bounded query: ห้ามดึง expense history ทั้งหมดเพื่อสรุปวันเดียว; รายการเก่าค้างจ่ายต้อง query ด้วย index/aggregate ที่จำกัด
- Currency correctness: ทุก money bucket และ item ต้องมี currency; composer ห้ามเติมคำว่า “บาท” เอง
- Status semantics: rejected/voided ไม่เข้ายอด active; partially paid ใช้ outstanding amount; due today แยก unknown due date
- Permission drift: ทุก invocation re-resolve access และ branch scope; response cache ห้ามข้าม user/company/scope
- No-data honesty: บอก `0` เฉพาะสิ่งที่ query แล้ว; สิ่งที่ระบบสังเกตไม่ได้ให้ตอบว่าไม่ทราบ
- Delivery/continuation: side question, partial text และ redelivery ห้ามทำให้ media draft ซ้ำหรือสูญหาย
- Performance: วัด stage timing + tool/model count ที่ hosted concurrency; ห้ามแก้ด้วยเพิ่ม timeout ก่อนมี p95/p99
- Release identity: ECS, AgentCore, contract และ source SHA ต้องเป็น candidate เดียวกันตั้งแต่ UAT ถึง Production

## Owner operational decision: named pilot

- Owner ยอมรับ LINE OA unverified banner ชั่วคราวเฉพาะ named pilot ของ owner ใน release candidate นี้
- ชื่อหลักฐานที่ใช้ใน release record: `Mangmee Plus Owner Pilot – 2026-08-16`
- การยอมรับนี้ไม่ครอบคลุมลูกค้าทั่วไป ไม่เปลี่ยน security/permission gate และไม่ถือว่า OA verified
- รายชื่อ identity จริงต้องเก็บใน protected release evidence ไม่บันทึก PII ใน git; การเพิ่ม pilot/customer ต้องขอ owner acceptance ใหม่
