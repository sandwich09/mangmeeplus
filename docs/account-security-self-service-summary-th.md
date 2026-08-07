# Account Security Self-Service Summary (TH)

## สถานะ ณ ตอนนี้

- ฟีเจอร์ self-service ของ checklist `02A` และ `02B` ถูกเชื่อมกันผ่านหน้า `Account Security` แล้ว
- ผู้ใช้ที่ล็อกอินอยู่เข้าถึงการจัดการรหัสผ่านจากเมนู profile ด้านบนขวา โดยมี 2 รายการคือ `Reset password` และ `ออกจากระบบ`
- หน้า Login คงไว้เฉพาะลิงก์ `Forgot password?` ใต้ช่องรหัสผ่านสำหรับกรณีเข้าใช้งานไม่ได้ และนำกล่องโปรโมต reset password แยกออกแล้ว
- หน้า `Account Security` เป็นจุดรวมของ recovery email, การเปลี่ยนเส้นทางไป reset password และ `Log out of all other devices`

## Flow หลัก

### 1. ผู้ใช้ยังล็อกอินไม่ได้

1. เปิดหน้า Login
2. กด `Forgot password?`
3. ไปที่ `/forgot-password`
4. กรอก username หรือ email
5. ระบบตอบกลับแบบ generic เหมือนกันทุกกรณี
6. ถ้าบัญชีมี verified email จะได้รับลิงก์ reset password ทาง email

### 2. ผู้ใช้ล็อกอินอยู่และต้องการจัดการรหัสผ่าน

1. กด icon profile ที่ header
2. เลือก `Reset password`
3. ระบบพาไปหน้า `Account Security`
4. ผู้ใช้จัดการ recovery email, resend verification link หรือทำรายการด้าน security อื่นต่อได้

### 3. ผู้ใช้รีเซ็ตรหัสผ่านสำเร็จ

1. เปิดลิงก์ `/reset-password?token=...`
2. กำหนดรหัสผ่านใหม่
3. ระบบบันทึกรหัสผ่านใหม่
4. ระบบ revoke session อื่นทั้งหมด
5. ระบบ sign in ให้อัตโนมัติด้วย session ใหม่

## พฤติกรรมหน้าจอที่ต้องสอดคล้อง

- Profile menu: ต้องมี `Reset password` อยู่เหนือ `ออกจากระบบ`
- Login page: ต้องไม่มีแผง CTA reset password แยกต่างหากแล้ว
- Settings page: การ์ด `ความปลอดภัยบัญชี` ต้องสื่อว่าหน้านี้ครอบคลุม recovery email, reset password และออกจากระบบอุปกรณ์อื่น

## หมายเหตุการใช้งาน

- `Forgot password?` เป็น public recovery path สำหรับกรณีผู้ใช้เข้าระบบไม่ได้
- `Reset password` ใน profile menu เป็น authenticated entry point สำหรับผู้ใช้ที่เข้าใช้งานอยู่แล้ว
- การส่งอีเมลจริงผ่าน SES และ distributed rate limiting ยังเป็นงาน follow-up ตามแผนเดิม
