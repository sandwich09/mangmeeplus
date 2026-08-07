-- Phase 6 of the AI metering spec (owner revision 2026-07-29): the FX rate each usage row was
-- priced at, the operational FX cache row, and the DB-backed platform budget settings.
-- Idempotent (IF NOT EXISTS + a NULL-only backfill + an already-a-no-op SET NOT NULL) so a
-- partially-applied deploy re-runs safely — the dirty-tree deploy history makes that standing.

-- Added nullable first so existing rows survive, then backfilled with 33: AI_THB_PER_USD has
-- only ever been configured at 33 (packages/config default, every .env.example), so 33 is the
-- rate those rows were actually priced at — a factual backfill, not a guess.
ALTER TABLE "AiUsageEvent" ADD COLUMN IF NOT EXISTS "thbPerUsd" DECIMAL(10,4);
UPDATE "AiUsageEvent" SET "thbPerUsd" = 33 WHERE "thbPerUsd" IS NULL;
-- SET NOT NULL is itself a no-op when the column is already NOT NULL, so the re-run is clean.
ALTER TABLE "AiUsageEvent" ALTER COLUMN "thbPerUsd" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "AiFxRate" (
    "id" TEXT NOT NULL,
    "rate" DECIMAL(10,4) NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiFxRate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PlatformAiBudgetConfig" (
    "id" TEXT NOT NULL,
    "monthlyBudgetSatang" INTEGER NOT NULL,
    "ceilingSatang" INTEGER NOT NULL,
    "updatedBySystemAdminUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAiBudgetConfig_pkey" PRIMARY KEY ("id")
);
