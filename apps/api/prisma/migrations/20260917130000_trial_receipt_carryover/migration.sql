ALTER TABLE "BillingReceiptGrant"
  DROP CONSTRAINT "BillingReceiptGrant_valid_units_period_kind",
  ADD CONSTRAINT "BillingReceiptGrant_valid_units_period_kind" CHECK (
    "units" >= 0 AND "serviceStart" < "serviceEnd" AND "availableAt" < "expiresAt" AND "expiresAt" >= "serviceEnd"
    AND "kind" IN ('INITIAL', 'RENEWAL', 'REPEAT', 'UPGRADE', 'ADMIN_ADJUSTMENT', 'TRIAL_CARRYOVER')
    AND ("kind" <> 'ADMIN_ADJUSTMENT' OR "units" > 0)
    AND ("kind" <> 'TRIAL_CARRYOVER' OR ("units" BETWEEN 1 AND 15 AND "expiresAt" = "serviceEnd"))
  );

CREATE UNIQUE INDEX "BillingReceiptGrant_one_trial_carryover_per_company"
  ON "BillingReceiptGrant" ("companyId") WHERE "kind" = 'TRIAL_CARRYOVER';
