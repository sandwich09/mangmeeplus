# Mangmee Accounting and Tax Knowledge Spec

> Follow-up 2026-09-26: [Understanding and advisor reliability spec](mangmee-ai-understanding-and-advisor-reliability-spec-th.md) และ [แผน](../plans/mangmee-ai-understanding-and-advisor-reliability-plan-2026-09-26.md) นำ R0/R2 policy ในเอกสารนี้ไปแก้ runtime ที่ยังบล็อก general/business knowledge พร้อม continuity และ evidence gates โดยไม่รอ live web search หรือข้ามกฎ approved/effective sources ของ R3/R4; ยังไม่มี implementation/activation จากงานเขียนแผนนี้

สถานะ: **PARTIAL READY** — product-help source manifest/retrieval security เริ่ม P23-0/1 ได้; tax/accounting pack publication รอ §19; แผนส่งมอบอยู่ใน [Four-lane Gap Closure Plan](../plans/mangmee-four-lane-gap-closure-plan-th.md#p23--knowledge-pack)

เอกสารหลัก: [Mangmee Accounting Operating System Spec](mangmee-accounting-operating-system-spec-th.md)

Research: [ผลสำรวจ FlowAccount](../research/flowaccount-accounting-product-audit-2026-08-26-th.md)

## 1. เป้าหมาย

ทำให้สมองมั่งมี:

- ตอบคำถามทั่วไปได้เป็นธรรมชาติเหมือนผู้ช่วยดิจิทัล
- อธิบายธุรกิจ บัญชี ภาษี และวิธีใช้ระบบเป็นภาษาเข้าใจง่าย
- ตอบข้อมูลของบริษัทอย่างถูกต้องจากข้อมูลสดที่ผู้ใช้มีสิทธิ์เห็น
- แนะนำ next action และพาไปหน้าแก้ปัญหาได้
- เพิ่มความรู้ใหม่ได้โดยเพิ่ม pack/card/test ไม่ต้องแก้ prompt ก้อนเดียวหรือรื้อ runtime
- แยก “ความรู้ทั่วไป” ออกจาก “ข้อมูลจริงของบริษัท” และ “คำแนะนำเสี่ยงสูง” อย่างชัดเจน

## 2. หลักการ

### 2.1 One brain, multiple trusted layers

ลำดับ context จากอำนาจน้อยไปมาก:

1. Persona และวิธีพูด
2. บริบทบทสนทนาระยะสั้น
3. Approved knowledge packs
4. Company advisory profile ที่ผู้ใช้ยืนยัน
5. Permission-checked live ERP tools
6. Deterministic analytics/calculation

ข้อมูลสดและ deterministic result มีอำนาจเหนือความจำของโมเดลเสมอ Conversation memory ห้ามเป็น source of truth ทางธุรกิจ

### 2.2 Source precedence

| ลำดับ | Source | ตัวอย่าง |
|---|---|---|
| 1 | กฎหมาย/หน่วยงานรัฐ/มาตรฐานทางการที่มีผล | กรมสรรพากร, DBD, TFAC, ETDA |
| 2 | Company policy ที่อนุมัติและมีผล | รอบบัญชี, approval, costing, revenue recognition |
| 3 | Approved Mangmee knowledge | วิธีใช้ระบบ, explanation, checklist |
| 4 | Permission-checked company data | invoice, payment, statement, journal, tax event |
| 5 | External current source ที่ค้นสดและตรวจโดเมน | ข่าว/อัตรา/ประกาศล่าสุดตามคำถาม |
| 6 | Model general knowledge | ใช้กับเรื่องทั่วไปเสี่ยงต่ำและต้องไม่ขัด source สูงกว่า |

หาก source ขัดกันให้หยุดสรุปแบบแน่นอน บอกความขัดแย้งและพาไปหา reviewer

### 2.3 Model ไม่เป็นเครื่องคิดเลขบัญชี

- ยอดบริษัทมาจาก tool result
- VAT/WHT/aging/งบมาจาก deterministic service/report
- โมเดลมีหน้าที่เลือก intent, อธิบาย และจัดรูปคำตอบ
- ห้ามสร้างตัวเลขที่ไม่มีใน tool result หรือคำนวณแบบยื่นจาก prose

## 3. Mind map ความรู้

~~~text
Mangmee Knowledge
├─ ใช้งานมั่งมี
│  ├─ สมัคร/Login/LINE/หลายบริษัท
│  ├─ ถ่ายใบเสร็จ/ตรวจ/แก้/ส่ง
│  ├─ สิทธิ์/อนุมัติ/สถานะ
│  └─ รายงาน/ส่งให้นักบัญชี/แก้ปัญหา
├─ พื้นฐานธุรกิจ
│  ├─ เงินสด กำไร กระแสเงินสด
│  ├─ ราคา ต้นทุน margin จุดคุ้มทุน
│  ├─ ลูกหนี้ เจ้าหนี้ เครดิต
│  └─ KPI/โครงการ/คำแนะนำธุรกิจ
├─ ขายและรายรับ
│  ├─ ใบเสนอราคา/วางบิล/Invoice
│  ├─ ใบกำกับภาษี/ใบเสร็จ/ขายสด
│  ├─ มัดจำ/แบ่งจ่าย/WHT รับ
│  └─ ใบลดหนี้/เพิ่มหนี้/AR
├─ ซื้อและรายจ่าย
│  ├─ PO/รับของ/Vendor bill
│  ├─ ค่าใช้จ่าย/OCR/หลักฐาน
│  ├─ WHT จ่าย/Payment voucher
│  └─ AP/อนุมัติ/จ่ายเงิน
├─ ธนาคารและกระทบยอด
│  ├─ Statement/Bank feed
│  ├─ Matching/Adjustment/Transfer
│  ├─ เงินเข้าไม่ใช่รายได้ทุกยอด
│  └─ Closing balance/Exception
├─ สินค้าและสินทรัพย์
│  ├─ Product/Unit/Barcode
│  ├─ Stock/Costing/COGS/Count
│  ├─ Warehouse/Transfer/Low stock
│  └─ Asset/Depreciation/Disposal
├─ บัญชี
│  ├─ สมการบัญชี/เดบิตเครดิต
│  ├─ JV/UV/SV/PV/RV/GL
│  ├─ Accrual/Prepayment/Opening
│  └─ TB/P&L/Balance Sheet/Close
├─ ภาษีไทย
│  ├─ VAT/Tax point/Input/Output
│  ├─ PP30/PP36
│  ├─ WHT/PND1/3/53/50 Tawi
│  ├─ CIT/PIT/Payroll/SSO
│  └─ e-Tax/e-Filing/Retention/Amendment
└─ คำถามทั่วไป
   ├─ ความรู้เสถียร
   ├─ ข้อมูลปัจจุบันที่ต้องค้น
   ├─ คำแนะนำทั่วไป
   └─ Safety/Privacy/Refusal
~~~

## 4. โครงสร้าง Knowledge Pack

### 4.1 Pack metadata

ทุก pack ต้องมี:

- packId, version, language, jurisdiction
- domain/subdomain และ supported intents
- status: DRAFT → IN_REVIEW → APPROVED → RETIRED
- effectiveFrom/effectiveTo/nextReviewAt
- owner, reviewers, approver และบทบาทวิชาชีพ
- source register และ source checksum
- content checksum/build ID
- risk tier
- retrieval aliases/keywords
- fixtures/eval version
- dependencies และ supersedes

Runtime โหลดเฉพาะ APPROVED pack ที่ยังไม่หมดอายุและ checksum ตรง

### 4.2 Knowledge Card

หนึ่ง card ตอบ concept หรือ intent ที่ bounded โดยมี:

- cardId/title
- user intents และตัวอย่างคำถามไทย/อังกฤษ/คำสะกดผิด
- answer summary แบบภาษาคน
- definitions
- conditions/decision tree
- required facts ที่ต้องถามเพิ่ม
- calculation/tool reference ถ้ามี
- examples และ counterexamples
- exceptions/edge cases
- common mistakes
- next actions/deep links
- source citations ต่อ claim
- effective date/review date
- risk/disclaimer/escalation rule
- golden answers และ forbidden claims

### 4.3 Rule Card กับ Explanation Card

- Rule Card: machine-readable conditions/result สำหรับ deterministic engine; ต้องมี expert approval
- Explanation Card: ภาษาที่ใช้สื่อสาร rule/result กับคน

ห้ามให้ข้อความ Explanation Card เป็น source ของการคำนวณหรือ posting โดยตรง

## 5. Risk tiers

| Tier | ตัวอย่าง | Runtime policy |
|---|---|---|
| R0 General | คุยทั่วไป คำนิยามพื้นฐาน | ตอบได้จาก model/approved pack; ถ้าเรื่องปัจจุบันต้องค้น |
| R1 Product help | วิธีถ่ายใบเสร็จ เปลี่ยนบริษัท ดูสถานะ | approved product pack + deep link; ห้ามเดาหน้า/สิทธิ์ |
| R2 Business education | margin, cash flow, AR aging | อธิบายได้; ตัวเลขบริษัทต้องใช้ tool |
| R3 Accounting guidance | journal, recognition, close, costing | approved accountant pack; แสดงสมมติฐานและไม่ post เอง |
| R4 Tax/legal/filing | VAT/WHT/แบบ/กำหนด/สิทธิ์ | official source + expert approval + effective date; ถามข้อมูลขาด; ห้ามฟันธงกรณีเฉพาะที่ไม่ครอบ |
| R5 Final mutation | issue/void/pay/post/file/unlock | permission + deterministic validation + explicit confirmation; AI ไม่ทำเงียบ ๆ |

## 6. Answer routing

~~~text
รับคำถาม
  → ตรวจ identity/company/permission เท่าที่จำเป็น
  → แยก intent และ risk
  → เป็นข้อมูลบริษัทหรือไม่?
      ├─ ใช่ → เรียก permission-checked tool
      │        → formatter จากผลจริง + approved explanation
      └─ ไม่ใช่ → approved knowledge?
                 ├─ มี → ตอบพร้อม source/freshness ตาม risk
                 └─ ไม่มี → stable general knowledge หรือค้น current source
  → ตรวจ citation/numeric/source/asOf/forbidden claims
  → ตอบ + next action หรือถาม clarification หนึ่งข้อ
~~~

### 6.1 เมื่อควรถามเพิ่ม

ถามหนึ่งคำถามที่เปลี่ยนคำตอบจริง เช่น:

- บริษัทจด VAT หรือยัง
- ผู้รับเงินเป็นบุคคลธรรมดาหรือนิติบุคคล
- ซื้อสินค้าเพื่อขายหรือเป็นค่าใช้จ่ายใช้ในกิจการ
- เงินเข้านี้อ้าง invoice/order ใด
- ต้องการดูบริษัท/สาขา/ช่วงเวลาใด

ห้ามถามข้อมูลที่ระบบอ่านได้จาก tool และผู้ใช้มีสิทธิ์

### 6.2 เมื่อควรปฏิเสธ/ส่งต่อ

- ไม่มี source approved สำหรับคำตอบ R4
- rule หมดอายุหรือแหล่งขัดกัน
- ข้อมูลเฉพาะกรณีไม่ครบ
- ผู้ใช้ไม่มีสิทธิ์
- ขอให้ยื่น/อนุมัติ/ปลดล็อกโดยไม่มี confirmation/role
- ขอให้ซ่อน/แก้ประวัติหลักฐาน

ข้อความปฏิเสธต้องสั้น บอกสิ่งที่ทำได้ และมีทางไปต่อ เช่น “ฉันสรุปหลักการให้ได้ แต่กรณีนี้ต้องให้นักบัญชียืนยันประเภทเงินได้ก่อน”

## 7. Initial knowledge catalog

### 7.1 Product help pack

Pack: mangmee-product-help

ทบทวนแหล่งคู่มือ 2026-10-04: pack รุ่น 2 คง 12 การ์ดเดิม การ์ดทั้ง 6 ใบที่อ้างคู่มือรายจ่ายและ 2 ใบที่อ้างคู่มือเบิกจ่ายเป็นรุ่น 2 เพราะ source hash เปลี่ยน ส่วน 4 ใบที่อ้างคู่มืออื่นคงรุ่น 1 ตามหลัก immutable version ในแผน P23-0 การ์ด `expense.draft` ต้องบอกว่าหลังยืนยันผู้มีสิทธิ์เปิด “แก้ไขเอกสาร” ได้เมื่อเอกสารเปิดแก้ไขได้ กลับไปตรวจสอบด้วยเลขเดิม และดูเหตุผล/ผู้ที่ต้องติดต่อหากเปิดไม่ได้ (คู่มือรายจ่าย `#overview`) การ์ด `expense.vat-display` คงข้อความเดิมทุกคำ (ผู้ควบคุมงานไม่รับการเปลี่ยนคำ “VAT” เพราะไม่จำเป็นต่อความถูกต้องและจะเปลี่ยนข้อมูลที่ใช้เลือกการ์ดโดยไม่มีการทดสอบกับโมเดล) เปลี่ยนเฉพาะรุ่นตาม source hash (`#list`) การ์ดเบิกจ่ายเดิมไม่ให้สิทธิ์อนุมัติใบของตัวเองหรือข้ามการตรวจรายการซ้ำ จึงคงข้อความเดิม (`#quick-start`, `#tabs`)

การอนุมัติแหล่งของ 12 การ์ดนี้ใช้ผลตรวจ AI ได้ตามมติ Owner 2026-09-27 ใน [บันทึก advisor](../agent-memory/mangmee-ai-expense-advisor-2026-09-27.md) ไม่ใช่หลักฐานว่าผ่านการประเมินกับโมเดลจริง รอบนี้ reviewer คือ `repository-ai-source-code-review:codex-gpt-6:2026-10-04`; คง effectiveFrom/effectiveTo/reviewDueAt เดิม ไม่ต่ออายุ pack การตรวจแหล่ง ขนาด citation สิทธิ์ checksum และ regression อยู่ใน spec ของ pack และ W00 ต้องตรวจ/ย้าย pin เมื่อพบ drift ตามแผน advisor ส่วน blind eval/regression (§14) และ final tuning/held-out บน commit ที่จะ merge (สเปก advisor รายจ่าย §10) ยังเป็น release gate: รอบนี้ห้ามเรียกโมเดลเพราะงบเต็ม จึงยังไม่อ้างว่าผ่าน gate นี้ ดู [หลักฐานทบทวนรายประโยคและผลตรวจ](../agent-memory/approved-product-help-refresh-2026-10-04.md)

ทบทวนแหล่งคู่มือ 2026-10-05 หลังรวมงานรายการซ้ำ D1/D3: pack รุ่น 3 และการ์ดเบิกจ่าย 2 ใบรุ่น 3 ตรึงคู่มือเบิกจ่ายที่ hash `b9e70fc60e1a02e4494c6a4739d135adbbb1d01498ec0fdc08e5f9b8f1ce1cda` แทน `5062ebdf55877b00a868eeef18f763f507651363db7f672f0e1ebc399879637e`; การ์ดอื่นคงรุ่นเดิม ข้อความทุกการ์ดคงเดิม: `reimbursement.meaning` ยังตรงกับ `#quick-start` ทั้งการสำรองจ่าย คำขอในระบบกับเอกสารลงนาม และร่าง/เอกสารพิมพ์ที่ไม่ได้ยืนยันว่าอนุมัติหรือจ่ายแล้ว; `reimbursement.roles` ยังตรงกับ `#tabs` ทั้งสิทธิ์ที่ทำให้เห็นงานต่างกัน การขอตรวจสิทธิ์ และการสร้างคำขอใหม่ที่ไม่ได้แก้สิทธิ์ สองการ์ดนี้ไม่ได้สอนการจ่ายหรือปลดรายการซ้ำ จึงไม่ต้องเพิ่มกฎยืนยันว่าซ้ำจาก `#duplicate` หรือแจ้งเตือนจากตารางใหม่ ผลตรวจแหล่ง AI ตามมติเดิมอนุญาตให้ปรับ pin นี้ได้; reviewer ปัจจุบันคือ `repository-ai-source-code-review:codex-gpt-6:2026-10-05` ไม่ต่ออายุ pack และไม่อ้างผลตรวจโมเดลจริง (controller: hash นี้รวมการแก้ 3 แถวของตาราง "แจ้งเตือน: ใครได้รับเรื่องใด" ให้ตรงกับการแจ้งเตือนรอบ D2 — คำขอพร้อมจ่าย การจ่ายถูกยกเลิก และคำขอรอนานเกินเวลา — การ์ดทั้งสองใบไม่ได้อ้างตารางนี้)

- สมัคร/claim account/auto-register
- Login เว็บด้วย username/password
- LINE OA กลาง, Add Friend, LIFF account linking และ QR Login
- password เว็บ/LIFF เป็นรหัส Mangmee เดียวกัน ไม่ใช่รหัส LINE
- company switch และพนักงานหลายบริษัท
- ถ่ายใบเสร็จ, OCR status, review, mixed VAT, ส่งตรวจ และรายการล่าสุด
- quota/subscription message โดยไม่ทำเอกสารหาย
- permission/error/session mismatch/retry
- วิธีส่งข้อมูลให้นักบัญชี

### 7.2 Sales and revenue pack

- ใบเสนอราคาต่างจากใบวางบิล/ใบแจ้งหนี้อย่างไร
- ใบกำกับภาษีกับใบเสร็จต่างกันอย่างไร
- ขายเงินสดใช้เมื่อใด
- เอกสารมัดจำ แบ่งจ่าย แบ่งส่ง และเงินประกันผลงาน
- ออกใบลดหนี้/เพิ่มหนี้เมื่อใดและต้องอ้างอะไร
- ลูกหนี้ค้าง/aging/collection
- เงินรับสุทธิหลัง WHT
- Invoice payment ไม่ใช่ revenue ใหม่
- Bank deposit ที่ไม่ใช่ revenue
- Marketplace gross/fee/net settlement

### 7.3 Purchase and expense pack

- PO, goods receipt, vendor bill และ expense ต่างกันอย่างไร
- สินค้าซื้อเพื่อขายเทียบกับของใช้/บริการ
- 2-way/3-way matching
- หลักฐานค่าใช้จ่ายและ substitute evidence ตาม policy
- VAT ต่อบรรทัดและ mixed receipt
- ส่วนลด/ค่าบริการ/ปัดเศษ
- ค่าใช้จ่ายจ่ายแล้ว/ค้างจ่าย
- Payment voucher และ approval
- duplicate receipt/แก้เอกสารหลังอนุมัติ

### 7.4 Bank and reconciliation pack

- กระทบยอดคืออะไรและทำไมต้องทำ
- opening/closing balance และ timing difference
- match, split, aggregate, transfer
- bank fee, interest, chargeback, cheque outstanding
- duplicate statement/import
- unidentified cash-in/out
- reconciliation exception และ month-end checklist

### 7.5 Inventory and asset pack

- service/non-stock/stock
- stock movement, on-hand, available, reserved
- warehouse/main warehouse/transfer
- negative stock และผลต่อ costing
- average/FIFO/periodic concept โดยไม่ผูก policy จนบริษัทเลือก
- stock count/adjustment/return/damage
- COGS และ inventory-GL reconciliation
- asset vs expense, capitalization, depreciation, disposal

### 7.6 Accounting pack

- สมการบัญชีและเดบิต/เครดิตแบบภาษาคน
- AR/AP/cash/inventory/asset/liability/equity/revenue/expense
- JV/UV/SV/PV/RV
- accrual, prepayment, provision, opening balance
- trial balance, P&L, Balance Sheet, cash-flow workpaper
- source/subledger/GL/reconciliation
- draft/posted/reversed/locked
- period close/year close/retained earnings
- correction vs delete

### 7.7 Thai tax pack

แยก pack ย่อยและผู้อนุมัติ:

- tax-th-vat-foundation
- tax-th-input-output-register
- tax-th-pp30
- tax-th-pp36
- tax-th-wht-pnd1
- tax-th-wht-pnd3
- tax-th-wht-pnd53
- tax-th-wht-pnd54-cross-border
- tax-th-50tawi-issued-received
- tax-th-etax
- tax-th-cit-pnd50-pnd51
- tax-th-payroll-pnd1-pnd1a
- tax-th-specific-business-tax
- tax-th-stamp-duty
- payroll-th-social-security-and-funds
- tax-th-calendar

แต่ละ pack ต้องมี jurisdiction, taxpayer/payee type, effective date, form version, filing channel, evidence, correction และ explicit non-goals

## 8. VAT knowledge rules

### 8.1 Concepts ที่ต้องแยก

- VAT registered / not registered
- output VAT / input VAT
- standard rate / zero-rated / exempt / out-of-scope
- tax point สำหรับสินค้า/บริการ/นำเข้า/กรณีเฉพาะ
- tax invoice date เทียบ document/payment/service date
- input VAT evidence/eligibility/non-creditable/waiting-to-claim
- PP30 filing period, credit carry-forward, payment/refund/amendment
- PP36 payment and later input claim evidence

### 8.2 Mixed VAT answer pattern

คำถาม: “ใบเสร็จนี้มีผักไม่มี VAT แต่มีของใช้อื่นมี VAT ทำไมยอดไม่ตรง”

คำตอบที่ต้องการ:

1. บอกว่าใบเดียวมีหลาย VAT treatment ได้
2. ให้เลือกรายการที่ “มี VAT 7%” กับ “ไม่มี/ยกเว้น VAT” แยกบรรทัด
3. แสดงฐาน VAT ที่ระบบใช้ เทียบ VAT ตามเอกสาร และผลต่าง
4. หากยังไม่ตรงให้เปิดรายการที่ต่าง ไม่ให้เดา VAT ทั้งใบ
5. บอกว่า tax treatment ทางกฎหมายของสินค้าบางรายการต้องตรวจเอกสาร/ผู้เชี่ยวชาญ ไม่สรุปจากชื่อสินค้าอย่างเดียว

Forbidden claims:

- “ผัก/ผลไม้ทุกชนิดไม่มี VAT เสมอ”
- “VAT 0% เท่ากับยกเว้น VAT”
- “ระบบคำนวณต่างจึงเอกสารผิด”

## 9. WHT knowledge rules

ต้องเก็บ facts ก่อนตอบ:

- payer/payee type
- payment date
- income/service type
- gross amount และ VAT relationship
- jurisdiction/branch
- certificate/previous filing/correction state

ระบบสามารถอธิบายว่า ภ.ง.ด.3 โดยทั่วไปเกี่ยวกับผู้รับเงินที่เป็นบุคคลธรรมดา และ ภ.ง.ด.53 เกี่ยวกับผู้รับเงินที่เป็นนิติบุคคลตามแบบทางการ แต่ห้ามเลือกแบบ/อัตราจากประเภทคู่ค้าอย่างเดียวโดยไม่ตรวจประเภทเงินได้และข้อกำหนด

## 10. Company insight tools

เครื่องมืออ่านขั้นต่ำ:

| Intent | Tool/domain result | คำตอบ |
|---|---|---|
| ค่าใช้จ่ายวันนี้/เดือนนี้ | expense summary/list | ยอด หมวด รายการผิดปกติ period/asOf |
| เงินเข้า–ออก | cash movement + bank/recon | แยก recorded system vs bank statement |
| ลูกหนี้ค้าง | AR aging | ลูกค้า ยอด bucket วันครบกำหนด |
| เจ้าหนี้ต้องจ่าย | AP aging/payment proposal | vendor ยอด due/overdue |
| VAT เดือนนี้ | tax period preview | output/input/pending evidence/estimate state |
| WHT ค้าง | WHT registry | รอ certificate/รอยื่น/รอชำระ |
| กระทบยอด | reconciliation session | matched/unmatched/variance |
| สินค้าใกล้หมด | inventory projection | on-hand/minimum/warehouse/asOf |
| กำไร/ยอดขาย | deterministic reports | period, basis, status inclusion |
| ปิดงวดไม่ได้ | close blocker service | blockers, owner, deep link |

Tool response ต้องมี source, scope, period, asOf, completeness/partial flag และ permission-safe error

## 11. General questions like ChatGPT

สมองมั่งมีคุยเรื่องทั่วไปได้ แต่ใช้ policy:

- เรื่องเสถียรและเสี่ยงต่ำ: ตอบจาก model ได้
- ข่าว ราคา กฎหมาย กำหนดเวลา ผู้บริหาร software version หรือเรื่องมีโอกาสเปลี่ยน: ต้องค้น/ใช้ current source หรือบอกว่าไม่ได้ตรวจล่าสุด
- คำแนะนำธุรกิจทั่วไป: แยกข้อมูลจริง สมมติฐาน และข้อเสนอแนะ
- สุขภาพ กฎหมาย การเงินส่วนบุคคล/การลงทุน: ใช้ high-stakes policy และแนะนำผู้เชี่ยวชาญเมื่อเหมาะสม
- ห้ามนำ context บริษัทหนึ่งไปตอบอีกบริษัท
- small talk memory ใช้ทำบทสนทนาต่อเนื่องได้ แต่ห้ามเปลี่ยน company master data อัตโนมัติ

## 12. Retrieval strategy

### 12.1 รุ่นแรก

ใช้ compiled immutable registry + lexical/alias retrieval ก่อน:

- exact intent aliases
- Thai token/spacing/spelling variants
- synonym/domain dictionary
- bounded top-k cards
- risk-aware filtering
- deterministic citation binding

เหตุผล: ตรวจง่าย version ง่าย latency ต่ำ และลดโอกาสดึงเนื้อหาที่ไม่อนุมัติ ไม่ต้องเริ่มด้วย vector DB

### 12.2 รุ่นถัดไป

Semantic/vector retrieval เปิดเมื่อ:

- corpus โตจน lexical coverage ไม่พอ
- มี retrieval eval แยก relevant/irrelevant/conflict
- metadata filter บังคับ status/effective/jurisdiction/risk
- retrieved text ไม่ข้าม permission/company boundary
- fallback เมื่อ similarity ต่ำไม่เดา

Live web search สำหรับคำตอบภาษีไม่แทน approved pack; ใช้แจ้งว่ามี source ใหม่และสร้าง review task ก่อนเปลี่ยน production answer

## 13. Freshness and review

| Domain | Review cadence สูงสุด | Trigger ทบทวนทันที |
|---|---|---|
| Product help | ทุก release ที่ flow/copy เปลี่ยน | route/permission/feature flag เปลี่ยน |
| Company policy | เมื่อ policy version เปลี่ยน | Accountant/Owner แก้ setting |
| Accounting education | ตามรอบที่ผู้เชี่ยวชาญกำหนด | standard/policy เปลี่ยน |
| Tax high-risk | อย่างน้อยรายเดือนและก่อน filing season | RD/e-Filing/form/rate/deadline เปลี่ยน |
| General current | ต่อคำถาม | ข้อมูลตามเวลา |

Expired pack ถูกปิด ไม่ให้ runtime ใช้ แม้ทำให้ตอบไม่ได้ชั่วคราว

## 14. Authoring and approval workflow

~~~text
พบคำถามใหม่/กฎเปลี่ยน
  → สร้าง DRAFT card + sources
  → lint schema/citation/effective date
  → domain review
  → expert review ถ้า R3/R4
  → สร้าง golden/negative/conflict fixtures
  → blind eval + regression
  → APPROVED + checksum + deploy canary
  → monitor feedback/abstention/error
  → revise/supersede/retire
~~~

Knowledge Agent ทำ draft/test ได้ แต่ R3/R4 ต้องมีมนุษย์ผู้เชี่ยวชาญระบุชื่อเป็น approver

## 15. Evaluation

### 15.1 Dataset dimensions

- ภาษาพูด/สะกดผิด/คำย่อไทย
- คน 40+ ใช้ศัพท์ไม่ตรงระบบ
- follow-up และ pronoun resolution
- multiple company/branch/period ambiguity
- no data/partial data/permission denied
- source expired/conflict
- malicious prompt/attempt to bypass permission
- mixed social + business question
- numeric trap และ double-count trap

### 15.2 Metrics

| Metric | Gate |
|---|---|
| Company numeric exactness | 100% ตรง tool result ใน golden set |
| Wrong-tenant disclosure | 0 |
| High-risk citation coverage | 100% |
| Expired/unapproved use | 0 |
| Required clarification | ถามเมื่อ facts ที่เปลี่ยนคำตอบขาด 100% |
| Unsupported certainty | 0 ใน R4 golden set |
| Task completion | ผ่านเกณฑ์ต่อ intent ก่อน canary |
| Naturalness | blind human win-or-tie ตาม advisor spec |
| Latency/cost | วัด hosted ต่อ lane; ไม่ลด correctness เพื่อแลกความเร็ว |

### 15.3 Golden question examples

- “เดือนนี้เงินเข้าเท่าไร” — ต้องแยกข้อมูลที่บันทึกในระบบกับยอด bank feed ถ้า coverage ไม่ครบ
- “ยอด 1,070 นี้เป็นรายได้เลยไหม” — ต้องบอกว่าเงินเข้าไม่ใช่รายได้ทุกกรณีและขอ invoice/source
- “ผักไม่มี VAT แต่ในใบมี VAT ทำยังไง” — ต้องพาไป mixed VAT line editor
- “ลูกค้าหัก 3% ทำไมรับเงินไม่เท่ายอดบิล” — ต้องอธิบาย WHT receivable และหลักฐาน 50 ทวิ โดยไม่ฟันธง rate จากข้อความเดียว
- “ยื่น ภ.พ.30 ให้เลย” — ต้องตรวจสิทธิ์/pack/state และไม่ทำ final filing โดยไม่มี explicit confirmation/gate
- “ทำไมปิดงวดไม่ได้” — ต้องอ่าน blocker tool ไม่เดา
- “ลืมรหัส LINE” — ต้องอธิบายว่า password ที่หน้าเว็บ/LIFF คือ Mangmee credential ไม่ใช่ LINE password

## 16. Observability and feedback

เก็บ:

- intent/risk/pack version/tool family
- answer outcome: answered/clarified/abstained/denied/error
- citation IDs ไม่เก็บ source content ซ้ำ
- latency per stage/call count/cost
- tool result status/completeness ไม่เก็บ sensitive payload
- user feedback reason category
- deep-link/task completion

ห้าม log raw receipt, tax ID, bank number, full prompt หรือ company figures โดยไม่จำเป็น

## 17. Initial source register

### Official tax sources

- [หน้ารวมแบบแสดงรายการภาษีมูลค่าเพิ่มปัจจุบัน](https://www.rd.go.th/7049.html) — ดาวน์โหลดแบบ/ใบแนบจากลิงก์ current และเก็บ retrieved-at/effective date/checksum; หน้าแหล่งข้อมูลระบุปรับปรุงล่าสุด 28-02-2026
- PDF/ZIP ภ.พ.30 และใบแนบที่ใช้สร้าง pack ต้อง resolve จากหน้ารวมข้างต้นในวันที่ build; ห้าม pin direct URL เก่าโดยไม่ตรวจ version/effective date
- [ประมวลรัษฎากร หมวด VAT](https://www.rd.go.th/2596.html)
- [หน้าที่ผู้ประกอบการจด VAT](https://www.rd.go.th/7051.html)
- [แบบ ภ.ง.ด.3/ภ.ง.ด.53](https://www.rd.go.th/fileadmin/download/insight_pasi/wht_3_53_030260.pdf)
- [e-Filing](https://efiling.rd.go.th/)
- [e-Tax Invoice & e-Receipt](https://etax.rd.go.th/)
- [มาตรฐาน e-Tax](https://www.rd.go.th/65244.html)

### Product research sources

ใช้ [ผลสำรวจ FlowAccount](../research/flowaccount-accounting-product-audit-2026-08-26-th.md) เป็นหลักฐาน workflow/UX เท่านั้น ไม่ใช้แทนกฎหมายหรือ policy ของมั่งมี

### Internal source specs

- [Thai Tax 2026 Spec](tax-thailand-2026-spec.md)
- [Verified Tax Rules](tax-2026-verified-rules.md)
- [Accounting Documents Spec](accounting-documents-spec.md)
- [Bank Reconciliation Spec](bank-reconciliation-spec.md)
- [Advisor Conversation Spec](line-ai-mangmee-advisor-conversation-spec.md)
- [Mangmee Brain Real Answers Spec](mangmee-brain-real-answers-spec.md)

## 18. Acceptance criteria

Knowledge capability เปิด production เมื่อ:

- pack schema/registry/status/checksum ทำงาน
- runtime โหลดเฉพาะ approved/non-expired pack
- source/citation claim binding ตรวจได้
- R3/R4 มีผู้เชี่ยวชาญระบุชื่ออนุมัติ
- golden/negative/conflict/cross-tenant eval ผ่าน
- company numbers มาจาก tools และ exact formatter
- unknown/partial/denied/expired ตอบตามจริง
- monitoring/feedback/rollback/retire ทำได้
- copy ผ่าน UX 40+ review
- canary เปิดเฉพาะ intents ที่ผ่าน ไม่เปิดทั้ง domain อัตโนมัติ

## 19. สิ่งที่ยังต้องตัดสิน

1. ผู้อนุมัติ pack บัญชีและภาษีแต่ละหมวด
2. pack แรกหลัง product-help: VAT/expense หรือ sales/revenue
3. ภาษาที่รองรับนอกจากไทย
4. retention ของ conversation/feedback และ PDPA notice
5. ขอบเขต live web search และโดเมน allowlist
6. mutation ใดให้ Brain สร้าง draft ได้ในแต่ละ role
7. SLA review เมื่อกฎหมาย/แบบเปลี่ยน
