-- P10-L §8 delta (line-support-request-spec-th §2.1). Additive: one enum, one table, two indexes.
-- Nothing existing is altered, so this is safe to apply ahead of the code that reads it.

-- CreateEnum
CREATE TYPE "LineSupportRequestStatus" AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');

-- CreateTable
CREATE TABLE "LineSupportRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "lineUserId" TEXT NOT NULL,
    "lineUserIdHash" TEXT NOT NULL,
    "signupRequestId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageText" TEXT,
    "lineNotifiedCount" INTEGER NOT NULL DEFAULT 0,
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "status" "LineSupportRequestStatus" NOT NULL DEFAULT 'OPEN',
    "answeredAt" TIMESTAMP(3),
    "answeredByUserId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineSupportRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The queue read: OPEN first, newest first.
CREATE INDEX "LineSupportRequest_status_requestedAt_idx" ON "LineSupportRequest"("status", "requestedAt");

-- CreateIndex
-- The dedupe read: is this person's request still OPEN?
CREATE INDEX "LineSupportRequest_lineUserId_status_idx" ON "LineSupportRequest"("lineUserId", "status");
