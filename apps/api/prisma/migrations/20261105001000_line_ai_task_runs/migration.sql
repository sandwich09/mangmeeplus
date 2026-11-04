CREATE TABLE "LineAiTaskRun" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "membershipId" TEXT NOT NULL,
  "chatKeyHash" VARCHAR(64) NOT NULL, "kind" VARCHAR(40) NOT NULL, "entry" VARCHAR(20) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN', "deadEnd" BOOLEAN NOT NULL DEFAULT false,
  "eventCount" INTEGER NOT NULL DEFAULT 0, "pressCount" INTEGER NOT NULL DEFAULT 0, "typedCount" INTEGER NOT NULL DEFAULT 0,
  "classifierLabel" VARCHAR(40), "classifierConfidence" DECIMAL(4,3),
  "sourceType" VARCHAR(40), "sourceId" VARCHAR(64), "resultType" VARCHAR(40), "resultId" VARCHAR(64),
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "endedAt" TIMESTAMP(3), "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LineAiTaskRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LineAiTaskRun_companyId_startedAt_idx" ON "LineAiTaskRun"("companyId", "startedAt");
CREATE INDEX "LineAiTaskRun_companyId_chatKeyHash_status_idx" ON "LineAiTaskRun"("companyId", "chatKeyHash", "status");
CREATE INDEX "LineAiTaskRun_companyId_resultId_idx" ON "LineAiTaskRun"("companyId", "resultId");
ALTER TABLE "LineAiTaskRun" ADD CONSTRAINT "LineAiTaskRun_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LineWebhookEventLog" ADD COLUMN "taskRunId" TEXT,
  ADD COLUMN "classifyAuthorityJson" JSONB, ADD COLUMN "classifyAuthorityRevision" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "LineWebhookEventLog_taskRunId_idx" ON "LineWebhookEventLog"("taskRunId");
