-- Buyer expense capture foundation (contract appendix §2, W01).
--
-- Additive only: six new tables, twelve new enums, four nullable columns on "ExpenseRecord".
-- Every existing row keeps its semantics — a NULL "captureGroupId" means "not a capture-derived
-- source" — and there is no backfill, so a rollback to a binary that predates this migration
-- still reads every legacy expense correctly.
--
-- "ExpenseRecord_companyId_captureGroupId_captureScopeKey_key" is the handoff fence of §2.3/§9:
-- one derived source per issuer scope per group. Postgres indexes NULLs as distinct, so it
-- constrains only rows that actually carry a group — the partial index of §2.3 in effect —
-- and it stays expressible in schema.prisma, which keeps schema and migrations in step.

-- CreateEnum
CREATE TYPE "ExpenseCaptureIntakeChannel" AS ENUM ('WEB', 'LINE');

-- CreateEnum
CREATE TYPE "ExpenseCaptureGroupStatus" AS ENUM ('OPEN', 'HANDED_OFF', 'CLOSED_NO_HANDOFF', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExpenseCaptureBusinessUse" AS ENUM ('UNKNOWN', 'ALL_COMPANY', 'MIXED');

-- CreateEnum
CREATE TYPE "ExpenseCaptureFundingRoute" AS ENUM ('UNKNOWN', 'COMPANY', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "ExpenseCaptureHandoffState" AS ENUM ('NONE', 'ACTIVE', 'RELEASED');

-- CreateEnum
CREATE TYPE "ExpenseCaptureFileState" AS ENUM ('PENDING_UPLOAD', 'STORED', 'REJECTED', 'DETACHED');

-- CreateEnum
CREATE TYPE "ExpenseCaptureReadOwner" AS ENUM ('CAPTURE_GROUP', 'EXPENSE');

-- CreateEnum
CREATE TYPE "ExpenseCaptureReadStatus" AS ENUM ('QUEUED', 'PREPARING', 'READING', 'PARTIAL', 'PAUSED', 'FAILED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExpenseCaptureObservationSource" AS ENUM ('AI', 'HUMAN', 'EXPENSE_FACTS');

-- CreateEnum
CREATE TYPE "ExpenseCaptureAllocationStatus" AS ENUM ('PREVIEW', 'ACCEPTED', 'SUPERSEDED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "LineIntakeAttemptStage" AS ENUM ('DOWNLOAD', 'SECURITY', 'PERSIST', 'READ', 'ROUTE');

-- CreateEnum
CREATE TYPE "LineIntakeAttemptOutcome" AS ENUM ('REJECTED', 'STORED', 'STORED_READING', 'STORED_READ_FAILED', 'STORED_READ_PARTIAL', 'STORED_READ_DONE', 'UNKNOWN');

-- AlterTable
ALTER TABLE "ExpenseRecord" ADD COLUMN     "captureAllocationId" TEXT,
ADD COLUMN     "captureGroupId" TEXT,
ADD COLUMN     "captureScopeKey" TEXT,
ADD COLUMN     "payerUserId" TEXT;

-- CreateTable
CREATE TABLE "ExpenseCaptureGroup" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "intakeChannel" "ExpenseCaptureIntakeChannel" NOT NULL,
    "status" "ExpenseCaptureGroupStatus" NOT NULL DEFAULT 'OPEN',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "businessUse" "ExpenseCaptureBusinessUse" NOT NULL DEFAULT 'UNKNOWN',
    "fundingRoute" "ExpenseCaptureFundingRoute" NOT NULL DEFAULT 'UNKNOWN',
    "payerUserId" TEXT,
    "taxReviewJson" JSONB,
    "expenseDateSourceJson" JSONB,
    "lineChatKeyHash" TEXT,
    "acceptedAllocationId" TEXT,
    "handoffBatchKey" TEXT,
    "handoffState" "ExpenseCaptureHandoffState" NOT NULL DEFAULT 'NONE',
    "note" TEXT,
    "closedReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "ExpenseCaptureGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCaptureFile" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "uploadState" "ExpenseCaptureFileState" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "checksumSha256" TEXT,
    "pageCount" INTEGER,
    "addedByUserId" TEXT NOT NULL,
    "lineMessageId" TEXT,
    "detachedAt" TIMESTAMP(3),
    "detachedReason" TEXT,
    "electronicVerificationJson" JSONB NOT NULL DEFAULT '{"status":"NOT_CHECKED","method":null,"checkedAt":null}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "ExpenseCaptureFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCaptureReadJob" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ownerType" "ExpenseCaptureReadOwner" NOT NULL,
    "groupId" TEXT,
    "expenseId" TEXT,
    "fileId" TEXT,
    "attachmentId" TEXT NOT NULL,
    "attachmentChecksum" TEXT NOT NULL,
    "objectVersionId" TEXT,
    "preprocessVersion" INTEGER NOT NULL DEFAULT 1,
    "contractVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "ExpenseCaptureReadStatus" NOT NULL DEFAULT 'QUEUED',
    "ocrAdmissionRequestId" TEXT NOT NULL,
    "manifestJson" JSONB NOT NULL,
    "checkpointJson" JSONB NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leasedUntil" TIMESTAMP(3),
    "pausedReason" TEXT,
    "lastErrorCode" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "providerCallCount" INTEGER NOT NULL DEFAULT 0,
    "expectedSourceUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

CONSTRAINT "ExpenseCaptureReadJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCaptureObservation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "groupId" TEXT,
    "expenseId" TEXT,
    "fileId" TEXT,
    "jobId" TEXT,
    "version" INTEGER NOT NULL,
    "source" "ExpenseCaptureObservationSource" NOT NULL,
    "basedOnVersion" INTEGER,
    "payloadJson" JSONB NOT NULL,
    "modelLineageJson" JSONB,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "ExpenseCaptureObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCaptureAllocation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "groupRevision" INTEGER NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "selectionJson" JSONB NOT NULL,
    "inputJson" JSONB NOT NULL,
    "resultJson" JSONB NOT NULL,
    "fundingRoute" "ExpenseCaptureFundingRoute" NOT NULL,
    "payerUserId" TEXT,
    "computedByUserId" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ExpenseCaptureAllocationStatus" NOT NULL DEFAULT 'PREVIEW',
    "acceptedByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "invalidatedReason" TEXT,

CONSTRAINT "ExpenseCaptureAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineIntakeAttempt" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "lineUserIdHash" TEXT NOT NULL,
    "chatKeyHash" TEXT,
    "webhookEventId" TEXT,
    "lineMessageId" TEXT,
    "messageType" TEXT NOT NULL,
    "fileNameSanitized" TEXT,
    "declaredFileSize" INTEGER,
    "measuredByteSize" INTEGER,
    "capabilityJson" JSONB NOT NULL,
    "stage" "LineIntakeAttemptStage" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "outcome" "LineIntakeAttemptOutcome" NOT NULL DEFAULT 'UNKNOWN',
    "targetType" TEXT,
    "targetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "LineIntakeAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCaptureGroup_handoffBatchKey_key" ON "ExpenseCaptureGroup"("handoffBatchKey");

-- CreateIndex
CREATE INDEX "ExpenseCaptureGroup_companyId_createdByUserId_status_idx" ON "ExpenseCaptureGroup"("companyId", "createdByUserId", "status");

-- CreateIndex
CREATE INDEX "ExpenseCaptureGroup_companyId_status_updatedAt_idx" ON "ExpenseCaptureGroup"("companyId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCaptureGroup_companyId_id_key" ON "ExpenseCaptureGroup"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCaptureFile_attachmentId_key" ON "ExpenseCaptureFile"("attachmentId");

-- CreateIndex
CREATE INDEX "ExpenseCaptureFile_companyId_groupId_position_idx" ON "ExpenseCaptureFile"("companyId", "groupId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCaptureFile_companyId_groupId_attachmentId_key" ON "ExpenseCaptureFile"("companyId", "groupId", "attachmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCaptureFile_companyId_lineMessageId_key" ON "ExpenseCaptureFile"("companyId", "lineMessageId");

-- CreateIndex
CREATE INDEX "ExpenseCaptureReadJob_status_leasedUntil_idx" ON "ExpenseCaptureReadJob"("status", "leasedUntil");

-- CreateIndex
CREATE INDEX "ExpenseCaptureReadJob_companyId_groupId_idx" ON "ExpenseCaptureReadJob"("companyId", "groupId");

-- CreateIndex
CREATE INDEX "ExpenseCaptureReadJob_companyId_expenseId_idx" ON "ExpenseCaptureReadJob"("companyId", "expenseId");

-- CreateIndex
CREATE INDEX "ExpenseCaptureObservation_companyId_groupId_idx" ON "ExpenseCaptureObservation"("companyId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCaptureObservation_companyId_fileId_version_key" ON "ExpenseCaptureObservation"("companyId", "fileId", "version");

-- CreateIndex
CREATE INDEX "ExpenseCaptureAllocation_companyId_groupId_status_idx" ON "ExpenseCaptureAllocation"("companyId", "groupId", "status");

-- CreateIndex
CREATE INDEX "LineIntakeAttempt_companyId_lineUserIdHash_createdAt_idx" ON "LineIntakeAttempt"("companyId", "lineUserIdHash", "createdAt");

-- CreateIndex
CREATE INDEX "LineIntakeAttempt_createdAt_idx" ON "LineIntakeAttempt"("createdAt");

-- CreateIndex
CREATE INDEX "ExpenseRecord_companyId_payerUserId_idx" ON "ExpenseRecord"("companyId", "payerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseRecord_companyId_captureGroupId_captureScopeKey_key" ON "ExpenseRecord"("companyId", "captureGroupId", "captureScopeKey");

-- AddForeignKey
ALTER TABLE "ExpenseCaptureGroup" ADD CONSTRAINT "ExpenseCaptureGroup_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCaptureFile" ADD CONSTRAINT "ExpenseCaptureFile_companyId_groupId_fkey" FOREIGN KEY ("companyId", "groupId") REFERENCES "ExpenseCaptureGroup"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCaptureFile" ADD CONSTRAINT "ExpenseCaptureFile_companyId_attachmentId_fkey" FOREIGN KEY ("companyId", "attachmentId") REFERENCES "AttachmentObject"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCaptureReadJob" ADD CONSTRAINT "ExpenseCaptureReadJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCaptureObservation" ADD CONSTRAINT "ExpenseCaptureObservation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCaptureAllocation" ADD CONSTRAINT "ExpenseCaptureAllocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineIntakeAttempt" ADD CONSTRAINT "LineIntakeAttempt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
