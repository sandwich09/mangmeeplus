# Mangmee Accounting Operating System — Product and Domain Spec

สถานะ: DRAFT สำหรับ Product, Accounting, Tax, UX และ Engineering review

หลักฐานตั้งต้น: [ผลสำรวจ FlowAccount 2026-08-26](../research/flowaccount-accounting-product-audit-2026-08-26-th.md)

แผนส่งมอบ: [Mangmee Accounting OS Implementation Plan](../plans/mangmee-accounting-os-implementation-plan-th.md)

คลังความรู้: [Mangmee Accounting and Tax Knowledge Spec](mangmee-accounting-tax-knowledge-spec-th.md)

## 1. Product outcome

มั่งมีต้องเป็นระบบที่เจ้าของและพนักงานทำงานด้วยภาษาธุรกิจได้ ขณะที่ระบบเตรียมเอกสาร ภาษี รายการบัญชี และหลักฐานให้นักบัญชีตรวจ โดยมีสมองมั่งมีเป็นทางเข้าที่ถามได้ทั้งข้อมูลบริษัท ความรู้ธุรกิจ บัญชี ภาษี และคำถามทั่วไปอย่างเป็นธรรมชาติ

ผลลัพธ์ที่ผู้ใช้ต้องรับรู้:

1. ถ่ายหรือสร้างรายการครั้งเดียว ไม่คีย์ข้อมูลซ้ำในหลายเมนู
2. รู้ทันทีว่างานเสร็จแล้ว อยู่สถานะไหน และต้องทำอะไรต่อ
3. ตัวเลขรายรับ รายจ่าย ธนาคาร ภาษี สต็อก และบัญชีเชื่อมกลับไปยังหลักฐานต้นทางได้
4. เจ้าของไม่ต้องรู้เดบิต/เครดิต แต่นักบัญชีตรวจและแก้ mapping ได้
5. AI ช่วยอ่าน แนะนำ และอธิบาย แต่กฎ deterministic และคนมีสิทธิ์เป็นผู้ยืนยัน mutation สำคัญ
6. ระบบเพิ่ม knowledge domain, connector, บริษัท และผู้ใช้ได้โดยไม่สร้าง source of truth ซ้ำ

คำโฆษณาที่ปลอดภัยก่อน full accounting gate ผ่าน:

> ผู้ช่วยธุรกิจที่ช่วยเก็บเอกสาร เตรียมข้อมูลบัญชี และตอบจากข้อมูลบริษัทพร้อมแหล่งที่มา

ห้ามใช้คำว่า “ทำบัญชีและยื่นภาษีแทนนักบัญชีได้ครบ” จน quality gate ด้านเอกสาร รายงาน แบบยื่น งบ ปิดงวด และ expert sign-off ผ่านจริง

## 2. ผู้ใช้และงานหลัก

| Persona | ความต้องการ | สิ่งที่ไม่ควรถูกบังคับให้ทำ |
|---|---|---|
| เจ้าของกิจการ 40+ | เห็นเงินเข้า–ออก งานค้าง ภาษีใกล้ถึงกำหนด และถามภาษาคน | เลือก account code, tax form หรือเดบิต/เครดิตทุกครั้ง |
| พนักงานร้าน/แอดมิน | ถ่ายใบเสร็จ ออกเอกสาร รับเงิน บันทึก exception | เข้าใจงบการเงินหรือเปลี่ยน setting กว้าง |
| ฝ่ายขาย | ลูกค้า ใบเสนอราคา วางบิล รับเงิน และติดตามค้าง | เห็นข้อมูลเงินเดือน/บัญชีที่ไม่เกี่ยวข้อง |
| จัดซื้อ/คลัง | ขอซื้อ PO รับของ โอน stock และตรวจต่าง | post GL หรือปลดล็อกงวด |
| การเงิน | เตรียมรับ–จ่าย ธนาคาร กระทบยอด และ cash position | เปลี่ยนกฎภาษีหรือผังบัญชีโดยไม่มีสิทธิ์ |
| นักบัญชี | ตรวจ VAT/WHT, mapping, journal, reconciliation, close และ report | คีย์เอกสารธุรกิจซ้ำจากศูนย์ |
| ผู้อนุมัติ | เห็นเหตุผล หลักฐาน ผลกระทบ และ approve/reject | แก้ source document ระหว่างอนุมัติแบบเงียบ ๆ |
| ผู้สอบทาน/Support | อ่าน audit/evidence ตามขอบเขต | เขียนบัญชีหรือเห็นข้อมูล tenant อื่น |

## 3. หลักการออกแบบที่ห้ามละเมิด

### 3.1 One source of truth

- เอกสารธุรกิจหนึ่งรายการมี ID เดียวและ lineage ไปยังเอกสารที่แปลงต่อ
- Payment เป็น event แยกจาก Invoice/Expense
- Statement line เป็นหลักฐานธนาคาร ไม่ใช่ revenue/expense โดยอัตโนมัติ
- Tax event อ้าง source document/payment และ rule snapshot
- Journal entry ที่ post แล้วเป็น immutable; การแก้ใช้ reversal/correction
- StockMovement เป็น source of truth; balance เป็น projection
- Report และ AI answer อ่านจาก source/projection ที่ประกาศ ไม่สร้างตัวเลขใหม่เอง

### 3.2 Model proposes; code verifies

- AI อ่าน OCR, เสนอคู่, แนะนำหมวด และอธิบาย
- โค้ดตรวจยอด สมการ ภาษี period permission idempotency และ state transition
- AI Gateway เรียก permission-checked ERP APIs/tools เท่านั้น ห้ามอ่าน repository/DB โดยตรง
- การ post, approve, pay, file, unlock period และเปลี่ยน policy ต้องใช้ explicit command และ actor ที่มีสิทธิ์

### 3.3 State แยกตามข้อเท็จจริง

ห้ามใช้ status เดียวแทนทุกเรื่อง เอกสารต้องมีอย่างน้อย:

- business status: draft, awaiting approval, approved, issued, voided
- fulfillment status: not started, partial, fulfilled, returned
- payment status: unpaid, partial, paid, refunded, overpaid
- tax status: not applicable, pending evidence, eligible, selected, filed, paid, corrected
- posting status: not ready, pending, posted, reversed, failed
- reconciliation status: unmatched, suggested, matched, adjusted, unresolved

หน้า beginner รวมเป็น progress ภาษาคนได้ แต่ต้องเปิดรายละเอียดแต่ละ state เมื่อกดดู

### 3.4 Immutable evidence

ทุก final mutation ต้องเก็บ company, branch, source, actor, delegated actor ถ้ามี, time, before/after, reason, command ID, rule/config version และ attachment/evidence references

## 4. Information architecture สำหรับผู้ใช้ 40+

### 4.1 หน้าแรกแบบงาน ไม่ใช่ผังบัญชี

ลำดับเมนูหลัก:

1. งานวันนี้
2. ถ่ายใบเสร็จ
3. ขายและรับเงิน
4. ซื้อและจ่ายเงิน
5. ธนาคารและกระทบยอด
6. สินค้าและคลัง
7. รายงาน
8. สำหรับนักบัญชี

Hero action ที่ต้องคงตำแหน่ง:

- ถามสมองมั่งมี
- ถ่ายใบเสร็จ
- สร้างเอกสารขาย
- ดูรายการรอตรวจ

### 4.2 Beginner/Accountant view

Beginner view แสดงคำว่า “ค่าโฆษณา”, “มี VAT 7%”, “รอรับเงิน” และ next action

Accountant view เพิ่ม account code, tax code, debit/credit, tax period, posting source, branch scope และ reconciliation evidence โดยใช้ record เดียวกัน

### 4.3 UX minimum

- ข้อความหลักอย่างน้อย 16 px และ touch target อย่างน้อย 44 × 44 px
- action หลักต่อหน้าไม่เกินหนึ่งปุ่มเด่น; action รองจัดกลุ่ม
- ช่องที่จำเป็นก่อน ช่องขั้นสูงยุบได้
- label เป็นภาษางาน พร้อมตัวอย่าง ไม่ใช้ placeholder แทน label
- validation อยู่ข้างช่องและ focus ช่องแรกที่ผิด
- loading, empty, error, forbidden และ success มีข้อความและทางไปต่อ
- เมื่อ “ส่งตรวจ” สำเร็จ ให้กลับหน้ารายการอัตโนมัติ แสดงข้อความสำเร็จ เน้นรายการล่าสุด และบอกสถานะใหม่
- ห้ามแสดง raw ID, provider name, internal code หรือ stack error ต่อผู้ใช้ทั่วไป

## 5. Company and accounting setup

### 5.1 Company profile

ต้องเก็บ:

- ชื่อจดทะเบียน/ชื่อการค้า ประเภทธุรกิจ ที่อยู่ และข้อมูลติดต่อ
- เลขประจำตัวผู้เสียภาษี สถานะ VAT วันที่มีผล สำนักงานใหญ่/สาขา
- วันที่จัดตั้ง วันสิ้นปีบัญชี สกุลเงินหลัก timezone และ locale
- รูปแบบเอกสาร โลโก้ ตรายาง ลายเซ็น หมายเหตุ และช่องทางรับชำระ
- accounting policy profile และ chart-of-account template/provenance
- inventory/costing policy และ negative stock policy
- tax registration/e-filing/e-Tax capability status โดยแยก “ลงทะเบียนแล้ว” กับ “ระบบรองรับ”

### 5.2 Onboarding checklist

~~~text
สร้างบริษัท
  → ยืนยัน Owner และ membership
  → ข้อมูลบริษัท/สำนักงานใหญ่/สาขา
  → VAT และ tax identity
  → ปีบัญชี/งวดเริ่มต้น/cutover
  → ผังบัญชีและ posting mappings
  → หมวดค่าใช้จ่าย/รายได้/สินค้า
  → เลขเอกสารและ payment channels
  → สิทธิ์/approval workflow
  → opening balances + outstanding AR/AP + stock + assets
  → Accountant review
  → เปิดใช้งานทีละ module
~~~

Auto-register จากเว็บไซต์ทางการต้องใช้ signed, expiring, idempotent integration request สร้าง company/owner/membership/defaults แล้วส่ง email claim; ห้ามเว็บไซต์เรียก System Admin browser API ด้วย cookie หรือ API key ถาวร

### 5.3 Policy snapshot

ทุกเอกสาร final ต้อง snapshot:

- VAT registration/branch
- price mode และ calculation mode
- document number series
- currency/rate
- posting rule version
- tax rule version
- inventory/costing rule version
- approval policy version

## 6. Master data

### 6.1 Counterparty

ลูกค้า/ผู้จำหน่าย/ทั้งสองประเภท มีชื่อ ที่อยู่ ติดต่อ tax ID สาขา ประเทศ payment term currency WHT profile และ status พร้อม import/deduplicate/merge ที่ audit ได้

### 6.2 Product/service

- service, non-stock, stock item, asset candidate
- SKU, barcode, category, images, description
- base unit และ alternate units พร้อม conversion
- sale/purchase price และ price lists
- VAT/tax treatment default ที่แก้รายเอกสารได้
- revenue, inventory, COGS, expense และ asset account mappings
- reorder point/minimum stock

Default เป็นคำแนะนำ ไม่ใช่ความจริงถาวร เอกสาร final ต้อง snapshot ค่าที่ใช้จริง

## 7. Sell-to-Cash requirements

### 7.1 Document types

| เอกสาร | จุดประสงค์ | ผลบัญชีโดย default | ผล stock | ผลภาษี |
|---|---|---|---|---|
| ใบเสนอราคา | เสนอราคา/เงื่อนไข | ไม่มี | จองได้ถ้ามีนโยบาย แต่ไม่ตัด | ไม่มี |
| ใบวางบิล/ใบแจ้งหนี้ | เรียกเก็บเงิน | ตาม revenue recognition policy | ไม่ตัดโดย default | ไม่ใช้เป็น tax event อัตโนมัติทุกกรณี |
| ใบส่งของ | หลักฐานส่งมอบ | อาจเป็น evidence ของ recognition | ตัดเมื่อ policy กำหนด | ไม่ใช่ใบกำกับภาษีเอง |
| ใบกำกับภาษี | ยืนยัน output VAT | Dr AR / Cr Revenue หรือแยกตาม policy; Cr Output VAT | ตัดเมื่อเป็น fulfillment source | สร้าง output-tax event |
| ใบเสร็จรับเงิน | หลักฐานรับเงิน | Dr Cash/Bank/WHT receivable / Cr AR | ไม่มีเพิ่มถ้าตัดแล้ว | ไม่สร้าง VAT ซ้ำ |
| ขายเงินสด | ขายและรับเงินพร้อมกัน | Dr Cash/Bank / Cr Revenue/Output VAT | ตัด stock | tax event ตามเอกสาร |
| ใบลดหนี้ | ลดมูลค่า/คืน | reversal/adjustment | รับคืนเมื่อเลือก | ลด output VAT ตามกฎ |
| ใบเพิ่มหนี้ | เพิ่มมูลค่า | adjustment | เพิ่ม/ลดตามเหตุ | เพิ่ม output VAT ตามกฎ |

ตารางเป็น design baseline ต้องให้ Accountant/Tax expert รับรอง per business policy ก่อน activation

### 7.2 State machines

Quotation:

~~~text
DRAFT → AWAITING_APPROVAL → APPROVED → CONVERTED
                         ↘ REJECTED
ทุกสถานะที่ยังไม่ final → CANCELLED ตามสิทธิ์
~~~

Invoice/tax document:

~~~text
DRAFT → READY_TO_ISSUE → ISSUED → PARTIALLY_PAID → PAID
                            ↘ CREDITED/DEBITED
                            ↘ VOIDED ผ่านเหตุผลและ correction policy
~~~

ห้าม delete เอกสาร ISSUED; เลขที่ที่ใช้แล้วต้องคงใน audit trail

### 7.3 Conversion and allocation

- source document line → target line มี lineage
- รองรับ partial quantity, partial amount, deposit และ retention
- target รวมทุกใบต้องไม่เกิน source หลัง adjustment
- idempotency key กันกดซ้ำ/retry สร้างเอกสารซ้ำ
- payment allocation รองรับหนึ่ง payment ต่อหลาย invoice และหลาย payment ต่อหนึ่ง invoice
- overpayment/unapplied credit เก็บเป็น liability/credit balance ไม่ลง revenue ซ้ำ

### 7.4 WHT receivable

เมื่อ invoice รวม 1,070 แต่ลูกค้าจ่ายสุทธิหลังหัก WHT:

~~~text
Dr Bank                     จำนวนรับสุทธิ
Dr WHT receivable           ภาษีที่ลูกค้าหัก
Cr Accounts receivable     1,070
~~~

ระบบต้องติดตามหนังสือรับรอง 50 ทวิที่ยังไม่รับและ reconcile ยอด net + WHT กับ invoice

## 8. Procure-to-Pay requirements

### 8.1 Flow

~~~text
Purchase Request (optional by policy)
  → Purchase Order approval
  → Goods/Service Receipt
  → Vendor Bill/Expense + Tax Invoice Evidence
  → 2-way/3-way Match
  → Payment Proposal/Voucher approval
  → Payment
  → WHT Certificate/Tax Event
  → Bank Reconciliation
~~~

### 8.2 Matching

- 2-way: PO ↔ Bill
- 3-way: PO ↔ Receipt ↔ Bill
- tolerance per company for quantity, price, VAT, freight และ rounding
- mismatch ต้องเป็น exception พร้อม reason, owner, status และ evidence
- partial receipt/bill/payment ต้องเห็นยอด ordered, received, billed, paid และ remaining

### 8.3 Expense/OCR

OCR draft ต้องเก็บ:

- original file hash และ upload source
- document type/date/number
- supplier identity/tax ID/branch
- line description, quantity, unit price, discount, service charge
- VAT per line, source VAT total และ calculated VAT total
- WHT candidate, currency และ payment evidence
- confidence ต่อ field และ extraction model/version

AI ห้าม finalize อัตโนมัติเมื่อ:

- document duplicate/suspected duplicate
- total equation ไม่ลงตัว
- source VAT กับ calculated VAT ต่างเกิน tolerance
- mixed VAT ยัง map ไม่ครบ
- supplier/tax identity conflict
- document date อยู่ locked period
- company quota/permission/rule unavailable

Quota เต็มห้ามลบเอกสารหรือบังคับให้ upload ใหม่ ผู้ใช้ต้องยังอ่านข้อมูลเดิมและกรอกเองได้ตาม policy ของ subscription plan

### 8.4 Payment control

- payment proposal เลือกหลาย vendor bills ได้
- maker/checker/approver แยกสิทธิ์
- payment batch มี beneficiary, bank, amount, due date, WHT, reference และ approval history
- export bank file/connector เป็นงานแยกจาก approval; success ต้องอิง provider confirmation
- retry ต้อง idempotent

## 9. Mixed VAT and amount reconciliation

หัวข้อนี้เป็น STOP-SHIP ต่อ expense confirmation เพราะพบปัญหาจริงในมั่งมี

### 9.1 Tax treatment ต่อบรรทัด

ค่าที่ต้องแยกอย่างน้อย:

- STANDARD_RATE เช่น 7% ตาม rule version
- ZERO_RATED
- EXEMPT
- OUT_OF_SCOPE/NO_VAT
- UNKNOWN_NEEDS_REVIEW

ห้ามใช้ VAT rate = 0 เพียงค่าเดียวแทนสามความหมายแรก

### 9.2 Amount model

แต่ละบรรทัดเก็บ:

- source gross/net/tax ถ้ามีจากเอกสาร
- quantity, unit price, discount/addition
- price-includes-tax flag
- tax treatment/rate
- calculated net/tax/gross
- rounding adjustment และ allocation method

ระดับเอกสารเก็บ:

- source subtotal/VAT/grand total
- calculated subtotal/VAT/grand total
- difference ต่อ component
- resolution: accepted source, recalculated, adjusted lines, rounding, non-creditable VAT, unresolved
- reviewer, reason และ evidence

### 9.3 UX

ใช้คำว่า:

- “มี VAT 7%”
- “VAT 0%”
- “ยกเว้น VAT”
- “ไม่มี VAT/อยู่นอก VAT”
- “ยังไม่แน่ใจ”

สรุปด้านล่างต้องแสดงฐานที่มี VAT, ฐานไม่มี VAT, VAT ตามเอกสาร, VAT ที่ระบบคำนวณ และผลต่าง พร้อมปุ่ม “แก้รายการที่ต่าง” ห้ามแสดงเพียง error “VAT ไม่ตรง”

### 9.4 Golden cases ขั้นต่ำ

1. ทุกบรรทัด VAT 7% ราคาไม่รวม VAT
2. ทุกบรรทัด VAT 7% ราคารวม VAT
3. ผัก/ผลไม้ไม่มี VAT ผสมสินค้ามี VAT ในใบเดียว
4. VAT 0% ผสม VAT 7%
5. exempt ผสม out-of-scope
6. ส่วนลดท้ายบิลกระจายฐาน
7. service charge และ rounding 0.01
8. source VAT ต่างจาก calculated ภายใน tolerance
9. source VAT ต่างเกิน tolerance และแก้ได้
10. OCR อ่าน VAT ผิดแต่ยอดเอกสารถูก

## 10. Auto Revenue and Revenue Inbox

### 10.1 Sources

- Bank Statement/feed
- QR/Payment Gateway/Card
- Marketplace settlement
- POS/Sales system
- Invoice/payment link
- Partner API

### 10.2 Canonical state

~~~text
NEW → NORMALIZED → MATCHING → SUGGESTED
                                → CONFIRMED → ACCOUNTED → RECONCILED
                                → NEEDS_REVIEW
                                → REJECTED/IGNORED_WITH_REASON
~~~

### 10.3 Classification

| เงินเข้า | การจัดประเภท | ผลหลัก |
|---|---|---|
| ลูกค้าจ่าย invoice | CUSTOMER_PAYMENT | เคลียร์ AR; ไม่ลง revenue/VAT ซ้ำ |
| ขายสดไม่มี invoice | REVENUE_CANDIDATE | สร้าง sales document/tax event ตามกฎก่อน post |
| โอนระหว่างบัญชี | INTER_ACCOUNT_TRANSFER | asset-to-asset; จับคู่ statement สองฝั่ง |
| เจ้าของเติมเงิน | CAPITAL/DIRECTOR_LOAN | equity/liability ตาม evidence |
| เงินกู้ | LOAN | liability ไม่ใช่ revenue |
| มัดจำ | CUSTOMER_DEPOSIT | liability จนถึง recognition boundary |
| refund received | REFUND/REVERSAL | อ้างอิงรายการเดิม |
| marketplace settlement | SETTLEMENT | แตก gross sales, fee, VAT/WHT และ net deposit |
| ไม่ทราบ | UNIDENTIFIED | ไม่ post เป็น revenue; รอคนตรวจ |

### 10.4 Matching

คะแนนจับคู่ใช้ amount, date window, payer/reference, invoice/order, currency, bank account, settlement batch และ prior behavior แต่ threshold ต้องวัดจาก golden data

- exact/high confidence: เสนอให้ confirm
- ambiguous: แสดง candidate สูงสุด 3 รายการและเหตุผล
- no match: ถามประเภทภาษาคน
- closed period/rule missing: fail closed
- duplicate source key: no-op พร้อม audit

เป้าหมาย “95% auto” เป็น aspiration จนมีข้อมูลจริง ห้ามใช้เป็น acceptance criterion ก่อน baseline precision/coverage

## 11. Bank reconciliation

### 11.1 Data

- BankAccount และ financial channel account
- StatementImport พร้อม source/hash/parser/version
- StatementLine immutable
- Suggested/confirmed Match
- Adjustment และ TransferPair
- ReconciliationSession พร้อม opening/closing balance
- Evidence export/snapshot

### 11.2 Invariants

- unique ต่อ company + source + external transaction ID หรือ statement fingerprint
- statement line หนึ่งมี final disposition เดียว เว้น split match ที่ยอดรวมเท่ากัน
- match totals เท่ากับ statement amount ภายใน tolerance
- transfer ไม่กระทบ P&L
- bank fee/interest/chargeback ต้องสร้าง adjustment ที่ post ได้
- session complete เมื่อยอดคำนวณตรง closing balance และ unresolved = 0 หรือได้รับ exception approval ตาม policy

### 11.3 UX

Wizard เริ่มจากเลือกบัญชี ช่วงเริ่มต้น นำเข้า ตรวจ duplicate ดู suggestions แก้ exception และยืนยันงวด โดยแสดง progress และจำนวนที่เหลือ ไม่เริ่มจากคำว่า debit/credit

## 12. VAT and tax operations

### 12.1 Tax event model

TaxEvent ต้องมี:

- type/direction/form candidate
- source document/payment และ branch
- tax point/evidence dates
- tax base/rate/amount และ currency/base currency
- eligibility/non-creditable reason
- rule source/version/effective date
- filing period assignment
- state, reviewer และ correction lineage

### 12.2 Purchase VAT state

~~~text
PENDING_EVIDENCE
  → RECEIVED
  → ELIGIBLE / NON_CREDITABLE / WAITING_TO_CLAIM
  → SELECTED_IN_RETURN
  → FILED
  → PAID/REFUNDED/CREDIT_CARRIED
  → CORRECTED ผ่าน amendment lineage
~~~

### 12.3 PP30 package

ต้องมี output register, input register, selected input lines, carry-forward, adjustments, summary boxes, branch/scope snapshot, report/PDF/export artifact, reviewer sign-off, submission/payment evidence และ amendment chain

### 12.4 PP36 package

ต้องเก็บ foreign supplier/service evidence, payment/date/rule, tax calculation, filing/payment receipt และ link ไป input VAT claim ที่เกี่ยวข้อง ห้าม claim ก่อน evidence/state ที่ policy กำหนด

### 12.5 WHT package

- PND1/3/53 candidate ตาม payee/type และ payment event
- income type/rate/gross/tax withheld
- certificate 50 Tawi immutable snapshot
- submission file/report, payment evidence และ correction
- received-WHT registry สำหรับฝั่งรายรับ

### 12.6 e-Tax

แยก capability:

- create compliant document data
- render PDF/human view
- sign/time-stamp ตาม scheme
- transmit/acknowledge
- validate signature/integrity
- resend/correct/void
- retain original electronic evidence

ห้ามเรียก PDF ที่ส่งอีเมลธรรมดาว่า e-Tax Invoice จน scheme/registration/transmission evidence ถูกต้อง

### 12.7 Tax scope universe

ระบบบัญชีต้องมี registry ของภาระภาษี ไม่ยัดทุกอย่างไว้ใน VAT/WHT และไม่อ้างว่ารองรับเพียงเพราะมีช่องกรอกตัวเลข:

| กลุ่ม | ตัวอย่างแบบ/งาน | Source หลัก | เป้าหมายระบบ |
|---|---|---|---|
| VAT ในประเทศ | ภ.พ.30, รายงานภาษีซื้อ/ขาย | sales/purchase tax events | prepare, reconcile, export, evidence, amendment |
| VAT บริการ/ผู้ประกอบการต่างประเทศ | ภ.พ.36 | foreign-service payment/evidence | prepare, pay evidence, link input claim |
| WHT ฝั่งจ่าย | ภ.ง.ด.1/3/53, 50 ทวิ | payroll/AP payment | certificate, register, package, payment evidence |
| WHT จ่ายต่างประเทศ | ภ.ง.ด.54 และเรื่องที่เกี่ยวข้อง | cross-border payment/treaty evidence | separate expert-reviewed pack/workpaper |
| WHT ฝั่งรับ | หนังสือรับรอง 50 ทวิที่ได้รับ | customer payment | WHT receivable, missing certificate, year-end reconcile |
| ภาษีเงินได้นิติบุคคล | ภ.ง.ด.50/51 | adjusted accounting profit + tax adjustments | workpaper/calendar/evidence; ไม่สร้างจาก transaction เดียว |
| ภาษีเงินได้บุคคลธรรมดา/เงินเดือน | ภ.ง.ด.1/1ก และเอกสารพนักงาน | payroll | แยก payroll domain และ privacy สูง |
| ประกันสังคม/กองทุนที่เกี่ยว | รายเดือน/ปีตามกฎหมายที่ใช้ | payroll/employee master | compliance calendar/export/evidence; ไม่ปนกับ tax event |
| ภาษีธุรกิจเฉพาะ | ภ.ธ.40 | eligible business transactions | separate registration/rule/report pack |
| อากรแสตมป์ | ตราสารที่เข้าเงื่อนไข | contract/document registry | obligation checklist/evidence ไม่เดาจากชื่อเอกสาร |
| ศุลกากร/สรรพสามิต/ภาษีท้องถิ่น | ตามกิจการ | external declarations/assets/imports | integration/workpaper ตามธุรกิจ ไม่รวม default SME core |

แต่ละแถวต้องมี capability state แยก: NOT_SUPPORTED, EDUCATION_ONLY, DATA_PREPARATION, REPORT_EXPORT, READY_TO_FILE และ DIRECT_FILED ห้ามใช้คำว่า “รองรับ” ค่าเดียวครอบทุกระดับ

## 13. Inventory and costing

### 13.1 Source states

- Product/Unit/Barcode
- Warehouse/Location
- StockMovement immutable
- StockReservation optional
- StockBalance projection
- CostLayer/CostSnapshot ตาม policy
- CountSession/Adjustment
- TransferOrder

### 13.2 Invariants

- movement command idempotent ตาม source document + line + action
- transfer ออกและเข้าต้องคู่กัน
- void/reversal สร้าง movement ตรงข้าม ไม่ลบเดิม
- stock document final ใน locked period แก้ไม่ได้
- negative stock ตาม company policy; ถ้าอนุญาตต้องมี alert และ costing resolution
- quantity และ value reconcile กับ GL inventory/COGS ตามงวด

### 13.3 Costing policy

รองรับ policy ที่ตัดสินและทดสอบจริง เช่น moving average, FIFO perpetual หรือ periodic workflow ห้ามใช้หลาย policy ปะปนโดยไม่มี effective date/cutover

## 14. Fixed assets

- asset category/account mappings
- asset register และ source purchase
- capitalization approval
- useful life, residual value, method, start date
- monthly depreciation run แบบ draft → review → post
- transfer, improvement, impairment, disposal/write-off
- asset register, depreciation schedule และ GL reconciliation

ระบบเสนอ asset candidate จาก expense ได้ แต่ต้องให้ Accountant ยืนยัน capitalization และ policy

## 15. General ledger and closing

### 15.1 Journal model

- journal header: company, branch, date, type, source, description, status
- journal lines: account, debit/credit, currency/base amount, dimension, description
- source lineage และ posting rule snapshot
- balanced invariant และ active account/period validation
- draft/approved/posted/reversed states

### 15.2 Posting engine

Posting rule เป็น data ที่ versioned/reviewed ไม่ hardcode กระจายหลาย module ต้องรองรับ source type, business/tax context, category/product mapping, account roles, conditions, effective date และ fallback = fail closed

### 15.3 Canonical posting examples

ตัวอย่างต่อไปนี้เป็น baseline เพื่อสร้าง fixture ไม่ใช่ policy สำเร็จรูปของทุกบริษัท:

| เหตุการณ์ | Debit | Credit | Control สำคัญ |
|---|---|---|---|
| ขายเชื่อและรับรู้รายได้/VAT | Accounts receivable | Revenue + Output VAT | tax point/revenue policy/branch |
| รับเงิน invoice | Bank/Cash + WHT receivable ถ้ามี | Accounts receivable | allocation เท่ากับยอดรับรวม; ไม่ลง revenue ซ้ำ |
| รับเงินมัดจำ | Bank/Cash | Customer deposit/liability | ยังไม่เป็น revenue จนเข้า recognition boundary |
| ขายสด | Bank/Cash | Revenue + Output VAT | payment/document/stock idempotent ชุดเดียว |
| ออกใบลดหนี้ | Revenue/Output VAT หรือ account ที่เกี่ยว | Accounts receivable/refund payable | อ้าง original และเหตุผล; stock return แยก movement |
| ซื้อค่าใช้จ่ายเชื่อ | Expense/Asset + Input VAT หรือ pending VAT | Accounts payable | tax evidence/eligibility/mixed VAT |
| ซื้อสินค้าเข้าคลัง | Inventory + Input VAT หรือ pending VAT | Accounts payable | qty/value/costing/source receipt |
| จ่ายเจ้าหนี้พร้อม WHT | Accounts payable | Bank + WHT payable | payment event, certificate และ filing candidate |
| ค่าธรรมเนียมธนาคาร | Bank fee expense + Input VAT ถ้ามี | Bank | statement adjustment และ evidence |
| โอนระหว่างธนาคาร | Bank ปลายทาง | Bank ต้นทาง | statement lines สองฝั่ง; P&L ไม่เปลี่ยน |
| ค่าเสื่อมราคา | Depreciation expense | Accumulated depreciation | approved depreciation run |
| ตัด stock เพื่อขาย | Cost of goods sold | Inventory | fulfillment + costing policy |
| ปิด VAT รายงวด | Output/Input VAT control ตาม net position | VAT payable/receivable/credit carry | tax return snapshot; ห้าม hardcode entry เดียวทุกกรณี |

กฎต้องพิสูจน์ทั้ง normal, partial, void, correction, duplicate retry, locked period, foreign currency และ branch scope

### 15.4 Opening and cutover

รองรับ:

- opening trial balance
- open AR/AP พร้อมคู่ค้าและ due date
- bank/ cash opening
- stock qty/value/cost layers
- fixed assets/depreciation-to-date
- tax credits/liabilities
- retained earnings

ยอด opening ต้อง balance และมี sign-off ก่อน approve

### 15.5 Period close

Checklist ขั้นต่ำ:

1. เอกสาร draft/pending/rejected exception
2. AR/AP และ unapplied payment
3. bank/cash/credit-card reconciliation
4. inventory count/value/COGS reconciliation
5. fixed assets/depreciation
6. payroll/accrual/prepayment/provision
7. VAT/WHT และ tax packages
8. suspense/intercompany/transfer
9. trial balance balanced
10. P&L/Balance Sheet reasonableness and comparative review
11. close revenue/expense and roll retained earnings as applicable
12. lock period พร้อม approver/evidence

AI สรุป blocker และสร้าง checklist ได้ แต่การ post close/unlock ต้องเป็น explicit human action

## 16. Reports

### 16.1 Operational

- sales by document/product/customer/salesperson/project
- billing/collection/AR aging
- PO/receipt/purchase by product/vendor
- expense/payment/AP aging
- revenue inbox/match exception
- inventory on-hand/value/movement/low stock
- fixed asset/depreciation

### 16.2 Tax

- sales tax register
- purchase tax register แยก eligible/pending/non-creditable
- PP30/PP36 workpaper
- WHT issued/received, PND1/3/53, missing 50 Tawi
- e-Tax delivery/acknowledgement status

### 16.3 Accounting

- journal books JV/UV/SV/PV/RV
- general ledger/account activity
- trial balance before/after close
- P&L, Balance Sheet และ cash-flow workpaper
- opening/closing roll-forward
- bank reconciliation report
- source-to-ledger and ledger-to-report trace

ทุก report ต้องมี company/branch/scope/period/asOf/status filter, export snapshot, generatedAt, rule/version และ drill-down ไป source เมื่อมีสิทธิ์

## 17. Permissions and segregation of duties

| Capability | เจ้าของ | พนักงาน | การเงิน | นักบัญชี | ผู้อนุมัติ | Support |
|---|---:|---:|---:|---:|---:|---:|
| สร้าง draft เอกสาร | ตาม scope | ตาม scope | ตาม scope | ได้ | ไม่จำเป็น | ไม่ได้ |
| ออก/ยกเลิกเอกสาร | policy | จำกัด | จำกัด | ตามสิทธิ์ | approve | ไม่ได้ |
| เตรียม/จ่ายเงิน | policy | ไม่ได้ | maker | review | approve | ไม่ได้ |
| แก้ mapping/post JV | จำกัด | ไม่ได้ | จำกัด | ได้ | approve ตาม policy | ไม่ได้ |
| เตรียมภาษี | อ่าน | ไม่ได้ | ข้อมูลจ่าย | ได้ | approve | ไม่ได้ |
| ยื่น/ชำระภาษี | explicit role | ไม่ได้ | ตาม policy | prepare | final approve | ไม่ได้ |
| ล็อก/ปลดล็อกงวด | จำกัด | ไม่ได้ | ไม่ได้ | prepare | high privilege | ไม่ได้ |
| อ่าน audit/support | ตาม scope | ของตน | ตาม scope | ตาม scope | ตาม scope | time-bound grant |

ทุก operation ตรวจ tenant, company membership, branch scope, role/permission, record state และ feature entitlement ฝั่ง server ห้ามเชื่อ UI

## 18. API and integration contracts

### 18.1 Common command contract

- companyId/branchId จาก trusted context ไม่รับเชื่อตรงจาก payload โดยไม่มีตรวจ
- commandId/idempotencyKey
- expectedVersion สำหรับ optimistic concurrency
- source/channel/external ID
- actor/delegation context
- explicit confirmation สำหรับ high-impact command

### 18.2 Events

ตัวอย่าง:

- document.created/issued/voided/converted
- payment.recorded/allocated/refunded
- expense.extracted/reviewed/approved/paid
- inventory.movement.posted/reversed
- tax.event.created/assigned/filed/corrected
- journal.posted/reversed
- reconciliation.matched/completed/reopened
- period.locked/unlocked

Outbox ต้องทำให้ publish อย่างน้อยหนึ่งครั้งและ consumer idempotent

### 18.3 Connector boundary

Bank, Gateway, Marketplace, POS และ Partner adapter แปลงข้อมูลเป็น canonical source event เท่านั้น ไม่เขียน invoice/payment/journal โดยตรง การสร้าง final record ผ่าน domain command เดียวกันกับช่องทางเว็บ

## 19. Mangmee Brain integration

### 19.1 Modes

- General conversation: คุยทั่วไปเหมือนผู้ช่วยดิจิทัล โดยไม่อ้างข้อมูลปัจจุบันถ้าไม่ได้ค้น
- Business knowledge: อธิบายขั้นตอน เอกสาร และหลักบัญชีจาก approved knowledge
- Company insight: อ่านข้อมูลบริษัทจาก tools และตอบพร้อม period/source/asOf
- Exception assistant: อธิบายว่าทำไมยอด/VAT/match ไม่ผ่านและพาไปแก้
- Action handoff: สร้าง draft หรือ deep link; final mutation ยังให้ผู้ใช้ยืนยันตามสิทธิ์

### 19.2 Answer contract

คำตอบบริษัทใช้รูปแบบ:

1. คำตอบตรง ๆ
2. ตัวเลข/รายการพร้อมช่วงเวลา
3. ที่มาของข้อมูลและ asOf
4. ข้อจำกัดหรือ exception
5. ปุ่ม/ขั้นตอนถัดไป

คำตอบภาษีเสี่ยงสูงเพิ่ม source URL, effective/review date, jurisdiction, reviewer และข้อความให้ตรวจกรณีเฉพาะ ห้ามใช้โมเดลคำนวณแบบยื่นจากข้อความอิสระ

## 20. Quality evidence

### 20.1 Accounting correctness

- journal ทุกใบ debit = credit แบบ exact decimal
- source final หนึ่งครั้งสร้าง posting หนึ่งชุด; retry ไม่ซ้ำ
- reversal อ้างต้นฉบับและผลสุทธิเป็นศูนย์ตาม case
- trial balance debit = credit
- Balance Sheet assertion ผ่าน
- AR/AP subledger reconcile GL
- bank, inventory, fixed asset และ tax control accounts reconcile subledgers

หลักฐาน: property tests, golden journals, integration tests, source-to-report trace และ Accountant sign-off

### 20.2 Tax correctness

- official source register + effective dates
- line-level VAT golden cases
- PP30/PP36/WHT fixtures ที่ผู้เชี่ยวชาญลงนาม
- report/package schema validation
- filed snapshot immutable และ amendment lineage
- ห้ามเปิด pack/rule ที่ expired, unapproved หรือ source unknown

### 20.3 UX 40+

ทดสอบภารกิจขั้นต่ำกับผู้ใช้เป้าหมายอย่างน้อย 5 คนต่อรอบ:

- ถ่ายใบเสร็จและส่งตรวจ
- แก้ mixed VAT
- ออกใบเสนอราคาและแปลงต่อ
- บันทึกรับเงิน
- ดูรายการค้างและถามสมองมั่งมี

ผ่านเมื่อ task completion ≥90%, critical error = 0, ผู้ใช้รู้ว่างานสำเร็จ ≥95%, median time-to-first-value ตาม baseline ดีขึ้น และ SUS/คำถามความมั่นใจผ่านเกณฑ์ที่ Product กำหนดก่อนรอบทดสอบ

### 20.4 Reliability and performance

- critical API success ≥99.9% ในช่วงวัดที่ตกลง
- p95 read ≤1.5s และ mutation ≤2.5s สำหรับ core web path เป็น target ทดลองจนมี hosted baseline
- OCR/AI แสดงรับเรื่อง ≤1s p95 และมี durable status
- background job retry/DLQ/age alarm
- incident acknowledgement <15 นาที และ rollback/hotfix path ผ่าน drill
- backup restore test และ RPO/RTO มีหลักฐาน

### 20.5 Security/privacy

- cross-company/branch denial tests
- upload malware/quarantine/download denial evidence
- secret/token rotation และ LINE/web identity-link tests
- audit log ไม่มี prompt/raw receipt/tax ID/bank detail เกินจำเป็น
- sensitive exports มี permission, expiry และ audit

## 21. Acceptance gates ต่อ module

Module เปิดให้ลูกค้าจริงเมื่อ:

1. product journey, rules, exceptions และ owner ชัด
2. architecture/source of truth/state transitions ชัด
3. permission/tenant/audit/idempotency ผ่าน
4. loading/error/empty/forbidden/success ครบ
5. focused unit/integration tests ผ่าน
6. end-to-end happy + failure + retry + duplicate ผ่าน
7. accountant/tax/UX sign-off ตามความเสี่ยง
8. observability, alarm, runbook, kill switch/rollback พร้อม
9. UAT evidence ผูก exact SHA/environment
10. feature entitlement เปิด/ปิด/เปิดใหม่ไม่ทำข้อมูลเสีย

## 22. Non-goals ของ first release

- สร้างทุก connector ทุกธนาคาร/Marketplace/POS พร้อมกัน
- ให้ AI post บัญชี ยื่นภาษี หรือปลดล็อกงวดเอง
- ใช้ FlowAccount เป็นกฎภาษีหรือคัดลอก UI/ถ้อยคำ
- สร้าง ledger, payment หรือ inventory source อีกชุดเฉพาะ Auto Revenue
- โฆษณา 95% automation ก่อนมี production-quality baseline
- ทำ full payroll/CIT/e-Tax โดยไม่มี spec และผู้เชี่ยวชาญของแต่ละโดเมน

## 23. Open decisions ที่ต้องปิดก่อน implementation แต่ละช่วง

1. กลุ่มธุรกิจนำร่องและ volume จริงต่อวัน/เดือน
2. VAT registration/branch/currency/marketplace ของบริษัทนำร่อง
3. revenue recognition และ tax point policy ที่ Accountant รับรอง
4. costing method และ negative-stock policy
5. approval thresholds และ segregation of duties
6. ชนิดเอกสาร/แบบภาษีที่ต้องส่งออกจริงก่อน
7. bank/payment/marketplace connector แรก
8. ผู้เชี่ยวชาญบัญชี/ภาษีที่ลงนาม rule packs และ golden cases
9. SLO/RPO/RTO ที่ธุรกิจยอมรับหลังเห็น baseline
10. ขอบเขตคำตอบและ mutation ของสมองมั่งมีต่อ role
