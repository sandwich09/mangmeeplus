-- AI usage metering ledger (spec §7.3): per-call events plus the running per-company
-- monthly aggregate the budget check will read in phase 4. No enforcement here — this
-- migration only makes the ledger exist.
-- Idempotent (IF NOT EXISTS + duplicate_object guards) so a partially-applied deploy
-- re-runs safely; the dirty-tree deploy history makes that a standing requirement.

CREATE TABLE IF NOT EXISTS "AiUsageEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "sourceRoute" TEXT NOT NULL,
    "usageTag" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadInputTokens" INTEGER NOT NULL,
    "cacheWriteInputTokens" INTEGER NOT NULL,
    "costSatang" INTEGER NOT NULL,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CompanyAiMonthlyUsage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "costSatang" INTEGER NOT NULL DEFAULT 0,
    "callCount" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadInputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteInputTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyAiMonthlyUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiUsageEvent_companyId_monthKey_idx" ON "AiUsageEvent"("companyId", "monthKey");

CREATE INDEX IF NOT EXISTS "AiUsageEvent_companyId_createdAt_idx" ON "AiUsageEvent"("companyId", "createdAt");

-- The unique row is load-bearing: it serializes concurrent increments so the upsert can
-- return a post-increment total that crosses a threshold exactly once.
CREATE UNIQUE INDEX IF NOT EXISTS "CompanyAiMonthlyUsage_companyId_monthKey_key" ON "CompanyAiMonthlyUsage"("companyId", "monthKey");

DO $$
BEGIN
  ALTER TABLE "AiUsageEvent" ADD CONSTRAINT "AiUsageEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "CompanyAiMonthlyUsage" ADD CONSTRAINT "CompanyAiMonthlyUsage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
