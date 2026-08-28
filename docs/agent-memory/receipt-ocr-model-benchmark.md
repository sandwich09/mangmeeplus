# Agent Memory: receipt-ocr-model-benchmark

Status: รอบแรกเสร็จ 2026-08-28 — เทียบ Sonnet 4.6 vs Haiku 4.5 สำหรับ stage-1 read ด้วยใบเสร็จจริงจาก UAT

Owner: thawatchai (สั่ง: ทดสอบข้อ 3 ด้วยใบเสร็จจริง "ดึงพวกไฟล์ลายมือมาด้วย" + "รายละเอียดต้องครบ vat wht service charge ส่วนลด บิลเดียวหลายรายการ VAT ผสม")

## วิธีวัด

- ชุดทดสอบ **38 ใบจาก UAT S3** (เฉลย = `ExpenseRecord.grandTotalAmount` ที่คนยืนยันแล้ว) คัดสมดุล 9 ชนิด: ลายมือ 7, ใบกำกับย่อ 5, ใบกำกับเต็ม 5, ใบเสร็จ 5, สลิปโอน 5, NEEDS_REVIEW 5, marketplace/อื่น 6
- **stage 2 คงที่เป็น Sonnet ทั้งสองฝั่ง** → ความต่างที่วัดได้คือคุณภาพการ "อ่าน" ล้วน ๆ
- สิทธิ์ S3 ชั่วคราว `TempUatEvidenceReadForOcrBenchmark` (Owner เปิดให้ 2026-08-28, **ต้องปิดคืน**)
- Harness: `bench2.ts` เรียก `readDocumentText` + `understandReceiptText` ตรง ๆ; รูป >1.5MB ย่อด้วย sips ให้ใกล้ขนาดที่ LINE ส่งจริง

### บทเรียน harness (รอบแรกใช้ไม่ได้ ต้องรันซ้ำ)

- model id Haiku ต้องมี suffix `-v1:0` เต็ม (`global.anthropic.claude-haiku-4-5-20251001-v1:0`) — ถ้าขาดจะได้ PROVIDER_UNKNOWN ใน ~0.4s ทุกใบ **ดูเหมือนโมเดลแย่ทั้งที่ไม่เคยถูกเรียก**
- concurrency 3 + รูปใหญ่ → PROVIDER_THROTTLED 16/38 บน Sonnet; ต้อง concurrency 2 + backoff retry ไม่งั้น throttle ถูกนับเป็น "อ่านพลาด"

## ผล (38 ใบ)

| | Sonnet 4.6 | Haiku 4.5 |
|---|---|---|
| อ่านสำเร็จ | 38/38 | 38/38 |
| ยอดตรงเฉลย | 30 (79%) | 29 (76%) |
| เวลาอ่าน (median) | **16.1s** | **8.4s** |
| เวลาอ่าน (max) | 44.5s | 15.7s |
| ยอดก่อนภาษี (subtotal) | 21 ใบ | **15 ใบ** ← ตกหล่น 6 |
| รายการย่อยรวม | 52 | **48** |
| VAT amount/rate | 21/20 | 21/19 (ตรงกัน 37/38) |
| ส่วนลด | 8 | 8 (ตรงกัน 38/38) |
| ฟิลด์อ่านไม่ออก/ใบ | 2.1 | 2.5 |

ยอดตรงแยกชนิด (Sonnet/Haiku): สลิปโอน 5/5, ใบกำกับย่อ 5/5, ใบกำกับเต็ม 5/5, ใบเสร็จ 4/3, **ลายมือ 3/3 จาก 7**, note 0/0

## ข้อค้นพบที่สำคัญกว่าเรื่องโมเดล

1. **บิล VAT ผสมเก็บไม่ได้เลยในระบบปัจจุบัน** — `ReceiptOcrLineItem` (contracts) มีแค่ description/quantity/amount/unitPrice/evidenceSignal/confidence **ไม่มี vatRate/vatTreatment ต่อรายการ** ขณะที่ `ExpenseLine` ใน DB มีครบ (vatRate, vatTreatment, vatAmount, whtRate, whtAmount) และหน้าเว็บใช้ได้ → ถ่ายรูปบิลที่บางรายการมี VAT บางรายการไม่มี ข้อมูลนั้นหายที่ชั้น OCR ไม่ว่าจะใช้โมเดลใด **นี่คือ gap ของสัญญา ไม่ใช่ของโมเดล**
2. **WHT ทดสอบไม่ได้** — ไม่มีใบไหนใน 38 ใบมีหัก ณ ที่จ่ายเลย (0/38 ทั้งคู่) ต้องหาตัวอย่างเพิ่มก่อนสรุป
3. **เฉลยบางใบไม่ได้มาจากรูป** — EXPENSE_NOTE_TEXT 2 ใบ (ยอดมาจากที่คนพิมพ์) และลายมือ 2 ใบที่อ่านได้ 11,875 แต่เฉลย 12,500 (= ต่างกัน 5% พอดี → คนละนิยาม ก่อน/หลังส่วนลด) ⇒ ความแม่นจริงสูงกว่า 79%
4. **ลายมือคือจุดอ่อนร่วม** 3/7 ทั้งสองโมเดล — แก้ด้วยการเปลี่ยนโมเดลไม่ได้

## VAT ผสมต่อรายการ — implement แล้ว (Owner สั่ง 2026-08-28 "VAT ผสมก่อน ... ให้ความสำคัญกับความถูกต้องมาก")

หลักฐานจากการสำรวจใบจริง 38 ใบ (`mixed-survey.json`):

- **บิล VAT ผสมมีจริง 3/38** (NEEDS_REVIEW 2, RECEIPT 1) — ที่เหลือ VAT ทั้งใบ 25, ไม่มี VAT 12
- **เครื่องหมายที่ใบเสร็จไทยใช้จริง**: `V` ต่อท้ายราคา = แถวนั้นมี VAT; `N` / `P` = ยกเว้น/ไม่คิด; บางใบใช้คอลัมน์ "VAT incl. amount"; ส่วนใหญ่สรุป VAT ก้อนเดียวท้ายบิล
- หลายรายการ 19/38, ส่วนลด 18/38, service charge 2/38, **WHT 0/38** (ยังทดสอบไม่ได้)

สิ่งที่แก้:

1. `ReceiptOcrLineItem` เพิ่ม `vatRate?` + `vatTreatment?` (ZERO_RATED|EXEMPT|NON_VAT) — DB (`ExpenseLine`) มีครบอยู่แล้ว ขาดแค่ชั้นอ่าน
2. prompt สอน marker จริง (V/N/P + คอลัมน์ VAT) และสั่งว่า **ไม่มี marker = ห้ามเดา** ให้ใช้ค่าทั้งใบ
3. gateway parser: รับ per-row VAT **เฉพาะเมื่อ evidenceSignal ของแถวนั้นมี marker จริง**; treatment ต้องคู่กับ rate 0; rate ต้องเป็น 0..1 (7 = misread)
4. api `usableItemLines`: re-validate ซ้ำที่ boundary (gateway เป็นคนละ service) — ผิดรูปแม้แถวเดียว **ทิ้งทั้งชุด** กลับไปใช้ summary line
5. `receipt-ocr-apply`: `vatRate: item.vatRate ?? defaultLineVatRate(fields)` (รูปแบบเดียวกับ additionalCharges) + เขียน `vatTreatment` ลง ExpenseLine เฉพาะเมื่อ rate เป็น 0
6. Safety เดิมทำงานต่อ: `reconcileOcrTotals` ไม่เทียบ taxable เมื่อ rate ต่างกัน แต่ยังเทียบ **VAT รวม + grand total** → per-row ที่อ่านผิดทำให้ split ถูก reject ไม่ถูกบันทึก

Verify: gateway suite **998/998**, api receipt-ocr-apply + draft-validation specs ผ่าน, typecheck สะอาดทั้งสอง app; เทสใหม่ 9 เคส (gateway 4 + api 5)

## Next

- ตัดสินใจเรื่อง Haiku: ใช้เป็น reader เฉพาะชนิดที่พิสูจน์แล้วว่าเท่ากัน (สลิปโอน/ใบกำกับย่อ) และคง Sonnet สำหรับใบกำกับเต็ม/บิลหลายรายการ — intake router บอก documentKind มาก่อนถึง OCR อยู่แล้ว
- ปิดสิทธิ์ S3 ชั่วคราวคืน: `aws iam delete-user-policy --user-name watchdog-bedrock-dev --policy-name TempUatEvidenceReadForOcrBenchmark`
- ถ้าจะรองรับ VAT ผสมจริง ต้องขยาย `ReceiptOcrLineItem` + prompt + การเขียนลง ExpenseLine (งานคนละก้อน มีของรองรับใน DB แล้ว)
