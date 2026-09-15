-- A company-owned gift is not a purchased package and must not create a paid account.
ALTER TABLE "BillingReceiptGrant" ALTER COLUMN "billingAccountId" DROP NOT NULL;
ALTER TABLE "BillingReceiptGrant" ADD CONSTRAINT "BillingReceiptGrant_manual_admin_only"
  CHECK ("billingAccountId" IS NOT NULL OR "kind" = 'ADMIN_ADJUSTMENT');
CREATE UNIQUE INDEX "BillingReceiptGrant_manual_company_source_key"
  ON "BillingReceiptGrant" ("companyId", "sourceKey") WHERE "billingAccountId" IS NULL;
