-- §8.3 (uat-correctness-latency spec): DB-backed NEUTRAL intake state for a financial
-- clarification. Until now the only continuation state was the Redis ledger, which FAILS OPEN by
-- design — an outage silently degrades to "no open question", and a turn carrying money facts can
-- then be merged or written on a state nobody can vouch for. Money never rides fail-open state:
-- this table is the durable half, and the ledger may carry a bounded reference to a row here but is
-- not the source of truth for any amount.
--
-- Owner binding is the FULL triple (companyId, userId, chatKeyHash). It is in the WHERE clause of
-- every read and of the resolve UPDATE, so a different member, chat or company does not merely fail
-- a check — it selects no row at all and therefore can never consume someone else's open state.
--
-- `version` is the CAS token. Resolve is a single conditional UPDATE (status = 'OPEN' AND version =
-- expected AND expiresAt > now), so a stale, expired or already-consumed state matches zero rows
-- and the caller refuses instead of merging. A store outage raises instead of returning a value,
-- and the caller fails CLOSED with zero domain writes.
CREATE TYPE "LineIntakeStateStatus" AS ENUM ('OPEN', 'RESOLVED', 'SUPERSEDED', 'EXPIRED');

-- CreateTable
CREATE TABLE "LineIntakeState" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatKeyHash" TEXT NOT NULL,
    "targetIntent" TEXT NOT NULL,
    "semanticOutcome" TEXT,
    "acceptedHintsJson" JSONB,
    "missingFields" TEXT[],
    "conflictingFields" TEXT[],
    "provenanceJson" JSONB,
    "sourceEventHash" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "LineIntakeStateStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineIntakeState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LineIntakeState_companyId_userId_chatKeyHash_status_idx" ON "LineIntakeState"("companyId", "userId", "chatKeyHash", "status");

-- CreateIndex
CREATE INDEX "LineIntakeState_status_expiresAt_idx" ON "LineIntakeState"("status", "expiresAt");

-- The invariant itself: at most ONE open clarification per owner, so "which state does this answer
-- belong to?" has exactly one answer and two concurrent opens cannot both win. A racing second open
-- fails on this index rather than creating a rival row the next turn would have to choose between.
--
-- PARTIAL on purpose. Terminal rows (RESOLVED / SUPERSEDED / EXPIRED) accumulate as history, so a
-- plain unique on (companyId, userId, chatKeyHash, status) would reject the SECOND resolved
-- clarification for the same person in the same chat — the normal case, not an edge one. Only the
-- OPEN row is constrained.
--
-- Prisma cannot model a partial unique index, so it lives here and is noted on the model in
-- schema.prisma — a future `prisma migrate diff` must not drop it.
CREATE UNIQUE INDEX "LineIntakeState_companyId_userId_chatKeyHash_open_key"
  ON "LineIntakeState" ("companyId", "userId", "chatKeyHash")
  WHERE "status" = 'OPEN';
