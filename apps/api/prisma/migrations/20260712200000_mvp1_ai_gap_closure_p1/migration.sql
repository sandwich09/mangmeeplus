-- MVP1 AI gap-closure P1 foundations (additive; rolling-deploy safe).
-- Plan: docs/plans/ai-permission-tools-production-gap-closure-plan.md

-- CUST-01: typed audit actor
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM', 'CRM_CUSTOMER', 'SERVICE');

ALTER TABLE "AuditLog"
  ADD COLUMN "actorType" "AuditActorType" NOT NULL DEFAULT 'USER',
  ADD COLUMN "actorRefId" TEXT;

-- RECEIPT-02: one expense per LINE message (NULLs stay distinct for web-created rows).
-- Guard: stop with a clear report if historical duplicates exist; operators must
-- resolve them (docs runbook) before this migration can apply.
DO $$
DECLARE dup_count integer;
BEGIN
  SELECT count(*) INTO dup_count FROM (
    SELECT "companyId", "lineMessageId"
    FROM "ExpenseRecord"
    WHERE "lineMessageId" IS NOT NULL
    GROUP BY "companyId", "lineMessageId"
    HAVING count(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'ExpenseRecord has % duplicated (companyId, lineMessageId) pairs; resolve before applying unique index', dup_count;
  END IF;
END $$;

CREATE UNIQUE INDEX "ExpenseRecord_companyId_lineMessageId_key" ON "ExpenseRecord"("companyId", "lineMessageId");

-- CUST-02: persisted booking proposal → confirmation state machine
CREATE TYPE "CrmBookingProposalStatus" AS ENUM ('PROPOSED', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'COMMITTING', 'BOOKED', 'EXPIRED', 'CANCELLED', 'CONFLICTED', 'HANDED_TO_STAFF');

CREATE TABLE "CrmBookingProposal" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "serviceItemId" TEXT,
    "staffUserId" TEXT,
    "branchId" TEXT,
    "slotStart" TIMESTAMP(3) NOT NULL,
    "slotEnd" TIMESTAMP(3) NOT NULL,
    "status" "CrmBookingProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "sourceMessageId" TEXT,
    "confirmMessageId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmBookingProposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrmBookingProposal_idempotencyKey_key" ON "CrmBookingProposal"("idempotencyKey");
CREATE INDEX "CrmBookingProposal_companyId_conversationId_status_idx" ON "CrmBookingProposal"("companyId", "conversationId", "status");
CREATE INDEX "CrmBookingProposal_companyId_status_expiresAt_idx" ON "CrmBookingProposal"("companyId", "status", "expiresAt");

-- RECEIPT-05: pending media awaiting clarify answer (owner decision 2026-07-12)
CREATE TYPE "LineIntakePendingMediaStatus" AS ENUM ('PENDING', 'RESOLVED_RECEIPT', 'RESOLVED_ILLUSTRATION', 'EXPIRED');

CREATE TABLE "LineIntakePendingMedia" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lineMessageId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "caption" TEXT,
    "mimeType" TEXT NOT NULL,
    "status" "LineIntakePendingMediaStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineIntakePendingMedia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LineIntakePendingMedia_companyId_lineMessageId_key" ON "LineIntakePendingMedia"("companyId", "lineMessageId");
CREATE INDEX "LineIntakePendingMedia_companyId_userId_status_idx" ON "LineIntakePendingMedia"("companyId", "userId", "status");

-- CUST-05: atomic per-channel daily auto-reply cap reservation
CREATE TABLE "CrmChannelAutoReplyUsage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmChannelAutoReplyUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrmChannelAutoReplyUsage_channelId_dayKey_key" ON "CrmChannelAutoReplyUsage"("channelId", "dayKey");
CREATE INDEX "CrmChannelAutoReplyUsage_companyId_dayKey_idx" ON "CrmChannelAutoReplyUsage"("companyId", "dayKey");
