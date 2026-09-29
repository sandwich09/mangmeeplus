-- Receipt image ledger (chat credit and receipt image plan, PR B). Additive only: a nullable column on the
-- admission event, a new append-only entry table, and three more lot kinds the grant check allows. Existing
-- admissions keep a NULL generation and stay counted as used from the event itself, so no row is backfilled.

-- Add-on lots (spec §6.1). The check is replaced by a wider one exactly as the Admin-adjustment and trial
-- carry-over migrations did: every existing row satisfies it unchanged. An add-on lot always has a paid
-- account (the existing BillingReceiptGrant_manual_admin_only check) and at least one unit.
ALTER TABLE "BillingReceiptGrant"
  DROP CONSTRAINT "BillingReceiptGrant_valid_units_period_kind",
  ADD CONSTRAINT "BillingReceiptGrant_valid_units_period_kind" CHECK (
    "units" >= 0 AND "serviceStart" < "serviceEnd" AND "availableAt" < "expiresAt" AND "expiresAt" >= "serviceEnd"
    AND "kind" IN ('INITIAL', 'RENEWAL', 'REPEAT', 'UPGRADE', 'ADMIN_ADJUSTMENT', 'TRIAL_CARRYOVER', 'ADD_ON_PAID', 'ADD_ON_ADMIN', 'SALES_EVENT')
    AND ("kind" <> 'ADMIN_ADJUSTMENT' OR "units" > 0)
    AND ("kind" <> 'TRIAL_CARRYOVER' OR ("units" BETWEEN 1 AND 15 AND "expiresAt" = "serviceEnd"))
    AND ("kind" NOT IN ('ADD_ON_PAID', 'ADD_ON_ADMIN', 'SALES_EVENT') OR "units" > 0)
  );

ALTER TABLE "CompanyOcrUsageEvent" ADD COLUMN "receiptUnitGeneration" INTEGER;

CREATE TABLE "ReceiptUnitEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptUnitEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReceiptUnitEntry_grantId_kind_idx" ON "ReceiptUnitEntry"("grantId", "kind");
CREATE UNIQUE INDEX "ReceiptUnitEntry_companyId_operationKey_generation_kind_key" ON "ReceiptUnitEntry"("companyId", "operationKey", "generation", "kind");

ALTER TABLE "ReceiptUnitEntry" ADD CONSTRAINT "ReceiptUnitEntry_grantId_companyId_fkey" FOREIGN KEY ("grantId", "companyId") REFERENCES "BillingReceiptGrant"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReceiptUnitEntry" ADD CONSTRAINT "ReceiptUnitEntry_positive_units_generation" CHECK ("units" > 0 AND "generation" > 0);
