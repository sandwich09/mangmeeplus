# Account Security Self-Service Summary (TH)

## สถานะ ณ ตอนนี้

- ฟีเจอร์ self-service ของ checklist `02A` และ `02B` ถูกเชื่อมกันผ่านหน้า `Account Security` แล้ว
- ผู้ใช้ที่ล็อกอินอยู่เข้าถึงการจัดการรหัสผ่านจากเมนูชื่อผู้ใช้ด้านล่างสุดของ sidebar โดยมี 2 รายการคือ `Reset password` และ `ออกจากระบบ`; header ไม่มี profile avatar ซ้ำ
- หน้า Login คงไว้เฉพาะลิงก์ `Forgot password?` ใต้ช่องรหัสผ่านสำหรับกรณีเข้าใช้งานไม่ได้ และนำกล่องโปรโมต reset password แยกออกแล้ว
- หน้า `Account Security` เป็นจุดรวมของ recovery email, การเปลี่ยนเส้นทางไป reset password และ `Log out of all other devices`

## Flow หลัก

### 1. ผู้ใช้ยังล็อกอินไม่ได้

1. เปิดหน้า Login
2. กด `Forgot password?`
3. ไปที่ `/forgot-password`
4. กรอก username หรือ email
5. ระบบตอบกลับแบบ generic เหมือนกันทุกกรณี
6. เลือกอีเมล: ถ้าบัญชีมี verified email จะได้รับลิงก์ตั้งรหัสผ่านใหม่ทาง email และเปิด
   `/reset-password` เพื่อกรอกรหัสผ่านใหม่กับยืนยันรหัสผ่านใหม่
7. เลือก LINE: ถ้าบัญชีผูก LINE จะได้รับรหัสชั่วคราว, login ด้วยรหัสนั้น แล้วระบบพาไป
   `/change-password` เพื่อกรอกรหัสผ่านใหม่กับยืนยันรหัสผ่านใหม่

### 2. ผู้ใช้ล็อกอินอยู่และต้องการจัดการรหัสผ่าน

1. เปิด hamburger menu แล้วกดชื่อผู้ใช้ด้านล่างสุด
2. เลือก `Reset password`
3. ระบบพาไป `/change-password`
4. ผู้ใช้ยืนยันรหัสผ่านปัจจุบัน แล้วกำหนดรหัสผ่านใหม่กับยืนยันรหัสผ่านใหม่

### 3. ผู้ใช้ตั้งรหัสผ่านใหม่สำเร็จผ่านอีเมล

1. เปิดลิงก์ `/reset-password?token=...`
2. กำหนดรหัสผ่านใหม่
3. ระบบบันทึกรหัสผ่านใหม่
4. ระบบ revoke ทุก session
5. ผู้ใช้เข้าสู่ระบบใหม่ด้วยรหัสผ่านที่เพิ่งตั้ง

## พฤติกรรมหน้าจอที่ต้องสอดคล้อง

- Sidebar user menu: ต้องมี `Reset password` อยู่เหนือ `ออกจากระบบ` และต้องเปิดจากแถบชื่อผู้ใช้ด้านล่างสุด
- Login page: ต้องไม่มีแผง CTA reset password แยกต่างหากแล้ว
- Settings page: การ์ด `ความปลอดภัยบัญชี` ต้องสื่อว่าหน้านี้ครอบคลุม recovery email, reset password และออกจากระบบอุปกรณ์อื่น

## หมายเหตุการใช้งาน

- `Forgot password?` เป็น public recovery path สำหรับกรณีผู้ใช้เข้าระบบไม่ได้
- `Reset password` ใน sidebar user menu เป็น authenticated entry point สำหรับผู้ใช้ที่เข้าใช้งานอยู่แล้ว
- การข้ามช่องรหัสผ่านปัจจุบันเกิดได้เฉพาะ forced flow ที่ password login เพิ่งพิสูจน์ credential
  เดียวกับที่กำลังเปลี่ยนอยู่; LINE, session เก่า และการเปลี่ยนรหัสผ่านปกติยังต้องยืนยันรหัสผ่านเดิม
- การส่งอีเมลจริงผ่าน SES และ distributed rate limiting ยังเป็นงาน follow-up ตามแผนเดิม
