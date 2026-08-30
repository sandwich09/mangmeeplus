-- P29: admin-managed plan limits and usage term. Companies without a row are grandfathered.
CREATE TABLE "CompanyPlanTerm" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "tierKey" TEXT NOT NULL,
  "branchLimit" INTEGER NOT NULL,
  "employeeLimit" INTEGER NOT NULL,
  "monthlySlipLimit" INTEGER NOT NULL,
  "termStartAt" TIMESTAMP(3) NOT NULL,
  "termEndsAt" TIMESTAMP(3) NOT NULL,
  "warningDays" INTEGER NOT NULL DEFAULT 7,
  "renewCount" INTEGER NOT NULL DEFAULT 0,
  "lastRenewedAt" TIMESTAMP(3),
  "termDisabledAt" TIMESTAMP(3),
  "warn7SentAt" TIMESTAMP(3),
  "warn3SentAt" TIMESTAMP(3),
  "warn1SentAt" TIMESTAMP(3),
  "expiredNotifiedAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyPlanTerm_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyPlanTerm_companyId_key" ON "CompanyPlanTerm"("companyId");
CREATE INDEX "CompanyPlanTerm_termEndsAt_idx" ON "CompanyPlanTerm"("termEndsAt");

ALTER TABLE "CompanyPlanTerm"
  ADD CONSTRAINT "CompanyPlanTerm_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
