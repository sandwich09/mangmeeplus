-- Additive AI usage metadata (remediation spec §11.2/§11.3). Nullable columns plus one
-- defaulted column only: no backfill, no rewrite, no re-pricing of history. An old writer that
-- knows none of these keeps inserting valid rows, and an old reader keeps working unchanged.
ALTER TABLE "AiUsageEvent"
  ADD COLUMN "requestKind" TEXT,
  ADD COLUMN "budgetBucket" TEXT,
  ADD COLUMN "usageBasis" TEXT,
  ADD COLUMN "eventKind" TEXT NOT NULL DEFAULT 'MODEL_CALL',
  ADD COLUMN "pricingSnapshot" JSONB,
  ADD COLUMN "adjustsEventId" TEXT,
  ADD COLUMN "correctionKey" TEXT,
  ADD CONSTRAINT "AiUsageEvent_requestKind_check" CHECK ("requestKind" IN ('TEXT', 'IMAGE', 'OTHER')),
  ADD CONSTRAINT "AiUsageEvent_budgetBucket_check" CHECK ("budgetBucket" IN ('CHAT', 'OCR')),
  ADD CONSTRAINT "AiUsageEvent_usageBasis_check" CHECK ("usageBasis" IN ('PROVIDER_REPORTED', 'CONSERVATIVE_ESTIMATE')),
  ADD CONSTRAINT "AiUsageEvent_eventKind_check" CHECK ("eventKind" IN ('MODEL_CALL', 'COST_ADJUSTMENT'));

-- Replay fence for an audited correction. NULLs never collide, so every MODEL_CALL row (legacy
-- and new) stays outside it. Deliberately NOT an execution/invocation identity: that fence
-- belongs to Phase E, and adding it now would drop a metering replay instead of deduplicating it.
CREATE UNIQUE INDEX "AiUsageEvent_correctionKey_key" ON "AiUsageEvent" ("correctionKey");
