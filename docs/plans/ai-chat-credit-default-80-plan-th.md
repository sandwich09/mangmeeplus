# แผน: เครดิตแชตเริ่มต้น 80 credit

สถานะ: implementation ใน workspace; focused tests ผ่าน, รอรวม typecheck/UAT ก่อนเผยแพร่ ตาม [สเปก](../specs/ai-chat-credit-default-80-spec-th.md)

1. เพิ่มค่าคงที่ 8,000 สตางค์สำหรับ CHAT default ใน contracts; ไม่เปลี่ยน `AI_MONTHLY_BUDGET_SATANG` ที่ใช้เป็นเพดานรวม. ใช้ `CompanyAiMonthlyBucketUsage` และ classifier เดิม; ไม่สร้าง wallet/ledger ใหม่
2. ขยาย budget resolver/admission/readiness/admin read สำหรับร้าน `SHARED`: CHAT ใช้ default หรือค่า override ที่มีผล, OCR ใช้เพดานเดิม, TOTAL ยังบังคับ. รักษา `SPLIT` และ failure behavior เดิม; ทดสอบเดือนใหม่, overshoot จำกัด, admin override
3. ทำดีลใหม่ให้ pin ความหมาย CHAT แยกจากดีล v2/v3 ที่ pin TOTAL, และเก็บค่าดีลแยกจากค่า admin; บังคับวันเริ่ม/จบดีลกับ credit โดยไม่เติมซ้ำเมื่อซื้อแพ็กหรืออัปเกรด. ดีลจ่ายครั้งเดียวเก็บวันจบสิทธิ์ใน config เพื่อคืนค่า 80 เมื่อครบกำหนด; ดีลต่ออายุคืนค่าเมื่อ price return และเมื่อขึ้นแพ็ก catalog ใหม่
4. เปลี่ยนข้อความในการ์ดแพ็ก/ฟอร์มดีล/quote เป็น 80 credit แชตต่อเดือน หรือค่าดีลพิเศษ; OCR/ใบเสร็จแยกให้เห็น. ข้อความ CHAT refusal ไม่ชวนเปลี่ยนแพ็กเพื่อเติมเดือนเดิม และต้องเหมือนกันทั้ง webhook กับ ledger reclaim. ตรวจ contract API ↔ web, loading/error/permission และ admin readiness
5. รัน focused tests ของ meter, billing/deal apply, sales form; ตรวจ `git diff --check` และบันทึกผลใน task memory. ก่อนแตะ UAT/Production อ่าน runbooks ตาม `AGENTS.md` และผ่าน release protocol

ข้อจำกัดช่วง rollout: aggregate bucket ของเดือนก่อนโค้ดใหม่อาจไม่ครบ. ยืนยันบน UAT และใช้เดือนปฏิทินไทยเต็มเดือนเป็นหลักฐานสำหรับการบังคับ 80 ที่แม่นยำ. ห้ามอ่านหรือเปลี่ยน production config เพื่ออนุมานค่าจาก repo
