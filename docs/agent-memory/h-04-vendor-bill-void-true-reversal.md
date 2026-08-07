# Agent Memory: H-04 ขยายผล — vendor-bill void เป็น true reversal

Status: DONE (implementation + unit + live-DB verify ผ่าน, 2026-07-18)
Scope: `apps/api/src/modules/procurement/**` (vendor-bill.use-case.ts, prisma-procurement.repository.ts) + specs + package.json test list
Reference pattern: `docs/agent-memory/h-04-payment-document-void-true-reversal.md`

## Decisions

- **Inline reversal ใน repo tx** (แนวเดียวกับ `voidSupplierPayment` + H-04): `voidVendorBillTrueReversal` รันใน `$transaction(..., { isolationLevel: 'Serializable' })` — CAS claim `updateMany({ where: { id, companyId, status: 'APPROVED', paidAmount: 0 } })` count!==1 ⇒ Conflict `vendor_bill_changed` (กัน race กับ payment ที่เพิ่งบันทึก)
- **Journal table เป็น source of truth**: หา GENERATED ของ `['procurement.vendor_bill', 'procurement.vendor_bill.commercial']` (PP36 commercial ใช้ sourceType หลัง; PP36 tax entry เกิดตอน PAID เท่านั้นจึงไม่เจอในบิลที่ void ได้ แต่ query ครอบไว้); GENERATED ที่ไม่ POSTED ⇒ 422 fail closed; POSTED แต่ไม่มีเลขจอง ⇒ Conflict `posting_state_changed` (retry)
- **REVERSAL row เดิม = already-reversed marker** (เช่น manual `ReverseJournalUseCase`) — ข้ามการสร้างซ้ำ แต่ยังตั้ง `postingStatus='reversed'`; unique `[companyId,sourceType,sourceId,entryType]` กันซ้ำระดับ DB
- **Original คง POSTED** — report นับเฉพาะ POSTED ⇒ original+reversal net 0 (double-subtract trap)
- **PP30 lock เฉพาะบิลมี VAT** (`vatAmount > 0`): PP30 ของ periodKey งวด journal สถานะ FILED/PAID/CLOSED ⇒ Conflict `tax_period_locked`; accounting period ไม่ OPEN/REOPENED ⇒ `accounting_period_locked` เสมอ
- **Number lifecycle**: use case reserve `LEDGER_SEQUENCE_KEY` ต่อ journal (periodKey ของ journal, idempotencyKey มี `Date.now()` suffix — deterministic key retry ไม่ได้เพราะได้ reservation CANCELLED เดิมคืน), commit เมื่อ reversal เกิด, cancel เมื่อ fail/ไม่ได้ใช้ (`CancelDocumentNumberUseCase`)
- **Permission model**: `procurement.vendor_bill.void` อย่างเดียว (ตาม H-04: reversal เป็น server-owned non-discretionary) — ต่างจาก `VoidSupplierPaymentUseCase` ที่ยังขอ `journal.entry.reverse` เพิ่ม
- **`updateVendorBillStatus` ปฏิเสธ `VOIDED`** — บังคับผ่าน path ใหม่
- **Unposted bill void**: ไม่มี journal ⇒ ไม่จองเลข ไม่แตะ postingStatus; `countVendorBillPostingBlockers` ไม่นับ VOIDED อยู่แล้ว และ posting source ของบิล VOIDED ⇒ `posting_rule_missing` (สร้าง journal ไม่ได้)

## พบ bug จริงระหว่างทาง

- **`voidSupplierPayment` พังทุกครั้งบน Prisma 7.8**: nested `lines: { create }` ใส่ `companyId` scalar ผ่าน compound relation `[companyId, journalEntryId]` ⇒ `Unknown argument \`companyId\`` (พิสูจน์กับ DB จริงใน live verify) — แก้ด้วย shared helper `reversalJournalLineData` (ไม่มี companyId; `reportContributionsJson: ... ?? undefined` กัน Json null trap) ใช้ทั้ง supplier-payment และ vendor-bill; regression assert ใน `pp36-payment-reversal.repository.spec.ts`

## Artifacts

- `prisma-procurement.repository.ts` — `reversalJournalLineData` (top-level), `listVendorBillJournalsForReversal`, `voidVendorBillTrueReversal`, guard ใน `updateVendorBillStatus`
- `vendor-bill.use-case.ts` — `VoidVendorBillUseCase` orchestration (reason 1-500 chars, reserve/commit/cancel, outbox `vendor_bill.voided`, audit CRITICAL)
- Specs: `vendor-bill-void-reversal.repository.spec.ts` (9), `void-vendor-bill.use-case.spec.ts` (5) — ลงทะเบียนใน `apps/api/package.json` test list แล้ว

## Verification

- `npx tsc --noEmit -p apps/api/tsconfig.json` clean; `pnpm test` (apps/api) 2083/2083
- Live DB (docker :15432, DATABASE_URL explicit ใน script) 14/14: net-zero POSTED-only, original คง POSTED, concurrent void ชนะ 1, rollback ครบเมื่องวดปิด, PP30 FILED lock, paid-bill CAS reject, supplier-payment void สร้าง reversal ได้จริงบน Prisma 7.8
- ยังไม่ commit (dirty-tree convention ของ repo นี้)
