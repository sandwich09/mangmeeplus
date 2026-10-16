-- Additive: no default answer is inferred for any existing shop.
CREATE TABLE "WhtPayerModeFact" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "effectiveFromPeriodKey" TEXT NOT NULL,
  "answeredByUserId" TEXT NOT NULL,
  "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "supersededAt" TIMESTAMP(3),
  CONSTRAINT "WhtPayerModeFact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WhtPayerModeFact_mode_check" CHECK ("mode" IN ('HEAD_OFFICE_PAYS_ALL', 'EACH_BRANCH_PAYS')),
  CONSTRAINT "WhtPayerModeFact_month_check" CHECK ("effectiveFromPeriodKey" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
CREATE INDEX "WhtPayerModeFact_companyId_supersededAt_effectiveFromPeriodKey_idx" ON "WhtPayerModeFact"("companyId", "supersededAt", "effectiveFromPeriodKey");
CREATE UNIQUE INDEX "WhtPayerModeFact_live_month_key" ON "WhtPayerModeFact"("companyId", "effectiveFromPeriodKey") WHERE "supersededAt" IS NULL;
