# Receipt one-pass cost benchmark — 2026-09-21

## Outcome

ผลรอบแรก **ไม่ผ่าน** และถูกใช้หาบัคต่อ ไม่ได้นำตัวเลขที่แพงขึ้นไปอ้างเป็นผลสำเร็จ:

- before/after 2 รอบบน corpus รูป 9 เคสเดียวกันพบ after `onePassReceipts=0`, ค่าเฉลี่ยต่อ successful task `฿1.54 → ฿1.56` และ total cost `฿23.11 → ฿24.97`
- หลังแก้ evidence/gate mismatch, warm corpus 9 เคสลดเหลือ `฿1.27/successful task`, 2 one-pass และ 26 calls จาก baseline warm `฿1.57`, 0 one-pass และ 30 calls
- warm run ดังกล่าวพบ tax-invoice vendor OCR สะกด `ซ` เป็น `ช`; แม้ specialist baseline ก็พลาด field เดียวกัน แต่ไม่ยอมให้ cost optimization ข้ามโอกาสตรวจซ้ำ จึงจำกัด one-pass final ไว้ที่ `RECEIPT` และ `HANDWRITTEN_CASH_BILL`; tax invoice ทุกชนิดกลับ specialist OCR
- exact final code พิสูจน์ handwritten cash bill 2/2 รอบ: 1 call/ใบ, `฿0.63` และ `฿0.64`, ยอด/วันที่/vendor ถูกครบ
- งบ provider รวม smoke, before/after, bounded diagnostics และ final checks = **฿85.49** จากกรอบประมาณ ฿90 จึงหยุด ไม่รัน final full corpus 2 รอบเพิ่ม

ดังนั้นเป้า `< ฿1.50/successful image` **ผ่านใน warm full-corpus follow-up** แต่ checklist final 2-pass cold/warm ยังเปิดอยู่ ต้องรัน exact final SHA เต็ม 9 เคส × 2 เมื่ออนุมัติงบเพิ่ม ห้ามอ้าง warm/targeted evidence นี้เป็น UAT หรือ Production acceptance

## Reproducibility

- AWS profile/region: `watchdog-bedrock`, `ap-southeast-1`
- model/document model: `global.anthropic.claude-sonnet-4-6`
- FX: `33 THB/USD`
- corpus hash: `ae237f275d85a1d8e1be5a44f4325822d6f35d148ef2bac1415a0874f581ab83`
- before SHA: `2986fba6fda4aa681a4809d4bedf91e8c4234cfa`
- first implementation SHA: `88600c63c2721c3554cb038ecaf37a2396f8db2c`
- warm follow-up SHA: `b01636f2ac3a2389bae17b089642092c317eed77`
- final safety SHA: `5e7947dcd2ee64dd8c321e3f9987a84734374141`
- raw local evidence root: `/tmp/receipt-one-pass-benchmark-20260921.GmbPh9/results`
- cumulative ledger: `/tmp/receipt-one-pass-benchmark-20260921.GmbPh9/results/spend-ledger.jsonl`

รูปทั้ง 9 รายการมี SHA-256 ตรงกันก่อน/หลัง; ไม่มี provider error, parse failure หรือ truncation ใน before/after และ warm follow-up

## Before / after

| run | tasks | successful | calls/task | one-pass | THB total | THB/attempted | THB/successful |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline, 2 passes | 18 | 15 | 3.33 | 0 | 23.11 | 1.28 | 1.54 |
| first implementation, 2 passes | 18 | 16 | 3.44 | 0 | 24.97 | 1.39 | 1.56 |
| baseline warm pass | 9 | 7 | 3.33 | 0 | 10.96 | 1.22 | 1.57 |
| follow-up warm pass | 9 | 8 | 2.89 | 2 | 10.20 | 1.13 | 1.27 |

Warm follow-up เทียบ baseline warm:

- provider calls `30 → 26` (`-13.3%`)
- total cost `฿10.96 → ฿10.20` (`-6.9%`)
- cost/successful `฿1.57 → ฿1.27` (`-18.6%`)
- `ocr.receipt.extract` calls `12 → 10`; `image-reread` คง `4`; `image-read` `5 → 3`
- field accuracy follow-up: total `5/5`, date `5/5`, VAT `1/1`, vendor `4/5`; baseline 2-pass vendor รวม `7/10` และ VAT case เป็น known miss อยู่แล้ว

## Bugs found and closed

1. Router ส่ง receipt candidate แต่ classification มี `settlementSignals=[]` ทั้งที่ transcription มี `ใบเสร็จรับเงิน`/`บิลเงินสด`; server จึง recover เฉพาะ exact printed settlement span
2. `amountSignals` อาจว่างทั้งที่ grand total ผ่าน numeric cross-check; server bind exact printed total token ก่อน business gate
3. Markdown table pipes ทำให้ row evidence ที่เป็นข้อมูลเดียวกันไม่ byte-equal; server ใช้ได้เฉพาะหนึ่ง source line ที่มีทั้ง description และ amount เดียวกัน
4. Model อาจคำนวณ unit price ที่ไม่ได้พิมพ์; server ทิ้งเฉพาะ unprinted unit price ไม่ทิ้ง source-grounded row ทั้ง block
5. `MISSING_VENDOR_TAX_ID`/`MISSING_DOCUMENT_NUMBER` ไม่บล็อกใบเสร็จทั่วไป/บิลเงินสด แต่ยังบล็อกเอกสารภาษี
6. Candidate vendor ต้องอยู่ใน issuer side; buyer name ไม่ผ่าน แม้พิมพ์อยู่ในหน้าเดียวกัน
7. ถ้า candidate ขาดวันที่ server recover ได้เฉพาะเมื่อ transcription มี unambiguous receipt date เพียงค่าเดียว
8. One-pass rejection log เก็บ bounded reason/enum/count เท่านั้น ไม่เก็บ OCR text หรือค่าบนเอกสาร

## Safety decision

- fallback ทั้ง `extract-repair` และ `image-reread` ยังอยู่ครบและเหตุ `JSON_INCOMPLETE_OR_INVALID`, `TOTAL_MISSING`, `VAT_MISSING`, `ITEMS_INCOMPLETE` ยังถูกเก็บ
- `TAX_INVOICE` และ `ABBREVIATED_TAX_INVOICE` ไม่ใช้ one-pass ในรุ่นนี้
- thermal receipt ที่พิมพ์ “ไม่รวมภาษีมูลค่าเพิ่ม” แต่ไม่มียอด VAT ยังตก `VAT_MISSING` และใช้ fallback
- long receipt, low-contrast receipt, check bill และ non-document images ยังรักษา fallback/routing เดิม
- ไม่มีการ deploy UAT/Production ใน benchmark นี้ และราคาแพ็กเกจยังไม่เปลี่ยน

