# LINE ระบบมั่งมี — แผนนำดีไซน์ที่ล็อกไปใช้

สถานะ: HANDOFF READY — 2026-10-05 ตรวจ source และจัดแผนแล้ว ยังไม่ได้แก้ runtime ของงานนี้ เจ้าของสั่ง “ทำเลย” และต่อมาขอเอกสารส่งต่อ

[เอกสาร handoff พร้อมภาพ 8 บริบท / 20 ตัวอย่าง / 40 ภาพ](../prompts/line-system-oa-card-design-implementation-handoff-2026-10-05-th.md)

ข้อกำหนด: [ดีไซน์ที่ล็อก](../specs/line-system-oa-card-design-lock-spec-th.md) และ [สำเนาที่อนุมัติ](../evidence/line-system-oa-design-lock-2026-10-04/approved-preview.html) ห้ามแก้ baseline หรือออกแบบใหม่ งานนี้ยังไม่ใช่คำสั่งเผยแพร่ UAT/Production

## เป้าหมายและขอบเขต

นำ pattern ที่อนุมัติไปใช้ในคำตอบ OA ระบบ: ถามตอบทั่วไป อ่าน/สรุปค่าใช้จ่าย อ่านรายการและการชำระเงิน งานค้าง ร่างใบเสร็จรอตรวจสอบ ตัวอย่างก่อนยืนยันการแก้ไขและผลตามสถานะ รวมถึงข้อความรับรูป/ไฟล์ที่กำลังสแกนใน message buffer ทั้ง 8 บริบทใช้สี หัวสองบรรทัด การซ้อนพื้นขาว มาสคอต และแถว `ชื่อ : ค่า` ตามแบบเดิม ข้อมูลต้องมาจาก source/fixture เดิมที่ตรวจไว้; ไม่มีข้อมูลตัวอย่างใน runtime

ไม่เปลี่ยน rich menu หรือการ์ดของ OA Official ฝั่งการตลาด ไม่เปลี่ยนการอนุมัติ/จ่ายเงินจริง ไม่เพิ่ม model call, dependency, DB migration หรือแก้ package.json งานแจ้งเตือน push เบื้องหลังที่เป็นเส้นทางส่งแยกต้องรักษาการส่งเดิมในรอบนี้; การ์ดงานค้างครอบคลุมคำตอบจาก read tools ที่ใช้อยู่

## วิธีทำและสัญญาข้อมูล

1. ใช้ตัวสร้าง native Flex ของ pattern เดียวร่วมกันใน API; วางมาสคอตสุดท้ายเหนือพื้นขาวใน body เดียวเพื่อไม่ให้ถูกตัดที่ขอบ header รักษาขนาด/สีตาม baseline ใช้รูปโปร่งใสที่ล็อกแล้วเป็น static assets ในเว็บ
2. เพิ่ม metadata แสดงผลแบบ optional ใน `LineAiAnswerCard` เพื่อส่ง context/แถว/รูป/หมายเหตุจาก trusted gateway ที่อ่าน tool results อยู่แล้ว คง `text` เป็น canonical answer เดิมและใช้ fallback เดิมเมื่อข้อมูลไม่พอ ห้ามรับ model-generated Flex JSON
3. ครอบคลุม full orchestration, prepared-read และ direct tool path ด้วย formatter เดียว; summary กว้างต้องไม่เพิ่ม breakdown ที่ผู้ใช้ไม่ได้ถาม กรณีอ่านไม่สำเร็จ/ไม่มีสิทธิ์ไม่กลายเป็นผล “ไม่มีงาน”
4. Notification read tool ยังคง permission และ user/company scope ของ `ListNotificationsUseCase`; ส่งลิงก์เอกสารที่ตรวจ tenant แล้วจาก source เดิมมาด้วย เปลี่ยน legacy reimbursement hub link เป็น journey link โดยอ้าง request ID ที่มีอยู่ใน source เท่านั้น หน้าเว็บยังตรวจสิทธิ์/สถานะเมื่อเปิด
5. ใช้ renderer ร่วมกับ receipt draft และ draft-update proposal โดยรักษา preview-bound postback, canonical text/fallback และ lossless multipart ไม่เปลี่ยนเงื่อนไขที่อนุญาต mutation
6. Message buffer ใช้การ์ดสแกนแทน media acknowledgment เดิม ณ จังหวะเดิม; ไม่เพิ่มข้อความซ้ำ ไม่เพิ่มเปอร์เซ็นต์/เวลาจบที่ไม่ทราบ รักษาการ settle feedback ก่อน final delivery และ native loading เดิม

## ตรวจรับ

- [ ] ตัวสร้างการ์ดและ assets ตรงกับสี/สัดส่วน/ภาพ/แถว/คำที่ล็อกทั้ง 8 บริบท
- [ ] summary/status/payment facts และ zero results มาจากผลอ่านที่ grounded; ไม่มีตัวเลขหรือสถานะใหม่จากการคาดเดา
- [ ] direct reimbursement link, cross-tenant/unsafe link rejection, permission failure และ fallback ตรวจผ่าน
- [ ] confirmation/cancel postbacks, canonical fallback, multipart และ completion quick reply ไม่ถดถอย
- [ ] focused unit/contract/integration tests และ typechecks ที่เกี่ยวข้องผ่าน; บันทึกคำสั่งและข้อจำกัดของ baseline ที่ checkout มีงานอื่นค้าง
- [ ] ตรวจ native Flex JSON และภาพ preview จาก payload จริงเทียบกับสำเนา 320px/736px; ไม่ถือว่า local renderer เป็นผลทดสอบบน LINE มือถือ

ข้อจำกัดการตรวจรับปลายทาง: native LINE client/asset availability หลังเผยแพร่ต้องตรวจแยก การเปลี่ยนดีไซน์เพื่อหลบข้อจำกัดแพลตฟอร์มต้องมาจากคำสั่งเจ้าของครั้งใหม่ ไม่ใช่การตัดสินใจเอง

## สถานะ/หลักฐาน

เริ่มจาก checkout เดิมที่มีงานอื่นค้าง รักษางานเดิมและบันทึก baseline ของไฟล์ที่จะเปลี่ยนก่อนลงมือ รายละเอียดและผลตรวจต่อเนื่องอยู่ใน [task memory](../agent-memory/line-system-oa-card-pattern-review-2026-10-04.md)

2026-10-05 ส่งต่อ spec/plan, แผนที่โค้ดและช่องว่างที่ตรวจพบ พร้อมภาพทุกสถานะทั้ง 320px และ 736px จาก HTML ที่ล็อกโดยไม่เปลี่ยน baseline ผล layout/source checks รอบ handoff PASS 40/40; ยังไม่มี native payload, implementation tests หรือ System OA deploy ข้ออนุญาตลงโค้ดจาก “ทำเลย” ยังอยู่สำหรับผู้รับงาน
