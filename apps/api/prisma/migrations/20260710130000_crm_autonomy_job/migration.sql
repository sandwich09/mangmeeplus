-- GC4: durable autonomy evaluation for inbound CRM text messages.
CREATE TYPE "CrmAutonomyJobStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

CREATE TABLE "CrmAutonomyJob" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "replyToken" TEXT,
    "replyTokenAt" TIMESTAMP(3),
    "status" "CrmAutonomyJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmAutonomyJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrmAutonomyJob_messageId_key" ON "CrmAutonomyJob"("messageId");
CREATE INDEX "CrmAutonomyJob_status_nextAttemptAt_idx" ON "CrmAutonomyJob"("status", "nextAttemptAt");
CREATE INDEX "CrmAutonomyJob_companyId_idx" ON "CrmAutonomyJob"("companyId");

ALTER TABLE "CrmAutonomyJob" ADD CONSTRAINT "CrmAutonomyJob_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmAutonomyJob" ADD CONSTRAINT "CrmAutonomyJob_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "CrmConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmAutonomyJob" ADD CONSTRAINT "CrmAutonomyJob_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "CrmMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
