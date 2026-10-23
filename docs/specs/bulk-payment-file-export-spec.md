# Bulk Payment File Export Spec — จ่ายหลายรายการผ่านธนาคาร (แผ่นงานรายการโอน) และจุดยืนเรื่องดึงรายการเดินบัญชีอัตโนมัติ

Status: READY (docs-first) — reviewed 3 rounds 2026-10-24, no HIGH open; see Must close before coding (§12.1)
Owner: thawatchai (เจ้าของ) · lane: รายจ่าย + การเบิกจ่าย (การจ่ายเงิน)
Related: backlog ข้อ 11 ใน `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md`, `docs/specs/expense-payment-preparation-voucher-spec-th.md` (§8.2 "ระบบไม่โอนเงิน", §16), `docs/specs/reimbursement-payout-account-and-payment-slip-spec-th.md` (D2 ผู้เห็นเลขบัญชี, D3 การโอนต้องมีสลิป), `docs/specs/reimbursement-multi-payout-accounts-spec-th.md`, `docs/specs/bank-reconciliation-spec.md`, `docs/specs/e-withholding-tax-payment-spec.md` (backlog ข้อ 7 — DRAFT คู่ขนาน กำหนด `ExpenseRecord.whtRemittance` = `PAYER_FILES | E_WHT`), `docs/guidelines/thai-ux-standard.md`, `docs/plans/bulk-payment-file-export-plan.md`, `docs/agent-memory/bulk-payment-file-export.md`
Baseline: main 6c54ba208 (2026-10-23) — อ่านโค้ดจาก worktree `claude/expense-specs-20261023` (`git diff 6c54ba208 HEAD` ว่าง = ต้นไม้เดียวกัน)

ป้ายหลักฐานภายนอก: **[ยืนยันเอง]** = ผู้เขียนเปิดอ่านหน้าต้นฉบับเอง 23–24 ต.ค. 2569 · **[ผู้ช่วยค้นยืนยัน]** = ผู้ช่วยค้นข้อมูลอ่านหน้า/PDF ของธนาคารหรือหน่วยงานได้ ผู้เขียนเปิดซ้ำไม่ได้ (PDF บีบอัด หรือเว็บปฏิเสธเครื่องมือ) · **[ผู้ตรวจ/ผู้ประสานงานอ้าง]** = ผู้ตรวจอิสระหรือผู้ประสานงานอ่านแหล่งนั้นเมื่อ 24 ต.ค. ผู้เขียนเปิดได้แต่อ่านข้อความไม่ได้หรือเปิดไม่ได้ · **[รอง]** = แหล่งรอง · **[ต้องมีหลักฐานปัจจุบัน]** = มีแต่หลักฐานเก่าหรืออ่านซ้ำไม่ได้ ห้ามใช้เป็นข้อเท็จจริงของ ต.ค. 2569 จนกว่าจะตรวจใหม่

## 0. สรุปสั้น

- วันนี้ระบบ **บันทึก** การจ่ายได้ทีละใบ (ใบเตรียมจ่าย 1 ใบ = ผู้รับ 1 ราย, ใบเบิก 1 ใบ = ผู้เบิก 1 คน) และไม่โอนเงินเอง
- spec นี้เพิ่ม **"ชุดโอน"**: เลือกใบเตรียมจ่ายที่อนุมัติแล้ว + ใบเบิกรอจ่ายหลายใบ → (ก) บนมือถือ คัดลอกเลขบัญชีไปโอนในแอปธนาคารทีละรายการแล้วบันทึกจ่ายตามเดิม หรือ (ข) บนคอมพิวเตอร์ ดาวน์โหลด **แผ่นงานรายการโอน (Excel)** ไปกรอกหรือคัดลอกลงแม่แบบ/หน้าจอของธนาคารเอง แล้วกลับมาบันทึกผลด้วยไฟล์ผลจากธนาคาร
- ระบบ **ไม่โอนเงิน ไม่เชื่อมธนาคาร** และรุ่นนี้ **ไม่อ้างว่าไฟล์อัปโหลดเข้าธนาคารได้ตรง ๆ** จนกว่าจะตรวจรูปแบบนำเข้าของธนาคารนั้นจริง (Phase 2 SCB Business Anywhere, Phase 3 กสิกร KCC+)
- ทุกแพ็กที่ขาย (249/499/999/1999) ไม่มีสวิตช์ ไม่มีสิทธิ์ใหม่
- **ไม่ทำดึงรายการเดินบัญชีอัตโนมัติ** ตอนนี้ (§5.10)

## 1. ปัญหา (พฤติกรรมปัจจุบัน พร้อมหลักฐาน)

### 1.1 จ่ายได้ทีละใบ และระบบไม่โอนเงิน

- ใบเตรียมจ่าย: "ระบบไม่โอนเงินและไม่ยืนยันกับธนาคาร การบันทึกคือการบอกว่าจ่ายภายนอกแล้ว" (`docs/specs/expense-payment-preparation-voucher-spec-th.md:397`) และตัด "การจองงานจ่ายกันโอนซ้ำนอกระบบ … การสั่งโอนเงินจริง" ออกจากรุ่นแรก (`:182`, `:880`)
- ใบเตรียมจ่ายหนึ่งใบ = ผู้รับรายเดียว ไม่เกิน 20 รายการ (`apps/api/src/modules/expenses/application/use-cases/disbursement-voucher.use-case.ts:50`) `pay()` สร้าง `ExpensePayment` ต่อบรรทัดในธุรกรรมเดียว ใช้ `paymentMethod`, `paidDate`, `paidFromRef` (≤128) สลิปไม่บังคับ (`:731-783`)
- ใบเบิก: `RecordReimbursementPaymentUseCase` (`apps/api/src/modules/reimbursements/application/use-cases/reimbursement-finance.use-case.ts:381-560`) จ่ายเต็มเท่านั้น (`apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic.ts:860`) **การโอนต้องมีสลิป** (`packages/contracts/src/reimbursements.ts:193-195`, `reimbursement.logic.ts:865`) และตรวจซ้ำใต้ล็อกการจ่ายใน repository (`apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts:3706` `hasSlip: Boolean(data.slipAttachmentId)`)
- ร้านที่จ่าย 10 คนทำ 10 รอบ: เปิดใบ → แสดงเลขบัญชี → แอปธนาคาร → โอน → บันทึก → อัปโหลดสลิป

### 1.2 เลขบัญชีผู้รับมีอยู่แล้ว เข้ารหัส และเปิดได้ทีละใบพร้อม audit

- ใบเตรียมจ่าย: `payeeBankName`, `payeeAccountName`, `payeeAccountLast4`, `payeeAccountCiphertext` (`apps/api/prisma/schema.prisma:2796-2799`) รับเลขบัญชี 6–20 หลัก ไม่มีพร้อมเพย์ (`disbursement-voucher.use-case.ts:115-126`; เข้ารหัสที่ `:125`) เปิดเลขที่ `POST disbursement-vouchers/:id/payee-account/reveal` (`apps/api/src/modules/expenses/presentation/http/disbursement-voucher.controller.ts:114-115`) audit HIGH ก่อนถอดรหัส (`disbursement-voucher.use-case.ts:159-172`) ไฟล์ PDF ของใบเรียก `revealAccount` ให้ผู้มี approve/pay (`:344-349`)
- ใบเบิก: `ReimbursementPayoutDestination` (`schema.prisma:7658-7688`) ชนิด `BANK_ACCOUNT` หรือ `PROMPTPAY_PHONE` (มือถือเท่านั้น `packages/contracts/src/reimbursements.ts:2045`) กลุ่มผู้เห็นเลขคือ ผู้เบิก/ผู้อนุมัติ/ผู้จ่าย ตามลำดับ (`apps/api/src/modules/reimbursements/domain/logic/payout-destination.logic.ts:182-195` — คืน `REQUESTER` ก่อนที่ `:191`, `APPROVER` ที่ `:194`) ผ่าน `RevealClaimPayoutUseCase` แบบ fail-closed (`reimbursement-payout-reveal.use-case.ts:20-49`)

### 1.3 ชื่อธนาคารเป็นข้อความ ไม่มีรหัสธนาคาร

- `THAI_BANK_NAMES` 17 แห่ง (`packages/contracts/src/reimbursements.ts:2001-2008`) + "ธนาคารอื่น" ที่พิมพ์เอง ทั้งใบเบิก (`apps/web/src/features/reimbursements/ReimbursementPayout.tsx:100-110`) และใบเตรียมจ่าย (`apps/web/src/features/expenses/disbursement-vouchers/DisbursementVoucherAccountFields.tsx:60-67`)
- บัญชีรับเงินของใบเตรียมจ่ายและใบเบิกไม่มีรหัสธนาคาร · ช่อง `bankCode` มีแล้วในบัญชีธนาคารของร้าน (`schema.prisma:6939`) และบัญชีธนาคารของผู้ขายในเจ้าหนี้ (`SupplierBankAccount.bankCode` `schema.prisma:6243`; seed ใช้ `'004'` `apps/api/prisma/seed.ts:1361`) แต่ไม่มีตารางรหัสกลางที่ตรวจแล้วให้ใช้ร่วมกัน

### 1.4 บัญชีของร้านเองเก็บแค่เลขที่ปิดบัง

- `BankAccount.accountNumberMasked`, `accountNumberLast4` (`schema.prisma:6941-6942`) และเป็นของเมนูที่ผูก `bank_reconciliation` (`packages/contracts/src/menu-entitlements.ts:289-305`) แผ่นงานของเราจึงใส่บัญชีตัดเงินไม่ได้ ผู้ใช้เลือกในระบบของธนาคาร

### 1.5 ไม่มีไฟล์โอนหลายรายการ ไม่มีการดึงรายการเดินบัญชี และกระทบยอดธนาคารไม่ได้ขาย

- LINE: `basis: 'last_completed_reconciliation_not_live_bank_feed'` (`apps/api/src/modules/line-ai/application/use-cases/erp-banking-tools.use-case.ts:57`)
- นำเข้ารายการเดินบัญชี — **แก้ข้อเท็จจริงใน backlog ข้อ 11**: `preset` ระบุ `GENERIC_CSV_XLSX | KASIKORNBANK_KBIZ | SCB_BUSINESS_ANYWHERE` (`apps/api/src/modules/banking/application/use-cases/statement-import.use-case.ts:30`) แต่ไม่มีโค้ดอ่าน (ส่งผ่านที่ `apps/api/src/modules/banking/presentation/http/statement.controller.ts:72`); จับคู่ด้วยหัวคอลัมน์ทั่วไป (`apps/api/src/modules/banking/domain/logic/banking.logic.ts:91-124`); PDF ต้องมีชั้นข้อความ (`statement-import.use-case.ts:106`, `:138-145`); รูปอ่านด้วย AI (`:146-198`); การอ่านไฟล์ต้องมี `bank.statement.import` และบัญชีธนาคารในขอบเขต (`:93-95`); เว็บไม่รับ XLSX (`apps/web/src/features/banking/StatementImportPanel.tsx:99`)
- `bank_reconciliation` ไม่อยู่ใน `STARTER_FEATURE_KEYS` (`menu-entitlements.ts:432-450`); สี่แพ็กใช้ starter; 1999 เพิ่มแค่ `wht_pnd53`, `wht_50bis` (`:496-501`)
- ถ้าร้านเปิดกระทบยอด: การจ่ายรายจ่าย/ใบเบิกเป็นตัวเลือกจับคู่ ใช้ `bankAccountRef` / `paymentReference` เป็นอ้างอิง (`apps/api/src/modules/banking/infrastructure/prisma-match-source.query.ts:84-124`) และบรรทัดเดินบัญชีหนึ่งบรรทัดผูกได้หลายการจ่าย (`schema.prisma:7038-7067`)

### 1.6 ยอดโอนหักภาษี ณ ที่จ่ายไว้แล้ว

- ยอดบรรทัดใบเตรียมจ่าย ≤ ยอดค้าง (`disbursement-voucher.use-case.ts:91-93`) ซึ่งมาจาก `netPayableAmount` = ยอดรวม − ภาษีหัก (`apps/api/src/modules/expenses/domain/logic/expense-totals.logic.ts:132`, `:234`) "source tax is never deducted again" (`packages/contracts/src/disbursement-vouchers.ts:270`)
- ใบเบิกไม่หักภาษี ณ ที่จ่าย (มติ D22 ใน `expense-payment-preparation-voucher-spec-th.md` v2.9)

### 1.7 ไฟล์หลักฐานการจ่ายมีรั้วกั้นเฉพาะ

- สลิปใบเบิกและไฟล์ของใบเตรียมจ่ายถูกกันจากการดาวน์โหลดทั่วไป (`apps/api/src/modules/data-model-core/application/use-cases/create-download-url.use-case.ts:79-101`; ผ่านรั้วทั้งหมดแล้วจึง `return existing;` ที่ `:119`), ห้ามลบ (`apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-attachment.repository.ts:266-276` ก่อน `status: 'DELETED'` ที่ `:285`), ห้ามนำไปใช้เป็นไฟล์อื่น (`NOT_REIMBURSEMENT_PAYMENT_SLIP_WHERE` `:32-40` ใช้ที่ `apps/api/src/modules/line-ai/application/line-reimbursement-draft-adapter.service.ts:802`; ลายเซ็นปฏิเสธสลิปที่ `apps/api/src/modules/reimbursements/application/use-cases/reimbursement-claim-signature.use-case.ts:250-251`) และผูกซ้ำไม่ได้ (`findAttachmentLinkConflict` — `apps/api/src/modules/data-model-core/domain/logic/attachment.logic.ts:83`) — ไฟล์ชนิดใหม่ที่มีเลขบัญชีต้องได้รั้วเดียวกัน (§5.7)
- **ช่องโหว่วันนี้ (B4)**: การตรวจใบเสร็จของใบเบิก (`apps/api/src/modules/reimbursements/application/services/reimbursement-evidence.service.ts:37-43`) และตัวเลือกไฟล์ในร่างใบเบิกทาง LINE (`line-reimbursement-draft-adapter.service.ts:797-802`) กันเฉพาะสลิปใบเบิก — **ไฟล์ของใบเตรียมจ่าย (สลิป/ไฟล์ประกอบ) ไม่ถูกกัน** ทั้งที่การผูกเข้ารายจ่ายตอนอนุมัติปฏิเสธไฟล์เหล่านี้ (`attachment.logic.ts:97-98`, `prisma-reimbursement.repository.ts:2388-2391`)

### 1.8 คู่แข่ง

- FlowAccount × กสิกร (บทความ 15 ต.ค. 2569): จ่ายผู้ขายผ่าน K-Cash Connect Plus สถานะอัปเดต "ภายใน 1 ชั่วโมง" Bank Feed วันละครั้งเป็นข้อมูลเมื่อวาน **[ยืนยันเอง]** https://flowaccount.com/blog/?p=27480 · เฉพาะแพ็ก Pro Business การอนุมัติและจ่ายจริงทำใน KCC+ ค่าธรรมเนียมตามกสิกร สมัคร KCC+ แยก **[ยืนยันเอง]** https://flowaccount.com/our-integrations/kbank

## 2. เป้าหมาย

1. ผู้บันทึกจ่ายรวม **ใบเตรียมจ่ายที่อนุมัติแล้ว** และ **ใบเบิกรอจ่าย** หลายใบเป็น "ชุดโอน" ได้ ทั้งที่ 390 px, 1280 px และจอกว้าง (≥1536 px)
2. มือถือ: คัดลอกเลขบัญชีทีละรายการ (endpoint เปิดเลขเดิม audit เดิม) แล้วบันทึกจ่ายผ่านฟอร์มเดิมของแต่ละใบ
3. คอมพิวเตอร์: ดาวน์โหลดแผ่นงานหนึ่งไฟล์ที่มีเฉพาะข้อมูลที่ต้องใช้โอน แล้วบันทึกผลทีละรอบด้วยไฟล์ผลจากธนาคาร
4. หนึ่งใบอยู่ในชุดที่ยังเปิดได้ชุดเดียว และเมื่อดาวน์โหลดแผ่นงานแล้ว ใบนั้นถูกแก้/ยกเลิก/จ่ายจากที่อื่นไม่ได้ โดยตรวจใต้ล็อกเดียวกับการจ่าย
5. รายการที่ไม่สำเร็จกลับไปรอจ่ายพร้อมทางแก้ รายการที่สำเร็จเดินทางเดิมทุกอย่าง
6. ทุกแพ็กที่ขาย ผ่าน `expenses` และ `reimbursement` ใน starter ไม่มีสวิตช์

## 3. Non-goals

- สั่งโอนเงินจริง, API ธนาคาร, ดึงรายการเดินบัญชีอัตโนมัติ, Your Data (§5.10)
- **รุ่นนี้ไม่สร้างไฟล์รูปแบบนำเข้าของธนาคารใด** (เป็นการตัดสินใจของผลิตภัณฑ์ ไม่ใช่ข้ออ้างว่าธนาคารไม่รับไฟล์จากโปรแกรมอื่น — ธนาคารกรุงเทพมีคำแนะนำว่าไฟล์ต้องอยู่ในรูปแบบของธนาคารกรุงเทพและส่งออกจากโปรแกรมอื่นได้ **[ผู้ตรวจอ้าง]** https://www.bangkokbank.com/en/Hint/HintBiz/BIZ-%20Batch%20Transfers — ผู้เขียนเปิดแล้วหมดเวลา 24 ต.ค.) รูปแบบนำเข้าเฉพาะธนาคารทำได้เมื่อตรวจกับธนาคารนั้นจริง (Phase 2/3)
- อ่านไฟล์ผลจากธนาคารอัตโนมัติ (Phase 3 ทางเลือก ด้วยตัวอ่านใหม่ — §12 G-9)
- จ่ายเจ้าหนี้การค้า (`procurement` ไม่ขาย), คืนเงินลูกค้า, เงินเดือน
- จ่ายผ่านบริการ e-WHT ของธนาคาร — รายการ e-WHT ไม่เข้าแผ่นงาน (§5.8)
- เก็บเลขบัญชีเต็มของร้าน, ส่ง SMS/อีเมลผู้รับผ่านธนาคาร
- ทำรายการชุดโอนจาก LINE (LINE ตอบวิธีใช้ และแจ้งเตือน/ปฏิเสธตามทางเดิม)
- จ่ายบางส่วน
- รูปแบบเฉพาะของกรุงเทพ กรุงศรีฯ กรุงไทย

## 4. ผู้ใช้และ journey

| ผู้ใช้ | สิทธิ์ที่มีอยู่แล้ว | ทำอะไรในงานนี้ |
|---|---|---|
| เจ้าของร้านทำเองคนเดียว (มือถือ) | ทุกสิทธิ์ | สร้างชุด → คัดลอกเลขบัญชีไปโอนในแอปธนาคาร → บันทึกจ่ายทีละรายการพร้อมสลิป |
| การเงิน | `pack.expense.disbursement.pay` (`expense.disbursement.pay`), `pack.reimbursement.finance` (`reimbursement.payment.record`) (`apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts:312-316`, `:353-357`) | สร้างชุด → ดาวน์โหลดแผ่นงาน → กรอก/คัดลอกลงระบบธนาคาร → บันทึกผล |
| ผู้จัดการ | `pack.reimbursement.approve` มี `reimbursement.payment.record` (`capability-pack.registry.ts:332-344`) | ชุดของใบเบิกเท่านั้น (ค่าเริ่มต้นไม่มีสิทธิ์จ่ายใบเตรียมจ่าย) — ผู้จัดการที่อนุมัติใบเบิกเองก็จ่ายผ่านชุดได้ (§5.7, F8) |
| ผู้เบิก | `pack.reimbursement.self` | ไม่เห็นชุดโอน ได้การแจ้ง "จ่ายแล้ว" เดิม |
| ผู้จัดทำใบเตรียมจ่าย | `expense.disbursement.prepare` | ได้การแจ้ง "จ่ายแล้ว" เดิม (`apps/api/src/modules/expenses/application/services/disbursement-voucher-notice.service.ts:44-45`) |
| นักบัญชี | ดูใบ | เห็นการจ่ายที่อ้างอิงเลขชุด |

**Journey A — การเงิน คอมพิวเตอร์ (8 รายการ)**
1. หน้าใบเตรียมจ่าย (อนุมัติแล้ว รอจ่าย) หรือแท็บรอจ่ายของการเบิกจ่าย → "จ่ายหลายรายการ"
2. ติ๊ก 5 ใบเตรียมจ่าย + 3 ใบเบิก (แถวที่ใช้ไม่ได้บอกเหตุผลพร้อมลิงก์) → วันที่จะโอน → แถบล่าง "สร้างชุดโอน"
3. หน้าชุด "BT-202610-00001" → "ดาวน์โหลดแผ่นงานโอน" → ได้แผ่นงาน สถานะ "ดาวน์โหลดแผ่นงานแล้ว"
4. กรอกหรือคัดลอกลงแม่แบบ/หน้าจอของธนาคาร อนุมัติในธนาคาร ดาวน์โหลดรายงานผล
5. "บันทึกผลจากธนาคาร" → แนบรายงาน → เลือก "สำเร็จ" 7 แถว "ไม่สำเร็จ" 1 แถว → "บันทึกผล"

**Journey A2 — Smart วันทำการถัดไป**: วันแรกบันทึก 5 แถวที่รู้ผล อีก 3 แถว "ยังไม่ทราบผล" คงรอ → วันรุ่งขึ้นบันทึกต่อ

**Journey B — เจ้าของร้านบนมือถือ (3 รายการ)**: สร้างชุด → "คัดลอกเลขบัญชี" → โอนในแอป → "บันทึกจ่าย" (ฟอร์มเดิม แนบสลิปได้) → ครบแล้วชุดปิดเองโดยไม่ต้องดาวน์โหลด

**Journey C — โอนไม่สำเร็จ**: แถวใบเบิกบัญชีปิด → "ไม่สำเร็จ" → ใบเบิกกลับไปรอจ่าย → "ส่งกลับให้แก้บัญชี" ทางเดิม (`RequestPayoutCorrectionUseCase`, `reimbursement-payout-correction.use-case.ts:33`)

**Journey D — ผู้เบิกกดยกเลิกใบเบิกระหว่างที่แผ่นงานออกไปแล้ว**: ถูกปฏิเสธพร้อมชื่อคนที่ติดต่อได้ (§10.6)

**LINE**
- ผู้เบิก/ผู้จัดทำได้การแจ้ง "จ่ายแล้ว" เดิม (`reimbursementPaidNotice`, `packages/contracts/src/reimbursements.ts:375-384` — ไม่มีประโยคสลิปเมื่อไม่มีสลิป `:383`)
- ผู้บันทึกจ่ายถาม "โอนให้หลายคนพร้อมกันได้ไหม" → การ์ดวิธีใช้ปุ่มเดียวเปิดคู่มือหัวข้อนี้ (§10.5)
- คำสั่ง VOUCHER_PAY / VOUCHER_CANCEL / จ่ายใบเบิกทาง LINE ของใบที่ถูกล็อก → ข้อความ §10.6 + ปุ่ม "เปิดชุดโอน" เมื่อผู้ใช้เปิดชุดได้ (§7.5)

## 5. กติกาและข้อยกเว้น

### 5.1 รายการที่เข้าชุดได้

ตรวจฝั่ง API ตอนแสดงตัวเลือก ตอนเพิ่ม และใต้ล็อกตอนดาวน์โหลดครั้งแรก ข้อความจาก contracts จุดเดียว

**ใบเตรียมจ่าย** (`DISBURSEMENT_VOUCHER`)
- สถานะ `APPROVED`, ผู้ใช้มี `expense.disbursement.pay`, อ่านใบได้ตามสาขา (`apps/api/src/modules/expenses/infrastructure/prisma-disbursement-voucher.repository.ts:117-118`)
- ผ่านการตรวจก่อนจ่ายเดิม: `DisbursementVoucherUseCase.previewLineAction(ctx, 'pay', …)` (`disbursement-voucher.use-case.ts:135-157`) — ไม่ต้องมีสลิปอยู่แล้ว
- มีบัญชีผู้รับ, วิธีจ่ายที่ตั้งไว้ `BANK_TRANSFER` หรือว่าง, ชื่อธนาคาร/ชื่อบัญชี/ชื่อผู้รับที่บันทึกไว้ **ผ่านกติกาชื่อ** (ไม่ดูเหมือนเลขบัญชี `looksLikeAccountNumber`, ชื่อธนาคาร ≤80, ชื่อบัญชี ≤140) — ตรวจข้อมูลที่บันทึกแล้วด้วย ไม่ใช่เฉพาะตอนพิมพ์ (F12)
- ไม่มีรายจ่ายใน `whtRemittance = 'E_WHT'` (เมื่อ spec e-WHT ลงแล้ว)
- ยอด = `totalAmount` (2 ตำแหน่งอยู่แล้ว `disbursement-voucher.use-case.ts:91`)

**ใบเบิก** (`REIMBURSEMENT_CLAIM`)
- ผู้ใช้มี `reimbursement.payment.record` และอยู่ในสาขา (`reimbursement-finance.use-case.ts:405`)
- ผ่าน **การตรวจความพร้อมจ่ายแบบยังไม่มีหลักฐาน** (§7.3 `evidence: 'deferred'`): กติกาเดิมทั้งหมดของ `RecordReimbursementPaymentUseCase` (สถานะ `PAYMENT_RECORDING_STATUSES` `reimbursement.logic.ts:772`, finance review, รายการซ้ำ, ยกเลิกค้าง, รอบแก้บัญชี, สาขา, งวดบัญชี, บัญชีในใบ) **ยกเว้น** สลิป/อ้างอิง — เพราะ preview เดิมเรียก `validatePaymentRecording` ด้วย `hasSlip: Boolean(input.slipAttachmentId)` (`:463`) ก่อนถึง `if (line.previewOnly) return` (`:490`) จึงปฏิเสธทุกใบที่โอนโดยไม่มีสลิป (F7)
- วิธีรับเงินคืน `BANK_TRANSFER` และใบมีบัญชีของตัวเอง (ใบ legacy ให้จ่ายจากหน้าใบ)
- THB, ยอด = `outstandingAmount` ปัดครึ่งขึ้น 2 ตำแหน่ง (580.0042 → 580.00 อยู่ในค่าคลาดเคลื่อนครึ่งสตางค์ `reimbursement.logic.ts:852-860`)

**ทั้งสองชนิด**: ไม่อยู่ในชุดอื่นที่ยังเปิด · ไม่เกิน **100 รายการต่อชุด** · รายการนอกสาขาไม่แสดง

| เหตุผล (`reason.code`) | เงื่อนไข | ข้อความ | ทางออก |
|---|---|---|---|
| `no_account` | ใบเตรียมจ่ายไม่มีบัญชีผู้รับ | ยังไม่มีบัญชีผู้รับ | ลิงก์ "เปิดใบนี้" |
| `account_name_invalid` | ชื่อธนาคาร/ชื่อบัญชี/ชื่อผู้รับที่บันทึกไว้ดูเหมือนมีเลขบัญชีหรือยาวเกิน | ชื่อบัญชีในใบนี้ต้องแก้ก่อน | ลิงก์ "เปิดใบนี้" (กลับไปแก้ตามทางเดิม) |
| `planned_cash` | ใบเตรียมจ่ายตั้งวิธีอื่นที่ไม่ใช่โอน | ใบนี้ตั้งจ่ายแบบอื่นที่ไม่ใช่โอน | ลิงก์ "เปิดใบนี้" |
| `cash_claim` | ผู้เบิกขอรับเงินแบบอื่น | ผู้เบิกขอรับเงินแบบอื่นที่ไม่ใช่โอน | ลิงก์ "เปิดใบเบิก" |
| `legacy_claim` | ใบเบิกไม่มีบัญชีของใบ | ใบเบิกนี้ส่งก่อนมีบัญชีรับเงิน จ่ายจากหน้าใบเบิก | ลิงก์ "เปิดใบเบิก" |
| `foreign_currency` | ไม่ใช่ THB | ใบนี้เป็นเงินสกุลอื่น จ่ายจากหน้าใบนี้ | ลิงก์ "เปิดใบนี้" |
| `in_other_batch` | อยู่ในชุดที่ยังเปิด | อยู่ในชุดโอน {เลขชุด} ของ {ชื่อผู้สร้าง} แล้ว | ลิงก์ "เปิดชุดนั้น" เมื่อผู้ดูเปิดได้ |
| `bank_not_supported` | (Phase 2) รูปแบบธนาคารเฉพาะ + ธนาคารไม่อยู่ในตารางที่ตรวจแล้ว | ธนาคารนี้ใส่ในรูปแบบ {ชื่อรูปแบบ} ไม่ได้ | ปุ่ม "ใช้แผ่นงานทุกธนาคาร" |
| `ewht` | มีรายการ `E_WHT` | รายการนี้หักภาษีผ่าน e-WHT จ่ายผ่านบริการ e-WHT ของธนาคาร | ลิงก์ "เปิดใบนี้" |
| `not_payable` | การตรวจเดิมปฏิเสธ | ข้อความของการตรวจเดิมจาก contracts | ลิงก์ "เปิดใบนี้" |

### 5.2 เงิน

- **ยอดชุด** = Σ รายการ `PENDING` + `PAID` (สิ่งที่ชุดนี้จ่ายหรือกำลังจ่าย)
- **ยอดในแผ่นงาน** (`exportTotalAmount`) = Σ รายการที่ `PENDING` ณ ตอนดาวน์โหลดครั้งแรก ตรึงไว้ (F4) — รายการที่จ่ายทางมือถือไปแล้วก่อนดาวน์โหลดไม่อยู่ในแผ่นงาน หน้าจอแสดง "ยอดในแผ่นงาน" เฉพาะเมื่อไม่เท่ายอดชุด (กติกา "ตัวเลขแสดงครั้งเดียว" `docs/guidelines/thai-ux-standard.md:80`)
- ยอดโอน = ยอดสุทธิหลังหักภาษี (§1.6) แถวที่มีรายจ่ายหักภาษีได้ป้าย "หักภาษีแล้ว" และแผ่นสรุปมีบรรทัดเตือน
- ค่าธรรมเนียมเป็นของร้าน (Phase 2 ตั้ง `OUR`) เพื่อให้ยอดที่ผู้รับได้เท่ายอดที่บันทึก
- วันที่จ่ายที่บันทึก = วันที่ธนาคารโอน: ไม่เกินวันนี้ (ใบเบิก `isFuturePaymentDate` `reimbursement-finance.use-case.ts:445`; ใบเตรียมจ่าย `expense_payment_future_date` `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts:545`) และไม่ก่อนวันดาวน์โหลดครั้งแรก
- **งวดบัญชีที่ปิดแล้ว (F1 รอบ 3)** — พฤติกรรมวันนี้ไม่เท่ากันและไม่เป็นอะตอมกับการปิดงวด:
  - ใบเบิก: ตรวจงวดก่อนธุรกรรมเท่านั้น (`assertClaimPaymentReady` `reimbursement-finance.use-case.ts:475` → `assertPaymentPeriodOpen` `prisma-reimbursement.repository.ts:3593`, `:3602-3610`) คอมเมนต์ในโค้ดยอมรับว่า "A check before the write, not a lock: the period close holds none either" (`:3596-3601`)
  - ใบเตรียมจ่าย/การจ่ายรายจ่าย: **ไม่ตรวจงวดเลย** ในธุรกรรมการจ่าย (`recordPaymentInTransaction` `prisma-expense.repository.ts:670-723` มีแค่ `assertExpensePaymentSource` วันในอนาคต) — บันทึก B5
  - ชุดโอนใช้กติกาของต้นทางแต่ละชนิด และ (Phase 0.4) เพิ่มการตรวจงวดให้การจ่ายรายจ่าย **ภายในธุรกรรมการจ่าย** ทั้งสองชนิด; ขอบเขตอะตอมกับการปิดงวดต้องให้คำสั่งปิดงวดถือล็อกร่วม ซึ่งเป็นงานของสเปกปิดงวด (สมุดบัญชีไม่ได้ขาย) → §12.1 M8
- วันที่จะโอน: วันนี้ถึง 30 วันข้างหน้า (Asia/Bangkok) ใช้แสดงในแผ่นงานเท่านั้น

### 5.3 ธนาคาร รหัส และช่องทาง

- แผ่นงานทุกธนาคาร: ชื่อธนาคารตามที่บันทึก ไม่มีคอลัมน์รหัส
- แหล่งรหัส 3 หลักหลัก: ตารางรหัสสมาชิกธนาคารที่กสิกรเผยแพร่ (ฉบับ 2026-06-23) https://apiportal.kasikornbank.com/bucket/SiteCollectionDocuments/assets/page/apiproducts/corporate-fund-transfer/BankCode-CorpAPI.pdf มีครบ 002 กรุงเทพ, 004 กสิกรไทย, 006 กรุงไทย, 014 ไทยพาณิชย์, 025 กรุงศรีฯ **[ผู้ตรวจอ้าง; ผู้ประสานงานยืนยันว่าเปิดได้ — ผู้เขียนอ่าน PDF ไม่ได้]** — ยังต้องเทียบกับรายการธนาคารในแม่แบบ SCB จริง (G-3)
- Phase 2: `THAI_BANK_CODES` เฉพาะธนาคารที่ตรงกับรายการในแม่แบบจริง (G-3); ช่องทาง SCB→SCB / พร้อมเพย์ / ต่างธนาคาร ORFT (ค่าเริ่มต้น) หรือ Smart วันทำการถัดไป

### 5.4 เนื้อหาแผ่นงาน (ข้อมูลเท่าที่จำเป็น)

**แผ่นงานรายการโอน ทุกธนาคาร (`GENERIC_XLSX`, Phase 1)** — เป็น **แผ่นงานสำหรับกรอกหรือคัดลอกลงแม่แบบ/หน้าจอของธนาคาร ไม่ใช่ไฟล์นำเข้าของธนาคารใด** (F15) สร้างด้วย `buildWorkbook` (`apps/api/src/common/export/xlsx.logic.ts:192`) ข้อความเป็น inline string เลขขึ้นต้นด้วย 0 ไม่หาย

แผ่น "รายการโอน" (เฉพาะรายการที่ตรึงในการดาวน์โหลดครั้งแรก เรียงตาม `exportPosition`):

| คอลัมน์ | ค่า |
|---|---|
| ลำดับ | `exportPosition` |
| ชื่อบัญชีผู้รับ | ใบเบิก: `accountName` ของบัญชีในใบ · ใบเตรียมจ่าย: `payeeAccountName` ถ้าไม่ว่าง ไม่งั้น `payeeName` (ผ่านกติกาชื่อ §5.1 แล้ว) |
| ธนาคาร | ชื่อธนาคาร หรือ "พร้อมเพย์" |
| เลขบัญชี / พร้อมเพย์ | เลขเต็ม (ข้อความ) |
| ยอดโอน (บาท) | ตัวเลข 2 ตำแหน่ง |
| อ้างอิง | เลขเอกสารของเรา (`PV-…` / `RB-…`) |

แผ่น "สรุป": เลขชุด, วันที่จะโอน, จำนวนรายการ, ยอดในแผ่นงาน, และ "ยอดโอนหักภาษี ณ ที่จ่ายไว้แล้วในบางรายการ อย่าหักซ้ำที่ธนาคาร" เมื่อมีแถวหักภาษี

**ไม่ใส่**: เลขผู้เสียภาษี, ที่อยู่, อีเมล, เบอร์โทร (ยกเว้นเบอร์พร้อมเพย์ซึ่งเป็นตัวบัญชี), เหตุผลการเบิก, รายละเอียดรายจ่าย, ชื่อพนักงานที่ไม่ใช่ผู้รับเงิน

ชื่อไฟล์ `{เลขชุด}.xlsx` (ไม่มีชื่อคน)

**SCB Business Anywhere (`SCB_BUSINESS_ANYWHERE`, Phase 2)** — แผ่นละช่องทาง (SCB→SCB, ORFT/Smart, พร้อมเพย์) ตามแม่แบบนำเข้าของ SCB: ธนาคารผู้รับ/พร้อมเพย์, เลขบัญชีหรือหมายเลขพร้อมเพย์, ชื่อผู้รับ, ยอด 2 ตำแหน่ง, อ้างอิง, ค่าธรรมเนียม `OUR`; SMS/อีเมลว่าง; แผ่นสรุปบอกค่าหัวไฟล์ที่ต้องกรอกในแม่แบบ: บัญชีตัดเงิน บัญชีค่าธรรมเนียม วันที่มีผล อ้างอิงชุด และ **รหัสบริษัท: Corporate ID สำหรับลูกค้าที่ย้ายจาก SCB Business Net มิฉะนั้น System Reference ID** (F18) **[ผู้ตรวจอ้าง]** คู่มือ PromptPay import ฉบับ 2026-06-26 https://www.scb.co.th/getmedia/ccc95101-9391-42ed-b954-d445a5bd1afb/transfer-importfile-promptpay.pdf — ลำดับคอลัมน์และรหัสบริษัทต้องตรวจกับแม่แบบจริงและคู่มือนี้อีกครั้งก่อนลงมือ (G-1)

ไม่เก็บไฟล์ ส่งด้วย `Cache-Control: no-store`

### 5.5 กันซ้ำ การตรึง และการล็อก (F2, F3, F4, F9, F10)

**หนึ่งใบหนึ่งชุดที่ยังเปิด**: `PaymentBatchItem.openSourceKey` = `{sourceType}:{sourceId}` ขณะ `PENDING` unique ต่อบริษัท (แบบ `DisbursementVoucherLine.coversPaymentId` `schema.prisma:2892-2894`)

**ล็อกของต้นทาง (ใช้ตัวเดิมเท่านั้น)**
- ใบเตรียมจ่าย: advisory `${companyId}:${voucherId}:disbursement-voucher-lifecycle` ที่ทุกคำสั่งของใบใช้ (`prisma-disbursement-voucher.repository.ts:285` ใน `lifecycleAtomic`, `:222` ใน `attachSlipAtomic`)
- ใบเบิก: advisory `${companyId}:${requestId}:reimbursement-payment` แล้ว `lockRequest` = `${companyId}:${requestId}:reimbursement-request` ตามลำดับเดียวกับการจ่าย (`prisma-reimbursement.repository.ts:3644-3645`, `:1674-1676`) ซึ่งคำสั่งอื่นของใบเบิก (ยกเลิก แก้บัญชี ฯลฯ) ใช้ `lockRequest` อยู่แล้ว
- ล็อกของชุด: advisory `${companyId}:${batchId}:payment-batch`
- **ลำดับล็อกเดียวทุกทาง (F2)**: ① advisory ของชุด (เฉพาะคำสั่งระดับชุด: สร้าง/เพิ่ม/นำออก/อัปเดต/ดาวน์โหลด/รอบบันทึกผล/ยกเลิก/ปิด) → ② advisory ของต้นทาง เรียง key → ③ แถว `PaymentBatch` `FOR UPDATE` → ④ แถว `PaymentBatchItem` `FOR UPDATE` เรียง `id` · ข้ามขั้นได้แต่ห้ามย้อน
  - **ระดับ isolation ต่างกัน (F3 รอบ 3)**: ธุรกรรมการจ่ายใบเตรียมจ่ายเป็น `ReadCommitted` (`prisma-disbursement-voucher.repository.ts:308`) แต่ธุรกรรมการจ่ายใบเบิกเป็น `Serializable` (`prisma-reimbursement.repository.ts:3828`) ซึ่งเห็นข้อมูลชุดเดียวทั้งธุรกรรม — การรอล็อกแถวแล้วอ่านใหม่ **ไม่ได้** เห็นข้อมูลที่ commit ทีหลัง และการชนกันกลายเป็น 409 `reimbursement_payment_state_changed` (`:149-151`)
  - ผลต่อการตรึง: ธุรกรรมใบเบิกที่เริ่ม (ได้ snapshot) ก่อนการดาวน์โหลดครั้งแรก commit อาจอ่านสถานะชุดเป็น DRAFT แม้รอล็อกต้นทางแล้ว — ความปลอดภัยจึงมาจากข้อนี้: การดาวน์โหลดเขียนทุกแถว item ที่ตรึง และ hook ของทุกทางจ่าย **ต้อง `FOR UPDATE` แถว item เปิดของต้นทางเสมอ** → แถวถูกแก้หลัง snapshot → serialization failure → การจ่ายทั้งธุรกรรม rollback (ไม่มีการจ่ายหลุด) → ผู้ใช้กดใหม่แล้วได้ข้อความล็อก §10.6 ตามปกติ
  - จึงกำหนด: hook ในธุรกรรมการจ่าย (ทั้งสองชนิด, ถือ ② อยู่แล้ว) **แตะเฉพาะแถว item ของตัวเอง** (④ `FOR UPDATE`, CAS `PENDING` → `PAID`) **ไม่แตะแถวชุดและไม่นับ PENDING** — การจ่ายสองรายการในชุดเดียวจึงไม่เขียนแถวร่วมกัน
  - การปิดชุดย้ายไปที่ `closeBatchIfDone` = ธุรกรรมสั้น `ReadCommitted` แยก: ① → ③ → นับ PENDING → `CLOSED` + ลบ ciphertext ตรึง; idempotent; เรียกหลังทุกการตัดสินที่ commit แล้ว (ตัววนผล, ทางจ่ายจากหน้าใบหลังสำเร็จ, นำออก/ปิด) และเรียกซ่อมเมื่อเปิดอ่านชุด (กรณีล่มระหว่าง commit กับการปิด)
  - ถ้ายังชน (เช่น การนำออก commit ก่อนแล้วธุรกรรม `Serializable` ของใบเบิก `FOR UPDATE` แถวเดียวกัน) ได้ serialization failure → 409: ตัววนผลของชุด **ลองทั้งธุรกรรมใหม่ไม่เกิน 3 ครั้ง** ด้วย key เดิม (`bt:{batchId}:{itemId}` จึงไม่จ่ายซ้ำ) แล้วจึงบันทึกเป็น refusal; ทางจ่ายปกติจากหน้าใบคงพฤติกรรมเดิม (409 ให้ผู้ใช้กดใหม่)
  - คำสั่ง DRAFT (เพิ่ม/นำออก/อัปเดต/ยกเลิก/ปิด): ① → ③ (CAS `version`) → ④ — ไม่ต้องล็อกต้นทาง; การนำออกกับการจ่ายของรายการเดียวกันชนกันที่ ④ ทางที่สองเห็นว่าไม่ `PENDING` แล้ว (นำออก → "รายการนี้บันทึกจ่ายแล้ว"; hook ทั่วไป → ไม่ทำอะไร; hook ของชุด → การจ่าย rollback)
  - ดาวน์โหลดครั้งแรก/ยกเลิก FILE_READY: ① → ② ทุกต้นทาง → ③ → ④
  - ทางเดิมของต้นทางไม่เคยขอ ① จึงไม่มีวงล็อก

**ดาวน์โหลดครั้งแรก (DRAFT → FILE_READY) ในธุรกรรมเดียว**: ล็อกชุด → ล็อกต้นทางของทุกรายการ `PENDING` → อ่านต้นทางใหม่และเทียบ `sourceVersion` (ลายนิ้วมือของข้อมูลการจ่าย ไม่ใช่ `version` ดิบ — ดูข้างล่าง) → ตรวจสิทธิ์ (§5.7) → เขียน audit ในธุรกรรม → ถอดรหัสเลขจากต้นทางแล้ว **เข้ารหัสใหม่เก็บในรายการ** (`exportAccountCiphertext`) พร้อมค่าตรึง (`exportPayeeName`, `exportBankName`, `exportAmount`, `exportReference`, `exportPosition`, `exportedAt`) → ตั้ง `exportItemCount`, `exportTotalAmount`, `exportDigestSha256` (SHA-256 ของแถวตรึงแบบ canonical) → FILE_READY → commit แล้วจึงสร้างไฟล์จากค่าตรึง
- ทางจ่ายปกติที่ได้ล็อกต้นทางก่อน จะ commit ก่อน แล้วการดาวน์โหลดเห็นว่าต้นทางจ่ายแล้ว → รายการนั้นเป็น `PAID` แล้ว (hook) ไม่เข้าแผ่นงาน; ทางที่มาทีหลังเห็น FILE_READY ใต้ล็อกต้นทาง → ถูกปฏิเสธ (F3)

**`sourceVersion` (F9)**: ใบเตรียมจ่าย = SHA-256 ของ {status, totalAmount, บรรทัด (expenseId, amount), payeeName, payeeBankName, payeeAccountName, last4, SHA-256 ของ ciphertext} — `attachSlipAtomic` เพิ่ม `version` (`prisma-disbursement-voucher.repository.ts:239`) แต่ไม่เปลี่ยนลายนิ้วมือนี้ จึงแนบสลิปให้ใบที่อยู่ในชุดได้โดยไม่ทำให้รายการเสีย · ใบเบิก = {status, outstandingAmount, payoutDestinationVersion, payoutFingerprint} · การจ่ายผ่านชุดอ่าน `version` ปัจจุบันของใบเตรียมจ่ายก่อนเรียก `pay` และ `pay` ตรวจลายนิ้วมือนี้ใต้ล็อกอีกครั้ง

**ระหว่าง FILE_READY**: ใบในชุดถูกปฏิเสธ (ตรวจ **ภายในธุรกรรมของคำสั่งนั้น หลังได้ล็อกต้นทาง**) เมื่อ
- ใบเตรียมจ่าย: `pay` จากหน้าใบ, `withdraw`, `return`, `cancel` (`disbursement-voucher.use-case.ts:561-698`, `:731`) — เว็บและ LINE
- ใบเบิก: บันทึกจ่ายจากหน้าใบ (`recordPaymentAtomic` หลัง `:3645`), ส่งกลับให้แก้บัญชี, ยกเลิก (`CancelReimbursementUseCase` `reimbursement-request.use-case.ts:1076` — ในเมธอด repository ที่ถือ `lockRequest`)
- ยกเว้นคำสั่งของการบันทึกผลชุดนั้น (ระบุ `itemId`)
- การแนบสลิปให้ใบเตรียมจ่ายยังทำได้ (ไม่กระทบลายนิ้วมือ)

**DRAFT**: ไม่ล็อกใบ รายการที่ต้นทางเปลี่ยนขึ้น "ใช้ไม่ได้แล้ว"/"ข้อมูลเปลี่ยน" และดาวน์โหลดถูกปฏิเสธจนกด "นำรายการที่ใช้ไม่ได้ออก" / "ใช้ข้อมูลล่าสุด"

**ดาวน์โหลดซ้ำ (FILE_READY)**: สร้างจากค่าตรึงเท่านั้น (ไม่อ่านต้นทาง) จึงได้แถวเดิมทุกตัว แม้ใบเตรียมจ่ายที่ "ไม่สำเร็จ" ถูกแก้บัญชีไปแล้ว (F10) ตรวจ `exportDigestSha256` ก่อนส่ง เตือนหนึ่งประโยคทุกครั้ง ไม่มีแผ่นงาน "เฉพาะที่เหลือ" — รายการไม่สำเร็จให้สร้างชุดใหม่ · ค่าตรึงที่เข้ารหัสถูกลบ (`NULL`) ทันทีที่ชุดเป็น `CLOSED`/`CANCELLED` ในธุรกรรมเดียวกัน

ผู้รับซ้ำในชุด (ชื่อบัญชีที่ปรับรูปแบบด้วย `normalizeVendorName` ตรงกัน) ไม่บล็อก ขึ้นป้าย "ผู้รับซ้ำในชุดนี้"

ระบบกันการบันทึกซ้ำได้ แต่กันคนส่งรายการเดียวกันสองครั้งที่ธนาคารไม่ได้ (คำเตือนตอนดาวน์โหลดซ้ำบอกเรื่องนี้)

### 5.6 บันทึกผล และความล้มเหลวบางส่วน (F2, F6, F11, F14)

- **ทางมือถือ (DRAFT)**: "บันทึกจ่าย" ต่อแถวเปิดฟอร์มเดิมของใบ (สลิปใบเบิกยังบังคับตาม D3) การจ่ายที่สำเร็จทำให้รายการ `PAID` ในธุรกรรมเดียวกับการจ่าย (hook §7.4)
- **ทางแผ่นงาน (FILE_READY)**: "บันทึกผลจากธนาคาร" รับ วันที่ธนาคารโอน + **ไฟล์ผลจากธนาคาร** (บังคับต่อรอบ, PDF/PNG/JPEG ≤10 MB — `apps/api/src/modules/reimbursements/domain/reimbursement.constants.ts:28`, `packages/contracts/src/reimbursements.ts:265`) + ผลต่อแถว **สามสถานะ: ยังไม่ทราบผล (ค่าเริ่มต้น) / สำเร็จ / ไม่สำเร็จ** ส่งเฉพาะแถวที่เลือกผลแล้ว (F14)
- **รอบบันทึกผล**: เริ่มด้วยธุรกรรมสั้น (ล็อกชุด → CAS `version` → ตั้ง `resultsRunCommandId`, `resultsRunStartedAt`) อีกคนที่เริ่มรอบระหว่างนั้น (≤10 นาที) ได้ 409 "มีคนกำลังบันทึกผลชุดนี้" — ความถูกต้องไม่พึ่ง lease นี้ เพราะการตัดสินต่อแถวด้านล่างทำใต้ล็อกต้นทาง
- **ต่อแถว "สำเร็จ"** = ธุรกรรมการจ่ายเดิมของใบ (หนึ่งแถวหนึ่งธุรกรรม):
  - ใบเตรียมจ่าย: `pay(ctx, id, { commandId: 'bt:{batchId}:{itemId}', expectedVersion: version ปัจจุบัน, paidDate, paymentMethod: 'BANK_TRANSFER', paidFromRef: 'ชุดโอน {เลขชุด}' }, false, { paymentBatchItem: { batchId, itemId } })`
  - ใบเบิก: `execute(ctx, id, { idempotencyKey: 'bt:{batchId}:{itemId}', paidAmount: exportAmount, paymentMethod: 'BANK_TRANSFER', paidAt, paymentReference: เลขชุด, payoutDestinationVersion, payoutConfirmed: true }, { paymentBatchItem: { batchId, itemId, resultAttachmentId, resultsCommandId } })` — **preflight ของ use-case ต้องปรับด้วย (F1 รอบ 2)**: ที่ `reimbursement-finance.use-case.ts:463` ใช้ `hasSlip: Boolean(input.slipAttachmentId) || batchEvidencePreflightOk` โดย `batchEvidencePreflightOk` = อ่านอย่างเดียว (รายการเป็นของชุดนี้และต้นทางนี้ `PENDING`, ชุด `FILE_READY`, ไฟล์ผลผูกกับชุดและ ACTIVE) (`assertPaymentSlipUsable` `:483-488` ทำงานเฉพาะเมื่อมีสลิปอยู่แล้ว) — เป็นเพียงการปฏิเสธล่วงหน้าแบบสุภาพ ข้อตัดสินจริงอยู่ข้างล่าง → `recordPaymentAtomic` รับ `batchEvidence` และ **ตรวจใต้ล็อกการจ่าย**: แถว item `FOR UPDATE` เป็นของชุดนี้ ต้นทางตรง `PENDING` ชุด `FILE_READY` และไฟล์ผลผูกกับชุดนี้ด้วย purpose ผลธนาคารและยัง ACTIVE → `hasSlip = Boolean(slip) || batchEvidenceVerified` (แทนบรรทัด `:3706`) (F6, เมื่อ Q2 = ใช่) · การจ่ายเก็บ `ReimbursementPayment.paymentBatchItemId` (คอลัมน์ใหม่) และ `isSamePaymentRequest` เทียบค่านี้ด้วย
  - **ที่มาของหลักฐานต่อรายการ (F4 รอบ 2)**: ทุกรายการที่ได้ผล (`PAID`/`FAILED`) เก็บ `resultAttachmentId` (ไฟล์ผลของรอบนั้น) และ `resultsCommandId` (คำสั่งรอบบันทึกผล) ในธุรกรรมเดียวกับการตัดสิน — ชุดที่บันทึกผลหลายรอบจึงบอกได้ว่าการจ่ายใดอ้างไฟล์ใด; การจ่ายใบเบิกชี้กลับผ่าน `paymentBatchItemId`, การจ่ายใบเตรียมจ่ายผ่าน `paymentRecordId` ของรายการ
  - hook ในธุรกรรมเดียวกัน (เฉพาะ ④): รายการต้องยัง `PENDING` — ถ้าไม่ใช่ (มีคนบันทึก "ไม่สำเร็จ" ไปแล้ว) **โยนข้อผิดพลาด การจ่ายถูก rollback**; ปิดชุดภายหลังด้วย `closeBatchIfDone`
- **ต่อแถว "ไม่สำเร็จ"** = ธุรกรรมที่ขอล็อกต้นทางเดียวกัน → รายการ `FOR UPDATE` ต้อง `PENDING` และยังไม่มีการจ่ายด้วย key `bt:{batchId}:{itemId}` → `FAILED` (+ เหตุผล ≤200 ไม่มีเลขบัญชี) ปลดล็อกใบ ใบกลับไปรอจ่ายตามสถานะเดิม — ทั้งสองทางชนกันที่ล็อกต้นทาง+แถวเดียวกัน ทางที่มาทีหลังได้ "รายการนี้บันทึกผลไปแล้ว"
- แถวที่ use-case เดิมปฏิเสธ: คง `PENDING` บันทึก `lastRefusalCode`, `lastRefusalMessage`, `lastAttemptAt` แสดงพร้อม "ลองอีกครั้ง"/"เปิดรายการ"
- **คำสั่งซ้ำ**: คำสั่งที่เปลี่ยนข้อมูล (สร้าง/เพิ่ม/นำออก/อัปเดต/รอบบันทึกผล/ยกเลิก/ปิด) เก็บใน `PaymentBatchCommand` (commandId, operation, payloadFingerprint, resultJson) — ส่งซ้ำด้วยคำสั่งเดิม+ข้อมูลเดิม ได้ผลเดิมแม้ `version` เดินไปแล้ว; ข้อมูลต่าง → 409 `payment_batch_command_conflict`; รอบบันทึกผลที่ค้างกลางทาง (ยังไม่มี `resultJson`) ส่งซ้ำแล้วทำต่อเฉพาะแถวที่ยัง `PENDING` ด้วย key ต่อแถวเดิม
- **การดาวน์โหลดไม่ใช่ replay (F5 รอบ 2)**: คำสั่ง `download` บันทึกเฉพาะ "การตรึง" (resultJson = `{ exportDigestSha256, firstFileDownloadedAt }`) ไม่บันทึกไบต์ไฟล์ · ส่งคำสั่งดาวน์โหลดเดิมซ้ำ หรือกดดาวน์โหลดอีกครั้ง = สร้างไฟล์ใหม่จากค่าตรึง **เฉพาะขณะชุดเป็น `FILE_READY`** · หลังชุด `CLOSED`/`CANCELLED` (ciphertext ตรึงถูกลบแล้ว) ทุกการดาวน์โหลดได้ 409 `payment_batch_file_unavailable` พร้อมทางออก "ดูผลของแต่ละรายการในชุดนี้" — ไม่อ้างว่าได้ไฟล์เดิม
- ไม่มีแถว `PENDING` เหลือ → `CLOSED` ผ่าน `closeBatchIfDone` (ธุรกรรมแยกหลัง commit)
- แก้ผลที่บันทึกผิด: "สำเร็จ" ผิด → ยกเลิกการจ่ายที่ใบตามทางเดิม รายการแสดง "การจ่ายถูกยกเลิกภายหลัง"; "ไม่สำเร็จ" ผิด → ใบกลับไปรอจ่ายแล้ว บันทึกจ่ายที่หน้าใบได้
- ยกเลิก/ปิดชุด (F8 รอบ 2): **มีแต่รายการที่ยังไม่จ่ายที่ออกจากชุด การจ่ายที่บันทึกแล้วคงอยู่เสมอ**
  - DRAFT ไม่มี `PAID`: "ยกเลิกชุด" → `CANCELLED` รายการ `PENDING` → `DROPPED`
  - DRAFT มี `PAID` แล้ว (จ่ายทางมือถือไปบางรายการ): ปุ่มเป็น "ปิดชุด" → รายการ `PENDING` → `DROPPED` และชุด → `CLOSED`
  - FILE_READY: ยกเลิกได้เมื่อไม่มี `PAID` + ติ๊ก "ธนาคารไม่ได้ทำรายการจากแผ่นงานนี้" + เหตุผล (ลำดับล็อก ① → ② → ③ → ④); มี `PAID` แล้วไม่มีทางลัด — บันทึกผลแถวที่เหลือ (สำเร็จ/ไม่สำเร็จ) เพราะแผ่นงานออกไปที่ธนาคารแล้ว

### 5.7 PDPA การคุมเลขบัญชี และไฟล์ผล (F1, F8, F21)

- ฐานกฎหมาย: พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (ฉบับประกาศใช้) มาตรา 24(3) ปฏิบัติตามสัญญา, มาตรา 22 เก็บเท่าที่จำเป็น, มาตรา 37(1) มาตรการรักษาความปลอดภัย — https://www.mdes.go.th/law/detail/3541-พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล-พ-ศ--๒๕๖๒ **[ผู้ประสานงานอ้าง]** (ผู้เขียนเปิดได้เป็น PDF แต่อ่านข้อความไม่ได้ — เลขมาตราต้องตรวจในตัวบทก่อนอ้างในคู่มือ)
- ตารางชุดเก็บ: ชนิด ชื่อธนาคาร 4 หลักท้าย และ **สำเนาเลขที่เข้ารหัสเฉพาะรายการที่อยู่ในแผ่นงานและเฉพาะขณะชุดยังเปิด** (`exportAccountCiphertext`, `encryptCredential` + `credentialEncryptionKey` เดิม) — ลบเมื่อชุดจบ เพื่อให้ดาวน์โหลดซ้ำได้แถวเดิม (F10)
- **ใครได้เลขเต็ม (F8)**: ตรวจ **อำนาจจ่าย** โดยตรง ไม่อิงชื่อกลุ่มที่ `payoutRevealGroup` คืน — ใบเตรียมจ่าย: `expense.disbursement.pay` + อ่านใบได้; ใบเบิก: `reimbursement.payment.record` + อยู่ในสาขา + ใบมีบัญชีของใบ (ไม่ใช่ legacy ไม่ใช่ร่าง) — ผู้ที่เป็นผู้เบิกหรือผู้อนุมัติของใบนั้นด้วยก็ผ่าน (เช่น เจ้าของร้านที่อนุมัติเอง) audit บันทึกชื่อกลุ่มไว้อ้างอิง ไม่มีสิทธิ์ใหม่ (Q3)
- Audit: ดาวน์โหลดครั้งแรก `payment_batch.file.download` HIGH เขียนในธุรกรรมเดียวกับการตรึง (ล้ม = ไม่ตรึง ไม่มีไฟล์); ดาวน์โหลดซ้ำ `logOrThrow` ก่อนถอดรหัสค่าตรึง (แบบ `reimbursement-payout-reveal.use-case.ts:42-48`); metadata ไม่มีเลขเต็ม; คัดลอกทีละรายการใช้ audit ของ reveal เดิม
- **ไฟล์ผลจากธนาคารได้รั้วเดียวกับสลิป (F1)**: ติดป้ายตอนอัปโหลด `metadataJson.generatedFor = 'payment_batch_result'` + `batchId`; ผูก `targetType = 'payment_batch'`, `purpose = 'payment_batch.bank_result'`; เพิ่ม `isPaymentBatchResultFile(input, tx)` ใน `PrismaAttachmentRepository` และใช้ทุกจุดที่กันสลิปวันนี้:
  - ดาวน์โหลดทั่วไป: ปฏิเสธ (คู่กับ `create-download-url.use-case.ts:79-101` ก่อน `:119`) — เปิดได้ทาง `GET payment-batches/:id/result-files/:attachmentId` หลังตรวจสิทธิ์เปิดชุดเท่านั้น
  - อ่านไบต์/นำไปใช้เป็นไฟล์อื่น: ตัวกรองใหม่ `NOT_PAYMENT_EVIDENCE_WHERE` = สลิปใบเบิก + **ไฟล์ของใบเตรียมจ่าย (ป้าย `DISBURSEMENT_VOUCHER_SLIP_UPLOAD_TAG`/`DISBURSEMENT_VOUCHER_SUPPORTING_UPLOAD_TAG`/`generatedBy: 'disbursement_voucher'` และลิงก์ `disbursement_voucher`)** + ไฟล์ผลชุด ใช้แทน `NOT_REIMBURSEMENT_PAYMENT_SLIP_WHERE` (`prisma-attachment.repository.ts:32-40`) ที่ตัวเลือกไฟล์ร่างใบเบิกทาง LINE (`line-reimbursement-draft-adapter.service.ts:802`)
  - **การตรวจใบเสร็จของใบเบิก** (`reimbursement-evidence.service.ts:37-43`): ปฏิเสธ `invalid_primary_attachment` เมื่อไฟล์เป็นไฟล์ของใบเตรียมจ่ายหรือไฟล์ผลชุด (คู่กับการกันสลิปเดิม) — ไม่ให้ใบเบิกค้างตอนอนุมัติเพราะผูกเข้ารายจ่ายไม่ได้ (B4)
  - ภาพลายเซ็น: ปฏิเสธ (`reimbursement-claim-signature.use-case.ts:250-251`)
  - ผูกซ้ำ: `findAttachmentLinkConflict` (`attachment.logic.ts:83`) ถือ purpose นี้เป็นของชุดเดียว
  - ลบ: `markDeleted` ปฏิเสธ `payment_batch_result_retained` ใต้ล็อก retention เดิม (คู่กับ `prisma-attachment.repository.ts:266-276`)
  - ไม่ผูกเป็นสลิปของใบใด ผู้เบิก/ผู้จัดทำจึงไม่เห็นข้อมูลผู้รับคนอื่น
- ข้อความอิสระทุกช่องใหม่ผ่าน `looksLikeAccountNumber`

### 5.8 ภาษี

- ยอดโอนสุทธิหลังหัก (§5.2); 50 ทวิ/รายการรอออกหนังสือรับรองไม่เปลี่ยน
- **e-WHT**: ธนาคารหักและนำส่งภายใน 4 วันทำการ (กรมสรรพากร ปชส. 5/2564 https://www.rd.go.th/fileadmin/user_upload/news/news5_2564.pdf; อัตรา 1% กฎกระทรวง 402 https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/mr402.docx — ตามที่ backlog ตรวจแล้ว) คำสั่งต้องผ่านบริการ e-WHT ของธนาคารพร้อมยอดก่อนหัก แผ่นงานยอดสุทธิจึงใช้แทนไม่ได้ · spec e-WHT (`docs/specs/e-withholding-tax-payment-spec.md` §6) เพิ่ม `ExpenseRecord.whtRemittance` และให้ใบเตรียมจ่ายที่มีรายการ e-WHT จ่ายแบบโอนได้ — ชุดโอนเพิ่มกติกาเดียว `ewht` (§5.1) · งานใดลงก่อนก็ได้ งานที่ลงทีหลังเติมกติกานี้ · SCB Business Anywhere มีคู่มือ e-WHT แบบกรอกบนเว็บและรายงาน e-WHT **[ยืนยันเอง]** https://www.scb.co.th/th/corporate-banking/digital-banking-services/business-anywhere/manual/transfer.html
- ห้ามแนะนำให้หักซ้ำในบริการของธนาคาร (บรรทัดเตือน §5.4)

### 5.9 ข้อเท็จจริงของธนาคาร และธนาคารที่ทำก่อน

| ธนาคาร | ข้อเท็จจริง | ป้าย |
|---|---|---|
| กสิกรไทย | K BIZ "โอนเงินแบบกลุ่ม" ไม่มีอัปโหลดไฟล์ สูงสุด 10 รายการต่อแม่แบบ (คู่มือ ก.ค. 2567 https://www.kasikornbank.com/sitecollectiondocuments/kbiz/pdf/KBIZ_Manual_GroupTransfer_100_Jul2024.pdf) | **[ต้องมีหลักฐานปัจจุบัน]** (F24) |
| | K-Cash Connect Plus (สมัครแยก): อัปโหลด Text File ที่สร้างจาก "KBank Excel Template"; ชื่อไฟล์ภาษาไทยถูกปฏิเสธ; ผลรายแถวพร้อมเหตุผล https://www.kasikornbank.com/th/Download/Level4_doc/upload-failed.pdf | **[ผู้ช่วยค้นยืนยัน]** |
| | คู่มือของกสิกรบอกขั้น "Download KBank Excel Template" https://www.kasikornbank.com/th/Download/Level4_doc/enable-macro-en.pdf — อาจดาวน์โหลดได้สาธารณะ เส้นทางและรุ่นปัจจุบันยังไม่ยืนยัน | **[ผู้ตรวจอ้าง]** (F19; ผู้เขียนเปิดได้แต่อ่านข้อความไม่ได้) |
| | KCC+ มี PromptPay, เวลาตัดรอบตามบริการ https://www.kasikornbank.com/th/Download/Level4_doc/condition-k-cash-connect-plus.pdf | **[ผู้ช่วยค้นยืนยัน]** |
| | K APi "Corporate Fund Transfer" https://apiportal.kasikornbank.com/product — SME ใช้ได้หรือไม่ | **[ต้องมีหลักฐานปัจจุบัน]** |
| | ส่วนแบ่งตลาด **ยอดสินเชื่อ SME คงค้าง 28% ณ 1Q26** (สูงสุดในระบบ) — เอกสารนำเสนอนักลงทุน 2Q26 (ก.ย. 2569) หน้า 29 https://www.kasikornbank.com/en/IR/PresentationJournal/webcast/KBank_Investor_Presentation_2Q26.pdf | **[ผู้ตรวจอ้าง]** (F9 รอบ 3 — แทนตัวเลข 24% จากข่าว; ไม่ใช่ส่วนแบ่งลูกค้า) |
| ไทยพาณิชย์ | SCB Business Anywhere มีคู่มือ "นำเข้าไฟล์" แยกบริการ: SCB Transfer, ORFT, Smart Credit วันถัดไป, PromptPay, BAHTNET และรายงาน Payment Status / Payment Advice / Debit Advice / e-WHT https://www.scb.co.th/th/corporate-banking/digital-banking-services/business-anywhere/manual/transfer.html | **[ยืนยันเอง]** |
| | ขั้นตอน: ดาวน์โหลด Excel template ในระบบ → Generate Text file → อัปโหลด .txt/.zip https://www.scb.co.th/getmedia/29866ce2-6c90-4dcc-a218-807d6d84d9a0/transfer-uploadfile.pdf | **[ผู้ช่วยค้นยืนยัน]** |
| | แม่แบบ PromptPay ต้องมี Corporate ID (ลูกค้าย้ายจาก Business Net) หรือ System Reference ID (คู่มือ 2026-06-26) | **[ผู้ตรวจอ้าง]** (F18) |
| | ค่าธรรมเนียมตารางปี 2566 https://www.scb.co.th/content/media/corporate-banking/digital-banking-service/new-business-anywhere/business-anywhere-fee-update-2023.png | **[ผู้ช่วยค้นยืนยัน]**, ปัจจุบัน **[ต้องมีหลักฐานปัจจุบัน]** |
| กรุงเทพ | BIZ iBanking สำหรับ SME; Direct Credit อัปโหลดไฟล์ได้; PromptPay Bulk ≤2 ล้านบาทต่อรายการ (https://www.bangkokbank.com/en/business-banking/manage-my-business/payments/direct-credit, …/promptpay-payments) | **[ผู้ช่วยค้นยืนยัน]** |
| | ไฟล์ต้องอยู่ในรูปแบบของธนาคารกรุงเทพ ส่งออกจากโปรแกรมอื่นได้ https://www.bangkokbank.com/en/Hint/HintBiz/BIZ-%20Batch%20Transfers | **[ผู้ตรวจอ้าง]** (F20; ผู้เขียนเปิดแล้วหมดเวลา) |
| กรุงศรีฯ | Krungsri Biz Online โอนเป็นชุดผ่านกลุ่มที่ตั้งไว้ https://www.krungsri.com/getmedia/3dd9e3ff-d20d-41ba-8dc1-1e1765fc11e0/how-to-make-salary-payment.pdf | **[ผู้ช่วยค้นยืนยัน]** |
| | Fund Transfer API สำหรับ "companies" 6 แบบรวม PromptPay https://developers.krungsri.com/usecases/financial-services/fund-transfer | **[ยืนยันเอง]** |
| กรุงไทย | Krungthai BUSINESS อัปโหลดเงินเดือน .xls https://business.krungthai.com/assets/manual/ManualEN%20KTB_Business_Bulk%20Upload.pdf | **[ผู้ช่วยค้นยืนยัน]** |
| ข้ามธนาคาร | ITMX "New Bulk Payment ISO 20022" 32 ธนาคาร 18 ม.ค. 2564 — ข้อความระหว่างธนาคาร https://itmx.co.th/news-and-events/MTY2NjYzMjU4NA== | **[ผู้ช่วยค้นยืนยัน]** |
| | ธปท. ปรับค่าธรรมเนียมรวม "Bulk Payment แบบภายในวัน" มีผลเป็นระยะถึงราว ต.ค. 2569 https://www.bot.or.th/th/news-and-media/news/news-20260602.html · เพดาน ≤20 บาทต่อรายการตามประกาศ 23/2569 https://ratchakitcha.soc.go.th/documents/116907.pdf | **[ยืนยันเอง]** / **[ผู้ช่วยค้นยืนยัน]** — ระบบไม่แสดงตัวเลขค่าธรรมเนียมใด |

**ตัดสิน (ผู้เขียน)**
1. **Phase 1 = แผ่นงานทุกธนาคาร + รายการคัดลอกบนมือถือ** — ใช้ได้กับทุกธนาคารโดยไม่อ้างการอัปโหลดตรง
2. **Phase 2 = SCB Business Anywhere** — เอกสารนำเข้าแยกบริการรวมพร้อมเพย์และรายงานผลรายแถวที่ยืนยันได้มากที่สุด; ตรงกับที่สเปกกระทบยอดเลือก SCB BA เป็นแหล่งรายการเดินบัญชี (`docs/specs/bank-reconciliation-spec.md:573-577`) — ขึ้นกับ G-1
3. **Phase 3 = กสิกร KCC+** — ส่วนแบ่งสินเชื่อ SME สูงสุด (28% ณ 1Q26) และมีตัวอย่าง FlowAccount; ทำเมื่อยืนยันแม่แบบ (เส้นทางสาธารณะหรือจากร้านที่ใช้) และรุ่นปัจจุบันได้ (G-2)
4. กรุงเทพ กรุงศรีฯ กรุงไทย: แผ่นงานทุกธนาคาร

### 5.10 จุดยืนเรื่องดึงรายการเดินบัญชีอัตโนมัติ (bank feed)

**ไม่ทำในงานนี้**
1. Your Data (F7 รอบ 2 — สองเรื่องแยกกัน):
   - **กำหนดเวลา**: ประกาศ ธปท. ที่ 47/2568 (25 ก.ย. 2568) — ข้อมูลเงินฝากบุคคลธรรมดาภายใน 31 ธ.ค. 2569; ข้อมูลเงินฝากของนิติบุคคล SME **ต้องไม่ช้ากว่าวันที่ 31 มีนาคม 2571** (แชร์ข้อมูล ไม่ใช่สั่งจ่าย) https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2568/ThaiPDF/25680236.pdf (backlog ตรวจแล้ว; เลขประกาศ **[ผู้ตรวจอ้าง]**)
   - **หนังสือเวียน 16 เม.ย. 2569**: **ผ่อนผันการแจ้งหรือเปิดเผยบทบาท** ผู้ส่ง/ผู้รับข้อมูลสำหรับนิติบุคคล SME โดยไม่กำหนดวันใหม่ — **ไม่ได้เลื่อนกำหนด 31 มี.ค. 2571** https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2569/ThaiPDF/25690081.pdf **[ผู้ตรวจ/ผู้ประสานงานอ้าง]** (ผู้เขียนอ่าน PDF ไม่ได้)
   - ผล: กำหนดสุดท้ายยังเป็น 31 มี.ค. 2571 แต่วันที่ธนาคาร/ผู้ให้บริการจะเชื่อมต่อได้จริงสำหรับร้านลูกค้าเรายังไม่มีใครยืนยัน — ใช้วางแผนรุ่นนี้ไม่ได้
2. API ธนาคาร (K APi, Krungsri Fund Transfer, developer.scb) ได้มาผ่านสัญญาพันธมิตร (ตัวอย่าง FlowAccount×KBank ต้องสมัคร KCC+ และใช้ได้เฉพาะแพ็กแพงสุดของเขา) — การตัดสินใจทางธุรกิจ (Q4)
3. กระทบยอดธนาคารไม่ได้ขาย; การนำเข้าด้วยมือมีอยู่สำหรับร้านที่เปิด
4. ทบทวนเมื่อ (ก) เจ้าของตกลงเป็นพันธมิตรธนาคาร หรือ (ข) **มีผู้ให้บริการหรือธนาคารที่ยืนยันแล้วว่าส่งข้อมูลเงินฝากนิติบุคคล SME ผ่าน Your Data ให้ซอฟต์แวร์อย่างเราได้จริง** — ไม่ใช่รอกำหนดวัน เพราะกำหนด 31 มี.ค. 2571 ประกาศแล้ว (P34)

## 6. Data model (migration แบบเพิ่มอย่างเดียว)

```prisma
enum PaymentBatchStatus { DRAFT FILE_READY CLOSED CANCELLED }
enum PaymentBatchItemStatus { PENDING PAID FAILED DROPPED }
enum PaymentBatchSourceType { DISBURSEMENT_VOUCHER REIMBURSEMENT_CLAIM }

model PaymentBatch {
  id                          String             @id @default(cuid())
  companyId                   String
  batchNumber                 String             // BT-YYYYMM-NNNNN ออกใน transaction ตอนสร้าง
  status                      PaymentBatchStatus @default(DRAFT)
  plannedPayDate              DateTime           @db.Date
  fileLayout                  String?            // GENERIC_XLSX | SCB_BUSINESS_ANYWHERE; ตั้งตอนดาวน์โหลดครั้งแรก
  otherBankChannel            String?            // ORFT | SMART_NEXT_DAY (รูปแบบธนาคารเฉพาะ)
  exportItemCount             Int?
  exportTotalAmount           Decimal?           @db.Decimal(18, 4)
  exportDigestSha256          String?            // SHA-256 ของแถวตรึงแบบ canonical
  fileDownloadCount           Int                @default(0)
  firstFileDownloadedAt       DateTime?
  firstFileDownloadedByUserId String?
  resultsRunCommandId         String?            // รอบบันทึกผลที่กำลังทำ (lease)
  resultsRunStartedAt         DateTime?
  createdByUserId             String
  closedAt                    DateTime?
  cancelledAt                 DateTime?
  cancelledByUserId           String?
  cancelReason                String?            // ≤200, looksLikeAccountNumber guard
  version                     Int                @default(0)
  createdAt                   DateTime           @default(now())
  updatedAt                   DateTime           @updatedAt
  company                     Company            @relation(fields: [companyId], references: [id], onDelete: Cascade)
  items                       PaymentBatchItem[]

  @@unique([companyId, id])
  @@unique([companyId, batchNumber])
  @@index([companyId, status, createdAt])
  @@index([companyId, createdByUserId])
}

model PaymentBatchItem {
  id                       String                 @id @default(cuid())
  companyId                String
  batchId                  String
  position                 Int
  sourceType               PaymentBatchSourceType
  sourceId                 String
  sourceNumber             String
  sourceVersion            String                 // ลายนิ้วมือข้อมูลการจ่าย (§5.5) ไม่ใช่ version ดิบ
  branchId                 String
  payeeName                String
  payoutKind               String                 // BANK_ACCOUNT | PROMPTPAY_PHONE
  bankName                 String?
  accountLast4             String
  payoutDestinationVersion Int?                   // ใบเบิกเท่านั้น
  amount                   Decimal                @db.Decimal(18, 4)
  hasWithholding           Boolean                @default(false)
  status                   PaymentBatchItemStatus @default(PENDING)
  openSourceKey            String?                // `${sourceType}:${sourceId}` ขณะ PENDING
  // ค่าตรึงของแผ่นงาน (ตั้งครั้งเดียวตอนดาวน์โหลดครั้งแรก; ciphertext ลบเมื่อชุดจบ)
  exportedAt               DateTime?
  exportPosition           Int?
  exportPayeeName          String?
  exportBankName           String?
  exportAmount             Decimal?               @db.Decimal(18, 2)
  exportReference          String?
  exportAccountCiphertext  String?
  // ผลและความพยายามล่าสุด
  resolvedAt               DateTime?
  resolvedByUserId         String?
  failureNote              String?
  paymentRecordId          String?                // ReimbursementPayment.id | DisbursementVoucher.id
  resultAttachmentId       String?                // ไฟล์ผลของรอบที่ตัดสินรายการนี้ (F4 รอบ 2)
  resultsCommandId         String?                // คำสั่งรอบบันทึกผลที่ตัดสินรายการนี้
  lastAttemptAt            DateTime?
  lastRefusalCode          String?
  lastRefusalMessage       String?                // ≤300 ข้อความไทยจาก contracts
  createdAt                DateTime               @default(now())
  updatedAt                DateTime               @updatedAt
  batch                    PaymentBatch           @relation(fields: [companyId, batchId], references: [companyId, id], onDelete: Cascade)

  @@unique([companyId, openSourceKey])
  @@unique([batchId, position])
  @@unique([batchId, exportPosition])
  @@index([companyId, sourceType, sourceId])
  @@index([companyId, batchId, status])
}

// คำสั่งที่จบแล้วหรือกำลังทำ (แบบ DisbursementVoucherCommand schema.prisma:2848-2860)
model PaymentBatchCommand {
  id                 String   @id @default(cuid())
  companyId          String
  commandId          String
  batchId            String?  // null ได้สำหรับคำสั่งสร้างที่ล้มก่อนมีชุด
  operation          String   // create | add | remove | refresh | download (บันทึกการตรึงเท่านั้น ไม่ใช่ไบต์) | results | cancel | close
  payloadFingerprint String
  resultJson         Json?    // null = รอบบันทึกผลที่ยังไม่จบ
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  company            Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@unique([companyId, commandId])
  @@index([companyId, batchId])
}
```

เพิ่มใน `ReimbursementPayment`: `paymentBatchItemId String?` (หลักฐานคือไฟล์ผลของชุด; null สำหรับการจ่ายทั่วไป)

SQL เพิ่ม (แบบ `20261005100000_reimbursement_saved_payout_accounts/migration.sql`):

```sql
ALTER TABLE "PaymentBatchItem" ADD CONSTRAINT "PaymentBatchItem_open_key_check"
  CHECK (("status" = 'PENDING') = ("openSourceKey" IS NOT NULL)
    AND ("openSourceKey" IS NULL OR "openSourceKey" = "sourceType"::text || ':' || "sourceId"));
ALTER TABLE "PaymentBatchItem" ADD CONSTRAINT "PaymentBatchItem_shape_check"
  CHECK ("payoutKind" IN ('BANK_ACCOUNT', 'PROMPTPAY_PHONE')
    AND "accountLast4" ~ '^[0-9]{4}$'
    AND (("payoutKind" = 'BANK_ACCOUNT') = ("bankName" IS NOT NULL))
    AND "amount" > 0
    AND (("sourceType" = 'REIMBURSEMENT_CLAIM') = ("payoutDestinationVersion" IS NOT NULL)));
ALTER TABLE "PaymentBatchItem" ADD CONSTRAINT "PaymentBatchItem_export_check"
  CHECK (("exportedAt" IS NULL) = ("exportPosition" IS NULL)
    AND ("exportedAt" IS NULL) = ("exportAmount" IS NULL)
    AND ("exportAccountCiphertext" IS NULL OR "exportedAt" IS NOT NULL));
-- F5: CLOSED/CANCELLED ได้ทั้งมีและไม่มีการดาวน์โหลด; FILE_READY ต้องมีข้อมูลการดาวน์โหลดครบ
ALTER TABLE "PaymentBatch" ADD CONSTRAINT "PaymentBatch_file_check"
  CHECK (("firstFileDownloadedAt" IS NULL) = ("fileLayout" IS NULL)
    AND ("firstFileDownloadedAt" IS NULL) = ("exportDigestSha256" IS NULL)
    AND ("firstFileDownloadedAt" IS NULL) = ("exportItemCount" IS NULL)
    AND ("firstFileDownloadedAt" IS NULL) = ("exportTotalAmount" IS NULL)
    AND ("status" <> 'FILE_READY' OR "firstFileDownloadedAt" IS NOT NULL)
    AND ("status" <> 'DRAFT' OR "firstFileDownloadedAt" IS NULL));
```

- เลขชุด: `'payment.batch': { prefixTemplate: 'BT-{YYYY}{MM}-{SEQ}', padding: 5, resetPolicy: 'MONTHLY' }` ใน `apps/api/src/modules/data-model-core/domain/logic/document-sequence.logic.ts:12-36`
- ไฟล์ผล: `AttachmentLink` `targetType = 'payment_batch'`, `purpose = 'payment_batch.bank_result'` + ป้ายอัปโหลด (§5.7)

## 7. Contracts / API

### 7.1 Contracts ใหม่ `packages/contracts/src/payment-batches.ts`

```ts
export const PAYMENT_BATCH_STATUSES = ['DRAFT', 'FILE_READY', 'CLOSED', 'CANCELLED'] as const;
export const PAYMENT_BATCH_ITEM_STATUSES = ['PENDING', 'PAID', 'FAILED', 'DROPPED'] as const;
export const PAYMENT_BATCH_SOURCE_TYPES = ['DISBURSEMENT_VOUCHER', 'REIMBURSEMENT_CLAIM'] as const;
export const PAYMENT_BATCH_FILE_LAYOUTS = ['GENERIC_XLSX', 'SCB_BUSINESS_ANYWHERE'] as const; // SCB เปิดเมื่อ Phase 2
export const PAYMENT_BATCH_MAX_ITEMS = 100;
export const PAYMENT_BATCH_NOTE_MAX_LENGTH = 200;
export const PAYMENT_BATCH_RESULT_UPLOAD_TAG = 'payment_batch_result';
export const PAYMENT_BATCH_RESULT_PURPOSE = 'payment_batch.bank_result';
export const PAYMENT_BATCH_RESULTS_LEASE_MS = 10 * 60 * 1000;

export type PaymentBatchIneligibleReason =
  'no_account' | 'account_name_invalid' | 'planned_cash' | 'cash_claim' | 'legacy_claim' | 'foreign_currency'
  | 'in_other_batch' | 'bank_not_supported' | 'ewht' | 'not_payable';
export type PaymentBatchSourceRef = { sourceType: PaymentBatchSourceType; sourceId: string };
export type PaymentBatchCandidate = PaymentBatchSourceRef & {
  sourceNumber: string; branchId: string; payeeName: string; maskedAccount: string;
  payoutKind: 'BANK_ACCOUNT' | 'PROMPTPAY_PHONE' | null; amount: string; hasWithholding: boolean;
  eligible: boolean; reason?: { code: PaymentBatchIneligibleReason; message: string; href?: string };
};
export type PaymentBatchCandidates = { vouchers: PaymentBatchCandidate[]; claims: PaymentBatchCandidate[] };

export type CreatePaymentBatchInput = { commandId: string; plannedPayDate: string; items: PaymentBatchSourceRef[] };
export type AddPaymentBatchItemsInput = { commandId: string; expectedVersion: number; items: PaymentBatchSourceRef[] };
export type RemovePaymentBatchItemInput = { commandId: string; expectedVersion: number };
export type RefreshPaymentBatchInput = { commandId: string; expectedVersion: number; mode: 'drop_unusable' | 'use_latest' };
export type DownloadPaymentBatchFileInput = { commandId: string; expectedVersion: number; layout: PaymentBatchFileLayout; otherBankChannel?: 'ORFT' | 'SMART_NEXT_DAY' };
export type RecordPaymentBatchResultsInput = {
  commandId: string; expectedVersion: number; paidDate: string; resultAttachmentId: string;
  outcomes: { itemId: string; outcome: 'PAID' | 'FAILED'; note?: string }[];   // เฉพาะแถวที่เลือกผลแล้ว ≥1
};
export type CancelPaymentBatchInput = { commandId: string; expectedVersion: number; reason: string; bankDidNotProcess?: true }; // ไม่มี PAID เท่านั้น
export type ClosePaymentBatchInput = { commandId: string; expectedVersion: number };          // DRAFT ที่มี PAID ≥1 และ PENDING ≥1

export type PaymentBatchItem = PaymentBatchSourceRef & {
  id: string; position: number; sourceNumber: string; payeeName: string; maskedAccount: string;
  payoutKind: 'BANK_ACCOUNT' | 'PROMPTPAY_PHONE'; amount: string; hasWithholding: boolean;
  status: PaymentBatchItemStatus; inExport: boolean; exportPosition: number | null;
  failureNote: string | null; resolvedAt: string | null; sourceHref: string; duplicatePayee: boolean;
  stale: { code: 'not_payable' | 'changed'; message: string } | null;
  paymentVoidedLater: boolean;
  lastRefusal: { code: string; message: string; at: string } | null;
};
export type PaymentBatchDetail = {
  id: string; batchNumber: string; status: PaymentBatchStatus; plannedPayDate: string;
  itemCount: number; totalAmount: string; exportItemCount: number | null; exportTotalAmount: string | null;
  fileLayout: PaymentBatchFileLayout | null; firstFileDownloadedAt: string | null; fileDownloadCount: number;
  createdByName: string; resultsInProgressBy: string | null;
  resultFiles: { id: string; name: string; uploadedAt: string; uploadedByName: string | null }[];
  cancelReason: string | null; version: number; items: PaymentBatchItem[];
  counts: Record<PaymentBatchItemStatus, number>;
  actions: Record<'addItems' | 'removeItem' | 'refresh' | 'download' | 'recordResults' | 'cancel' | 'close', boolean>;
  // cancel = ไม่มี PAID (DRAFT หรือ FILE_READY); close = DRAFT ที่มี PAID ≥1 และ PENDING ≥1; ทั้งสองไม่จริงพร้อมกัน
  droppedOnClose: number;   // จำนวนรายการที่ออกจากชุดตอนปิด (ใช้กับข้อความสถานะ §10.3)
};
export type RecordPaymentBatchResultsResult = {
  batch: PaymentBatchDetail;
  outcomes: { itemId: string; result: 'PAID' | 'FAILED' | 'ALREADY_DECIDED' | 'REFUSED'; message?: string }[];
};
```

+ `PAYMENT_BATCH_WORDS` (§10), ป้ายสถานะ, `PAYMENT_BATCH_ERROR_WORDS` + `paymentBatchError(code, facts)` แบบ `packages/contracts/src/disbursement-vouchers.ts:153-158`

### 7.2 Endpoints (`companies/:companyId/payment-batches`, module ใหม่ `apps/api/src/modules/payment-batches/`)

| Method | Path | Guard | ทำอะไร |
|---|---|---|---|
| GET | `candidates` | `RequireAnyPermission('expense.disbursement.pay', 'reimbursement.payment.record')` | ตัวเลือก (≤100 ต่อชนิด) |
| GET | (ราก) | เดียวกัน | ชุดที่เปิดได้ (§8) แบ่งหน้า |
| POST | (ราก) | เดียวกัน | สร้าง DRAFT |
| GET | `:id` | เดียวกัน | รายละเอียด (เลขปิดบังเท่านั้น) |
| POST | `:id/items` · `:id/items/:itemId/remove` · `:id/refresh` | เดียวกัน | แก้รายการ (DRAFT) |
| POST | `:id/file` | เดียวกัน | ครั้งแรก: ตรึง + DRAFT→FILE_READY; ครั้งต่อไป: สร้างจากค่าตรึง · ตอบ XLSX `Content-Disposition` `{เลขชุด}.xlsx`, `Cache-Control: no-store` |
| POST | `:id/result-upload-intent` · `:id/result-uploads/:attachmentId/complete` | เดียวกัน + เปิดชุดได้ | อัปโหลดไฟล์ผล (ท่อเดียวกับสลิปใบเตรียมจ่าย `disbursement-voucher.controller.ts:157-168` + ป้าย §5.7) |
| GET | `:id/result-files/:attachmentId` | เดียวกัน + เปิดชุดได้ | ลิงก์ดาวน์โหลดไฟล์ผล (ทางเดียวที่เปิดไฟล์นี้ได้) |
| POST | `:id/results` | เดียวกัน | รอบบันทึกผล |
| POST | `:id/cancel` | เดียวกัน | ยกเลิก (ไม่มี PAID) — มี PAID → 409 `payment_batch_cancel_has_paid` พร้อมทางออก "ปิดชุด" |
| POST | `:id/close` | เดียวกัน | ปิดชุด (`ClosePaymentBatchInput`; DRAFT ที่มี PAID ≥1 และ PENDING ≥1) → PENDING เป็น DROPPED, ชุด CLOSED; อื่น ๆ → 409 `payment_batch_close_not_available` (F4 รอบ 3) |

- DTO: whitelist ฟิลด์ (แบบ `disbursement-voucher.use-case.ts:44-60`), `commandId` ≤128, รายการ ≤100 ไม่ซ้ำ, civil date, `note`/`reason` ≤200 ไม่มีเลขบัญชี, `outcomes` ≥1
- คัดลอกเลขทีละรายการใช้ endpoint เดิม `POST disbursement-vouchers/:id/payee-account/reveal` และ `POST reimbursements/:requestId/payout-destination/reveal` (`reimbursement-payout.controller.ts:111`)
- Error codes: `payment_batch_version_conflict`, `payment_batch_command_conflict`, `payment_batch_not_found`, `payment_batch_too_many_items`, `payment_batch_item_ineligible:{reason}`, `payment_batch_stale_items`, `payment_batch_changed_items`, `payment_batch_layout_locked`, `payment_batch_export_digest_mismatch`, `payment_batch_result_file_required`, `payment_batch_paid_date_invalid`, `payment_batch_results_in_progress`, `payment_batch_item_already_decided`, `payment_batch_cancel_has_paid`, `payment_batch_cancel_confirmation_required`, `payment_batch_source_locked`, `payment_batch_result_retained`, `payment_batch_file_unavailable`, `payment_batch_item_already_paid`

### 7.3 พารามิเตอร์ภายในของ use-case เดิม (ไม่เปิดใน DTO)

- `DisbursementVoucherUseCase.pay(ctx, id, body, lineConfirmed, options?: { paymentBatchItem?: { batchId; itemId } })` — ผ่านล็อกของชุดนั้นเฉพาะรายการนั้น; ตรวจ `sourceVersion` ใต้ล็อก
- `RecordReimbursementPaymentUseCase.execute(ctx, id, input, line: { previewOnly?, expectedUpdatedAt?, evidence?: 'deferred', paymentBatchItem?: { batchId; itemId; resultAttachmentId } })`
  - `previewOnly + evidence: 'deferred'` = ตรวจความพร้อมจ่ายโดยถือว่าหลักฐานจะมาตอนบันทึกผล: ส่ง `hasSlip: true` และข้ามการตรวจอ้างอิงเฉพาะโหมดนี้ ไม่เขียน ไม่จองเลข ใช้บัญชีปัจจุบันของใบเป็นคำยืนยันสมมุติ (F7)
  - `paymentBatchItem` ทำให้ preflight ที่ `:463` นับหลักฐานของชุดเป็นหลักฐานได้ (อ่านอย่างเดียว) และส่งต่อเป็น `batchEvidence` ใน `recordPaymentAtomic` เพื่อตรวจจริงใต้ล็อกการจ่าย — ไม่มีทางที่การจ่ายผ่านชุดจะล้มที่ preflight เพราะไม่มีสลิป (F1 รอบ 2)

### 7.4 ล็อกและ hook (ฟังก์ชันธรรมดารับ tx — `ReimbursementsModule` import `ExpensesModule` อยู่แล้ว `reimbursements.module.ts:59` จึงไม่ผ่าน DI)

`apps/api/src/modules/payment-batches/domain/payment-batch-source.ts`
- `assertSourceNotInSentBatch(tx, companyId, sourceType, sourceId, allowItem?)` — อ่านแบบธรรมดาใต้ล็อกต้นทาง: รายการ `openSourceKey` ที่ชุด `FILE_READY` และไม่ใช่ `allowItem` → `ConflictException(paymentBatchError('payment_batch_source_locked', { batchId, batchNumber, creatorName, canOpenBatch }))`
- `markBatchItemPaid(tx, companyId, sourceType, sourceId, paymentRecordId, actorUserId, expectedItem?)` — อ่านรายการเปิดของต้นทาง → item `FOR UPDATE` เท่านั้น (ไม่แตะแถวชุด — §5.5 F3); มี `expectedItem` แต่รายการไม่ `PENDING` → โยน (rollback การจ่าย); ไม่มี `expectedItem` และไม่มีรายการเปิด → ไม่ทำอะไร; เขียน `resultAttachmentId`/`resultsCommandId` เมื่อมาจากรอบบันทึกผล
- `closeBatchIfDone(companyId, batchId)` — ธุรกรรม `ReadCommitted` แยก: advisory ชุด → แถวชุด `FOR UPDATE` → นับ PENDING → ถ้า 0: `CLOSED`, `closedAt`, ลบ `exportAccountCiphertext`; idempotent
- `markBatchItemFailed(tx, …)` — ใช้ในธุรกรรมที่ถือล็อกต้นทางแล้ว
- จุดเรียก: voucher `lifecycleAtomic` หลังล็อก (`withdraw`/`return`/`cancel`/`pay`); claim `recordPaymentAtomic` หลัง `:3645` และ `onPaymentPersisted` (`reimbursement-finance.use-case.ts:501`); เมธอด repository ของการยกเลิกและส่งกลับแก้บัญชีหลัง `lockRequest`

### 7.5 LINE (F16)

- `LineExpenseActionService.refusal()` (`apps/api/src/modules/line-ai/application/line-expense-action.service.ts:1014`) แปล `payment_batch_source_locked` เป็นข้อความ §10.6 **ก่อน** บรรทัด Conflict ทั่วไป (`:1083`)
- ผลแบบ `blocked` รองรับ `webPath`/`webLabel` อยู่แล้ว (`:106`, ตัวอย่าง `:975`) — ทุกจุดที่คืน refusal ของคำสั่งที่อาจถูกล็อก (`:594`, `:709`, `:850`, `:955`, `:975`) แนบ `webPath = /companies/{companyId}/payment-batches/{batchId}`, `webLabel = 'เปิดชุดโอน'` เมื่อ `canOpenBatch` เป็นจริงเท่านั้น ทั้งตอน preview และตอนยืนยันด้วยการ์ดที่ลงชื่อ
- **ตัวส่งข้อความต่อเนื่องต้องพาปุ่มไปด้วย (P16)**: (ก) ทางตอบเหตุผลต่อเนื่อง `process-line-webhook.use-case.ts:6776-6785` วันนี้สร้าง `{ type: 'text', text: answer.reply }` ทิ้ง `webPath`/`webLabel` — เปลี่ยนเป็นการ์ดข้อความระบบพร้อมปุ่ม (`buildLineSystemTextCardMessage` แบบที่ใช้ที่ `:9781-9783`) เมื่อมี `webPath`; (ข) ทางสลิปต่อเนื่อง `:9779-9784` ใช้ป้ายคงที่ "เปิดใบเบิก" — ใช้ `slip.webLabel` เมื่อมี ไม่งั้นป้ายเดิม · ทดสอบข้อความที่ส่งจริงทั้งสองทาง

## 8. สิทธิ์ ABAC และขอบเขต tenant

- ไม่มี permission/capability pack ใหม่ (Q3) — `expense.disbursement.pay` (ใบเตรียมจ่าย), `reimbursement.payment.record` (ใบเบิก) (`capability-pack.registry.ts:312-316`, `:332-357`)
- **เปิดชุดได้** = มีสิทธิ์จ่ายของทุกชนิดในชุด + สาขาครอบทุกรายการ (ไม่งั้น 404) — เจ้าของร้านเปิดได้เสมอ จึงกู้ชุดของคนที่ลาออกได้
- เพิ่มรายการ = ผ่าน §5.1 ด้วยสิทธิ์ของผู้กด
- ดาวน์โหลด (ครั้งแรกและซ้ำ) = เปิดชุดได้ + อำนาจจ่ายของทุกรายการในแผ่นงาน (§5.7 F8) ตรวจทุกครั้ง
- ไฟล์ผล = เปิดชุดได้เท่านั้น (§5.7 F1)
- บันทึกผล = เปิดชุดได้ + use-case เดิมตรวจซ้ำ
- Tenant: ทุกตารางมี `companyId`, FK `(companyId, id)`, query กรองบริษัท
- LINE session เรียก endpoint ชุดโอนไม่ได้ (แบบ `disbursement_line_session_denied` — `disbursement-voucher.use-case.ts:69-72`)
- AI Gateway: ไม่มีเครื่องมือใหม่; ถ้ามีในอนาคตต้องเรียก API ที่ตรวจสิทธิ์ และไม่คืนเลขบัญชี

## 9. State transitions

### 9.1 ชุด

| จาก | การกระทำ | ไป | เงื่อนไข |
|---|---|---|---|
| — | สร้าง | `DRAFT` | ≥1 รายการผ่าน §5.1 |
| `DRAFT` | เพิ่ม/นำออก/อัปเดต | `DRAFT` | CAS version |
| `DRAFT` | ดาวน์โหลดครั้งแรก | `FILE_READY` | ≥1 PENDING, ไม่มีรายการใช้ไม่ได้/เปลี่ยน; ตรึงตาม §5.5 |
| `DRAFT` | รายการสุดท้ายจ่ายจากหน้าใบ (≥1 PAID ไม่มี PENDING) | `CLOSED` | `closeBatchIfDone` หลัง commit — ไม่มีข้อมูลดาวน์โหลด ผ่าน CHECK |
| `DRAFT` | นำออกจนไม่มี PENDING และไม่มี PAID | `CANCELLED` | อัตโนมัติ |
| `DRAFT` | ยกเลิก (ไม่มี PAID) | `CANCELLED` | PENDING → DROPPED |
| `DRAFT` | ปิดชุด (มี PAID แล้ว) | `CLOSED` | PENDING → DROPPED; การจ่ายที่บันทึกแล้วคงอยู่ (F8) |
| `CLOSED`/`CANCELLED` | ดาวน์โหลด | — | 409 `payment_batch_file_unavailable` (F5) |
| `FILE_READY` | ดาวน์โหลดซ้ำ | `FILE_READY` | สร้างจากค่าตรึง digest ต้องตรง |
| `FILE_READY` | บันทึกผลบางแถว | `FILE_READY` | ยังมี PENDING |
| `FILE_READY` | แถวสุดท้ายได้ผล | `CLOSED` | `closeBatchIfDone`; ลบ ciphertext ตรึง |
| `FILE_READY` | ยกเลิก | `CANCELLED` | ไม่มี PAID + ยืนยัน + เหตุผล; ลบ ciphertext ตรึง |

### 9.2 รายการ

| จาก | เหตุ | ไป | `openSourceKey` |
|---|---|---|---|
| — | เพิ่ม | `PENDING` | ตั้ง |
| `PENDING` | นำออก / ยกเลิกชุด / นำรายการใช้ไม่ได้ออก | `DROPPED` | NULL |
| `PENDING` | จ่ายสำเร็จ (ทางที่ผ่านล็อก) | `PAID` | NULL |
| `PENDING` | "ไม่สำเร็จ" ใต้ล็อกต้นทาง | `FAILED` | NULL |
| `PENDING` | use-case เดิมปฏิเสธ / ยังไม่ทราบผล | `PENDING` (+ `lastRefusal*`) | คง |
| `PAID`/`FAILED`/`DROPPED` | — | จบ | — |

สถานะของใบเปลี่ยนตามกติกาเดิมของใบเท่านั้น

## 10. UI

หลัก (`docs/guidelines/thai-ux-standard.md`): หนึ่งประโยคต่อกล่องโต้ตอบ; คำใบ้บรรทัดเดียว; ปุ่มในกลุ่มขนาดเท่ากัน (วัดจริง); ปุ่มฟอร์มใน `FormActionBar` ที่เริ่มจากขอบเนื้อหา; หน้าเต็มพื้นที่; **การกระทำเดียวแสดงเป็นตัวเอง ไม่ซ่อนในเมนูเพิ่มเติม** (`:70`); ตรวจที่ **390, 1280 และ ≥1536 px** โดยเปิดเมนูข้าง (`:77`, F22); ปุ่ม `min-h-11`

### 10.1 ทางเข้า (ไม่มีเมนูใหม่ — test จำนวนเมนู starter `apps/api/src/modules/employee-access/domain/logic/menu-entitlement-binding.spec.ts:131` คงเดิม)

- รายการใบเตรียมจ่าย (มีใบอนุมัติแล้วรอจ่าย + สิทธิ์จ่าย): ปุ่ม **"จ่ายหลายรายการ"**
- แท็บรอจ่ายของการเบิกจ่าย (มีใบรอจ่าย + `reimbursement.payment.record`): ปุ่ม **"จ่ายหลายรายการ"**
- ทั้งสองหน้า: ลิงก์ **"ชุดโอนที่ทำไว้"** เมื่อมีชุดที่เปิดได้
- หน้าใบที่อยู่ในชุดที่ยังเปิด: บรรทัด "อยู่ในชุดโอน {เลขชุด}" + ลิงก์ "เปิดชุดโอน" (ถ้าเปิดได้)

### 10.2 หน้า "จ่ายหลายรายการ" (`/companies/[companyId]/payment-batches/new`)

- หัวข้อ **จ่ายหลายรายการ** · คำใบ้ **ระบบไม่ได้โอนเงินให้ โอนที่ธนาคารแล้วกลับมาบันทึกผล**
- ส่วน **ใบเตรียมจ่ายที่อนุมัติแล้ว** / **ใบเบิกรอจ่าย** (เฉพาะชนิดที่จ่ายได้) + "เลือกทั้งหมด" ต่อส่วน
- แถว: ชื่อผู้รับ · บัญชีปิดบัง (`maskedPayoutAccount` `packages/contracts/src/reimbursements.ts:2093-2100`) · "{ยอด} บาท" · เลขเอกสาร · ป้าย **"หักภาษีแล้ว"**
- แถวที่ใช้ไม่ได้: ไม่มีช่องติ๊ก ข้อความ §5.1 + ลิงก์ทางออก
- ช่อง **วันที่จะโอน** (วันนี้)
- ว่าง: **ไม่มีรายการรอจ่ายที่โอนผ่านธนาคารได้** + "กลับ"
- แถบล่าง: **"{n} รายการ · {ยอดรวม} บาท"** + [ยกเลิก] [สร้างชุดโอน]
- สำเร็จ: toast **"สร้างชุดโอน {เลขชุด} แล้ว"**
- 390: การ์ดต่อแถว · 1280/≥1536: ตาราง เลือก | ผู้รับเงิน | บัญชี | เอกสาร | ยอดโอน | หมายเหตุ

### 10.3 หน้าชุดโอน (`/companies/[companyId]/payment-batches/[batchId]`)

- หัวข้อ **ชุดโอน {เลขชุด}** + ป้าย: **รายการรอโอน** (DRAFT) · **ดาวน์โหลดแผ่นงานแล้ว** (FILE_READY) · **ปิดแล้ว** (CLOSED ทุกกรณี) · **ยกเลิกแล้ว**
- บรรทัดขั้นต่อไป: DRAFT **คัดลอกเลขบัญชีไปโอนทีละรายการ หรือดาวน์โหลดแผ่นงานไปกรอกที่ธนาคาร** · FILE_READY **กรอกหรือคัดลอกรายการลงระบบของธนาคาร แล้วกลับมากด “บันทึกผลจากธนาคาร”** (F15) · CLOSED ไม่มีรายการออกตอนปิด: **บันทึกผลครบแล้ว** (+ **{n} รายการไม่สำเร็จ กลับไปรอจ่ายแล้ว**) · CLOSED ด้วย "ปิดชุด": **ปิดชุดแล้ว บันทึกจ่าย {a} รายการ อีก {d} รายการยังไม่จ่ายและกลับไปรอจ่ายแล้ว** (รายการเหล่านั้นแสดงป้าย **นำออกแล้ว**) (F5 รอบ 3) · CANCELLED **ยกเลิกแล้ว: {เหตุผล}** · มีคนกำลังบันทึกผล: **{ชื่อ} กำลังบันทึกผลชุดนี้**
- ยอด: "{ยอดชุด} บาท" และ "ยอดในแผ่นงาน {ยอด} บาท" เฉพาะเมื่อต่างกัน
- ป้ายรายการ: **รอโอน** · **บันทึกจ่ายแล้ว** · **ไม่สำเร็จ** · **นำออกแล้ว** · **ใช้ไม่ได้แล้ว** · **ข้อมูลเปลี่ยน** · **ผู้รับซ้ำในชุดนี้** · **การจ่ายถูกยกเลิกภายหลัง** · **ไม่อยู่ในแผ่นงาน** (จ่ายก่อนดาวน์โหลด)
- ปุ่มต่อแถว (DRAFT, รอโอน): [คัดลอกเลขบัญชี] [บันทึกจ่าย] ขนาดเท่ากัน + ลิงก์ข้อความ **นำออก** (การกระทำเดียว ไม่ซ่อนในเมนู)
  - คัดลอกแล้ว: toast **"คัดลอกเลขบัญชีแล้ว"** · ไม่มีสิทธิ์เปิดเลข: ไม่แสดงปุ่ม
  - "บันทึกจ่าย" เปิดฟอร์มจ่ายเดิมของใบในแผ่นเลื่อน (มือถือ) / แผงข้าง (จอกว้าง)
- แถบล่าง: DRAFT [ยกเลิกชุด] หรือ [ปิดชุด] (เมื่อมีรายการจ่ายแล้ว) [ดาวน์โหลดแผ่นงานโอน] · FILE_READY [ยกเลิกชุด] (เมื่อไม่มี PAID) [ดาวน์โหลดอีกครั้ง] [บันทึกผลจากธนาคาร] · มีรายการใช้ไม่ได้: ปุ่มหลัก [นำรายการที่ใช้ไม่ได้ออก] · ข้อมูลเปลี่ยน: [ใช้ข้อมูลล่าสุด]
- กล่อง **ดาวน์โหลดแผ่นงานโอน**: **แผ่นงานมีเลขบัญชีเต็ม ใช้กรอกที่ธนาคารครั้งเดียว แล้วลบออกจากเครื่อง** · Phase 2 เพิ่ม "รูปแบบ": **แผ่นงานทุกธนาคาร** / **SCB Business Anywhere** (+ "โอนต่างธนาคาร": **ถึงทันที** / **ถึงวันทำการถัดไป**) · [ยกเลิก] [ดาวน์โหลด]
- กล่อง **ดาวน์โหลดอีกครั้ง**: **แผ่นงานนี้ดาวน์โหลดไปแล้วเมื่อ {วันเวลา} ถ้าส่งรายการซ้ำ ธนาคารอาจโอนซ้ำ** · [ยกเลิก] [ดาวน์โหลด]
- **บันทึกผลจากธนาคาร** (หน้า/แผง): คำใบ้ **เลือกผลเฉพาะแถวที่ธนาคารแจ้งแล้ว แถวที่ยังไม่รู้ผลปล่อยไว้** · **วันที่ธนาคารโอน** · แนบ **ไฟล์ผลจากธนาคาร** (คำใบ้ **PDF หรือรูป เปิดได้เฉพาะคนที่เปิดชุดนี้ได้**) · ต่อแถวปุ่มสามตัวขนาดเท่ากัน [ยังไม่ทราบผล] [สำเร็จ] [ไม่สำเร็จ] (ค่าเริ่มต้น "ยังไม่ทราบผล") + "เหตุผล (ไม่บังคับ)" เมื่อไม่สำเร็จ · ปุ่มช่วยด้านบน **"แถวที่เหลือสำเร็จทั้งหมด"** · แถบล่าง (ซ้าย: **"สำเร็จ {a} · ไม่สำเร็จ {b} · ยังไม่ทราบผล {c}"**) [ยกเลิก] [บันทึกผล] — กด "บันทึกผล" โดยยังไม่เลือกแถวใด ได้ข้อความ **เลือกผลอย่างน้อยหนึ่งแถว**
- ผลลัพธ์: **บันทึกจ่ายแล้ว {a} รายการ** · **ไม่สำเร็จ {b} รายการ กลับไปรอจ่ายแล้ว** · **บันทึกไม่ได้ {c} รายการ ดูเหตุผลที่รายการนั้น** · **{d} รายการบันทึกผลไปก่อนแล้ว** (แต่ละแถว [ลองอีกครั้ง] [เปิดรายการ])
- กล่อง **ยกเลิกชุด** (DRAFT ไม่มีรายการจ่ายแล้ว): **ยกเลิกชุดนี้? รายการกลับไปรอจ่าย** · [ไม่ยกเลิก] [ยกเลิกชุด]
- กล่อง **ปิดชุด** (DRAFT มีรายการจ่ายแล้ว): **ปิดชุดนี้? รายการที่ยังไม่จ่ายกลับไปรอจ่าย ส่วนที่บันทึกจ่ายแล้วยังอยู่** · [ไม่ปิด] [ปิดชุด]
- ดาวน์โหลดในชุดที่จบแล้ว: **ชุดนี้จบแล้ว ดาวน์โหลดแผ่นงานไม่ได้ ดูผลของแต่ละรายการด้านล่าง**
- กล่อง **ยกเลิกชุด** FILE_READY: **ยกเลิกได้เมื่อธนาคารไม่ได้ทำรายการจากแผ่นงานนี้** · ติ๊ก **ธนาคารไม่ได้ทำรายการจากแผ่นงานนี้** · **เหตุผล** · [ไม่ยกเลิก] [ยกเลิกชุด]
- 390: การ์ดต่อรายการ แถบล่างติดจอ · 1280/≥1536: ตารางเต็มพื้นที่ ผู้รับเงิน | บัญชี | เอกสาร | ยอดโอน | สถานะ | การทำงาน; แถบล่างเริ่มจากขอบเนื้อหา ปุ่มชิดขวา

### 10.4 หน้า "ชุดโอนที่ทำไว้"

- หัวข้อ **ชุดโอนที่ทำไว้** · ชิปกรองสถานะขนาดเท่ากัน · แถว: เลขชุด · สถานะ · วันที่จะโอน · {n} รายการ · ยอด · ผู้สร้าง · FILE_READY เกิน 3 วันขึ้นก่อน · ว่าง: **ยังไม่มีชุดโอน**

### 10.5 LINE (F17)

- ไม่มีการ์ดชนิดใหม่; การแจ้งเตือนเดิม (ผู้เบิก/ผู้จัดทำเท่านั้น)
- การ์ดวิธีใช้ใหม่สองใบ สถานะ DRAFT ใน `apps/ai-gateway/src/modules/line-ai/agents/product-help-draft-cards.ts` — **ตัวสร้างการ์ดในไฟล์นี้ (`card()` `:3-13`) ฝัง URL `user-guide/getting-started`, `sourceFile` และ `sourceHash` ของคู่มือเริ่มต้นไว้ (`:6-8`)** จึงต้องให้ตัวสร้างรับ path/ไฟล์/hash ของคู่มือเป็นพารามิเตอร์ (การ์ดเดิมส่งค่าเดิม hash เดิมไม่เปลี่ยน) แล้วสร้างการ์ดใหม่จากคู่มือใหม่ `apps/web/src/features/user-guide/payment-batch-guide.content.ts` ที่ประกอบเข้าหน้าคู่มือรายจ่าย (anchor `payment-batches`, `bank-connection`) พร้อม hash ของไฟล์นั้น (P17) — กติกาการ์ด: `sourceFile` ต้องเป็นไฟล์คู่มือ (`apps/ai-gateway/src/modules/line-ai/agents/approved-knowledge.ts:94`) และปุ่มมาจาก `sourceURL` โดยใช้ชื่อการ์ดเป็นป้าย (`:160`) จึง **ปุ่มเปิดคู่มือ** `/companies/{companyId}/user-guide/expenses#payment-batches` (ใน `card()` ของ `approved-product-help.ts:23` ให้ key `payment-batches` ชี้ path `expenses` แบบ `disbursement-vouchers`)
  - ชื่อการ์ด (= ป้ายปุ่ม): **จ่ายหลายรายการพร้อมกัน**
  - การ์ด 1 · คำถาม: "โอนเงินให้หลายคนพร้อมกันได้ไหม", "มีไฟล์โอนเงินหลายรายการไหม" (ไม่มีคำถามเรื่องเชื่อมธนาคาร — F9)
  - คำตอบ: **ได้ค่ะ บนเว็บ กด “จ่ายหลายรายการ” ในหน้ารายการที่รอจ่าย รวมหลายรายการเป็นชุด แล้วคัดลอกเลขบัญชีไปโอน หรือดาวน์โหลดแผ่นงานไปกรอกที่ธนาคาร ระบบไม่ได้โอนเงินและยังไม่ได้เชื่อมกับธนาคารโดยตรง โอนเสร็จแล้วกลับมาบันทึกผลที่ชุดนั้นค่ะ**
  - `permissionAnyOf`: `expense.disbursement.pay`, `reimbursement.payment.record`
  - การ์ด 2 · ชื่อ (= ป้ายปุ่ม): **เชื่อมธนาคาร** · คำถาม: "เชื่อมธนาคารอัตโนมัติได้ไหม", "ดึงรายการเดินบัญชีเองได้ไหม" · คำตอบ: **ยังไม่ได้ค่ะ มั่งมีพลัสยังไม่เชื่อมกับธนาคารโดยตรง จึงไม่โอนเงินและไม่ดึงรายการเดินบัญชีให้เองค่ะ** · ปุ่มเปิดคู่มือ anchor `bank-connection` · `permissionAnyOf`: สิทธิ์อ่านรายจ่ายหรือใบเบิกแบบการ์ดเดิม (`expenseReaders`/`reimbursementReaders` ใน `approved-product-help.ts:31-33`)
- คำสั่งที่ถูกล็อก: ข้อความ §10.6 + ปุ่ม **เปิดชุดโอน** (§7.5)

### 10.6 ข้อความปฏิเสธจากการล็อก

- ผู้ดูเปิดชุดได้: **ใบนี้อยู่ในแผ่นงานโอน {เลขชุด} ที่ดาวน์โหลดแล้ว บันทึกผลที่ชุดนั้นก่อน** + ปุ่ม **เปิดชุดโอน**
- เปิดชุดไม่ได้: **ใบนี้อยู่ในรายการโอนของ {ชื่อผู้สร้างชุด} ตอนนี้ทำรายการนี้ไม่ได้ ติดต่อ {ชื่อผู้สร้างชุด}** (ผู้สร้างไม่อยู่ → `THAI_SYSTEM_ROLE_NAMES.OWNER` "เจ้าของร้าน")

### 10.7 ตารางพื้นผิว × กรณี

| ประโยค | พื้นผิว | กรณี | จริงไหม / เพราะ |
|---|---|---|---|
| ระบบไม่ได้โอนเงินให้ โอนที่ธนาคารแล้วกลับมาบันทึกผล | หน้าสร้าง | ทุกร้าน | จริง: ไม่มีการเชื่อมธนาคาร |
| …หรือดาวน์โหลดแผ่นงานไปกรอกที่ธนาคาร / กรอกหรือคัดลอกรายการลงระบบของธนาคาร | หน้าชุด | ทุกธนาคาร | จริง: ไม่อ้างว่าอัปโหลดตรงได้ (F15) |
| แผ่นงานมีเลขบัญชีเต็ม … | กล่องดาวน์โหลด | ทุกแผ่นงาน | จริง: ทุกแถวที่ตรึงมีเลขเต็ม |
| แผ่นงานนี้ดาวน์โหลดไปแล้ว … ธนาคารอาจโอนซ้ำ | ดาวน์โหลดซ้ำ | ทุกธนาคาร | จริง: "อาจ" |
| ยอดโอนหักภาษี ณ ที่จ่ายไว้แล้วในบางรายการ อย่าหักซ้ำที่ธนาคาร | แผ่นสรุป | มีแถวหักภาษี | จริง; แสดงเฉพาะเมื่อมี |
| หักภาษีแล้ว | แถว | ใบเตรียมจ่ายที่มีรายจ่าย `whtAmount > 0` | จริง; ใบเบิกไม่มี (D22) |
| ยอดในแผ่นงาน … | หน้าชุด | มีรายการจ่ายก่อนดาวน์โหลด | จริง: ค่าตรึง; ไม่แสดงเมื่อเท่ายอดชุด |
| บันทึกจ่ายแล้ว | แถว | ทุกทาง | จริง: เป็นการบันทึก |
| ไม่สำเร็จ กลับไปรอจ่ายแล้ว | ผล/สรุป | ใบ APPROVED / รอจ่าย | จริง: ใบไม่เปลี่ยนสถานะ และปลดล็อกแล้ว |
| {d} รายการบันทึกผลไปก่อนแล้ว | ผลบันทึก | อีกคน/อีกทางตัดสินแถวนั้นก่อน | จริง: ตัดสินใต้ล็อกต้นทาง |
| {ชื่อ} กำลังบันทึกผลชุดนี้ | หน้าชุด | lease ยังไม่หมด | จริงภายใน 10 นาที; หลังหมดไม่แสดง |
| อยู่ในชุดโอน {เลขชุด} ของ {ชื่อ} แล้ว | แถวใช้ไม่ได้ | ชุดของใครก็ได้ | จริง |
| ใบนี้อยู่ในแผ่นงานโอน … | ใบ เว็บ+LINE | เปิดชุดได้ | จริง: ล็อกเฉพาะ FILE_READY |
| ใบนี้อยู่ในรายการโอนของ {ชื่อ} … | ใบ (ผู้เบิก/ผู้จัดทำ) | เปิดชุดไม่ได้; ผู้สร้างลาออก | จริง: ลาออก → "เจ้าของร้าน" ซึ่งเปิดได้เสมอ |
| คำตอบ LINE "ได้ค่ะ บนเว็บ …" | LINE | ผู้มีสิทธิ์จ่ายอย่างน้อยหนึ่งชนิด | จริง: การ์ดส่งเฉพาะผู้มีสิทธิ์; ปุ่มเปิดคู่มือ ไม่อ้างหน้าที่ผู้ใช้ไม่มี |
| การแจ้งผู้เบิก | เว็บ+LINE | จ่ายผ่านแผ่นงาน | จริง: ไม่มีประโยคสลิปเมื่อ `slipCount = 0` |
| ปิดชุดนี้? รายการที่ยังไม่จ่ายกลับไปรอจ่าย ส่วนที่บันทึกจ่ายแล้วยังอยู่ | กล่องปิดชุด | DRAFT มี PAID ≥1 | จริง: เฉพาะ PENDING → DROPPED (F8) |
| ปิดแล้ว | ป้ายสถานะ | CLOSED ทุกแบบ | จริง: ไม่อ้างว่าบันทึกผลครบ |
| บันทึกผลครบแล้ว | บรรทัดสถานะ | CLOSED ที่ `droppedOnClose = 0` | จริง: ทุกรายการ PAID/FAILED |
| ปิดชุดแล้ว บันทึกจ่าย {a} รายการ อีก {d} รายการยังไม่จ่ายและกลับไปรอจ่ายแล้ว | บรรทัดสถานะ | CLOSED ที่ `droppedOnClose > 0` | จริง: {d} = DROPPED ตอนปิด ซึ่งปลดล็อกแล้ว (F5 รอบ 3) |
| ยกเลิกชุดนี้? รายการกลับไปรอจ่าย | กล่องยกเลิก | DRAFT ไม่มี PAID | จริง: ทุกรายการยังไม่จ่าย |
| ชุดนี้จบแล้ว ดาวน์โหลดแผ่นงานไม่ได้ … | หน้าชุด | CLOSED/CANCELLED | จริง: ciphertext ตรึงถูกลบแล้ว (F5) |
| ยังไม่ได้ค่ะ มั่งมีพลัสยังไม่เชื่อมกับธนาคารโดยตรง … | LINE การ์ด 2 | ทุกผู้อ่านรายจ่าย/ใบเบิก | จริงทุกกรณีในรุ่นนี้ (F9) |

## 11. Impact analysis

| ส่วน | ผลกระทบ |
|---|---|
| Prisma / migration | enum 3, ตาราง 3 (`PaymentBatch`, `PaymentBatchItem`, `PaymentBatchCommand`), คอลัมน์ `ReimbursementPayment.paymentBatchItemId`, CHECK 4 (§6) — เพิ่มอย่างเดียว |
| เลขเอกสาร | `payment.batch` |
| contracts | `payment-batches.ts` ใหม่; Phase 2 `THAI_BANK_CODES`; B1 คำ error ใหม่ใน `DISBURSEMENT_VOUCHER_ERROR_WORDS` |
| API module ใหม่ | `apps/api/src/modules/payment-batches/` import `ExpensesModule` + `ReimbursementsModule` (export ที่ต้องใช้มีแล้ว `expenses.module.ts:236-240`, `reimbursements.module.ts:109`) |
| ใบเตรียมจ่าย | `disbursement-voucher.use-case.ts`: ล็อก/hook ใน `lifecycleAtomic`, option `paymentBatchItem`, ลายนิ้วมือ, B1 (รวมทางคัดลอกบัญชี `:201-211`), B2 (รวม PDF `:344-349` ที่ต้องคืนฉบับปิดบัง) · `prisma-disbursement-voucher.repository.ts`: เรียก freeze check ใต้ล็อก · หน้าเว็บ §10.1 |
| ใบเบิก | `reimbursement-finance.use-case.ts` (option `evidence`, `paymentBatchItem`); `prisma-reimbursement.repository.ts` (`recordPaymentAtomic` `batchEvidence` + freeze check หลัง `:3645` + hook, เมธอดยกเลิก/แก้บัญชีหลัง `lockRequest`); `isSamePaymentRequest` (`reimbursement.logic.ts:878-900`) เทียบ `paymentBatchItemId` · หน้าเว็บ §10.1 |
| การตรวจใบเสร็จใบเบิก | `reimbursement-evidence.service.ts:37-43` ปฏิเสธไฟล์ใบเตรียมจ่าย/ไฟล์ผลชุด (B4); ตัวกรองไฟล์ร่างใบเบิก LINE `:802` ใช้ `NOT_PAYMENT_EVIDENCE_WHERE` |
| ใบเตรียมจ่าย: บัญชีแนะนำ | `prisma-disbursement-voucher.repository.ts` `payeeAccount()` (`:104-115`) ไม่เสนอใบที่ยกเลิกหรือร่างของคนอื่น และคืน `canReveal`; `DisbursementVoucherAccountFields.tsx:30-41` ใช้ค่านั้นแทนการเดาฝั่งเว็บ (F6) |
| ไฟล์แนบ | `PrismaAttachmentRepository.isPaymentBatchResultFile` + รั้วสี่จุด (§5.7): `create-download-url.use-case.ts`, `prisma-attachment.repository.ts` (`markDeleted`, `NOT_*_WHERE`), `attachment.logic.ts` (`findAttachmentLinkConflict`), `reimbursement-claim-signature.use-case.ts`, `line-reimbursement-draft-adapter.service.ts` |
| บัญชี/ลงบัญชี, ภาษี, 50 ทวิ | ไม่เปลี่ยน; `ewht` อ่าน `whtRemittance` เมื่อ spec e-WHT ลง |
| กระทบยอดธนาคาร (ไม่ขาย) | ไม่แก้; อ้างอิงเลขชุดแสดงผ่าน `prisma-match-source.query.ts:95`, `:121` |
| สิทธิ์ / pack / เอกสารสิทธิ์ | ไม่มีสิทธิ์ใหม่; ย่อหน้าใน `docs/specs/permission-matrix.md` และ `docs/specs/mangmee-package-entitlements-spec-th.md` |
| แพ็ก / billing | ไม่เปลี่ยน catalog/preset/ดีล/ราคา; `packageMenuLabels` (`menu-entitlements.ts:523-536`) ไม่เปลี่ยน |
| สิทธิ์หน้าเว็บ (route) | เพิ่มกติกา `/payment-batches/new`, `/payment-batches/`, `/payment-batches` (anyOf `expense.disbursement.pay`, `reimbursement.payment.record`) ใน `ROUTE_PERMISSION_RULES` (`apps/web/src/features/web-core-workspace/route-permissions.ts:9`, แบบกติกาใบเตรียมจ่าย `:113-115`) — ไม่งั้น `web-core-workspace.logic.ts:173-175` เปิดหน้าให้ผู้ไม่มีสิทธิ์ (F7 รอบ 3) |
| การแจ้งเตือน | ไม่มีชนิดใหม่ |
| Audit | `payment_batch.create` / `items.change` / `file.download` (HIGH) / `results.record` (HIGH) / `cancel` + audit เดิมต่อการจ่าย |
| ส่งออก | แผ่นงานใหม่หนึ่งชนิดด้วย `buildWorkbook` ไม่มี dependency ใหม่ |
| LINE | `line-expense-action.service.ts` (`refusal()` + `webPath` ที่จุดคืน refusal §7.5); `process-line-webhook.use-case.ts` ตัวส่งข้อความต่อเนื่องสองทาง (`:6776-6785`, `:9779-9784`); ตัวสร้างการ์ดใน `product-help-draft-cards.ts` รับ path/ไฟล์/hash; การ์ด DRAFT สองใบ + คู่มือใหม่; ไม่มีเครื่องมือใหม่ — W00 hash `process-line-webhook.use-case.ts` ด้วย (`line-ai-capability-manifest.ts:40`) |
| W00 manifest | ไฟล์ที่ hash และงานนี้แตะ: `line-expense-action.service.ts` (`apps/api/src/modules/line-ai/line-ai-capability-manifest.ts:240`), `approved-product-help.ts`, `product-help-draft-cards.ts` (`:157-158`) → สร้างใหม่ด้วย `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1` |
| Whole-chain catalog | `scripts/line-ai-whole-chain-acceptance.catalog.mjs` ไม่เพิ่ม scenario; test ปฏิเสธใน LINE เข้า suite `reliability-api-v2` (`:374-407`); manifest spec อยู่ในชุดนี้แล้ว (`:398`) |
| Browser journeys | ใหม่ `e2e/journeys/pay-many-by-bank-file.journey.spec.ts`; เดิม `payment-document-two-people`, `claim-declined-then-paid`, `voucher-supporting-files` ต้องผ่าน |
| Seed | ไม่เพิ่ม; journey สร้างข้อมูลเอง |
| คู่มือผู้ใช้ | `payment-batch-guide.content.ts` บนหน้าคู่มือรายจ่าย anchor `payment-batches` |
| เอกสาร | ชี้ spec นี้จาก §16 ของสเปกใบเตรียมจ่าย และ `reimbursement-payout-account-and-payment-slip-spec-th.md:101`; ปรับ D3 ตาม Q2 |

## 12. Gaps

- **G-1** ลำดับคอลัมน์ ค่าที่ใช้ได้ และรหัสบริษัท (Corporate ID / System Reference ID) ของแม่แบบ SCB Business Anywhere ต้องตรวจกับแม่แบบจริงและคู่มือ PromptPay ฉบับปัจจุบัน · บล็อก Phase 2
- **G-2** "KBank Excel Template": ตรวจเส้นทางดาวน์โหลดสาธารณะตามคู่มือ enable-macro และรุ่นปัจจุบัน (ไม่ใช่สรุปว่าเป็นของลับ) · บล็อก Phase 3
- **G-3** รหัสธนาคาร 3 หลักไม่มีแหล่ง ธปท. ที่ยืนยัน
- **G-4** ใบเตรียมจ่ายรับพร้อมเพย์ไม่ได้ (`disbursement-voucher.use-case.ts:122`)
- **G-5** พร้อมเพย์ของใบเบิกเฉพาะมือถือ (`reimbursements.ts:2045`)
- **G-6** "ธนาคารอื่น" ใช้ได้เฉพาะแผ่นงานทุกธนาคาร
- **G-7** ไม่เตือนบัญชีเดียวกันคนละชื่อ (fingerprint ใบเบิกผูกชื่อบัญชี `payout-destination.logic.ts:59-66`) — ส่งต่อ backlog ข้อ 8
- **G-8** นำเข้ารายการเดินบัญชี: `preset` ไม่ถูกอ่าน และไม่รับ XLSX ขัด `bank-reconciliation-spec.md:566-577` (B3)
- **G-9** อ่านไฟล์ผลจากธนาคารอัตโนมัติ (Phase 3) ต้องเป็นตัวอ่านใหม่ทั้งชั้นสกัดและชั้นสิทธิ์ (P23): `PdfStatementTextExtractor.extractRows` จัดแถวด้วย `clusterPdfTextRows` (`apps/api/src/modules/banking/infrastructure/pdf-statement-text.extractor.ts:21-50`, `banking.logic.ts:587`) และหาหัวตารางที่ต้องมีวันที่+ยอด (`banking.logic.ts:577`) ซึ่งเป็นรูปแบบรายการเดินบัญชี — ต้อง (ก) เปิดเมธอดคืน "ข้อความพร้อมตำแหน่ง" จาก extractor เดิม แล้ว (ข) ตัวแยกผลรายงานโอนต่อธนาคาร (`bank-result.logic.ts`) ที่เก็บชื่อผู้รับ 4 หลักท้าย ยอด สำเร็จ/ไม่สำเร็จ เหตุผล; รูปภาพใช้ schema สกัดใหม่ใน AI Gateway ผ่านสัญญางบเดิม; สิทธิ์ = เปิดชุดได้ ไม่ใช่ `bank.statement.import` (`statement-import.use-case.ts:93-95`)
- **G-10** ตัวจับคู่กระทบยอดโหลดการจ่ายทั้งหมดไม่มีช่วงวันที่ (`prisma-match-source.query.ts:23-63`)
- **G-12** ล็อกจำนวนมากต่อธุรกรรม (ดาวน์โหลด/ยกเลิก ≤100 ต้นทาง) ยังไม่ได้วัดเวลาบน PostgreSQL จริง
- **G-11** ข้อจำกัด K BIZ (10 รายการ ไม่มีอัปโหลด) มีแต่คู่มือ ก.ค. 2567 — ต้องหลักฐานปัจจุบันก่อนเขียนคู่มือผู้ใช้ที่อ้างข้อนี้ (F24)

### 12.1 ต้องปิดก่อนเขียนโค้ด (Must close before coding)

ไม่มี HIGH ค้าง รายการด้านล่างเป็น MEDIUM/LOW ที่ปิดด้วยเอกสารนี้ไม่ได้ ต้องปิดก่อนเริ่มขั้นที่ระบุ

| # | เรื่อง | ปิดอย่างไร | ก่อนขั้น |
|---|---|---|---|
| M1 | คำตอบ Q2 (ไฟล์ผลชุดแทนสลิปรายใบ) | เจ้าของตอบ; ถ้า "ไม่" เพิ่มช่องแนบสลิปต่อแถวในผลบันทึก | plan 1.7 |
| M2 | เลขมาตรา PDPA (22, 24(3), 37(1)) ในตัวบทที่ MDES | เปิดตัวบทอ่านเอง (เครื่องนี้อ่าน PDF ไม่ได้) | ก่อนเขียนคู่มือผู้ใช้ |
| M3 | เลขประกาศ ธปท. 47/2568 และเนื้อหนังสือเวียน 16 เม.ย. 2569 | อ่านตัว PDF เอง | ก่อนตอบลูกค้าเรื่อง bank feed |
| M4 | รหัสธนาคารจากตาราง KBank เทียบรายการในแม่แบบ SCB | ได้แม่แบบจริง (G-1/G-3) | plan 2.2 |
| M5 | ตัวอย่างไฟล์ผลจริงของ SCB/KBank (PDF/CSV) | ขอจากร้านที่ยินยอม ลบข้อมูลส่วนตัวก่อน | plan 3.2 |
| M6 | เวลาล็อก 100 ต้นทางต่อธุรกรรม (G-12) | วัดบน local PostgreSQL ใน plan 1.5 ถ้าเกิน timeout ลดเพดานรายการ | plan 1.5 |
| M8 | ขอบเขตอะตอมระหว่างการบันทึกจ่ายกับการปิดงวดบัญชี (F1 รอบ 3) | การปิดงวดต้องถือล็อกร่วมกับการจ่าย — งานของสเปกปิดงวด (สมุดบัญชี/ปิดงวดไม่ได้ขาย ลูกค้าวันนี้ไม่กระทบ); งานนี้ทำได้แค่ตรวจงวดภายในธุรกรรมการจ่าย (Phase 0.4) | ก่อนขายสมุดบัญชี/ปิดงวด |
| M9 | ตัวเลข 28% ของกสิกรจาก PDF นักลงทุน | ผู้เขียนยังไม่ได้อ่าน PDF เอง | ก่อนใช้ในเอกสารขาย |
| M7 | `reimbursement-evidence.service.spec.ts` อยู่ใน whole-chain catalog (`scripts/line-ai-whole-chain-acceptance.catalog.mjs:545`) แต่ไม่อยู่ใน `apps/api/package.json` | test ใหม่ของ B4 ใส่ `reimbursement-request.use-case.spec.ts` ที่ลงทะเบียนแล้ว; ไฟล์เดิมที่ไม่ลงทะเบียนบันทึกไว้ ไม่แก้ในงานนี้ | plan 0.3 |

## 13. Bugs ที่พบในโค้ดปัจจุบัน

**B1 — API ของใบเตรียมจ่ายไม่กันเลขบัญชีในช่องชื่อธนาคาร/ชื่อบัญชี/ชื่อผู้รับ และไม่จำกัดความยาว · กลาง (PDPA)**
- `validateInput` (`disbursement-voucher.use-case.ts:44-60`) และ `account()` (`:115-126`) ตรวจแค่ชนิด string; ทางคัดลอกบัญชีจากใบเดิม (`payeeAccountFromVoucherId`) ยกชื่อเดิมมาโดยไม่ตรวจ (`:201-211`) — ใบเบิกกันทั้งสองอย่าง (`packages/contracts/src/reimbursements.ts:2041-2043`); หน้าเว็บจำกัดความยาวแล้ว (ชื่อบัญชี `maxLength={140}` `DisbursementVoucherAccountFields.tsx:69`, ธนาคารอื่น 80 `:66`) แต่ไม่กันเลขบัญชีและเรียก API ตรงได้ (F27)
- สถานการณ์: ชื่อบัญชี "บจก. เอ 123-4-56789-0" → ผู้มี `expense.disbursement.read` (เช่น นักบัญชี) เห็นเลขเต็มบนหน้าใบ (`packages/contracts/src/disbursement-vouchers.ts:187`) และ PDF โดยไม่ผ่าน audit; ข้อมูลที่บันทึกแล้วก็ยังพาไปแผ่นงานได้
- แก้: กติกาเดียวกับใบเบิกที่ API (รวมทางคัดลอก) + ตรวจข้อมูลที่บันทึกแล้วตอนเข้าชุด (`account_name_invalid`) · Phase 0.1

**B2 — เปิดเลขบัญชีเต็มของใบเตรียมจ่ายได้ทุกสถานะ · ต่ำ**
- `revealAccount` (`:159-172`) ไม่ดูสถานะ; `findVisible` ไม่กรอง (`prisma-disbursement-voucher.repository.ts:29-33`, `:117-118`)
- สถานการณ์: ผู้บันทึกจ่ายเปิดฉบับร่างของผู้จัดทำคนอื่นแล้วได้เลขเต็ม — ต่างจากกติกาใบเบิกที่ร่างเป็นของผู้เบิกคนเดียว (`payout-destination.logic.ts:189-190`)
- แก้: ร่างเปิดได้เฉพาะผู้ที่แก้ใบได้; ยกเลิกแล้วเปิดไม่ได้; **PDF ของใบที่ยกเลิกก่อนจ่ายหรือร่างของคนอื่นคืนฉบับปิดบัง** แทนการเรียก `revealAccount` ที่ `:348` (ไม่ให้ PDF พัง) · **บัญชีแนะนำ (F6 รอบ 2)**: `payeeAccount()` (`apps/api/src/modules/expenses/infrastructure/prisma-disbursement-voucher.repository.ts:104-115`) เสนอบัญชีจากใบทุกสถานะรวม `CANCELLED` (`rank` `:111`) และปุ่มตาในฟอร์มขอเปิดเลขแบบ `prefill` (`apps/web/src/features/expenses/disbursement-vouchers/DisbursementVoucherAccountFields.tsx:30-41`) — ให้ `payeeAccount()` ไม่เสนอใบที่ยกเลิกและร่างของคนอื่น และคืน `canReveal` จากกติกาเดียวกับ `revealAccount` ให้เว็บใช้แทน `canRevealDisbursementAccount(permissions, 'DRAFT', …)` · Phase 0.2

**B4 — ไฟล์ของใบเตรียมจ่ายถูกเสนอและบันทึกเป็นใบเสร็จของใบเบิกได้ แล้วทำให้อนุมัติไม่ผ่าน · กลาง** (P1/F3 รอบ 2)
- ตัวเลือกไฟล์ร่างใบเบิกทาง LINE กันเฉพาะสลิปใบเบิก (`NOT_REIMBURSEMENT_PAYMENT_SLIP_WHERE` ที่ `line-reimbursement-draft-adapter.service.ts:797-802`) และการตรวจใบเสร็จกันเฉพาะสลิปใบเบิก (`reimbursement-evidence.service.ts:37-43`) แต่การผูกไฟล์เข้ารายจ่ายตอนอนุมัติปฏิเสธไฟล์ของใบเตรียมจ่าย (`attachment.logic.ts:97-98` `disbursement_file_link_outside`; `prisma-reimbursement.repository.ts:2388-2391` `if (conflict) throw`)
- สถานการณ์: การเงินอัปโหลดสลิปให้ใบเตรียมจ่ายของสาขา A แล้วสร้างใบเบิกของตัวเองทาง LINE ในสาขาเดียวกัน → สลิปนั้นอยู่ในตัวเลือก "ไฟล์" → เลือกแล้วบันทึกผ่าน → ผู้อนุมัติกดอนุมัติ → ผูกเข้ารายจ่ายไม่ได้ ใบเบิกค้าง
- แก้: `NOT_PAYMENT_EVIDENCE_WHERE` + การตรวจใบเสร็จปฏิเสธไฟล์ของใบเตรียมจ่ายและไฟล์ผลชุด (§5.7) · Phase 0.3

**B5 — การจ่ายรายจ่าย (รวมจ่ายตามใบเตรียมจ่าย) ไม่ตรวจงวดบัญชีที่ปิดแล้ว · ต่ำ (ปิดงวดไม่ได้ขาย)** (F1 รอบ 3)
- `recordPaymentInTransaction` (`apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts:670-723`) ตรวจแค่วันในอนาคต (`:545`) ขณะที่การยืนยันรายจ่ายตรวจงวด (`:3664`) และใบเบิกตรวจก่อนธุรกรรม (`prisma-reimbursement.repository.ts:3593`)
- สถานการณ์: ร้านที่ผู้ดูแลเปิดสมุดบัญชีปิดงวด ก.ย. แล้ว → บันทึกจ่ายใบเตรียมจ่ายลงวันที่ 30 ก.ย. ได้ → การลงบัญชีของการจ่ายนั้นค้างจนกว่าจะเปิดงวดใหม่
- แก้: ตรวจงวดในธุรกรรมการจ่ายรายจ่าย ด้วยกติกาเดียวกับใบเบิก + ข้อความ error ไทย · Phase 0.4 (อะตอมกับการปิดงวด = M8)

**B6 — คัดลอกบัญชีจากใบอื่นข้ามการตรวจสถานะ/เจ้าของได้ · ต่ำ** (F2 รอบ 3)
- ทางคัดลอก (`disbursement-voucher.use-case.ts:201-211`) ตรวจแค่ว่าอ่านใบต้นทางได้และผู้รับตรงกัน (`:202`) แล้วคัดลอก ciphertext (`:211`) — ผู้จัดทำส่ง `payeeAccountFromVoucherId` ของใบที่ยกเลิกหรือร่างของคนอื่นตรง ๆ ได้ แล้วเปิดเลขจากร่างของตัวเอง ข้ามการกรองบัญชีแนะนำและกติกา reveal ของ B2
- แก้: ทางคัดลอกใช้กติกาเดียวกับ `payeeAccount()`/`revealAccount` (ไม่ใช่ CANCELLED, ไม่ใช่ร่างของคนอื่น) · Phase 0.2

**B7 — ชื่อผู้รับที่ได้จากชื่อผู้ขาย (fallback) ไม่ถูกตรวจ · ต่ำ** (F8 รอบ 3)
- `payeeName: body.payeeName?.trim() || first.vendorNameSnapshot?.trim() || …` (`disbursement-voucher.use-case.ts:108`) — ไม่ส่ง `payeeName` แล้วชื่อผู้ขายที่มีเลขบัญชีกลายเป็นชื่อผู้รับบนใบ
- แก้: ตรวจชื่อผู้รับ **ค่าสุดท้ายหลัง fallback** ด้วยกติกา B1; ไม่ผ่าน → `disbursement_payee_name_invalid` "ชื่อผู้รับดูเหมือนมีเลขบัญชี พิมพ์ชื่อผู้รับใหม่" · Phase 0.1

**B3 — นำเข้ารายการเดินบัญชีรับ `preset` แต่ไม่ใช้ และเว็บไม่รับ XLSX · ต่ำ (ไม่ได้ขาย)**
- `statement-import.use-case.ts:30`, `statement.controller.ts:72` vs `bank-reconciliation-spec.md:566-577`; `StatementImportPanel.tsx:99` — ไม่แก้ในงานนี้ (G-8)

## 14. Test plan

ไฟล์ API ด้านล่างอยู่ในรายการ `apps/api/package.json` แล้ว **ยกเว้น** `line-ai-capability-manifest.spec.ts` ซึ่งลงทะเบียนใน whole-chain catalog (`scripts/line-ai-whole-chain-acceptance.catalog.mjs:398`) (F26) · web ใช้ glob `src/**/*.spec.ts` · ยังไม่ได้รัน (ไม่มี node_modules)

| ไฟล์ | เคส |
|---|---|
| `apps/api/src/modules/banking/domain/logic/banking.logic.spec.ts` | logic ล้วน: เหตุผลทุก code (รวม `account_name_invalid`), ปัดยอด, แถวแผ่นงานไม่มีคอลัมน์ต้องห้าม, ศูนย์นำหน้า, บรรทัดหักภาษี, digest canonical, ลายนิ้วมือใบเตรียมจ่ายไม่เปลี่ยนเมื่อแนบสลิป, ตาราง transition, ยอดในแผ่นงาน = เฉพาะ PENDING ตอนตรึง |
| `apps/api/src/modules/banking/presentation/http/banking.dtos.spec.ts` | DTO ทุกคำสั่ง, `outcomes` ว่าง → 400 |
| `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts` | B1 (รวมทางคัดลอก), B2 (รวม PDF ฉบับปิดบังของใบยกเลิก), ล็อก FILE_READY ใน `lifecycleAtomic` 4 คำสั่ง, ยอมเฉพาะ `paymentBatchItem` ที่ตรง, hook ทำ PAID / โยนเมื่อรายการไม่ PENDING (rollback), แนบสลิประหว่าง FILE_READY ไม่ทำให้รายการเสีย |
| `apps/api/src/modules/reimbursements/application/use-cases/reimbursement-finance.use-case.spec.ts` | preview `evidence: 'deferred'` ผ่านโดยไม่มีสลิป; ทางปกติยังบังคับสลิป; จ่ายผ่านชุดด้วย `batchEvidence` ที่ตรวจใต้ล็อก (ไฟล์ผลของชุดอื่น/ถูกลบ/รายการไม่ PENDING → ปฏิเสธ); `paymentBatchItemId` ใน replay; อำนาจจ่ายของผู้ที่เป็นผู้อนุมัติใบนั้นด้วย (F8); ดาวน์โหลดซ้ำ audit ล้ม → ไม่มีไฟล์ |
| `apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.spec.ts` | ยกเลิกใบเบิกถูกล็อกพร้อมข้อความ "ติดต่อ {ชื่อ}"; DRAFT ไม่ล็อก; B4: บันทึกบรรทัดใบเบิกด้วยสลิป/ไฟล์ประกอบของใบเตรียมจ่าย หรือไฟล์ผลชุด → `invalid_primary_attachment` |
| `apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.draft-submit-race.spec.ts` (PG จริง; อยู่ใน `apps/api/package.json` `pretest`; สร้าง `LineReimbursementDraftAdapterService` อยู่แล้ว) | B4: ไฟล์ของใบเตรียมจ่ายและไฟล์ผลชุดไม่อยู่ในตัวเลือกไฟล์ร่างใบเบิก LINE (F6 รอบ 3 — ไม่ใช้ `line-reimbursement-draft-adapter.pg.spec.ts` ที่อยู่แค่ใน catalog) |
| `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` (อยู่ใน `apps/api/package.json` และ catalog) | P16: ข้อความที่ส่งจริงของทางตอบเหตุผลต่อเนื่องมีปุ่ม `webPath` เมื่อ refusal มี; ทางสลิปต่อเนื่องใช้ `webLabel` ที่ส่งมา |
| `apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.draft-submit-race.spec.ts` (PostgreSQL จริง; อยู่ใน `pretest`, `test:reimbursement-compatibility`) | unique `openSourceKey` สองชุดพร้อมกัน; CHECK ทั้งสี่ (รวม CLOSED ไม่มีข้อมูลดาวน์โหลด F5); **แข่งกัน**: จ่ายปกติ vs ดาวน์โหลดครั้งแรก (F3), "สำเร็จ" vs "ไม่สำเร็จ" แถวเดียวกัน (F2) — ผลต้องเป็นอย่างใดอย่างหนึ่งเสมอ; ยกเลิกใบเบิกระหว่าง FILE_READY ถูกปฏิเสธ; ciphertext ตรึงถูกลบเมื่อชุดจบ; **F2 รอบ 2 / F3 รอบ 3**: จ่าย vs นำออก รายการเดียวกัน, จ่าย vs ยกเลิก/ปิดชุด, **จ่ายใบเบิกรายการสุดท้ายสองรายการพร้อมกันผ่าน `recordPaymentAtomic` จริง (Serializable)** — ทั้งคู่ PAID ไม่มี 409 หลุดถึงผู้ใช้ในทางชุด (ลองใหม่ ≤3), `closeBatchIfDone` ปิดชุดครั้งเดียว ไม่ค้าง และไม่มี deadlock; B5: จ่ายใบเตรียมจ่ายลงวันที่ในงวดที่ปิด → ปฏิเสธ; F4: ทุกรายการที่ได้ผลมี `resultAttachmentId`/`resultsCommandId` ของรอบตัวเอง; F5: ดาวน์โหลดหลังชุดจบได้ 409 |
| `apps/api/src/modules/auth/permission-registry.spec.ts`, `apps/api/src/modules/employee-access/domain/logic/menu-entitlement-binding.spec.ts` | ผ่านโดยไม่แก้ |
| `apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-attachment.repository.spec.ts` (อยู่ใน `apps/api/package.json` แล้ว) | ไฟล์ผลชุด: ดาวน์โหลดทั่วไปถูกปฏิเสธ, ลบถูกปฏิเสธ, ผูกเป้าอื่นถูกปฏิเสธ, ไม่ถูกเสนอเป็นไฟล์แนบใบเบิกใน LINE |
| `apps/api/src/modules/line-ai/line-ai-capability-manifest.spec.ts` (whole-chain catalog) | manifest ตรงไฟล์ตรึง |
| `apps/api/src/modules/expenses/application/use-cases/line-draft-update.security.spec.ts` (ทดสอบคำสั่งใบเตรียมจ่ายทาง LINE อยู่แล้ว `:1364-1378`; อยู่ใน `apps/api/package.json`) | refusal ของ `payment_batch_source_locked` มี `webPath` เมื่อเปิดชุดได้ และไม่มีเมื่อเปิดไม่ได้ ทั้ง preview และ signed confirm |
| web ใหม่ `apps/web/src/features/payment-batches/payment-batch.logic.spec.ts` | ป้าย/ข้อความ §10.7, สามสถานะผล, ส่งเฉพาะแถวที่เลือก, ยอดในแผ่นงานแสดงเมื่อต่าง |
| journey ใหม่ `e2e/journeys/pay-many-by-bank-file.journey.spec.ts` | A, A2 (บันทึกสองรอบ), B, D ที่ **390, 1280, 1536** px ด้วย `expectFitsScreen` และภาพหน้าจอที่ตรวจแล้วของทุกหน้าจอ/กล่องที่เปลี่ยน (F22) |
| `node scripts/run-line-ai-whole-chain-acceptance.mjs` | ต้องผ่าน |

ตรวจด้วยมือ: เปิดแผ่นงานใน Excel/Numbers (ศูนย์นำหน้า); ผู้ควบคุมกดเองบนจอจริงทั้งสามความกว้าง

## 15. Acceptance criteria

1. ปุ่ม "จ่ายหลายรายการ" ตาม §10.1 เฉพาะผู้มีสิทธิ์และมีรายการ
2. หน้าเลือกแสดงเฉพาะสาขาของผู้ใช้ แถวใช้ไม่ได้มีข้อความ+ทางออกทุกแถว; ใบเบิกที่โอนแต่ยังไม่มีสลิปเลือกได้ (F7)
3. 1–100 รายการ; ใบเดียวกันเข้าสองชุดที่เปิดไม่ได้ (real PG)
4. แผ่นงานมีเฉพาะคอลัมน์ §5.4 และเฉพาะรายการที่ PENDING ตอนดาวน์โหลดครั้งแรก รวมเท่า `exportTotalAmount`; รายการที่จ่ายทางมือถือก่อนหน้าไม่อยู่ในแผ่นงาน (F4)
5. ดาวน์โหลดซ้ำได้แถวเดิมทุกตัวแม้ต้นทางของแถวที่ไม่สำเร็จถูกแก้ภายหลัง (F10); ciphertext ตรึงหายเมื่อชุดจบ
6. audit ทุกการดาวน์โหลด ไม่มีเลขเต็มใน metadata; audit ล้ม → ไม่มีไฟล์
7. หลังดาวน์โหลด ใบในชุดถูกปฏิเสธเมื่อจ่าย/แก้/ยกเลิกจากที่อื่น (เว็บและ LINE พร้อมปุ่มทางออก) แม้คำสั่งนั้นผ่านการตรวจก่อนล็อกไปแล้ว (F3)
8. "สำเร็จ" และ "ไม่สำเร็จ" ของแถวเดียวกันพร้อมกัน → ได้ผลเดียว; ไม่มีการจ่ายค้างกับรายการ FAILED (F2)
9. ใบเบิกที่จ่ายผ่านแผ่นงานบันทึกได้โดยไม่มีสลิปเมื่อไฟล์ผลของชุดผ่านการตรวจใต้ล็อก (Q2) และผู้เบิกได้แจ้งเตือนเดิมหนึ่งครั้ง (F6)
10. บันทึกผลเป็นรอบได้ แถวที่ยังไม่ทราบผลคงรอ (F14); ส่งซ้ำคำสั่งเดิมได้ผลเดิมแม้ version เดินไปแล้ว (F11)
11. ชุดที่จ่ายครบทางมือถือปิดเองโดยไม่มีข้อมูลดาวน์โหลด (F5)
12. ไฟล์ผลเปิดได้เฉพาะผู้ที่เปิดชุดได้ ลบ/ผูกใหม่/ดาวน์โหลดทั่วไปไม่ได้ (F1)
13. ผู้จ่ายที่เป็นผู้อนุมัติใบเบิกนั้นด้วยดาวน์โหลดได้ (F8)
14. ไม่มี env/สวิตช์ใหม่; ทุกแพ็กเท่ากัน; เมนู starter เท่าเดิม
15. 390/1280/1536 px ไม่มีเลื่อนแนวนอน หน้าเต็มพื้นที่ ปุ่มกลุ่มเท่ากัน ปุ่มฟอร์มในแถบล่าง ไม่มีเมนูที่ซ่อนการกระทำเดียว (F22)
16. B1 (รวมทางคัดลอกและข้อมูลที่บันทึกแล้ว), B2 (PDF ใบยกเลิกยังได้ฉบับปิดบัง) แก้พร้อม test
17. W00 ตรงและ whole-chain ผ่าน; การ์ด LINE DRAFT สองใบรอเจ้าของตรวจ ปุ่มเปิดคู่มือ; การ์ดที่ตอบ "ได้ค่ะ" ไม่มีคำถามเรื่องเชื่อมธนาคาร
18. จ่ายใบเบิกผ่านชุดโดยไม่มีสลิปไม่ล้มที่ preflight ของ use-case และหลักฐานยังตรวจจริงใต้ล็อก (F1 รอบ 2)
19. ปิดชุดที่มีรายการจ่ายแล้ว: เฉพาะรายการที่ยังไม่จ่ายออก การจ่ายที่บันทึกแล้วคงอยู่ (F8)
20. ไฟล์ของใบเตรียมจ่ายและไฟล์ผลชุดเลือก/บันทึกเป็นใบเสร็จใบเบิกไม่ได้ (B4); บัญชีแนะนำไม่มาจากใบที่ยกเลิก และส่ง `payeeAccountFromVoucherId` ของใบที่ยกเลิก/ร่างคนอื่นตรง ๆ ก็ถูกปฏิเสธ (B6)
21. CLOSED ที่ปิดด้วย "ปิดชุด" ไม่แสดง "บันทึกผลครบแล้ว" และแสดงจำนวนที่กลับไปรอจ่าย (F5 รอบ 3); `POST :id/close` และ `actions.close` ตาม §7 (F4 รอบ 3)
22. เปิด `/payment-batches…` โดยไม่มีสิทธิ์จ่ายทั้งสองแบบ เห็นสถานะไม่มีสิทธิ์ของ workspace (F7 รอบ 3)
23. ชื่อผู้รับที่ได้จาก fallback ชื่อผู้ขายถูกตรวจ (B7); การจ่ายรายจ่ายในงวดที่ปิดถูกปฏิเสธ (B5)

## 16. ความเสี่ยงและการปล่อยใช้

- **โอนซ้ำนอกระบบ**: ลดด้วยล็อก, คำเตือน, ไม่มีแผ่นงานเฉพาะที่เหลือ — กันไม่ได้ทั้งหมด และข้อความไม่อ้างว่ากันได้
- **แผ่นงานที่มีเลขบัญชีหลุด**: ไม่เก็บไฟล์, ciphertext ตรึงอยู่เฉพาะขณะชุดเปิด, audit ทุกครั้ง, ข้อมูลเท่าที่จำเป็น
- **ล็อกจำนวนมากในธุรกรรมเดียว** (สูงสุด 100 ต้นทางตอนดาวน์โหลด/ยกเลิก): เรียง key ป้องกัน deadlock, ไม่ทำงานช้า (ถอดรหัส/สร้างไฟล์) ในธุรกรรม, timeout ตามแบบ `attachSlipAtomic` (20 วินาที)
- **ใบถูกล็อกค้าง**: เจ้าของร้านเปิดชุดได้เสมอ; รายการชุด FILE_READY เกิน 3 วันขึ้นก่อน
- **ข้อยกเว้นสลิป (Q2) = ไม่**: ทางแผ่นงานของใบเบิกต้องแนบสลิปต่อแถว (เพิ่มช่องแนบต่อแถว)
- **แผ่นงานไม่ใช่ไฟล์นำเข้า**: ผู้ใช้ต้องกรอก/คัดลอกเอง จนกว่า Phase 2/3
- การปล่อย: migration เพิ่มอย่างเดียว; ย้อนรุ่นขณะมีชุด FILE_READY ทำให้ล็อกหายชั่วคราว — บันทึกผลหรือยกเลิกชุดที่ค้างก่อนย้อน; ไม่มีสวิตช์; UAT ก่อน และขอเจ้าของก่อน Production

## 17. คำถามสำหรับเจ้าของ

| # | คำถาม | คำแนะนำ |
|---|---|---|
| Q1 | รูปแบบเฉพาะธนาคารไหนก่อน หลังแผ่นงานทุกธนาคาร | **SCB Business Anywhere ก่อน** แล้วกสิกร KCC+ — ถ้าคุณหรือร้านใกล้ตัวมีบัญชี SCB Business Anywhere ขอไฟล์แม่แบบมาตรวจหนึ่งชุด |
| Q2 | ใบเบิกที่จ่ายผ่านแผ่นงาน ให้ไฟล์ผลจากธนาคารของชุดแทนสลิปรายใบได้ไหม (ปรับ D3 เฉพาะกรณีนี้) | **ได้** — ไฟล์อยู่ที่ชุด เห็นเฉพาะผู้จ่าย ระบบตรวจไฟล์ใต้ล็อกการจ่าย ผู้เบิกไม่เห็นข้อมูลเพื่อน |
| Q3 | ต้องมีสิทธิ์แยก "ดาวน์โหลดแผ่นงานโอน" ไหม | **ไม่ต้อง** — ผู้จ่ายเปิดเลขทีละใบได้อยู่แล้ว ใช้กติกาอำนาจจ่ายเดียวกันและ audit ทุกครั้ง |
| Q4 | เริ่มเป็นพันธมิตรธนาคาร (แบบ FlowAccount × กสิกร) ตอนนี้ไหม | **ยังไม่** — วัดการใช้ชุดโอน 3 เดือนก่อน; Your Data สำหรับ SME กำหนดไม่เกิน 31 มี.ค. 2571 แต่วันที่เชื่อมได้จริงยังไม่มีใครยืนยัน |
| Q5 | ใส่เบอร์/อีเมลผู้รับในแผ่นงานเพื่อให้ธนาคารแจ้งผู้รับไหม | **ไม่ใส่** — ข้อมูลเกินจำเป็น และผู้เบิกได้แจ้งเตือนจากระบบอยู่แล้ว |
