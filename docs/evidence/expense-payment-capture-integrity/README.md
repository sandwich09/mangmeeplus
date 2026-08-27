# หลักฐานเก็บรายจ่ายและการจ่ายเงิน — 27 สิงหาคม 2569

ขอบเขต: เก็บข้อมูลรายจ่าย/วันที่จ่ายจริงและป้องกันการกดซ้ำหลังคำตอบขาดหาย
ไม่ใช่การเชื่อมธนาคาร กระทบยอด ลงบัญชีอัตโนมัติ หรือการรับรองภาษี
ทุกภาพ/รายการเป็นข้อมูลทดสอบ local ไม่ใช่เอกสารลูกค้าจริง

## ภาพที่ตรวจด้วยตาแล้ว

| ภาพ | สิ่งที่พิสูจน์ / ข้อจำกัด |
|---|---|
| [Chrome desktop](chrome-manual-draft-desktop.jpg) | กรอกและบันทึกร่างด้วยมือจาก Chrome จริง 1280×900; ไม่ยืนยันและไม่จ่าย |
| [Chrome mobile](chrome-manual-draft-mobile-totals.jpg) | ร่างเดียวกันที่ 390×844 ยอด 100 บาท; ไม่ล้นแนวนอน; ไม่ใช่อุปกรณ์มือถือจริง |
| [คำตอบขาดหาย](expense-payment-lost-response-desktop.png) | EXP-27 ส่ง payment จริงสำเร็จ 201 ก่อนจำลองตัดคำตอบ; ข้อผิดพลาดสีแดงในภาพเป็นสถานการณ์ที่จงใจทดสอบ และคำแนะนำกดซ้ำยังอยู่ |
| [กดซ้ำบนมือถือ](expense-payment-replayed-mobile.png) | EXP-27 กดซ้ำด้วย body/key/วันที่เดิม หลังขยับนาฬิกา 61 วินาที: ประวัติหนึ่งรายการ 40 บาท ค้าง 60 บาท; รอ error toast เดิมหมดอายุก่อน capture |
| [จ่ายสำเร็จแต่โหลดหน้าล่าสุดไม่ได้](expense-payment-saved-refresh-failed.png) | EXP-29 payment POST จริง; จำลอง 500 เฉพาะ GET ถัดมา หน้าจอแจ้งว่าบันทึกแล้วและยังคงยอด/intent เดิม |
| [โหลดสำเร็จหลัง retry](expense-payment-refreshed-on-replay.png) | EXP-29 POST ซ้ำด้วย intent เดิม ได้ประวัติหนึ่งรายการ 40 บาท ค้าง 60 บาท |

PNG เป็น viewport screenshots จาก Chromium E2E ที่ใช้หน้าเว็บ/BFF/API จริง
ไม่ใช่ภาพ mockup; JPEG เป็น Chrome ที่ root คลิกเอง ภาพแสดงจุดที่ตรวจ ไม่ได้
รับรองว่าทุกส่วนของหน้ายาวผ่าน human usability หรือ physical-device acceptance แล้ว
เอกสารทดสอบ EXP-27–29 ใช้ receipt PNG สังเคราะห์ขนาดเล็กสำหรับ attachment lifecycle
จึงไม่ใช่หลักฐานคุณภาพ OCR/ความอ่านได้ของเอกสารจริง หรือความถูกต้องในการหัก VAT

## ตรวจย้อนกลับกับข้อมูล

[payment-api-proof.json](payment-api-proof.json) เป็น projection ของ JSON attachments
จากรายงาน Playwright ที่ผ่าน: เก็บ request body, key, response status, payment ID,
ยอดก่อน/หลัง, ledger periods และสถานะหลัง cleanup; ไม่เก็บ URL เอกสาร/ข้อมูล storage

- EXP-27: ยอด 100 จ่ายเงินสด 40 วันที่ `2026-07-31` สองคำขอที่ body เหมือนกันทุก byte
  ได้ payment ID เดียวกัน ค้าง 60; paid ledger เดือนกรกฎาคมเพิ่ม 40 เดือนสิงหาคมเพิ่ม 0
  `pageerror`/unexpected console errors เป็นศูนย์; ยกเว้นเฉพาะ `ERR_FAILED` ที่จงใจสร้าง
- EXP-28: mock เฉพาะ payment POST errors 400 → 403 → network → 403 → conflict409;
  ไม่มี payment POST ถูกส่งเข้า API ยอดจริงยัง 0/100 และไม่มี payment row
  ใช้พิสูจน์ข้อความ/การคง intent/การแก้ไข ไม่ใช่หลักฐาน backend authorization
- EXP-29: POST จริงสองครั้ง 201; mock เพียง detail GET หนึ่งครั้งเป็น 500;
  ยังคง payment ID เดียว 40/60 และไม่มี expense error banner
- หลังแต่ละเคส ใช้ endpoint void ปกติกับเอกสารที่เคสนั้นสร้างเองเท่านั้น
  ยอดจ่ายกลับ 0, payment เป็น VOIDED; เก็บเอกสารและ receipt ไว้ ไม่ hard-delete
- ร่าง Chrome ที่เก็บไว้: `cmtazlakn001sq6k1ladnx7yz`, ชื่อ
  `CHROME-EXPENSE-CAPTURE-20260827 ทดสอบค่าอุปกรณ์ ไม่ใช่รายการจริง`,
  DRAFT / NO_VAT / ยอด100 / จ่าย0 / ค้าง100 ไม่มี receipt และยังยืนยันไม่ได้
  ใช้บัญชี Owner fixture ใน DB แยก (ยอมรับ legal gates ของบัญชีทดสอบนี้เท่านั้น)

## วิธีรันซ้ำ

ใช้ DB แยก `watchdog_expense_payment_capture_20260827`, Redis DB15 และ MinIO bucket
`expense-payment-capture-20260827` ที่เปิด versioning บนเครื่อง local เท่านั้น
API อยู่ `127.0.0.1:3003/v1`; web อยู่ `127.0.0.1:3000`
ขั้นตอนเริ่มระบบอยู่ใน [task memory](../../agent-memory/expense-payment-capture-integrity.md)
ห้าม rerun bootstrap บน DB ที่มีข้อมูลแล้ว และห้ามชี้คำสั่งนี้ไป shared/live environment

```sh
S3_E2E=1 API_PORT=3003 E2E_API_BASE_URL=http://127.0.0.1:3003/v1 \
  E2E_WEB_BASE_URL=http://127.0.0.1:3000 PLAYWRIGHT_HTML_OPEN=never \
  PLAYWRIGHT_JSON_OUTPUT_FILE=test-results/expense-payment-report.json \
  pnpm exec playwright test e2e/expenses.spec.ts --project=chromium \
  --workers=1 --reporter=list,html,json
```

Generated full report: `playwright-report/index.html`; raw artifacts: `test-results/`
(ไม่ commit ทั้งสอง directory); ไฟล์หลักฐานที่เลือกไว้ด้านบน commit ไปกับ phase นี้
ผล full local suite: **21/21 passed, zero skipped** ก่อน integration;
ผลหลัง rebase และ CI/merge ให้ยึด task memory ฉบับล่าสุด

## Review และขอบเขตการส่งมอบ

Opus5 max พบจุด first-4xx กับ post-write refresh; แก้และมี regression ทั้งสองกรณี
root ตรวจ code/transaction และภาพจริงเอง ไม่มีคำกล่าวว่า Opus final verdict เป็น APPROVE
รายละเอียด disposition/ผลทดสอบอยู่ใน task memory
Migration เพิ่ม nullable intent pair + CHECK + unique index เท่านั้น ไม่ backfill เดายอดเก่า
การใช้กับ Production ต้องทบทวนเวลาล็อกตารางและ deployment protocol ก่อน
ยังไม่ใช่การอนุมัติ main/Production หรือการปิด P27/P28 ทั้งหมด
