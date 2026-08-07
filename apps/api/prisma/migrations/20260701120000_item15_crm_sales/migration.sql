-- Item 15: CRM and Sales MVP
-- Enums, tables, indexes, and foreign keys for the CRM and sales workflow.

-- CreateEnum
CREATE TYPE "CrmCustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED', 'MERGED');

-- CreateEnum
CREATE TYPE "CrmCustomerType" AS ENUM ('PERSON', 'ORGANIZATION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CrmConsentStatus" AS ENUM ('UNKNOWN', 'GRANTED', 'REVOKED', 'NOT_REQUIRED');

-- CreateEnum
CREATE TYPE "CrmContactStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CrmContactChannel" AS ENUM ('PHONE', 'LINE', 'EMAIL', 'FACEBOOK', 'MARKETPLACE_CHAT', 'VISIT', 'OTHER');

-- CreateEnum
CREATE TYPE "CrmLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'DISQUALIFIED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CrmLeadSource" AS ENUM ('MANUAL', 'CSV_IMPORT', 'LINE', 'FACEBOOK', 'MARKETPLACE', 'WEB_FORM', 'REFERRAL', 'OTHER');

-- CreateEnum
CREATE TYPE "CrmPipelineGroup" AS ENUM ('NEW_LEAD', 'CONTACTED', 'QUALIFIED', 'QUOTATION', 'NEGOTIATION', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "CrmOpportunityStatus" AS ENUM ('OPEN', 'WON', 'LOST', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CrmActivityType" AS ENUM ('CALL', 'CHAT', 'EMAIL', 'VISIT', 'MEETING', 'NOTE', 'QUOTE_DRAFT_CREATED', 'QUOTE_SENT', 'STAGE_CHANGED', 'TASK_CREATED', 'TASK_COMPLETED', 'CUSTOMER_UPDATED', 'OTHER');

-- CreateEnum
CREATE TYPE "CrmActivityOutcome" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE', 'NO_RESPONSE', 'NEEDS_FOLLOW_UP', 'COMPLETED', 'OTHER');

-- CreateEnum
CREATE TYPE "CrmFollowUpStatus" AS ENUM ('OPEN', 'DONE', 'SNOOZED', 'CANCELED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "CrmFollowUpPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "CrmQuotationLinkStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ISSUED', 'VOIDED', 'CONVERTED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "CrmCustomer" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "accountingCounterpartyId" TEXT,
    "code" TEXT,
    "displayName" TEXT NOT NULL,
    "legalName" TEXT,
    "customerType" "CrmCustomerType" NOT NULL DEFAULT 'UNKNOWN',
    "status" "CrmCustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "ownerUserId" TEXT,
    "ownerTeamId" TEXT,
    "primaryPhone" TEXT,
    "primaryPhoneNormalized" TEXT,
    "primaryEmail" TEXT,
    "primaryEmailNormalized" TEXT,
    "lineUserId" TEXT,
    "facebookId" TEXT,
    "taxId" TEXT,
    "taxIdNormalized" TEXT,
    "billingAddressJson" JSONB,
    "shippingAddressJson" JSONB,
    "consentStatus" "CrmConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
    "consentUpdatedAt" TIMESTAMP(3),
    "consentNote" TEXT,
    "source" TEXT,
    "notes" TEXT,
    "lastActivityAt" TIMESTAMP(3),
    "lastContactedAt" TIMESTAMP(3),
    "nextFollowUpAt" TIMESTAMP(3),
    "mergedIntoCustomerId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "archivedByUserId" TEXT,
    "archiveReason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmContactPerson" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "phone" TEXT,
    "phoneNormalized" TEXT,
    "email" TEXT,
    "emailNormalized" TEXT,
    "lineUserId" TEXT,
    "preferredChannel" "CrmContactChannel",
    "consentStatus" "CrmConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "status" "CrmContactStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmContactPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmLead" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "source" "CrmLeadSource" NOT NULL DEFAULT 'MANUAL',
    "sourceRefType" TEXT,
    "sourceRefId" TEXT,
    "rawName" TEXT,
    "rawPhone" TEXT,
    "rawPhoneNormalized" TEXT,
    "rawEmail" TEXT,
    "rawEmailNormalized" TEXT,
    "rawPayloadJson" JSONB,
    "status" "CrmLeadStatus" NOT NULL DEFAULT 'NEW',
    "assignedToUserId" TEXT,
    "assignedTeamId" TEXT,
    "note" TEXT,
    "convertedCustomerId" TEXT,
    "convertedOpportunityId" TEXT,
    "convertIdempotencyKey" TEXT,
    "disqualifiedReason" TEXT,
    "disqualifiedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmPipelineStage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "canonicalGroup" "CrmPipelineGroup" NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "probabilityDefault" INTEGER,
    "isTerminalWon" BOOLEAN NOT NULL DEFAULT false,
    "isTerminalLost" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmPipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmOpportunity" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "customerId" TEXT NOT NULL,
    "leadId" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "ownerTeamId" TEXT,
    "title" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "canonicalStageGroup" "CrmPipelineGroup" NOT NULL,
    "status" "CrmOpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "amountEstimate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "probability" INTEGER,
    "expectedCloseDate" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "closeReason" TEXT,
    "lostReason" TEXT,
    "lastActivityAt" TIMESTAMP(3),
    "nextFollowUpAt" TIMESTAMP(3),
    "quotationSummaryJson" JSONB,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmActivity" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT,
    "leadId" TEXT,
    "opportunityId" TEXT,
    "followUpTaskId" TEXT,
    "actorUserId" TEXT NOT NULL,
    "type" "CrmActivityType" NOT NULL,
    "channel" "CrmContactChannel",
    "outcome" "CrmActivityOutcome",
    "note" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadataJson" JSONB,
    "correctedByActivityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmFollowUpTask" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT,
    "leadId" TEXT,
    "opportunityId" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "ownerTeamId" TEXT,
    "title" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Bangkok',
    "priority" "CrmFollowUpPriority" NOT NULL DEFAULT 'NORMAL',
    "channel" "CrmContactChannel" NOT NULL DEFAULT 'PHONE',
    "status" "CrmFollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "snoozedUntil" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "canceledByUserId" TEXT,
    "cancelReason" TEXT,
    "nextActivityId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmFollowUpTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmQuotationLink" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "accountingDocumentId" TEXT NOT NULL,
    "accountingDocumentType" TEXT NOT NULL DEFAULT 'QUOTATION',
    "accountingDocumentNumber" TEXT,
    "status" "CrmQuotationLinkStatus" NOT NULL DEFAULT 'DRAFT',
    "grandTotalAmount" DECIMAL(18,4),
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmQuotationLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmCustomer_companyId_status_idx" ON "CrmCustomer"("companyId", "status");

-- CreateIndex
CREATE INDEX "CrmCustomer_companyId_ownerUserId_status_idx" ON "CrmCustomer"("companyId", "ownerUserId", "status");

-- CreateIndex
CREATE INDEX "CrmCustomer_companyId_primaryPhoneNormalized_idx" ON "CrmCustomer"("companyId", "primaryPhoneNormalized");

-- CreateIndex
CREATE INDEX "CrmCustomer_companyId_primaryEmailNormalized_idx" ON "CrmCustomer"("companyId", "primaryEmailNormalized");

-- CreateIndex
CREATE INDEX "CrmCustomer_companyId_taxIdNormalized_idx" ON "CrmCustomer"("companyId", "taxIdNormalized");

-- CreateIndex
CREATE INDEX "CrmCustomer_companyId_accountingCounterpartyId_idx" ON "CrmCustomer"("companyId", "accountingCounterpartyId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCustomer_companyId_code_key" ON "CrmCustomer"("companyId", "code");

-- CreateIndex
CREATE INDEX "CrmContactPerson_companyId_customerId_status_idx" ON "CrmContactPerson"("companyId", "customerId", "status");

-- CreateIndex
CREATE INDEX "CrmLead_companyId_status_idx" ON "CrmLead"("companyId", "status");

-- CreateIndex
CREATE INDEX "CrmLead_companyId_assignedToUserId_status_idx" ON "CrmLead"("companyId", "assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "CrmLead_companyId_source_sourceRefId_idx" ON "CrmLead"("companyId", "source", "sourceRefId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmLead_companyId_convertIdempotencyKey_key" ON "CrmLead"("companyId", "convertIdempotencyKey");

-- CreateIndex
CREATE INDEX "CrmPipelineStage_companyId_sortOrder_idx" ON "CrmPipelineStage"("companyId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CrmPipelineStage_companyId_name_key" ON "CrmPipelineStage"("companyId", "name");

-- CreateIndex
CREATE INDEX "CrmOpportunity_companyId_status_idx" ON "CrmOpportunity"("companyId", "status");

-- CreateIndex
CREATE INDEX "CrmOpportunity_companyId_customerId_idx" ON "CrmOpportunity"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "CrmOpportunity_companyId_ownerUserId_status_idx" ON "CrmOpportunity"("companyId", "ownerUserId", "status");

-- CreateIndex
CREATE INDEX "CrmOpportunity_companyId_stageId_status_idx" ON "CrmOpportunity"("companyId", "stageId", "status");

-- CreateIndex
CREATE INDEX "CrmOpportunity_companyId_expectedCloseDate_idx" ON "CrmOpportunity"("companyId", "expectedCloseDate");

-- CreateIndex
CREATE INDEX "CrmActivity_companyId_customerId_occurredAt_idx" ON "CrmActivity"("companyId", "customerId", "occurredAt");

-- CreateIndex
CREATE INDEX "CrmActivity_companyId_opportunityId_occurredAt_idx" ON "CrmActivity"("companyId", "opportunityId", "occurredAt");

-- CreateIndex
CREATE INDEX "CrmActivity_companyId_actorUserId_occurredAt_idx" ON "CrmActivity"("companyId", "actorUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "CrmFollowUpTask_companyId_status_dueAt_idx" ON "CrmFollowUpTask"("companyId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "CrmFollowUpTask_companyId_ownerUserId_status_dueAt_idx" ON "CrmFollowUpTask"("companyId", "ownerUserId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "CrmFollowUpTask_companyId_customerId_status_idx" ON "CrmFollowUpTask"("companyId", "customerId", "status");

-- CreateIndex
CREATE INDEX "CrmFollowUpTask_companyId_opportunityId_status_idx" ON "CrmFollowUpTask"("companyId", "opportunityId", "status");

-- CreateIndex
CREATE INDEX "CrmQuotationLink_companyId_customerId_idx" ON "CrmQuotationLink"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "CrmQuotationLink_companyId_opportunityId_idx" ON "CrmQuotationLink"("companyId", "opportunityId");

-- CreateIndex
CREATE INDEX "CrmQuotationLink_companyId_accountingDocumentId_idx" ON "CrmQuotationLink"("companyId", "accountingDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmQuotationLink_companyId_opportunityId_accountingDocument_key" ON "CrmQuotationLink"("companyId", "opportunityId", "accountingDocumentId");

-- AddForeignKey
ALTER TABLE "CrmCustomer" ADD CONSTRAINT "CrmCustomer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContactPerson" ADD CONSTRAINT "CrmContactPerson_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContactPerson" ADD CONSTRAINT "CrmContactPerson_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CrmCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmPipelineStage" ADD CONSTRAINT "CrmPipelineStage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CrmCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "CrmPipelineStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmFollowUpTask" ADD CONSTRAINT "CrmFollowUpTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmQuotationLink" ADD CONSTRAINT "CrmQuotationLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmQuotationLink" ADD CONSTRAINT "CrmQuotationLink_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "CrmOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

