# WatchDog-BMS — Merged Security Findings & Remediation Checklist

> **Confidential / defensive use only.** เอกสารนี้รวม trust boundary, production evidence และ attack-chain verification ที่ไม่ควรเผยแพร่นอกทีมที่เกี่ยวข้อง

- **วันที่รวม:** 2026-07-17 (Asia/Bangkok)
- **Commit ที่ใช้เป็น baseline:** `d5b2f546fff5254ff31a61a2904b6d3a3253b32c`
- **ไฟล์ตั้ง:** `docs/security-assessment-independent-verification-2026-07-17.md`
- **ไฟล์ที่นำมารวม:** `docs/security-assessment-redteam-2026-07-17.md` (Opus 4.8)
- **ขอบเขต:** code, design, package/dependency, secret, container, AWS infrastructure, configuration, API/web, logging/monitoring, AI agents, penetration scenarios, compliance และ production risk
- **สถานะ production:** **Stop-ship / Very High risk** จนกว่าจะปิด P0 และมีหลักฐาน regression/deployment verification
- **การเปลี่ยนแปลงระบบ:** H-01 ถึง H-03 และ H-15 แก้และ verify ใน local working tree แล้ว; ยังไม่ได้ deploy code/migration/configuration ไป production

## วิธีใช้ checklist

- `[ ]` = ยังเปิดอยู่และต้องมี owner/due date
- `[x]` ในหมวด disposition = ปิดเฉพาะข้อถกเถียง/claim แล้วจาก evidence ปัจจุบัน **ไม่ได้หมายความว่าแก้ระบบแล้ว**
- `Confirmed` = มี code/live evidence รองรับ, `New` = พบใน independent review แต่ไม่มีใน Opus, `Corrected` = ยืนยันแก่นของ finding แต่แก้ถ้อยคำ/ขอบเขต, `Latent` = ยังไม่ exploit ได้ใน tree ปัจจุบันแต่ต้องปิดก่อนเปิด capability, `Unknown` = หลักฐานยังไม่พอ
- ทุกข้อควรเติม `Owner`, `Due`, PR/change reference และ closure evidence ก่อนติ๊กเสร็จ
- Severity เป็นลำดับจัดงาน ไม่ใช่ certification; หาก architecture หรือ live configuration เปลี่ยนต้องประเมินใหม่

## 1. P0 — High-risk release blockers

### [x] H-01 — ปิด employee role-grant และ self-escalation

- **สถานะ / ที่มา:** Remediated and locally verified 2026-07-18; รวม Opus `H1` + `H2`
- **Owner / Due / change:** API/Auth / 2026-07-18 / local H-01 remediation working tree (PR/immutable CI artifact pending)
- **Affected assets/data/tenants:** employee create/update role-assignment API และ role/audit permission registry; ไม่มี data migration และใช้กับทุก company tenant
- **Rollback:** revert H-01 use-case/domain/registry changes and re-sync the previous permission registry; no schema rollback required
- **สาเหตุ:** create employee กันเพียง `OWNER`/`SYSTEM_ADMIN`; update guard ครอบ privileged permission แค่ people-management และไม่มี self-role rule
- **ผลกระทบ:** ผู้ถือสิทธิ์จัดการพนักงานแจกหรือย้ายตนเองไป `FINANCE`/`ACCOUNTANT` แล้วเข้าถึง financial mutation ได้
- **วิธีแก้:** บังคับ `privilege(grant) <= privilege(granter)`, ห้าม self-role mutation, role-grant allowlist และ maker-checker/step-up สำหรับ finance/ledger/tax roles
- **หลักฐาน:** `create-employee.use-case.ts:61-75`, `employee.controller.ts:46-56`, `update-employee.use-case.ts:31-63`, `packages/contracts/src/access-matrix.ts:200-214`
- **หลักฐานปิดงาน:** shared server guard บังคับ permission subset, protected-role denylist, self-role change deny (ยอมรับ unchanged no-op) และ OWNER-only `access.role.financial.assign`; success audit ระบุ granter/grantee/exact diff และ denied attempt ระบุ attempted roles/reason; focused security tests 54/54 และ full API regression tests 2010/2010 ผ่าน, API typecheck และ `git diff --check` ผ่าน
- **Residual release evidence:** ยังต้อง deploy immutable artifact, sync permission registry, verify sanitized denied-attempt telemetry และ retest `AC-01` ตาม authorized runbook ก่อน production release ตาม §10

### [x] H-02 — ปิด global chart-of-account poisoning จาก mass assignment

- **สถานะ / ที่มา:** New; independent `H-02` — **ปิดแล้ว 2026-07-18** (ดู `docs/agent-memory/h-02-chart-of-account-mass-assignment.md`)
- **สาเหตุ:** controller รับ `@Body() any`, use case และ Prisma spread body โดยไม่มี runtime allowlist ทำให้แก้ `companyId`, `isSystem`, code/class/normal balance ได้
- **ผลกระทบ:** tenant account ถูกทำเป็น global system account หรือทำ global lookup กำกวม กระทบหลาย tenant
- **วิธีแก้:** concrete DTO + `forbidNonWhitelisted`, explicit field mapping, immutable tenant/system fields, DB constraints และ migration/admin-only global account workflow
- **หลักฐาน:** `ledger.controller.ts:64-75`, `account.use-case.ts:72-80`, `prisma-ledger.repository.ts:102-104`
- **หลักฐานปิดงาน (บันทึก 2026-07-18):**
  - `ledger.dtos.ts` (`CreateChartOfAccountDto`/`UpdateChartOfAccountDto`) + global pipe → `ledger.dtos.spec.ts` ปฏิเสธทุก field นอก allowlist, ปฏิเสธ explicit `null` บนคอลัมน์ NOT NULL, ยังยอม `null` เพื่อ clear คอลัมน์ nullable (10/10 pass)
  - `updateAccount` ใน `prisma-ledger.repository.ts` เป็น explicit allowlist (ไม่มี spread เข้า Prisma); create hardcode `companyId: ctx.companyId, isSystem: false, isControlled: false` — ยืนยันด้วย `account.use-case.spec.ts`
  - Create ตรวจ `parentAccountId` ว่าเป็นบัญชีใน tenant เดียวกันหรือ system account เท่านั้น (กัน cross-tenant hierarchy edge; พบจาก review)
  - Migration `20260718090000_h02_coa_company_or_system_check`: CHECK `companyId IS NOT NULL OR isSystem = true` + pre-check DO block ที่ fail พร้อมคำสั่ง triage; ทดสอบบน local DB ครบ 3 ทาง (ปฏิเสธ row กำกวม / ยอมรับ system row / RAISE เมื่อมี row เสียก่อน ADD) และ idempotent re-run ผ่าน
  - Global system account สร้างได้ทาง migration/seed เท่านั้น — ไม่มี API path (ตรง admin-only workflow)
  - **ก่อน deploy prod:** รัน `SELECT count(*) FROM "ChartOfAccount" WHERE "companyId" IS NULL AND "isSystem" = false;` — ถ้า >0 ต้อง triage ก่อน มิฉะนั้น migration จะ fail-closed (by design)
  - **Tracking gap ที่พบจาก review:** `POST posting/generate` (`ledger.controller.ts`) ยังรับ `@Body() any` และไม่มี checklist item เป็นเจ้าของ (ไม่อยู่ใน H-02/H-03; mitigated ที่ use case ผ่าน `canonicalSource` re-resolve) — ควรเพิ่ม DTO หรือระบุเจ้าของเมื่อทำ H-03

### [x] H-03 — บังคับ tenant/branch/provenance invariant บน manual journal

- **สถานะ / ที่มา:** Remediated and locally verified 2026-07-18; independent `H-03`
- **Owner / Due / change:** API/Ledger / 2026-07-18 / local H-03 remediation working tree (PR/immutable CI artifact pending)
- **Affected assets/data/tenants:** manual-journal create/post API, ledger contract, accounting period/journal/account/branch integrity และทุก company tenant; migration fail-closed เมื่อพบ historical mismatch และไม่แก้ ownership อัตโนมัติ
- **Rollback:** ก่อนมี write ใหม่ให้ drop H-03 triggers/composite FKs แล้วคืน single-ID FKs พร้อม revert app/schema; หลังมี write ใหม่ห้าม blind rollback ต้องตรวจ tenant/account/branch coherence และ backup ก่อน
- **สาเหตุ:** manual journal ตรวจ arithmetic balance แต่ไม่ resolve ownership/status ของทุก account, ไม่บังคับ branch scope และรับ source/tax/report metadata จาก caller
- **ผลกระทบ:** foreign account ID ทำให้รายงาน tenant ปัจจุบันตัด entry บางขา เกิด trial-balance/P&L corruption
- **วิธีแก้:** resolve account server-side ทุก line, enforce active/posting/company-or-approved-system account และ branch scope ทั้ง create/post, server-owned provenance/tax fields, composite tenant FKs
- **หลักฐาน:** `journal.use-case.ts:167-225`, `prisma-ledger.repository.ts:182-226`, `schema.prisma:2186-2235`
- **หลักฐานปิดงาน:** manual DTO/contract รับเฉพาะ account/branch/description/money/currency/date/memo; shared guard re-resolve active posting account และ active company branch พร้อม ABAC ทั้ง create/post; manual source/tax/report/tenant/actor/status เป็น server-owned; period/journal/branch ใช้ composite tenant FK และ local-or-approved-global account ใช้ DB trigger. H-03 negative/reconciliation tests 10/10 (focused suite รวม H-02 = 17/17), full API regression 2023/2023, API/contracts typecheck, Prisma validate/generate และ `git diff --check` ผ่าน; migrations ทั้ง 67 รายการ deploy จาก empty PostgreSQL และ `prisma/verification/h03_manual_journal_invariants.sql` ยืนยัน foreign period/account/branch, forged provenance และ inactive-account post ถูกปฏิเสธ ขณะที่ approved system account ผ่าน
- **Review evidence:** ไล่ทุก `createJournalEntry`/`postJournalEntry` caller แล้ว; public manual path มี concrete DTO และ use-case allowlist, generated/reversal path ไม่รับ manual payload; web ยังไม่มี manual-journal form/E2E path จึงไม่มี UI state ที่ต้องแก้ในข้อนี้
- **Residual release evidence:** ยังต้อง deploy immutable artifact, รัน migration preflight/backup บน production-like copy, ตรวจ fail-closed historical mismatch และ retest `AC-01` ตาม authorized runbook ก่อน production release

### [x] H-04 — ทำ payment/document void เป็น true reversal

- **สถานะ / ที่มา:** Confirmed and broadened; รวม Opus `H3` และ independent document-void finding
- **สาเหตุ:** payment void เปลี่ยน status แต่ไม่ย้อน allocation/paid/outstanding; document void ตั้ง `postingStatus='reversed'` โดยไม่ย้อน allocation หรือ GL
- **ผลกระทบ:** AR, cash, document state และ ledger ขัดกันและอาจใช้ซ่อนหนี้หรือเงิน
- **วิธีแก้:** idempotent reversal transaction, reversing journal, reverse/cancel allocation, recompute balances และเปลี่ยนสถานะเมื่อ side effects สำเร็จครบเท่านั้น
- **หลักฐาน:** `payment.use-case.ts:75-98`, `prisma-accounting.repository.ts:382-487`, `document.use-case.ts:292-315`
- **หลักฐานปิดงาน:** invariant tests ก่อน/หลัง void, retry/idempotency/concurrency tests และ accounting reconciliation
- **ปิดงาน 2026-07-18 (session H-04):**
  - Implementation: `voidPaymentTrueReversal`/`voidDocumentTrueReversal` ใน `prisma-accounting.repository.ts` — CAS status claim + allocation release + balance restore + reversing journal ใน `$transaction` (Serializable) เดียว; ตัดสิน reversal จากตาราง `JournalEntry` (GENERATED+POSTED ต่อ source) ไม่ใช่ pointer; `postingStatus='reversed'` เฉพาะเมื่อ reversal เกิดจริง (เลิกตั้งค่าโกหกใน `updateDocumentStatus`); doc void ปลด allocation คืนเป็น unapplied credit (+outbox event มี currency); payment void คืน paidAmount/outstanding/paymentStatus ของเอกสาร; ledger entry number ผ่าน reserve→commit/cancel lifecycle (`CancelDocumentNumberUseCase` สำหรับ RESERVED)
  - Fail-closed guards ใน tx: accounting period ไม่ OPEN/REOPENED, period row หาย, PP30 FILED/PAID/CLOSED (tax-relevant), TAX_INVOICE มี CN/DN ค้าง, posting state เปลี่ยนกลางคัน, GENERATED journal ค้างสถานะไม่ POSTED
  - Original journal คง POSTED (report queries นับเฉพาะ POSTED → original+reversal net 0); idempotency ผ่าน unique `[companyId,sourceType,sourceId,entryType]` (REVERSAL 1 แถว/แหล่ง); `buildDocumentPostingInput` ปฏิเสธเอกสาร VOIDED เป็น posting source (ปิดรู posting rule สร้าง journal ให้เอกสาร void)
  - Tests: unit 21/21 (`prisma-accounting.repository.void.spec.ts`, `void-true-reversal.use-case.spec.ts` — ลงทะเบียนใน test list แล้ว), full API suite 2048/2048, typecheck clean; live DB 16/16 (concurrent double-void race ชนะ 1 เดียว, rollback ครบเมื่อ period ปิด, per-account GL net=0 หลัง void ทั้ง payment และ document, unique constraint กัน REVERSAL ซ้ำ)
  - 8-angle review + verify แล้ว; แก้ CONFIRMED 4 เรื่อง (cancel-vs-void number lifecycle, period-null fail-open, VOIDED-doc posting hole, currency หายจาก unapplied event)
  - **Tracking gaps (นอก scope H-04, มี task chip แล้ว):** ~~expense void~~ (ปิดแล้ว 2026-07-18 — ดู bullet ถัดไป) และ ~~vendor-bill void~~ (ปิดแล้ว 2026-07-18 — ดู bullet H-04-vendor-bill) ~~ยังเป็น status-flip ไม่มี reversal~~; `IssueDocumentUseCase` catch ใช้ voidNumber กับเลข RESERVED (mask error); `createJournalEntry` ใน ledger repo พังบน Prisma 7 (nested-create companyId); `ReverseJournalUseCase` mark REVERSED ทำ report double-subtract; PP30 lock set (FILED/PAID/CLOSED) ไม่ครอบ EXPORTED/REVIEWED/AMENDED — คง parity กับ issue path ไว้ก่อน
- **ปิด vendor-bill-void gap 2026-07-18 (session H-04-vendor-bill):** `voidVendorBillTrueReversal` + `listVendorBillJournalsForReversal` ใน `prisma-procurement.repository.ts` (CAS claim `APPROVED`+`paidAmount=0`→VOIDED ใน Serializable tx เดียว; ตัดสิน reversal จากตาราง `JournalEntry` GENERATED+POSTED ของ `procurement.vendor_bill` และ `procurement.vendor_bill.commercial`; original คง POSTED; REVERSAL row เดิม = already-reversed marker; PP30 lock เมื่อบิลมี VAT, accounting-period lock เสมอ; `postingStatus='reversed'` เฉพาะเมื่อ reversal มีจริง); `VoidVendorBillUseCase` reserve→commit/cancel เลข `ledger.journal` ต่อ journal + outbox `vendor_bill.voided` + audit CRITICAL; `updateVendorBillStatus` ปฏิเสธ VOIDED; **พบและแก้ `voidSupplierPayment` พังจริงบน Prisma 7.8** (nested line create ใส่ `companyId` → `Unknown argument`, พิสูจน์กับ DB จริง) ด้วย shared helper `reversalJournalLineData`; tests: unit 17 (`vendor-bill-void-reversal.repository.spec.ts`, `void-vendor-bill.use-case.spec.ts` ลงทะเบียนใน test list แล้ว + companyId regression ใน pp36 spec), full suite 2083/2083, live DB :15432 14/14 (race ชนะ 1, rollback งวดปิด, PP30 FILED lock, net=0, supplier-payment void จริงบน Prisma 7.8)
- **ปิด expense-void gap 2026-07-18 (session H-04-expense):** `voidExpenseTrueReversal` + `findPostedGeneratedJournalId` + `reverseExpenseJournalInTx` ใน `prisma-expense.repository.ts` (CAS CONFIRMED→VOIDED, ศูนย์ paid/outstanding + `paymentStatus=VOIDED`, reversal POSTED ใน Serializable tx เดียว, original คง POSTED, `postingStatus='reversed'` เฉพาะเมื่อ reversal เกิดจริง, `updateExpense` ปฏิเสธ status VOIDED); `VoidExpenseUseCase` reserve→commit/cancel เลข `ledger.journal` (Cancel สำหรับ RESERVED); tax-period lock จาก `taxComponentsJson` reportContributions (PP30/PP36/CUSTOMS_SUPPORT) + fallback CLAIMABLE&vatAmount≠0→PP30; tests: unit 18/18 (`prisma-expense.repository.void.spec.ts`, `void-expense-true-reversal.use-case.spec.ts` ลงทะเบียนใน test list แล้ว), full suite 2068/2068, live DB :15432 29/29 (race ชนะ 1, rollback งวดปิด/PP30 FILED, net=0, number lifecycle, unposted expense ไม่แตะ ledger)

### [x] H-05 — ใส่ runtime/business validation ให้ money inputs

- **สถานะ / ที่มา:** Corrected; Opus `M1` ยกระดับเป็น High — **ปิดแล้วและ verify ใน local 2026-07-18** (ดู `docs/agent-memory/h-05-money-input-validation.md`)
- **Owner / affected scope:** API/Accounting / public accounting document-payment create routes, nested line money, allocation state/direction และ downstream AR/tax source facts
- **Rollback:** revert DTO/use-case/domain guard ได้โดยไม่แตะ schema/data; ไม่มี migration แต่ห้าม rollback หลัง release หากยังไม่มี equivalent edge + business validation
- **สาเหตุ:** money modules ใช้ plain TypeScript types ทำให้ global `ValidationPipe` ไม่มี runtime metadata; use case บาง path ไม่ตรวจ sign, bound, currency precision, direction และ target state
- **ผลกระทบ:** negative payment corrupt AR/payment/allocation และ document/tax values บางเส้นทาง
- **ข้อโต้แย้ง + evidence:** Claim เดิมว่า negative generated journal กลายเป็น valid posted GL และ malformed/NaN “ผ่านหมด” กว้างเกินจริง; `journal.use-case.ts:430-435` และ `journal-balance.logic.ts:31-57` ปฏิเสธ negative ledger lines ขณะที่ Prisma ปฏิเสธ malformed decimal บางแบบ
- **วิธีแก้:** class DTO/decimal validator, `>0`, business cap, precision/currency, valid target state/direction และ revalidate ใน use case ก่อน transaction
- **หลักฐานปิดงาน:** concrete nested DTO ใช้ global whitelist/forbid-non-whitelisted และ shared Decimal guard บังคับ THB scale 2, quantity scale 4, positive payment/quantity/unit price, non-negative discount ที่ต่ำกว่า subtotal, rate 0–100 และ document/schema bound; payment allocation รับเฉพาะ `RECEIVED` → issued `INVOICE|BILLING_NOTE|DEBIT_NOTE` ที่ currency/counterparty ตรงและมียอดค้าง ขณะที่ overpayment ยังสร้าง unapplied credit ตาม spec; use case revalidate ก่อน persistence
- **Verification / review:** H-05 boundary/business/use-case suite 10/10; API regression 2,042/2,042; API typecheck และ scoped `git diff --check` ผ่าน. Caller review พบ public mutation ผ่าน concrete DTO, internal conversion ใช้ persisted validated lines; web ส่ง THB/positive values, จำกัด action ที่ issued receivable และมี error state อยู่แล้ว จึงไม่ต้องแก้ UI/E2E เพิ่ม
- **Residual release evidence:** ยังต้อง deploy immutable artifact และ rerun authorized `AC-01`; production deployment/penetration retest ไม่ได้ทำในงาน local นี้

### [x] H-06 — ทำ reimbursement payment atomic และ idempotent

- **สถานะ / ที่มา:** Corrected; Opus `M4` ยกระดับเป็น High — **ปิดแล้วและ verify ใน local 2026-07-18** (ดู `docs/agent-memory/h-06-reimbursement-payment-atomic-idempotent.md`)
- **Owner / affected scope:** API/Reimbursement / finance record-payment mutation, document-number retry และ reimbursement payment/request persistence
- **Rollback:** revert use-case/repository/schema migration ได้ก่อน production data ใช้ key ใหม่; หลัง deploy ต้องคง unique idempotency invariant หรือทำ reviewed data migration ก่อน rollback
- **สาเหตุ:** read → validate → create payment → update state ไม่อยู่ transaction/CAS/advisory lock เดียวกัน
- **ผลกระทบ:** concurrent requests หรือ partial failure หลังสร้าง payment/number ทำให้จ่ายซ้ำหรือ replay ได้
- **ข้อโต้แย้ง + evidence:** ordinary sequential replay หลัง request แรกสำเร็จไม่ใช่เส้นทางหลัก; precondition ที่พิสูจน์ได้คือ concurrency/partial failure จาก `reimbursement-finance.use-case.ts:133-218` และ `prisma-reimbursement.repository.ts:118-123,171-200`
- **วิธีแก้:** transaction + conditional state claim/CAS + per-request advisory lock + durable server-generated idempotency key
- **หลักฐานปิดงาน:** deterministic two-request race test, fault-injection ทุก boundary และ retry หลัง commit/timeout
- **Implementation evidence:** payment attempt key hash มาจาก company/request + client key หรือ server-owned request `updatedAt` (ไม่ใช้ `paidAt`); DB บังคับ unique `(companyId,idempotencyKey)` และ backfill legacy rows; repository re-read policy/duplicate/payment eligibility ใต้ advisory lock แล้วสร้าง payment, stable source ref และ CAS request totals/status ใน Serializable transaction เดียว; retry หลัง payment commit ใช้ payment/เลขเอกสารเดิมและ finalise reservation ที่ค้างได้
- **Verification / review:** focused reimbursement suite 15/15 และ full API regression จาก staged H-06 snapshot 2,084/2,084 ผ่าน ครอบ two-request race (สร้าง 1 payment), create/source-ref/CAS/CAS-conflict/readback rollback + retry, ambiguous DB commit timeout และ document-number commit timeout; API typecheck, Prisma schema validation และ scoped diff check ผ่าน. Caller review พบ web disable ปุ่มระหว่าง submit, ส่ง payload เดิมเมื่อผู้ใช้ retry และแสดง API error อยู่แล้ว; API fallback key จึงปิด race โดยไม่ต้องแก้ UI/E2E
- **Residual release evidence:** ต้อง apply migration บน pre-production backup/restore rehearsal, deploy immutable artifact และ rerun authorized concurrent payment retest; production deployment/penetration retest ไม่ได้ทำในงาน local นี้

### [x] H-07 — บังคับ maker-checker สำหรับ vendor bill และ payment release

- **สถานะ / ที่มา:** Corrected; Opus `M5` ยกระดับเป็น High — **ปิดแล้วและ verify ใน local 2026-07-18** (ดู `docs/agent-memory/h-07-vendor-bill-maker-checker.md`)
- **สาเหตุ:** submitter approve bill ตนเองได้ และ default finance role รวม create/approve/payment permissions
- **ผลกระทบ:** สร้างและอนุมัติ payable ปลอมโดยไม่มีผู้ตรวจคนที่สอง
- **ข้อโต้แย้ง + evidence:** “approve แล้ว pay ทันที” ไม่แม่น; payment recording เป็นอีก API call แต่ segregation-of-duties gap ยังคงจริง (`vendor-bill.use-case.ts:374-417`)
- **วิธีแก้:** persist submitter, approver ต้องต่างคน, configurable dual-approval threshold และแยก payment release permission
- **หลักฐานปิดงาน:** self-approve negative test, threshold/multi-approver tests และ audit chain submit→approve→pay
- **ปิดงาน 2026-07-18 (session H-07):**
  - **Persist submitter:** ใช้ `PurchaseApprovalEvent` (SUBMITTED ต่อรอบ) ที่ submit append อยู่แล้ว — ปรับให้ append **ก่อน** status change (PENDING bill ที่ไม่มี SUBMITTED event = รูให้ submitter ตัวจริงหลุด SoD; stray event บน DRAFT ไม่มีผล); bill เก่าไม่มี event ใช้ `createdByUserId` เป็น fallback (fail-safe)
  - **Approver ≠ submitter:** `ApproveVendorBillUseCase` block submitter ของรอบล่าสุด (403 `vendor_bill_self_approval_blocked`) โดย default; **ยกเว้นผู้ถือ role OWNER/ADMIN/MANAGER self-approve ได้เสมอ** (product decision 2026-07-18 — บริษัทคนน้อย; `canSelfApprove` ใน procurement.logic, audit ระบุ `selfApproved`+`selfApprovalRoleExempt`); role อื่นปลดได้ผ่าน `ProcurementApprovalPolicy.allowSelfApproval` (ตาราง+migration ใหม่, no row = fail-closed สำหรับ role อื่น, OWNER-only manage, audit CRITICAL) — pattern เดียวกับ `ReimbursementPolicy`; maker ก็ **verify tax evidence ของบิลตัวเองไม่ได้** (403 `vendor_bill_self_evidence_verify_blocked`, ยกเว้น role เดียวกัน) เพราะ approve path เชื่อ VERIFIED เป็นข้อเท็จจริงที่ตรวจแล้ว
  - **Dual-approval threshold:** `dualApprovalThresholdAmount` (null = ปิด) เทียบ `grandTotalAmount`; บิลถึง threshold ต้องมีผู้อนุมัติ **2 คนที่ไม่ใช่ submitter** (submitter ไม่นับเข้า quota แม้เปิด self-approval); approval แรกเป็น partial event (`vendor_bill.approval_recorded` + audit `dualApproval.final=false`), คนที่สอง finalize ผ่าน CAS เดิม; **approval ถูก pin กับ content ด้วย `vendorBillTaxSourceChecksum`** (event จากรอบ/เนื้อหาอื่นไม่นับ — กัน race reject→แก้ยอด→resubmit) และ **re-verify quota ในทรานแซกชัน CAS** ก่อน finalize; approver ซ้ำระหว่างรอ → 409 `vendor_bill_dual_approval_pending`
  - **แยก payment release permission:** `procurement.supplier_payment.release` (CRITICAL) ต้องมีเพิ่มจาก `create` ทั้ง controller (hasAll) และ use case; migration backfill grant release ให้ทุก role ที่ถือ create อยู่ (คง behavior เดิมของ custom/pack-compiled roles — boot `sync-permissions` ครอบเฉพาะ system roles); FINANCE + pack `ap_manage` ได้ release โดย default, org แยกหน้าที่ได้โดย revoke ราย role; permissions ใหม่: `approval_policy.read` (ADMIN/FINANCE/AUDITOR_READONLY), `approval_policy.manage` (OWNER เท่านั้น)
  - **Web:** ปุ่มอนุมัติแสดงข้อความเมื่อเป็น partial approval (รอผู้อนุมัติคนที่สอง), panel ตั้งค่านโยบาย (GET/PUT `vendor-bills/approval-policy`) บนหน้า AP, payment form gate เช็ค create+release
  - **Tests:** self-approve negative + creator-fallback + self-approve-allowed + dual threshold (partial/second-approver/duplicate-409/stale-checksum/submitter-excluded/resubmit-reset/in-txn re-verify) + submit event-first + evidence self-verify block + release permission negative + audit chain submit→approve→pay = `vendor-bill-maker-checker.use-case.spec.ts` 19/19 (ลงทะเบียนใน test list); full API suite 2113/2113; `test:item11b-tax` 240/240; typecheck API+web clean; live DB :15432 14/14 (policy upsert/merge/disable, unique ต่อบริษัท, trail ordering + threshold snapshot roundtrip)
  - **8-angle review + verify แล้ว; แก้ CONFIRMED 11 เรื่อง** (เด่น: stale-round approval race → checksum pinning + in-CAS quota re-verify; submitter นับเข้า dual quota เมื่อเปิด self-approval; ลำดับ submit event ไม่ fail-closed; custom role ไม่ได้ release → backfill; spec `supplier-payment-integrity` ใน `test:item11b-tax` แตก; threshold regex หลวมกว่า H-05 → ใช้ `POSITIVE_ACCOUNTING_QUANTITY_PATTERN`; defaults ซ้ำสองที่ → `PROCUREMENT_APPROVAL_POLICY_DEFAULTS`; web ไม่มี feedback/partial state + ไม่มี policy UI)
  - **Accepted residuals (บันทึกใน memory doc):** partial approval ที่ approver ถูก offboard ภายหลังยังนับ (point-in-time signature); double-partial พร้อมกันของ 2 คน = ต้องกดอนุมัติซ้ำอีกครั้งเพื่อ finalize (liveness ไม่ใช่ safety — in-CAS check กันเกิน quota ปลอม); ไม่มี notification ไปหาผู้อนุมัติคนที่สอง (product gap); reject/match-override ไม่มี SoD (reject-own = ถอนงานตัวเอง, override เห็นเป็นสถานะ OVERRIDDEN ต่อ approver + perm CRITICAL); FINANCE ยังถือ create+approve+release โดย default — การแยกจริงเป็น role-assignment ต่อองค์กร; **deploy note:** ~~บริษัท single-owner จะ approve บิลตัวเองไม่ได้~~ (แก้แล้ว 2026-07-18: OWNER/ADMIN/MANAGER self-approve ได้เสมอ — deploy ไม่ brick บริษัทคนน้อย; dual threshold ยังบังคับ 2 checkers เสมอถ้าเปิดใช้; tests 22/22, suite 2116/2116)

### [x] H-08 — ปิด reflected LIFF XSS และลด token theft impact

- **สถานะ / ที่มา:** New; independent `H-08`; หักล้าง claim เดิมว่าไม่พบ XSS — **ปิดและ verify ใน local 2026-07-18** (ดู `docs/agent-memory/h-08-liff-xss-token-theft.md`)
- **สาเหตุ:** query value ผ่าน `JSON.stringify` แล้วฝัง inline `<script>`; closing `</script>` ไม่ถูก escape และ CSP อนุญาต `'unsafe-inline'`
- **ผลกระทบ:** crafted LIFF link ที่เหยื่อเปิดสามารถรัน script หลัง LIFF SDK และขโมย LINE ID token/WatchDog session ได้ตาม identity ของเหยื่อ
- **ข้อโต้แย้ง + evidence:** Opus ระบุ “ไม่พบ XSS ที่ใช้งานได้จริง”; code boundary ที่ `auth.controller.ts:407-447` และ `customer-line-register.controller.ts:55-96` แสดง HTML parser breakout ได้โดยไม่พึ่ง React sink
- **วิธีแก้:** external static script/data attribute หรือ safe JSON script, escape `<` เป็น `\u003c`, nonce/hash CSP ไม่มี unsafe-inline และ validate token/channel format/length
- **หลักฐานปิดงาน:** browser regression ด้วย `</script>` payload ใน test environment, CSP test และยืนยัน token ไม่ออกนอก origin
- **Implementation evidence:** หน้า account/employee/customer LIFF ใช้ static client เดียวจาก same-origin `/v1/auth/line/link-page.js`; config อยู่ใน HTML-escaped data attributes ส่วน employee `token`/customer `lineChannelId` อ่านจาก URL ตอน runtime จึงไม่ถูกสะท้อนเข้า HTML/executable parser context. `script-src` ไม่มี `'unsafe-inline'`, page response เป็น `no-store` + `Referrer-Policy: no-referrer`, client บังคับ same-origin API base และลบ employee token จาก URL หลัง LIFF login พร้อมใช้งาน. DTO และ verifier บังคับ JWT shape/ความยาว LINE ID token, channel/company id allowlist และ employee token base64url 32 ตัวก่อน provider/repository work; public customer PDPA token boundary ใช้ invariant เดียวกัน
- **Verification / review:** focused controller/security tests 8/8, adjacent account/employee/customer-link tests 29/29, Chromium regression 2/2 และ full API suite 2,113/2,113 ผ่าน; API typecheck และ diff check ผ่าน. Browser test ยิง closing `</script>` payload ทั้งสอง sink, ยืนยันไม่มี inline executable script/CSP bypass และตรวจทุก subresource URL+headers ว่าไม่มี bearer query. Review ครบ account, employee, customer registration, PDPA และ provider-verifier paths โดยคง loading/error/button behavior เดิมและไม่เพิ่ม dependency
- **Residual release evidence:** ต้องทดสอบ real mobile LINE/LIFF บน authorized staging หลัง deploy และตรวจ LINE console/redirect allowlist/token TTL/revocation/provider logs ตาม `U-07`; งาน local นี้ไม่อ้างว่า production penetration retest เสร็จแล้ว

### [x] H-09 — เลิกส่ง LINE-link bearer token ให้ third party และแก้ claim race

- **สถานะ / ที่มา:** New; independent `H-09` — **ปิดและ verify ใน local 2026-07-18** (ดู `docs/agent-memory/h-09-line-link-qr-claim-race.md`)
- **สาเหตุ:** full bearer URL ถูกส่งเป็น query ไป `api.qrserver.com`; owner token อายุ 72 ชั่วโมง; identity link เกิดก่อน CAS mark-used
- **ผลกระทบ:** QR provider/CDN/log holder อาจ claim employee/OWNER link; concurrent LINE identities อาจเกิด side effect ก่อน loser รู้ว่า token ถูกใช้
- **วิธีแก้:** generate QR local/same-origin, ลด TTL, atomically claim ก่อน link, enforce identity cardinality และ compensation/rollback
- **หลักฐาน:** `employee-access.logic.ts:65-91`, `complete-employee-line-link.use-case.ts:22-88`, `EmployeeAccessPages.tsx:187-193`
- **หลักฐานปิดงาน:** network test ไม่มี bearer URL ออก third party และ concurrent two-identity race test มีผู้ชนะเพียงหนึ่งรายโดยไม่มี orphan link
- **Implementation evidence:** `buildLineLinkPackage` สร้าง QR local ด้วย `qrcode-generator` (zero-dep) เป็น SVG data URI + พื้นหลังขาว — ไม่มี `qrserver` เหลือใน source และ contract `qrImageUrl` เดิมใช้ได้ทุกจุดใน web โดยไม่แก้; owner TTL 72h→24h (`OWNER_LINE_LINK_TOKEN_TTL_MS`; regenerate reissue ได้); `complete-employee-line-link` CAS claim `PENDING→USED` **ก่อน** link, compensation คืน PENDING เฉพาะ pre-write failure (Conflict/Forbidden) — unknown error เผา token กัน restore ทับ link ที่ persist แล้ว และกัน garbage-idToken resurrect ข้าม revoke; หลัง restore เช็ค token ใหม่กว่า → self-REVOKE (ปิด reissue race); sever LINE identity เก่าหลัง link สำเร็จ + AUTH_IDENTITY_UNLINK ต่อแถว + self-heal ผ่าน rescan-grace (จำกัดเฉพาะ account ที่ `linkedAt >= usedAt` กันมือถือเก่ายึด QR); P2002→Conflict ใน `link-line-identity`; LINE verify fetch มี timeout 5s; จุดออก QR ใช้ `trustedPublicApiBase` (PUBLIC_BASE_URL ชนะ X-Forwarded-Host)
- **Verification / review:** focused specs 60/60 (claim-order, two-identity race one-winner, burn-on-unknown, restore+self-revoke, sever+audit, old-phone grace-deny, regenerate 24h TTL — spec ใหม่ลงทะเบียนใน test list แล้ว); full API suite ผ่าน (fail ที่เหลือเป็นไฟล์ H-11 session อื่นระหว่างแก้); live DB race 7/7 (2-way + 10-way stampede ผู้ชนะรายเดียว, restore/reclaim ถูกต้อง); QR สแกนได้จริง — decode SVG production ด้วย Apple CoreImage (อิสระจาก encoder) ได้ link URL ตรงเป๊ะ; typecheck ผ่าน; review 8 มุมมอง → CONFIRMED 8 แก้ครบ (restore-after-persisted-link, revoke TOCTOU, sever atomicity/self-heal, audit per-identity, XFH QR poisoning, verify timeout, QR transparent bg, stale doc)
- **Residual:** admin revoke แบบไม่ reissue ระหว่างหน้าต่าง claim→link ที่ล้มด้วย Conflict/Forbidden ยัง restore ได้ (bounded ด้วย expiresAt; revoke ซ้ำได้; reissue ถูกปิดด้วย newer-token check); regenerate-temporary-password rotate password ทั้งที่อยากได้แค่ QR ใหม่ (ไม่มี QR-only reissue path สำหรับ owner — spawn task แยกแล้ว); production ต้องตั้ง `PUBLIC_BASE_URL` เพื่อให้ QR host pinning ทำงาน (ไม่ตั้ง = fallback header เดิม)

### [ ] H-10 — ยกเลิกรหัสพนักงานจากวันเกิด

- **สถานะ / ที่มา:** New; independent `H-10`
- **สาเหตุ:** password = `DDMMYYYY`; credential ถูกสร้าง `ACTIVE`, `mustChangePassword=false`, `expiresAt=null`
- **ผลกระทบ:** ข้อมูลวันเกิดทำให้เดารหัสได้และ credential คงอยู่ถาวร
- **วิธีแก้:** invitation/high-entropy one-time secret, temporary state, short expiry, forced setup/change และ MFA/step-up
- **หลักฐาน:** `employee-access.logic.ts:45-49`, `create-employee.use-case.ts:93-110,196-204`
- **หลักฐานปิดงาน:** no-DOB unit test, expiry/replay tests และ first-login forced enrollment test

### [x] H-11 — ทำ uploaded evidence immutable และตรวจ bytes ฝั่ง provider/server

- **สถานะ / ที่มา:** Remediated and locally verified 2026-07-18; independent `H-11`
- **Owner / Due / change:** API/Data Model Core + Platform / 2026-07-18 / local H-11 remediation (PR/deployed immutable artifact pending)
- **Affected assets/data/tenants:** shared web/LINE attachment upload, expense/reimbursement/tax/signature evidence, local/MinIO/S3 object storage และทุก company tenant; migration เพิ่ม provider version pin และ unique bucket/object key โดยไม่ rewrite historical bytes
- **Rollback:** ก่อนมี H-11 uploads ให้ revert app/config/schema และ drop unique index/`objectVersionId`; หลังมี uploads ห้าม blind rollback เพราะ final `evidence/` keys และ pinned versions ต้องคง resolvable จนตรวจ retention/export ครบ
- **สาเหตุ:** presigned PUT bind แค่ Content-Type และ reusable หนึ่งชั่วโมง; completion เชื่อ client size/checksum; expense checksum hash attachment ID ไม่ใช่ bytes
- **ผลกระทบ:** oversized/pending-object DoS และเปลี่ยนหลักฐานหลัง review ภายใน URL lifetime
- **วิธีแก้:** content-length-range/provider checksum, HEAD verification, immutable/versioned final key, short single-purpose URL, quarantine/lifecycle/quota และ checksum จาก verified bytes
- **หลักฐาน:** `s3-storage.adapter.ts:37-47`, `complete-attachment-upload.use-case.ts:38-58`, `expense-status.logic.ts:20-57`
- **หลักฐานปิดงาน:** overwrite/reuse/oversize/checksum-mismatch tests และยืนยัน reviewed object version ถูก lock
- **หลักฐานปิดงาน 2026-07-18:** upload intent ใช้ TTL จาก config (default และ hard max 300s), signed exact `Content-Length` + `If-None-Match:*`, tenant pending-byte quota แบบ advisory-lock transaction และ `pending/` lifecycle; completion HEAD แล้วอ่าน version เดิม, hash bytes ฝั่ง server, quarantine เมื่อ size/MIME/provider checksum ไม่ตรง และไม่ใช้ client size/checksum; verified bytes ถูกเขียนใหม่เป็น create-only `evidence/<tenant>/<sha256>/<uuid>` พร้อม provider SHA-256, บังคับ bucket versioning และ persist `objectVersionId`; download/OCR/signature read pin version เดิม และ expense confirmation checksum รวม attachment byte checksum. Focused adversarial tests 55/55, adjacent upload/OCR/LINE tests 68/68, isolated full API 2,147/2,147 และ Web 288/288 ผ่าน; config tests 55/55, API/Web/Contracts typecheck, Prisma validate/generate, empty PostgreSQL migration 70/70 และ infra syntax/config checks ผ่าน
- **Review evidence:** ไล่ทุก `createUploadIntent`, `putObject`, `getObject` และ browser/LINE upload caller แล้ว; web ส่ง signed headers ครบโดยคง loading/error flows, LINE ส่ง exact downloaded bytes, server-generated substitute evidence persist version pin; final key ไม่มี public mutation API และ DB บังคับ unique bucket/object key
- **Residual release evidence:** ยังต้อง deploy clean immutable artifact, apply migration, verify production S3 versioning/lifecycle/CORS/provider checksum แบบ sanitized, inventory/backfill หรือ risk-accept historical ACTIVE rows ที่ไม่มี version pin, และ retest `AC-05`; งาน live bucket inventory/retention/access-log ที่กว้างกว่า H-11 ยังอยู่ `U-02`

### [ ] H-12 — ถอน persistent SYSTEM_ADMIN bootstrap reset ออกจาก startup

- **สถานะ / ที่มา:** New; independent `H-12`; confirmed live metadata โดยไม่อ่านค่า secret
- **สาเหตุ:** API start ทุกครั้ง upsert ACTIVE SYSTEM_ADMIN, overwrite password, `mustChangePassword=false`, no expiry; live secret rotation ปิด
- **ผลกระทบ:** restart/autoscale/deploy ย้อนรหัสที่เปลี่ยนเองและทำ bootstrap secret เป็น privileged credential ถาวร
- **วิธีแก้:** one-time bootstrap, ลบ startup reset/secret หลังใช้, rotate + revoke sessions, MFA/SSO และ monitored break-glass account
- **หลักฐาน:** `start-production.sh:10`, `start-combined-production.sh:8-10`, `reset-system-admin-password.ts:13-95`; live config พบ key `SEED_SYSTEM_ADMIN_PASSWORD`
- **หลักฐานปิดงาน:** restart ไม่เปลี่ยน credential, seed secret ถูกลบ/rotated, session revocation และ break-glass drill

### [x] H-13 — สร้าง dist-only production image จาก clean CI context

- **สถานะ / ที่มา:** New + corrected; รวม Opus `L9`, `I11`, `I12`
- **สาเหตุ:** `.dockerignore` ไม่ครอบ nested `.env`; `COPY . .` และ runtime copy app/node_modules/source/dev tooling ทั้ง tree; tag จาก dirty workstation ไม่สะท้อน untracked files
- **ผลกระทบ:** credential/config material, source และ admin/build tools อยู่ใน active artifact เพิ่ม blast radius
- **ข้อโต้แย้ง + evidence:** Opus ระบุ dev CVE/tooling ไม่อยู่ prod runtime แต่ active image มี `/app/apps/api/.env` mode `0644`, source, reset script, `tsx`, Prisma, SWC, `@hono/node-server@1.19.11`, `file-type@20.5.0` และ `21.3.4`; ยังไม่พิสูจน์ HTTP reachability ของ specific CVE
- **วิธีแก้:** `**/.env*`, clean checkout, explicit allowlist copy, dist + production dependencies only, scan final layers, rebuild และ rotate credential ที่เคยอยู่ใน image
- **หลักฐานปิดงาน:** image filesystem allowlist/SBOM ไม่มี `.env`, source, admin scripts หรือ dev tooling; old task/image retired และ credential rotation recorded
- [x] **Code/test review (2026-07-18):** production Dockerfiles ใช้ explicit build inputs + dist/standalone-only runner, production-only/no-optional dependency graph, clean committed-context helper, OCI revision, digest deploy, adversarial filesystem gate และ CI SBOM; isolated builds/scans ผ่านสำหรับ API/Web, API, Web, Lambda Web, AI Gateway และ Workers พร้อม runtime health `200` สำหรับ API/Web, AI Gateway และ Workers
- [x] **Manual live rollout (2026-07-19):** commit `84ba45b8` ถูก push แล้ว build จาก clean Git archive; release task revision 2 pin digest, inject เฉพาะ `DATABASE_URL`, ไม่มี task role และ exit `0` หลังยืนยัน 70 migrations/no pending, permission sync 321/12/1225 และ Thai Address 7436/7436. ECS active revisions pin digest ใหม่สำหรับ API/Web `2ba76ca1…`, AI Gateway `bdb63c78…`, Workers `0cae8d89…`; OCI revision ตรง full SHA, filesystem allowlist ผ่านจาก exact active digests, API ไม่มี `SEED_SYSTEM_ADMIN_PASSWORD`, old `49d0132f` tasks ถูก drain/stop, services stable 1/1 และ health ผ่าน (API DB `ok`) โดยไม่พบ error/fatal log ช่วง rollout
- [x] **CI-produced release artifact (2026-07-19):** production OIDC trust ผูก exact repository/environment และ role push/read ได้เฉพาะ 3 ECR repositories. Manual run `29693002687` สำหรับ commit `e655893f` ผ่าน test/security/config/image gates แล้ว push, pull-by-digest, filesystem/OCI-revision verify และสร้าง SPDX JSON SBOM จาก digest จริงครบ API/Web `1429498f…`, AI Gateway `cf292f96…`, Workers `f5cdab00…`; artifact `production-release-e655893f6c177a8515b16db2788335e3cd2592f5` มี verified digest manifest + 3 SBOMs และเก็บ 90 วัน
- [x] **CI-manifest live rollout + credential revocation (2026-07-19):** commit `6d66bdc7` เพิ่ม manifest gate แล้ว manual run `29693839618` ผ่านทุก gate/publisher; artifact `production-release-6d66bdc762990cad6ee7e716dd20448fe2d5e3c4` (id `8444448748`, expiry `2026-10-17`) ถูก revalidate ก่อน deploy. Release task revision 3 pin clean-archive digest `7667c873…`, มีเพียง `DATABASE_URL`, ไม่มี task role และ exit `0` หลัง 70 migrations/no pending, permission sync 321/12/1225 และ Thai Address 7436/7436. Active ECS pin exact CI digests API/Web `8516af4a…`, AI Gateway `1e2c4164…`, Workers `2fe1cec7…`, `GIT_SHA=6d66bdc76299`, running 1 task/service และ health ผ่าน (API DB `ok`). Image เก่า `49d0132f` พบ credential key เพียง `DATABASE_URL`; RDS master password + Secrets Manager version ถูก rotate/revoke แล้ว และ old pre-rotation tasks ถูก stop. ECR residual ของ Linux/amd64 manifests ยัง Critical 3/High 5/Medium 3 จาก Debian Perl/util-linux essential packages; rollout นี้รับทราบ residual ชั่วคราวภายใต้ release authorization ปัจจุบันและต้อง rebuild เมื่อ Debian มี fixed packages
- [x] **Compromised-image retirement (2026-07-19):** หลังยืนยันว่า active ECS Express ทั้งสาม service pin CI digests ของ `6d66bdc76299` แล้ว ลบ exact `49d0132f` digests จาก `watchdog-bms-api` (`19255401…`), `watchdog-bms-ai-gateway` (`4fb5b8f1…`) และ `watchdog-bms-workers` (`1a361858…`) สำเร็จโดย `failures: []`; `batch-get-image` ยืนยัน `ImageNotFound` ครบสามรายการ. Services ยัง `ACTIVE`, pin digest เดิม และ health ผ่าน (API DB `ok`, AI Gateway/Workers `ok`); dist-only `84ba45b8` ยังเก็บเป็น rollback

### [ ] H-14 — ทำ internal services private และห้าม synthesize OWNER จาก path

- **สถานะ / ที่มา:** Corrected; รวม Opus `M3` + `L12`; confirmed live — **OWNER-synthesis + internal-auth code fix ปิดแล้ว 2026-07-19; network cutover (live closure) เลื่อนไป batch deploy** (ดู `docs/agent-memory/h-14-internal-services-private-no-owner-synthesis.md`)
- **สาเหตุ:** `api-web`, `ai-gateway`, `workers` อยู่ PUBLIC/public subnets, internal routes ใช้ static secret และ worker สร้าง OWNER context จาก caller-supplied `companyId`
- **ผลกระทบ:** secret leak เปิด arbitrary-tenant privileged reads; unrestricted egress เพิ่ม blast radius
- **ข้อโต้แย้ง + evidence:** Opus ให้ M3 เป็นเพียง plausible; live AWS read ยืนยัน 3/3 services ACTIVE/PUBLIC, 3/3 public subnets และ relevant SGs egress `0.0.0.0/0`
- **วิธีแก้:** private ingress/service discovery, workload identity/mTLS/SigV4, exact route/egress allowlist, rotate secret และใช้ verified actor context แทน synthesized OWNER
- **หลักฐานปิดงาน:** external reachability test fail, architecture/network evidence, worker authorization negative tests และ rotated credential inventory
- [x] **Code/test review (2026-07-19):** worker context ทั้ง 3 จุด (`internal.controller` makeWorkerCtx, `notification-sweeps` workerContext, `workflow-scan-candidates` systemCtx) เลิก synthesize `roles:['OWNER']` → `systemWorkerContext()` (`roles:[]`, `authProvider:'system'`, least-privilege permissions ตัด `notification.read`/`notification.rule.manage` write-perm ออก); subagent trace ยืนยันไม่มี reachable code อ่าน `ctx.roles`. Internal @Public routes ทั้ง 6 controllers รวมเป็น `assertWorkerToken()` (constant-time, fail-closed) และ path/body `companyId` (notification 4 routes + workflow `events/ingest`) validate ผ่าน shared `assertActiveCompany()` ก่อนรัน job (bad token ไม่แตะ DB). deploy.sh เพิ่ม `ECS_EXPRESS_SUBNET_MODE=private` path (แยก `-priv` service, ไม่ flip shared params) + guard refuse private mode บน api-web/all. 5-agent review → CONFIRMED 4 แก้ครบ (workflow ingest companyId, permission over-grant, deploy private-mode guard, authSubject provenance). Negative tests: bad/missing/empty token → 401, non-ACTIVE/forged company → 404, worker ctx `roles:[]`/`authProvider:'system'`/no rule.manage. `grep "roles:['OWNER']"` apps/api = 0. focused specs 15/15, full API suite 2166/2166, typecheck api/contracts/web/ai-gateway/workers clean, `bash -n deploy.sh` OK
- [ ] **Live closure:** ตาม `docs/runbooks/h-14-private-ingress-cutover-runbook.md` — deploy workers+ai-gateway บน private subnets, retire public services เดิม, external reachability test (old endpoints fail), rotate `WORKER_INTERNAL_TOKEN`+`AI_GATEWAY_INTERNAL_SECRET`, egress allowlist และบันทึก rotated credential inventory ก่อนเปลี่ยนหัวข้อ H-14 เป็น `[x]`

### [x] H-15 — ตัด AI trust boundary ออกจาก secret/control-plane/DB/cache โดยตรง

- **สถานะ / ที่มา:** Corrected + broadened; รวม Opus `M6`, `L4`, `L7` และ independent `H-15`; remediated and locally verified 2026-07-18
- **Owner / Due / change:** Platform/AI Security / 2026-07-18 / commit `f4d01830`; immutable deployment evidence pending
- **Affected assets/data/tenants:** AgentCore runtime metadata/execution role, ECS AI Gateway task role/container/SG และ production secret/cache/data-plane reachability; ไม่มี schema/data migration และมีผลทุก tenant
- **Rollback:** revert runtime secret loader/deploy IAM/SG/container changes; หาก deploy แล้วให้คืน task/runtime revision ก่อนหน้า แต่ต้องถือว่า raw internal secret กลับมา exposed และ rotate secret ก่อนเปิด traffic
- **สาเหตุ:** raw internal secret อยู่ใน AgentCore environment/CLI; `GetAgentRuntime` สามารถคืน environment map; trust conditions ขาด; AI SG ไป RDS/Redis ได้และ static task policy อ่าน production secret prefix กว้าง
- **ผลกระทบ:** control-plane/AI workload compromise อาจได้ service secret, impersonate actor หรือ bypass permission-checked ERP API ไป data plane
- **ข้อโต้แย้ง + evidence:** process/environment/control-plane retrievability ยืนยันแล้วจาก deploy script/live metadata และ AWS API schema; claim ว่า plaintext secret ถูกบันทึกใน CloudTrail **ยัง unverified** เพราะ CloudTrail config/event access ถูก IAM ปฏิเสธ
- **วิธีแก้:** AgentCore Identity/Secrets Manager retrieval, จำกัด `GetAgentRuntime`, `SourceAccount`/`SourceArn`, distinct AI SG ไม่มี DB/cache route, exact secret allowlist, actor-bound short-lived delegation และ rotate secret
- **หลักฐานปิดงาน:** AgentCore control-plane env เหลือ exact secret ARN และ runtime ดึงค่าด้วย execution role ที่อนุญาต ARN เดียว; trust policy ผูก `SourceAccount` + runtime `SourceArn` และบังคับ MMDSv2; ECS AI task role ไม่มี Secrets Manager/SSM, AI container/task template ไม่มี DB/Redis coordinate และใช้ `watchdog-bms-prod-ai-egress-sg` แยกจาก SG ที่ RDS/Redis trust. Negative static boundary test ผ่าน, AgentCore focused tests 20/20, AI Gateway typecheck/build:agentcore และ `git diff --check` ผ่าน
- **Scope split:** actor-bound short-lived delegation และ substitution/replay/cross-company/audience tests เป็น finding `M-01`; H-15 ปิด direct secret/control-plane/data-plane path โดยไม่อ้างว่าปิด M-01
- **Residual release evidence:** ยังต้อง deploy immutable ECS/AgentCore revisions, rotate `ai-gateway-internal-secret`, จำกัด human/deploy `GetAgentRuntime`, ทำ IAM simulation, ยืนยัน sanitized runtime metadata ไม่มี raw value และยืนยัน live RDS/Redis SG ingress ไม่มี AI SG ก่อน production release; retest `AC-03`/`AC-04` หลัง deploy

## 2. P1 — Medium-risk findings

### [ ] M-01 — ผูก internal AI call กับ actor delegation ที่พิสูจน์ได้

- **สถานะ / ที่มา:** Code/test remediated and locally verified 2026-07-25; independent `M-01`; top-level ยังเปิดตาม Definition of Done เพราะ immutable deployment และ sanitized live verification ยังไม่เกิด
- **Owner / Due / change:** Platform/AI Security / ก่อน production release ถัดไป / branch `codex/m-01-actor-delegation`
- **Affected assets/data/tenants:** API-issued LINE AI turns, AI Gateway/AgentCore payload, ERP internal tool boundary, Redis replay keys, ECS/App Runner API secret wiring; ทุก tenant ที่เปิด LINE AI tools; ไม่มี schema/data migration
- **Rollback:** disable AI tool traffic และ revert M-01 revision; ห้ามย้อนกลับไปเปิด shared-secret-only actor selection; Redis replay keys หมดอายุเองภายใน 120 วินาที
- **สาเหตุ:** shared secret ยืนยันเพียง workload แต่ `userId/companyId` เป็น caller-selected actor; resolver พิสูจน์ membership ของ identity ที่ถูกเลือก ไม่ได้พิสูจน์ delegation จาก session/LINE identity
- **วิธีแก้:** API mint HMAC-SHA256 delegation อายุ 120 วินาทีแบบ single-use ผูก issuer/workload/audience/user/company/membership/request/tool/jti; Gateway ส่งเฉพาะ token ของ tool ที่เลือกใน `X-Actor-Delegation`; ERP verify + Redis `SET ... EX ... NX` + re-resolve current membership/permission/ABAC + durable audit โดยไม่เก็บ token; signing key แยกจาก workload key และไม่ส่งเข้า AI Gateway/AgentCore
- **หลักฐาน:** `actor-delegation.service.ts`, `ai-gateway.client.ts`, `erp-tool.client.ts`, `internal-tools.controller.ts`, `agentcore/runtime.ts`, `infra/ai-gateway/m01-actor-delegation.spec.sh`
- [x] **Code/test remediation (2026-07-25):** substitution, cross-company, wrong membership/request/tool/audience, expiry, tampered signature, replay และ Redis-unavailable fail closed; token map ไม่ถูกส่งใน ERP body, reflected downstream error ไม่ถูก log, delegation fields/header ถูก redact; audit correlation ครบ workload→jti→actor/company/membership/request/tool. Focused API 13/13, focused AI boundary 53/53, full API 2172/2172, full AI Gateway/AgentCore 417/417, config 57/57, API/AI typecheck, config/contracts build, AgentCore build, shell syntax, static secret-boundary และ `git diff --check` ผ่าน
- [ ] **Live closure:** deploy immutable API/AI Gateway/AgentCore revisions จาก clean CI พร้อม approval; ยืนยันแบบ sanitized ว่า signing key มีเฉพาะ API process/task และไม่มีใน AI Gateway/AgentCore; ทดสอบ accepted call + substitution/replay/cross-company/audience/Redis-unavailable ใน environment ที่ได้รับอนุญาตและเก็บ durable audit/alert evidence ก่อนเปลี่ยนหัวข้อ M-01 เป็น `[x]`; `AC-03`/`AC-04` ยังไม่ติ๊กจน findings อื่นใน chain ปิดครบ

### [x] M-02 — ทำ AI/API logging และ per-tool audit ให้สืบสวนได้

- **สถานะ / ที่มา:** New + merged; รวม Opus `L13`, `I10`, `I14`, `I16`, `I18` — **code/test ปิดและ verify ใน local 2026-07-28** (ดู `docs/agent-memory/m-02-ai-api-logging-per-tool-audit.md`; spec `docs/specs/m-02-ai-api-observability-spec.md`)
- **สาเหตุ:** AI Gateway boot ด้วย `logger:false`; Nest operational logs ไม่ถูก wire; durable audit selective และ per-tool status/duration derive จาก turn-level result; API mutation audit บาง path fire-and-forget
- **วิธีแก้:** structured redacting logger, request/tool correlation, durable allow/deny/error audit, transactional/outbox mutation audit และ security metrics
- **หลักฐาน:** `apps/ai-gateway/src/main.ts:22-32`, `erp-tool.client.ts:80-155`, `process-line-webhook.use-case.ts:945-960`, `internal-tools.controller.ts:263-285`
- **หลักฐานปิดงาน:** synthetic allow/deny/error/provider-failure events ปรากฏครบและ alert/reconstruction drill ผ่านโดยไม่ log secret/PII
- **ปิดงาน 2026-07-28 (Fable 5 spec/verify + Opus 5 coding/review/test, 3 lanes):**
  - **G1 logger wiring:** `NestPinoLoggerBridge` (byte-identical ทั้งสองแอป + guard test เทียบ source ข้ามแอป) แทน `logger:false` ใน `NestFactory.create` ทั้ง API และ AI Gateway — module `Logger` ~78+18 call sites เลิกถูกทิ้ง, ออกเป็น pino redacted JSON ตาม `config.logLevel`; Error-first-arg emit เป็น `err{name,message,stack}` (กัน content-free line จาก Nest `ExceptionsHandler`); gateway ได้ `AllExceptionsFilter` (requestId/method/path + stack บน 5xx) แบบเดียวกับ API
  - **G2 correlation:** `ErpToolClient.invoke` วัด duration จริง, แนบ `durationMs` ลง `ToolResult` ทุก return site, emit `ai.tool.invoke.result` 1 ครั้ง/call พร้อม requestId/toolName/status/durationMs/errorCode; policy events → `ai.tool.policy.allow|deny` + requestId; timeout/source-honesty events มี requestId
  - **G3 durable audit:** `internal-tools.controller` เขียน AuditLog awaited (fail-closed) ทุก outcome — `ai.tool.invoke.denied` (DENIED: NO_AUTHORITATIVE_ACCESS company-less+claimedCompanyId, STALE_ACTOR_DELEGATION หลัง jti ถูกเผา, AI_TOOL_GATE_MISSING, ERP_PERMISSION_DENIED, SOURCE_MODULE_NOT_READY/TOOL_NOT_FOUND), `ai.tool.invoke.failed` (FAILED, HIGH เมื่อ sensitive) + durationMs ใน sensitive-success row; boundary decision: invalid-delegation 401 แรกสุดไม่เขียน durable row (กัน forged-id audit spam — มี logger.warn ที่มองเห็นแล้วแทน); action ใหม่อยู่ใต้ prefix `ai.` จึงติด security category เดิม
  - **G4 real per-tool rows:** contracts เพิ่ม additive `ToolResult.durationMs?`, `AgentToolCall.errorCode?`, `LineAiTurnResponse.toolCalls?`; gateway populate ทั้ง 3 path (AgentCore = bounded+coerced mapping กัน artifact เวอร์ชันเพี้ยนส่ง durationMs ผิด type มาพัง persistence, local orchestrator, deterministic); specialists แนบ per-tool errorCode; `persistTurn` ใช้ status/durationMs/errorCode จริงต่อ tool เมื่อมี `toolCalls`, fallback เทียบเท่าพฤติกรรมเดิมเมื่อ artifact เก่า
  - **G5 provider-failure trace:** catch ทั้ง agentcore/orchestrator ตั้ง `errorCode` (ProviderErrorCode | AGENTCORE_INVOKE_FAILED | ORCHESTRATOR_FAILED) ลง response → persist ใน `AiTurn.errorCode` + emit `ai.provider.failure` พร้อม requestId/path
  - **Verify:** gateway 460/460, API 2516/2516, typecheck ทั้งคู่, contracts build, build:agentcore ผ่าน (รันซ้ำโดย verifier); redaction canary ทั้งสองแอป (token/authorization/actorDelegation/prompt → `[REDACTED]`); reconstruction drill spec พิสูจน์ pivot `requestId → AuditLog → webhookEventId → AiTurn → AiToolInvocation` ด้วย per-tool durations แยกจาก turn duration; adversarial review 12 ข้อ (3 CONFIRMED แก้ครบ: requestId หายบน 2 events, per-tool errorCode ไม่ถูกส่งจาก specialists, raw-Error content-free line)
  - **Accepted residuals (บันทึกใน spec §6):** double-emit บน unhandled non-HttpException 5xx (สอง structured rows, ไม่มีข้อมูลหาย); User-FK race ใน resolver-catch audit ภายใน delegation TTL 120s (fail-closed 500, ยัง deny); NO_AUTHORITATIVE_ACCESS rows เป็น company-less by design (pivot ได้ทาง requestId)
  - **Residual release evidence / boundaries:** deploy immutable artifacts แล้ว sanity-check log ปรากฏใน CloudWatch จริง; log volume เพิ่มจาก module logs ที่เปิดใหม่ (level ยังคุมด้วย config); CloudWatch retention/metric filters/alert routing ตาม event catalog ใน spec §5 → `M-16`; deep recursive redaction + log-level policy → `L-09`; transactional/outbox guarantee ของ ledger `void audit.log` paths → `L-10` (ยังเปิดตามเดิม)

### [x] M-03 — ใส่ deterministic outbound policy ให้ autonomous LINE OA

- **สถานะ / ที่มา:** Corrected and raised; Opus `L3`, Chain 3
- **สาเหตุ:** model ตัดสิน `needsHuman` เอง; draft non-empty ถูกส่งโดยไม่มี deterministic URL/payment/commitment/PII rule; stored template/catalog เข้า prompt
- **ผลกระทบ:** customer/stored prompt injection ทำให้ OA ส่ง phishing, false promise หรือคำขอชำระเงินใน conversation เดิม
- **ข้อโต้แย้ง + evidence:** impact เป็น trusted-channel text abuse ไม่ใช่ ERP mutation/cross-tenant breach; customer AI มี tool allowlist ว่างและไม่มี DB (`crm-customer-reply.agent.ts:1-18`)
- **วิธีแก้:** deterministic outbound policy, high-risk human review, allowlisted domains/templates, template version/review และ treat model `needsHuman` as signal only
- **หลักฐานปิดงาน (2026-07-28):** API-owned fail-closed policy ตรวจ URL/domain, payment, commitment และ PII ทั้ง initial send/retry; model `needsHuman` เป็น signal เท่านั้น; blocked draft ส่งได้เฉพาะ deduplicated SYSTEM holding พร้อม `outbound_policy_<reason>` audit; autonomous context ใช้เฉพาะ ACTIVE template ที่ current version ผ่าน `crm.template.manage` approval และ edit แล้ว approval ถูกล้าง
- **Test/review evidence:** adversarial multi-turn/template/catalog + model-signal corpus ยืนยัน zero AI outbound/LINE delivery และ human-review path; allowlisted HTTPS positive, template create/edit/approve/stale-race, legacy retry denial และ customer-agent no-tool separation ผ่าน; focused API 201/201, full API 2516/2516, full AI Gateway 458/458, config 58/58, API/AI Gateway/Web/Contracts typecheck, Prisma validate และ `git diff --check` ผ่าน
- **Runtime config (2026-07-28):** local/Compose ใช้ `localhost,127.0.0.1,mangmeeplus.com,uat.mangmeeplus.com`; UAT ECS และ GitHub Environment `uat` ใช้ exact host `uat.mangmeeplus.com`; production ECS และ GitHub Environment `production` ใช้ exact host `mangmeeplus.com`. Config-only canary rollout ทั้ง UAT และ production จบ `SUCCESSFUL` โดยใช้ image เดิม; deploy workflows มี environment-specific default และ preserve ค่า active แล้ว
- **Release note:** migration `20260728120000_m03_crm_ai_outbound_policy` เป็น additive; runtime allowlist ตั้งแล้ว แต่ M-03 application/migration ยังต้องผ่าน immutable release ก่อนเปิด autonomous reply. Rollback เร่งด่วนใช้ `CRM_AUTO_REPLY_ENABLED=false`; `AC-07`/`AC-13` ยังไม่ติ๊กเพราะ findings อื่นใน chain ยังไม่ปิด

### [ ] M-04 — ตรวจ semantic grounding ของ employee AI ไม่ใช่เฉพาะตัวเลข

- **สถานะ / ที่มา:** New; independent `M-04`; repository remediation + local verification เสร็จ 2026-07-28 แต่หัวข้อยังเปิดรอ immutable deploy/live smoke ตาม §10
- **Owner / Due / change:** AI Security / ก่อน production release ถัดไป / local P1 remediation working tree
- **Affected assets/data/tenants:** employee LINE AI response composer และพนักงานทุก tenant ที่เปิดใช้; ไม่มี schema/data migration
- **Rollback:** disable model polishing หรือ deploy revision ก่อนหน้าโดยคง deterministic grounded reply เป็น fallback; ห้าม rollback ไปยอม unsupported claims
- **สาเหตุ:** output guard ตรวจ length/JSON/numbers แต่ไม่ bind name/status/negation/outcome กับ source fields
- **ผลกระทบ:** model เปลี่ยน “UNPAID/Alice” เป็น “paid/Bob” โดยยังผ่าน guard ทำให้พนักงานตัดสินใจผิด
- **หลักฐาน:** `response-composer.agent.ts:137-186,235-250`; isolated reproduction ยืนยัน fabricated nonnumeric facts ผ่าน
- **วิธีแก้:** structured claim validation ผูก JSON path/value, entity/status allowlist และ deterministic card สำหรับ high-impact facts
- **หลักฐานปิดงาน:** semantic mutation corpus ต้อง fallback/reject ทุก unsupported claim
- [x] **Code/test remediation (2026-07-28):** ตรวจ semantic atoms, entity/status/outcome/negation inversion และ unsupported token ก่อนยอม model wording; corpus ครอบ Alice/Bob, paid/unpaid, approved/not-approved และ supported paraphrase; AI Gateway full suite 466/466 และ typecheck ผ่าน
- [ ] **Live closure:** deploy immutable artifact จาก clean CI แล้ว smoke employee replies แบบ sanitized ทั้ง positive/negative/fallback พร้อม approval/change evidence

### [ ] M-05 — บังคับ model/provider/region lineage และ privacy governance ตาม data flow จริง

- **สถานะ / ที่มา:** Corrected + broadened; รวม Opus `I7`, `L7`, `L14`, `L15`; technical remediation เสร็จ 2026-07-28 แต่ DPO/vendor approval และ live lineage ยัง pending
- **Owner / Due / change:** Platform/AI Security + DPO / ก่อน production release ถัดไป / migrations `20260728180000_p1_ai_lineage` และ local P1 remediation
- **Affected assets/data/tenants:** employee LINE AI, receipt/bank OCR, tenant AI configuration, AI turns/extraction provenance และข้อมูลทุก tenant ที่ใช้ processor
- **Rollback:** disable provider/OCR path และคืน application revision; คง additive lineage columns/migration ไว้เพื่อไม่ทำลาย evidence และห้ามเปิด global model โดยไม่มี approval reference
- **สาเหตุ:** global model config ไม่ enforce allowlist/per-company choice; Typhoon→second model lineage ไม่ครบ; global Bedrock profile อาจประมวลผลข้าม region; lawful basis/processor metadata ไม่ผูก purpose
- **ข้อโต้แย้ง + evidence:** `UNKNOWN` consent ไม่จำเป็นต้อง deny ทุกกรณี เพราะ consent ไม่ใช่ lawful basis เดียว; OpenAI ไม่เป็น “US transfer” อัตโนมัติโดยไม่มี account/DPA/residency evidence. Gap ที่ยืนยันคือ purpose-specific basis, notice, objection/withdrawal, processor/region/retention/transfer record
- **วิธีแก้:** mandatory provider/model/region/request lineage envelope, boot/call allowlist, enforce per-company policy หรือถอน unused setting; ใช้ geographic profile หรือ global Sonnet 4.6 เฉพาะเมื่อมี named DPO/legal approval reference พร้อม ROPA/DPA/transfer register
- **หลักฐาน:** `provider.factory.ts:7-26`, `packages/config/src/index.ts:308-339`, `line-ai-internal.controller.ts:93-175`
- **หลักฐานปิดงาน:** tenant/model policy tests, stored lineage records และ DPO-approved lawful-basis/processor register
- [x] **Code/test remediation (2026-07-28):** boot/runtime และ per-company allowlist fail closed; production pin Claude Sonnet 4.6 ผ่าน `global.anthropic.claude-sonnet-4-6` เฉพาะเมื่อทั้ง approval flag/reference ถูกส่งถึง runtime และ IAM อนุญาต global profile; หากไม่มี approval จะปฏิเสธ `global.*`; บันทึก provider/model/region/purpose/request lineage ทุก hop ของ LINE AI/receipt/bank OCR ใน response, audit/provenance และ additive schema; focused policy/config, API, AI, typecheck/Prisma validate ผ่าน
- [ ] **Governance/live closure:** DPO/legal/vendor อนุมัติ `docs/security-evidence/p1-ai-processor-lawful-basis-register.md`, แนบ DPA/residency/transfer/retention/notice evidence, apply migration แล้วตรวจ stored lineage แบบ sanitized จาก immutable deployment

### [ ] M-06 — ทำ customer erasure request เป็น durable case/workflow

- **สถานะ / ที่มา:** Corrected; Opus `M2`; repository remediation + local verification เสร็จ 2026-07-28 แต่ live DSAR/notification evidence ยัง pending
- **Owner / Due / change:** Privacy/API + CRM owner / ก่อน production release ถัดไป / migration `20260728150000_p1_pdpa_durable_cases`
- **Affected assets/data/tenants:** customer DSAR request/status, CRM customer/message/media, staff notification และทุก CRM tenant
- **Rollback:** stop DSAR worker, preserve durable case rows/tombstones และ process คิวด้วย reviewed manual procedure; ห้ามย้อนเป็น `202` แบบไม่มี durable record
- **สาเหตุ:** endpoint คืน 202 แต่ไม่มี durable request row/queue/staff task/SLA/status/retry/notification
- **ข้อโต้แย้ง + evidence:** HTTP 202/`ACCEPTED` หมายถึงรับคำขอ ไม่ได้อ้างว่าลบสำเร็จ ดังนั้นคำว่า endpoint “โกหก” ไม่แม่น; operational black hole ยืนยันจาก `crm-pdpa.use-case.ts:179-200` และ controller `:65-76`
- **วิธีแก้:** durable case management, verified erase pipeline, staff notification, SLA/status/retry และ response wording ที่ตรง state
- **หลักฐานปิดงาน:** end-to-end DSAR test ตั้งแต่ request ถึง verified deletion/exception/notification
- [x] **Code/test remediation (2026-07-28):** request สร้าง/reuse durable case, มี SLA/status/attempt/backoff/result/exception, worker เรียก canonical erasure, แจ้ง owner/admin, customer query status ได้ และ failure ออก HIGH-risk audit; request→retry→completion/exception/restore replay tests อยู่ใน API full suite 2,566/2,566
- [ ] **Live closure:** apply migration จาก clean release แล้วทำ authorized DSAR end-to-end ถึง verified deletion/legal exception/staff delivery โดยเก็บ sanitized case/audit evidence

### [ ] M-07 — ป้องกัน PDPA self-service export truncate แบบเงียบ

- **สถานะ / ที่มา:** New; independent `M-07`; repository remediation + local verification เสร็จ 2026-07-28 แต่ immutable/live export proof ยัง pending
- **Owner / Due / change:** Privacy/API + CRM owner / ก่อน production release ถัดไป / local P1 remediation working tree
- **Affected assets/data/tenants:** self-service customer export ของ profile, identity, consent, conversations/messages, bookings, requests และ exemptions ทุก CRM tenant
- **Rollback:** disable self-service export และส่ง complete archive ผ่าน approved manual DSAR path; ห้ามคืน response ที่ truncate เงียบ
- **สาเหตุ:** query จำกัด 1,000 messages/500 bookings แต่ response ไม่มี total/cursor/truncated และ sort ascending
- **วิธีแก้:** async complete archive หรือ pagination พร้อม totals/truncation และ inventory ของทุก personal-data category/exemption
- **หลักฐาน:** `prisma-crm-pdpa-self-service.repository.ts:17-19,75-92`
- **หลักฐานปิดงาน:** dataset เกิน limit ต้อง export ครบหรือแจ้ง pagination/truncation อย่างตรวจสอบได้
- [x] **Code/test remediation (2026-07-28):** export แยก stable cursor/pagination ต่อ category พร้อม total/returned/limit/truncated/nextCursor และ inventory/exemption; query message ไม่ถูกบังด้วย limit ของ conversation; over-limit/cursor tests ผ่านใน API full suite 2,566/2,566
- [ ] **Live closure:** deploy immutable revision และตรวจ dataset เกิน limit ใน non-production authorized tenant ว่าไม่มี omission/duplicate และ metadata ตรงกับ authoritative totals

### [ ] M-08 — ใส่ retention/erasure lifecycle ให้ AI conversation/turn data

- **สถานะ / ที่มา:** New; independent `M-08`; repository remediation + local verification เสร็จ 2026-07-28 แต่ restore drill/live purge ยัง pending
- **Owner / Due / change:** Privacy/API + Platform / ก่อน production release ถัดไป / durable-case migration และ local P1 remediation
- **Affected assets/data/tenants:** AI conversations/turns/tool invocations/previews/source refs, employee disable, customer DSAR และ restored backups ทุก tenant
- **Rollback:** stop purge/re-erasure worker only after preserving tombstones and retention configuration; disable AI intake if safe lifecycle cannot run; additive evidence rows remain
- **สาเหตุ:** เก็บ raw user/reply previews และ source refs โดยไม่พบ TTL/purge/employee lifecycle path
- **วิธีแก้:** minimization/hash-only where possible, explicit TTL, pseudonymous actor reference และรวม AI records ใน DSAR/retention/employee deletion
- **หลักฐาน:** `schema.prisma:1125-1168`, `process-line-webhook.use-case.ts:920-943`
- **หลักฐานปิดงาน:** retention job/DSAR tests และ restore re-erasure behavior
- [x] **Code/test remediation (2026-07-28):** `AI_DATA_RETENTION_DAYS` ขับ idempotent purge, employee disable ล้าง AI data, customer export/erasure ครอบ AI records และ completed tombstones ถูก requeue/re-erase หลัง restore ผ่าน worker-token + explicit timestamp/confirmation; retention/employee/DSAR/restore tests ผ่านใน API full suite
- [ ] **Live closure:** ทำ isolated restore/RTO/RPO drill ตาม `docs/runbooks/p1-production-security-operations.md`, รัน post-restore re-erasure และยืนยัน live retention backlog เป็นศูนย์ก่อน reopen

### [ ] M-09 — ปิด blind SSRF ใน workflow webhook

- **สถานะ / ที่มา:** New; independent `M-09`; หักล้าง claim เดิมว่าไม่พบ SSRF; repository remediation + local verification เสร็จ 2026-07-28 แต่ egress observation ยัง pending
- **Owner / Due / change:** API/Workflow + Platform Network / ก่อน production release ถัดไป / local P1 remediation
- **Affected assets/data/tenants:** workflow `CALL_WEBHOOK`, DNS resolver, outbound network และ tenant payload ทุก tenant ที่เปิด webhook
- **Rollback:** disable `CALL_WEBHOOK` action/endpoint และ drain retry queue; ห้ามย้อนใช้ native fetch ที่ follow redirect หรือ URL validation เฉพาะ string
- **สาเหตุ:** validate เฉพาะ initial `https://`; native fetch follow redirect และไม่มี DNS/IP/private/link-local/metadata guard
- **วิธีแก้:** canonical resolver policy, deny private/link-local/metadata ranges, DNS pin/recheck, disable/validate redirect และ egress proxy/allowlist
- **หลักฐาน:** `workflow-webhook.use-case.ts:30-75`, `workflow-action-runner.use-case.ts:219-246`
- **หลักฐานปิดงาน:** redirect/DNS rebinding/IPv4/IPv6/metadata test suite และ egress observation
- [x] **Code/test remediation (2026-07-28):** exact/wildcard HTTPS allowlist, canonical URL, no credentials/port/fragment, reject IP literal/private/reserved/metadata/IPv4-mapped/NAT64/6to4/Teredo/non-global IPv6, ตรวจทุก DNS result, pin address กับ native HTTPS, redirects off และ bound payload/timeout; focused SSRF suite 3/3 + API full suite ผ่าน
- [x] **Deny-all sentinel (2026-07-28):** production ยังบังคับ `WORKFLOW_WEBHOOK_ALLOWED_HOSTS` ไม่ว่าง (task definition ที่ทำ key หายต้อง boot ไม่ผ่าน) แต่ deployment ที่ไม่ใช้ outbound webhook ตั้งค่าสงวน `none` → allowlist ว่าง → deny ทุก host; ห้ามใส่ placeholder host เพราะอ่อนกว่า `none`; workflow เติม `none` ให้เฉพาะเมื่อไม่มีค่าจาก variable และ live service (ไม่ทับ allowlist จริง); config 95/95 + webhook SSRF spec 4/4 + preserve fallback 6/6 + API suite 2,690/2,690
- [ ] **Live closure:** deploy allowlist/egress policy แล้วสังเกต authorized redirect, DNS rebinding, metadata, IPv4/IPv6 probes ที่ edge/network logs โดยไม่มี request ถึง private target

### [ ] M-10 — ตรวจ attachment target tenant/purpose/permission ทั้งสองฝั่ง

- **สถานะ / ที่มา:** New; independent `M-10`; repository remediation + local verification เสร็จ 2026-07-28 แต่ migration/live negative proof ยัง pending
- **Owner / Due / change:** API/Data Model Core + Expense owner / ก่อน production release ถัดไป / migration `20260728160000_p1_attachment_link_tenant_fk`
- **Affected assets/data/tenants:** attachment links/downloads และ expense evidence ของทุก tenant
- **Rollback:** disable new link mutation, retain composite constraints และ existing links; rollback schema เฉพาะหลังตรวจ tenant consistency และห้ามคืน arbitrary target/purpose
- **สาเหตุ:** link flow validate attachment แต่ไม่ validate target existence/company/purpose/permission; retrieval บาง path ไม่มี company filter
- **วิธีแก้:** resolve both sides in same tenant, purpose-specific permission, composite tenant FK และ scoped retrieval
- **หลักฐาน:** `link-attachment.use-case.ts:31-43`, `prisma-expense.repository.ts:255-269`
- **หลักฐานปิดงาน:** known-ID cross-tenant/cross-purpose negative tests และ DB constraint tests
- [x] **Code/test remediation (2026-07-28):** allowlist target-purpose/permission ที่ use case และ authoritative transaction, re-resolve ACTIVE attachment + same-company target + self-owner/reviewer policy, company-filtered retrieval และ composite tenant FK; focused cross-tenant/cross-purpose/transaction tests + Prisma validate + API full suite ผ่าน
- [ ] **Live closure:** apply migration จาก clean release, รัน known-ID cross-tenant/cross-purpose probes และ DB constraint assertion ใน authorized staging พร้อม sanitized audit evidence

### [ ] M-11 — ปิด branch ABAC และ composite tenant-integrity gaps

- **สถานะ / ที่มา:** New; independent `M-11`; หักล้าง absolute tenant-scoping claim; repository remediation + local verification เสร็จ 2026-07-28 แต่ migration/live matrix ยัง pending
- **Owner / Due / change:** API/Accounting/Ledger/Banking + DBA / ก่อน production release ถัดไป / migration `20260728170000_p1_branch_tenant_integrity`
- **Affected assets/data/tenants:** branch-bearing accounting, ledger, banking, attachment paths และ composite company FK ของทุก tenant
- **Rollback:** disable affected mutations/reads, retain composite constraints, and roll application back only to a revision that preserves equivalent tenant/branch guards; schema rollback requires tenant-integrity preflight
- **สาเหตุ:** accounting/ledger/banking paths บางส่วนไม่ใช้ `ctx.scopes.branchIds`; single-ID FK อยู่คู่กับ unconstrained `companyId`
- **วิธีแก้:** central branch-scope query helpers, composite FK/constraint, server-owned company/branch values และ negative tests ทุก read/write
- **ข้อโต้แย้ง + evidence:** core sampled reads จำนวนมาก scoped ถูกต้อง แต่ไม่ใช่ “ทุก read”; manual journal, attachment links และ branch paths เป็น counterexample ที่ตรวจได้
- **หลักฐานปิดงาน:** authorization matrix crawl และ cross-tenant/cross-branch contract tests
- [x] **Code/test remediation (2026-07-28):** accounting/ledger/banking ใช้ branch scope ที่ authoritative query/write boundary; empty scope เห็นเฉพาะ company-central (`branchId=null`) ไม่เห็น branch row; server-owned branch/company และ composite tenant relations/migration; authorization matrix 4/4, regression ที่พบระหว่าง review 13/13, Prisma validate และ API full 2,566/2,566 ผ่าน
- [ ] **Live closure:** migration preflight/apply บน production-like copy, รัน matrix cross-tenant/cross-branch ทุก representative route และเก็บ DB constraint/live query evidence จาก immutable release

### [ ] M-12 — ทำ distributed abuse controls และแก้ trusted-proxy/lockout/refresh design

- **สถานะ / ที่มา:** Merged; Opus `L11`, `DA1`–`DA4`; repository remediation + local verification เสร็จ 2026-07-28 แต่ multi-instance/WAF/cost-alert evidence ยัง pending
- **Owner / Due / change:** API/Auth + Platform/AI Security / ก่อน production release ถัดไป / local P1 remediation
- **Affected assets/data/tenants:** login/reset/register/refresh, global API limits, OCR/LLM budgets, Redis keys และ proxy/IP boundary ทุก tenant
- **Rollback:** disable cost-bearing AI/OCR and tighten edge/WAF limits if Redis policy cannot run; do not restore per-process fail-open limiter or identifier hard lockout (ยกเว้น global `api-ip` bucket ตาม availability decision 2026-07-28 ด้านล่าง)
- **สาเหตุ:** limiter เป็น in-memory ต่อ process/fail-open, key map ไม่ bounded, XFF topology assumption, hard lockout ต่อ identifier, refresh มีเพียง global throttle และ AI gateway ไม่มี equivalent limiter
- **ผลกระทบ:** distributed bypass, memory DoS, targeted user lockout และ DB/LLM cost amplification
- **ข้อโต้แย้ง + evidence:** last-XFF-hop risk ขึ้นกับ Cloudflare→AWS append/overwrite contract จึงต้อง verify live topology; refresh abuse เป็น bounded cost/self-DoS ไม่ใช่ auth bypass
- **วิธีแก้:** Redis/sliding-window or edge WAF, trusted proxy contract/direct-ingress block, bounded normalized keys/TTL, account-safe step-up/backoff และ per-session refresh/OCR/LLM limits
- **หลักฐานปิดงาน:** multi-instance load tests, proxy-chain tests, victim-login availability test และ cost-budget alerts
- [x] **Code/test remediation (2026-07-28):** Redis atomic shared windows + SHA-bounded keys/TTL, production fail closed, password failures แยก identifier+IP/IP โดย success ไม่ consume, refresh per session, private-peer XFF trust, per-company OCR/LLM budgets และ HIGH-risk structured rate-limit event; focused abuse/proxy tests 16/16 + API/AI full suites ผ่าน
- [x] **Availability decision — store-failure policy ต่อ bucket (2026-07-28):** fail-closed เดิมครอบ *ทุก* request ทำให้ Redis ล่ม = API ล่มทั้งระบบ ซึ่งเกินกว่าที่ spec M-12 เขียนไว้ (“fail closed **for cost-bearing/sensitive paths**”) และขัด P2 spec §4 rule 6 (“liveness is not sacrificed for safety”) — decision: **global `api-ip` bucket degrade เป็น per-process counter, bucket ที่มีต้นทุน/ความลับ fail closed เหมือนเดิม**
  - **Fail closed (ไม่เปลี่ยน, เป็น default ของ service):** `ai-ocr-company`, `ai-llm-company`, `ai-*-company` (จ่ายเงินจริงต่อ call) และทุก auth bucket — `password-login-*`, `password-reset-*`, `customer-register-*`, `email-verification-*` (credential attack surface) เสีย control พวกนี้แย่กว่า 503
  - **Degrade-to-local (opt-in ชัดเจนที่ call site เดียว):** `api-ip` — เป็น DoS damper กว้าง ๆ ไม่ได้กัน spend หรือ secret; degraded ยังจำกัดอยู่ (budget ต่อ task แทนต่อ fleet = attacker ได้ task-count× ไม่ใช่เปิดอิสระ)
  - **`session-refresh`:** fail-open ที่ call site อยู่แล้วจาก L-01 (ดู `RefreshSessionUseCase.assertRefreshQuota`) เพราะ 503 ตรงนี้ทำให้ web BFF ล้าง auth cookie แล้ว logout ผู้ใช้ทุกคน — decision นี้ไม่แตะ
  - **Residual risk ที่ยอมรับ:** ระหว่าง Redis ล่ม global IP limit เป็นแบบ per-task ชั่วคราว distributed flood จึงได้ budget สูงขึ้นตามจำนวน task; ยอมรับเพราะ ALB/WAF ยังอยู่ชั้นหน้า และ trade-off เดิมคือ downtime ทั้ง API + ทริป RollbackAlarm ของ ECS Express canary จาก 4xx/5xx spike
  - **Alarm on the condition:** `api.rate_limit.store_degraded` (riskLevel `HIGH`, edge-triggered ตอนเข้า/ออกสภาวะ degraded ไม่ใช่ต่อ request) — metric filter production เดิม key บน `riskLevel` อยู่แล้ว จึงไม่ต้องแก้ infra
  - **Evidence:** `redis-rate-limit.service.spec.ts` (fail-closed default + opt-in degrade + degraded flag), `api-rate-limit.guard.spec.ts` (degrade แทน 503, ยัง enforce limit), `security-event-emitters.spec.ts` (alarm ยิงครั้งเดียวต่อ transition); focused 35/35, P1 21/21, auth/OCR 44/44, typecheck API + AI Gateway ผ่าน
- [ ] **Live closure:** multi-instance load + victim-availability + direct-ingress/proxy-chain test, ยืนยัน WAF/ALB append contract และส่ง cost-budget/rate-limit synthetic alert ถึง named owner; เพิ่ม: ยิง synthetic `api.rate_limit.store_degraded` (ดับ Redis ใน pre-prod) เพื่อพิสูจน์ว่า alarm ถึง named owner จริง

### [ ] M-13 — Neutralize CSV formula injection

- **สถานะ / ที่มา:** New; independent `M-13`; repository remediation + local verification เสร็จ 2026-07-28 แต่ supported-client rendering evidence ยัง pending
- **Owner / Due / change:** API/Reports/Expense/Tax + Product QA / ก่อน production release ถัดไป / local P1 remediation
- **Affected assets/data/tenants:** CSV exports จาก report, expense และ tax ของทุก tenant
- **Rollback:** disable CSV export or serve approved non-CSV artifact; never revert to delimiter quoting without formula neutralization
- **สาเหตุ:** export quote delimiters แต่ไม่ neutralize cells ที่ขึ้นต้น `=`, `+`, `-`, `@`, tab หรือ CR
- **วิธีแก้:** safe-cell prefix/profile และ regression tests กับ spreadsheet consumers
- **หลักฐาน:** `expense-export.logic.ts:118-129`, `tax-export.logic.ts:63-73`
- **หลักฐานปิดงาน:** exported adversarial cells render as text ใน supported spreadsheet clients
- [x] **Code/test remediation (2026-07-28):** shared `safeCsvCell` neutralize effective first character หลัง whitespace/Unicode NBSP/BOM สำหรับ `= + - @ tab CR LF`, ใช้ใน report/expense/tax; adversarial focused tests และ API full suite ผ่าน
- [ ] **Client closure:** เปิด artifact adversarial ใน spreadsheet clients ที่ product รองรับและบันทึกว่า render เป็น text ไม่มี formula execution จาก immutable build

### [ ] M-14 — เพิ่ม magic-byte, malware, quarantine และ active-content controls

- **สถานะ / ที่มา:** New; independent `M-14`; ขยาย Opus upload/OCR follow-up; repository remediation, isolated corpus, co-located production-image verification และ UAT live closure เสร็จ 2026-07-28 แต่ production live closure ยัง pending
- **Owner / Due / change:** API/Data Model Core + Platform / ก่อน production release ถัดไป / local P1 remediation
- **Affected assets/data/tenants:** upload intent/completion, object storage, ClamAV, download response และ OCR parsers ทุก tenant
- **Rollback:** disable upload completion/OCR and preserve quarantined objects; do not bypass scanner or mark unverified bytes ACTIVE
- **สาเหตุ:** เชื่อ claimed metadata; SVG/Office/CSV/PDF ไม่มี sniffing, AV/quarantine/CDR หรือ forced-download policy ที่พิสูจน์ได้
- **วิธีแก้:** magic-byte/type policy, AV/quarantine/CDR, sanitize/disallow SVG, safe download headers และ parser resource limits
- **หลักฐานปิดงาน:** EICAR/polyglot/SVG active-content/parser-bomb tests ใน isolated environment
- [x] **Code/test remediation (2026-07-28):** allowเฉพาะ PDF/JPEG/PNG, ตรวจ authoritative bytes/magic/checksum/polyglot/EICAR/active PDF/object count ก่อน immutable ACTIVE, ClamAV INSTREAM mandatory และ production fail closed, quarantine + HIGH-risk audit, forced octet-stream attachment download และ parser bounds; focused upload/scanner tests + API full suite ผ่าน
- [x] **Web-upload follow-up (2026-07-28):** ตรวจ file chooser ครบทุกจุดใน web และใช้ allowlist คู่ extension/MIME เดียวกันที่ client + upload-intent boundary; HEIC/HEIF แปลงเป็น JPEG ก่อน intent, bank statement ปฏิเสธ unknown/mismatch แทน text fallback และใช้ magic/active-content/ClamAV ก่อน PDF/OCR parser; focused API 34/34, web policy 40/40, API/web typecheck, Nest DI boot smoke และ page-driven MinIO upload/replace/remove E2E ผ่าน
- [x] **LINE-media follow-up (2026-07-28):** ครอบทั้ง LINE AI, CRM Inbox และ CRM media retry; ตรวจขนาด คู่ extension/MIME, magic bytes, active content และ ClamAV ทันทีหลังดาวน์โหลดแบบ fail closed ก่อนส่ง bytes เข้า intake router/OCR หรือสร้าง upload intent/ACTIVE attachment/record; ไฟล์ปฏิเสธเขียน HIGH-risk audit + security event และ scanner outage ของ CRM คงสถานะให้ retry โดยไม่ persist bytes; focused LINE/CRM/attachment tests 289/289, API typecheck, Nest DI boot และ `git diff --check` ผ่าน
- [x] **Isolated corpus evidence (2026-07-28):** EICAR/polyglot/SVG active-content/parser-bomb corpus รันกับ clamd จริง (ClamAV 1.5.3, sig 28058) ใน isolated Docker ผ่าน 28/28 โดยเรียก shipped `inspectAttachmentBytes` + `AttachmentMalwareScanner` ตรง; ยืนยัน multi-chunk INSTREAM 5.1 MB, unreachable scanner fails closed และบันทึกว่า ClamAV ไม่จับ EICAR ที่ฝังใน container (whole-file signature) จึงต้องคง EICAR check ใน content layer; `pnpm security:m14-evidence`, `docs/security-evidence/m14-upload-scanner-isolated-corpus.md`
- [x] **Production-image scanner evidence (2026-07-28):** สร้างอิมเมจ Linux amd64 ด้วย ClamAV 1.5.3 official package ที่ pin SHA-256 (ไม่ใช้ Debian 1.4.3 ที่ยังไม่รวม security fixes ล่าสุด), daemon รันเป็น `node` และฟังเฉพาะ `127.0.0.1:3310`; compiled production scanner ตรวจ clean + multi-chunk 5 MB เป็น CLEAN และ raw EICAR เป็น `MALWARE_DETECTED`; freshclam non-root และ image allowlist ผ่าน
- [x] **UAT live closure (2026-07-28):** deploy source `b3a159380af8` จาก run `30377065243` พร้อม `CLAMAV_HOST=127.0.0.1`; clean PDF เป็น `ACTIVE` และ download `200`; EICAR-in-PDF ถูก completion ปฏิเสธ `400`, download `403`, DB เป็น `QUARANTINED` โดยไม่มี version/checksum/uploadedAt, audit เป็น `attachment.upload.rejected`/`FAILED`/`HIGH`, structured log correlate ด้วย request ID เดียวกัน และ alarm `watchdog-bms-uat-m14-attachment-upload-rejected` เปลี่ยน `OK → ALARM → OK`; หลักฐาน sanitized อยู่ `docs/security-evidence/m14-uat-live-upload-evidence.md`
- [ ] **Production live closure:** ตามคำสั่ง owner ให้ skip production; ห้าม promote จนมี owned `SECURITY_ALERT_TOPIC_ARN`, alarm action + synthetic delivery acknowledgement, approval/prerequisites ที่บันทึกไว้ และ deploy immutable release ที่ผ่าน gates แล้วทำ live clean/EICAR/quarantine/audit/alarm verification ซ้ำ

### [ ] M-15 — ใส่ security headers ให้ production web `/login`

- **สถานะ / ที่มา:** New; independent `M-15`; passive production evidence; repository remediation + local verification เสร็จ 2026-07-28 แต่ staging/production assertion ยัง pending
- **Owner / Due / change:** Web + Platform Edge / ก่อน production release ถัดไป / local P1 remediation
- **Affected assets/data/tenants:** `/login`, protected web routes, proxy responses และทุก web user
- **Rollback:** disable affected web revision and restore prior immutable revision only behind an edge policy that supplies equivalent headers; never re-enable `X-Powered-By`
- **สาเหตุ:** `/login` ไม่มี CSP/HSTS/frame control/nosniff/Referrer-Policy และเปิด `X-Powered-By`
- **วิธีแก้:** Next/edge security headers, `poweredByHeader:false`, nonce-compatible CSP และ regression checks
- **หลักฐาน:** passive response 2026-07-17; API `/v1/health` มี Helmet headers ขณะที่ web `/login` ไม่มี
- **หลักฐานปิดงาน:** production/staging header assertion และ clickjacking frame test
- [x] **Code/test remediation (2026-07-28):** proxy ใส่ per-response nonce CSP, HSTS, `DENY`, nosniff, strict referrer/permissions policy บน login/protected/rejection responses และปิด powered-by; proxy/header tests 9/9, Web full 378/378, typecheck และ production build ผ่าน
- [x] **Presigned-upload CSP follow-up (2026-07-28):** production `connect-src` เพิ่มเฉพาะ origin `${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com` ที่ผ่าน hostname validation; ไม่ใช้ `https:` หรือ wildcard และ regression ผ่าน 16/16 proxy/header cases. UAT live assertion ยังอยู่ใน live-closure gate ด้านล่าง
- [ ] **Live closure:** assert headers ที่ staging/production และรัน browser clickjacking/frame test จาก immutable deploy โดยบันทึก nonce/CSP console evidence

### [ ] M-16 — ตั้ง log retention, security alerts และ notification owner

- **สถานะ / ที่มา:** Corrected + live; รวม Opus `I18`, ส่วนหนึ่งของ `I19`; declarative remediation + local verification เสร็จ 2026-07-28 แต่ AWS apply/delivery/reconstruction ยัง pending
- **Owner / Due / change:** Platform on-call + Security owner / ก่อน production release ถัดไป / local P1 infrastructure remediation
- **Affected assets/data/tenants:** production CloudWatch log groups/KMS/metric filters/alarms/SNS และ security events ของทุก tenant
- **Rollback:** restore prior immutable task revision while retaining 14-day production logs/KMS/alarm routing; if an alarm misfires, tune filter through reviewed change rather than removing notification
- **สาเหตุ:** live log groups 7/7 ไม่มี explicit retention; alarms 3 ตัวเป็น rollback alarms และไม่มี notification action; deploy ไม่ apply spec retention
- **ข้อโต้แย้ง + evidence:** logs ใช้ service-managed encryption จึงไม่ควรเรียก “unencrypted”; issue คือ retention/CMK requirement ตาม data class และ alert routing. เอกสารเดิมระบุ logs 90 วัน แต่ policy ปัจจุบันคือ UAT 3 วัน และ production 14 วัน
- **วิธีแก้:** retention/KMS by classification, metric/security filters, actionable notification/on-call และ deploy verification
- **หลักฐานปิดงาน:** AWS config assertions, synthetic alert delivery และ incident reconstruction drill
- [x] **Code/test remediation (2026-07-28):** production deploy บังคับ retention 90 วัน + KMS + alert topic, สร้าง HIGH/CRITICAL metric filters/alarms; auth abuse, AI failure/deny, erasure failure และ malware quarantine emit structured high-risk event; read-only baseline verifier/assertions และ runbook เพิ่มแล้ว; shell/static infra/workflow YAML checks ผ่าน
- **Policy update (2026-08-09):** owner กำหนด CloudWatch retention เป็น UAT 3 วัน, production 14 วัน, production support session 14 วัน และกลุ่ม production เดิม 14 วัน; AWS read-back ยืนยันแล้ว 14 service/support groups (UAT 3 กลุ่ม และ production/legacy/support 11 กลุ่ม) ส่วน denied-probe test group ที่เป็น `None` อยู่นอก baseline
- [ ] **Live closure:** deploy/apply AWS controls, archive sanitized verifier output, emit synthetic events, prove alarm→SNS/on-call acknowledgement และ reconstruct request/audit/AI/DSAR chain

### [ ] M-17 — Harden Redis/RDS recovery และ production secret rotation

- **สถานะ / ที่มา:** New + corrected; independent `M-17`, เกี่ยวข้อง Opus `I19`; repository guard/runbook/re-erasure path เสร็จ 2026-07-28 แต่ live hardening/restore/rotation ยังไม่เกิด
- **Owner / Due / change:** Platform/DBA + Security/DPO / ก่อน production release ถัดไป / local P1 operational remediation
- **Affected assets/data/tenants:** production Redis, RDS, backup/restore, all production secrets และ erased customer/AI data ของทุก tenant
- **Rollback:** use reviewed maintenance rollback that preserves encryption/auth/deletion protection; never downgrade Redis/RDS security for availability, and keep erasure tombstones through restore
- **สาเหตุ:** Redis live 1 node ไม่มี TLS/at-rest/auth/snapshot/replica; RDS single-AZ/deletion protection off/backup 7 วัน; secrets 7/7 rotation off
- **วิธีแก้:** encrypted/authenticated replicated Redis + tested snapshot, RDS HA/protection/retention policy และ rotation runbook ตาม secret type
- **ข้อโต้แย้ง + evidence:** Opus บอกไม่มี documented backup window แต่ `platform-environment-config-spec.md:287-295` ระบุ backup 35 วัน/log 14 วัน; ปัญหาคือ live drift และไม่มี tombstone/re-erasure หลัง restore
- **หลักฐานปิดงาน:** live config evidence, restore/RTO/RPO drill, post-restore re-erasure test และ rotation/revocation evidence
- [x] **Repository controls/test path (2026-07-28):** read-only verifier fail closed ถ้า RDS ไม่ encrypted/Multi-AZ/deletion-protected/35-day backup หรือ Redis ไม่ TLS/at-rest/auth/failover/2-node/35-day snapshot; durable tombstone replay + authenticated post-restore re-erasure และ rotation/revocation runbook/tests เพิ่มแล้ว; Prisma/API/static checks ผ่าน
- **Live topology evidence update (2026-08-15; ยังไม่ปิด M-17 รวม):** successful readiness run
  `31789220329` และ runtime SHA-256
  `17148172d4157d19333684c3b84d362c3de53e4de053c76e4f4e62bf8798f8f7` ยืนยัน Production RDS
  encrypted/Multi-AZ/deletion-protected/backup 35 วัน และ Redis encrypted/authenticated/failover/2 nodes/
  snapshot 35 วันสำหรับ source `748f1fa…`; CloudTrail creation events สอดคล้องกัน. Restore/RTO/RPO,
  post-restore re-erasure และ secret rotation/revocation ยังไม่มีหลักฐานครบ จึงคง checkbox เปิด
- [ ] **Live closure:** apply reviewed RDS/Redis hardening, run isolated restore/RTO/RPO + re-erasure drill, enable/execute supported secret rotations และ prove old-version/session revocation; attach sanitized live config and approvals

### [ ] M-18 — บังคับ software/container supply-chain policy ก่อน deploy

- **สถานะ / ที่มา:** Corrected + broadened; รวม Opus `L9`, `I11`–`I13`; repository/CI policy remediation + local verification เสร็จ 2026-07-28 แต่ signed immutable release evidence ยัง pending
- **Owner / Due / change:** Release Engineering + Platform Security / ก่อน production release ถัดไป / local P1 supply-chain remediation
- **Affected assets/data/tenants:** GitHub Actions, dependency graph, API/AI/Web/Workers images, ECR artifacts, ECS/AgentCore runtime และทุก production tenant
- **Rollback:** redeploy prior signed immutable digest that passes the same scan/signature policy; emergency exception must name digest/CVE/owner/expiry and must not lower the global gate
- **สาเหตุ:** mutable Action/image/base tags, no top-level least-privilege permissions, ECR no scan gate, remote `ADD` no checksum, provenance off, `allowBuilds` placeholder ที่ไม่ควรนับเป็น effective lifecycle-script policy ภายใต้ project toolchain ปัจจุบัน, audit gate มองเฉพาะ prod/high ขณะที่ dev/build deps ถูก ship และ final image ไม่มี evidence ของ read-only root filesystem/capability hardening
- **ข้อโต้แย้ง + evidence:** package affected versions อยู่ใน active image แม้ exploit reachability ยังไม่พิสูจน์; targeted advisory ยืนยัน `@hono/node-server@1.19.11` affected `<1.19.13`, `file-type@20.5.0` อยู่ affected ranges, `21.3.4` อยู่หลัง fixes. Independent `pnpm audit --prod` รันซ้ำไม่ได้จึงไม่ certify ตัวเลข audit เดิม
- **วิธีแก้:** full-SHA Actions, least-privilege permissions, immutable digest/tag, SBOM/sign/attest/provenance, checksum remote artifact, effective lifecycle-script allowlist, scan/audit final artifact ตาม severity policy, read-only root filesystem/minimal capabilities และ documented CVE exception/reachability
- **หลักฐานปิดงาน:** CI policy tests, signed immutable artifact, scan gate result และ dependency audit/reachability record
- [x] **Code/test remediation (2026-07-28):** pin Action/base/Lambda identities, checksum remote RDS bundle, effective `onlyBuiltDependencies`, audit all deps, ECR High/Critical scan gate, SBOM + max provenance + cosign OIDC sign/verify digest, deploy signature verification หลัง ECR login และ non-root/read-only/cap-drop controls; transitive `minimatch@10.2.5`/`svgo@3.3.4` ปิด High advisories; audit gate ผ่านด้วย 0 High/Critical (5 Moderate), image-policy scanner/shell/YAML checks, API SWC build และ Web production build ผ่าน
- [ ] **Release closure:** clean CI ต้องสร้าง exact immutable digest พร้อม SBOM/provenance/signature, ECR final-artifact scan ผ่าน, deploy verification ผ่าน และแนบ CVE reachability/exception records + runtime hardening evidence

## 3. P2 — Low / informational hardening

### [x] L-01 — Refresh token family reuse detection

- **ที่มา:** Opus `L1`; DA4 overlap ถูกจัดใน `M-12`
- **งาน:** เก็บ family/rotation state, revoke ทั้ง chain เมื่อ reuse, handle concurrent refresh deterministically และ bind issuer/audience/session
- **หลักฐานปิดงาน:** replay/concurrent-refresh/logout/revocation tests
- **ปิดงาน 2026-07-28 (spec `docs/specs/p2-security-hardening-l01-l15-spec.md` §5 L-01):**
  - **Rotation เป็น CAS จริง:** `updateMany({id, tokenId: presented, status:'ACTIVE'})` — ผู้ชนะรายเดียว, ผู้แพ้ re-read แล้วไม่ mint คู่ที่สอง; migration `20260728190000_l01_refresh_token_reuse_detection` (previousTokenId + rotatedAt) และ `20260728192000_l01_refresh_token_family` (familyId nullable-unique)
  - **Family detection ทุก generation:** `familyId` ผูก session ตอนสร้างและไม่ถูกเขียนทับตอน rotate, ขี่ไปกับ refresh token เป็น claim `fid` — replay ที่เก่ากว่า 1 generation (เคสขโมย token จริงที่พบบ่อยที่สุด) เดิม**ตรวจไม่เจอเลย** ตอนนี้ revoke ทั้ง family + audit CRITICAL + `auth.session.refresh_reuse_detected`; token เก่าที่ไม่มี claim ยังใช้ได้และไม่ถูกตีความว่า reuse
  - **Grace window (default 30s จาก `rotatedAt`) = idempotent replay ไม่ใช่ error** — คืน pair ของ `tokenId` ปัจจุบัน ไม่ rotate ซ้ำจึงต่อ window ไม่ได้ และไม่ยืด `expiresAt`. เหตุผลบังคับ: BFF `apps/web/app/api/auth/refresh/route.ts` ล้าง auth cookie ทุก non-OK แล้ว `authed-fetch` เด้ง `/login` — ตอบ 401 ให้ tab ที่แพ้ race จะลบ refresh cookie ตัวใหม่ที่ยังใช้ได้ทิ้ง
  - **แก้ liveness regression ที่ review จับได้ (MEDIUM):** refresh ถูกผูกกับ Redis limiter ที่ fail-closed → Redis ล่มไม่กี่สิบวินาที = ผู้ใช้ทุกคนที่ access token หมดอายุช่วงนั้นหลุด login ทั้งที่ `AuthSession` ยัง ACTIVE. แก้สามชั้น: use case แยก 429 จริงออกจาก limiter outage (outage = ปล่อยผ่าน), BFF ล้าง cookie เฉพาะ 401, และ `authed-fetch` redirect เฉพาะเมื่อ BFF ตอบ 204/401 — ชั้นที่สามจำเป็นเพราะลำพังการเก็บ cookie ยังเด้ง `/login` อยู่
  - **Rate-limit ordering:** consume หลังพิสูจน์ ACTIVE แล้ว ผู้ถือ token เก่าจึงเผาโควตา session ที่ยังใช้งานอยู่ไม่ได้; routing ผ่าน `assertRefreshAllowed` ทำให้ `auth.rate_limit.exceeded` ยิงจากที่เดียวและ dead method หมดไป
  - **Live DB evidence** (native PG scratch DB, migration chain เต็ม, use case จริง): family ถูก mint ครั้งเดียวและคงที่ข้าม 3 rotation; replay ข้าม 2 และ 3 generation → REVOKED + audit DENIED/CRITICAL; ทั้ง family ตายพร้อมกัน; token ไม่มี claim ยัง refresh ผ่าน; grace replay `tokenIdStable`/`rotatedAtFrozen`; NULL family อยู่ร่วมกันได้ใต้ unique index; CAS 10 รอบ = 10 ชนะ 10 miss ทุก caller ได้ 200 และไม่มี session ถูก revoke
  - **Tests:** auth focused 139/139, web 397/397, full API 2695/2695, typecheck ครบทุกแอป
- **Deploy sequencing (บังคับ):** ต้อง apply migration **ก่อน** โค้ดขึ้น production — refresh อ่านคอลัมน์ใหม่ทุก request และ repo นี้ไม่มี migrate gate ถ้าโค้ดขึ้นก่อนจะกลายเป็น mass logout ทันที
- **Accepted residual:** session ที่ออกก่อนการแก้ (ไม่มี `fid`) ยังได้ single-generation detection จนหมดอายุภายใน 7 วัน — ไม่ backfill ตอน rotate โดยตั้งใจ

### [x] L-03 — Secret entropy, local-value denylist และ lifecycle policy

- **ที่มา:** รวม Opus `L5`, `L6`, `L8`, `L10`
- **งาน:** min length/entropy, known-local/default denylist, generated production secret, rotation/revocation inventory และ dual-key rollout เมื่อจำเป็น
- **หลักฐานปิดงาน:** production config validation ปฏิเสธ empty/weak/local fixtures โดยไม่ log secret
- **ปิดงาน 2026-07-28:**
  - **สาม tier ตามชนิดของ secret:** repo-generated (`WORKER_INTERNAL_TOKEN`, `AI_GATEWAY_INTERNAL_SECRET`, `WATCHDOG_JWT_SECRET_ARN`) = ยาว ≥32 + denylist + entropy; hex keys = entropy อย่างเดียว (denylist token เขียนเป็น hex ไม่ได้จึง false-reject ไม่ได้); third-party = ยาว ≥16 + denylist (ไม่บังคับ entropy กับ secret ที่ vendor เป็นคนออก). Identifier (`LINE_*_ID`, `S3_ACCESS_KEY_ID`) ไม่ถูกตรวจเพราะไม่ใช่ secret
  - **Entropy จับของที่คนพิมพ์เอง:** distinct < 10, periodicity **ทุก period ไม่ใช่เฉพาะตัวหารความยาว** (จับ block ซ้ำที่ต่อท้ายเกินมาหนึ่งตัว และ cycle ที่ไม่หารลงตัว) และ sequential run ≥8 (keyboard walk/นับเลข) — สี่รูปแบบที่ review พิสูจน์ว่าเดิมหลุดผ่านตอนนี้ถูกจับครบ
  - **กันไม่ให้ rule เองทำ production ล่ม:** rule ทั้งชุด fail closed ตอน boot ดังนั้น false reject หนึ่งครั้ง = outage; จึงทดสอบด้วย secret สุ่ม 1,000 ค่า (base64 + hex) ไม่ถูกปฏิเสธเลยสักค่า และ**ฝัง test สุ่ม 200 รอบไว้ถาวร** เพื่อให้ rule ที่พลาด 1 ใน 200 ไม่หลุดไปพังตอน deploy
  - **ปิดรู production สองจุดที่พบจาก review:** AI Gateway ไม่เคยถูกตรวจว่าตั้ง `DEV_AUTH_SECRET` หรือมี JWT secret ทั้งที่ fallback ไปใช้ dev secret verify token ผู้ใช้ได้ และ workers boot ได้โดย `WORKER_INTERNAL_TOKEN` ว่างแล้วส่ง token เปล่า — ทั้งคู่ผูกกับ key ที่ schema default เสมอ จึงบังคับกับ config ที่ parse แล้วจริง (มี test ยืนยันบน parsed output ไม่ใช่ record ที่เขียนมือ)
  - **Data URL:** ปฏิเสธ loopback ทุกสะกด (lowercase + `localhost`/`127.0.0.1`/`[::1]`/`0.0.0.0`/`host.docker.internal`) และ credential ที่อยู่ใน denylist
  - **Lifecycle:** `SEED_SYSTEM_ADMIN_PASSWORD` เข้ามาอยู่ใน schema และถูกห้ามใน production, `prisma/seed.ts` fail closed เมื่อ `APP_ENV=production`; ตาราง secret inventory + rotation path อยู่ในบล็อกคอมเมนต์ของ `.env.example`
  - **Preflight ที่ตรวจของจริง:** `pnpm config:validate` เดิมตรวจแต่ fixture ที่เขียนมือ จึงจับ secret อ่อนหรือ key หายของ deploy จริงไม่ได้เลย — ด่านแรกคือ production boot ซึ่งสายไป ตอนนี้รับ env file หรือ `--process-env` แล้วรัน schema `parse` + `validateProductionConfig` เหมือน boot จริง รายงานทุกข้อในรอบเดียวโดยพิมพ์เฉพาะชื่อ key; มี in-script test ปลูก secret แล้วยืนยันว่าไม่มี window 8 อักขระของค่านั้นโผล่ในผลลัพธ์ ทั้ง phase schema และ phase rule
  - **Tests:** `packages/config` 99/99, preflight self-test 37/37, full API 2695/2695
- **Residual:** `.env.example` copy ตรง ๆ boot API ไม่ขึ้น (4 key ที่ ship ค่าว่างแต่มี shape constraint) — เป็นการ drift ของไฟล์ตัวอย่างกับ `.env` ที่ใช้จริง; preflight ตรวจ env source เดียว ถ้า production ประกอบ env จาก task definition + Secrets Manager ต้องรัน `--process-env` จากใน container ถึงจะตรงกับที่ boot เห็น
- [x] **Environment catch-up (2026-07-28):** `readsJwtSecret` บังคับ `WATCHDOG_JWT_SECRET_ARN` กับทุก config ที่อ่าน JWT secret แต่ AI Gateway container ไม่เคยตั้งค่านี้ — gateway deploy ครั้งถัดไปจะ boot fail (canary rollback, fail-safe แต่ ship ไม่ได้) ตอนนี้ gateway รับ secret ตัวเดียวกับที่ API ใช้ sign (`${SECRET_PREFIX}/watchdog-jwt-secret`) แล้วใน `infra/prod-ecs-express/deploy.sh` (`ai_container_json`); หลักฐานร่วมกับ L-04 ด้านล่าง

### [x] L-04 — Pin JWT algorithms/issuer/audience ทุก verifier

- **ที่มา:** รวม Opus `I1`, `I2`, `I8`
- **งาน:** explicit algorithm/issuer/audience/key-purpose contract สำหรับ access, refresh, gateway และ dead paths
- **หลักฐานปิดงาน:** algorithm/key-confusion/wrong issuer/audience negative tests
- **ปิดงาน 2026-07-28:**
  - **เดิม `algorithms` ไม่ถูก pin เลยสักจุดในทั้งเรพ** ตอนนี้ verify ครบสี่จุด (`watchdog-jwt-verifier`, `dev-jwt-verifier`, refresh ใน use case, gateway `watchdog-context-verifier`) pin `HS256` + issuer + audience **แบบไม่มีเงื่อนไข** — เดิม issuer/audience ถูกใส่แบบ `...(configured ? {} : {})` จึงเสื่อมเป็น "ไม่ตั้ง = ไม่ตรวจ" เงียบ ๆ นอก production
  - Sign มีสองจุด (`issue-token`, refresh `mintFor`) ทั้งคู่ดึง iss/aud จาก `jwtClaimIdentity()` และส่งเป็น **sign options** ไม่ใช่ payload key ที่เขียนมือ sign กับ verify จึง drift จากกันไม่ได้; `DEFAULT_JWT_ISSUER`/`DEFAULT_JWT_AUDIENCE` เป็น fallback ที่ไม่ใช่ secret ส่วน production ยังบังคับค่าจริง
  - LINE ID token: re-check `aud` ให้ตรง channel id ที่ตั้งไว้และ `exp` ต้องยังไม่หมด — review ยืนยันว่าตรงกับ response จริงของ `/oauth2/v2.1/verify` จึงไม่ทำให้ login ที่ถูกต้องถูกปฏิเสธ
  - Gateway ปฏิเสธ refresh token ที่ถูกยื่นเป็น access token ได้แล้ว (เดิมมีเฉพาะฝั่ง API)
  - **Negative tests ต่อ verifier:** wrong algorithm, `alg:none`, wrong issuer, wrong audience, refresh-as-access — ผ่านครบ; spec เดิมหลายไฟล์ sign token โดยไม่มี iss/aud และคืน verifier result ที่ไม่มี `tokenId` ซึ่งเป็นรูปที่ contract ใหม่ปฏิเสธโดยตั้งใจ จึงเติม claim ให้ fixture แทนการผ่อนเงื่อนไข production
- **Accepted residual:** API กับ AI Gateway ใช้ HMAC secret เดียวกันและ audience เดียวกัน เพราะ gateway verify access token ของผู้ใช้เอง การแยก audience ต้อง mint token ตัวที่สองซึ่งอยู่นอก scope — บันทึกไว้ ไม่ได้ปล่อยผ่านเงียบ ๆ
- [x] **Environment catch-up (2026-07-28):** AI Gateway container ไม่ได้ตั้ง `WATCHDOG_JWT_ISSUER`/`WATCHDOG_JWT_AUDIENCE` ทั้งที่ api-web ตั้งครบ ทำให้ deploy ถัดไป boot fail ทั้งสามตัวพร้อม L-03 แก้แล้วโดยให้ gateway derive issuer จาก URL ของ api-web ด้วย expression เดียวกับ `api_container_json` (`normalize_url "${PUBLIC_DOMAIN_URL:-$api_web_url}"` — ไม่ใช่ URL ของ gateway เอง) และ audience `watchdog-bms-${DEPLOY_ENV}`
- **Surfaces ที่ตรวจแล้ว:** UAT deploy ผ่าน `infra/prod-ecs-express/deploy.sh` ตัวเดียวกัน (`DEPLOY_ENV=uat`) จาก CI จึงได้รับการแก้ไปด้วย — `infra/uat/` ไม่มี container definition (มีแต่ bootstrap/role/alert scripts) และไม่ต้องรัน deploy script จาก workstation ใส่ UAT; `infra/docker/compose.local.yml` เป็น `APP_ENV=local` กฎนี้จึงไม่ทำงาน
- **App Runner — ลบทิ้งแทนการแก้ (2026-07-28):** `deploy-ai-gateway.sh` ขาดทั้งสามตัวเหมือนกัน แต่ ADR 0005 §App Runner note ระบุว่า App Runner ปิดรับลูกค้าใหม่แล้วและ "new production deploy work should move to ECS Express Mode/Fargate now instead of extending App Runner" ประกอบกับเงื่อนไขปลดระวางใน `production-ops-spec.md:58` (ECS smoke ผ่าน + ย้าย LINE/LIFF) ทำครบแล้ว และไม่มี workflow ไหนรัน deploy script ชุดนี้ จึงลบ `deploy-api.sh`, `deploy-api-web.sh`, `deploy-ai-gateway.sh`, `deploy-web.sh`, `deploy-web-lambda.sh` ออกทั้งหมดแทนการเติม JWT env ให้ path ที่ ADR สั่งให้เลิกใช้
- **เปลี่ยนชื่อโฟลเดอร์ `infra/prod-app-runner/` → `infra/api-web/`:** ของที่เหลือในนั้นคือ image ของ api-web ที่ยัง live ล้วน ๆ ไม่มีอะไรเป็น App Runner แล้ว — `Dockerfile.api-web` (ci.yml + `prod-ecs-express/deploy.sh` build จากไฟล์นี้จริง), `start-api-web-runtime.sh` (image CMD และถือ M-01 `unset AI_ACTOR_DELEGATION_SIGNING_KEY`), `web-api-proxy.mjs` + spec; อัปเดต path ครบทุกจุด (ci.yml ×2, `prod-ecs-express/deploy.sh`, 2 spec, COPY ใน Dockerfile เอง) — `git grep prod-app-runner` นอก `docs/` ว่างแล้ว
- **ลบซาก App Runner เพิ่ม:** `apps/api/start-combined-production.sh` (runtime แบบ api+web รวมร่างยุค App Runner) ไม่มี Dockerfile ไหน COPY และไม่มีใครรัน — `apps/api/Dockerfile` ใช้ `start-production.sh` — จึงลบทิ้ง
- **Spec ที่ปรับตาม:** `infra/docker/production-image-security.spec.sh` (ตัด loop ที่ assert clean-build/digest บน 5 สคริปต์ที่ลบ เหลือ assert บน live path) และ `infra/ai-gateway/m01-actor-delegation.spec.sh` (ตัด positive assert บน `deploy-api.sh` และ negative guard บน App Runner gateway — ECS Express guard คือตัวเทียบเท่าที่ยัง live) — รันแล้วผ่านทั้งคู่
- **Verification (2026-07-28):** `bash -n` ผ่านทั้งสอง script; parity harness render ทั้งสอง container แล้วเทียบ byte-identical ทั้ง issuer/audience/secret ARN ผ่านทั้งกรณีตั้งและไม่ตั้ง `PUBLIC_DOMAIN_URL`; boot simulation ด้วย `aiGatewayConfigSchema` + `validateProductionConfig` → ก่อนแก้ fail 3 ข้อ (`WATCHDOG_JWT_SECRET_ARN`/`ISSUER`/`AUDIENCE`), หลังแก้ BOOT OK
- **Residual (แยกเรื่อง, ยังไม่ปิด):** boot simulation เจอ `TYPHOON_PROCESSING_REGION is required when Typhoon OCR is enabled` — เกิดเมื่อ secret `typhoon-ocr-api-key` มีอยู่จริง (prod มี) แต่ `vars.TYPHOON_PROCESSING_REGION` ว่าง ทั้ง prod/UAT workflow `preserve ... false` จึงปล่อยว่างได้แล้วโดน `map(select(.value != ""))` ตัดทิ้ง ต้องเติมค่า GitHub variable ก่อน deploy gateway (เป็น operational/data-residency decision ไม่ใช่ code fix)
  - **Guard (2026-07-28):** `deploy_ai_gateway` ตรวจก่อน build/deploy แล้ว — ถ้า secret `typhoon-ocr-api-key` มีอยู่ จะ fail fast พร้อมรายงาน *ทุก* ช่องที่ขาดในรอบเดียว (`TYPHOON_PROCESSING_REGION` ว่าง, region ไม่อยู่ใน `APPROVED_AI_REGIONS`, `typhoon` ไม่อยู่ใน `APPROVED_AI_PROVIDERS`) แทนที่จะไป boot fail กลางทาง canary rollback; ไม่ได้ทำให้ deploy ผ่านได้เอง ยังต้องตั้ง GitHub variable อยู่ดี — guard แค่ย้ายจุดพังมาก่อน rollout และกันเสีย deploy รอบละข้อ. Verification: 8 case (secret ไม่มี/region ว่าง/region ไม่ approved/provider ไม่ approved/ครบถ้วน/มีเว้นวรรคหลัง comma/near-miss substring/รายงานสองช่องพร้อมกัน) ผ่านหมด

### [x] L-05 — ไม่ให้ token ที่ไม่มี `sid` ข้าม revocation policy

- **ที่มา:** Opus `I3`, Chain 6
- **งาน:** reject หรือกำหนด explicit token class ที่ไม่ต้อง session; migration/compatibility plan และ revocation tests
- **ปิดงาน 2026-07-28:** เดิม `auth.guard.ts` ห่อการเช็ค session ไว้ใน `if (tokenId)` **โดยไม่มี else** — token ที่ลงลายเซ็นถูกต้องแต่ไม่มี `sid` จึงข้ามการตรวจ session ทั้งก้อนและรอดพ้น logout/revoke-others/การกวาด session ตอน reset password ตลอดอายุ token ตอนนี้ปิดสามชั้นอิสระ: verifier ทั้งสองตัวโยน 401 เมื่อ `sid` หายหรือว่าง, guard fail closed ก่อนทั้ง session lookup และ `resolveContext` (test ยืนยัน resolution 0 ครั้งและ lookup 0 ครั้ง) และ refresh ปฏิเสธก่อนแตะ DB จึงได้ 401 ไม่ใช่ 500 จาก `findUnique` ที่รับ `undefined`; type ฝั่ง verify เลิกมองรูปที่ไม่ปลอดภัยว่ารับได้ — pattern ลอกมาจาก gateway ที่ทำถูกอยู่แล้ว

### [x] L-06 — ลด forgot-password enumeration/timing signal

- **ที่มา:** Opus `I4`
- **งาน:** uniform response/timing envelope, async side effect และ monitoring โดยไม่ทำ account lockout
- **ปิดงาน 2026-07-28:** body/status เหมือนกันทุกผลลัพธ์อยู่แล้วและ LINE push แยกออกไปแล้ว สิ่งที่เหลือคือจำนวน DB round trip ที่ต่างกัน 1 เทียบ 4-6 ระหว่าง identifier ที่ไม่มีอยู่จริงกับที่ใช้ได้ ตอนนี้ครอบด้วย envelope เวลาขั้นต่ำคงที่ (`PASSWORD_RESET_RESPONSE_MIN_MS`, default 300ms) วางไว้ใน `finally` จึงครอบทุก branch รวมถึงกรณี throw; normalize key ของ rate-limit bucket ด้วย trim+lowercase ให้ตรงกับที่ use case ใช้ค้นหา — เดิม `alice`/`Alice`/`ALICE` แยก bucket กันทำให้โควตาต่อ identifier ถูกคูณด้วยจำนวนรูปแบบตัวพิมพ์
- **Product decision ที่บันทึกไว้:** **ไม่**เพิ่ม account lockout และ**ไม่**เพิ่ม bucket ที่ key ด้วย identifier อย่างเดียว เพราะตัวนับแบบนั้นกลายเป็น denial-of-service ต่อการ reset ของผู้ใช้จริงทันที (ใครก็ระบุชื่อเหยื่อได้) — rate limit จึงคง identifier+IP และ IP ไว้ตามเดิม ตรงกับที่ตัว finding เขียนสั่งไว้เอง

### [x] L-07 — Constant-time compare สำหรับ worker/internal secrets

- **ที่มา:** รวม Opus `I9`, `I15`
- **งาน:** reuse central secret-compare helper, equal-length handling และ tests ทุก internal controller
- **ปิดงาน 2026-07-28:** ฝั่ง Node ทุก internal controller เรียกผ่าน `assertInternalSecret`/`assertWorkerToken` อยู่แล้ว (รวมจุดที่เคย open-code การเทียบใน `internal-tools.controller.ts`); helper ที่ซ้ำกันสองแอปถูกคุมด้วย guard test เทียบ byte-identical จากมาร์กเกอร์ร่วม ตาม precedent ของ `NestPinoLoggerBridge` และวาง `assertInternalSecret` ไว้**ใน**บล็อกที่ถูก guard เพื่อให้ตัว assert เองถูกคุมด้วย ไม่ใช่แค่ตัวเทียบ
- **จุดที่เหลืออยู่จุดเดียวคือฝั่ง web:** double-submit CSRF เทียบด้วย `===` ตรง ๆ แก้เป็นการเทียบแบบ constant-time ที่รันได้บน Edge runtime โดยไม่เพิ่ม dependency — seed ตัวสะสมด้วย `len(cookie) XOR len(header)` การยอมรับจึงต้องยาวเท่ากันก่อน review ไล่เคส rotation/repetition/prefix/ว่าง/อักขระเดียวแล้วยืนยันว่าไม่มีทาง false accept
- **Accepted residual:** guard เทียบเฉพาะเนื้อหาใต้มาร์กเกอร์ บรรทัด import อยู่เหนือมาร์กเกอร์จึงยังชี้ไปโมดูลอื่นได้ตามทฤษฎี — เหมือน precedent เดิม ความเสี่ยงจริงต่ำ

### [x] L-08 — Enforce AI mutation classification ซ้ำใน ERP ก่อนเปิด write tool
- **ปิดงาน 2026-07-28:** ก่อนหน้านี้ `grep category` ใน `internal-tools.controller.ts` ได้ **ศูนย์ผลลัพธ์** — การจัดชั้น mutation และ kill switch บังคับใช้ที่ AI Gateway ฝั่งเดียว ใครถือ internal secret + delegation จึงข้ามได้ ตอนนี้ ERP executor เป็นผู้ตัดสินเอง โดย deny เรียงชั้นและ fail closed ทุกชั้น: ไม่มี registry entry → `TOOL_NOT_FOUND`, category ไม่รู้จัก → `TOOL_CATEGORY_UNKNOWN`, category เป็น mutation ขณะสวิตช์ปิด → `AI_FINAL_MUTATION_DISABLED`, category ไม่อยู่ใน `LINE_ALLOWED_TOOL_CATEGORIES` → `TOOL_CATEGORY_NOT_ALLOWED`, แล้วจึงค่อยเช็ค permission
- **ลำดับที่จงใจ:** เช็ค kill switch **ก่อน** allowlist เพราะถ้าสลับกัน การทริปสวิตช์จะถูกรายงานเป็น `TOOL_CATEGORY_NOT_ALLOWED` แล้ว alarm จะไม่มีวันเห็นว่าสวิตช์ถูกทริป; และแม้เปิดสวิตช์ tool ประเภท mutation ก็ยังถูกปฏิเสธที่ชั้น allowlist (necessary-not-sufficient) มี test ยืนยัน
- **ปิด fail-open ตัวจริง:** เดิม `if (meta && !hasToolPermissions(...))` ทำให้ tool ที่ไม่มีใน registry **ข้ามการเช็ค permission ทั้งก้อน** รอดมาได้เพราะบังเอิญ `toolMap` ไม่มี key นั้น ตอนนี้ไม่มี registry entry = deny ทันที
- **ทุก denial เขียน audit row ที่ await จริงและยิง `ai.tool.invoke.denied` พร้อม `riskLevel` ระดับ root** — การทริป kill switch ไม่เป็น log-only อีกต่อไป
- **หลักฐานว่า tool อ่านอย่างเดียวทั้ง 54 ตัวไม่กระทบ:** test เดิน `toolMap` จริง (assert ว่ามี 54 พอดี) ไล่หา registry entry ของทุกตัว แล้วเรียกใช้ด้วย permission เท่าที่ entry นั้นประกาศ ยืนยันว่าได้ `ok` — ไม่มีการ hardcode รายชื่อ

- **ที่มา:** Opus `I5`, `I6`, `AI-DA1`; **Latent**
- **งาน:** จัด `evidence_capture`/`draft_create` เป็น mutation ตาม impact, enforce kill switch/category/approval ซ้ำที่ executor และ deny unknown category
- **ข้อโต้แย้ง + evidence:** current tree ยังไม่มี executable receipt write path; `accounting.capture_receipt_evidence` ไม่อยู่ API `toolMap` และคืน `unsupported_module` จึงไม่ใช่ exploit ปัจจุบัน แต่ control debt จะกลายเป็นช่องจริงเมื่อเพิ่ม write executor
- **หลักฐานปิดงาน:** executor-level deny tests ทั้ง gateway bypass/unknown category และ change gate ก่อน registry write capability

### [x] L-09 — Deep/redaction-by-key logging และ pin production log level

- **ที่มา:** รวม Opus `I10`, `I14`, `I16`; overlap `M-02`
- **งาน:** recursive/key-pattern redaction ครอบ `apiKey`, `idToken`, internal headers, nested error/meta และ PII; production log level policy
- **หลักฐานปิดงาน:** canary log tests ยืนยันไม่มี secret/PII marker หลุดใน success/error/nested cases
- **ปิดงาน 2026-07-28:**
  - **ปัญหาเดิมคือ pino `redact.paths` เป็นการ match path แบบตรงตัว เพดานลึกแค่ 2** `ctx.token` ถูกปิดแต่ `err.meta.token` ไม่ถูก และ `apiKey`/`idToken`/`internalSecret`/`channelSecret` ไม่เคยถูกปิดเลยแม้ `key`/`token`/`secret` จะอยู่ในลิสต์ เพราะ match ทั้ง segment ไม่ใช่ substring ตอนนี้ทุก log object ผ่าน `redactLogValue` ที่ recursive และ match ตาม key pattern โดยใช้ implementation เดียวกันทั้ง API, AI Gateway และ workers
  - **ยืนยันลำดับของ pino จาก source จริง ไม่ใช่เดา:** `formatters.log` ทำงานก่อน serializer และก่อน stringifier ของ `redact.paths` และพบว่า `msg` ที่ส่งเป็น argument ที่สองข้าม `formatters.log` จึงปิดช่องนั้นด้วย `serializers.msg` เพิ่ม
  - **เส้นทางรั่วที่เป็นรูปธรรมคือ `all-exceptions.filter.ts`** ซึ่ง log `err:{name,message,stack,code,meta}` ทุก 5xx โดย `err.meta` คือ payload ของ Prisma และ `err.message` ตอน Prisma init fail มี `DATABASE_URL` เต็ม ๆ ฝังอยู่ — canary test ยืนยันว่า credential หายแต่ host/port/db ยังอยู่ พร้อมเคส depth-3/4, PII key และ cycle
  - **workers เดิมไม่มี redaction เลย** เขียน `console.log(JSON.stringify(payload))` ทั้ง job payload ของ notification/workflow/ai-draft/crm-pdpa ตอนนี้ทุกจุดผ่าน helper ที่ใช้ redactor ตัวเดียวกันและเคารพ `LOG_LEVEL`
  - production ห้าม `LOG_LEVEL=debug` แล้ว และ `REQUEST_LOG_ENABLED` ที่เดิม parse ทิ้งไว้เฉย ๆ ถูกนำมาใช้จริง
- **Accepted residual:** object ที่ไม่ใช่ plain object และ `toJSON` ยังผ่าน walker ไปได้ ปัจจุบันไม่มี call site ที่ log ของแบบนั้น จึงเป็น hardening headroom ไม่ใช่รูที่เปิดอยู่

### [x] L-10 — Guarantee financial/auth audit ด้วย transaction หรือ outbox

- **ที่มา:** Opus `L13`; overlap `M-02`
- **งาน:** mutation และ audit commit อย่างมี delivery guarantee, idempotent consumer และ failure alert
- **ปิดงาน 2026-07-28:**
  - **Port เขียนใน transaction ได้แล้ว** — เดิม `IAuditRepository.log()` ไม่มีพารามิเตอร์ tx เลย จึง**เป็นไปไม่ได้**ที่จะเขียน audit ให้ atomic กับ mutation; repository เลิก hardcode root client
  - **สัญญาสองโหมดที่ทำให้ `await` ปลอดภัย:** `log(entry)` หลัง commit **ไม่ throw เด็ดขาด** (retry หนึ่งครั้งแล้ว emit `audit.persist.failed`) จึงเปลี่ยนจุดการเงินเป็น `await` ได้โดยไม่มีทางที่ mutation ที่ commit แล้วจะกลายเป็น 500 ให้ผู้ใช้กดซ้ำ; `log(entry, tx)` throw เพื่อให้ audit ที่ล้มเหลว roll back mutation ไปด้วย; และมี `logOrThrow` สำหรับจุดที่ต้องได้หลักฐานก่อนลงมือจริง
  - **จุดที่แปลงเป็น `await` รวม 51 จุด** ครอบ ledger/period/account/report, payment create+void, document ทั้งชุด, vendor bill, supplier payment, PO/PR, expense, reimbursement (payment record/void/duplicate/approve/reject), banking (adjustment approve/void, match confirm/reject/void, statement line ignore, reconciliation complete/reopen), supplier bank account create, expense substitute receipt, crm campaign send, workflow webhook — **ไม่เหลือ `void this.audit.log` ที่ระดับ CRITICAL ในทั้ง `apps/api/src`**
  - **พิสูจน์ in-transaction จริงหนึ่งเส้นทาง:** `ReleasePp36InputVatClaimUseCase` ย้าย audit CRITICAL เข้าไปอยู่ใน Serializable transaction เดียวกับ `TaxAdjustment`/`TaxEvent`
  - **กู้ fail-closed ของ M-02 ที่ regress โดยไม่ตั้งใจ:** การทำให้ `log()` ไม่ throw ทำให้ AI tool boundary ซึ่งเดิมถ้าเขียน audit ไม่สำเร็จจะ 500 และ tool ไม่ทำงาน กลายเป็นทำงานต่อโดยไม่มีหลักฐาน — จุดนั้นใช้ `logOrThrow` แล้ว พร้อม test ที่พิสูจน์ว่า tool ไม่ถูกเรียกเมื่อ audit ล้มเหลว และแก้ comment/spec ที่ยังเขียนว่า fail-closed ให้ตรงกับโค้ด
  - **`audit.persist.failed` มี `riskLevel: CRITICAL` ระดับ root แล้ว** เดิมไม่มี ทำให้ metric filter เดียวใน production (ซึ่ง key บน riskLevel) มองไม่เห็น — เหตุการณ์เดียวที่ finding นี้มีไว้เพื่อจับจึงไม่เคยเตือนใคร
  - Outbox append เลิกกลืน error, `outbox.append.failed` มี `riskLevel: HIGH`, และ eventKey เลิกใช้ wall-clock มาเป็น fingerprint ที่ deterministic ผูกกับ occurrence
- **Accepted residual (บันทึกไว้):** ยังไม่มี outbox drainer ในเรพนี้ (`void this.outbox.append` ทุก caller) — E/F ทำให้การสูญหาย*สืบสวนได้*และ key ถูกต้อง แต่ไม่ได้ทำให้ *กู้คืนได้*; การย้าย audit เข้า transaction ของ repository void/reversal ยังไม่ทำเพราะไฟล์เหล่านั้นถูกแก้โดย session อื่นพร้อมกัน — เส้นทางเหล่านั้นได้ awaited + retry + alert แทน; เหลือ HIGH ที่เป็น fire-and-forget อีกราว 38 จุดซึ่งอยู่นอกขอบเขต financial mutation ที่ finding ระบุ (read/observability, config/policy, workflow ops)

### [x] L-11 — Redact PII โดยไม่ทำลาย non-PII forensic audit

- **ที่มา:** Opus `I17`
- **งาน:** field-level redaction/tombstone ที่ preserve actor/action/time/result/hash/chain; immutable append-only correction event แทน wholesale overwrite
- **หลักฐานปิดงาน:** erasure test ยืนยัน PII หายแต่ forensic event chain ยังตรวจสอบได้
- **ปิดงาน 2026-07-28:** เดิม erasure ทำ `auditLog.updateMany({data:{metadataJson:{personalDataErased:true}}})` คือ**เขียนทับ metadata ทั้งก้อน** ทำลายยอดเงิน checksum จำนวนนับ เหตุผล และการเปลี่ยนสถานะไปพร้อมกับ PII และทำแบบเดียวกันกับ `payloadJson` ของ outbox ตอนนี้เป็น field-level: redact เฉพาะ key ที่เป็นข้อมูลส่วนบุคคลและ free-text ที่ลูกค้าเป็นคนเขียน ส่วน key อื่นอยู่ครบ
  - **วิธี match เป็นการตัด token ท้าย ไม่ใช่ substring** จึงจับ `customerName`, `primaryPhoneNormalized`, `billingAddressLine1` ได้ ขณะที่ `taxContext`, `reason`, `reasonCode`, `entryNumber`, `checksumSha256` รอด — นี่คือแก่นของ finding และมี test ยืนยันทั้งสองทิศทาง
  - โครงของแถว (`actorType`/`actorUserId`/`action`/`targetType`/`targetId`/`requestId`/`result`/`riskLevel`/`createdAt`) ไม่ถูกแตะ, มี marker ในแถวบอกว่า redact เมื่อไร (ตรวจรูปร่างของ marker ด้วยจึงปลอมให้ข้ามไม่ได้), idempotent เมื่อรันซ้ำ, และมี correction event `pdpa.audit.redacted` แบบ append-only เพิ่มจากแถว `crm.customer.erase` CRITICAL เดิมที่ยังคงอยู่
  - envelope ของ outbox (`companyId`/`occurredAt`/`eventType`) รอดจากการ redact แล้ว
- **Accepted residual:** ไม่ได้เพิ่ม hash/sequence chain ให้ `AuditLog` (เป็นงาน tamper-evidence คนละโปรแกรม ไม่ใช่ P2) และ audit row ของ data subject เดียวกันที่อยู่ใต้ targetType นอกกลุ่ม CRM ยังไม่ถูกกวาด; **เจตนา:** ไม่ขยาย sanitization ตอนเขียน audit ให้ตัด PII เพราะ audit trail ที่ชอบด้วยกฎหมายต้องมีข้อมูลนั้นจนกว่าคำขอลบจะมาถึง

### [x] L-12 — จำกัด AgentCore invocation request body

- **ที่มา:** New; independent hardening
- **งาน:** enforce `Content-Length` + streaming byte cap, reject 413 และ rate/cost limits
- **หลักฐาน:** `agentcore/runtime.ts:85-91,197-219`
- **ปิดงาน 2026-07-28:** AgentCore runtime เป็น `node:http` แยก entrypoint การจำกัด `json({limit})` ใน `main.ts` จึงไม่มีผลกับมันเลย และ `readBody` เดิมสะสม chunk **ไม่จำกัด** POST ก้อนเดียวทำ container OOM ได้ ตอนนี้ pre-check `Content-Length` ก่อนผูก listener ใด ๆ, นับ byte ระหว่าง stream และไม่ buffer เกิน cap, ตอบ `413 PAYLOAD_TOO_LARGE` ผ่าน helper เดิม; `messageText`/`prompt` และจำนวน attachment มีขอบเขต และ invocation ที่วิ่งพร้อมกันถูก cap แล้วตอบ 429 โดยตัวนับปล่อย slot ใน `finally` จึงไม่รั่ว
- **Accepted residual ที่วัดค่าไว้แล้ว:** การปิด socket ที่ยังมี byte ค้างอยู่คือ TCP reset ซึ่งทิ้ง response ที่ client buffer ไว้ วัดบน loopback ด้วย body 8 MB ต่อ cap 2 KB — ก่อนแก้ client เห็น 413 เพียง 1/20 ครั้ง หลังใส่ lingering close ได้ 13–18/20 คือ**ดีขึ้นมากแต่ไม่การันตี** และไม่ได้อ้างว่าการันตี; การรอนานกว่านี้แบบไม่จำกัดจะกลายเป็นช่องยึด socket แทน byte ที่ทิ้งไม่เคยถูก buffer และ slot ถูกปล่อยทันที
- **แก้ test ที่เป็น assertion หลอกตา:** เคส chunked เดิมให้ test เรียก `fakeReq.destroy()` เองแล้ว assert ว่า destroyed เป็นจริง ซึ่งไม่ได้พิสูจน์อะไรเกี่ยวกับโค้ด production เลยแต่อ่านดูเหมือนมี coverage — เปลี่ยนเป็นการขับผ่าน `node:net` จริงและ property test บน `PassThrough`

### [x] L-13 — ลด health/framework reconnaissance disclosure

- **ที่มา:** New; independent hardening
- **งาน:** public health ไม่เปิด DB detail, separate authenticated readiness และปิด framework disclosure
- **ปิดงาน 2026-07-28:** public `/v1/health` เหลือ `{service,status,timestamp}` และ**ไม่ query DB เลย** (test นับ query = 0) ปิดทั้ง oracle ที่บอกสถานะ datastore ให้คนนอกและช่องขยายภาระ DB แบบไม่ต้อง auth บน route ที่ได้รับการยกเว้น rate limit อยู่; readiness เชิงลึกย้ายไป `/v1/internal/health/readiness` หลัง `assertWorkerToken` และไม่ถูกยกเว้น rate limit; `console.warn` ที่พ่น error string ดิบของ driver เปลี่ยนเป็น logger ที่ redact; AgentCore `/ping` เลิกบอกชื่อ service ภายใน; `/docs` ถูก gate ด้วย flag **ทุก environment** (เดิมทุก env ที่ไม่ใช่ production เปิดหมด รวม UAT); `x-powered-by` ปิดแบบระบุชัดไม่พึ่ง default ของ framework
- **Consumer ที่ต้องย้ายพร้อมกันและเกือบโดนลืม:** `infra/prod-ecs-express/verify-deployment.sh` assert `.status == "ok" and .db == "ok"` อยู่ ถ้าถอด `db` เฉย ๆ deploy verification จะพังทุกครั้ง — public assertion จึงเหลือ `.status` และ assertion เรื่อง DB ย้ายไปเรียก readiness route โดยมี token ก็ตรวจจริง ไม่มี token ก็พิมพ์ skip ชัดเจน (token ผิด = fail ไม่ใช่ skip); ตรวจแล้วว่าไม่มี consumer อื่นทั้ง `infra/`, `.github/`, `docs/runbooks/`, `e2e/`
- **Residual:** ถ้า deploy pipeline ไม่ export `WORKER_INTERNAL_TOKEN` การตรวจ DB จะ skip ทุกครั้งในทางปฏิบัติ — ต้องต่อ token เข้า deploy environment ถึงจะได้สัญญาณนั้นจริง

### [ ] L-14 — เพิ่ม bot/anomaly detection สำหรับ machine-speed probing

- **ที่มา:** Opus AI-attacker addendum + independent hardening
- **งาน:** signals สำหรับ auth spray, role/permission probes, webhook/SSRF failures, AI jailbreak/cost spikes และ secret-access anomaly พร้อม human-owned alert
- [x] **Code/test remediation (2026-07-28):** emitter กลาง `emitSecurityEvent` (byte-identical สองแอป มี guard test) ออก event ชื่อ dotted คงที่พร้อม `riskLevel` ระดับ root ครอบ auth login denied, rate-limit exceeded, password-reset denied, refresh reuse detected, LINE webhook signature invalid, workflow webhook blocked, AI tool invoke denied และ rate-limit store degraded; ข้อความ warn ที่เป็นประโยคภาษาอังกฤษตามขอบ AI/CRM ถูกเปลี่ยนเป็นชื่อ event ที่เสถียร
  - **แก้ที่ฝั่ง application ไม่ต้องแตะ infra:** metric filter ใน production จับ `riskLevel` HIGH/CRITICAL อยู่แล้ว การใส่ riskLevel ระดับ root จึงทำให้สัญญาณใหม่เข้า alarm เดิมทันทีโดยไม่ต้องแก้ deploy script (ซึ่งอีก lane ถืออยู่)
  - **ข้อ `ai.tool.invoke.denied` ใน filter เดิมไม่เคย match อะไรเลย** เพราะสตริงนั้นมีอยู่แค่ในฐานะ audit action ในฐานข้อมูล ไม่เคยเป็น pino `msg` — ตอนนี้ถูก emit จริงทุก denial outcome พร้อม `reasonCode`
  - **Guard test ที่เคย pass แบบว่าง ๆ ถูกทำให้กัดจริง:** เดิมยอมรับชื่อ event เพียงเพราะมีค่าอยู่ใน catalogue ลบ call site ทิ้งหมดก็ยังเขียว (พิสูจน์ด้วยการรัน predicate เดิมกับ source ที่ตัด emit ออกแล้ว → ยังได้ true) ตอนนี้ต้องมี emit site จริง และยังคงเป็น one-directional คือ event ที่ตั้งใจให้ log-only ไม่ถูกบังคับให้อยู่ใน filter
- [ ] **Live closure:** สร้าง/ยืนยัน alarm ส่งถึง named human owner จริง ยิง synthetic event ต่อชื่อ แล้วเก็บหลักฐานการส่งถึงปลายทาง; ครอบ baseline/rate-of-change สำหรับ low-and-slow probe ซึ่ง threshold ≥1 period 60 ปัจจุบันแยกไม่ออกจาก false positive

### [ ] L-15 — ทำ backup tombstone/re-erasure หลัง restore

- **ที่มา:** Corrected from Opus `I19`
- **งาน:** documented residual-retention window, tombstone ledger และ automatic/manual re-erasure procedure หลัง restore
- **ข้อโต้แย้ง + evidence:** documented windows มีอยู่แล้ว (backup 35 วัน/log 14 วัน); สิ่งที่ยังขาดคือ live alignment และ verified replay of erasure after restore
- [x] **Code remediation (2026-07-28):** tombstone ledger (`CrmDataSubjectRequest`), `replayAfterRestore` และ runbook/สคริปต์ drill สร้างโดยงาน P1 คู่ขนาน — ส่วนที่ P2 ปิดคือ**ความทนทานของ tombstone เอง**: FK ไปหา `CrmCustomer` เป็น `ON DELETE CASCADE` แปลว่า ledger ที่มีไว้เพื่ออยู่ให้นานกว่าตัว subject จะถูกลบไปพร้อม subject; migration `20260728191000_l15_tombstone_durability` เปลี่ยนเป็น `ON DELETE RESTRICT` เป็น `DO` block เดียวที่ no-op เมื่อยังไม่มีตารางหรือเป็น RESTRICT อยู่แล้ว และ atomic จึงไม่มีสถานะ "ไม่มี FK เลย" ระหว่างทาง
  - พิสูจน์บน DB จริง: `DELETE FROM "CrmCustomer"` ที่มี tombstone ค้างถูกปฏิเสธด้วย FK violation, ลบผ่าน Company ก็ยังถูกปฏิเสธ, รัน migration ซ้ำสะอาด และ no-op เมื่อไม่มีตาราง; ปัจจุบันไม่มีเส้นทาง hard delete ในโค้ดจึงไม่เปลี่ยนพฤติกรรมใด ๆ เป็นการปิดกับดักอนาคต
  - idempotency ของ requeue มี coverage อยู่แล้วใน `crm-pdpa.use-case.spec.ts` และ `prisma-crm-pdpa-self-service.repository.spec.ts` จึงไม่เขียนซ้ำ
- [ ] **Live closure:** รัน restore drill จริงตาม `docs/runbooks/p1-production-security-operations.md` แล้วเก็บหลักฐานว่า case ที่ completed ก่อน snapshot ถูก requeue และ re-erase จริง พร้อมจัด live retention ให้ตรงกับที่เอกสารระบุ (backup 35 วัน / log 14 วัน) และครอบ object storage ซึ่งสคริปต์ปัจจุบันไม่แตะ

## 4. Governance / compliance evidence checklist

### [ ] G-01 — ROPA และ purpose-specific lawful-basis register

- Map data category, purpose, subject, lawful basis, notice, source, recipient, retention, deletion, objection/withdrawal และ automated decision per web/API/LINE/AI/OCR flow
- ให้ DPO/ที่ปรึกษากฎหมายไทย approve; ห้ามใช้ blanket “ต้อง consent เสมอ” หรือ “UNKNOWN ผ่านเสมอ” โดยไม่แยก purpose

### [ ] G-02 — Processor/subprocessor, DPA, residency และ transfer assessment

- ครอบ LINE, Typhoon OCR, Bedrock/global inference, optional OpenAI, AWS logs/backups และ third-party QR (จนกว่าจะถอดออก)
- เก็บ account-region/DPA/retention/training/use restrictions และ transfer mechanism ที่ตรวจสอบได้

### [ ] G-03 — DSAR/erasure/export และ breach 72-hour operating evidence

- Case owner, SLA, identity verification, exception/legal hold, status/notification, complete export, erasure across primary/AI/log/backup lifecycle
- Breach runbook, decision log, contact tree, regulator/data-subject notification workflow และ tabletop evidence

### [ ] G-04 — SOC 2 / ISO 27001 control evidence ก่อนอ้าง compliance

- Access review, change approval, vendor risk, asset/data inventory, incident response, restore drill, vulnerability SLA/exception, key rotation และ monitoring operating evidence
- Code review นี้ไม่ใช่ certification หรือ legal opinion

### [ ] G-05 — Production security ownership และ risk acceptance

- กำหนด owner/due date ทุก P0/P1, documented exception approver/expiry/compensating control, release gate และ residual-risk acceptance โดยผู้มีอำนาจ

## 5. ข้อโต้แย้งและ claim disposition

รายการในหมวดนี้ติ๊ก `[x]` เพราะตัดสิน claim จาก evidence ปัจจุบันแล้ว ไม่ใช่เพราะ remediation เสร็จ

### [x] D-01 — ปิด claim ว่า AI ปลอม receipt/evidence ได้ใน tree ปัจจุบัน

- **คำตัดสิน:** Refuted for current tree; เก็บ `L-08` เป็น latent hardening
- **Evidence:** registry มีชื่อ tool แต่ API `toolMap` ไม่มี executor และ `internal-tools.controller.ts:251-260` คืน `unsupported_module`; current executable tool surface เป็น read-only

### [x] D-02 — ปิด claim ว่า customer prompt injection ปั่น trust score ได้

- **คำตัดสิน:** Refuted
- **Evidence:** `crm-ai-trust.use-case.ts:13-25` เรียก deterministic `computeTrustScore()` (`:34-68`) โดยไม่ใช้ model/customer text และ auto-reply ไม่ authorize จาก score

### [x] D-03 — ปฏิเสธข้อสรุปทางกฎหมายว่า consent `UNKNOWN` ต้อง deny เสมอ

- **คำตัดสิน:** Overbroad legal claim; ย้ายงานจริงไป `M-05`/`G-01`
- **Evidence:** source-of-truth spec ระบุ `UNKNOWN/GRANTED/NOT_REQUIRED` ผ่านและบล็อก `REVOKED`; PDPA รองรับ lawful bases มากกว่า consent. ต้องวิเคราะห์ต่อ purpose โดย DPO

### [x] D-04 — ปฏิเสธ claim ว่า OpenAI เท่ากับ US transfer อัตโนมัติ

- **คำตัดสิน:** Overstated; ต้องตรวจ account/DPA/residency/data flow จริง
- **Evidence:** provider config เพียงพิสูจน์ว่า OpenAI เป็น option ไม่พิสูจน์ region/transfer ของ production account; งาน governance อยู่ `M-05`/`G-02`

### [x] D-05 — จำกัด claim AgentCore secret exposure ตามหลักฐานที่มี

- **คำตัดสิน:** Environment/process/control-plane retrievability confirmed; CloudTrail plaintext unverified
- **Evidence:** deploy scriptส่ง raw environment/CLI value และ AWS `GetAgentRuntime` schema คืน environment map; reviewer ไม่มีสิทธิ์ตรวจ CloudTrail configuration/events

### [x] D-06 — แก้ claim ว่าไม่มี documented backup/log window

- **คำตัดสิน:** Factually wrong
- **Evidence:** `platform-environment-config-spec.md:287-295` ระบุ backup 35 วัน/log 14 วัน; รายงานเดิมบันทึก live drift เป็น RDS 7 วันและ logs indefinite ขณะที่ AWS read-back 2026-08-09 ยืนยัน log retention ตาม policyแล้ว; ยังไม่มี re-erasure-after-restore proof

### [x] D-07 — ปฏิเสธ blanket claim ว่าไม่พบ XSS/SSRF

- **คำตัดสิน:** SQLi/no user-controlled command sink ยัง supported; XSS/SSRF claim refuted
- **Evidence:** LIFF inline-script breakout (`H-08`) และ workflow redirect/DNS SSRF (`M-09`)

### [x] D-08 — ปฏิเสธ blanket claim ว่าทุก financial read/relation tenant-scoped

- **คำตัดสิน:** Core sampled reads ส่วนใหญ่ scoped แต่ absolute claim ไม่จริง
- **Evidence:** cross-tenant manual journal (`H-03`), attachment target integrity (`M-10`) และ branch/composite-FK gaps (`M-11`)

### [x] D-09 — ปฏิเสธ claim ว่า dev CVE packages ไม่อยู่ runtime image

- **คำตัดสิน:** Artifact presence confirmed; HTTP exploit reachability unproven
- **Evidence:** active image inspection พบ `@hono/node-server@1.19.11`, `file-type@20.5.0/21.3.4`, SWC/tsx/Prisma; remediation อยู่ `H-13`/`M-18`

### [x] D-10 — ไม่รับรองตัวเลข dependency audit เดิมแบบ independent

- **คำตัดสิน:** Unknown, ไม่ใช่ refutation
- **Evidence:** rerun `pnpm audit --prod` ถูกจำกัดเพราะ network/data-export policy; targeted versions/advisories ถูกตรวจแยกแล้ว

### [x] D-11 — ไม่ใช้จำนวน “60 agents” เป็น verification evidence

- **คำตัดสิน:** Unsupported provenance claim
- **Evidence:** ไม่มี manifest, command log หรือ per-agent artifact ที่ audit ได้; severity ต้องอิง reproducible code/live evidence

### [x] D-12 — ยืนยันความหมายของ HTTP 202 ให้ถูกต้อง

- **คำตัดสิน:** 202 ไม่ได้แปลว่าลบแล้ว; finding ที่ถูกต้องคือ durable workflow หาย (`M-06`)
- **Evidence:** response state เป็น accepted แต่ไม่มี row/queue/task/SLA/status/retry/notification

### [x] D-13 — ปิด claim ว่า role controller ถูก body ทับ authz fields ได้ในปัจจุบัน

- **คำตัดสิน:** Refuted as a current exploit; explicit mapping ยังเป็น coding guideline ที่ดีแต่ไม่มี remediation blocker แยก
- **Evidence:** `CreateRoleDto`/`UpdateRoleDto`/`RolePreviewDto` เป็น concrete class DTO (`employee-access.dtos.ts:74-93`) และ global pipe ใช้ `whitelist:true` + `forbidNonWhitelisted:true` (`apps/api/src/main.ts:85-91`) จึงปฏิเสธ extra authz fields. Finding `H-02` เป็นคนละ sink เพราะ ledger controller รับ `@Body() any`

## 6. Unknowns / evidence ที่ยังต้องเก็บ

### [ ] U-01 — ดึง ECR scan findings ของ active images และบันทึก exception/SLA
### [ ] U-02 — ตรวจ S3 bucket/presign/versioning/encryption/lifecycle/access-log controls ด้วย read-only IAM
### [ ] U-03 — ตรวจ CloudTrail configuration/event redaction โดยไม่เปิดเผยค่า secret
### [ ] U-04 — อ่าน/simulate live IAM task/execution/deploy roles โดยเฉพาะ AI secret scope, `PassRole`, permissions boundary และ privilege paths
### [ ] U-05 — ตรวจ CloudWatch metric filters, subscription destinations และ alert delivery
### [ ] U-06 — ตรวจ WAF/Cloudflare direct-origin blocking, trusted client IP contract, bot/rate-limit rules และ header override
### [ ] U-07 — ตรวจ LINE console/LIFF channel configuration, redirect allowlist, token TTL/revocation และ provider-side logs
### [ ] U-08 — ตรวจ vendor DPAs, production account regions, processor retention/training terms และ legal basis กับ DPO
### [ ] U-09 — rerun current production dependency audit/SBOM scan ใน approved CI ที่ไม่ส่ง private graph เกิน policy
### [ ] U-10 — authenticated staging DAST/route crawl, LINE/mobile flow test และ independent penetration retest หลังแก้

## 7. Attack-chain regression checklist

ใช้เป็น acceptance suite หลัง remediation; ห้ามยิง production โดยไม่มี authorization/runbook

### [ ] AC-01 — HR privilege → finance role → accounting fraud ต้องถูกปฏิเสธและ alert
ครอบ Opus Chain 1 และ independent Chain A: `H-01` + `H-02`/`H-03`/`H-05` + `H-04`/`H-07` + audit

### [ ] AC-02 — LIFF/QR link → LINE identity → WatchDog takeover ต้องใช้ไม่ได้
ครอบ independent Chain B: `H-08` + `H-09` + session/token revocation

### [ ] AC-03 — Public mesh/shared secret → arbitrary-tenant read ต้องใช้ไม่ได้
ครอบ Opus Chain 2 และ independent Chain C: `H-14` + `H-15` + `M-01`

### [ ] AC-04 — AI workload compromise → direct DB/cache/secret access ต้องถูก network/IAM deny
ครอบ independent Chain D: `H-15` + `M-01` + `M-02`

### [ ] AC-05 — Presigned upload → overwrite/oversize/evidence substitution ต้องใช้ไม่ได้
ครอบ independent Chain E: `H-11` + `M-14`

### [ ] AC-06 — Bootstrap secret → persistent SYSTEM_ADMIN ต้องใช้ไม่ได้
ครอบ independent Chain F: `H-12` + MFA/session rotation/alerting

### [ ] AC-07 — Customer/stored prompt injection → trusted OA phishing ต้องถูก block/review
ครอบ Opus Chain 3: `M-03` + `M-05` + `M-02`

### [ ] AC-08 — PDPA request → black hole/destructive audit/restore resurrection ต้องไม่เกิด
ครอบ Opus Chain 5: `M-06` + `M-07` + `M-08` + `L-11` + `L-15` + `G-03`

### [ ] AC-09 — Session/JWT weakness chain ต้อง fail closed
ครอบ Opus Chain 6: `L-01` + `L-04` + `L-05`

### [ ] AC-10 — Reimbursement concurrency/partial failure ต้องไม่จ่ายซ้ำ
ครอบ `H-06`; ใช้ deterministic concurrency harness และ reconciliation

### [ ] AC-11 — Webhook redirect/DNS-rebinding SSRF ต้องออก network ไม่ได้
ครอบ `M-09`; รวม metadata/private IPv4/IPv6 และ redirect chain

### [ ] AC-12 — Machine-speed lockout/rate-limit/cost attack ต้อง bounded และ alert
ครอบ Opus DA1–DA4/AI-attacker addendum: `M-12` + `L-14` + `M-16`

### [ ] AC-13 — Stored CRM/template injection → employee semantic corruption ต้องถูก reject
ครอบ independent AI chain: `M-04` + template review ใน `M-03` + model/source lineage ใน `M-05`

### [ ] AC-14 — OCR cost/PII → multiple processors/regions ต้อง bounded และ trace ได้
ครอบ independent AI chain: `M-05` + `M-08` + `M-12` + `M-16` + `G-02`

## 8. Verified controls ที่ต้อง preserve

รายการเหล่านี้ไม่ใช่ finding ที่ปิดแล้วตลอดไป; ใช้เป็น no-regression checklist ระหว่างแก้

- [ ] `C-01` Preserve global deny-by-default route authorization และ route inventory test
- [ ] `C-02` Preserve LINE webhook HMAC/id-token verification, constant-time compare และ verify-before-state-response
- [ ] `C-03` Preserve no user-controlled raw SQL/command execution sink; scan new code paths
- [ ] `C-04` Preserve customer AI separation: no ERP tools/DB and minimal conversation-scoped context
- [ ] `C-05` Preserve ERP permission re-resolution, branch scope, tool allowlist/sanitizer/dedupe/budget/source honesty
- [ ] `C-06` Preserve current read-only executable AI toolMap; any write tool requires `L-08` closure and threat review
- [ ] `C-07` Preserve booking proposal + explicit confirmation before commit
- [ ] `C-08` Preserve API Helmet/CORS/production docs-disabled controls while aligning web headers
- [ ] `C-09` Preserve RDS private/encrypted baseline, ECR scan-on-push/AES256 และ non-root runtime
- [ ] `C-10` Preserve current git secret-scan result/CI scanning while adding final-image secret scanning

## 9. Traceability — Opus IDs → merged checklist

| Opus ID | Merged item | Disposition |
|---|---|---|
| H1, H2 | H-01 | รวมเป็น privilege-grant model เดียว |
| H3 | H-04 | ยืนยันและขยายถึง document void |
| M1 | H-05 | ยืนยันแต่แก้ impact ของ negative GL/malformed values |
| M2 | M-06, D-12 | behavior ยืนยัน; แก้ความหมาย HTTP 202 |
| M3 | H-14 | จาก plausible เป็น confirmed live |
| M4 | H-06 | ยืนยันโดยจำกัด precondition เป็น race/partial failure |
| M5 | H-07 | ยืนยัน SoD; payment เป็น separate call |
| M6, L4 | H-15, D-05 | env/process/control-plane confirmed; CloudTrail plaintext unknown |
| L1 | L-01 | คงไว้ |
| L2 | D-13 | ปิด current exploit claim; retain explicit mapping เป็น coding guideline |
| L3 | M-03 | ยกระดับ Medium และจำกัด impact ให้ตรงจริง |
| L5, L6, L8, L10 | L-03 | รวม secret entropy/default/local-value items |
| L7 | H-15, M-05 | รวม IAM/model-region boundary |
| L9 | H-13, M-18 | รวม image minimization/supply chain |
| L11 | M-12 | รวม AI gateway/cost rate limiting |
| L12 | H-14 | รวม public mesh + OWNER synthesis |
| L13 | M-02, L-10 | logging/audit guarantee |
| L14 | M-05, G-01, D-03 | ถอน blanket consent rule; เก็บ lawful-basis work |
| L15 | M-05, G-02, D-04 | ถอน automatic-US claim; เก็บ processor/transfer work |
| I1, I2, I8 | L-04 | JWT contract hardening |
| I3 | L-05 | session revocation |
| I4 | L-06 | enumeration/timing |
| I5, I6 | L-08, D-01 | latent control; current receipt exploit refuted |
| I7 | M-05 | model allowlist/lineage |
| I9, I15 | L-07 | constant-time internal secret compare |
| I10, I14, I16 | M-02, L-09 | logging/redaction |
| I11, I12 | H-13, M-18, D-09 | packages present in image; reachability unknown |
| I13 | M-18 | lifecycle/build policy |
| I17 | L-11 | preserve forensic audit during erasure |
| I18 | M-02, M-16, L-14 | logging/alerting/anomaly detection |
| I19 | M-16, M-17, L-15, D-06 | documented window corrected; live drift/restore gap retained |
| DA1, DA2, DA3, DA4 | M-12, AC-12 | consolidated abuse-control program |
| AI-DA1 | L-08 | latent before first write tool |
| AI-DA2 | D-01 | refuted for current tree |
| AI-DA3 | D-02 | refuted |
| Chain 1–6 | AC-01, AC-03, AC-07, D-01/L-08, AC-08, AC-09 | converted to regression chains |

Independent `H-01`–`H-15` และ `M-01`–`M-18` ถูกเก็บ ID เดิมทั้งหมดใน checklist นี้; รายการ Opus ที่ซ้ำถูกรวมตามตารางข้างบน และรายการที่ไม่มีใน independent high/medium list ถูกเพิ่มเป็น `L-*`, `G-*`, `U-*` หรือ disposition โดยไม่มี ID ตกหล่น

## 10. Definition of done ต่อรายการ

ห้ามติ๊ก P0/P1 เสร็จจาก code review อย่างเดียว ต้องมีครบตามความเสี่ยงของรายการ:

- [ ] ระบุ owner, due date, affected assets/data/tenants และ rollback plan
- [ ] แก้ root cause ที่ server/database/network/IAM boundary ไม่ใช่เฉพาะ UI
- [ ] เพิ่ม focused negative/adversarial tests และ preserve controls ในหมวด 8
- [ ] ผ่าน typecheck/unit/integration ที่เกี่ยวข้อง และ concurrency/browser/infra test เมื่อ applicable
- [ ] deploy ด้วย immutable artifact จาก clean CI และเก็บ change/approval evidence
- [ ] verify live configuration/telemetry แบบ sanitized หลัง deploy
- [ ] rotate/revoke secret/session/image เมื่อ finding มี exposure window
- [ ] retest attack chain ที่เกี่ยวข้องและบันทึกผล/ข้อจำกัด
- [ ] อัปเดต spec/runbook/ROPA/architecture และ residual-risk acceptance

## 11. Verification baseline ที่ใช้สร้าง checklist

- Focused API security tests: **55/55 passed**
- Focused AI/AgentCore tests: **66/66 passed**
- API, AI Gateway และ Web typechecks: **passed**
- Passive production checks: `/login`, `/v1/health`, `/v1/docs` และ response headers เท่านั้น
- Sanitized active-image inspection: ยืนยัน `.env`, source/admin/build tooling และ listed package versions โดยไม่อ่านค่า secret
- Read-only AWS metadata: 3 services, 3 subnets, 4 relevant SGs, 3 ECR repos, 7 log groups, 3 alarms, 1 RDS, 1 Redis, 7 secret metadata records, 1 AgentCore runtime
- Current HEAD high-confidence secret scan: 0 matches; ไม่พบ committed secret ใน focused scan แต่ ignored nested `.env` อยู่ใน active image
- ไม่ได้ brute-force, ไม่ส่ง exploit payload ไป production, ไม่ invoke AgentCore และไม่แก้ production data/config

---

**Merged verdict:** รายงาน Opus เป็น baseline ที่มีประโยชน์และ findings หลักหลายข้อถูกต้อง แต่ independent evidence เพิ่ม release blockers สำคัญและแก้ claim ที่กว้างเกินจริงหลายรายการ Checklist นี้จึงใช้ independent report เป็นแกน, รวม Opus findings ทุก ID, เก็บข้อโต้แย้งพร้อม evidence และแยก claim ที่ refuted/unknown ออกจาก remediation ที่ต้องทำจริง
