# LINE ระบบมั่งมี — แผนนำดีไซน์ที่ล็อกไปใช้

สถานะ: ลงโค้ดเป็น native Flex แล้ว — 2026-10-05 ส่วนที่ 1 รวมเข้า develop/main แล้ว (#1012/#1013) ส่วนที่ 2 (ตัวกันข้อความที่ LINE ปฏิเสธ, การส่งซ้ำเป็นข้อความเมื่อการ์ดแบบ push ถูกปฏิเสธ, หลักฐานเส้นทางแชตที่ผูกบัญชี, ข้อความสำรองของการ์ดสแกน) อยู่บน branch `claude/line-system-oa-cards-20261005` · การ์ดผลอ่านไฟล์ PDF และการปรับหน้าตาตามผลวัดอยู่ในงานคู่ขนาน · **ยังไม่ได้ตรวจรับบนแอป LINE จริง** (ภาพที่มีมาจากตัวแสดงผลในเครื่อง) · ประวัติก่อนลงโค้ด: HANDOFF READY — ตรวจ source และจัดแผนแล้ว เจ้าของสั่ง “ทำเลย” และต่อมาขอเอกสารส่งต่อ

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

- [ ] ตัวสร้างการ์ดและ assets ตรงกับสี/สัดส่วน/ภาพ/แถว/คำที่ล็อกทั้ง 8 บริบท — **สร้างครบแล้ว** (ตัวสร้างเดียว `line-system-card.logic.ts` + รูป 12 ไฟล์) ผลวัดเทียบแบบ 20 สถานะ × 2 ความกว้างด้วยตัวแสดงผลในเครื่อง: หัว ไล่สี พื้นขาวซ้อน มาสคอต แถว เครื่องหมาย `:` แถบยอดรวม ป้ายสถานะ กล่องหมายเหตุ ปุ่ม ตรงทุกกรณี (ต่างไม่ถึง 0.75 px) ส่วนที่ LINE ไม่เปิดให้กำหนด (ความกว้างและมุมของการ์ด ฟอนต์และน้ำหนักตัวอักษร เงา) อยู่ในตาราง “Native limits” ของ task memory · ช่องนี้จะติ๊กเมื่อรายการความต่างปิดและดูบนมือถือจริงแล้ว
- [x] summary/status/payment facts และ zero results มาจากผลอ่านที่ grounded; ไม่มีตัวเลขหรือสถานะใหม่จากการคาดเดา — แถวของการ์ดสร้างโดย gateway จากผล tool ที่ตรวจสิทธิ์แล้วเท่านั้น (ไม่อ่านจากข้อความของโมเดล) ทั้งสี่เส้นทางคำตอบ; ผลอ่านที่ถูกปฏิเสธหรือล้มเหลวไม่มีการ์ดและไม่ถูกวาดเป็น “ไม่พบรายการ”; ค่าที่ไม่มีในแหล่งข้อมูลไม่มีแถว (spec: prepared-simple-read-formatter 148, semantic-turn-v2-terminal-outcomes 54, orchestrator 92, line-ai-turn 44)
- [x] direct reimbursement link, cross-tenant/unsafe link rejection, permission failure และ fallback ตรวจผ่าน — ปุ่ม “เปิดใบเบิกเพื่ออนุมัติ” ใช้รหัสใบเบิกจากข้อมูลอ้างอิงและลิงก์ของแจ้งเตือนนั้นเอง (ไม่เดาจากเลขใบเบิก) แปลงลิงก์แบบเก่า `?tab=approvals&focus=…` เป็นหน้าใบเบิกใบนั้น; แจ้งเตือนของบริษัทอื่น ลิงก์ไปบริษัทอื่น/นอกเว็บ/ไม่ตรงกับข้อมูลอ้างอิง เปิดได้แค่หน้ารวมแจ้งเตือน และฝั่ง API ตรวจบริษัทของแชตซ้ำก่อนวาดปุ่ม (spec: erp-empty-result-semantics 12, line-business-card.logic 80)
- [x] confirmation/cancel postbacks, canonical fallback, multipart และ completion quick reply ไม่ถดถอย — postback และข้อความที่แสดงเมื่อกดเท่ากับการ์ดเดิมทุกตัวอักษร; ทุกการ์ดถือข้อความ canonical เดิมเป็นข้อความสำรอง; แผนส่งของแชตที่ผูกบัญชีส่ง “การ์ด” เป็นหลักและข้อความเต็มเป็นสำรองในช่องเดียวกัน; คำตอบที่ยาวเกินการ์ดยังส่งเป็นข้อความครบทุกส่วน; สวิตช์ `LINE_AI_MULTIPART_TERMINAL_FLEX_ENABLED` ถูกถอดออกแล้ว สิ่งที่กันข้อมูลหายคือกติกาในโค้ด (spec: line-draft-update-card.logic 19, line-delivery-plan.logic 22, process-line-webhook 406, line-intake-dispatch 360)
- [x] focused unit/contract/integration tests และ typechecks ที่เกี่ยวข้องผ่าน; บันทึกคำสั่งและข้อจำกัดของ baseline ที่ checkout มีงานอื่นค้าง — API และ ai-gateway typecheck ออก 0; `node scripts/run-line-ai-whole-chain-acceptance.mjs` ออก 0; คำสั่งและจำนวนทดสอบทั้งหมดอยู่ในหัวข้อ Verification ของ task memory
- [ ] ตรวจ native Flex JSON และภาพ preview จาก payload จริงเทียบกับสำเนา 320px/736px; ไม่ถือว่า local renderer เป็นผลทดสอบบน LINE มือถือ — ผู้ช่วยแกลเลอรีสร้าง payload จากตัวสร้างจริงครบ 20 สถานะ วาดด้วย `flex-to-html.mjs` และวัดเทียบแล้ว; ผู้ประสานงานรายงานว่าตัวตรวจของ LINE รับ payload 40 จาก 40 · ยังเหลือ: ปิดรายการความต่าง และดูบนแอป LINE จริง

ข้อจำกัดการตรวจรับปลายทาง: native LINE client/asset availability หลังเผยแพร่ต้องตรวจแยก การเปลี่ยนดีไซน์เพื่อหลบข้อจำกัดแพลตฟอร์มต้องมาจากคำสั่งเจ้าของครั้งใหม่ ไม่ใช่การตัดสินใจเอง

## สถานะ/หลักฐาน

เริ่มจาก checkout เดิมที่มีงานอื่นค้าง รักษางานเดิมและบันทึก baseline ของไฟล์ที่จะเปลี่ยนก่อนลงมือ รายละเอียดและผลตรวจต่อเนื่องอยู่ใน [task memory](../agent-memory/line-system-oa-card-pattern-review-2026-10-04.md)

2026-10-05 ส่งต่อ spec/plan, แผนที่โค้ดและช่องว่างที่ตรวจพบ พร้อมภาพทุกสถานะทั้ง 320px และ 736px จาก HTML ที่ล็อกโดยไม่เปลี่ยน baseline ผล layout/source checks รอบ handoff PASS 40/40; ยังไม่มี native payload, implementation tests หรือ System OA deploy ข้ออนุญาตลงโค้ดจาก “ทำเลย” ยังอยู่สำหรับผู้รับงาน

2026-10-05 ลงโค้ดแล้ว: รายละเอียดสิ่งที่สร้าง เส้นทางของแต่ละสถานะ ประโยคที่เปลี่ยน (ก่อน/หลัง) ตาราง “Native limits” และคำถามที่รอเจ้าของตัดสิน อยู่ใน [task memory](../agent-memory/line-system-oa-card-pattern-review-2026-10-04.md) หัวข้อ “Implementation 2026-10-05 — what was built” และ “Open questions”
