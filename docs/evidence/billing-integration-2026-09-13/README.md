# Stripe/Postmark final local acceptance

> **Browser CI correction — 2026-09-16:** ตัวทดสอบคิวเคสจับ response ของหน้า Next.js แทน API; ยืนยันด้วยกรณีจำลอง browser ช้าแล้ว แก้ให้รอ API/URL/แถวตรงกันและตรวจชุดท้ายของ CI บนเครื่องครบ ดู [หลักฐานแก้ browser CI](ci-browser-correction-result.json). โค้ดผลิตภัณฑ์ไม่เปลี่ยนจาก bcb11ae7; สถานะ merge ล่าสุดติดตามใน [PR558](https://github.com/MangmeeDev/mangmeeplus/pull/558).

> **CI fixture correction — 2026-09-16:** แก้ตัวทดสอบที่ใช้ preview429 ต่อโดยไม่ตรวจผล; โค้ดผลิตภัณฑ์ไม่เปลี่ยนจากbcb11ae7. ตรวจ forced HTTP6, browser7 และชุด API เต็มแบบ CI256 กลุ่มผ่านแล้ว ดู [หลักฐานแก้ CI](ci-correction-result.json). Marketing merge develop/main แล้ว; core รอ CI ของ revision แก้ก่อน Admin merge. ผล333กลุ่มด้านล่างยังเป็นหลักฐาน source ที่ระบุไว้เดิม.

สถานะ 2026-09-16: โค้ดตามขอบเขตที่อนุมัติและการตรวจภายในเครื่องผ่านแล้ว Marketing merge develop/main หลัง CI ผ่านแล้ว; ระบบหลักกำลังส่ง revision แก้ตัวทดสอบเข้า CI ก่อน Admin merge develop/main. ยังไม่ deploy หรือเปิดรับเงินจริง.

- [ผลปัจจุบันและคำสั่งทดสอบ](final-integration-result.json): ชุดรวม 333 กลุ่ม, ชุดสิทธิ์พักเก็บเงิน/แถมวัน 27 กลุ่ม, สมัคร 8 กลุ่ม, ยืนยันอีเมล 6 กลุ่ม และกู้รหัส 7 กลุ่ม. จำนวนซ้ำกัน ห้ามรวมเป็นจำนวน flow.
- [แผนที่ 57 กลุ่ม acceptance](final-acceptance-map.md): CT 33 กลุ่ม รวม CT24a และ AP 24 กลุ่ม ผูก implementation กับหลักฐานจริง และระบุจุดที่ใช้ regression แทน browser.
- [Source ที่ตรวจ](final-source-receipt.json): hash ของ runtime/test/workflow พร้อมรายการต่างจากชุดรวมและผลเฉพาะที่ตรวจความต่างนั้น.
- Admin แก้แพ็กเกจ/วัน/ใบเสร็จ/AI มีผู้แก้ เหตุผล ค่าเดิม/ใหม่ และการอนุมัติตามชนิดงาน; [พักเก็บเงิน](admin-collection-control-mobile.png), [แถมวัน](admin-free-days-mobile.png), [ประวัติอีเมล](admin-email-retention-mobile.png), [preset ฟีเจอร์](admin-feature-preset-mobile.png).
- API 7448 tests, web 1725 tests และ LINE source กับ PostgreSQL 78 tests ผ่าน. Contracts/marketing/whole-chain/typecheck/maintenance pins ผ่าน. Security audit ไม่มี high/critical; low/moderate ยังตามผล audit.

## ขอบเขตการพิสูจน์

ใช้ Nest HTTP, PostgreSQL, Next/Chromium และ marketing จริงในเครื่อง โดยจำลอง Stripe/Postmark/LINE transport. ตรวจจ่าย/ไม่จ่าย/ซ้ำ/ผลตอบกลับหาย/หมดอายุ/ลดสิทธิ์/ถอนสิทธิ์/กลับหน้าเดิมตามหลักฐาน. ไม่ใช่การรับรองทุก permutation หรือการใช้งาน provider จริง.

การสมัครอีเมลใช้ตรวจคำขอ → claim → ตั้งรหัส/บัญชีเดิม → ใช้งาน → กลับเข้า/กู้รหัสผ่าน Postmark โดยไม่บังคับ LINE. การสมัครแบบ OTP/passwordless และ auto-provision เป็นงานอีก branch แยกจากหลักฐาน billing ชุดนี้. ก่อนเปิดเงินจริงต้องตรวจ Stripe account capability, deployed Postmark secret/webhook/inbox และ native LINE iOS/Android ตาม runbook. [ผล native Postmark SMTP เดิม](../postmark-native-delivery-2026-09-15.md) ไม่แทนผลแอปที่ deploy.

## ทำซ้ำ

ใช้ฐานข้อมูล PostgreSQL แยกที่ migrate แล้วและ config จำลองที่ไม่เปิด provider จริง. Compile contracts/config และ API ด้วย SWC decorator metadata. เรียก compiled `scripts/billing-http-smoke.js`; เปิด `BILLING_BROWSER_E2E=1` และชี้ `MANGMEE_MARKETING_DIR` ไป sibling checkout สำหรับชุดรวม. ชุด signup/email verification/reset ใช้ flags ใน result. ห้ามรัน browser และชุดที่แก้ global fixtures พร้อมกัน. ไม่ log secret และไม่แก้ production limiter.

[ประวัติ checkpoint เดิม](README-history-through-2026-09-15.md) เป็นหลักฐานแต่ละช่วง ไม่ใช่รายการงานค้างปัจจุบัน. [Task memory](../../agent-memory/stripe-postmark-implementation-status-2026-09-13.md) ระบุสถานะส่งมอบล่าสุด.
