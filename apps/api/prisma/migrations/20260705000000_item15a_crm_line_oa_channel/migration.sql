-- Item 15A: CRM Customer OS — company LINE OA channel, channel identity, conversation, message,
-- and additive CrmCustomer AI-advisory scoring columns. All tables tenant-scoped by companyId.

-- CreateEnum
CREATE TYPE "MessagingChannelProvider" AS ENUM ('LINE_OA');

-- CreateEnum
CREATE TYPE "MessagingChannelStatus" AS ENUM ('PENDING_SETUP', 'CONNECTED', 'ACTIVE', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "CrmChannelIdentityStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'UNFOLLOWED');

-- CreateEnum
CREATE TYPE "CrmConversationStatus" AS ENUM ('NEW', 'OPEN', 'WAITING_CUSTOMER', 'WAITING_INTERNAL', 'FOLLOW_UP', 'RESOLVED', 'SPAM');

-- CreateEnum
CREATE TYPE "CrmConversationPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "CrmMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "CrmMessageVisibility" AS ENUM ('CUSTOMER', 'INTERNAL_NOTE');

-- CreateEnum
CREATE TYPE "CrmMessageAuthorType" AS ENUM ('CUSTOMER', 'STAFF', 'SYSTEM');

-- CreateEnum
CREATE TYPE "CrmMessageType" AS ENUM ('TEXT', 'IMAGE', 'STICKER', 'FILE', 'LOCATION', 'DOCUMENT', 'TEMPLATE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "CrmMessageDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "CrmSentiment" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE');

-- CreateEnum
CREATE TYPE "CrmRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterTable
ALTER TABLE "CrmCustomer" ADD COLUMN     "leadScore" INTEGER,
ADD COLUMN     "leadScoreUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "lifetimeValueAmount" DECIMAL(18,4),
ADD COLUMN     "lifetimeValueUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "riskLevel" "CrmRiskLevel",
ADD COLUMN     "sentiment" "CrmSentiment";

-- CreateTable
CREATE TABLE "CompanyMessagingChannel" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "MessagingChannelProvider" NOT NULL DEFAULT 'LINE_OA',
    "displayName" TEXT NOT NULL,
    "lineChannelId" TEXT NOT NULL,
    "encryptedSecretJson" TEXT NOT NULL,
    "credentialLast4" TEXT NOT NULL,
    "secretVersion" INTEGER NOT NULL DEFAULT 1,
    "webhookKey" TEXT NOT NULL,
    "status" "MessagingChannelStatus" NOT NULL DEFAULT 'PENDING_SETUP',
    "lastWebhookAt" TIMESTAMP(3),
    "lastValidatedAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "quotaSnapshotJson" JSONB,
    "connectedByUserId" TEXT NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "disabledByUserId" TEXT,
    "disableReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyMessagingChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmChannelIdentity" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "provider" "MessagingChannelProvider" NOT NULL DEFAULT 'LINE_OA',
    "providerUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "pictureUrl" TEXT,
    "followedAt" TIMESTAMP(3),
    "unfollowedAt" TIMESTAMP(3),
    "status" "CrmChannelIdentityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmChannelIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmConversation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channelIdentityId" TEXT NOT NULL,
    "status" "CrmConversationStatus" NOT NULL DEFAULT 'NEW',
    "priority" "CrmConversationPriority" NOT NULL DEFAULT 'NORMAL',
    "assignedToUserId" TEXT,
    "assignedTeamId" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "lastMessagePreview" TEXT,
    "firstResponseDueAt" TIMESTAMP(3),
    "firstRespondedAt" TIMESTAMP(3),
    "slaBreachedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "reopenedCount" INTEGER NOT NULL DEFAULT 0,
    "campaignId" TEXT,
    "tagsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmMessage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "CrmMessageDirection" NOT NULL,
    "visibility" "CrmMessageVisibility" NOT NULL DEFAULT 'CUSTOMER',
    "authorType" "CrmMessageAuthorType" NOT NULL,
    "authorUserId" TEXT,
    "messageType" "CrmMessageType" NOT NULL,
    "contentText" TEXT,
    "contentJson" JSONB,
    "attachmentId" TEXT,
    "accountingDocumentRef" TEXT,
    "aiDraftUsed" BOOLEAN NOT NULL DEFAULT false,
    "providerMessageId" TEXT,
    "webhookEventId" TEXT,
    "deliveryStatus" "CrmMessageDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "deliveryError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyMessagingChannel_webhookKey_key" ON "CompanyMessagingChannel"("webhookKey");

-- CreateIndex
CREATE INDEX "CompanyMessagingChannel_companyId_status_idx" ON "CompanyMessagingChannel"("companyId", "status");

-- CreateIndex
CREATE INDEX "CompanyMessagingChannel_lineChannelId_idx" ON "CompanyMessagingChannel"("lineChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyMessagingChannel_companyId_provider_lineChannelId_key" ON "CompanyMessagingChannel"("companyId", "provider", "lineChannelId");

-- CreateIndex
CREATE INDEX "CrmChannelIdentity_companyId_customerId_idx" ON "CrmChannelIdentity"("companyId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmChannelIdentity_channelId_providerUserId_key" ON "CrmChannelIdentity"("channelId", "providerUserId");

-- CreateIndex
CREATE INDEX "CrmConversation_companyId_status_lastMessageAt_idx" ON "CrmConversation"("companyId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "CrmConversation_companyId_assignedToUserId_status_idx" ON "CrmConversation"("companyId", "assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "CrmConversation_companyId_customerId_idx" ON "CrmConversation"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "CrmConversation_companyId_firstResponseDueAt_idx" ON "CrmConversation"("companyId", "firstResponseDueAt");

-- CreateIndex
CREATE INDEX "CrmConversation_channelIdentityId_idx" ON "CrmConversation"("channelIdentityId");

-- CreateIndex
CREATE INDEX "CrmMessage_companyId_conversationId_createdAt_idx" ON "CrmMessage"("companyId", "conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmMessage_conversationId_providerMessageId_key" ON "CrmMessage"("conversationId", "providerMessageId");

-- AddForeignKey
ALTER TABLE "CompanyMessagingChannel" ADD CONSTRAINT "CompanyMessagingChannel_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmChannelIdentity" ADD CONSTRAINT "CrmChannelIdentity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmChannelIdentity" ADD CONSTRAINT "CrmChannelIdentity_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "CompanyMessagingChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmConversation" ADD CONSTRAINT "CrmConversation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmConversation" ADD CONSTRAINT "CrmConversation_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "CompanyMessagingChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmMessage" ADD CONSTRAINT "CrmMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmMessage" ADD CONSTRAINT "CrmMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "CrmConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

