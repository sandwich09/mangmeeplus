-- Platform-admin OCR governance. Existing companies stay enabled and unlimited.
ALTER TABLE "CompanyAiConfiguration"
  ADD COLUMN "ocrEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "ocrMonthlyLimit" INTEGER;

ALTER TABLE "CompanyAiConfiguration"
  ADD CONSTRAINT "CompanyAiConfiguration_ocrMonthlyLimit_check"
  CHECK ("ocrMonthlyLimit" IS NULL OR ("ocrMonthlyLimit" >= 1 AND "ocrMonthlyLimit" <= 1000000));

CREATE TABLE "CompanyOcrUsageEvent" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "monthKey" TEXT NOT NULL,
  "sourceRoute" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CompanyOcrUsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanyOcrMonthlyUsage" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "monthKey" TEXT NOT NULL,
  "usedCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CompanyOcrMonthlyUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyOcrUsageEvent_companyId_sourceRoute_requestId_key"
  ON "CompanyOcrUsageEvent"("companyId", "sourceRoute", "requestId");
CREATE INDEX "CompanyOcrUsageEvent_companyId_monthKey_sourceRoute_idx"
  ON "CompanyOcrUsageEvent"("companyId", "monthKey", "sourceRoute");
CREATE INDEX "CompanyOcrUsageEvent_companyId_createdAt_idx"
  ON "CompanyOcrUsageEvent"("companyId", "createdAt");
CREATE UNIQUE INDEX "CompanyOcrMonthlyUsage_companyId_monthKey_key"
  ON "CompanyOcrMonthlyUsage"("companyId", "monthKey");
CREATE INDEX "AttachmentObject_companyId_status_uploadedAt_idx"
  ON "AttachmentObject"("companyId", "status", "uploadedAt");

ALTER TABLE "CompanyOcrUsageEvent"
  ADD CONSTRAINT "CompanyOcrUsageEvent_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyOcrMonthlyUsage"
  ADD CONSTRAINT "CompanyOcrMonthlyUsage_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
