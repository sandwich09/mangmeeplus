-- P10-L §15.1 / review G-01 — the monthly receipt (slip) counter behind `CompanyPlanTerm.monthlySlipLimit`.
-- Additive only: two new tables and one new enum. Nothing existing is altered, so the
-- RECEIPT_QUOTA_ENFORCED flag alone rolls the behaviour back.

CREATE TYPE "CompanyReceiptUsageStatus" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED');

-- The aggregate the CAS increment races on: one row per company per Bangkok month.
CREATE TABLE "CompanyReceiptUsage" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "monthKey" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyReceiptUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyReceiptUsage_companyId_monthKey_key"
  ON "CompanyReceiptUsage"("companyId", "monthKey");

ALTER TABLE "CompanyReceiptUsage"
  ADD CONSTRAINT "CompanyReceiptUsage_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The request fence. A LINE redelivery arrives under a new webhook/request id but the same
-- lineMessageId, so the caller namespaces the id and this unique index makes the second attempt
-- find the first reservation instead of buying a second slip.
CREATE TABLE "CompanyReceiptUsageEntry" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "monthKey" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "status" "CompanyReceiptUsageStatus" NOT NULL DEFAULT 'RESERVED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyReceiptUsageEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyReceiptUsageEntry_requestId_key"
  ON "CompanyReceiptUsageEntry"("requestId");

CREATE INDEX "CompanyReceiptUsageEntry_companyId_monthKey_idx"
  ON "CompanyReceiptUsageEntry"("companyId", "monthKey");

ALTER TABLE "CompanyReceiptUsageEntry"
  ADD CONSTRAINT "CompanyReceiptUsageEntry_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
