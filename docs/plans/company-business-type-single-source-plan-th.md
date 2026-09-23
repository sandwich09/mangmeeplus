# แผนประเภทธุรกิจแหล่งเดียวหลังเปิดร้าน

1. ลบ field หมวดกว้างและ tripwire จาก onboarding, signup approval/provision และ shared contract; คงข้อมูล free text ของคำขอเก่าไว้เป็นประวัติเท่านั้น
2. ลบตัวเลือกหมวดกว้างใน UI ของ queue และ manual onboarding รวมทั้งช่อง free text ในฟอร์มสมัครสาธารณะ; ให้การเลือก TSIC ในข้อมูลร้านเป็นทางแก้ไขเดียว
3. ขึ้นโค้ดที่ไม่อ่าน/เขียนหมวดเก่าและ Prisma schema ใหม่ก่อน โดย migration ขั้นแรกไม่ลบข้อมูล เพื่อให้ API รุ่นเก่ายังใช้งานได้ระหว่าง rollout
4. สำรองและซ้อมบน clone จากฐานข้อมูลจริง ตรวจจำนวนแถวที่มีค่าและทุกบริการว่าใช้โค้ดใหม่แล้ว จึงใช้ contract migration ที่ review แยกเพื่อลบคอลัมน์/enum เก่าโดยไม่เดารหัส TSIC สำหรับบริษัทเดิม; ตรวจ schema และข้อมูลหลังลบก่อนจบงาน
5. ปรับเอกสาร PDPA และสเปกเดิมให้ชี้มติล่าสุด; ตรวจ API/web logic, Prisma generation, typecheck และ focused tests

Scope เดิม: local code and docs only. การ deploy และ contract migration อยู่ในรอบปฏิบัติการ 2026-09-23 ที่เจ้าของสั่งแยกไว้
