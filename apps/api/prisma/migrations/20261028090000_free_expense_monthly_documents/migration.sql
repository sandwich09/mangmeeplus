ALTER TABLE "CompanyOcrUsageEvent" ADD COLUMN "quotaSource" TEXT,
    ADD COLUMN "succeededAt" TIMESTAMP(3);
ALTER TABLE "CompanyPlanTerm" ADD COLUMN "freeQuotaNoticeSentMonthKey" TEXT;
CREATE INDEX "CompanyOcrUsageEvent_companyId_monthKey_quotaSource_succeed_idx"
    ON "CompanyOcrUsageEvent"("companyId", "monthKey", "quotaSource", "succeededAt");
