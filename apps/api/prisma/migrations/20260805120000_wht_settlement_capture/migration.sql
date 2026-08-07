-- WHT at settlement time (spec: docs/specs/wht-settlement-capture-spec.md).
--
-- Two independent seams, one migration on purpose: both sets of columns are approved in the same
-- plan, and a second additive pass over the same two tables would cost another hand-applied
-- migration under the drift workaround below for no benefit. The pay side (Phase 1) uses its
-- columns immediately; the receive side (Phase 2) columns land here so the data model is final and
-- nothing needs re-migrating when its code follows.
--
-- SupplierPayment.whtCategoryCode/whtRate — the withholding decision behind the existing whtAmount.
-- Deliberately NOT a foreign key to WhtIncomeCategory: that catalog is global, versioned, and its
-- rows are seeded DRAFT for accountant review, so a settled payment must keep the code it withheld
-- under even if the catalog row is later retired. Rate is a PERCENT ('3.0000' = 3%).
--
-- AccountingPayment.whtAmount / AccountingPaymentAllocation.whtAmount — tax the customer withheld
-- from us. It settles the document without ever reaching the bank, so it is separate from `amount`,
-- which stays cash and is what bank reconciliation matches on.
--
-- Additive and idempotent: nullable, or NOT NULL with a 0 default that reads exactly as today's
-- behaviour for every existing row. No backfill — an old payment genuinely withheld nothing.
--
-- Hand-written and idempotent because `prisma migrate dev` is blocked by the unhealed drift on
-- 20260728120000_stock_movement_single_reversal: apply with `prisma db execute`, then
-- `prisma migrate resolve --applied 20260805120000_wht_settlement_capture`.
ALTER TABLE "SupplierPayment"
  ADD COLUMN IF NOT EXISTS "whtCategoryCode" TEXT,
  ADD COLUMN IF NOT EXISTS "whtRate" DECIMAL(8,4);

ALTER TABLE "AccountingPayment"
  ADD COLUMN IF NOT EXISTS "whtAmount" DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE "AccountingPaymentAllocation"
  ADD COLUMN IF NOT EXISTS "whtAmount" DECIMAL(18,4);
