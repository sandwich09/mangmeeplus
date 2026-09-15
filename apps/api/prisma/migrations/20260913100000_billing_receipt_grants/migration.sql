-- Additive paid package quota only. Unrelated baseline schema drift is intentionally excluded.

ALTER TABLE "CompanyOcrUsageEvent" ADD COLUMN     "billingReceiptGrantId" TEXT;

ALTER TABLE "CompanyPlanTerm" ADD COLUMN     "billingReceiptAccountId" TEXT;

CREATE TABLE "BillingReceiptGrant" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "billingAccountId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "serviceStart" TIMESTAMP(3) NOT NULL,
    "serviceEnd" TIMESTAMP(3) NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "policyRevisionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillingReceiptGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BillingReceiptGrant_companyId_billingAccountId_expiresAt_idx" ON "BillingReceiptGrant"("companyId", "billingAccountId", "expiresAt");

CREATE UNIQUE INDEX "BillingReceiptGrant_id_companyId_key" ON "BillingReceiptGrant"("id", "companyId");

CREATE UNIQUE INDEX "BillingReceiptGrant_billingAccountId_sourceKey_key" ON "BillingReceiptGrant"("billingAccountId", "sourceKey");

CREATE UNIQUE INDEX "BillingAccount_id_companyId_key" ON "BillingAccount"("id", "companyId");

CREATE INDEX "CompanyOcrUsageEvent_billingReceiptGrantId_idx" ON "CompanyOcrUsageEvent"("billingReceiptGrantId");

ALTER TABLE "CompanyPlanTerm" ADD CONSTRAINT "CompanyPlanTerm_billingReceiptAccountId_companyId_fkey" FOREIGN KEY ("billingReceiptAccountId", "companyId") REFERENCES "BillingAccount"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CompanyOcrUsageEvent" ADD CONSTRAINT "CompanyOcrUsageEvent_billingReceiptGrantId_companyId_fkey" FOREIGN KEY ("billingReceiptGrantId", "companyId") REFERENCES "BillingReceiptGrant"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BillingReceiptGrant" ADD CONSTRAINT "BillingReceiptGrant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BillingReceiptGrant" ADD CONSTRAINT "BillingReceiptGrant_billingAccountId_companyId_fkey" FOREIGN KEY ("billingAccountId", "companyId") REFERENCES "BillingAccount"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BillingReceiptGrant" ADD CONSTRAINT "BillingReceiptGrant_valid_units_period_kind" CHECK (
  "units" >= 0 AND "serviceStart" < "serviceEnd" AND "availableAt" < "expiresAt" AND "expiresAt" >= "serviceEnd"
  AND "kind" IN ('INITIAL', 'RENEWAL', 'REPEAT', 'UPGRADE')
);
