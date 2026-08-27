# Company OCR Governance — Local Browser Evidence

วันที่: 2026-08-27 (Asia/Bangkok)
สภาพแวดล้อม: local web `:3000`, local API `:3001`, local PostgreSQL/Redis
ผู้ทดสอบ: seed Platform Admin ผ่าน Chrome session แยกสำหรับ QA

## หลักฐานภาพ

- `platform-admin-ocr-desktop.jpg` — 1440x1000, สถานะเปิด/ไม่จำกัด แสดง OCR reads,
  คงเหลือ, uploaded receipt count และ source breakdown; ช่อง LINE ระบุชัดว่าเป็นรูปที่ AI ตรวจ
- `platform-admin-ocr-mobile-disabled.jpg` — 390x844, สถานะปิด + คำอธิบายว่าผู้ใช้ยังอัปโหลด
  เปิดเอกสารเดิม และกรอกเองได้ พร้อม layout แบบคอลัมน์เดียว

## เส้นทางที่จิ้มจริง

1. เปิด `/system/partners/seed-local-company` และตรวจ OCR card
2. ตั้ง limit จากไม่จำกัดเป็น 250 แล้วบันทึก; UI แสดงคงเหลือ 250
3. ปิด switch และบันทึก; modal อธิบายผลกระทบก่อนยืนยัน
4. หลังปิด UI แสดงคำเตือนและยังแสดง usage/upload metrics
5. เปิดกลับ, ล้าง limit เป็นไม่จำกัด, บันทึก และ reload
6. หลัง reload ยืนยัน `enabled=true`, `monthlyLimit=null`; console error/warn = 0
7. ที่ viewport 390x844 วัดช่อง limit = 44px/16px, ปุ่มบันทึก = 44px และ switch = 44px
8. แตะสวิตช์แต่ยังไม่บันทึก: badge ยังแสดงสถานะจริงว่าเปิดอยู่, มีข้อความ “ยังไม่ได้ปิด”
   และยังไม่แสดง banner ว่า OCR ปิดแล้ว; หลังยืนยันบันทึกจึงเปลี่ยนเป็น “ปิดใช้งานอยู่”

ค่าบริษัทถูกคืนค่าเดิมหลัง QA แล้ว การเปลี่ยนทุกครั้งยังคง audit rows ตามพฤติกรรมที่ตั้งใจไว้
ไม่มี cloud environment ถูกอ่านหรือแก้ไขในงานนี้
