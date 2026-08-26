# สมุดรายรับ–รายจ่าย (Income–Expense Ledger MVP) — Spec

สถานะ: **DRAFT รอ Owner review ก่อนลงมือ (docs-first)**

ที่มา: การตัดสินใจ Owner 2026-08-26 — ทำฟีเจอร์ "สมุดรายรับ–รายจ่าย" ก่อน โดยยังไม่ทำระบบบัญชีเต็มและไม่ทำกระทบยอดธนาคาร; เอกสารขายต้องเป็นแกนของรายรับ ไม่ใช่ช่องกรอกยอดลอย ๆ

หลักฐานโค้ดทั้งหมดอ้างอิง branch `develop` @ `beb0c5f6` (สำรวจ 2026-08-26)

เอกสารแม่:

- [Mangmee Accounting Operating System Spec](mangmee-accounting-operating-system-spec-th.md) — ภาพเต็มระยะยาว; spec นี้คือ vertical slice แรกฝั่งขาย+สรุป
- [Mangmee Accounting OS Implementation Plan](../plans/mangmee-accounting-os-implementation-plan-th.md) — สมุดฯ = ส่วนตัดของ P7 (Sell-to-Cash) + P8 (Expense) โดยไม่รวม P9 (Bank/Reconciliation)
- [ผลสำรวจ FlowAccount 2026-08-26](../research/flowaccount-accounting-product-audit-2026-08-26-th.md) — §6.3 (หลักเอกสารขาย), §7.3 (pattern ค่าใช้จ่าย+OCR)
- [แผนหลัก 2.5 วัน](../plans/mangmee-brain-2-5-day-priority-plan-th.md) — §13.10 (ฟีเจอร์รายรับ), §13.2 แถว "รายรับจากเอกสารขาย", REVENUE-01..08, §15 แถว "รายรับจากเอกสารขาย"
- แผนส่งมอบของ spec นี้: [Income–Expense Ledger Implementation Plan](../plans/mangmee-income-expense-ledger-plan-th.md)

## 1. เป้าหมายและภาษา

ผู้ใช้ 40+ ต้องทำ 3 อย่างได้จบบนมือถือโดยไม่รู้ศัพท์บัญชี:

1. **บันทึกรายรับ** — ขายแล้วรับเงินทันที หรือออกบิลไว้ก่อนแล้วตามเก็บ
2. **บันทึกรายจ่าย** — ถ่าย/อัปโหลดใบเสร็จให้ AI อ่าน หรือกรอกเอง (มีอยู่แล้ว — รอบนี้จัด UX)
3. **เปิดสมุด** — เห็นยอดขายจากเอกสาร, รับเงินแล้ว, รอรับเงิน, รายจ่ายที่บันทึก, จ่ายแล้ว และส่วนต่าง พร้อมกราฟตามหมวดและดาวน์โหลด Excel/CSV

กติกาภาษา (บังคับทุกหน้าจอ/ทุกรายงาน/ทุกคำตอบ AI):

- ใช้คำว่า **"ส่วนต่างรายรับ–รายจ่ายที่บันทึก"** และ **"ส่วนต่างเงินรับ–เงินจ่าย"** — **ห้ามใช้ "กำไร" และ "ยอดเงินคงเหลือ"** เพราะยังไม่มีกระทบยอดธนาคารและข้อมูลอาจไม่ครบทุกธุรกรรม (งบกำไรขาดทุนจริงมีแล้วที่หน้า `/journal` ผ่าน `ledger.report.read` — `apps/web/src/features/ledger/LedgerReportsPage.tsx:235-238` — เป็นคนละเรื่องและไม่แตะในรอบนี้)
- ผู้ใช้กรอกภาษาธุรกิจ (หมวด, ช่องทางรับเงิน, มี VAT ไหม) — account code/tax code/เดบิตเครดิตอยู่หลังบ้านตาม mapping ที่มีอยู่

## 2. หลักการที่ห้ามละเมิด

1. **เอกสารขายเป็นแกนรายรับ — ไม่มีตารางรายรับแยกขาด** (REVENUE-02, แผนหลัก:951): รายรับทุกบาทต้องมี `AccountingDocument` + `AccountingPayment` อยู่เบื้องหลัง ฟอร์ม "บันทึกรายรับ" เป็นเพียง orchestration บน engine เดิม
2. **รับชำระ = ปิดยอดค้าง ไม่สร้างรายได้/VAT ซ้ำ** (REVENUE-04, แผนหลัก:954) — ข้อนี้ **โค้ดบังคับอยู่แล้ว** และห้าม regression:
   - `createPayment` เขียนเฉพาะ `paidAmount/outstandingAmount/paymentStatus` ของเอกสาร ไม่แตะรายได้/VAT (`apps/api/src/modules/accounting-documents/infrastructure/prisma-accounting.repository.ts:751-757`)
   - posting ฝั่งรับเงิน = Dr Cash/Bank (+WHT receivable) / Cr AR เท่านั้น (`apps/api/src/modules/ledger/domain/logic/posting-engine.logic.ts:158-168`); รายได้+Output VAT ลงตอน issue เอกสารเท่านั้น (`:136-147`)
   - RECEIPT ถูกห้าม carry tax lines พร้อมข้อความ error ภาษาไทยในระบบแล้ว (`document.use-case.ts:344-346`, copy ใน `AccountingPages.tsx:349`: "ใบเสร็จรับเงินเป็นหลักฐานรับชำระ ไม่มี Tax Code และไม่สร้าง VAT ซ้ำ")
3. **Additive only**: ไม่แก้ semantics ของ enum/สถานะ/การคำนวณเดิมที่มีผู้ใช้จริง (expenses); ทุก migration เป็นการเพิ่มคอลัมน์/ตาราง/ค่า enum เท่านั้น
4. **เอกสาร ISSUED ห้ามลบ/แก้ทับ** — ใช้ VOID (true reversal มีแล้ว: `prisma-accounting.repository.ts:875`) หรือใบลดหนี้/เพิ่มหนี้
5. **หมวดที่มีรายการแล้วห้ามลบจริง** — ใช้ ARCHIVED ตาม pattern `ExpenseCategory` (ไม่มี DELETE route; enum `ACTIVE/ARCHIVED` — `schema.prisma:2040-2043`)
6. AI Gateway อ่านผ่าน permission-checked tools เท่านั้น (pattern เดิม `accounting.get_summary` — `erp-business-tools.use-case.ts:49-104`)

## 3. ของที่มีอยู่จริง (current truth)

### 3.1 Engine เอกสารขาย + รับชำระ — มีครบและลึกกว่าที่แผนเดิมบันทึก

| ส่วน | หลักฐาน |
|---|---|
| `AccountingDocument` / `AccountingDocumentLine` / `AccountingCounterparty` / `AccountingPayment` / `AccountingPaymentAllocation` | `apps/api/prisma/schema.prisma:1742,1829,1710,1886,1930` |
| ชนิดเอกสาร 7 ชนิด: `QUOTATION, INVOICE, BILLING_NOTE, RECEIPT, TAX_INVOICE, CREDIT_NOTE, DEBIT_NOTE` | `schema.prisma:1628-1636` |
| สถานะเอกสาร: `DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, ISSUED, VOIDED, CREDITED, DEBITED, CLOSED` + state machine | `schema.prisma:1638-1648`; `accounting-status.logic.ts:137-146` |
| สถานะการเงินของเอกสาร: `UNPAID, PARTIALLY_PAID, PAID, OVERDUE, VOIDED` | `schema.prisma:1650-1656` |
| VAT ต่อเอกสาร: `NO_VAT, VAT_INCLUDED, VAT_EXCLUDED, EXEMPT, NEEDS_REVIEW` + `vatRate/whtRate` ต่อบรรทัด | `schema.prisma:1666-1672,1841,1843` |
| ใบกำกับภาษี FULL/ABBREVIATED ผูกกับเอกสารต้นทาง + tax snapshot ต่อบรรทัดตอน issue | `schema.prisma:1699-1702,1789-1790`; `document.use-case.ts:378-412` |
| รับชำระ: ช่องทาง `CASH, BANK_TRANSFER, CARD, CHEQUE, OTHER`, WHT, allocation, เศษเกินเป็น unapplied credit, void แบบ true reversal | `schema.prisma:1685-1691`; `prisma-accounting.repository.ts:707-771,745-749,875` |
| เลขเอกสารรายเดือน (QT-/INV-/TAX-… reserve→commit/cancel) | `document-sequence.logic.ts:13-20`; `document.use-case.ts:347-423` |
| ใบลดหนี้/เพิ่มหนี้: ต้องอ้างใบกำกับภาษีที่ issue แล้ว + เพดานลดหนี้สะสม | `accounting-status.logic.ts:103-109,208-232` |
| แปลงเอกสาร: เฉพาะ `QUOTATION → INVOICE/BILLING_NOTE` | `document.use-case.ts:663-665` |
| หน้าเว็บ hub มีจริง (สร้าง/issue/approve/void/convert/tax invoice/รับชำระ) แต่**ซ่อนจาก nav** (สถานะ `planned`, ถูกถอดใน P4.6) — เข้าได้ทาง URL `/companies/{id}/sales-documents` | `AccountingPages.tsx:260-398,603,717-807`; `WorkspaceLayout.tsx:32-50`; `web-core-workspace.constants.ts:207-219` |
| Permission ครบทุกชนิดเอกสาร+payment (`accounting.quotation.*`, `accounting.invoice.*`, `accounting.receipt.*`, `accounting.payment.*` ฯลฯ) | `apps/api/src/modules/auth/permission-registry.ts:102-152` |
| Entitlement `sales_documents` (sellable, **ไม่อยู่ใน default**) + launch gate `sales_documents/DEFAULT` seeded `OPEN/RESOLVED` | `packages/contracts/src/feature-entitlements.ts:62-69`; `feature-registry.ts:27-40`; `launch-matrix.catalog.ts:64-72` |
| Runoff matrix: 31 แถว / BLOCKED 4 (approve/issue/reject endpoints + outbox producer) — **Owner decision 2026-08-04: matrix ไม่ gate การ disable แล้ว เป็น survey record** | `docs/specs/feature-entitlement-runoff-matrix.md:11,645-679`; `runoff-matrix.catalog.ts:80` |
| รายงานที่มี: AR aging + sales summary (reports module), `accounting.get_summary` / `accounting.get_receivable_summary` (AI tools) | `report-source-adapters.ts:354,454`; `erp-business-tools.use-case.ts:49`; `erp-core-detail-tools.use-case.ts:115-152` |

### 3.2 Engine รายจ่าย — พร้อมใช้ (มีลูกค้าจริง)

| ส่วน | หลักฐาน |
|---|---|
| `ExpenseRecord` สถานะ `DRAFT→EXTRACTING→NEEDS_REVIEW→READY_FOR_CONFIRMATION→CONFIRMED→VOIDED` (+`REJECTED`) | `schema.prisma:2159,1953-1961`; `expense-status.logic.ts:68-80` |
| กรอกเองไม่ต้องมีรูปได้ (3 หลักฐาน: upload เป็น optional, ปุ่ม submit ไม่เช็ครูป, server ไม่บังคับ attachment) + `missingReceiptReason` → ใบรับรองแทนใบเสร็จ | `ExpensesPages.tsx:2265,2398`; `expense-draft.use-case.ts:70-101`; `schema.prisma:2203` |
| หมวดต่อบรรทัด (`ExpenseLine.expenseCategoryId`) + หมวดระดับหัว | `schema.prisma:2330,2200` |
| การจ่าย: `ExpensePayment` + ช่องทาง `CASH/BANK_TRANSFER/CARD/CHEQUE/OTHER` + สถานะจ่าย + settle ครึ่งสตางค์ (`SETTLE_EPSILON`) | `schema.prisma:2286,2025-2031`; `expense-totals.logic.ts:30,131` |
| VAT ตามเอกสาร vs ที่ระบบคำนวณ แยกเก็บ + reconciliation + override ที่ audit (งาน VAT-MIX-01 ปิดแล้ว 2026-08-26) | `packages/contracts/src/expenses.ts:249-302`; `expense-vat-reconciliation.logic.ts` |
| หมวดรายจ่าย: `ExpenseCategory` (companyId null = ค่าเริ่มต้นระบบ อ่านอย่างเดียว), `ACTIVE/ARCHIVED`, `sortOrder`, จัดการผ่าน `expense.category.manage` + หน้า `expenses/categories` | `schema.prisma:2124-2156`; `expense.controller.ts:515-547`; `ExpensesWorkspacePanels.tsx:88` |
| ค่าเริ่มต้น 12 หมวดต่อบริษัท (`TH_SME_EXPENSE_CATEGORIES_V1` ตัดตาม tax behaviour) | `expense-category-bootstrap.service.ts:48` เรียกจาก onboarding `create-company-onboarding.use-case.ts:280` |
| Export กลาง: CSV hardening + XLSX writer ไม่มี dependency + ตัวอย่างจริง (accountant package คืน `indexCsv` + `indexXlsxBase64`) | `apps/api/src/common/export/csv.logic.ts`, `xlsx.logic.ts`; `expense-evidence.use-case.ts:94,251-252` |
| สรุป/tools: `expense.get_daily_closing`, `expense.list_recent`, `expense.get_breakdown` (group ตามหมวด+สาขา), dataset `expense.summary` | `erp-expense-daily-closing.use-case.ts:139`; `erp-tools.use-case.ts:225`; `erp-business-tools.use-case.ts:320`; `report-catalog.ts:208` |

### 3.3 สิ่งที่ **ไม่มี** (ยืนยันแล้วว่า NOT FOUND)

1. **หมวดรายรับ**: ไม่มี model/enum/seed/contract/permission/report ใด ๆ ฝั่ง income — สิ่งเดียวที่มีคือ `AccountingDocumentLine.revenueCategory` เป็น **free-text 80 ตัวอักษร ไม่มี FK, ไม่มี UI ให้กรอก, ไม่มีรายงานที่อ่านมัน** (`schema.prisma:1848`; consumer เดียวคือ ledger `journal.use-case.ts:143`) — (`WhtIncomeCategory` ที่ชื่อคล้ายเป็นเรื่อง ภ.ง.ด. คนละโดเมน `schema.prisma:3632`)
2. **เอกสาร "ใบกำกับภาษี/ใบเสร็จ (ขายสด)" แบบใบเดียวจบ**: enum ไม่มี `TAX_INVOICE_RECEIPT`; ขายสดวันนี้ต้องกดหลายขั้น (สร้าง→issue→รับชำระ→สร้างใบเสร็จ/ใบกำกับแยก)
3. **หน้าสรุปรวมรายรับ–รายจ่าย**: ไม่มี dataset/หน้า/tool ที่รวมสองฝั่ง
4. **เลขที่ใบรับชำระ**: sequence key `accounting.payment` (PAY-) นิยามไว้แล้วแต่ `createPayment` ไม่เคยตั้ง `paymentNumber` (`document-sequence.logic.ts:17` vs `prisma-accounting.repository.ts:713-732`)
5. **หน้ารับชำระแยก/รับเงินไม่ผูกเอกสาร**: บันทึกรับชำระได้จาก panel รายละเอียดเอกสารเท่านั้น (`AccountingPages.tsx:603`)
6. **Chart library ใน web**: ไม่มี — กราฟทุกที่เป็น CSS bar ทำมือ (`apps/web/package.json:12-20`; ตัวอย่าง `ReportsWorkspacePage.tsx:438`)

### 3.4 จุดเสี่ยงการเงินที่ต้องปิดก่อนเปิดผู้ใช้จริง

| ID | ปัญหา | หลักฐาน | ผล |
|---|---|---|---|
| LED-FIN-01 | `accounting-totals.logic.ts` คำนวณเงินด้วย **JS float** (`round2(taxable * vatRate / 100)`) ต่างจากฝั่ง expenses ที่ใช้ `decimal.js` — เป็น residual ที่บันทึกไว้ตอนปิด FIN-01 ("โมดูลบัญชี — ยังไม่เปิดลูกค้า") ตอนนี้กำลังจะเปิด | `accounting-totals.logic.ts:35-46,63-89` vs `expense-totals.logic.ts:2,16-19` | ยอด VAT/รวมเพี้ยนสตางค์ในบางค่า → STOP-SHIP ของ spec นี้ |
| LED-FIN-02 | `grandTotalAmount` ฝั่งขายไม่หัก WHT (WHT ไปหักตอนรับชำระ) — ถูกต้องตามหลักการ แต่หน้าสรุปต้องนิยามให้ชัดว่าตัวเลขไหนรวม/หักอะไร | `accounting-totals.logic.ts:108`; allocation `whtAmount` `schema.prisma:1930-1949` | นิยามใน §7 |
| LED-FIN-03 | หมวดรายจ่าย default ซ้อน 2 ชุด: 12 ต่อบริษัท (bootstrap) + 11 global dev-seed ชื่อคล้ายกัน และ picker คืน union → บน env ที่ seed ผู้ใช้เห็น ~23 หมวดปนกัน; `@@unique([companyId,name])` ไม่กันแถว global (NULL distinct — มี comment บันทึกใน repo แล้ว) | `expense-category-bootstrap.service.ts:48` vs `prisma/seed.ts:3131,3146-3149`; `prisma-expense.repository.ts:2230-2233` | ผู้ใช้สับสน/AI แนะนำหมวดซ้ำ → ต้องจัดระเบียบ |
| LED-FIN-04 | ขอบเขตช่วงเวลา 2 convention: `civilDayRangeToUtc` คืน exclusive `lt` แต่ `getPeriodBoundaries` (dashboard) คืน inclusive end (−1 ms) — เคยมีบั๊กจริง ("filter หนึ่งวันได้ 0 จาก 13") | `packages/contracts/src/civil-date.ts:113-128`; `notification.logic.ts:189-193` | หน้าสรุปต้องประกาศ convention เดียว (ใช้ exclusive `lt` + ระบุคอลัมน์ instant vs civil ตาม pattern `erp-expense-daily-closing.use-case.ts:66-72`) |

## 4. ขอบเขต MVP

### F-LED-1 บันทึกรายรับ (ห่อ engine เดิม)

หน้า "บันทึกรายรับ" ใหม่ (mobile-first 390px) เริ่มด้วยคำถามเดียว ตาม journey แผนหลัก §13.10:

```text
กด "บันทึกรายรับ"
  → เลือก "รับเงินแล้ว" หรือ "ออกบิลไว้ก่อน"
```

**โหมด "รับเงินแล้ว" (ขายสด)** — use-case ใหม่ `RecordSimpleIncomeUseCase` ทำงานใน **transaction เดียว + idempotencyKey** (pattern `pg_advisory_xact_lock` + dedup ตาม `prisma-expense.repository.ts:1294-1297`) โดยเรียกของเดิมทั้งหมด:

1. สร้าง `INVOICE` จากฟอร์ม → issue ทันที (ได้เลขเอกสาร + posting source ตามเดิม)
2. บันทึก `AccountingPayment` direction `RECEIVED` เต็มยอด allocate เข้าเอกสาร → เอกสารเป็น `PAID`
3. ออก `RECEIPT` อ้างเอกสารต้นทางให้อัตโนมัติ (หลักฐานรับเงินตามตารางเอกสารของ Owner); บริษัท VAT ที่ต้องใบกำกับภาษี ใช้ปุ่ม "ออกใบกำกับภาษี" เดิมจากเอกสารได้ (`AccountingPages.tsx:730-776`)
4. ล้มเหลวขั้นไหน → rollback ทั้งก้อน + คืน error ภาษาคน; retry ด้วย key เดิม → ได้ผลเดิม ไม่สร้างซ้ำ

**ห้ามทำ shortcut ที่ข้าม engine**: ไม่เขียนตาราง income ใหม่, ไม่ mark PAID โดยไม่มี `AccountingPayment`

**โหมด "ออกบิลไว้ก่อน"** — สร้าง `INVOICE` หรือ `BILLING_NOTE` draft → issue → ไปโผล่ "รอรับเงิน" ในสมุด; การรับชำระภายหลังใช้ฟอร์มรับชำระเดิม (`AccountingPages.tsx:777-807`) ที่ยกมาไว้ในหน้ารายการ "รอรับเงิน" ของสมุด

**ช่องกรอก (ภาษาธุรกิจ → engine mapping):**

| ช่องที่ผู้ใช้เห็น | เก็บที่ | หมายเหตุ |
|---|---|---|
| วันที่รับเงิน / วันที่เอกสาร | `AccountingPayment.paidAt` / `AccountingDocument.documentDate` | ขายสด: ค่าเดียวกัน default วันนี้ |
| รายละเอียด (ต่อรายการ) | `AccountingDocumentLine.description` | เพิ่มได้หลายบรรทัด (ฟอร์ม hub เดิมรับบรรทัดเดียว — ฟอร์มใหม่ต้องรองรับหลายบรรทัด) |
| จำนวนเงิน | `quantity × unitPrice` | โหมดง่าย: qty=1 กรอกยอดเดียว |
| หมวดรายรับ | `AccountingDocumentLine.revenueCategoryId` (ใหม่, §F-LED-2) + snapshot ชื่อลง `revenueCategory` เดิม | เลือกหมวดเดียวทั้งเอกสาร = apply ทุกบรรทัด; แก้รายบรรทัดได้ในโหมดขั้นสูง |
| ลูกค้า (ไม่บังคับ) | `counterpartyId` | ไม่เลือก → ใช้ counterparty "ลูกค้าเงินสด" ของบริษัท (สร้างอัตโนมัติครั้งแรก, ยืนยันพฤติกรรม required/nullable ใน Phase 0) |
| ช่องทางรับเงิน: เงินสด/โอน/บัตร/อื่น ๆ | `AccountingPaymentMethod` = `CASH/BANK_TRANSFER/CARD/OTHER` (`CHEQUE` มีในโหมดขั้นสูง) | enum เดิมครบแล้ว |
| VAT: ไม่มี / รวมแล้ว / ยังไม่แน่ใจ | `vatMode` = `NO_VAT/VAT_INCLUDED/NEEDS_REVIEW` (`VAT_EXCLUDED/EXEMPT` ในโหมดขั้นสูง) | enum เดิมครบแล้ว; `NEEDS_REVIEW` issue ไม่ได้จนเลือกจริง — ตรงกฎ "ยังไม่แน่ใจ = ร่างได้ ยืนยันไม่ได้" แบบเดียวกับ VAT-MIX ฝั่งรายจ่าย |
| หมายเหตุ + ไฟล์แนบ | `notes` + `AttachmentLink` (polymorphic `schema.prisma:1042`) | purpose namespace ฝั่ง accounting doc ต้องยืนยันใน Phase 0 |
| สถานะ: ร่าง / ยืนยันแล้ว / ยกเลิก | `DRAFT` / `ISSUED` / `VOIDED` | label ไทยคงที่ทั้งระบบ |

### F-LED-2 หมวดหมู่ 2 ชุด

**หมวดรายรับ (ใหม่ทั้งก้อน)** — model `RevenueCategory` กระจกจาก `ExpenseCategory` (`schema.prisma:2124-2156`) ต่างตรงนี้:

- **company-scoped เท่านั้น ไม่มีแถว global (companyId NOT NULL)** — ตัดปัญหา NULL-distinct + union ซ้ำซ้อนที่เจอจริงฝั่ง expenses (LED-FIN-03) ตั้งแต่วันแรก
- ค่าเริ่มต้น 6 หมวดต่อบริษัท (bootstrap service + เติมย้อนหลังให้บริษัทเดิมแบบ idempotent): **ขายสินค้า, ค่าบริการ, ค่าสมาชิก/คอร์ส, ค่าคอมมิชชั่น, ค่าเช่า, รายได้อื่น** (รายการตาม Owner 2026-08-26)
- ฟิลด์: `name`, `accountHintKey`, `ledgerAccountCode?` (+ reviewed-by attestation ตาม pattern เดิม), `defaultOutputTaxCode?` (`O7/OX/O0` — enum เดิม `schema.prisma:1674-1678`), `status ACTIVE/ARCHIVED`, `sortOrder`, `@@unique([companyId, name])`
- สิทธิ์: key ใหม่ `accounting.revenue_category.manage` (MEDIUM) ลง `permission-registry.ts` + grant role เดียวกับ `expense.category.manage` (`:171,574,777`); อ่านผูกกับ permission อ่านเอกสารขายเดิม
- API + หน้า UI จัดการ: เพิ่ม/แก้ชื่อ/เรียง (`sortOrder` ผ่าน PATCH)/ปิดใช้ — โครงเดียวกับ `expense.controller.ts:515-547` + `CategoryManagePanel`; **ไม่มี DELETE**
- `AccountingDocumentLine` เพิ่ม `revenueCategoryId String?` (FK, additive) — คอลัมน์ `revenueCategory` เดิมกลายเป็น **snapshot ชื่อหมวด ณ วัน issue** (immutable evidence; ledger consumer เดิม `journal.use-case.ts:143` ทำงานต่อได้โดยไม่แก้)

**หมวดรายจ่าย (มีแล้ว — จัดระเบียบ)**: ใช้ 12 หมวด `TH_SME_EXPENSE_CATEGORIES_V1` เป็นชุดจริงต่อไป; งานรอบนี้คือแก้ LED-FIN-03 — ปรับ global dev-seed (11 แถว) ให้เลิกซ้ำกับ template ต่อบริษัท (archive แถว global บน env ที่ bootstrap แล้ว หรือทำ seed ให้ตรงชุดเดียวกัน — ตัดสินใน plan Phase 5 พร้อมหลักฐานผลต่อ AI category suggestion ที่อ่าน `activeCategories`)

### F-LED-3 บันทึกรายจ่าย (มีแล้ว — ไม่แตะ engine)

Flow ถ่าย/อัปโหลด → AI อ่าน → ตรวจ → ยืนยัน และกรอกเอง มีครบ (§3.2) งานรอบนี้มีเพียง:

- เพิ่มทางเข้า "บันทึกรายจ่าย" จากหน้าสมุด → พาไป `expenses/upload` และ `expenses/manual` เดิม
- แสดงยอดฝั่งจ่ายในสมุด (§F-LED-4) จาก query ชุดเดียวกับ `expense.get_breakdown`/`expense.summary` เดิม

### F-LED-4 หน้า "สมุดรายรับ–รายจ่าย" (ใหม่)

หน้าเดียว 3 ส่วน: **แถบตัวเลข 6 ก้อน → กราฟตามหมวด → รายการ** (แท็บ รายรับ/รายจ่าย)

นิยามตัวเลข (ผูก period ที่เลือก, timezone Asia/Bangkok, ขอบเขตแบบ exclusive `lt` ตาม `civilDayRangeToUtc`):

| ตัวเลข | นิยาม (deterministic) | คอลัมน์เวลา |
|---|---|---|
| ยอดขายจากเอกสาร | Σ `grandTotalAmount` ของ `INVOICE/BILLING_NOTE/DEBIT_NOTE` สถานะ issued ขึ้นไปที่ไม่ `VOIDED` − Σ `CREDIT_NOTE` | `documentDate` (civil) |
| รับเงินแล้ว | Σ `AccountingPayment` `direction=RECEIVED, status=RECORDED` (รวม WHT ที่ถูกหักเป็นส่วนหนึ่งของยอดชำระ — แสดงแยกบรรทัด "ถูกหัก ณ ที่จ่าย" เมื่อ > 0) | `paidAt` (instant → shift ตาม pattern `erp-expense-daily-closing.use-case.ts:66-72`) |
| รอรับเงิน | Σ `outstandingAmount` ของเอกสาร issued ไม่ void ที่ค้าง > 0 (basis เดียวกับ `accounting.get_receivable_summary` — `erp-core-detail-tools.use-case.ts:147`) | as-of ตอนเปิดหน้า (ไม่ผูก period — ระบุบนป้าย) |
| รายจ่ายที่บันทึก | Σ `grandTotalAmount` ของ `ExpenseRecord` สถานะ `CONFIRMED` (นิยามเดียวกับ dashboard `expense_total_in_period` — `expense-summary.provider.ts:61-92`) | `expenseDate` (civil) |
| จ่ายแล้ว | Σ `ExpensePayment` `status=RECORDED` | `paidAt` (instant) |
| ส่วนต่างเงินรับ–เงินจ่าย | รับเงินแล้ว − จ่ายแล้ว | — |

ใต้แถบตัวเลข แสดงบรรทัดสรุปคำ: "ส่วนต่างรายรับ–รายจ่ายที่บันทึก (ตามเอกสาร): ยอดขายจากเอกสาร − รายจ่ายที่บันทึก" — สองมุม (เงินสด vs ตามเอกสาร) ติดป้ายชัดว่าต่างกันอย่างไร ห้ามใช้คำ "กำไร"

- กราฟตามหมวด: CSS bar ตาม pattern `ReportsWorkspacePage.tsx:438` (ห้ามเพิ่ม chart dependency) — รายรับ group ตาม `revenueCategoryId`, รายจ่าย group ตาม `ExpenseLine.expenseCategoryId` (query ระดับบรรทัดเพราะเอกสารเดียวมีหลายหมวดได้)
- Filter: เดือน (default เดือนนี้ตาม `resolvePeriodInput` — `erp-tools.use-case.ts:199-214`), ประเภท (รายรับ/รายจ่าย), หมวด, สถานะ
- ทุกแถวกดเปิดหลักฐานต้นทาง (เอกสารขาย / expense record + ไฟล์แนบ)
- ดาวน์โหลด: ปุ่มเดียวได้ CSV + XLSX (reuse `xlsx.logic.ts` + `safeCsvCell` + pattern base64-in-JSON ของ accountant package `expenses.ts:1180-1195`) — คอลัมน์หัวไทย, มีคอลัมน์หมวด, เลขเอกสาร, สถานะ
- การป้องกันชุดข้อมูลใหญ่: bounded walk + self-check ตาม guardrails ของ `accounting.get_summary` (`SUMMARY_PAGE_SIZE/SUMMARY_MAX_PAGES/SUMMARY_COUNT_MISMATCH` — `erp-business-tools.use-case.ts:46-89`) — ตัวเลขผิดห้ามแสดง ให้แสดง unavailable พร้อมทางไปต่อ

### F-LED-5 การมองเห็นและการเปิด (entitlement/nav/gate)

- เมนูใหม่ "สมุดรายรับ–รายจ่าย" ใน nav (`DESIGN_HANDOFF_NAV_ORDER` — `WorkspaceLayout.tsx:36-49`) + ปลด `salesdoc` จาก `planned` เป็นเมนูจริงชื่อ "ขายและรับเงิน" **เฉพาะบริษัทที่ entitlement `sales_documents` เปิด**
- เปิด `sales_documents` แบบ **per-company allowlist** ก่อน (ไม่เพิ่มเข้า `DEFAULT_ENABLED_FEATURE_KEYS` จนผ่าน Gate §8) — กลไก entitlement ต่อบริษัทมีแล้ว (`entitlement.helper.ts:42-44`)
- Kill switch: gate `sales_documents/DEFAULT` (seeded OPEN — `launch-matrix.catalog.ts:64-72`) บังคับใช้จริงที่ root สร้างเอกสาร/รับชำระ ตาม pattern `assertExpenseRootOpen` (`expense-launch-gate.ts:36-56`): CLOSE แล้ว **BLOCK_NEW_ROOT** — สร้างเอกสารใหม่ไม่ได้ แต่ดูรายการเดิม + รับชำระเอกสารค้างยังทำได้ (ตรง close behaviour ที่ประกาศใน `feature-entitlement-launch-matrix.md:74`)
- หน้าสมุด (read-only) ผูกกับ permission อ่าน (`accounting.document.read` / `expense.read`) — บริษัทที่ยังไม่เปิดฝั่งขายเห็นสมุดฝั่งรายจ่าย + ป้าย "เปิดฝั่งรายรับเร็ว ๆ นี้" ไม่พาไป 403

## 5. สิ่งที่ไม่ทำในรอบนี้ (ตาม Owner 2026-08-26)

- เชื่อมธนาคาร / นำเข้า statement / จับคู่เงินเข้า–ออก / กระทบยอด (ไป P15–P22 ตามแผนหลัก)
- Auto Revenue ทุกรูปแบบ
- ลูกหนี้/เจ้าหนี้เต็มระบบ + รับจ่ายบางส่วนแบบเต็มระบบ (engine partial/unapplied credit มีอยู่และใช้ได้ แต่ไม่ทำ UI ทวงหนี้/aging/บริหารเครดิตรอบนี้)
- ภ.พ.30, ภ.ง.ด., e-Tax (ห้ามโฆษณาว่ารองรับ — capability state ตาม OS spec §12.7)
- งบกำไรขาดทุน/บัญชีแยกประเภทสำหรับอ้างอิงทางการ (ที่มีอยู่ที่ `/journal` คงเดิม ไม่โปรโมท)
- สต็อก ต้นทุน สินทรัพย์
- ใบเสนอราคา workflow อนุมัติ (มีอยู่แล้วใน hub — ไม่แตะ ไม่โปรโมทในสมุด)
- ชนิดเอกสารใหม่ `TAX_INVOICE_RECEIPT` — MVP ใช้ INVOICE+RECEIPT+TAX_INVOICE(ABBREVIATED) ที่มี; ถ้าเทสผู้ใช้จริงพบว่าจำเป็นค่อยเป็นงานถัดไป

## 6. Data model changes (additive ทั้งหมด)

| # | การเปลี่ยน | ชนิด |
|---|---|---|
| M1 | ตารางใหม่ `RevenueCategory` (โครงตาม §F-LED-2) | CREATE TABLE |
| M2 | `AccountingDocumentLine.revenueCategoryId String?` + FK + `@@index([companyId, revenueCategoryId])` | ADD COLUMN |
| M3 | ตั้ง `paymentNumber` ตอน `createPayment` ด้วย sequence `accounting.payment` ที่นิยามอยู่แล้ว (`document-sequence.logic.ts:17`) | โค้ด ไม่แก้ schema |
| M4 | (ไม่มีการแก้ตาราง expenses ใด ๆ) | — |

ห้าม: แก้ enum เดิม, แก้คอลัมน์เดิม, migration ที่เขียนข้อมูลย้อนหลังนอกเหนือ bootstrap หมวดรายรับแบบ idempotent

## 7. ความถูกต้องการเงิน (STOP-SHIP ของ spec นี้)

1. **LED-FIN-01 ต้องปิดก่อนเปิดผู้ใช้จริง**: แปลง `accounting-totals.logic.ts` จาก float → `decimal.js` + `ROUND_HALF_UP` 2dp ตาม policy เดียวกับ `expense-totals.logic.ts:16-19` โดยพิสูจน์ด้วย golden set (รวมเคสที่ float เพี้ยน เช่น ค่าที่คูณ 7% แล้วตกขอบ .005) และ regression ว่าเอกสารเดิมใน DB ไม่เปลี่ยนยอด (คำนวณใหม่เฉพาะตอนสร้าง/แก้ draft)
2. Invariants ที่ต้องมี test ยืนยันเสมอ:
   - `paidAmount + outstandingAmount = grandTotalAmount` (ภายใน `SETTLE_EPSILON`)
   - issue → pay → receipt → void ทุกเส้นทาง: รายได้/Output VAT เกิด **ครั้งเดียว** ที่ posting source ของเอกสารขาย ไม่เกิดที่ payment/receipt (`posting-engine.logic.ts:136-168` + `journal.use-case.ts:109-119` ที่ map `RECEIPT → accounting.payment.received`)
   - retry `RecordSimpleIncomeUseCase` ด้วย idempotencyKey เดิม → เอกสาร+payment+ใบเสร็จชุดเดียว
   - ยอดในสมุด = ผลรวมจากรายการที่ drill ได้ 100% (self-check แบบ `SUMMARY_COUNT_MISMATCH`)
3. ตัวเลขทุกก้อนในสมุดต้องมี "นิยามพิมพ์ได้" (ตาราง §F-LED-4) และ export ใช้นิยามเดียวกับหน้าจอ

## 8. Quality gates ก่อนเปิดวงจริง

ยึดแถว "รายรับจากเอกสารขาย" ใน [แผนหลัก §15](../plans/mangmee-brain-2-5-day-priority-plan-th.md):

- launch blockers = 0 + entitlement off/on/off ไม่ทำข้อมูลเสีย
- create→issue→receive→void/reverse E2E ผ่าน (รวม @smoke ใหม่)
- VAT/WHT/AR reconcile บน golden dataset; payment idempotent
- LED-FIN-01 ปิดพร้อม golden proof
- Mobile usability ผู้ใช้ 40+ จริง ≥3 คน: บันทึกขายสด, ออกบิล+รับชำระ, เปิดสมุด+อ่านตัวเลขได้ถูก (บอกได้ว่า "ส่วนต่าง" ไม่ใช่ "กำไร")
- คำโฆษณา: ใช้ได้แค่ "บันทึกรายรับ–รายจ่ายพร้อมเอกสารและหลักฐาน" — ห้าม "ระบบบัญชีครบ/ยื่นภาษีได้/กระทบยอดได้"

## 9. คำถามที่ Owner ต้องตอบก่อนเริ่ม coding

1. **ลำดับคิวกับ P26 (billing/subscription)**: สมุดรายรับ–รายจ่าย (P27) มาก่อน P14→P26 หรือหลัง? (dev คนเดียว ทำคู่ขนานไม่ได้จริง)
2. **ใบเสร็จอัตโนมัติในโหมดขายสด**: ออก `RECEIPT` ให้ทุกครั้ง หรือให้เลือก "ออกใบเสร็จ" เป็นปุ่มแยก? (ค่าแนะนำ: ออกอัตโนมัติ — ผู้ใช้ 40+ ไม่ควรต้องรู้ว่าใบเสร็จคือเอกสารแยก)
3. **บริษัทที่ยังไม่จด VAT**: ซ่อนตัวเลือก VAT ทั้งหมด (default `NO_VAT`) ใช่หรือไม่? (ต้องรู้แหล่ง truth ของสถานะ VAT บริษัท — ตรวจใน Phase 0)
4. **ใบลดหนี้ของเอกสารที่ไม่มีใบกำกับภาษี**: engine วันนี้บังคับ CN/DN อ้าง `TAX_INVOICE` ที่ issue แล้วเท่านั้น (`accounting-status.logic.ts:103-109`) — บริษัทไม่จด VAT จะแก้เอกสารผิดด้วย VOID+ออกใหม่ พอไหม หรือต้องขยาย CN/DN ให้อ้าง INVOICE ได้ (งาน engine เพิ่ม)?
5. **ใครคือนักบัญชีที่ยืนยัน mapping หมวดรายรับ → account/tax code 6 หมวดตั้งต้น** (ช่อง `accountHintKey`/`defaultOutputTaxCode`)?
6. ยืนยันชุดคำหน้าจอ: "ยอดขายจากเอกสาร / รับเงินแล้ว / รอรับเงิน / รายจ่ายที่บันทึก / จ่ายแล้ว / ส่วนต่างเงินรับ–เงินจ่าย"
