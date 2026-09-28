# Plan: ช่องแก้ชื่อ Owner

สถานะ: Implemented และตรวจเฉพาะจุดผ่าน — ใช้ [spec ฉบับย่อ](../specs/admin-member-display-name-interim-spec-th.md) แทนขอบเขตฉบับยาวเดิม

1. เพิ่มคำสั่งแก้ชื่อใน PartnerController ตาม member-action pattern เดิม รับชื่อใหม่และชื่อเดิม ตรวจ permission/Owner membership/protected account แล้ว conditional update User พร้อม audit ใน transaction ไม่ส่งหรือเขียนข้อมูลติดต่อ
2. เพิ่มช่องชื่อและบันทึก/ยกเลิกบนแถว Owner ใน MembersSection; ใช้ permission และ form/error patterns เดิม ไม่เพิ่ม reason form หรือ revision ใน members response
3. ทดสอบ focused API สำหรับ Owner ไม่มี employee profile, validation, permission/target, ชื่อถูกแก้พร้อมกัน และ atomic audit; ตรวจ browser เส้นทาง Console save → reload ด้วย fixture
4. บันทึกผลตรวจใน memory และตรวจ diff เฉพาะงานนี้ ไม่มีการแก้ employee writer, name formatter, schema, dependency หรือ package.json

ผลตรวจ: API 52, Web QA 10 และ Chromium 1 เคสผ่าน; API/Web typecheck ผ่าน รายละเอียดใน [memory](../agent-memory/admin-member-display-name-interim.md)

ถัดไป: ผู้ใช้สั่ง admin merge เข้า main และ develop โดยไม่รอ CI; ไม่มีคำขอ deploy
