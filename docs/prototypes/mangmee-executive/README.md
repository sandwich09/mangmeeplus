# ตัวอย่างหน้าผู้บริหารมั่งมี

เปิด [ตัวอย่างหน้าจอ](mangmee-executive-preview.html) ในเบราว์เซอร์ได้โดยตรง ข้อมูลบริษัท อีเมล และเบอร์โทรทั้งหมดเป็นข้อมูลสมมติ ไม่มีการเรียก API หรือเปลี่ยนข้อมูลจริง ปุ่มสร้าง Excel และเพิ่มบัญชีใช้ทดลองขั้นตอนเท่านั้น

ใช้ [สเปกหน้าจอ](../../specs/mangmee-executive-business-ui-spec-th.md), [สเปกหลังบ้าน](../../specs/mangmee-executive-business-backend-spec-th.md) และ [คำที่แสดงให้ผู้ใช้เห็น](../../specs/mangmee-executive-plain-language-spec-th.md) เป็นข้อกำหนดร่วม งานลบข้อมูลยังซ่อนอยู่

ไฟล์นี้เป็นต้นแบบสำหรับตรวจหน้าจอ ไม่ใช่หน้าที่เปิดใช้ในแอปจริง การนำเข้า main/develop ไม่ได้เปิดบริการใหม่หรือเชื่อมฐานข้อมูล

## สร้างและตรวจจาก root ของ repository

ใช้ dependencies เดิมที่ติดตั้งไว้ของ repository และ Playwright Chromium ไม่เพิ่ม package หรือ script ใน package.json

```sh
node docs/prototypes/mangmee-executive/build-preview.cjs
node docs/prototypes/mangmee-executive/check-demo.cjs
node docs/prototypes/mangmee-executive/check-export.cjs
```

`build-preview.cjs` ใช้ components/tokens/fonts ใน apps/web แล้วสร้างไฟล์ HTML ที่เปิดอ่านได้ และ fragment สำหรับแสดงในบทสนทนา ภาพจากการตรวจเป็นไฟล์ในเครื่องที่ไม่ commit

คำสั่งตรวจครอบคลุมการนำทาง กราฟ→รายชื่อ→รายละเอียด→กลับ, ตัวกรอง, เปรียบเทียบ, บัญชีตัวอย่าง, สิทธิ์, สถานะผิดพลาด, ส่งออกตัวอย่าง และขนาดหน้าจอ 320–1440px ไม่ใช่หลักฐานทดสอบ API/ฐานข้อมูลหรือสร้าง Excel จริง
