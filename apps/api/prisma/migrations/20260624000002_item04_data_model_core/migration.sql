-- Item 04: Data Model Core additive schema.

-- AlterEnum
ALTER TYPE "OutboxEventStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "OutboxEventStatus" ADD VALUE IF NOT EXISTS 'DEAD';

-- CreateEnum
CREATE TYPE "OutboxEventPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');
CREATE TYPE "BranchStatus" AS ENUM ('ACTIVE', 'DISABLED', 'ARCHIVED');
CREATE TYPE "BranchType" AS ENUM ('HEAD_OFFICE', 'BRANCH', 'ONLINE', 'WAREHOUSE');
CREATE TYPE "MembershipBranchScopeMode" AS ENUM ('ALL_BRANCHES', 'SELECTED_BRANCHES', 'DEFAULT_BRANCH_ONLY');
CREATE TYPE "AttachmentStatus" AS ENUM ('PENDING_UPLOAD', 'ACTIVE', 'QUARANTINED', 'DELETED');
CREATE TYPE "AttachmentVisibility" AS ENUM ('INTERNAL', 'ACCOUNTING', 'AUDIT', 'CUSTOMER_VISIBLE');
CREATE TYPE "DocumentSequenceStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "DocumentResetPolicy" AS ENUM ('NONE', 'MONTHLY', 'YEARLY');
CREATE TYPE "DocumentNumberStatus" AS ENUM ('RESERVED', 'COMMITTED', 'CANCELLED', 'VOIDED');

-- AlterTable
ALTER TABLE "Company"
  ADD COLUMN "registeredName" TEXT,
  ADD COLUMN "brandName" TEXT,
  ADD COLUMN "vatRegistered" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "addressJson" JSONB,
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Bangkok',
  ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'th-TH',
  ADD COLUMN "baseCurrency" TEXT NOT NULL DEFAULT 'THB';

-- AlterTable
ALTER TABLE "CompanyMembership"
  ADD COLUMN "branchScopeMode" "MembershipBranchScopeMode" NOT NULL DEFAULT 'ALL_BRANCHES';

-- AlterTable
ALTER TABLE "OutboxEvent" RENAME COLUMN "payload" TO "payloadJson";
ALTER TABLE "OutboxEvent" ADD COLUMN "aggregateType" TEXT NOT NULL DEFAULT 'legacy';
UPDATE "OutboxEvent" SET "aggregateId" = "id" WHERE "aggregateId" IS NULL;
ALTER TABLE "OutboxEvent" ALTER COLUMN "aggregateId" SET NOT NULL;
ALTER TABLE "OutboxEvent" ADD COLUMN "eventKey" TEXT;
UPDATE "OutboxEvent" SET "eventKey" = "id" WHERE "eventKey" IS NULL;
ALTER TABLE "OutboxEvent" ALTER COLUMN "eventKey" SET NOT NULL;
ALTER TABLE "OutboxEvent"
  ADD COLUMN "headersJson" JSONB,
  ADD COLUMN "priority" "OutboxEventPriority" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lockedAt" TIMESTAMP(3),
  ADD COLUMN "lockedBy" TEXT,
  ADD COLUMN "lastError" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DROP INDEX IF EXISTS "OutboxEvent_status_createdAt_idx";
CREATE UNIQUE INDEX "OutboxEvent_eventKey_key" ON "OutboxEvent"("eventKey");
CREATE INDEX "OutboxEvent_status_availableAt_priority_idx" ON "OutboxEvent"("status", "availableAt", "priority");
CREATE INDEX "OutboxEvent_companyId_createdAt_idx" ON "OutboxEvent"("companyId", "createdAt");
CREATE INDEX "OutboxEvent_aggregateType_aggregateId_idx" ON "OutboxEvent"("aggregateType", "aggregateId");

-- CreateTable
CREATE TABLE "Branch" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "BranchType" NOT NULL DEFAULT 'BRANCH',
  "taxBranchCode" TEXT,
  "addressJson" JSONB,
  "phone" TEXT,
  "email" TEXT,
  "status" "BranchStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipBranchScope" (
  "id" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MembershipBranchScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttachmentObject" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "storageProvider" TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "checksumSha256" TEXT,
  "visibility" "AttachmentVisibility" NOT NULL DEFAULT 'INTERNAL',
  "status" "AttachmentStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
  "uploadedByUserId" TEXT NOT NULL,
  "uploadedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AttachmentObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttachmentLink" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "attachmentId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "linkedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttachmentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSequence" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "branchScopeKey" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "periodKey" TEXT NOT NULL,
  "prefixTemplate" TEXT NOT NULL,
  "nextNumber" INTEGER NOT NULL DEFAULT 1,
  "padding" INTEGER NOT NULL DEFAULT 5,
  "resetPolicy" "DocumentResetPolicy" NOT NULL DEFAULT 'NONE',
  "status" "DocumentSequenceStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentNumber" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "sequenceId" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "documentNumber" TEXT NOT NULL,
  "status" "DocumentNumberStatus" NOT NULL DEFAULT 'RESERVED',
  "ownerType" TEXT,
  "ownerId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "reservedByUserId" TEXT NOT NULL,
  "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "committedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "voidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DocumentNumber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Branch_companyId_code_key" ON "Branch"("companyId", "code");
CREATE INDEX "Branch_companyId_status_idx" ON "Branch"("companyId", "status");
CREATE INDEX "Branch_companyId_taxBranchCode_idx" ON "Branch"("companyId", "taxBranchCode");
CREATE UNIQUE INDEX "MembershipBranchScope_membershipId_branchId_key" ON "MembershipBranchScope"("membershipId", "branchId");
CREATE INDEX "MembershipBranchScope_branchId_idx" ON "MembershipBranchScope"("branchId");
CREATE INDEX "AttachmentObject_companyId_status_createdAt_idx" ON "AttachmentObject"("companyId", "status", "createdAt");
CREATE INDEX "AttachmentObject_companyId_checksumSha256_idx" ON "AttachmentObject"("companyId", "checksumSha256");
CREATE INDEX "AttachmentObject_uploadedByUserId_createdAt_idx" ON "AttachmentObject"("uploadedByUserId", "createdAt");
CREATE UNIQUE INDEX "AttachmentLink_attachmentId_targetType_targetId_purpose_key" ON "AttachmentLink"("attachmentId", "targetType", "targetId", "purpose");
CREATE INDEX "AttachmentLink_companyId_targetType_targetId_idx" ON "AttachmentLink"("companyId", "targetType", "targetId");
CREATE UNIQUE INDEX "DocumentSequence_companyId_branchScopeKey_documentType_periodKey_key" ON "DocumentSequence"("companyId", "branchScopeKey", "documentType", "periodKey");
CREATE INDEX "DocumentSequence_companyId_documentType_status_idx" ON "DocumentSequence"("companyId", "documentType", "status");
CREATE UNIQUE INDEX "DocumentNumber_companyId_documentType_documentNumber_key" ON "DocumentNumber"("companyId", "documentType", "documentNumber");
CREATE UNIQUE INDEX "DocumentNumber_companyId_documentType_idempotencyKey_key" ON "DocumentNumber"("companyId", "documentType", "idempotencyKey");
CREATE INDEX "DocumentNumber_companyId_ownerType_ownerId_idx" ON "DocumentNumber"("companyId", "ownerType", "ownerId");
CREATE INDEX "DocumentNumber_sequenceId_status_idx" ON "DocumentNumber"("sequenceId", "status");

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MembershipBranchScope" ADD CONSTRAINT "MembershipBranchScope_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "CompanyMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttachmentObject" ADD CONSTRAINT "AttachmentObject_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttachmentLink" ADD CONSTRAINT "AttachmentLink_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "AttachmentObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentSequence" ADD CONSTRAINT "DocumentSequence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentNumber" ADD CONSTRAINT "DocumentNumber_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentNumber" ADD CONSTRAINT "DocumentNumber_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "DocumentSequence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
