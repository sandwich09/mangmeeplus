-- Durable per-invocation money holds, the bucket slice of the month aggregate, and the settlement
-- fence on the existing usage ledger (remediation spec §12.3/§12.4/§12.6, ADR 0013 §3).
--
-- Additive only: two new tables plus one nullable column with a unique index whose NULLs never
-- collide. Nothing is backfilled and no existing row is rewritten, so every company keeps behaving
-- exactly as it does today. An OLD binary that knows none of this keeps working: it never selects
-- or writes these objects, its `AiUsageEvent` INSERTs leave "invocationKey" NULL, and it can only
-- ever serve SHARED companies because nothing can set 'SPLIT' without the E1a writer.

-- The settlement fence. One `AiUsageEvent` per provider invocation under an envelope; a replayed
-- settlement finds the row and is a no-op instead of billing the company twice. Legacy and SHARED
-- rows stay NULL and stay outside the index.
ALTER TABLE "AiUsageEvent" ADD COLUMN "invocationKey" TEXT;
CREATE UNIQUE INDEX "AiUsageEvent_invocationKey_key" ON "AiUsageEvent" ("invocationKey");

-- Per-bucket month aggregate. Written in the same transaction as the event and the month total for
-- every row whose bucket is known, SHARED companies included, so the console and a later SPLIT
-- activation read ONE aggregate rather than re-deriving bucket spend from the event table.
CREATE TABLE "CompanyAiMonthlyBucketUsage" (
  "id"         TEXT NOT NULL,
  "companyId"  TEXT NOT NULL,
  "monthKey"   TEXT NOT NULL,
  "bucket"     TEXT NOT NULL,
  "costSatang" INTEGER NOT NULL DEFAULT 0,
  "callCount"  INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyAiMonthlyBucketUsage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompanyAiMonthlyBucketUsage_bucket_check" CHECK ("bucket" IN ('CHAT', 'OCR'))
);
CREATE UNIQUE INDEX "CompanyAiMonthlyBucketUsage_companyId_monthKey_bucket_key"
  ON "CompanyAiMonthlyBucketUsage" ("companyId", "monthKey", "bucket");
ALTER TABLE "CompanyAiMonthlyBucketUsage"
  ADD CONSTRAINT "CompanyAiMonthlyBucketUsage_companyId_fkey" FOREIGN KEY ("companyId")
  REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One row per provider invocation a SPLIT company is about to make. `reserved` is the live SUM of
-- "upperBoundSatang" over RESERVED|DISPATCHED|UNRESOLVED rows of the company-month, read under the
-- ai-budget advisory lock — deliberately no second counter that could drift from these rows.
CREATE TABLE "AiBudgetReservation" (
  "id"                TEXT NOT NULL,
  "companyId"         TEXT NOT NULL,
  "monthKey"          TEXT NOT NULL,
  "bucket"            TEXT NOT NULL,
  "policyRevision"    TEXT NOT NULL,
  "sourceRoute"       TEXT NOT NULL,
  "stepKind"          TEXT NOT NULL,
  "attemptKey"        TEXT NOT NULL,
  "invocationKey"     TEXT NOT NULL,
  "upperBoundSatang"  INTEGER NOT NULL,
  "pricingSnapshot"   JSONB NOT NULL,
  -- Server-derived D1 metadata, pinned so a gateway-driven settlement is never UNKNOWN.
  "requestKind"       TEXT,
  "status"            TEXT NOT NULL DEFAULT 'RESERVED',
  "ownerToken"        TEXT NOT NULL,
  "settledCostSatang" INTEGER,
  "usageBasis"        TEXT,
  "evidenceJson"      JSONB,
  "breach"            BOOLEAN NOT NULL DEFAULT false,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispatchedAt"      TIMESTAMP(3),
  "settledAt"         TIMESTAMP(3),
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiBudgetReservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiBudgetReservation_bucket_check" CHECK ("bucket" IN ('CHAT', 'OCR')),
  CONSTRAINT "AiBudgetReservation_requestKind_check" CHECK ("requestKind" IN ('TEXT', 'IMAGE', 'OTHER')),
  CONSTRAINT "AiBudgetReservation_status_check"
    CHECK ("status" IN ('RESERVED', 'DISPATCHED', 'SETTLED', 'UNRESOLVED', 'CANCELLED')),
  -- A hold is money: never negative. 0 is legal (a free-priced model would still need a hold row).
  CONSTRAINT "AiBudgetReservation_upperBoundSatang_check" CHECK ("upperBoundSatang" >= 0),
  CONSTRAINT "AiBudgetReservation_settledCostSatang_check" CHECK ("settledCostSatang" >= 0)
);
-- The execution fence: a duplicate dispatch of the same invocation can never create a second hold.
CREATE UNIQUE INDEX "AiBudgetReservation_invocationKey_key" ON "AiBudgetReservation" ("invocationKey");
-- The two reads admission makes under the lock: the company-month total, then the bucket slice.
CREATE INDEX "AiBudgetReservation_companyId_monthKey_status_idx"
  ON "AiBudgetReservation" ("companyId", "monthKey", "status");
CREATE INDEX "AiBudgetReservation_companyId_monthKey_bucket_status_idx"
  ON "AiBudgetReservation" ("companyId", "monthKey", "bucket", "status");
ALTER TABLE "AiBudgetReservation"
  ADD CONSTRAINT "AiBudgetReservation_companyId_fkey" FOREIGN KEY ("companyId")
  REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
