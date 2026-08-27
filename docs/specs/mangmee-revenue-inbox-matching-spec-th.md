# Auto Revenue Foundation + Revenue Inbox + Matching — Spec P15/P16/P17

สถานะ: **DEFERRED BY OWNER 2026-08-27** — รอบนี้เก็บข้อมูล/เอกสารรับ–จ่ายก่อน ไม่ทำ reconciliation, Revenue Inbox/Matching หรือ foundation/harness เพื่อเตรียมงานเหล่านี้. Spec ด้านล่างเก็บไว้สำหรับอนาคต ไม่เป็น release/main gate รอบนี้; ต้องประเมิน current truth และ Owner §7 ใหม่ก่อนกลับมาเริ่ม. P15-0 worktree ที่ทดสอบแล้วหยุดโดยยังไม่ commit/push/merge. แผนส่งมอบอยู่ใน [Four-lane Gap Closure Plan](../plans/mangmee-four-lane-gap-closure-plan-th.md#p15p17--revenue-foundationinboxmatching)

เอกสารแม่: [bank-reconciliation-spec](bank-reconciliation-spec.md) (item 13 — ฐาน implement แล้ว), [OS spec §10](mangmee-accounting-operating-system-spec-th.md) (state/classification), [แผนหลัก P15–P17 + REVENUE-01..08 + §13.12](../plans/mangmee-brain-2-5-day-priority-plan-th.md), [P27 ledger spec](mangmee-income-expense-ledger-spec-th.md) (ทางสร้างเอกสารขายที่ Inbox ต้องใช้)

หลักฐานโค้ด `develop` (สำรวจเชิงลึก 2026-08-26)

## 1. Current truth

### 1.1 ฐานที่มีจริง (item 13 — แน่นกว่าที่แผนบันทึก)

| ส่วน | หลักฐาน |
|---|---|
| Models ครบ 8 ตัวตรงตาม spec: `BankAccount, BankStatementImport, BankStatementLine, BankReconciliationMatch, BankAdjustment, BankReconciliationSession(+Line), BankReconciliationEvidenceExport` | `schema.prisma:4911-5150` |
| Statement line: `lineHash` unique ต่อบัญชี (กัน import ซ้ำ), direction/signedAmount/runningBalance, สถานะ `UNMATCHED SUGGESTED PARTIALLY_MATCHED MATCHED IGNORED VOIDED` — **ไม่มี field จำแนกประเภทเงินเข้าใด ๆ** | `:4977-5013,4856` |
| Import: CSV/TSV/TXT (parse ฝั่ง web) + **PDF/รูปผ่าน AI** (pdf text-layer ก่อน, OCR fallback, provenance `csv_xlsx|pdf_text|ocr`) + preview→commit + duplicatePolicy + manual line + void | `statement-import.use-case.ts:105-142`; `statement.controller.ts:30-76` |
| Match ยืนยัน/ปฏิเสธ/ถอน/ignore ครบ + allocation guard + 1↔N/N↔1 + override เกินยอดต้องเหตุผล | `matching.use-case.ts:30-221`; `banking.logic.ts:272-310` |
| Candidate feed 5 แหล่ง read-only: CUSTOMER_PAYMENT / EXPENSE_PAYMENT / SUPPLIER_PAYMENT / REIMBURSEMENT_PAYMENT / BANK_ADJUSTMENT (หัก allocation ที่ยืนยันแล้ว → remaining) | `prisma-match-source.query.ts:24-146` |
| Adjustment มีหมวดที่เป็น "การจำแนกเงิน" อยู่แล้วบางส่วน: `BANK_FEE BANK_INTEREST OWNER_CONTRIBUTION OWNER_DRAW INTER_ACCOUNT_TRANSFER UNKNOWN_DEPOSIT UNKNOWN_WITHDRAWAL OTHER` + posting 2 ขา (เลือกบัญชีเอง ไม่เดา revenue) | `schema.prisma:4892`; `banking.logic.ts:412-455` |
| Session กระทบยอด opening/closing + complete (ACCOUNTANT-owned) + reopen มีครบ; web hub 6 แท็บ `status:'ready'` ใน nav group finance | `reconciliation.use-case.ts`; `web-core-workspace.constants.ts:258-275` |

### 1.2 ช่องว่างที่ยืนยันแล้ว (NOT FOUND ทั้งหมด)

1. **ไม่มีสิ่งใดสร้างรายได้/เอกสาร/payment จาก statement** — banking ไม่เขียนตาราง accounting ใด ๆ (grep ยืนยัน 0 hit) → REVENUE-03 ยังไม่มีผู้ละเมิดและต้องคงไว้เช่นนั้น
2. **Scorer เป็น dead code**: `scoreMatchCandidate` (`banking.logic.ts:210-265` — exact-amount, date window ±0/3/7 = +30/20/10, bankReference +15, counterparty +5) ไม่มีผู้เรียก production; ไม่มีโค้ดเขียนสถานะ `SUGGESTED` เลย; `bank.match.suggest` permission มีแต่ไม่มี route; จัดอันดับปัจจุบันทำฝั่ง browser (`rankCandidatesForLine`)
3. XLSX ยังอ่านไม่ได้ (spec §8.1 บังคับ แต่ parser ไม่มี); `bank.reconciliation.export` ไม่มี route/writer; `LEDGER_JOURNAL_LINE`/`INTER_ACCOUNT_TRANSFER` candidates ถูก defer โดยเจตนา; v5.1 amendment (allocation-command/tax cash-evidence/redaction/safe-unmatch) owner-confirmed แต่ยังไม่ implement
4. ไม่มี Revenue Inbox state machine / classification taxonomy / daily-revenue narrative ใด ๆ (daily closing ปัจจุบัน = expense เท่านั้น; `bank.get_account_balances`/`bank.get_reconciliation_status` เป็น tool "registered-but-waiting")

## 2. หลักการที่ห้ามละเมิด (REVENUE-03..08 เป็นกฎหมายของ pipeline นี้)

1. เงินเข้า **default = Unidentified/Needs review** — ห้ามเดาเป็นรายได้ (REVENUE-03)
2. เงินจาก invoice = เคลียร์ AR ไม่ลงรายได้/VAT ซ้ำ (REVENUE-04 — engine บังคับแล้ว)
3. ขายสดไม่มี invoice → **สร้างเอกสารขายผ่านเส้นทาง P27 (`RecordSimpleIncome`/เอกสารขายเดิม)** ก่อน แล้วจึง match — Inbox ไม่มีวันเขียนรายได้ตรง
4. Net settlement ห้ามลงทั้งก้อน (REVENUE-05 — ยกไป P19); โอนสุทธิหลัง WHT = Bank + WHT receivable = AR (REVENUE-06); duplicate จาก import/retry กันด้วย `lineHash` เดิม + idempotency (REVENUE-07)
5. Beta: **false auto-confirm = 0** — ทุกการยืนยันผ่านคน; auto-post ปิดจน precision ≥99.5% ราย source (§15 แถว Auto-match quality)
6. "กระทบยอด" ≠ Inbox: full reconciliation ยังคือ session opening/closing เดิม (REVENUE-08)

## 3. P15 — Foundation (จำแนกประเภทก่อน ไม่มี connector)

- **Classification taxonomy** ตามตาราง OS spec §10.3 (9 แถว): `CUSTOMER_PAYMENT / REVENUE_CANDIDATE / INTER_ACCOUNT_TRANSFER / CAPITAL_OR_DIRECTOR_LOAN / LOAN / CUSTOMER_DEPOSIT / REFUND_REVERSAL / SETTLEMENT / UNIDENTIFIED` — additive fields บน `BankStatementLine`: `inflowClassification?`, `classificationStatus (NEW→SUGGESTED→CONFIRMED→ACCOUNTED | NEEDS_REVIEW | REJECTED)`, `classifiedByUserId/At`, `classificationReason` (state ย่อจาก OS §10.2 โดย map กับสถานะ match เดิม — เหตุผลที่ additive บนตารางเดิม: line คือ source of truth ของเงินเข้าอยู่แล้ว การสร้างตาราง inbox แยกจะสร้าง state ซ้ำสองแหล่ง; ทางเลือกตารางแยกบันทึกไว้ให้ทีมคัดค้านตอน implement ได้)
- Classification matrix ที่ **Accountant ลงนาม** ก่อนใช้ (per §11 ข้อ 14): mapping จำแนก → ผลบัญชี (ตาราง OS §10.3 คอลัมน์ขวา)
- Golden dataset ขั้นต่ำตามแผน P15: exact match, partial, overpayment, WHT net (REVENUE-06), duplicate, refund, ambiguous — ไฟล์ fixture จริงก่อนเขียน matcher
- อะไรที่จำแนกเป็น TRANSFER/FEE/INTEREST/OWNER_* → เดินทาง `BankAdjustment` เดิม (หมวดมีแล้ว §1.1)

## 4. P16 — Revenue Inbox (UX บน import เดิม)

- แท็บใหม่ "เงินเข้า" ใน banking hub: การ์ดภาษาคน 3 กลุ่ม (ตามแผน P16 คำต่อคำ) — **"จับคู่แล้ว" / "ต้องตอบ 1 ข้อ" / "ไม่ทราบที่มา"** พร้อมเหตุผล+หลักฐานต้นทาง; กด "ต้องตอบ 1 ข้อ" = คำถามเดียวจบ (เช่น "เงิน 3,500 จากคุณ A ใช่ค่าสินค้าตามใบ INV-xxx ไหม / เป็นเงินมัดจำ / อื่น ๆ")
- ขายสดไม่มีเอกสาร → ปุ่ม "บันทึกเป็นรายรับ" เปิดฟอร์ม P27 (`RecordSimpleIncome`) พร้อม prefill ยอด/วันที่/ผู้โอน → เอกสารเกิดตามเส้นทางปกติ → match อัตโนมัติกับ line นั้น
- เก็บงานค้าง: XLSX parser (ช่องว่าง §1.2 ข้อ 3), คืน `bank.reconciliation.export` route (v5.1 amendment รวมเข้าคิวนี้)
- กติกา UI = F-LED-7 ทุกข้อ (การ์ดค่า 0 ไม่แสดง, ปุ่มตาม permission matrix)

## 5. P17 — Matching + Exception (ทำ scorer ที่มีให้มีชีวิต)

- **Deterministic ก่อน AI เสมอ** (แผน P17): ลำดับ = exact reference/เลขเอกสาร → exact amount+counterparty → scorer เดิม (`scoreMatchCandidate` — wire เป็น server-side suggestion แล้ว **persist สถานะ `SUGGESTED`** ที่ enum รอไว้แล้ว) → เหลือ = NEEDS_REVIEW
- Threshold จาก golden data เท่านั้น (OS §10.4 — "เป้า 95% เป็น aspiration ห้ามใช้เป็น acceptance"); suggested สูงสุด 3 รายการต่อ line พร้อมเหตุผล; ambiguous → ถามภาษาคน; closed period/rule หาย → fail closed
- 1 เงินเข้า→หลาย invoice, หลายเงินเข้า→1 invoice, partial, overpayment→unapplied credit, WHT net (ใช้ allocation + validateMatchAllocation เดิม)
- Exception workflow: Owner/Admin ตอบบริบทธุรกิจ; Accountant เห็น entry preview และเป็นผู้ approve posting/tax (แผน P17 คำต่อคำ); AI ทำได้แค่จัดอันดับ/อธิบาย (แผน P16)
- Regression บังคับ: golden set §3 + "invoice payment ไม่ลง P&L/VAT ซ้ำ" + duplicate/replay สร้าง match เดียว + §15 แถว Auto Revenue ทั้งแถวเป็นเกณฑ์

## 6. สิ่งที่ไม่ทำใน pipeline นี้

Direct bank/gateway/marketplace/POS connectors (P18–P20 — spec ตอนเลือก provider), auto-post (จน precision gate ผ่าน), การสร้างรายได้อัตโนมัติทุกชนิด, payment rails (non-goal ของ item 13 คงเดิม)

## 7. คำถาม Owner (จาก §11 เดิมที่ยังเปิด)

1. ยืนยันเริ่มจาก Bank Statement import + matching เดิม (ข้อ 11 — ข้อเสนอแนะนำ) ไม่ทำ direct bank ก่อน
2. แหล่งเงินเข้า volume สูงสุดของบริษัทนำร่อง (ข้อ 12) — กำหนดลำดับ golden dataset
3. ยืนยัน Accountant review ก่อน posting ทุกครั้งช่วง Beta แม้ exact match (ข้อ 13)
4. ใครอนุมัติ classification matrix (ข้อ 14)
