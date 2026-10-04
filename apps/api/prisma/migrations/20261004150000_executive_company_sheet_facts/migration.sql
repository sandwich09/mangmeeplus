-- Existing summaries remain unknown until the next FULL report build. No transaction rows change.
ALTER TABLE "ExecutiveCompanyMonth"
  ADD COLUMN "lastActivityAt" TIMESTAMP(3),
  ADD COLUMN "activityHistorySince" TIMESTAMP(3),
  ADD COLUMN "activitySnapshotReady" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ExecutiveCompanyProfile"
  ADD COLUMN "sheetFacts" JSONB,
  ADD COLUMN "businessTypeCode" TEXT,
  ADD COLUMN "businessTypeOther" TEXT;
