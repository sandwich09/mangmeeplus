-- UAT r5 item 2 — durable stored result for EVERY launch-gate control-plane command, no-ops
-- included. Purely ADDITIVE: one new enum, one new table, no change to any existing column, so the
-- currently deployed build keeps running unchanged while this migration is applied.
--
-- Not backfilled on purpose. Commands recorded before this table existed still have their append-only
-- transition row, and `LaunchGateCommandUseCase` falls back to it for their replays; back-filling
-- would have to invent a result kind for retirement markers and bootstrap attestations, which are
-- not commands and must never be replayable as one.
CREATE TYPE "FeatureLaunchCommandResultKind" AS ENUM ('NOOP', 'APPLIED', 'ACCEPTED');

CREATE TABLE "FeatureLaunchCommandResult" (
    "id" TEXT NOT NULL,
    "gateKey" TEXT NOT NULL,
    "routeKey" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "resultKind" "FeatureLaunchCommandResultKind" NOT NULL,
    "action" "FeatureLaunchGateAction" NOT NULL,
    "state" "FeatureLaunchGateState" NOT NULL,
    "generation" INTEGER NOT NULL,
    "lastSeq" INTEGER NOT NULL,
    "payloadFingerprint" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "targetEnvironment" TEXT NOT NULL,
    "buildReleaseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureLaunchCommandResult_pkey" PRIMARY KEY ("id")
);

-- One stored answer per command on a route: the uniqueness that makes a replay a lookup.
CREATE UNIQUE INDEX "FeatureLaunchCommandResult_gateKey_routeKey_commandId_key"
    ON "FeatureLaunchCommandResult"("gateKey", "routeKey", "commandId");

CREATE INDEX "FeatureLaunchCommandResult_gateKey_routeKey_createdAt_idx"
    ON "FeatureLaunchCommandResult"("gateKey", "routeKey", "createdAt");
