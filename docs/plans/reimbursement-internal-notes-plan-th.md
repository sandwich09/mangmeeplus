# แผน: โน้ตภายในรายการเบิก

1. [x] เพิ่มตารางโน้ตที่ผูกบริษัทและใบเบิกด้วย foreign key พร้อม migration; แยกจากข้อมูลบัญชีและเอกสาร
2. [x] เพิ่ม contract/DTO, API เพิ่ม แก้ ลบ และแสดงรายการใน detail โดยใช้สิทธิ์อ่านใบเบิกเดิม ตรวจผู้เขียน/เจ้าของบริษัท และบันทึก audit
3. [x] เพิ่มการ์ดโน้ตบนหน้า journey: เขียน ดู แก้ ลบ สะท้อนผลทันที และข้อความ error/loading
4. [x] ตรวจ focused API tests สำหรับสิทธิ์และ validation, typecheck API/Web, ตรวจ diff ไม่ปนงานอื่น และบันทึกผลใน memory

ไม่เปลี่ยน `package.json`, state machine, ใบเบิกพิมพ์, export หรือ LINE/AI
