# Agent Memory: expense VAT 27.08 กรอกลงช่อง WHT (UAT)

Status: diagnosed — ยังไม่แก้โค้ด (เจ้าของสั่ง "หา root cause ก่อน")
Owner: thawatchai
Scope: apps/web expenses review UI, apps/api receipt-ocr-apply, apps/ai-gateway receipt OCR

## อาการ
UAT `The lobby clube` — ผู้ใช้กรอก 27.08 (ยอด VAT บนใบเสร็จ) ลงช่อง "หัก ณ ที่จ่าย"
ได้ error `expenses.v_rate_range` + echo "= 2708%"

## หลักฐานจาก UAT DB (อ่าน 2026-08-18 ผ่าน infra/uat/db-port-forward.sh)
- ExpenseRecord `cmsv1phk300p92b4h4nx3b3x4`, company `cmst6rmiv00t4284ek31mapm1`
- Starbucks Coffee, ABBREVIATED_TAX_INVOICE, grandTotal 414.00, vatMode `VAT_INCLUDED`,
  vatAmount `0`, inputVatClaimStatus `NON_CLAIMABLE`, สร้าง 2026-08-16 00:07
- `aiVerifiedFieldsJson.missingFields = ["vatAmount","vatRate"]` — AI **ไม่ได้อ่าน** 27.08
  (414 × 7/107 = 27.08 ตรงกับที่ผู้ใช้พิมพ์)
- ExpenseLine ทั้ง 4 แถว: `vatRate = NULL`, `vatAmount = 0`
- `Company.vatRegistered = false` → capture mode `SIMPLE`

## Root cause chain
1. AI stage-2 พลาด VAT block ของสลิปย่อ แล้วประกาศ missingFields เอง
2. `defaultLineVatRate()` (receipt-ocr-apply.service.ts:215-218) คืน null เมื่อไม่มีทั้ง
   vatRate และ vatAmount → ทุก line ได้ vatAmount 0
3. `hasRecordedTax(detail.lines)` เท็จ + capture SIMPLE → `showsTax` เท็จ
   (ExpensesPages.tsx:962,1183) → ช่อง VAT ไม่ render
4. ช่อง WHT (ExpensesPages.tsx:1168-1176) **ไม่มี capture gate** → เป็นช่องภาษีเดียวที่เห็น
   → ผู้ใช้ยัด VAT ลงไป

## ผลข้างเคียงที่พบระหว่างทาง (ยังไม่แก้)
- **กับดัก blocking error ที่มองไม่เห็น**: record มี vatMode `VAT_INCLUDED` →
  `vatModeRequiresRate` จริง → `expenses.v_vat_rate_required` ยิงทั้ง 4 บรรทัด
  (expense-review-validation.ts:143-146) แต่ช่อง VAT ถูกซ่อนใน SIMPLE mode
  `validateExpenseReview` ไม่รับ capture mode เป็น input.
  แก้ข้อมูลจากรอบวิเคราะห์แรก: dropdown vatMode ในฟอร์ม**ตรวจ**อยู่ที่
  ExpensesPages.tsx:1076-1088 และ **ไม่ได้** ถูก gate ด้วย showsTax (ที่ 1737 คือฟอร์ม
  สร้างเอง คนละตัว) → ทางออกเดียวที่ผู้ใช้เห็นคือเปลี่ยนเป็น "ไม่มี VAT" ซึ่ง error หายจริง
  แต่เป็นการบันทึกข้อมูลผิดและทำให้ยอด VAT หายไปเงียบๆ
- **ช่องรับ "ยอด VAT เป็นบาท" เป็นรายบรรทัด ไม่ใช่ระดับเอกสาร**:
  `vatRateFromPrintedAmount` (expenses.model.ts:127) ถูกเรียกที่เดียวคือ
  ExpensesPages.tsx:1222 ในลูปรายบรรทัด และต้องเลือก preset "กำหนดเอง" ก่อนถึงจะเห็น.
  ใบเสร็จพิมพ์ VAT ก้อนเดียว (27.08) แต่บิลมี 4 บรรทัด — พิมพ์ 27.08 ที่บรรทัด 1 ได้ 17.71%,
  บรรทัด 2 ได้ 64.60% ฯลฯ; ต้องหารเองเป็น 11.78/4.51/5.56/5.23 ถึงจะได้ 7%
- label `expenses.wht` ใช้ทั้งกับยอดเงิน (ExpenseReviewPage.tsx:605) และช่องอัตรา
  (ExpensesPages.tsx:1171) — หน่วยต่างกันแต่ข้อความเดียวกัน

## ของที่ถูกแก้ไปแล้วบางส่วน
`74c7d70` (2026-08-16 20:50) เพิ่ม `needsPrintedVatReread` — re-read รอบสองเมื่อ
vatMode บอกว่ามี VAT แต่ไม่มี vatAmount. เคสนี้เกิด ~20 ชม. **ก่อน** commit นั้น
UAT ปัจจุบันรัน `git-75ae7e154591bf6464fe1c52ef66e0c6139e26e8` ซึ่ง **รวม** fix แล้ว
→ ต้อง re-upload ใบเสร็จเดิมเพื่อพิสูจน์ว่า re-read กู้ 27.08 ได้จริงหรือไม่

## Next
1. Re-upload สลิปเดิมบน UAT ปัจจุบัน → ดูว่า vatAmount ถูกกู้ไหม
2. เพิ่มช่องรับยอด VAT ระดับเอกสาร แล้วกระจายลงบรรทัดตามสัดส่วน (ยังไม่มี PR)
3. ตัดสินใจ: WHT ควรถูก gate ด้วย capture policy เหมือน VAT หรือไม่
4. ตัดสินใจ: validation ควรรับ capture mode เพื่อไม่ยิง error บนช่องที่ซ่อน

## PR ที่เกี่ยวข้อง
- **#162 `fix/expense-single-wht-field`** (OPEN) — ย้าย WHT ออกจากการ์ดรายบรรทัดมาเป็น
  ช่องเดียวท้ายบิล label `expenses.document_wht_rate` = "หัก ณ ที่จ่าย (ทั้งบิล)" และรายงาน
  validation ครั้งเดียวที่ field `whtRate`.
  **ยังไม่แก้เคสนี้**: ยังเป็น input อัตรา 0-1 (min/max 0..1), ไม่มีหน่วยใน label,
  ไม่มีทางกรอกเป็นบาท, ไม่ผูกกับ capture policy และไม่แตะ VAT เลย
