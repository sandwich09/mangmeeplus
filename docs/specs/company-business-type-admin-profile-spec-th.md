# ประเภทธุรกิจ DBD TSIC และข้อมูลร้านใน Admin Console

Owner request 2026-09-17: เพิ่ม dropdown ประเภทธุรกิจที่ ตั้งค่าบริษัท → ข้อมูลร้าน พร้อม อื่น ๆ/ช่องข้อความ และให้ข้อมูลร้านทั้งหมดดูได้จากรายละเอียดบริษัทใน Admin Console

- ใช้กิจกรรม TSIC 5 หลักจาก https://tsic.dbd.go.th/index ครบ 1,098 รายการใน 21 หมวด A–U (ตรวจจาก public SearchCategory API วันที่ 2026-09-17) เก็บ snapshot code/ชื่อไทย/หมวดใน contracts พร้อมหลักฐานที่มา; ไม่เรียก DBD ระหว่างใช้ฟอร์ม ไม่ส่งข้อมูลลูกค้าไป DBD
- เลือกได้หนึ่งประเภท มีการค้นหารหัสหรือชื่อใน dropdown; ยังไม่ระบุได้สำหรับข้อมูลเดิม/กรอกภายหลัง เลือก OTHER ต้องกรอกข้อความ trimmed 1–200 ตัวอักษร; เปลี่ยนไป TSIC/ล้างตัวเลือกต้องล้าง other ที่บันทึก ไม่มี default/เดาประเภทของบริษัทเดิม
- Company.businessTypeCode/businessTypeOther/businessTypeVersion เป็นข้อมูลกิจกรรมที่บริษัทระบุ ไม่แทน Company.businessCategory ซึ่งเป็น PDPA/onboarding tripwire และไม่เปลี่ยนสิทธิ์ แพ็กเกจ การอนุมัติ หรือหลักฐานภาษี
- อ่านผ่าน GET identity เดิมเฉพาะ full legal-identity readers และ Admin Console detail ภายใต้ system.partner_dashboard.read ใช้ Company แถวเดียวกัน ไม่คัดลอกไป signup request
- PATCH companies/:companyId/identity/business-type ใช้ company.legal_identity.manage + assertRouteCompany เดิม ตรวจ code กับ master บน server, OTHER/type/length และ expectedVersion; updateMany CAS ใน transaction กับ audit ค่าชนกัน 409 ไม่ทับของคนอื่น เปลี่ยนประเภทธุรกิจไม่สร้าง legal-identity revision หรือเปลี่ยน legal/VAT latch
- ปุ่มบันทึกข้อมูลร้านปุ่มเดียวส่งเฉพาะส่วนที่เปลี่ยน (legal identity, business type, VAT) แสดงข้อผิดพลาดแยกแต่ละส่วนและคงค่าที่พิมพ์ไว้; client validation ผิดหยุดก่อนส่ง ส่วนที่บันทึกแล้วมีผลจริงแม้อีกส่วนล้มเหลว ตามรูปแบบเดิม
- Admin Console → บริษัท → ภาพรวม → ข้อมูลบริษัท แสดงชื่อจดทะเบียน เลขภาษี ที่อยู่ line1/line2/ตำบล/อำเภอ/จังหวัด/รหัสไปรษณีย์ ประเภทธุรกิจ (รหัส+ชื่อ หรือ อื่น ๆ — ข้อความ) และสถานะ VAT จาก accessor เดิม พร้อมวันที่มีผล ข้อมูลว่างใช้ —/ยังไม่ระบุ คงข้อมูลติดต่อและรู้จักเราทางไหนเดิม
- ขอบเขตคำว่า “ข้อมูลทั้งหมด” คือส่วนข้อมูลร้านในภาพ ไม่รวมรหัสผ่าน/ข้อมูลความปลอดภัยในแท็บบัญชีของฉัน การดูข้อมูลร้านไม่เพิ่มสิทธิ์แก้ไข legal identity ให้ admin
- ผ่าน validation/CAS/audit/tenant-permission tests, save-plan tests และ browser เส้นเลือก/OTHER/บันทึก/เปิดใหม่/admin mirror ที่ mobile/desktop ก่อนส่งมอบ; migration additive และใช้ก่อน reader ใหม่ ไม่มี cloud rollout ในงานนี้
