# แผนประเภทธุรกิจแหล่งเดียวหลังเปิดร้าน

1. ลบ field หมวดกว้างและ tripwire จาก onboarding, signup approval/provision และ shared contract; คงข้อมูล free text ของคำขอเก่าไว้เป็นประวัติเท่านั้น
2. ลบตัวเลือกหมวดกว้างใน UI ของ queue และ manual onboarding รวมทั้งช่อง free text ในฟอร์มสมัครสาธารณะ; ให้การเลือก TSIC ในข้อมูลร้านเป็นทางแก้ไขเดียว
3. เพิ่ม migration ลบคอลัมน์/enum เก่าโดยไม่เดารหัส TSIC สำหรับบริษัทเดิม และปรับ Prisma schema กับ fixture ที่อ้างคอลัมน์เก่า
4. ปรับเอกสาร PDPA และสเปกเดิมให้ชี้มติล่าสุด; ตรวจ API/web logic, Prisma generation, typecheck และ focused tests

Scope: local code and docs only; ไม่มี deploy ในงานนี้
