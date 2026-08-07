-- Durable shadow `would_block` evidence (r2 ruling: "persist shadow evidence in an internal
-- aggregate … keyed by observation window, environment, build, surface, gate, route, metric/reason;
-- no companyId/PII and no per-request log-service query").
--
-- Additive only: one new table plus its indexes. No existing column is dropped, widened, narrowed
-- or backfilled, and no NOT NULL is added to any existing table.
--
-- Hand-written and idempotent because `prisma migrate dev` is blocked by the unhealed drift on
-- 20260728120000_stock_movement_single_reversal: apply with `prisma db execute`, then
-- `prisma migrate resolve --applied 20260804120000_feature_launch_observation_bucket`.
CREATE TABLE IF NOT EXISTS "FeatureLaunchObservationBucket" (
  "id"                TEXT NOT NULL,
  "hourStartUtc"      TIMESTAMP(3) NOT NULL,
  "targetEnvironment" TEXT NOT NULL,
  "buildReleaseId"    TEXT NOT NULL,
  "surface"           TEXT NOT NULL,
  "gateKey"           TEXT NOT NULL,
  "routeKey"          TEXT NOT NULL,
  "reason"            TEXT NOT NULL,
  "wouldBlock"        BOOLEAN NOT NULL,
  "observedCount"     INTEGER NOT NULL DEFAULT 0,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FeatureLaunchObservationBucket_pkey" PRIMARY KEY ("id")
);

-- The ONLY unique index on this table, and it must stay that way: the counter write is a single
-- `INSERT … ON CONFLICT DO UPDATE`, which arbitrates on one index. A second unique index would make
-- a concurrent upsert loser reach a non-arbiter index and raise unique_violation instead of
-- incrementing. Explicitly named — the derived name exceeds Postgres' 63-char identifier limit and
-- would be silently truncated, leaving schema and database disagreeing about the index name.
CREATE UNIQUE INDEX IF NOT EXISTS "FeatureLaunchObservationBucket_bucket_key"
  ON "FeatureLaunchObservationBucket"
     ("hourStartUtc", "targetEnvironment", "buildReleaseId", "surface", "gateKey", "routeKey", "reason", "wouldBlock");

-- Serves the health view's trailing-window read, and makes a later retention prune a range scan
-- rather than a seq scan. No prune job ships with this migration.
CREATE INDEX IF NOT EXISTS "FeatureLaunchObservationBucket_hourStartUtc_idx"
  ON "FeatureLaunchObservationBucket" ("hourStartUtc");
