# Agent Memory: H-04 — payment/document void เป็น true reversal

Status: DONE (implementation + tests + 8-angle review + fixes; checklist ticked 2026-07-18)
Owner: Claude (security remediation session, 2026-07-18)
Scope: `apps/api/src/modules/accounting-documents/**` (payment.use-case.ts, document.use-case.ts, posting-source.use-case.ts, prisma-accounting.repository.ts) + specs + package.json test list + checklist. ไม่แตะไฟล์ ledger (H-03 session แก้อยู่)

## Decisions

- **Module direction**: `LedgerModule` imports `AccountingDocumentsModule` ⇒ void use cases ฉีด ledger use cases ไม่ได้ (DI cycle) ⇒ reversal journal สร้างใน `PrismaAccountingRepository` transaction โดยตรง, reuse pure fn `buildReversalLines` จาก ledger domain logic
- **Authoritative posting check**: ตัดสิน "ต้อง reverse ไหม" จากตาราง `JournalEntry` (GENERATED+POSTED ต่อ source) — ไม่ใช้ pointer `postingStatus/journalEntryId` (ตามหลัง/พังได้); `findPostedGeneratedJournalId` ใช้ pre-check เพื่อจองเลขเท่านั้น, ใน tx ตรวจซ้ำและ fail-closed `posting_state_changed` ถ้าเปลี่ยน
- **CAS + Serializable**: `updateMany({ where: { status: expected } })` count!==1 ⇒ Conflict; ทั้ง method อยู่ใน `$transaction(..., { isolationLevel: 'Serializable' })`
- **Original journal คง POSTED**: report queries (getAccountBalances/getGlLines) นับเฉพาะ POSTED ⇒ mark REVERSED จะทำ double-subtract ⇒ เก็บ POSTED ให้ net=0, ผูกด้วย `reversalOfJournalEntryId`; idempotency = มี REVERSAL row ต่อ source แล้วหรือยัง (unique `[companyId,sourceType,sourceId,entryType]`)
- **Prisma 7 nested-create trap**: JournalLine.journalEntry เป็น compound relation `[companyId, journalEntryId]` ⇒ nested `lines: { create }` ห้ามใส่ `companyId` scalar; `branchId` (null/จริง/undefined) ใส่ได้ — พิสูจน์กับ DB จริง
- **Number lifecycle**: reserve `LEDGER_SEQUENCE_KEY` นอก tx; **RESERVED ต้อง cancel ด้วย `CancelDocumentNumberUseCase`** (`voidNumber` รับเฉพาะ COMMITTED — เรียกผิดจะ mask error จริงด้วย 409); commit เฉพาะเมื่อ reversal เกิดจริง; idempotencyKey มี `Date.now()` suffix โดยตั้งใจ (reserveNumber คืน row ตาม key โดยไม่สน status ⇒ deterministic key จะส่ง reservation ที่ CANCELLED กลับมาให้ retry)
- **Fail-closed guards ใน tx**: period ไม่ OPEN/REOPENED หรือ period row หาย; PP30 FILED/PAID/CLOSED (tax-relevant docs); TAX_INVOICE มี CN/DN ที่ issued ค้าง; GENERATED journal สถานะไม่ใช่ POSTED (เช่น DRAFT ค้าง) ⇒ 422 จน resolve
- **Document void**: allocation คืนเป็น unapplied credit (+`accounting.payment.unapplied_credit_created` มี currency), doc `paidAmount=0, outstandingAmount=0, paymentStatus='VOIDED'` (invariant: paidAmount = Σ allocation ที่มีชีวิต); `updateDocumentStatus` โยน error ถ้าเรียกด้วย VOIDED
- **Posting-source guard**: `buildDocumentPostingInput` ปฏิเสธเอกสาร VOIDED (ก่อนหน้านี้ map เป็น sourceEventType 'voided' — posting rule สำหรับ event นั้นจะสร้าง journal ใหม่ให้เอกสาร void ได้ = รูซ่อนเงิน); payment builder มี guard `RECORDED` อยู่แล้ว
- **Permission model**: `accounting.*.void` implies GL reversal อัตโนมัติ (server-owned, audit CRITICAL) — ไม่ต้องมี `journal.entry.reverse`
- **Accepted residuals / parity**: reversal number ดึงจาก sequence เดือนปัจจุบันแต่ entry ลง period เดิม (parity กับ ReverseJournalUseCase); sequence เดือนปัจจุบันไม่มี ⇒ void ที่ posted จะ 422 จนกว่าจะ upsert sequence (parity ทุก ledger flow); PP30 lock ครอบ FILED/PAID/CLOSED เท่า issue path; เงิน 2dp toFixed ตาม convention โมดูล (H-05 เป็นเจ้าของ precision hardening); unapplied credit ที่ปลดจาก doc void ค้างเป็น AR credit จน reallocate (reclass เป็นเรื่อง posting rules)

## Review (8 angles → verify → fix)

CONFIRMED + fixed:
1. cancel-vs-void number lifecycle (voidNumber รับเฉพาะ COMMITTED) — เปลี่ยนเป็น CancelDocumentNumberUseCase ทั้ง 2 use cases
2. period-null fail-open — เปลี่ยนเป็น throw fail-closed
3. VOIDED doc ยังเป็น posting source ได้ — guard ใน buildDocumentPostingInput
4. unapplied-credit event ไม่มี currency (shape ต่างจาก CreatePayment) — เพิ่ม currency

REFUTED/no-change ที่สำคัญ: paidAmount zeroing "lossy" (จริงๆ คือ invariant paidAmount=Σallocations; ประวัติอยู่ใน audit+outbox); OVERDUE ถูกทับ (ไม่มี writer ของ OVERDUE ใน accounting เลย); existingReversal check ซ้ำซ้อน (ไม่ซ้ำ — กันกรณี manual reverse มาก่อน void); Date.now() idempotencyKey (ตั้งใจ, มีคอมเมนต์อธิบายแล้ว)

Spawned task chips (นอก scope): Prisma7 createJournalEntry break (ledger repo), ReverseJournalUseCase report double-subtract, IssueDocumentUseCase voidNumber-on-RESERVED, expense void disease, vendor bill void disease

## Artifacts

- `prisma-accounting.repository.ts` — `findPostedGeneratedJournalId`, `reverseSourceJournalInTx` (private), `voidPaymentTrueReversal`, `voidDocumentTrueReversal`; ลบ `voidPaymentRecord`; `updateDocumentStatus` ปฏิเสธ VOIDED
- `payment.use-case.ts` / `document.use-case.ts` — Void* orchestration (reserve/commit/cancel number, enriched outbox/audit CRITICAL)
- `posting-source.use-case.ts` — VOIDED guard ใน `buildDocumentPostingInput`, sourceEventType คงที่ 'issued'
- Specs: `prisma-accounting.repository.void.spec.ts` (13), `void-true-reversal.use-case.spec.ts` (9) — ลงทะเบียนใน package.json test list
- Live verify script (scratchpad, ไม่ commit): `h04-live-verify.ts`
- Checklist: H-04 ticked + closure evidence + tracking gaps (2026-07-18)

## Verification

- typecheck clean (ยกเว้น error ในไฟล์ H-05 ของ session อื่น)
- apps/api `pnpm test` 2048/2048 (รวม 22 ของ H-04)
- Live DB (docker :15432, DATABASE_URL explicit) 16/16: concurrent double-void ชนะ 1 (CAS/Serializable), balances คืนครั้งเดียว, REVERSAL 1 แถว, rollback ครบเมื่อ period ปิด, per-account GL net=0 (payment+document), P2002 กัน REVERSAL ซ้ำ

## Next

- Commit (surgical staging — payment/document use-case files มี H-05 edits ปน, package.json ปนหลาย session, checklist ปนทุก session)
- Prod deploy รวมกับ batch remediation อื่น (ไม่มี migration ใหม่ใน H-04)
