# Thai Business Document Conventions — Receipt OCR Classification Rubric

Research date: 2026-07-14 (web research, RD-cited). Owner directive: define the real
document-type/direction rubric instead of case-by-case prompt patches.
Consumed by: `docs/specs/business-document-image-intake-spec.md` (§3.4 owner update,
§5 gates) and `RECEIPT_OCR_PROMPT` in
`apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts`.

## 1. Title-as-settlement (legal basis)

Revenue Code ม.105: a ใบรับ must be issued "ในทันทีทุกคราวที่รับเงินหรือรับชำระราคา" —
a document titled ใบเสร็จรับเงิน exists, by legal definition, only after money was
received. Therefore the TITLE itself is settlement evidence.

| Title | Settlement implication |
|---|---|
| ใบเสร็จรับเงิน / ใบรับเงิน / ใบเสร็จ / RECEIPT | YES (ม.105) |
| บิลเงินสด / CASH SALE / CASH BILL | YES (convention; a form of ใบรับ) |
| ใบกำกับภาษีอย่างย่อ (ม.86/6, retail POS) | Conditional-high (retail = point-of-sale payment); YES when combined with ใบเสร็จรับเงิน |
| ใบกำกับภาษี (full, standalone) | Goods: NO (tax point = delivery, ม.78(1)); services: usually YES (tax point = payment, ม.78/1) |
| ใบแจ้งหนี้ / ใบวางบิล / ใบเสนอราคา / ใบส่งของ / ใบสั่งซื้อ / เช็คบิล-order slip | NO (anti-signals) |
| สลิปโอนเงิน / transfer slip | Payment proof YES, but pairs with a goods/service doc; never VAT/vendor truth alone |

## 2. Body/stamp settlement phrases

Positive: ได้รับเงิน…แล้ว, รับเงินแล้ว, ชำระแล้ว, ชำระเงินแล้ว, จ่ายแล้ว, PAID,
ชำระเงินสด, เงินสด (payment-method field), รับชำระโดย เงินสด/โอน/บัตร, เงินทอน/change
(strong POS signal), ผู้รับเงิน + ลายเซ็น.
Weak/none: ขอบคุณที่ใช้บริการ (courtesy). Anti: กำหนดชำระ, เครดิต N วัน, due date.

## 3. Direction (มุมมองผู้อัปโหลด)

Document voice is always the seller's: issuer name/logo/tax-ID sit in the header.
The buyer appears only in a labeled field: ลูกค้า/นาม/ผู้ซื้อ/ได้รับเงินจาก/Bill to/
Customer. Full tax invoices must carry buyer identity (ม.86/4(3)); abbreviated tax
invoices legally omit the buyer; handwritten cash bills often have a customer line.

Rule (uploader = the tenant capturing an expense):
1. Uploader matches the ISSUER header → the tenant's own SALES document → SALES_RECEIVABLE.
2. Uploader matches the customer field → PURCHASE_EXPENSE.
3. Uploader appears nowhere (retail slip, abbreviated tax invoice, cash bill with
   blank/other customer): supplier-issued settled evidence in an expense-capture
   context defaults to PURCHASE_EXPENSE — the named issuer is the counterparty.
   Truly ambiguous (issuer unreadable, doc looks like the tenant's own template)
   → UNKNOWN + AMBIGUOUS_BUSINESS_DIRECTION, never guess SALES_RECEIVABLE.

## 4. Expense/tax validity (unchanged product stance)

- ใบกำกับภาษีอย่างย่อ: valid CIT expense (conditional), NEVER input-VAT credit (ภาษีซื้อต้องห้าม).
- บิลเงินสด: CIT-valid only with seller identity/tax-ID, buyer, date, items, amount,
  payee signature; else supplement with ใบรับรองแทนใบเสร็จ/ใบสำคัญจ่าย + slip.
- These remain human-review decisions (deriveTaxEvidence) — classification never
  asserts legal usability (spec §12/§13 stance unchanged).

## 5. Sources

- ม.105 / ม.105ทวิ: https://tax-ez.info/Revenue/View/6eTPLMFS , https://tax-ez.info/Revenue/View/ZBeQXD8G/
- ม.86/4 vs 86/6: https://www.rd.go.th/5208.html , https://www.rd.go.th/fileadmin/images/image_pramoun/mata86_4_6.pdf
- Tax point ม.78: https://www.dst.co.th/index.php?option=com_content&view=article&id=3871
- ใบกำกับภาษีอย่างย่อ as expense: https://tanateauditor.com/small-tax-invoice/ , https://www.dst.co.th/index.php?option=com_content&view=article&id=4682
- บิลเงินสด requirements: https://www.kasikornbank.com/th/kbiz/article/pages/what-is-cash-bill.aspx , https://accountingcenter.co/blog/แบบฟอร์ม-บิลเงินสด-ใบเสร็จรับเงิน-ที่ถูกต้องสรรพากรยอมรับ
- Slip pairing: https://flowaccount.com/blog/document-support-expense-line-item/ , https://bmu.co.th/certificate-of-receipt/
- Doc chain: https://flowaccount.com/blog/basic-business-document/ , https://blog.fundingsocieties.co.th/invoice-vs-bill-vs-receipt/
