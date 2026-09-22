# Plan: สถานะ AI ระหว่างเจ้าหน้าที่ดูแล

สถานะ: implemented and locally verified (Owner 2026-09-22); UAT hotfix ถูก block ก่อน mutation เพราะ UAT host enrollment integrity drift

## เป้าหมาย

- ระหว่าง AI pause ข้อความ รูป และไฟล์เข้าถึงเจ้าหน้าที่ แต่ไม่เข้าโมเดล/OCR และไม่มีคำตอบ AI แทรก
- แสดงสถานะ AI ด้วยปุ่มเดียวใน support inbox: เขียวเมื่อทำงาน แดงเมื่อหยุด และกดสลับได้
- ใช้ `LineCompanyContext.aiPausedUntil` เป็น source of truth เดียว เพื่อให้ event LINE และเว็บเห็นสถานะเดียวกัน

## การเปลี่ยนแปลงที่เล็กที่สุด

1. เพิ่ม `assistantActive` ใน support request contract และคำนวณจาก context ตอน list/thread read
2. เพิ่ม admin action `pause-ai`; คง `resume-ai` และให้ทั้งคู่คืนสถานะจริงพร้อม audit
3. เปลี่ยนปุ่มเดิมเป็น stateful toggle โดย modal poll เดิมทุก 10 วินาทีรับการเปลี่ยนจาก LINE/แหล่งอื่น
4. ส่งสถานะ pause ณ ตอน durable acceptance เข้า media lane; หลังเก็บสื่อใน support thread แล้วจบ turn ด้วย deterministic support acknowledgement ก่อน identity/OCR/model
5. เพิ่ม focused API/domain/web tests สำหรับสองสถานะ ปุ่ม และ media pause; ไม่ deploy ในงานนี้

## Acceptance

- ภาพ/ไฟล์ที่ส่งตอน AI หยุดปรากฏในเธรดเจ้าหน้าที่ แต่ไม่เรียก receipt intake/OCR/model และไม่ส่งข้อความกำลังอ่านหรือผล AI
- หน้า support แสดงปุ่มเขียว `AI กำลังทำงาน` หรือแดง `AI ไม่ได้ทำงาน` จากค่าบน server และกดเปลี่ยนได้โดยไม่ปิดเคส
- การกด “ติดต่อเจ้าหน้าที่”/“คุยกับน้องมั่งมี” ทาง LINE สะท้อนที่ปุ่มเมื่อ thread poll รอบถัดไป
- focused tests ผ่านและไม่มีการแก้ `package.json`
- UAT smoke preflight `20260922T101352Z-8758c338` ไม่ผ่านที่ target identity ก่อน source/build/lock/rollout: public IP ใน private target ไม่ตรงกับ instance เดิม และ SSM host-key readback ไม่ตรงกับ enrolled key จึงไม่ re-enroll หรือ retry

## Verification 2026-09-22

- API focused: support admin + LINE buffer + webhook use case ผ่าน
- LINE-first webhook regression ผ่าน
- Web rendered/QA/logic focused tests ผ่าน
- contracts, API และ Web typecheck ผ่าน
- `git diff --check` ผ่าน; ไม่แก้ `package.json` และไม่ deploy
