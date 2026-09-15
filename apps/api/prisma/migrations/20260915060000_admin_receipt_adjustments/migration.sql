-- Extend the existing ledger without changing purchased grants or weakening date boundaries.
ALTER TABLE "BillingReceiptGrant"
  DROP CONSTRAINT "BillingReceiptGrant_valid_units_period_kind",
  ADD CONSTRAINT "BillingReceiptGrant_valid_units_period_kind" CHECK (
    "units" >= 0 AND "serviceStart" < "serviceEnd" AND "availableAt" < "expiresAt" AND "expiresAt" >= "serviceEnd"
    AND "kind" IN ('INITIAL', 'RENEWAL', 'REPEAT', 'UPGRADE', 'ADMIN_ADJUSTMENT')
    AND ("kind" <> 'ADMIN_ADJUSTMENT' OR "units" > 0)
  );
