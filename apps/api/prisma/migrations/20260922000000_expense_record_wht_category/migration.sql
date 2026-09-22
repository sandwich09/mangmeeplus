-- WHT certificate system issuance, Phase 1.2 (docs/plans/wht-certificate-system-issuance-plan.md §1.2).
--
-- ExpenseRecord.whtCategoryCode/whtRate — the withholding DECISION behind the existing whtAmount,
-- mirroring SupplierPayment.whtCategoryCode/whtRate (20260805120000_wht_settlement_capture) exactly.
-- Deliberately NOT a foreign key to WhtIncomeCategory for the same reason as the AP side: that
-- catalog is global/versioned and a confirmed expense must keep the code it withheld under even if
-- the catalog row is later retired. Rate is a PERCENT ('3.0000' = 3%).
--
-- Additive and idempotent: both nullable, no backfill — an old expense record genuinely was never
-- classified by income category.
ALTER TABLE "ExpenseRecord"
  ADD COLUMN IF NOT EXISTS "whtCategoryCode" TEXT,
  ADD COLUMN IF NOT EXISTS "whtRate" DECIMAL(8,4);
