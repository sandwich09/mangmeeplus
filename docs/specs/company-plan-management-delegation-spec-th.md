# สิทธิ์มอบหมายการจัดการแพ็กเกจบริษัท

วันที่: 2026-09-23
สถานะ: implement และตรวจ browser E2E ผ่านบน worktree ที่สร้างจาก `main` (26 กันยายน 2569)
ผู้ขอ: เจ้าของผลิตภัณฑ์

## เป้าหมาย

ให้ OWNER มอบสิทธิ์จัดซื้อและจัดการแพ็กเกจบริษัทแก่ role ที่บริษัทสร้างเองได้ โดยสิทธิ์ผูกกับ permission กลาง ไม่ผูกกับชื่อหรือตำแหน่งงาน เช่น CEO, CTO หรือ CBO เพราะแต่ละ SME ตั้งชื่อบทบาทไม่เหมือนกัน

## เส้นทางหลัก

1. OWNER สร้างหรือแก้ role บริษัทในหน้าจัดการสิทธิ์
2. OWNER เลือกชุดสิทธิ์ “จัดการแพ็กเกจและการชำระเงิน” ให้ role นั้น
3. บริษัทมอบหมาย role ที่ตั้งชื่อเองให้สมาชิก
4. สมาชิกที่มี permission นี้เข้าหน้าซื้อ/เปลี่ยนแพ็กเกจและจัดการ billing ได้ ทั้งจากหน้า billing, ตัวเลือกบริษัท, quota CTA และหน้าแจ้งหมดอายุ
5. สมาชิกยังแก้การตั้งค่าบริษัทได้ตาม permission เฉพาะของการตั้งค่านั้น ไม่ได้รับสิทธิ์ OWNER ทั้งชุด

## ตัวอย่าง

OWNER สร้าง role ชื่อ “CFO” แล้วเลือกชุดสิทธิ์ “จัดการแพ็กเกจและการชำระเงิน”, “ตั้งค่าบริษัท” และ “แก้ไขข้อมูลจดทะเบียน/VAT” จากนั้นมอบ role นี้ให้พนักงานคนนั้น สมาชิกจึงเข้า Billing ซื้อหรือขอเปลี่ยนแพ็กเกจ และแก้ข้อมูลบริษัทในส่วนที่เลือกได้ หากเปลี่ยนชื่อ role เป็น “ผู้ดูแลบริษัท” สิทธิ์ยังเหมือนเดิม เพราะผูกกับ permission ไม่ใช่ชื่อ role

## กติกา

- เพิ่ม `company.plan.manage` เป็น company permission และ `pack.company.plan.manage` เป็นชุดสิทธิ์ภาษาธุรกิจใน role builder
- OWNER ได้ `company.plan.manage` โดยอัตโนมัติจาก `ROLE_GRANTS.OWNER = COMPANY_PERMISSION_KEYS`
- มอบ `company.plan.manage` ให้ role ได้เฉพาะผู้ใช้ที่เป็น OWNER จริงในบริษัทนั้น แม้ผู้มอบหมายจะได้รับ permission นี้ผ่าน role อื่นก็ตาม
- การอนุญาตซื้อ/จัดการแพ็กเกจตรวจ ACTIVE membership, ACTIVE role และ permission นี้ในบริษัทเป้าหมาย ห้ามตัดสินจาก role key, role name หรือตำแหน่งงาน
- `company.setup.manage`, `company.legal_identity.manage` และ `company.vat_registration.manage` ยังคงแยกจากกัน การแก้หน้า setup ใช้ permission ที่ route นั้นกำหนด
- การกู้คืนข้อมูลบริษัทหลังหมดอายุเปิดเฉพาะ route ที่มี permission ตรงกับการอ่านหรือแก้ไขนั้น; billing recovery ใช้ `company.plan.manage`
- `OWNER` ยังแทนเจ้าของบัญชีจริงสำหรับ legal representative, ownership transfer และการคุ้มครอง OWNER คนสุดท้าย
- การซื้อยังผ่านเงื่อนไข billing, payment, approval, tenant, audit และสถานะบริษัทเดิมครบถ้วน สิทธิ์นี้เพียงอนุญาตให้เริ่ม flow ที่มีอยู่

## สัญญาและข้อมูล

- เพิ่ม permission ใน `PERMISSIONS`; OWNER ได้รับผ่าน grant ปัจจุบันโดยไม่ต้องเพิ่ม system role หรือ schema migration
- Capability pack เป็นชั้น author-time และ compile เป็น `RolePermission` เหมือนชุดสิทธิ์อื่น
- runtime ใช้ permission ที่ resolver ส่งใน request context และ API ตรวจ active membership/role ซ้ำสำหรับ billing
- ไม่สร้าง role ชื่อตำแหน่งมาตรฐาน และไม่ทำให้ role ชื่อใดได้สิทธิ์พิเศษจากชื่อ

## เกณฑ์ยอมรับ

1. OWNER เห็นและมอบชุดสิทธิ์แพ็กเกจให้ custom role ที่ตั้งชื่อได้เอง
2. ADMIN หรือ role ที่ไม่ใช่ OWNER มอบ `company.plan.manage` ให้ role ไม่ได้ แม้จะได้รับ permission นี้จากการมอบหมาย
3. สมาชิกที่มี custom role พร้อม permission และ ACTIVE membership ใช้ billing/package-change flow ได้; role ชื่ออะไรก็ได้
4. สมาชิกที่ไม่มี permission, มี inactive role หรือ membership ไม่ active ถูกปฏิเสธ
5. BillingCompanyPicker, company switcher, branch quota CTA, term warning/expired page และ API ใช้ permission เดียวกัน
6. recovery ของ company profile เช็ค permission read/manage เฉพาะ route; สิทธิ์ billing ไม่ทำให้แก้ legal identity ได้
7. E2E และ regression ครอบคลุมการสร้าง/มอบสิทธิ์, purchase entry points และ flow ที่หมดอายุ เมื่อมี harness รองรับ

## นอกขอบเขต

- ไม่เพิ่ม CEO/CTO/CBO เป็น system role หรือให้ role เทียบเท่า OWNER ทุก permission
- ไม่เปลี่ยน permission การจัดซื้อสินค้าภายใน ซึ่งใช้ permission procurement เดิม
- ไม่ขยาย legal ownership, platform admin, sales-console หรือการอนุมัติ/จ่ายเงินภายใน
- ไม่ deploy
