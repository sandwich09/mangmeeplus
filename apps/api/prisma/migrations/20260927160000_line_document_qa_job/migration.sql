CREATE TYPE "LineDocumentQaJobStatus" AS ENUM ('QUEUED', 'READING', 'ANSWER_READY', 'FAILED', 'EXPIRED', 'CANCELED');

CREATE TABLE "LineDocumentQaJob" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "ownerMembershipId" TEXT NOT NULL,
  "ownerEpoch" INTEGER NOT NULL,
  "ownerDigest" TEXT NOT NULL,
  "channelKind" TEXT NOT NULL,
  "messagingChannelId" TEXT NOT NULL,
  "chatKeyHash" TEXT NOT NULL,
  "turnId" TEXT NOT NULL,
  "questionText" TEXT NOT NULL,
  "admittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attachmentsJson" JSONB NOT NULL,
  "inputDigest" TEXT NOT NULL,
  "inputSetHash" TEXT NOT NULL,
  "questionDigest" TEXT NOT NULL,
  "readerVersion" TEXT NOT NULL,
  "status" "LineDocumentQaJobStatus" NOT NULL DEFAULT 'QUEUED',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "leaseOwner" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "leaseFence" INTEGER NOT NULL DEFAULT 0,
  "foregroundDeadlineAt" TIMESTAMP(3) NOT NULL,
  "jobDeadlineAt" TIMESTAMP(3) NOT NULL,
  "budgetAuthorityJson" JSONB,
  "budgetAuthorityRevision" INTEGER NOT NULL DEFAULT 0,
  "resultJson" JSONB,
  "resultHash" TEXT,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "purgeAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LineDocumentQaJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LineDocumentQaJob_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "LineDocumentQaJob_lease_fence_check" CHECK ("leaseFence" >= 0),
  CONSTRAINT "LineDocumentQaJob_budget_revision_check" CHECK ("budgetAuthorityRevision" >= 0),
  CONSTRAINT "LineDocumentQaJob_input_hash_check" CHECK ("inputSetHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "LineDocumentQaJob_input_digest_check" CHECK ("inputDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "LineDocumentQaJob_question_hash_check" CHECK ("questionDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "LineDocumentQaJob_owner_digest_check" CHECK ("ownerDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "LineDocumentQaJob_result_size_check" CHECK ("resultJson" IS NULL OR octet_length("resultJson"::text) <= 65536),
  CONSTRAINT "LineDocumentQaJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LineDocumentQaJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LineDocumentQaJob_ownerDigest_turnId_inputSetHash_questionDigest_readerVersion_key"
  ON "LineDocumentQaJob"("ownerDigest", "turnId", "inputSetHash", "questionDigest", "readerVersion");
CREATE INDEX "LineDocumentQaJob_status_leaseUntil_idx" ON "LineDocumentQaJob"("status", "leaseUntil");
CREATE INDEX "LineDocumentQaJob_companyId_expiresAt_idx" ON "LineDocumentQaJob"("companyId", "expiresAt");
CREATE INDEX "LineDocumentQaJob_companyId_userId_createdAt_idx" ON "LineDocumentQaJob"("companyId", "userId", "createdAt");
