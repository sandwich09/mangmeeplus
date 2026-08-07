-- CreateEnum
CREATE TYPE "CrmAiAssistKind" AS ENUM ('SUMMARY', 'REPLY_DRAFT', 'INSIGHTS');

-- CreateEnum
CREATE TYPE "CrmAiFeedbackRating" AS ENUM ('UP', 'DOWN');

-- AlterTable
ALTER TABLE "CrmConversation" ADD COLUMN "aiSummaryText" TEXT,
ADD COLUMN "aiSummaryAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CrmAiAssistFeedback" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "kind" "CrmAiAssistKind" NOT NULL,
    "rating" "CrmAiFeedbackRating" NOT NULL,
    "comment" TEXT,
    "requestId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmAiAssistFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmAiAssistFeedback_companyId_conversationId_createdAt_idx" ON "CrmAiAssistFeedback"("companyId", "conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "CrmAiAssistFeedback" ADD CONSTRAINT "CrmAiAssistFeedback_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAiAssistFeedback" ADD CONSTRAINT "CrmAiAssistFeedback_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "CrmConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
