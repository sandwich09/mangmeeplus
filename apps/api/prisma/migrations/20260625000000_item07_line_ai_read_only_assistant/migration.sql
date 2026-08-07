-- Item 07 LINE AI Read-Only Assistant persistence.
-- Stores safe previews/hashes, source refs, tool calls, and webhook idempotency logs.

CREATE TYPE "AiTurnStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'REFUSED', 'ERROR');
CREATE TYPE "AiTurnIntent" AS ENUM ('READ_SUMMARY', 'READ_DETAIL', 'MUTATION_REQUEST', 'UNSUPPORTED_MODULE', 'FORBIDDEN', 'UNKNOWN');

CREATE TABLE "AiConversation" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'line',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiTurn" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "webhookEventId" TEXT,
  "userMessagePreview" TEXT,
  "messagePreviewHash" TEXT NOT NULL,
  "status" "AiTurnStatus" NOT NULL DEFAULT 'PROCESSING',
  "intent" "AiTurnIntent" NOT NULL DEFAULT 'UNKNOWN',
  "agent" TEXT,
  "refused" BOOLEAN NOT NULL DEFAULT false,
  "refusalReason" TEXT,
  "replyPreview" TEXT,
  "sourceRefsJson" JSONB,
  "durationMs" INTEGER,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiTurn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiToolInvocation" (
  "id" TEXT NOT NULL,
  "turnId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "toolName" TEXT NOT NULL,
  "toolCategory" TEXT NOT NULL,
  "inputHash" TEXT,
  "status" TEXT NOT NULL,
  "sourceRefsJson" JSONB,
  "durationMs" INTEGER,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiToolInvocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LineWebhookEventLog" (
  "id" TEXT NOT NULL,
  "webhookEventId" TEXT NOT NULL,
  "companyId" TEXT,
  "lineUserIdHash" TEXT,
  "eventType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'received',
  "errorCode" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LineWebhookEventLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiConversation_companyId_userId_channel_idx" ON "AiConversation"("companyId", "userId", "channel");
CREATE INDEX "AiTurn_companyId_userId_createdAt_idx" ON "AiTurn"("companyId", "userId", "createdAt");
CREATE INDEX "AiTurn_conversationId_idx" ON "AiTurn"("conversationId");
CREATE INDEX "AiToolInvocation_companyId_userId_toolName_createdAt_idx" ON "AiToolInvocation"("companyId", "userId", "toolName", "createdAt");
CREATE INDEX "AiToolInvocation_turnId_idx" ON "AiToolInvocation"("turnId");
CREATE UNIQUE INDEX "LineWebhookEventLog_webhookEventId_key" ON "LineWebhookEventLog"("webhookEventId");
CREATE INDEX "LineWebhookEventLog_companyId_createdAt_idx" ON "LineWebhookEventLog"("companyId", "createdAt");
CREATE INDEX "LineWebhookEventLog_lineUserIdHash_idx" ON "LineWebhookEventLog"("lineUserIdHash");

ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiTurn" ADD CONSTRAINT "AiTurn_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiTurn" ADD CONSTRAINT "AiTurn_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiToolInvocation" ADD CONSTRAINT "AiToolInvocation_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "AiTurn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiToolInvocation" ADD CONSTRAINT "AiToolInvocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
