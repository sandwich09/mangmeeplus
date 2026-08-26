# สมุดรายรับ–รายจ่าย (Income–Expense Ledger MVP) — Spec

สถานะ: **v1.3 — Owner ตอบ §9 ครบ; Phase 1–2 ส่งมอบแล้ว; Phase 3A backend ส่งมอบ 2026-08-26 (atomic simple-income + correction reasons/source + attachment gate), เหลือ Phase 3B UI**

ที่มา: การตัดสินใจ Owner 2026-08-26 — ทำฟีเจอร์ "สมุดรายรับ–รายจ่าย" ก่อน โดยยังไม่ทำระบบบัญชีเต็มและไม่ทำกระทบยอดธนาคาร; เอกสารขายต้องเป็นแกนของรายรับ ไม่ใช่ช่องกรอกยอดลอย ๆ

ทิศทางรวม (Owner ยืนยัน 2026-08-26 รอบสาม): เป้าหมายคือ **FlowAccount parity ทั้งสองฝั่ง** — spec นี้คือ slice ฝั่งขาย-รับเงิน + สมุดรวม; ฝั่งซื้อ-จ่ายเงินครบสาย (PO→รับของ→บิลผู้ขาย→จ่าย + ใบลดหนี้ฝั่งซื้อ) = **P28 ในแผนหลัก** ซึ่ง engine มีอยู่แล้วเกือบครบใน `apps/api/src/modules/procurement/` รอ UX + เปิด แบบเดียวกับฝั่งขาย

หลักฐานโค้ดทั้งหมดอ้างอิง branch `develop` @ `beb0c5f6` (สำรวจ 2026-08-26); หลักฐาน FlowAccount จากบัญชีทดสอบของ Owner (ดูแบบ read-only 2026-08-26; tenant identifier ไม่บันทึกใน repo — ดู §F-LED-6)

เอกสารแม่:

- [Mangmee Accounting Operating System Spec](mangmee-accounting-operating-system-spec-th.md) — ภาพเต็มระยะยาว; spec นี้คือ vertical slice แรกฝั่งขาย+สรุป
- [Mangmee Accounting OS Implementation Plan](../plans/mangmee-accounting-os-implementation-plan-th.md) — สมุดฯ = ส่วนตัดของ P7 (Sell-to-Cash) + P8 (Expense) โดยไม่รวม P9 (Bank/Reconciliation)
- [ผลสำรวจ FlowAccount 2026-08-26](../research/flowaccount-accounting-product-audit-2026-08-26-th.md) — §6.3 (หลักเอกสารขาย), §7.3 (pattern ค่าใช้จ่าย+OCR)
- [แผนหลัก 2.5 วัน](../plans/mangmee-brain-2-5-day-priority-plan-th.md) — §13.10 (ฟีเจอร์รายรับ), §13.2 แถว "รายรับจากเอกสารขาย", REVENUE-01..08, §15 แถว "รายรับจากเอกสารขาย"
- แผนส่งมอบของ spec นี้: [Income–Expense Ledger Implementation Plan](../plans/mangmee-income-expense-ledger-plan-th.md); คิวรวมสองฝั่ง: [สารบัญแผนรวมมั่งมีพลัส](../plans/mangmee-master-plan-index-th.md)

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
| LED-FIN-05 | AI tool `sales.get_sales_summary` นับเฉพาะ payment ที่ผูก counterparty type CUSTOMER/BOTH — ขายสดแบบไม่ระบุลูกค้า (null counterparty ตาม V1) จะไม่ถูกนับในคำตอบ AI ทั้งที่นับในสมุด | `erp-tools.use-case.ts:331-348` | ตัวเลขสมุด vs คำตอบ AI ไม่ตรงกัน → Phase 4 ต้องปรับ tool ให้นับ payment ไม่มีลูกค้าด้วย หรือติดป้ายนิยามต่างให้ชัด (เลือกตอน implement พร้อมหลักฐาน regression ของ family เดิม) |

## 4. ขอบเขต MVP

### F-LED-1 บันทึกรายรับ (ห่อ engine เดิม)

หน้า "บันทึกรายรับ" ใหม่ (mobile-first 390px) เริ่มด้วยคำถามเดียว ตาม journey แผนหลัก §13.10:

```text
กด "บันทึกรายรับ"
  → เลือก "รับเงินแล้ว" หรือ "ออกบิลไว้ก่อน"
```

**โหมด "รับเงินแล้ว" (ขายสด)** — use-case ใหม่ `RecordSimpleIncomeUseCase` + repository bundle method ใหม่ **หนึ่ง transaction เดียวจบ**

ผลตรวจ V6 (2026-08-26): **ห้ามประกอบด้วยการ chain use-case เดิม** — `IssueDocumentUseCase` reserve เลขนอก tx/commit หลัง tx และ `issueDocument` เปิด Serializable tx ของตัวเอง (`document.use-case.ts:347-423`, `prisma-accounting.repository.ts:566-567`) ส่วน `createPayment` เปิด tx แยกอีกใบ (`:712`) → ต้องใช้ pattern bundle ที่ repo ใช้อยู่แล้ว ตามแบบ `submitDraftAtomic` ของ reimbursements (`prisma-reimbursement.repository.ts:354-475`): repository method เดียว เปิด tx เดียว (Serializable + `pg_advisory_xact_lock`) ทำครบภายใน:

1. dedup ด้วย `idempotencyKey` + `payloadFingerprint` ใน `AccountingSimpleIncomeCommand` (M7) — row เกิดเมื่อครบทั้งก้อนเท่านั้น; retry payload เดิมคืน result IDs เดิม, key เดิมแต่ payload ต่าง = conflict; concurrent double-tap ที่ PostgreSQL ยกเลิกด้วย `P2034` retry transaction แบบ bounded แล้วอ่านผู้ชนะ
2. สร้าง `INVOICE`+lines → จองและ commit เลขเอกสาร **ใน tx** ด้วย `reserveNumberInTransaction`/`commitNumberInTransaction` ที่มีอยู่แล้ว (`prisma-document-sequence.repository.ts:82,225`) → issue; plain `INVOICE` เก็บยอด VAT ต่อบรรทัดแต่ **ไม่ใช่ transaction-tax document** ตาม engine ปัจจุบัน จึงไม่มี tax snapshot — บริษัท VAT ต้องออก `TAX_INVOICE` ผ่าน flow เดิมเพื่อ final tax snapshot (แก้ข้อความเดิมที่อ้าง db-param ผิดชนิดเอกสาร)
3. บันทึก `AccountingPayment` direction `RECEIVED` เต็มยอด + allocation → เอกสารเป็น `PAID`
4. ออก `RECEIPT` อ้างต้นทางอัตโนมัติ (Owner ข้อ 2 = อัตโนมัติทุกครั้ง) — source ต้องเป็น INVOICE ที่เพิ่ง issue ใน bundle เดียวกัน; **auto-RECEIPT เป็นหลักฐานเท่านั้น (`postingStatus=not_required`)** เพราะ `AccountingPayment` คือ settlement posting source ตัวจริง หากทั้งคู่ pending จะเดบิตเงินสด/เครดิตลูกหนี้ซ้ำ; บริษัท VAT ออกใบกำกับภาษีต่อด้วย flow เดิม
5. audit ผ่าน tx hook (`audit.log(entry, tx)` — `audit.service.ts:65`); ล้มเหลวขั้นไหน rollback ทั้งก้อน + error ภาษาคน

ผลพลอยได้: ปิดช่องโหว่ reserve-นอก-tx เดิม (crash ระหว่าง commit เลข → เลขค้าง RESERVED บนเอกสาร ISSUED) สำหรับเส้นทางนี้

**ห้ามทำ shortcut ที่ข้าม engine**: ไม่เขียนตาราง income ใหม่, ไม่ mark PAID โดยไม่มี `AccountingPayment`

**โหมด "ออกบิลไว้ก่อน"** — สร้าง `INVOICE` หรือ `BILLING_NOTE` draft → issue → ไปโผล่ "รอรับเงิน" ในสมุด; การรับชำระภายหลังใช้ฟอร์มรับชำระเดิม (`AccountingPages.tsx:777-807`) ที่ยกมาไว้ในหน้ารายการ "รอรับเงิน" ของสมุด

**ช่องกรอก (ภาษาธุรกิจ → engine mapping):**

| ช่องที่ผู้ใช้เห็น | เก็บที่ | หมายเหตุ |
|---|---|---|
| วันที่รับเงิน / วันที่เอกสาร | `AccountingPayment.paidAt` / `AccountingDocument.documentDate` | ขายสด: ค่าเดียวกัน default วันนี้ |
| รายละเอียด (ต่อรายการ) | `AccountingDocumentLine.description` | เพิ่มได้หลายบรรทัด (ฟอร์ม hub เดิมรับบรรทัดเดียว — ฟอร์มใหม่ต้องรองรับหลายบรรทัด) |
| จำนวนเงิน | `quantity × unitPrice` | โหมดง่าย: qty=1 กรอกยอดเดียว |
| หมวดรายรับ | `AccountingDocumentLine.revenueCategoryId` (ใหม่, §F-LED-2) + snapshot ชื่อลง `revenueCategory` เดิม | เลือกหมวดเดียวทั้งเอกสาร = apply ทุกบรรทัด; แก้รายบรรทัดได้ในโหมดขั้นสูง |
| ลูกค้า (ไม่บังคับ) | `counterpartyId` | **ยืนยันแล้ว (V1): nullable จริงทั้ง schema/DTO/use-case** (`schema.prisma:1751`, `accounting-money.dtos.ts:49`, create ไม่ validate — `document.use-case.ts:49-74`; issue ก็ best-effort — `:359-364`) → ไม่เลือก = เอกสารไม่มีลูกค้า และ**ไม่สร้าง row "ลูกค้าเงินสด" อัตโนมัติ** (ไม่มี unique fence บนชื่อ — `schema.prisma:1737-1739` — เสี่ยง row ซ้ำ); UI แสดง label "ลูกค้าทั่วไป (ขายเงินสด)" เฉย ๆ ตามแบบ FlowAccount ("Cash Sale / ขายเงินสด"); กติกา engine ที่ต้องเคารพ: payment ต้อง match counterparty ของเอกสาร (null↔null ผ่าน — `accounting-money-validation.logic.ts:95-96`) |
| ช่องทางรับเงิน: เงินสด/โอน/บัตร/อื่น ๆ | `AccountingPaymentMethod` = `CASH/BANK_TRANSFER/CARD/OTHER` (`CHEQUE` มีในโหมดขั้นสูง) | enum เดิมครบแล้ว |
| VAT | เอกสาร: `vatMode` (`NO_VAT/VAT_INCLUDED/VAT_EXCLUDED/EXEMPT/NEEDS_REVIEW`) + **ต่อบรรทัด**: `vatRate` โดย default มาจาก `defaultOutputTaxCode` ของหมวดรายรับของบรรทัดนั้น (กติกาเต็ม §7.9 — ห้ามระบบเดา) | enum เดิมครบแล้ว; บรรทัด "ยังไม่แน่ใจ" → ร่างได้ ยืนยันไม่ได้ พร้อมชี้บรรทัด (กฎเดียวกับ VAT-MIX ฝั่งรายจ่าย); **บริษัทไม่จด VAT ซ่อนบล็อก VAT ทั้งหมด default `NO_VAT` (Owner ข้อ 3) — ใช้ truth เดียวกับฝั่งรายจ่าย (V4): `VatRegistrationStatus` ผ่าน `vatRegistration.get(companyId, civilDate)` (`expense-draft.use-case.ts:701`) + กติกา `deriveExpenseCaptureMode` (`expense-capture-policy.logic.ts:28-32`)** |
| หมายเหตุ + ไฟล์แนบ | `notes` + `AttachmentLink` (polymorphic `schema.prisma:1042`) | **ยืนยันแล้ว (V2): ยังไม่มี purpose ฝั่ง accounting เลย** — gate กลางอนุญาตเฉพาะ `targetType='expense.record'` (`attachment.logic.ts:24-32` บังคับที่ endpoint link กลาง `link-attachment.use-case.ts:28-39`) → งาน Phase 3: ขยาย `isAllowedAttachmentTarget` แบบ additive เพิ่ม `accounting.document` + purposes `accounting.receipt.evidence`/`accounting.document.supporting` (unique เดิม `schema.prisma:1053` รองรับ; ไม่ใช้ทางลัด repo-write ตรงแบบ procurement/crm ที่ bypass gate) |
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
- ช่องทางเปิด entitlement ต่อบริษัท **ยืนยันแล้ว (V5)**: `PUT /v1/system/partners/:partnerCompanyId/features` permission `system.partner_feature.manage` (`partner.controller.ts:247-249`) — มี CAS `expectedSetVersion`, normalization gate, dependency cascade; **off/on/off พิสูจน์แล้วด้วย test ที่มีอยู่** (`set-partner-features.use-case.spec.ts:1322` — epoch bump ขา re-enable ทำ stale claim ใช้ไม่ได้, ค่า submenu คงอยู่ข้ามรอบ)

### F-LED-6 ใบลดหนี้/ใบเพิ่มหนี้ตามแบบ FlowAccount (Owner ข้อ 4 — ตัดสิน 2026-08-26)

หลักฐานจากบัญชีทดสอบ FlowAccount ของ Owner (read-only, tenant identifier redacted, 2026-08-26):

- เมนูเอกสารขาย FlowAccount = ใบเสนอราคา / ใบวางบิล / ใบแจ้งหนี้ / ใบเสร็จรับเงิน / **ขายเงินสด** / ใบลดหนี้ / ใบเพิ่มหนี้; ขายเงินสดสร้าง "ใบเสร็จรับเงิน (เงินสด)" ใบเดียวจบ เลขชุดแยก (CA-) ลูกค้า default "Cash Sale / ขายเงินสด"
- ปุ่มสร้างใบลดหนี้มี **2 ทาง**: "ใบลดหนี้แยก" (ไม่ผูกใบกำกับภาษี — อ้างอิงเป็นช่องพิมพ์ "เลขที่อ้างอิง") และ "ใบลดหนี้ที่อ้างอิงใบกำกับภาษี" (modal เลือกลูกค้า → เลือกเอกสารเดิมจากรายการ พร้อมยอด/สถานะ → prefill)
- ฟอร์มบังคับเลือก **สาเหตุ** จากรายการตามกฎหมาย 2 กลุ่ม: ซื้อ-ขายสินค้าและซื้อ-ขายบริการ โดยยึด[ประมวลรัษฎากร ม.82/9–82/10](https://www.rd.go.th/5206.html) และ[ประกาศอธิบดีกรมสรรพากร ภาษีมูลค่าเพิ่ม ฉบับที่ 82](https://www.rd.go.th/3380.html) ไม่คัดลอกถ้อยคำจาก FlowAccount; `OTHER_PRESCRIBED` ต้องระบุรายละเอียดและ UI ต้องไม่สื่อว่าเหตุอื่นใดก็ใช้ได้โดยอัตโนมัติ
- โมเดลยอดท้ายฟอร์ม: **มูลค่าตามเอกสารเดิม (กรอก/prefill) → มูลค่าที่ถูกต้อง (จากรายการ) → ผลต่าง** + WHT + แนบไฟล์

การนำมาใช้กับ engine เรา (สอดคล้อง OS spec §7.1 และ research §6.3):

1. **ขยายกฎ source ของ CN/DN**: อ้าง `TAX_INVOICE` ที่ issue แล้วได้ตามเดิม และอ้าง **`INVOICE` เฉพาะเมื่อ source+correction ไม่มี VAT** (ครอบบริษัทไม่จด VAT); invoice ที่มียอด VAT ต้องอ้าง TAX_INVOICE ที่มี immutable tax snapshot — ห้าม downgrade เป็น non-tax correction
2. **สาเหตุเป็นข้อมูลบังคับ**: `adjustmentReasonCode` + `adjustmentReasonText` บน `AccountingDocument` เฉพาะ CN/DN; code แยก allow-list CREDIT/DEBIT ตามแหล่งกรมสรรพากรข้างต้น, `OTHER_PRESCRIBED` บังคับข้อความ, เอกสารชนิดอื่นห้ามส่งสองฟิลด์นี้
3. **มูลค่าเดิม/ที่ถูกต้อง/ผลต่าง**: เราได้เปรียบเพราะ source อยู่ในระบบ — prefill จากเอกสารอ้างอิงเสมอ + `validateCumulativeCreditNote` เดิมกันลดเกินยอด (`accounting-status.logic.ts:208-232`)
4. **ใบลดหนี้แยกแบบไม่อ้างเอกสารเลย: ไม่ทำใน MVP** — journey MVP เอกสารเกิดในระบบทั้งหมด การบังคับอ้างอิงรักษาความถูกของ AR/VAT; เคสแก้เอกสารนอกระบบยกไปรอบถัดไป (บันทึกเป็นข้อจำกัดที่หน้า UI)

### F-LED-7 สเปกหน้าจอ (UI/UX) — Owner สั่งเพิ่ม 2026-08-26 รอบสอง

> "ทุกอย่างเป็นไปตามลำดับ ไม่เปิดก่อนให้กด แล้วเจอ error ตามหลัง"

#### 7.1 หลักการบังคับทุกหน้าจอ

1. **ใช้ theme/component เดิมเท่านั้น** — `MangmeePage/MangmeeCard/MangmeeBadge` + `mangmee-btn/mangmee-input/mangmee-table` (`apps/web/src/common/components/mangmee`), `Modal` กลาง (focus trap/Escape — pattern P5), `ThemedSelect/ThemedDate`, `ErrorBanner role=alert` (`ExpensesUi.tsx:103`), toast กลาง; ห้ามเพิ่ม dependency กราฟ/ฟอร์ม
2. **Mobile-first 390px** (ผู้ใช้หลักอยู่บนมือถือ): CTA หลัก ≥56px, ปุ่ม/สวิตช์ ≥44×44px, ตัวอักษรเนื้อหา ≥16px, ตารางกว้าง scroll ในกรอบตัวเอง ไม่ดันทั้งหน้า
3. **หนึ่งหน้าจอ = หนึ่ง action เด่น** — ปุ่ม primary เดียว action รองเป็น ghost/link; ช่องจำเป็นมาก่อน ช่องขั้นสูงยุบ ("ตัวเลือกเพิ่มเติม")
4. **ภาษาคนเท่านั้น** — label ตามชุดคำที่ Owner ยืนยัน (§F-LED-4), ไม่มี raw ID/enum/HTTP code โผล่; error ทุกข้อความบอก "เกิดอะไร + ทำอะไรต่อ"
5. **validation อยู่ข้างช่องและเกิดก่อนกด** — ตรวจแบบ inline ตอน blur/change, ปุ่ม submit ถูกปิดพร้อม**ข้อความเหตุผลใต้ปุ่ม** (ไม่ใช้ tooltip — มือถือ hover ไม่ได้) จนกว่าจะครบ; กดแล้ว fail จาก server → อยู่หน้าเดิม คงค่าทุกช่อง focus ช่องแรกที่ผิด
6. **สำเร็จต้องจบชัด** (pattern EXP-UX-01): `router.replace` ไปหน้ารายการ/สมุด + toast + highlight แถวที่เพิ่งสร้าง + สถานะบนแถวเป็นหลักฐานถาวร (toast อย่างเดียวไม่พอ)

#### 7.2 กติกา "ไม่มีปุ่มพาไปตาย" (action-gating matrix)

ทุกปุ่ม/เมนู/CTA ต้องอยู่ในสถานะใดสถานะหนึ่งต่อไปนี้เสมอ — ห้ามมีสถานะ "กดได้แต่จะ fail":

| เงื่อนไข | การแสดงผล | ตัวอย่าง |
|---|---|---|
| ไม่มีสิทธิ์ / feature ปิด / entitlement ปิด | **ซ่อนทั้งก้อน** (ไม่ render) | พนักงานไม่มีสิทธิ์ issue ไม่เห็นปุ่ม "บันทึกรายรับ (รับเงินแล้ว)" — เห็นเฉพาะ "บันทึกร่าง" พร้อมคำอธิบายว่าใครเป็นผู้ยืนยัน |
| มีสิทธิ์ แต่เงื่อนไขข้อมูลยังไม่ครบ | **disabled + ข้อความเหตุผลสั้น ๆ ใต้ปุ่ม** | "กรอกยอดเงินก่อนจึงบันทึกได้", "เลือกวิธีคิด VAT ของรายการที่ 2 ก่อนยืนยัน" |
| เงื่อนไขครบ | enabled — กดแล้วต้องสำเร็จหรือ fail ด้วยเหตุ runtime จริงเท่านั้น (เครือข่าย/ชนกัน) ซึ่งต้องกู้คืนได้ | — |
| ระบบปิดชั่วคราว (kill switch CLOSE) | ซ่อน CTA สร้างใหม่ + แถบแจ้ง "ปิดปรับปรุงชั่วคราว รายการเดิมยังเปิดดูได้" | pattern `assertExpenseRootOpen` copy |

- Server ยัง validate ซ้ำทุกครั้ง — UI gating คือ UX ไม่ใช่ security (deny-by-default guard เดิมคุมอยู่)
- ลำดับหน้าจอบังคับทิศเดียว: เลือกโหมด → กรอก → (ยืนยัน) → เห็นผลในสมุด; ไม่มีทางแยกที่พาไปหน้า 403/planned/ว่างเปล่า (กติกา P4 เดิม)

#### 7.3 S1 หน้า "บันทึกรายรับ"

```text
[หัวข้อ] บันทึกรายรับ
[คำถามเดียวเต็มจอ — ปุ่มใหญ่ 2 ปุ่ม ≥56px]
  ┌───────────────────────────┐  ┌───────────────────────────┐
  │ 💵 รับเงินแล้ว             │  │ 🧾 ออกบิลไว้ก่อน           │
  │ ขายแล้วเก็บเงินทันที        │  │ ส่งบิลให้ลูกค้า รอเก็บเงิน   │
  └───────────────────────────┘  └───────────────────────────┘
(แสดงเฉพาะปุ่มที่ผู้ใช้มีสิทธิ์ทำจนจบ — ตาม 7.2 แถวแรก)
```

ฟอร์ม (ทั้งสองโหมดใช้โครงเดียว ต่างเฉพาะส่วนการเงินท้ายฟอร์ม):

1. **วันที่** (default วันนี้ ปฏิทินไทย) → 2. **รายการ** (บรรทัดแรกเปิดพร้อมกรอกทันที: รายละเอียด + จำนวนเงิน; ปุ่ม "+ เพิ่มรายการ" เพิ่มบรรทัด; แต่ละบรรทัดมี **หมวดรายรับ** (ThemedSelect จาก picker ACTIVE, default = หมวดของบรรทัดก่อนหน้า) และ **VAT ต่อบรรทัด** ตามกติกา 7.9) → 3. **ลูกค้า** (ไม่บังคับ, default label "ลูกค้าทั่วไป (ขายเงินสด)") → 4. โหมดรับเงินแล้ว: **ช่องทางรับเงิน** ปุ่มเลือก 4 อัน (เงินสด/โอน/บัตร/อื่น ๆ); โหมดออกบิล: **วันครบกำหนด** → 5. ตัวเลือกเพิ่มเติม (ยุบ): หมายเหตุ, ไฟล์แนบ, ส่วนลด, WHT, สาขา
- แถบสรุปเงินติดท้ายจอ (sticky): ยอดรวม + VAT + ยอดสุทธิ อัปเดตสด
- ปุ่ม primary: "บันทึกรับเงิน ฿X,XXX" / "ออกบิล ฿X,XXX" — disabled+เหตุผลจนกว่า: มี ≥1 บรรทัดที่มีรายละเอียด+ยอด, ทุกบรรทัดรู้สถานะ VAT (ไม่มีบรรทัด "ยังไม่แน่ใจ"), เลือกช่องทางรับเงิน (โหมดขายสด)
- "ยังไม่แน่ใจ" (VAT) → ปุ่ม primary เปลี่ยนเป็น "บันทึกร่างไว้ก่อน" + บอกชัด "รายการที่ N ยังไม่ได้เลือก VAT — ยืนยันได้เมื่อเลือกครบ" (กติกา VAT-MIX เดิม: ร่างได้เสมอ ยืนยันต้องครบ)
- สำเร็จ: replace → สมุด (แท็บรายรับ) + highlight แถวใหม่ + toast "บันทึกรายรับเรียบร้อย · ใบเสร็จ RC-xxx ออกให้แล้ว" (โหมดขายสด แสดงเลขใบเสร็จที่ออกอัตโนมัติ)

#### 7.4 S2 รายการรอรับเงิน + รับชำระ

- แท็บ "รอรับเงิน" ในสมุด: เรียงตามใกล้ครบกำหนด, แถวแสดง ลูกค้า/เลขเอกสาร/ยอดค้าง/ครบกำหนด + badge "เกินกำหนด" สีเตือน
- ปุ่มต่อแถว "รับชำระ" (แสดงเฉพาะผู้มีสิทธิ์ `accounting.payment.create`) → Modal: ยอดที่รับ (default = ยอดค้างเต็ม), ถูกหัก ณ ที่จ่าย (ยุบ), ช่องทาง 4 ปุ่ม, วันที่ — ปุ่มยืนยัน disabled จนยอด > 0 และ ≤ ยอดค้าง+เหตุผลถ้าเกิน; สำเร็จ → แถวเปลี่ยนสถานะ "รับแล้ว" + ยอดรอรับเงินบนหัวสมุดลดทันที

#### 7.5 S3 หน้า "สมุดรายรับ–รายจ่าย"

- ลำดับบน→ล่าง: (1) ตัวเลือกเดือน (default เดือนนี้) (2) การ์ดตัวเลข 6 ใบ ชุดคำตามที่ Owner ยืนยัน — มือถือเรียง 2×3, ตัวเลขใหญ่ ≥24px (3) บรรทัด "ส่วนต่างรายรับ–รายจ่ายที่บันทึก (ตามเอกสาร)" (4) กราฟแท่ง CSS ตามหมวด (แท็บ รายรับ/รายจ่าย) (5) รายการ (แท็บ รายรับ/รายจ่าย/รอรับเงิน) (6) ปุ่ม "ดาวน์โหลด Excel/CSV"
- ทุกแถวกดได้ → เปิดหลักฐานต้นทาง; ป้ายกำกับ "รอรับเงิน = ยอด ณ ปัจจุบัน ไม่ผูกเดือนที่เลือก"
- ปุ่มดาวน์โหลด: disabled+เหตุผลระหว่างโหลด/ไม่มีข้อมูล; ตัวเลขที่ self-check ไม่ผ่าน → การ์ดแสดง "—" + ข้อความ "คำนวณไม่สำเร็จ ลองรีเฟรช" ห้ามแสดงตัวเลขผิด
- บริษัทที่ยังไม่เปิดฝั่งขาย: การ์ดฝั่งรายรับแสดงสถานะ "เร็ว ๆ นี้" (ไม่ใช่ 0.00 หลอก ๆ) + ฝั่งรายจ่ายทำงานเต็ม

#### 7.6 S4 หน้า "หมวดรายรับ" (สร้างแล้วใน Phase 2)

ตามที่ส่งมอบ: เพิ่ม/แก้ชื่อ/ปิดใช้ (ARCHIVED) พร้อม confirm dialog, ไม่มีลบจริง; เมื่อนักบัญชียืนยันค่า VAT ต่อหมวดแล้ว (7.9) เพิ่มคอลัมน์ "VAT เริ่มต้น" แบบเดียวกับฝั่งรายจ่าย (ซ่อนทั้งคอลัมน์สำหรับบริษัทไม่จด VAT)

#### 7.7 S5 ใบลดหนี้/ใบเพิ่มหนี้ (source-first — ห้ามฟอร์มเปล่า)

```text
กด "ลดหนี้/แก้ยอด" (จากหน้าเอกสารที่ issue แล้วเท่านั้น — ไม่มีเมนูลอย)
  → ระบบ prefill: เอกสารอ้างอิง, ลูกค้า, มูลค่าตามเอกสารเดิม (แก้ไม่ได้)
  → เลือกสาเหตุ (dropdown บังคับ — รายการตามกฎหมาย + "เหตุอื่น ระบุ")
  → แก้รายการเป็น "มูลค่าที่ถูกต้อง" → ระบบแสดง ผลต่าง อัตโนมัติ
  → ปุ่ม "ออกใบลดหนี้" disabled จนเลือกสาเหตุ + ผลต่าง > 0 + ไม่เกินเพดานลดหนี้สะสม (บอกเพดานที่เหลือบนจอ)
```

#### 7.8 สถานะกลางที่ทุกหน้าต้องมี

| สถานะ | การแสดง |
|---|---|
| loading | skeleton ของ layout จริง (ไม่ใช่จอขาว/สปินเนอร์ลอย) |
| empty | ภาพ + ประโยคชวนทำ action แรก ("ยังไม่มีรายรับเดือนนี้ — กดบันทึกรายรับรายการแรก") + CTA |
| error | `ErrorBanner role=alert` + ปุ่ม "ลองใหม่" — ห้าม stack trace/รหัส |
| forbidden | ข้อความสิทธิ์ภาษาคน + บอกว่าใครช่วยได้ ("ติดต่อเจ้าของกิจการเพื่อขอสิทธิ์") — เกิดได้เฉพาะเข้าตรงด้วย URL เพราะเมนูถูกซ่อนตาม 7.2 |
| success | toast + สถานะถาวรบนแถว + จุดโฟกัสถัดไปชัด |

#### 7.9 VAT ต่อหมวด — กติกากันเคส "คิด VAT 7% ที่รายการผัก" (Owner 2026-08-26 รอบสอง)

ข้อเท็จจริงที่ยืนยันแล้ว:

- **ฝั่งรายจ่าย ปิดแล้ว** — VAT-MIX-01 (2026-08-26) บังคับ treatment ต่อบรรทัด และ golden case ข้อ 3 ของแผนหลัก §13.11.B คือเคสผักตรง ๆ ("ผัก/ผลไม้ไม่มี VAT ต้องไม่เข้า VAT base"); หมวดรายจ่าย 12 หมวดตัดตาม tax behaviour อยู่แล้ว (`expense-category-bootstrap.service.ts:13-17`)
- **ฝั่งรายรับ**: engine รองรับ `vatRate` ต่อบรรทัดแล้ว (`schema.prisma:1841`, `calculateLine`) และหมวดมีช่อง `defaultOutputTaxCode` (O7/OX/O0) รออยู่ — seed ปัจจุบันจงใจเป็น "ไม่กำหนด" ทุกหมวด

กติกาบังคับ:

1. **ระบบไม่มีวันเดา VAT ให้บรรทัดใด** — ค่า default ต่อบรรทัดมาจาก **หมวดรายรับของบรรทัดนั้น** เท่านั้น: หมวด `O7` → "มี VAT 7%", หมวด `OX` → "ยกเว้น VAT", หมวด `O0` → "VAT 0%", หมวดไม่กำหนด → บรรทัดขึ้นสถานะ "เลือกวิธีคิด VAT" (ไม่ pre-select อะไร)
2. หมวดกว้าง ("ขายสินค้า") ตอบภาษีไม่ได้ → ธุรกิจที่ขายของยกเว้น VAT ให้**เพิ่มหมวดแยกตาม tax behaviour** เช่น "ขายผัก-ผลไม้สด (ยกเว้น VAT)" = `OX` — แนวเดียวกับ template รายจ่ายที่แยก ค่ารับรอง/ค่าเช่า/ค่าขนส่ง เพราะภาษีต่างกัน
3. ผู้ใช้แก้ค่าต่อบรรทัดได้เสมอ (suggestion ไม่ใช่ decision — กติกาเดียวกับ [expense-category-default-tax-code-spec](expense-category-default-tax-code-spec.md) §7); บรรทัดที่ยังไม่รู้ = บันทึกร่างได้ ยืนยันไม่ได้ พร้อมชี้บรรทัด
4. บริษัทไม่จด VAT: ซ่อนทุกอย่าง default `NO_VAT` (V4)
5. **ค่าจริงต่อหมวดต้องผ่านนักบัญชียืนยันก่อนตั้ง** (Owner ข้อ 5) — แหล่งอ้างอิงเบื้องต้นสำหรับหมวดยกเว้น: รายการกิจการยกเว้น VAT 28 ข้อ (ม.81 ประมวลรัษฎากร; สรุปโดย [บทความ rpacc.co.th ที่ Owner ส่งให้ 2026-08-26](https://www.rpacc.co.th/content/29454/) — ข้อที่พบบ่อยกับลูกค้ามั่งมี: พืชผลทางการเกษตร, สัตว์, ปุ๋ย/อาหารสัตว์, ขนส่งในประเทศ, เช่าอสังหาริมทรัพย์, วิชาชีพอิสระ, กิจการรายรับ ≤1.8 ล้าน/ปี) — ค่า production ต้องบันทึกผ่านกระบวนการ [tax-2026-verified-rules](tax-2026-verified-rules.md) พร้อมชื่อผู้ยืนยัน
   - ตัวอย่างที่พิสูจน์ว่าทำไม default ต้องรอนักบัญชี: **หมวดตั้งต้น "ค่าเช่า" ตอบภาษีไม่ได้ในตัวเอง** — เช่า**อสังหา**ริมทรัพย์ยกเว้น VAT (ข้อ 17 ของรายการ) แต่เช่า**สังหา**ริมทรัพย์ (เครื่องมือ/รถ) เสีย 7% → ตอนตั้งค่ากับนักบัญชีให้แยกเป็นสองหมวด ("ค่าเช่าอสังหาริมทรัพย์" = OX, "ค่าเช่าอุปกรณ์/ทรัพย์สินอื่น" = O7) หรือคง null ให้เลือกต่อบรรทัด — ห้ามตั้งค่าเดียวคลุม
6. **การเตือนใกล้เกณฑ์จด VAT 1.8 ล้าน/ปี (เสนอเพิ่ม — Owner ตัดออกได้)**: สำหรับบริษัทที่ยังไม่จด VAT (ยกเว้นตามข้อ 1 ของรายการ) หน้าสมุดแสดงแถบแจ้งเมื่อ "ยอดขายจากเอกสาร" สะสมปีปฏิทินแตะ 80% และ 100% ของ 1,800,000 บาท — ข้อความแนะนำให้ปรึกษานักบัญชีเรื่องจดทะเบียน VAT, ไม่ block ไม่ enforce อะไรทั้งสิ้น; นิยามยอด = Σ `grandTotalAmount` เอกสาร issued ไม่ void ของปีนี้ (นิยามเดียวกับการ์ดสมุด) — ธุรกิจที่ควรรู้เรื่องนี้มักไม่รู้ตัวจนโดนย้อนหลัง ระบบเรามีตัวเลขอยู่แล้ว
6. Gap ใหม่ **LED-FIN-06**: ระดับบรรทัดวันนี้แยก "ยกเว้น" กับ "0%" ด้วย `vatRate` ตัวเดียวไม่ได้ (OS spec §9.1 ห้าม conflate) — ตัวเลขเงินถูกต้อง แต่รายงานภาษีขายแยกประเภทยังทำไม่ได้ → คงกติกา "ห้ามโฆษณา ภ.พ.30 ฝั่งขาย" (§5) จนเพิ่ม treatment ต่อบรรทัดในเฟสภาษี

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
| M5 | `AccountingDocument.adjustmentReasonCode String?` + `adjustmentReasonText String?` (ใช้เฉพาะ CN/DN — §F-LED-6) | ADD COLUMN |
| M6 | ขยาย allow-list `isAllowedAttachmentTarget` เพิ่ม `accounting.document` + purposes ใหม่ (V2) | โค้ด ไม่แก้ schema |
| M7 | ตาราง `AccountingSimpleIncomeCommand` (`companyId,idempotencyKey` unique + fingerprint + invoice/payment/receipt IDs พร้อม composite FKs) | CREATE TABLE |

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

## 9. คำถาม Owner — **ตอบครบแล้ว 2026-08-26**

| ข้อ | คำถาม | คำตอบ Owner | ผลต่อ spec |
|---|---|---|---|
| 1 | ลำดับคิวกับสาย P14→P26 (billing) | **P27 มาก่อน** | คิวหลักของ dev = แผนนี้; billing ต่อคิวถัดไป (อัปเดตแผนหลัก §10 แล้ว) |
| 2 | ใบเสร็จอัตโนมัติในโหมดขายสด | **อัตโนมัติทุกครั้ง** | อยู่ใน bundle ขั้นที่ 4 (§F-LED-1); ความเป็นไปได้ยืนยันด้วย V3 |
| 3 | บริษัทไม่จด VAT ซ่อนตัวเลือก VAT | **ใช่** | ใช้ `VatRegistrationStatus` + กติกา `deriveExpenseCaptureMode` เดิม (V4 — ตาราง mapping ใน §F-LED-1) |
| 4 | ใบลดหนี้เมื่อไม่มีใบกำกับภาษี | **เลียนแบบ FlowAccount** (Owner เปิดบัญชีทดสอบให้ตรวจ) | §F-LED-6: ขยาย source rule ให้อ้าง INVOICE ที่ issue แล้วได้ + สาเหตุบังคับ (M5) + มูลค่าเดิม/ถูกต้อง/ผลต่าง prefill; ไม่ทำ CN แบบไม่อ้างเอกสารใน MVP |
| 5 | นักบัญชีผู้ยืนยัน mapping หมวดรายรับ | **ใช้ตาราง mapping taxcode ที่เคยทำไว้แล้ว** | pattern ตาม [expense-category-default-tax-code-spec](expense-category-default-tax-code-spec.md) (v1.1 Implemented): เก็บ external code ไม่มี FK, resolve ตามวันที่เอกสาร — `RevenueCategory.defaultOutputTaxCode` ใช้กลไกเดียวกันฝั่ง OUTPUT; ค่าตั้งต้นต่อหมวด = **ไม่กำหนด (null)** จนกว่าจะยืนยันกับ [tax-2026-verified-rules](tax-2026-verified-rules.md) ราย code (conservative — suggestion ที่ไม่ resolve = ไม่โผล่ ตามกติกา spec แม่) |
| 6 | ชุดคำ 6 ตัวเลขหน้าสมุด | **ยืนยัน** | ตาราง §F-LED-4 เป็น final copy |
| 7 (รอบสอง) | spec ต้องรวมสเปกหน้าจอ — theme เดิม, ใช้ง่ายตาม concept, มุมมอง specialist UX/UI, "ไม่เปิดก่อนให้กดแล้วเจอ error ตามหลัง" | **สั่งเพิ่ม 2026-08-26** | §F-LED-7 ทั้งหมวด: หลักการ 6 ข้อ + action-gating matrix + สเปกหน้าจอ S1–S5 + สถานะกลาง |
| 8 (รอบสอง) | "แต่ละหมวดหมู่คิด tax ยังไง — เคยเจอคิด VAT 7 ที่รายการผัก" | **สั่งเพิ่ม 2026-08-26** (Owner ส่งแหล่งอ้างอิงรายการกิจการยกเว้น VAT ให้) | §7.9: default VAT ต่อบรรทัดมาจากหมวดเท่านั้น ห้ามเดา, หมวดแยกตาม tax behaviour สำหรับของยกเว้น (เช่น ผัก-ผลไม้สด = OX), ค่าจริงรอนักบัญชียืนยันผ่าน tax-2026-verified-rules; ฝั่งรายจ่ายเคสนี้ปิดแล้วใน VAT-MIX-01 golden ข้อ 3 |
